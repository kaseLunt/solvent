# Task 9 — wave 19 report: round-16 fixes (the claim is what pgx computes; APPDATA joins the verdict; capability closure over first-party calls; cadence generation-bound, the widening fallback dies)

Brief: `task-9-wave19-brief.md` (BINDING — four findings), adjudicating
`task-9-codex-round16.md` (all four ACCEPTED). **Baseline SHA `e3a14aa`** —
session-start HEAD; the tip advanced to `69aedd0` mid-wave (verified
docs-only: `git diff --stat e3a14aa..69aedd0` = 2 files, both under
`.superpowers/sdd/` — round 18 came back SHIP with zero findings, so the
794/0/0 baseline carries to `69aedd0` unchanged). Branch `main`, pathspec
staging on every commit; the scope gate accepted all six.

**RECOVERY DISPATCH.** The predecessor agent was killed mid-wave by a session
teardown, leaving ZERO commits and a partial M1 draft uncommitted in the main
tree; this wave was ALSO interrupted once itself (session limit) with all
uncommitted state surviving. The predecessor draft's disposition is a named
section below — it was read critically, verified against pgx's source, partly
adopted, corrected where wrong, and completed where it stopped.

| commit | contents |
| --- | --- |
| `c5d0469` | THE IMPLEMENTATION: M1–M4 across `cmd/reconcile/**` (pgxdsn.go + pgxdsn_test.go new; env/freshness/main + boundary_test hardening), `internal/store/**` (migration 00010, generation-bound read/write, upgrade + binding tests), `cmd/indexer/**` (write-failure surfacing) — 21 files |
| `0efec51` | mutation spec `.superpowers/sdd/t9w19-mutations/mutations.json` (9 mutants), committed BEFORE the loop |
| `874c9de` | transcript #1: **9/9 KILLED** at tested SHA `0efec51` |
| `10761f8` | comment-ONLY citation-precision fix (the client cert/key span pinned to `:702-704` + `:706-755`; 3 files, 2 of them mutation targets) |
| `063d958` | transcript RE-RUN at tested SHA `10761f8`: **9/9 KILLED again** — because 10761f8 touched two mutated files, the loop was re-run so the byte-identity claim names the real code SHA (disclosed, not silently carried) |
| + this report | `task-9-wave19-report-p2.md` |

## Predecessor-draft disposition (stated plainly)

The dead predecessor left `cmd/reconcile/pgxdsn.go` (untracked) and a
modified `cmd/reconcile/main.go`. Treated as an unverified draft:

- **`pgxConnStringSettings` / `effectiveDSNClaim` — ADOPTED after
  verification.** Every cited pgconn line was re-checked against the module
  cache (`pgx/v5@v5.5.1`); all held. One gap found and FIXED: the draft
  applied URL semantics to ANY parseable string, but pgx dispatches URL
  parsing only for `postgres://`/`postgresql://` prefixes
  (pgconn/config.go:232-238) — a `mysql://db/x` DSN would have received a
  claim under semantics pgx never applies. The replication now refuses
  non-URL-form strings outright (regression: `TestKeywordAndForeignSchemeDSNsRefused`).
- **`readOnlyDSN` rewrite and `dbNameClaimed` — ADOPTED** (verified against
  the same sources; the refusal message still names PG*, which the standing
  regression asserts).
- **`claimVsConnectedTaint` — DEFINED BUT NEVER WIRED.** The draft declared
  the judge with zero call sites: the mismatch was still informational — the
  exact posture round 16 rejected. WIRED into `execute` after Phase 1's
  connected-identity read, joining the one taint set (regression:
  `TestClaimVsConnectedMismatchTaints`; mutant W19M2).
- **`trustMaterialPinned` — ADOPTED after verification**, with one citation
  span corrected (`:704-757` → pair-required check `:702-704`, loading
  `:706-755`; the comment-only fix is commit `10761f8`).
