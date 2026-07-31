# Mutation transcript — Wave H2 (Codex round-2 proof-surface fix wave)

Durable mutation evidence for the three Codex round-2 remedies (the DM
own-clock weld proves the VECTOR, the balance-census weld selects per
(account, reserve), the refutation test is non-vacuous), following the
in-package convention of wave-h.md / r13.md.

## Mutant specs — WRITTEN BEFORE THE LOOP RAN

Three designed mutants, one per remedy, each named by the Codex finding it
attacks. The kill suite for all three:

```
go test ./cmd/reconcile -count=1 -run 'TestClassifyDMMaxBorrowRequiresTheVector|TestCompareDMCollateralVectorLaw|TestSelectMaskedBalancePairsPerAccountReserve|TestAcceptR4ArtifactBarsRefuseTruncationAndIdentityDrift|TestClassifyDMMaxBorrowThreeStateLaw'
```

- **m1 — the vector proof dropped back to scalar-only.** In
  `classifyDMMaxBorrow` (dm_gate.go), delete BOTH vector arms: the
  vector-mismatch custody arm and the no-vector-no-sample-gap guard, so the
  classifier is exactly the Wave-H scalar-only shape (`ChainMax == OurMax` ⇒
  sample-gap). This is the Codex finding-1 corruption shape: two wrong
  snapshot rows whose price×LT products cancel at S keep the scalar exact,
  classify sample-gap-disclosed, and excuse the real pin-clock mismatch.
  Expected kill: `TestClassifyDMMaxBorrowRequiresTheVector` — the fixture
  PROVES the counterbalance first (two stables, equal price and LT, amounts
  swapped; `risk.ComputeDMHealth` over both vectors returns the same
  MaxBorrowLT), then requires `drift`/`snapshot-custody-drift` on the
  mismatching vector, which the mutant classifies `sample-gap-disclosed`.
