package risk

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// The committed v1 set.
// ---------------------------------------------------------------------------

// TestLoadScenariosCoversTheV1Set pins the exact committed set against design
// spec §6, including the BTC leg the census confirmed in (4.11% of the book,
// above the 2% materiality bar).
//
// The stable pair the spec names is shipped as a TRIPLE — see
// TestApplyScenarioStableSnapStep for why 0.99 is not the no-op the prose
// claims.
func TestLoadScenariosCoversTheV1Set(t *testing.T) {
	all, err := LoadScenarios()
	require.NoError(t, err)

	got := make([]string, 0, len(all))
	for _, s := range all {
		got = append(got, s.ID)
	}
	require.Equal(t, []string{
		"btc_leg_minus_20",
		"dm_rate_horizon_plus_200bps",
		"eth_minus_10",
		"eth_minus_20",
		"eth_minus_30",
		"ethfi_minus_50",
		"stable_depeg_098_unsnapped",
		"stable_depeg_0995_in_band",
		"stable_depeg_099_boundary",
		"weeth_market_depeg_oracles_held",
		"weeth_rate_minus_5",
	}, got)

	files, err := ScenarioFilenames()
	require.NoError(t, err)
	require.Len(t, files, len(all))
	for _, f := range files {
		require.True(t, strings.HasSuffix(f, ".json"))
	}

	for _, s := range all {
		require.Equal(t, "v1", s.Version, s.ID)
		require.NotEmpty(t, s.PathAssumption, s.ID)
		require.NotEmpty(t, s.OutOfModel, s.ID, "every scenario publishes what it does NOT model")
		require.NotEmpty(t, s.Engines, s.ID)
	}

	one, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)
	require.Equal(t, "eth_minus_20", one.ID)

	_, err = LoadScenario("no_such_scenario")
	require.ErrorIs(t, err, ErrScenarioNotFound)
}

// TestScenarioJSONRoundTripPerScenario is the per-scenario round-trip the plan
// requires: parse the committed bytes, re-marshal, re-parse, and require the
// value AND the bytes to be stable. A field the schema silently drops would
// fail here.
func TestScenarioJSONRoundTripPerScenario(t *testing.T) {
	all, err := LoadScenarios()
	require.NoError(t, err)
	require.NotEmpty(t, all)

	for _, sc := range all {
		t.Run(sc.ID, func(t *testing.T) {
			b1, err := json.Marshal(sc)
			require.NoError(t, err)

			sc2, err := ParseScenario(b1)
			require.NoError(t, err, "the re-marshaled form must survive the STRICT loader")
			require.Equal(t, sc, sc2)

			b2, err := json.Marshal(sc2)
			require.NoError(t, err)
			require.Equal(t, string(b1), string(b2), "round trip must be byte-stable")
		})
	}
}

// TestScenarioSetSpecificShapes pins the properties each scenario must have
// for its purpose — so a future edit cannot quietly turn the depeg scenario
// into a price shock, or drop the BTC correlation.
func TestScenarioSetSpecificShapes(t *testing.T) {
	depeg, err := LoadScenario("weeth_market_depeg_oracles_held")
	require.NoError(t, err)
	require.Empty(t, depeg.Shocks, "the market-depeg scenario must shock NO oracle axis")
	require.Empty(t, depeg.Propagation)
	require.Len(t, depeg.MarketRealizations, 2)
	for _, m := range depeg.MarketRealizations {
		require.Equal(t, "950000000000000000", m.MarketOverOracleWad)
	}

	btc, err := LoadScenario("btc_leg_minus_20")
	require.NoError(t, err)
	require.Len(t, btc.Shocks, 1, "one axis instance, so the correlation is structural")
	require.Equal(t, AxisAssetUSD, btc.Shocks[0].Axis)
	require.Len(t, btc.Propagation, 2)
	for _, p := range btc.Propagation {
		require.Len(t, p.RespondsTo, 1)
		require.Equal(t, btc.Shocks[0].ref(), p.RespondsTo[0],
			"liquidBTC and eBTC must respond to the SAME axis instance")
	}

	ethfi, err := LoadScenario("ethfi_minus_50")
	require.NoError(t, err)
	require.Len(t, ethfi.Propagation, 2, "ETHFI and sETHFI move together")

	rate, err := LoadScenario("dm_rate_horizon_plus_200bps")
	require.NoError(t, err)
	require.NotNil(t, rate.Projection)
	require.Equal(t, int64(200), rate.Projection.AnnualDeltaBps)
	require.Equal(t, "63419583967", rate.Projection.APYDeltaPerSecond100e18)
	require.Equal(t, []int64{2592000, 7776000}, rate.Projection.HorizonsSeconds)
	require.Equal(t, []string{DMEngine}, rate.Engines, "the Aave engine is excluded and says so")

	weeth, err := LoadScenario("weeth_rate_minus_5")
	require.NoError(t, err)
	require.Len(t, weeth.Shocks, 1)
	require.Equal(t, AxisWeETHRate, weeth.Shocks[0].Axis)
	require.Len(t, weeth.Propagation, 2, "only the two weETH marks respond to the rate axis")

	for _, id := range []string{"eth_minus_10", "eth_minus_20", "eth_minus_30"} {
		sc, err := LoadScenario(id)
		require.NoError(t, err)
		require.Len(t, sc.Shocks, 1)
		require.Equal(t, AxisETHUSD, sc.Shocks[0].Axis)
		require.Len(t, sc.Propagation, 4, "weETH+WETH+liquidETH on OP, weETH on ETH")
	}
}

