package risk

import (
	"github.com/ethereum/go-ethereum/common"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// getMaxBorrowAmount: the floor is PER TOKEN, then summed.
// ---------------------------------------------------------------------------

// TestComputeDMHealthFloorsPerTokenThenSums pins the loop shape of
// DebtManagerCore.getMaxBorrowAmount. The vector is chosen so the two orders
// give different answers:
//
//	two legs of 1000001 USD-6dec at LT = 95e18 (95%)
//	per-token:  floor(1000001×0.95) + floor(1000001×0.95) = 950000 + 950000 = 1900000
//	sum-then-floor: floor(2000002×0.95)                    =                  1900001
//
// The deployed contract accumulates `totalMaxBorrow += collateral.mulDiv(...)`
// inside the loop, so 1900000 is the chain's answer and 1900001 is the bug.
func TestComputeDMHealthFloorsPerTokenThenSums(t *testing.T) {
	in := DMInput{
		Marks:   testDMMarks,
		Account: acctA,
		DebtUSD: big.NewInt(0),
		Collateral: []DMCollateral{
			{Asset: dUSDC, Amount: mustBig(t, "1000001"), Decimals: 6},
			{Asset: dUSDT, Amount: mustBig(t, "1000001"), Decimals: 6},
		},
		Params: []ParamRow{
			dmParam(dUSDC, "95000000000000000000", "1000000000000000000"),
			dmParam(dUSDT, "95000000000000000000", "1000000000000000000"),
		},
		Prices: []PriceInput{enginePrice(dUSDC, "1000000"), enginePrice(dUSDT, "1000000")},
	}
	h, err := ComputeDMHealth(in)
	require.NoError(t, err)

	requireBig(t, "1000001", h.Collateral[0].ValueUSD)
	requireBig(t, "950000", h.Collateral[0].MaxBorrowContribution)
	requireBig(t, "950000", h.Collateral[1].MaxBorrowContribution)
	requireBig(t, "2000002", h.CollateralValueUSD)
	requireBig(t, "1900000", h.MaxBorrowLT, "per-token floor, then sum — the deployed loop")

	// The REFUTED order, computed here from the same totals.
	sumThenFloor := MulDivFloor(h.CollateralValueUSD, mustBig(t, "95000000000000000000"), HundredPercentUnit())
	requireBig(t, "1900001", sumThenFloor)
	require.NotEqual(t, h.MaxBorrowLT.String(), sumThenFloor.String(),
		"the vector must actually separate the two orders")
}

// ---------------------------------------------------------------------------
// liquidatable is STRICT: equality is healthy.
// ---------------------------------------------------------------------------

// TestComputeDMHealthStrictInequalityBoundary pins
// DebtManagerCore.liquidatable's `>` at exactly the boundary. One unit of
// USD 6-dec ($0.000001) is the whole difference between a healthy position and
// a liquidation call that would revert on-chain.
func TestComputeDMHealthStrictInequalityBoundary(t *testing.T) {
	build := func(debt string) DMInput {
		return DMInput{
			Marks:   testDMMarks,
			Account: acctA,
			DebtUSD: mustBig(t, debt),
			Collateral: []DMCollateral{
				{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6},
			},
			Params: []ParamRow{dmParam(dUSDC, "95000000000000000000", "1000000000000000000")},
			Prices: []PriceInput{enginePrice(dUSDC, "1000000")},
		}
	}
	// maxBorrowLT = floor(100000000 × 95e18 / 100e18) = 95000000.
	cases := []struct {
		debt         string
		liquidatable bool
		why          string
	}{
		{"94999999", false, "below the threshold"},
		{"95000000", false, "EXACTLY at the threshold is HEALTHY: the test is > , not >="},
		{"95000001", true, "one unit above the threshold"},
	}
	for _, tc := range cases {
		t.Run(tc.debt, func(t *testing.T) {
			h, err := ComputeDMHealth(build(tc.debt))
			require.NoError(t, err)
			requireBig(t, "95000000", h.MaxBorrowLT)
			require.Equal(t, tc.liquidatable, h.Liquidatable, tc.why)
		})
	}

	// At exactly the boundary the health ratio is exactly 1, and the exact
	// rational says so without rounding.
	h, err := ComputeDMHealth(build("95000000"))
	require.NoError(t, err)
	require.Equal(t, 0, h.HealthFactor.CmpScaled(big.NewInt(1), big.NewInt(1)),
		"HF_dm is exactly 1 at the boundary")
	v, ok := h.HealthFactor.FloorScaled(WadUnit())
	require.True(t, ok)
	requireBig(t, "1000000000000000000", v)
}

// ---------------------------------------------------------------------------
// Real on-chain param tuples.
// ---------------------------------------------------------------------------

// TestComputeDMHealthRealParamTuples uses the two REAL CollateralTokenConfigSet
// payloads decoded from OP block 149,965,263 (tx 0x21a86c2a…, logIndex 243 and
// 245; internal/decode/testdata/dm_collateral_token_config_set.json):
//
//	EURC   ltv 90e18   liquidationThreshold 95e18   liquidationBonus 1e18
//	ETHFI  ltv 45e18   liquidationThreshold 65e18   liquidationBonus 4e18
//
// They also make the point that the HUNDRED_PERCENT denominator is real: 95e18
// is 95%, not 95e18%.
func TestComputeDMHealthRealParamTuples(t *testing.T) {
	in := DMInput{
		Marks:   testDMMarks,
		Account: acctB,
		DebtUSD: mustBig(t, "50000000"), // $50
		Collateral: []DMCollateral{
			// $100 of a 6-decimal stable at exactly par.
			{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6},
			// 1.0 ETHFI at $1.50, 18 decimals.
			{Asset: dETHFI, Amount: mustBig(t, "1000000000000000000"), Decimals: 18},
		},
		Params: []ParamRow{
			dmParam(dUSDC, "95000000000000000000", "1000000000000000000"),
			dmParam(dETHFI, "65000000000000000000", "4000000000000000000"),
		},
		Prices: []PriceInput{enginePrice(dUSDC, "1000000"), enginePrice(dETHFI, "1500000")},
	}
	h, err := ComputeDMHealth(in)
	require.NoError(t, err)

	requireBig(t, "100000000", h.Collateral[0].ValueUSD)
	requireBig(t, "95000000", h.Collateral[0].MaxBorrowContribution, "100.000000 × 95%")
	requireBig(t, "1500000", h.Collateral[1].ValueUSD, "1 ETHFI at $1.50")
	requireBig(t, "975000", h.Collateral[1].MaxBorrowContribution, "1.500000 × 65%")
	requireBig(t, "101500000", h.CollateralValueUSD)
	requireBig(t, "95975000", h.MaxBorrowLT)
	require.False(t, h.Liquidatable)
	require.Equal(t, uint8(6), h.UsdDecimals)

	// HF_dm = 95975000 / 50000000, exact.
	requireBig(t, "95975000", h.HealthFactor.Num)
	requireBig(t, "50000000", h.HealthFactor.Den)
	v, ok := h.HealthFactor.FloorScaled(WadUnit())
	require.True(t, ok)
	requireBig(t, "1919500000000000000", v, "1.9195")

	// Seizure is pro-rata over counted collateral with EACH TOKEN'S OWN
	// bonus (see the seizure/recovery block in dm.go):
	//   V   = 101500000
	//   USDC leg  min(100000000, floor(50000000 x 100000000 x 101 / (101500000 x 100))) = 49753694
	//   ETHFI leg min(  1500000, floor(50000000 x   1500000 x 104 / (101500000 x 100))) =   768472
	legs := dmBonusLegs(h)
	requireBig(t, "50522166", seizableValue(h.Borrowings, legs))
	// The REFUTED min-bonus collapse, computed here from the same totals.
	requireBig(t, "50500000", MulDivFloor(h.Borrowings,
		new(big.Int).Add(HundredPercentUnit(), mustBig(t, "1000000000000000000")), HundredPercentUnit()))
	// Recoverable is per token too: floor(1e8 x 100/101) + floor(1500000 x 100/104).
	requireBig(t, "100452207", recoverableDebt(legs))
}

// ---------------------------------------------------------------------------
// Zero debt and empty positions.
// ---------------------------------------------------------------------------

func TestComputeDMHealthZeroDebtIsInfinite(t *testing.T) {
	in := DMInput{
		Marks:      testDMMarks,
		Account:    acctA,
		DebtUSD:    big.NewInt(0),
		Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6}},
		Params:     []ParamRow{dmParam(dUSDC, "95000000000000000000", "1000000000000000000")},
		Prices:     []PriceInput{enginePrice(dUSDC, "1000000")},
	}
	h, err := ComputeDMHealth(in)
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	require.True(t, h.HealthFactor.Infinite)
	require.False(t, h.Liquidatable, "no debt is never liquidatable")
	requireBig(t, "95000000", h.MaxBorrowLT)

	// nil debt behaves as zero.
	in.DebtUSD = nil
	h, err = ComputeDMHealth(in)
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	requireBig(t, "0", h.Borrowings)
}

