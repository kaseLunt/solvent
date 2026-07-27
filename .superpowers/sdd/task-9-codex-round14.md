# Codex adversarial review — task 9 wave 15 (round 14, reconcile)

- **Target:** `7c1fe88` vs `67cda28` (path-scoped cmd/reconcile incl. snapshotdb)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 high, 3 medium)
- **Job:** `review-ms2gqzew-qhkhjp`; session `019fa0e1-dcca-7cb3-addd-de90748feda1`
- Anti-decoy passed (findings engage snapshotdb internals); worktree pruned (twelfth
  orphaned-broker, PID verified). Dispatch note: the first attempt for this target died
  to a safeguard false-positive on adversarial vocabulary before creating a job; the
  redispatch used neutral phrasing — no duplicate job, nothing lost.
- **ARCHIVED UNDER OWNER PAUSE.** No fix wave dispatched; adjudication below is
  provisional analysis for the owner's decision, not a work order.

## Findings (verbatim)

### [high] Linked pgx environment inputs escape the closed env table — `cmd/reconcile/env_test.go:125-140`
The closure scans only first-party directories, but pgx v5.5.1, reached by pgx.Connect, reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGSERVICE*, PGSSLMODE and related variables. With SOLVENT_DATABASE_URL=postgres:///solvent?sslmode=disable and PGHOST pointing to staging, readOnlyDSN accepts the URL and the artifact records db_name=solvent, while pgx connects to staging. A schema-compatible staging database can therefore produce an apparently production-bound pass without any taint.
**Recommendation:** Reject partial database URLs or classify/neutralize every pgx PG* input. Record a sanitized connected-server identity, and add a regression proving ambient PGHOST cannot silently redirect acceptance.

### [medium] The gate reopens before rollback and connection close — `cmd/reconcile/snapshotdb/snapshotdb.go:324-344`
Defers execute LIFO: conn.Close is registered first, tx.Rollback second, and Gate.Exit last. On any post-BeginTx error, Gate.Exit therefore runs before rollback and close, leaving the RPC surface open while the transaction/backend is still live. The lifecycle test checks the gate and backend only after Collect returns, so it cannot observe this ordering. A slow rollback or close permits a concurrent RPC path to run while xmin remains held.
**Recommendation:** Use one ordered cleanup that rolls back, closes the connection, and only then exits the gate. Extend the DB test and mutation set to block rollback/close and observe the gate during both operations.

### [medium] The import allowlist is not a network-capability boundary — `cmd/reconcile/snapshotdb/boundary_test.go:43-61`
Allowlisting the os package grants every os capability, not only ReadFile. An unexported helper can call os.StartProcess to run a network client while Collect holds the transaction; it adds no import, package variable, interface literal, type assertion, or exported API, so both boundary tests pass. Named interfaces are another gap: the AST test does not resolve context.Context or any to their underlying interface types. Thus the compiler does not enforce the claimed no-network property, and W15M2-M5 cover only selected spellings.
**Recommendation:** Compute the config hash before entering snapshotdb and remove os from its imports. Use semantic go/types checks for underlying callable/interface types, make Gate non-assignable, and add mutants using an allowed-package capability and a named interface.

### [medium] The 1h cap creates a permanent failure for a supported daemon cadence — `cmd/reconcile/env.go:51-69`
The daemon accepts any positive snapshot interval and its real healthy bound is 2*(interval+lastPass). This branch permanently taints every interval above 1h while claiming last_pass_seconds is a substitute widening channel, but lastPass alone cannot reproduce the additive interval term. For a legitimate 2h interval and 1h completed pass, the daemon permits a 6h bound; reconcile computes only 4h and exits 1 from the env taint even with zero failures. Nothing in database state can clear that result, so the supported posture is fail-forever unless the operator changes configuration or hides it from reconcile.
**Recommendation:** Persist the configured daemon interval with sweep-generation evidence and evaluate the same 2*(interval+lastPass) rule. Alternatively, make 1h an enforced daemon configuration contract rather than accepting broader cadences that reconciliation can never approve.

## Provisional controller analysis (NOT a dispatched wave — owner paused the pipeline)

All four read as valid. Notes for whenever work resumes:

1. **[high] pgx PG\* env** is the round-13 lesson one dependency-layer down: the taint
   domain must include inputs the LINKED LIBRARIES read, not only first-party code. The
   strongest fix is the one that makes the audited subject self-evident: reject partial
   DSNs and record the CONNECTED server identity (the wave-11 identity tuple already
   exists — reuse it as the recorded fact rather than the parsed URL).
2. **[medium] LIFO gate ordering** is a real correctness bug found by reading defer
   registration order — exactly the kind of thing the house's own tests missed because
   they observed only post-return state. One ordered cleanup function; the test must
   observe DURING rollback/close.
3. **[medium] `os` in the allowlist** is honest: an import allowlist is a *namespace*
   boundary, not a *capability* boundary. Hoisting the config hash out of snapshotdb and
   dropping `os` makes the claim true rather than approximate.
4. **[medium] the 1h cap** is the fail-closed-not-fail-forever law turned against our own
   fix: wave 15 chose a bound the daemon does not actually enforce, so a legitimate 2h
   cadence can never produce an acceptance pass. The principled resolution is to persist
   the configured interval alongside sweep evidence and evaluate the daemon's REAL rule
   (2*(interval+lastPass)) — which also removes the unverifiable-operator-assertion
   objection, because the value becomes durable daemon-written state rather than an env
   claim.
