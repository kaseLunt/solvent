# Solvent Phase 1: Recon + Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify on-chain that ether.fi Cash positions are reconstructible (GO/NO-GO gate), then build the foundation: a reorg-safe Go indexer ingesting real OP Mainnet logs into PostgreSQL, with CI green.

**Architecture:** Single Go module with per-service entrypoints under `cmd/` (indexer now; riskd/api/alerter in later plans) and shared packages under `internal/`. The spec's five deployable units map to four `cmd/` binaries + `web/` — one Docker image per binary at deploy time. Raw logs land in Postgres keyed `(chain_id, tx_hash, log_index)`; positions are derived state in Plan 2, always rebuildable from this event log.

**Tech Stack:** Go ≥ 1.24, go-ethereum (ethclient), pgx/v5, goose/v3 (embedded migrations), testify, PostgreSQL 16 (Docker Compose), Foundry `cast` (recon), GitHub Actions.

**Plan series:** This is Plan 1 of 5. Plans 2–5 (§Roadmap, end of this document) are written after this plan's gate passes, because their contents depend on recon output and live data shapes.

## Global Constraints

- **Product root:** `C:\Users\kasel\source\repos\etherfi\Solvent` — a SELF-CONTAINED git repository (branch `main`). The parent `/etherfi` folder is NOT ours to touch: no file writes, no git operations outside `Solvent/`. Future sibling projects get their own folders/repos. All file paths below are relative to `Solvent/`, and all shell commands run from it. Public-ready from day one: no secrets ever committed, `.env` gitignored, conventional-commit messages, small commits (the commit history is itself a hiring artifact). Plan 5's public flip is just `gh repo create` + push — no history surgery needed.
- **Planning artifacts** live inside the repo: specs/plans under `docs/`, recon under `recon/` (clones gitignored), SDD scratch under `.superpowers/` (gitignored).
- **Go module path:** `github.com/kaselunt/solvent` — adjust in Task 2 Step 2 if the GitHub handle differs; it appears nowhere else by hand (imports follow the module path).
- **Dependencies (Go):** go-ethereum, jackc/pgx/v5, pressly/goose/v3, stretchr/testify. Nothing else without a plan change. No ORM.
- **Env var names (exact, used across all plans):** `SOLVENT_DATABASE_URL`, `SOLVENT_RPC_OP` (comma-separated URLs, failover order), `SOLVENT_RPC_ETH`, `SOLVENT_POLL_INTERVAL` (Go duration, default `5s`).
- **Quality gates every task:** `gofmt -l .` empty, `go vet ./...` clean, `go test ./...` green before each commit.
- **Commits:** conventional style (`feat:`, `test:`, `chore:`, `docs:`), no Co-Authored-By lines.
- **Shell:** commands are Git Bash syntax (this machine is Windows; `/c/Users/kasel/...` paths in shell, backslash paths only inside Windows-native tools).
- **Numbers from chain:** store as `NUMERIC`/`BYTEA` in Postgres and `*big.Int`/`[]byte` in Go. Never float, never int64 for wei.

## Parallelization map

- Task 0 → Task 1 → **GATE** → Task 2 → {Task 3, Task 4, Task 5 in parallel} → Task 6 → Task 7 → Task 8.
- Tasks 3 (config), 4 (store), 5 (chain) share no files and may run as three parallel workers after Task 2 lands.

---

### Task 0: Toolchain preflight

**Files:**
- None created (verification only).

**Interfaces:**
- Consumes: nothing.
- Produces: a machine verified to run every later task.

- [ ] **Step 1: Verify Go ≥ 1.24**

Run: `go version`
Expected: `go version go1.24` or higher. If missing: install from https://go.dev/dl/ and re-run.

- [ ] **Step 2: Verify Docker + Compose**

Run: `docker --version && docker compose version`
Expected: both print versions. If missing: install Docker Desktop.

- [ ] **Step 3: Verify Foundry (cast) — needed for recon**

Run: `cast --version`
Expected: `cast 1.x` or similar. If missing: `curl -L https://foundry.paradigm.xyz | bash && foundryup`, then re-run.

- [ ] **Step 4: Verify git + jq + curl**

Run: `git --version && jq --version && curl --version | head -1`
Expected: three version lines. `jq` missing on Windows: `winget install jqlang.jq`.

---

### Task 1: Day-0 recon spike (GO/NO-GO gate)

Everything below verifies the spec's §1 research against the actual chain. Work happens under `recon/` inside the Solvent repo (clones gitignored). ~Half a day.

**Files:**
- Create: `recon/report.md`
- Create: `recon/contracts.json`
- Create: `recon/abis/` (directory of ABI JSON files)

