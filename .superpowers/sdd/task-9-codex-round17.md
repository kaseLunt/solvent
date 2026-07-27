# Codex adversarial review — task 9 wave 17 (round 17, ingest closing attempt two)

- **Target:** detached `0a4f21c` (verified == origin/main tip at dispatch — the round-15
  erratum lesson applied and stated), range `b9c5c33..0a4f21c` restricted to
  `internal/ingest/**`, `internal/chain/**`.
- **Verdict:** **NO-SHIP** — 1 medium, single finding.
- **Job:** `review-ms2pokr1-yakkc0`; session `019fa1c6-d58a-7273-8771-89866fbf886c`;
  worktree `C:/wt-ingest-0a4f21c` (short path after MAX_PATH on
  `roadmap/insights/*.md`), pruned; broker PID 82708 verified by `--cwd` and killed.
- **Confirmed sound:** R15-1/2a/2b/2c outcome discipline, R15-7 cycling, Σ-attempts
  timing, the compile-time constant alias, the stated non-claims, and the consult's
  n=2 byte-identity gate — "the wave-14 regression files are object-identical."
- **Convergence note:** the sole finding is one of wave 17's OWN disclosed residuals
  (the "triple-coincidence fall-through sub-case covered by inspection + argument")
  promoted to a blocker — the review found nothing outside the report's honesty list.

## Finding (verbatim)

### [medium] Fall-through probes retain forbidden rewind authority — `internal/ingest/walker.go:736-770`
The binding consult says any cursor mismatch encountered while probing must discard, but the guard also requires `servedBy.Index != incumbent`. Concrete scenario: A spends its lease, probe target B fails the head read, failover wraps to incumbent A, and A reports a cursor mismatch. `probing` remains true, yet the condition is false, so the Step calls `rewindToVerifiedAncestor` and executes `Store.Rewind` instead of discarding. This destructive probe-Step path can delete and re-ingest a suffix and trigger derived reorg churn. The report's witness-scoped exception is not present in the binding consult and its exact fall-through combination has no regression.
**Recommendation:** Make the refusal apply whenever `probing` is true and add a regression combining a failed probe target with an incumbent cursor mismatch. If retained-incumbent rewinds are intentionally exempt, obtain an explicit binding consult amendment and pin that exception before shipping.

## Controller adjudication

**ACCEPTED — the wave-17 deviation is REVERSED.** The consult's text was unqualified
("mismatch-while-probing is a discard; the incumbent rewinds next Step if the reorg is
real") and already covers this exact case, so no amendment is required — the fix is the
consult implemented verbatim. The wave's argument (an incumbent-served mismatch is the
same single-witness rewind a non-probe Step would perform) is not wrong on custody,
but total refusal strictly dominates: the invariant "a probe Step NEVER rewinds"
is simple, testable without witness-attribution edge cases, and costs one Step of
delay in a rare compound posture — after the discard the seam advances, the lease
dissolves, and the next (non-probe) Step performs the identical rewind through the
normal arm. Deviations from a binding consult require an amendment BEFORE shipping,
not an argument in the report — recorded as process law.

Fix wave: `task-9-wave18-brief.md` (surgical — one guard, one regression, one mutant).
Ingest trend: R12 1H → R15 2H2M1L → R17 1M-from-the-disclosure-list. Converged to the
honesty list; closing expected next round.
