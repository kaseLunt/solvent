// Reconciliation query layer (Task 9 wave 10, brief §5): every function here
// takes an EXPLICIT Querier instead of living on Store's pool, which is the
// mechanism that makes "one source of query truth" and "one snapshot"
// simultaneously true (finding L2-4). cmd/reconcile passes its REPEATABLE READ
// READ ONLY transaction so every DB read in a run observes one atomic database
// state; tests pass a pool or their own transaction; and the SQL lives in
// exactly one place either way. Implementers may NOT re-home these onto
// s.pool: a pool method silently re-reads outside the snapshot, and the drift
// report's whole claim is that its DB side is a single point-in-time state.
//
// Everything in this file is STRICTLY READ-ONLY — no INSERT/UPDATE/DELETE, no
// Migrate, no advisory locks — because reconcile runs while the backfill
// daemon owns the writer lock on the live database.
package store

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Querier is the read surface shared by *pgxpool.Pool, *pgx.Conn and pgx.Tx.
// Reconciliation functions take it explicitly (never a Store) so the caller
// decides the transactional scope: cmd/reconcile hands its RR snapshot tx,
// tests hand a pool or a tx of their own.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// NumericToBigInt converts a scanned pgtype.Numeric into an exact *big.Int —
// no float path ever (brief §3.2). The brief's "Exp == 0 asserted loudly" is
// enforced at VALUE level rather than representation level: pgx's binary
// NUMERIC codec normalizes integral values into base-10000 digit groups, so a
// perfectly integral 1000000 can arrive as {Int:1, Exp:6} (or {Int:100,
// Exp:4}, batch-dependent). Value = Int × 10^Exp exactly when Exp ≥ 0, which
// is the integral case; any Exp < 0 means a FRACTIONAL numeric reached a path
// that must only ever see integers, and that is refused loudly, never
// rounded.
func NumericToBigInt(n pgtype.Numeric) (*big.Int, error) {
	if !n.Valid {
		return nil, fmt.Errorf("numeric is NULL where an integer is required")
	}
	if n.NaN {
		return nil, fmt.Errorf("numeric is NaN where an integer is required")
	}
	if n.InfinityModifier != pgtype.Finite {
		return nil, fmt.Errorf("numeric is infinite where an integer is required")
	}
	if n.Int == nil {
		return nil, fmt.Errorf("numeric carries a nil integer part")
	}
	if n.Exp < 0 {
		return nil, fmt.Errorf("numeric %s×10^%d is fractional — the reconcile paths carry integers only and refuse to round (no float path, brief §3.2)", n.Int, n.Exp)
	}
	v := new(big.Int).Set(n.Int)
	if n.Exp > 0 {
		v.Mul(v, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n.Exp)), nil))
	}
	return v, nil
}

// ExpectedSchemaVersion reports the highest migration version embedded in
// this binary — the schema the compiled query layer was written against. The
// reconcile schema gate (brief §0 Phase 0) requires the database's max
// applied goose_db_version to EQUAL this exactly: a lower database misses
// tables these queries read; a higher one may have reshaped them.
func ExpectedSchemaVersion() (int64, error) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return 0, fmt.Errorf("read embedded migrations: %w", err)
	}
	var maxVersion int64
	for _, e := range entries {
		name := e.Name()
		idx := strings.IndexByte(name, '_')
		if idx <= 0 {
			continue
		}
		v, err := strconv.ParseInt(name[:idx], 10, 64)
		if err != nil {
			continue
		}
		if v > maxVersion {
			maxVersion = v
		}
	}
	if maxVersion == 0 {
		return 0, fmt.Errorf("no embedded migrations found")
	}
	return maxVersion, nil
}

// SchemaVersion reads the database's max applied goose migration version.
// Read-only: reconcile GATES on the version and never migrates (brief §1).
func SchemaVersion(ctx context.Context, q Querier) (int64, error) {
	var v int64
	if err := q.QueryRow(ctx,
		`SELECT COALESCE(MAX(version_id), 0) FROM goose_db_version`).Scan(&v); err != nil {
		return 0, fmt.Errorf("read goose_db_version: %w", err)
	}
	return v, nil
}

// DBIdentity is the PHYSICAL identity of a database (round-10 F4): the
// PostgreSQL cluster's system_identifier (pg_control — stable across every
// alias and transport of one cluster) plus the database OID and name.
// Equality on THIS tuple means "the same database" no matter how a DSN
// spells the route to it: IPv4 vs IPv6, unix socket vs TCP, proxy alias.
// The previous identity (database@inet_server_addr:port) forked on exactly
// those respellings, so the tripwire could fail OPEN across aliases of the
// live cluster — the round-10 F4 finding.
type DBIdentity struct {
	SystemIdentifier string // pg_control_system().system_identifier, as text
	DatabaseOID      uint32 // pg_database.oid of current_database()
	DatabaseName     string // current_database()
}

func (id DBIdentity) String() string {
	return fmt.Sprintf("cluster %s database %q (oid %d)", id.SystemIdentifier, id.DatabaseName, id.DatabaseOID)
}

// SameDatabase is the tripwire's equality: the full (system_identifier,
// database OID, database name) tuple.
func SameDatabase(a, b DBIdentity) bool { return a == b }