**Interfaces:**
- Consumes: public chain + GitHub.
- Produces: `recon/contracts.json` matching the schema in Step 8 (consumed verbatim by Task 3's config loader and Task 7's live config); `recon/abis/*.json` (consumed by Plan 2's decoder); `recon/report.md` with a GO/Fallback-GO/NO-GO decision.

- [ ] **Step 1: Clone the two source-of-truth repos (shallow)**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
mkdir -p recon/abis
git clone --depth 1 https://github.com/etherfi-protocol/cash-v3 recon/cash-v3
git clone --depth 1 https://github.com/etherfi-protocol/DefiLlama-Adapters recon/DefiLlama-Adapters
```
Expected: both clones succeed. If `cash-v3` does not exist under that org name, list the org's repos (`curl -s https://api.github.com/orgs/etherfi-protocol/repos?per_page=100 | jq -r '.[].name'`) and clone the Cash contracts repo found there; record the actual name in `report.md`.

- [ ] **Step 2: Extract deployed OP Mainnet addresses from cash-v3**

```bash
grep -riE "0x[0-9a-fA-F]{40}" recon/cash-v3/deployments/ | head -50
ls recon/cash-v3/deployments/
```
Expected: a deployments directory (or `broadcast/`, or a `docs/`/README address table) yielding the Debt Manager / Cash core addresses on chain 10. Record every address + its label in `report.md`. If no deployments dir exists, extract addresses from the repo README and ether.fi gitbook "Deployed contracts" page; cross-check both.

- [ ] **Step 3: Find the Aave EtherFi Market addresses**

```bash
grep -riE "etherfi|ether.fi" recon/DefiLlama-Adapters/projects/ --include="*.js" -l
# then inspect each hit:
grep -oE "0x[0-9a-fA-F]{40}" <each-hit-file> | sort -u
curl -s https://api.llama.fi/protocol/etherfi-borrowing-market | jq '.currentChainTvls'
```
Expected: the Aave v3 EtherFi instance's Pool/PoolAddressesProvider addresses. Cross-check against bgd-labs address book: `curl -s https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3EthereumEtherFi.sol 2>/dev/null | head -40` (and probe for an OP/instance variant by listing `https://api.github.com/repos/bgd-labs/aave-address-book/contents/src`). Record addresses + which chain each lives on.

- [ ] **Step 4: Verify every address has code on-chain**

```bash
export OP_RPC=https://mainnet.optimism.io
export ETH_RPC=https://eth.llamarpc.com
# for each OP address from Steps 2-3:
cast code <ADDRESS> --rpc-url $OP_RPC | cut -c1-20
```
Expected: each prints bytecode (`0x6080...`), NOT `0x`. Any `0x` result → wrong address or wrong chain; resolve before continuing and note the correction in `report.md`.

- [ ] **Step 5: Verify Aave position-reconstruction path**

```bash
# Pool discovery (if you found the AddressesProvider rather than the Pool):
cast call <ADDRESSES_PROVIDER> "getPool()(address)" --rpc-url $OP_RPC
# Reserve list:
cast call <POOL> "getReservesList()(address[])" --rpc-url $OP_RPC
# Find one real borrower: pull a recent Borrow event, then:
cast logs --rpc-url $OP_RPC --address <POOL> --from-block $(( $(cast block-number --rpc-url $OP_RPC) - 50000 )) "Borrow(address,address,address,uint256,uint8,uint256,uint16)" | head -40
cast call <POOL> "getUserAccountData(address)(uint256,uint256,uint256,uint256,uint256,uint256)" <BORROWER_FROM_LOG> --rpc-url $OP_RPC
```
Expected: reserve list returns ≥ 5 assets; `getUserAccountData` returns nonzero collateral/debt/healthFactor for a real borrower. Record the borrower address as the first golden-vector sample. **This proves the Aave engine is reconstructible.**

- [ ] **Step 6: Verify Debt Manager event coverage**

```bash
# Build ABIs from source:
cd recon/cash-v3 && forge build 2>&1 | tail -3 && cd ../..
# List event signatures the Debt Manager emits:
jq -r '.abi[] | select(.type=="event") | .name + "(" + ([.inputs[].type] | join(",")) + ")"' recon/cash-v3/out/DebtManagerCore.sol/*.json 2>/dev/null
# If the artifact path differs, find it: find recon/cash-v3/out -name "*.json" | xargs grep -l '"type": *"event"' | head
# Sample live emission volume over ~1 day of blocks:
cast logs --rpc-url $OP_RPC --address <DEBT_MANAGER> --from-block $(( $(cast block-number --rpc-url $OP_RPC) - 43200 )) | grep -c "blockNumber"
```
Expected: an event set covering the borrow lifecycle (names resembling Borrowed/Repaid/CollateralAdded/Liquidated — record the exact list), and nonzero recent emissions. Copy each relevant ABI: `cp recon/cash-v3/out/<Artifact>.sol/<Artifact>.json recon/abis/`. **This proves (or disproves) the Debt Manager engine.**

- [ ] **Step 7: Check the Aave V4 instance and the subgraph**

```bash
# V4 whitelabel: search the governance proposal's payload/addresses if executed:
curl -s "https://api.llama.fi/protocols" | jq -r '.[] | select(.name | test("ether|EtherFi"; "i")) | .name + " | " + .chain'
```
Expected outcome recorded either way: V4 instance live (add its addresses) or not yet (Observatory launches in single-engine + "cutover pending" mode — spec §6 degradation, already designed for). Also record whether ether.fi's public subgraph (`etherfi-v2-main`, Graph Studio) covers Cash/lending (research says it indexes validators/operators only — confirm, then ignore it if so).

- [ ] **Step 8: Write `recon/contracts.json`**

Exact schema (this file is Task 3's config-format contract — field names are load-bearing):

```json
{
  "chains": {
    "op":  { "chainId": 10, "rpcEnv": "SOLVENT_RPC_OP" },
    "eth": { "chainId": 1,  "rpcEnv": "SOLVENT_RPC_ETH" }
  },
  "streams": [
    {
      "name": "op:debt-manager",
      "chain": "op",
      "engine": "debt_manager",
      "addresses": ["0xVERIFIED_FROM_STEP_2"],
      "startBlock": 118000000,
      "window": 2000,
      "confirmations": 5
    },
    {
      "name": "op:aave-etherfi",
      "chain": "op",
      "engine": "aave_v3_etherfi",
      "addresses": ["0xPOOL_FROM_STEP_3"],
      "startBlock": 118000000,
      "window": 2000,
      "confirmations": 5
    }
  ]
}
```
Every `0x…` value and `startBlock` must be a real verified value from Steps 2–6 (`startBlock` = each contract's deployment block, found via the deployments artifacts or the contract's first tx on the OP explorer). No placeholder values may survive this step.

- [ ] **Step 9: Write `recon/report.md` and decide the gate**

Structure: `## Addresses (verified)` table (label, chain, address, deploy block, code-verified ✔) · `## Event coverage` per engine (exact event signature list + observed volume) · `## Aave V4 status` · `## Golden-vector sample` (borrower address + `getUserAccountData` output at block N) · `## Decision` — one of:
  - **GO** — both engines reconstructible → proceed, full spec.
  - **Fallback GO** — Aave only → proceed; drop the `op:debt-manager` stream from `contracts.json`; Observatory in single-engine mode (spec §6).
  - **NO-GO** — neither → stop; return to idea selection with findings (spec §8 marks this unlikely).

- [ ] **Step 10: Commit (planning repo) and STOP for user review**

```bash
git add recon/report.md recon/contracts.json recon/abis/
git commit -m "docs: Day-0 recon — addresses, event coverage, gate decision"
```
**HARD GATE: present `report.md` to the user. Do not start Task 2 until the user confirms the GO/Fallback-GO decision.** (`recon/cash-v3` and `recon/DefiLlama-Adapters` clones are already gitignored.)

---

### Task 2: Product folder scaffold + CI

**Files:**
- Create: `go.mod`, `.env.example`, `LICENSE`, `README.md`, `Makefile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `cmd/indexer/main.go` (stub)
- Modify: `.gitignore` (exists from repo init)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: module path `github.com/kaselunt/solvent`; `make db-up|db-down|test|fmt`; CI that runs gofmt/vet/test with a Postgres service; local Postgres at `postgres://solvent:solvent@localhost:5432/solvent`.

- [ ] **Step 1: Confirm you are in the Solvent repo (already initialized, branch `main`)**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent && git rev-parse --show-toplevel
```
Expected: prints the Solvent path itself (NOT the parent). Never run git commands that resolve to the parent folder.

- [ ] **Step 2: Initialize the Go module**

```bash
go mod init github.com/kaselunt/solvent
```
(Adjust the handle here and nowhere else if needed.)

- [ ] **Step 3: Write `.gitignore`, `.env.example`, `LICENSE`, `README.md`**

`.gitignore`:
```
.env
*.exe
/bin/
coverage.out
```

`.env.example`:
```
SOLVENT_DATABASE_URL=postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable
SOLVENT_RPC_OP=https://mainnet.optimism.io
SOLVENT_RPC_ETH=https://eth.llamarpc.com
SOLVENT_POLL_INTERVAL=5s
```

`LICENSE`: MIT, copyright 2026 Kase Lunt (standard MIT text).

`README.md` (stub — the real landing page is Plan 5):
```markdown
# Solvent

Real-time solvency companion for ether.fi Cash borrowers. Work in progress.

## Dev

    cp .env.example .env
    make db-up
    make test
```

- [ ] **Step 4: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: solvent
      POSTGRES_PASSWORD: solvent
      POSTGRES_DB: solvent
    ports:
      - "5432:5432"
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U solvent"]
      interval: 2s
      timeout: 2s
      retries: 15
volumes:
  dbdata:
```

- [ ] **Step 5: Write `Makefile`**

```makefile
.PHONY: db-up db-down test fmt vet run-indexer

db-up:
	docker compose up -d db && docker compose exec db sh -c 'until pg_isready -U solvent; do sleep 1; done'

db-down:
	docker compose down

test:
	go test ./...

fmt:
	gofmt -l .

vet:
	go vet ./...

run-indexer:
	go run ./cmd/indexer
```

- [ ] **Step 6: Write the indexer stub `cmd/indexer/main.go`**

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "solvent indexer: not wired yet (see Task 7)")
	os.Exit(1)
}
```

- [ ] **Step 7: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  go:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: solvent
          POSTGRES_PASSWORD: solvent
          POSTGRES_DB: solvent
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U solvent" --health-interval 2s
          --health-timeout 2s --health-retries 15
    env:
      TEST_DATABASE_URL: postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.24" }
      - name: gofmt
        run: test -z "$(gofmt -l .)"
      - name: vet
        run: go vet ./...
      - name: test
        run: go test ./...
```

