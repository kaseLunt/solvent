package risk

// The Aave v3 ether.fi-market health pipeline — design spec §5.1's seven
// components, in order, each with its probe-proven rounding law:
//
//	1 scaled balances      bit-identity (the caller's derived fold)
//	2 live debt            rayMulCeil(scaled, variableBorrowIndex)      CEILING
//	3 live collateral      rayMulFloor(scaled, liquidityIndex)          FLOOR (regime B)
//	4 per-reserve base     debt       CEIL(balance × getAssetPrice / 10^dec)
//	                       collateral FLOOR(balance × getAssetPrice / 10^dec)
//	5 base totals          exact sums
//	6 avg liq. threshold   floor(Σ(Cᵢ·LTᵢ) / ΣCᵢ)   — DISCLOSURE ONLY
//	7 health factor        wadDiv HALF-UP over Σ(Cᵢ·LTᵢ), then /1e4 truncating
//
// Component 7 is the P-2 finding and the reason this file exists: the
// previously-drafted two-step `wadDiv(percentMul(C, avgLT), D)` matches ZERO
// live borrowers under any of the four rounding conventions. Component 6 is
// computed and surfaced because the reconcile gate compares it, but it is NOT an
// input to component 7 — feeding the truncated average back in is exactly the
// bug the probe falsified. The average division happens AFTER the health factor
// in the source (GenericLogic.sol:167-173 vs :160-164), which is the code-order
// proof of the same point.
//
// # REV 3 — two law corrections, from the deployed verified source
//
// Both came out of reading the live Pool implementation (EIP-1967 slot →
// Blockscout-verified PoolInstance, solc 0.8.27) rather than out of a pin count,
// and both shipped in ONE revision because re-pinning either alone would leave a
// law the source refutes:
//
//  1. Component 4's DEBT leg is a pure CEILING, MathUtils.mulDivCeil
//     (GenericLogic.sol:229, MathUtils.sol:100-115), summed at :141. The
//     COLLATERAL leg is unchanged plain truncation (:242-258). totalDebtBase was
//     exact for 0/12 live borrowers under floor and 12/12 under ceil.
//  2. Component 7 is the wadDiv HALF-UP composite, not a single fused floor
//     (GenericLogic.sol:160-164 + WadRayMath.sol:53-62). The refuted fused floor
//     agreed with the chain on every recorded borrower and differs on ~5×10⁻⁵ of
//     evaluations, so no pin count could ever have caught it — see
//     AaveHealthFactorWad for the carry derivation.
//
// Both laws are established for the CURRENT implementation ONLY, which is why
// this surface refuses a pin before the TokenMath cut (ErrPreTokenMathRegime).

