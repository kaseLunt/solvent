# Task 9 — wave 20 report: round-19 fixes (cadence binds to the INSTANCE; the APPDATA judge platform-true in both directions; function-value provenance closed over field aliases; the regression protects the wiring)

Brief: `task-9-wave20-brief.md` (BINDING — four findings), adjudicating
`task-9-codex-round19.md` (all four ACCEPTED). **Baseline SHA `1186197`** —
session-start HEAD == origin/main, clean tree. Branch `main`, pathspec
staging on every commit; the scope gate accepted all paths (11 impl + the
sdd files). Round-19's CONFIRMED surfaces (the effective-DSN rejection, F2,
the 17-name PG* table, the SHA-binding discipline) were not touched except
where a finding named them, and every wave-19 regression still passes.

| commit | contents |
| --- | --- |
| `f62aee8` | THE IMPLEMENTATION: H1 (requireStartupSweepCadence mandatory+fatal, per-round retry doc'd, run() wiring, AST wiring test, DB-backed instance-binding test), H2 (appdataTrustTaintFor GOOS-parameterized seam + both-direction tests), M3 (func-field formation ban + foreign-named-type belt in the boundary scan), L4 (TestClaimVsConnectedTaintWiredIntoExecute) — 11 files |
| `60e05e3` | mutation spec `.superpowers/sdd/t9w20-mutations/mutations.json` (6 mutants), committed BEFORE the loop, every mutant pre-verified (apply-once, build, vet, kill, byte-identical restore) BEFORE the spec commit |
| `295d844` | transcript: **6/6 KILLED** at tested SHA `60e05e3` |
| + this report | `task-9-wave20-report-p2.md` |

No post-spec commit touches a mutated file (the transcript and this report
live under `.superpowers/sdd/` only), so the loop's byte-identity claim
stands at `60e05e3` with no re-run owed (the wave-19 discipline, checked).

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `1186197`: 802 / 0 / 0, exit 0, via `make test-acceptance`**
  — PINNED WORKTREE `../Solvent-t9w20-base`. Posture: `SOLVENT_ACCEPTANCE=1`
  (target-set), gate ON (`SOLVENT_LIVE_RPC_TESTS=1`), `TEST_DATABASE_URL` →
  **`solvent_t9w20`** (own scratch DB), `SOLVENT_DATABASE_URL` +
  `SOLVENT_RECON_DATABASE_URL` → the LIVE `solvent` database (read-only, via
  the Makefile's `.env` export), `SOLVENT_RPC_*`/`SOLVENT_RECON_RPC_*`
  cleared by the target, private `TMPDIR`. The gate printed **"acceptance
  mode: exit=0 skips=0"**. 802 == wave 19's final, exactly as the brief
  predicted.
- **Final @ `295d844`: 808 / 0 / 0, exit 0, same target, same posture** —
  pinned worktree `../Solvent-t9w20-final`, gate printed **"acceptance mode:
  exit=0 skips=0"** and `acceptance suite green: zero skips`. 802 + 6 = 808,
  exactly the arithmetic the change list predicts.
- **PASS-list diff, both directions: 0 removed, 6 added — reconciled
  name-for-name below.** Nothing retired, nothing weakened: pure additions.
- **`-race` in `golang:1.24` via docker** (`./cmd/reconcile/...
  ./internal/store/... ./cmd/indexer/...` from the pinned final worktree,
  DSNs at `host.docker.internal`, named volume `solvent-gomodcache`,
  `SOLVENT_ACCEPTANCE=1`, gate ON, `SOLVENT_RECON_DATABASE_URL` exported,
  `TEST_DATABASE_URL` → **`solvent_t9w20race`** — its own database, and the
  run SERIALIZED after the acceptance run): **375 / 0 / 0, exit 0, zero
  `DATA RACE`, zero skips** (wave 19's 369 + the same net +6 the acceptance
  diff shows — all six additions live inside these four packages). Package
  times: reconcile 3.6s, snapshotdb 5.4s, store 193.8s, indexer 3.1s. The
  Linux container is also the live proof of H2's non-Windows direction:
  `appdataTrustTaint` ran under GOOS=linux for the whole suite and tainted
  nothing.
- **Build/vet**: `go build ./...` + `go vet ./...` clean at HEAD.
  **Committed-blob gofmt**: all 11 touched `.go` blobs at HEAD extracted via
  `git cat-file` — `gofmt -l` CLEAN (the working-tree check stays
  CRLF-noisy and was not used as evidence; new files were also LF-probed
  before commit).
- **Diff isolation**: `git diff --name-only 1186197..HEAD` = exactly
  `cmd/reconcile/**` (7), `cmd/indexer/**` (3), `internal/store/**` (1),
  `.superpowers/sdd/**` (3). Nothing else.
- **Mutation matrix: 6/6 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`, historical name), spec committed before
  the loop (`60e05e3`), exactly-once byte assertions on every edit,
  in-memory restores verified byte-identical, `git status` EMPTY over all
  4 mutated files after the loop. Every mutant was pre-verified (before the
  spec was committed) to apply exactly once, `go build ./...` and `go vet
  ./...` clean via an in-memory probe — the wave-16 CRLF lesson, applied
  preemptively; all anchors single-line.

## H1 — cadence binds to the INSTANCE: mechanism (b), with the rollover argument

**Mechanism chosen: (b) — the pre-loop cadence overwrite is MANDATORY AND
FATAL** (`requireStartupSweepCadence`, cmd/indexer/main.go; run() returns
its error before the loop ever starts). Why not (a) (a durable daemon-start
epoch joining the stamp): the epoch write is itself a startup write, and it
must be fatal-on-failure to bind anything — a new daemon that cannot write
its epoch leaves the PREVIOUS epoch current in the database, and with it
the previous cadence, which reconcile would then read as a consistent
(generation, epoch, seconds) triple. So (a) is (b) plus a migration and a
second column that can drift; (b) achieves instance binding with the
columns 00010 already has.

**The invariant.** With the startup write fatal, the readable cadence
belongs to the LAST SUCCESSFULLY STARTED instance at every instant:

- this daemon RUNS → its startup UPDATE landed (or matched nothing because
  the row already carried its own values under the current generation) →
  the readable value is ITS configured interval, immutable for the process
  lifetime (config.Load runs once, pre-loop);
- this daemon CANNOT WRITE → it never enters the loop → there is no
  running instance whose rule could diverge from the stamp; the stamp still
  names the configuration of the last instance that actually ran and
  produced the sweep evidence being judged.

**The rollover argument (why per-round failures may STAY tolerated).** The
one event that can strand the stamp mid-run is a generation bump
(OpenSweepGeneration/RewindDerived), and it fails CLOSED without any Go-side
judgment: the bump retires the stamp (`configured_interval_generation`
keeps naming the old generation) and migration 00010's CASE mask makes the
cadence **unreadable** for the new generation until the per-round retry
lands — reconcile taints on the NULL (round-16 M4). A failed row-write in
that window can only keep the taint alive, never resurrect either
instance's stale number. Demonstrated live:
`TestCadenceBindsToRunningInstanceNotGeneration` (internal/store — Codex's
exact 2h/30m scenario in three steps: the 2h stamp really survives
"restart" readable-as-verified; the new instance's only admission path
retires it in the same UPDATE; the rollover window reads NULL) plus the
standing `TestSweepCadenceUnreadableFromPriorGeneration` and
`TestUnverifiedCadenceTaintsAcceptance`.

**Error is the ONLY fatal mode.** A `(false, nil)` return (zero rows
matched) is a healthy start in both of its cases: no `sweep_generations`
row yet (OpenSweepGeneration owns row creation; with no row there is
nothing readable to mis-trust — absence taints), or the row already carries
exactly this instance's values (IS DISTINCT FROM matched nothing). Both
post-states satisfy the invariant. Asserted with a forced `(false, nil)`
fake in `TestStartupCadenceStampIsMandatoryFatal`.

**No new availability dependency** — the daemon cannot run without the
database this one-row UPDATE goes to. And the taint window SHRINKS versus
wave 19: the stamp now exists before round 1 instead of after it.

**The wiring is protected** (the L4 lesson applied to H1 preemptively):
`TestStartupCadenceFatalWiredIntoRun` (AST over non-test sources) pins
exactly two `requireStartupSweepCadence` identifiers (declaration + the one
run() call), the call inside run, in an `if err := ...; err != nil` whose
body returns the bound error. `persistSweepInterval` remains the per-round
retry (tolerated + surfaced under `conditionCadenceUnpersisted`); its
nil-rc tolerance was REMOVED with its only nil caller (deviation 3).

**Codex's binding regression, mapped:** open generation + 2h stamp==current
from a previous instance + a 30m daemon whose startup/per-round writes fail
→ under (b) the daemon NEVER RUNS (`TestStartupCadenceStampIsMandatoryFatal`
= the fatality; `TestStartupCadenceFatalWiredIntoRun` = run() actually
refuses; `TestCadenceBindsToRunningInstanceNotGeneration` = the DB half:
2h is unreadable-or-overwritten in every state a running daemon can
coexist with). Mutants W20M1 (fatality reverted to tolerated) and W20M2
(run() wiring removed), both killed.

## H2 — the APPDATA judge is platform-true, both directions

**Mechanism: GOOS-parameterized pure function**
(`appdataTrustTaintFor(goos, appdata, dsn)`), with production narrowed to
one binding line: `appdataTrustTaint(dsn) =
appdataTrustTaintFor(runtime.GOOS, os.Getenv("APPDATA"), dsn)`. Why this
over build tags: (1) **runtime.GOOS cannot disagree with the library** —
the judge and the pgx build it judges are linked into the SAME binary, so
the GOOS that selected pgconn's defaults file (defaults_windows.go by
filename convention; defaults.go under `//go:build !windows`, its line 1)
is by construction the GOOS the process reports; (2) build-tagged judge
implementations would leave the non-native branch uncompilable — and
therefore untestable — on the native platform, and this repo needs BOTH
branches testable on both platforms (Windows dev/CI runs the suite
natively; the race suite runs it in a Linux container). The seam is the
test surface; the wrapper's binding is pinned by
`TestAppdataTaintBindsRuntimePlatform`.

**The platform table (all cited against pgx v5.5.1 in the module cache):**

| platform | APPDATA | DSN trust posture | what pgx does (source) | verdict |
| --- | --- | --- | --- | --- |
| windows | set | unpinned | defaults from `%APPDATA%\postgresql`: passfile :30, client pair :32-39 (stat-gated pair), root CA :41-44 (stat-gated); APPDATA read at defaults_windows.go:20; root loaded into TLS verification config.go:685-699 | **TAINT** (round-16 M2, unchanged) |
| windows | **empty** | unpinned | `filepath.Join("", "postgresql", ...)` — NO emptiness guard anywhere in defaults_windows.go:30-44, so the paths become the RELATIVE `postgresql\postgresql.crt|.key` and `postgresql\root.crt`, resolved against the process CWD by the os.Stat probes (:34-35, :42) and the TLS loading they enable | **TAINT** (the round-19 correction; wave 19 returned clean here) |
| windows | any | `sslmode=disable` pinned in the connection string | configTLS returns nil immediately (config.go:629-631) — no trust material consulted | clean |
| windows | any | `sslrootcert`+`sslcert`+`sslkey` all pinned | mergeSettings (config.go:245) — connection-string settings beat the defaults for every trust input configTLS consumes (:685-699 root into RootCAs/ClientCAs; :638-643 the require→verify-ca upgrade; :702-704/:706-755 the client pair) | clean |
| non-windows | anything | anything | defaults.go (`//go:build !windows`, line 1) contains NO env read at all — trust defaults derive from `user.Current().HomeDir` (:21-38) | **IGNORED** — no taint from this judge (round 19's false-taint direction killed) |

Two boundary notes, stated in the code: the Windows defaults block runs
only when `user.Current()` succeeds (defaults_windows.go:19-21) and the
defaults are stat-gated — reconcile can prove neither the lookup's failure
nor the file's absence at pgx's own connect time, so both stay FAIL CLOSED
(the planted-file attack IS the existence case). And the taint message no
longer offers "clear APPDATA" as a remedy — it names the CWD-relative
mechanism instead (asserted: the empty-APPDATA leg requires "CWD-relative"
in the message).

**Tests, both directions:** `TestAppdataTrustMaterialTaint` (Windows via
the seam: set-and-unpinned taints; EMPTY-and-unpinned taints — the
round-19 leg; every pinning posture judged identically under set and empty
APPDATA; partial pinning, require-upgrade, non-URL-form all fail closed;
computeResult integration), `TestAppdataJudgeIgnoresNonWindowsPlatforms`
(linux/darwin/freebsd, nonempty APPDATA, unpinned verify-full → clean),
`TestAppdataTaintBindsRuntimePlatform` (the wrapper binds runtime.GOOS +
ambient APPDATA), `TestAppdataTaintNeverBlocksTrustPinnedWindowsRuns`
(unchanged vacuity guard: the house sslmode=disable DSNs stay clean —
now purely because of trust pinning, since the VALUE decides nothing).
Mutants W20M3 (empty==clean revert) and W20M4 (non-Windows ignore
removed), both killed.

## M3 — function-value provenance closure (the DialFunc alias dies at formation)

**Mechanism: the brief's first option — ban FORMATION of function-typed
values from struct fields — plus a type belt with the explicit
justification list.** Two additions to `TestSnapshotDBCapabilityBoundary`:

1. **Section (5), the func-field formation ban**: any `SelectorExpr` whose
   selection is `types.FieldVal` with a function-typed field is refused IN
   EVERY SYNTACTIC POSITION — call, assignment, argument, composite
   literal, anything. `dial := conn.Config().DialFunc` can no longer be
   WRITTEN in this package. (The round-16 call-position FieldVal check in
   section (3) is retained as a redundant inner belt.)
2. **The type belt in section (3)'s Var-callee case**: a call through a
   local function value whose static type is a FOREIGN NAMED function type
   must be on `justifiedForeignFuncValueTypes` — which contains exactly
   `context.CancelFunc` (returned by the allowlisted context package's
   constructors, required by the cleanup path, structurally unable to
   reach a socket). `pgconn.DialFunc` is refused here even if some channel
   the formation bans did not anticipate ever formed one.

**Why the NEXT alias generation is unrepresentable, not merely detected.**
The Var-callee admission is an enumeration of every channel through which
a local function value can FORM, and each is now closed or justified:
package-level functions of disciplined packages (banned outside direct
call position — section (4), round 16); func-typed parameters, fields and
package vars on this package's API (banned by
TestSnapshotDBAPISurfaceRejectsInjection); struct-field reads of ANY
struct (banned by (5), round 19); method values (exempt with the receiver
argument — they dispatch over values the audited imports built); func
literals (their bodies are walked by the same scan); allowlisted-import
returns (vetted by the type belt). Laundering the foreign type name off a
capability value requires SPELLING its signature, and a dialer's signature
names `net.Conn` — a type this package cannot import (the import
allowlist), while `:=` inference preserves the named type the belt
refuses. In-package named function types cannot exist either (section (1)
refuses declaring them, aliases included).

Mutant W20M5 — the exact round-19 shape (`dialAlias :=
conn.Config().DialFunc; sideConn, sideDialErr := dialAlias(ctx, "tcp",
"attacker.example:443"); ...` inserted immediately after `gate.Enter()`,
zero new imports, verified against pgx's real API: Conn.Config conn.go:435,
the embedded pgconn.Config conn.go:22-23, DialFunc field config.go:39,
type pgconn/pgconn.go:46) — killed behaviorally by
`TestSnapshotDBCapabilityBoundary`.

## L4 — the regression protects the WIRING (structural call-site assertion)

**Mechanism chosen: the structural call-site assertion**
(`TestClaimVsConnectedTaintWiredIntoExecute`, pure AST over the non-test
sources — comments and strings cannot satisfy an identifier count, the
go/types-free parse keeps it fast, and name-based resolution is sound for
a package-unique unexported identifier whose uniqueness the test itself
asserts). Why not an execute-level behavioral seam: execute's Phase 0
needs a live config, database and verified chain endpoints before the
Phase-1 identity exists, and an injection harness for all of that would
prove less about THIS wiring than the syntactic pin does — while being
itself a new injection surface into the verdict path (the round-14 F3
class this repo keeps evicting).

What it pins (each individually load-bearing):

- exactly TWO `claimVsConnectedTaint` identifiers in non-test sources —
  the declaration and ONE call site (zero call sites = the predecessor's
  exact unwired state = the W20M6 mutant);
- the call is inside `execute`, as the init of an
  `if msg := claimVsConnectedTaint(claimed, ....Identity); msg != ""`;
- the CLAIMED side is the identifier bound from `dbNameClaimed` (the
  DSN-effective claim under pgx's own precedence — round-16 M1), the
  CONNECTED side a `.Identity` selector (the Phase-1 server-reported
  identity, never a DSN re-parse);
- the guard body APPENDS `msg` to the taint slice and re-stamps it
  (`stampAcceptance`);
- the SAME slice identifier is the taint argument of `computeResult` —
  append-into-a-slice-nobody-reads would satisfy everything else.

W19M2 stays in force (the inert-judge half keeps being killed by
`TestClaimVsConnectedMismatchTaints`); W20M6 is the omission half. The
same pattern was applied to H1's new wiring in the same commit
(`TestStartupCadenceFatalWiredIntoRun`), so the class named by round 19
is closed at both of this wave's wiring sites.

## Mutation matrix (committed applier; spec `60e05e3`; loop at `60e05e3`; transcript `295d844`)

| id | finding / shape | mutant (compiles, vets) | killed by |
|---|---|---|---|
| W20M1 | H1 fatality reverted | requireStartupSweepCadence logs and returns nil on a failed write | `TestStartupCadenceStampIsMandatoryFatal` |
| W20M2 | H1 wiring removed | the run() call replaced by `if err := error(nil); err != nil` | `TestStartupCadenceFatalWiredIntoRun` |
| W20M3 | H2 empty==clean revert | `goos != "windows" \|\| appdata == ""` short-circuits to clean | `TestAppdataTrustMaterialTaint` |
| W20M4 | H2 non-Windows ignore removed | `false && goos != "windows"` — every GOOS judges like Windows | `TestAppdataJudgeIgnoresNonWindowsPlatforms` |
| W20M5 | M3 DialFunc alias (the exact round-19 shape) | `dialAlias := conn.Config().DialFunc; dialAlias(ctx, "tcp", "attacker.example:443")` after `gate.Enter()` | `TestSnapshotDBCapabilityBoundary` |
| W20M6 | L4 execute wiring removed | `if msg := ""; msg != ""` — judge defined, zero call sites (the predecessor's exact state) | `TestClaimVsConnectedTaintWiredIntoExecute` |

6/6 KILLED; every kill a named behavioral test failure; exactly-once
asserted per edit; in-memory restores byte-identical; `git status` EMPTY
over all 4 mutated files after the loop. The brief's mutant list is the
floor; W20M2 exceeds it.

## PASS-list diff, name-for-name

**Removed (0)** — nothing retired, nothing renamed.

**Added (6)** — `TestAppdataJudgeIgnoresNonWindowsPlatforms`,
`TestAppdataTaintBindsRuntimePlatform`,
`TestCadenceBindsToRunningInstanceNotGeneration`,
`TestClaimVsConnectedTaintWiredIntoExecute`,
`TestStartupCadenceFatalWiredIntoRun`,
`TestStartupCadenceStampIsMandatoryFatal`.

## Deviations & residuals (each with reason)

1. **Daemon startup behavior change (H1's intent):** a daemon whose
   startup cadence stamp ERRORS now exits with a named refusal instead of
   logging and running. Operationally: the controller's pending single
   restart (migrate v9+v10 + stamp) now stamps BEFORE the loop, so the
   post-restart unverified-cadence taint window closes at startup rather
   than after round 1 — strictly smaller than wave 19's stated window.
2. **Windows verdict change from wave 19 (H2's intent):** an
   unpinned-trust DSN now taints even with APPDATA cleared or empty;
   clearing APPDATA is no longer a neutralization channel for this judge
   (the message says so explicitly). The house acceptance DSNs pin
   `sslmode=disable` and are unaffected. Conversely, non-Windows runs can
   no longer taint on APPDATA at all (the false-taint kill; the Linux race
   container exercised this for real).
3. **`persistSweepInterval`'s nil-rc tolerance removed** with its only nil
   caller (the pre-loop call moved to the fatal variant): a dead defensive
   branch on a failure-surfacing path is exactly the untested-arm class
   these rounds keep finding. The test leg asserting nil-rc tolerance was
   replaced inside the same test (no PASS-diff entry) by the fatal-startup
   coverage.
4. **The first docker `-race` attempt exited 125 without starting** — Git
   Bash's MSYS path conversion mangled `-w /src` into `C:/Program
   Files/Git/src`; rerun identically via PowerShell. The failed attempt
   ran zero tests and produced zero evidence; disclosed for completeness.
5. **`fakeSweepIntervalWriter` gained a forced `(false, nil)` mode** to
   assert error-is-the-only-fatal-mode; no production surface changed for
   testability.

## Unverified (stated plainly)

- **run()'s fatal wiring is proven structurally (AST) + the helper
  behaviorally against fakes** — no harness drives run() end-to-end
  through a real failed startup write (the same daemon-loop residual class
  every wave has carried; the structural pin is this wave's mitigation,
  and W20M2 proves the pin bites).
- **The Windows planted-file attack was not reproduced live** — no actual
  pgx connection with a planted CWD `postgresql\root.crt` was made. The
  empty-APPDATA taint rests on the cited source (defaults_windows.go's
  unguarded joins + os.Stat's CWD-relative resolution), which is also
  exactly the fail-closed direction.
- **Non-Windows home-dir trust defaults remain outside this judge**, by
  scope: `~/.postgresql/*` derives from `user.Current().HomeDir`
  (defaults.go:21-38) — an os/user input, not an env read (the module-wide
  env closure test keeps pinning that APPDATA + the 17 PG* names are pgx's
  ONLY env reads). The same `trustMaterialPinned` posture neutralizes the
  home-dir defaults when the DSN pins; an unpinned DSN off Windows is NOT
  tainted by any judge today. If a future round wants that class judged,
  it is a new platform-defaults judge, not an APPDATA row — flagged here
  so it is a decision, not an oversight.
- **The full Phase 1→4 pipeline has not run end-to-end against the live
  database this wave** — the controller's evidence run, by design. The
  wave-19 ordering constraint holds with one improvement: (1) restart the
  daemon on the new binary (it migrates and now STAMPS AT STARTUP or
  refuses), (2) run reconcile — the wait-one-round step is gone unless the
  startup stamp itself fails, which is now loud.
- **`claimVsConnectedTaint`'s mismatch arm** remains unreachable through
  an honest DSN (unchanged wave-19 residual; exercised with injected
  identities).
- `getReserveAToken` selector-pinned but not live-verified (standing
  wave-11 residual, untouched).

## Environment safety accounting

The backfill daemon (host process) was never built, started, stopped, or
signaled — it is DOWN by controller decision and stayed down.
`solvent-db-1` was found UP (healthy) and was never stopped, started, or
reconfigured. Live DB access was read-only throughout (the recon evidence
scans inside the acceptance runs; `SOLVENT_RECON_DATABASE_URL` in the race
container). Scratch databases: `solvent_t9w20` (acceptance + mutation loop
+ dev-mode runs), `solvent_t9w20race` (the race run's own database),
`solvent_t9w20_recongate` / `solvent_t9w20race_recongate` (created by the
DB-backed gate tests, guarded). Migration/upgrade tests ran in
dropped-and-recreated schemas inside the scratch DBs only; the live
`solvent` database was never written. Pinned worktrees:
`../Solvent-t9w20-base` (`1186197`), `../Solvent-t9w20-final` (`295d844`);
each carries a copy of the gitignored `.env` (never committed). Live RPC:
the standing gate-ON `mainnet.optimism.io` regression dial per suite run
(native + race container); the mutation loop dialed nothing beyond its
named test commands (none DB- or network-backed this wave).
