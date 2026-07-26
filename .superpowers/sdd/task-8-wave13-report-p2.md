# Task 8 — wave 13 report: Codex round-10 fixes (HEALTH unit)

**Unit:** `92a454d` (both fixes) → `48b9bcb` (the two gaps the mutation loop found).
**Base:** `872137d`. **Returns to Codex for round 11 under D-006, reviewed on its own.**

Both round-10 findings closed. **15 mutations, all 15 killed by assertions** — one of them
only after the loop found a hole nobody had thought to look in, and one after a "kill" that
turned out to be a compile error wearing a kill's clothes.

---

## READ THIS FIRST — four things round 11 should judge deliberately

### 1. The [high] needed TWO changes, and the obvious one alone does nothing

Codex's recommendation reads as one sentence, but stamping from a monotonic clock at fetch
completion **does not on its own bound anything**. I measured it: with completion stamping
and no budget, nine workers whose anchors were taken 4 s apart simply expire 4 s apart, so
every pass still finds every anchor expired and still pays nine reads. The completion stamp
stops a stamp being charged for the latency of the read that produced it; the **budget** is
what stops nine simultaneous expiries becoming nine simultaneous reads. Both are in, both are
mutated separately (M1, M2), and `headerRestampThrottle`'s comment says neither works alone.

### 2. The budget needed a FAIRNESS rule, and the obvious fairness rule deadlocks

A budget without one starves: the workers the daemon judges first win the allowance in every
window and the ones judged last are never re-anchored, which would make bound 2's ⌈W/R⌉ a
sentence with nothing behind it. **This was measured, not predicted** — the first
implementation shipped a due-set queue and the harness reported worker 6 at *zero* refreshes
over five minutes, because the early workers re-enter the queue before the late ones get a
turn.

The replacement is a **rotation keyed on who ASKED**, not a queue of who is owed, and the
reason is worth reviewing: a queue has a head, and a head is something to get stuck behind. A
worker whose cursor stalls stops reaching this arm at all (the exact-block hit answers it
first), so a queue would wait forever on a scope that will never ask again and **no worker on
that chain would ever be refreshed**. `refreshAsked` is rebuilt every rotation, so a scope that
stops asking drops out and blocks nobody, and a single deep-stale worker completes its rotation
by itself and is refreshed every window exactly as before.

### 3. The [medium] is fixed at the SOURCE of the clock, and the predicate Codex cited is left alone

`beyondSkewTolerance` (`main.go:1005-1006`, the cited lines) is **not** widened. It cannot be:
a header genuinely five minutes old, and a header fifteen minutes old under a ten-minute
rollback, are the same two numbers. Widening it would be guessing. Its comment now states what
it does not cover and why that is structural. The defect was never in the predicate — it was in
trusting the clock the predicate compares against — so the verdict clock became the **database
clock**, and the daemon's wall clock is retained only for scheduling, where it is used through
`Sub` and is therefore monotonic.

**Two clocks, two jobs, and a mutation for each direction.** This is the part I would most want
a second opinion on, because the tests that existed drove *both* roles from one fake clock and
were therefore structurally unable to see a confusion between them. That is now closed by a test
that moves them independently (§K1/K2 tables below) — and it is how M15 was caught.

### 4. `internal/store/derive.go` modified for the 7th time (flagged, as instructed) — one method, additive

`Store.Now` — `SELECT now()`, normalised to UTC. No existing statement, projection or comment in
that file is touched; `git diff` on it is +28/−0. It is the only file outside `cmd/indexer/**`
in this unit. `internal/prices/**` and `internal/store/prices*.go` were never opened.

---

## K1 [high] — the throttle must survive SLOW SUCCESSFUL fetches

### The change