- [ ] **Step 8: Verify everything builds and DB comes up**

Run: `go build ./... && make db-up`
Expected: build silent; compose reports db healthy.

- [ ] **Step 9: Commit**

```bash
git add go.mod .gitignore .env.example LICENSE README.md Makefile docker-compose.yml .github/workflows/ci.yml cmd/indexer/main.go
git commit -m "chore: scaffold Go module, compose db, CI"
```

---

### Task 3: `internal/config` — typed config from contracts.json + env

**Files:**
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`
- Create: `internal/config/testdata/contracts.json`

**Interfaces:**
- Consumes: the Task 1 Step 8 JSON schema.
- Produces (used by Task 7):
  - `config.Load(path string) (*Config, error)` — parses + validates file, resolves RPC URLs from env.
  - `type Config struct { DatabaseURL string; PollInterval time.Duration; Chains map[string]Chain; Streams []Stream }`
  - `type Chain struct { ChainID uint64; RPCURLs []string }`
  - `type Stream struct { Name, Chain, Engine string; Addresses []common.Address; StartBlock, Window, Confirmations uint64 }`

- [ ] **Step 1: Write the test fixture `internal/config/testdata/contracts.json`**

```json
{
  "chains": {
    "op": { "chainId": 10, "rpcEnv": "SOLVENT_RPC_OP" }
  },
  "streams": [
    {
      "name": "op:test",
      "chain": "op",
      "engine": "aave_v3_etherfi",
      "addresses": ["0x794a61358D6845594F94dc1DB02A252b5b4814aD"],
      "startBlock": 100,
      "window": 2000,
      "confirmations": 5
    }
  ]
}
```

- [ ] **Step 2: Write the failing test `internal/config/config_test.go`**

```go
package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLoadValidConfig(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example,https://b.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	t.Setenv("SOLVENT_POLL_INTERVAL", "7s")

	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, "postgres://x", cfg.DatabaseURL)
	require.Equal(t, 7*time.Second, cfg.PollInterval)
	require.Equal(t, uint64(10), cfg.Chains["op"].ChainID)
	require.Equal(t, []string{"https://a.example", "https://b.example"}, cfg.Chains["op"].RPCURLs)
	require.Len(t, cfg.Streams, 1)
	s := cfg.Streams[0]
	require.Equal(t, "op:test", s.Name)
	require.Equal(t, "0x794a61358D6845594F94dc1DB02A252b5b4814aD", s.Addresses[0].Hex())
	require.Equal(t, uint64(5), s.Confirmations)
}

