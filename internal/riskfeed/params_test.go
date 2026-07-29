package riskfeed

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

const (
	testAaveChain = uint64(1)
	testOPChain   = uint64(10)
)

var (
	weETH = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	usdc  = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
)

func bi(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad integer literal: " + s)
	}
	return v
}

func u8(v uint8) *uint8 { return &v }

// collateralConfigRow is a CollateralConfigurationChanged row: the three ratios
// set, every registry field nil.
func collateralConfigRow(asset common.Address, block uint64, logIdx uint32, ltv, lt, bonus string) store.ParamRow {
	return store.ParamRow{
		Engine:            risk.AaveParamEngine,
		ChainID:           testAaveChain,
		Asset:             asset.Bytes(),
		LTV:               bi(ltv),
		LiqThreshold:      bi(lt),
		LiqBonus:          bi(bonus),
		EffectiveBlock:    block,
		EffectiveLogIndex: logIdx,
		SourceEvent:       "aave_cfg_collateral_configuration_changed",
		TxHash:            []byte{0xaa},
	}
}

// reserveInitRow is a ReserveInitialized row: registry addresses set, every
// ratio nil. This is the row that MUST NOT mask a live threshold.
func reserveInitRow(asset common.Address, block uint64, logIdx uint32) store.ParamRow {
	return store.ParamRow{
		Engine:            risk.AaveParamEngine,
		ChainID:           testAaveChain,
		Asset:             asset.Bytes(),
		AToken:            []byte{0xbe, 0x01},
		VariableDebtToken: []byte{0xbe, 0x02},
		Strategy:          []byte{0xbe, 0x03},
		EffectiveBlock:    block,
		EffectiveLogIndex: logIdx,
		SourceEvent:       "aave_cfg_reserve_initialized",
		TxHash:            []byte{0xbb},
	}
}

// TestFoldParamsRegistryRowCannotMaskThreshold is THE masking-attempt fixture.
//
// The ledger holds a threshold-bearing row followed by a registry row that says
// nothing about thresholds. A last-ROW-wins fold produces a nil liquidation
// threshold — which downstream is either a refused position or, worse, a
// zero-threshold health factor. Only a per-FIELD fold survives it.
func TestFoldParamsRegistryRowCannotMaskThreshold(t *testing.T) {
	ledger := []store.ParamRow{
		collateralConfigRow(weETH, 20_714_007, 5, "7800", "8100", "10600"),
		reserveInitRow(weETH, 20_800_000, 2),
	}

	out, err := FoldParams(risk.AaveParamEngine, testAaveChain, ledger)
	require.NoError(t, err)
	require.Len(t, out, 1)

	got := out[0]
	require.Equal(t, weETH, got.Asset)
	require.NotNil(t, got.LiqThreshold, "the registry row must NOT mask the live liquidation threshold")
	require.Equal(t, "8100", got.LiqThreshold.String())
	require.Equal(t, "7800", got.LTV.String())
	require.Equal(t, "10600", got.LiqBonus.String(),
		"LiqBonus must be carried through: risk falls back to a 1.00x multiplier when it is absent, which silently understates seizure")

	// The stamp is the position of the newest CONTRIBUTING row, not of the
	// registry row that changed nothing.
	require.EqualValues(t, 20_714_007, got.EffectiveBlock)
	require.EqualValues(t, 5, got.EffectiveLogIndex)
	require.Equal(t, "aave_cfg_collateral_configuration_changed", got.Source)

	// And the naive fold really would have lost it — pinned so the test cannot
	// pass vacuously against an implementation that never had the hazard.
	require.Nil(t, ledger[len(ledger)-1].LiqThreshold,
		"the fixture's last row must carry NO threshold, or it does not test masking")
}

