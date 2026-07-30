package risk

import (
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// End-to-end: the golden borrower, from scaled balances to the chain's HF.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthGoldenBorrowerEndToEnd walks all seven components with
// the REAL probe vectors on both ray legs and lands on the REAL chain health
// factor.
//
// Construction (stated, because half of it is synthetic):
//
//   - Collateral leg uses probe vector F-A verbatim: scaled 58420665095130 ×
//     index 1000002131081530318762840784 → 58420789594330 wei of weETH (floor).
//   - Debt leg uses probe vector C-A verbatim: scaled 125415 × index
//     1094089501745475497022017896 → 137216 units of USDC (ceil).
//   - The two PRICES are synthetic, chosen so the base totals land exactly on
//     the recorded golden-borrower values C = 12305519 and D = 13720591
//     (8-decimal base currency, i.e. $0.12305519 and $0.13720591 — this is one
//     of the three sub-1.0 dust positions the probe found live at the pin).
//     weETH at 210635958286 is $2106.36; USDC at 99992646 is $0.99992646. Both
//     are plausible marks, but they are solved-for, not read.
//   - LT = 8100 bps is the real weETH configuration (the single
//     CollateralConfigurationChanged the configurator ever emitted).
//
// The ASSERTION — 726460718055075032 — is the chain's own healthFactor.
//
// # REV-3 RE-PIN of the solved USDC price: 99992647 → 99992646
//
// The debt leg is a CEILING now, so the price that solved D = 13720591 under
// floor no longer solves it:
//
//	137216 × 99992647 = 13720591050752   floor 13720591   CEIL 13720592  ✗
//	137216 × 99992646 = 13720590913536   floor 13720590   CEIL 13720591  ✓
//
// The full bracket of prices satisfying ceil(137216·p/1e6) = 13720591 is
// [99992640, 99992646] — verified endpoint-by-endpoint in
// TestComputeAaveHealthGoldenDebtPriceBracket — and 99992646 is its top, kept
// because it is adjacent to the value this test carried before.
//
// NOTE the character of the retained leg: remainder 913536 out of 1000000 is
// SUPER-half, so ceil and half-up agree here (both 13720591) and this vector
// cannot separate them. That is exactly why
// TestComputeAaveHealthDebtLegCeilsOnSubHalfRemainders exists.
//
// Component 7's re-derivation does NOT move this assertion: Σ·1e18 = q·D + r
// with q ≡ 8466 (mod 1e4) and r = 2356594 < ⌈D/2⌉ = 6860296, so the inner
// half-up carry does not fire and the composite coincides with the refuted fused
// floor. A vector where it does NOT coincide rides the same pipeline in
// TestComputeAaveHealthComponent7CompositeCarriesEndToEnd.
func TestComputeAaveHealthGoldenBorrowerEndToEnd(t *testing.T) {
	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			{
				Asset: aWeETH, Decimals: 18,
				ScaledCollateral: mustBig(t, "58420665095130"),
				CollateralIndex:  mustBig(t, "1000002131081530318762840784"),
				ScaledDebt:       big.NewInt(0),
				IndexBlock:       25635610, IndexTime: fixedTime,
				UsedAsCollateral: true,
			},
			{
				Asset: aUSDC, Decimals: 6,
				ScaledCollateral: big.NewInt(0),
				ScaledDebt:       mustBig(t, "125415"),
				DebtIndex:        mustBig(t, "1094089501745475497022017896"),
				IndexBlock:       25635612, IndexTime: fixedTime,
				UsedAsCollateral: false,
			},
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{
			adapterPrice(aWeETH, "210635958286"),
			adapterPrice(aUSDC, "99992646"),
		},
	}

	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)

	// Components 2 and 3.
	requireBig(t, "58420789594330", h.Reserves[0].LiveCollateral, "component 3: rayMulFloor")
	requireBig(t, "0", h.Reserves[0].LiveDebt)
	requireBig(t, "137216", h.Reserves[1].LiveDebt, "component 2: rayMulCeil")
	requireBig(t, "0", h.Reserves[1].LiveCollateral)

	// Component 4/5.
	requireBig(t, "12305519", h.Reserves[0].CollateralBase)
	requireBig(t, "13720591", h.Reserves[1].DebtBase)
	requireBig(t, "12305519", h.TotalCollateralBase)
	requireBig(t, "13720591", h.TotalDebtBase)
	require.Equal(t, uint8(8), h.BaseDecimals)

	// Component 4, the debt leg's own integers — spelled out because the ceiling
	// is the rev-3 correction and "13720591" alone would not show which law
	// produced it.
	prod := new(big.Int).Mul(mustBig(t, "137216"), mustBig(t, "99992646"))
	requireBig(t, "13720590913536", prod)
	q, rem := new(big.Int).QuoRem(prod, pow10(6), new(big.Int))
	requireBig(t, "13720590", q, "the REFUTED floor: what rev 2 published")
	requireBig(t, "913536", rem)
	require.Equal(t, 1, rem.Cmp(big.NewInt(500000)),
		"this leg's remainder is SUPER-half, so it cannot separate ceil from half-up")
	requireBig(t, "13720591", new(big.Int).Add(q, big.NewInt(1)), "ceil — the chain's value")
	require.Equal(t, "13720591", h.Reserves[1].DebtBase.String(),
		"the pipeline must have used the CEILING, not the floor sitting one unit below it")

	// The collateral leg is untouched by rev 3 and still truncates.
	colProd := new(big.Int).Mul(mustBig(t, "58420789594330"), mustBig(t, "210635958286"))
	colQ, colRem := new(big.Int).QuoRem(colProd, pow10(18), new(big.Int))
	requireBig(t, "12305519", colQ)
	require.NotZero(t, colRem.Sign(), "an exact collateral leg would discriminate nothing")
	requireBig(t, "12305519", h.Reserves[0].CollateralBase,
		"collateral FLOORS even though the debt leg one row down CEILS")

	// Component 6 — disclosure. Uniform LT, so the average is exactly 8100.
	requireBig(t, "99674703900", h.WeightedLTSum, "12305519 × 8100")
	requireBig(t, "8100", h.AvgLiquidationThresholdBps)

	// Component 7 — the chain's own number, under the half-up composite.
	requireBig(t, "726460718055075032", h.HealthFactorWad)
	require.False(t, h.IsInfinite)

	// …and the reason this borrower cannot discriminate the composite from the
	// refuted fused floor: the inner carry does not fire.
	inner, carryRem := new(big.Int).QuoRem(
		new(big.Int).Mul(mustBig(t, "99674703900"), WadUnit()), mustBig(t, "13720591"), new(big.Int))
	requireBig(t, "7264607180550750328466", inner, "q = floor(Σ·1e18 / D)")
	requireBig(t, "8466", new(big.Int).Mod(inner, BpsUnit()), "q mod 1e4 — not 9999, so no ULP step")
	requireBig(t, "2356594", carryRem, "r")
	requireBig(t, "6860296", new(big.Int).Div(new(big.Int).Add(mustBig(t, "13720591"), big.NewInt(1)), big.NewInt(2)), "⌈D/2⌉")
	require.Equal(t, -1, carryRem.Cmp(big.NewInt(6860296)), "r < ⌈D/2⌉: the half-up carry does NOT fire here")
	refuted, ok := fusedHealthFactorWad(mustBig(t, "99674703900"), mustBig(t, "13720591"))
	require.True(t, ok)
	require.Equal(t, h.HealthFactorWad.String(), refuted.String(),
		"on this borrower the composite and the refuted fused floor COINCIDE — which is precisely why 12/12 exact never caught the difference")

	// The exact rational carries the same quantity un-rounded. Re-flooring it to
	// WAD reproduces the same integer HERE only because the carry did not fire;
	// on a carry vector HealthFactorWad is floor + 1 (see
	// TestComputeAaveHealthComponent7CompositeCarriesEndToEnd).
	requireBig(t, "99674703900", h.HealthFactor.Num)
	requireBig(t, "137205910000", h.HealthFactor.Den, "10000 × totalDebtBase")
	v, ok := h.HealthFactor.FloorScaled(WadUnit())
	require.True(t, ok)
	requireBig(t, "726460718055075032", v)

	// Below 1.0 — this really is one of the sub-1.0 dust positions.
	require.Equal(t, -1, h.HealthFactor.CmpScaled(big.NewInt(1), big.NewInt(1)))

	require.False(t, h.StalePriceInputs)
	require.Equal(t, fixedTime, h.OldestPriceInput)
	require.Equal(t, RegimeB, h.Regime)
}

