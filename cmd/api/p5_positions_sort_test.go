package main

// Wave W-HR-B — the /v1/positions sort vocabulary (contract 1.5.0) and the
// per-engine symmetry of the `liq_distance.factor_symbol` label.
//
// Pure tests: no database, no HTTP. What they pin is the two places the
// serving layer can silently fork from the contract — the accepted sort names,
// and whether a row's axis label is resolved through the ROW's OWN engine.

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// THE SORT VOCABULARY IS THE CONTRACT'S, EXACTLY.
//
// 1.5.0 ADDED `headroom` and DEPRECATED `liq_distance` WITHOUT REMOVING IT. A
// deprecation that dropped the name would 400 every bookmark and every cursor
// minted before the bump, which is precisely what the alias exists to prevent.
func TestPositionsSortVocabularyIs150(t *testing.T) {
	require.Equal(t, map[string]store.PositionSort{
		"headroom":     store.PositionSortHeadroom,
		"liq_distance": store.PositionSortLiqDistance,
		"debt":         store.PositionSortDebt,
		"hf":           store.PositionSortHF,
		"status":       store.PositionSortStatus,
	}, positionsSorts)

	// The DEFAULT is unchanged. Changing a default is a breaking change for
	// every client that omits the parameter, and 1.5.0 is additive.
	require.Contains(t, positionsSorts, "liq_distance",
		"the deprecated key must still resolve — an absent `sort` still defaults to it")

	// Each name resolves to its OWN store key: no two contract names may
	// collapse onto one store enum, because the cursor binds the name and a
	// collapse would let two rankings share a rank space.
	seen := map[store.PositionSort]string{}
	for name, key := range positionsSorts {
		prev, dup := seen[key]
		require.False(t, dup, "sort %q and %q both resolve to store key %q", name, prev, key)
		seen[key] = name
	}
}

// THE SORT-VOCABULARY WELD over api/openapi.yaml (Wave W-HR-B), in the shape
// of contract_sweep_law_test.go's own discipline: a MECHANICAL sweep with no
// hand-maintained inventory anywhere in it.
//
// The class of drift it closes is the one this wave could most easily
// introduce, and the one a reader is least able to detect: a contract that
// ADVERTISES a sort the server refuses (a documented 400) or a server that
// ACCEPTS a sort the contract does not name (an undocumented ordering no
// client can rely on, and none can validate against). The contract states the
// enum in TWO places — the `sort` query parameter and the echoed
// `PositionsResponse.sort` — and a response echoing a value its own schema
// rejects would fail contract validation at runtime, so those two must agree
// as well.
//
// Every set below is DERIVED. Adding a sort to the contract and forgetting the
// server (or the reverse) fails here on the day it happens, not on the day a
// client trips over it.
func TestPositionsSortEnumMatchesTheContractExactly(t *testing.T) {
	doc := loadFreshContract(t)

	op := doc.Paths.Value("/v1/positions").Get
	require.NotNil(t, op, "the contract must still declare GET /v1/positions")

	var paramEnum []string
	for _, p := range op.Parameters {
		if p.Value.Name == "sort" {
			for _, v := range p.Value.Schema.Value.Enum {
				s, ok := v.(string)
				require.True(t, ok, "the sort enum must be strings, got %T", v)
				paramEnum = append(paramEnum, s)
			}
		}
	}
	require.NotEmpty(t, paramEnum, "the contract must declare the `sort` query parameter's enum")

	echoed := doc.Components.Schemas["PositionsResponse"].Value.Properties["sort"].Value.Enum
	var echoedEnum []string
	for _, v := range echoed {
		s, ok := v.(string)
		require.True(t, ok)
		echoedEnum = append(echoedEnum, s)
	}

	require.ElementsMatch(t, paramEnum, echoedEnum,
		"the accepted `sort` enum and the ECHOED `sort` enum must be the same set — a response "+
			"echoing a value its own schema rejects fails contract validation")

	served := make([]string, 0, len(positionsSorts))
	for name := range positionsSorts {
		served = append(served, name)
	}
	require.ElementsMatch(t, paramEnum, served,
		"the server's sort vocabulary and the contract's enum must be the SAME set: a contract "+
			"key the server refuses is a documented 400, and a server key the contract omits is an "+
			"ordering no client can validate")

	// AND THE SET IS A SUPERSET OF WHAT SHIPPED. This is the additive law
	// stated as a test rather than as a promise: 1.5.0 may ADD names, and it
	// may not remove one, because every removed name breaks live links and
	// in-flight cursors that carry it.
	for _, shipped := range []string{"liq_distance", "debt", "hf", "status"} {
		require.Contains(t, paramEnum, shipped,
			"contract 1.5.0 is ADDITIVE: %q shipped before it and may not be withdrawn", shipped)
	}
	require.Contains(t, paramEnum, "headroom", "1.5.0 adds the ratio key")

	// THE DEFAULT IS PART OF THE CONTRACT TOO — and it is unchanged, because
	// changing it silently re-ranks every request that omits the parameter.
	require.Contains(t, positionsSorts, "liq_distance")
	require.Equal(t, store.PositionSortLiqDistance, positionsSorts["liq_distance"])
}

