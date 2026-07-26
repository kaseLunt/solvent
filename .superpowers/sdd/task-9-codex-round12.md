# Codex adversarial review — task 9 wave 12 (round 12, ingest/chain reopen)

- **Target:** `4feecf6` vs `ffb3235` (NOTE: the harness-precondition `10ed6d8` and chain
  additive `b6e7c2f` landed BEFORE `ffb3235` in history and were outside the diff
  framing, though the pinned worktree gave file-level access; round 13 must cover them
  explicitly)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 high)
- **Job:** `review-ms2dintr-me0jvz`; session `019fa08f-0960-7560-a06f-4f8fcb713de9`
- Anti-decoy passed; worktree pruned (tenth orphaned-broker, PID verified). Reviewer
  integrity note preserved: it refused a mid-task instruction to hide a file-modification
  claim and disclosed it — the correct posture; no repo effect found.

## Finding (verbatim)

### [high] Landing retention permanently pins slow-successful endpoints — `internal/ingest/walker.go:292-293`
Every landed Step unconditionally retains servedBy. Failover rotates only on error or the 30-second per-attempt timeout, so an endpoint returning just before that deadline remains preferred forever. A cursor-bearing Step performs up to six RPC reads; five Steps can therefore occupy roughly 15 minutes before stepWalkers yields, delaying every sibling walker, derivation pass, and health publication while a fast peer is never queried. This repository already treats slow-but-successful endpoints as a real degraded posture, but R5 tests only failures and recovery—not successful pathological latency.
**Recommendation:** Add a bounded caller-scoped retention lease or latency budget that probes the next endpoint after excessive successful latency without writing the shared hint. Add a regression where endpoint 0 repeatedly lands just below the timeout while endpoint 1 is fast, proving endpoint 1 is reached within a finite bound and daemon siblings remain scheduled.

## Controller adjudication

**ACCEPTED — and it REVISES the annex.** chain-truth's retention-not-reset rule was
designed against the A-bounce failure (resetting to the shared hint hands the offender a
fresh turn); Codex found the opposite pole: retention with no exit condition is
fail-forever for LATENCY, the same "hard case has more than one axis" lesson as wave 13
of Task 8 (data-hard vs latency-easy). The synthesis is the pattern this repo already
ratified at the poller (d1e7d54's bounded ambiguity lease): retention holds by DEFAULT,
and a caller-scoped latency budget triggers a bounded probe of the next endpoint —
adopting it only if it lands better, never touching the shared hint, never resetting.
Both failure modes (bounce and pin) get a regression. Wave 14: the bounded retention
lease + Codex's degraded-successful regression + a daemon-level scheduling assertion +
explicit round-13 coverage of `10ed6d8`/`b6e7c2f`.
