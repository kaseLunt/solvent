package store

// Oracle price persistence (Phase 2 Task 8, corrected by the Codex round-1 fix
// wave). The `prices` table comes from migration 00002; migration 00005 adds the
// three shapes this layer's contracts now rest on — `owner_engine`,
// `valid`/`invalid_reason`, and `price_poll_anchors`.
//
// TWO WRITERS, ONE CONTRACT. Both the engine-exact OP POLLER
// (PriceProviderV2.price(token) each interval) and the ETH CHAINLINK FEED
// deriver (AnswerUpdated logs read back out of raw_logs) write through
// ApplyPrices / ApplyPolledPrices and repair through RewindPrices, under their
// own PSEUDO-ENGINE derive cursors. Giving the pollers a cursor too — not just
// the log-derived feed path — is deliberate: a price row is stamped with the
// block it was observed at, and a reorg that replaces that block leaves the row
// describing a chain that no longer exists. Routing both writers through the
// same epoch-gated cursor means a reorg can never leave price rows above the
// rewind target, whichever writer produced them.
//
// OWNERSHIP IS DURABLE, NOT DERIVED FROM CONFIG. Every row records the
// pseudo-engine key of the writer that inserted it, and RewindPrices deletes by
// that key. The earlier design scoped a rewind by the source strings the
// CALLER'S CURRENTLY LOADED REGISTRY named, which silently lost rows whenever
// the registry moved: after a manual Chainlink phase update the feed deriver
// owns only chainlink:<new-aggregator>, so a deep reorg crossing the phase
// boundary left the historical chainlink:<old-aggregator> rows above the
// effective target while the same transaction advanced acked_epoch — and once
// the epoch was pruned, nothing was left to trigger repair. A writer's engine
// key does not move when its registry does, so owner-scoped repair is immune to
// that class.
//
// REORG REPAIR IS NOT UNIFORMLY LOSSY. The feed deriver RE-DERIVES the rows a
// rewind deleted (its input, raw_logs, is rewound and re-ingested by the
// walker). The poller CANNOT — it only ever reads `latest`. It therefore records
// a durable (block, hash) ANCHOR per landed round, and repair walks those
// anchors down from the newest, keeping everything at or below the first one
// whose hash the caller has re-verified against the live chain and deleting only
// the unverified suffix. A hash match at height H entails that every block up to H
// is unchanged (blocks are chained by parent hash), so retaining rows at or below
// a verified anchor rests on that entailment rather than on optimism — subject to
// the endpoint that answered the re-check being honest, which is the same trust
// every ingested log already depends on. When NO anchor verifies — or none
// survives retention — repair falls back to the walker's target and the loss is
// real and WARNed; see RewindPrices.
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
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrPollAnchorDivergence is returned when a poll round re-anchors a block
// height this engine already anchored, with a DIFFERENT block hash. The
// transaction is rolled back: the chain at that height changed under us, which
// is a reorg the walker has not recorded yet, not a fact to overwrite. Callers
// treat it as evidence of a pending reorg — never as evidence about the RPC
// endpoint that served the round.
var ErrPollAnchorDivergence = errors.New("poll anchor divergence: recorded block hash differs")

// invalidReasonNonPositive is the quarantine reason recorded for a zero or
// negative oracle answer. It is the only reason this layer produces today; the
// column exists so a later validity rule does not need a schema change, and
// migration 00005's CHECK guarantees a non-positive row can never be valid
// whatever the reason says.
const invalidReasonNonPositive = "non-positive oracle answer"

// pollAnchorRetention bounds how many of an engine's most recent poll anchors
// survive. At the default 60s cadence 4096 anchors cover roughly 2.8 days of
// polling, which is orders of magnitude deeper than any reorg this indexer
// expects to see. Losing older anchors does not corrupt repair: it degrades that
// depth to the conservative walker target, exactly the pre-anchor behaviour, and
// RewindPrices WARNs when it has to fall back.
const pollAnchorRetention = 4096

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
//     against, so it is stored verbatim and never "corrected". A NON-POSITIVE
//     value is also stored verbatim, but is marked INVALID (see insertPrice) so
//     no usable-price read can ever return it.
//   - Decimals is the scale of Price (6 for PriceProviderV2, 8 for the
//     Chainlink aggregators, 18 for the weETH getRate() ratio). It is part of
//     the row's identity for divergence purposes: the same block reporting the
//     same digits at a different scale is a DIFFERENT price.
//
// There is deliberately no ChainID field: the chain comes from the batch, so a
// cross-chain observation is structurally impossible rather than validated.
// There is deliberately no owner field either: the owner is the applying
// engine, so a row cannot claim a writer that did not write it.
type PriceObservation struct {
	Asset       []byte
	Source      string
	Price       *big.Int
	Decimals    int32
	BlockNumber uint64
}

