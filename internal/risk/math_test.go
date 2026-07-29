package risk

// Every expectation in this file is a HARD-CODED integer read off the chain or
// off a deployed source file. Nothing here is computed from the helper under
// test — that is the whole point of the file. Where a vector discriminates
// between rounding conventions, the REFUTED values are asserted too, so a
// silent convention flip cannot pass.

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// mustBig parses a decimal literal, failing the test on garbage.
func mustBig(t *testing.T, s string) *big.Int {
	t.Helper()
	v, ok := new(big.Int).SetString(s, 10)
	require.True(t, ok, "not a decimal integer: %q", s)
	return v
}

// ---------------------------------------------------------------------------
// Component 2 — live debt is CEILING.
// ---------------------------------------------------------------------------

// TestRayMulCeilOnChainVectors pins the two debt-side vectors read at ETH pin
// 25,627,125 (2026-07-27 acceptance run). Both fractions are SUB-HALF and both
// round UP, which refutes floor and half-up simultaneously.
//
// The ray values are the verbatim integers in
// cmd/reconcile/aave_compare_test.go and recon/derivation-notes.md:196-199.
func TestRayMulCeilOnChainVectors(t *testing.T) {
	cases := []struct {
		name             string
		scaled, index    string
		chainBalance     string
		refutedFloor     string
		refutedHalfUp    string
		fracLessThanHalf bool
	}{
		{
			name:             "C-A USDC scaled 125415",
			scaled:           "125415",
			index:            "1094089501745475497022017896",
			chainBalance:     "137216",
			refutedFloor:     "137215",
			refutedHalfUp:    "137215",
			fracLessThanHalf: true,
		},
		{
			name:             "C-B PYUSD scaled 83",
			scaled:           "83",
			index:            "1000520158840839583052050491",
			chainBalance:     "84",
			refutedFloor:     "83",
			refutedHalfUp:    "83",
			fracLessThanHalf: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, i := mustBig(t, tc.scaled), mustBig(t, tc.index)
			require.Equal(t, tc.chainBalance, RayMulCeil(s, i).String(), "ceiling must reproduce the chain balanceOf")
			require.Equal(t, tc.refutedFloor, RayMulFloor(s, i).String(), "floor must produce the REFUTED value")
			require.Equal(t, tc.refutedHalfUp, RayMulHalfUp(s, i).String(), "half-up must produce the REFUTED value")

			// The fraction really is sub-half, so "rounds up" is not an
			// accident of a near-half input.
			prod := new(big.Int).Mul(s, i)
			_, rem := new(big.Int).QuoRem(prod, RayUnit(), new(big.Int))
			half := new(big.Int).Rsh(RayUnit(), 1)
			require.Equal(t, tc.fracLessThanHalf, rem.Cmp(half) < 0)
			require.Positive(t, rem.Sign(), "an exact product would not discriminate anything")
		})
	}
}

// ---------------------------------------------------------------------------
// Component 3 — live collateral is PURE FLOOR (P-1 DISCHARGED).
// ---------------------------------------------------------------------------

// TestRayMulFloorProbeVectorsFAandFB pins the two discriminating collateral
// vectors from recon/p3-probes.md, read at ETH pin 25,635,618.
//
// F-A is sub-half: floor == half-up, so it kills CEIL only.
// F-B is SUPER-half: floor differs from half-up AND from ceil, so it kills
// both. Without F-B a half-up implementation would pass.
func TestRayMulFloorProbeVectorsFAandFB(t *testing.T) {
	cases := []struct {
		name          string
		scaled, index string
		chainBalance  string
		remainder     string
		halfUp        string
		ceil          string
		superHalf     bool
	}{
		{
			name:         "F-A weETH sub-half (kills ceil)",
			scaled:       "58420665095130",
			index:        "1000002131081530318762840784",
			chainBalance: "58420789594330",
			remainder:    "373169573115114310403781920",
			halfUp:       "58420789594330",
			ceil:         "58420789594331",
			superHalf:    false,
		},
		{
			name:         "F-B USDC super-half (kills half-up AND ceil)",
			scaled:       "348255839",
			index:        "1060431730293296159488823376",
			chainBalance: "369301541",
			remainder:    "935513570098257995931692464",
			halfUp:       "369301542",
			ceil:         "369301542",
			superHalf:    true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, i := mustBig(t, tc.scaled), mustBig(t, tc.index)
			require.Equal(t, tc.chainBalance, RayMulFloor(s, i).String(), "floor must reproduce the chain balanceOf")
			require.Equal(t, tc.halfUp, RayMulHalfUp(s, i).String())
			require.Equal(t, tc.ceil, RayMulCeil(s, i).String())

			prod := new(big.Int).Mul(s, i)
			q, rem := new(big.Int).QuoRem(prod, RayUnit(), new(big.Int))
			require.Equal(t, tc.chainBalance, q.String(), "the probe's recorded quotient")
			require.Equal(t, tc.remainder, rem.String(), "the probe's recorded remainder")
			half := new(big.Int).Rsh(RayUnit(), 1)
			require.Equal(t, tc.superHalf, rem.Cmp(half) > 0)
		})
	}
}

