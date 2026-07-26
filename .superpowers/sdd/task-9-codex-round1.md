# Codex adversarial review — task 9 wave 1 (round 1, prices unit)

- **Target:** `84ca9d2` vs `13ea0da` (wave-1 code = `463b344` + `84ca9d2`)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 high, 1 medium)
- **Job:** `review-ms1iuebv-8b2i2j`; session `019f9d7c-e7a2-7530-ba62-99e7dcc41ace`
- Anti-decoy passed (session references `84ca9d2` + `internal/prices/poller.go`); worktree
  pruned clean (one orphaned broker process had to be killed first — the Task 8 orphan
  class again, handled).

## Findings (verbatim)

### [high] Coherence discards can retry the same broken endpoint forever — `internal/prices/poller.go:896-903`
If HeadFrom resolves endpoint 0 but its eth_call consistently fails, CallAtFrom rotates to healthy endpoint 1. The token mismatch correctly discards the response, but this branch updates neither exploreStart nor preferredStart. Because HeadFrom and CallAtFrom are caller-scoped and never update the shared active hint, the next cadence can again resolve endpoint 0 and repeat indefinitely: endpoint-0 head, endpoint-1 call, discard, no anchor/cursor/price writes. The closing-header token mismatch has the same defect. The tests prove only the first discard, not eventual recovery.
**Recommendation:** On coherence/serving-inconsistency discards, advance a caller-scoped exploration start to a viable alternate endpoint without changing the shared hint. Add a multi-cadence test where one endpoint serves heads but permanently fails eth_call and assert the next round lands through the healthy peer; mutation-test the routing-state transition.

### [medium] The documented anchor guarantee is still false for split backends — `internal/prices/prices.go:99-104`
The package contract still says Multicall3 returns the execution-block hash and that the decoder retains it, exactly the behavior this change removes. More importantly, a token identifies a configured URL, not a backend behind that URL. If both header requests hit fork A while the number-pinned eth_call hits fork B at the same height N, all current guards pass: both tokens match, blockNumber equals N, and hashBefore equals hashAfter. Observations from B are then stored under A's hash and later repair can incorrectly treat them as canonical. The report mentions this residual, but the production package contract—where anchor consumers are told what it vouches for—still claims execution-hash provenance.
**Recommendation:** Remove the stale Multicall3-hash claim and explicitly document that the anchor attests the header path, not necessarily the eth_call backend. If execution-to-hash binding is required, use an EIP-1898/block-hash-pinned eth_call and test the same-height split-fork scenario; otherwise propagate the limitation to repair/offline-reconciliation semantics.

## Controller adjudication

**Both ACCEPTED.** Fix wave: `task-9-wave2-brief.md`.

- The [high] is the fail-closed-not-fail-forever class a fourth time (wave 13 starvation,
  wave 15 rotation liveness, now routing state after coherence discards). The discard is
  correct; the missing piece is that a discard must MOVE the round's starting point.
- The [medium]'s deeper half is a genuine trust-boundary observation: an EndpointToken
  names a URL, not a backend, and one lb hostname is many nodes. Codex offered two exits:
  document the weaker attestation, or bind execution to the hash with EIP-1898. The
  controller tested EIP-1898 LIVE on all four reachable endpoints (eth/op × drpc-keyed,
  op foundation, eth publicnode): hash-pinned eth_call executed exactly at the pinned
  block on all four, and a fabricated hash was REJECTED ("block not found") on all four —
  negative control included. The strengthening is viable fleet-wide, so wave 2 mandates
  it rather than the documentation fallback. Gold standard: make the guarantee true
  instead of shrinking the claim.
