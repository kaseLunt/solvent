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
	"fmt"
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

// DMUsdDecimals is the Debt Manager's USD scale, and it is STRUCTURAL: every
// DM money figure — borrowings (floor(normalized × index / 1e18), NORMATIVE
// per the recon derivation notes), collateral values, maxBorrow thresholds —
// is USD 6-dec by construction, before any price witness is consulted.
//
// It is a DECLARED CONSTANT and never inferred from the witness set (Codex
// round 6 [HIGH]): a debt-only position after a successful sweep that
// observed EMPTY collateral consults ZERO witnesses, and a scale inferred
// from an empty set collapses to 0 — relabeling $1,000 of USD-6 debt as
// $1,000,000,000. Live batch 3 carried 44 such rows. The converse obligation
// is enforced beside it: a witness at any OTHER scale is refused
// (ErrWrongPriceScale), so the declaration can never silently disagree with
// the arithmetic performed under it.
const DMUsdDecimals uint8 = 6

// ComputeDMHealth evaluates one Safe's Debt Manager position.
//
// Named Compute* for the same reason as ComputeAaveHealth: the plan's sketch
// declares both a `DMHealth` struct and a `DMHealth` function.
func ComputeDMHealth(in DMInput) (DMHealth, error) {
	const op = "dm health"

	// SweepBlock is REQUIRED here. DM collateral is read by a ~1h sweep while
	// prices are 60s; a never-swept or failed-sweep account carrying
	// SweepBlock 0 would otherwise serve a liquidatable verdict over
	// collateral whose freshness is unknown.
	if err := requireWatermarks(op, DMEngine, in.Account,
		watermarkCheck{"Marks.BalancesBlock", in.Marks.BalancesBlock},
		watermarkCheck{"Marks.ParamsBlock", in.Marks.ParamsBlock},
		watermarkCheck{"Marks.SweepBlock", in.Marks.SweepBlock},
	); err != nil {
		return DMHealth{}, err
	}

	out := DMHealth{
		Account:      in.Account,
		HealthFactor: InfiniteRational(),
		IsInfinite:   true,
		Marks:        in.Marks,
	}

	prices, witnessDecimals, err := indexPrices(op, DMEngine, in.Prices, dmPriceClasses)
	if err != nil {
		return DMHealth{}, err
	}
	// THE SCALE IS DECLARED, NOT INFERRED (Codex round 6 [HIGH]). Witnesses
	// must MATCH the declaration rather than define it: with zero witnesses
	// (the debt-only-after-empty-sweep shape) an inferred scale is 0, and a
	// witness at any other scale would make CollateralValueUSD a figure the
	// declared label lies about. indexPrices already refuses a MIXED set, so
	// checking its one uniform value against the constant covers every input.
	if len(in.Prices) > 0 && witnessDecimals != DMUsdDecimals {
		return DMHealth{}, assetErr(op, DMEngine, in.Prices[0].Asset, ErrWrongPriceScale,
			fmt.Sprintf("witness decimals %d, engine scale %d", witnessDecimals, DMUsdDecimals))
	}
	params, err := indexParams(op, DMEngine, DMEngine, in.Params)
	if err != nil {
		return DMHealth{}, err
	}
	out.UsdDecimals = DMUsdDecimals

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
			cv.Price = p.clone()
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

	// A projection stamps the block its APY was observed at; without one the
	// result cannot say what rate it projected from, and the PROJECTION label
	// would be undisclosable. SweepBlock is NOT required — this projects DEBT
	// and touches no collateral.
	if err := requireWatermarks(op, DMEngine, in.Account,
		watermarkCheck{"Marks.BalancesBlock", in.Marks.BalancesBlock},
		watermarkCheck{"apyObservedBlock", apyObservedBlock},
	); err != nil {
		return DMProjection{}, err
	}

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
		Marks:          in.Marks,
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

// ---------------------------------------------------------------------------
// Seizure and recovery — EACH TOKEN'S OWN BONUS, on both engines.
// ---------------------------------------------------------------------------
//
// # Why a single position-wide bonus is wrong
//
// The deployed loop (DebtManagerCore.sol:625,
// _getCollateralTokensForDebtAmount) walks collateral token by token and
// applies THAT token's `liquidationBonus`:
//
//	netCollateralRepayValue = totalCollateral × HUNDRED_PERCENT
//	                          / (HUNDRED_PERCENT + $.collateralTokenConfig[tok].liquidationBonus)
//
// An earlier revision of this file collapsed a mixed-bonus position onto the
// SMALLEST bonus. That maximizes recoverable debt and therefore UNDERSTATES
// bad debt — the one direction a solvency census must never err in. On two
// equal $1,000 legs at 1% and 4%:
//
//	min-bonus:  floor(2000000000 × 100/101)                     = 1980198019
//	per-token:  floor(1e9 × 100/101) + floor(1e9 × 100/104)     = 1951637470
//
// a 28560549 (~$28.56) overstatement of what the collateral can retire, which
// is bad debt reported as solvency.
//
// # The two columns, and the direction each one moves
//
//   - recoverableDebt is the debt this collateral can actually retire. It uses
//     each token's own bonus, so it NEVER OVERSTATES recovery and therefore
//     never understates bad debt.
//   - seizableValue is the collateral a liquidator takes. Seizure is modeled
//     PRO-RATA over counted collateral (the assumption ExecutionShortfall
//     already declares): token i retires dᵢ = debt × vᵢ/V and hands over
//     dᵢ × (1+bᵢ), capped at vᵢ. On a single-bonus position this reduces to
//     min(V, floor(debt × (1+b))) — risk-quant R4's formula — exactly PER LEG
//     and exactly in the fully-capped region, but NOT in general across legs:
//     a multi-leg single-bonus position in the uncapped region computes
//     Σᵢ floor(xᵢ) rather than floor(Σᵢ xᵢ), which is up to (n−1) units of
//     last place LOW (two legs of v = debt = 1000000001 at 2% give 1020000000
//     against the single-formula 1020000001). Per-leg flooring is nonetheless
//     the chain-shaped choice — the deployed loop floors the bonus inside the
//     per-token body (DebtManagerCore.sol:636) — and the same (n−1)-ulp
//     downward bias applies to recoverableDebt, where it is the SAFE
//     direction: recovery is never overstated, so bad debt is never
//     understated. On a mixed-bonus position seizableValue is LARGER than the
//     min-bonus collapse, because retiring a dollar of debt with a high-bonus
//     token costs more collateral. A real liquidator picks a preference order
//     and would take the lowest-bonus token first, so the min-bonus collapse
//     is the true lower bound and this is the pro-rata central case —
//     disclosed, not silent.
//
// A leg whose param row carries no usable bonus falls back to 1.00×. That is
// the only honest default (inventing a bonus is fabrication), and it biases
// recoverable upward for that leg; it is disclosed here rather than hidden.

// bonusLeg is one counted-collateral leg with its OWN liquidation-bonus
// multiplier already resolved to (num, den).
type bonusLeg struct {
	value *big.Int
	num   *big.Int
	den   *big.Int
}

// dmBonusLegs extracts a Debt Manager position's counted collateral.
func dmBonusLegs(h DMHealth) []bonusLeg {
	out := make([]bonusLeg, 0, len(h.Collateral))
	for _, c := range h.Collateral {
		if c.ValueUSD == nil || c.ValueUSD.Sign() == 0 {
			continue
		}
		out = append(out, bonusLeg{value: c.ValueUSD, num: hundredPercentUnit, den: hundredPercentUnit})
		if c.LiquidationBonus == nil {
			continue
		}
		if n, d, ok := LiquidationBonusMultiplier(DMEngine, c.LiquidationBonus); ok {
			out[len(out)-1].num, out[len(out)-1].den = n, d
		}
	}
	return out
}

// aaveBonusLegs extracts an Aave position's counted collateral. The Aave bonus
// is a basis-point MULTIPLIER (10600 = 1.06×), not an additive term.
func aaveBonusLegs(h AaveHealth) []bonusLeg {
	out := make([]bonusLeg, 0, len(h.Reserves))
	for _, r := range h.Reserves {
		if r.CollateralBase == nil || r.CollateralBase.Sign() == 0 {
			continue
		}
		out = append(out, bonusLeg{value: r.CollateralBase, num: bpsUnit, den: bpsUnit})
		if r.LiquidationBonusBps == nil {
			continue
		}
		if n, d, ok := LiquidationBonusMultiplier(AaveEngine, r.LiquidationBonusBps); ok {
			out[len(out)-1].num, out[len(out)-1].den = n, d
		}
	}
	return out
}

// recoverableDebt is Σᵢ floor(vᵢ × denᵢ / numᵢ) — the debt this collateral can
// retire, each leg net of ITS OWN liquidation bonus, floored per leg exactly as
// the deployed loop does.
func recoverableDebt(legs []bonusLeg) *big.Int {
	out := new(big.Int)
	for _, l := range legs {
		out.Add(out, MulDivFloor(l.value, l.den, l.num))
	}
	return out
}

// seizableValue is Σᵢ min(vᵢ, floor(debt × vᵢ × numᵢ / (V × denᵢ))) — the
// collateral handed to a liquidator under pro-rata seizure, per leg at its own
// bonus and capped by the leg's own balance. Zero when the position holds no
// counted collateral.
func seizableValue(debt *big.Int, legs []bonusLeg) *big.Int {
	total := new(big.Int)
	for _, l := range legs {
		total.Add(total, l.value)
	}
	out := new(big.Int)
	if total.Sign() == 0 {
		return out
	}
	for _, l := range legs {
		n := new(big.Int).Mul(debt, l.value)
		n.Mul(n, l.num)
		d := new(big.Int).Mul(total, l.den)
		out.Add(out, minBig(l.value, n.Div(n, d)))
	}
	return out
}
