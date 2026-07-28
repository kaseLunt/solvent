// Round-13 F2, the DB-backed leg: the PRODUCTION gate wiring — Collect
// entering snapshotdb.Gate right after BeginTx and exiting strictly after
// commit/rollback and connection close — proven against a REAL database,
// never by a test toggling the gate. Wave 13 disclosed exactly this hole
// (deviation 6: "the sentinel's wiring inside collectSnapshot is not
// executed by any test"); round 13 made it binding. Round-14 F2 made the
// ORDERING binding too: the old stacked defers ran Gate.Exit FIRST (LIFO) on
// every post-BeginTx error, and this test could not see it because it
// observed only post-return state — leg 4 below now observes the gate AT the
// rollback, close and post-close checkpoints of the single ordered cleanup,
// while each is provably in progress.
//
// TECHNIQUE (deterministic, no sleeps-as-synchronization): Collect runs in a
// goroutine against a package-private scratch database while a control
// connection holds ACCESS EXCLUSIVE on one of the tables Collect reads —
// derive_cursors is Collect's FIRST in-tx RELATION read (the connected-
// identity read before it touches system functions only, nothing lockable),
// reorg_epochs its LAST — so Collect parks INSIDE the open transaction at a
// chosen point. The test waits for the parked lock to become visible in
// pg_locks (database state, not wall-clock guessing), then asserts the gate
// is closed AND that a real pinnedReader entry point refuses through the
// production check. Releasing the lock lets Collect commit and close;
// cancelling Collect's context while parked exercises the ROLLBACK path.
// Leg 4 additionally engages the Sentinel's lifecycle BARRIERS — delay-only
// bools inside the ordered cleanup (they cannot skip or reorder its steps,
// only stretch them) — and at each parked stage asserts the gate is STILL
// closed against the matching server-side truth in pg_stat_activity: the
// transaction still exists at before-rollback; the connection still exists,
// transactionless, at before-close; and at after-close the gate remains
// closed even though conn.Close has already returned — the gate exits LAST.
// After both paths the gate must be open and Collect's backend gone from
// pg_stat_activity.
package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// gateTestBaseDSN mirrors the house destructive-suite guard (round-10 F1 /
// internal/store's destructiveTestDSN): TEST_DATABASE_URL required — skip in
// dev mode, FATAL in acceptance mode — never the live database, and the
// physical split verified before anything is created.
func gateTestBaseDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("SOLVENT_ACCEPTANCE") == "1" {
			t.Fatal("acceptance mode (SOLVENT_ACCEPTANCE=1): TEST_DATABASE_URL is REQUIRED — a skipped production-gate test can never back suite-green evidence (round-10 F1)")
		}
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it (dev-mode skip — `make test-acceptance` makes this FATAL)")
	}
	if u, err := url.Parse(dsn); err == nil && u.Path == "/solvent" {
		t.Fatalf("TEST_DATABASE_URL points at the LIVE database %q — this test creates and migrates a derived scratch database; point it at the wave scratch DB", u.Path)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := store.VerifyDestructiveSplit(ctx, dsn, os.Getenv("SOLVENT_DATABASE_URL")); err != nil {
		t.Fatalf("destructive-test guard REFUSES to proceed: %v", err)
	}
	return dsn
}

// ensureDerivedDB derives a test-exclusive database ("<scratch><suffix>")
// from the scratch DSN, creates it if missing, and migrates it. A DERIVED
// database, not TEST_DATABASE_URL itself: `go test ./...` runs packages in
// parallel processes, and internal/store's destructive helpers own the
// shared scratch DB — two packages migrating/truncating one database
// concurrently is the wave-13 deviation-1 collision all over again. Each
// test family in THIS package passes its own suffix ("_recongate" for the
// gate lifecycle, "_reconepoch" for the reorg-epoch gate) for the same
// reason, one level down.
func ensureDerivedDB(t *testing.T, ctx context.Context, baseDSN, suffix string) string {
	t.Helper()
	u, err := url.Parse(baseDSN)
	require.NoError(t, err)
	baseName := strings.TrimPrefix(u.Path, "/")
	require.NotEmpty(t, baseName)
	name := baseName + suffix
	require.NotEqual(t, "solvent", name)

	admin, err := pgx.Connect(ctx, baseDSN)
	require.NoError(t, err)
	defer admin.Close(ctx)
	var exists bool
	require.NoError(t, admin.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists))
	if !exists {
		// CREATE DATABASE cannot be parameterized; the name is derived from
		// the operator's scratch DSN plus a fixed suffix.
		_, err = admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, name))
		require.NoError(t, err)
	}
	gu := *u
	gu.Path = "/" + name
	gateDSN := gu.String()
	require.NoError(t, store.Migrate(ctx, gateDSN), "migrate the derived gate DB")
	return gateDSN
}

