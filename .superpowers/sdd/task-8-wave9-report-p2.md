# Task 8 — wave 9 report: the health/readiness surface

**Unit:** `539969d` (implementation) → `addd5e4` (tests) → `331c0a6` (a mutation-found gap).
**Base:** `0c3ff96`. **Returns to Codex for round 9 under D-006, reviewed on its own.**

Closes the two Codex round-5 findings deferred while the price pipeline stabilised:

- **[high]** snapshot readiness remains green while collateral is failed or absent → `collateral_unusable`
- **[medium]** fixed block counts do not enforce the stated ten-minute time bound → `staleness` /
  `staleness_unmeasured`

---

## READ THIS FIRST — three things round 9 should judge deliberately

### 1. OQ1 reverses a pinned precedent (flagged, as instructed)

`health_test.go`'s `TestApplyProgressConditionsIssuesNoVerdictOnReadFailure` asserted that a failed
durable progress read issues **no verdict**, on the reasoning that inventing a stall from a failed
query would be a fabricated signal. That reasoning was right about fabrication and wrong about the
consequence: the pass **touches** every watched worker before it reads, and publication **replaces**
a touched worker's entries — so one failed query deleted every standing red on those workers for that
round. A worker that was stalled, stale *and* erroring went completely clean on `/readyz` for a round
because the database hiccuped.

Per the controller's ruling (option b), a failed read now emits `progress_unmeasured`. It fabricates
nothing — it asserts only that the daemon could not look — and it is symmetric with the header-fetch
fail-red rule the freshness gate uses, so the surface now has **one** rule for unmeasurable state
instead of two opposite ones.

The test is replaced by `TestFailedProgressReadEmitsUnmeasuredRatherThanErasingStandingReds`
(`health_test.go`), which drives the erasure directly: round 1 establishes a real `no_progress` red,
round 2 fails every read, and the test asserts both that the unmeasured reds appear **and** that the
daemon does not claim the stall it could not observe. Round 3 asserts it clears — `progress_unmeasured`
is re-derived per round, not a latch. Mutation **M18** confirms the old behaviour is now detected.

Applied to all three reads (ingest, derive, sweep). Runner/consumer names overlap, so the set is
deduplicated: two sources of one verdict must not become a publisher collision.

### 2. `internal/store/derive.go` modified for the 5th time (flagged, as instructed)

Two changes, both additive, both inside transactions that already existed:

- **A1 — the rewind clamp.** One `UPDATE` added inside `RewindDerived`'s existing transaction,
  between the orphan deletions and the generation bump. No statement was reordered, removed or
  re-scoped.
- **A2 — the stamp guard.** The success upsert's `ON CONFLICT` arm gains one `CASE` for the new
  column. The monotonic block guard, the attempts arithmetic and every other column are byte-identical.

The failure upsert is deliberately **unchanged**: it names neither `last_success_block` nor
`last_success_at`, so a new row takes the column defaults and an existing row keeps its record. A
comment states this, because "we changed nothing here" is exactly the kind of claim a reviewer should
be able to check without diffing.

### 3. Two changes outside the brief's listed touch set

- **`internal/chain/chain.go` — `Failover.HeaderTime` added (31 lines, purely additive).** Design 2
  requires the header timestamp of *an arbitrary block*, and `Failover` had no such method:
  `HeaderHash` returns only the hash, `HeadFrom` reads only `latest`. The design's own cost analysis
  (L8) reasons about `Failover.do`'s sticky re-pin, so the shared path is what the design assumes; the
  method uses `do`. Nothing existing was touched. **This was not in the brief's scope list and I did
  not invent an alternative — flagging rather than improvising.**
- **`cmd/indexer` interface narrowing.** `ingestWorker` no longer declares `HeadLag()` or
  `ObservedHead()`. Both existed solely to serve `head_lag`, which measured distance from a head the
  walker held **in memory** — process state a restart resets. The elapsed-time gate needs neither.
  `internal/ingest/walker.go` is untouched; it still exposes both methods for its own tests.

