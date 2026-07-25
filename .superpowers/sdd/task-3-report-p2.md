# Task 3 report (P2 re-run): derivation schema + persistence methods

Commit: `fa5125d` — "feat: derivation schema and persistence — position events, balances, derive cursors, prices, snapshots"

Files touched (scope-limited per dispatch): only
- `internal/store/migrations/00002_positions.sql` (new)
- `internal/store/derive.go` (new)
- `internal/store/derive_test.go` (new)

No changes to `go.mod`/`go.sum`/`store.go`/`migrate.go` — all were only read for reference.

## Interfaces produced (verbatim per brief, for Tasks 5–9 to compile against)

```go
type PositionEvent struct {
	ChainID     uint64
	Engine      string
	BlockNumber uint64
	TxHash      []byte
	LogIndex    uint32
	EventType   string
	Account     []byte
	Asset       []byte
	Side        string   // "collateral" | "debt" | ""
	Delta       *big.Int // signed; nil for record-only events
	Payload     map[string]string
}

func (s *Store) DeriveCursor(ctx context.Context, engine string) (block uint64, found bool, err error)
func (s *Store) ApplyDerived(ctx context.Context, engine string, chainID uint64, events []PositionEvent, throughBlock uint64) error
func (s *Store) RewindDerived(ctx context.Context, engine string, chainID uint64, toBlock uint64) error
func (s *Store) BalancesFor(ctx context.Context, engine string, account []byte) (map[string]map[string]*big.Int, error)
```

`Migrate` confirmed as `Migrate(ctx context.Context, dsn string) error` in current `migrate.go` (post Phase-1 fix) — used as-is, unchanged.

## Design notes / decisions

