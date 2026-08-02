package main

// GET /v1/scenarios — the COMMITTED scenario listing.
//
// # Why this is its own route
//
// The committed set is compiled into this binary (internal/risk/scenarios/*.json,
// embedded and validated at startup), so it is CONFIGURATION, not batch data.
// Before contract 1.4.0 it nevertheless reached clients only as a passenger on
// an address-stress answer: `/v1/address/{addr}/stress` appends the whole set to
// every response, so a surface wanting to know WHICH scenarios exist had to pick
// an address, ask what would happen to it, and read the definitions out of the
// reply. That is a lookup standing in for a listing, and it fails exactly where
// it matters most — a book-wide Scenario Lab has no address to name, and a
// deployment with no servable batch answers that route 503, so the vocabulary
// was unavailable precisely in the cold-start window where a client needs it to
// render its controls at all.
//
// This route serves the set directly, and therefore:
//
//   - carries NO batch envelope. A scenario definition is not a materialization
//     and pinning one to a batch would be a claim the definition does not make.
//     `served_at` is the DATABASE clock, the same house rule every other
//     `served_at` on this surface follows.
//   - answers 200 with no batch in the database at all (the /v1/evidence
//     posture: the response describes the DEPLOYMENT).
//
// # One serializer, by construction
//
// Every entry is `scenarioDefinition(sc)` — literally the type the stress
// surface embeds in each element of its `scenarios` array. The stress entry is
// this entry PLUS `results`, and that is the only difference between the two
// surfaces. Two hand-maintained serializers for one committed definition drift
// the day one grows a field, and a client would then render a scenario that is
// not the scenario the numbers were computed from.
//
// # What the listing does NOT carry, and why
//
// The `propagation` matrix and the `market_realizations` / `projection`
// mechanics stay off this wire. They are the arithmetic's inputs, not the
// scenario's public claim, and they are already disclosed where they bite: the
// per-position `applied_shocks` and `held_flat` arrays of a stress or run-book
// answer name every asset the matrix moved and every one it did not. A listing
// republishing the matrix would invite a reader to derive an outcome from it by
// hand — the exact re-derivation this service refuses everywhere else.

import (
	"net/http"
	"time"
)

type scenariosResponse struct {
	ServedAt time.Time `json:"served_at"`
	// ScenarioConfigVersion versions the set AS A WHOLE — the same token
	// /v1/meta, /v1/evidence and every stress answer publish.
	ScenarioConfigVersion string            `json:"scenario_config_version"`
	Scenarios             []wireScenarioDef `json:"scenarios"`
	Notes                 []string          `json:"notes"`
}

func (s *server) handleScenarios(w http.ResponseWriter, r *http.Request) {
	// The database clock, never this process's wall clock — and never a batch
	// read: this route is servable with no batch in the database.
	now, err := s.dbNow(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, err.Error(), nil)
		return
	}

	out := scenariosResponse{
		ServedAt:              now,
		ScenarioConfigVersion: s.scenarioConfigVersion(),
		Scenarios:             []wireScenarioDef{},
		Notes:                 scenarioListingNotes(),
	}
	for _, sc := range s.scenarios {
		out.Scenarios = append(out.Scenarios, scenarioDefinition(sc))
	}
	writeJSON(w, out)
}

// scenarioListingNotes is the listing's disclosure block, in one place so the
// contract's example can be held byte-faithful to it.
func scenarioListingNotes() []string {
	return []string{
		"this is the COMMITTED set, compiled into the binary — configuration, not batch data. It carries no batch envelope and is servable before any batch exists; a definition here says what WOULD be evaluated, never what the book is.",
		"the SAME definitions ride on every /v1/address/{addr}/stress response's `scenarios` array, serialized by the same code. That array carries per-address `results` in addition; nothing else differs, so the two surfaces cannot describe different scenarios.",
		"every `id` here is exactly what POST /v1/scenarios/{id}/run-book accepts. An id absent from this listing is a 404 there, never a silently empty run.",
		"`engines` is the set of engines a scenario is DEFINED for. An engine missing from it is out of the scenario's model — a property of the definition, and not the same statement as a withheld engine, which is a refusal and is named as one on the surfaces that evaluate.",
		"shocks are EXACT rationals: -30% is `factor_num` 70 over `factor_den` 100, never 0.7. There are no floats in this pipeline. A shock of 1/1 is a scenario whose information lives on another axis — a projection over time, or a market realization the oracles do not see.",
		"`out_of_model` is part of the definition, not a footnote: it names what the scenario does NOT model, and a shocked number read without it is a number read wrong.",
		"`scenario_config_version` versions the set as a whole, so a client caching results has one token to invalidate on. Files that disagree report MIXED(...) rather than a silently chosen version.",
	}
}
