# Mutation transcript — Wave H5b (the observatory sweep stamp, migration 00018)

Durable mutation evidence for wave H5b's store additions: migration
00018 (observatory_points gains the per-engine SWEEP STAMP, with a
backfill from still-retained batches), the rollup writer's sweep copy
(`internal/store/p5_observatory.go`) and the series reader's three-state
sweep surfacing (`internal/store/p5_observatory_series.go`).

The two mutant SPECS were written into the test-file headers BEFORE the
corresponding kill assertions ran (`p5_observatory_test.go` m5,
`migrate_upgrade_observatory_sweep_test.go` m6). This wave's rules forbid
committing, so "committed before the loop" is satisfied at file level, not
commit level — the integrator lands the whole tree (the same posture the
p5-b2 transcript records).

## Tested tree

- Branch `main`, HEAD `a1a7e5048ad6dba580d3841898c5aa627b79eefb`, PLUS this
  wave's uncommitted H5b changes (and the sibling H5a wave's concurrent
  uncommitted `cmd/reconcile` files, which share the working tree; the
  schema-version welds read 18 during these runs).
- Fixed-file sha256 (the before-hash for each mutant of that file, and the
  after-restore hash — every restore verified byte-identical):
  - `internal/store/p5_observatory.go`
    `3b9104428ccf53025ee2ebcc0f60606e89f1bb5f91a79aaa8bbd7854749bd518`
  - `internal/store/migrations/00018_observatory_sweep.sql`
    `98f8a4e62895fcd23f698362e45d69d9d0bba8f4c801008232a10ebd2ae20373`
- Kill-suite commands (scoped; scratch DB via `TEST_DATABASE_URL` from
  `.env`, never the live database):
  - writer/reader:
    `go test ./internal/store/ -p 1 -count=1 -run 'TestWriteObservatoryPoints|TestObservatoryPointsObserveTheBatchNotDerivedState|TestObservatorySeries'`
  - migration backfill:
    `go test ./internal/store/ -p 1 -count=1 -run 'TestMigrateBackfillsObservatorySweepFromRetainedBatches'`

## m5 — the rollup's sweep-copy dropped

Spec (test-file header, before the kill ran): the writer stops copying the
00018 sweep stamp columns from `risk_batch_watermarks`, so every NEW point
lands in the UNRECORDED state (`sweep_applicable` NULL) even though the
batch's stamp exists. The 00018 CHECK constraint CANNOT catch this — NULL
is the legal pre-00018 state — which is exactly why the designed killer
exists: a series whose liquidatable counts silently lose their sweep clock
is the original Codex round-4 finding, reintroduced by one dropped SELECT
list.

Cut: in `p5_observatory.go`'s INSERT…SELECT, the copied columns
`w.sweep_applicable, w.sweep_rows, w.sweep_failed, w.sweep_success_sum,
w.sweep_max_updated_at, w.sweep_generation, w.sweep_generation_open`
become `NULL, NULL, NULL, NULL, NULL, NULL, NULL` (the conflict arm still
propagates EXCLUDED — of the NULLs).

Mutated-file sha256:
`4e643d2f84d8b03adc22ab7935da16e3cf75d752cfba13f4c0eccd3b40f4f2eb`

### Kill (writer/reader suite, exit 1)

KILLED by the designed killer `TestWriteObservatoryPointsCopySweepStampVerbatim`
— the DM point's `sweep_applicable` reads NULL where the law requires the
batch's stamp verbatim. One collateral kill
(`TestObservatorySeriesReadsEngineSeriesAscending`: the reader's
`SweepRecorded` goes false on a point written under 00018). Every other
rollup/series test stayed GREEN.

```
--- FAIL: TestObservatorySeriesReadsEngineSeriesAscending (1.31s)
        Error:       Should be true
--- FAIL: TestWriteObservatoryPointsCopySweepStampVerbatim (0.81s)
        Error:       Expected value not to be nil.
        Messages:    a point written under 00018 is NEVER in the unrecorded state —
                     that state is reserved for pre-00018 history (m5)
FAIL    github.com/kaselunt/solvent/internal/store      8.963s
```

Restore verified: `p5_observatory.go` sha256 back to
`3b910442…749bd518`.

## m6 — the backfill fabricates instead of NULLing

Spec (test-file header, before the kill ran): the 00018 backfill turns "the
store cannot know" into the CLAIM "this engine has no sweeper" by setting
`sweep_applicable = false` on points whose observed batch retention has
pruned. For the Debt Manager — whose liquidatable counts are the very
numbers the stamp exists to clock — that claim is false, and the 00018
CHECK cannot catch it (false-with-all-NULL is the legal no-sweeper state).

Cut: in `00018_observatory_sweep.sql`, one statement appended after the
join backfill:
`UPDATE observatory_points SET sweep_applicable = false WHERE sweep_applicable IS NULL;`

Mutated-file sha256:
`a3566c1e3032b2729b23fb19d1d3cce8a04852145ebfdda59a557c6d101812ab`

### Kill (migration backfill suite, exit 1)

KILLED by the designed killer
`TestMigrateBackfillsObservatorySweepFromRetainedBatches`, whose fixture
seeds a v17 baseline holding one point whose batch is retained (stamp
recoverable) and one whose batch is pruned (stamp gone), and requires the
pruned point's `sweep_applicable` to be NULL after `Migrate` — the honest
unrecorded state. Under the mutant it reads `false`, the fabricated
no-sweeper claim. And by NOTHING else: the retained points backfill
identically under both, so only the absence-honesty assertion
discriminates — which is the point.

```
--- FAIL: TestMigrateBackfillsObservatorySweepFromRetainedBatches (1.06s)
        Error:       Expected nil, but got: (*bool)(0x3e508060d258)
        Messages:    a pre-00018 point whose batch was pruned has NO sweep record:
                     sweep_applicable must stay NULL (unrecorded), never be backfilled
                     to false (m6 — fabricating a no-sweeper claim)
FAIL    github.com/kaselunt/solvent/internal/store      2.123s
```

Restore verified: `00018_observatory_sweep.sql` sha256 back to
`98f8a4e6…2ae20373`.

## Post-restore green

After both restores, the scoped kill suites ran green
(`ok github.com/kaselunt/solvent/internal/store 8.569s`), and the FULL
`./internal/store/...` suite (`-p 1 -count=1`, the migration ladder
included) ran green earlier on the identical pristine bytes
(`ok github.com/kaselunt/solvent/internal/store 280.533s`); the fixed-file
hashes above prove the bytes are the same.