// TestRegimeSplitOnBothSides pins the regime parameter's behaviour with the
// probe vectors. Regime B is the default (the zero value) and is the current
// chain; regime A is the pre-23,088,584 WadRayMath line, where BOTH sides are
// half-up.
func TestRegimeSplitOnBothSides(t *testing.T) {
	fbScaled := mustBig(t, "348255839")
	fbIndex := mustBig(t, "1060431730293296159488823376")

	// Collateral: B floors (chain), A rounds half-up.
	require.Equal(t, "369301541", AaveLiveCollateral(fbScaled, fbIndex, RegimeB).String())
	require.Equal(t, "369301542", AaveLiveCollateral(fbScaled, fbIndex, RegimeA).String())

	caScaled := mustBig(t, "125415")
	caIndex := mustBig(t, "1094089501745475497022017896")
	// Debt: B ceils (chain), A rounds half-up.
	require.Equal(t, "137216", AaveLiveDebt(caScaled, caIndex, RegimeB).String())
	require.Equal(t, "137215", AaveLiveDebt(caScaled, caIndex, RegimeA).String())

	var zero Regime
	require.Equal(t, RegimeB, zero, "the zero value must be the CURRENT regime")
	require.Equal(t, "B", RegimeB.String())
	require.Equal(t, "A", RegimeA.String())
}

// TestRegimeAtBlock pins the boundary block itself.
func TestRegimeAtBlock(t *testing.T) {
	require.Equal(t, uint64(23088584), AaveTokenMathFromBlock)
	require.Equal(t, RegimeA, RegimeAtBlock(23088583))
	require.Equal(t, RegimeB, RegimeAtBlock(23088584))
	require.Equal(t, RegimeB, RegimeAtBlock(25635618))
	require.Equal(t, RegimeA, RegimeAtBlock(0))
}

// ---------------------------------------------------------------------------
// Component 7 — the fused floor division (P-2 DISCHARGED BY FALSIFICATION).
// ---------------------------------------------------------------------------

// goldenHFVectors are the two recorded live-borrower vectors from
// recon/p3-probes.md. Both have uniform LT = 8100 bps.
var goldenHFVectors = []struct {
	name             string
	collateral, debt string
	ltBps            string
	chainHF          string
	refutedFusedHalf string
	refutedFusedCeil string
}{
	{
		name:             "golden borrower C=12305519 D=13720591",
		collateral:       "12305519",
		debt:             "13720591",
		ltBps:            "8100",
		chainHF:          "726460718055075032",
		refutedFusedHalf: "726460718055075033",
		refutedFusedCeil: "726460718055075033",
	},
	{
		name:             "0x849b5e51 C=10000153 D=9604879",
		collateral:       "10000153",
		debt:             "9604879",
		ltBps:            "8100",
		chainHF:          "843334302285328112",
		refutedFusedHalf: "843334302285328113",
		refutedFusedCeil: "843334302285328113",
	},
}

