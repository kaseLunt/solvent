package derive

// The derivation runner: the orchestration layer every LIFECYCLE CONTRACT
// comment in this package refers to as "the runner" (engine.go's terminology
// note). One Runner per engine drives the loop
//
//	raw_logs window → Decode → Engine.Process → store.ApplyDerivedWithRates
//
// under the Engine batch lifecycle, and owns the obligations the engines
// document but cannot enforce themselves:
//
//   - SERIAL (block, logIndex) order: each batch is a whole-block window read
//     through store.RawLogsInRange, which orders by (block_number, log_index)
//     across the engine's full address set (the Aave engine's Pool + four
//     aTokens merge into ONE ordered feed). Windows are block-aligned, so a
//     transaction's log run is never split across batches — the same-tx /
//     same-block joins both engines rely on always see their whole run.
//   - COMMIT-INDETERMINACY RULE: ANY ApplyDerivedWithRates error →
//     Engine.Reset(), never DiscardBatch (see engine.go). DiscardBatch is
//     used only for failures that provably never reached the store (a decode
//     or Process error mid-batch).
//   - RESUME FROM THE CURSOR, never from an assumed target: after any rewind
//     or ambiguous commit, the next window's start comes from a fresh
//     DeriveCursor read — RewindDerived may have rewound DEEPER than the
//     caller's target (deepest-unacked-epoch lowering), and an ambiguous
//     commit may have advanced the cursor despite the error.
//   - REORG COORDINATION: before ANYTHING else — including the unhealthy
//     gate — the runner checks store.HasUnackedReorg (a walker rewind
//     records a durable reorg epoch) and answers it with RewindDerived →
//     Reset → cursor re-read BEFORE any further apply; the store's
//     ErrUnackedReorgEpoch refusal is handled identically as the reactive
//     backstop. RewindDerived deletes the engine's rate observations above
//     the effective target, invalidates reorg-orphaned snapshot rows, and
//     BUMPS the snapshotter's durable sweep generation — all INSIDE its own
//     transaction, atomic with the ack (a crash cannot separate them).
//     Every completed rewind fires the onRewind hook (the snapshotter's
//     re-sweep trigger); that hook is only the LIVE fast path — the durable
//     backstop is the generation bump itself, which a restarted snapshotter
//     finds OPEN and resumes on its first Step, so nothing is lost.
//   - TERMINAL CAPABILITY ERRORS: ErrUnsupportedBorrowToken marks the engine
//     UNHEALTHY — no retry can succeed until the deriver grows oracle-priced
//     derivation — and gates DERIVATION ONLY: reorg repair (ack + rewind)
//     still runs on every Step, because a durable epoch must be answered
//     whether or not the engine can derive. Recovery is deliberately a
//     RESTART after a capability upgrade: all state is durable, the
//     restarted process re-derives the refusing window with the upgraded
//     deriver, and no in-process healthy transition exists. Health() exposes
//     the state for the daemon's health surface.
//   - RATE OBSERVATIONS are persisted ATOMICALLY with their window via
//     store.ApplyDerivedWithRates (one transaction): a window lands with
//     every rate value its events carried, or not at all — no crash window
//     between rate persistence and the batch commit exists anymore.
//   - SNAPSHOTS (best-effort history): after a committed batch, the batch's
//     DEBT-side-touched accounts join an in-memory BOUNDED FIFO
//     (insertion-ordered; re-touches dedupe onto their ORIGINAL position),
//     and each Step flushes up to snapshotBatchCap of the OLDEST entries as
//     ONE bulk side-scoped store.SaveSnapshots write (documents carry
//     "side":"debt" — only the event-derived debt side is truly as-of the
//     through-block; collateral is observed by the snapshotter at its own
//     multicall block, and cross-side composition is a READ-TIME concern).
//     The remainder carries over to following Steps (including caught-up
//     Steps, which flush against the cursor block). The FIFO is hard-capped
//     at pendingCap: under sustained overload the NEWEST touches are dropped
//     with a WARN — the documented overload posture, chosen over unbounded
//     memory because these rows are history convenience, never truth.
//     Semantics are BEST-EFFORT by design: position_balances is the
//     authoritative truth and never depends on these rows; a failed flush
//     keeps the accounts pending and retries; a process crash drops only the
//     pending FIFO's unwritten history rows.

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// Rate-observation kinds persisted by the runner, from the store's
// documented vocabulary (rate_indexes).
const (
	rateKindBorrowIndex         = "borrow_index"          // debt_manager per-token interest index
	rateKindVariableBorrowIndex = "variable_borrow_index" // aave reserve variable borrow index
	rateKindLiquidityIndex      = "liquidity_index"       // aave reserve liquidity index
)