// ---------------------------------------------------------------------------
// Rev-3 component 4: the debt leg CEILS.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthGoldenDebtPriceBracket verifies the re-pin bracket the
// ruling supplied, endpoint by endpoint, THROUGH THE PIPELINE rather than by
// re-deriving it on the side.
//
// ceil(137216·p/1e6) = 13720591 holds for p ∈ [99992640, 99992646] and for no
// price outside it. Both endpoints are asserted, and so are the two prices that
// bracket them — a bracket whose ends are not shown to be ends is an assertion
// about nothing.
func TestComputeAaveHealthGoldenDebtPriceBracket(t *testing.T) {
	debtBaseAt := func(t *testing.T, price string) *big.Int {
		t.Helper()
		h, err := ComputeAaveHealth(AaveInput{
			Marks:   testAaveMarks,
			Account: acctA,
			Reserves: []AaveReserve{
				simpleReserve(aUSDC, 6, "0", "137216", false),
			},
			Prices: []PriceInput{adapterPrice(aUSDC, price)},
		})
		require.NoError(t, err)
		requireBig(t, "137216", h.Reserves[0].LiveDebt, "index is RAY, so the scaled balance IS the live one")
		return h.TotalDebtBase
	}

	for _, tc := range []struct {
		price, wantDebtBase, note string
	}{
		{"99992639", "13720590", "one below the bracket: 13720589953024 ceils to 13720590"},
		{"99992640", "13720591", "BRACKET LOW: 13720590090240, remainder 90240"},
		{"99992643", "13720591", "interior"},
		{"99992646", "13720591", "BRACKET HIGH: 13720590913536, remainder 913536 — the re-pinned price"},
		{"99992647", "13720592", "one above: 13720591050752 ceils to 13720592, which is why 99992647 no longer solves the pin"},
	} {
		t.Run(tc.price, func(t *testing.T) {
			requireBig(t, tc.wantDebtBase, debtBaseAt(t, tc.price), tc.note)
		})
	}
}

// TestComputeAaveHealthDebtLegCeilsOnSubHalfRemainders is the ruling's BLOCKING
// ITEM 2, and it is the only vector in this suite that pins the debt leg's law
// uniquely.
//
// The golden leg's remainder is 913536/1000000 — SUPER-half — so ceil and half-up
// both produce 13720591 there and the vector is blind to the difference between
// them. Under a SUB-half remainder all three conventions separate at once:
//
//	137216 × 99992603 = 13720585013248   rem  13248  (frac ≈ 0.0132)
//	137216 × 99992606 = 13720585424896   rem 424896  (frac ≈ 0.4249)
//
//	floor    13720585      half-up  13720585      CEIL  13720586
//
// Both points sit inside the sub-half band — one just above zero, one just below
// the half — and both must round UP, because MathUtils.mulDivCeil adds one for
// ANY nonzero remainder. floor and half-up agree with each other and disagree
// with the chain; that is the discrimination.
//
// The health factor separates too, and in the safe direction: the larger ceil-D
// yields the LOWER health factor.
func TestComputeAaveHealthDebtLegCeilsOnSubHalfRemainders(t *testing.T) {
	for _, tc := range []struct {
		price, product, remainder string
	}{
		{"99992603", "13720585013248", "13248"},
		{"99992606", "13720585424896", "424896"},
	} {
		t.Run(tc.price, func(t *testing.T) {
			// The three conventions, computed here from the hard-coded integers.
			prod := new(big.Int).Mul(mustBig(t, "137216"), mustBig(t, tc.price))
			requireBig(t, tc.product, prod)
			den := pow10(6)
			floor, rem := new(big.Int).QuoRem(new(big.Int).Set(prod), den, new(big.Int))
			requireBig(t, tc.remainder, rem)
			require.Equal(t, -1, rem.Cmp(big.NewInt(500000)),
				"the remainder must be BELOW half or this vector cannot separate ceil from half-up")
			require.NotZero(t, rem.Sign(), "…and nonzero, or it cannot separate ceil from floor either")
			halfUp := new(big.Int).Add(new(big.Int).Set(prod), big.NewInt(500000))
			halfUp.Div(halfUp, den)
			ceil := new(big.Int).Add(new(big.Int).Set(floor), big.NewInt(1))
			requireBig(t, "13720585", floor, "REFUTED: floor")
			requireBig(t, "13720585", halfUp, "REFUTED: half-up — equal to floor on a sub-half remainder")
			requireBig(t, "13720586", ceil, "the deployed law")

			h, err := ComputeAaveHealth(AaveInput{
				Marks:   testAaveMarks,
				Account: acctA,
				Reserves: []AaveReserve{
					simpleReserve(aWeETH, 8, "20000000", "0", true),
					simpleReserve(aUSDC, 6, "0", "137216", false),
				},
				Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
				Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, tc.price)},
			})
			require.NoError(t, err)
			requireBig(t, "13720586", h.Reserves[1].DebtBase, "the pipeline CEILS the debt leg")
			requireBig(t, "13720586", h.TotalDebtBase)
			requireBig(t, "162000000000", h.WeightedLTSum, "20000000 × 8100")

			// Health factor under the shipped ceil-D, and under the refuted
			// floor-D, computed with the SAME component-7 law so the only
			// difference is the debt-leg rounding.
			requireBig(t, "1180707587853754934", h.HealthFactorWad)
			refuted, ok := AaveHealthFactorWad(mustBig(t, "162000000000"), mustBig(t, "13720585"))
			require.True(t, ok)
			requireBig(t, "1180707673907490096", refuted, "what a floored debt leg would have published")
			require.Equal(t, -1, h.HealthFactorWad.Cmp(refuted),
				"ceiling the debt raises D and therefore LOWERS the health factor — the conservative direction")
		})
	}
}

// TestComputeAaveHealthComponent4LegsRoundOppositeWaysOnOneVector puts the
// asymmetry beyond doubt by giving ONE reserve both a debt and a collateral
// balance of the SAME size at the SAME price, so a single (amount, price,
// decimals) triple has to produce two different base values.
//
//	137216 × 99992603 / 1e6 = 13720585.013248
//	  collateralBase = 13720585   (floor)
//	  debtBase       = 13720586   (ceil)
//
// A single-rounding implementation cannot pass this test, whichever rounding it
// picks.
func TestComputeAaveHealthComponent4LegsRoundOppositeWaysOnOneVector(t *testing.T) {
	h, err := ComputeAaveHealth(AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aUSDC, 6, "137216", "137216", true),
		},
		Params: []ParamRow{aaveParam(aUSDC, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aUSDC, "99992603")},
	})
	require.NoError(t, err)
	requireBig(t, "137216", h.Reserves[0].LiveCollateral)
	requireBig(t, "137216", h.Reserves[0].LiveDebt)
	requireBig(t, "13720585", h.Reserves[0].CollateralBase, "collateral truncates")
	requireBig(t, "13720586", h.Reserves[0].DebtBase, "debt ceils")
	require.Equal(t, 1, h.Reserves[0].DebtBase.Cmp(h.Reserves[0].CollateralBase),
		"the same tokens at the same price must value HIGHER as debt than as collateral")
	requireBig(t, "1", new(big.Int).Sub(h.Reserves[0].DebtBase, h.Reserves[0].CollateralBase),
		"exactly one base unit apart: one ceiling step")
}

