# Task 0 execution log — derivation-semantics & oracle recon

Date: 2026-07-22. Head blocks pinned during run: OP 154,587,841 (mainnet.optimism.io), ETH 25,592,490 (publicnode).

## Step 1 — event semantics from source

- `grep -n "event Borrowed|..."` over `recon/cash-v3/src` → all eight events declared in
  `src/debt-manager/DebtManagerStorageContract.sol` (lines 149/157/166/177/232/240/263/271).
- Emit sites (grep `emit <Name>`): Supplied DebtManagerCore.sol:423, WithdrawBorrowToken :451,
  Borrowed :481, Liquidated :584, Repaid :602, InterestIndexUpdated DebtManagerStorageContract.sol:548.
- **`UserInterestAdded` and `TotalBorrowingUpdated` have NO emit sites anywhere in the clone**
  (grep over whole repo returned only declarations). Recorded as scope contradiction.
- Read bodies: `supply()` :408-424, `withdrawBorrowToken()` :432-452, `borrow()` :461-482,
  `repay()` :491-512, `_repayWithBorrowToken()` :595-603, `liquidate()`/`_liquidateUser()`/`_liquidate()`
  :521-585, `_updateInterestIndex()` DebtManagerStorageContract.sol:540-551, `getCurrentIndex()` :559-567,
  `_getActualBorrowAmount()` :520-522, `_getNormalizedAmount()` :530-532, `borrowingOf()` :575-615,
  `convertCollateralTokenToUsd()` DebtManagerCore.sol:375-379, `convertUsdToCollateralToken()`
  DebtManagerStorageContract.sol:498-502, `_setBorrowTokenConfig()` DebtManagerAdmin.sol:174-183
  (initial index = PRECISION = 1e18), `_setBorrowApy()` DebtManagerAdmin.sol:190-199 (reindexes before APY change).
- topic0 hashes computed with `cast keccak` (recorded in derivation-notes.md).

## Step 2 — empirical validation (adapted: local raw_logs was EMPTY)

- `docker compose exec db psql -U solvent` → `raw_logs` exists but has **0 rows**; `ingest_cursors`
  empty; `goose_db_version` rows timestamped 2026-07-22 02:23 → the db volume was recreated fresh
  today; Phase 1 backfill data is gone. Adaptation per brief's escape hatch: validated against
  event history fetched directly from RPC (`cast logs`), which is the same byte-identical evidence
  raw_logs would contain. Task 9's backfill re-populates the db.
- Deployment block check: `cast code 0x0078C5..53 --block 149521227` → `0x`; at 149521228 → code
  present. Config startBlock == proxy deployment block, so RPC history from 149,521,228 is complete.
- Fetched full-history logs from mainnet.optimism.io in 1,000,000-block chunks (drpc timed out on
  getLogs; publicnode returned silent empties on old ETH ranges — noted): Borrowed 305,045 logs,
  all with token = OP USDC. Repaid/Liquidated fetched the same way (counts in notes).
- Failures/retries: full-range (5.07M-block) getLogs timed out at 120s; optimism.drpc.org timed out
  even on 1M chunks; mainnet.optimism.io served all chunks (~90s each, no retries needed).
- Repaid/Liquidated coverage was completed to a pinned comparison block PIN=154,021,227 (chunk
  boundary) rather than the borrowed head — later chunks kept stalling on throttled RPCs and are
  unnecessary when the view calls are pinned at PIN. Repaid: 22,729 logs; Liquidated: 763 logs.
- Index derivation for the hand-sum: per borrower-event block, queried InterestIndexUpdated(USDC)
  logs at exactly that block (index is a pure function of block.timestamp, and OP timestamps are
  strictly increasing, so any IIU in the block gives the tx-time snapshot). All 154 needed blocks
  contained exactly one IIU(USDC) — invariant empirically confirmed, zero missing, zero RPC fails.
- Arithmetic done in a throwaway Go program (big.Int mulDiv with the exact Ceil/Floor rounding from
  source); replay formula embedded in derivation-notes.md.
- RESULT: all three borrowers match `borrowingOf(user, USDC)` at PIN bit-exactly
  (1,004,681 / 4,154,797,137 / 7,457,111). Naive Σ(B−R) is wrong for all three.
