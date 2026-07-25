# Task 8 — fix wave 4 report (Codex round-3 findings)

Repo `C:\Users\kasel\source\repos\etherfi\Solvent`, branch `main`. Base `893c244`; wave 3
landed at `8907588`. All 5 round-3 findings addressed, none waived, each following Codex's own
recommendation.

## Verification

```
go build ./...                      clean
go vet ./...                        clean
gofmt -l .                          EMPTY (output read, not just the exit code)
go test ./... -count=1              472 top-level PASS / 0 FAIL / 0 SKIP
go test ./... -count=1 -race        PASS, all 9 packages (golang:1.24 container)
```

**Counting convention, stated because this has caused confusion twice: 472 is TOP-LEVEL
PASS lines (`^--- PASS:`), 0 FAIL, 0 SKIP. Counting subtests as well the number is 536
(64 subtests).** The controller's baseline at `8907588` was **451 top-level / 510 incl. 59
subtests**, so this wave is **+21 top-level / +26 including subtests**, measured the same way.

`-race` ran in the `golang:1.24` container against the live host Postgres:

```
MSYS_NO_PATHCONV=1 docker run --rm -v C:/Users/kasel/source/repos/etherfi/Solvent:/src -w //src \
  -e TEST_DATABASE_URL='postgres://solvent:solvent@host.docker.internal:5432/solvent?sslmode=disable' \
  --add-host=host.docker.internal:host-gateway golang:1.24 go test ./... -count=1 -race
```

`internal/store` is ~21s of real database work on the host and ~32s under `-race`; nothing is
skipped.

---

## The findings

### A1 [high] — a failed newer probe does not prevent deletion above a lower matching anchor

**Followed Codex's recommendation:** only accept a matching floor after every newer anchor has
been successfully probed and mismatched; any error above the candidate floor refuses repair and
retries.

**Stopped patching; enumerated.** `floorOutcome` in `internal/prices/poller.go` is now an
explicit partition of the state space with the delete/ack permission of each written into the
type's doc comment:

| outcome | evidence | may delete? | may ack? |
|---|---|---|---|
| `floorNothingAtRisk` | nothing owned above the effective target | n/a | yes |
| `floorVerified` | verified floor + complete proof above it | yes | yes |
| `floorProvenOrphaned` | every anchor probed and mismatched, anchors cover every row | yes | yes |
| `floorUnverifiable` | proof is IMPOSSIBLE (unanchored rows above the boundary) | **no** | yes, by neutralizing |
| `floorUnprobed` | proof is merely UNAVAILABLE (probe errored / page pending) | **no** | **no** — retry |

`verifyFloor` now requires **three** things before a match becomes a floor, where wave 3
required one:

1. **A match is not proof about what is above it.** A `probeFailed` seen earlier in the page
   (probes run newest-first) makes the match unusable: the function returns `floorUnprobed`
   and — critically — does **not** lower `probeResumeFrom`, so the unproven anchors are
   re-probed rather than skipped. This is the exact hole Codex named.
2. **Cross-page proof is carried explicitly.** `probeResumeFrom` is only ever lowered by a page
   in which *every* probe succeeded and mismatched, so "every anchor above the resume point was
   probed and mismatched" is an invariant of the paging state rather than an assumption.
3. **Anchor completeness is not row completeness.** A new store read
   (`CountUnanchoredPricesAbove`) asks whether any owned row above the deletion boundary sits at
   a height no anchor covers. Mixed legacy-and-anchored history produces exactly that, and a
   verified floor says nothing about it. Those rows are never deleted.

The deletion boundary is `max(floor, effective target)`, and the effective target now comes from
the store (`PriceRepairExposure`) rather than being assumed to equal the poller's cursor —
`RewindPrices` lowers a caller's target to the deepest unacknowledged `rewound_to`, so reasoning
from the cursor alone was reasoning about the wrong boundary.

One behaviour got **stricter** and one got **less** strict, both on evidence:

- stricter: a lower match no longer authorises deleting what a failed probe was asking about,
  and a verified floor no longer authorises deleting unanchored rows above it.
