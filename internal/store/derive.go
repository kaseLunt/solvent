package store

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"reflect"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// PositionEvent is a single derived state-transition record: one raw log,
// decoded and interpreted by an engine's deriver into an account-level
// balance movement (or a record-only event with no balance effect).
//
// Side is one of "collateral", "debt", or "" (record-only: config/ops events
// that carry no balance movement). Delta is signed (positive = increase,
// negative = decrease) and nil for record-only events. Payload carries
// engine-specific decimal-string extras (e.g. liquidation seize amounts by
// tuple) and may be nil.
type PositionEvent struct {
	ChainID     uint64
	Engine      string
	BlockNumber uint64
	TxHash      []byte
	LogIndex    uint32
	EventType   string
	Account     []byte
	Asset       []byte
	Side        string
	Delta       *big.Int
	Payload     map[string]string
}

// NUMERIC round-trip: position_events.delta and position_balances.amount are
// always integers (raw token-unit deltas — no fractional scaling happens
// here; asset decimals are a display/reconciliation concern for later
// tasks). Writing binds a *big.Int via pgtype.Numeric{Exp: 0}, which pgx
// encodes natively (Numeric implements NumericValuer — a plain Go string
// bound to a NUMERIC parameter has no encode plan in pgx's codec and would
// fail). Reading casts the column to ::text in SQL and parses the resulting
// decimal string back into a *big.Int with big.Int.SetString — this sidesteps
// ever having to interpret NUMERIC's Int/Exp scale on the way out, which is
// unnecessary because every value written here has Exp == 0.