// TestScenarioMarketRealizationsFor materializes the typed values.
func TestScenarioMarketRealizationsFor(t *testing.T) {
	depeg, err := LoadScenario("weeth_market_depeg_oracles_held")
	require.NoError(t, err)
	real := depeg.MarketRealizationsFor()
	require.Len(t, real, 2)
	byChain := map[uint64]MarketRealization{}
	for _, r := range real {
		byChain[r.ChainID] = r
	}
	require.Equal(t, dWeETH, byChain[10].Asset)
	require.Equal(t, aWeETH, byChain[1].Asset)
	requireBig(t, "950000000000000000", byChain[10].MarketOverOracle)
}

// ---------------------------------------------------------------------------
// Loader strictness.
// ---------------------------------------------------------------------------

// TestParseScenarioIsStrict: a committed scenario is the definition public
// numbers are computed from, so a malformed one is refused, never repaired.
func TestParseScenarioIsStrict(t *testing.T) {
	good := `{
      "id":"x","version":"v1","label":"L","description":"D",
      "path_assumption":"P","engines":["debt_manager"],
      "shocks":[{"axis":"eth_usd","factor_num":80,"factor_den":100}],
      "propagation":[{"asset":"0x4200000000000000000000000000000000000006","chain_id":10,
                      "responds_to":[{"axis":"eth_usd"}]}],
      "out_of_model":["something"]}`
	sc, err := ParseScenario([]byte(good))
	require.NoError(t, err)
	require.Equal(t, "x", sc.ID)

	cases := []struct {
		name    string
		json    string
		wantErr string
	}{
		{"unknown field", strings.Replace(good, `"id":"x"`, `"id":"x","surprise":1`, 1), "unknown field"},
		{"trailing content", good + `{"id":"y"}`, "trailing content"},
		{"malformed json", `{`, "invalid scenario"},
		{"empty id", strings.Replace(good, `"id":"x"`, `"id":""`, 1), "id is empty"},
		{"empty version", strings.Replace(good, `"version":"v1"`, `"version":""`, 1), "version is empty"},
		{"empty label", strings.Replace(good, `"label":"L"`, `"label":""`, 1), "label is empty"},
		{"empty description", strings.Replace(good, `"description":"D"`, `"description":""`, 1), "description is empty"},
		{"empty path assumption", strings.Replace(good, `"path_assumption":"P"`, `"path_assumption":"  "`, 1), "path_assumption is empty"},
		{"no engines", strings.Replace(good, `"engines":["debt_manager"]`, `"engines":[]`, 1), "engines is empty"},
		{"unknown engine", strings.Replace(good, `"debt_manager"`, `"aave_param"`, 1), "unknown engine"},
		{"empty out_of_model", strings.Replace(good, `["something"]`, `[]`, 1), "out_of_model is empty"},
		{"moves nothing", strings.Replace(strings.Replace(good,
			`"shocks":[{"axis":"eth_usd","factor_num":80,"factor_den":100}]`, `"shocks":[]`, 1),
			`"propagation":[{"asset":"0x4200000000000000000000000000000000000006","chain_id":10,
                      "responds_to":[{"axis":"eth_usd"}]}]`, `"propagation":[]`, 1), "moves nothing"},
		{"bad propagation address", strings.Replace(good, `0x4200000000000000000000000000000000000006`, `notanaddress`, 1), "not a hex address"},
		{"zero chain id", strings.Replace(good, `"chain_id":10`, `"chain_id":0`, 1), "chain_id is zero"},
		{"empty responds_to", strings.Replace(good, `"responds_to":[{"axis":"eth_usd"}]`, `"responds_to":[]`, 1), "responds_to is empty"},
		{"unknown axis in responds_to", strings.Replace(good, `"responds_to":[{"axis":"eth_usd"}]`, `"responds_to":[{"axis":"moon"}]`, 1), "unknown axis"},
		{"unknown axis in shock", strings.Replace(good, `{"axis":"eth_usd","factor_num"`, `{"axis":"moon","factor_num"`, 1), "unknown axis"},
		{"zero denominator", strings.Replace(good, `"factor_den":100`, `"factor_den":0`, 1), "factor_den must be positive"},
		{"negative numerator", strings.Replace(good, `"factor_num":80`, `"factor_num":-1`, 1), "factor_num must not be negative"},
		{"global axis carrying an asset", strings.Replace(good,
			`"responds_to":[{"axis":"eth_usd"}]`,
			`"responds_to":[{"axis":"eth_usd","asset":"0x4200000000000000000000000000000000000006"}]`, 1),
			"is global and must not carry an asset"},
		{"per-asset axis without an asset", strings.Replace(strings.Replace(good,
			`{"axis":"eth_usd","factor_num":80,"factor_den":100}`, `{"axis":"stable_usd","factor_num":80,"factor_den":100}`, 1),
			`"responds_to":[{"axis":"eth_usd"}]`, `"responds_to":[{"axis":"stable_usd"}]`, 1),
			"requires a hex asset"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseScenario([]byte(tc.json))
			require.Error(t, err)
			require.ErrorIs(t, err, ErrScenarioInvalid)
			require.Contains(t, err.Error(), tc.wantErr)
		})
	}
}

