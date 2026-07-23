package chain

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

type fakeRPC struct {
	name       string
	fail       bool
	hang       bool // block on ctx.Done() to simulate a hung endpoint
	calls      int
	blockNum   uint64
	chainID    uint64
	txData     []byte
	callResult []byte
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

func (f *fakeRPC) TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error) {
	f.calls++
	if f.fail {
		return nil, false, errors.New(f.name + " down")
	}
	return types.NewTx(&types.LegacyTx{Data: f.txData}), false, nil
}

func (f *fakeRPC) CallContract(ctx context.Context, msg ethereum.CallMsg, blockNumber *big.Int) ([]byte, error) {
	f.calls++
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	return f.callResult, nil
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

// TxCalldata returns the tx's raw input and participates in normal failover
// rotation like every other read.
func TestTxCalldataReturnsInputWithFailover(t *testing.T) {
	input := []byte{0xcf, 0xc3, 0x25, 0x70, 0x01, 0x02}
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", txData: input}
	f := newFailover([]rpcClient{a, b})

	got, err := f.TxCalldata(context.Background(), common.HexToHash("0xf57febcab9e40b18b13fe6e24dc0c846935eed5423b41443dfd287aae582f454"))
	require.NoError(t, err)
	require.Equal(t, input, got)
	require.Equal(t, 1, a.calls)
	require.Equal(t, 1, b.calls)
}

// Call returns the eth_call result and participates in normal failover
// rotation like every other read.
func TestCallReturnsResultWithFailover(t *testing.T) {
	result := []byte{0xde, 0xad, 0xbe, 0xef}
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", callResult: result}
	f := newFailover([]rpcClient{a, b})

	got, err := f.Call(context.Background(),
		common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553"), []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, result, got)
	require.Equal(t, 1, a.calls)
	require.Equal(t, 1, b.calls)
}

// RotateActive is the semantic-staleness escape hatch: a caller that
// discovers a successful-looking response was actually unusable (stale
// chain state) can force the sticky active endpoint forward without an RPC
// error ever occurring.
func TestRotateActiveAdvancesStickyEndpoint(t *testing.T) {
	a := &fakeRPC{name: "a", blockNum: 1}
	b := &fakeRPC{name: "b", blockNum: 2}
	f := newFailover([]rpcClient{a, b})
	require.Equal(t, 2, f.EndpointCount())

	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(1), n)
	require.Equal(t, 1, a.calls)
	require.Equal(t, 0, b.calls)

	// The call above "succeeded" but the caller judges its response stale
	// and rotates explicitly — do never saw an error.
	f.RotateActive()

	n, err = f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(2), n)
	require.Equal(t, 1, a.calls, "a is not retried: rotation moved past it without an error")
	require.Equal(t, 1, b.calls, "the next call starts at the rotated endpoint")
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
