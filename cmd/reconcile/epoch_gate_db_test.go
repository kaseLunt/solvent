// Exit finding H1 (whole-branch Codex exit review): reconcile must never
// certify derived state while a reorg epoch is unacknowledged. A raw rewind
// deletes logs, lowers ingest cursors and records a chain-wide epoch in ONE
// transaction (store.Rewind); the derive writer refuses to advance until the
// engine acks (store.ApplyDerivedWithRates); but the derive CURSOR itself is
// unchanged in the walker-commit→runner-ack window — durable when a crash
// lands between — and reconcile pins from that cursor. These tests prove the
// snapshot-time gate against a REAL database: (a) an unacked epoch at
// snapshot time is a RETRYABLE refusal (store.ErrUnackedReorgEpoch → exit 3,
// stale-evidence class), never a silent pass and never a permanent fail;
// (b) an acked epoch passes the gate. Leg (c) — the end-of-run movement
// check still firing on an ack change mid-run — stays a pure-function test
// (TestRewindMovedIsPruneImmune), which also covers the recheck's new MAX
// leg for the epoch-recorded-mid-run-but-unacked case.
package main

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// epochGateSetup derives the package-exclusive epoch-gate database, resets
// the two gate-bearing tables (idempotent across runs — the epoch BIGSERIAL
// keeps counting, which the tests never assume away) and seeds one
// debt_manager cursor: chain 10, last_block 1000, acked_epoch 0. Returns the
// RO DSN Collect uses, an admin connection for seeding, and the minimal
// config Collect needs to bind the engine to its chain.
func epochGateSetup(t *testing.T, ctx context.Context) (string, *pgx.Conn, *config.Config) {
	t.Helper()
	dsn := ensureDerivedDB(t, ctx, gateTestBaseDSN(t), "_reconepoch")
	roDSN, err := readOnlyDSN(dsn)
	require.NoError(t, err)
	admin, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() { admin.Close(context.Background()) })
	_, err = admin.Exec(ctx, `DELETE FROM reorg_epochs`)
	require.NoError(t, err)
	_, err = admin.Exec(ctx, `DELETE FROM derive_cursors`)
	require.NoError(t, err)
	_, err = admin.Exec(ctx,
		`INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch)
		 VALUES ($1, 10, 1000, 0)`, snapshotdb.DMEngine)
	require.NoError(t, err)
	cfg := &config.Config{
		Chains:  map[string]config.Chain{"op": {ChainID: 10}},
		Streams: []config.Stream{{Name: "op:dm", Chain: "op", Engine: snapshotdb.DMEngine}},
	}
	return roDSN, admin, cfg
}

// TestSnapshotGateRefusesUnackedReorgEpoch is leg (a): a reorg epoch the
// pinned engine has not acknowledged, present INSIDE the repeatable-read
// snapshot, refuses the run — as store.ErrUnackedReorgEpoch from Collect,
// classified RETRYABLE (exit 3) by runPhase1. This is exactly the
// walker-rewound-but-runner-not-yet-acked window: the derive cursor still
// reads 1000, so pin resolution alone would happily certify state the raw
// layer already invalidated.
func TestSnapshotGateRefusesUnackedReorgEpoch(t *testing.T) {
	ctx := context.Background()
	roDSN, admin, cfg := epochGateSetup(t, ctx)

	// The walker's rewind: a chain-10 epoch lands; the engine's ack (0) is
	// below it.
	_, err := admin.Exec(ctx, `INSERT INTO reorg_epochs (chain_id, rewound_to) VALUES (10, 900)`)
	require.NoError(t, err)

	_, err = snapshotdb.Collect(ctx, snapshotdb.Params{}, cfg, roDSN, snapshotdb.GoldenSpec{}, true, false, nil)
	require.Error(t, err, "an unacked epoch must refuse the snapshot — never a silent pass")
	require.ErrorIs(t, err, store.ErrUnackedReorgEpoch)

	// The harness classifies the refusal RETRYABLE (exit 3, stale-evidence
	// class) — never precondition (permanent) and never a verdict.
	_, err = runPhase1(ctx, &options{}, cfg, roDSN, goldenVectors{}, true, false, nil, nil)
	require.Error(t, err)
	var a *runAbort
	require.ErrorAs(t, err, &a, "the refusal must be a classified abort, not a bare error")
	require.Equal(t, exitRetryable, a.code, "unacked epoch = retryable: the daemon's next Step acks and re-derives")
	require.ErrorContains(t, err, "unacknowledged reorg epoch")
}

// TestSnapshotGatePassesWhenEpochAcked is leg (b): the same epoch, acked
// (acked_epoch = chain max — what RewindDerived writes), passes the gate and
// the snapshot commits, pinning from the cursor as before.
func TestSnapshotGatePassesWhenEpochAcked(t *testing.T) {
	ctx := context.Background()
	roDSN, admin, cfg := epochGateSetup(t, ctx)

	_, err := admin.Exec(ctx, `INSERT INTO reorg_epochs (chain_id, rewound_to) VALUES (10, 900)`)
	require.NoError(t, err)
	// The runner's ack: acked_epoch = MAX(epoch) on the chain.
	_, err = admin.Exec(ctx,
		`UPDATE derive_cursors
		 SET acked_epoch = (SELECT COALESCE(MAX(epoch), 0) FROM reorg_epochs WHERE chain_id = 10)
		 WHERE engine = $1`, snapshotdb.DMEngine)
	require.NoError(t, err)

	snap, err := snapshotdb.Collect(ctx, snapshotdb.Params{}, cfg, roDSN, snapshotdb.GoldenSpec{}, true, false, nil)
	require.NoError(t, err, "an ACKED epoch is consistent state — the gate must not refuse it")
	require.Equal(t, uint64(1000), snap.Pins[snapshotdb.DMEngine])
}