// The runner's snapshots are scoped to sideDebt (declared with the
// debt_manager deriver) — the event-derived side that is truly as-of the
// derive through-block.

// snapshotBatchCap bounds how many pending accounts one Step flushes into a
// single bulk SaveSnapshots write. 2000 keeps the biggest known fan-out (the
// DM migration window's ~7.3k seeded accounts) to ~4 bounded rounds instead
// of one unbounded per-account statement storm.
const snapshotBatchCap = 2000

// pendingCap hard-bounds the snapshot carry-over FIFO. 10,000 comfortably
// covers the biggest known fan-out (~7.3k DM migration seeds) while capping
// memory under sustained arrival storms; overflow drops the NEWEST touches
// with a WARN (best-effort history sheds load — position_balances truth is
// unaffected, and a dropped account regains a history row on its next
// balance-touching event).
const pendingCap = 10000

// RunnerStore is the store surface the runner drives. *store.Store satisfies
// it as-is (compile-checked below); tests pass fakes.
type RunnerStore interface {
	StateReader // BalancesFor — handed to Engine.BeginBatch and used for snapshots
	DeriveCursor(ctx context.Context, engine string) (block uint64, found bool, err error)
	ApplyDerivedWithRates(ctx context.Context, engine string, chainID uint64, events []store.PositionEvent, rates []store.RateObservation, throughBlock uint64) error
	RewindDerived(ctx context.Context, engine string, chainID uint64, toBlock uint64) error
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	RawLogsInRange(ctx context.Context, chainID uint64, addresses [][]byte, fromBlock, toBlock uint64) ([]store.RawLog, error)
	HasUnackedReorg(ctx context.Context, engine string, chainID uint64) (bool, error)
	SaveSnapshots(ctx context.Context, engine string, block uint64, docs map[string]store.SnapshotDoc) error
}

var _ RunnerStore = (*store.Store)(nil)

// Decoder is the decode surface (satisfied by *decode.Registry).
type Decoder interface {
	Decode(engine string, l store.RawLog) (decode.Event, bool, error)
}

var _ Decoder = (*decode.Registry)(nil)

// RunnerSpec is one engine's derivation binding, built from the config's
// streams (the address→engine mapping is config-defined; engine strings were
// validated against config.KnownEngines at load).
type RunnerSpec struct {
	Engine     string
	Chain      string // config chain key (the daemon resolves RPC clients by it)
	ChainID    uint64
	Streams    []string // ingest stream names whose cursors bound the derive frontier
	Addresses  [][]byte // the engine's full address set (raw 20-byte), deduped
	StartBlock uint64   // engine genesis: min StartBlock across its streams
	Window     uint64   // blocks per derivation batch: max Window across its streams
}

