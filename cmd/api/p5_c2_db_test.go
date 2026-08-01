package main

// P5 Task C2 (the contract-corrections wave) — the 1.2.0 additions, against
// the live scratch database: per-row amount units, the liquidation-detail
// extensions (real captured payloads), observation provenance on the
// observatory series, the prices chain identity, the batch permalink's
// servability law, and the evidence manifest's two-subject split.

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestEventsAmountUnitsAreTheStoresOwnClassification: every feed row carries
// the store's per-raw-type unit tag VERBATIM — the closed vocabulary that
// lets a renderer label an accounting delta honestly. A DM delta is never
// tagged as Aave-scaled, a record-only row is `none` with a null amount, and
// no row ever asserts a display scale.
func TestEventsAmountUnitsAreTheStoresOwnClassification(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/events", "/v1/events")
	byKey := map[string]map[string]any{}
	for _, e := range asList(t, out["events"]) {
		m := asMap(t, e)
		byKey[m["engine"].(string)+"/"+m["raw_type"].(string)] = m
	}

	require.Equal(t, "dm_normalized_debt", byKey["debt_manager/borrow"]["amount_unit"],
		"the DM borrow delta is normalized debt — the store's classification, verbatim")
	require.Equal(t, "dm_normalized_debt", byKey["debt_manager/repay"]["amount_unit"])
	require.Equal(t, "dm_normalized_debt", byKey["debt_manager/liquidation"]["amount_unit"])
	require.Equal(t, "aave_scaled", byKey["aave_v3_etherfi/aave_borrow"]["amount_unit"],
		"the Aave borrow delta is ray-scaled units — never mislabeled as a token amount")
	require.Equal(t, "aave_scaled", byKey["aave_v3_etherfi/aave_liquidation_call"]["amount_unit"])

	flag := byKey["aave_v3_etherfi/aave_collateral_enabled"]
	require.Equal(t, "none", flag["amount_unit"], "a record-only row is tagged `none`")
	require.Nil(t, flag["amount"], "`none` promises a null amount")

	for key, m := range byKey {
		require.Nil(t, m["amount_decimals"],
			"%s: no display scale is ever asserted for an accounting-unit delta", key)
	}
}

// TestEventsLiquidationDetailExtensions: the 1.2.0 detail fields parse the
// REAL captured payloads — the Debt Manager's own pre-liquidation figure,
// interest index and per-seizure realized bonus (verbatim, in the contract's
// 100e18 denomination), and Aave's same-tx deficit pairing. Every
// engine-inapplicable field is null, never defaulted.
func TestEventsLiquidationDetailExtensions(t *testing.T) {
	f := newP5Fixture(t)
	out := f.getJSON(t, "/v1/events?types=liquidation", "/v1/events")
	events := asList(t, out["events"])
	require.Len(t, events, 2)

	aave := asMap(t, asMap(t, events[0])["liquidation"]) // newest header time first
	require.Equal(t, true, aave["deficit_paired"],
		"the captured mainnet liquidation IS deficit-paired — the payload's own fact, served verbatim")
	require.Nil(t, aave["before_debt_usd"], "an Aave event carries no DM debt figure — null, never 0")
	require.Nil(t, aave["interest_index"])
	aaveSeized := asList(t, aave["seized"])
	require.Len(t, aaveSeized, 1)
	require.Nil(t, asMap(t, aaveSeized[0])["bonus"],
		"the pool publishes no per-seizure realized bonus — null, never estimated")

	dm := asMap(t, asMap(t, events[1])["liquidation"])
	require.Nil(t, dm["deficit_paired"],
		"the DM has no deficit-pairing concept: a withheld statement, never \"false\"")
	require.Equal(t, "358077", dm["before_debt_usd"], "the event's own USD-6 pre-liquidation figure, verbatim")
	require.Equal(t, "1040759558956902860", dm["interest_index"], "the event's own 1e18 index, verbatim")
	dmSeized := asList(t, dm["seized"])
	require.Len(t, dmSeized, 1)
	require.Equal(t, "5210859800173", asMap(t, dmSeized[0])["bonus"],
		"the realized bonus the CONTRACT recorded for this element, verbatim in its 100e18 denomination — never converted to bps")
}