// TestFusedHealthFactorGoldenVectors pins the deployed law and the fused
// half-up / fused ceil values it refutes.
func TestFusedHealthFactorGoldenVectors(t *testing.T) {
	for _, tc := range goldenHFVectors {
		t.Run(tc.name, func(t *testing.T) {
			c, d, lt := mustBig(t, tc.collateral), mustBig(t, tc.debt), mustBig(t, tc.ltBps)
			weighted := new(big.Int).Mul(c, lt)

			hf, ok := FusedHealthFactorWad(weighted, d)
			require.True(t, ok)
			require.Equal(t, tc.chainHF, hf.String(), "the fused FLOOR division is the deployed law")

			// Fused half-up and fused ceil, computed here and asserted to be
			// the recorded REFUTED values.
			n := new(big.Int).Mul(weighted, WadUnit())
			den := new(big.Int).Mul(BpsUnit(), d)
			half := new(big.Int).Add(new(big.Int).Set(n), new(big.Int).Div(new(big.Int).Set(den), big.NewInt(2)))
			require.Equal(t, tc.refutedFusedHalf, half.Div(half, den).String())
			q, rem := new(big.Int).QuoRem(n, den, new(big.Int))
			require.NotZero(t, rem.Sign(), "an exact division would discriminate nothing")
			require.Equal(t, tc.refutedFusedCeil, q.Add(q, big.NewInt(1)).String())
		})
	}
}

// TestFusedHealthFactorRefutesEveryTwoStepComposite is P-2's falsification,
// re-run in the unit layer: on BOTH golden vectors, all four
// wadDiv(percentMul(...)) composites disagree with the chain.
//
// The recorded composites are hard-coded, so this test also proves the two
// helper conventions themselves are implemented as the deployed sources
// describe them.
func TestFusedHealthFactorRefutesEveryTwoStepComposite(t *testing.T) {
	cases := []struct {
		name     string
		c, d, lt string
		chainHF  string
		pmFlWdFl string
		pmFlWdHu string
		pmHuWdFl string
		pmHuWdHu string
	}{
		{
			name: "golden borrower", c: "12305519", d: "13720591", lt: "8100",
			chainHF:  "726460718055075032",
			pmFlWdFl: "726460689630643461",
			pmFlWdHu: "726460689630643461",
			pmHuWdFl: "726460689630643461",
			pmHuWdHu: "726460689630643461",
		},
		{
			name: "0x849b5e51", c: "10000153", d: "9604879", lt: "8100",
			chainHF:  "843334302285328112",
			pmFlWdFl: "843334205459537803",
			pmFlWdHu: "843334205459537804",
			pmHuWdFl: "843334309573290824",
			pmHuWdHu: "843334309573290824",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, d, lt := mustBig(t, tc.c), mustBig(t, tc.d), mustBig(t, tc.lt)
			fused, ok := FusedHealthFactorWad(new(big.Int).Mul(c, lt), d)
			require.True(t, ok)
			require.Equal(t, tc.chainHF, fused.String())

			pmFl := percentMulFloor(c, lt)
			pmHu := percentMulHalfUp(c, lt)
			got := map[string]string{
				"pmFloor+wdFloor":   wadDivFloor(pmFl, d).String(),
				"pmFloor+wdHalfUp":  wadDivHalfUp(pmFl, d).String(),
				"pmHalfUp+wdFloor":  wadDivFloor(pmHu, d).String(),
				"pmHalfUp+wdHalfUp": wadDivHalfUp(pmHu, d).String(),
			}
			require.Equal(t, tc.pmFlWdFl, got["pmFloor+wdFloor"])
			require.Equal(t, tc.pmFlWdHu, got["pmFloor+wdHalfUp"])
			require.Equal(t, tc.pmHuWdFl, got["pmHalfUp+wdFloor"])
			require.Equal(t, tc.pmHuWdHu, got["pmHalfUp+wdHalfUp"])
			for name, v := range got {
				require.NotEqual(t, tc.chainHF, v, "two-step composite %s must NOT reproduce the chain value", name)
			}
		})
	}
}

// TestRetainedTwoStepBoundaryVectors pins the synthetic convention
// discriminators recon/p3-probes.md retained for the unit layer. They exist to
// prove the two rounding conventions are DISTINGUISHABLE on these inputs — so
// the previous test's "all four disagree" is a real result and not an artifact
// of four identical implementations.
func TestRetainedTwoStepBoundaryVectors(t *testing.T) {
	// percentMul: a = 1, bps = 8100 → half-up 1, floor 0.
	require.Equal(t, "1", percentMulHalfUp(big.NewInt(1), big.NewInt(8100)).String())
	require.Equal(t, "0", percentMulFloor(big.NewInt(1), big.NewInt(8100)).String())

	// wadDiv: a = 1000, bps = 8100, b = 1215000000000000000001.
	// percentMul(1000, 8100) = 810 under BOTH conventions (the product is
	// exactly 8100000 and 8100000+5000 still floors to 810), so the vector
	// isolates the wadDiv step alone.
	b := mustBig(t, "1215000000000000000001")
	require.Equal(t, "810", percentMulFloor(big.NewInt(1000), big.NewInt(8100)).String())
	require.Equal(t, "810", percentMulHalfUp(big.NewInt(1000), big.NewInt(8100)).String())
	require.Equal(t, "1", wadDivHalfUp(big.NewInt(810), b).String())
	require.Equal(t, "0", wadDivFloor(big.NewInt(810), b).String())

	// And the shipped fused law on the same inputs is 0 — i.e. it agrees with
	// the floor composite here and refutes the half-up one. This vector alone
	// cannot separate fused from two-step-floor; the golden vectors above do
	// that, and this one closes the half-up arm.
	fused, ok := FusedHealthFactorWad(new(big.Int).Mul(big.NewInt(1000), big.NewInt(8100)), b)
	require.True(t, ok)
	require.Equal(t, "0", fused.String())
}

