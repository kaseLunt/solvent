### Task 9 — wave 13: round-11 fixes (reconcile) — close the generator, gate the inability

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. **PARALLEL to wave 12 — file disjointness ABSOLUTE: you own `cmd/reconcile/**`
and `.superpowers/sdd/**` ONLY this wave (Makefile only if F1's test genuinely needs it —
flag loudly). NEVER `internal/ingest/**`, `internal/chain/**`, `cmd/indexer/**` (wave 12
owns), `internal/store/**`, `internal/prices/**`, migrations, `roadmap/**`.** Pathspec
staging; `git log` first; sibling commits will interleave.

Read: `.superpowers/sdd/task-9-codex-round11.md` (verbatim + adjudication),
`task-9-wave11-report-p2.md`. CLOSED — do not re-open: the guard, the identity tuple,
the Phase-1 restructure itself, the DM weld gating, the taint CONSUMPTION path.

## F1 [high] — close the taint generator over the flag surface (`main.go:151-180`)

Enumerate EVERY flag that can weaken a required bound (snapshotMaxAge, loose-positive
maxHeadLag, and sweep the whole flag surface yourself — the finding names two, the class
is "any override that loosens what acceptance requires"). Each gets: taint or reject in
acceptance mode. Canonical defaults stay taint-free. **Test (Codex's, binding):** parses
ACTUAL flag combinations → derives taints → calls computeResult; the
`-snapshot-max-age 2562047h -max-head-lag 2562047h` invocation must be non-pass.
Mutation: drop one flag from the generator → killed.

## F2 [high] — inability-to-check is never advisory (`phase2.go:765-772`)

Separate the two policies: numeric collateral mismatch stays ADVISORY (the amendment's
first-run gating); **weld-unread is ALWAYS GATED** regardless of which weld produced it
(set Gated on the unread verdict independently of the mismatch policy). Collateral-unread
unit test (getReserveAToken revert → run is non-pass) + mutation (unread-ungated →
killed). State the axiom at the site: "cannot verify" is never advisory.

## F3 [medium] — a real F5 seam (`phase1_seam_test.go:82-84`)

Replace/augment W11M5 with a mechanism that FAILS on network calls while the RR
transaction is open: a runtime ordering seam (e.g., the chain reader handed to Phase 1
wrapped in a sentinel that panics/errors if invoked while the tx is live — the tx
open/close toggling the sentinel) or a structural AST check in a test. Then the mandated
mutation: reintroduce an actual header/RPC call under BeginTx → demonstrably KILLED.
The wave-11 claim of unrepresentability is retracted in your report (data-inspection is
not behavior-inspection — cite round 11 finding 3).

## Environment (binding, unchanged)

Backfill daemon RUNNING (may finish mid-wave). Tests on `solvent_test`; recon evidence
tests on `SOLVENT_RECON_DATABASE_URL` read-only. Commit before mutation loops; in-memory
restores; CRLF-aware patching; committed-blob gofmt via `git cat-file` → temp files;
`-race` (reconcile) in `golang:1.24` via `host.docker.internal`;
`dangerouslyDisableSandbox: true` + PATH export. Baseline at your start commit
(top-level `^--- PASS` + full posture stated both runs; wave-11 final 739/0/0 via
make test-acceptance; sibling wave-12 additions reconciled explicitly in your PASS-list
diff). Zero FAIL/SKIP; acceptance-mode skip count stated.

## Reporting

`.superpowers/sdd/task-9-wave13-report-p2.md`: the closed flag-surface table (every
flag → taint class or justified-canonical), the two-policy separation, the real F5 seam,
mutations, anything unverified. Returns to Codex under D-006 — expected closing round
for the reconcile harness.