// DeriveCursor returns the last block through which engine's derived state
// (position_events + position_balances) is known to be up to date. found is
// false when the engine has never been applied.
func (s *Store) DeriveCursor(ctx context.Context, engine string) (block uint64, found bool, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT last_block FROM derive_cursors WHERE engine = $1`, engine).Scan(&block)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read derive cursor %q: %w", engine, err)
	}
	return block, true, nil
}

// ApplyDerived persists events and advances engine's derive cursor to
// throughBlock, in a single transaction:
//
//   - Each event is inserted into position_events. Replaying an
//     already-persisted (chain_id, tx_hash, log_index) identity with
//     byte-identical fields is a no-op (idempotent); replaying it with any
//     divergent field aborts the whole batch (rollback, no partial effect).
//     This also naturally coalesces/rejects intra-batch duplicates, since
//     each event's existence check sees rows this same call already
//     inserted (same-transaction visibility).
//   - For each newly-inserted event with a non-empty Side and non-nil Delta,
//     Delta is added into position_balances (upsert-add); record-only
//     events (Side == "" or Delta == nil) are stored but never touch
//     balances.
//   - derive_cursors is advanced with the same monotonic guard idiom as
//     SaveBatch's ingest_cursors: regression is refused; re-asserting the
//     same (chain_id, last_block) is accepted (idempotent replay).
func (s *Store) ApplyDerived(ctx context.Context, engine string, chainID uint64, events []PositionEvent, throughBlock uint64) error {
	for _, ev := range events {
		if ev.ChainID != chainID {
			return fmt.Errorf("event %x/%d: chain id %d does not match batch chain id %d",
				ev.TxHash, ev.LogIndex, ev.ChainID, chainID)
		}
		if ev.Engine != engine {
			return fmt.Errorf("event %x/%d: engine %q does not match batch engine %q",
				ev.TxHash, ev.LogIndex, ev.Engine, engine)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, ev := range events {
		existing, found, err := loadPositionEvent(ctx, tx, ev.ChainID, ev.TxHash, ev.LogIndex)
		if err != nil {
			return fmt.Errorf("load existing event %x/%d: %w", ev.TxHash, ev.LogIndex, err)
		}
		if found {
			if !equalPositionEvent(existing, ev) {
				return fmt.Errorf("event %x/%d: divergent replay — refusing batch", ev.TxHash, ev.LogIndex)
			}
			continue // identical replay: already applied, no-op
		}

		payload := ev.Payload
		if payload == nil {
			payload = map[string]string{}
		}
		var deltaParam any
		if ev.Delta != nil {
			deltaParam = pgtype.Numeric{Int: ev.Delta, Exp: 0, Valid: true}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO position_events
			(chain_id, engine, block_number, tx_hash, log_index, event_type, account, asset, side, delta, payload)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			ev.ChainID, ev.Engine, ev.BlockNumber, ev.TxHash, int32(ev.LogIndex), ev.EventType,
			ev.Account, ev.Asset, ev.Side, deltaParam, payload); err != nil {
			return fmt.Errorf("insert event %x/%d: %w", ev.TxHash, ev.LogIndex, err)
		}

		if ev.Side == "" || ev.Delta == nil {
			continue // record-only: no balance effect
		}

		amount := pgtype.Numeric{Int: ev.Delta, Exp: 0, Valid: true}
		if _, err := tx.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, amount, updated_block)
			VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (engine, account, asset, side) DO UPDATE
			SET amount = position_balances.amount + EXCLUDED.amount,
			    updated_block = GREATEST(position_balances.updated_block, EXCLUDED.updated_block)`,
			ev.Engine, ev.Account, ev.Asset, ev.Side, amount, ev.BlockNumber); err != nil {
			return fmt.Errorf("apply balance for event %x/%d: %w", ev.TxHash, ev.LogIndex, err)
		}
	}

	ct, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, updated_at)
		VALUES ($1,$2,$3,now())
		ON CONFLICT (engine) DO UPDATE
		SET chain_id = EXCLUDED.chain_id, last_block = EXCLUDED.last_block, updated_at = now()
		WHERE derive_cursors.last_block < EXCLUDED.last_block
		   OR (derive_cursors.last_block = EXCLUDED.last_block AND derive_cursors.chain_id = EXCLUDED.chain_id)`,
		engine, chainID, throughBlock)
	if err != nil {
		return fmt.Errorf("upsert derive cursor: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("derive cursor regression: engine %q refused move to %d", engine, throughBlock)
	}

	return tx.Commit(ctx)
}

// loadPositionEvent fetches the existing position_events row identified by
// (chainID, txHash, logIndex), if any, for divergence comparison.
func loadPositionEvent(ctx context.Context, tx pgx.Tx, chainID uint64, txHash []byte, logIndex uint32) (PositionEvent, bool, error) {
	var ev PositionEvent
	var deltaText *string
	var payload map[string]string
	err := tx.QueryRow(ctx, `SELECT chain_id, engine, block_number, tx_hash, log_index, event_type,
		account, asset, side, delta::text, payload
		FROM position_events WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3`,
		chainID, txHash, int32(logIndex)).Scan(
		&ev.ChainID, &ev.Engine, &ev.BlockNumber, &ev.TxHash, &ev.LogIndex, &ev.EventType,
		&ev.Account, &ev.Asset, &ev.Side, &deltaText, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return PositionEvent{}, false, nil
	}
	if err != nil {
		return PositionEvent{}, false, err
	}
	if deltaText != nil {
		d, ok := new(big.Int).SetString(*deltaText, 10)
		if !ok {
			return PositionEvent{}, false, fmt.Errorf("parse delta %q: not an integer", *deltaText)
		}
		ev.Delta = d
	}
	ev.Payload = payload
	return ev, true, nil
}

// equalPositionEvent reports whether existing (as persisted) and incoming
// (as offered for replay) carry byte-identical fields under the same PK.
func equalPositionEvent(existing, incoming PositionEvent) bool {
	if existing.Engine != incoming.Engine || existing.BlockNumber != incoming.BlockNumber ||
		existing.EventType != incoming.EventType || existing.Side != incoming.Side {
		return false
	}
	if !bytes.Equal(existing.Account, incoming.Account) || !bytes.Equal(existing.Asset, incoming.Asset) {
		return false
	}
	if !equalBigInt(existing.Delta, incoming.Delta) {
		return false
	}
	return reflect.DeepEqual(normalizePayload(existing.Payload), normalizePayload(incoming.Payload))
}

func equalBigInt(a, b *big.Int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Cmp(b) == 0
}

func normalizePayload(p map[string]string) map[string]string {
	if p == nil {
		return map[string]string{}
	}
	return p
}

// RewindDerived discards engine's derived state above toBlock and rebuilds
// position_balances wholesale from the surviving position_events, in a
// single transaction. derive_cursors is reset to toBlock.
func (s *Store) RewindDerived(ctx context.Context, engine string, chainID uint64, toBlock uint64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`DELETE FROM position_events WHERE engine = $1 AND chain_id = $2 AND block_number > $3`,
		engine, chainID, toBlock); err != nil {
		return fmt.Errorf("delete position events: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM position_balances WHERE engine = $1`, engine); err != nil {
		return fmt.Errorf("clear position balances: %w", err)
	}

	if _, err := tx.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, amount, updated_block)
		SELECT engine, account, asset, side, SUM(delta), MAX(block_number)
		FROM position_events
		WHERE engine = $1 AND side <> '' AND delta IS NOT NULL
		GROUP BY engine, account, asset, side
		HAVING SUM(delta) <> 0`, engine); err != nil {
		return fmt.Errorf("rebuild position balances: %w", err)
	}

	if _, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, updated_at)
		VALUES ($1,$2,$3,now())
		ON CONFLICT (engine) DO UPDATE
		SET chain_id = EXCLUDED.chain_id, last_block = EXCLUDED.last_block, updated_at = now()`,
		engine, chainID, toBlock); err != nil {
		return fmt.Errorf("reset derive cursor: %w", err)
	}

	return tx.Commit(ctx)
}

// BalancesFor returns engine's current position_balances for account, keyed
// by lowercase hex-encoded asset (no "0x" prefix) then by side.
func (s *Store) BalancesFor(ctx context.Context, engine string, account []byte) (map[string]map[string]*big.Int, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT asset, side, amount::text FROM position_balances WHERE engine = $1 AND account = $2`,
		engine, account)
	if err != nil {
		return nil, fmt.Errorf("query balances for %q: %w", engine, err)
	}
	defer rows.Close()

	result := make(map[string]map[string]*big.Int)
	for rows.Next() {
		var asset []byte
		var side, amountText string
		if err := rows.Scan(&asset, &side, &amountText); err != nil {
			return nil, fmt.Errorf("scan balance row: %w", err)
		}
		amount, ok := new(big.Int).SetString(amountText, 10)
		if !ok {
			return nil, fmt.Errorf("parse balance amount %q: not an integer", amountText)
		}
		assetHex := hex.EncodeToString(asset)
		if result[assetHex] == nil {
			result[assetHex] = make(map[string]*big.Int)
		}
		result[assetHex][side] = amount
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate balances for %q: %w", engine, err)
	}
	return result, nil
}
