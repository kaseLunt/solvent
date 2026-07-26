package chain

// Task 9 wave 5 regressions: EVERY hash the Failover hands out is the
// PROVIDER-REPORTED eth_getBlockByNumber `hash` field — never a local
// types.Header.Hash() recomputation, which go-ethereum v1.13.0 gets silently
// wrong for every modern OP-mainnet block (computed 0x70f6bea2… where the
// canonical hash of block 150,105,227 is 0x3d957321…; forensic proof at
// .superpowers/sdd/r001-probe/hashcheck.go).
//
// FIXTURE REALISM IS THE HEADLINE. The recomputation defect survived 16 waves
// and 14 review rounds because every fake ever written served SELF-CONSISTENT
// hashes: whatever the header path computed was also what the fake
// recognized, so computed-vs-reported divergence was unrepresentable. The
// OP-SHAPED fixture below carries BOTH representations of one block — the
// hash the provider reports, and the different hash a local recomputation of
// its known fields yields — and every test here asserts the Failover hands
// out the former. The revert-to-h.Hash() mutants (W5M1/W5M5) die on exactly
// these assertions.

import (
	"context"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

// The incident block: OP mainnet 150,105,227, where the wedged walker's
// tip-log equality check exposed the defect. The reported hash is the
// CANONICAL one, confirmed on both OP providers during the forensic probe.
const opIncidentBlock = 150_105_227

var opIncidentReportedHash = common.HexToHash("0x3d9573215de44873740c98df8ad6c062c85b6135cbcbd0cc62381f886d07fe23")

// opShapedEndpoint builds a fake endpoint serving an OP-SHAPED header at the
// incident height (also its head): the REPORTED hash is the canonical
// 0x3d957321… while re-RLP-hashing the header's v1.13.0-representable fields
// yields something else entirely. The returned *types.Header is what the
// retired HeaderByNumber surface serves for the same height, so a mutant that
// reverts to recomputation produces a DIFFERENT, wrong hash — visibly.
//
// The fixture self-check is part of the harness contract: if the two
// representations ever agreed, the fixture would have degenerated back into
// the self-consistent fakes that hid this bug, and every test built on it
// would be vacuously green.
func opShapedEndpoint(t *testing.T) *fakeRPC {
	t.Helper()
	full := &types.Header{
		ParentHash: common.HexToHash("0x64c3ff4b5eaa4f2f5a76c2708e11b3a24d5eaf99e2d1a0f28f6ea45cf2c0b9d3"),
		Number:     new(big.Int).SetUint64(opIncidentBlock),
		Time:       1_753_500_000,
	}
	require.NotEqual(t, opIncidentReportedHash, full.Hash(),
		"fixture self-check: OP-SHAPED means the reported hash is NOT what re-RLP-hashing the known fields produces — a fixture where they agree cannot see the defect")
	return &fakeRPC{
		name:     "op",
		blockNum: opIncidentBlock,
		reported: map[uint64]*ReportedHeader{
			opIncidentBlock: {
				Hash:       opIncidentReportedHash,
				ParentHash: full.ParentHash,
				Number:     (*hexutil.Big)(new(big.Int).SetUint64(opIncidentBlock)),
				Time:       hexutil.Uint64(full.Time),
			},
		},
		fullHeaders: map[uint64]*types.Header{opIncidentBlock: full},
	}
}

// THE WAVE-5 PRINCIPLE, at the shared-path entry the walker consumes:
// HeaderHash returns the value the provider REPORTED, not a recomputation.
// This is the regression that kills the v1.13.0-revert mutant (W5M1): swapped
// back to h.Hash(), the Failover would return the fixture's recomputed hash
// and this equality fails.
func TestHeaderHashIsTheProviderReportedHashNotARecomputation(t *testing.T) {
	op := opShapedEndpoint(t)
	f := newFailover([]rpcClient{op})

	got, err := f.HeaderHash(context.Background(), opIncidentBlock)
	require.NoError(t, err)
	require.Equal(t, opIncidentReportedHash, got,
		"the chain layer hands out the provider-REPORTED hash — local recomputation was the false guarantee that wedged the OP walker")
}

// The caller-scoped variant serves the SAME reported value with its token —
// the poller's hashAfter re-read and every repair probe ride this path, so a
// recomputation here would break the before/after comparison one-sidedly.
func TestHeaderHashFromServesTheReportedHashWithItsToken(t *testing.T) {
	op := opShapedEndpoint(t)
	f := newFailover([]rpcClient{op})

	got, token, err := f.HeaderHashFrom(context.Background(), 0, opIncidentBlock)
	require.NoError(t, err)
	require.Equal(t, 0, token.Index)
	require.Equal(t, opIncidentReportedHash, got,
		"the routable re-verification path reports the same provider-reported identity")
}

// HeadFrom's Head carries the reported hash (plus the reported number and
// timestamp) for an OP-shaped LATEST header. This is where the poller's
// hashBefore comes from — the hash the EIP-1898 pin presents back to the
// node — so a recomputation or a plumbing slip here (W5M3/W5M5) is precisely
// the discard-forever composition wave 5 exists to kill.
func TestHeadFromCarriesTheReportedHashOfAnOPShapedHead(t *testing.T) {
	op := opShapedEndpoint(t)
	f := newFailover([]rpcClient{op})

	head, token, err := f.HeadFrom(context.Background(), 0)
	require.NoError(t, err)
	require.Equal(t, 0, token.Index)
	require.Equal(t, uint64(opIncidentBlock), head.Number, "the reported number field")
	require.Equal(t, uint64(1_753_500_000), head.Time, "the reported timestamp field")
	require.Equal(t, opIncidentReportedHash, head.Hash,
		"Head.Hash is the provider-reported hash — the identity the EIP-1898 pin round-trips back to the node")
}

// HeaderTime shares the reported fetch; its value is the response's own
// timestamp field, exactly as before the conversion (the field use was never
// wrong — only hash recomputation was).
func TestHeaderTimeIsTheReportedTimestamp(t *testing.T) {
	op := opShapedEndpoint(t)
	f := newFailover([]rpcClient{op})

	ts, err := f.HeaderTime(context.Background(), opIncidentBlock)
	require.NoError(t, err)
	require.Equal(t, uint64(1_753_500_000), ts)
}

// THE ZERO-HASH REFUSAL, RETAINED AT THE SOURCE: a mined block whose reported
// hash is zero is a provider protocol violation — the value must never be
// handed out as a block identity (an anchor holding it would "verify" against
// nothing). The refusal is an ATTEMPT failure, so the walk rotates past the
// violating endpoint like any other endpoint fault, and only a walk with no
// honest endpoint left surfaces the violation.
func TestHeaderReadsRefuseAZeroReportedHash(t *testing.T) {
	zeroAt := func(n uint64) map[uint64]*ReportedHeader {
		return map[uint64]*ReportedHeader{n: {
			Hash:   common.Hash{}, // the protocol violation
			Number: (*hexutil.Big)(new(big.Int).SetUint64(n)),
			Time:   hexutil.Uint64(1),
		}}
	}

	t.Run("HeaderHash", func(t *testing.T) {
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: 90, reported: zeroAt(90)}})
		_, err := f.HeaderHash(context.Background(), 90)
		require.ErrorContains(t, err, "all rpc endpoints failed")
		require.ErrorContains(t, err, "zero hash")
		require.ErrorContains(t, err, "protocol violation")
	})

	t.Run("HeaderHashFrom", func(t *testing.T) {
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: 90, reported: zeroAt(90)}})
		_, token, err := f.HeaderHashFrom(context.Background(), 0, 90)
		require.ErrorContains(t, err, "zero hash")
		require.Equal(t, -1, token.Index)
	})

	t.Run("HeadFrom", func(t *testing.T) {
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: 90, reported: zeroAt(90)}})
		_, token, err := f.HeadFrom(context.Background(), 0)
		require.ErrorContains(t, err, "zero hash")
		require.Equal(t, -1, token.Index)
	})

	t.Run("HeaderTime", func(t *testing.T) {
		// One fetch path means one protocol gate: a response untrustworthy for
		// its hash is not trusted for its timestamp either.
		f := newFailover([]rpcClient{&fakeRPC{name: "a", blockNum: 90, reported: zeroAt(90)}})
		_, err := f.HeaderTime(context.Background(), 90)
		require.ErrorContains(t, err, "zero hash")
	})

	t.Run("rotates past the violator", func(t *testing.T) {
		a := &fakeRPC{name: "a", blockNum: 90, reported: zeroAt(90)}
		b := &fakeRPC{name: "b", blockNum: 90, extraNonce: 7}
		f := newFailover([]rpcClient{a, b})
		got, err := f.HeaderHash(context.Background(), 90)
		require.NoError(t, err)
		require.Equal(t, fakeReportedHash(90, 7), got, "the healthy endpoint's reported hash is served")
		require.Equal(t, 1, a.calls, "the violating endpoint was attempted and rotated past")
	})
}

// A null response (the endpoint does not have the block) is an honest "not
// found" — an attempt failure that rotates, distinct from the protocol
// violation above.
func TestHeaderReadsTreatAMissingBlockAsNotFound(t *testing.T) {
	a := &fakeRPC{name: "a", blockNum: 90, reported: map[uint64]*ReportedHeader{90: nil}}
	f := newFailover([]rpcClient{a})
	_, err := f.HeaderHash(context.Background(), 90)
	require.ErrorContains(t, err, "header 90 not found")

	b := &fakeRPC{name: "b", blockNum: 90, extraNonce: 3}
	f = newFailover([]rpcClient{a, b})
	got, err := f.HeaderHash(context.Background(), 90)
	require.NoError(t, err)
	require.Equal(t, fakeReportedHash(90, 3), got, "rotation reaches the endpoint that has the block")
}
