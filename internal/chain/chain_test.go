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
	// callBlocks records the blockNumber argument of every CallContract this
	// endpoint served, so a test can prove a pinned call forwarded its pin
	// (and that an unpinned call asked for "latest", i.e. nil).
	callBlocks []*big.Int
	// callHashes records the blockHash argument of every CallContractAtHash
	// this endpoint served, so a test can prove the EIP-1898 pin was forwarded
	// as a HASH — never silently degraded to a number or to "latest".
	callHashes []common.Hash
	// hashUnknown makes CallContractAtHash reject every hash with the observed
	// "block not found" class — a node that does not have the pinned block,
	// which is a different animal from a node that is down.
	hashUnknown bool
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
	f.callBlocks = append(f.callBlocks, blockNumber)
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	return f.callResult, nil
}

func (f *fakeRPC) CallContractAtHash(ctx context.Context, msg ethereum.CallMsg, blockHash common.Hash) ([]byte, error) {
	f.calls++
	f.callHashes = append(f.callHashes, blockHash)
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	if f.hashUnknown {
		return nil, errors.New("block not found")
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

// CallAtFrom forwards its BLOCK PIN to the endpoint — the property that makes
// an endpoint-coherent round possible, since a "latest" call could execute on
// a different block than the one the caller pinned and verified — while Call's
// own request stays "latest" (nil), so the two cannot be silently conflated.
// Routing is CallFrom's: caller-scoped start, shared hint untouched.
func TestCallAtFromPinsBlockAndLeavesSharedHintAlone(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}, blockNum: 7}
	b := &fakeRPC{name: "b", callResult: []byte{0xbb}}
	f := newFailover([]rpcClient{a, b})

	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	out, tok, err := f.CallAtFrom(context.Background(), 1, to, []byte{0x01}, 123456)
	require.NoError(t, err)
	require.Equal(t, []byte{0xbb}, out)
	require.Equal(t, 1, tok.Index, "the token names the endpoint that served the pinned call")
	require.Equal(t, 0, a.calls, "the walk starts at the caller's index, not the shared hint")
	require.Len(t, b.callBlocks, 1)
	require.Equal(t, new(big.Int).SetUint64(123456), b.callBlocks[0],
		"the pin is forwarded to eth_call, not silently dropped to latest")

	// The unpinned variant keeps asking for latest: the pin is CallAtFrom's alone.
	_, err = f.Call(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Len(t, a.callBlocks, 1)
	require.Nil(t, a.callBlocks[0], "Call still executes at latest (nil block)")

	// The caller-scoped success wrote nothing shared: the shared path still
	// starts at endpoint 0 (which the Call above just proved by serving from a).
	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(7), n)
}

// CallAtFrom normalizes its start (mod the endpoint count), rotates on error
// within its own walk exactly like CallFrom, and reports Index -1 when every
// endpoint fails — the caller can then tell "the pinned endpoint did not
// serve this" from "nobody did".
func TestCallAtFromWrapsModuloAndRotatesOnError(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}}
	b := &fakeRPC{name: "b", fail: true}
	f := newFailover([]rpcClient{a, b})

	// start 3 on 2 endpoints → endpoint 1; it fails; the walk wraps to 0.
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	out, tok, err := f.CallAtFrom(context.Background(), 3, to, []byte{0x01}, 99)
	require.NoError(t, err)
	require.Equal(t, []byte{0xaa}, out)
	require.Equal(t, 0, tok.Index, "the token names the endpoint that actually answered, not the requested start")
	require.Equal(t, 1, b.calls, "the walk started at the normalized index")
	require.Equal(t, 1, a.calls)
	require.Equal(t, new(big.Int).SetUint64(99), a.callBlocks[0], "the pin survives rotation")

	a.fail = true
	_, tok, err = f.CallAtFrom(context.Background(), 0, to, []byte{0x01}, 99)
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.Equal(t, -1, tok.Index, "all endpoints failed: nothing to reject")
}

