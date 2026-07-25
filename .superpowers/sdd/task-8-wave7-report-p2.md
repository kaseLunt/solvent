# Task 8 — fix wave 7 report: price-pipeline unit (A1, under D-011)

- **Base:** `e6092ef` — **Commit:** `8f0eeef`
- **Scope touched:** `internal/prices/**`, `internal/store/prices*.go`, `.superpowers/sdd/**` only.
- **No migration.** Nothing this wave needs is a schema change; `00006` was not created. §7.6.
- Codex round 6 returned NO-SHIP with one finding, and it was not a coding defect: it
  invalidated a premise in D-010. D-011 corrected the governance record first; this wave
  implements it.

---

## 1. What the finding actually was, restated so the fix can be checked against it

D-010's whole argument is an asymmetry: **deleting is unrecoverable, so remove it; marking
is recoverable, so prefer it.** The second half was asserted. Round 6 showed it was false as
implemented, and the chain of reasoning is worth keeping intact because every clause below
attaches to one link of it:

1. the named recovery was `insertPrice`'s supersede arm, which fires only on a **fresh
   observation at the same (chain, asset, source, block) identity**;
2. `readRound` polls `latest` — verified, not assumed: `Failover.CallWithToken`/`CallFrom`
   both issue `CallContract(..., nil)` (`internal/chain/chain.go:315,345`), and nil block
   number *is* `latest`. There is no code path by which this poller executes a price read at
   a chosen height;
3. therefore, once the canonical head passes H, **no round will ever execute at H again**, so
   the supersede arm can never fire for any past height;
4. and neutralization additionally **deleted the anchors**, so even a caller that wanted to
   re-check H had nothing to check it against.

Net: a self-consistent minority-fork pass left canonical polled rows permanently
`valid=false`, while newer polls cleared the acute health signals and hid the gap.

The shape of the wave-6 error is worth naming once: D-010 said *never delete polled price
**rows***, and wave 6 honoured the letter while still deleting **anchors** — keeping the
wording and losing the intent, which was to retain enough to recover.

**The asymmetry that makes clause 6 possible at all.** A price at H can only be re-read by
executing at H, which this system cannot do. But the *ancestry* of H is a header read,
available for any height from any node, forever — and the round already wrote down which
block it executed against (`HeaderHashFrom` → `HeaderByNumber(ctx, big.NewInt(n))`,
arbitrary height). So "is this row's block still canonical?" stays answerable for
arbitrarily old H even though "what was the price at H?" does not. Recovery needs a new
**proof** about H, not a new **poll** at H.

---

## 2. D-011 clause by clause

### Clause 5 — neutralization must not delete anchors

`store.NeutralizeUnverifiablePrices` no longer runs
`DELETE FROM price_poll_anchors ... block_number > effectiveTarget`. Two consequences had to
be handled rather than assumed, because the deletion was silently doing **two jobs**:

| The deletion did… | …and it was |
|---|---|
| destroy the block-hash provenance | **wrong** — it is what removed the recovery |
| keep the *frontier* reads honest (block-advance clock, regression attribution) | **right** |

Splitting them:

- **`NewestPollAnchor` now excludes anchors at heights carrying a marked row.** Before, the
  exclusion was implicit because the row was gone. Without it, a deep reorg would leave the
  newest anchor pointing at an orphaned height with an old database timestamp, permanently
  tripping `ConditionPollBlockAdvance` and making every later cursor regression classify as a
  fresh reorg instead of a stale endpoint. Retaining provenance must not change what the
  frontier *means*. Pinned by `TestNeutralizationRetainsAnchorsAboveTheBoundaryForRevalidation`
  (mutation M10).
- **`pruneOldPollAnchors` exempts heights carrying a marked row.** A retention bound that
  ages out the recovery path is a slow version of the deletion clause 5 forbids: the marking
  would be reversible for `pollAnchorRetention` rounds and then quietly permanent. The
  exemption is **self-limiting** — it holds a height only while a marked row is there, and a
  successful revalidation hands the anchor straight back to the ordinary bound. That second
  half is asserted, not argued: `TestPollAnchorRetentionExemptsNeutralizedHeights` recovers
  the row and shows retention then takes the anchor (mutation M7).

Retained anchors do **not** leak into the repair path: `PollAnchorsBelow` is scoped at or
below the cursor, which the same transaction resets to the boundary, so they sit above every
height a pass looks at until fresh polls carry the cursor back over them — by which point a
match at one of them is a true statement about the live chain, which is what a floor means.

