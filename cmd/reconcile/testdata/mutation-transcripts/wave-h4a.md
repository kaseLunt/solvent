# Mutation transcript — Wave H4a (the Codex NOT-SHIP remedies on the H3 boolean law)

Durable mutation evidence for the three Codex findings this wave closes —
F2 (the never-swept race guard's fleet-min false-pass), F3 (the retro test's
artifact binding), F4 (the S-clock param cut over the collapsed pin view) —
following the in-package convention of wave-h.md / wave-h2.md / wave-h3.md.

## Mutant specs — WRITTEN BEFORE THE LOOP RAN

Three designed mutants, one per finding: each is the FIXED code reverted to
the exact defective shape Codex named. The kill suite for all three
(hermetic — pure functions and sealed synthetic artifacts, no DB, no RPC):

```
go test ./cmd/reconcile -count=1 -run 'TestNeverSweptFailedStragglerGates|TestNeverSweptReshape|TestAcceptR5RetroParserBarsRefuse|TestDMParamsAtBlockReconstructsS|TestDMFoldParamsAtSRefusesWithoutTheRawLedger'
```

- **m1 — the race guard reverted to fleet-min (F2).** In
  `classifySweepTestimony` (dm_gate.go), replace the per-generation call
  `race, raceWitness := dmNeverSweptRace(firstDebt, c.pinOP, cycles)` with
  the Wave-H3 shape restored verbatim: the fleet's minimum pin-visible
  success block computed over `t6.DMSweepByAccount`, and
  `race := firstDebt != 0 && fleetMin <= firstDebt` (witness string
  synthesized from the same numbers). Expected kill:
  `TestNeverSweptFailedStragglerGates` — the stale straggler success at
  block 100 pins the floor below the borrower's arrival at 200, so the
  mutant DISCLOSES the borrower generation 7 (opened ~250, completed ~280,
  both witnessed) provably skipped; the fixed law GATES it. This is the
  Codex F2 false-pass reconstructed end to end through
  `classifySweepTestimony`.
- **m2 — the retro artifact binding dropped (F3).** In
  `parseAcceptR5RetroSubjectsAgainst` (wave_h3_retro_live_test.go), delete
  bar (a1) — the `driftReport` unmarshal, the `comparisonHash` recompute
  and the `recomputed != doc.ComparisonSHA256` refusal — so the parser
  trusts the artifact's self-reported digest (the pre-H2-hardening shape;
  the substitute-document construction Codex round 3 killed on the R4
  parser). Expected kills:
  `TestAcceptR5RetroParserBarsRefuse/a_wrong_digest_FAILS_(m2_kill:_the_copied-digest_substitute)`
  (a synthetic 2-subject document wearing the COPIED accept-r5 digest
  parses under the mutant; the bar must refuse it) and
  `.../a_mutated_row_under_a_STALE_digest_FAILS` (a doctored companion row
  under the sealed digest parses under the mutant).
- **m3 — the S-clock param fold reverted to the collapsed filter (F4).**
  Replace `dmFoldParamsAtS`'s body (dm_gate.go) with the Wave-H3 shape the
  fix deleted from `runDMOwnClockWelds` — filter `t6.DMParams` (the
  COLLAPSED latest-per-asset pin view) by `EffectiveBlock <= s` and fold
  that — keeping only the nil-t6 guard so the mutant fails by verdict, not
  by panic. Expected kill:
  `TestDMFoldParamsAtSRefusesWithoutTheRawLedger` — the collapsed-only
  fixture must REFUSE (the mutant happily folds it) and the raw-ledger
  fixture must fold the S-effective block-100 threshold (the mutant folds
  an empty set). The transition arms in `TestDMParamsAtBlockReconstructsS`
  pin the three collapsed-filter wrongnesses (update: asset vanishes at S;
  removal: vanishes; re-add: resurrected at S) against `dmParamsAtBlock`
  directly.

Each mutant is applied to the FIXED file, the kill suite run, the outcome
recorded verbatim, and the file restored byte-identical (sha256 before ==
after), per the r13/r14/wave-h/wave-h2/wave-h3 discipline.

## Tested tree