// TestParseScenarioRefusesSilentNoOpShock is the anti-vacuous-green rule: a
// scenario that shocks an axis nothing responds to would render a page of
// zeros and look like a clean result.
func TestParseScenarioRefusesSilentNoOpShock(t *testing.T) {
	j := `{
      "id":"x","version":"v1","label":"L","description":"D",
      "path_assumption":"P","engines":["debt_manager"],
      "shocks":[{"axis":"weeth_eth_rate","factor_num":95,"factor_den":100}],
      "propagation":[{"asset":"0x4200000000000000000000000000000000000006","chain_id":10,
                      "responds_to":[{"axis":"eth_usd"}]}],
      "out_of_model":["x"]}`
	_, err := ParseScenario([]byte(j))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "silent no-op")

	// The borrow-APY axis is exempt: it is consumed by ProjectDMDebt, not by
	// price propagation.
	j = strings.Replace(j, `"axis":"weeth_eth_rate","factor_num":95`, `"axis":"borrow_apy","factor_num":1`, 1)
	_, err = ParseScenario([]byte(j))
	require.NoError(t, err)
}

// TestParseScenarioRefusesDuplicates covers the three duplicate rules.
func TestParseScenarioRefusesDuplicates(t *testing.T) {
	dupProp := `{"id":"x","version":"v1","label":"L","description":"D","path_assumption":"P",
      "engines":["debt_manager"],
      "shocks":[{"axis":"eth_usd","factor_num":80,"factor_den":100}],
      "propagation":[
        {"asset":"0x4200000000000000000000000000000000000006","chain_id":10,"responds_to":[{"axis":"eth_usd"}]},
        {"asset":"0x4200000000000000000000000000000000000006","chain_id":10,"responds_to":[{"axis":"eth_usd"}]}],
      "out_of_model":["x"]}`
	_, err := ParseScenario([]byte(dupProp))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "twice")

	dupShock := `{"id":"x","version":"v1","label":"L","description":"D","path_assumption":"P",
      "engines":["debt_manager"],
      "shocks":[{"axis":"eth_usd","factor_num":80,"factor_den":100},
                {"axis":"eth_usd","factor_num":70,"factor_den":100}],
      "propagation":[{"asset":"0x4200000000000000000000000000000000000006","chain_id":10,"responds_to":[{"axis":"eth_usd"}]}],
      "out_of_model":["x"]}`
	_, err = ParseScenario([]byte(dupShock))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "shocked twice")

	dupReal := `{"id":"x","version":"v1","label":"L","description":"D","path_assumption":"P",
      "engines":["debt_manager"],"shocks":[],"propagation":[],
      "market_realizations":[
        {"asset":"0x4200000000000000000000000000000000000006","chain_id":10,"market_over_oracle_wad":"1"},
        {"asset":"0x4200000000000000000000000000000000000006","chain_id":10,"market_over_oracle_wad":"1"}],
      "out_of_model":["x"]}`
	_, err = ParseScenario([]byte(dupReal))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "twice")
}

