### Task 3: Derivation schema + persistence methods

**Files:**
- Create: `internal/store/migrations/00002_positions.sql`
- Create: `internal/store/derive.go`
- Create: `internal/store/derive_test.go`

**Interfaces:**
- Consumes: Task 2's store; goose embedded migrations (00002 applies automatically via existing `Migrate`).
- Produces (Tasks 5–9 compile against these exactly):
  - `type PositionEvent struct { ChainID uint64; Engine string; BlockNumber uint64; TxHash []byte; LogIndex uint32; EventType string; Account []byte; Asset []byte; Side string; Delta *big.Int; Payload map[string]string }` (`Side` ∈ `"collateral"`, `"debt"`, `""`; `Delta` signed; `Payload` decimal-string extras, may be nil)
  - `(*Store).DeriveCursor(ctx, engine string) (block uint64, found bool, err error)`
  - `(*Store).ApplyDerived(ctx, engine string, chainID uint64, events []PositionEvent, throughBlock uint64) error` — ONE tx: insert events (idempotent on PK, divergence aborts like Task 2), apply each event's `Delta` to `position_balances` (upsert add), advance `derive_cursors` (monotonic, same guard pattern).
  - `(*Store).RewindDerived(ctx, engine string, chainID uint64, toBlock uint64) error` — ONE tx: delete `position_events` above `toBlock` for the engine, **rebuild `position_balances` for that engine wholesale** from surviving events (`INSERT … SELECT account, asset, side, SUM(delta) … GROUP BY` after a scoped `DELETE`), reset `derive_cursors`.
  - `(*Store).BalancesFor(ctx, engine string, account []byte) (map[string]map[string]*big.Int, error)` — asset-hex → side → amount (read path for reconciliation; Task 9).

- [ ] **Step 1: Write `internal/store/migrations/00002_positions.sql`**

```sql
-- +goose Up
CREATE TABLE position_events (
    chain_id     BIGINT  NOT NULL,
    engine       TEXT    NOT NULL,
    block_number BIGINT  NOT NULL,
    tx_hash      BYTEA   NOT NULL,
    log_index    INT     NOT NULL,
    event_type   TEXT    NOT NULL,
    account      BYTEA   NOT NULL,
    asset        BYTEA,
    side         TEXT    NOT NULL DEFAULT '',
    delta        NUMERIC,
    payload      JSONB   NOT NULL DEFAULT '{}'::jsonb,
    derived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX position_events_account_idx ON position_events (engine, account, block_number);
CREATE INDEX position_events_block_idx ON position_events (engine, chain_id, block_number);

CREATE TABLE position_balances (
    engine        TEXT   NOT NULL,
    account       BYTEA  NOT NULL,
    asset         BYTEA  NOT NULL,
    side          TEXT   NOT NULL,
    amount        NUMERIC NOT NULL,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (engine, account, asset, side)
);
CREATE INDEX position_balances_asset_idx ON position_balances (engine, asset, side);

CREATE TABLE derive_cursors (
    engine     TEXT PRIMARY KEY,
    chain_id   BIGINT NOT NULL,
    last_block BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prices (
    chain_id       BIGINT NOT NULL,
    asset          BYTEA  NOT NULL,
    source         TEXT   NOT NULL,
    price          NUMERIC NOT NULL,
    price_decimals INT    NOT NULL,
    block_number   BIGINT NOT NULL,
    observed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, asset, source, block_number)
);

CREATE TABLE snapshots (
    engine       TEXT  NOT NULL,
    account      BYTEA NOT NULL,
    block_number BIGINT NOT NULL,
    balances     JSONB NOT NULL,
    taken_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (engine, account, block_number)
);

-- +goose Down
DROP TABLE snapshots;
DROP TABLE prices;
DROP TABLE derive_cursors;
DROP TABLE position_balances;
DROP TABLE position_events;
```

