package chain

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// defaultAttemptTimeout bounds a single RPC attempt against one endpoint so a
// hung endpoint rotates to the next instead of stalling the walker forever.
const defaultAttemptTimeout = 30 * time.Second

type rpcClient interface {
	BlockNumber(ctx context.Context) (uint64, error)
	// ReportedHeaderByNumber returns the block's PROVIDER-REPORTED identity —
	// the hash/parentHash/number/timestamp fields of a raw
	// eth_getBlockByNumber(number, false) response, the hash taken verbatim
	// and never locally recomputed (see ReportedHeader's trust posture). A nil
	// number asks for "latest"; a nil header with a nil error means the
	// endpoint does not have the block.
	//
	// This interface deliberately carries NO method returning *types.Header:
	// a header this package cannot see is a header it cannot re-hash, so the
	// wave-5 principle — the chain layer never locally recomputes a header
	// hash — holds structurally, not by convention (the same argument
	// prices.PollChain makes by not carrying CallAtFrom).
	ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error)
	FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error)
	ChainID(ctx context.Context) (*big.Int, error)
	TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error)
	CallContract(ctx context.Context, msg ethereum.CallMsg, blockNumber *big.Int) ([]byte, error)
	// CallContractAtHash is the EIP-1898 form of CallContract: the call executes
	// against the state of the block with EXACTLY this hash, or the node rejects
	// the request ("block not found" class) — it can never be silently served
	// from a different block that happens to share the height.
	CallContractAtHash(ctx context.Context, msg ethereum.CallMsg, blockHash common.Hash) ([]byte, error)
}

// ReportedHeader is a block's identity AS THE PROVIDER REPORTS IT: the hash,
// parentHash, number and timestamp fields of the raw eth_getBlockByNumber
// response, verbatim. Every hash this package hands out comes from here.
//
// TRUST POSTURE (Task 9 wave 5; forensic proof committed at
// .superpowers/sdd/r001-probe/hashcheck.go). The previous acquisition —
// ethclient.HeaderByNumber + types.Header.Hash(), i.e. keccak over the
// re-RLP-encoded KNOWN fields — was a FALSE guarantee: go-ethereum v1.13.0
// cannot represent the 2026 OP-mainnet header shape, so its recomputation is
// silently non-canonical for every modern OP block (computed 0x70f6bea2…
// where the canonical hash of OP block 150,105,227 is 0x3d957321…; MATCH
// false, live-proven). Local recomputation is not a stronger claim than the
// provider's word — L2 consensus is NOT locally verifiable from header bytes
// — and pretending otherwise broke exactly the cross-checks it was supposed
// to strengthen. Reported hashes keep every one of those checks meaningful on
// its honest terms:
//
//   - reorg detection compares reported-now against reported-then;
//   - the walker's tip-log equality compares two provider-internal values;
//   - the EIP-1898 pin round-trips the same identity back to the node, which
//     either recognizes its own hash or rejects — a recomputed hash no node
//     ever issued is rejected FOREVER.
//
// The refusals stay, and since Task 9 wave 6 (Codex round 5) the decode is
// PRESENCE-TRACKED: every field is a pointer precisely so an omitted JSON
// field decodes as nil instead of as a plausible zero value. The previous
// non-pointer Time turned an omitted timestamp into a Unix-epoch head — a
// malformed primary could freeze failover with a false stale verdict instead
// of rotating to a healthy secondary (the F2 defect; the old types.Header
// decoder rejected a missing timestamp, and swapping in a minimal decoder
// silently dropped that gate). A mined block whose response omits hash,
// parentHash, number or timestamp — or reports a zero hash — is a provider
// protocol violation (validateReportedHeader), refused before the value can
// reach any consumer.
type ReportedHeader struct {
	Hash       *common.Hash    `json:"hash"`
	ParentHash *common.Hash    `json:"parentHash"`
	Number     *hexutil.Big    `json:"number"`
	Time       *hexutil.Uint64 `json:"timestamp"`
}