// CallAtHashFrom forwards its pin AS A HASH via the EIP-1898 eth_call form —
// the property that binds execution to a block's IDENTITY rather than to a
// height every fork has one of — while Call keeps asking for "latest" (nil)
// and CallAtFrom keeps sending a number, so the three cannot be silently
// conflated. Routing is CallFrom's: caller-scoped start, shared hint
// untouched.
func TestCallAtHashFromPinsHashAndLeavesSharedHintAlone(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}, blockNum: 7}
	b := &fakeRPC{name: "b", callResult: []byte{0xbb}}
	f := newFailover([]rpcClient{a, b})

	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	pin := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000000cafe1")
	out, tok, err := f.CallAtHashFrom(context.Background(), 1, to, []byte{0x01}, pin)
	require.NoError(t, err)
	require.Equal(t, []byte{0xbb}, out)
	require.Equal(t, 1, tok.Index, "the token names the endpoint that served the hash-pinned call")
	require.Equal(t, 0, a.calls, "the walk starts at the caller's index, not the shared hint")
	require.Len(t, b.callHashes, 1)
	require.Equal(t, pin, b.callHashes[0],
		"the pin is forwarded to eth_call as the EIP-1898 block hash, never degraded to a number or latest")
	require.Empty(t, b.callBlocks, "no number-pinned or latest call was issued in its place")

	// The unpinned variant keeps asking for latest: the identity pin is
	// CallAtHashFrom's alone.
	_, err = f.Call(context.Background(), to, []byte{0x01})
	require.NoError(t, err)
	require.Len(t, a.callBlocks, 1)
	require.Nil(t, a.callBlocks[0], "Call still executes at latest (nil block)")

	// The caller-scoped success wrote nothing shared: the shared path still
	// starts at endpoint 0 (which the Call above just proved by serving from a).
	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(7), n)
}

// CallAtHashFrom normalizes its start (mod the endpoint count), rotates on
// error within its own walk exactly like CallFrom — including on the observed
// "block not found" rejection class, since a node that does not have the
// pinned block is precisely a node to walk past — and reports Index -1 when
// every endpoint fails, surfacing the LAST error so an all-endpoints
// rejection stays classifiable by the caller.
func TestCallAtHashFromWrapsModuloAndRotatesOnError(t *testing.T) {
	a := &fakeRPC{name: "a", callResult: []byte{0xaa}}
	b := &fakeRPC{name: "b", hashUnknown: true} // knows nothing of the pinned block
	f := newFailover([]rpcClient{a, b})

	// start 3 on 2 endpoints → endpoint 1; it rejects the hash; the walk wraps to 0.
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	pin := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000000cafe2")
	out, tok, err := f.CallAtHashFrom(context.Background(), 3, to, []byte{0x01}, pin)
	require.NoError(t, err)
	require.Equal(t, []byte{0xaa}, out)
	require.Equal(t, 0, tok.Index, "the token names the endpoint that actually answered, not the requested start")
	require.Equal(t, 1, b.calls, "the walk started at the normalized index")
	require.Equal(t, 1, a.calls)
	require.Equal(t, pin, a.callHashes[0], "the hash pin survives rotation")

	a.hashUnknown = true
	_, tok, err = f.CallAtHashFrom(context.Background(), 0, to, []byte{0x01}, pin)
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.ErrorContains(t, err, "block not found",
		"the rejection class survives the failover wrapping, so the caller can tell 'nobody has this block' from 'nobody answered'")
	require.Equal(t, -1, tok.Index, "all endpoints failed: nothing to reject")
}