// DatabaseIdentity resolves the physical identity of the database a
// Querier's connection is attached to. The DSN-split tripwire (brief §1.2)
// and the shared destructive-test guard (round-10 F1) compare the RECONCILE
// / live identity with TEST_DATABASE_URL's: equality means the destructive
// test suite and the live evidence database are the same database, which is
// the single worst hazard the wave-10 split closed (L2-1 — the receipt's own
// command list would have truncated the ~42h backfill). Any failure to
// resolve the tuple is an error — callers fail CLOSED, never open.
func DatabaseIdentity(ctx context.Context, q Querier) (DBIdentity, error) {
	var id DBIdentity
	if err := q.QueryRow(ctx,
		`SELECT (SELECT system_identifier::text FROM pg_control_system()),
		        (SELECT oid FROM pg_database WHERE datname = current_database()),
		        current_database()`).Scan(&id.SystemIdentifier, &id.DatabaseOID, &id.DatabaseName); err != nil {
		return DBIdentity{}, fmt.Errorf("resolve database identity (failing CLOSED — an unresolvable identity can never vouch for a split): %w", err)
	}
	if id.SystemIdentifier == "" || id.DatabaseOID == 0 || id.DatabaseName == "" {
		return DBIdentity{}, fmt.Errorf("database identity incomplete (%s) — failing CLOSED", id)
	}
	return id, nil
}

// SplitRunbookMsg is the destructive-boundary refusal message, verbatim from
// the wave-10 brief §1.2 (runbook §DB-split).
const SplitRunbookMsg = "test and live DSNs identical; physical split required (see runbook §DB-split)"

// ResolveDSNIdentity connects to dsn with a read-only session and resolves
// its physical identity. Every failure path is an error so callers fail
// CLOSED: a DSN whose identity cannot be established must never be treated
// as "probably fine to truncate".
func ResolveDSNIdentity(ctx context.Context, dsn string) (DBIdentity, error) {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return DBIdentity{}, fmt.Errorf("parse DSN: %w", err)
	}
	// Defense in depth: the identity probe itself can never write.
	cfg.RuntimeParams["default_transaction_read_only"] = "on"
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return DBIdentity{}, fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)
	return DatabaseIdentity(ctx, conn)
}

// VerifyDestructiveSplit is the shared destructive-test boundary decision
// (round-10 F1): resolve BOTH the test and the live database identities via
// the F4 tuple mechanism and refuse — fail CLOSED — on equality OR on any
// identity being unresolvable (empty DSN, unparseable DSN, unreachable
// server). Every destructive test helper (the Migrate+TRUNCATE paths) calls
// this through internal/store's shared guard BEFORE touching anything; the
// safe path is the only path.
func VerifyDestructiveSplit(ctx context.Context, testDSN, liveDSN string) error {
	if strings.TrimSpace(testDSN) == "" {
		return fmt.Errorf("destructive-split guard: test DSN is empty — identity unresolvable, failing CLOSED; %s", SplitRunbookMsg)
	}
	if strings.TrimSpace(liveDSN) == "" {
		return fmt.Errorf("destructive-split guard: live DSN is empty (export .env / SOLVENT_DATABASE_URL) — identity unresolvable, failing CLOSED; %s", SplitRunbookMsg)
	}
	testID, err := ResolveDSNIdentity(ctx, testDSN)
	if err != nil {
		return fmt.Errorf("destructive-split guard: test DSN identity unresolvable (%v) — failing CLOSED; %s", err, SplitRunbookMsg)
	}
	liveID, err := ResolveDSNIdentity(ctx, liveDSN)
	if err != nil {
		return fmt.Errorf("destructive-split guard: live DSN identity unresolvable (%v) — failing CLOSED; %s", err, SplitRunbookMsg)
	}
	if SameDatabase(testID, liveID) {
		return fmt.Errorf("destructive-split guard: %s (both DSNs resolve to %s)", SplitRunbookMsg, testID)
	}
	return nil
}

// DeriveCursorState is one derive_cursors row: the pin source (last_block)
// and the rewind detector's baseline (acked_epoch — brief §8: RewindDerived
// always bumps it and acks are monotone, so it is prune-immune where
// MAX(reorg_epochs.epoch) is not).
type DeriveCursorState struct {
	Engine     string
	ChainID    int64
	LastBlock  uint64
	AckedEpoch int64
}