// validateReportedHeader is the protocol gate every header read passes
// through, and THE RULE lives here (Task 9 wave 6, Codex round 5): trusting
// the provider's REPORTED fields is only sound when paired with verifying the
// response ANSWERS THE QUESTION ASKED. Concretely:
//
//   - a nil header is an honest "not found" — the legitimate answer for a
//     block beyond the endpoint's head. It surfaces AS not-found: it is NOT a
//     protocol violation, and it is never fabricated into a zero header.
//   - a PRESENT block must carry every required field: hash, parentHash,
//     number, timestamp. The struct's fields are pointers so absence is
//     decodable (F2): an omitted timestamp is a protocol violation, not a
//     Unix-epoch head that stops failover at a malformed primary.
//   - a reported ZERO hash stays refused (the wave-5 gate): an anchor holding
//     it would "verify" against nothing during reorg repair.
//   - the number must be a uint64, and on every NUMBERED read (want non-nil)
//     it must EQUAL the height the caller asked for (F1). A well-formed
//     header for the WRONG height — a proxy answering "latest" for numeric
//     requests — would date HeaderTime's freshness measurement off the wrong
//     block and feed walker ancestry a hash for a block nobody asked about
//     (spurious mass rewind instead of rotation). Head reads (want nil)
//     validate internal consistency only: "latest" pins no height, so there
//     is no asked question to compare against.
//
// Any violation FAILS THE ATTEMPT: the failover walk rotates to the next
// endpoint, exactly the zero-hash posture, uniformly applied — nothing in a
// protocol-violating response is trustworthy, so no field of it may influence
// any consumer.
func validateReportedHeader(rh *ReportedHeader, what string, want *uint64) error {
	if rh == nil {
		return fmt.Errorf("header %s not found", what)
	}
	var missing []string
	if rh.Hash == nil {
		missing = append(missing, "hash")
	}
	if rh.ParentHash == nil {
		missing = append(missing, "parentHash")
	}
	if rh.Number == nil {
		missing = append(missing, "number")
	}
	if rh.Time == nil {
		missing = append(missing, "timestamp")
	}
	if len(missing) > 0 {
		return fmt.Errorf("header %s response omits required field(s) %s — a provider protocol violation; an absent field must surface as absent, never decode as a plausible zero value", what, strings.Join(missing, ", "))
	}
	if *rh.Hash == (common.Hash{}) {
		return fmt.Errorf("header %s reports a zero hash — a provider protocol violation; refusing to hand out an unverifiable block identity", what)
	}
	if !(*big.Int)(rh.Number).IsUint64() {
		return fmt.Errorf("header %s reports number %v, not a uint64", what, rh.Number)
	}
	if want != nil && (*big.Int)(rh.Number).Uint64() != *want {
		return fmt.Errorf("header %s response answers for height %d — a provider protocol violation; a numbered read serves exactly the block asked for or fails the attempt", what, (*big.Int)(rh.Number).Uint64())
	}
	return nil
}

// endpointClient is one endpoint's rpcClient: go-ethereum's typed client for
// every call that consumes decoded VALUES, plus the raw connection for the
// one read the typed client cannot be trusted with — a header's identity.
// ethclient.HeaderByNumber decodes into types.Header and DERIVES the hash by
// re-RLP-hashing the fields it knows, which is silently non-canonical on any
// chain whose header shape is newer than the vendored geth (the live-proven
// OP case; see ReportedHeader). The raw response's own hash field is the only
// honest source, so header identity reads go through the raw client.
type endpointClient struct {
	*ethclient.Client
	raw *rpc.Client
}

func (e *endpointClient) ReportedHeaderByNumber(ctx context.Context, number *big.Int) (*ReportedHeader, error) {
	arg := "latest"
	if number != nil {
		arg = hexutil.EncodeBig(number)
	}
	var rh *ReportedHeader
	if err := e.raw.CallContext(ctx, &rh, "eth_getBlockByNumber", arg, false); err != nil {
		return nil, err
	}
	return rh, nil // nil (not found) when the endpoint answered null
}

