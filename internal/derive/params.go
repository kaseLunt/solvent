package derive

// The PARAM runner (P3 Task 2): the deriver for engine "aave_param", which
// turns the Aave v3 ether.fi-market PoolConfigurator's logs into the
// param_history ledger.
//
// IT IS NOT A derive.Engine, AND IT DELIBERATELY DOES NOT RIDE Runner. Runner
// is hardwired to ApplyDerivedWithRates → position_events/position_balances and
// RewindDerived, plus the Engine batch lifecycle and the snapshot FIFO. A param
// deriver has no accounts, no balances, no batch state to reset and no snapshot
// history; forcing it through that shape would mean either faking a balance
// engine or parameterising Runner, and Runner is senior-approved,
// position-engine-specific code (consult R1.3). What it DOES copy from Runner
// is exactly the four rules that are about reorg custody rather than about
// positions, and nothing else:
//
//  1. PROACTIVE REPAIR FIRST: store.HasUnackedReorg before any derivation
//     (mirroring runner.go:288-297). A walker rewind in this round — or a
//     crash-surviving one from an earlier process — left a durable epoch, and
//     the param rewind must land BEFORE any further apply.
//  2. REACTIVE BACKSTOP: store.ErrUnackedReorgEpoch out of ApplyParamEvents →
//     rewind (mirroring runner.go:392-401), for the epoch that lands between
//     this Step's proactive check and its apply.
//  3. RESUME FROM THE CURSOR READ BACK, never from the requested target
//     (runner.go:24-26, 446-452): RewindParams may lower the target below what
//     was asked, because acking every epoch obliges the delete to reach the
//     DEEPEST unacknowledged rewound_to.
//  4. BOOTSTRAP ACK via RewindParams(StartBlock−1) when no cursor exists
//     (mirroring runner.go:435-441 and the store-side refusal it answers): a
//     new engine on a chain that already carries epochs gets no implicit ack.
//
// REFUSE-LOUD IS THIS RUNNER'S DEFINING RULE (consult R1.2, blocking).
// decode.Registry's contract for an unknown topic0 is (nil, false, nil) — a
// deliberate silent skip — and the position Runner honours it with `continue`,
// correctly: an ERC20 Approval alongside a Transfer is routine noise. FOR
// PARAMETERS, SILENCE IS UNAVAILABLE. The failure it would produce is concrete:
// a future PoolConfigurator implementation emits a parameter event this build
// has never seen, the log is skipped, param_history stays silently stale, and a
// public health factor is computed from a liquidation threshold that stopped
// being true. So an unknown topic0 in THIS engine's window is an ERROR — the
// stream halts loudly into the daemon's backoff and step_error condition — and
// the closed 20-topic0 inventory becomes an ENFORCED invariant instead of an
// assumption. The Registry's contract is untouched; the refusal lives here,
// where the consequence lives.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// ParamEngineName is the engine identity of the PoolConfigurator deriver
// (config.KnownEngines, config/contracts.json stream "eth:aave-param").
const ParamEngineName = "aave_param"

// ParamStore is the store surface the param runner drives. *store.Store
// satisfies it as-is (compile-checked below); tests pass fakes.
type ParamStore interface {
	DeriveCursor(ctx context.Context, engine string) (block uint64, found bool, err error)
	ApplyParamEvents(ctx context.Context, engine string, chainID uint64, rows []store.ParamRow, throughBlock uint64) error
	RewindParams(ctx context.Context, engine string, chainID uint64, toBlock uint64) error
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	RawLogsInRange(ctx context.Context, chainID uint64, addresses [][]byte, fromBlock, toBlock uint64) ([]store.RawLog, error)
	HasUnackedReorg(ctx context.Context, engine string, chainID uint64) (bool, error)
}

var _ ParamStore = (*store.Store)(nil)

// ParamRunner drives the param engine's derivation. NOT safe for concurrent
// use: it is stepped from the daemon's single loop under the single-writer
// contract (D-004), which is also what makes its (block, logIndex) serial order
// meaningful.
type ParamRunner struct {
	store ParamStore
	dec   Decoder
	spec  RunnerSpec
}

// NewParamRunner builds a ParamRunner for spec. spec.Engine must be
// ParamEngineName — a mismatch would write one engine's logs under another's
// cursor, and the cursor is what every reorg gate keys on.
func NewParamRunner(st ParamStore, dec Decoder, spec RunnerSpec) (*ParamRunner, error) {
	if st == nil || dec == nil {
		return nil, fmt.Errorf("param runner %q: store and decoder are both required", spec.Engine)
	}
	if spec.Engine != ParamEngineName {
		return nil, fmt.Errorf("param runner: spec engine %q is not %q", spec.Engine, ParamEngineName)
	}
	if spec.Window == 0 || len(spec.Addresses) == 0 || len(spec.Streams) == 0 || spec.StartBlock == 0 {
		return nil, fmt.Errorf("param runner %q: window, addresses, streams and start block are all required", spec.Engine)
	}
	return &ParamRunner{store: st, dec: dec, spec: spec}, nil
}