**(a) `headerStamp.fetchedAt` is read from a monotonic clock at fetch COMPLETION.** The judge
now carries `sched func() time.Time` (production: `time.Now`, used only through `Sub`, so the
differences are Go's monotonic readings). `measure` reads it once at entry for the reuse-window,
cooldown and budget comparisons, and **again after the fetch returns** for everything the
measurement schedules.

**(b) A per-chain refresh budget**, `admitRefresh` / `chargeRefresh`, governing exactly one arm:
the deep-stale re-read. It admits while the chain has charged less than `headerFetchTimeout` of
read time to the current `headerRestampThrottle` window, and rotates admissions so no scope
repeats while another that asked is still waiting.

**Why only that arm.** Deferring a re-read is admissible *there and nowhere else*: the anchor is
already past the bound and reuse only over-estimates, so a deferred worker keeps reading RED. An
initial read (no anchor at all) is never budgeted — refusing it would report a measurable worker
as unmeasured — and the `(bound/2, bound]` band stays exactly as wave 11 left it, always exact,
because that is the band where an approximation could flip a verdict.

**The two bounds, both stated on `headerRestampThrottle` as required:**

1. **COST.** At most `headerFetchTimeout` of refresh reads is *started* per chain per window,
   worst case just under `2 × headerFetchTimeout` because admission is decided before a read
   whose duration is not yet known. **No new constant:** one attempt per chain per
   `headerFetchCooldown` costing up to `headerFetchTimeout` is the spend the failure path was
   already given, and `headerFetchCooldown` and this window are the same 30 s. It holds whatever
   a pass costs and however many workers are gated — which is exactly what the bare window did
   not.
2. **FRESHNESS.** One window when the budget does not bind (the healthy case: nine reads cost
   milliseconds against a ten-second budget, so **nothing wave 11 measured changes**), and
   ⌈W/R⌉ windows when it does, W = the chain's deep-stale scopes, R = `headerFetchTimeout` ÷
   per-read latency. **This revises wave 11's disclosure**: a caught-up worker stays red for up
   to one window became up to ⌈W/R⌉ windows, reached only while the endpoint is slow enough for
   the budget to bind. Degrades in proportion to the endpoint, fail-closed, never unbounded.

### The measurement, and the axes it varies

`TestSlowSuccessfulReadsStayBoundedAndStillRecover` — nine gated workers on one chain, cursors
72 h behind and advancing every round, hot loop at 200 ms, and **every successful read costs
4 s**, inside the 10 s timeout. The clock advances **during** each read, not around the pass,
because the defect is precisely that a pass's duration was not attributed to the reads causing
it.

| same harness, same five minutes | header reads | **completed rounds** |
|---|---|---|
| **pre-fix** (round-start stamping, no budget — MEASURED) | 81 | **9** |
| **this code** | 36 | **780** |
| wave 11's cost test against that *same reverted code* | 9 / 20 rounds | unchanged |

**The read count barely doubles; the round count is the finding.** Nine sequential four-second
reads is 36 s of wall clock per pass, so the daemon completes nine rounds in five minutes and the
backfill runs at that rate — the hot-loop collapse the throttle exists to prevent, restored in
full, on an endpoint that never once failed. The third row is the axes lesson in one number: the
wave-11 harness cannot see any of this, because its reads are instantaneous.

**Catch-up recovery, in the adversarial order.** Worker blocks *descend* with the judged order,
deliberately: a read re-anchors the chain stamp for every worker judged after it at a *higher*
block, so with ascending blocks one read re-greens most of the deployment and the rotation is
never asked to do anything. Descending, every one of the nine must be re-anchored on its own.
Measured: **6 of 9 still red after one window; all green after 1m18s** against the ⌈W/R⌉+1 = 2m
bound. The "still red after one window" figure is asserted *after* the loop on a value the loop
had to record, so a recovery that finished early fails the test instead of skipping the assertion.

### The lesson, encoded where it will be read

`staleness_budget_test.go` opens with a five-axis table (data age, fetch latency, fetch outcome,
workers per chain, clock behaviour) and a row per shipped measurement saying which axes it varies.
Wave 11's cost test and its one-window disclosure test each gained an **AXES VARIED** paragraph
naming what they hold easy and pointing at the number that covers the other point. The table also
says what is *not* covered: nothing here varies fetch-outcome at hard latency, because a chain
that both fails and takes ten seconds to fail is governed by the retry cooldown wave 11 already
measured.

### Citing tests

| property | test |
|---|---|
| the reuse window runs from the read FINISHING, isolated from the budget (one worker, one 20 s read) | `TestTheReuseWindowStartsWhenTheReadFINISHES` |
| a slow successful pass stays bounded in reads AND keeps the hot loop turning | `TestSlowSuccessfulReadsStayBoundedAndStillRecover` |
| no worker is starved of the budget — every one re-anchored, repeatedly | same test, per-worker refresh counts |
| catch-up recovers, is not instant, and is bounded by ⌈W/R⌉ windows | same test, recovery leg |
| the budget window rolls on the MONOTONIC clock, not the verdict clock | `TestSchedulingRunsOnTheMonotonicClockAndTheVerdictDoesNot/refresh_budget_window` |
| the healthy cost is unchanged (9 reads / 20 rounds, 2 for a dead chain) | `TestStalenessPassCostOnAGenuineHistoricalBackfillAndADeadChain` (wave 11, passing unmodified) |
| a reuse still never renews the window, after the arm was restructured | `TestDeepStaleBackfillReusesTheAnchorInsteadOfRefetchingEveryRound` (wave 11) |
| deep-stale reuse is still upward-only | `TestAReusedAnchorIsNeverConsultedForALowerBlock` (wave 11) |

---

## K2 [medium] — one source of time truth per verdict

### The change

`stalenessJudge` carries `clock verdictClock` (`func(ctx) (time.Time, error)`), bound in the
daemon to `store.Store.Now`. `applyStalenessConditions` **no longer takes `now`**; it reads the
verdict clock once per pass, so every worker in a round is judged against one instant, and the
daemon's wall clock is not an input to the verdict at all. The call site says so explicitly.

**Failure is fail-closed and is the point, not an edge case.** A failed clock read produces
`staleness_unmeasured` for every gated worker (`applyClockUnmeasured`), mirroring the pass's
existing skip rules so a worker already carrying `progress_unmeasured` is not told the same thing
twice. The tempting handling — carry on with the local clock "just for this round" — is exactly
the substitution the finding is about.

**Cost:** one extra `SELECT now()` per daemon round, alongside the two cursor-progress reads the
pass already makes. Sub-millisecond against a local server; stated rather than left to be found.

### Citing tests

| property | test |
|---|---|
| **the finding's exact arrangement**: rollback (10 m) smaller than the header's age (15 m), crossing the 10 m boundary → NOT green | `TestAClockRollbackSmallerThanTheHeaderAgeCannotTurnStalenessGreen` |
| — and the **precondition** asserted explicitly: `beyondSkewTolerance` is FALSE, so the skew guard is provably not what saves it | same test |
| — and the **counterfactual** reproduced: the same round judged on the daemon's clock reads GREEN | same test, second half |
| — and the **reported age** is 15m, not 5m: the operator surface does not under-state exposure by the rollback | same test |
| no trusted clock ⇒ unmeasured, never green, never a fabricated red, and no header read paid for | `TestNoTrustedClockIsUnmeasuredNeverGreen` |
| the real `store.Now` round-trips through real Postgres, is UTC, and satisfies `verdictClock` | `TestTheFreshnessVerdictIsMeasuredAgainstTheREALDatabaseClock` (live) |
| scheduling reads the monotonic clock and the verdict does not — on all three reuse arms | `TestSchedulingRunsOnTheMonotonicClockAndTheVerdictDoesNot` (3 subtests) |

The live test exists because wave 11's residual #3 was "the new store method has no test of its
own". This one has: it asserts the value is a real instant (a zero value would date every header
to 1970 and redden the deployment) and that it is UTC, and mutations M10 (`now() - interval '1
hour'`) and M11 (drop `.UTC()`) are both killed by it.

