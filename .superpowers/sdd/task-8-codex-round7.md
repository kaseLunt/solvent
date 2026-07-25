# Codex adversarial review — Task 8 wave 7 (round 7)

- **Target:** `8f0eeef` (code; `6460d36` report-only on top), diffed against `ed2f26e`
- **Verdict:** `needs-attention` — **NO-SHIP**
- **Codex session:** `019f98fa-6b89-7710-ba57-4d7e4b9e2320`
- **Resume:** `codex resume 019f98fa-6b89-7710-ba57-4d7e4b9e2320`
- Go execution blocked by sandbox temp-dir ACLs; **mutation claims assessed by inspection**, which is how two mislabelled mutations were caught.

**Finding trend: 11 → 8 → 5 → 4 → 3 → 1 → 7.** The count rose because wave 7 added an entire
revalidation subsystem. New machinery, new surface.

> NO-SHIP. Wave 7 does not satisfy D-011: normal polling can manufacture circular provenance, the bounded queue can permanently starve recoverable heights, unanchored markings remain irreversible, and single-endpoint deployments bypass clause 7.

Codex also adjudicated the report's §8 unverified list: items 1, 3–5, 8–10 acceptable; **item 2 is a
blocker**; item 6 needs an index; item 7 becomes unsafe through starvation.

## Findings (verbatim)

### [critical] Blocker: ordinary polling can manufacture provenance for old neutralized rows — `internal/store/prices.go:392-409`
`applyPrices` supersedes only observations present in the new round and then unconditionally inserts one anchor for the entire engine/height. If unanchored rows at H were neutralized and the next latest poll also lands at H with some assets skipped—or with every oracle reverting—the old rows remain marked while a new current-chain anchor is committed. `NeutralizedPriceAnchors` then associates those old rows with that new anchor, and revalidation restores values that may have been read from a replaced block. This is a third path around both adoption guards and makes the proof circular.
**Recommendation:** Bind provenance to each observation or poll generation. At minimum, refuse creation of a new height anchor while any pre-existing neutralized row at that height remains unsuperseded. Add a live-Postgres regression using a partial/all-revert round at the same height.

### [critical] Blocker: irreducible oldest entries permanently starve later revalidation — `internal/store/prices.go:1143-1153`
`NeutralizedPriceAnchors` always returns the oldest eight heights. A mismatching, genuinely orphaned height remains neutralized and retains its anchor, so it appears in every subsequent query. Once eight such heights exist, every later candidate is unreachable forever, including canonical rows incorrectly marked by a later repair. This directly defeats clause 6 and contradicts the claimed drain-progress rationale; **mutation M12 merely pins the starvation-causing order.**
**Recommendation:** Implement fair/resumable traversal that cycles past non-restorable candidates while still retrying them. Add a regression with at least eight permanently mismatching heights preceding a later canonical candidate.

### [high] Major: unanchored rows are still marked through an undo path that cannot fire — `internal/prices/poller.go:1179-1189`
When no anchor exists at or below the cursor, `verifyFloor` returns `floorUnverifiable` and repair neutralizes the rows. Those rows never enter `NeutralizedPriceAnchors`, explicit adoption now refuses them, and latest-only polling cannot revisit a past height. **The tests explicitly assert that this state lasts forever.** Such a row may have been canonical—lack of provenance does not prove orphaning—so this is precisely a marking created by the mechanism whose undo cannot fire, contrary to D-011 clauses 5 and 6.
**Recommendation:** Do not automatically neutralize unanchored legacy history under D-011. Either provide trustworthy per-row provenance, retain/block pending explicit operator resolution, or obtain a ratified decision exception that acknowledges permanent usability loss.

### [high] Major: the one-endpoint carve-out directly violates clause 7 — `internal/prices/poller.go:1396-1408`
`checkpointCorroborated` treats `agreementUnobtainable` as authorization to mark, even though D-011 unconditionally requires cross-endpoint agreement before marking. A configured single endpoint on a minority fork can therefore neutralize canonical history on its own word. Logging and eventual recovery do not satisfy the preventive gate, particularly because recovery is not guaranteed by the findings above. **Mutation M14 is mislabeled as safety evidence: it kills the fail-closed behavior required by the accepted decision.**
**Recommendation:** Fail closed whenever fewer than two independent endpoint views can corroborate the checkpoint. If availability for one-endpoint deployments is preferred, **amend and ratify D-011** rather than embedding an implementation-only exception.