// fxSymbolFeeds is the minimal registry for the label test: ONE asset per
// engine, each with a distinct symbol, so a lookup that ignored the engine
// would return the wrong string rather than an empty one.
func fxSymbolFeeds() *config.Feeds {
	return &config.Feeds{Assets: []config.Feed{
		{
			Chain: "eth", ChainID: fxETHChain, Engine: risk.AaveEngine, Address: fxWeETHEth,
			Symbol: "weETH-eth", Decimals: 18, Roles: []string{"collateral"},
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxOracle,
				Method: "getAssetPrice(address)", PriceDecimals: 8},
		},
		{
			Chain: "op", ChainID: fxOPChain, Engine: risk.DMEngine, Address: fxWeETHOp,
			Symbol: "weETH-op", Decimals: 18, Roles: []string{"collateral"},
			Oracle: config.FeedOracle{Kind: config.FeedKindPoll, Contract: fxPriceProvider,
				Method: "price(address)", PriceDecimals: 6},
		},
	}}
}

// THE AXIS LABEL IS SERVED ON BOTH ENGINES, THROUGH THE ROW'S OWN ENGINE.
//
// `liq_distance.factor_symbol` is what the Book's demoted price-path hover
// prints ("weETH must move −12.3% to reach this engine's boundary"); without
// it the hover falls back to the generic "the committed price axis". The
// resolution is a single registry lookup keyed by (engine, asset), so the Debt
// Manager gets a symbol on exactly the same terms Aave does — and the wrong
// engine yields NO label rather than a mislabelled axis.
//
// (Verified against live data as well as here: over the whole DM book of a
// live batch — 9,804 rows, 1,482 of them publishing `kind: "distance"` — every
// single distance row carried a `factor_symbol`. The field is `omitempty` and
// only exists on `distance` rows, which is why a sample from the top of the
// default ranking — where rows are `breached`/`never` — reads as "absent".)
func TestLiqDistanceFactorSymbolIsServedOnBothEngines(t *testing.T) {
	s := fxServer(t)
	registry, err := riskfeed.NewRegistry(fxSymbolFeeds())
	require.NoError(t, err)
	s.registry = registry

	num, den := "6000000000000000", "6480000000000000"
	solved := func(engine, asset string) wirePosition {
		return wirePosition{
			Engine: engine,
			Status: "computed",
			LiquidationPrice: &wireLiquidationPrice{
				InFactor:       true,
				ScaleFactorNum: &num,
				ScaleFactorDen: &den,
				FactorAssets:   []string{asset},
			},
		}
	}

	aave := s.liqDistance(solved(risk.AaveEngine, fxWeETHEth.Hex()))
	require.Equal(t, "distance", aave.Kind)
	require.Equal(t, "weETH-eth", aave.FactorSymbol)

	dm := s.liqDistance(solved(risk.DMEngine, fxWeETHOp.Hex()))
	require.Equal(t, "distance", dm.Kind, "a DM row with a factor-level solve serves a distance")
	require.Equal(t, "weETH-op", dm.FactorSymbol,
		"the Debt Manager's axis label is resolved on the SAME terms as Aave's")
	require.Equal(t, fxWeETHOp.Hex(), *dm.FactorAsset)

	// THE ENGINE IS PART OF THE KEY. Handing a DM row the Aave asset resolves
	// NOTHING — an unlabelled axis, never another engine's ticker.
	crossed := s.liqDistance(solved(risk.DMEngine, fxWeETHEth.Hex()))
	require.Equal(t, "distance", crossed.Kind)
	require.Empty(t, crossed.FactorSymbol,
		"an asset the row's engine cannot value carries NO symbol — never a borrowed one")

	// And the arms with no axis carry no label to give: `omitempty` keeps the
	// field ABSENT rather than serving an empty string that reads as a name.
	breached := s.liqDistance(wirePosition{
		Engine:           risk.DMEngine,
		Status:           "computed",
		LiquidationPrice: &wireLiquidationPrice{AlreadyBreached: true},
	})
	require.Equal(t, "breached", breached.Kind)
	require.Empty(t, breached.FactorSymbol)
	require.Nil(t, breached.FactorAsset)
}
