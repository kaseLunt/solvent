# Task 9 — wave 15 report: round-13 fixes (env taint domain; compiler-proven snapshot boundary)

Brief: `task-9-wave15-brief.md` (BINDING — two fixes), adjudicating
`task-9-codex-round13.md` (both findings ACCEPTED). **Baseline SHA `67cda28`** —
session-start HEAD had already advanced past the dispatch commit because the parallel
wave 14 landed its four commits (`b70d612`, `508c0be`, `0340ed0`, `67cda28`) into the
shared tree before my baseline ran, so wave-14's work is INSIDE my baseline (same
pattern as wave 13's reconciliation). Branch `main`, parallel tree, pathspec staging on
every commit; the scope gate accepted all three commits.

| commit | contents |
| --- | --- |
| `b70d612`, `508c0be` | (sibling, pre-baseline) wave-14 implementation — ingest/indexer files, adds exactly 4 tests, INSIDE my baseline |
| `0340ed0`, `67cda28` | (sibling, pre-baseline) wave-14 mutation spec + transcript — docs-only (`git show --stat` verified), **`67cda28` = BASELINE SHA** |
| `4032298` | THE IMPLEMENTATION: F1 + F2 across `cmd/reconcile/**` (12 files edited, `env.go` + `env_test.go` + `phase1_gate_db_test.go` new, `cmd/reconcile/snapshotdb/` NEW PACKAGE with 2 files) |
| `2f5f556` | mutation spec `.superpowers/sdd/t9w15-mutations/mutations.json` (6 mutants), committed BEFORE the loop |
| `7c1fe88` | `t9w15-mutations/transcript.md`, **6/6 KILLED** at tested SHA `2f5f556` — FINAL code state (code bytes identical `4032298`→HEAD) |
| + this report | `task-9-wave15-report-p2.md` |