// TestComputeDMHealthEmptySetProbes: never-seen accounts and zero-collateral
// accounts. Half the evidence is the empty set.
func TestComputeDMHealthEmptySetProbes(t *testing.T) {
	// Never seen: nothing at all.
	h, err := ComputeDMHealth(DMInput{Marks: testDMMarks, Account: acctA})
	require.NoError(t, err)
	require.True(t, h.IsInfinite)
	require.False(t, h.Liquidatable)
	requireBig(t, "0", h.CollateralValueUSD)
	requireBig(t, "0", h.MaxBorrowLT)
	requireBig(t, "0", h.Borrowings)
	require.Empty(t, h.Collateral)
	require.True(t, h.OldestPriceInput.IsZero())

	// Zero-amount collateral legs need neither a price nor a param.
	h, err = ComputeDMHealth(DMInput{
		Marks:      testDMMarks,
		Account:    acctA,
		Collateral: []DMCollateral{{Asset: dUSDC, Amount: big.NewInt(0), Decimals: 6}, {Asset: dUSDT, Decimals: 6}},
	})
	require.NoError(t, err)
	require.Len(t, h.Collateral, 2)
	requireBig(t, "0", h.CollateralValueUSD)

	// Debt with NO collateral: liquidatable against a zero threshold.
	h, err = ComputeDMHealth(DMInput{Marks: testDMMarks, Account: acctA, DebtUSD: big.NewInt(1)})
	require.NoError(t, err)
	require.True(t, h.Liquidatable)
	requireBig(t, "0", h.MaxBorrowLT)
	require.True(t, h.HealthFactor.IsZero())
	requireBig(t, "0", seizableValue(h.Borrowings, dmBonusLegs(h)), "nothing to seize")
	requireBig(t, "0", recoverableDebt(dmBonusLegs(h)))
}

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

