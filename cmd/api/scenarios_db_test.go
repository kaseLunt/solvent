package main

// GET /v1/scenarios — the live-database half: the COLD-START claim and THE
// WELD.
//
// # Why this endpoint exists at all
//
// Before contract 1.4.0 the committed scenario set reached a client only as a
// passenger on an ADDRESS-STRESS response: `/v1/address/{addr}/stress` appends
// the whole set to every answer, so a surface wanting to know WHICH scenarios
// exist had to pick an address, ask what would happen to it, and read the
// definitions out of the reply. That is a lookup for a listing, and it fails
// exactly when it matters most — a book-wide Scenario Lab has no address to
// name, and a deployment with no servable batch answers that route 503, so the
// scenario vocabulary was unavailable precisely in the cold-start window where
// a client most needs to render its controls.
//
// # The two properties under test
//
//  1. COLD. The listing is committed CONFIGURATION, compiled into the binary —
//     not batch data. It must answer 200 with the whole set while /v1/book is
//     still honestly answering 503, or the endpoint has not actually solved the
//     problem it was added for. The control matters: a fixture that quietly had
//     a batch would let a batch-coupled implementation pass.
//
//  2. THE WELD. The listing and the stress response's `scenarios` array must
//     agree FIELD FOR FIELD — the stress entry is the listing entry plus
//     `results`, and nothing else. Two surfaces publishing the same committed
//     definitions through two serializers is a drift waiting to happen: the day
//     one grows a field, a client reading the other renders a scenario that is
//     not the scenario the numbers were computed from. The production code
//     makes them one serializer BY CONSTRUCTION (`scenarioDefinition`, embedded
//     in the stress element type); this test asserts it ON THE WIRE, because a
//     construction argument that nothing checks is a comment.

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// committedScenarioIDs is the committed set as the suite knows it — twelve
// files under internal/risk/scenarios, the same count TestStressServesExact
// RecomputableValues pins on the stress side. It is written out rather than
// derived from `s.scenarios` on purpose: a listing test whose expectation is
// read from the same slice the handler ranges over asserts only that the
// handler is self-consistent.
var committedScenarioIDs = []string{
	"btc_leg_minus_20",
	"dm_composition_census",
	"dm_rate_horizon_plus_200bps",
	"eth_minus_10",
	"eth_minus_20",
	"eth_minus_30",
	"ethfi_minus_50",
	"stable_depeg_098_unsnapped",
	"stable_depeg_0995_in_band",
	"stable_depeg_099_boundary",
	"weeth_market_depeg_oracles_held",
	"weeth_rate_minus_5",
}

// TestScenariosServesTheCommittedSetWithNoBatchAtAll is the COLD-START law: the
// committed scenario listing is servable before the materializer has ever
// produced a batch, because it describes configuration rather than a book.
func TestScenariosServesTheCommittedSetWithNoBatchAtAll(t *testing.T) {
	f := newBareAPIFixture(t)
	f.startServer(t)

	// THE CONTROL: this deployment genuinely has no servable batch. Without it,
	// a batch-coupled listing would pass this test on the fixture's leftovers.
	status, _ := f.get(t, "/v1/book")
	require.Equal(t, http.StatusServiceUnavailable, status,
		"the cold fixture must have NO servable batch, or the cold-start claim below is untested")

	body := f.getJSON(t, "/v1/scenarios", "/v1/scenarios")
	require.Equal(t, "v1", str(t, body, "scenario_config_version"))
	require.NotEmpty(t, arr(t, body, "notes"))

	listed := arr(t, body, "scenarios")
	require.Len(t, listed, len(committedScenarioIDs),
		"the WHOLE committed set must be listed — a subset is a Lab that cannot offer what the API can run")

	var ids []string
	for _, e := range listed {
		sc, ok := e.(map[string]any)
		require.True(t, ok)
		ids = append(ids, str(t, sc, "id"))

		// The listing is the COMMITTED-SET half only: per-address evaluation has
		// no meaning on a surface that was given no address.
		require.NotContains(t, sc, "results",
			"the listing must carry no per-address results — it answers `what scenarios exist`, not `what happens to whom`")
		require.NotEmpty(t, str(t, sc, "version"))
		require.NotEmpty(t, str(t, sc, "label"))
		require.NotEmpty(t, str(t, sc, "path_assumption"),
			"a scenario's path assumption travels WITH its definition: a shocked number whose assumptions are unread is a number read wrong")
		require.NotEmpty(t, arr(t, sc, "engines"))
		require.NotEmpty(t, arr(t, sc, "out_of_model"))
	}
	require.ElementsMatch(t, committedScenarioIDs, ids,
		"the listed ids must be exactly the committed set on disk")
}

// TestScenarioListingWeldsToTheStressScenarioArray is THE WELD: the listing's
// entries and the stress response's `scenarios` entries are the same objects,
// field for field, once the per-address `results` array is set aside.
//
// This is the mutation target of wave S1a (mutant M1): hand-fork the listing's
// serializer from the stress one and this test must kill it.
func TestScenarioListingWeldsToTheStressScenarioArray(t *testing.T) {
	f := newAPIFixture(t)

	listing := f.getJSON(t, "/v1/scenarios", "/v1/scenarios")
	stress := f.getJSON(t, "/v1/address/"+fxAcctAave.Hex()+"/stress", "/v1/address/{addr}/stress")

	require.Equal(t, str(t, listing, "scenario_config_version"), str(t, stress, "scenario_config_version"),
		"one committed set, one version token — two surfaces disagreeing on it is the drift this weld exists to catch")

	listed := arr(t, listing, "scenarios")
	evaluated := arr(t, stress, "scenarios")
	require.Len(t, listed, len(evaluated),
		"the listing must offer exactly the set the stress surface evaluates")

	var listedIDs, evaluatedIDs []string
	for i := range evaluated {
		ev, ok := evaluated[i].(map[string]any)
		require.True(t, ok)
		got, ok := listed[i].(map[string]any)
		require.True(t, ok)

		// ANTI-VACUITY: the stress entry must really carry the per-address half,
		// or "the listing equals the stress entry minus results" is a comparison
		// of two identical things and proves nothing about the split.
		results, hasResults := ev["results"]
		require.True(t, hasResults,
			"the stress array must carry per-address `results` — without it this weld compares nothing")
		require.NotNil(t, results)

		want := map[string]any{}
		for k, v := range ev {
			if k != "results" {
				want[k] = v
			}
		}
		require.Equal(t, want, got,
			"scenario %q: the listing entry must BE the stress entry minus `results`, field for field — "+
				"two serializers for one committed definition is a drift waiting to happen", str(t, ev, "id"))

		listedIDs = append(listedIDs, str(t, got, "id"))
		evaluatedIDs = append(evaluatedIDs, str(t, ev, "id"))
	}
	require.Equal(t, evaluatedIDs, listedIDs,
		"the two surfaces must present the committed set in the SAME order — a client zipping them by index is the obvious use")
}
