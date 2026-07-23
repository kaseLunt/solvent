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
// call (CallWithToken). A caller that later judges that response semantically
// unusable hands the token back to RotateAwayFrom, which rotates ONLY if that
// exact endpoint is still the sticky active one — an endpoint-bound rejection
// instead of a blind "advance whatever happens to be active by now".
type EndpointToken struct {
	// Index is the position of the serving endpoint in the failover's client
	// list; -1 when the call failed on every endpoint (nothing to reject).
	Index int
}

type Failover struct {
	clients []rpcClient
	mu      sync.Mutex
	// active is a routing hint, not a health registry: it always names the
	// endpoint that most recently succeeded. Under concurrent callers the
	// last writer wins, which is safe — every candidate value refers to an
	// endpoint that just served a successful call. The one deliberate
	// exception is a SEMANTIC rotation (RotateAwayFrom): a caller that
	// discovers a "successful" response was semantically unusable (e.g. an
	// endpoint frozen on stale chain state, which never fails at the RPC
	// layer and so never trips do's own error-driven rotation) forces active
	// past that endpoint. Semantic rotations LINEARIZE against in-flight
	// calls through the rotation revision counter below: each rotation bumps
	// it, and do's sticky active-write on success is conditional on the
	// revision it started under — a call begun before the rotation still
	// returns its result, but can no longer pin active back onto the
	// rejected endpoint.
	active int
	// rotation is the semantic-rotation revision counter guarding active
	// (see above). Incremented by RotateAwayFrom, under mu with active.
	rotation uint64
	// attemptTimeout bounds each per-endpoint attempt inside do.
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

// do walks the endpoints starting from the sticky active one and returns the
// index of the endpoint that served the successful attempt (-1 when all
// failed). The sticky active-write on success is guarded by the semantic-
// rotation revision: if a RotateAwayFrom landed while this call was in
// flight, the write is skipped — the rotation's routing decision wins over
// the interleaved completion, which at worst forfeits a harmless routing-hint
// update. (Error-driven rotation inside the loop is unaffected: it is
// positional within this call's own attempt sequence.)
func (f *Failover) do(ctx context.Context, op string, fn func(ctx context.Context, c rpcClient) error) (int, error) {
	f.mu.Lock()
	start := f.active
	startRotation := f.rotation
	f.mu.Unlock()

	var lastErr error
	for i := 0; i < len(f.clients); i++ {
		if err := ctx.Err(); err != nil {
			return -1, fmt.Errorf("%s aborted: %w", op, err)
		}
		idx := (start + i) % len(f.clients)
		// Per-attempt timeout: a hung endpoint fails this attempt and
		// rotates instead of blocking on the caller's (possibly unbounded)
		// context.
		attemptCtx, cancel := context.WithTimeout(ctx, f.attemptTimeout)
		err := fn(attemptCtx, f.clients[idx])
		cancel()
		if err != nil {
			lastErr = err
			slog.Warn("rpc endpoint failed, rotating", "op", op, "endpoint", idx, "err", err)
			continue
		}
		f.mu.Lock()
		if f.rotation == startRotation {
			f.active = idx
		}
		f.mu.Unlock()
		return idx, nil
	}
	return -1, fmt.Errorf("all rpc endpoints failed (%s): %w", op, lastErr)
}

// RotateAwayFrom advances the sticky active endpoint past the endpoint named
// by tok, under the mutex. It is for SEMANTIC failures — a response that is
// well-formed at the RPC layer but unusable by the caller (e.g. an endpoint
// serving stale chain state) — where the eth_call itself succeeded, so do's
// error-driven rotation never sees a problem and would keep re-serving the
// same endpoint forever. Complements error-driven rotation, which cannot see
// semantic staleness — only the caller who interpreted the response can.
//
// The rotation is ENDPOINT-BOUND: active advances (mod the endpoint count)
// only if the rejected endpoint is still the active one. If an interleaved
// success already moved active elsewhere, advancing blindly would punish an
// unrelated — possibly healthy — endpoint, so active is left alone. The
// revision counter increments UNCONDITIONALLY either way: any in-flight call
// that snapshotted active before this rotation forfeits its sticky
// active-write, which at worst skips an unrelated routing-hint update — the
// next successful call simply rewrites the hint. That asymmetry is the point:
// a semantic rejection must never lose to an in-flight completion racing it.
func (f *Failover) RotateAwayFrom(tok EndpointToken) {
	f.mu.Lock()
	if tok.Index == f.active {
		f.active = (f.active + 1) % len(f.clients)
	}
	f.rotation++
	f.mu.Unlock()
}

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
// that a response later judged semantically stale can be rejected against
// EXACTLY the endpoint that produced it (RotateAwayFrom), not against
// whatever endpoint happens to be active by the time the judgment lands.
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
