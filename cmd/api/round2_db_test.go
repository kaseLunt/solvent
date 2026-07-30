package main

// The Codex round-2 fix regressions: the three-valued lookup answer, book-wide
// coverage, and rate-index independence.
//
// All three findings were the same class as round 1's critical — a withheld engine
// reading as an established fact — at surfaces the round-1 sweep did not reach. So
// every test here comes in a PAIR with opposite teeth: the withheld case and an
// identically-shaped PROVEN case. A fix that answered "unknown" for everything
// would be as wrong as one that answered "no".

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
)

// withheldFixture rebuilds the fixture around a batch whose Aave engine is
// WITHHELD, leaving only the Debt Manager position present.
func withheldFixture(t *testing.T, key string) *apiFixture {
	t.Helper()
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches CASCADE`)
	require.NoError(t, err)
	f.batchID = f.seedWithheldBatch(t, key, false)
	return f
}

// provenEmptyFixture is its control: the Aave engine is just as empty and carries
// no refusal.
func provenEmptyFixture(t *testing.T, key string) *apiFixture {
	t.Helper()
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches CASCADE`)
	require.NoError(t, err)
	f.batchID = f.seedWithheldBatch(t, key, true)
	return f
}

// ---------------------------------------------------------------------------
// The three-valued lookup answer (Codex round 2 [high]).
// ---------------------------------------------------------------------------

// TestAddressLookupNeverReportsAFalseNegativeWhileAnEngineIsWithheld is the
// finding, closed.
//
// `fxAcctAave` holds its ONLY position on the withheld engine. Deriving `found`
// from the returned row count gave `found: false` — and the contract defines that
// as "no position exists in this batch", a definitive negative the service is in
// no position to assert. The answer must be `null`.
func TestAddressLookupNeverReportsAFalseNegativeWhileAnEngineIsWithheld(t *testing.T) {
	f := withheldFixture(t, "fixture-withheld-lookup")

	status, raw := f.get(t, "/v1/address/"+fxAcctAave.Hex())
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))

	require.Empty(t, arr(t, body, "positions"), "the withheld engine contributes no rows")
	require.Nil(t, at(t, body, "found"),
		"an address whose only engine is WITHHELD must not receive a definitive `no position` answer")
	require.False(t, boolAt(t, body, "lookup_complete"))
	withheld := arr(t, body, "withheld_engines")
	require.Len(t, withheld, 1)
	require.Equal(t, risk.AaveEngine, str(t, withheld[0], "engine"))
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, str(t, withheld[0], "code"))
	require.Contains(t, str(t, body, "lookup_complete_note"), "NEVER be rendered as `no position`")
}

// TestAddressLookupStillReportsAnHonestDefinitiveNegative is the OPPOSITE-TEETH
// control: with every engine proven — and just as empty — the same empty result IS
// a definitive negative and must say so.
func TestAddressLookupStillReportsAnHonestDefinitiveNegative(t *testing.T) {
	f := provenEmptyFixture(t, "fixture-proven-lookup")

	status, raw := f.get(t, "/v1/address/"+fxAcctAave.Hex())
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))

	require.Empty(t, arr(t, body, "positions"))
	require.NotNil(t, at(t, body, "found"),
		"with every engine proven the answer IS establishable; null would be a refusal to answer a question the service can answer")
	require.False(t, boolAt(t, body, "found"))
	require.True(t, boolAt(t, body, "lookup_complete"))
	require.Empty(t, arr(t, body, "withheld_engines"))
	require.Contains(t, str(t, body, "lookup_complete_note"), "definitive answer")
}

// TestAddressLookupAssertsAPositiveFindEvenWhileIncomplete pins the third value:
// a position that WAS found is a positive fact about the chain, and another
// engine being withheld cannot make it untrue. It is still marked incomplete, so a
// client knows the answer is a floor rather than a total.
func TestAddressLookupAssertsAPositiveFindEvenWhileIncomplete(t *testing.T) {
	f := withheldFixture(t, "fixture-withheld-positive")

	status, raw := f.get(t, "/v1/address/"+fxAcctDM.Hex())
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))

	require.Len(t, arr(t, body, "positions"), 1)
	require.True(t, boolAt(t, body, "found"), "a found position is a positive existence claim")
	require.False(t, boolAt(t, body, "lookup_complete"),
		"the other engine could not be consulted, so this find is a floor and not a total")
	require.Len(t, arr(t, body, "withheld_engines"), 1)
}

// TestStressLookupNeverReportsAFalseNegativeWhileAnEngineIsWithheld is the same
// pair at the stress endpoint, which repeated the identical logic.
func TestStressLookupNeverReportsAFalseNegativeWhileAnEngineIsWithheld(t *testing.T) {
	f := withheldFixture(t, "fixture-withheld-stress")

	status, raw := f.get(t, "/v1/address/"+fxAcctAave.Hex()+"/stress")
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}/stress", http.StatusOK, raw)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))

	require.Nil(t, at(t, body, "found"))
	require.False(t, boolAt(t, body, "lookup_complete"))
	require.Len(t, arr(t, body, "withheld_engines"), 1)
	require.Equal(t, risk.AaveEngine, str(t, arr(t, body, "withheld_engines")[0], "engine"))
	// Every scenario is still listed, with no results — the surface does not vanish.
	require.NotEmpty(t, arr(t, body, "scenarios"))
}