**One deletion worth naming:** the startup WARN that fired when a stream's `confirmations` met or
exceeded its chain's block allowance is gone with the allowance. It compared a configured block count
against a nominal-cadence conversion — the exact fallacy this wave removes. The conflict it warned
about now surfaces honestly and in the right unit: such a walker's cursor block simply dates older
than `maxDerivedStaleness`, and the condition says so with the block's real timestamp in the reason.

---

## DESIGN 1 — `collateral_unusable`

### Amendments implemented

| | What landed | Citing test |
|---|---|---|
| **A1** rewind clamp | `UPDATE snapshot_sweeps SET last_success_block = 0, last_success_at = NULL WHERE engine = $1 AND last_success_block > $2`, inside `RewindDerived`'s tx | `TestRewindClampsSweepSuccessAboveTarget` |
| **A2** `==`-replay stamp guard | `last_success_at = CASE WHEN EXCLUDED.last_attempt_block > snapshot_sweeps.last_success_block THEN now() ELSE snapshot_sweeps.last_success_at END` | `TestSweepSuccessStampAdvancesOnlyOnANewBlock` |
| **A3** bound formula | `collateralStaleBound(interval, lastPass) = max(2*(interval+lastPass), noProgressBound)`; `LastPassDuration` from `completed_at - opened_at`, retained across rounds by `collateralBoundState` | `TestCollateralStaleBoundCoversIntervalPlusAchievedPass`, `TestCollateralBoundReachesTheStoreWithOneRoundLag`, `TestSweepProgressReportsAchievedPassDuration` |
| **A4** placement pin | the check sits after the `Exhausted` gate and **before** `if !p.Open { return }` | `TestCollateralUnusableFiresWhetherTheGenerationIsOpenOrClosed` (explicit `Open:false` and `Open:true` legs) |

**Migration `00006`** (wave 8 shipped none, so the number was free): `last_success_at TIMESTAMPTZ`,
backfilled `WHERE status = 'success'` from `updated_at`, failed rows left NULL, plus a
`(engine, last_success_block, last_success_at)` index for the per-round count. NULL counts as **stale**.

**OQ3 accepted and stated in the code**, not glossed: `collateralStaleBound`'s comment says the gate
certifies "as fresh as the sweep cadence this deployment actually achieves permits" — not an absolute
age — and names the residual (if the registry grows until a pass takes a day, the bound grows with it).
No absolute ceiling was invented; a number nobody derived is the borrowed-constant fallacy already
rejected once.

### Invariants → citing tests

| Invariant | Test |
|---|---|
| **I2′** membership changes only via the rewind clamp (add) or that account's own landed success (remove); generation open/close, failed upserts and status churn never move it | `TestCollateralUnusableSurvivesGenerationRollover` — drives a real `OpenSweepGeneration`, shows `Exhausted` collapsing to 0 on the rollover alone while the usability count is untouched, then shows another account's success failing to clear it and its own success clearing it |
| **I3′** `last_success_at` written only in the success upsert and only on strict block advance; failure upsert and stale-skip leave it untouched; `RewindDerived` may NULL it | `TestSweepSuccessStampAdvancesOnlyOnANewBlock` (replay leg asserts the stamp is byte-identical *while `attempts` really incremented* — so the stamp held because of the guard, not because nothing happened) |
| **I4′** stale iff `last_success_at IS NULL` or DB-clock age exceeds the bound under strict `<`; boundary at **bound ± 1s** | `TestCollateralStalenessBoundaryAndNullStamps` — both rows aged by `now() - make_interval(...)` in the same statement shape the judging query uses, because exact equality against a live clock is untestable |
| **I11** a rewind moves the invalidated account into the unusable set in the SAME transaction that deletes its history | `TestRewindClampsSweepSuccessAboveTarget` |