- **M2 wiring, M3, and M4 did not exist in the draft** — implemented fresh.
- The draft's cross-check test (`TestDSNEffectiveClaimMatchesPgxParseConfig`)
  was named in its comments but not written; written this wave.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `e3a14aa`: 794 / 0 / 0, exit 0, via `make test-acceptance`** —
  PINNED WORKTREE `../Solvent-t9w19-base` (re-pinned from the predecessor's
  846c241 to the session-start HEAD). Posture: `SOLVENT_ACCEPTANCE=1`
  (target-set), gate ON (`SOLVENT_LIVE_RPC_TESTS=1`), `TEST_DATABASE_URL` →
  **`solvent_t9w19`** (own scratch DB), `SOLVENT_DATABASE_URL` +
  `SOLVENT_RECON_DATABASE_URL` → the LIVE `solvent` database (read-only),
  `SOLVENT_RPC_*`/`SOLVENT_RECON_RPC_*` cleared by the target, private
  `TMPDIR`. The gate printed **"acceptance mode: exit=0 skips=0"**. 794 ==
  wave 18's final, exactly as the dispatch predicted.
- **Final @ `063d958`: 802 / 0 / 0, exit 0, same target, same posture** —
  pinned worktree `../Solvent-t9w19-final`, gate printed **"acceptance mode:
  exit=0 skips=0"** and `acceptance suite green: zero skips`. 794 − 3 + 11 =
  802, exactly the arithmetic the change list predicts.
- **PASS-list diff, both directions: 3 removed, 11 added — reconciled
  name-for-name below.** Every removal is a test whose LAW round 16 killed,
  each replaced by a strictly stronger assertion in the same file (named in
  the deviations).
- **`-race` in `golang:1.24` via docker** (`./cmd/reconcile/...
  ./internal/store/... ./cmd/indexer/...` from the pinned final worktree,
  DSNs at `host.docker.internal`, named volume `solvent-gomodcache`,
  `SOLVENT_ACCEPTANCE=1`, gate ON, `SOLVENT_RECON_DATABASE_URL` exported,
  `TEST_DATABASE_URL` → **`solvent_t9w19race`** — its own database, the
  wave-16 deviation-9 lesson, and the run was SERIALIZED after the
  acceptance run): **369 / 0 / 0, exit 0, zero `DATA RACE`, zero skips**
  (wave 16's 361 + the same net +8 the acceptance diff shows — all removals
  and additions live inside these four packages). Package times: reconcile
  3.6s, snapshotdb 5.3s, store 219.1s, indexer 3.0s.
- **Build/vet**: `go build ./...` + `go vet ./...` clean at HEAD.
  **Committed-blob gofmt**: all touched `.go` blobs at HEAD extracted via
  `git cat-file` — `gofmt -l` CLEAN (the working-tree check stays CRLF-noisy
  and was not used as evidence). One alignment issue was caught BEFORE the
  impl commit this wave (pgxenv_db_test.go comment column), so no
  post-commit fixup commit exists for formatting.
- **Mutation matrix: 9/9 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`, historical name), spec committed before the
  loop (`0efec51`), run twice — tested SHA `0efec51` (9/9) and re-run at
  tested SHA `10761f8` (9/9) after the comment-only citation fix touched two
  mutated files. Exactly-once byte assertions on every edit; in-memory
  restores verified byte-identical; `git status` EMPTY over all six mutated
  files after both loops. Every mutant was pre-verified (before the spec was
  committed) to apply exactly once, `go build ./...`, and `go vet` clean via
  an in-memory probe — the wave-16 CRLF lesson, applied preemptively.

## M1 — the claim is what the library computes (pgx-semantics mechanism, source-cited)

**The mechanism.** `cmd/reconcile/pgxdsn.go` replicates the
CONNECTION-STRING HALF of pgx v5.5.1's database selection, and nothing else:

- Dispatch: only `postgres://`/`postgresql://` strings are URL-parsed
  (pgconn/config.go:232-236, from ParseConfig :216 → ParseConfigWithOptions
  :224); everything else is keyword/value DSN territory (:238) and is
  REFUSED rather than imitated.
