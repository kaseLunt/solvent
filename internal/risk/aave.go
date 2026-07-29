package risk

// The Aave v3 ether.fi-market health pipeline — design spec §5.1's seven
// components, in order, each with its probe-proven rounding law:
//
//	1 scaled balances      bit-identity (the caller's derived fold)
//	2 live debt            rayMulCeil(scaled, variableBorrowIndex)      CEILING
//	3 live collateral      rayMulFloor(scaled, liquidityIndex)          FLOOR (regime B)
//	4 per-reserve base     floor(balance × getAssetPrice / 10^dec)
//	5 base totals          exact sums
//	6 avg liq. threshold   floor(Σ(Cᵢ·LTᵢ) / ΣCᵢ)   — DISCLOSURE ONLY
//	7 health factor        ONE fused floor division over Σ(Cᵢ·LTᵢ)
//
// Component 7 is the P-2 finding and the reason this file exists: the
// previously-drafted two-step `wadDiv(percentMul(C, avgLT), D)` matches ZERO
// live borrowers under any of the four rounding conventions. The deployed
// contract performs a single exact-integer multiplication and floors once
// (v3.5-style precision-preserving math). Component 6 is computed and
// surfaced because the reconcile gate compares it, but it is NOT an input to
// component 7 — feeding the truncated average back in is exactly the bug the
// probe falsified.

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
			// Component 4: one integer division per reserve, floor.
			rv.DebtBase = MulDivFloor(rv.LiveDebt, p.Value, den)
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

	// Component 7 — the single fused floor division.
	if hf, ok := FusedHealthFactorWad(weightedLTSum, totalDebt); ok {
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