// TestFusedHealthFactorZeroDebtIsNotANumber: the deployed contract returns
// type(uint256).max for a debt-free account. This package returns a marker.
func TestFusedHealthFactorZeroDebtIsNotANumber(t *testing.T) {
	hf, ok := FusedHealthFactorWad(big.NewInt(1000), big.NewInt(0))
	require.False(t, ok)
	require.Nil(t, hf)

	hf, ok = FusedHealthFactorWad(big.NewInt(1000), nil)
	require.False(t, ok)
	require.Nil(t, hf)

	hf, ok = FusedHealthFactorWad(big.NewInt(1000), big.NewInt(-1))
	require.False(t, ok)
	require.Nil(t, hf)
}

// ---------------------------------------------------------------------------
// The Debt Manager stable snap — an OPEN band.
// ---------------------------------------------------------------------------

// TestApplyDMStableSnapBoundaryIsOpen pins PriceProvider._getStablePrice's
// STRICT comparisons at both edges.
//
// CONTRADICTION PINNED HERE: design spec §6 and risk-quant R3(d) describe
// "0.99 (no-op)". 0.99 × 1e6 = 990000 EXACTLY, and the deployed test is
// `price > STABLE_PRICE - MAX_STABLE_DEVIATION`, i.e. `990000 > 990000`, which
// is FALSE. At exactly 0.99 the snap does NOT fire. The prose paraphrases an
// open band as a closed one.
func TestApplyDMStableSnapBoundaryIsOpen(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		snapped bool
		why     string
	}{
		{"1000000", "1000000", true, "par is inside the band"},
		{"995000", "1000000", true, "0.995 is strictly inside → snaps (the true no-op case)"},
		{"1005000", "1000000", true, "1.005 is strictly inside → snaps"},
		{"990001", "1000000", true, "one wei above the lower edge → snaps"},
		{"1009999", "1000000", true, "one wei below the upper edge → snaps"},
		{"990000", "990000", false, "EXACTLY the lower edge → does NOT snap (990000 > 990000 is false)"},
		{"1010000", "1010000", false, "EXACTLY the upper edge → does NOT snap"},
		{"989999", "989999", false, "below the band"},
		{"980000", "980000", false, "0.98 → outside, unsnapped"},
		{"1010001", "1010001", false, "above the band"},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, snapped := ApplyDMStableSnap(mustBig(t, tc.in))
			require.Equal(t, tc.want, got.String(), tc.why)
			require.Equal(t, tc.snapped, snapped, tc.why)
		})
	}

	out, snapped := ApplyDMStableSnap(nil)
	require.Nil(t, out)
	require.False(t, snapped)
}

// TestApplyDMStableSnapDoesNotMutateInput guards the defensive copy.
func TestApplyDMStableSnapDoesNotMutateInput(t *testing.T) {
	in := mustBig(t, "995000")
	out, _ := ApplyDMStableSnap(in)
	out.SetInt64(1)
	require.Equal(t, "995000", in.String())
}

// ---------------------------------------------------------------------------
// Price caps bind UPWARD only.
// ---------------------------------------------------------------------------