func TestComputeDMHealthRefusals(t *testing.T) {
	base := func() DMInput {
		return DMInput{
			Marks:      testDMMarks,
			Account:    acctA,
			DebtUSD:    mustBig(t, "50000000"),
			Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6}},
			Params:     []ParamRow{dmParam(dUSDC, "95000000000000000000", "1000000000000000000")},
			Prices:     []PriceInput{enginePrice(dUSDC, "1000000")},
		}
	}

	t.Run("missing price is refused, never dropped", func(t *testing.T) {
		in := base()
		in.Prices = nil
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrMissingPrice)
		require.Contains(t, err.Error(), dUSDC.Hex())
	})

	t.Run("missing param is refused", func(t *testing.T) {
		in := base()
		in.Params = nil
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrMissingParam)

		in = base()
		in.Params[0].LiqThreshold = nil
		_, err = ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrMissingParam)
	})

	t.Run("an Aave param row on the DM surface is refused", func(t *testing.T) {
		in := base()
		// 8100 bps read against 100e18 is 0.0000000000000081% — a threshold
		// of essentially zero, which would report the whole book liquidatable.
		in.Params = []ParamRow{aaveParam(dUSDC, "8100", "10600")}
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrParamEngineMismatch)
		require.Contains(t, err.Error(), "row engine aave_param, want debt_manager")
	})

	t.Run("an adapter-output row is refused on the DM surface", func(t *testing.T) {
		in := base()
		in.Prices[0].Provenance = ProvenanceAdapterOutput
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrProvenanceNotAllowed)
	})

	t.Run("duplicates are refused on both input kinds", func(t *testing.T) {
		in := base()
		in.Prices = append(in.Prices, enginePrice(dUSDC, "999999"))
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrDuplicatePriceInput)

		in = base()
		in.Params = append(in.Params, dmParam(dUSDC, "50000000000000000000", "0"))
		_, err = ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrDuplicateParamRow)
	})

	t.Run("mixed price decimals are refused", func(t *testing.T) {
		in := base()
		in.Collateral = append(in.Collateral, DMCollateral{Asset: dUSDT, Amount: big.NewInt(1), Decimals: 6})
		in.Params = append(in.Params, dmParam(dUSDT, "95000000000000000000", "0"))
		p := enginePrice(dUSDT, "1000000")
		p.Decimals = 18
		in.Prices = append(in.Prices, p)
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrMixedPriceDecimals)
	})

	t.Run("negative amounts are refused", func(t *testing.T) {
		in := base()
		in.DebtUSD = big.NewInt(-1)
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)

		in = base()
		in.Collateral[0].Amount = big.NewInt(-1)
		_, err = ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)

		in = base()
		in.Params[0].LiqThreshold = big.NewInt(-1)
		_, err = ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrNegativeAmount)
	})

	t.Run("a non-positive price is refused", func(t *testing.T) {
		in := base()
		in.Prices[0].Value = big.NewInt(0)
		_, err := ComputeDMHealth(in)
		require.ErrorIs(t, err, ErrNonPositivePrice)
	})
}

// TestComputeDMHealthStaleFlagAndOldestInput mirrors the Aave-side propagation.
func TestComputeDMHealthStaleFlagAndOldestInput(t *testing.T) {
	old := fixedTime.Add(-90 * time.Minute)
	stale := enginePrice(dUSDT, "1000000")
	stale.Fresh = false
	stale.AsOf = old

	in := DMInput{
		Marks:   testDMMarks,
		Account: acctA,
		DebtUSD: mustBig(t, "1"),
		Collateral: []DMCollateral{
			{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6},
			{Asset: dUSDT, Amount: mustBig(t, "100000000"), Decimals: 6},
		},
		Params: []ParamRow{
			dmParam(dUSDC, "95000000000000000000", "1000000000000000000"),
			dmParam(dUSDT, "95000000000000000000", "1000000000000000000"),
		},
		Prices: []PriceInput{enginePrice(dUSDC, "1000000"), stale},
	}
	h, err := ComputeDMHealth(in)
	require.NoError(t, err)
	require.True(t, h.StalePriceInputs)
	require.Equal(t, old, h.OldestPriceInput)
}