// EndpointToken identifies which endpoint served a successful semantic-layer
// call (CallWithToken / CallFrom). A caller that later judges that response
// semantically unusable (e.g. an endpoint frozen on stale chain state, which
// never fails at the RPC layer and so never trips error-driven rotation)
// routes ITSELF around that exact endpoint on subsequent calls — CallFrom
// starting one past Token.Index — a caller-scoped exclusion that leaves the
// shared routing hint alone.
type EndpointToken struct {
	// Index is the position of the serving endpoint in the failover's client
	// list; -1 when the call failed on every endpoint (nothing to reject).
	Index int
}

type Failover struct {
	clients []rpcClient
	mu      sync.Mutex
	// active is a routing hint, not a health registry: it always names the
	// endpoint that most recently succeeded on the SHARED path (do). Under
	// concurrent callers the last writer wins, which is safe — every
	// candidate value refers to an endpoint that just served a successful
	// call. Callers holding a SEMANTIC exclusion (a "successful" response
	// judged unusable, e.g. an endpoint frozen on stale chain state, which
	// never fails at the RPC layer and so never trips do's error-driven
	// rotation) deliberately do NOT write this hint: they route themselves
	// around the bad endpoint with CallFrom, which neither reads nor writes
	// active. A shared hint cannot carry a caller-specific exclusion — any
	// other caller's success on the excluded endpoint would legitimately
	// re-pin the hint right back onto it.
	active int
	// attemptTimeout bounds each per-endpoint attempt inside doFrom.
	attemptTimeout time.Duration
}

func Dial(ctx context.Context, urls []string) (*Failover, error) {
	if len(urls) == 0 {
		return nil, fmt.Errorf("no rpc urls given")
	}
	clients := make([]rpcClient, 0, len(urls))
	for _, u := range urls {
		// Dial the RAW connection and wrap the typed client around it: the
		// typed client serves the value-decoding calls, and the raw handle
		// serves ReportedHeaderByNumber, whose whole point is to bypass the
		// typed client's hash recomputation (see endpointClient).
		rc, err := rpc.DialContext(ctx, u)
		if err != nil {
			return nil, fmt.Errorf("dial %s: %w", u, err)
		}
		clients = append(clients, &endpointClient{Client: ethclient.NewClient(rc), raw: rc})
	}
	return newFailover(clients), nil
}

func newFailover(clients []rpcClient) *Failover {
	return &Failover{clients: clients, attemptTimeout: defaultAttemptTimeout}
}

// do walks the endpoints starting from the sticky active hint and, on
// success, re-pins the hint onto the endpoint that served the attempt —
// SHARED-path routing, moved only by observed successes and failures (see
// doFrom for the walk itself). Semantic-layer callers with an endpoint
// exclusion use CallFrom instead, which bypasses this hint entirely.
func (f *Failover) do(ctx context.Context, op string, fn func(ctx context.Context, c rpcClient) error) (int, error) {
	f.mu.Lock()
	start := f.active
	f.mu.Unlock()

	idx, err := f.doFrom(ctx, op, start, fn)
	if err != nil {
		return idx, err
	}
	f.mu.Lock()
	f.active = idx
	f.mu.Unlock()
	return idx, nil
}

// doFrom walks the endpoints starting at start, rotating on error, and
// returns the index of the endpoint that served the successful attempt (-1
// when all failed). Each attempt is bounded by attemptTimeout so a hung
// endpoint fails its attempt and rotates instead of blocking on the caller's
// (possibly unbounded) context. doFrom itself NEVER touches the shared
// active hint: do layers the sticky re-pin on top for shared-path callers,
// while CallFrom deliberately does not — a caller-scoped routing preference
// must not fight the error-driven routing other callers depend on.
func (f *Failover) doFrom(ctx context.Context, op string, start int, fn func(ctx context.Context, c rpcClient) error) (int, error) {
	var lastErr error
	for i := 0; i < len(f.clients); i++ {
		if err := ctx.Err(); err != nil {
			return -1, fmt.Errorf("%s aborted: %w", op, err)
		}
		idx := (start + i) % len(f.clients)
		attemptCtx, cancel := context.WithTimeout(ctx, f.attemptTimeout)
		err := fn(attemptCtx, f.clients[idx])
		cancel()
		if err != nil {
			lastErr = err
			slog.Warn("rpc endpoint failed, rotating", "op", op, "endpoint", idx, "err", err)
			continue
		}
		return idx, nil
	}
	return -1, fmt.Errorf("all rpc endpoints failed (%s): %w", op, lastErr)
}