- **NUMERIC round-trip**: writes bind `pgtype.Numeric{Int: delta, Exp: 0, Valid: true}` (pgx's Numeric implements `NumericValuer`, so it has a native encode plan for both text and binary parameter formats). I verified in pgx v5.5.1's `pgtype/numeric.go` that `NumericCodec.PlanEncode` only matches `NumericValuer`/`Float64Valuer`/`Int64Valuer` — a bare Go `string` bound to a NUMERIC-typed parameter has **no encode plan** and would fail at runtime, so the brief's "write Delta.String()" note is implemented via `pgtype.Numeric` instead (documented inline in `derive.go`). Reads cast the column to `::text` in SQL and parse with `big.Int.SetString`, sidestepping any NUMERIC `Exp` handling — safe because every value written here has `Exp == 0` (integer deltas only).
- **Idempotency/divergence semantics** (mirrors `SaveBatch`'s hardened pattern, per-row since position-event batches are small): for each event, `loadPositionEvent` looks up any existing row by the `(chain_id, tx_hash, log_index)` PK *inside the same transaction*. Found + identical → skip (no-op, no double-counted balance). Found + divergent → return an error immediately, which unwinds to the deferred `tx.Rollback(ctx)` (nothing persists). Not found → insert the event row and, if `Side != "" && Delta != nil`, upsert-add into `position_balances`. This same-transaction visibility also naturally coalesces/rejects intra-batch duplicates without a separate dedupe pass.
- **Balance upsert**: `ON CONFLICT (engine, account, asset, side) DO UPDATE SET amount = amount + EXCLUDED.amount, updated_block = GREATEST(...)`, matching the brief's SQL exactly.
- **Cursor guard**: same monotonic-guard idiom as `SaveBatch`/`ingest_cursors` — `WHERE derive_cursors.last_block < EXCLUDED.last_block OR (last_block = EXCLUDED.last_block AND chain_id = EXCLUDED.chain_id)`, so replaying the same `throughBlock` is a no-op but going backward is refused (`RowsAffected() == 0` → error, caught before `tx.Commit`).
- **RewindDerived**: deletes `position_events` above `toBlock` scoped by `engine` + `chain_id`; then wholesale-rebuilds `position_balances` for that `engine` (table has no `chain_id` column) via the brief's exact `DELETE` + `INSERT ... SELECT ... GROUP BY ... HAVING SUM(delta) <> 0` pair; resets `derive_cursors`.
- **BalancesFor**: keys the outer map by `hex.EncodeToString(asset)` (no `0x` prefix, lowercase) — no existing hex-formatting convention was found elsewhere in the repo (grepped for `hex.EncodeToString`/`hexutil`/`0x%x`, no hits), so this is a fresh, documented choice for Task 9 to consume.
- Added defensive validation (mirroring `SaveBatch`'s chain-id check) that every event's `ChainID`/`Engine` must match the call's `chainID`/`engine` arguments, or `ApplyDerived` errors before touching the DB.

## TDD evidence

**Step 3 (red)** — before `derive.go` existed, `go vet ./internal/store/...` failed as expected:
```
vet.exe: internal\store\derive_test.go:36:79: undefined: PositionEvent
```

**Step 2 test file** — `internal/store/derive_test.go`, six named test functions plus `testDeriveStore(t)` (local helper, TRUNCATEs `position_events, position_balances, derive_cursors, prices, snapshots, raw_logs, ingest_cursors` — does not touch `store_test.go`'s shared helper) and `pe()` exactly per the brief's shape:

| Test | Scenario covered |
|---|---|
| `TestApplyDerivedRoundTrip` | apply-then-read round trip: two events, same account/asset/side, sum into one `position_balances` row via `BalancesFor`; cursor advances to `throughBlock`; 2 event rows persisted |
| `TestApplyDerivedIdempotentReplay` | idempotent replay: re-apply identical events → no error, balance unchanged (no double count), still 1 event row |
| `TestApplyDerivedRejectsDivergentReplay` | divergent replay: same PK, different delta → error containing `"divergent"`, balance and event count unchanged (rollback confirmed) |
| `TestApplyDerivedRejectsCursorRegression` | `throughBlock` behind current cursor → error containing `"cursor regression"`; regressed batch's event never persisted; cursor unchanged |
| `TestRewindDerivedRebuildsBalances` | events at blocks 100/110/120 → `RewindDerived` to 105 → only block-100 event/effect survives, cursor = 105 |
| `TestRewindDerivedEngineIsolation` | `debt_manager` + `aave_v3_etherfi` events on the same account/asset → rewinding `debt_manager` leaves `aave_v3_etherfi`'s event and balance untouched |

**Step 4 (green)** — after implementing `derive.go`, targeted run:
```
go test ./internal/store/ -run Derive -v
--- PASS: TestApplyDerivedRoundTrip (0.17s)
--- PASS: TestApplyDerivedIdempotentReplay (0.08s)
--- PASS: TestApplyDerivedRejectsDivergentReplay (0.08s)
--- PASS: TestApplyDerivedRejectsCursorRegression (0.09s)
--- PASS: TestRewindDerivedRebuildsBalances (0.10s)
--- PASS: TestRewindDerivedEngineIsolation (0.09s)
PASS
ok  	github.com/kaselunt/solvent/internal/store	1.455s
```
All six passed on the first implementation attempt (no fix-iteration needed).

**Step 5 (full suite + quality gates)**:
```
go test ./internal/store/ -v   → 22/22 PASS (16 pre-existing Task 2 tests + 6 new), live db, pristine
gofmt -l internal/store/       → empty
gofmt -l .                     → empty
go vet ./internal/store/       → clean
go vet ./...                   → clean
go test ./...                  → ok internal/chain, internal/config, internal/ingest, internal/store (cached where unaffected)
```

## Concerns / follow-ups for later tasks

- `position_events`' PK is `(chain_id, tx_hash, log_index)` **without** `engine` (verbatim from the brief's SQL) — if two different engines ever need to derive events from the exact same `(chain_id, tx_hash, log_index)` identity, they would collide on that PK. Not exercised by current engine configs (`debt_manager`, `aave_v3_etherfi` watch disjoint contracts/topics per `config/contracts.json`), but worth flagging for Task 5/6 deriver authors.
- `ApplyDerived`'s per-event existence check (`loadPositionEvent`) issues one round-trip per event before its insert; fine at the stated batch sizes ("position-event batches are small"), but would need batching (temp-table + JOIN, à la `SaveBatch`) if derivation batch sizes grow much larger in Task 7's runner.
- Did not touch `store.go`, `migrate.go`, `go.mod`/`go.sum`, or `store_test.go`, per scope constraints; did not read/modify `recon/derivation-notes.md` or `recon/feeds.json` (the concurrent recon agent's untracked files) beyond noticing they exist in `git status`.
