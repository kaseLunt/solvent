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
}

type Failover struct {
	clients []rpcClient
	mu      sync.Mutex
	// active is a routing hint, not a health registry: it always names the
	// endpoint that most recently succeeded. Under concurrent callers the
	// last writer wins, which is safe — every candidate value refers to an
	// endpoint that just served a successful call.
	active int
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

func (f *Failover) do(ctx context.Context, op string, fn func(ctx context.Context, c rpcClient) error) error {
	f.mu.Lock()
	start := f.active
	f.mu.Unlock()

	var lastErr error
	for i := 0; i < len(f.clients); i++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("%s aborted: %w", op, err)
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
		f.active = idx
		f.mu.Unlock()
		return nil
	}
	return fmt.Errorf("all rpc endpoints failed (%s): %w", op, lastErr)
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
	err := f.do(ctx, "blockNumber", func(ctx context.Context, c rpcClient) error {
		v, err := c.BlockNumber(ctx)
		out = v
		return err
	})
	return out, err
}

func (f *Failover) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	var out common.Hash
	err := f.do(ctx, "headerHash", func(ctx context.Context, c rpcClient) error {
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

func (f *Failover) Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error) {
	var out []types.Log
	err := f.do(ctx, "getLogs", func(ctx context.Context, c rpcClient) error {
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
