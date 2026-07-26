# Task 8 — wave 15 report: Codex round-11 fixes (HEALTH unit)

**Unit:** `7b8c9fa` (all three fixes) → `868c84f` (three gaps the mutation loop found) →
`9552a93` (a live test that was itself wired to the wall clock).
**Declared base:** `a3f2223`. **Actual parent:** `da11403` — the parallel prices wave 14
landed four commits mid-wave; both baselines are measured below and neither is inferred.
**Returns to Codex for round 12 under D-006, reviewed on its own.**

All three findings closed. **16 mutations, 19 runs, all 16 killed by assertion, zero weak
kills** — and the loop found three real gaps, one of which was a test that could not see the
bug it was written for.

---

## READ THIS FIRST — five things round 12 should judge deliberately

### 1. The [high] fix is a THREE-line rule, and the obvious version of it re-breaks the thing it fixes

Codex offered two remedies: expire inactive askers via request epochs, **or** remove pending
membership when another path satisfies a scope. I shipped the first, because the second is a
strict subset: any scope satisfied by another arm stops calling `admitRefresh`, so an expiry
rule already covers it — and the expiry also covers the cases the second does not (the worker
was removed from the deployment, the chain was reconfigured, the process is shutting a stream
down). One mechanism, one invariant, rather than two rules that must agree.

**The part worth reviewing is not the expiry — it is what the expiry does NOT clear.** The
tempting rule drops the stale scope from both `asked` and `served`. That version passed every
test I had written for the finding and then failed the nine-worker cost harness three files
away, reporting worker 6 at **zero** refreshes over five minutes. The reason is worth stating
because it is not obvious:

> Being served is exactly what makes a scope go quiet. A refreshed anchor is reusable for a
> whole window, so *inactive* is the normal state of a scope that has just had its turn —
> which means forgiving its turn while it is quiet hands it a fresh turn every single window,
> and the queue behind it never advances.

So the rule is asymmetric: going quiet costs a scope its **veto**, never its **place**.
`delete(asked, s)` and no `delete(served, s)`. That asymmetry is M2, and after §Gaps below it
is killed by a test written specifically for it.

### 2. The liveness rule counts ROUNDS, not time — and that is a direct answer to M15

Wave 13's mutation loop found that windowing the refresh budget on the wrong clock froze it
silently the moment that clock stopped. The obvious implementation of "expire inactive askers"
is a timestamp, and a timestamp would make **liveness itself** depend on a clock: the same
stopped-clock failure would freeze the expiry and restore the deadlock in full, invisibly.
The expiry is therefore keyed on a pass counter, which no clock can stop, and
`TestTheRotationLivenessRuleDoesNotDependOnEitherCLOCK` freezes both clocks and asserts the
rotation still comes unstuck.

### 3. The two [medium]s are ONE fix, and it revises a claim wave 13 made

Wave 13 said "read ONCE per pass so that every worker in a round is judged against one
instant". The second [medium] is precisely that sentence being wrong. The corrected form is
now stated in the code:

> **One time AUTHORITY per pass. Not one instant.** The authority is read once; the INSTANT is
> taken afresh at each comparison, by carrying the reading forward with monotonic elapsed time.

Reading the authority once is what the first [medium] needs (one clock for cursor recency,
sweep progress and header age alike). Taking the instant late is what the second needs. They
are the same object — `passClock` — and separating them would have meant either two clock
reads per round or a frozen number, which are the two things being avoided.

### 4. A key an operator greps for CHANGED, and a wave-13 test changed with it

When only the freshness gate read the trusted clock, failing to read it was
`staleness_unmeasured`. The clock is now the authority for the whole pass, so the failure is
the **pass's**, and it is reported once per worker as `progress_unmeasured` — which is already
this pass's key for "a durable read failed, so neither the stall nor the freshness could be
judged", and is already how the ingest-read failure is encoded. Two keys for one cause would
say the same thing twice.

