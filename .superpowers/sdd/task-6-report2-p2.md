# Task 6 report (Phase 2): Aave scaled-balance deriver

**Status:** COMPLETE. Commit `7549e8a` — `feat: aave scaled-balance deriver with aToken collateral streams` (pathspec: `internal/derive/aave.go`, `internal/derive/aave_test.go`, `internal/derive/testdata/aave_*.json`).

**Gates:** `gofmt -l internal/derive/` empty; `go vet ./internal/derive/` clean; `go test ./internal/derive/ -run 'Aave' -v` → **18/18 PASS** pristine. Full-package `go test ./internal/derive/` fails only on the parallel debtmanager task's mid-flight, uncommitted files (`TestGoldenLiquidationVector` → missing `testdata/dm_golden_liq_ac5f3ce9.json`, their fixture not yet written); `go test ./internal/decode/ ./internal/store/ ./internal/chain/` all ok. Full `go test ./...` deferred to after the parallel task lands.

---

## 1. Mandatory source derivation — what the deployed source actually says

The brief's warning was justified **twice over**: not only are the aToken event
values not naive deltas, but the deployed implementations were **upgraded three
times mid-history**, and the current implementation is an **Aave v3.5-line
contract whose rounding is floor/ceil (TokenMath), not WadRayMath half-up**.
The plan prose ("WadRayMath half-up rayDiv/rayMul … implemented exactly") is
correct **only for blocks < 23088584**. A single-regime deriver of either
flavor would be wrong.

### 1.1 Implementation provenance (EIP-1967 + `Upgraded` logs)

All four aTokens share one implementation at every block; verified via the
EIP-1967 implementation slot (`0x360894a1…382bbc`) on all four proxies (cast,
publicnode) and `Upgraded` (topic0 `0xbc7cd75a…`) log history (Blockscout
`module=logs`) on the weETH aToken `0xbe1F842e…29db`, the USDC vToken
`0x9355032d…cdB7`, and the Pool proxy — all upgraded in the same governance
transactions:

| blocks | aToken impl | vToken impl | line |
|---|---|---|---|
| 20625519–22839361 | `0xaffa06528bd92625de2e7a0cfa0119319265ea4b` | `0xbb077daffeb23b2126e7358b0b122ba6838fb881` | v3.1/3.2 (compiler 0.8.19, `src/core/…` layout) |
| 22839362–23088583 | `0x80b0486a9d985f3ad918c9b1b1e19d724a1c99b7` | `0xb7cdaec5fc1855040df499b8ebe49ca9ac1bdd4b` | v3.4 (`aave-v3-origin-private`) |
| 23088584–24196551 | `0xaa7448de2be3ebdf9b5b0fa614accd119b3898bc` | `0x9e44ea10b070f6c8f02ccb7657e62d3a335756fb` | v3.5 (TokenMath) |
| 24196552– | `0xdc7b6b0acf2fb6927526e2c501de41eaeae8702a` | `0x1d5e86f59069c1af086607a56d2d7df6f440a5f2` | v3.5 (TokenMath) |

All eight token implementations are Blockscout-**verified**; sources fetched
via `eth.blockscout.com/api/v2/smart-contracts/<impl>` on 2026-07-23. The two
v3.5-line token impls are **byte-identical** in `ScaledBalanceTokenBase.sol`
and `TokenMath.sol` (diffed), so there are exactly **two fold regimes**,
switching at block **23088584** (upgrade tx `0xa17567fa…97dc`; verified that
none of the three upgrade txs carries any fold event — only
`Upgraded`+`Initialized` — so a block-level switch is exact).

Pool impls (for the debt-side call sites): genesis `0xf231d3e8…` (verified),
v3.4 `0x0ad7e5c1…` (verified), v3.5 `0x999c94f2…` and current `0x0f3bceb6…`
(both verified, fold-relevant call sites identical). **Caveat:** Pool impl
`0xbe82113a…` (blocks 24196552–24920566) is unverified on
Blockscout/Sourcify/Etherscan-v1; its semantics are pinned by (a) the verified
Pools sandwiching it with identical call sites, (b) its verified era-4 vToken
requiring TokenMath-scaled inputs (5-arg `mint(user,onBehalfOf,amount,scaledAmount,index)`),
and (c) the golden replay covering that window's action events (3 repays +
1 deficit/liquidation pair) bit-exactly.

### 1.2 Regime A (blocks < 23088584) — half-up rayDiv/rayMul inside the token

`WadRayMath.sol` (identical in both regime-A impls): `rayDiv` :104-112 =
`(a*RAY + b/2)/b` **half-up**; `rayMul` :64-72 = `(a*b + RAY/2)/RAY`.

