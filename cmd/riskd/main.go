// Command riskd is Solvent's risk materializer: it polls the derived-state
// watermark vector, recomputes health factors when it moves, and commits one
// risk batch per recompute.
//
// The package is split by topic:
//
//	main.go  — configuration, the composition root, the poll loop
//	gates.go — the watermark vector, the compute-time reorg gate, batch stamps
//	pass.go  — one pass: snapshot → gate → substrate → compute → write
//
// # riskd makes ZERO RPC calls
//
// Every input is a durable store fact (chain-truth R6.3). There is no chain
// client in this binary and no import path that reaches one: a live read here
// would reintroduce provider testimony into a layer with no custody machinery
// to judge it, and stress scenarios are price-shifts over stored inputs rather
// than fresh reads. `TestRiskdMakesNoChainCalls` enforces the import allowlist.
//
// # It is not the single writer, and does not need to be
//
// D-004's single-writer contract covers the P2 tables, which riskd only ever
// SELECTs — structurally, through a `READ ONLY` snapshot transaction and (where
// the operator provisions it) the SELECT-only `solvent_riskd` role migration
// 00013 creates. The risk tables have exactly one writer, which is this daemon,
// and a second instance would not corrupt them: batches are append-only with a
// sequence-allocated id. It would merely waste work.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"syscall"
	"time"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// notifyChannel is the doorbell `cmd/api` listens on. The payload is the batch
// id and NOTHING ELSE is derivable from it: a listener treats it as a wake-up
// and re-reads the tables. NOTIFY is droppable on reconnect, so every honest
// listener needs a poll fallback anyway — which makes the poll the mechanism
// and this an optimization (chain-truth R1).
const notifyChannel = "risk_batch"

// Defaults. Each is overridable by environment variable; each is a policy this
// repo owns rather than a quantity the chain asserts, and is disclosed as such.
const (
	// defaultPollInterval — the plan's 2s vector poll. The vector read is a
	// two-table, ~15-row query; it is invisible at this cadence.
	defaultPollInterval = 2 * time.Second
	// defaultRetention — newest 5,000 batches (plan Task 5).
	defaultRetention = 5000
	// defaultPriceBudgetSeconds — 3× the 60s price poll cadence. Every input
	// riskd VALUES with is a poll row, and a poll oracle has no publication
	// heartbeat to be stale against; the honest bound is our own cadence plus
	// margin. The refusal ceiling is 2× this (design spec §7, R = 2 × T_f), so
	// an input older than 6 minutes is refused rather than served.
	defaultPriceBudgetSeconds = 180
	// defaultStepBps — 20%. A single-interval move beyond this is FLAGGED and
	// never refused: the polled price IS the engine's charging price (§7 G5).
	defaultStepBps = 2000
)

func main() {
	configPath := flag.String("config", "config/contracts.json", "path to contracts config")
	feedsPath := flag.String("feeds", "recon/feeds.json", "path to the oracle feed registry")
	once := flag.Bool("once", false, "run a single pass and exit (operational probe; not a scheduler)")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *configPath, *feedsPath, *once); err != nil {
		log.Error("riskd exited with error", "err", err)
		os.Exit(1)
	}
}

// daemonConfig is the resolved, validated configuration of one riskd process.
type daemonConfig struct {
	Registry *riskfeed.Registry

	Aave riskfeed.EngineBinding
	DM   riskfeed.EngineBinding

	PollInterval time.Duration
	Retention    int
	Budget       riskfeed.PriceBudget
	StepBps      int64
	Producer     string
}

// consumedEngines is every engine whose cursor participates in the recompute
// TRIGGER and in the batch stamps — position, param AND price engines. A price
// row landing changes the numbers, so a vector that ignored the price cursors
// would recompute only when a block moved.
func (c *daemonConfig) consumedEngines() []string {
	return []string{
		c.Aave.Engine, c.Aave.ParamEngine, c.Aave.PriceEngine,
		c.DM.Engine, c.DM.ParamEngine, c.DM.PriceEngine,
	}
}