`TestNoTrustedClockIsUnmeasuredNeverGreen` (wave 13, Codex-reviewed) was edited to assert the
new key, and gained an assertion that the old key is **not** also written. I am flagging this
rather than burying it: it is the one place this wave changed the meaning of an existing
surface rather than adding to it. The blast radius is bounded — both keys are recoverable reds
that fail readiness identically — and the encoding is now consistent with the precedent
already in the file.

**Also changed by this:** a round with no trusted clock now stops **at** the clock and pays for
no durable reads and no header reads at all. Previously the cursor listings happened first and
still produced real `no_progress` verdicts. They cannot any more, and should not: without a
trusted clock there is no honest `since` to compute.

### 5. `internal/store/derive.go` was NOT modified — no 8th modification

`Store.Now` already existed from wave 13 and satisfies everything this wave needed. The unit is
**8 files, all under `cmd/indexer/**`**, and `git diff --name-only` outside that directory is
empty. `internal/prices/**`, `internal/store/**`, `roadmap/**` and `internal/snapshot` were
never opened.

---

## K1 [high] — the rotation deadlock, and its liveness invariant

### The defect, restated in the code's own terms

`admitRefresh` recorded every asking scope in `refreshAsked` and rebuilt that map **only when a
rotation completed**. A scope recorded while the budget was exhausted is recorded and not
served. If it then stops asking — because it caught up and the exact/memo/near-head arm answers
it first, or because its worker left the deployment — the completion check finds it unserved
forever, no rotation can ever complete, and **every other scope on the chain is refused for the
life of the process**. Not degraded: stopped. The chain never re-anchors again, catch-up never
finishes, and every gated worker on it rides a stale anchor and reads red until a restart.

Wave 13's comment claimed `asked` "is rebuilt every rotation, so a scope that stops asking
simply drops out and blocks nobody". The claim was true of the rebuild and false of the
reachability: the rebuild is *inside* the branch the stopped scope prevents.

### The change

`refreshAsked` becomes `map[scope]roundNumber`. A scope is **active** iff its most recent
request is the current round or the one immediately before it; inactive scopes are dropped from
`asked` (and only from `asked`). `stalenessRound` carries a `seq` assigned by a new
`stalenessJudge.newRound()`, and `measure` passes `r.seq` to `admitRefresh`.

**`at+1 < round`, not `at < round`,** because within a round the scopes judged *after* the
current one have not asked yet this pass — their most recent request is the previous round's,
and they are exactly the scopes that must still count as waiting. One round of slack, no more.

### The liveness invariant, as stated on `admitRefresh`

> A scope blocks the rotation only while it is ACTIVE: only if it asked in the CURRENT round or
> the one immediately before it.

Every scope that still wants a refresh asks exactly once per round — that is what this arm *is*
— so an active scope is provably still waiting, and a scope that stops asking leaves the
blocking set within one round. **The rotation therefore always completes**, and completes within
⌈W/R⌉ windows where W counts the scopes *currently* asking rather than the scopes that ever
asked. `headerRestampThrottle`'s bound 2 is amended to say so; counting scopes that merely asked
once makes W unbounded and, worse, admits W never being satisfiable at all.

### The mechanism's full history, encoded where the next reviewer will read it

| design | outcome | why |
|---|---|---|
| naive budget | **STARVED** | first-judged workers win every window; last-judged never re-anchored |
| due queue | **DEADLOCK** (rejected before shipping) | a queue has a head, and a stalled scope is a head that never asks again |
| bare asked-set | **DEADLOCK** (shipped; this finding) | membership with no expiry is indistinguishable from a queue head |
| round-stamped asked-set | — | membership expires; `served` does not |

### The measurement, and the counterfactual

`TestCatchUpThroughTheNearHeadArmDoesNotWedgeTheChain` builds the finding's own scenario end to
end through `applyProgressConditions`: four workers on one chain, five-second reads (two of
which exhaust the ten-second allowance), a `head` worker judged third so the chain's retained
stamp is fresh when the fourth is judged, and a `catchup` worker that is refused by the budget,
then reaches the head and is thereafter answered by the **near-head arm** — exactly the exit
Codex names — without ever having been served.