aToken `ScaledBalanceTokenBase.sol` (impl `0xaffa0652…`; era-2 impl
`0x80b0486a…` line-shifted, formula-identical at :74/:85/:108/:119-126):

- `_mintScaled` :66-88 — `amountScaled = amount.rayDiv(index)` (:72);
  `Mint.Value = amount + balanceIncrease` (:83).
  → **scaled Δ = +rayDivHalfUp(Value − BalanceIncrease, index)**
- `_burnScaled` :99-120 — `amountScaled = amount.rayDiv(index)` (:100);
  interest > amount ⇒ **Mint** with `Value = balanceIncrease − amount`
  (:111-114) → **Δ = −rayDivHalfUp(BalanceIncrease − Value, index)**;
  else **Burn** with `Value = amount − balanceIncrease` (:116-118)
  → **Δ = −rayDivHalfUp(Value + BalanceIncrease, index)**
- `_transfer` :130-155 — moves `amount.rayDiv(index)` scaled (:142);
  pure-interest Mints `Value == BalanceIncrease` (:144-152; Δ=0, move carried
  by BalanceTransfer); ERC20 `Transfer` logs **nominal** (:154).
  `AToken.sol` :188 emits `BalanceTransfer(from, to, amount.rayDiv(index), index)`
  — **Value already scaled** (era-2 `AToken.sol` :206/:221 identical).

Debt: `VariableDebtToken.sol` genesis :64-74 (mint) / :77-84 (burn), era-2
:69-79/:83-89, route the Pool's **nominal** amount through the same half-up
`_mintScaled`/`_burnScaled`; every regime-A Pool passes the event amount
verbatim (genesis `BorrowLogic.sol` :127 / :221-225; `LiquidationLogic.sol`
:323-345 burn `actualDebtToLiquidate` = event `debtToCover`; v3.4
`BorrowLogic.sol` :73/:159, `LiquidationLogic.sol` :520-530).
→ **debt Δ = ±rayDivHalfUp(eventAmount, variableBorrowIndex)**.

### 1.3 Regime B (blocks ≥ 23088584) — TokenMath floor/ceil, Pool-computed scaled

`TokenMath.sol` (byte-identical across both v3.5 token impls and both
verified v3.5 Pools): `getATokenBalance` :66-71 = **rayMulFloor**;
`getVTokenBalance` :108-113 = **rayMulCeil**; `getVTokenMintScaledAmount`
:80-85 = **rayDivCeil**; `getVTokenBurnScaledAmount` :94-99 = **rayDivFloor**;
`getATokenMintScaledAmount` :24-29 = rayDivFloor; `getATokenBurnScaledAmount`
:38-43 / `getATokenTransferScaledAmount` :52-57 = rayDivCeil. `WadRayMath.sol`
`rayMulFloor` :74-83, `rayMulCeil` :85-95, `rayDivCeil` :114-123,
`rayDivFloor` :125-133.

**Debt** (Pool computes the scaled amount; event amounts are nominal):

- Borrow: `BorrowLogic.sol` (0x999c94f2) :55 → **Δ = +rayDivCeil(amount, vbIndex)**
- Repay: `BorrowLogic.sol` :181-183 → **Δ = −rayDivFloor(amount, vbIndex)**
- LiquidationCall: `LiquidationLogic.sol` :546-556 burns
  `(hasNoCollateralLeft ? borrowerReserveDebt : actualDebtToLiquidate)` with
  rayDivFloor; event `debtToCover = actualDebtToLiquidate` → unpaired fold
  **Δ = −rayDivFloor(debtToCover, vbIndex)**
- DeficitCreated: `LiquidationLogic.sol` :560-563, emitted **before** the
  tx-final LiquidationCall (:425-434) and **before** its own reserve's
  ReserveDataUpdated (:573); only after a burn of
  `borrowerReserveDebt = rayMulCeil(scaledDebt, index)` (:208). Since
  `rayDivFloor(rayMulCeil(s,i),i) == s` for every `i ≥ RAY`, that burn removes
  **exactly the whole scaled debt** (same for the bad-debt loop :671-709 over
  other reserves, which emits DeficitCreated with no LiquidationCall). Fold:
  **zero out the tracked scaled debt at DeficitCreated; a same-tx
  LiquidationCall for the same (user, debtAsset) folds Δ=0** (payload
  `deficit_paired=true`). Exact in both regimes (regime A uses the half-up
  round-trip identity `rayDivHalfUp(rayMulHalfUp(s,i),i) == s, i ≥ RAY`),
  order-robust, index-free — which also sidesteps the fact that DeficitCreated
  is the one action event NOT preceded by its reserve's same-tx index update.
  All 4 historical deficits verified same-tx-paired, deficit-first.

