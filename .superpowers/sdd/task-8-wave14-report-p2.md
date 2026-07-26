# Task 8 — wave 14 report (round-10P fixes, prices unit)

- **Commits:** `4e44cc6` (both mediums + residuals (a) and (c)), `eafb17f` (the wave-12 report
  erratum), `e06f40f` (structural pin for the deletion), `82dc7ec` (the no-floor disposition gap the
  mutation loop found).
- **Base:** `2bf5442` — HEAD at my start, the ledger commit for waves 10–13. The concurrent health
  wave landed `a3f2223` (ledger line, one insertion) mid-wave; my first code commit sits on top of it.
- **Returns to:** Codex round 11 (prices unit) under D-006. Expected to be the closing round.

Round 10P was `needs-attention` with **two mediums, both operator-facing text**, plus three
adjudicated residuals. All five are here. Nothing in this wave changes a decision, a predicate, or a
transaction — every behavioural claim the code makes about rows is the same as at `2bf5442`. What
changed is what the code *says* about what it did.

## Verification

Measured from a **`git archive` export of `82dc7ec`**, because the shared working tree carries the
concurrent health wave's in-flight edits to `cmd/indexer/{health,health_live_test,health_test,main,
main_test,staleness_budget_test,staleness_reuse_test}.go`. The export contains committed blobs only.

| | top-level PASS | incl. subtests | FAIL | SKIP |
|---|---|---|---|---|
| Baseline `2bf5442` | 561 | 655 (94 sub) | 0 | 0 |
| **This wave `82dc7ec`** | **563** | **657 (94 sub)** | **0** | **0** |

Convention (the pinned one): `go test ./... -count=1 -v`; top-level = `^--- PASS`, incl. subtests =
`^ *--- PASS`. The baseline was measured by me at `2bf5442` before touching anything, not inherited
from the ledger — it agrees with the ledger's 561/655 at `48b9bcb`.

**+2 = two new tests, nothing deleted.** `TestProvenanceReadsAreScopedToTheirOwnChain` (residual (b))
and `TestRepairExposureOffersNoPerHeightAnchorCount` (residual (c)). Five existing tests gained
assertions; one existing assertion was **re-specified** and says so in place
(`TestPollerRepairRetainsRowsBelowVerifiedAnchor` asserted the phrase `HASH-VERIFIED poll anchor`,
which came from the pre-composed justification this wave removes).

`go build ./...` and `go vet ./...` clean in the export — **output read**, both silent.

**`-race` clean** for both packages I touched — `internal/prices` 1.5s, `internal/store` 207s — in
`golang:1.24` against the live database over `host.docker.internal`. Not run natively: this host has
`CGO_ENABLED=0` and no cgo toolchain, and `go test -race` refuses outright (`-race requires cgo`).

**gofmt — read, and still the documented CRLF false positive.** `gofmt -l` in the export lists **all
56** Go files in the repo, including ones untouched this phase, because `.gitattributes` +
`core.autocrlf` give `.go` files CRLF even through `git archive` and gofmt calls a CRLF file
unformatted. The authoritative check is the committed blob — `git show HEAD:<file> | gofmt -l` — which
is **empty for all seven files I touched**. In the working tree `gofmt -l .` flags 10 files; I
verified every one of them carries CRLF and that all 10 are clean once CRLF is stripped, so there is
no genuine formatting defect anywhere in the tree, mine or the other wave's.

**Pre-commit gate:** `control-plane doctor` + `scope-gate` ran on all four commits, `0 error(s), 0
warning(s)` each, 7/1/1/1 paths. Nothing bypassed. The standing `REVIEW-DUE: W1` INFO is unrelated.

---

## F1 [medium] — the WARN described the floor the store had already rejected

**The regression shape, verbatim from the finding:** a pass verifies anchor 5000 and offers it as a
floor; `NeutralizeUnverifiablePrices` clamps to 4999 because an unprovable row sits at 5000; the row
at 5000 is marked **permanently**; and the WARN said *"everything at or below the verified floor keeps
its validity"* with `verifiedFloor=5000`. The one row the operator most needed to know about was the
one the log vouched for.

**The fix is a rule about composition, not a re-worded string.** The floor a pass offers is a
*request*; the boundary the store returns is the *fact*. So:

- `Poller.neutralize` takes **`evidence`** instead of `justification`, and the arms of `repair` now
  supply only what the pass PROVED ABOUT THE CHAIN — the sole thing knowable before the call. The
  `floorVerified` arm used to open with "everything at or below HASH-VERIFIED poll anchor N keeps its
  validity"; it now says the anchor was re-verified by hash on the pinned endpoint, that every anchor
  above it mismatched on that same endpoint, and that the checkpoint still held. Every one of those is
  true whatever the store then does with the floor.
- The WARN and the justification are **built after the return**, from `boundary`.
- `floorDisposition(offered, boundary)` states the outcome in one word and one sentence. Four values
  partition every pair this call can produce: `none-offered`, `admitted`, `below-target`, `clamped`.
- The WARN carries `boundary`, `validAtOrBelow`, `floorOffered`, `floorDisposition`.

**`validAtOrBelow` duplicates `boundary` on purpose**, and the code says so. The failure was a human
one — a reader taking the floor for the validity boundary — and the remedy is a key that names what
the number MEANS rather than where it came from. `boundary` names the mechanism; `validAtOrBelow`
answers the question actually being asked at 3am.

**`clamped` deliberately merges two store outcomes** — a partial clamp and a floor refused entirely.
Distinguishing them needs the walker's target, which the poller does not read, and the store's own
three WARNs already make that distinction where the number lives. What the poller can say without
qualification is the part that matters: rows at or below the offered floor were marked anyway.

Same class fixed at its other occurrences rather than only at the citation (the lesson the ledger
records from the deriver rounds): the `neutralize` doc, the `floorUnverifiable` comment in
`verifyFloor` that called the returned floor a validity guarantee, and two package-doc sentences in
`internal/prices/prices.go` that promised "everything at or below the floor keeps its validity".

**Regression.** `TestPollerFloorDoesNotBlessANullBoundRowSharingAHeightWithALaterAnchor` — the
finding's own shape, already in the suite — now asserts `floorDisposition=clamped`,
`validAtOrBelow=4999`, the justification sentence *"Validity survives at or below 4999, not 5000"*,
the ABSENCE of the retired sentence, and that no message carrying `rowsNeutralized` reports
`validAtOrBelow=5000`. Its control
(`TestPollerFloorIsAdmittedInFullWhenEveryRowCarriesItsOwnBinding`) asserts `admitted` and NOT
`clamped`, so a poller that reported "clamped" unconditionally fails.

---

## F2 [medium] — "unanchored" was a claim about what was written, not about what survives

The classification WARN made two statements that are false for one real population — a row whose
round DID anchor and whose anchor retention has since pruned:

- the message: *"Their provenance — the row, its value and the recorded block hash — is retained
  FOREVER"*. That row's hash is already gone.
- `unanchoredMeans`: *"no hash was ever recorded for these heights"*. One was. That difference is
  operationally load-bearing: a hash that existed and was pruned is something a backup or a WAL
  archive might still hold, and a hash that never existed is not.

`TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart` constructs exactly that row, which is how
the finding could be checked without inventing a fixture.

**Fix.** "Unanchored" now means **no SURVIVING anchor is linked to the observation**, and the
population is split by the same UPDATE's CTE — one extra `IS NULL` test, no extra query:

| count | meaning |
|---|---|
| `rowsAnchored` | a surviving anchor is linked; the hash is on disk; an offline check could settle it |
| `rowsUnanchoredBindingPruned` | the binding names a block whose anchor row is gone — a hash **was** recorded and is no longer here |
| `rowsUnanchoredNeverBound` | the binding is NULL — no hash is **known** for the round |

`rowsUnanchored` is retained as the sum, so nothing that consumed it breaks.

**The retention claim is now scoped to the population it holds for.** The message says the rows and
their values are retained forever, that the recorded hash is retained **only where one still exists**,
and — the part that is actually true and useful — that clause 2 stops any prune or rewind from
expiring the anchor a marked row is bound to *from now on*, while it cannot bring back a hash that was
already gone when the marking ran. Offline reconciliation is promised for `rowsAnchored` and for
nothing else.

**"Known" rather than "written" for the never-bound half**, because a pre-00007 round may well have
anchored without anything recording that the anchor covers *this* observation — asserting otherwise
would be migration 00007's forbidden inference in a log line.

**Regressions.** The restart test asserts the full attribution (0 anchored / 1 pruned / 0 never-bound,
the new gloss, the absence of both retired sentences). `TestNeutralizationReportsAnchoredAndUnanchored
MarkingsDistinctly` covers the other half (1 never-bound / 0 pruned) and the scoped retention claim.
Neither test can pass on the other's fixture, which is the point of splitting them.

---

## Residual (a) — the report cited the wrong index, and so did the code

The wave-12 report said `unprovableRow` is *"an index lookup on 00007's
`prices_anchor_binding_idx`"*, and the same sentence had been copied into the `unprovableRow` doc
comment. It is wrong in both places: the predicate's inner lookup reads **`price_poll_anchors`** by
`(engine, chain_id, block_number)`, so what serves it is an index on THAT table.
`prices_anchor_binding_idx` is on `prices`, keyed by `anchor_block`, and serves the reads that go the
other way — the prune's and `RewindPrices`' *"is any marked row bound to this anchor?"*.

**Measured, not reasoned.** On the live database, 3,000 anchored rounds, both tables `ANALYZE`d,
`plan_cache_mode = force_generic_plan`, `EXPLAIN ANALYZE` of the real predicate:

```
Nested Loop Anti Join
  ->  Seq Scan on prices p   (chain 10 / this engine is ~all of the fixture)
  ->  Index Only Scan using price_poll_anchors_scan_idx on price_poll_anchors a
        Index Cond: ((chain_id = $1) AND (engine = $2) AND (block_number = p.anchor_block))