// TestComputeAaveHealthDebtCeilAccumulatesPerReserve is the CODEX-DEMANDED
// regression vector for the multi-reserve bound.
//
// The rev-3 note originally claimed the rev-2 → rev-3 debt move was bounded by
// ONE base unit. That is false, and this test is why: `mulDivCeil` is applied
// per reserve inside `_getUserDebtInBaseCurrency` and the results are SUMMED
// (GenericLogic.sol:141), so each debt-bearing reserve whose conversion leaves a
// nonzero remainder contributes its own +1. The true bound is
//
//	0 ≤ D_rev3 − D_rev2 ≤ N,   N = debt-bearing reserves with a nonzero remainder
//
// and this market's registry lists THREE borrowables (USDC, PYUSD, FRAX), so N
// reaches 3 on a fully-diversified borrower.
//
// The per-reserve structure is not a rounding preference — it is forced. Each
// reserve divides by its OWN assetUnit (10^decimals), so for a book mixing 6-
// and 18-decimal debt there is no single denominator a "sum the products, divide
// once" form could even use. The two-reserve case below happens to share
// decimals, which lets it ALSO refute that strawman with a distinct third value.
func TestComputeAaveHealthDebtCeilAccumulatesPerReserve(t *testing.T) {
	// One collateral leg, held constant: C = 20000000, LT = 8100 ⇒ Σ = 162000000000.
	collateral := simpleReserve(aWeETH, 8, "20000000", "0", true)

	// Each debt leg's integers, spelled out. Both remainder characters are
	// represented, which shows the per-leg increment is 1 regardless of how big
	// the remainder is — a pure ceiling does not care.
	type debtLeg struct {
		reserve               AaveReserve
		price                 string
		product, remainder    string
		floorBase, halfUpBase string
		ceilBase              string
	}
	usdc := debtLeg{
		reserve: simpleReserve(aUSDC, 6, "0", "137216", false), price: "99992603",
		product: "13720585013248", remainder: "13248", // sub-half
		floorBase: "13720585", halfUpBase: "13720585", ceilBase: "13720586",
	}
	pyusd := debtLeg{
		reserve: simpleReserve(aPYUSD, 6, "0", "137231", false), price: "99981000",
		product: "13720492611000", remainder: "611000", // super-half
		floorBase: "13720492", halfUpBase: "13720493", ceilBase: "13720493",
	}
	frax := debtLeg{
		reserve: simpleReserve(aFRAX, 18, "0", "1000000000000000001", false), price: "99990000",
		product: "99990000000000000099990000", remainder: "99990000", // sub-half, 18-dec
		floorBase: "99990000", halfUpBase: "99990000", ceilBase: "99990001",
	}

	// run returns the pipeline's result plus the rev-2 (per-leg floor) and rev-3
	// (per-leg ceil) debt totals, each ACCUMULATED from the per-leg integers
	// rather than restated as a literal.
	run := func(t *testing.T, legs []debtLeg) (h AaveHealth, rev2D, rev3D *big.Int) {
		t.Helper()
		in := AaveInput{
			Marks:    testAaveMarks,
			Account:  acctA,
			Reserves: []AaveReserve{collateral},
			Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
			Prices:   []PriceInput{adapterPrice(aWeETH, "100000000")},
		}
		for _, l := range legs {
			in.Reserves = append(in.Reserves, l.reserve)
			in.Prices = append(in.Prices, adapterPrice(l.reserve.Asset, l.price))
		}
		h, err := ComputeAaveHealth(in)
		require.NoError(t, err)

		// Per-leg: derive all three conventions from the leg's OWN inputs, check
		// them against the recorded integers, and confirm the pipeline produced
		// the ceiling.
		rev2D, rev3D = new(big.Int), new(big.Int)
		for i, l := range legs {
			den := pow10(l.reserve.Decimals)
			prod := new(big.Int).Mul(orZero(l.reserve.ScaledDebt), mustBig(t, l.price))
			requireBig(t, l.product, prod, "leg %d product", i)

			q, rem := new(big.Int).QuoRem(prod, den, new(big.Int))
			requireBig(t, l.floorBase, q, "leg %d floor", i)
			requireBig(t, l.remainder, rem, "leg %d remainder", i)

			hu := new(big.Int).Add(prod, new(big.Int).Div(new(big.Int).Set(den), big.NewInt(2)))
			requireBig(t, l.halfUpBase, hu.Div(hu, den), "leg %d half-up", i)

			ceil := new(big.Int).Set(q)
			if rem.Sign() != 0 {
				ceil.Add(ceil, big.NewInt(1))
			}
			requireBig(t, l.ceilBase, ceil, "leg %d ceil", i)
			requireBig(t, l.ceilBase, h.Reserves[i+1].DebtBase, "leg %d: the pipeline CEILS this leg", i)

			rev2D.Add(rev2D, q)
			rev3D.Add(rev3D, ceil)
		}

		// The accumulation: one +1 PER LEG with a nonzero remainder, not one overall.
		requireBig(t, rev3D.String(), h.TotalDebtBase, "component 5 sums the per-reserve ceilings")
		return h, rev2D, rev3D
	}

	t.Run("two debt reserves move total debt by +2", func(t *testing.T) {
		h, rev2D, rev3D := run(t, []debtLeg{usdc, pyusd})

		requireBig(t, "27441077", rev2D, "rev-2: floor 13720585 + floor 13720492")
		requireBig(t, "27441079", rev3D, "rev-3: ceil 13720586 + ceil 13720493")
		requireBig(t, "2", new(big.Int).Sub(rev3D, rev2D),
			"TWO base units, not one — this is the assertion that makes the old bound false")
		requireBig(t, "27441079", h.TotalDebtBase)
		requireBig(t, "162000000000", h.WeightedLTSum)

		// THE REFUTED THIRD FORM, available here because both legs are 6-decimal:
		// sum the products and ceil ONCE. It lands between the two per-leg forms,
		// so this vector separates all three at the same time.
		totalProduct := new(big.Int).Add(mustBig(t, usdc.product), mustBig(t, pyusd.product))
		requireBig(t, "27441077624248", totalProduct)
		q, rem := new(big.Int).QuoRem(totalProduct, pow10(6), new(big.Int))
		requireBig(t, "27441077", q)
		requireBig(t, "624248", rem)
		sumThenCeil := new(big.Int).Add(q, big.NewInt(1))
		requireBig(t, "27441078", sumThenCeil, "REFUTED: one ceiling over the summed products")
		require.Equal(t, 1, h.TotalDebtBase.Cmp(sumThenCeil),
			"per-reserve ceilings sum HIGHER than a single ceiling over the sum — "+
				"27441077 (rev-2) < 27441078 (sum-then-ceil) < 27441079 (deployed)")

		// And the health factor separates on all three, in the safe direction:
		// more debt ⇒ lower health factor.
		requireBig(t, "590355794682854854", h.HealthFactorWad)
		rev2, ok := AaveHealthFactorWad(mustBig(t, "162000000000"), rev2D)
		require.True(t, ok)
		requireBig(t, "590355837710014078", rev2, "what rev 2 published")
		mid, ok := AaveHealthFactorWad(mustBig(t, "162000000000"), sumThenCeil)
		require.True(t, ok)
		requireBig(t, "590355816196433682", mid)
		require.Equal(t, -1, h.HealthFactorWad.Cmp(mid))
		require.Equal(t, -1, mid.Cmp(rev2), "strictly ordered: deployed < sum-then-ceil < rev-2")
	})

	t.Run("all three borrowables move total debt by +3, which is this market's N", func(t *testing.T) {
		h, rev2D, rev3D := run(t, []debtLeg{usdc, pyusd, frax})

		requireBig(t, "127431077", rev2D, "rev-2: 13720585 + 13720492 + 99990000")
		requireBig(t, "127431080", rev3D, "rev-3: 13720586 + 13720493 + 99990001")
		requireBig(t, "3", new(big.Int).Sub(rev3D, rev2D),
			"THREE base units — the bound is N, and N = 3 is this market's whole borrowable set")
		requireBig(t, "127431080", h.TotalDebtBase)
		requireBig(t, "127127542197711892", h.HealthFactorWad)
		rev2, ok := AaveHealthFactorWad(mustBig(t, "162000000000"), rev2D)
		require.True(t, ok)
		requireBig(t, "127127545190566034", rev2)
		require.Equal(t, -1, h.HealthFactorWad.Cmp(rev2), "safe direction")

		// The mixed 6/18-decimal book is exactly the case where a single fused
		// ceiling is not even expressible: there is no shared assetUnit.
		require.NotEqual(t, usdc.reserve.Decimals, frax.reserve.Decimals,
			"the point of including FRAX: 18-dec debt alongside 6-dec debt")
	})

	t.Run("legs that divide exactly contribute nothing, so the bound's floor is 0", func(t *testing.T) {
		// The LOWER end of 0..N, through the same harness: two debt reserves, both
		// exactly dividing, delta 0. This is why the bound is a range and not a
		// count of reserves — and it is why every survivor vector in this suite
		// (whose debt legs all divide exactly) came through rev 3 unmoved.
		_, rev2D, rev3D := run(t, []debtLeg{
			{
				reserve: simpleReserve(aUSDC, 8, "0", "10000000", false), price: "100000000",
				product: "1000000000000000", remainder: "0",
				floorBase: "10000000", halfUpBase: "10000000", ceilBase: "10000000",
			},
			{
				reserve: simpleReserve(aPYUSD, 8, "0", "20000000", false), price: "100000000",
				product: "2000000000000000", remainder: "0",
				floorBase: "20000000", halfUpBase: "20000000", ceilBase: "20000000",
			},
		})
		requireBig(t, "30000000", rev2D)
		requireBig(t, "30000000", rev3D)
		requireBig(t, "0", new(big.Int).Sub(rev3D, rev2D),
			"delta 0 despite N = 2: the bound is 0..N, not exactly N")
	})
}

