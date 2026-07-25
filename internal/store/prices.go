package store

// Oracle price persistence (Phase 2 Task 8). The `prices` table already exists
// from migration 00002 — (chain_id, asset, source, price NUMERIC,
// price_decimals INT, block_number, observed_at), PK
// (chain_id, asset, source, block_number) — so nothing here needs a migration.
//
// TWO WRITERS, ONE CONTRACT. Both the engine-exact OP POLLER
// (PriceProviderV2.price(token) each interval) and the ETH CHAINLINK FEED
// deriver (AnswerUpdated logs read back out of raw_logs) write through
// ApplyPrices and repair through RewindPrices, under their own PSEUDO-ENGINE
// derive cursors. Giving the pollers a cursor too — not just the log-derived
// feed path — is deliberate: a price row is stamped with the block it was
// observed at, and a reorg that replaces that block leaves the row describing
// a chain that no longer exists. Routing both writers through the same
// epoch-gated cursor means a reorg can never leave price rows above the rewind
// target, whichever writer produced them.
//
// ASYMMETRY WORTH KNOWING: the feed deriver RE-DERIVES the rows a rewind
// deleted (its input, raw_logs, is rewound and re-ingested by the walker); the
// poller CANNOT — it only ever reads `latest`, so rewound poll rows are gone
// for good and the next round writes a fresh row at the new head. Losing at
// most one poll interval of history in a rare reorg is the honest trade
// against retaining a priced claim about a block that was replaced.
//
// NUMERIC round-trip: prices.price is written as pgtype.Numeric{Exp: 0} from a
// *big.Int and read back through ::text, exactly like position_events.delta and
// rate_indexes.value (see derive.go's NUMERIC note). Every price this package
// stores is an integer in its declared PriceDecimals scale.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// PriceObservation is one (asset, source, block) price fact, in the scale its
// oracle reports:
//
//   - Source names the MECHANISM that produced the number, so two mechanisms
//     pricing one asset never collide on the PK: "priceproviderv2" for the
//     engine-exact Debt Manager poll, "chainlink:<aggregator>" for a raw
//     aggregator's AnswerUpdated stream, "ratio:<method>:<contract>" for a
//     polled exchange-rate view.
//   - Price is recorded EXACTLY as the oracle returned it. Notably the Debt
//     Manager's PriceProviderV2 snaps isStableToken configs to exactly 1e6
//     inside a ±1% band; that snapped value IS the number the engine charges
//     against, so it is stored verbatim and never "corrected".
//   - Decimals is the scale of Price (6 for PriceProviderV2, 8 for the
//     Chainlink aggregators, 18 for the weETH getRate() ratio). It is part of
//     the row's identity for divergence purposes: the same block reporting the
//     same digits at a different scale is a DIFFERENT price.
//
// There is deliberately no ChainID field: the chain comes from the batch, so a
// cross-chain observation is structurally impossible rather than validated.
type PriceObservation struct {
	Asset       []byte
	Source      string
	Price       *big.Int
	Decimals    int32
	BlockNumber uint64
}

