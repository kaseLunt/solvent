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

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/ingest"
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

	var walkers []*ingest.Walker
	for _, s := range cfg.Streams {
		walkers = append(walkers, ingest.NewWalker(clients[s.Chain], st, ingest.WalkerConfig{
			Stream:        s.Name,
			ChainID:       cfg.Chains[s.Chain].ChainID,
			Addresses:     s.Addresses,
			StartBlock:    s.StartBlock,
			Window:        s.Window,
			Confirmations: s.Confirmations,
		}))
		slog.Info("stream configured", "stream", s.Name, "start", s.StartBlock)
	}

	// stepsPerRound bounds how long one walker may hold the loop: a stream
	// deep in backfill yields after this many windows so its siblings keep
	// making progress (fair round-robin instead of per-walker full drain).
	const stepsPerRound = 5

	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	for {
		for {
			anyAdvanced := false
			for _, w := range walkers {
				for i := 0; i < stepsPerRound; i++ {
					advanced, err := w.Step(ctx)
					if err != nil {
						if errors.Is(err, context.Canceled) {
							slog.Info("shutting down", "stream", w.Name())
						} else {
							slog.Error("step failed; will retry next tick", "stream", w.Name(), "err", err)
						}
						break
					}
					if !advanced {
						break
					}
					anyAdvanced = true
				}
			}
			if !anyAdvanced || ctx.Err() != nil {
				break
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