// ---------------------------------------------------------------------------
// Rev-3 component 7: the half-up composite, end to end.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthComponent7CompositeCarriesEndToEnd is the ruling's
// BLOCKING ITEM 1 riding the whole pipeline rather than only the helper.
//
// Every recorded live borrower has q ≢ 9999 (mod 1e4) and therefore cannot tell
// the composite from the refuted fused floor. This vector can. Its debt leg is an
// EXACT division (13720591 × 1e8 / 1e8) so component 4's ceiling is inert here
// and the only thing under test is component 7:
//
//	C = 12315707, LT = 8100  ⇒  Σ = 99757226700
//	D = 13720591
//	Σ·1e18 = q·D + r   with q = 7270621702811489679999   (q mod 1e4 = 9999)
//	                        r = 12840591 ≥ ⌈D/2⌉ = 6860296   ⇒ the carry FIRES
//	inner wadDiv = q + 1 = 7270621702811489680000
//	  composite   = 727062170281148968   <- the chain, and what ships
//	  fused floor = 727062170281148967   <- rev 2, one wad ULP LOW
//
// A build that still fused-floored, or that floored the inner division, or that
// used any of the four two-step composites, lands on a different integer.
func TestComputeAaveHealthComponent7CompositeCarriesEndToEnd(t *testing.T) {
	h, err := ComputeAaveHealth(AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "12315707", "0", true),
			simpleReserve(aUSDC, 8, "0", "13720591", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	})
	require.NoError(t, err)

	sigma, d := mustBig(t, "99757226700"), mustBig(t, "13720591")
	requireBig(t, "12315707", h.TotalCollateralBase)
	requireBig(t, "13720591", h.TotalDebtBase, "exact division: component 4's ceiling is inert on this vector")
	requireBig(t, "99757226700", h.WeightedLTSum, "12315707 × 8100")
	requireBig(t, "8100", h.AvgLiquidationThresholdBps)

	// The carry, in integers.
	q, r := new(big.Int).QuoRem(new(big.Int).Mul(sigma, WadUnit()), d, new(big.Int))
	requireBig(t, "7270621702811489679999", q)
	requireBig(t, "9999", new(big.Int).Mod(new(big.Int).Set(q), BpsUnit()),
		"q ≡ 9999 (mod 1e4) — the /1e4 step is one unit away from stepping")
	requireBig(t, "12840591", r)
	ceilHalfD := new(big.Int).Div(new(big.Int).Add(new(big.Int).Set(d), big.NewInt(1)), big.NewInt(2))
	requireBig(t, "6860296", ceilHalfD)
	require.GreaterOrEqual(t, r.Cmp(ceilHalfD), 0, "r ≥ ⌈D/2⌉: the half-up carry FIRES")
	requireBig(t, "7270621702811489680000", new(big.Int).Add(new(big.Int).Set(q), big.NewInt(1)),
		"the inner wadDiv result")

	// What ships.
	requireBig(t, "727062170281148968", h.HealthFactorWad, "the composite")

	// Every refuted form, computed here from the same totals.
	fusedFloor, ok := fusedHealthFactorWad(sigma, d)
	require.True(t, ok)
	requireBig(t, "727062170281148967", fusedFloor, "REFUTED rev-2 fused floor — one wad ULP LOW")
	require.NotEqual(t, h.HealthFactorWad.String(), fusedFloor.String(),
		"if these agree the vector proves nothing")

	c, lt := mustBig(t, "12315707"), mustBig(t, "8100")
	twoStep := map[string]string{
		"pmFloor+wdFloor":   wadDivFloor(percentMulFloor(c, lt), d).String(),
		"pmFloor+wdHalfUp":  wadDivHalfUp(percentMulFloor(c, lt), d).String(),
		"pmHalfUp+wdFloor":  wadDivFloor(percentMulHalfUp(c, lt), d).String(),
		"pmHalfUp+wdHalfUp": wadDivHalfUp(percentMulHalfUp(c, lt), d).String(),
	}
	require.Equal(t, "727062121449433191", twoStep["pmFloor+wdFloor"])
	require.Equal(t, "727062121449433191", twoStep["pmFloor+wdHalfUp"])
	require.Equal(t, "727062194332591066", twoStep["pmHalfUp+wdFloor"])
	require.Equal(t, "727062194332591067", twoStep["pmHalfUp+wdHalfUp"])
	for name, v := range twoStep {
		require.NotEqual(t, h.HealthFactorWad.String(), v, "two-step composite %s must not reproduce the shipped value", name)
	}

	// THE CONSEQUENCE a consumer must know: the published wad is NOT the floor of
	// the exact rational on a carry vector. It is one ULP above it.
	requireBig(t, "99757226700", h.HealthFactor.Num)
	requireBig(t, "137205910000", h.HealthFactor.Den)
	floorOfRational, ok := h.HealthFactor.FloorScaled(WadUnit())
	require.True(t, ok)
	requireBig(t, "727062170281148967", floorOfRational)
	requireBig(t, "1", new(big.Int).Sub(h.HealthFactorWad, floorOfRational),
		"the chain's half-up inner step puts the published wad exactly one ULP above the rational's floor")
}