// TestParseScenarioMarketRealizationAndProjectionValidation.
func TestParseScenarioMarketRealizationAndProjectionValidation(t *testing.T) {
	base := `{"id":"x","version":"v1","label":"L","description":"D","path_assumption":"P",
      "engines":["debt_manager"],"shocks":[],"propagation":[],
      "market_realizations":[{"asset":"%s","chain_id":%d,"market_over_oracle_wad":"%s"}],
      "out_of_model":["x"]}`
	mk := func(asset string, chain int, wad string) string {
		return fmt.Sprintf(base, asset, chain, wad)
	}
	_, err := ParseScenario([]byte(mk("nope", 10, "1")))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "not a hex address")

	_, err = ParseScenario([]byte(mk("0x4200000000000000000000000000000000000006", 0, "1")))
	require.Contains(t, err.Error(), "chain_id is zero")

	_, err = ParseScenario([]byte(mk("0x4200000000000000000000000000000000000006", 10, "0")))
	require.Contains(t, err.Error(), "not a positive integer")

	_, err = ParseScenario([]byte(mk("0x4200000000000000000000000000000000000006", 10, "abc")))
	require.Contains(t, err.Error(), "not a positive integer")

	proj := `{"id":"x","version":"v1","label":"L","description":"D","path_assumption":"P",
      "engines":["debt_manager"],"shocks":[],"propagation":[],
      "projection":{"annual_delta_bps":%BPS%,"apy_delta_per_second_100e18":"%APY%","horizons_seconds":[%H%]},
      "out_of_model":["x"]}`
	mkp := func(bps, apy, h string) string {
		return strings.NewReplacer("%BPS%", bps, "%APY%", apy, "%H%", h).Replace(proj)
	}
	// Correct: 200 bps ⇒ floor(2e18 / 31536000) = 63419583967.
	_, err = ParseScenario([]byte(mkp("200", "63419583967", "2592000")))
	require.NoError(t, err)

	// A typo in the per-second value is caught by the cross-check.
	_, err = ParseScenario([]byte(mkp("200", "63419583968", "2592000")))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "200 bps over a 365-day year")

	_, err = ParseScenario([]byte(mkp("0", "63419583967", "2592000")))
	require.Contains(t, err.Error(), "annual_delta_bps must be positive")

	_, err = ParseScenario([]byte(mkp("200", "63419583967", "")))
	require.Contains(t, err.Error(), "horizons_seconds is empty")

	_, err = ParseScenario([]byte(mkp("200", "63419583967", "0")))
	require.Contains(t, err.Error(), "horizons_seconds[0] must be positive")

	_, err = ParseScenario([]byte(mkp("200", "nope", "2592000")))
	require.Contains(t, err.Error(), "not a positive integer")
}

// ---------------------------------------------------------------------------
// Application.
// ---------------------------------------------------------------------------

// dmStressPosition builds a Debt Manager position holding one of each asset
// class the propagation matrix describes, plus one asset it does NOT.
func dmStressPosition(t *testing.T) PositionInput {
	t.Helper()
	return PositionInput{
		Engine: DMEngine,
		DM: &DMInput{
			Account: acctA,
			DebtUSD: mustBig(t, "1000000000"), // $1,000
			Collateral: []DMCollateral{
				{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: dWETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: dLiqETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
				{Asset: dUSDC, Amount: mustBig(t, "1000000000"), Decimals: 6},
				{Asset: dLiqBTC, Amount: mustBig(t, "100000000"), Decimals: 8},
			},
			Params: []ParamRow{
				dmParam(dWeETH, "80000000000000000000", "2000000000000000000"),
				dmParam(dWETH, "80000000000000000000", "2000000000000000000"),
				dmParam(dLiqETH, "75000000000000000000", "3000000000000000000"),
				dmParam(dUSDC, "95000000000000000000", "1000000000000000000"),
				dmParam(dLiqBTC, "75000000000000000000", "3000000000000000000"),
			},
			Prices: []PriceInput{
				enginePrice(dWeETH, "2099380000"),  // $2,099.38
				enginePrice(dWETH, "1950000000"),   // $1,950.00
				enginePrice(dLiqETH, "2200000000"), // $2,200.00
				enginePrice(dUSDC, "1000000"),      // exactly par
				enginePrice(dLiqBTC, "95000000000"),
			},
		},
		Marks: Watermarks{BalancesBlock: 154848114, ParamsBlock: 154848114, SweepBlock: 154840000},
	}
}

// TestApplyScenarioETHFactorPropagation: an ETH shock reaches every ETH-linked
// asset through its own composition and leaves everything else exactly alone.
func TestApplyScenarioETHFactorPropagation(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)
	pos := dmStressPosition(t)

	out, err := ApplyScenario(pos, sc)
	require.NoError(t, err)
	require.NotNil(t, out.Scenario)
	require.Equal(t, "eth_minus_20", out.Scenario.ScenarioID)
	require.Equal(t, "v1", out.Scenario.ScenarioVersion)

	byAsset := map[common.Address]*big.Int{}
	for _, p := range out.DM.Prices {
		byAsset[p.Asset] = p.Value
	}
	requireBig(t, "1679504000", byAsset[dWeETH], "2099380000 × 80/100")
	requireBig(t, "1560000000", byAsset[dWETH], "1950000000 × 80/100")
	requireBig(t, "1760000000", byAsset[dLiqETH], "2200000000 × 80/100")
	requireBig(t, "1000000", byAsset[dUSDC], "a stable is not ETH-linked")
	requireBig(t, "95000000000", byAsset[dLiqBTC], "BTC is not ETH-linked")

	// Held-flat disclosure: exactly the two assets the ETH matrix does not
	// describe, and no others.
	require.Len(t, out.Scenario.HeldFlat, 2)
	held := map[common.Address]bool{}
	for _, h := range out.Scenario.HeldFlat {
		held[h.Asset] = true
	}
	require.True(t, held[dUSDC])
	require.True(t, held[dLiqBTC])

	require.Len(t, out.Scenario.Applied, 3)
	for _, a := range out.Scenario.Applied {
		requireBig(t, "80", a.FactorNum)
		requireBig(t, "100", a.FactorDen)
		require.False(t, a.Snapped)
		require.False(t, a.CapBound, "a down-shock never binds an upward cap")
	}

	// And the health actually moves.
	before, err := ComputeDMHealth(*pos.DM)
	require.NoError(t, err)
	after, err := ComputeDMHealth(*out.DM)
	require.NoError(t, err)
	require.Equal(t, 1, before.MaxBorrowLT.Cmp(after.MaxBorrowLT), "the shock must reduce borrowing power")
}

