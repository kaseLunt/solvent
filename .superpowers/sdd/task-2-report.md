# Task 2 Report: Store rework — batched verified inserts + cursor monotonicity

## Scope
Modified only `internal/store/store.go` (SaveBatch internals) and
`internal/store/store_test.go` (5 new tests appended). Public signatures
untouched; Rewind's cursor-write path untouched.

## TDD sequence

### Baseline (pre-change)
`go test ./internal/store/ -v` — 7/7 PASS (existing suite untouched at start).

### Step 1 — failing tests appended
Appended verbatim from the brief:
- `TestSaveBatchRejectsDivergentReplayPayload`
- `TestSaveBatchAcceptsIdenticalReplay`
- `TestSaveBatchRejectsCursorRegression`
- `TestRewindStillMovesCursorBackward`
- `TestSaveBatchRollsBackOnMidTxFailure`

### Step 2 — run to verify failure baseline
```
go test ./internal/store/ -run 'Divergent|IdenticalReplay|CursorRegression|RewindStillMoves|RollsBack' -v
```
Result (before any store.go change):
- `TestSaveBatchRejectsDivergentReplayPayload` — **FAIL** (no error yet; expected)
- `TestSaveBatchAcceptsIdenticalReplay` — PASS (pins current idempotent-replay behavior)
- `TestSaveBatchRejectsCursorRegression` — **FAIL** (no error yet; expected)
- `TestRewindStillMovesCursorBackward` — PASS (pins current Rewind behavior)
- `TestSaveBatchRollsBackOnMidTxFailure` — PASS **already**, using the brief's
  primary trigger (`Topics: nil`). Under pgx, a nil `[][]byte` bound to a
  `BYTEA[]` parameter encodes as SQL `NULL`, which violates the `topics`
  `NOT NULL` constraint on `raw_logs` and rolls back the (still per-row-loop)
  transaction. **No trigger substitution was needed** — the brief's fallback
  (duplicated `LogIndex` within a batch) was not used.

This matches the brief's Step 2 expectation exactly (divergent/regression
fail, identical-replay/rewind pass, rollback recorded as already-passing).

### Step 3 — reimplement SaveBatch internals
Replaced the per-row `INSERT ... ON CONFLICT DO NOTHING` loop with, inside the
existing transaction:
1. `CREATE TEMPORARY TABLE batch_logs (LIKE raw_logs INCLUDING DEFAULTS) ON COMMIT DROP`
2. `tx.CopyFrom` of all batch rows into `batch_logs` (columns include
   `ingested_at` = `time.Now().UTC()`)
3. Verify-on-conflict: `SELECT count(*) FROM batch_logs b JOIN raw_logs r
   USING (chain_id, tx_hash, log_index) WHERE <any of block_number,
   block_hash, address, topics, data differ>` — if `divergent > 0`, return an
   error containing `"divergent payload"` (mid-transaction, so `defer
   tx.Rollback` discards everything, including the temp-table copy).
4. `INSERT INTO raw_logs SELECT * FROM batch_logs ON CONFLICT (...) DO
   NOTHING` — the actual persist step, now conflict-safe because divergence
   was already ruled out.

Cursor upsert replaced with the guarded form:
```sql
INSERT INTO ingest_cursors (...) VALUES (...)
ON CONFLICT (stream) DO UPDATE SET ...
WHERE ingest_cursors.last_block <= EXCLUDED.last_block
```
followed by an explicit `ct.RowsAffected() == 0` check that returns
`"cursor regression: stream %q refused move to %d"`. This correctly covers
both cases: a brand-new stream always inserts (1 row affected, never
spuriously flagged as regression), and an existing stream either updates
(tip advanced or equal, `<=`) or is silently skipped by the WHERE clause
(regression, 0 rows affected).

Added `"time"` import; `pgx` was already imported. Updated the `Store` doc
comment's replay-semantics paragraph per the Interfaces block (deferral
sentence replaced with the verify-on-conflict sentence). `Rewind` was not
touched.

### Step 4 — full store suite
```
go test ./internal/store/ -v
```
All 12 tests PASS (7 prior + 5 new), live db, no skips, single run.