- Branch `main`, HEAD `846c241` ("docs(sdd): wave 18 landed..."), PLUS this
  wave's uncommitted Wave-H4a changes (mutants cut against the FIXED code
  after the wave's regressions went green; NOTHING committed by this wave —
  the wave brief forbids committing).
- Fixed-file sha256 (before-hash AND after-restore hash; every restore
  verified byte-identical):
  - `cmd/reconcile/dm_gate.go`
    `168c9fa1e0071ed4e34672bf871bbc27ae6b01697677acacdc3ae17dec9f5a69`
  - `cmd/reconcile/wave_h3_retro_live_test.go`
    `54e734d43b4e1da78d9ed40f6ea714b2666fc190a3a9ddb0a6fb7df88027d6ee`
- Kill suite on the fixed tree BEFORE the loop: `ok` (1.449s).

## Execution — all three KILLED, one mutant at a time, restore between

### m1 — the race guard reverted to fleet-min (dm_gate.go)

Mutated-file sha256:
`38b6970fa5a65cf1732ac31e5230200de3d69c0a172e47960ff868b786b3a639`
(the `dmNeverSweptRace(firstDebt, c.pinOP, cycles)` call replaced with the
Wave-H3 fleet-min computation over `t6.DMSweepByAccount` plus
`race := firstDebt != 0 && fleetMin <= firstDebt`, per the spec).

KILLED by `TestNeverSweptFailedStragglerGates`, exactly the designed message
("m1 kill: generation 7 opened after this borrower arrived, completed below
the pin, and skipped it — a sweeper defect. The fleet-min shape disclosed it
as an honest race (the F2 false-pass)") — under the mutant the straggler's
stale block-100 success pinned the floor and the skipped borrower came back
DISCLOSED instead of gated. `TestNeverSweptReshape` fired too (the
honest-race receipt no longer names the generation evidence — a bonus kill,
not the designed one).

### m2 — the retro artifact binding dropped (wave_h3_retro_live_test.go)

Mutated-file sha256:
`ed45f8f55251fd6d8cb79c7ad77914329df64eda59fd9ea59a14812a3a66904b`
(bar (a1) deleted from `parseAcceptR5RetroSubjectsAgainst`: the driftReport
unmarshal, the `comparisonHash` recompute, and the mismatch refusal — the
parser trusts the self-reported digest).

KILLED by BOTH designed subtests of `TestAcceptR5RetroParserBarsRefuse`:
`a_wrong_digest_FAILS_(m2_kill:_the_copied-digest_substitute)` ("a
substitute wearing the copied accept-r5 digest must refuse") and
`a_mutated_row_under_a_STALE_digest_FAILS` ("a doctored row under a stale
digest must refuse") — under the mutant both documents parsed.

### m3 — the S-clock param fold reverted to the collapsed filter (dm_gate.go)

Mutated-file sha256:
`0e485886d0e753e0dfd6545fbad186ad46f3c7364b0c0759b99571f4bc1ff6b1`
(`dmFoldParamsAtS`'s body replaced with the Wave-H3 shape: filter
`t6.DMParams` by `EffectiveBlock <= s`, fold the filtrate; nil-t6 guard
kept so the kill is by verdict, not panic).

KILLED by `TestDMFoldParamsAtSRefusesWithoutTheRawLedger`
(wave_h4a_fixes_test.go:415): the collapsed-only fixture folded instead of
refusing, and the raw-ledger fixture folded EMPTY instead of carrying the
S-effective block-100 threshold. The three transition arms of
`TestDMParamsAtBlockReconstructsS` pin the same wrongnesses against
`dmParamsAtBlock` on the fixed tree (asset vanishing at S across an update
and a removal; resurrected at S across a removal+re-add).

## Restores

Every restore verified byte-identical to the fixed-file sha256s
(`168c9fa1…f5a69` for dm_gate.go — checked after m1 and after m3;
`54e734d4…d6ee` for wave_h3_retro_live_test.go — checked after m2). Full
gate on the fixed tree after the loop, with .env sourced so the DB fixture
suites ran: `go build ./...` clean, `go vet ./cmd/reconcile/...` clean,
`go test ./cmd/reconcile/... -p 1 -count=1` →
`ok github.com/kaselunt/solvent/cmd/reconcile 5.174s` /
`ok github.com/kaselunt/solvent/cmd/reconcile/snapshotdb 1.010s`.
