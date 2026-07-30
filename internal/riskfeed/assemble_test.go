package riskfeed

import (
	"encoding/json"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Fixture scaffolding.
// ---------------------------------------------------------------------------

var (
	aaveOracle  = common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F")
	priceProv   = common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
	opWeETH     = common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")
	opUSDC      = common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	acctA       = common.HexToAddress("0xAAaa0000000000000000000000000000000000A1")
	acctB       = common.HexToAddress("0xBBbb0000000000000000000000000000000000B2")
	fixtureTime = time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
)

func fixtureRegistry(t *testing.T) *Registry {
	t.Helper()
	feeds := &config.Feeds{Assets: []config.Feed{
		{Chain: "eth", ChainID: 1, Engine: risk.AaveEngine, Address: weETH, Symbol: "weETH", Decimals: 18,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: aaveOracle, Method: "getAssetPrice(address)", PriceDecimals: 8}},
		{Chain: "eth", ChainID: 1, Engine: risk.AaveEngine, Address: usdc, Symbol: "USDC", Decimals: 6,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: aaveOracle, Method: "getAssetPrice(address)", PriceDecimals: 8}},
		// The UNCAPPED feed row for the same asset. It must never become a
		// valuation witness.
		{Chain: "eth", ChainID: 1, Engine: risk.AaveEngine, Address: weETH, Symbol: "weETH", Decimals: 18,
			Oracle: config.FeedOracle{Kind: config.FeedKindChainlinkStream,
				Contract: common.HexToAddress("0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5"), PriceDecimals: 8,
				Heartbeat: time.Hour, Grace: 30 * time.Minute}},
		{Chain: "op", ChainID: 10, Engine: risk.DMEngine, Address: opWeETH, Symbol: "weETH", Decimals: 18,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: priceProv, Method: "price(address)", PriceDecimals: 6}},
		{Chain: "op", ChainID: 10, Engine: risk.DMEngine, Address: opUSDC, Symbol: "USDC", Decimals: 6,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: priceProv, Method: "price(address)", PriceDecimals: 6}},
	}}
	r, err := NewRegistry(feeds)
	require.NoError(t, err)
	return r
}

func fixtureConfig(t *testing.T) AssembleConfig {
	t.Helper()
	return AssembleConfig{
		Registry: fixtureRegistry(t),
		Aave: EngineBinding{Engine: risk.AaveEngine, ChainID: 1,
			ParamEngine: risk.AaveParamEngine, PriceEngine: "prices:poll:1"},
		DM: EngineBinding{Engine: risk.DMEngine, ChainID: 10,
			ParamEngine: risk.DMEngine, PriceEngine: "prices:poll:10"},
		Budget:  PriceBudget{Seconds: 180},
		StepBps: 2000,
	}
}

func bal(engine string, acct common.Address, asset common.Address, side, source, amount string, block uint64) store.RiskBalanceRow {
	return store.RiskBalanceRow{
		Engine: engine, Account: acct.Bytes(), Asset: asset.Bytes(),
		Side: side, Source: source, Amount: bi(amount), UpdatedBlock: block,
	}
}

func idx(engine string, asset common.Address, kind, value string, block uint64) store.RiskRateIndexRow {
	return store.RiskRateIndexRow{Engine: engine, Asset: asset.Bytes(), Kind: kind, Value: bi(value), Block: block}
}

func price(chain uint64, asset common.Address, source, value string, decimals int32, age time.Duration) store.RiskPriceRow {
	return store.RiskPriceRow{
		ChainID: chain, Asset: asset.Bytes(), Source: source, Value: bi(value),
		Decimals: decimals, BlockNumber: 1000,
		ObservedAt:    fixtureTime,
		HasSourceAsOf: true, SourceAsOf: fixtureTime.Add(-age),
	}
}

func baseInputs() store.RiskInputs {
	return store.RiskInputs{
		ReadAt: fixtureTime,
		Cursors: []store.DeriveCursorState{
			{Engine: risk.AaveEngine, ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 0},
			{Engine: risk.AaveParamEngine, ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 0},
			{Engine: risk.DMEngine, ChainID: 10, LastBlock: 154_796_552, AckedEpoch: 0},
			{Engine: "prices:poll:1", ChainID: 1, LastBlock: 25_635_618, AckedEpoch: 0},
			{Engine: "prices:poll:10", ChainID: 10, LastBlock: 154_796_552, AckedEpoch: 0},
		},
		MaxEpochs: map[int64]int64{},
	}
}

