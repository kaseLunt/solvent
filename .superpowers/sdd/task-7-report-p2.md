# Task 7 report (Phase 2): Runner + snapshotter + daemon integration

**Status:** COMPLETE. Four pathspec commits, all quality gates green, pristine tree.

| Commit | Subject | Files |
|---|---|---|
| `44f2765` | feat: additive store reads for runner and snapshotter — windowed raw-log reads, reorg-ack checks, snapshot registry, writer-lock liveness | `internal/store/derive.go`, `internal/store/store.go`, `internal/store/derive_support_test.go` |
| `5add4c2` | feat: derivation runner — serial windowed derive loop with reorg coordination and commit-indeterminacy handling | `internal/derive/runner.go`, `internal/derive/runner_test.go` |
| `1703b9d` | feat: OP collateral snapshotter — rotating multicall3 collateralOf sweeps with post-rewind re-sweep | `internal/snapshot/snapshot.go`, `internal/snapshot/snapshot_test.go`, `internal/chain/chain.go`, `internal/chain/chain_test.go` |
| `f481ca2` | feat: wire derivation runners and snapshotter into the daemon loop with lock liveness, walker backoff, and epoch pruning | `cmd/indexer/main.go`, `internal/config/config.go`, `internal/config/config_test.go` |

**Gates:** `gofmt -l .` empty; `go vet ./...` clean; `go test ./... -count=1`
live-db → **224 PASS / 0 FAIL** across all seven packages (35 new tests:
7 store live-db, 15 runner fakes, 11 snapshotter fakes, 1 chain, 1 config).

---

## 1. Runner (`internal/derive/runner.go`)

One `Runner` per engine; `RunnerSpec` bindings come from
`BuildRunnerSpecs(cfg)` — config's streams define the address→engine mapping
(aave = Pool + 4 aTokens merged into ONE per-chain `(block_number,
log_index)`-ordered feed via `store.RawLogsInRange`; engine strings were
validated against `config.KnownEngines` at load, closing the deferred
"Engine field validation at first consumption"). A one-engine-two-chains
config is refused (no cross-chain total order).

`Step` = unacked-reorg check → ingest frontier (MIN over the engine's
stream cursors; a never-ingested stream blocks derivation entirely) → fresh
`DeriveCursor` read → one bounded window → Decode → serial `Process` →
rate-index persist → `ApplyDerived` → `CommitBatch` → per-touched-account
snapshots (`BalancesFor` → `SaveSnapshot` at the through-block; record-only
events excluded). Windows are block-aligned, so tx log runs never split.

**Binding rules, all pinned by exact call-sequence tests (shared call log
across fake store + fake engine):**

- **ANY ApplyDerived error → `Engine.Reset()`, never DiscardBatch**; next
  Step resumes from the cursor READ BACK (test simulates the
  commit-landed-with-lost-ack world: cursor advanced despite the error, and
  the runner derives from the advanced cursor). Decode/Process errors →
  DiscardBatch, no ApplyDerived, no Reset.
- **Reorg coordination:** proactive `HasUnackedReorg` check per Step answers
  a walker rewind with `RewindDerived(cursor)` → Reset → cursor re-read →
  `DeleteRateIndexesAbove(read-back cursor)` → onRewind (snapshot re-sweep)
  BEFORE any window read; `ErrUnackedReorgEpoch` from ApplyDerived is the
  reactive backstop (Reset first, then the identical rewind path). Deeper-
  than-requested rewinds pinned: hygiene and resume both key off the
  read-back cursor. Bootstrap (no cursor + epochs) rewinds to StartBlock-1.
- **`ErrUnsupportedBorrowToken` → engine UNHEALTHY**, one Error log, every
  subsequent Step a complete no-op (zero store calls, pinned).
- **Rate observations** persisted BEFORE ApplyDerived (idempotent replays;
  after-commit saving could lose them forever), last-wins deduped per
  (asset, block, kind): DM `InterestIndexUpdated` → `borrow_index`; Aave
  `ReserveDataUpdated` → `variable_borrow_index` + `liquidity_index`.
  Collected from the DECODED events after Process accepts the log — same
  values the aave engine copies into its payload, without string re-parsing.
  DM `BorrowApySet` is deliberately NOT persisted (not a documented runner
  obligation; a same-block double-set would poison the divergence refusal).

## 2. Store additions (additive only, live-db tested)