func TestLoadFailsWhenRPCEnvMissing(t *testing.T) {
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	// SOLVENT_RPC_OP deliberately unset
	_, err := Load("testdata/contracts.json")
	require.ErrorContains(t, err, "SOLVENT_RPC_OP")
}

func TestLoadFailsOnUnknownChainRef(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_chain_ref.json")
	require.ErrorContains(t, err, "unknown chain")
}
```

Also write `internal/config/testdata/bad_chain_ref.json`: copy of the fixture with `"chain": "arbitrum"` in the stream.

- [ ] **Step 3: Run tests to verify failure**

Run: `go get github.com/stretchr/testify@latest github.com/ethereum/go-ethereum@latest && go test ./internal/config/`
Expected: FAIL — `undefined: Load`.

- [ ] **Step 4: Implement `internal/config/config.go`**

```go
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

type Chain struct {
	ChainID uint64
	RPCURLs []string
}

type Stream struct {
	Name          string
	Chain         string
	Engine        string
	Addresses     []common.Address
	StartBlock    uint64
	Window        uint64
	Confirmations uint64
}

type Config struct {
	DatabaseURL  string
	PollInterval time.Duration
	Chains       map[string]Chain
	Streams      []Stream
}

type fileChain struct {
	ChainID uint64 `json:"chainId"`
	RPCEnv  string `json:"rpcEnv"`
}

type fileStream struct {
	Name          string   `json:"name"`
	Chain         string   `json:"chain"`
	Engine        string   `json:"engine"`
	Addresses     []string `json:"addresses"`
	StartBlock    uint64   `json:"startBlock"`
	Window        uint64   `json:"window"`
	Confirmations uint64   `json:"confirmations"`
}

type fileRoot struct {
	Chains  map[string]fileChain `json:"chains"`
	Streams []fileStream         `json:"streams"`
}

func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var root fileRoot
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	dbURL := os.Getenv("SOLVENT_DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("SOLVENT_DATABASE_URL is not set")
	}
	poll := 5 * time.Second
	if v := os.Getenv("SOLVENT_POLL_INTERVAL"); v != "" {
		poll, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("SOLVENT_POLL_INTERVAL: %w", err)
		}
	}

	cfg := &Config{DatabaseURL: dbURL, PollInterval: poll, Chains: map[string]Chain{}}

	for name, fc := range root.Chains {
		urls := os.Getenv(fc.RPCEnv)
		if urls == "" {
			return nil, fmt.Errorf("rpc env %s (chain %q) is not set", fc.RPCEnv, name)
		}
		cfg.Chains[name] = Chain{ChainID: fc.ChainID, RPCURLs: strings.Split(urls, ",")}
	}

	for _, fs := range root.Streams {
		if _, ok := cfg.Chains[fs.Chain]; !ok {
			return nil, fmt.Errorf("stream %q references unknown chain %q", fs.Name, fs.Chain)
		}
		if fs.Window == 0 || fs.Confirmations == 0 {
			return nil, fmt.Errorf("stream %q: window and confirmations must be > 0", fs.Name)
		}
		s := Stream{
			Name: fs.Name, Chain: fs.Chain, Engine: fs.Engine,
			StartBlock: fs.StartBlock, Window: fs.Window, Confirmations: fs.Confirmations,
		}
		for _, a := range fs.Addresses {
			if !common.IsHexAddress(a) {
				return nil, fmt.Errorf("stream %q: invalid address %q", fs.Name, a)
			}
			s.Addresses = append(s.Addresses, common.HexToAddress(a))
		}
		cfg.Streams = append(cfg.Streams, s)
	}
	return cfg, nil
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `go test ./internal/config/ -v`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/config/ go.mod go.sum
git commit -m "feat: typed config loader for chains and ingest streams"
```

---

### Task 4: `internal/store` — schema, migrations, ingestion persistence

**Files:**
- Create: `internal/store/store.go`
- Create: `internal/store/migrate.go`
- Create: `internal/store/migrations/00001_ingest.sql`
- Create: `internal/store/store_test.go`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Tasks 6, 7 — exact signatures):
  - `store.Open(ctx context.Context, dsn string) (*Store, error)` / `(*Store).Close()`
  - `store.Migrate(dsn string) error`
  - `type CursorPos struct { Block uint64; Hash []byte }`
  - `type RawLog struct { ChainID uint64; BlockNumber uint64; BlockHash []byte; TxHash []byte; LogIndex uint32; Address []byte; Topics [][]byte; Data []byte }`
  - `(*Store).Cursor(ctx context.Context, stream string) (*CursorPos, error)` — `nil, nil` when no cursor yet.
  - `(*Store).SaveBatch(ctx context.Context, stream string, chainID uint64, logs []RawLog, tipBlock uint64, tipHash []byte) error` — one transaction: idempotent log insert + cursor upsert.
  - `(*Store).Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error` — deletes this chain's logs above `toBlock`, resets cursor.

- [ ] **Step 1: Write the migration `internal/store/migrations/00001_ingest.sql`**

```sql
-- +goose Up
CREATE TABLE ingest_cursors (
    stream          TEXT PRIMARY KEY,
    chain_id        BIGINT      NOT NULL,
    last_block      BIGINT      NOT NULL,
    last_block_hash BYTEA       NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE raw_logs (
    chain_id     BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash   BYTEA  NOT NULL,
    tx_hash      BYTEA  NOT NULL,
    log_index    INT    NOT NULL,
    address      BYTEA  NOT NULL,
    topics       BYTEA[] NOT NULL,
    data         BYTEA  NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX raw_logs_block_idx ON raw_logs (chain_id, block_number);
CREATE INDEX raw_logs_address_idx ON raw_logs (chain_id, address, block_number);

-- +goose Down
DROP TABLE raw_logs;
DROP TABLE ingest_cursors;
```

- [ ] **Step 2: Write the failing test `internal/store/store_test.go`**

```go
package store

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	require.NoError(t, Migrate(dsn))
	s, err := Open(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	_, err = s.pool.Exec(context.Background(), "TRUNCATE raw_logs, ingest_cursors")
	require.NoError(t, err)
	return s
}

func sampleLogs(n int, fromBlock uint64) []RawLog {
	logs := make([]RawLog, n)
	for i := range logs {
		logs[i] = RawLog{
			ChainID:     10,
			BlockNumber: fromBlock + uint64(i),
			BlockHash:   []byte{0xbb, byte(i)},
			TxHash:      []byte{0x77, byte(i)},
			LogIndex:    0,
			Address:     []byte{0xaa},
			Topics:      [][]byte{{0x01}},
			Data:        []byte{0x02},
		}
	}
	return logs
}

func TestCursorNilWhenUnset(t *testing.T) {
	s := testStore(t)
	cur, err := s.Cursor(context.Background(), "op:test")
	require.NoError(t, err)
	require.Nil(t, cur)
}

func TestSaveBatchAdvancesCursorAndIsIdempotent(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(3, 100)

	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0xff}))
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0xff})) // replay: no error, no dupes

	cur, err := s.Cursor(ctx, "op:test")
	require.NoError(t, err)
	require.Equal(t, uint64(102), cur.Block)
	require.Equal(t, []byte{0xff}, cur.Hash)

	var count int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs").Scan(&count))
	require.Equal(t, 3, count)
}