func findPosition(t *testing.T, res AssembleResult, engine string, acct common.Address) store.RiskPositionWrite {
	t.Helper()
	for _, p := range res.Positions {
		if p.Engine == engine && common.BytesToAddress(p.Account) == acct {
			return p
		}
	}
	t.Fatalf("no %s position for %s in %d rows", engine, acct.Hex(), len(res.Positions))
	return store.RiskPositionWrite{}
}

func findAggregate(t *testing.T, res AssembleResult, engine string) store.RiskEngineAggregate {
	t.Helper()
	for _, a := range res.Aggregates {
		if a.Engine == engine {
			return a
		}
	}
	t.Fatalf("no aggregate for %s", engine)
	return store.RiskEngineAggregate{}
}

// ---------------------------------------------------------------------------
// Aave.
// ---------------------------------------------------------------------------

// TestAssembleAaveHealthFactor walks one full Aave position with HAND-COMPUTED
// expectations. Every integer below is derived on paper from the design's
// component list, never from the code under test:
//
//	live collateral   = rayMulFloor(1e18, 1 RAY)                = 1e18 weETH
//	collateral base   = floor(1e18 × 300000000000 / 1e18)       = 300000000000  ($3000 @ 8dec)
//	live debt         = rayMulCeil(1000000000, 1 RAY)           = 1000000000 USDC
//	debt base         = floor(1000000000 × 100000000 / 1e6)     = 100000000000 ($1000 @ 8dec)
//	weighted LT sum   = 300000000000 × 8100                     = 2430000000000000
//	HF (fused floor)  = floor(2430000000000000 × 1e18 / (10000 × 100000000000))
//	                  = floor(2.43e33 / 1e15)                   = 2430000000000000000
func TestAssembleAaveHealthFactor(t *testing.T) {
	in := baseInputs()
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "1000000000000000000", 25_635_618),
		bal(risk.AaveEngine, acctA, usdc, sideDebt, sourceEvent, "1000000000", 25_635_618),
	}
	in.Indexes = []store.RiskRateIndexRow{
		idx(risk.AaveEngine, weETH, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
		idx(risk.AaveEngine, usdc, kindVariableBorrowIndex, "1000000000000000000000000000", 25_610_000),
	}
	in.AaveParams = []store.ParamRow{
		collateralConfigRow(weETH, 20_714_007, 5, "7800", "8100", "10600"),
		collateralConfigRow(usdc, 20_714_100, 2, "7500", "7800", "10450"),
	}
	in.Prices = []store.RiskPriceRow{
		price(1, weETH, fixtureOracleSource, "300000000000", 8, 30*time.Second),
		price(1, usdc, fixtureOracleSource, "100000000", 8, 30*time.Second),
	}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Equal(t, "300000000000", p.TotalCollateralBase.String())
	require.Equal(t, "100000000000", p.TotalDebtBase.String())
	require.Equal(t, "2430000000000000", p.WeightedLTSum.String())
	require.Equal(t, "2430000000000000000", p.HFWad.String())
	require.Equal(t, "8100", p.AvgLTBps.String())
	require.False(t, p.HFInfinite)
	require.EqualValues(t, 8, p.ValueDecimals)

	// Three as-ofs, none of them one block standing in for all of them.
	require.EqualValues(t, 25_635_618, p.BalancesBlock)
	require.EqualValues(t, 25_635_618, p.ParamsBlock)
	require.EqualValues(t, 0, p.SweepBlock, "the Aave engine has no collateral sweep")
	require.NotNil(t, p.OldestPriceInput)

	// PER-ASSET index as-ofs, which trail the balances cursor by different
	// amounts and must not be collapsed into one stamp.
	legs := map[string]store.RiskLegWrite{}
	for _, l := range p.Legs {
		legs[common.BytesToAddress(l.Asset).Hex()] = l
	}
	require.EqualValues(t, 25_600_000, *legs[weETH.Hex()].CollateralIndexBlock)
	require.EqualValues(t, 25_610_000, *legs[usdc.Hex()].DebtIndexBlock)
	require.Equal(t, "300000000000", legs[weETH.Hex()].CollateralBase.String())
	require.Equal(t, "8100", legs[weETH.Hex()].LiqThreshold.String())
	require.Equal(t, "10600", legs[weETH.Hex()].LiqBonus.String(),
		"the bonus reached the persisted leg: without it, recovery arithmetic silently uses par")

	// The unwitnessed-collateral assumption travels WITH the number.
	require.Contains(t, p.Flags, FlagCollateralFlagUnwitnessed)
}