// AttemptError is ONE endpoint's own failure inside the pinned-call walk
// (CallAtHashFrom), named by the endpoint that produced it — the token
// discipline mirrored onto failures: EndpointToken names the endpoint that
// served a success, and an attempt record names the endpoint that produced
// each failure, so a caller judging the walk's OUTCOME can see what every
// attempted endpoint said instead of only what the last one said.
type AttemptError struct {
	// Endpoint is the failing endpoint's position in the failover's client
	// list — the index the EndpointToken would have carried had this attempt
	// succeeded.
	Endpoint int
	// Err is that endpoint's own error, verbatim and unwrapped: recognizing
	// a rejection class in it is the caller's per-attempt judgment to make.
	Err error
}

// PinnedCallError is the PINNED-CALL path's total-failure error: every
// attempted endpoint failed, and every per-attempt outcome is RETAINED in
// walk order. Additive for Task 9 wave 4 (Codex round 3 [medium]): doFrom
// keeps only the LAST endpoint's error, which made the price poller's
// round-outcome classification depend on failover ORDER — endpoint 0
// transport-failing while endpoint 1 rejects the pin read as a discard when
// the walk started at 0 and as an error when it started at 1, for the same
// persistent outage. The aggregate is what lets the caller hold ONE
// classification authority per outcome: a posture computed over EVERY
// attempt, never over whichever attempt happened to run last.
//
// Error() and Unwrap() deliberately mirror doFrom's total-failure shape —
// "all rpc endpoints failed (op): <last error>", unwrapping to the last
// attempt's error — so surfaced wording and errors.Is/As chains over the
// last error are unchanged for every existing consumer.
type PinnedCallError struct {
	// Op names the failed operation, doFrom's wording ("callAtHash").
	Op string
	// Attempts holds every attempted endpoint's own failure, in walk order.
	// Never empty: the walk constructs this error only after at least one
	// attempt failed (a pre-attempt context abort returns a plain error).
	Attempts []AttemptError
}

func (e *PinnedCallError) Error() string {
	return fmt.Sprintf("all rpc endpoints failed (%s): %v", e.Op, e.last())
}

// Unwrap exposes the LAST attempt's error — doFrom's %w target — so existing
// matching against the surfaced error keeps working unchanged.
func (e *PinnedCallError) Unwrap() error { return e.last() }

func (e *PinnedCallError) last() error {
	if len(e.Attempts) == 0 {
		return nil
	}
	return e.Attempts[len(e.Attempts)-1].Err
}

// doFromAttempts is doFrom's exact walk with the per-attempt failures
// RETAINED: the same rotation, the same per-attempt timeout, the same
// abort-on-context behavior — but a total failure returns a *PinnedCallError
// carrying every attempted endpoint's own error instead of only the last
// one. It exists for the PINNED-CALL path alone (CallAtHashFrom, Task 9
// wave 4's sanctioned additive change); every other method keeps doFrom, so
// no other caller's error shape moves.
func (f *Failover) doFromAttempts(ctx context.Context, op string, start int, fn func(ctx context.Context, c rpcClient) error) (int, error) {
	var attempts []AttemptError
	for i := 0; i < len(f.clients); i++ {
		if err := ctx.Err(); err != nil {
			return -1, fmt.Errorf("%s aborted: %w", op, err)
		}
		idx := (start + i) % len(f.clients)
		attemptCtx, cancel := context.WithTimeout(ctx, f.attemptTimeout)
		err := fn(attemptCtx, f.clients[idx])
		cancel()
		if err != nil {
			attempts = append(attempts, AttemptError{Endpoint: idx, Err: err})
			slog.Warn("rpc endpoint failed, rotating", "op", op, "endpoint", idx, "err", err)
			continue
		}
		return idx, nil
	}
	return -1, &PinnedCallError{Op: op, Attempts: attempts}
}