// TestObservatorySeriesPointsCarryObservationProvenance: each bucket names
// the batch it observed — id, materialization key (which SURVIVES batch
// retention) and the reorg-honesty stamp pair — and each rate index states
// its own scale from the closed per-kind vocabulary.
func TestObservatorySeriesPointsCarryObservationProvenance(t *testing.T) {
	f := newP5Fixture(t)
	seedObservatoryBuckets(t, f)

	out := f.getJSON(t, "/v1/observatory/series?engine=aave_v3_etherfi", "/v1/observatory/series")
	points := asList(t, out["points"])
	require.Len(t, points, 3)

	p0 := asMap(t, points[0])
	require.Equal(t, float64(f.batchID), p0["batch_id"], "the oldest bucket observed the fixture batch")
	require.Equal(t, "fixture-materialization-1", p0["materialization_key"],
		"the observed batch's deterministic key, copied at write time — attribution that survives retention")
	require.Equal(t, float64(0), p0["acked_epoch"])
	require.Equal(t, float64(0), p0["max_epoch_at_compute"])
	require.Equal(t, true, p0["sweep_recorded"],
		"a bucket captured under 00018 always records the sweep state — unrecorded is reserved for pre-00018 history")

	rates := asList(t, p0["rates"])
	require.Len(t, rates, 1)
	require.Equal(t, "liquidity_index", asMap(t, rates[0])["kind"])
	require.Equal(t, "ray-1e27", asMap(t, rates[0])["scale"],
		"the Aave reserve index's denomination, from the closed per-kind vocabulary")

	// The withheld bucket still names WHAT it observed — withholding totals
	// never erases provenance.
	p2 := asMap(t, points[2])
	require.Equal(t, true, p2["refused"])
	require.Equal(t, "obs-withheld-3", p2["materialization_key"])
}

// TestPricesResponseNamesTheChainsConsulted: the answer's chain identity —
// every custody chain consulted is named, and each served series' chain_id
// is from that set, so an empty series can never read as "one chain was
// never asked".
func TestPricesResponseNamesTheChainsConsulted(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/prices/"+fxWeETHEth.Hex(), "/v1/prices/{asset}")
	chains := asList(t, out["chains"])
	require.ElementsMatch(t, []any{float64(fxETHChain), float64(fxOPChain)}, chains,
		"both custody chains are consulted and NAMED")
	chainSet := map[float64]bool{}
	for _, c := range chains {
		chainSet[c.(float64)] = true
	}
	for _, s := range asList(t, out["series"]) {
		require.True(t, chainSet[asMap(t, s)["chain_id"].(float64)],
			"every served series names a chain from the consulted set")
	}
}

// ---------------------------------------------------------------------------
// GET /v1/batches/{id} — the permalink's servability law.
// ---------------------------------------------------------------------------

func TestBatchPermalinkNewestServable(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/batches/"+strconv.FormatInt(f.batchID, 10), "/v1/batches/{id}")
	require.Equal(t, float64(f.batchID), out["batch_id"])
	require.Equal(t, "newest_servable", out["servability"])
	require.Equal(t, "fixture-materialization-1", out["materialization_key"])

	aggs := asList(t, out["aggregates"])
	require.Len(t, aggs, 2, "both engines' persisted rollups travel with the identity")
	byEngine := map[string]map[string]any{}
	for _, a := range aggs {
		m := asMap(t, a)
		byEngine[m["engine"].(string)] = m
	}
	require.Equal(t, fxAaveCollateralBase, byEngine["aave_v3_etherfi"]["total_collateral"],
		"the batch's OWN persisted rollup, verbatim")
	require.Equal(t, fxDMBorrowings, byEngine["debt_manager"]["total_debt"])
	require.Nil(t, byEngine["debt_manager"]["refusal"])

	// The per-aggregate sweep stamp (1.2.2): the permalink's rollups speak for
	// the batch's OWN clock, so the sweep-cut behind the liquidatable count is
	// named on the row — the batch's persisted stamp, verbatim.
	require.Nil(t, byEngine["aave_v3_etherfi"]["sweep"],
		"aave has no collateral sweep: a recorded null, never a stamp invented for it")
	sw := asMap(t, byEngine["debt_manager"]["sweep"])
	require.Equal(t, float64(3), sw["rows"])
	require.Equal(t, float64(1), sw["failed"])
	require.Equal(t, "309593004", sw["success_sum"])
	require.Equal(t, float64(4), sw["generation"])
	require.Equal(t, false, sw["generation_open"])
}

func TestBatchPermalinkSupersededBatchStaysResolvable(t *testing.T) {
	f := newP5Fixture(t)
	firstID := f.batchID
	newID := f.seedBatch(t, "fixture-materialization-2")
	require.Greater(t, newID, firstID)

	// The superseded batch resolves with its immutable identity — the
	// drawer-pin permalink's whole point.
	out := f.getJSON(t, "/v1/batches/"+strconv.FormatInt(firstID, 10), "/v1/batches/{id}")
	require.Equal(t, "superseded_retained", out["servability"])
	require.Equal(t, "fixture-materialization-1", out["materialization_key"])
	require.Len(t, asList(t, out["aggregates"]), 2, "a retained complete batch's rollups still serve")

	fresh := f.getJSON(t, "/v1/batches/"+strconv.FormatInt(newID, 10), "/v1/batches/{id}")
	require.Equal(t, "newest_servable", fresh["servability"])
}

