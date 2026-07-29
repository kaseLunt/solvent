package risk

// The liquidation waterfall (design spec §6; risk-quant R4).
//
// # What the headline number is
//
// Cumulative DEBT ELIGIBLE FOR LIQUIDATION by grid point, accumulated by
// per-account FIRST CROSSING. Not "will be liquidated": the Debt Manager
// closes in a two-pass 50%-then-remainder sweep, so realized ≤ eligible, and
// the surface must say so.
//
// # The monotonicity invariant is real, not decorative
//
// The eligible SET latches — once an account crosses on a down-grid it stays
// counted — but each point's debt is measured AT THAT POINT. Under a
// single-factor shock that does not touch a debt asset, debt is constant and
// the series is monotone; if the shocked factor also moves a debt price, the
// series genuinely can fall, and that is a fact about the book worth
// surfacing. So the check can fail, and when it does the series is returned
// alongside ErrNonMonotone with the offending grid point named. It is NEVER
// smoothed.
//
// # Engines are never blended
//
// Aave base currency is 8-decimal; Debt Manager USD is 6-decimal. Every
// aggregate is reported per engine with its own decimals stated.

import (
	"errors"
	"fmt"
	"math/big"
	"sort"
)

// ErrNonMonotone is returned when a single-factor down-grid produces a
// cumulative debt-eligible series that falls. Wrapped in a NonMonotoneError
// naming the offending grid point.
var ErrNonMonotone = errors.New("risk: cumulative debt-eligible series is not monotone on a single-factor down-grid")

// ErrGridNotDescending is returned for a grid that is not a strictly
// descending sequence of positive factors.
var ErrGridNotDescending = errors.New("risk: waterfall grid must be strictly descending positive factors")

// NonMonotoneError names the grid point at which monotonicity broke.
type NonMonotoneError struct {
	Index    int
	Factor   *big.Int
	Engine   string
	Previous *big.Int
	Current  *big.Int
}

func (e *NonMonotoneError) Error() string {
	return fmt.Sprintf("risk: cumulative debt eligible fell on engine %s at grid[%d] (factor %s): %s → %s",
		e.Engine, e.Index, e.Factor, e.Previous, e.Current)
}

// Is makes errors.Is(err, ErrNonMonotone) true.
func (e *NonMonotoneError) Is(target error) bool { return target == ErrNonMonotone }

// WaterfallGridScale is the grid factor's fixed-point scale: 1e18 == 1.0, so
// a −20% point is 800000000000000000.
func WaterfallGridScale() *big.Int { return WadUnit() }

// EngineWaterfall is one engine's aggregates at one grid point, in that
// engine's own USD scale.
type EngineWaterfall struct {
	Engine      string
	UsdDecimals uint8

	NewlyEligibleAccounts      int
	CumulativeEligibleAccounts int
	// CumulativeDebtEligibleUSD is Σ debt, measured AT THIS GRID POINT, over
	// accounts that have crossed at or before it.
	CumulativeDebtEligibleUSD *big.Int
	// CumulativeCollateralAtRiskUSD is Σ min(collateral, debt × (1+bonus)).
	CumulativeCollateralAtRiskUSD *big.Int
	// InsolventIfLiquidatedAccounts counts crossed accounts whose collateral,
	// net of the liquidation bonus, cannot retire the debt.
	InsolventIfLiquidatedAccounts int
	// CumulativeBadDebtUSD is Σ max(0, debt − collateral/(1+bonus)) over
	// those accounts.
	CumulativeBadDebtUSD *big.Int
}

// WaterfallPoint is the whole book at one grid factor.
type WaterfallPoint struct {
	Index  int
	Factor *big.Int
	// Engines is sorted by engine name, so the series serializes
	// deterministically.
	Engines []EngineWaterfall
}

// Engine returns the named engine's aggregates at this point.
func (p WaterfallPoint) Engine(name string) (EngineWaterfall, bool) {
	for _, e := range p.Engines {
		if e.Engine == name {
			return e, true
		}
	}
	return EngineWaterfall{}, false
}

// WaterfallSeries is the full grid walk plus its disclosures.
//
// THE INVARIANT COVERS THE DEBT SERIES ONLY. CumulativeDebtEligibleUSD must
// not fall on a single-factor down-grid, and Waterfall refuses the series if it
// does. CumulativeCollateralAtRiskUSD carries NO such invariant: it is measured
// at each grid point, and collateral value falls as the factor falls, so it
// legitimately decreases once the accounts that have already crossed are worth
// less than they were. A renderer must not present the at-risk column as a
// monotone accumulation.
type WaterfallSeries struct {
	ScenarioID      string
	ScenarioVersion string
	Axis            AxisRef
	GridScale       *big.Int
	Points          []WaterfallPoint
	// HeldFlat is the deduplicated union of every price input no propagation
	// row described, across every position and grid point. An empty list is
	// the claim that the matrix covered the whole book.
	HeldFlat []HeldFlatInput
	// Realized ≤ eligible: stated on the series so a renderer cannot omit it.
	EligibilityNote string
}