// TestApplyScenarioWeETHRateMovesOnlyTheRateComposites: shocking the
// redemption rate moves weETH — the composite that carries it — and nothing
// else, including WETH.
func TestApplyScenarioWeETHRateMovesOnlyTheRateComposites(t *testing.T) {
	sc, err := LoadScenario("weeth_rate_minus_5")
	require.NoError(t, err)
	out, err := ApplyScenario(dmStressPosition(t), sc)
	require.NoError(t, err)

	byAsset := map[common.Address]*big.Int{}
	for _, p := range out.DM.Prices {
		byAsset[p.Asset] = p.Value
	}
	requireBig(t, "1994411000", byAsset[dWeETH], "2099380000 × 95/100")
	requireBig(t, "1950000000", byAsset[dWETH], "WETH does not carry the redemption rate")
	requireBig(t, "2200000000", byAsset[dLiqETH])
	require.Len(t, out.Scenario.Applied, 1)
	require.Len(t, out.Scenario.HeldFlat, 4)
}

// TestApplyScenarioStableSnapStep is the snap-band pair — shipped as a TRIPLE
// because the deployed band is OPEN and the spec's "0.99 (no-op)" is wrong at
// exactly that point.
//
//	0.995 → 995000  → strictly inside  → snaps back to 1000000  (TRUE no-op)
//	0.99  → 990000  → EXACTLY the edge → does NOT snap          (a real move)
//	0.98  → 980000  → outside          → does NOT snap
func TestApplyScenarioStableSnapStep(t *testing.T) {
	cases := []struct {
		id      string
		want    string
		snapped bool
	}{
		{"stable_depeg_0995_in_band", "1000000", true},
		{"stable_depeg_099_boundary", "990000", false},
		{"stable_depeg_098_unsnapped", "980000", false},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			sc, err := LoadScenario(tc.id)
			require.NoError(t, err)
			pos := dmStressPosition(t)
			out, err := ApplyScenario(pos, sc)
			require.NoError(t, err)

			var usdc *AppliedShock
			for i := range out.Scenario.Applied {
				if out.Scenario.Applied[i].Asset == dUSDC {
					usdc = &out.Scenario.Applied[i]
				}
			}
			require.NotNil(t, usdc, "USDC must be in the propagation matrix")
			requireBig(t, "1000000", usdc.Before)
			requireBig(t, tc.want, usdc.After)
			require.Equal(t, tc.snapped, usdc.Snapped)

			before, err := ComputeDMHealth(*pos.DM)
			require.NoError(t, err)
			after, err := ComputeDMHealth(*out.DM)
			require.NoError(t, err)
			if tc.snapped {
				require.Equal(t, before.MaxBorrowLT.String(), after.MaxBorrowLT.String(),
					"an in-band depeg is a genuine no-op on the engine")
			} else {
				require.Equal(t, 1, before.MaxBorrowLT.Cmp(after.MaxBorrowLT),
					"an unsnapped depeg re-prices stable collateral")
			}
		})
	}
}

// TestApplyScenarioStableSnapRequiresSixDecimals: the snap is a 6-decimal
// transform. Applying it to a differently-scaled price would compare against
// the wrong band.
func TestApplyScenarioStableSnapRequiresSixDecimals(t *testing.T) {
	sc, err := LoadScenario("stable_depeg_098_unsnapped")
	require.NoError(t, err)
	pos := dmStressPosition(t)
	for i := range pos.DM.Prices {
		pos.DM.Prices[i].Decimals = 8
	}
	_, err = ApplyScenario(pos, sc)
	require.ErrorIs(t, err, ErrMixedPriceDecimals)
	require.Contains(t, err.Error(), "stable_snap needs a 6-decimal price")
}

