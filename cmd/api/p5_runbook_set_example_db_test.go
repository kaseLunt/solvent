package main

// THE SET-RUN'S 200 EXAMPLE IS CAPTURED, NEVER WRITTEN.
//
// The standing law of this repo is that a contract example is a body the server
// SERVES, transplanted — not prose about one. The run-book's example was prose
// once, and five defects were ledgered against it before it was replaced by a
// capture; repairing five instances would have left the class alive.
//
// So this test seeds a book, runs the REAL handler for a REAL committed id set,
// and asserts the contract's example IS that body — modulo exactly six fields
// whose values a clock produces.
//
// # The id set is chosen, not arbitrary
//
// A captured example carrying only scenarios that REACH is an example in which
// the component this whole surface exists for is never seen. The set therefore
// includes:
//
//	eth_minus_30               reaches every mark, on BOTH engines: real numbers,
//	                           real deltas, a real movement count.
//	stable_depeg_0995_in_band  THE SNAPPED CONTROL. `no_mark_moved` with
//	                           marks_snapped 3 and marks_base_snapped 1 over four
//	                           applied rows — the exact split that makes "K of K
//	                           snapped" a false sentence.
//	dm_composition_census      THE DECLARED HOLD. Eight shocks, all at 1/1, with a
//	                           NON-EMPTY applied set, which is the point of the
//	                           arm.
//
// The order is the REQUEST order and it is deliberately not alphabetical.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// setRunExampleIDs is the captured example's request, in request order.
var setRunExampleIDs = []string{"eth_minus_30", "stable_depeg_0995_in_band", "dm_composition_census"}

// newRunBookSetExampleFixture is the example's book: the standing four-position
// fixture with the Debt Manager carrying the snap control's four marks and one
// of the identity census's, so all three results are substantive.
func newRunBookSetExampleFixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	dm := srDMWithPrices(
		srDMPrice(fxAcctDM, srUSDCOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srUSDTOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srFrxUSDOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srLiquidUSDOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srEUSDOp, fxOPChain, "1000000"),
	)
	f.srSeed(t, srBatchWrite("set-run-example-1",
		fxAavePosition(), fxAaveRefused(), dm, fxDMRefused()))
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)
	return f
}

// srRunBracketed posts and returns the body together with the two DATABASE
// instants the request happened between — production's own authority, not this
// process's wall clock.
func (f *apiFixture) srRunBracketed(t *testing.T, ids ...string) (map[string]any, dbClockBracket) {
	t.Helper()
	lo := readDBClock(t, f)
	body := f.srRun(t, http.StatusOK, ids...)
	return body, dbClockBracket{Lo: lo, Hi: readDBClock(t, f)}
}

// runBookSetContractExample reads the contract's declared 200 example, validates
// it against its OWN schema and its OWN clock, and returns it.
func runBookSetContractExample(t *testing.T) map[string]any {
	t.Helper()
	doc := loadContract(t)
	item := doc.Paths.Find(setRunContractPath)
	require.NotNil(t, item, "the contract declares no %q", setRunContractPath)
	op := item.GetOperation(http.MethodPost)
	require.NotNil(t, op)
	mt := op.Responses.Status(http.StatusOK).Value.Content.Get("application/json")
	require.NotNil(t, mt)
	require.NotNil(t, mt.Example, "the contract declares no 200 example for the set-run route")

	raw, err := json.Marshal(mt.Example)
	require.NoError(t, err)
	var out map[string]any
	require.NoError(t, json.Unmarshal(raw, &out))

	require.NoError(t, mt.Schema.Value.VisitJSON(mt.Example, openapi3.MultiErrors()),
		"the contract's set-run 200 example violates the contract's own schema")
	// A schema cannot see that a stated age contradicts the two stamps printed
	// beside it. This can, and it says so in arithmetic rather than as a byte diff.
	requireTemporalCoherence(t, "the contract's set-run 200 example", out)
	requireSetRunCoherence(t, "the contract's set-run 200 example", out)
	return out
}

