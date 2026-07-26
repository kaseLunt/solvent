# Codex adversarial review — task 9 wave 2 (round 2, prices unit)

- **Target:** `115e4d2` vs `cad9d76`
- **Verdict:** `needs-attention` — **NO-SHIP** (2 high). **Confirmed sound:** the EIP-1898
  pin end-to-end, the W2M1s ALONE claim, the contract rewrite.
- **Job:** `review-ms1kz3ny-wa0wgd`; session `019f9db3-800d-7211-905b-615b3bacb8a0`
- Anti-decoy passed; worktree pruned (orphaned broker PID verified by --cwd before kill —
  second occurrence of the class; mechanics held).

## Findings (verbatim)

### [high] Same-token backend splits are misclassified as reorgs and never rerouted — `internal/prices/poller.go:987-994`
This assumes every before/after hash mismatch from one EndpointToken is chain movement. But the accepted premise is that a token identifies a URL, not its backend. A load balancer can serve HeadFrom and the hash-pinned call from fork A, then serve the explicit closing HeaderHash(N) from fork B under the same token. This branch discards without advancing exploration, so every cadence selects the same URL while a healthy peer remains idle, indefinitely starving prices and anchors. Caller-scoped exploration records no attribution and does not alter the shared hint, so the stated false-attribution justification does not hold.
**Recommendation:** Advance caller-scoped exploration on the ambiguous hash mismatch while retaining the fail-closed discard. Add a multi-cadence regression with a stable same-token header-backend split and a healthy alternate endpoint; reverse W2M5 so removing that advance is killed.

### [high] Out-of-class pin failures can still retry the same private-fork head forever — `internal/prices/poller.go:931-943`
Exploration advances only when isBlockNotFoundErr recognizes the final error. The code and report admit unknown rejection wording, and Failover retains only the last endpoint error. Concretely, endpoint 0 supplies private-fork head A, endpoints 0/1 reject hash A, and a final endpoint transport failure masks the recognized rejection. This returns an error without changing exploreStart; every later cadence resolves endpoint 0 again even though endpoint 1 would land successfully from its own canonical head B. Malformed multicall envelopes and total closing-header failures have the same unchanged-routing shape. Backoff is fail-closed for correctness but can be fail-forever for availability.
**Recommendation:** Once a serving endpoint is resolved, advance caller-scoped exploration on post-head provider failures even when preserving their error/backoff posture. Add a multi-cadence mixed rejection/transport test proving recovery through a peer's own head.

## Controller adjudication

**Both ACCEPTED.** Fix wave: `task-9-wave3-brief.md`.

Round 2 sharpened the liveness class twice and the per-arm approach has now missed twice —
wave 2 advanced four named arms and Codex found the fifth and sixth. The controller rules
the CLASS closed by one principle instead of more citations (the round-13/14 "close the
class" lesson applied to routing):

> **Landing is the only outcome that keeps the starting point.** Once a round has resolved
> its serving endpoint, EVERY non-landing outcome — named discard, ambiguous hash
> mismatch, out-of-class rejection, transport failure, malformed envelope, closing-header
> failure — advances the caller-scoped exploration start. Failure classification decides
> the ERROR POSTURE (discard vs error vs backoff), never whether routing moves. The shared
> hint is never written; caller-scoped exploration attributes no fault, so advancing on
> ambiguity costs nothing and starving on it costs everything.

Finding 1's arm (chain movement) is subsumed deliberately: a genuine reorg discard that
advances the start merely begins the next round elsewhere — zero correctness cost,
availability win, and the false-attribution objection is void for exactly the reason
Codex stated.
