// EVIDENCE tests for the invariant scans (brief §6): READ-ONLY execution of
// the exact same SQL constants against the LIVE backfilled database.
//
// ================================ HAZARD =================================
// These tests are gated on SOLVENT_RECON_DATABASE_URL — NEVER on
// TEST_DATABASE_URL — and open their connection with
// default_transaction_read_only=on, and NEVER call Migrate. That is not
// style: the destructive suite gated on TEST_DATABASE_URL Migrate+TRUNCATEs
// twelve tables including raw_logs, and pointing it at the live database
// would destroy a ~42-hour backfill (the wave-10 headline catch, L2-1).
// This file must stay incapable of writing: read-only session, no Migrate,
// no Store construction.
// =========================================================================
//
// Vacuous-pass protection: population counts run FIRST; an empty population
// SKIPS with the counts printed UNLESS SOLVENT_INVARIANT_REQUIRE_DATA=1
// converts the skip into a FAILURE (store.RequireDataVerdict). The receipt
// command sets the variable, so the evidence run cannot vacuously pass
// against an empty or wrong database.
//
// Canonical receipt command (brief §6):
//
//	SOLVENT_RECON_DATABASE_URL=$SOLVENT_DATABASE_URL SOLVENT_INVARIANT_REQUIRE_DATA=1 \
//	  go test ./internal/store -run 'TestInvariant' -count=1 -v
package store

