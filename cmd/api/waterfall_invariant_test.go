package main

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// ---------------------------------------------------------------------------
// Wave W-SC-B, finding 1: the waterfall scenario and the waterfall grid are two
// env knobs describing ONE fact.
//
// SOLVENT_API_WATERFALL_SCENARIO and SOLVENT_API_WATERFALL_GRID used to be
// accepted independently — startup only checked that the named scenario existed.
// An operator who changed one and not the other got a clean boot and a frontier
// whose deepest public point was priced at a shock the named scenario's
// disclosures do not describe. These tests pin the pair.
// ---------------------------------------------------------------------------

// committedScenarios is the same set loadServerConfig resolves against: the
// real committed JSON, never a hand-built stub, so a rung's factor moving in the
// repo moves this test with it.
func committedScenarios(t *testing.T) map[string]risk.Scenario {
	t.Helper()
	all, err := risk.LoadScenarios()
	require.NoError(t, err)
	byID := make(map[string]risk.Scenario, len(all))
	for _, sc := range all {
		byID[sc.ID] = sc
	}
	return byID
}

// wadGrid builds a descending grid from the unshocked point down to and
// including tailPct, in ten-percent steps — the same shape the default grid has.
func wadGrid(tailPct int64) []*big.Int {
	wad := risk.WaterfallGridScale()
	var out []*big.Int
	for pct := int64(100); pct >= tailPct; pct -= 10 {
		g := new(big.Int).Mul(wad, big.NewInt(pct))
		out = append(out, g.Div(g, big.NewInt(100)))
	}
	return out
}

// TestResolveWaterfallAcceptsTheDefaultPair: a deployment that sets NEITHER
// override must boot. The compiled-in defaults are themselves a pair, and this
// is the test that fails if someone deepens defaultWaterfallGrid without
// committing (and naming) the matching rung.
func TestResolveWaterfallAcceptsTheDefaultPair(t *testing.T) {
	sc, err := resolveWaterfall(committedScenarios(t), serverConfig{
		WaterfallScenario: defaultWaterfallScenario,
		WaterfallGrid:     defaultWaterfallGrid(),
	})
	require.NoError(t, err)
	require.Equal(t, defaultWaterfallScenario, sc.ID)
	require.Len(t, sc.Shocks, 1)

	// And the tail really is that scenario's committed shock, stated as a wad.
	grid := defaultWaterfallGrid()
	tail := grid[len(grid)-1]
	want := new(big.Int).Mul(risk.WaterfallGridScale(), big.NewInt(sc.Shocks[0].FactorNum))
	want.Div(want, big.NewInt(sc.Shocks[0].FactorDen))
	require.Equal(t, want.String(), tail.String(),
		"the deepest grid point must BE the named scenario's committed shock")
}

