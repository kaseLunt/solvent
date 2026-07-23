package derive

// The derivation runner: the orchestration layer every LIFECYCLE CONTRACT
// comment in this package refers to as "the runner" (engine.go's terminology
// note). One Runner per engine drives the loop
//
//	raw_logs window → Decode → Engine.Process → store.ApplyDerived
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
//   - COMMIT-INDETERMINACY RULE: ANY ApplyDerived error → Engine.Reset(),
//     never DiscardBatch (see engine.go). DiscardBatch is used only for
//     failures that provably never reached ApplyDerived (a decode or Process
//     error mid-batch).
//   - RESUME FROM THE CURSOR, never from an assumed target: after any rewind
//     or ambiguous commit, the next window's start comes from a fresh
//     DeriveCursor read — RewindDerived may have rewound DEEPER than the
//     caller's target (deepest-unacked-epoch lowering), and an ambiguous
//     commit may have advanced the cursor despite the error.
//   - REORG COORDINATION: before deriving, the runner checks
//     store.HasUnackedReorg (a walker rewind records a durable reorg epoch)
//     and answers it with RewindDerived → Reset → cursor re-read BEFORE any
//     further ApplyDerived; ApplyDerived's own ErrUnackedReorgEpoch refusal
//     is handled identically as the reactive backstop. Every rewind also
//     deletes the engine's rate observations above the post-rewind cursor
//     (a post-reorg re-derivation could observe a different value at the
//     same (asset, block, kind), which SaveRateIndex refuses as divergence)
//     and fires the onRewind hook (the snapshotter's re-sweep trigger).
//   - TERMINAL CAPABILITY ERRORS: ErrUnsupportedBorrowToken marks the engine
//     UNHEALTHY — no retry can succeed until the deriver grows oracle-priced
//     derivation — and every subsequent Step is a no-op.
//   - RATE OBSERVATIONS are persisted via store.SaveRateIndex BEFORE
//     ApplyDerived: SaveRateIndex is idempotent for identical replays, so a
//     re-derived window re-saves harmlessly, while saving after ApplyDerived
//     could lose observations forever (the cursor advances and the window is
//     never read again).
//   - SNAPSHOTS: after a committed batch, one snapshots row per
//     balance-touched account at the batch's through-block (BalancesFor →
//     store.SaveSnapshot), per the plan.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// Rate-observation kinds persisted by the runner, from the store's
// documented vocabulary (store.SaveRateIndex).
const (
	rateKindBorrowIndex         = "borrow_index"          // debt_manager per-token interest index
	rateKindVariableBorrowIndex = "variable_borrow_index" // aave reserve variable borrow index
	rateKindLiquidityIndex      = "liquidity_index"       // aave reserve liquidity index
)

// RunnerStore is the store surface the runner drives. *store.Store satisfies
// it as-is (compile-checked below); tests pass fakes.
type RunnerStore interface {
	StateReader // BalancesFor — handed to Engine.BeginBatch and used for snapshots
	DeriveCursor(ctx context.Context, engine string) (block uint64, found bool, err error)
	ApplyDerived(ctx context.Context, engine string, chainID uint64, events []store.PositionEvent, throughBlock uint64) error
	RewindDerived(ctx context.Context, engine string, chainID uint64, toBlock uint64) error
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	RawLogsInRange(ctx context.Context, chainID uint64, addresses [][]byte, fromBlock, toBlock uint64) ([]store.RawLog, error)
	HasUnackedReorg(ctx context.Context, engine string, chainID uint64) (bool, error)
	SaveRateIndex(ctx context.Context, engine string, asset []byte, block uint64, kind string, value *big.Int) error
	DeleteRateIndexesAbove(ctx context.Context, engine string, block uint64) error
	SaveSnapshot(ctx context.Context, engine string, account []byte, block uint64, balances map[string]map[string]*big.Int) error
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
	// snapshotter's re-sweep trigger); may be nil.
	onRewind func()
	// unhealthy is set once and never cleared (terminal capability error —
	// ErrUnsupportedBorrowToken); every subsequent Step is a no-op.
	unhealthy error
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
	return &Runner{store: st, dec: dec, engine: engine, spec: spec, onRewind: onRewind}, nil
}

// Name returns the engine identifier, for log attribution.
func (r *Runner) Name() string { return r.spec.Engine }

// Unhealthy returns the terminal error that took the engine out of service,
// or nil while it is healthy.
func (r *Runner) Unhealthy() error { return r.unhealthy }