// TestApplyScenarioCapBindsUpwardOnly is the synthetic cap vector at the
// scenario level. No committed v1 scenario is an up-shock, so this scenario is
// built here — validation that only ever runs in calm weather is exactly what
// oracle-sentinel R6-1 calls out.
func TestApplyScenarioCapBindsUpwardOnly(t *testing.T) {
	up := Scenario{
		ID: "synthetic_eth_plus_5", Version: "test", Label: "L", Description: "D",
		PathAssumption: "P", Engines: []string{AaveEngine},
		Shocks: []Shock{{Axis: AxisETHUSD, FactorNum: 105, FactorDen: 100}},
		Propagation: []AssetResponse{{
			Asset: aWeETH.Hex(), ChainID: 1, RespondsTo: []AxisRef{{Axis: AxisETHUSD}},
		}},
		OutOfModel: []string{"synthetic"},
	}

	price := adapterPrice(aWeETH, "100000000") // 1.00 at 8 decimals
	price.CapValue = mustBig(t, "102000000")   // adapter caps at 1.02

	pos := PositionInput{Engine: AaveEngine, Aave: &AaveInput{
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "100000000", "0", true)},
		Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices:   []PriceInput{price},
	}}

	out, err := ApplyScenario(pos, up)
	require.NoError(t, err)
	require.Len(t, out.Scenario.Applied, 1)
	requireBig(t, "100000000", out.Scenario.Applied[0].Before)
	requireBig(t, "102000000", out.Scenario.Applied[0].After, "105000000 clamped to the cap")
	require.True(t, out.Scenario.Applied[0].CapBound)
	requireBig(t, "102000000", out.Aave.Prices[0].Value)

	// The SAME position under a down-shock leaves the cap slack — which is
	// what makes every v1 scenario safe to read as adapter output.
	down := up
	down.Shocks = []Shock{{Axis: AxisETHUSD, FactorNum: 80, FactorDen: 100}}
	out, err = ApplyScenario(pos, down)
	require.NoError(t, err)
	requireBig(t, "80000000", out.Scenario.Applied[0].After)
	require.False(t, out.Scenario.Applied[0].CapBound)
}

// TestApplyScenarioIsExactIntegerArithmetic: the factor is a rational and the
// shocked value is one floored multiply-divide, not a float scaling.
func TestApplyScenarioIsExactIntegerArithmetic(t *testing.T) {
	sc := Scenario{
		ID: "thirds", Version: "test", Label: "L", Description: "D", PathAssumption: "P",
		Engines: []string{DMEngine},
		Shocks:  []Shock{{Axis: AxisETHUSD, FactorNum: 1, FactorDen: 3}},
		Propagation: []AssetResponse{{
			Asset: dWETH.Hex(), ChainID: 10, RespondsTo: []AxisRef{{Axis: AxisETHUSD}},
		}},
		OutOfModel: []string{"synthetic"},
	}
	pos := PositionInput{Engine: DMEngine, DM: &DMInput{
		Account:    acctA,
		Collateral: []DMCollateral{{Asset: dWETH, Amount: mustBig(t, "1"), Decimals: 18}},
		Params:     []ParamRow{dmParam(dWETH, "80000000000000000000", "2000000000000000000")},
		Prices:     []PriceInput{enginePrice(dWETH, "100")},
	}}
	out, err := ApplyScenario(pos, sc)
	require.NoError(t, err)
	requireBig(t, "33", out.DM.Prices[0].Value, "floor(100/3), never 33.333…")
}

// TestApplyScenarioComposesMultipleAxes: weETH responds to BOTH ETH/USD and
// the redemption rate, so a scenario shocking both multiplies the factors.
func TestApplyScenarioComposesMultipleAxes(t *testing.T) {
	sc := Scenario{
		ID: "both", Version: "test", Label: "L", Description: "D", PathAssumption: "P",
		Engines: []string{DMEngine},
		Shocks: []Shock{
			{Axis: AxisETHUSD, FactorNum: 80, FactorDen: 100},
			{Axis: AxisWeETHRate, FactorNum: 95, FactorDen: 100},
		},
		Propagation: []AssetResponse{{
			Asset: dWeETH.Hex(), ChainID: 10,
			RespondsTo: []AxisRef{{Axis: AxisETHUSD}, {Axis: AxisWeETHRate}},
		}},
		OutOfModel: []string{"synthetic"},
	}
	pos := PositionInput{Engine: DMEngine, DM: &DMInput{
		Account:    acctA,
		Collateral: []DMCollateral{{Asset: dWeETH, Amount: mustBig(t, "1000000000000000000"), Decimals: 18}},
		Params:     []ParamRow{dmParam(dWeETH, "80000000000000000000", "2000000000000000000")},
		Prices:     []PriceInput{enginePrice(dWeETH, "2000000000")},
	}}
	out, err := ApplyScenario(pos, sc)
	require.NoError(t, err)
	// 2000000000 × (80×95) / (100×100) = 2000000000 × 7600/10000
	requireBig(t, "1520000000", out.DM.Prices[0].Value)
	requireBig(t, "7600", out.Scenario.Applied[0].FactorNum)
	requireBig(t, "10000", out.Scenario.Applied[0].FactorDen)
}