---

## Mutation results — 15 mutations, 16 runs, all 15 killed by assertions

(16 runs because M5 was re-run: its first form was killed only by the compiler. See below.)

Every kill is an assertion failure. Files are restored from an in-memory byte-exact backup;
**`git checkout --` is never used**, because a stray checkout in this shared tree would destroy
the parallel implementer's uncommitted work.

| # | Property validated | Verdict | Killed by |
|---|---|---|---|
| M1 | the reuse window runs from the fetch COMPLETING, not the pass starting | KILLED | `TestTheReuseWindowStartsWhenTheReadFINISHES` |
| M2 | a chain spends at most `headerFetchTimeout` of refresh reads per window | KILLED | `TestSlowSuccessfulReads…` |
| M3 | refresh admissions ROTATE — none repeats while another that asked waits | KILLED | `TestSlowSuccessfulReads…` |
| M4 | the budget charges MEASURED read time, so it self-tunes to the endpoint | KILLED | `TestSlowSuccessfulReads…` |
| M5 | the budget window ROLLS — a per-window allowance, not a one-shot one | KILLED (see below) | `TestScheduling…/refresh_budget_window`, `TestSlowSuccessfulReads…` |
| M6 | a REUSE never renews the window, after the arm was restructured | KILLED | 3 tests |
| M7 | the verdict is measured against the DATABASE clock, not the daemon's | KILLED | `TestAClockRollbackSmaller…`, `TestNoTrustedClock…` |
| M8 | no trusted clock ⇒ UNMEASURED, never a wall-clock fallback | KILLED | `TestNoTrustedClock…` |
| M9 | a round with no time authority is REPORTED, not passed over in silence | KILLED | `TestNoTrustedClock…` |
| M10 | the authority is the database server's own current time | KILLED | `TestTheFreshnessVerdict…REAL…` (live) |
| M11 | the authority is normalised to UTC | KILLED | `TestTheFreshnessVerdict…REAL…` (live) |
| M12 | deep-stale reuse stays UPWARD-ONLY after the restructure | KILLED | `TestAReusedAnchorIsNeverConsultedForALowerBlock` |
| M13 | the NEAR-HEAD reuse window is scheduling ⇒ monotonic clock | KILLED | `TestScheduling…/near-head_arm` |
| M14 | the DEEP-STALE reuse window is scheduling ⇒ monotonic clock | KILLED | `TestScheduling…/deep-stale_arm` |
| M15 | the REFRESH BUDGET's window is scheduling ⇒ monotonic clock | **SURVIVED, then KILLED** | `TestScheduling…/refresh_budget_window` |

