package store

// Oracle price persistence (Phase 2 Task 8, corrected by the Codex round-1 fix
// wave). The `prices` table comes from migration 00002; migration 00005 adds the
// three shapes this layer's contracts now rest on — `owner_engine`,
// `valid`/`invalid_reason`, and `price_poll_anchors`.
//
// TWO WRITERS, ONE CONTRACT. Both the engine-exact OP POLLER
// (PriceProviderV2.price(token) each interval) and the ETH CHAINLINK FEED
// deriver (AnswerUpdated logs read back out of raw_logs) write through
// ApplyPrices / ApplyPolledPrices and repair under their own PSEUDO-ENGINE derive
// cursors (through RewindPrices and NeutralizeUnverifiablePrices respectively —
// see below). Giving the pollers a cursor too — not just
// the log-derived feed path — is deliberate: a price row is stamped with the
// block it was observed at, and a reorg that replaces that block leaves the row
// describing a chain that no longer exists. Routing both writers through the
// same epoch-gated cursor means a reorg can never leave price rows above the
// rewind target, whichever writer produced them.
//
// OWNERSHIP IS DURABLE, NOT DERIVED FROM CONFIG. Every row records the
// pseudo-engine key of the writer that inserted it, and both repair primitives
// scope by that key. The earlier design scoped a rewind by the source strings the
// CALLER'S CURRENTLY LOADED REGISTRY named, which silently lost rows whenever
// the registry moved: after a manual Chainlink phase update the feed deriver
// owns only chainlink:<new-aggregator>, so a deep reorg crossing the phase
// boundary left the historical chainlink:<old-aggregator> rows above the
// effective target while the same transaction advanced acked_epoch — and once
// the epoch was pruned, nothing was left to trigger repair. A writer's engine
// key does not move when its registry does, so owner-scoped repair is immune to
// that class.
//
// THE TWO WRITERS GET DIFFERENT REPAIR PRIMITIVES, BECAUSE THEIR ROWS DIFFER IN
// RECOVERABILITY. The feed deriver RE-DERIVES the rows a rewind deleted: its input,
// raw_logs, is rewound and re-ingested by the walker, so RewindPrices costs it a
// replay. The poller CANNOT — it only ever reads `latest`, and no retained artifact
// reproduces a past-block contract read. Under D-010 the poller therefore has no
// deletion primitive at all (its PollStore surface does not declare one) and
// answers every reorg epoch through NeutralizeUnverifiablePrices: rows above the
// boundary are RETAINED and marked InvalidReasonUnverifiableReorg so nothing can
// read them or later "verify" them, the epoch is acked, ingestion resumes.
//
// The (block, hash) ANCHOR per landed round survives that change and does more
// work than before, not less. Repair walks the anchors down from the newest,
// keeping everything at or below the first one whose hash the caller re-verified
// against a live endpoint and marking only the suffix above it. A hash match at
// height H entails that every block up to H is unchanged on THAT endpoint's chain
// (blocks are chained by parent hash), so a verified floor is what confines the
// marking — the difference between an asset keeping its prices and losing their
// readability. A floor of 0 means the caller could place nothing, never that it
// gave up looking.
//
// This layer still does not decide policy. It marks what its caller's floor tells
// it to, and the caller is the one that must refuse on incomplete evidence;
// internal/prices.Poller does refuse, and reports the wait rather than marking
// while it is unsure. Three behaviours key off the marker: neutralization skips
// rows that already carry it, RewindPrices (the feed path) never deletes them, and
// insertPrice lets a fresh observation at the same identity supersede one — which
// is the only way a marked row becomes readable again, and the reason a wrong
// marking is recoverable where a wrong deletion is not.
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
// negative oracle answer. The column exists so a later validity rule does not
// need a schema change, and migration 00005's CHECK guarantees a non-positive
// row can never be valid whatever the reason says.
const invalidReasonNonPositive = "non-positive oracle answer"

// InvalidReasonUnverifiableReorg is the quarantine reason
// NeutralizeUnverifiablePrices records on a row that a reorg left neither
// provably canonical nor safely deletable. It is EXPORTED because it is part of
// the contract: it is the marker a reader uses to tell "the oracle answered
// garbage" from "the chain moved and this observation can no longer be placed on
// it", and three behaviours key off it (see NeutralizeUnverifiablePrices,
// insertPrice's supersede arm, and RewindPrices' retention clause).
//
// It is a CONSTANT string rather than one carrying the epoch number, because
// three SQL predicates test it by equality; the epoch, the row count and the
// target all reach the operator through the WARN that neutralization emits.
const InvalidReasonUnverifiableReorg = "unverifiable after a reorg: no surviving poll anchor covers this observation"

// pollAnchorRetention bounds how many of an engine's most recent poll anchors
// survive. At the default 60s cadence 4096 anchors cover roughly 2.8 days of
// polling, which is orders of magnitude deeper than any reorg this indexer expects
// to see.
//
// Losing older anchors does not corrupt repair and does not cause a deletion: rows
// whose anchors retention removed become UNVERIFIABLE, which is the state
// NeutralizeUnverifiablePrices answers — they are retained and marked unusable
// rather than deleted on absent evidence. The cost of retention is therefore the
// usability of history older than this window when a reorg reaches back past it,
// never its existence.
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

// PriceInsert is one row an apply ACTUALLY INSERTED, carrying the timestamp the
// DATABASE stamped on it.
//
// It exists because "the apply returned nil" is not evidence that anything was
// recorded. Replaying an already-persisted (chain_id, asset, source,
// block_number) identity with the same value is a deliberate no-op — precisely
// the path an RPC endpoint frozen exactly at the cursor takes every interval —
// so a caller that stamped freshness on every observation it SUBMITTED kept a
// stalled oracle green forever with no new durable fact anywhere. Only the rows
// named here are new durable facts, and ObservedAt is the value the database
// wrote, never a process clock.
type PriceInsert struct {
	Asset       []byte
	Source      string
	BlockNumber uint64
	// ObservedAt is prices.observed_at exactly as the database assigned it.
	ObservedAt time.Time
	// Valid mirrors the row's validity gate: false for a quarantined
	// non-positive answer. An invalid insert IS a new observation — it proves
	// the writer reached the oracle and is why the cursor may advance — but it
	// is not a usable price, so a caller must never let it refresh
	// usable-price freshness or readiness.
	Valid bool
	// InvalidReason is the quarantine reason, empty exactly when Valid.
	InvalidReason string
}