// ApplyPrices persists obs and advances engine's derive cursor to
// throughBlock, in a single transaction, under the SAME gates
// ApplyDerivedWithRates enforces:
//
//   - Chain binding first: an engine cursor bound to another chain is refused
//     with ErrDeriveCursorChainMismatch before the epoch gate.
//   - Reorg-epoch gate: the chain's max epoch and the engine's acked_epoch are
//     read in this transaction before any write; an engine that has not
//     acknowledged every epoch on its chain is refused with
//     ErrUnackedReorgEpoch (its rows may be stamped with blocks the raw rewind
//     already deleted, and only RewindPrices can make it whole). An engine
//     with NO cursor row is admitted only on a chain with ZERO recorded epochs
//     (implicit first-write ack); otherwise it must BOOTSTRAP through
//     RewindPrices, exactly as a new derive engine bootstraps through
//     RewindDerived.
//   - Each observation is inserted into prices. Replaying an already-persisted
//     (chain_id, asset, source, block_number) identity with the SAME price and
//     scale is a no-op (idempotent); replaying it with a divergent price or
//     scale aborts the WHOLE batch (rollback, no partial effect) rather than
//     overwriting a recorded fact. Same-transaction visibility means
//     intra-batch duplicates hit the same check — callers that can legitimately
//     produce two observations for one key (two AnswerUpdated rounds in one
//     block) are expected to have last-wins-deduped first.
//   - derive_cursors is advanced with the monotonic, chain-bound guard idiom;
//     on refusal the cursor is read back to disambiguate chain mismatch from
//     height regression.
//
// An EMPTY obs set is legitimate and still advances the cursor: a poll round
// where every oracle reverted, or a derivation window containing no
// AnswerUpdated, both leave the cursor obliged to move so the epoch ack stays
// current.
//
// throughBlock is a HARD upper bound on the batch: an observation above it
// would live outside the cursor's coverage and survive a rewind that targets
// the cursor, so it is refused.
func (s *Store) ApplyPrices(ctx context.Context, engine string, chainID uint64, obs []PriceObservation, throughBlock uint64) error {
	for i, o := range obs {
		if err := validatePriceObservation(o); err != nil {
			return fmt.Errorf("price observation %d: %w", i, err)
		}
		if o.BlockNumber > throughBlock {
			return fmt.Errorf("price observation %d (%s/%x): block %d is above the batch through-block %d",
				i, o.Source, o.Asset, o.BlockNumber, throughBlock)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Gate reads: chain binding, then the epoch gate, both before any write.
	// Their mutual consistency rests on the enforced single-writer contract
	// (D-004) — see ApplyDerivedWithRates.
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
		return fmt.Errorf("%w: engine %q is bound to chain %d, refusing price batch for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}
	maxEpoch, err := chainMaxEpoch(ctx, tx, chainID)
	if err != nil {
		return err
	}
	if cursorExists && ackedEpoch < maxEpoch {
		return fmt.Errorf("engine %q has %w %d on chain %d (acked %d): rewind prices before applying",
			engine, ErrUnackedReorgEpoch, maxEpoch, chainID, ackedEpoch)
	}
	if !cursorExists && maxEpoch > 0 {
		return fmt.Errorf("engine %q has no derive cursor and chain %d carries %w %d: bootstrap via RewindPrices before applying",
			engine, chainID, ErrUnackedReorgEpoch, maxEpoch)
	}

	for _, o := range obs {
		if err := insertPrice(ctx, tx, chainID, o); err != nil {
			return err
		}
	}

	// acked_epoch is only ever SET on the insert arm (implicit first-write
	// ack); the update arm leaves it alone — the gate above already proved the
	// existing ack is current, and explicit acks belong to RewindPrices.
	ct, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (engine) DO UPDATE
		SET last_block = EXCLUDED.last_block, updated_at = now()
		WHERE derive_cursors.chain_id = EXCLUDED.chain_id
		  AND derive_cursors.last_block <= EXCLUDED.last_block`,
		engine, chainID, throughBlock, maxEpoch)
	if err != nil {
		return fmt.Errorf("upsert price cursor: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// The guarded upsert refused; the row must exist. Chain binding was
		// verified at the top of this transaction, so under the single-writer
		// contract the only remaining cause is a height regression — the
		// read-back keeps the disambiguation honest regardless.
		var refusedChain, storedBlock uint64
		if err := tx.QueryRow(ctx,
			`SELECT chain_id, last_block FROM derive_cursors WHERE engine = $1`, engine).Scan(&refusedChain, &storedBlock); err != nil {
			return fmt.Errorf("price cursor refused move for %q, and read-back failed: %w", engine, err)
		}
		if refusedChain != chainID {
			return fmt.Errorf("%w: engine %q is bound to chain %d, refusing price batch for chain %d",
				ErrDeriveCursorChainMismatch, engine, refusedChain, chainID)
		}
		return fmt.Errorf("%w: engine %q refused move to %d (cursor at %d)",
			ErrDeriveCursorRegression, engine, throughBlock, storedBlock)
	}

	return tx.Commit(ctx)
}

// validatePriceObservation rejects the malformed shapes that would otherwise
// land as plausible-looking rows: a nil price, an out-of-range scale, an
// unnamed mechanism, or an asset that is not a 20-byte address.
func validatePriceObservation(o PriceObservation) error {
	if o.Price == nil {
		return fmt.Errorf("%s/%x@%d: nil price", o.Source, o.Asset, o.BlockNumber)
	}
	if o.Source == "" {
		return fmt.Errorf("%x@%d: empty source", o.Asset, o.BlockNumber)
	}
	if len(o.Asset) != 20 {
		return fmt.Errorf("%s/%x@%d: asset is %d bytes, want a 20-byte address",
			o.Source, o.Asset, o.BlockNumber, len(o.Asset))
	}
	// price_decimals is an INT column; the upper bound is a typo guard (a stray
	// 1800 for 18), not a storage limit.
	if o.Decimals < 0 || o.Decimals > 36 {
		return fmt.Errorf("%s/%x@%d: price decimals %d out of range [0,36]",
			o.Source, o.Asset, o.BlockNumber, o.Decimals)
	}
	return nil
}

// insertPrice writes one observation inside the caller's transaction with
// idempotent-replay / divergence-abort semantics (SaveRateIndex's contract,
// extended to cover the SCALE as well as the value). Non-positive prices are
// RECORDED and WARNed, never refused: this layer persists what the oracle
// said, and refusing would wedge a feed deriver forever on a log that already
// exists in raw_logs — but a zero or negative USD price is a broken oracle, so
// the operator has to hear about it. The check lives here so BOTH price
// writers get it.
func insertPrice(ctx context.Context, tx pgx.Tx, chainID uint64, o PriceObservation) error {
	if o.Price.Sign() <= 0 {
		slog.Warn("oracle reported a non-positive price; recording it verbatim (this layer stores what the oracle said) — treat the feed as broken",
			"chain", chainID, "asset", fmt.Sprintf("%x", o.Asset), "source", o.Source,
			"block", o.BlockNumber, "price", o.Price.String(), "priceDecimals", o.Decimals)
	}
	ct, err := tx.Exec(ctx, `INSERT INTO prices (chain_id, asset, source, price, price_decimals, block_number)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (chain_id, asset, source, block_number) DO NOTHING`,
		chainID, o.Asset, o.Source, pgtype.Numeric{Int: o.Price, Exp: 0, Valid: true}, o.Decimals, o.BlockNumber)
	if err != nil {
		return fmt.Errorf("save price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
	}
	if ct.RowsAffected() > 0 {
		return nil // fresh insert
	}
	// Conflicted with an existing row: idempotent only if BOTH the value and
	// the scale match; anything else aborts the batch rather than overwriting a
	// recorded fact.
	var existingText string
	var existingDecimals int32
	if err := tx.QueryRow(ctx,
		`SELECT price::text, price_decimals FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, o.Asset, o.Source, o.BlockNumber).Scan(&existingText, &existingDecimals); err != nil {
		return fmt.Errorf("read conflicting price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
	}
	existing, ok := new(big.Int).SetString(existingText, 10)
	if !ok {
		return fmt.Errorf("parse price %q: not an integer", existingText)
	}
	if existing.Cmp(o.Price) != 0 || existingDecimals != o.Decimals {
		return fmt.Errorf("price divergence: %s/%x@%d already holds %s (%d dec), refusing %s (%d dec) — aborting batch",
			o.Source, o.Asset, o.BlockNumber, existing, existingDecimals, o.Price, o.Decimals)
	}
	return nil
}

// RewindPrices discards the price rows engine owns above the EFFECTIVE rewind
// target and resets its cursor, acknowledging every reorg epoch on its chain —
// the price writers' counterpart to RewindDerived, in ONE transaction:
//
//   - The effective target is min(toBlock, deepest unacknowledged rewound_to),
//     computed by the shared rewindTarget helper: because this call ACKS every
//     epoch on the chain, its deletion must reach the DEEPEST block any unacked
//     epoch rewound to. A lowered target is WARNed with both numbers.
//   - sources scopes OWNERSHIP explicitly. prices rows are keyed by mechanism,
//     not by engine, so a chain-wide "delete above target" would destroy other
//     writers' rows (the ETH poller's ratio rows and the ETH feed deriver's
//     stream rows share chain 1). Only the caller's own sources are touched,
//     and an engine that owns no source deletes nothing while still acking.
//   - The epoch ack and the deletion are ATOMIC: a crash can never leave the
//     ack recorded while orphaned price rows survive, which is precisely the
//     hole a separate follow-up delete would open.
//
// This is also the BOOTSTRAP entry point for a price writer on a chain that
// already carries epochs: ApplyPrices refuses a no-cursor engine there until
// this call has created its cursor and acked. A cursor row bound to a
// different chain is refused with ErrDeriveCursorChainMismatch before anything
// is deleted or acked, and the cursor upsert's conflict arm deliberately never
// rebinds chain_id.
//
// It deliberately touches NOTHING else RewindDerived touches — no
// position_events, position_balances, rate_indexes, snapshots or sweep
// generations — because a price writer owns none of those tables.
func (s *Store) RewindPrices(ctx context.Context, engine string, chainID uint64, toBlock uint64, sources []string) error {
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
		return fmt.Errorf("%w: engine %q is bound to chain %d, refusing price rewind for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}

	effectiveTarget, maxEpoch, err := rewindTarget(ctx, tx, engine, chainID, ackedEpoch, toBlock)
	if err != nil {
		return err
	}

	if len(sources) > 0 {
		if _, err := tx.Exec(ctx,
			`DELETE FROM prices WHERE chain_id = $1 AND block_number > $2 AND source = ANY($3)`,
			chainID, effectiveTarget, sources); err != nil {
			return fmt.Errorf("delete prices above %d: %w", effectiveTarget, err)
		}
	}

	// The conflict arm never touches chain_id: the binding was verified above
	// and must not be rewritable through a rewind.
	if _, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (engine) DO UPDATE
		SET last_block = EXCLUDED.last_block,
		    acked_epoch = EXCLUDED.acked_epoch, updated_at = now()`,
		engine, chainID, effectiveTarget, maxEpoch); err != nil {
		return fmt.Errorf("reset price cursor: %w", err)
	}

	return tx.Commit(ctx)
}
