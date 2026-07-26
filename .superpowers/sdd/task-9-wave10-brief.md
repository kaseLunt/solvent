### Task 9 - wave 10: cmd/reconcile + invariant scans (W1 acceptance evidence)

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. This brief is the SYNTHESIZED OUTPUT of a 12-agent design workflow (4 readers, 3
independent designs, judge, 3 adversarial verification lenses, synthesis) - the design
below already absorbed every BLOCKING finding; treat it as binding.

## Controller gate results (2026-07-26, post-design; they AMEND the design's Phase 0)

The design's pre-implementation gate was RUN by the controller:
- **Deep pinned-state eth_call FAILS on both configured ETH endpoints**: publicnode
  rejects with "historical state ... [unavailable]" (-32000, state pruned); drpc-keyed
  failed the header fetch itself (500/408, archive routing volatility).
- **Alchemy free tier SERVES deep archive state**: balanceOf(golden borrower) on
  aToken-weETH via EIP-1898 hash-pinned eth_call returned OK at BOTH evidence pins
  (25,584,990 and 25,593,800) AND at 20,779,893 (Aug 2024 - very deep). Values
  58420789594330 / 58420789594330 / 0.

CONSEQUENCE (binding design amendment): cmd/reconcile takes its OWN RPC configuration -
`SOLVENT_RECON_RPC_ETH` / `SOLVENT_RECON_RPC_OP` (falling back to SOLVENT_RPC_* when
unset) - and the runbook records that the ETH recon endpoint must be archive-state
capable (the owner's Alchemy key qualifies at $0; its getLogs cap is irrelevant since
reconcile makes NO getLogs calls). Phase 0's preflight stays exactly as designed and now
has a known-good configuration to verify against.

## Scope note

`docker-compose.yml`, `Makefile`, and `.env.example` are NOT currently in W1
allowed_paths. The controller is amending the work object in the same commit as this
brief (adding those three files) so the DB-split deliverable is in scope. If the scope
gate still refuses any path, STOP and report - do not work around.

## Environment (binding, unchanged from waves 1-9)

Backfill daemon RUNNING against DB `solvent` (writer lock) - never stop it/the
container. Unit/dev tests: `TEST_DATABASE_URL` at `solvent_t9w1` until the DB split
lands, then `solvent_test`. Pathspec staging; commit before mutation loops; in-memory
restores; CRLF-aware patching; committed-blob gofmt via `git cat-file` -> temp files;
`dangerouslyDisableSandbox: true` + PATH export "$PATH:/c/Program Files/Go/bin:/c/Users/kasel/go/bin";
`-race` in `golang:1.24` via `host.docker.internal`. Baseline at start commit (top-level
`^--- PASS`; wave-9 final 633/0/0 gate ON). The final EVIDENCE RUN against the live DB
is CONTROLLER work post-backfill - you build and test the harness; you do not run the
acceptance evidence.

## Reporting

`.superpowers/sdd/task-9-wave10-report-p2.md` per house convention: every design item
cited to its test, mutation matrix via the committed applier, anything unverified
stated. Returns to Codex under D-006.

---

# THE DESIGN (synthesized, binding)

# Solvent Task 9 — FINAL Implementation Brief: `cmd/reconcile` + Invariant Scans (W1 Acceptance Evidence)

Base: Design 1 (evidence-first). All judge grafts applied. Every BLOCKING adversarial finding resolved by design change (none refuted); resolution table at the end. Repo facts re-verified 2026-07-26: `runner.go:606-610` (borrow_apy deliberately not collected), `aave_test.go:616-699` (fixture pin 25,593,800; borrower 2 `0xe649a394fb16b58ee2e59feb2ea571e7733c812a`), `.env.example:1,5` (TEST and SOLVENT DSNs are the same database), W1 clause at `roadmap/work/W1-phase2-positions-prices.md:53-55` (literal chain read at 25,584,990), `derive.go:641-645/859-861` (acked_epoch bump; epoch pruning), `derive.go:1014` (snapshots history rows), `doctor.py:44` (OBJECT_DIRS includes `evidence` — recursive .md parsing).

---

## 0. Architecture and execution order

One-shot, strictly read-only CLI: `cmd/reconcile/main.go` + `internal/store/reconcile.go` (shared query layer) + `internal/store/invariants*` tests. Never calls `AcquireWriterLock` or `Migrate`. Runs while the daemon is live.

Phase order (mandatory — an archive miss must abort in seconds, not after minutes of held snapshot):

