# Mutation transcript — Wave H5a (the Codex round-4 HIGH on the H4a cycle-witness law)

Durable mutation evidence for the one finding this wave closes — the H4a
never-swept race guard cleared a pin-completed candidate generation on its
OPENING edge (`MinAttemptBlock <= firstDebt`), but internal/snapshot's Step
completes a generation only after store.SweepWorkBatch (a dynamic registry
re-query, every batch) returns EMPTY, so a borrower appearing while a
generation is still OPEN is OWED by that generation. The 100/200/300 overlap
(attempt at 100, arrival at 200, attempt at 300, completion at or below the
pin, borrower never attempted) disclosed honest-race — a
pass-that-should-fail. The H5a law: honest-race only when the arrival edge
strictly EXCEEDS the witnessed completion edge (max attempt block over the
CURRENT completed generation's complete row set — the only completion
witness the schema can state); overlap, non-current candidates, and
missing/sticky/ambiguous chronology all GATE. Convention follows
wave-h.md ... wave-h4a.md.

## Mutant spec — WRITTEN BEFORE THE LOOP RAN

One designed mutant: the fixed code reverted to the exact defective shape
Codex round 4 named. The kill suite (hermetic — pure functions and synthetic
fixtures, no DB, no RPC):

```
go test ./cmd/reconcile -count=1 -run 'TestNeverSweptOverlapGates|TestNeverSweptCompletionEdgeDiscloses|TestNeverSweptReshape|TestNeverSweptFailedStragglerGates'
```

- **m1 — the overlap gate reverted to the H4a opening-edge heuristic.** In
  `dmNeverSweptRace` (dm_gate.go): delete the `default:` completion-edge
  branch from the `cy.CurrentCompleted` switch (so a current generation
  completed at or below the pin falls through to the candidate walk, as in
  H4a), and replace the final non-current-candidate GATE return with the
  H4a opening-edge loop restored verbatim:

  ```go
  for g := k; g <= cy.CurrentGeneration; g++ {
      if span, ok := cy.Generations[g]; ok && span.Rows > 0 && span.MinAttemptBlock <= firstDebt {
          return true, fmt.Sprintf("generation %d attempted at block %d <= first debt block %d, so generation %d (the newest that could have completed at or below pin %d) opened at or before the arrival — no completed cycle has been owed this account", g, span.MinAttemptBlock, firstDebt, k, pin)
      }
  }
  return false, fmt.Sprintf("no attempt by generation >= %d is witnessed at or below the arrival edge %d: either a completed generation opened after this account arrived and still skipped it (a sweeper defect), or the opening edge is unwitnessable — both GATE, because missing or sticky cycle evidence is never disclosed", k, firstDebt)
  ```

  Expected kill: `TestNeverSweptOverlapGates` (wave_h5a_fixes_test.go) — the
  committed Codex round-4 regression. Under the mutant, generation 7's
  attempt at block 100 <= arrival 200 discloses the borrower as an honest
  race; the fixed law gates it on completion-edge arithmetic
  (200 <= 300). Expected collateral fires (bonus, not the designed kill):
  the H5a arms of `TestNeverSweptReshape` (the overlap arm, the
  non-current-candidate arm) and the completion-edge receipt assertions of
  `TestNeverSweptCompletionEdgeDiscloses`. `TestNeverSweptFailedStragglerGates`
  (H4a's committed regression) is expected to stay green under BOTH the
  fixed law and this mutant — its span [250, 280] sits entirely above the
  arrival 200, which the opening-edge heuristic also gated — so it is in
  the suite as the stays-green control, not a kill vector.

The mutant is applied to the FIXED file, the kill suite run, the outcome
recorded verbatim, and the file restored byte-identical (sha256 before ==
after), per the r13/r14/wave-h/wave-h2/wave-h3/wave-h4a discipline.

## Tested tree

- Branch `main`, HEAD `846c241` ("docs(sdd): wave 18 landed..."), PLUS this
  wave's uncommitted Wave-H5a changes (mutant cut against the FIXED code
  after the wave's regressions went green; NOTHING committed by this wave —
  the wave brief forbids committing). A SIBLING wave concurrently owns
  internal/store + api + client + web; its in-flight untracked migration
  (internal/store/migrations/00018_observatory_sweep.sql) breaks five
  cmd/reconcile DB-fixture tests at goose-up, before any reconcile logic
  runs — pre-existing to this wave and outside its zone (see the full-gate
  tail below).
- Fixed-file sha256 (before-hash AND after-restore hash; restore verified
  byte-identical):
  - `cmd/reconcile/dm_gate.go`
    `5b1db6da1da606a0b184709447c1d060bf086e06b4063a91eaf4b0f9581881bd`
- Kill suite on the fixed tree BEFORE the loop: `ok` (1.522s).

## Execution — KILLED, restore verified

### m1 — the overlap gate reverted to the H4a opening-edge heuristic (dm_gate.go)

Mutated-file sha256:
`5d9479fd594a5bfb679b3a812490528513c1bef0d1e04c6caedeecd1b97897ea`
(the `default:` completion-edge branch deleted from the `cy.CurrentCompleted`
switch and the non-current-candidate GATE return replaced with the H4a
opening-edge loop restored verbatim, per the spec).

KILLED by `TestNeverSweptOverlapGates` (wave_h5a_fixes_test.go:96), exactly
the designed message ("m1 kill (Codex round 4 HIGH): the borrower's first
debt block 200 OVERLAPS generation 7's open span [100, 300] —
SweepWorkBatch re-queries the registry every batch, so the still-open
generation was OWED this borrower and completed without attempting it. The
H4a opening-edge heuristic disclosed exactly this shape (100 <= 200)") —
under the mutant the 100/200/300 borrower came back DISCLOSED instead of
gated. The expected collateral fires landed too (bonus kills, not the
designed one): `TestNeverSweptReshape`'s overlap arm
(wave_h3_fixes_test.go:354) and
`TestNeverSweptCompletionEdgeDiscloses` (wave_h5a_fixes_test.go:161 — the
mutant's receipt no longer prints the completion-edge arithmetic).
`TestNeverSweptFailedStragglerGates` stayed green under the mutant, as the
spec predicted (its span [250, 280] sits entirely above the arrival 200,
which the opening-edge heuristic also gated) — the stays-green control, not
a kill vector.

## Restores

Restore verified byte-identical to the fixed-file sha256
(`5b1db6da1da606a0b184709447c1d060bf086e06b4063a91eaf4b0f9581881bd` for
dm_gate.go, checked after m1). Kill suite on the restored tree: `ok`
(2.300s). Full gate on the fixed tree after the loop, with .env sourced:
`go build ./...` clean, `go vet ./cmd/reconcile/...` clean,
`go test ./cmd/reconcile/... -p 1 -count=1` →
`ok github.com/kaselunt/solvent/cmd/reconcile/snapshotdb`; the main
`cmd/reconcile` package reports five DB-fixture failures
(`TestSnapshotGateRefusesUnackedReorgEpoch`,
`TestSnapshotGatePassesWhenEpochAcked`, `TestRecheckStateIsOneSnapshot`,
`TestConnectedIdentityRecordsServerTruth`,
`TestProductionGateActiveThroughSnapshotLifecycle`), every one failing at
goose-up on the SIBLING wave's in-flight untracked migration
(`internal/store/migrations/00018_observatory_sweep.sql`:
`column w.sweep_applicable does not exist`, SQLSTATE 42703) — before any
reconcile logic runs, pre-existing to this wave, and outside its zone
(cmd/reconcile only; internal/store is read-only here). Every
never-swept/race suite this wave owns is green.
