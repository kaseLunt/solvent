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
	"github.com/kaselunt/solvent/internal/decode"
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
			ParamEngine: risk.AaveParamEngine, PriceEngine: "prices:poll:1",
			GenesisBlock: fixtureAaveGenesis, CoverageBinding: fixtureAaveBinding},
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

// fixtureAaveGenesis is the ether.fi Aave market's configured start block
// (config/contracts.json, eth:aave-etherfi and its four aToken streams all begin
// here). The flag-custody gate asks for coverage reaching at or below it.
const fixtureAaveGenesis = 20_625_519

// fixtureAaveBinding is the WALKED SURFACE these fixtures claim — the weETH reserve's
// stream at the audited genesis. It is computed through the production helper, not
// written as a literal, so a change to the binding encoding cannot leave the fixtures
// claiming a surface no walker would stamp.
var fixtureAaveBinding = store.CoverageBindingOf(1, []store.CoverageStream{
	{Address: weETH.Bytes(), StartBlock: fixtureAaveGenesis},
})

// provenAaveCursor is the Aave derive cursor with PROVEN flag custody: walked from
// the engine's genesis under a decode registry that includes the collateral-flag
// pair. This is what a database that has completed the rewind-and-rederive looks
// like.
func provenAaveCursor(lastBlock uint64) store.DeriveCursorState {
	from := uint64(fixtureAaveGenesis)
	return store.DeriveCursorState{
		Engine: risk.AaveEngine, ChainID: 1, LastBlock: lastBlock, AckedEpoch: 0,
		CoveredFromBlock: &from, DecoderRevision: decode.RevisionAaveCollateralFlags,
		CoverageBinding: fixtureAaveBinding,
	}
}

// unprovenAaveCursor is the SAME cursor with no coverage provenance — precisely
// the live database's state before the owner-gated replay: at head, and derived by
// a binary that could not decode the flag events.
func unprovenAaveCursor(lastBlock uint64) store.DeriveCursorState {
	return store.DeriveCursorState{
		Engine: risk.AaveEngine, ChainID: 1, LastBlock: lastBlock, AckedEpoch: 0,
	}
}

// collFlag builds one latest-wins collateral-flag witness row.
//
// Every Aave fixture below that expects its collateral to COUNT now carries one,
// and that is not fixture bookkeeping added to satisfy the new code — it is what
// the Pool actually emits. A first supply into a collateral-configured reserve
// emits ReserveUsedAsCollateralEnabled in the same transaction as the aToken
// Mint. A fixture with a positive aToken balance and NO enable event is a state
// the chain cannot produce, so seeding one would be testing against an
// impossible substrate.
func collFlag(reserve, user common.Address, enabled bool, block uint64, logIndex uint32) store.CollateralFlagRow {
	return store.CollateralFlagRow{
		Engine: risk.AaveEngine, ChainID: 1,
		Reserve: reserve.Bytes(), User: user.Bytes(),
		Enabled: enabled, Block: block, LogIndex: logIndex,
	}
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
			// THE COLLATERAL LAW'S PRECONDITION, MADE EXPLICIT IN THE FIXTURE.
			//
			// Every Aave test below that expects a COMPUTED position needs derived
			// state whose walk provably began at the engine's genesis under a decode
			// registry that recognizes the flag events — otherwise the assembler
			// refuses the whole book (GateFlagCustodyUnproven), and rightly so.
			// Spelling it here rather than defaulting it means "genuine no-history
			// under PROVEN custody" and "unproven custody" are different fixtures
			// that cannot be confused, which is the distinction the round-1 finding
			// turned on.
			provenAaveCursor(25_635_618),
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
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

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

	// THE FLAG IS NOW WITNESSED, so the number carries no assumption to disclose.
	// Under the retired posture this position was flagged
	// `aave_collateral_flag_unwitnessed`; with an ENABLED witness it is clean, and
	// the leg records the witness rather than a guess.
	require.Empty(t, p.Flags,
		"a witnessed-enabled, fresh-priced position has nothing to disclose")
	require.NotNil(t, legs[weETH.Hex()].UsedAsCollateral)
	require.True(t, *legs[weETH.Hex()].UsedAsCollateral,
		"the leg carries the WITNESS, per-row, not a blanket assumption")
	require.Len(t, res.ConsultedFlags, 1,
		"exactly the witnesses read: weETH is witnessed, USDC has no history and contributes no digest entry")
	require.Equal(t, weETH.Bytes(), res.ConsultedFlags[0].Reserve)
	require.EqualValues(t, 20_714_007, res.ConsultedFlags[0].Block,
		"the witness carries its OWN as-of, not the balances cursor's")
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
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}
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
	// The enable witness is LOAD-BEARING here. Without it the reserve stops
	// counting as collateral, internal/risk stops requiring a liquidation
	// threshold for it, and this test would pass by no longer exercising the
	// masking hazard at all — a green that proves nothing.
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateEngine, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "liquidation threshold")
	require.Nil(t, p.HFWad)
}

// ---------------------------------------------------------------------------
// The collateral law — three states, one direction.
// ---------------------------------------------------------------------------

// flagLawInputs is one weETH-collateral / USDC-debt Aave position with the
// collateral flag DELIBERATELY UNSET, so each test below supplies exactly the
// witness state it is about.
func flagLawInputs() store.RiskInputs {
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
	return in
}

// TestAssembleAaveWitnessedEnableCountsCollateral is the first of the three
// states, stated on its own so the other two are diffs against a known baseline.
func TestAssembleAaveWitnessedEnableCountsCollateral(t *testing.T) {
	in := flagLawInputs()
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Equal(t, "300000000000", p.TotalCollateralBase.String())
	require.Equal(t, "2430000000000000", p.WeightedLTSum.String())
	require.Equal(t, "2430000000000000000", p.HFWad.String())
	require.Empty(t, p.Flags)
}

