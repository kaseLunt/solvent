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