func TestRewindDeletesLogsAboveBlock(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, sampleLogs(5, 100), 104, []byte{0x04}))

	require.NoError(t, s.Rewind(ctx, "op:test", 10, 101, []byte{0x01}))

	cur, err := s.Cursor(ctx, "op:test")
	require.NoError(t, err)
	require.Equal(t, uint64(101), cur.Block)
	require.Equal(t, []byte{0x01}, cur.Hash)

	var count int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs WHERE block_number > 101").Scan(&count))
	require.Equal(t, 0, count)
}
```

- [ ] **Step 3: Run tests to verify failure**

Run: `go get github.com/jackc/pgx/v5@latest github.com/pressly/goose/v3@latest && go test ./internal/store/`
Expected: FAIL — `undefined: Store`, `undefined: Migrate`.

- [ ] **Step 4: Implement `internal/store/migrate.go`**

```go
package store

import (
	"database/sql"
	"embed"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func Migrate(dsn string) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("open for migrate: %w", err)
	}
	defer db.Close()
	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.Up(db, "migrations"); err != nil {
		return fmt.Errorf("goose up: %w", err)
	}
	return nil
}
```

- [ ] **Step 5: Implement `internal/store/store.go`**

```go
package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

type CursorPos struct {
	Block uint64
	Hash  []byte
}

type RawLog struct {
	ChainID     uint64
	BlockNumber uint64
	BlockHash   []byte
	TxHash      []byte
	LogIndex    uint32
	Address     []byte
	Topics      [][]byte
	Data        []byte
}

func (s *Store) Cursor(ctx context.Context, stream string) (*CursorPos, error) {
	var c CursorPos
	err := s.pool.QueryRow(ctx,
		`SELECT last_block, last_block_hash FROM ingest_cursors WHERE stream = $1`,
		stream).Scan(&c.Block, &c.Hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read cursor %q: %w", stream, err)
	}
	return &c, nil
}