// THE PINNED-CALL PATH RETAINS EVERY PER-ATTEMPT OUTCOME (Task 9 wave 4,
// Codex round 3 [medium]): a total failure surfaces a *PinnedCallError
// carrying each attempted endpoint's OWN error, named by endpoint index, in
// walk order — so a caller classifying the outcome can require unanimity
// across attempts instead of trusting whichever error the rotation left
// last. Driven in BOTH walk orders over the same mixed outage (endpoint a
// transport-down, endpoint b rejecting the pin): the aggregate carries the
// same two outcomes either way, and only the order differs; the surfaced
// wording keeps doFrom's exact total-failure shape with the LAST attempt's
// error as the headline and unwrap target.
func TestCallAtHashFromRetainsPerAttemptOutcomesInBothWalkOrders(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true}        // transport failure
	b := &fakeRPC{name: "b", hashUnknown: true} // recognized pin rejection
	f := newFailover([]rpcClient{a, b})
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	pin := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000000cafe3")

	// Walk from 0: transport first, the rejection LAST — the exact shape a
	// last-error-wins classifier misreads as "everyone rejected the pin".
	_, tok, err := f.CallAtHashFrom(context.Background(), 0, to, []byte{0x01}, pin)
	require.Equal(t, -1, tok.Index)
	var walk *PinnedCallError
	require.ErrorAs(t, err, &walk, "a total pinned-call failure carries the per-attempt aggregate")
	require.Equal(t, "callAtHash", walk.Op)
	require.Len(t, walk.Attempts, 2, "every attempted endpoint's outcome is retained")
	require.Equal(t, 0, walk.Attempts[0].Endpoint)
	require.ErrorContains(t, walk.Attempts[0].Err, "a down")
	require.Equal(t, 1, walk.Attempts[1].Endpoint)
	require.ErrorContains(t, walk.Attempts[1].Err, "block not found")
	require.ErrorContains(t, err, "all rpc endpoints failed (callAtHash)",
		"the surfaced wording is doFrom's total-failure shape, unchanged")
	require.ErrorContains(t, err, "block not found", "the headline stays the LAST attempt's error")

	// Walk from 1: the SAME outage in the opposite order. The aggregate still
	// carries both outcomes; only the order (and the headline) differs.
	_, _, err = f.CallAtHashFrom(context.Background(), 1, to, []byte{0x01}, pin)
	require.ErrorAs(t, err, &walk)
	require.Len(t, walk.Attempts, 2)
	require.Equal(t, 1, walk.Attempts[0].Endpoint)
	require.ErrorContains(t, walk.Attempts[0].Err, "block not found")
	require.Equal(t, 0, walk.Attempts[1].Endpoint)
	require.ErrorContains(t, walk.Attempts[1].Err, "a down")
	require.ErrorContains(t, err, "a down", "the headline is still the last attempt's error")
}

// THE AGGREGATE IS THE PINNED-CALL PATH'S ALONE (the wave-4 brief's
// keep-existing-behavior bound): every other method still fails through
// doFrom's last-error shape, so no other caller — the snapshotter's Call /
// CallFrom, the walker's shared-path reads — sees its error shape move.
func TestOnlyThePinnedCallPathCarriesTheAttemptAggregate(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", fail: true}
	f := newFailover([]rpcClient{a, b})
	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	var walk *PinnedCallError

	_, _, err := f.CallFrom(context.Background(), 0, to, []byte{0x01})
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.False(t, errors.As(err, &walk), "CallFrom keeps doFrom's last-error shape")

	_, err = f.Call(context.Background(), to, []byte{0x01})
	require.False(t, errors.As(err, &walk), "Call keeps doFrom's last-error shape")

	_, _, err = f.CallAtFrom(context.Background(), 0, to, []byte{0x01}, 99)
	require.False(t, errors.As(err, &walk), "the number-pinned variant keeps doFrom's last-error shape")

	_, err = f.BlockNumber(context.Background())
	require.False(t, errors.As(err, &walk), "the shared path keeps doFrom's last-error shape")
}

// A CONTEXT ABORT IS NOT AN ATTEMPT AGGREGATE: a walk cut off by its caller
// proves nothing about how the unattempted endpoints would have answered, so
// it must not be classifiable as "every attempt rejected the pin" — the
// caller sees a plain aborted error and fails closed to its error posture.
func TestCallAtHashFromAbortIsNotAnAttemptAggregate(t *testing.T) {
	a := &fakeRPC{name: "a", hashUnknown: true}
	b := &fakeRPC{name: "b", hashUnknown: true}
	f := newFailover([]rpcClient{a, b})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	to := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	pin := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000000cafe4")
	_, tok, err := f.CallAtHashFrom(ctx, 0, to, []byte{0x01}, pin)
	require.ErrorIs(t, err, context.Canceled)
	require.ErrorContains(t, err, "callAtHash aborted")
	require.Equal(t, -1, tok.Index)
	var walk *PinnedCallError
	require.False(t, errors.As(err, &walk),
		"an aborted walk carries no aggregate: unanimity was never established")
	require.Equal(t, 0, a.calls, "no attempt ran")
	require.Equal(t, 0, b.calls)
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
