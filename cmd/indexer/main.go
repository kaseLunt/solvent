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
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/derive"
	"github.com/kaselunt/solvent/internal/ingest"
	"github.com/kaselunt/solvent/internal/snapshot"
	"github.com/kaselunt/solvent/internal/store"
)

func main() {
	configPath := flag.String("config", "config/contracts.json", "path to contracts config")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *configPath); err != nil {
		log.Error("indexer exited with error", "err", err)
		os.Exit(1)
	}
}

const (
	// stepsPerRound bounds how long one walker or runner may hold the loop: a
	// stream deep in backfill yields after this many windows so its siblings
	// keep making progress (fair round-robin instead of per-worker full drain).
	stepsPerRound = 5
	// Per-walker error backoff, TIME-based (fix wave: round counting was
	// burnable — a busy sibling keeps rounds spinning hot, so "skip N
	// rounds" could elapse in milliseconds). An erroring round schedules
	// the walker's next attempt by TIMESTAMP: exponential from
	// walkerBackoffBase, capped at walkerBackoffCap, with ±walkerBackoffJitter
	// so parallel broken streams do not retry in lockstep.
	walkerBackoffBase   = 30 * time.Second
	walkerBackoffCap    = 10 * time.Minute
	walkerBackoffJitter = 0.20
)

// walkerBackoff schedules a walker's retries by next-attempt timestamp.
// ready() is state-free — a hot loop may poll it arbitrarily often without
// burning any of the delay — and only failure()/success() move state.
type walkerBackoff struct {
	now      func() time.Time // injectable clock (tests)
	rand     func() float64   // uniform [0,1) jitter source (tests inject)
	failures int
	next     time.Time
}

// ready reports whether the walker may attempt work this round.
func (b *walkerBackoff) ready() bool { return !b.now().Before(b.next) }

// failure records an erroring round and schedules the next attempt:
// base·2^(failures-1), capped, jittered ±walkerBackoffJitter. Returns the
// chosen delay for logging.
func (b *walkerBackoff) failure() time.Duration {
	b.failures++
	d := walkerBackoffCap
	// Guarded shift: beyond a handful of doublings the cap always wins.
	if shift := b.failures - 1; shift < 10 {
		if scaled := walkerBackoffBase << shift; scaled < walkerBackoffCap {
			d = scaled
		}
	}
	d = time.Duration(float64(d) * (1 + walkerBackoffJitter*(2*b.rand()-1)))
	b.next = b.now().Add(d)
	return d
}

// success resets the schedule after any non-erroring round.
func (b *walkerBackoff) success() {
	b.failures = 0
	b.next = time.Time{}
}

// walkerState wraps a walker with its backoff bookkeeping.
type walkerState struct {
	w  *ingest.Walker
	bo walkerBackoff
}

// engineHealth is the daemon's package-level health map: engine → the
// terminal unhealthy reason ((*derive.Runner).Health). Entries only ever
// appear (no in-process recovery — a restart after a capability upgrade is
// the documented recovery path, since all state is durable and the restarted
// process re-derives the refusing window with the upgraded deriver). While
// non-empty, the daemon logs a DEGRADED summary once per tick round.
var engineHealth = map[string]string{}

func run(ctx context.Context, configPath string) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
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
			bo: walkerBackoff{now: time.Now, rand: rand.Float64},
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
	// it (a rewind may change the Safe registry, so it re-sweeps).
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
			// Price feeds are ingested raw; price derivation is Task 8's
			// poller, not a derive.Engine. Deliberate skip.
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
			// sweep keeps the loop hot until it completes.
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
		}

		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
