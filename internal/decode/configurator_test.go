package decode

// PoolConfigurator (engine "aave_param") decode tests.
//
// Every fixture in testdata/configurator_inventory.json is REAL chain bytes
// (blockNumber/txHash/logIndex provenance per entry), fetched twice from
// independent witnesses and compared byte-for-byte before being committed. The
// EXPECTED values were produced by a separate reference decoder driven off the
// verified ABI and the wire bytes -- never by the Go decoder under test.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// configuratorFixture is logFixture plus the expected decode: the event type
// name and a field→string map covering EVERY field the type carries.
type configuratorFixture struct {
	logFixture
	Event string            `json:"event"`
	Want  map[string]string `json:"want"`
}

func loadConfiguratorFixtures(t *testing.T) []configuratorFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "configurator_inventory.json"))
	require.NoError(t, err)
	var out []configuratorFixture
	require.NoError(t, json.Unmarshal(raw, &out))
	require.NotEmpty(t, out)
	return out
}

// configuratorFields flattens a decoded configurator event into the same
// field→string shape the fixtures carry. The type switch is EXHAUSTIVE by
// construction: an unhandled type fails the test rather than silently
// comparing an empty map, so a newly registered event cannot join the table
// without gaining an assertion here.
func configuratorFields(t *testing.T, ev Event) map[string]string {
	t.Helper()
	addr := func(a common.Address) string { return strings.ToLower(a.Hex()) }
	b := func(v bool) string {
		if v {
			return "true"
		}
		return "false"
	}
	switch e := ev.(type) {
	case AaveCfgCollateralConfigurationChanged:
		return map[string]string{"Asset": addr(e.Asset), "LTV": e.LTV.String(),
			"LiquidationThreshold": e.LiquidationThreshold.String(),
			"LiquidationBonus":     e.LiquidationBonus.String()}
	case AaveCfgReserveInitialized:
		return map[string]string{"Asset": addr(e.Asset), "AToken": addr(e.AToken),
			"StableDebtToken": addr(e.StableDebtToken), "VariableDebtToken": addr(e.VariableDebtToken),
			"InterestRateStrategy": addr(e.InterestRateStrategy)}
	case AaveCfgEModeAssetCategoryChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldCategoryID": fmt.Sprint(e.OldCategoryID), "NewCategoryID": fmt.Sprint(e.NewCategoryID)}
	case AaveCfgReserveInterestRateDataChanged:
		return map[string]string{"Asset": addr(e.Asset), "Strategy": addr(e.Strategy),
			"Data": "0x" + common.Bytes2Hex(e.Data)}
	case AaveCfgReserveInterestRateStrategyChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldStrategy": addr(e.OldStrategy), "NewStrategy": addr(e.NewStrategy)}
	case AaveCfgATokenUpgraded:
		return map[string]string{"Asset": addr(e.Asset), "Proxy": addr(e.Proxy),
			"Implementation": addr(e.Implementation)}
	case AaveCfgVariableDebtTokenUpgraded:
		return map[string]string{"Asset": addr(e.Asset), "Proxy": addr(e.Proxy),
			"Implementation": addr(e.Implementation)}
	case AaveCfgSupplyCapChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldSupplyCap": e.OldSupplyCap.String(), "NewSupplyCap": e.NewSupplyCap.String()}
	case AaveCfgBorrowCapChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldBorrowCap": e.OldBorrowCap.String(), "NewBorrowCap": e.NewBorrowCap.String()}
	case AaveCfgReserveFactorChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldReserveFactor": e.OldReserveFactor.String(), "NewReserveFactor": e.NewReserveFactor.String()}
	case AaveCfgDebtCeilingChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldDebtCeiling": e.OldDebtCeiling.String(), "NewDebtCeiling": e.NewDebtCeiling.String()}
	case AaveCfgLiquidationProtocolFeeChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldFee": e.OldFee.String(), "NewFee": e.NewFee.String()}
	case AaveCfgReserveBorrowing:
		return map[string]string{"Asset": addr(e.Asset), "Enabled": b(e.Enabled)}
	case AaveCfgReserveFlashLoaning:
		return map[string]string{"Asset": addr(e.Asset), "Enabled": b(e.Enabled)}
	case AaveCfgReserveStableRateBorrowing:
		return map[string]string{"Asset": addr(e.Asset), "Enabled": b(e.Enabled)}
	case AaveCfgBorrowableInIsolationChanged:
		return map[string]string{"Asset": addr(e.Asset), "Borrowable": b(e.Borrowable)}
	case AaveCfgSiloedBorrowingChanged:
		return map[string]string{"Asset": addr(e.Asset),
			"OldState": b(e.OldState), "NewState": b(e.NewState)}
	case AaveCfgFlashloanPremiumTotalUpdated:
		return map[string]string{"OldFlashloanPremiumTotal": e.OldFlashloanPremiumTotal.String(),
			"NewFlashloanPremiumTotal": e.NewFlashloanPremiumTotal.String()}
	case AaveCfgFlashloanPremiumToProtocolUpdated:
		return map[string]string{"OldFlashloanPremiumToProtocol": e.OldFlashloanPremiumToProtocol.String(),
			"NewFlashloanPremiumToProtocol": e.NewFlashloanPremiumToProtocol.String()}
	case AaveCfgUpgraded:
		return map[string]string{"Implementation": addr(e.Implementation)}
	default:
		t.Fatalf("configuratorFields: no assertion arm for decoded type %T (%s) — a newly registered event must gain one", ev, ev.Name())
		return nil
	}
}

