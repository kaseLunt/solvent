package decode

// The collateral-flag pair's decode proof, in three parts:
//
//  1. TOPIC0 IDENTITY — the registered IDs equal independently keccak-derived
//     hashes, so the embedded ABI and the canonical signature agree.
//  2. REAL BYTES — every committed fixture decodes to the concrete
//     (reserve, user) pair the chain recorded, from the same raw_logs custody
//     the deriver folds.
//  3. STRICTNESS — every shape violation the reader is written to refuse
//     actually refuses, one mutation per assertion. A strict reader with no
//     falsifying test is a comment.

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// The two topic0s, INDEPENDENTLY DERIVED. These literals are NOT the source of
// truth for dispatch — init() registers `aavePoolABI.Events[...].ID`, computed
// from the committed ABI — they are the cross-check. Both were re-derived with
// golang.org/x/crypto/sha3's Keccak256 over the canonical signature (a
// different code path from go-ethereum's abi package), and both independently
// match recon/report.md:100-101 and the chain-truth consult.
//
//	keccak256("ReserveUsedAsCollateralEnabled(address,address)")
//	keccak256("ReserveUsedAsCollateralDisabled(address,address)")
//
// The `00000` run inside the Disabled hash is genuine, not a transcription
// slip; it survives three independent derivations.
const (
	collateralEnabledTopic0Hex  = "0x00058a56ea94653cdf4f152d227ace22d4c00ad99e2a43f58cb7d9e3feb295f2"
	collateralDisabledTopic0Hex = "0x44c58d81365b66dd4b1a7f36c25aa97b8c71c361ee4937adc1a00000227db5dd"
)

// TestCollateralFlagTopic0sMatchIndependentDerivation is the anti-drift pin. If
// a future ABI re-export renamed or re-signed either event, the embedded ID
// would move and this test — not a silently empty fold in production — is what
// says so.
func TestCollateralFlagTopic0sMatchIndependentDerivation(t *testing.T) {
	require.Equal(t, common.HexToHash(collateralEnabledTopic0Hex),
		aavePoolABI.Events["ReserveUsedAsCollateralEnabled"].ID,
		"ABI-derived topic0 for ReserveUsedAsCollateralEnabled diverged from the independent keccak derivation")
	require.Equal(t, common.HexToHash(collateralDisabledTopic0Hex),
		aavePoolABI.Events["ReserveUsedAsCollateralDisabled"].ID,
		"ABI-derived topic0 for ReserveUsedAsCollateralDisabled diverged from the independent keccak derivation")

	// Both must actually be REGISTERED on the engine, not merely derivable: the
	// registry's unknown-topic contract is a silent skip, so an unregistered
	// event is indistinguishable from an absent one at the deriver.
	require.Contains(t, aaveTopics, common.HexToHash(collateralEnabledTopic0Hex))
	require.Contains(t, aaveTopics, common.HexToHash(collateralDisabledTopic0Hex))

	// The ABI's own indexing declaration is what makes topics[1]=reserve and
	// topics[2]=user correct. Assert it rather than trusting the reading.
	for _, name := range []string{"ReserveUsedAsCollateralEnabled", "ReserveUsedAsCollateralDisabled"} {
		ev := aavePoolABI.Events[name]
		require.Len(t, ev.Inputs, 2, name)
		require.Equal(t, "reserve", ev.Inputs[0].Name, name)
		require.Equal(t, "user", ev.Inputs[1].Name, name)
		require.True(t, ev.Inputs[0].Indexed, "%s: reserve must be indexed", name)
		require.True(t, ev.Inputs[1].Indexed, "%s: user must be indexed", name)
		require.Empty(t, ev.Inputs.NonIndexed(), "%s: no argument may live in the data section", name)
	}
}

func TestFixtureAaveReserveUsedAsCollateralEnabled(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_reserve_used_as_collateral_enabled.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveReserveUsedAsCollateralEnabled{
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c")},
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0xe1f8afc92644bfe77080d7dcb0f936f578e00f53")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got, isType := ev.(AaveReserveUsedAsCollateralEnabled)
		require.True(t, isType, fx.Provenance)
		require.Equal(t, want[i].Reserve, got.Reserve, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
		require.NotEqual(t, got.Reserve, got.User,
			"a fixture whose reserve equals its user could not falsify a topics[1]/topics[2] swap")
	}
	require.Equal(t, "AaveReserveUsedAsCollateralEnabled", want[0].Name())
}

func TestFixtureAaveReserveUsedAsCollateralDisabled(t *testing.T) {
	fixtures := loadLogFixtures(t, "aave_reserve_used_as_collateral_disabled.json")
	requireRealFixtureCount(t, fixtures, 2)
	want := []AaveReserveUsedAsCollateralDisabled{
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0xc922a3951b269b9a1dff1186355bcf6dc74e3993")},
		{Reserve: common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), User: common.HexToAddress("0x2c64a1d5d602e7fb6d21da6211dcecc6e17a0649")},
	}
	r := NewRegistry()
	for i, fx := range fixtures {
		ev, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		got, isType := ev.(AaveReserveUsedAsCollateralDisabled)
		require.True(t, isType, fx.Provenance)
		require.Equal(t, want[i].Reserve, got.Reserve, fx.Provenance)
		require.Equal(t, want[i].User, got.User, fx.Provenance)
	}
	require.Equal(t, "AaveReserveUsedAsCollateralDisabled", want[0].Name())
}