// TestResolveWaterfallRejectsStaleScenarioWithNewGrid is the operator who
// deepened the grid to the new -60 tail but left the scenario name at the old
// -30. The frontier would then price a 60% drawdown while publishing
// eth_minus_30's disclosures — the exact wrong reading this invariant exists to
// eliminate.
func TestResolveWaterfallRejectsStaleScenarioWithNewGrid(t *testing.T) {
	_, err := resolveWaterfall(committedScenarios(t), serverConfig{
		WaterfallScenario: "eth_minus_30", // commits 70/100
		WaterfallGrid:     wadGrid(40),    // ends at 0.40
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "TAIL-RUNG INVARIANT")
	require.Contains(t, err.Error(), "400000000000000000", "the offending tail is named")
	require.Contains(t, err.Error(), "700000000000000000", "the tail the named scenario requires is named")
	require.Contains(t, err.Error(), "eth_minus_30")
	require.Contains(t, err.Error(), "SOLVENT_API_WATERFALL_GRID")
	require.Contains(t, err.Error(), "SOLVENT_API_WATERFALL_SCENARIO")
}

// TestResolveWaterfallRejectsStaleGridWithNewScenario is the mirror, and it is
// the pair the checked-in .env.example ADVERTISED before this wave: a grid
// stopping at 0.50 under a name whose committed shock is 0.40. The frontier's
// deepest point would then be labelled with a rung the grid never reaches.
func TestResolveWaterfallRejectsStaleGridWithNewScenario(t *testing.T) {
	_, err := resolveWaterfall(committedScenarios(t), serverConfig{
		WaterfallScenario: "eth_minus_60", // commits 40/100
		WaterfallGrid:     wadGrid(50),    // ends at 0.50
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "TAIL-RUNG INVARIANT")
	require.Contains(t, err.Error(), "500000000000000000", "the offending tail is named")
	require.Contains(t, err.Error(), "400000000000000000", "the tail the named scenario requires is named")
	require.Contains(t, err.Error(), "eth_minus_60")

	// The .env.example pair as it actually shipped — eth_minus_30 named over a
	// grid ending at 0.50 — is refused too. Neither knob was right.
	_, err = resolveWaterfall(committedScenarios(t), serverConfig{
		WaterfallScenario: "eth_minus_30",
		WaterfallGrid:     wadGrid(50),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "TAIL-RUNG INVARIANT")
}

// TestResolveWaterfallAcceptsEveryMatchedCommittedPair: the invariant is
// equality, not "the deepest rung wins". A deployment may run a SHALLOWER
// frontier as long as it names the scenario whose shock its tail is — and since
// the name must resolve in the committed set, equality also bounds the tail to a
// rung someone committed on purpose.
func TestResolveWaterfallAcceptsEveryMatchedCommittedPair(t *testing.T) {
	byID := committedScenarios(t)
	for _, tc := range []struct {
		id      string
		tailPct int64
	}{
		{"eth_minus_10", 90},
		{"eth_minus_20", 80},
		{"eth_minus_30", 70},
		{"eth_minus_40", 60},
		{"eth_minus_50", 50},
		{"eth_minus_60", 40},
	} {
		t.Run(tc.id, func(t *testing.T) {
			sc, err := resolveWaterfall(byID, serverConfig{
				WaterfallScenario: tc.id,
				WaterfallGrid:     wadGrid(tc.tailPct),
			})
			require.NoError(t, err)
			require.Equal(t, tc.id, sc.ID)

			// One rung off in EITHER direction is refused, so the acceptance above
			// is equality and not a bound.
			if tc.tailPct < 100 {
				_, err = resolveWaterfall(byID, serverConfig{
					WaterfallScenario: tc.id,
					WaterfallGrid:     wadGrid(tc.tailPct + 10),
				})
				require.Error(t, err, "a tail one rung SHALLOWER than the named shock must be refused")
			}
			if tc.tailPct > 10 {
				_, err = resolveWaterfall(byID, serverConfig{
					WaterfallScenario: tc.id,
					WaterfallGrid:     wadGrid(tc.tailPct - 10),
				})
				require.Error(t, err, "a tail one rung DEEPER than the named shock must be refused")
			}
		})
	}
}

// TestResolveWaterfallGuardsTheGridShape keeps the pre-existing grid laws in
// force alongside the new tail rule: the grid must be non-empty, must OPEN at
// the unshocked book (that point is the standing bad-debt census), and must be
// strictly descending. The scenario itself must still be committed.
func TestResolveWaterfallGuardsTheGridShape(t *testing.T) {
	byID := committedScenarios(t)
	wad := risk.WaterfallGridScale()
	four := new(big.Int).Div(new(big.Int).Mul(wad, big.NewInt(40)), big.NewInt(100))
	nine := new(big.Int).Div(new(big.Int).Mul(wad, big.NewInt(90)), big.NewInt(100))

	_, err := resolveWaterfall(byID, serverConfig{
		WaterfallScenario: "no_such_scenario",
		WaterfallGrid:     defaultWaterfallGrid(),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "not in the committed scenario set")

	_, err = resolveWaterfall(byID, serverConfig{
		WaterfallScenario: defaultWaterfallScenario,
		WaterfallGrid:     nil,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "empty grid")

	// Opens at 0.9: the "current" column would be a SHOCKED number.
	_, err = resolveWaterfall(byID, serverConfig{
		WaterfallScenario: defaultWaterfallScenario,
		WaterfallGrid:     []*big.Int{nine, four},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "OPEN at the UNSHOCKED book")

	// Ascends: the monotonicity invariant the frontier publishes is only
	// meaningful on a strictly descending single-factor walk.
	_, err = resolveWaterfall(byID, serverConfig{
		WaterfallScenario: defaultWaterfallScenario,
		WaterfallGrid:     []*big.Int{new(big.Int).Set(wad), four, nine},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "STRICTLY DESCENDING")

	// A multi-shock scenario has no single committed factor for the tail to equal
	// (dm_composition_census declares eight).
	_, err = resolveWaterfall(byID, serverConfig{
		WaterfallScenario: "dm_composition_census",
		WaterfallGrid:     defaultWaterfallGrid(),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "want exactly 1")
}

// TestResolveWaterfallComparesRationalsNotFloats is the arithmetic half of the
// invariant: the check is t*den == w*num in big.Int, so it admits NO epsilon and
// no float round-trip.
//
// Two cases a tolerant implementation would wave through:
//
//   - a tail one WEI off the committed rung — visually identical, numerically a
//     different shock;
//   - factor 1/3, whose exact wad tail does not exist; the floor 0.333…333 is
//     what a truncating implementation produces and is NOT one third.
func TestResolveWaterfallComparesRationalsNotFloats(t *testing.T) {
	byID := committedScenarios(t)

	offByOneWei := wadGrid(40)
	tail := offByOneWei[len(offByOneWei)-1]
	offByOneWei[len(offByOneWei)-1] = new(big.Int).Sub(tail, big.NewInt(1)) // 0.399999999999999999
	_, err := resolveWaterfall(byID, serverConfig{
		WaterfallScenario: "eth_minus_60",
		WaterfallGrid:     offByOneWei,
	})
	require.Error(t, err, "one wei off the committed rung is a different shock")
	require.Contains(t, err.Error(), "TAIL-RUNG INVARIANT")
	require.Contains(t, err.Error(), "399999999999999999")

	byID["synthetic_one_third"] = risk.Scenario{
		ID:      "synthetic_one_third",
		Version: "v1",
		Shocks:  []risk.Shock{{Axis: risk.AxisETHUSD, FactorNum: 1, FactorDen: 3}},
	}
	third, ok := new(big.Int).SetString("333333333333333333", 10)
	require.True(t, ok)
	_, err = resolveWaterfall(byID, serverConfig{
		WaterfallScenario: "synthetic_one_third",
		WaterfallGrid:     []*big.Int{risk.WaterfallGridScale(), third},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "not representable",
		"a factor with no exact wad tail is refused rather than rounded onto the grid")
}