// TestAssembleAaveNoFlagHistoryMeansNotCollateral is the 34-row class on the live
// book (USDC / FRAX / PYUSD): reserves never configured as collateral, so their
// auto-enable never fired and no flag event exists for them at all.
//
// This is also the PHANTOM-ENTRY half of the identity proof: a leg resolved by the
// no-history law must contribute NOTHING to ConsultedFlags, because that slice is
// exactly what the substrate digest hashes. The identity-side half is
// TestIdentityNoFlagHistoryAddsNoDigestEntry.
//
// MUTANT THIS KILLS: default `usedAsCollateral` to true when no witness row
// exists (i.e. restore the retired assume-true posture). The collateral total
// below jumps back to 300000000000 and the disclosure flag disappears.
func TestAssembleAaveNoFlagHistoryMeansNotCollateral(t *testing.T) {
	in := flagLawInputs()
	in.CollateralFlags = nil // never enabled, on any reserve, for anyone

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)

	require.Equal(t, store.RiskPositionComputed, p.Status,
		"no-history is a chain FACT, not a missing input: the position still computes")
	require.Equal(t, "0", p.TotalCollateralBase.String(),
		"a reserve that was never enabled contributes NO counted collateral")
	require.Equal(t, "0", p.WeightedLTSum.String())
	require.Equal(t, "100000000000", p.TotalDebtBase.String(),
		"the DEBT is untouched — the law shrinks collateral only, never inflates it")
	require.False(t, p.HFInfinite, "collateral 0 against real debt is HF 0, not infinite")
	require.Equal(t, "0", p.HFWad.String())

	require.Contains(t, p.Flags, FlagCollateralNeverEnabled,
		"the operator must be able to reconcile a real balance against a zero collateral total")
	require.NotContains(t, p.Flags, FlagCollateralOptedOut,
		"no-history is not an opt-out and must not be reported as one")

	legs := map[string]store.RiskLegWrite{}
	for _, l := range p.Legs {
		legs[common.BytesToAddress(l.Asset).Hex()] = l
	}
	require.NotNil(t, legs[weETH.Hex()].UsedAsCollateral)
	require.False(t, *legs[weETH.Hex()].UsedAsCollateral)
	require.Equal(t, "1000000000000000000", legs[weETH.Hex()].ScaledCollateral.String(),
		"the BALANCE is still disclosed in full — only its collateral status changed")

	require.Empty(t, res.ConsultedFlags,
		"NO PHANTOM DIGEST ENTRIES: an absent witness is the no-history law, not substrate")
}

// TestAssembleAaveWitnessedDisableExcludesCollateral is the one genuine opt-out on
// the live book (weETH dust, flag off since block 22,551,863) — the row where the
// retired assume-true posture was wrong in the FALSE-SAFETY direction, overstating
// health for a user who had explicitly turned collateral off.
func TestAssembleAaveWitnessedDisableExcludesCollateral(t *testing.T) {
	in := flagLawInputs()
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, false, 22_551_863, 342)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)

	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Equal(t, "0", p.TotalCollateralBase.String())
	require.Equal(t, "0", p.HFWad.String(),
		"the assume-true posture served 2.43 here; the witness says this borrower has no counted collateral")
	require.Contains(t, p.Flags, FlagCollateralOptedOut)
	require.NotContains(t, p.Flags, FlagCollateralNeverEnabled,
		"a WITNESSED disable is a user decision and must be distinguishable from never-configured")

	require.Len(t, res.ConsultedFlags, 1)
	require.False(t, res.ConsultedFlags[0].Enabled)
	require.EqualValues(t, 22_551_863, res.ConsultedFlags[0].Block)
	require.EqualValues(t, 342, res.ConsultedFlags[0].LogIndex)
}

// TestAssembleAaveZeroBalanceNeedsNoDisclosure: the flags exist to explain a
// balance that does not count. A reserve with a positive DEBT leg and no
// collateral has nothing to explain, so it must not be flagged — otherwise the
// disclosure returns to marking the whole book, which is what retiring
// `aave_collateral_flag_unwitnessed` was for.
func TestAssembleAaveZeroBalanceNeedsNoDisclosure(t *testing.T) {
	in := flagLawInputs()
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)

	// USDC is debt-only and has NO flag history. It is not flagged.
	require.Empty(t, p.Flags)
	legs := map[string]store.RiskLegWrite{}
	for _, l := range p.Legs {
		legs[common.BytesToAddress(l.Asset).Hex()] = l
	}
	require.NotNil(t, legs[usdc.Hex()].UsedAsCollateral)
	require.False(t, *legs[usdc.Hex()].UsedAsCollateral,
		"a debt-only leg still carries the witnessed value, and the witness says false")
}