// TestAssembleAaveNeverFetchesTheUncappedFeed is the structural half of the
// adapter-output law: the uncapped row is not filtered downstream, it is never
// asked for.
func TestAssembleAaveNeverFetchesTheUncappedFeed(t *testing.T) {
	reg := fixtureRegistry(t)
	for _, k := range reg.PriceKeys() {
		require.NotContains(t, k.Source, "chainlink:",
			"an uncapped feed row must never appear in the valuation query's key set")
		require.NotContains(t, k.Source, "ratio:")
	}
	spec, ok := reg.Spec(risk.AaveEngine, weETH)
	require.True(t, ok)
	require.Equal(t, risk.ProvenanceAdapterOutput, spec.Provenance)

	spec, ok = reg.Spec(risk.DMEngine, opWeETH)
	require.True(t, ok)
	require.Equal(t, risk.ProvenanceEngineExact, spec.Provenance)
}

// TestRealFeedRegistryValuesAaveFromAdapterOutputOnly runs the same law against
// the COMMITTED registry, so a future feeds.json edit that pointed Aave at the
// stream fails here.
func TestRealFeedRegistryValuesAaveFromAdapterOutputOnly(t *testing.T) {
	// The chain map is built here rather than through config.Load: Load also
	// validates the RPC environment, and the acceptance suite deliberately runs
	// with SOLVENT_RPC_* UNSET. The chain ids are the ones config/contracts.json
	// declares, asserted below so a config edit cannot silently desync them.
	chains := map[string]config.Chain{
		"eth": {ChainID: 1},
		"op":  {ChainID: 10},
	}
	raw, err := os.ReadFile("../../config/contracts.json")
	require.NoError(t, err)
	var declared struct {
		Chains map[string]struct {
			ChainID uint64 `json:"chainId"`
		} `json:"chains"`
	}
	require.NoError(t, json.Unmarshal(raw, &declared))
	for key, want := range chains {
		got, ok := declared.Chains[key]
		require.True(t, ok, "config/contracts.json declares no %q chain", key)
		require.Equal(t, want.ChainID, got.ChainID,
			"this test's chain id for %q has drifted from config/contracts.json", key)
	}

	feeds, err := config.LoadFeeds("../../recon/feeds.json", chains)
	require.NoError(t, err)
	reg, err := NewRegistry(feeds)
	require.NoError(t, err)

	require.ElementsMatch(t, []string{risk.AaveEngine, risk.DMEngine}, reg.Engines())
	keys := reg.PriceKeys()
	require.NotEmpty(t, keys)
	for _, k := range keys {
		class, err := ProvenanceClass(k.Source)
		require.NoError(t, err)
		require.True(t, IsValuationClass(class), "source %q class %q", k.Source, class)
	}
	spec, ok := reg.Spec(risk.AaveEngine, weETH)
	require.True(t, ok, "the live Aave weETH reserve must have an adapter-output witness")
	require.Equal(t, risk.ProvenanceAdapterOutput, spec.Provenance)
	require.EqualValues(t, 18, spec.Decimals)
}