- **Phase 0 — Preflight (no snapshot held).** Config/env load; DSN-split tripwire (§1); schema gate: max applied `goose_db_version` == embedded expected (currently 8), exact match, else exit 2. Quick autocommit read of derive cursors + `acked_epoch` baseline. RPC preflight probes, cheapest first: (a) `HeaderHashFrom` + one `CallAtHashFrom(scaledBalanceOf)` at ETH 25,584,990 and 25,593,800 (the two deep pins); (b) one pinned call at the OP derive cursor. Any state-pruned classification (§6.3) here → exit 2 naming endpoint + depth. **Pre-implementation gate:** before building the harness at all, run this probe manually once against both ETH endpoints and record the result in R-001 (deep-state pinned eth_call is currently unproven; the only live evidence is near-head).
- **Phase 1 — DB snapshot.** One pgx connection, `options=-c default_transaction_read_only=on`, `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. ALL DB reads happen here (pins, sampling, as-of sums, balances, counts, freshness, invariant scans, internal-inconsistency check, rewind baseline). COMMIT and close **before any comparison RPC** (vacuum-friendliness; Design 0 graft 5).
- **Phase 2 — RPC comparisons.** Sequential OP then ETH (one shared drpc key/budget across both chains; the daemon is consuming it concurrently). Client-side token bucket + bounded backoff (§6.2). This is reconcile-side pacing against *residual* headroom — there is no shared limiter with the daemon and the chain layer has none (verified).
- **Phase 3 — End-of-run rewind re-check** on a **fresh connection** (§9). Fork welds re-run.
- **Phase 4 — Artifact emit + verdict.**

## 1. Environment and DB safety (resolves L2-1 — the single worst hazard)

`.env.example` currently points `TEST_DATABASE_URL` and `SOLVENT_DATABASE_URL` at the **same** database, `internal/store/derive_test.go:23-34` and `store_test.go:14-25` Migrate+TRUNCATE 12 tables including `raw_logs`/`position_events`, and W1's own acceptance requires `go test ./...` with live-db tests un-skipped. As previously specified, executing the receipt's command list would truncate the ~42h backfill. Mandated changes, part of the Task 9 deliverable:

1. **Physical DB split.** docker-compose gains a second database `solvent_test` (init script or second service). `.env.example` changes to `TEST_DATABASE_URL=postgres://solvent:solvent@localhost:5432/solvent_test?...`; `SOLVENT_DATABASE_URL` stays on `solvent` (the backfilled/daemon DB).
2. **Tripwire in reconcile:** if `TEST_DATABASE_URL` is set and resolves to the same database as the reconcile DSN, exit 2: `"test and live DSNs identical; physical split required (see runbook §DB-split)"`.
3. **Invariant evidence tests** gate on `SOLVENT_RECON_DATABASE_URL` (never `TEST_DATABASE_URL`), open read-only, never Migrate. File header states the destruction hazard explicitly.
4. **Sequencing pinned in runbook + receipt `environment` field:** suite-green evidence (`go test ./...`) gathered against `solvent_test`; reconcile + invariant evidence tests against the live DB; DB names (no credentials) recorded in the receipt.

## 2. Sampling (with SQL)

All sampling inside the Phase-1 RR snapshot; pure function of (DB-at-P, seed). Seed **defaults to hex of the OP pin's block hash** (argumentless runs stay reproducible), overridable with `-seed`; the resolved value is always echoed into artifact and receipt (Design 2 graft 6 overriding Design 1's refuse-to-default).

Strata are a disjoint precedence partition (liquidated > migrated > post_migration) with a live/zero split (L2-11):

```sql
WITH debt AS (
  SELECT account,
         SUM(delta)                                AS net,   -- normalized 1e18-scale USD
         BOOL_OR(event_type = 'migration_genesis') AS migrated,
         BOOL_OR(event_type = 'liquidation')       AS liquidated,
         BOOL_OR(event_type = 'residue_zeroed')    AS residue
  FROM position_events
  WHERE engine = 'debt_manager' AND side = 'debt'
        AND delta IS NOT NULL AND block_number <= $1        -- $1 = P_op
  GROUP BY account
)
SELECT encode(account,'hex') AS account,
       CASE WHEN liquidated THEN 'liquidated'
            WHEN migrated  THEN 'migrated'
            ELSE 'post_migration' END AS stratum,
       (net <> 0) AS live, net, residue,
       (liquidated AND net = 0) AS fully_liquidated
FROM debt
ORDER BY stratum, (net <> 0) DESC, md5($2 || encode(account,'hex'));  -- $2 = seed text
```

Go-side selection (deterministic given row order): quotas 9 liquidated / 8 migrated / 8 post_migration = 25 floor (`-sample` raises, never lowers). Within each stratum take live (nonzero net) first, then zero-net (phantom-debt probes: view must return the empty set); target ≥15 of 25 live, realized counts recorded. Underpopulated stratum: take all, backfill shortfall in fixed order liquidated→migrated→post_migration, shortfall + reason in artifact. Residue sub-target: prefer ≥3 fully-liquidated accounts with `residue_zeroed` history, but **degrade to take-all-and-report-shortfall, never exit 2** (L0-9 — the class may be empty on real data).

Forced includes (deduped, `forced:true`, on top of quota; pinned literals, resolved from config/fixtures at runtime but asserted against these constants): DM anchors `0x0303a641b9255a4240e879c76efc704dc1c6383d`, `0x0b7043c82c5ad152137ad7d503daa02f5e777f85`, `0x05e3a665efc843d77e3867ee6db41bc38d1ed33f` (Phase-1 bit-exact at PIN 154,021,227; net-normalized 963,813 / 3,985,789,485 / 7,153,773) and liquidation Safe `0xac5f3ce95f602e31b672cc38cddf7a3ea9ae5fcc`. Extendable via `-include`; exact replay via `-accounts <file>` (bypasses sampling, recorded).

Population preconditions (exit 2, never a silent pass):
- `SELECT COUNT(*) FROM position_events WHERE engine='debt_manager' AND event_type='migration_genesis'` **== 7,337** — the seed-ROW count, **not** `COUNT(DISTINCT account)` (L0-3/L2-8: 7,337 is positions across 80 batches; uniqueness is unproven). Distinct-account count is recorded separately in the artifact; any row-vs-distinct gap is flagged as a finding requiring adjudication of the contract's set-vs-add seed semantics — never "normalized to whatever passes".
- Every stratum non-empty (taxonomy-drift tripwire); borrower count > 0.

