# Codex adversarial review — Task 8 wave 5 (round 5)

- **Target:** `cb00f09` (wave 5), diffed against `e262f0a`
- **Verdict:** `needs-attention` — **NO-SHIP**
- **Codex session:** `019f9825-d59c-7d53-b2cd-06564ddc4dcb` (job `review-ms01i4w8-drwxsm`, ~12m12s)
- **Resume:** `codex resume 019f9825-d59c-7d53-b2cd-06564ddc4dcb`
- Go execution inspection-only (sandbox denied Go temp dir); Codex explicitly notes this does not contradict the controller's measured evidence (480 top-level / 558 incl. subtests / 0 FAIL / 0 SKIP).

**Finding trend: 11 → 8 → 5 → 4 → 3.**

> NO-SHIP. A1 still permits irreversible deletion under mixed RPC fork views, readiness explicitly stays green with failed or missing collateral, and nominal block counts do not enforce the claimed ten-minute bound.

## Findings (verbatim)

### [high] A1 checkpoint does not validate proofs collected from other endpoint ancestries — `internal/prices/poller.go:1082-1092`
Successive anchors are deliberately probed through different endpoints, but the final checkpoint revalidates only the endpoint that answered the highest probe. Its unchanged hash commits only to that endpoint's ancestry, not results returned by other endpoints. For example, endpoint 0 can mismatch the highest anchor while retaining the middle anchor in its ancestry, endpoint 1 can mismatch that middle anchor on another fork, and endpoint 0 can match a lower anchor. The unchanged endpoint-0 checkpoint then authorizes deletion of the middle anchor even though it is canonical on the checkpoint chain. **The fake returns hashes by height only, so the new tests cannot model this disagreement.**
**Recommendation:** Run each proof pass against one coherent endpoint without silent failover, or run complete per-endpoint passes and require agreement. Restart or retain data on endpoint disagreement. Add a fake keyed by endpoint and height that exercises divergent ancestries.

### [high] Snapshot readiness remains green while collateral is failed or absent — `cmd/indexer/main.go:871-885`
The condition is emitted only when `Exhausted > 0`. After a first failed account read, `SweepProgress` reports `Failed > 0` and `Exhausted == 0`, so readiness remains green even if that account has never produced collateral. Retries can be delayed behind all lagging or never-swept accounts, and opening the next generation removes the prior failed row from the current-generation count before it succeeds. **The regression test explicitly expects `Ready=true` with two current failures, codifying the unsafe policy rather than detecting it.**
**Recommendation:** Gate on actual collateral usability: expose current registry accounts with no successful snapshot or a snapshot older than an explicit bound, preserve unresolved status across generation rollover, and clear it only after that account succeeds. Replace the test expecting readiness with failure/recovery coverage.

### [medium] Fixed block counts do not enforce the stated ten-minute time bound — `cmd/indexer/main.go:193-201`
`chainLagBound` converts ten minutes using nominal 12-second and 2-second block cadences. Produced-block distance is not elapsed time: missed Ethereum slots or slower OP production make 50 or 300 blocks span more than ten minutes while the comparisons still pass. Head freshness only establishes that the head itself is current; it does not establish the timestamp of the consumer cursor. Thus the documented liquidation-facing time guarantee can be false-green under degraded block production.
**Recommendation:** Measure head timestamp minus the cursor block's timestamp and gate that elapsed interval directly. Keep block-distance metrics for attribution, but do not present nominal cadence conversion as a hard time bound.

## Codex's next steps (verbatim)

- Keep Task 8 untrusted under D-006.
- Fix coherent endpoint ancestry, snapshot usability gating, and timestamp-based lag measurement; add adversarial regressions for each.
- Rerun build, vet, full tests, race tests, and live-Postgres verification, then return the fix wave to Codex.

## Controller adjudication

**All 3 findings ACCEPTED**, none waived.

### A1 is on attempt 6, and each round has revealed a NEW DIMENSION

- Round 3: the case space was incomplete → wave 4 enumerated it (`floorOutcome` partition).
- Round 4: the missing dimension was **time** → wave 5 bound proofs to a reorg generation + live checkpoint.
- Round 5: the missing dimension is **which chain view** — probes deliberately failover across endpoints, so a
  proof is assembled from *multiple, possibly divergent ancestries*, and the checkpoint commits to only one.

That is not a sequence of careless fixes. It is the signature of solving a distributed-consistency
problem incrementally: proving a block is non-canonical using several untrusted, independently-forked
RPC views. Each wave correctly fixed the dimension it was shown and could not see the next.

**The strategic observation:** every one of these five attempts exists to justify a **deletion**. The
obligation is "prove non-canonicality before destroying non-replayable history." Wave 4 already built
the alternative — `NeutralizeUnverifiablePrices`, which retains every row and marks the unprovable ones
unreadable. **If the poller never deletes, the proof obligation disappears and A1 dissolves rather than
being fixed a sixth time.** Cost: some permanently-unusable rows in a Postgres table. Owner decision —
see the strategy note appended to the ledger.

### TEST INTEGRITY — fourth failure, and the same class as the first

Wave 5's snapshot regression test **expects `Ready=true` with two current failures**, codifying the
unsafe policy instead of detecting it. That is precisely wave 1's defect (a passing test asserting
data loss was expected) recurring after four rounds of instruction.

Also: **the fake is now the limiting factor.** It returns hashes keyed by height only, so it is
*structurally incapable* of modelling endpoint disagreement — the exact scenario finding 1 describes.
No amount of test-writing discipline fixes that; the harness has to change first.

**Controller's own miss, recorded:** the mutation check run this round proved the checkpoint tests
detect a disabled gate, and I reported that as strong evidence. It was — but it did not test whether
the *fake* could express the failure mode, nor whether other tests codified unsafe policy. Mutation
testing validates the tests you have; it says nothing about the tests you cannot write.

### Two disclosed rationales the controller asked Codex to judge — both wrong

1. **`Exhausted` rather than `Failed`** ("a failure with budget left is in flight; a closed generation's
   failures are all exhausted by construction") — false: `Failed > 0, Exhausted == 0` leaves readiness
   green for an account that has never produced collateral, and generation rollover drops the row.
2. **The 10-minute freshness derivation** (50 blocks ETH / 300 OP from nominal cadence) — a
   unit-conversion fallacy. Produced-block distance is not elapsed time; missed slots break it. Asking
   for a *derivation* was right; the derivation itself converted through an assumption that does not
   hold under degraded block production.

Disclosing a rationale is not the same as it being sound. Both were named as review targets in the
dispatch, which is why both were caught.

## Dispatch hygiene

Two attempts (`review-ms01ai29-cscf5i`, `review-ms01esp2-2dtxh6`) died to the dead-pid wedge because
the dispatch ran as a foreground Bash call rather than with the Bash tool's own `run_in_background`.
Both confirmed dead before being discarded; neither contributed to the verdict. Only
`review-ms01i4w8-drwxsm` (pid 53040 confirmed alive, log confirmed growing) produced it. **This is the
third round where foreground dispatch wedged a job — it must always be backgrounded.**
