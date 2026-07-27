# Task 9 — wave 16 report: round-14 fixes (linked-library taint domain; ordered cleanup; capability boundary; persisted daemon cadence)

Brief: `task-9-wave16-brief.md` (BINDING — four findings), adjudicating
`task-9-codex-round14.md` (all four ACCEPTED, ratified as the work order).
**Baseline SHA `05ffd9a`** — session-start HEAD. Branch `main`, pathspec staging on
every commit; the scope gate accepted all four commits.

| commit | contents |
| --- | --- |
| `5b53306` | THE IMPLEMENTATION: F1–F4 across `cmd/reconcile/**` (11 files, 3 new test files), `internal/store/**` (migration 00009 + read/write sites + upgrade test), `cmd/indexer/**` (F4 wiring + test) |
| `6dff5f3` | gofmt comment alignment in `pgxenv_db_test.go` (caught by the committed-blob check, not the working tree) |
| `8454ee7` | mutation spec `.superpowers/sdd/t9w16-mutations/mutations.json` (8 mutants), committed BEFORE the loop |
| `c5deebc` | `t9w16-mutations/transcript.md`, **8/8 KILLED** at tested SHA `8454ee7` — code bytes identical `6dff5f3`→HEAD |
| + this report | `task-9-wave16-report-p2.md` |

**Interleaved sibling work, and why both runs used PINNED WORKTREES.** Three controller
docs commits landed between the wave-15 report and my baseline (`4d2b71f`, `6e3ea39`,
`66adaa4`); all docs-only (`git diff --stat 05ffd9a..66adaa4` = 5 files, all under
`.superpowers/sdd/`), so they are inside my baseline and change no test count. Meanwhile a
concurrent **wave-17 ingest wave** was live in the shared tree the whole time: first as
uncommitted edits to `internal/chain/**` + `internal/ingest/**`, then committed as
`ecfe8ce` + `93334b2` AFTER my last commit. Those paths were never staged, never edited,
and never read as inputs — and BOTH acceptance runs were executed in pinned worktrees
(`../Solvent-t9w16-base` at `05ffd9a`, `../Solvent-t9w16-final` at `c5deebc`) so each
measures a stable tree state rather than a sibling's mid-edit one. Numbers below are
therefore baseline-vs-final on MY code only.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `05ffd9a`: 768 / 0 / 0, exit 0, via `make test-acceptance`** — run in a
  PINNED WORKTREE (`../Solvent-t9w16-base`, detached at `05ffd9a`) because the shared tree
  carries a concurrent wave's uncommitted work. Posture: `SOLVENT_ACCEPTANCE=1`
  (target-set), gate ON (`SOLVENT_LIVE_RPC_TESTS=1`), `TEST_DATABASE_URL` → **`solvent_t9w16`**
  (own scratch DB, created this wave), `SOLVENT_DATABASE_URL` + `SOLVENT_RECON_DATABASE_URL`
  → the LIVE `solvent` database (read-only), `SOLVENT_RPC_*`/`SOLVENT_RECON_RPC_*` cleared
  by the target, PRIVATE `TMPDIR`. The gate printed **"acceptance mode: exit=0 skips=0"** —
  acceptance-mode skip count EXPLICITLY ZERO. 768 == wave-15's final, exactly as the brief
  predicted (the interleaved commits shifted nothing).
- **Final @ `c5deebc`: 778 / 0 / 0, exit 0, same target, same posture** — pinned worktree
  `../Solvent-t9w16-final`, `TEST_DATABASE_URL` → `solvent_t9w16`, private `TMPDIR`; the gate
  printed **"acceptance mode: exit=0 skips=0"** and `acceptance suite green: zero skips`.
  Every DB-backed test this wave added RAN (all ten are in the PASS list); none skipped.
