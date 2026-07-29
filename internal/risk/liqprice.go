package risk

// Liquidation price — the FACTOR-LEVEL closed-form solve (design spec §6;
// risk-quant R4).
//
// Collateral value is linear in each price and debt is constant under a price
// shock (USD-normalized on the Debt Manager, stable-denominated on Aave), so
// the price at which a position reaches its liquidation boundary is one
// division, not a search:
//
//	s* = (D − Σ_{i∉F} cᵢ·LTᵢ) / (Σ_{i∈F} cᵢ·LTᵢ)        P* = s* × P_now
//
// Implemented in EXACT INTEGER SPACE with no premature division: with W the
// engine's percentage denominator (1e4 basis points for Aave, 100e18 for the
// Debt Manager) and weights held as value×LT_raw,
//
//	s* = (W·D − Σ_{i∉F} wᵢ) / (Σ_{i∈F} wᵢ)
//
// which is the same rational, never rounded.
//
// # What s* means, precisely
//
// At exactly s* the position sits ON the boundary, and BOTH engines call that
// point HEALTHY: the Debt Manager tests `debt > maxBorrowLT` strictly, and
// Aave liquidates only below a health factor of exactly 1e18. Liquidation
// begins strictly below s*. Callers must not render "liquidates at P*".
//
// # The one approximation, stated
//
// The Debt Manager's on-chain threshold sum floors PER TOKEN before summing
// (Σ floor(cᵢ·LTᵢ/100e18)); the closed form above uses the un-floored weighted
// sum. The difference is bounded by one unit of USD 6-dec per collateral
// token — sub-cent on any real position — and it is recorded on the result as
// PerTokenFloorOmitted rather than left for a reader to discover.