// BuildRunnerSpecs groups cfg's streams by engine into derivation bindings.
// Every stream of one engine must live on one chain — an engine is a single
// serial (block, logIndex) feed, and cross-chain logs have no total order.
// Specs are returned in first-appearance order of their engines (config
// order, deterministic).
func BuildRunnerSpecs(cfg *config.Config) ([]RunnerSpec, error) {
	byEngine := map[string]*RunnerSpec{}
	addrSeen := map[string]map[string]bool{}
	var order []string
	for _, s := range cfg.Streams {
		chain, ok := cfg.Chains[s.Chain]
		if !ok {
			// config.Load validates chain references; defensive against
			// hand-built configs in tests.
			return nil, fmt.Errorf("stream %q references unknown chain %q", s.Name, s.Chain)
		}
		spec, ok := byEngine[s.Engine]
		if !ok {
			spec = &RunnerSpec{
				Engine: s.Engine, Chain: s.Chain, ChainID: chain.ChainID,
				StartBlock: s.StartBlock, Window: s.Window,
			}
			byEngine[s.Engine] = spec
			addrSeen[s.Engine] = map[string]bool{}
			order = append(order, s.Engine)
		}
		if spec.Chain != s.Chain {
			return nil, fmt.Errorf("engine %q spans chains %q and %q: one engine derives one chain's serial log feed",
				s.Engine, spec.Chain, s.Chain)
		}
		spec.Streams = append(spec.Streams, s.Name)
		if s.StartBlock < spec.StartBlock {
			spec.StartBlock = s.StartBlock
		}
		if s.Window > spec.Window {
			spec.Window = s.Window
		}
		for _, a := range s.Addresses {
			raw := a.Bytes()
			if addrSeen[s.Engine][string(raw)] {
				continue
			}
			addrSeen[s.Engine][string(raw)] = true
			spec.Addresses = append(spec.Addresses, raw)
		}
	}
	out := make([]RunnerSpec, 0, len(order))
	for _, name := range order {
		out = append(out, *byEngine[name])
	}
	return out, nil
}

// Runner drives one Engine's derivation. NOT safe for concurrent use: it is
// stepped from the daemon's single loop under the single-writer contract
// (D-004), which is also what makes the engines' serial Process requirement
// hold.
type Runner struct {
	store  RunnerStore
	dec    Decoder
	engine Engine
	spec   RunnerSpec
	// onRewind fires after every completed derived-state rewind (the
	// snapshotter's re-sweep trigger); may be nil. Process-memory only — the
	// durable crash backstop is RewindDerived's own in-transaction sweep-
	// generation bump (see the package comment's REORG COORDINATION bullet).
	onRewind func()
	// unhealthy is set once and never cleared in-process (terminal capability
	// error — ErrUnsupportedBorrowToken); it gates DERIVATION only, never
	// reorg repair. Recovery = restart after a capability upgrade.
	unhealthy error
	// The carry-over queue of debt-side-touched accounts awaiting a
	// best-effort snapshots-history write: an insertion-ordered bounded FIFO.
	// pendingOrder holds arrival order (oldest first — the drain order);
	// pendingSet is the membership index (keyed by raw account bytes), so a
	// re-touch dedupes onto its ORIGINAL position instead of jumping the line.
	pendingOrder [][]byte
	pendingSet   map[string]bool
	// snapCap bounds one flush (snapshotBatchCap; overridable in tests);
	// pendingMax hard-caps the FIFO (pendingCap; overridable in tests).
	snapCap    int
	pendingMax int
	// droppedSnapshots counts accounts shed by FIFO overflow (drop-newest),
	// for tests and observability alongside the WARN.
	droppedSnapshots uint64
}

// NewRunner builds a Runner for spec. engine.Name() must match spec.Engine —
// a mismatch would derive one engine's logs into another's tables.
func NewRunner(st RunnerStore, dec Decoder, engine Engine, spec RunnerSpec, onRewind func()) (*Runner, error) {
	if st == nil || dec == nil || engine == nil {
		return nil, fmt.Errorf("runner %q: store, decoder and engine are all required", spec.Engine)
	}
	if engine.Name() != spec.Engine {
		return nil, fmt.Errorf("runner: engine %q does not match spec engine %q", engine.Name(), spec.Engine)
	}
	if spec.Window == 0 || len(spec.Addresses) == 0 || len(spec.Streams) == 0 || spec.StartBlock == 0 {
		return nil, fmt.Errorf("runner %q: window, addresses, streams and start block are all required", spec.Engine)
	}
	return &Runner{
		store: st, dec: dec, engine: engine, spec: spec, onRewind: onRewind,
		pendingSet: map[string]bool{}, snapCap: snapshotBatchCap, pendingMax: pendingCap,
	}, nil
}

