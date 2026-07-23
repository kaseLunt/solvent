package decode

import (
	"bytes"
	"encoding/json"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Decode contract: unknown topic0 / unknown engine -> skip, never error.
// ---------------------------------------------------------------------------

func TestDecodeUnknownTopic0Skips(t *testing.T) {
	r := NewRegistry()
	l := store.RawLog{
		ChainID: 10,
		Address: common.FromHex("0x0078C5a459132e279056B2371fE8A8eC973A9553"),
		Topics:  [][]byte{common.FromHex("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")},
		Data:    nil,
	}
	ev, ok, err := r.Decode("debt_manager", l)
	require.NoError(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
}

func TestDecodeUnknownEngineSkips(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_borrowed.json")
	r := NewRegistry()
	// A real, well-formed DM Borrowed log, but under an engine name that
	// isn't in the registry: still a skip, not an error -- the log simply
	// isn't in this (bogus) engine's allowlist.
	ev, ok, err := r.Decode("not_a_configured_engine", fixtures[0].rawLog())
	require.NoError(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
}

func TestDecodeEmptyTopicsSkips(t *testing.T) {
	r := NewRegistry()
	ev, ok, err := r.Decode("debt_manager", store.RawLog{Topics: nil})
	require.NoError(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
}

// ---------------------------------------------------------------------------
// Decode contract: known topic0 + malformed data -> error, never a skip.
// ---------------------------------------------------------------------------

func TestDecodeMalformedDataErrors(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_borrowed.json")
	l := fixtures[0].rawLog()
	// Borrowed's data is exactly one 32-byte word (amount); truncate it.
	require.Len(t, l.Data, 32)
	l.Data = l.Data[:16]

	r := NewRegistry()
	ev, ok, err := r.Decode("debt_manager", l)
	require.Error(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
	require.Contains(t, err.Error(), "DMBorrowed")
}

func TestDecodeMalformedTopicCountErrors(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_repaid.json")
	l := fixtures[0].rawLog()
	require.Len(t, l.Topics, 4) // topic0 + user + payer + token
	l.Topics = l.Topics[:3]     // drop the token topic

	r := NewRegistry()
	ev, ok, err := r.Decode("debt_manager", l)
	require.Error(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
	require.Contains(t, err.Error(), "expected 4 topics, got 3")
}

func TestDecodeMalformedLiquidatedArrayErrors(t *testing.T) {
	fixtures := loadLogFixtures(t, "dm_liquidated.json")
	l := fixtures[0].rawLog()
	// Truncate the tuple-array data mid-element -- the declared array length
	// (50-ish elements per the real log) now overruns the buffer.
	require.Greater(t, len(l.Data), 64)
	l.Data = l.Data[:64]

	r := NewRegistry()
	ev, ok, err := r.Decode("debt_manager", l)
	require.Error(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
}

// ---------------------------------------------------------------------------
// Aave / Chainlink engine malformed-data + unknown-topic0 spot checks (one
// per engine bucket, to cover the shared aave_v3_etherfi Pool+aToken table).
// ---------------------------------------------------------------------------

func TestDecodeAaveUnknownTopic0Skips(t *testing.T) {
	r := NewRegistry()
	bogusTopic0 := common.HexToHash("0x1234567890123456789012345678901234567890123456789012345678901234")
	l := store.RawLog{Topics: [][]byte{bogusTopic0.Bytes()}}
	ev, ok, err := r.Decode("aave_v3_etherfi", l)
	require.NoError(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
}

func TestDecodeChainlinkMalformedDataErrors(t *testing.T) {
	fixtures := loadLogFixtures(t, "chainlink_answer_updated.json")
	l := fixtures[0].rawLog()
	l.Data = l.Data[:10] // AnswerUpdated.updatedAt is one 32-byte word

	r := NewRegistry()
	ev, ok, err := r.Decode("chainlink_feed", l)
	require.Error(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
}

// ---------------------------------------------------------------------------
// Both ABI sources (DebtManagerCore.json, DebtManagerAdmin.json) declare the
// same event set with identical topic0 IDs -- the task brief names both as
// ABI sources; this pins that they agree rather than silently relying on
// only one.
// ---------------------------------------------------------------------------

func TestDebtManagerCoreAndAdminEventsMatch(t *testing.T) {
	adminABI := mustParseWrappedABI(debtManagerAdminRaw)
	for name, coreEvent := range debtManagerABI.Events {
		adminEvent, ok := adminABI.Events[name]
		require.Truef(t, ok, "event %s present in DebtManagerCore.json but missing from DebtManagerAdmin.json", name)
		require.Equalf(t, coreEvent.ID, adminEvent.ID, "event %s: topic0 mismatch between Core and Admin ABIs", name)
	}
	require.NotEmpty(t, debtManagerABI.Events)
}

// ---------------------------------------------------------------------------
// Migration seed bound: the position_events schema discriminates
// multi-event-per-log fan-out via a uint16 `seq` column, so DecodeMigrationCalldata
// must reject batches that would overflow it (senior-review-adjudicated
// producer-side guard, .superpowers/sdd/progress-phase2.md Task 3b).
// ---------------------------------------------------------------------------

func TestBuildMigrationSeedsAtMaxIsFine(t *testing.T) {
	addrs := make([]common.Address, maxMigrationSeeds)
	amounts := make([]*big.Int, maxMigrationSeeds)
	for i := range addrs {
		amounts[i] = big.NewInt(int64(i))
	}
	seeds, err := buildMigrationSeeds(addrs, amounts)
	require.NoError(t, err)
	require.Len(t, seeds, maxMigrationSeeds)
}

func TestBuildMigrationSeedsExceedsMaxErrors(t *testing.T) {
	addrs := make([]common.Address, maxMigrationSeeds+1)
	amounts := make([]*big.Int, maxMigrationSeeds+1)
	for i := range addrs {
		amounts[i] = big.NewInt(int64(i))
	}
	seeds, err := buildMigrationSeeds(addrs, amounts)
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "exceeds max")
}

func TestBuildMigrationSeedsLengthMismatchErrors(t *testing.T) {
	addrs := make([]common.Address, 3)
	amounts := make([]*big.Int, 2)
	seeds, err := buildMigrationSeeds(addrs, amounts)
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "length mismatch")
}

// ---------------------------------------------------------------------------
// DecodeMigrationCalldata error paths.
// ---------------------------------------------------------------------------

func TestDecodeMigrationCalldataTooShort(t *testing.T) {
	seeds, err := DecodeMigrationCalldata([]byte{0x01, 0x02})
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "too short")
}

func TestDecodeMigrationCalldataUnrecognizedSelector(t *testing.T) {
	input := append([]byte{0xde, 0xad, 0xbe, 0xef}, make([]byte, 64)...)
	seeds, err := DecodeMigrationCalldata(input)
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "unrecognized selector")
}

func TestDecodeMigrationCalldataMalformedArgsErrors(t *testing.T) {
	// Right selector, garbage/too-short body -- the outer ABI unpack must fail.
	input := append([]byte{0xdc, 0xfd, 0xeb, 0x60}, make([]byte, 4)...)
	seeds, err := DecodeMigrationCalldata(input)
	require.Error(t, err)
	require.Nil(t, seeds)
}

// ---------------------------------------------------------------------------
// Fix 1: unpackAddressUint256Arrays strict-parser adversarial fixtures
// (synthetic, hand-constructed to exercise rejection paths that real
// migration calldata -- itself always a genuine abi.encode output -- would
// never hit). Each fixture targets exactly one of the five distinct error
// texts the strict parser is required to produce.
// ---------------------------------------------------------------------------

// word32 encodes v as a canonical big-endian 32-byte ABI word.
func word32(t *testing.T, v *big.Int) []byte {
	t.Helper()
	b := make([]byte, 32)
	v.FillBytes(b)
	return b
}

// validMigrationMessage builds a canonical, synthetic
// abi.encode(address[] borrowers, uint256[] amounts) message via the same
// abi.Arguments the parser's canonicality backstop uses internally -- a
// known-good baseline for the mutation-based adversarial tests below.
func validMigrationMessage(t *testing.T, addrs []common.Address, amounts []*big.Int) []byte {
	t.Helper()
	got, err := migrationMessageArgs.Pack(addrs, amounts)
	require.NoError(t, err)
	return got
}

func TestUnpackAddressUint256ArraysTrailingGarbageErrors(t *testing.T) {
	msg := validMigrationMessage(t,
		[]common.Address{common.HexToAddress("0x1111111111111111111111111111111111111111")},
		[]*big.Int{big.NewInt(42)},
	)
	msg = append(msg, make([]byte, 32)...) // one extra garbage word appended
	addrs, amounts, err := unpackAddressUint256Arrays(msg)
	require.Error(t, err)
	require.Nil(t, addrs)
	require.Nil(t, amounts)
	require.Contains(t, err.Error(), "trailing bytes")
}

func TestUnpackAddressUint256ArraysDirtyAddressPaddingErrors(t *testing.T) {
	msg := validMigrationMessage(t,
		[]common.Address{common.HexToAddress("0x2222222222222222222222222222222222222222")},
		[]*big.Int{big.NewInt(7)},
	)
	// The sole address word starts right after the two head words (64) and
	// the array1 length word (32): byte offset 96. Dirty its upper pad.
	require.GreaterOrEqual(t, len(msg), 96+32)
	msg[96] = 0xff
	addrs, amounts, err := unpackAddressUint256Arrays(msg)
	require.Error(t, err)
	require.Nil(t, addrs)
	require.Nil(t, amounts)
	require.Contains(t, err.Error(), "dirty address padding")
}

func TestUnpackAddressUint256ArraysLengthMismatchErrors(t *testing.T) {
	// Two addresses, three amounts: each array is individually a canonical
	// ABI encoding of its own declared length (go-ethereum's Pack computes
	// correct per-array offsets regardless of cross-array length parity);
	// only the borrower/amount parallel-array invariant is violated.
	addrs := []common.Address{
		common.HexToAddress("0x3333333333333333333333333333333333333333"),
		common.HexToAddress("0x4444444444444444444444444444444444444444"),
	}
	amounts := []*big.Int{big.NewInt(1), big.NewInt(2), big.NewInt(3)}
	msg := validMigrationMessage(t, addrs, amounts)
	got, amts, err := unpackAddressUint256Arrays(msg)
	require.Error(t, err)
	require.Nil(t, got)
	require.Nil(t, amts)
	require.Contains(t, err.Error(), "array length mismatch")
}

func TestUnpackAddressUint256ArraysOversizedLengthErrors(t *testing.T) {
	// Hand-crafted, 96 bytes total: offsetA=64 (canonical); offsetB=999 is a
	// dummy value that must never even be examined, because the array1
	// length bound has to reject lenA=2^40 first -- BEFORE any allocation.
	// If this function ever attempted make() for 2^40 elements it would
	// hang or OOM; instead it must error immediately, which is what makes
	// this test timeout-free by construction (no explicit test-level
	// timeout needed -- the fast, small input proves the ordering).
	var msg []byte
	msg = append(msg, word32(t, big.NewInt(64))...)
	msg = append(msg, word32(t, big.NewInt(999))...)
	msg = append(msg, word32(t, new(big.Int).Lsh(big.NewInt(1), 40))...)
	require.Len(t, msg, 96)

	addrs, amounts, err := unpackAddressUint256Arrays(msg)
	require.Error(t, err)
	require.Nil(t, addrs)
	require.Nil(t, amounts)
	require.Contains(t, err.Error(), "fan-out exceeds")
}

func TestUnpackAddressUint256ArraysOffsetIntoHeadErrors(t *testing.T) {
	// offsetA=32 -- pointing back into the head's own second word (where
	// offsetB lives) instead of the only legal value, 64.
	var msg []byte
	msg = append(msg, word32(t, big.NewInt(32))...)
	msg = append(msg, word32(t, big.NewInt(64))...)
	msg = append(msg, word32(t, big.NewInt(0))...) // lenA=0, if ever read
	addrs, amounts, err := unpackAddressUint256Arrays(msg)
	require.Error(t, err)
	require.Nil(t, addrs)
	require.Nil(t, amounts)
	require.Contains(t, err.Error(), "non-canonical offset")
}

// TestUnpackAddressUint256ArraysCanonicalRoundTrips is the mutation tests'
// control: a canonical, synthetic message with several entries must still
// decode cleanly (no adversarial mutation applied).
func TestUnpackAddressUint256ArraysCanonicalRoundTrips(t *testing.T) {
	addrs := []common.Address{
		common.HexToAddress("0x5555555555555555555555555555555555555555"),
		common.HexToAddress("0x6666666666666666666666666666666666666666"),
		common.HexToAddress("0x0000000000000000000000000000000000000000"),
	}
	amounts := []*big.Int{big.NewInt(100), big.NewInt(0), bi("340282366920938463463374607431768211455")}
	msg := validMigrationMessage(t, addrs, amounts)
	gotAddrs, gotAmounts, err := unpackAddressUint256Arrays(msg)
	require.NoError(t, err)
	require.Equal(t, addrs, gotAddrs)
	require.Len(t, gotAmounts, len(amounts))
	for i := range amounts {
		require.Equal(t, 0, amounts[i].Cmp(gotAmounts[i]))
	}
}

// ---------------------------------------------------------------------------
// Decode fix round 2, Fix 1: outer-layer (commitAndExecute / execute302
// argument unpacking) full-consumption canonicality backstop
// (unpackOuterCanonical, decode.go). Mirrors the inner parser's adversarial
// coverage above, but at the outer layer and grounded in the two REAL
// migration-calldata fixtures (not synthetic): go-ethereum's generic
// abi.Arguments.Unpack alone tolerates trailing bytes appended after
// complete calldata and dirty (non-zero) upper-12-byte padding on an outer
// address word -- both must now error with "non-canonical outer calldata".
// The unmodified real fixtures decoding byte-identical seeds is pinned by
// TestDecodeMigrationCalldataCommitAndExecute / TestDecodeMigrationCalldataExecute302
// (fixtures_test.go), which continue to pass unchanged against this fix.
// ---------------------------------------------------------------------------

func TestDecodeMigrationCalldataCommitAndExecuteTrailingWordErrors(t *testing.T) {
	fx := loadMigrationCalldataFixture(t, "migration_calldata_commit_and_execute.json")
	input := append(common.FromHex(fx.Input), make([]byte, 32)...) // one extra word appended after complete calldata
	seeds, err := DecodeMigrationCalldata(input)
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "non-canonical outer calldata")
}

func TestDecodeMigrationCalldataCommitAndExecuteDirtyOuterAddressPaddingErrors(t *testing.T) {
	fx := loadMigrationCalldataFixture(t, "migration_calldata_commit_and_execute.json")
	input := common.FromHex(fx.Input)
	// _receiveLib is commitAndExecute's first argument and a static
	// (non-tuple, non-dynamic) address, so its word is always exactly the
	// first 32 bytes after the 4-byte selector, regardless of the specific
	// transaction; byte 0 of that word falls in its zero-padding region.
	require.GreaterOrEqual(t, len(input), 4+32)
	input[4] = 0xff
	seeds, err := DecodeMigrationCalldata(input)
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "non-canonical outer calldata")
}

func TestDecodeMigrationCalldataExecute302TrailingWordErrors(t *testing.T) {
	fx := loadMigrationCalldataFixture(t, "migration_calldata_execute302.json")
	input := append(common.FromHex(fx.Input), make([]byte, 32)...) // one extra word appended after complete calldata
	seeds, err := DecodeMigrationCalldata(input)
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "non-canonical outer calldata")
}

func TestDecodeMigrationCalldataExecute302DirtyOuterAddressPaddingErrors(t *testing.T) {
	fx := loadMigrationCalldataFixture(t, "migration_calldata_execute302.json")
	input := common.FromHex(fx.Input)
	// execute302 has exactly one argument, _executionParams, a dynamic tuple
	// (it contains `bytes` fields); as the sole argument its head word
	// (bytes [4:36] of input) is therefore always exactly the canonical
	// offset 32, and the tuple's own first field, `receiver` (address,
	// static), always starts immediately after at bytes [36:68] -- byte 36
	// falls in that address word's zero-padding region.
	require.GreaterOrEqual(t, len(input), 68)
	input[36] = 0xff
	seeds, err := DecodeMigrationCalldata(input)
	require.Error(t, err)
	require.Nil(t, seeds)
	require.Contains(t, err.Error(), "non-canonical outer calldata")
}

// ---------------------------------------------------------------------------
// Sanity: the migration ABI's computed topic0 matches recon's cited hash
// exactly (0x3f1c4431cbe26a58837755d2461e40a6561ee3edd0e31ca91edb845637acda8b,
// per recon/derivation-notes.md "Migration finding", cross-checked against
// `cast sig-event "MigrationBorrowerPositionsSet(address,uint256)"`).
// ---------------------------------------------------------------------------

func TestMigrationTopic0MatchesRecon(t *testing.T) {
	want := common.HexToHash("0x3f1c4431cbe26a58837755d2461e40a6561ee3edd0e31ca91edb845637acda8b")
	got := migrationABI.Events["MigrationBorrowerPositionsSet"].ID
	require.Equal(t, want, got)
}

// TestEmbeddedABIsAreWrappedConsistently pins the {"abi": [...]} shape shared
// by every embedded ABI file, per the task brief's note that AaveV3Pool.json
// wraps that way (and, empirically, so do the recon forge-artifact dumps and
// the hand-fetched aToken/aggregator copies).
func TestEmbeddedABIsAreWrappedConsistently(t *testing.T) {
	for _, raw := range [][]byte{debtManagerCoreRaw, debtManagerAdminRaw, aaveV3PoolRaw, aTokenRaw, chainlinkAggregatorRaw} {
		var w abiWrapper
		require.NoError(t, json.Unmarshal(raw, &w))
		require.NotEmpty(t, w.ABI)
		require.True(t, bytes.HasPrefix(bytes.TrimSpace(w.ABI), []byte("[")))
	}
}

// TestRegistryDecodeRecoversFromPanic exercises the defensive recover() in
// Registry.Decode by forcing a decode function to receive fewer topics than
// its own requireTopics guard would normally catch -- reflection-based tuple
// access on absent data is the class of bug the recover protects against,
// not a scenario reachable via requireTopics alone (already covered above),
// so this asserts the never-panic contract holds at the Decode boundary even
// under a corrupted (not just short) input.
func TestRegistryDecodeNeverPanics(t *testing.T) {
	r := NewRegistry()
	fixtures := loadLogFixtures(t, "dm_liquidated.json")
	l := fixtures[0].rawLog()
	// Corrupt the array-offset word inside a tuple[] payload so the reflected
	// length read walks off the end of the slice.
	corrupted := append([]byte(nil), l.Data...)
	for i := 0; i < 32; i++ {
		corrupted[i] = 0xff
	}
	l.Data = corrupted

	require.NotPanics(t, func() {
		_, _, _ = r.Decode("debt_manager", l)
	})
}