import (
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// aavePriceClasses are the ONLY provenance classes the Aave valuation may
// consume. The P2 feed stream is deliberately uncapped, so valuing Aave
// collateral from it would go wrong exactly when a cap binds (design spec §7,
// Codex round 1 [H4]).
var aavePriceClasses = map[string]bool{
	ProvenanceAdapterOutput: true,
	ProvenanceEngineExact:   true,
}

// ComputeAaveHealth evaluates one account's Aave position.
//
// It is named Compute* because Go forbids a function and a type sharing a
// name in one package, and the plan's sketch declares BOTH `AaveHealth` the
// struct and `AaveHealth` the function. The struct keeps the documented name.
func ComputeAaveHealth(in AaveInput) (AaveHealth, error) {
	const op = "aave health"

	// Watermarks first: a number without an as-of is not servable at all, and
	// finding that out after computing it would only make the refusal later.
	// SweepBlock is deliberately NOT required — the Aave engine has no
	// collateral sweep, so demanding one would refuse every honest input.
	if err := requireWatermarks(op, AaveEngine, in.Account,
		watermarkCheck{"Marks.BalancesBlock", in.Marks.BalancesBlock},
		watermarkCheck{"Marks.ParamsBlock", in.Marks.ParamsBlock},
	); err != nil {
		return AaveHealth{}, err
	}

	out := AaveHealth{
		Account:      in.Account,
		Regime:       in.Regime,
		HealthFactor: InfiniteRational(),
		IsInfinite:   true,
		Marks:        in.Marks,
	}

	// eMode. The probe settled category 0 for every borrower on both
	// witnesses; a nonzero category would override every reserve threshold
	// with category parameters this package does not hold. Refuse rather than
	// compute with the wrong numbers.
	if in.EMode != 0 {
		return AaveHealth{}, &AssetError{
			Op: op, Engine: AaveEngine, Asset: in.Account,
			Wrapped: ErrEModeUnsupported,
			Detail:  "category " + big.NewInt(int64(in.EMode)).String(),
		}
	}

	prices, baseDecimals, err := indexPrices(op, AaveEngine, in.Prices, aavePriceClasses)
	if err != nil {
		return AaveHealth{}, err
	}
	params, err := indexParams(op, AaveEngine, AaveParamEngine, in.Params)
	if err != nil {
		return AaveHealth{}, err
	}
	out.BaseDecimals = baseDecimals

	// Regime. Components 4 and 7 carry laws read out of the CURRENT Pool
	// implementation's source, so a pre-cut pin is refused rather than computed.
	//
	// POSITION, deliberately: last of the refusals, FIRST before any arithmetic.
	// Nothing above this line multiplies or divides anything — requireWatermarks,
	// the eMode check, indexPrices and indexParams only validate and key inputs —
	// so "never compute with today's laws for a pre-cut pin" holds exactly as
	// strongly here as it would three checks earlier —
	// TestComputeAaveHealthRefusesPinsBeforeTheTokenMathCut pins that the refused
	// result is the ZERO AaveHealth, with no partial totals in it. It sits after
	// input indexing so that a caller with BOTH a malformed input and a pre-cut
	// block is told about the malformed input, which is the fault it can actually
	// act on (same subtest, "an input fault the caller can act on").
	if err := requireCurrentRegime(op, in.Account, in.Regime, in.Marks.BalancesBlock); err != nil {
		return AaveHealth{}, err
	}

	totalCollateral := new(big.Int)
	totalDebt := new(big.Int)
	weightedLTSum := new(big.Int)
	var oldest time.Time
	stale := false

	out.Reserves = make([]AaveReserveValue, 0, len(in.Reserves))
	for _, r := range in.Reserves {
		rv := AaveReserveValue{
			Asset:      r.Asset,
			Decimals:   r.Decimals,
			IndexBlock: r.IndexBlock,
			IndexTime:  r.IndexTime,
		}

		scaledDebt := orZero(r.ScaledDebt)
		scaledCollateral := orZero(r.ScaledCollateral)
		if scaledDebt.Sign() < 0 || scaledCollateral.Sign() < 0 {
			return AaveHealth{}, assetErr(op, AaveEngine, r.Asset, ErrNegativeAmount, "scaled balance")
		}

		// Components 2 and 3.
		rv.LiveDebt = new(big.Int)
		if scaledDebt.Sign() > 0 {
			if r.DebtIndex == nil || r.DebtIndex.Sign() <= 0 {
				return AaveHealth{}, assetErr(op, AaveEngine, r.Asset, ErrMissingIndex, "variable borrow index")
			}
			rv.LiveDebt = AaveLiveDebt(scaledDebt, r.DebtIndex, in.Regime)
		}
		rv.LiveCollateral = new(big.Int)
		if scaledCollateral.Sign() > 0 {
			if r.CollateralIndex == nil || r.CollateralIndex.Sign() <= 0 {
				return AaveHealth{}, assetErr(op, AaveEngine, r.Asset, ErrMissingIndex, "liquidity index")
			}
			rv.LiveCollateral = AaveLiveCollateral(scaledCollateral, r.CollateralIndex, in.Regime)
		}

		countsAsCollateral := r.UsedAsCollateral && rv.LiveCollateral.Sign() > 0
		needsPrice := rv.LiveDebt.Sign() > 0 || countsAsCollateral

		p, hasPrice := prices[r.Asset]
		if needsPrice && !hasPrice {
			return AaveHealth{}, assetErr(op, AaveEngine, r.Asset, ErrMissingPrice, "")
		}

		rv.DebtBase = new(big.Int)
		rv.CollateralBase = new(big.Int)
		if hasPrice {
			rv.Price = p.clone()
			den := pow10(r.Decimals)
			// Component 4: one integer division per reserve, and the two legs
			// round in OPPOSITE directions. Debt CEILS (mulDivCeil,
			// GenericLogic.sol:229) — a pure ceiling, so a remainder of 1 wei's
			// worth still adds a whole base unit. Collateral TRUNCATES
			// (GenericLogic.sol:242-258). Handing both legs the same rounding is
			// the rev-2 bug: it understated debt on 12/12 live borrowers.
			rv.DebtBase = MulDivCeil(rv.LiveDebt, p.Value, den)
			if r.UsedAsCollateral {
				rv.CollateralBase = MulDivFloor(rv.LiveCollateral, p.Value, den)
			}
		}

		if needsPrice {
			if !p.Fresh {
				stale = true
			}
			if !p.AsOf.IsZero() && (oldest.IsZero() || p.AsOf.Before(oldest)) {
				oldest = p.AsOf
			}
		}

		// Component 6/7 weight. A configured collateral reserve MUST carry a
		// threshold row: a missing liquidation threshold is a wrong health
		// factor, never a zero one.
		rv.WeightedLT = new(big.Int)
		if countsAsCollateral {
			pr, ok := params[r.Asset]
			if !ok || pr.LiqThreshold == nil {
				return AaveHealth{}, assetErr(op, AaveEngine, r.Asset, ErrMissingParam, "liquidation threshold")
			}
			if pr.LiqThreshold.Sign() < 0 {
				return AaveHealth{}, assetErr(op, AaveEngine, r.Asset, ErrNegativeAmount, "liquidation threshold")
			}
			rv.LiquidationThresholdBps = new(big.Int).Set(pr.LiqThreshold)
			if pr.LiqBonus != nil {
				rv.LiquidationBonusBps = new(big.Int).Set(pr.LiqBonus)
			}
			rv.WeightedLT = new(big.Int).Mul(rv.CollateralBase, pr.LiqThreshold)
		}

		// Component 5: exact sums.
		totalDebt.Add(totalDebt, rv.DebtBase)
		totalCollateral.Add(totalCollateral, rv.CollateralBase)
		weightedLTSum.Add(weightedLTSum, rv.WeightedLT)

		out.Reserves = append(out.Reserves, rv)
	}

	out.TotalCollateralBase = totalCollateral
	out.TotalDebtBase = totalDebt
	out.WeightedLTSum = weightedLTSum
	out.StalePriceInputs = stale
	out.OldestPriceInput = oldest

	// Component 6 — DISCLOSURE ONLY. Single floor division.
	if totalCollateral.Sign() > 0 {
		out.AvgLiquidationThresholdBps = new(big.Int).Div(new(big.Int).Set(weightedLTSum), totalCollateral)
	}

	// Component 7 — the wadDiv half-up composite. HealthFactorWad can land one
	// wad ULP ABOVE the exact rational's floor on a carry vector; that is the
	// chain's arithmetic, and HealthFactor carries the un-rounded ratio for every
	// downstream solve so no consumer has to inherit the sliver.
	if hf, ok := AaveHealthFactorWad(weightedLTSum, totalDebt); ok {
		out.HealthFactorWad = hf
		r, err := NewRational(weightedLTSum, new(big.Int).Mul(bpsUnit, totalDebt))
		if err != nil {
			return AaveHealth{}, err
		}
		out.HealthFactor = r
		out.IsInfinite = false
	}

	return out, nil
}

// requireCurrentRegime refuses an Aave health computation whose pin predates the
// TokenMath cut.
//
// TWO triggers, because Regime's zero value is RegimeB (deliberately, so a
// caller who never thinks about regimes gets today's chain):
//
//	regime != RegimeB          an EXPLICIT historical request
//	balancesBlock < the cut    an IMPLICIT one — the caller is recomputing
//	                           history and never set Regime at all
//
// The second arm is the one that matters. Without it, a Task-1-style backfill
// over 2024 blocks would sail straight through with today's ceil-debt and
// half-up-composite laws and publish health factors whose derivation nobody has
// done. The ray-level projection helpers still honour RegimeA — components 2 and
// 3 ARE established on both sides of the cut — so this refusal is scoped to the
// aggregate surface, exactly where the unproven laws live.
func requireCurrentRegime(op string, account common.Address, regime Regime, balancesBlock uint64) error {
	if regime != RegimeB {
		return assetErr(op, AaveEngine, account, ErrPreTokenMathRegime,
			"regime "+regime.String()+" requested")
	}
	if balancesBlock < AaveTokenMathFromBlock {
		return assetErr(op, AaveEngine, account, ErrPreTokenMathRegime,
			// strconv is not on this package's import allowlist; big.Int is the
			// house way to render an integer without one.
			"Marks.BalancesBlock "+new(big.Int).SetUint64(balancesBlock).String()+
				" is below the TokenMath cut "+new(big.Int).SetUint64(AaveTokenMathFromBlock).String())
	}
	return nil
}

// ---------------------------------------------------------------------------
// Input indexing — every refusal names its asset.
// ---------------------------------------------------------------------------

// indexPrices keys usable price inputs by asset and enforces, in order:
// positive value, permitted provenance class, no duplicate witness for one
// asset, and a single shared decimals scale.
//
// The decimals check is not pedantry: summing an 8-decimal base value with an
// 18-decimal one produces a number that is wrong by ten orders of magnitude
// and looks entirely plausible.
func indexPrices(op, engine string, in []PriceInput, allowed map[string]bool) (map[common.Address]PriceInput, uint8, error) {
	out := make(map[common.Address]PriceInput, len(in))
	var decimals uint8
	seenDecimals := false
	for _, p := range in {
		if p.Value == nil || p.Value.Sign() <= 0 {
			return nil, 0, assetErr(op, engine, p.Asset, ErrNonPositivePrice, p.Source)
		}
		if !allowed[p.Provenance] {
			return nil, 0, assetErr(op, engine, p.Asset, ErrProvenanceNotAllowed, p.Provenance)
		}
		if _, dup := out[p.Asset]; dup {
			return nil, 0, assetErr(op, engine, p.Asset, ErrDuplicatePriceInput, p.Source)
		}
		if !seenDecimals {
			decimals = p.Decimals
			seenDecimals = true
		} else if p.Decimals != decimals {
			return nil, 0, assetErr(op, engine, p.Asset, ErrMixedPriceDecimals, p.Source)
		}
		out[p.Asset] = p
	}
	return out, decimals, nil
}

// indexParams keys param rows by asset and enforces the engine tag.
//
// wantEngine is the engine that WRITES the rows (AaveParamEngine for the Aave
// surface, DMEngine for the Debt Manager); engine is only used to label the
// refusal. A row written under the other engine carries the other
// denominator, and accepting it would divide a 100e18-scaled threshold by 1e4.
func indexParams(op, engine, wantEngine string, in []ParamRow) (map[common.Address]ParamRow, error) {
	out := make(map[common.Address]ParamRow, len(in))
	for _, p := range in {
		if p.Engine != wantEngine {
			return nil, assetErr(op, engine, p.Asset, ErrParamEngineMismatch, "row engine "+p.Engine+", want "+wantEngine)
		}
		if _, dup := out[p.Asset]; dup {
			return nil, assetErr(op, engine, p.Asset, ErrDuplicateParamRow, p.Source)
		}
		out[p.Asset] = p
	}
	return out, nil
}
