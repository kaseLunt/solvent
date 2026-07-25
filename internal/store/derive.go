package store

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"reflect"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Sentinel errors for derived-state persistence refusals. Every refusal path
// wraps its sentinel with %w into a contextual message, so callers branch
// with errors.Is while logs keep full detail. The sentinel texts double as
// the stable message substrings existing callers/tests match on.
var (
	// ErrDeriveCursorChainMismatch: the engine's derive cursor is bound to a
	// different chain than the one the call names.
	ErrDeriveCursorChainMismatch = errors.New("derive cursor chain mismatch")
	// ErrDeriveCursorRegression: the batch's throughBlock is behind the
	// engine's current derive cursor.
	ErrDeriveCursorRegression = errors.New("derive cursor regression")
	// ErrUnackedReorgEpoch: the chain carries a reorg epoch the engine has
	// not acknowledged via RewindDerived (including the no-cursor bootstrap
	// case on a chain with recorded epochs).
	ErrUnackedReorgEpoch = errors.New("unacknowledged reorg epoch")
	// ErrBalanceSourceConflict: one (asset, side) carries both an event- and
	// a snapshot-sourced balance row, violating source exclusivity.
	ErrBalanceSourceConflict = errors.New("event/snapshot balance conflict")
	// ErrStaleSweepBatch: EVERY result in an ApplySweepBatch call was a
	// success observed at an execution block BEHIND its account's recorded
	// last_success_block — a failed-over RPC endpoint lagging the one that
	// served earlier sweeps. Nothing was applied; the snapshotter logs the
	// round DEGRADED and retries, most likely against a caught-up endpoint.
	ErrStaleSweepBatch = errors.New("stale sweep batch: endpoint behind")
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
//
// Seq discriminates multiple derived events fanned out from ONE raw log
// (e.g. a liquidation log interpreted into several seize movements); 0 for
// the common one-event-per-log case. The persisted PK is (chain_id, tx_hash,
// log_index, seq) — engine is deliberately NOT part of it (reviewer
// suggestion adjudicated and refused): under the engine←stream←contract-
// address topology, two engines never derive from the same raw log.
type PositionEvent struct {
	ChainID     uint64
	Engine      string
	BlockNumber uint64
	TxHash      []byte
	LogIndex    uint32
	Seq         uint16
	EventType   string
	Account     []byte
	Asset       []byte
	Side        string
	Delta       *big.Int
	Payload     map[string]string
}

// RateObservation is one rate-index observation persisted ATOMICALLY with its
// derivation window by ApplyDerivedWithRates: the (asset, block, kind, value)
// tuple the runner extracted from the window's decoded events. Kind uses the
// rate_indexes vocabulary ("borrow_index", "variable_borrow_index",
// "liquidity_index", "borrow_apy").
type RateObservation struct {
	Asset []byte
	Block uint64
	Kind  string
	Value *big.Int
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
//   - Chain binding: if the engine's cursor row exists on a different chain,
//     the batch is refused with ErrDeriveCursorChainMismatch BEFORE the
//     epoch gate — a cross-chain batch must never be misread as (or hidden
//     behind) an epoch problem.
//   - Reorg-epoch gate: the chain's max reorg epoch and the engine's
//     acked_epoch are both read inside this same transaction, before any
//     write. If the engine has not acknowledged every epoch on its chain
//     (acked_epoch < max), the batch is refused with ErrUnackedReorgEpoch —
//     its derived state may include blocks the raw rewind already deleted,
//     and only RewindDerived can make it whole. Because the epoch marker is
//     a durable row written atomically by store.Rewind, this refusal
//     survives a crash between the raw rewind and the derived rewind: a
//     restarted process keeps erroring here until the runner performs
//     RewindDerived. An engine with NO cursor row is admitted only when its
//     chain has ZERO recorded epochs (implicit first-write ack: nothing to
//     acknowledge); on a chain with any recorded epoch a new engine must
//     BOOTSTRAP by calling RewindDerived first — that call acks — otherwise
//     a stale pre-rewind batch could slip in unexamined.
//   - Each event is inserted into position_events. Replaying an
//     already-persisted (chain_id, tx_hash, log_index, seq) identity with
//     byte-identical fields is a no-op (idempotent); replaying it with any
//     divergent field aborts the whole batch (rollback, no partial effect).
//     This also naturally coalesces/rejects intra-batch duplicates, since
//     each event's existence check sees rows this same call already
//     inserted (same-transaction visibility). Seq is part of the identity:
//     one raw log may legitimately fan out into several derived events.
//   - For each newly-inserted event with a non-empty Side and non-nil Delta,
//     Delta is added into position_balances (upsert-add, source='event');
//     record-only events (Side == "" or Delta == nil) are stored but never
//     touch balances.
//   - derive_cursors is advanced with the monotonic guard idiom, now chain-
//     bound: the update fires only when the stored cursor's chain matches
//     the batch's chain AND the move is non-regressive. On refusal the two
//     causes are disambiguated by reading the cursor back — a cross-chain
//     batch gets a distinct "derive cursor chain mismatch" error, a height
//     regression keeps "derive cursor regression".
//
// ApplyDerived persists NO rate observations; it is ApplyDerivedWithRates
// with an empty rate set, retained for callers (and tests) that derive
// windows without rate extraction.
func (s *Store) ApplyDerived(ctx context.Context, engine string, chainID uint64, events []PositionEvent, throughBlock uint64) error {
	return s.ApplyDerivedWithRates(ctx, engine, chainID, events, nil, throughBlock)
}

// ApplyDerivedWithRates is ApplyDerived plus the window's rate observations,
// in the SAME transaction: a window either lands with every rate value its
// events carried, or not at all. This closes the crash hole of the old
// persist-rates-then-apply sequence — a crash between the two could strand
// rate rows for a window whose events never committed (or, worse ordering,
// lose observations for a committed window forever once the cursor advanced).
//
// Rate semantics inside the transaction mirror SaveRateIndex exactly: an
// identical replay of an existing (engine, asset, block, kind) key is a
// no-op; a DIVERGENT value under an existing key aborts the WHOLE batch
// (events, balances, cursor and rates all roll back). The caller is expected
// to have last-wins-deduped same-key observations within the batch (the
// runner's rateSet does); intra-batch duplicates that survive to this call
// hit the same divergence check via same-transaction visibility.
func (s *Store) ApplyDerivedWithRates(ctx context.Context, engine string, chainID uint64, events []PositionEvent, rates []RateObservation, throughBlock uint64) error {
	for _, ev := range events {
		if ev.ChainID != chainID {
			return fmt.Errorf("event %x/%d/%d: chain id %d does not match batch chain id %d",
				ev.TxHash, ev.LogIndex, ev.Seq, ev.ChainID, chainID)
		}
		if ev.Engine != engine {
			return fmt.Errorf("event %x/%d/%d: engine %q does not match batch engine %q",
				ev.TxHash, ev.LogIndex, ev.Seq, ev.Engine, engine)
		}
	}
	for _, o := range rates {
		if o.Value == nil {
			return fmt.Errorf("rate observation %s/%x@%d: nil value", o.Kind, o.Asset, o.Block)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Gate reads: chain binding first, then the reorg-epoch gate, both before
	// any write. Their mutual consistency (and consistency with the writes
	// below) rests on the enforced single-writer contract (D-004) — under
	// READ COMMITTED each statement sees its own snapshot, so it is the
	// advisory-lock-enforced absence of concurrent writers, not transaction
	// isolation, that makes the admit/refuse decision sound.
	var storedChain uint64
	var ackedEpoch int64
	cursorExists := true
	err = tx.QueryRow(ctx, `SELECT chain_id, acked_epoch FROM derive_cursors WHERE engine = $1`, engine).Scan(&storedChain, &ackedEpoch)
	if errors.Is(err, pgx.ErrNoRows) {
		cursorExists = false
	} else if err != nil {
		return fmt.Errorf("read derive cursor for %q: %w", engine, err)
	}
	if cursorExists && storedChain != chainID {
		return fmt.Errorf("%w: engine %q is bound to chain %d, refusing batch for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}
	maxEpoch, err := chainMaxEpoch(ctx, tx, chainID)
	if err != nil {
		return err
	}
	if cursorExists && ackedEpoch < maxEpoch {
		return fmt.Errorf("engine %q has %w %d on chain %d (acked %d): rewind derived state before applying",
			engine, ErrUnackedReorgEpoch, maxEpoch, chainID, ackedEpoch)
	}
	if !cursorExists && maxEpoch > 0 {
		// New-engine bootstrap hole closed: no implicit ack when the chain
		// already carries epochs — RewindDerived is the bootstrap entry point.
		return fmt.Errorf("engine %q has no derive cursor and chain %d carries %w %d: bootstrap via RewindDerived before applying",
			engine, chainID, ErrUnackedReorgEpoch, maxEpoch)
	}

	// Rate observations, atomic with the window (SaveRateIndex semantics
	// inside this transaction: identical replay no-op, divergence aborts).
	for _, o := range rates {
		ct, err := tx.Exec(ctx, `INSERT INTO rate_indexes (engine, asset, block_number, kind, value)
			VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT (engine, asset, block_number, kind) DO NOTHING`,
			engine, o.Asset, o.Block, o.Kind, pgtype.Numeric{Int: o.Value, Exp: 0, Valid: true})
		if err != nil {
			return fmt.Errorf("save rate index %s/%x@%d: %w", o.Kind, o.Asset, o.Block, err)
		}
		if ct.RowsAffected() > 0 {
			continue // fresh insert
		}
		// Conflicted with an existing row: idempotent only if the value
		// matches; a divergent value rolls the whole window back.
		var existingText string
		if err := tx.QueryRow(ctx,
			`SELECT value::text FROM rate_indexes WHERE engine = $1 AND asset = $2 AND block_number = $3 AND kind = $4`,
			engine, o.Asset, o.Block, o.Kind).Scan(&existingText); err != nil {
			return fmt.Errorf("read conflicting rate index %s/%x@%d: %w", o.Kind, o.Asset, o.Block, err)
		}
		existing, ok := new(big.Int).SetString(existingText, 10)
		if !ok {
			return fmt.Errorf("parse rate index %q: not an integer", existingText)
		}
		if existing.Cmp(o.Value) != 0 {
			return fmt.Errorf("rate index divergence: %s/%x@%d already holds %s, refusing %s — aborting batch",
				o.Kind, o.Asset, o.Block, existing, o.Value)
		}
	}

	for _, ev := range events {
		existing, found, err := loadPositionEvent(ctx, tx, ev.ChainID, ev.TxHash, ev.LogIndex, ev.Seq)
		if err != nil {
			return fmt.Errorf("load existing event %x/%d/%d: %w", ev.TxHash, ev.LogIndex, ev.Seq, err)
		}
		if found {
			if !equalPositionEvent(existing, ev) {
				return fmt.Errorf("event %x/%d/%d: divergent replay — refusing batch", ev.TxHash, ev.LogIndex, ev.Seq)
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
			(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta, payload)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			ev.ChainID, ev.Engine, ev.BlockNumber, ev.TxHash, int32(ev.LogIndex), int32(ev.Seq), ev.EventType,
			ev.Account, ev.Asset, ev.Side, deltaParam, payload); err != nil {
			return fmt.Errorf("insert event %x/%d/%d: %w", ev.TxHash, ev.LogIndex, ev.Seq, err)
		}

		if ev.Side == "" || ev.Delta == nil {
			continue // record-only: no balance effect
		}

		amount := pgtype.Numeric{Int: ev.Delta, Exp: 0, Valid: true}
		if _, err := tx.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
			VALUES ($1,$2,$3,$4,'event',$5,$6)
			ON CONFLICT (engine, account, asset, side, source) DO UPDATE
			SET amount = position_balances.amount + EXCLUDED.amount,
			    updated_block = GREATEST(position_balances.updated_block, EXCLUDED.updated_block)`,
			ev.Engine, ev.Account, ev.Asset, ev.Side, amount, ev.BlockNumber); err != nil {
			return fmt.Errorf("apply balance for event %x/%d/%d: %w", ev.TxHash, ev.LogIndex, ev.Seq, err)
		}
	}

	// acked_epoch is only ever SET on the insert arm (implicit first-write
	// ack); the update arm leaves it alone — the gate above already proved
	// the existing ack is current, and explicit acks belong to RewindDerived.
	ct, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (engine) DO UPDATE
		SET last_block = EXCLUDED.last_block, updated_at = now()
		WHERE derive_cursors.chain_id = EXCLUDED.chain_id
		  AND derive_cursors.last_block <= EXCLUDED.last_block`,
		engine, chainID, throughBlock, maxEpoch)
	if err != nil {
		return fmt.Errorf("upsert derive cursor: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// The guarded upsert refused; the row must exist (a plain insert
		// affects 1 row). Chain binding was already verified at the top of
		// this transaction, so under the single-writer contract (D-004) the
		// only remaining cause is a height regression — the read-back keeps
		// the disambiguation honest even if that contract were ever violated.
		var refusedChain, storedBlock uint64
		if err := tx.QueryRow(ctx,
			`SELECT chain_id, last_block FROM derive_cursors WHERE engine = $1`, engine).Scan(&refusedChain, &storedBlock); err != nil {
			return fmt.Errorf("derive cursor refused move for %q, and read-back failed: %w", engine, err)
		}
		if refusedChain != chainID {
			return fmt.Errorf("%w: engine %q is bound to chain %d, refusing batch for chain %d",
				ErrDeriveCursorChainMismatch, engine, refusedChain, chainID)
		}
		return fmt.Errorf("%w: engine %q refused move to %d", ErrDeriveCursorRegression, engine, throughBlock)
	}

	return tx.Commit(ctx)
}

// chainMaxEpoch returns the highest reorg epoch recorded for chainID (0 when
// the chain has never been rewound), read inside the caller's transaction.
func chainMaxEpoch(ctx context.Context, tx pgx.Tx, chainID uint64) (int64, error) {
	var max int64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(epoch), 0) FROM reorg_epochs WHERE chain_id = $1`, chainID).Scan(&max); err != nil {
		return 0, fmt.Errorf("read max reorg epoch for chain %d: %w", chainID, err)
	}
	return max, nil
}

// rewindTarget computes the EFFECTIVE rewind target for engine on chainID —
// min(toBlock, deepest rewound_to among epochs above ackedEpoch) — and returns
// the chain's max epoch alongside it, both read inside the caller's
// transaction. When the target is lowered, one WARN names both numbers.
//
// Shared by every rewind-and-ack path (RewindDerived for derived position
// state, RewindPrices for the price writers' cursors) so the epoch arithmetic
// that decides how deep an ack must reach has exactly ONE implementation: an
// ack that reached less deep than the deepest unacknowledged rewind would
// bless rows belonging to blocks the raw rewind already deleted.
//
// Epoch reads rely on the enforced single-writer contract (D-004): under READ
// COMMITTED each statement sees its own snapshot, so it is the absence of
// concurrent writers, not isolation, that makes the pair consistent.
func rewindTarget(ctx context.Context, tx pgx.Tx, engine string, chainID uint64, ackedEpoch int64, toBlock uint64) (effectiveTarget uint64, maxEpoch int64, err error) {
	maxEpoch, err = chainMaxEpoch(ctx, tx, chainID)
	if err != nil {
		return 0, 0, err
	}
	var deepestUnacked uint64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(MIN(rewound_to), $3) FROM reorg_epochs WHERE chain_id = $1 AND epoch > $2`,
		chainID, ackedEpoch, toBlock).Scan(&deepestUnacked); err != nil {
		return 0, 0, fmt.Errorf("read deepest unacked rewind target for chain %d: %w", chainID, err)
	}
	effectiveTarget = min(toBlock, deepestUnacked)
	if effectiveTarget < toBlock {
		slog.Warn("derived rewind target lowered to deepest unacknowledged reorg epoch",
			"engine", engine, "chain", chainID, "callerTarget", toBlock, "effectiveTarget", effectiveTarget)
	}
	return effectiveTarget, maxEpoch, nil
}

// loadPositionEvent fetches the existing position_events row identified by
// (chainID, txHash, logIndex, seq), if any, for divergence comparison.
func loadPositionEvent(ctx context.Context, tx pgx.Tx, chainID uint64, txHash []byte, logIndex uint32, seq uint16) (PositionEvent, bool, error) {
	var ev PositionEvent
	var deltaText *string
	var payload map[string]string
	err := tx.QueryRow(ctx, `SELECT chain_id, engine, block_number, tx_hash, log_index, seq, event_type,
		account, asset, side, delta::text, payload
		FROM position_events WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3 AND seq = $4`,
		chainID, txHash, int32(logIndex), int32(seq)).Scan(
		&ev.ChainID, &ev.Engine, &ev.BlockNumber, &ev.TxHash, &ev.LogIndex, &ev.Seq, &ev.EventType,
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

// RewindDerived discards engine's derived state above the EFFECTIVE rewind
// target and rebuilds its event-sourced position_balances wholesale from the
// surviving position_events, in a single transaction.
//
// The effective target is min(toBlock, deepest unacknowledged rewound_to):
// because this call ACKNOWLEDGES every reorg epoch on the chain, its rebuild
// must reach the DEEPEST block any unacked epoch rewound to — when epochs
// stack (e.g. rewound to 50 then 80), a caller passing 80 must not leave
// events in (50, 80] that predate the deeper rewind while both epochs get
// acked. When the target is lowered, a WARN names both numbers.
//
// derive_cursors is reset to the effective target and acked_epoch is set to
// the chain's max epoch as read in this transaction. The correctness of
// "ack MAX(epoch) after rebuilding to the deepest unacked target" rests on
// the enforced single-writer contract (D-004): no concurrent store.Rewind
// can commit a new epoch between these reads and this commit (READ COMMITTED
// alone would not guarantee that). Any epoch committed after this
// transaction gates the next ApplyDerived again.
//
// Rate-index hygiene is part of this SAME transaction: the engine's
// rate_indexes rows above the effective target are deleted here, atomically
// with the event deletion and the cursor ack — never as a separate follow-up
// call a crash could skip. A post-reorg re-derivation may observe a DIFFERENT
// value at the same (engine, asset, block, kind) key, which the divergence
// refusal would otherwise wedge on forever.
//
// This is also the BOOTSTRAP entry point for a new engine on a chain that
// already carries reorg epochs: ApplyDerived refuses a no-cursor engine on
// such a chain until this call has created its cursor and acked. If a cursor
// row exists on a different chain, the call is refused with
// ErrDeriveCursorChainMismatch before anything is deleted or acked; the
// cursor upsert's conflict arm deliberately never rebinds chain_id.
//
// Snapshot invalidation is part of this SAME transaction: the engine's
// snapshots HISTORY rows above the effective target are deleted (all sides —
// a history row stamped with a replaced block describes a chain that no
// longer exists, debt and collateral alike); then snapshot-sourced
// position_balances rows, snapshot_sweeps status rows AND all remaining
// snapshots history rows are deleted for accounts of this engine left with
// NO surviving debt-side position_events (their registry membership was
// reorged away — keeping their rows would present collateral, sweep status,
// or history for accounts that no longer exist), and the engine's
// sweep_generations.current_generation is bumped. The bump
// durably OPENS the post-rewind re-sweep in the same commit as the epoch ack:
// every surviving account's sweep row now lags the new generation, so a crash
// anywhere after this call still leaves the re-sweep owed and resumable. The
// runner's onRewind hook remains the LIVE fast path only (see
// internal/snapshot).
func (s *Store) RewindDerived(ctx context.Context, engine string, chainID uint64, toBlock uint64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Chain binding first: a wrong-chain call must be refused before any
	// epoch reasoning, deletion, or ack.
	var storedChain uint64
	var ackedEpoch int64
	cursorExists := true
	err = tx.QueryRow(ctx, `SELECT chain_id, acked_epoch FROM derive_cursors WHERE engine = $1`, engine).Scan(&storedChain, &ackedEpoch)
	if errors.Is(err, pgx.ErrNoRows) {
		cursorExists = false
		ackedEpoch = 0 // bootstrap: every epoch on the chain counts as unacked
	} else if err != nil {
		return fmt.Errorf("read derive cursor for %q: %w", engine, err)
	}
	if cursorExists && storedChain != chainID {
		return fmt.Errorf("%w: engine %q is bound to chain %d, refusing rewind for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}

	// Epoch reads rely on the single-writer contract (D-004) — see the doc
	// comment; READ COMMITTED gives no cross-statement snapshot here.
	effectiveTarget, maxEpoch, err := rewindTarget(ctx, tx, engine, chainID, ackedEpoch, toBlock)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM position_events WHERE engine = $1 AND chain_id = $2 AND block_number > $3`,
		engine, chainID, effectiveTarget); err != nil {
		return fmt.Errorf("delete position events: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM position_balances WHERE engine = $1 AND source = 'event'`, engine); err != nil {
		return fmt.Errorf("clear position balances: %w", err)
	}

	// Rate hygiene, atomic with the rewind (see the doc comment): observations
	// above the effective target may describe replaced blocks, and leaving
	// them would wedge re-derivation on the divergence refusal.
	if _, err := tx.Exec(ctx,
		`DELETE FROM rate_indexes WHERE engine = $1 AND block_number > $2`,
		engine, effectiveTarget); err != nil {
		return fmt.Errorf("delete rate indexes above %d: %w", effectiveTarget, err)
	}

	// No HAVING SUM(delta) <> 0 filter: zero-net groups keep their row, so a
	// rewind-rebuild is shape-identical to live application (which leaves an
	// amount=0 row after +X/−X) and readers can distinguish "position
	// closed" from "never had a position".
	if _, err := tx.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
		SELECT engine, account, asset, side, 'event', SUM(delta), MAX(block_number)
		FROM position_events
		WHERE engine = $1 AND chain_id = $2 AND side <> '' AND delta IS NOT NULL
		GROUP BY engine, account, asset, side`, engine, chainID); err != nil {
		return fmt.Errorf("rebuild position balances: %w", err)
	}

	// History hygiene above the effective target (see the doc comment): every
	// snapshots row of this engine stamped with a replaced block — BOTH sides
	// — is deleted with the same commit that acks. Surviving accounts' rows
	// at/below the target are exactly the history the canonical chain still
	// supports; the generation bump below re-observes collateral fresh.
	if _, err := tx.Exec(ctx,
		`DELETE FROM snapshots WHERE engine = $1 AND block_number > $2`,
		engine, effectiveTarget); err != nil {
		return fmt.Errorf("delete snapshot history above %d: %w", effectiveTarget, err)
	}

	// Reorg-orphaned snapshot invalidation (see the doc comment): an account
	// with no surviving debt-side event was never — as far as canonical
	// history is concerned — in the Safe registry, so its snapshot-observed
	// collateral rows, sweep status rows and history rows describe a phantom.
	if _, err := tx.Exec(ctx, `DELETE FROM position_balances pb
		WHERE pb.engine = $1 AND pb.source = 'snapshot'
		  AND NOT EXISTS (
			SELECT 1 FROM position_events e
			WHERE e.engine = $1 AND e.chain_id = $2 AND e.side = 'debt' AND e.account = pb.account
		  )`, engine, chainID); err != nil {
		return fmt.Errorf("delete orphaned snapshot balances: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM snapshot_sweeps sw
		WHERE sw.engine = $1
		  AND NOT EXISTS (
			SELECT 1 FROM position_events e
			WHERE e.engine = $1 AND e.chain_id = $2 AND e.side = 'debt' AND e.account = sw.account
		  )`, engine, chainID); err != nil {
		return fmt.Errorf("delete orphaned sweep status rows: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM snapshots sn
		WHERE sn.engine = $1
		  AND NOT EXISTS (
			SELECT 1 FROM position_events e
			WHERE e.engine = $1 AND e.chain_id = $2 AND e.side = 'debt' AND e.account = sn.account
		  )`, engine, chainID); err != nil {
		return fmt.Errorf("delete orphaned snapshot history rows: %w", err)
	}
	// Durably OPEN the post-rewind re-sweep, atomic with the ack: bump the
	// engine's sweep generation so every surviving account lags it. The same
	// upsert OpenSweepGeneration uses — a crash between this commit and the
	// snapshotter's next Step loses nothing (the open generation IS the
	// durable re-sweep request).
	if _, err := tx.Exec(ctx, `INSERT INTO sweep_generations (engine, current_generation, opened_at, completed_at)
		VALUES ($1, 1, now(), NULL)
		ON CONFLICT (engine) DO UPDATE
		SET current_generation = sweep_generations.current_generation + 1,
		    opened_at = now(), completed_at = NULL`, engine); err != nil {
		return fmt.Errorf("open post-rewind sweep generation: %w", err)
	}

	// The conflict arm never touches chain_id: the binding was verified above
	// and must not be rewritable through a rewind.
	if _, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (engine) DO UPDATE
		SET last_block = EXCLUDED.last_block,
		    acked_epoch = EXCLUDED.acked_epoch, updated_at = now()`,
		engine, chainID, effectiveTarget, maxEpoch); err != nil {
		return fmt.Errorf("reset derive cursor: %w", err)
	}

	return tx.Commit(ctx)
}

// BalancesFor returns engine's current position_balances for account, keyed
// by lowercase hex-encoded asset (no "0x" prefix) then by side.
//
// Source-exclusivity invariant: any one (asset, side) of an engine is owned
// by EXACTLY one balance source — event-derived or snapshot-derived — per
// the engine architecture (debt_manager debt = event, including the
// calldata-decoded genesis loan; debt_manager collateral = snapshot;
// aave_v3_etherfi = event). Both sources present on the same (asset, side)
// means two subsystems both believe they own the figure — an architecture
// violation — so it is refused with ErrBalanceSourceConflict rather than
// letting row scan order nondeterministically pick a winner in the map.
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
		if _, dup := result[assetHex][side]; dup {
			// The PK is (engine, account, asset, side, source), so a repeat of
			// (asset, side) here can only be the event/snapshot dual-source case.
			return nil, fmt.Errorf("%w: engine %q account %x asset %s side %q has both event- and snapshot-sourced rows",
				ErrBalanceSourceConflict, engine, account, assetHex, side)
		}
		result[assetHex][side] = amount
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate balances for %q: %w", engine, err)
	}
	return result, nil
}

// UpsertSnapshotBalances replaces engine's snapshot-sourced balance rows for
// account wholesale, in one transaction: every existing source='snapshot'
// row for the account is deleted, then the given balances (lowercase
// asset-hex → side → amount, the BalancesFor key shape) are inserted with
// updated_block = block. Event-sourced rows and other accounts' snapshots
// are untouched. Wholesale replacement keeps each snapshot self-consistent:
// assets the account no longer holds vanish instead of lingering stale.
func (s *Store) UpsertSnapshotBalances(ctx context.Context, engine string, account []byte, balances map[string]map[string]*big.Int, block uint64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`DELETE FROM position_balances WHERE engine = $1 AND account = $2 AND source = 'snapshot'`,
		engine, account); err != nil {
		return fmt.Errorf("clear snapshot balances for %q: %w", engine, err)
	}

	for assetHex, sides := range balances {
		asset, err := hex.DecodeString(assetHex)
		if err != nil {
			return fmt.Errorf("snapshot asset %q: %w", assetHex, err)
		}
		for side, amount := range sides {
			if amount == nil {
				return fmt.Errorf("snapshot balance %s/%s: nil amount", assetHex, side)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO position_balances
				(engine, account, asset, side, source, amount, updated_block)
				VALUES ($1,$2,$3,$4,'snapshot',$5,$6)`,
				engine, account, asset, side,
				pgtype.Numeric{Int: amount, Exp: 0, Valid: true}, block); err != nil {
				return fmt.Errorf("insert snapshot balance %s/%s: %w", assetHex, side, err)
			}
		}
	}

	return tx.Commit(ctx)
}

// SaveRateIndex records engine's rate observation for asset at block. kind
// is one of "borrow_index", "variable_borrow_index", "liquidity_index",
// "borrow_apy". Idempotent: re-saving the identical value under the same
// (engine, asset, block, kind) key is a no-op; a divergent re-save is
// refused, leaving the original untouched.
func (s *Store) SaveRateIndex(ctx context.Context, engine string, asset []byte, block uint64, kind string, value *big.Int) error {
	if value == nil {
		return fmt.Errorf("rate index %s/%x@%d: nil value", kind, asset, block)
	}
	ct, err := s.pool.Exec(ctx, `INSERT INTO rate_indexes (engine, asset, block_number, kind, value)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (engine, asset, block_number, kind) DO NOTHING`,
		engine, asset, block, kind, pgtype.Numeric{Int: value, Exp: 0, Valid: true})
	if err != nil {
		return fmt.Errorf("save rate index %s/%x@%d: %w", kind, asset, block, err)
	}
	if ct.RowsAffected() > 0 {
		return nil // fresh insert
	}
	// Conflicted with an existing row: idempotent only if the value matches.
	// The enforced single-writer contract means nothing can change between
	// the refused insert and this read.
	var existingText string
	if err := s.pool.QueryRow(ctx,
		`SELECT value::text FROM rate_indexes WHERE engine = $1 AND asset = $2 AND block_number = $3 AND kind = $4`,
		engine, asset, block, kind).Scan(&existingText); err != nil {
		return fmt.Errorf("read conflicting rate index %s/%x@%d: %w", kind, asset, block, err)
	}
	existing, ok := new(big.Int).SetString(existingText, 10)
	if !ok {
		return fmt.Errorf("parse rate index %q: not an integer", existingText)
	}
	if existing.Cmp(value) != 0 {
		return fmt.Errorf("rate index divergence: %s/%x@%d already holds %s, refusing %s",
			kind, asset, block, existing, value)
	}
	return nil
}

// NOTE: DeleteRateIndexesAbove (the runner's old post-rewind hygiene call)
// was retired in the fix wave — the deletion now lives INSIDE RewindDerived's
// transaction, atomic with the epoch ack, so a crash can never separate them.

// RawLogsInRange returns chainID's stored raw logs whose emitting address is
// in addresses and whose block is within [fromBlock, toBlock], ordered by
// (block_number, log_index) — the serial order the derive engines require
// (log_index is block-unique on EVM chains, so the pair is a total order).
// Additive read for Task 7's derivation runner: one engine's feed is the
// per-chain window filtered to the engine's full address set (e.g. the Aave
// engine's Pool + four aTokens merged into one ordered stream).
func (s *Store) RawLogsInRange(ctx context.Context, chainID uint64, addresses [][]byte, fromBlock, toBlock uint64) ([]RawLog, error) {
	rows, err := s.pool.Query(ctx, `SELECT chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data, ingested_at
		FROM raw_logs
		WHERE chain_id = $1 AND address = ANY($2) AND block_number BETWEEN $3 AND $4
		ORDER BY block_number, log_index`,
		chainID, addresses, fromBlock, toBlock)
	if err != nil {
		return nil, fmt.Errorf("query raw logs [%d,%d] (chain %d): %w", fromBlock, toBlock, chainID, err)
	}
	defer rows.Close()

	var out []RawLog
	for rows.Next() {
		var l RawLog
		var logIndex int32
		if err := rows.Scan(&l.ChainID, &l.BlockNumber, &l.BlockHash, &l.TxHash,
			&logIndex, &l.Address, &l.Topics, &l.Data, &l.IngestedAt); err != nil {
			return nil, fmt.Errorf("scan raw log row: %w", err)
		}
		l.LogIndex = uint32(logIndex)
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate raw logs [%d,%d] (chain %d): %w", fromBlock, toBlock, chainID, err)
	}
	return out, nil
}

// HasUnackedReorg reports whether chainID carries a reorg epoch engine has
// not acknowledged — the runner's proactive pre-derivation check, mirroring
// ApplyDerived's refusal gate (including the no-cursor bootstrap case: a new
// engine on a chain that already carries epochs must bootstrap through
// RewindDerived). Two statements with no transaction: their mutual
// consistency rests on the enforced single-writer contract (D-004), exactly
// like the gate reads inside ApplyDerived. Additive read for Task 7.
func (s *Store) HasUnackedReorg(ctx context.Context, engine string, chainID uint64) (bool, error) {
	var maxEpoch int64
	if err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(epoch), 0) FROM reorg_epochs WHERE chain_id = $1`, chainID).Scan(&maxEpoch); err != nil {
		return false, fmt.Errorf("read max reorg epoch for chain %d: %w", chainID, err)
	}
	if maxEpoch == 0 {
		return false, nil // the chain has never been rewound
	}
	var acked int64
	err := s.pool.QueryRow(ctx,
		`SELECT acked_epoch FROM derive_cursors WHERE engine = $1`, engine).Scan(&acked)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil // bootstrap on an epoch-carrying chain: unacked by definition
	}
	if err != nil {
		return false, fmt.Errorf("read derive cursor ack for %q: %w", engine, err)
	}
	return acked < maxEpoch, nil
}

// PruneAckedReorgEpochs deletes every reorg epoch that all engines bound to
// its chain (all derive_cursors rows with that chain_id) have acknowledged,
// returning the number of rows removed. Epochs on chains with NO derive
// cursor are kept (the MIN over an empty set is NULL, so the comparison never
// admits them) — harmless retention that also keeps the bootstrap gate
// visible until a first engine appears. Pruning acked epochs does not reopen
// the new-engine bootstrap hole: a no-cursor engine has no derived state a
// pre-prune rewind could have invalidated (position_events rows only ever
// exist alongside a cursor). Additive write for Task 7's periodic pruning.
func (s *Store) PruneAckedReorgEpochs(ctx context.Context) (int64, error) {
	ct, err := s.pool.Exec(ctx, `DELETE FROM reorg_epochs e
		WHERE e.epoch <= (SELECT MIN(acked_epoch) FROM derive_cursors d WHERE d.chain_id = e.chain_id)`)
	if err != nil {
		return 0, fmt.Errorf("prune acked reorg epochs: %w", err)
	}
	return ct.RowsAffected(), nil
}

// SnapshotAccounts returns the distinct debt-side accounts engine has ever
// derived a position event for — the snapshotter's Safe registry (plan Task
// 7: "distinct debt-side accounts from position_events"). Ordering is
// nonzero-debt-first (accounts holding a nonzero event-sourced debt balance
// lead — they are the ones a liquidation engine cares about), then bytewise
// ascending for determinism. Additive read for the Task 7 snapshotter.
func (s *Store) SnapshotAccounts(ctx context.Context, engine string) ([][]byte, error) {
	rows, err := s.pool.Query(ctx, `SELECT e.account
		FROM (SELECT DISTINCT account FROM position_events WHERE engine = $1 AND side = 'debt') e
		LEFT JOIN (
			SELECT account, bool_or(amount <> 0) AS has_debt
			FROM position_balances
			WHERE engine = $1 AND side = 'debt' AND source = 'event'
			GROUP BY account
		) b ON b.account = e.account
		ORDER BY COALESCE(b.has_debt, false) DESC, e.account`, engine)
	if err != nil {
		return nil, fmt.Errorf("query snapshot accounts for %q: %w", engine, err)
	}
	defer rows.Close()

	var out [][]byte
	for rows.Next() {
		var account []byte
		if err := rows.Scan(&account); err != nil {
			return nil, fmt.Errorf("scan snapshot account: %w", err)
		}
		out = append(out, account)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate snapshot accounts for %q: %w", engine, err)
	}
	return out, nil
}

// SaveSnapshot writes one snapshots-table row: a SIDE-SCOPED balance view for
// account at block. The input keeps the BalancesFor shape (asset-hex → side →
// amount) for caller convenience, but the document must be SINGLE-SIDE —
// every entry naming the same side — and the persisted JSONB is the same
// side-scoped {"side": s, "balances": {asset-hex: decimal-string}} shape
// SaveSnapshots writes (decimal strings because JSON numbers cannot carry
// uint256 exactly). The derived side is also the row's side KEY COLUMN — the
// history PK is (engine, account, block_number, side), so the debt and
// collateral writers can never overwrite each other at a shared block.
// Re-saving the same (engine, account, block, side) key replaces the row
// wholesale.
//
// AS-OF DISCIPLINE (fix wave, tightened in the sweep-durability wave from a
// documented convention to an ENFORCED refusal): a snapshots row claims its
// whole document was observed at block — a MIXED-SIDE document is refused,
// because the two sides of a debt_manager position are observed at DIFFERENT
// blocks (debt is event-derived truth at the derive through-block; collateral
// is a multicall read at its own execution block), and combining them here
// would lie about as-of semantics. Cross-side composition is a READ-TIME
// concern (P3), not a storage-time merge. An EMPTY balances map is refused
// too (no side can be derived from it) — use SaveSnapshots, whose SnapshotDoc
// carries the side explicitly, for empty zero-position documents.
func (s *Store) SaveSnapshot(ctx context.Context, engine string, account []byte, block uint64, balances map[string]map[string]*big.Int) error {
	docSide := ""
	flat := make(map[string]string, len(balances))
	for assetHex, sides := range balances {
		if _, err := hex.DecodeString(assetHex); err != nil {
			return fmt.Errorf("snapshot asset key %q: %w", assetHex, err)
		}
		for side, amount := range sides {
			if side == "" {
				return fmt.Errorf("snapshot balance %s: empty side", assetHex)
			}
			if docSide == "" {
				docSide = side
			}
			if side != docSide {
				return fmt.Errorf("snapshot document mixes sides %q and %q: a snapshots row is single-side (as-of honesty; cross-side composition is a read-time concern)",
					docSide, side)
			}
			if amount == nil {
				return fmt.Errorf("snapshot balance %s/%s: nil amount", assetHex, side)
			}
			flat[assetHex] = amount.String()
		}
	}
	if docSide == "" {
		return fmt.Errorf("snapshot document for account %x carries no balances: no side can be derived — use SaveSnapshots for explicit-side empty documents", account)
	}
	doc := map[string]any{"side": docSide, "balances": flat}
	if _, err := s.pool.Exec(ctx, `INSERT INTO snapshots (engine, account, block_number, side, balances, taken_at)
		VALUES ($1,$2,$3,$4,$5,now())
		ON CONFLICT (engine, account, block_number, side) DO UPDATE
		SET balances = EXCLUDED.balances, taken_at = now()`,
		engine, account, block, docSide, doc); err != nil {
		return fmt.Errorf("save snapshot for %q account %x at %d: %w", engine, account, block, err)
	}
	return nil
}

// SnapshotDoc is one account's SIDE-SCOPED snapshots-table document: every
// balance in it was observed on the SAME side at the SAME block, which is
// what makes the row's as-of claim honest (see SaveSnapshot's discipline
// note). Balances is keyed by lowercase asset-hex (no "0x").
type SnapshotDoc struct {
	Side     string              // "debt" or "collateral" — never mixed
	Balances map[string]*big.Int // lowercase asset-hex → amount
}

// SaveSnapshots writes one side-scoped snapshots-table row per docs entry
// (keyed by lowercase account-hex) at block, as ONE transaction batching all
// inserts — the runner's bulk per-round history write, replacing a
// per-account statement loop. The JSONB shape is
// {"side": s, "balances": {asset-hex: decimal-string}}, and each document's
// side is also its row's side KEY COLUMN (the history PK carries side, so
// same-block debt and collateral rows coexist). Re-saving an
// (engine, account, block, side) key replaces the row wholesale (replayed
// rounds converge). Atomic: a failure (including context cancellation mid-batch)
// leaves NO partial rows. Additive write for the fix wave's bounded bulk
// snapshotting.
func (s *Store) SaveSnapshots(ctx context.Context, engine string, block uint64, docs map[string]SnapshotDoc) error {
	if len(docs) == 0 {
		return nil
	}
	accountsHex := make([]string, 0, len(docs))
	for accountHex := range docs {
		accountsHex = append(accountsHex, accountHex)
	}
	sort.Strings(accountsHex) // deterministic batch order

	b := &pgx.Batch{}
	for _, accountHex := range accountsHex {
		account, err := hex.DecodeString(accountHex)
		if err != nil {
			return fmt.Errorf("snapshot account key %q: %w", accountHex, err)
		}
		d := docs[accountHex]
		if d.Side == "" {
			return fmt.Errorf("snapshot for account %s: empty side — documents must be side-scoped", accountHex)
		}
		balances := make(map[string]string, len(d.Balances))
		for assetHex, amount := range d.Balances {
			if _, err := hex.DecodeString(assetHex); err != nil {
				return fmt.Errorf("snapshot asset key %q (account %s): %w", assetHex, accountHex, err)
			}
			if amount == nil {
				return fmt.Errorf("snapshot balance %s/%s (account %s): nil amount", assetHex, d.Side, accountHex)
			}
			balances[assetHex] = amount.String()
		}
		doc := map[string]any{"side": d.Side, "balances": balances}
		b.Queue(`INSERT INTO snapshots (engine, account, block_number, side, balances, taken_at)
			VALUES ($1,$2,$3,$4,$5,now())
			ON CONFLICT (engine, account, block_number, side) DO UPDATE
			SET balances = EXCLUDED.balances, taken_at = now()`,
			engine, account, block, d.Side, doc)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	br := tx.SendBatch(ctx, b)
	for range accountsHex {
		if _, err := br.Exec(); err != nil {
			br.Close()
			return fmt.Errorf("save snapshots for %q at %d: %w", engine, block, err)
		}
	}
	if err := br.Close(); err != nil {
		return fmt.Errorf("close snapshot batch for %q at %d: %w", engine, block, err)
	}
	return tx.Commit(ctx)
}

// NOTE: RecordSnapshotSweep (the snapshotter's old standalone status write)
// and its SweepOutcome type were retired in the sweep-durability wave —
// status rows now land ONLY inside ApplySweepBatch's transaction, atomic
// with the balances they describe; a separate status write would reopen the
// balances/status divergence window it existed to record.

// ---------------------------------------------------------------------------
// Durable sweep generations — the snapshotter's crash-resumable work queue.
// (Sweep-durability wave; see migration 00004 for the model.)
// ---------------------------------------------------------------------------

// SweepProgress is the snapshotter's DURABLE progress record — the answer to
// "is collateral snapshot ingestion still landing anything", which the
// snapshotter's own return values cannot give.
//
// It exists because the snapshotter has a SEMANTIC stall: when every RPC endpoint
// serves sweep batches at an execution block behind the accounts' recorded
// successes, the store refuses each batch, Step returns (false, nil) — no error,
// no advance — and it can do that forever. The daemon's failure bookkeeping saw a
// nil error and cleared its state, and no cursor of any kind moved, so /readyz
// stayed 200 while collateral snapshots stopped advancing entirely.
//
// Every field is a database value, so a restart cannot grant a wedged sweep a
// fresh window.
type SweepProgress struct {
	// Generation is the current (open or most recently completed) generation, 0
	// when no sweep has ever been opened.
	Generation uint64
	// Open reports whether that generation still owes work.
	Open bool
	// OpenedAt / CompletedAt are the generation's own timestamps. CompletedAt is
	// zero while Open.
	OpenedAt    time.Time
	CompletedAt time.Time
	// LastBatchAt is the newest snapshot_sweeps.updated_at for this engine — the
	// last time ANY account's sweep status landed durably. Zero when the engine
	// has never swept an account.
	LastBatchAt time.Time
	// Lagging counts accounts carrying a sweep row from an EARLIER generation.
	// It is a LOWER BOUND on work owed, not a total: an account that has never
	// been swept has no row at all and is not counted here. It is reported for
	// the operator's benefit and is deliberately NOT what the stall verdict rests
	// on — that rests on Open plus LastBatchAt, both of which are unambiguous.
	Lagging int64
}

// SweepProgress reads engine's durable sweep progress. found=false when the
// engine has no sweep_generations row at all (no sweep has ever been opened),
// which is not a stall — it is a snapshotter that has not started.
func (s *Store) SweepProgress(ctx context.Context, engine string) (SweepProgress, bool, error) {
	var p SweepProgress
	var opened, completed *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT current_generation, opened_at, completed_at FROM sweep_generations WHERE engine = $1`,
		engine).Scan(&p.Generation, &opened, &completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return SweepProgress{}, false, nil
	}
	if err != nil {
		return SweepProgress{}, false, fmt.Errorf("read sweep progress for %q: %w", engine, err)
	}
	if opened != nil {
		p.OpenedAt = *opened
	}
	if completed != nil {
		p.CompletedAt = *completed
	} else {
		p.Open = true
	}
	var lastBatch *time.Time
	if err := s.pool.QueryRow(ctx,
		`SELECT max(updated_at) FROM snapshot_sweeps WHERE engine = $1`, engine).Scan(&lastBatch); err != nil {
		return SweepProgress{}, false, fmt.Errorf("read last sweep batch time for %q: %w", engine, err)
	}
	if lastBatch != nil {
		p.LastBatchAt = *lastBatch
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshot_sweeps WHERE engine = $1 AND generation < $2`,
		engine, p.Generation).Scan(&p.Lagging); err != nil {
		return SweepProgress{}, false, fmt.Errorf("count lagging sweep accounts for %q: %w", engine, err)
	}
	return p, true, nil
}

// SweepGeneration reads engine's durable sweep-generation state
// (sweep_generations): the current generation number, whether that generation
// is OPEN (opened but not completed — the restart-resume signal: a fresh
// process seeing open=true resumes the lagging set instead of opening a new
// generation), and, when closed, the time it completed (the cadence anchor).
// generation 0 with open=false means no sweep has ever been opened.
func (s *Store) SweepGeneration(ctx context.Context, engine string) (generation uint64, open bool, completedAt time.Time, err error) {
	var completed *time.Time
	err = s.pool.QueryRow(ctx,
		`SELECT current_generation, completed_at FROM sweep_generations WHERE engine = $1`,
		engine).Scan(&generation, &completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, time.Time{}, nil
	}
	if err != nil {
		return 0, false, time.Time{}, fmt.Errorf("read sweep generation for %q: %w", engine, err)
	}
	if completed == nil {
		return generation, true, time.Time{}, nil
	}
	return generation, false, *completed, nil
}

// OpenSweepGeneration opens a new sweep generation for engine — the ONE
// durable statement that makes every registry account lag (their
// snapshot_sweeps rows carry an older generation) and therefore owe work.
// Increments (or creates at 1), stamps opened_at, clears completed_at;
// returns the newly-opened generation. RewindDerived performs the identical
// bump inside its own transaction for the post-rewind re-sweep.
func (s *Store) OpenSweepGeneration(ctx context.Context, engine string) (uint64, error) {
	var gen uint64
	if err := s.pool.QueryRow(ctx, `INSERT INTO sweep_generations (engine, current_generation, opened_at, completed_at)
		VALUES ($1, 1, now(), NULL)
		ON CONFLICT (engine) DO UPDATE
		SET current_generation = sweep_generations.current_generation + 1,
		    opened_at = now(), completed_at = NULL
		RETURNING current_generation`, engine).Scan(&gen); err != nil {
		return 0, fmt.Errorf("open sweep generation for %q: %w", engine, err)
	}
	return gen, nil
}

// SweepWorkBatch returns up to limit accounts of engine's Safe registry (the
// same distinct-debt-account set SnapshotAccounts serves) that still owe work
// under generation — the DURABLE queue read:
//
//   - LAGGING accounts first: no snapshot_sweeps row at all, or a row stamped
//     by an OLDER generation, ordered ascending by that stamp — oldest-first
//     fairness is inherent (the least-recently-swept drain before anything
//     repeats, and a crash-resumed process continues exactly where the last
//     one stopped without re-reading already-stamped accounts).
//   - Then current-generation FAILED accounts still inside the durable retry
//     budget (attempts < maxAttempts) — bounded immediate retries; an account
//     that spent the budget is skipped for this generation (it stays
//     status='failed' until the next one).
//
// Within one generation bucket, nonzero-debt accounts lead (the
// liquidation-relevant set), then bytewise ascending for determinism. An
// EMPTY result means the generation is COMPLETE (CompleteSweepGeneration
// stamps it).
func (s *Store) SweepWorkBatch(ctx context.Context, engine string, generation uint64, maxAttempts, limit int) ([][]byte, error) {
	rows, err := s.pool.Query(ctx, `SELECT r.account
		FROM (
			SELECT e.account, COALESCE(b.has_debt, false) AS has_debt
			FROM (SELECT DISTINCT account FROM position_events WHERE engine = $1 AND side = 'debt') e
			LEFT JOIN (
				SELECT account, bool_or(amount <> 0) AS has_debt
				FROM position_balances
				WHERE engine = $1 AND side = 'debt' AND source = 'event'
				GROUP BY account
			) b ON b.account = e.account
		) r
		LEFT JOIN snapshot_sweeps sw ON sw.engine = $1 AND sw.account = r.account
		WHERE sw.account IS NULL
		   OR sw.generation < $2
		   OR (sw.generation = $2 AND sw.status = 'failed' AND sw.attempts < $3)
		ORDER BY COALESCE(sw.generation, -1) ASC, r.has_debt DESC, r.account ASC
		LIMIT $4`,
		engine, generation, maxAttempts, limit)
	if err != nil {
		return nil, fmt.Errorf("query sweep work batch for %q generation %d: %w", engine, generation, err)
	}
	defer rows.Close()

	var out [][]byte
	for rows.Next() {
		var account []byte
		if err := rows.Scan(&account); err != nil {
			return nil, fmt.Errorf("scan sweep work account: %w", err)
		}
		out = append(out, account)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sweep work batch for %q: %w", engine, err)
	}
	return out, nil
}

// CompleteSweepGeneration stamps generation complete (completed_at = now())
// and returns how many of its status rows ended 'failed' — the DEGRADED
// signal. The stamp is guarded: it lands only while generation is still the
// engine's CURRENT, OPEN generation. stamped=false means the generation was
// superseded mid-completion (a rewind's bump opened a newer one) or already
// stamped — the caller simply resumes the newer generation on its next step;
// nothing is lost either way. The failed count is advisory (it may include
// accounts a rewind removed from the registry after their failure).
func (s *Store) CompleteSweepGeneration(ctx context.Context, engine string, generation uint64) (failed int64, stamped bool, err error) {
	ct, err := s.pool.Exec(ctx, `UPDATE sweep_generations SET completed_at = now()
		WHERE engine = $1 AND current_generation = $2 AND completed_at IS NULL`,
		engine, generation)
	if err != nil {
		return 0, false, fmt.Errorf("complete sweep generation %d for %q: %w", generation, engine, err)
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM snapshot_sweeps WHERE engine = $1 AND generation = $2 AND status = 'failed'`,
		engine, generation).Scan(&failed); err != nil {
		return 0, false, fmt.Errorf("count failed sweep accounts for %q generation %d: %w", engine, generation, err)
	}
	return failed, ct.RowsAffected() > 0, nil
}

// SweepResult is one account's outcome from a snapshotter multicall batch,
// applied durably by ApplySweepBatch. OK=false records a per-account failure
// (generation-stamped, attempts-counted); OK=true carries the account's
// wholesale collateral balances (lowercase asset-hex → side → amount, side
// always "collateral") as read at the batch's multicall execution block.
type SweepResult struct {
	Account  []byte
	OK       bool
	Balances map[string]map[string]*big.Int
}

// ApplySweepBatch lands one multicall batch's results in ONE transaction. Per
// successful account: a wholesale snapshot-balance replacement
// (position_balances source='snapshot' — delete then insert, so vanished
// assets clear), PLUS a collateral-side history document into snapshots
// ({"side":"collateral","balances":{asset-hex: decimal-string}}) at the
// multicall execution block, PLUS a generation-stamped 'success' status row.
// Per failed account: a generation-stamped 'failed' status row in the SAME
// transaction. Balances and status therefore can never diverge across a
// crash — the separate per-account-upsert-then-bulk-status sequence the
// snapshotter previously ran could persist balances and lose the status rows,
// or record status for balances that never landed.
//
// Status rows carry the durable attempts counter SweepWorkBatch's retry
// budget reads: an attempt under the SAME generation increments it, a new
// generation resets it to 1. A success stamps last_success_block; a failure
// retains the previous success block for staleness measurement. Idempotent
// under replay: a re-applied batch (crash between commit and the caller's
// bookkeeping) converges to the same balances/status end state — only
// attempts overcounts, which NARROWS the retry budget, never widens it.
//
// MONOTONIC SWEEP BLOCKS (stale-failover guard): per successful account, the
// existing sweep row's last_success_block is read FOR UPDATE inside the
// transaction; if execBlock is BEHIND it (a failover to a lagging RPC
// endpoint — the multicall observed an older chain state than one already
// applied), that account's balances, history and status are NOT applied and
// its generation is NOT advanced: it stays lagging and re-pulls next batch,
// most likely against a caught-up endpoint. Stale skips are counted and
// WARNed; a batch whose EVERY result is stale returns ErrStaleSweepBatch so
// the snapshotter logs DEGRADED instead of silently completing. Replays at
// the SAME block remain admitted (execBlock == last_success_block), keeping
// the crash-replay idempotence above intact. Failed results are always
// recorded — an attempt happened, whatever block served it, and last_success
// _block is untouched by failures.
//
// Validation is deliberately PER RESULT, inline with the writes (no
// pre-validation pass, no statement batching): a malformed element aborts the
// whole transaction AFTER earlier elements' statements executed, and the
// all-or-nothing contract is pinned by a failure injection riding exactly
// this path.
func (s *Store) ApplySweepBatch(ctx context.Context, engine string, generation, execBlock uint64, results []SweepResult) error {
	if len(results) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	stale := 0
	for _, res := range results {
		if len(res.Account) == 0 {
			return fmt.Errorf("sweep result with empty account")
		}
		if !res.OK {
			if _, err := tx.Exec(ctx, `INSERT INTO snapshot_sweeps
				(engine, account, generation, last_attempt_block, last_success_block, status, attempts, updated_at)
				VALUES ($1,$2,$3,$4,0,'failed',1,now())
				ON CONFLICT (engine, account) DO UPDATE
				SET attempts = CASE WHEN snapshot_sweeps.generation = EXCLUDED.generation
				                    THEN snapshot_sweeps.attempts + 1 ELSE 1 END,
				    generation = EXCLUDED.generation,
				    last_attempt_block = EXCLUDED.last_attempt_block,
				    status = 'failed', updated_at = now()`,
				engine, res.Account, generation, execBlock); err != nil {
				return fmt.Errorf("record failed sweep for %x: %w", res.Account, err)
			}
			continue
		}

		// Stale-failover guard (see the doc comment): a success observed
		// BEHIND the account's recorded last success is skipped wholesale —
		// no balance, history or status write, no generation advance. The
		// FOR UPDATE read pins the row against the (contract-forbidden)
		// concurrent writer for the rest of this transaction.
		var lastSuccess uint64
		err := tx.QueryRow(ctx,
			`SELECT last_success_block FROM snapshot_sweeps WHERE engine = $1 AND account = $2 FOR UPDATE`,
			engine, res.Account).Scan(&lastSuccess)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read sweep row for %x: %w", res.Account, err)
		}
		if err == nil && execBlock < lastSuccess {
			stale++
			continue
		}

		if _, err := tx.Exec(ctx,
			`DELETE FROM position_balances WHERE engine = $1 AND account = $2 AND source = 'snapshot'`,
			engine, res.Account); err != nil {
			return fmt.Errorf("clear snapshot balances for %x: %w", res.Account, err)
		}
		assetKeys := make([]string, 0, len(res.Balances))
		for assetHex := range res.Balances {
			assetKeys = append(assetKeys, assetHex)
		}
		sort.Strings(assetKeys) // deterministic statement order
		doc := make(map[string]string, len(assetKeys))
		for _, assetHex := range assetKeys {
			asset, err := hex.DecodeString(assetHex)
			if err != nil {
				return fmt.Errorf("sweep asset key %q (account %x): %w", assetHex, res.Account, err)
			}
			for side, amount := range res.Balances[assetHex] {
				if side != "collateral" {
					return fmt.Errorf("sweep balance %s/%s for %x: snapshotter results are collateral-side only", assetHex, side, res.Account)
				}
				if amount == nil {
					return fmt.Errorf("sweep balance %s/%s for %x: nil amount", assetHex, side, res.Account)
				}
				if _, err := tx.Exec(ctx, `INSERT INTO position_balances
					(engine, account, asset, side, source, amount, updated_block)
					VALUES ($1,$2,$3,$4,'snapshot',$5,$6)`,
					engine, res.Account, asset, side,
					pgtype.Numeric{Int: amount, Exp: 0, Valid: true}, execBlock); err != nil {
					return fmt.Errorf("insert snapshot balance %s for %x: %w", assetHex, res.Account, err)
				}
				doc[assetHex] = amount.String()
			}
		}
		// Collateral-side history row at the multicall execution block — the
		// same side-scoped shape SaveSnapshots writes, closing the "no
		// collateral history for debt_manager" gap; side is part of the
		// history PK, so a debt row the runner wrote at this same block
		// survives untouched. An empty document is a valid zero-collateral
		// observation.
		if _, err := tx.Exec(ctx, `INSERT INTO snapshots (engine, account, block_number, side, balances, taken_at)
			VALUES ($1,$2,$3,'collateral',$4,now())
			ON CONFLICT (engine, account, block_number, side) DO UPDATE
			SET balances = EXCLUDED.balances, taken_at = now()`,
			engine, res.Account, execBlock,
			map[string]any{"side": "collateral", "balances": doc}); err != nil {
			return fmt.Errorf("save collateral history for %x at %d: %w", res.Account, execBlock, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO snapshot_sweeps
			(engine, account, generation, last_attempt_block, last_success_block, status, attempts, updated_at)
			VALUES ($1,$2,$3,$4,$4,'success',1,now())
			ON CONFLICT (engine, account) DO UPDATE
			SET attempts = CASE WHEN snapshot_sweeps.generation = EXCLUDED.generation
			                    THEN snapshot_sweeps.attempts + 1 ELSE 1 END,
			    generation = EXCLUDED.generation,
			    last_attempt_block = EXCLUDED.last_attempt_block,
			    last_success_block = EXCLUDED.last_attempt_block,
			    status = 'success', updated_at = now()`,
			engine, res.Account, generation, execBlock); err != nil {
			return fmt.Errorf("record successful sweep for %x: %w", res.Account, err)
		}
	}
	if stale > 0 {
		slog.Warn("stale sweep block: endpoint behind — skipped successes observed before their accounts' recorded last success; skipped accounts stay lagging and retry",
			"engine", engine, "generation", generation, "execBlock", execBlock,
			"staleAccounts", stale, "batch", len(results))
	}
	if stale == len(results) {
		// Nothing in this transaction landed (every result was a stale
		// success); the typed refusal lets the snapshotter log DEGRADED
		// instead of treating the round as applied.
		return fmt.Errorf("%w: all %d results at execution block %d predate their accounts' last successes (engine %q, generation %d)",
			ErrStaleSweepBatch, len(results), execBlock, engine, generation)
	}
	return tx.Commit(ctx)
}

// LatestRateIndex returns engine's most recent rate observation for asset of
// the given kind at or below atOrBelow, plus the block it was observed at.
// found is false when no observation exists in range.
func (s *Store) LatestRateIndex(ctx context.Context, engine string, asset []byte, atOrBelow uint64, kind string) (*big.Int, uint64, bool, error) {
	var valueText string
	var block uint64
	err := s.pool.QueryRow(ctx, `SELECT value::text, block_number FROM rate_indexes
		WHERE engine = $1 AND asset = $2 AND kind = $3 AND block_number <= $4
		ORDER BY block_number DESC LIMIT 1`,
		engine, asset, kind, atOrBelow).Scan(&valueText, &block)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, fmt.Errorf("latest rate index %s/%x: %w", kind, asset, err)
	}
	v, ok := new(big.Int).SetString(valueText, 10)
	if !ok {
		return nil, 0, false, fmt.Errorf("parse rate index %q: not an integer", valueText)
	}
	return v, block, true, nil
}