- [ ] **Step 2: Write the failing tests** — `internal/store/derive_test.go`, live db, covering: apply-then-read round trip (two events same account/asset/side sum into one balance); idempotent replay (re-apply same events → unchanged balances, no error); divergent replay aborts (same PK, different delta → error, tx rolled back); derive-cursor monotonic (regression errors) ; rewind rebuild (apply events at blocks 100/110/120, RewindDerived to 105 → only block-100 effects survive in balances, cursor=105); engine isolation (rewind of `debt_manager` leaves `aave_v3_etherfi` rows intact). Use this helper shape:

```go
func pe(block uint64, tx byte, account, asset byte, side string, delta int64) store.PositionEvent {
	return store.PositionEvent{
		ChainID: 10, Engine: "debt_manager", BlockNumber: block,
		TxHash: []byte{tx}, LogIndex: 0, EventType: "test",
		Account: []byte{account}, Asset: []byte{asset}, Side: side,
		Delta: big.NewInt(delta),
	}
}
```
(Write the six test functions in full; they follow exactly the Task 2 test idioms — `testStore(t)`, `require`, direct SQL count probes. TRUNCATE `position_events, position_balances, derive_cursors` in the helper alongside the existing tables.)

- [ ] **Step 3: Run to verify failure** — `go test ./internal/store/ -run Derive -v` → FAIL `undefined: PositionEvent` etc.