### Clause 6 — recovery must work for past heights without a new poll there

Two store primitives and one poller pass.

- **`store.NeutralizedPriceAnchors(engine, chain, limit)`** — the candidate list, a JOIN of
  marked rows to *surviving* anchors, **oldest first**. The ordering is contract, not
  accident: a bounded per-Step budget means some candidates always wait, and draining the
  oldest first is what makes the backlog *age* (clause 8) a true measure of progress rather
  than a number pinned to a row nothing reaches.
- **`store.RevalidateNeutralizedPrices(engine, chain, block, provenHash)`** — clears the
  marker where `provenHash` **equals the recorded anchor**, checked inside the transaction.
  The caller's proof is never trusted: a poller that probed the wrong height, misread a
  token, or guessed cannot un-mark anything, and a height whose anchor is gone has no
  satisfying `EXISTS` row. That is what makes clause 5 *structurally* load-bearing rather
  than a convention. It deliberately does not re-stamp `observed_at` (§below), does not touch
  rows quarantined for a different reason, and is owner- and chain-scoped.
- **`Poller.revalidateNeutralized`** — bounded at `revalidationPerStep = 8` heights, run once
  per cadence interval on the no-epoch path. Each candidate is probed, corroborated on a
  second endpoint (clause 7, §below), then restored.

**Why each candidate may use its own endpoint while `verifyFloor` pins one.** `verifyFloor`
assembles a *chain* of proofs ("5000 orphaned, 4900 orphaned, 4800 canonical") which only
compose if they describe one ancestry — that is A1's fifth round. A revalidation is a single
**positive, self-contained** claim about one height. It composes with nothing, so there is no
ancestry to keep coherent, and spreading candidates across endpoints spreads the reliance
instead of concentrating it. Stated in the code, not only here.

**One thing I checked rather than assumed: restoring a row cannot re-open the divergence
wedge the supersede arm exists to close.** That arm exists because a chain whose head still
sits at a neutralized height would otherwise fail every round on an unresolvable price
divergence — and revalidation runs *before* the round, so it could in principle hand back a
valid row and remove the arm's trigger. It cannot: a row is restored only when the live chain
reports at that height the very block hash the round recorded, so a poll landing at that
height executes against that same block, `eth_call` at a fixed block is deterministic, and
the insert is an ordinary idempotent replay. A row read at a *different* block at that height
— the only case where values could differ — is precisely the case whose anchor does not match
and which is therefore never restored. **The property holds because the proof is a block-hash
identity and not a height.**

### Clause 7 — marking requires cross-endpoint agreement

`Poller.corroborate` + `Poller.checkpointCorroborated`, gating every marking arm in `repair`.

**Why corroborating one height corroborates the whole pass.** A block hash commits to its
entire ancestry, so two endpoints reporting the same hash at height C hold identical chains
at every height at or below C. Every probe a pass makes is at or below its checkpoint —
`noteCheckpoint` records the highest height the pass has an answer for and only ever moves
upward, while pages descend, and a probe that errors ends the pass rather than contributing.
So one extra RPC call per repair covers every mismatch proof the pass holds, on exactly the
entailment `checkpointStillHolds` already uses for time.

**Why one call reaches every other endpoint.** `HeaderHashFrom` is a failover walk
(`Failover.doFrom`, verified: walks from `start`, returns the first success with its index,
touches no shared hint). Starting it at `primary+1` tries every other endpoint before it
could come back round. The one case that must be caught is the walk wrapping back to
`primary` — an answer from the endpoint being corroborated is not a second opinion, and
accepting the token without checking it is the same silent-failover mistake `probeAnchor`
exists to refuse. Mutation M4 kills exactly that check.

Four outcomes, because "no" and "could not ask" have different remedies:

| Outcome | Behaviour |
|---|---|
| `agreementConfirmed` | proceed |
| `agreementContradicted` | refuse, **discard the pass and rotate the pin** — over successive Steps that is how a poller pinned to a fork gets off it |
| `agreementUnavailable` | refuse, **keep** the pass (missing evidence, not contrary evidence) |
| `agreementUnobtainable` (one-endpoint fleet) | proceed, with a loud disclosure every time |

**Clause 7 also governs restoring**, and the asymmetry argument is why: retaining a marked
row costs availability, restoring a row whose block is not canonical serves a price from a
block that does not exist — a correctness fault. So a single endpoint's match does not
un-mark either.

