// FALSIFIABILITY tests for the invariant scans (brief §6, Design 2 graft 5):
// per scan, open a transaction, assert zero rows on the pristine baseline,
// INSERT a minimal violation INSIDE the transaction, re-run the scan inside
// that transaction, assert exactly the seeded violation surfaces, ROLLBACK.
// This proves each detector FIRES — a scan that cannot fail is a fixture,
// not an invariant — without dirtying any database.
//
// Gating: TEST_DATABASE_URL — the writable SCRATCH database (solvent_test
// after this wave's DB split). The helper additionally REFUSES a database
// literally named "solvent": that is the backfill daemon's live database,
// and the shared test helper TRUNCATEs (the exact hazard the wave-10 DB
// split closes — L2-1). Defense in depth; the reconcile binary carries its
// own DSN-identity tripwire.
package store

import (
	"context"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func testInvariantStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	if u, err := url.Parse(dsn); err == nil && u.Path == "/solvent" {
		t.Fatalf("TEST_DATABASE_URL points at the LIVE database %q — the test helpers TRUNCATE; point it at solvent_test (wave-10 DB split)", u.Path)
	}
	return testDeriveStore(t)
}

func beginScanTx(t *testing.T, s *Store) pgx.Tx {
	t.Helper()
	tx, err := s.pool.Begin(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	return tx
}

// TestInvariantScan1DistinctHashFalsifiability — normative clause: W1's
// Phase 1 deferred item "distinct-hash-per-height invariant scan" (pre-gate
// wording). The healthy shape (several heights, ONE hash each — including
// two rows of the same height sharing a hash) yields zero violations, which
// kills the `HAVING >= 1` / dropped-HAVING mutants; a seeded second hash at
// one height surfaces exactly once.
func TestInvariantScan1DistinctHashFalsifiability(t *testing.T) {
	s := testInvariantStore(t)
	ctx := context.Background()
	tx := beginScanTx(t, s)

	seed := func(block uint64, hash, txTag string, logIndex int) {
		_, err := tx.Exec(ctx, `INSERT INTO raw_logs (chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data)
			VALUES (10, $1, $2, $3, $4, '\xaa', '{}', '\x')`, block, []byte(hash), []byte(txTag), logIndex)
		require.NoError(t, err)
	}
	seed(100, "hash-A", "t1", 0)
	seed(100, "hash-A", "t2", 0) // same height, SAME hash — healthy
	seed(101, "hash-B", "t3", 0)

	rows, err := InvariantDistinctHashViolations(ctx, tx)
	require.NoError(t, err)
	require.Empty(t, rows, "one hash per height is the healthy case — a >=1 or dropped HAVING would flag every populated height")

	seed(100, "hash-X", "t4", 0) // the violation: second hash at height 100
	rows, err = InvariantDistinctHashViolations(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.EqualValues(t, 100, rows[0].BlockNumber)
	require.EqualValues(t, 2, rows[0].Hashes)
	require.Len(t, rows[0].Conflicting, 2)

	require.NoError(t, tx.Rollback(ctx))
	clean, err := InvariantDistinctHashViolations(ctx, s.pool)
	require.NoError(t, err)
	require.Empty(t, clean, "the rollback left no trace")
}

// TestInvariantScan2EventSumFalsifiability — normative clause: Task 9
// post-gate bullet "event sums equal event-source balances". Strict IS
// DISTINCT FROM (L0-4): the amount-0 twin rows both engines materialize are
// asserted healthy (killing the `=` mutant, which would flag every MATCHED
// pair... by returning them), and all three real orphan classes surface:
// event-group-without-balance, balance-without-events, zero-vs-missing.
func TestInvariantScan2EventSumFalsifiability(t *testing.T) {
	s := testInvariantStore(t)
	ctx := context.Background()
	tx := beginScanTx(t, s)

	acct := []byte{0xaa, 0x01}
	asset := []byte{0xcc, 0x01}
	// Healthy matched pair, including the amount-0 closed-position shape.
	_, err := tx.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta)
		VALUES (10,'debt_manager',10,'s2-t1',0,0,'borrow',$1,$2,'debt',25),
		       (10,'debt_manager',11,'s2-t2',0,0,'repay',$1,$2,'debt',-25)`, acct, asset)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
		VALUES ('debt_manager',$1,$2,'debt','event',0,11)`, acct, asset)
	require.NoError(t, err)

	rows, err := InvariantEventSumMismatches(ctx, tx)
	require.NoError(t, err)
	require.Empty(t, rows, "a matched zero-sum pair is healthy — the scan must not flag matches and must not exempt zeros")

	// Violation class 1: event group with NO balance row (zero-vs-missing —
	// the class a zero-sum allowance would silently exempt).
	acct2 := []byte{0xaa, 0x02}
	_, err = tx.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta)
		VALUES (10,'debt_manager',12,'s2-t3',0,0,'borrow',$1,$2,'debt',7),
		       (10,'debt_manager',13,'s2-t4',0,0,'repay',$1,$2,'debt',-7)`, acct2, asset)
	require.NoError(t, err)
	rows, err = InvariantEventSumMismatches(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 1, "zero-sum events with a MISSING balance row are a real orphan (the rebuild always materializes the row)")
	require.Nil(t, rows[0].Balance)
	require.NotNil(t, rows[0].EventSum)
	require.Equal(t, "0", *rows[0].EventSum)

	// Violation class 2: balance row with NO event rows.
	acct3 := []byte{0xaa, 0x03}
	_, err = tx.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
		VALUES ('debt_manager',$1,$2,'debt','event',5,14)`, acct3, asset)
	require.NoError(t, err)
	// Violation class 3: disagreeing values.
	_, err = tx.Exec(ctx, `UPDATE position_balances SET amount = 1 WHERE account = $1 AND asset = $2`, acct, asset)
	require.NoError(t, err)
	rows, err = InvariantEventSumMismatches(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 3)

	// Snapshot-source rows are OUT of scope (source exclusivity).
	acct4 := []byte{0xaa, 0x04}
	_, err = tx.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
		VALUES ('debt_manager',$1,$2,'collateral','snapshot',9,15)`, acct4, asset)
	require.NoError(t, err)
	rows, err = InvariantEventSumMismatches(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 3, "snapshot-source balances have no event trail to sum and must not join the scan")
}

// TestInvariantScan3BorrowIndexFalsifiability — normative clause: Task 9
// post-gate bullet "borrow_index monotonic non-decreasing per (engine,
// asset)". A non-decreasing series (including an EQUAL consecutive pair —
// legitimate at apy=0) is healthy, which kills the inverted-comparison
// mutant; a seeded regression surfaces exactly once; the Aave kinds live in
// the SEPARATE advisory scan and cannot fail this one.
func TestInvariantScan3BorrowIndexFalsifiability(t *testing.T) {
	s := testInvariantStore(t)
	ctx := context.Background()
	tx := beginScanTx(t, s)

	asset := []byte{0xcc, 0x02}
	seed := func(kind string, block uint64, value int64) {
		_, err := tx.Exec(ctx, `INSERT INTO rate_indexes (engine, asset, block_number, kind, value)
			VALUES ('debt_manager', $1, $2, $3, $4)`, asset, block, kind, value)
		require.NoError(t, err)
	}
	seed("borrow_index", 10, 1000)
	seed("borrow_index", 20, 1000) // equal — allowed (apy = 0)
	seed("borrow_index", 30, 1100)

	rows, err := InvariantBorrowIndexRegressions(ctx, tx)
	require.NoError(t, err)
	require.Empty(t, rows, "a monotonic series (equal pairs included) is healthy — the inverted comparison would flag the increase")

	seed("borrow_index", 40, 900) // the regression
	rows, err = InvariantBorrowIndexRegressions(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.EqualValues(t, 40, rows[0].BlockNumber)
	require.Equal(t, "900", rows[0].Value)
	require.Equal(t, "1100", rows[0].PrevValue)

	// The Aave advisory sibling is scoped to its own kinds: this
	// borrow_index regression must NOT appear there, and an Aave-kind
	// regression must NOT appear in scan 3 (separate verdict surfaces).
	adv, err := InvariantAaveIndexRegressions(ctx, tx)
	require.NoError(t, err)
	require.Empty(t, adv)
	seed("variable_borrow_index", 50, 2000)
	seed("variable_borrow_index", 60, 1500)
	adv, err = InvariantAaveIndexRegressions(ctx, tx)
	require.NoError(t, err)
	require.Len(t, adv, 1)
	require.Equal(t, "variable_borrow_index", adv[0].Kind)
	rows, err = InvariantBorrowIndexRegressions(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 1, "the advisory kinds never leak into the mandated scan")
}

// TestInvariantScan4EventLogOrphanFalsifiability — risk-quant F5.1: every
// position_events row must trace to a raw_logs row on (chain_id, tx_hash,
// log_index); seq fan-out shares one raw log and is healthy.
func TestInvariantScan4EventLogOrphanFalsifiability(t *testing.T) {
	s := testInvariantStore(t)
	ctx := context.Background()
	tx := beginScanTx(t, s)

	_, err := tx.Exec(ctx, `INSERT INTO raw_logs (chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data)
		VALUES (10, 100, 'h', 's4-t1', 0, '\xaa', '{}', '\x')`)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta)
		VALUES (10,'debt_manager',100,'s4-t1',0,0,'liquidation','\xaa01','\xcc01','debt',-5),
		       (10,'debt_manager',100,'s4-t1',0,1,'liquidation_collateral','\xaa01','\xcc02','',NULL)`)
	require.NoError(t, err)

	rows, err := InvariantEventLogOrphans(ctx, tx)
	require.NoError(t, err)
	require.Empty(t, rows, "seq fan-out from one raw log is healthy")

	_, err = tx.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta)
		VALUES (10,'debt_manager',101,'s4-orphan',0,0,'borrow','\xaa01','\xcc01','debt',5)`)
	require.NoError(t, err)
	rows, err = InvariantEventLogOrphans(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "borrow", rows[0].EventType)
}

// TestInvariantScan5IIUCoverageFalsifiability — risk-quant F5.2: every DM
// debt-mutating block carries a same-block borrow_index row for its token
// (the deriver's one-IIU-per-mutating-block invariant as a DB fact);
// residue_zeroed and migration_genesis are excluded by design.
func TestInvariantScan5IIUCoverageFalsifiability(t *testing.T) {
	s := testInvariantStore(t)
	ctx := context.Background()
	tx := beginScanTx(t, s)

	asset := []byte{0xcc, 0x03}
	_, err := tx.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta)
		VALUES (10,'debt_manager',100,'s5-t1',0,0,'borrow','\xaa01',$1,'debt',5),
		       (10,'debt_manager',100,'s5-t2',0,0,'residue_zeroed','\xaa01',$1,'debt',0),
		       (10,'debt_manager',90,'s5-t3',0,0,'migration_genesis','\xaa01',$1,'debt',7)`, asset)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO rate_indexes (engine, asset, block_number, kind, value)
		VALUES ('debt_manager', $1, 100, 'borrow_index', 1000)`, asset)
	require.NoError(t, err)

	rows, err := InvariantIIUCoverageGaps(ctx, tx)
	require.NoError(t, err)
	require.Empty(t, rows, "covered borrow block is healthy; residue_zeroed and migration_genesis need no IIU")

	_, err = tx.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta)
		VALUES (10,'debt_manager',110,'s5-t4',0,0,'repay','\xaa01',$1,'debt',-2)`, asset)
	require.NoError(t, err)
	rows, err = InvariantIIUCoverageGaps(ctx, tx)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.EqualValues(t, 110, rows[0].BlockNumber)
	require.Equal(t, "repay", rows[0].EventType)
}

// TestRequireDataVerdictEscalation pins the SOLVENT_INVARIANT_REQUIRE_DATA
// escalation as a pure decision (brief §6; mutation target 7 "REQUIRE_DATA
// escalation removed — skip becomes pass"): with data run; empty without
// the variable skip; empty WITH the variable FAIL — the receipt command
// sets it so the evidence run cannot vacuously pass against an empty or
// wrong database.
func TestRequireDataVerdictEscalation(t *testing.T) {
	require.Equal(t, VerdictRun, RequireDataVerdict(1, false))
	require.Equal(t, VerdictRun, RequireDataVerdict(1, true))
	require.Equal(t, VerdictSkip, RequireDataVerdict(0, false))
	require.Equal(t, VerdictFail, RequireDataVerdict(0, true),
		"an empty population under REQUIRE_DATA must FAIL, never skip — skip-becomes-pass is the laundering this kills")
}