### Test plan items

1. ✅ Stamp test with the `execBlock ==` leg [A2].
2. ✅ Boundary test, one DB clock, bound−1s / bound+1s / NULL-with-success-block [I4′].
3. ✅ Rollover test through a real `OpenSweepGeneration` [the finding].
4. ✅ `TestRewindClampsSweepSuccessAboveTarget` [A1/I11] — counted `NeverSucceeded`, history gone,
   next canonical success **lands** and clears.
5. ✅ Neither-set leg: `status='failed'`, attempts ≥ budget, `last_success_block > 0`, fresh stamp →
   in **neither** count (`TestExhaustedFailureWithFreshCollateralIsInNeitherUsabilityCount`).
6. ✅ Migration test (`TestMigrateUpgradesV5SweepBaselineFailClosed`) — asserts the NULL **and** the
   resulting count through the gate's own query, because a predicate-less backfill passes every
   "no data loss" check and still greens the gate.
7. ✅ The `Ready=true`-with-failures subtest is replaced (see the report note below).
8. ✅ The persistence test is renamed honestly:
   `TestSweepProgressReportsExhaustedFailuresThroughGenerationClose` retains its name (it does drive
   the real close); the *daemon-side* rollover claim moved to the store-level test that can actually
   prove it.
9. ✅ `Open:false` + `StaleSuccess:1` and `Open:true` legs, both explicit [A4].
10. ✅ `TestSnapshotterConditionsComposeInOneRoundAndClearInTheNext` — asserts structurally
    (`require.Len(t, rc[snapshotName], 4)` before publication, then all four keys present after
    **one** `publishRound`, then cleared next round). No assertion on log output: `health_test.go`'s
    `TestMain` discards slog globally, so a log-based assertion would assert nothing.
11. ✅ Bound property leg over sampled `(I, S)` [A3].
12. ✅ Quiet-refusal leg (`TestQuietlyRefusedGenerationFailsReadinessThroughUsability`) — five
    `(false, nil)` Steps, no `step_error`, no `no_progress`, no `snapshot_failures`, and
    `collateral_unusable` is the only thing that catches it.

**Report note on item 7, as required.** The deleted subtest set `Failed:2, Exhausted:0` and asserted
`Ready == true` — codifying "green with two current failures" as specified behaviour. **It would
still pass against this implementation**, as long as the fake reports no unusable accounts. Its
deletion is therefore a *policy statement*, not a bug fix: a test that says "green is correct here" is
a licence a future change can cite, and this surface has twice shipped defects a passing test had
licensed. What the subtest was genuinely about — `snapshot_failures` is keyed on *exhausted*, so a
transient revert with budget left does not fire it — is a real property of that key and is kept; the
replacement adds `NeverSucceeded: 2` and asserts readiness **fails**.

---

## DESIGN 2 — `staleness` / `staleness_unmeasured`

`chainLagBound`, `chainBlockTime`, `fallbackBlockTime` and `conditionHeadLag` are deleted. The gate
subtracts the cursor block's own header timestamp from now. No cadence assumption remains anywhere in
the path.

**Interpretation to flag:** the brief's Design-2 core says the gate is "applied to raw-log consumers
(runners and the feed deriver)". I applied it to **walkers as well**. L1's own rationale is about a
*walker* with no cursor row losing its only red when `head_lag` is deleted, which only makes sense if
walkers are gated; and leaving them ungated after deleting the walker-side `head_lag`
(`main.go:477-483`) would have opened a hole exactly where the wave was closing one. Every walker with
a durable cursor is judged; every walker without one is `staleness_unmeasured`.

### Amendments implemented