- [ ] **Step 4: Implement `internal/store/derive.go`** — NUMERIC round-trips via `pgtype.Numeric` or string conversion (`Delta.String()` on write, scan into `pgtype.Numeric` → `*big.Int` via `.Int` with exponent handling — deltas are integers, so write `Delta.String()` and read with `SELECT amount::text` then `new(big.Int).SetString`; document this choice in a comment: integer NUMERIC only, exponent-free round trip). Balance upsert per event inside the tx: `INSERT INTO position_balances … VALUES … ON CONFLICT (engine, account, asset, side) DO UPDATE SET amount = position_balances.amount + EXCLUDED.amount, updated_block = GREATEST(...)`; skip events with `Side == ""` or nil `Delta` for balance application (they're record-only). Rebuild in RewindDerived: `DELETE FROM position_balances WHERE engine=$1` then `INSERT INTO position_balances SELECT engine, account, asset, side, SUM(delta), MAX(block_number) FROM position_events WHERE engine=$1 AND side <> '' AND delta IS NOT NULL GROUP BY engine, account, asset, side HAVING SUM(delta) <> 0`.

- [ ] **Step 5: Run full suite + quality gate** — `go test ./internal/store/ -v` all PASS; `gofmt -l . && go vet ./... && go test ./...` clean.

- [ ] **Step 6: Commit**

```bash
git add internal/store/migrations/00002_positions.sql internal/store/derive.go internal/store/derive_test.go
git commit -m "feat: derivation schema and persistence — position events, balances, derive cursors, prices, snapshots"
```

---

## Roadmap: Tasks 4–10 (steps authored after the Task 0 gate)

Scope and interfaces locked now; bite-sized steps appended to this file once `recon/derivation-notes.md` exists. Dependency notes inline.

- **Task 4 — `internal/decode`** *(after Task 0; parallel-safe with Tasks 1–3)*: embedded ABI JSONs (`//go:embed` copies under `internal/decode/abis/`) — this deliberately refines W1's "abigen" wording: runtime `accounts/abi` decoding from the same recon ABIs, no codegen step in the build (record as a W1-note, not drift); topic0 registry exactly matching recon's allowlists, `Decode(engine string, l store.RawLog) (DecodedEvent, bool, error)` returning typed params per Task 0's semantics table; table-driven tests whose fixtures are REAL rows exported from `raw_logs` (a fixture-generation step queries the live db); malformed-data and unknown-topic0 (skip, not error) cases.
- **Task 5 — Debt Manager deriver** *(after 3+4)*: `derive.Engine` interface `{ Name() string; Process(l store.RawLog) ([]store.PositionEvent, error) }`; pure function per Task 0's state-transition table (Borrowed→debt+, Repaid→debt−, Supplied→collateral+, Liquidated→per-tuple seizes, UserInterestAdded→debt+, WithdrawBorrowToken/config/ops events→record-only); unit tests per event type + the Step-2 borrowers' real sequences replayed to their view-call values.
- **Task 6 — Aave deriver** *(after 3+4; parallel with 5)*: scaled-balance model per Task 0's Aave section (ReserveDataUpdated index tracking; Supply/Withdraw/Borrow/Repay/LiquidationCall); golden-vector test: full replay of the dormant market's 138-borrow history → balances for `0x70daaac4…e5fe` and the healthy sample cross-checked against `getUserReserveData` at current head (tolerance documented from Task 0 precision analysis).
- **Task 7 — Derivation runner + daemon integration** *(after 5+6)*: `internal/derive.Runner` stepping per engine (read raw_logs above derive cursor in bounded windows → Decode → Engine.Process → ApplyDerived); **reorg coordination**: after any walker rewind in a round, runner compares derive cursor vs `HighestLogAtOrBelow` and calls `RewindDerived` before continuing; wire into `cmd/indexer` after walker rounds; **snapshot population** also lands here: after each derivation round that changed balances, write a `snapshots` row per touched account at the derive cursor's block (JSONB decimal-string balances via `BalancesFor`); Phase 1 daemon deferrals land here: advisory-lock liveness re-check per round, per-walker error backoff (skip a walker for N rounds after M consecutive errors), "will retry next round" log wording.
- **Task 8 — `internal/prices`** *(after 3; needs `recon/feeds.json`)*: `feeds.json` loader (extends config surface, validated against `KnownEngines`-style vocabulary `poll|chainlink_stream`); poll path: per-asset oracle contract calls each poll interval → `prices` rows at current head; stream path: add aggregator addresses as `chainlink_feed` walker streams in `config/contracts.json` + an `AnswerUpdated` deriver writing `prices` rows (reuses the whole Phase 1 ingestion machine); tests with fake chain.
- **Task 9 — Backfill completion + reconciliation harness** *(after 7)*: run the daemon to close both raw-log gaps (OP ~150.1M→head, ETH ~21.3M→head; escalate to the user per R-001 if free-RPC 403/429 stalls make this infeasible — decision point: paid tier); then `cmd/reconcile` (or `go test -tags reconcile`): sample ≥3 live Debt Manager borrowers + both Aave vectors, `BalancesFor` vs live view calls, emit a drift report artifact; **invariant scan**: SQL check for >1 distinct `block_hash` per `(chain_id, block_number)` in raw_logs (the deferred distinct-hash-per-height scan) — zero rows expected, wired as a test.
- **Task 10 — Anvil-fork replay test + phase gate** *(after 9)*: opt-in integration test (`ANVIL_FORK_RPC` env gates it; skipped in CI, documented honestly) — anvil-fork OP at a pinned covered range, run walker+runner against the fork for that window, assert derived balances equal fork view calls at the pinned block; then W1 closure: evidence receipts per the control plane (`doctor.py --receipt-basis W1 --snapshot <commit>` → receipt file → `doctor.py --stamp W1` → status `achieved`), whole-branch review (standard + Codex per standing directive), CI green, phase report.

## Execution protocol (carry-over from Phase 1)

Subagent-driven (SDD): per-task implementer + reviewer, review packages via `scripts/review-package`, Codex adversarial passes on the heaviest pieces (Tasks 5, 6, 7 minimum — derivation math is the new money code), consolidated fix waves on whole-branch findings, ledger at `.superpowers/sdd/progress-phase2.md` (new file; Phase 1 ledger is closed history). Implementer dispatches carry the sandbox/PATH/db exports from Global Constraints verbatim.
