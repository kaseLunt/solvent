package main

import (
	"context"
	"flag"
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
	if err := store.Migrate(cfg.DatabaseURL); err != nil {
		return err
	}
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	clients := map[string]*chain.Failover{}
	for name, c := range cfg.Chains {
		fc, err := chain.Dial(ctx, c.RPCURLs)
		if err != nil {
			return err
		}
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

	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	for {
		for _, w := range walkers {
			for {
				advanced, err := w.Step(ctx)
				if err != nil {
					slog.Error("step failed; will retry next tick", "err", err)
					break
				}
				if !advanced {
					break
				}
				if ctx.Err() != nil {
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
