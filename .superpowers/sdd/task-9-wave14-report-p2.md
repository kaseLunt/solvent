# Task 9 — wave 14 report: bounded retention lease (ingest)

Brief: `task-9-wave14-brief.md` (BINDING). Finding fixed: Codex round 12 [high]
(`task-9-codex-round12.md`, verbatim + the controller adjudication that ACCEPTS it and
REVISES the annex `consult-chaintruth-walker-rotation.md`): unconditional landing
retention (`walker.go`, the wave-12 seam's `stepLanded` arm) permanently pins a
slow-but-successful endpoint — the one degraded posture error-driven rotation
structurally cannot see, because the offender never errs and never trips the
per-attempt timeout. Pattern transposed: the poller's bounded ambiguity lease
(`d1e7d54`, `internal/prices/poller.go` `maxConsecutiveAmbiguous`/`onAmbiguousApply`),
READ only — nothing in `internal/prices` was touched.

Base: start commit `f6a076f` (wave-13 close + round-13 dispatch). Branch `main`,
parallel tree — wave 13 had fully landed BEFORE my start (its tests are in my
baseline); wave 15 (reconcile, round-13 fixes) was briefed mid-wave and owns
`cmd/reconcile/**`, disjoint from everything here.

**THIS WAVE REOPENS CODEX-APPROVED INGEST SURFACE UNDER D-006 — SAY-SO, PLAINLY:**
`internal/ingest/walker.go` (round-1-cleared, structurally reworked in wave 12, that
rework reviewed by round 12) is modified again — the seam's landed arm becomes the
lease. `internal/chain/**` is UNTOUCHED (no chain change was forced; see the
restatement decision below). `cmd/indexer` non-test files are UNTOUCHED; one NEW test
file is added there (flagged below, as the brief allows). An adversarial round over
this wave is mandatory before any of it is treated as settled.

| commit | contents |
| --- | --- |
| `b70d612` | THE FIX: bounded retention lease in `walker.go` (constants + `recordLanding` + the probe block in `Step`); fake grows per-endpoint `readCost` + `advanceClock` (`walker_fake_test.go`); BOTH binding regressions (`walker_latency_test.go`, NEW file) |
| `508c0be` | daemon scheduling assertions (`cmd/indexer/walker_latency_scheduling_test.go`, NEW file — deviation flagged below) |
| `0340ed0` | mutation spec `.superpowers/sdd/t9w14-mutations/mutations.json` (3 mutants, the brief's mandated rows), committed BEFORE the loop |
| `67cda28` | mutation transcript, **3/3 KILLED**, tested SHA `0340ed0`, in-memory restores verified byte-identical |
| (this commit) | `task-9-wave14-report-p2.md` |

Scope: `git diff --name-only f6a076f..67cda28` restricted to my allowlist =
`internal/ingest/{walker.go, walker_fake_test.go, walker_latency_test.go}`,
`cmd/indexer/walker_latency_scheduling_test.go`, `.superpowers/sdd/t9w14-mutations/**`.
Pathspec staging on every commit; the scope gate accepted each. ONE interleaved
commit, not mine, docs-only, verified by `git show --stat`: `a742f36` (controller:
round-13 NO-SHIP archive — the reconcile review — + wave-15 brief +
progress-phase2 ledger line). Its two files sat UNTRACKED in the shared working tree
mid-wave; I staged nothing outside my pathspecs and never touched them.

## The fix, precisely

The wave-12 seam is unchanged in shape: one deferred outcome handler, zero value
non-landing, landing the only outcome that keeps the starting point. What changed is
the LANDED arm: it now routes through `recordLanding`, where retention holds by
DEFAULT and the lease is the one bounded exit.

1. **Measurement.** `Step` samples its wall clock (`w.now`, a seam; production is
   `time.Now`) before the resolving head read; the deferred seam computes the Step's
   wall time once, for whichever arm runs. The measurement deliberately includes the
   store write: the budget is about the Step's occupancy of the serialized daemon
   loop, RPC dominates it, and a local write is noise against a 30s budget.
2. **Accounting (`recordLanding`).** A landing within budget restarts the lease. An
   over-budget landing on the SAME retained endpoint consumes the lease one landing
   further and becomes the probe's comparison baseline; on a DIFFERENT endpoint it
   starts that endpoint's own count at one (the count is evidence about one witness,
   never inherited). Caught-up leaves the lease UNTOUCHED — no window was attempted,
   so nothing is judged, latency included. Any non-landing resets it — the seam's
   advance has already moved routing, and the count's "consecutive landed Steps"
   premise is broken.
3. **The probe.** At `MaxConsecutiveSlowLandings` the NEXT Step STARTS at
   `startPref+1` — caller-scoped: the shared hint is neither consulted nor written,
   and `startPref` is NOT moved. Adjudication on the probe's outcome:
   - lands strictly FASTER than the baseline → ADOPT: retention transfers
     (`startPref = probe`), and the adopted endpoint's own lease starts from this
     landing's measurement (over-budget adoption starts at one, so a uniformly slow
     fleet keeps probing round-robin instead of laundering the count);
   - lands NO FASTER (ties included) → return to the incumbent — a routing no-op,
     since `startPref` never moved — and the lease re-arms IN FULL;
   - FAILS or DISCARDS → the existing seam handles it as any non-landing: advance
     past the probed endpoint; nothing special-cased;
   - the failover walk answers the probe from the INCUMBENT itself (probed neighbour
     down) → ordinary landing accounting; the lease stays spent, so the next Step
     probes again — the liveness owed a recovering neighbour;
   - single configured endpoint → no probe, no pretending; retention stands.