// TestFoldParamsLastNonNilPerField walks a ledger where each field is last set
// by a DIFFERENT row, so a fold that took any single row wholesale gets at least
// one field wrong.
func TestFoldParamsLastNonNilPerField(t *testing.T) {
	ledger := []store.ParamRow{
		{Engine: risk.AaveParamEngine, ChainID: testAaveChain, Asset: weETH.Bytes(),
			LTV: bi("7000"), LiqThreshold: bi("7500"), LiqBonus: bi("10500"),
			EffectiveBlock: 100, EffectiveLogIndex: 1, SourceEvent: "first"},
		// Threshold-only update.
		{Engine: risk.AaveParamEngine, ChainID: testAaveChain, Asset: weETH.Bytes(),
			LiqThreshold:   bi("8100"),
			EffectiveBlock: 200, EffectiveLogIndex: 0, SourceEvent: "second"},
		// LTV-only update, later.
		{Engine: risk.AaveParamEngine, ChainID: testAaveChain, Asset: weETH.Bytes(),
			LTV:            bi("7800"),
			EffectiveBlock: 300, EffectiveLogIndex: 7, SourceEvent: "third"},
	}

	out, err := FoldParams(risk.AaveParamEngine, testAaveChain, ledger)
	require.NoError(t, err)
	require.Len(t, out, 1)
	require.Equal(t, "7800", out[0].LTV.String(), "LTV from the third row")
	require.Equal(t, "8100", out[0].LiqThreshold.String(), "threshold from the second row")
	require.Equal(t, "10500", out[0].LiqBonus.String(), "bonus survives from the first row")
	require.EqualValues(t, 300, out[0].EffectiveBlock)
	require.EqualValues(t, 7, out[0].EffectiveLogIndex)
}

func TestFoldParamsSameBlockOrdersByLogIndex(t *testing.T) {
	ledger := []store.ParamRow{
		collateralConfigRow(weETH, 500, 3, "7000", "7500", "10500"),
		collateralConfigRow(weETH, 500, 9, "7800", "8100", "10600"),
	}
	out, err := FoldParams(risk.AaveParamEngine, testAaveChain, ledger)
	require.NoError(t, err)
	require.Equal(t, "8100", out[0].LiqThreshold.String(),
		"two changes in ONE block are ranked by log index, which is a total order")
	require.EqualValues(t, 9, out[0].EffectiveLogIndex)
}

func TestFoldParamsPerAsset(t *testing.T) {
	ledger := []store.ParamRow{
		collateralConfigRow(weETH, 100, 0, "7800", "8100", "10600"),
		collateralConfigRow(usdc, 110, 0, "7500", "7800", "10450"),
		reserveInitRow(weETH, 120, 0),
	}
	out, err := FoldParams(risk.AaveParamEngine, testAaveChain, ledger)
	require.NoError(t, err)
	require.Len(t, out, 2)
	byAsset, err := ParamsByAsset(out)
	require.NoError(t, err)
	require.Equal(t, "8100", byAsset[weETH].LiqThreshold.String())
	require.Equal(t, "7800", byAsset[usdc].LiqThreshold.String())
}

// TestFoldParamsPreservesEngineAndChainTags pins the guard internal/risk relies
// on. Storage never normalizes denominators, and the engine tag is the ONLY
// evidence of which convention a row carries: Aave basis points (1e4) versus the
// Debt Manager's HUNDRED_PERCENT (100e18). The two differ by 1e16.
func TestFoldParamsPreservesEngineAndChainTags(t *testing.T) {
	aave, err := FoldParams(risk.AaveParamEngine, testAaveChain,
		[]store.ParamRow{collateralConfigRow(weETH, 100, 0, "7800", "8100", "10600")})
	require.NoError(t, err)
	require.Equal(t, risk.AaveParamEngine, aave[0].Engine)
	require.EqualValues(t, testAaveChain, aave[0].ChainID)

	dmRow := store.ParamRow{
		Engine: risk.DMEngine, ChainID: testOPChain, Asset: weETH.Bytes(),
		LTV: bi("80000000000000000000"), LiqThreshold: bi("85000000000000000000"),
		LiqBonus:       bi("1000000000000000000"),
		EffectiveBlock: 10, EffectiveLogIndex: 0, SourceEvent: "collateral_token_config_set",
	}
	dm, err := FoldParams(risk.DMEngine, testOPChain, []store.ParamRow{dmRow})
	require.NoError(t, err)
	require.Equal(t, risk.DMEngine, dm[0].Engine)
	require.EqualValues(t, testOPChain, dm[0].ChainID)
	require.Equal(t, "85000000000000000000", dm[0].LiqThreshold.String(),
		"HUNDRED_PERCENT denominators are carried RAW; storage never normalizes")

	// And the tags are load-bearing all the way through: internal/risk refuses a
	// row routed to the wrong surface.
	_, err = risk.ComputeAaveHealth(risk.AaveInput{
		Account:  common.HexToAddress("0x01"),
		Reserves: []risk.AaveReserve{{Asset: weETH, Decimals: 18, ScaledCollateral: big.NewInt(1), CollateralIndex: risk.RayUnit(), UsedAsCollateral: true}},
		Params:   dm, // the DM-tagged fold, handed to the Aave surface
		Prices: []risk.PriceInput{{
			ChainID: 1, Asset: weETH, Source: "aaveoracle:0x1", Value: big.NewInt(1),
			Decimals: 8, Provenance: risk.ProvenanceAdapterOutput, Fresh: true,
		}},
		Marks: risk.Watermarks{BalancesBlock: 1, ParamsBlock: 1},
	})
	require.ErrorIs(t, err, risk.ErrParamEngineMismatch)
}