// ---------------------------------------------------------------------------
// Rev-3 regime guard: pins before the TokenMath cut are REFUSED.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthRefusesPinsBeforeTheTokenMathCut is the ruling's BLOCKING
// ITEM 4.
//
// Components 4 and 7 were derived from the CURRENT Pool implementation's source.
// Nobody has read the pre-23,088,584 GenericLogic, so a historical health factor
// computed with today's laws would be a number whose derivation does not exist.
// The refusal has two arms and BOTH are needed:
//
//	explicit    Regime = RegimeA
//	implicit    Marks.BalancesBlock < 23,088,584 with the zero-value Regime
//
// The implicit arm is the load-bearing one. Regime's zero value is RegimeB by
// design, so a backfill that never mentions regimes would otherwise be served
// today's laws silently — which is exactly the class of failure the pre-cut ray
// split already exists to prevent.
func TestComputeAaveHealthRefusesPinsBeforeTheTokenMathCut(t *testing.T) {
	build := func(regime Regime, balancesBlock uint64) AaveInput {
		return AaveInput{
			Marks:    Watermarks{BalancesBlock: balancesBlock, ParamsBlock: 20713917},
			Account:  acctA,
			Regime:   regime,
			Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "20000000", "0", true), simpleReserve(aUSDC, 8, "0", "10000000", false)},
			Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
			Prices:   []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
		}
	}

	t.Run("explicit RegimeA is refused even at a current block", func(t *testing.T) {
		_, err := ComputeAaveHealth(build(RegimeA, 25635618))
		require.ErrorIs(t, err, ErrPreTokenMathRegime)
		require.Contains(t, err.Error(), "regime A requested")
		require.Contains(t, err.Error(), acctA.Hex(), "the refusal names the account")
	})

	t.Run("a pre-cut block is refused even with the zero-value regime", func(t *testing.T) {
		var zero Regime
		require.Equal(t, RegimeB, zero, "the trap this arm closes: the zero value is the CURRENT regime")
		_, err := ComputeAaveHealth(build(zero, 23088583))
		require.ErrorIs(t, err, ErrPreTokenMathRegime)
		require.Contains(t, err.Error(), "Marks.BalancesBlock 23088583 is below the TokenMath cut 23088584")
	})

	t.Run("the cut block itself computes", func(t *testing.T) {
		h, err := ComputeAaveHealth(build(RegimeB, AaveTokenMathFromBlock))
		require.NoError(t, err, "23,088,584 is the FIRST block of the current regime, not the last of the old one")
		requireBig(t, "1620000000000000000", h.HealthFactorWad)
		require.Equal(t, RegimeB, h.Regime)
	})

	t.Run("the refusal reaches the derived surfaces", func(t *testing.T) {
		in := build(RegimeA, 25635618)
		_, _, err := ComputeLiquidationPrice(PositionInput{Engine: AaveEngine, Aave: &in}, []common.Address{aWeETH})
		require.ErrorIs(t, err, ErrPreTokenMathRegime,
			"weightsFor goes through ComputeAaveHealth, so the liquidation-price surface inherits the guard")
	})

	t.Run("no arithmetic result escapes the refusal", func(t *testing.T) {
		// The contrast that makes the claim mean something: the SAME reserves,
		// prices and params produce a full result one block later.
		ok, err := ComputeAaveHealth(build(RegimeB, AaveTokenMathFromBlock))
		require.NoError(t, err)
		requireBig(t, "10000000", ok.TotalDebtBase)
		requireBig(t, "1620000000000000000", ok.HealthFactorWad)

		h, err := ComputeAaveHealth(build(RegimeB, AaveTokenMathFromBlock-1))
		require.ErrorIs(t, err, ErrPreTokenMathRegime)
		require.Equal(t, AaveHealth{}, h,
			"a refused era must return the ZERO result — no partial totals, no health factor, "+
				"no reserve rows a caller could mistake for numbers")
	})

	t.Run("an input fault the caller can act on is reported ahead of the era", func(t *testing.T) {
		// ORDERING, pinned deliberately. The guard is the last refusal and the
		// first thing before any arithmetic; it is NOT first overall, so a caller
		// holding a DM-tagged param row at a pre-cut block hears about the row.
		// A future refactor that moves the guard to the top of the function
		// breaks this test, which is the point of writing it down.
		in := build(RegimeB, 20000000)
		in.Params = []ParamRow{dmParam(aWeETH, "81000000000000000000", "1000000000000000000")}
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrParamEngineMismatch)
		require.NotErrorIs(t, err, ErrPreTokenMathRegime)

		// With the row fixed, the era refusal is what remains.
		in.Params = []ParamRow{aaveParam(aWeETH, "8100", "10600")}
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrPreTokenMathRegime)
	})

	t.Run("the ray-level regime split is NOT withdrawn", func(t *testing.T) {
		// Components 2 and 3 are established on both sides of the cut, and the
		// helpers still honour RegimeA. The refusal is scoped to the aggregate
		// surface, where the unproven laws are.
		requireBig(t, "137215", AaveLiveDebt(mustBig(t, "125415"), mustBig(t, "1094089501745475497022017896"), RegimeA))
		requireBig(t, "137216", AaveLiveDebt(mustBig(t, "125415"), mustBig(t, "1094089501745475497022017896"), RegimeB))
	})
}

// TestComputeAaveHealthSecondGoldenVector pins the 0x849b5e51 borrower with a
// single-reserve construction where the base values are set directly (both
// indexes RAY, both prices 1e8 at 8 decimals, so base value == token amount).
//
// REV-3 SURVIVOR, and both legs of why: the debt leg 9604879 × 1e8 / 1e8 divides
// EXACTLY, so ceil == floor and component 4's correction is inert; and
// Σ·1e18 = q·D + r has q ≡ 9309 (mod 1e4) with r = 3701389 < ⌈D/2⌉ = 4802440, so
// component 7's carry does not fire. The recorded chain integer is unchanged.
func TestComputeAaveHealthSecondGoldenVector(t *testing.T) {
	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctC,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "10000153", "0", true),
			simpleReserve(aUSDC, 8, "0", "9604879", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{
			adapterPrice(aWeETH, "100000000"),
			adapterPrice(aUSDC, "100000000"),
		},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "10000153", h.TotalCollateralBase)
	requireBig(t, "9604879", h.TotalDebtBase)
	requireBig(t, "843334302285328112", h.HealthFactorWad)

	// The two exactness facts the survival rests on, asserted rather than
	// claimed in prose.
	requireBig(t, "0", new(big.Int).Mod(
		new(big.Int).Mul(mustBig(t, "9604879"), mustBig(t, "100000000")), pow10(8)),
		"the debt leg divides EXACTLY, so component 4's ceiling is inert")
	requireBig(t, "9604879", MulDivCeil(mustBig(t, "9604879"), mustBig(t, "100000000"), pow10(8)),
		"ceil == floor on an exact division")
	refuted, ok := fusedHealthFactorWad(
		new(big.Int).Mul(mustBig(t, "10000153"), mustBig(t, "8100")), mustBig(t, "9604879"))
	require.True(t, ok)
	require.Equal(t, h.HealthFactorWad.String(), refuted.String(),
		"no carry here either, so component 7's correction leaves this borrower alone")
}

// ---------------------------------------------------------------------------
// The weighted-sum vs aggregate-LT distinction (P-2's disclosed caveat).
// ---------------------------------------------------------------------------