| six windows after the catch-up | `eth:slow-a` refreshes | `eth:slow-c` refreshes |
|---|---|---|
| **shipped rule (measured, by reverting the expiry)** | **0** | **0** |
| this code | 5 | 5 |

Zero is the finding. The chain simply stops reading headers.

**Why the arrangement is what it is** (every part is load-bearing, and it is stated in the test):
the near-head arm is *chain-wide*, so the only way to have one worker answered by it while others
are not is by block height — `head` sits above the backfillers and below `catchup`, so its fresh
stamp answers `catchup` (reuse is upward-only) and cannot answer the two below it.

### Budget-one, and why it is driven at the unit level

One refresh per window requires a single read to spend `headerFetchTimeout` — and a read that
takes the whole timeout is a read that *timed out*, which is a failure governed by the retry
cooldown, a different mechanism. Budget-one is therefore only reachable by charging it, which is
what `rotationHarness` does; the integration test above pays the extra workers needed to make a
physically possible latency bind. That reasoning is in the harness's own comment.

### Citing tests

| property | test |
|---|---|
| no scope repeats while another is still asking (budget-one, strict alternation) | `TestTheRefreshRotationRotatesStrictlyBetweenCallers` |
| a scope that STOPS asking blocks nobody — the finding, at budget-one | `TestTheRefreshRotationDoesNotDeadlockOnAStoppedCaller` |
| …and going quiet costs its VETO, not its PLACE | `TestTheRefreshRotationDoesNotForgiveTheTurnOfAQuietScope` |
| the catch-up transition satisfied through the NEAR-HEAD arm, through the real pass | `TestCatchUpThroughTheNearHeadArmDoesNotWedgeTheChain` |
| liveness survives BOTH clocks being frozen (the M15 lesson, pre-empted) | `TestTheRotationLivenessRuleDoesNotDependOnEitherCLOCK` |
| W=1 still refreshes every window — the mechanism costs the ordinary deployment nothing | `TestASingleDeepStaleWorkerIsRefreshedEveryWindow` |
| fairness across nine workers is unchanged | `TestSlowSuccessfulReadsStayBoundedAndStillRecover` (wave 13, passing unmodified) |

---

## K2 [medium] — the database clock, through the WHOLE pass

### The change

`applyProgressConditions` no longer takes a `now time.Time`. It takes a `timeAuthority`
(`{verdict, sched}`), reads it once at the top of the pass, and every comparison the pass makes
is measured against the resulting `passClock`:

- **cursor recency** (`check`, both listings) — `now.Sub(p.UpdatedAt) > noProgressBound`;
- **sweep progress** — the open-generation stall, and the reported ages of the last and oldest
  successful sweeps;
- **header age** — via `applyStalenessConditions`, which no longer sources its own clock.

`stalenessJudge` **loses its `clock` field entirely**. That is the structural point rather than
tidiness: a judge that holds no verdict clock cannot acquire a second authority, and the pass is
now the only thing that can date anything. `newStalenessJudge(fetch, sched)` is two arguments.

**Cost is unchanged**: one `SELECT now()` per daemon round, as before — it simply moved up one
level so both gates share it.

### Why `progress_unmeasured` and not two keys

Stated in §4 above; the code says it at `applyClockUnmeasured`, and
`TestNoTrustedClockIsUnmeasuredNeverGreen` asserts both halves (the key that is written, and the
key that is not).

### The material case, and that it is the SILENT one

A snapshotter whose endpoints are all stale refuses every batch and **returns no error**. No
step failure, no advancing cursor, nothing — the only evidence is an open sweep generation that
has stopped landing batches, and its `collateral_unusable` sibling fires on a much wider
cadence-relative bound. For the whole width of that gap this check is the only signal there is,
and a rolled-back wall clock removed it. That is why the sweep gets its own rollback test rather
than a line in the cursor one.

