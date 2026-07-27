### Task 9 — wave 17: round-15 fixes (ingest) — the armed state gets outcome discipline; measurement becomes witness-sum; probes carry no authority

Repo `C:/Users/kasel/source/repos/etherfi/Solvent`, branch `main`. Base: current HEAD at
start. **PARALLEL to wave 16 — file disjointness ABSOLUTE: you own `internal/ingest/**`,
`internal/chain/**` (additive only: the timed From variants + the exported attempt
timeout), `.superpowers/sdd/**`. NEVER `cmd/indexer/**` (wave 16 owns it — any
daemon-level assertion you cannot express at the walker layer is FLAGGED in the report,
not smuggled), `cmd/reconcile/**`, `internal/store/**`, `internal/prices/**`,
`internal/snapshot/**` (the consult ruled touching the last two NOT forced — the
lease-length fix is prose-in-ingest only).** Pathspec staging; sibling commits
interleave; own scratch DB `solvent_t9w17`.

Read, in order: `.superpowers/sdd/task-9-codex-round15.md` (the five verbatim
findings), **`consult-chaintruth-round15.md` — BINDING: its blocking list is this
wave's work order and its regression/mutant matrix (R-A through R-J) is mandatory**,
`task-9-wave14-report-p2.md`, `consult-chaintruth-walker-rotation.md`. Closed law: the
wave-12 seam (landing is the only outcome that keeps the starting point; EVERY posture
flows through the deferred handler), retention-not-reset, the shared hint is never
consulted nor written by probe machinery, no new magic numbers.

## The work order (the consult's blocking list, restated for scope)

- **R15-1** — a probe Step that returns CAUGHT-UP → probe REJECTED + lease RE-ARMS IN
  FULL (routing no-op; `startPref` never moved). Kills the frozen-neighbour wedge.
- **R15-2a** — a probe that FALLS THROUGH to the incumbent and lands → measured
  cleanly as the incumbent's witness-sum, but the lease still RE-ARMS IN FULL (else
  finding 2's per-Step timeout tax returns through the side door).
- **R15-2b** — the witness-less total-failure path JOINS the deferred seam, with the
  lease PRESERVED (not reset: a flapping network must not suppress probes forever).
- **R15-2c** — the probe FAILURE posture stays with the wave-12 seam arm: advance past
  the probe witness (the lease dissolves with the advance). NOT the reject arm. At n=2
  this IS return-to-incumbent; at n≥3 it is the escape route past a content-broken
  neighbour. (The controller's provisional reject-on-failure ordering is REFUTED —
  do not implement it.)
- **R15-3 + R-H** — adjudication on **Σ of the serving attempt's own elapsed across
  the Step's reads**: additive timed variants of the three walker-facing From methods
  in `internal/chain` (signature-forced population — the consult rejected an
  `EndpointToken` field as forgettable). The per-endpoint fake's servedElapsed derives
  from the SAME scripted `readCost` that drives `advanceClock`, so wall and
  witness-sum CAN diverge — that divergence kills the wall-mutant. PLUS the hermetic
  real-Dial chain test: slow-failing primary (~200ms) → token elapsed ≪ 200ms while
  call wall ≥ 200ms.
- **R15-4** — subsumed BY CONSTRUCTION: Σ-attempts excludes SaveBatch, store.Cursor,
  the rewind path's store reads, and validation CPU. Assert as a property, not a
  subtraction. Slow-store visibility is daemon-owned; you may additively expose a
  walker-side observer (HeadLag pattern) but wire NOTHING in cmd/indexer — flag for
  the closing round.
- **R15-6 [consult-found, blocking]** — probe Steps REFUSE the rewind arm:
  mismatch-while-probing is a DISCARD; if the reorg is real the incumbent rewinds next
  Step. A probed neighbour must never trigger a destructive rewind on its sole word
  nor be adopted off the churn it caused. (Annex F3 itself stays a future decision —
  state the non-claim.)
- **R15-7 [consult-found, blocking]** — the probe target CYCLES 1..n−1 across spent
  leases (a rejected-but-non-failing neighbour must not shield peers behind it). The
  stated escape bound becomes ≤ (n−1)(L+1) Steps. n=2 traces are BYTE-IDENTICAL: both
  shipped wave-14 regressions stay green UNMODIFIED — that is itself a gate.
- **R15-5a** — `internal/chain` EXPORTS the attempt timeout; ingest binds by
  **compile-time alias** (drift unrepresentable — stronger than restate+assert; the
  wave-14 report promised this for the next chain-open wave, which this is).
  Lease-length restatement chain: prose citation fix in ingest ONLY.
- **Consult notes, all addressed:** probe Steps must not stamp
  lastHead/ObservedHead from the probed witness beyond the consult's stated one-Step
  residual; the n=1 armed-lease regression gap; the `stepMaxPinnedReads` ask-count
  guard; ceiling prose scoped to window Steps (rewind walks legitimately exceed it).

## Regressions & mutations (binding)

The consult's R-A..R-J matrix is the floor, not the ceiling: every regression cited by
name in the report, every mutant demonstrably KILLED through the committed applier
(spec `.superpowers/sdd/t9w17-mutations/mutations.json` committed BEFORE the loop;
shared applier at `.superpowers/sdd/wave16-mutations/mutate.py` — historical Task-8
name). Trace tables required in the report for: the round-12 schedule (escape at Step
L+1), round-15 finding-2 schedule (bounded probe tax ≤ 1×T per L+1 Steps), the R15-7
shield schedule at n=3 (escape via cycling), and the A-bounce family (still green).

## Environment (binding)

Own scratch DB `solvent_t9w17` (create it; never `solvent`, `solvent_test`, or another
wave's DB); daemon + `solvent-db-1` untouched. Commit before mutation loops; in-memory
restores verified byte-identical; CRLF-aware patching; committed-blob gofmt via
`git cat-file` → temp files; `-race` (ingest + chain) in `golang:1.24` docker at
`host.docker.internal` (named volume `solvent-gomodcache` exists);
`dangerouslyDisableSandbox: true` + PATH export. Baseline at your start commit via
`make test-acceptance` (top-level `^--- PASS` convention; posture stated both runs;
wave-16 lands commits mid-flight — reconcile/store/indexer sibling additions
reconciled explicitly, exactly like wave 14 did). Zero FAIL/SKIP; acceptance-mode skip
count stated. If the scope gate refuses any path: STOP and report.

## Reporting

`.superpowers/sdd/task-9-wave17-report-p2.md`: the four trace tables, the Σ-attempts
mechanism and its chain-side signature, the compile-time alias, the R15-6 refusal
shape, non-claims stated (F4 frozen-incumbent, F3 rewind corroboration, the
caught-up-probe-ends-daemon-round compound pathology — flagged daemon-side, out of
scope), mutation matrix, anything unverified. Returns to Codex under D-006 — the
ingest closing round, attempt two.
