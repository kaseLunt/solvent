# Task 4: `internal/store` — Schema, Migrations, Ingestion Persistence

**Status:** DONE

**Commit:** 62409b0 — feat: ingestion schema, migrations, cursor/batch/rewind store

## Implementation Summary

Successfully implemented the complete ingestion persistence layer for the Solvent indexer:

- **Migration SQL** (`internal/store/migrations/00001_ingest.sql`): Creates `ingest_cursors` and `raw_logs` tables with appropriate indexes and constraints.
- **migrate.go**: Goose-based database migration function using embedded filesystem.
- **store.go**: Core persistence API with types CursorPos, RawLog, and Store methods (Open, Close, Cursor, SaveBatch, Rewind).
- **store_test.go**: Comprehensive test suite covering cursor nil-on-empty, idempotent batch saves, and rewind semantics.

## TDD Evidence

### RED Step: Tests Fail with Undefined Types

**Command:**
```bash
go test ./internal/store/
```

**Output:**
```
# github.com/kaselunt/solvent/internal/store [github.com/kaselunt/solvent/internal/store.test]
internal\store\store_test.go:11:31: undefined: Store
internal\store\store_test.go:17:21: undefined: Migrate
internal\store\store_test.go:18:12: undefined: Open
internal\store\store_test.go:26:44: undefined: RawLog
internal\store\store_test.go:27:17: undefined: RawLog
internal\store\store_test.go:29:13: undefined: RawLog
FAIL	github.com/kaselunt/solvent/internal/store [build failed]
FAIL
```

Tests fail as expected with undefined symbols before implementation.

### GREEN Step: All Tests Pass Against Live Database

**Command:**
```bash
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
go test ./internal/store/ -v
```

**Output:**
```
=== RUN   TestCursorNilWhenUnset
2026/07/21 19:22:56 OK   00001_ingest.sql (24.55ms)
2026/07/21 19:22:56 goose: successfully migrated database to version: 1
--- PASS: TestCursorNilWhenUnset (0.23s)
=== RUN   TestSaveBatchAdvancesCursorAndIsIdempotent
2026/07/21 19:22:56 goose: no migrations to run. current version: 1
--- PASS: TestSaveBatchAdvancesCursorAndIsIdempotent (0.04s)
=== RUN   TestRewindDeletesLogsAboveBlock
2026/07/21 19:22:56 goose: no migrations to run. current version: 1
--- PASS: TestRewindDeletesLogsAboveBlock (0.05s)
PASS
ok  	github.com/kaselunt/solvent/internal/store	1.003s
```

All 3 tests PASS against the live Postgres database (no skips).

## Quality Gates

### gofmt
```
$ gofmt -l internal/store/
(no output - clean)
```

### go vet
```
$ go vet ./internal/store/
(no output - clean)
```

## Transactional Semantics Verification

✓ **SaveBatch**: One transaction wrapping all log inserts (idempotent ON CONFLICT) + cursor upsert. Commits atomically.

✓ **Rewind**: One transaction deleting logs above block + cursor reset. Commits atomically.

✓ **Cursor**: Read-only query, returns nil for missing stream (no implicit insert).

## Key Implementation Details

1. **Migration**: Uses Goose v3 with embedded filesystem (`//go:embed migrations/*.sql`) for distribution-safe schema versioning.
2. **pgx/v5**: Connection pooling via pgxpool with proper error wrapping.
3. **Test isolation**: Truncates tables before each test via testStore helper.
4. **Idempotency**: SaveBatch uses `ON CONFLICT DO NOTHING` for duplicate-safe replays.
5. **Cursor semantics**: Returns `(nil, nil)` when no cursor exists, not an error.

## Files Created

- `internal/store/migrate.go` (25 lines)
- `internal/store/store.go` (101 lines)
- `internal/store/store_test.go` (81 lines)
- `internal/store/migrations/00001_ingest.sql` (28 lines)

---

**Task completed per specification. All 3 tests pass against live database. Commit staged internal/store/ files only.**

## Fix pass (Codex adversarial findings)

**Status:** DONE

**Commit:** 1b36aae — fix: chain-global cursor rewind, batch chain-id validation, single-writer contract docs

An adversarial review of the persistence layer surfaced real issues; the controller adjudicated three fixes to apply now (a fourth, lock-based fencing, was adjudicated as resolved by documented single-writer architecture rather than code).

### 1. Chain-global cursor rewind (HIGH)

**Problem:** A chain reorg invalidates every stream on that chain (`Rewind` already deletes all `raw_logs` above `toBlock` for the whole `chain_id`), but the old code only reset the *named* stream's cursor. Any sibling stream sharing the chain kept its cursor pointing past `toBlock`, so the walker for that stream would never re-request the now-deleted block range — those logs would be permanently skipped on re-ingestion.