// TestBatchPermalinkPrunedIdIsARetentionDisclosure: 404 states RETENTION —
// never "no such materialization".
func TestBatchPermalinkPrunedIdIsARetentionDisclosure(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getStatusJSON(t, "/v1/batches/999999999", "/v1/batches/{id}", http.StatusNotFound)
	errObj := asMap(t, out["error"])
	require.Equal(t, "not_found", errObj["code"])
	require.Contains(t, errObj["message"], "retention", "the 404 DISCLOSES retention")
	require.Contains(t, errObj["message"], "never a claim that the materialization did not happen")
}

// TestBatchPermalinkIncompleteBatchWithholdsAggregates: a batch whose row
// exists but fails the completeness predicate serves `unservable_incomplete`
// with NULL aggregates — a torn batch's rollup is exactly the
// plausible-looking number this surface must not serve.
func TestBatchPermalinkIncompleteBatchWithholdsAggregates(t *testing.T) {
	f := newP5Fixture(t)

	// Tear the batch the way only a bad restore can: the declared position
	// count no longer matches the actual children.
	_, err := f.admin.Exec(f.ctx,
		`UPDATE risk_batches SET position_count = position_count + 1 WHERE id = $1`, f.batchID)
	require.NoError(t, err)

	out := f.getJSON(t, "/v1/batches/"+strconv.FormatInt(f.batchID, 10), "/v1/batches/{id}")
	require.Equal(t, "unservable_incomplete", out["servability"])
	require.Nil(t, out["aggregates"], "WITHHELD (null), never an empty list and never a torn rollup")
	require.Contains(t, out["servability_note"], "completeness predicate")
	// The identity itself still serves: the row exists and its key is a fact.
	require.Equal(t, "fixture-materialization-1", out["materialization_key"])
}

func TestBatchPermalinkWithheldEngineAggregateIsRefusedNeverZero(t *testing.T) {
	f := newP5Fixture(t)
	f.seedWithheldBatch(t, "withheld-permalink-1", false)

	// The withheld batch is now the newest servable one; resolve it by id.
	out := f.getJSON(t, "/v1/evidence", "/v1/evidence")
	id := asMap(t, out["substrate"])["batch_id"].(float64)

	permalink := f.getJSON(t, "/v1/batches/"+strconv.Itoa(int(id)), "/v1/batches/{id}")
	aggs := asList(t, permalink["aggregates"])
	byEngine := map[string]map[string]any{}
	for _, a := range aggs {
		m := asMap(t, a)
		byEngine[m["engine"].(string)] = m
	}
	aave := byEngine["aave_v3_etherfi"]
	require.NotNil(t, aave["refusal"], "the withheld engine's refusal is NAMED on the aggregate")
	require.Equal(t, "FLAG_CUSTODY_UNPROVEN", asMap(t, aave["refusal"])["code"])
	require.Nil(t, aave["total_collateral"], "persisted zeros under a refusal mean WITHHELD — null, never 0")
	require.Nil(t, aave["total_debt"])
	require.Nil(t, aave["liquidatable_positions"])
	dm := byEngine["debt_manager"]
	require.NotNil(t, dm["total_debt"], "the other engine serves normally")
}

func TestBatchPermalinkParameterRefusals(t *testing.T) {
	f := newP5Fixture(t)
	for name, path := range map[string]string{
		"zero id":     "/v1/batches/0",
		"negative id": "/v1/batches/-3",
		"non-integer": "/v1/batches/abc",
	} {
		out := f.getStatusJSON(t, path, "/v1/batches/{id}", http.StatusBadRequest)
		require.Equal(t, "bad_request", asMap(t, out["error"])["code"], name)
	}
}

// ---------------------------------------------------------------------------
// GET /v1/evidence — the two-subject split.
// ---------------------------------------------------------------------------

