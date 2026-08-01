package main

// Wave H8 — the shape-sibling of the batch permalink's H6b finding, promoted
// from H6b's report-only survey: readBatchAccounts resolved the newest
// complete batch on the POOL and only then opened BeginRiskSnapshot for the
// child reads. Batches are PRUNABLE, so a retention prune landing between
// those two statements deleted the resolved batch, and every child read then
// returned EMPTY without error — positions, aggregates, params — the
// stamped-engine check passed VACUOUSLY over zero rows, and /v1/book and
// /v1/address served an apparently-successful empty book. The fix mirrors
// H6b's handleBatch remedy exactly: batch resolution moves INSIDE the one
// REPEATABLE READ snapshot (store.NewestCompleteBatchQ), plus a fail-closed
// cardinality refusal for the state no snapshot can repair (a hand-written
// or torn "complete" batch with zero aggregate rows or an empty watermark
// vector). Position-count zero stays LEGAL: an honest empty book has
// aggregates saying so — cardinality here means aggregates/stamps, exactly
// as H6b ruled for the permalink.
//
// The interleave is injected through the `bookInterleave` seam — the same
// atomic, nil-in-production shape as `batchInterleave` — because the race
// window is a few milliseconds wide and a sleep-based test would be both
// flaky and dishonest about what it proves.
//
// MUTATION SPEC (written BEFORE the loop; transcript at
// testdata/mutation-transcripts/wave-h8.md): M1 moves the batch resolution
// back to the pool while KEEPING the cardinality refusal — killed by
// TestBookSurvivesARetentionPruneInterleave alone. M2 drops the cardinality
// refusal while KEEPING the in-snapshot resolution — killed by
// TestBookRefusesACompleteBatchWithNoAggregates alone, proving each defense
// is load-bearing and neither shadows the other.

import (
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// TestBookSurvivesARetentionPruneInterleave prunes the resolved batch BETWEEN
// readBatchAccounts' batch resolution and its child reads — the exact
// interleaving of the finding — and requires the answer to speak entirely
// from one database instant: either the resolved batch serves WHOLE (snapshot
// isolation pins its rows) or the read honestly resolves the next-newest
// batch / errNoBatch — never an empty book with a 200.
func TestBookSurvivesARetentionPruneInterleave(t *testing.T) {
	f := newAPIFixture(t)
	oldID := f.batchID
	newID := f.seedBatch(t, "fixture-materialization-2")
	require.Greater(t, newID, oldID,
		"the NEWEST batch is the one readBatchAccounts resolves — and the one the mid-request prune takes")

	// Arm the seam: mid-request, the prune lands on the resolved id — the
	// same statement shape WriteRiskBatch's retention prune runs (a DELETE on
	// risk_batches; every child row goes with ON DELETE CASCADE).
	var pruned atomic.Bool
	f.srv.bookInterleave = &atomic.Pointer[func()]{}
	hook := func() {
		_, err := f.admin.Exec(f.ctx, `DELETE FROM risk_batches WHERE id = $1`, newID)
		require.NoError(t, err)
		pruned.Store(true)
	}
	f.srv.bookInterleave.Store(&hook)
	defer f.srv.bookInterleave.Store(nil)

	out := f.getJSON(t, "/v1/book", "/v1/book")
	require.True(t, pruned.Load(), "the interleave must actually have fired mid-request, or this test raced nothing")

	// The full answer, from the request's own snapshot: the resolved batch,
	// WHOLE — both engines' persisted rollups with their exact values (not
	// merely "non-empty", because a partial read would be the same lie
	// smaller), the sweep stamp from the batch's own vector, and every
	// position row. An empty `engines` here is the H8 wrong answer —
	// contract-legal, and wrong.
	require.Equal(t, float64(newID), asMap(t, out["batch"])["id"],
		"the request that began before the prune serves the batch it resolved")
	engines := asList(t, out["engines"])
	require.Len(t, engines, 2,
		"a complete batch serves its WHOLE book: an empty or partial engines list is the vacuous empty-book serve")
	byEngine := map[string]map[string]any{}
	for _, e := range engines {
		m := asMap(t, e)
		byEngine[m["engine"].(string)] = m
	}
	require.Equal(t, fxAaveCollateralBase, byEngine["aave_v3_etherfi"]["total_collateral"],
		"the batch's own persisted rollup, verbatim, from the pre-prune snapshot")
	require.Equal(t, fxDMBorrowings, byEngine["debt_manager"]["total_debt"])
	sw := asMap(t, byEngine["debt_manager"]["sweep"])
	require.Equal(t, float64(3), sw["rows"],
		"the watermark vector is read inside the same snapshot: the sweep stamp serves even though the row is gone underneath")
	cov := asMap(t, out["coverage"])
	require.Equal(t, float64(4), cov["batch_positions"],
		"the position rows read inside the same snapshot — the vacuous serve carried zero")

	// And the prune really happened: the row is gone, so the NEXT request
	// honestly resolves the next-newest complete batch — pin truth for the
	// request that started before the prune, the surviving batch for the one
	// after.
	var n int
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`SELECT count(*) FROM risk_batches WHERE id = $1`, newID).Scan(&n))
	require.Zero(t, n, "the mid-request DELETE must have committed, or the snapshot proved nothing")
	after := f.getJSON(t, "/v1/book", "/v1/book")
	require.Equal(t, float64(oldID), asMap(t, after["batch"])["id"],
		"the next request serves the next-newest complete batch — never the pruned id, never an empty book")
}