```

So the server is 00005's `price_poll_anchors_scan_idx (chain_id, engine, block_number DESC)` — a
three-column exact match — with the table's primary key `(engine, block_number)` as the alternative
Codex named. Codex's correction is right about the wrong index having been cited; the specific index
is the scan index. The load-bearing half of the original claim (correlated index lookup, not a scan)
holds.

The report is corrected by a **dated erratum appended** to `task-8-wave12-report-p2.md` — history is
not rewritten — and the code comment carries the measured plan.

---

## Residual (b) — the two-chain fixture, and what it is worth

`TestProvenanceReadsAreScopedToTheirOwnChain` (live Postgres). Two arms:

1. **Ordinary two-chain operation** — two chains, two engines, rows and anchors at the same heights on
   both; each chain's reads see only its own.
2. **The arm a mutation dies on** — the anchor engine `prices:poll:10` wrote at 5000 now carries
   `chain_id = 999`. The row bound to 5000 is unprovable on chain 10; the row bound to 6000 is
   untouched; chain 999's own read is unaffected.

**Why the schema cannot do this job**, which is the honest justification for the fixture: 00005 keys
`price_poll_anchors` by `(engine, block_number)`. `chain_id` is a column, **not part of the key**, so
the table itself permits one engine to carry anchors for more than one chain, and an anchor found by
`(engine, block)` alone is not necessarily a fact about the chain being read.

**Arm 2 is built with direct SQL, and that is stated in the test rather than hidden.** No writer
produces the state: a poll engine's name embeds its chain and the derive cursor's chain binding
refuses a second one. This is defence-in-depth on a predicate whose scoping the schema cannot enforce
— the same posture, and the same disclosure, as
`TestRewindAnchorSweepSparesNeutralizedHeightsEvenThoughNoCallerCanReachThatState`.

**The mutation was run across the whole package** (M7 below): with `a.chain_id = $1` dropped, the ONLY
failure in `internal/store` is this new test — 144 other top-level tests pass. That is the wave-12
report's prediction ("would likely survive") confirmed by measurement rather than repeated as a
guess, and it is exactly what the fixture buys.

---

## Residual (c) — `AnchoredHeights` deleted

Gone from `PriceRepairExposure`, with its query, the fake's anchor loop, and the two test assertions
that were its only readers. A tombstone comment at each site carries the argument: the number was
honest — a fact about the ANCHOR population — but it sat one field away from `Unanchored`, which is a
per-OBSERVATION count, and reading the wrong one is Codex round 9's [high] #1 verbatim. Nothing was
trading a real capability for that risk, because it had **no production consumer at any point**.

`TestRepairExposureOffersNoPerHeightAnchorCount` pins the absence, in the same form as
`TestStoreHasNoOnlineRevalidationPrimitive`: a deletion only the compiler protects comes back the
first time somebody wants "just a count of anchors for a log line". It also asserts the four fields
that must stay, so it fails loudly if it is ever satisfied by the struct being emptied.

---

## Mutation matrix

Run against **committed** work (the brief's rule, and wave 12's lesson about a mutation loop
destroying its own uncommitted output). Restores are from a scratch copy of each file — **never `git
checkout`**, which is the standing rule since wave 6 and matters more than usual this wave, because
the concurrent health wave has uncommitted `cmd/indexer` edits in the shared tree the whole time.
Every row states the PROPERTY, because a killed mutation only proves the tests are load-bearing on
current behaviour and is silent on whether that behaviour is right.

| # | Mutation | Property it attacks | Result |
|---|---|---|---|
| M1 | WARN logs `validAtOrBelow = floorOffered` | the validity boundary reported is the one the store RETURNED | KILLED |
| M2 | `floorDisposition`'s clamped arm returns `admitted` | a clamped floor is disclosed as clamped | KILLED |
| M3 | `justification := evidence` (floor note dropped) | the justification is composed AFTER the store answers | KILLED |
| M4 | the unanchored split collapses to one bucket (all never-bound) | a dangling binding is attributed to a PRUNED anchor, not to a round that never recorded one | KILLED — and the never-bound test still PASSES under it, so the two populations are genuinely discriminated |
| M5 | the retired gloss returns ("no hash was ever recorded") | the unanchored gloss never claims no hash was ever recorded | KILLED (both store WARN tests) |
| M6 | "retained only where one still exists" → "retained forever for every one of them" | hash retention is claimed only for the population that still has an anchor | KILLED |
| M7 | `unprovableRow` drops `a.chain_id = $1` | provenance is chain-scoped: another chain's anchor at the same block vouches for nothing | KILLED — **only** by the new fixture; 144 other store tests pass under it |
| M8 | the no-floor arm reports `admitted` | an arm that offers no floor says so | KILLED (after the gap below was closed) |
| M9 | `AnchoredHeights` re-added to the struct | the exposure declares no per-HEIGHT anchor count | KILLED |

**9 mutants, 9 killed, one gap found by the loop and closed.** M8 initially had nothing to kill it:
the clamped and admitted arms were asserted, but `none-offered` — the disposition
`floorProvenOrphaned`, `floorNothingAtRisk` and the bootstrap all produce, i.e. the value most repairs
actually log — was untested. `82dc7ec` adds the assertion to
`TestPollerRepairNeutralizesWhenEveryAnchorIsProvenOrphaned` and M8 then dies.

**One false result caught by the harness rather than by luck, reported because wave 12's matrix was
nearly ruined by the same thing.** M4's first attempt was a two-line pattern; the files are CRLF, so
the `\n` inside it never matched. The applier reads the file as **bytes**, asserts the pattern occurs
**exactly once**, and prints the mutated line with its number — so it printed `NOT APPLIED: 0
occurrences` and refused, instead of reporting a SURVIVED for a mutation that was never made. M4 was
re-done as two single-line replacements, both printed as applied, and then killed. Every row above was
verified applied this way before its test ran.

After the loop, `git diff` on both mutated files is **empty** — the restores are byte-identical to
the committed blobs.

---

## Anything unverified, and the disclosures

- **The EXPLAIN measurement is not pinned by a committed test.** I measured the plan with a throwaway
  test and deleted it, so the erratum and the code comment are evidence-backed as of today but nothing
  will notice if the plan changes. Adding a fourth EXPLAIN test is a judgement call I left alone;
  wave 12's "argued, not EXPLAINed" caveat therefore still stands for the three converted reads, now
  with a correct index name.
- **Arm 2 of the two-chain fixture is not a reachable production state** (direct SQL, stated in the
  test). What it pins is the predicate, not a scenario.
- **`clamped` does not distinguish a partial clamp from a floor refused outright** on the poller side.
  Deliberate — see F1 — and the store's own WARNs make the distinction.
- **`validAtOrBelow` is redundant with `boundary` by value.** Deliberate, justified in the code, and I
  would rather defend a duplicated number than another round of "the operator read the wrong key".
- **Nothing here re-opens a Codex-approved file outside the prices unit.** The touched set is
  `internal/prices/{poller,prices,poller_test,prices_test}.go` and
  `internal/store/{prices,prices_binding_test,prices_repair_test}.go`, all inside the wave's scope.
  `internal/store/derive.go` was NOT touched this wave (it is the concurrent wave's file).
- **The scratchpad directory is shared with the concurrent wave** — its files appeared there
  mid-session. All of my working files are under a `wave14/` subdirectory; I neither read nor wrote
  anything of theirs, and their uncommitted `cmd/indexer` edits are untouched in the tree.
- **The ledger (`progress-phase2.md`) is not updated by this report**, because the concurrent wave is
  also appending to it; the wave line is left to the controller to avoid two writers on one file.