### Citing tests

| property | test |
|---|---|
| a 10-minute rollback cannot suppress a 20-minute cursor stall (crosses the 15 m bound) | `TestAClockRollbackCannotSuppressAStall` |
| — and the COUNTERFACTUAL: the same rows on the wall clock read GREEN | same test |
| — and the reported figure is 20m, not 10m: the surface does not under-state by the rollback | same test |
| the same, for an OPEN sweep generation | `TestAClockRollbackCannotSuppressASweepStall` (+ counterfactual) |
| no trusted clock ⇒ `progress_unmeasured`, never green, never a fabricated red, no reads paid | `TestNoTrustedClockIsUnmeasuredNeverGreen` |
| — and it covers EVERY worker the pass touched, asserted structurally | `TestNoTrustedClockLeavesNoWatchedWorkerSilent` |
| the real `store.Now` is the authority for the real sweep verdict, through real Postgres | `TestTheSnapshotterQuietStaleRefusal…` (live, rewired in `9552a93`) |
| the real `store.Now` is the authority for the real freshness verdict (+ live counterfactual) | `TestTheFreshnessVerdictIsMeasuredAgainstTheREALDatabaseClock` (live) |

---

## K3 [medium] — one authority is not one instant

### The change

`passClock` holds the trusted reading `at`, a **monotonic anchor taken before the read was
issued**, and the scheduling clock. `now()` is `at + (sched() - anchor)`.

**The anchor is taken BEFORE the trusted read, and that is the finding's "DB round-trip adds
bias" clause answered directly.** The instant is captured on the server, somewhere inside a trip
this process cannot see into. Anchoring *after* the call returns credits the whole trip to
neither clock and makes `now()` run **behind** the database — every age short, verdicts green,
and worse the slower the database. Anchoring first makes it run **ahead** by at most the round
trip: ages long, fail-closed, bounded by a number that is milliseconds against a local server.

Each comparison then calls `now()` **as late as it can**:

- `judge` reads it once at entry (for the reuse/skew arms inside `measure`, where an *earlier*
  instant is the conservative direction on both) and **again after `measure` returns** — and it
  is that second reading the verdict is made from, because a header fetch is allowed
  `headerFetchTimeout` and charging that latency to neither clock is the defect one level down;
- `check` reads it after the durable listing that produced the rows;
- `applySweepProgressCondition` reads it after the sweep query.

### The magnitude, from the harness the previous wave shipped

`TestSlowSuccessfulReadsStayBoundedAndStillRecover` already asserts that its first pass takes
`9 × 4 s = 36 s` — nine sequential reads inside the 10 s per-read timeout, on an endpoint that
never fails. Every verdict in that pass was dated from the instant it opened. **The last worker
judged was under-aged by up to 36 s at a ten-minute boundary**, which is the figure the finding
cites and which is an assertion already in the repository rather than an estimate of mine.

### The boundary measurement, in BOTH directions

`TestTheTrustedInstantAdvancesThroughASlowPass`, one worker, one 5 s read:

| cursor's header age at pass start | age at publication | shipped code | this code |
|---|---|---|---|
| 9m59s (1 s inside) | 10m04s | **GREEN** | RED, reported as `10m4s` |
| 9m54s (6 s inside) | 9m59s | GREEN | GREEN |
| 9m59s, no slow read at all — only a 3 s clock round trip | 10m02s | **GREEN** | RED, reported as `10m2s` |

**The second row is worth as much as the first.** A fix that simply widened the bound, or that
advanced the instant by more than elapsed time, would redden a demonstrably fresh cursor. It is
green under both the shipped code and this one, and it was measured, not assumed — the
counterfactual run reports it PASSING against the frozen-instant revert while the other two fail.

The same measurement on the two durable gates:

| gate | stall at pass start | elapsed before the verdict | shipped | this code |
|---|---|---|---|---|
| cursor `no_progress` (15 m bound) | 14m00s | 90 s listing | GREEN | RED, `15m30s` |
| sweep `no_progress` (15 m bound) | 14m00s | 90 s of durable reads | GREEN | RED, `15m30s` |