// TestComputeDMHealthDoesNotMutateInput guards the defensive copies.
func TestComputeDMHealthDoesNotMutateInput(t *testing.T) {
	in := DMInput{
		Marks:      testDMMarks,
		Account:    acctA,
		DebtUSD:    mustBig(t, "50000000"),
		Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6}},
		Params:     []ParamRow{dmParam(dUSDC, "95000000000000000000", "1000000000000000000")},
		Prices:     []PriceInput{enginePrice(dUSDC, "1000000")},
	}
	h, err := ComputeDMHealth(in)
	require.NoError(t, err)
	h.MaxBorrowLT.SetInt64(1)
	h.Collateral[0].LiquidationThreshold.SetInt64(1)
	h.Borrowings.SetInt64(1)

	requireBig(t, "50000000", in.DebtUSD)
	requireBig(t, "95000000000000000000", in.Params[0].LiqThreshold)
	h2, err := ComputeDMHealth(in)
	require.NoError(t, err)
	requireBig(t, "95000000", h2.MaxBorrowLT)
}

// ---------------------------------------------------------------------------
// ProjectDMDebt.
// ---------------------------------------------------------------------------

// TestProjectDMDebtLinearIndex pins the closed form against the +200bps
// scenario's own numbers: the current book APY of 10%/yr (per-second
// 317097919837, the deployed fixture value) plus the scenario delta
// 63419583967, over the two committed horizons, on the probe's live DM debt of
// about $22.22M.
func TestProjectDMDebtLinearIndex(t *testing.T) {
	debt0 := mustBig(t, "22220000000000") // $22,220,000.000000
	apy := mustBig(t, "380517503804")     // 12%/yr per second
	require.Equal(t, apy.String(),
		new(big.Int).Add(mustBig(t, "317097919837"), mustBig(t, "63419583967")).String(),
		"10%/yr + 200bps")

	in := DMInput{Marks: testDMMarks, Account: acctA, DebtUSD: debt0}

	p30, err := ProjectDMDebt(in, apy, 154848114, 2592000)
	require.NoError(t, err)
	requireBig(t, "22220000000000", p30.DebtUSD)
	requireBig(t, "219156164382", p30.InterestUSD)
	requireBig(t, "22439156164382", p30.ProjectedUSD)
	require.Equal(t, uint64(154848114), p30.APYObservedAt, "the APY observation block is stamped into the result")
	require.Equal(t, "PROJECTION", p30.Label)
	require.True(t, p30.PricesHeldFlat)
	require.Equal(t, int64(2592000), p30.HorizonSeconds)

	p90, err := ProjectDMDebt(in, apy, 154848114, 7776000)
	require.NoError(t, err)
	requireBig(t, "657468493148", p90.InterestUSD)
	requireBig(t, "22877468493148", p90.ProjectedUSD)

	// Zero horizon and zero APY are both no-ops, not errors.
	p0, err := ProjectDMDebt(in, apy, 1, 0)
	require.NoError(t, err)
	requireBig(t, "22220000000000", p0.ProjectedUSD)
	p0, err = ProjectDMDebt(in, big.NewInt(0), 1, 7776000)
	require.NoError(t, err)
	requireBig(t, "22220000000000", p0.ProjectedUSD)
	p0, err = ProjectDMDebt(in, nil, 1, 7776000)
	require.NoError(t, err)
	requireBig(t, "22220000000000", p0.ProjectedUSD)

	// No debt: nothing accrues.
	p0, err = ProjectDMDebt(DMInput{Marks: testDMMarks, Account: acctA}, apy, 1, 7776000)
	require.NoError(t, err)
	requireBig(t, "0", p0.ProjectedUSD)
	requireBig(t, "0", p0.InterestUSD)
}

// TestProjectDMDebtDivergesFromExactTwoFloorPath makes the projection's ONE
// approximation concrete instead of hand-waving a bound.
//
// The chain floors twice, in a different place:
//
//	index(t) = I₀ + floor(I₀ × apy × dt / 100e18)   (getCurrentIndex)
//	debt(t)  = floor(N × index(t) / 1e18)           (_getActualBorrowAmount)
//
// ProjectDMDebt is handed debt₀ = floor(N × I₀ / 1e18), not (N, I₀), so it
// cannot walk that path. On this witness the two answers differ by ONE unit of
// USD 6-dec — one millionth of a dollar on a $25M position.
func TestProjectDMDebtDivergesFromExactTwoFloorPath(t *testing.T) {
	N := mustBig(t, "23974844700609")       // normalized borrowings
	I0 := mustBig(t, "1054735533894457906") // interest index, 1e18 scale
	apy := mustBig(t, "380517503804")       // 12%/yr per second
	const dt = int64(2592000)               // 30 days

	debt0 := MulDivFloor(N, I0, WadUnit())
	requireBig(t, "25287120625333", debt0)

	// The chain's path, written out here (never in the shipped code).
	growth := MulDivFloor(I0, new(big.Int).Mul(apy, big.NewInt(dt)), HundredPercentUnit())
	indexT := new(big.Int).Add(I0, growth)
	requireBig(t, "1065138404913658791", indexT)
	exact := MulDivFloor(N, indexT, WadUnit())
	requireBig(t, "25536527842459", exact)

	// The shipped closed form.
	p, err := ProjectDMDebt(DMInput{Marks: testDMMarks, Account: acctA, DebtUSD: debt0}, apy, 154848114, dt)
	require.NoError(t, err)
	requireBig(t, "25536527842458", p.ProjectedUSD)

	diff := new(big.Int).Sub(exact, p.ProjectedUSD)
	requireBig(t, "1", diff, "the divergence is exactly one unit of USD 6-dec on this witness")
	require.Equal(t, "PROJECTION", p.Label,
		"which is why the result is labeled PROJECTION and never gated exact")
}