// Waterfall walks a single-factor down-grid over a book.
//
// gridScenario supplies the propagation matrix and names the ONE axis the
// grid walks; each grid point replaces that shock's factor. Requiring exactly
// one shock is what makes the monotonicity invariant meaningful — a
// multi-factor grid has no such guarantee.
//
// The third parameter is an ADDITION to the plan's two-parameter sketch.
// Without a propagation matrix the function cannot know that weETH moves with
// ETH or that a stable snaps, and would hold most of the book at its
// pre-shock price — oracle-sentinel R4's named silent failure.
func Waterfall(book []PositionInput, grid []*big.Int, gridScenario Scenario) (WaterfallSeries, error) {
	if err := gridScenario.Validate(); err != nil {
		return WaterfallSeries{}, err
	}
	if len(gridScenario.Shocks) != 1 {
		return WaterfallSeries{}, fmt.Errorf("%w: waterfall needs exactly one shocked axis, %s declares %d",
			ErrScenarioInvalid, gridScenario.ID, len(gridScenario.Shocks))
	}
	if len(grid) == 0 {
		return WaterfallSeries{}, fmt.Errorf("%w: empty grid", ErrGridNotDescending)
	}
	for i, g := range grid {
		if g == nil || g.Sign() <= 0 {
			return WaterfallSeries{}, fmt.Errorf("%w: grid[%d] is not positive", ErrGridNotDescending, i)
		}
		if i > 0 && g.Cmp(grid[i-1]) >= 0 {
			return WaterfallSeries{}, fmt.Errorf("%w: grid[%d]=%s is not below grid[%d]=%s",
				ErrGridNotDescending, i, g, i-1, grid[i-1])
		}
	}
	for i, pos := range book {
		if err := pos.Validate(); err != nil {
			return WaterfallSeries{}, fmt.Errorf("book[%d]: %w", i, err)
		}
	}

	series := WaterfallSeries{
		ScenarioID:      gridScenario.ID,
		ScenarioVersion: gridScenario.Version,
		Axis:            gridScenario.Shocks[0].ref(),
		GridScale:       WaterfallGridScale(),
		EligibilityNote: "debt ELIGIBLE for liquidation; realized ≤ eligible (the Debt Manager closes in two passes, 50% then remainder)",
	}

	crossed := make([]bool, len(book))
	heldFlat := map[string]HeldFlatInput{}
	prev := map[string]*big.Int{}

	for k, g := range grid {
		sc, err := gridScenario.WithSingleShockFactor(g, WaterfallGridScale())
		if err != nil {
			return series, err
		}
		acc := map[string]*EngineWaterfall{}
		engineOf := func(engine string, dec uint8) *EngineWaterfall {
			e, ok := acc[engine]
			if !ok {
				e = &EngineWaterfall{
					Engine: engine, UsdDecimals: dec,
					CumulativeDebtEligibleUSD:     new(big.Int),
					CumulativeCollateralAtRiskUSD: new(big.Int),
					CumulativeBadDebtUSD:          new(big.Int),
				}
				acc[engine] = e
			}
			return e
		}
		// Every engine present in the book gets a row at every point, so a
		// series never silently omits an engine that has no crossings yet.
		for _, pos := range book {
			engineOf(pos.Engine, engineDecimalsHint(pos))
		}

		for i, pos := range book {
			shocked, err := ApplyScenario(pos, sc)
			if err != nil {
				return series, fmt.Errorf("grid[%d] book[%d]: %w", k, i, err)
			}
			if shocked.Scenario != nil {
				for _, h := range shocked.Scenario.HeldFlat {
					heldFlat[responseKey(h.ChainID, h.Asset)] = h
				}
			}
			m, err := measurePosition(shocked)
			if err != nil {
				return series, fmt.Errorf("grid[%d] book[%d]: %w", k, i, err)
			}
			e := engineOf(m.engine, m.usdDecimals)
			// Only a position that actually carried a price can state the
			// engine's USD scale. A priceless (empty) position reports 0, and
			// stamping that over a real 6 or 8 would mislabel the unit on a
			// row whose numbers are in that unit.
			if m.usdDecimals != 0 {
				e.UsdDecimals = m.usdDecimals
			}

			newly := false
			if m.eligible && !crossed[i] {
				crossed[i] = true
				newly = true
			}
			if !crossed[i] {
				continue
			}
			if newly {
				e.NewlyEligibleAccounts++
			}
			e.CumulativeEligibleAccounts++
			e.CumulativeDebtEligibleUSD.Add(e.CumulativeDebtEligibleUSD, m.debt)
			e.CumulativeCollateralAtRiskUSD.Add(e.CumulativeCollateralAtRiskUSD, m.collateralAtRisk)
			if m.badDebt.Sign() > 0 {
				e.InsolventIfLiquidatedAccounts++
				e.CumulativeBadDebtUSD.Add(e.CumulativeBadDebtUSD, m.badDebt)
			}
		}

		names := make([]string, 0, len(acc))
		for n := range acc {
			names = append(names, n)
		}
		sort.Strings(names)
		pt := WaterfallPoint{Index: k, Factor: new(big.Int).Set(g)}
		for _, n := range names {
			pt.Engines = append(pt.Engines, *acc[n])
		}
		series.Points = append(series.Points, pt)

		for _, n := range names {
			cur := acc[n].CumulativeDebtEligibleUSD
			if p, ok := prev[n]; ok && cur.Cmp(p) < 0 {
				series.HeldFlat = flattenHeldFlat(heldFlat)
				return series, &NonMonotoneError{
					Index: k, Factor: new(big.Int).Set(g), Engine: n,
					Previous: new(big.Int).Set(p), Current: new(big.Int).Set(cur),
				}
			}
			prev[n] = new(big.Int).Set(cur)
		}
	}

	series.HeldFlat = flattenHeldFlat(heldFlat)
	return series, nil
}