// backendsOn counts live backends on the given database, excluding the
// control connection itself.
func backendsOn(ctx context.Context, control *pgx.Conn) (int, error) {
	var n int
	err := control.QueryRow(ctx,
		`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`).Scan(&n)
	return n, err
}

// waitForParkedLock polls pg_locks (database state, not timing guesses)
// until a backend is WAITING on relation `table`, i.e. Collect is provably
// parked inside its open transaction.
func waitForParkedLock(t *testing.T, ctx context.Context, control *pgx.Conn, table string, collectErr <-chan error) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		select {
		case err := <-collectErr:
			t.Fatalf("Collect finished (err=%v) before parking on %s — the lock choreography is broken", err, table)
		default:
		}
		var waiting int
		require.NoError(t, control.QueryRow(ctx,
			`SELECT count(*) FROM pg_locks l JOIN pg_class c ON l.relation = c.oid
			 WHERE c.relname = $1 AND NOT l.granted`, table).Scan(&waiting))
		if waiting > 0 {
			return
		}
		require.True(t, time.Now().Before(deadline), "Collect never blocked on %s", table)
		time.Sleep(20 * time.Millisecond)
	}
}

// TestProductionGateActiveThroughSnapshotLifecycle proves the round-13 F2
// binding property: snapshotdb.Gate is CLOSED by Collect's own wiring from
// BeginTx through commit/rollback, the production pinnedReader check
// enforces it mid-transaction, and the gate reopens (and the connection
// closes) on BOTH the commit and the rollback path. The gate is never
// toggled by this test — only observed.
func TestProductionGateActiveThroughSnapshotLifecycle(t *testing.T) {
	ctx := context.Background()
	gateDSN := ensureDerivedDB(t, ctx, gateTestBaseDSN(t), "_recongate")
	roDSN, err := readOnlyDSN(gateDSN)
	require.NoError(t, err)

	// Control connection on the SAME derived database (LOCK TABLE must run
	// where the table lives). Raw DSN, not read-only: LOCK TABLE is refused
	// in read-only transactions.
	control, err := pgx.Connect(ctx, gateDSN)
	require.NoError(t, err)
	defer control.Close(ctx)
	var controlPID int
	require.NoError(t, control.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&controlPID))

	cfg := &config.Config{Chains: map[string]config.Chain{}}
	prm := snapshotdb.Params{} // ConfigSHA empty: the hash is caller-computed provenance (round-14 F3)
	runCollect := func(cctx context.Context) <-chan error {
		done := make(chan error, 1)
		go func() {
			_, err := snapshotdb.Collect(cctx, prm, cfg, roDSN, snapshotdb.GoldenSpec{}, false, false, nil)
			done <- err
		}()
		return done
	}
	assertGateClosedThroughProductionCheck := func(where string) {
		require.Error(t, snapshotdb.Gate().Violation("probe"),
			"%s: the gate must be CLOSED while Collect's transaction is open", where)
		r := &pinnedReader{name: "op"} // zero-value: the refusal must come from the gate check, FIRST
		_, _, err := r.headerHash(ctx, 1)
		require.ErrorContains(t, err, "F5 seam violation",
			"%s: the PRODUCTION pinnedReader entry point must refuse while Collect holds the snapshot", where)
	}

	// ---- Leg 1 + 2 (commit path): park at the FIRST in-tx read
	// (derive_cursors — proves the gate closes before any query follows
	// BeginTx) and at the LAST (reorg_epochs — proves it is STILL closed
	// just before commit). Between them the whole read set runs gated.
	for _, table := range []string{"derive_cursors", "reorg_epochs"} {
		require.NoError(t, snapshotdb.Gate().Violation("pre"), "gate must start open")
		tx, err := control.Begin(ctx)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, fmt.Sprintf(`LOCK TABLE %s IN ACCESS EXCLUSIVE MODE`, table))
		require.NoError(t, err)

		done := runCollect(ctx)
		waitForParkedLock(t, ctx, control, table, done)
		assertGateClosedThroughProductionCheck("parked on " + table)

		require.NoError(t, tx.Rollback(ctx), "release the park")
		require.NoError(t, <-done, "Collect must commit cleanly once unparked")
		require.NoError(t, snapshotdb.Gate().Violation("post"),
			"the gate must REOPEN after commit-and-close (Stage B and the welds run after this)")

		// Connection close: Collect's backend must leave pg_stat_activity.
		require.Eventually(t, func() bool {
			n, err := backendsOn(ctx, control)
			return err == nil && n == 0
		}, 10*time.Second, 50*time.Millisecond, "Collect's connection must be CLOSED after return (%s leg)", table)
	}

	// ---- Leg 3 (rollback path): park again, then cancel Collect's context
	// — the query fails mid-transaction and the deferred rollback/close must
	// still reopen the gate. A gate that stays closed after an abort would
	// poison every later RPC in the process; a gate that never closed would
	// be worse.
	tx, err := control.Begin(ctx)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `LOCK TABLE reorg_epochs IN ACCESS EXCLUSIVE MODE`)
	require.NoError(t, err)

	cctx, cancel := context.WithCancel(ctx)
	done := runCollect(cctx)
	waitForParkedLock(t, ctx, control, "reorg_epochs", done)
	assertGateClosedThroughProductionCheck("parked before cancel")

	cancel()
	err = <-done
	require.Error(t, err, "a cancelled snapshot must surface its failure, never a silent partial")
	require.NoError(t, snapshotdb.Gate().Violation("post-rollback"),
		"the gate must REOPEN on the error/rollback path (deferred exit)")
	require.NoError(t, tx.Rollback(ctx))
	require.Eventually(t, func() bool {
		n, err := backendsOn(ctx, control)
		return err == nil && n == 0
	}, 10*time.Second, 50*time.Millisecond, "Collect's connection must be closed after the rollback path too")

	// ---- Leg 4 (round-14 F2): the ORDERED cleanup, observed DURING each
	// step. Defers ran LIFO before this wave, so Gate.Exit executed BEFORE
	// tx.Rollback and conn.Close on every post-BeginTx error — the RPC
	// surface reopened while the transaction still held xmin, and legs 1-3
	// could not see it because they check only post-return state. Here the
	// Sentinel's barriers park the single cleanup function at each stage in
	// turn, and the gate must be CLOSED at all three — including AFTER
	// conn.Close returned, which is the "exits LAST" fact itself. The
	// order-swapped mutant (gate-first) dies at the FIRST of these
	// observations, not at any post-return check.
	gate := snapshotdb.Gate()
	stages := []struct {
		stage snapshotdb.CleanupStage
		name  string
	}{
		{snapshotdb.StageBeforeRollback, "before-rollback"},
		{snapshotdb.StageBeforeClose, "before-close"},
		{snapshotdb.StageAfterClose, "after-close"},
	}
	gate.ResetArrivals()
	for _, s := range stages {
		gate.HoldAt(s.stage, true)
	}
	t.Cleanup(func() {
		for _, s := range stages {
			gate.HoldAt(s.stage, false)
		}
	})

	// The error is induced SERVER-SIDE (lock_timeout on Collect's own
	// session, injected as a DSN runtime parameter), never by canceling the
	// context: pgx v5.5.1 responds to a canceled watched context by
	// force-deadlining and asyncClose-ing the connection (pgconn.go
	// newContextWatcher/asyncClose), which would make the cleanup's rollback
	// and close client-side no-ops and the server-side observations racy. A
	// lock-timeout error leaves the CONNECTION healthy and the transaction
	// open-but-aborted, so the ordered cleanup performs a REAL rollback and
	// a REAL close, and every observation below is deterministic.
	tx, err = control.Begin(ctx)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `LOCK TABLE derive_cursors IN ACCESS EXCLUSIVE MODE`)
	require.NoError(t, err)

	timeoutDSN := roDSN + "&lock_timeout=1000"
	done4 := make(chan error, 1)
	go func() {
		_, err := snapshotdb.Collect(ctx, prm, cfg, timeoutDSN, snapshotdb.GoldenSpec{}, false, false, nil)
		done4 <- err
	}()

	waitArrived := func(st snapshotdb.CleanupStage, name string) {
		require.Eventually(t, func() bool { return gate.Arrived(st) },
			30*time.Second, 2*time.Millisecond, "cleanup never arrived at the %s checkpoint", name)
	}
	// The server-side truth per stage is the backend's STATE: after the
	// lock-timeout error Collect's backend sits in 'idle in transaction
	// (aborted)' — the transaction BLOCK exists until ROLLBACK arrives.
	// (xact_start is NULLED for aborted blocks on this server, so state is
	// the honest observable.) The observations run over a DEDICATED
	// autocommit connection: pg_stat_activity is snapshot-stable INSIDE a
	// transaction, and the control connection spends this leg inside the
	// lock-holding one — reading through it would compare frozen state.
	obs, err := pgx.Connect(ctx, gateDSN)
	require.NoError(t, err)
	defer obs.Close(ctx)
	openServerTxBlocks := func() int {
		var n int
		require.NoError(t, obs.QueryRow(ctx,
			`SELECT count(*) FROM pg_stat_activity
			 WHERE datname = current_database()
			   AND pid <> pg_backend_pid() AND pid <> $1
			   AND state LIKE 'idle in transaction%'`, controlPID).Scan(&n))
		return n
	}
	// collectBackends counts exactly Collect's connections: everything on
	// this database except the observer itself and the control connection.
	collectBackends := func() int {
		var n int
		require.NoError(t, obs.QueryRow(ctx,
			`SELECT count(*) FROM pg_stat_activity
			 WHERE datname = current_database()
			   AND pid <> pg_backend_pid() AND pid <> $1`, controlPID).Scan(&n))
		return n
	}

	// Stage 1: rollback pending — the server-side transaction block still
	// exists, and the gate MUST still be closed. This is exactly the window
	// the LIFO ordering reopened.
	waitArrived(snapshotdb.StageBeforeRollback, "before-rollback")
	assertGateClosedThroughProductionCheck("held before rollback (transaction block still live server-side)")
	require.GreaterOrEqual(t, openServerTxBlocks(), 1,
		"while cleanup is parked BEFORE rollback, Collect's transaction block must still exist in pg_stat_activity — the observation is server state, not client bookkeeping")
	gate.HoldAt(snapshotdb.StageBeforeRollback, false)

	// Stage 2: rollback done (its response received — the server has ended
	// the transaction), close pending — the connection is still alive and
	// the gate MUST still be closed.
	waitArrived(snapshotdb.StageBeforeClose, "before-close")
	assertGateClosedThroughProductionCheck("held before close (rollback complete, connection still open)")
	require.Equal(t, 0, openServerTxBlocks(),
		"after the rollback checkpoint the server must hold no transaction block for Collect's backend")
	require.GreaterOrEqual(t, collectBackends(), 1,
		"Collect's backend must still be CONNECTED while close is pending")
	gate.HoldAt(snapshotdb.StageBeforeClose, false)

	// Stage 3: conn.Close has RETURNED — and the gate is STILL closed. The
	// gate exits last; Collect cannot have returned yet.
	waitArrived(snapshotdb.StageAfterClose, "after-close")
	require.Error(t, snapshotdb.Gate().Violation("probe"),
		"after conn.Close returns the gate must STILL be closed — Gate.Exit is the final step of the ordered cleanup, never earlier")
	select {
	case err := <-done4:
		t.Fatalf("Collect returned (err=%v) while the after-close barrier was held — the gate exit ran out of order", err)
	default:
	}
	gate.HoldAt(snapshotdb.StageAfterClose, false)

	err = <-done4
	require.Error(t, err, "the lock-timeout ordered-cleanup leg must surface its failure (the failed read aborts the run)")
	require.NoError(t, snapshotdb.Gate().Violation("post-ordered-cleanup"),
		"the gate must reopen once the ordered cleanup completes")
	require.NoError(t, tx.Rollback(ctx))
	require.Eventually(t, func() bool {
		return collectBackends() == 0
	}, 10*time.Second, 50*time.Millisecond, "Collect's connection must be closed after the ordered-cleanup leg")
}
