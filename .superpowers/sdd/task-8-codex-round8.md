# Codex adversarial review — Task 8 wave 8 (round 8, prices unit)

- **Target:** `63bf5b9` diffed against `6460d36` (code delta = wave 8 exactly)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 critical/blocker, 5 high, 1 medium; R6 approved)
- **Job:** `review-ms108y0g-lvx3no` (~14m34s), pinned worktree at `63bf5b9`
- **Codex session:** `019f9ba0-4d6e-7a00-b4ef-7e1f06183170` — resume: `codex resume 019f9ba0-4d6e-7a00-b4ef-7e1f06183170`
- Inspection-only (Go temp dir denied, TEST_DATABASE_URL unset in its env). Controller measured 498/576/0/0 at this commit and mutation-verified the R2 guard against live Postgres.

**Finding trend: 11 → 8 → 5 → 4 → 3 → 1 → 7 → 7.** Plateau, not convergence — see adjudication.

> NO-SHIP under D-006. R1: removal complete, but fabricated provenance remains possible. R2: the prefix guard works, yet clause-2 retention is not structural for every store state. R3: permanent anchors create cadence-time work proportional to retained classifications. R4 blocker: no-checkpoint repairs bypass both endpoint-count guards. R5: recounts remain unindexed, are not strictly transition-only, and can become stale while marked known. R6 approve. R7: some clause annotations overclaim D-012.

## Findings (verbatim)

### [critical][blocker] No-checkpoint repairs bypass the configured-endpoint rule — `internal/prices/poller.go:1411-1415`
When no anchor exists, `verifyFloor` returns `floorUnverifiable` without establishing a checkpoint (lines 1177-1187). `checkpointCorroborated` then returns success immediately at lines 1412-1413, before `corroborate` or the decision-site `EndpointCount` re-check. Consequently legacy unanchored rows can be marked with two or more configured endpoints without agreement, with zero endpoints, or with one endpoint without setting `singleView` and emitting the range disclosure. This directly contradicts D-012 clause 4. M5/M5b only validates checkpointed passes and does not cover this bypass.
**Recommendation:** Apply the configured-count rule before the no-checkpoint return. Fail closed for zero and multi-endpoint fleets unless a ratified exception is obtained; set `singleView` for exactly one endpoint. Add no-anchor cases for endpoint counts 0, 1, and 2.
**Controller verification:** confirmed by reading — `if !p.probeCheckpointSet { return true, false, "" }` with the no-anchor path never setting a checkpoint.

### [high][major] Removing the online consumer does not prevent fabricated offline provenance — `internal/store/prices.go:468-486`
`applyPrices` processes only observations present in the new round, then unconditionally inserts one height-wide anchor. If an unanchored neutralized row at H is omitted by a later partial or all-revert round at H, it remains marked while the new round's current-chain anchor becomes indistinguishable from provenance for the old row. The removed online consumer no longer restores it immediately, but the persisted state **poisons D-012 clause 2's promised offline recovery input**. Same hazard the retained `AdoptPollAnchor` refusal describes.
**Recommendation:** Bind provenance to each observation/poll generation, or refuse anchor creation while any neutralized row at that height remains unsuperseded. Add partial- and all-revert same-height regressions proving old rows remain durably unanchored.

### [high][major] `RewindPrices` can still strip provenance from retained neutralized rows — `internal/store/prices.go:1666-1680`
`RewindPrices` retains rows carrying `InvalidReasonUnverifiableReorg` but deletes every anchor above the target for any engine outside the poll prefix. `NeutralizeUnverifiablePrices` accepts every non-empty engine, so the public Store API can form a non-prefix neutralized state and then leave its retained rows without anchors — violating D-012 clause 2 ("no rewind on any store path"). The deleted defense-in-depth test would have exposed this.
**Recommendation:** Add the neutralized-height NOT EXISTS exemption to the rewind anchor deletion regardless of engine identity, or structurally prohibit non-poll identities from entering this state. Pin with a live-Postgres regression.

