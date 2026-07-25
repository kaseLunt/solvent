package chain

// Tests for the head/ancestry reads the price workers' liveness and reorg-repair
// checks are built on. All three exist because a caller must be able to ask a
// question WITHOUT routing it through the endpoint the question is about:
//
//   - HeadFrom carries the header's own TIMESTAMP (a frozen node reports a
//     plausible height but cannot backdate its header) and starts its attempt walk
//     where the caller says;
//   - ActiveEndpoint exposes the shared hint so a caller can deliberately route
//     around it;
//   - HeaderHashFrom re-checks a recorded hash, likewise routable.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// HeadFrom returns the height, the header TIMESTAMP and the hash, and starts at
// the endpoint the caller names rather than at the shared hint.
func TestHeadFromStartsWhereTheCallerSays(t *testing.T) {
	a := &fakeRPC{name: "a", blockNum: 100, headerTime: 1_700_000_000}
	b := &fakeRPC{name: "b", blockNum: 200, headerTime: 1_700_000_500}
	f := newFailover([]rpcClient{a, b})

	head, token, err := f.HeadFrom(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 1, token.Index, "the caller-named endpoint served it")
	require.Equal(t, uint64(200), head.Number)
	require.Equal(t, uint64(1_700_000_500), head.Time, "the header's own timestamp comes back")
	require.NotZero(t, head.Hash)
	require.Zero(t, a.calls, "endpoint 0 was not consulted")
}

// A caller-scoped probe must NOT move the shared routing hint: the whole point is
// that ingestion's routing is left alone while the probe looks elsewhere.
func TestHeadFromDoesNotMoveTheSharedHint(t *testing.T) {
	a := &fakeRPC{name: "a", blockNum: 100, headerTime: 1}
	b := &fakeRPC{name: "b", blockNum: 200, headerTime: 2}
	f := newFailover([]rpcClient{a, b})
	require.Equal(t, 0, f.ActiveEndpoint())

	_, token, err := f.HeadFrom(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 1, token.Index)
	require.Equal(t, 0, f.ActiveEndpoint(), "the shared hint is untouched by a caller-scoped probe")

	// A shared-path call DOES move it, which is what a caller routes around.
	_, err = f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, f.ActiveEndpoint())
}

// Error-driven rotation still applies WITHIN a caller-scoped walk: the start index
// is a preference, not an exclusive binding.
func TestHeadFromRotatesWithinItsWalk(t *testing.T) {
	a := &fakeRPC{name: "a", blockNum: 100, headerTime: 1}
	b := &fakeRPC{name: "b", fail: true}
	f := newFailover([]rpcClient{a, b})

	head, token, err := f.HeadFrom(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 0, token.Index, "started at the failing endpoint, rotated to the working one")
	require.Equal(t, uint64(100), head.Number)
}

// Every endpoint failing is an error, and the token names no server.
func TestHeadFromAllEndpointsFail(t *testing.T) {
	f := newFailover([]rpcClient{&fakeRPC{name: "a", fail: true}, &fakeRPC{name: "b", fail: true}})
	_, token, err := f.HeadFrom(context.Background(), 0)
	require.Error(t, err)
	require.Equal(t, -1, token.Index)
}

// A negative or oversized start index normalizes rather than panicking — the same
// contract CallFrom carries, since a caller computes these with modular arithmetic
// over a changing endpoint count.
func TestHeadFromNormalizesStartIndex(t *testing.T) {
	a := &fakeRPC{name: "a", blockNum: 100, headerTime: 1}
	b := &fakeRPC{name: "b", blockNum: 200, headerTime: 2}
	f := newFailover([]rpcClient{a, b})

	_, token, err := f.HeadFrom(context.Background(), -1)
	require.NoError(t, err)
	require.Equal(t, 1, token.Index)

	_, token, err = f.HeadFrom(context.Background(), 5)
	require.NoError(t, err)
	require.Equal(t, 1, token.Index)
}

// HeaderHashFrom answers the ancestry question from a chosen endpoint, and two
// endpoints on different forks return DIFFERENT hashes for the same height —
// which is exactly what makes "is my recorded anchor still canonical" decidable.
func TestHeaderHashFromIsRoutableAndForkSensitive(t *testing.T) {
	a := &fakeRPC{name: "a", blockNum: 100, extraNonce: 1}
	b := &fakeRPC{name: "b", blockNum: 100, extraNonce: 2}
	f := newFailover([]rpcClient{a, b})

	hashA, tokenA, err := f.HeaderHashFrom(context.Background(), 0, 90)
	require.NoError(t, err)
	require.Equal(t, 0, tokenA.Index)
	hashB, tokenB, err := f.HeaderHashFrom(context.Background(), 1, 90)
	require.NoError(t, err)
	require.Equal(t, 1, tokenB.Index)
	require.NotEqual(t, hashA, hashB, "two views of block 90 must be distinguishable")
	require.Equal(t, 0, f.ActiveEndpoint(), "neither probe moved the shared hint")

	// And the shared-path HeaderHash still works unchanged.
	shared, err := f.HeaderHash(context.Background(), 90)
	require.NoError(t, err)
	require.Equal(t, hashA, shared)
}

func TestHeaderHashFromAllEndpointsFail(t *testing.T) {
	f := newFailover([]rpcClient{&fakeRPC{name: "a", fail: true}})
	_, token, err := f.HeaderHashFrom(context.Background(), 0, 90)
	require.Error(t, err)
	require.Equal(t, -1, token.Index)
}
