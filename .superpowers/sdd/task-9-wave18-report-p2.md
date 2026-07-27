# Task 9 — wave 18 report: round-17 fix (ingest, surgical) — a probe Step NEVER rewinds; no exceptions, no witness attribution

Brief: `task-9-wave18-brief.md` (BINDING), implementing the single Codex
round-17 finding (`task-9-codex-round17.md`, 1M, ACCEPTED — the controller
adjudication REVERSES wave 17's witness-scoped deviation and restores the
chain-truth round-15 consult's R15-6 sentence UNQUALIFIED). This is the
surgical wave the adjudication ordered: one guard, one regression, one
mutant. Everything round 17 confirmed sound — R15-1/2a/2b/2c, R15-7 cycling,
Σ-attempts, the compile-time alias, both wave-14 regressions — is untouched.

Base: start commit `3b42c09` (round-16 archive + wave-19 brief; a docs-only
sibling landed seconds after dispatch — the wave-18 brief itself is
`b0d9173`, and `b0d9173..3b42c09` touches no Go/build file). Branch `main`,
parallel tree — wave 19 (reconcile/store/indexer) runs CONCURRENTLY; a
session-limit interruption mid-wave added docs-only ledger commits
(`1e02fee` tip at resume; `3b42c09..1e02fee` touches only
`.superpowers/sdd/progress-phase2.md`, verified — the Go tree is byte-stable
across the whole interval, so the baseline stands). Scratch DB
`solvent_t9w18` (created this wave; never `solvent`, `solvent_test`, or
another wave's DB); the running indexer daemon and `solvent-db-1` untouched
throughout.

| commit | contents |
| --- | --- |
| `3dedcae` | THE FIX: the rewind-refusal guard drops its `servedBy.Index != incumbent` conjunct (`walker.go`); the round-17 fall-through regression (`walker_probe_discipline_test.go`, purely additive) |
| `748c09d` | mutation spec `.superpowers/sdd/t9w18-mutations/mutations.json` (1 mutant), committed BEFORE the loop |
| `cd4cd45` | mutation transcript, **1/1 KILLED**, tested SHA `748c09d`, in-memory restore verified byte-identical |
| (this commit) | `task-9-wave18-report-p2.md` |

Scope: my commits touch `internal/ingest/{walker.go,
walker_probe_discipline_test.go}` and `.superpowers/sdd/t9w18-mutations/**`
+ this report — nothing else. Pathspec staging on every commit; the scope
gate accepted each (2, 1, 1 paths). `internal/chain/**`, `cmd/**`,
`internal/store/**`, `internal/prices/**`: untouched (no chain change was
plausible for this fix, exactly as the brief predicted).

## The guard diff (the whole fix)

`walker.go`, the reorg-check mismatch arm inside `Step`:

```diff
-			if probing && servedBy.Index != incumbent {
+			if probing { // no exceptions, no witness attribution (round 17)
```

The refusal now applies whenever `probing` is true, full stop. The comment
states the consult's sentence verbatim — "a probe Step refuses the rewind
arm — a cursor-hash mismatch while probing is a DISCARD (non-landing; the
seam advances past the probe witness; lease dissolves). If the reorg is
real, the incumbent's next Step sees it and rewinds with retained-witness
authority; cost = one Step of delay on a genuine reorg that lands inside a
probe Step." — and the wave-17 exception ARGUMENT is deleted from the code
path (the report-side argument was recorded as process law violation by the
adjudication: deviations need an amendment BEFORE shipping, not an argument
in the report). The log line and DiscardError reason are re-worded
witness-neutrally ("on a probe Step (served by endpoint %d)"); the
`"no rewind authority"` substring the wave-17 pin asserts on is preserved.
One adjacent comment in the deferred seam handler is corrected to match the
now-total rule (a discarded probe advances past the Step's SERVING witness —
the incumbent itself when an R15-6 discard's resolution had fallen through
to it); no behavior outside the guard changed. F3 (second-witness
corroboration) remains NOT implemented, stated in the comment.

## The deferred-rewind trace (the reviewer's exact combination, now pinned)

`TestFallThroughProbeMismatchDiscardsAndTheRewindDefersToTheNextStep` (NEW).
n=2, A = (T−1s)/read incumbent, B = probe target with a BROKEN HEAD PROBE
(`headErr` — header path still answers: a degraded provider, not a dead
node); the chain has GENUINELY reorged below the cursor on every view;
block 150 is the verified ancestor:

| Step | start | resolution | posture | outcome | assertions |
| --- | --- | --- | --- | --- | --- |
| 1–3 | 0 | A serves | three over-budget landings | lease SPENT (`slowLandings==3`) | cursor 249 |
| 4 | 1 (probe) | B fails the head read → walk WRAPS to incumbent A → A reports the cursor mismatch | probing=true, servedBy==incumbent — wave 17's exempted sub-case | **DISCARD** (`*DiscardError`, "no rewind authority") | `Store.Rewind` NEVER called (`st.rewound` nil — the fake records every call); advanced=false (no landing); cursor stands at 249; seam advanced past the SERVING witness (`startPref` 0→1); lease DISSOLVED (`slowLandings==0`) |
| 5 | 1 (seam advance) | B still fails the head read → walk wraps to A | NON-probe (the lease dissolved with the witnessed non-landing) | **REWIND through the normal arm** | `st.rewound.toBlock==150`, hash == the verified ancestor's — the IDENTICAL rewind, one Step late, never lost; advanced=true (rewind is a durable write) |

Trace `[0,0,0,1,1]`: step 4 asked for the probe target, step 5 asked for
the seam's advance — same start index, different law, and the successful
rewind at step 5 is itself proof step 5 was non-probing (a probe Step would
have discarded again under the total rule). The shared hint is neither
consulted nor written (`ch.active` asserted). Cost of the total refusal in
this rare compound posture: exactly one Step of delay, which is the trade
the adjudication ratified ("total refusal strictly dominates").

The invariant is now testable WITHOUT witness attribution: with the
conjunct present the fake observes `Store.Rewind` executing on a probe Step
(that is precisely the W18M1 kill); with the fix it observes the discard
and the deferred rewind. `st.rewound` doubles as observe-and-refuse — the
fake records the call and the assertion refuses it; no store write escapes
unobserved.

**Wave-17 probe-refusal regressions, unmodified:** the diff to
`walker_probe_discipline_test.go` is PURELY ADDITIVE (0 removed lines over
`0a4f21c..cd4cd45`) — `TestProbedWitnessCursorMismatchDiscardsInsteadOfRewinding`
and `TestGenuineReorgRewindsOnTheIncumbentStepNotTheProbeStep` are
byte-identical to wave 17's and both pass (verbose run + the final
acceptance run below). All other wave-17 probe-discipline pins likewise run
unmodified and green.

## Mutation matrix (committed applier `wave16-mutations/mutate.py`; spec `748c09d`, transcript `cd4cd45`, tested SHA `748c09d`)

| # | mutation | result | killed by |
| --- | --- | --- | --- |
| W18M1 | the `servedBy.Index != incumbent` conjunct restored — revert to the wave-17 witness-scoped deviation | **KILLED** | `TestFallThroughProbeMismatchDiscardsAndTheRewindDefersToTheNextStep` |

Behavioral kill (the mutant COMPILES; both identifiers are in scope at the
guard); pattern exactly-once-asserted — the spec's search line carries the
guard's trailing comment because the bare three-tab `if probing {` occurs
TWICE in `walker.go` (the caught-up rejection arm uses the identical line);
restore from an in-memory copy, verified byte-identical (`git status` over
the mutated file EMPTY, loop run in a pinned worktree at `748c09d`).
Deliberately disclosed in the spec: the two wave-17 R-F tests are NOT
listed as killers because they PASS under this mutant — the witness-scoped
conjunct still discards probed-witness mismatches, which is exactly why
round 17 demanded this dedicated fall-through regression.

## Verification summary (convention: top-level `^--- PASS` / FAIL / SKIP)

- **Baseline @ `3b42c09`: 793 / 0 / 0, exit 0**, via `make test-acceptance`
  in a PINNED WORKTREE at the start commit. Posture: gate ON
  (`SOLVENT_LIVE_RPC_TESTS=1`), `TEST_DATABASE_URL` → **`solvent_t9w18`**
  (own scratch DB, created this wave), `.env` DSNs exported by the
  Makefile, `SOLVENT_RPC_*` cleared by the target. Target gate:
  "acceptance mode: exit=0 skips=0", "acceptance suite green: zero skips".
  793 matches the round-17 dispatch record and the wave-17 final exactly —
  the interval since (`0a4f21c..3b42c09`) is docs-only, consistent.
- **Final @ `cd4cd45`: 794 / 0 / 0, exit 0**, same posture, same target, in
  a PINNED WORKTREE at `cd4cd45` (private `TMPDIR` so no concurrent wave
  can clobber the log). Gate: "acceptance mode: exit=0 skips=0",
  "acceptance suite green: zero skips". The code delta `3dedcae..cd4cd45`
  is sdd-docs-only, so the run exercises Go trees byte-identical to the
  implementation commit.
- **PASS-list diff, both directions: 0 removed, exactly 1 added —
  `TestFallThroughProbeMismatchDiscardsAndTheRewindDefersToTheNextStep`;
  793+1=794.** Sibling reconciliation, explicit: NO wave-19 test appears in
  the diff — the pinned final run at `cd4cd45` predates any wave-19 code
  commit, and the only ledger motion between baseline and final base
  (`3b42c09..1e02fee` interruption notes) was docs-only, verified against
  `*.go`/`go.mod`/`go.sum`/`Makefile`. No pre-existing test changed name,
  assertion, or vanished.
- **-race (`internal/ingest` — the one package this wave touches) in
  `golang:1.24` via docker (volume `solvent-gomodcache`), at the `cd4cd45`
  pinned worktree: exit 0, 45 top-level `^--- PASS` / 0 FAIL / 0 SKIP, zero
  DATA RACE, package `ok`** — including the new fall-through regression
  (asserted present in the race log). No DB and no gate needed: ingest has
  no live-RPC-gated test (grepped) and never touches Postgres.
- **Build/vet:** `go build ./...` and `go vet ./internal/ingest/` clean at
  the `cd4cd45` worktree.
- **Committed-blob gofmt:** both touched `.go` blobs at `3dedcae` extracted
  via `git cat-file` — `gofmt -l` CLEAN (the working-tree check stays
  CRLF-noisy repo-wide; the blob check is the bar).
- **Environment:** backfill daemon against DB `solvent` untouched (never
  stopped, never signaled); `solvent-db-1` container untouched; tests only
  ever pointed at `solvent_t9w18`; both pinned worktrees pruned after the
  runs.

## Unverified / limits (nothing hidden)

- The deferred rewind is pinned at n=2, where the seam's advance from the
  incumbent lands on the (still-failing) probe target and the next Step's
  resolution WRAPS BACK to the incumbent. At n≥3 the advance lands on a
  DIFFERENT neighbour: if that neighbour is healthy and the reorg is real,
  the next Step's rewind is performed by that neighbour as an ORDINARY
  serving witness — standing single-witness rewind authority, the pre-lease
  norm, explicitly weighed by the adjudication ("not wrong on custody...
  total refusal strictly dominates"). No n≥3 trace of this compound posture
  is asserted; the invariant under test ("a probe Step NEVER rewinds") is
  arm-total and does not vary with n.
- The wave-17 disclosure stack carries forward unchanged (fake-layer-only
  latency proof narrowed by R-H; the (n−1)(L+1) bound witnessed at
  n∈{2,3}; R15-8 one-Step readiness residual; daemon-side figures restated
  not measured). Nothing in this wave touches those surfaces.
- The wave-17/wave-14/wave-12 mutation specs remain valid at their recorded
  SHAs; W18M1 is the only mutant whose pattern this wave's diff moved
  (W17M6's search line no longer exists — its property is subsumed by the
  stronger unqualified guard, and its two named killers still pass).

## Returns to Codex under D-006 — ingest closing round, attempt three

The diff for the round is `0a4f21c..<final>` restricted to
`internal/ingest/**` — verified to contain EXACTLY the two files above
(89 insertions, 30 deletions; the only non-sdd/roadmap files in the whole
range). Suggested targets: the guard's totality (no remaining witness
conjunct anywhere in the mismatch arm), the new regression's step-5
normal-arm attribution, and the W18M1 kill's reliance on the dedicated
regression rather than the wave-17 pins.
