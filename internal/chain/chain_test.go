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

	// callStarted (closed when CallContract begins) and callGate (blocks
	// CallContract until closed) let interleaving tests hold a call in
	// flight deterministically. Nil channels: unused, no gating.
	callStarted chan struct{}
	callGate    chan struct{}
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
	if f.callStarted != nil {
		close(f.callStarted)
		f.callStarted = nil
	}
	if f.callGate != nil {
		<-f.callGate
	}
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

// RotateAwayFrom is the semantic-staleness escape hatch: a caller that
// discovers a successful-looking response was actually unusable (stale
// chain state) hands back its serving endpoint's token and forces the
// sticky active endpoint past it — without an RPC error ever occurring.
func TestRotateAwayFromAdvancesStickyEndpoint(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}}
	b := &fakeRPC{name: "b", callResult: []byte{0xbb}}
	f := newFailover([]rpcClient{a, b})
	require.Equal(t, 2, f.EndpointCount())

	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	out, tok, err := f.CallWithToken(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, []byte{0xaa}, out)
	require.Equal(t, 0, tok.Index, "the token names the endpoint that served the call")
	require.Equal(t, 1, a.calls)
	require.Equal(t, 0, b.calls)

	// The call above "succeeded" but the caller judges its response stale
	// and rejects it against its serving endpoint — do never saw an error.
	f.RotateAwayFrom(tok)

	out, tok, err = f.CallWithToken(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, []byte{0xbb}, out)
	require.Equal(t, 1, tok.Index, "the next call starts at the rotated endpoint")
	require.Equal(t, 1, a.calls, "a is not retried: rotation moved past it without an error")
	require.Equal(t, 1, b.calls)
}

// A semantic rotation must linearize against in-flight calls: call A begins
// on endpoint 0 and BLOCKS; a semantic rotation away from endpoint 0 lands
// while A is in flight; A then completes successfully. A's completion must
// NOT pin the sticky active endpoint back onto the rejected endpoint — the
// rotation's revision bump invalidates A's sticky write — and the next call
// starts on endpoint 1.
func TestInFlightSuccessDoesNotRepinRotatedEndpoint(t *testing.T) {
	started := make(chan struct{})
	gate := make(chan struct{})
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}, callStarted: started, callGate: gate}
	b := &fakeRPC{name: "b", callResult: []byte{0xbb}}
	f := newFailover([]rpcClient{a, b})

	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	type callOut struct {
		res []byte
		tok EndpointToken
		err error
	}
	done := make(chan callOut, 1)
	go func() {
		res, tok, err := f.CallWithToken(context.Background(), to, []byte{0x01})
		done <- callOut{res: res, tok: tok, err: err}
	}()

	<-started // call A is in flight on endpoint 0
	// An earlier response from endpoint 0 is judged semantically stale while
	// A is still running: the rotation moves active 0→1 and bumps the
	// revision, so A's snapshot of the pre-rotation state is now invalid for
	// the sticky write (but not for A's own result).
	f.RotateAwayFrom(EndpointToken{Index: 0})
	close(gate) // A completes successfully

	out := <-done
	require.NoError(t, out.err)
	require.Equal(t, []byte{0xaa}, out.res, "the in-flight call still returns its own result")
	require.Equal(t, 0, out.tok.Index, "its token still names the endpoint that served it")

	f.mu.Lock()
	active := f.active
	f.mu.Unlock()
	require.Equal(t, 1, active, "the in-flight completion must not pin active back onto the rejected endpoint")

	_, tok, err := f.CallWithToken(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, 1, tok.Index, "the next call starts on the rotated-to endpoint")
	require.Equal(t, 1, a.calls, "the rejected endpoint is not re-served")
	require.Equal(t, 1, b.calls)
}

// RotateAwayFrom is ENDPOINT-BOUND: a rejection carrying the token of an
// endpoint that is no longer active (an interleaved success already moved
// active elsewhere) must NOT rotate active off the newer endpoint — advancing
// blindly would punish an unrelated, possibly healthy endpoint.
func TestRotateAwayFromStaleTokenDoesNotMoveActive(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}}
	b := &fakeRPC{name: "b", callResult: []byte{0xbb}}
	c := &fakeRPC{name: "c", callResult: []byte{0xcc}}
	f := newFailover([]rpcClient{a, b, c})

	// First call: served by endpoint 0; the caller keeps its token.
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	_, tokA, err := f.CallWithToken(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, 0, tokA.Index)

	// Interleaved activity moves active to endpoint 2: 0 and 1 go down and
	// a second call fails over to 2, pinning it active.
	a.fail, b.fail = true, true
	_, tokB, err := f.CallWithToken(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, 2, tokB.Index)

	// The FIRST call's response is now judged stale. Its endpoint is no
	// longer active, so the rejection must leave active on endpoint 2.
	f.RotateAwayFrom(tokA)
	f.mu.Lock()
	active := f.active
	f.mu.Unlock()
	require.Equal(t, 2, active, "a token that no longer matches active must not move it")

	aCalls, bCalls := a.calls, b.calls
	_, tok, err := f.CallWithToken(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Equal(t, 2, tok.Index, "the next call still starts on the interleaved success's endpoint")
	require.Equal(t, aCalls, a.calls, "the down endpoints are not re-walked")
	require.Equal(t, bCalls, b.calls)
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
