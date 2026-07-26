# Task 9 — wave 13 report: round-11 fixes (close the generator, gate the inability)

Brief: `task-9-wave13-brief.md` (BINDING — three fixes), adjudicating
`task-9-codex-round11.md` (all three findings ACCEPTED). Session-start HEAD `ffb3235`
(the brief commit); **baseline SHA `4feecf6`** — the parallel wave 12 landed its
implementation and mutation commits (`6adfc95`, `d0ed01e`, `d6cb441`, `4feecf6`) into the
shared tree before my baseline ran, so wave-12's work is INSIDE my baseline and the
reconciliation below is against that state. Branch `main`, parallel tree; every
interleaved non-wave-13 commit is enumerated and `git show --stat`-verified docs-only.

| commit | contents |
| --- | --- |
| `4feecf6` | (sibling, pre-baseline) wave-12 transcript — BASELINE SHA |
| `9fa2371`, `adfba01` | (sibling/controller, mid-wave) wave-12 report + progress line — docs-only, verified |
| `36488dd` | THE IMPLEMENTATION: F1–F3 across `cmd/reconcile/**` (7 files edited + `phase1_f5_seam_test.go` new) |
| `a3fba23` | mutation spec `.superpowers/sdd/t9w13-mutations/mutations.json` (3 mutants, one per finding), committed BEFORE the loop |
| `e455229` | `t9w13-mutations/transcript.md`, **3/3 KILLED** at tested SHA `a3fba23` — FINAL code state (code bytes identical `36488dd`→HEAD) |
| `8a9e919` | (controller, post-verification) round-12 archive + wave-14 brief — docs-only, verified |
| + this report | `task-9-wave13-report-p2.md` |

Scope: `git diff --name-only 4feecf6..e455229` = `cmd/reconcile/**` (8 files) +
`.superpowers/sdd/t9w13-mutations/**` (2 files). No Makefile change was needed — F1's
binding test is a hermetic unit test. Nothing outside my ownership touched; pathspec
staging on every commit; the scope gate accepted all three.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `4feecf6`: 754 / 0 / 0, exit 0, via `make test-acceptance`** — posture:
  `SOLVENT_ACCEPTANCE=1` (target-set), gate ON (`SOLVENT_LIVE_RPC_TESTS=1`),
  `TEST_DATABASE_URL` → **`solvent_t9w13`** (fresh scratch DB — deviation 1 below),
  `SOLVENT_DATABASE_URL` + `SOLVENT_RECON_DATABASE_URL` → the LIVE `solvent` database
  (read-only), `SOLVENT_RPC_*`/`SOLVENT_RECON_RPC_*` cleared by the target. The target's
  gate printed **“acceptance mode: exit=0 skips=0”** — the acceptance-mode skip count is
  EXPLICITLY ZERO. (754 = wave-11's 739 + wave-12's additions, which were committed before
  my baseline; wave-12's own report states 754/0/0 at this same SHA — the two waves'
  ledgers agree exactly.)
- **Final @ `e455229`: 760 / 0 / 0, exit 0, same target, same posture** — gate printed
  **“acceptance mode: exit=0 skips=0”**; acceptance-mode skip count ZERO.
- **PASS-list diff, both directions: 0 removed, exactly 6 added — all six are this
  wave's tests** (`TestFlagSurfaceClosed`, `TestLooseBoundsInvocationIsNonPass`,
  `TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory`,
  `TestCollectSnapshotReachesNoChainSurface`, `TestSnapshotGateBlocksReadersWhileOpen`,
  `TestSnapshotGateReopensAfterExit`). **Sibling reconciliation: zero sibling test
  additions appear in the diff** because wave-12's tests were already in the baseline;
  the two mid-wave sibling commits (`9fa2371`, `adfba01`) and the post-verification
  controller commit (`8a9e919`) are docs-only by `git show --stat`.
- **`-race` (cmd/reconcile) in `golang:1.24` via docker, host.docker.internal DSNs:
  81 / 0 / 0, exit 0, zero `DATA RACE`, zero skips** — the package's tests are hermetic;
  the DSN env was supplied for parity with the house pattern.