// Name returns the engine identifier, for log attribution.
func (r *Runner) Name() string { return r.spec.Engine }

// Unhealthy returns the terminal error that took the engine out of service,
// or nil while it is healthy.
func (r *Runner) Unhealthy() error { return r.unhealthy }

// Health reports whether the engine is serving derivation, with the terminal
// reason when it is not — the daemon's health surface. UNHEALTHY is terminal
// for the process lifetime and gates derivation only (reorg repair still
// runs each Step). Recovery is deliberately a RESTART after a capability
// upgrade: all state is durable, so the restarted process simply re-derives
// the refusing window with the upgraded deriver — no in-process transition
// back to healthy exists.
func (r *Runner) Health() (healthy bool, reason string) {
	if r.unhealthy != nil {
		return false, r.unhealthy.Error()
	}
	return true, ""
}

// Step performs one bounded unit of derivation work: the unacked-reorg check
// (and, when needed, the mandatory rewind — even for an UNHEALTHY engine),
// then at most one window of raw logs decoded, processed and applied, then
// one bounded snapshot flush. Returns advanced=false when caught up to the
// ingest frontier with nothing pending (or when the engine is unhealthy /
// ingestion has not started).
//
// CALLER CONTRACT: advanced=true with a non-nil error IS possible — a
// committed window whose best-effort snapshot flush failed reports both, and
// the caller must still count it as progress (the cursor moved).
func (r *Runner) Step(ctx context.Context) (bool, error) {
	// Reorg coordination, proactive leg — BEFORE the unhealthy gate: a
	// durable epoch must be acknowledged (and stale derived state rewound)
	// whether or not the engine can derive; only derivation is capability-
	// gated. A walker rewind in this round (or a crash-surviving one from an
	// earlier process) left a durable epoch; the derived rewind must land
	// BEFORE any further apply.
	unacked, err := r.store.HasUnackedReorg(ctx, r.spec.Engine, r.spec.ChainID)
	if err != nil {
		return false, fmt.Errorf("runner %q: unacked-reorg check: %w", r.spec.Engine, err)
	}
	if unacked {
		if err := r.rewind(ctx); err != nil {
			return false, err
		}
		return true, nil // rewound; the next Step derives from the fresh cursor
	}

	if r.unhealthy != nil {
		return false, nil // terminal: already logged once at the transition
	}

	frontier, ok, err := r.ingestFrontier(ctx)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil // some stream has never ingested: no complete window exists yet
	}

	cursor, found, err := r.store.DeriveCursor(ctx, r.spec.Engine)
	if err != nil {
		return false, fmt.Errorf("runner %q: read derive cursor: %w", r.spec.Engine, err)
	}
	var from uint64
	if found {
		// Caught-up check BEFORE cursor+1: also guards the MaxUint64 wrap.
		if cursor >= frontier {
			// Caught up: drain any carried-over snapshot backlog at the
			// cursor block (the balances read is still exactly as-of it).
			wrote, err := r.flushSnapshots(ctx, cursor)
			if err != nil {
				return false, fmt.Errorf("runner %q: snapshot flush at %d: %w", r.spec.Engine, cursor, err)
			}
			return wrote, nil
		}
		from = cursor + 1
	} else {
		from = r.spec.StartBlock
	}
	if from > frontier {
		return false, nil
	}
	// Overflow-safe window cap (frontier >= from holds here; Window >= 1).
	to := frontier
	if delta := frontier - from; delta > r.spec.Window-1 {
		to = from + r.spec.Window - 1
	}

	logs, err := r.store.RawLogsInRange(ctx, r.spec.ChainID, r.spec.Addresses, from, to)
	if err != nil {
		return false, fmt.Errorf("runner %q: read raw logs [%d,%d]: %w", r.spec.Engine, from, to, err)
	}

	if err := r.engine.BeginBatch(ctx, r.store); err != nil {
		return false, fmt.Errorf("runner %q: begin batch: %w", r.spec.Engine, err)
	}

	var events []store.PositionEvent
	rates := newRateSet()
	for _, l := range logs {
		ev, known, err := r.dec.Decode(r.spec.Engine, l)
		if err != nil {
			// Decode failure: the store was provably never reached →
			// DiscardBatch is the correct lifecycle exit.
			r.engine.DiscardBatch()
			return false, fmt.Errorf("runner %q: decode log %x/%d at block %d: %w",
				r.spec.Engine, l.TxHash, l.LogIndex, l.BlockNumber, err)
		}
		if !known {
			continue // unallowlisted topic: routine skip, never an error
		}
		out, err := r.engine.Process(l, ev)
		if err != nil {
			// Process error mid-batch: pre-persistence failure — the one case
			// DiscardBatch is for (committed truth provably did not move).
			r.engine.DiscardBatch()
			if errors.Is(err, ErrUnsupportedBorrowToken) {
				// TERMINAL capability error, never retried: replaying cannot
				// succeed until the deriver grows oracle-priced derivation.
				r.unhealthy = err
				slog.Error("engine hit a terminal capability error; marking UNHEALTHY — derivation gated (reorg repair still runs) until restart with an upgraded deriver",
					"engine", r.spec.Engine, "err", err)
			}
			return false, fmt.Errorf("runner %q: process log %x/%d at block %d: %w",
				r.spec.Engine, l.TxHash, l.LogIndex, l.BlockNumber, err)
		}
		events = append(events, out...)
		rates.collect(l, ev)
	}

	// One transaction: events, balances, cursor AND the window's rate
	// observations land (or roll back) together — no separate rate pre-pass
	// a crash could strand.
	if err := r.store.ApplyDerivedWithRates(ctx, r.spec.Engine, r.spec.ChainID, events, rates.observations(), to); err != nil {
		// COMMIT-INDETERMINACY RULE (derive.Engine): ANY store-apply error →
		// Reset, never DiscardBatch. The commit may have landed with the ack
		// lost; Reset re-hydrates from committed truth either way, and the
		// next Step's fresh DeriveCursor read resumes from wherever the store
		// actually is.
		r.engine.Reset()
		if errors.Is(err, store.ErrUnackedReorgEpoch) {
			// Reactive backstop: a raw rewind recorded an epoch after this
			// Step's proactive check. Ack it now, before any further apply.
			slog.Warn("apply refused on an unacknowledged reorg epoch; rewinding derived state",
				"engine", r.spec.Engine, "err", err)
			if rerr := r.rewind(ctx); rerr != nil {
				return false, errors.Join(err, rerr)
			}
			return true, nil
		}
		return false, fmt.Errorf("runner %q: apply derived [%d,%d]: %w", r.spec.Engine, from, to, err)
	}
	r.engine.CommitBatch()

	r.queueTouched(events)
	if _, err := r.flushSnapshots(ctx, to); err != nil {
		// The batch is committed and the cursor advanced — advanced=true is
		// still reported (M1: callers must count it as progress). The flush
		// is best-effort history: the unwritten accounts STAY in the pending
		// set and retry on following Steps; position_balances truth is
		// unaffected either way.
		return true, fmt.Errorf("runner %q: snapshot flush at %d: %w", r.spec.Engine, to, err)
	}
	return true, nil
}

