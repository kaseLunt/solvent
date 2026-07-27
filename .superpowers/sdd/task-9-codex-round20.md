# Codex adversarial review — task 9 wave 20 (round 20, reconcile CLOSING round)

- **Target:** detached `45e3051` (== origin/main tip, stated; interval `019841e..45e3051`
  verified docs-only for restricted paths), range `1186197..019841e` restricted to
  `cmd/reconcile/**`, `internal/store/**`, `cmd/indexer/**`.
- **Verdict as returned:** `needs-attention` — 1 high, 1 medium.
- **Adjudicated outcome: RECONCILE CLOSED — both findings ACCEPTED-AND-DISCLOSED
  LIMITATIONS under the owner calibration of 2026-07-27 (ledger `2e61277`); no fix
  wave.**
- **Job:** `review-ms3jw0yd-9ouirp`; session `019fa4cc-f7b8-7850-88d1-bab98d0d68f9`;
  worktree `C:/swt/r19c9w20` pruned; broker PID 37444 verified by `--cwd` and killed.
- **Confirmed sound (the round's own words):** "H1 rollover/fatality, W20M2/W20M6
  omission kills, F2, the 17 PG* names, effective-DSN rejection, and SHA binding
  remain sound." Every honest-use correctness mechanism of waves 16–20 is confirmed.

## Findings (verbatim)

### [high] Non-Windows ambient TLS trust can still produce a clean acceptance receipt — `cmd/reconcile/env.go:330-335`
The unconditional non-Windows return occurs before trustMaterialPinned is considered. pgx v5.5.1's !windows defaults automatically source ~/.postgresql/root.crt and the client certificate/key from user.Current().HomeDir, then load them into the connection. Concrete scenario: a Linux acceptance worker uses verify-full without explicit trust paths and has a planted or stale ~/.postgresql/root.crt. An impersonating database presenting a certificate from that root can self-report the expected identity and return passing data, while this judge emits no taint. Whether the hidden trust input came from an environment variable or os/user is not a sound boundary for an acceptance-evidence tool; this is the same attack class as APPDATA.
**Recommendation:** Judge platform-default trust on every OS. On non-Windows, taint unpinned TLS postures unless sslmode=disable or all trust-material paths are explicitly pinned. Add a Linux test using a temporary home with planted ~/.postgresql trust files and a real pgx configuration/connection probe.

### [medium] Allowed context.Context dispatch bypasses the snapshot capability scan — `cmd/reconcile/snapshotdb/boundary_test.go:398-404`
The semantic boundary explicitly allows context.Context and stops examining its method set. Collect exports that interface, and after gate.Enter every pgx query invocation ctx.Done through pgx's context watcher. A caller can therefore supply a custom context whose Done or Deadline method performs an HTTP/RPC dial; that code lives outside snapshotdb, needs no snapshotdb import or function-field formation, and is invisible to both the foreign-function-type belt and the current AST scan. The existing lifecycle test uses standard contexts, so it would remain green. A telemetry or retrying context implementation could consequently perform network I/O while the repeatable-read transaction holds xmin.
**Recommendation:** Before entering the transaction gate, capture cancellation/deadline into a new standard-library context and use only that canonical context for all gated pgx and cleanup calls. Add a hostile custom-context regression whose methods attempt a dial and prove no interface method dispatch occurs after Enter.

## Adjudication (under the ratified owner calibration)

Both findings require a NON-HONEST ACTOR and cannot affect an honest operator's
results:

1. **[high] planted `~/.postgresql` trust root:** requires an attacker with write
   access to the operator's own home directory AND an impersonating database serving
   forged data — an attack on one's own audit tool. No honest configuration produces a
   wrong answer through this path. **DISCLOSED LIMITATION:** "reconcile's TLS-trust
   judging covers env-sourced trust inputs (PG*, APPDATA); OS-user-derived default
   trust paths (~/.postgresql) are out of scope — on a shared or untrusted host, pin
   sslrootcert explicitly."
2. **[medium] hostile custom context:** requires the CALLER of the evidence tool to
   deliberately construct a context whose methods smuggle network dials — the caller
   attacking their own evidence run. **DISCLOSED LIMITATION:** "snapshotdb's
   no-network boundary is enforced against its own code, imports, and function-value
   formation; a caller-supplied hostile context.Context implementation is outside the
   proof."

Both disclosures will be carried in the reconcile documentation/receipts. The
recommendations are RECORDED (this file) should the tool ever serve a
multi-tenant/hostile-host posture — that is not this project's posture.

## TASK 9 REVIEW PROGRAM COMPLETE

All four surfaces closed: poller (round 4, zero findings), chain hash law (round 9,
zero findings), ingest (round 18, zero findings), reconcile (round 20, closed by
adjudication with two disclosed non-honest-actor limitations; all honest-use
mechanisms independently confirmed sound). Reconcile arc: waves 10/11/13/15/16/19/20,
rounds 10→20, trend 3H2M → 2H1M → 1H1M → 1H3M → 0H4M → 2H1M1L → 1H1M(adversarial-tail
only). Next: CI fix, daemon restart (migrations 00009/00010 + cadence stamp), the
acceptance evidence run.
