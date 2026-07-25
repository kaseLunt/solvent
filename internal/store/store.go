package store

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store persists raw chain logs (the source of truth — positions are derived
// state) and per-stream ingest cursors.
//
// Concurrency contract: SINGLE WRITER, ENFORCED at daemon startup via
// AcquireWriterLock (a session-level Postgres advisory lock). One indexer
// process owns all writes; its walkers step sequentially, so SaveBatch and
// Rewind never run concurrently. A second writer process fails fast at
// startup instead of racing — a Rewind racing an in-flight SaveBatch could
// interleave.
//
// Replay semantics: inserts are idempotent on (chain_id, tx_hash, log_index)
// via ON CONFLICT DO NOTHING. Divergent payloads under the same key are
// prevented by the reorg protocol (the walker rewinds and deletes above the
// fork point before re-ingesting), not by this layer; divergent payloads
// under a replayed identity abort the batch (verify-on-conflict).
type Store struct {
	pool *pgxpool.Pool
	// writerConn pins the session holding the writer advisory lock; nil until
	// AcquireWriterLock succeeds. Released in Close.
	writerConn *pgxpool.Conn
}

// writerLockKey is the cluster-wide advisory lock key for the single-writer
// contract: 0x536F6C76, ASCII "Solv". Passed as a bind parameter so the SQL
// works on any Postgres version (hex literals need PG16+).
const writerLockKey = int64(0x536F6C76)

func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// AcquireWriterLock takes the cluster-wide indexer writer lock (advisory key
// 0x536F6C76 "Solv"). Returns an error if another writer holds it. The lock
// is held for the pool session that acquired it; Close releases it.
func (s *Store) AcquireWriterLock(ctx context.Context) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire writer-lock connection: %w", err)
	}
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, writerLockKey).Scan(&locked); err != nil {
		conn.Release()
		return fmt.Errorf("writer lock: %w", err)
	}
	if !locked {
		conn.Release()
		return fmt.Errorf("another indexer process holds the writer lock")
	}
	s.writerConn = conn // pin the locked session for the Store's lifetime
	return nil
}

