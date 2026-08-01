package main

// Codex round-5 finding 2 (wave H6b): the batch permalink read identity,
// servability, aggregates and watermark vectors through SEPARATE pool
// queries, so an honest request for the oldest retained batch could read its
// identity and complete status, race with the next WriteRiskBatch retention
// prune, and then read EMPTY aggregate/vector sets without error — serving a
// supposedly complete retained batch with `aggregates: []`. The contract
// makes that wrong answer look legal (BatchAggregate has no minItems on this
// surface), which is exactly why the fix is structural: ONE repeatable-read
// snapshot for every stage, plus a fail-closed cardinality refusal for the
// state no snapshot can repair (a hand-written or torn "complete" batch with
// zero aggregate rows).
//
// The interleave is injected through the `batchInterleave` seam — the same
// atomic, nil-in-production shape as the SSE suite's `readFailure` — because
// the race window is a few milliseconds wide and a sleep-based test would be
// both flaky and dishonest about what it proves.
//
// MUTATION SPEC (written BEFORE the loop; transcript at
// testdata/mutation-transcripts/wave-h6b.md): M1 drops the cardinality
// refusal while KEEPING the transaction — killed by
// TestBatchPermalinkRefusesACompleteBatchWithNoAggregates alone, proving the
// refusal is load-bearing and not shadowed by the snapshot.

import (
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// TestBatchPermalinkSurvivesARetentionPruneInterleave prunes the requested
// batch BETWEEN the permalink's query stages — the exact interleaving of the
// finding — and requires the answer to speak entirely from the instant the
// request began: the batch was retained and complete then, so its identity
// AND its full rollups serve, never a complete batch with an empty book.
func TestBatchPermalinkSurvivesARetentionPruneInterleave(t *testing.T) {
	f := newP5Fixture(t)
	oldID := f.batchID
	newID := f.seedBatch(t, "fixture-materialization-2")
	require.Greater(t, newID, oldID, "the requested batch must be the OLDER retained one — the row the next retention prune takes")

	// Arm the seam: mid-request, the retention prune lands on the requested
	// id — the same statement shape WriteRiskBatch runs (a DELETE on
	// risk_batches; every child row goes with ON DELETE CASCADE).
	var pruned atomic.Bool
	f.srv.batchInterleave = &atomic.Pointer[func()]{}
	hook := func() {
		_, err := f.admin.Exec(f.ctx, `DELETE FROM risk_batches WHERE id = $1`, oldID)
		require.NoError(t, err)
		pruned.Store(true)
	}
	f.srv.batchInterleave.Store(&hook)
	defer f.srv.batchInterleave.Store(nil)

	out := f.getJSON(t, "/v1/batches/"+strconv.FormatInt(oldID, 10), "/v1/batches/{id}")
	require.True(t, pruned.Load(), "the interleave must actually have fired mid-request, or this test raced nothing")

	// The full answer, from the request's own snapshot: servability as it was,
	// and BOTH engines' rollups with their exact persisted values — not merely
	// "non-empty", because a partial read would be the same lie smaller.
	require.Equal(t, "superseded_retained", out["servability"])
	aggs := asList(t, out["aggregates"])
	require.Len(t, aggs, 2,
		"a complete retained batch serves its WHOLE book: an empty or partial aggregates list here is the finding-2 wrong answer (contract-legal, and wrong)")
	byEngine := map[string]map[string]any{}
	for _, a := range aggs {
		m := asMap(t, a)
		byEngine[m["engine"].(string)] = m
	}
	require.Equal(t, fxAaveCollateralBase, byEngine["aave_v3_etherfi"]["total_collateral"],
		"the batch's own persisted rollup, verbatim, from the pre-prune snapshot")
	require.Equal(t, fxDMBorrowings, byEngine["debt_manager"]["total_debt"])
	sw := asMap(t, byEngine["debt_manager"]["sweep"])
	require.Equal(t, float64(3), sw["rows"],
		"the watermark VECTOR read is inside the same snapshot: the sweep stamp serves even though the row is gone underneath")

	// And the prune really happened: the row is gone, so the NEXT request
	// answers the honest retention 404 — pin truth for the request that
	// started before the prune, retention disclosure for the one after.
	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT count(*) FROM risk_batches WHERE id = $1`, oldID).Scan(&n))
	require.Zero(t, n, "the mid-request DELETE must have committed, or the snapshot proved nothing")
	status, _ := f.get(t, "/v1/batches/"+strconv.FormatInt(oldID, 10))
	require.Equal(t, http.StatusNotFound, status)
}

// TestBatchPermalinkRefusesACompleteBatchWithNoAggregates is the fail-closed
// half (and the M1 kill): a batch that PASSES the store's completeness
// predicate while carrying ZERO aggregate rows — its declared cardinalities
// are all zero and matched, its required engines stamped with a full sweep
// payload — is a state WriteRiskBatch cannot produce but a restore or a
// hand-write can. Serving it as `aggregates: []` publishes "a complete book
// with nothing in it", which nothing in the store backs; the permalink must
// refuse instead.
func TestBatchPermalinkRefusesACompleteBatchWithNoAggregates(t *testing.T) {
	f := newP5Fixture(t)

	var id int64
	require.NoError(t, f.admin.QueryRow(f.ctx, `INSERT INTO risk_batches
		(status, position_count, leg_count, price_input_count, aggregate_count,
		 refused_count, flagged_count, producer, materialization_key, substrate_digest,
		 required_engines, required_sweep_engines)
		VALUES ('complete', 0, 0, 0, 0, 0, 0, 'hand-restore', 'restore-zero-aggs-1', '',
		        '{debt_manager}', '{debt_manager}')
		RETURNING id`).Scan(&id))
	_, err := f.admin.Exec(f.ctx, `INSERT INTO risk_batch_watermarks
		(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
		 sweep_rows, sweep_failed, sweep_success_sum, sweep_max_updated_at,
		 sweep_generation, sweep_generation_open, sweep_applicable)
		VALUES ($1, 'debt_manager', 10, 154796552, 9, 9, 2, 1, 309580000, now(), 3, false, true)`, id)
	require.NoError(t, err)

	// Prove the trap is armed: the batch passes the ONE completeness
	// authority. Without this line, a future predicate change could turn the
	// refusal below into the ordinary unservable_incomplete path and this
	// regression would green while testing nothing.
	ids, err := store.CompleteBatchIDs(f.ctx, f.store.Querier(), 10)
	require.NoError(t, err)
	require.Contains(t, ids, id,
		"the hand-written batch must pass the completeness predicate, or this regression tests nothing")

	out := f.getStatusJSON(t, "/v1/batches/"+strconv.FormatInt(id, 10), "/v1/batches/{id}",
		http.StatusInternalServerError)
	msg := asMap(t, out["error"])["message"].(string)
	require.Contains(t, msg, "no aggregate rows",
		"the refusal names the defect: a complete batch with an empty rollup set is refused, never served as an empty book")
}