// rewind acknowledges every reorg epoch on the engine's chain: RewindDerived
// to the engine's own cursor (the store lowers the target to the deepest
// unacknowledged rewound_to — passing the cursor never leaves stale derived
// state, because nothing exists above it), then Reset, then resume FROM THE
// CURSOR READ BACK — never the requested target. Rate hygiene (deleting the
// engine's observations above the effective target), orphaned-snapshot
// invalidation and the durable sweep-generation bump all happen INSIDE
// RewindDerived's transaction, atomic with the ack. The onRewind hook (the
// snapshotter's re-sweep trigger) fires last; it is process-memory only, and
// a crash before it loses nothing durable — the generation bump already
// opened the re-sweep, and a restarted snapshotter resumes it on its first
// Step.
func (r *Runner) rewind(ctx context.Context) error {
	cursor, found, err := r.store.DeriveCursor(ctx, r.spec.Engine)
	if err != nil {
		return fmt.Errorf("runner %q: read derive cursor before rewind: %w", r.spec.Engine, err)
	}
	// Bootstrap (no cursor on an epoch-carrying chain): ack via RewindDerived
	// with the pre-genesis block; there is no derived state to delete.
	// StartBlock >= 1 is enforced by config validation and NewRunner.
	target := r.spec.StartBlock - 1
	if found {
		target = cursor
	}
	if err := r.store.RewindDerived(ctx, r.spec.Engine, r.spec.ChainID, target); err != nil {
		return fmt.Errorf("runner %q: rewind derived to %d: %w", r.spec.Engine, target, err)
	}
	r.engine.Reset()
	newCursor, found, err := r.store.DeriveCursor(ctx, r.spec.Engine)
	if err != nil {
		return fmt.Errorf("runner %q: read derive cursor after rewind: %w", r.spec.Engine, err)
	}
	if !found {
		return fmt.Errorf("runner %q: derive cursor missing after RewindDerived — store contract violated", r.spec.Engine)
	}
	// Pending-queue hygiene, same rewind (exit finding L1): RewindDerived
	// just deleted the WHOLE snapshots history of every account left with no
	// surviving debt-side event (reorg-orphan invalidation), but the pending
	// FIFO may still hold such accounts from batches the rewind erased — and
	// a later flush would insert an EMPTY debt document, recreating history
	// for a phantom. Revalidate every pending against post-rewind committed
	// truth: keep an account iff BalancesFor still shows a debt-side row.
	// This provably cannot drop a LEGITIMATE pending: the rewind's rebuild
	// inserts a debt-side balance row for exactly the accounts with a
	// surviving delta-bearing debt event — zero-net groups keep their row
	// (store contract, "position closed" stays distinguishable) — which is
	// the same predicate the orphan deletions used; and no writer interleaves
	// between the rewind commit and this read (single-writer, D-004). A read
	// failure aborts BEFORE any drop (nothing is mutated until every pending
	// has been classified) and surfaces as the Step's error — dropping on an
	// unclassified read could shed a legitimate pending, which is the one
	// outcome this filter must never produce. Residual (accepted,
	// best-effort history): the ack is already durable by then, so the
	// filter does not re-run, and a later successful flush of an unfiltered
	// orphan would still write its empty document.
	if len(r.pendingOrder) > 0 {
		kept := make([][]byte, 0, len(r.pendingOrder))
		var orphaned [][]byte
		for _, account := range r.pendingOrder {
			bals, err := r.store.BalancesFor(ctx, r.spec.Engine, account)
			if err != nil {
				return fmt.Errorf("runner %q: revalidate pending snapshot account %x after rewind: %w", r.spec.Engine, account, err)
			}
			hasDebt := false
			for _, sides := range bals {
				if _, ok := sides[sideDebt]; ok {
					hasDebt = true
					break
				}
			}
			if hasDebt {
				kept = append(kept, account)
			} else {
				orphaned = append(orphaned, account)
			}
		}
		for _, account := range orphaned {
			delete(r.pendingSet, string(account))
		}
		r.pendingOrder = kept
		if len(orphaned) > 0 {
			slog.Warn("dropped reorg-orphaned accounts from the pending snapshot queue (the rewind deleted their history; flushing would recreate an empty document)",
				"engine", r.spec.Engine, "dropped", len(orphaned))
		}
	}
	slog.Warn("derived state rewound after reorg epoch",
		"engine", r.spec.Engine, "requestedTarget", target, "cursor", newCursor)
	if r.onRewind != nil {
		r.onRewind()
	}
	return nil
}

