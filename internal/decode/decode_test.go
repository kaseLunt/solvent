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