// gatedEngines is the subset the PASS gate refuses on: the engines whose rows
// are treated as truth. Price engines are excluded deliberately — they are
// gated per position by G2, so one chain's price reorg does not refuse the
// other chain's book (design spec §7).
//
// The Debt Manager's param engine IS its position engine (its params are a view
// over its own position_events), so the list deduplicates naturally.
//
// The requirements are (engine, chain_id) PAIRS, not names. A name alone let an
// ABSENT cursor pass the gate and gave a WRONG-CHAIN cursor nothing to be checked
// against — so an ETH parameter query could be bounded by an OP cursor's height.
// riskfeed.GateEpochs refuses all three failure modes by name.
func (c *daemonConfig) gatedEngines() []riskfeed.RequiredCursor {
	seen := map[riskfeed.RequiredCursor]bool{}
	var out []riskfeed.RequiredCursor
	for _, r := range []riskfeed.RequiredCursor{
		{Engine: c.Aave.Engine, ChainID: int64(c.Aave.ChainID)},
		{Engine: c.Aave.ParamEngine, ChainID: int64(c.Aave.ChainID)},
		{Engine: c.DM.Engine, ChainID: int64(c.DM.ChainID)},
		{Engine: c.DM.ParamEngine, ChainID: int64(c.DM.ChainID)},
	} {
		if r.Engine == "" || seen[r] {
			continue
		}
		seen[r] = true
		out = append(out, r)
	}
	return out
}

// sweptEngines are the engines whose collateral is produced by the SNAPSHOT
// SWEEP, and therefore the only ones whose sweep state belongs in the vector or
// on a batch stamp.
//
// Today that is the Debt Manager alone: `internal/snapshot` sweeps OP collateral
// through the CashLens, while Aave collateral is event-derived from aToken
// transfers and has no sweep at all. Returning the Aave engine here would stamp
// it with an all-zero sweep row, and an all-zero row is NOT the same statement as
// "this engine has no sweep" — migration 00013 keeps those distinguishable
// precisely so a reader cannot mistake one for the other. If an Aave-side sweeper
// ever exists, it is added here.
func (c *daemonConfig) sweptEngines() []string {
	return []string{c.DM.Engine}
}

// requiredStampEngines is the engine set whose watermark stamps must be present
// for a batch to be servable — every engine the pass consumes, price pollers
// included, because supersession is judged per engine.
func (c *daemonConfig) requiredStampEngines(v watermarkVector) []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range c.consumedEngines() {
		if e == "" || seen[e] {
			continue
		}
		// Only engines that actually HAVE a cursor get stamped, so only those may
		// be required. A missing position/param cursor has already refused the
		// pass at the gate; a missing price cursor is reported per position as an
		// absent input.
		if _, ok := v.Engines[e]; !ok {
			continue
		}
		seen[e] = true
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}

// snapshotSpec bounds every substrate read at the engine's OWN cursor. An index
// or a param row above the cursor describes a block the engine has not claimed
// custody of, and reading it would let a batch assert coverage it does not have.
func (c *daemonConfig) snapshotSpec(v watermarkVector) store.RiskSnapshotSpec {
	spec := store.RiskSnapshotSpec{
		PositionEngines: []string{c.Aave.Engine, c.DM.Engine},
		// The SAME set the cheap poll uses, so the gated vector and the
		// in-snapshot re-read cannot differ.
		SweptEngines:    c.sweptEngines(),
		IndexBounds:     map[string]uint64{},
		AaveParamEngine: c.Aave.ParamEngine,
		AaveParamChain:  c.Aave.ChainID,
		Prices:          c.Registry.PriceKeys(),
	}
	if cur, ok := v.Engines[c.Aave.Engine]; ok {
		spec.IndexBounds[c.Aave.Engine] = cur.LastBlock
	}
	if cur, ok := v.Engines[c.DM.Engine]; ok {
		spec.IndexBounds[c.DM.Engine] = cur.LastBlock
		spec.DMParamBlock = cur.LastBlock
	}
	if cur, ok := v.Engines[c.Aave.ParamEngine]; ok {
		spec.AaveParamBlock = cur.LastBlock
	}
	return spec
}

func (c *daemonConfig) assembleConfig(prev map[string]*big.Int) riskfeed.AssembleConfig {
	return riskfeed.AssembleConfig{
		Registry:   c.Registry,
		Aave:       c.Aave,
		DM:         c.DM,
		Budget:     c.Budget,
		StepBps:    c.StepBps,
		PrevPrices: prev,
	}
}

