package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
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
	// Per-walker error backoff (Phase 1 deferral): after backoffThreshold
	// consecutive erroring rounds a walker sits out backoffRounds rounds, so
	// one broken stream cannot dominate the loop with doomed retries.
	backoffThreshold = 3
	backoffRounds    = 5
)

// walkerState wraps a walker with its backoff bookkeeping.
type walkerState struct {
	w               *ingest.Walker
	consecutiveErrs int
	skipRounds      int
}

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
		walkers = append(walkers, &walkerState{w: ingest.NewWalker(clients[s.Chain], st, ingest.WalkerConfig{
			Stream:        s.Name,
			ChainID:       cfg.Chains[s.Chain].ChainID,
			Addresses:     s.Addresses,
			StartBlock:    s.StartBlock,
			Window:        s.Window,
			Confirmations: s.Confirmations,
		})})
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
				if ws.skipRounds > 0 {
					ws.skipRounds--
					continue
				}
				roundErred := false
				for i := 0; i < stepsPerRound; i++ {
					advanced, err := ws.w.Step(ctx)
					if err != nil {
						if errors.Is(err, context.Canceled) {
							slog.Info("shutting down", "stream", ws.w.Name())
						} else {
							slog.Error("step failed; will retry next round", "stream", ws.w.Name(), "err", err)
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
					ws.consecutiveErrs++
					if ws.consecutiveErrs >= backoffThreshold {
						ws.skipRounds = backoffRounds
						ws.consecutiveErrs = 0
						slog.Warn("walker backing off after repeated errors",
							"stream", ws.w.Name(), "rounds", backoffRounds)
					}
				} else {
					ws.consecutiveErrs = 0
				}
			}

			// Derivation pass: each runner handles any pending reorg epoch
			// (RewindDerived before further ApplyDerived) and derives bounded
			// windows.
			for _, r := range runners {
				for i := 0; i < stepsPerRound; i++ {
					advanced, err := r.Step(ctx)
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
					anyAdvanced = true
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

		// Housekeeping per tick: drop reorg epochs every engine has acked.
		if ctx.Err() == nil {
			if pruned, err := st.PruneAckedReorgEpochs(ctx); err != nil {
				slog.Error("prune acked reorg epochs failed; will retry next round", "err", err)
			} else if pruned > 0 {
				slog.Info("pruned fully-acknowledged reorg epochs", "rows", pruned)
			}
		}

		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
