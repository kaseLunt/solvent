# Codex adversarial review — task 9 round 21 (reconcile rounding fix, reopened surface)

- **Target:** diff `8fe828a..8e33a04` restricted to `cmd/reconcile/**` (detached worktree
  pinned at `8e33a04`; HEAD equaled the pin at dispatch).
- **Verdict as returned:** `needs-attention` — 1 low (comments only).
- **Job:** `review-ms3ud32e-9066kt`; session `019fa5d9-6f8d-7961-a8ca-38453ef76ab9`;
  worktree unregistered post-review (OS dir `C:/kwt-8e33a04` held by a process — delete
  manually when released).
- **Substance CONFIRMED by the reviewer's own arithmetic:** vector 1 product
  `137215×RAY + 234861408809459016374426840` → ceil 137216, floor/half-up 137215;
  vector 2 product `83×RAY + 43173183789685393320190753` → ceil 84, floor/half-up 83.
  QuoRem returns zero for zero scaled input and never increments exact multiples. No
  other `cmd/reconcile` production consumer projects Aave scaled debt to live value;
  Debt Manager floor math unrelated; `internal/derive`'s `rayMulHalfUp` has only test
  callers. The hard-coded tests kill half-up, floor, and unconditional-increment
  mutants without self-reference. (Reviewer could not execute tests — read-only
  sandbox denied Go's temp build dir; committed evidence records suite + acceptance
  runs passing, and the controller re-ran both green.)

## Finding (verbatim)

### [low] Comments contradict the implementation and overstate the empirical proof — `cmd/reconcile/aave.go:23-55`
The new comment says ceiling rounding for the deployed token is generally "proven
on-chain," although the cited evidence is two observations at one pin. Those
observations decisively refute half-up and floor for those inputs and are consistent
with ceiling, but they do not establish the deployed implementation for every input or
verify its source. The same file then explicitly describes §3.4(b) as rayMulHalfUp,
contradicting the corrected runtime path. In this correctness-critical harness, that
ambiguity can misstate the evidence and encourage a future regression to the
already-refuted algorithm.
**Recommendation:** Change the field comment to rayMulCeil and qualify the main
comment as an empirical match to two deployed-token vectors at the named pin,
consistent with ceiling rounding and Aave lineage—not a source-level or exhaustive
proof.

## Adjudication (honest-use calibration)

ACCEPTED — a misstated evidence claim in the acceptance harness is an honest-use
defect (it can teach a future maintainer to regress to the refuted algorithm).
Comment-only fix applied same-session: the rayMulCeil header now states the evidence
as two empirical vectors at one pin (refutes half-up/floor; consistent with ceiling +
lineage; NOT source-level or exhaustive), and the `aaveRowResult` field comment names
rayMulCeil. gofmt(blob)/vet/suite green. Returned for the D-006 closing review.

## Closing review (same round, comment-only diff)

- **Target:** `8e33a04..3101df8`, `cmd/reconcile/aave.go` only (SDD docs excluded per scope).
- **Verdict: SHIP (approve) — no material findings.** Session
  `019fa5e1-f023-7280-a32e-34d3cf9a310c`; job `review-ms3up2go-2lr5gn`.
- Reviewer confirmations: diff genuinely comment-only ("ignoring comment lines leaves
  an empty diff" — no signature/runtime/whitespace-disguised changes); all references
  name rayMulCeil, no stale rayMulHalfUp; evidence wording accurately limited to two
  vectors at ETH pin 25,627,125 with consistency-vs-proof correctly distinguished;
  floor/half-up/ceiling results recompute correctly for both vectors.
- **RECONCILE RE-CLOSED at 3101df8.** Task 9 review program complete with the W1
  acceptance evidence run PASSING behind it (87/87, acceptance:true).
