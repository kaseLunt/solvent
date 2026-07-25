### Task 7: Wire `cmd/indexer` + live smoke against OP Mainnet

**Files:**
- Create: `config/contracts.json` (copied from recon output)
- Modify: `cmd/indexer/main.go` (replace the Task 2 stub entirely)

**Interfaces:**
- Consumes: `config.Load` (Task 3), `store.Open/Migrate` (Task 4), `chain.Dial` (Task 5), `ingest.NewWalker/Step` (Task 6).
- Produces: a running binary; real OP Mainnet Cash/Aave logs accumulating in Postgres. This is the phase's demo artifact.

- [ ] **Step 1: Copy the recon config into the product repo**

```bash
mkdir -p config
cp recon/contracts.json config/contracts.json
```
Review the copy: it must contain only verified addresses (Task 1 Step 8), no comments, valid JSON (`jq . config/contracts.json`).

- [ ] **Step 2: Replace `cmd/indexer/main.go`**

```go
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
```

- [ ] **Step 3: Build and vet**

Run: `go build ./... && go vet ./...`
Expected: clean.

- [ ] **Step 4: Live smoke — run the backfill for 10 minutes**

```bash
set -a && source .env && set +a
export TEST_DATABASE_URL="$SOLVENT_DATABASE_URL"
make db-up
go run ./cmd/indexer
```
Expected within minutes: `stream configured` lines, then cursor advancing (watch logs; no `step failed` spam — occasional RPC failovers are OK). Public RPCs rate-limit; if failover exhaustion recurs, sign up for a free Alchemy OP endpoint and prepend it to `SOLVENT_RPC_OP` in `.env`.

- [ ] **Step 5: Verify real data landed**

```bash
docker compose exec db psql -U solvent -c \
  "SELECT stream, last_block FROM ingest_cursors; SELECT count(*), min(block_number), max(block_number) FROM raw_logs;"
```
Expected: cursors past their start blocks and a nonzero, growing `raw_logs` count. Record the counts in the commit message.

- [ ] **Step 6: Commit**

```bash
git add cmd/indexer/main.go config/contracts.json
git commit -m "feat: wire indexer daemon; live OP Mainnet ingestion verified (<N> logs)"
```

---

