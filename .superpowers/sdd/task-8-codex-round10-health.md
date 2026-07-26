# Codex adversarial review — wave 11 (round 10, HEALTH unit)

- **Target:** `d81e2e3` vs `cb3a955` (health delta = `c146853` + `827a9e6`)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 high, 1 medium). **H2 and H4 CONFIRMED CLOSED.**
- **Job:** `review-ms15fnd2-pnwr8s` (~12 min); session `019f9c25-38b0-7950-9676-252b090e3fda`
- Also confirmed: the fast-harness arithmetic (9/180/2/40 per 20 rounds) is correct *under
  instantaneous fetches*; migration `00008`, schema v8, the collateral test correction, rewind
  semantics, and the quiet-refusal composition are coherent; the DB/daemon-clock residual is
  genuinely cosmetic for collateral (SQL decides that verdict).

**Health-unit trend: 2 → 4 → 2.**

## Findings (verbatim)

### [high] Slow successful header reads defeat the deep-stale throttle — `cmd/indexer/main.go:987-993`
All measurements in a pass receive one round-start `now`, and each successful fetch later records that old value as `fetchedAt`. The configured first pass performs nine sequential reads. If they average more than 3.33 seconds—still comfortably below the 10-second per-read timeout—the pass exceeds the 30-second reuse window, so every anchor is already expired when the next pass begins and the daemon again pays nine reads. The shipped cost test uses instantaneous fetches and advances its clock only after the pass, so its 9-versus-180 result does not cover this degraded-but-successful endpoint shape. This can restore the original hot-loop backfill slowdown and also makes the disclosed 30-second caught-up false-red bound exceed 30 seconds in wall time.
**Recommendation:** Record reuse scheduling time from a monotonic clock at actual fetch completion, and enforce a per-chain refresh budget that remains bounded when a pass itself exceeds the window. Add a successful-fetch test that advances time during each read until one pass lasts over 30 seconds, then assert bounded reads and catch-up recovery.

### [medium] Clock rollback can still turn stale state green without making its timestamp future — `cmd/indexer/main.go:1005-1006`
`beyondSkewTolerance` detects rollback only when the retained header becomes more than 60 seconds future relative to the daemon. An already-old header absorbs rollback: a header actually 15 minutes old followed by a 10-minute daemon-clock rollback is still five minutes in the daemon's past, so the predicate passes and `stalenessAge` reports five minutes—green against the ten-minute bound although the underlying state is unhealthy. An advancing worker that remains 15 minutes behind can stay false-green while the daemon remains ten minutes slow. The tests only use rollback greater than `anchorAge + tolerance`, so they miss this masking case; eviction and refetch do not help because the fetch path trusts the same skewed clock.
**Recommendation:** Judge header age using an independently sourced current time, such as the database clock already trusted for collateral, or fail unmeasured when daemon and database clocks differ beyond tolerance. Add a test where rollback is smaller than the cached header's age but large enough to cross the health boundary.

## Controller adjudication

**Both ACCEPTED.** Fix wave: `task-8-wave13-brief.md` (parallel with wave 12, disjoint files).

- The [high] is the harness lesson a third time, sharpened: "hard case" has more than one axis. Wave
  11 measured old *timestamps* (data-hard) with instantaneous *fetches* (latency-easy). Cost
  evidence must vary the latency axis too.
- The [medium] closes a genuine conceptual hole: the daemon's wall clock is a *trusted input* to a
  liquidation-facing verdict, and rollback attacks it from below the future-skew radar. Using the DB
  clock (already the trusted time authority for collateral) is the principled fix — one source of
  time truth per verdict.
