# Task 8 — wave 10 report (round-8 fixes, prices unit)

- **Commits:** `c6d7267` (the seven fixes), `8b6c25d` (three gaps the mutation loop found in
  wave 10's own tests — see "the mutation loop found three of its own tests weak").
- **Base:** `331c0a6` (wave 9's landed HEAD when I started; wave 9 committed mid-session, so the
  base moved under me — see "concurrency").
- **Returns to:** Codex round 9 (prices unit) under D-006.

## Verification

Measured in a **clean worktree** at `8b6c25d`, because the shared working tree carries the
concurrent wave's in-flight edits (`cmd/indexer/main.go`, `internal/store/derive.go`, migration
`00008`), which fail their own not-yet-written tests.

| | top-level PASS | incl. subtests | FAIL | SKIP |
|---|---|---|---|---|
| Baseline `331c0a6` | 522 | 607 (85 sub) | 0 | 0 |
| **This wave `8b6c25d`** | **541** | **626 (85 sub)** | **0** | **0** |

+19 top-level tests. `go build ./...` and `go vet ./...` clean. `-race` clean in `golang:1.24`
via `host.docker.internal` (all nine packages).

**gofmt — read, and the output is a false positive worth explaining.** `gofmt -l` lists
`internal/prices/poller.go` and `internal/store/prices.go` in the shared worktree. It also lists
**every one of the 52 Go files** in a fresh `git worktree` checkout, including files no one has
touched this phase. The cause is `core.autocrlf`: git writes CRLF into the working tree, and
gofmt reports a CRLF file as entirely unformatted. The meaningful check is the **committed
blob**, and `git show HEAD:<file> | gofmt -l` is clean for all four files I authored or changed
(`poller.go`, `prices.go`, `prices_binding_test.go`, `poller_clause4_test.go`). One genuine
formatting defect did surface this way and was fixed: mis-indented comment continuation lines in
`poller_test.go`.

---

## F1 [critical][blocker] — the no-checkpoint arm is gated

**Change** (`internal/prices/poller.go`, `checkpointCorroborated`). The configured-count rule is
applied **before** the `!p.probeCheckpointSet` return: exactly 1 → proceed with `singleView=true`
(so `neutralize` emits the range disclosure); 0 or ≥2 → fail closed with a reason naming the
count. The doc comment that justified waving this arm through was deleted and replaced, because it
was the defect's real cause — it argued that a checkpointless pass "is the one state in which no
endpoint's chain view is being trusted at all", which conflates *consulting no endpoint* with
*every endpoint agreeing*, and it justified proceeding by observing that no anchor will ever appear
for those heights, which is the reason the rows are unprovable rather than a reason to act on them.

**A consequence I state rather than bury:** failing closed here leaves the reorg epoch unacked, so
repair re-runs every Step and **no price batch is admitted for that engine until an operator
intervenes**. My first draft of the comment claimed the refusal "strands them unmarked rather than
wedging ingestion" — that was false and I corrected it. Clause 4 prescribes exactly this outcome
("retain unmarked, repair blocked, readiness red — an operator-visible fault, never a marking"), and
D-012 records the production population of unanchored rows as zero, so the stall is the decision's
choice and is unreachable in production.

**Citing tests** (`internal/prices/poller_clause4_test.go`), all three against one shared
`noAnchorLegacyFixture` in which every configured endpoint is healthy and in agreement — so the
refusals can only come from the absence of a proof, never from a fork or an outage:

- `TestPollerRefusesToMarkUnanchoredLegacyRowsWithTwoEndpointsConfigured` [D-012 clause 4]
- `TestPollerMarksUnanchoredLegacyRowsOnAOneEndpointFleetWithTheDisclosure` [clause 4 + wave-8 R4]
- `TestPollerRefusesToMarkUnanchoredLegacyRowsWithNoEndpointsConfigured` [clause 4]

**Mutations.**

| ID | Property asserted | Result |
|---|---|---|
| M1 | *The configured-endpoint rule governs marking on **every** arm, including the arm that holds no proof at all.* Restore wave 8's `return true, false, ""`. | **Killed — all three arms die.** This is the coverage M5/M5b lacked: it validated only the checkpointed arm, so the mutation could pass while the blocker sat next to it. |
| M1b | *Zero configured endpoints is not clause 4's fleet of one.* Gate reads `c <= 1` (wave 7's shape). | **Killed** — only the 0-endpoint test dies, confirming the three cases are independently load-bearing rather than one assertion in triplicate. |