// TestRegistryFingerprintMovesWithTokenDecimals is the sharp case behind the
// registry fingerprint: `Assemble` divides by 10^decimals, so a corrected
// `decimals` changes every value that asset contributes — while every `prices` row,
// balance and cursor stays byte-identical.
//
// MUTANT THIS KILLS: drop Decimals from Registry.Fingerprint (or drop the
// fingerprint from the identity). The corrected configuration then derives the old
// materialization key and ADOPTS the incorrectly-scaled prior batch, so the fix
// never reaches a served number.
func TestRegistryFingerprintMovesWithTokenDecimals(t *testing.T) {
	build := func(decimals uint8) *Registry {
		feeds := &config.Feeds{Assets: []config.Feed{
			{Chain: "eth", ChainID: 1, Engine: risk.AaveEngine, Address: weETH, Symbol: "weETH", Decimals: decimals,
				Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: aaveOracle,
					Method: "getAssetPrice(address)", PriceDecimals: 8}},
		}}
		r, err := NewRegistry(feeds)
		require.NoError(t, err)
		return r
	}

	correct := build(18)
	wrong := build(8)
	require.NotEqual(t, correct.Fingerprint(), wrong.Fingerprint(),
		"a token-decimals-only change must move the fingerprint")

	// Same configuration twice is the same fingerprint — otherwise every restart
	// would be a new materialization and nothing would ever adopt.
	require.Equal(t, correct.Fingerprint(), build(18).Fingerprint())

	// And it really does move the arithmetic, so the fingerprint is guarding
	// something real rather than a label.
	require.EqualValues(t, 18, mustSpec(t, correct, weETH).Decimals)
	require.EqualValues(t, 8, mustSpec(t, wrong, weETH).Decimals)
}

// TestRegistryFingerprintMovesWithSourceAndProvenance: the other fields that can
// change which number is consumed.
func TestRegistryFingerprintMovesWithSourceAndProvenance(t *testing.T) {
	base := fixtureRegistry(t)

	otherOracle := &config.Feeds{Assets: []config.Feed{
		{Chain: "eth", ChainID: 1, Engine: risk.AaveEngine, Address: weETH, Symbol: "weETH", Decimals: 18,
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll,
				Contract: common.HexToAddress("0x00000000000000000000000000000000DEADBEEF"),
				Method:   "getAssetPrice(address)", PriceDecimals: 8}},
	}}
	moved, err := NewRegistry(otherOracle)
	require.NoError(t, err)
	require.NotEqual(t, base.Fingerprint(), moved.Fingerprint(),
		"a different oracle contract is a different price witness")
}

func mustSpec(t *testing.T, r *Registry, asset common.Address) AssetSpec {
	t.Helper()
	s, ok := r.Spec(risk.AaveEngine, asset)
	require.True(t, ok)
	return s
}

func TestAssembleAaveMissingPriceRefusesAndNamesTheAsset(t *testing.T) {
	in := baseInputs()
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "1000000000000000000", 25_635_618),
	}
	in.Indexes = []store.RiskRateIndexRow{
		idx(risk.AaveEngine, weETH, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
	}
	in.AaveParams = []store.ParamRow{collateralConfigRow(weETH, 20_714_007, 5, "7800", "8100", "10600")}
	// No price rows at all.

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateMissingInput, p.RefusalCode)
	require.Equal(t, weETH.Bytes(), p.RefusalAsset, "the unpriced asset is NAMED, never dropped")
	require.Nil(t, p.HFWad)
	require.Nil(t, p.TotalCollateralBase, "a refusal is the absence of a number, not a zero")
	require.Len(t, p.Prices, 1)
	require.Equal(t, VerdictMissing, p.Prices[0].Verdict)
	require.Equal(t, weETH.Bytes(), p.Prices[0].Asset)
}

func TestAssembleAaveMissingIndexRefuses(t *testing.T) {
	in := baseInputs()
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, usdc, sideDebt, sourceEvent, "1000000000", 25_635_618),
	}
	in.Prices = []store.RiskPriceRow{price(1, usdc, fixtureOracleSource, "100000000", 8, 0)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateStoreUnreadable, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "variable borrow index")
}

// TestAssembleAaveMissingThresholdRefusesRatherThanZeroing pins the whole point
// of the ledger: a missing liquidation threshold is a WRONG health factor, never
// a zero one.
func TestAssembleAaveMissingThresholdRefusesRatherThanZeroing(t *testing.T) {
	in := baseInputs()
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "1000000000000000000", 25_635_618),
		bal(risk.AaveEngine, acctA, usdc, sideDebt, sourceEvent, "1000000000", 25_635_618),
	}
	in.Indexes = []store.RiskRateIndexRow{
		idx(risk.AaveEngine, weETH, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
		idx(risk.AaveEngine, usdc, kindVariableBorrowIndex, "1000000000000000000000000000", 25_610_000),
	}
	// ONLY the registry row for weETH — the masking scenario, end to end.
	in.AaveParams = []store.ParamRow{reserveInitRow(weETH, 20_800_000, 2)}
	in.Prices = []store.RiskPriceRow{
		price(1, weETH, fixtureOracleSource, "300000000000", 8, 0),
		price(1, usdc, fixtureOracleSource, "100000000", 8, 0),
	}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateEngine, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "liquidation threshold")
	require.Nil(t, p.HFWad)
}

