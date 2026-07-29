package store

// Risk-parameter custody (P3 Task 2): the `param_history` ledger written by
// the `aave_param` engine's deriver (internal/derive.ParamRunner).
//
// EVERY public here is ADDITIVE. Nothing in this file changes an existing
// signature or an existing table, per the frozen-signatures law; the epoch
// arithmetic is NOT reimplemented but consumed from the one place that owns it
// (rewindTarget, derive.go:365 — consult R2: two implementations of "how deep
// must an ack reach" is how a shallower ack blesses deleted blocks).
//
// WHY THE WRITE PATH CARRIES THE FULL GATE BLOCK. ApplyParamEvents mirrors
// ApplyDerivedWithRates' gate block clause for clause (chain binding →
// unacked-epoch refusal → no-cursor bootstrap refusal → divergent-replay
// refusal → guarded, chain-bound cursor upsert). A one-armed gate — rewind
// validated, apply trusted — would reopen for parameters exactly the window
// that machinery exists to close: a batch derived from raw logs the walker has
// since deleted would land, and a liquidation threshold is the last number in
// this system that may quietly describe a chain that no longer exists.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ParamRow is one risk-parameter fact: a single param-bearing configurator log,
// decoded, addressed by that log's own identity (ChainID, TxHash,
// EffectiveLogIndex) and stamped with where it takes effect.
//
// PER-FIELD NULLS ARE THE POINT. A row records what ITS event said and nothing
// else — a CollateralConfigurationChanged row carries LTV/LiqThreshold/LiqBonus
// with nil registry fields, a ReserveInitialized row the reverse, an
// EModeAssetCategoryChanged row only the category. nil means "this event did
// not speak to this field", NEVER zero. Folding a ledger prefix into an
// effective view is therefore last-non-nil PER FIELD; see ParamsAsOf.
//
// DENOMINATORS ARE RAW, as emitted: Aave basis points (1e4) for this engine,
// HUNDRED_PERCENT = 100e18 for the Debt Manager's equivalents. Storage never
// normalizes — the two conventions differ by 1e16 and the only evidence of
// which one a row uses is which engine wrote it. Conversion lives in
// internal/risk.
//
// Asset/AToken/VariableDebtToken/Strategy/TxHash are RAW bytes (20 and 32
// respectively), matching PositionEvent's encoding — this package deliberately
// carries no go-ethereum dependency.
type ParamRow struct {
	Engine  string
	ChainID uint64
	Asset   []byte

	LTV          *big.Int
	LiqThreshold *big.Int
	LiqBonus     *big.Int

	// EModeCategory is the uint8 selector as emitted; nil when the row's event
	// did not set it.
	EModeCategory *uint8

	AToken            []byte
	VariableDebtToken []byte
	Strategy          []byte

	EffectiveBlock    uint64
	EffectiveLogIndex uint32

	// SourceEvent is the decoded event type name (decode.Event.Name()), so a
	// reader can tell WHICH fact the row asserts without inferring it from
	// which columns happen to be non-nil.
	SourceEvent string
	TxHash      []byte
}

