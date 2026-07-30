package risk

// Fixed-point primitives, implemented exactly per the deployed sources and
// pinned by hard-coded on-chain vectors in math_test.go. Expectations in the
// tests are NEVER computed from these helpers.
//
// This file is the SINGLE HOME of the ray/wad/percent rounding laws
// (plan Task 4); cmd/reconcile is refactored onto it in Task 6.
//
// The three denominators in this system are NOT interchangeable:
//
//	RAY              1e27    Aave scaled-balance indexes
//	WAD              1e18    Aave health factor scale, DM interest index scale
//	BPS              1e4     Aave liquidation threshold / LTV / bonus
//	HUNDRED_PERCENT  100e18  Debt Manager liquidation threshold / LTV / bonus
//
// BPS and HUNDRED_PERCENT both express "a percentage" and differ by 1e16.

import "math/big"

var (
	rayUnit            = new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil) // 1e27
	wadUnit            = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil) // 1e18
	bpsUnit            = big.NewInt(10000)                                     // 1e4
	hundredPercentUnit = new(big.Int).Mul(big.NewInt(100), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))

	// stablePrice / maxStableDeviation are PriceProvider.sol's constants:
	// STABLE_PRICE = 10**DECIMALS with DECIMALS = 6, and
	// MAX_STABLE_DEVIATION = STABLE_PRICE / 100.
	stablePrice        = big.NewInt(1000000)
	maxStableDeviation = big.NewInt(10000)

	bigOne  = big.NewInt(1)
	bigZero = big.NewInt(0)

	// secondsPerYear is 365 days, the divisor the deployed Debt Manager's own
	// tests use to convert an annual percentage into the per-second borrowApy
	// (test/safe/SafeTestSetup.t.sol: 317097919837 = 10% / 365 days).
	secondsPerYear = big.NewInt(31536000)
)

// RayUnit returns a fresh copy of RAY = 1e27.
func RayUnit() *big.Int { return new(big.Int).Set(rayUnit) }

// WadUnit returns a fresh copy of WAD = 1e18.
func WadUnit() *big.Int { return new(big.Int).Set(wadUnit) }

// BpsUnit returns a fresh copy of the Aave percentage denominator, 1e4.
func BpsUnit() *big.Int { return new(big.Int).Set(bpsUnit) }

// HundredPercentUnit returns a fresh copy of the Debt Manager's percentage
// denominator, HUNDRED_PERCENT = 100e18.
func HundredPercentUnit() *big.Int { return new(big.Int).Set(hundredPercentUnit) }

// SecondsPerYear returns the 365-day year the deployed borrowApy is scaled
// against.
func SecondsPerYear() *big.Int { return new(big.Int).Set(secondsPerYear) }

// ---------------------------------------------------------------------------
// Ray arithmetic.
// ---------------------------------------------------------------------------

// RayMulCeil is c = ceil(a×b / RAY).
//
// The DEPLOYED variable-debt token's scaled→live projection (regime B
// TokenMath.getVTokenBalance; aave-v3-origin lineage — debt is never
// understated). Proven on-chain at ETH pin 25,627,125 with two sub-half
// fractions that BOTH round up, decisively refuting half-up and floor:
//
//	125415 × 1094089501745475497022017896 → 137216  (frac ≈ .2349)
//	    83 × 1000520158840839583052050491 →     84  (frac ≈ .0432)
//
// recon/derivation-notes.md:194-199; cmd/reconcile/aave.go.
func RayMulCeil(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	q, r := new(big.Int).QuoRem(n, rayUnit, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, bigOne)
	}
	return q
}

// RayMulFloor is c = a×b / RAY, truncated.
//
// The DEPLOYED aToken's scaled→live projection in regime B
// (TokenMath.getATokenBalance = rayMulFloor). P-1 DISCHARGED: 15/15
// account×reserve pairs exact at ETH pin 25,635,618, with six super-half
// fractions each refuting half-up AND ceil. Vectors F-A/F-B in
// recon/p3-probes.md, hard-coded in math_test.go.
func RayMulFloor(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	return n.Div(n, rayUnit)
}

// RayMulHalfUp is c = (a×b + RAY/2) / RAY — WadRayMath.rayMul, the regime-A
// (pre-block-23,088,584) law for BOTH the aToken and vToken projections.
func RayMulHalfUp(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	n.Add(n, new(big.Int).Rsh(rayUnit, 1))
	return n.Div(n, rayUnit)
}

// AaveLiveDebt projects a scaled variable-debt balance to live token units
// under the given regime.
func AaveLiveDebt(scaled, index *big.Int, r Regime) *big.Int {
	if r == RegimeA {
		return RayMulHalfUp(scaled, index)
	}
	return RayMulCeil(scaled, index)
}