// NOTE: RotateAwayFrom (the shared-hint semantic rotation) and its rotation
// revision counter were retired in fix wave 6, superseded by CallFrom's
// caller-scoped routing: a shared-hint rotation could not survive an
// interleaved shared-path success on the rejected endpoint (e.g. the
// walker's BlockNumber succeeding on an endpoint whose eth_call state is
// frozen), which legitimately re-pinned the hint and bounced the semantic
// caller straight back — forever. The exclusion now lives with the caller.

// EndpointCount reports how many RPC endpoints this Failover rotates across.
func (f *Failover) EndpointCount() int {
	return len(f.clients)
}

// VerifyChainID queries every endpoint and errors unless all report want.
// Unlike do, this is not failover semantics: each endpoint is checked
// individually, because a single misconfigured endpoint would silently feed
// wrong-chain data whenever rotation lands on it.
func (f *Failover) VerifyChainID(ctx context.Context, want uint64) error {
	for i, c := range f.clients {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		got, err := c.ChainID(attemptCtx)
		cancel()
		if err != nil {
			return fmt.Errorf("chain id check failed on endpoint %d: %w", i, err)
		}
		if !got.IsUint64() || got.Uint64() != want {
			return fmt.Errorf("endpoint %d reports chain id %s, want %d", i, got, want)
		}
	}
	return nil
}

func (f *Failover) BlockNumber(ctx context.Context) (uint64, error) {
	var out uint64
	_, err := f.do(ctx, "blockNumber", func(ctx context.Context, c rpcClient) error {
		v, err := c.BlockNumber(ctx)
		out = v
		return err
	})
	return out, err
}

// HeaderHash returns the PROVIDER-REPORTED hash of block n, under ordinary
// shared-path failover. The value is the raw response's own hash field —
// never a local types.Header.Hash() recomputation, which is silently
// non-canonical for chains whose header shape postdates the vendored geth
// (see ReportedHeader's trust posture; live-proven on OP mainnet at block
// 150,105,227).
func (f *Failover) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	var out common.Hash
	_, err := f.do(ctx, "headerHash", func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n), &n); err != nil {
			return err
		}
		out = *rh.Hash
		return nil
	})
	return out, err
}

// HeaderTime returns the header TIMESTAMP (unix seconds) of block n, under
// ordinary shared-path failover.
//
// It exists because a block DISTANCE is not an elapsed time. The daemon's
// liquidation-facing freshness requirement is stated in time, and converting it
// through a nominal block cadence (12s slots, 2s OP blocks) is a unit-conversion
// fallacy: missed slots or degraded production make the same block count span
// materially longer, so a distance gate can read green while the state served is
// hours old. Measuring `now - ts(cursor block)` gates the property directly, and
// the only place that timestamp exists is the header.
//
// It deliberately uses the SHARED path (do), not a caller-scoped walk: the
// measurement is not a liveness probe that has to route around ingestion's
// endpoint, and sharing the sticky hint means it rides the endpoint ingestion is
// already using rather than warming a second one.
// HeaderTime returns the header TIMESTAMP (unix seconds) of block n, under
// ordinary shared-path failover.
//
// It exists because a block DISTANCE is not an elapsed time. The daemon's
// liquidation-facing freshness requirement is stated in time, and converting it
// through a nominal block cadence (12s slots, 2s OP blocks) is a unit-conversion
// fallacy: missed slots or degraded production make the same block count span
// materially longer, so a distance gate can read green while the state served is
// hours old. Measuring `now - ts(cursor block)` gates the property directly, and
// the only place that timestamp exists is the header.
//
// It deliberately uses the SHARED path (do), not a caller-scoped walk: the
// measurement is not a liveness probe that has to route around ingestion's
// endpoint, and sharing the sticky hint means it rides the endpoint ingestion is
// already using rather than warming a second one.
//
// Since Task 9 wave 5 it shares the REPORTED-header fetch. Its field use was
// never wrong — the timestamp always came decoded from the provider's own
// response, untouched by the hash-recomputation defect — but one fetch path
// means one protocol gate: a response malformed enough to fail
// validateReportedHeader is not trusted for its timestamp either.
func (f *Failover) HeaderTime(ctx context.Context, n uint64) (uint64, error) {
	var out uint64
	_, err := f.do(ctx, "headerTime", func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n), &n); err != nil {
			return err
		}
		out = uint64(*rh.Time)
		return nil
	})
	return out, err
}