### [high][major] Permanent anchors make every poll rescan all retained classifications — `internal/store/prices.go:742-754`
`pruneOldPollAnchors` protects neutralized heights via correlated NOT EXISTS; those protected anchors survive forever and remain candidates on every later invocation, which `applyPrices` runs after every anchored round. Cadence-time work grows with the all-time number of classified heights.
**Recommendation:** Make pruning incremental or index/materialize the protected state. Validate with EXPLAIN ANALYZE and many retained neutralized heights.

### [high][major] The stats surface still scales with total history and is not transition-only — `internal/store/prices.go:1228-1232`
`NeutralizedPriceStats` count/min/max scans all marker rows; `00005`'s index does not cover the predicate. `readDurableState` always calls it (`poller.go:711-715`), that path runs after every uncertain apply (`poller.go:552-561`), and neutralization recounts twice (`poller.go:1660-1661`). Full scans off-transition and twice per repair; the R5 test measures only successful ordinary rounds. Violates D-012 clause 6's cost bound and measured-evidence requirement.
**Recommendation:** Maintain statistics transactionally/incrementally or add the required partial covering index; remove duplicate/off-transition recounts; provide projected-scale EXPLAIN ANALYZE evidence.

### [high][major] A failed transition recount remains falsely marked as known — `internal/prices/poller.go:1710-1718`
On a `NeutralizedPriceStats` error, `refreshNeutralizedBacklog` returns without clearing `neutralizedKnown`; a stale count persists indefinitely as current until another transition or restart, hiding a new gap or overstating a cleared one.
**Recommendation:** Set `neutralizedKnown=false` on every recount failure; add upward/downward transition tests proving the next ordinary round retries and corrects.

### [medium][minor] Clause annotations attribute behavior to the wrong decision text — `internal/prices/poller_test.go:1705-1745`
The one-endpoint test attributes the range-WARN requirement to D-012 clause 4 (it comes from the wave-8 brief R4); `prices_repair_test.go:444-458` and the report cite clause 1 for exposure-query filtering clause 1 does not specify. Precisely the citation mismatches R7 exists to prevent.
**Recommendation:** Cite the actual normative sources; re-audit the clause table after the substantive fixes.

## Controller adjudication

**All 7 ACCEPTED**, none waived.

### The plateau is diagnostic, and finding 2 corrects the controller

D-012's consequence section said the round-7 circular-provenance critical "dissolves with the
machinery that hosted it." **That was wrong.** D-012 clause 2 makes anchors the durable *offline*
recovery input — which makes anchor integrity load-bearing even with no online consumer. Removing
the reader removed the *exploitation path*, not the *write-side corruption*. The finding survives at
[high] instead of [critical] because nothing acts on the poisoned provenance automatically anymore —
but poisoned provenance breaks the exact promise D-012 makes. Owned as a controller adjudication
error, same class as D-010's unverified recoverability premise: a decision asserting a property
("offline recovery stays possible") without tracing what preserves it.

### The blocker is an implementation hole, not a design hole
Clause 4 is unambiguous; wave 8 gated the checkpointed arm and left the no-checkpoint arm returning
unconditional success. The M5/M5b mutation pair validated exactly the arm that was gated — mutation
coverage inherits the case-blindness of the tests it leans on.

### Clause-2 must be structural on every path
Findings 3 and R2's residual share one root: clause 2 was implemented as poll-prefix-scoped, but
`NeutralizeUnverifiablePrices` accepts any engine. Either the marking is restricted to poll-owned
identities (preferred: same structural style as R2) or every anchor-deletion path carries the
neutralized-height exemption unconditionally.

### Costs are now first-class clause obligations
Findings 4, 5, 6 are all clause-6 economics: permanent state must be cheap to carry. Transition-only
means transition-only; failure must mark unknown, not stale-as-known.

Fix wave: `.superpowers/sdd/task-8-wave10-brief.md`. Runs in parallel with wave 9 (health surface,
disjoint files); migration number `00007` if needed (`00006` is wave 9's).