import (
	"context"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// liveReconConn opens the read-only evidence connection, or skips.
func liveReconConn(t *testing.T) *pgx.Conn {
	t.Helper()
	dsn := os.Getenv("SOLVENT_RECON_DATABASE_URL")
	if dsn == "" {
		t.Skip("SOLVENT_RECON_DATABASE_URL not set; evidence tests run read-only against the live database")
	}
	u, err := url.Parse(dsn)
	require.NoError(t, err, "SOLVENT_RECON_DATABASE_URL must be a URL-form DSN")
	q := u.Query()
	q.Set("options", "-c default_transaction_read_only=on")
	u.RawQuery = q.Encode()
	conn, err := pgx.Connect(context.Background(), u.String())
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

func requireData(t *testing.T, conn *pgx.Conn, populationSQL, what string) {
	t.Helper()
	var n int64
	require.NoError(t, conn.QueryRow(context.Background(), populationSQL).Scan(&n))
	switch RequireDataVerdict(n, os.Getenv("SOLVENT_INVARIANT_REQUIRE_DATA") == "1") {
	case VerdictSkip:
		t.Skipf("population empty (%s = %d rows) and SOLVENT_INVARIANT_REQUIRE_DATA unset — skipping (a dev pointing at an empty DB)", what, n)
	case VerdictFail:
		t.Fatalf("population empty (%s = %d rows) under SOLVENT_INVARIANT_REQUIRE_DATA=1 — the evidence run demanded data; an empty table is a FAILURE, not a skip", what, n)
	}
	t.Logf("population: %s = %d rows", what, n)
}

// TestInvariantEvidenceScan1DistinctHash — normative clause: W1 Phase 1
// deferred item "distinct-hash-per-height invariant scan".
func TestInvariantEvidenceScan1DistinctHash(t *testing.T) {
	conn := liveReconConn(t)
	requireData(t, conn, `SELECT COUNT(*) FROM raw_logs`, "raw_logs")
	rows, err := InvariantDistinctHashViolations(context.Background(), conn)
	require.NoError(t, err)
	require.Empty(t, rows, "every (chain, height) must carry exactly one block hash")
}

// TestInvariantEvidenceScan2EventSums — normative clause: Task 9 post-gate
// bullet "event sums equal event-source balances", strict IS DISTINCT FROM.
func TestInvariantEvidenceScan2EventSums(t *testing.T) {
	conn := liveReconConn(t)
	requireData(t, conn, `SELECT COUNT(*) FROM position_events WHERE delta IS NOT NULL`, "delta-bearing position_events")
	rows, err := InvariantEventSumMismatches(context.Background(), conn)
	require.NoError(t, err)
	require.Empty(t, rows)
	// Named sub-assertions (risk-quant F3): the wide scan predicate and the
	// fold predicate agree exactly while these are zero.
	var nullAsset, sideless int64
	require.NoError(t, conn.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM position_events WHERE delta IS NOT NULL AND asset IS NULL`).Scan(&nullAsset))
	require.NoError(t, conn.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM position_events WHERE delta IS NOT NULL AND side = ''`).Scan(&sideless))
	require.Zero(t, nullAsset, "a NULL-asset delta row would un-pair the scan's join")
	require.Zero(t, sideless, "a side-less delta row is dropped by the fold but surfaced by the scan — taxonomy violation by name")
}

// TestInvariantEvidenceScan3BorrowIndex — normative clause: Task 9
// post-gate bullet "borrow_index monotonic non-decreasing per (engine,
// asset)".
func TestInvariantEvidenceScan3BorrowIndex(t *testing.T) {
	conn := liveReconConn(t)
	requireData(t, conn, `SELECT COUNT(*) FROM rate_indexes WHERE kind = 'borrow_index'`, "borrow_index observations")
	rows, err := InvariantBorrowIndexRegressions(context.Background(), conn)
	require.NoError(t, err)
	require.Empty(t, rows)
}

// TestInvariantEvidenceScan4EventLogReferential — risk-quant F5.1: derived
// events trace to ingested raw logs; zero orphans as a standing DB fact.
func TestInvariantEvidenceScan4EventLogReferential(t *testing.T) {
	conn := liveReconConn(t)
	requireData(t, conn, `SELECT COUNT(*) FROM position_events`, "position_events")
	rows, err := InvariantEventLogOrphans(context.Background(), conn)
	require.NoError(t, err)
	require.Empty(t, rows)
}

// TestInvariantEvidenceScan5IIUCoverage — risk-quant F5.2: every DM
// debt-mutating block carries its same-block borrow_index observation.
func TestInvariantEvidenceScan5IIUCoverage(t *testing.T) {
	conn := liveReconConn(t)
	requireData(t, conn,
		`SELECT COUNT(*) FROM position_events WHERE engine='debt_manager' AND event_type IN ('borrow','repay','liquidation')`,
		"DM debt-mutating events")
	rows, err := InvariantIIUCoverageGaps(context.Background(), conn)
	require.NoError(t, err)
	require.Empty(t, rows)
}

// TestInvariantEvidenceAdvisoryAaveIndexes — ADVISORY sibling (no plan
// clause mandates the Aave kinds): findings are reported via test log,
// never a failure of the mandated scans; the assertion here is only that
// the scan RUNS against live data.
func TestInvariantEvidenceAdvisoryAaveIndexes(t *testing.T) {
	conn := liveReconConn(t)
	requireData(t, conn, `SELECT COUNT(*) FROM rate_indexes WHERE kind IN ('variable_borrow_index','liquidity_index')`, "aave index observations")
	rows, err := InvariantAaveIndexRegressions(context.Background(), conn)
	require.NoError(t, err)
	if len(rows) > 0 {
		t.Logf("ADVISORY: %d aave index regressions (reported, not gated): first = %+v", len(rows), rows[0])
	}
}

// TestInvariantEvidenceConnectionIsReadOnly proves the posture this file
// claims: a write through the evidence connection MUST be refused by the
// session's default_transaction_read_only=on.
func TestInvariantEvidenceConnectionIsReadOnly(t *testing.T) {
	conn := liveReconConn(t)
	_, err := conn.Exec(context.Background(), `CREATE TEMPORARY TABLE recon_write_probe (x int)`)
	// Temp tables are also refused in read-only transactions.
	require.Error(t, err, "the evidence connection must be structurally unable to write")
	require.Contains(t, err.Error(), "read-only")
}
