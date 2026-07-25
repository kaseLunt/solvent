package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/derive"
	"github.com/kaselunt/solvent/internal/ingest"
	"github.com/kaselunt/solvent/internal/prices"
	"github.com/kaselunt/solvent/internal/snapshot"
	"github.com/kaselunt/solvent/internal/store"
)

func main() {
	configPath := flag.String("config", "config/contracts.json", "path to contracts config")
	feedsPath := flag.String("feeds", "recon/feeds.json", "path to the oracle feed registry")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *configPath, *feedsPath); err != nil {
		log.Error("indexer exited with error", "err", err)
		os.Exit(1)
	}
}

const (
	// stepsPerRound bounds how long one walker or runner may hold the loop: a
	// stream deep in backfill yields after this many windows so its siblings
	// keep making progress (fair round-robin instead of per-worker full drain).
	stepsPerRound = 5
	// Per-WORKER error backoff, TIME-based (fix wave: round counting was
	// burnable — a busy sibling keeps rounds spinning hot, so "skip N
	// rounds" could elapse in milliseconds). An erroring round schedules
	// the worker's next attempt by TIMESTAMP: exponential from
	// retryBackoffBase, capped at retryBackoffCap, with ±retryBackoffJitter
	// so parallel broken workers do not retry in lockstep. Shared by the
	// walkers and by Task 8's price workers (renamed from walkerBackoff when
	// the second user arrived — one implementation, not two).
	retryBackoffBase   = 30 * time.Second
	retryBackoffCap    = 10 * time.Minute
	retryBackoffJitter = 0.20
)

// retryBackoff schedules a worker's retries by next-attempt timestamp.
// ready() is state-free — a hot loop may poll it arbitrarily often without
// burning any of the delay — and only failure()/success() move state.
type retryBackoff struct {
	now      func() time.Time // injectable clock (tests)
	rand     func() float64   // uniform [0,1) jitter source (tests inject)
	failures int
	next     time.Time
}

// ready reports whether the worker may attempt work this round.
func (b *retryBackoff) ready() bool { return !b.now().Before(b.next) }

// failure records an erroring round and schedules the next attempt:
// base·2^(failures-1), capped, jittered ±retryBackoffJitter. Returns the
// chosen delay for logging.
func (b *retryBackoff) failure() time.Duration {
	b.failures++
	d := retryBackoffCap
	// Guarded shift: beyond a handful of doublings the cap always wins.
	if shift := b.failures - 1; shift < 10 {
		if scaled := retryBackoffBase << shift; scaled < retryBackoffCap {
			d = scaled
		}
	}
	d = time.Duration(float64(d) * (1 + retryBackoffJitter*(2*b.rand()-1)))
	b.next = b.now().Add(d)
	return d
}

// success resets the schedule after any non-erroring round.
func (b *retryBackoff) success() {
	b.failures = 0
	b.next = time.Time{}
}

// walkerState wraps a walker with its backoff bookkeeping.
type walkerState struct {
	w  *ingest.Walker
	bo retryBackoff
}

// priceWorker is the daemon's uniform handle on Task 8's two price ingestion
// workers — the oracle poller (*prices.Poller) and the Chainlink feed deriver
// (*prices.FeedDeriver).
//
// Conditions, not Health, is what the loop consumes: a worker reports NAMED
// conditions, so "this aggregator stopped publishing" and "our RPC/ingest path is
// frozen" reach the health surface as separate, separately-routable keys instead
// of being concatenated into one string an operator has to parse.
type priceWorker interface {
	Name() string
	Step(ctx context.Context) (bool, error)
	Conditions() []prices.Condition
}

// priceWorkerState wraps a price worker with its backoff bookkeeping. The
// poller additionally rate-limits itself by its own cadence; this backoff is
// the error-storm bound on top of that.
type priceWorkerState struct {
	w  priceWorker
	bo retryBackoff
	// lastErr is the most recent erroring round's error, retained so the health
	// surface can report an ordinary Step failure. It used to be logged and
	// dropped, which meant persistent apply failures were invisible to any
	// supervisor unless the worker's own health verdict happened to fail too.
	lastErr error
	// retryIn is the backoff delay chosen for lastErr, for the same report.
	retryIn time.Duration
}

