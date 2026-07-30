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
	"sync/atomic"
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

	// clockSkewNanos is added to the DATABASE clock the pass judges freshness
	// against.
	//
	// It is zero in production and exists only so tests can move a price across a
	// freshness boundary DETERMINISTICALLY. The alternative — seeding an as-of a
	// couple of seconds in the past and racing to assert before it expires — is
	// unsound: a loaded PostgreSQL or a scheduler hiccup consumes the window and
	// the test flaps. Time is the variable under test, so it has to be an input.
	//
	// It is an ATOMIC and reached through skew()/setSkew() because the scheduler
	// tests must advance it while runLoop is RUNNING. That is not a convenience:
	// arming-on-freshness can only be observed inside ONE continuous loop, since
	// restarting the loop fires its mandatory startup pass and would produce a new
	// batch whether the freshness arm exists or not. A plain field would be a data
	// race between the test and the loop goroutine.
	//
	// # IT IS A VALUE, NOT A POINTER, AND THAT IS THE FIX FOR A REAL RACE
	//
	// This was `*atomic.Int64` with setSkew lazily allocating it on first use. The
	// comment above claimed atomicity and was true of the VALUE — and beside the
	// point, because the race was ONE INDIRECTION HIGHER: setSkew's
	// `c.clockSkewNanos = &atomic.Int64{}` WROTE THE POINTER FIELD while the loop
	// goroutine READ that same field through skew()'s nil check. Atomic contents do
	// not make the reference to them atomic. The repo's first-ever `go test -race`
	// run caught it in both scheduler-arming tests.
	//
	// A value field has no initializing write to race with: the zero value is
	// already usable, so setSkew only ever Stores and skew() only ever Loads. The
	// class of bug is closed by construction rather than by careful ordering.
	//
	// It also makes `daemonConfig` non-copyable (go vet copylocks), which is a
	// second correctness win the fixtures now honour: a wholesale struct copy of a
	// config was silently SHARING one clock between what the tests treated as two
	// independent daemons.
	//
	// Unexported, so no configuration path can set it and production cannot reach a
	// non-zero value.
	clockSkewNanos atomic.Int64
}

// skew returns the test-only clock offset, zero when unset.
func (c *daemonConfig) skew() time.Duration {
	if c == nil {
		return 0
	}
	return time.Duration(c.clockSkewNanos.Load())
}

