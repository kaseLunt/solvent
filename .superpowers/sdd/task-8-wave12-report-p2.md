# Task 8 — wave 12 report (round-9 fixes, prices unit)

- **Commits:** `ea47649` (the four fixes), `322dd74` + `1705f2e` (three gaps the mutation loop found),
  `c877ed2` (delete the fake's dead height-rule helper).
- **Base:** `827a9e6` (health wave 11's landed HEAD at my start).
- **Returns to:** Codex round 10 (prices unit) under D-006.

## Verification

Measured from a **`git archive` export**, because the shared working tree carries the concurrent
wave's in-flight edits — `cmd/indexer/{main,health_test,main_test,staleness_reuse_test}.go` and
**`internal/store/derive.go`**, which is inside my own package and therefore compiles into my test
binary. The export contains only committed blobs, so nothing foreign and mid-edit is in it. Measured
twice: once at `1705f2e` (the last code commit) and again at the **final HEAD `7bda43c`**, with
identical results.

| | top-level PASS | incl. subtests | FAIL | SKIP |
|---|---|---|---|---|
| Baseline `827a9e6` | 552 | 643 (91 sub) | 0 | 0 |
| **This wave `7bda43c`** | **555** | **646 (91 sub)** | **0** | **0** |

Convention: `go test ./... -count=1 -v`; top-level = `^--- PASS`, incl. subtests = `^ *--- PASS`.

**+3 net = +8 new − 5 deleted with the adoption path.** Added:
`TestPollerFloorDoesNotBlessANullBoundRowSharingAHeightWithALaterAnchor`,
`TestPollerFloorIsAdmittedInFullWhenEveryRowCarriesItsOwnBinding`,
`TestPollStoreDeclaresNoLegacyAnchorAdoption`,
`TestEveryRepairReadTreatsANullBoundRowAtAnAnchoredHeightAsUnprovable`,
`TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart`,
`TestLegacyRowsHaveNoProvenanceAndTheStoreOffersNoWayToInventOne`,
`TestPollAnchorRetentionExemptsTheAnchorAMarkedRowIsBoundTo`,
`TestTheFrontierExcludesAnAnchorAMarkedRowIsBoundTo`. Deleted:
`TestPollerAdoptsAnchorsForLegacyUnanchoredRowsThenCanRepair`,
`TestPollerAnchorAdoptionRefusedWhileEpochPending`,
`TestAdoptingALegacyAnchorLowersThePruneFrontierToIt`,
`TestUnanchoredPriceBlocksSkipsNeutralizedHeights`,
`TestUnanchoredPriceBlocksAndAnchorAdoption`.

`go build ./...` and `go vet ./...` clean in the export. `-race` clean in `golang:1.24` via
`host.docker.internal` (all nine packages, `internal/store` 216s).

**gofmt — read, and still the documented false positive.** `gofmt -l` in the export lists **every**
Go file in the repo, including ones nobody has touched this phase. The cause is `.gitattributes` +
`core.autocrlf`: `.go` files carry CRLF even through `git archive`, and gofmt reports a CRLF file as
entirely unformatted. The authoritative check is the committed blob — `git show HEAD:<file> | gofmt -l`
— which is **clean for all nine files I touched**. Cross-checked the same way against the working
tree with `sed 's/\r$//' | gofmt -l`: also clean. No genuine formatting defect this wave.

**Pre-commit gate:** `control-plane doctor` + `scope-gate` ran on all four commits, `0 error(s),
0 warning(s)`. Nothing bypassed. Its standing INFO (`REVIEW-DUE: W1`) is unrelated to this wave.

---

## P1 [high] — the binding governs every consumer

**The fix is one shared predicate, not four edits.** `store.unprovableRow` is now the single
read-side definition of "this observation has no provenance", and the three readers that decide what
a repair may do all use it:

```
NOT EXISTS (SELECT 1 FROM price_poll_anchors a
            WHERE a.engine = $2 AND a.chain_id = $1 AND a.block_number = p.anchor_block)
```

The NULL semantics are the SQL's own rather than a branch: `a.block_number = NULL` is NULL, no row
matches, `NOT EXISTS` holds. So a pre-00007 row is unprovable everywhere — and so is a row whose
binding names an anchor retention has since removed, because the binding names a block and the
anchor row is the fact. It is an index lookup on 00007's `prices_anchor_binding_idx`.

**The floor was the part that actually cashed the fabrication out**, and it needed more than a
predicate swap. A verified floor at H proves the *chain* at and below H is unchanged; turning that
into "every row at or below H keeps its validity" additionally assumes each of those rows describes
that chain, which is only known for a row whose round recorded what it read.
`NeutralizeUnverifiablePrices` now **clamps the floor to just below the lowest unprovable row inside
the repair range** `(walkerTarget, verifiedFloor]`, and refuses it entirely when that row sits at the
bottom of the range.

**Why clamping rather than marking the unprovable rows individually** — the more precise option,
which I rejected. Marking individually spares provable rows above an unprovable one, so it costs less
availability; but then the boundary this call *returns* stops describing what it marked, and the
cursor, the ADD-1 disclosure range and the WARN would each need a different answer. One honest
boundary is worth more than the rows saved, because (a) the population it can over-mark is D-012
clause 5's legacy rows, recorded as **zero** in production, and (b) `pollAnchorRetention` is 4096
rounds — orders of magnitude deeper than any reorg — so a row inside a repair range whose anchor has
been pruned is not a state the running system reaches. The trade is stated in the code, not just here.

### The consumer sweep — every consumer of `price_poll_anchors` / `anchor_block` / height-join provenance

Grepped `price_poll_anchors|anchor_block|anchorBlock|AnchorBlock` across all `*.go`, then re-grepped
the final code to build this. **Converted or justified, no exceptions.**

| # | Consumer | Was | Now | Verdict |
|---|---|---|---|---|
| 1 | `CountUnanchoredPricesAbove` (`prices.go:1108`) | height join | `unprovableRow` | **CONVERTED** — M2 kills the site alone |
| 2 | `PriceRepairExposure.Unanchored` (`prices.go:1207`) | height join | `unprovableRow` | **CONVERTED** — M3 kills the site alone |
| 3 | candidate-floor handling (`NeutralizeUnverifiablePrices`, `prices.go:1383`) | floor admitted wholesale | clamped below the lowest unprovable row via `unprovableRow` | **CONVERTED** — M4/M5/M6 |
| 4 | neutralization reason split (`prices.go:1449`) | height (pre-wave-10) | `marked.anchor_block` | already converted in wave 10; re-verified, unchanged |
| 5 | `NewestPollAnchor` (`prices.go:1005`) | height-only exclusion | height **+** binding exclusion | **CONVERTED** — see note below; M12 |
| 6 | `prunePollAnchorsQuery` (`prices.go:837`) | both clauses (wave 10) | unchanged | **JUSTIFIED** — already asks both; M9 now covers the binding one |
| 7 | `RewindPrices` anchor sweep (`prices.go:1942`) | height-only | height **+** binding | **CONVERTED** — this is P3; M7/M8 |
| 8 | `PriceRepairExposure.AnchoredHeights` (`prices.go:1212`) | counts anchors above the target | unchanged | **JUSTIFIED** — a fact about the ANCHOR population, not a provenance claim about any row; **no production consumer reads it** (only the fake and one test assertion), and the field doc now says deciding through it would be the height rule again |
| 9 | `PollAnchorsBelow` (`prices.go:936`) | enumerates anchors ≤ a height | unchanged | **JUSTIFIED** — supplies probe candidates; makes no claim about any row. Every row-level consequence of a probe goes through #1/#3 |
| 10 | `insertPollAnchor` / conflict read (`prices.go:738`, `751`) | write path | unchanged | **JUSTIFIED** — writes the anchor and detects hash divergence; reads no row |
| 11 | `insertPrice` INSERT + supersede UPDATE (`prices.go:646`, `694`) | parameter, not lookup | unchanged | **JUSTIFIED** — this is the write-side binding wave 10 installed. M10/M11 re-confirm both arms |
| 12 | `pruneOldPollAnchors` retention-cutoff read (`prices.go:861`) | `MIN` over the newest N anchors | unchanged | **JUSTIFIED** — a bound on the anchor table's size; touches no row |
| 13 | fake `CountUnanchoredPricesAbove` / `PriceRepairExposure` (`prices_test.go`) | height rule | `provable()` | **CONVERTED** — this is round 9's root cause; M13 |
| 14 | fake `NewestPollAnchor` (`prices_test.go:498`) | height-only | height + binding | **CONVERTED**, mirroring #5 |
| 15 | fake `NeutralizeUnverifiablePrices` floor (`prices_test.go:684`) | floor admitted wholesale | clamped | **CONVERTED** — M14 |
| 16 | fake `anchoredHeights` helper | the height rule itself | **DELETED** (`c877ed2`) | dead after the conversion; left in place it is how the next consumer gets written against the wrong rule |
| 17 | `UnanchoredPriceBlocks`, `AdoptPollAnchor` (+ fakes) | height join | **DELETED** | P2 |
| 18 | `internal/store/derive_test.go:32` (TRUNCATE list) | names the table | unchanged | **JUSTIFIED** — test teardown, foreign file, no provenance decision |
| 19 | `migrate_upgrade_prices_test.go:80` | asserts the table is absent at v4 | unchanged | **JUSTIFIED** — schema assertion |

**Note on #5, `NewestPollAnchor`.** I added the binding clause *alongside* the height clause rather
than replacing it, matching `prunePollAnchorsQuery`. The binding clause is the exact one — a round may
stamp observations below its own execution block, and if those were marked the round is not one we
stand behind however clean its height looks. The height clause is the conservative one that protects
pre-00007 marked rows, whose binding is NULL and whose height anchor may well be their genuine
provenance. Both only ever EXCLUDE, and for this read exclusion is the safe direction in both
directions of use: a lower frontier makes the block-advance clock trip sooner and makes a cursor
regression look older, never fresher.

**Regressions.** Live store:
`TestEveryRepairReadTreatsANullBoundRowAtAnAnchoredHeightAsUnprovable` drives the exact fixture — an
**unmarked** NULL-bound row at H plus a later empty round's anchor at H — through all three reads and
the floor. It is deliberately unmarked, because a marked row is excluded by ADD-2 and would make every
assertion pass for the wrong reason. Poller:
`TestPollerFloorDoesNotBlessANullBoundRowSharingAHeightWithALaterAnchor` drives the same shape end to
end, with `TestPollerFloorIsAdmittedInFullWhenEveryRowCarriesItsOwnBinding` as the control — without
it the first test would pass against a store that had simply stopped honouring floors.

---

## P2 [high] — adoption deleted, not guarded

**Decision: DELETE.** The controller could name no remaining population, and neither can I.

The argument is mechanical rather than a judgement call, and P1 is what makes it so:

1. After P1 a row is provable **only** through its own `anchor_block` binding.
2. `AdoptPollAnchor` writes a row into `price_poll_anchors`. It does **not** set `prices.anchor_block`
   — and it must not, because "`anchor_block = block_number` where an anchor exists at that height" is
   exactly the backfill migration 00007 prohibits (pinned by
   `TestMigrateAddsProvenanceBindingWithoutClaimingProvenanceForOldRows`).
3. Therefore after adoption the legacy rows are **still unprovable to every consumer**. Adoption's
   only stated benefit — "so reorg repair can verify that history instead of refusing to touch it" —
   is unreachable by construction, and no arrangement of Codex's guards restores it.
4. What survived was pure hazard, and more of it than the finding named: an adopted anchor remains a
   probe candidate for `PollAnchorsBelow`, where a match against a hash copied from the same chain is
   a proof of nothing that can nonetheless **raise a verified floor**; and a candidate for
   `NewestPollAnchor`, where its fresh `observed_at` would tell a restarted poller it had just seen
   the chain move.

**The population question, answered explicitly.** D-012 clause 5 records legacy unanchored rows as
**zero** in production — they exist only in databases that ran pre-00005 code, and Task 9 backfills
from scratch. Adoption was also never the exit from the pending-epoch deadlock: it was refused for
exactly as long as an epoch stood, so the terminating transition was always
`NeutralizeUnverifiablePrices`, which needs nothing from it. `TestPendingEpochWithUnanchoredHistoryHasATerminatingTransition`
now says so directly rather than asserting a refusal on a path that no longer exists.

**Removed:** `Poller.adoptLegacyAnchors`, `legacyAnchorsAdopted`, `anchorAdoptionPerStep`, the Step
call site, `Store.UnanchoredPriceBlocks`, `Store.AdoptPollAnchor`, both `PollStore` declarations, and
the fakes. A tombstone comment carries the full argument at each site. The prune's
"AdoptPollAnchor lowers the frontier itself" reasoning is updated: no path now places an anchor below
the frontier at all, and the stale-frontier backstop is kept anyway, with that stated.

**The restart regression** (`TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart`) drives the
finding's exact cycle against Postgres: an ordinary anchored round; `pollAnchorRetention + 25` more
rounds so retention expires its anchor; assertions that the **binding survives the prune** while the
hash does not, and that the row is consequently unprovable; **then the chain hash changes and the
epoch is recorded** — the ordering the finding turns on, since an adoption after that point would
have recorded the replacement block's hash; then the restart. The restart is modelled by what a
restarted writer can actually do: the only remaining anchor writer is `ApplyPolledPrices`, and the
cursor's monotonic guard refuses it at that height **with a divergent hash**, which is what makes it a
test about fabrication rather than idempotency. It closes by proving the epoch is still answerable, so
the deletion did not re-open the deadlock.

---

## P3 [medium] — the rewind sweep exempts the BOUND anchor

Second `NOT EXISTS` on `p.anchor_block = a.block_number`, in the same split form and for the same plan
reason as `prunePollAnchorsQuery` (split, each clause is a correlated index lookup; as a disjunction
PostgreSQL can drive neither by index).

The live regression now carries **both** shapes, because with only one of them each clause looks
redundant:

- a round executing at **5200** stamping its observation at **5150** — legal under
  `ApplyPolledPrices` — so its provenance is an anchor at another height and **only the binding
  clause** can spare it;
- a **pre-00007** row (NULL binding) at **5300**, where a later empty round anchored, so **only the
  height clause** can spare that anchor.

Both were needed: M8 (drop the height clause) survived until the 5300 row existed. The predicate now
preserves provenance independently of the identity guards, which is what D-012 clause 2's "on any
store path" asks for.

**Beyond the finding:** the same asymmetry existed one layer down, in the **prune**. Its binding
clause had shipped in wave 10 with no test that could distinguish it from the height clause — M9
survived. `TestPollAnchorRetentionExemptsTheAnchorAMarkedRowIsBoundTo` closes it.

---

## P4 [medium] — the ratified citations, propagated

Taking the sequencing note as given: ADD-1/ADD-2 were ratified at `fdb9f8d`, after wave 10's commits,
so this is propagation.

- **ADD-2** now cited in `TestNeutralizedRowsAreNotHistoryAtRiskForALaterRepair`, with its
  "no clause… merely nominated" paragraph deleted and replaced by the addendum's own text and
  rationale; also cited on `PriceRepairExposure`'s doc, where the exclusion is implemented.
- **ADD-1** now cited at every single-view disclosure site: both test assertions in
  `poller_clause4_test.go`, `TestPollerMarksOnAOneEndpointFleetAndDisclosesTheHeightRange` (whose
  "the wave-8 brief's R4" paragraph is replaced), `Poller.neutralize`'s doc, the WARN text itself, and
  both `checkpointCorroborated` arms that set `singleView`.
- **`D-011 CLAUSE 7` heading** in `poller_test.go:1626` → **D-012 clause 4**, with a line saying the
  number moved and that this heading is itself an instance of the drift F7 exists to stop.
- **`poller.go:1921-1922`** — "a pass with no checkpoint … is not gated at all" — replaced. It
  contradicted the code F1 had already put beneath it; the new text points at
  `checkpointCorroborated`'s `!probeCheckpointSet` branch and states that no arm is ungated.

**Full citation table re-audited.** Every `D-0NN clause N` in `internal/prices` and `internal/store`
checked against the decision files:

- **D-012 clauses 1–7 all exist** — I verified clause 7 specifically ("operator-facing text must match
  this decision"), because 3 sites cite it and it is the highest-numbered clause; it is real.
- **D-010 clauses 1, 2, 4** — all exist.
- **All 5 surviving `D-011` mentions are explicitly framed as superseded/historical** (`poller.go:1406`,
  `poller_test.go:518/1670/1965`, `prices_test.go:501`). I tightened `prices_test.go:501`, which
  cited D-011 clause 5 as the live reason for a behaviour, to name **D-012 clause 2** as the source
  and D-011 clause 5 as the superseded origin.
- **Both remaining `wave-8 brief` mentions are now historical framing** pointing at ADD-1.
- No citation names a clause that does not exist.

---

## Mutation matrix

Run against `ea47649` and after each gap fix. Every row states the PROPERTY, and the matrix covers
**write-side and read-side** arms plus the repair/floor/adoption arms round 9 said M2 had missed.

| # | Mutation | Property it attacks | Result |
|---|---|---|---|
| M1 | `unprovableRow` joins `p.block_number` | a NULL-bound row at an anchored height is unprovable | KILLED |
| M2 | only `CountUnanchoredPricesAbove` reverts | *this site* asks the binding | KILLED |
| M3 | only `PriceRepairExposure.Unanchored` reverts | *this site* asks the binding | KILLED |
| M4 | only the floor-clamp lookup reverts | *this site* asks the binding | KILLED |
| M5 | clamp neutered (`admitted = verifiedFloor`) | a floor may not bless unprovable history | KILLED |
| M6 | clamp inclusive (`admitted = *lowestUnprovable`) | the clamp is strictly BELOW the row | KILLED |
| M7 | rewind sweep drops the BINDING exemption | the anchor a marked row is bound to survives a rewind | KILLED |
| M8 | rewind sweep drops the HEIGHT exemption | a pre-00007 marked row still protects the anchor at its height | **SURVIVED → gap closed → KILLED** |
| M9 | prune drops the BINDING exemption | retention may not expire the anchor a marked row is bound to | **SURVIVED → gap closed → KILLED** |
| M10 | **write side:** binding = the row's own height | provenance is the ROUND's anchor, not the row's height | KILLED |
| M11 | **write side:** supersede keeps the old binding | a superseding round re-stamps provenance with its own | KILLED |
| M12 | `NewestPollAnchor` drops the binding exclusion | the frontier is not a round whose observations were marked | **SURVIVED → gap closed → KILLED** |
| M13 | **the fake** reverts to the height rule | the poller regressions test the binding rule, not a fake's fiction | KILLED |
| M14 | the fake drops the floor clamp | the fake models the store's floor, not a laxer one | KILLED |
| M15 | `AdoptPollAnchor`/`UnanchoredPriceBlocks` restored on `*Store` | the store declares no way to invent provenance | KILLED |
| M16 | …restored on `*Store` **and** re-declared on `PollStore` | the interface declares no adoption path | KILLED (compile) |
| M16b | …plus the fake, so it compiles | the reflection test — not the compiler — is what refuses it | KILLED |
| M17 | ADD-1 disclosure stops naming the height range | the single-view concession is auditable | KILLED |
| M18 | ADD-1 disclosure never emitted | the single-view concession is never silent | KILLED |

**18 mutants, 3 survivors, all 3 closed** (`322dd74`, `1705f2e`). The three survivors are the
interesting result and they share a shape: **a clause that had a twin**. M8 and M9 survived because
the height clause and the binding clause each spared the anchor in the only fixture that existed, so
neither test could tell them apart — the same "one arm covered, the other assumed" disease as round 9's
own finding, one layer down. M12 survived because `NewestPollAnchor`'s conversion was mine and I had
written no test for it at all.

**Two false results I caught and corrected, reported because they would otherwise inflate this table.**
Several `perl -0pi` multiline mutations silently failed to apply — the files are CRLF, so `\n` in the
pattern never matched — and reported SURVIVED for mutations that were never made (M2, M5, M7/M8 first
attempts, M9, M12, M13, M14, M16b). Every mutation in the table above was re-applied with a
line-targeted `sed` and **verified applied** (by grep or by printing the mutated lines) before the
test ran. Two others reported KILLED on a **compile error** from an over-eager `sed` line range;
both were redone until the mutant compiled. A mutation matrix whose entries were never applied is
worse than no matrix, which is why this is here rather than in a footnote.

**One process failure worth recording:** a `git checkout -- internal/store internal/prices` in a
mutation-revert step destroyed the two uncommitted gap-closing tests I had just written for M8/M9. I
re-applied them and committed **before** resuming the loop. The method's "commit before mutation
loops" rule exists for the fix commit; it applies just as much to work produced *by* the loop.

---

## Anything unverified

- **`AnchoredHeights` has no production consumer.** Only the fake and one test assertion read it. I
  left it (it is honest — a count of anchors, not a claim about rows) and documented that deciding
  through it would be the height rule again. Removing it is a separate call.
- **The floor clamp's availability cost is argued, not measured.** The argument is that
  `pollAnchorRetention = 4096` rounds ≫ any reorg depth, so the clamp cannot fire on
  retention-pruned rows in production, and D-012 clause 5 records the legacy population as zero. I did
  not build a scenario measuring how much history a clamp would over-mark if both assumptions failed
  at once.
- **`unprovableRow`'s index use is argued from the migration, not EXPLAINed.** 00007's
  `prices_anchor_binding_idx` is `(chain_id, owner_engine, anchor_block)` and the predicate matches
  it, but I did not add an EXPLAIN test for the three converted reads the way
  `TestNeutralizedBacklogAggregateUsesItsCoveringIndex` does for the backlog aggregate. The existing
  EXPLAIN test still covers `prunePollAnchorsQuery`.
- **Cross-chain scoping of `unprovableRow` is untested.** Every fixture in this package uses chain 10,
  so a mutation dropping `a.chain_id = $1` would likely survive. I did not run it as a numbered
  mutation and did not add a two-chain fixture.
- **The other wave's `internal/store/derive.go` is mid-edit in the shared tree.** All numbers above
  come from the clean export; I did not run the suite against their uncommitted state, and it is not
  mine to judge.

---

## ERRATUM — 2026-07-25 (wave 14, Codex round 10P residual (a))

Appended, not rewritten: the text above is what this wave reported, and this is what a later
measurement found wrong in it.

**1. The index claim in §P1 is incorrect.** The report says of `unprovableRow`:

> It is an index lookup on 00007's `prices_anchor_binding_idx`.

and the "Anything unverified" bullet repeats it as *"00007's `prices_anchor_binding_idx` is
`(chain_id, owner_engine, anchor_block)` and the predicate matches it"*. It does not. The predicate's
inner lookup reads **`price_poll_anchors`** by `(engine, chain_id, block_number)`, so what can serve
it is an index on **that** table. `prices_anchor_binding_idx` is on `prices`, keyed by `anchor_block`;
it serves the reads that go the other way — the prune's and `RewindPrices`' *"is any marked row bound
to this anchor?"* — and plays no part in `unprovableRow`.

Codex named the primary key `(engine, block_number)` as the true server. **Measured** on the live
database at wave 14 (3,000 anchored rounds, `ANALYZE`d, `force_generic_plan`, `EXPLAIN ANALYZE`), the
planner chose 00005's **`price_poll_anchors_scan_idx (chain_id, engine, block_number DESC)`** as an
`Index Only Scan` on the inner side of a `Nested Loop Anti Join` — a three-column exact match, where
the PK lacks `chain_id`. So Codex's correction is right about the wrong index having been named, and
the specific index is the 00005 scan index with the PK as the alternative. The load-bearing part of
the original claim — *correlated index lookup, not a scan* — holds.

The same wrong index name had been copied into the `unprovableRow` doc comment in
`internal/store/prices.go`; that comment is corrected in wave 14 with the measured plan. The
measurement was taken with a throwaway test that was **not** committed, so the plan is still not
pinned by a regression — the "argued, not EXPLAINed" caveat above stands for the three converted
reads.

**2. `AnchoredHeights` (row #8 of the consumer table, and the first "Anything unverified" bullet) is
deleted.** The table recorded it as JUSTIFIED-and-left-in-place with no production consumer; Codex
round 10 adjudicated the residual as *acceptable — delete it to reduce misuse*, and wave 14 did.
`PriceRepairExposure` no longer carries the field, the anchor-count query is gone, and the fake and
two test assertions that were its only readers are gone with it. Row #8 should now read **DELETED**.

**3. The cross-chain gap in the last "Anything unverified" bullet is closed.** Wave 14 adds
`TestProvenanceReadsAreScopedToTheirOwnChain` (`internal/store/prices_binding_test.go`), the two-chain
fixture that bullet says was missing, and ran the mutation it predicted would survive.