// stepPriceWorkers runs ONE price pass over every price worker and rebuilds each
// worker's recoverable health entries. Returns whether any worker advanced.
//
// It exists as a separate function because this composition is what the review
// found untested and, in one respect, wrong: an ordinary Step error was logged
// and dropped, so a worker failing every round looked healthy to a supervisor
// unless its own condition set happened to fail too. The composition now is:
//
//   - step at most stepsPerRound times, stopping at the first error or at the
//     first non-advancing Step;
//   - a context cancellation is SHUTDOWN, not a failure: no backoff, no health
//     entry;
//   - any other error consumes one backoff unit and is recorded as the
//     step_error condition, alongside whatever the worker itself reports;
//   - conditions are read even while the worker is BACKING OFF — that is
//     precisely when the signal matters most, and skipping it would leave the
//     surface showing a pre-failure verdict for the whole backoff window;
//   - the entry set is REPLACED per worker, so recovery is visible.
func stepPriceWorkers(ctx context.Context, workers []*priceWorkerState, health *healthState) bool {
	anyAdvanced := false
	for _, ps := range workers {
		if ps.bo.ready() {
			roundErred := false
			var lastErr error
			for i := 0; i < stepsPerRound; i++ {
				advanced, err := ps.w.Step(ctx)
				if advanced {
					anyAdvanced = true
				}
				if err != nil {
					if errors.Is(err, context.Canceled) {
						slog.Info("shutting down", "worker", ps.w.Name())
					} else {
						slog.Error("price step failed; will retry after backoff", "worker", ps.w.Name(), "err", err)
						roundErred = true
						lastErr = err
					}
					break
				}
				if !advanced {
					break
				}
			}
			if roundErred {
				delay := ps.bo.failure()
				ps.lastErr, ps.retryIn = lastErr, delay
				slog.Warn("price worker backing off after error",
					"worker", ps.w.Name(), "retryIn", delay, "consecutive", ps.bo.failures)
			} else {
				ps.bo.success()
				ps.lastErr, ps.retryIn = nil, 0
			}
		}
		conditions := map[string]string{}
		for _, c := range ps.w.Conditions() {
			conditions[c.Name] = c.Reason
		}
		if ps.lastErr != nil {
			conditions[conditionStepError] = fmt.Sprintf("Step failed %d consecutive round(s), retrying in %s: %v",
				ps.bo.failures, ps.retryIn.Truncate(time.Second), ps.lastErr)
		}
		health.setWorkerConditions(ps.w.Name(), conditions)
	}
	return anyAdvanced
}