// TestConfiguratorInventoryDecodesEveryTopic0 is the closure witness: every one
// of the 20 topic0s the Task-1 sweep found on this configurator decodes from
// REAL bytes into the expected typed event with every field exact, and the
// registered table is exactly that size (no more, no fewer).
func TestConfiguratorInventoryDecodesEveryTopic0(t *testing.T) {
	fixtures := loadConfiguratorFixtures(t)
	r := NewRegistry()

	seen := map[string]bool{}
	for _, fx := range fixtures {
		require.False(t, fx.Synthetic, "the inventory fixtures are real chain bytes only: %s", fx.Provenance)
		require.Equal(t, strings.ToLower("0x8438F4D29D895d75C86BDC25360c25eF0607E65d"),
			strings.ToLower(fx.Address), "every fixture must come from the configurator proxy")

		ev, ok, err := r.Decode("aave_param", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok, fx.Provenance)
		require.Equal(t, fx.Event, ev.Name(), fx.Provenance)
		require.NotEmpty(t, fx.Want, "fixture carries no expected fields: %s", fx.Provenance)
		require.Equal(t, fx.Want, configuratorFields(t, ev), fx.Provenance)

		seen[fx.Topics[0]] = true
	}

	require.Len(t, seen, 20, "the Task-1 sweep found exactly 20 distinct topic0 on this configurator")
	require.Equal(t, 20, ConfiguratorTopic0Count(),
		"the registered allowlist must be exactly the swept inventory — no unexercised extras, no silent shrinkage")
}

// TestConfiguratorReserveInitializedBodyIsExactlyThreeWords pins the A1 ruling's
// mechanism (strict hand-authored body reader under the canonical topic0) AND
// the chain-verified field assignment that replaced A1's stated layout.
//
// The discriminating half is the REJECTION: a body carrying a fourth word — the
// shape a five-NON-indexed-argument variant of this event would emit, and the
// shape go-ethereum's unpacker would happily consume while ignoring the tail —
// must be refused, not decoded.
func TestConfiguratorReserveInitializedBodyIsExactlyThreeWords(t *testing.T) {
	fixtures := loadConfiguratorFixtures(t)
	r := NewRegistry()

	var weETH *configuratorFixture
	for i := range fixtures {
		if fixtures[i].Event == "AaveCfgReserveInitialized" &&
			strings.EqualFold(fixtures[i].Topics[1][26:], "cd5fe23c85820f7b72d0926fc9b05b43e359b7ee") {
			weETH = &fixtures[i]
		}
	}
	require.NotNil(t, weETH, "the weETH ReserveInitialized fixture must be present")

	raw := weETH.rawLog()
	require.Len(t, raw.Topics, 3, "asset AND aToken are both indexed on the wire (refutes A1's 'aToken in data word 0')")
	require.Len(t, raw.Data, 96, "exactly three data words")

	ev, ok, err := r.Decode("aave_param", raw)
	require.NoError(t, err)
	require.True(t, ok)
	got := ev.(AaveCfgReserveInitialized)
	// topics[2] is the aToken proxy of the eth:atoken-weeth ingest stream —
	// the independent cross-check that the indexed slot really is the aToken.
	require.Equal(t, common.HexToAddress("0xbe1F842e7e0afd2c2322aae5d34bA899544b29db"), got.AToken)
	require.Equal(t, common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), got.Asset)
	// data word 0 answers symbol() with "stableDebtEthEtherFiweETH" on chain,
	// word 1 with "variableDebtEthEtherFiweETH" (verified 2026-07-28).
	require.Equal(t, common.HexToAddress("0x57a994227592652d58bbf3d52e34261df8b354d0"), got.StableDebtToken)
	require.Equal(t, common.HexToAddress("0x16264412cb72f0d16a446f7d928dd0d822810048"), got.VariableDebtToken)
	// word 2 is identical across all four reserve inits — the shared strategy.
	require.Equal(t, common.HexToAddress("0x5024e947ef81b9184faf0cff9b485446f01c8ed2"), got.InterestRateStrategy)

	// SYNTHETIC, and marked as such: a fourth word appended to the real body.
	fourWord := raw
	fourWord.Data = append(append([]byte{}, raw.Data...), make([]byte, 32)...)
	_, ok, err = r.Decode("aave_param", fourWord)
	require.Error(t, err, "a four-word ReserveInitialized body must be REFUSED, not silently truncated")
	require.False(t, ok)
	require.ErrorContains(t, err, "expected exactly 96 data bytes")

	// A three-word body is likewise not a licence for a dirty address pad.
	dirty := raw
	dirty.Data = append([]byte{}, raw.Data...)
	dirty.Data[0] = 0x01 // upper pad byte of the stableDebtToken word
	_, ok, err = r.Decode("aave_param", dirty)
	require.Error(t, err)
	require.False(t, ok)
	require.ErrorContains(t, err, "dirty address padding")

	// ...nor on an INDEXED address topic.
	dirtyTopic := raw
	dirtyTopic.Topics = [][]byte{raw.Topics[0], append([]byte{}, raw.Topics[1]...), raw.Topics[2]}
	dirtyTopic.Topics[1][0] = 0x01
	_, ok, err = r.Decode("aave_param", dirtyTopic)
	require.Error(t, err)
	require.False(t, ok)
	require.ErrorContains(t, err, "dirty address padding on indexed asset")
}