func TestProjectDMDebtRefusals(t *testing.T) {
	_, err := ProjectDMDebt(DMInput{Marks: testDMMarks, Account: acctA, DebtUSD: big.NewInt(-1)}, big.NewInt(1), 1, 1)
	require.ErrorIs(t, err, ErrNegativeAmount)

	_, err = ProjectDMDebt(DMInput{Marks: testDMMarks, Account: acctA, DebtUSD: big.NewInt(1)}, big.NewInt(-1), 1, 1)
	require.ErrorIs(t, err, ErrNegativeAmount)

	_, err = ProjectDMDebt(DMInput{Marks: testDMMarks, Account: acctA, DebtUSD: big.NewInt(1)}, big.NewInt(1), 1, -1)
	require.ErrorIs(t, err, ErrNegativeAmount)
}

// ---------------------------------------------------------------------------
// Rational.
// ---------------------------------------------------------------------------

func TestRationalSurface(t *testing.T) {
	half, err := NewRational(big.NewInt(1), big.NewInt(2))
	require.NoError(t, err)
	third, err := NewRational(big.NewInt(1), big.NewInt(3))
	require.NoError(t, err)
	inf := InfiniteRational()

	require.Equal(t, 1, half.Cmp(third))
	require.Equal(t, -1, third.Cmp(half))
	require.Equal(t, 0, half.Cmp(half))
	require.Equal(t, 1, inf.Cmp(half))
	require.Equal(t, -1, half.Cmp(inf))
	require.Equal(t, 0, inf.Cmp(inf))

	require.Equal(t, -1, half.CmpScaled(big.NewInt(1), big.NewInt(1)))
	require.Equal(t, 1, inf.CmpScaled(big.NewInt(1), big.NewInt(1)))

	v, ok := half.FloorScaled(big.NewInt(1000))
	require.True(t, ok)
	requireBig(t, "500", v)
	v, ok = third.FloorScaled(big.NewInt(1000))
	require.True(t, ok)
	requireBig(t, "333", v, "floor, not round")
	v, ok = inf.FloorScaled(big.NewInt(1000))
	require.False(t, ok)
	require.Nil(t, v)

	require.Equal(t, "1/2", half.String())
	require.Equal(t, "+Inf", inf.String())
	require.Equal(t, "<nil>", Rational{}.String())

	zero, err := NewRational(big.NewInt(0), big.NewInt(5))
	require.NoError(t, err)
	require.True(t, zero.IsZero())
	require.False(t, half.IsZero())
	require.False(t, inf.IsZero())
	require.False(t, Rational{}.IsZero())

	_, err = NewRational(big.NewInt(1), big.NewInt(0))
	require.Error(t, err)
	_, err = NewRational(big.NewInt(1), big.NewInt(-1))
	require.Error(t, err)
	_, err = NewRational(nil, big.NewInt(1))
	require.Error(t, err)
	_, err = NewRational(big.NewInt(1), nil)
	require.Error(t, err)

	// NewRational copies: mutating the source must not move the rational.
	src := big.NewInt(7)
	r, err := NewRational(src, big.NewInt(2))
	require.NoError(t, err)
	src.SetInt64(9)
	requireBig(t, "7", r.Num)
}

// TestPositionInputValidate covers the engine-tag union.
func TestPositionInputValidate(t *testing.T) {
	require.NoError(t, PositionInput{Engine: AaveEngine, Aave: &AaveInput{Marks: testAaveMarks}}.Validate())
	require.NoError(t, PositionInput{Engine: DMEngine, DM: &DMInput{Marks: testDMMarks}}.Validate())

	require.ErrorIs(t, PositionInput{Engine: AaveEngine}.Validate(), ErrEngineMismatch)
	require.ErrorIs(t, PositionInput{Engine: DMEngine}.Validate(), ErrEngineMismatch)
	require.ErrorIs(t, PositionInput{Engine: AaveEngine, Aave: &AaveInput{Marks: testAaveMarks}, DM: &DMInput{Marks: testDMMarks}}.Validate(), ErrEngineMismatch)
	require.ErrorIs(t, PositionInput{Engine: DMEngine, Aave: &AaveInput{Marks: testAaveMarks}, DM: &DMInput{Marks: testDMMarks}}.Validate(), ErrEngineMismatch)
	require.ErrorIs(t, PositionInput{Engine: "aave_param", Aave: &AaveInput{Marks: testAaveMarks}}.Validate(), ErrEngineMismatch)
	require.ErrorIs(t, PositionInput{}.Validate(), ErrEngineMismatch)
}

// TestRationalValid pins the zero value as INVALID: a field documented as
// "set only when X" must read back as absent, not as a plausible zero.
func TestRationalValid(t *testing.T) {
	require.False(t, Rational{}.Valid(), "the zero value is not a number")
	require.True(t, InfiniteRational().Valid())

	r, err := NewRational(big.NewInt(1), big.NewInt(2))
	require.NoError(t, err)
	require.True(t, r.Valid())

	require.False(t, Rational{Num: big.NewInt(1)}.Valid())
	require.False(t, Rational{Den: big.NewInt(1)}.Valid())
	require.False(t, Rational{Num: big.NewInt(1), Den: big.NewInt(0)}.Valid())

	// A renderer asking an invalid rational for a display value gets nothing.
	v, ok := Rational{}.FloorScaled(WadUnit())
	require.False(t, ok)
	require.Nil(t, v)
}