// requireSetRunCoherence is section 7.2's list: the checks the captured body must
// satisfy, asserted against BOTH the served body and the document.
func requireSetRunCoherence(t *testing.T, what string, body map[string]any) {
	t.Helper()
	ev := asMap(t, body["evaluation"])

	// 1 and 2. `resolved_at` IS `served_at`, and the probe is not before it.
	require.Equal(t, body["served_at"], ev["resolved_at"],
		"%s: `evaluation.resolved_at` IS `served_at` — one snapshot instant, read twice", what)
	resolved := exampleInstant(t, ev["resolved_at"])
	probed := exampleInstant(t, ev["probed_at"])
	require.False(t, probed.Before(resolved),
		"%s: the freshness probe is taken AFTER the arithmetic, so `probed_at` is never before `resolved_at`", what)

	// 4. Membership.
	results := asList(t, body["results"])
	requested := srStrings(t, body["requested_scenario_ids"])
	require.Equal(t, len(results), intOf(t, ev["scenarios_evaluated"]), "%s", what)
	require.Equal(t, len(requested), len(results), "%s: there is no partial 200", what)
	gotIDs, wantIDs := []string{}, append([]string(nil), requested...)
	for _, r := range results {
		gotIDs = append(gotIDs, asMap(t, r)["scenario_id"].(string))
	}
	sortedGot := append([]string(nil), gotIDs...)
	sort.Strings(sortedGot)
	sort.Strings(wantIDs)
	require.Equal(t, wantIDs, sortedGot, "%s: membership must partition exactly", what)
	require.Equal(t, requested, gotIDs, "%s: results are in REQUEST order", what)

	// 6. Freshness and the id agree, per the four-arm table.
	newest := ev["newest_servable_batch_id"]
	batchID := intOf(t, asMap(t, body["batch"])["id"])
	switch ev["freshness"] {
	case freshnessNoneServable:
		require.Nil(t, newest, "%s: null EXACTLY in this arm", what)
	case freshnessStillNewest:
		require.Equal(t, batchID, intOf(t, newest), "%s: equal exactly for still_newest", what)
	case freshnessSuperseded:
		require.Greater(t, intOf(t, newest), batchID, "%s", what)
	case freshnessNewestIsOlder:
		require.Less(t, intOf(t, newest), batchID, "%s", what)
	default:
		t.Fatalf("%s: freshness %v is outside the four-arm vocabulary", what, ev["freshness"])
	}

	// 5, 7, 8. Per result.
	for _, r := range results {
		res := asMap(t, r)
		id := res["scenario_id"].(string)

		covered := srStrings(t, res["covered_engines"])
		union := append([]string{}, srStrings(t, res["withheld_engines"])...)
		for _, e := range asList(t, res["engines"]) {
			union = append(union, asMap(t, e)["engine"].(string))
		}
		for _, a := range asList(t, res["unmeasurable_engines"]) {
			union = append(union, asMap(t, a)["engine"].(string))
		}
		sort.Strings(union)
		sortedCovered := append([]string(nil), covered...)
		sort.Strings(sortedCovered)
		require.Equal(t, sortedCovered, union, "%s/%s: the three-part engine partition", what, id)

		answered := 0
		for _, e := range asList(t, res["engines"]) {
			answered += intOf(t, asMap(t, e)["accounts"])
		}
		require.Equal(t, answered, intOf(t, res["positions_answered"]), "%s/%s", what, id)

		reach := asMap(t, res["shock_reach"])
		shocks := asList(t, res["shocks"])
		require.Equal(t, len(shocks), intOf(t, reach["declared_shocks"]), "%s/%s", what, id)
		identity := 0
		for _, s := range shocks {
			m := asMap(t, s)
			if intOf(t, m["factor_num"]) == intOf(t, m["factor_den"]) {
				identity++
			}
		}
		require.Equal(t, identity, intOf(t, reach["declared_shocks_at_identity"]),
			"%s/%s: `declared_shocks_at_identity` is the count of shocks[] entries with factor_num == factor_den", what, id)

		applied := asList(t, reach["applied_shocks"])
		moved := 0
		for _, a := range applied {
			m := asMap(t, a)
			if m["before"] != m["after"] {
				moved++
			}
		}
		require.Equal(t, moved, intOf(t, reach["marks_moved"]),
			"%s/%s: marks_moved is the applied rows whose before and after decimal strings DIFFER", what, id)
		require.LessOrEqual(t, intOf(t, reach["marks_moved"]), len(applied), "%s/%s", what, id)
		require.Equal(t, len(applied),
			intOf(t, reach["marks_moved"])+intOf(t, reach["marks_held_by_declared_factor"])+
				intOf(t, reach["marks_held_by_transform"])+intOf(t, reach["marks_held_by_arithmetic"]),
			"%s/%s: the cause partition must close EXACTLY", what, id)

		// The arm is the one the ordered derivation yields for this result's OWN
		// counts — recomputed here rather than trusted.
		wantArm, err := setRunShockReachArm(setRunReachFacts{
			HasProjection:            asList(t, res["engines"]) != nil && srExampleHasProjection(t, res),
			DeclaredShocks:           len(shocks),
			DeclaredShocksAtIdentity: identity,
			AppliedRows:              len(applied),
			MarksMoved:               moved,
		})
		require.NoError(t, err)
		require.Equal(t, wantArm, reach["reach"], "%s/%s: the served arm is not the one the derivation yields", what, id)

		// 8. Held-flat identities: pairwise distinct on the PAIR, ascending on it,
		// and never more of them than there are marks.
		seen := map[string]bool{}
		var prev string
		for _, a := range asList(t, reach["held_flat_assets"]) {
			m := asMap(t, a)
			key := fmt.Sprintf("%012d|%s", intOf(t, m["chain_id"]), strings.ToLower(m["asset"].(string)))
			require.False(t, seen[key], "%s/%s: held_flat_assets repeats %s", what, id, key)
			seen[key] = true
			require.Less(t, prev, key, "%s/%s: held_flat_assets is not ascending on (chain_id, asset)", what, id)
			prev = key
		}
		require.LessOrEqual(t, len(seen), intOf(t, reach["held_flat_marks"]),
			"%s/%s: a chain may hold two marks of one asset from two sources, so the identities are at most the marks",
			what, id)
	}

	// 9. The census partition.
	cov := asMap(t, body["coverage"])
	require.Equal(t, intOf(t, cov["batch_positions"]),
		intOf(t, cov["in_book"])+intOf(t, cov["refused_in_batch"])+intOf(t, cov["excluded_by_this_layer"]),
		"%s: the census partition", what)
}