// TestApplyScenarioDoesNotMutateInput: stress must never poison the base case.
func TestApplyScenarioDoesNotMutateInput(t *testing.T) {
	sc, err := LoadScenario("eth_minus_30")
	require.NoError(t, err)
	pos := dmStressPosition(t)
	original := pos.DM.Prices[0].Value.String()

	out, err := ApplyScenario(pos, sc)
	require.NoError(t, err)
	require.NotEqual(t, original, out.DM.Prices[0].Value.String())
	require.Equal(t, original, pos.DM.Prices[0].Value.String(), "the input price must be untouched")
	require.Nil(t, pos.Scenario)

	// Mutating the OUTPUT must not reach back either.
	out.DM.Prices[0].Value.SetInt64(1)
	require.Equal(t, original, pos.DM.Prices[0].Value.String())
}

// TestApplyScenarioAaveSide covers the Aave arm of the same code path.
func TestApplyScenarioAaveSide(t *testing.T) {
	sc, err := LoadScenario("eth_minus_10")
	require.NoError(t, err)
	pos := PositionInput{Engine: AaveEngine, Aave: &AaveInput{
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "100000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "50000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "200000000"), adapterPrice(aUSDC, "100000000")},
	}}
	out, err := ApplyScenario(pos, sc)
	require.NoError(t, err)
	requireBig(t, "180000000", out.Aave.Prices[0].Value, "200000000 × 90/100")
	requireBig(t, "100000000", out.Aave.Prices[1].Value, "the USDC debt mark is not ETH-linked")
	require.Len(t, out.Scenario.HeldFlat, 1)
	require.Equal(t, aUSDC, out.Scenario.HeldFlat[0].Asset)
}

// TestApplyScenarioRefusals.
func TestApplyScenarioRefusals(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)

	_, err = ApplyScenario(PositionInput{Engine: "nope"}, sc)
	require.ErrorIs(t, err, ErrEngineMismatch)

	_, err = ApplyScenario(dmStressPosition(t), Scenario{ID: "broken"})
	require.ErrorIs(t, err, ErrScenarioInvalid)
}

// TestWithSingleShockFactor covers the waterfall's grid-factor override.
func TestWithSingleShockFactor(t *testing.T) {
	sc, err := LoadScenario("eth_minus_20")
	require.NoError(t, err)

	out, err := sc.WithSingleShockFactor(mustBig(t, "700000000000000000"), WadUnit())
	require.NoError(t, err)
	require.Equal(t, int64(700000000000000000), out.Shocks[0].FactorNum)
	require.Equal(t, int64(1000000000000000000), out.Shocks[0].FactorDen)
	require.Equal(t, AxisETHUSD, out.Shocks[0].Axis)
	require.NoError(t, out.Validate())
	require.Equal(t, int64(80), sc.Shocks[0].FactorNum, "the source scenario is unchanged")

	depeg, err := LoadScenario("weeth_market_depeg_oracles_held")
	require.NoError(t, err)
	_, err = depeg.WithSingleShockFactor(WadUnit(), WadUnit())
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "declares 0 shocks")

	stable, err := LoadScenario("stable_depeg_098_unsnapped")
	require.NoError(t, err)
	_, err = stable.WithSingleShockFactor(WadUnit(), WadUnit())
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "declares 3 shocks")

	_, err = sc.WithSingleShockFactor(nil, WadUnit())
	require.ErrorIs(t, err, ErrScenarioInvalid)
	_, err = sc.WithSingleShockFactor(WadUnit(), big.NewInt(0))
	require.ErrorIs(t, err, ErrScenarioInvalid)
	_, err = sc.WithSingleShockFactor(big.NewInt(-1), WadUnit())
	require.ErrorIs(t, err, ErrScenarioInvalid)

	huge := new(big.Int).Lsh(big.NewInt(1), 100)
	_, err = sc.WithSingleShockFactor(huge, WadUnit())
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "int64")
	_, err = sc.WithSingleShockFactor(WadUnit(), huge)
	require.ErrorIs(t, err, ErrScenarioInvalid)
}