func TestStressLookupStillReportsAnHonestDefinitiveNegative(t *testing.T) {
	f := provenEmptyFixture(t, "fixture-proven-stress")

	status, raw := f.get(t, "/v1/address/"+fxAcctAave.Hex()+"/stress")
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}/stress", http.StatusOK, raw)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))

	require.NotNil(t, at(t, body, "found"))
	require.False(t, boolAt(t, body, "found"))
	require.True(t, boolAt(t, body, "lookup_complete"))
	require.Empty(t, arr(t, body, "withheld_engines"))
}

// ---------------------------------------------------------------------------
// Book-wide coverage (Codex round 2 [medium]).
// ---------------------------------------------------------------------------

// TestCoverageIsNotFullWhileAnEngineIsWithheld closes the vacuous green: a
// withheld engine contributes no positions, so a reconstruction-only predicate
// stayed true while an entire engine was absent from every scenario and every
// waterfall point.
func TestCoverageIsNotFullWhileAnEngineIsWithheld(t *testing.T) {
	f := withheldFixture(t, "fixture-withheld-coverage")

	body := f.getJSON(t, "/v1/book", "/v1/book")
	require.EqualValues(t, 0, num(t, body, "coverage", "excluded_by_this_layer"),
		"no POSITION failed to rebuild — which is exactly why a reconstruction-only predicate read green")
	require.False(t, boolAt(t, body, "coverage", "stress_coverage_is_full"),
		"`stress_coverage_is_full` is a BOOK-WIDE claim and an entire engine is missing from the arithmetic")
	cw := arr(t, body, "coverage", "withheld_engines")
	require.Len(t, cw, 1)
	require.Equal(t, risk.AaveEngine, str(t, cw[0], "engine"))
	require.Contains(t, str(t, body, "coverage", "note"), "book-wide claim")
}

// TestCoverageIsFullForAGenuinelyEmptyProvenEngine is the control: an equally
// empty but PROVEN engine leaves coverage full. Without it, a fix that reported
// "not full" whenever an engine had no positions would pass the test above.
func TestCoverageIsFullForAGenuinelyEmptyProvenEngine(t *testing.T) {
	f := provenEmptyFixture(t, "fixture-proven-coverage")

	body := f.getJSON(t, "/v1/book", "/v1/book")
	require.EqualValues(t, 0, num(t, body, "coverage", "excluded_by_this_layer"))
	require.Empty(t, arr(t, body, "coverage", "withheld_engines"))
	require.True(t, boolAt(t, body, "coverage", "stress_coverage_is_full"),
		"nothing is missing: the engine is empty because the book is empty, and that is fully covered")
}

// ---------------------------------------------------------------------------
// Rate-index independence (Codex round 2 [medium]).
// ---------------------------------------------------------------------------

// TestObservatoryServesRateIndexesWithNoCompleteBatch closes the data-suppression:
// rate-index custody is independent of the risk batches, so an honest startup or
// partial restore can hold valid current indexes with nothing servable yet. The
// early return reported them as absent — data that exists, served as data that
// does not.
func TestObservatoryServesRateIndexesWithNoCompleteBatch(t *testing.T) {
	f := newAPIFixture(t)

	// Both present first, so the assertion below is a change of state.
	before := f.getJSON(t, "/v1/observatory", "/v1/observatory")
	require.Len(t, arr(t, before, "series"), 1)
	require.Len(t, arr(t, before, "rate_indexes"), 1)

	// Every risk batch goes away. The rate indexes are untouched — they are written
	// by the derivers, not by the materializer.
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches CASCADE`)
	require.NoError(t, err)

	body := f.getJSON(t, "/v1/observatory", "/v1/observatory")
	require.Empty(t, arr(t, body, "series"), "there is genuinely no servable batch")
	idx := arr(t, body, "rate_indexes")
	require.Len(t, idx, 1, "the rate indexes still exist and must still be served")
	require.Equal(t, fxRateIndexValue, str(t, idx[0], "value"))
	require.EqualValues(t, fxRateIndexBlock, num(t, idx[0], "as_of_block"))
	require.Equal(t, "liquidity_index", str(t, idx[0], "kind"))
}

// TestObservatoryReportsGenuinelyAbsentRateIndexesAsAbsent is the control: when
// `rate_indexes` really is empty the collection really is empty. Without it, a fix
// that fabricated a row would pass the test above.
func TestObservatoryReportsGenuinelyAbsentRateIndexesAsAbsent(t *testing.T) {
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE rate_indexes`)
	require.NoError(t, err)

	body := f.getJSON(t, "/v1/observatory", "/v1/observatory")
	require.Empty(t, arr(t, body, "rate_indexes"),
		"absent data is reported absent; the fix restores suppressed rows, it does not invent them")
	require.Len(t, arr(t, body, "series"), 1, "and the batch series is unaffected")
}