// TestRecheckStateIsOneSnapshot is the re-verification round's choreography
// regression (session 019fa68e; test shape per the closing round 019fa6a1 —
// the interleaving must be driven through the PRODUCTION helper, not a
// manual replica, so unwiring readRecheckState fails this test). Mechanics:
// a writer transaction takes ACCESS EXCLUSIVE on reorg_epochs; the helper
// runs concurrently — its cursor read establishes the RR snapshot (epoch
// present, unacked), then its MAX query BLOCKS on the lock; the writer
// acks, lowers the cursor below the pin, prunes the epoch, and commits,
// releasing the helper. A single-snapshot helper returns the coherent
// pre-ack pair and rewindMoved convicts; an autocommit implementation would
// read the pruned MAX after release and pass silently.
func TestRecheckStateIsOneSnapshot(t *testing.T) {
	ctx := context.Background()
	roDSN, admin, _ := epochGateSetup(t, ctx)

	// Baseline as Phase 1 recorded it: cursor 1000, acked 0, no epochs.
	baseline := snapshotdb.RewindBaseline{
		AckedEpoch: map[string]int64{snapshotdb.DMEngine: 0},
		LastBlock:  map[string]uint64{snapshotdb.DMEngine: 1000},
	}
	pins := map[string]uint64{snapshotdb.DMEngine: 1000}

	// The reorg lands AFTER phase 1: epoch recorded, not yet acked.
	_, err := admin.Exec(ctx, `INSERT INTO reorg_epochs (chain_id, rewound_to) VALUES (10, 900)`)
	require.NoError(t, err)

	fresh, err := pgx.Connect(ctx, roDSN)
	require.NoError(t, err)
	defer fresh.Close(context.Background())

	// Writer holds the epoch table so the helper's SECOND read must block.
	writerTx, err := admin.Begin(ctx)
	require.NoError(t, err)
	defer writerTx.Rollback(ctx)
	_, err = writerTx.Exec(ctx, `LOCK TABLE reorg_epochs IN ACCESS EXCLUSIVE MODE`)
	require.NoError(t, err)

	// The PRODUCTION helper, concurrently: cursor read proceeds (snapshot
	// established), MAX read parks on the writer's lock.
	type recheckResult struct {
		cursors []store.DeriveCursorState
		max     map[int64]int64
		err     error
	}
	resCh := make(chan recheckResult, 1)
	go func() {
		cursors, maxEpochs, err := readRecheckState(ctx, fresh)
		resCh <- recheckResult{cursors, maxEpochs, err}
	}()

	// Deterministic rendezvous: wait until the helper's epoch read is
	// visibly lock-waiting (bounded), via an independent connection.
	poll, err := pgx.Connect(ctx, roDSN)
	require.NoError(t, err)
	defer poll.Close(context.Background())
	blocked := false
	for range 100 { // ~5s bound
		var n int
		err = poll.QueryRow(ctx,
			`SELECT count(*) FROM pg_stat_activity
			 WHERE wait_event_type = 'Lock' AND query ILIKE '%reorg_epochs%'`).Scan(&n)
		require.NoError(t, err)
		if n >= 1 {
			blocked = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	require.True(t, blocked, "the helper's MAX read must park on the writer's lock")

	// The daemon's next pass, in full, between the helper's two reads: ack,
	// lower the cursor below the pin, prune the epoch — then release.
	_, err = writerTx.Exec(ctx,
		`UPDATE derive_cursors SET acked_epoch = (SELECT MAX(epoch) FROM reorg_epochs WHERE chain_id = 10),
		 last_block = 900 WHERE engine = $1`, snapshotdb.DMEngine)
	require.NoError(t, err)
	_, err = writerTx.Exec(ctx, `DELETE FROM reorg_epochs WHERE chain_id = 10`)
	require.NoError(t, err)
	require.NoError(t, writerTx.Commit(ctx))

	res := <-resCh
	require.NoError(t, res.err)

	// The helper's RR snapshot predates the interleaving: pre-ack cursors
	// WITH the pre-prune epoch — the MAX leg convicts. An autocommit
	// implementation returns the pruned (empty) MAX here and stays silent.
	reasons := rewindMoved(baseline, res.cursors, pins, res.max)
	require.NotEmpty(t, reasons, "the production helper's pair must convict the mid-recheck ack+prune")

	// And on a quiescent database readRecheckState itself returns the same
	// pair a direct read does — the wiring leg.
	gotCursors, gotMax, err := readRecheckState(ctx, fresh)
	require.NoError(t, err)
	directCursors, err := store.DeriveCursorStates(ctx, fresh)
	require.NoError(t, err)
	directMax, err := store.MaxReorgEpochs(ctx, fresh)
	require.NoError(t, err)
	require.Equal(t, directCursors, gotCursors)
	require.Equal(t, directMax, gotMax)
}
