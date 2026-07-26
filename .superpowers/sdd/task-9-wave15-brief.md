### Task 9 — wave 15: round-13 fixes (reconcile) — every input is in the taint domain; the boundary proof must resolve indirection

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. **PARALLEL to wave 14 — you own `cmd/reconcile/**` and `.superpowers/sdd/**`
ONLY. NEVER `internal/ingest/**`, `internal/chain/**`, `cmd/indexer/**` (wave 14 owns),
`internal/store/**`, `internal/prices/**`, migrations, `roadmap/**`, Makefile.**
Pathspec staging; sibling commits interleave; SEPARATE scratch DB (create
`solvent_t9w15`).

Read: `.superpowers/sdd/task-9-codex-round13.md` (verbatim + adjudication),
`task-9-wave13-report-p2.md`. Closed law: F2 gating, the flag-surface table, W13M3's
retraction, blanket `-accounts` taint (stands; the replay manifest is recorded future
work — do NOT build it).

## F1 [high] — the env surface joins the taint domain (`phase1.go:614-622`)

`SOLVENT_SNAPSHOT_INTERVAL=1000000h` → ~228-year freshness bound → stale snapshots
classified fresh → pass. **Do (pick and justify):** (a) hard acceptance maximum for the
cadence-derived bound (derive the cap from the daemon's real cadence semantics — the
1h default and the health surface's own widening rule — not a magic number), values
beyond it reject/taint in acceptance mode; AND/OR (b) bind the freshness calculation to
independently persisted daemon cadence (sweep_generations.last_pass_seconds /
migration-00006/00008 data are already durable — justify whichever source you use).
Sweep the REST of the env surface the same way (SOLVENT_RECON_*, any timeout envs —
produce the env-surface table like wave 13's flag table). **Regression (binding):**
env-to-freshness-to-verdict with an extreme positive interval → non-pass. Mutation:
cap-removed → killed.

## F2 [medium] — resolve indirection or restrict imports (`phase1_f5_seam_test.go:110-133`)

**Prefer the structural fix:** move snapshot collection into an import-restricted
DB-only package (no chain/network imports possible — the compiler becomes the proof),
with the AST/types test reduced to asserting the import list. If you argue the package
split is disproportionate, the alternative bar is HIGH: import-path-aware go/types or
SSA analysis resolving function values, interface dispatch, and aliased imports —
justify the choice explicitly. **Negative mutants (binding, per evasion shape):**
package-level function value, aliased import, interface dispatch — each demonstrably
KILLED. Plus the DB-backed test proving the PRODUCTION gate is active from BeginTx
through commit/rollback and connection close (not manually toggled).

## Environment (binding)

Backfill daemon status: endgame or complete — either way never touch it or
solvent-db-1. Own scratch DB `solvent_t9w15`; recon evidence reads via
SOLVENT_RECON_DATABASE_URL read-only. Commit before mutation loops; in-memory restores;
CRLF-aware patching; committed-blob gofmt via `git cat-file` → temp files; `-race`
(reconcile) in `golang:1.24` via `host.docker.internal`; `dangerouslyDisableSandbox:
true` + PATH export. Baseline at your start commit (top-level `^--- PASS` + posture
stated both runs; wave-13 final 760/0/0 — wave 14 may land more; reconcile siblings
explicitly). Zero FAIL/SKIP; acceptance-mode skip count stated.

## Reporting

`.superpowers/sdd/task-9-wave15-report-p2.md`: the env-surface table, the chosen F1
mechanism with derivation, the F2 structural choice justified, negative-mutant matrix,
the production-gate DB test, anything unverified. Returns to Codex under D-006 —
expected closing round for the reconcile harness.