func (s *Store) SaveBatch(ctx context.Context, stream string, chainID uint64, logs []RawLog, tipBlock uint64, tipHash []byte) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, l := range logs {
		_, err := tx.Exec(ctx,
			`INSERT INTO raw_logs (chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			 ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
			l.ChainID, l.BlockNumber, l.BlockHash, l.TxHash, int32(l.LogIndex), l.Address, l.Topics, l.Data)
		if err != nil {
			return fmt.Errorf("insert log: %w", err)
		}
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO ingest_cursors (stream, chain_id, last_block, last_block_hash, updated_at)
		 VALUES ($1,$2,$3,$4,now())
		 ON CONFLICT (stream) DO UPDATE
		 SET last_block = EXCLUDED.last_block, last_block_hash = EXCLUDED.last_block_hash, updated_at = now()`,
		stream, chainID, tipBlock, tipHash)
	if err != nil {
		return fmt.Errorf("upsert cursor: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Store) Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`DELETE FROM raw_logs WHERE chain_id = $1 AND block_number > $2`, chainID, toBlock); err != nil {
		return fmt.Errorf("delete logs: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO ingest_cursors (stream, chain_id, last_block, last_block_hash, updated_at)
		 VALUES ($1,$2,$3,$4,now())
		 ON CONFLICT (stream) DO UPDATE
		 SET last_block = EXCLUDED.last_block, last_block_hash = EXCLUDED.last_block_hash, updated_at = now()`,
		stream, chainID, toBlock, hashAtBlock); err != nil {
		return fmt.Errorf("reset cursor: %w", err)
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `make db-up && export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable' && go test ./internal/store/ -v`
Expected: 3 PASS (or SKIP if db not up — must be PASS here).

- [ ] **Step 7: Commit**

```bash
git add internal/store/ go.mod go.sum
git commit -m "feat: ingestion schema, migrations, cursor/batch/rewind store"
```

---

### Task 5: `internal/chain` — failover RPC client

**Files:**
- Create: `internal/chain/chain.go`
- Create: `internal/chain/chain_test.go`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Tasks 6, 7 — exact signatures):
  - `chain.Dial(ctx context.Context, urls []string) (*Failover, error)`
  - `(*Failover).BlockNumber(ctx context.Context) (uint64, error)`
  - `(*Failover).HeaderHash(ctx context.Context, n uint64) (common.Hash, error)`
  - `(*Failover).Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error)`
  - Behavior: tries the active endpoint, rotates on error, remembers the last good endpoint, errors only when all endpoints fail.

- [ ] **Step 1: Write the failing test `internal/chain/chain_test.go`**

```go
package chain

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

type fakeRPC struct {
	name     string
	fail     bool
	calls    int
	blockNum uint64
}

func (f *fakeRPC) BlockNumber(ctx context.Context) (uint64, error) {
	f.calls++
	if f.fail {
		return 0, errors.New(f.name + " down")
	}
	return f.blockNum, nil
}

func (f *fakeRPC) HeaderByNumber(ctx context.Context, n *big.Int) (*types.Header, error) {
	f.calls++
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	return &types.Header{Number: n}, nil
}

func (f *fakeRPC) FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	f.calls++
	if f.fail {
		return nil, errors.New(f.name + " down")
	}
	return []types.Log{}, nil
}

func TestFailoverRotatesOnError(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", blockNum: 42}
	f := newFailover([]rpcClient{a, b})

	n, err := f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(42), n)

	// second call goes straight to b (sticky active endpoint)
	_, err = f.BlockNumber(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, a.calls)
	require.Equal(t, 2, b.calls)
}

func TestFailoverErrorsWhenAllFail(t *testing.T) {
	a := &fakeRPC{name: "a", fail: true}
	b := &fakeRPC{name: "b", fail: true}
	f := newFailover([]rpcClient{a, b})

	_, err := f.BlockNumber(context.Background())
	require.ErrorContains(t, err, "all rpc endpoints failed")
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `go test ./internal/chain/`
Expected: FAIL — `undefined: newFailover`, `undefined: rpcClient`.

- [ ] **Step 3: Implement `internal/chain/chain.go`**

```go
package chain

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

type rpcClient interface {
	BlockNumber(ctx context.Context) (uint64, error)
	HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error)
	FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error)
}

type Failover struct {
	clients []rpcClient
	mu      sync.Mutex
	active  int
}

func Dial(ctx context.Context, urls []string) (*Failover, error) {
	if len(urls) == 0 {
		return nil, fmt.Errorf("no rpc urls given")
	}
	clients := make([]rpcClient, 0, len(urls))
	for _, u := range urls {
		c, err := ethclient.DialContext(ctx, u)
		if err != nil {
			return nil, fmt.Errorf("dial %s: %w", u, err)
		}
		clients = append(clients, c)
	}
	return newFailover(clients), nil
}

func newFailover(clients []rpcClient) *Failover {
	return &Failover{clients: clients}
}

func (f *Failover) do(ctx context.Context, op string, fn func(rpcClient) error) error {
	f.mu.Lock()
	start := f.active
	f.mu.Unlock()

	var lastErr error
	for i := 0; i < len(f.clients); i++ {
		idx := (start + i) % len(f.clients)
		if err := fn(f.clients[idx]); err != nil {
			lastErr = err
			slog.Warn("rpc endpoint failed, rotating", "op", op, "endpoint", idx, "err", err)
			continue
		}
		f.mu.Lock()
		f.active = idx
		f.mu.Unlock()
		return nil
	}
	return fmt.Errorf("all rpc endpoints failed (%s): %w", op, lastErr)
}

func (f *Failover) BlockNumber(ctx context.Context) (uint64, error) {
	var out uint64
	err := f.do(ctx, "blockNumber", func(c rpcClient) error {
		v, err := c.BlockNumber(ctx)
		out = v
		return err
	})
	return out, err
}

func (f *Failover) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	var out common.Hash
	err := f.do(ctx, "headerHash", func(c rpcClient) error {
		h, err := c.HeaderByNumber(ctx, new(big.Int).SetUint64(n))
		if err != nil {
			return err
		}
		out = h.Hash()
		return nil
	})
	return out, err
}

func (f *Failover) Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error) {
	var out []types.Log
	err := f.do(ctx, "getLogs", func(c rpcClient) error {
		logs, err := c.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(from),
			ToBlock:   new(big.Int).SetUint64(to),
			Addresses: addrs,
		})
		out = logs
		return err
	})
	return out, err
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `go test ./internal/chain/ -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/chain/
git commit -m "feat: failover RPC client with sticky rotation"
```

---

### Task 6: `internal/ingest` — reorg-safe window walker

**Files:**
- Create: `internal/ingest/walker.go`
- Create: `internal/ingest/walker_test.go`

**Interfaces:**
- Consumes: `store.CursorPos`, `store.RawLog` (Task 4); `common.Address`, `types.Log` (go-ethereum). Note: consumes store TYPES only — the DB itself is behind the `Store` interface below, so unit tests run with fakes, no Postgres.
- Produces (used by Task 7 — exact signatures):
  - `type Chain interface { BlockNumber(ctx context.Context) (uint64, error); HeaderHash(ctx context.Context, n uint64) (common.Hash, error); Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error) }` — satisfied by `*chain.Failover`.
  - `type Store interface { Cursor(ctx context.Context, stream string) (*store.CursorPos, error); SaveBatch(ctx context.Context, stream string, chainID uint64, logs []store.RawLog, tipBlock uint64, tipHash []byte) error; Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error }` — satisfied by `*store.Store`.
  - `ingest.NewWalker(ch Chain, st Store, cfg WalkerConfig) *Walker`
  - `type WalkerConfig struct { Stream string; ChainID uint64; Addresses []common.Address; StartBlock, Window, Confirmations uint64 }`
  - `(*Walker).Step(ctx context.Context) (advanced bool, err error)` — one bounded unit of work; caller loops while `advanced`.
  - Reorg policy: if the stored cursor hash mismatches the chain's hash at that height, rewind `2×Confirmations` blocks (never below `StartBlock`) and re-ingest.

- [ ] **Step 1: Write the failing tests `internal/ingest/walker_test.go`**

