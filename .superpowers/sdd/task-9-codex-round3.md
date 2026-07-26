# Codex adversarial review — task 9 wave 3 (round 3, prices unit)

- **Target:** `1b89fb5` vs `8bd1f29` (wave-3 code = `ed86b1d` + `1b89fb5`)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 medium). **Confirmed sound:** the
  non-landing routing seam itself ("structurally sound"), on top of round-2's confirmations
  (EIP-1898 pin, W2M1s, contract rewrite).
- **Job:** `review-ms1mzexw-zmr815`; session `019f9de6-fc29-79f0-9b5c-3c35ebd87538`
- Anti-decoy passed via the underlying codex sqlite logs (the wrapper job log truncates by
  design — noted for future rounds); worktree pruned (third orphaned-broker occurrence,
  PID verified by --cwd before kill).

## Findings (verbatim)

### [medium] Mixed endpoint failures can alternate discard/error posture and continually reset backoff — `internal/prices/poller.go:940-982`
CallAtHashFrom exposes only the last endpoint error, while the new defer changes the next starting endpoint after both errors and discards. Concretely, let endpoint 0's pinned call fail with a transport error and endpoint 1 reject with "block not found," while both still serve heads. Starting at 0 makes the recognized rejection last, so the round returns a nil discard and advances to 1; starting at 1 makes the transport error last, so the next round errors and advances back to 0. This repeats for the same persistent outage. The daemon treats every nil discard as success, resetting retryBackoff and clearing step_error, so retries never approach the 10-minute cap and the error condition disappears on alternating attempts. The poller's cadence prevents a hot loop, but does not preserve the intended exponential outage pacing or stable failure visibility.
**Recommendation:** Make total-failure classification independent of failover order: propagate typed or aggregate per-attempt outcomes and use the discard posture only when every failed attempt is a recognized pin rejection; any transport or unknown failure must retain the error posture. Keep the deferred routing advance for either posture. Add a multi-cadence test for both mixed-error orders through the daemon worker wrapper, asserting that persistent transport involvement neither resets the backoff streak nor clears step_error.

## Controller adjudication

**ACCEPTED.** Fix wave: `task-9-wave4-brief.md`. Trend for the P0 fix: 1H1M → 2H → 1M —
the fabrication core and the routing seam are both confirmed; what remains is posture
classification, and the finding is the "one time authority per verdict" lesson transposed:
one CLASSIFICATION authority per round outcome. Last-error-wins made the posture depend on
failover ORDER — an accident of rotation, not a property of the outage. The fix requires an
additive chain-layer change (Failover today surfaces only the last error): per-attempt
outcome aggregation, explicitly sanctioned for wave 4 (wave 3's "chain layer should not
change" bound is lifted for exactly this).

## Same-night operational note (ingest layer, recorded here for the class parallel)

While round 3 ran, the OP walker sat wedged for 2.5h+ on a DETERMINISTIC
`log at window tip does not match anchored tip hash` (19 identical failures, backoff at
the cap's neighborhood): cross-provider windows (headers from one OP provider, logs from
another after mid-window failover) with drpc-OP implicated in every consistent
explanation; mainnet.optimism.io proved internally consistent (header hash ==
single-block getLogs blockHash == 0x3d9573…fe23 at 150,105,227). Content-validation
failures never rotate walker endpoints — the ingest-layer SIBLING of the class rounds 1–3
just closed in the poller. Remediated operationally (OP single-provider foundation,
daemon restart on the pre-wave binary); the walker-layer class fix is RECORDED AS OPEN
WORK, deliberately not folded into wave 4 (reopening approved ingest code deserves its own
brief and review cycle, after the backfill completes).