- **Build/vet**: `go build ./...` + `go vet ./...` clean at HEAD. **Committed-blob
  gofmt**: all 8 touched `.go` blobs at HEAD extracted via `git cat-file` to temp files —
  `gofmt -l` CLEAN (working-tree gofmt stays CRLF-noisy repo-wide; the blob check is the
  bar).
- **Mutation matrix: 3/3 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`), spec committed before the loop (`a3fba23`), tested SHA
  `a3fba23`, exactly-once byte assertions on every edit, in-memory restores verified
  byte-identical, `git status` EMPTY over all 3 mutated files after the loop. Loop env:
  hermetic (no DB, no RPC — all three kill tests are unit tests).

## F1 [high] — the taint generator is CLOSED over the flag surface

**Built.** `reconFlagSet` extracts the COMPLETE flag registration (defaults seeded from
new shared canonical constants: `canonicalConfigPath`, `canonicalSampleFloor`,
`canonicalGoldenPinETH`, `canonicalFixturePinETH`, `canonicalSnapshotMaxAge`,
`canonicalCollateralReplay`, `canonicalMaxHeadLag` — the generator and the defaults can
no longer drift apart). `acceptanceTaints` now decides EVERY flag: taint on any
bound-weakening value, or verdict-free with a justification the test enforces.
`TestFlagSurfaceClosed` enumerates the registered set via `fs.VisitAll` and FAILS on any
flag missing from its classification table — the surface cannot silently grow an
unexamined override — then drives every mustTaint case through the REAL pipeline
(`parseFlags` on real argv → `acceptanceTaints` → `computeResult`) asserting non-pass
with the flag named in the taint. `TestLooseBoundsInvocationIsNonPass` runs Codex's
binding invocation verbatim: `-snapshot-max-age 2562047h -max-head-lag 2562047h` →
both taints present → `computeResult(0,0,taints)` = `tainted`/exit 1; loose-positive
`-max-head-lag 31m` alone taints; tighter `5m` does not; restating canonical defaults
does not.

**The closed flag-surface table** (every registered flag):

| flag | class | rule + reason |
| --- | --- | --- |
| `-config` | **taints** ≠ `config/contracts.json` | any other config changes the claim's SUBJECT (different contracts/streams); configSHA in the artifact is forensics, not a gate |
| `-engine` | **taints** ≠ `all` | acceptance requires both engines (pre-existing) |
| `-sample` | **rejected** <25 without `-allow-small`; **taints** <25 with it; ≥25 verdict-free | raising the floor only ADDS gated rows |
| `-allow-small` | **taints** jointly with `-sample`<25; inert alone | the joint form is the only weakening form |
| `-seed` | **taints** any non-empty value (NEW) | canonical seed is the OP pin's block hash — a chain fact; an operator-chosen seed can steer the sample away from failing accounts |
| `-include` | verdict-free | additive-only: forced includes append ON TOP of quota (selectSample pass 3) — they never displace seed-selected members |
| `-accounts` | **taints** any non-empty value (NEW) + `validateReplaySelection` violations still taint separately | replaces seed-derived membership with operator-chosen membership; the validator checks census SHAPE (size/strata/anchors), not selection — hand-picked membership could avoid known-drift accounts |
| `-pin-op` / `-pin-eth` | **taints** nonzero | acceptance pins are the derive cursors (pre-existing) |
| `-golden-pin-eth` / `-fixture-pin-eth` | **taints** ≠ canonical | fixed evidence pins (pre-existing) |
| `-snapshot-max-age` | **taints** any explicit value (NEW — finding 1) | replaces the §7 policy bound (auto = derived from the daemon's own cadence + sweep history) with an operator constant; looseness cannot be judged at parse time because the auto bound is DB-derived, so ANY override is noncanonical evidence |
| `-tolerance-dm-wei` | **taints** nonzero + forces `fail-with-tolerance` in `computeResult` | double-locked (pre-existing) |
| `-rps` | verdict-free | pacing only; stalls end in loud aborts (timeout/exit 3), never a pass |
| `-rpc-attempts` | verdict-free | ≤0 coerced to default in `newRPCRunner`; exhaustion is a classified loud abort; retrying more cannot change a hash-pinned answer |
| `-collateral-replay` | **taints** ≤0 (disable, pre-existing) and 1..2 (NEW: shrunken coverage); ≥3 verdict-free | positive-but-fewer replays weaken the same required check — the loose-positive class again |
| `-out` | verdict-free | artifact destination; failed write = loud abort |
| `-timeout` | verdict-free | expiry aborts loudly; waiting longer only makes wall-clock staleness gates stricter |
| `-max-head-lag` | **taints** ≤0 (pre-existing) and >30m (NEW — finding 1's loose-positive) ; (0,30m] verdict-free | a tighter bound can only turn pass into abort |
| `-preflight-only` | verdict-free | `execute` returns before Phase 1; no artifact is written (`finish` requires `phase1Done` or a verdict-fail) and no verdict exists — there is no receipt to launder |

**Mutation W13M1 generator-drop** (the `-snapshot-max-age` branch deleted from
`acceptanceTaints`) — **KILLED** by `TestFlagSurfaceClosed` AND
`TestLooseBoundsInvocationIsNonPass`.

## F2 [high] — inability-to-check is never advisory

**Built.** The two policies are now SEPARATE in `weldAaveAggregate`: the `gated`
parameter carries the side's NUMERIC-mismatch policy only (collateral
`aggregate-mismatch` stays ADVISORY per the amendment's first-run gating, promoted after
one clean run as before); **any `weld-unread` verdict sets `Gated=true` unconditionally,
on both sides** — the axiom is stated at the site verbatim: *"cannot verify" is NEVER
advisory... a weld-unread row GATES on every side, whichever weld produced it, because an
unreadable leg proves nothing about the universe it was supposed to verify.* The phase-2
call-site comment states the same separation, and the accounting there is now the shared
`aaveWeldGatedFailures` (no test-only twin: the test exercises THE function the live run
uses). A reverting `getReserveAToken` flows: resolution failure → `unresolvedColl` →
OK=false read fact → gated weld-unread row → `aaveWeldGatedFailures` → exit 1. The DM
weld side was already unconditionally gated (dmWeldRow has no advisory arm) — unchanged.

**Test.** `TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory`: on the collateral side
with `gated=false`, (a) a read-and-mismatched reserve stays ADVISORY, (b) a
`getReserveAToken`-reverted reserve (the exact OK=false shape phase 2 wires) and a
never-read universe reserve are BOTH gated weld-unread rows, (c) the REAL accounting
counts exactly the two unread rows, and `computeResult` returns `fail`/exit 1, (d) a
fully-read collateral weld with only numeric drift contributes ZERO gated failures — the
separation cuts both ways. **Mutation W13M2 unread-ungated** (unread rows fall back to
the side's numeric policy) — **KILLED** by that test.

## F3 [medium] — a REAL F5 seam, and the retraction

**The retraction, stated plainly (round-11 finding 3 cited):** wave 11 claimed
network-under-snapshot had become *unrepresentable* because `collectSnapshot`'s signature
carries no reader and `snapshotData` carries no connections. That claim was FALSE —
`TestSnapshotDataCarriesNoConnections` inspects DATA, not BEHAVIOR: `collectSnapshot`
could always have dialed through a package-level helper or an environment-derived client
without changing any signature or adding any field, and W11M5 certified only the
seam-smuggle property, not the F5 invariant. The claim is retracted here and in the code
comments at all three sites that made it (`phase1.go` header, `collectSnapshot` doc,
`phase1_seam_test.go` header — the last now scopes itself explicitly to the DATA half).

**Built — two enforcing mechanisms that FAIL on a network call while the RR transaction
is open:**

1. **Runtime sentinel `snapshotGate`** (`phase1.go`): `collectSnapshot` opens it
   immediately after `BeginTx` succeeds and closes it by defer at return (strictly after
   the commit-and-close). EVERY `pinnedReader` entry point — `headerHash`, `headerTime`,
   `callAtHash` (and `multicall` through it), `secondOpinion` (which bypasses the runner
   and so carries its own check) — consults the gate FIRST, before the runner, the
   limiter, or any dial, and refuses with a named `F5 seam violation` error while the
   snapshot is open. Package-level by design: the invariant is process-wide.
   `TestSnapshotGateBlocksReadersWhileOpen` proves all five entry points refuse — on a
   ZERO-VALUE reader, so any reordering of the check behind the dial machinery panics
   the test instead of passing; `TestSnapshotGateReopensAfterExit` pins the lifecycle
   (Stage B and the phase-2/3 welds must not inherit a stuck-closed gate).
2. **Structural AST walk `TestCollectSnapshotReachesNoChainSurface`**
   (`phase1_f5_seam_test.go`): parses the package's non-test sources, walks every
   function transitively reachable from `collectSnapshot` by name (conservative
   over-approximation: any call matching a package declaration pulls its body in), and
   fails on ANY mention of a chain surface — reader/runner types (`pinnedReader`,
   `chainReader`, `rpcRunner`), reader/dial method names (`headerHash`, `headerTime`,
   `callAtHash`, `multicall`, `secondOpinion`, `*From`, `Dial`...), or chain/network
   package qualifiers (`chain`, `ethclient`, `rpc`, `http`, `net`, `websocket`). DB
   packages are deliberately allowed — DB reads inside the transaction are the point of
   Stage A. Signature coverage is free: parameter types are idents inside the FuncDecl.

**The mandated mutation W13M3 header-under-BeginTx**: three mechanical edits reintroduce
an ACTUAL `r.headerHash(ctx, 1)` call inside `collectSnapshot` right after the gate
opens, plus the `r *pinnedReader` parameter and call-site change it needs. The mutant
**COMPILES CLEAN** (verified by an in-memory-restored build BEFORE the spec was
committed) — i.e., it is exactly the mutation wave 11 called unrepresentable — and was
**KILLED** by `TestCollectSnapshotReachesNoChainSurface` (kill fires on the smuggled
`pinnedReader` ident; the `headerHash` call check is a second, independent tripwire in
the same walk). The AST test's kill power was also negatively sanity-probed pre-commit
(a smuggled `var rr *pinnedReader` inside `collectSnapshot` fails it; restore verified
byte-identical). Belt on braces: on any live run the mutant's own execution path would
ALSO fail — the gate is open at the injected call site, so `headerHash` returns the seam
violation.

## Mutation matrix (committed applier; spec `a3fba23`, tested SHA `a3fba23`, transcript `e455229`)

| id | finding | mutant | killed by |
|---|---|---|---|
| W13M1 | F1 | `-snapshot-max-age` branch dropped from `acceptanceTaints` | `TestFlagSurfaceClosed`, `TestLooseBoundsInvocationIsNonPass` |
| W13M2 | F2 | weld-unread rows fall back to the side's numeric policy (`Gated=true` removed) | `TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory` |
| W13M3 | F3 | an actual `headerHash` call under `BeginTx` + the reader parameter it needs (3 edits, compiles) | `TestCollectSnapshotReachesNoChainSurface` |

3/3 KILLED; exactly-one-occurrence asserted per edit (CRLF-spelled patterns verified
against committed bytes); in-memory restores verified byte-identical; `git status` EMPTY
over all 3 mutated files after the loop.

## New tests this wave (the 6 PASS-list additions)

`cmd/reconcile`: `TestFlagSurfaceClosed`, `TestLooseBoundsInvocationIsNonPass`
(main_test.go), `TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory`
(aave_compare_test.go), `TestCollectSnapshotReachesNoChainSurface`,
`TestSnapshotGateBlocksReadersWhileOpen`, `TestSnapshotGateReopensAfterExit`
(phase1_f5_seam_test.go, new file).

## Deviations & residuals (each with reason)

1. **Scratch DB `solvent_t9w13` instead of `solvent_test`, private TMPDIR for the suite
   logs.** My first baseline attempt FAILED in `internal/store`: the sibling wave-12
   agent was running ITS acceptance suite concurrently — two destructive suites sharing
   `solvent_test`, and both `make test-acceptance` invocations writing the SAME
   hardcoded log path (`$TMPDIR/solvent-test-acceptance.log`), which spliced the logs
   mid-run. Nothing was harmed (both DSNs were scratch/live-read-only; the failure was
   test-level collision, and the live DB was never touched destructively). I created
   `solvent_t9w13` (same pattern as wave-11's `solvent_t9w11race`) and re-ran isolated;
   the controller has since codified a parallel-wave scratch-DB rule (`adfba01`). The
   guard's physical-split verification ran for real against the live DSN in every run.
2. **`-seed`, `-accounts`, and `-config` overrides now TAINT** (my own sweep of the
   flag surface, per the brief's "the class is any override that loosens what acceptance
   requires"). For `-accounts` this SUPERSEDES wave-11's stance that a
   validation-passing replay file is acceptance-clean: the validator checks census
   shape, not membership, and operator-chosen membership is sample steering — the same
   weakening class as an operator seed. The wave-11 stance was not in the closed list;
   if the controller re-adjudicates replay-untainted, each is a one-branch revert in
   `acceptanceTaints`. Flagged loudly rather than silently chosen.
3. **CLI behavior change (same class as wave-11 deviation 3):** debug invocations using
   `-seed`/`-accounts`/`-config`/explicit `-snapshot-max-age`/loose `-max-head-lag`/
   `-collateral-replay 1..2` now exit 1 (`result: tainted`) where they previously could
   exit 0. That is the point of closing the generator; the artifact names every taint.
4. **`SOLVENT_SNAPSHOT_INTERVAL` (env, not flag) can still loosen the `auto` freshness
   bound.** Out of this wave's binding surface (the finding and brief scope the FLAG
   surface), and the resolved bound + inputs are recorded in the artifact's
   `bound_inputs` (labeled policy). Named here as a residual for the controller/Codex:
   the same closure argument could be extended to bound-bearing env vars.
5. **The collateral-replay `not-served` degradation remains ungated** (rows degrade to
   report-only with endpoint+depth when the pinned replay is not served —
   L0-5/L1-5/L2-10). This is a cannot-check-ungated path, but it is a SEPARATE,
   previously adjudicated policy about OP non-archive reality, not the weld policy the
   finding names; round 11 did not reopen it. Named for completeness so the tension with
   the F2 axiom is on the record, not discovered later.
6. **The sentinel's wiring inside `collectSnapshot` is not executed by any test** (no
   test runs `collectSnapshot` against a database; building that fixture would duplicate
   store-level coverage for little marginal proof). The gate's refusal behavior is
   unit-tested at every reader entry point, the enter/exit placement is enforced by
   review + the AST walk (which independently forbids reachable readers regardless of
   the gate), and the first live evidence run will exercise the wiring for real. The
   PRIMARY structural enforcement for the mandated mutant is the AST test, which killed
   it hermetically.
7. **Interleaved sibling/controller commits** (`9fa2371`, `adfba01` mid-wave, `8a9e919`
   post-verification): docs-only, each verified by `git show --stat`; my final suite ran
   at `e455229` and the code bytes are identical from `36488dd` through HEAD.

## Unverified (stated plainly)

- The full Phase 1→4 pipeline still has not run end-to-end against the live database —
  the controller's evidence run, by design. The new taints, the gated collateral-unread
  path, and the snapshotGate wiring will see their first live exercise there.
- `getReserveAToken` remains selector-pinned but not live-verified (wave-11 residual 7,
  unchanged this wave); its failure mode is now STRICTLY fail-visible — a revert
  produces gated weld-unread rows and exit 1 instead of the advisory rows round 11
  flagged.

## Environment safety accounting

The backfill daemon and `solvent-db-1` were never stopped or restarted (container
healthy, "Up 47+ hours" at wave start). Live-DB access was read-only and enumerated: the
destructive guard's cached identity SELECTs and the recon evidence scans inside the two
acceptance runs (both against `SOLVENT_RECON_DATABASE_URL`, read-only session enforced).
One `CREATE DATABASE solvent_t9w13` on the shared cluster (scratch, never dropped, same
lifecycle as prior wave scratch DBs). Destructive test traffic ran against
`solvent_t9w13` only. Live RPC: the one pre-existing gate-ON `mainnet.optimism.io`
regression dial per suite run — the mutation loop and all six new tests dial nothing.
The aborted first baseline (shared-DB collision, deviation 1) is fully accounted: exit 1
from test assertions/collisions on scratch data, zero live writes, zero container
restarts.