## 3. Comparison semantics

### 3.1 Pin choice
Per chain: `P = derive_cursors(engine).last_block`, read inside the snapshot — ApplyDerived commits events+balances+cursor atomically, so any snapshot where cursor=P has balances = Σ deltas ≤ P exactly (Design 0's argument, retained). `-pin-op`/`-pin-eth` overrides refuse pins > cursor (exit 2, citing W1's disproof clause). Hash via `HeaderHashFrom(startIdx, P)`; carry the `EndpointToken` forward. **No lag-based serveability inference** — Design 0's `-max-lag 30m` claim was false (30 min ≈ 900 OP blocks, far beyond a ~128-block non-archive horizon; L1-4). Serveability is proven directly: one cheap pinned probe call at P before the expensive multicalls; state-pruned classification → exit 3 (retryable: wait for daemon catch-up, re-pin, or use archive endpoint). A residual `-max-head-lag` (default 30m, header-time based) remains purely as a "daemon is stalled, evidence would be stale" quality gate, documented as such.

Fork welds, run in Phase 1 AND re-run in Phase 3 (L1-8 — `requireCanonical=false` means an orphaned pin keeps serving silently, so the end-of-run check is load-bearing): greatest `raw_logs.block_number <= P` per chain must have `block_hash == HeaderHashFrom` at that height; **additionally**, when P equals the ingest cursor, `ingest_cursors.last_block_hash` must match (L0-10 — the raw_logs row can sit far below P for a quiet address set).

### 3.2 As-of mechanics
Derived figures = `SUM(delta)` over `position_events WHERE block_number <= P AND delta IS NOT NULL`, grouped by (account, asset, side), via the `(engine, account, block_number)` index. `position_events` has no source column; `event_type` is provenance. NUMERIC scanned via `pgtype.Numeric` into `big.Int` with `Exp == 0` asserted loudly — no float path ever.

**Internal-inconsistency cross-check (judge correction, free):** inside the snapshot, cursor == P by construction, so for every sampled account compare `position_balances(source='event')` rows against the as-of sums. Mismatch = class `internal_inconsistency` (indexer bug localization at exactly the certified accounts), gated, exit 1.

### 3.3 Debt Manager (OP, engine `debt_manager`, proxy from config stream `op:debt-manager` Addresses[0] = `0x0078C5a459132e279056B2371fE8A8eC973A9553` — resolved, never hardcoded)
Per sampled account, all views multicall3-batched (`snapshot.Multicall3Address`, `tryBlockAndAggregate`) via `CallAtHashFrom` at pinHash(P_op), **chunks ≤15 calls** (the one-arg view iterates all 8 configured borrow tokens server-side; 25-50/chunk approaches free-tier caps — L1-7):

1. **`borrowingOf(address)` → (TokenData[], uint256 total)** — token-set graft with pinned zero-trim semantics (L2-7): the contract assembly-trims the array to **nonzero tokens only** (`DebtManagerStorageContract.sol:575-605`). Assert: `{tokens in returned array}` == `{DB tokens with nonzero as-of normalized}` (DB side also zero-filtered — amount-0 rows persist for closed positions and MUST be excluded from the set); per-token `floor(normalized_i × getCurrentIndex(token)@P / 1e18) == token.amount`; `Σ per-token == total`. Justified set-bridge: n>0 ⟺ floor(n·I/1e18)>0 for I ≥ 1e18. This closes the 8-borrow-token blind spot in both directions.
2. **`getCurrentIndex(token)`** for every token on either side. Bridge is exactly `DebtManagerStorageContract.sol:520-522` semantics, big.Int mulDiv floor. **Injectivity sentence (record verbatim in artifact):** floor(n·I/1e18) is injective in n for I ≥ 1e18 (always true — the index starts at 1e18 and accrues), so USD-level equality ⟺ normalized equality; using the contract's own index at P is not circular.

### 3.4 Aave (ETH, engine `aave_v3_etherfi`, Pool `0x0AA97c284e98396202b6A04024F5E2c65026F3c0`)
Per golden borrower and reserve at pinHash(P_eth): (a) scaled level, bit-exact, no ray replication — derived scaled debt vs `VariableDebtToken.scaledBalanceOf(user)` (debt-token address via `Pool.getReserveVariableDebtToken(reserve)@P`); derived scaled collateral vs `AToken.scaledBalanceOf(user)` (aToken addresses from `eth:atoken-{weeth,usdc,pyusd,frax}` streams); (b) live-value identity: `rayMulHalfUp(derived_scaled, Pool.getReserveNormalizedVariableDebt(reserve)@P)` vs `balanceOf(user)@P`, gated at 0 (same half-up WadRayMath on same inputs; the pin makes the contract do the compounding). Assets keyed by **underlying reserve address**, never symbol (duplicate liquidRESERVE symbol/name gotcha). Supplementary (labeled, non-gating): top-10 aave accounts by |scaled debt| scaled-vs-scaledBalanceOf.