- Path: `database := strings.TrimLeft(url.Path, "/")` at :482, applied only
  when non-empty (:483-485).
- Query override — THE FINDING'S MECHANISM: every query parameter is folded
  in unconditionally with its FIRST value (`settings[k] = v[0]`, :496,
  loop :491-497), after the nameMap (:487-489) renames `dbname` →
  `database`. An EMPTY `?dbname=` therefore ERASES the path's claim; `?host=`
  erases the host the same way (hosts block :453-478, isIPOnly :502-504).
- Merge order: `mergeSettings(defaultSettings, envSettings,
  connStringSettings)` at :245 copies later sets unconditionally (:393-403),
  so the empty connection-string override BEATS ambient PGDATABASE — no
  environment can put the erased claim back.
- Server behavior: an empty `config.Database` is OMITTED from the startup
  message (pgconn/pgconn.go:326-328) and the server falls back to its
  default database. `postgres://solvent@db/claimed?dbname=` therefore passed
  wave 16's path-only guard while pgx connected to a database nobody named.

**Why replicate instead of calling ParseConfig.** ParseConfig merges the
ENVIRONMENT under the string, so its output cannot distinguish "the
connection string pins the subject" from "the environment filled it in" —
a guard built on it would accept a partial DSN whenever the environment is
dirty, and a rejection that depends on the environment being clean is not a
rejection. `TestDSNEffectiveClaimMatchesPgxParseConfig` proves both halves:
for every ACCEPTED shape the replication equals `pgconn.ParseConfig`'s
output exactly (including the repeated-parameter and IPv6 edges), and its
two closing legs demonstrate pgx's own ground truth for the erased-claim and
env-filled-gap cases with a hostile `PGDATABASE` set.

**Verdict-bearing mismatch.** `db_name_claimed` now records the EFFECTIVE
claim (`dbNameClaimed`), and `execute` compares it against the
server-reported `ConnectedIdentity.Database` from inside the snapshot's own
transaction: any disagreement, either direction, joins the one taint set
(`claimVsConnectedTaint`). The mismatch is unreachable through an honest DSN
(pgx connects where the effective claim points), so the regression drives
the exact judge execute wires with an injected identity — it exists as a
belt against middleware that rewrites connections (a pgbouncer-class proxy).

**Regressions:** `TestPartialDSNIsRejected` extended with five erased-claim
shapes including the reviewer's exact DSN; `TestClaimedDBFollowsPgxOverride`;
`TestKeywordAndForeignSchemeDSNsRefused`;
`TestClaimVsConnectedMismatchTaints`; `TestDSNEffectiveClaimMatchesPgxParseConfig`.
Mutants W19M1 (empty-value override reverted — the path-only regression) and
W19M2 (mismatch informational), both killed.

## M2 — the extended OS-input table (non-PG* inputs of the linked library)

**The sweep.** pgx v5.5.1's non-test sources contain exactly TWO env-read
sites (module-wide grep, `doc.go` comment examples excluded; the wave-16
closure test `TestEnvSurfaceClosed` keeps this enforced live at every run):
`pgconn/config.go:429` (the 17-name PG* nameMap loop, :408-425 — the
wave-16 table, unchanged and CONFIRMED by round 16) and
`pgconn/defaults_windows.go:20` (`APPDATA`). The platform-defaults sources:

