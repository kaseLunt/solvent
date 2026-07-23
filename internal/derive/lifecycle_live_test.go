package derive

// Live-store lifecycle tests for the COMMIT INDETERMINACY rule (derive.Engine):
// store.ApplyDerived returns its transaction Commit's error verbatim, and
// Postgres can commit while the acknowledgment is lost to a connection
// failure — so an ApplyDerived error does NOT mean the batch failed to
// persist. These tests drive a real *store.Store through the engine lifecycle,
// simulate the runner's error path AFTER a commit that actually landed, and
// pin both halves of the rule: Reset re-hydrates committed truth exactly
// (correct whether or not the tx landed), while DiscardBatch in the same
// scenario provably desyncs engine memory from the store.
//
// Isolation: internal/store's own live suite TRUNCATEs the shared
// public-schema tables at the start of every test, and `go test ./...` runs
// package binaries concurrently — so these tests migrate and operate inside a
// dedicated schema (search_path-scoped DSN), never touching the store suite's
// tables.

import (
	"context"
	"database/sql"
	"encoding/hex"
	"math/big"
	"net/url"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// liveSchema is this package's dedicated Postgres schema (dropped and
// re-created per test: full migration isolation from internal/store's suite
// and from previous runs).
const liveSchema = "derive_lifecycle_live"

// liveSchemaDSN scopes dsn's search_path to schema, so store.Migrate and
// every store query resolve tables inside it.
func liveSchemaDSN(t *testing.T, dsn, schema string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	q := u.Query()
	q.Set("options", "-csearch_path="+schema)
	u.RawQuery = q.Encode()
	return u.String()
}

// liveLifecycleStore returns a real *store.Store over a freshly migrated,
// schema-isolated database (skipped without TEST_DATABASE_URL, like the
// store suite).
func liveLifecycleStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	ctx := context.Background()

	admin, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "DROP SCHEMA IF EXISTS "+liveSchema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "CREATE SCHEMA "+liveSchema)
	require.NoError(t, err)
	require.NoError(t, admin.Close())

	scoped := liveSchemaDSN(t, dsn, liveSchema)
	require.NoError(t, store.Migrate(ctx, scoped))
	s, err := store.Open(ctx, scoped)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	return s
}

// TestIndeterminateCommitResetRehydratesExact pins the mandated runner rule:
// any ApplyDerived error → Engine.Reset() (never DiscardBatch). The scenario
// is a commit that LANDED while its acknowledgment was lost — ApplyDerived
// succeeds against the real store (playing the committed half of the
// ambiguity), then the runner behaves as if it saw an error and Resets. The
// next BeginBatch re-hydrates from committed truth through the real reader,
// and derivation over the post-commit state is exact: the full-balance repay
// folds bit-exactly and one USD more is refused.
func TestIndeterminateCommitResetRehydratesExact(t *testing.T) {
	s := liveLifecycleStore(t)
	ctx := context.Background()
	usdcHex := hex.EncodeToString(tUSDC.Bytes())

	dm := NewDebtManager(nil)
	require.NoError(t, dm.BeginBatch(ctx, s))
	feedIndex(t, dm, 100, tUSDC, num("1000000000000000000"))
	evs, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(100)})
	require.NoError(t, err)

	// The store transaction COMMITS...
	require.NoError(t, s.ApplyDerived(ctx, dmEngineName, 10, evs, 100))
	// ...but the runner observes an error it cannot attribute (Commit's ack
	// lost after the commit landed). Rule under test: Reset, never
	// DiscardBatch — Reset is correct in BOTH worlds because the next
	// BeginBatch re-hydrates whatever actually committed.
	dm.Reset()

	// The committed half of the ambiguity is real: truth carries the batch
	// and the derive cursor advanced past it.
	bals, err := s.BalancesFor(ctx, dmEngineName, tUser.Bytes())
	require.NoError(t, err)
	require.Equal(t, "100", bals[usdcHex][sideDebt].String())
	cur, found, err := s.DeriveCursor(ctx, dmEngineName)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(100), cur)

	// Next batch: hydration through the REAL store reader; next-batch
	// derivation over the post-commit state is exact.
	require.NoError(t, dm.BeginBatch(ctx, s))
	feedIndex(t, dm, 101, tUSDC, num("1000000000000000000"))
	evs, err = dm.Process(tLog(101, 0x02, 5), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(100)})
	require.NoError(t, err)
	require.Equal(t, "-100", evs[0].Delta.String(), "full-balance repay folds bit-exactly against re-hydrated committed truth")
	_, err = dm.Process(tLog(101, 0x03, 7), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(1)})
	require.ErrorContains(t, err, "negative", "one USD past committed truth is refused — memory and store agree exactly")

	// The recovered lifecycle continues cleanly to the next commit.
	require.NoError(t, s.ApplyDerived(ctx, dmEngineName, 10, evs, 101))
	dm.CommitBatch()
	bals, err = s.BalancesFor(ctx, dmEngineName, tUser.Bytes())
	require.NoError(t, err)
	require.Equal(t, "0", bals[usdcHex][sideDebt].String())
}

// TestIndeterminateCommitDiscardDesyncs is the contrast pinning WHY the rule
// exists: same landed-commit-with-observed-error scenario, but the runner
// (wrongly) answers with DiscardBatch. Hydration marks survive Discard by
// design — they mirror committed truth as of FIRST touch — so the next batch
// serves the stale pre-batch zero from the promoted layer while the store
// carries the borrow: engine memory and committed truth measurably diverge,
// and a truth-valid repay is refused.
func TestIndeterminateCommitDiscardDesyncs(t *testing.T) {
	s := liveLifecycleStore(t)
	ctx := context.Background()
	usdcHex := hex.EncodeToString(tUSDC.Bytes())

	dm := NewDebtManager(nil)
	require.NoError(t, dm.BeginBatch(ctx, s))
	feedIndex(t, dm, 100, tUSDC, num("1000000000000000000"))
	evs, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(100)})
	require.NoError(t, err)

	// The commit LANDS; the runner sees an error and picks the WRONG branch.
	require.NoError(t, s.ApplyDerived(ctx, dmEngineName, 10, evs, 100))
	dm.DiscardBatch()

	// Desync, measured directly: promoted memory kept the pre-batch zero
	// (the account was hydrated as zero before the borrow, and hydration is
	// once-per-lifetime until Reset) while committed truth advanced.
	require.NoError(t, dm.BeginBatch(ctx, s))
	inMem, err := dm.normalizedOf(tUser, tUSDC)
	require.NoError(t, err)
	bals, err := s.BalancesFor(ctx, dmEngineName, tUser.Bytes())
	require.NoError(t, err)
	committed := bals[usdcHex][sideDebt]
	require.Equal(t, "100", committed.String(), "committed truth: the batch DID land")
	require.Equal(t, "0", inMem.String(), "engine memory: DiscardBatch preserved pre-batch state")
	require.NotEqual(t, committed.String(), inMem.String(),
		"DESYNC — the hazard the commit-indeterminacy rule (ApplyDerived error → Reset) exists to prevent")

	// The desync is not academic: the repay committed truth supports is
	// refused by the desynced engine.
	feedIndex(t, dm, 101, tUSDC, num("1000000000000000000"))
	_, err = dm.Process(tLog(101, 0x02, 5), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(100)})
	require.ErrorContains(t, err, "negative",
		"truth-valid full repay refused: DiscardBatch after an ambiguous commit corrupts derivation")
	dm.DiscardBatch()
}