// Name returns the engine identifier, for log attribution and the daemon's
// worker registry.
func (r *ParamRunner) Name() string { return r.spec.Engine }

// Health satisfies the daemon's deriveWorker interface. The param runner has NO
// terminal state, and that is a considered answer rather than a stub: the one
// condition that could wedge it — a topic0 outside the closed inventory — is a
// LOUD, RETRYABLE halt, not a capability limit. Retrying is the correct
// posture, because the operator's fix (extend internal/decode's configurator
// table) arrives with a restart that must then resume from the same window.
// Meanwhile the failure is fully visible: every Step returns the error, so the
// daemon records step_error and the no-progress condition fires — a wedged
// param stream can never look green.
func (r *ParamRunner) Health() (healthy bool, reason string) { return true, "" }

// Step performs one bounded unit of param derivation: the unacked-reorg check
// (and, when needed, the mandatory rewind), then at most one window of raw logs
// decoded and applied. Returns advanced=false when caught up to the ingest
// frontier (or when ingestion has not started).
func (r *ParamRunner) Step(ctx context.Context) (bool, error) {
	// RULE 1 — proactive repair, before any derivation.
	unacked, err := r.store.HasUnackedReorg(ctx, r.spec.Engine, r.spec.ChainID)
	if err != nil {
		return false, fmt.Errorf("param runner %q: unacked-reorg check: %w", r.spec.Engine, err)
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
		return false, nil // the stream has never ingested: no complete window exists yet
	}

	cursor, found, err := r.store.DeriveCursor(ctx, r.spec.Engine)
	if err != nil {
		return false, fmt.Errorf("param runner %q: read derive cursor: %w", r.spec.Engine, err)
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
		return false, fmt.Errorf("param runner %q: read raw logs [%d,%d]: %w", r.spec.Engine, from, to, err)
	}

	// RawLogsInRange orders by (block_number, log_index), which on an EVM chain
	// is a TOTAL order — so the rows below inherit their effective ordering
	// straight from the read, without this runner sorting anything itself.
	var rows []store.ParamRow
	for _, l := range logs {
		ev, known, err := r.dec.Decode(r.spec.Engine, l)
		if err != nil {
			return false, fmt.Errorf("param runner %q: decode log %x/%d at block %d: %w",
				r.spec.Engine, l.TxHash, l.LogIndex, l.BlockNumber, err)
		}
		if !known {
			// REFUSE LOUD (see the package header). Never `continue`.
			var topic0 string
			if len(l.Topics) > 0 {
				topic0 = common.BytesToHash(l.Topics[0]).Hex()
			}
			return false, fmt.Errorf("param runner %q: UNKNOWN topic0 %s on log %x/%d at block %d (address %x): the configurator event inventory is a CLOSED set and silence is unavailable for parameters — halting rather than skipping. Decode it in internal/decode/configurator.go (and decide whether it carries a param) before this stream can advance",
				r.spec.Engine, topic0, l.TxHash, l.LogIndex, l.BlockNumber, l.Address)
		}
		row, produced := paramRowFor(r.spec.Engine, r.spec.ChainID, l, ev)
		if !produced {
			continue // in the inventory, strictly decoded, carries no param
		}
		rows = append(rows, row)
	}

	if err := r.store.ApplyParamEvents(ctx, r.spec.Engine, r.spec.ChainID, rows, to); err != nil {
		if errors.Is(err, store.ErrUnackedReorgEpoch) {
			// RULE 2 — reactive backstop: a raw rewind recorded an epoch after
			// this Step's proactive check. Ack it now, before any further apply.
			slog.Warn("param apply refused on an unacknowledged reorg epoch; rewinding param history",
				"engine", r.spec.Engine, "err", err)
			if rerr := r.rewind(ctx); rerr != nil {
				return false, errors.Join(err, rerr)
			}
			return true, nil
		}
		return false, fmt.Errorf("param runner %q: apply params [%d,%d]: %w", r.spec.Engine, from, to, err)
	}
	return true, nil
}