// ingestFrontier returns the highest block through which EVERY one of the
// engine's streams has ingested (min over their cursors): above it some
// stream's logs may be missing, and deriving a window with an incomplete
// address set would silently drop events. ok=false when any stream has no
// cursor yet.
func (r *Runner) ingestFrontier(ctx context.Context) (uint64, bool, error) {
	return ingestFrontierOf(ctx, r.store, r.spec.Engine, r.spec.Streams)
}

// cursorReader is the one store method ingestFrontierOf needs. It exists so the
// frontier rule has exactly ONE implementation shared by the position Runner
// and the param ParamRunner: "derive only through the block every input stream
// has ingested" is a correctness rule about incomplete windows, and a second
// copy is a second thing to get wrong.
type cursorReader interface {
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
}

// ingestFrontierOf is Runner.ingestFrontier's body, verbatim, lifted to package
// scope (behaviour unchanged: same min-over-cursors, same ok=false on any
// stream with no cursor, same error text keyed on the engine name).
func ingestFrontierOf(ctx context.Context, st cursorReader, engine string, streams []string) (uint64, bool, error) {
	var frontier uint64
	for i, stream := range streams {
		cur, err := st.Cursor(ctx, stream)
		if err != nil {
			return 0, false, fmt.Errorf("runner %q: read ingest cursor %q: %w", engine, stream, err)
		}
		if cur == nil {
			return 0, false, nil
		}
		if i == 0 || cur.Block < frontier {
			frontier = cur.Block
		}
	}
	return frontier, true, nil
}

