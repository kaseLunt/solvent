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
// read them, the epoch is acked, ingestion resumes.
//
// D-012 CLAUSE 1 MAKES THAT SPLIT STRUCTURAL AT THIS LAYER RATHER THAN AT THE
// CALLER'S. "The poller has no deletion primitive" was true of the PollStore
// interface and false of *Store, which every other holder can reach — and did:
// repository tests called RewindPrices with poll-engine identities, leaving
// exactly the marked-without-provenance state clause 2 forbids. RewindPrices now
// REFUSES any engine in the PollOwnedEnginePrefix namespace, so the property no
// longer depends on which interface a caller happens to hold.
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
// insertPrice lets a fresh observation at the same identity supersede one.
//
// WHAT THE MARKER MEANS SINCE D-012: A PERMANENT CLASSIFICATION, NOT A PENDING
// REPAIR. Polled prices are 60-second SAMPLES of PriceProviderV2, not a ledger, and
// the sampling already has holes — RPC outages, oracle reverts, restarts — that no
// mechanism has ever made up. A wrongly-marked row is observationally identical to
// one of those missed polls (every consumer skips both) and differs only by
// carrying MORE: the value and the block hash its round executed against both
// survive. So the running system does not try to un-mark anything on its own. The
// D-011 online revalidation pass (NeutralizedPriceAnchors /
// RevalidateNeutralizedPrices / the per-Step drain) is REMOVED — it hosted both of
// Codex round 7's criticals, in the most correctness-critical path the poller had.
//
// EXACTLY ONE THING IN THE RUNNING SYSTEM CLEARS THE MARKER: insertPrice's
// supersede arm, which fires when a CURRENT poll lands at a marked height. That is
// a genuinely new observation, not a re-reading of the old one, and it is retained
// because without it a chain whose head still sits at a marked height would fail
// every round on an unresolvable price divergence.
//
// PROVENANCE IS RETAINED FOREVER ANYWAY (D-012 clause 2). Neutralization does not
// delete anchors, retention exempts anchors at marked heights, and RewindPrices
// cannot reach a poll engine at all. Nothing online consumes them; they are kept so
// an OFFLINE batch tool can answer "was that block canonical after all?" at any
// future time, at zero ongoing cost. No such tool is built, and no text here
// promises one.
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
	"strings"
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

// PollOwnedEnginePrefix is the colon-namespaced prefix every POLL-OWNED
// pseudo-engine key carries ("prices:poll:<chainID>"). It is the store's
// structural discriminator for D-012 clause 1.
//
// IT LIVES HERE, NOT IN internal/prices, BECAUSE THIS IS WHERE THE REFUSAL HAS TO
// BE. D-010 removed the poller's deletion path by leaving RewindPrices off the
// PollStore interface — true of the interface, false of *Store, which every other
// caller holds. Codex round 7 found repository tests rewinding poll engines, which
// deletes the anchors clause 2 requires to survive. A refusal keyed on a string the
// CALLING package owned would be a convention; internal/prices.PollCursorEngine
// builds its keys from this constant, so the store's test and the poller's key are
// the same string by construction rather than by agreement.
//
// The colon is what makes the namespace safe as a discriminator: config engine
// names carry no colons (see internal/prices' cursor-key note), so no event-derived
// engine can match by accident and no poll engine can miss by accident.
const PollOwnedEnginePrefix = "prices:poll:"

// ErrPollOwnedRewindRefused is what RewindPrices returns for a poll-owned engine.
//
// It is a SENTINEL rather than a plain error because the refusal is a contract, not
// a diagnostic: a caller (or a test) has to be able to assert that this specific
// structural rule fired, and not merely that some string appeared.
var ErrPollOwnedRewindRefused = errors.New("price rewind refused: this engine is poll-owned, and a polled row is a point-in-time contract read that nothing can re-derive (D-012 clause 1)")

// ErrNonPollNeutralizeRefused is what NeutralizeUnverifiablePrices returns for an
// engine OUTSIDE the poll-owned namespace. It is the mirror image of
// ErrPollOwnedRewindRefused, and the two together are what make D-012 clause 2
// structural rather than conventional: each repair primitive serves exactly one
// family of writers, so no caller can assemble a state the other primitive would then
// mishandle.
//
// THE STATE IT PREVENTS, WHICH CODEX ROUND 8 FOUND REACHABLE. Neutralization retains
// an engine's rows and marks them, and clause 2 requires the anchors recording their
// provenance to survive forever "on any store path". RewindPrices is legal for
// event-derived engines and deletes EVERY anchor above its target unconditionally. So
// a caller that neutralized under a non-poll identity — which the old signature
// accepted from any non-empty string — could then rewind that same identity and strip
// the provenance off retained marked rows: clause 2 violated through two individually
// legal calls.
//
// THE REFUSAL IS ON THE MARKING SIDE BECAUSE THE MARKING IS WHAT IS POLL-SPECIFIC.
// D-012's framing is that POLLED prices are samples — a marked row is observationally
// a missed poll, and the classification is accepted because nothing can re-derive the
// observation. An event-derived row does not have that property: raw_logs replays it,
// so its answer to a reorg is RewindPrices, and marking it would retain an unreadable
// row where a correct one could simply be re-derived. There is no engine for which
// both primitives are right, and this is the half that says so.
var ErrNonPollNeutralizeRefused = errors.New("price neutralization refused: this engine is not poll-owned, and neutralization is the POLLED writer's answer to a reorg epoch — an event-derived engine re-derives its rows from raw_logs through RewindPrices instead (D-012 clause 2)")