// AaveLiveCollateral projects a scaled aToken balance to live token units
// under the given regime.
func AaveLiveCollateral(scaled, index *big.Int, r Regime) *big.Int {
	if r == RegimeA {
		return RayMulHalfUp(scaled, index)
	}
	return RayMulFloor(scaled, index)
}

// ---------------------------------------------------------------------------
// General integer helpers.
// ---------------------------------------------------------------------------

// MulDivFloor is floor(a×b / den) — OpenZeppelin Math.mulDiv with
// Math.Rounding.Floor, which is what every Debt Manager site uses, and what the
// Aave COLLATERAL leg of component 4 uses. Panics on a non-positive
// denominator; callers validate first.
func MulDivFloor(a, b, den *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	return n.Div(n, den)
}

// MulDivCeil is ceil(a×b / den) — Aave v3.5's MathUtils.mulDivCeil, the
// DEPLOYED debt-base conversion in component 4.
//
//	GenericLogic.sol:219-230 _getUserDebtInBaseCurrency
//	  return MathUtils.mulDivCeil(userTotalDebt, assetPrice, assetUnit);   (:229)
//	MathUtils.sol:100-115 mulDivCeil
//	  d := div(product, c) + iszero(iszero(mod(product, c)))
//
// That assembly is a PURE CEILING, not half-up: any nonzero remainder adds one,
// however small. The never-understate-debt asymmetry that already governs
// component 2 (RayMulCeil) therefore continues through the base-currency
// conversion, while the collateral leg stays MulDivFloor
// (GenericLogic.sol:242-258: `balance * assetPrice; return balance / assetUnit`,
// plain truncation).
//
// Proven on-chain: totalDebtBase was exact for 0/12 live borrowers under floor
// and 12/12 under ceil (Task 6), and the golden leg 137231 × 99981000 / 1e6 =
// 13720492.611 lands on the chain's 13720493. That leg's remainder is
// SUPER-half, so it cannot separate ceil from half-up; the sub-half vectors in
// aave_test.go do (risk-quant rev-3 ruling item 2).
//
// Panics on a non-positive denominator; callers validate first.
func MulDivCeil(a, b, den *big.Int) *big.Int {
	n := new(big.Int).Mul(a, b)
	q, r := new(big.Int).QuoRem(n, den, new(big.Int))
	if r.Sign() != 0 {
		q.Add(q, bigOne)
	}
	return q
}

// ---------------------------------------------------------------------------
// The health-factor forms this system does NOT use.
// ---------------------------------------------------------------------------
//
// percentMulHalfUp / percentMulFloor / wadDivHalfUp / wadDivFloor /
// fusedHealthFactorWad exist so the test suite can PROVE, on the golden on-chain
// vectors and on the constructed carry discriminators, that the shipped health
// factor is none of them. They are deliberately unexported and are never called
// from a computation path.
//
// P-2 DISCHARGED BY FALSIFICATION: `wadDiv(percentMul(C, LT), D)` matches the
// chain healthFactor for ZERO of 12 live borrowers under all four rounding
// combinations, and one borrower's chain value lies strictly BETWEEN the
// all-floor and all-half-up composites — the signature of no intermediate
// rounding of the weighted sum (recon/p3-probes.md).
//
// REV-3 ADDITION: the fused floor that shipped as the law in rev 2 is refuted
// too, from the source rather than from a pin — see AaveHealthFactorWad. It
// agrees with the deployed composite on every recorded live borrower and differs
// on ~5×10⁻⁵ of evaluations, which is why it survived 12/12 twice. It is kept
// here, unexported, so the discriminator vectors can show the difference is real
// arithmetic and not a typo.

// percentMulHalfUp is PercentageMath.percentMul: (a×bps + 5000) / 10000.
func percentMulHalfUp(a, bps *big.Int) *big.Int {
	n := new(big.Int).Mul(a, bps)
	n.Add(n, big.NewInt(5000))
	return n.Div(n, bpsUnit)
}

// percentMulFloor is the truncating variant of the same step.
func percentMulFloor(a, bps *big.Int) *big.Int {
	n := new(big.Int).Mul(a, bps)
	return n.Div(n, bpsUnit)
}

// wadDivHalfUp is WadRayMath.wadDiv: (a×WAD + b/2) / b.
func wadDivHalfUp(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, wadUnit)
	n.Add(n, new(big.Int).Rsh(b, 1))
	return n.Div(n, b)
}

// wadDivFloor is the truncating variant.
func wadDivFloor(a, b *big.Int) *big.Int {
	n := new(big.Int).Mul(a, wadUnit)
	return n.Div(n, b)
}