// queueTouched appends the batch's DEBT-side balance-touched accounts to the
// pending snapshot FIFO. Debt-side only (honest as-of semantics): the debt
// side is event-derived and therefore truly as-of the derive block, while
// collateral is the snapshotter's multicall read at its OWN block — a
// history row must never combine sides observed at different blocks, and
// cross-side composition is a read-time concern. A re-touched account keeps
// its ORIGINAL queue position (its eventual flush reads current balances, so
// arrival order only governs fairness, not correctness). At the hard cap the
// NEWEST touches are dropped with one WARN per batch — the documented
// overload posture (see the package comment's SNAPSHOTS bullet).
func (r *Runner) queueTouched(events []store.PositionEvent) {
	dropped := 0
	for _, ev := range events {
		if ev.Side != sideDebt || ev.Delta == nil {
			continue
		}
		key := string(ev.Account)
		if r.pendingSet[key] {
			continue // already queued: keep the original (older) position
		}
		if len(r.pendingOrder) >= r.pendingMax {
			dropped++
			continue // drop-newest: the queue keeps its oldest obligations
		}
		r.pendingSet[key] = true
		r.pendingOrder = append(r.pendingOrder, ev.Account)
	}
	if dropped > 0 {
		r.droppedSnapshots += uint64(dropped)
		slog.Warn("snapshot carry-over queue overflowed; dropping newest touched accounts (best-effort history sheds load; position_balances truth unaffected)",
			"engine", r.spec.Engine, "dropped", dropped, "cap", r.pendingMax)
	}
}

// flushSnapshots writes up to snapCap of the OLDEST pending accounts'
// side-scoped debt documents as ONE bulk SaveSnapshots write at block,
// removing only the accounts that were actually written from the FIFO (a
// failure keeps everything pending, in order, for retry — best-effort, but
// never silently lossy while the process lives). Draining oldest-first is
// the FIFO's fairness guarantee: an account touched during a fan-out storm
// cannot be starved by later arrivals. Carried-over accounts are stamped at
// the block of the round that flushes them, which their event-derived debt
// balances are exactly as-of.
func (r *Runner) flushSnapshots(ctx context.Context, block uint64) (bool, error) {
	if len(r.pendingOrder) == 0 {
		return false, nil
	}
	n := len(r.pendingOrder)
	if n > r.snapCap {
		n = r.snapCap
	}
	batch := r.pendingOrder[:n]
	docs := make(map[string]store.SnapshotDoc, n)
	for _, account := range batch {
		bals, err := r.store.BalancesFor(ctx, r.spec.Engine, account)
		if err != nil {
			return false, fmt.Errorf("read balances for %x: %w", account, err)
		}
		debt := map[string]*big.Int{}
		for assetHex, sides := range bals {
			if v, ok := sides[sideDebt]; ok {
				debt[assetHex] = v
			}
		}
		docs[hex.EncodeToString(account)] = store.SnapshotDoc{Side: sideDebt, Balances: debt}
	}
	if err := r.store.SaveSnapshots(ctx, r.spec.Engine, block, docs); err != nil {
		return false, err
	}
	for _, account := range batch {
		delete(r.pendingSet, string(account))
	}
	// Fresh backing array for the remainder: the flushed prefix must not stay
	// reachable through the old array.
	r.pendingOrder = append(make([][]byte, 0, len(r.pendingOrder)-n), r.pendingOrder[n:]...)
	return true, nil
}