The sweep is judged **last** in the pass, so it carries the most elapsed time and has the least
margin for the error — which is why it gets its own measurement.

### Citing tests

| property | test |
|---|---|
| the trusted instant advances with monotonic elapsed time, at the boundary, both directions | `TestTheTrustedInstantAdvancesThroughASlowPass` (3 subtests) |
| the clock read's OWN round trip is charged to the caller (anchor before the read) | same, subtest 3 |
| a slow durable listing is charged to the cursors it dates | `TestASlowDurableReadIsChargedToTheCursorsItDates` |
| a slow pass is charged to the sweep it dates | `TestASlowPassIsChargedToTheSweepItDates` |
| the freshness verdict is aged AFTER the header read, not before it | `TestTheTrustedInstantAdvancesThroughASlowPass` (M14) |

---

## Mutation results — 16 mutations, 35 runs over four passes, all 16 killed by ASSERTION

35 runs because the loop was run in full twice — once to find the gaps and once at the final
commit state to prove nothing regressed — with M10, then M2 and M3, re-run individually in
between as each gap was closed. **The final full pass is the one the table reports.** Files are
restored from an in-memory byte-exact backup; **`git checkout --` is never used**, because a
stray checkout in this shared tree would destroy the parallel implementer's uncommitted work —
which is what happened to *me* in wave 13, from the other direction. The harness also asserts
each mutation is **on disk** before running anything, because `main.go` is CRLF and a pattern
written with bare `\n` matches nothing silently; a "survivor" recorded that way is a mutation
that was never made.

| # | Property validated | Verdict | Killed by |
|---|---|---|---|
| M1 | inactive askers expire AT ALL (i.e. the shipped bare asked-set) | KILLED | `…DoesNotDeadlockOnAStoppedCaller`, `…CatchUpThroughTheNearHeadArm…`, `…DoesNotForgiveTheTurn…`, `…DoesNotDependOnEitherCLOCK` |
| M2 | expiry costs a scope its VETO, not its PLACE | KILLED¹ | `…DoesNotForgiveTheTurnOfAQuietScope`, `TestSlowSuccessfulReads…` |
| M3 | the expiry gives ONE round of slack | KILLED | `…RotatesStrictlyBetweenCallers`, `…DoesNotForgiveTheTurn…`, `TestSlowSuccessfulReads…` |
| M4 | the round number actually REACHES `admitRefresh` from the pass | KILLED | `…CatchUpThroughTheNearHeadArm…` |
| M5 | the round counter ADVANCES (epochs are not all one epoch) | KILLED | `…CatchUpThroughTheNearHeadArm…` |
| M6 | the rotation still REFUSES a repeat while another scope waits | KILLED | 3 tests |
| M7 | CURSOR recency is measured on the DATABASE clock | KILLED | `…CannotSuppressAStall` + 12 others |
| M8 | SWEEP progress is measured on the DATABASE clock | KILLED | `…CannotSuppressASweepStall`, `…ChargedToTheSweep…`, 2 others |
| M9 | no trusted clock ⇒ UNMEASURED, never a wall-clock fallback | KILLED | both `…NoTrustedClock…` tests |
| M10 | a no-clock round names EVERY watched worker | KILLED² | `…LeavesNoWatchedWorkerSilent` |
| M11 | a no-clock round REPORTS and does not fabricate a red | KILLED | both `…NoTrustedClock…` tests |
| M12 | the trusted instant ADVANCES with monotonic elapsed time | KILLED | 3 tests |
| M13 | the monotonic anchor is taken BEFORE the trusted read | KILLED | `…AdvancesThroughASlowPass/…round_trip…` |
| M14 | the freshness verdict is aged AFTER the header read | KILLED | `…AdvancesThroughASlowPass` (2 subtests) |
| M15 | CURSOR ages are taken after the listing that produced them | KILLED | `…ChargedToTheCursorsItDates` |
| M16 | SWEEP ages are taken after the read that produced them | KILLED | `…ChargedToTheSweepItDates` |