func TestFoldParamsRefusesMismatchedEngine(t *testing.T) {
	row := collateralConfigRow(weETH, 100, 0, "7800", "8100", "10600")
	row.Engine = risk.DMEngine
	_, err := FoldParams(risk.AaveParamEngine, testAaveChain, []store.ParamRow{row})
	require.ErrorIs(t, err, ErrParamEngineMismatch)
}

func TestFoldParamsRefusesMismatchedChain(t *testing.T) {
	row := collateralConfigRow(weETH, 100, 0, "7800", "8100", "10600")
	row.ChainID = testOPChain
	_, err := FoldParams(risk.AaveParamEngine, testAaveChain, []store.ParamRow{row})
	require.ErrorIs(t, err, ErrParamChainMismatch)
}

func TestFoldParamsRefusesUnorderedLedger(t *testing.T) {
	ledger := []store.ParamRow{
		collateralConfigRow(weETH, 300, 0, "7800", "8100", "10600"),
		collateralConfigRow(weETH, 200, 0, "7000", "7500", "10500"),
	}
	_, err := FoldParams(risk.AaveParamEngine, testAaveChain, ledger)
	require.ErrorIs(t, err, ErrParamLedgerUnordered)
}

func TestFoldParamsRefusesShortAddress(t *testing.T) {
	row := collateralConfigRow(weETH, 100, 0, "7800", "8100", "10600")
	row.Asset = []byte{0xCd, 0x5f}
	_, err := FoldParams(risk.AaveParamEngine, testAaveChain, []store.ParamRow{row})
	require.ErrorIs(t, err, ErrParamBadAddress)
}

// TestFoldParamsRefusesNonZeroEMode pins the guard that keeps riskd honest about
// a regime it cannot resolve: the per-USER eMode category is `getUserEMode`, an
// on-chain read the zero-RPC law forbids.
func TestFoldParamsRefusesNonZeroEMode(t *testing.T) {
	row := collateralConfigRow(weETH, 100, 0, "7800", "8100", "10600")
	row.EModeCategory = u8(3)
	_, err := FoldParams(risk.AaveParamEngine, testAaveChain, []store.ParamRow{row})
	require.ErrorIs(t, err, ErrParamEModeUnsupported)

	row.EModeCategory = u8(0)
	_, err = FoldParams(risk.AaveParamEngine, testAaveChain, []store.ParamRow{row})
	require.NoError(t, err, "category 0 is the live state and must fold normally")
}

// TestFoldParamsDoesNotAliasInput proves the fold copies: a caller mutating its
// ledger afterwards cannot change a folded threshold.
func TestFoldParamsDoesNotAliasInput(t *testing.T) {
	ledger := []store.ParamRow{collateralConfigRow(weETH, 100, 0, "7800", "8100", "10600")}
	out, err := FoldParams(risk.AaveParamEngine, testAaveChain, ledger)
	require.NoError(t, err)
	ledger[0].LiqThreshold.SetInt64(1)
	require.Equal(t, "8100", out[0].LiqThreshold.String())
}

func TestFoldParamsEmptyLedger(t *testing.T) {
	out, err := FoldParams(risk.AaveParamEngine, testAaveChain, nil)
	require.NoError(t, err)
	require.Empty(t, out)
}

func TestParamsByAssetRefusesDuplicates(t *testing.T) {
	rows := []risk.ParamRow{
		{Engine: risk.AaveParamEngine, ChainID: 1, Asset: weETH, LiqThreshold: bi("8100")},
		{Engine: risk.AaveParamEngine, ChainID: 1, Asset: weETH, LiqThreshold: bi("7500")},
	}
	_, err := ParamsByAsset(rows)
	require.Error(t, err)
}