## The budget derivation (mandated; no new magic numbers)

Two inputs, both existing facts, both stated in code (`walker.go`, the constants
block above `stepOutcome`):

- **The per-attempt timeout.** `chainAttemptTimeout = 30s` RESTATES
  `chain.defaultAttemptTimeout`, which `internal/chain` keeps unexported.
  Restatement-with-citation is this repo's standing cross-package pattern for reusing
  a ratified constant — `internal/prices.maxConsecutiveAmbiguous` restates
  `internal/snapshot`'s with the same sentence — and a chain-side export was NOT
  forced, so `internal/chain` stays closed (my brief: stop if a chain change is
  forced; it was not). The drift risk this leaves is disclosed under "unverified".
- **The round shape.** `stepMaxPinnedReads = 6`: the resolving head read, the
  reorg-check header, the tip header, the logs window, the tip recheck, the cursor
  recheck — a description of `Step`'s own structure (count them in the function), not
  a knob. Codex's finding derives its "~15 minutes" from exactly this shape.

**Derivation:** the failover's blind spot is a Step whose every read lands just below
`chainAttemptTimeout` — wall time up to `stepMaxPinnedReads × chainAttemptTimeout`
(~3 min) with no error and no timeout ever firing. A healthy endpoint lands a whole
Step in a small fraction of ONE attempt bound. So
**`slowStepBudget = 1 × chainAttemptTimeout`**: a landed Step that spent more wall
time than the chain layer allows a single read has spent at least one entire
pathological read's worth of waiting, and the round shape separates the postures
unambiguously — the blind-spot ceiling sits `stepMaxPinnedReads×` above the budget,
healthy landings far below. No third constant exists, so nothing can be tuned and
nothing can drift except the two stated inputs (mutation W14M3 attacks exactly the
relation and dies).

