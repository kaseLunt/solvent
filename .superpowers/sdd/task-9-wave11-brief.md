### Task 9 — wave 11: round-10 fixes (reconcile harness) — the safe path is the only path

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. Read `.superpowers/sdd/task-9-codex-round10.md` (verbatim + adjudication),
`task-9-wave10-report-p2.md`, `consult-riskquant-wave10.md`. CLOSED — do not re-open:
the 5-phase architecture, the sampling design, the tolerance theorems, the welds'
existence, the scans. This wave makes five guarantees STRUCTURAL. The adjudicated class:
correctness that depended on operator discipline now depends on code.

## F1 [high] — the destructive test boundary enforces the split (`Makefile:18-19` + test helpers)

**Do:** a shared pre-test guard invoked by EVERY destructive test helper (the
Migrate+TRUNCATE path in internal/store test setup) BEFORE it touches anything:
TEST_DATABASE_URL required (absent = fatal, not skip, when the guard runs in
acceptance/`make test` context); resolve BOTH live and test database identities via the
F4 identity mechanism below; equality or unresolvable = fail closed with the runbook
message. The acceptance test command must reject DB-test skips (a skipped live-db suite
can never produce suite-green evidence — count skips, fail on >0 in acceptance mode).
Dev ergonomics may keep skip-when-unset ONLY outside acceptance mode, and the Makefile
target must say which mode it is.

## F2 [high] — taints reach the verdict; bypasses cannot be acceptance (`cmd/reconcile/main.go:142-160`)

**Do (structural, Codex's recommendation):** acceptance mode REJECTS invocations that
disable required checks (`-collateral-replay 0`, `-max-head-lag 0`, pin overrides,
`-accounts` replay that fails quota/strata/forced-anchor validation) — exit 2 before any
phase runs; OR the run proceeds with `result: tainted` which is structurally non-pass
(exit non-zero). Every taint flows INTO computeResult — a tainted run cannot return
`pass` by construction (make the type system help: the verdict function takes the taint
set, not the metadata blob). Replay files validate against required sample size, strata
coverage, and forced anchors.

## F3 [high] — the weld universe is authoritative (`cmd/reconcile/phase2.go:124-135`)

**Do:** the DM weld iterates the EXPLICIT union getBorrowTokens(@pin) ∪ derived-assets;
read-presence is a first-class per-token fact separate from numeric zero; any
unsuccessful/undecodable borrowTokenConfig read = a GATED unread-failure weld row
(verdict class `weld-unread`, exit 1) — never a silently absent row. Same rule for the
Aave reserve universe (reserves list @pin ∪ derived). The empty-state completeness
requirement (risk-quant F1) now holds even under ABI skew or pinned-call reverts.

## F4 [medium] — DSN identity, not DSN strings (`internal/store/reconcile.go:120-128`)

**Do:** identity = PostgreSQL `system_identifier` (pg_control) + database OID + database
name; equality on THAT tuple = same database regardless of alias (IPv4/IPv6, socket/TCP,
proxy). Either identity unresolvable = fail closed. Tests: alias-equivalence (two DSN
spellings of one DB must collide), distinct-DB pass, unresolvable-fails-closed. This
mechanism is what F1's shared guard calls.

## F5 [medium] — no network under the snapshot (`cmd/reconcile/phase1.go:178-203`)

**Do:** restructure Phase 1 per Codex: ALL DB reads inside the RR transaction, COMMIT
AND CLOSE, then header fetches/pin ordering in Go against the committed population;
rewind/fork checks preserved around the fixed pin (the Phase-3 re-check already
back-stops). A regression that PROVES no connection is held across RPC (fake chain with
a latency hook + an assertion on the pool/tx state, or a structural seam making the
ordering unrepresentable).

## Harness & mutations

Mutation cases for EVERY finding (Codex's next-steps, binding): guard-bypassed (F1),
taint-dropped-from-verdict (F2), unread-token-vanishes (F3), string-identity-revert
(F4), network-under-snapshot-reintroduced (F5, if representable — else the structural
seam argument in the report). Properties stated; committed applier; per-path kills.

## Scope & environment (binding)

Touch ONLY `cmd/reconcile/**`, `internal/store/reconcile*.go` + store TEST helpers (the
shared guard), `Makefile`, `.superpowers/sdd/**`. internal/store production code beyond
reconcile*.go only if the guard genuinely requires a helper (justify). NEVER
`internal/chain/**` (closed), `internal/prices/**`, `internal/ingest/**`, migrations,
`roadmap/**`, `docker-compose.yml`, `.env.example`. Pathspec staging. **Backfill daemon
RUNNING against DB `solvent`** (final stretch) — the F1/F4 work is precisely about
protecting it; never point a destructive helper at it while developing the guard (use
solvent_test / solvent_t9w1). Commit before mutation loops; in-memory restores;
CRLF-aware patching; committed-blob gofmt via `git cat-file` → temp files; `-race`
(reconcile+store) in `golang:1.24` via `host.docker.internal`;
`dangerouslyDisableSandbox: true` + PATH export. Baseline at start commit (top-level
`^--- PASS`; wave-10 final 726/0/0, gate ON, TEST_DATABASE_URL=solvent_test,
SOLVENT_RECON_DATABASE_URL=live read-only — state your posture both runs); zero
FAIL/SKIP final (with F1 landed, state the acceptance-mode skip count explicitly).

## Reporting

`.superpowers/sdd/task-9-wave11-report-p2.md`: each fix cited to its test + mutation,
the F5 structural argument, anything unverified. Returns to Codex under D-006 —
expected closing round for the reconcile harness.
