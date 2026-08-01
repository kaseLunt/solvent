# Mutation transcript — Wave H6a (the Codex round-5 HIGH: failed sweep attempts laundered into an honest race)

Durable mutation evidence for the one finding this wave closes — the H5a
never-swept branch fed `dmNeverSweptRace` completion-edge arithmetic alone,
so an account whose OWN snapshot_sweeps row said attempted=true /
status=failed could still classify honest-race whenever a lagging RPC exec
clock stamped its failed attempt below its first-debt block (first debt 200,
completed-generation completion edge 100, 200 > 100 => disclosed coverage
gap) — a pass-that-should-fail, unsampled by a large-enough census. The H6a
conjunct: the account's own attempt row is a positive witness that the cycle
REACHED it, so the never-reached exemption is unavailable to ANY attempted
account, whatever the edge arithmetic says; and because snapshot_sweeps keeps
only the LAST attempt, the surviving row cannot be scoped to the pin-completed
generation in either direction, so ANY attempt fails closed. The check landed
in the classifier (`dmNeverSweptRace` now takes the account's
`snapshotdb.T6SweepState`) so every caller inherits it — no call-site
patching. Convention follows wave-h.md ... wave-h5a.md.

## Mutant spec — fixed by the wave brief BEFORE the loop ran

One designed mutant, specified verbatim in the wave task ("temporarily
re-allow the exemption for attempted-and-failed rows — the exact regression
Codex describes"). The kill suite (hermetic — pure functions and synthetic
fixtures, no DB, no RPC):

```
go test ./cmd/reconcile -count=1 -run 'TestNeverSweptFailedAttemptGates|TestNeverSweptAttemptedKillsEveryExemption|TestNeverSweptOverlapGates|TestNeverSweptCompletionEdgeDiscloses|TestNeverSweptReshape|TestNeverSweptFailedStragglerGates'
```

- **m1 — attempted-and-failed rows regain the exemption.** In
  `dmNeverSweptRace` (dm_gate.go), the H6a guard

  ```go
  if st.Attempted {
  ```

  becomes

  ```go
  if st.Attempted && st.Status != "failed" { // MUTANT m1
  ```

  — precisely the Codex round-5 regression: an attempted row whose status is
  "failed" falls through to the completion-edge arithmetic and (edge 100 <
  first debt 200) discloses as an honest race again.

  Expected kills: `TestNeverSweptFailedAttemptGates` (wave_h6a_fixes_test.go,
  the end-to-end Codex scenario through classifySweepTestimony with a padded
  123-borrower census) and `TestNeverSweptAttemptedKillsEveryExemption`
  (the classifier-layer pin, whose fixtures use status "failed").
  Expected stays-green controls, not kill vectors: the H3/H4a/H5a suites —
  `TestNeverSweptReshape` (its attempted arm uses status "error", which the
  mutant still gates, and its unit calls pass a zero T6SweepState),
  `TestNeverSweptOverlapGates`, `TestNeverSweptCompletionEdgeDiscloses`, and
  `TestNeverSweptFailedStragglerGates` (all unattempted borrowers — the six
  conjuncts of the H5a completion-edge law must be untouched by this wave).

## Tested tree

- Branch `main`, HEAD `9cb190d`, PLUS this wave's uncommitted Wave-H6a
  changes (mutant cut against the FIXED code after the wave's regressions
  went green; NOTHING committed by this wave — the brief forbids
  committing). A sibling wave concurrently owns internal/riskfeed, cmd/api,
  and internal/store; scope here is cmd/reconcile only, and the package
  gates run on `./cmd/reconcile/...` alone per the brief.
- Fixed-file sha256 (before-hash AND after-restore hash; restore verified
  byte-identical):
  - `cmd/reconcile/dm_gate.go`
    `a689631a90995706f43c0794627fc6662e99d755cdfdd792b48a9a23f1713ccf`
- Red evidence BEFORE the fix (TDD): `TestNeverSweptFailedAttemptGates`
  FAILED against the pre-H6a code at wave_h6a_fixes_test.go:109
  ("Should be true" on r.Gated — the laundered borrower came back
  DISCLOSED as a coverage gap).
- Kill suite on the fixed tree BEFORE the loop: `ok` (full
  `go test ./cmd/reconcile/...` green, 1.9s).

## Execution — KILLED, restore verified

### m1 — attempted-and-failed rows regain the exemption (dm_gate.go)

Mutated-file sha256:
`6951bb1b7bd5ceb2269e8ec580febdd6580be6b2ec2e3dcf787547f91ee456a6`
(the one-line guard mutation per the spec).

KILLED by `TestNeverSweptFailedAttemptGates` (wave_h6a_fixes_test.go:109),
exactly the designed message ("m1 kill (Codex round 5 HIGH): the borrower's
own snapshot_sweeps row says attempted=true/status=failed — generation 7
REACHED it and exhausted retries, so the never-reached race exemption is
unavailable no matter that firstDebt 200 > completion edge 100 (a lagging
exec clock stamps attempts below arrivals). A failure must never widen into
an exemption") — under the mutant the borrower came back DISCLOSED instead
of gated. Second kill (designed): `TestNeverSweptAttemptedKillsEveryExemption`
(wave_h6a_fixes_test.go:144 — the classifier-layer shape-1 arm). The
stays-green controls stayed green under the mutant, as the spec predicted:
`TestNeverSweptReshape` (status "error" still gated; zero-state unit calls
untouched), `TestNeverSweptOverlapGates`,
`TestNeverSweptCompletionEdgeDiscloses`, `TestNeverSweptFailedStragglerGates`.

## Restores

Restore verified byte-identical to the fixed-file sha256
(`a689631a90995706f43c0794627fc6662e99d755cdfdd792b48a9a23f1713ccf` for
dm_gate.go, checked after m1). Full gate on the restored tree:
`go build ./cmd/reconcile/...` clean, `go vet ./cmd/reconcile/...` clean,
`go test ./cmd/reconcile/... -count=1` →
`ok github.com/kaselunt/solvent/cmd/reconcile` (1.7s),
`ok github.com/kaselunt/solvent/cmd/reconcile/snapshotdb` (0.8s).
Skipped tests (environment-gated, unchanged by this wave): the
TEST_DATABASE_URL DB-fixture suites and the Live* RPC suites (18 skips, each
printing its own guard). `-race` is not runnable on this machine
(`-race requires cgo`; no C compiler in PATH) — the changed code is pure
sequential classification logic with no goroutines.