**Collateral — the events carry balance-derived nominal values; the scaled
delta is NOT computable from the event alone.** Current
`ScaledBalanceTokenBase.sol`: `_mintScaled` :69-92 takes `amountScaled`
directly; `Value = bal(s+a, i) − bal(s, p)` (:79, :87-89) and
`BalanceIncrease = bal(s, i) − bal(s, p)` (:81) where `bal = rayMulFloor` and
`p` is the account's stored index checkpoint. The p-dependence cancels:

> **Mint:** `bal(s', i) = rayMulFloor(s, i) + Value − BalanceIncrease`
> **Burn:** `bal(s', i) = rayMulFloor(s, i) − Value − BalanceIncrease`
> (`_burnScaled` :105-134, Burn branch :127-130; the interest-exceeds branch
> emits Mint :123-126 and lands under the Mint identity with `s' < s`)
> then **`s' = ceil(N·RAY / i)`** — the *unique* integer with
> `rayMulFloor(s', i) = N` whenever `i ≥ RAY` (each scaled wei moves the floor
> balance by ≥ 1); recovery re-verified in code, mismatch = loud error.

This one inversion covers **all three Mint emission paths** (supply mint;
withdrawal-with-interest-exceeding mint; transfer-accrual mint, where
`Value == BalanceIncrease` ⇒ `s' = s`, Δ=0) and every call site (supply,
withdraw, liquidation collateral burn, `repayWithATokens`' aToken burn,
`mintToTreasury`, deficit elimination) without branching on the action.
`AToken.sol` (current) `_transfer` :279-311: ERC20 `Transfer` nominal (:309,
record-only), `BalanceTransfer` **scaled** (:310), accrual Mints :299-307.

BalanceTransfer.Value is already scaled in **both** regimes → applied exactly
once: Seq 0 = −from, Seq 1 = +to.

### 1.4 Pre-flight empirical validation (before any Go was written)

The regime-B inversion was validated bit-exact in Python against the real
liquidation tx `0x7714dcf7…c09d` (block 25334454): seeded with archive
`scaledBalanceOf` @25334453 (`0x2ec19e98…` = 474254493198165, treasury
`0x464c71f6…` = 385079122245736975), the Burn inversion recovers scaled
−471570033802703 and the BalanceTransfer moves 2684459395462, landing both
accounts exactly on their @25334454 views (0 and 385081806705132437). The
regime-A half-up mint formula was validated on the treasury accrual mint at
block 22839768: `rayDivHalfUp(26342566995, idx) = 26342510857` = the on-chain
balance diff, where floor gives …856 — a genuinely rounding-sensitive case.

## 2. Implementation (`internal/derive/aave.go`, 714 lines)

`AaveEngine` (constructor `NewAaveEngine`) implements the frozen
`derive.Engine`. Stateful: cached latest `ReserveDataUpdated` per reserve
(vb + liquidity index), tracked scaled debt and collateral per
(reserve, account), same-tx deficit markers (reset on tx-hash change; a tx's
logs are contiguous in (block, logIndex) order). Must be fed the engine's
streams merged in (block, logIndex) order from genesis 20625519.

