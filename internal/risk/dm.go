package risk

// The ether.fi Debt Manager health surface (design spec §5.2).
//
// The Debt Manager has no health factor and no getUserAccountData analog. Its
// ground truth is a STRICT-INEQUALITY BOOLEAN:
//
//	liquidatable(user) := borrowingOf(user) > getMaxBorrowAmount(user, false)
//
// where
//
//	getMaxBorrowAmount = Σ mulDiv(collatUsdᵢ, LTᵢ, HUNDRED_PERCENT, Floor)
//	collatUsdᵢ         = floor(amountᵢ × price(tokenᵢ) / 10^decᵢ)
//
// (DebtManagerCore.sol getMaxBorrowAmount / convertCollateralTokenToUsd /
// liquidatable). Two properties of that loop are load-bearing and easy to get
// wrong:
//
//   - The floor is applied PER TOKEN and then summed. Sum-then-floor is a
//     different number.
//   - Equality is HEALTHY. `>` not `>=`. A position with debt exactly equal to
//     its threshold-weighted collateral is not liquidatable, and the on-chain
//     call would revert.
//
// This surface's HF_dm := MaxBorrowLT / Borrowings is SOLVENT's construction,
// not the protocol's, and is kept as an exact rational — never a float, never
// a lossy scaled integer.

import (
	"math/big"
	"time"
)

// dmPriceClasses: the Debt Manager values collateral with
// PriceProviderV2.price, which is the exact function the engine charges
// against at borrow/repay/liquidation time. That is the engine-exact class
// and nothing else is admissible here.
var dmPriceClasses = map[string]bool{
	ProvenanceEngineExact: true,
}

// ComputeDMHealth evaluates one Safe's Debt Manager position.
//
// Named Compute* for the same reason as ComputeAaveHealth: the plan's sketch
// declares both a `DMHealth` struct and a `DMHealth` function.
func ComputeDMHealth(in DMInput) (DMHealth, error) {
	const op = "dm health"

	out := DMHealth{
		Account:      in.Account,
		HealthFactor: InfiniteRational(),
		IsInfinite:   true,
	}

	prices, usdDecimals, err := indexPrices(op, DMEngine, in.Prices, dmPriceClasses)
	if err != nil {
		return DMHealth{}, err
	}
	params, err := indexParams(op, DMEngine, DMEngine, in.Params)
	if err != nil {
		return DMHealth{}, err
	}
	out.UsdDecimals = usdDecimals

	borrowings := orZero(in.DebtUSD)
	if borrowings.Sign() < 0 {
		return DMHealth{}, assetErr(op, DMEngine, in.Account, ErrNegativeAmount, "borrowings")
	}

	collateralValue := new(big.Int)
	maxBorrowLT := new(big.Int)
	var oldest time.Time
	stale := false

	out.Collateral = make([]DMCollateralValue, 0, len(in.Collateral))
	for _, c := range in.Collateral {
		amount := orZero(c.Amount)
		if amount.Sign() < 0 {
			return DMHealth{}, assetErr(op, DMEngine, c.Asset, ErrNegativeAmount, "collateral amount")
		}
		cv := DMCollateralValue{
			Asset:                 c.Asset,
			Decimals:              c.Decimals,
			Amount:                amount,
			ValueUSD:              new(big.Int),
			MaxBorrowContribution: new(big.Int),
		}

		if amount.Sign() > 0 {
			p, ok := prices[c.Asset]
			if !ok {
				return DMHealth{}, assetErr(op, DMEngine, c.Asset, ErrMissingPrice, "")
			}
			cv.Price = p
			cv.ValueUSD = MulDivFloor(amount, p.Value, pow10(c.Decimals))

			pr, ok := params[c.Asset]
			if !ok || pr.LiqThreshold == nil {
				return DMHealth{}, assetErr(op, DMEngine, c.Asset, ErrMissingParam, "liquidation threshold")
			}
			if pr.LiqThreshold.Sign() < 0 {
				return DMHealth{}, assetErr(op, DMEngine, c.Asset, ErrNegativeAmount, "liquidation threshold")
			}
			cv.LiquidationThreshold = new(big.Int).Set(pr.LiqThreshold)
			if pr.LiqBonus != nil {
				cv.LiquidationBonus = new(big.Int).Set(pr.LiqBonus)
			}
			// The per-token floor, then the sum.
			cv.MaxBorrowContribution = MulDivFloor(cv.ValueUSD, pr.LiqThreshold, hundredPercentUnit)

			if !p.Fresh {
				stale = true
			}
			if !p.AsOf.IsZero() && (oldest.IsZero() || p.AsOf.Before(oldest)) {
				oldest = p.AsOf
			}
		}

		collateralValue.Add(collateralValue, cv.ValueUSD)
		maxBorrowLT.Add(maxBorrowLT, cv.MaxBorrowContribution)
		out.Collateral = append(out.Collateral, cv)
	}

	out.CollateralValueUSD = collateralValue
	out.MaxBorrowLT = maxBorrowLT
	out.Borrowings = borrowings
	// STRICT. Equality is healthy.
	out.Liquidatable = borrowings.Cmp(maxBorrowLT) > 0
	out.StalePriceInputs = stale
	out.OldestPriceInput = oldest

	if borrowings.Sign() > 0 {
		r, err := NewRational(maxBorrowLT, borrowings)
		if err != nil {
			return DMHealth{}, err
		}
		out.HealthFactor = r
		out.IsInfinite = false
	}

	return out, nil
}

// ---------------------------------------------------------------------------
// Rate-horizon projection (design spec §6, labeled PROJECTION).
// ---------------------------------------------------------------------------