- MIGRATION DISCOVERY: liquidated Safe 0xac5f3ce9…5fcc had zero Borrowed events; binary search over
  archive `borrowingOf` found debt appearing at 149,985,787, whose only DM log is
  MigrationBorrowerPositionsSet (topic0 0x3f1c4431…, openchain-resolved; emitted by a superseded
  implementation — proxy Upgraded twice on day 1). Full scan: 80 batches, 7,337 positions, blocks
  149,985,513–149,986,254, delivered via LayerZero commitAndExecute with (address,uint256)[] user
  amounts in calldata. Borrower screening therefore added: borrowingOf==0 at 149,986,254 and at
  (first borrow − 1). First-pick borrowers all failed the screen (migrated); one candidate carried
  exactly 1 wei of migrated normalized dust.
- Liquidation decrement validated per-event on the migrated Safe at block 151,731,530 (hex-conversion
  slip on first attempt — 0x90B3D4A mis-read as 151,600,458, corrected with cast to-dec): view
  before=31,690,519=event beforeDebtAmount; view after=15,845,260 which naive subtraction misses by
  1 wei and the normalized replay reproduces exactly.
- Other failures/retries: optimism.drpc.org timed out on all large getLogs; publicnode returned
  silent empty results for old ETH ranges and timed out on recent ones; mainnet.optimism.io was
  throttled intermittently (fail/retry visible in chunk logs) — handled with per-call timeouts, RPC
  rotation, chunk resume. Local raw_logs being empty was worked around entirely via RPC fetches.

## Step 3 — asset sets

- `getCollateralTokens()` → 20 addresses; `getBorrowTokens()` → 8 (subset of collateral set);
  `getReservesList()` on 0x0AA97c28..F3c0 → 4 reserves (weETH, USDC, PYUSD, FRAX).
- symbol()/decimals()/`cast code | cut -c1-20` verified for every address on its chain (all non-empty).
- Note: 0xE5d3854..A6a and 0xca5921D..898 both report symbol `liquidRESERVE`, same name
  ("Ether.Fi Liquid Reserve") and share one oracle — recorded distinctly by address.

## Step 4 — oracle wiring

- OP price provider from deployments/mainnet/10/deployments.json: 0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB.
  Probe `isBaseAsset(address)` succeeds → PriceProviderV2 layout. `decimals()` = 6.
  `price(USDC)` = 1000000 exactly (stable snap live-confirmed). tokenConfig(token) decoded for all
  20 tokens with the V2 tuple `(address,bytes,bool,uint8,uint24,uint8,bool,address)`.
- Aave: `getSourceOfAsset` per reserve → 4 "Capped ..." adapters; `aggregator()` reverts on them
  (they are Aave price-cap adapters, not aggregator proxies). Underlying feeds resolved via
  `BASE_TO_USD_AGGREGATOR()`/`RATIO_PROVIDER()` (weETH) and `ASSET_TO_USD_AGGREGATOR()` (stables),
  then proxy→`aggregator()` for the raw AnswerUpdated emitters; `decimals()` = 8 on all four.
- startBlock per raw aggregator: `getRoundData(1)` → first-round updatedAt ts → `cast find-block ts`
  → confirmed by fetching AnswerUpdated (topic0 0x0559884f…) in a ±100-block window on eth.drpc.org
  and taking the first log's block. All four find-block estimates matched the first log block exactly.

## Step 5/6 — deliverables & commit

- recon/feeds.json written (24 asset entries; op=poll via PriceProviderV2 `price(address)` 6-dec,
  eth=chainlink_stream on the four raw aggregators, all startBlocks log-confirmed; jq-validated,
  zero placeholders). recon/derivation-notes.md written per the brief's structure.
- Commit was BLOCKED by the pre-commit scope gate, contradicting the brief's "will pass": the
  active claim roadmap/claims/CLAIM-claude-integrator.md (issued 2026-07-23T02:02:56Z) predated the
  controller's ae2b9a5 "chore(roadmap): add recon deliverables to W1 scope" (19:19:55-07:00) — W1's
  charter contains both recon paths, the claim snapshot didn't. Remedied with the repo's own
  sanctioned tool: `python roadmap/tools/claim.py rescope claude-integrator` (no --path → re-syncs
  allowed_paths verbatim from the committed W1 charter), committed as db4b926, then the deliverable
  commit d779971 "docs: Phase 2 recon — event semantics, asset registry, oracle wiring" containing
  exactly the two files (661 insertions). Gate output OK on both; no index.lock contention hit.