| OS input | read site | what it can select | class | rule (round-16 M2) |
| --- | --- | --- | --- | --- |
| `APPDATA` (Windows builds) | `defaults_windows.go:20` | default passfile `%APPDATA%\postgresql\pgpass.conf` (:30); default CLIENT CERT + KEY `postgresql.crt`/`postgresql.key` (:32-39, applied when both files exist); default ROOT CA `root.crt` (:41-44, applied when the file exists) | linked-library | **conditionally verdict-bearing, DSN-aware** — `appdataTrustTaint` taints presence UNLESS the connection string pins the trust material (below); value-only table row stays Taint-nil so the sweep cannot double-judge |
| *(non-Windows sibling)* `defaults.go` | **no env read** (`//go:build !windows`) | trust-material defaults derive from `user.Current().HomeDir` (`~/.pgpass` :24, `~/.postgresql/postgresql.crt`/`.key` :26-34, `~/.postgresql/root.crt` :35-38) — an os/user lookup in the STANDARD LIBRARY, not an env read in the linked module | — | outside the module's env surface; stated here so the sweep's "defaults_windows.go AND the sibling" instruction has an explicit answer, and covered anyway: the same trust-pinning predicate makes home-dir defaults unreachable when the DSN pins |

**The predicate, justified against pgx's loading logic** (implemented as
`trustMaterialPinned`, judged on the connection string ALONE — an
env-supplied sslmode never counts, and PGSSLMODE presence already taints):

1. `sslmode=disable` pinned → `configTLS` returns a nil TLS config
   immediately (config.go:629-630), before any certificate path is
   consulted: no TLS, trust material irrelevant, APPDATA cannot matter.
2. Otherwise the connection may negotiate TLS, and `configTLS` consumes
   THREE settings the Windows defaults derive from APPDATA when the DSN
   does not pin them: the root CA is loaded into `RootCAs`/`ClientCAs`
   (:685-699) — used by verify-ca's `VerifyPeerCertificate` closure
   (:645-678, `Roots:` at :668) and verify-full's standard verification
   (:679-680) — and a root-cert setting silently UPGRADES `sslmode=require`
   to verify-ca semantics (:638-643), so an APPDATA-planted `root.crt`
   changes even a non-verify mode's behavior; the client cert/key pair is
   loaded and PRESENTED under every TLS mode (pair-required check :702-704,
   loading :706-755) — a SUBJECT input under cert-based auth. Only a
   connection string pinning ALL THREE (`sslrootcert`+`sslcert`+`sslkey`;
   mergeSettings :245 makes connString beat the defaults) closes every one
   of those paths. Partial pinning fails CLOSED (root-only still taints).
3. Unparseable / non-URL-form DSN proves nothing → `false` → taint
   (readOnlyDSN refuses such DSNs independently with exit 2).

**Why this is not a blanket presence taint.** APPDATA is unconditionally set
on every Windows session; a presence taint would refuse every Windows run
while proving nothing about runs whose DSN pins its trust material (this
repo's own acceptance DSNs pin `sslmode=disable` in the connection string —
asserted by `TestAppdataTaintNeverBlocksTrustPinnedWindowsRuns`). The taint
fires exactly when the environment could actually choose the connection's
trust anchors — the reviewer's scenario (`verify-full`, no explicit
`sslrootcert`, APPDATA present) is the first leg of
`TestAppdataTrustMaterialTaint` and fails closed. Wired in `execute`
immediately after `readOnlyDSN` accepts the DSN, into the same taint set as
everything else. Mutant W19M3 (judge made inert), killed.

## M3 — capability closure over first-party packages