// ---------------------------------------------------------------------------
// Debt Manager — the three-state sweep.
// ---------------------------------------------------------------------------

func dmInputs() store.RiskInputs {
	in := baseInputs()
	in.Balances = []store.RiskBalanceRow{
		bal(risk.DMEngine, acctA, opUSDC, sideDebt, sourceEvent, "1000000000", 154_796_552),
		bal(risk.DMEngine, acctA, opWeETH, sideCollateral, sourceSnapshot, "1000000000000000000", 154_790_000),
	}
	in.Indexes = []store.RiskRateIndexRow{
		idx(risk.DMEngine, opUSDC, kindBorrowIndex, "1000000000000000000", 154_700_000),
	}
	in.DMParams = []store.ParamRow{{
		Engine: risk.DMEngine, ChainID: 10, Asset: opWeETH.Bytes(),
		LTV: bi("80000000000000000000"), LiqThreshold: bi("85000000000000000000"),
		LiqBonus:       bi("1000000000000000000"),
		EffectiveBlock: 150_000_000, EffectiveLogIndex: 0, SourceEvent: "collateral_token_config_set",
	}}
	in.Prices = []store.RiskPriceRow{
		price(10, opWeETH, "priceproviderv2", "3000000000", 6, 30*time.Second),
	}
	return in
}

// TestAssembleDMSuccessfulSweepComputes is the happy path, hand-computed:
//
//	value USD    = floor(1e18 × 3000000000 / 1e18) = 3000000000   ($3000 @ 6dec)
//	max borrow   = floor(3000000000 × 85e18 / 100e18) = 2550000000
//	live debt    = floor(1000000000 × 1e18 / 1e18)   = 1000000000 ($1000)
//	liquidatable = 1000000000 > 2550000000           = false
func TestAssembleDMSuccessfulSweepComputes(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Equal(t, "3000000000", p.CollateralValueUSD.String())
	require.Equal(t, "2550000000", p.MaxBorrowLT.String())
	require.Equal(t, "1000000000", p.Borrowings.String())
	require.NotNil(t, p.Liquidatable)
	require.False(t, *p.Liquidatable)
	require.EqualValues(t, 6, p.ValueDecimals)
	require.EqualValues(t, 154_790_000, p.SweepBlock,
		"DM collateral is as-of its OWN sweep block, not the derive cursor")
	require.NotContains(t, p.Flags, FlagSweepStale)
}

// TestAssembleDMNeverSweptRefusesRatherThanServingZeroCollateral is the
// `0xe957…bf20` posture at the row level: an account whose collateral has never
// been read holds an UNKNOWN amount, and HF≈0 over it is a false liquidation
// alarm against a possibly healthy borrower.
func TestAssembleDMNeverSweptRefusesRatherThanServingZeroCollateral(t *testing.T) {
	in := dmInputs()
	// Debt only — the sweep never ran, so no snapshot collateral row exists.
	in.Balances = []store.RiskBalanceRow{
		bal(risk.DMEngine, acctA, opUSDC, sideDebt, sourceEvent, "1000000000", 154_796_552),
	}
	in.Sweeps = nil // NO row at all: never attempted

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateSweepNever, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "NEVER been read")
	require.Nil(t, p.Liquidatable, "a refused position asserts NO liquidatable verdict")
	require.Nil(t, p.HFNum)
	require.Nil(t, p.CollateralValueUSD)
	require.EqualValues(t, 0, p.SweepBlock)
}

func TestAssembleDMFailedSweepWithNoSuccessEverRefuses(t *testing.T) {
	in := dmInputs()
	in.Balances = []store.RiskBalanceRow{
		bal(risk.DMEngine, acctA, opUSDC, sideDebt, sourceEvent, "1000000000", 154_796_552),
	}
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "failed",
		LastAttemptBlock: 154_795_000, LastSuccessBlock: 0, Attempts: 4, UpdatedAt: fixtureTime,
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateSweepNever, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "unknown, not zero")
	require.Nil(t, p.Liquidatable)
}