| | What landed | Citing test |
|---|---|---|
| **L1** no-cursor population | a watched worker with no cursor row (when the read **succeeded**) ⇒ `staleness_unmeasured`; applied to walkers *and* consumers, which is the literal reading of I10 | `TestStalenessIsUnmeasuredNotSilentWithoutACursor/TestNeverIngestedWalkerIsUnmeasuredNotGreen` |
| **L2** future-skew sanity | `headerTimeSkewTolerance = 60s`; beyond it a measurement failure, **never memoized**; within it the age clamps to 0 | `TestGrossFutureHeaderTimeIsUnmeasuredNotGreen` (3 legs incl. a wrong-unit millisecond timestamp) |
| **L3** `frontier_lag` structural gating | emitted only when the same consumer already carries `staleness`/`staleness_unmeasured` this round, via `roundConditions.has`; `tF` clamped to `min(tF, now)` | `TestFrontierLagAttributesInTime` (3 legs) |
| **L4a** `chainDown` lifetime | `stalenessRound` is a **local value** built fresh by the caller; the judge holds only stamps + cooldown | `TestChainDownIsRoundScopedNotRemembered` |
| **L4b** retry cooldown | `headerFetchCooldown = 30s` per chain, retained error reported without re-paying `headerFetchTimeout = 10s` | `TestStalenessUnmeasuredClearsWhenFetchRecovers` (call-log legs) |
| **L5** memo keying / ordering / throttle | memo keyed `(chainID, block)`; consulted **before** down-set and cooldown; `headerRestampThrottle = 30s` reuse admitted only for an **older-or-equal** block whose implied age ≤ bound/2 | `TestHeldStampYieldsAMeasuredVerdictOnADownChain`, `TestAHeldStampOutranksBothTheDownSetAndTheCooldown`, `TestRestampThrottleReusesOnlyOlderStampsAndOnlyFarFromTheBound` |
| **L6** consumer input decoupling | consumer staleness judged on the derive read **alone**; ingest rows feed attribution only, skipped silently | `TestConsumerStalenessSurvivesAnIngestReadFailure` |
| **L7** shutdown carve-out | `applyProgressConditions` returns verdict-less on `ctx.Err()`; a cancelled fetch arms no cooldown | `TestCanceledRoundProducesNoWave9Conditions` |
| **L8** comment scoping | `maxDerivedStaleness`'s comment scopes it to log-derived state and prices and **explicitly excludes collateral**; `applyStalenessConditions`' comment states both cost bounds and the per-WORKER erosion unit (`Failover.do` re-pins on success) | — (prose; measured numbers below) |
| **L9** naming guards | distinctness against wave 8's shipped `prices.Condition*` names | `TestDaemonConditionKeysDoNotCollideWithPriceWorkerKeys` |

**L9 detail.** Wave 8 shipped 11 condition names (`poll_round`, `poll_target_freshness`,
`poll_invalid_answer`, `poll_freshness_unhydrated`, `poll_block_advance`, `poll_rewind_blocked`,
`feed_publication`, `feed_invalid_answer`, `feed_timestamp`, `feed_freshness_unhydrated`,
`rpc_ingest_lag`), read out of `internal/prices/prices.go` at implementation time; `internal/prices`
was otherwise not touched. The test references them through their **exported constants**, so a rename
breaks this build and a value change fails the assertion. **Honest residual:** a *new* constant added
to `internal/prices` is not caught — Go has no reflection over constants — so this guards drift in the
names that exist, not exhaustiveness. Stated in the test's own comment.

### Invariants → citing tests

