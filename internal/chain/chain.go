package chain

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// defaultAttemptTimeout bounds a single RPC attempt against one endpoint so a
// hung endpoint rotates to the next instead of stalling the walker forever.
const defaultAttemptTimeout = 30 * time.Second

type rpcClient interface {
	BlockNumber(ctx context.Context) (uint64, error)
	HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error)
	FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error)
	ChainID(ctx context.Context) (*big.Int, error)
	TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error)
	CallContract(ctx context.Context, msg ethereum.CallMsg, blockNumber *big.Int) ([]byte, error)
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
		c, err := ethclient.DialContext(ctx, u)
		if err != nil {
			return nil, fmt.Errorf("dial %s: %w", u, err)
		}
		clients = append(clients, c)
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

func (f *Failover) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	var out common.Hash
	_, err := f.do(ctx, "headerHash", func(ctx context.Context, c rpcClient) error {
		h, err := c.HeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if h == nil {
			return fmt.Errorf("header %d not found", n)
		}
		out = h.Hash()
		return nil
	})
	return out, err
}

// Head is a chain head observation: the height, the header's own TIMESTAMP and
// its hash. The timestamp is the part that makes a head observation
// falsifiable — a node frozen on old state still answers eth_blockNumber with a
// plausible-looking height, but it cannot make that block's header claim to be
// recent. A caller judging "is this node actually at a live head" must look at
// Time, not only at Number.
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
func (f *Failover) HeadFrom(ctx context.Context, startIndex int) (Head, EndpointToken, error) {
	n := len(f.clients)
	start := ((startIndex % n) + n) % n // normalize, negatives included
	var out Head
	idx, err := f.doFrom(ctx, "head", start, func(ctx context.Context, c rpcClient) error {
		h, err := c.HeaderByNumber(ctx, nil)
		if err != nil {
			return err
		}
		if h == nil {
			return fmt.Errorf("latest header not found")
		}
		if h.Number == nil || !h.Number.IsUint64() {
			return fmt.Errorf("latest header number %v is not a uint64", h.Number)
		}
		out = Head{Number: h.Number.Uint64(), Time: h.Time, Hash: h.Hash()}
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
func (f *Failover) HeaderHashFrom(ctx context.Context, startIndex int, n uint64) (common.Hash, EndpointToken, error) {
	count := len(f.clients)
	start := ((startIndex % count) + count) % count
	var out common.Hash
	idx, err := f.doFrom(ctx, "headerHash", start, func(ctx context.Context, c rpcClient) error {
		h, err := c.HeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		if h == nil {
			return fmt.Errorf("header %d not found", n)
		}
		out = h.Hash()
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
