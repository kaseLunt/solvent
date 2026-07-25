### Task 8: `internal/prices` — oracle price ingestion

You are the implementer for Task 8 of Solvent's Phase 2. Repo:
`C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`, base commit `3cc34da`.

## Read first (in this order, before writing code)

1. `docs/plans/2026-07-22-solvent-phase2-positions-prices.md` — the **Task 8 section** (search
   `### Task 8`). That is your spec.
2. `recon/derivation-notes.md` — the **`## Oracle wiring`** section (line ~251). This file is
   **NORMATIVE** for Tasks 4–10. Where it and the plan disagree, the recon notes win; say so in your
   report rather than silently picking one.
3. `recon/feeds.json` — the per-asset oracle registry you will drive from (20 OP `poll` entries,
   4 ETH `chainlink_stream` entries).
4. `internal/store/derive.go` — the store surface you build on. Note `DeriveCursor(ctx, engine)`,
   `RawLogsInRange(ctx, chainID, addresses, from, to)`, `RewindDerived`, `HasUnackedReorg`,
   `PruneAckedReorgEpochs`, and the exported sentinels (`ErrUnackedReorgEpoch`, …).
5. `internal/derive/` (engine contract + runner) and `internal/snapshot/snapshot.go` — the patterns
   your feed deriver and poller must match. The runner is freshly Codex-approved; imitate it, don't
   redesign it.
6. `internal/decode/` — where typed event decoding lives; `AnswerUpdated` decoding belongs in the
   established pattern there if it isn't already present.

Serena's semantic tools work in this repo (gopls installed 2026-07-24). Prefer
`get_symbols_overview` / `find_symbol` / `find_referencing_symbols` over grep+read for code
navigation, and `replace_symbol_body` / `insert_after_symbol` for edits.

## What exists already (verified — do not re-derive)

- **`prices` table already exists**: `internal/store/migrations/00002_positions.sql:92` —
  `(chain_id, asset, source, price NUMERIC, price_decimals INT, block_number, observed_at)`,
  PK `(chain_id, asset, source, block_number)`. **No migration is needed** unless you find a real
  defect; if you do, it is a **forward migration `00005`**, never an edit of a pushed migration
  (process rule, learned the hard way at `5b63614`).
- **All 4 ETH aggregators are already configured streams** in `config/contracts.json` (10 streams
  total = 2 lending + 4 aToken + 4 aggregator), so `AnswerUpdated` logs are already walker-ingested
  into `raw_logs`. Your ETH path is a **reader over `raw_logs`**, not a new walker.
- **No prices store method exists yet** — you add one (e.g. `SavePrices`). Store changes are
  **additive only**: `internal/ingest` compiles against existing public signatures.

## Normative facts from recon (get these exactly right)

**OP / Debt Manager — poll-only, engine-exact.**
- `PriceProviderV2.price(address)` at `0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB`, returns **USD
  with 6 decimals** per whole token.
- This is the exact function the engine calls at borrow/repay/liquidation
  (`DebtManagerCore.sol:378, 501`), so poll is the *correct* choice, not a shortcut.
- `isStableToken` configs **snap to exactly `1e6` within a ±1% band**. **Record what the contract
  returns. Never re-derive or "correct" the snap.** There is no AnswerUpdated stream that reproduces
  the engine price — do not try to substitute one.
- `source` = `priceproviderv2`, `price_decimals` = 6.
- Cadence `SOLVENT_PRICE_INTERVAL`, default 60s. Drive the asset list from the registry.

**ETH / Aave — Chainlink streams behind cap adapters.**
- Walk the **raw aggregators** (the `chainlink_stream` `contract` values in `feeds.json`), not the
  cap adapters — `aggregator()` reverts on the adapters; they are not proxies.
- `AnswerUpdated` topic0 = `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f`.
  8 decimals. `source` = `chainlink:<aggregator-address>`.
- **Caveat you must encode honestly:** the AnswerUpdated stream reproduces the **uncapped feed**,
  not the cap adapter's output (`min(feed, priceCap)`; the weETH adapter is
  `getRate × ETH/USD` with a growth-capped rate). Caps bind only in depeg/exploit scenarios.
  Document this as a known limitation in the package; do **not** claim the stream equals the
  adapter price.
- **weETH:** record **both** the ETH/USD stream price row **and** a polled `getRate()` ratio row.
  The P3 risk engine composes them. **Do not compose at ingest time.**
- Chainlink proxies re-point `aggregator()` on phase changes; the recorded aggregator covers the
  current phase only.

## Design decisions already made (carry these in — they are not yours to relitigate)

1. **The `chainlink_feed` processing gets its OWN derive cursor.** `DeriveCursor` is keyed by engine
   string, so use a distinct pseudo-engine key. This is the accepted resolution of review flag
   **M4** (epoch pruning must now also wait for the feed cursor — wire that, and prove it).
