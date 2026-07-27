### Task 9 — wave 18: round-17 fix (ingest, surgical) — a probe Step NEVER rewinds; no exceptions, no witness attribution

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD
at start. **You own `internal/ingest/**` and `.superpowers/sdd/**` ONLY. NEVER
`internal/chain/**` (no chain change is plausible for this fix — STOP and flag if you
believe otherwise), `cmd/**`, `internal/store/**`, `internal/prices/**` — round 16
(reconcile) is in review on a quiet tree.** Pathspec staging; scope-gate refusal =
STOP. Own scratch DB `solvent_t9w18`.

Read: `.superpowers/sdd/task-9-codex-round17.md` (the verbatim finding + the
adjudication that REVERSES wave 17's witness-scoped deviation),
`consult-chaintruth-round15.md` (R15-6 — the unqualified rule being restored),
`task-9-wave17-report-p2.md` (the disclosed residual that became this finding).
Closed law: everything round 17 confirmed sound — R15-1/2a/2b/2c, R15-7 cycling,
Σ-attempts, the alias, both wave-14 regressions object-identical. Touch NONE of it.

## The fix (one guard)

`walker.go:736-770` — the rewind-refusal guard drops its `servedBy.Index !=
incumbent` conjunct: the refusal applies whenever `probing` is true, full stop. A
cursor mismatch on a probe Step is a DISCARD regardless of which endpoint served it;
the seam advances, the lease dissolves, and if the reorg is real the incumbent rewinds
on the next (non-probe) Step through the normal arm. State the consult's sentence in
the comment; delete the report's exception argument from the code path.

## Regression (binding — the reviewer's exact combination)

Probe target B fails the head read → failover wraps to incumbent A → A reports a
cursor mismatch: the Step DISCARDS (assert `Store.Rewind` is NEVER called — the fake
must be able to observe/refuse the call), no landing, seam advances, lease dissolves;
the NEXT Step (non-probe) performs the identical rewind through the normal arm
(assert it happens there, so the fix defers rather than loses the reorg response).
Also assert the wave-17 probe-refusal regressions still pass unmodified.

## Mutation (committed applier)

W18M1: the `servedBy != incumbent` conjunct restored → killed by the new regression
(behavioral kill naming the test). Spec `.superpowers/sdd/t9w18-mutations/mutations.json`
committed BEFORE the loop; applier `.superpowers/sdd/wave16-mutations/mutate.py`
(historical name); in-memory restore byte-identical.

## Environment & reporting (standard, abbreviated)

Baseline `make test-acceptance` at start commit (pinned worktree; expect 793/0/0;
posture stated: gate ON `SOLVENT_LIVE_RPC_TESTS=1`, TEST_DATABASE_URL →
`solvent_t9w18`, `.env` DSNs via Makefile). Final: same posture, zero FAIL/SKIP,
PASS-diff reconciled (round-16 fix waves may interleave — reconcile explicitly).
`-race` (ingest) golang:1.24 docker. Committed-blob gofmt; vet. Report
`.superpowers/sdd/task-9-wave18-report-p2.md`: the guard diff, the deferred-rewind
trace, mutation row, anything unverified. Returns to Codex under D-006 — ingest
closing round, attempt three; the diff for that round is `0a4f21c..<your final>`
restricted to `internal/ingest/**`.