// TestAssembleDMFailedSweepWithPriorSuccessComputesAndFlags — the third state.
// The collateral IS known, just old, so it is computed with the stale flag and
// stamped at the block the last SUCCESS read it, never at the failed attempt.
func TestAssembleDMFailedSweepWithPriorSuccessComputesAndFlags(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "failed",
		LastAttemptBlock: 154_796_000, LastSuccessBlock: 154_700_000, Attempts: 2, UpdatedAt: fixtureTime,
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Contains(t, p.Flags, FlagSweepStale)
	require.EqualValues(t, 154_700_000, p.SweepBlock,
		"the stamp is the last SUCCESSFUL read, never the failed attempt")
}

func TestAssembleDMLiquidatableIsStrict(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}
	// Debt exactly equal to maxBorrowLT (2550000000): EQUALITY IS HEALTHY.
	in.Balances[0] = bal(risk.DMEngine, acctA, opUSDC, sideDebt, sourceEvent, "2550000000", 154_796_552)

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.False(t, *p.Liquidatable, "debt == maxBorrowLT is healthy (strict >)")

	in.Balances[0] = bal(risk.DMEngine, acctA, opUSDC, sideDebt, sourceEvent, "2550000001", 154_796_552)
	res, err = Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p = findPosition(t, res, risk.DMEngine, acctA)
	require.True(t, *p.Liquidatable, "one unit over is liquidatable")
}

// ---------------------------------------------------------------------------
// Gates and aggregates.
// ---------------------------------------------------------------------------

// TestAssembleG2RefusesOnlyTheAffectedChain proves the price-reorg gate is
// POSITION-scoped: an unacknowledged epoch on OP must not refuse the ETH book.
func TestAssembleG2RefusesOnlyTheAffectedChain(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}
	// An Aave position on the OTHER chain, fully healthy.
	in.Balances = append(in.Balances,
		bal(risk.AaveEngine, acctB, weETH, sideCollateral, sourceEvent, "1000000000000000000", 25_635_618))
	in.Indexes = append(in.Indexes,
		idx(risk.AaveEngine, weETH, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000))
	in.AaveParams = []store.ParamRow{collateralConfigRow(weETH, 20_714_007, 5, "7800", "8100", "10600")}
	in.Prices = append(in.Prices, price(1, weETH, fixtureOracleSource, "300000000000", 8, 0))

	// OP's price poller has an unacknowledged epoch; ETH's does not.
	in.MaxEpochs = map[int64]int64{10: 7}
	for i, c := range in.Cursors {
		if c.Engine == "prices:poll:10" {
			in.Cursors[i].AckedEpoch = 3
		}
	}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	dm := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, dm.Status)
	require.Equal(t, GatePriceReorg, dm.RefusalCode)
	require.Equal(t, VerdictReorgUnacked, dm.Prices[0].Verdict)

	aave := findPosition(t, res, risk.AaveEngine, acctB)
	require.Equal(t, store.RiskPositionComputed, aave.Status,
		"a price reorg on OP must NOT refuse the ETH book")
}

// TestAssembleFlagPropagatesIntoAggregate — oracle-sentinel R2/G4: a degraded
// input must be visible in every aggregate containing it.
func TestAssembleFlagPropagatesIntoAggregate(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}
	// Stale within ceiling: computed, flagged.
	in.Prices = []store.RiskPriceRow{price(10, opWeETH, "priceproviderv2", "3000000000", 6, 300*time.Second)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Contains(t, p.Flags, FlagStalePrice)
	require.True(t, p.StalePriceInputs, "internal/risk propagates Fresh=false onto the position")

	agg := findAggregate(t, res, risk.DMEngine)
	require.Equal(t, 1, agg.Positions)
	require.Equal(t, 1, agg.ComputedPositions)
	require.Equal(t, 1, agg.FlaggedPositions,
		"a flagged position must be visible in its engine's rollup: a clean total over degraded rows is the failure")
	require.Equal(t, "3000000000", agg.TotalCollateral.String())
	require.Equal(t, "1000000000", agg.TotalDebt.String())
}

