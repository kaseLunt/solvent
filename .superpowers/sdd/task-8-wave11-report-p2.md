# Task 8 — wave 11 report: Codex round-9 fixes (HEALTH unit)

**Unit:** `c146853` (fixes) → `827a9e6` (the three gaps the mutation loop found).
**Base:** `cb3a955`. **Returns to Codex for round 10 under D-006, reviewed on its own.**

All four round-9 findings closed. **19 mutations run, 19 killed by assertions** — three of
them only after the loop found real holes and new tests were written for them.

---

## READ THIS FIRST — four things round 10 should judge deliberately

### 1. The [high] fix changed a property wave 9 had asserted, and the old assertion was amended rather than worked around

`TestWalkerStalenessFiresWhileTheWalkerIsAdvancing` asserted "caught up in TIME ⇒ it clears,
this round". With bounded reuse it clears **at the next exact refresh** — up to one
`headerRestampThrottle` (30 s) later. That is not incidental; it is the price of the thing
Codex asked for. Reuse can only OVER-estimate age, so the error is always "a worker that has
just caught up stays red a little longer", never the reverse, and it is bounded because reuse
never renews the reuse window. The test now asserts **both halves** (still red inside the
window, clear after the refresh) and names the trade, and
`TestDeepStaleReuseCanOnlyOverstateAgeAndIsCorrectedWithinOneWindow` pins the bound
independently.

### 2. The deep-stale anchor is keyed per WORKER, not per chain — a defect the first implementation had

The obvious implementation reads the existing chain-keyed stamp. It is wrong, and the wrongness
is not hypothetical: a chain routinely carries a caught-up worker and a backfilling one at once
(a newly-added stream, a post-rewind re-derive). If the backfiller's three-day-old anchor could
answer for the caught-up worker, the gate would report a **demonstrably fresh worker as stale**.
Fail-closed, and wrong — a gate that names the wrong worker is one an operator learns to
distrust. `stalenessJudge.backfill` is therefore worker-keyed, `TestOneWorkersBackfillAnchorNeverDatesAnotherWorkersCursor`
pins it, and mutation **M6** (revert to the chain key) is killed. The chain-keyed stamp still
serves the exact-block hit and the near-head throttle, where sharing across workers *is* correct
because the approximation there is small by construction.

### 3. `internal/store/derive.go` modified for the 6th time (flagged, as instructed) — all additive

- **One column added to two existing statements.** `CompleteSweepGeneration`'s guarded UPDATE
  gains `last_pass_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - opened_at))::bigint)` in its
  SET list — same WHERE, same guard, same return values. `SweepProgress`'s generation SELECT gains
  the column to its projection and one `switch` arm to its assignment; every other query in that
  function is byte-identical.
- **One new method**, `SweepLastPassDuration` — a single-row read, additive, used only by startup
  hydration.
- **Two comments** on `OpenSweepGeneration` and `RewindDerived`'s bump stating that the column's
  ABSENCE from those statements is load-bearing. No statement in either was changed.

### 4. Two changes outside the brief's listed touch set, both forced by the migration

- **`internal/store/migrate_upgrade_test.go`** — `currentSchemaVersion` 7 → 8, one line. That file's
  own comment says bumping it "is part of adding a migration"; without it the suite fails. It is
  disjoint from `internal/store/prices*.go`.