// TestAssembleAaveStableReserveDropsCollateralButNotHealthFactor encodes the
// DISCLOSED BEHAVIOUR CHANGE as an executable fact, both halves at once.
//
// On the live book the ~34 flipping rows are USDC / FRAX / PYUSD, whose LT is 0 in
// param custody because they were initialized at LTV 0 and never
// collateral-configured. So the same change that DROPS served collateral
// aggregates leaves health factors EXACTLY where they were: the numerator term
// Σ(Cᵢ·LTᵢ) contributed zero either way. The old numbers were right by accident;
// the collateral totals were simply wrong.
//
// The two assemblies below differ ONLY in the stable reserve's flag, which is the
// cleanest available statement of "what this wave changed".
func TestAssembleAaveStableReserveDropsCollateralButNotHealthFactor(t *testing.T) {
	build := func(stableEnabled bool) store.RiskInputs {
		in := baseInputs()
		in.Balances = []store.RiskBalanceRow{
			bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "1000000000000000000", 25_635_618),
			// The stable reserve, held as collateral and priced at $1.
			bal(risk.AaveEngine, acctA, usdc, sideCollateral, sourceEvent, "500000000", 25_635_618),
		}
		in.Indexes = []store.RiskRateIndexRow{
			idx(risk.AaveEngine, weETH, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
			idx(risk.AaveEngine, usdc, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
		}
		in.AaveParams = []store.ParamRow{
			collateralConfigRow(weETH, 20_714_007, 5, "7800", "8100", "10600"),
			// LTV 0 / LT 0: exactly what the configurator ledger holds for the
			// stable reserves on this market — they were never given a
			// CollateralConfigurationChanged at all.
			collateralConfigRow(usdc, 20_714_100, 2, "0", "0", "0"),
		}
		in.Prices = []store.RiskPriceRow{
			price(1, weETH, fixtureOracleSource, "300000000000", 8, 30*time.Second),
			price(1, usdc, fixtureOracleSource, "100000000", 8, 30*time.Second),
		}
		in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}
		if stableEnabled {
			in.CollateralFlags = append(in.CollateralFlags, collFlag(usdc, acctA, true, 20_714_101, 3))
		}
		return in
	}

	// `true` reproduces the RETIRED posture for the stable reserve; `false` (no
	// witness row) is the new law's answer for it.
	assumeTrue, err := Assemble(build(true), fixtureConfig(t))
	require.NoError(t, err)
	witnessed, err := Assemble(build(false), fixtureConfig(t))
	require.NoError(t, err)

	before := findPosition(t, assumeTrue, risk.AaveEngine, acctA)
	after := findPosition(t, witnessed, risk.AaveEngine, acctA)

	// COLLATERAL DROPS, by exactly the stable reserve's $500 at 8 decimals.
	require.Equal(t, "350000000000", before.TotalCollateralBase.String())
	require.Equal(t, "300000000000", after.TotalCollateralBase.String())
	beforeAgg := findAggregate(t, assumeTrue, risk.AaveEngine)
	afterAgg := findAggregate(t, witnessed, risk.AaveEngine)
	require.Equal(t, "350000000000", beforeAgg.TotalCollateral.String())
	require.Equal(t, "300000000000", afterAgg.TotalCollateral.String(),
		"served Aave collateral aggregates DROP — the disclosed, expected change")

	// AND THE HEALTH FACTOR DOES NOT MOVE, because LT is 0 on the reserve that
	// stopped counting.
	require.Equal(t, before.WeightedLTSum.String(), after.WeightedLTSum.String(),
		"Σ(Cᵢ·LTᵢ) is unchanged: the stable reserve's LT was already 0")
	require.True(t, before.HFInfinite, "no debt in this fixture")
	require.Equal(t, before.HFInfinite, after.HFInfinite)

	// The average LT DOES move, and honestly so: the denominator lost collateral
	// that was contributing nothing to the numerator, so the book-average
	// threshold it reports was diluted before and is exact now.
	require.Equal(t, "6942", before.AvgLTBps.String())
	require.Equal(t, "8100", after.AvgLTBps.String(),
		"avgLT stops being diluted by collateral the engine never counted")

	require.Contains(t, after.Flags, FlagCollateralNeverEnabled)
}