### The gap the loop found (commit `48b9bcb`)

**M15 survived, and it is the worst failure mode of the three clock-split arms.** Every other
test in the package drives both of the judge's clocks from one fake — realistic, since a healthy
daemon's monotonic clock and its database's clock do advance together, and *exactly* why none of
them could see a confusion between the two. Windowed on the verdict clock, the budget stops
rolling the moment that clock stops moving or steps back: the first window's allowance is spent,
never renewed, and every deep-stale worker on the chain rides an anchor nothing re-reads again.
A permanent, silent loss of the catch-up guarantee, with **no verdict ever looking wrong**.
`TestSchedulingRunsOnTheMonotonicClockAndTheVerdictDoesNot` now moves the two clocks
independently across all three arms and kills M13, M14 and M15. Found by mutation, not by review.

### A kill that was not one

M5's first form (`if !windowed {`) left `opened` unused, so it was killed by the **compiler**,
which proves nothing about the tests. The harness distinguishes the two and reported it as
`KILLED (build/vet) WEAK`. It was rewritten as a compiling mutation (the window rolls after 100
windows instead of one) and is now killed by assertion. Recorded because a harness that counts
compile errors as kills is a harness that flatters itself.

---

## Verification

**Baseline at `872137d`: 555 top-level PASS / 646 including subtests / 0 FAIL / 0 SKIP.**
**This unit at `48b9bcb`: 561 / 655 / 0 FAIL / 0 SKIP.** (+6 top-level, +9 including subtests:
6 new tests and 3 new subtests; nothing deleted.)

**Counting convention** (wave 11's, unchanged): top-level = `grep -c '^--- PASS'` (an unindented
`--- PASS` is a top-level test); including subtests = `grep -cE '^\s*--- PASS|^--- PASS'`. FAIL
and SKIP counted the same way. The six new top-level tests were confirmed by diffing the two
runs' PASS lists, not by arithmetic.

```
go build ./...   OK
go vet ./...     OK
gofmt            see below — READ, and it is the CRLF artefact
go test ./... -count=1 -v      0 FAIL / 0 SKIP
-race, golang:1.24 via host.docker.internal   all 9 packages ok, 0 data races
control-plane doctor + scope-gate on both commits: OK -- 0 error(s), 0 warning(s)
```

### Why this was measured in isolation, and how

The working tree is shared with the parallel prices wave, which committed **four times** during
this wave (`ea47649`, `322dd74`, `1705f2e`, `872137d`) — so a count taken in the tree would have
included their tests and attributed them here. Both numbers above therefore come from **`git
archive` exports** of the two commits into scratch directories (read-only; no worktree created or
removed) against **dedicated databases** (`solvent_w13base`, `solvent_w13unit`, `solvent_w13race`)
on the same `solvent-db-1` instance, so the other wave's schema was neither read nor written.

