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
// (*prices.FeedDeriver). Both expose the same Step/Health/Name shape as the
// derivation runners, so the loop treats them identically.
type priceWorker interface {
	Name() string
	Step(ctx context.Context) (bool, error)
	Health() (healthy bool, reason string)
}

// priceWorkerState wraps a price worker with its backoff bookkeeping. The
// poller additionally rate-limits itself by its own cadence; this backoff is
// the error-storm bound on top of that.
type priceWorkerState struct {
	w  priceWorker
	bo retryBackoff
}

// engineHealth is the daemon's package-level health map: engine → the
// terminal unhealthy reason ((*derive.Runner).Health). Entries only ever
// appear (no in-process recovery — a restart after a capability upgrade is
// the documented recovery path, since all state is durable and the restarted
// process re-derives the refusing window with the upgraded deriver). While
// non-empty, the daemon logs a DEGRADED summary once per tick round.
var engineHealth = map[string]string{}

// priceHealth is the price workers' health view, and is deliberately NOT
// engineHealth: a stale Chainlink stream or a poller that has missed its
// cadence grace window is RECOVERABLE — a resumed feed or a landed round clears
// it — whereas engineHealth records TERMINAL capability errors that only a
// restart resolves. It is therefore REBUILT from scratch each tick rather than
// accumulated, so recovery is actually visible in the log.
var priceHealth = map[string]string{}

func run(ctx context.Context, configPath, feedsPath string) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
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
			Staleness: cfg.FeedStaleness,
		})
		if err != nil {
			return err
		}
		priceWorkers = append(priceWorkers, &priceWorkerState{
			w: fd, bo: retryBackoff{now: time.Now, rand: rand.Float64},
		})
		slog.Info("chainlink feed deriver configured", "engine", fd.Name(), "chain", spec.Chain,
			"streams", len(spec.Streams), "staleness", cfg.FeedStaleness)
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
					if _, seen := engineHealth[r.Name()]; !seen {
						slog.Error("engine transitioned to UNHEALTHY: derivation gated (reorg repair still runs); restart after a capability upgrade to recover",
							"engine", r.Name(), "reason", reason)
					}
					engineHealth[r.Name()] = reason
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
			// Health is REBUILT each round, not accumulated: a stale feed that
			// resumes, or a poller that lands a round, is genuinely healthy again.
			for _, ps := range priceWorkers {
				if ps.bo.ready() {
					roundErred := false
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
							}
							break
						}
						if !advanced {
							break
						}
					}
					if roundErred {
						delay := ps.bo.failure()
						slog.Warn("price worker backing off after error",
							"worker", ps.w.Name(), "retryIn", delay, "consecutive", ps.bo.failures)
					} else {
						ps.bo.success()
					}
				}
				// Health is read even while the worker is BACKING OFF — that is
				// precisely when the DEGRADED signal matters most, and skipping
				// it would leave the map showing a pre-failure verdict for as
				// long as the backoff lasts.
				if healthy, reason := ps.w.Health(); !healthy {
					priceHealth[ps.w.Name()] = reason
				} else {
					delete(priceHealth, ps.w.Name())
				}
			}

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

		// Housekeeping per tick: drop reorg epochs every engine has acked,
		// and surface degraded engine health once per tick round while any
		// engine is unhealthy (the transition itself was logged at Error).
		if ctx.Err() == nil {
			if pruned, err := st.PruneAckedReorgEpochs(ctx); err != nil {
				slog.Error("prune acked reorg epochs failed; will retry next tick", "err", err)
			} else if pruned > 0 {
				slog.Info("pruned fully-acknowledged reorg epochs", "rows", pruned)
			}
			if len(engineHealth) > 0 {
				slog.Warn("daemon DEGRADED: unhealthy engines (derivation gated; restart after a capability upgrade to recover)",
					"engines", fmt.Sprintf("%v", engineHealth))
			}
			if len(priceHealth) > 0 {
				// RECOVERABLE, unlike engineHealth: this warning stops once the
				// stale stream publishes again or the poller lands a round.
				slog.Warn("daemon DEGRADED: price ingestion unhealthy (recoverable — clears when the feed resumes or a poll round lands)",
					"workers", fmt.Sprintf("%v", priceHealth))
			}
		}

		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