**The lease length** `MaxConsecutiveSlowLandings = 3` is not a new number either: it
is the ratified lease length of `d1e7d54` (`maxConsecutiveAmbiguous`, itself restating
`internal/snapshot`'s), carried with the same reasoning — one slow landing is likely
weather; persistent recurrence is bounded evidence retention stopped paying off. It is
EXPORTED for the daemon-level assertion (below).

**The finite bound, stated:** under the pathological schedule the fast peer is
reached at Step `MaxConsecutiveSlowLandings+1` exactly, at a total wall cost of at
most `(MaxConsecutiveSlowLandings+1) × stepMaxPinnedReads × chainAttemptTimeout`
(= 12 min, once, versus 15 min per round FOREVER before the fix). Both halves are
asserted in the regression, not just stated here.

## Both regressions (binding), cited

| regression | test | what it pins |
| --- | --- | --- |
| **Codex round-12 (the finding's own schedule verbatim):** endpoint 0 lands every read at `chainAttemptTimeout−1s` (blind spot: no error ever fires), endpoint 1 fast | `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound` (internal/ingest) | endpoint 1 REACHED at Step `MaxConsecutiveSlowLandings+1` — the finite bound asserted on the resolution trace `[0,0,0,1,1]`; retention transfers; every Step of the schedule still LANDS (no landing sacrificed); the shared hint never consulted/written; total wall cost ≤ the stated bound; and the derivation inequalities themselves (pathological Step > budget, < ceiling) |
| **The annex's (A-bounce family, still binding):** both endpoints inside the per-attempt bound, the neighbour SLOWER — a real uniformly-degraded fleet | `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease` (internal/ingest) | the probe is NOT a reset: trace `[0,0,0,1,0,0,0,1]` — one probe per spent lease, return to the incumbent, lease re-armed in full, `startPref` never left 0, hint untouched, all 8 Steps landed |
| R3/R5 family (wave 12) | unchanged, green | fast landings never arm the lease (wall ≈ µs under `time.Now`), so retention/liveness traces are byte-identical to wave 12's |

## The daemon-level scheduling assertion (and the flagged new file)

`cmd/indexer/walker_latency_scheduling_test.go` — **NEW cmd/indexer test file,
flagged as the brief allows**: `stepWalkers`, `stepsPerRound`, `walkerState`,
`retryBackoff` are unexported package-main composition, so the assertion can only
live in this package; it extends the R9 harness helpers (`fakeIngestWorker`,
`newTestHealth`, `publishRound`) rather than duplicating them, and it is a new file —
zero collision surface with wave 15 (`cmd/reconcile/**`).

`stepWalkers` itself is deliberately time-blind (its yield is a STEP bound), so the
composition is pinned from both sides:

- `TestStepWalkersSlowLandingWalkerCannotStarveSiblings`: a walker that lands every
  Step — exactly how the slow-successful posture arrives at this layer — is bounded
  at `stepsPerRound` Steps per round however much it advances, its sibling is stepped
  in the SAME round, no backoff is burned, no step_error is raised. Delay is possible
  (the loop is serialized by design); starvation is not.
- `TestWalkerRetentionLeaseSpendsWithinOneDaemonRound`: the cross-layer inequality
  `ingest.MaxConsecutiveSlowLandings+1 ≤ stepsPerRound` (3+1 ≤ 5) — the lease spends
  AND its probe fires inside a SINGLE stepWalkers round, so the slow endpoint's
  monopoly of the serialized loop ends within the round the pathology starts in. This
  is the "finite, stated bound" property in cross-layer form; if either constant
  drifts past the other, this pin refuses it.

No `cmd/indexer` non-test file changed: the daemon needed no change — the walker
returns landings as before, and the fix lives entirely below the `Step` interface.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `f6a076f`: 760 / 0 / 0, exit 0**, via `make test-acceptance` in a
  PINNED WORKTREE at the start commit (the parallel-tree discipline: the suite never
  raced my working tree) — posture: gate ON (`SOLVENT_LIVE_RPC_TESTS=1`),
  `TEST_DATABASE_URL` → **`solvent_t9w14`** (OWN scratch DB, created this wave per
  the standing parallel-wave rule; never `solvent_test`, never `solvent`), `.env`
  DSNs exported by the Makefile (`SOLVENT_DATABASE_URL`, `SOLVENT_RECON_DATABASE_URL`
  → live, read-only evidence tests), `SOLVENT_RPC_*` cleared by the target. The
  target's own gate: "acceptance mode: exit=0 skips=0". Identical to wave-13's
  reported final (760/0/0) — consistent: the interval `61a512e..f6a076f` was
  docs-only.
- **Final @ `67cda28`: 764 / 0 / 0, exit 0**, same posture, same target, main tree
  (clean at HEAD; the only non-HEAD content was the controller's two untracked doc
  drafts, which no go build reads). Gate: "acceptance mode: exit=0 skips=0",
  "acceptance suite green: zero skips".
- **PASS-list diff, both directions: 0 removed, exactly 4 added** — all four are this
  wave's tests (2 in internal/ingest, 2 in cmd/indexer; the tables above). 760+4=764.
  **Sibling reconciliation:** wave 13's additions are INSIDE the baseline (it closed
  before my start commit); the in-wave interval contains exactly one sibling commit,
  `a742f36`, docs-only by `git show --stat`, so the expectation was additions =
  exactly this wave's tests, zero removals: MET EXACTLY. No pre-existing test changed
  name, changed assertion, or vanished — wave-12's R1–R7 rotation suite runs
  unmodified.
- **-race (ingest + cmd/indexer, the two packages this wave touches) in
  `golang:1.24` via docker, DB at `host.docker.internal` (`solvent_t9w14`), gate ON:
  exit 0, 123 top-level `^--- PASS` / 0 FAIL / 0 SKIP, zero DATA RACE, both packages
  `ok`.** PROVENANCE: the wave agent was lost after writing this report but before
  recording its `-race` counts; the CONTROLLER re-ran the verification at HEAD
  `33fd775`, first proving `git diff 67cda28..HEAD -- internal/ingest cmd/indexer
  internal/chain` EMPTY (the interval is docs-only), so the run exercises
  byte-identical package trees to this wave's final commit. All four of this wave's
  tests (`TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound`,
  `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease`, and the two cmd/indexer
  scheduling pins) PASS under `-race` in that run.
- **Build/vet:** `go build ./...`, `go vet ./internal/ingest/ ./cmd/indexer/` clean.
  **Committed-blob gofmt:** all 4 touched `.go` blobs at HEAD extracted via
  `git cat-file` to temp files — `gofmt -l` CLEAN (the working-tree check stays
  CRLF-noisy repo-wide; the blob check is the bar).
- **Mutation matrix: 3/3 KILLED** through the committed applier
  (`wave16-mutations/mutate.py`), spec committed before the loop (`0340ed0`), tested
  SHA `0340ed0`, every pattern exactly-once-asserted, restores from in-memory copies
  verified byte-identical, `git status` over the mutated file EMPTY after the loop.
  Every kill names real failing tests — no build-failure fake kills (W14M1's replace
  deliberately keeps `wall`/`probing` referenced so the mutant COMPILES and dies on
  behavior).
- **Environment:** backfill daemon against DB `solvent` untouched throughout (never
  stopped, never signaled); `solvent-db-1` untouched; tests only ever pointed at
  `solvent_t9w14`.

## Mutation matrix (committed applier; spec `0340ed0`, transcript `67cda28`)

| # | mutation | property (stated in spec verbatim) | result | killed by |
| --- | --- | --- | --- | --- |
| W14M1 | budget-removed: landed arm bypasses `recordLanding`, retains unconditionally | retention is BOUNDED; removing the lease restores the round-12 pin (fail-forever for latency) | **KILLED** | both latency regressions |
| W14M2 | probe-adopts-unconditionally: baseline comparison forced true | a probe landing is ADJUDICATED; unconditional adoption recreates the bounce pole the annex closed | **KILLED** | `TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease` |
| W14M3 | budget-derivation drift: budget raised to the blind-spot ceiling (`stepMaxPinnedReads × chainAttemptTimeout` — the natural wrong derivation, "budget = worst case") | the derivation is load-bearing and the bound finite and stated; at the ceiling the pathological posture is invisible and the pin returns | **KILLED** | `TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound` |

## The next ingest-surface Codex round: the FULL commit set (mandated statement)

The brief called this "round 13"; round numbering has since advanced — round 13 was
consumed by the wave-13 reconcile review (`a742f36` archives it; its findings belong
to wave 15, `cmd/reconcile/**`). Whatever number the next INGEST round carries, its
diff framing MUST cover, explicitly:

- **`10ed6d8`** (wave 12: per-endpoint fake harness precondition) and **`b6e7c2f`**
  (wave 12: chain-layer additive `BlockNumberFrom`/`LogsFrom` + R8) — both landed
  BEFORE `ffb3235` and were OUTSIDE round 12's `4feecf6` vs `ffb3235` framing;
- **this wave's commits: `b70d612`, `508c0be`, `0340ed0`, `67cda28`**, plus the
  report commit that lands this file.

Recommended framing that covers all of it in one range: diff **`68ccfdb`
(wave-12 base) → wave-14 final**, restricted to `internal/ingest/**`,
`internal/chain/**`, `cmd/indexer/**` — that range contains the whole wave-12 ingest
surface (including the two previously-missed commits), wave 14, and nothing of the
reconcile waves (13/15 are disjoint by pathspec).

## Unverified / limits (nothing hidden)

- **The `chainAttemptTimeout` mirror can drift silently.** No test can compare
  ingest's restated 30s against `chain.defaultAttemptTimeout`, because the chain
  constant is unexported and `internal/chain` was out of scope (a change there was
  NOT forced — restatement-with-citation is the repo's own precedent — so I did not
  stop). W14M3 guards the budget-vs-ceiling RELATION, not the mirror's equality: if a
  future chain wave moves `defaultAttemptTimeout`, ingest's mirror must move by hand.
  Flagged for the controller: a one-line exported constant (or accessor) in a future
  chain-open wave would close this permanently.
- The lease's behavior under REAL latency is proven at the fake layer only (the
  walker's `now` seam + the fake's `advanceClock`); no live slow-endpoint injection
  run exists. The wall measurement includes store-write time by design (argued above,
  not separately tested).
