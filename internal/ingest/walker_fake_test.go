package ingest

// walker_fake_test.go — the PER-ENDPOINT fake chain for walker tests (Task 9
// wave 12, the chain-truth consult's binding precondition).
//
// WHY THIS FILE EXISTS. Until this wave the walker's fake was a single-view
// fake: one head, one hash source, one log script (`fakeChain`, formerly in
// walker_test.go). Every endpoint therefore agreed about every block BY
// CONSTRUCTION, so the fake was structurally incapable of expressing the one
// thing the OP incident was made of: two endpoints DISAGREEING about the same
// heights because they sit on different forks or different backends behind
// one URL. That is the round-5 "the fake is the limiting factor" law
// (ledger :48), present at ingest — no amount of test-writing discipline
// reaches a failure mode the harness cannot represent. This file is the
// prices wave-6 `endpointView` pattern transposed: an entry written for
// endpoint 0 says nothing whatever about endpoint 1.
//
// The fake mirrors chain.Failover's ROUTING CONTRACT, not just its answers:
// every *From method walks endpoints from the requested start index exactly
// as Failover.doFrom does — normalize, rotate on error, return the FIRST
// answer — and stamps its token with the endpoint that actually served it,
// so tests prove the WALKER chooses the endpoint, never the fake. The From
// methods NEVER touch the shared `active` hint, structurally, exactly like
// the production doFrom path; `active` exists so tests can model what the
// SHARED path (Failover.do: HeaderTime freshness probes, TxCalldata, any
// sibling's shared-path success) does to the hint out from under a walker.
//
// Fixture-realism law (ledger :78): every view answers like a real endpoint —
// a height it does not carry is an honest not-found error that fails the
// attempt and rotates (the chain_rawjson_test.go behavior), never a default
// hash; `canon` marks a fully-synced endpoint whose chain is the shared
// deterministic canonical chain (blockHashAt), which is a state every
// healthy production endpoint is actually in.

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/kaselunt/solvent/internal/chain"
)

// blockHashAt is the deterministic canonical-chain hash at a height — unique
// per height, never zero (the prices wave-6 helper, same shape). Endpoints
// that AGREE are endpoints whose views both answer this.
func blockHashAt(block uint64) common.Hash {
	return common.BigToHash(new(big.Int).SetUint64(block + 1))
}

// walkerEndpointView is ONE rpc endpoint's PRIVATE view of the chain.
type walkerEndpointView struct {
	// head / headSet script this endpoint's chain HEAD (the eth_blockNumber
	// answer). An endpoint with no head scripted fails the head read and the
	// walk rotates on, so a test cannot accidentally walk a chain it never
	// described. headErr fails the head probe distinctly (a node whose height
	// probe is broken while its header path still answers).
	head    uint64
	headSet bool
	headErr error
	// hashes is this endpoint's chain: height → hash. A height absent from it
	// (and not covered by canon) answers an honest not-found that FAILS the
	// attempt and rotates — the real adapter's null-result behavior.
	hashes map[uint64]common.Hash
	// headerSeq scripts per-CALL overrides for a height, consumed in order —
	// the primitive for "this endpoint's two header reads answered from two
	// internal backends" (the R2 split). With seqLoop the sequence recycles
	// forever: a STABLE backend split, not a one-shot glitch.
	headerSeq map[uint64][]common.Hash
	seqLoop   bool
	// canon marks a fully-synced endpoint: heights not explicitly scripted
	// answer the deterministic canonical chain (blockHashAt).
	canon bool
	// logs is this endpoint's log index: height → logs at that height.
	// logsErr fails every getLogs on this endpoint (the publicnode-403
	// shape: header path healthy, deep getLogs refused).
	logs    map[uint64][]types.Log
	logsErr error
	// down fails EVERY probe — a node that is unreachable, not merely forked.
	down error
	// errAt fails this endpoint's header probe for SPECIFIC heights.
	errAt map[uint64]error
}

// headerHash answers this view's header probe at n, exactly one endpoint's
// worth of truth.
func (v *walkerEndpointView) headerHash(n uint64) (common.Hash, error) {
	if v.down != nil {
		return common.Hash{}, v.down
	}
	if err := v.errAt[n]; err != nil {
		return common.Hash{}, err
	}
	if seq := v.headerSeq[n]; len(seq) > 0 {
		h := seq[0]
		if v.seqLoop {
			v.headerSeq[n] = append(seq[1:], h)
		} else {
			v.headerSeq[n] = seq[1:]
		}
		return h, nil
	}
	if h, ok := v.hashes[n]; ok {
		return h, nil
	}
	if v.canon {
		return blockHashAt(n), nil
	}
	return common.Hash{}, fmt.Errorf("header %d not found on this endpoint", n)
}

