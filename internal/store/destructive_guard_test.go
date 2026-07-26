// The SHARED destructive-test boundary (Task 9 wave 11, round-10 F1).
//
// Every destructive test helper in this package — every path that Migrates,
// TRUNCATEs, or DROPs SCHEMA on whatever TEST_DATABASE_URL names — calls
// destructiveTestDSN BEFORE touching anything. The guard:
//
//  1. requires TEST_DATABASE_URL — absent is a SKIP in dev mode but FATAL in
//     acceptance mode (SOLVENT_ACCEPTANCE=1, set by `make test-acceptance`):
//     a skipped live-db suite can never produce suite-green evidence;
//  2. refuses a database literally NAMED "solvent" (belt and braces — the
//     backfill daemon's live database);
//  3. resolves BOTH the test and the live (SOLVENT_DATABASE_URL) database
//     identities via the F4 tuple mechanism (store.VerifyDestructiveSplit:
//     pg_control system_identifier + database OID + name) and fails CLOSED
//     on equality OR on either identity being unresolvable.
//
// The wave-10 posture relied on operator discipline (export the right DSN);
// this file makes the split STRUCTURAL: `make test` cannot truncate the live
// backfill even when TEST_DATABASE_URL is mis-pointed at it through any
// alias spelling, because the identity comparison sees the same cluster
// tuple regardless of how the host is written.
package store

import (
	"context"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"
)

// guardAction is the pure environment decision for the guard's first step.
type guardAction int

const (
	guardProceed guardAction = iota
	guardSkip
	guardFatal
)

// destructiveEnvDecision decides what an unset TEST_DATABASE_URL means:
// dev mode keeps the skip-when-unset ergonomics; acceptance mode makes it
// FATAL — the F1 rule that suite-green evidence can never be produced by
// skipping the database suite.
func destructiveEnvDecision(acceptance, testDSNSet bool) guardAction {
	if testDSNSet {
		return guardProceed
	}
	if acceptance {
		return guardFatal
	}
	return guardSkip
}

var (
	guardMu       sync.Mutex
	guardVerdicts = map[string]error{}
)

// verifySplitOnce runs VerifyDestructiveSplit once per (testDSN, liveDSN)
// pair per test process and caches the verdict: the identity probe connects
// to the LIVE database (read-only, two SELECTs), and hundreds of helper
// invocations per suite run must not turn that into connection pressure on
// the database the daemon is writing.
func verifySplitOnce(testDSN, liveDSN string) error {
	guardMu.Lock()
	defer guardMu.Unlock()
	key := testDSN + "\x00" + liveDSN
	if v, ok := guardVerdicts[key]; ok {
		return v
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := VerifyDestructiveSplit(ctx, testDSN, liveDSN)
	guardVerdicts[key] = err
	return err
}

// destructiveTestDSN is THE gate: every destructive helper obtains its DSN
// from here, never from os.Getenv directly, so the split verification cannot
// be forgotten by a new helper copying an old preamble.
func destructiveTestDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	switch destructiveEnvDecision(os.Getenv("SOLVENT_ACCEPTANCE") == "1", dsn != "") {
	case guardSkip:
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it (dev-mode skip — `make test-acceptance` makes this FATAL)")
	case guardFatal:
		t.Fatal("acceptance mode (SOLVENT_ACCEPTANCE=1): TEST_DATABASE_URL is REQUIRED — a skipped live-db suite can never produce suite-green evidence (round-10 F1)")
	}
	if u, err := url.Parse(dsn); err == nil && u.Path == "/solvent" {
		t.Fatalf("TEST_DATABASE_URL points at the LIVE database %q — the destructive helpers Migrate+TRUNCATE; point it at solvent_test (wave-10 DB split)", u.Path)
	}
	if err := verifySplitOnce(dsn, os.Getenv("SOLVENT_DATABASE_URL")); err != nil {
		t.Fatalf("destructive-test guard REFUSES to proceed: %v", err)
	}
	return dsn
}