// TestComputeAaveHealthMixedLTUsesWeightedSum is the synthetic mixed-LT
// discriminator P-2 asks for. The live book has uniform LT = 8100 bps, so
// "fused over Σ(Cᵢ·LTᵢ)" and "fused over C_total × avgLT" coincide on every
// real borrower and no chain vector can separate them. These two vectors can.
//
// # Vector M-2 — the minimal, last-digit discriminator
//
// Constructed so the weighted sum leaves remainder EXACTLY 1 when divided by
// the total collateral, which is the smallest possible truncation loss in the
// average-threshold step:
//
//	s = C₁·LT₁ + C₂·LT₂ = 7500·C + 600·C₁   with LT₁=8100, LT₂=7500, C=C₁+C₂
//	so   s mod C = (600·C₁) mod C
//	pick 600·C₁ − 1 = 301·C  (i.e. C₁ ≡ 150 mod 301), giving s mod C = 1
//	  C₁ = 63999999999967, C₂ = 63574750830532, C = 127574750830499
//	  s  = 995210631228722700, avgLT_floor = s/C = 7801 (remainder 1)
//
// With D = 1e14 the fused scale 1e18/(1e4·1e14) is exactly 1, so
//
//	weighted-sum-fused  = s     = 995210631228722700
//	aggregate-LT-fused  = s − 1 = 995210631228722699
//
// # Vector M-1 — the realistic, gross divergence
//
// Ordinary magnitudes, no construction: the average-threshold truncation
// throws away s mod C = 46000000000000, and the two forms differ by that much
// (46 trillion wad = 4.6e-5 of health factor). A mixed-LT book does not need a
// contrived vector to expose the difference; M-2 only shows the floor is
// reached.
func TestComputeAaveHealthMixedLTUsesWeightedSum(t *testing.T) {
	cases := []struct {
		name                      string
		c1, c2, debt              string
		wantWeightedSum           string
		wantAvgLT                 string
		wantHFWeightedSumFused    string
		refutedHFAggregateLTFused string
	}{
		{
			name: "M-2 constructed last-digit discriminator",
			c1:   "63999999999967", c2: "63574750830532", debt: "100000000000000",
			wantWeightedSum:           "995210631228722700",
			wantAvgLT:                 "7801",
			wantHFWeightedSumFused:    "995210631228722700",
			refutedHFAggregateLTFused: "995210631228722699",
		},
		{
			name: "M-1 realistic gross divergence",
			c1:   "64000000000000", c2: "63000000000000", debt: "100000000000000",
			wantWeightedSum:           "990900000000000000",
			wantAvgLT:                 "7802",
			wantHFWeightedSumFused:    "990900000000000000",
			refutedHFAggregateLTFused: "990854000000000000",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Both prices are 1e8 at 8 decimals, so base value == amount and
			// the test is purely about the threshold fusion.
			in := AaveInput{
				Marks:   testAaveMarks,
				Account: acctA,
				Reserves: []AaveReserve{
					simpleReserve(aWeETH, 8, tc.c1, "0", true),
					simpleReserve(aPYUSD, 8, tc.c2, "0", true),
					simpleReserve(aUSDC, 8, "0", tc.debt, false),
				},
				Params: []ParamRow{
					aaveParam(aWeETH, "8100", "10600"),
					aaveParam(aPYUSD, "7500", "10500"),
				},
				Prices: []PriceInput{
					adapterPrice(aWeETH, "100000000"),
					adapterPrice(aPYUSD, "100000000"),
					adapterPrice(aUSDC, "100000000"),
				},
			}
			h, err := ComputeAaveHealth(in)
			require.NoError(t, err)

			requireBig(t, tc.wantWeightedSum, h.WeightedLTSum)
			requireBig(t, tc.wantAvgLT, h.AvgLiquidationThresholdBps)
			requireBig(t, tc.wantHFWeightedSumFused, h.HealthFactorWad,
				"the shipped law fuses over the exact weighted sum")

			// The refuted form, computed here from the SAME totals with the
			// SAME component-7 law, so the only difference under test is the
			// fusion INPUT. Both vectors divide exactly (D = 1e14, r = 0), so
			// the rev-3 half-up carry cannot fire and these recorded integers
			// are unchanged from rev 2 — M-1/M-2 are survivors.
			aggregate, ok := AaveHealthFactorWad(
				new(big.Int).Mul(h.TotalCollateralBase, h.AvgLiquidationThresholdBps),
				h.TotalDebtBase)
			require.True(t, ok)
			requireBig(t, tc.refutedHFAggregateLTFused, aggregate)
			require.NotEqual(t, h.HealthFactorWad.String(), aggregate.String(),
				"the two fusion forms must be distinguishable on this vector, or it proves nothing")
		})
	}
}

// TestComputeAaveHealthUniformLTFusionFormsCoincide records WHY the live book
// cannot discriminate: with one LT the two forms are equal by construction.
func TestComputeAaveHealthUniformLTFusionFormsCoincide(t *testing.T) {
	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "12305519", "0", true),
			simpleReserve(aUSDC, 8, "0", "13720591", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	aggregate, ok := AaveHealthFactorWad(
		new(big.Int).Mul(h.TotalCollateralBase, h.AvgLiquidationThresholdBps), h.TotalDebtBase)
	require.True(t, ok)
	require.Equal(t, h.HealthFactorWad.String(), aggregate.String(),
		"uniform LT: the forms coincide, which is exactly why the live book cannot separate them")
}

// ---------------------------------------------------------------------------
// Zero-debt and empty positions.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthZeroDebtIsInfiniteNotABigNumber: the chain returns
// type(uint256).max; this package returns a typed marker and a nil value.
func TestComputeAaveHealthZeroDebtIsInfiniteNotABigNumber(t *testing.T) {
	in := AaveInput{
		Marks:    testAaveMarks,
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "100000000", "0", true)},
		Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices:   []PriceInput{adapterPrice(aWeETH, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	require.Nil(t, h.HealthFactorWad, "no fake big number")
	require.True(t, h.HealthFactor.Infinite)
	require.Nil(t, h.HealthFactor.Num)
	require.Nil(t, h.HealthFactor.Den)
	requireBig(t, "0", h.TotalDebtBase)
	requireBig(t, "100000000", h.TotalCollateralBase)
	requireBig(t, "8100", h.AvgLiquidationThresholdBps)
}

// TestComputeAaveHealthEmptyPosition covers the empty-set probe class: an
// account with no reserves at all, and one whose reserves are all zero.
func TestComputeAaveHealthEmptyPosition(t *testing.T) {
	h, err := ComputeAaveHealth(AaveInput{Marks: testAaveMarks, Account: acctA})
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	requireBig(t, "0", h.TotalCollateralBase)
	requireBig(t, "0", h.TotalDebtBase)
	requireBig(t, "0", h.WeightedLTSum)
	require.Nil(t, h.AvgLiquidationThresholdBps, "no collateral ⇒ no average threshold, not a zero one")
	require.Empty(t, h.Reserves)
	require.True(t, h.OldestPriceInput.IsZero())

	// Zero balances, and therefore no price or param needed at all.
	h, err = ComputeAaveHealth(AaveInput{
		Marks:    testAaveMarks,
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 18, "0", "0", true)},
	})
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	requireBig(t, "0", h.TotalCollateralBase)
	require.Len(t, h.Reserves, 1)
	requireBig(t, "0", h.Reserves[0].LiveCollateral)

	// Nil balances behave as zero, not as an error.
	h, err = ComputeAaveHealth(AaveInput{
		Marks:    testAaveMarks,
		Account:  acctA,
		Reserves: []AaveReserve{{Asset: aWeETH, Decimals: 18, UsedAsCollateral: true}},
	})
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
}

// ---------------------------------------------------------------------------
// Stale-index disclosure (Codex round 1 [H5]).
// ---------------------------------------------------------------------------

// TestComputeAaveHealthStaleIndexIntervalSurfacesItsAsOf: rate_indexes updates
// only on ReserveDataUpdated and can trail the derive cursor badly. The math
// still computes with the last index it has — refusing would be worse — but
// the index's own as-of must come out on the row, so a current balances
// watermark cannot hide the debt leg's true shelf life.
func TestComputeAaveHealthStaleIndexIntervalSurfacesItsAsOf(t *testing.T) {
	balancesBlock := uint64(25635618)
	indexBlock := uint64(25630000) // 5,618 blocks behind
	indexTime := fixedTime.Add(-19 * time.Hour)

	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			{
				Asset: aWeETH, Decimals: 8,
				ScaledCollateral: mustBig(t, "20000000"),
				CollateralIndex:  RayUnit(),
				ScaledDebt:       big.NewInt(0),
				IndexBlock:       indexBlock, IndexTime: indexTime,
				UsedAsCollateral: true,
			},
			{
				Asset: aUSDC, Decimals: 8,
				ScaledDebt: mustBig(t, "10000000"),
				DebtIndex:  RayUnit(),
				IndexBlock: indexBlock, IndexTime: indexTime,
			},
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}
	require.Equal(t, balancesBlock, in.Marks.BalancesBlock,
		"the fixture's balances block is the one the assertion below uses")

	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)

	// The marks come from the SOURCE, threaded through the computation. An
	// earlier revision assigned h.Marks after the call, which made this test
	// pass while the package served zeros.
	require.Equal(t, in.Marks, h.Marks, "marks are threaded, not assigned by the test")
	require.Greater(t, h.Marks.BalancesBlock-h.Reserves[0].IndexBlock, uint64(1000),
		"the fixture must actually exercise a badly trailing index")
	for _, r := range h.Reserves {
		require.Equal(t, indexBlock, r.IndexBlock, "the index as-of must survive onto the row")
		require.Equal(t, indexTime, r.IndexTime)
	}
	// And it still computed, with the last index it had.
	requireBig(t, "162000000000", h.WeightedLTSum, "20000000 × 8100")
	requireBig(t, "1620000000000000000", h.HealthFactorWad)
}