¹ ² see the gaps below. **No mutation was killed by the compiler**; every kill is an assertion
failure.

### The three gaps the loop found (commit `868c84f`)

**(a) M10 SURVIVED — and it exposed a test written against a roster instead of an invariant.**
Deleting the `runners` leg of `applyClockUnmeasured` outright moved no assertion, because the
daemon happens to register every derivation runner as a *consumer* as well. The loop is not
redundant: the pass `touch`es runners **unconditionally**, and publication REPLACES a touched
worker's entries — so a watch containing a runner that is not also a consumer loses that
runner's standing reds to a silent replace, which is the one-round false-green pulse controller
ruling OQ1 was reversed to prevent, re-entering through a different door. The test now asserts
the invariant *structurally* — walk the round's own composition, require nothing registered to
be empty — so it holds for watch shapes the current wiring does not build.

**(b) M2 was killed only by the nine-worker cost harness, not by the test written for it.** My
quiet-scope test had the quiet scope go quiet *forever*, and a scope that never returns never
spends the turn it was wrongly forgiven. It now returns — which is what real scopes do every
window — and the difference is observable where it belongs. Recorded because "the test for the
property did not test the property" is exactly the class of thing this loop exists to catch, and
the mutation caught it in my own new code.

**(c) A LIVE test was itself wired to the wall clock** (commit `9552a93`, found by reading rather
than by mutation). `TestTheSnapshotterQuietStaleRefusal…` handed `applyProgressConditions` a
`time.Now` while every timestamp its verdict reads was written by the Postgres it was talking to
— the finding's exact substitution, sitting in a live test where it also served as a worked
example of the wrong wiring. It now uses the daemon's real pairing. The only remaining
wall-clock authority in that file is the deliberate counterfactual.

---

## Verification

**Baseline at the declared base `a3f2223`: 561 top-level PASS / 655 including subtests / 0 FAIL / 0 SKIP.**
**Baseline at the actual parent `da11403`: 563 / 657 / 0 / 0.** (Prices wave 14 landed
mid-wave and contributed +2/+2; measuring both is why the delta below is attributable.)
**This unit at `9552a93`: 575 / 672 / 0 FAIL / 0 SKIP.**

**+12 top-level, +15 including subtests** — 12 new tests and 3 new subtests, **nothing deleted**.
The 12 were confirmed by diffing the two runs' PASS lists, not by arithmetic; the reverse diff
(tests present at the parent and absent here) is **empty**.

