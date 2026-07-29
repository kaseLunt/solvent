package risk

// Market realization and execution shortfall — the "weETH market depeg,
// oracles held" surface (design spec §6; oracle-sentinel R3(b); Codex round 1
// [M8]).
//
// # Why this is not a price shock
//
// Neither protocol reads a secondary-market weETH price. Aave marks weETH
// through a cap adapter that is ETH/USD × the contract's own getRate(); the
// Debt Manager marks it as an exchange-rate feed × ETH/USD. A market depeg
// with the redemption rate unchanged therefore moves NO oracle, NO health
// factor, and produces NO liquidations. A stress row reporting "$X becomes
// liquidatable" under that label names one attack and models another.
//
// What a market depeg actually does is liquidator-side: the collateral a
// liquidator seizes at the oracle mark realizes less on the market, and a
// position whose collateral cannot retire its debt at market prices carries
// bad debt the protocol is not seeing.
//
// # The guard
//
// ExecutionShortfall computes every position's health TWICE — once from the
// book as handed in, once from the book after the market-realization pass —
// and compares the health factors bit-for-bit. applyMarketRealization is
// written to leave every PriceInput untouched; if it ever stopped doing so,
// HFsUnchanged would go false and TestExecutionShortfallOraclesHeld would
// fail. The assertion is computed, not asserted in a comment.
//
// # The one modeling assumption, stated
//
// Seizure is modeled PRO-RATA over the position's counted collateral: the
// realized value of the seized slice is the collateral-weighted average
// realization ratio applied to the seizable amount. Real liquidators choose a
// preference order and would take the least-impaired asset first, so this is
// a neutral-not-conservative assumption and is disclosed as such.

import (
	"fmt"
	"math/big"
	"sort"
)

// SeizureModelProRata names the seizure assumption on the wire.
const SeizureModelProRata = "pro-rata over counted collateral"

// ExecutionShortfall quantifies the gap between oracle marks and market
// realization across a book, with oracles held.
func ExecutionShortfall(book []PositionInput, real []MarketRealization) (ShortfallResult, error) {
	ratios := make(map[string]*big.Int, len(real))
	for _, m := range real {
		if m.MarketOverOracle == nil || m.MarketOverOracle.Sign() <= 0 {
			return ShortfallResult{}, assetErr("execution shortfall", "", m.Asset, ErrNegativeAmount,
				"market_over_oracle must be a positive wad")
		}
		k := responseKey(m.ChainID, m.Asset)
		if _, dup := ratios[k]; dup {
			return ShortfallResult{}, assetErr("execution shortfall", "", m.Asset, ErrDuplicatePriceInput,
				"duplicate market realization")
		}
		ratios[k] = new(big.Int).Set(m.MarketOverOracle)
	}

	out := ShortfallResult{
		HFsUnchanged: true,
		PerEngine:    map[string]EngineShortfall{},
	}
	engines := map[string]*EngineShortfall{}
	engineOf := func(engine string, dec uint8) *EngineShortfall {
		e, ok := engines[engine]
		if !ok {
			e = &EngineShortfall{
				Engine: engine, UsdDecimals: dec,
				ExecutionShortfallUSD:   new(big.Int),
				BadDebtAtLiquidationUSD: new(big.Int),
			}
			engines[engine] = e
		}
		return e
	}

	for i, pos := range book {
		if err := pos.Validate(); err != nil {
			return ShortfallResult{}, fmt.Errorf("book[%d]: %w", i, err)
		}
		realized := marketRealizationPass(pos)

		ps, err := shortfallForPosition(pos, realized, ratios)
		if err != nil {
			return ShortfallResult{}, fmt.Errorf("book[%d]: %w", i, err)
		}
		if !ps.hfUnchanged {
			out.HFsUnchanged = false
		}
		e := engineOf(ps.out.Engine, ps.usdDecimals)
		if ps.out.Liquidatable {
			e.LiquidatablePositions++
			e.ExecutionShortfallUSD.Add(e.ExecutionShortfallUSD, ps.out.ExecutionShortfallUSD)
			e.BadDebtAtLiquidationUSD.Add(e.BadDebtAtLiquidationUSD, ps.out.BadDebtUSD)
			if ps.out.BadDebtUSD.Sign() > 0 {
				e.InsolventPositions++
			}
		}
		out.Positions = append(out.Positions, ps.out)
	}

	names := make([]string, 0, len(engines))
	for n := range engines {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		out.PerEngine[n] = *engines[n]
	}

	// The two flat aggregates are only meaningful in ONE engine's USD scale.
	// Aave base currency is 8-decimal, Debt Manager USD is 6-decimal;
	// summing them is the blending design spec §5.2 forbids.
	if len(names) == 1 {
		e := engines[names[0]]
		out.SingleEngineScale = names[0]
		out.ExecutionShortfallUSD = new(big.Int).Set(e.ExecutionShortfallUSD)
		out.BadDebtAtLiquidationUSD = new(big.Int).Set(e.BadDebtAtLiquidationUSD)
	}
	return out, nil
}