### 3.5 Tolerance policy
**Zero, bit-exact, on every gated row.** Justification: (1) DM identity validated bit-exact on 3 borrowers at PIN 154,021,227; (2) the single documented contract deviation — ≤1-wei normalized residue after full liquidation — is MODELED by the deriver (`residue_zeroed`), so no epsilon is owed; (3) Aave scaled-vs-scaled compares identical storage semantics; (4) W1's disproof clause makes any tolerance a mask for exactly the failure the gate exists to catch. Mismatches are CLASSIFIED for diagnosis (`residue-shaped` | `missing-genesis` | `index-class` | `internal_inconsistency` | `unclassified`) — **every class still fails, exit 1**. `-tolerance-dm-wei` exists for diagnosis only: any nonzero value forces `summary.result = fail-with-tolerance` (structurally cannot launder into a pass receipt). `--allow-residue-tolerance` reclassifies only fully-liquidated accounts lacking `residue_zeroed`, with |Δ| ≤ 1 wei normalized, and stamps its use into the artifact for the reviewer. **Second-opinion re-read on every FAIL row** routed to a different endpoint index, both answers recorded (drift vs lying endpoint); with one usable alternative (and it is the weaker one per chain), a 429'd/pruned second opinion is recorded as `"no second opinion available"` — never counted as corroboration or contradiction (L1-9).

### 3.6 DM index-integrity check — REDESIGNED (resolves L0-1/L2-2)
The prior design read `rate_indexes(kind='borrow_apy')`, which **is never written** (`runner.go:606-610` — deliberately out of scope) and 7 of 8 borrow tokens have no `borrow_index` rows either (IIU fires only on mutating blocks). New sourcing:
- `idx_b` = latest `rate_indexes(engine='debt_manager', asset, kind='borrow_index')` at block b ≤ P — exists only for tokens with IIU history (in practice USDC).
- `apy` = latest APY observation ≤ P from **`position_events` payloads**, which ARE persisted: `borrow_apy_set.new_apy` and `borrow_token_config_set.{borrow_apy, interest_index_snapshot, last_update_timestamp}` (`debtmanager.go:424-437`). Pairing assumption, documented: `setBorrowApy` reindexes before changing the rate (`derivation-notes.md:28-30`), so latest-APY-at-≤P is the accrual rate in force since the latest IIU block.
- `idx_rec = idx_b + floor(idx_b × apy × dt / 100e18)`, `dt = HeaderTime(P) − HeaderTime(b)`; assert `idx_rec == getCurrentIndex(token)@P`.

Scope and verdicts: tokens with no IIU history get report row `no-iiu-history` (not gated — the check does not exist for them, and says so; never a vacuous pass). Tokens with nonzero sampled debt but no APY observation → `unrunnable-missing-apy`, gated fail (config events are persisted; absence is a derivation gap). The whole check carries a **separate verdict class** (`index_integrity`) so its failure is never conflated with balance drift (judge graft 6). Header times: add a minimal token-routed `HeaderTimeFrom(startIdx, ...)` to `internal/chain` (additive; the plain `HeaderTime` has no routing — L2-13); if descoped, record the serving endpoint index for header reads and disclose the exposure in the artifact.

## 4. Aave golden vectors — DUAL-PIN (resolves L0-2/L2-3)

W1 pins borrower 1 at ETH **25,584,990**; the committed Task 6 fixtures were captured at **25,593,800** (`aave_test.go:616-627`). Constants must never be ported across blocks. Vectors file `cmd/reconcile/golden_vectors.json` (go:embed, provenance comments), borrowers `0x70daaac436465a0d03e45916fa68ddee6086e5fe` and `0xe649a394fb16b58ee2e59feb2ea571e7733c812a`, fixture constants vUSDC 125415 / aWeETH 58420665095130 and vPYUSD 83 / aWeETH 7045575913579. Three separately-gated row groups, all bit-exact:

- **Row A — the literal W1 clause:** DB as-of sums ≤ 25,584,990 vs `scaledBalanceOf` at `HeaderHashFrom(25,584,990)`, both borrowers, debt + collateral. This is a **live pinned chain read** at exactly the W1 block ("matches direct contract view calls"); mandatory for `result:pass`; archive miss = exit 2 naming the endpoint, never skipped, never fixture-substituted.
- **Row B — fixture weld at the fixtures' own pin:** derived as-of ≤ 25,593,800 == committed fixture constants == chain `scaledBalanceOf` @ 25,593,800. Three-way weld: DB==chain proves the deriver; chain==constant proves the endpoint isn't lying and provenance holds; DB==constant localizes the broken leg.
- **Row C — interval quiescence (documentation, gated):** `SELECT COUNT(*) FROM position_events WHERE engine='aave_v3_etherfi' AND account IN (...) AND block_number > 25584990 AND block_number <= 25593800` — expected 0; recorded so the reviewer sees why A and B agree, without ever substituting one pin's constants at the other's block.

Both vectors also run at fresh P_eth (derivation holds at head, not only historically). Precondition: derive cursor ≥ vector block, else exit 2. Honest note in artifact + receipt: this run is the first empirical Aave validation (recon had no Aave goldens); a failure is adjudicated engine-defect-first. eth streams' startBlock 20,625,519 == market genesis, so as-of sums at both pins are complete.

## 5. CLI shape

Layout: `cmd/reconcile/{main.go, main_test.go, sampling.go, dm.go, aave.go, golden.go, freshness.go, rpcclass.go, artifact.go, lens_abis.go, golden_vectors.json}`; shared queries in `internal/store/reconcile.go` + `internal/store/invariants.go`.