// fusedHealthFactorWad is the REFUTED rev-2 law: ONE exact-integer
// multiplication over the weighted sum, floored ONCE.
//
//	HF = floor( Σ(Cᵢ·LTᵢ) × 1e18 / (10000 × TotalDebtBase) )
//
// Retained as a witness only. It equals the deployed composite except when the
// inner half-up carry fires AND q ≡ 9999 (mod 1e4), where it is one wad ULP LOW.
// See AaveHealthFactorWad for the derivation and the discriminators.
func fusedHealthFactorWad(weightedLTSum, totalDebtBase *big.Int) (hf *big.Int, ok bool) {
	if totalDebtBase == nil || totalDebtBase.Sign() <= 0 {
		return nil, false
	}
	n := new(big.Int).Mul(weightedLTSum, wadUnit)
	d := new(big.Int).Mul(bpsUnit, totalDebtBase)
	return n.Div(n, d), true
}

// ---------------------------------------------------------------------------
// The deployed health-factor law — the wadDiv HALF-UP composite.
// ---------------------------------------------------------------------------

// AaveHealthFactorWad is the DEPLOYED component-7 law: a half-up wadDiv over the
// RAW weighted sum, then a truncating divide by the basis-point denominator.
//
//	HF = floor( floor( (Σ(Cᵢ·LTᵢ)·1e18 + ⌊D/2⌋) / D ) / 1e4 ),   D = TotalDebtBase
//
// Two divisions, TWO different roundings, in this order. From the deployed
// verified source (proxy impl resolved via EIP-1967, PoolInstance solc 0.8.27):
//
//	GenericLogic.sol:160-164
//	  healthFactor = avgLiquidationThreshold.wadDiv(totalDebtInBaseCurrency) / 100_00;
//	WadRayMath.sol:53-62
//	  wadDiv(a, b) = (a·WAD + b/2) / b        <- HALF-UP, not floor
//
// The value the inner wadDiv is called on is the raw Σ(Cᵢ·LTᵢ): the average
// division at :167-173 happens AFTER, so the aggregate threshold is dead on this
// path. weightedLTSum is therefore the already-summed weighted sum, NOT divided
// down by an average threshold — for a uniform-LT book this coincides with the
// C×LT form, for a mixed-LT book it does not, and the weighted-sum form is what
// the source computes (pinned by the synthetic mixed-LT vectors M-1/M-2 in
// aave_test.go).
//
// # Why this is NOT the single fused floor we shipped in rev 2
//
// Write Σ·1e18 = q·D + r with 0 ≤ r < D. The inner wadDiv returns
// q + [r ≥ ⌈D/2⌉]; the refuted fused floor floor(Σ·1e18/(1e4·D)) equals
// floor(q/1e4) by the composition-of-floors identity. The two therefore differ
// EXACTLY when the half-up carry fires AND q ≡ 9999 (mod 1e4) — and when they
// differ, the chain's value is one wad ULP HIGHER. Incidence is ~5×10⁻⁵ per
// evaluation, so 12/12 exact at any pin could never have separated them: rev 2's
// fused floor was an undetectably good approximation, and its error direction
// (reporting a hair LOW) was benign. It was still not the contract's law.
//
// Consequence a caller must know: HF is NOT floor(HealthFactor) in general. On
// a carry vector it is floor + 1. Both carry discriminators are pinned in
// math_test.go and one rides the whole pipeline in aave_test.go.
//
// Returns ok=false for zero debt: the health factor is infinite and this
// function will not invent a value. Panics on a nil weighted sum — a caller
// that has no weighted sum has no health factor, and inventing zero would
// publish "maximally unhealthy" for an arithmetic mistake.
func AaveHealthFactorWad(weightedLTSum, totalDebtBase *big.Int) (hf *big.Int, ok bool) {
	if totalDebtBase == nil || totalDebtBase.Sign() <= 0 {
		return nil, false
	}
	// Inner step: WadRayMath.wadDiv — half-up at WAD scale. `b/2` is Solidity
	// integer division, i.e. ⌊D/2⌋, which for a positive D is D>>1.
	inner := new(big.Int).Mul(weightedLTSum, wadUnit)
	inner.Add(inner, new(big.Int).Rsh(totalDebtBase, 1))
	inner.Div(inner, totalDebtBase)
	// Outer step: `/ 100_00` — Solidity integer division, truncating.
	return inner.Div(inner, bpsUnit), true
}

// ---------------------------------------------------------------------------
// Liquidation bonus — two engines, two incompatible conventions.
// ---------------------------------------------------------------------------