// Head is a chain head observation: the height, the header's own TIMESTAMP and
// its hash. The timestamp is the part that makes a head observation
// falsifiable — a node frozen on old state still answers eth_blockNumber with a
// plausible-looking height, but it cannot make that block's header claim to be
// recent. A caller judging "is this node actually at a live head" must look at
// Time, not only at Number. Hash is the PROVIDER-REPORTED hash of the head
// block (Task 9 wave 5; see ReportedHeader) — never a local recomputation.
type Head struct {
	Number uint64
	Time   uint64
	Hash   common.Hash
}

// HeadFrom reads the latest header with a CALLER-SCOPED starting endpoint, the
// same routing discipline as CallFrom: the attempt walk starts at startIndex
// (mod the endpoint count) rather than at the shared sticky hint, and success
// neither reads nor writes that hint. It exists so a caller can probe the head
// through an endpoint OTHER than the one ingestion is currently pinned to: a
// liveness probe that shares its dependency with the pipeline it is supposed to
// be judging cannot distinguish "the feeds stopped publishing" from "our RPC
// froze".
//
// With a single configured endpoint there is nothing to route around and the
// probe is NOT independent; callers that rely on independence must say so and
// carry another guard (see internal/prices' verdict TTL).
// HeadFrom reads the latest header with a CALLER-SCOPED starting endpoint, the
// same routing discipline as CallFrom: the attempt walk starts at startIndex
// (mod the endpoint count) rather than at the shared sticky hint, and success
// neither reads nor writes that hint. It exists so a caller can probe the head
// through an endpoint OTHER than the one ingestion is currently pinned to: a
// liveness probe that shares its dependency with the pipeline it is supposed to
// be judging cannot distinguish "the feeds stopped publishing" from "our RPC
// froze".
//
// The returned Head's hash is the PROVIDER-REPORTED hash of the latest block
// (see ReportedHeader), which is what makes it usable as a pin: the EIP-1898
// round presents it back to the node that issued it.
//
// With a single configured endpoint there is nothing to route around and the
// probe is NOT independent; callers that rely on independence must say so and
// carry another guard (see internal/prices' verdict TTL).
func (f *Failover) HeadFrom(ctx context.Context, startIndex int) (Head, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out Head
	idx, err := f.doFrom(ctx, "head", start, func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, nil)
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, "latest", nil); err != nil {
			return err
		}
		out = Head{Number: (*big.Int)(rh.Number).Uint64(), Time: uint64(*rh.Time), Hash: *rh.Hash}
		return nil
	})
	if err != nil {
		return Head{}, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// ActiveEndpoint reports the SHARED routing hint's current index — the endpoint
// that most recently served a shared-path call, which is the one ingestion is
// effectively pinned to. It is exposed so a semantic caller can deliberately
// route AROUND it (HeadFrom(active+1)) instead of unknowingly sharing it. It is
// a hint, not a health verdict: by the time a caller acts on it another call may
// have moved it, which is harmless — the point is only to prefer a different
// endpoint, not to guarantee one.
func (f *Failover) ActiveEndpoint() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.active
}