- **PASS-list diff, both directions: 0 removed, exactly 10 added** — 768 + 10 = 778, and the
  ten are precisely this wave's new tests: `TestPartialDSNIsRejected`,
  `TestAmbientPGHostTaintsAcceptance`, `TestConnectedIdentityRecordsServerTruth`,
  `TestPersistedDaemonCadenceGovernsFreshnessBound`,
  `TestEnvVsPersistedMismatchTaintsAndNeverWidens`, `TestPreMigrationRowsFallBackFailClosed`,
  `TestSnapshotDBCapabilityBoundary`,
  `TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere`,
  `TestPersistSweepIntervalWritesConfiguredCadence`,
  `TestPersistSweepIntervalToleratesWriteFailure`. Zero sibling test additions in the diff
  window (the pinned worktree excludes wave 17's), zero retirements.
- **`-race` in `golang:1.24` via docker** (`./cmd/reconcile/... ./internal/store/...
  ./cmd/indexer/...` from the pinned final worktree, DSNs at `host.docker.internal`, named
  volume `solvent-gomodcache`, `SOLVENT_ACCEPTANCE=1`, `SOLVENT_RECON_DATABASE_URL` exported
  so the live invariant-evidence tests run rather than skip): **361 / 0 / 0, exit 0, zero
  `DATA RACE`, zero skips**. The DB-backed gate lifecycle test — including leg 4's barrier
  choreography, which is the most concurrency-shaped code this wave added — ran for real
  inside the race build. Its `TEST_DATABASE_URL` points at a SEPARATE scratch database
  (`solvent_t9w16race`) — see deviation 9 for the collision that made that necessary and
  what it cost.
- **Build/vet**: `go build ./...` + `go vet ./cmd/... ./internal/store/...` clean at HEAD.
  **Committed-blob gofmt**: all 17 touched `.go` blobs at HEAD extracted via `git cat-file`
  to temp files — `gofmt -l` CLEAN. The check EARNED its place this wave: it caught comment
  misalignment in `pgxenv_db_test.go` that the CRLF-noisy working-tree check would have
  buried (fixed in `6dff5f3`).
- **Mutation matrix: 8/8 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`), spec committed before the loop (`8454ee7`), tested SHA
  `8454ee7`, exactly-once byte assertions on every edit, in-memory restores verified
  byte-identical, `git status` EMPTY over all three mutated files after the loop. Every
  mutant COMPILES and vets clean (verified by an in-memory-restored `go build ./...` +
  `go vet` probe run BEFORE the spec was committed).
- **Migration no-op safety against the LIVE schema shape**: `pg_dump --schema-only solvent`
  (plus its `goose_db_version` rows) restored into `solvent_t9w16_liveshape` — a v8 database
  with the live shape — then `store.Migrate` ran through the production entry point:
  version 8 → 9, `configured_interval_seconds` present and NULL on the existing
  `sweep_generations` row. The live `solvent` database was never written.

## F1 [high] — the taint domain includes what the LINKED LIBRARIES read

Three mechanisms, because the finding has three distinct failure surfaces (reject the
shape that enables the redirect; taint the inputs that can perform it; record what
actually happened regardless).

**1. Partial DSNs are refused.** `readOnlyDSN` now requires an explicit host AND database
and returns a precondition error otherwise (`execute` maps it to exit 2 before any
connection exists). The derivation is pgx's own merge order, cited below: a complete DSN
cannot be redirected because connection-string settings override env settings; a partial
one delegates the claim's SUBJECT to the environment.

**2. The closed env table grew a LINKED-LIBRARY class**, enumerated from pgx v5.5.1's
actual source in the module cache — never from memory or libpq documentation.

### The pgx v5.5.1 `PG*` enumeration (source-cited; enforced by `TestEnvSurfaceClosed`)

Read site: `pgconn/config.go:405` `func parseEnvSettings()`, whose `nameMap` literal at
**lines 408–425** carries all seventeen names; the read itself is
`value := os.Getenv(envname)` at **line 429**, guarded by `if value != ""` at line 430
(pgx's own emptiness rule — empty string == absent). Merge order:
`pgconn/config.go:245` `mergeSettings(defaultSettings, envSettings, connStringSettings)`
— **connString wins, env fills the gaps**, which is exactly why a complete DSN is immune
and a partial one is not.

| pgx env var | pgx setting (nameMap) | what it can do to the run | class | rule |
| --- | --- | --- | --- | --- |
| `PGHOST` | `host` | chooses the SERVER under a hostless DSN — the finding's exact vector | linked-library | presence taints |
| `PGPORT` | `port` | chooses the port (a different postmaster on one host) | linked-library | presence taints |
| `PGDATABASE` | `database` | chooses the claim's SUBJECT under a database-less DSN | linked-library | presence taints |
| `PGUSER` | `user` | changes the role, hence row visibility (RLS) and defaults | linked-library | presence taints |
| `PGPASSWORD` | `password` | supplies credentials for a redirect target | linked-library | presence taints |
| `PGPASSFILE` | `passfile` | same, from a file | linked-library | presence taints |
| `PGAPPNAME` | `application_name` | reshapes `pg_stat_activity` identity the DB tests observe | linked-library | presence taints |
| `PGCONNECT_TIMEOUT` | `connect_timeout` | replaces the dial func (`config.DialFunc`, config.go:270) | linked-library | presence taints |
| `PGSSLMODE` | `sslmode` | transport trust: `disable` on a routed host removes the only channel guarantee | linked-library | presence taints |
| `PGSSLKEY` / `PGSSLCERT` / `PGSSLROOTCERT` / `PGSSLPASSWORD` / `PGSSLSNI` | `ssl*` | client identity + which CA/host the transport trusts | linked-library | presence taints |
| `PGTARGETSESSIONATTRS` | `target_session_attrs` | selects among fallbacks (e.g. prefer a standby — a different xmin horizon) | linked-library | presence taints |
| `PGSERVICE` / `PGSERVICEFILE` | `service` / `servicefile` | pulls a WHOLE connection profile from a file (`config.go:246-253` re-merges with the service's settings) | linked-library | presence taints |
| `APPDATA` | (not in nameMap) | `pgconn/defaults_windows.go:20` — default passfile path `%APPDATA%/postgresql/pgpass.conf`; Windows only | linked-library | **classified, verdict-free** |

**Why presence, not value analysis.** These are SUBJECT inputs, not bound inputs: reconcile
cannot verify from inside the run that an ambient `PGHOST` was harmless, and an acceptance
environment has no legitimate reason to carry any of them (the DSNs are complete by
construction, mechanism 1). So presence is fail-closed tainted — the same blanket treatment
as `-accounts`. Empty string does NOT taint, and that is deliberate: it mirrors pgx's own
rule at config.go:430, so "neutralized" and "unset" are the same state for the library and
for us.

**Why `APPDATA` is the one verdict-free linked row.** It cannot alter host, port, database
or user — it only locates a default passfile, and a wrong password aborts loudly rather
than flipping a verdict. It is also unconditionally set on every Windows session, so a
presence taint would refuse every Windows run while proving nothing. Classified, justified,
enforced as verdict-free.

**How the table is CLOSED over the LIBRARY, both directions.** `TestEnvSurfaceClosed`
scans pgx's module source at test time (`go list -m -f {{.Dir}}` → walk, skipping
`examples/` and `testdata/`): it extracts the `parseEnvSettings` nameMap keys AND every
literal `os.Getenv`/`os.LookupEnv` argument in the module's non-test sources. Every name
found must be classified linked-library; every linked-library row must correspond to a
read that exists in the linked module; and `pgxEnvSurface` (the list the taint rows are
BUILT from) must equal the nameMap exactly. **A pgx upgrade that grows the env surface
fails the suite until the table is re-closed over it** — the enumeration is not a snapshot
of today's pgx, it is a live check against whatever pgx is linked. The scan deliberately
ignores build constraints (`go/parser` does not apply them), so `defaults_windows.go`'s
`APPDATA` read is enumerated on every platform: a closure claim about a linked module
should not be narrower on Linux than on Windows. Verified both ways — the closure test
passes in the Windows acceptance run and in the Linux `-race` container.

**3. The artifact records CONNECTED identity, not parsed intent.**
`snapshotdb.readConnectedIdentity` reads `current_database()`, `inet_server_addr()`,
`inet_server_port()`, `current_setting('server_version')`, plus the wave-10/11 PHYSICAL
identity (`pg_control_system().system_identifier`, database OID) — over the SAME connection
INSIDE the SAME repeatable-read transaction every DB fact of the run came from. It fails
CLOSED (an unresolvable or incomplete identity is an error, same law as
`store.DatabaseIdentity`). `execute` writes it to `run.db_name` and `run.db_identity`; the
DSN's parsed name survives only as `run.db_name_claimed`, explicitly labelled a claim. It
is read via system functions only, before any relation read, so Collect's first LOCKABLE
read is still `derive_cursors` — the lifecycle test's park point is unchanged.

**Binding regression** (`pgxenv_db_test.go`, DB-backed, guarded by the house
destructive-split pattern): leg 1 REPRODUCES the finding's mechanism — a database-less DSN
plus ambient `PGDATABASE` really does land on the ambient database in this exact pgx
version — and proves the recorded identity followed the SERVER (database name, cluster
system_identifier and OID all matching an independent control connection). Leg 2 shows a
COMPLETE DSN shrugging off an ambient `PGDATABASE` pointing at the live database's name.
Plus `TestPartialDSNIsRejected` (five partial shapes) and
`TestAmbientPGHostTaintsAcceptance` (the finding's own variables through
parseFlags → acceptanceTaints → computeResult).

## F2 [medium] — ONE ordered cleanup; the gate exits LAST

**The shape.** The three stacked defers (`defer conn.Close` → `defer tx.Rollback` →
`defer Gate.Exit`) are gone. `Collect` registers a SINGLE deferred function whose internal
order is explicit: `tx.Rollback` → `conn.Close` → `gate.Exit`. On the success path the
commit-and-close already ran in order and the deferred function performs only the gate
exit (`released` flag). The `BeginTx` failure path closes the connection and returns
without ever entering the gate.

**Cleanup context.** The ordered cleanup runs on `context.WithoutCancel(ctx)` bounded by
`cleanupTimeout = 30s`. A canceled run must still release the server gracefully rather
than abandoning the backend, and the bound is deliberately wide because WHILE cleanup runs
the gate is still CLOSED — a slow cleanup errs in the fail-closed direction (RPC stays
refused), never the open one.

**The observation seam.** `Sentinel` gained three barriers (`StageBeforeRollback`,
`StageBeforeClose`, `StageAfterClose`) with `HoldAt` / `Arrived` / `ResetArrivals`. They
are **bools, not hooks**: a barrier can only DELAY the fixed order — it cannot skip a step,
reorder them, or carry a callable — and its worst effect is keeping the gate closed longer.
Cost when disengaged: one atomic load per stage per run.

**Test (binding)** — `TestProductionGateActiveThroughSnapshotLifecycle` leg 4 observes the
gate DURING each step, against server-side truth:

| checkpoint | gate asserted | server-side truth asserted |
| --- | --- | --- |
| before rollback | CLOSED (and the production `pinnedReader` path refuses) | Collect's backend still holds a transaction block (`pg_stat_activity.state LIKE 'idle in transaction%'`) |
| before close | CLOSED (production path refuses) | zero transaction blocks; the backend still CONNECTED |
| after close | CLOSED — and Collect has NOT returned | — (the gate exit is the only step left) |

**The error is induced SERVER-SIDE** (`lock_timeout=1000` as a DSN runtime parameter on
Collect's own session), never by canceling the context: pgx v5.5.1 answers a canceled
watched context by force-deadlining and `asyncClose`-ing the connection
(`pgconn.go` `newContextWatcher` / `asyncClose`), which would make the cleanup's rollback
and close client-side no-ops and every server-side observation racy. A lock-timeout leaves
the CONNECTION healthy and the transaction open-but-aborted, so the ordered cleanup
performs a REAL rollback and a REAL close.

Two honest details found while building it, both recorded in the test: Postgres NULLs
`xact_start` for `idle in transaction (aborted)`, so backend STATE is the honest observable
for "the transaction block still exists"; and `pg_stat_activity` is snapshot-stable inside
a transaction, so the observations run over a dedicated autocommit connection rather than
the lock-holding control connection.

**Mutation W16M2** (gate exits first — the LIFO order restored) dies at the
before-rollback observation. Its post-return state is INDISTINGUISHABLE from the fix's
(gate open, connection closed), which is precisely why round 14 found this by reading
defer registration order rather than by running the old test.

## F3 [medium] — a CAPABILITY boundary, not a namespace boundary

**`os` is gone.** The config-sha read moved to `cmd/reconcile` (`runPhase1` computes it and
passes `Params.ConfigSHA` as a plain value); `snapshotdb`'s import list no longer contains
`os` at all. The principle now stated in the allowlist's comment: an entry earns its place
by its WHOLE capability set being acceptable — `os` granted `StartProcess` for the price of
one `ReadFile`. Read-failure semantics are unchanged (empty hash, run continues).

The allowlist is now: `context`, `encoding/hex`, `fmt`, `math/big`, `sync/atomic`, `time`,
`go-ethereum/common`, `pgx/v5`, `internal/config`, `internal/store`. (`crypto/sha256` left
with the config read; `time` joined for the cleanup timeout and the barrier sleep — clocks,
no I/O.)

**The gate is non-assignable.** `var Gate` was itself an injection surface — any importer
could write `snapshotdb.Gate = &Sentinel{}` and hand the `pinnedReader` checks a decoy
while Collect held the real one. The var is now unexported (`gate`) and reached through
`func Gate() *Sentinel`. A function's identity cannot be reassigned. Justification for the
accessor over the alternatives (a getter method on a wrapper type, or `sync.Once`
initialization): the accessor is the smallest change that makes the property a
COMPILE-TIME fact for every importer, with no runtime state and no new type.

**Semantic resolution.** New `TestSnapshotDBCapabilityBoundary` typechecks the package with
`go/types` (export data located via `go list -export -deps`, i.e. the same toolchain that
builds the tests) and walks every declared type and every signature — exported and not —
resolving each component to its UNDERLYING type. A NAMED interface is refused exactly where
a literal one is. The justified allowlist, each with its argument:

| permitted interface | why it is not a capability |
| --- | --- |
| `error` | one method returning a string |
| `context.Context` | required by every DB call; its escape hatch is `Value() any`, and the package-wide ban on type assertions AND type switches means an `any` can never become callable |
| `any` / `interface{}` | zero methods — nothing can be called on it; same excavation ban |
| `store.Querier` (UNEXPORTED positions only) | the in-package DB-query seam; values are constructed in-package from pgx objects, and unexported functions cannot be called from outside. In an EXPORTED position it is exactly the W15M4 injection channel — and is refused there (mutation W16M5) |

The AST test also grew a `TypeSwitchStmt` ban: a type switch is a type assertion in
different clothes, and the old check spelled only the assertion.

**Call-site discipline over inherent capabilities.** An import allowlist cannot say "pgx,
but only to OUR database" — `pgx.Connect` dials whatever DSN it is handed. So the boundary
now pins the call sites: EXACTLY ONE pgx dial in the package, it must be `pgx.Connect`, and
its second argument must be Collect's `roDSN` PARAMETER (never a literal or a rebuilt
string). Calls INTO `internal/config` are refused outright — it is imported for its TYPES
(plain data crossing the boundary), and calling `config.Load` would re-acquire file and env
capabilities through a first-party door immediately after evicting `os`.

**Negative mutants, one per evasion shape, each demonstrably KILLED:**

| shape | mutant | killed by |
| --- | --- | --- |
| (a) `os` reintroduced | `os` re-imported with a real `os.ReadFile` use | `TestSnapshotDBImportsAreDBOnly` (import-list assertion) |
| (b) capability through a still-allowed package | a SECOND `pgx.Connect` to an attacker host, opened under the closed gate — **zero new imports**, the sharpest shape the remaining allowlist permits | `TestSnapshotDBCapabilityBoundary` (call-site discipline) |
| (c) named-interface indirection | exported `Q store.Querier` field on `Params`, dispatched inside the transaction — the AST sees a `SelectorExpr`, never an `InterfaceType`, so the wave-15 checks pass it | `TestSnapshotDBCapabilityBoundary` (go/types underlying-type resolution) |

Shape (c) is worth naming precisely: it is killed by the go/types layer ALONE. The AST
test passes it, which is the demonstration that round 14's spelling objection was real
rather than theoretical.

## F4 [medium] — the daemon's REAL freshness rule, from durable state

**MECHANISM CHOSEN: the PRIMARY (mandated) one — additive migration + daemon write +
persisted-row evaluation.** The alternative (enforce ≤1h as a daemon configuration
contract) was not taken: it would refuse a cadence the daemon legitimately supports, on the
authority of a number reconcile picked, and it leaves the unverifiable-operator-assertion
objection standing. The primary dissolves both.

**Migration lineage.** `internal/store/migrations/00009_sweep_configured_interval.sql`:
`ALTER TABLE sweep_generations ADD COLUMN configured_interval_seconds BIGINT`. Additive,
on the same one-row-per-engine durable surface that already carries the sweep evidence —
00004 created `sweep_generations`, 00006 added `last_success_at`, 00008 added
`last_pass_seconds`. Seconds, like `last_pass_seconds`, for the same reason (consumed as a
`time.Duration`; whole-second resolution is orders of magnitude finer than a doubled bound
can distinguish). Nothing in 00001–00008 was edited (the 00003 incident's law).

**NULLABLE, NO BACKFILL — deliberately.** No historical record of the configured interval
exists; it lived in process environments. Backfilling the 1h default would manufacture
exactly the unverifiable operator assertion the column exists to REPLACE, and would
silently retire the fallback path. NULL means "no daemon has written its cadence yet".

**The daemon writes it.** `store.RecordSweepConfiguredInterval` (UPDATE-only, guarded by
`IS DISTINCT FROM`, refuses nonpositive cadences) is called by `cmd/indexer` once before
the first verdict (beside the existing `collateral.hydrate`) and once per round beside the
snapshot pass. UPDATE rather than upsert because `OpenSweepGeneration` owns row creation —
an upsert would have to invent `current_generation`/`opened_at` for an engine that never
opened a sweep. A failed write is logged and TOLERATED: the value is evidence FOR
reconcile, whose absence-fallback is fail-closed, so an unlanded write can only make
reconcile STRICTER. Nothing that opens or completes a generation names the column, so the
value survives opens, completions and rewind bumps exactly as `last_pass_seconds` does
(00008's load-bearing omission) — asserted in the upgrade test.

**Reconcile evaluates the daemon's rule from the persisted row.**
`sweepCadenceEvaluation(sweep)` is the ONE evaluator — bound, `bound_inputs` and taints come
out of a single judgment, so they cannot drift:

- **Persisted interval present:** `bound = 2*(interval + lastPass)` — the additive form
  `collateralStaleBound` (cmd/indexer) actually enforces, which wave 15's
  `max(2×interval, 2×lastPass)` could not reproduce and which is therefore the whole
  fail-forever mechanism. The daemon's `noProgressBound` floor is OMITTED: omitting a floor
  only ever TIGHTENS the bound (errs red, never green). Provenance is recorded as
  `sweep_generations.configured_interval_seconds (daemon-written, read in-snapshot)`.
- **The env var is demoted to a cross-check.** Set and different from persisted → taint,
  in BOTH directions (a wider claim is the loosening attack; a tighter one still means some
  environment is lying about the deployment). The env value NEVER feeds the bound.
  Unparseable/nonpositive keeps its pre-DB syntax taint (belt; `config.Load`'s exit 2 is
  braces).
- **FALLBACK SEMANTICS (rows predating 00009, or a daemon that has not yet written):**
  wave 15's law VERBATIM — `max(2×env-or-1h-default, 2×lastPass)` with the 1h acceptance cap
  tainting any looser env claim, no silent clamp (the recorded bound tells the whole story),
  and `bound_inputs["fallback"]` stating the situation. **Fail-closed, never fail-forever:**
  a 2h deployment stays tainted only until its daemon persists the cadence — one restart,
  not forever. A corrupt persisted value (nonpositive) falls back AND carries its own taint.

**Wiring:** the cadence taints are DB-aware, so they join the run's ONE taint set in
`execute` right after Phase 1 (`p1.cadenceTaints`), flowing into the same `computeResult`
as every other taint. They are computed on EVERY path — an explicit `-snapshot-max-age`
included — because an env claim contradicting durable daemon state is a lie about the
deployment whichever bound this run gates with.

**Binding regressions** (`cadence_f4_test.go`):

| regression | assertion |
| --- | --- |
| persisted 2h + 1h pass, zero failures | bound 6h; a 5h-old sweep classifies FRESH; zero taints; `computeResult(0,0,nil)` == **pass** — the fail-forever posture DIES |
| env-vs-persisted mismatch (wider) | taint; bound stays 6h (never widened) |
| env-vs-persisted mismatch (tighter) | taint; bound stays 6h |
| pre-migration rows | wave-15 fallback shape (2h from the default, 6h when `lastPass` widens it — taint-free through the durable channel); loose env claim → recorded honestly AND tainted |
| corrupt persisted value | fallback + its own taint |

`TestExtremeSnapshotIntervalEnvIsNonPass` (wave 15's regression) is retained and extended:
the 1000000h claim is still non-pass through the fallback, and with ANY persisted cadence
it is a mismatch taint whose bound comes from the persisted value.

## Mutation matrix (committed applier; spec `8454ee7`, tested SHA `8454ee7`, transcript `c5deebc`)

| id | finding / shape | mutant (compiles) | killed by |
|---|---|---|---|
| W16M1 | F1 taint | pgx `PG*` presence taint never fires | `TestEnvSurfaceClosed`, `TestAmbientPGHostTaintsAcceptance` |
| W16M2 | F2 ordering | gate exits FIRST (LIFO restored) | `TestProductionGateActiveThroughSnapshotLifecycle` (the DURING observation) |
| W16M3 | F3 (a) | `os` reintroduced + used | `TestSnapshotDBImportsAreDBOnly` |
| W16M4 | F3 (b) | second `pgx.Connect` to an attacker host under the open gate (zero new imports) | `TestSnapshotDBCapabilityBoundary` |
| W16M5 | F3 (c) | exported `store.Querier` field, dispatched in-tx (no interface literal anywhere) | `TestSnapshotDBCapabilityBoundary` |
| W16M6 | F4 | persisted-read replaced by env-read | `TestPersistedDaemonCadenceGovernsFreshnessBound`, `TestEnvVsPersistedMismatchTaintsAndNeverWidens`, `TestExtremeSnapshotIntervalEnvIsNonPass` |
| W16M7 | F1 rejection | partial-DSN rejection never fires | `TestPartialDSNIsRejected` |
| W16M8 | F1 recording | connected-identity read dropped | `TestConnectedIdentityRecordsServerTruth` |

8/8 KILLED; exactly-one-occurrence asserted per edit; in-memory restores verified
byte-identical; `git status` EMPTY over all three mutated files after the loop.

**A process note worth recording:** the first spec draft used multi-line search patterns
spelled with `\n`. The working tree here is CRLF (git `core.autocrlf=true` normalizes on
commit), so all six multi-line patterns matched NOTHING — the exact wave-12 trap the
applier's exactly-once assertion exists to refuse. The pre-commit compile probe surfaced it
as `NOT APPLIED` before the spec was committed, and every anchor was rewritten as a single
line (convention-independent). Without the applier's refusal those six would have been
recorded as SURVIVED — or worse, silently as KILLED-by-nothing.

## New tests this wave

`cmd/reconcile`: `TestPartialDSNIsRejected`, `TestAmbientPGHostTaintsAcceptance`,
`TestConnectedIdentityRecordsServerTruth` (DB-backed) — `pgxenv_db_test.go`, new;
`TestPersistedDaemonCadenceGovernsFreshnessBound`,
`TestEnvVsPersistedMismatchTaintsAndNeverWidens`, `TestPreMigrationRowsFallBackFailClosed`
— `cadence_f4_test.go`, new.
`cmd/reconcile/snapshotdb`: `TestSnapshotDBCapabilityBoundary` — the go/types layer.
`internal/store`: `TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere`.
`cmd/indexer`: `TestPersistSweepIntervalWritesConfiguredCadence`,
`TestPersistSweepIntervalToleratesWriteFailure`.
EXTENDED (never weakened): `TestProductionGateActiveThroughSnapshotLifecycle` (leg 4),
`TestEnvSurfaceClosed` (linked-library closure + PG* pipeline legs),
`TestExtremeSnapshotIntervalEnvIsNonPass` (persisted-cadence arm),
`TestSnapshotDBAPISurfaceRejectsInjection` (unexported gate, type-switch ban).
Retired: none.

## Deviations & residuals (each with reason)

1. **CLI/verdict behavior change (the standing wave-11/13/15 class), in BOTH directions
   this wave.** TIGHTER: any invocation carrying a pgx `PG*` variable now exits 1
   (`result: tainted`), and a partial DSN now exits 2 where it previously connected. LOOSER
   (deliberately, this is F4): a deployment whose daemon has persisted a >1h cadence now
   PASSES where wave 15 tainted unconditionally. Both are the findings' intent.
2. **`run.db_name` changed meaning.** It is now the SERVER-reported database; the DSN's
   parsed name moved to `run.db_name_claimed` (new key). Artifact consumers reading
   `db_name` get a strictly more truthful value under the same key; the new key is additive.
   `run.db_identity` (object) is new.
3. **Schema version 8 → 9.** `store.ExpectedSchemaVersion` is derived from the embedded
   migrations, and reconcile's Phase-0 gate is EXACT equality, so **a reconcile binary at
   this commit refuses a database that has not run 00009** (exit 2, "reconcile never
   migrates"). That is the gate working as designed, but it is an ordering constraint for
   the controller's evidence run: migrate the live database (or restart the daemon on the
   new binary, which migrates at startup) before running reconcile. The two version
   constants that encode the expectation (`internal/store`'s `currentSchemaVersion` test
   const and `reconcile_test.go`'s pin) were bumped with the migration, which is the house
   rule that a migration cannot land without its own upgrade proof.
4. **`Params.ConfigPath` → `Params.ConfigSHA`** — an API change to `snapshotdb`, named
   because it is observable to code even though behavior is identical (the same bytes are
   hashed, one stack frame earlier).
5. **The Sentinel gained a test-facing API** (`HoldAt`/`Arrived`/`ResetArrivals`). This is
   production code shaped for observability, which the house normally resists. The argument:
   round 14's finding was invisible to a post-return test BY CONSTRUCTION, so the ordering
   can only be proven by observing it in progress; the barriers are delay-only bools that
   cannot skip, reorder or inject anything, and their failure mode (a stuck barrier) keeps
   the gate CLOSED. Named here so the reviewer weighs it rather than discovers it.
6. **The go/types boundary test shells out to `go list -export -deps`.** It needs export
   data for pgx and the first-party deps, and `golang.org/x/tools/go/packages` is not a
   dependency (adding one for a test would be a heavier change than the shell-out). The test
   fails loudly if `go list` fails. Same shape as the existing module-cache scan in
   `TestEnvSurfaceClosed`.
7. **The import denylist remains DIRECT-imports-deep for store/config** (wave-15 residual 6,
   unchanged), and pgx transitively uses raw `net` for the database socket — inherent, and
   now bounded at the call-site level rather than only at the import level (F3 mechanism 3).
8. **`internal/chain` / `internal/ingest` were dirty in the shared tree throughout** (the
   concurrent wave-17 ingest wave, which then committed `ecfe8ce` + `93334b2` after my last
   commit). Never staged, never edited, never read as inputs; every commit used explicit
   pathspecs and the scope gate accepted all four.
9. **A self-inflicted scratch-DB collision, disclosed in full.** My first final-verification
   attempt ran `make test-acceptance` and the docker `-race` suite CONCURRENTLY against the
   same scratch database (`solvent_t9w16`), in the shared (sibling-dirty) tree. Both runs
   reported failures — 17 in acceptance, 10 in the race run — all in `internal/store`'s
   destructive tests and `internal/ingest` (the sibling's mid-edit code), with signatures
   that are unmistakably cross-run state contention (e.g. "unacknowledged reorg epoch 129
   ... acked 0" in `TestPollAnchorRetentionIsBounded`). This is the wave-13 deviation-1
   collision reproduced by my own scheduling, not by the code. Both runs were REDONE
   serialized, from pinned worktrees, with the race run on its own database
   (`solvent_t9w16race`); the numbers reported above are the redone runs. The discarded runs
   are named here rather than quietly dropped, because "we re-ran it and it went green" is
   exactly the shape a reviewer must be able to audit.

## Unverified (stated plainly)

- **The full Phase 1→4 pipeline still has not run end-to-end against the live database** —
  the controller's evidence run, by design. First live exercise of: the connected-identity
  read and the two new artifact keys, the PG* taint set against a real operator
  environment, and the F4 persisted-cadence path.
- **`configured_interval_seconds` is NULL in the live database right now.** The running
  daemon predates this wave and was NOT restarted or signaled (brief rule). Until the
  controller restarts it, a live reconcile run takes the FALLBACK path — wave-15 semantics,
  fail-closed. The first post-restart daemon round lands the value; the persisted path is
  proven in-suite (unit + the DB-backed upgrade test) but has not yet been exercised
  against a value this deployment's own daemon wrote.
- **The daemon-side write is proven against a fake writer and against the store directly**
  (`TestPersistSweepIntervalWrites…` + the upgrade test's write-path legs); the full
  daemon-loop wiring (startup call + per-round call) is not covered by a running-daemon
  test — `cmd/indexer`'s round loop has no harness for that, and building one was out of
  scope for an F4 wiring change. The call sites are two lines beside existing, tested calls.
- `getReserveAToken` remains selector-pinned but not live-verified (standing wave-11
  residual, untouched).
- The collateral-replay `not-served` degradation remains as adjudicated (wave-13 residual 5,
  untouched).

## Environment safety accounting

The backfill daemon and `solvent-db-1` were never stopped, signaled or restarted (container
"Up 2 days (healthy)" at wave start and at wave end). Live-DB access was read-only and
enumerated: the destructive guard's identity SELECTs, the recon evidence scans inside the
two acceptance runs, and one `pg_dump --schema-only` of `solvent` for the migration
no-op-safety proof (read-only by definition; restored into a SCRATCH database). Created on
the shared cluster: `solvent_t9w16` (the brief's scratch DB), `solvent_t9w16_recongate` and
`solvent_t9w16race_recongate` (by the DB-backed tests, guarded), `solvent_t9w16_liveshape`
(the live-schema migration proof), `solvent_t9w16race` (the `-race` run's own database,
after deviation 9). Destructive test traffic ran against those only. Two pinned worktrees
(`../Solvent-t9w16-base` at `05ffd9a`, `../Solvent-t9w16-final` at `c5deebc`) are the only
other artifacts on disk; each carries a copy of the gitignored `.env` (never committed).
Live RPC: the one pre-existing gate-ON `mainnet.optimism.io` regression dial per suite run;
the mutation loop's kill tests dial nothing. The `-race` run reached its scratch DB via
`host.docker.internal` from `golang:1.24`.