// ProjectDMDebt computes closed-form debt at a horizon under the Debt
// Manager's LINEAR interest index:
//
//	debt(t) = debt₀ + floor(debt₀ × apy × dt / HUNDRED_PERCENT)
//
// apy100e18 is the per-SECOND borrowApy in the deployed convention:
// denominator HUNDRED_PERCENT = 100e18, scaled per second. The deployed
// contract's own tests use 317097919837 for 10%/year — i.e.
// 10e18 / (365 × 86400). Use APYPerSecondFromAnnual to build a delta.
//
// # Exactness statement (read this before quoting the number)
//
// The chain's own path floors TWICE and in a different place:
//
//	index(t) = I₀ + floor(I₀ × apy × dt / HUNDRED_PERCENT)     (getCurrentIndex)
//	debt(t)  = floor(N × index(t) / 1e18)                      (_getActualBorrowAmount)
//
// where N is the user's normalized borrowing. This function is handed
// debt₀ = floor(N × I₀ / 1e18), not (N, I₀), so it cannot reproduce that
// path — the plan fixes both the signature and this closed form. The two
// differ by at most a couple of units in the last place of USD 6-dec
// (fractions of a cent); TestProjectDMDebtDivergesFromExactTwoFloorPath pins
// the divergence with concrete integers rather than asserting the bound. This
// is why the result is labeled PROJECTION and never gated exact.
//
// Prices are held flat by construction: this axis moves debt only.
func ProjectDMDebt(in DMInput, apy100e18 *big.Int, apyObservedBlock uint64, horizonSeconds int64) (DMProjection, error) {
	const op = "dm projection"

	debt0 := orZero(in.DebtUSD)
	if debt0.Sign() < 0 {
		return DMProjection{}, assetErr(op, DMEngine, in.Account, ErrNegativeAmount, "debt")
	}
	apy := orZero(apy100e18)
	if apy.Sign() < 0 {
		return DMProjection{}, assetErr(op, DMEngine, in.Account, ErrNegativeAmount, "apy")
	}
	if horizonSeconds < 0 {
		return DMProjection{}, assetErr(op, DMEngine, in.Account, ErrNegativeAmount, "horizon")
	}

	// One multiplication chain, ONE division, floored.
	n := new(big.Int).Mul(debt0, apy)
	n.Mul(n, big.NewInt(horizonSeconds))
	interest := n.Div(n, hundredPercentUnit)

	return DMProjection{
		Account:        in.Account,
		DebtUSD:        new(big.Int).Set(debt0),
		ProjectedUSD:   new(big.Int).Add(debt0, interest),
		InterestUSD:    interest,
		APYPerSecond:   apy,
		APYObservedAt:  apyObservedBlock,
		HorizonSeconds: horizonSeconds,
		Label:          "PROJECTION",
		PricesHeldFlat: true,
	}, nil
}

// APYPerSecondFromAnnual converts an annual rate expressed in the
// HUNDRED_PERCENT convention (2e18 = 2% per year) to the per-second borrowApy
// the contract stores: floor(annual / 31_536_000).
//
// Checked against the deployed test fixture: 10e18 / 31536000 = 317097919837,
// the exact value test/safe/SafeTestSetup.t.sol uses for "10% / 365 days".
func APYPerSecondFromAnnual(annual100e18 *big.Int) *big.Int {
	if annual100e18 == nil {
		return new(big.Int)
	}
	return new(big.Int).Div(new(big.Int).Set(annual100e18), secondsPerYear)
}

// dmSeizableUSD is the collateral a liquidator takes for covering debtUSD at
// this position's bonus, capped by the collateral actually held:
//
//	min(collateralUSD, floor(debtUSD × (HUNDRED_PERCENT + bonus) / HUNDRED_PERCENT))
//
// The bonus is looked up per collateral token; where a position holds several
// tokens with different bonuses the SMALLEST is used, because the liquidator
// chooses the preference order and Solvent must not overstate what is at
// risk. Positions with no bonus row fall back to no bonus (1.0×).
func dmSeizableUSD(h DMHealth) *big.Int {
	num := new(big.Int).Set(hundredPercentUnit)
	den := new(big.Int).Set(hundredPercentUnit)
	first := true
	for _, c := range h.Collateral {
		if c.LiquidationBonus == nil || c.Amount.Sign() == 0 {
			continue
		}
		n, d, ok := LiquidationBonusMultiplier(DMEngine, c.LiquidationBonus)
		if !ok {
			continue
		}
		if first || new(big.Int).Mul(n, den).Cmp(new(big.Int).Mul(num, d)) < 0 {
			num, den = n, d
			first = false
		}
	}
	gross := MulDivFloor(h.Borrowings, num, den)
	return minBig(h.CollateralValueUSD, gross)
}

// aaveSeizableBase mirrors dmSeizableUSD on the Aave surface, where the bonus
// is a basis-point MULTIPLIER (10600 = 1.06×), not an additive term.
func aaveSeizableBase(h AaveHealth) *big.Int {
	num := new(big.Int).Set(bpsUnit)
	den := new(big.Int).Set(bpsUnit)
	first := true
	for _, r := range h.Reserves {
		if r.LiquidationBonusBps == nil || r.CollateralBase.Sign() == 0 {
			continue
		}
		n, d, ok := LiquidationBonusMultiplier(AaveEngine, r.LiquidationBonusBps)
		if !ok {
			continue
		}
		if first || new(big.Int).Mul(n, den).Cmp(new(big.Int).Mul(num, d)) < 0 {
			num, den = n, d
			first = false
		}
	}
	gross := MulDivFloor(h.TotalDebtBase, num, den)
	return minBig(h.TotalCollateralBase, gross)
}