### Step 5 — quality gates
- `gofmt -l internal/store/` — empty (no formatting issues).
- `go vet ./internal/store/` — clean.
- `go test ./internal/store/ -v -count=1` — run a second time (cache-busted):
  all 12 PASS again, pristine output, no flakes.

Per the parallel-agent constraint in this task's instructions (package-scoped
only; two other agents concurrently touch `recon/` and `internal/config/` in
the same working tree), repo-wide `go vet ./...` / `go test ./...` were
intentionally **not** run, to avoid interacting with in-flight, possibly
non-compiling state in packages owned by other agents.

## Commit — concurrency note (important)

The intended commit was:
```
git commit -m "feat: batched verified inserts (CopyFrom + verify-on-conflict), cursor monotonicity guard" -- internal/store/store.go internal/store/store_test.go
```
staged and committed by name, restricted to the two owned files via pathspec
(so it would not sweep up any other agent's staged changes).

**What actually happened:** this is a single shared working directory (not
separate worktrees) with multiple agents running `git add`/`git commit`
concurrently. Between my `git add` (by name, store files only) and my
pathspec-scoped `git commit`, the `internal/config`-owning agent ran a plain
`git commit` (no pathspec) that committed the entire index — which at that
moment included both its own staged config/testdata files **and** my staged
store files. That commit landed as `65c93f5` under its message: `"fix: trim
RPC urls; validate engine vocabulary, stream names; pin production config
parse"`. By the time my own pathspec-scoped commit ran, the store changes
already matched HEAD (having just been committed by the other process), so
my commit reported "nothing to commit" for that pathspec.

Verified: `internal/store/store.go` and `internal/store/store_test.go` in
`65c93f5` are byte-for-byte the changes described in this report (confirmed
via `git show --stat 65c93f5` and `git status --short -- internal/store/`
showing a clean tree). The code is correct and fully present at HEAD; only
the commit **message/attribution** is entangled with the other agent's
unrelated config work, not the content.

I deliberately did **not** attempt to un-entangle this via `git reset --soft`
+ recommit: by the time I investigated, a *third* concurrent agent had
already landed another commit (`7cc91b3`, roadmap/control-plane work) on top
of `65c93f5` in the same shared repo. Rewriting history at that point (even
non-destructively, via soft reset) risks colliding with another agent's
in-flight `git add`/`git commit` in the same working directory with no
worktree isolation — a real risk, not hypothetical, since it had already
happened twice in the span of this task. Nothing has been pushed to
`origin/main`, so the risk is local, but the safer choice was to leave
history as committed and report the discrepancy plainly rather than perform
further concurrent history surgery.

**Net result:** all code changes for Task 2 are complete, correct, tested,
and committed to `main` at commit `65c93f5` (co-mingled with the
`internal/config` agent's commit due to a genuine git race in a shared
working directory — not a scope violation on my part; I only ever staged
and attempted to commit the two files I own).

## Files touched
- `C:\Users\kasel\source\repos\etherfi\Solvent\internal\store\store.go`
- `C:\Users\kasel\source\repos\etherfi\Solvent\internal\store\store_test.go`

## Fix pass (Codex senior-review findings)

Adjudicated fix pass over `internal/store/SaveBatch` addressing five findings
from a senior review. Public signatures frozen; only `store.go` and
`store_test.go` touched.

### 1. Same-height fork-safe cursor guard (HIGH)

**What:** The cursor upsert's `WHERE` clause was
`ingest_cursors.last_block <= EXCLUDED.last_block`, which accepts an
equal-height update carrying a *different* hash. A same-height reorg replay
could silently re-anchor the cursor onto a sibling fork while rows already
persisted under the old fork remain in `raw_logs`, "blessed" by a cursor that
no longer matches them. Replaced with:
```sql
WHERE ingest_cursors.last_block < EXCLUDED.last_block
   OR (ingest_cursors.last_block = EXCLUDED.last_block
       AND ingest_cursors.chain_id = EXCLUDED.chain_id
       AND ingest_cursors.last_block_hash = EXCLUDED.last_block_hash)
```
**Why:** Same height + same hash is a legitimate idempotent replay and must
still succeed silently. Same height + different hash is a fork attempting to
re-anchor without going through `Rewind` — now correctly refused via the
existing `RowsAffected() == 0` → `"cursor regression"` error path (message
text unchanged). `Rewind`'s unconditional cursor write was not touched, so
rewind-driven backward moves still work.

### 2. Intra-batch identity validation (MEDIUM)

**What:** Added `dedupeBatchLogs` (new private helper) and `equalRawLog`
(byte-level field comparator), called at the top of `SaveBatch` before
`Begin`. Rows sharing the same `(tx_hash, log_index)` identity within the
same incoming slice are now: dropped (coalesced) if every field is
byte-identical, or rejected outright — nothing persisted — with an error
containing `"divergent duplicate log in batch"` if any field differs. The
deduplicated slice is what flows into the temp-table stage. Added the
required doc-comment line on `SaveBatch` stating this validation is
independent of the walker's upstream checks.

**Why:** Without this, two divergent copies of the "same" log arriving in one
batch would both land in `batch_logs` via `CopyFrom`; the existing
verify-on-conflict logic only compares `batch_logs` against already-committed
`raw_logs` rows (via `JOIN ... USING (chain_id, tx_hash, log_index)`), so it
cannot see intra-batch conflicts — whichever row happened to "win" the
`ON CONFLICT DO NOTHING` insert would persist silently, an unweighted
coin-flip on payload correctness. Running the check before `Begin` means a
divergent batch never touches the database at all.

### 3. Skip temp-table DDL for empty batches (LOW)

**What:** Wrapped `CREATE TEMPORARY TABLE` + `CopyFrom` + verify + `INSERT`
in `if len(logs) > 0 { ... }`, evaluated *after* dedup (so a batch that
coalesces down to zero rows — not applicable here since coalescing never
removes the last copy of an identity, but conceptually after-dedup is the
correct point) skips the block entirely. The cursor upsert always runs,
unconditionally, exactly as before.

**Why:** Cursor-only advances (`SaveBatch(ctx, stream, chainID, nil, tip,
hash)`, used throughout the existing test suite, e.g.
`TestSaveBatchRejectsCursorRegression`) were paying for a
`CREATE TEMPORARY TABLE ... ON COMMIT DROP` and a no-op verify query on every
call for no benefit — pure overhead on the hot cursor-tick path.

### 4. Explicit column lists (robustness minor)

**What:** Replaced `INSERT INTO raw_logs SELECT * FROM batch_logs ...` with
explicit, identical column lists on both sides:
```sql
INSERT INTO raw_logs (chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data, ingested_at)
SELECT chain_id, block_number, block_hash, tx_hash, log_index, address, topics, data, ingested_at FROM batch_logs
ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
```
**Why:** `SELECT *` against a temp table created via
`LIKE raw_logs INCLUDING DEFAULTS` is fragile against any future column
reordering or addition on either table — a silent column-position mismatch
would corrupt data without a SQL error. Explicit lists make the mapping
self-documenting and immune to reordering.

### 5. Single batch timestamp (minor)

**What:** Hoisted `ingestedAt := time.Now().UTC()` above the row-construction
loop; every row in the batch now shares one timestamp instead of calling
`time.Now().UTC()` once per row.

**Why:** Rows in the same logical batch should carry one ingestion instant,
not a spray of microsecond-drifted values purely as an artifact of loop
iteration speed — cleaner semantics for any later "ingested together"
analysis, and marginally cheaper.

### Test-helper fix required for the new tests to be meaningful

`sampleLogs(n, fromBlock)`'s pre-existing `TxHash` formula
(`[]byte{0x77, byte(i)}`) depended only on the in-batch index `i`, not on
`fromBlock`. This means two calls `sampleLogs(2, 100)` and `sampleLogs(2,
200)` produced **colliding** `(tx_hash, log_index)` identities with differing
`block_number` — which the pre-existing verify-on-conflict logic correctly
treats as a divergent replay and refuses. This collided with the new
`TestSaveBatchTempTableReuseOnSingleConnection`, which needs two *distinct*
identity sets across its two sequential `SaveBatch` calls to isolate what
it's actually testing (temp-table `ON COMMIT DROP` cleanup on a
single-connection pool), not replay-divergence rejection.