// HeaderHashFrom is HeaderHash with a CALLER-SCOPED starting endpoint (see
// CallFrom for why the shared hint stays out of it) and an EndpointToken naming
// the endpoint that answered. Callers use it to re-verify a hash they recorded
// earlier against the live chain — the check that turns "the chain may have
// reorged under this row" from an assumption into a decidable question.
// HeaderHashFrom is HeaderHash with a CALLER-SCOPED starting endpoint (see
// CallFrom for why the shared hint stays out of it) and an EndpointToken naming
// the endpoint that answered. Callers use it to re-verify a hash they recorded
// earlier against the live chain — the check that turns "the chain may have
// reorged under this row" from an assumption into a decidable question. Both
// sides of that comparison are PROVIDER-REPORTED values (see ReportedHeader):
// reported-then against reported-now is the only form of the question an L2
// client can honestly decide.
func (f *Failover) HeaderHashFrom(ctx context.Context, startIndex int, n uint64) (common.Hash, EndpointToken, error) {
	count := len(f.clients)
	start := ((startIndex % count) + count) % count
	var out common.Hash
	idx, err := f.doFrom(ctx, "headerHash", start, func(ctx context.Context, c rpcClient) error {
		rh, err := c.ReportedHeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if err := validateReportedHeader(rh, fmt.Sprintf("%d", n), &n); err != nil {
			return err
		}
		out = *rh.Hash
		return nil
	})
	if err != nil {
		return common.Hash{}, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// TxCalldata returns the raw input data (selector included) of the
// transaction with hash txHash. Additive method for the debt_manager
// deriver's migration-genesis path (Phase 2 Task 5): the 7,337 migrated
// borrower seeds live in the 80 migration txs' calldata, not in any log
// (recon/derivation-notes.md "Migration finding").
func (f *Failover) TxCalldata(ctx context.Context, txHash common.Hash) ([]byte, error) {
	var out []byte
	_, err := f.do(ctx, "txCalldata", func(ctx context.Context, c rpcClient) error {
		tx, _, err := c.TransactionByHash(ctx, txHash)
		if err != nil {
			return err
		}
		if tx == nil {
			return fmt.Errorf("transaction %s not found", txHash)
		}
		out = tx.Data()
		return nil
	})
	return out, err
}

// Call executes a read-only eth_call against `to` with calldata data at the
// LATEST block, under failover rotation. Additive method for the Phase 2
// snapshotter (Task 7): batched multicall3 reads of Debt Manager
// collateralOf views — OP collateral is not event-derivable (recon caveat 4),
// so its only honest source is a live view sweep.
func (f *Failover) Call(ctx context.Context, to common.Address, data []byte) ([]byte, error) {
	out, _, err := f.CallWithToken(ctx, to, data)
	return out, err
}

// CallWithToken is Call plus an EndpointToken naming the endpoint that served
// the response. Semantic-layer callers (the snapshotter) keep the token so
// that a response later judged semantically stale can be routed around
// EXACTLY the endpoint that produced it (CallFrom starting past the token's
// index), not around whatever endpoint happens to be active by the time the
// judgment lands.
func (f *Failover) CallWithToken(ctx context.Context, to common.Address, data []byte) ([]byte, EndpointToken, error) {
	var out []byte
	idx, err := f.do(ctx, "call", func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// CallFrom is CallWithToken with a CALLER-SCOPED starting endpoint: the
// attempt walk starts at startIndex (mod the endpoint count) instead of the
// shared sticky active hint, and a success neither reads nor writes that
// hint. This is the semantic-failover entry: a caller that judged an
// endpoint's well-formed responses unusable (stale chain state — invisible
// to error-driven rotation, since the RPC calls succeed) owns a persistent
// preference of its own and starts every retry past the rejected endpoint.
// The shared hint deliberately stays out of it: semantic callers must not
// fight error-driven routing — any other caller's success on the rejected
// endpoint would legitimately re-pin the shared hint there, and a shared-
// hint-driven exclusion would bounce straight back to the bad endpoint.
// Error-driven rotation WITHIN this call's own attempt walk still applies.
func (f *Failover) CallFrom(ctx context.Context, startIndex int, to common.Address, data []byte) ([]byte, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out []byte
	idx, err := f.doFrom(ctx, "call", start, func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// CallAtFrom is CallFrom PINNED AT A BLOCK NUMBER: the eth_call executes
// against the state of block `block` rather than "latest", with the same
// caller-scoped routing and token discipline (the attempt walk starts at
// startIndex, success neither reads nor writes the shared hint, and the token
// names the endpoint that answered). Added for the price poller's
// endpoint-coherent rounds (Task 9 wave 1); RETIRED FROM THE POLLER in wave 2
// (Codex round 1 [medium]): a NUMBER names a height on whatever fork the
// serving node is on, not a block — one load-balanced hostname is many nodes,
// so headers from fork A and a number-pinned call served by fork B at the
// same height pass every height check. prices.PollChain deliberately does not
// carry this method; a caller that needs execution bound to a block's
// IDENTITY must use CallAtHashFrom.
//
// The pin is a REQUEST, not a proof: a provider that silently serves other
// state still reports the execution block inside responses that carry one
// (multicall3's blockNumber output), and callers that depend on the pin must
// check it there.
func (f *Failover) CallAtFrom(ctx context.Context, startIndex int, to common.Address, data []byte, block uint64) ([]byte, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out []byte
	idx, err := f.doFrom(ctx, "callAt", start, func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, new(big.Int).SetUint64(block))
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

// CallAtHashFrom is CallFrom PINNED AT A BLOCK HASH — the EIP-1898 block-hash
// object form of eth_call, with CallFrom's exact caller-scoped routing and
// token discipline (the attempt walk starts at startIndex, success neither
// reads nor writes the shared hint, and the token names the endpoint that
// answered). Additive for the price poller's rounds (Task 9 wave 2, Codex
// round 1 [medium]): a number pin binds a HEIGHT, which every fork has one
// of, while the hash pin binds the block's IDENTITY — the node either
// executes against exactly the block the caller verified or rejects the
// request outright, so state from a same-height fork can never be served
// under this pin.
//
// requireCanonical is left at its EIP-1898 default (false): the pin's job is
// IDENTITY, and detecting that the pinned block later stopped being canonical
// stays the anchor machinery's job (the poller's closing re-read, the next
// round's anchor-divergence check, reorg repair).
//
// The honest trust boundary is the NODE'S IMPLEMENTATION of the pin — a
// dishonest node could claim execution at a hash while serving other state,
// the same trust class every read here carries. The observed behavior class
// (live matrix, 2026-07-26, all four production endpoints across both
// chains): the hash-pinned call executed exactly at the pinned block, and a
// fabricated hash was REJECTED with "block not found" everywhere — negative
// controls included. Callers treat that rejection class as "the serving node
// does not have this block" (exploration-worthy), not as a transport fault.
//
// TOTAL FAILURE RETAINS EVERY PER-ATTEMPT OUTCOME (Task 9 wave 4, Codex
// round 3 [medium]): the walk runs through doFromAttempts, so when every
// endpoint fails the returned error is a *PinnedCallError carrying each
// attempted endpoint's own error in walk order. The surfaced wording and
// the unwrap target (the last attempt's error) are unchanged; what is new
// is that a caller classifying the OUTCOME can require unanimity across
// attempts instead of trusting whichever error the rotation happened to
// leave last. The aggregate is the pinned-call path's alone — every other
// method keeps doFrom's last-error shape.
func (f *Failover) CallAtHashFrom(ctx context.Context, startIndex int, to common.Address, data []byte, blockHash common.Hash) ([]byte, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out []byte
	idx, err := f.doFromAttempts(ctx, "callAtHash", start, func(ctx context.Context, c rpcClient) error {
		res, err := c.CallContractAtHash(ctx, ethereum.CallMsg{To: &to, Data: data}, blockHash)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		return nil, EndpointToken{Index: -1}, err
	}
	return out, EndpointToken{Index: idx}, nil
}

func (f *Failover) Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error) {
	var out []types.Log
	_, err := f.do(ctx, "getLogs", func(ctx context.Context, c rpcClient) error {
		logs, err := c.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(from),
			ToBlock:   new(big.Int).SetUint64(to),
			Addresses: addrs,
		})
		out = logs
		return err
	})
	return out, err
}