// fakeHeaderAsk records one HeaderHashFrom call: the start the walker asked
// for, the height, and the endpoint that served it (-1 when all failed).
type fakeHeaderAsk struct {
	start  int
	height uint64
	served int
}

// fakeLogsAsk records one LogsFrom call the same way.
type fakeLogsAsk struct {
	start    int
	from, to uint64
	served   int
}

type fakeEndpointChain struct {
	endpoints int
	// active is the SHARED routing hint (Failover.active). The caller-scoped
	// From methods READ it never (they take explicit starts) and WRITE it
	// never — structurally, like doFrom. ActiveEndpoint reports it. Tests
	// write it directly to model a sibling's shared-path success re-pinning
	// the hint (the R3 schedule).
	active int

	views map[int]*walkerEndpointView

	// Recorded asks: the routing evidence the regressions assert on.
	// blockStarts is each BlockNumberFrom's REQUESTED start — the walker's
	// routing decision, before any rotation; blockServed the endpoint that
	// answered (-1 when all failed).
	blockStarts []int
	blockServed []int
	headerAsks  []fakeHeaderAsk
	logsAsks    []fakeLogsAsk
}

func newFakeEndpointChain(endpoints int) *fakeEndpointChain {
	return &fakeEndpointChain{endpoints: endpoints, views: map[int]*walkerEndpointView{}}
}

// view returns endpoint idx's private chain view, creating an empty one on
// first use. An empty view knows nothing: every probe on it fails honestly.
func (c *fakeEndpointChain) view(idx int) *walkerEndpointView {
	v, ok := c.views[idx]
	if !ok {
		v = &walkerEndpointView{
			hashes:    map[uint64]common.Hash{},
			headerSeq: map[uint64][]common.Hash{},
			logs:      map[uint64][]types.Log{},
			errAt:     map[uint64]error{},
		}
		c.views[idx] = v
	}
	return v
}

func (c *fakeEndpointChain) count() int {
	if c.endpoints <= 0 {
		return 1
	}
	return c.endpoints
}

// --- scripting helpers -----------------------------------------------------

// canonAll marks every endpoint fully synced on the shared canonical chain —
// the agreement most tests want; disagreement is then scripted per endpoint
// on top.
func (c *fakeEndpointChain) canonAll() *fakeEndpointChain {
	for i := 0; i < c.count(); i++ {
		c.view(i).canon = true
	}
	return c
}

// setHeadAll scripts the same chain head on every endpoint.
func (c *fakeEndpointChain) setHeadAll(head uint64) *fakeEndpointChain {
	for i := 0; i < c.count(); i++ {
		v := c.view(i)
		v.head, v.headSet = head, true
	}
	return c
}

// setHashAll writes the same hash at a height into EVERY endpoint's view —
// the endpoints agree about this height.
func (c *fakeEndpointChain) setHashAll(block uint64, h common.Hash) *fakeEndpointChain {
	for i := 0; i < c.count(); i++ {
		c.view(i).hashes[block] = h
	}
	return c
}

// seqAll scripts the same per-call header sequence at a height on every
// endpoint.
func (c *fakeEndpointChain) seqAll(block uint64, hs ...common.Hash) *fakeEndpointChain {
	for i := 0; i < c.count(); i++ {
		seq := make([]common.Hash, len(hs))
		copy(seq, hs)
		c.view(i).headerSeq[block] = seq
	}
	return c
}

// setLogsAll scripts the same logs at a height on every endpoint.
func (c *fakeEndpointChain) setLogsAll(block uint64, ls ...types.Log) *fakeEndpointChain {
	for i := 0; i < c.count(); i++ {
		logs := make([]types.Log, len(ls))
		copy(logs, ls)
		c.view(i).logs[block] = logs
	}
	return c
}

// agreeingChain is the ported single-view posture: two endpoints, both fully
// synced on the canonical chain at `head`. Two endpoints ON PURPOSE — the old
// fake could not even represent a second one, and every invariant proven here
// must hold when a healthy sibling endpoint exists.
func agreeingChain(head uint64) *fakeEndpointChain {
	return newFakeEndpointChain(2).setHeadAll(head).canonAll()
}