```go
package ingest

import (
	"context"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

type fakeChain struct {
	head   uint64
	hashes map[uint64]common.Hash // height -> hash
	logs   map[uint64][]types.Log // height -> logs at that height
}

func (f *fakeChain) BlockNumber(ctx context.Context) (uint64, error) { return f.head, nil }

func (f *fakeChain) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	if h, ok := f.hashes[n]; ok {
		return h, nil
	}
	return common.HexToHash("0xdefa017"), nil // deterministic default
}

func (f *fakeChain) Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error) {
	var out []types.Log
	for b := from; b <= to; b++ {
		out = append(out, f.logs[b]...)
	}
	return out, nil
}

type fakeStore struct {
	cursor    *store.CursorPos
	saved     [][]store.RawLog
	rewoundTo *uint64
}

func (f *fakeStore) Cursor(ctx context.Context, stream string) (*store.CursorPos, error) {
	return f.cursor, nil
}

func (f *fakeStore) SaveBatch(ctx context.Context, stream string, chainID uint64, logs []store.RawLog, tipBlock uint64, tipHash []byte) error {
	f.saved = append(f.saved, logs)
	f.cursor = &store.CursorPos{Block: tipBlock, Hash: tipHash}
	return nil
}

func (f *fakeStore) Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error {
	f.rewoundTo = &toBlock
	f.cursor = &store.CursorPos{Block: toBlock, Hash: hashAtBlock}
	return nil
}

func walker(ch Chain, st Store) *Walker {
	return NewWalker(ch, st, WalkerConfig{
		Stream: "op:test", ChainID: 10,
		Addresses:  []common.Address{common.HexToAddress("0xaa00000000000000000000000000000000000000")},
		StartBlock: 100, Window: 50, Confirmations: 5,
	})
}

func TestFreshWalkStartsAtStartBlockAndCapsAtWindow(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	// window of 50 from start 100 => cursor lands at 149
	require.Equal(t, uint64(149), st.cursor.Block)
}

func TestWalkCapsAtSafeHead(t *testing.T) {
	ch := &fakeChain{head: 130, hashes: map[uint64]common.Hash{}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	// safe head = 130 - 5 = 125 < window cap 149
	require.Equal(t, uint64(125), st.cursor.Block)
}

func TestNoAdvanceWhenCaughtUp(t *testing.T) {
	ch := &fakeChain{head: 130, hashes: map[uint64]common.Hash{125: common.HexToHash("0x01")}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 125, Hash: common.HexToHash("0x01").Bytes()}}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Nil(t, st.rewoundTo)
}

func TestReorgDetectedRewindsTwiceConfirmations(t *testing.T) {
	// stored hash at 200 disagrees with chain
	ch := &fakeChain{head: 300, hashes: map[uint64]common.Hash{200: common.HexToHash("0x11")}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 200, Hash: common.HexToHash("0x22").Bytes()}}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced) // the rewind itself counts as work
	require.NotNil(t, st.rewoundTo)
	require.Equal(t, uint64(190), *st.rewoundTo) // 200 - 2*5
}

func TestRewindNeverGoesBelowStartBlock(t *testing.T) {
	ch := &fakeChain{head: 300, hashes: map[uint64]common.Hash{105: common.HexToHash("0x11")}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 105, Hash: common.HexToHash("0x22").Bytes()}}
	w := walker(ch, st)

	_, err := w.Step(context.Background())
	require.NoError(t, err)
	require.NotNil(t, st.rewoundTo)
	require.Equal(t, uint64(100), *st.rewoundTo) // clamped to StartBlock, not 95
}

func TestLogsAreConvertedAndSaved(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{}, logs: map[uint64][]types.Log{
		110: {{
			Address:     common.HexToAddress("0xaa00000000000000000000000000000000000000"),
			Topics:      []common.Hash{common.HexToHash("0x0b")},
			Data:        []byte{0x0d},
			BlockNumber: 110,
			TxHash:      common.HexToHash("0x0c"),
			Index:       3,
			BlockHash:   common.HexToHash("0x0e"),
		}},
	}}
	st := &fakeStore{}
	w := walker(ch, st)

	_, err := w.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, st.saved, 1)
	require.Len(t, st.saved[0], 1)
	got := st.saved[0][0]
	require.Equal(t, uint64(110), got.BlockNumber)
	require.Equal(t, uint32(3), got.LogIndex)
	require.Equal(t, common.HexToHash("0x0c").Bytes(), got.TxHash)
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `go test ./internal/ingest/`
Expected: FAIL — `undefined: Chain`, `undefined: NewWalker`.

- [ ] **Step 3: Implement `internal/ingest/walker.go`**

```go
package ingest

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/kaselunt/solvent/internal/store"
)

type Chain interface {
	BlockNumber(ctx context.Context) (uint64, error)
	HeaderHash(ctx context.Context, n uint64) (common.Hash, error)
	Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error)
}

type Store interface {
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	SaveBatch(ctx context.Context, stream string, chainID uint64, logs []store.RawLog, tipBlock uint64, tipHash []byte) error
	Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error
}

type WalkerConfig struct {
	Stream        string
	ChainID       uint64
	Addresses     []common.Address
	StartBlock    uint64
	Window        uint64
	Confirmations uint64
}

type Walker struct {
	chain Chain
	store Store
	cfg   WalkerConfig
}

func NewWalker(ch Chain, st Store, cfg WalkerConfig) *Walker {
	return &Walker{chain: ch, store: st, cfg: cfg}
}