| Invariant | Test |
|---|---|
| **I3′** a fetch failure produces exactly one `staleness_unmeasured`, no fabricated age, never memoized, retried no later than cooldown expiry; the next success clears it | `TestStalenessUnmeasuredClearsWhenFetchRecovers`, `TestFailedHeaderFetchIsNeverMemoized` (asserts the reason contains no `1970` and `judge.stamp` is empty) |
| **I4′** ≤1 fetch per `(chainID, block)` per round; ≤1 failover walk per chain per cooldown window; a valid memo stamp is used even on a down chain | `TestOneHeaderFetchPerChainBlockPerRound` (asserts the exact call log), `TestChainDownIsRoundScopedNotRemembered`, `TestHeldStampYieldsAMeasuredVerdictOnADownChain` |
| **I7′** `frontier_lag` only ever accompanies a same-round `staleness`/`staleness_unmeasured` (structural) | `TestFrontierLagAttributesInTime/a measurably fresh consumer gets no attribution at all` |
| **I8′** `ts ∈ (now, now+60s]` clamps to age 0; `ts > now+60s` is a measurement failure; `age == bound` passes; bound+1s fails | `TestGrossFutureHeaderTimeIsUnmeasuredNotGreen`, `TestStalenessBoundaryEqualityPassesAndOneSecondPastFails` |
| **I10** a watched worker with no durable cursor row is never green-by-silence | `TestStalenessIsUnmeasuredNotSilentWithoutACursor` (walker and consumer legs) |
| **I11** a cancelled round context produces no wave-9 conditions | `TestCanceledRoundProducesNoWave9Conditions` (also asserts **zero** chain reads) |

### The fake varies the SUBSTANCE

`fakeHeaderTimes.seedMissedSlots` lays down a **nonlinear** schedule: 40 blocks spanning 30 minutes,
i.e. heavy slot misses. `retiredBlockAllowance` (= `maxDerivedStaleness / 12s` = the deleted gate's
50-block allowance on chain 1) is spelled out in the test file, and
**`TestHeaderTimeFakeFalsifiesBlockDistance` asserts the harness itself**: a cursor 40 blocks behind
head is *inside* the retired allowance and *outside* the real bound. Every elapsed-time test below it
lives in that gap, so each one would have **passed** against the predicate this wave removes. This is
the direct answer to round 5's adjudication that "the fake is now the limiting factor".

Only the physically realisable direction is modelled (fewer blocks per unit time). The converse —
many blocks in very little time — cannot occur, since a chain cannot produce blocks faster than its
minimum interval; the test file does not pretend otherwise.

---

## Mutation results — 23 run, 22 killed by assertions, 1 proved equivalent

Every kill was verified to be an **assertion failure**, not a build or vet error, by re-running each
mutation with `-v` and reading the failing test names. Two mutations that the first pass reported as
"killed" turned out not to be killed by assertions at all; both are recorded honestly below.