import (
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

// ErrNoFactorCollateral: the position holds none of the factor's assets as
// counted collateral, so no price in the factor can liquidate it.
var ErrNoFactorCollateral = errors.New("risk: position holds no counted collateral in the factor")

// FactorAssetPrice is one factor asset's liquidation price.
//
// P* is a rational and is usually NOT an integer at the price's own decimals,
// so the two integer forms below are not interchangeable and the difference is
// the boundary itself:
//
//	healthy      ⟺ price ≥ P*
//	liquidatable ⟺ price < P*
//
// PriceFloor ≤ P*, and is STRICTLY below it whenever P* is fractional — in
// which case PriceFloor is already a LIQUIDATING price, not a healthy one.
// LowestHealthyPrice = ceil(P*) is the smallest integer price at which the
// position still stands. A surface that renders only PriceFloor is off by one
// unit in the dangerous direction on every fractional P*.
//
// Both integers are derived from the closed form; when a per-asset valuation
// floor bites they can be one unit off the price at which the engine's own
// recomputation flips. The exact rational is authoritative.
type FactorAssetPrice struct {
	Asset         common.Address
	CurrentPrice  *big.Int
	PriceDecimals uint8
	// Price is s* × P_now, exact.
	Price Rational
	// PriceFloor is floor(P*) at the price's own decimals.
	PriceFloor *big.Int
	// LowestHealthyPrice is ceil(P*) at the price's own decimals.
	LowestHealthyPrice *big.Int
}

// LiquidationPriceDisclosure carries what a reader must be told alongside the
// number (risk-quant R4: factor membership, held inputs, watermarks, boundary
// strictness).
type LiquidationPriceDisclosure struct {
	// FactorAssets is the subset of the requested factor the position
	// actually holds as counted collateral.
	FactorAssets []common.Address
	// HeldAssets are the counted collateral assets held FLAT at their current
	// sample while the factor moves.
	HeldAssets []common.Address
	// BoundaryIsHealthy is always true and says so on the wire: at exactly
	// P* the position is not yet liquidatable on either engine.
	BoundaryIsHealthy bool
	// PerTokenFloorOmitted is true on the Debt Manager surface: see the file
	// comment.
	PerTokenFloorOmitted bool
	// Diagnostic marks a single-asset factor computed on a position that
	// holds OTHER counted collateral — the ceteris-paribus variant, which
	// design spec §6 demotes to a labeled diagnostic.
	Diagnostic bool
	Marks      Watermarks
}

// LiquidationPrice is the factor-level solve's result.
type LiquidationPrice struct {
	Engine  string
	Account common.Address

	// InFactor mirrors the second return value: the position holds counted
	// collateral in the factor.
	InFactor bool
	// NeverLiquidatable is true when no down-move of the factor can make the
	// position liquidatable — either it carries no debt, or the collateral
	// OUTSIDE the factor already covers the debt at threshold. Reason says
	// which.
	NeverLiquidatable bool
	Reason            string

	// ScaleFactor is s*, exact. Set only when InFactor and not
	// NeverLiquidatable; otherwise it is the zero value, which reports
	// Valid() == false rather than reading as a plausible zero.
	ScaleFactor Rational
	// AlreadyBreached is true when s* ≥ 1: the position is at or past its
	// boundary at CURRENT prices.
	AlreadyBreached bool

	Prices      []FactorAssetPrice
	Disclosures LiquidationPriceDisclosure
}

// weightLeg is one counted-collateral leg in the exact weight space.
type weightLeg struct {
	asset         common.Address
	value         *big.Int // collateral value in the engine's USD/base units
	lt            *big.Int // raw threshold, engine denominator
	weight        *big.Int // value × lt
	price         *big.Int
	priceDecimals uint8
}

// positionWeights is the engine-agnostic view the closed form needs.
type positionWeights struct {
	engine        string
	account       common.Address
	debt          *big.Int
	denom         *big.Int // W: 1e4 (Aave bps) or 100e18 (DM)
	legs          []weightLeg
	perTokenFloor bool
	marks         Watermarks
}

// weightsFor computes a position's counted-collateral weights.
func weightsFor(pos PositionInput) (positionWeights, error) {
	if err := pos.Validate(); err != nil {
		return positionWeights{}, err
	}
	switch pos.Engine {
	case AaveEngine:
		h, err := ComputeAaveHealth(*pos.Aave)
		if err != nil {
			return positionWeights{}, err
		}
		w := positionWeights{
			engine: AaveEngine, account: h.Account,
			debt: h.TotalDebtBase, denom: BpsUnit(), marks: pos.Marks,
		}
		for _, r := range h.Reserves {
			if r.CollateralBase == nil || r.CollateralBase.Sign() == 0 || r.LiquidationThresholdBps == nil {
				continue
			}
			w.legs = append(w.legs, weightLeg{
				asset: r.Asset, value: r.CollateralBase, lt: r.LiquidationThresholdBps,
				weight: new(big.Int).Set(r.WeightedLT),
				price:  orZero(r.Price.Value), priceDecimals: r.Price.Decimals,
			})
		}
		return w, nil
	default:
		h, err := ComputeDMHealth(*pos.DM)
		if err != nil {
			return positionWeights{}, err
		}
		w := positionWeights{
			engine: DMEngine, account: h.Account,
			debt: h.Borrowings, denom: HundredPercentUnit(), marks: pos.Marks,
			perTokenFloor: true,
		}
		for _, c := range h.Collateral {
			if c.ValueUSD == nil || c.ValueUSD.Sign() == 0 || c.LiquidationThreshold == nil {
				continue
			}
			w.legs = append(w.legs, weightLeg{
				asset: c.Asset, value: c.ValueUSD, lt: c.LiquidationThreshold,
				weight: new(big.Int).Mul(c.ValueUSD, c.LiquidationThreshold),
				price:  orZero(c.Price.Value), priceDecimals: c.Price.Decimals,
			})
		}
		return w, nil
	}
}

// ComputeLiquidationPrice solves the factor-level closed form.
//
// The second return value is inFactor, kept as a separate value because the
// plan's sketch declares it there. Named Compute* because the plan declares
// both a `LiquidationPrice` struct and a `LiquidationPrice` function.
func ComputeLiquidationPrice(pos PositionInput, factor []common.Address) (LiquidationPrice, bool, error) {
	w, err := weightsFor(pos)
	if err != nil {
		return LiquidationPrice{}, false, err
	}

	inSet := make(map[common.Address]bool, len(factor))
	for _, a := range factor {
		inSet[a] = true
	}

	out := LiquidationPrice{
		Engine:  w.engine,
		Account: w.account,
		Disclosures: LiquidationPriceDisclosure{
			BoundaryIsHealthy:    true,
			PerTokenFloorOmitted: w.perTokenFloor,
			Marks:                w.marks,
		},
	}

	inWeight := new(big.Int)
	outWeight := new(big.Int)
	var inLegs []weightLeg
	for _, l := range w.legs {
		if inSet[l.asset] {
			inWeight.Add(inWeight, l.weight)
			inLegs = append(inLegs, l)
			out.Disclosures.FactorAssets = append(out.Disclosures.FactorAssets, l.asset)
		} else {
			outWeight.Add(outWeight, l.weight)
			out.Disclosures.HeldAssets = append(out.Disclosures.HeldAssets, l.asset)
		}
	}
	out.Disclosures.Diagnostic = len(inLegs) == 1 && len(out.Disclosures.HeldAssets) > 0

	if inWeight.Sign() == 0 {
		out.InFactor = false
		out.NeverLiquidatable = true
		out.Reason = "position holds no counted collateral in the factor"
		return out, false, nil
	}
	out.InFactor = true

	if w.debt.Sign() == 0 {
		out.NeverLiquidatable = true
		out.Reason = "position carries no debt"
		return out, true, nil
	}

	// numerator = W·D − Σ_{i∉F} wᵢ
	num := new(big.Int).Mul(w.denom, w.debt)
	num.Sub(num, outWeight)
	if num.Sign() <= 0 {
		out.NeverLiquidatable = true
		out.Reason = "collateral outside the factor already covers the debt at threshold"
		return out, true, nil
	}

	s, err := NewRational(num, inWeight)
	if err != nil {
		return LiquidationPrice{}, true, err
	}
	out.ScaleFactor = s
	// s* ≥ 1 ⟺ num ≥ inWeight.
	out.AlreadyBreached = num.Cmp(inWeight) >= 0

	for _, l := range inLegs {
		fp := FactorAssetPrice{
			Asset:         l.asset,
			CurrentPrice:  new(big.Int).Set(l.price),
			PriceDecimals: l.priceDecimals,
		}
		pr, err := NewRational(new(big.Int).Mul(num, l.price), inWeight)
		if err != nil {
			return LiquidationPrice{}, true, fmt.Errorf("liquidation price for %s: %w", l.asset.Hex(), err)
		}
		fp.Price = pr
		q, rem := new(big.Int).QuoRem(new(big.Int).Mul(num, l.price), inWeight, new(big.Int))
		fp.PriceFloor = new(big.Int).Set(q)
		fp.LowestHealthyPrice = new(big.Int).Set(q)
		if rem.Sign() != 0 {
			fp.LowestHealthyPrice.Add(fp.LowestHealthyPrice, bigOne)
		}
		out.Prices = append(out.Prices, fp)
	}
	return out, true, nil
}