// loadConfig resolves the daemon's configuration from files and environment.
func loadConfig(configPath, feedsPath string) (*daemonConfig, error) {
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}
	feeds, err := config.LoadFeeds(feedsPath, cfg.Chains)
	if err != nil {
		return nil, err
	}
	registry, err := riskfeed.NewRegistry(feeds)
	if err != nil {
		return nil, err
	}

	ethChain, ok := cfg.Chains["eth"]
	if !ok {
		return nil, errors.New("riskd: contracts config declares no `eth` chain")
	}
	opChain, ok := cfg.Chains["op"]
	if !ok {
		return nil, errors.New("riskd: contracts config declares no `op` chain")
	}

	d := &daemonConfig{
		Registry: registry,
		Aave: riskfeed.EngineBinding{
			Engine:      risk.AaveEngine,
			ChainID:     ethChain.ChainID,
			ParamEngine: risk.AaveParamEngine,
			PriceEngine: store.PollOwnedEnginePrefix + strconv.FormatUint(ethChain.ChainID, 10),
		},
		DM: riskfeed.EngineBinding{
			Engine: risk.DMEngine,
			// The Debt Manager's params ARE its own position_events — the
			// deriver has persisted CollateralTokenConfigSet from genesis, so
			// there is no separate param engine and no new RPC (chain-truth R3).
			ParamEngine: risk.DMEngine,
			ChainID:     opChain.ChainID,
			PriceEngine: store.PollOwnedEnginePrefix + strconv.FormatUint(opChain.ChainID, 10),
		},
		PollInterval: defaultPollInterval,
		Retention:    defaultRetention,
		Budget:       riskfeed.PriceBudget{Seconds: defaultPriceBudgetSeconds},
		StepBps:      defaultStepBps,
		Producer:     "riskd",
	}

	if v := os.Getenv("SOLVENT_RISK_POLL_INTERVAL"); v != "" {
		dur, err := time.ParseDuration(v)
		if err != nil || dur <= 0 {
			return nil, fmt.Errorf("SOLVENT_RISK_POLL_INTERVAL %q: must be a positive Go duration", v)
		}
		d.PollInterval = dur
	}
	if v := os.Getenv("SOLVENT_RISK_RETENTION"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("SOLVENT_RISK_RETENTION %q: must be a positive integer", v)
		}
		d.Retention = n
	}
	if v := os.Getenv("SOLVENT_RISK_PRICE_BUDGET"); v != "" {
		dur, err := time.ParseDuration(v)
		if err != nil || dur <= 0 {
			return nil, fmt.Errorf("SOLVENT_RISK_PRICE_BUDGET %q: must be a positive Go duration", v)
		}
		d.Budget = riskfeed.PriceBudget{Seconds: int64(dur / time.Second)}
		if d.Budget.Seconds <= 0 {
			return nil, fmt.Errorf("SOLVENT_RISK_PRICE_BUDGET %q: must be at least one second", v)
		}
	}
	if v := os.Getenv("SOLVENT_RISK_STEP_BPS"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			return nil, fmt.Errorf("SOLVENT_RISK_STEP_BPS %q: must be a non-negative integer (0 disables the G5 flag)", v)
		}
		d.StepBps = n
	}
	return d, nil
}

// riskdDSN resolves the daemon's database URL.
//
// SOLVENT_RISKD_DATABASE_URL is preferred and is where the SELECT-only
// `solvent_riskd` role belongs (migration 00013). It falls back to
// SOLVENT_DATABASE_URL so a local dev run works without provisioning a second
// credential — the fallback is a convenience with a cost, and the cost is that
// the structural read-only posture is not in force, so it is logged.
func riskdDSN() (dsn string, scoped bool, err error) {
	if v := os.Getenv("SOLVENT_RISKD_DATABASE_URL"); v != "" {
		return v, true, nil
	}
	if v := os.Getenv("SOLVENT_DATABASE_URL"); v != "" {
		return v, false, nil
	}
	return "", false, errors.New("riskd: set SOLVENT_RISKD_DATABASE_URL (preferred) or SOLVENT_DATABASE_URL")
}

