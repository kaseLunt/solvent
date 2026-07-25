### Task 5: Debt Manager debt deriver (normalized model + genesis)

**Files:** Create `internal/derive/engine.go` (shared interface), `internal/derive/debtmanager.go`, `internal/derive/debtmanager_test.go`.

**Interfaces:**
- `derive.Engine` = `{ Name() string; Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error) }`.
- `derive.NewDebtManager(chain DMChainReads) *DebtManager` where `DMChainReads` = minimal interface for the one chain read the deriver needs (migration-tx calldata fetch). Prices are NOT needed: 100% of historical borrows are USDC stable-snapped; NON-USDC borrows error loudly per recon caveat 1: `"non-stable borrow token %s requires oracle-priced derivation - not yet supported"`.

**Semantics (normative: recon "Debt Manager event semantics" + "Debt identity validation"):**
- Maintains per-token current index from DMInterestIndexUpdated (runner persists SaveRateIndex on these).
- Borrowed → `+ceil(usd*1e18/idx)` (usd = amount for USDC); Repaid → `-floor(usd*1e18/idx)`; Liquidated → `-floor(debtAmountLiquidated*1e18/idx)` debt event + one record-only event per collateral tuple element (seq-indexed) + the 1-wei residue rule: second Liquidated in same tx leaving normalized ≤ 1 wei → emit an extra `residue_zeroed` event with delta = −remaining (deriver tracks running normalized per account via a warm cache seeded from BalancesFor on first touch).
- MigrationBorrowerPositionsSet → fetch tx calldata via DMChainReads, DecodeMigrationCalldata, emit one `migration_genesis` debt event PER SEED (seq 0..N-1) with delta = NormalizedAmount (already normalized — no index division). REQUIRED CHECK (Codex decode review): the event's `Count` field must equal len(decoded seeds) — mismatch is an error, never partial persistence. Step 0 of this task: sweep ALL 80 migration txs' selectors + calldata through the (hardened) decoder, assert Σ seeds = 7,337 and per-log Count agreement, before any derivation runs.
- Supplied/WithdrawBorrowToken/config events → record-only (Side "", nil Delta).

**Golden tests (recon's validation table is the fixture):** replay the three validated borrowers' exact event sequences (fixtures committed as testdata) and assert final normalized == recon's net-normalized values (963,813 / 3,985,789,485 / 7,153,773) and derived-at-PIN == borrowingOf values (1,004,681 / 4,154,797,137 / 7,457,111 with currentIndex 1042402553573226850); the liquidation vector (0xac5f3ce9... @ 151,731,530: removed 15,289,230 normalized, view 15,845,260). Unit tests per event type + rounding-mode edges (ceil vs floor at exact division). Commit: `feat: debt-manager normalized-debt deriver with migration genesis` (pathspec).

---