// CheckWriterLock verifies the writer advisory lock is still held by this
// Store's pinned session — the daemon's per-round liveness re-check (Phase 1
// deferral landed in Task 7). It queries pg_locks ON THE LOCK'S OWN
// CONNECTION: if that session died (server restart, connection kill), the
// query itself fails; if the session is alive but the lock is gone, the
// granted-advisory-row check fails. Either way the caller must treat any
// error as FATAL and exit — a lost lock means another indexer process may
// already be writing, and continuing would violate the single-writer
// contract every store gate read relies on (D-004).
//
// pg_locks encodes a bigint advisory key as classid = high 32 bits, objid =
// low 32 bits, objsubid = 1 (the bigint-form marker).
func (s *Store) CheckWriterLock(ctx context.Context) error {
	if s.writerConn == nil {
		return fmt.Errorf("writer lock liveness: no pinned lock session (AcquireWriterLock has not succeeded)")
	}
	classid := uint32(uint64(writerLockKey) >> 32)
	objid := uint32(uint64(writerLockKey))
	var held bool
	if err := s.writerConn.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM pg_locks
			WHERE locktype = 'advisory' AND granted
			  AND pid = pg_backend_pid()
			  AND classid = $1::oid AND objid = $2::oid AND objsubid = 1
		)`, classid, objid).Scan(&held); err != nil {
		return fmt.Errorf("writer lock liveness check failed (session presumed lost): %w", err)
	}
	if !held {
		return fmt.Errorf("writer lock lost: advisory lock %d is no longer held by this session", writerLockKey)
	}
	return nil
}

func (s *Store) Close() {
	if s.writerConn != nil {
		s.writerConn.Release()
		s.writerConn = nil
	}
	// Closing the pool terminates its sessions, which releases the advisory
	// lock server-side.
	s.pool.Close()
}

type CursorPos struct {
	Block uint64
	Hash  []byte
}

type RawLog struct {
	ChainID     uint64
	BlockNumber uint64
	BlockHash   []byte
	TxHash      []byte
	LogIndex    uint32
	Address     []byte
	Topics      [][]byte
	Data        []byte
}

func (s *Store) Cursor(ctx context.Context, stream string) (*CursorPos, error) {
	var c CursorPos
	err := s.pool.QueryRow(ctx,
		`SELECT last_block, last_block_hash FROM ingest_cursors WHERE stream = $1`,
		stream).Scan(&c.Block, &c.Hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read cursor %q: %w", stream, err)
	}
	return &c, nil
}

// CursorProgress is one worker's DURABLE progress record: the height its cursor
// reached and the database timestamp of the last write that moved it.
//
// It exists so the daemon's readiness surface can fail on a SILENT stall — a
// worker that neither errors nor advances. The timestamp is the database's, not
// the daemon's, so a restart cannot grant a wedged worker a fresh window; that
// was the whole class of defect the health work is closing.
//
// HONEST LIMIT, because this timestamp is an upsert time and not a "progressed"
// time: any write that touches the row refreshes UpdatedAt, including an
// idempotent same-height replay. Neither the raw-log walkers nor the derivation
// runners can produce one (both return early when caught up and only write a
// window they are about to advance past), so for those two it is a faithful
// progress signal. The oracle POLLER can — a frozen endpoint re-applies the same
// execution block every interval — which is exactly why the poller is NOT judged
// by this signal but by whether a NEW poll anchor row came into existence. See
// internal/prices.Poller's block-advance condition.
type CursorProgress struct {
	// Name is the ingest stream name or the derive engine key.
	Name      string
	Block     uint64
	UpdatedAt time.Time
}

// IngestCursorProgress returns every raw-log stream's durable progress record.
func (s *Store) IngestCursorProgress(ctx context.Context) ([]CursorProgress, error) {
	return s.cursorProgress(ctx, `SELECT stream, last_block, updated_at FROM ingest_cursors ORDER BY stream`, "ingest")
}

// DeriveCursorProgress returns every derive (and pseudo-engine) cursor's durable
// progress record.
func (s *Store) DeriveCursorProgress(ctx context.Context) ([]CursorProgress, error) {
	return s.cursorProgress(ctx, `SELECT engine, last_block, updated_at FROM derive_cursors ORDER BY engine`, "derive")
}

func (s *Store) cursorProgress(ctx context.Context, query, kind string) ([]CursorProgress, error) {
	rows, err := s.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("read %s cursor progress: %w", kind, err)
	}
	defer rows.Close()
	var out []CursorProgress
	for rows.Next() {
		var p CursorProgress
		if err := rows.Scan(&p.Name, &p.Block, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan %s cursor progress row: %w", kind, err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate %s cursor progress: %w", kind, err)
	}
	return out, nil
}

// HighestLogAtOrBelow returns the block number and block hash of the most
// recently stored log for chainID at or below height. found is false when
// no such log exists.
func (s *Store) HighestLogAtOrBelow(ctx context.Context, chainID, height uint64) (block uint64, blockHash []byte, found bool, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT block_number, block_hash FROM raw_logs
		 WHERE chain_id = $1 AND block_number <= $2
		 ORDER BY block_number DESC LIMIT 1`,
		chainID, height).Scan(&block, &blockHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, false, nil
	}
	if err != nil {
		return 0, nil, false, fmt.Errorf("highest log at or below %d (chain %d): %w", height, chainID, err)
	}
	return block, blockHash, true, nil
}

// SaveBatch persists logs and advances the stream cursor to tipBlock/tipHash
// in a single transaction. Intra-batch identity collisions are validated
// here (coalesce identical / reject divergent), independent of the walker's
// upstream checks.
func (s *Store) SaveBatch(ctx context.Context, stream string, chainID uint64, logs []RawLog, tipBlock uint64, tipHash []byte) error {
	for _, l := range logs {
		if l.ChainID != chainID {
			return fmt.Errorf("log %x/%d: chain id %d does not match batch chain id %d",
				l.TxHash, l.LogIndex, l.ChainID, chainID)
		}
	}

	logs, err := dedupeBatchLogs(logs)
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if len(logs) > 0 {
		if _, err := tx.Exec(ctx, `CREATE TEMPORARY TABLE batch_logs
			(LIKE raw_logs INCLUDING DEFAULTS) ON COMMIT DROP`); err != nil {
			return fmt.Errorf("temp table: %w", err)
		}

		ingestedAt := time.Now().UTC()
		rows := make([][]any, len(logs))
		for i, l := range logs {
			rows[i] = []any{l.ChainID, l.BlockNumber, l.BlockHash, l.TxHash,
				int32(l.LogIndex), l.Address, l.Topics, l.Data, ingestedAt}
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"batch_logs"},
			[]string{"chain_id", "block_number", "block_hash", "tx_hash",
				"log_index", "address", "topics", "data", "ingested_at"}, pgx.CopyFromRows(rows)); err != nil {
			return fmt.Errorf("copy batch: %w", err)
		}
		var divergent int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM batch_logs b
			JOIN raw_logs r USING (chain_id, tx_hash, log_index)
			WHERE r.block_number <> b.block_number OR r.block_hash <> b.block_hash
			   OR r.address <> b.address OR r.topics <> b.topics OR r.data <> b.data`).Scan(&divergent); err != nil {
			return fmt.Errorf("verify conflicts: %w", err)
		}
		if divergent > 0 {
			return fmt.Errorf("%d replayed log(s) with divergent payload — refusing batch", divergent)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO raw_logs (chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data, ingested_at)
			SELECT chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data, ingested_at FROM batch_logs
			ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`); err != nil {
			return fmt.Errorf("insert batch: %w", err)
		}
	}

	ct, err := tx.Exec(ctx,
		`INSERT INTO ingest_cursors (stream, chain_id, last_block, last_block_hash, updated_at)
		 VALUES ($1,$2,$3,$4,now())
		 ON CONFLICT (stream) DO UPDATE
		 SET chain_id = EXCLUDED.chain_id, last_block = EXCLUDED.last_block,
		     last_block_hash = EXCLUDED.last_block_hash, updated_at = now()
		 WHERE ingest_cursors.last_block < EXCLUDED.last_block
		    OR (ingest_cursors.last_block = EXCLUDED.last_block
		        AND ingest_cursors.chain_id = EXCLUDED.chain_id
		        AND ingest_cursors.last_block_hash = EXCLUDED.last_block_hash)`,
		stream, chainID, tipBlock, tipHash)
	if err != nil {
		return fmt.Errorf("upsert cursor: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("cursor regression: stream %q refused move to %d", stream, tipBlock)
	}
	return tx.Commit(ctx)
}

