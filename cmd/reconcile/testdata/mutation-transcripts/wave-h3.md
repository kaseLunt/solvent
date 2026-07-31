# Mutation transcript — Wave H3 (the boolean-leg three-state law)

Durable mutation evidence for the adjudicated liquidatable(strict >)
three-state law (the UNION of the chain-truth and risk-quant boolean-leg
rulings, 2026-07-31) and the never-swept reshape, following the in-package
convention of wave-h.md / wave-h2.md / r13.md.

## Mutant specs — WRITTEN BEFORE THE LOOP RAN

Five designed mutants, one per adjudicated obligation. The kill suite for all
five (hermetic — pure classifiers, no DB, no RPC):

```
go test ./cmd/reconcile -count=1 -run 'TestClassifyDMBooleanThreeStateLaw|TestClassifyDMBooleanHasNoMarginPredicate|TestDMMotionPopulationGate|TestNeverSweptReshape'
```

- **m1 — MOTION reachable without conjunct (iii).** In `classifyDMBoolean`
  (dm_gate.go), delete BOTH conjunct-(iii) blocks: the
  `fx.Own == nil || !fx.Own.BoolRead || !fx.Own.OursLiqComputed` weld-unread
  guard AND the `fx.Own.OursLiqS != fx.Own.ChainLiqS` escalation arm — the
  S-clock boolean custody weld stops being consulted, so a flip whose
  composition-law recompute at S was never produced (or DIVERGES from
  liquidatable@blockHash(S)) classifies MOTION. Expected kills:
  `TestClassifyDMBooleanThreeStateLaw/conjunct_(iii)_unread...` (weld-unread
  demanded, mutant discloses) and
  `.../conjunct_(iii)_weld_failure_over_a_PASSING_certificate_ESCALATES...`
  (the named escalation class demanded, mutant discloses).
- **m2 — MOTION reachable without conjunct (iv).** In `classifyDMBoolean`,
  delete ALL conjunct-(iv) blocks: the `fx.PinVec == nil || !fx.PinVec.Read`
  and `fx.PinVec.Err != ""` unread guards, the
  `!fx.PinVec.ScalarWeld || !fx.PinVec.BoolWeld` law-divergence arm, and the
  `!fx.PinVec.Reconciles` arm — the Law@P pin-vector substitution stops being
  consulted. Expected kill:
  `TestClassifyDMBooleanThreeStateLaw/conjunct_(iv)...` (all four sub-arms:
  nil PinVec, scalar weld failure, boolean weld failure, reconciliation
  failure must each gate; the mutant discloses them all).
- **m3 — a margin cutoff introduced into the predicate.** In
  `classifyDMBoolean`, insert immediately after `direction` is computed
  (before conjunct (i)):

  ```go
  if fx.Own != nil && fx.Own.DebtUSDAtS != nil && fx.Own.OurMax != nil {
      m := new(big.Int).Sub(fx.Own.DebtUSDAtS, fx.Own.OurMax)
      if m.CmpAbs(big.NewInt(100000000)) < 0 { // "< $100 is just motion"
          return verdictBoundaryMotion, "boolean-boundary-crossing(motion-proven, " + direction + ")", false, nil
      }
  }
  ```

  — the exact epsilon-as-carpet shape both rulings refuse (a small margin
  waved through without the constructive proof). Expected kill:
  `TestClassifyDMBooleanHasNoMarginPredicate` — the tiny-margin case (implied
  S margin = 1 USD-6 unit) with conjunct (i) BROKEN must classify drift; the
  mutant discloses it. The conjunct subtests of
  `TestClassifyDMBooleanThreeStateLaw` also fire (fullMotionFacts' implied
  margin 15075555 < 1e8, so every broken-conjunct case short-circuits to
  MOTION under the mutant).
- **m4 — the population sweeper-health gate removed.** Replace
  `dmMotionPopulationGate`'s body with `return false`. Expected kill:
  `TestDMMotionPopulationGate` (96/9500 must gate; the census row must carry
  verdict drift / class sweeper-health; the mutant leaves both exact). The
  never-swept census reuses the same predicate, so
  `TestNeverSweptReshape/the_census_denominator_row...` fires too.
- **m5 — the never-swept age guard widened to always-disclose.** Replace
  `dmNeverSweptRace`'s body with `return true` (every never-swept borrower
  becomes an "honest race" — including one a COMPLETED cycle provably
  skipped, and one whose arrival edge custody cannot state). Expected kills:
  `TestNeverSweptReshape/the_race_arithmetic` (`dmNeverSweptRace(0,100)` must
  be false — fail closed; `dmNeverSweptRace(200,300)` must be false — a
  completed cycle that skipped the account is a sweeper defect) and
  `TestNeverSweptReshape/completed_cycle_since_arrival:_GATED...` +
  `.../unknown_arrival_fails_closed` end-to-end.

Each mutant is applied to the FIXED file, the kill suite run, the outcome
recorded verbatim, and the file restored byte-identical (sha256 before ==
after), per the r13/r14/wave-h/wave-h2 discipline.

## Tested tree

- Branch `main`, HEAD `6a869bcf925bb41f3d0082d7f855caa0ac028766`, PLUS this
  wave's uncommitted Wave-H3 changes (mutants cut against the FIXED code
  after the wave's regressions went green; NOTHING committed by this wave).
- Fixed-file sha256 (before-hash AND after-restore hash; every restore
  verified byte-identical):
  - `cmd/reconcile/dm_gate.go`
    `ec81c02b6c1c96b070c67cf6aaffd0cf02c9a30c11e2a7654d0a7b6584864e8b`