// Step performs one bounded unit of work: a reorg check + at most one
// getLogs window. Returns advanced=false when caught up to the safe head.
func (w *Walker) Step(ctx context.Context) (bool, error) {
	head, err := w.chain.BlockNumber(ctx)
	if err != nil {
		return false, fmt.Errorf("head: %w", err)
	}
	if head < w.cfg.Confirmations {
		return false, nil
	}
	safe := head - w.cfg.Confirmations

	cur, err := w.store.Cursor(ctx, w.cfg.Stream)
	if err != nil {
		return false, fmt.Errorf("cursor: %w", err)
	}

	var next uint64 // first block of the next window
	if cur == nil {
		next = w.cfg.StartBlock
	} else {
		chainHash, err := w.chain.HeaderHash(ctx, cur.Block)
		if err != nil {
			return false, fmt.Errorf("reorg check header %d: %w", cur.Block, err)
		}
		if !bytes.Equal(chainHash.Bytes(), cur.Hash) {
			target := w.cfg.StartBlock
			if back := cur.Block - min(cur.Block, 2*w.cfg.Confirmations); back > target {
				target = back
			}
			targetHash, err := w.chain.HeaderHash(ctx, target)
			if err != nil {
				return false, fmt.Errorf("rewind header %d: %w", target, err)
			}
			slog.Warn("reorg detected, rewinding",
				"stream", w.cfg.Stream, "from", cur.Block, "to", target)
			if err := w.store.Rewind(ctx, w.cfg.Stream, w.cfg.ChainID, target, targetHash.Bytes()); err != nil {
				return false, fmt.Errorf("rewind: %w", err)
			}
			return true, nil // rewound; next Step re-ingests
		}
		next = cur.Block + 1
	}

	if next > safe {
		return false, nil
	}
	to := next + w.cfg.Window - 1
	if to > safe {
		to = safe
	}

	logs, err := w.chain.Logs(ctx, next, to, w.cfg.Addresses)
	if err != nil {
		return false, fmt.Errorf("logs [%d,%d]: %w", next, to, err)
	}
	tipHash, err := w.chain.HeaderHash(ctx, to)
	if err != nil {
		return false, fmt.Errorf("tip header %d: %w", to, err)
	}

	raw := make([]store.RawLog, len(logs))
	for i, l := range logs {
		topics := make([][]byte, len(l.Topics))
		for j, t := range l.Topics {
			topics[j] = t.Bytes()
		}
		raw[i] = store.RawLog{
			ChainID:     w.cfg.ChainID,
			BlockNumber: l.BlockNumber,
			BlockHash:   l.BlockHash.Bytes(),
			TxHash:      l.TxHash.Bytes(),
			LogIndex:    uint32(l.Index),
			Address:     l.Address.Bytes(),
			Topics:      topics,
			Data:        l.Data,
		}
	}
	if err := w.store.SaveBatch(ctx, w.cfg.Stream, w.cfg.ChainID, raw, to, tipHash.Bytes()); err != nil {
		return false, fmt.Errorf("save batch: %w", err)
	}
	return true, nil
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `go test ./internal/ingest/ -v`
Expected: 6 PASS.

- [ ] **Step 5: Run the full quality gate**

Run: `test -z "$(gofmt -l .)" && go vet ./... && go test ./...`
Expected: all pass (store tests need `TEST_DATABASE_URL` exported and db up).

- [ ] **Step 6: Commit**

```bash
git add internal/ingest/
git commit -m "feat: reorg-safe log window walker with cursor rewind"
```

---

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

### Task 8: Phase gate — CI green on GitHub, tag, handoff

**Files:**
- Modify: `README.md` (add badge + one architecture paragraph)

**Interfaces:**
- Consumes: everything above.
- Produces: pushed repo with green CI; input state for Plan 2.

- [ ] **Step 1: Create the GitHub repo and push**

```bash
gh repo create solvent --private --source . --push
```
(Private for now; the public flip is a deliberate Plan 5 step, history intact. **Confirm with the user before running** — externally visible action. Run from the Solvent repo root only.)

- [ ] **Step 2: Verify CI is green**

Run: `gh run watch`
Expected: `ci / go` succeeds. If gofmt/vet/test diverge from local, fix forward with a named-file commit — never `--no-verify`, never force-push.

- [ ] **Step 3: Add the CI badge + architecture paragraph to `README.md`**

Append under the title:
```markdown
![ci](https://github.com/<owner>/solvent/actions/workflows/ci.yml/badge.svg)
```
(Substitute `<owner>` with the actual GitHub handle from Step 1.)
```markdown

Reorg-safe indexer → PostgreSQL event log → (coming) risk engine, public API, alerts, web.
Positions are derived state: everything is rebuildable from `raw_logs`.
```

```bash
git add README.md
git commit -m "docs: CI badge, one-paragraph architecture"
git push
```

- [ ] **Step 4: Tag the phase**

```bash
git tag v0.1.0-foundation && git push --tags
```

- [ ] **Step 5: Report phase results to the user**

Summarize: gate decision (GO/Fallback), logs ingested, CI link — and request the go-ahead to write Plan 2 (below).

---

## Roadmap: Plans 2–5 (written after this phase's gate)

Each subsequent plan is authored the same way (writing-plans skill, bite-sized TDD tasks) once its inputs exist. Locked scope per plan:

- **Plan 2 — Positions & prices** *(inputs: recon ABIs, live raw_logs)*: event decoding per engine (abigen bindings from `recon/abis/`), `positions`/`position_events`/`snapshots` migrations with the `lending_engine` discriminator, RedStone/Chainlink price ingestion, anvil-fork integration test replaying a real block range, backfill of both engines' full history.
- **Plan 3 — riskd + api + client-ts** *(inputs: populated positions)*: health-factor math with golden-vector tests against `getUserAccountData()` (starting with the Task 1 Step 5 sample borrower), stress engine (ETH −10/−20/−30%, weETH depeg 0.95, +200bps), liquidation waterfall aggregation; `cmd/api` REST + SSE with OpenAPI spec; `packages/client-ts` generated + published to npm.
- **Plan 4 — alerter + watches** *(inputs: riskd output)*: watch registrations (email/Telegram), threshold evaluation, delivery with retries + delivery log, `cmd/alerter`.
- **Plan 5 — web + deploy + launch** *(inputs: api live)*: Next.js app — Book overview, Address inspector, Migration Observatory, Watch flow; Fly.io (Go+Postgres) + Vercel (web) deploys; uptime monitoring + status badge; README-as-landing-page, 90-second demo recording, engineering writeup, DefiLlama adapter PR, repo public flip.
