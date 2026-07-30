package store

// Live upgrade-path test for migration 00006 (the health/readiness wave's
// last_success_at column) from the CURRENT PUSHED BASELINE, version 5.
//
// The whole risk of this migration is in ONE predicate. snapshot_sweeps rows at v5
// carry a last_success_block and an updated_at, and the new column has to be
// populated from them without ever claiming a collateral read happened when it did
// not. There are exactly two pre-existing shapes and they must be treated
// differently:
//
//	success rows      updated_at IS the time that success landed (ApplySweepBatch
//	                  stamps both in one statement), so it backfills honestly;
//	failed rows       updated_at is the time of the FAILURE. A row that succeeded in
//	                  an earlier generation and then failed still carries
//	                  last_success_block > 0, and copying its updated_at would date
//	                  that account's collateral to a moment no collateral was read —
//	                  certifying as fresh precisely the accounts most likely stale.
//	                  These stay NULL, and NULL counts as STALE.
//
// A backfill missing the status predicate passes every "no data loss" check and
// still greens the gate, which is why this test asserts the NULL and the resulting
// COUNT rather than only the column's existence.
//
// The baseline is reconstructed with goose's UpTo against the SAME embedded
// migration set store.Migrate uses, inside a scratch schema pinned via the DSN's
// search_path — fully isolated from the suite's main schema.

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrateUpgradesV5SweepBaselineFailClosed(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v5_sweeps"
	engine := "debt_manager"
	// won: succeeded and stayed successful. lost: succeeded once (block 120) and
	// then FAILED — the row whose updated_at must not be mistaken for a success
	// time. never: attempted and never succeeded at all.
	won, lost, never := addr20(0xA1), addr20(0xA2), addr20(0xA3)

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

	// (a) The pushed v5 baseline, and proof it truly IS that baseline — the guard
	// against 00006's shapes creeping into an already-applied migration, which is
	// the process failure 00004 exists to remember.
	require.NoError(t, migrateUpTo(ctx, scratch, 5))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'snapshot_sweeps' AND column_name = 'last_success_at'`,
		schema).Scan(&n))
	require.Zero(t, n, "the v5 baseline must NOT carry last_success_at")

	// (b) Pre-existing v5 data in the three shapes above, with DISTINCT updated_at
	// values so the backfill's source is identifiable in the result.
	seedDerivedPre00014(t, s, engine, 10, []PositionEvent{
		{ChainID: 10, Engine: engine, Account: won, Asset: addr20(0xC0), Side: "debt",
			EventType: "borrow", Delta: big.NewInt(1), BlockNumber: 100, TxHash: hash32(0xD0), LogIndex: 0},
		{ChainID: 10, Engine: engine, Account: lost, Asset: addr20(0xC0), Side: "debt",
			EventType: "borrow", Delta: big.NewInt(1), BlockNumber: 101, TxHash: hash32(0xD1), LogIndex: 1},
		{ChainID: 10, Engine: engine, Account: never, Asset: addr20(0xC0), Side: "debt",
			EventType: "borrow", Delta: big.NewInt(1), BlockNumber: 102, TxHash: hash32(0xD2), LogIndex: 2},
	}, nil, 200)
	wonAt := time.Now().Add(-90 * time.Minute).UTC().Truncate(time.Second)
	lostAt := time.Now().Add(-3 * time.Minute).UTC().Truncate(time.Second)
	_, err = s.pool.Exec(ctx, `INSERT INTO snapshot_sweeps
		(engine, account, generation, last_attempt_block, last_success_block, status, attempts, updated_at) VALUES
		($1, $2, 4, 300, 300, 'success', 1, $5),
		($1, $3, 4, 310, 120, 'failed',  4, $6),
		($1, $4, 4, 320, 0,   'failed',  4, $6)`,
		engine, won, lost, never, wonAt, lostAt)
	require.NoError(t, err)
	// The generation those rows belong to, closed: a v5 database that has run at
	// least one sweep necessarily has this row, and SweepProgress reports
	// found=false without it.
	_, err = s.pool.Exec(ctx, `INSERT INTO sweep_generations (engine, current_generation, opened_at, completed_at)
		VALUES ($1, 4, $2, $3)`, engine, wonAt.Add(-10*time.Minute), lostAt)
	require.NoError(t, err)

	// (c) The forward upgrade — the production entry point, exactly as a restarted
	// indexer at the new code would run it. (The daemon runs Migrate at startup, so
	// an old database meeting a new binary self-heals before the first round.)
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00006 must land on top of the v5 baseline")

	// (d) THE BACKFILL PREDICATE. A success dates from its own updated_at; a failure
	// — even one carrying an earlier success BLOCK — stays NULL.
	readStamp := func(account []byte) (*time.Time, uint64) {
		var at *time.Time
		var block uint64
		require.NoError(t, s.pool.QueryRow(ctx,
			`SELECT last_success_at, last_success_block FROM snapshot_sweeps WHERE engine = $1 AND account = $2`,
			engine, account).Scan(&at, &block))
		return at, block
	}
	at, block := readStamp(won)
	require.NotNil(t, at, "a success row backfills from its own updated_at")
	require.Equal(t, wonAt, at.UTC().Truncate(time.Second))
	require.EqualValues(t, 300, block, "and no block stamp is disturbed")

	at, block = readStamp(lost)
	require.Nil(t, at,
		"a FAILED row keeps NULL even though it carries an earlier success block: its updated_at is the time of the failure, and copying it would date collateral to a moment none was read")
	require.EqualValues(t, 120, block, "the earlier success block itself survives untouched")

	at, block = readStamp(never)
	require.Nil(t, at)
	require.Zero(t, block)

	// (e) NULL IS STALE, which is what makes the omission of the predicate a
	// green-the-gate defect rather than a cosmetic one. Reading the upgraded
	// database through the gate's own query: `won` is inside a wide bound, `lost` is
	// stale on the NULL, `never` has no success at all.
	p, found, err := s.SweepProgress(ctx, engine, 4, 24*time.Hour)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, int64(1), p.NeverSucceeded, "the never-succeeded account")
	require.Equal(t, int64(1), p.StaleSuccess,
		"and the NULL-stamped one — a backfill without the status predicate would report 0 here and certify it fresh")

	// (f) Every sweep operation still functions on the upgraded schema, and a
	// landed success clears that account's staleness through the real write path.
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	batch, err := s.SweepWorkBatch(ctx, engine, gen, 4, 10)
	require.NoError(t, err)
	require.Len(t, batch, 3, "a new generation re-lags every registry account")
	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 400, []SweepResult{
		{Account: lost, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))
	p, _, err = s.SweepProgress(ctx, engine, 4, 24*time.Hour)
	require.NoError(t, err)
	require.Zero(t, p.StaleSuccess, "the NULL stamp is replaced by a real one the moment that account succeeds")
	require.Equal(t, int64(1), p.NeverSucceeded, "and the account that never succeeded is untouched by it")
}
