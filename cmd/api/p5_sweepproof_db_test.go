package main

// THE STRIP-PROOF (owed by Wave H3, law 6 — "serving-surface disclosure
// gap", discharged here): every serving path that carries a COMPUTED Debt
// Manager row must emit a NONZERO sweep watermark beside the row's
// `liquidatable` verdict — the account's own collateral clock, from the
// store's persisted row, never the envelope's newest-batch stamp.
//
// The contract half of the law lives in contract_sweep_law_test.go (the
// field is structurally REQUIRED wherever the verdict travels); this test
// owns the VALUES half: the handlers actually fill the watermark from the
// persisted row. A handler that dropped the field would already fail the
// per-request contract validation inside getJSON; a handler that served a
// ZERO for a swept account would pass the schema (0 is the disclosed
// "never swept") and is exactly what this test exists to catch — a
// plausible-looking strip of the disclosure.
//
// Parameterized over the three DM-verdict-bearing surfaces: the positions
// page, the address detail, and the address history.

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEveryComputedDMRowServesANonzeroSweepWatermark(t *testing.T) {
	f := newP5Fixture(t)

	// The fixture's one computed DM row (fxAcctDM) was persisted with
	// SweepBlock = fxDMSweepBlock. The refused DM row (fxAcctDMRef,
	// SWEEP_NEVER) is the disclosed-absence control and is asserted
	// separately in the history suite.
	surfaces := []struct {
		name    string
		extract func(t *testing.T) []float64
	}{
		{
			name: "positions page",
			extract: func(t *testing.T) []float64 {
				out := f.getJSON(t, "/v1/positions?engine=debt_manager", "/v1/positions")
				var marks []float64
				for _, row := range asList(t, out["positions"]) {
					r := asMap(t, row)
					if r["engine"] == "debt_manager" && r["status"] == "computed" {
						marks = append(marks, r["sweep_block"].(float64))
					}
				}
				return marks
			},
		},
		{
			name: "address detail",
			extract: func(t *testing.T) []float64 {
				out := f.getJSON(t, "/v1/address/"+fxAcctDM.Hex(), "/v1/address/{addr}")
				var marks []float64
				for _, row := range asList(t, out["positions"]) {
					r := asMap(t, row)
					if r["engine"] == "debt_manager" && r["status"] == "computed" {
						marks = append(marks, asMap(t, r["as_of"])["sweep_block"].(float64))
					}
				}
				return marks
			},
		},
		{
			name: "address history",
			extract: func(t *testing.T) []float64 {
				out := f.getJSON(t, "/v1/address/"+fxAcctDM.Hex()+"/history", "/v1/address/{addr}/history")
				var marks []float64
				for _, e := range asList(t, out["engines"]) {
					engine := asMap(t, e)
					if engine["engine"] != "debt_manager" {
						continue
					}
					for _, p := range asList(t, engine["points"]) {
						pt := asMap(t, p)
						if pt["status"] == "computed" {
							marks = append(marks, pt["sweep_block"].(float64))
						}
					}
				}
				return marks
			},
		},
	}

	for _, surface := range surfaces {
		t.Run(surface.name, func(t *testing.T) {
			marks := surface.extract(t)
			require.NotEmpty(t, marks,
				"anti-vacuity: the fixture's computed DM row must appear on this surface — an extractor that matches nothing proves nothing")
			for _, mark := range marks {
				require.Equal(t, float64(fxDMSweepBlock), mark,
					"a computed DM row's sweep watermark is the PERSISTED row's own value — nonzero for a swept account, and never the envelope's stamp or a zero wearing 'never swept'")
			}
		})
	}
}