// --- the caller-scoped From walk (chain.Failover.doFrom, mirrored) ----------

// normalizeStart is doFrom's start normalization, negatives included.
func (c *fakeEndpointChain) normalizeStart(start int) int {
	n := c.count()
	return ((start % n) + n) % n
}

func (c *fakeEndpointChain) ActiveEndpoint() int { return c.active }

func (c *fakeEndpointChain) EndpointCount() int { return c.count() }

// BlockNumberFrom walks endpoints from start exactly as Failover.doFrom does
// and returns the first scripted head, stamping the token with the endpoint
// that answered. The shared hint is not read and not written.
func (c *fakeEndpointChain) BlockNumberFrom(_ context.Context, start int) (uint64, chain.EndpointToken, error) {
	c.blockStarts = append(c.blockStarts, start)
	n := c.count()
	first := c.normalizeStart(start)
	var lastErr error
	for i := 0; i < n; i++ {
		idx := (first + i) % n
		v := c.view(idx)
		if v.down != nil {
			lastErr = v.down
			continue
		}
		if v.headErr != nil {
			lastErr = v.headErr
			continue
		}
		if !v.headSet {
			lastErr = fmt.Errorf("no head scripted on endpoint %d", idx)
			continue
		}
		c.blockServed = append(c.blockServed, idx)
		return v.head, chain.EndpointToken{Index: idx}, nil
	}
	c.blockServed = append(c.blockServed, -1)
	return 0, chain.EndpointToken{Index: -1}, fmt.Errorf("all rpc endpoints failed (blockNumber): %w", lastErr)
}

// HeaderHashFrom walks endpoints from start; a view that does not carry the
// height fails the attempt honestly and the walk rotates — the real
// adapter's not-found behavior (chain_rawjson_test.go pins it).
func (c *fakeEndpointChain) HeaderHashFrom(_ context.Context, start int, height uint64) (common.Hash, chain.EndpointToken, error) {
	n := c.count()
	first := c.normalizeStart(start)
	var lastErr error
	for i := 0; i < n; i++ {
		idx := (first + i) % n
		h, err := c.view(idx).headerHash(height)
		if err != nil {
			lastErr = err
			continue
		}
		c.headerAsks = append(c.headerAsks, fakeHeaderAsk{start: start, height: height, served: idx})
		return h, chain.EndpointToken{Index: idx}, nil
	}
	c.headerAsks = append(c.headerAsks, fakeHeaderAsk{start: start, height: height, served: -1})
	return common.Hash{}, chain.EndpointToken{Index: -1}, fmt.Errorf("all rpc endpoints failed (headerHash %d): %w", height, lastErr)
}

// LogsFrom walks endpoints from start and serves the window from the FIRST
// endpoint whose getLogs answers, concatenating that one endpoint's view of
// [from, to] — one witness per response, exactly like a real getLogs.
func (c *fakeEndpointChain) LogsFrom(_ context.Context, start int, from, to uint64, _ []common.Address) ([]types.Log, chain.EndpointToken, error) {
	n := c.count()
	first := c.normalizeStart(start)
	var lastErr error
	for i := 0; i < n; i++ {
		idx := (first + i) % n
		v := c.view(idx)
		if v.down != nil {
			lastErr = v.down
			continue
		}
		if v.logsErr != nil {
			lastErr = v.logsErr
			continue
		}
		var out []types.Log
		for b := from; b <= to; b++ {
			out = append(out, v.logs[b]...)
		}
		c.logsAsks = append(c.logsAsks, fakeLogsAsk{start: start, from: from, to: to, served: idx})
		return out, chain.EndpointToken{Index: idx}, nil
	}
	c.logsAsks = append(c.logsAsks, fakeLogsAsk{start: start, from: from, to: to, served: -1})
	return nil, chain.EndpointToken{Index: -1}, fmt.Errorf("all rpc endpoints failed (getLogs [%d,%d]): %w", from, to, lastErr)
}

// The blind shared-hint bridge methods (BlockNumber/HeaderHash/Logs mirroring
// Failover.do) existed only for the precondition commit's run against the
// UNCHANGED walker and were removed with the interface they bridged: the
// walker now consumes exclusively the caller-scoped From surface above. The
// shared hint survives as the `active` field, which tests WRITE directly to
// model a sibling's shared-path success re-pinning it (the R3 schedule) —
// nothing in the From methods can touch it, which is itself the contract
// under test.
