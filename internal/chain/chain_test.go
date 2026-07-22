package chain

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

type fakeRPC struct {
	name     string
	fail     bool
	calls    int
	blockNum uint64
}

func (f *fakeRPC) BlockNumber(ctx context.Context) (uint64, error) {
	f.calls++
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