**Store API contract (resolves L2-4):** every new store method takes an explicit querier:
```go
type Querier interface {
    Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
    QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}
```
(satisfied by `pgx.Tx` and `*pgxpool.Pool`). Exported: `AsOfEventSums`, `SampleDMBorrowers`, `ReconRowCounts`, `SnapshotFreshness`, `EventBalanceInternalCheck`, `InvariantDistinctHashViolations`, `InvariantEventSumMismatches`, `InvariantBorrowIndexRegressions` (+ advisory Aave-kind scan). cmd/reconcile passes its RR tx; tests pass pool or their own tx. This is the mechanism that makes "one source of query truth" and "one snapshot" simultaneously true — implementers may not put these on `s.pool`.

**Flags:** `-config` (default `config/contracts.json`); `-engine all|debt_manager|aave_v3_etherfi`; `-sample` (≥25 enforced; `-allow-small` for debugging taints artifact `acceptance:false`); `-seed` (default hex(pin-hash P_op), echoed resolved); `-include`; `-accounts FILE`; `-pin-op`/`-pin-eth` (default = derive cursor; never above it); `-golden-pin-eth` (fixed 25,584,990) and `-fixture-pin-eth` (fixed 25,593,800) — overriding either taints `acceptance:false`; `-snapshot-max-age` (default `auto` — policy bound from §8, both numbers recorded); `-tolerance-dm-wei` (0; nonzero ⇒ fail-with-tolerance); `-allow-residue-tolerance`; `-rps` (default 1.5, client token bucket across ALL endpoints; OP and ETH phases sequential); `-rpc-attempts` (default 5, exponential backoff + jitter, 429 only); `-collateral-replay N` (default 3, degrade semantics §8); `-out` (default `roadmap/evidence/artifacts/w1-reconcile/`); `-timeout`.

**Env/bootstrap:** `config.Load` (SOLVENT_DATABASE_URL, SOLVENT_RPC_OP, SOLVENT_RPC_ETH) → `chain.Dial` + `VerifyChainID` per chain. New Makefile target `make reconcile` (`.env` export); exit-2 message on bare-shell env absence says "run via make reconcile or export .env" — deliverable, not polish.

**Exit codes (Design 2 split):** `0` pass (all gated rows exact, scans zero rows, freshness green, W1 golden row A green); `1` verdict-reached drift/violation/freshness-red (artifacts fully written); `2` precondition (schema, DSN-split tripwire, genesis count ≠ 7,337, empty stratum, pin > cursor, W1 golden-pin archive miss after bounded retries, cursor < vector block); `3` retryable environment (429 exhaustion, fresh-pin state-pruned, derive lag, mid-run rewind detected, chunk block divergence); `4` usage.

**RPC error classifier (resolves L1-2/L1-3, new code — nothing reusable exists; `isBlockNotFoundErr` is unexported and too narrow):** `rpcclass.go` classifies each `PinnedCallError.Attempts` entry into three buckets: `block-not-found` ("not found", "unknown block" + block/header/hash — fork/lagging node → rotate); `state-pruned` ("missing trie node", "required historical state unavailable", "state is not available", "pruned" variants → archive-capability verdict); `transport-throttle` (`errors.As` → `rpc.HTTPError`, StatusCode 429 → bounded exponential backoff with jitter, honoring Retry-After; **403 is a capability refusal, never backed off** — rotate immediately; all endpoints 403 ⇒ exit 2). Load-balancer wrinkle (drpc/publicnode): the same pinned call can alternate archive/pruned backends — classify state-pruned **only after `-rpc-attempts` bounded retries**, never from one failed walk. Every attempt's endpoint + classification lands in the artifact.

**Multicall discipline:** chunks ≤15 calls; per-chunk in-band `tryBlockAndAggregate` block number asserted == P (belt-and-braces on the hash pin); a chunk reporting a different block aborts (exit 3), never silently accepted; per-chunk `EndpointToken` recorded — chunks MAY legitimately be served by different endpoints after mid-walk rotation, so no single-endpoint assertion (L1-7). Estimated call count per run (~10-16 eth_calls total) recorded in the artifact.

