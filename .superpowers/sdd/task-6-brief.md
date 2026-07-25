### Task 6: Aave deriver (debt Pool-exact + aToken collateral)

**Files:** Create `internal/derive/aave.go`, `internal/derive/aave_test.go`.

**Semantics (normative: recon "Aave derivation model"; aToken fold semantics CORRECTED per Codex decode review, session 019f8d84-3de0-7cd3-8bd4-d68169259368):** WadRayMath half-up rayDiv/rayMul (implement exactly); scaled debt += rayDiv(amount, variableBorrowIndex) on Borrow, −= on Repay/LiquidationCall(debtToCover)/DeficitCreated; index from same-tx ReserveDataUpdated (emitted BEFORE the action event — deriver caches latest ReserveDataUpdated per reserve within the stream); writes rate_indexes (variable_borrow_index, liquidity_index).

**aToken collateral — the events are OVERLAPPING VIEWS, not independent deltas** (proven from committed fixture tx 0x7714…09d: Transfer+BalanceTransfer logs 236/237 are ONE peer transfer; Transfer+Burn 233/234 are ONE burn; Mint.Value INCLUDES BalanceIncrease — the first Mint fixture has Value == BalanceIncrease, i.e. pure interest accrual, zero new principal):
- ERC20 `Transfer` = RECORD-ONLY, never folded (nominal units, always paired with the authoritative event).
- `BalanceTransfer.Value` (already scaled) applied EXACTLY ONCE per peer transfer: −from, +to.
- `Mint`/`Burn` scaled deltas derived from the DEPLOYED aToken implementation's source (ScaledBalanceTokenBase lineage): a mandatory step reads the verified source of the committed aToken implementation and pins the exact (Value, BalanceIncrease, index) → scaled-delta formula with the implementation's own rounding — do NOT trust this plan's prose or Codex's sketch; derive from source, then validate against scaledBalanceOf.
- MANDATORY tests: transaction-grouped fixtures proving paired logs are not double-applied (the 236/237 and 233/234 pairs verbatim), the Value==BalanceIncrease pure-interest Mint case, and golden scaledBalanceOf cross-checks.
Balances stored SCALED (side collateral/debt, source event).

**Golden tests:** full-history replay of the dormant market (138 borrows lifetime) from committed fixtures; assert the two recon golden borrowers' derived-at-head values against `getUserReserveData`/`scaledBalanceOf` view calls captured during fixture generation (block + values in provenance comments). Rounding edges: half-up at exact .5 ray boundaries. Commit: `feat: aave scaled-balance deriver with aToken collateral streams` (pathspec).

---

