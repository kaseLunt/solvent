// Round-13 F2, the DB-backed leg: the PRODUCTION gate wiring — Collect
// entering snapshotdb.Gate right after BeginTx and exiting strictly after
// commit/rollback and connection close — proven against a REAL database,
// never by a test toggling the gate. Wave 13 disclosed exactly this hole
// (deviation 6: "the sentinel's wiring inside collectSnapshot is not
// executed by any test"); round 13 made it binding.
//
// TECHNIQUE (deterministic, no sleeps-as-synchronization): Collect runs in a
// goroutine against a package-private scratch database while a control
// connection holds ACCESS EXCLUSIVE on one of the tables Collect reads —
// derive_cursors is Collect's FIRST in-tx read, reorg_epochs its LAST — so
// Collect parks INSIDE the open transaction at a chosen point. The test
// waits for the parked lock to become visible in pg_locks (database state,
// not wall-clock guessing), then asserts the gate is closed AND that a real
// pinnedReader entry point refuses through the production check. Releasing
// the lock lets Collect commit and close; cancelling Collect's context while
// parked exercises the ROLLBACK path. After both paths the gate must be open
// and Collect's backend gone from pg_stat_activity.
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

// ensureGateDB derives a package-exclusive database ("<scratch>_recongate")
// from the scratch DSN, creates it if missing, and migrates it. A DERIVED
// database, not TEST_DATABASE_URL itself: `go test ./...` runs packages in
// parallel processes, and internal/store's destructive helpers own the
// shared scratch DB — two packages migrating/truncating one database
// concurrently is the wave-13 deviation-1 collision all over again.
func ensureGateDB(t *testing.T, ctx context.Context, baseDSN string) string {
	t.Helper()
	u, err := url.Parse(baseDSN)
	require.NoError(t, err)
	baseName := strings.TrimPrefix(u.Path, "/")
	require.NotEmpty(t, baseName)
	name := baseName + "_recongate"
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
	gateDSN := ensureGateDB(t, ctx, gateTestBaseDSN(t))
	roDSN, err := readOnlyDSN(gateDSN)
	require.NoError(t, err)

	// Control connection on the SAME derived database (LOCK TABLE must run
	// where the table lives). Raw DSN, not read-only: LOCK TABLE is refused
	// in read-only transactions.
	control, err := pgx.Connect(ctx, gateDSN)
	require.NoError(t, err)
	defer control.Close(ctx)

	cfg := &config.Config{Chains: map[string]config.Chain{}}
	prm := snapshotdb.Params{ConfigPath: "testdata-no-such-config.json"}
	runCollect := func(cctx context.Context) <-chan error {
		done := make(chan error, 1)
		go func() {
			_, err := snapshotdb.Collect(cctx, prm, cfg, roDSN, snapshotdb.GoldenSpec{}, false, false, nil)
			done <- err
		}()
		return done
	}
	assertGateClosedThroughProductionCheck := func(where string) {
		require.Error(t, snapshotdb.Gate.Violation("probe"),
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
		require.NoError(t, snapshotdb.Gate.Violation("pre"), "gate must start open")
		tx, err := control.Begin(ctx)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, fmt.Sprintf(`LOCK TABLE %s IN ACCESS EXCLUSIVE MODE`, table))
		require.NoError(t, err)

		done := runCollect(ctx)
		waitForParkedLock(t, ctx, control, table, done)
		assertGateClosedThroughProductionCheck("parked on " + table)

		require.NoError(t, tx.Rollback(ctx), "release the park")
		require.NoError(t, <-done, "Collect must commit cleanly once unparked")
		require.NoError(t, snapshotdb.Gate.Violation("post"),
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
	require.NoError(t, snapshotdb.Gate.Violation("post-rollback"),
		"the gate must REOPEN on the error/rollback path (deferred exit)")
	require.NoError(t, tx.Rollback(ctx))
	require.Eventually(t, func() bool {
		n, err := backendsOn(ctx, control)
		return err == nil && n == 0
	}, 10*time.Second, 50*time.Millisecond, "Collect's connection must be closed after the rollback path too")
}
