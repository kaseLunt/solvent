# Task 8 — fix wave 8 report: price-pipeline unit (A1, under D-012)

- **Base:** `1da0fa4` — **Commit:** `92d21c5` (+ one comment-only follow-up, see §9)
- **Scope touched:** `internal/prices/**`, `internal/store/prices*.go`, `.superpowers/sdd/**` only.
- **No migration.** R5 was answered by transition-driven accounting, not by an index; `00006`
  was not created. Reasoning and evidence in §5.
- **Removal wave.** Repair path is **net −97 non-comment lines** across the three production
  files (§8).

---

## 0. What changed governing-wise, and why the shape of this wave differs

D-012 supersedes D-011 by reclassifying the data rather than by fixing machinery. Polled
prices are 60-second **samples**; the sampling already has holes the system tolerates with no
makeup mechanism; a wrongly-neutralized row is observationally one of those holes, differing
only by carrying *more* (its value and its recorded block hash both survive). So:

- the **online** revalidation subsystem is removed — it hosted both of round 7's criticals;
- **prevention** is strengthened where the decision allows it (the endpoint-count rule);
- **provenance** is retained forever so an *offline* tool remains possible at zero cost;
- **visibility** stays, but may no longer cost an aggregate per cadence interval.

Every clause citation below is to D-012.

---

## R1 — the online revalidation subsystem is gone (clause 3)

**Removed, in full:**

| Symbol | Where |
|---|---|
| `store.NeutralizedPriceAnchor` (type) | `internal/store/prices.go` |
| `store.NeutralizedPriceAnchors` | `internal/store/prices.go` |
| `store.RevalidateNeutralizedPrices` | `internal/store/prices.go` |
| `Poller.revalidateNeutralized` | `internal/prices/poller.go` |
| `revalidationPerStep` (const) | `internal/prices/poller.go` |
| the `p.revalidateNeutralized(ctx)` call in `Step` | `internal/prices/poller.go` |
| the per-Step backlog-drain scheduling | `internal/prices/poller.go` (see R5) |
| the two `PollStore` method declarations | `internal/prices/prices.go` |
| the two fake implementations + `revalidated` / `revalidateErr` / `neutralizedAnchorsErr` | `internal/prices/prices_test.go` |

**Both criticals dissolve with it.** Round 7's circular provenance was `applyPrices` inserting a
current-chain anchor that `NeutralizedPriceAnchors` would then associate with older marked rows;
with no consumer of that association, there is nothing to be circular *about*. The starvation
was the oldest-eight queue; there is no queue.

**Preserved exactly as instructed, and re-commented rather than re-worked:**

- `NeutralizeUnverifiablePrices` itself (its text changed — R6 — its behaviour did not, except
  for the anchored/unanchored split which is additive);
- `insertPrice`'s supersede arm. It is now the **only** thing in the running system that clears
  the marker, and the doc says so in those words;
- `PollStore` carrying no deletion primitive, and its reflection test — extended, not replaced;
- the `(endpoint, height)` fake-chain harness — untouched;
- endpoint-coherent passes ending at the first failed probe — untouched.

**One gate that could have been mistaken for revalidation machinery, and was kept.**
`AdoptPollAnchor`'s refusal at a neutralized height, and `UnanchoredPriceBlocks`' matching
exclusion, arrived with D-011 clause 6 and **outlive it**. The hazard was never in the consumer:
it is in writing an anchor the round never witnessed at a height whose anchor clause 2 now
retains *forever* as the input a future offline check would trust. Deleting the gate with the
pass would have re-opened it silently. Both halves stay, and both docs now say why.

---

## R2 — structural rejection of `RewindPrices` for poll-owned engines (clause 1)

**The enforcement.** `store.RewindPrices` refuses any engine in `store.PollOwnedEnginePrefix`,
**before the chain binding and before the transaction opens**:

```go
if IsPollOwnedEngine(engine) {
    return fmt.Errorf("%w: engine %q owns rows read from `latest` at a block that has passed,
        and this call would additionally delete the poll anchors D-012 clause 2 retains as
        their permanent provenance. …", ErrPollOwnedRewindRefused, engine)
}
```

Three deliberate choices:

1. **The constant lives in the store**, and `internal/prices`' `cursorPrefixPoll` is now
   `store.PollOwnedEnginePrefix`. A refusal keyed on a string the *calling* package owned would
   be a convention that the next edit can drift out of; deriving the poller's key from the
   store's constant makes "the key rows are written under" and "the key the store refuses to
   rewind" the same string by construction.
2. **The refusal is on the identity, not the arguments.** There is no target, floor or chain for
   which deleting a poll-owned engine's rows is correct, so no argument shape reaches the body.
   Pinned across three shapes in the test, including the vacuous ones.
3. **It fires before anything else.** `RewindPrices`' anchor sweep carries no
   neutralized-height exemption (unlike `pruneOldPollAnchors`), so a late refusal would have
   satisfied clause 1 while defeating clause 2. The test asserts anchors survive, not just that
   the call errors.

**Repository tests fixed.** Twelve `RewindPrices` call sites used poll-engine identities — the
[medium] Codex found, present in this repo's own tests. Each was resolved one of two ways:

