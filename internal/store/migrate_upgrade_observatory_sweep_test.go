package store

// Live upgrade-path test for migration 00018 (wave H5b): a database at the
// 00017 baseline — observatory_points WITHOUT the sweep stamp columns — must
// reach the current schema through store.Migrate with the backfill behaving
// exactly as the migration's header promises:
//
//   * a pre-00018 point whose observed batch is STILL RETAINED backfills the
//     sweep stamp VERBATIM from risk_batch_watermarks (join on
//     batch_id + engine);
//   * a pre-00018 point whose batch was PRUNED stays sweep_applicable NULL —
//     the UNRECORDED state. The record genuinely does not exist, and the
//     migration must not fabricate one.
//
// MUTATION SPEC (written BEFORE the loop; transcript at
// testdata/mutation-transcripts/h5b.md):
//
//   m6 (backfill fabricates instead of NULLing): the migration's backfill
//      sets sweep_applicable = false (or COALESCEs the stamp to zeros) for
//      points whose batch is pruned, turning "the store cannot know" into
//      the CLAIM "this engine has no sweeper" — for the Debt Manager, whose
//      liquidatable counts are the very numbers this stamp exists to clock,
//      that claim is false. KILLED by
//      TestMigrateBackfillsObservatorySweepFromRetainedBatches, which
//      requires the pruned point's sweep_applicable to be NULL, not false,
//      and every stamp column NULL with it.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrateBackfillsObservatorySweepFromRetainedBatches(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v17_sweep"

	admin, err := Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(admin.Close)
	_, err = admin.pool.Exec(ctx, "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = admin.pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	})
	scratch := scratchSchemaDSN(t, dsn, schema)

	// (a) The 00017 baseline, and proof it IS that baseline: observatory
	// points exist, the sweep columns do not.
	require.NoError(t, migrateUpTo(ctx, scratch, 17))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'observatory_points'
		  AND column_name LIKE 'sweep_%'`, schema).Scan(&n))
	require.Zero(t, n, "the v17 baseline must NOT carry any observatory sweep column")

	// (b) Pre-existing v17 data, written the way a pre-00018 binary wrote it.
	//
	// One RETAINED batch (id 41) with its watermark stamps: the DM engine
	// carries a full sweep payload, the aave engine the recorded no-sweeper
	// state — exactly what riskd persists (migration 00013's all-or-nothing
	// CHECK enforces the shape).
	updated := time.Date(2026, 7, 29, 11, 59, 0, 0, time.UTC)
	_, err = s.pool.Exec(ctx, `INSERT INTO risk_batches
		(id, status, position_count, materialization_key) VALUES (41, 'complete', 0, 'mk-41')`)
	require.NoError(t, err)
	_, err = s.pool.Exec(ctx, `INSERT INTO risk_batch_watermarks
		(batch_id, engine, chain_id, last_block, acked_epoch, max_epoch_at_compute,
		 sweep_rows, sweep_failed, sweep_success_sum, sweep_max_updated_at,
		 sweep_generation, sweep_generation_open, sweep_applicable) VALUES
		(41, 'debt_manager', 10, 154796552, 9, 9, 2, 1, 309580000, $1, 3, false, true),
		(41, 'aave_v3_etherfi', 1, 25635618, 4, 4, NULL, NULL, NULL, NULL, NULL, NULL, false)`,
		updated)
	require.NoError(t, err)

	// Three pre-00018 points: two observed the retained batch 41, one
	// observed batch 40, which retention has since PRUNED (no row exists —
	// 00016 has no FK to risk_batches for exactly this reason).
	h0 := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	h1 := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	insertPoint := func(bucket time.Time, engine string, batchID int64) {
		_, err := s.pool.Exec(ctx, `INSERT INTO observatory_points
			(bucket_start, engine, batch_id, batch_computed_at, materialization_key,
			 chain_id, last_block, acked_epoch, max_epoch_at_compute,
			 value_decimals, positions, computed_positions, refused_positions,
			 flagged_positions, liquidatable_positions, total_collateral, total_debt)
			VALUES ($1, $2, $3, now(), $4, 10, 154796552, 9, 9,
			        6, 1, 1, 0, 0, 1, 100, 200)`,
			bucket, engine, batchID, fmt.Sprintf("mk-%d", batchID))
		require.NoError(t, err)
	}
	insertPoint(h0, "debt_manager", 40) // batch pruned — unrecoverable
	insertPoint(h1, "debt_manager", 41) // batch retained — recoverable
	insertPoint(h1, "aave_v3_etherfi", 41)

	// (c) The forward upgrade — the production entry point.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version)

	// (d) Backfill semantics, all three states.
	type sweepCols struct {
		applicable *bool
		rows       *int64
		failed     *int64
		sum        *string
		updatedAt  *time.Time
		gen        *int64
		open       *bool
	}
	readSweep := func(bucket time.Time, engine string) sweepCols {
		var c sweepCols
		require.NoError(t, s.pool.QueryRow(ctx, `SELECT
			sweep_applicable, sweep_rows, sweep_failed, sweep_success_sum::text,
			sweep_max_updated_at, sweep_generation, sweep_generation_open
			FROM observatory_points WHERE bucket_start = $1 AND engine = $2`, bucket, engine).
			Scan(&c.applicable, &c.rows, &c.failed, &c.sum, &c.updatedAt, &c.gen, &c.open))
		return c
	}

	// The retained DM point: the batch's stamp, verbatim.
	dm := readSweep(h1, "debt_manager")
	require.NotNil(t, dm.applicable, "a recoverable stamp must be RECOVERED — the whole point of the backfill")
	require.True(t, *dm.applicable)
	require.EqualValues(t, 2, *dm.rows)
	require.EqualValues(t, 1, *dm.failed)
	require.Equal(t, "309580000", *dm.sum)
	require.True(t, dm.updatedAt.UTC().Equal(updated))
	require.EqualValues(t, 3, *dm.gen)
	require.False(t, *dm.open)

	// The retained aave point: the RECORDED no-sweeper state.
	aave := readSweep(h1, "aave_v3_etherfi")
	require.NotNil(t, aave.applicable)
	require.False(t, *aave.applicable)
	require.Nil(t, aave.rows)

	// THE PRUNED POINT STAYS NULL — the m6 kill. false here is the
	// fabricated claim "this engine has no sweeper"; zeros here are a
	// fabricated stamp. The store genuinely cannot know, and the schema says
	// so.
	pruned := readSweep(h0, "debt_manager")
	require.Nil(t, pruned.applicable,
		"a pre-00018 point whose batch was pruned has NO sweep record: sweep_applicable must stay NULL (unrecorded), never be backfilled to false (m6 — fabricating a no-sweeper claim)")
	require.Nil(t, pruned.rows)
	require.Nil(t, pruned.failed)
	require.Nil(t, pruned.sum)
	require.Nil(t, pruned.updatedAt)
	require.Nil(t, pruned.gen)
	require.Nil(t, pruned.open)

	// (e) The CHECK holds the line on partial payloads going forward: an
	// applicable stamp missing its columns is refused, exactly as 00013's
	// watermark CHECK refuses it at the source.
	_, err = s.pool.Exec(ctx, `UPDATE observatory_points
		SET sweep_applicable = true WHERE bucket_start = $1 AND engine = 'debt_manager'`, h0)
	require.Error(t, err, "an applicable stamp with NULL columns is uninterpretable and must be refused by the CHECK")
	require.Contains(t, err.Error(), "observatory_points_sweep_all_or_nothing")
}