// TestAssembleRefusedPositionsAreCountedNotSummed — folding a refusal in as zero
// would understate exactly the book the refusal exists to protect.
func TestAssembleRefusedPositionsAreCountedNotSummed(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}
	// A SECOND account that has never been swept.
	in.Balances = append(in.Balances,
		bal(risk.DMEngine, acctB, opUSDC, sideDebt, sourceEvent, "5000000000", 154_796_552))

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	agg := findAggregate(t, res, risk.DMEngine)
	require.Equal(t, 2, agg.Positions)
	require.Equal(t, 1, agg.ComputedPositions)
	require.Equal(t, 1, agg.RefusedPositions)
	require.Equal(t, "1000000000", agg.TotalDebt.String(),
		"the refused account's $5000 debt is NOT summed — and its absence is visible as a refusal count")
	require.Equal(t, 0, agg.LiquidatablePositions)
}

// TestAssembleEnginesAreNeverBlended — the two aggregates carry their own
// scales and are never one number (spec §5.2).
func TestAssembleEnginesAreNeverBlended(t *testing.T) {
	res, err := Assemble(baseInputs(), fixtureConfig(t))
	require.NoError(t, err)
	require.Len(t, res.Aggregates, 2)
	byEngine := map[string]store.RiskEngineAggregate{}
	for _, a := range res.Aggregates {
		byEngine[a.Engine] = a
	}
	require.EqualValues(t, 8, byEngine[risk.AaveEngine].ValueDecimals)
	require.EqualValues(t, 6, byEngine[risk.DMEngine].ValueDecimals)
}

// TestAssembleConflictedAccountWithNoRowsStillLandsAsARefusal is the THIRD high
// finding, pinned at the seam where it actually bit.
//
// MUTANT THIS KILLS: enumerating accounts from the balances map alone
// (`sortedAccounts(balances[engine])` instead of `accountSet(..., conflicts)`).
// `store.riskBalances` withholds EVERY row of a conflicted account — correctly —
// so under that code the account has no rows to be discovered from, produces no
// position at all, and the recorded conflict is never visited. The batch then
// contains no evidence the account exists, which downstream reads as "no
// position here": the false-safe direction, and the exact opposite of the G3
// refusal the withholding exists to produce.
//
// The fixture therefore supplies NO balance rows for the conflicted account —
// which is what the store really hands over — and still demands a refused row.
func TestAssembleConflictedAccountWithNoRowsStillLandsAsARefusal(t *testing.T) {
	in := baseInputs()
	// Exactly the store's output shape: rows withheld, conflict recorded.
	in.Balances = nil
	in.BalanceConflicts = []store.RiskBalanceConflict{{
		Engine:  risk.DMEngine,
		Account: acctB.Bytes(),
		Detail:  "event/snapshot balance conflict: engine \"debt_manager\" account b2 asset c1 side \"collateral\" has both event- and snapshot-sourced rows",
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	p := findPosition(t, res, risk.DMEngine, acctB)
	require.Equal(t, store.RiskPositionRefused, p.Status,
		"a conflicted account must land as a REFUSAL, never vanish from the batch")
	require.Equal(t, GateStoreUnreadable, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "both event- and snapshot-sourced rows")
	require.Nil(t, p.Liquidatable, "a refusal asserts no verdict")
	require.Nil(t, p.CollateralValueUSD)

	// And it is COUNTED — an aggregate that omitted it would report a clean book
	// over an account nobody could evaluate.
	agg := findAggregate(t, res, risk.DMEngine)
	require.Equal(t, 1, agg.Positions)
	require.Equal(t, 1, agg.RefusedPositions)
	require.Equal(t, 0, agg.ComputedPositions)
}

// TestAssembleConflictOnBothEnginesIsSeededPerEngine: the union seed is
// per-engine, so a conflict on one engine must not create a phantom position on
// the other.
func TestAssembleConflictOnBothEnginesIsSeededPerEngine(t *testing.T) {
	in := baseInputs()
	in.Balances = nil
	in.BalanceConflicts = []store.RiskBalanceConflict{
		{Engine: risk.AaveEngine, Account: acctA.Bytes(), Detail: "aave conflict"},
		{Engine: risk.DMEngine, Account: acctB.Bytes(), Detail: "dm conflict"},
	}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	require.Len(t, res.Positions, 2)

	aave := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, aave.Status)
	require.Equal(t, GateStoreUnreadable, aave.RefusalCode)
	dm := findPosition(t, res, risk.DMEngine, acctB)
	require.Equal(t, store.RiskPositionRefused, dm.Status)

	require.Equal(t, 1, findAggregate(t, res, risk.AaveEngine).RefusedPositions)
	require.Equal(t, 1, findAggregate(t, res, risk.DMEngine).RefusedPositions)
}

func TestAssembleBalanceConflictRefusesTheAccount(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}
	in.BalanceConflicts = []store.RiskBalanceConflict{{
		Engine: risk.DMEngine, Account: acctA.Bytes(),
		Detail: "event/snapshot balance conflict",
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateStoreUnreadable, p.RefusalCode)
}

// TestAssembleRefusesWhenAWatermarkIsMissing pins the engine-aware Marks law
// (risk's 4e requirement) at the seam that produces them: a cold-start engine
// whose derive cursor does not exist yet yields BalancesBlock 0, and a row
// stamped with block 0 would claim to be as-of genesis. internal/risk refuses
// it by NAME, and that refusal must surface as a refused ROW — never as a
// served zero.
func TestAssembleRefusesWhenAWatermarkIsMissing(t *testing.T) {
	// (a) Aave with NO param cursor: ParamsBlock is 0.
	in := baseInputs()
	in.Cursors = []store.DeriveCursorState{
		{Engine: risk.AaveEngine, ChainID: 1, LastBlock: 25_635_618},
		// aave_param deliberately absent — the param deriver has never run.
	}
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "1000000000000000000", 25_635_618),
	}
	in.Indexes = []store.RiskRateIndexRow{
		idx(risk.AaveEngine, weETH, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
	}
	in.AaveParams = []store.ParamRow{collateralConfigRow(weETH, 20_714_007, 5, "7800", "8100", "10600")}
	in.Prices = []store.RiskPriceRow{price(1, weETH, fixtureOracleSource, "300000000000", 8, 0)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateEngine, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "ParamsBlock",
		"the refusal must NAME the missing stamp, not merely report that one is missing")
	require.Nil(t, p.HFWad)

	// (b) Debt Manager: the SweepBlock leg is additionally required, and it is
	// the one that keeps a 60s-fresh price badge off hour-stale collateral.
	dm := dmInputs()
	dm.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}
	dm.Cursors = []store.DeriveCursorState{
		// No debt_manager cursor at all: BalancesBlock AND ParamsBlock are 0.
		{Engine: "prices:poll:10", ChainID: 10, LastBlock: 154_796_552},
	}
	res, err = Assemble(dm, fixtureConfig(t))
	require.NoError(t, err)
	p = findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateEngine, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "BalancesBlock")
	require.Nil(t, p.Liquidatable, "a refused DM position asserts no liquidatable verdict")
}