// ApplyParamEvents persists rows and advances engine's derive cursor to
// throughBlock, in a single transaction, under the SAME write-side gate block
// as ApplyDerivedWithRates (derive.go:198-230, 263-273, 306-335):
//
//   - Chain binding first: an engine whose cursor row names another chain is
//     refused with ErrDeriveCursorChainMismatch BEFORE any epoch reasoning, so
//     a cross-chain batch is never misread as an epoch problem.
//   - Reorg-epoch gate, read inside this transaction before any write: if the
//     engine has not acknowledged every epoch on its chain
//     (acked_epoch < max), the batch is refused with ErrUnackedReorgEpoch —
//     its rows may describe blocks the raw rewind already deleted, and only
//     RewindParams can make it whole. Because the epoch marker is a durable
//     row written atomically by store.Rewind, the refusal survives a crash
//     between the raw rewind and the param rewind.
//   - An engine with NO cursor row is admitted only when its chain has ZERO
//     recorded epochs (implicit first-write ack: nothing to acknowledge). On a
//     chain that already carries an epoch, a new engine must BOOTSTRAP through
//     RewindParams — otherwise a stale pre-rewind batch slips in unexamined.
//   - Divergent-replay refusal on (chain_id, tx_hash, log_index): replaying an
//     already-persisted identity with byte-identical fields is a no-op
//     (idempotent); replaying it with ANY divergent field aborts the whole
//     batch. Intra-batch duplicates hit the same check through
//     same-transaction visibility.
//   - The cursor upsert is the guarded, chain-bound idiom: it fires only when
//     the stored cursor's chain matches AND the move is non-regressive, and
//     acked_epoch is set on the INSERT arm only (the update arm leaves it
//     alone — the gate above already proved the existing ack current, and
//     explicit acks belong to RewindParams).
//
// throughBlock may exceed the highest row's block, and usually does: a param
// window with no configurator activity still advances custody, and pretending
// otherwise would make the cursor claim less than the deriver actually read.
func (s *Store) ApplyParamEvents(ctx context.Context, engine string, chainID uint64, rows []ParamRow, throughBlock uint64) error {
	if engine == "" {
		return fmt.Errorf("apply param events: engine is required (it is the ownership scope)")
	}
	for _, r := range rows {
		if r.ChainID != chainID {
			return fmt.Errorf("param row %x/%d: chain id %d does not match batch chain id %d",
				r.TxHash, r.EffectiveLogIndex, r.ChainID, chainID)
		}
		if r.Engine != engine {
			return fmt.Errorf("param row %x/%d: engine %q does not match batch engine %q",
				r.TxHash, r.EffectiveLogIndex, r.Engine, engine)
		}
		if len(r.TxHash) == 0 || len(r.Asset) == 0 || r.SourceEvent == "" {
			return fmt.Errorf("param row %x/%d: tx hash, asset and source event are all required",
				r.TxHash, r.EffectiveLogIndex)
		}
		if r.EffectiveBlock > throughBlock {
			return fmt.Errorf("param row %x/%d: effective block %d is above the batch through-block %d",
				r.TxHash, r.EffectiveLogIndex, r.EffectiveBlock, throughBlock)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Gate reads: chain binding first, then the reorg-epoch gate, both before
	// any write. Their mutual consistency rests on the enforced single-writer
	// contract (D-004) exactly as ApplyDerivedWithRates' does — under READ
	// COMMITTED each statement sees its own snapshot, so it is the absence of
	// concurrent writers, not isolation, that makes the decision sound.
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
		return fmt.Errorf("%w: engine %q is bound to chain %d, refusing param batch for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}
	maxEpoch, err := chainMaxEpoch(ctx, tx, chainID)
	if err != nil {
		return err
	}
	if cursorExists && ackedEpoch < maxEpoch {
		return fmt.Errorf("engine %q has %w %d on chain %d (acked %d): rewind param history before applying",
			engine, ErrUnackedReorgEpoch, maxEpoch, chainID, ackedEpoch)
	}
	if !cursorExists && maxEpoch > 0 {
		// New-engine bootstrap hole closed: no implicit ack when the chain
		// already carries epochs — RewindParams is the bootstrap entry point.
		return fmt.Errorf("engine %q has no derive cursor and chain %d carries %w %d: bootstrap via RewindParams before applying",
			engine, chainID, ErrUnackedReorgEpoch, maxEpoch)
	}

	for _, r := range rows {
		existing, found, err := loadParamRow(ctx, tx, r.ChainID, r.TxHash, r.EffectiveLogIndex)
		if err != nil {
			return fmt.Errorf("load existing param row %x/%d: %w", r.TxHash, r.EffectiveLogIndex, err)
		}
		if found {
			if !equalParamRow(existing, r) {
				return fmt.Errorf("param row %x/%d: divergent replay — refusing batch", r.TxHash, r.EffectiveLogIndex)
			}
			continue // identical replay: already applied, no-op
		}
		if _, err := tx.Exec(ctx, `INSERT INTO param_history
			(engine, chain_id, asset, ltv, liq_threshold, liq_bonus, emode_category,
			 atoken, variable_debt_token, strategy,
			 effective_block, effective_log_index, source_event, tx_hash)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			r.Engine, r.ChainID, r.Asset,
			numericParam(r.LTV), numericParam(r.LiqThreshold), numericParam(r.LiqBonus),
			emodeParam(r.EModeCategory),
			r.AToken, r.VariableDebtToken, r.Strategy,
			r.EffectiveBlock, int32(r.EffectiveLogIndex), r.SourceEvent, r.TxHash); err != nil {
			return fmt.Errorf("insert param row %x/%d: %w", r.TxHash, r.EffectiveLogIndex, err)
		}
	}

	// acked_epoch is only ever SET on the insert arm (implicit first-write
	// ack); the update arm leaves it alone.
	ct, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (engine) DO UPDATE
		SET last_block = EXCLUDED.last_block, updated_at = now()
		WHERE derive_cursors.chain_id = EXCLUDED.chain_id
		  AND derive_cursors.last_block <= EXCLUDED.last_block`,
		engine, chainID, throughBlock, maxEpoch)
	if err != nil {
		return fmt.Errorf("upsert param cursor: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// The guarded upsert refused; the row must exist (a plain insert affects
		// 1 row). Chain binding was verified at the top of this transaction, so
		// under D-004 the only remaining cause is a height regression — the
		// read-back keeps the disambiguation honest even if that contract were
		// ever violated.
		var refusedChain, storedBlock uint64
		if err := tx.QueryRow(ctx,
			`SELECT chain_id, last_block FROM derive_cursors WHERE engine = $1`, engine).Scan(&refusedChain, &storedBlock); err != nil {
			return fmt.Errorf("param cursor refused move for %q, and read-back failed: %w", engine, err)
		}
		if refusedChain != chainID {
			return fmt.Errorf("%w: engine %q is bound to chain %d, refusing param batch for chain %d",
				ErrDeriveCursorChainMismatch, engine, refusedChain, chainID)
		}
		return fmt.Errorf("%w: engine %q refused move to %d (cursor at %d)",
			ErrDeriveCursorRegression, engine, throughBlock, storedBlock)
	}

	return tx.Commit(ctx)
}

// numericParam binds a nullable uint256 the way the rest of this package does:
// pgtype.Numeric{Exp: 0} for a value, an untyped nil for absence (a plain Go
// string bound to NUMERIC has no encode plan in pgx's codec).
func numericParam(v *big.Int) any {
	if v == nil {
		return nil
	}
	return pgtype.Numeric{Int: v, Exp: 0, Valid: true}
}

func emodeParam(v *uint8) any {
	if v == nil {
		return nil
	}
	return int16(*v)
}

// loadParamRow fetches the existing param_history row identified by
// (chainID, txHash, logIndex), if any, for divergence comparison.
func loadParamRow(ctx context.Context, tx pgx.Tx, chainID uint64, txHash []byte, logIndex uint32) (ParamRow, bool, error) {
	var r ParamRow
	var ltv, lt, bonus *string
	var emode *int16
	var blockNumber int64
	var logIdx int32
	err := tx.QueryRow(ctx, `SELECT engine, chain_id, asset, ltv::text, liq_threshold::text, liq_bonus::text,
		emode_category, atoken, variable_debt_token, strategy,
		effective_block, effective_log_index, source_event, tx_hash
		FROM param_history WHERE chain_id = $1 AND tx_hash = $2 AND effective_log_index = $3`,
		chainID, txHash, int32(logIndex)).Scan(
		&r.Engine, &r.ChainID, &r.Asset, &ltv, &lt, &bonus,
		&emode, &r.AToken, &r.VariableDebtToken, &r.Strategy,
		&blockNumber, &logIdx, &r.SourceEvent, &r.TxHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return ParamRow{}, false, nil
	}
	if err != nil {
		return ParamRow{}, false, err
	}
	for _, f := range []struct {
		text **string
		dst  **big.Int
		name string
	}{{&ltv, &r.LTV, "ltv"}, {&lt, &r.LiqThreshold, "liq_threshold"}, {&bonus, &r.LiqBonus, "liq_bonus"}} {
		if *f.text == nil {
			continue
		}
		v, ok := new(big.Int).SetString(**f.text, 10)
		if !ok {
			return ParamRow{}, false, fmt.Errorf("parse %s %q: not an integer", f.name, **f.text)
		}
		*f.dst = v
	}
	if emode != nil {
		if *emode < 0 || *emode > 255 {
			return ParamRow{}, false, fmt.Errorf("emode_category %d is outside uint8", *emode)
		}
		c := uint8(*emode)
		r.EModeCategory = &c
	}
	r.EffectiveBlock = uint64(blockNumber)
	r.EffectiveLogIndex = uint32(logIdx)
	return r, true, nil
}

// equalParamRow reports whether existing (as persisted) and incoming (as
// offered for replay) carry identical fields under the same PK. Every column is
// compared: a re-derivation that produces the same log identity with ANY
// different value is a divergence, not a replay.
func equalParamRow(existing, incoming ParamRow) bool {
	if existing.Engine != incoming.Engine || existing.EffectiveBlock != incoming.EffectiveBlock ||
		existing.SourceEvent != incoming.SourceEvent {
		return false
	}
	if !bytes.Equal(existing.Asset, incoming.Asset) ||
		!bytes.Equal(existing.AToken, incoming.AToken) ||
		!bytes.Equal(existing.VariableDebtToken, incoming.VariableDebtToken) ||
		!bytes.Equal(existing.Strategy, incoming.Strategy) {
		return false
	}
	if !equalBigInt(existing.LTV, incoming.LTV) ||
		!equalBigInt(existing.LiqThreshold, incoming.LiqThreshold) ||
		!equalBigInt(existing.LiqBonus, incoming.LiqBonus) {
		return false
	}
	if (existing.EModeCategory == nil) != (incoming.EModeCategory == nil) {
		return false
	}
	if existing.EModeCategory != nil && *existing.EModeCategory != *incoming.EModeCategory {
		return false
	}
	return true
}

// ParamsAsOf returns engine's param ledger PREFIX as of block: every row whose
// effective position is at or below `block`, ordered by
// (effective_block, effective_log_index) — the total order two param changes in
// one block are ranked by.
//
// IT RETURNS THE LEDGER, NOT A FOLDED VIEW, and that is deliberate. Rows are
// per-FIELD facts (see ParamRow): a ReserveInitialized row that lands after a
// CollateralConfigurationChanged row says nothing about the liquidation
// threshold, so a last-row-wins fold would MASK a live threshold with a
// registry row — the exact silent-wrong-answer this ledger exists to prevent.
// The correct fold is last-non-nil PER FIELD per asset, and it lives with the
// unit conversion in internal/risk, where the per-engine denominator is already
// known.
//
// The returned prefix says nothing about how far custody REACHES: a chain with
// no configurator activity for three million blocks still has a complete
// ledger. Ask ParamHead for the reach.
func (s *Store) ParamsAsOf(ctx context.Context, engine string, chainID uint64, block uint64) ([]ParamRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT engine, chain_id, asset, ltv::text, liq_threshold::text, liq_bonus::text,
		emode_category, atoken, variable_debt_token, strategy,
		effective_block, effective_log_index, source_event, tx_hash
		FROM param_history
		WHERE engine = $1 AND chain_id = $2 AND effective_block <= $3
		ORDER BY effective_block, effective_log_index`, engine, chainID, block)
	if err != nil {
		return nil, fmt.Errorf("query params as of %d for %q: %w", block, engine, err)
	}
	defer rows.Close()

	var out []ParamRow
	for rows.Next() {
		var r ParamRow
		var ltv, lt, bonus *string
		var emode *int16
		var blockNumber int64
		var logIdx int32
		if err := rows.Scan(&r.Engine, &r.ChainID, &r.Asset, &ltv, &lt, &bonus,
			&emode, &r.AToken, &r.VariableDebtToken, &r.Strategy,
			&blockNumber, &logIdx, &r.SourceEvent, &r.TxHash); err != nil {
			return nil, fmt.Errorf("scan param row: %w", err)
		}
		for _, f := range []struct {
			text **string
			dst  **big.Int
			name string
		}{{&ltv, &r.LTV, "ltv"}, {&lt, &r.LiqThreshold, "liq_threshold"}, {&bonus, &r.LiqBonus, "liq_bonus"}} {
			if *f.text == nil {
				continue
			}
			v, ok := new(big.Int).SetString(**f.text, 10)
			if !ok {
				return nil, fmt.Errorf("parse %s %q: not an integer", f.name, **f.text)
			}
			*f.dst = v
		}
		if emode != nil {
			if *emode < 0 || *emode > 255 {
				return nil, fmt.Errorf("emode_category %d is outside uint8", *emode)
			}
			c := uint8(*emode)
			r.EModeCategory = &c
		}
		r.EffectiveBlock = uint64(blockNumber)
		r.EffectiveLogIndex = uint32(logIdx)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate params as of %d for %q: %w", block, engine, err)
	}
	return out, nil
}

// ParamHead returns the block through which engine's param custody is COMPLETE
// — its derive cursor — not the height of the newest param row. The two differ
// by however long governance has been quiet, and only the former answers "is
// this ledger safe to read at block N".
//
// found is false when the engine has never applied a param window. A cursor row
// bound to a DIFFERENT chain is refused with ErrDeriveCursorChainMismatch
// rather than reported as absent: "no custody here" and "custody of another
// chain" are different facts and a caller must not conflate them.
func (s *Store) ParamHead(ctx context.Context, engine string, chainID uint64) (block uint64, found bool, err error) {
	var storedChain uint64
	err = s.pool.QueryRow(ctx,
		`SELECT chain_id, last_block FROM derive_cursors WHERE engine = $1`, engine).Scan(&storedChain, &block)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read param head for %q: %w", engine, err)
	}
	if storedChain != chainID {
		return 0, false, fmt.Errorf("%w: engine %q is bound to chain %d, refusing param head for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}
	return block, true, nil
}

// RewindParams discards engine's param rows above the EFFECTIVE rewind target
// and acknowledges every reorg epoch on its chain, in a single transaction.
//
// The effective target is min(toBlock, deepest unacknowledged rewound_to),
// computed by rewindTarget — the ONE implementation of that arithmetic, shared
// with RewindDerived and RewindPrices (consult R2). Copy-pasting the
// deepest-unacked query here would be the second implementation, and two
// answers to "how deep must an ack reach" is how a shallower ack blesses rows
// belonging to blocks the raw rewind already deleted: with epochs stacked at 50
// and 80, a caller passing 80 must still purge a param row at 60 while both
// epochs get acked.
//
// The body is modeled on RewindPrices (the lean rewind), NOT on RewindDerived's
// heavy legs: a param writer owns no position_events, position_balances,
// rate_indexes, snapshots or sweep generations, so it touches none of them.
//
// This is also the BOOTSTRAP entry point for the param engine on a chain that
// already carries epochs: ApplyParamEvents refuses a no-cursor engine there
// until this call has created its cursor and acked. A cursor row bound to a
// different chain is refused with ErrDeriveCursorChainMismatch before anything
// is deleted or acked, and the cursor upsert's conflict arm deliberately never
// rebinds chain_id.
func (s *Store) RewindParams(ctx context.Context, engine string, chainID uint64, toBlock uint64) error {
	if engine == "" {
		return fmt.Errorf("param rewind: engine is required (it is the ownership scope)")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Chain binding first: a wrong-chain call must be refused before any epoch
	// reasoning, deletion, or ack.
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
		return fmt.Errorf("%w: engine %q is bound to chain %d, refusing param rewind for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}

	// Epoch reads rely on the single-writer contract (D-004): READ COMMITTED
	// gives no cross-statement snapshot here.
	effectiveTarget, maxEpoch, err := rewindTarget(ctx, tx, engine, chainID, ackedEpoch, toBlock)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM param_history WHERE engine = $1 AND chain_id = $2 AND effective_block > $3`,
		engine, chainID, effectiveTarget); err != nil {
		return fmt.Errorf("delete param history above %d: %w", effectiveTarget, err)
	}

	// The conflict arm never touches chain_id: the binding was verified above
	// and must not be rewritable through a rewind.
	if _, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (engine) DO UPDATE
		SET last_block = EXCLUDED.last_block,
		    acked_epoch = EXCLUDED.acked_epoch, updated_at = now()`,
		engine, chainID, effectiveTarget, maxEpoch); err != nil {
		return fmt.Errorf("reset param cursor: %w", err)
	}

	return tx.Commit(ctx)
}