// srExampleHasProjection reports whether any engine of this result carries a
// projection block, which is the wire evidence of the definition's projection.
func srExampleHasProjection(t *testing.T, res map[string]any) bool {
	t.Helper()
	for _, e := range asList(t, res["engines"]) {
		if asMap(t, e)["projection"] != nil {
			return true
		}
	}
	return false
}

// TestRunBookSetExampleIsAServedBody is the standing law.
//
// THE MUTATION THIS KILLS: editing the contract's set-run 200 example to say
// anything the server does not serve.
func TestRunBookSetExampleIsAServedBody(t *testing.T) {
	f := newRunBookSetExampleFixture(t)
	served, clock := f.srRunBracketed(t, setRunExampleIDs...)

	// PRODUCTION'S OWN CLOCK, READ THREE WAYS, before anything is overwritten.
	// Self-agreement is not freshness: a `v.Now` regressed to a shared old anchor
	// leaves every stated age COHERENT and every one of them understated, and the
	// normalizer would then launder it. The two outside readings are what close
	// that.
	requireRawStampsAreThePersistedOnes(t, f, served)
	requireServedAtWithinDBClock(t, "the served set-run body", served, clock)
	requireTemporalCoherence(t, "the served set-run body", served)

	// The probe instant is the SECOND clock reading on this response, and it is
	// inside the same bracket. Nothing else on this surface can see it.
	probed := exampleInstant(t, asMap(t, served["evaluation"])["probed_at"])
	require.False(t, probed.Before(clock.Lo) || probed.After(clock.Hi),
		"`evaluation.probed_at` (%v) is outside the bracket this request was issued between (%v .. %v): it IS a database "+
			"clock read in the probe's own statement, so an instant outside the bracket is a clock this service did not "+
			"probe at", probed, clock.Lo.Format(time.RFC3339Nano), clock.Hi.Format(time.RFC3339Nano))

	requireSetRunCoherence(t, "the served set-run body", served)

	// THE SEEDED BOOK REALLY IS THE EXAMPLE'S BOOK, asserted here rather than left
	// to the diff — a comparison that failed because the fixture drifted would
	// read as a contract defect.
	require.Equal(t, float64(1), asMap(t, served["batch"])["id"], "the example's batch is batch 1")
	results := srResults(t, served)
	require.Len(t, results, 3)
	require.Equal(t, reachEveryMarkMoved, asMap(t, results["eth_minus_30"]["shock_reach"])["reach"])
	inband := asMap(t, results["stable_depeg_0995_in_band"]["shock_reach"])
	require.Equal(t, reachNoMarkMoved, inband["reach"],
		"THE SNAPPED CONTROL must be in the example, or the component this surface exists for is never seen in it")
	require.Equal(t, float64(3), inband["marks_snapped"])
	require.Equal(t, float64(1), inband["marks_base_snapped"])
	require.Len(t, asList(t, inband["applied_shocks"]), 4)
	census := asMap(t, results["dm_composition_census"]["shock_reach"])
	require.Equal(t, reachAllShocksDeclaredAtIdentity, census["reach"],
		"THE DECLARED HOLD must be in the example too: it is the arm whose absence published a false cause")
	require.NotEmpty(t, asList(t, census["applied_shocks"]),
		"and with a NON-EMPTY applied set, which is the point of the arm")
	for _, res := range results {
		require.NotEmpty(t, asList(t, asMap(t, res["shock_reach"])["held_flat_assets"]),
			"the example's book must reach at least one held-flat mark, or the component is captured EMPTY and the "+
				"contract's example never shows its shape")
	}

	normalizeSetRunServeTime(t, served)

	// The capture escape hatch: `SOLVENT_CAPTURE_SETRUN_EXAMPLE=<path>` writes the
	// normalized body so it can be transplanted into the contract. It never
	// rewrites the contract itself — a test that edited the document it validates
	// would be a law that agrees with itself by construction.
	if path := os.Getenv("SOLVENT_CAPTURE_SETRUN_EXAMPLE"); path != "" {
		raw, err := json.MarshalIndent(served, "", "  ")
		require.NoError(t, err)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, raw, 0o644))
		t.Skipf("captured the normalized set-run body to %s; transplant it into api/openapi.yaml and re-run", path)
	}

	require.Equal(t, runBookSetContractExample(t), served,
		"api/openapi.yaml's set-run 200 example is not a body this server serves.\n"+
			"The example is CAPTURED, never composed: re-run this test with SOLVENT_CAPTURE_SETRUN_EXAMPLE=<path> and "+
			"transplant the result.\n"+
			"Normalized serve-time fields (the only ones a document may differ on): %v",
		runBookSetExampleServeTimeFields)
}