// TestApplyPriceCapBindsUpwardOnly is the synthetic cap-binding vector
// oracle-sentinel R6-1 demands: validation that only passes in calm weather
// diverges exactly in a crisis. No shipped v1 scenario binds a cap (all are
// down-shocks), so this is the only place the behaviour is exercised.
func TestApplyPriceCapBindsUpwardOnly(t *testing.T) {
	cap := mustBig(t, "102000000") // 1.02 at 8 decimals

	// Upward: an uncapped feed above the cap is pinned AT the cap.
	got, bound := ApplyPriceCap(mustBig(t, "105000000"), cap)
	require.Equal(t, "102000000", got.String())
	require.True(t, bound)

	// Exactly at the cap: not bound, value unchanged.
	got, bound = ApplyPriceCap(mustBig(t, "102000000"), cap)
	require.Equal(t, "102000000", got.String())
	require.False(t, bound)

	// Downward: passes straight through — this is why every v1 down-shock
	// leaves the caps slack.
	got, bound = ApplyPriceCap(mustBig(t, "95000000"), cap)
	require.Equal(t, "95000000", got.String())
	require.False(t, bound)

	// No cap configured.
	got, bound = ApplyPriceCap(mustBig(t, "999999999"), nil)
	require.Equal(t, "999999999", got.String())
	require.False(t, bound)

	got, bound = ApplyPriceCap(nil, cap)
	require.Nil(t, got)
	require.False(t, bound)
}

// ---------------------------------------------------------------------------
// The two liquidation-bonus conventions.
// ---------------------------------------------------------------------------

// TestLiquidationBonusMultiplierConventions pins the fact that the two engines
// express a liquidation bonus incompatibly, using REAL on-chain values:
//
//   - Aave weETH bonus 10600 (recon/p3-probes.md configurator table) is a
//     MULTIPLIER: 1.06×.
//   - Debt Manager EURC bonus 1e18 and ETHFI bonus 4e18
//     (internal/decode/testdata/dm_collateral_token_config_set.json, real OP
//     logs at block 149,965,263) are ADDITIVE over 100e18: 1.01× and 1.04×.
//
// Reading a DM bonus with Aave's convention would give 1e18/1e4 = 1e14×.
func TestLiquidationBonusMultiplierConventions(t *testing.T) {
	// Aave: 10600 bps ⇒ 10600/10000.
	n, d, ok := LiquidationBonusMultiplier(AaveEngine, big.NewInt(10600))
	require.True(t, ok)
	require.Equal(t, "10600", n.String())
	require.Equal(t, "10000", d.String())
	// $100 of debt seizes $106 of collateral.
	require.Equal(t, "106", MulDivFloor(big.NewInt(100), n, d).String())

	n, d, ok = LiquidationBonusMultiplier(AaveParamEngine, big.NewInt(10600))
	require.True(t, ok)
	require.Equal(t, "10600", n.String())

	// Debt Manager EURC: 1e18 ⇒ (100e18 + 1e18)/100e18.
	n, d, ok = LiquidationBonusMultiplier(DMEngine, mustBig(t, "1000000000000000000"))
	require.True(t, ok)
	require.Equal(t, "101000000000000000000", n.String())
	require.Equal(t, "100000000000000000000", d.String())
	require.Equal(t, "101", MulDivFloor(big.NewInt(100), n, d).String())

	// Debt Manager ETHFI: 4e18 ⇒ 1.04×.
	n, d, ok = LiquidationBonusMultiplier(DMEngine, mustBig(t, "4000000000000000000"))
	require.True(t, ok)
	require.Equal(t, "104000000000000000000", n.String())
	require.Equal(t, "104", MulDivFloor(big.NewInt(100), n, d).String())

	// Zero bonus on the DM is 1.00×; on Aave a bps multiplier below 1.00 is
	// refused rather than silently understating collateral at risk.
	n, d, ok = LiquidationBonusMultiplier(DMEngine, big.NewInt(0))
	require.True(t, ok)
	require.Equal(t, "100", MulDivFloor(big.NewInt(100), n, d).String())

	_, _, ok = LiquidationBonusMultiplier(AaveEngine, big.NewInt(9999))
	require.False(t, ok, "an Aave bonus below 10000 bps is not a multiplier")

	_, _, ok = LiquidationBonusMultiplier(DMEngine, big.NewInt(-1))
	require.False(t, ok)
	_, _, ok = LiquidationBonusMultiplier(DMEngine, nil)
	require.False(t, ok)
	_, _, ok = LiquidationBonusMultiplier("something_else", big.NewInt(1))
	require.False(t, ok)
}

// ---------------------------------------------------------------------------
// Denominators and small helpers.
// ---------------------------------------------------------------------------