// TestAssembleAaveStableReserveWithNoThresholdRowComputesOnlyOnceWitnessed is the
// LIVE-BOOK SHAPE, and it is a bigger change than "collateral aggregates drop".
//
// On the live market `param_history` carries a liquidation threshold for exactly
// ONE asset — weETH, 8100. USDC / FRAX / PYUSD have NO threshold row at all: they
// were initialized and never given a CollateralConfigurationChanged, so their
// folded param row exists (from ReserveInitialized) with a NIL threshold. That is
// absent, not zero.
//
// Under the retired assume-true posture those legs COUNTED as collateral, and
// internal/risk correctly refuses a counting reserve with no threshold
// (ErrMissingParam — "a missing liquidation threshold is a WRONG health factor,
// never a zero one"). So the first riskd pass over the live book would have
// REFUSED every account holding stable collateral — 31 accounts / 34 legs — not
// merely overstated their collateral. Reading the flag turns those refusals into
// computed positions, because a reserve the chain never enabled needs no threshold.
//
// Both directions are asserted here, from ONE fixture differing only in the flag.
func TestAssembleAaveStableReserveWithNoThresholdRowComputesOnlyOnceWitnessed(t *testing.T) {
	build := func(stableFlag []store.CollateralFlagRow) store.RiskInputs {
		in := baseInputs()
		in.Balances = []store.RiskBalanceRow{
			bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "1000000000000000000", 25_635_618),
			bal(risk.AaveEngine, acctA, usdc, sideCollateral, sourceEvent, "500000000", 25_635_618),
		}
		in.Indexes = []store.RiskRateIndexRow{
			idx(risk.AaveEngine, weETH, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
			idx(risk.AaveEngine, usdc, kindLiquidityIndex, "1000000000000000000000000000", 25_600_000),
		}
		in.AaveParams = []store.ParamRow{
			collateralConfigRow(weETH, 20_714_007, 5, "7800", "8100", "10600"),
			// EXACTLY the live shape: a ReserveInitialized row and nothing else, so
			// the folded threshold is NIL.
			reserveInitRow(usdc, 20_714_100, 2),
		}
		in.Prices = []store.RiskPriceRow{
			price(1, weETH, fixtureOracleSource, "300000000000", 8, 30*time.Second),
			price(1, usdc, fixtureOracleSource, "100000000", 8, 30*time.Second),
		}
		in.CollateralFlags = append([]store.CollateralFlagRow{
			collFlag(weETH, acctA, true, 20_714_007, 6),
		}, stableFlag...)
		return in
	}

	// (a) The RETIRED posture, reproduced by witnessing the stable reserve ENABLED:
	// counting collateral with no threshold row is a refusal, and rightly so.
	assumeTrue, err := Assemble(build([]store.CollateralFlagRow{collFlag(usdc, acctA, true, 20_714_101, 3)}),
		fixtureConfig(t))
	require.NoError(t, err)
	refused := findPosition(t, assumeTrue, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, refused.Status,
		"counting a reserve with NO threshold row must refuse — this is what the live book would have done")
	require.Equal(t, GateEngine, refused.RefusalCode)
	require.Contains(t, refused.RefusalDetail, "liquidation threshold")
	require.Nil(t, refused.HFWad)

	// (b) THE NEW LAW: no flag history for the stable reserve, so it does not count,
	// so no threshold is required, so the position COMPUTES — over the weETH
	// collateral that genuinely is enabled.
	witnessed, err := Assemble(build(nil), fixtureConfig(t))
	require.NoError(t, err)
	computed := findPosition(t, witnessed, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, computed.Status,
		"a reserve the chain never enabled needs no liquidation threshold, so the account is servable again")
	require.Equal(t, "300000000000", computed.TotalCollateralBase.String(),
		"only the witnessed-enabled weETH counts")
	require.Equal(t, "2430000000000000", computed.WeightedLTSum.String())
	require.Contains(t, computed.Flags, FlagCollateralNeverEnabled)

	// The refusal really did suppress a whole position from the aggregate, which is
	// the direction of the improvement: a refused row contributes nothing.
	require.Equal(t, 1, findAggregate(t, assumeTrue, risk.AaveEngine).RefusedPositions)
	require.Equal(t, 0, findAggregate(t, witnessed, risk.AaveEngine).RefusedPositions)
	require.Equal(t, 1, findAggregate(t, witnessed, risk.AaveEngine).ComputedPositions)
}

// ---------------------------------------------------------------------------
// The collateral law's PRECONDITION: proven flag custody.
// ---------------------------------------------------------------------------

// TestAssembleRefusesTheAaveBookWhenFlagCustodyIsUnproven is the round-1 [high]
// regression, at the unit level.
//
// THE SHAPE IT FORBIDS: an honest start of this code against a database whose Aave
// cursor is at head but whose flag ledger was never derived (because the walking
// binary predated the flag registration). The absence-is-truth law would read that
// empty ledger as "nobody has ever used anything as collateral" and publish HF 0
// over genuinely-enabled weETH collateral — a false liquidation alarm, and strictly
// worse than the assume-true posture this wave retired.
//
// MUTANT THIS KILLS: delete the `if !a.flagCustody` block in assembleAave, or make
// store.CoverageClaim.Satisfies return true for a nil covered-from. The position below
// then computes HF 0 instead of refusing.
func TestAssembleRefusesTheAaveBookWhenFlagCustodyIsUnproven(t *testing.T) {
	in := flagLawInputs()
	// The live pre-replay state, exactly: cursor at head, EMPTY flag ledger, no
	// coverage provenance.
	in.Cursors[0] = unprovenAaveCursor(25_635_618)
	in.CollateralFlags = nil

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status,
		"an unproven flag ledger must REFUSE the book, never read its emptiness as chain truth")
	require.Equal(t, GateFlagCustodyUnproven, p.RefusalCode)
	require.Contains(t, p.RefusalDetail, "rewind-and-rederive",
		"the refusal must name the remedy, not merely the problem")
	require.Contains(t, p.RefusalDetail, "20625519",
		"and the coverage bar it actually applied")

	// A REFUSAL IS THE ABSENCE OF A NUMBER. The HF-0 shape the finding described
	// cannot be present in any form.
	require.Nil(t, p.HFWad, "no health factor may be published over an unproven ledger")
	require.Nil(t, p.TotalCollateralBase)
	require.Nil(t, p.TotalDebtBase)
	require.False(t, p.HFInfinite)
	require.Empty(t, p.Legs, "no leg may claim a used_as_collateral verdict here")
	require.Empty(t, res.Book, "and the refused position never reaches the stress/waterfall book")

	// Nothing was folded, so nothing may enter the identity's flag section either.
	require.Empty(t, res.ConsultedFlags)
}

// TestAssembleFlagCustodyRefusalIsWholeEngineNotPerPosition: the precondition is a
// property of the LEDGER, so a partially-witnessed book refuses ENTIRELY. The
// alternative — refusing only the rows that lack a witness — is what would have
// published the 23 genuinely-enabled weETH legs as zero.
func TestAssembleFlagCustodyRefusalIsWholeEngineNotPerPosition(t *testing.T) {
	in := flagLawInputs()
	in.Cursors[0] = unprovenAaveCursor(25_635_618)
	// A SECOND Aave account, and a witness row that DOES exist for the first.
	// Under an unproven ledger even a present witness proves nothing about the
	// absences around it, so both accounts must refuse.
	in.Balances = append(in.Balances,
		bal(risk.AaveEngine, acctB, weETH, sideCollateral, sourceEvent, "5000000000000000000", 25_635_618))
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	for _, acct := range []common.Address{acctA, acctB} {
		p := findPosition(t, res, risk.AaveEngine, acct)
		require.Equal(t, store.RiskPositionRefused, p.Status, "account %s", acct.Hex())
		require.Equal(t, GateFlagCustodyUnproven, p.RefusalCode, "account %s", acct.Hex())
	}

	agg := findAggregate(t, res, risk.AaveEngine)
	require.Equal(t, 2, agg.Positions)
	require.Equal(t, 2, agg.RefusedPositions)
	require.Equal(t, 0, agg.ComputedPositions)
	require.Equal(t, "0", agg.TotalCollateral.String(),
		"a refused book contributes nothing — it does not publish an understated total either")
}