// rewind acknowledges every reorg epoch on the engine's chain: RewindParams to
// the engine's own cursor (the store lowers the target to the deepest
// unacknowledged rewound_to — passing the cursor never leaves stale rows,
// because nothing exists above it), then resume FROM THE CURSOR READ BACK.
//
// RULE 4 lives here: with no cursor at all (a brand-new engine on a chain that
// already carries epochs), the target is StartBlock−1. That call creates the
// cursor and acks; there is no param history to delete. StartBlock >= 1 is
// enforced by config validation and NewParamRunner.
func (r *ParamRunner) rewind(ctx context.Context) error {
	cursor, found, err := r.store.DeriveCursor(ctx, r.spec.Engine)
	if err != nil {
		return fmt.Errorf("param runner %q: read derive cursor before rewind: %w", r.spec.Engine, err)
	}
	target := r.spec.StartBlock - 1
	if found {
		target = cursor
	}
	if err := r.store.RewindParams(ctx, r.spec.Engine, r.spec.ChainID, target); err != nil {
		return fmt.Errorf("param runner %q: rewind params to %d: %w", r.spec.Engine, target, err)
	}
	// RULE 3 — the cursor READ BACK is the resume point, never `target`.
	newCursor, found, err := r.store.DeriveCursor(ctx, r.spec.Engine)
	if err != nil {
		return fmt.Errorf("param runner %q: read derive cursor after rewind: %w", r.spec.Engine, err)
	}
	if !found {
		return fmt.Errorf("param runner %q: derive cursor missing after RewindParams — store contract violated", r.spec.Engine)
	}
	slog.Warn("param history rewound after reorg epoch",
		"engine", r.spec.Engine, "requestedTarget", target, "cursor", newCursor)
	return nil
}

// ingestFrontier reuses the position runner's frontier rule verbatim
// (runner.go's ingestFrontierOf): derive only through the block every input
// stream has ingested.
func (r *ParamRunner) ingestFrontier(ctx context.Context) (uint64, bool, error) {
	return ingestFrontierOf(ctx, r.store, r.spec.Engine, r.spec.Streams)
}

// paramRowFor maps a decoded configurator event to its param_history row, or
// reports produced=false for an inventory event that carries no parameter.
//
// THREE EVENTS PRODUCE ROWS, and each sets only the fields ITS event spoke to
// (every other field stays nil — nil means "this event said nothing about
// that", never zero; see store.ParamRow):
//
//   - CollateralConfigurationChanged → ltv / liq_threshold / liq_bonus, RAW in
//     Aave basis points (1e4). Never normalized here: the DM's equivalents use
//     HUNDRED_PERCENT = 100e18, and the only evidence of which convention a row
//     carries is which engine wrote it. Conversion lives in internal/risk.
//   - ReserveInitialized → the reserve registry (atoken, variable_debt_token,
//     strategy). This is what makes param_history the authoritative answer to
//     "which reserves does this market have", so the Task-6 weld can assert SET
//     EQUALITY against recon/feeds.json instead of trusting a static list.
//   - EModeAssetCategoryChanged → the new category. Every occurrence on this
//     instance is 0, but it is RECORDED, not assumed: the category selects
//     which liquidation threshold applies.
//
// The other 17 inventory events are strictly decoded — which is what proves
// membership of the closed set and keeps the refuse-loud rule meaningful — and
// then acknowledged without a row. They are genuinely non-param (caps, rate
// curves, token-implementation upgrades, flags, premiums); recording them as
// param rows would put facts in a table whose readers compute liquidation
// thresholds from it.
func paramRowFor(engine string, chainID uint64, l store.RawLog, ev decode.Event) (store.ParamRow, bool) {
	base := store.ParamRow{
		Engine:            engine,
		ChainID:           chainID,
		EffectiveBlock:    l.BlockNumber,
		EffectiveLogIndex: l.LogIndex,
		SourceEvent:       ev.Name(),
		TxHash:            l.TxHash,
	}
	switch e := ev.(type) {
	case decode.AaveCfgCollateralConfigurationChanged:
		base.Asset = e.Asset.Bytes()
		base.LTV = e.LTV
		base.LiqThreshold = e.LiquidationThreshold
		base.LiqBonus = e.LiquidationBonus
		return base, true
	case decode.AaveCfgReserveInitialized:
		base.Asset = e.Asset.Bytes()
		base.AToken = e.AToken.Bytes()
		base.VariableDebtToken = e.VariableDebtToken.Bytes()
		base.Strategy = e.InterestRateStrategy.Bytes()
		return base, true
	case decode.AaveCfgEModeAssetCategoryChanged:
		base.Asset = e.Asset.Bytes()
		category := e.NewCategoryID
		base.EModeCategory = &category
		return base, true
	default:
		return store.ParamRow{}, false
	}
}
