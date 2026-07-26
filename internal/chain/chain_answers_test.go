package chain

// Task 9 wave 6 regressions (Codex round 5, F1 + F2): trusting the provider's
// REPORTED fields is only sound when paired with verifying the response
// ANSWERS THE QUESTION ASKED. Two gates, both enforced in
// validateReportedHeader, both failures of the ATTEMPT (rotation proceeds —
// the zero-hash posture, uniformly applied):
//
//   - F1: every NUMBERED read requires the reported number to EQUAL the
//     height asked. A buggy proxy answering "latest" for numeric requests is
//     a protocol violation, not a success — otherwise HeaderTime dates an old
//     cursor with the current head (false-green freshness) and walker
//     ancestry compares cursor N against head M (spurious mass rewind
//     instead of rotation).
//   - F2: every required field — hash, parentHash, number, timestamp — is
//     PRESENCE-TRACKED. An omitted timestamp previously decoded as zero and
//     passed, so a malformed primary froze failover on a Unix-epoch head
//     instead of reaching a healthy secondary.
//
// These tests drive the gates through the fake seam (scripted *ReportedHeader
// values); chain_rawjson_test.go drives the SAME properties through the real
// decode below that seam.

import (
	"context"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/stretchr/testify/require"
)

// proxyAnsweringLatest scripts the F1 offender at a single height: asked for
// `asked`, the endpoint returns a WELL-FORMED header of `served` — every
// field present, plausible and internally consistent; only the height fails
// to answer the question.
func proxyAnsweringLatest(asked, served, servedTime uint64) map[uint64]*ReportedHeader {
	return map[uint64]*ReportedHeader{asked: {
		Hash:       hashPtr(fakeReportedHash(served, 0)),
		ParentHash: hashPtr(fakeReportedHash(served-1, 0)),
		Number:     (*hexutil.Big)(new(big.Int).SetUint64(served)),
		Time:       timePtr(servedTime),
	}}
}

// F1: a numbered read either serves exactly the block asked for or fails the
// attempt. The violation names the height the response actually answered.
func TestNumberedReadsRequireTheResponseToAnswerTheHeightAsked(t *testing.T) {
	const cursor, head = 90, 150
	const headTime = uint64(1_800_000_000)

	t.Run("HeaderHash", func(t *testing.T) {
		a := &fakeRPC{name: "a", blockNum: head, reported: proxyAnsweringLatest(cursor, head, headTime)}
		f := newFailover([]rpcClient{a})
		_, err := f.HeaderHash(context.Background(), cursor)
		require.ErrorContains(t, err, "all rpc endpoints failed")
		require.ErrorContains(t, err, "answers for height 150")
		require.ErrorContains(t, err, "protocol violation")
	})

	t.Run("HeaderHashFrom", func(t *testing.T) {
		a := &fakeRPC{name: "a", blockNum: head, reported: proxyAnsweringLatest(cursor, head, headTime)}
		f := newFailover([]rpcClient{a})
		_, token, err := f.HeaderHashFrom(context.Background(), 0, cursor)
		require.ErrorContains(t, err, "answers for height 150")
		require.Equal(t, -1, token.Index)
	})

	t.Run("HeaderTime", func(t *testing.T) {
		a := &fakeRPC{name: "a", blockNum: head, reported: proxyAnsweringLatest(cursor, head, headTime)}
		f := newFailover([]rpcClient{a})
		_, err := f.HeaderTime(context.Background(), cursor)
		require.ErrorContains(t, err, "answers for height 150")
	})

	t.Run("head reads pin no height", func(t *testing.T) {
		// "latest" asks no numbered question, so there is nothing to compare
		// the reported number against: internal consistency only.
		a := &fakeRPC{name: "a", blockNum: head, headerTime: headTime}
		f := newFailover([]rpcClient{a})
		h, token, err := f.HeadFrom(context.Background(), 0)
		require.NoError(t, err)
		require.Equal(t, 0, token.Index)
		require.Equal(t, uint64(head), h.Number)
	})
}

// F1's binding regression #1 (Codex, verbatim requirement): a mismatched
// response ROTATES to the next endpoint, and a healthy secondary lands the
// read — the violation is an attempt failure, not a poisoned success and not
// a dead stop.
func TestAMismatchedResponseRotatesToTheHealthyNextEndpoint(t *testing.T) {
	const cursor, head = 90, 150
	a := &fakeRPC{name: "a", blockNum: head, reported: proxyAnsweringLatest(cursor, head, 1_800_000_000)}
	b := &fakeRPC{name: "b", blockNum: head, extraNonce: 7, headerTime: 1_700_000_000}
	f := newFailover([]rpcClient{a, b})

	got, err := f.HeaderHash(context.Background(), cursor)
	require.NoError(t, err)
	require.Equal(t, fakeReportedHash(cursor, 7), got, "the healthy secondary's answer for the height ASKED is served")
	require.Equal(t, 1, a.calls, "the mismatching endpoint was attempted once and rotated past")
	require.Equal(t, 1, b.calls)

	gotFrom, token, err := f.HeaderHashFrom(context.Background(), 0, cursor)
	require.NoError(t, err)
	require.Equal(t, fakeReportedHash(cursor, 7), gotFrom)
	require.Equal(t, 1, token.Index, "the token names the endpoint that actually answered the question")
}

