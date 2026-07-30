package store

// Live upgrade-path test for migration 00004 (the sweep-durability wave's
// FORWARD migration, replacing the earlier unsafe in-place edit of 00003):
// a database at the pushed 00003 baseline — version 3 recorded WITHOUT
// generation/attempts/sweep_generations and with the three-column snapshots
// PK — must reach the current schema through store.Migrate with no data loss
// and with every sweep operation functional afterwards.
//
// The baseline is reconstructed with goose's UpTo against the SAME embedded
// migration set the production Migrate uses (00003 is restored to its
// as-first-pushed content, so "up to 3" IS the pushed baseline), inside a
// scratch schema pinned via the DSN's search_path — fully isolated from the
// suite's main schema, whose goose version is already current.

import (
	"context"
	"database/sql"
	"math/big"
	"net/url"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// currentSchemaVersion is the highest embedded migration. Bumping it is part of
// adding a migration, and the upgrade-path tests below assert against it so a new
// migration cannot land without its own upgrade proof.
const currentSchemaVersion = 14

// seedDerivedPre00014 writes a derived window the way a PRE-00014 BINARY would:
// raw SQL over the columns that existed before the derivation-coverage columns did.
//
// # Why not just call ApplyDerived, as these tests used to
//
// Because the compiled query layer is written against the CURRENT schema, and that
// is not a defect — production never runs it against an older one (store.Migrate
// runs at startup, and reconcile gates on an exact version match). An upgrade-path
// test that seeds "data the old binary wrote" by calling the NEW writer is
// therefore asserting a backward compatibility nobody promised, and it breaks the
// first time a migration adds a column to a table the writer touches — which
// 00014 does, to derive_cursors.
//
// Seeding the baseline era with era-appropriate SQL is the honest form of the same
// test, and it is already the house pattern beside it: the v5 sweep proof seeds its
// snapshot_sweeps rows with raw INSERTs for exactly this reason. The migration
// assertions that follow are unchanged and now test what they say they test.
//
// It mirrors ApplyDerivedWindow's effects — events, event-sourced balances, rate
// observations, cursor — MINUS any coverage claim, which is precisely the state a
// pre-00014 database is in.
func seedDerivedPre00014(t *testing.T, s *Store, engine string, chainID uint64, events []PositionEvent, rates []RateObservation, throughBlock uint64) {
	t.Helper()
	ctx := context.Background()
	for _, ev := range events {
		payload := ev.Payload
		if payload == nil {
			payload = map[string]string{}
		}
		var deltaParam any
		if ev.Delta != nil {
			deltaParam = pgtype.Numeric{Int: ev.Delta, Exp: 0, Valid: true}
		}
		_, err := s.pool.Exec(ctx, `INSERT INTO position_events
			(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta, payload)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			ev.ChainID, ev.Engine, ev.BlockNumber, ev.TxHash, int32(ev.LogIndex), int32(ev.Seq),
			ev.EventType, ev.Account, ev.Asset, ev.Side, deltaParam, payload)
		require.NoError(t, err)
		if ev.Side == "" || ev.Delta == nil {
			continue // record-only, exactly as the real writer treats it
		}
		_, err = s.pool.Exec(ctx, `INSERT INTO position_balances
			(engine, account, asset, side, source, amount, updated_block)
			VALUES ($1,$2,$3,$4,'event',$5,$6)
			ON CONFLICT (engine, account, asset, side, source) DO UPDATE
			SET amount = position_balances.amount + EXCLUDED.amount,
			    updated_block = GREATEST(position_balances.updated_block, EXCLUDED.updated_block)`,
			ev.Engine, ev.Account, ev.Asset, ev.Side,
			pgtype.Numeric{Int: ev.Delta, Exp: 0, Valid: true}, ev.BlockNumber)
		require.NoError(t, err)
	}
	for _, o := range rates {
		_, err := s.pool.Exec(ctx, `INSERT INTO rate_indexes (engine, asset, block_number, kind, value)
			VALUES ($1,$2,$3,$4,$5) ON CONFLICT (engine, asset, block_number, kind) DO NOTHING`,
			engine, o.Asset, o.Block, o.Kind, pgtype.Numeric{Int: o.Value, Exp: 0, Valid: true})
		require.NoError(t, err)
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,0,now())
		ON CONFLICT (engine) DO UPDATE SET last_block = EXCLUDED.last_block, updated_at = now()`,
		engine, chainID, throughBlock)
	require.NoError(t, err)
}

// migrateUpTo applies the embedded migrations through version — the
// test-only lever that reconstructs a historical schema baseline. Mirrors
// store.Migrate exactly except for goose.UpToContext in place of UpContext.
func migrateUpTo(ctx context.Context, dsn string, version int64) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.UpToContext(ctx, db, "migrations", version)
}

// scratchSchemaDSN pins dsn's sessions to schema via the startup options
// parameter, so every table (goose_db_version included) lives in the scratch
// schema.
func scratchSchemaDSN(t *testing.T, dsn, schema string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	q := u.Query()
	q.Set("options", "-csearch_path="+schema)
	u.RawQuery = q.Encode()
	return u.String()
}

func TestMigrateUpgradesV3BaselineWithoutDataLoss(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v3"
	engine := "debt_manager"
	a1, a2, a3 := []byte{0xA1}, []byte{0xA2}, []byte{0xA3}

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

	// (a) The pushed v3 baseline, and proof it truly IS that baseline (guards
	// the restored 00003 against the edit-in-place regression sneaking back).
	require.NoError(t, migrateUpTo(ctx, scratch, 3))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'snapshot_sweeps'
		  AND column_name IN ('generation', 'attempts')`, schema).Scan(&n))
	require.Zero(t, n, "the v3 baseline must NOT carry generation/attempts — 00003 must stay its as-first-pushed content")
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables
		WHERE table_schema = $1 AND table_name = 'sweep_generations'`, schema).Scan(&n))
	require.Zero(t, n, "sweep_generations must not exist at the v3 baseline")

	// (b) Pre-existing v3 data: sweep status rows in the old five-column
	// shape, history documents (side-marked and legacy), and a derived debt
	// registry.
	_, err = s.pool.Exec(ctx, `INSERT INTO snapshot_sweeps
		(engine, account, last_attempt_block, last_success_block, status)
		VALUES ($1, $2, 120, 120, 'success'), ($1, $3, 130, 0, 'failed')`,
		engine, a1, a2)
	require.NoError(t, err)
	_, err = s.pool.Exec(ctx, `INSERT INTO snapshots (engine, account, block_number, balances) VALUES
		($1, $2, 100, '{"side": "collateral", "balances": {"bb": "5"}}'),
		($1, $2, 90,  '{"side": "debt", "balances": {"bb": "7"}}'),
		($1, $3, 80,  '{"legacy": "pre-side document"}')`,
		engine, a1, a3)
	require.NoError(t, err)
	seedDerivedPre00014(t, s, engine, 10, []PositionEvent{
		pe(50, 1, 0xA1, 0xBB, "debt", 40),
		pe(50, 2, 0xA2, 0xBB, "debt", 10),
	}, nil, 60)

	// (c) The forward upgrade — the production entry point, exactly as a
	// restarted indexer at the new code would run it.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version,
		"every forward migration above the v3 baseline must land, 00004 included")

	// (d) No data loss + backfill semantics: block stamps and status survive;
	// generation backfills to 0 (lagging ANY opened generation — cold-start)
	// and attempts to 0 (fresh retry budget); history sides backfill from the
	// documents' own markers, legacy documents defaulting to 'debt'.
	readSweep := func(account []byte) (gen, attempts, attempt, success uint64, status string) {
		require.NoError(t, s.pool.QueryRow(ctx,
			`SELECT generation, attempts, last_attempt_block, last_success_block, status
			 FROM snapshot_sweeps WHERE engine = $1 AND account = $2`, engine, account).
			Scan(&gen, &attempts, &attempt, &success, &status))
		return
	}
	g, at, attempt, success, status := readSweep(a1)
	require.Equal(t, []uint64{0, 0, 120, 120}, []uint64{g, at, attempt, success})
	require.Equal(t, "success", status)
	g, at, attempt, success, status = readSweep(a2)
	require.Equal(t, []uint64{0, 0, 130, 0}, []uint64{g, at, attempt, success})
	require.Equal(t, "failed", status)

	sideAt := func(account []byte, block uint64) string {
		var side string
		require.NoError(t, s.pool.QueryRow(ctx,
			`SELECT side FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = $3`,
			engine, account, block).Scan(&side))
		return side
	}
	require.Equal(t, "collateral", sideAt(a1, 100))
	require.Equal(t, "debt", sideAt(a1, 90))
	require.Equal(t, "debt", sideAt(a3, 80), "a legacy no-marker document backfills as debt")

	// (e) Every sweep operation functions on the upgraded schema, and the
	// backfilled generation-0 rows LAG the first opened generation (they owe
	// work immediately — no pre-upgrade progress is mistaken for current).
	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, uint64(1), gen)
	work, err := s.SweepWorkBatch(ctx, engine, gen, 4, 100)
	require.NoError(t, err)
	require.Equal(t, [][]byte{a1, a2}, work, "pre-upgrade rows lag generation 1 — cold-start semantics")

	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 200, []SweepResult{
		{Account: a1, OK: true, Balances: map[string]map[string]*big.Int{"bb": {"collateral": big.NewInt(555)}}},
		{Account: a2, OK: false},
	}))
	g, at, attempt, success, status = readSweep(a1)
	require.Equal(t, []uint64{1, 1, 200, 200}, []uint64{g, at, attempt, success})
	require.Equal(t, "success", status)
	require.Equal(t, map[string]string{"bb/collateral": "555@200"},
		balanceRows(t, s, engine, a1, "snapshot"))
	require.Equal(t, "collateral", sideAt(a1, 200), "post-upgrade history rows carry the side key")

	require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 201, []SweepResult{
		{Account: a2, OK: true, Balances: map[string]map[string]*big.Int{}},
	}))
	work, err = s.SweepWorkBatch(ctx, engine, gen, 4, 100)
	require.NoError(t, err)
	require.Empty(t, work)
	failed, stamped, err := s.CompleteSweepGeneration(ctx, engine, gen)
	require.NoError(t, err)
	require.True(t, stamped)
	require.Zero(t, failed)
	genRead, open, completedAt, err := s.SweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Equal(t, uint64(1), genRead)
	require.False(t, open)
	require.False(t, completedAt.IsZero())
}