// TestAssembleFlagCustodyIsAavePreciseAndDoesNotRefuseTheDebtManager: the gate is
// scoped to the engine whose law depends on absence. The Debt Manager's params come
// from its own position_events too, but a MISSING param row there already refuses
// per position (a counting collateral token with no threshold is ErrMissingParam),
// so it needs no coverage precondition — and inheriting one would refuse an
// unrelated, correct book.
func TestAssembleFlagCustodyIsAavePreciseAndDoesNotRefuseTheDebtManager(t *testing.T) {
	in := dmInputs()
	in.Cursors[0] = unprovenAaveCursor(25_635_618)
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)

	dm := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, dm.Status,
		"unproven AAVE flag custody must not refuse the OP book")
	require.Equal(t, 1, findAggregate(t, res, risk.DMEngine).ComputedPositions)
}

// TestAssembleFlagCustodyRequiresBothLegs walks every way the precondition can
// fail, one at a time. Each is a real database state, not a synthetic combination.
func TestAssembleFlagCustodyRequiresBothLegs(t *testing.T) {
	genesis := uint64(fixtureAaveGenesis)
	tooHigh := uint64(fixtureAaveGenesis + 1)

	cases := map[string]struct {
		cursor store.DeriveCursorState
		refuse bool
		why    string
	}{
		"proven at genesis": {
			cursor: provenAaveCursor(25_635_618), refuse: false,
			why: "walked from genesis under the flag registry: the law is licensed",
		},
		"no coverage at all": {
			cursor: unprovenAaveCursor(25_635_618), refuse: true,
			why: "the live pre-replay state — a head cursor proves nothing about the flag ledger",
		},
		"coverage starts ABOVE genesis": {
			cursor: store.DeriveCursorState{Engine: risk.AaveEngine, ChainID: 1, LastBlock: 25_635_618,
				CoveredFromBlock: &tooHigh, DecoderRevision: decode.RevisionAaveCollateralFlags},
			refuse: true,
			why:    "a walk that began one block late may have missed the first enable, so absence is not truth",
		},
		"decoder revision too old": {
			cursor: store.DeriveCursorState{Engine: risk.AaveEngine, ChainID: 1, LastBlock: 25_635_618,
				CoveredFromBlock: &genesis, DecoderRevision: decode.RevisionAaveCollateralFlags - 1},
			refuse: true,
			why:    "walked from genesis, but by a registry that silently skipped the flag topics",
		},
		"binding differs (a stream added)": {
			cursor: func() store.DeriveCursorState {
				c := provenAaveCursor(25_635_618)
				c.CoverageBinding = store.CoverageBindingOf(1, []store.CoverageStream{
					{Address: weETH.Bytes(), StartBlock: fixtureAaveGenesis},
					{Address: usdc.Bytes(), StartBlock: fixtureAaveGenesis},
				})
				return c
			}(),
			refuse: true,
			why:    "walked over a different set of contracts than the one configured",
		},
		"binding empty": {
			cursor: func() store.DeriveCursorState {
				c := provenAaveCursor(25_635_618)
				c.CoverageBinding = ""
				return c
			}(),
			refuse: true,
			why:    "an empty binding asserts nothing about what was walked",
		},
		"revision zero with a covered-from": {
			cursor: store.DeriveCursorState{Engine: risk.AaveEngine, ChainID: 1, LastBlock: 25_635_618,
				CoveredFromBlock: &genesis, DecoderRevision: 0},
			refuse: true,
			why:    "revision 0 is 'no claim asserted', not 'revision new enough'",
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			in := flagLawInputs()
			in.Cursors[0] = tc.cursor
			in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

			res, err := Assemble(in, fixtureConfig(t))
			require.NoError(t, err)
			p := findPosition(t, res, risk.AaveEngine, acctA)
			if tc.refuse {
				require.Equal(t, store.RiskPositionRefused, p.Status, tc.why)
				require.Equal(t, GateFlagCustodyUnproven, p.RefusalCode, tc.why)
				return
			}
			require.Equal(t, store.RiskPositionComputed, p.Status, tc.why)
			require.Equal(t, "300000000000", p.TotalCollateralBase.String(), tc.why)
		})
	}
}