**Counting convention** (wave 11's, unchanged): top-level = `grep -c '^--- PASS'`; including
subtests = `grep -cE '^\s*--- PASS|^--- PASS'`. FAIL and SKIP counted the same way.

```
go build ./...   OK
go vet ./...     OK
gofmt            see below — READ, and it is the CRLF artefact
go test ./... -count=1 -v      0 FAIL / 0 SKIP
-race, golang:1.24 via host.docker.internal   all 9 packages ok, 0 data races (at 9552a93)
control-plane doctor + scope-gate on all three commits: OK -- 0 error(s), 0 warning(s)
```

The refresh rotation adds cross-round mutable state (`stalenessJudge.round`, and `refreshAsked`
changing value type), which is why the race run is worth more than usual this wave: the judge is
single-threaded by construction — the health pass is sequential inside the daemon's inner loop —
and `-race` is the check that this remained true rather than a claim that it did.

### Measured in isolation, and why

The working tree is shared with the parallel prices wave, which committed **four times** during
this wave (`e06f40f`, `82dc7ec`, `b8e57fa`, `da11403`). Every number above therefore comes from
**`git archive` exports** of the relevant commits into scratch directories (read-only; no
worktree created or removed) against **dedicated databases** (`solvent_w15base`,
`solvent_w15par`, `solvent_w15u2`, `solvent_w15fin`, `solvent_w15race`, and `solvent_w15mut` for
the mutation loop) on the same `solvent-db-1` instance, so the other wave's schema was neither
read nor written. Nothing was counted in the dirty tree.

**All staging was by explicit pathspec; `git add -A` was never used.** The scope gate reported
8, 3 and 1 paths on the three commits, matching exactly what was intended.

### `gofmt`, read as instructed

`gofmt -l` in the working tree lists `cmd/indexer/main.go` alongside the sibling wave's files.
`gofmt -d` on it shows `@@ -1,2493 +1,2493 @@` with **every line** prefixed `-` and terminated
`^M`: it wants to rewrite the whole file from CRLF to LF — the artefact wave 11 documented (the
worktree copy is CRLF because git checked it out that way under `core.autocrlf=true`). It is not
a formatting fault, and normalising it would produce a whole-file diff on Codex-approved ground.

**The definitive check: all 58 `.go` files in the `9552a93` export, copied through `tr -d '\r'`
and run through `gofmt -l`, produce empty output.** (58 rather than wave 13's 56: this unit adds
`refresh_rotation_test.go` and `pass_clock_test.go`.)

---

## Unverified / residual — stated honestly

1. **`passClock.now()` runs AHEAD of the database by up to one clock round trip, always.** This
   is deliberate and fail-closed (ages long, never short), and it is the direct consequence of
   anchoring before the read; but it *is* a systematic bias, not zero. It is milliseconds against
   a local server and grows with database latency — in the same direction as the risk, which is
   why it is the right sign, but no test bounds it numerically because the bound is
   deployment-specific.
2. **Within a pass, the monotonic clock and the database clock can genuinely diverge** (a real
   NTP step on the database server mid-pass). The error is bounded by the pass's own duration
   because every pass re-reads the authority; nothing accumulates across passes. Not measured —
   modelling a database whose clock steps *during* a single pass would be a test about the
   fake, not about this code.
3. **The rotation's liveness horizon is one round, and a scope that asks only every OTHER round
   would expire and re-enter each time.** It cannot starve anyone — `served` persistence is
   exactly what stops a re-entering scope jumping the queue, which is §1's asymmetry doing its
   second job — but the analysis is by argument, not by test. I could not construct a realistic
   worker that oscillates that way; the deep-stale arm is entered on a condition that does not
   flicker round to round.
4. **A round in which the durable listing fails means no scope asks, and after two such rounds
   every asker has aged out.** The rotation then restarts from empty when reads recover, which
   costs at most one rotation of fairness during an outage in which no verdicts are being made
   anyway. Named rather than tested.
5. **`served` retains permanently-retired scopes until the next rotation completes.** Bounded (it
   is cleared wholesale on completion) and harmless (completion inspects only `asked`), but it is
   a map that is not pruned on the same schedule as its partner, which is the sort of asymmetry
   worth a second pair of eyes.
6. **The runner-that-is-not-a-consumer shape in `…LeavesNoWatchedWorkerSilent` is one the current
   daemon wiring does not build.** The type permits it and the `touch` loop already covers it, so
   the leg it exercises is defence against a future wiring change rather than a live bug. The
   assertion itself is written against the invariant and holds for the daemon's actual shape too.
7. **The ⌈W/R⌉ recovery bound is still measured at one point on the latency axis** (5 s here,
   4 s in wave 13's harness). Carried forward from wave 13's residual #3, unchanged.
8. **Budget overshoot is still real and still admitted:** admission is decided before a read whose
   duration is unknown, so a window can carry just under `2 × headerFetchTimeout`. Unchanged.
9. **`store.Now` still cannot be proven to be Postgres's clock rather than Go's by a test on one
   host** — the two agree. Carried forward from wave 13's residual #5, unchanged.
10. **No pre-commit gate blocked anything.** Doctor and scope-gate ran on all three commits and
    reported `0 error(s), 0 warning(s)`; nothing was bypassed.