func run(ctx context.Context, configPath, feedsPath string) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	// The health surface comes up FIRST, before any dependency: a supervisor
	// needs a probe that answers while the daemon is still connecting, and a
	// bind failure must be fatal here rather than silently leaving the process
	// without a readiness signal.
	health := newHealthState(time.Now)
	if cfg.HealthAddr == "" {
		slog.Warn("health endpoint DISABLED by SOLVENT_HEALTH_ADDR=off: this process exposes no readiness or liveness probe, so a supervisor cannot see stale feeds, missing poll targets or persistent apply failures")
	} else {
		addr, shutdown, err := serveHealth(ctx, cfg.HealthAddr, health)
		if err != nil {
			return err
		}
		defer shutdown()
		slog.Info("health endpoint listening", "addr", addr,
			"readiness", "GET /readyz", "liveness", "GET /healthz", "detail", "GET /health")
	}
	// The oracle feed registry (recon/feeds.json) is loaded against the config's
	// chains, so a registry chain the config does not define fails fast here
	// rather than silently dropping that chain's prices.
	feeds, err := config.LoadFeeds(feedsPath, cfg.Chains)
	if err != nil {
		return err
	}
	slog.Info("feed registry loaded", "path", feedsPath, "assets", len(feeds.Assets))
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()
	// Enforce the single-writer contract before touching any state — even
	// migrations — so a second indexer process fails fast.
	if err := st.AcquireWriterLock(ctx); err != nil {
		return err
	}
	slog.Info("writer lock acquired")
	if err := store.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}

	clients := map[string]*chain.Failover{}
	for name, c := range cfg.Chains {
		fc, err := chain.Dial(ctx, c.RPCURLs)
		if err != nil {
			return err
		}
		if err := fc.VerifyChainID(ctx, c.ChainID); err != nil {
			return fmt.Errorf("chain %q: %w", name, err)
		}
		slog.Info("chain id verified", "chain", name, "chainId", c.ChainID)
		clients[name] = fc
	}

	var walkers []*walkerState
	for _, s := range cfg.Streams {
		walkers = append(walkers, &walkerState{
			w: ingest.NewWalker(clients[s.Chain], st, ingest.WalkerConfig{
				Stream:        s.Name,
				ChainID:       cfg.Chains[s.Chain].ChainID,
				Addresses:     s.Addresses,
				StartBlock:    s.StartBlock,
				Window:        s.Window,
				Confirmations: s.Confirmations,
			}),
			bo: retryBackoff{now: time.Now, rand: rand.Float64},
		})
		slog.Info("stream configured", "stream", s.Name, "start", s.StartBlock)
	}

	// Derivation runners + OP collateral snapshotter (Task 7). The engine
	// bindings come from the config's streams (address→engine mapping).
	specs, err := derive.BuildRunnerSpecs(cfg)
	if err != nil {
		return err
	}
	registry := decode.NewRegistry()

	// Snapshotter first: the debt_manager runner's post-rewind hook targets
	// it (a rewind may change the Safe registry, so it re-sweeps). The hook
	// is only the LIVE fast path — sweeps run on durable generations
	// (sweep_generations/snapshot_sweeps), RewindDerived bumps the generation
	// in its own transaction, and a restarted process resumes the open
	// generation's lagging set on its first Step.
	var snap *snapshot.Snapshotter
	for _, spec := range specs {
		if spec.Engine != "debt_manager" {
			continue
		}
		if len(spec.Addresses) != 1 {
			return fmt.Errorf("engine %q: expected exactly one contract address for the snapshotter target, got %d",
				spec.Engine, len(spec.Addresses))
		}
		snap, err = snapshot.New(st, clients[spec.Chain], snapshot.Config{
			Engine:   spec.Engine,
			Target:   common.BytesToAddress(spec.Addresses[0]),
			Interval: cfg.SnapshotInterval,
		})
		if err != nil {
			return err
		}
		slog.Info("collateral snapshotter configured", "engine", spec.Engine, "interval", cfg.SnapshotInterval)
	}

	var runners []*derive.Runner
	for _, spec := range specs {
		var eng derive.Engine
		var onRewind func()
		switch spec.Engine {
		case "debt_manager":
			// The DM deriver needs its own chain's calldata reads (migration
			// genesis seeds live in tx calldata, not logs).
			eng = derive.NewDebtManager(clients[spec.Chain])
			if snap != nil {
				onRewind = snap.TriggerResweep
			}
		case "aave_v3_etherfi":
			eng = derive.NewAaveEngine()
		case "chainlink_feed":
			// Price feeds are ingested raw; their derivation is Task 8's
			// prices.FeedDeriver, built below — it writes prices rows under its
			// own pseudo-engine cursor and holds no per-account state, so it is
			// deliberately not a derive.Engine. Skipped here on purpose.
			continue
		default:
			return fmt.Errorf("no deriver wired for engine %q", spec.Engine)
		}
		r, err := derive.NewRunner(st, registry, eng, spec, onRewind)
		if err != nil {
			return err
		}
		runners = append(runners, r)
		slog.Info("derivation runner configured", "engine", spec.Engine, "streams", len(spec.Streams))
	}

	// Price ingestion (Task 8): one POLLER per chain carrying registry poll
	// obligations (the engine-exact OP PriceProviderV2 assets, plus the ETH
	// weETH getRate() ratio), and one FEED DERIVER per chainlink_feed spec.
	// Chain keys are sorted so construction and log order are deterministic
	// across runs (Go map iteration is not).
	var priceWorkers []*priceWorkerState
	chainKeys := make([]string, 0, len(cfg.Chains))
	for name := range cfg.Chains {
		chainKeys = append(chainKeys, name)
	}
	sort.Strings(chainKeys)
	for _, name := range chainKeys {
		chainID := cfg.Chains[name].ChainID
		if len(feeds.PollAssets(chainID)) == 0 && len(feeds.RatioAssets(chainID)) == 0 {
			continue // nothing to poll on this chain
		}
		p, err := prices.NewPoller(st, clients[name], feeds, prices.PollerConfig{
			ChainID: chainID, Interval: cfg.PriceInterval,
		})
		if err != nil {
			return err
		}
		priceWorkers = append(priceWorkers, &priceWorkerState{
			w: p, bo: retryBackoff{now: time.Now, rand: rand.Float64},
		})
		slog.Info("oracle poller configured", "engine", p.Name(), "chain", name,
			"interval", cfg.PriceInterval, "sources", len(p.Sources()))
	}
	for _, spec := range specs {
		if spec.Engine != "chainlink_feed" {
			continue
		}
		fd, err := prices.NewFeedDeriver(st, registry, clients[spec.Chain], feeds, prices.FeedConfig{
			ChainID: spec.ChainID, Streams: spec.Streams,
			Addresses: spec.Addresses, StartBlock: spec.StartBlock, Window: spec.Window,
		})
		if err != nil {
			return err
		}
		priceWorkers = append(priceWorkers, &priceWorkerState{
			w: fd, bo: retryBackoff{now: time.Now, rand: rand.Float64},
		})
		// Staleness thresholds are PER FEED (each stream's own heartbeat + grace
		// from recon/feeds.json), so the startup log names them individually
		// rather than reporting one global number that applies to none of them.
		slog.Info("chainlink feed deriver configured", "engine", fd.Name(), "chain", spec.Chain,
			"streams", len(spec.Streams), "perFeedStaleness", fmt.Sprintf("%v", fd.Thresholds()))
	}

	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	for {
		for {
			anyAdvanced := false

			// Walker pass: ingestion first, so derivation sees the freshest
			// raw logs (and any rewind's reorg epoch) in the same round.
			for _, ws := range walkers {
				if !ws.bo.ready() {
					continue // backing off by timestamp; hot rounds burn nothing
				}
				roundErred := false
				for i := 0; i < stepsPerRound; i++ {
					advanced, err := ws.w.Step(ctx)
					if err != nil {
						if errors.Is(err, context.Canceled) {
							slog.Info("shutting down", "stream", ws.w.Name())
						} else {
							slog.Error("step failed; will retry after backoff", "stream", ws.w.Name(), "err", err)
							roundErred = true
						}
						break
					}
					if !advanced {
						break
					}
					anyAdvanced = true
				}
				if roundErred {
					delay := ws.bo.failure()
					slog.Warn("walker backing off after error",
						"stream", ws.w.Name(), "retryIn", delay, "consecutive", ws.bo.failures)
				} else {
					ws.bo.success()
				}
			}

			// Derivation pass: each runner handles any pending reorg epoch
			// (RewindDerived before further apply — mandatory even for an
			// unhealthy engine) and derives bounded windows.
			for _, r := range runners {
				for i := 0; i < stepsPerRound; i++ {
					advanced, err := r.Step(ctx)
					if advanced {
						// COUNT PROGRESS BEFORE ERRORS (M1): a Step can commit
						// its window and still error on the best-effort
						// snapshot flush — advanced=true means the cursor
						// moved and the loop must stay hot.
						anyAdvanced = true
					}
					if err != nil {
						if errors.Is(err, context.Canceled) {
							slog.Info("shutting down", "engine", r.Name())
						} else {
							slog.Error("derivation step failed; will retry next round", "engine", r.Name(), "err", err)
						}
						break
					}
					if !advanced {
						break
					}
				}
				if healthy, reason := r.Health(); !healthy {
					if first := health.setTerminal(r.Name(), reason); first {
						slog.Error("engine transitioned to UNHEALTHY: derivation gated (reorg repair still runs); restart after a capability upgrade to recover",
							"engine", r.Name(), "reason", reason)
					}
				}
			}

			// Snapshot pass: at most one multicall batch per round; a due
			// sweep keeps the loop hot until its generation completes. The
			// queue is durable — an error leaves it untouched for retry.
			if snap != nil {
				advanced, err := snap.Step(ctx)
				if err != nil {
					if errors.Is(err, context.Canceled) {
						slog.Info("shutting down", "worker", "snapshotter")
					} else {
						slog.Error("snapshot step failed; will retry next round", "err", err)
					}
				} else if advanced {
					anyAdvanced = true
				}
			}

			// Price pass: each price worker answers any pending reorg epoch
			// (RewindPrices before further apply) and then does one bounded unit
			// of work — the poller at most one cadence-due multicall round, the
			// feed deriver at most stepsPerRound windows of AnswerUpdated logs.
			// Extracted into its own function so the composition (step, backoff,
			// error reporting, condition rebuild) is unit-testable against fake
			// workers, which it previously was not.
			if stepPriceWorkers(ctx, priceWorkers, health) {
				anyAdvanced = true
			}

			health.heartbeat()
			if ctx.Err() != nil {
				break
			}
			// Advisory-lock liveness re-check per round (Phase 1 deferral):
			// a lost lock means another writer may be active — fatal.
			if err := st.CheckWriterLock(ctx); err != nil {
				return fmt.Errorf("writer-lock liveness check failed: %w", err)
			}
			if !anyAdvanced {
				break
			}
		}

		// Housekeeping per tick: drop reorg epochs every engine has acked, and
		// surface the composed health report once per tick round while anything
		// is wrong (a terminal transition itself was logged at Error). The log is
		// now a MIRROR of the queryable surface, not the surface itself.
		if ctx.Err() == nil {
			if pruned, err := st.PruneAckedReorgEpochs(ctx); err != nil {
				slog.Error("prune acked reorg epochs failed; will retry next tick", "err", err)
			} else if pruned > 0 {
				slog.Info("pruned fully-acknowledged reorg epochs", "rows", pruned)
			}
			if report := health.report(); !report.Ready {
				slog.Warn("daemon NOT READY (/readyz is failing): terminal entries need a restart at upgraded code; recoverable entries clear when the feed resumes, a round lands, or the dependency recovers",
					"status", report.Status, "live", report.Live, "loopAge", report.LoopAge,
					"terminal", fmt.Sprintf("%v", report.Terminal),
					"recoverable", fmt.Sprintf("%v", report.Recoverable))
			}
		}

		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