`RawLogsInRange` (chain+addresses windowed read, `(block_number, log_index)`
order), `HasUnackedReorg` (mirrors ApplyDerived's gate incl. no-cursor
bootstrap), `SnapshotAccounts` (distinct debt-side accounts, nonzero-debt
first), `SaveSnapshot` (snapshots-table JSONB decimal-string doc, upsert-
replace, uint256-max round-trip pinned), `PruneAckedReorgEpochs` (delete
epochs ≤ MIN(acked) per chain; cursor-less chains retained; documented why
pruning doesn't reopen the bootstrap hole), `DeleteRateIndexesAbove`, and
`CheckWriterLock` (pg_locks query ON the pinned lock connection; loss
simulated by same-session `pg_advisory_unlock` in the test). Two writes
beyond "reads" were necessary and are flagged: `SaveSnapshot` (the plan's
snapshots-table rows have no other writer) and `DeleteRateIndexesAbove`
(without it a post-reorg re-derivation observing a different index value at
the same key would wedge derivation forever on SaveRateIndex's divergence
refusal). `CheckWriterLock` lives in `store.go` next to AcquireWriterLock
(needs the unexported `writerConn`).

## 3. Snapshotter (`internal/snapshot`)

Safe registry = `SnapshotAccounts` (re-read fresh per sweep, nonzero-debt
Safes first). Rotating batches: each `Step` issues at most ONE multicall3
`tryBlockAndAggregate` (canonical `0xcA11bde0…76CA11`; selector `0x399542e9`
pinned against `cast sig`) of `collateralOf(safe)` reads (selector
`0x1aefb107`) against the Debt Manager proxy, `requireSuccess=false`.
`tryBlockAndAggregate` chosen over `aggregate3` so snapshot rows are stamped
with the atomic EXECUTION block, not a separately-fetched head. Per Safe:
`UpsertSnapshotBalances` with `{token-hex: {collateral: amount}}`; zero
amounts omitted, and an all-zero Safe still upserts an EMPTY map — wholesale
replacement clears stale rows (pinned). Cadence `SOLVENT_SNAPSHOT_INTERVAL`
(default 1h, positive-validated in config); `TriggerResweep` (wired to the
DM runner's onRewind) drops the in-flight queue and re-reads the registry.
Failure posture: transport/malformed-response errors leave the queue for
retry; one reverted Safe is skipped until the next sweep; an ALL-reverted
batch is an error. `chain.Failover` gained the additive `Call` (eth_call
latest, failover-rotated; `rpcClient` + test fake extended) — precedent:
Task 5's `TxCalldata`.

## 4. Daemon (`cmd/indexer/main.go`)

Round = walker pass (backoff-wrapped) → runner pass (stepsPerRound-bounded)
→ one snapshotter batch → advisory-lock liveness re-check (lost → fatal
exit). Phase 1 deferrals landed: `CheckWriterLock` per round; per-walker
backoff (3 consecutive erroring rounds → skip 5 rounds; context.Canceled
never counts); log wording now "will retry next round".
`PruneAckedReorgEpochs` runs once per tick. `chainlink_feed` specs are
deliberately skipped (Task 8's price poller, not a derive.Engine); any other
unwired engine is a startup error. DM engine gets its chain's Failover for
migration-calldata reads.

## 5. Notes / concerns for downstream tasks

1. **Live smoke deferred to Task 9** per brief — the daemon was never run
   against mainnet here; wiring is compile- and unit-verified only.
2. **Snapshot rows after a committed batch are best-effort:** a
   SaveSnapshot failure after ApplyDerived surfaces an error but the cursor
   has advanced (that window is never re-derived). Authoritative balances
   live in position_balances; the snapshots table is a history convenience.
3. **DM backfill's migration window** (7,337 seeds in ~80 txs) will emit
   ~7.3k per-account BalancesFor+SaveSnapshot pairs in its windows — local
   db, one-time; acceptable but visible in backfill timing.
4. The snapshotter runs inline in the daemon loop (single-writer contract:
   in-process goroutine writes would race the store's gate reads); a slow
   RPC bounds one round by the failover's 30s per-endpoint attempt cap.
5. `indexer.exe` in the repo root is a stale prior build artifact
   (gitignored, untracked) — rebuild before Task 9's live run.

---

## Fix wave

**Status:** COMPLETE. Consolidated fixes from the standard review + Codex
session `019f8eb4-ee2e-7622-8c7f-d81526338e65`, four pathspec commits, all
gates green (`gofmt -l .` empty; `go vet ./...` clean; `go test ./...
-count=1` live-db → **241 PASS / 0 FAIL / 0 SKIP**; goldens untouched;
pristine tree).

| Commit | Subject | Files |
|---|---|---|
| `8996975` | fix: transactional rewind hygiene and windowed rate persistence | `internal/store/derive.go`, `internal/store/derive_support_test.go`, `internal/store/derive_test.go`, `internal/store/migrations/00003_snapshot_sweeps.sql` |
| `7a2cbc3` | fix: side-scoped bulk snapshots, mandatory reorg repair for unhealthy engines, health surface | `internal/derive/{runner,runner_test,runner_live_test,aave,debtmanager}.go`, `internal/store/{derive,derive_support_test}.go` (method retirement rides the cutover for per-commit compilability) |
| `619f6ed` | feat: sweep status tracking with zero-vs-failed disambiguation | `internal/snapshot/{snapshot,snapshot_test}.go` |
| `52d50ab` | fix: time-based walker backoff; snapshot-progress advance handling | `cmd/indexer/{main,main_test}.go` |

### Fix 1 [critical] — Transactional rewind hygiene

`RewindDerived` now deletes the engine's `rate_indexes` rows above the
EFFECTIVE target inside its own transaction, atomic with the event deletion
and the epoch ack. The runner's separate `DeleteRateIndexesAbove` call is
gone and the store method is retired (no remaining callers; its test was
folded into `TestRewindDerivedDeletesRateIndexesTransactionally`, which also
pins deepest-unacked-epoch lowering of the deletion bound). **Crash-safe
re-sweep mechanism (documented in runner.go, snapshot.go and RewindDerived):
the onRewind hook covers the live process; the DURABLE leg is the
snapshotter's unconditional STARTUP sweep** (a fresh process has
`lastSweep == 0`, so its first Step sweeps the full registry — no durable
marker needed). Pinned by `TestStartupSweepCoversRewindCrash`. The named
rewind-crash injection `TestRunnerRewindCrashRestartRederivesRatesEndToEnd`
(live store, real Runner + fake engine/decoder) kills the process between
`RewindDerived` and every post-rewind step, re-ingests a REPLACED block
whose canonical log carries a DIFFERENT index value at the same
(asset, block, kind) key, and proves a fresh runner re-derives end-to-end —
rate 222 lands where 111 stood, cursor/balances/history correct, no
divergence wedge.

### Fix 2 [medium] — Rates transactional with the window

Additive `ApplyDerivedWithRates(ctx, engine, chainID, events, rates,
throughBlock)` + `type RateObservation{Asset, Block, Kind, Value}`: ONE tx =
everything ApplyDerived does + the rate upserts with SaveRateIndex's exact
idempotence/divergence semantics (divergence aborts the WHOLE window).
`ApplyDerived` stays and delegates with nil rates (all 30+ existing
call sites/tests unchanged). Runner switched; the standalone `rates.persist`
pre-pass is gone (`rateSet.observations()` feeds the apply). Live tests:
commit atomicity + identical-replay no-op; the named
apply-rollback-with-real-state injection (divergent event replay detected
AFTER rates were written in-tx → zero rate rows survive); divergent rate
aborts events+cursor while the original observation survives.

### Fix 3 [high] — Honest snapshot as-of semantics

`snapshotTouched` → debt-side-only: the runner queues only DEBT-side-touched
accounts and writes side-scoped documents `{"side":"debt","balances":{...}}`
— the event-derived side truly as-of the through-block. Collateral is never
mixed in (the snapshotter's multicall reads live at their OWN execution
block in position_balances; it writes no snapshots rows). NO row combines
sides observed at different blocks; cross-side composition documented as a
READ-TIME concern (P3) in `SaveSnapshot`/`SaveSnapshots` docs. Aave's
event-derived collateral consequently has no history rows either (uniform
side rule, adjudicated). `SaveSnapshot` retained (legacy shape, docs
updated); `TestRunnerSnapshotsDebtSideTouchedOnly` pins side scoping against
an account holding both sides.

### Fix 4 [high] — Bounded bulk snapshotTouched

Additive `SaveSnapshots(ctx, engine, block, docs map[accountHex]SnapshotDoc)`:
one tx, one pgx.Batch, all-or-nothing (named partial-snapshot-cancel
injection: canceled ctx → zero rows). Runner keeps an in-memory pending set;
each Step flushes ≤ 2000 accounts (`snapshotBatchCap`, test-overridable) as
ONE bulk write, bytewise-deterministic order; the remainder carries over —
including to CAUGHT-UP Steps, which flush at the cursor block and report
advanced=true so the loop drains the backlog (the 7.3k migration window ≈ 4
bounded rounds). Best-effort semantics documented at the contract level:
history rows never affect position_balances truth; a failed flush KEEPS
accounts pending and retries (`TestRunnerSnapshotFailureAdvancesAndRetains`);
a crash drops only unwritten pending rows. Named fan-out carry-over
injection: `TestRunnerSnapshotFanOutCarryOver`.

### Fix 5 [high] — Sweep status + zero-vs-failed disambiguation

Migration `00003_snapshot_sweeps.sql`: `snapshot_sweeps (engine, account,
last_attempt_block, last_success_block, status, updated_at, PK(engine,
account))` + additive bulk `RecordSnapshotSweep` (success stamps both
blocks; failure stamps attempt only, retaining the last success for
staleness measurement; status = LAST attempt's outcome). Snapshotter records
every batch; individually-reverting Safes join an immediate-retry queue
(bounded: 3 retries/sweep, then failed-until-next-sweep) drained after the
fresh queue; an all-reverted RETRY batch is per-account failure (a
known-bad Safe can no longer wedge the sweep tail), while a fresh
all-reverted batch keeps the target-broken error posture and records
nothing; a sweep ending with exhausted Safes logs **DEGRADED**. States
pinned: zero-collateral success (success row + empty upsert) vs never-swept
(no row) vs failed, retry-recovery flip, bounded-degradation lifecycle, and
the store-level upsert transitions (`TestRecordSnapshotSweepStates`).

### Fix 6 [high] — Mandatory reorg repair + health surface

`Step` reordered: `HasUnackedReorg` + rewind now run BEFORE the unhealthy
gate — an unhealthy engine still acks/rewinds (repair mandatory; only
DERIVATION gated). `(*Runner).Health() (healthy, reason)` added; main.go
logs the unhealthy transition once at Error, keeps a package-level
`engineHealth` map, and logs a DEGRADED summary once per tick round while
degraded. Recovery documented as restart-after-capability-upgrade (state
durable; no in-process transition — deliberate). Named injection
`TestRunnerUnhealthyEngineStillRepairsReorgSiblingUnaffected`: unhealthy +
epoch → rewind happens (advanced=true, re-sweep fires), derivation stays
gated after, healthy sibling derives normally.

### Fix 7 [medium] — Time-based walker backoff

Round counting replaced with next-attempt timestamps: exponential (base
30s, doubling, cap 10m, jitter ±20%, injectable clock/rand); `ready()` is
state-free so hot rounds burn nothing. Backoff engages from the FIRST
erroring round (the old 3-round threshold was itself hot-loop currency —
documented). Named hot-loop injection `TestWalkerBackoffHotLoopDoesNotBurn`
(10k sibling-driven polls under a fake clock burn zero delay) + exponential/
cap/jitter-bounds/reset tests in the new `cmd/indexer/main_test.go`.

### Fix 8 — Review minors

M1: runner loop counts `anyAdvanced` BEFORE the error branch (a committed
window with a failed best-effort flush is progress). M2: prune failure log
says "next tick". M3: BorrowApySet non-collection rationale rewritten
scope-based in `rateSet.collect` docs (borrow_apy belongs to later
rate-derivation scope; last-wins dedupe already defuses same-block re-sets —
the old poisoning rationale was wrong). All six named Codex test-gap
injections landed (rewind-crash, apply-rollback-with-real-state,
partial-snapshot cancel, fan-out carry-over, unhealthy+reorg+sibling,
hot-loop backoff).

### Notes / concerns

1. **Rate-divergence now takes the Reset path** (it is an
   ApplyDerivedWithRates error), where the old pre-pass took DiscardBatch.
   Strictly more conservative under commit indeterminacy; sequences
   re-pinned.
2. **Unhealthy engines now issue one `HasUnackedReorg` read per Step**
   (previously a complete no-op). Deliberate: repair is mandatory; cost is
   one indexed read per round.
3. **Commit `7a2cbc3` carries the store-method retirement** (interface
   conformance + retirement must move together for every commit in the
   series to compile standalone); noted in its body.
4. Aave debt history rows exist but aave collateral history does not
   (uniform debt-side rule) — if P3's read-time composition wants aave
   aToken history, extend the side rule per-engine then.
5. The DEGRADED health summary logs once per TICK round (not per inner hot
   round) — the inner loop can spin thousands of times during backfill;
   transition itself is logged immediately at Error. Documented in main.go.

---

## Fix wave 2 (sweep durability)

**Status:** COMPLETE. Snapshotter-durability redesign answering Codex session
`019f8eef-1bd0-7da0-9964-161df69b2c74`'s NOT-APPROVED verdict. Three pathspec
commits, all gates green (`gofmt -l .` empty; `go vet ./...` clean;
`go test ./... -count=1` live-db → **248 PASS / 0 FAIL / 0 SKIP**; goldens
untouched; pristine tree).

| Commit | Subject | Files |
|---|---|---|
| `e2f885a` | feat: durable sweep generations with atomic sweep batches and reorg snapshot invalidation | `internal/store/{derive,derive_test,derive_support_test}.go`, `internal/store/migrations/00003_snapshot_sweeps.sql` |
| `1dd8267` | fix: generation-driven convergent sweeps with per-account failure classification | `internal/snapshot/{snapshot,snapshot_test}.go`, `internal/store/{derive,derive_support_test}.go` (RecordSnapshotSweep retirement rides the cutover) |
| `d17099a` | fix: bounded FIFO snapshot carry-over; wire generation sweeps | `internal/derive/{runner,runner_test,runner_live_test}.go`, `cmd/indexer/main.go` |

### The unifying design: durable sweep generations

Migration 00003 edited IN PLACE (local-only; dev goose-cycle procedure —
drop both tables + delete goose version row 3 — documented in its header and
executed on the local db): `snapshot_sweeps` gains `generation` + `attempts`;
new table `sweep_generations (engine PK, current_generation, opened_at,
completed_at)`. Opening a sweep = ONE durable increment
(`OpenSweepGeneration`, and — post-rewind — the identical bump INSIDE
`RewindDerived`'s transaction). Per-account progress = the generation stamp
on the account's `snapshot_sweeps` row, written atomically with its balances.
Remaining work = registry accounts whose row lags the current generation
(`SweepWorkBatch`: registry LEFT JOIN sweeps, `generation < current` OR no
row, then current-generation failures inside the attempts budget; ORDER BY
stamped generation ASC → oldest-first fairness is structural). Empty batch =
generation COMPLETE (`CompleteSweepGeneration`, guarded stamp + failed count
for the DEGRADED alarm). The snapshotter holds ZERO sweep progress in memory.

### Findings resolved (each pinned)

1. **[high] Startup resweep durability** — the lagging set IS the durable
   queue. `TestRestartLoopConvergence` (replacing the old single-account
   `TestStartupSweepCoversRewindCrash` shadow): 5-account registry, batch 2,
   a FRESH Snapshotter per Step across two full generations → converges,
   opens exactly one generation per sweep, and per-account multicall attempt
   counts prove prefix accounts are NEVER reprocessed.
2. **[high] Balance+status atomicity** — `store.ApplySweepBatch(engine,
   generation, execBlock, []SweepResult{Account, OK, Balances})`: ONE tx =
   wholesale snapshot balances + collateral-side history document (snapshots
   table, at the multicall execution block) + generation-stamped status rows
   (failures included). Injection at a REAL boundary:
   `TestApplySweepBatchMidTxFailureRollsBackEverything` — validation is
   deliberately per-result inline, so result[0]'s full statement run executes
   in-tx before result[1]'s nil-amount aborts; all three tables verified
   rolled back to pre-batch state (including restoring, not just emptying).
3. **[high] All-reverted reclassification** — success=false is ALWAYS a
   per-account failure (recorded + WARN, durable attempts budget 1+3, then
   skipped with DEGRADED completion alarm); batch errors are only transport/
   malformed-response. `TestAllRevertedBatchIsPerAccountFailure` (the flipped
   wedge test): queue advances, statuses recorded, WARNs captured, degraded
   completion. The old "fresh all-reverted batch = target error" posture is
   gone — documented why (N bounded degradations beat a wedged queue).
4. **[high NEW] Reorg-orphaned snapshots** — inside `RewindDerived`'s
   EXISTING tx, after the events delete: anti-join deletes snapshot-sourced
   `position_balances` AND `snapshot_sweeps` rows for accounts with no
   surviving debt-side events, and bumps the sweep generation (the
   post-rewind re-sweep is durably OPEN, atomic with the epoch ack; onRewind
   stays the live fast path). `TestRewindDerivedInvalidatesOrphanedSnapshots`
   pins orphan-vanishes / survivor-keeps-but-lags / generation-bumped-open;
   `TestDurableBumpResumesAfterRewindCrash` pins the crash-resume leg at the
   snapshotter level (no TriggerResweep involved).
5. **[high] Runner carry-over bounded FIFO** — insertion-ordered slice +
   membership set (re-touch keeps ORIGINAL position), hard cap 10,000,
   drop-newest + WARN + counter on overflow (documented overload posture),
   oldest-first drain (2000/flush unchanged).
   `TestRunnerSnapshotCarryOverBoundedFIFO`: sustained arrivals, cap
   respected, oldest flushes first across windows, dropped-newest warning
   fires, dedupe position pinned.
6. **[high] SaveSnapshot side-restriction + collateral history** —
   `SaveSnapshot` now ENFORCES single-side (mixed-side → error; empty →
   error) and writes the same side-scoped `{"side","balances"}` shape as
   `SaveSnapshots` (old mixed-side test flipped to assert the ERROR).
   Collateral history rows for debt_manager now flow from `ApplySweepBatch`
   at the multicall execution block — the "no collateral history" gap is
   closed. (Aave collateral history remains absent by design — no
   snapshotter for that engine; disclosed note retained.)
7. **[medium] Mis-aimed injections** — both replaced per items 1–2 above.

### Retirements / semantics notes

1. `store.RecordSnapshotSweep` + `SweepOutcome` retired (status writes now
   exist ONLY inside `ApplySweepBatch`'s tx; a standalone status write would
   reopen the divergence window). Retirement rides commit `1dd8267` for
   per-commit compilability; its state-transition coverage moved to
   `TestApplySweepBatchLifecycle`. `UpsertSnapshotBalances` and
   `SnapshotAccounts` stay (live test users; the registry subquery is now
   also embedded in `SweepWorkBatch`).
2. **Restart no longer forces an immediate full sweep**: a process restarted
   after a COMPLETED sweep waits out the cadence (durable `completed_at`
   anchor) instead of re-sweeping unconditionally — the old unconditional
   startup sweep existed only as the crash backstop the generation bump now
   provides durably. A restart mid-sweep resumes the open generation.
3. `TriggerResweep` is now only the live fast path (defeats the cadence
   gate); called standalone it still forces a fresh generation.
4. Sweep completion Step returns advanced=true (it stamps durable state);
   idle rounds cost one PK-row read (`SweepGeneration`) — same posture as
   the runner's per-Step `HasUnackedReorg`.
5. `ApplySweepBatch` replay overcounts `attempts` (narrowing, never widening,
   the retry budget) — documented as the idempotence trade.
6. The DEGRADED failed-count at completion may include accounts a mid-
   generation rewind removed from the registry (advisory count; documented).

## Fix wave 3 (sweep durability, round 2)

Four accepted findings from Codex session 019f8f1b-c396-72a2-997a-bd5080ced0d0,
landed as two pathspec commits on a fresh-cycled live db:

- `5b63614` `fix: restore 00003 and ship forward migration 00004 with
  side-keyed history`
- `17e8ce7` `fix: rewind-scoped history invalidation and monotonic sweep
  blocks`

### Fix 1 [high] — safe migration path (restore 00003 + forward 00004)

The sweep-durability wave's in-place edit of `00003_snapshot_sweeps.sql` was
an unsafe upgrade: a database at the pushed baseline (`52d50ab`) recorded
version 3 WITHOUT generation/attempts/sweep_generations, and goose tracks
versions by number only — the edited content would silently never run
(runtime column-missing failures that would roll back even rewinds).

- `00003` restored byte-for-byte to `git show 52d50ab:...` content.
- NEW `internal/store/migrations/00004_sweep_generations.sql`:
  `ALTER TABLE snapshot_sweeps ADD generation BIGINT NOT NULL DEFAULT 0,
  ADD attempts BIGINT NOT NULL DEFAULT 0` (matching the current code's
  column shapes); `CREATE TABLE sweep_generations(...)` (starts empty —
  first Step opens generation 1); plus the Fix-2 snapshots changes below.
  Backfill semantics: generation 0 lags ANY opened generation, so every
  pre-existing sweep row owes work on the first post-upgrade sweep
  (cold-start), with block stamps/status preserved. Down migration drops the
  table/columns and restores the three-column snapshots PK (keeping the debt
  row where both sides exist).
- UPGRADE-PATH PROOF: `TestMigrateUpgradesV3BaselineWithoutDataLoss`
  (`internal/store/migrate_upgrade_test.go`) reconstructs the exact v3
  baseline via a test-only `migrateUpTo` (goose `UpToContext` over the SAME
  embedded FS — valid because 00003 is restored) in an isolated scratch
  schema (DSN `options=-csearch_path=...`), asserts the baseline truly lacks
  the wave's schema, seeds v3-shape sweep rows + side-marked AND legacy
  history documents + a derived registry, runs the production
  `store.Migrate`, and proves: goose lands at 4; zero data loss;
  generation/attempts backfill 0/0; history sides backfill from the
  documents' own markers (legacy → 'debt'); generation-0 rows LAG the first
  opened generation; and open → work-batch → apply → complete all function
  on the upgraded schema.

### Fix 2 [high] — side in the history key

snapshots PK (engine, account, block_number) let the debt writer (runner
`SaveSnapshots` at throughBlock B) and the collateral writer
(`ApplySweepBatch` at multicall exec block B) wholesale-replace each other.
00004 adds `side TEXT NOT NULL DEFAULT 'debt'` (backfilled from the JSONB
side marker) and re-keys the PK to (engine, account, block_number, side).
`SaveSnapshot`, `SaveSnapshots` and `ApplySweepBatch` all write/conflict on
the side column; single-side payload validation unchanged. Live test
`TestSnapshotHistorySidesCoexistAtSameBlock`: debt + collateral at the same
(engine, account, block) BOTH queryable; same-side re-saves replace only
their own row.

### Fix 3 [high] — rewind cleans history

Inside `RewindDerived`'s existing tx: `DELETE FROM snapshots WHERE engine
AND block_number > effectiveTarget` (all sides), and the orphan anti-join
now extends to snapshots (accounts with no surviving debt-side events lose
ALL history rows, below-target included).
`TestRewindDerivedInvalidatesOrphanedSnapshots` extended: orphan absent from
position_balances, snapshot_sweeps AND snapshots; survivor's above-target
rows (debt and collateral) deleted, at/below-target row retained; other
engines' rows untouched.

### Fix 4 [high] — monotonic sweep blocks (stale-failover guard)

In `ApplySweepBatch`'s tx, per successful account: the existing sweep row's
last_success_block is read FOR UPDATE; execBlock < it → that account's
balances/history/status are NOT applied and its generation does NOT advance
(stays lagging, re-pulls next batch — likely against a caught-up endpoint);
skips counted + WARN "stale sweep block: endpoint behind". ALL results stale
→ typed `store.ErrStaleSweepBatch` (nothing committed); the snapshotter's
Step logs the round DEGRADED (`Warn`, returns advanced=false, nil) instead
of completing. Same-block replays stay admitted (crash-replay idempotence);
failed results always recorded. Live regression
`TestApplySweepBatchRejectsStaleExecutionBlocks`: success@200 → 150 refused
(balances unchanged, generation lagging) → mixed batch commits fresh only →
201 lands → same-block replay ok → failure bypasses guard. Snapshotter fake
test `TestStaleSweepBatchIsDegradedRoundNotError` pins the DEGRADED WARN +
no-error + identical-batch retry.

### Gates

Local db was in the edited-00003 state (version 3 recorded WITH the wave's
columns — 00004 would collide), so it was cycled: `docker compose down -v`
+ fresh `docker compose up -d db` (make unavailable in the shell; the db-up
recipe was run verbatim). Against the pristine db: `gofmt -l .` empty;
`go vet ./...` clean; `go test ./... -count=1` all 8 packages ok — 276
tests PASS, 0 SKIP (live-db tests all executed). Goldens untouched. Both
commits verified individually compilable/green (commit 1 was built and
tested in its exact intermediate state before commit 2 was applied).

## Fix wave 4

One accepted [high] finding from Codex session
019f8f41-c3eb-77c3-9b80-a6d2bcb52359, landed as one commit
`fix: semantic-staleness endpoint rotation for stale sweep batches`
(`internal/chain`, `internal/snapshot`).

### Finding — sticky-active rotation is blind to semantic staleness

Fix wave 3's monotonic guard (`store.ErrStaleSweepBatch`) stops a stale batch
from being *applied*, but does nothing to move the sweep off the endpoint
serving it. `chain.Failover.do` only rotates its sticky `active` endpoint on
an RPC **error** — a responsive endpoint frozen at an old block returns a
well-formed, successful eth_call every time, so `do` never rotates away from
it. Result: Step re-pulls the same lagging accounts, re-issues the multicall
against the same frozen endpoint, the store correctly refuses the identical
stale batch again, forever — the sweep generation never completes and a
healthy later endpoint is never tried, even though one exists in the pool.

### Fix — semantic-staleness rotation (minimal additive)

- `(*chain.Failover).RotateActive()` (`internal/chain/chain.go`): advances
  the sticky `active` index by one mod endpoint count, under the mutex.
  Documented as the escape hatch for SEMANTIC failures — a response
  well-formed at the RPC layer but unusable by the caller — complementing
  `do`'s error-driven rotation, which cannot see this class of failure. The
  `active` field's invariant comment now calls out this one deliberate
  exception. New `EndpointCount()` reports `len(clients)`. Unit test
  `TestRotateActiveAdvancesStickyEndpoint`: endpoint 0 succeeds, `RotateActive`,
  the next call starts at endpoint 1 — proved via the fakes' call counts
  (endpoint 0 stays at 1 call, endpoint 1 gets the second).
- `internal/snapshot/snapshot.go`: the snapshotter-local `Chain` interface
  gained `RotateActive()` and `EndpointCount() int` (`*chain.Failover`
  satisfies both; the package doc and interface doc explain why they exist).
  On `ErrStaleSweepBatch`, `Step` now calls `RotateActive()` before returning
  the DEGRADED round, logging WARN `"rotating rpc endpoint after stale sweep
  batch"` — the next Step's multicall starts from the rotated endpoint.
  `Snapshotter` tracks `staleRotations` (consecutive stale rounds since the
  last landed batch, reset to 0 on any successful apply); once
  `staleRotations >= EndpointCount()` — a full cycle without progress — Step
  additionally logs WARN `"collateral snapshot sweep DEGRADED: all endpoints
  stale — cycled through every rpc endpoint without landing a batch"`. The
  existing DEGRADED posture (nothing wedges; the same batch keeps retrying)
  stands even in that case — the extra log is purely diagnostic. Chose
  exposing endpoint count via the interface over threading an int through
  `Config`: it can never drift from the real client pool, and it doesn't
  grow the constructor's parameter surface.
- Regression coverage (`internal/snapshot/snapshot_test.go`), all fake-store/
  fake-chain, no live db needed: a new `fakeMultiEndpointChain` models
  `Failover`'s sticky-active contract for real — `Call` always serves from
  index `active`, and ONLY `RotateActive` (called by `Step`, not the test)
  ever advances it. `TestStaleSweepBatchRotatesToHealthyEndpoint` is the
  Codex-specified production-style case: endpoint A responsive-frozen at
  execBlock 150 forever, endpoint B caught up at 201; first `Step` is
  rejected (stale, rotation logged, `active` moves 0→1, no "all endpoints
  stale" yet since only 1 of 2 tried), second `Step` re-pulls the SAME
  durable batch but the multicall now reaches B on its own and lands for
  real — balances at 201, `success` status, generation stamped.
  `TestAllEndpointsStaleLogsDegradedAfterFullCycle`: three endpoints all
  equally frozen, three consecutive stale `Step`s, each rotating in turn;
  after the third (a full cycle) the "all endpoints stale" DEGRADED warning
  fires. `freshSnapshotter`'s chain parameter was widened from the concrete
  `*fakeChain` to the `Chain` interface (a non-breaking change — `*fakeChain`
  still satisfies it) so both fake chain types can share the constructor;
  `fakeChain` itself gained no-op `RotateActive`/`EndpointCount` stubs
  (default `EndpointCount() == 0` so pre-existing tests that don't care about
  rotation never trip the all-stale check).

### Gates

`gofmt -l .` empty; `go vet ./...` clean; `go test ./... -count=1` against
the live db: all 8 packages ok — **255 PASS / 0 FAIL / 0 SKIP**. Goldens
untouched; only `internal/chain/{chain.go,chain_test.go}` and
`internal/snapshot/{snapshot.go,snapshot_test.go}` changed.

## Fix wave 5

Two findings from Codex session 019f8f54-8fed-7773-acc2-e330db82470f.

### Fix 1 [high] — Linearizable semantic endpoint rotation

`Failover.do` snapshotted `active`, ran the RPC loop unlocked, then
unconditionally wrote `active = idx` on success — so (a) a call begun before
a semantic rotation could complete after it and pin `active` back onto the
rejected endpoint, and (b) `RotateActive` advanced whatever endpoint was
active at judgment time, mis-basing off an interleaved success.

- `internal/chain/chain.go`: added a `rotation uint64` revision counter to
  `Failover` (mutex-guarded with `active`). `do` now records
  `startRotation` alongside its `active` snapshot and returns the serving
  endpoint index; the sticky write became conditional —
  `if f.rotation == startRotation { f.active = idx }` — so a mid-flight
  semantic rotation wins over the in-flight completion (which at worst
  forfeits a harmless routing-hint update). Error-driven rotation inside
  the loop is untouched (positional within the attempt sequence).
- `RotateActive()` is REMOVED (the snapshotter was its sole caller),
  replaced by `RotateAwayFrom(tok EndpointToken)`: under the mutex, active
  advances (mod len) ONLY if `tok.Index == active` — a rejection bound to
  the exact endpoint that served the judged-stale response, never punishing
  an endpoint an interleaved success moved to — and `rotation` increments
  UNCONDITIONALLY (documented: simpler and safe; a skipped unrelated sticky
  update is a harmless routing hint the next success rewrites).
  `EndpointToken{Index int}` (Index -1 when all endpoints failed) is
  returned by the new `CallWithToken` — additive on the snapshotter-facing
  path only; `Call` delegates to it, every other `do` caller is untouched.
  The sticky-active invariant comment now documents the revision mechanism.
- `internal/snapshot/snapshot.go`: the `Chain` interface is now
  `CallWithToken` / `RotateAwayFrom(chain.EndpointToken)` /
  `EndpointCount`; `sweepBatch` returns the serving token and Step's stale
  branch rejects exactly that endpoint (`RotateAwayFrom(servedBy)`), with
  the endpoint index added to the rotation WARN log. `cmd/indexer` wiring
  unchanged (`*chain.Failover` still satisfies the interface).
- Deterministic interleaving tests (`internal/chain/chain_test.go`,
  channel-gated blocking fake): `TestInFlightSuccessDoesNotRepinRotatedEndpoint`
  — call A starts on endpoint 0 and BLOCKS, semantic rotation away from 0
  lands, A completes successfully → `active` is NOT pinned back to 0 and
  the next call hits endpoint 1; `TestRotateAwayFromStaleTokenDoesNotMoveActive`
  — active moved to 2 by an interleaved success, `RotateAwayFrom(token 0)`
  leaves active on 2 (token≠active → no active change) and the next call
  still starts there. `TestRotateActiveAdvancesStickyEndpoint` became the
  token-based `TestRotateAwayFromAdvancesStickyEndpoint`.

### Fix 2 [medium] — Stale-streak resets on every progress transition

`staleRotations` previously reset only on ApplySweepBatch success, so a
stale round in generation G plus stale rounds in a LATER generation could
sum to a spurious "all endpoints stale" DEGRADED warning. Now the streak
resets on EVERY progress record: a landed batch (as before), generation-
completion stamping (stamped or superseded), and any observed generation
change — Step tracks `lastSeenGeneration` and restarts the streak when the
worked generation differs (covering rewind/re-sweep bumps and cadence
opens). The DEGRADED warning therefore requires a FRESH full endpoint cycle
of consecutive stale rounds with no intervening progress. Comments (package
doc, `staleRotations`) updated to the new contract.

Regressions (`internal/snapshot/snapshot_test.go`):
`TestStaleStreakResetsOnGenerationBump` — stale round in gen 1, rewind bump,
stale round in gen 2 → NO DEGRADED (streak restarted); a genuine two-round
(== endpoint count) stale cycle inside gen 2 → DEGRADED fires.
`TestStaleStreakResetsOnGenerationCompletion` — same shape through the
completion-stamping reset (white-box streak assertion, since completion is
only reachable with an empty batch). `fakeMultiEndpointChain` now mirrors
Failover's endpoint-bound `RotateAwayFrom` and token-stamped
`CallWithToken`; `fakeChain` gained the matching stubs.

### Gates

`gofmt -l .` empty; `go vet ./...` clean; `go test ./... -count=1` against
the live db: all 8 packages ok — **283 PASS / 0 FAIL / 0 SKIP** total
(subtests included), **259 top-level test functions** (279 total PASS at
HEAD before this wave; +4 new tests, 1 renamed). Goldens untouched; only
`internal/chain/{chain.go,chain_test.go}` and
`internal/snapshot/{snapshot.go,snapshot_test.go}` changed.

## Fix wave 6

Two Codex counter-schedule findings from session
019f8f85-a820-7192-91cc-578a79e1f6b9. Files touched: `internal/chain/
{chain.go,chain_test.go}`, `internal/snapshot/{snapshot.go,snapshot_test.go}`,
`internal/store/{derive.go,derive_support_test.go}` (additive read only).

### Fix 1 [high] — Caller-scoped persistent semantic failover

Counter-schedule proven against wave 5: snapshotter rejects endpoint A
(shared-hint rotation A→B) → the walker's BlockNumber errors on B and
succeeds on A → error-driven rotation legitimately re-pins the shared
active hint onto A → the next multicall hits A again — forever. A shared
global hint cannot carry a caller-specific semantic exclusion.

- `internal/chain`: new `CallFrom(ctx, startIndex, to, data)` — identical
  to `CallWithToken` but the attempt walk starts at startIndex (mod len,
  negatives normalized) and a success neither reads nor writes the shared
  `active` hint (documented: semantic callers must not fight error-driven
  routing). Internally `do` = `doFrom` (hint-free walk) + sticky re-pin;
  `CallWithToken` keeps its shared-path semantics unchanged.
- `RotateAwayFrom` and the `rotation` revision counter are REMOVED —
  superseded by the caller-scoped preference (the snapshotter was the sole
  caller); the linearization machinery existed only to guard the shared
  hint against exactly the interaction Codex attacked, and with no semantic
  writer of shared state left, `do`'s sticky write is unconditional again.
  A NOTE in chain.go records the supersession. Their tests
  (`TestRotateAwayFromAdvancesStickyEndpoint`,
  `TestInFlightSuccessDoesNotRepinRotatedEndpoint`,
  `TestRotateAwayFromStaleTokenDoesNotMoveActive`) went with them,
  replaced by `TestCallFromStartsAtGivenIndexAndLeavesSharedHintAlone`,
  `TestCallFromWrapsModuloAndRotatesOnError`, and
  `TestCallFromSuccessDoesNotRepinSharedHint` (the counter-schedule at the
  chain layer: a caller-scoped success never re-pins the shared hint).
- `internal/snapshot`: Snapshotter owns `preferredStart` (-1 = none;
  initialized in New). On ErrStaleSweepBatch with served token T:
  `preferredStart = (T.Index+1) % EndpointCount()` — PERSISTENT, replacing
  the shared-hint rotation entirely; a stale batch served via the
  preference advances it past that server (same formula); ANY progress
  (landed batch, completion, observed generation change, reconciled
  durable progress) releases it via the new `recordProgress()` (which also
  restarts the stale streak — full-cycle tracking unchanged). While set,
  `sweepBatch` multicalls go through `CallFrom(preferredStart, …)`; the
  `Chain` interface is now CallWithToken/CallFrom/EndpointCount. WARN log
  renamed: "preferring next rpc endpoint after stale sweep batch".
- Codex regression `TestPreferredEndpointSurvivesSharedHintRepin`
  (deterministic, fake-based): A frozen@150 with healthy BlockNumber, B
  current@201 with erroring BlockNumber; sweep rejects A → interleaved
  shared-path BlockNumber re-pins shared active onto A
  (`sharedBlockNumber`, modeling Failover.do exactly) → the next sweep
  STILL reaches B via the preference and LANDS at 201; the landing releases
  the preference and never writes the shared hint.
  `TestStaleSweepBatchRotatesToHealthyEndpoint` became
  `TestStaleSweepBatchPrefersNextEndpoint`; the all-stale cycle test now
  asserts served endpoints `[0,1,2]` (each tried exactly once).
  `fakeMultiEndpointChain` models the new contract (CallWithToken = sticky
  active; CallFrom = caller start, active untouched; per-call served
  tokens); `fakeChain` gained a CallFrom stub.

### Fix 2 [medium] — Durable-progress reconciliation for the stale streak

Counter-schedule: stale round (streak=1) → ApplySweepBatch COMMITS but
returns an error (lost ack — ApplySweepBatch returns its Commit's error,
the documented commit indeterminacy) → durable rows advanced, streak not
reset → next stale round → streak=2 → false full-cycle "all endpoints
stale" DEGRADED fired ACROSS real progress.

- Snapshotter remembers the account set + generation of the last ERRORED
  ApplySweepBatch (`unackedAccounts`/`unackedGeneration`; the
  ErrStaleSweepBatch branch deliberately does NOT remember — the typed
  refusal returns before commit, no indeterminacy). At the next Step,
  BEFORE any processing, `reconcileUnacked` probes those accounts' durable
  generation stamps via the new additive store read
  `SweepGenerations(ctx, engine, accounts) → map[accountHex]generation`
  (`= ANY($2)` over snapshot_sweeps; success and failed rows both stamp):
  any stamp matching the applied generation is durable evidence the batch
  landed → progress → streak AND preference reset. One-shot: a successful
  probe clears the set evidence-or-not; an ERRORED probe keeps it and
  surfaces as a Step error. Documented conservative-positive edge: a
  retried failed account already carries the generation stamp, acceptable
  for a telemetry-streak reset.
- Injection tests (fake store gained `applyCommitErr` — persists results,
  then returns the error — and one-shot `sweepGensErr`):
  `TestLostAckApplyReconcilesAsDurableProgress` (the exact schedule:
  stale → lost-ack commit → reconcile resets → next stale round is streak
  1 not 2, no false DEGRADED; a genuine fresh cycle still fires),
  `TestFailedApplyWithoutDurableEvidenceKeepsStreak` (a genuinely-failed
  apply reconciles to nothing: streak carries, genuine cycle fires),
  `TestReconcileProbeErrorKeepsRememberedSet` (an errored probe is a Step
  error that keeps the evidence set for the next round). Live-db
  `TestSweepGenerationsReadsDurableStamps` pins the store read (stamps for
  success+failed rows, rowless absent, empty-set short-circuit,
  engine-scoped).

### Gates

`gofmt -l .` empty; `go vet ./...` clean; `go test ./... -count=1` against
the live db: all 8 packages ok — **288 PASS / 0 FAIL / 0 SKIP** total
(subtests included), **264 top-level test functions** (283/259 at wave 5;
+8 new tests, −3 removed with RotateAwayFrom, 1 renamed).
`go test -race ./internal/chain/ ./internal/snapshot/` clean — run inside
a `golang:1.24` Docker container because the Windows host has no C
toolchain (`-race` requires cgo); both packages are fake-based and need no
DB, so the containerized run is equivalent.

## Fix wave 7

One Codex [medium] finding from the wave-6 gate (session
019f8fb5-d6d9-7ef0-89c2-8d75cc54bc9c): the one-shot negative
`SweepGenerations` probe could race late commit visibility — pgx may return
a COMMIT error while the server is still resolving it, MVCC serves the
probe the OLD stamp, the remembered evidence clears one-shot, and a real
commit later lands with the streak never having reset — spanning real
progress into a false all-endpoints-stale DEGRADED. Files touched:
`internal/snapshot/{snapshot.go,snapshot_test.go}`,
`internal/store/{derive.go,derive_support_test.go}`.

### Fix — conservative ambiguity (delete the probe, don't harden it)

The stale streak and its DEGRADED warning are TELEMETRY bounds, not a
correctness mechanism — correctness lives in the durable generation model,
not this counter — so rather than hardening the probe against the race
(same delete-don't-harden lesson as wave 6's shared-hint rotation), the
wave-6 reconciliation machinery is retired outright:

- `Step`'s ApplySweepBatch error branch (the non-`ErrStaleSweepBatch` path)
  now calls `recordProgress()` (resets `staleRotations`, releases
  `preferredStart`) IMMEDIATELY, in the same round that saw the error, for
  ANY non-stale apply error — no distinction between a pre-commit refusal
  and a lost-ack commit; both are now uniformly "ambiguous, so
  conservatively progress." Documented inline: this errs toward suppressing
  a false all-endpoints-stale diagnosis; at worst a genuine DEGRADED fires
  one full cycle later than it otherwise would. Correctness is unaffected —
  durable sweep generations, not this counter, gate the work.
- Wave-6's remembered-batch machinery is gone entirely: the
  `unackedAccounts`/`unackedGeneration` fields, `reconcileUnacked`, and its
  call at the top of `Step` are deleted. The stale-refused-batch path
  (`ErrStaleSweepBatch`, a definite pre-commit non-commit) keeps its
  existing streak-increment behavior unchanged — it was never ambiguous.
- `store.SweepGenerations` had exactly one caller (`reconcileUnacked`); with
  the caller gone it is removed too, along with
  `TestSweepGenerationsReadsDurableStamps` (verified via repo-wide grep:
  zero remaining references outside comments explaining the retirement).
- `internal/snapshot`: package doc and the `Snapshotter` struct doc comments
  updated to describe the conservative-reset posture in place of the
  reconciliation description; `fakeSnapStore` lost `SweepGenerations`,
  `sweepGensErr`, and the now-dead `stampReads` counter.

### Tests

Replaced the three reconciliation-injection tests
(`TestLostAckApplyReconcilesAsDurableProgress`,
`TestFailedApplyWithoutDurableEvidenceKeepsStreak`,
`TestReconcileProbeErrorKeepsRememberedSet`) with two:
`TestIndeterminateApplyErrorResetsStreakImmediately` (a stale round pins a
preference and streak 1; an ambiguous apply error resets both in that same
`Step` call — no probe, and none is even callable anymore) and
`TestIndeterminateApplyBreaksStaleStreakAcrossRounds` (Codex's exact
counter-schedule, now benign: stale round → ambiguous apply error → stale
round again is streak 1, NOT 2, no false DEGRADED; a genuine third stale
round with no intervening error still completes a real full cycle and
fires). `TestAllEndpointsStaleLogsDegradedAfterFullCycle` (unchanged)
independently covers a genuine full stale cycle with no intervening applies
still firing DEGRADED.

### Gates

`gofmt -l .` empty; `go vet ./...` clean; `go test ./... -count=1` against
the live db: all 8 packages ok — **262 PASS / 0 FAIL / 0 SKIP** total,
**262 top-level test functions** (264 at wave 6; −3 removed, +2 added in
`internal/snapshot`, −1 removed in `internal/store`, net −2). `go test
-race ./internal/chain/ ./internal/snapshot/` clean, run inside a
`golang:1.24` Docker container (host lacks cgo), same precedent as wave 6.
Commit `3dda135`.

## Fix wave 8

Two [medium] findings from the wave-7 gate (Codex session
019f8fda-34f9-7b82-9db2-89c6b317bb4a). File scope: `internal/snapshot/**`.

### Fix 1 — split telemetry reset from routing release

Wave 7's `recordProgress()` conflated two different resets on an ambiguous
(non-stale) `ApplySweepBatch` error: it reset `staleRotations` (a telemetry
counter, fine to reset conservatively) AND released `preferredStart` (the
caller-scoped endpoint-routing preference — a correctness-adjacent decision,
not telemetry). Codex's regression: preference pinned at endpoint B after a
stale rejection of A; the apply on B then returns an ambiguous error;
releasing the preference lets the very next retry fall back to the shared
hint, which can still point at A — the sweep bounces straight back to the
endpoint it had just rejected as stale.

Fix: `recordProgress()` split into two functions. `resetStaleTelemetry()`
resets only `staleRotations`. `recordProgress()` calls
`resetStaleTelemetry()` and additionally releases `preferredStart`. Step's
ambiguous-apply-error branch now calls `resetStaleTelemetry()` only, so the
preference survives; the other three call sites (observed generation
change, generation completion, and a landed `ApplySweepBatch`) are genuine
progress and keep calling full `recordProgress()`. Package doc, the
`staleRotations`/`preferredStart` field comments, and both function doc
comments updated to describe the split and name the retained Codex finding.

### Fix 2 — honest unbounded-suppression documentation, no new machinery

Wave 7's inline claim ("this errs toward suppressing a false
all-endpoints-stale diagnosis; at worst a genuine DEGRADED fires one full
cycle later than it otherwise would") is wrong under recurrence: because
every non-stale apply error resets the streak, an alternating
stale/apply-error pattern defers the all-endpoints-stale DEGRADED
indefinitely, not by one cycle. Adjudicated posture: document precisely
rather than add suppression machinery. The now-inaccurate "one cycle later"
wording was grepped out of `snapshot.go` (package doc, the DEGRADED
threshold comment, and the ambiguous-error branch) and replaced with the
accepted-behavior text: recurrent non-stale apply errors reset the counter
every time; a persistent alternating pattern defers the warning
indefinitely; accepted because that pattern already floods the log with
apply errors (the primary operator signal), and the warning exists for the
QUIET failure mode — every endpoint stale with no apply attempt ever
erroring. (Two intentional quotes of the retired phrase remain, in
`snapshot.go` and `snapshot_test.go`, explicitly framed as "the old,
retired claim" for contrast — not asserted as current behavior. The
historical wave-7 entry above is left as-is; it recorded the design intent
at the time, not current behavior.)

### Tests

`TestIndeterminateApplyErrorResetsStreakImmediately`: doc comment extended
to name the wave-8 regression; its final assertion changed from
`require.Equal(t, -1, s.preferredStart, ...)` (asserting release — the bug)
to asserting the preference is unchanged from the value the stale round
pinned (asserting retention — the fix).
`TestIndeterminateApplyBreaksStaleStreakAcrossRounds` needed no change (it
only ever asserted `staleRotations`, never `preferredStart`). Added
`TestRecurrentApplyErrorsDeferAllEndpointsStaleIndefinitely`: an adversarial
schedule of (N-1 stale refusals, one ambiguous apply error) × 3 cycles on a
2-endpoint chain, asserting the streak never reaches the threshold and the
"all endpoints stale" warning never fires — the documented, accepted
indefinite-deferral behavior. `TestAllEndpointsStaleLogsDegradedAfterFullCycle`
(the genuine-quiet-cycle DEGRADED case) unchanged and still passes.

### Gates

`gofmt -l .` empty; `go vet ./...` clean; `go test ./... -count=1` against
the live db: all 8 packages ok — **263 PASS / 0 FAIL / 0 SKIP** total, 263
top-level test functions (262 at wave 7; +1 new in `internal/snapshot`).
`go test -race ./internal/snapshot/` clean, run inside a `golang:1.24`
Docker container (host lacks cgo/gcc), same precedent as waves 6–7 — same
22 tests pass under `-race`. Commit `9107c63`.

## Fix wave 9

One Codex [medium] finding (session 019f8ffd-4aca-7201-a374-bfb5cdce6f06):
consecutive ambiguous `ApplySweepBatch` errors on the caller-scoped
preferred endpoint pinned routing there PERMANENTLY — wave 8's fix
correctly kept a single ambiguous error from releasing the preference
(preventing a bounce back to a stale-rejected endpoint), but nothing ever
released it again on repeated recurrence, so a recovered earlier endpoint
was never reprobed. File scope: `internal/snapshot/{snapshot,snapshot_test}.go`.

### Fix — bounded ambiguity lease on the preference

New `consecutiveAmbiguous int` field alongside `preferredStart`, plus
`const maxConsecutiveAmbiguous = 3`. The ambiguous-apply branch in `Step`
still calls `resetStaleTelemetry()` as before, then — only while a
preference is actually pinned (`preferredStart >= 0`; with none pinned
there is no lease to bound) — increments `consecutiveAmbiguous`; on
reaching `maxConsecutiveAmbiguous` it rotates `preferredStart` one endpoint
further (mod `EndpointCount()`), resets the counter to 0, and logs WARN
`"rotating preferred endpoint after repeated ambiguous apply failures"`.
`consecutiveAmbiguous` resets to 0 in three places: `recordProgress()`
(genuine progress — alongside releasing `preferredStart` itself), the
`ErrStaleSweepBatch` branch (a stale round is its own bounded preference
machinery already), and therefore implicitly on preference release. Package
doc, the `maxConsecutiveAmbiguous`/`consecutiveAmbiguous`/`recordProgress`
comments, and the ambiguous-branch inline doc all updated to describe the
lease as bounding ROUTING, distinct from `staleRotations` which bounds only
a DEGRADED telemetry WARNING.

### Tests

`TestConsecutiveAmbiguousApplyErrorsRotatePreferredEndpoint` pins the exact
Codex schedule on a 3-endpoint fake: a stale round pins the preference at
endpoint 1; the first two consecutive ambiguous apply errors both RETAIN
it (asserted via `s.preferredStart` and the fake's per-call served-endpoint
log); the third consecutive ambiguous error rotates it to endpoint 2,
resets the counter, and logs the rotation WARN; a following successful
sweep actually routes through the rotated endpoint and releases the
preference on landing. `TestAmbiguousLeaseDoesNotAccumulateWithoutAPreference`
pins the guard: with no preference pinned, `maxConsecutiveAmbiguous+2`
consecutive ambiguous errors never move `consecutiveAmbiguous` off zero
and never synthesize a preference. All prior wave 7/8 regressions
(`TestIndeterminateApplyErrorResetsStreakImmediately`,
`TestIndeterminateApplyBreaksStaleStreakAcrossRounds`,
`TestRecurrentApplyErrorsDeferAllEndpointsStaleIndefinitely`) pass
unmodified — one or two ambiguous errors alone never reach the lease
threshold.

### Gates

`gofmt -l .` empty; `go vet ./...` clean; `go test ./... -count=1` against
the live db: all 8 packages ok — **265 PASS / 0 FAIL / 0 SKIP** top-level
test functions (263 at wave 8; +2 new in `internal/snapshot`).
`go test -race ./internal/snapshot/` clean, run inside a `golang:1.24`
Docker container (host lacks cgo/gcc), same precedent as waves 6–8 — 24
tests pass under `-race`. Pristine tree. Commit `d1e7d54`.