**ABI surface:** hand-authored single-method lens ABIs in `lens_abis.go` (`borrowingOf(address)`, `borrowingOf(address,address)` as **two separate single-method ABIs** — sidesteps go-ethereum's `borrowingOf0` overload mangling — plus `getCurrentIndex`, `collateralOf`, `scaledBalanceOf`, `balanceOf`, `getReserveVariableDebtToken`, `getReserveNormalizedVariableDebt`, `tryBlockAndAggregate`), each with provenance comments; pack/unpack pinned by unit tests. Chain layer reused untouched (closed law) except the additive `HeaderTimeFrom`.

## 6. Invariant scans

SQL as package constants in `internal/store/invariants.go`, executed by (a) cmd/reconcile inside the RR snapshot (results embedded in artifact), (b) evidence tests, (c) falsifiability tests — all through the same exported Querier-taking methods.

Scan 1 — distinct-hash-per-height (zero rows):
```sql
SELECT chain_id, block_number, COUNT(DISTINCT block_hash) AS hashes,
       array_agg(DISTINCT encode(block_hash,'hex')) AS conflicting
FROM raw_logs GROUP BY chain_id, block_number
HAVING COUNT(DISTINCT block_hash) > 1;
```

Scan 2 — event sums == event-source balances (zero rows; **strict `IS DISTINCT FROM`**, no zero-sum allowance and no double-COALESCE — both live-apply and `RewindDerived` (no-HAVING rebuild, `derive.go:546-551`) always materialize amount-0 rows, so the permissive variants are fixtures-that-cannot-fail for real orphan classes — L0-4):
```sql
WITH ev AS (
  SELECT engine, account, asset, side, SUM(delta) AS total
  FROM position_events WHERE delta IS NOT NULL
  GROUP BY engine, account, asset, side
), bal AS (
  SELECT engine, account, asset, side, amount
  FROM position_balances WHERE source = 'event'
)
SELECT COALESCE(ev.engine,bal.engine), COALESCE(ev.account,bal.account),
       COALESCE(ev.asset,bal.asset),  COALESCE(ev.side,bal.side),
       ev.total AS event_sum, bal.amount AS balance
FROM ev FULL OUTER JOIN bal
  ON bal.engine=ev.engine AND bal.account=ev.account
 AND bal.asset=ev.asset  AND bal.side=ev.side
WHERE ev.total IS DISTINCT FROM bal.amount;
```
Sub-assertions: `COUNT(*) FROM position_events WHERE delta IS NOT NULL AND asset IS NULL` == 0 (NULL asset un-pairs the join); snapshot-source rows excluded by construction (source-exclusivity comment). Note recorded: `aave_liquidation_call` can carry delta = 0 (non-nil) — harmless for sums; "has a delta row" ≠ "moved a balance".

Scan 3 — `borrow_index` monotonic non-decreasing per (engine, asset) (zero rows): LAG window over `rate_indexes WHERE kind='borrow_index'`, `value < prev_value`. Sibling **separate** advisory test for `variable_borrow_index`/`liquidity_index` (no plan clause mandates them — cannot fail the mandated scan); `borrow_apy` explicitly excluded with comment (not persisted here anyway, and not monotonic).

**Test wiring (two modes, both same SQL constants):**
- *Falsifiability* (`internal/store/invariants_test.go`, gated `TEST_DATABASE_URL` → `solvent_test` only): per scan, open a tx, assert zero rows pristine, INSERT a minimal violation **inside the tx**, re-run the scan inside that tx, assert exactly the seeded violation surfaces, ROLLBACK (Design 2 graft 5 — proves each detector fires without dirtying any DB; requires the writable scratch DB, which is exactly why the physical split exists).
- *Evidence* (`internal/store/invariants_live_test.go`, gated `SOLVENT_RECON_DATABASE_URL`, read-only connection, never Migrate): population counts first; zero population ⇒ `t.Skip` with counts printed UNLESS `SOLVENT_INVARIANT_REQUIRE_DATA=1` converts skip → `t.Fatal`. The receipt command sets it, so the evidence run cannot vacuously pass against an empty/wrong DB.

Canonical receipt command:
`SOLVENT_RECON_DATABASE_URL=$SOLVENT_DATABASE_URL SOLVENT_INVARIANT_REQUIRE_DATA=1 go test ./internal/store -run 'TestInvariant' -count=1 -v`

Every test doc-comment cites its normative clause (Task 9 post-gate bullets; pre-gate wording for scan 1).

## 7. Freshness check (DM collateral)

Stated purpose in artifact: collateral is non-custodial and poll-only (`collateralOf` reads live Safe ERC20 balances, moves eventlessly) — it CANNOT be event-reconciled; honest evidence = sweep-pipeline health + bounded live checks.

- **Registry-anchored aggregates (L0-6):** LEFT JOIN from the registry (distinct debt-side accounts, the `SnapshotAccounts` shape) to `snapshot_sweeps` — a missing row (NeverSucceeded class) or `last_success_block = 0` counts red; aggregates computed on `snapshot_sweeps` alone are vacuous for never-swept accounts.
- **Gate scope (L2-9):** sampled accounts gate the exit code (status='success', `last_success_at` NOT NULL — NULL is fail-closed per migration 00006 — and within bound); fleet-wide aggregates + `sweep_generations` (generation, completed_at, `last_pass_seconds`) are reported with a **named advisory threshold**, so one permanently-reverting Safe cannot deadlock W1 forever. Policy stated in artifact.
- **Staleness bound (L2-9):** default `auto` = `max(2 × SOLVENT_SNAPSHOT_INTERVAL, 2 × sweep_generations.last_pass_seconds)` — hydrated from the same durable column the daemon's own `collateralStaleBound` uses; both inputs + resolved bound recorded.
- **Zero-collateral conditional (L2-12):** an empty collateral document is a valid observation writing zero `position_balances` rows; the sub-check reads "IF snapshot rows exist, `updated_block == last_success_block`" plus the independent status/last_success_at gate — absence of rows is never misread as failure.
- **Source-exclusivity probe:** `BalancesFor` per sampled account must not return `ErrBalanceSourceConflict`.
- **Non-gating spot read:** `collateralOf(account)@pinHash(P_op)` vs snapshot-source balances, classified report-only with block distance attached and the reason it cannot gate stated.
- **Deep collateral replay (`-collateral-replay N`, default 3; graft 4 reshaped by L0-5/L1-5/L2-10):** re-execute the sweeper's own `collateralOf` lens at `HeaderHashFrom(last_success_block)` and require bit-exact equality with the **`snapshots` history row at exactly that block** (`derive.go:1014` — stable, race-free target; no re-read/retry machinery against `position_balances` needed). **Gates only when the pinned replay is actually served:** `last_success_block` can be ~1,800 OP blocks deep (beyond non-archive horizons, capability unverified on OP) — a state-pruned classification degrades the row to report-only with endpoint + depth recorded; it never causes exit 1 or exit 2 by itself. A served-and-mismatched replay IS gated (it replays the sweeper's read at the sweeper's block).

## 8. Rewind detection (resolves L2-5/L0-8 — prune-immune)

Baseline inside the snapshot: per engine `derive_cursors.{acked_epoch, last_block}`; per chain `MAX(reorg_epochs.epoch)` (informational). End-of-run, **fresh connection** (a snapshot cannot observe its own invalidation): require per engine `acked_epoch` unchanged AND `last_block ≥ P`. `MAX(reorg_epochs.epoch)` alone is defeated by `PruneAckedReorgEpochs` (`derive.go:859-866`) — a rewind+ack+prune cycle completing mid-run leaves MAX unchanged; `RewindDerived` always bumps `acked_epoch` (`derive.go:641-645`) and acks are monotone. Any movement ⇒ exit 3, artifact `status:"aborted: rewind during run"`. Fork welds (§3.1) also re-run here.

## 9. Artifacts, paths, receipt wiring (resolves L2-6)

- `<out>/drift-report.json` — schema id `solvent.reconcile.drift-report/v1`; canonical JSON (sorted keys). Sections: `run` (git commit via buildinfo, seed resolved, full cmdline, config sha256, DB name, endpoint classes, started/finished, derive-lag at start — the run-after-backfill diagnostic), `pins` (per chain + both golden pins: block, hash, header_time, weld results before/after), `cursors` (ingest/derive, acked_epoch start/end), `counts` (raw_logs per chain, position_events per engine, position_balances per engine+source, rate_indexes per engine+kind, distinct DM borrowers per stratum, migration_genesis rows vs distinct accounts — satisfies W1 "row/position counts recorded"), `sample`, `dm_rows[]` (address-keyed assets; per-token + total + set-equality verdicts; endpoints consulted; second-opinion answers or "no second opinion available"), `dm_index_check` (separate verdict class), `aave_rows[]`, `golden` (rows A/B/C), `freshness`, `collateral_replay`, `invariants`, `rpc` (per-attempt classifications, per-chunk tokens, call count), `summary` (per-verdict totals, result). sha256 of the deterministically-serialized comparison sections printed and embedded — a re-run with same pins/seed (or `-accounts`) reproduces it byte-identically (Design 2 graft 1).
- `<out>/drift-report.txt` — human summary rendered from the same struct. **Never `.md` under `roadmap/evidence/`**: doctor.py parses every `.md` under evidence recursively (`OBJECT_DIRS` includes `evidence`; Snapshot.list is prefix-recursive) and requires typed front matter — a nested plain markdown turns the control plane red. Aborted runs still write both files with `"ABORTED"` as line 1 of the .txt and `status:"aborted"` in the JSON, so a partial artifact cannot be pasted into a receipt.
- **Receipt:** top-level `roadmap/evidence/E-###-w1-reconciliation.md` (type:evidence, status:recorded, work:W1, result:pass, observed_at, environment incl. DB names + endpoint class, `commands`: the exact reconcile invocation with resolved seed/pins, the invariant-test command, `go test ./...` against `solvent_test`). Sequencing (fingerprint footgun): run harness → commit artifacts + receipt **together** → `python roadmap/tools/doctor.py --receipt-basis W1 --snapshot <that commit>` → stamp. Note the path dependency: `roadmap/evidence/**` is committable under the active **integrator** claim (scope_gate appends `roadmap/**`), not W1's own allowed_paths — state this in the handoff.

## 10. Test plan, including mutation targets

Unit (cmd/reconcile/main_test.go + per-file tests): lens-ABI pack/unpack for both `borrowingOf` overloads (golden calldata); mulDiv-floor bridge + injectivity edge (I = 1e18, 1e18+1); `rayMulHalfUp` round-trip against `aave_test.go`'s cases; zero-trim set semantics (closed position excluded from DB set; contract array trimmed); classifier bucket table (429 / 403 / missing-trie-node / not-found / transport strings); tolerance-laundering guard (any nonzero `-tolerance-dm-wei` ⇒ result ≠ pass); `SOLVENT_INVARIANT_REQUIRE_DATA` escalation; sampler determinism (same seed+rows ⇒ same selection; shortfall redistribution); canonical-JSON hash stability; aborted-run artifact stamping. Falsifiability + evidence invariant tests per §6. Store: Querier-taking methods tested through both a pool and a tx.

Mutation targets (per the repo's t9 mutation convention — each must be killed by a named test): (1) bridge floor→ceil; (2) drop `migration_genesis` from as-of sum predicate; (3) set-equality weakened to subset; (4) Scan 2 `IS DISTINCT FROM` → `=` / re-adding the zero-sum allowance; (5) Scan 1 `HAVING > 1` → `>= 1` or dropped; (6) Scan 3 comparison inverted; (7) REQUIRE_DATA escalation removed (skip becomes pass); (8) classifier misfiles state-pruned as transport-retryable; (9) residue classification without the fully_liquidated predicate; (10) rewind re-check reads `MAX(reorg_epochs.epoch)` instead of `acked_epoch`; (11) golden Row A replaced by fixture comparison (must fail a test asserting a live chain read occurred at 25,584,990); (12) seed not echoed into artifact.

## 11. Pre-empted adversarial findings (explicit list for the D-006 reviewer)

1. Destructive-suite collision with the backfill — physical DB split + tripwire + runbook sequencing (§1).
2. Fixture constants ported across pins (25,584,990 vs 25,593,800) — dual-pin rows A/B + quiescence row C (§4).
3. Historical check satisfied without a chain read — Row A is a live pinned read at the literal W1 block.
4. Vacuous/unrunnable index check (`borrow_apy` never persisted; 7/8 tokens without IIU rows) — payload-sourced APY, scoped, separate verdict class (§3.6).
5. USDC-only debt blindness — one-arg `borrowingOf(address)` token-set equality with pinned zero-trim semantics (§3.3).
6. Tolerance laundering — nonzero tolerance structurally forces fail-with-tolerance; residue allowance flag stamped.
7. Vacuous pass on empty/wrong DB — REQUIRE_DATA escalation + population preconditions + 7,337 event-row gate.
8. 7,337 mis-gated as distinct accounts — event-row count gated; distinct count recorded; gap = adjudication finding.
9. Snapshot-blind mid-run rewind + epoch-prune hole — fresh-connection `acked_epoch`/`last_block` re-check; welds before and after RPC.
10. Unproven deep-state archive capability — manual R-001 probe pre-implementation; in-tool preflight probes first; three-bucket classifier; load-balancer retry rule.
11. One transient 429 aborting the run — token bucket + bounded backoff; 403 never backed off; sequential chain phases against the shared drpc budget.
12. False `-max-lag` serveability claim — inference dropped; direct pin probe.
13. Deep collateral replay creating a second hard archive dependency (OP) — gates only when served; `snapshots` history row as race-free target.
14. Never-swept accounts invisible to freshness — registry LEFT JOIN; zero-collateral rows-conditional check.
15. Snapshot-vs-query-truth conflict — Querier-parameter store contract.
16. doctor.py breakage from nested evidence `.md` — `.txt` human summary; receipt at top level; commit-then-basis sequencing; integrator-claim path dependency stated.
17. Symbol-keyed asset merging (duplicate liquidRESERVE) — address-keyed rows everywhere.
18. Abort feeding a pass receipt — aborted status in JSON + ABORTED first line; doctor requires result:pass.
19. Single-endpoint second opinion oversold — recorded as unavailable, never as corroboration.
20. Unsatisfiable residue sub-quota / thin liquidated stratum — take-all-and-report degradation, never exit 2.

## 12. BLOCKING-findings resolution table

| Finding | Resolution |
|---|---|
| L0-1 / L2-2 (borrow_apy never persisted; tokens without IIU rows) | Redesigned §3.6: APY from position_events payloads; scoped to IIU-history tokens; separate verdict class; missing-APY-on-debt-token = gated named failure, never pass |
| L0-2 / L2-3 (fixture pin 25,593,800 ≠ W1 pin 25,584,990) | Dual-pin golden rows A (live W1 read) + B (fixture weld at 25,593,800) + C (interval quiescence); constants never cross pins (§4) |
| L0-3 / L2-8 (7,337 = seed rows, not accounts) | Gate `COUNT(*)` of migration_genesis events == 7,337; distinct-account count recorded; gap = adjudication finding (§2) |
| L1-1 (deep-state pin unproven) | Manual probe now, recorded in R-001, pre-implementation gate; in-tool preflight probes run first, before the DB snapshot (§0) |
| L1-2 (no pruned-state classifier exists) | New `rpcclass.go` three-bucket classifier over `PinnedCallError.Attempts`; classify-only-after-bounded-retries for load-balanced hosts (§5) |
| L1-3 (one 429 aborts the run) | Mandatory `-rps` token bucket + `-rpc-attempts` backoff w/ jitter and Retry-After; `rpc.HTTPError` classification; only exhaustion earns exit 3 (§5) |
| L1-4 (false `-max-lag` claim) | Serveability inference removed; direct pinned probe at P; residual header-time guard relabeled staleness-quality only (§3.1) |
| L1-5 (deep collateral = OP archive hard dependency) | Replay gates only when served; state-pruned ⇒ report-only w/ endpoint+depth; never exit 1/2 by itself (§7) |
| L2-1 (receipt commands destroy the backfill) | Physical DB split, `.env.example` + compose changes, reconcile tripwire, runbook + receipt sequencing (§1) |
| L2-4 (query truth vs single snapshot unimplementable) | Mandated Querier-parameter contract on all new store methods (§5) |
| L2-5 (epoch pruning defeats rewind detector) | Fresh-connection `acked_epoch` unchanged + `last_block ≥ P` per engine (§8) |
| L2-6 (nested evidence .md breaks doctor.py) | `.txt` human summary; JSON artifact; receipt as sole top-level evidence .md; integrator-claim path note (§9) |
| L2-7 (borrowingOf zero-trim false drift) | Both sides' zero-filtering pinned in the brief with the n>0 ⟺ floor>0 bridge (§3.3) |

Key files: `C:\Users\kasel\source\repos\etherfi\Solvent\cmd\reconcile\` (new), `C:\Users\kasel\source\repos\etherfi\Solvent\internal\store\reconcile.go` (new), `C:\Users\kasel\source\repos\etherfi\Solvent\internal\store\invariants.go` + `invariants_test.go` + `invariants_live_test.go` (new), `C:\Users\kasel\source\repos\etherfi\Solvent\internal\chain\chain.go` (additive `HeaderTimeFrom` only), `C:\Users\kasel\source\repos\etherfi\Solvent\.env.example` + `docker-compose` + `Makefile` (DB split + `make reconcile`), `C:\Users\kasel\source\repos\etherfi\Solvent\roadmap\risks\R-001-rpc-trust-boundary.md` (deep-state probe result), artifacts under `C:\Users\kasel\source\repos\etherfi\Solvent\roadmap\evidence\artifacts\w1-reconcile\`.