// PollAnchor is one poll round's durable proof of where it executed: the
// multicall's execution block and the block hash multicall3 returned alongside
// it. Anchors exist so reorg repair can distinguish "this round ran on a block
// the chain still has" from "this round ran on a block that was replaced",
// without which the only safe repair was to delete every polled row above the
// raw-log walker's deepest verified ancestor.
type PollAnchor struct {
	BlockNumber uint64
	BlockHash   []byte
}

// PriceFreshness is the newest durable observation under one (asset, source)
// key: the block it describes and the wall-clock time the row was written.
// ObservedAt is the insertion time, which is the right clock for "did this
// writer land a price for this asset recently" — the question a poller's health
// asks. It is NOT the oracle's own updatedAt, which the prices table does not
// carry.
type PriceFreshness struct {
	Asset       []byte
	Source      string
	BlockNumber uint64
	ObservedAt  time.Time
}

// UsablePrice is the result of a latest-USABLE-price read: a price that has
// passed the validity gate and may therefore be used in valuation or
// liquidation maths. There is no variant of this type that can carry an invalid
// row — LatestUsablePrice filters in SQL, and migration 00005's CHECK means a
// non-positive row can never be marked valid in the first place.
type UsablePrice struct {
	Asset       []byte
	Source      string
	Price       *big.Int
	Decimals    int32
	BlockNumber uint64
	ObservedAt  time.Time
}

// ApplyPrices persists obs and advances engine's derive cursor to throughBlock
// in a single transaction. This is the LOG-DERIVED writers' entry point (the
// Chainlink feed deriver): it records no poll anchor, because a re-derivable
// writer does not need one — a rewind's deletion is repaired by re-reading
// raw_logs.
//
// The gates are the ones ApplyDerivedWithRates enforces:
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
//   - Each observation is inserted into prices under this engine's ownership.
//     Replaying an already-persisted (chain_id, asset, source, block_number)
//     identity with the SAME price, scale and owner is a no-op (idempotent);
//     replaying it with a divergent price, scale or owner aborts the WHOLE batch
//     (rollback, no partial effect) rather than overwriting a recorded fact.
//     Same-transaction visibility means intra-batch duplicates hit the same
//     check — callers that can legitimately produce two observations for one key
//     (two AnswerUpdated rounds in one block) are expected to have
//     last-wins-deduped first.
//   - derive_cursors is advanced with the monotonic, chain-bound guard idiom;
//     on refusal the cursor is read back to disambiguate chain mismatch from
//     height regression.
//
// An EMPTY obs set is legitimate and still advances the cursor: a poll round
// where every oracle reverted, or a derivation window containing no
// AnswerUpdated, both leave the cursor obliged to move so the epoch ack stays
// current. Advancing the cursor is NOT a claim that prices were recorded —
// callers derive health from per-asset freshness, never from "a round
// committed".
//
// throughBlock is a HARD upper bound on the batch: an observation above it
// would live outside the cursor's coverage and survive a rewind that targets
// the cursor, so it is refused.
func (s *Store) ApplyPrices(ctx context.Context, engine string, chainID uint64, obs []PriceObservation, throughBlock uint64) error {
	return s.applyPrices(ctx, engine, chainID, obs, throughBlock, nil)
}