// dedupeBatchLogs validates intra-batch identity collisions before anything
// is persisted: rows sharing the same (tx_hash, log_index) identity must be
// byte-identical across every field — the second copy is dropped (coalesce)
// — or the whole batch is rejected with an error naming the divergence.
func dedupeBatchLogs(logs []RawLog) ([]RawLog, error) {
	if len(logs) == 0 {
		return logs, nil
	}
	seen := make(map[string]int, len(logs)) // identity -> index into out
	out := make([]RawLog, 0, len(logs))
	for _, l := range logs {
		key := fmt.Sprintf("%x:%d", l.TxHash, l.LogIndex)
		if idx, ok := seen[key]; ok {
			if !equalRawLog(out[idx], l) {
				return nil, fmt.Errorf("divergent duplicate log in batch: %x/%d", l.TxHash, l.LogIndex)
			}
			continue // byte-identical duplicate: coalesce
		}
		seen[key] = len(out)
		out = append(out, l)
	}
	return out, nil
}

// equalRawLog reports whether a and b are byte-identical across every field.
func equalRawLog(a, b RawLog) bool {
	if a.ChainID != b.ChainID || a.BlockNumber != b.BlockNumber || a.LogIndex != b.LogIndex {
		return false
	}
	if !bytes.Equal(a.BlockHash, b.BlockHash) || !bytes.Equal(a.TxHash, b.TxHash) ||
		!bytes.Equal(a.Address, b.Address) || !bytes.Equal(a.Data, b.Data) {
		return false
	}
	if len(a.Topics) != len(b.Topics) {
		return false
	}
	for i := range a.Topics {
		if !bytes.Equal(a.Topics[i], b.Topics[i]) {
			return false
		}
	}
	return true
}

func (s *Store) Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`DELETE FROM raw_logs WHERE chain_id = $1 AND block_number > $2`, chainID, toBlock); err != nil {
		return fmt.Errorf("delete logs: %w", err)
	}
	// Durable reorg coordination: record a reorg epoch INSIDE this same
	// transaction, so the invalidation marker is atomic with the raw-log
	// deletion — a crash after commit leaves derived state provably stale
	// (ApplyDerived refuses to advance any engine on this chain until it
	// re-acks via RewindDerived). Scope is deliberately CHAIN-WIDE, not
	// per-engine/stream: every engine deriving from this chain's logs is
	// invalidated by the rewind, whichever stream detected it.
	if _, err := tx.Exec(ctx,
		`INSERT INTO reorg_epochs (chain_id, rewound_to) VALUES ($1, $2)`,
		chainID, toBlock); err != nil {
		return fmt.Errorf("record reorg epoch: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE ingest_cursors SET last_block = $2, last_block_hash = $3, updated_at = now()
		 WHERE chain_id = $1 AND last_block > $2`,
		chainID, toBlock, hashAtBlock); err != nil {
		return fmt.Errorf("rewind sibling cursors: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO ingest_cursors (stream, chain_id, last_block, last_block_hash, updated_at)
		 VALUES ($1,$2,$3,$4,now())
		 ON CONFLICT (stream) DO UPDATE
		 SET chain_id = EXCLUDED.chain_id, last_block = EXCLUDED.last_block, last_block_hash = EXCLUDED.last_block_hash, updated_at = now()`,
		stream, chainID, toBlock, hashAtBlock); err != nil {
		return fmt.Errorf("reset cursor: %w", err)
	}
	return tx.Commit(ctx)
}