// TestComputeAaveHealthStaleFlagPropagates: a not-fresh input flags the whole
// row, and the oldest as-of is reported as the min (never as a blend).
func TestComputeAaveHealthStaleFlagPropagates(t *testing.T) {
	old := fixedTime.Add(-26 * time.Hour)
	stale := adapterPrice(aUSDC, "100000000")
	stale.Fresh = false
	stale.AsOf = old

	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "20000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "10000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), stale},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.True(t, h.StalePriceInputs)
	require.Equal(t, old, h.OldestPriceInput)
	require.False(t, h.Reserves[1].Price.Fresh)

	// All fresh ⇒ no flag.
	in.Prices[1].Fresh = true
	in.Prices[1].AsOf = fixedTime
	h, err = ComputeAaveHealth(in)
	require.NoError(t, err)
	require.False(t, h.StalePriceInputs)
	require.Equal(t, fixedTime, h.OldestPriceInput)
}

// ---------------------------------------------------------------------------
// Refusals: never silently drop, never silently pick.
// ---------------------------------------------------------------------------

func TestComputeAaveHealthRefusals(t *testing.T) {
	base := func() AaveInput {
		return AaveInput{
			Marks:   testAaveMarks,
			Account: acctA,
			Reserves: []AaveReserve{
				simpleReserve(aWeETH, 8, "20000000", "0", true),
				simpleReserve(aUSDC, 8, "0", "10000000", false),
			},
			Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
			Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
		}
	}

	t.Run("missing price on a debt leg is refused, never dropped", func(t *testing.T) {
		in := base()
		in.Prices = in.Prices[:1]
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingPrice)
		require.Contains(t, err.Error(), aUSDC.Hex())
	})

	t.Run("missing price on a collateral leg is refused", func(t *testing.T) {
		in := base()
		in.Prices = in.Prices[1:]
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingPrice)
		require.Contains(t, err.Error(), aWeETH.Hex())
	})

	t.Run("missing liquidation threshold is refused, never treated as zero", func(t *testing.T) {
		in := base()
		in.Params = nil
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingParam)
		require.Contains(t, err.Error(), aWeETH.Hex())

		in = base()
		in.Params[0].LiqThreshold = nil
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingParam)
	})

	t.Run("a Debt Manager param row on the Aave surface is refused", func(t *testing.T) {
		in := base()
		// 8100 in the DM's convention would be 0.0000000000000081%, and 81e18
		// read as bps would be astronomically wrong. The engine tag is the
		// only evidence of which one this row is.
		in.Params = []ParamRow{dmParam(aWeETH, "81000000000000000000", "1000000000000000000")}
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrParamEngineMismatch)
		require.Contains(t, err.Error(), "row engine debt_manager, want aave_param")
	})

	t.Run("duplicate price inputs are refused, never silently picked", func(t *testing.T) {
		in := base()
		in.Prices = append(in.Prices, adapterPrice(aWeETH, "200000000"))
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrDuplicatePriceInput)
	})

	t.Run("duplicate param rows are refused", func(t *testing.T) {
		in := base()
		in.Params = append(in.Params, aaveParam(aWeETH, "7000", "10600"))
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrDuplicateParamRow)
	})

	t.Run("an uncapped feed row is refused on the Aave surface", func(t *testing.T) {
		in := base()
		in.Prices[0].Provenance = ProvenanceUncappedFeed
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrProvenanceNotAllowed)
		require.Contains(t, err.Error(), ProvenanceUncappedFeed)

		in = base()
		in.Prices[0].Provenance = ProvenanceRatioReference
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrProvenanceNotAllowed)
	})

	t.Run("engine-exact is accepted on the Aave surface", func(t *testing.T) {
		in := base()
		in.Prices[0].Provenance = ProvenanceEngineExact
		in.Prices[1].Provenance = ProvenanceEngineExact
		_, err := ComputeAaveHealth(in)
		require.NoError(t, err)
	})

	t.Run("mixed price decimals are refused", func(t *testing.T) {
		in := base()
		in.Prices[1].Decimals = 18
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMixedPriceDecimals)
	})

	t.Run("a non-positive price is refused", func(t *testing.T) {
		in := base()
		in.Prices[0].Value = big.NewInt(0)
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNonPositivePrice)

		in = base()
		in.Prices[0].Value = nil
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNonPositivePrice)

		in = base()
		in.Prices[0].Value = big.NewInt(-1)
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNonPositivePrice)
	})

	t.Run("negative balances are refused", func(t *testing.T) {
		in := base()
		in.Reserves[0].ScaledCollateral = big.NewInt(-1)
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)

		in = base()
		in.Reserves[1].ScaledDebt = big.NewInt(-1)
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)
	})

	t.Run("a negative liquidation threshold is refused", func(t *testing.T) {
		in := base()
		in.Params[0].LiqThreshold = big.NewInt(-1)
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)
	})

	t.Run("a nonzero scaled balance with no index is refused", func(t *testing.T) {
		in := base()
		in.Reserves[0].CollateralIndex = nil
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingIndex)
		require.Contains(t, err.Error(), "liquidity index")

		in = base()
		in.Reserves[1].DebtIndex = big.NewInt(0)
		_, err = ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrMissingIndex)
		require.Contains(t, err.Error(), "variable borrow index")
	})

	t.Run("a nonzero eMode category is refused", func(t *testing.T) {
		in := base()
		in.EMode = 1
		_, err := ComputeAaveHealth(in)
		require.ErrorIs(t, err, ErrEModeUnsupported)
		require.Contains(t, err.Error(), "category 1")
	})
}

// TestAssetErrorShape covers the error wrapper's own surface.
func TestAssetErrorShape(t *testing.T) {
	e := &AssetError{Op: "op", Engine: AaveEngine, Asset: aWeETH, Wrapped: ErrMissingPrice}
	require.Contains(t, e.Error(), "op")
	require.Contains(t, e.Error(), aWeETH.Hex())
	require.NotContains(t, e.Error(), "(")
	require.ErrorIs(t, e, ErrMissingPrice)

	e.Detail = "why"
	require.Contains(t, e.Error(), "(why)")
}

// ---------------------------------------------------------------------------
// Collateral flags, purity of inputs.
// ---------------------------------------------------------------------------

// TestComputeAaveHealthNonCollateralBalanceIsExcluded: an aToken balance whose
// isUsingAsCollateral bit is off contributes nothing to the collateral total,
// exactly as the protocol treats it — and needs no param row.
func TestComputeAaveHealthNonCollateralBalanceIsExcluded(t *testing.T) {
	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "20000000", "0", true),
			simpleReserve(aFRAX, 8, "50000000", "0", false), // held but not pledged
			simpleReserve(aUSDC, 8, "0", "10000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{
			adapterPrice(aWeETH, "100000000"),
			adapterPrice(aFRAX, "100000000"),
			adapterPrice(aUSDC, "100000000"),
		},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "20000000", h.TotalCollateralBase, "the unpledged aToken balance must not count")
	requireBig(t, "50000000", h.Reserves[1].LiveCollateral, "…but it is still reported")
	requireBig(t, "0", h.Reserves[1].CollateralBase)
	require.Nil(t, h.Reserves[1].LiquidationThresholdBps)

	// It also needs no price at all when it is not counted anywhere.
	in.Prices = []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")}
	h, err = ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "0", h.Reserves[1].CollateralBase)
}

// TestComputeAaveHealthDoesNotMutateInput guards against the classic *big.Int
// aliasing bug: a computed row must never share storage with its input.
func TestComputeAaveHealthDoesNotMutateInput(t *testing.T) {
	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "20000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "10000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{adapterPrice(aWeETH, "100000000"), adapterPrice(aUSDC, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)

	h.TotalCollateralBase.SetInt64(1)
	h.WeightedLTSum.SetInt64(1)
	h.Reserves[0].LiquidationThresholdBps.SetInt64(1)
	h.Reserves[0].LiveCollateral.SetInt64(1)

	requireBig(t, "20000000", in.Reserves[0].ScaledCollateral)
	requireBig(t, "8100", in.Params[0].LiqThreshold)
	requireBig(t, "100000000", in.Prices[0].Value)

	h2, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "20000000", h2.TotalCollateralBase, "a second call must produce the same numbers")
}