// F1's binding regression #2 (Codex, verbatim requirement): a mismatched
// response can never influence walker ancestry or HeaderTime. The walker's
// cursor/tip/ancestry comparisons all ride HeaderHash/HeaderHashFrom
// (walker.go's six call sites), and the daemon's freshness gate rides
// HeaderTime — so the proof is at the source: the wrong-height header's
// fields never leave the failed attempt, on either the error path or the
// rotation path.
func TestAMismatchedResponseCannotInfluenceWalkerAncestryOrHeaderTime(t *testing.T) {
	const cursor, head = 90, 150
	const headTime, cursorTime = uint64(1_800_000_000), uint64(1_700_000_000)

	t.Run("no honest endpoint: the wrong block's hash and time never escape", func(t *testing.T) {
		a := &fakeRPC{name: "a", blockNum: head, reported: proxyAnsweringLatest(cursor, head, headTime)}
		f := newFailover([]rpcClient{a})

		got, err := f.HeaderHash(context.Background(), cursor)
		require.Error(t, err, "an ancestry read against the proxy fails — it does not compare cursor N against head M and rewind")
		require.Equal(t, common.Hash{}, got, "no hash value accompanies the failure")

		ts, err := f.HeaderTime(context.Background(), cursor)
		require.Error(t, err, "freshness cannot be dated off a block nobody asked about")
		require.Zero(t, ts)
	})

	t.Run("honest secondary: every consumed value is the asked block's own", func(t *testing.T) {
		a := &fakeRPC{name: "a", blockNum: head, reported: proxyAnsweringLatest(cursor, head, headTime)}
		b := &fakeRPC{name: "b", blockNum: head, extraNonce: 7, headerTime: cursorTime}
		f := newFailover([]rpcClient{a, b})

		ts, err := f.HeaderTime(context.Background(), cursor)
		require.NoError(t, err)
		require.Equal(t, cursorTime, ts,
			"the cursor block's OWN timestamp — not the head's, which would report false-green freshness for an old cursor")

		got, err := f.HeaderHash(context.Background(), cursor)
		require.NoError(t, err)
		require.Equal(t, fakeReportedHash(cursor, 7), got, "ancestry compares the asked block's reported hash, never the proxy's head")
	})
}

// F2: a response omitting a required field is a protocol violation that fails
// the attempt — never a struct with plausible zero values. Each subtest
// removes exactly one field so the named absence is the one violation seen.
func TestHeaderReadsRefuseAResponseMissingARequiredField(t *testing.T) {
	const n = 90
	withOne := func(mutate func(*ReportedHeader)) map[uint64]*ReportedHeader {
		rh := &ReportedHeader{
			Hash:       hashPtr(fakeReportedHash(n, 0)),
			ParentHash: hashPtr(fakeReportedHash(n-1, 0)),
			Number:     (*hexutil.Big)(new(big.Int).SetUint64(n)),
			Time:       timePtr(1_700_000_000),
		}
		mutate(rh)
		return map[uint64]*ReportedHeader{n: rh}
	}

	t.Run("missing timestamp is not a Unix-epoch head", func(t *testing.T) {
		// The F2 defect: non-pointer Time decoded an omitted timestamp as 0
		// and HeaderTime reported an epoch-aged block — false stale verdicts,
		// and failover STOPPED at the malformed primary.
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: n, reported: withOne(func(rh *ReportedHeader) { rh.Time = nil })}})
		ts, err := f.HeaderTime(context.Background(), n)
		require.ErrorContains(t, err, "omits required field(s) timestamp")
		require.ErrorContains(t, err, "protocol violation")
		require.Zero(t, ts)
	})

	t.Run("missing timestamp on the head read", func(t *testing.T) {
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: n, reported: withOne(func(rh *ReportedHeader) { rh.Time = nil })}})
		_, token, err := f.HeadFrom(context.Background(), 0)
		require.ErrorContains(t, err, "omits required field(s) timestamp")
		require.Equal(t, -1, token.Index)
	})

	t.Run("missing hash", func(t *testing.T) {
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: n, reported: withOne(func(rh *ReportedHeader) { rh.Hash = nil })}})
		_, err := f.HeaderHash(context.Background(), n)
		require.ErrorContains(t, err, "omits required field(s) hash",
			"absence surfaces AS absence — not as the zero-hash refusal, which is a different lie")
	})

	t.Run("missing parentHash", func(t *testing.T) {
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: n, reported: withOne(func(rh *ReportedHeader) { rh.ParentHash = nil })}})
		_, err := f.HeaderHash(context.Background(), n)
		require.ErrorContains(t, err, "omits required field(s) parentHash")
	})

	t.Run("missing number", func(t *testing.T) {
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: n, reported: withOne(func(rh *ReportedHeader) { rh.Number = nil })}})
		_, err := f.HeaderHash(context.Background(), n)
		require.ErrorContains(t, err, "omits required field(s) number",
			"an absent number is a violation in its own right — never silently treated as the height asked")
	})

	t.Run("a malformed primary rotates to a healthy secondary", func(t *testing.T) {
		// The F2 composition Codex named: epoch-aged heads made failover STOP
		// at a malformed primary. The violation must instead fail the attempt
		// so the walk reaches the healthy secondary — on both the freshness
		// read and the head read the daemon's staleness gate consumes.
		a := &fakeRPC{name: "a", blockNum: n, reported: withOne(func(rh *ReportedHeader) { rh.Time = nil })}
		b := &fakeRPC{name: "b", blockNum: n, extraNonce: 3, headerTime: 1_750_000_000}
		f := newFailover([]rpcClient{a, b})

		ts, err := f.HeaderTime(context.Background(), n)
		require.NoError(t, err)
		require.Equal(t, uint64(1_750_000_000), ts, "the healthy secondary's timestamp lands")
		require.Equal(t, 1, a.calls, "the malformed primary was attempted and rotated past")

		head, token, err := f.HeadFrom(context.Background(), 0)
		require.NoError(t, err)
		require.Equal(t, 1, token.Index)
		require.Equal(t, uint64(1_750_000_000), head.Time)
		require.Equal(t, fakeReportedHash(n, 3), head.Hash)
	})
}