- The single-endpoint arm of the probe (n≤1: no probe, retention stands) has no
  dedicated regression; it is two lines guarded by inspection and by the existing
  single-endpoint honesty test for non-landings. Disclosed, not claimed.
- Caught-up Steps leave an armed probe armed (documented in the seam comment); under
  a long caught-up phase the head/reorg reads of each Step start at the probe target.
  Harmless by argument (no window is at stake and resolution falls through to the
  incumbent if the neighbour fails), not separately tested.
- F4 (responsive-frozen endpoint) and F3 (rewind corroboration) remain OPEN exactly
  as wave 12 recorded them; the lease measures LANDING latency and deliberately
  claims nothing about caught-up staleness (F4's territory).
- Wave-12's committed mutation spec (`t9w12-mutations/mutations.json`) targets
  wave-12 line shapes; two of its patterns (M1's landed-arm line, M6's retention
  line) moved into `recordLanding` this wave. The spec remains valid FOR ITS
  RECORDED SHA (`d6cb441`) — transcripts pin SHAs — but a re-run at HEAD would need
  re-anchored patterns. Noted so nobody mistakes a NOT-APPLIED at HEAD for evidence.

## Returns to Codex under D-006

Expected closing round for the ingest reopen. The round should target: the lease
accounting's arm coverage in `recordLanding` (adoption/return/inheritance edges), the
probe block's interaction with the resolution walk (probe answered by the incumbent,
by a third endpoint, by nobody), the caught-up-keeps-armed decision, the wall
measurement's inclusion of store time, and the two restated constants' drift story —
alongside the standing wave-12 targets it inherits (the outcome-flag discipline and
the R3/R9 pair).