| # | Property validated | Verdict | Killed by |
|---|---|---|---|
| M1 | a crash-replay at the SAME execution block cannot refresh collateral freshness (A2) | KILLED | `TestSweepSuccessStampAdvancesOnlyOnANewBlock` |
| M2 | a rewind moves every invalidated account into the unusable set in the SAME tx (A1/I11) | KILLED | `TestRewindClampsSweepSuccessAboveTarget` |
| M3 | a FAILED row's `updated_at` is not a success time — the backfill's status predicate is load-bearing | KILLED | `TestMigrateUpgradesV5SweepBaselineFailClosed` |
| M4 | an UNKNOWN success time counts as STALE, not fresh-by-absence (I4′) | KILLED | `TestCollateralStalenessBoundaryAndNullStamps` + 3 migration tests |
| M5 | an account never attempted (no sweep row) is counted unusable | KILLED | 3 migration tests |
| M6 | a non-positive bound is REFUSED, not defaulted to an invented number | KILLED | `TestCollateralStalenessBoundaryAndNullStamps` |
| M7 | a CLOSED generation holding unusable accounts must not idle green (A4) | KILLED | `TestCollateralUnusableFiresWhetherTheGenerationIsOpenOrClosed/Open:false`, `TestQuietlyRefusedGeneration…` |
| M8 | the bound tracks the ACHIEVED cadence, not the interval alone (A3) | KILLED | `TestCollateralStaleBoundCovers…`, `TestCollateralBoundReachesTheStore…` |
| M9 | a future-stamped header is a measurement failure, not freshness (L2) | KILLED | `TestGrossFutureHeaderTimeIsUnmeasuredNotGreen` (2 subtests) |
| M10 | a failed measurement is NEVER memoized as a stamp (I3′) | KILLED | `TestFailedHeaderFetchIsNeverMemoized`, `TestStalenessUnmeasuredClears…`, `TestChainDown…` |
| M11 | a dead chain costs ONE fetch per cooldown window, not one per round (L4b) | KILLED | `TestStalenessUnmeasuredClearsWhenFetchRecovers` |
| M12 | *(removing the post-success `delete` of the cooldown entries)* | **EQUIVALENT — see below** | — |
| M12b | the cooldown EXPIRES: a failing chain is retried, never abandoned (fail-forever) | KILLED | `TestStalenessUnmeasuredClears…`, `TestChainDown…`, `TestFailedHeaderFetch…` |
| M13 | a worker with NO durable cursor row is never green-by-silence (L1/I10) | KILLED | `TestStalenessIsUnmeasuredNotSilentWithoutACursor/TestNeverIngestedWalkerIsUnmeasuredNotGreen` |
| M14 | `frontier_lag` can never gate a measurably-fresh consumer (L3/I7′) | KILLED | `TestFrontierLagAttributesInTime/a measurably fresh consumer…` |
| M15 | a HELD stamp is consulted before the round's down-set (L5 ordering) | **SURVIVED, then KILLED** — see below | `TestAHeldStampOutranksBothTheDownSetAndTheCooldown` |
| M15b | a HELD stamp is consulted before the retry COOLDOWN (L5 ordering) | KILLED | `TestAHeldStampOutranksBothTheDownSetAndTheCooldown` |
| M16 | stamp reuse is admitted only for an OLDER-or-equal block, so it can only OVER-estimate age (L5) | KILLED | `TestRestampThrottleReusesOnlyOlderStamps…` |
| M17 | an age EXACTLY at the bound passes; one second past fails | KILLED | `TestStalenessBoundaryEqualityPassesAndOneSecondPastFails/exactly at the bound passes` |
| M18 | a failed durable progress read emits an explicit red instead of erasing standing ones (**OQ1**) | KILLED | `TestFailedProgressReadEmitsUnmeasuredRatherThanErasingStandingReds` |
| M19 | a consumer's bound is judged on its OWN cursor read, never suspended by an ingest failure (L6) | KILLED | `TestConsumerStalenessSurvivesAnIngestReadFailure` |
| M20 | a cancelled round produces NO conditions and pays for no chain read (L7/I11) | KILLED | `TestCanceledRoundProducesNoWave9Conditions` |
| M21 | the gate genuinely measures elapsed time (a no-op age would make everything green) | KILLED | `TestConsumerStaleness…`, `TestFeedWorkerConditions…`, `TestFrontierLagAttributesInTime` |

### M15 — a real gap the mutation loop found, and the test written for it

Moving the round down-set check **above** the retained-stamp memo initially **survived**.
`TestHeldStampYieldsAMeasuredVerdictOnADownChain` has only ONE worker on the chain, so nothing has
populated the down-set by the time that worker is judged — the ordering was never exercised. The
consequence of the mutation is real: a worker whose age the daemon demonstrably knows would be
downgraded from a true `staleness` red to "cannot measure", losing exactly the red a
wedged-on-a-dead-chain worker must produce.

`TestAHeldStampOutranksBothTheDownSetAndTheCooldown` (commit `331c0a6`) puts a **second** worker on
the same chain whose fetch fails **first** — asserted via the call log, so the ordering is observably
exercised and not merely arranged. It kills both M15 and M15b. **This gap was found by mutation, not
by review.**

### M12 — equivalent mutant, with the reason