// TestEvidenceTwoSubjectsSplit: the proof subject's wire status IS the
// receipt's own strict conjunction (re-derived here from the served receipt
// fields — the weld a consumer is told to run), and the live subject is
// operational unconditionally, referencing the substrate identity.
func TestEvidenceTwoSubjectsSplit(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/evidence", "/v1/evidence")

	proof := asMap(t, out["proof_subject"])
	require.Equal(t, "accepted", proof["status"], "the committed receipt is an unqualified pass")
	require.Equal(t, "", proof["detail"])
	rec := asMap(t, out["reconcile"])
	require.Equal(t, rec["comparison_sha256"], proof["pin"], "the pin IS the receipt's own comparison sha")

	// THE CONSUMER'S WELD: the wire status must equal the conjunction over
	// the served receipt fields. A server that laundered a qualified receipt
	// into "accepted" fails here.
	conjunction := rec["result"] == "pass" &&
		rec["exit_code"] == float64(0) &&
		rec["gated_drift"] == float64(0) &&
		rec["gated_exact"] == rec["gated_rows"]
	for _, wd := range asList(t, rec["welds"]) {
		m := asMap(t, wd)
		conjunction = conjunction && m["rows_exact"] == m["rows_compared"]
	}
	require.True(t, conjunction)
	require.Equal(t, "accepted", proof["status"], "wire status and derived conjunction agree")

	live := asMap(t, out["live_subject"])
	require.Equal(t, "serving", live["status"])
	require.Equal(t, "", live["reason"])
	require.NotNil(t, out["substrate"], "the live subject's identity is the substrate ref")
}

// TestEvidenceProofSubjectNeverLaundersAReceipt: the conjunction is strict —
// an absent receipt is `unavailable` with the reason, and an INTERNALLY
// INCONSISTENT receipt (a "pass" wearing drift, a short weld) is `rejected`
// naming the violated conjunct, never promoted to a proof.
func TestEvidenceProofSubjectNeverLaundersAReceipt(t *testing.T) {
	f := newP5Fixture(t)

	// Absent receipt → unavailable, with the stated reason, on the wire.
	ev, err := loadEvidenceStatics("../..", "recon/feeds.json", "roadmap/evidence/artifacts/does-not-exist.json")
	require.NoError(t, err)
	f.srv.evidence = ev
	out := f.getJSON(t, "/v1/evidence", "/v1/evidence")
	proof := asMap(t, out["proof_subject"])
	require.Equal(t, "unavailable", proof["status"])
	require.Contains(t, proof["detail"], "no committed reconcile receipt")
	require.Nil(t, proof["pin"], "no receipt, no pin — never fabricated")

	// A doctored receipt: verdict "pass" carrying gated drift. The summary is
	// contract-plausible; only the conjunction catches it.
	dir := t.TempDir()
	doctored := `{
		"schema": "solvent.reconcile.drift-report/v1",
		"summary": {"result": "pass", "totals": {"gated_rows": 87, "gated_exact": 86, "gated_drift": 1, "advisory_rows": 0}},
		"run": {"finished_at": "2026-07-29T02:14:07Z"},
		"comparison_sha256": "5f0b3e2a4c1d99e21b7a30e12cf5a2b9a4a7c1de00b53219a6f2f41c86a77025",
		"aave_rows": [], "dm_rows": []
	}`
	require.NoError(t, os.WriteFile(filepath.Join(dir, "doctored.json"), []byte(doctored), 0o600))
	rec, reason := loadReconcileSummary(dir, "doctored.json")
	require.NotNil(t, rec, "the doctored artifact parses — only the conjunction can refuse it")
	require.Empty(t, reason)
	ev2 := ev
	ev2.Reconcile, ev2.ReconcileUnavailable = rec, ""
	f.srv.evidence = ev2
	out = f.getJSON(t, "/v1/evidence", "/v1/evidence")
	proof = asMap(t, out["proof_subject"])
	require.Equal(t, "rejected", proof["status"], "a pass wearing drift is REJECTED, never laundered into a proof")
	require.Contains(t, proof["detail"], "drift 1", "the violated conjunct is NAMED")
	require.NotNil(t, proof["pin"], "the rejected receipt still has a pin — identity is not withheld, exactness is")
}

// TestEvidenceLiveSubjectNoBatchIsAFirstClassState: with no servable batch
// the live subject states `no_batch` with the substrate's reason — and the
// proof subject is UNAFFECTED: the split means neither subject's state ever
// leaks into the other.
func TestEvidenceLiveSubjectNoBatchIsAFirstClassState(t *testing.T) {
	f := newP5Fixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches RESTART IDENTITY CASCADE`)
	require.NoError(t, err)

	out := f.getJSON(t, "/v1/evidence", "/v1/evidence")
	live := asMap(t, out["live_subject"])
	require.Equal(t, "no_batch", live["status"])
	require.Contains(t, live["reason"], "no complete risk batch")
	require.Equal(t, "accepted", asMap(t, out["proof_subject"])["status"],
		"the proof subject speaks for its pin regardless of what is serving now")
}
