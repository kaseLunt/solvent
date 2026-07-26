### Task 9 — wave 14: round-12 fix (ingest) — retention holds, but latency buys a probe

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. **PARALLEL to wave 13 — file disjointness ABSOLUTE: you own `internal/ingest/**`
and `.superpowers/sdd/**` (cmd/indexer test files ONLY if the daemon-level scheduling
assertion needs one — new file, flagged). NEVER `cmd/reconcile/**` (wave 13 owns),
`internal/chain/**` (no chain change expected — flag loudly if genuinely forced),
`internal/store/**`, `internal/prices/**`, migrations, `roadmap/**`.** Pathspec staging;
sibling commits will interleave.

Read: `.superpowers/sdd/task-9-codex-round12.md` (verbatim + the adjudication that
REVISES the annex), `consult-chaintruth-walker-rotation.md` (the annex being revised),
`task-9-wave12-report-p2.md`. Closed law: the seam itself, the per-endpoint fake, the
discard-streak composition.

## F1 [high] — bounded retention lease (`walker.go:292-293`)

Unconditional retention pins a just-below-timeout endpoint forever; the serialized
daemon starves while a fast peer is never queried. **Do (the d1e7d54 pattern, stated in
the comment):** retention holds by DEFAULT; a caller-scoped latency budget (derive it
from existing constants — the per-attempt timeout and the round shape — not a new magic
number; justify the derivation) counts consecutive landed Steps whose wall time exceeds
the budget; at the bound, the NEXT Step probes `startPref+1` (caller-scoped, shared hint
untouched, no reset); if the probe lands with better latency, adopt it (retention
transfers); if it lands worse or fails, the seam handles it as usual (a failed probe is
a non-landing → advance past it; a slower-landing probe returns to the incumbent and
re-arms the budget). BOTH failure modes get regressions:

- **Codex's (binding):** endpoint 0 repeatedly lands just below the timeout; endpoint 1
  fast — endpoint 1 is reached within a FINITE, ASSERTED bound, and daemon siblings
  remain scheduled (a daemon-level assertion that one slow walker cannot monopolize the
  round beyond its budget — the R9 harness extends).
- **The annex's (still binding):** the A-bounce regression (R3/R5 family) must still
  pass — the probe must not recreate reset-to-hint behavior.

Mutations: budget-removed (pin returns → killed by Codex's regression); probe-adopts-
unconditionally (bounce returns → killed by the annex regression); budget-derivation
constant drift (property: the bound is finite and stated). Committed applier.

## Round-13 coverage note (for the report)

Round 12's diff framing missed `10ed6d8` (per-endpoint fake) and `b6e7c2f` (chain
additive) — your report must state the full commit set for round 13 so the reviewer
diffs an explicit range covering wave 12 + wave 14 ingest surface together.

## Environment (binding)

Backfill daemon RUNNING (endgame — may finish mid-wave). **Use your OWN scratch DB**
(`docker exec solvent-db-1 psql -U solvent -d postgres -c "CREATE DATABASE solvent_t9w14 OWNER solvent;"`,
then TEST_DATABASE_URL at it) — the parallel-wave shared-scratch collision is a recorded
incident; separate DBs are now the standing rule. Commit before mutation loops;
in-memory restores; CRLF-aware patching; committed-blob gofmt via `git cat-file` → temp
files; `-race` (ingest) in `golang:1.24` via `host.docker.internal`;
`dangerouslyDisableSandbox: true` + PATH export. Baseline at your start commit
(top-level `^--- PASS` + posture stated both runs; wave-12 final 754/0/0 — but wave 13
may have landed more; reconcile sibling additions explicitly). Zero FAIL/SKIP.

## Reporting

`.superpowers/sdd/task-9-wave14-report-p2.md`: the budget derivation, both regressions
cited, the scheduling assertion, mutation matrix, the round-13 commit-set statement,
anything unverified. Returns to Codex under D-006 — expected closing round for the
ingest reopen.
