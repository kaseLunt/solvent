package chain

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

type rpcClient interface {
	BlockNumber(ctx context.Context) (uint64, error)
	HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error)
	FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error)
}

type Failover struct {
	clients []rpcClient
	mu      sync.Mutex
	// active is a routing hint, not a health registry: it always names the
	// endpoint that most recently succeeded. Under concurrent callers the
	// last writer wins, which is safe — every candidate value refers to an
	// endpoint that just served a successful call.
	active int
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
	return &Failover{clients: clients}
}

func (f *Failover) do(ctx context.Context, op string, fn func(rpcClient) error) error {
	f.mu.Lock()
	start := f.active
	f.mu.Unlock()

	var lastErr error
	for i := 0; i < len(f.clients); i++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("%s aborted: %w", op, err)
		}
		idx := (start + i) % len(f.clients)
		if err := fn(f.clients[idx]); err != nil {
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

func (f *Failover) BlockNumber(ctx context.Context) (uint64, error) {
	var out uint64
	err := f.do(ctx, "blockNumber", func(c rpcClient) error {
		v, err := c.BlockNumber(ctx)
		out = v
		return err
	})
	return out, err
}

func (f *Failover) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	var out common.Hash
	err := f.do(ctx, "headerHash", func(c rpcClient) error {
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
	err := f.do(ctx, "getLogs", func(c rpcClient) error {
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