// TestLiquidationPriceScaleFactorIsInvalidWhenUnset ties Valid() to the one
// conditional rational this package returns.
func TestLiquidationPriceScaleFactorIsInvalidWhenUnset(t *testing.T) {
	pos := PositionInput{Engine: DMEngine, DM: &DMInput{
		Marks:      testDMMarks,
		Account:    acctA,
		DebtUSD:    big.NewInt(0),
		Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, "1000000"), Decimals: 6}},
		Params:     []ParamRow{dmParam(dUSDC, "95000000000000000000", "0")},
		Prices:     []PriceInput{enginePrice(dUSDC, "1000000")},
	}}
	lp, _, err := ComputeLiquidationPrice(pos, []common.Address{dUSDC})
	require.NoError(t, err)
	require.True(t, lp.NeverLiquidatable)
	require.False(t, lp.ScaleFactor.Valid())
	_, ok := lp.ScaleFactor.FloorScaled(WadUnit())
	require.False(t, ok)
}

// TestPerTokenBonusLawVsMinBonusCollapse is BLOCKER-2's regression vector.
//
// Two equal $1,000 Debt Manager legs at bonuses 1e18 (1%) and 4e18 (4%), both
// material. An earlier revision collapsed the position onto the SMALLEST bonus,
// which maximizes recoverable debt and therefore UNDERSTATES bad debt:
//
//	min-bonus collapse: floor(2000000000 x 100/101)                 = 1980198019
//	per-token (chain):  floor(1e9 x 100/101) + floor(1e9 x 100/104)
//	                    =        990099009   +        961538461     = 1951637470
//
// a 28560549 (~$28.56) overstatement of recovery — bad debt reported as
// solvency. Both integers are hard-coded here so the collapse cannot come back.
func TestPerTokenBonusLawVsMinBonusCollapse(t *testing.T) {
	build := func(debt string) DMInput {
		return DMInput{
			Marks:   testDMMarks,
			Account: acctA,
			DebtUSD: mustBig(t, debt),
			Collateral: []DMCollateral{
				{Asset: dUSDC, Amount: mustBig(t, "1000000000"), Decimals: 6},
				{Asset: dETHFI, Amount: mustBig(t, "1000000000000000000000"), Decimals: 18},
			},
			Params: []ParamRow{
				dmParam(dUSDC, "95000000000000000000", "1000000000000000000"),
				dmParam(dETHFI, "65000000000000000000", "4000000000000000000"),
			},
			// 1000 ETHFI at $1.00 == 1000000000 USD 6-dec, matching the USDC leg.
			Prices: []PriceInput{enginePrice(dUSDC, "1000000"), enginePrice(dETHFI, "1000000")},
		}
	}

	h, err := ComputeDMHealth(build("2000000000"))
	require.NoError(t, err)
	requireBig(t, "1000000000", h.Collateral[0].ValueUSD)
	requireBig(t, "1000000000", h.Collateral[1].ValueUSD)
	requireBig(t, "2000000000", h.CollateralValueUSD)
	require.True(t, h.Liquidatable)

	legs := dmBonusLegs(h)
	require.Len(t, legs, 2)

	// The shipped law, per token.
	requireBig(t, "1951637470", recoverableDebt(legs))
	requireBig(t, "990099009", MulDivFloor(mustBig(t, "1000000000"), HundredPercentUnit(),
		new(big.Int).Add(HundredPercentUnit(), mustBig(t, "1000000000000000000"))))
	requireBig(t, "961538461", MulDivFloor(mustBig(t, "1000000000"), HundredPercentUnit(),
		new(big.Int).Add(HundredPercentUnit(), mustBig(t, "4000000000000000000"))))

	// The REFUTED min-bonus collapse, computed here.
	collapsed := MulDivFloor(h.CollateralValueUSD, HundredPercentUnit(),
		new(big.Int).Add(HundredPercentUnit(), mustBig(t, "1000000000000000000")))
	requireBig(t, "1980198019", collapsed)
	require.NotEqual(t, recoverableDebt(legs).String(), collapsed.String(),
		"the vector must actually separate the two laws")

	// Bad debt: the collapse understates it by exactly the difference.
	requireBig(t, "48362530", badDebtFrom(h.Borrowings, recoverableDebt(legs), true))
	requireBig(t, "19801981", badDebtFrom(h.Borrowings, collapsed, true))
	requireBig(t, "28560549", new(big.Int).Sub(
		badDebtFrom(h.Borrowings, recoverableDebt(legs), true),
		badDebtFrom(h.Borrowings, collapsed, true)))

	// Seizure also separates, at a debt below total recoverable.
	h2, err := ComputeDMHealth(build("500000000"))
	require.NoError(t, err)
	legs2 := dmBonusLegs(h2)
	requireBig(t, "512500000", seizableValue(h2.Borrowings, legs2))
	requireBig(t, "505000000", MulDivFloor(h2.Borrowings,
		new(big.Int).Add(HundredPercentUnit(), mustBig(t, "1000000000000000000")), HundredPercentUnit()),
		"the min-bonus collapse understates seized collateral too")
	require.False(t, h2.Liquidatable)
	requireBig(t, "0", badDebtFrom(h2.Borrowings, recoverableDebt(legs2), h2.Liquidatable))
}

