package chain

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

type fakeRPC struct {
	name     string
	fail     bool
	hang     bool // block on ctx.Done() to simulate a hung endpoint
	calls    int
	blockNum uint64
	chainID  uint64
}

func (f *fakeRPC) BlockNumber(ctx context.Context) (uint64, error) {
	f.calls++
	if f.hang {
		<-ctx.Done()
		return 0, ctx.Err()
	}
	if f.fail {
		return 0, errors.New(f.name + " down")
	}
	return f.blockNum, nil
}

func (f *fakeRPC) HeaderByNumber(ctx context.Context, n *big.Int) (*types.Header, error) {
	f.calls++
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	return &types.Header{Number: n}, nil
}

func (f *fakeRPC) FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	f.calls++
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	return []types.Log{}, nil
}

func (f *fakeRPC) ChainID(ctx context.Context) (*big.Int, error) {
	f.calls++
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	return new(big.Int).SetUint64(f.chainID), nil
}

func TestFailoverRotatesOnError(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", blockNum: 42}
	f := newFailover([]rpcClient{a, b})

	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(42), n)

	// second call goes straight to b (sticky active endpoint)
	_, err = f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, a.calls)
	require.Equal(t, 2, b.calls)
}

func TestFailoverErrorsWhenAllFail(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", fail: true}
	f := newFailover([]rpcClient{a, b})

	_, err := f.BlockNumber(context.Background())
	require.ErrorContains(t, err, "all rpc endpoints failed")
}

func TestDoStopsWhenContextCancelled(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", blockNum: 42}
	f := newFailover([]rpcClient{a, b})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := f.BlockNumber(ctx)
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 0, a.calls)
	require.Equal(t, 0, b.calls)
}

// A hung endpoint (never returns, never errors) must not stall the walker:
// the per-attempt timeout fails the attempt and rotation reaches the healthy
// endpoint.
func TestSlowEndpointRotatesAfterTimeout(t *testing.T) {
	a := &fakeRPC{name: "a", hang: true}
	b := &fakeRPC{name: "b", blockNum: 42}
	f := newFailover([]rpcClient{a, b})
	f.attemptTimeout = 20 * time.Millisecond

	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(42), n)
	require.Equal(t, 1, a.calls)
	require.Equal(t, 1, b.calls)
}

func TestVerifyChainIDAcceptsMatching(t *testing.T) {
	a := &fakeRPC{name: "a", chainID: 10}
	b := &fakeRPC{name: "b", chainID: 10}
	f := newFailover([]rpcClient{a, b})

	require.NoError(t, f.VerifyChainID(context.Background(), 10))
	require.Equal(t, 1, a.calls) // every endpoint checked, not just active
	require.Equal(t, 1, b.calls)
}

func TestVerifyChainIDRejectsMismatch(t *testing.T) {
	a := &fakeRPC{name: "a", chainID: 10}
	b := &fakeRPC{name: "b", chainID: 1} // misconfigured: wrong network
	f := newFailover([]rpcClient{a, b})

	err := f.VerifyChainID(context.Background(), 10)
	require.ErrorContains(t, err, "endpoint 1")
	require.ErrorContains(t, err, "chain id 1, want 10")
}

func TestVerifyChainIDErrorsWhenEndpointDown(t *testing.T) {
	a := &fakeRPC{name: "a", chainID: 10}
	b := &fakeRPC{name: "b", fail: true}
	f := newFailover([]rpcClient{a, b})

	err := f.VerifyChainID(context.Background(), 10)
	require.ErrorContains(t, err, "endpoint 1")
	require.ErrorContains(t, err, "b down")
}