// TestAssembleRefusesWhenTheWALKEDSURFACEChanged is the round-5 [high], reader side.
//
// THE HISTORY IT FORBIDS: an operator adds an Aave aToken stream at the audited
// genesis. The engine cursor is already at head, so the runner never walks history for
// the new address — it resumes at H+1 — while the persisted claim still says
// "covered from genesis" under an unchanged decoder revision. Block and revision both
// check out; only the walked SURFACE differs, and without comparing it riskd would
// publish a book missing that stream's entire history.
//
// MUTANT THIS KILLS: drop the Binding leg from CoverageClaim.Satisfies (or stop
// passing cfg.Aave.CoverageBinding). The position below then computes over a ledger
// that never saw the new contract.
func TestAssembleRefusesWhenTheWALKEDSURFACEChanged(t *testing.T) {
	in := flagLawInputs()
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

	// The config now walks a SECOND address; the persisted claim was stamped over the
	// old one-address surface and is otherwise perfect.
	cfg := fixtureConfig(t)
	cfg.Aave.CoverageBinding = store.CoverageBindingOf(1, []store.CoverageStream{
		{Address: weETH.Bytes(), StartBlock: fixtureAaveGenesis},
		{Address: usdc.Bytes(), StartBlock: fixtureAaveGenesis},
	})
	require.NotEqual(t, fixtureAaveBinding, cfg.Aave.CoverageBinding,
		"the premise: adding a stream changes the binding")

	res, err := Assemble(in, cfg)
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status,
		"inherited coverage cannot vouch for an address it never walked")
	require.Equal(t, GateFlagCustodyUnproven, p.RefusalCode)
	require.Nil(t, p.HFWad)

	// COUNTERWEIGHT: the same everything with the binding restored computes, so the
	// refusal is attributable to the surface change and not to the gate rejecting all.
	cfg.Aave.CoverageBinding = fixtureAaveBinding
	res, err = Assemble(in, cfg)
	require.NoError(t, err)
	require.Equal(t, store.RiskPositionComputed,
		findPosition(t, res, risk.AaveEngine, acctA).Status)
}

// TestAssembleFlagCustodyRefusesAnUnwiredGenesis is the fail-closed leg on the
// CONFIG side: a binding that never wired GenesisBlock must refuse, not sail
// through. A zero bar would be satisfied by every cursor, so the gate would exist
// and enforce nothing — the most dangerous shape a gate can take.
func TestAssembleFlagCustodyRefusesAnUnwiredGenesis(t *testing.T) {
	in := flagLawInputs()
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

	cfg := fixtureConfig(t)
	cfg.Aave.GenesisBlock = 0 // the field was declared and never wired

	res, err := Assemble(in, cfg)
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctA)
	require.Equal(t, store.RiskPositionRefused, p.Status,
		"an unconfigured genesis must fail CLOSED — otherwise the gate passes everything")
	require.Equal(t, GateFlagCustodyUnproven, p.RefusalCode)
}

// TestAssembleFlagCustodyStillSkipsFullyClosedPositions: the whole-engine refusal
// must not resurrect accounts that are not positions. Rewind rebuilds leave
// amount=0 rows deliberately, and a refusal row for an empty account is noise that
// would also inflate the refused count an operator reads as "this much is broken".
func TestAssembleFlagCustodyStillSkipsFullyClosedPositions(t *testing.T) {
	in := baseInputs()
	in.Cursors[0] = unprovenAaveCursor(25_635_618)
	in.Balances = []store.RiskBalanceRow{
		bal(risk.AaveEngine, acctA, weETH, sideCollateral, sourceEvent, "0", 25_635_618),
		bal(risk.AaveEngine, acctA, usdc, sideDebt, sourceEvent, "0", 25_635_618),
	}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	require.Empty(t, res.Positions,
		"an account whose every balance is zero is not a position, proven ledger or not")
}