- **`internal/store/derive_collateral_test.go`** — `TestSweepProgressReportsAchievedPassDuration`'s
  final leg asserted **the defect** ("reopening leaves no completed pass on the row: the daemon
  must retain the value"). H2 makes that false by design, so the leg now asserts the durable value
  survives the reopen. This is unavoidable, not opportunistic: the test was the licence the defect
  was shipped under.

Both were staged by explicit pathspec. `internal/prices/**` and `internal/store/prices*.go` were
never opened.

---

## H1 [high] — the throttle must survive a real historical backfill

### The change

`measure` gains a second reuse arm. The two are disjoint by design and the gap between them is
deliberate:

| regime | condition | why |
|---|---|---|
| **near-head** (wave 9) | `s.block < block` ∧ inside the window ∧ `age ≤ bound/2` | the approximation is far from the line |
| *(neither)* | `bound/2 < age ≤ bound` | this band is where an estimate could FLIP a verdict, so it is paid for with an exact read |
| **deep-stale** (new) | `s.block < block` ∧ inside the window ∧ `age > bound` | the anchor is already past the bound and reuse only over-estimates, so this arm is **green-proof by construction** |

Codex's diagnosis is exactly right and worth restating: the near-head arm is *arithmetically
unreachable* during a genuine backfill. A cursor three days behind head cannot imply an age
inside five minutes, so `age ≤ bound/2` failed on **every** round for **every** gated worker.

**The two bounds, both stated in `headerRestampThrottle`'s comment as required:**

1. **TIME — the 30 s reuse window, which is therefore the periodic exact-refresh cadence.** A stamp
   is reusable only for 30 s after *the fetch that produced it*, so every window each chain pays at
   least one real header read that re-anchors the measurement, and a worker that has caught up is
   re-measured inside it. **Justified from the fetch budget:** the pass already accepts one attempt
   per chain per `headerFetchCooldown` (also 30 s) on its FAILURE path, each costing up to
   `headerFetchTimeout` (10 s). A success-path read is a single `eth_getBlockByNumber` and costs far
   less, so the same cadence sits strictly inside a budget already justified. Loosening it only
   delays catch-up detection; tightening it buys nothing, because a deep-stale worker's verdict is
   red either way.
2. **ROUNDS AND BLOCKS — bounded BY (1), not by a second constant, and that is a deliberate
   refusal.** A reuse never renews the window (`fetchedAt` is written only by a real fetch), so no
   number of reuses, rounds or blocks extends an anchor's life past one window. A separate
   block-span cap would have to convert blocks into elapsed time — precisely the nominal-cadence
   conversion wave 9 deleted from this gate — and there is no constant for it anyone could derive,
   so none is invented. What the window guarantees is unit-free instead: at most 30 s worth of
   rounds, and at most whatever block distance a worker can cover in 30 s.

### The harness, rebuilt on OLD cursor timestamps — and it is now a SHIPPED test

Wave 9's cost figures modelled fresh advancing cursors and lived in a throwaway harness
(its own residual #2). `TestStalenessPassCostOnAGenuineHistoricalBackfillAndADeadChain` replaces
both problems: cursors **72 hours** behind head, in the real deployment's shape —
`config/contracts.json`'s 10 streams over 2 chains (9 on ETH, 1 on OP) plus 2 derivation runners
and 1 feed deriver as raw-log consumers = **13 gated workers**, judged in the order the daemon
judges them (config order, *not* a convenient ascending one) — with `require.Equal` on the counts.

**Every number states the scenario it models.**

| scenario modelled | reads / 20 rounds | per round |
|---|---|---|
| **(a) stale successful backfill**, cursors 72 h behind, advancing every round, hot loop @ 200 ms | **9** | 0.45 |
| (a) **same harness, deep-stale arm removed** (measured, mutation M1) | **180** | 9.00 |
| **(b) dead chain** — both chains failing, hot loop @ 200 ms | **2** | 0.10 |
| (b) dead chains with every round past the cooldown — the no-cooldown counterfactual | **40** | 2.00 |

Reading these:

- **The [high] is closed with a 20× reduction on the hard case**: 180 → 9 over the same 20 rounds.
  The 9 is one read per *distinct* `(chain, cursor block)` among the 13 workers, **once**, and
  nothing more until the window expires — sustained cost is bounded by the window, not the round.
- **9 rather than 13 is the configured deployment's floor, and the test says why**: the five aToken
  streams share a StartBlock, so they share a round-memo entry until their cursors diverge. Codex's
  "up to 13 sequential reads per hot round" is the worst case the same figure rises toward; neither
  number is quoted without its scenario.
- **The report inconsistency Codex named is corrected, with a measurement.** Wave 9 claimed the
  no-cooldown failure cost was 13 per round. It is not: the per-round down-set already collapses a
  round's failures to **one per CHAIN**. The measured counterfactual is **2.00 per round** (40 over
  20 rounds), and the harness's third leg exists solely to state that number honestly.

### Citing tests

| property | test |
|---|---|
| a deep-stale advancing cursor is answered from its anchor (101 hot rounds, 1 read) | `TestDeepStaleBackfillReusesTheAnchorInsteadOfRefetchingEveryRound` |
| the window is measured from the FETCH, not the last reuse (35 s past the fetch, 15 s past the reuse ⇒ refresh) | same test, refresh leg |
| reuse can only OVER-estimate; the error is corrected within one window | `TestDeepStaleReuseCanOnlyOverstateAgeAndIsCorrectedWithinOneWindow` |
| reuse is upward-only — a rewound cursor is measured on its own header, and the REASON carries the true age | `TestAReusedAnchorIsNeverConsultedForALowerBlock` |
| one worker's backfill anchor never dates another worker's cursor | `TestOneWorkersBackfillAnchorNeverDatesAnotherWorkersCursor` |
| the band between bound/2 and bound is always exact | `TestRestampThrottleReusesOnlyOlderStampsAndOnlyFarFromTheBound` (wave 9, still passing) |
| the cost, both scenarios | `TestStalenessPassCostOnAGenuineHistoricalBackfillAndADeadChain` |

---

## H2 [medium] — the adaptive bound must survive restart

### The change

**Migration `00008_sweep_pass_duration.sql`** (numbers `00001`–`00007` were taken at my HEAD and
re-checked immediately before each commit; the parallel prices wave's `00007` had already landed):
`sweep_generations.last_pass_seconds BIGINT`, backfilled from `completed_at - opened_at` **only
where the generation is currently CLOSED**.

- `CompleteSweepGeneration` stamps the duration **in the same guarded UPDATE that closes the
  generation**, so there is no window in which a generation is closed with its duration
  unrecorded, and a superseded completion (`stamped=false`) records nothing exactly as it stamps
  nothing.
- `OpenSweepGeneration` and `RewindDerived`'s bump **do not name the column**. That omission is the
  fix: clearing `completed_at` is what destroyed the achieved cadence before.
- `SweepProgress` reads the durable column and treats it as authoritative for OPEN and closed
  generations alike; the old `completed_at - opened_at` arithmetic survives only as a fallback for
  a row whose column is still NULL.
- **Hydration before the first verdict**: `collateralBoundState.hydrate` reads
  `Store.SweepLastPassDuration` at startup, before the daemon's first round. Without it the store
  fix is half a fix — the per-round read only feeds the NEXT round, so a restarted process would
  still spend round 1 on the naive bound. A failed hydration is a WARN, not a boot failure: the
  naive bound is the TIGHTER of the two (it errs red, never green) and the next round restores the
  durable value through `observe`.

**Why a column and not retained history:** `sweep_generations` is keyed on engine alone, so there
is no history to retain — each open overwrites the row in place. Widening the key to
`(engine, generation)` would turn a single-row lookup read every daemon round into a
scan-and-order over unbounded history and would need a retention policy nobody has derived.

**What the migration deliberately does NOT recover, stated because it is the honest half:** a
generation that is OPEN at upgrade time already lost its predecessor's duration before the
migration existed. Its column stays NULL, the reported duration stays zero, and the bound degrades
to exactly the naive formula the old code used — never worse than the behaviour replaced, and
correct from the first completion under the new code. Inventing a number there would look better
in the test and would be a fabricated cadence.

### Citing tests

| property | test |
|---|---|
| a restart mid-open-generation judges with the SAME bound its predecessor had, to the second | `TestCollateralBoundSurvivesARestartDuringAnOpenGeneration` (live; new `collateralBoundState` over a new `*store.Store`) |
| a REWIND does not un-happen a completed pass | `TestARewindDoesNotEraseTheAchievedPassDuration` (live) |
| an OPEN generation still reports the last COMPLETED pass, byte-identically | `TestSweepProgressReportsAchievedPassDuration` (amended — see §4 above) |
| the v7→v8 upgrade recovers what survived and invents nothing for what did not; and self-heals on the first completion | `TestMigrateUpgradesV7GenerationBaselineRecoveringOnlyWhatSurvived` |

The restart test asserts the negative too: a fresh `collateralBoundState` *before* hydration
carries the naive bound, and the widened bound is strictly greater — so the test cannot pass by
the two bounds coincidentally being equal.

---

## H3 [medium] — the skew check at every reuse, not just at fetch

### The change

The L2 predicate is factored into `beyondSkewTolerance` and evaluated at **every** point a header
timestamp enters a verdict: the fetch that produces it, the round memo, the retained chain stamp,
and the deep-stale backfill anchor. `rejectSkewedReuse` performs the read-out half — it **evicts**
the invalidated stamp (chain stamp, backfill anchor, and every round-memo entry derived from it),
puts the chain in the round's down set, and returns the failure the round reports as
`staleness_unmeasured`.

**Two decisions worth reviewing explicitly:**

- **It does not arm the per-chain fetch cooldown.** Nothing has been shown wrong with the ENDPOINT
  — this daemon's clock is what moved — and a 30 s cooldown here would extend the unmeasured window
  past the moment the clock is corrected. The next round re-fetches; if the clock is still rolled
  back, the fetch path's own L2 check arms the cooldown there, which is where endpoint-fault
  semantics belong. Pinned by assertion, and mutation **M17** (arm it) is killed.
- **Eviction is chain-wide over the round memo.** Conservative rather than precise: one extra
  fetch, in the fail-closed direction.

### Citing tests

| property | test |
|---|---|
| every reuse arm refuses an invalidated stamp, evicts it, emits `staleness_unmeasured`, and recovers on refetch | `TestEveryStampReuseIsRevalidatedAgainstTheCurrentClock` (3 subtests: exact-block, near-head throttle, deep-stale throttle) |
| **the arrangement only the backfill anchor's own check can catch** | `TestTheBackfillAnchorCarriesItsOwnSkewCheckForTheCaseTheChainStampCannotCover` |
| the round memo is revalidated, not trusted | `TestTheRoundMemoIsRevalidatedAgainstTheClockToo` |
| the fetch-path check is unchanged | `TestGrossFutureHeaderTimeIsUnmeasuredNotGreen` (wave 9, still passing) |

**Scope stated in the test rather than implied**, twice, because overclaiming coverage is the
failure mode this round is about:

- The guard is evaluated **once, before the arm is selected**, so all three arrangements execute
  the same comparison. They are all kept because the arrangements are what a future edit would
  break, by moving the check inside a case or duplicating it into two.
- The **round-memo** arm is unreachable through today's caller (`applyStalenessConditions` passes
  one `now` per round). It is still checked and still tested — `measure` takes `now` as a parameter,
  so a future caller with a per-worker clock would walk straight into the bypass just removed — and
  the test drives `measure` directly, using nothing but its own signature.
- The **deep-stale** arm is nearly immune to an NTP-scale rollback by construction: a three-day-old
  anchor cannot be made future by a ten-minute step. Its subtest uses a rollback larger than the
  anchor's age (a VM restored from an older snapshot), and that is said out loud.

### The sweep for other write-in/read-out asymmetries — and what it found

Every point in this unit where a value is validated on write and consumed later:

| validation | write-in | read-out | verdict |
|---|---|---|---|
| future-skew tolerance (L2) | fetch | **was missing** on 3 reuse paths | **the finding — fixed, all arms** |
| `secs > math.MaxInt64` representability | fetch | n/a | no gap — a retained `time.Time` cannot become unrepresentable |
| `stalenessAge` negative clamp | — | every use | symmetric |
| frontier `inputTime.After(now)` clamp | — | read-out | symmetric; the frontier measurement now goes through the same skew guard |
| collateral staleness bound > 0 | daemon startup refuses a non-positive bound | `SweepProgress` refuses one | **both sides** |
| `collateralBoundState.observe` rejects `d ≤ 0` | write-in | `bound()` handles zero | both sides |
| `last_success_at` strict-block-advance guard | `ApplySweepBatch` | NULL counts as STALE | both sides |
| `last_pass_seconds` (NEW) | `GREATEST(0, …)` at write | `*lastPassSeconds > 0` at read | **deliberately both** — the read does not trust the write |
| `publishRound` same-round guard | — | both directions | symmetric |
| retry cooldown deadline | armed at failure | compared against `now` at read | symmetric |

**One residual found and NOT fixed, stated rather than quietly left:** `p.OldestSuccessAt` and
`p.LastSuccessAt` are DATABASE-clock timestamps, and the condition's reason text renders their age
with `now.Sub(...)` on the DAEMON clock. If the daemon clock lags the database's, that age renders
short (or negative) in the message. It cannot affect a verdict — the staleness decision itself is
made in SQL on the database clock with strict `<` — so this is cosmetic, and it is outside the
finding's scope. Recorded here rather than fixed so round 10 can rule on it.

With that stated, **the class is closed for this unit's measurement paths**: the only map reads in
`cmd/indexer` that return a value into a verdict are the three stamp reads, and all three are now
guarded (`main.go:887`, `:893`, `:921`).

---

## H4 [medium] — the quiet-refusal test drives the real refusal

`TestQuietlyRefusedGenerationFailsReadinessThroughUsability` is **deleted**. Codex is right that it
asserted a composition the real store cannot reach: `ErrStaleSweepBatch` applies no status update,
so the account stays in `SweepWorkBatch`'s queue and the generation can never reach empty-batch
completion — the closed generation it hand-built cannot exist. A comment at its old site in
`health_test.go` records what it claimed, why that was impossible, and where the replacement lives,
so the deletion is not silently reversible.

**`TestQuietlyRefusedSweepFailsReadinessThroughARealStaleBatchRefusal`** (`health_live_test.go`)
drives it end to end against live Postgres:

1. the **real** `snapshot.Snapshotter` opens a generation and lands a successful sweep at execution
   block 500 — asserted from the durable row, not from the fake;
2. the next Step completes the generation (nothing lags);
3. both durable timestamps are aged three hours **together**, which is what really happens;
4. `TriggerResweep` opens the next generation, and the fake chain now answers at execution block
   **100** — semantic staleness, the `eth_call` succeeds, so the failover client's error-driven
   rotation never sees a problem;
5. `store.ApplySweepBatch` is called once directly and `require.ErrorIs(…, store.ErrStaleSweepBatch)`
   **pins that the refusal this scenario rests on is the typed one**, produced by the real store;
6. five rounds through the real `stepSnapshotter` return `(false, nil)` with `ss.lastErr == nil`
   and no `step_error` — and the multicall count is asserted to have risen, so the rounds were
   refused, not skipped;
7. **the state the fabricated test could not have**: the account is still `last_success_block = 500`
   and `SweepWorkBatch` still returns it. That is exactly the fact the old test had to contradict;
8. the verdict comes from the **real store** through the daemon's real pass: no `step_error`, no
   `no_progress`, no `snapshot_failures`, no `progress_unmeasured`, and `collateral_unusable`
   present and failing readiness.

**The only fake is the CHAIN**, as the brief permits — and what it is stubbed to do (an endpoint
serving an old execution block) is the production failure the guard exists for. Building it needed
the multicall3 / `collateralOf` ABIs in the test file; a drift between them and `internal/snapshot`'s
unexported copies is **loud, not silent** — the snapshotter would fail to decode the response and
`Step` would return an error every assertion would report.

**Isolation:** the three live tests in `cmd/indexer` migrate and operate inside a dedicated schema
(`indexer_health_live`), the convention `internal/derive`'s live suite already uses, because
`internal/store`'s suite TRUNCATEs the shared public-schema tables and `go test ./...` runs package
binaries concurrently.

---

## Mutation results — 19 run, 19 killed by assertions

Every kill is an assertion failure, not a build or vet error (the harness distinguishes the two and
reports them differently). Files are restored from an in-memory byte-exact backup; **`git checkout --`
is never used**, because a stray checkout in this shared tree would have destroyed the parallel
implementer's uncommitted work.

| # | Property validated | Verdict | Killed by |
|---|---|---|---|
| M1 | a genuine historical backfill must not pay one header read per gated worker per hot round | KILLED | `TestDeepStaleBackfill…`, `TestStalenessPassCost…`, `TestOneWorkersBackfill…` |
| M2 | the deep-stale anchor EXPIRES — it is re-read at least once per reuse window | KILLED | `TestDeepStaleBackfill…`, `TestDeepStaleReuse…`, `TestWalkerStalenessFires…` |
| M3 | a REUSE never renews the window | **SURVIVED, then KILLED** — see below | `TestDeepStaleBackfill…` |
| M4 | deep-stale reuse is UPWARD-ONLY, so it can only over-estimate age | **SURVIVED, then KILLED** — see below | `TestAReusedAnchorIsNeverConsultedForALowerBlock` |
| M5 | the band between bound/2 and bound is ALWAYS measured exactly | KILLED | `TestRestampThrottleReusesOnlyOlderStamps…` |
| M6 | one worker's backfill anchor never dates ANOTHER worker's cursor | KILLED | `TestOneWorkersBackfill…`, `TestStalenessPassCost…` |
| M7 | OPENING a generation must not destroy the achieved cadence | KILLED | `TestCollateralBoundSurvives…`, `TestMigrateUpgradesV7…`, `TestSweepProgressReportsAchievedPassDuration` |
| M8 | a REWIND does not un-happen a pass that really completed | KILLED | `TestARewindDoesNotEraseTheAchievedPassDuration` |
| M9 | a restarted process's FIRST verdict already judges with the durable bound | KILLED | `TestCollateralBoundSurvives…` |
| M10 | closing a generation records HOW LONG the pass took, in the same guarded statement | KILLED | 4 tests |
| M11 | a duration that CANNOT be recovered is left unknown, never defaulted | KILLED | `TestMigrateUpgradesV7…` |
| M12 | `SweepProgress` reports the DURABLE duration, so an OPEN generation still answers | KILLED | `TestSweepProgressReportsAchievedPassDuration` |
| M13 | the ROUND MEMO is revalidated against the current clock | KILLED | `TestTheRoundMemoIsRevalidated…` |
| M14 | the retained CHAIN stamp is revalidated, on both its arms | KILLED | `TestEveryStampReuse…` (3 subtests) |
| M15 | the DEEP-STALE anchor is revalidated too | **SURVIVED, then KILLED** — see below | `TestTheBackfillAnchorCarriesItsOwnSkewCheck…` |
| M16 | an invalidated stamp is EVICTED, not merely refused once | KILLED | `TestEveryStampReuse…`, `TestTheRoundMemo…` |
| M17 | a clock rollback must not arm the per-chain retry COOLDOWN | KILLED | `TestEveryStampReuse…` |
| M18 | the future-skew predicate is the SAME at write-in and read-out | KILLED | `TestEveryStampReuse…`, `TestGrossFutureHeaderTime…`, `TestTheRoundMemo…` |
| M19 | an ALL-STALE sweep batch is a TYPED refusal that applies nothing | KILLED | `TestQuietlyRefusedSweep…`, `TestApplySweepBatchRejectsStaleExecutionBlocks` |

### The three gaps the loop found (commit `827a9e6`)

**M3 — reuse renewing the window survived.** The refresh leg advanced exactly one window, which is
one window from the LAST REUSE as well as from the fetch, so both implementations passed. The
timings now disagree on purpose: 100 hot rounds (20 s), then +15 s — **35 s past the fetch, 15 s past
the last reuse**. Only an implementation that measures from the fetch refreshes. Without this, an
"optimisation" that stamped `fetchedAt` on reuse would ride one anchor forever, one reuse at a
time, and a caught-up worker would be pinned red indefinitely.

**M4 — downward reuse survived, and the honest reason is that it cannot flip a verdict.** On the
deep-stale arm both readings are past the bound, so allowing `s.block > block` produces the same
red. What it corrupts is the AGE the operator is shown, which is the entire content of the reason
text. The new test asserts the direction on the **reason** (`96h0m0s old`, not the anchor's `72h`)
as well as on the fetch count — a verdict-only assertion would have called this equivalent and let
the reported age drift from the truth.

**M15 — the deep-stale anchor's own skew check survived, because in every arrangement the chain
stamp held the same invalidated timestamp and its check fired first.** The check is not redundant,
and the arrangement that proves it is one production reaches: two workers on one chain at very
different heights, so the CHAIN stamp is left holding the LOWER block's OLDER timestamp. A
three-hour rollback then leaves the chain stamp two hours in the past (its check passes) while the
other worker's one-hour-old anchor is two hours in the FUTURE. Only that anchor's own check stands
between the daemon and `stalenessAge` clamping a negative age to zero — the exact false-green this
finding is about. The test asserts both preconditions explicitly (`beyondSkewTolerance` false for
the chain stamp, true for the anchor) so it cannot pass for the wrong reason. **Found by mutation,
not by review** — the same way wave 9's M15 was.

---

## Verification

**Baseline at `cb3a955`: 541 top-level PASS / 626 including subtests / 0 FAIL / 0 SKIP.**
**This unit at `827a9e6`: 552 / 643 / 0 FAIL / 0 SKIP.** (+11 top-level, +17 including subtests:
12 new tests + 6 new subtests, minus the deleted fabricated one.)

**Counting convention:** top-level = `grep -c '^--- PASS'` (an unindented `--- PASS` is a top-level
test); including subtests = `grep -cE '^\s*--- PASS|^--- PASS'`. FAIL and SKIP counted the same way.

```
go build ./...   OK
go vet ./...     OK
gofmt            see below — READ, and it is a CRLF artifact
go test ./... -count=1        0 FAIL / 0 SKIP
-race, golang:1.24 via host.docker.internal   all 9 packages ok, 0 data races
```

### How the unit was verified, and why in isolation

**The shared database was demonstrably being written by the parallel wave.** The first baseline
attempt against `solvent` reported **7 failures**, and an immediate re-run of `internal/store` alone
reported **20** — a moving target, all in tables `internal/store`'s suite TRUNCATEs, including two
of my own collateral tests. That is the interference the brief anticipated. Every number in this
report therefore comes from:

- a **`git archive` export** of the commit under measurement (`cb3a955` for the baseline, `827a9e6`
  for the unit) into a scratch directory — read-only, **no worktree created or removed**;
- a **dedicated database** on the same `solvent-db-1` instance (`solvent_wave11`,
  `solvent_wave11iso`), so the other wave's schema was neither read nor written.

The shared tree also held the other implementer's mid-edit files (`internal/prices/poller.go`,
`internal/store/prices.go`, `internal/store/prices_binding_test.go`) throughout. **All staging was by
explicit pathspec; `git add -A` was never used**, which is why none of their work appears in either
of my commits. Three of their commits (`e16d39f`, `fdb9f8d`, `15fa81c`) landed between mine; all
three are docs-only, so the test delta above is entirely this unit's.

### `gofmt`, read as instructed

`gofmt -l .` in the shared working tree listed **three** files: `internal/prices/poller.go` and
`internal/store/prices.go` (the other wave's, not mine) and `internal/store/derive.go` (mine).
`gofmt -d` on the last shows it wants to rewrite the **whole file from CRLF to LF** — the worktree
copy is CRLF because git checked it out that way under `core.autocrlf=true`, and the editor
preserved that. It is not a formatting fault, and normalising it would produce a whole-file diff on
Codex-approved ground. The committed diff is unaffected (`git diff --stat` shows +108/−… on
`derive.go`, not a rewrite) because git normalises on commit.

The definitive check: **every `.go` file in the `827a9e6` export, copied through `tr -d '\r'` and run
through `gofmt -l`, produces empty output.** (The export itself is CRLF — `git archive` applies the
eol attribute — which is why `gofmt -l` on it lists all 55 files. Same artifact, whole-repo scale.)

---

## Unverified / residual — stated honestly

1. **A caught-up worker stays red for up to one reuse window (30 s).** This is the deep-stale arm's
   price, it is fail-closed, and it is bounded and tested — but it IS a behaviour change from wave 9,
   and `TestWalkerStalenessFiresWhileTheWalkerIsAdvancing` was amended to state it. Flagged as the
   first thing round 10 should judge.
2. **The daemon-clock rendering of database-clock timestamps** (`OldestSuccessAt`, `LastSuccessAt`)
   in condition reason text can under-state an age if the daemon clock lags the database's. Cosmetic
   — the verdict is made in SQL on the database clock — found by the H3 sweep, not fixed, recorded
   above for a ruling.
3. **`SweepLastPassDuration` has no test of its own beyond the four that drive it.** It is a
   single-row read sharing `SweepProgress`'s fallback logic; the two are asserted to agree in
   `TestSweepProgressReportsAchievedPassDuration` and in the migration test.
4. **The migration cannot recover the pass duration of a generation OPEN at upgrade time.** By
   construction — the value was already overwritten. The bound degrades to the pre-fix naive formula
   for that one generation and self-heals at its first completion. Asserted as NULL, deliberately.
5. **`last_pass_seconds` is whole-second resolution.** Four orders of magnitude finer than anything
   the doubled bound distinguishes, and it makes the restart comparison bit-exact rather than
   approximate — but it is a deliberate loss of sub-second precision versus the old
   `completed_at - opened_at` arithmetic.
6. **The cost harness models the CONFIGURED deployment.** Its 9 reads are a function of that shape
   and of the judged order; a deployment whose streams all sit at distinct heights pays up to 13.
   The test says so; the number is not presented as universal.
7. **`internal/snapshot` was not modified.** H4 needed no change there — the fake chain lives in the
   `cmd/indexer` test file.
8. **No pre-commit gate blocked anything.** The control-plane doctor and scope-gate ran on both
   commits and reported OK (`0 error(s), 0 warning(s)`); nothing was bypassed.