- **m2 — per-(account, reserve) selection collapsed back to membership-flip.**
  In `selectMaskedBalancePairs` (hf_gate.go), return the empty selection
  (`maskedPairSelection{Pairs: map[...]}{}` immediately), so the weld set is
  exactly the Wave-H shape again: census-disagreeing + flag-masked
  (membership-flip) accounts + the control, and a wrong derived balance in a
  flag-OFF reserve on a borrower (or on a mixed-reserve zero-debt account) is
  never welded anywhere. Expected kill:
  `TestSelectMaskedBalancePairsPerAccountReserve` (the borrower's flag-OFF
  pair and the mixed zero-debt account's disabled pair must be selected).
- **m3 — the refutation completeness bar removed.** In
  `parseAcceptR4Artifact` (acceptr4_refutation_live_test.go), delete the two
  exact-count checks (`len(out.dm) != acceptR4DMSubjects`,
  `len(out.census) != acceptR4CensusSubjects`), so a truncated artifact
  parses clean — the Codex finding-3 vacuity (the previous test required only
  a NONEMPTY subset). Expected kill:
  `TestAcceptR4ArtifactBarsRefuseTruncationAndIdentityDrift` ("a truncated DM
  row set FAILS" / "a truncated census row set FAILS": dropping one row from
  the synthetic 233/24 artifact must produce a COMPLETENESS error).

Each mutant is applied to the FIXED file, the kill suite run, the outcome
recorded verbatim, and the file restored byte-identical (sha256 before ==
after), per the r13/r14/wave-h discipline.

## Tested tree

- Branch `main`, HEAD `cb1520f27f7dc599aedb6c023e1ed9cdcac84b37`, PLUS this
  wave's uncommitted Wave-H2 changes (mutants cut against the FIXED code
  after the wave's regressions went green; NOTHING committed by this wave).
- Fixed-file sha256 (the before-hash AND the after-restore hash for each
  mutant's file — every restore verified byte-identical):
  - `cmd/reconcile/dm_gate.go`
    `dc47422736edbd8beb376d552452fbf1edc340187de67eb5293d50c1a896f8e6`
  - `cmd/reconcile/hf_gate.go`
    `d2d7bd80429df9b2925f13dc586ff6ad233e5b83868c80768047b390a54c3f1e`
  - `cmd/reconcile/acceptr4_refutation_live_test.go`
    `042b8bdf4357e20157026bc3e16f9df295fd59522a7c9f5b61e65c59e0ec2a6f`
- Kill-suite: the command in the spec above; hermetic (no DB, no RPC — pure
  classifiers, the vector-compare law, the selection law, and synthetic
  artifact documents). Fixed tree before AND after the loop: `ok`.

## Execution — all three KILLED, one mutant at a time, restore between

### m1 — vector proof dropped back to scalar-only (dm_gate.go)

Mutated-file sha256:
`2f0bc6ce500fe9affe3456e6ca43279dd293d423d17da72d8785653ac6172a3d`

Diff (fixed -> m1), inside `classifyDMMaxBorrow` — both vector arms deleted:

```diff
-	// The CUSTODY PROOF outranks everything below: ...
-	if own != nil && own.VectorRead && !own.VectorMatch {
-		return verdictDrift, "snapshot-custody-drift"
-	}
 	if own == nil || own.Err != "" {
 		return verdictWeldUnread, "own-clock-read-unread"
 	}
-	if !own.VectorRead {
-		// No custody proof was produced ...
-		return verdictWeldUnread, "own-clock-read-unread"
-	}
 	if own.ChainMax.Cmp(own.OurMax) != 0 {
```

KILLED by `TestClassifyDMMaxBorrowRequiresTheVector`:
`Expected "drift", Actual "sample-gap-disclosed" — a vector mismatch with a
CANCELING scalar is exactly the corruption the scalar-only weld excused
(Codex round 2, finding 1) — it must gate`. The fixture proves the
counterbalance first (two stables, equal price 1.00 USD-6 and LT 95e18,
amounts 100.00/13.00 swapped: `risk.ComputeDMHealth` returns MaxBorrowLT
107,350,000 over BOTH vectors), so the kill is non-vacuous — the scalar
genuinely cannot see the corruption; only the vector byte-compare can.
Independently killed by `TestClassifyDMMaxBorrowThreeStateLaw` (same
Expected/Actual on its vector-mismatch case).

### m2 — selection collapsed back to membership-flip (hf_gate.go)

Mutated-file sha256:
`61413a5a3f214cc10885012c8e09e5254aae9777ee451149792da0a237cdfbab`

Diff (fixed -> m2), inside `selectMaskedBalancePairs` — return the empty
selection before the pair loop (the Wave-H posture: only flips, census
disagreements and the control reach the weld):

```diff
 	sel := maskedPairSelection{Pairs: map[common.Address][]common.Address{}}
+	return sel
 	for _, a := range candidates {
```

KILLED by `TestSelectMaskedBalancePairsPerAccountReserve`:
`expected: []common.Address{0xC02aaA39…} actual: []common.Address(nil) — a
BORROWER's positive flag-OFF balance must join the weld — membership flips
are not the masking condition (Codex round 2, finding 2)`.

### m3 — refutation completeness bar removed (acceptr4_refutation_live_test.go)

Mutated-file sha256:
`5cb2402ae3ffd5bdff286477b29e1ea2a1fde80e09a74acebd2e6965ea935ffc`

Diff (fixed -> m3), inside `parseAcceptR4Artifact` — both exact-count checks
deleted:

```diff
-	if len(out.dm) != acceptR4DMSubjects {
-		return acceptR4Targets{}, fmt.Errorf("COMPLETENESS failed: %d unique dm_boolean_weld drift subjects, want exactly %d ...", ...)
-	}
-	if len(out.census) != acceptR4CensusSubjects {
-		return acceptR4Targets{}, fmt.Errorf("COMPLETENESS failed: %d unique zero-debt census drift subjects, want exactly %d ...", ...)
-	}
 	return out, nil
```

KILLED by `TestAcceptR4ArtifactBarsRefuseTruncationAndIdentityDrift`, both
truncation subtests: `a_truncated_DM_row_set_FAILS` and
`a_truncated_census_row_set_FAILS` — `An error is expected but got nil. a
truncated artifact must not refute (Codex round 2, finding 3)`.

## Restores

Every restore verified byte-identical to the fixed-file sha256 recorded
above (`dc474227…` / `d2d7bd80…` / `042b8bdf…`). Kill suite on the fixed
tree after the loop: `ok github.com/kaselunt/solvent/cmd/reconcile 1.211s`.

## m4 (round 3) — the recompute bar deleted

Spec: disable `if recomputed != doc.ComparisonSHA256` (the a1 bar) so the
identity check falls back to trusting the self-reported string — the exact
round-3 finding. Expected kills: "a mutated scoped row with a STALE digest
FAILS" and "the round-2 substitute construction FAILS".

Execution: mutant applied via sed (guard short-circuited with `false &&`);
`go test -run TestAcceptR4ArtifactBars` → FAIL (both kill subtests fired,
naming the recomputed-hash bar). Restore applied and verified by CONTENT
(zero mutant remnants by grep; git diff vs HEAD shows exactly the intended
round-3 insertion; full suite green) — byte-level sha differed pre/post
because sed normalized line endings on rewrite; git autocrlf renormalizes
at commit. KILLED.