// positionMeasure is one position evaluated at one grid point.
type positionMeasure struct {
	engine           string
	usdDecimals      uint8
	eligible         bool
	debt             *big.Int
	collateralAtRisk *big.Int
	badDebt          *big.Int
}

// measurePosition evaluates eligibility, collateral at risk and the
// insolvency census for one (already shocked) position. Both bonus-dependent
// columns use EACH TOKEN'S OWN bonus — see the seizure/recovery block in
// dm.go for the law and the direction each column moves:
//
//	collateral at risk = Σᵢ min(vᵢ, floor(debt × vᵢ × (1+bᵢ) / V))
//	recoverable debt   = Σᵢ floor(vᵢ / (1+bᵢ))
//	bad debt           = max(0, debt − recoverable), counted only for
//	                     accounts that are eligible (risk-quant R4's two-leg
//	                     insolvent-if-liquidated flag)
//
// Aave eligibility is STRICT: the protocol liquidates only BELOW a health
// factor of exactly 1e18, so HF == 1e18 is healthy — the same boundary
// discipline as the Debt Manager's `debt > maxBorrowLT`.
func measurePosition(pos PositionInput) (positionMeasure, error) {
	var m positionMeasure
	switch pos.Engine {
	case AaveEngine:
		h, err := ComputeAaveHealth(*pos.Aave)
		if err != nil {
			return m, err
		}
		legs := aaveBonusLegs(h)
		m.engine = AaveEngine
		m.usdDecimals = h.BaseDecimals
		m.eligible = !h.IsInfinite && h.HealthFactorWad.Cmp(wadUnit) < 0
		m.debt = orZero(h.TotalDebtBase)
		m.collateralAtRisk = seizableValue(m.debt, legs)
		m.badDebt = badDebtFrom(m.debt, recoverableDebt(legs), m.eligible)
	default:
		h, err := ComputeDMHealth(*pos.DM)
		if err != nil {
			return m, err
		}
		legs := dmBonusLegs(h)
		m.engine = DMEngine
		m.usdDecimals = h.UsdDecimals
		m.eligible = h.Liquidatable
		m.debt = orZero(h.Borrowings)
		m.collateralAtRisk = seizableValue(m.debt, legs)
		m.badDebt = badDebtFrom(m.debt, recoverableDebt(legs), m.eligible)
	}
	return m, nil
}

// badDebtFrom is max(0, debt − recoverable) for an eligible account, zero
// otherwise. Presenting underwater debt as recoverable is spreadsheet
// solvency; presenting a healthy account's headroom as bad debt is noise.
func badDebtFrom(debt, recoverable *big.Int, eligible bool) *big.Int {
	if !eligible {
		return new(big.Int)
	}
	return maxZero(new(big.Int).Sub(debt, recoverable))
}

// engineDecimalsHint reads a position's USD scale from its first price input
// so an engine row exists at every grid point even before any crossing.
func engineDecimalsHint(pos PositionInput) uint8 {
	switch pos.Engine {
	case AaveEngine:
		if pos.Aave != nil && len(pos.Aave.Prices) > 0 {
			return pos.Aave.Prices[0].Decimals
		}
	case DMEngine:
		if pos.DM != nil && len(pos.DM.Prices) > 0 {
			return pos.DM.Prices[0].Decimals
		}
	}
	return 0
}

func flattenHeldFlat(m map[string]HeldFlatInput) []HeldFlatInput {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]HeldFlatInput, 0, len(keys))
	for _, k := range keys {
		out = append(out, m[k])
	}
	return out
}