Round 16 named two doors in the wave-16 scan: it skipped every non-selector
call, and it disciplined `internal/config` but not `internal/store` — yet
`store.Open` (store.go:41) creates a pgxpool and PINGS it: an unaudited
network dial reachable through an already-allowlisted package with zero new
imports. The STRUCTURAL fix (the brief's preference) is in
`TestSnapshotDBCapabilityBoundary`, sections (3)/(4):

- **Audited entry-point allowlist for `internal/store`** —
  `auditedStoreEntryPoints`, 25 NAMED symbols (never the whole package),
  each a read-only query helper. Structural belt at every call: the called
  store function must take a `store.Querier` parameter — it reads through
  the transaction snapshotdb HANDS it; a function that acquires its own
  connection (store.Open takes a DSN, no Querier) has no Querier to take
  and is refused twice over.
- **Every call shape joins the scan**: type conversions excluded
  semantically (`info.Types[...].IsType()`); parens and generic
  instantiation unwrapped (`(pgx.Connect)(...)`, `capDetail[T](...)`);
  Ident callees resolved exactly like selector callees (dot-import calls
  disciplined); FuncLit calls admitted (their bodies are scanned by the
  same walk); calls through FUNCTION-TYPED STRUCT FIELDS refused outright —
  pgx's own `ConnConfig.DialFunc` is the canonical foreign parking lot; any
  unresolvable callee is a hard failure, so the scan cannot silently skip.
- **THE FORMATION BAN** (the local-aliasing kill): a package-level function
  of a disciplined package (`pgx/v5`, `pgconn`, `pgxpool`,
  `internal/store`, `internal/config`) may appear ONLY as the operand of a
  direct call. `dial := pgx.Connect` — assignment, argument, field, closure
  capture, any value formation — dies at the formation site. This is what
  makes the remaining local function-value calls (`cancel()`,
  `resolvePin(...)`) safe to admit: with formation banned and func-typed
  params/fields refused by the API-surface tests, a local function value
  can only be an in-package literal or a value an allowlisted import
  returned (context.CancelFunc — covered by that import's capability
  argument). Method VALUES stay exempt for the same reason method CALLS
  are: they dispatch over a receiver already constructed from the audited
  imports.

**Mutants (the brief's binding shapes), both proven killed twice — once in a
pre-spec probe, once in the committed loop:** W19M4 (`store.Open(ctx,
roDSN)` inserted immediately after `gate.Enter()` — zero new imports, kills
via the entry-point allowlist naming `store.Open`) and W19M5 (`dial :=
pgx.Connect; dial(ctx, roDSN)` — non-selector call, kills via the formation
ban naming `pgx.Connect` referenced as a VALUE). Killer:
`TestSnapshotDBCapabilityBoundary`, behaviorally, in both cases.

## M4 — generation-bound cadence; the widening fallback dies

**The binding (migration 00010 + write + read).**
`sweep_generations.configured_interval_generation` records WHICH generation
the cadence was stamped under. `RecordSweepConfiguredInterval` sets it to
the row's own `current_generation` in the SAME UPDATE as the seconds — one
indivisible stamp, no window where a value exists unstamped, and the stamp
is read from the row inside the UPDATE so it stays truthful even if a bump
lands between the caller's last read and the write. The guard re-fires when
EITHER half is stale, so a generation bump is re-stamped within one daemon
round. `SweepGenerationRow`'s SQL surfaces the seconds ONLY under
`configured_interval_generation = current_generation` (a CASE mask): a
prior generation's value — or a prior instance's value that was never
re-stamped — is **unreadable by construction**; it never crosses the read
boundary, so no Go-side judgment exists to revert. Nothing that opens or
completes a generation names either column: the bump retires the stamp
without rewriting history (00008's survival law, split into survival vs
readability — both asserted in the upgraded 00009 test).

**NULL in acceptance = TAINT (the acceptance-taint distinction).** With no
generation-bound cadence, `sweepCadenceEvaluation` taints unconditionally:
an acceptance verdict never rests on an unverified cadence. This is NOT
fail-forever — the round-14 distinction, preserved and stated in both the
code comment and the taint text itself: the daemon stamps its cadence onto
the current generation every round, so one daemon round after a restart or
generation open the value exists and the taint clears itself. The taint
message names the mechanism and the self-clearing property.

**The fallback dies, in both halves.** Wave 15's
`max(2×env-or-1h-default, 2×lastPass)` is structurally GONE
(`freshnessBound` deleted; `resolveSnapshotInterval` deleted): round 16
proved a 30m daemon with a 10m pass enforces an 80m bound while the
fallback granted 2h — a fallback that can widen past the daemon's real rule
is a bypass. What remains on the absent arm is an ADVISORY bound — the
daemon's rule SHAPE (`2×(default+lastPass)`) with the canonical default
standing in for the unverified interval — recorded so the artifact's
freshness section stays readable, LABELED advisory in `bound_inputs`
(`label`, `snapshot_interval_source`, and a dedicated `advisory` key all
state it), and incapable of backing a pass because the unconditional taint
makes the run structurally non-pass (computeResult, round-10 F2). The env
variable feeds NO bound on ANY path — with a persisted cadence it is a
mismatch cross-check (both directions, unchanged); without one it cannot
even move the advisory value (asserted). The reviewer's exact scenario is
the first leg of `TestUnverifiedCadenceTaintsAcceptance`: prior-gen 2h
persisted (arrives as nil — unreadable), current gen absent, env unset →
taint, bound is 4h advisory and NEVER `2×(2h+lastPass)`=6h.

**Write failures stop being silent — mechanism choice.** A failed
`persistSweepInterval` now publishes `conditionCadenceUnpersisted` into the
round's health composition on the snapshot worker (its OWN key —
`stepSnapshotter` owns `step_error` for the same worker, and
`roundConditions.set` treats a same-key double-write as a publisher
collision). The health surface was chosen over the sweep-evidence channel
because the failing operation IS a write to the database that carries the
sweep evidence — a channel that just refused a one-column UPDATE cannot be
trusted to durably record its own refusal — while the health surface is
process-local, already the daemon's failure-visibility contract, and
self-clearing (round replacement: the first landed write makes the
condition disappear, so recovery stays visible). The consequence it
surfaces is real and stated in the condition text: while the cadence is
unstamped, every reconcile acceptance run taints. The pre-loop startup call
passes a nil composition (none exists yet) and stays log-only; round 1
re-runs the write against a live composition within one poll interval.

**Regressions:** `TestUnverifiedCadenceTaintsAcceptance` (reviewer scenario,
env-immunity of the advisory bound, additive-not-max shape, no-row case,
corrupt-value double taint, syntax belt),
`TestSweepCadenceUnreadableFromPriorGeneration` (DB-backed: bump retires the
stamp, history survives, one write restores readability),
`TestMigrateUpgradesV9AddingCadenceGenerationUnstamped` (00009-era value
survives as history but reads ABSENT; first post-upgrade write stamps the
row's own generation; both-halves idempotence),
`TestPersistSweepIntervalToleratesWriteFailure` (condition set on failure,
absent on success, nil-rc tolerated), the upgraded 00009 test's step (f),
`TestExtremeSnapshotIntervalEnvIsNonPass` (reworked: the refusal is
structural twice over), `TestFreshnessBoundLabelsSurviveEvaluation`
(policy vs advisory label contract). Mutants W19M6 (CASE mask reverted —
prior-generation read allowed), W19M7 (unconditional taint dropped —
fallback's verdict half), W19M8 (advisory bound env-fed — fallback's width
half), W19M9 (generation stamp frozen — the write-side half), all killed.

## Mutation matrix (committed applier; spec `0efec51`; loops at `0efec51` and `10761f8`; transcript `063d958`)

| id | finding / shape | mutant (compiles, vets) | killed by |
|---|---|---|---|
| W19M1 | M1 guard→path-only | empty query values no longer override (`settings[k]=v[0]` guarded) | `TestPartialDSNIsRejected`, `TestDSNEffectiveClaimMatchesPgxParseConfig` |
| W19M2 | M1 mismatch informational | `claimVsConnectedTaint` returns empty always | `TestClaimVsConnectedMismatchTaints` |
| W19M3 | M2 APPDATA inert | `appdataTrustTaint` returns empty regardless of DSN | `TestAppdataTrustMaterialTaint` |
| W19M4 | M3 store.Open under the gate | `store.Open(ctx, roDSN)` after `gate.Enter()` (zero new imports) | `TestSnapshotDBCapabilityBoundary` |
| W19M5 | M3 aliased pgx.Connect | `dial := pgx.Connect; dial(ctx, roDSN)` (non-selector call) | `TestSnapshotDBCapabilityBoundary` |
| W19M6 | M4 prior-generation read | CASE mask reverted to bare column | `TestSweepCadenceUnreadableFromPriorGeneration`, `TestMigrateUpgradesV9AddingCadenceGenerationUnstamped`, `TestMigrateUpgradesV8AddingConfiguredIntervalNullEverywhere` |
| W19M7 | M4 fallback restored (verdict) | the unconditional unverified-cadence taint popped after append | `TestUnverifiedCadenceTaintsAcceptance`, `TestExtremeSnapshotIntervalEnvIsNonPass` |
| W19M8 | M4 fallback restored (width) | advisory bound fed from the env value when parseable | `TestUnverifiedCadenceTaintsAcceptance`, `TestExtremeSnapshotIntervalEnvIsNonPass` |
| W19M9 | M4 stamp never lands | `SET configured_interval_generation = configured_interval_generation` | `TestSweepCadenceUnreadableFromPriorGeneration`, `TestMigrateUpgradesV9AddingCadenceGenerationUnstamped` |

9/9 KILLED in both loops; every kill a named behavioral test failure;
exactly-once asserted per edit; in-memory restores byte-identical;
`git status` EMPTY over all six mutated files after each loop.

## PASS-list diff, name-for-name

**Removed (3)** — each retired-by-replacement, see deviation 3:
`TestDBNameFromDSN` (renamed), `TestFreshnessBoundIsPolicyMax` (law killed),
`TestPreMigrationRowsFallBackFailClosed` (law killed).

**Added (11)** — `TestAppdataTaintNeverBlocksTrustPinnedWindowsRuns`,
`TestAppdataTrustMaterialTaint`, `TestClaimVsConnectedMismatchTaints`,
`TestClaimedDBFollowsPgxOverride`, `TestDBNameClaimed`,
`TestDSNEffectiveClaimMatchesPgxParseConfig`,
`TestFreshnessBoundLabelsSurviveEvaluation`,
`TestKeywordAndForeignSchemeDSNsRefused`,
`TestMigrateUpgradesV9AddingCadenceGenerationUnstamped`,
`TestSweepCadenceUnreadableFromPriorGeneration`,
`TestUnverifiedCadenceTaintsAcceptance`.

Zero sibling additions or retirements in the window (the interval
`e3a14aa..69aedd0` is docs-only; wave 18's +1 landed before the baseline).

## Deviations & residuals (each with reason)

1. **CLI/verdict behavior change (the standing class), TIGHTER in three
   places.** (a) A run against a database whose current sweep generation
   carries no daemon-stamped cadence now exits 1 (`result: tainted`) where
   wave 16 fell back clean — including, immediately after migration, the
   LIVE database, until the daemon restarts on the new binary AND completes
   one round (see Unverified). (b) Erased-claim DSNs (`?dbname=`, `?host=`)
   now exit 2 where wave 16 connected. (c) On Windows, APPDATA + a DSN that
   does not pin its TLS trust material now taints (this repo's own DSNs pin
   `sslmode=disable` and are unaffected). All three are the findings'
   intent.
2. **Schema version 9 → 10.** Reconcile's exact-equality Phase-0 gate
   refuses a v9 database (exit 2, "reconcile never migrates") — the same
   ordering constraint as wave 16's deviation 3, one version later. The
   version pins (`currentSchemaVersion`, the reconcile_test expectation)
   were bumped with the migration.
3. **Three tests RETIRED-BY-REPLACEMENT, none weakened** — each pinned a law
   round 16 killed, and each successor asserts strictly more:
   `TestPreMigrationRowsFallBackFailClosed` (asserted the fallback CLEAN) →
   `TestUnverifiedCadenceTaintsAcceptance` (asserts the same inputs TAINT);
   `TestFreshnessBoundIsPolicyMax` (asserted the max-shape bound) →
   `TestFreshnessBoundLabelsSurviveEvaluation` (asserts the label contract
   policy-vs-advisory); `TestDBNameFromDSN` → `TestDBNameClaimed` (rename
   with the round-16 semantics). The PASS-diff's removals are exactly these
   three.
4. **The mutation loop ran twice** (`874c9de` then `063d958`): a
   comment-only citation-precision fix (`10761f8`) touched two mutated
   files after the first loop, so the loop was re-run at the new SHA rather
   than shipping a byte-identity claim about a superseded one. Both loops
   9/9.
5. **`freshnessBound` and `resolveSnapshotInterval` deleted** (with their
   direct tests reworked): dead code once the fallback died, and leaving a
   widening-capable bound helper in the tree would invite exactly the
   mutant W19M8 embodies.
6. **Environment recovery at wave start and mid-wave, disclosed:** Docker
   Desktop and `solvent-db-1` were DOWN at session start (predecessor
   teardown collateral; container exit 255 = engine shutdown) and the DB
   container was down again after the mid-wave session interruption. Both
   times the engine/container were STARTED (restoring prior state), never
   stopped, signaled, or reconfigured by me. The daemon is a host process
   and was never touched (its restart remains the controller's post-wave
   step).
7. **This wave itself was interrupted once** (session limit); all
   uncommitted state survived and was verified against the controller's
   file inventory before resuming. Zero work lost, zero re-derivation from
   memory — everything re-verified from the tree.

## Unverified (stated plainly)

- **The full Phase 1→4 pipeline has not run end-to-end against the live
  database this wave** — the controller's evidence run, by design. Ordering
  constraint, stronger than wave 16's: (1) migrate to v10 (the daemon
  restart migrates at startup), (2) let the daemon complete AT LEAST ONE
  round so `persistSweepInterval` stamps the current generation, (3) run
  reconcile. A reconcile between (1) and (2) exits 1 TAINTED on the
  unverified-cadence law — correct, fail-closed, self-clearing, but worth
  knowing before reading the receipt.
- **The live database's cadence is unstamped by construction until then**:
  even if a wave-16-era daemon wrote `configured_interval_seconds`, 00010
  adds no stamp for it (inventing one would fabricate the binding), so the
  first post-migration reconcile sees NULL. Stated in the migration header.
- **The daemon-loop wiring of the condition surfacing** is proven against
  fakes (`TestPersistSweepIntervalToleratesWriteFailure`); no running-daemon
  harness exists for the round loop (same residual class as wave 16's F4
  wiring note). The call-site change is one parameter beside an existing,
  tested call.
- **`claimVsConnectedTaint`'s mismatch arm is unreachable through an honest
  DSN** (pgx connects where the effective claim points); it is exercised
  with injected identities. Reaching it live requires a rewriting proxy —
  not built, not simulated.
- `getReserveAToken` selector-pinned but not live-verified (standing
  wave-11 residual, untouched).

## Environment safety accounting

The backfill daemon (host process) was never started, stopped, or signaled.
`solvent-db-1` was found DOWN twice (session-teardown collateral, exit 255
both times) and started back up; never stopped or reconfigured by me. Live
DB access was read-only throughout (the recon evidence scans inside the
acceptance runs; `SOLVENT_RECON_DATABASE_URL` in the race container).
Scratch databases used: `solvent_t9w19` (acceptance + mutation loops +
dev-mode runs), `solvent_t9w19race` (the race run's own database),
`solvent_t9w19_recongate` / `solvent_t9w19race_recongate` (created by the
DB-backed gate tests, guarded). Migration/upgrade tests ran in dropped-and-
recreated schemas inside the scratch DB only; the live `solvent` database
was never written. Pinned worktrees: `../Solvent-t9w19-base` (re-pinned
846c241 → `e3a14aa`), `../Solvent-t9w19-final` (`063d958`); each carries a
copy of the gitignored `.env` (never committed). Live RPC: the standing
gate-ON `mainnet.optimism.io` regression dial per suite run; the mutation
loops dial nothing beyond their named test commands.