- Kill suite on the fixed tree BEFORE the loop: `ok` (1.159s).

## Execution — all five KILLED, one mutant at a time, restore between

### m1 — conjunct (iii) deleted (dm_gate.go)

Mutated-file sha256:
`81322db29f039f0316398f8fe41140a6fdcf683d7ad726f1b41883c4ab8bf25d`
(996 bytes removed: both conjunct-(iii) blocks inside `classifyDMBoolean`).

KILLED, exactly the designed subtests:
`TestClassifyDMBooleanThreeStateLaw/conjunct_(iii)_unread:_MOTION_is_unreachable_without_the_S-clock_boolean_weld`
("a flip whose S-clock boolean weld did not answer is CANNOT-VERIFY, never
motion (m1 kill)") and
`.../conjunct_(iii)_weld_failure_over_a_PASSING_certificate_ESCALATES_as_custody_drift`
("m1 kill: the composition law diverging from chain must GATE, never
disclose").

Note (disclosed): the FIRST application attempt used an end-marker string
that also matches the `dmBooleanFacts` STRUCT field comment earlier in the
file, producing a syntactically broken duplicate-splice (build failed —
which is not a kill). Restored to the fixed hash and re-applied with the
search anchored inside `func classifyDMBoolean` before running the suite;
the kill recorded above is from the correct mutant.

### m2 — conjunct (iv) deleted (dm_gate.go)

Mutated-file sha256:
`aeff64a0e2d15dd1d41b701ab9f2d49cce4cdcb436a94a0c90ad4b711739bb5b`
(1166 bytes removed: all conjunct-(iv) blocks inside `classifyDMBoolean`).

KILLED by
`TestClassifyDMBooleanThreeStateLaw/conjunct_(iv):_the_pin-vector_substitution_is_load-bearing`
("m2 kill: no substitution read = cannot verify" — the first of the four
sub-arms fails; the remaining arms are unreachable once the first assertion
fires).

### m3 — margin cutoff introduced into the predicate (dm_gate.go)

Mutated-file sha256:
`64e0e310ddd981dd629373c9add643f1efaced0c86bf2f9c0ee0fabc4430f9d9`
(the spec's cutoff block inserted verbatim after `direction`).

KILLED by `TestClassifyDMBooleanHasNoMarginPredicate` ("m3 kill: a one-unit
margin cannot excuse a failed conjunct") AND — as predicted in the spec —
by EVERY broken-conjunct subtest of `TestClassifyDMBooleanThreeStateLaw`
(conjuncts i, ii, iii-unread, iii-escalation, iv, v all short-circuited to
MOTION under the $100 cutoff, because fullMotionFacts' implied S margin
15075555 < 1e8). The epsilon devours the whole conjunct law, which is
exactly why no margin may appear in any predicate.

### m4 — the population sweeper-health gate removed (dm_gate.go)

Mutated-file sha256:
`a4c64e2f0cd4a57d7987b0f2ebf7e9c9bfde890f4021a8453bf7339c131e9869`
(`dmMotionPopulationGate` body replaced with `return false`).

KILLED by `TestDMMotionPopulationGate` ("m4 kill: exceeding ~1% gates") and
by `TestNeverSweptReshape/the_census_denominator_row_exists_every_run_and_gates_en_masse`
(the never-swept census shares the predicate, so the stopped-sweeper
vacuous-pass guard died with it — both fired).

### m5 — the never-swept age guard widened to always-disclose (dm_gate.go)

Mutated-file sha256:
`31776ab5d30e14608815a667d5193c0510fbb75ea18392763ca70063c0b3e533`
(`dmNeverSweptRace` body replaced with `return true`).

KILLED by `TestNeverSweptReshape/the_race_arithmetic` ("unknown arrival
fails CLOSED"), `.../completed_cycle_since_arrival:_GATED_sweeper_defect_(m5_kill)`
("older than one completed cycle is a sweeper defect — widening the guard
to always-disclose is the vacuous-pass shape"), and
`.../unknown_arrival_fails_closed`.

## Restores

Every restore verified byte-identical to the fixed-file sha256
`ec81c02b6c1c96b070c67cf6aaffd0cf02c9a30c11e2a7654d0a7b6584864e8b`
(checked after each of the five restores and after the final one). Full
gate on the fixed tree after the loop:
`go build ./...` clean, `go vet ./cmd/reconcile/...` clean,
`go test ./cmd/reconcile/... -p 1 -count=1` →
`ok github.com/kaselunt/solvent/cmd/reconcile 1.727s` /
`ok github.com/kaselunt/solvent/cmd/reconcile/snapshotdb 0.921s`.

## Postscript — one DOC-ONLY edit after the loop, disclosed

After the loop closed, dm_gate.go's package header still carried the
now-false sentence "The BOOLEAN leg (liquidatable, strict >) stays gated at
the pin" — a stale statement of the very law this wave replaced (its own
D-013 shape). A COMMENT-ONLY correction was applied (the THIRD CLOCK
CORRECTION paragraph; zero code bytes changed), moving the file's sha256 to
`5eb480bf5738fb753cc382b99719afe1c8fd8b3fcae9630a348e9369235d7a31`. The
kill suite and the full gate were re-run on the final tree: kill suite
`ok 1.224s`; build/vet clean; full suite
`ok cmd/reconcile 4.011s` / `ok snapshotdb 0.819s`. A `git diff` between
the loop-time and final file shows only the header comment insertion.