// ---------------------------------------------------------------------------
// Rate observations.
// ---------------------------------------------------------------------------

// rateSet accumulates one batch's rate observations keyed
// (asset, block, kind) with LAST-WINS semantics: two same-block updates for
// one key (e.g. two admin index writes in one block) must persist the final
// value — the one every same-block fold used — not trip the store's
// same-key divergence refusal. Insertion order is preserved for
// deterministic persistence.
type rateSet struct {
	order []string
	byKey map[string]rateObs
}

type rateObs struct {
	asset []byte
	block uint64
	kind  string
	value *big.Int
}

func newRateSet() *rateSet {
	return &rateSet{byKey: map[string]rateObs{}}
}

func (rs *rateSet) add(asset []byte, block uint64, kind string, value *big.Int) {
	key := fmt.Sprintf("%x/%d/%s", asset, block, kind)
	if _, ok := rs.byKey[key]; !ok {
		rs.order = append(rs.order, key)
	}
	rs.byKey[key] = rateObs{asset: asset, block: block, kind: kind, value: new(big.Int).Set(value)}
}

// collect extracts the observations the runner is contracted to persist,
// from the DECODED events (called only after Engine.Process accepted the
// log, so the engines' validations — positive index, >= RAY — have run):
//
//   - decode.DMInterestIndexUpdated → "borrow_index" (the debt_manager
//     deriver emits NO position event for it; the runner persists from the
//     same decoded event, per the engine header).
//   - decode.AaveReserveDataUpdated → "variable_borrow_index" +
//     "liquidity_index" (the same values the engine copies verbatim into the
//     aave_reserve_data_updated payload; reading the decoded event avoids
//     re-parsing decimal strings).
//   - decode.DMBorrowApySet is deliberately NOT collected, on SCOPE: the
//     runner's documented rate obligations are the interest/liquidity index
//     kinds above, and "borrow_apy" belongs to the rate-derivation scope of
//     a later task — not because a same-block double-set would poison the
//     divergence refusal (last-wins dedupe already makes re-sets safe).
func (rs *rateSet) collect(l store.RawLog, ev decode.Event) {
	switch e := ev.(type) {
	case decode.DMInterestIndexUpdated:
		rs.add(e.Token.Bytes(), l.BlockNumber, rateKindBorrowIndex, e.NewIndex)
	case decode.AaveReserveDataUpdated:
		rs.add(e.Reserve.Bytes(), l.BlockNumber, rateKindVariableBorrowIndex, e.VariableBorrowIndex)
		rs.add(e.Reserve.Bytes(), l.BlockNumber, rateKindLiquidityIndex, e.LiquidityIndex)
	}
}

// observations returns the batch's deduped rate observations in insertion
// order, for atomic persistence with the window (ApplyDerivedWithRates).
func (rs *rateSet) observations() []store.RateObservation {
	out := make([]store.RateObservation, 0, len(rs.order))
	for _, key := range rs.order {
		o := rs.byKey[key]
		out = append(out, store.RateObservation{Asset: o.asset, Block: o.block, Kind: o.kind, Value: o.value})
	}
	return out
}
