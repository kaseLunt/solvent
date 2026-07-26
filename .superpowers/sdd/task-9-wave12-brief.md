### Task 9 — wave 12: walker rotation seam (ingest + chain reopen)

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. **Runs PARALLEL to wave 11 — file disjointness is ABSOLUTE: you own
`internal/ingest/**`, `internal/chain/**` (additive), `cmd/indexer/main.go` (ONLY the
stepWalkers discard/streak seam, flag it loudly), `.superpowers/sdd/**`. NEVER touch
`cmd/reconcile/**`, `internal/store/**`, `Makefile` — wave 11 owns them. Pathspec
staging; expect interleaved commits from the sibling wave; `git log` before you start.**

BINDING ANNEX: `.superpowers/sdd/consult-chaintruth-walker-rotation.md` — the full
ruling, regression schedules (R1–R9) and mutation schedules (M1–M7) live there; this
brief is the controller's scope cut over it. Read it completely, then
`task-9-codex-round2.md` (the law you are transposing) and `internal/prices/poller.go`
:913-948 (the deferred-seam shape you copy verbatim in structure).

## Scope cut (controller-adjudicated)

- **IN (blocking): F1 + F2 + the harness precondition + R1–R5, R8, R9 + M1–M7.**
- F4's caught-up-frozen-head rider: implementer discretion — include with justification
  or record open explicitly in the report.
- **OUT:** F3 (single-witness rewind corroboration — deferred to its own proposed
  decision post-Task-9; do NOT implement); F5/F6 disclosed in the report only.

## F1 [blocking] — per-stream routing: landing is the only outcome that keeps the start

- Chain layer, ADDITIVE ONLY: `BlockNumberFrom`, `LogsFrom` (keep the exact questions on
  the wire; `HeaderHashFrom` exists). NO aggregate outcome propagation — the walker
  advances routing on both postures, so unanimity machinery is unnecessary (smallest
  possible reopen of approved chain.go).
- Walker: `startPref` field under the existing single-writer per-Step contract; first
  read of a Step resolves `servedBy`; EVERY subsequent read in that Step pinned
  `From servedBy` with token equality required (mismatch = coherence discard). One
  deferred outcome seam keyed on a `landed` flag — every non-landing exit advances
  `startPref` past the serving endpoint; future arms get the advance for free.
- **Retention, not reset:** landing sets `startPref = servedBy`. Never write the shared
  hint (d1e7d54 + the Task-7 RotateAwayFrom deletion are accepted-decision-level; the
  consult's R3 sibling-interference regression exists to kill any shared-hint
  implementation).
- **Rewind counts as landing. Caught-up (no window attempted) keeps the start.**

## F2 [blocking] — discards join the failure streak

The silent discard loop (tip-changed / cursor-changed return `false, nil`) currently
hits `bo.success()` — backoff resets every round, no `step_error`, invisible wedge.
**Do:** discards surface as their own outcome: they join the backoff streak (bounded
pacing preserved), set a distinct condition (visible in health), and advance routing via
the seam. A genuine landing (batch saved or rewind) is the ONLY `bo.success()`. This is
the round-3 pacing/visibility law applied at ingest — cite it.

## Harness (the consult's precondition is binding)

FIRST deliverable: a per-endpoint fake chain for walker tests (the prices wave-6
endpointView pattern) mirroring doFrom exactly — run it against the UNCHANGED walker and
record which existing tests it preserves (the current single-view fake is structurally
incapable of expressing endpoint disagreement — the round-5 fixture law). Then R1–R5,
R8, R9 per the consult's schedule (incident replay; silent-discard streak growth; R3
sibling interference; coherence; retention/liveness with the n=2 termination trace
pinned; caught-up; real-Dial raw-JSON for the new From methods; daemon-wrapper
mixed-posture pacing). Mutations M1–M7 via the committed applier, properties stated.

## Environment (binding, unchanged)

Backfill daemon RUNNING against DB `solvent` (it may FINISH mid-wave — that changes
nothing for you; never stop it/the container). Tests on `solvent_test`
(`TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_test?sslmode=disable'`).
Commit before mutation loops; in-memory restores; CRLF-aware patching; committed-blob
gofmt via `git cat-file` → temp files; `-race` (ingest+chain) in `golang:1.24` via
`host.docker.internal`; `dangerouslyDisableSandbox: true` + PATH export. Baseline at
your start commit (top-level `^--- PASS` + gate posture stated both runs; note the
sibling wave may land between your baseline and final — diff PASS-lists against YOUR
baseline and reconcile any sibling additions explicitly, the wave-4/-9 interleaving
precedent). Zero FAIL/SKIP under stated posture.

## Reporting

`.superpowers/sdd/task-9-wave12-report-p2.md`: the seam structure, per-endpoint fake
adoption record, every regression cited, F4 decision with justification, F5/F6
disclosures, mutation matrix, anything unverified. Returns to Codex under D-006 (reopens
approved ingest+chain surface — say so plainly).