- less strict: `floorAllOrphaned` (wave 3's "operator decision, refuse forever") is now
  `floorProvenOrphaned` **when the anchors cover every row above the target** — every such row is
  proven to describe a replaced block, so refusing was withholding a deletion on evidence it
  already had, and creating a second unclearable stall. When the anchors do *not* cover every
  row it is `floorUnverifiable`, not a refusal.

Tests: see the enumerated case space in **Test adequacy** below.

### Deadlock [high] — pending epoch + legacy unanchored rows stalls the poller permanently

**Followed Codex's recommendation, both halves of it.**

*Half 1 — the provable transition.* `verifyFloor` asks whether anything is owned above the
**effective epoch target** rather than above block 0. When nothing is, the rewind deletes
nothing whatever floor it uses, so the epoch is acked and the state clears with no loss. This is
literally Codex's "acknowledge only after proving that no owned rows exist above the effective
epoch target".

*Half 2 — the durable recovery workflow, for the case half 1 does not cover.* Legacy rows above
the target are the realistic shape, and they are unprovable **forever**: the hash of the block
their round executed at was never recorded, and adoption cannot supply it because adoption is
refused while an epoch is pending (it would otherwise record a REPLACEMENT block's hash). Wave 3
waited there, and nothing in the process could ever end the wait — repair needs an anchor,
adoption needs the ack, the ack needs repair.

New store call `NeutralizeUnverifiablePrices(engine, chain, toBlock, verifiedFloor)`, one
transaction:

- **retains every row** — nothing is deleted;
- marks the rows above the boundary `store.InvalidReasonUnverifiableReorg`, so no usable-price
  read can return them (`LatestUsablePrice` filters `valid`) and no later repair can verify them;
- honours a verified floor exactly as `RewindPrices` does, so history proven canonical keeps its
  validity and only the unprovable suffix is marked;
- drops the poll anchors above the boundary (an anchor that outlived its round's usability could
  let a later repair hash-verify a height whose row this call declared unplaceable);
- resets the cursor and acks every epoch on the chain.

Three behaviours key off that marker, and each has its own live-store test:
`RewindPrices` never deletes a marked row; `PriceRepairExposure` / `CountOwnedPricesAbove` /
`CountUnanchoredPricesAbove` do not count them (so a permanent artifact cannot veto a later
*proven* deletion); and `insertPrice` lets a **fresh observation at the same identity supersede**
one. That last arm is not cosmetic: without it, a chain whose head reaches a neutralized height
with a different price fails every round on a price-divergence abort it can never resolve.

**Fail-closed did not become fail-open.** Nothing is destroyed, nothing unprovable is trusted,
and the state is visible: the marked rows are the newest durable observation for their keys, so
the poller reports `poll_invalid_answer` naming the marker and `/readyz` stays red until a valid
observation lands at or above the highest neutralized height. Refusal is still the answer
wherever the evidence is merely *unavailable* (`floorUnprobed` → `poll_rewind_blocked`, retry).

`blockRepair` is now reachable only from `floorUnprobed`, and its text says why: the states where
no answer can ever arrive are neutralized rather than refused.

### Snapshot [high] — snapshot ingestion can stall indefinitely while readiness stays green

**Followed Codex's recommendation:** expose snapshot semantic-stall/progress state as a health
condition included in readiness.

New store read `SweepProgress(engine)` returns the durable generation state — generation, open,
`opened_at`, `completed_at`, the newest `snapshot_sweeps.updated_at`, and a lagging-account
count. New daemon pass `applySweepProgressCondition` reports `no_progress` for worker
`snapshotter` when a generation is **OPEN** (work is owed, so batches should be landing) and
nothing has landed within `noProgressBound`. A generation that has never landed anything is
measured from its own `opened_at`.

Every input is a database timestamp, so a restart cannot grant a wedged sweep a fresh window —
which the process-local `staleRotations` streak could not have provided.

A **CLOSED** generation is deliberately not judged: `SOLVENT_SNAPSHOT_INTERVAL` can legitimately
exceed `noProgressBound`, and an idle-by-cadence worker is not a stalled one. An engine with no
`sweep_generations` row has not started rather than stopped.

`Lagging` is documented as a **lower bound** (an account never swept has no row), and the stall
verdict deliberately does not rest on it — only on `Open` plus the last-batch timestamp, both
unambiguous.

Pinned by `TestSnapshotSemanticStallFailsReadiness` (Codex's exact scenario: six rounds where
every batch is refused as stale and `Step` returns `(false, nil)`; the wrapper records nothing —
asserted — and the durable gate turns `/readyz` red anyway, then clears when a batch lands),
`TestSnapshotProgressDoesNotFireBetweenGenerations`, and
`TestSweepProgressReportsDurableSweepState` (live DB).

### Frontier [high] — readiness does not require derivation workers to catch up to their input frontier

**The correction absorbed first: wave 3's not-ready-until-chain-head claim was false as
implemented, and this report does not restate it.** What wave 3 actually built was a *recency*
check (`no_progress`) plus a walker-only *head distance* check (`head_lag`). Neither says
anything about how far a raw-log **consumer** is behind its input. What this wave implements, and
exactly what it does:

`applyFrontierConditions` compares each consumer's durable derive cursor against the **minimum**
`ingest_cursors.last_block` across the streams that feed it (the same frontier definition the
consumers use internally — above the lowest stream cursor some stream's logs may be missing) and
reports `frontier_lag` when the gap exceeds `frontierLagBound`. It is a pure function of the two
cursor listings the pass already reads, so it costs no extra query.

Consumers registered: every derivation runner **and the Chainlink feed deriver**, which Codex
noted was excluded outright and which is not a `derive.Runner`, so it has to be registered
explicitly.

**The bound, explicitly justified** (`frontierLagBound = 5_000`): deliberately the same number as
`headLagBound`, so a consumer this far behind its input is judged as far from current as a walker
the daemon already refuses readiness for, rather than at an independently invented distance. It
does not fire from live-chain jitter, and the argument rather than the assertion is in the code:
ingestion runs before derivation within a round and a consumer keeps stepping until it stops
advancing, so a caught-up consumer ends each round **at** its frontier, which then advances by
only the blocks the chain produced before the next round — three orders of magnitude inside the
bound on both configured chains. A consumer that cannot reach its frontier because its Step fails
reports `step_error`, not this.

**What it does NOT claim** (stated in `cmd/indexer/health.go`): readiness is not "every cursor is
at the chain head". It is "inside every bound", and each bound is a named constant —
`headLagBound`, `frontierLagBound`, `noProgressBound`, `blockAdvanceTTL`.

Two states are not judged, and the reason is in the code: a consumer one of whose streams has no
ingest cursor (no frontier exists), and a consumer with no derive cursor (no height to compare;
its first Step either creates one or reports `step_error`, and the startup condition holds
readiness closed until a full round completes). Price **pollers** are absent **by construction**,
not by exclusion — a poller has no raw-log input at all, so there is no frontier for it; its
analogous gate is `poll_block_advance`.

Pinned by `TestFrontierLagFailsReadinessWhenDerivationIsBehindItsInput` (raw logs at head,
cursor moved a second ago — so `head_lag` and `no_progress` are both silent and that is asserted
— derivation 899k blocks behind, `/readyz` red, clears on catch-up),
`TestFrontierLagCoversTheFeedDeriver`, `TestFrontierLagIssuesNoVerdictWithoutBothCursors`
(three subtests).

### Timestamp [medium] — future-timestamp refusal changes across restart without a new durable fact

**Followed Codex's recommendation:** bind timestamp validity to durable observation context.

The durable fact chosen is **`raw_logs.ingested_at`** — the database time at which that exact log
became durable. `RawLog` now carries it, both raw-log reads populate it
(`RawLogsInRange`, `LatestLogsByTopic`), and `classifyUpdatedAt(agg, updatedAt, observedAt)`
compares the oracle's timestamp against **the log's own ingestion time instead of the process
clock**. No wall clock is involved in the verdict at all.

Two further consequences, both deliberate:

- **Acceptance is capped.** An accepted answer's usable time is `min(reported, ingested_at)`.
  A publication legitimately precedes its ingestion so the reported time normally wins; where
  clock skew puts it slightly ahead, the durable observation caps it. This **removes** the
  future-suppression window Codex measured rather than bounding it — freshness can never run
  ahead of the moment the log became durable, so the "tolerance plus a full heartbeat-and-grace
  window with no new publication" cannot occur.
- **A log with no durable ingestion time refuses** rather than falling back to a clock. The
  column is `NOT NULL`, so that row is impossible in production; the guard is tested anyway
  rather than assumed away.

**The one thing that can change the verdict, stated rather than claimed away:** a rewind deletes
the log and the walker re-ingests it, which assigns a new `ingested_at`. A previously implausible
answer can therefore become acceptable after a rewind — but that is a genuinely new durable
observation, not a clock drifting, and the cap means acceptance still cannot place freshness
ahead of that new observation. Replaying an already-stored log does **not** change it: `SaveBatch`
inserts `ON CONFLICT DO NOTHING`, so the original stamp survives.

No migration was needed: `raw_logs.ingested_at` has existed since migration `00001`.

Pinned by `TestFeedDeriverFutureTimestampRefusalSurvivesTheWallClockCrossover` (the finding
itself: one log, one ingestion time, a restart whose clock is 90 minutes **past** the claimed
timestamp — the exact state in which the old code accepted it — and the verdict is identical),
`TestFeedDeriverRefusesImplausibleUpdatedAtInsteadOfClamping` (two subtests, including the
restart re-decode), `TestFeedDeriverAcceptsSmallClockSkewButCapsFreshnessAtIngestion` (the cap,
plus that it only ever lowers), `TestFeedDeriverRefusesAnswerWithNoDurableIngestionTime`, and
`TestRawLogReadsCarryTheDurableIngestionTime` (live DB — both reads report the same instant for
the same row, or a rehydration would reach a different verdict than the live pass).

---

## Test adequacy

### The A1 case space, enumerated, with the test covering each case

Every case below deletes or refuses on evidence, and each test asserts the **safe** outcome. The
invariant under test: *never delete or bless a row without positive proof of non-canonicality for
everything above the floor.*

| # | Case | Outcome | Test |
|---|---|---|---|
| 1 | No anchors at all, and nothing owned above the effective target | ack, delete nothing (vacuous) | `TestPollerReorgAnsweredBeforeCadenceGate`, `TestPollerRewindResumesFromCursorReadBack` (both reach `floorNothingAtRisk`); `TestPollerBootstrapRewindTargetsZero` for the no-cursor variant; **live:** `TestPriceRepairExposureReportsTheBoundaryAndWhatIsAboveIt` pins the `Owned == 0` read |
| 2 | Legacy unanchored rows above the target, **epoch pending** (the deadlock) | neutralize: retain + mark, ack, resume | `TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates`; **live:** `TestPendingEpochWithUnanchoredHistoryHasATerminatingTransition` |
| 2b | Legacy unanchored rows, **no epoch pending** | adopt anchors, so a later reorg takes the proof path | `TestPollerAdoptsAnchorsForLegacyUnanchoredRowsThenCanRepair`, `TestPollerAnchorAdoptionRefusedWhileEpochPending` |
| 3 | **Every** probe fails | refuse, delete nothing, retry; recovered probe then repairs | `TestPollerRewindRefusesWhenAnchorVerificationIsUnavailable` |
| 4 | **Some** probes fail, nothing matches | refuse; resume point NOT lowered past the unproven anchors | `TestPollerRewindRefusesWhenSomeProbesFailWithoutAMatch` |
| 5 | **Mixed: failure then a lower match** (the finding) | refuse; on recovery the NEWER anchor verifies and nothing is deleted | `TestPollerRewindRefusesWhenANewerProbeFailedAndALowerAnchorMatches` |
| 6 | Canonical anchor **below a page boundary** | page deeper across Steps, delete nothing mid-verification, then retain to the verified floor | `TestPollerRewindPagesAnchorProbesAcrossStepsWithoutDeleting` |
| 7 | **Interleaved walker rewind** — a deeper epoch arrives mid-verification | the verified floor stands against the deeper target; nothing at or below it is lost | `TestPollerRewindHandlesADeeperEpochArrivingMidVerification` |
| 8 | Every anchor probed and mismatched, **anchors cover every row** | delete above the target — each row is PROVEN replaced | `TestPollerRewindDeletesWhenEveryAnchorIsProvenOrphaned` |
| 9 | A floor verifies but **unanchored rows sit above the boundary** | neutralize the suffix; the verified floor's history keeps its validity | `TestPollerRewindNeutralizesWhenAVerifiedFloorLeavesUnanchoredRowsAbove`; **live:** `TestNeutralizationHonoursAVerifiedFloor` |
| 10 | Happy path: a verified anchor with complete proof above it | retain at/below, delete only the orphaned suffix | `TestPollerRewindRetainsRowsBelowVerifiedAnchor` |

Cases 3–5 are the partial/mixed axis the brief demands: 3 is total failure (the easy case wave 3
covered), 4 is partial failure with no match, 5 is partial failure **with** a match — the one the
bug lived in. Cases 4 and 5 both additionally assert that the paging resume point did not move,
because a refusal that silently skipped past the unproven anchors would reproduce the same loss
one Step later.

### The deadlock case space

| # | Transition | Can it clear the epoch? | Test |
|---|---|---|---|
| D1 | `ApplyPolledPrices` while unacked | no — refused with `ErrUnackedReorgEpoch` | **live:** `TestPendingEpochWithUnanchoredHistoryHasATerminatingTransition` step 1 |
| D2 | `AdoptPollAnchor` while unacked | no — refused; adoption is gated on the very epoch repair is trying to clear | **live:** same test, step 1 |
| D3 | Repair with proof available | yes, by rewinding to a verified floor | `TestPollerAdoptsAnchorsForLegacyUnanchoredRowsThenCanRepair`; live: `TestNeutralizationHonoursAVerifiedFloor` for the boundary arithmetic |
| D4 | Nothing owned above the effective target | yes, ack with an empty deletion | live: `TestPriceRepairExposureReportsTheBoundaryAndWhatIsAboveIt` |
| D5 | Unprovable rows above the target | yes, by neutralizing — the transition that did not exist | **live:** same test, step 3; `/readyz` and resumption asserted |
| D6 | After the exit: ingestion resumes | — | **live:** same test, step 4 (`ApplyPolledPrices` succeeds against the store that refused in D1); fake-level: step 2 of `TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates` |
| D7 | After the exit: a LATER reorg is repairable by proof | — | `TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates` step 3 |
| D8 | A neutralized row is not deleted by a later rewind, and does not veto a later proven deletion | — | **live:** `TestRewindRetainsNeutralizedRowsAndDeletesTheRest` |
| D9 | A fresh observation at a neutralized identity does not wedge the writer | — | **live:** `TestFreshObservationSupersedesANeutralizedRow` |

### No test depends on a store transition Postgres cannot perform

Confirmed, and here is how it is enforced rather than asserted:

- **The offending line is gone.** Wave 3's `st.unacked = false` in
  `TestPollerAdoptsAnchorsForLegacyUnanchoredRowsThenCanRepair` has been removed.
  `grep -n "unacked = false" internal/prices/*_test.go` now matches exactly two code lines, both
  inside the fake store itself: `RewindPrices` (`prices_test.go:363`) and
  `NeutralizeUnverifiablePrices` (`prices_test.go:558`) — the two store calls that advance
  `acked_epoch` in Postgres. No **test body** clears the flag; test bodies only ever set it
  `true`, which is what a walker rewind legitimately does. The transition can therefore no longer
  be fabricated: it happens only where the real store makes it.
- **Every state-machine claim is pinned against Postgres.** The whole deadlock cycle — including
  the two transitions that *cannot* clear it — is driven through the real store in
  `internal/store/prices_repair_test.go`, which also pins that `ApplyPolledPrices` genuinely
  works afterwards. The fake-level poller test pins only *which outcome the poller selects from
  which evidence*, i.e. orchestration, and every store effect it relies on has a live counterpart
  in the table above.
- **The fake was made more faithful in three further places**, each because a lie there could
  hide a defect: `RewindPrices` retains marked rows exactly as the real `DELETE` predicate does;
  `commit` supersedes a marked row instead of treating it as an idempotent replay (a fake that
  replayed could not reproduce the divergence wedge that arm prevents); and
  `effectiveRewindTarget` is now the single place the fake computes the boundary, so
  `RewindPrices`, `NeutralizeUnverifiablePrices` and `PriceRepairExposure` cannot disagree about
  where it is — which was precisely the disagreement that made the real state undecidable.
- **`raw_logs.ingested_at` is never zero in the fake**, because the column is `NOT NULL`: a fake
  returning the zero time would model a row the database cannot hold. `storedLogs()` stamps it
  once and writes the stamp back, so every later read of the same log sees the same instant —
  which is the property the timestamp verdict depends on. The only way to get an unstamped log is
  an explicit `logsWithoutIngestionTime` flag, used by exactly one test whose subject is the
  guard against that impossible row.
- **No test asserts a harmful outcome as intended.** The wave-1 test that asserted
  `require.Empty(t, st.rows, "…this loss is real")` was removed in wave 3; nothing in this wave
  asserts a deletion that is not backed by named evidence in the same test, and the two tests
  that document limits (`…AcceptsSmallClockSkewButCapsFreshnessAtIngestion`,
  `…RefusesAnswerWithNoDurableIngestionTime`) both assert the safe behaviour.

### Where the coverage is still thinner than it could be, stated rather than implied

- The `frontier_lag` and `no_progress` passes are tested at the function level against a fake
  progress reader, not through `run()`. `run()` has no seam for a full-daemon test (it dials
  chains and binds a socket), which is why those passes were extracted in wave 3; the store reads
  they depend on have their own live tests.
- `TestPollerRewindHandlesADeeperEpochArrivingMidVerification` moves the epoch target between
  Steps, not between `PriceRepairExposure` and `RewindPrices` within one Step. The latter cannot
  happen under the enforced single-writer contract (D-004) — the walker and the poller run
  sequentially in one goroutine — and `PriceRepairExposure`'s doc says that is what its
  consistency rests on.

---

## Documentation honesty

Every claim touched was re-checked against the code. Corrected this wave:

- **`internal/prices/prices.go`** — the "REPAIR FAILS CLOSED" paragraph said repair refuses on
  no-anchor and all-orphaned states. Both are false now. Replaced with the three-behaviour
  description (delete on proof / retry on unavailable / neutralize on impossible), plus an exact
  "what is actually deleted" and a separate "what is still lost" (the *usability* of a
  neutralized row, not its existence).
- **`internal/store/prices.go`** — `pollAnchorRetention` claimed losing anchors "degrades that
  depth to the conservative walker target, exactly the pre-anchor behaviour". That would be a
  deletion; it is now a neutralization. Corrected. `CountOwnedPricesAbove`'s doc no longer claims
  repair reads it (repair reads `PriceRepairExposure`); it is described as the single-question
  read it is.
- **`internal/prices/feed.go`** — the "no process clock may become a receipt time" paragraph
  described only the clamp defect. It now names both prior failures, including that refusing
  against `f.now()` was durable *only while wall-clock stayed behind the claimed time*.
  `futureTimestampTolerance`'s "disclosed cost" (up to 2 minutes of suppressed staleness) is
  **deleted**, because the cap removed it — the comment now says so and says why.
- **`cmd/indexer/health.go`** — `/readyz`'s list gained the two new gates, and gained an explicit
  "what it does not claim": readiness means inside every named bound, not "exactly current".
  `conditionNoProgress` now describes both shapes of no-progress it covers, since the
  snapshotter has no cursor.
- **Wave 3's not-ready-until-chain-head claim is not restated anywhere.** The Frontier section
  above describes what the code does: a distance comparison against the durable minimum ingest
  cursor, with a named bound.

Claims deliberately weakened rather than kept: `NeutralizeUnverifiablePrices` originally said
"there is no un-neutralize, because there is no fact that would justify one" — false, because the
supersede arm restores usability on a fresh observation. It now says there is no un-neutralize on
*re-interpretation*, and names the one path that does restore it. `classifyUpdatedAt` originally
said the verdict is identical "forever"; it now states the one thing that changes it (rewind and
re-ingestion) and why that is a new durable fact rather than a clock drifting.

---

## Deviations

1. **No migration `00006`.** None was needed. Neutralization reuses `prices.valid` /
   `invalid_reason` from migration `00005` (its CHECK constraints are satisfied: a row marked
   invalid carries a non-empty reason, and `NOT valid OR price > 0` is vacuous for an invalid
   row); the durable observation time is `raw_logs.ingested_at` from `00001`; sweep progress is
   `sweep_generations` + `snapshot_sweeps` from `00004`/`00003`. `00001`–`00005` are untouched.
2. **The deadlock took BOTH of Codex's options, not one.** Codex offered "ack only after proving
   no owned rows exist above the effective epoch target" **or** "an explicit durable
   adoption/recovery workflow". The first alone leaves the realistic shape (legacy rows *above*
   the target) still unclearable, so both are implemented; the second is
   `NeutralizeUnverifiablePrices`. It is automatic rather than operator-gated, which is a
   deviation in kind from "workflow": an operator-authorised variant would need a new table and
   would leave price ingestion down until someone acted, and neutralization achieves the same
   safety (nothing deleted, nothing unprovable readable) without the outage.
3. **`floorAllOrphaned` became a DELETION path** (`floorProvenOrphaned`) where the anchors cover
   every row, reversing wave 3's documented "operator hand-off". This is a behaviour change
   beyond the literal finding, taken because that refusal was the same fail-forever defect Codex
   found in the legacy case, and because the evidence for deletion was already in hand.
4. **`store.CountOwnedPricesAbove` is retained but no longer used by the poller.**
   `PriceRepairExposure` supersedes it (it also needs the effective target and the unanchored
   count in one instant). It kept its live contract test; its doc no longer claims repair reads
   it.
5. **`RawLog` gained a read-only field.** `IngestedAt` is populated on reads and ignored on
   writes (the column default assigns it). `TestRawLogsInRangeFiltersAndOrders` compared whole
   structs, so it now asserts the field is present and zeroes it before the identity comparison.
6. **`frontier_lag` makes `/readyz` red during backfill**, like the existing `head_lag` and
   `rpc_ingest_lag`. Behaviour change for a fresh deploy, consistent with the posture already
   there.
7. **No new environment variables or config keys.** Every new bound is a named constant with its
   justification in the comment. `.env.example` untouched, as instructed;
   `SOLVENT_HEALTH_ADDR` stays documented in `internal/config/config.go`.
8. **Not committed.** 13 modified files plus one new test file are staged-ready but uncommitted,
   left to the controller, alongside this report. No pre-commit gate was hit or bypassed.

## Files changed

```
cmd/indexer/health.go              cmd/indexer/health_test.go
cmd/indexer/main.go
internal/prices/feed.go            internal/prices/feed_test.go
internal/prices/poller.go          internal/prices/poller_test.go
internal/prices/prices.go          internal/prices/prices_test.go
internal/store/derive.go           internal/store/derive_support_test.go
internal/store/prices.go           internal/store/store.go
internal/store/prices_repair_test.go   (new)
.superpowers/sdd/task-8-wave4-report-p2.md (this file)
```

Nothing under `roadmap/**`, no migration added or edited, no `.env.example`.