// IsPollOwnedEngine reports whether engine is a poll-owned pseudo-engine key, i.e.
// one whose rows are point-in-time `latest` reads with no replayable input.
func IsPollOwnedEngine(engine string) bool {
	return strings.HasPrefix(engine, PollOwnedEnginePrefix)
}

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
	// Superseded counts the rows in Inserted that REPLACED a row carrying
	// InvalidReasonUnverifiableReorg, rather than creating a new one.
	//
	// It exists for D-012 clause 6's cost bound. The supersede arm is the only thing
	// in the running system that shrinks the neutralized backlog, so it is the only
	// landed-round event that can change NeutralizedPriceStats — and that aggregate
	// scanned an ever-growing table with no index on its predicate before 00007, and is
	// still paid per call. Recomputing it
	// after every round (wave 7) made a per-cadence cost proportional to total price
	// history; recomputing it when this field is non-zero makes the cost proportional
	// to the number of transitions, which is what clause 6 requires. It is DERIVED
	// from what the database did — the arm reports itself — so no caller can infer it
	// wrongly from the shape of what it submitted.
	Superseded int64
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

	// THE ANCHOR IS RECORDED BEFORE THE ROWS IT VOUCHES FOR, so the binding each row
	// carries names a row that exists in this same transaction. Order matters only for
	// readability — both statements commit together — but it is the order the
	// dependency runs in, and a reader should not have to check.
	var result ApplyResult
	var anchorBlock *uint64
	if anchor != nil {
		result.AnchorBlock = anchor.BlockNumber
		at, inserted, err := insertPollAnchor(ctx, tx, chainID, engine, *anchor)
		if err != nil {
			return ApplyResult{}, err
		}
		result.AnchorInserted, result.AnchorObservedAt = inserted, at
		// Bound even when inserted=false: an idempotent replay means the anchor for
		// THIS execution block was already recorded, by an earlier round that executed
		// at the same block. It vouches for this round's observations exactly as it
		// vouched for that one's — same engine, same block, same hash, verified by
		// insertPollAnchor's divergence abort — so a replayed anchor is still a
		// witnessed one, and withholding the binding here would manufacture an
		// unprovable row out of a perfectly provable round.
		b := anchor.BlockNumber
		anchorBlock = &b
	}
	for _, o := range obs {
		ins, inserted, superseded, err := insertPrice(ctx, tx, chainID, engine, o, anchorBlock)
		if err != nil {
			return ApplyResult{}, err
		}
		if inserted {
			result.Inserted = append(result.Inserted, ins)
		}
		if superseded {
			result.Superseded++
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
// superseded=true is the narrower fact "this insert REPLACED a neutralized row",
// reported separately from inserted because the two answer different questions: a
// caller derives health from inserted, and the backlog-recount decision (D-012
// clause 6) from superseded. It is set on exactly one arm below.
//
// anchorBlock IS THE ROW'S PROVENANCE, AND IT IS A PARAMETER RATHER THAN A LOOKUP
// (D-012 clause 2, Codex round 8's [high] #2). It is the block of the anchor this
// round recorded in this same transaction, or nil when the round recorded none. The
// caller passes it down because provenance is a fact about the ROUND — "an anchor was
// witnessed and written alongside this observation" — and the only place that fact
// exists is where the round is being applied. Deriving it here, by asking whether any
// anchor happens to sit at o.BlockNumber, is precisely the fabrication the finding
// names: a later round anchoring at a height would retroactively become provenance for
// every older row there, including ones it never covered. nil stores NULL, which means
// unprovable and never "look it up by height".
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
func insertPrice(ctx context.Context, tx pgx.Tx, chainID uint64, ownerEngine string, o PriceObservation, anchorBlock *uint64) (ins PriceInsert, inserted bool, superseded bool, err error) {
	valid := o.Price.Sign() > 0
	reason := ""
	if !valid {
		reason = invalidReasonNonPositive
		slog.Warn("oracle reported a NON-POSITIVE price; recording the raw fact but QUARANTINING it (valid=false) — no usable-price read can return it, and it does not refresh usable-price health; treat the feed as broken",
			"chain", chainID, "owner", ownerEngine, "asset", fmt.Sprintf("%x", o.Asset), "source", o.Source,
			"block", o.BlockNumber, "price", o.Price.String(), "priceDecimals", o.Decimals)
	}
	var observedAt time.Time
	err = tx.QueryRow(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason, anchor_block)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (chain_id, asset, source, block_number) DO NOTHING
		RETURNING observed_at`,
		chainID, o.Asset, o.Source, pgtype.Numeric{Int: o.Price, Exp: 0, Valid: true}, o.Decimals,
		o.BlockNumber, ownerEngine, valid, reason, anchorBlock).Scan(&observedAt)
	if err == nil {
		// Fresh insert. The asset is copied so the returned fact cannot alias a
		// caller's buffer that may be reused after the apply.
		asset := make([]byte, len(o.Asset))
		copy(asset, o.Asset)
		return PriceInsert{
			Asset: asset, Source: o.Source, BlockNumber: o.BlockNumber,
			ObservedAt: observedAt, Valid: valid, InvalidReason: reason,
		}, true, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PriceInsert{}, false, false, fmt.Errorf("save price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
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
		return PriceInsert{}, false, false, fmt.Errorf("read conflicting price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
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
		// THE BINDING IS RE-STAMPED WITH THIS ROUND'S ANCHOR, exactly as observed_at is,
		// and for the same reason: this IS a new durable observation, so its provenance
		// is THIS round's anchor rather than whatever the superseded row carried. When
		// the superseding round recorded no anchor the binding goes back to NULL — the
		// honest answer, since a row that has just been overwritten by an unanchored
		// observation is no longer vouched for by anything.
		var observedAt time.Time
		if err := tx.QueryRow(ctx, `UPDATE prices
			SET price = $5, price_decimals = $6, valid = $7, invalid_reason = $8, anchor_block = $9, observed_at = now()
			WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4
			RETURNING observed_at`,
			chainID, o.Asset, o.Source, o.BlockNumber,
			pgtype.Numeric{Int: o.Price, Exp: 0, Valid: true}, o.Decimals, valid, reason, anchorBlock).Scan(&observedAt); err != nil {
			return PriceInsert{}, false, false, fmt.Errorf("supersede neutralized price %s/%x@%d: %w", o.Source, o.Asset, o.BlockNumber, err)
		}
		slog.Warn("re-observed a price at a height whose earlier row had been NEUTRALIZED as unverifiable after a reorg; the fresh observation supersedes it",
			"chain", chainID, "owner", ownerEngine, "asset", fmt.Sprintf("%x", o.Asset),
			"source", o.Source, "block", o.BlockNumber, "price", o.Price.String())
		asset := make([]byte, len(o.Asset))
		copy(asset, o.Asset)
		return PriceInsert{
			Asset: asset, Source: o.Source, BlockNumber: o.BlockNumber,
			ObservedAt: observedAt, Valid: valid, InvalidReason: reason,
		}, true, true, nil
	}
	existing, ok := new(big.Int).SetString(existingText, 10)
	if !ok {
		return PriceInsert{}, false, false, fmt.Errorf("parse price %q: not an integer", existingText)
	}
	if existing.Cmp(o.Price) != 0 || existingDecimals != o.Decimals {
		return PriceInsert{}, false, false, fmt.Errorf("price divergence: %s/%x@%d already holds %s (%d dec), refusing %s (%d dec) — aborting batch",
			o.Source, o.Asset, o.BlockNumber, existing, existingDecimals, o.Price, o.Decimals)
	}
	if existingOwner != ownerEngine {
		return PriceInsert{}, false, false, fmt.Errorf("price divergence: %s/%x@%d is owned by %q, refusing a replay from %q — aborting batch",
			o.Source, o.Asset, o.BlockNumber, existingOwner, ownerEngine)
	}
	return PriceInsert{}, false, false, nil
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
// EXCEPT AT A NEUTRALIZED HEIGHT, WHERE THE ANCHOR IS PERMANENT PROVENANCE (D-012
// clause 2). An anchor at a height carrying NEUTRALIZED rows is not stale: it is the
// hash of the block that round actually executed against, and it is the whole input
// an OFFLINE reconciliation would need to answer "was that block canonical after
// all?". Clause 2 says no retention bound, prune or rewind may expire it, on any
// store path — a bound that aged it out would be a deferred version of the deletion
// the clause forbids, and would close an option D-012 deliberately keeps open at
// zero ongoing cost.
//
// NOTHING ONLINE CONSUMES IT. D-011's revalidation pass is gone (D-012 clause 3);
// this is retention for its own sake, and the honest description of the cost is
// below rather than a recovery story.
//
// THE EXEMPTION IS EFFECTIVELY PERMANENT, AND SAYING SO IS PART OF CLAUSE 7. Wave 7
// described it as SELF-LIMITING — it holds a height only while that height still has
// a marked row, and clearing the marker hands the anchor back — which was true while
// an online revalidation could clear one at any height. It is now misleading: the only
// thing that clears a marker is a fresh observation at the row's identity, and the
// cursor's monotonic guard refuses a batch below the cursor, so a height retention has
// already aged past can never be cleared. (Asserted, not reasoned:
// TestPollAnchorRetentionExemptsNeutralizedHeights drives the refusal.) The release
// only exists for the shallow case where the head is still at the classified height —
// exactly where retention has not aged it out anyway.
//
// So the standing cost is ONE ANCHOR ROW PER CLASSIFIED HEIGHT, forever, growing with
// reorg frequency and not bounded in principle. That is the same pile
// NeutralizedPriceStats counts, and it is the accepted cost D-010 named for the rows
// themselves, now made durable instead of quietly discarded.
//
// AND IT IS PAID FOR ONCE PER HEIGHT, NOT ONCE PER ROUND (D-012 clause 6, Codex round
// 8's [high] #4). Wave 8 evaluated the exemption over every anchor below the window on
// every anchored round, and this function runs inside every anchored round — so
// permanently-protected anchors were re-examined at the poll cadence, forever, and the
// per-round cost grew with the ALL-TIME number of classified heights. Clause 6 says
// permanent state must be cheap to CARRY, which that was not.
//
// THE FRONTIER IS WHAT MAKES IT INCREMENTAL. price_poll_anchor_prune.frontier records
// "every anchor for this engine strictly below here has already been considered, and
// whatever survives there is permanently protected", so each call only looks at
// [frontier, cutoff) — the heights that have newly fallen out of retention, normally
// one per round. Below-frontier heights are settled and never re-read.
//
// WHY "SETTLED" IS A FACT AND NOT A HOPE. The frontier only ever advances to the
// retention cutoff, pollAnchorRetention anchors BELOW the newest. Releasing an
// exemption requires clearing the marker on the rows at that height; the sole clearer
// is insertPrice's supersede arm, which needs a CURRENT poll to land at that exact
// height; and the cursor's monotonic guard refuses any batch below the cursor. A
// height a full retention window behind the cursor therefore cannot be superseded, so
// nothing below the frontier can ever become prunable. Skipping it loses no deletion —
// it is not a heuristic that trades completeness for speed.
//
// THE CLAIM IS RE-CHECKED, NOT TRUSTED. A stored frontier ABOVE the current retention
// cutoff is impossible in a population this frontier truly describes, so finding one
// means the anchors were replaced beneath it; the frontier is discarded and one full
// pass runs. The check costs nothing — both numbers are already read — and it is what
// keeps the optimisation from being able to lose a deletion silently. Since legacy
// anchor adoption was deleted there is no path at all that places an anchor below the
// frontier — adoption was the one that could, and it lowered the frontier itself — so
// the backstop now guards against nothing the current code does, which is exactly the
// condition under which a re-checked premise is worth keeping rather than dropping.
// prunePollAnchorsQuery is the prune's DELETE, kept as a package constant so the
// EXPLAIN test measures THIS statement rather than a copy of it. A performance test
// that re-types the query it is measuring proves nothing about the code: the two drift,
// and the test keeps passing against the shape it remembers.
//
// $1 engine, $2 frontier (inclusive), $3 retention cutoff (exclusive), $4 marker.
const prunePollAnchorsQuery = `DELETE FROM price_poll_anchors a
		WHERE a.engine = $1
		  AND a.block_number >= $2 AND a.block_number < $3
		  AND NOT EXISTS (
		    SELECT 1 FROM prices p
		    WHERE p.chain_id = a.chain_id AND p.owner_engine = a.engine
		      AND p.block_number = a.block_number AND p.invalid_reason = $4
		  )
		  AND NOT EXISTS (
		    SELECT 1 FROM prices p
		    WHERE p.chain_id = a.chain_id AND p.owner_engine = a.engine
		      AND p.anchor_block = a.block_number AND p.invalid_reason = $4
		  )`

func pruneOldPollAnchors(ctx context.Context, tx pgx.Tx, engine string) error {
	var frontier int64
	err := tx.QueryRow(ctx, `SELECT frontier FROM price_poll_anchor_prune WHERE engine = $1`, engine).Scan(&frontier)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read poll-anchor prune frontier for %q: %w", engine, err)
	}
	// The retention cutoff: the lowest height among the pollAnchorRetention newest
	// anchors. Everything strictly below it is out of the window.
	var cutoff *int64
	if err := tx.QueryRow(ctx, `SELECT MIN(block_number) FROM (
			SELECT block_number FROM price_poll_anchors WHERE engine = $1
			ORDER BY block_number DESC LIMIT $2
		) keep`, engine, pollAnchorRetention).Scan(&cutoff); err != nil {
		return fmt.Errorf("read poll-anchor retention cutoff for %q: %w", engine, err)
	}
	if cutoff == nil {
		return nil // this engine has no anchors at all
	}
	switch {
	case *cutoff == frontier:
		// NOTHING NEW HAS FALLEN OUT OF THE WINDOW. This is the steady-state branch and
		// the whole of the finding: two indexed reads, no delete, no dependence
		// whatever on how many permanently-protected anchors sit below the frontier.
		return nil
	case *cutoff < frontier:
		// THE FRONTIER'S CLAIM IS FALSE, SO IT IS DISCARDED RATHER THAN TRUSTED. The
		// frontier only ever advances TO a cutoff, and a cutoff only rises while anchors
		// are added at rising heights, so a cutoff BELOW the stored frontier means the
		// anchor population this frontier described no longer exists — heights were
		// removed and lower ones took their place. Continuing would skip them forever.
		//
		// This is the difference between an optimisation and a shortcut: the premise is
		// re-checked every round, for free, out of two numbers already in hand, and the
		// failure mode is one full pass rather than a silent deletion leak. Nothing in
		// the running system can produce it — a poll round's anchor is at or above the
		// cursor, and adoption, the one path that ever placed an anchor lower, is gone —
		// which is exactly why it must not be assumed away.
		slog.Warn("poll-anchor prune frontier DISCARDED: it sits above the current retention cutoff, so it describes an anchor population that no longer exists. Reconsidering every anchor once, then resuming incremental pruning",
			"engine", engine, "staleFrontier", frontier, "retentionCutoff", *cutoff)
		frontier = 0
	}
	// The window considered by THIS call is exactly [frontier, cutoff) — the heights
	// that have newly fallen out of retention, normally one per round. Anchors below
	// the frontier were considered by an earlier call and are not looked at again.
	// THE TWO EXEMPTION TESTS ARE SEPARATE NOT EXISTS CLAUSES, NOT ONE WITH AN `OR`,
	// and that is a plan decision rather than a style one. Written as a disjunction,
	// PostgreSQL cannot drive either side by index — it builds a Hash Anti Join whose
	// inner side materialises EVERY marked row for the engine, which puts the
	// all-time classified-height count straight back into the per-round cost this
	// finding is about, just on the other side of the join. Split, each clause is a
	// correlated lookup: the first on prices_owner_idx (chain_id, owner_engine,
	// block_number), the second on 00007's prices_anchor_binding_idx (chain_id,
	// owner_engine, anchor_block).
	//
	// BOTH ARE REQUIRED, AND THEY ARE NOT REDUNDANT. The binding clause is the exact
	// one — an anchor is provenance for whatever rows point AT it, and a round may
	// stamp rows at heights below its own execution block. The height clause is the
	// conservative one, and it is what protects PRE-00007 marked rows, whose binding
	// is NULL and whose height anchor may well be their genuine provenance. Dropping
	// it would expire exactly the anchors clause 2 most wants kept, on the strength of
	// a fact the database never recorded.
	if _, err := tx.Exec(ctx, prunePollAnchorsQuery,
		engine, frontier, *cutoff, InvalidReasonUnverifiableReorg); err != nil {
		return fmt.Errorf("prune poll anchors for %q: %w", engine, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO price_poll_anchor_prune (engine, frontier, updated_at)
		VALUES ($1,$2,now())
		ON CONFLICT (engine) DO UPDATE SET frontier = EXCLUDED.frontier, updated_at = now()`,
		engine, *cutoff); err != nil {
		return fmt.Errorf("advance poll-anchor prune frontier for %q: %w", engine, err)
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
// canonical ancestry. Before anchors survived neutralization the exclusion was
// implicit, because the anchor was deleted with the marking. Anchors are now
// retained forever (D-012 clause 2), so the exclusion has to be stated: without it a
// deep reorg would leave the newest anchor pointing at an orphaned height with an
// old timestamp, permanently tripping the block-advance condition and making every
// later cursor regression look like a fresh reorg. Retention of provenance must not
// change what the frontier MEANS.
//
// A height whose marker is cleared by a fresh observation (insertPrice's supersede
// arm — the only thing that clears one in the running system, D-012 clause 3)
// returns to this read on its own, which is correct: the round is usable again, so
// it is once more the newest thing this engine stands behind.
//
// AND THE EXCLUSION ASKS BOTH QUESTIONS, LIKE prunePollAnchorsQuery (Codex round 9's
// [high] #1). "Is this anchor's round still one we stand behind" is answered by the
// rows BOUND to it — a round may stamp observations below its own execution block,
// and if those were marked the round is not usable however clean its height looks.
// The height clause alone missed exactly that. It is kept alongside rather than
// replaced because it is the CONSERVATIVE one: a pre-00007 marked row has a NULL
// binding, and the anchor at its height may well be its genuine provenance, so a
// marked row sitting at an anchor's height still withdraws that anchor from the
// frontier. Both clauses only ever EXCLUDE, and exclusion is the safe direction for
// every consumer of this read: a lower frontier makes the block-advance clock trip
// sooner and makes a cursor regression look older, never fresher.
//
// TWO SEPARATE NOT EXISTS RATHER THAN ONE WITH `OR`, for the plan reason
// prunePollAnchorsQuery spells out: split, each is a correlated index lookup (the
// first on prices_owner_idx, the second on 00007's prices_anchor_binding_idx);
// written as a disjunction PostgreSQL can drive neither by index.
func (s *Store) NewestPollAnchor(ctx context.Context, engine string, chainID uint64) (StoredPollAnchor, bool, error) {
	var a StoredPollAnchor
	err := s.pool.QueryRow(ctx,
		`SELECT a.block_number, a.block_hash, a.observed_at FROM price_poll_anchors a
		 WHERE a.engine = $1 AND a.chain_id = $2
		   AND NOT EXISTS (
		     SELECT 1 FROM prices p
		     WHERE p.owner_engine = a.engine AND p.chain_id = a.chain_id
		       AND p.block_number = a.block_number AND p.invalid_reason = $3)
		   AND NOT EXISTS (
		     SELECT 1 FROM prices p
		     WHERE p.owner_engine = a.engine AND p.chain_id = a.chain_id
		       AND p.anchor_block = a.block_number AND p.invalid_reason = $3)
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

// unprovableRow is the READ-SIDE definition of "this observation has no
// provenance", written once and shared by every consumer that decides what a repair
// may act on, so the definition cannot drift between them. The row is aliased `p`;
// $1 is chain_id and $2 is the owning engine.
//
// IT ASKS THE ROW'S OWN BINDING AND NEVER ITS HEIGHT (D-012 clause 2, migration
// 00007, Codex round 9's [high] #1). Wave 10 bound provenance per observation at
// WRITE time and left every read joining an anchor to p.block_number. The two
// diverge exactly where it matters: a legacy NULL-bound row at H, joined at H by a
// LATER round's anchor, was reported as anchored — and if that later anchor then
// matched during repair, verifyFloor established H as a height-wide floor and the
// old observation kept its validity on the strength of a hash recorded for somebody
// else's round. That is the fabrication migration 00007 exists to forbid, arriving
// through the read side instead of the write side.
//
// THE NULL SEMANTICS ARE THE SQL'S OWN, NOT A SEPARATE BRANCH. When p.anchor_block
// is NULL the comparison `a.block_number = p.anchor_block` is NULL rather than true,
// no anchor row matches, and NOT EXISTS holds — so a pre-00007 row is unprovable
// everywhere, including at or below a later matching height anchor. That is the
// assertion migration 00007 wrote the NULL to make, and it is why a backfill of
// "anchor_block = block_number where an anchor exists there" is prohibited.
//
// A DANGLING BINDING IS UNPROVABLE TOO. The binding names a block; the anchor row
// carrying that block's hash is the provenance. If retention or a rewind removed the
// anchor, the name survives and the fact does not, so both halves are required —
// exactly as NeutralizeUnverifiablePrices' classifier requires them.
//
// IT IS INDEXED, BUT NOT BY THE INDEX WAVE 12 NAMED (Codex round 10, residual (a)).
// The inner lookup reads price_poll_anchors by (engine, chain_id, block_number), so
// what serves it is an index on THAT table: measured on a live database it is 00005's
// price_poll_anchors_scan_idx (chain_id, engine, block_number DESC) as an Index Only
// Scan inside a Nested Loop Anti Join, with the table's primary key (engine,
// block_number) as the alternative. 00007's prices_anchor_binding_idx is on `prices`
// keyed by anchor_block and plays no part here — it serves the reads that go the other
// way (the prune's and RewindPrices' "is any marked row bound to this anchor?"). Either
// way the anti-join's inner side is a correlated index lookup rather than a scan.
const unprovableRow = `NOT EXISTS (
		     SELECT 1 FROM price_poll_anchors a
		     WHERE a.engine = $2 AND a.chain_id = $1 AND a.block_number = p.anchor_block)`

// CountUnanchoredPricesAbove counts the rows engine owns strictly above
// aboveBlock whose OWN provenance binding names no surviving poll anchor.
//
// This is the load-bearing read for A1's invariant. A rewind is only allowed to
// delete above a floor when every row above that floor has been PROVEN
// non-canonical, and the only proof this system has is an anchor whose recorded
// hash no longer matches the live chain. A row whose round never recorded an anchor
// has no such proof and can never acquire one — the hash of the block it executed
// at was never written down and cannot be recovered — so its presence above the
// deletion boundary is what forbids deletion outright.
//
// "No anchor of its own" is decided by unprovableRow, which reads the row's binding
// rather than its height. An anchor that happens to sit at the same height was
// written by a different round and vouches for nothing here.
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
		   AND `+unprovableRow,
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
	// Unanchored counts those of Owned whose OWN provenance binding names no
	// surviving anchor (unprovableRow) — NOT those at unanchored heights. A
	// legacy NULL-bound row is counted here even when a later round's anchor
	// sits at its exact height, because that anchor vouches for a different
	// round. This is the field repair reads to decide whether anything above the
	// boundary can never be judged, so it is the one that must not be able to
	// inherit somebody else's proof.
	Unanchored int64
	// AnchoredHeights IS DELETED, and the deletion is the point (Codex round 10,
	// residual (c)). It counted ANCHORS above EffectiveTarget — an honest number
	// about the anchor population — but it had no production consumer at all: only
	// the fake and two test assertions read it. What it offered a future reader was
	// a per-HEIGHT anchor count sitting one field away from the per-OBSERVATION
	// binding count, which is the exact confusion round 9's [high] #1 was, and
	// nothing was using it to justify keeping the trap. Unanchored is the field the
	// repair path reads, and now the only one it can.
	//
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

// PriceRepairExposure reads all four facts in ONE transaction, so the target, the
// counts and the reorg generation describe the same instant. Under the enforced
// single-writer contract (D-004) nothing else is writing, but reading them
// together also means a caller cannot accidentally pair a stale target — or a
// stale generation — with fresh counts.
//
// EVERY COUNT EXCLUDES ROWS ALREADY MARKED InvalidReasonUnverifiableReorg (ADD-2,
// .superpowers/sdd/task-8-normative-addenda.md). D-012 clause 3 makes a marking
// permanent, so if marked rows still counted toward a repair's proof obligation,
// every epoch after the first would demand proof about rows that can never be
// proven — permanence would veto all future repair. Excluding them is what lets
// clause 3's permanence and continued operation coexist.
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
		   AND `+unprovableRow,
		chainID, engine, exp.EffectiveTarget, InvalidReasonUnverifiableReorg).Scan(&exp.Unanchored); err != nil {
		return exp, fmt.Errorf("count unanchored prices owned by %q above %d: %w", engine, exp.EffectiveTarget, err)
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
// target whose own provenance binding names no surviving anchor (unprovableRow) —
// legacy history written before this engine bound its observations, or history whose
// anchors retention removed. Those rows cannot be proven canonical (no recorded hash
// to re-check) and cannot be proven orphaned (same reason), and no future fact
// changes that: the hash of the block their round executed at was never written down,
// or no longer exists. Legacy anchor adoption used to be offered as the escape and it
// never was one — it was refused for exactly as long as an epoch stood — and it is now
// deleted outright, because an adopted anchor cannot give a row the binding this read
// requires without performing the backfill migration 00007 prohibits.
//
// The three candidate answers, and why this is the one:
//
//   - DELETE them (the original behaviour): destroys history that was probably
//     canonical, irreversibly, on no evidence. This is finding A1.
//   - REFUSE forever (the behaviour before wave 4): the epoch gate then blocks
//     every apply, the poller stops ingesting prices, and nothing any code path
//     can do clears it — repair needs an anchor, the anchor could only come from
//     adoption, adoption needed the ack, and the ack needed repair. A refusal no
//     path can clear is an outage, not safety. (That cycle is why deleting adoption
//     is safe today and would not have been then: THIS call is the exit, and it
//     needs nothing from adoption.)
//   - NEUTRALIZE (this): the rows are RETAINED and marked
//     InvalidReasonUnverifiableReorg, so no usable-price read can return them; their
//     ANCHORS ARE RETAINED TOO (D-012 clause 2); the cursor is reset and every epoch
//     is acked, in ONE transaction. Nothing is destroyed, nothing unverifiable can
//     be read, and ingestion resumes.
//
// WHY IT IS NOW THE WHOLE ANSWER AND NOT THE LAST RESORT. Wave 4 reached here only
// when the evidence was UNOBTAINABLE, and deleted when it was merely strong. Five
// review rounds each found a new way for "strong" to be wrong — an incomplete case
// space, an expired proof, a proof assembled from several endpoints' forks — and
// each fix existed solely to justify destroying rows that cannot be re-read from
// anywhere. D-010 removes the destructive arm instead.
//
// WHAT THE MARKING IS, SINCE D-012: A PERMANENT CLASSIFICATION IN THE RUNNING
// SYSTEM, and this doc says so rather than promising a repair. Polled prices are
// 60-second SAMPLES, not a ledger. A wrongly-marked row is observationally identical
// to a missed poll — an outcome the system already produces daily and has never had
// a makeup mechanism for — and every consumer skips both. So the acceptable cost of
// a wrong marking is a sample gap, and it is accepted rather than repaired online.
// D-011's revalidation pass, which existed to repair it, is removed (clause 3):
// it hosted both of Codex round 7's criticals.
//
// WHAT IT DOES NOT CLAIM. It does not prove the rows are non-canonical. Marking a
// canonical row costs the availability of that asset's price at those heights,
// permanently, which is why the caller still has to reach a conclusion on complete
// evidence — and, where more than one endpoint is configured, on CORROBORATED
// evidence (D-012 clause 4, internal/prices.Poller.verifyFloor /
// checkpointCorroborated).
//
// EXACTLY ONE THING CLEARS THE MARKER IN THE RUNNING SYSTEM, and it is new evidence
// rather than a new reading of the old: a FRESH OBSERVATION at the same
// (chain, asset, source, block) identity, which insertPrice treats as superseding
// the marked row. Because the poller reads `latest` only, that can happen only while
// the head still sits at a marked height — a shallow-reorg shape — and never for a
// height the head has passed.
//
// PROVENANCE OUTLIVES THE CLASSIFICATION ANYWAY (D-012 clause 2). The row, its
// value, and the anchor recording the hash of the block its round executed against
// are all retained forever, on every store path. Nothing online reads them for
// recovery; they are kept so an OFFLINE reconciliation could, at zero ongoing cost.
// No such tool exists today, and nothing here should be read as promising one.
//
// verifiedFloor is honoured exactly as RewindPrices honours it: history at or below
// an INDEPENDENTLY hash-verified block is provably canonical, so it keeps its
// validity and only the rows above that boundary are marked. Passing 0 means no
// anchor verified and the whole suffix above the walker's target is unprovable.
//
// Returns the boundary it acted above and how many rows it marked. The WARN splits
// that count three ways, because the three have different meanings for an operator:
// rows a SURVIVING anchor vouches for (the hash is on disk; an offline check could
// still settle them), rows whose binding DANGLES (a hash was recorded and has since
// been pruned or swept — gone from here, possibly not gone from a backup), and rows
// that were NEVER BOUND (no hash is known for their round at all). The latter two are
// both "unanchored" — no surviving anchor is linked to the observation — and only the
// first may be described as having its recorded hash retained.
//
// THE BOUNDARY IT RETURNS IS AUTHORITATIVE AND verifiedFloor IS NOT. The floor is what
// the caller asks for; the clamp below may lower it, and callers' operator-facing text
// must be composed from the return value (Codex round 10's [medium] #1, see
// internal/prices.floorDisposition).
func (s *Store) NeutralizeUnverifiablePrices(ctx context.Context, engine string, chainID, toBlock, verifiedFloor uint64) (boundary uint64, quarantined int64, err error) {
	if engine == "" {
		return 0, 0, fmt.Errorf("price neutralization: engine is required (it is the ownership scope)")
	}
	// D-012 CLAUSE 2, ENFORCED BEFORE ANYTHING ELSE — the structural half, in the same
	// style as RewindPrices' poll-owned refusal and for the complementary reason. A
	// non-poll engine that reached this call could be marked here and then rewound
	// through RewindPrices, whose anchor sweep carries no neutralized-height exemption,
	// leaving retained marked rows with no provenance at all. See
	// ErrNonPollNeutralizeRefused for the full argument. It is a property of the
	// IDENTITY, so no combination of target, floor or chain can reach the state.
	if !IsPollOwnedEngine(engine) {
		return 0, 0, fmt.Errorf("%w: engine %q is outside the %q namespace. Answer the epoch with RewindPrices, which deletes rows raw_logs can replay",
			ErrNonPollNeutralizeRefused, engine, PollOwnedEnginePrefix)
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
	// THE FLOOR MAY NOT RISE ABOVE UNPROVABLE HISTORY (Codex round 9's [high] #1).
	//
	// A verified floor at H says "the block at H is canonical on the endpoint that
	// answered, so the chain at and below H is unchanged". That is a statement about the
	// CHAIN. Turning it into "every row at or below H keeps its validity" additionally
	// assumes each of those rows describes the chain — which is only known for a row
	// whose own round recorded the block it read. For a NULL-bound row it is exactly the
	// inference migration 00007 forbids: an anchor written by a LATER, possibly empty,
	// round at the same height would bless an observation it never covered, and an
	// orphan-fork price would stay usable.
	//
	// So the floor is admitted only as far up as the LOWEST unprovable row inside the
	// repair range (walkerTarget, verifiedFloor]. Rows above the clamp are marked; rows
	// at or below it were never at risk from this epoch in the first place, because the
	// walker's target is what says how deep the reorg reached.
	//
	// WHY CLAMPING RATHER THAN MARKING JUST THE UNPROVABLE ONES. The precise version
	// would mark unprovable rows individually and spare provable rows above them, which
	// costs less availability — and it would make the boundary this call RETURNS stop
	// describing what it marked, so the ADD-1 disclosure range and the cursor would each
	// need their own answer. One honest boundary is worth more than the rows saved,
	// because the population it can over-mark is D-012 clause 5's legacy rows, recorded
	// as ZERO in production, and because pollAnchorRetention is 4096 rounds — orders of
	// magnitude deeper than any reorg — so a row inside a repair range whose anchor has
	// been pruned is not a state the running system reaches.
	if verifiedFloor > effectiveTarget {
		walkerTarget := effectiveTarget
		var lowestUnprovable *uint64
		if err := tx.QueryRow(ctx,
			`SELECT MIN(p.block_number) FROM prices p
			 WHERE p.chain_id = $1 AND p.owner_engine = $2
			   AND p.block_number > $3 AND p.block_number <= $5
			   AND p.invalid_reason <> $4
			   AND `+unprovableRow,
			chainID, engine, walkerTarget, InvalidReasonUnverifiableReorg, verifiedFloor).Scan(&lowestUnprovable); err != nil {
			return 0, 0, fmt.Errorf("read lowest unprovable row for %q in (%d, %d]: %w",
				engine, walkerTarget, verifiedFloor, err)
		}
		admitted := verifiedFloor
		if lowestUnprovable != nil {
			admitted = *lowestUnprovable - 1
		}
		switch {
		case admitted > walkerTarget:
			effectiveTarget = admitted
			if lowestUnprovable != nil {
				slog.Warn("price neutralization boundary raised to a hash-verified poll anchor, but CLAMPED below unprovable history: rows at or below the verified block are provably on the canonical CHAIN, and that says nothing about a row whose own round never recorded which block it read. The floor is admitted only up to just under the lowest such row",
					"engine", engine, "chain", chainID, "callerTarget", toBlock,
					"walkerLoweredTarget", walkerTarget, "verifiedFloor", verifiedFloor,
					"lowestUnprovableRow", *lowestUnprovable, "admittedBoundary", admitted)
			} else {
				slog.Warn("price neutralization boundary RAISED to a hash-verified poll anchor: rows at or below an independently verified block are provably canonical, and every one of them carries its own anchor binding, so the floor is admitted in full",
					"engine", engine, "chain", chainID, "callerTarget", toBlock,
					"walkerLoweredTarget", walkerTarget, "verifiedFloor", verifiedFloor)
			}
		default:
			slog.Warn("price neutralization VERIFIED FLOOR REFUSED ENTIRELY: unprovable history sits at the very bottom of the repair range, so no part of the floor may be admitted. The whole suffix above the walker's target is marked, which is what a floor over rows nothing can place is worth",
				"engine", engine, "chain", chainID, "callerTarget", toBlock,
				"walkerLoweredTarget", walkerTarget, "verifiedFloor", verifiedFloor,
				"lowestUnprovableRow", *lowestUnprovable)
		}
	}

	// ONLY ROWS THAT ARE STILL READABLE ARE MARKED. The predicate is `valid`, not
	// "does not already carry this marker", and the difference is not cosmetic: a
	// row quarantined for a DIFFERENT reason (a non-positive oracle answer) is
	// already unreadable, so re-marking it changes nothing a consumer can observe
	// and overwrites the true reason it is unusable. It would also inflate the
	// backlog NeutralizedPriceStats reports with rows that were never reorg fallout,
	// which is the number D-010 clause 4 exists to make trustworthy. The RETURNING
	// set is then exactly "rows this call made unreadable".
	//
	// THE SPLIT IS TAKEN FROM THE UPDATE ITSELF (D-012 clause 7). The marked set is
	// classified inside the same statement, so the two counts describe exactly the rows
	// this call changed — not "every marked row above the boundary", which would fold in
	// earlier calls' work. Round 7's [low] was that the old WARN asserted the unanchored
	// story for a call that is also used on anchored suffixes; the two now travel
	// separately because an operator's next step differs between them.
	//
	// AND IT ASKS THE ROW'S OWN BINDING, NOT ITS HEIGHT (D-012 clause 2, Codex round 8's
	// [high] #2). Wave 8 classified a row as anchored when ANY anchor existed at
	// p.block_number. That made the count a claim about the height rather than about the
	// observation, and the two diverge exactly where it matters: a legacy row at H with
	// no anchor of its own, marked, then joined at H by a later round's anchor, would be
	// reported as "the hash of the block that round executed against is on disk" when no
	// such hash was ever recorded for it. The WARN's own gloss on rowsAnchored is a
	// provenance claim, and this is what makes it true. The row must ALSO still have its
	// anchor — the binding names a block, and clause 2's retention is what keeps the
	// anchor row there — so both halves are required and a dangling binding counts as
	// unanchored.
	//
	// AND THE UNANCHORED SIDE IS SPLIT IN TWO, BECAUSE ONE SENTENCE CANNOT DESCRIBE BOTH
	// POPULATIONS TRUTHFULLY (Codex round 10's [medium] #2). "Unanchored" means NO
	// SURVIVING ANCHOR IS LINKED TO THE OBSERVATION, and there are exactly two ways to
	// get there:
	//
	//   - NEVER BOUND (anchor_block IS NULL): pre-00007 history, or a writer that records
	//     no anchors at all (ApplyPrices — the Chainlink feed path). No hash is KNOWN for
	//     these rounds — and "known" rather than "written", because a pre-00007 round may
	//     well have anchored without anything recording that the anchor covers THIS
	//     observation, which is precisely the inference migration 00007 forbids.
	//   - BINDING DANGLES (anchor_block names a block with no anchor row): the round DID
	//     record a hash and retention has since expired it, or a rewind swept it. Saying
	//     "no hash was ever recorded for these" is false, and it matters: it points an
	//     operator away from backups, WAL archives or a re-poll window that might still
	//     hold the fact. TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart
	//     constructs exactly this row.
	//
	// The split is free — it is the same CTE, one extra IS NULL test — so the WARN
	// reports both counts and claims recorded-hash retention for NEITHER of them.
	//
	// PRE-00007 ROWS ALL LAND IN never-bound, because their binding is NULL and NULL
	// means unprovable (see migration 00007) even where their round did anchor. That
	// understates the anchored side for history written before that migration, and
	// understating provenance is the only direction that cannot invent it — which is
	// also why never-bound's gloss says no hash is KNOWN for them rather than that none
	// was ever written.
	var anchoredMarked, danglingMarked, unboundMarked int64
	if err := tx.QueryRow(ctx, `WITH marked AS (
			UPDATE prices
			   SET valid = FALSE, invalid_reason = $4
			 WHERE chain_id = $1 AND owner_engine = $2 AND block_number > $3 AND valid
			RETURNING anchor_block
		), classified AS (
			SELECT marked.anchor_block IS NULL AS unbound,
			       EXISTS (
				SELECT 1 FROM price_poll_anchors a
				 WHERE a.engine = $2 AND a.chain_id = $1 AND a.block_number = marked.anchor_block
			) AS vouched
			FROM marked
		)
		SELECT count(*) FILTER (WHERE vouched),
		       count(*) FILTER (WHERE NOT vouched AND NOT unbound),
		       count(*) FILTER (WHERE unbound)
		FROM classified`,
		chainID, engine, effectiveTarget, InvalidReasonUnverifiableReorg).Scan(&anchoredMarked, &danglingMarked, &unboundMarked); err != nil {
		return 0, 0, fmt.Errorf("neutralize prices owned by %q above %d: %w", engine, effectiveTarget, err)
	}
	unanchoredMarked := danglingMarked + unboundMarked
	quarantined = anchoredMarked + unanchoredMarked

	// THE ANCHORS ABOVE THE BOUNDARY ARE KEPT (D-012 clause 2). This call used to
	// DELETE them, reasoning that an anchor outliving its round's usability would
	// let a later repair "verify" a height this call declared unplaceable. That
	// reasoning inverted the anchor's role. The anchor is not a blessing, it is the
	// PROVENANCE — the hash of the block the round actually executed against — and
	// it is the only thing from which "was that block canonical after all?" can ever
	// be answered. Nothing ONLINE asks that question any more (clause 3 removed the
	// pass that did); the anchors are retained so an OFFLINE reconciliation can, at
	// any future time, at zero ongoing cost. Deleting them would foreclose that
	// permanently, which is what clause 2 forbids on every store path.
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
	slog.Warn("NEUTRALIZED polled prices instead of deleting them: a reorg epoch left rows above the repair boundary that this pass could not place on the chain. They are RETAINED and marked invalid, so no usable-price read can return them, and the epoch is acknowledged so price ingestion resumes. THIS CLASSIFICATION IS PERMANENT in the running system (D-012 clause 3): the only thing that clears it is a CURRENT poll landing at the same height, which can happen only while the head is still there. Polled prices are 60-second samples, so a wrongly-marked row is a sample gap of the same kind an RPC outage produces. THE ROWS AND THEIR VALUES ARE RETAINED FOREVER; the recorded BLOCK HASH is retained only where one still exists — clause 2 stops any prune or rewind from expiring the anchor a marked row is bound to FROM NOW ON, but it cannot bring back a hash that was already gone when the marking ran. So an offline reconciliation is possible for the rowsAnchored population and for no other; no such tool is built",
		"engine", engine, "chain", chainID, "requestedTarget", toBlock,
		"verifiedFloor", verifiedFloor, "boundary", effectiveTarget,
		"rowsNeutralized", quarantined,
		"rowsAnchored", anchoredMarked,
		"rowsUnanchored", unanchoredMarked,
		"rowsUnanchoredBindingPruned", danglingMarked,
		"rowsUnanchoredNeverBound", unboundMarked,
		"anchoredMeans", "a SURVIVING anchor is linked to the observation, so the hash of the block its round executed against is on disk and an offline check could still settle these; clause 2 now protects that anchor from prune and rewind",
		"unanchoredMeans", "no SURVIVING anchor is linked to the observation, so nothing on disk can settle these. rowsUnanchoredNeverBound: the binding is NULL, so no hash is KNOWN for the round (pre-00007 history, or a writer that records no anchors). rowsUnanchoredBindingPruned: the binding NAMES a block whose anchor row is gone — retention expired it or a rewind swept it — so a hash WAS recorded and is no longer here, which is the only one of the two a backup or archive could still answer",
		"ackedEpoch", maxEpoch, "marker", InvalidReasonUnverifiableReorg)
	return effectiveTarget, quarantined, nil
}

// NeutralizedPriceStats is the size and age of one engine's retained-but-unusable
// backlog: rows NeutralizeUnverifiablePrices marked rather than deleted.
//
// It exists because the policy that keeps those rows has an accepted cost and the
// cost has to be countable (D-010 clause 4, carried forward by D-012 clause 6). An
// operator who cannot see the pile cannot tell a handful of rows from a runaway.
//
// D-012 clause 6 is why the number must survive a recovery of the ACUTE signal: a
// newer poll clears ConditionPollInvalidAnswer for the assets it prices, and that
// says nothing whatever about the heights below it that are still unreadable. This
// count is scoped to the marker, not to the head, so it keeps reporting the
// historical classification after the current path is healthy again.
//
// AND WHY THE SAME CLAUSE BOUNDS ITS COST, TWICE OVER. Before migration 00007 this
// aggregate had no index carrying the invalid_reason predicate, so it scanned the
// engine's whole price history — a table that only ever grows, since polled rows are
// never deleted. 00007's partial covering index fixes the PER-CALL cost (round 8's
// [high] #5). The CALL FREQUENCY is the separate half: wave 7 ran it after every
// landed round while a backlog existed, which made the cost proportional to total
// history AND to uptime (round 7's [medium]). Both bounds are required, and it is
// called only on the transitions that can actually move it: neutralization, a round that
// SUPERSEDED a marked row (store.ApplyResult.Superseded), and hydration. Those are
// events, not a cadence, which is what keeps the cost off the poll interval. See
// internal/prices.Poller.refreshNeutralizedBacklog for the caller-side rule.
//
// Oldest/Newest are zero when Rows is 0.
type NeutralizedPriceStats struct {
	Rows         int64
	Oldest       time.Time
	Newest       time.Time
	HighestBlock uint64
}

// neutralizedBacklogQuery is NeutralizedPriceStats' aggregate, with the marker
// INLINED AS A LITERAL rather than bound as $3.
//
// THAT IS NOT A STYLE CHOICE, IT IS WHAT MAKES THE PARTIAL INDEX USABLE. PostgreSQL
// will only choose a partial index when it can PROVE the query's predicate implies the
// index's, and it cannot prove that of a bound parameter under a generic plan — the
// plan the extended protocol settles on after a few executions. A parameterised
// `invalid_reason = $3` therefore reverts to the full scan migration 00007's
// prices_neutralized_backlog_idx exists to eliminate, silently, some executions in.
//
// It is a COMPILE-TIME CONSTANT CONCATENATION, so there is no runtime string building
// and no value from outside this package can reach the SQL text: the marker is a
// package constant with no quote characters, and the compiler pastes it. The migration
// writes the same literal into the index predicate, and the two texts agreeing is
// pinned by TestNeutralizedBacklogAggregateUsesItsCoveringIndex, which reads a live
// EXPLAIN — a stronger guard than comparing the strings, because it fails if the plan
// stops using the index for ANY reason, drift included.
const neutralizedBacklogQuery = `SELECT count(*), min(observed_at), max(observed_at), max(block_number)
	   FROM prices
	  WHERE chain_id = $1 AND owner_engine = $2
	    AND invalid_reason = '` + InvalidReasonUnverifiableReorg + `'`

// NeutralizedPriceStats counts the rows engine owns on chainID that carry the
// InvalidReasonUnverifiableReorg marker, with the observation times of the oldest
// and newest and the highest block among them.
//
// It is a plain read: it decides nothing and gates nothing. The marker is exact —
// exactly ONE path clears it in the running system, insertPrice's supersede arm, and
// it writes the row — so this counts marked rows rather than estimating them.
//
// ITS COST IS BOUNDED BY THE BACKLOG, NOT BY HISTORY (D-012 clause 6, Codex round 8's
// [high] #5). Migration 00007 adds prices_neutralized_backlog_idx, partial on the
// marker and covering (chain_id, owner_engine, observed_at, block_number), so this is
// an index-only scan over exactly the marked rows. Without it the aggregate scanned
// the engine's entire price history — a table that only ever grows, because polled
// rows are never deleted — which is the cost the clause forbids.
func (s *Store) NeutralizedPriceStats(ctx context.Context, engine string, chainID uint64) (NeutralizedPriceStats, error) {
	var out NeutralizedPriceStats
	var oldest, newest *time.Time
	var highest *int64
	if err := s.pool.QueryRow(ctx, neutralizedBacklogQuery,
		chainID, engine).Scan(&out.Rows, &oldest, &newest, &highest); err != nil {
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

// LEGACY ANCHOR ADOPTION IS DELETED (Codex round 9's [high] #2). UnanchoredPriceBlocks
// and AdoptPollAnchor lived here. What they did: find heights where this engine owns
// rows but recorded no anchor, read the live chain's CURRENT hash there, and write it
// as an anchor so reorg repair could "verify" that history instead of refusing to
// touch it.
//
// WHY IT IS GONE RATHER THAN GUARDED. Round 9 found it recreating fabricated
// provenance at cadence: UnanchoredPriceBlocks selected post-00007 rows whose GENUINE
// anchor had been retention-pruned, a restart cleared the poller's one-time latch, and
// adoption then wrote a replacement block's hash at that height with no surviving
// anchor to diverge against — after which the next successful poll pruned the adopted
// anchor again and the cycle repeated. Guards for that were available and were not
// taken, because the same round's [high] #1 removed adoption's entire purpose:
//
//   - Under unprovableRow, a row is provable only through its OWN anchor_block
//     binding. Adoption writes a row into price_poll_anchors; it does not and MUST NOT
//     set prices.anchor_block, because "anchor_block = block_number where an anchor
//     exists at that height" is precisely the backfill migration 00007 prohibits.
//   - So after adoption the legacy rows are STILL unprovable to every consumer. The
//     stated benefit — "reorg repair can verify that history" — is unreachable by
//     construction, and no combination of guards restores it.
//   - What survived was pure hazard. An adopted anchor is still a probe candidate for
//     PollAnchorsBelow, where a match against a hash copied from the same chain is a
//     proof of nothing that can nonetheless RAISE a verified floor; and it is still a
//     candidate for NewestPollAnchor, where its fresh observed_at would tell a
//     restarted poller it had just seen the chain move.
//
// THE POPULATION QUESTION, ANSWERED. D-012 clause 5 records legacy unanchored rows as
// ZERO in production — they exist only in databases that ran pre-00005 code, and Task 9
// backfills from scratch. Adoption was never the exit from the pending-epoch deadlock
// either: it refused for exactly as long as an epoch stood, so the terminating
// transition was always NeutralizeUnverifiablePrices, which needs nothing from here.
// The controller could name no remaining population, so the path is deleted rather than
// repaired.

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

// RewindPrices discards the price rows an EVENT-DERIVED price engine OWNS above the
// effective rewind target and resets its cursor, acknowledging every reorg epoch on
// its chain — the log-derived price writer's counterpart to RewindDerived, in ONE
// transaction.
//
// IT REFUSES A POLL-OWNED ENGINE OUTRIGHT (D-012 clause 1, closing Codex round 7's
// [medium]). Deletion is only defensible where the rows can be rebuilt: the feed
// deriver's come out of raw_logs, so a rewind costs it a replay, while a polled row
// is a `latest` contract read at a block the head has passed and exists nowhere
// else. D-010 expressed that by leaving this method off the poller's PollStore
// interface, which bounded the POLLER and nothing else — *Store still carried it,
// and any other holder could call it. Worse than the row deletion, this call also
// deletes every anchor above the target WITHOUT the neutralized-height exemption
// pruneOldPollAnchors has, so one such call would leave exactly the
// marked-without-provenance state D-012 clause 2 forbids. The refusal is on the
// ENGINE IDENTITY (PollOwnedEnginePrefix), so it holds for every argument
// combination and every caller.
//
// For the engines it does serve:
//
//   - The base target is min(toBlock, deepest unacknowledged rewound_to),
//     computed by the shared rewindTarget helper: because this call ACKS every
//     epoch on the chain, its deletion must reach the DEEPEST block any unacked
//     epoch rewound to. A lowered target is WARNed with both numbers.
//
//   - verifiedFloor RAISES that target back up when the caller has
//     INDEPENDENTLY HASH-VERIFIED a block as still canonical. A caller that
//     re-checked a block's hash against the live chain at height H has proof that
//     H and every ancestor are unchanged, so rows at or below H still describe the
//     chain that exists and are retained. verifiedFloor above toBlock is a caller
//     bug and is refused, because it would bless rows outside the cursor's
//     coverage.
//
//     DISCLOSED: this parameter was introduced for the poller's anchor path, and
//     with poll engines now refused outright it has NO production caller — the feed
//     deriver passes 0 (internal/prices/feed.go). It is kept because the arithmetic
//     is still correct for any hash-verifying caller and removing a public
//     parameter is a bigger change than D-012 asks for; it is not kept because
//     anything currently exercises it in production. The tests that pin it now do
//     so under a NON-poll identity, for the same reason.
//
//   - Ownership is the row's own owner_engine, NOT a caller-supplied source
//     list. A chain-wide "delete above target" would destroy other writers'
//     rows (the ETH poller's ratio rows and the ETH feed deriver's stream rows
//     share chain 1), and scoping by the currently-loaded registry's sources
//     silently missed rows whose mechanism the registry no longer names — the
//     Chainlink phase-change orphan. An engine that owns no row deletes nothing
//     while still acking.
//
//   - The engine's poll anchors above the effective target are deleted with the
//     rows they describe: an anchor for a round whose rows are gone would
//     otherwise let a later repair "verify" history that no longer exists. This
//     sweep now carries the SAME neutralized-height exemption pruneOldPollAnchors
//     has, because D-012 clause 2 forbids expiring such an anchor on ANY store path
//     and this is one. Wave 8 omitted it, reasoning that the poll-owned refusal above
//     made it unreachable; that was true of the refusal as written and did not make
//     the invariant a property of this statement. Both are now in place.
//
//   - The epoch ack and the deletions are ATOMIC: a crash can never leave the
//     ack recorded while orphaned price rows survive, which is precisely the
//     hole a separate follow-up delete would open.
//
// This is also the BOOTSTRAP entry point for an EVENT-DERIVED price writer on a
// chain that already carries epochs: ApplyPrices refuses a no-cursor engine there
// until this call has created its cursor and acked. A poll-owned engine bootstraps
// through NeutralizeUnverifiablePrices instead, which handles the no-cursor case
// for exactly this reason (and marks nothing, since it owns nothing above block 0).
// A cursor row bound to a
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
	// D-012 CLAUSE 1, ENFORCED BEFORE ANYTHING ELSE — including before the chain
	// binding, because a poll-owned engine must not be able to learn anything from
	// this call, let alone change anything. A poll-owned engine's answer to a reorg
	// epoch is NeutralizeUnverifiablePrices; there is no target, floor or chain for
	// which deleting its rows is correct, so this is a property of the identity and
	// not of the arguments.
	if IsPollOwnedEngine(engine) {
		return fmt.Errorf("%w: engine %q owns rows read from `latest` at a block that has passed, and this call would additionally delete the poll anchors D-012 clause 2 retains as their permanent provenance. Answer the epoch with NeutralizeUnverifiablePrices instead",
			ErrPollOwnedRewindRefused, engine)
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
	// THE ANCHOR SWEEP CARRIES THE NEUTRALIZED-HEIGHT EXEMPTION TOO (D-012 clause 2,
	// Codex round 8's [high] #3). Clause 2 says no retention bound, prune OR REWIND may
	// expire the anchor of a neutralized height, ON ANY STORE PATH — and this is a
	// store path. Wave 8 left the sweep unconditional and justified it by the
	// poll-owned refusal at the top of this function: no engine reaching here can hold
	// a neutralized row, so the exemption would be dead code.
	//
	// THAT ARGUMENT WAS TRUE AND STILL INSUFFICIENT. It made a clause-2 invariant hold
	// by coincidence of a guard three hundred lines away rather than by anything in the
	// statement that does the deleting; round 8 found the second door standing open
	// (NeutralizeUnverifiablePrices accepted any engine), and the DELETED
	// defence-in-depth test is what would have caught it. Both doors are now shut —
	// that refusal, and this predicate — and the predicate is the one that survives a
	// future edit to either identity rule.
	//
	// It is genuinely unreachable through the public API today, and its live-Postgres
	// regression says so explicitly while constructing the state directly: a test that
	// can only reach a defence by going around the front door should say that is what
	// it is doing, not pretend the state is ordinary.
	//
	// AND IT EXEMPTS THE ANCHOR THE ROW IS BOUND TO, NOT ONLY THE ONE AT ITS HEIGHT
	// (Codex round 9's [medium] #3). ApplyPolledPrices legally accepts observations
	// BELOW throughBlock, so a marked row's provenance may be an anchor at a different
	// height entirely. With only the height clause this statement retained the row and
	// deleted its actual anchor, leaving anchor_block dangling — provenance destroyed by
	// the very statement clause 2 names. The two clauses are the same pair, in the same
	// split form and for the same plan reason, as prunePollAnchorsQuery: the binding one
	// is EXACT (an anchor is provenance for whatever points at it) and the height one is
	// CONSERVATIVE (it protects pre-00007 marked rows, whose binding is NULL and whose
	// height anchor may well be their genuine provenance).
	//
	// The point of putting it here is that clause 2 must be a property of the DELETING
	// STATEMENT, independent of the identity guards. Round 8 closed the gap between the
	// two doors; round 9 found that the predicate behind them was still asking the wrong
	// question, which is exactly what "defence in depth" is supposed to survive.
	if _, err := tx.Exec(ctx,
		`DELETE FROM price_poll_anchors a
		 WHERE a.engine = $1 AND a.block_number > $2
		   AND NOT EXISTS (
		     SELECT 1 FROM prices p
		     WHERE p.owner_engine = a.engine AND p.chain_id = a.chain_id
		       AND p.block_number = a.block_number AND p.invalid_reason = $3)
		   AND NOT EXISTS (
		     SELECT 1 FROM prices p
		     WHERE p.owner_engine = a.engine AND p.chain_id = a.chain_id
		       AND p.anchor_block = a.block_number AND p.invalid_reason = $3)`,
		engine, effectiveTarget, InvalidReasonUnverifiableReorg); err != nil {
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