// TestConfiguratorCollateralConfigurationChangedIsRawBps pins THE param event's
// values as EMITTED: LTV 7800 / LT 8100 / bonus 10600 basis points for weETH,
// never normalized on the way through (recon/p3-probes.md: emitted once at
// reserve-init and NEVER re-tuned since).
func TestConfiguratorCollateralConfigurationChangedIsRawBps(t *testing.T) {
	fixtures := loadConfiguratorFixtures(t)
	r := NewRegistry()
	var found int
	for _, fx := range fixtures {
		if fx.Event != "AaveCfgCollateralConfigurationChanged" {
			continue
		}
		found++
		ev, ok, err := r.Decode("aave_param", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok)
		got := ev.(AaveCfgCollateralConfigurationChanged)
		require.Equal(t, common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"), got.Asset)
		require.Equal(t, 0, bi("7800").Cmp(got.LTV), "LTV in Aave bps (1e4), raw")
		require.Equal(t, 0, bi("8100").Cmp(got.LiquidationThreshold), "liquidation threshold in bps, raw")
		require.Equal(t, 0, bi("10600").Cmp(got.LiquidationBonus), "liquidation bonus in bps, raw")
		require.Equal(t, uint64(20713917), fx.BlockNumber)
	}
	require.Equal(t, 1, found, "exactly one CollateralConfigurationChanged exists on this instance")
}

// TestConfiguratorEModeCategoriesAreAllZero pins the eMode census against real
// bytes: all four EModeAssetCategoryChanged logs move 0 → 0.
func TestConfiguratorEModeCategoriesAreAllZero(t *testing.T) {
	fixtures := loadConfiguratorFixtures(t)
	r := NewRegistry()
	var found int
	for _, fx := range fixtures {
		if fx.Event != "AaveCfgEModeAssetCategoryChanged" {
			continue
		}
		found++
		ev, ok, err := r.Decode("aave_param", fx.rawLog())
		require.NoError(t, err, fx.Provenance)
		require.True(t, ok)
		got := ev.(AaveCfgEModeAssetCategoryChanged)
		require.Equal(t, uint8(0), got.OldCategoryID, fx.Provenance)
		require.Equal(t, uint8(0), got.NewCategoryID, fx.Provenance)
	}
	require.GreaterOrEqual(t, found, 1)
}

// TestConfiguratorUnknownTopic0IsNotKnown pins the Registry contract the param
// runner depends on: an unregistered topic0 comes back (nil, false, nil). The
// REFUSAL on that answer is the runner's job, not the registry's — see
// TestParamRunnerRefusesUnknownTopic0 in internal/derive.
func TestConfiguratorUnknownTopic0IsNotKnown(t *testing.T) {
	fixtures := loadConfiguratorFixtures(t)
	raw := fixtures[0].rawLog()
	raw.Topics = append([][]byte{}, raw.Topics...)
	raw.Topics[0] = common.HexToHash("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef").Bytes()

	ev, ok, err := NewRegistry().Decode("aave_param", raw)
	require.NoError(t, err)
	require.False(t, ok)
	require.Nil(t, ev)
}

// TestConfiguratorEngineIsolation: the configurator table is reachable ONLY
// through the aave_param engine. A configurator log offered to the Aave Pool
// engine is unknown (and vice versa), which is what keeps one engine's
// misconfigured stream from silently deriving another's events.
func TestConfiguratorEngineIsolation(t *testing.T) {
	fixtures := loadConfiguratorFixtures(t)
	r := NewRegistry()
	for _, fx := range fixtures {
		_, ok, err := r.Decode("aave_v3_etherfi", fx.rawLog())
		require.NoError(t, err)
		require.False(t, ok, "configurator topic0 must not decode under aave_v3_etherfi: %s", fx.Provenance)
	}

	aave := loadLogFixtures(t, "aave_borrow.json")
	_, ok, err := r.Decode("aave_param", aave[0].rawLog())
	require.NoError(t, err)
	require.False(t, ok, "a Pool topic0 must not decode under aave_param")
}

// TestConfiguratorStrictBodyRejections exercises the strict readers against
// the shapes go-ethereum's generic unpacker tolerates. Each mutation starts
// from a REAL log and changes exactly one thing.
func TestConfiguratorStrictBodyRejections(t *testing.T) {
	fixtures := loadConfiguratorFixtures(t)
	r := NewRegistry()
	pick := func(event string) configuratorFixture {
		for _, fx := range fixtures {
			if fx.Event == event {
				return fx
			}
		}
		t.Fatalf("no fixture for %s", event)
		return configuratorFixture{}
	}

	t.Run("trailing bytes after a complete body", func(t *testing.T) {
		raw := pick("AaveCfgSupplyCapChanged").rawLog()
		raw.Data = append(append([]byte{}, raw.Data...), 0x00)
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
		require.ErrorContains(t, err, "expected exactly 64 data bytes")
	})

	t.Run("bool word that is neither 0 nor 1", func(t *testing.T) {
		raw := pick("AaveCfgReserveBorrowing").rawLog()
		raw.Data = append([]byte{}, raw.Data...)
		raw.Data[31] = 0x02
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
		require.ErrorContains(t, err, "neither 0 nor 1")
	})

	t.Run("uint8 category out of range", func(t *testing.T) {
		raw := pick("AaveCfgEModeAssetCategoryChanged").rawLog()
		raw.Data = append([]byte{}, raw.Data...)
		raw.Data[30] = 0x01 // 0x0100 = 256, one past uint8
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
		require.ErrorContains(t, err, "does not fit in uint8")
	})

	t.Run("uint128 premium out of range", func(t *testing.T) {
		raw := pick("AaveCfgFlashloanPremiumTotalUpdated").rawLog()
		raw.Data = append([]byte{}, raw.Data...)
		raw.Data[0] = 0x01 // sets bit 255
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
		require.ErrorContains(t, err, "does not fit in uint128")
	})

	t.Run("dirty pad on a non-indexed address word", func(t *testing.T) {
		raw := pick("AaveCfgBorrowableInIsolationChanged").rawLog()
		raw.Data = append([]byte{}, raw.Data...)
		raw.Data[5] = 0xff
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
		require.ErrorContains(t, err, "dirty address padding on asset")
	})

	t.Run("wrong topic count", func(t *testing.T) {
		raw := pick("AaveCfgATokenUpgraded").rawLog()
		raw.Topics = raw.Topics[:3]
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
		require.ErrorContains(t, err, "expected 4 topics")
	})

	t.Run("non-canonical dynamic-bytes offset", func(t *testing.T) {
		raw := pick("AaveCfgReserveInterestRateDataChanged").rawLog()
		raw.Data = append([]byte{}, raw.Data...)
		raw.Data[31] = 0x40 // head offset 64 instead of the canonical 32
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
		require.ErrorContains(t, err, "non-canonical offset")
	})

	t.Run("dynamic-bytes length past the body", func(t *testing.T) {
		raw := pick("AaveCfgReserveInterestRateDataChanged").rawLog()
		raw.Data = append([]byte{}, raw.Data...)
		raw.Data[63] = 0xff // absurd blob length
		_, ok, err := r.Decode("aave_param", raw)
		require.Error(t, err)
		require.False(t, ok)
	})
}