func TestAssembleSkipsFullyClosedPositions(t *testing.T) {
	in := baseInputs()
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "0", 25_635_618),
		bal(risk.AaveEngine, acctA, usdc, sideDebt, sourceEvent, "0", 25_635_618),
	}
	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	require.Empty(t, res.Positions, "an account whose every balance is zero is not a position")
}

func TestAssembleRefusesUnknownAsset(t *testing.T) {
	in := baseInputs()
	unknown := common.HexToAddress("0xDEAD00000000000000000000000000000000BEEF")
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, unknown, sideCollateral, sourceEvent, "1000", 25_635_618),
	}
	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateMissingInput, p.RefusalCode)
	require.Equal(t, unknown.Bytes(), p.RefusalAsset)
}

func TestAssembleDeterministicOrdering(t *testing.T) {
	in := dmInputs()
	in.Sweeps = []store.RiskSweepRow{
		{Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success", LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime},
		{Engine: risk.DMEngine, Account: acctB.Bytes(), Status: "success", LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime},
	}
	in.Balances = append(in.Balances,
		bal(risk.DMEngine, acctB, opUSDC, sideDebt, sourceEvent, "1", 154_796_552),
		bal(risk.DMEngine, acctB, opWeETH, sideCollateral, sourceSnapshot, "1000000000000000000", 154_790_000))

	first, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	for i := 0; i < 5; i++ {
		again, err := Assemble(in, fixtureConfig(t))
		require.NoError(t, err)
		require.Equal(t, len(first.Positions), len(again.Positions))
		for j := range first.Positions {
			require.Equal(t, first.Positions[j].Account, again.Positions[j].Account)
			require.Equal(t, first.Positions[j].Engine, again.Positions[j].Engine)
		}
	}
}

var _ = big.NewInt