// DeriveCursorStates reads every derive cursor, ordered by engine.
func DeriveCursorStates(ctx context.Context, q Querier) ([]DeriveCursorState, error) {
	rows, err := q.Query(ctx,
		`SELECT engine, chain_id, last_block, acked_epoch FROM derive_cursors ORDER BY engine`)
	if err != nil {
		return nil, fmt.Errorf("query derive cursors: %w", err)
	}
	defer rows.Close()
	var out []DeriveCursorState
	for rows.Next() {
		var s DeriveCursorState
		if err := rows.Scan(&s.Engine, &s.ChainID, &s.LastBlock, &s.AckedEpoch); err != nil {
			return nil, fmt.Errorf("scan derive cursor: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate derive cursors: %w", err)
	}
	return out, nil
}

// IngestCursorState is one ingest_cursors row; LastBlockHash participates in
// the fork weld when the derive pin equals the ingest cursor (brief §3.1 /
// L0-10: the highest raw_logs row can sit far below P for a quiet address
// set, so the cursor hash is the only anchor AT P).
type IngestCursorState struct {
	Stream        string
	ChainID       int64
	LastBlock     uint64
	LastBlockHash []byte
}

// IngestCursorStates reads every ingest cursor, ordered by stream.
func IngestCursorStates(ctx context.Context, q Querier) ([]IngestCursorState, error) {
	rows, err := q.Query(ctx,
		`SELECT stream, chain_id, last_block, last_block_hash FROM ingest_cursors ORDER BY stream`)
	if err != nil {
		return nil, fmt.Errorf("query ingest cursors: %w", err)
	}
	defer rows.Close()
	var out []IngestCursorState
	for rows.Next() {
		var s IngestCursorState
		if err := rows.Scan(&s.Stream, &s.ChainID, &s.LastBlock, &s.LastBlockHash); err != nil {
			return nil, fmt.Errorf("scan ingest cursor: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate ingest cursors: %w", err)
	}
	return out, nil
}

// MaxReorgEpochs reports MAX(reorg_epochs.epoch) per chain — INFORMATIONAL
// only in the rewind detector (brief §8): PruneAckedReorgEpochs deletes acked
// epochs, so a rewind+ack+prune cycle completing mid-run leaves this MAX
// unchanged. The gate is acked_epoch, never this.
func MaxReorgEpochs(ctx context.Context, q Querier) (map[int64]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT chain_id, MAX(epoch) FROM reorg_epochs GROUP BY chain_id`)
	if err != nil {
		return nil, fmt.Errorf("query reorg epochs: %w", err)
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var chainID, epoch int64
		if err := rows.Scan(&chainID, &epoch); err != nil {
			return nil, fmt.Errorf("scan reorg epoch: %w", err)
		}
		out[chainID] = epoch
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reorg epochs: %w", err)
	}
	return out, nil
}

// ReconHighestLogAtOrBelow finds the greatest raw_logs block ≤ atOrBelow on a
// chain and its stored block hash — the fork-weld anchor (brief §3.1). The
// Querier-taking twin of Store.HighestLogAtOrBelow, per the §5 contract.
func ReconHighestLogAtOrBelow(ctx context.Context, q Querier, chainID int64, atOrBelow uint64) (block uint64, blockHash []byte, found bool, err error) {
	err = q.QueryRow(ctx,
		`SELECT block_number, block_hash FROM raw_logs
		 WHERE chain_id = $1 AND block_number <= $2
		 ORDER BY block_number DESC LIMIT 1`,
		chainID, atOrBelow).Scan(&block, &blockHash)
	if err == pgx.ErrNoRows {
		return 0, nil, false, nil
	}
	if err != nil {
		return 0, nil, false, fmt.Errorf("highest raw log ≤ %d on chain %d: %w", atOrBelow, chainID, err)
	}
	return block, blockHash, true, nil
}

// AsOfSum is one (account, asset, side) as-of aggregate: SUM(delta) over
// position_events at block_number ≤ P (brief §3.2). Asset may be empty for
// record-only rows carrying no asset — callers filter as needed.
type AsOfSum struct {
	Account []byte
	Asset   []byte
	Side    string
	Total   *big.Int
}

// AsOfEventSums computes the derived figures: SUM(delta) grouped by
// (account, asset, side) over engine's position_events with block_number ≤
// maxBlock and delta IS NOT NULL, restricted to accounts. The boundary is ≤
// (inclusive): the pin P is the derive cursor, and ApplyDerived commits
// events THROUGH the cursor block atomically with it, so an event AT P is
// part of the state the pin certifies. Sums include EVERY delta-bearing
// event_type — migration_genesis above all (the majority of DM debt genesis
// is event-invisible on the log stream and enters derived state only through
// those rows; recon/derivation-notes.md "Migration finding").
func AsOfEventSums(ctx context.Context, q Querier, engine string, accounts [][]byte, maxBlock uint64) ([]AsOfSum, error) {
	rows, err := q.Query(ctx,
		`SELECT account, COALESCE(asset, ''::bytea), side, SUM(delta) AS total
		 FROM position_events
		 WHERE engine = $1 AND account = ANY($2::bytea[])
		       AND block_number <= $3 AND delta IS NOT NULL
		 GROUP BY account, asset, side
		 ORDER BY account, asset, side`,
		engine, accounts, maxBlock)
	if err != nil {
		return nil, fmt.Errorf("query as-of sums for %q: %w", engine, err)
	}
	defer rows.Close()
	var out []AsOfSum
	for rows.Next() {
		var s AsOfSum
		var total pgtype.Numeric
		if err := rows.Scan(&s.Account, &s.Asset, &s.Side, &total); err != nil {
			return nil, fmt.Errorf("scan as-of sum: %w", err)
		}
		v, err := NumericToBigInt(total)
		if err != nil {
			return nil, fmt.Errorf("as-of sum for account %x asset %x: %w", s.Account, s.Asset, err)
		}
		s.Total = v
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate as-of sums: %w", err)
	}
	return out, nil
}

// DMBorrowerRow is one debt-manager borrower as the sampling query classifies
// it (brief §2): a disjoint precedence stratum (liquidated > migrated >
// post_migration), a live/zero split on the net normalized sum, and the
// residue/fully-liquidated markers the residue sub-target reads.
type DMBorrowerRow struct {
	AccountHex      string
	Stratum         string
	Live            bool
	Net             *big.Int
	Residue         bool
	FullyLiquidated bool
}

// sampleDMBorrowersSQL is the brief §2 classification query (schema-bound:
// engine/side/event_type literals match internal/derive's constants). The
// ORDER BY is a SEED-FREE retrieval contract — stratum (bytewise: liquidated
// < migrated < post_migration), live-first, then account — a pure function
// of DB-at-P alone. The md5(seed||account) ordering moved to cmd/reconcile's
// orderPopulation (round-10 F5): the default seed is the OP pin hash, an RPC
// fact, and NO network call may run while the repeatable-read snapshot is
// open, so the snapshot returns the classified population and the seed
// ordering happens in Go after commit — same composite semantics, same
// reproducibility (same pin + same seed ⇒ identical sample).
const sampleDMBorrowersSQL = `
WITH debt AS (
  SELECT account,
         SUM(delta)                                AS net,
         BOOL_OR(event_type = 'migration_genesis') AS migrated,
         BOOL_OR(event_type = 'liquidation')       AS liquidated,
         BOOL_OR(event_type = 'residue_zeroed')    AS residue
  FROM position_events
  WHERE engine = 'debt_manager' AND side = 'debt'
        AND delta IS NOT NULL AND block_number <= $1
  GROUP BY account
)
SELECT encode(account,'hex') AS account,
       CASE WHEN liquidated THEN 'liquidated'
            WHEN migrated  THEN 'migrated'
            ELSE 'post_migration' END AS stratum,
       (net <> 0) AS live, net, residue,
       (liquidated AND net = 0) AS fully_liquidated
FROM debt
ORDER BY stratum, (net <> 0) DESC, account`

// SampleDMBorrowers runs the stratified classification query at pin
// maxBlock, returning EVERY borrower in a deterministic seed-free order
// (the Go-side orderPopulation + quota selection in cmd/reconcile consume
// it; this returns the classified population so strata counts land in the
// artifact's counts section too).
func SampleDMBorrowers(ctx context.Context, q Querier, maxBlock uint64) ([]DMBorrowerRow, error) {
	rows, err := q.Query(ctx, sampleDMBorrowersSQL, maxBlock)
	if err != nil {
		return nil, fmt.Errorf("query dm borrower sample: %w", err)
	}
	defer rows.Close()
	var out []DMBorrowerRow
	for rows.Next() {
		var r DMBorrowerRow
		var net pgtype.Numeric
		if err := rows.Scan(&r.AccountHex, &r.Stratum, &r.Live, &net, &r.Residue, &r.FullyLiquidated); err != nil {
			return nil, fmt.Errorf("scan dm borrower row: %w", err)
		}
		v, err := NumericToBigInt(net)
		if err != nil {
			return nil, fmt.Errorf("net for account %s: %w", r.AccountHex, err)
		}
		r.Net = v
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate dm borrower rows: %w", err)
	}
	return out, nil
}

// ReconRowCounts is the artifact's counts section (brief §9): population
// figures a reviewer needs to see the run was against a real, complete
// database — and the W1 "row/position counts recorded" clause.
type ReconRowCounts struct {
	RawLogsPerChain           map[int64]int64
	PositionEventsPerEngine   map[string]int64
	BalancesPerEngineSource   map[string]int64 // key "engine/source"
	RateIndexesPerEngineKind  map[string]int64 // key "engine/kind"
	MigrationGenesisRows      int64
	MigrationGenesisDistinct  int64
	NullAssetDeltaBearingRows int64
	// SidelessDeltaBearingRows counts rows with delta IS NOT NULL AND side=''
	// — expected 0. Named sub-assertion for scan 2's deliberately-wide ev
	// predicate (risk-quant F3): the fold predicate (derive.go, live and
	// rebuild) is `side <> '' AND delta IS NOT NULL`, so a delta-bearing
	// side-less row is one the fold silently DROPS while scan 2 surfaces it
	// as an ev-orphan; this count classifies that divergence as a
	// taxonomy-violation by name instead of leaving it to read as join noise.
	SidelessDeltaBearingRows int64
	// BorrowPriceSourceCensus counts debt_manager borrow events grouped by
	// payload->>'price_source' (risk-quant F6): the deriver stamps every
	// borrow's USD-conversion provenance (stable_snap_1e6 for snap-priced
	// stables), and Task 9's reconcile IS the sampled evidence that posture
	// promised, so the artifact records the census line. Detection limit,
	// stated per the deriver's own doc: the snap holds only within the ±1%
	// band — an out-of-band borrow would surface as drift, classified
	// stable-snap-suspect (a diagnosis hypothesis, never a tolerance).
	BorrowPriceSourceCensus map[string]int64
}

// CountReconRows gathers the counts section in one snapshot-scoped pass.
// MigrationGenesisRows is the SEED-ROW count the §2 precondition gates at
// 7,337 — deliberately COUNT(*), never COUNT(DISTINCT account) (L0-3/L2-8:
// 7,337 is positions across 80 batches; account uniqueness is unproven).
// MigrationGenesisDistinct is recorded alongside; a gap between them is a
// FINDING for adjudication, never normalized away.
func CountReconRows(ctx context.Context, q Querier) (*ReconRowCounts, error) {
	c := &ReconRowCounts{
		RawLogsPerChain:          map[int64]int64{},
		PositionEventsPerEngine:  map[string]int64{},
		BalancesPerEngineSource:  map[string]int64{},
		RateIndexesPerEngineKind: map[string]int64{},
	}
	rows, err := q.Query(ctx, `SELECT chain_id, COUNT(*) FROM raw_logs GROUP BY chain_id`)
	if err != nil {
		return nil, fmt.Errorf("count raw_logs: %w", err)
	}
	for rows.Next() {
		var chainID, n int64
		if err := rows.Scan(&chainID, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan raw_logs count: %w", err)
		}
		c.RawLogsPerChain[chainID] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate raw_logs counts: %w", err)
	}
	rows.Close()

	rows, err = q.Query(ctx, `SELECT engine, COUNT(*) FROM position_events GROUP BY engine`)
	if err != nil {
		return nil, fmt.Errorf("count position_events: %w", err)
	}
	for rows.Next() {
		var engine string
		var n int64
		if err := rows.Scan(&engine, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan position_events count: %w", err)
		}
		c.PositionEventsPerEngine[engine] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate position_events counts: %w", err)
	}
	rows.Close()

	rows, err = q.Query(ctx, `SELECT engine, source, COUNT(*) FROM position_balances GROUP BY engine, source`)
	if err != nil {
		return nil, fmt.Errorf("count position_balances: %w", err)
	}
	for rows.Next() {
		var engine, source string
		var n int64
		if err := rows.Scan(&engine, &source, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan position_balances count: %w", err)
		}
		c.BalancesPerEngineSource[engine+"/"+source] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate position_balances counts: %w", err)
	}
	rows.Close()

	rows, err = q.Query(ctx, `SELECT engine, kind, COUNT(*) FROM rate_indexes GROUP BY engine, kind`)
	if err != nil {
		return nil, fmt.Errorf("count rate_indexes: %w", err)
	}
	for rows.Next() {
		var engine, kind string
		var n int64
		if err := rows.Scan(&engine, &kind, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan rate_indexes count: %w", err)
		}
		c.RateIndexesPerEngineKind[engine+"/"+kind] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rate_indexes counts: %w", err)
	}
	rows.Close()

	if err := q.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(DISTINCT account) FROM position_events
		 WHERE engine = 'debt_manager' AND event_type = 'migration_genesis'`).
		Scan(&c.MigrationGenesisRows, &c.MigrationGenesisDistinct); err != nil {
		return nil, fmt.Errorf("count migration_genesis: %w", err)
	}
	if err := q.QueryRow(ctx,
		`SELECT COUNT(*) FROM position_events WHERE delta IS NOT NULL AND asset IS NULL`).
		Scan(&c.NullAssetDeltaBearingRows); err != nil {
		return nil, fmt.Errorf("count null-asset delta rows: %w", err)
	}
	if err := q.QueryRow(ctx,
		`SELECT COUNT(*) FROM position_events WHERE delta IS NOT NULL AND side = ''`).
		Scan(&c.SidelessDeltaBearingRows); err != nil {
		return nil, fmt.Errorf("count side-less delta rows: %w", err)
	}
	rows, err = q.Query(ctx,
		`SELECT COALESCE(payload->>'price_source', '(absent)'), COUNT(*)
		 FROM position_events
		 WHERE engine = 'debt_manager' AND event_type = 'borrow'
		 GROUP BY 1`)
	if err != nil {
		return nil, fmt.Errorf("count borrow price sources: %w", err)
	}
	c.BorrowPriceSourceCensus = map[string]int64{}
	for rows.Next() {
		var source string
		var n int64
		if err := rows.Scan(&source, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan borrow price source count: %w", err)
		}
		c.BorrowPriceSourceCensus[source] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate borrow price source counts: %w", err)
	}
	rows.Close()
	return c, nil
}

// AssetNetSum is one per-asset aggregate over ALL accounts — the derived
// side of the F1 aggregate completeness weld (risk-quant consult, BLOCKING):
// the sampling universe is position_events, so a never-derived borrower is
// structurally unselectable by ANY stratum, and only an aggregate weld
// against the contract's own total can catch that phantom-debt class.
type AssetNetSum struct {
	Asset []byte
	Total *big.Int
}

// AssetNetSums computes SUM(delta) per asset over ALL accounts of (engine,
// side) at block ≤ maxBlock. There is deliberately NO account filter in this
// query — the weld's entire value is that its census is the whole table, not
// the sample (mutation target: a weld computed over sampled-accounts-only
// must be killed by TestComputeDMWeldInputsCoversAllAccounts).
func AssetNetSums(ctx context.Context, q Querier, engine, side string, maxBlock uint64) ([]AssetNetSum, error) {
	rows, err := q.Query(ctx,
		`SELECT asset, SUM(delta) FROM position_events
		 WHERE engine = $1 AND side = $2 AND delta IS NOT NULL
		       AND asset IS NOT NULL AND block_number <= $3
		 GROUP BY asset ORDER BY asset`,
		engine, side, maxBlock)
	if err != nil {
		return nil, fmt.Errorf("query asset net sums for %q/%q: %w", engine, side, err)
	}
	defer rows.Close()
	var out []AssetNetSum
	for rows.Next() {
		var s AssetNetSum
		var total pgtype.Numeric
		if err := rows.Scan(&s.Asset, &total); err != nil {
			return nil, fmt.Errorf("scan asset net sum: %w", err)
		}
		v, err := NumericToBigInt(total)
		if err != nil {
			return nil, fmt.Errorf("asset net sum for %x: %w", s.Asset, err)
		}
		s.Total = v
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate asset net sums: %w", err)
	}
	return out, nil
}

// ResidueZeroedAssets reports which (account, asset) pairs among accounts
// carry a residue_zeroed event at block ≤ maxBlock, keyed by lowercase hex
// account then asset. The F2 residue classification requires per-TOKEN
// presence (risk-quant F2: a discrepancy is residue-shaped only when NO
// residue_zeroed event exists for that exact (account, token) — an
// account-level flag would mask a second token's genuine drift).
func ResidueZeroedAssets(ctx context.Context, q Querier, accounts [][]byte, maxBlock uint64) (map[string]map[string]bool, error) {
	rows, err := q.Query(ctx,
		`SELECT DISTINCT account, asset FROM position_events
		 WHERE engine = 'debt_manager' AND event_type = 'residue_zeroed'
		       AND account = ANY($1::bytea[]) AND block_number <= $2 AND asset IS NOT NULL`,
		accounts, maxBlock)
	if err != nil {
		return nil, fmt.Errorf("query residue_zeroed assets: %w", err)
	}
	defer rows.Close()
	out := map[string]map[string]bool{}
	for rows.Next() {
		var account, asset []byte
		if err := rows.Scan(&account, &asset); err != nil {
			return nil, fmt.Errorf("scan residue_zeroed row: %w", err)
		}
		acct := hex.EncodeToString(account)
		if out[acct] == nil {
			out[acct] = map[string]bool{}
		}
		out[acct][hex.EncodeToString(asset)] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate residue_zeroed rows: %w", err)
	}
	return out, nil
}

// StableSnapBorrowPresence reports, per sampled account (lowercase hex),
// how many of its debt_manager borrow events at block ≤ maxBlock carry
// payload price_source = 'stable_snap_1e6' — the input for the
// stable-snap-suspect diagnosis class (risk-quant F6).
func StableSnapBorrowPresence(ctx context.Context, q Querier, accounts [][]byte, maxBlock uint64) (map[string]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT account, COUNT(*) FROM position_events
		 WHERE engine = 'debt_manager' AND event_type = 'borrow'
		       AND account = ANY($1::bytea[]) AND block_number <= $2
		       AND payload->>'price_source' = 'stable_snap_1e6'
		 GROUP BY account`,
		accounts, maxBlock)
	if err != nil {
		return nil, fmt.Errorf("query stable-snap borrow presence: %w", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var account []byte
		var n int64
		if err := rows.Scan(&account, &n); err != nil {
			return nil, fmt.Errorf("scan stable-snap presence row: %w", err)
		}
		out[hex.EncodeToString(account)] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stable-snap presence rows: %w", err)
	}
	return out, nil
}

// InternalMismatch is one internal-inconsistency row (brief §3.2's judge
// correction): inside the snapshot the cursor equals P by construction, so
// position_balances(source='event') must equal the as-of sums for every
// sampled account. A mismatch localizes an indexer bug at exactly the
// certified accounts — class internal_inconsistency, gated, exit 1.
type InternalMismatch struct {
	Account  []byte
	Asset    []byte
	Side     string
	EventSum string // decimal text; "" when the side has no row
	Balance  string // decimal text; "" when the side has no row
}

// EventBalanceInternalCheck compares as-of event sums at maxBlock against
// event-source position_balances rows for the given accounts, both sides via
// FULL OUTER JOIN, strict IS DISTINCT FROM (the same discipline as invariant
// scan 2 — an amount-0 balance row with no event rows IS a mismatch).
func EventBalanceInternalCheck(ctx context.Context, q Querier, engine string, accounts [][]byte, maxBlock uint64) ([]InternalMismatch, error) {
	rows, err := q.Query(ctx, `
		WITH ev AS (
		  SELECT account, asset, side, SUM(delta) AS total
		  FROM position_events
		  WHERE engine = $1 AND account = ANY($2::bytea[])
		        AND block_number <= $3 AND delta IS NOT NULL AND side <> ''
		  GROUP BY account, asset, side
		), bal AS (
		  SELECT account, asset, side, amount
		  FROM position_balances
		  WHERE engine = $1 AND account = ANY($2::bytea[]) AND source = 'event'
		)
		SELECT COALESCE(ev.account, bal.account),
		       COALESCE(ev.asset, bal.asset),
		       COALESCE(ev.side, bal.side),
		       ev.total::text, bal.amount::text
		FROM ev FULL OUTER JOIN bal
		  ON bal.account = ev.account AND bal.asset = ev.asset AND bal.side = ev.side
		WHERE ev.total IS DISTINCT FROM bal.amount
		ORDER BY 1, 2, 3`,
		engine, accounts, maxBlock)
	if err != nil {
		return nil, fmt.Errorf("internal event/balance check for %q: %w", engine, err)
	}
	defer rows.Close()
	var out []InternalMismatch
	for rows.Next() {
		var m InternalMismatch
		var evTotal, balAmount *string
		if err := rows.Scan(&m.Account, &m.Asset, &m.Side, &evTotal, &balAmount); err != nil {
			return nil, fmt.Errorf("scan internal mismatch: %w", err)
		}
		if evTotal != nil {
			m.EventSum = *evTotal
		}
		if balAmount != nil {
			m.Balance = *balAmount
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate internal mismatches: %w", err)
	}
	return out, nil
}

// AccountFreshness is one registry account's sweep status, LEFT JOINED from
// the registry so never-swept accounts are VISIBLE rows, not absent ones
// (brief §7 / L0-6: aggregates computed on snapshot_sweeps alone are vacuous
// for accounts the sweeper never reached).
type AccountFreshness struct {
	Account          []byte
	HasRow           bool
	Status           string
	LastSuccessBlock uint64
	LastSuccessAt    *time.Time
	Generation       int64
	Attempts         int64
}

// SnapshotFreshnessRows reads the registry (distinct debt-side accounts —
// the SnapshotAccounts shape) LEFT JOIN snapshot_sweeps, ordered by account.
func SnapshotFreshnessRows(ctx context.Context, q Querier, engine string) ([]AccountFreshness, error) {
	rows, err := q.Query(ctx, `
		SELECT e.account, s.account IS NOT NULL,
		       COALESCE(s.status, ''), COALESCE(s.last_success_block, 0),
		       s.last_success_at, COALESCE(s.generation, 0), COALESCE(s.attempts, 0)
		FROM (SELECT DISTINCT account FROM position_events WHERE engine = $1 AND side = 'debt') e
		LEFT JOIN snapshot_sweeps s ON s.engine = $1 AND s.account = e.account
		ORDER BY e.account`, engine)
	if err != nil {
		return nil, fmt.Errorf("query snapshot freshness for %q: %w", engine, err)
	}
	defer rows.Close()
	var out []AccountFreshness
	for rows.Next() {
		var f AccountFreshness
		var at pgtype.Timestamptz
		if err := rows.Scan(&f.Account, &f.HasRow, &f.Status, &f.LastSuccessBlock, &at, &f.Generation, &f.Attempts); err != nil {
			return nil, fmt.Errorf("scan freshness row: %w", err)
		}
		if at.Valid {
			t := at.Time
			f.LastSuccessAt = &t
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate freshness rows: %w", err)
	}
	return out, nil
}

// SweepGenerationState is the sweep_generations row backing the freshness
// bound: LastPassSeconds is the SAME durable column the daemon's own
// collateralStaleBound hydrates from (brief §7 / L2-9), so reconcile judges
// with the bound the deployment actually achieves.
type SweepGenerationState struct {
	Found             bool
	CurrentGeneration int64
	OpenedAt          *time.Time
	CompletedAt       *time.Time
	LastPassSeconds   *int64
}

// SweepGenerationRow reads engine's sweep_generations row.
func SweepGenerationRow(ctx context.Context, q Querier, engine string) (SweepGenerationState, error) {
	var s SweepGenerationState
	var opened, completed pgtype.Timestamptz
	var lastPass pgtype.Int8
	err := q.QueryRow(ctx,
		`SELECT current_generation, opened_at, completed_at, last_pass_seconds
		 FROM sweep_generations WHERE engine = $1`, engine).
		Scan(&s.CurrentGeneration, &opened, &completed, &lastPass)
	if err == pgx.ErrNoRows {
		return SweepGenerationState{}, nil
	}
	if err != nil {
		return SweepGenerationState{}, fmt.Errorf("read sweep generation for %q: %w", engine, err)
	}
	s.Found = true
	if opened.Valid {
		t := opened.Time
		s.OpenedAt = &t
	}
	if completed.Valid {
		t := completed.Time
		s.CompletedAt = &t
	}
	if lastPass.Valid {
		v := lastPass.Int64
		s.LastPassSeconds = &v
	}
	return s, nil
}

// BalanceRow is one position_balances row with its source and update block —
// the shape the freshness sub-checks read (zero-collateral conditional:
// IF snapshot rows exist, updated_block == last_success_block).
type BalanceRow struct {
	AssetHex     string
	Side         string
	Source       string
	Amount       *big.Int
	UpdatedBlock uint64
}

// ReconBalancesForAccounts reads every position_balances row for (engine,
// each account) with source and updated_block IN ONE snapshot-scoped query
// (round-10 F5: the per-sample balance reads must all happen inside the
// snapshot, and the sample is only known after commit — so the whole
// candidate population is read here and filtered in Go). It enforces the
// SAME source-exclusivity invariant as Store.BalancesFor per account: any
// (asset, side) present under BOTH sources marks that account conflicted
// (brief §7's source-exclusivity probe) — its message is returned under the
// account's hex key and its rows are withheld, exactly the per-account
// semantics the old single-account reader had.
func ReconBalancesForAccounts(ctx context.Context, q Querier, engine string, accounts [][]byte) (map[string][]BalanceRow, map[string]string, error) {
	rows, err := q.Query(ctx,
		`SELECT account, asset, side, source, amount, updated_block
		 FROM position_balances WHERE engine = $1 AND account = ANY($2::bytea[])
		 ORDER BY account, asset, side, source`, engine, accounts)
	if err != nil {
		return nil, nil, fmt.Errorf("query balances for %q: %w", engine, err)
	}
	defer rows.Close()
	out := map[string][]BalanceRow{}
	conflicts := map[string]string{}
	seen := map[string]string{} // acct/asset/side → source
	for rows.Next() {
		var account, asset []byte
		var r BalanceRow
		var amount pgtype.Numeric
		if err := rows.Scan(&account, &asset, &r.Side, &r.Source, &amount, &r.UpdatedBlock); err != nil {
			return nil, nil, fmt.Errorf("scan balance row: %w", err)
		}
		v, err := NumericToBigInt(amount)
		if err != nil {
			return nil, nil, fmt.Errorf("balance for %x/%s: %w", asset, r.Side, err)
		}
		r.Amount = v
		r.AssetHex = hex.EncodeToString(asset)
		acct := hex.EncodeToString(account)
		key := acct + "/" + r.AssetHex + "/" + r.Side
		if prev, dup := seen[key]; dup && prev != r.Source {
			if _, done := conflicts[acct]; !done {
				conflicts[acct] = fmt.Sprintf("%v: engine %q account %x asset %s side %q has both event- and snapshot-sourced rows",
					ErrBalanceSourceConflict, engine, account, r.AssetHex, r.Side)
			}
			continue
		}
		seen[key] = r.Source
		out[acct] = append(out[acct], r)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate balance rows: %w", err)
	}
	for acct := range conflicts {
		delete(out, acct) // a conflicted account reports the conflict, never rows
	}
	return out, conflicts, nil
}

// CollateralHistoryAt is one account's snapshots history document at exactly
// its sweep's last_success_block — the deep collateral replay's stable,
// race-free comparison target (brief §7 / derive.go's ApplySweepBatch writes
// it atomically with the balances at the multicall execution block).
type CollateralHistoryAt struct {
	Block uint64
	Doc   map[string]string
}

// CollateralHistoryDocsAtLastSuccess reads, for EVERY engine account with a
// successful sweep, the snapshots history document at exactly
// last_success_block (side='collateral'), keyed by lowercase hex account.
// One snapshot-scoped query (round-10 F5): replay targets are chosen from
// the SAMPLE, which exists only after the snapshot commits, so the candidate
// documents are all read here and the post-commit selection picks from the
// map. Accounts whose document is absent are simply not in the map — the
// same skip semantics the old per-account read had.
func CollateralHistoryDocsAtLastSuccess(ctx context.Context, q Querier, engine string) (map[string]CollateralHistoryAt, error) {
	rows, err := q.Query(ctx,
		`SELECT s.account, s.last_success_block, sn.balances
		 FROM snapshot_sweeps s
		 JOIN snapshots sn ON sn.engine = s.engine AND sn.account = s.account
		      AND sn.block_number = s.last_success_block AND sn.side = 'collateral'
		 WHERE s.engine = $1 AND s.status = 'success' AND s.last_success_block > 0
		 ORDER BY s.account`, engine)
	if err != nil {
		return nil, fmt.Errorf("query collateral history docs for %q: %w", engine, err)
	}
	defer rows.Close()
	out := map[string]CollateralHistoryAt{}
	for rows.Next() {
		var account []byte
		var block uint64
		var doc map[string]any
		if err := rows.Scan(&account, &block, &doc); err != nil {
			return nil, fmt.Errorf("scan collateral history row: %w", err)
		}
		h := CollateralHistoryAt{Block: block, Doc: map[string]string{}}
		if inner, ok := doc["balances"].(map[string]any); ok {
			for k, v := range inner {
				s, ok := v.(string)
				if !ok {
					return nil, fmt.Errorf("collateral history for %x at %d: balance %q is %T, not a string", account, block, k, v)
				}
				h.Doc[k] = s
			}
		}
		out[hex.EncodeToString(account)] = h
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate collateral history rows: %w", err)
	}
	return out, nil
}

// LatestRateIndexAt is the Querier-taking twin of Store.LatestRateIndex:
// the latest rate_indexes value of kind for (engine, asset) at block ≤
// atOrBelow.
func LatestRateIndexAt(ctx context.Context, q Querier, engine string, asset []byte, atOrBelow uint64, kind string) (*big.Int, uint64, bool, error) {
	var value pgtype.Numeric
	var block uint64
	err := q.QueryRow(ctx, `SELECT value, block_number FROM rate_indexes
		WHERE engine = $1 AND asset = $2 AND kind = $3 AND block_number <= $4
		ORDER BY block_number DESC LIMIT 1`,
		engine, asset, kind, atOrBelow).Scan(&value, &block)
	if err == pgx.ErrNoRows {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, fmt.Errorf("latest rate index %s/%x: %w", kind, asset, err)
	}
	v, err := NumericToBigInt(value)
	if err != nil {
		return nil, 0, false, fmt.Errorf("rate index %s/%x: %w", kind, asset, err)
	}
	return v, block, true, nil
}

// APYObservation is the latest borrow-APY figure at or below a block,
// sourced from position_events PAYLOADS — which ARE persisted — because
// rate_indexes(kind='borrow_apy') is never written (brief §3.6 / L0-1:
// runner.go deliberately does not collect DMBorrowApySet). Source names
// which payload field supplied the value.
type APYObservation struct {
	Value  *big.Int
	Block  uint64
	Source string // "borrow_apy_set.new_apy" or "borrow_token_config_set.borrow_apy"
}

// LatestAPYObservation finds the newest APY observation ≤ atOrBelow for a
// debt-manager borrow token, across both persisting event payloads, ordered
// by (block_number, log_index, seq) so a same-block config+set pair resolves
// to the later log. Pairing assumption (documented in the brief §3.6):
// setBorrowApy reindexes before changing the rate, so the latest APY at ≤ P
// is the accrual rate in force since the latest InterestIndexUpdated block.
func LatestAPYObservation(ctx context.Context, q Querier, asset []byte, atOrBelow uint64) (*APYObservation, error) {
	var eventType, value string
	var block uint64
	err := q.QueryRow(ctx, `
		SELECT event_type,
		       CASE WHEN event_type = 'borrow_apy_set' THEN payload->>'new_apy'
		            ELSE payload->>'borrow_apy' END,
		       block_number
		FROM position_events
		WHERE engine = 'debt_manager' AND asset = $1 AND block_number <= $2
		      AND event_type IN ('borrow_apy_set', 'borrow_token_config_set')
		ORDER BY block_number DESC, log_index DESC, seq DESC
		LIMIT 1`, asset, atOrBelow).Scan(&eventType, &value, &block)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest apy observation for %x: %w", asset, err)
	}
	v, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return nil, fmt.Errorf("apy payload for %x at %d: %q is not an integer", asset, block, value)
	}
	source := "borrow_token_config_set.borrow_apy"
	if eventType == "borrow_apy_set" {
		source = "borrow_apy_set.new_apy"
	}
	return &APYObservation{Value: v, Block: block, Source: source}, nil
}

// AaveIntervalEventCount counts engine position_events for the given
// accounts with lo < block_number ≤ hi — golden Row C's interval-quiescence
// figure (brief §4): expected 0 between the W1 pin and the fixture pin, so a
// reviewer sees WHY rows A and B agree without constants ever crossing pins.
func AaveIntervalEventCount(ctx context.Context, q Querier, engine string, accounts [][]byte, lo, hi uint64) (int64, error) {
	var n int64
	if err := q.QueryRow(ctx,
		`SELECT COUNT(*) FROM position_events
		 WHERE engine = $1 AND account = ANY($2::bytea[])
		       AND block_number > $3 AND block_number <= $4`,
		engine, accounts, lo, hi).Scan(&n); err != nil {
		return 0, fmt.Errorf("interval event count: %w", err)
	}
	return n, nil
}

// TopDebtAccount is one (account, asset) debt aggregate for the supplementary
// non-gating top-N comparison (brief §3.4).
type TopDebtAccount struct {
	Account []byte
	Asset   []byte
	Total   *big.Int
}

// TopAaveDebtAccounts returns the top-limit (account, asset) pairs by
// absolute as-of scaled debt at maxBlock.
func TopAaveDebtAccounts(ctx context.Context, q Querier, maxBlock uint64, limit int) ([]TopDebtAccount, error) {
	rows, err := q.Query(ctx, `
		SELECT account, asset, SUM(delta) AS total
		FROM position_events
		WHERE engine = 'aave_v3_etherfi' AND side = 'debt'
		      AND delta IS NOT NULL AND block_number <= $1
		GROUP BY account, asset
		ORDER BY ABS(SUM(delta)) DESC, account, asset
		LIMIT $2`, maxBlock, limit)
	if err != nil {
		return nil, fmt.Errorf("query top aave debt accounts: %w", err)
	}
	defer rows.Close()
	var out []TopDebtAccount
	for rows.Next() {
		var t TopDebtAccount
		var total pgtype.Numeric
		if err := rows.Scan(&t.Account, &t.Asset, &total); err != nil {
			return nil, fmt.Errorf("scan top debt account: %w", err)
		}
		v, err := NumericToBigInt(total)
		if err != nil {
			return nil, fmt.Errorf("top debt for %x: %w", t.Account, err)
		}
		t.Total = v
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate top debt accounts: %w", err)
	}
	return out, nil
}

// SortAsOfSums orders sums deterministically (account, asset, side) — a
// helper for artifact stability when callers merge query results.
func SortAsOfSums(sums []AsOfSum) {
	sort.Slice(sums, func(i, j int) bool {
		if c := strings.Compare(string(sums[i].Account), string(sums[j].Account)); c != 0 {
			return c < 0
		}
		if c := strings.Compare(string(sums[i].Asset), string(sums[j].Asset)); c != 0 {
			return c < 0
		}
		return sums[i].Side < sums[j].Side
	})
}
