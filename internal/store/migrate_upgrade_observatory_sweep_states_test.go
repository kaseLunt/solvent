package store

// Live upgrade-path test for migration 00019 (wave H6b, Codex round-5
// finding 3): the 00018 CHECK on observatory_points admits an ILLEGAL FOURTH
// STATE. PostgreSQL CHECK constraints accept UNKNOWN, and 00018's second and
// third disjuncts are spelled over a bare `sweep_applicable` — so a row with
// `sweep_applicable = NULL` and a POPULATED stamp payload evaluates
// false OR UNKNOWN OR false = UNKNOWN and is ADMITTED. The store reader then
// treats the row as UNRECORDED (applicability is NULL) while silently
// ignoring a populated stamp — a schema state the vocabulary has no honest
// word for.
//
// 00018 is already applied to the live database, and the 00003 incident law
// forbids editing an applied migration in place (a scratch DB re-derived from
// the edited file would silently diverge from live). The fix is therefore a
// NEW migration, 00019, that drops and re-adds the constraint with
// `IS TRUE` / `IS FALSE` spellings, under which every disjunct — and hence
// the whole CHECK — is two-valued and the fourth state is REJECTED.
//
// MUTATION SPEC (written BEFORE the loop; transcript at
// testdata/mutation-transcripts/wave-h6b.md):
//
//   M2 (the 00019 constraint reverted to the 00018 form): the re-added CHECK
//      loses its IS TRUE / IS FALSE spellings. Every positive-state assertion
//      below stays green (the three legal states satisfy both forms); KILLED
//      only by the negative assertions of
//      TestMigrate00019RefusesNullApplicabilityWithPopulatedStamp.

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrate00019RefusesNullApplicabilityWithPopulatedStamp(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v18_sweep_states"

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

	// (a) The 00018 baseline, and proof of the DEFECT at that baseline: NULL
	// applicability with a fully populated stamp payload is ADMITTED by the
	// 00018 CHECK (the UNKNOWN pass). This is the vacuous guard under repair —
	// if this insert ever starts failing at v18, 00018 was edited in place,
	// which the 00003 incident law forbids.
	require.NoError(t, migrateUpTo(ctx, scratch, 18))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	updated := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	bucket := func(h int) time.Time {
		return time.Date(2026, 7, 30, h, 0, 0, 0, time.UTC)
	}
	insertPoint := func(bkt time.Time, applicable any, rows, failed, sum, updatedAt, gen, open any) error {
		_, err := s.pool.Exec(ctx, `INSERT INTO observatory_points
			(bucket_start, engine, batch_id, batch_computed_at, materialization_key,
			 chain_id, last_block, acked_epoch, max_epoch_at_compute,
			 value_decimals, positions, computed_positions, refused_positions,
			 flagged_positions, liquidatable_positions, total_collateral, total_debt,
			 sweep_applicable, sweep_rows, sweep_failed, sweep_success_sum,
			 sweep_max_updated_at, sweep_generation, sweep_generation_open)
			VALUES ($1, 'debt_manager', 91, now(), 'mk-91', 10, 154796552, 9, 9,
			        6, 1, 1, 0, 0, 1, 100, 200,
			        $2, $3, $4, $5, $6, $7, $8)`,
			bkt, applicable, rows, failed, sum, updatedAt, gen, open)
		return err
	}

	require.NoError(t, insertPoint(bucket(0), nil, int64(2), int64(1), "309580000", updated, int64(3), false),
		"the 00018 baseline ADMITS the illegal fourth state (CHECK evaluates UNKNOWN) — that admission is the defect 00019 exists to close; if it fails here, 00018 was edited in place")
	// Remove the illegal row again: 00019's ADD CONSTRAINT validates existing
	// rows and must fail loudly on a database that actually holds the fourth
	// state — the honest posture, and not this test's subject.
	_, err = s.pool.Exec(ctx, `DELETE FROM observatory_points WHERE bucket_start = $1`, bucket(0))
	require.NoError(t, err)

	// (b) The forward upgrade — the production entry point.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version)

	// (c) THE NEGATIVE REGRESSIONS — the M2 kills. NULL applicability with any
	// populated stamp payload is the fourth state, and it is REJECTED.
	err = insertPoint(bucket(1), nil, int64(2), int64(1), "309580000", updated, int64(3), false)
	require.Error(t, err,
		"NULL sweep_applicable with a FULLY populated stamp payload must be REJECTED: unrecorded means the record does not exist, and a populated stamp under it is a row the reader would silently misreport as unrecorded")
	require.Contains(t, err.Error(), "observatory_points_sweep_all_or_nothing")

	err = insertPoint(bucket(2), nil, int64(2), nil, nil, nil, nil, nil)
	require.Error(t, err,
		"NULL sweep_applicable with a PARTIALLY populated stamp payload must be REJECTED for the same reason — partial was never a legal shape in ANY state")
	require.Contains(t, err.Error(), "observatory_points_sweep_all_or_nothing")

	// (d) The three legal states still hold — the law demands honesty, not a
	// ban on the column.
	require.NoError(t, insertPoint(bucket(3), nil, nil, nil, nil, nil, nil, nil),
		"UNRECORDED (everything NULL) is legal: pre-00018 points whose batch was pruned")
	require.NoError(t, insertPoint(bucket(4), false, nil, nil, nil, nil, nil, nil),
		"NO SWEEPER (false + all NULL) is legal: the recorded Aave state")
	require.NoError(t, insertPoint(bucket(5), true, int64(2), int64(1), "309580000", updated, int64(3), false),
		"STAMPED (true + full payload) is legal")
	require.NoError(t, insertPoint(bucket(6), true, int64(0), int64(0), "0", nil, int64(3), false),
		"STAMPED with NULL sweep_max_updated_at is legal: a swept engine with zero attempted accounts has no most-recent write (00013's carve-out, preserved verbatim)")

	// (e) And the 00018-era protections did not weaken: an applicable stamp
	// missing a column, and a no-sweeper row carrying one, are still refused.
	err = insertPoint(bucket(7), true, nil, int64(1), "309580000", updated, int64(3), false)
	require.Error(t, err, "STAMPED with a missing payload column is still an uninterpretable partial and still refused")
	require.Contains(t, err.Error(), "observatory_points_sweep_all_or_nothing")
	err = insertPoint(bucket(8), false, int64(2), nil, nil, nil, nil, nil)
	require.Error(t, err, "NO SWEEPER carrying a populated payload column is still refused")
	require.Contains(t, err.Error(), "observatory_points_sweep_all_or_nothing")
}