// TestAxisRefString covers the key form used for matching.
func TestAxisRefString(t *testing.T) {
	require.Equal(t, "eth_usd|", AxisRef{Axis: AxisETHUSD}.String())
	require.Equal(t, "stable_usd|"+strings.ToLower(dUSDC.Hex()),
		AxisRef{Axis: AxisStableUSD, Asset: dUSDC.Hex()}.String())
}

// TestApplyScenarioIgnoresTheBorrowAPYAxis: the rate axis moves debt over a
// horizon, not a spot price, so ApplyScenario must skip it entirely and leave
// every mark alone. Routing it into a price would turn a labeled projection
// into a fabricated spot shock.
func TestApplyScenarioIgnoresTheBorrowAPYAxis(t *testing.T) {
	sc, err := LoadScenario("dm_rate_horizon_plus_200bps")
	require.NoError(t, err)
	require.Len(t, sc.Shocks, 1)
	require.Equal(t, AxisBorrowAPY, sc.Shocks[0].Axis)

	pos := dmStressPosition(t)
	out, err := ApplyScenario(pos, sc)
	require.NoError(t, err)
	require.Empty(t, out.Scenario.Applied, "no price is shocked by a rate scenario")
	require.Len(t, out.Scenario.HeldFlat, len(pos.DM.Prices), "every mark is held, and said so")
	for i, p := range out.DM.Prices {
		require.Equal(t, pos.DM.Prices[i].Value.String(), p.Value.String())
	}
}

// TestApplyScenarioAaveStableSnapScaleError covers the Aave arm's transform
// error path.
func TestApplyScenarioAaveStableSnapScaleError(t *testing.T) {
	sc := Scenario{
		ID: "snap_on_aave", Version: "test", Label: "L", Description: "D",
		PathAssumption: "P", Engines: []string{AaveEngine},
		Shocks: []Shock{{Axis: AxisStableUSD, Asset: aUSDC.Hex(), FactorNum: 98, FactorDen: 100}},
		Propagation: []AssetResponse{{
			Asset: aUSDC.Hex(), ChainID: 1, StableSnap: true,
			RespondsTo: []AxisRef{{Axis: AxisStableUSD, Asset: aUSDC.Hex()}},
		}},
		OutOfModel: []string{"synthetic: the Aave base currency is 8-decimal, not 6"},
	}
	pos := PositionInput{Engine: AaveEngine, Aave: &AaveInput{
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aUSDC, 8, "0", "1", false)},
		Prices:   []PriceInput{adapterPrice(aUSDC, "100000000")},
	}}
	_, err := ApplyScenario(pos, sc)
	require.ErrorIs(t, err, ErrMixedPriceDecimals)
	require.Contains(t, err.Error(), "stable_snap needs a 6-decimal price, got 8")
}

// TestAssembleScenariosSetLevelRules exercises the three set-level failures
// the embedded set can never produce: an unreadable definition, one that does
// not parse, a duplicated id, and an empty set. Without this the guards would
// be unexecuted code claiming to protect the definitions public numbers are
// computed from.
func TestAssembleScenariosSetLevelRules(t *testing.T) {
	valid := func(id string) []byte {
		return []byte(fmt.Sprintf(`{"id":%q,"version":"v1","label":"L","description":"D",
          "path_assumption":"P","engines":["debt_manager"],
          "shocks":[{"axis":"eth_usd","factor_num":80,"factor_den":100}],
          "propagation":[{"asset":"0x4200000000000000000000000000000000000006","chain_id":10,
                          "responds_to":[{"axis":"eth_usd"}]}],
          "out_of_model":["x"]}`, id))
	}

	// Happy path through the seam.
	got, err := assembleScenarios([]string{"a.json", "b.json"}, func(n string) ([]byte, error) {
		return valid(strings.TrimSuffix(n, ".json")), nil
	})
	require.NoError(t, err)
	require.Len(t, got, 2)

	// Unreadable definition.
	_, err = assembleScenarios([]string{"a.json"}, func(string) ([]byte, error) {
		return nil, errors.New("boom")
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "a.json: boom")

	// Unparseable definition.
	_, err = assembleScenarios([]string{"a.json"}, func(string) ([]byte, error) {
		return []byte("{"), nil
	})
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "a.json")

	// Duplicate id across two files.
	_, err = assembleScenarios([]string{"a.json", "b.json"}, func(string) ([]byte, error) {
		return valid("same"), nil
	})
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), `id "same" declared by both a.json and b.json`)

	// Empty set: a stress surface with no definitions must not silently serve
	// an empty scenario list.
	_, err = assembleScenarios(nil, func(string) ([]byte, error) { return nil, nil })
	require.ErrorIs(t, err, ErrScenarioInvalid)
	require.Contains(t, err.Error(), "no scenario definitions are embedded")
}