**All staging was by explicit pathspec; `git add -A` was never used.** The scope-gate reported 7
paths on the first commit and 1 on the second, matching exactly what was intended.

**One hazard worth naming for the next parallel wave.** The other implementer's mutation harness
restores files from its own backups, and it wiped my uncommitted `internal/store/derive.go` edit
**twice** before I committed it — silently, mid-build, presenting as `st.Now undefined`. I made
the edit idempotently re-appliable and re-applied it before every command until the commit landed.
Nothing of theirs was touched in either direction; this is a note about the shared tree, not a
complaint. Once committed, the hazard is gone: a restore now restores my version.

### `gofmt`, read as instructed

`gofmt -l` in the working tree lists `cmd/indexer/main.go` and `internal/store/derive.go`. `gofmt
-d` on them shows `@@ -1,2262 +1,2262 @@` with **every line** prefixed `-` and terminated `^M`:
it wants to rewrite the whole file from CRLF to LF, the artefact wave 11 documented (the worktree
copy is CRLF because git checked it out that way under `core.autocrlf=true`). It is not a
formatting fault, and normalising it would produce a whole-file diff on Codex-approved ground.

**The definitive check: every `.go` file in the `48b9bcb` export, copied through `tr -d '\r'` and
run through `gofmt -l`, produces empty output** — 56 of 56 files. (The raw export lists all 56,
because `git archive` applies the eol attribute: same artefact, whole-repo scale.)

---

## Unverified / residual — stated honestly

1. **`no_progress` still compares the DAEMON clock to DATABASE timestamps, and it is the same
   defect class this wave just closed one instance of.** `applyProgressConditions` computes
   `now.Sub(p.UpdatedAt) > noProgressBound` where `now` is the daemon's wall clock and
   `UpdatedAt` is written by Postgres. A rollback shortens `since` and can suppress a genuine
   stall — a false green by the same mechanism, on a different gate. **Not fixed, deliberately:**
   round 10 cited only the staleness lines, the brief scopes K2 to the header-age verdict, and the
   fix would need the verdict clock threaded through a function with ~40 test call sites that do
   not currently supply one. Expanding there unreviewed seemed worse than naming it. **Nominated
   for a round-11 ruling**; if accepted it is a mechanical follow-up, and the `verdictClock` type
   it needs already exists.
2. **The per-chain retry cooldown moved to the scheduling clock, and no test distinguishes that
   from the old behaviour.** It is the right domain (a cooldown is scheduling, and a wall-clock
   rollback would otherwise extend one indefinitely), and it is exercised by every existing
   cooldown test — but those drive both clocks from one fake, so a mutation swapping it back would
   survive. I did not add a test because the failure it prevents is a scheduling delay, not a
   false verdict. Stated rather than left to be discovered.
3. **The ⌈W/R⌉ recovery bound is measured at one point on the latency axis (4 s).** R is derived,
   not asserted across latencies; a 9 s endpoint gives R = 2 and a longer rotation. The formula is
   in the comment and the mechanism is mutation-covered, but only one point is measured — which is
   the same criticism this wave exists to answer, so it is said out loud rather than implied.
4. **Budget overshoot is real and admitted:** admission is decided before a read whose duration is
   unknown, so a window can carry just under `2 × headerFetchTimeout`. Bounding it exactly would
   need a predicted read duration, which is a constant nobody can derive, so none is invented.
5. **`store.Now` cannot be proven to be Postgres's clock rather than Go's by a test on one host** —
   the two agree. M10 proves the live test pins the *value* (a one-hour offset is caught); it does
   not prove provenance. The statement is one line and reviewable by eye.
6. **The new cost harness models 9 workers on ONE chain**, which is the configured Ethereum
   fan-out; wave 11's 13-worker/2-chain shape is unchanged and still passing. Neither number is
   presented as universal, and both now name their axes.
7. **`internal/snapshot`, `internal/prices/**`, `roadmap/**` and `.env.example` were not opened.**
8. **No pre-commit gate blocked anything.** Doctor and scope-gate ran on both commits and reported
   `0 error(s), 0 warning(s)`; nothing was bypassed.