| Test | Resolution |
|---|---|
| `TestApplyPricesEpochGate` | acks via `NeutralizeUnverifiablePrices` (the identity's only primitive) |
| `TestPruneAckedReorgEpochsWaitsForPriceCursor` | same |
| `TestRewindPricesDeletesRetiredPhaseRowsByOwner` | the poll writer acks via neutralization; the assertion now shows the two writers leaving **different** states from one epoch (feed deletes, poll retains-and-marks) |
| `TestRewindPricesLowersToDeepestUnackedEpoch` | new `testFeedEngine10` identity |
| `TestRewindPricesChainMismatch` | `testFeedEngine10` |
| `TestRewindPricesWithNoOwnedRowsStillAcks` | `testFeedEngine10` |
| `TestRewindPricesVerifiedFloorRetainsProvenHistory` | `testFeedEngine10` |
| `TestRewindPricesWithZeroFloorDeletesEverythingAboveTheTarget` | `testFeedEngine10` |
| `TestRewindPricesRefusesFloorAboveTarget` | `testFeedEngine10` |
| `TestRewindPricesFloorNeverLowersTheTarget` | `testFeedEngine10` |
| `TestLatestPriceFreshnessFollowsRewind` | `testFeedEngine10` |
| `TestFreshObservationSupersedesANeutralizedRow` (foreign-owner leg) | `testFeedEngine10` |

**The fake was hardened too.** `fakePriceStore.RewindPrices` now models the refusal. It is not
on `PollStore`, so the poller cannot reach it — but the fake is shared with the feed deriver's
tests, and a fake that happily rewound a poll engine is exactly how this defect survived six
review rounds inside the repository's own tests.

**Consequence I am flagging rather than acting on.** `verifiedFloor` was introduced for the
poller's anchor path and now has **no production caller** — the feed deriver passes 0. I kept
the parameter (the arithmetic is still correct for any hash-verifying caller, and removing a
public parameter is a larger change than clause 1 asks for) and corrected its doc, which
previously described it as "the poller's anchor path". Its tests now run under a non-poll
identity for the same reason. If round 8 prefers it removed, that is a one-wave change.

---

## R3 — anchor retention audited on every path (clause 2)

The audit is exhaustive because the surface is small: `grep` for `DELETE FROM price_poll_anchors`
across the repository returns **exactly two** production sites, plus one test `TRUNCATE`.

| Path | Status |
|---|---|
| `pruneOldPollAnchors` | exempts heights carrying a marked row (wave 7). Pinned: `TestPollAnchorRetentionExemptsNeutralizedHeights`. Mutation M3. |
| `RewindPrices` | now structurally unreachable for the only engine class that produces marked rows (R2). Pinned: `TestRewindPricesRefusesAPollOwnedEngineAndChangesNothing` asserts anchors survive the refusal. Mutations M1, M2. |
| `NeutralizeUnverifiablePrices` | does not delete (wave 7). Pinned: `TestNeutralizationRetainsAnchorsAboveTheBoundary`. |
| `derive_test.go`'s `TRUNCATE` | test fixture reset; not a production path. |
| migration `00005` down-migration `DROP TABLE` | schema teardown; not a runtime path. |

**A correction I owe the record.** Wave 7 called the prune exemption **self-limiting**: a
revalidation or a fresh observation would clear the marker and hand the anchor back. That was
true while an online revalidation could clear *any* height. It is now false, and the test found
it rather than my reasoning: my first attempt at the "release" leg tried to supersede the marked
row at block 1 after retention had passed, and the store refused with `ErrDeriveCursorRegression`
— the cursor's monotonic guard forbids a batch below the cursor. So for any height the head has
passed, the classification and its anchor are **permanent by construction**.

I turned that failure into the specification. The test now asserts the refusal, and
`pruneOldPollAnchors`' doc says the standing cost is one anchor row per classified height,
forever, growing with reorg frequency and not bounded in principle — the accepted cost clause 2
names, stated honestly instead of as a self-limiting story.

---

## R4 — the endpoint-count rule (clause 4)

**≥2 configured ⇒ agreement mandatory, fail closed.** `corroborate` returns
`agreementUnavailable` for an unreachable peer or a failover walk that wraps back to the primary,
and `checkpointCorroborated` refuses on it (`blockRepairOnAgreement` → `ConditionPollRewindBlocked`,
epoch unanswered, nothing marked). The `agreementUnobtainable`-authorises-marking path is
**unreachable** for a multi-endpoint fleet on two independent grounds:

- `corroborate` only produces `agreementUnobtainable` for `EndpointCount() == 1`;
- `checkpointCorroborated` **re-checks the configured count at the decision site** and fails
  closed if it is not exactly 1, treating the mismatch as a code defect.

The redundancy is deliberate and is the thing that makes "≥2 configured can never mark
single-view" a property of the decision site rather than of a function two calls away. Mutation
M5/M5b measures exactly that (§7).

**Exactly 1 configured ⇒ single-view marking, WARN-logged with the height range.** The
disclosure is emitted in `Poller.neutralize` rather than at the gate, because that is the first
point that knows *what* was classified:

```
SINGLE-VIEW CLASSIFICATION: … (D-012 clause 4 ratifies this trade for a one-endpoint
deployment; with two or more configured the same state fails closed instead) …
  heightRangeMarked="(4000, 5000]"  rowsMarked=1  endpointsConfigured=1  endpointRelied=0
```

**0 configured ⇒ fail closed.** Wave 7 tested `c <= 1`. Zero is not one: there is no view to be
single, and a poller that can reach no chain at all is a misconfiguration, not permission.
`corroborate` now returns `agreementUnavailable` for `c < 1`, and the decision-site re-check
independently refuses. This is a genuine behaviour change, not tidying.

**The distinction is configured, not reachable, count** — asserted directly:
`TestPollerFailsClosedWhenTheOnlyOtherEndpointIsUnreachable` configures two endpoints, downs
one, and shows a perfectly coherent, checkpointed pass marking **nothing**, with the
single-view disclosure explicitly absent.

---

## R5 — cheap gap visibility (clause 6)

**Chosen: transition-driven recomputation. Not an index; no `00006`.**

With the per-Step drain gone, `NeutralizedPriceStats` can only change on three events, so those
are the only three callers:

| Caller | Why it is the complete set |
|---|---|
| hydration | a restart must report the accumulated pile, not zero |
| after `NeutralizeUnverifiablePrices` | the only thing that raises the count |
| after a round whose `ApplyResult.Superseded > 0` | the only thing that lowers it |

`Superseded` is **new**, and it is the load-bearing part: it is set by `insertPrice`'s supersede
arm and counted in `applyPrices`, so the poller asks "did the database just change the number?"
rather than "might it have?". Deriving it from what the store *did* — rather than from the shape
of what the caller *submitted* — is the same discipline `ApplyResult.Inserted` already enforces
for health.

**Why this and not the index.** Round 7's objection was that the cost "depends on total price
history, not backlog size", paid **every 60 seconds** while any backlog remains. An index makes
each scan cheaper; removing the cadence removes the recurring cost entirely, and leaves the
aggregate running only as often as the number actually moves — which in a healthy system after
one reorg is *never again*. That is a stronger answer to the stated objection, and it needs no
schema change. (The partial index remains available to a future wave if the *event* cost ever
matters; it does not today, because a neutralization is a rare operator-visible event and a
supersede requires the head to still be at a classified height.)

**Measured, not asserted.** `TestPollerDoesNotRecountTheBacklogOnAnOrdinaryRound` drives three
ordinary landed rounds against a **non-empty** backlog and asserts `neutralizedStatsCalls == 1`
(hydration only) — while still asserting the count and highest block are reported, so frugality
cannot pass as silence. Its sibling asserts `== 2` when a supersede lands. Mutation M8 restores
wave 7's rule and the first test dies.

I did not run `EXPLAIN ANALYZE` at projected table size. It is not the evidence this choice
needs — the claim is about call *frequency*, not per-call cost — but it is an honest gap if
round 8 wants the per-event cost characterised. Listed in §10.

---

## R6 — honest operator text (clause 7)

**`NeutralizeUnverifiablePrices`' WARN**, which round 7's [low] was about, now:

- describes the classification as **PERMANENT in the running system**, naming clause 3 and the
  one thing that clears it (a current poll at the same height, reachable only while the head is
  there);
- reports **`rowsAnchored` and `rowsUnanchored` separately**, with a one-line gloss of what each
  means for a responder ("an offline check could still settle these" vs "nothing — online or
  offline — can ever settle them");
- says provenance is retained forever and an offline reconciliation *remains possible*, then
  says plainly **"no such tool is built"**;
- no longer asserts the unanchored story ("no poll anchor covers this observation… no later
  repair can verify them") for a call that is also used on anchored suffixes.

The split is computed **inside the marking UPDATE** (a `WITH marked AS (UPDATE … RETURNING
block_number)` CTE), so the two counts describe exactly the rows *this call* changed rather than
the standing pile. Mutation M11 makes it describe the pile instead, and the test dies.

**Package docs rewritten to D-012 reality:** `internal/store/prices.go`'s header (a new "WHAT THE
MARKER MEANS SINCE D-012" section), `internal/prices/prices.go`'s header (a new "WHAT A MARKING
MEANS (D-012)" section), `PollStore`'s doc, `PriceStore`'s deletion note, `poller.go`'s header
bullet, `neutralize`, `refreshNeutralizedBacklog`, `pruneOldPollAnchors`, `NewestPollAnchor`,
`NeutralizedPriceStats`, `UnanchoredPriceBlocks`, `AdoptPollAnchor`, `corroborate`,
`checkpointCorroborated`, `blockRepairOnAgreement`, `pinProbeEndpoint`, `repair`, `RewindPrices`.
No remaining text promises online recovery; `grep` for `revalidat` in production files returns
only (a) the *checkpoint re-validation* sense, which is a different mechanism, and (b) three
lines that explicitly record the removal.

**The poller's own WARNs** were updated to match: `refreshNeutralizedBacklog` says "RETAINED BUT
PERMANENTLY UNUSABLE… (D-012 clause 3)", and the drain-to-zero message no longer offers
revalidation as one of two causes, because only one remains.

---

## R7 — tests, with the clause each one enforces

**Removed with their subject (5 top-level).**

| Test | Subject removed |
|---|---|
| `TestPollerRevalidatesAPastHeightWithoutAnotherPollThere` | `Poller.revalidateNeutralized` (clause 3) |
| `TestPollerLeavesARevalidationCandidateMarkedWithoutAgreement` | corroboration *of a restore* |
| `TestPollerCannotRevalidateAMarkedHeightWithNoSurvivingAnchor` | the candidate list's anchor JOIN |
| `TestRevalidationRestoresOnlyOnTheRecordedAnchorHash` | `store.RevalidateNeutralizedPrices` |
| `TestNeutralizedPriceAnchorsJoinMarkedRowsToSurvivingProvenance` | `store.NeutralizedPriceAnchors` |

**Added (6 top-level), each with its citation.**

| Test | Clause it enforces |
|---|---|
| `TestRewindPricesRefusesAPollOwnedEngineAndChangesNothing` | **clause 1** ("the store must structurally reject `RewindPrices` for poll-owned engines") **+ clause 2** (the refusal must not have already expired the anchors) |
| `TestStoreHasNoOnlineRevalidationPrimitive` | **clause 3** ("online revalidation is removed"), structurally — the two removed methods named so a re-introduction fails here |
| `TestNeutralizationReportsAnchoredAndUnanchoredMarkingsDistinctly` | **clause 7** ("anchored and unanchored classifications reported distinctly") |
| `TestPollerFailsClosedWhenTheOnlyOtherEndpointIsUnreachable` | **clause 4** ("the distinction is configured count, not reachable count — two configured with one reachable is a fault and fails closed") |
| `TestPollerFailsClosedOnAFleetWithNoEndpointsConfigured` | **clause 4** ("with exactly one endpoint configured" — zero is not one) |
| `TestPollerDoesNotRecountTheBacklogOnAnOrdinaryRound` | **clause 6** ("the stats surface must be cheap — its cost may not scale with total price history") |

**Renamed and re-specified (3), each with its citation.**

| Before → after | Clause it now enforces |
|---|---|
| `TestNeutralizationRetainsAnchorsAboveTheBoundaryForRevalidation` → `…AboveTheBoundary` | **clause 2** (anchors survive) **+ clause 3** (re-running changes nothing; both anchored and unanchored rows stay classified) |
| `TestRewindRetainsNeutralizedRowsAndDeletesTheRest` → `TestNeutralizedRowsAreNotHistoryAtRiskForALaterRepair` | **clause 1** made the old subject unreachable; the surviving property is that a retained row is invisible to the exposure reads and cannot veto a later proven repair |
| `TestPollerMarksOnAOneEndpointFleetAndDisclosesTheMissingAgreement` → `…AndDisclosesTheHeightRange` | **clause 4** (ratified single-view marking, WARN naming the height range) **+ clause 3** (the second leg now asserts the classification STANDS after the chain reports the recorded block again — the inverse of what it asserted last wave) |

**Kept, re-commented to cite the clause instead of the removed mechanism.**

| Test | Clause |
|---|---|
| `TestPollAnchorRetentionExemptsNeutralizedHeights` | **clause 2**, verbatim ("no retention bound, prune, or rewind may expire an anchor belonging to a neutralized height") — plus **clause 3**, now asserted through the store's cursor-regression refusal (see R3) |
| `TestPollerExposesTheNeutralizedBacklog` | **clause 6** (gap visibility) + **clause 3** (asserts the WARN says "PERMANENTLY UNUSABLE" and names clause 3) |
| `TestPollerNeutralizedBacklogSurvivesAndIsRefreshedByANewerRound` | **clause 6**, both halves: the count survives the acute recovery *and* the recount was earned (call count = 2) |
| `TestFreshObservationSupersedesANeutralizedRow` | **clause 3**'s sole exception + **clause 6** (`ApplyResult.Superseded` reported, and a later plain replay reports zero) |
| `TestPendingEpochWithUnanchoredHistoryHasATerminatingTransition` (adoption leg) | **clause 2** — the adoption gate outlives the pass it arrived with, because the hazard is the fabricated anchor, which is permanent |
| `TestUnanchoredPriceBlocksSkipsNeutralizedHeights` | **clause 2**, same argument on the query side |
| `TestPollStoreHasNoDeletionPrimitive` | **D-010 clause 1** (unchanged) + **clause 3** extension: the two removed methods must not be on `PollStore` either, and `NeutralizedPriceStats` must remain (clause 6) |
| `TestNeutralizationHonoursAVerifiedFloor`, `TestNeutralizedPriceStatsCountsOnlyReorgMarkedRowsOfOneEngine`, `TestPollerRefusesToMarkWhenASecondEndpointContradictsThePass`, and the rest of the anchor-verification suite | unchanged in substance; the contradiction test is clause 4's other half |

**Out of scope, untouched as instructed:** the wave-5-era snapshot test expecting `Ready=true`
with failures (health surface, wave 9).

---

## 8. Mutation verification — 12 mutations, 11 killed, 1 survived by design

Every mutation was applied to the **committed** tree `92d21c5`, one target test run, then the
file restored **byte-for-byte from an in-memory snapshot** — never `git checkout --`.
`git diff --quiet` exits **0** after the run (asserted by the harness itself).

Each row states the **property** the mutation validates, because a killed mutation on its own
only certifies current behaviour. The property is the clause; the mutation shows the test is
load-bearing on it.

| # | Mutation | Target | Observed failure | Property validated |
|---|---|---|---|---|
| **M1** | remove the poll-owned guard from `RewindPrices` entirely | `…RefusesAPollOwnedEngineAndChangesNothing` | `Target error should be in err chain: expected "price rewind refused: this engine is poll-owned…"` | **Clause 1**: no store path may delete a poll-owned engine's rows. Interface omission is not enforcement. |
| **M2** | discriminate on an exact engine string instead of the namespace prefix | same | same failure | **Clause 1**: the discriminator is the NAMESPACE, matching how `PollCursorEngine` builds keys — an identity-exact check lets every real poll engine (`prices:poll:10`, `prices:poll:1`) straight through. |
| **M3** | drop the neutralized-height exemption from `pruneOldPollAnchors` | `TestPollAnchorRetentionExemptsNeutralizedHeights` | `Not equal: expected 0x1` — "the neutralized height's anchor outlives the retention bound" | **Clause 2**: a retention bound may not expire the anchor of a classified height. Otherwise the offline option closes quietly, days later. |
| **M4** | restore wave 7 exactly: `c <= 1` is unobtainable **and** no re-check at the decision site | `…FailsClosedOnAFleetWithNoEndpointsConfigured` | `Should be false` (i.e. the epoch was answered) | **Clause 4**: single-view marking is permitted with **exactly one** endpoint configured. Zero configured is a misconfiguration; treating it as permission marks history on nobody's word. |
| **M5** | treat an UNREACHABLE peer as unobtainable agreement (reachable count, not configured count) | `…FailsClosedWhenTheOnlyOtherEndpointIsUnreachable` | **SURVIVED** | see below |
| **M5b** | M5 **and** remove the decision-site configured-count re-check — both guards gone | same | `Should be false` | **Clause 4**: "the distinction is CONFIGURED count, not reachable count". With both guards removed the fault path marks, and the test detects it — so the test is load-bearing on the property and M5's survival is redundancy, not blindness. |
| **M6** | drop the range-naming single-view disclosure from `neutralize` | `…MarksOnAOneEndpointFleetAndDisclosesTheHeightRange` | `Should be true` — "the concession is never silent (D-012 clause 4: log at WARN…)" | **Clause 4**: the ratified trade is *disclosed* marking, not silent marking. An undisclosed concession is not the one the decision ratified. |
| **M7** | authorise the single-view marking but do not flag it AS single-view | same | same failure | **Clause 4**: the disclosure is bound to the arm that *authorised* the act, not re-derived at the log site from the endpoint count — which would report on a fleet of one even when agreement was genuinely obtained. |
| **M8** | restore the wave-7 recount rule (re-read after every landed round while a backlog exists) | `…DoesNotRecountTheBacklogOnAnOrdinaryRound` | `Not equal: expected 1` — "three landed rounds, zero recounts…" | **Clause 6**: the stats cost may not scale with total price history. One permanent row must not buy a full-history scan every cadence interval forever. |
| **M9** | stop reporting the supersede as a durable fact (`Superseded` stays 0) | `TestFreshObservationSupersedesANeutralizedRow` | `Not equal: expected 1` — "the store reports that this insert REPLACED a classified row" | **Clause 6**: the recount is keyed on what the DATABASE did, not on the caller's inference from what it submitted. Without it, frugality becomes a stale number. |
| **M10** | report one undifferentiated count, as wave 7 did | `…ReportsAnchoredAndUnanchoredMarkingsDistinctly` | `Not equal: expected int64(2)` — "the two rounds whose block hash this engine recorded are reported as anchored" | **Clause 7**: anchored and unanchored classifications reported distinctly, because a responder's next step differs between them. |
| **M11** | split the STANDING pile rather than the rows THIS call marked | same | `Not equal: expected 3` | **Clause 7**: the report must describe what this call did. Folding in earlier calls' work makes the number un-actionable during an incident. |

### M5 survived, and I am reporting it as evidence rather than hiding it

M5 makes `corroborate` classify an unreachable peer as `agreementUnobtainable`. The tests still
pass, because `checkpointCorroborated` **independently re-checks the configured count** and fails
closed when it is not exactly 1. So the mutant's *behaviour is still correct* — which is the only
honest reason a mutation may survive.

M5b removes both guards and the test dies immediately. Together they say precisely what I want on
the record: the fail-closed property is real and detected, and it is enforced twice on purpose,
so no single edit to `corroborate` can re-open round 7's [high] #4. I am flagging M5 explicitly
because a bare "12/12 killed" would have been the confidence-theatre the controller called out
after round 7.

---

## 9. Verification

```
go build ./...   OK
go vet ./...     OK
gofmt -l .       (no files listed — output READ, not just the exit code)
go test ./... -count=1
```

**498 top-level PASS / 576 incl. 78 subtests / 0 FAIL / 0 SKIP**
(baseline **497 / 575 / 0 / 0** at `8f0eeef`). Convention: "top-level" = `^--- PASS` at column 0.

**Full reconciliation of the +1:** −5 removed (R7 table) + 6 added (R7 table) = +1. Renames are
net zero. No test was disabled, skipped, or silently dropped.

`go test ./... -count=1 -race` in the `golang:1.24` container against live Postgres over
`host.docker.internal`: **all 9 packages ok, no races.**

No gate blocked anything: `control-plane doctor` reported **0 errors / 0 warnings / 2 info** and
`scope-gate: OK — 9 path(s)`. Staged by explicit pathspec; never `git add -A`.

**Line delta, repair path (non-comment lines):**

| File | Before | After | Δ |
|---|---|---|---|
| `internal/store/prices.go` | 861 | 806 | **−55** |
| `internal/prices/poller.go` | 917 | 877 | **−40** |
| `internal/prices/prices.go` | 365 | 363 | **−2** |
| **total** | 2143 | 2046 | **−97** |

Wave 7 was +221 on the same two main files; this wave gives back 95 of those and removes more
besides. The three small *additions* are `PollOwnedEnginePrefix`/`IsPollOwnedEngine`/
`ErrPollOwnedRewindRefused` (11 lines), `ApplyResult.Superseded` plumbing (6 lines), and the
anchored/unanchored CTE plus its disclosure (about 25 lines) — all of which are the "three small
fixes" D-012's Consequence section names.

**One comment-only follow-up after `92d21c5`:** `internal/store/prices_repair_test.go`'s
adoption-gate comment still named `RevalidateNeutralizedPrices`. Corrected to cite clause 2 and
to say explicitly that the gate outlives the pass it arrived with. No assertion changed.

---

## 10. Things I could not verify, and the costs I am choosing

1. **Wrongly-classified rows are now permanently unusable, and that is the decision, not a
   defect.** The residual scenario — deep reorg × every configured endpoint on the same wrong
   fork × the agreement gate passing — produces permanent sample gaps. D-012 accepts this
   (clause 3 + the "recovery is preserved, only its hot path is removed" section). I have not
   independently verified the decision's premise that every downstream consumer treats an absent
   sample and a classified one identically; I verified `LatestUsablePrice` filters on `valid`,
   and P3 consumers do not exist yet.
2. **No offline revalidation tool exists, and nothing in the code or the logs implies one is
   coming.** The retained provenance is an *option*, and every text that mentions it says "no
   such tool is built". If Task 9's backfill or a P3 reconciliation ever wants it, the inputs are
   on disk: `prices` rows carrying `InvalidReasonUnverifiableReorg` joined to
   `price_poll_anchors` on `(engine, chain_id, block_number)`.
3. **The prune exemption is unbounded in principle.** One anchor row per classified height,
   forever, growing with reorg frequency. Wave 7 called this self-limiting; §R3 explains why that
   was wrong and what replaced the claim. It is the same accepted cost D-010 named for the rows,
   now correctly described.
4. **R5's evidence is about call frequency, not per-call cost.** I did not `EXPLAIN ANALYZE`
   `NeutralizedPriceStats` at projected table size. The argument is that the aggregate now runs
   on transitions rather than on the 60-second cadence, which is what round 7's [medium]
   objected to; the per-event cost is unmeasured and would matter only if neutralizations became
   frequent. The partial index on `prices (chain_id, owner_engine, block_number) WHERE NOT valid`
   remains available to a later `00006`.
5. **`verifiedFloor` has no production caller.** Disclosed in R2. Kept, documented as such, and
   its tests moved to a non-poll identity. Removing it is a defensible follow-up I did not take.
6. **`RewindPrices`' `invalid_reason <> …` retention predicate is now defence in depth behind
   the identity refusal, and is untested.** No production engine that can reach `RewindPrices`
   produces classified rows, so the predicate is unreachable-in-production. I kept it (a future
   non-poll writer adopting neutralization would need it) and deleted the test whose subject it
   was, rather than keeping a test that pins implementation. Flagging it explicitly as a
   deliberate untested line.
7. **The zero-endpoint case cannot arise from `chain.Failover` today** (construction refuses an
   empty endpoint list). It is pinned anyway, because the guard's correctness must not rest on a
   precondition enforced two packages away.
8. **Two colluding endpoints still defeat clause 4.** Unchanged from wave 7, and now with no
   online undo behind it: the failure mode is a permanent sample gap, counted by clause 6. The
   code says this rather than claiming more.
9. **Not exercised against a real multi-endpoint RPC fleet.** All endpoint-count and
   corroboration evidence is against the `(endpoint, height)` fake, which models
   `Failover.doFrom`'s walk faithfully but is still a fake.
10. **No ripple into `cmd/indexer`.** Nothing there referenced the removed symbols
    (`grep` confirms), so no call-site removal was needed and the health surface was not touched.
11. **Untouched as instructed:** `cmd/indexer/health.go`, the readiness composition in
    `cmd/indexer/main.go`, lag bounds, `internal/store/derive.go`, `internal/ingest/walker.go`,
    `internal/snapshot/snapshot.go`, `roadmap/**`, `.env.example`, migrations `00001`–`00005`.
    Round 5's snapshot-readiness and timestamp-lag findings remain open for wave 9.

Returns to Codex for round 8 under D-006, with D-012 as governing context.
