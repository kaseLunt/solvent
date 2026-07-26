# Codex adversarial review — wave 10 (round 9, PRICES unit)

- **Target:** `fdb9f8d` (prices delta = `c6d7267` + `8b6c25d`; report `e16d39f`), diffed against `63bf5b9`
- **Verdict:** `needs-attention` — **NO-SHIP** (2 high, 2 medium)
- **Job:** `review-ms14bi1e-8wwd1n` (~12m42s), pinned at `fdb9f8d`
- **Codex session:** `019f9c08-a372-7130-b578-ebfd7c68f242`
- Inspection-only (sandbox). Implementer verified 541/626/0/0 in a clean worktree; controller verification deferred to merged HEAD.

**Prices-unit trend: round 8 = 1 critical + 5 high + 1 medium → round 9 = 2 high + 2 medium.**
CLOSED: F1 (no-checkpoint arm gated, stall honestly documented as clause-4-prescribed), F5/F6
(transition-only stats, fail-unknown), the 6→7 schema seam.

## Findings (verbatim)

### [high] The new anchor binding does not govern repair, so a later round can still bless an unbound row — `internal/store/prices.go:1129-1136`
`PriceRepairExposure` and `CountUnanchoredPricesAbove` still decide provenance by joining an anchor to `p.block_number`, not `p.anchor_block`. A legacy NULL-bound row at H followed by a partial or empty anchored round at H is therefore reported as anchored. If that later anchor matches during repair, `verifyFloor` establishes H as a height-wide floor and the old observation remains valid even though its own round was never vouched for. That can leave an orphan-fork price usable — the exact fabrication migration 00007 says no consumer may perform. M2 only mutated the neutralization WARN split, while the poller fake still models the old height rule, so the 11/11 matrix does not cover this arm.
**Recommendation:** Make `PriceRepairExposure`, `CountUnanchoredPricesAbove`, candidate-floor handling, and neutralization reason per observation through `anchor_block`. NULL or a missing bound anchor must remain unprovable throughout the repair range, including at or below a later matching height anchor. Add a live-store and poller regression for an unmarked NULL-bound row sharing H with a later anchor.

### [high] Restarted pollers re-adopt retention-pruned anchors and can silently change what a binding refers to — `internal/store/prices.go:1488-1499`
`UnanchoredPriceBlocks` selects every owned row whose height anchor is absent, including post-00007 rows whose genuine anchor was deliberately pruned. After a restart `legacyAnchorsAdopted` is false, so the poller adopts the current hash at those heights. Because the old anchor is gone, `insertPollAnchor` has no hash against which to detect divergence; an existing `anchor_block=H` can now resolve to a replacement block's hash. A successful following poll prunes the adopted old anchor again, allowing the adoption/prune cycle to repeat at cadence. This recreates F2's fabricated provenance and contradicts F4's claim that adoption is one-time work rather than cadence work.
**Recommendation:** Never adopt over a non-NULL binding whose anchor has been pruned, and prevent reuse of an anchor identity once observations were bound to its former hash. Reconsider legacy adoption entirely under the ratified NULL-is-unprovable semantics. Add a restart regression with more than `pollAnchorRetention` rounds and a chain hash change before the epoch is observed.

### [medium] Rewind's defense preserves row-height anchors, not the anchor a marked row is bound to — `internal/store/prices.go:1936-1943`
The anchor sweep exempts only an anchor whose `block_number` equals a marked row's `block_number`. `ApplyPolledPrices` legally accepts observations below `throughBlock`, so a row can be bound to an anchor at a different height. In the same direct-marked state used by the committed defense-in-depth test, `RewindPrices` will retain that marked row but delete its actual anchor, leaving `anchor_block` dangling. The public identity guards make this state unreachable through the current repair APIs, but the test and D-012 clause 2 explicitly require the deleting statement itself to preserve provenance independently of those guards.
**Recommendation:** Add a second NOT EXISTS exemption on `p.anchor_block = a.block_number`, matching `prunePollAnchorsQuery`. Extend the live regression with an observation block below its execution/anchor block.

### [medium] F7 remains open because the ratified addenda are not used and a superseded citation remains live — `internal/store/prices_repair_test.go:460-468`
The ratified addenda say tests cite ADD-1/ADD-2, but no scoped source or test does. This test still states that exposure filtering has no clause and is merely nominated, despite ADD-2 now being ratified; the single-view tests still cite the wave-8 brief rather than ADD-1. `poller_test.go` also retains a live 'D-011 CLAUSE 7' heading and says clause 7 mandates the stall, although the current source is D-012 clause 4. Separately, `poller.go:1921-1922` still claims the no-checkpoint arm is not gated at all, contradicting F1's implemented and reported correction.
**Recommendation:** Cite ADD-2 here and ADD-1 in every single-view disclosure assertion, replace the remaining live D-011 clause-7 attribution with D-012 clause 4, and correct the stale no-checkpoint comment before claiming F7 closed.

## Controller adjudication

**All 4 ACCEPTED.** Fix wave: `.superpowers/sdd/task-8-wave12-brief.md` (parallel with wave 11, disjoint files).

- **Sequencing fairness on the [medium] citations finding:** ADD-1/ADD-2 were ratified at `fdb9f8d`,
  AFTER wave 10's commits — the wave could not cite a file that did not exist; its report correctly
  said "nominated." The propagation is owed NOW, plus the two genuinely stale items (the live D-011
  clause-7 heading; the no-checkpoint comment contradicting F1's own fix).
- **Both highs are the one-arm disease again, at the data layer:** F2 bound provenance at write-in;
  every read-side consumer (`PriceRepairExposure`, `CountUnanchoredPricesAbove`, floor handling,
  adoption selection) still speaks the old height dialect. Wave 12's instruction is to grep every
  consumer of anchors/`anchor_block` and convert or justify EACH — closing the class, not the cites.
- **The adoption finding kills legacy adoption's premise:** under ratified NULL-is-unprovable
  semantics, adopting current hashes at unanchored heights serves no remaining purpose and is now a
  fabrication engine after restarts. Prefer deletion of the adoption path over repair of it (the
  session's proven pattern), unless a concrete population still needs it — name it if so.