func run(ctx context.Context, configPath, feedsPath string, once bool) error {
	cfg, err := loadConfig(configPath, feedsPath)
	if err != nil {
		return err
	}
	dsn, scoped, err := riskdDSN()
	if err != nil {
		return err
	}
	if !scoped {
		slog.Warn("riskd is using SOLVENT_DATABASE_URL: the SELECT-only solvent_riskd role is NOT in force. " +
			"Set SOLVENT_RISKD_DATABASE_URL for the structural read-only posture (migration 00013).")
	}

	// riskd NEVER migrates. Schema ownership belongs to the indexer's startup
	// path and to `make db-up`; a materializer that could reshape the tables it
	// reads would be a second schema authority.
	s, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer s.Close()

	if err := requireSchema(ctx, s); err != nil {
		return err
	}

	// SINGLE WRITER, STRUCTURALLY. A session-scoped advisory lock held for this
	// process's lifetime means a second honest riskd instance is EXCLUDED rather
	// than merely tolerated: no duplicated work, no duplicated doorbells, no two
	// retention prunes interleaving.
	//
	// It is defence in depth and not the correctness argument. That rests on the
	// DETERMINISTIC materialization key (riskfeed's identity.go): two processes
	// computing the same materialization collide and the second adopts, which is
	// what actually protects a published large-step flag from being overwritten.
	// The lock is session-scoped and dies with its connection, so a partition can
	// still let a second instance in — which is precisely why correctness may not
	// depend on it. The lock coordinates are documented at
	// store.riskLockNamespace.
	releaseLock, err := s.AcquireRiskMaterializerLock(ctx)
	if err != nil {
		return err
	}
	defer releaseLock()

	slog.Info("riskd started",
		"poll_interval", cfg.PollInterval,
		"retention", cfg.Retention,
		"price_budget_seconds", cfg.Budget.Seconds,
		"price_ceiling_seconds", cfg.Budget.Ceiling(),
		"step_bps", cfg.StepBps,
		"scoped_role", scoped)

	var last watermarkVector
	first := true

	tick := func() error {
		res, err := runPass(ctx, s, cfg)
		if err != nil {
			return err
		}
		if res.Gated {
			// A gated pass is ORDINARY. It is logged at info, not error: the
			// chain is mid-rewind and the next tick will find it acked.
			slog.Info("risk pass gated (retryable)", "reason", res.GateErr, "vector", res.Vector.String())
			// The vector is NOT recorded as `last`: the pass produced no batch,
			// so the work is still owed and the next tick must still see a
			// change.
			return nil
		}
		last, first = res.Vector, false
		slog.Info("risk batch committed",
			"batch", res.BatchID, "positions", res.Positions,
			"refused", res.Refused, "flagged", res.Flagged, "vector", res.Vector.String())
		return nil
	}

	if once {
		return tick()
	}

	t := time.NewTicker(cfg.PollInterval)
	defer t.Stop()
	for {
		// The FIRST pass always runs: a restarted riskd has no in-memory
		// baseline, and skipping until something moves would leave the newest
		// batch stale for as long as the chain is quiet.
		if first {
			if err := tick(); err != nil {
				slog.Error("risk pass failed", "err", err)
			}
		} else {
			changed, vec, err := vectorChanged(ctx, s, cfg, last)
			if err != nil {
				slog.Error("watermark poll failed", "err", err)
			} else if changed {
				slog.Debug("watermark vector moved", "from", last.String(), "to", vec.String())
				if err := tick(); err != nil {
					slog.Error("risk pass failed", "err", err)
				}
			}
		}

		select {
		case <-ctx.Done():
			slog.Info("riskd stopping")
			return nil
		case <-t.C:
		}
	}
}

// vectorChanged reads the watermark vector and reports whether it moved.
//
// The read is its own `REPEATABLE READ, READ ONLY` transaction — the same shape
// `cmd/reconcile`'s readRecheckState uses — so the cursors and the epoch maxima
// come from one snapshot. Two autocommit statements could straddle a rewind and
// produce a vector no instant of the database ever held.
func vectorChanged(ctx context.Context, s *store.Store, cfg *daemonConfig, last watermarkVector) (bool, watermarkVector, error) {
	tx, err := s.BeginRiskSnapshot(ctx)
	if err != nil {
		return false, watermarkVector{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cursors, err := store.DeriveCursorStates(ctx, tx)
	if err != nil {
		return false, watermarkVector{}, err
	}
	maxEpochs, err := store.MaxReorgEpochs(ctx, tx)
	if err != nil {
		return false, watermarkVector{}, err
	}
	sweeps, err := store.RiskSweepStateFor(ctx, tx, cfg.sweptEngines())
	if err != nil {
		return false, watermarkVector{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, watermarkVector{}, fmt.Errorf("commit watermark poll: %w", err)
	}
	v := newWatermarkVector(cursors, maxEpochs, sweeps, cfg.consumedEngines())
	return v.Changed(last), v, nil
}

// requireSchema refuses to start against a database whose schema is not the one
// this binary's queries were written against.
//
// EQUALITY, NOT "AT LEAST". A lower database is missing tables these queries
// read; a HIGHER one may have reshaped them, and a materializer writing risk
// rows through queries that no longer describe the schema is how a wrong number
// gets a plausible shape. Same gate `cmd/reconcile` applies for the same reason.
func requireSchema(ctx context.Context, s *store.Store) error {
	want, err := store.ExpectedSchemaVersion()
	if err != nil {
		return err
	}
	got, err := store.SchemaVersion(ctx, s.Querier())
	if err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("riskd: database schema version %d, this binary expects %d — migrate (or deploy the matching build) before starting", got, want)
	}
	return nil
}