// TestBookRefusesACompleteBatchWithNoAggregates is the fail-closed half (and
// the M2 kill): a batch that PASSES the store's completeness predicate while
// carrying ZERO aggregate rows — its declared cardinalities all zero and
// matched, its required engines stamped with a full sweep payload — is a
// state WriteRiskBatch cannot produce but a restore or a hand-write can.
// Serving it as an empty `engines` list publishes "a complete book with
// nothing in it", which nothing in the store backs; every readBatchAccounts
// surface must refuse instead.
func TestBookRefusesACompleteBatchWithNoAggregates(t *testing.T) {
	f := newAPIFixture(t)

	var id int64
	require.NoError(t, f.admin.QueryRow(f.ctx, `INSERT INTO risk_batches
		(status, position_count, leg_count, price_input_count, aggregate_count,
		 refused_count, flagged_count, producer, materialization_key, substrate_digest,
		 required_engines, required_sweep_engines)
		VALUES ('complete', 0, 0, 0, 0, 0, 0, 'hand-restore', 'restore-zero-aggs-h8', '',
		        '{debt_manager}', '{debt_manager}')
		RETURNING id`).Scan(&id))
	_, err := f.admin.Exec(f.ctx, `INSERT INTO risk_batch_watermarks
		(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
		 sweep_rows, sweep_failed, sweep_success_sum, sweep_max_updated_at,
		 sweep_generation, sweep_generation_open, sweep_applicable)
		VALUES ($1, 'debt_manager', 10, 154796552, 9, 9, 2, 1, 309580000, now(), 3, false, true)`, id)
	require.NoError(t, err)

	// Prove the trap is armed TWICE over: the hand-written batch passes the
	// ONE completeness authority, and it is the NEWEST such batch — the very
	// one readBatchAccounts resolves. Without these lines a future predicate
	// change (or a fixture batch landing above it) would turn the refusal
	// below into an ordinary serve of the fixture batch and this regression
	// would green while testing nothing.
	ids, err := store.CompleteBatchIDs(f.ctx, f.store.Querier(), 10)
	require.NoError(t, err)
	require.Contains(t, ids, id,
		"the hand-written batch must pass the completeness predicate, or this regression tests nothing")
	require.Equal(t, id, ids[0],
		"the hand-written batch must be the NEWEST complete batch — the one readBatchAccounts serves")

	out := f.getStatusJSON(t, "/v1/book", "/v1/book", http.StatusInternalServerError)
	msg := asMap(t, out["error"])["message"].(string)
	require.Contains(t, msg, "no aggregate rows",
		"the refusal names the defect: a complete batch with an empty rollup set is refused, never served as an empty healthy book")
	require.Contains(t, msg, strconv.FormatInt(id, 10),
		"the refusal names the batch, so an operator can find the torn row")
}