// TestCollateralFlagDecodeRefusesEveryMalformedShape mutates a REAL log one way
// at a time and requires an error each time. Each case names the production
// failure it stands in for.
func TestCollateralFlagDecodeRefusesEveryMalformedShape(t *testing.T) {
	r := NewRegistry()
	for _, file := range []string{
		"aave_reserve_used_as_collateral_enabled.json",
		"aave_reserve_used_as_collateral_disabled.json",
	} {
		base := loadLogFixtures(t, file)[0].rawLog()

		// Sanity: unmutated, it decodes. Without this, a broken mutator could
		// make every case below pass for the wrong reason.
		_, ok, err := r.Decode("aave_v3_etherfi", base)
		require.NoError(t, err, file)
		require.True(t, ok, file)

		cases := []struct {
			name   string
			mutate func(l *store.RawLog)
			// why names the real-world event this refusal is standing against.
			why string
		}{
			{
				name:   "arity 2 (indexed user dropped)",
				mutate: func(l *store.RawLog) { l.Topics = l.Topics[:2] },
				why:    "topics[2] would be out of range; tolerating it would mean guessing the user",
			},
			{
				name: "arity 4 (an extra topic)",
				mutate: func(l *store.RawLog) {
					l.Topics = append(l.Topics, make([]byte, 32))
				},
				why: "a fourth topic under this topic0 cannot come from this ABI — the emitter is not the event we registered",
			},
			{
				name:   "non-empty data",
				mutate: func(l *store.RawLog) { l.Data = make([]byte, 32) },
				why:    "an implementation upgrade that kept the name and changed the signature must fail, not have its body ignored (the A1 ReserveInitialized class)",
			},
			{
				name:   "one-byte data",
				mutate: func(l *store.RawLog) { l.Data = []byte{0x00} },
				why:    "the check is len(data) != 0, not a word-multiple test",
			},
			{
				name: "dirty upper pad on the reserve topic",
				mutate: func(l *store.RawLog) {
					t1 := append([]byte(nil), l.Topics[1]...)
					t1[0] = 0x01
					l.Topics[1] = t1
				},
				why: "common.BytesToAddress discards the upper 12 bytes, so a dirty word would read as a clean address",
			},
			{
				name: "dirty upper pad on the user topic",
				mutate: func(l *store.RawLog) {
					t2 := append([]byte(nil), l.Topics[2]...)
					t2[11] = 0xff
					l.Topics[2] = t2
				},
				why: "the last pad byte is as load-bearing as the first; a byte-11-only check would miss the boundary",
			},
			{
				name: "short reserve topic (20 bytes, no pad at all)",
				mutate: func(l *store.RawLog) {
					l.Topics[1] = l.Topics[1][12:]
				},
				why: "a 20-byte topic word is not what an indexed-address encoder produces; length is asserted before the pad",
			},
			{
				name: "over-long user topic (33 bytes)",
				mutate: func(l *store.RawLog) {
					l.Topics[2] = append(append([]byte(nil), l.Topics[2]...), 0x00)
				},
				why: "BytesToAddress on an over-long word silently takes a different 20 bytes",
			},
		}

		for _, tc := range cases {
			t.Run(file+"/"+tc.name, func(t *testing.T) {
				l := base
				l.Topics = append([][]byte(nil), base.Topics...)
				l.Data = append([]byte(nil), base.Data...)
				tc.mutate(&l)

				ev, ok, err := r.Decode("aave_v3_etherfi", l)
				require.Error(t, err, "REFUSED LOUD is the contract: %s", tc.why)
				require.False(t, ok, tc.why)
				require.Nil(t, ev, tc.why)
			})
		}
	}
}

// TestCollateralFlagZeroAddressTopicsAreLegal is the counterweight to the
// strictness suite: a zero-padded word whose address happens to be 0x0 is a
// CANONICAL encoding, and refusing it would be strictness that rejects valid
// chain data. Only the PAD is asserted, never the value.
func TestCollateralFlagZeroAddressTopicsAreLegal(t *testing.T) {
	base := loadLogFixtures(t, "aave_reserve_used_as_collateral_enabled.json")[0].rawLog()
	l := base
	l.Topics = [][]byte{base.Topics[0], make([]byte, 32), make([]byte, 32)}

	ev, ok, err := NewRegistry().Decode("aave_v3_etherfi", l)
	require.NoError(t, err)
	require.True(t, ok)
	got := ev.(AaveReserveUsedAsCollateralEnabled)
	require.Equal(t, common.Address{}, got.Reserve)
	require.Equal(t, common.Address{}, got.User)
}