Scope: `git diff --name-only 67cda28..7c1fe88` = `cmd/reconcile/**` (17 files, incl.
the new `cmd/reconcile/snapshotdb/` package — placed under `cmd/reconcile/` per the
brief so it stays inside this wave's file ownership) + `.superpowers/sdd/t9w15-mutations/**`
(2 files). Nothing outside my ownership touched; zero interleaved sibling commits
between baseline and final (`git log 67cda28..HEAD` = my three commits only; the
sibling's still-untracked `task-9-wave14-report-p2.md` was left untouched).

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `67cda28`: 764 / 0 / 0, exit 0, via `make test-acceptance`** — posture:
  `SOLVENT_ACCEPTANCE=1` (target-set), gate ON (`SOLVENT_LIVE_RPC_TESTS=1`),
  `TEST_DATABASE_URL` → **`solvent_t9w15`** (own scratch DB, created this wave),
  `SOLVENT_DATABASE_URL` + `SOLVENT_RECON_DATABASE_URL` → the LIVE `solvent` database
  (read-only), `SOLVENT_RPC_*`/`SOLVENT_RECON_RPC_*` cleared by the target, PRIVATE
  `TMPDIR` (the codified parallel-wave rule — wave 14 was mid-flight). The gate printed
  **"acceptance mode: exit=0 skips=0"** — acceptance-mode skip count EXPLICITLY ZERO.
  **Sibling reconciliation: 764 = wave-13's 760 + exactly the 4 wave-14 tests**
  (`TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`,
  `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`,
  `TestStepWalkersSlowLandingWalkerCannotStarveSiblings`,
  `TestWalkerRetentionLeaseSpendsWithinOneDaemonRound`), enumerated from the two
  sibling implementation commits.
- **Final @ `7c1fe88`: 768 / 0 / 0, exit 0, same target, same posture** — gate printed
  **"acceptance mode: exit=0 skips=0"**; the DB-backed production-gate test RAN (it is
  in the PASS list), it did not skip.
- **PASS-list diff, both directions: exactly 1 removed, exactly 5 added.** Removed:
  `TestCollectSnapshotReachesNoChainSurface` — the wave-13 AST reachability walk,
  RETIRED BY DESIGN this wave (round-13 F2: name-matching cannot fail against
  indirection; superseded by the snapshotdb structural proofs below — the supersession
  is stated in `phase1_f5_seam_test.go`'s header). Added, all five this wave's:
  `TestEnvSurfaceClosed`, `TestExtremeSnapshotIntervalEnvIsNonPass` (cmd/reconcile),
  `TestSnapshotDBImportsAreDBOnly`, `TestSnapshotDBAPISurfaceRejectsInjection`
  (cmd/reconcile/snapshotdb), `TestProductionGateActiveThroughSnapshotLifecycle`
  (cmd/reconcile, DB-backed). 764 − 1 + 5 = 768; zero sibling test additions in the
  diff window.
- **`-race` (./cmd/reconcile/... incl. snapshotdb) in `golang:1.24` via docker,
  host.docker.internal DSNs: 85 / 0 / 0, exit 0, zero `DATA RACE`, zero skips** — the
  DB-backed gate test ran for real inside the race build (lock choreography + goroutine
  observation is exactly the shape the race detector should vet). 85 = wave-13's 81 +
  5 new − 1 retired.
- **Build/vet**: `go build ./...` + `go vet ./...` clean at HEAD. **Committed-blob
  gofmt**: all 17 touched `.go` blobs at HEAD extracted via `git cat-file` to temp
  files — `gofmt -l` CLEAN (working-tree gofmt stays CRLF-noisy repo-wide; the blob
  check is the bar).
- **Mutation matrix: 6/6 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`), spec committed before the loop (`2f5f556`), tested
  SHA `2f5f556`, exactly-once byte assertions on every edit, in-memory restores
  verified byte-identical, `git status` EMPTY over both mutated files after the loop.
  Every F2 mutant COMPILES (verified by an in-memory-restored `go build ./...` probe
  run BEFORE the spec was committed — the kill is the boundary test's, never the
  compiler's). Loop env: hermetic except W15M6, whose kill test is the DB-backed
  lifecycle test (TEST_DATABASE_URL → `solvent_t9w15`; stated in the spec's meta).

## F1 [high] — the env surface joins the taint domain

**Mechanism chosen: (a) hard acceptance maximum on the env-asserted cadence, AND (b)
the durable-cadence binding that was already in place, now made load-bearing by (a).**

**The cap and its derivation (not a magic number).** `canonicalSnapshotInterval = 1h`
— the daemon's own default cadence: `internal/config` defaults `SnapshotInterval` to
`time.Hour` when the variable is unset, and the plan/Task-7 fixed "full-sweep cadence
`SOLVENT_SNAPSHOT_INTERVAL` (default 1h)". The derivation is the health surface's own
widening rule: the daemon's `collateralStaleBound(interval, lastPass)` widens through
the MEASURED pass duration — durable in `sweep_generations.last_pass_seconds`
(migration 00008), written only by the daemon
(`GREATEST(0, EXTRACT(EPOCH FROM (now() - opened_at)))`), hydrated across restarts —
never through the configured interval, which is an operator assertion. Reconcile's env
copy of that assertion is UNVERIFIABLE (reconcile cannot observe the daemon's
environment, and the schema persists no configured interval), so in acceptance it may
contribute at most its canonical default. The asymmetry is the round-11 loose-positive
law: a TIGHTER-than-1h interval can only strengthen the bound (turn pass into fail —
taint-free), any LOOSER value weakens a required bound (taints). Legitimate wide bounds
on big registries still happen — through `last_pass_seconds`, which reconcile reads
INSIDE the RR snapshot (`store.SweepGenerationRow`) and which no reconcile-side env var
can inflate. **Justification of the source:** durable (survives restarts, round-9
finding), written by the party being audited's OWN measured cadence rather than by the
auditor's environment, and read under the same snapshot isolation as every other DB
fact of the run.

**No silent clamp** (the anti-canon): `resolveSnapshotInterval()` — the ONE reader of
the variable, shared by the bound computation and the taint judge so they cannot drift
— returns an over-cap value as-is; `bound_inputs` records it (plus a new
`snapshot_interval_source` provenance key), and the SAME value taints via
`snapshotIntervalTaint`, so `computeResult` is structurally non-pass (round-10 F2).
Unparseable/nonpositive values taint as belt; `config.Load` refuses them with exit 2
as braces (order in `execute`: taints are computed before `config.Load`, so both hold).

**Wiring that cannot be unwired separately:** `envAcceptanceTaints()` is called INSIDE
`acceptanceTaints(o)` — the one generator every caller (and `execute`) uses — so flag
and env taints flow into `computeResult` as one set. A mutant dropping the wiring dies
with the cap mutant (W15M1 kills through `acceptanceTaints`, not through a direct call
to the env sweep).

**Binding regression** `TestExtremeSnapshotIntervalEnvIsNonPass`:
`SOLVENT_SNAPSHOT_INTERVAL=1000000h` → real resolver → `freshnessBound` = 2000000h
(~228y) → `evaluateFreshness` classifies a TWO-YEAR-stale sweep "fresh" with zero gate
failures (the vacuity demonstrated, not assumed) → `parseFlags(nil)` →
`acceptanceTaints` names `SOLVENT_SNAPSHOT_INTERVAL=1000000h` and the
`last_pass_seconds` channel → `computeResult(0,0,taints)` = `tainted`/exit 1. Then the
same run tightened to `1h` clears both resolver and taints.

### The env-surface table (every env var the binary consumes; enforced by `TestEnvSurfaceClosed`)

| env var | read at | class | rule + reason |
| --- | --- | --- | --- |
| `SOLVENT_SNAPSHOT_INTERVAL` | `resolveSnapshotInterval` (cmd/reconcile, the only reader) + `config.Load` (validation) | **taints** | set and (unparseable OR ≤0 OR >1h) → taint; ≤1h tighter-or-equal is verdict-free (strengthens only). Cap derivation above |
| `SOLVENT_RECON_RPC_OP` / `SOLVENT_RECON_RPC_ETH` | `urlsFor` (literal call sites, scanner-collected) | verdict-free | endpoint PROVENANCE, not a bound: recorded in `run.rpc_source`; every read chain-id-verified and hash-pinned; failures classify into loud aborts; a lying endpoint is the standing rpc-class threat model (second opinions, weld re-runs) — no value converts a failure into a pass |
| `TEST_DATABASE_URL` | DSN-split tripwire only | verdict-free | can only ABORT (exit 2, fail-closed on unverifiable); unset skips a check protecting the DESTRUCTIVE SUITE's target, not this run's verdict; reconcile's session is `default_transaction_read_only=on` regardless |
| `SOLVENT_DATABASE_URL` | `config.Load` (required) | delegated / subject-defining | names the database the claim is ABOUT: recorded as `run.db_name`, schema-gated exactly, session read-only — a different database is a different claim subject visible in the receipt, not a weakened check on the same subject |
| `SOLVENT_RPC_OP` / `SOLVENT_RPC_ETH` | `config.Load` (dynamic `rpcEnv` from `contracts.json`, enumerated by the test from the canonical config) | delegated | fallback endpoint provenance (recorded `"(fallback)"`); same argument as RECON endpoints; the config path that names these keys is itself taint-guarded (`-config`) |
| `SOLVENT_POLL_INTERVAL` | `config.Load` | delegated / unconsumed | daemon ingest cadence; reconcile never references `cfg.PollInterval` (STRUCTURALLY enforced — see below); malformed → exit 2 |
| `SOLVENT_PRICE_INTERVAL` | `config.Load` | delegated / unconsumed | daemon price cadence, positive-only validated; reconcile never references `cfg.PriceInterval`; malformed/nonpositive → exit 2 |
| `SOLVENT_FEED_STALENESS` | `config.Load` | delegated / refused | RETIRED: set at all → `config.Load` errors, exit 2 — a run carrying it never reaches Phase 1 |
| `SOLVENT_HEALTH_ADDR` | `config.Load` | delegated / unconsumed | daemon health bind; reconcile never references `cfg.HealthAddr`; serves no health endpoint |

**How the table is CLOSED (both directions), not prose:** `TestEnvSurfaceClosed`
AST-scans every non-test source of `cmd/reconcile`, `cmd/reconcile/snapshotdb`,
`internal/config`, `internal/chain`, `internal/store` (the binary's first-party
closure; chain and store read no env today and the scan keeps that enforced) for
`os.Getenv`/`os.LookupEnv`: (1) every literal name must be classified; (2) every
DYNAMIC read must match an exact three-entry allowlist (`envAcceptanceTaints`' own
table sweep, `urlsFor`'s parameter — whose call-site literals the scanner collects and
requires literal — and `config.Load`'s `fc.RPCEnv`, enumerated from the canonical
`contracts.json`), with the allowlist size asserted exactly so a removed indirection
cannot mask a new one; (3) REVERSE closure — every table row must correspond to a real
read (stale rows fail); (4) the "unconsumed" claims are structural — any reference to
`.PollInterval`/`.PriceInterval`/`.HealthAddr` in the reconcile packages fails the
test; (5) every mustTaint value drives the REAL `parseFlags → acceptanceTaints →
computeResult` pipeline to non-pass, and canonical/tighter values drive it to
taint-free.

## F2 [medium] — the structural fix: `cmd/reconcile/snapshotdb`

**Choice: the PREFERRED structural fix (package split), not the go/types/SSA
alternative.** Justification for taking the preferred branch rather than arguing
proportionality: every inspection-based predecessor died the same death (wave 11's
data-shape claim, wave 13's named-call walk — both retracted/retired), because an
inspection enumerates shapes while indirection generates them. The package boundary
inverts the burden: instead of proving no bad call is reachable, the code that holds
the open transaction simply CANNOT NAME a dialer. Go's own compiler enforces it on
every build, with no analysis code of ours to have bugs in. What remains analyzable is
two small, closed questions — "what does the package import?" and "what can be loaded
into it?" — each a short AST test over facts aliasing cannot disguise.

**What moved** (commit `4032298`): `collectSnapshot` → `snapshotdb.Collect`, with
everything that runs inside the transaction: `snapshotData` → `snapshotdb.Data` (plain
values, exported fields), the golden DB-side collection (`GoldenDBSide`,
`GoldenAsOfMap`), the invariant scans (`InvariantsSection`/`ScanResult`, identical JSON
tags — the artifact shape is byte-compatible), the weld DB side (`WeldData`), the
rewind baseline (`RewindBaseline` — read in-snapshot; the DETECTOR `rewindMoved` stays
in main, it runs post-commit), and the runtime sentinel (`snapshotdb.Gate` — the
package that opens it owns it; the `pinnedReader` entry points in main consult
`snapshotdb.Gate.Violation` first, unchanged semantics). Flag-derived inputs cross the
boundary as a plain-values `Params` struct; the golden vectors cross as `GoldenSpec`
(pins + borrower addresses). Engine-name constants moved INTO snapshotdb; main aliases
them (`const dmEngine = snapshotdb.DMEngine`) so the packages cannot drift. The two
`resolvePin` aborts became plain errors — observable behavior unchanged (both paths
were exit-2-without-artifact before and after; `execute` maps non-abort runPhase1
errors to exit 2).

**The three proofs:**

1. **`TestSnapshotDBImportsAreDBOnly`** — the EXACT import allowlist (11 entries:
   plain stdlib value/encoding packages + `sync/atomic`, pgx — DB connections are the
   POINT of Stage A — go-ethereum/common value types, internal/config,
   internal/store), asserted on import PATHS so `import web "net/http"` is still
   `"net/http"`. Plus a chain-surface denylist (internal/chain, ethclient,
   go-ethereum/rpc, net/http, net/rpc, websockets) applied both to the package and to
   the DIRECT imports of its first-party deps (store, config) — the closure cannot
   regain a chain surface behind our back. Scope stated honestly: pgx transitively
   uses raw `net` for the database socket, which is allowed and inherent; the F5
   hazard is the CHAIN-RPC surface, and that is what the denylist names.
2. **`TestSnapshotDBAPISurfaceRejectsInjection`** — the injection channel closed: the
   ONLY package-level var (any visibility) is `Gate` (a concrete struct over
   `atomic.Bool` — nothing replaceable); no function type, interface type, or channel
   type anywhere in any declared type or any signature (exported or not — an
   unexported helper taking a callback is the same channel one hop later); exported
   API asserted against an exact allowlist; and NO type assertion anywhere in the
   package, so a capability parked in the one artifact-bound `any` field
   (`ScanResult.Detail`) can never be excavated into something callable. In-package
   interface dispatch can therefore only land on code from allowlisted imports.
3. **`TestProductionGateActiveThroughSnapshotLifecycle`** (DB-backed, closes wave-13
   deviation 6) — the PRODUCTION wiring, observed, never toggled: Collect runs against
   a real migrated database while a control connection holds ACCESS EXCLUSIVE on
   `derive_cursors` (Collect's FIRST in-tx read — proves the gate closes before any
   query follows BeginTx) and then `reorg_epochs` (its LAST — proves it is still
   closed just before commit). Parking is detected via `pg_locks` (database state, not
   wall-clock guessing); while parked, `snapshotdb.Gate.Violation` errors AND a
   zero-value `pinnedReader.headerHash` refuses through the production check-first
   path. Releasing the lock → Collect commits, gate reopens, and Collect's backend
   disappears from `pg_stat_activity` (connection close proven). A third leg cancels
   Collect's context mid-park → the ROLLBACK path also reopens the gate and closes the
   connection. The test runs in acceptance (it is in the final PASS list; skip only in
   dev mode without TEST_DATABASE_URL, FATAL under `SOLVENT_ACCEPTANCE=1` — the house
   guard pattern, including `VerifyDestructiveSplit`). It uses a DERIVED
   package-exclusive database (`solvent_t9w15_recongate`, created+migrated by the
   test) because `go test ./...` runs packages in parallel processes and
   internal/store's destructive helpers own the shared scratch DB — sharing it would
   recreate the wave-13 deviation-1 collision from inside one suite run.

**What the retirement of the AST walk does NOT lose:** the walk's one real kill
(W13M3's reader-parameter smuggle) is now a COMPILE ERROR — snapshotdb cannot
reference `pinnedReader` at all (different package, unexported). The DATA-half
reflection walk (`TestSnapshotDataCarriesNoConnections`) is retained and remains
load-bearing: pgx is legitimately importable in snapshotdb, so a `pgx.Tx` parked in a
result field is invisible to the import test — the reflection walk over
`snapshotdb.Data` still refuses it.

## Mutation matrix (committed applier; spec `2f5f556`, tested SHA `2f5f556`, transcript `7c1fe88`)

| id | finding / evasion shape | mutant (compiles) | killed by |
|---|---|---|---|
| W15M1 | F1 cap-removed | the `d > canonicalSnapshotInterval` branch never fires | `TestEnvSurfaceClosed`, `TestExtremeSnapshotIntervalEnvIsNonPass` |
| W15M2 | F2 aliased import | `import web "net/http"` + `_ = web.DefaultClient` in Collect | `TestSnapshotDBImportsAreDBOnly` |
| W15M3 | F2 package-level function value | `var snapshotRead = func(ctx){ net.Dial(...) }`, called under the open gate | `TestSnapshotDBImportsAreDBOnly` AND `TestSnapshotDBAPISurfaceRejectsInjection` (import + non-Gate var — two independent tripwires) |
| W15M4 | F2 interface dispatch | `Params.Probe interface{ HeaderProbe(ctx) error }`, dispatched inside the tx (ZERO new imports) | `TestSnapshotDBAPISurfaceRejectsInjection` |
| W15M5 | F2 exported hook (function value across the boundary) | `var Hook func(ctx)`, called inside the tx (zero new imports) | `TestSnapshotDBAPISurfaceRejectsInjection` |
| W15M6 | F2 production wiring | `Gate.Enter()/defer Gate.Exit()` dropped from Collect | `TestProductionGateActiveThroughSnapshotLifecycle` (the DB test — proving IT, not review, guards the wiring) |

6/6 KILLED; exactly-one-occurrence asserted per edit; in-memory restores verified
byte-identical; `git status` EMPTY over both mutated files after the loop; compile-
cleanliness of every mutant proven by the pre-commit build probe (in-memory-restored),
so no kill is a disguised compile error.

## New tests this wave (the 5 PASS-list additions)

`cmd/reconcile`: `TestEnvSurfaceClosed`, `TestExtremeSnapshotIntervalEnvIsNonPass`
(env_test.go, new), `TestProductionGateActiveThroughSnapshotLifecycle`
(phase1_gate_db_test.go, new — the package's first DB-backed test).
`cmd/reconcile/snapshotdb`: `TestSnapshotDBImportsAreDBOnly`,
`TestSnapshotDBAPISurfaceRejectsInjection` (boundary_test.go, new).
Retired: `TestCollectSnapshotReachesNoChainSurface` (see PASS-list diff rationale).

## Deviations & residuals (each with reason)

1. **CLI/verdict behavior change (the standing wave-11/13 class):** any invocation in
   an environment carrying `SOLVENT_SNAPSHOT_INTERVAL` looser than 1h (or malformed)
   now exits 1 (`result: tainted`) where it previously could exit 0. Deployments that
   legitimately run a >1h sweep cadence will find every reconcile acceptance run
   tainted until the cadence question is adjudicated; that is the point — the env
   assertion is unverifiable from reconcile, and the honest alternatives (ignore the
   env and misclassify healthy rows as stale, or silently clamp) are both worse. If
   the controller later wants >1h cadences acceptance-clean, the principled path is
   persisting the daemon's CONFIGURED interval durably (a migration — outside this
   wave's file ownership, and outside the closed law's current shape).
2. **The AST reachability walk was REMOVED, not just reduced** — the brief's "AST/types
   test reduced to asserting the import list" is implemented as the two snapshotdb
   boundary tests; the old walk's helpers (`packageFuncDecls`, the forbidden-name
   tables) went with it since name-matching was the disproven mechanism. The PASS-list
   removal is stated above rather than discovered in the diff.
3. **`resolvePin`'s two aborts became plain errors** (snapshotdb cannot import main's
   `runAbort`). Exit codes and artifact behavior are unchanged on both paths (exit 2,
   no artifact — Phase 1 incomplete); the pin-above-cursor message text is preserved
   verbatim. Named because error TYPE is observable to code even when behavior is not.
4. **The production-gate test creates a database** (`solvent_t9w15_recongate`) on the
   scratch cluster at test time. Guarded by the house destructive-guard pattern
   (skip/dev, fatal/acceptance, never `/solvent`, `VerifyDestructiveSplit` against the
   live DSN before anything is created) and package-exclusive by construction. Reason
   in the F2 section (parallel-package DB collision). Never dropped, same lifecycle as
   the wave scratch DBs.
5. **snapshotdb's `os.ReadFile` import**: the config-sha provenance read lives inside
   the snapshot package (it always ran there). `os` is on the allowlist with the
   stated justification (no sockets in `os`); moving the sha computation out to main
   would shrink the allowlist by one entry and is a reasonable future tightening —
   named so the allowlist's one debatable entry is on the record.
6. **The import denylist is DIRECT-imports-deep for store/config**, not fully
   transitive through third-party code (goose, pgx internals). Stated in the test
   itself; the chain-RPC surfaces it names are first-party facts, and a third-party DB
   driver acquiring an ethclient dependency is not a plausible silent drift. The
   honest bar remains: compiler for in-package, exact allowlist for direct, denylist
   for first-party deps.
7. **Interleaved sibling work:** none after baseline (`git log 67cda28..HEAD` = my
   three commits). The sibling's untracked `task-9-wave14-report-p2.md` appeared in
   `git status` mid-wave and was left strictly alone (pathspec staging).

## Unverified (stated plainly)

- The full Phase 1→4 pipeline still has not run end-to-end against the live database —
  the controller's evidence run, by design. The env taints, the `snapshot_interval_source`
  artifact key, and snapshotdb.Collect's first live exercise all happen there. (The
  gate lifecycle itself is now DB-proven in-suite — that specific wave-13 unverified
  item is CLOSED.)
- `getReserveAToken` remains selector-pinned but not live-verified (standing wave-11
  residual, untouched this wave).
- The collateral-replay `not-served` degradation remains as adjudicated (wave-13
  residual 5, untouched).

## Environment safety accounting

The backfill daemon and `solvent-db-1` were never stopped or restarted (container
"Up 2 days (healthy)" at wave start). Live-DB access was read-only and enumerated: the
destructive guard's identity SELECTs (`VerifyDestructiveSplit`) and the recon evidence
scans inside the two acceptance runs (both via `SOLVENT_RECON_DATABASE_URL`,
read-only). Created on the shared cluster: `CREATE DATABASE solvent_t9w15` (the brief's
scratch DB, via docker exec) and `solvent_t9w15_recongate` (by the gate test, guarded;
migrated to v8). Destructive test traffic ran against those two scratch DBs only. Live
RPC: the one pre-existing gate-ON `mainnet.optimism.io` regression dial per suite run —
the mutation loop's kill tests dial nothing (W15M3's `net.Dial` mutant is never
executed by its kill tests, which are static). The `-race` run reached the scratch DBs
via `host.docker.internal` from `golang:1.24`.