// TestSeizableValueReducesToTheSingleBonusFormulaPerLeg: on a position with one
// bonus the pro-rata per-token law must equal risk-quant R4's
// min(collateral, debt x (1+bonus)) EXACTLY — which is why replacing the old
// law moved no single-bonus number in this suite.
func TestSeizableValueReducesToTheSingleBonusFormulaPerLeg(t *testing.T) {
	bonus := mustBig(t, "2000000000000000000") // 2%
	num := new(big.Int).Add(HundredPercentUnit(), bonus)
	for _, tc := range []struct{ v, d string }{
		{"1800000000", "1500000000"},
		{"1200000000", "1500000000"},
		{"2000000000", "1900000000"},
		{"1000000000", "1"},
		{"1", "1000000000"},
	} {
		v, d := mustBig(t, tc.v), mustBig(t, tc.d)
		legs := []bonusLeg{{value: v, num: num, den: HundredPercentUnit()}}
		want := minBig(v, MulDivFloor(d, num, HundredPercentUnit()))
		require.Equal(t, want.String(), seizableValue(d, legs).String(),
			"v=%s d=%s", tc.v, tc.d)
	}
}

// TestBonusLegsFallBackToParOnUnusableRows: a leg whose param row carries no
// usable bonus falls back to 1.00x. Inventing a bonus would be fabrication;
// the fallback biases recoverable UPWARD for that leg and is disclosed.
func TestBonusLegsFallBackToParOnUnusableRows(t *testing.T) {
	h := DMHealth{
		Borrowings:         mustBig(t, "1000000"),
		CollateralValueUSD: mustBig(t, "5000000"),
		Collateral: []DMCollateralValue{
			{Asset: dUSDT, ValueUSD: big.NewInt(0), LiquidationBonus: mustBig(t, "50000000000000000000")},
			{Asset: dUSDC, ValueUSD: mustBig(t, "5000000"), LiquidationBonus: nil},
		},
	}
	legs := dmBonusLegs(h)
	require.Len(t, legs, 1, "a zero-value leg carries nothing")
	require.Equal(t, 0, legs[0].num.Cmp(legs[0].den), "no usable bonus => 1.00x")
	requireBig(t, "5000000", recoverableDebt(legs))
	requireBig(t, "1000000", seizableValue(h.Borrowings, legs))

	h.Collateral[1].LiquidationBonus = big.NewInt(-1) // rejected by the multiplier
	legs = dmBonusLegs(h)
	require.Equal(t, 0, legs[0].num.Cmp(legs[0].den))

	h.Collateral[1].LiquidationBonus = mustBig(t, "4000000000000000000")
	legs = dmBonusLegs(h)
	requireBig(t, "104000000000000000000", legs[0].num)
	requireBig(t, "100000000000000000000", legs[0].den)

	a := AaveHealth{Reserves: []AaveReserveValue{
		{Asset: aUSDC, CollateralBase: big.NewInt(0), LiquidationBonusBps: big.NewInt(11000)},
		{Asset: aWeETH, CollateralBase: mustBig(t, "100000000"), LiquidationBonusBps: nil},
		{Asset: aFRAX, CollateralBase: mustBig(t, "100000000"), LiquidationBonusBps: big.NewInt(1)},
	}}
	alegs := aaveBonusLegs(a)
	require.Len(t, alegs, 2)
	for _, l := range alegs {
		require.Equal(t, 0, l.num.Cmp(l.den), "no usable bonus => 1.00x")
	}
	requireBig(t, "200000000", recoverableDebt(alegs))
	requireBig(t, "100000000", seizableValue(mustBig(t, "100000000"), alegs))
}