// ApplyResult reports what an apply DURABLY DID, as opposed to what it was
// asked to do. It is the structural half of the rule "health may be refreshed
// only by a durable, newly-observed fact": a caller cannot refresh anything
// without reading a row out of Inserted, and a call that inserted nothing
// yields an empty Inserted, so no code path exists by which a no-op apply makes
// anything look fresher. That property is enforced by the shape of this type
// rather than by a check a later reader could forget.
type ApplyResult struct {
	// Inserted holds one entry per row this call newly created, in submission
	// order. An idempotent replay contributes NOTHING.
	Inserted []PriceInsert
	// AnchorInserted is true only when this call created a NEW poll-anchor row,
	// i.e. when the round executed at a block this engine had not anchored
	// before. A frozen endpoint re-reporting the same execution block replays
	// the same (block, hash) anchor, which conflicts and leaves this false —
	// which is what lets a caller detect "the chain we can see is not moving"
	// from a durable fact instead of from process memory.
	AnchorInserted bool
	// AnchorBlock is the anchored execution block (0 when no anchor was passed).
	AnchorBlock uint64
	// AnchorObservedAt is price_poll_anchors.observed_at as the database
	// assigned it, set only when AnchorInserted.
	AnchorObservedAt time.Time
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

// StoredPollAnchor is an anchor READ BACK, so it also carries the database
// timestamp of the row's insertion. That timestamp is the durable answer to
// "when did this engine last observe a NEW execution block", which no process
// clock can fake and no replay can refresh.
type StoredPollAnchor struct {
	PollAnchor
	ObservedAt time.Time
}

// PriceFreshness is what one (asset, source) key's durable history says about
// both of the questions a health verdict has to separate:
//
//   - "did this writer REACH the oracle recently" — answered by the newest row
//     of ANY validity (BlockNumber/ObservedAt/Valid). A quarantined answer still
//     proves the read happened, which is why the cursor may advance on it.
//   - "is there a USABLE price for this key, and how recent is it" — answered by
//     ValidBlockNumber/ValidObservedAt, present only when HasValid.
//
// The two were previously conflated into one timestamp that deliberately
// included invalid rows, so an oracle returning zero every interval stayed
// "fresh" and readiness stayed green while no usable price existed at all.
// Quarantining kept the bad number out of consumers' hands; it did not make the
// health signal honest. Both fields are needed, so both are reported.
//
// ObservedAt/ValidObservedAt are DATABASE insertion times, which is the right
// clock for "did this writer land a price recently". Neither is the oracle's own
// updatedAt, which the prices table does not carry.
type PriceFreshness struct {
	Asset       []byte
	Source      string
	BlockNumber uint64
	ObservedAt  time.Time
	// Valid is the newest row's own validity.
	Valid bool
	// InvalidReason is that row's quarantine reason, empty exactly when Valid.
	InvalidReason string
	// HasValid reports whether ANY valid row exists for this key.
	HasValid         bool
	ValidBlockNumber uint64
	ValidObservedAt  time.Time
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
// current. Advancing the cursor is NOT a claim that prices were recorded.
//
// WHAT LANDED IS RETURNED, NOT INFERRED. The ApplyResult names the rows this
// call actually inserted with their database timestamps. That is the whole
// contract callers derive health from: a nil error says the transaction
// committed, and only ApplyResult says whether anything new exists. An
// idempotent replay commits and returns an EMPTY result, so a writer whose input
// has stopped changing cannot make its own freshness look newer.
//
// throughBlock is a HARD upper bound on the batch: an observation above it
// would live outside the cursor's coverage and survive a rewind that targets
// the cursor, so it is refused.
func (s *Store) ApplyPrices(ctx context.Context, engine string, chainID uint64, obs []PriceObservation, throughBlock uint64) (ApplyResult, error) {
	return s.applyPrices(ctx, engine, chainID, obs, throughBlock, nil)
}

// ApplyPolledPrices is ApplyPrices for the POLLER, which additionally records
// the round's execution (block, hash) as a durable anchor inside the same
// transaction. anchor.BlockNumber must equal throughBlock: the poller stamps
// every row in a round with the multicall's execution block and moves its cursor
// to that same block, so an anchor at any other height would not describe the
// round it claims to.
//
// A replayed anchor at the same height with the same hash is idempotent — and
// the returned ApplyResult reports AnchorInserted=false, which is how a caller
// learns that the execution block it just read is one it had already anchored.
// A replayed anchor with a DIFFERENT hash aborts the batch with
// ErrPollAnchorDivergence — the chain at that height changed, which is a reorg
// the walker has not recorded yet.
func (s *Store) ApplyPolledPrices(ctx context.Context, engine string, chainID uint64, obs []PriceObservation, throughBlock uint64, anchor PollAnchor) (ApplyResult, error) {
	if len(anchor.BlockHash) != 32 {
		return ApplyResult{}, fmt.Errorf("poll anchor for %q: block hash is %d bytes, want 32", engine, len(anchor.BlockHash))
	}
	if anchor.BlockNumber != throughBlock {
		return ApplyResult{}, fmt.Errorf("poll anchor for %q: anchor block %d must equal the batch through-block %d",
			engine, anchor.BlockNumber, throughBlock)
	}
	return s.applyPrices(ctx, engine, chainID, obs, throughBlock, &anchor)
}

func (s *Store) applyPrices(ctx context.Context, engine string, chainID uint64, obs []PriceObservation, throughBlock uint64, anchor *PollAnchor) (ApplyResult, error) {
	if engine == "" {
		return ApplyResult{}, fmt.Errorf("price batch: engine is required (it is the durable owner of every row)")
	}
	for i, o := range obs {
		if err := validatePriceObservation(o); err != nil {
			return ApplyResult{}, fmt.Errorf("price observation %d: %w", i, err)
		}
		if o.BlockNumber > throughBlock {
			return ApplyResult{}, fmt.Errorf("price observation %d (%s/%x): block %d is above the batch through-block %d",
				i, o.Source, o.Asset, o.BlockNumber, throughBlock)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ApplyResult{}, fmt.Errorf("begin: %w", err)
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
		return ApplyResult{}, fmt.Errorf("read derive cursor for %q: %w", engine, err)
	}
	if cursorExists && storedChain != chainID {
		return ApplyResult{}, fmt.Errorf("%w: engine %q is bound to chain %d, refusing price batch for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}
	maxEpoch, err := chainMaxEpoch(ctx, tx, chainID)
	if err != nil {
		return ApplyResult{}, err
	}
	if cursorExists && ackedEpoch < maxEpoch {
		return ApplyResult{}, fmt.Errorf("engine %q has %w %d on chain %d (acked %d): rewind prices before applying",
			engine, ErrUnackedReorgEpoch, maxEpoch, chainID, ackedEpoch)
	}
	if !cursorExists && maxEpoch > 0 {
		return ApplyResult{}, fmt.Errorf("engine %q has no derive cursor and chain %d carries %w %d: bootstrap via the engine's repair primitive (RewindPrices for event-derived engines, NeutralizeUnverifiablePrices for polled ones) before applying",
			engine, chainID, ErrUnackedReorgEpoch, maxEpoch)
	}

	var result ApplyResult
	for _, o := range obs {
		ins, inserted, err := insertPrice(ctx, tx, chainID, engine, o)
		if err != nil {
			return ApplyResult{}, err
		}
		if inserted {
			result.Inserted = append(result.Inserted, ins)
		}
	}
	if anchor != nil {
		result.AnchorBlock = anchor.BlockNumber
		at, inserted, err := insertPollAnchor(ctx, tx, chainID, engine, *anchor)
		if err != nil {
			return ApplyResult{}, err
		}
		result.AnchorInserted, result.AnchorObservedAt = inserted, at
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
		return ApplyResult{}, fmt.Errorf("upsert price cursor: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// The guarded upsert refused; the row must exist. Chain binding was
		// verified at the top of this transaction, so under the single-writer
		// contract the only remaining cause is a height regression — the
		// read-back keeps the disambiguation honest regardless.
		var refusedChain, storedBlock uint64
		if err := tx.QueryRow(ctx,
			`SELECT chain_id, last_block FROM derive_cursors WHERE engine = $1`, engine).Scan(&refusedChain, &storedBlock); err != nil {
			return ApplyResult{}, fmt.Errorf("price cursor refused move for %q, and read-back failed: %w", engine, err)
		}
		if refusedChain != chainID {
			return ApplyResult{}, fmt.Errorf("%w: engine %q is bound to chain %d, refusing price batch for chain %d",
				ErrDeriveCursorChainMismatch, engine, refusedChain, chainID)
		}
		return ApplyResult{}, fmt.Errorf("%w: engine %q refused move to %d (cursor at %d)",
			ErrDeriveCursorRegression, engine, throughBlock, storedBlock)
	}

	if anchor != nil {
		if err := pruneOldPollAnchors(ctx, tx, engine); err != nil {
			return ApplyResult{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		// The commit's error does NOT prove the batch failed to persist, so the
		// result is discarded: a caller must not treat rows it cannot confirm as
		// durable facts. Recovering the truth is the caller's re-hydration job.
		return ApplyResult{}, err
	}
	return result, nil
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
// It returns inserted=false for an idempotent replay, and on a fresh insert
// returns the row's DATABASE observed_at through the INSERT's own RETURNING
// clause. There is deliberately no path that reports a time for a row this call
// did not create: that is what makes "only a new durable row may refresh health"
// a property of the code's shape rather than a rule to remember.
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
func insertPrice(ctx context.Context, tx pgx.Tx, chainID uint64, ownerEngine string, o PriceObservation) (PriceInsert, bool, error) {
	valid := o.Price.Sign() > 0
	reason := ""
	if !valid {
		reason = invalidReasonNonPositive
		slog.Warn("oracle reported a NON-POSITIVE price; recording the raw fact but QUARANTINING it (valid=false) — no usable-price read can return it, and it does not refresh usable-price health; treat the feed as broken",
			"chain", chainID, "owner", ownerEngine, "asset", fmt.Sprintf("%x", o.Asset), "source", o.Source,
			"block", o.BlockNumber, "price", o.Price.String(), "priceDecimals", o.Decimals)
	}
	var observedAt time.Time
	err := tx.QueryRow(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (chain_id, asset, source, block_number) DO NOTHING
		RETURNING observed_at`,
		chainID, o.Asset, o.Source, pgtype.Numeric{Int: o.Price, Exp: 0, Valid: true}, o.Decimals,
		o.BlockNumber, ownerEngine, valid, reason).Scan(&observedAt)
	if err == nil {
		// Fresh insert. The asset is copied so the returned fact cannot alias a
		// caller's buffer that may be reused after the apply.
		asset := make([]byte, len(o.Asset))
		copy(asset, o.Asset)
		return PriceInsert{
			Asset: asset, Source: o.Source, BlockNumber: o.BlockNumber,
			ObservedAt: observedAt, Valid: valid, InvalidReason: reason,
		}, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PriceInsert{}, false, fmt.Errorf("save price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
	}
	// ON CONFLICT DO NOTHING suppressed the insert, so RETURNING yielded no row:
	// this key already exists. Idempotent only if the value, the scale AND the
	// owner all match; anything else aborts the batch rather than overwriting a
	// recorded fact or silently re-attributing its provenance.
	var existingText, existingOwner, existingReason string
	var existingDecimals int32
	if err := tx.QueryRow(ctx,
		`SELECT price::text, price_decimals, owner_engine, invalid_reason FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, o.Asset, o.Source, o.BlockNumber).Scan(&existingText, &existingDecimals, &existingOwner, &existingReason); err != nil {
		return PriceInsert{}, false, fmt.Errorf("read conflicting price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
	}
	if existingReason == InvalidReasonUnverifiableReorg && existingOwner == ownerEngine {
		// SUPERSEDING A NEUTRALIZED ROW. The recorded value was already declared
		// unplaceable on the chain (NeutralizeUnverifiablePrices), so a fresh
		// observation at the same identity is authoritative and the divergence
		// abort below must not fire on it: without this arm, a chain whose head
		// sits at a neutralized height would fail every round with a price
		// divergence it can never resolve. The row's observed_at is re-stamped
		// because this IS a new durable observation, and it is reported as an
		// insert for exactly that reason.
		var observedAt time.Time
		if err := tx.QueryRow(ctx, `UPDATE prices
			SET price = $5, price_decimals = $6, valid = $7, invalid_reason = $8, observed_at = now()
			WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4
			RETURNING observed_at`,
			chainID, o.Asset, o.Source, o.BlockNumber,
			pgtype.Numeric{Int: o.Price, Exp: 0, Valid: true}, o.Decimals, valid, reason).Scan(&observedAt); err != nil {
			return PriceInsert{}, false, fmt.Errorf("supersede neutralized price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
		}
		slog.Warn("re-observed a price at a height whose earlier row had been NEUTRALIZED as unverifiable after a reorg; the fresh observation supersedes it",
			"chain", chainID, "owner", ownerEngine, "asset", fmt.Sprintf("%x", o.Asset),
			"source", o.Source, "block", o.BlockNumber, "price", o.Price.String())
		asset := make([]byte, len(o.Asset))
		copy(asset, o.Asset)
		return PriceInsert{
			Asset: asset, Source: o.Source, BlockNumber: o.BlockNumber,
			ObservedAt: observedAt, Valid: valid, InvalidReason: reason,
		}, true, nil
	}
	existing, ok := new(big.Int).SetString(existingText, 10)
	if !ok {
		return PriceInsert{}, false, fmt.Errorf("parse price %q: not an integer", existingText)
	}
	if existing.Cmp(o.Price) != 0 || existingDecimals != o.Decimals {
		return PriceInsert{}, false, fmt.Errorf("price divergence: %s/%x@%d already holds %s (%d dec), refusing %s (%d dec) — aborting batch",
			o.Source, o.Asset, o.BlockNumber, existing, existingDecimals, o.Price, o.Decimals)
	}
	if existingOwner != ownerEngine {
		return PriceInsert{}, false, fmt.Errorf("price divergence: %s/%x@%d is owned by %q, refusing a replay from %q — aborting batch",
			o.Source, o.Asset, o.BlockNumber, existingOwner, ownerEngine)
	}
	return PriceInsert{}, false, nil
}

// insertPollAnchor records one round's (block, hash) anchor with the same
// idempotent-replay / divergence-abort posture as a price row. A divergent hash
// at a height this engine already anchored is ErrPollAnchorDivergence: the
// chain at that height changed, so the honest answer is to roll back and let the
// reorg protocol run, never to overwrite the anchor.
//
// inserted=false means the anchor already existed with the same hash — the round
// executed at a block this engine had already anchored. On a fresh insert the
// row's DATABASE observed_at is returned, which is the only timestamp a caller
// may use to say "we last saw the chain move at ...".
func insertPollAnchor(ctx context.Context, tx pgx.Tx, chainID uint64, engine string, a PollAnchor) (time.Time, bool, error) {
	var observedAt time.Time
	err := tx.QueryRow(ctx, `INSERT INTO price_poll_anchors (engine, chain_id, block_number, block_hash)
		VALUES ($1,$2,$3,$4) ON CONFLICT (engine, block_number) DO NOTHING
		RETURNING observed_at`,
		engine, chainID, a.BlockNumber, a.BlockHash).Scan(&observedAt)
	if err == nil {
		return observedAt, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, fmt.Errorf("record poll anchor %q@%d: %w", engine, a.BlockNumber, err)
	}
	var existingHash []byte
	var existingChain uint64
	if err := tx.QueryRow(ctx,
		`SELECT chain_id, block_hash FROM price_poll_anchors WHERE engine = $1 AND block_number = $2`,
		engine, a.BlockNumber).Scan(&existingChain, &existingHash); err != nil {
		return time.Time{}, false, fmt.Errorf("read conflicting poll anchor %q@%d: %w", engine, a.BlockNumber, err)
	}
	if existingChain != chainID {
		return time.Time{}, false, fmt.Errorf("%w: engine %q anchor at %d is recorded on chain %d, refusing chain %d",
			ErrDeriveCursorChainMismatch, engine, a.BlockNumber, existingChain, chainID)
	}
	if string(existingHash) != string(a.BlockHash) {
		return time.Time{}, false, fmt.Errorf("%w: engine %q at block %d holds %x, round reported %x — the chain at that height changed; aborting batch",
			ErrPollAnchorDivergence, engine, a.BlockNumber, existingHash, a.BlockHash)
	}
	return time.Time{}, false, nil
}

// pruneOldPollAnchors keeps only the pollAnchorRetention newest anchors for
// engine. Bounded growth is the point: anchors exist to answer "was this round's
// block replaced", a question that only has operational meaning within reorg
// depth of the head.
//
// EXCEPT WHERE THE ANCHOR IS THE ONLY PATH BACK (D-011 clause 5). An anchor at a
// height carrying NEUTRALIZED rows is not stale provenance, it is the sole evidence
// RevalidateNeutralizedPrices can restore those rows from — the poller reads only
// `latest`, so no fresh observation will ever arrive at that height to supersede
// them. Ageing it out would silently convert a recoverable marking into a permanent
// one, which is precisely the defect D-011 corrects; a retention bound that expires
// the recovery path is a slow version of deleting the anchor outright.
//
// The exemption is SELF-LIMITING rather than unbounded: it holds a height only while
// that height still has a marked row, and a successful revalidation (or a fresh
// observation superseding the row) clears the marker and hands the anchor back to
// the ordinary bound. What it can accumulate is genuinely-orphaned rounds, whose
// blocks no longer exist and which therefore never revalidate — the same pile
// NeutralizedPriceStats already counts, one anchor row per marked height, and the
// accepted cost D-010 named made durable instead of quietly discarded.
func pruneOldPollAnchors(ctx context.Context, tx pgx.Tx, engine string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM price_poll_anchors a
		WHERE a.engine = $1 AND a.block_number < (
			SELECT MIN(block_number) FROM (
				SELECT block_number FROM price_poll_anchors WHERE engine = $1
				ORDER BY block_number DESC LIMIT $2
			) keep
		)
		AND NOT EXISTS (
			SELECT 1 FROM prices p
			WHERE p.owner_engine = a.engine AND p.chain_id = a.chain_id
			  AND p.block_number = a.block_number AND p.invalid_reason = $3
		)`, engine, pollAnchorRetention, InvalidReasonUnverifiableReorg); err != nil {
		return fmt.Errorf("prune poll anchors for %q: %w", engine, err)
	}
	return nil
}

// PollAnchorsBelow returns engine's poll anchors at or below belowOrAt, in
// DESCENDING block order, capped at limit rows. Reorg repair PAGES down through
// this list across bounded Steps, verifying each anchor's hash against the live
// chain and stopping at the first match: that block is provably still canonical,
// so every price row at or below it is still describing the chain that exists.
//
// It is bounded-and-resumable rather than one-shot on purpose. A single Step may
// only spend a small probe budget, but abandoning verification once that budget
// is spent is what previously degraded repair to the destructive walker target;
// the caller instead lowers belowOrAt to the deepest anchor it has already
// probed and continues on its next Step.
func (s *Store) PollAnchorsBelow(ctx context.Context, engine string, chainID, belowOrAt uint64, limit int) ([]StoredPollAnchor, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT block_number, block_hash, observed_at FROM price_poll_anchors
		 WHERE engine = $1 AND chain_id = $2 AND block_number <= $3
		 ORDER BY block_number DESC LIMIT $4`,
		engine, chainID, belowOrAt, limit)
	if err != nil {
		return nil, fmt.Errorf("read poll anchors for %q at or below %d: %w", engine, belowOrAt, err)
	}
	defer rows.Close()
	var out []StoredPollAnchor
	for rows.Next() {
		var a StoredPollAnchor
		if err := rows.Scan(&a.BlockNumber, &a.BlockHash, &a.ObservedAt); err != nil {
			return nil, fmt.Errorf("scan poll anchor row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate poll anchors for %q: %w", engine, err)
	}
	return out, nil
}

// NewestPollAnchor returns engine's highest anchor whose round is still USABLE,
// with the database timestamp of the row's insertion. found=false when the engine
// has never anchored a round (or retention has removed every anchor, or every
// surviving anchor sits at a neutralized height).
//
// The timestamp is the DURABLE reference for "when did this engine last observe
// a NEW execution block". A poller hydrates its block-advance clock from it at
// startup, so a restart cannot grant a frozen RPC path a fresh window.
//
// WHY NEUTRALIZED HEIGHTS ARE EXCLUDED. This is the FRONTIER read — "the newest
// round we still stand behind" — and it has two consumers that both need that
// meaning: the block-advance health clock, and the regression classifier, which
// re-probes this anchor to decide whether the poller's own cursor still has
// canonical ancestry. Before D-011 clause 5 the exclusion was implicit, because
// NeutralizeUnverifiablePrices deleted the anchors it marked rows at. Now those
// anchors survive as provenance, so the exclusion has to be stated: without it a
// deep reorg would leave the newest anchor pointing at an orphaned height with an
// old timestamp, permanently tripping the block-advance condition and making every
// later cursor regression look like a fresh reorg. Retention of provenance must not
// change what the frontier MEANS.
//
// A height that revalidates loses its marker and returns to this read on its own,
// which is the correct behaviour: the round is usable again, so it is once more the
// newest thing this engine stands behind.
func (s *Store) NewestPollAnchor(ctx context.Context, engine string, chainID uint64) (StoredPollAnchor, bool, error) {
	var a StoredPollAnchor
	err := s.pool.QueryRow(ctx,
		`SELECT a.block_number, a.block_hash, a.observed_at FROM price_poll_anchors a
		 WHERE a.engine = $1 AND a.chain_id = $2
		   AND NOT EXISTS (
		     SELECT 1 FROM prices p
		     WHERE p.owner_engine = a.engine AND p.chain_id = a.chain_id
		       AND p.block_number = a.block_number AND p.invalid_reason = $3)
		 ORDER BY a.block_number DESC LIMIT 1`,
		engine, chainID, InvalidReasonUnverifiableReorg).Scan(&a.BlockNumber, &a.BlockHash, &a.ObservedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return StoredPollAnchor{}, false, nil
	}
	if err != nil {
		return StoredPollAnchor{}, false, fmt.Errorf("read newest poll anchor for %q: %w", engine, err)
	}
	return a, true, nil
}

// CountOwnedPricesAbove counts the rows engine owns strictly above aboveBlock on
// chainID — exactly the rows a RewindPrices to that target would DELETE.
//
// It answers "would an unverifiable rewind actually destroy anything", the
// question that distinguishes a refusal from a vacuous proceed. Reorg repair now
// reads that through PriceRepairExposure instead, because it also needs the
// EFFECTIVE target (which only the store can compute) and the unanchored count in
// the same instant; this remains the single-question read, and is what the
// owner-and-height-scoping contract test exercises.
//
// Rows already carrying InvalidReasonUnverifiableReorg are excluded, because
// RewindPrices does not delete them: they are retained artifacts, not history at
// risk, and counting them would make every later repair look destructive.
func (s *Store) CountOwnedPricesAbove(ctx context.Context, engine string, chainID, aboveBlock uint64) (int64, error) {
	var n int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM prices
		 WHERE chain_id = $1 AND owner_engine = $2 AND block_number > $3 AND invalid_reason <> $4`,
		chainID, engine, aboveBlock, InvalidReasonUnverifiableReorg).Scan(&n); err != nil {
		return 0, fmt.Errorf("count prices owned by %q above %d: %w", engine, aboveBlock, err)
	}
	return n, nil
}

// CountUnanchoredPricesAbove counts the rows engine owns strictly above
// aboveBlock at heights that NO surviving poll anchor covers.
//
// This is the load-bearing read for A1's invariant. A rewind is only allowed to
// delete above a floor when every row above that floor has been PROVEN
// non-canonical, and the only proof this system has is an anchor whose recorded
// hash no longer matches the live chain. A row at a height with no anchor has no
// such proof and can never acquire one — the hash of the block its round executed
// at was never recorded and cannot be recovered — so its presence above the
// deletion boundary is what forbids deletion outright.
//
// Rows already carrying InvalidReasonUnverifiableReorg are excluded for the same
// reason as in CountOwnedPricesAbove: they have already been accounted for once
// and are never deleted, so they must not veto a later proven deletion.
func (s *Store) CountUnanchoredPricesAbove(ctx context.Context, engine string, chainID, aboveBlock uint64) (int64, error) {
	var n int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM prices p
		 WHERE p.chain_id = $1 AND p.owner_engine = $2 AND p.block_number > $3
		   AND p.invalid_reason <> $4
		   AND NOT EXISTS (
		     SELECT 1 FROM price_poll_anchors a
		     WHERE a.engine = $2 AND a.chain_id = $1 AND a.block_number = p.block_number)`,
		chainID, engine, aboveBlock, InvalidReasonUnverifiableReorg).Scan(&n); err != nil {
		return 0, fmt.Errorf("count unanchored prices owned by %q above %d: %w", engine, aboveBlock, err)
	}
	return n, nil
}

// PriceRepairExposure is what one engine holds above the target a rewind would
// actually use — the facts a repair decision needs before it may delete, refuse,
// or neutralize.
//
// EffectiveTarget is computed here rather than by the caller because only this
// layer can read it: RewindPrices lowers a caller's target to the deepest
// unacknowledged rewound_to, so a caller reasoning about "rows above the target"
// from its own cursor alone would be reasoning about the wrong boundary. That
// mismatch is what made the pending-epoch legacy state undecidable: the poller
// could not tell "there is history above the boundary" from "there is not".
type PriceRepairExposure struct {
	// EffectiveTarget is min(toBlock, deepest unacknowledged rewound_to) — the
	// height above which a rewind acts.
	EffectiveTarget uint64
	// Owned counts rows above EffectiveTarget that a rewind would delete.
	Owned int64
	// Unanchored counts those of Owned at heights no surviving anchor covers.
	Unanchored int64
	// AnchoredHeights counts distinct anchored heights above EffectiveTarget.
	AnchoredHeights int64
	// ReorgGeneration is the chain's highest recorded reorg epoch at the instant
	// the fields above were read — the GENERATION the whole exposure describes.
	//
	// It exists because a repair decision is not a function of heights alone. A
	// caller that verifies anchors across several bounded Steps accumulates PROOFS
	// ("this anchor's recorded hash no longer matches the live chain"), and each
	// proof is only true of the chain as it stood when the probe ran. A second
	// reorg landing between two Steps can make a previously-mismatched anchor
	// canonical again, at which point the cached proof is false and acting on it
	// deletes canonical history. Every new reorg the walker records increments this
	// number, so a caller can bind its cached proofs to it and discard them when it
	// moves. It is 0 on a chain that has never been rewound.
	ReorgGeneration int64
}

// PriceRepairExposure reads all five facts in ONE transaction, so the target, the
// counts and the reorg generation describe the same instant. Under the enforced
// single-writer contract (D-004) nothing else is writing, but reading them
// together also means a caller cannot accidentally pair a stale target — or a
// stale generation — with fresh counts.
func (s *Store) PriceRepairExposure(ctx context.Context, engine string, chainID, toBlock uint64) (PriceRepairExposure, error) {
	var exp PriceRepairExposure
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return exp, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var ackedEpoch int64
	err = tx.QueryRow(ctx, `SELECT acked_epoch FROM derive_cursors WHERE engine = $1`, engine).Scan(&ackedEpoch)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return exp, fmt.Errorf("read acked epoch for %q: %w", engine, err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		ackedEpoch = 0 // bootstrap: every epoch on the chain counts as unacked
	}
	var deepestUnacked uint64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(MIN(rewound_to), $3) FROM reorg_epochs WHERE chain_id = $1 AND epoch > $2`,
		chainID, ackedEpoch, toBlock).Scan(&deepestUnacked); err != nil {
		return exp, fmt.Errorf("read deepest unacked rewind target for chain %d: %w", chainID, err)
	}
	exp.EffectiveTarget = min(toBlock, deepestUnacked)

	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM prices
		 WHERE chain_id = $1 AND owner_engine = $2 AND block_number > $3 AND invalid_reason <> $4`,
		chainID, engine, exp.EffectiveTarget, InvalidReasonUnverifiableReorg).Scan(&exp.Owned); err != nil {
		return exp, fmt.Errorf("count prices owned by %q above %d: %w", engine, exp.EffectiveTarget, err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM prices p
		 WHERE p.chain_id = $1 AND p.owner_engine = $2 AND p.block_number > $3
		   AND p.invalid_reason <> $4
		   AND NOT EXISTS (
		     SELECT 1 FROM price_poll_anchors a
		     WHERE a.engine = $2 AND a.chain_id = $1 AND a.block_number = p.block_number)`,
		chainID, engine, exp.EffectiveTarget, InvalidReasonUnverifiableReorg).Scan(&exp.Unanchored); err != nil {
		return exp, fmt.Errorf("count unanchored prices owned by %q above %d: %w", engine, exp.EffectiveTarget, err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM price_poll_anchors
		 WHERE engine = $1 AND chain_id = $2 AND block_number > $3`,
		engine, chainID, exp.EffectiveTarget).Scan(&exp.AnchoredHeights); err != nil {
		return exp, fmt.Errorf("count poll anchors for %q above %d: %w", engine, exp.EffectiveTarget, err)
	}
	// Read inside the SAME transaction as the counts: a generation paired with
	// counts from a different instant is exactly the stale-proof pairing the field
	// exists to prevent.
	exp.ReorgGeneration, err = chainMaxEpoch(ctx, tx, chainID)
	if err != nil {
		return exp, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PriceRepairExposure{}, err
	}
	return exp, nil
}

// NeutralizeUnverifiablePrices answers a reorg epoch WITHOUT deleting anything.
// Since D-010 it is the ONLY way the poller answers one.
//
// THE STATE IT WAS BUILT FOR. A poller holds rows above the effective rewind
// target at heights that no poll anchor covers — legacy history written before
// this engine anchored its rounds, or history whose anchors retention removed.
// Those rows cannot be proven canonical (no recorded hash to re-check) and cannot
// be proven orphaned (same reason), and no future fact changes that: the hash of
// the block their round executed at was never written down. Anchor adoption cannot
// help either, because adoption is itself refused while an epoch is pending — for
// the sound reason that it would otherwise record a REPLACEMENT block's hash.
//
// The three candidate answers, and why this is the one:
//
//   - DELETE them (the original behaviour): destroys history that was probably
//     canonical, irreversibly, on no evidence. This is finding A1.
//   - REFUSE forever (the behaviour before wave 4): the epoch gate then blocks
//     every apply, the poller stops ingesting prices, and nothing any code path
//     can do clears it — repair needs an anchor, adoption needs the ack, the ack
//     needs repair. A refusal no path can clear is an outage, not safety.
//   - NEUTRALIZE (this): the rows are RETAINED and marked
//     InvalidReasonUnverifiableReorg, so no usable-price read can return them; their
//     ANCHORS ARE RETAINED TOO, because the recorded block hash is the only thing a
//     later revalidation can check them against; the cursor is reset and every epoch
//     is acked, in ONE transaction. Nothing is destroyed, nothing unverifiable can
//     be read, and ingestion resumes.
//
// WHY IT IS NOW THE WHOLE ANSWER AND NOT THE LAST RESORT. Wave 4 reached here only
// when the evidence was UNOBTAINABLE, and deleted when it was merely strong. Five
// review rounds each found a new way for "strong" to be wrong — an incomplete case
// space, an expired proof, a proof assembled from several endpoints' forks — and
// each fix existed solely to justify destroying rows that cannot be re-read from
// anywhere. D-010 removes the destructive arm instead: a wrong marking is undone
// by the supersede rule below, a wrong deletion is not undone at all.
//
// WHAT IT DOES NOT CLAIM. It does not prove the rows are non-canonical. Marking a
// canonical row costs the availability of that asset's price at those heights
// until a fresh observation supersedes it, which is why the caller still has to
// reach a conclusion on complete evidence from one chain view rather than marking
// whenever it is unsure (D-010 clause 2, internal/prices.Poller.verifyFloor).
//
// THERE IS NO UN-NEUTRALIZE ON RE-INTERPRETATION: nothing anywhere flips the marker
// back on the strength of a later opinion about the same recorded value. Exactly two
// things clear it, and both are NEW EVIDENCE rather than a new reading of the old:
//
//   - a FRESH OBSERVATION at the same (chain, asset, source, block) identity, which
//     insertPrice treats as superseding the marked row;
//   - a HASH MATCH at the row's own recorded anchor, which RevalidateNeutralizedPrices
//     requires and the caller must have just read from the live chain. That is the
//     path D-011 clause 6 exists for: the poller only ever polls `latest`, so a fresh
//     observation can never land at a height the head has already passed, and without
//     revalidation every wrongly-marked PAST height stayed marked forever.
//
// verifiedFloor is honoured exactly as RewindPrices honours it: history at or below
// an INDEPENDENTLY hash-verified block is provably canonical, so it keeps its
// validity and only the rows above that boundary are marked. Passing 0 means no
// anchor verified and the whole suffix above the walker's target is unprovable.
//
// Returns the boundary it acted above and how many rows it marked.
func (s *Store) NeutralizeUnverifiablePrices(ctx context.Context, engine string, chainID, toBlock, verifiedFloor uint64) (boundary uint64, quarantined int64, err error) {
	if engine == "" {
		return 0, 0, fmt.Errorf("price neutralization: engine is required (it is the ownership scope)")
	}
	if verifiedFloor > toBlock {
		return 0, 0, fmt.Errorf("price neutralization %q: verified floor %d is above the requested target %d — a floor may only retain rows the cursor already covers",
			engine, verifiedFloor, toBlock)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var storedChain uint64
	var ackedEpoch int64
	cursorExists := true
	err = tx.QueryRow(ctx, `SELECT chain_id, acked_epoch FROM derive_cursors WHERE engine = $1`, engine).Scan(&storedChain, &ackedEpoch)
	if errors.Is(err, pgx.ErrNoRows) {
		cursorExists, ackedEpoch = false, 0
	} else if err != nil {
		return 0, 0, fmt.Errorf("read derive cursor for %q: %w", engine, err)
	}
	if cursorExists && storedChain != chainID {
		return 0, 0, fmt.Errorf("%w: engine %q is bound to chain %d, refusing price neutralization for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}

	effectiveTarget, maxEpoch, err := rewindTarget(ctx, tx, engine, chainID, ackedEpoch, toBlock)
	if err != nil {
		return 0, 0, err
	}
	if verifiedFloor > effectiveTarget {
		slog.Warn("price neutralization boundary RAISED to a hash-verified poll anchor: rows at or below an independently verified block are provably canonical and keep their validity",
			"engine", engine, "chain", chainID, "callerTarget", toBlock,
			"walkerLoweredTarget", effectiveTarget, "verifiedFloor", verifiedFloor)
		effectiveTarget = verifiedFloor
	}

	// ONLY ROWS THAT ARE STILL READABLE ARE MARKED. The predicate is `valid`, not
	// "does not already carry this marker", and the difference is not cosmetic: a
	// row quarantined for a DIFFERENT reason (a non-positive oracle answer) is
	// already unreadable, so re-marking it changes nothing a consumer can observe
	// and overwrites the true reason it is unusable. It would also inflate the
	// backlog NeutralizedPriceStats reports with rows that were never reorg fallout,
	// which is the number D-010 clause 4 exists to make trustworthy. RowsAffected is
	// then exactly "rows this call made unreadable".
	ct, err := tx.Exec(ctx, `UPDATE prices
		SET valid = FALSE, invalid_reason = $4
		WHERE chain_id = $1 AND owner_engine = $2 AND block_number > $3 AND valid`,
		chainID, engine, effectiveTarget, InvalidReasonUnverifiableReorg)
	if err != nil {
		return 0, 0, fmt.Errorf("neutralize prices owned by %q above %d: %w", engine, effectiveTarget, err)
	}
	quarantined = ct.RowsAffected()

	// THE ANCHORS ABOVE THE BOUNDARY ARE KEPT (D-011 clause 5). This call used to
	// DELETE them, reasoning that an anchor outliving its round's usability would
	// let a later repair "verify" a height this call declared unplaceable. That
	// reasoning inverted the anchor's role. The anchor is not a blessing, it is the
	// PROVENANCE — the hash of the block the round actually executed against — and
	// it is the only thing from which "was that block canonical after all?" can ever
	// be answered. Deleting it made the marking permanent: D-010 justified marking
	// over deleting on the grounds that marking is recoverable, and destroying the
	// provenance is exactly what removed the recovery. RevalidateNeutralizedPrices
	// consumes these rows; it can restore nothing at a height whose anchor is gone.
	//
	// Nothing here re-reads them as a licence. PollAnchorsBelow is scoped at or below
	// the cursor, which this transaction resets to effectiveTarget, so the retained
	// anchors sit above every height a repair pass looks at until fresh polls carry
	// the cursor back over them — and by then a match at one of them is a true
	// statement about the live chain, which is what a floor is supposed to mean.
	// NewestPollAnchor separately excludes neutralized heights, so the FRONTIER reads
	// (block-advance health, regression attribution) keep the semantics the deletion
	// gave them. Deletion was doing two jobs; only the second one was right.

	// The conflict arm never touches chain_id, exactly as in RewindPrices.
	if _, err := tx.Exec(ctx, `INSERT INTO derive_cursors (engine, chain_id, last_block, acked_epoch, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (engine) DO UPDATE
		SET last_block = EXCLUDED.last_block,
		    acked_epoch = EXCLUDED.acked_epoch, updated_at = now()`,
		engine, chainID, effectiveTarget, maxEpoch); err != nil {
		return 0, 0, fmt.Errorf("reset price cursor: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	slog.Warn("NEUTRALIZED unverifiable polled prices instead of deleting them: a reorg epoch left rows above the rewind boundary at heights no poll anchor covers, so they can be neither proven canonical nor proven orphaned. They are RETAINED and marked invalid, so no usable-price read can return them and no later repair can verify them; the epoch is acknowledged so price ingestion resumes",
		"engine", engine, "chain", chainID, "requestedTarget", toBlock,
		"verifiedFloor", verifiedFloor, "boundary", effectiveTarget,
		"rowsNeutralized", quarantined, "ackedEpoch", maxEpoch, "marker", InvalidReasonUnverifiableReorg)
	return effectiveTarget, quarantined, nil
}

// NeutralizedPriceStats is the size and age of one engine's retained-but-unusable
// backlog: rows NeutralizeUnverifiablePrices marked rather than deleted.
//
// It exists because the policy that keeps those rows has an accepted cost and the
// cost has to be countable (D-010 clause 4, carried forward by D-011). The pile now
// DRAINS as well as grows — RevalidateNeutralizedPrices retires every entry whose
// block turns out to still be canonical — so what remains after a drain is the
// genuinely-orphaned residue, and an operator who cannot see it cannot tell a
// handful of rows from a runaway.
//
// D-011 clause 8 is why the number must survive a recovery of the ACUTE signal: a
// newer poll clears ConditionPollInvalidAnswer for the assets it prices, and that
// says nothing whatever about the heights below it that are still unreadable. This
// count is scoped to the marker, not to the head, so it keeps reporting the
// historical gap after the current path is healthy again.
//
// Oldest/Newest are zero when Rows is 0.
type NeutralizedPriceStats struct {
	Rows         int64
	Oldest       time.Time
	Newest       time.Time
	HighestBlock uint64
}

// NeutralizedPriceStats counts the rows engine owns on chainID that carry the
// InvalidReasonUnverifiableReorg marker, with the observation times of the oldest
// and newest and the highest block among them.
//
// It is a plain read: it decides nothing and gates nothing. The marker is exact —
// exactly two paths clear it, insertPrice's supersede arm and
// RevalidateNeutralizedPrices, and both write the row — so this counts marked rows
// rather than estimating them.
func (s *Store) NeutralizedPriceStats(ctx context.Context, engine string, chainID uint64) (NeutralizedPriceStats, error) {
	var out NeutralizedPriceStats
	var oldest, newest *time.Time
	var highest *int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*), min(observed_at), max(observed_at), max(block_number)
		   FROM prices
		  WHERE chain_id = $1 AND owner_engine = $2 AND invalid_reason = $3`,
		chainID, engine, InvalidReasonUnverifiableReorg).Scan(&out.Rows, &oldest, &newest, &highest); err != nil {
		return NeutralizedPriceStats{}, fmt.Errorf("count neutralized prices owned by %q on chain %d: %w", engine, chainID, err)
	}
	if oldest != nil {
		out.Oldest = *oldest
	}
	if newest != nil {
		out.Newest = *newest
	}
	if highest != nil && *highest > 0 {
		out.HighestBlock = uint64(*highest)
	}
	return out, nil
}

// NeutralizedPriceAnchor is one candidate for revalidation: a height where this
// engine holds neutralized rows AND still holds the anchor recording the hash of
// the block that round executed against.
//
// Both halves are required and neither is optional. The rows are what is lost; the
// anchor is the only thing that can be checked against the live chain to get them
// back. A neutralized height with no surviving anchor simply never appears here —
// there is nothing to check — which is why D-011 clause 5 forbids deleting anchors
// during neutralization in the first place.
type NeutralizedPriceAnchor struct {
	BlockNumber uint64
	BlockHash   []byte
	Rows        int64
}

// NeutralizedPriceAnchors lists the revalidation candidates for engine, OLDEST
// FIRST, capped at limit.
//
// OLDEST FIRST IS DELIBERATE. A caller can only afford a few probes per Step, so
// some candidates always wait; the ones that have waited longest are the ones the
// backlog's reported AGE (NeutralizedPriceStats.Oldest) is measuring. Draining in
// that order makes that number a true measure of progress instead of one that never
// moves while the head of the pile is serviced repeatedly. The newest-first
// alternative would restore the most operationally useful prices first and leave the
// age metric permanently pinned to a row nothing ever reaches.
//
// This is a plain read: it proposes work, and proves nothing. The hash it returns is
// what was RECORDED, never what the chain says now — deciding whether the two agree
// is the caller's job, and RevalidateNeutralizedPrices re-checks the recorded half
// again inside its own transaction so a caller cannot restore rows by supplying a
// hash of its own invention.
func (s *Store) NeutralizedPriceAnchors(ctx context.Context, engine string, chainID uint64, limit int) ([]NeutralizedPriceAnchor, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT a.block_number, a.block_hash, count(*)
		   FROM price_poll_anchors a
		   JOIN prices p
		     ON p.owner_engine = a.engine AND p.chain_id = a.chain_id
		    AND p.block_number = a.block_number
		  WHERE a.engine = $1 AND a.chain_id = $2 AND p.invalid_reason = $3
		  GROUP BY a.block_number, a.block_hash
		  ORDER BY a.block_number ASC
		  LIMIT $4`,
		engine, chainID, InvalidReasonUnverifiableReorg, limit)
	if err != nil {
		return nil, fmt.Errorf("read neutralized poll anchors for %q on chain %d: %w", engine, chainID, err)
	}
	defer rows.Close()
	var out []NeutralizedPriceAnchor
	for rows.Next() {
		var a NeutralizedPriceAnchor
		if err := rows.Scan(&a.BlockNumber, &a.BlockHash, &a.Rows); err != nil {
			return nil, fmt.Errorf("scan neutralized poll anchor: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate neutralized poll anchors for %q: %w", engine, err)
	}
	return out, nil
}

// RevalidateNeutralizedPrices clears the reorg marker on engine's rows at one block,
// on proof that the block the round executed against is STILL ON THE CHAIN.
//
// THIS IS D-011 CLAUSE 6, AND IT IS THE HALF D-010 ASSERTED WITHOUT BUILDING. D-010
// preferred marking to deletion because marking "is recoverable", and pointed at
// insertPrice's supersede arm as the recovery. That arm only fires when a FRESH
// OBSERVATION lands at the same (chain, asset, source, block) identity — and the
// poller reads only `latest`, so once the canonical head has passed height H no poll
// will ever execute at H again. For every PAST height, the advertised recovery could
// not fire. The marking was permanent while being justified by its reversibility.
//
// WHAT MAKES THIS ONE FIRE WHERE THAT ONE CANNOT. It asks a different question of a
// different oracle. A price at H can only be re-read by executing at H, which this
// system cannot do. But the ANCESTRY of H can be re-read at any time, from any
// archive-free node, by asking for the header at H — and the round already wrote down
// which block it executed against. So "is this row's block still canonical?" is
// answerable for arbitrarily old H, and answering it yes is exactly the fact that
// makes the row usable again. The value was never in doubt; only its placement was.
//
// THE PROOF IS CHECKED HERE, NOT TRUSTED FROM THE CALLER. provenHash is what the
// caller just read from the live chain at that height, and the UPDATE fires only where
// it EQUALS THE RECORDED ANCHOR. A caller cannot restore a row by inventing a hash,
// cannot restore one whose anchor was pruned, and cannot restore one at a height it
// never anchored — the predicate has no arm for any of those. The caller's remaining
// obligation is the one the store cannot discharge: that provenHash really came from
// the chain, and (D-011 clause 7) that more than one endpoint said so.
//
// SCOPE, stated because each exclusion is load-bearing:
//
//   - `invalid_reason = InvalidReasonUnverifiableReorg` — only reorg fallout is
//     restored. A NON-POSITIVE answer carries a different reason and stays quarantined
//     forever, which is correct: its block being canonical says nothing about a price
//     of zero being usable.
//   - `price > 0` — belt and braces against the prices_valid_is_positive CHECK. No row
//     can hold the reorg marker without having been valid (and therefore positive) when
//     it was marked, so this predicate can only ever be redundant; if it ever is not,
//     the row stays marked instead of aborting the transaction on a constraint.
//   - owner and chain scoping — another engine's rows at the same height are not this
//     engine's to restore, and the anchor that proves the height belongs to this engine.
//
// It deliberately does NOT re-stamp observed_at. This is not a new observation of the
// oracle; it is a new proof about an old one. The recorded value and the moment it was
// read are unchanged, so re-stamping would falsify the freshness of a price nobody
// re-read — and would corrupt the backlog age D-011 clause 8 exposes.
//
// It is also deliberately not gated on a pending reorg epoch, unlike AdoptPollAnchor.
// Adoption WRITES provenance it did not witness, so a replacement block's hash could
// be recorded as if it were the round's; this call only READS provenance that already
// exists and requires the live chain to match it. A hash match at H is a direct proof
// that H is canonical — strictly better evidence than the log-ancestry estimate a
// walker rewind is derived from — so there is no epoch under which it becomes unsafe.
// The poller still runs it only on the no-epoch path, for the state-machine reason
// that repair returns early from a Step; that placement is convenience, not the
// safety argument.
//
// Returns how many rows became usable again.
func (s *Store) RevalidateNeutralizedPrices(ctx context.Context, engine string, chainID, block uint64, provenHash []byte) (int64, error) {
	if engine == "" {
		return 0, fmt.Errorf("price revalidation: engine is required (it is the ownership scope)")
	}
	if len(provenHash) != 32 {
		return 0, fmt.Errorf("price revalidation for %q at %d: proven block hash is %d bytes, want 32",
			engine, block, len(provenHash))
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var storedChain uint64
	if err := tx.QueryRow(ctx, `SELECT chain_id FROM derive_cursors WHERE engine = $1`, engine).Scan(&storedChain); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, fmt.Errorf("price revalidation for %q: no derive cursor, so this engine owns no history to revalidate", engine)
		}
		return 0, fmt.Errorf("read derive cursor for %q: %w", engine, err)
	}
	if storedChain != chainID {
		return 0, fmt.Errorf("%w: engine %q is bound to chain %d, refusing price revalidation for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}

	ct, err := tx.Exec(ctx, `UPDATE prices p
		SET valid = TRUE, invalid_reason = ''
		WHERE p.chain_id = $1 AND p.owner_engine = $2 AND p.block_number = $3
		  AND p.invalid_reason = $4 AND p.price > 0
		  AND EXISTS (
		    SELECT 1 FROM price_poll_anchors a
		    WHERE a.engine = $2 AND a.chain_id = $1
		      AND a.block_number = $3 AND a.block_hash = $5)`,
		chainID, engine, block, InvalidReasonUnverifiableReorg, provenHash)
	if err != nil {
		return 0, fmt.Errorf("revalidate neutralized prices owned by %q at %d: %w", engine, block, err)
	}
	restored := ct.RowsAffected()
	if restored == 0 {
		// Not an error. The height may have been revalidated already, its anchor may
		// disagree with the hash the caller read, or the anchor may be gone. All three
		// mean "nothing to restore here", and none of them is a reason to fail a pass
		// that is servicing a whole page of candidates.
		return 0, tx.Commit(ctx)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	slog.Warn("REVALIDATED polled prices that a reorg repair had neutralized: the block their round executed against is still on the canonical chain at that height, so the rows are usable again. Their recorded value and observation time are unchanged — this is a new proof about an old observation, not a new observation",
		"engine", engine, "chain", chainID, "block", block,
		"provenHash", fmt.Sprintf("%x", provenHash), "rowsRestored", restored)
	return restored, nil
}

// UnanchoredPriceBlocks returns the distinct blocks where engine owns price rows
// but has NO poll anchor, newest first, capped at limit.
//
// These are LEGACY rows: history written before this engine anchored its rounds
// (or before the anchor table existed). They are unverifiable, so reorg repair
// can neither prove them canonical nor safely delete them — which is why the
// poller adopts anchors for them proactively, while no reorg is pending. See
// AdoptPollAnchor for why the timing matters.
//
// HEIGHTS CARRYING NEUTRALIZED ROWS ARE EXCLUDED, for the reason AdoptPollAnchor's
// matching gate spells out: adopting the chain's current hash there would manufacture
// a "proof" that RevalidateNeutralizedPrices would then accept, restoring rows on the
// strength of the chain agreeing with a hash copied from itself. This query and that
// gate say the same thing in two places on purpose — the query keeps the poller from
// spending a probe on a candidate it must not adopt, and the gate is what makes the
// property independent of the query.
func (s *Store) UnanchoredPriceBlocks(ctx context.Context, engine string, chainID uint64, limit int) ([]uint64, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT DISTINCT p.block_number FROM prices p
		 WHERE p.chain_id = $1 AND p.owner_engine = $2
		   AND NOT EXISTS (
		     SELECT 1 FROM price_poll_anchors a
		     WHERE a.engine = $2 AND a.chain_id = $1 AND a.block_number = p.block_number)
		   AND NOT EXISTS (
		     SELECT 1 FROM prices n
		     WHERE n.chain_id = p.chain_id AND n.owner_engine = p.owner_engine
		       AND n.block_number = p.block_number AND n.invalid_reason = $4)
		 ORDER BY p.block_number DESC LIMIT $3`,
		chainID, engine, limit, InvalidReasonUnverifiableReorg)
	if err != nil {
		return nil, fmt.Errorf("read unanchored price blocks for %q: %w", engine, err)
	}
	defer rows.Close()
	var out []uint64
	for rows.Next() {
		var b uint64
		if err := rows.Scan(&b); err != nil {
			return nil, fmt.Errorf("scan unanchored price block: %w", err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate unanchored price blocks for %q: %w", engine, err)
	}
	return out, nil
}

// AdoptPollAnchor records an anchor for a block where engine ALREADY OWNS ROWS
// but never anchored — the one-time policy that makes legacy unanchored history
// repairable instead of permanently blocking repair.
//
// THE SAFETY ARGUMENT, STATED IN FULL, because this call writes a hash it did not
// witness at read time:
//
//   - It refuses unless engine owns at least one row at that exact block. It can
//     therefore never fabricate an anchor for history that does not exist, and it
//     cannot raise a rewind floor above where rows actually are.
//   - It refuses while ANY reorg epoch on the chain is unacknowledged by engine.
//     This is the load-bearing gate. Adopting during a pending reorg could take
//     the hash of a REPLACEMENT block at that height and then "verify" against
//     it, retaining rows that describe the block the chain discarded — exactly
//     the failure anchors exist to prevent. With no pending epoch, adopting the
//     live chain's current hash at a height we already hold rows for rests on the
//     same RPC trust as anchoring the round would have at the time.
//   - It never overwrites: a divergent hash at an already-anchored height is
//     ErrPollAnchorDivergence, as everywhere else.
//   - IT REFUSES AT A HEIGHT CARRYING NEUTRALIZED ROWS. This gate is new with D-011
//     clause 6 and it closes a circularity that clause would otherwise open. The
//     bullet below has always said an adopted hash does not prove the rows were read
//     at that block; while nothing could UN-mark a row that was a limitation, not a
//     hazard. Now RevalidateNeutralizedPrices restores rows whose recorded anchor
//     matches the live chain — so adopting the live hash at a marked height and then
//     "verifying" against it would be checking the chain against a copy of itself and
//     silently restoring rows a repair had just declared unplaceable. Provenance is
//     witnessed at poll time or it does not exist; a marked height with none stays
//     marked, which is the honest answer and the one NeutralizedPriceStats reports.
//
// WHAT IT DOES NOT DO: it does not prove the adopted block is the one the rows
// were read at. It cannot — that fact was never recorded. It establishes an
// anchor from the chain as it stands now, which is strictly better than having
// none for rows that are still USABLE, and the limitation is why the poller REFUSES
// to delete unanchored rows rather than adopting during repair.
func (s *Store) AdoptPollAnchor(ctx context.Context, engine string, chainID uint64, a PollAnchor) (bool, error) {
	if engine == "" {
		return false, fmt.Errorf("adopt poll anchor: engine is required")
	}
	if len(a.BlockHash) != 32 {
		return false, fmt.Errorf("adopt poll anchor for %q at %d: block hash is %d bytes, want 32",
			engine, a.BlockNumber, len(a.BlockHash))
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var storedChain uint64
	var ackedEpoch int64
	if err := tx.QueryRow(ctx,
		`SELECT chain_id, acked_epoch FROM derive_cursors WHERE engine = $1`,
		engine).Scan(&storedChain, &ackedEpoch); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, fmt.Errorf("adopt poll anchor for %q: no derive cursor, so this engine owns no verifiable history yet", engine)
		}
		return false, fmt.Errorf("read derive cursor for %q: %w", engine, err)
	}
	if storedChain != chainID {
		return false, fmt.Errorf("%w: engine %q is bound to chain %d, refusing anchor adoption for chain %d",
			ErrDeriveCursorChainMismatch, engine, storedChain, chainID)
	}
	maxEpoch, err := chainMaxEpoch(ctx, tx, chainID)
	if err != nil {
		return false, err
	}
	if ackedEpoch < maxEpoch {
		return false, fmt.Errorf("engine %q has %w %d on chain %d (acked %d): refusing to adopt an anchor while the chain may have moved under this height",
			engine, ErrUnackedReorgEpoch, maxEpoch, chainID, ackedEpoch)
	}

	var owned, neutralized int64
	if err := tx.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE invalid_reason = $4)
		   FROM prices WHERE chain_id = $1 AND owner_engine = $2 AND block_number = $3`,
		chainID, engine, a.BlockNumber, InvalidReasonUnverifiableReorg).Scan(&owned, &neutralized); err != nil {
		return false, fmt.Errorf("count owned rows at %d for %q: %w", a.BlockNumber, engine, err)
	}
	if owned == 0 {
		return false, fmt.Errorf("adopt poll anchor for %q at %d: this engine owns no row there, refusing to anchor history it did not write",
			engine, a.BlockNumber)
	}
	if neutralized > 0 {
		return false, fmt.Errorf("adopt poll anchor for %q at %d: %d row(s) there were NEUTRALIZED as unplaceable, and adopting the chain's current hash would let RevalidateNeutralizedPrices check the chain against a hash copied from that same chain — a proof of nothing. Provenance is witnessed at poll time or not at all",
			engine, a.BlockNumber, neutralized)
	}

	_, inserted, err := insertPollAnchor(ctx, tx, chainID, engine, a)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	if inserted {
		slog.Warn("ADOPTED a poll anchor for legacy unanchored price rows: the live chain's hash at a height this engine already owns rows at is now recorded, so reorg repair can verify that history instead of refusing to touch it. This does NOT prove the rows were read at this exact block — that fact was never recorded — it establishes the anchor the round should have written",
			"engine", engine, "chain", chainID, "block", a.BlockNumber,
			"adoptedHash", fmt.Sprintf("%x", a.BlockHash), "rowsAtBlock", owned)
	}
	return inserted, nil
}

// LatestPriceFreshness returns, for every (asset, source) key ownerEngine has
// ever written on chainID, BOTH durable answers a health verdict needs: the
// newest row of any validity, and the newest VALID row.
//
// It is the DURABLE source a restarted worker hydrates per-asset freshness from,
// so a restart cannot reset an already-dead oracle to "healthy for another grace
// window". Reporting validity alongside is what stops the second variant of the
// same disease: an earlier version returned one timestamp that deliberately
// included quarantined rows, so an oracle answering zero every interval kept
// refreshing "freshness" and /readyz stayed green with no usable price in
// existence.
func (s *Store) LatestPriceFreshness(ctx context.Context, chainID uint64, ownerEngine string) ([]PriceFreshness, error) {
	rows, err := s.pool.Query(ctx,
		`WITH newest AS (
		     SELECT DISTINCT ON (asset, source)
		            asset, source, block_number, observed_at, valid, invalid_reason
		     FROM prices WHERE chain_id = $1 AND owner_engine = $2
		     ORDER BY asset, source, block_number DESC
		 ), newest_valid AS (
		     SELECT DISTINCT ON (asset, source) asset, source, block_number, observed_at
		     FROM prices WHERE chain_id = $1 AND owner_engine = $2 AND valid
		     ORDER BY asset, source, block_number DESC
		 )
		 SELECT n.asset, n.source, n.block_number, n.observed_at, n.valid, n.invalid_reason,
		        v.block_number, v.observed_at
		 FROM newest n
		 LEFT JOIN newest_valid v ON v.asset = n.asset AND v.source = n.source
		 ORDER BY n.asset, n.source`,
		chainID, ownerEngine)
	if err != nil {
		return nil, fmt.Errorf("read price freshness for %q: %w", ownerEngine, err)
	}
	defer rows.Close()
	var out []PriceFreshness
	for rows.Next() {
		var f PriceFreshness
		var validBlock *int64
		var validAt *time.Time
		if err := rows.Scan(&f.Asset, &f.Source, &f.BlockNumber, &f.ObservedAt,
			&f.Valid, &f.InvalidReason, &validBlock, &validAt); err != nil {
			return nil, fmt.Errorf("scan price freshness row: %w", err)
		}
		if validBlock != nil && validAt != nil {
			f.HasValid = true
			f.ValidBlockNumber = uint64(*validBlock)
			f.ValidObservedAt = *validAt
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
		`SELECT DISTINCT ON (address) chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data, ingested_at
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
			&logIndex, &l.Address, &l.Topics, &l.Data, &l.IngestedAt); err != nil {
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

	// Rows already marked InvalidReasonUnverifiableReorg are RETAINED. They were
	// kept once precisely because nothing could place them on a chain, and they
	// are already unreadable through LatestUsablePrice; deleting them on a later
	// rewind would be the same unevidenced destruction, just deferred.
	if _, err := tx.Exec(ctx,
		`DELETE FROM prices
		 WHERE chain_id = $1 AND owner_engine = $2 AND block_number > $3 AND invalid_reason <> $4`,
		chainID, engine, effectiveTarget, InvalidReasonUnverifiableReorg); err != nil {
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