Fixed by extending the formula to
`[]byte{0x77, byte(fromBlock >> 8), byte(fromBlock), byte(i)}` — still
byte-identical across repeated calls with the *same* `fromBlock` (preserving
every existing replay/idempotency test's assumptions, all of which only ever
call `sampleLogs` at `fromBlock=100`), but now distinct across different
`fromBlock` values. Verified no other test relies on the old 2-byte format or
asserts on `TxHash` content directly.

Also handled per the task's fallback instructions: `Migrate(ctx, dsn)`
already took a `ctx` (no signature change needed), and the DSN separator for
`pool_max_conns=1` was computed as `sep := "?"; if strings.Contains(dsn, "?")
{ sep = "&" }` rather than hardcoded, since `TEST_DATABASE_URL` already
carries `?sslmode=disable`.

### Verification

```
gofmt -l internal/store/          → (empty — clean)
go vet ./internal/store/          → (clean)
go test ./internal/store/ -v      → 16/16 PASS, live db, single run
go build ./...                    → OK
go test ./...                     → all packages OK (chain, config, ingest, store)
```

Full verbose output of the 16-test run:
```
=== RUN   TestCursorNilWhenUnset
--- PASS: TestCursorNilWhenUnset (0.05s)
=== RUN   TestSaveBatchAdvancesCursorAndIsIdempotent
--- PASS: TestSaveBatchAdvancesCursorAndIsIdempotent (0.09s)
=== RUN   TestRewindDeletesLogsAboveBlock
--- PASS: TestRewindDeletesLogsAboveBlock (0.05s)
=== RUN   TestRewindResetsSiblingCursorsOnSameChain
--- PASS: TestRewindResetsSiblingCursorsOnSameChain (0.05s)
=== RUN   TestHighestLogAtOrBelow
--- PASS: TestHighestLogAtOrBelow (0.06s)
=== RUN   TestAcquireWriterLockEnforcesSingleWriter
--- PASS: TestAcquireWriterLockEnforcesSingleWriter (0.02s)
=== RUN   TestSaveBatchRejectsMismatchedChainID
--- PASS: TestSaveBatchRejectsMismatchedChainID (0.04s)
=== RUN   TestSaveBatchRejectsDivergentReplayPayload
--- PASS: TestSaveBatchRejectsDivergentReplayPayload (0.05s)
=== RUN   TestSaveBatchAcceptsIdenticalReplay
--- PASS: TestSaveBatchAcceptsIdenticalReplay (0.05s)
=== RUN   TestSaveBatchRejectsCursorRegression
--- PASS: TestSaveBatchRejectsCursorRegression (0.04s)
=== RUN   TestRewindStillMovesCursorBackward
--- PASS: TestRewindStillMovesCursorBackward (0.05s)
=== RUN   TestSaveBatchRollsBackOnMidTxFailure
--- PASS: TestSaveBatchRollsBackOnMidTxFailure (0.05s)
=== RUN   TestSaveBatchRejectsSameHeightDifferentHashCursor
--- PASS: TestSaveBatchRejectsSameHeightDifferentHashCursor (0.05s)
=== RUN   TestSaveBatchRejectsDivergentDuplicateWithinBatch
--- PASS: TestSaveBatchRejectsDivergentDuplicateWithinBatch (0.04s)
=== RUN   TestSaveBatchCoalescesIdenticalDuplicateWithinBatch
--- PASS: TestSaveBatchCoalescesIdenticalDuplicateWithinBatch (0.04s)
=== RUN   TestSaveBatchTempTableReuseOnSingleConnection
--- PASS: TestSaveBatchTempTableReuseOnSingleConnection (0.05s)
PASS
ok  	github.com/kaselunt/solvent/internal/store	1.452s
```

### Commit

```
git commit -m "fix: fork-safe cursor guard, intra-batch identity validation, batched-insert hardening" -- internal/store/store.go internal/store/store_test.go
```
Committed cleanly on the first attempt (no `index.lock` contention this
time) at `53fe65b`, containing exactly the two owned files
(`internal/store/store.go`, `internal/store/store_test.go`; 131
insertions, 13 deletions across both).

### Files touched (this pass)
- `C:\Users\kasel\source\repos\etherfi\Solvent\internal\store\store.go`
- `C:\Users\kasel\source\repos\etherfi\Solvent\internal\store\store_test.go`
