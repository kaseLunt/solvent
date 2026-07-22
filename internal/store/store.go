package store

import (
	"context"
	"errors"
	"fmt"

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
// fork point before re-ingesting), not by this layer; payload
// verify-on-conflict is planned alongside the batched-insert rework.
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

func (s *Store) SaveBatch(ctx context.Context, stream string, chainID uint64, logs []RawLog, tipBlock uint64, tipHash []byte) error {
	for _, l := range logs {
		if l.ChainID != chainID {
			return fmt.Errorf("log %x/%d: chain id %d does not match batch chain id %d",
				l.TxHash, l.LogIndex, l.ChainID, chainID)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, l := range logs {
		_, err := tx.Exec(ctx,
			`INSERT INTO raw_logs (chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			 ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
			l.ChainID, l.BlockNumber, l.BlockHash, l.TxHash, int32(l.LogIndex), l.Address, l.Topics, l.Data)
		if err != nil {
			return fmt.Errorf("insert log: %w", err)
		}
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO ingest_cursors (stream, chain_id, last_block, last_block_hash, updated_at)
		 VALUES ($1,$2,$3,$4,now())
		 ON CONFLICT (stream) DO UPDATE
		 SET chain_id = EXCLUDED.chain_id, last_block = EXCLUDED.last_block, last_block_hash = EXCLUDED.last_block_hash, updated_at = now()`,
		stream, chainID, tipBlock, tipHash)
	if err != nil {
		return fmt.Errorf("upsert cursor: %w", err)
	}
	return tx.Commit(ctx)
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