// LiquidationBonusMultiplier returns the exact (num, den) by which a debt
// amount is multiplied to obtain the collateral a liquidator seizes.
//
//   - Aave (AaveParamEngine / AaveEngine): liquidationBonus is a MULTIPLIER in
//     basis points. 10600 ⇒ 10600/10000 = 1.06.
//   - Debt Manager (DMEngine): liquidationBonus is ADDITIVE over
//     HUNDRED_PERCENT. 1e18 ⇒ (100e18 + 1e18)/100e18 = 1.01. Source:
//     DebtManagerCore.sol _getCollateralTokensForDebtAmount, where
//     netCollateralRepayValue = total × HUNDRED_PERCENT/(HUNDRED_PERCENT+bonus).
//
// Confirmed against real chain rows: the weETH Aave reserve carries bonus
// 10600 (recon/p3-probes.md configurator table); the DM's EURC and ETHFI
// CollateralTokenConfigSet rows carry 1e18 and 4e18 respectively
// (internal/decode/testdata/dm_collateral_token_config_set.json).
//
// Treating one convention as the other is a 100× error in seized collateral.
func LiquidationBonusMultiplier(engine string, bonus *big.Int) (num, den *big.Int, ok bool) {
	if bonus == nil || bonus.Sign() < 0 {
		return nil, nil, false
	}
	switch engine {
	case AaveEngine, AaveParamEngine:
		if bonus.Cmp(bpsUnit) < 0 {
			// A multiplier below 1.00 would hand the liquidator less than the
			// debt covered; the deployed configuration never does this and
			// silently accepting it would understate collateral at risk.
			return nil, nil, false
		}
		return new(big.Int).Set(bonus), BpsUnit(), true
	case DMEngine:
		return new(big.Int).Add(hundredPercentUnit, bonus), HundredPercentUnit(), true
	default:
		return nil, nil, false
	}
}

// ---------------------------------------------------------------------------
// Debt Manager stable snap.
// ---------------------------------------------------------------------------

// ApplyDMStableSnap models PriceProvider._getStablePrice on an
// already-6-decimal price:
//
//	if (price > STABLE_PRICE - MAX_STABLE_DEVIATION &&
//	    price < STABLE_PRICE + MAX_STABLE_DEVIATION) return STABLE_PRICE;
//	else return price;
//
// THE BAND IS OPEN AT BOTH ENDS. With STABLE_PRICE = 1e6 and
// MAX_STABLE_DEVIATION = 1e4 the snap fires for 990001..1009999 inclusive;
// EXACTLY 990000 and EXACTLY 1010000 do NOT snap. A "±1%" paraphrase reads as
// a closed band and is wrong at both boundary points — see the report and
// TestApplyDMStableSnapBoundaryIsOpen.
//
// snapped reports whether the value was pulled to STABLE_PRICE.
func ApplyDMStableSnap(price6dec *big.Int) (out *big.Int, snapped bool) {
	if price6dec == nil {
		return nil, false
	}
	lo := new(big.Int).Sub(stablePrice, maxStableDeviation) // 990000
	hi := new(big.Int).Add(stablePrice, maxStableDeviation) // 1010000
	if price6dec.Cmp(lo) > 0 && price6dec.Cmp(hi) < 0 {
		return new(big.Int).Set(stablePrice), true
	}
	return new(big.Int).Set(price6dec), false
}

// ---------------------------------------------------------------------------
// Aave price caps.
// ---------------------------------------------------------------------------

// ApplyPriceCap binds a value to a cap UPWARD ONLY: a value above the cap is
// clamped, a value at or below it passes through untouched.
//
// The Aave price-cap adapters return min(feed, priceCap) for the stables and
// growth-cap the weETH exchange rate; both bind only on the upside, so every
// v1 down-shock scenario leaves them slack. That is an ASSUMPTION TO CHECK,
// not to assume (oracle-sentinel R4/R6-1) — hence this function exists and is
// exercised by a synthetic upward vector even though no shipped scenario
// binds it.
func ApplyPriceCap(value, cap *big.Int) (out *big.Int, bound bool) {
	if value == nil {
		return nil, false
	}
	if cap == nil || value.Cmp(cap) <= 0 {
		return new(big.Int).Set(value), false
	}
	return new(big.Int).Set(cap), true
}

// ---------------------------------------------------------------------------
// Small shared helpers.
// ---------------------------------------------------------------------------

// orZero returns a defensive copy of v, or a fresh zero when v is nil.
func orZero(v *big.Int) *big.Int {
	if v == nil {
		return new(big.Int)
	}
	return new(big.Int).Set(v)
}

// pow10 returns 10^n.
func pow10(n uint8) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
}

// maxZero returns max(0, v).
func maxZero(v *big.Int) *big.Int {
	if v.Sign() < 0 {
		return new(big.Int)
	}
	return new(big.Int).Set(v)
}

// minBig returns the smaller of a and b.
func minBig(a, b *big.Int) *big.Int {
	if a.Cmp(b) <= 0 {
		return new(big.Int).Set(a)
	}
	return new(big.Int).Set(b)
}
