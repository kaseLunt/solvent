# Codex adversarial review — task 9 wave 11 (round 11, reconcile harness)

- **Target:** `ec6da60` vs `3ee6cfc` (path-scoped: cmd/reconcile, internal/store, Makefile)
- **Verdict:** `needs-attention` — **NO-SHIP** (2 high, 1 medium). **Confirmed:** all
  scoped destructive call sites guarded; the two disclosed outside-scope live tests are
  NOT a wave-11 blocker (fixed dedicated schemas; skip gate closes their vacuous-green).
- **Job:** `review-ms2c2blt-g5z4ax`; session `019fa069-cc21-71c2-9d66-636a5ecbe07e`
- Anti-decoy passed; worktree pruned (ninth orphaned-broker, PID verified). Controller
  fallback watcher extracted the verdict first; the reviewer's own watcher then returned
  it verbatim — dual-path retrieval agreed byte-for-byte.

## Findings (verbatim)

### [high] Acceptance-clean flags can make freshness and lag checks vacuous — `cmd/reconcile/main.go:151-180`
At ec6da60, acceptanceTaints only taints maxHeadLag when it is non-positive and never examines snapshotMaxAge. An invocation such as `-snapshot-max-age 2562047h -max-head-lag 2562047h` therefore has no taint while making both required age checks ineffective for any realistic stale state. If other rows are exact, computeResult returns pass/exit 0. TestTaintedRunCannotPass injects an existing taint directly, proving verdict consumption but not closure of the taint generator over the flag surface.
**Recommendation:** Taint or reject every noncanonical override that can weaken a required bound, including snapshot-max-age and positive-but-looser max-head-lag values. Add a test that parses the actual flags, derives taints, and calls computeResult.

### [high] Aave collateral weld-unread rows remain non-blocking — `cmd/reconcile/phase2.go:765-772`
The collateral weld is invoked with gated=false, and failure accounting only counts rows whose Gated field is true. Consequently, if getReserveAToken or scaledTotalSupply reverts or is undecodable for a collateral reserve, the code emits weld-unread but can still return pass. This is concrete because the report says getReserveAToken was not live-verified. Keeping numeric collateral mismatches advisory may match the first-run amendment, but making inability to perform the check advisory violates F3's same-rule requirement and leaves collateral-universe completeness unproved.
**Recommendation:** Gate weld-unread independently of the collateral numeric-mismatch policy—for example, set Gated when verdict is weld-unread while leaving aggregate-mismatch advisory. Add a collateral-unread unit test and mutation.

### [medium] W11M5 does not exercise network-under-snapshot — `cmd/reconcile/phase1_seam_test.go:82-84`
TestSnapshotDataCarriesNoConnections only reflects over snapshotData. It does not inspect collectSnapshot's body or signature, so collectSnapshot could directly dial through cfg/environment or call a package-level network helper after BeginTx without adding a field or parameter; this test would still pass while a retrying call held the repeatable-read snapshot and xmin. The current call graph is ordered correctly, but the claimed unrepresentability is false: the 5/5 result kills the seam-smuggle mutant, not the original F5 regression.
**Recommendation:** Add a runtime ordering seam or structural AST check that fails on network calls while the transaction is open, then mutate an actual header/RPC call under BeginTx and demonstrate that the test kills it.

## Controller adjudication

**All three ACCEPTED.** Fix wave: `task-9-wave13-brief.md` (parallel with wave 12,
disjoint files).

- Finding 1 is the round-10 F2 lesson completed: consuming taints is half the law; the
  GENERATOR must be closed over every bound-weakening flag. Vacuous-via-loose-bounds is
  the same class as vacuous-via-skip.
- Finding 2: the distinction that matters — numeric-mismatch policy (advisory for
  collateral, per the amendment) is SEPARABLE from ability-to-check (always gated).
  "Cannot verify" is never advisory; that is the house's fail-closed axiom applied to
  its own evidence tool.
- Finding 3 is an honest-mutation-evidence catch (the wave-16/round-7 lesson recurring):
  W11M5 certified the seam-smuggle property, not the F5 invariant; the claim of
  unrepresentability was false because the test inspected DATA, not BEHAVIOR.