Deleting the post-success `delete(j.nextFetchAttempt, chainID)` / `delete(j.lastFetchErr, chainID)`
changes no behaviour. A fetch is only attempted when `!now.Before(next)`, i.e. `now >= next`; a
successful fetch therefore implies the cooldown deadline is already in the past, and `now` only
increases, so the stale entry can never re-enter the cooldown branch. The deletes are hygiene
(bounded map content, explicit intent), not correctness. Rather than claim coverage the tests do not
have, the behavioural mutation **M12b** was run instead — making the cooldown effectively permanent,
which is the genuine fail-forever — and it is killed by three tests.

---

## The staleness pass's cost — MEASURED

Measured against the **actual deployment shape** in `config/contracts.json` (10 streams over 2 chains,
plus 2 derivation runners and 1 feed deriver as raw-log consumers = **13 gated workers**), counting
real `headerTimeFetcher` invocations over 20 rounds. The measurement harness was run against the
isolated build and is **not** part of the shipped suite.

| Regime | Header reads / 20 rounds | Per round |
|---|---|---|
| Caught up, every worker at one height | **2** | 0.10 |
| Caught up, every worker at its OWN height | **13** | 0.65 |
| Backfill (cursors advance every round), hot loop @ 200 ms | **13** | 0.65 |
| Backfill, rounds 60 s apart | **260** | 13.00 |
| Both chains DOWN, hot loop @ 200 ms | **2** | 0.10 |
| Both chains DOWN, rounds 60 s apart | **40** | 2.00 |

Reading these:

- **Steady state costs one read per worker EVER, not per round.** A block's timestamp is immutable, so
  a stationary cursor is answered from the retained stamp indefinitely — the "caught up" rows are
  13 reads *in total*, not 13 per round.
- **The hot inner loop is where the design's amendments earn their keep.** Backfilling at 200 ms
  rounds costs 13 reads across 20 rounds because the restamp throttle absorbs the advancing cursors
  inside its 30 s window. Both chains dead costs **2** reads across 20 rounds — one attempt per chain
  per cooldown window. **Without L4b's cooldown that would be 13 × 20 = 260 ten-second timeouts**, which
  is precisely the concurrent-backfill collapse the amendment was written to prevent.
- **The 13.00/round row is the design's stated ceiling** (`#gatedWorkers × fetch latency per round`)
  and it occurs only when rounds are already 60 s apart — a regime in which 13 header reads are
  negligible against the round itself.
- **The failure-path bound holds exactly**: ≤ `#chains × headerFetchTimeout` per cooldown window,
  never per round.

---

## OQ rulings

- **OQ1** — implemented and flagged above.
- **OQ3** — accepted; the relative-freshness contract is stated in `collateralStaleBound`'s comment,
  no ceiling invented.
- **OQ4** — `head_lag` removed; distinctness against wave 8's landed names pinned by test.
- **OQ5 — CHECKED, and the answer is yes.** The daemon runs `store.Migrate` at startup
  (`cmd/indexer/main.go:1424`, after `AcquireWriterLock` and before any worker is built), so
  old-DB/new-binary self-heals before the first round. Only new-DB/old-binary remains, and it is
  harmless: old code never reads `last_success_at`. **No runbook migration-first rule is needed.**
- **OQ6** — accepted; deploy-time red until each account re-succeeds, first-failure flap
  O(pass duration), permanent red for permanently-reverting accounts. Alerts key on condition KEYS,
  and the residuals are stated in the code (`conditionCollateralUnusable`, `collateralStaleBound`).

---

## Verification

Baseline at `63bf5b9`: **498 / 576 / 0 FAIL / 0 SKIP**.

**This unit at `331c0a6`: 522 top-level PASS / 607 including subtests / 0 FAIL / 0 SKIP.**
(+24 top-level, +31 including subtests.)

**Counting convention:** top-level = `grep -c '^--- PASS'` (an unindented `--- PASS` is a top-level
test); including subtests = `grep -cE '^\s*--- PASS|^--- PASS'`. FAIL and SKIP counted the same way.