// TestComputeDMHealthValuationFloorsSuperHalf pins component 4 on the Debt
// Manager against half-up. The earlier fixtures all had sub-half remainders,
// which floor and half-up agree on.
//
//	1500000 x 1000001 / 1e6 = 1500001.5 exactly  -> floor 1500001, half-up 1500002
//	1500001 x 1000001 / 1e6 = 1500002.500001     -> floor 1500002, half-up 1500003
func TestComputeDMHealthValuationFloorsSuperHalf(t *testing.T) {
	cases := []struct {
		amount, want, refutedHalfUp string
		remainder                   string
	}{
		{"1500000", "1500001", "1500002", "500000"},
		{"1500001", "1500002", "1500003", "500001"},
	}
	for _, tc := range cases {
		t.Run(tc.amount, func(t *testing.T) {
			in := DMInput{
				Marks:      testDMMarks,
				Account:    acctA,
				Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, tc.amount), Decimals: 6}},
				Params:     []ParamRow{dmParam(dUSDC, "100000000000000000000", "0")},
				Prices:     []PriceInput{enginePrice(dUSDC, "1000001")},
			}
			h, err := ComputeDMHealth(in)
			require.NoError(t, err)
			requireBig(t, tc.want, h.Collateral[0].ValueUSD, "convertCollateralTokenToUsd truncates")

			prod := new(big.Int).Mul(mustBig(t, tc.amount), mustBig(t, "1000001"))
			den := pow10(6)
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

// TestComputeDMHealthThreadsAndRequiresWatermarks is M3's Debt Manager arm.
// SweepBlock matters here in particular: DM collateral is sweep-dominated
// (~1h worst case) while prices are 60s, and a row that dropped the sweep
// block would let a 60s-fresh badge sit over hour-stale collateral.
func TestComputeDMHealthThreadsAndRequiresWatermarks(t *testing.T) {
	in := DMInput{
		Marks:      Watermarks{BalancesBlock: 154848114, ParamsBlock: 154848000, SweepBlock: 154840000},
		Account:    acctA,
		DebtUSD:    mustBig(t, "50000000"),
		Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6}},
		Params:     []ParamRow{dmParam(dUSDC, "95000000000000000000", "1000000000000000000")},
		Prices:     []PriceInput{enginePrice(dUSDC, "1000000")},
	}
	h, err := ComputeDMHealth(in)
	require.NoError(t, err)
	require.Equal(t, uint64(154848114), h.Marks.BalancesBlock)
	require.Equal(t, uint64(154848000), h.Marks.ParamsBlock)
	require.Equal(t, uint64(154840000), h.Marks.SweepBlock)

	in.Marks = Watermarks{}
	_, err = ComputeDMHealth(in)
	require.ErrorIs(t, err, ErrMissingWatermark)

	// ProjectDMDebt carries them too — a projection without an as-of is a
	// number with no shelf life.
	in.Marks = testDMMarks
	p, err := ProjectDMDebt(in, mustBig(t, "380517503804"), 154848114, 2592000)
	require.NoError(t, err)
	require.Equal(t, testDMMarks, p.Marks)
	require.Equal(t, uint64(154848114), p.APYObservedAt)

	in.Marks = Watermarks{}
	_, err = ProjectDMDebt(in, mustBig(t, "380517503804"), 154848114, 2592000)
	require.ErrorIs(t, err, ErrMissingWatermark)
}

// TestComputeDMHealthResultDoesNotAliasCallerPrices is H1's Debt Manager arm.
func TestComputeDMHealthResultDoesNotAliasCallerPrices(t *testing.T) {
	price := enginePrice(dUSDC, "1000000")
	price.CapValue = mustBig(t, "1010000")
	in := DMInput{
		Marks:      testDMMarks,
		Account:    acctA,
		DebtUSD:    mustBig(t, "50000000"),
		Collateral: []DMCollateral{{Asset: dUSDC, Amount: mustBig(t, "100000000"), Decimals: 6}},
		Params:     []ParamRow{dmParam(dUSDC, "95000000000000000000", "1000000000000000000")},
		Prices:     []PriceInput{price},
	}
	first, err := ComputeDMHealth(in)
	require.NoError(t, err)
	requireBig(t, "95000000", first.MaxBorrowLT)
	requireBig(t, "1000000", first.Collateral[0].Price.Value)
	requireBig(t, "1010000", first.Collateral[0].Price.CapValue)

	first.Collateral[0].Price.Value.SetInt64(1)
	first.Collateral[0].Price.CapValue.SetInt64(1)

	requireBig(t, "1000000", in.Prices[0].Value, "the caller's input must be untouched")
	requireBig(t, "1010000", in.Prices[0].CapValue)

	second, err := ComputeDMHealth(in)
	require.NoError(t, err)
	require.Equal(t, first.MaxBorrowLT.String(), second.MaxBorrowLT.String(),
		"a second computation over the same input must be bit-identical")
	requireBig(t, "1000000", second.Collateral[0].Price.Value)

	in.Prices[0].Value.SetInt64(7)
	requireBig(t, "1000000", second.Collateral[0].Price.Value)
}

// TestPositionInputRefusesMarksDisagreement: PositionInput.Marks is a mirror of
// the engine input's, and a mirror that DISAGREES means the caller built the
// two from different reads — one of the two numbers it will publish is wrong.
func TestPositionInputRefusesMarksDisagreement(t *testing.T) {
	dm := &DMInput{Marks: testDMMarks, Account: acctA}
	require.NoError(t, PositionInput{Engine: DMEngine, DM: dm, Marks: testDMMarks}.Validate())
	require.NoError(t, PositionInput{Engine: DMEngine, DM: dm}.Validate(),
		"an empty mirror is allowed; the engine input owns the marks")

	other := testDMMarks
	other.SweepBlock++
	err := PositionInput{Engine: DMEngine, DM: dm, Marks: other}.Validate()
	require.ErrorIs(t, err, ErrWatermarkMismatch)

	av := &AaveInput{Marks: testAaveMarks, Account: acctA}
	require.NoError(t, PositionInput{Engine: AaveEngine, Aave: av, Marks: testAaveMarks}.Validate())
	err = PositionInput{Engine: AaveEngine, Aave: av, Marks: testDMMarks}.Validate()
	require.ErrorIs(t, err, ErrWatermarkMismatch)
}