- Exact WadRayMath primitives: `rayDivHalfUp`, `rayDivFloor`, `rayDivCeil`,
  `rayMulHalfUp`, `rayMulFloor`, `rayMulCeil` (all `aave`/`ray`-prefixed to
  avoid colliding with the parallel debtmanager task's helpers).
- **Loud errors:** action event with no cached index ("no cached
  ReserveDataUpdated"); `interestRateMode != 2`; index < RAY; inversion
  failure; any fold that would take a tracked balance negative;
  DeficitCreated with no tracked debt; aToken event from an address outside
  the four pinned aTokens; unhandled decoded event type (registry drift).
- **Record-only** (Side "", Delta nil): aToken ERC20 `Transfer`, Pool
  `Supply`/`Withdraw` (collateral truth comes exclusively from the aToken
  streams), `ReserveDataUpdated`.
- **rate_indexes:** each RDU emits EventType `aave_reserve_data_updated` with
  Asset = reserve and Payload keys `variable_borrow_index` /
  `liquidity_index` (decimal strings) — exactly the
  `store.SaveRateIndex(engine, asset, blockNumber, kind, value)` tuple set
  for the Task-7 runner.
- **Seq:** 0 for every event except `ATokenBalanceTransfer`, which fans out
  Seq 0 (−sender) / Seq 1 (+recipient) — documented in the package comment.
- aToken→reserve map pinned from `getReserveTokensAddresses` on the data
  provider `0x7c850959…` (code-verified 2026-07-23).
- Balances are stored SCALED (Side `debt` / `collateral`).

## 3. Fixture provenance (committed under `internal/derive/testdata/`)

- `aave_pool_logs.json` (584 logs, 460 KB): complete
  Borrow(138)/Repay(103)/LiquidationCall(25)/DeficitCreated(4) history of
  Pool `0x0AA97c28…` from market genesis 20625519 through pin 25593800, plus
  all 314 ReserveDataUpdated logs of those same action txs (each action's own
  tx emits its RDU first; action-free supply/withdraw RDUs omitted by
  design). Discovered via Blockscout per-topic0 (counts cross-checked), then
  **re-fetched from primary source via `eth_getTransactionReceipt`**
  (publicnode/drpc, 2026-07-23) — committed bytes are the receipt bytes.
- `aave_atoken_weeth_logs.json` (757 logs, 495 KB): complete all-topic log
  history of aEthEtherFiweETH `0xbe1F842e…` for the same range, including
  decode-skipped Approval/Upgraded/Initialized logs (stream fidelity).
  Receipt-refetched; the receipt-derived (tx, logIndex, topics, data) set
  verified **byte-identical** to the independent Blockscout capture.
- Both docs carry a `provenance` string, `chainId`, and shared
  `pinBlock: 25593800`.

## 4. Golden proof (pin block 25593800, views via cast on eth.drpc.org, 2026-07-23)

`TestAaveGoldenFullHistoryReplay` merges both fixtures, sorts by
(block, logIndex), decodes via the frozen `decode.Registry`, folds through
`AaveEngine`, and accumulates **only the returned PositionEvents** (never
peeking at engine internals):

| Borrower | View @25593800 | Derived | Verdict |
|---|---|---|---|
| `0x70daaac4…e5fe` | vUSDC `scaledBalanceOf` = 125415 (currentVariableDebt 137184) | 125415 | **exact** |
| `0x70daaac4…e5fe` | aWeETH `scaledBalanceOf` = 58420665095130 | 58420665095130 | **exact** |
| `0xe649a394…812a` | vPYUSD `scaledBalanceOf` = 83 (currentVariableDebt 84) | 83 | **exact** |
| `0xe649a394…812a` | aWeETH `scaledBalanceOf` = 7045575913579 | 7045575913579 | **exact** |

(Borrower 2's debt reserve is **PYUSD**, not USDC — discovered from its
Borrow log; vToken `0xD2cf07dE…`.) The replay additionally asserts the
lifetime borrow count (138), the deficit write-offs landing exactly at zero
for both liquidated borrowers, and no negative balance anywhere. The history
spans both regimes (all borrows regime A; 9 repays / 3 liquidations / 3
deficits regime B, including the unverified-Pool window) — bit-exact
agreement is the empirical seal on the era-dependent semantics.

## 5. Test inventory (18, all PASS)

Ray math incl. exact-.5 boundaries and round-trip identities; RDU record
event + payload kinds + sub-RAY error; missing-index error; non-variable-mode
error; borrow/repay/liquidation regime-rounding pairs (2.25/2.75-scaled cases
where half-up, floor, ceil all differ); repay/balance-transfer overdraw
errors; deficit zero-out + same-tx pairing + no-cross-tx leak + double-deficit
error; pure-interest Mint (real log, Δ=0); regime-A treasury accrual Mint
(real log, half-up≠floor); regime-A three-branch synthetic Mint/Burn;
**mandatory tx-grouped pair test** (real logs 233/234 = one burn, 236/237 =
one transfer, archive-seeded, archive-asserted, no double-apply); unknown
aToken error; golden full-history replay; byte-identical replay determinism.

## 6. Concerns / notes for downstream tasks

1. **Pool impl `0xbe82113a…` unverified** (see §1.1) — semantics pinned by
   sandwich + vToken interface + golden coverage; revisit if it ever verifies.
2. **The runner must merge all five aave_v3_etherfi streams into one
   (block, logIndex)-ordered feed from genesis** — the collateral inversion
   and deficit zero-out are exact only against complete tracked state; the
   engine has no persistence of its internal state (a restart requires replay
   from genesis, consistent with the store's rewind-rebuild model).
3. Only the weETH aToken stream is golden-fixtured; the USDC/PYUSD/FRAX
   aToken streams fold identically in production but have no committed
   full-history fixture (debt is Pool-log-exact regardless).
4. Future implementation upgrades will silently change fold semantics again;
   the `Upgraded` logs are visible in-stream (decode-skipped). A monitoring
   task should alert on new Upgraded events on any of the six proxies.
5. Full-tree `go test ./...` pending the parallel debtmanager task's commit
   (their uncommitted WIP currently fails on a missing dm_ fixture).