// TestDenominatorsAreDistinctAndCorrect pins the four fixed-point scales. The
// BPS/HUNDRED_PERCENT pair is the dangerous one: both mean "a percentage" and
// they differ by 1e16.
func TestDenominatorsAreDistinctAndCorrect(t *testing.T) {
	require.Equal(t, "1000000000000000000000000000", RayUnit().String())
	require.Equal(t, "1000000000000000000", WadUnit().String())
	require.Equal(t, "10000", BpsUnit().String())
	require.Equal(t, "100000000000000000000", HundredPercentUnit().String())
	require.Equal(t, "31536000", SecondsPerYear().String())

	ratio := new(big.Int).Div(HundredPercentUnit(), BpsUnit())
	require.Equal(t, "10000000000000000", ratio.String(), "the two percentage denominators differ by 1e16")

	// The accessors hand out copies; mutating one must not poison the package.
	r := RayUnit()
	r.SetInt64(1)
	require.Equal(t, "1000000000000000000000000000", RayUnit().String())
	w := WadUnit()
	w.SetInt64(1)
	require.Equal(t, "1000000000000000000", WadUnit().String())
	b := BpsUnit()
	b.SetInt64(1)
	require.Equal(t, "10000", BpsUnit().String())
	h := HundredPercentUnit()
	h.SetInt64(1)
	require.Equal(t, "100000000000000000000", HundredPercentUnit().String())
	sy := SecondsPerYear()
	sy.SetInt64(1)
	require.Equal(t, "31536000", SecondsPerYear().String())
	g := WaterfallGridScale()
	g.SetInt64(1)
	require.Equal(t, "1000000000000000000", WaterfallGridScale().String())
}

// TestMulDivFloorTruncatesTowardZero pins the floor helper's direction.
func TestMulDivFloorTruncatesTowardZero(t *testing.T) {
	require.Equal(t, "3", MulDivFloor(big.NewInt(7), big.NewInt(5), big.NewInt(10)).String())  // 3.5 → 3
	require.Equal(t, "3", MulDivFloor(big.NewInt(39), big.NewInt(1), big.NewInt(10)).String()) // 3.9 → 3
	require.Equal(t, "0", MulDivFloor(big.NewInt(9), big.NewInt(1), big.NewInt(10)).String())
	require.Equal(t, "0", MulDivFloor(big.NewInt(0), big.NewInt(1), big.NewInt(10)).String())
}

// TestAPYPerSecondFromAnnualMatchesDeployedFixture: the deployed Debt Manager
// test suite hard-codes 317097919837 as "10% / 365 days in seconds"
// (test/safe/SafeTestSetup.t.sol). Reproducing that exact integer proves the
// year length and the HUNDRED_PERCENT scaling are both right.
func TestAPYPerSecondFromAnnualMatchesDeployedFixture(t *testing.T) {
	tenPercent := mustBig(t, "10000000000000000000") // 10e18 = 10% in the 100e18 convention
	require.Equal(t, "317097919837", APYPerSecondFromAnnual(tenPercent).String())

	twoPercent := mustBig(t, "2000000000000000000") // 200 bps
	require.Equal(t, "63419583967", APYPerSecondFromAnnual(twoPercent).String())

	require.Equal(t, "0", APYPerSecondFromAnnual(nil).String())
}

// TestSmallHelpers covers the defensive-copy helpers.
func TestSmallHelpers(t *testing.T) {
	require.Equal(t, "0", orZero(nil).String())
	src := big.NewInt(5)
	cp := orZero(src)
	cp.SetInt64(9)
	require.Equal(t, "5", src.String())

	require.Equal(t, "1", pow10(0).String())
	require.Equal(t, "1000000", pow10(6).String())
	require.Equal(t, "100000000", pow10(8).String())
	require.Equal(t, "1000000000000000000", pow10(18).String())

	require.Equal(t, "0", maxZero(big.NewInt(-3)).String())
	require.Equal(t, "3", maxZero(big.NewInt(3)).String())
	require.Equal(t, "0", maxZero(big.NewInt(0)).String())

	require.Equal(t, "2", minBig(big.NewInt(2), big.NewInt(3)).String())
	require.Equal(t, "2", minBig(big.NewInt(3), big.NewInt(2)).String())
	require.Equal(t, "2", minBig(big.NewInt(2), big.NewInt(2)).String())
}