// marketRealizationPass is a TEST SEAM, and it exists for one reason: without
// it, the HFsUnchanged=false branch is unreachable and therefore unproven.
// applyMarketRealization is deterministic and touches no price, so through the
// public API the comparison can only ever succeed — which is exactly what a
// hard-coded `HFsUnchanged: true` would also do. Swapping this var lets the
// suite prove the guard actually fires when the pass DOES move a price.
// Nothing outside the test binary reassigns it.
var marketRealizationPass = applyMarketRealization

// applyMarketRealization is the market-value pass. It returns a copy of the
// position with the ORACLE INPUTS DELIBERATELY UNTOUCHED — a market
// realization is not a price. The copy exists so ExecutionShortfall can
// recompute health from it and prove bit-identity rather than assume it.
func applyMarketRealization(pos PositionInput) PositionInput {
	out := pos
	switch pos.Engine {
	case AaveEngine:
		cp := *pos.Aave
		cp.Prices = append([]PriceInput(nil), pos.Aave.Prices...)
		out.Aave = &cp
	case DMEngine:
		cp := *pos.DM
		cp.Prices = append([]PriceInput(nil), pos.DM.Prices...)
		out.DM = &cp
	}
	return out
}

type positionShortfallResult struct {
	out         PositionShortfall
	hfUnchanged bool
	usdDecimals uint8
}

func shortfallForPosition(oracle, realized PositionInput, ratios map[string]*big.Int) (positionShortfallResult, error) {
	var (
		res       positionShortfallResult
		chainID   uint64
		legs      []weightLeg
		collat    *big.Int
		debt      *big.Int
		seizable  *big.Int
		unchanged bool
	)

	switch oracle.Engine {
	case AaveEngine:
		h1, err := ComputeAaveHealth(*oracle.Aave)
		if err != nil {
			return res, err
		}
		h2, err := ComputeAaveHealth(*realized.Aave)
		if err != nil {
			return res, err
		}
		unchanged = sameWadHealth(h1.HealthFactorWad, h2.HealthFactorWad) && h1.IsInfinite == h2.IsInfinite
		res.usdDecimals = h1.BaseDecimals
		collat = h1.TotalCollateralBase
		debt = h1.TotalDebtBase
		seizable = aaveSeizableBase(h1)
		res.out = PositionShortfall{
			Engine: AaveEngine, Account: h1.Account,
			Liquidatable: !h1.IsInfinite && h1.HealthFactorWad.Cmp(wadUnit) < 0,
		}
		for _, r := range h1.Reserves {
			if r.CollateralBase == nil || r.CollateralBase.Sign() == 0 {
				continue
			}
			chainID = r.Price.ChainID
			legs = append(legs, weightLeg{asset: r.Asset, value: r.CollateralBase})
		}
	default:
		h1, err := ComputeDMHealth(*oracle.DM)
		if err != nil {
			return res, err
		}
		h2, err := ComputeDMHealth(*realized.DM)
		if err != nil {
			return res, err
		}
		unchanged = h1.Liquidatable == h2.Liquidatable && h1.HealthFactor.Cmp(h2.HealthFactor) == 0
		res.usdDecimals = h1.UsdDecimals
		collat = h1.CollateralValueUSD
		debt = h1.Borrowings
		seizable = dmSeizableUSD(h1)
		res.out = PositionShortfall{
			Engine: DMEngine, Account: h1.Account, Liquidatable: h1.Liquidatable,
		}
		for _, c := range h1.Collateral {
			if c.ValueUSD == nil || c.ValueUSD.Sign() == 0 {
				continue
			}
			chainID = c.Price.ChainID
			legs = append(legs, weightLeg{asset: c.Asset, value: c.ValueUSD})
		}
	}
	res.hfUnchanged = unchanged

	// Σ(valueᵢ × rᵢ) and Σ valueᵢ, both exact, no premature division.
	weighted := new(big.Int)
	total := new(big.Int)
	realizable := new(big.Int)
	for _, l := range legs {
		r, ok := ratios[responseKey(chainID, l.asset)]
		if !ok {
			r = wadUnit
		}
		weighted.Add(weighted, new(big.Int).Mul(l.value, r))
		total.Add(total, l.value)
		realizable.Add(realizable, MulDivFloor(l.value, r, wadUnit))
	}

	seizableMarket := new(big.Int)
	if total.Sign() > 0 {
		// One fused floor: seizable × (Σ value·r) / (WAD × Σ value).
		n := new(big.Int).Mul(seizable, weighted)
		d := new(big.Int).Mul(wadUnit, total)
		seizableMarket = n.Div(n, d)
	}

	res.out.CollateralOracleUSD = orZero(collat)
	res.out.DebtUSD = orZero(debt)
	res.out.SeizableOracleUSD = seizable
	res.out.SeizableMarketUSD = seizableMarket
	res.out.ExecutionShortfallUSD = maxZero(new(big.Int).Sub(seizable, seizableMarket))
	res.out.RealizableCollateralUSD = realizable
	// Every position's row carries its own numbers for inspection; only
	// LIQUIDATABLE positions are summed into the aggregates (see the caller).
	res.out.BadDebtUSD = maxZero(new(big.Int).Sub(orZero(debt), realizable))
	return res, nil
}

func sameWadHealth(a, b *big.Int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Cmp(b) == 0
}