// TestComputeAaveHealthReservesAreOrderStable: output order follows input
// order, so a serialized batch is deterministic.
func TestComputeAaveHealthReservesAreOrderStable(t *testing.T) {
	order := []common.Address{aFRAX, aWeETH, aPYUSD, aUSDC}
	in := AaveInput{Marks: testAaveMarks, Account: acctA}
	for _, a := range order {
		in.Reserves = append(in.Reserves, simpleReserve(a, 8, "0", "0", false))
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.Len(t, h.Reserves, 4)
	for i, a := range order {
		require.Equal(t, a, h.Reserves[i].Asset)
	}
}

// TestComputeAaveHealthValuationFloorsSuperHalf pins component 4 on the Aave
// surface against half-up, the mirror of the Debt Manager vector.
//
//	150000000 x 100000001 / 1e8 = 150000001.5      -> floor 150000001, half-up 150000002
//	150000001 x 100000001 / 1e8 = 150000002.50000001 -> floor 150000002, half-up 150000003
func TestComputeAaveHealthValuationFloorsSuperHalf(t *testing.T) {
	cases := []struct {
		balance, want, refutedHalfUp, remainder string
	}{
		{"150000000", "150000001", "150000002", "50000000"},
		{"150000001", "150000002", "150000003", "50000001"},
	}
	for _, tc := range cases {
		t.Run(tc.balance, func(t *testing.T) {
			in := AaveInput{
				Marks:    testAaveMarks,
				Account:  acctA,
				Reserves: []AaveReserve{simpleReserve(aWeETH, 8, tc.balance, "0", true)},
				Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
				Prices:   []PriceInput{adapterPrice(aWeETH, "100000001")},
			}
			h, err := ComputeAaveHealth(in)
			require.NoError(t, err)
			requireBig(t, tc.want, h.Reserves[0].CollateralBase, "component 4 truncates")
			requireBig(t, tc.want, h.TotalCollateralBase)

			prod := new(big.Int).Mul(mustBig(t, tc.balance), mustBig(t, "100000001"))
			den := pow10(8)
			q, rem := new(big.Int).QuoRem(prod, den, new(big.Int))
			requireBig(t, tc.want, q)
			requireBig(t, tc.remainder, rem)
			require.GreaterOrEqual(t, rem.Cmp(new(big.Int).Div(den, big.NewInt(2))), 0,
				"the remainder must be at or above half, or the vector proves nothing")
			halfUp := new(big.Int).Add(prod, new(big.Int).Div(den, big.NewInt(2)))
			requireBig(t, tc.refutedHalfUp, halfUp.Div(halfUp, den))
		})
	}
}

// TestComputeAaveHealthThreadsAndRequiresWatermarks is M3's regression.
//
// A row that serialized with block 0 would claim to be as-of genesis, so an
// input without a balances block is REFUSED rather than served with zeros —
// the same refuse-don't-pick posture as an unpriced asset.
func TestComputeAaveHealthThreadsAndRequiresWatermarks(t *testing.T) {
	in := AaveInput{
		Marks:    Watermarks{BalancesBlock: 25635618, ParamsBlock: 25635610, SweepBlock: 0},
		Account:  acctA,
		Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "20000000", "0", true)},
		Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices:   []PriceInput{adapterPrice(aWeETH, "100000000")},
	}
	h, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.Equal(t, uint64(25635618), h.Marks.BalancesBlock)
	require.Equal(t, uint64(25635610), h.Marks.ParamsBlock)

	in.Marks = Watermarks{}
	_, err = ComputeAaveHealth(in)
	require.ErrorIs(t, err, ErrMissingWatermark)
	require.Contains(t, err.Error(), "Marks.BalancesBlock is zero")

	// A params block without a balances block is still a refusal: the
	// balances block is the one every row is anchored on.
	in.Marks = Watermarks{ParamsBlock: 25635610}
	_, err = ComputeAaveHealth(in)
	require.ErrorIs(t, err, ErrMissingWatermark)
}

// TestComputeAaveHealthResultDoesNotAliasCallerPrices is H1's Aave arm.
//
// A returned reserve row used to expose the CALLER'S *big.Int for Value and
// CapValue. An honest caller rescaling a returned price in place would have
// mutated its own input and corrupted the next computation over it.
func TestComputeAaveHealthResultDoesNotAliasCallerPrices(t *testing.T) {
	price := adapterPrice(aWeETH, "100000000")
	price.CapValue = mustBig(t, "102000000")
	in := AaveInput{
		Marks:   testAaveMarks,
		Account: acctA,
		Reserves: []AaveReserve{
			simpleReserve(aWeETH, 8, "20000000", "0", true),
			simpleReserve(aUSDC, 8, "0", "10000000", false),
		},
		Params: []ParamRow{aaveParam(aWeETH, "8100", "10600")},
		Prices: []PriceInput{price, adapterPrice(aUSDC, "100000000")},
	}
	first, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	requireBig(t, "20000000", first.TotalCollateralBase)
	requireBig(t, "100000000", first.Reserves[0].Price.Value)
	requireBig(t, "102000000", first.Reserves[0].Price.CapValue)

	// Rescale the RETURNED price rows in place, as an honest caller might.
	first.Reserves[0].Price.Value.SetInt64(1)
	first.Reserves[0].Price.CapValue.SetInt64(1)
	first.Reserves[1].Price.Value.SetInt64(1)

	requireBig(t, "100000000", in.Prices[0].Value, "the caller's input must be untouched")
	requireBig(t, "102000000", in.Prices[0].CapValue)
	requireBig(t, "100000000", in.Prices[1].Value)

	second, err := ComputeAaveHealth(in)
	require.NoError(t, err)
	require.Equal(t, first.TotalCollateralBase.String(), second.TotalCollateralBase.String(),
		"a second computation over the same input must be bit-identical")
	require.Equal(t, first.WeightedLTSum.String(), second.WeightedLTSum.String())
	requireBig(t, "100000000", second.Reserves[0].Price.Value)
	requireBig(t, "102000000", second.Reserves[0].Price.CapValue)

	// And the reverse direction: mutating the INPUT must not move an
	// already-returned result.
	in.Prices[0].Value.SetInt64(7)
	requireBig(t, "100000000", second.Reserves[0].Price.Value)
}

// TestComputeAaveHealthRequiresEngineRelevantWatermarks: the Aave surface
// depends on balances and params, and on nothing else. Each required stamp is
// zeroed INDEPENDENTLY with the others valid, so the table cannot pass by
// accident of a single BalancesBlock check.
func TestComputeAaveHealthRequiresEngineRelevantWatermarks(t *testing.T) {
	full := Watermarks{BalancesBlock: 25635618, ParamsBlock: 25635610, SweepBlock: 25635600}
	build := func(m Watermarks) AaveInput {
		return AaveInput{
			Marks:    m,
			Account:  acctA,
			Reserves: []AaveReserve{simpleReserve(aWeETH, 8, "20000000", "0", true)},
			Params:   []ParamRow{aaveParam(aWeETH, "8100", "10600")},
			Prices:   []PriceInput{adapterPrice(aWeETH, "100000000")},
		}
	}

	cases := []struct {
		name      string
		mutate    func(*Watermarks)
		wantField string
	}{
		{"all present", func(*Watermarks) {}, ""},
		{"balances block zero", func(m *Watermarks) { m.BalancesBlock = 0 }, "Marks.BalancesBlock is zero"},
		{"params block zero", func(m *Watermarks) { m.ParamsBlock = 0 }, "Marks.ParamsBlock is zero"},
		// The Aave engine has no collateral sweep, so demanding one would
		// refuse every honest input.
		{"sweep block zero is FINE on Aave", func(m *Watermarks) { m.SweepBlock = 0 }, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := full
			tc.mutate(&m)
			h, err := ComputeAaveHealth(build(m))
			if tc.wantField == "" {
				require.NoError(t, err)
				require.Equal(t, m, h.Marks, "the accepted marks are threaded onto the result")
				return
			}
			require.ErrorIs(t, err, ErrMissingWatermark)
			require.Contains(t, err.Error(), tc.wantField)
			require.Contains(t, err.Error(), acctA.Hex(), "the refusal names the account")
		})
	}
}
