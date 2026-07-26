# Codex adversarial review — task 9 wave 13 (round 13, reconcile)

- **Target:** `e455229` vs `ffb3235` (path-scoped cmd/reconcile)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 high, 1 medium). **Confirmed closed:**
  F2 (inability gating) correct; 3/3 mutation transcript internally consistent incl.
  compile-clean W13M3; blanket `-accounts` tainting "safety-sound" (with the disclosed
  cost of acceptance-clean replay).
- **Job:** `review-ms2ea2ej-7b3diy`; session `019fa0a2-8dbe-7353-863a-8926c1c9f53e`
- Anti-decoy passed (engaged the reachability walk's internals); worktree pruned
  (eleventh orphaned-broker, PID verified).

## Findings (verbatim)

### [high] Environment-controlled cadence can still make freshness vacuous — `cmd/reconcile/phase1.go:614-622`
runPhase1 accepts any positive SOLVENT_SNAPSHOT_INTERVAL and uses twice that value for the automatic freshness bound, while acceptanceTaints only examines CLI options. For example, SOLVENT_SNAPSHOT_INTERVAL=1000000h with default flags produces an approximately 228-year bound. Sampled snapshots last refreshed years ago are then classified fresh; if the remaining checks are exact, computeResult returns pass/0. Recording the chosen bound in the artifact does not prevent an acceptance receipt from laundering stale data.
**Recommendation:** Reject or taint noncanonical/over-limit cadence values, or bind the freshness calculation to independently persisted daemon cadence with a hard acceptance maximum. Add an env-to-freshness-to-verdict regression test using an extreme positive interval.

### [medium] The F5 AST proof misses indirect and aliased network calls — `cmd/reconcile/phase1_f5_seam_test.go:110-133`
The reachability walk follows only direct calls whose identifier or selector matches a package FuncDecl; it does not resolve package-level function values, interface dispatch, import paths, or reflection. A regression such as `var snapshotRead = func(...) { ...network... }` followed by `snapshotRead(ctx)` from collectSnapshot, or an aliased `web "net/http"` call, passes this test because the callee is not in decls and the qualifier is not literally http. Such raw calls also bypass snapshotGate, which guards only pinnedReader methods, allowing network latency or retries while the repeatable-read transaction holds xmin. W13M3 exercises only the directly named pinnedReader/headerHash shape, and its mutation command runs only the AST test; the runtime tests manually toggle the gate and never execute its production wiring.
**Recommendation:** Enforce the boundary using import-path-aware go/types/SSA analysis or move snapshot collection into an import-restricted DB-only package. Add negative mutants for aliased imports, package-level function values, and interface dispatch, plus a DB-backed test proving the production gate remains active from BeginTx through commit/rollback and connection close.

## Controller adjudication

**Both ACCEPTED.** Fix wave: `task-9-wave15-brief.md` (parallel with wave 14).

- The [high] closes the loop wave 13 opened honestly: the residual it NAMED is a
  blocker, not a disclosure — the taint law's domain is "every input that can weaken a
  required bound," and env vars are inputs. Same class as rounds 10-11, final corner.
- The [medium] is the round-5 fixture lesson at the static-analysis layer: an AST walk
  that resolves only direct named calls is a fake that cannot fail against indirection.
  go/types-based import analysis (or the import-restricted package split — structurally
  stronger) plus negative mutants per evasion shape.
- The `-accounts` replay question: blanket taint STANDS for Task 9 (the acceptance run
  uses canonical selection; replay is a debug affordance). Codex's provenance-bound
  replay manifest is recorded as future work for when replay must be acceptance-clean.