---

## F2 [high] — provenance bound per observation

**The design choice, justified.** I took Codex's **first** option (per-observation binding) and not
the minimum-acceptable alternative, and the brief asked me to say which and why.

The alternative — *refuse anchor creation while any unsuperseded neutralized row exists at that
height* — is **disqualified by its own consequence**, exactly as the brief anticipated. A
partial-revert round at a neutralized height H would then commit its rows with **no anchor at all**.
Those rows become unanchored collateral damage: `CountUnanchoredPricesAbove` counts them, the next
`verifyFloor` returns `floorUnverifiable` instead of `floorVerified`, and the following repair marks
the very rows the fresh round had just observed. The refusal converts one stale row's fabricated
provenance into an expanding population of genuinely unprovable *new* rows — it makes the problem
grow. So binding is required.

**Change.** Migration `00007` adds `prices.anchor_block BIGINT` (nullable, additive, **no
backfill**) plus a partial index `prices_anchor_binding_idx`. `applyPrices` records the anchor
first, then passes its block down to `insertPrice` for every row of the round, including the
supersede arm (a superseding observation is a new durable fact and takes *this* round's provenance).
A replayed anchor still binds — the anchor for that execution block was written by a real round and
`insertPollAnchor`'s divergence abort proves the hash still matches, so withholding the binding
would manufacture an unprovable row out of a provable round.

**What NULL means, written into the migration, the column COMMENT and the Go doc:**
`anchor_block IS NULL` = *"no anchor is known to vouch for this observation."* It explicitly does
**not** mean "vouched by whatever anchor sits at this height" — that inference is the fabrication,
and it is unavailable retroactively because whether a given pre-migration row's round also wrote an
anchor was never recorded. **No backfill is attempted, and the absence is the point:** the obvious
backfill (`anchor_block = block_number WHERE an anchor exists there`) would write the fabricated
binding permanently and invisibly. Pre-`00007` rows therefore all count as **unanchored**, which
understates the anchored side for existing history — failing toward unprovable is the only direction
that cannot invent a proof.

The neutralization split now asks the row's own binding (and requires the anchor to still exist, so
a dangling binding counts unanchored), which is what makes the WARN's gloss on `rowsAnchored` —
"the hash of the block that round executed against is on disk" — a true statement.

**Citing tests** (`internal/store/prices_binding_test.go`), all live-Postgres:

- `TestALaterPartialRoundAtANeutralizedHeightDoesNotVouchForTheOldRows` — partial revert [clause 2]
- `TestAnAllRevertRoundBindsOnlyTheRowsItActuallyObserved` — all-revert [clause 2]
- `TestNeutralizationSplitsAnchoredFromUnanchoredByTheRowsOwnBinding` — the discriminating fixture
- `TestAReplayedAnchorStillBindsThisRoundsObservations`
- `TestEventDerivedRowsCarryNoBindingBecauseTheyRecordNoAnchor`
- `TestMigrateAddsProvenanceBindingWithoutClaimingProvenanceForOldRows` — upgrade path from the
  pushed v5 baseline; asserts both legacy rows are NULL **including the one at an anchored height**

**Mutations.**

| ID | Property asserted | Result |
|---|---|---|
| M2 | *The reported split names a fact about the row's own round, not about its height.* Revert the split to the height-derived `EXISTS`. | **Killed** — but only after the test was strengthened; see below. |
| M2b | *A row's binding is written only when its own round witnessed an anchor.* In `insertPrice`, fall back to `anchorBlock = o.BlockNumber` when the round wrote none (the "obvious backfill", at write time). | **Killed — 4 tests die.** |

---

## F3 [high] — clause 2 on every store path

**Change, both halves.**

