package prices

// Live-store test for Task 9 wave 1: one endpoint-coherent, block-pinned poll
// round driven through the REAL *store.Store, with the fake chain serving the
// real-EVM multicall shape (blockHash = zero). The unit fleet proves the
// poller composes the round correctly; this proves the round's durable
// footprint — the price_poll_anchors row and the per-observation anchor_block
// binding (migration 00007, D-012) — lands unchanged under the recomposed
// acquisition, against the SQL that will run in production.
//
// Isolation: internal/store's own live suite TRUNCATEs the shared
// public-schema tables at the start of every test, and `go test ./...` runs
// package binaries concurrently — so this test migrates and operates inside a
// dedicated schema (search_path-scoped DSN), never touching the store suite's
// tables. Same pattern as internal/derive's live tests.

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// pollLiveSchema is this test's dedicated Postgres schema (dropped and
// re-created per run: full migration isolation from internal/store's suite
// and from previous runs).
const pollLiveSchema = "prices_poller_live"

// pollLiveSchemaDSN scopes dsn's search_path to schema, so store.Migrate and
// every store query resolve tables inside it.
func pollLiveSchemaDSN(t *testing.T, dsn, schema string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	q := u.Query()
	q.Set("options", "-csearch_path="+schema)
	u.RawQuery = q.Encode()
	return u.String()
}

// livePollStore returns a real *store.Store over a freshly migrated,
// schema-isolated database (skipped without TEST_DATABASE_URL, like the store
// suite), plus the scoped DSN for raw row-level assertions.
func livePollStore(t *testing.T) (*store.Store, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	ctx := context.Background()

	admin, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "DROP SCHEMA IF EXISTS "+pollLiveSchema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.ExecContext(ctx, "CREATE SCHEMA "+pollLiveSchema)
	require.NoError(t, err)
	require.NoError(t, admin.Close())

	scoped := pollLiveSchemaDSN(t, dsn, pollLiveSchema)
	require.NoError(t, store.Migrate(ctx, scoped))
	s, err := store.Open(ctx, scoped)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	return s, scoped
}

// A real round writes its price_poll_anchors row carrying (N, HeaderHash(N))
// and binds EVERY observation to that anchor (anchor_block = N), with the
// multicall's own hash field at the real-EVM zero throughout — 00007's
// per-observation provenance semantics are unchanged by the recomposed
// acquisition; only where the anchor HASH comes from moved.
func TestPollerLiveRoundWritesAnchorAndBoundObservations(t *testing.T) {
	s, scoped := livePollStore(t)
	ctx := context.Background()

	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, err := NewPoller(s, ch, realFeeds(t), PollerConfig{ChainID: 10, Interval: time.Minute})
	require.NoError(t, err)

	advanced, err := p.Step(ctx)
	require.NoError(t, err)
	require.True(t, advanced, "the round landed against the real store")

	engine := PollCursorEngine(10)

	// The anchor row is (N, hashBefore): the header path's hash, which the
	// fake serves as blockHashAt(5000) while its multicall hash field is zero.
	anchor, found, err := s.NewestPollAnchor(ctx, engine, 10)
	require.NoError(t, err)
	require.True(t, found, "a real round writes its price_poll_anchors row")
	require.Equal(t, uint64(5000), anchor.BlockNumber, "the anchor height is the round's verified pin")
	require.Equal(t, blockHashAt(5000).Bytes(), anchor.BlockHash,
		"the anchor hash is the header path's — a zero (multicall-sourced) hash here would have been refused")

	// 00007 semantics unchanged: no observation this engine owns is unprovable.
	unbound, err := s.CountUnanchoredPricesAbove(ctx, engine, 10, 0)
	require.NoError(t, err)
	require.Zero(t, unbound, "every landed observation carries a provenance binding a surviving anchor vouches for")

	// Row by row, through raw SQL: all 20 observations exist at the pin, valid,
	// each bound to the round's OWN anchor — not to a height, to the binding.
	db, err := sql.Open("pgx", scoped)
	require.NoError(t, err)
	defer db.Close()
	var rows, bound int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT count(*), count(*) FILTER (WHERE anchor_block = 5000 AND valid)
		 FROM prices WHERE chain_id = 10 AND owner_engine = $1 AND block_number = 5000`,
		engine).Scan(&rows, &bound))
	require.Equal(t, 20, rows, "one row per registry obligation, stamped with the pin")
	require.Equal(t, 20, bound, "every row is valid and bound to anchor_block = 5000 (00007)")

	// And the durable cursor advanced to the pin in the same transaction.
	cur, found, err := s.DeriveCursor(ctx, engine)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(5000), cur)
}