// TestRunBookSetExampleNormalizerRefusesAMissingField keeps the normalizer
// honest. A normalizer that silently normalized nothing would make the byte
// comparison above vacuous, and `evaluation`'s two instants are new fields that
// an earlier shape did not have.
func TestRunBookSetExampleNormalizerRefusesAMissingField(t *testing.T) {
	f := newRunBookSetExampleFixture(t)
	served := f.srRun(t, http.StatusOK, setRunExampleIDs...)

	for _, drop := range []func(map[string]any){
		func(b map[string]any) { delete(b, "served_at") },
		func(b map[string]any) { delete(asMap(t, b["evaluation"]), "resolved_at") },
		func(b map[string]any) { delete(asMap(t, b["evaluation"]), "probed_at") },
		func(b map[string]any) { delete(asMap(t, b["batch"]), "age_seconds") },
		func(b map[string]any) {
			for _, w := range asList(t, asMap(t, b["batch"])["watermarks"]) {
				if sweep, ok := asMap(t, w)["sweep"].(map[string]any); ok {
					delete(sweep, "max_updated_at")
				}
			}
		},
	} {
		mutant := exampleDeepCopy(t, served)
		drop(mutant)
		fake := &testing.T{}
		// The normalizer's refusals are `require`, which is FailNow, which is
		// runtime.Goexit — not a panic, and not recoverable in place. It runs on
		// its own goroutine so the Goexit unwinds that goroutine and the failure
		// is observed rather than taking this test down with it.
		done := make(chan struct{})
		go func() {
			defer close(done)
			normalizeSetRunServeTime(fake, mutant)
		}()
		<-done
		require.True(t, fake.Failed(), "the normalizer accepted a body missing a field it claims to normalize")
	}

	// And there are EXACTLY six named fields, so the list cannot quietly grow.
	require.Len(t, runBookSetExampleServeTimeFields, 6)
	require.Equal(t, []string{
		"served_at", "batch.computed_at", "batch.age_seconds",
		"batch.watermarks[].sweep.age_seconds", "evaluation.resolved_at", "evaluation.probed_at",
	}, runBookSetExampleServeTimeFields)

	// `evaluation` carries NO `batch_id` to normalize or to exempt: a block
	// requiring one IS a re-clock by the contract's own vocabulary.
	require.NotContains(t, asMap(t, served["evaluation"]), "batch_id")
	_ = risk.DMEngine
}