// TestAssembleFlagCustodyRefusalStillReportsAConflict: a conflicted account has its
// rows WITHHELD, so it must still surface as its own specific refusal rather than
// being absorbed into the engine-wide one. Either way it is refused; reporting the
// more specific fact is what keeps the G3 disclosure alive.
func TestAssembleFlagCustodyRefusalStillReportsAConflict(t *testing.T) {
	in := baseInputs()
	in.Cursors[0] = unprovenAaveCursor(25_635_618)
	in.Balances = nil
	in.BalanceConflicts = []store.RiskBalanceConflict{{
		Engine: risk.AaveEngine, Account: acctB.Bytes(), Detail: "both event- and snapshot-sourced rows",
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.AaveEngine, acctB)
	require.Equal(t, store.RiskPositionRefused, p.Status)
	require.Equal(t, GateStoreUnreadable, p.RefusalCode,
		"the conflict is the more specific unreadable-substrate fact and must not be masked")
}

// TestAssembleRefusesTwoFlagRowsForOnePair: the store's DISTINCT ON guarantees one
// row per pair, so two rows mean the fold's uniqueness assumption broke. Silently
// picking one of two contradictory collateral verdicts is the decision that
// surfaces months later as a wrong number, so it is a loud error instead.
func TestAssembleRefusesTwoFlagRowsForOnePair(t *testing.T) {
	in := flagLawInputs()
	in.CollateralFlags = []store.CollateralFlagRow{
		collFlag(weETH, acctA, true, 20_714_007, 6),
		collFlag(weETH, acctA, false, 22_551_863, 342),
	}
	_, err := Assemble(in, fixtureConfig(t))
	require.Error(t, err)
	require.Contains(t, err.Error(), "latest-wins fold is not unique")
}

// TestAssembleRefusesMalformedFlagAddresses: a short reserve or user column would
// be silently zero-extended by BytesToAddress and collide with an unrelated pair.
func TestAssembleRefusesMalformedFlagAddresses(t *testing.T) {
	for name, row := range map[string]store.CollateralFlagRow{
		"short reserve": {Engine: risk.AaveEngine, ChainID: 1, Reserve: []byte{0x01}, User: acctA.Bytes(), Enabled: true},
		"short user":    {Engine: risk.AaveEngine, ChainID: 1, Reserve: weETH.Bytes(), User: []byte{0x02}, Enabled: true},
	} {
		t.Run(name, func(t *testing.T) {
			in := flagLawInputs()
			in.CollateralFlags = []store.CollateralFlagRow{row}
			_, err := Assemble(in, fixtureConfig(t))
			require.Error(t, err)
			require.Contains(t, err.Error(), "must be 20-byte addresses")
		})
	}
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

// TestAssembleDMDebtOnlyAfterEmptySweepCarriesUSD6Scale is the Codex round-6
// [HIGH] regression: nonzero debt plus a SUCCESSFUL sweep that observed EMPTY
// collateral — a state ApplySweepBatch explicitly supports, and the live
// book's actual shape for 44 accounts in batch 3. Such a position consults NO
// price witnesses, so a scale inferred from witnesses collapses to 0 and the
// assignment overwrites the correct USD-6 the position was initialized with:
// borrowings 1000000000 served at value_decimals 0 reads as $1,000,000,000
// instead of $1,000, while the engine aggregate (whose scale is declared, not
// inferred) correctly stays at 6. The DM USD scale is STRUCTURAL and must
// survive an empty witness set.
func TestAssembleDMDebtOnlyAfterEmptySweepCarriesUSD6Scale(t *testing.T) {
	in := dmInputs()
	// Nonzero debt and nothing else: the sweep RAN and SUCCEEDED, and what it
	// observed was an empty Safe — no snapshot collateral row exists.
	in.Balances = []store.RiskBalanceRow{
		bal(risk.DMEngine, acctA, opUSDC, sideDebt, sourceEvent, "1000000000", 154_796_552),
	}
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, p.Status)
	require.Equal(t, "1000000000", p.Borrowings.String())
	require.Equal(t, "0", p.CollateralValueUSD.String(),
		"the sweep SAW empty collateral: zero is a known zero here, not an unknown")
	require.NotNil(t, p.Liquidatable)
	require.True(t, *p.Liquidatable)
	require.EqualValues(t, 154_790_000, p.SweepBlock)
	require.EqualValues(t, 6, p.ValueDecimals,
		"the DM USD scale is STRUCTURAL (6), never inferred from price witnesses — with none consulted it must still be 6")

	// And the row's scale must AGREE with the engine aggregate that sums it:
	// batch 3 served 44 rows at scale 0 under an aggregate at scale 6, so the
	// same borrowings figure carried two meanings at once.
	var agg *store.RiskEngineAggregate
	for i := range res.Aggregates {
		if res.Aggregates[i].Engine == risk.DMEngine {
			agg = &res.Aggregates[i]
		}
	}
	require.NotNil(t, agg)
	require.EqualValues(t, agg.ValueDecimals, p.ValueDecimals,
		"a position's value_decimals must equal its engine aggregate's — one number, one meaning")
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

// TestAssembleDMBorrowTokenHeldAsCollateralMergesToOneLeg is the live-book
// reproduction of the first full-book riskd failure (2026-07-31): a Debt
// Manager account holding the BORROW TOKEN as collateral — USDC on both sides
// of one position. That is the NORMAL shape of the live book (7,503 of ~9,700
// DM accounts), and the assembler used to emit a debt leg AND a collateral leg
// keyed by the same asset, which is a duplicate-key write failure against
// risk_position_legs' (batch, engine, account, asset) primary key.
//
// The law: ONE LEG PER ASSET, carrying BOTH sides, with neither side's
// contribution dropped or overwritten. Every integer below is hand-derived:
//
//	USDC debt:       live = floor(1000000000 × 1e18 / 1e18)   = 1000000000  ($1,000)
//	USDC collateral: value = floor(7240549 × 1000000 / 1e6)   =    7240549  ($7.240549)
//	                 contribution = floor(7240549 × 80/100)   =    5792439
//	weETH:           value = floor(1e18 × 3000000000 / 1e18)  = 3000000000  ($3,000)
//	                 contribution = floor(3000000000 × 85/100)= 2550000000
//	totals:          collateral 3007240549, maxBorrowLT 2555792439,
//	                 borrowings 1000000000 ≤ 2555792439 => healthy
//
// MUTANTS THIS KILLS (the wave's two named ones):
//   - the merge dropped back to double-insert → three legs with USDC twice,
//     caught by the one-row-per-asset walk;
//   - a merge that silently overwrites one side → the per-field exactness
//     assertions on the merged leg AND the Σ-legs-equal-position-totals welds
//     fail (a dropped debt side breaks Σ live_debt == borrowings; a dropped
//     collateral side breaks Σ value_usd == collateral_value_usd and moves
//     max_borrow_lt).
func TestAssembleDMBorrowTokenHeldAsCollateralMergesToOneLeg(t *testing.T) {
	in := dmInputs()
	// USDC joins the COLLATERAL side of the same account that borrows it —
	// exactly the position_balances shape the live SELECT showed for account
	// 0x0003d7bf…: one row per (asset, side), no duplication in the substrate.
	in.Balances = append(in.Balances,
		bal(risk.DMEngine, acctA, opUSDC, sideCollateral, sourceSnapshot, "7240549", 154_790_000))
	in.DMParams = append(in.DMParams, store.ParamRow{
		Engine: risk.DMEngine, ChainID: 10, Asset: opUSDC.Bytes(),
		LTV: bi("80000000000000000000"), LiqThreshold: bi("80000000000000000000"),
		LiqBonus:       bi("1000000000000000000"),
		EffectiveBlock: 150_000_000, EffectiveLogIndex: 1, SourceEvent: "collateral_token_config_set",
	})
	in.Prices = append(in.Prices, price(10, opUSDC, "priceproviderv2", "1000000", 6, 30*time.Second))
	in.Sweeps = []store.RiskSweepRow{{
		Engine: risk.DMEngine, Account: acctA.Bytes(), Status: "success",
		LastAttemptBlock: 154_790_000, LastSuccessBlock: 154_790_000, UpdatedAt: fixtureTime,
	}}

	res, err := Assemble(in, fixtureConfig(t))
	require.NoError(t, err)
	p := findPosition(t, res, risk.DMEngine, acctA)
	require.Equal(t, store.RiskPositionComputed, p.Status)

	// The position's health arithmetic is EXACTLY the honest combination —
	// both USDC sides count, neither shadows the other.
	require.Equal(t, "3007240549", p.CollateralValueUSD.String())
	require.Equal(t, "2555792439", p.MaxBorrowLT.String())
	require.Equal(t, "1000000000", p.Borrowings.String())
	require.False(t, *p.Liquidatable)
	require.Equal(t, "2555792439", p.HFNum.String())
	require.Equal(t, "1000000000", p.HFDen.String())

	// ONE ROW PER ASSET — the duplicate-key reproduction. Before the merge
	// this walk finds THREE legs, USDC twice.
	require.Len(t, p.Legs, 2)
	seen := map[string]int{}
	for _, l := range p.Legs {
		seen[common.BytesToAddress(l.Asset).Hex()]++
	}
	for asset, n := range seen {
		require.Equal(t, 1, n,
			"asset %s must appear on exactly one leg: (batch, engine, account, asset) is the primary key", asset)
	}

	// The merged USDC leg carries BOTH sides, field by field.
	var usdcLeg, weethLeg store.RiskLegWrite
	for _, l := range p.Legs {
		switch common.BytesToAddress(l.Asset) {
		case opUSDC:
			usdcLeg = l
		case opWeETH:
			weethLeg = l
		}
	}
	require.Equal(t, "1000000000", usdcLeg.ScaledDebt.String(), "debt side: normalized borrowing")
	require.Equal(t, "1000000000", usdcLeg.LiveDebt.String(), "debt side: index-applied USD")
	require.NotNil(t, usdcLeg.DebtIndexBlock)
	require.EqualValues(t, 154_700_000, *usdcLeg.DebtIndexBlock)
	require.Equal(t, "7240549", usdcLeg.Amount.String(), "collateral side: swept token units")
	require.Equal(t, "7240549", usdcLeg.ValueUSD.String())
	require.Equal(t, "5792439", usdcLeg.MaxBorrowContribution.String())
	require.Equal(t, "80000000000000000000", usdcLeg.LiqThreshold.String())
	require.Equal(t, "1000000000000000000", usdcLeg.LiqBonus.String())
	require.EqualValues(t, 6, usdcLeg.Decimals, "amount is denominated in the token's own units")

	// The weETH leg is untouched by the merge: collateral only, no debt fields.
	require.Nil(t, weethLeg.ScaledDebt)
	require.Nil(t, weethLeg.LiveDebt)
	require.Equal(t, "1000000000000000000", weethLeg.Amount.String())
	require.Equal(t, "3000000000", weethLeg.ValueUSD.String())
	require.Equal(t, "2550000000", weethLeg.MaxBorrowContribution.String())

	// THE Σ-WELDS: the leg rows must aggregate back to the served totals
	// exactly. These are what make a silent one-side overwrite impossible —
	// any dropped contribution breaks at least one of the three sums.
	sumDebt, sumValue, sumContribution := new(big.Int), new(big.Int), new(big.Int)
	for _, l := range p.Legs {
		if l.LiveDebt != nil {
			sumDebt.Add(sumDebt, l.LiveDebt)
		}
		if l.ValueUSD != nil {
			sumValue.Add(sumValue, l.ValueUSD)
		}
		if l.MaxBorrowContribution != nil {
			sumContribution.Add(sumContribution, l.MaxBorrowContribution)
		}
	}
	require.Zero(t, sumDebt.Cmp(p.Borrowings), "Σ legs' live_debt must equal borrowings exactly")
	require.Zero(t, sumValue.Cmp(p.CollateralValueUSD), "Σ legs' value_usd must equal collateral_value_usd exactly")
	require.Zero(t, sumContribution.Cmp(p.MaxBorrowLT), "Σ legs' max_borrow_contribution must equal max_borrow_lt exactly")

	// HF-UNCHANGED CONTROL: the same account WITHOUT the USDC collateral row
	// computes borrowings identically and a maxBorrowLT lower by EXACTLY the
	// USDC contribution — proving the merge changed leg PERSISTENCE only, and
	// the health arithmetic is the sum of honest per-token contributions.
	ctrl := dmInputs()
	ctrl.Sweeps = in.Sweeps
	ctrlRes, err := Assemble(ctrl, fixtureConfig(t))
	require.NoError(t, err)
	cp := findPosition(t, ctrlRes, risk.DMEngine, acctA)
	require.Equal(t, "1000000000", cp.Borrowings.String())
	require.Equal(t, "2550000000", cp.MaxBorrowLT.String())
	require.Equal(t, "5792439",
		new(big.Int).Sub(p.MaxBorrowLT, cp.MaxBorrowLT).String(),
		"the merged position's threshold exceeds the control by exactly the USDC contribution")
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
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctB, true, 20_714_007, 6)}

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
		// Flag custody PROVEN, so the refusal this test is about — the missing
		// ParamsBlock stamp — is the one that actually fires. A bare cursor here
		// would refuse at FLAG_CUSTODY_UNPROVEN instead, and the test would go green
		// while no longer exercising the watermark law at all.
		provenAaveCursor(25_635_618),
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
	in.CollateralFlags = []store.CollateralFlagRow{collFlag(weETH, acctA, true, 20_714_007, 6)}

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