// ApplyPolledPrices is ApplyPrices for the POLLER, which additionally records
// the round's execution (block, hash) as a durable anchor inside the same
// transaction. anchor.BlockNumber must equal throughBlock: the poller stamps
// every row in a round with the multicall's execution block and moves its cursor
// to that same block, so an anchor at any other height would not describe the
// round it claims to.
//
// A replayed anchor at the same height with the same hash is idempotent. A
// replayed anchor with a DIFFERENT hash aborts the batch with
// ErrPollAnchorDivergence — the chain at that height changed, which is a reorg
// the walker has not recorded yet.
func (s *Store) ApplyPolledPrices(ctx context.Context, engine string, chainID uint64, obs []PriceObservation, throughBlock uint64, anchor PollAnchor) error {
	if len(anchor.BlockHash) != 32 {
		return fmt.Errorf("poll anchor for %q: block hash is %d bytes, want 32", engine, len(anchor.BlockHash))
	}
	if anchor.BlockNumber != throughBlock {
		return fmt.Errorf("poll anchor for %q: anchor block %d must equal the batch through-block %d",
			engine, anchor.BlockNumber, throughBlock)
	}
	return s.applyPrices(ctx, engine, chainID, obs, throughBlock, &anchor)
}

func (s *Store) applyPrices(ctx context.Context, engine string, chainID uint64, obs []PriceObservation, throughBlock uint64, anchor *PollAnchor) error {
	if engine == "" {
		return fmt.Errorf("price batch: engine is required (it is the durable owner of every row)")
	}
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
		if err := insertPrice(ctx, tx, chainID, engine, o); err != nil {
			return err
		}
	}
	if anchor != nil {
		if err := insertPollAnchor(ctx, tx, chainID, engine, *anchor); err != nil {
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

	if anchor != nil {
		if err := pruneOldPollAnchors(ctx, tx, engine); err != nil {
			return err
		}
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
// extended to cover the SCALE and the OWNER as well as the value).
//
// NON-POSITIVE ANSWERS ARE QUARANTINED, NOT REFUSED. Refusing the row would
// wedge a feed deriver forever on a log that already exists in raw_logs, and
// stalling its cursor would wedge the epoch gate; but recording a zero or
// negative answer as an ordinary usable price is what lets a downstream
// latest-price query produce divide-by-zero, inverted valuation or invalid
// liquidation maths. So the raw fact lands with valid=false and a reason, the
// cursor advances, an operator WARN is emitted, and LatestUsablePrice can never
// return it. The validity value is DERIVED here from the price's sign rather
// than accepted from the caller, so no writer can mark a non-positive answer
// usable; migration 00005's CHECK enforces the same thing at the storage layer.
// The check lives here so BOTH price writers get it.
func insertPrice(ctx context.Context, tx pgx.Tx, chainID uint64, ownerEngine string, o PriceObservation) error {
	valid := o.Price.Sign() > 0
	reason := ""
	if !valid {
		reason = invalidReasonNonPositive
		slog.Warn("oracle reported a NON-POSITIVE price; recording the raw fact but QUARANTINING it (valid=false) — no usable-price read can return it; treat the feed as broken",
			"chain", chainID, "owner", ownerEngine, "asset", fmt.Sprintf("%x", o.Asset), "source", o.Source,
			"block", o.BlockNumber, "price", o.Price.String(), "priceDecimals", o.Decimals)
	}
	ct, err := tx.Exec(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (chain_id, asset, source, block_number) DO NOTHING`,
		chainID, o.Asset, o.Source, pgtype.Numeric{Int: o.Price, Exp: 0, Valid: true}, o.Decimals,
		o.BlockNumber, ownerEngine, valid, reason)
	if err != nil {
		return fmt.Errorf("save price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
	}
	if ct.RowsAffected() > 0 {
		return nil // fresh insert
	}
	// Conflicted with an existing row: idempotent only if the value, the scale
	// AND the owner all match; anything else aborts the batch rather than
	// overwriting a recorded fact or silently re-attributing its provenance.
	var existingText, existingOwner string
	var existingDecimals int32
	if err := tx.QueryRow(ctx,
		`SELECT price::text, price_decimals, owner_engine FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, o.Asset, o.Source, o.BlockNumber).Scan(&existingText, &existingDecimals, &existingOwner); err != nil {
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
	if existingOwner != ownerEngine {
		return fmt.Errorf("price divergence: %s/%x@%d is owned by %q, refusing a replay from %q — aborting batch",
			o.Source, o.Asset, o.BlockNumber, existingOwner, ownerEngine)
	}
	return nil
}

// insertPollAnchor records one round's (block, hash) anchor with the same
// idempotent-replay / divergence-abort posture as a price row. A divergent hash
// at a height this engine already anchored is ErrPollAnchorDivergence: the
// chain at that height changed, so the honest answer is to roll back and let the
// reorg protocol run, never to overwrite the anchor.
func insertPollAnchor(ctx context.Context, tx pgx.Tx, chainID uint64, engine string, a PollAnchor) error {
	ct, err := tx.Exec(ctx, `INSERT INTO price_poll_anchors (engine, chain_id, block_number, block_hash)
		VALUES ($1,$2,$3,$4) ON CONFLICT (engine, block_number) DO NOTHING`,
		engine, chainID, a.BlockNumber, a.BlockHash)
	if err != nil {
		return fmt.Errorf("record poll anchor %q@%d: %w", engine, a.BlockNumber, err)
	}
	if ct.RowsAffected() > 0 {
		return nil
	}
	var existingHash []byte
	var existingChain uint64
	if err := tx.QueryRow(ctx,
		`SELECT chain_id, block_hash FROM price_poll_anchors WHERE engine = $1 AND block_number = $2`,
		engine, a.BlockNumber).Scan(&existingChain, &existingHash); err != nil {
		return fmt.Errorf("read conflicting poll anchor %q@%d: %w", engine, a.BlockNumber, err)
	}
	if existingChain != chainID {
		return fmt.Errorf("%w: engine %q anchor at %d is recorded on chain %d, refusing chain %d",
			ErrDeriveCursorChainMismatch, engine, a.BlockNumber, existingChain, chainID)
	}
	if string(existingHash) != string(a.BlockHash) {
		return fmt.Errorf("%w: engine %q at block %d holds %x, round reported %x — the chain at that height changed; aborting batch",
			ErrPollAnchorDivergence, engine, a.BlockNumber, existingHash, a.BlockHash)
	}
	return nil
}

// pruneOldPollAnchors keeps only the pollAnchorRetention newest anchors for
// engine. Bounded growth is the point: anchors exist to answer "was this round's
// block replaced", a question that only has operational meaning within reorg
// depth of the head.
func pruneOldPollAnchors(ctx context.Context, tx pgx.Tx, engine string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM price_poll_anchors
		WHERE engine = $1 AND block_number < (
			SELECT MIN(block_number) FROM (
				SELECT block_number FROM price_poll_anchors WHERE engine = $1
				ORDER BY block_number DESC LIMIT $2
			) keep
		)`, engine, pollAnchorRetention); err != nil {
		return fmt.Errorf("prune poll anchors for %q: %w", engine, err)
	}
	return nil
}

// PollAnchorsAbove returns engine's poll anchors strictly above aboveBlock, in
// DESCENDING block order, capped at limit rows. The poller walks this list from
// the newest downward during reorg repair, verifying each anchor's hash against
// the live chain and stopping at the first match: that block is provably still
// canonical, so every price row at or below it is still describing the chain
// that exists.
func (s *Store) PollAnchorsAbove(ctx context.Context, engine string, chainID, aboveBlock uint64, limit int) ([]PollAnchor, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT block_number, block_hash FROM price_poll_anchors
		 WHERE engine = $1 AND chain_id = $2 AND block_number > $3
		 ORDER BY block_number DESC LIMIT $4`,
		engine, chainID, aboveBlock, limit)
	if err != nil {
		return nil, fmt.Errorf("read poll anchors for %q above %d: %w", engine, aboveBlock, err)
	}
	defer rows.Close()
	var out []PollAnchor
	for rows.Next() {
		var a PollAnchor
		if err := rows.Scan(&a.BlockNumber, &a.BlockHash); err != nil {
			return nil, fmt.Errorf("scan poll anchor row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate poll anchors for %q: %w", engine, err)
	}
	return out, nil
}

// LatestPriceFreshness returns, for every (asset, source) key ownerEngine has
// ever written on chainID, the newest row's block and insertion time —
// regardless of validity, because a quarantined answer still proves the writer
// reached that oracle. It is the DURABLE source a restarted poller hydrates its
// per-asset freshness from, so a restart cannot reset an already-dead oracle to
// "healthy for another grace window".
func (s *Store) LatestPriceFreshness(ctx context.Context, chainID uint64, ownerEngine string) ([]PriceFreshness, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT DISTINCT ON (asset, source) asset, source, block_number, observed_at
		 FROM prices WHERE chain_id = $1 AND owner_engine = $2
		 ORDER BY asset, source, block_number DESC`,
		chainID, ownerEngine)
	if err != nil {
		return nil, fmt.Errorf("read price freshness for %q: %w", ownerEngine, err)
	}
	defer rows.Close()
	var out []PriceFreshness
	for rows.Next() {
		var f PriceFreshness
		if err := rows.Scan(&f.Asset, &f.Source, &f.BlockNumber, &f.ObservedAt); err != nil {
			return nil, fmt.Errorf("scan price freshness row: %w", err)
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate price freshness for %q: %w", ownerEngine, err)
	}
	return out, nil
}

// LatestUsablePrice returns the newest VALID price for (chainID, asset, source),
// or found=false when the key has no usable row — including the case where every
// recorded row for it is quarantined.
//
// THIS IS THE ONLY CONTRACT DOWNSTREAM CONSUMERS SHOULD READ PRICES THROUGH. A
// hand-written `ORDER BY block_number DESC LIMIT 1` over `prices` can select a
// zero or negative answer; this cannot, and migration 00005's CHECK means the
// filter cannot be defeated by a writer marking a non-positive row valid. It
// makes no freshness claim: the caller must judge BlockNumber/ObservedAt against
// whatever staleness bound its own use demands.
func (s *Store) LatestUsablePrice(ctx context.Context, chainID uint64, asset []byte, source string) (UsablePrice, bool, error) {
	var p UsablePrice
	var priceText string
	err := s.pool.QueryRow(ctx,
		`SELECT asset, source, price::text, price_decimals, block_number, observed_at
		 FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND valid
		 ORDER BY block_number DESC LIMIT 1`,
		chainID, asset, source).Scan(&p.Asset, &p.Source, &priceText, &p.Decimals, &p.BlockNumber, &p.ObservedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return UsablePrice{}, false, nil
	}
	if err != nil {
		return UsablePrice{}, false, fmt.Errorf("read latest usable price %s/%x (chain %d): %w", source, asset, chainID, err)
	}
	v, ok := new(big.Int).SetString(priceText, 10)
	if !ok {
		return UsablePrice{}, false, fmt.Errorf("parse price %q: not an integer", priceText)
	}
	// Defence in depth: the SQL predicate and the storage CHECK both already
	// exclude this, so reaching it means the schema was altered out from under
	// the contract. Fail loudly rather than hand a caller a poisoned price.
	if v.Sign() <= 0 {
		return UsablePrice{}, false, fmt.Errorf("latest usable price %s/%x (chain %d) is %s: the validity gate has been defeated, refusing to return it",
			source, asset, chainID, v)
	}
	p.Price = v
	return p, true, nil
}

// LatestLogsByTopic returns, for each of addresses, the single newest stored log
// carrying topic0 at or below throughBlock — the DURABLE truth a feed deriver
// hydrates its per-aggregator publication freshness from. Reading it back out of
// raw_logs (rather than trusting process memory) is what makes a restart, or a
// rewind, unable to reset an already-dead feed to "unobserved, therefore
// healthy". Results carry no particular order across addresses.
func (s *Store) LatestLogsByTopic(ctx context.Context, chainID uint64, addresses [][]byte, topic0 []byte, throughBlock uint64) ([]RawLog, error) {
	if len(addresses) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT DISTINCT ON (address) chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data
		 FROM raw_logs
		 WHERE chain_id = $1 AND address = ANY($2) AND block_number <= $3
		   AND array_length(topics, 1) >= 1 AND topics[1] = $4
		 ORDER BY address, block_number DESC, log_index DESC`,
		chainID, addresses, throughBlock, topic0)
	if err != nil {
		return nil, fmt.Errorf("read newest logs by topic (chain %d, through %d): %w", chainID, throughBlock, err)
	}
	defer rows.Close()
	var out []RawLog
	for rows.Next() {
		var l RawLog
		var logIndex int32
		if err := rows.Scan(&l.ChainID, &l.BlockNumber, &l.BlockHash, &l.TxHash,
			&logIndex, &l.Address, &l.Topics, &l.Data); err != nil {
			return nil, fmt.Errorf("scan newest-log row: %w", err)
		}
		l.LogIndex = uint32(logIndex)
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate newest logs by topic (chain %d): %w", chainID, err)
	}
	return out, nil
}

// RewindPrices discards the price rows engine OWNS above the effective rewind
// target and resets its cursor, acknowledging every reorg epoch on its chain —
// the price writers' counterpart to RewindDerived, in ONE transaction:
//
//   - The base target is min(toBlock, deepest unacknowledged rewound_to),
//     computed by the shared rewindTarget helper: because this call ACKS every
//     epoch on the chain, its deletion must reach the DEEPEST block any unacked
//     epoch rewound to. A lowered target is WARNed with both numbers.
//   - verifiedFloor RAISES that target back up when the caller has
//     INDEPENDENTLY HASH-VERIFIED a block as still canonical. Pass 0 for none.
//     This is the poller's anchor path: the walker's rewound_to is the deepest
//     block ITS OWN sparse logs could be hash-verified at, which says nothing
//     about where the chain actually forked, so lowering polled — and therefore
//     unrecoverable — history to it destroyed rows for blocks that were almost
//     certainly canonical. A caller that re-checked a stored poll anchor's hash
//     against the live chain at height H has proof that H and every ancestor are
//     unchanged, so rows at or below H are still describing the chain that
//     exists and are retained. verifiedFloor above toBlock is a caller bug and
//     is refused, because it would bless rows outside the cursor's coverage.
//   - Ownership is the row's own owner_engine, NOT a caller-supplied source
//     list. A chain-wide "delete above target" would destroy other writers'
//     rows (the ETH poller's ratio rows and the ETH feed deriver's stream rows
//     share chain 1), and scoping by the currently-loaded registry's sources
//     silently missed rows whose mechanism the registry no longer names — the
//     Chainlink phase-change orphan. An engine that owns no row deletes nothing
//     while still acking.
//   - The engine's poll anchors above the effective target are deleted with the
//     rows they describe: an anchor for a round whose rows are gone would
//     otherwise let a later repair "verify" history that no longer exists.
//   - The epoch ack and the deletions are ATOMIC: a crash can never leave the
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
func (s *Store) RewindPrices(ctx context.Context, engine string, chainID uint64, toBlock uint64, verifiedFloor uint64) error {
	if engine == "" {
		return fmt.Errorf("price rewind: engine is required (it is the ownership scope)")
	}
	if verifiedFloor > toBlock {
		return fmt.Errorf("price rewind %q: verified floor %d is above the requested target %d — a floor may only retain rows the cursor already covers",
			engine, verifiedFloor, toBlock)
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
		return fmt.Errorf("%w: engine %q is bound to chain %d, refusing price rewind for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}

	effectiveTarget, maxEpoch, err := rewindTarget(ctx, tx, engine, chainID, ackedEpoch, toBlock)
	if err != nil {
		return err
	}
	if verifiedFloor > effectiveTarget {
		slog.Warn("price rewind target RAISED to a hash-verified poll anchor: the walker's deepest unacknowledged target reflects only where ITS logs could be verified, and rows at or below an independently verified block are still canonical",
			"engine", engine, "chain", chainID, "callerTarget", toBlock,
			"walkerLoweredTarget", effectiveTarget, "verifiedFloor", verifiedFloor)
		effectiveTarget = verifiedFloor
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM prices WHERE chain_id = $1 AND owner_engine = $2 AND block_number > $3`,
		chainID, engine, effectiveTarget); err != nil {
		return fmt.Errorf("delete prices owned by %q above %d: %w", engine, effectiveTarget, err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM price_poll_anchors WHERE engine = $1 AND block_number > $2`,
		engine, effectiveTarget); err != nil {
		return fmt.Errorf("delete poll anchors for %q above %d: %w", engine, effectiveTarget, err)
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
