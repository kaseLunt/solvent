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
	// headerTime is the Time field of every header this endpoint returns — the
	// field that makes a head observation falsifiable, since a node frozen on old
	// state still reports a plausible height but cannot make its header claim to
	// be recent.
	headerTime uint64
	// extraNonce perturbs returned header hashes so two endpoints can disagree
	// about the block at a height (a fork), not merely about the height.
	extraNonce uint64
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
	// A nil number means "latest", the shape HeadFrom uses.
	if n == nil {
		n = new(big.Int).SetUint64(f.blockNum)
	}
	return &types.Header{
		Number: n,
		Time:   f.headerTime,
		Nonce:  types.EncodeNonce(f.extraNonce),
	}, nil
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

// CallFrom is the caller-scoped semantic-failover entry: the attempt walk
// starts at the given index instead of the shared sticky hint, and the
// shared hint is left alone — a following shared-path call still starts
// wherever error-driven routing last left it.
func TestCallFromStartsAtGivenIndexAndLeavesSharedHintAlone(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}, blockNum: 7}
	b := &fakeRPC{name: "b", callResult: []byte{0xbb}}
	f := newFailover([]rpcClient{a, b})
	require.Equal(t, 2, f.EndpointCount())

	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	out, tok, err := f.CallFrom(context.Background(), 1, to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, []byte{0xbb}, out)
	require.Equal(t, 1, tok.Index, "the token names the endpoint that served the call")
	require.Equal(t, 0, a.calls, "the walk starts at the caller's index, not the shared hint")
	require.Equal(t, 1, b.calls)

	// The caller-scoped success wrote nothing shared: the shared path still
	// starts at endpoint 0.
	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(7), n)
	require.Equal(t, 1, a.calls, "the shared hint was untouched by CallFrom")
	require.Equal(t, 1, b.calls)
}

// CallFrom normalizes its start (mod the endpoint count), rotates on error
// within its own walk exactly like the shared path, and reports Index -1
// when every endpoint fails.
func TestCallFromWrapsModuloAndRotatesOnError(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}}
	b := &fakeRPC{name: "b", fail: true}
	f := newFailover([]rpcClient{a, b})

	// start 3 on 2 endpoints → endpoint 1; it fails; the walk wraps to 0.
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	out, tok, err := f.CallFrom(context.Background(), 3, to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, []byte{0xaa}, out)
	require.Equal(t, 0, tok.Index)
	require.Equal(t, 1, b.calls, "the walk started at the normalized index")
	require.Equal(t, 1, a.calls)

	a.fail = true
	_, tok, err = f.CallFrom(context.Background(), 0, to, []byte{0x01})
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.Equal(t, -1, tok.Index, "all endpoints failed: nothing to reject")
}

// The counter-schedule that retired the shared-hint semantic rotation, at
// the chain layer: error-driven routing pins the shared hint onto endpoint 1
// (endpoint 0 down for the walker-style call); a caller-scoped CallFrom(0)
// then succeeds on endpoint 0. That caller-scoped success must NOT re-pin
// the shared hint — the next shared-path call still starts on endpoint 1.
// Symmetrically (the snapshotter's direction), a semantic caller's routing
// preference can never be overwritten BY the shared path, because it never
// lived in shared state at all.
func TestCallFromSuccessDoesNotRepinSharedHint(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true, callResult: []byte{0xaa}}
	b := &fakeRPC{name: "b", callResult: []byte{0xbb}, blockNum: 9}
	f := newFailover([]rpcClient{a, b})

	_, err := f.BlockNumber(context.Background()) // a fails, b serves → shared hint = 1
	require.NoError(t, err)

	a.fail = false // a recovers for the semantic caller's read
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	out, tok, err := f.CallFrom(context.Background(), 0, to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, []byte{0xaa}, out)
	require.Equal(t, 0, tok.Index)

	aCalls := a.calls
	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(9), n)
	require.Equal(t, aCalls, a.calls, "the shared path still starts at its own hint, not the caller-scoped success")
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