1. **Structural (matching R2's style):** `NeutralizeUnverifiablePrices` now refuses any engine
   outside `PollOwnedEnginePrefix` with the sentinel `ErrNonPollNeutralizeRefused`, before any read.
   The marking semantics are poll-specific by D-012's own framing — a polled row is a sample nothing
   can re-derive; an event-derived row is replayable from `raw_logs`, so marking it would retain an
   unreadable row where a correct one could simply be rebuilt. The two refusals are now exhaustive
   and disjoint: every identity has exactly one repair primitive.
2. **Defence in depth:** `RewindPrices`' anchor sweep carries the neutralized-height `NOT EXISTS`
   exemption. Wave 8 justified omitting it by the poll-owned refusal three hundred lines above —
   which was true as written and still made a clause-2 invariant hold by coincidence of a distant
   guard rather than by anything in the deleting statement. Round 8 found the second door open.

**Citing tests:** `TestNeutralizeRefusesANonPollEngineAndChangesNothing` (asserts the row, the
epoch **and** that the engine's real primitive still works, so the refusal is a routing rule and not
a dead end), `TestEveryEngineIdentityHasExactlyOneRepairPrimitive`, and
`TestRewindAnchorSweepSparesNeutralizedHeightsEvenThoughNoCallerCanReachThatState` — live Postgres,
per round 8's explicit request. That last test **constructs the state with direct SQL and says so in
its name and body**, because with the refusal in place no API sequence can produce it; a defence-in-
depth test should name the door it walked around rather than pretend the state is ordinary.

**Mutations.** M3a (remove the poll-owned restriction) → **killed, 2 tests**. M3b (drop the
exemption from the anchor sweep) → **killed, 1 test**.

---

## F4 [high] — incremental prune

**Change.** Migration `00007` adds `price_poll_anchor_prune (engine, frontier, updated_at)`.
`pruneOldPollAnchors` reads the frontier, computes the retention cutoff, and considers only
`[frontier, cutoff)` — normally one height per round. Below-frontier heights are settled.

**Why "settled" is a fact, not a hope:** the frontier only ever advances to the cutoff,
`pollAnchorRetention` anchors below the newest. Releasing an exemption needs the marker cleared;
the only clearer is `insertPrice`'s supersede arm; that needs a current poll at that exact height;
and the cursor's monotonic guard refuses any batch below the cursor. A height a full retention
window behind the cursor can never be superseded, so nothing below the frontier can become prunable.

**Two things I added because the premise can be violated, rather than assuming it:**

- A stored frontier **above** the current cutoff is impossible in a population it truly describes,
  so it is **discarded** (one full pass, with a WARN) instead of trusted. The check costs nothing —
  both numbers are already read — and it means the optimisation cannot silently stop deleting.
- `AdoptPollAnchor` is the one path that can write an anchor below the frontier (a legacy height),
  so it **lowers the frontier itself** with `LEAST`, keeping the invariant literally true rather
  than adding a caveat.

**EXPLAIN ANALYZE evidence** — the production statement (`prunePollAnchorsQuery`) under
`force_generic_plan`, with **300 permanently-protected anchors** below the frontier and a realistic
`prices` table (~4,750 rows):

```
Delete on price_poll_anchors a  (actual time=0.026..0.026 rows=0 loops=1)
  Buffers: shared hit=10
  ->  Nested Loop Anti Join  (actual time=0.022..0.023 rows=1 loops=1)
        ->  Nested Loop Anti Join  (actual time=0.016..0.017 rows=1 loops=1)
              ->  Index Scan using price_poll_anchors_pkey on price_poll_anchors a  (rows=1)
                    Index Cond: ((engine = $1) AND (block_number >= $2) AND (block_number < $3))
              ->  Index Scan using prices_owner_idx on prices p  (rows=0)
                    Index Cond: ((chain_id = a.chain_id) AND (owner_engine = $1) AND (block_number = a.block_number))
        ->  Index Scan using prices_anchor_binding_idx on prices p_1  (rows=0)
              Index Cond: ((chain_id = a.chain_id) AND (owner_engine = $1) AND (anchor_block = a.block_number))
Execution Time: 0.078 ms
```

**10 buffers, one row per node** — nothing scales with the 300 protected anchors.

**A correctness fix the evidence forced.** My first version wrote the exemption as one `NOT EXISTS`
with an `OR` across `block_number`/`anchor_block`. The plan showed a **Hash Anti Join whose inner
side materialised all 300 marked rows** — the per-round cost was still proportional to the all-time
classified-height count, just on the other side of the join. Splitting it into two `NOT EXISTS`
clauses makes each an indexed correlated lookup. Both clauses are required and not redundant: the
binding clause is exact, and the height clause is what protects **pre-`00007`** marked rows whose
binding is NULL and whose height anchor may well be their genuine provenance.

**Mutations.** M4a (ignore the frontier — reconsider from 0) → **killed**. M4b (restore the OR-form)
→ **killed**.

---

## F5 [high] — transition-only, for real

**Change, all three violations.**

- (a) `readDurableState` no longer recounts. It is the *re-read*, not a transition, and
  `rehydrateAfterUncertainty` calls it after every apply error and again inside `neutralize`. The
  recount now sits at the three sites that genuinely are transitions: `hydrate` (guarded by
  `p.hydrated`, so once per process), the end of `neutralize`, and a round reporting `Superseded > 0`.
- (b) The uncertain-apply path re-uses the last known count: `onAmbiguousApply` sets
  `neutralizedKnown = false` instead of rescanning, deferring one read to the next ordinary round.
  It is on the **ambiguous arm alone** — the other apply-error arms (unacked epoch, anchor
  divergence, cursor regression) are rollbacks where nothing landed, so marking them unknown would
  manufacture a recount out of a routine error.
- (c) **Partial covering index**, chosen over a transactional counter: it cannot drift from the rows
  it describes, needs no write-path coordination, and clause 6 asks for a bound on cost rather than
  a new source of truth. A counter would have to be maintained by neutralize, supersede *and* any
  future writer, and a counter that disagrees with the table is worse than a slow query.

**One non-obvious thing the index required.** PostgreSQL only uses a partial index when it can
**prove** the query predicate implies the index predicate, and it cannot prove that of a bound
parameter under a **generic** plan — the plan a long-running process gets. A `WHERE invalid_reason =
$3` query would silently revert to the full scan the index exists to remove. So
`neutralizedBacklogQuery` inlines the marker as a compile-time constant concatenation (no runtime
string building, no value from outside the package), and the test reads a live EXPLAIN — a stronger
guard than comparing the two strings, because it fails if the plan stops using the index for any
reason.

**EXPLAIN ANALYZE evidence** — the real `neutralizedBacklogQuery`, `force_generic_plan` (note `$1`,
`$2` in the plan), 2,000 rows of history with a backlog of 40:

```
Aggregate  (actual time=0.018..0.019 rows=1 loops=1)
  ->  Bitmap Heap Scan on prices  (actual time=0.013..0.016 rows=40 loops=1)
        Recheck Cond: ((chain_id = $1) AND (owner_engine = $2) AND (invalid_reason = 'unverifiable after a reorg: ...'::text))
        Heap Blocks: exact=2
        ->  Bitmap Index Scan on prices_neutralized_backlog_idx  (actual time=0.009..0.009 rows=40 loops=1)
              Index Cond: ((chain_id = $1) AND (owner_engine = $2))
Execution Time: 0.045 ms
```

**40 rows touched out of 2,000 of history** — cost proportional to the backlog.

**Citing tests:** `TestNeutralizedBacklogIsNotRecountedOnUncertainApplyOrTwiceOnRepair` (drives the
two non-transitions and the one real transition), `TestNeutralizedBacklogAggregateUsesItsCoveringIndex`.

**Mutations.** M5a (restore the recount in `readDurableState`) → **killed**. M5b (bind the marker as
`$3` instead of inlining) → **killed** — confirming the EXPLAIN assertion is doing real work.

---

## F6 [high] — a failed recount marks the count unknown

**Change.** `refreshNeutralizedBacklog`'s error arm sets `neutralizedKnown = false` and logs the
last known value. The previous value is **kept** in `neutralizedStats` — it is the last thing that
was ever true, and discarding it would report a fabricated zero — while `known=false` is what says
not to trust it. Because this function is only called *on* a transition, a failure there is always a
failure to observe a **change**, so the stale value was always wrong in a specific, directional way:
hiding a gap that had just opened, or claiming one that had just closed.

**Citing tests:** `TestFailedRecountAfterANeutralizationReportsUnknownAndTheNextRoundCorrectsIt`
(upward) and `TestFailedRecountAfterASupersedeReportsUnknownAndTheNextRoundCorrectsIt` (downward).
Both assert the stale value is not exposed as current **and** that the next ordinary round corrects
it with the true value — no new transition required, because the unknown flag is itself what re-arms
the read. [clause 6 / the durable-fact rule]

**Mutation.** M6 (drop the `neutralizedKnown = false`) → **killed, both tests**.

---

## F7 [medium] — citations, and the full re-audit

Both named misattributions fixed, plus a systematic class Codex did not name.

1. **The one-endpoint range WARN** cited D-012 clause 4. Clause 4 ratifies the **marking** and says
   nothing about a WARN or a height range; the requirement is the **wave-8 brief's R4**. Now cited
   separately, in both the test comment and the assertion messages.
2. **The exposure-query filtering** cited clause 1. Clause 1 is about deletion and the `RewindPrices`
   refusal and does not specify what the exposure reads count — **and no other clause does either**.
   The comment now says so plainly, and gives the real reasoning (it is what makes clause 3's
   permanence operable: permanently-marked rows counting as history-at-risk would veto every future
   repair forever). **Nominated for ratification below** rather than assigned a borrowed number.
3. **Six live citations naming SUPERSEDED D-011 clauses** (`D-011 clause 7` ×4 for corroboration,
   `clause 8` for gap visibility, plus `checkpointCorroborated`'s own doc calling itself "the
   clause-7 gate"). D-011 is superseded by D-012; naming its clause numbers as the live source for
   current behaviour is the same disease one step subtler, because it looks checkable. All moved to
   D-012 clause 4 / clause 6, with the history noted where it explains something.
4. **Four now-false cost claims** ("NeutralizedPriceStats has no index carrying its predicate") in
   `poller.go`, `poller_test.go`, `prices_test.go` and `prices.go` — true before `00007`, false
   after. Corrected, keeping the distinction that clause 6 bounds *both* per-call cost (the index)
   and call frequency (transition-only), and that a cheap query on a cadence is still a cadence.

### Full clause table, re-audited

| Behaviour | Cited as | Verdict |
|---|---|---|
| No deletion primitive on `PollStore`; `RewindPrices` refuses poll-owned engines | D-012 clause 1 | correct |
| Anchors survive neutralization / prune / rewind on every store path | D-012 clause 2 | correct |
| Provenance bound per observation; NULL = unprovable | D-012 clause 2 | correct (clause 2 makes anchors the offline recovery input; a fabricated input defeats it) |
| `AdoptPollAnchor` refuses at a neutralized height | D-012 clause 2 | correct |
| Marking is permanent; no online revalidation | D-012 clause 3 | correct |
| Cross-endpoint agreement required with >1 configured; fail closed at ≥2; single-view at exactly 1 | D-012 clause 4 | correct |
| **The single-view range-naming WARN itself** | ~~clause 4~~ → **wave-8 brief R4** | **corrected — nominated for ratification** |
| Unanchored legacy rows may be marked permanently | D-012 clause 5 | correct |
| Backlog count/age survive acute recovery; cost bounded, with measured evidence | D-012 clause 6 | correct |
| Recount only on transitions; failure marks unknown | D-012 clause 6 | correct |
| Anchored vs unanchored reported distinctly; package docs describe classification-plus-offline-option | D-012 clause 7 | correct |
| **Exposure reads exclude marked rows** | ~~clause 1~~ → **no clause** | **corrected — nominated for ratification** |
| Corroboration gate (was "D-011 clause 7") | ~~D-011 clause 7~~ → **D-012 clause 4** | **corrected ×5** |
| Gap visibility (was "clause 8") | ~~D-011 clause 8~~ → **D-012 clause 6** | **corrected** |

### Two behaviours nominated for ratification

Neither has a normative source today. Both are implemented and tested; the controller can ratify,
amend, or order removal.

1. **The single-view disclosure.** On a one-endpoint fleet, marking emits a WARN naming the exact
   height range, the configured count and the endpoint relied on. Clause 4 ratifies the marking and
   is silent on telling anyone. Proposed wording: *"a single-view marking must be disclosed at WARN,
   naming the height range classified and the configured endpoint count."*
2. **Exposure reads exclude marked rows.** `CountOwnedPricesAbove`, `CountUnanchoredPricesAbove` and
   `PriceRepairExposure` all exclude `InvalidReasonUnverifiableReorg`. This is what stops a
   permanent classification from permanently vetoing later repair. Proposed wording: *"a retained
   classification is not history at risk: repair-exposure reads exclude marked rows, so a permanent
   classification cannot block a later proven repair."*

---

## The mutation loop found three of its own tests weak

Round 8's lesson was that M5/M5b validated only the arm its tests reached. Running the matrix
surfaced the same failure mode in **my** tests, before the mutants did their job — recorded because
it is the more useful finding:

1. **M2 survived the first run.** `TestNeutralizationSplits...` asserted the `anchor_block` column
   and never the counts an operator actually sees, so the split query was unpinned. Fixed by
   asserting `rowsAnchored`/`rowsUnanchored` through `captureWarnAttrs`, in the one fixture where
   the height rule and the binding rule disagree (1/1 versus 2/0).
2. **The F4 EXPLAIN measured a copy of the DELETE typed into the test**, so mutating the production
   statement could not change what was measured — M4b passed against a query the code no longer ran.
   The DELETE is now the package constant `prunePollAnchorsQuery`, and the test explains *that*.
3. **The F4 fixture was too small to measure anything.** It wrote a price row only for the 300
   protected rounds, leaving `prices` at 13 pages — where a sequential scan is genuinely the
   cheapest plan for any lookup, so the test measured the planner's correct preference at toy scale
   rather than the property. Every round now writes a row.

M4a also revealed that the F4 EXPLAIN is run with the frontier *read back from the table*, so code
that ignored the stored value would produce an identical plan here and a different query in
production. A behavioural assertion was added: an anchor below the frontier survives, which is the
observable signature of "settled heights are not reconsidered".

### Full mutation matrix

| ID | Property | Result |
|---|---|---|
| M1 | The endpoint-count rule governs marking on every arm, including the one with no proof | **killed — all 3 arms** |
| M1b | Zero configured endpoints is not clause 4's fleet of one | **killed** |
| M2 | The reported split names the row's own round, not its height | **killed** (after the test was strengthened) |
| M2b | A binding is written only when the round witnessed an anchor | **killed — 4 tests** |
| M3a | Non-poll identities cannot enter the neutralized state | **killed — 2 tests** |
| M3b | No store path expires a neutralized height's anchor | **killed** |
| M4a | Below-frontier heights are not reconsidered | **killed** |
| M4b | The exemption is index-driven, not a hash of every marked row | **killed** |
| M5a | The backlog is recounted only on transitions | **killed** |
| M5b | The marker is inlined so the partial index is provable under a generic plan | **killed** |
| M6 | A failed recount marks the count unknown | **killed — 2 tests** |
| M7 | — | not executable; citations are prose |

---

## Concurrency

Files touched: `internal/prices/**`, `internal/store/prices*.go`,
`internal/store/migrations/00007_*`, `.superpowers/sdd/**`. Staged by explicit pathspec on both
commits; never `git add -A`. The pre-commit control-plane and scope gates passed both times and were
not bypassed.

**One deliberate, narrow departure from the pathspec, reported as required.** Adding migration
`00007` invalidates the schema-version assertion in `internal/store/migrate_upgrade_test.go`, which
is outside my list. Wave 9 had just refactored it into a single constant whose doc says *"Bumping it
is part of adding a migration"* — i.e. they built it as the integration seam for exactly this. I
changed `currentSchemaVersion = 6` → `7`, one token, and only after confirming their tree was clean
so there was no clobber risk. (Wave 11 has since taken it to 8 for their `00008`.)

**Interference observed and handled.** The shared Postgres produced two rounds of failures that
looked like bugs and were not — a poll cursor at 3337/5000 despite `derive_cursors` being truncated,
and a burst of `derive_support_test.go` failures that passed in isolation and on re-run. Both were
re-run once per the brief before investigating. The base also moved twice mid-session (wave 9 landed
three commits after I measured my first baseline, which is why the reported baseline is `331c0a6`
and not `73d75cf`).

---

## Anything unverified, and one process note

- **`internal/store/derive.go` fails `gofmt -l`** at HEAD. It is wave 9's committed file, outside my
  pathspec, and I did not touch it. Flagged for whoever owns it. (Every other `-l` hit is the CRLF
  artifact described above.)
- **The F4 and F5 plan evidence is conditional on current table statistics**, and the F4 test
  `ANALYZE`s before measuring for that reason. With stale statistics PostgreSQL mis-estimates the
  anti-join and can fall back to hashing — a true statement about a neglected database rather than
  about the query's shape. Keeping statistics current is autovacuum's job and is a precondition
  here, not something this wave establishes.
- **The `00007` upgrade test baselines at version 5, not 6**, because `00006` belonged to the
  concurrent wave and was untracked when I wrote it. The path 5→7 exercises everything `00007` does;
  it does not exercise a 6→7 step specifically.
- **`price_poll_anchor_prune` is not in the suite's fixture `TRUNCATE` list** (`derive_test.go`,
  outside my pathspec), so frontier rows persist across tests in the shared schema. This is harmless
  because the `cutoff < frontier` backstop discards a frontier that cannot describe the current
  population — the leak is in fact what first exercised that branch — but a future wave that owns
  `derive_test.go` should add the table to the list.
- **Process note, owned:** my first mutation harness reverted the whole `internal/` tree, which
  discarded uncommitted test improvements mid-loop and cost a re-application. The harness now
  reverts only the file it mutated and **refuses to run if that file has uncommitted changes**. The
  method's "commit before mutation loops" rule is what limited the damage; the harness now enforces
  it rather than relying on my remembering.