2. **Feed reorg handling joins the existing unacked-epoch gate**, with deletion of `prices` rows
   above the rewind target **inside the same transaction** as the rewind/ack path. A reorg must not
   leave price rows for orphaned blocks.
3. **Staleness → WARN + failed health check**, plus re-resolve the proxy's `aggregator()` and log
   the new address. Config update stays **manual**; automation is an explicit, honest deferral per
   the plan. Do not build auto-repointing.
4. OP path is poll-only and engine-exact (above). Supplier-side is out of scope.

## Binding rules accumulated from prior reviews (violating these is how Task 7 took 9 waves)

- **Always resume from `DeriveCursor`.** Never assume a caller-supplied rewind target is where you
  are; re-read the cursor.
- **Commit indeterminacy:** ANY `ApplyDerived`-class error ⇒ `Reset()` + rehydrate from committed
  truth. `DiscardBatch` is *only* for failures you KNOW never reached persistence. The store can
  commit while the ack is lost; preserving in-memory state against a possibly-advanced store is
  silent corruption.
- **Recover from `ErrUnackedReorgEpoch`** rather than treating it as fatal.
- **Merge streams per chain in `(block_number, log_index)` order** via `RawLogsInRange` with the
  full address set. That pair is a total order on EVM.
- **Advisory-lock liveness** re-check per round; lost lock ⇒ fatal exit.
- **Time-based backoff with jitter** on errors (round-counting elapses in milliseconds under a hot
  loop — that was a real finding).
- **Store: additive reads/writes only.** No signature changes.
- **No mainnet daemon run.** That is Task 9's job. Unit tests with fakes + live-db store tests only.

## Verification (run these; report actual output, not intent)

Sandbox: go/network commands need `dangerouslyDisableSandbox: true` and
`export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin"`.

**Verified baseline at your base commit `3cc34da`** (the controller ran this immediately before
dispatching you, so it is measured, not assumed):

```text
265 PASS, 0 FAIL, 0 SKIP   across cmd/indexer, internal/{chain,config,decode,derive,ingest,snapshot,store}
```

Zero SKIPs means live-db tests are genuinely running. **If your run shows any SKIP, your
`TEST_DATABASE_URL` is not wired — fix that before believing your results.** Your final count should
be 265 + your new tests; if it comes out lower, you have lost coverage and must explain why.

Postgres is **already up** (`solvent-db-1`, port 5432) and migrated — the controller ran `make db-up`
and confirmed the store suite green. You should not need to start Docker.

```bash
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go build ./...
go vet ./...
gofmt -l .          # NOTE: exits 0 even when it lists files. Read the output.
go test ./...
```

`-race` is worth attempting; the host lacks cgo, so prior waves ran it in a `golang:1.24` container.
If you cannot run it, say so plainly rather than implying you did.

## Scope and governance (hard constraints)

- W1 `allowed_paths`: `internal/**`, `cmd/**`, `config/**`, `go.mod`, `go.sum`, `docs/plans/**`,
  `recon/derivation-notes.md`, `recon/feeds.json`, `.gitignore`. **Nothing else.**
- **Do not touch** `roadmap/STATUS.md`, `roadmap/ROADMAP.md`, `roadmap/claims/**`, or
  `roadmap/decisions/**`. Claim/governance mutations are the controller's, and must never share a
  commit with product paths.
- **Stage by pathspec.** Never `git add -A` / `git add .` — a prior task's agent swept another
  agent's staged files that way and corrupted commit attribution.
- Commit message: `feat: oracle price ingestion - engine-exact OP polling, chainlink streams`
- Pre-commit hooks run doctor + scope gate. If a gate blocks you, **report it — do not bypass it.**

## Reporting

Write `.superpowers/sdd/task-8-report-p2.md` — note the **`-p2` suffix**. A Phase 1
`task-8-report.md` already exists in that directory and must NOT be overwritten; Phase 2 artifacts
carry the `-p2` suffix by convention (see `task-3-report-p2.md`, `task-7-brief-p2.md`).

End your final message with a summary covering:

- What you implemented, file by file, and the test counts you actually observed.
- **Every deviation from this brief or the plan, disclosed explicitly** with your reasoning. Prior
  tasks' disclosed deviations were adjudicated favorably; *undisclosed* ones are what reviews punish.
- Anything you could not verify, and why.
- Design questions you think the reviewer should attack hardest.

A Codex adversarial review follows under D-006 (this is money-adjacent, source-of-truth
persistence). Expect findings; write the code and the report to survive a hostile read. When you fix
a class of defect, **fix the whole class, not just the cited instances** — that lesson cost the
previous task several review rounds.