### [medium] Major: `RewindPrices` still deletes anchors needed by retained neutralized rows — `internal/store/prices.go:1667-1670`
`RewindPrices` deliberately retains neutralized price rows but deletes every anchor above the target without the neutralized-height exemption. The poller interface does not currently expose this method, but `Store` itself does and repository tests invoke it with poll-engine identities. Any such call leaves exactly the permanent marked-without-provenance state clause 5 forbids, so anchor survival is not structurally enforced across store code paths.
**Recommendation:** Apply the neutralized-height exemption to `RewindPrices` anchor deletion or make the store reject `RewindPrices` for poll-owned engines structurally.

### [medium] Major: one permanent backlog row causes a growing full-history aggregate every minute — `internal/store/prices.go:1089-1093`
`NeutralizedPriceStats` filters by `invalid_reason` without an index containing that predicate or `observed_at`. While any backlog remains, `Step` runs this aggregate after every landed round. Because polled prices are never deleted, even one irrecoverable row causes repeated scans over an ever-growing owner history at the default 60-second cadence. The cost depends on total price history, not backlog size, so the report's bounded-anchor argument does not address it.
**Recommendation:** Add a forward partial index covering `chain_id`, `owner_engine`, `observed_at`, and `block_number` for the reorg marker, or maintain backlog statistics incrementally. Verify with `EXPLAIN ANALYZE` at projected table size.

### [low] Minor: the operator warning states the opposite of wave-7 recovery behavior — `internal/store/prices.go:1046-1049`
`NeutralizeUnverifiablePrices` is used for anchored as well as unanchored suffixes, but its warning says the affected rows have no anchors and that no later repair can verify them. Anchored rows are exactly what the new revalidation pass is meant to restore. The package documentation also still says a fresh observation is the sole recovery and marked rows are never retired. These claims can misdirect incident response in this correctness-critical path.
**Recommendation:** Report anchored and unanchored marked counts separately or use wording valid for both, and update the package-level recovery description to match D-011.

## Controller adjudication

**All 7 ACCEPTED.** Two are blockers by Codex's own classification.

### MUTATION TESTING HAS A FAILURE MODE, AND I OVERSOLD IT

Two mutations were **mislabelled as safety evidence**:

- **M12** "merely pins the starvation-causing order" — the mutation confirmed behaviour that is itself
  the defect.
- **M14** "kills the fail-closed behavior required by the accepted decision" — the mutation proved the
  code does what it does, where what it does violates D-011.

I introduced mutation testing this session and reported it as strong evidence. It is — for the
question *"does this test detect a change to this code?"* It is silent on *"is this code's behaviour
correct?"* A mutation that kills tests only proves the tests are load-bearing on the **current**
behaviour. If the behaviour is wrong, the mutation certifies the wrongness. **Mutation evidence must
be paired with a statement of the property the behaviour is supposed to have**, or it is
confidence-theatre. Recorded because I will otherwise repeat it.

### TEST INTEGRITY — FIFTH failure, same class as the first and fourth

Finding 3: *"The tests explicitly assert that this state lasts forever."* Wave 1 asserted data loss
was expected; wave 5 asserted `Ready=true` with live failures; wave 7 asserts permanent unusability.
Three separate waves have shipped a passing test that **ratifies** a loss the reviewer then had to
find. The instruction has been repeated in every brief since round 3 and has not taken.

### A GOVERNANCE QUESTION, NOT A CODE QUESTION (finding 4)

`checkpointCorroborated` treats `agreementUnobtainable` as authorization to mark. D-011 clause 7 is
unconditional. Codex is right that this is an **implementation-only exception to an accepted
decision** — the two legitimate resolutions are (a) fail closed with fewer than two corroborating
views, or (b) amend and ratify D-011. An implementation may not quietly carve an exception into
governance. **Escalated to the owner.**

### The count rose for a legitimate reason

1 → 7 is not regression; wave 7 added a revalidation subsystem, and three of the seven findings
(circular provenance, starvation, the stats aggregate) are defects *in that new machinery*. It does
mean "one finding left" overstated how close Task 8 was: the remaining finding was a design premise
whose repair required new code, and new code carries new findings.