// setSkew moves the effective clock. Safe to call while runLoop is running: it is
// a pure Store against an already-usable zero value, with no initializing write.
func (c *daemonConfig) setSkew(d time.Duration) {
	c.clockSkewNanos.Store(int64(d))
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

// engineGenesisBlock is the lowest StartBlock across every stream of `engine` —
// the block its derived history begins at.
//
// Returning 0 when the engine has no configured stream is deliberate and is NOT a
// "no requirement" sentinel: store.CoverageProvenBack refuses a zero genesis, so a
// misconfigured engine makes the flag-custody gate REFUSE rather than pass. That is
// the fail-closed direction for a gate whose whole job is to withhold a book whose
// provenance cannot be established.
func engineGenesisBlock(cfg *config.Config, engine string) uint64 {
	var lowest uint64
	for _, s := range cfg.Streams {
		if s.Engine != engine {
			continue
		}
		if lowest == 0 || s.StartBlock < lowest {
			lowest = s.StartBlock
		}
	}
	return lowest
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
		// The collateral-flag ledger is the Aave engine's OWN position_events, so
		// it is bounded by that engine's cursor — the same block the balances it
		// governs were folded to. A flag read above it would judge the two halves
		// of one position at two different blocks.
		spec.CollateralFlagEngine = c.Aave.Engine
		spec.CollateralFlagChain = c.Aave.ChainID
		spec.CollateralFlagBlock = cur.LastBlock
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
			// Read from the SAME config the walker walks from, never a literal: the
			// flag-custody gate asks whether derived state was walked from this block,
			// so a hard-coded copy that drifted from contracts.json would silently
			// change the bar the gate applies. engineGenesisBlock refuses to guess.
			GenesisBlock: engineGenesisBlock(cfg, risk.AaveEngine),
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

	if once {
		_, err := riskTick(ctx, s, cfg, nil)
		return err
	}
	return runLoop(ctx, s, cfg)
}

// loopState is the poll loop's carried state: the vector the last batch was
// materialized at, and the next freshness boundary it is waiting on.
type loopState struct {
	last watermarkVector
	// first forces the mandatory startup pass: a restarted riskd has no in-memory
	// baseline, and skipping until something moves would leave the newest batch
	// standing for as long as the chain is quiet.
	first bool
	// freshnessDeadline is the earliest instant at which one of the last batch's
	// JUDGED prices crosses a freshness boundary. Zero means none will.
	freshnessDeadline time.Time
}

// riskTick runs one pass and folds its result into the loop state.
func riskTick(ctx context.Context, s *store.Store, cfg *daemonConfig, st *loopState) (passResult, error) {
	res, err := runPass(ctx, s, cfg)
	if err != nil {
		return res, err
	}
	if res.Gated {
		// A gated pass is ORDINARY. It is logged at info, not error: the chain is
		// mid-rewind and the next tick will find it acked. The vector is NOT
		// recorded, so the work stays owed.
		slog.Info("risk pass gated (retryable)", "reason", res.GateErr, "vector", res.Vector.String())
		return res, nil
	}
	if st != nil {
		st.last, st.first = res.Vector, false
		st.freshnessDeadline = res.FreshnessDeadline
	}
	slog.Info("risk batch committed",
		"batch", res.BatchID, "positions", res.Positions,
		"refused", res.Refused, "flagged", res.Flagged,
		"key", res.MaterializationKey, "freshness_deadline", res.FreshnessDeadline,
		"vector", res.Vector.String())
	return res, nil
}

// runLoop is the steady-state scheduler, extracted from run so a test can drive
// the REAL loop rather than calling runPass by hand.
//
// That distinction turned out to matter. The freshness-crossing test used to invoke
// runPass directly after sleeping, which passes happily while the production loop
// never fires at all — the very bug it was meant to guard. A scheduler property has
// to be tested through the scheduler.
func runLoop(ctx context.Context, s *store.Store, cfg *daemonConfig) error {
	st := &loopState{first: true}

	t := time.NewTicker(cfg.PollInterval)
	defer t.Stop()
	for {
		switch {
		case st.first:
			if _, err := riskTick(ctx, s, cfg, st); err != nil {
				slog.Error("risk pass failed", "err", err)
			}
		default:
			changed, vec, dbNow, err := pollTrigger(ctx, s, cfg, st.last)
			switch {
			case err != nil:
				slog.Error("watermark poll failed", "err", err)
			case changed:
				slog.Debug("watermark vector moved", "from", st.last.String(), "to", vec.String())
				if _, err := riskTick(ctx, s, cfg, st); err != nil {
					slog.Error("risk pass failed", "err", err)
				}
			case freshnessDue(st.freshnessDeadline, dbNow):
				// NOTHING IN THE VECTOR MOVED — a price simply aged past a
				// boundary. This is the honest-outage case: ingestion stopped
				// while prices were fresh, so no cursor, epoch or sweep state
				// changes as inputs cross the budget and then the ceiling.
				// Forcing the pass here is what turns a standing "fresh" verdict
				// into a G4 flag and then a G1 refusal.
				slog.Info("freshness boundary reached; forcing a pass",
					"deadline", st.freshnessDeadline, "db_now", dbNow)
				if _, err := riskTick(ctx, s, cfg, st); err != nil {
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

// freshnessDue reports whether the armed freshness boundary has been reached,
// measured on the DATABASE clock like every other age in this system.
func freshnessDue(deadline, dbNow time.Time) bool {
	return !deadline.IsZero() && !dbNow.Before(deadline)
}

// pollTrigger reads the watermark vector plus the database clock, and reports
// whether the vector moved.
//
// The read is its own `REPEATABLE READ, READ ONLY` transaction — the same shape
// `cmd/reconcile`'s readRecheckState uses — so the cursors and the epoch maxima
// come from one snapshot. Two autocommit statements could straddle a rewind and
// produce a vector no instant of the database ever held.
func pollTrigger(ctx context.Context, s *store.Store, cfg *daemonConfig, last watermarkVector) (bool, watermarkVector, time.Time, error) {
	tx, err := s.BeginRiskSnapshot(ctx)
	if err != nil {
		return false, watermarkVector{}, time.Time{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var dbNow time.Time
	if err := tx.QueryRow(ctx, "SELECT now()").Scan(&dbNow); err != nil {
		return false, watermarkVector{}, time.Time{}, fmt.Errorf("read poll clock: %w", err)
	}
	cursors, err := store.DeriveCursorStates(ctx, tx)
	if err != nil {
		return false, watermarkVector{}, time.Time{}, err
	}
	maxEpochs, err := store.MaxReorgEpochs(ctx, tx)
	if err != nil {
		return false, watermarkVector{}, time.Time{}, err
	}
	sweeps, err := store.RiskSweepStateFor(ctx, tx, cfg.sweptEngines())
	if err != nil {
		return false, watermarkVector{}, time.Time{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, watermarkVector{}, time.Time{}, fmt.Errorf("commit watermark poll: %w", err)
	}
	v := newWatermarkVector(cursors, maxEpochs, sweeps, cfg.consumedEngines())
	// The SAME skew the pass applies, so an armed deadline and the clock that
	// judges it cannot disagree.
	return v.Changed(last), v, dbNow.UTC().Add(cfg.skew()), nil
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