**Fix:** Inside `Rewind`'s existing transaction, after the `DELETE FROM raw_logs` and before the named-stream upsert, added:

```go
if _, err := tx.Exec(ctx,
	`UPDATE ingest_cursors SET last_block = $2, last_block_hash = $3, updated_at = now()
	 WHERE chain_id = $1 AND last_block > $2`,
	chainID, toBlock, hashAtBlock); err != nil {
	return fmt.Errorf("rewind sibling cursors: %w", err)
}
```

The same `hashAtBlock` is valid for every stream on the chain because cursors are chain-positional, not stream-specific state. The existing named-stream `INSERT ... ON CONFLICT` upsert is kept immediately after, since it also handles the case where the named stream has no cursor row yet (the `UPDATE` above is a no-op for a nonexistent row).

### 2. Chain-identity validation (MEDIUM)

**Problem:** `SaveBatch` took a `chainID` parameter for the batch but never checked that each `RawLog.ChainID` actually matched it — a caller bug could silently persist logs tagged with the wrong chain under a cursor for a different chain.

**Fix:** Added a guard at the top of `SaveBatch`, before `Begin`:

```go
for _, l := range logs {
	if l.ChainID != chainID {
		return fmt.Errorf("log %x/%d: chain id %d does not match batch chain id %d",
			l.TxHash, l.LogIndex, l.ChainID, chainID)
	}
}
```

Also hardened both cursor upserts (`SaveBatch` and `Rewind`) so `chain_id` can't drift from what's supplied on conflict — extended `DO UPDATE SET` to include `chain_id = EXCLUDED.chain_id` in both.

### 3. Concurrency/contract documentation (adjudicated)

**Problem:** The adversarial review raised fencing/locking concerns around concurrent `SaveBatch`/`Rewind` execution. The controller adjudicated this as resolved by *documenting* the actual architecture (single writer process, sequential walkers) rather than adding locks that the current design doesn't need.

**Fix:** Added a doc comment block above the `Store` type stating the single-writer concurrency contract and the replay/idempotency semantics (idempotent on `(chain_id, tx_hash, log_index)` via `ON CONFLICT DO NOTHING`; divergent payloads under the same key are prevented by the reorg protocol, not this layer; payload verify-on-conflict is called out as planned future work alongside a batched-insert rework).

### 4. New tests

Added to `store_test.go` (reusing the existing `testStore`/`sampleLogs` helpers):

- `TestRewindResetsSiblingCursorsOnSameChain` — saves cursors for two streams on chain 10 and one stream on chain 1, rewinds one chain-10 stream, and asserts the sibling chain-10 cursor is rewound to the same block/hash while the chain-1 cursor is untouched.
- `TestSaveBatchRejectsMismatchedChainID` — calls `SaveBatch` with a batch `chainID` that doesn't match the logs' `ChainID`, asserts the error message contains `"does not match batch chain id"`, and asserts nothing was persisted (cursor still nil).

No changes to public signatures of `Open`/`Close`/`Migrate`/`Cursor`/`SaveBatch`/`Rewind` — other packages compile against them unchanged.

### Verification

**Command:**
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
gofmt -l internal/store/
go vet ./internal/store/
go test ./internal/store/ -v
```

**gofmt output:** (empty — clean)

**go vet output:** (empty — clean)

**go test output:**
```
=== RUN   TestCursorNilWhenUnset
2026/07/21 19:38:04 goose: no migrations to run. current version: 1
--- PASS: TestCursorNilWhenUnset (0.19s)
=== RUN   TestSaveBatchAdvancesCursorAndIsIdempotent
2026/07/21 19:38:04 goose: no migrations to run. current version: 1
--- PASS: TestSaveBatchAdvancesCursorAndIsIdempotent (0.06s)
=== RUN   TestRewindDeletesLogsAboveBlock
2026/07/21 19:38:04 goose: no migrations to run. current version: 1
--- PASS: TestRewindDeletesLogsAboveBlock (0.05s)
=== RUN   TestRewindResetsSiblingCursorsOnSameChain
2026/07/21 19:38:04 goose: no migrations to run. current version: 1
--- PASS: TestRewindResetsSiblingCursorsOnSameChain (0.04s)
=== RUN   TestSaveBatchRejectsMismatchedChainID
2026/07/21 19:38:04 goose: no migrations to run. current version: 1
--- PASS: TestSaveBatchRejectsMismatchedChainID (0.04s)
PASS
ok  	github.com/kaselunt/solvent/internal/store	1.087s
```

All 5 tests PASS against the live Postgres database, pristine output (no skips, no extraneous warnings).

### Commit scope

Staged and committed only `internal/store/store.go` and `internal/store/store_test.go`. Pre-existing unrelated working-tree changes (`go.mod`, `go.sum`, untracked `internal/ingest/`) were left untouched and unstaged.