// Step performs one bounded unit of derivation work: the unacked-reorg check,
// then at most one window of raw logs decoded, processed and applied.
// Returns advanced=false when caught up to the ingest frontier (or when the
// engine is unhealthy / ingestion has not started).
func (r *Runner) Step(ctx context.Context) (bool, error) {
	if r.unhealthy != nil {
		return false, nil // terminal: already logged once at the transition
	}

	// Reorg coordination, proactive leg: a walker rewind in this round (or a
	// crash-surviving one from an earlier process) left a durable epoch; the
	// derived rewind must land BEFORE any further ApplyDerived.
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
			return false, nil
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
			// Decode failure: ApplyDerived was provably never reached →
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
				slog.Error("engine hit a terminal capability error; marking UNHEALTHY — no retry can succeed until the deriver supports oracle-priced derivation",
					"engine", r.spec.Engine, "err", err)
			}
			return false, fmt.Errorf("runner %q: process log %x/%d at block %d: %w",
				r.spec.Engine, l.TxHash, l.LogIndex, l.BlockNumber, err)
		}
		events = append(events, out...)
		rates.collect(l, ev)
	}

	// Rate observations BEFORE ApplyDerived (idempotent for replays; saving
	// after could lose them forever once the cursor advances).
	if err := rates.persist(ctx, r.store, r.spec.Engine); err != nil {
		r.engine.DiscardBatch() // never reached ApplyDerived
		return false, fmt.Errorf("runner %q: %w", r.spec.Engine, err)
	}

	if err := r.store.ApplyDerived(ctx, r.spec.Engine, r.spec.ChainID, events, to); err != nil {
		// COMMIT-INDETERMINACY RULE (derive.Engine): ANY ApplyDerived error →
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

	if err := r.snapshotTouched(ctx, events, to); err != nil {
		// The batch is committed and the cursor advanced — this window will
		// not be re-derived, so the round's snapshots rows are best-effort.
		// Authoritative balances live in position_balances; surface the error
		// without undoing progress.
		return true, fmt.Errorf("runner %q: snapshot touched accounts at %d: %w", r.spec.Engine, to, err)
	}
	return true, nil
}

// rewind acknowledges every reorg epoch on the engine's chain: RewindDerived
// to the engine's own cursor (the store lowers the target to the deepest
// unacknowledged rewound_to — passing the cursor never leaves stale derived
// state, because nothing exists above it), then Reset, then resume FROM THE
// CURSOR READ BACK — never the requested target. Rate observations above the
// post-rewind cursor are deleted (divergence hygiene) and the onRewind hook
// (snapshot re-sweep) fires last.
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
	if err := r.store.DeleteRateIndexesAbove(ctx, r.spec.Engine, newCursor); err != nil {
		return fmt.Errorf("runner %q: delete rate indexes above %d: %w", r.spec.Engine, newCursor, err)
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
	var frontier uint64
	for i, stream := range r.spec.Streams {
		cur, err := r.store.Cursor(ctx, stream)
		if err != nil {
			return 0, false, fmt.Errorf("runner %q: read ingest cursor %q: %w", r.spec.Engine, stream, err)
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

// snapshotTouched writes one snapshots row per balance-touched account
// (Side != "" and Delta != nil — record-only events move no balance) at the
// batch's through-block, reading committed truth via BalancesFor. Accounts
// are visited in first-touch order (deterministic).
func (r *Runner) snapshotTouched(ctx context.Context, events []store.PositionEvent, block uint64) error {
	seen := map[string]bool{}
	var order [][]byte
	for _, ev := range events {
		if ev.Side == "" || ev.Delta == nil {
			continue
		}
		k := string(ev.Account)
		if seen[k] {
			continue
		}
		seen[k] = true
		order = append(order, ev.Account)
	}
	for _, account := range order {
		bals, err := r.store.BalancesFor(ctx, r.spec.Engine, account)
		if err != nil {
			return fmt.Errorf("read balances for %x: %w", account, err)
		}
		if err := r.store.SaveSnapshot(ctx, r.spec.Engine, account, block, bals); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Rate observations.
// ---------------------------------------------------------------------------

// rateSet accumulates one batch's rate observations keyed
// (asset, block, kind) with LAST-WINS semantics: two same-block updates for
// one key (e.g. two admin index writes in one block) must persist the final
// value — the one every same-block fold used — not poison SaveRateIndex's
// divergence refusal. Insertion order is preserved for deterministic
// persistence.
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
func (rs *rateSet) collect(l store.RawLog, ev decode.Event) {
	switch e := ev.(type) {
	case decode.DMInterestIndexUpdated:
		rs.add(e.Token.Bytes(), l.BlockNumber, rateKindBorrowIndex, e.NewIndex)
	case decode.AaveReserveDataUpdated:
		rs.add(e.Reserve.Bytes(), l.BlockNumber, rateKindVariableBorrowIndex, e.VariableBorrowIndex)
		rs.add(e.Reserve.Bytes(), l.BlockNumber, rateKindLiquidityIndex, e.LiquidityIndex)
	}
}

func (rs *rateSet) persist(ctx context.Context, st RunnerStore, engine string) error {
	for _, key := range rs.order {
		o := rs.byKey[key]
		if err := st.SaveRateIndex(ctx, engine, o.asset, o.block, o.kind, o.value); err != nil {
			return fmt.Errorf("save rate index %s/%x@%d: %w", o.kind, o.asset, o.block, err)
		}
	}
	return nil
}