```
go build ./...   OK
go vet ./...     OK
gofmt -l .       see below
go test ./... -count=1       0 FAIL / 0 SKIP
-race, golang:1.24 container via host.docker.internal   all 9 packages ok
```

**`gofmt -l .` output, read as instructed:** it lists **every** `.go` file in the repository,
including files this wave never touched (`internal/prices/poller.go`, `internal/decode/decode.go`, …).
That is a CRLF artifact of this Windows working copy, not a formatting fault. Verified by copying each
touched file to a scratch directory with `tr -d '\r'` and running `gofmt -l` on the copies: **empty
output**. One genuine fault was found this way (a double blank line in `health_test.go`) and fixed.

### How the unit was verified in isolation — and why that was necessary

**Parallel work landed on `main` during this session.** The working tree acquired, from another agent,
modifications to `internal/prices/poller.go` and `internal/store/prices.go`, a new untracked migration
`00007_price_provenance_binding.sql`, a `currentSchemaVersion` bump to 7, and a docs commit
(`73d75cf`) that sits **between** my base and my first commit. Running the full suite in the shared
tree therefore reports **10 failures**, all of them in `internal/store` and all attributable to that
work (`currentSchemaVersion` now 7 vs. an embedded max of 6 in my tree, and a nil-pointer panic at
`store_test.go:65` that aborts the rest of the package). **None of them are in files this unit touches.**

So the unit was verified against a clean export of its own commit:

- `git archive 331c0a6 | tar -x -C <scratch>` — a read-only export. **No worktree was created or
  removed**, as instructed.
- a fresh database `solvent_wave9` on the same `solvent-db-1` instance, so the other agent's schema
  was neither read nor written.

Every number above (522/607/0/0, race, cost) comes from that isolated run. **All staging was by
explicit pathspec; `git add -A` was never used**, which is why none of the parallel work appears in
any of my three commits. The mutation harness restores each file from an in-memory byte-exact backup
and **never runs `git checkout --`**, because a stray checkout in this tree would have destroyed the
other agent's uncommitted work (the wave-6 failure mode, with a second party's work at stake).

---

## Unverified / residual — stated honestly

1. **`Failover.HeaderTime` has no test of its own.** It is 12 lines wrapping `HeaderByNumber` in the
   existing `do` path, and every daemon-side behaviour is driven through a fake fetcher. The real RPC
   read is exercised only transitively; `internal/chain`'s live tests were not extended. It is
   additive and outside the brief's listed scope — see the flag above.
2. **The cost measurement is not a shipped test.** The numbers are reproducible but are not defended
   by CI; a future change could regress them silently. A `fetches`-counter assertion exists only in
   `TestOneHeaderFetchPerChainBlockPerRound` (the per-round memo) and in the cooldown call-log legs.
3. **L9's distinctness guard is not exhaustive** — a *new* `prices.Condition*` constant would not be
   caught. Stated in the test.
4. **OQ2 is out of scope and remains open at HEAD**, as the brief scoped it: an endpoint mis-reporting
   the multicall `blockNumber` can still poison `last_success_block`. A1's exit-path claim is scoped to
   "while `last_success_block` is canonical". No write-time plausibility guard was built.
5. **The first-failure flap is O(pass duration), not sub-Step** — `SweepWorkBatch` orders
   current-generation retries after the entire lagging set. Documented in
   `conditionCollateralUnusable`; alerting must key on condition KEYS, not reason text.
6. **A stream configured with a `StartBlock` the chain has not reached stays unmeasured-red** until it
   does (L1's own residual). Correct — nothing has been ingested — but an operator will see it at
   deploy time.
7. **The removed confirmations-vs-bound startup WARN** is not replaced by an equivalent startup check;
   the condition surfaces at runtime instead. Flagged above.
8. **No pre-commit gate blocked anything.** The control-plane doctor and scope-gate ran on all three
   commits and reported OK; nothing was bypassed.