**The one ungated marking arm, and why it is not a loophole.** `floorUnverifiable` reached
with **no checkpoint at all** — this engine has no anchor at or below the cursor — is not
gated. That is the single state in which no endpoint's chain view is being trusted: the
marking rests on a durable fact about the store (we hold rows whose block hash was never
written down) that every endpoint would report identically because none is consulted.
Requiring agreement there would demand corroboration of a claim nobody made, and since no
anchor can ever appear for those heights while the epoch stands (adoption is refused), the
refusal could never clear — a fail-forever stall. I traced every path into the marking arms
to confirm this is the *only* uncorroborated one: `floorVerified` and `floorProvenOrphaned`
both require a successful probe (hence a checkpoint), and the in-loop `floorUnverifiable`
arm follows a match. `floorNothingAtRisk` marks nothing; `floorUnprobed` acts on nothing.

### Clause 8 — a cleared acute signal must not hide a historical gap

The acute conditions are all about the head: `ConditionPollInvalidAnswer` clears the moment a
valid observation lands for an asset. None of them can see unreadable history below the
frontier.

- The count and age already existed (wave 6). What this wave adds is that they **stay
  current**: `refreshNeutralizedBacklog` now runs after every landed round while a backlog
  exists (or while the count is unknown). A known-empty backlog is skipped because it cannot
  have changed — the only two things that move it are neutralization, which refreshes on its
  own, and a supersede, which needs a marked row to supersede.
- A **drain to zero** is now reported. Wave 6 returned early on `Rows == 0`, so the one
  transition an operator most wants to see land — "the historical gap is closed" — was
  silent. It could not happen before clause 6; it can now.

Surfacing composes with the health/readiness unit, which owns that decision; it remains
deliberately **not** a condition here, because part of the pile is irreducible (rounds whose
block the chain genuinely discarded never revalidate) and a condition keyed on its existence
would latch `/readyz` red forever.

---

## 3. The required regression (Codex's own wording), and what makes it genuine

`TestPollerRevalidatesAPastHeightWithoutAnotherPollThere` —
*a minority endpoint marks block H, the canonical head advances beyond H, and H becomes
usable again without another poll executing at H.*

**The marking is a real one, not a contrived one.** Both endpoints report the fork while it
stands, so the clause-7 agreement gate is genuinely satisfied and the pass acts on the
strongest evidence the system can obtain. Then the fork loses — a reorg of the reorg, the
case this package's generation/checkpoint machinery already exists for — and the block at H
is canonical again. A test that bypassed clause 7 to produce the marking would be testing
recovery from a state the code no longer reaches.

Three assertions carry it, and no one of them alone would be worth much:

1. **No poll executed at H after the marking** — checked across the store's *entire* apply
   record, by through-block and by observation block, not merely against the round the test
   scripted.
2. **The row's `observed_at` is unchanged.** This is the load-bearing discriminator. A
   supersede re-stamps it (the fake models that because the store does); a revalidation must
   not, because nothing was re-read. That single field separates "recovered by new evidence
   about the old observation" from "quietly replaced by a new observation" — which is exactly
   the distinction D-010 got wrong. Mutation M15 makes the fake re-stamp and the test dies.
3. **The head really moved past H** — the round lands at 5200 and the cursor follows, so H is
   genuinely historical rather than still at the frontier.

Plus the enabling condition, asserted in the same test: the anchor at H **survived** the
marking (mutation M1 restores wave 6's anchor sweep and the test dies at that line).

Codex offered agreement **or** revalidation. Both are built, and the pair is regression-tested
from both directions: `TestPollerRefusesToMarkWhenASecondEndpointContradictsThePass` is the
finding's own scenario refused at source (a coherent minority-fork pass marks nothing, and
when the fork resolves the epoch is answered with the "orphaned" row **still valid**).

---

## 4. A defect my own new test caught, and the fix

`TestPollerCannotRevalidateAMarkedHeightWithNoSurvivingAnchor` failed on first run, and the
reason was a hole I had just opened.

`adoptLegacyAnchors` records the **live chain's current hash** at a height where this engine
owns unanchored rows. Its doc has always said this "does not prove the adopted block is the
one the rows were read at". Under D-010 that was a limitation, not a hazard, because nothing
could un-mark a row. **Clause 6 turns it into a hazard:** adopt at a *neutralized* height, and
revalidation then checks the chain against a hash copied from that same chain and restores
rows a repair had just declared unplaceable. Circular — a proof of nothing — and it would
have served prices from blocks that may never have been canonical.

Fixed in two places, deliberately:

- `UnanchoredPriceBlocks` no longer proposes heights carrying a marked row (so the poller does
  not spend a probe on a candidate it must not adopt);
- `AdoptPollAnchor` **refuses** them (so the property does not depend on the query).

Provenance is witnessed at poll time or it does not exist. Mutations M8a/M8b kill each half
independently. This also corrected `TestPendingEpochWithUnanchoredHistoryHasATerminating‑
Transition`, whose prose already said neutralized rows are "deliberately left as unusable
artifacts" while its assertion adopted an anchor at one of them — the comment and the
assertion had disagreed, and the new gate resolves it in favour of the comment.

---

## 5. Mutation verification — 15 mutations, 15 killed

Every mutation was applied to the **committed** tree `8f0eeef`, the single target test run,
then reverted. (Wave 6 destroyed its own uncommitted work mid-mutation; this wave committed
first. `git diff HEAD` exits 0 afterwards — see §6.)

| # | Mutation | Target test | Observed failure |
|---|---|---|---|
| M1 | fake neutralization deletes anchors again (wave 6 behaviour) | `…RevalidatesAPastHeightWithoutAnotherPollThere` | `[]uint64{0x1324} does not contain 0x1388` — *"the provenance for H must outlive the marking, or there is nothing to revalidate against"* |
| M1b | **real store** deletes anchors again | `…RetainsAnchorsAboveTheBoundaryForRevalidation` | `expected: []PollAnchor{{0x1388, …0x50}}  actual: []PollAnchor{}` — *"the anchor above the boundary SURVIVES"* |
| M2 | drop the `revalidateNeutralized` call from `Step` (clause 6 off) | `…RevalidatesAPastHeightWithoutAnotherPollThere` | `Should be true` — *"the row at H is readable again"* |
| M3 | **drop the clause-7 gate from `repair`** | `…RefusesToMarkWhenASecondEndpointContradictsThePass` | `Should be false` — *"one endpoint's coherent story is not evidence that its chain is canonical"* (this is round 6's finding reappearing) |
| M4 | `corroborate` accepts an answer served by the primary itself | `…RefusesAProbeSilentlyServedByAnotherEndpoint` | `Should be false` — *"a coherent pass that no second endpoint can corroborate does not act"* |
| M5 | revalidation skips corroboration (always confirmed) | `…LeavesARevalidationCandidateMarkedWithoutAgreement` | `Should be empty, but was [4000]` — *"one endpoint's match does not restore a row"* |
| M6 | `RevalidateNeutralizedPrices` drops the recorded-anchor `EXISTS` arm | `TestRevalidationRestoresOnlyOnTheRecordedAnchorHash` | `Should be zero, but was 1` (a caller-invented hash restored a row) |
| M7 | `pruneOldPollAnchors` loses the neutralized exemption | `TestPollAnchorRetentionExemptsNeutralizedHeights` | `expected: 0x1  actual: 0x1a` — *"the neutralized height's anchor outlives the retention bound"* |
| M8a | `AdoptPollAnchor` loses the circularity gate | `TestPendingEpochWithUnanchoredHistoryHasATerminatingTransition` | `An error is expected but got nil.` |
| M8b | `UnanchoredPriceBlocks` loses the neutralized exclusion | `TestUnanchoredPriceBlocksSkipsNeutralizedHeights` | `expected: []uint64{0x1356}  actual: []uint64{0x1388, 0x1356}` |
| M9 | remove the post-round backlog refresh (clause 8) | `…NeutralizedBacklogSurvivesAndIsRefreshedByANewerRound` | `expected: 1  actual: 2` — *"the count is CURRENT: hydration read 2, the round superseded one, and the number followed"* |
| M10 | `NewestPollAnchor` loses the neutralized exclusion | `…RetainsAnchorsAboveTheBoundaryForRevalidation` | `Should be false` — *"the only surviving anchor sits at a neutralized height, so this engine has no USABLE frontier"* |
| M11 | revalidation re-stamps `observed_at` (**store**) | `TestRevalidationRestoresOnlyOnTheRecordedAnchorHash` | `expected: …20.342805000  actual: …20.370136000` |
| M12 | candidate list ordered newest-first | `…AnchorsJoinMarkedRowsToSurvivingProvenance` | `expected: {0x12c0,0x1324,0x1388}  actual: {0x1388,0x1324,0x12c0}` |
| M13 | fake drops the adoption circularity gate (both halves) | `…CannotRevalidateAMarkedHeightWithNoSurvivingAnchor` | `Should be empty, but was [4000]` — *"no provenance, no recovery"* |
| M14 | one-endpoint fleet refuses instead of acting | `…MarksOnAOneEndpointFleetAndDisclosesTheMissingAgreement` | `Should be true` — *"a single-endpoint fleet must not be wedged by an unobtainable agreement"* |
| M15 | fake re-stamps `observed_at` on revalidation | `…RevalidatesAPastHeightWithoutAnotherPollThere` | `Not equal` — *"the recovered row keeps its ORIGINAL observation time: this is a new proof about an old read, not a new read"* |

---

## 6. Test integrity, against the four prior failures in this series

- **No test asserts harmful behaviour as expected.** One test was *inverted*:
  `TestNeutralizationDropsAnchorsAboveTheBoundary` → `…RetainsAnchorsAboveTheBoundaryFor‑
  Revalidation`. It asserted precisely what D-011 clause 5 forbids. The replacement does not
  merely flip the expectation — it pairs the retained anchor with an immediate demonstration
  that it is *sufficient* to restore the marked row, and shows the unanchored sibling
  correctly staying marked.
- **Two tests were tightened by the new gate rather than relaxed.**
  `…RefusesAProbeSilentlyServedByAnotherEndpoint` previously recovered on its second pass;
  it now shows that pass being **coherent and still not enough**, refusing on missing
  corroboration, and only completing once the second endpoint can answer. Every safety
  assertion in it is unchanged or stronger. `…RunsOneCoherentEndpointAcrossDivergent‑
  Ancestries` replaced a general "every probe from one endpoint" loop with a stricter split:
  the pass and its checkpoint re-read from one endpoint, the corroboration from a *different*
  one, at the checkpoint height — three pinned facts where there was one.
- **No test assumes a transition Postgres cannot make.** All five new store-side claims are
  **live Postgres** tests, because each is a claim about which rows a predicate selects
  (`TestRevalidationRestoresOnlyOnTheRecordedAnchorHash`,
  `…AnchorsJoinMarkedRowsToSurvivingProvenance`, `TestPollAnchorRetentionExemptsNeutralized‑
  Heights`, `TestUnanchoredPriceBlocksSkipsNeutralizedHeights`, plus the adoption gate inside
  the deadlock test). The `invalid_reason = ''` assertion is checked against the
  `prices_invalid_reason_iff_invalid` CHECK, so Postgres is agreeing rather than the test
  asserting its own model.
- **No scenario is set up without its substance.** The required regression's marking passes
  every gate the system has rather than being injected; the clause-8 test's count actually
  *changes* across the round (2→1 via a real supersede) rather than merely being re-read.
- **The fake was extended to model the new store semantics, not to make tests pass.** Four
  changes, each mirroring a real predicate and each independently mutation-killed: no anchor
  sweep on neutralization (M1), `NewestPollAnchor` frontier scoping, the adoption
  circularity gate (M13), and `RevalidateNeutralizedPrices`' recorded-anchor requirement.
- 10 new top-level tests, all mutation-verified.

---

## 7. Verification

```
go build ./...   OK
go vet ./...     OK
gofmt -l .       (no files listed — output read, not just the exit code)
go test ./... -count=1
```

**497 top-level PASS / 575 incl. 78 subtests / 0 FAIL / 0 SKIP** (baseline 487 / 565 / 0 / 0
at `ed2f26e`; +10 = the 10 new tests). **Convention:** "top-level" = `^--- PASS` at column 0;
the 575 figure additionally counts indented subtest lines. Live Postgres `solvent-db-1` via
`TEST_DATABASE_URL`.

`go test ./... -count=1 -race` in the `golang:1.24` container against live Postgres over
`host.docker.internal`: **all 9 packages ok, no races.**

No gate blocked anything: `control-plane doctor` reported **0 errors / 0 warnings / 2 info**
and `scope-gate: OK — 6 path(s)`. Staged by explicit pathspec; never `git add -A`.

**Line-ending note, resolved rather than left as a puzzle.** Serena's symbolic edit tools and
`git checkout --` both materialise files as CRLF under `core.autocrlf=true`, after which
`gofmt -l` lists them (and exits 0 anyway). Every mutation revert was followed by
`gofmt -w`; the final `gofmt -l .` output is **empty**, and `git diff HEAD --quiet` exits
**0**, so the working tree's content is byte-identical to `8f0eeef`. `git status` still shows
the three files as `M` — that is the working-copy line-ending form only, which the empty
`git diff` proves.

**Size.** `internal/prices/poller.go` non-comment lines 795 → 917 (+122);
`internal/store/prices.go` 762 → 861 (+99). This wave **adds** machinery rather than removing
it, unlike wave 6, and that is what D-011 asks for: clause 6 is a recovery path that did not
exist, and clause 7 is a gate that did not exist. The additions are four store primitives/
predicates and three poller methods (`corroborate`, `checkpointCorroborated`,
`revalidateNeutralized`); no proof obligation was re-discharged.

---

## 8. Things I could not verify, and the costs I am choosing

1. **Clause 7 creates a NEW way to stall, and it is not a small one.** While no second
   endpoint will corroborate, the epoch stays unanswered and no price is applied — `/readyz`
   red, pipeline stopped. Two endpoints permanently on different forks never repair. That is
   the decision's choice (clause 7: retention costs availability, never correctness) and it
   is written into `blockRepairOnAgreement` where an operator will read it, but it is a real
   regression in availability against wave 6.
2. **The one-endpoint concession is a genuine asymmetry, and I am defending it rather than
   hiding it.** A fleet of one may mark on a single view; a fleet of many with only one
   *reachable* endpoint may not. The distinction is configuration versus fault: a fleet of
   one is chosen, visible at startup, and stable, whereas treating an unreachable peer as
   permission would mean one timeout is all it takes to mark canonical history on one node's
   word. Reasonable people could call this inconsistent; the reasoning is in the code.
3. **Two colluding endpoints defeat clause 7.** It is a majority-of-what-we-can-reach
   argument, not a cryptographic one. Its failure mode is bounded by clause 6, and the code
   says so rather than claiming more.
4. **Revalidation does not run while a repair is blocked.** It sits on the no-epoch path, so a
   backlog accumulated earlier does not drain while a *later* epoch is stuck (e.g. on the
   clause-7 refusal above). Recovery resumes when repair does. I judged the state-machine
   simplicity worth more than draining during a pending epoch; the store primitive itself is
   safe under a pending epoch and says why, so moving it later is a one-line change.
5. **The bootstrap arm of `repair` is not corroborated.** A poller with no cursor calls
   `neutralize(0,0)`, which marks nothing in every state the store can actually produce
   (rows and cursor are written in one transaction). Routing it through the gate would be a
   no-op anyway — it has no checkpoint. Pre-existing, disclosed, unchanged.
6. **No migration, and the index question is reasoned rather than measured.**
   `NeutralizedPriceAnchors` drives from `price_poll_anchors` (bounded by
   `pollAnchorRetention` = 4096 plus the exempted heights) and probes `prices` through
   `prices_owner_idx`. Worst case is one pass over this engine's anchors with an index lookup
   each, once per poll interval, and **only while the backlog is non-empty**. I did not
   `EXPLAIN` it against a large table, and I did not add the partial index on
   `prices (chain_id, owner_engine, block_number) WHERE NOT valid` that would make both this
   and `NeutralizedPriceStats` index-only — that is a `00006` someone should take if the
   backlog is ever large in production.
7. **Anchor growth is now bounded by `pollAnchorRetention` + irrecoverable marked heights.**
   The second term grows with reorg frequency and is not bounded in principle. It is one
   anchor row per marked height — the same accepted cost D-010 named for the rows themselves,
   now made durable instead of quietly discarded, and countable through the same statistic.
8. **Restored rows can sit above the cursor.** Revalidation does not move the cursor, so a
   restored height above the boundary becomes `Owned` in `PriceRepairExposure` again. I traced
   this: such rows are anchored by construction (they could not have been restored otherwise),
   so a later repair can prove them rather than being forced to `floorUnverifiable`. It is a
   behaviour change from wave 6 and I am flagging it as one.
9. **Not exercised against a real multi-endpoint RPC fleet.** All endpoint-divergence and
   corroboration evidence is against the rebuilt `(endpoint, height)` fake — which does model
   `Failover.doFrom`'s walk faithfully (re-verified this wave against
   `internal/chain/chain.go:110-128`), but is still a fake.
10. **Untouched as instructed:** `cmd/indexer/health.go`, the readiness composition in
    `cmd/indexer/main.go`, lag bounds, `internal/store/derive.go`, `internal/ingest/walker.go`,
    `internal/snapshot/snapshot.go`, `roadmap/**`, `.env.example`, migrations `00001`–`00005`.
    Round 5's snapshot-readiness and timestamp-lag findings remain open and belong to the
    health/readiness unit.

Returns to Codex for round 7 under D-006.
