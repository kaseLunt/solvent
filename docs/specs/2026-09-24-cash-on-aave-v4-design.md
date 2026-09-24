# Cash on Aave V4: the third engine (design)

- **Date:** 2026-09-24. Revision 4 folds in Codex adversarial rounds 1 and 2, plus an independent stand-in round 3.
  Codex round 3 was cut off by a usage limit and is still owed; see §13.
- **Owner direction:**
  - "ok yes we need to update everything, go ahead with the v4 engine" (2026-09-24).
  - On the approach question (A: event-sourced; B: pinned state plus our own exact math; C: trust the chain's getter):
    "I'll go with your recommendations".
    - So the approach is **B**.
    - The recommended defaults come with it: V4 becomes "Cash"; the Debt Manager is shown as "migrating", beside V4 and
      never summed with it; the legacy Aave v3 engine stays, polled slowly.
- **Path:** architectural. This is a new engine subsystem across ingest, a new sweeper, risk math, riskd, the API
  contract, the client, the web app and reconcile.
- **Companion spec:** `docs/specs/2026-09-24-go-live-design.md` (hosting and launch).
- **Evidence base** (committed with this spec):
  - `.superpowers/sdd/2026-09-24-aave-v4/research/`: four briefs covering V4 protocol math from the deployed source, the
    ether.fi instance, Solvent's seams, and hosting.
  - `.superpowers/sdd/2026-09-24-aave-v4/understand/`: six code-reader reports with path:line evidence.
  - `.superpowers/sdd/2026-09-24-aave-v4/replica/`: the Python integer replica that matched the chain.

## 1. Problem

**Where Cash lives now.** ether.fi Cash's credit backend is a dedicated Aave V4 instance on OP Mainnet:
- Hub `0x66753c4e3fC84f1eD0e3C267C927284E9d90C572`;
- Cash Spoke `0xdffcC3536D932eb51Df51a7F5FA407c4270d5308`, deployed at block 154,915,790 on 2026-07-30 and announced
  2026-08-13.

At OP block 157,337,765 the V4 Cash book holds **$32.94M** of debt (USDC $31.87M, WETH $1.07M) against about $301M
supplied.

**The Debt Manager is draining.** The Debt Manager, which Solvent's "Cash" watches today, has fallen from **$22.6M to
$4.49M**.
- Owners move through `DebtManager.migrateToLendGateway(safe)`, one Safe per transaction.
- The big waves were Aug 18 and Aug 21, and about 440 Safes a day still move.

**The product watches the wrong book.** Every "Cash" figure on the site is the draining remainder. Every "right now" is
about a book that is no longer where the risk is.

## 2. Approach (B) and why

**How B works:**
1. The engine reads only V4's **low-volume** events, to learn *who* borrows.
2. Once per **generation**, a sweeper in the indexer reads, all at one hash-pinned OP block P:
   - every borrower's raw position;
   - the hub's asset state;
   - the reserve configs;
   - the oracle's prices;
   - the chain's own `getUserAccountData`;
   - the deployed implementation identities.
3. riskd, which makes no RPC calls, recomputes every account in exact integers from those stored inputs.
4. riskd **welds** each result to the chain's own answer.
5. A per-generation **completeness ring** proves the borrower registry holds every account with debt.

**Rejected: A, event-sourced like the other two engines.**
- V4 emits about 280k logs a day, about 35 times the Debt Manager's pre-migration volume. About 90% of them are
  card-spend `Withdraw`/`Remove`/`UpdateAsset`/`RefreshAllUserDynamicConfig`.
- The supply exchange rate and the prices are not evented at all.
- The costs: about 100 GB a year, an O(all events) balance rebuild on every OP reorg, and RPC well past the free tiers.

**Rejected: C, trusting the chain's getter.**
- It drops Solvent's defining property: our own exact math, proven against the chain.
- It leaves stress scenarios with no engine to run on, because the chain cannot answer "what if ETH −30%".

**What B changes about the claims.** V4's *inputs* are chain state read at P, not balances folded from events, so the
proof is different. At every generation it proves two things:
1. that **our replica of Aave V4's account math is exact**, per account;
2. that **the registry holds every borrower**, per reserve.

It does **not** prove liquidation behavior or debt-discovery semantics. Those are bound to the reviewed implementation
code (§5.3, §5.5), so an upgrade refuses the engine instead of silently changing meaning. This is recorded as a
proposed Decision (§11) because it departs from the event-sourced custody pattern.

## 3. Facts the design stands on (verified; see the research briefs)

**Source identity.** The deployed Hub, Spoke, LiquidationLogic, AaveOracle and IR strategy (132 verified files) are
byte-identical to `aave/aave-v4` tag **v0.5.11**, plus one ether.fi borrow gate: `EtherFiSpokeInstance` requires
`isEtherFiSafe(onBehalfOf)`.

**The replica already works.**
- An integer replica matched `getUserAccountData` on **all 7 fields** for 3 live borrowers at block 157,337,755, with
  88/88 per-reserve checks.
- It replayed **4 real liquidations** exactly.
- Codex re-derived the formulas from the deployed source and confirmed:
  - the HF floor and RAY debt;
  - the hub-wide supplied-asset conversion;
  - the stored-rate linear accrual;
  - per-user config keys;
  - the bonus curve, dust branches and fee.

**Five V4 laws a v3 port gets wrong** (each is a pinned test, §9):
1. **One collateral factor.** It serves both borrowing and liquidation, and borrowing is allowed down to HF 1.0.
2. **HF** = `floor(W·1e14·RAY / DR)`.
   - W = Σ(value·CF), counting only reserves with collateral bit, CF > 0 and shares > 0.
   - DR is the debt value at RAY precision, never rounded.
   - There is a single floor.
3. **Collateral is shares.** `assets = floor(sh·(TA+1e6)/(addedShares+1e6))`, where TA is hub-wide.
4. **Linear interest between accruals.** `idx(t) = ceil(idx·(RAY + rate·dt/YEAR)/RAY)`, using the *stored* `drawnRate`.
5. **Per-user dynamic config keys.** They decide each account's CF and bonus.
   - The curator edits key 0 in place; there have been 30 in-place updates so far.
   - eUSD has key 1 with CF 0.

**Parameters that are off today.**
- The risk premium is structurally 0: collateral risk and the threshold are 0 on every reserve.
- There have been 0 deficits so far.
- Both paths are implemented anyway and proven on a fork (§9).

**Liquidation rules:**
- A position is liquidatable at HF < 1.0 (strict), judged with the user's snapshot keys.
- There is no close factor. The debt-to-cover computation **aims at** target HF **1.24**, but that is not a guaranteed
  outcome: dust, collateral exhaustion and the caller's `debtToCover` all constrain it.
- A bonus curve runs from `minLB` to `maxLB`, reaching `maxLB` at HF ≤ 0.90 (bonus factor 90%).
- A $1,000 dust rule applies.
- Same-reserve liquidation is allowed.
- A 10% liquidation fee is taken from the bonus.
- A deficit is written off when collateral is exhausted.

**Oracle:**
- Keyed by reserveId, 8 decimals.
- It reads `latestAnswer()` with **no staleness check and no stable snap**.
- Only the adapter's *output* is observable.
- A price ≤ 0 reverts every view.

**Positions** are keyed by the **Cash Safe**: `user` is topic3; `caller` (topic2) is always LendGateway `0x01F8…03F4`.

**Migration.** A migration's spoke `Borrow` re-homes existing Debt Manager debt. The Debt Manager emits
`MigratedToLendGateway(safe, debtUsd)` in the same transaction.

**Debt conservation holds in the deployed source** (Codex, §13):
- Borrow adds the hub-returned shares to the user.
- Repay, liquidation and deficit remove matching shares.
- Fee and treasury transfers move *added* shares, not drawn shares.
- No path creates debt without a `Borrow`.

## 4. Architecture

```
OP chain ─┬─ walker: op:v4-cash (Spoke + Hub + Oracle; topic0 allowlist) ─► raw_logs ─► V4 deriver ─► borrower registry,
          │                                                                               candidate ledger,
          │                                                                               activity (position_events),
          │                                                                               params timeline
          └─ V4 sweeper (indexer) ── eth_call / eth_getStorageAt @ blockHash(P) ──► v4 generation tables
                                                                                        (sealed | abandoned | superseded)
riskd (zero-RPC) ── latest sealed generation ── ComputeV4Health (exact) ─┬─► weld vs stored getUserAccountData
                                                                         ├─► completeness ring (every reserve)
                                                                         └─► risk_positions / legs / aggregates (aave_v4_cash)
api ── engine enum + explicit V4 arms ── /v1/* ── @solvent/client ── web (Cash = V4)
reconcile ── V4 gate at a sealed generation's pinned hash ── artifact + receipt
```

## 5. Components

Each unit below states its purpose, interface and dependencies. The file locations are where the understand reports
found the seams. The implementation plan pins the exact edits.

### 5.1 One topic-filtered V4 stream (ingest)

**Purpose:** fetch only the V4 logs the engine uses, with an **honest custody claim**. It also uses the fewest walkers,
because each advancing walker costs about six RPC reads a round even when its filtered result is empty.

**Config changes** (`internal/config/config.go`):
- `fileStream` gains `topic0s`.
- `Load` switches to `DisallowUnknownFields`, so a misspelled key can no longer silently fetch every log.
- `topic0s` and multi-address dispatch are allowed **only** on `aave_v4_cash`. This keeps the Debt Manager, v3 and
  Chainlink "complete custody" arguments true: `collateralflags.go:10-17`, `assemble.go:641-653`,
  `risk.go:815-818`, `heartbeat_scan.go`.
- Entries are 32-byte hex, deduplicated and sorted.
- No address may appear in two streams on the same chain.
- `KnownEngines` gains `aave_v4_cash`.

**Walker changes:**
- `WalkerConfig.Topic0s` is threaded into `LogsFromTimed` as `Topics: [][]common.Hash{topic0s}`.
- A **per-log gate** rejects any log whose topic0 is outside the allowlist, in case a provider ignores the filter.
- The coherent-window checks (`walker.go:797-895`) hold unchanged.

**Custody fingerprint:**
- `ingest_cursors.filter_fingerprint = sha256("stream-filter/v1;chain;sorted addrs;sorted topic0s|*")`, backfilled for
  existing rows.
- It is enforced in `Cursor`, `SaveBatch` and `Step`. A mismatch is a typed refusal, so a changed filter can never
  silently extend old custody.
- For filtered streams only, `CoverageBindingOf` takes the topics under a v2 prefix. Existing bindings hash
  byte-identically.

**The stream.** `op:v4-cash` covers the Spoke `0xdffc…5308`, the Hub `0x6675…C572` and the Oracle `0xe8cb…6fA8`. It
starts at block 154,915,786, with window 2000 and 5 confirmations. Its topic0 allowlist is:

| Contract | Events |
|---|---|
| Spoke, user events | `Borrow`, `Repay`, `LiquidationCall`, `ReportDeficit`, `SetUsingAsCollateral`, `UpdateUserRiskPremium`, `RefreshPremiumDebt` |
| Spoke, config | `AddReserve`, `UpdateReserveConfig`, `UpdateReservePriceSource`, `AddDynamicReserveConfig`, `UpdateDynamicReserveConfig`, `UpdateLiquidationConfig`, `UpdatePositionManager` |
| Hub | `AddAsset`, `UpdateAssetConfig`, `AddSpoke`, `UpdateSpokeConfig` |
| Oracle | `UpdateReserveSource`, `SetSpoke` |
| Both proxies | `Upgraded` |

**Left out on purpose:** `Supply`, `Withdraw`, `RefreshAll/SingleUserDynamicConfig`, `SetUserPositionManager`, and hub
`UpdateAsset/Add/Remove/Draw/Restore`. Together they are about 95% of V4's volume.

### 5.2 Decode and the V4 deriver

**ABIs** come from the **deployed** implementations, embedded under `internal/decode/abis/`:
- Spoke `0xA1f7…3b68`;
- Hub `0x697a…2cE9`;
- Oracle `0xe8cb…6fA8`.

`engineTopics` gains the V4 table.

**Decoder revisions become per engine** (panel R3-C1).
- Today `RegistryRevision` is one global constant, stamped on every engine's derive windows (`runner.go:466-472`).
- A change of revision restarts that engine's coverage at head (`derive.go:362-376`). A global bump for the new V4 table
  would therefore silently fail the v3 flag-custody gate, which needs genesis coverage (`assemble.go:507-511`), and
  refuse the whole legacy book.
- The fix: the runner stamps an **engine→revision map**. Existing engines keep their current value, and only
  `aave_v4_cash` starts its own.
- A test deploys the new binary onto a database built by the old one and asserts that `aaveFlagCustodyProven` stays
  true and Debt Manager coverage is unchanged.

**Dispatch is on (address, topic0).** The Hub and Spoke both emit `Upgraded`, and `decode.go:262-273` is address-blind
today. A test asserts every allowlisted (address, topic0) is registered, and the reverse.

**Outputs:**
1. **Borrower registry.** Every account (Safe) that ever emitted `Borrow`, with its first and last event block. This
   discovery rule is sound under the conservation result in §3.
2. **Candidate ledger.** Per (account, reserve), which reserves the sweeper reads first:
   - the latest collateral flag (from `SetUsingAsCollateral`);
   - whether the account has ever borrowed that reserve;
   - liquidation touches.
3. **Activity.** `position_events` rows with `engine='aave_v4_cash'` and a non-empty account. Raw types map to the
   existing display classes:

   | Raw type | Display class |
   |---|---|
   | `v4_borrow` | borrow |
   | `v4_repay` | repay |
   | `v4_liquidation_call` | liquidation |
   | `v4_report_deficit` | bad_debt |
   | `v4_collateral_enabled` / `_disabled` | collateral_flag |

   Amounts are the events' own token amounts. The delta fold is unused.
4. **Params timeline.** Dynamic configs keyed by **(reserve, key)** in log order, plus reserve and liquidation configs,
   price-source changes, hub caps and `Upgraded` rows. **These are for display only.** The math reads the pinned
   configs.

**Migration evidence is read from custody, not derived** (panel R3-C1, R3-C5).
- **Where the logs come from.** The Debt Manager **decoder and derived state are untouched**. `MigratedToLendGateway`
  logs (Debt Manager proxy `0x0078…9553`, topic0 `0x4836b2e4…`) are read **directly from `raw_logs`**. The address-only
  Debt Manager stream already holds them, custody-complete up to its ingest cursor. Changing the decoder instead would
  need an owner-gated Debt Manager rewind that wipes collateral and sweep state (`derive.go:617-660`).
- **Verification.** Plan task 1 checks with a read-only `raw_logs` count that the proxy itself emits the event.
- **`moved_from` is decided at read time and has three values:**
  - `debt_manager`: a `MigratedToLendGateway` for the same (chain, tx_hash, Safe) exists;
  - `none`: no such log exists, and the Debt Manager ingest cursor is at or past the row's block;
  - `pending`: the Debt Manager ingest cursor has not reached the row's block yet.

  V4 derivation never depends on the Debt Manager's cursor, and a re-home is never shown as new borrowing: while the
  join is `pending`, it reads as pending.

### 5.3 The V4 sweeper: generations at one pinned block

**Purpose:** a complete, internally consistent read of the V4 book at one canonical block, or no read at all.

**Execution model** (panel R3-C3).
- The sweeper runs in **its own goroutine** beside the indexer's round loop and writes **only** `v4_*` tables.
- The V4 runner's rewind path is the **only** other writer of `v4_generations.status`, through a guarded
  compare-and-set.
- This is a scoped exception to D-004's single loop, recorded in D-015 (§11).

**Opening a generation.** The pin is bound to **completed derivation** and to the **prune-immune epoch leg** (Codex N1,
panel R3-C3). A generation opens only when all of these hold:
1. The `aave_v4_cash` **derive cursor** (keyed by engine) has caught up to the `op:v4-cash` **ingest cursor**, both at
   block P.
2. The V4 engine has **no unacked OP reorg**: `acked_epoch ≥ COALESCE(MAX(epoch), 0)`. That `acked_epoch` value is
   recorded on the generation.

   Epoch *rows* are pruned every tick (`derive.go:953-960`), which is the "ABA blindspot" that `00013:19-23` warns
   about. `acked_epoch` is the leg that survives pruning.
3. H, the ingest cursor's walker-verified hash for P, is **stored on the generation row**.

Only then is every `Borrow` ≤ P both in custody and **folded into the registry**, on the same fork. If the conditions
fail, the sweeper waits for the next tick. It never opens a generation ahead of discovery.
- A generation opens only if the observed OP head is within 64 blocks of P. P must be inside a full node's state window
  at open, not just during the sweep.
- A generation opens every **sweep interval**, which is derived from the measured cost (see Pacing). Only one is open
  at a time.

**Chunk rules.**
- Every read goes through `Failover.CallAtHashFrom(H)`, using Multicall3 `tryBlockAndAggregate(false, …)`.
- Each chunk's in-band `blockNumber` must equal P, or the chunk is refused.
- Chunks may be served by different endpoints. The endpoint index is recorded per chunk.

**Reads, in order, all at H:**
1. **Setup** (one chunk):
   - `getReserveCount`; for every reserve, `getReserve(r)` and `getReserveConfig(r)`;
   - **Every reserve's hub must be the reviewed Hub.** `Spoke.addReserve` accepts any hub address
     (`Spoke.sol:121-160`), but the stream and the implementation gate cover one Hub. A reserve on any other hub refuses
     the engine (`IMPLEMENTATION_UNREVIEWED`, sub-reason `foreign_hub`; Codex N6).
   - hub `getAsset(assetId)` for each reserve's actual `(hub, assetId)`;
   - hub `getSpoke(assetId, CashSpoke)` (`SpokeData`, `IHub.sol:395`) **for every reserve**;
   - `getLiquidationConfig`;
   - oracle `getReservesPrices([0..R-1])`. If it reverts, per-reserve `getReservePrice` under `allowFailure` isolates the
     bad reserve.
2. **Implementation identity:**
   - `eth_getStorageAt(H)` of the EIP-1967 implementation slot of the Spoke and Hub proxies;
   - `spoke.getLiquidationLogic()`;
   - `spoke.ORACLE()`.

   This needs a new hash-pinned `StorageAtHashFrom` in `internal/chain`.
3. **Accounts** (chunked; the chunk size is measured in plan task 1). The account set is:
   - accounts with debt at the previous sealed generation;
   - accounts with a `Borrow` since then;
   - accounts marked for a full read;
   - **every account whose last read failed or reverted**. It is carried forward until a successful pinned read proves
     `borrowCount == 0`.

   The first generation reads the whole registry. Per account, it reads:
   - `getUserAccountData(u)`;
   - `getUserPosition(r,u)` and `getUserReserveStatus(r,u)` for each **candidate** reserve.
4. **Dynamic configs.** `getDynamicReserveConfig(r, key)` for every (reserve, key) seen in any position, plus each
   reserve's latest key.
5. **Escalation, still at H, after the configs are loaded.** An account is re-read across **all** R reserves when either
   of these holds:
   - its borrowing bits among candidates ≠ `borrowCount`;
   - its **protocol-defined** active collateral among candidates ≠ `activeCollateralCount`. "Active" means collateral
     bit, CF(key) > 0 and shares > 0, the Spoke's own rule (`Spoke.sol:728-749`).
6. **Close with a canonicality witness, sealed in one transaction.**
   - The V4 `acked_epoch` is re-read and must equal the value recorded at open. If it moved, a rewind happened during
     the sweep, and the generation is abandoned.
   - The seal is a guarded compare-and-set, `UPDATE … SET status='sealed' WHERE id=$1 AND status='open'`, in the same
     transaction as that re-read.
   - Rewind supersedes **open** as well as sealed generations whose P is above the rewind point.
   - **Every endpoint that served a chunk** returns the header hash of P equal to H, **read from that exact endpoint**.
     `HeaderHashFrom(i)` only *prefers* endpoint i and rotates on failure (`chain.go:853-868, 1250-1268`), so every
     "witness" could come from one surviving endpoint. The witness therefore uses a new no-rotation `HeaderHashAt(i)`.
     Any result whose endpoint token differs from i is rejected (Codex M10).

   Any disagreement abandons the generation. `requireCanonical` is false in the chain layer (`chain.go:1457-1460`), so
   this witness is the canonicality claim. Its scope is stated as such: canonical as far as custody and the serving
   endpoints agree. A later rewind below P supersedes the generation.

**Failure posture.**
- A generation is **abandoned**, and a fresh one opens at a new P, on any of:
  - a wrong-block chunk;
  - an all-endpoint `PinnedCallError`;
  - state-pruned;
  - running past `SOLVENT_V4_SWEEP_BUDGET` (default 90 s);
  - a failed witness.
- A per-account revert is recorded as that account's read status and carried forward. It is never a batch error.
- **Nothing partial is ever sealed.**

**Pacing: a dedicated V4 lane** (panel R3-C2, R3-1). A single reservation of about 83 permits can never be granted by a
global bucket with burst 20. So:
- **The lane.** The sweeper draws from a **V4 sub-bucket** carved out of go-live A1's global rate:
  - rate `SOLVENT_RPC_RATE_V4`, default 1.0 req/s;
  - burst `SOLVENT_RPC_BURST_V4`, default 300.

  Every other caller gets the global rate minus `r_v4`, so the global ceiling still holds.
- **The lease.** At open, the sweeper takes a **lease** for the generation's estimate: the last sealed generation's
  physical-request count plus a margin (default 50%).
  - Per-physical-request permits draw from the lease first.
  - Unused lease returns to the lane at seal or abandon.
  - An overrun draws from the lane, and never from the other callers' share.
  - A boot-time invariant, in the style of `setRunBurstInvariant`, requires `burst_v4 ≥ lease cap`.
- **Feasibility.** The design stands only if `calls_per_generation ≤ burst_v4 + r_v4 × SOLVENT_V4_SWEEP_BUDGET` (90 s).
  **W4 is gated on this inequality at the measured book size** (plan task 1).
- **The sweep interval is derived, not fixed:** `max(120 s, 1.2 × calls_per_generation / r_v4)`. The freshness budget
  (§5.5) is 3 × the interval.
- **Named fallbacks** if the inequality fails:
  - larger chunks, where plan task 1 proves them safe;
  - a longer interval, with its freshness budget;
  - a higher `r_v4` taken from the ETH walkers' share.
- **Failure behavior.** A generation unfinished at its 90 s budget, for any reason, is **abandoned**, never partially
  sealed. Deferral and abandonment surface through the database-clock freshness refusal (§5.5). Overruns are logged
  per generation.

**Storage** (new migration):
- `v4_generations`: P, H, block time, status, per-endpoint chunk ledger, implementation identities, counts.
- Per-generation assets, reserves (`(hub, assetId)`), `SpokeData`, dynamic configs, liquidation config and prices.
- Accounts: the chain's 7 fields and the read status.
- Account-reserves: shares ×3, `premiumOffsetRay`, key, both status bits, the escalation flag.
- uint256 values are stored as `NUMERIC(78,0)`.
- Retention keeps the newest `SOLVENT_V4_GENERATION_RETENTION` (default 200), plus any generation a retained batch
  references.

**Reorg.** A rewind below P marks **open and sealed** generations superseded, in the rewind's own transaction, as the
Debt Manager's orphaned-snapshot invalidation does. The guarded compare-and-set seal (step 6) cannot resurrect a
generation the rewind has already superseded.

**Cost.**
- **Per generation:** about 1 setup chunk, 1 identity chunk, ⌈accounts × ~5 sub-calls / chunk size⌉ account chunks,
  1 config chunk, and one header read per serving endpoint.
- **Chunk size decides the cost, and it is unmeasured.** The getters loop over reserves on chain, and the repo's
  precedents are 15 sub-calls per chunk (reconcile, for server-looping views) and 100 (the snapshotter).
  - At 100 sub-calls per chunk, 5k accounts cost **about 250 calls per generation**. That gives an interval of about
    300 s at 1.0 req/s, and about 72k calls/day.
  - Plan task 1 measures the largest safe chunk on each configured endpoint against gas cap, response size and the 30 s
    attempt timeout, then sets the interval by the rule above.

### 5.4 Exact V4 risk math (`internal/risk`)

**Purpose:** a pure, I/O-free, float-free replica of the Spoke's arithmetic. The existing package laws hold:
`TestNoFloatAnywhereInNonTestSources` and `TestPackageIsIOFree`.

**`ComputeV4Health(V4Input) → V4Health`.** It follows research brief §2 exactly:
- `idx(t_P)` and supplied assets;
- `value = amount·P·10^(18−dec)`;
- W, TC, DR, iterating reserves highest id first;
- HF, `avgCF`, the counts, and RP (dormant, by the §2.6 algorithm).

The outputs are integers:
- `hf_wad` (max-uint maps to `hf_infinite`) and the exact `hf_num/hf_den`;
- `total_collateral_value` (1e26 = $1);
- `total_debt_value_ray` (unrounded);
- `debt_value` = `ceil(DR/RAY)` (1e26, rounded up like the protocol's debt getters);
- `avg_collateral_factor_wad`, `risk_premium_bps`, the two counts;
- per-reserve legs.

**Verdict:** `liquidatable = hf_wad < 1e18`.

**Liquidation (`V4Liquidation`)** covers research brief §3:
- the bonus curve;
- the penalty and debt-to-target;
- premium before drawn;
- the dust and exhaustion branches;
- the fee split;
- the deficit condition.

Numbers resting on the pure target-HF branch, which has not yet happened on chain, are labelled **modelled** until the
fork test proves that branch (§9).

**Debt is priced**, so liquidation boundaries have a direction. The stress contract must stop assuming that only price
falls cause liquidation. Codex's example: $10k USDC at CF 90% against $9.5k of WETH debt has HF ≈ 0.947, and a 10% ETH
*fall* makes it healthy.
- **Liquidation price.** For a single-asset shock factor x > 0, both sides of the account are linear in x:
  - weighted collateral `C(x) = a·x + b`;
  - debt `D(x) = c·x + d`.

  In the Spoke's units, liquidatable ⇔ `C(x) < D(x)`. The V4 arm solves `f(x) = (a−c)·x + (b−d) = 0` in exact
  rationals over the **whole exposure equation**. It never judges by which sides hold the asset: Codex N2 shows
  collateral `75x+90` against debt `50x+100` crossing at x = 0.4.
  - **`a > c`:** `liquidated_below` x* = (d−b)/(a−c), the lowest healthy price.
  - **`a < c`:** `liquidated_above` x*, the highest healthy price.
  - **`a = c`, or x* ≤ 0:** no boundary in the domain. The state is `always_liquidatable` or `never_liquidatable`, by
    the sign of f on x > 0.

  **The integer boundary** (panel Q3). The rational x* is exact: the HF floor cannot move a `< 1e18` verdict, and the
  share floor and premium don't depend on price. But the per-reserve integer prices published for x* are a **vector**.
  - Each factor price rounds **toward raising f**, by the sign of that leg's net coefficient (CF·collateral − debt, per
    price unit, including same-reserve supply plus borrow): positive rounds up, negative rounds down.
  - Because f is linear, the vector is healthy by construction.
  - `boundary_is_healthy` is **recomputed** with `ComputeV4Health` at that vector, never set as a constant.
  - The rational x* stays authoritative.

  The engine-generic "never liquidatable when the factor has no counted collateral" rule (`liqprice.go:275-279`) becomes
  per-engine. The wire gains `direction` and `boundary_state`. The boundary fields' descriptions, which today say
  liquidation is "strictly below the lowest healthy price" (`handlers.go:1156-1169`), are rewritten per direction under
  the 2.0.0 contract. Debt Manager and v3 rows are always `liquidated_below`.
- **Waterfall.** Each V4 series is **`pointwise`**: every grid point is evaluated independently.
  - There is no crossed-account latch (`waterfall.go:249-265`).
  - Eligible debt may fall as prices fall.
  - Debt Manager and v3 series stay **`latched_cumulative`**.

  The contract changes to match (Codex N4):
  - Each series carries `semantics`.
  - The global `monotonicity` invariant (`openapi.yaml:2605-2625`) applies **only** to latched series.
  - The web's decreasing-debt refusal (`stress-preview.ts:117-136`) and its "no new liquidatable debt" copy
    (`:143-150`) become per-semantics. A pointwise series presents **signed** changes, as in "liquidatable debt falls by
    $X as ETH falls 10%", and never a refusal.
- **Up-side risk has its own scenarios; the waterfall stays falls-only** (panel Q1). The waterfall's grid law holds
  load-bearing checks: strictly descending, first point unshocked, "LAW OF THE LAST POINT". So the grid is **not** made
  two-sided. Instead:
  - committed **ETH-up scenarios** (`eth_plus_10/20/30`, engines `["aave_v4_cash"]`; the validator already accepts
    factor > 1) show the WETH- and EURC-debt books crossing on rises;
  - each V4 book states a count and the debt of `liquidated_above` accounts within the largest up-rung;
  - the waterfall's V4 caption says it walks falls only, and points to the up-rung scenarios.
- **Eligible debt, the headline.** For V4 it is Σ `debt_value` over accounts with `hf_wad < 1e18`: pair-free, and the
  same meaning the Debt Manager and v3 use today (panel Q2). The contract's "realized ≤ eligible" stays true.
- **Debt-to-target, a separate series, labelled modelled.** The protocol defines debt-to-target only **per (collateral,
  debt) call** (`LiquidationLogic.sol:796-812`). The same account can yield $3.7k, $6.7k or $7.8k depending on which
  reserve a liquidator seizes. So the to-target amount uses the deployment's **disclosed seizure model, pro-rata over
  counted collateral** (panel R3-6):
  - each counted leg i retires a share α_i = v_i / V of the debt;
  - each leg uses its own `LB_i` (the bonus curve at the account's HF and the leg's snapshot maxLB) and its own `CF_i`;
  - dust, exhaustion and the executability predicate apply per leg: neither reserve paused, and the spoke active on the
    debt asset.

  It is labelled **modelled** (R5), is pinned by a two-collateral golden test, and never replaces the headline.
- **V4 bad debt** is the `ReportDeficit` write-off condition, evaluated under the same model.
- **Explicit V4 arms, and every `default` fails loudly.** The arms are `weightsFor`, `shortfallForPosition`,
  `applyMarketRealization`, `measurePosition`, `ApplyScenario`, `LiquidationBonusMultiplier`, `engineDecimalsHint` and
  the price-class sets. The research found three `default:` arms that run Debt Manager math, and one switch with no
  default that silently leaves prices unshocked.

**Scenario keys gain an engine dimension:** `responseKey(engine, chain, asset)`. V4 and the Debt Manager share OP, so
without it V4's USDC would inherit the Debt Manager's `stable_snap`, which errors on 8 decimals and is wrong in any case.
Validation and held-flat deduplication use the same key.
- **One engine-scoped resolver serves every consumer of the matrix** (panel Q4): `ApplyScenario`, the liquidation-price
  factor membership, `ExecutionShortfall`'s realization ratios, and the run-book's reach.
  - For a V4 position, the factor is built from **V4 rows only**.
  - A missing realization for a V4 leg is listed and refused, never defaulted to 1.0.
- **V4 scenario rows move the oracle output linearly.** The CAPO adapters' caps and ratio decomposition are **not
  observable** from `latestAnswer()`, so they are **not modelled**. The scenario response discloses this as a stated
  simplification.
- A V4 asset with no scenario row is **held flat and listed**.
- V4 is **excluded from the rate-horizon (`borrow_apy`) scenario, and says so.**

### 5.5 riskd integration: V4 is refused at engine scope

**Purpose:** V4 joins the batch without a V4 *sweeper or generation* failure ever freezing the Debt Manager or v3.

**Stated limit:** OP reorgs stay chain-scoped by design (D-003). A reorg on any OP stream, V4's included, rewinds OP
state, and the Debt Manager's gate waits for its epoch ack exactly as today. The isolation promise does not extend past
that.

**Judging the generation.** V4 stays **out of `gatedEngines`**. The **`aave_v4_cash` derive cursor**, keyed by
engine as riskd filters it (`gates.go:32-46`; not the stream name), joins `consumedEngines`. Assemble judges the
generation, and each of the following is a **V4 engine refusal**:

| Code | Sub-reasons in the detail |
|---|---|
| `GENERATION_UNSERVABLE` | none sealed; stale; unacked OP epoch; no cursor |
| `IMPLEMENTATION_UNREVIEWED` | `upgraded`: any recorded identity outside the reviewed set (Spoke impl `0xA1f75D80…3b68`, Hub impl `0x697aF342…2cE9`, LiquidationLogic `0x88dF…B8DB`, Oracle `0xe8cb…6fA8`); `foreign_hub`: a reserve on any hub other than `0x6675…C572` |

- An upgrade therefore refuses the engine until a reviewed code change admits the new identity.
- The weld alone cannot catch a liquidation-logic change, because `getUserAccountData` does not exercise it.
- **Scope of the identity check.** It is **address-based**: proxy implementation slots, the linked library address,
  the oracle address. It is not transitive code attestation. Per-reserve price sources and their adapters are **not**
  attested; the engine consumes their outputs as observed chain state, and the scenario model does not depend on their
  internals (§5.4).

**Freshness uses the database clock, like prices** (`prices.go:267-289`, `pass.go:129-131`).
- **Generation age** = snapshot time − generation block time, with a budget of `SOLVENT_V4_FRESHNESS_BUDGET`. The
  default is 3 × the derived sweep interval (§5.3); for example, 15 min at a 300 s interval.
- **OP observation freshness** (the V4 cursor's last advance) is judged separately.
- If OP observation freezes, generation age still grows against the database clock and the refusal fires.
- A freshness deadline is armed so a stalled sweeper cannot leave "fresh" standing.

**The generation leg:**
- It joins the watermark vector, `Changed`, the identity (a `generation:` line carrying the freshness *phase*) and the
  substrate digest.
- New `risk_batch_watermarks` generation columns carry an all-or-nothing CHECK.

**Stamps and supersession are engine-scoped.**
- V4 is always stamped, because `readBatchAccounts` refuses a view with an unstamped engine. The stamp carries an
  explicit state: `present` or `absent (code)`.
- `cmd/api/meta.go:200-246` and `web/lib/lab-view.ts:431-467` treat an `absent` V4 stamp as **that engine's refusal**,
  never as the batch being superseded.
- A test pins that an absent-V4 batch is not globally superseded.

**Aggregation:**
- `aggregate`'s fixed engine order and decimals become the engine list. Today it silently skips an unknown engine, and
  the count check fails the write.
- The engine-refusal map carries codes; the code is no longer hard-coded at `assemble.go:1269`.
- `engine_refusal_test` becomes Len 3. 00014 needs no V4 backfill.
- `AlgorithmRevision` 6 → 7.

**Per-account outcomes:**
- **`exact`:** all 7 recomputed fields equal the stored `getUserAccountData`.
- **`V4_WELD_MISMATCH`:** refused, never shown with our number. The account is marked for a full read next generation;
  the sweeper reads the mark from the latest batch's refusal rows, so riskd never writes to indexer tables.
- **`V4_ACCOUNT_UNREAD`:** the read reverted or failed. The refusal row is kept even though `borrowCount` is unknown.
- **`V4_PRICE_INVALID`:** a touched reserve priced ≤ 0.
- The book is accounts with `borrowCount > 0`, plus the unread accounts whose debt status is unknown. Those are never
  silently dropped.

**Completeness, three separate claims:**
1. **Registry completeness (the ring).** For **every listed reserve**, whatever its `borrowable`, frozen, paused or
   active state, and keyed by its actual `(hub, assetId)`:

   Σ over registry accounts of (`drawnShares`, `premiumShares`, `premiumOffsetRay`) == hub `SpokeData`.

   Borrowing can be disabled on a reserve with debt still on it (`Spoke.sol:168-181, 754-765`), so a borrowable-only
   ring could miss a borrower.
2. **Valuation completeness.** Every registry account with debt or unknown debt status is `exact`.
3. **Book scope: one stored state, and every book-wide surface reads through it** (Codex H2; panel R3-2, Q5).
   - **Storage keeps its meaning.** `risk_batch_aggregates.total_collateral` / `total_debt` stay `NUMERIC NOT NULL`, and
     keep their documented meaning: **sums over computed rows only** (`00013:455-459`). They are the subset pair.
     Nothing ever writes NULL there, so a withheld total can never fail the atomic batch write for every engine.
   - **New columns** on `risk_batch_aggregates` **and** `observatory_points` (same migration):
     - `book_scope`, one of `complete` | `registry_incomplete` | `accounts_not_computed`, with a CHECK;
     - the shortfall detail: per reserve `(hub, assetId)`, drawn/premium/offset shortfall, as JSONB;
     - `computed_accounts` and `book_accounts`.
   - **The wire:**
     - the **whole-book pair** is served, equal to the stored sums, only when `book_scope = complete`. Otherwise it is
       null, with the scope and detail beside it;
     - the **computed pair** is always served, with N of M. The web labels it "computed accounts only".
   - **Precedence:**
     1. An engine refusal nulls both pairs.
     2. Otherwise a non-`complete` scope nulls only the whole-book pair.
     3. Otherwise both pairs are served and equal (pinned by a test).
   - **Readers.** The same rule is applied in every reader:
     - `s.aggregates` (`handlers.go:330-374`);
     - `handleObservatory` (`:1764-1777`);
     - `wireObservatoryPointFrom` (`p5_observatory_series.go:209-231`);
     - the `p5_history` window.

     History and the Observatory therefore never draw a subset sum as the Cash book's debt.
   - **Other book-wide surfaces.** Every V4 book-wide surface reads the same scope: waterfall series, run-book rows,
     shortfall totals, the HF histogram, the movers.
     - Under `registry_incomplete` they are labelled "known accounts only; N shares unaccounted on reserve r".
     - Under `accounts_not_computed` they are labelled "computed accounts only".
     - None of them is presented as the whole book.
   - Debt Manager and v3 always write `complete`, so their behavior is unchanged.

**Schema** (the same migration as §5.3):
- `risk_positions` gains `avg_collateral_factor`, `risk_premium`, `total_collateral_value`, `total_debt_value_ray`,
  `debt_value`, the stored chain fields, the weld verdict and the generation id. It does **not** reuse
  `weighted_lt_sum`/`avg_lt_bps`.
- `risk_position_legs` gains `reserve_id` (the V4 leg key), `dynamic_config_key`, the share kinds, `drawn_index`,
  `collateral_factor` and `price`.
- The aggregate `value_decimals` for V4 is 26.
- The rows are exactly enough to rebuild `V4Input` bit-for-bit for serve-time stress (`cmd/api/read.go`). A round-trip
  test pins this.

### 5.6 API and contract

**The engine enum widens.**
- `aave_v4_cash` joins the four engine enums (`api/openapi.yaml:143, 527, 686, 811`).
- Widening a response enum can break a consumer's exhaustive switch, so the contract goes **1.8.0 → 2.0.0** (owner
  ruling R2). `@solvent/client` is unpublished, so no external consumer breaks.
- The client's `ENGINE_NAME_SET satisfies Record<EngineName,true>` breaks the compile, as intended.

**Additive fields and endpoints:**
- V4 position fields, with their units stated: collateral 1e26; debt value 1e26, rounded up; debt ray 1e53.
- `EventAmountUnit` gains `token`: the event's amount in the reserve's decimals, with its symbol.
- The optional `moved_from` marker.
- On the aggregate **and** on Observatory series points: `book_scope`, the shortfall detail, the computed pair and
  `computed_accounts` / `book_accounts` (§5.5).
- On liquidation prices: `direction` and `boundary_state`, with the boundary descriptions rewritten.
- On the waterfall: each series' `semantics`, with `monotonicity` scoped to latched series.
- The **continuous-check** block (§5.8).
- **`GET /v1/migration`** (§5.9).

**Every Debt-Manager-by-default arm becomes an explicit V4 arm or an error:**
- `parseEngineParam`, `engineValueDecimals`;
- `handlers.go:416, 550, 1025, 1558, 1581`;
- `p5_history.go:194-209, 253`;
- `p5_runbook.go:1138`, `p5_runbook_set.go:1218`;
- the events default engine set (`p5_events.go:212-214`) and the liquidation-detail arms (`:588-603`);
- `contractDisplayType`'s collateral switch, which today returns a 500 on anything but v3;
- the events vocabulary weld test.

`p5_runbook_transition_test.go:949` keeps its "engine arm that does not exist" pin with a fictional fourth engine.

### 5.7 Web: Cash is V4, and the Debt Manager folds in as "migrating"

**One engine registry in `web/lib`** replaces `CASH`/`LEGACY` (`inspector-position.ts:16-17`) and both
`ENGINE_ORDER`s. Per engine it holds:
- id, public label, role (`primary` | `migrating` | `legacy`) and chain;
- comparator kind (`hf` | `cap`);
- scale source and price-source sentence.

The non-total engine lists (`positions.ts`, `feed-data.ts`, `history-view.ts`, `observatory-data.ts`,
`stress-preview.ts`) derive from the registry.

| Engine | Public label | Role |
|---|---|---|
| `aave_v4_cash` | **Cash** · Aave V4 (OP Mainnet) | primary: every slot the Debt Manager holds today |
| `debt_manager` | **Cash · Debt Manager (migrating out)** | fold #1: its boolean cap comparator and 6-decimal USD |
| `aave_v3_etherfi` | Legacy · Aave v3 market | fold #2, unchanged |

**Folds.** `LegacyFold` becomes an **ordered list of folds** on the Book, the Inspector and Scenarios.

**Cash semantics move from cap to health factor.** This touches the comparator, histogram, room chart, "borrow cap"
copy, liquidation distance and movers. V4's words:
- "health factor";
- "collateral factor (one factor for borrowing and liquidation)";
- "liquidated below 1.0".

A liquidation distance shows its **direction**, as in "liquidated if ETH rises 8%".

**Inspector.** A Safe mid-migration can hold both positions, so the single `find` becomes a list.
- States: `v4`, `dm`, `both`, `none`.
- V4 is shown first.
- The Debt Manager card reads "not yet migrated" or "migrated; residual".

**Activity:**
- V4 rows print token amounts ("1,250.00 USDC").
- A re-home reads "moved from the Debt Manager".
- "Different chains" copy is corrected: V4 and the Debt Manager are both on OP.

**Never summed.** There is no cross-engine "Cash total". The units and price sources differ:
- V4: a 1e26 value from an unsnapped oracle;
- Debt Manager: USD-6 from a snapped PriceProviderV2.

**Price-source copy.** V4's reads "Aave oracle (ether.fi CAPO adapters), read at the pinned block". Correct
`prose.ts:67,70` and `overview-copy.ts:81,132` to match.

**Laws unchanged:**
- Refused, withheld or absent values never render as zero.
- A fetch failure is never a refusal.
- Copy lives in `web/lib`.
- A page claims only what the system backs.

### 5.8 The per-generation check: a third kind of evidence

**The existing law stands.** The Verification page says "the live batch never carries exactness" (`evidence.ts:1089`,
`p5_evidence.go:214`).

**What V4 adds.** A third, separately scoped subject: the **per-generation check**. It is not called "continuous"; it
is a sample every sweep interval, and its cadence and the age of the last sealed generation are shown beside it (panel
Q6).

**How it is stored and rendered.** It is **structured data persisted per batch**, and the sentence is rendered from the
fields, never hard-coded. The persisted fields:
- the generation: P, H, generation id and block time;
- `exact` N, and the book M (borrowers plus accounts whose debt status is unknown);
- mismatch and unread counts;
- the generations sealed and abandoned since the previous batch;
- the ring result, `complete` or `short` with a per-reserve shortfall.

The rendered sentence:
- **Ring complete:** "At block P, our integer replica matched the protocol's `getUserAccountData` on all 7 fields for
  **N of M** borrowers (k refused, u unread). Every listed reserve's drawn and premium shares are accounted for."
- **Ring short:** the second sentence becomes "The share ring is short by S on reserve r; the book total is withheld."

**Its rules:**
- **Scope.** It covers account health only. It claims nothing about liquidation mechanics, which rest on the reviewed
  implementation identity.
- **Candor.** No word says "every account" or "every generation" unless the fields show it: N = M, and zero abandoned
  generations in the stated window.
- **Separation.** It never flips the live marker to "proven", and it never replaces the reconcile receipt (§5.10).
- **Public use.** The go-live README quotes a **stamped** instance of this sentence, with block and date, never a
  universal claim.

### 5.9 The migration record

The P5 spec §11 asks that "the Observatory shows the migration record". This component answers it with a small, pinned,
daily series.

**What is read,** by block hash at each UTC day's first block:
- the Debt Manager's `totalBorrowingAmounts()` (USD-6), **from 2026-07-25**;
- the V4 hub's Cash-spoke owed per asset, with the oracle's prices at the same block, **from the Spoke's deployment day
  (2026-07-30)**.

A V4 sample whose **sampled block is below the Spoke's deployment block, 154,915,790,** carries an explicit
**`not_deployed`** state, never zero. The rule compares blocks, not dates: 2026-07-30's first block predates the 16:52
UTC deployment, so its V4 sample is `not_deployed` too (Codex M16). The series is backfilled once from
archive state and continued daily.

**The stock/flow convention** (panel Q7):
- The sample at day D's first block is **D−1's closing stock**, and is labelled so.
- Day D's **flow** is the `MigratedToLendGateway` count and `debtUsd` sum over [first block of D, first block of D+1),
  read from Debt Manager `raw_logs` (§5.2).
- The flow is joined to the D+1 sample, so a transfer and the balance change it causes appear on the same row.
- A test pins this on the Aug 21 wave: $8.48M moved, with the Debt Manager dropping from $18.5M to $7.9M.

**How it is presented.**
- **Transfers.** The migration-event series is the direct evidence of what moved between engines.
- **The two debt totals** measure different things, and their changes are not "migration volume". The copy says so.
- **Drawing.** Served by `GET /v1/migration` and drawn as **small multiples**: one shared time axis, a separate value
  axis per engine, never summed (owner ruling R3).

### 5.10 Reconcile: the V4 gate

**Invocation.** `cmd/reconcile -engine aave_v4_cash`. The `wantDM`/`wantAave` booleans become an engine set; "both
engines" becomes "all engines".

It runs at a **sealed generation's** pinned hash:
1. **Inputs are chain-true.** Re-read every stored input on an independent endpoint where one exists, byte-exact.
   This includes the implementation identities.
2. **HF gate.** `ComputeV4Health` over the stored inputs, against `getUserAccountData` re-read at H: 7 exact legs.
3. **The ring**, re-read, over every listed reserve.
4. **Realized-liquidation backtest: evidence rows only, never gated** (Codex M11).
   - **Why it can't be gated.** No log-based predicate proves a liquidation's execution pre-state:
     - the liquidation's own `Hub.restore` emits `Restore` before `LiquidationCall`;
     - the filtered custody deliberately omits other state-changing events;
     - an external price-feed update can change `latestAnswer()` with no Spoke or Hub log at all.
   - **What each row does.** Replay on an anvil fork at B−1 with B's timestamp and the calldata `debtToCover`, and
     record exact or drift as **evidence**.
   - **Where exactness is proven instead:** in the fork tests, which construct the pre-state themselves (§9), and in the
     four golden vectors, which are fixtures for "these inputs produce these amounts". A gated realized backtest needs a
     transaction-prefix replay (§8).

**Artifact and receipt.** The artifact gains V4 sections inside `hashScope.Sections` and `tallyTotals`. The API gains a
third weld, labelled as counting HF rows; the existing welds count custody rows. The receipt is
`roadmap/evidence/receipts/E-w4-acceptance.md`.

## 6. Error handling and honesty (summary)

| Condition | Stored | Shown |
|---|---|---|
| No sealed generation, stale (database clock), unacked, no cursor | `GENERATION_UNSERVABLE` + sub-reason | the V4 fold's refusal line. The Debt Manager and v3 serve, except during a shared OP reorg ack, as today. |
| Implementation identity changed | `IMPLEMENTATION_UNREVIEWED` | "Aave V4 implementation changed at block N; the engine is paused until the new code is reviewed" |
| Ring incomplete | `book_scope = registry_incomplete` + per-reserve shortfall. Stored sums stay the computed subset. | "Book total withheld: N shares of drawn USDC unaccounted", with the computed pair labelled. Every book-wide surface reads "known accounts only". |
| Some accounts not computed | `book_scope = accounts_not_computed` + N | "Book total withheld: N accounts not computed", with the computed pair labelled |
| Weld mismatch | `V4_WELD_MISMATCH`, both values kept | a refused row, counted |
| Read reverted, or price ≤ 0 | `V4_ACCOUNT_UNREAD` / `V4_PRICE_INVALID`, carried forward | refused rows, counted, with the reason |
| A number depending on an unproven branch | — | a "modelled" label |

## 7. RPC and storage budget

**RPC:**
- **The V4 walker.** One walker at about 6 reads per round (go-live A1's recount) runs at the OP cadence.
- **Generations** run in the **V4 lane**: at most `r_v4` (1.0 req/s ≈ 86k/day) by construction. The measured cost sets
  the interval. At 100 sub-calls per chunk and 5k accounts that is about 250 calls, about a 300 s interval, and about
  72k/day.
- **Other reads:** the migration record costs 1 call/day, and the backfill about 1.2k windows once.
- **Enforcement.** The aggregate is enforced by go-live A1's global and per-domain limiter, not by assumed latency.

**Storage:**
- generations: about 5k accounts × 3 reserves × 200 retained, a few GB;
- V4 `risk_*` rows ride retention 750;
- filtered raw logs: about 12k/day, about 1 GB/year.

## 8. Out of scope

- Event-sourcing V4 balances.
- Projecting V4 interest rates.
- Modelling CAPO caps.
- A cross-engine "Cash total".
- Retiring the legacy v3 engine.
- GHO or new spokes. A second spoke is a new stream and engine instance.
- A transaction-prefix liquidation replay; those rows stay evidence rows.
- P4 alerts.

## 9. Testing

**Golden vectors.** Fixtures come from pinned archive reads and are reproducible with `replica/recon.py` and
`replica/liq.py`:
- 3 accounts × 7 fields at block 157,337,755, with 88 per-reserve checks;
- 4 liquidation replays at blocks 155,787,821, 157,203,837, 157,204,396 and 157,204,416.

**Law tests.** Each gets a failing test first:
- each §3 law, and each liquidation formula;
- a key snapshot under an in-place edit;
- the price-revert path.

**Fork differential** (anvil fork of OP at a pinned block):
- **Random positions.** At least 1,000 randomized positions are driven through supply, borrow, repay, collateral
  toggles and time warps. Every account must match on all 7 fields.
- **Forced branches.** Separate fork scenarios force:
  - the **pure target-HF** liquidation branch;
  - a **deficit** write-off;
  - a **nonzero risk premium**: set collateral risk above 0, raise the threshold, trigger premium creation and refresh,
    advance time, and assert nonzero accrued premium before exercising repay, liquidation and deficit on it.

**Ingest:**
- **per-engine decoder revisions.** The new binary is deployed onto a database built by the old one;
  `aaveFlagCustodyProven` stays true and Debt Manager coverage is unchanged;
- **the `moved_from` join:** `debt_manager`, `none` and `pending`, including a Debt Manager ingest cursor lagging the V4
  cursor across a migration transaction;
- a fingerprint mismatch is refused;
- a provider that ignores the topic filter is caught;
- config refusals: topics or multi-address dispatch on a non-V4 engine, a duplicate address, an unknown key;
- coverage-binding byte identity for existing streams.

**Sweeper:**
- a wrong-block chunk;
- endpoint disagreement at the witness, including a rotated "witness" rejected by its endpoint token;
- a derive cursor behind the ingest cursor, where no generation opens;
- a reserve on a foreign hub, which refuses the engine;
- **the lease:**
  - it is granted from the V4 lane;
  - an overrun draws only from the lane;
  - unused lease returns at seal or abandon;
  - the boot invariant holds `burst_v4 ≥ lease cap`;
  - under the modelled background load, a 5k-account generation is admitted and seals within budget;
- **the epoch leg:** an OP rewind plus epoch prune during a sweep changes `acked_epoch`, and the seal is refused;
- **the compare-and-set seal** against a concurrent rewind supersession;
- P too old at open;
- budget expiry, state pruned, a per-account revert carried forward;
- escalation by protocol-active count (including a CF-0 masking case);
- crash and resume;
- reorg supersession.

**riskd:**
- **Fault injection.** Stop the sweeper: V4 is refused and the Debt Manager and v3 serve. Also run an **OP-only
  outage** with riskd and Ethereum running: the database-clock staleness fires.
- An absent-V4 stamp does not globally supersede the batch.
- A ring gap on a **non-borrowable** reserve withholds totals.
- A weld mismatch withholds whole-book totals and serves the subset, labelled.
- `IMPLEMENTATION_UNREVIEWED` fires on a changed identity.
- Identity revision 7.
- The stress rebuild round-trips.
- Debt-side shocks. Direction boundaries are solved over the whole exposure equation; Codex's mixed-exposure example
  (`75x+90` against `50x+100`) must return `liquidated_below` at x = 0.4.
- **The integer boundary vector** rounds toward raising f, and `boundary_is_healthy` is recomputed there. The case
  where one side is fractional and the other is not is covered.
- The `pointwise` V4 waterfall passes the web's per-semantics checks with signed copy.
- The ETH-up scenarios surface `liquidated_above` accounts.
- The engine-scoped resolver: a V4 leg with no row is listed and refused, never defaulted to 1.0, in `ApplyScenario`,
  the liquidation-price factor and `ExecutionShortfall` alike.
- Headline eligible debt is pair-free. The modelled pro-rata to-target series has a two-collateral golden test.
- **Book scope:**
  - a precedence test;
  - `registry_incomplete` reaches the Observatory series, History, the waterfall and the run-book, each labelled;
  - no NULL is ever written to `risk_batch_aggregates` totals.
- **The per-generation check sentence** is rendered from the fields: ring short, mismatches and abandoned generations
  each change the words.
- **The migration record's stock/flow alignment** on the Aug 21 wave.

**API and web:**
- the contract drift gate, client regeneration and the web proof-contract weld;
- every former default arm is tested with a V4 row;
- page pins are re-baselined by ruling after reading each capture.

**Live acceptance.** 24 h on the box, recorded in the ledger:
- every sealed generation's ring is complete;
- weld mismatches are 0, or each one is explained and fixed;
- cadence and RPC are measured against go-live A1's budget.

## 10. Review gates (D-006)

Codex adversarial passes cover:
1. the stream filter and fingerprint, plus the deriver;
2. the sweeper;
3. the V4 risk math and liquidation;
4. the stress contract changes (direction, waterfall);
5. riskd integration and engine-scoped stamps;
6. the reconcile gate.

A whole-branch review runs at close. Fix waves return to Codex. Dependents do not run against an unapproved component
(D-006 clauses 4–6).

## 11. Governance (owner-reviewed transitions)

1. **New work item W4, "Cash on Aave V4: the third engine" (phase P5).**
   - **Evidence target:** V4 HF exact against the chain, shown by golden vectors, the fork differential, the
     per-generation check over a 24 h live run and the V4 reconcile receipt; suites green.
   - **`allowed_paths`:**
     - `internal/**`, `cmd/**`, `api/openapi.yaml`, `packages/client-ts/**`, `web/**`;
     - `config/contracts.json`, `go.mod`, `go.sum`, `Makefile`;
     - `deploy/**`, `.env.example`, for the new `SOLVENT_V4_*` and limiter settings (panel R3-8);
     - `docs/specs/**`, `docs/plans/**`, `.superpowers/sdd/**`;
     - `roadmap/work/W4-*.md`, `roadmap/evidence/**`.
   - **Non-goals:** §8.
2. **One coherent transition** (panel R3-8). Serial mode allows one committing task. The go-live Part A infrastructure
   runs under W3 **before** this transition, and Part B returns to W3 after W4 is achieved. In a single owner-reviewed
   change, as `scope_gate.py` and `doctor.py` require:
   - W3's frontmatter goes to `committed` and W4's to `active`, with **both ROADMAP ladder rows** updated;
   - `STATUS.active_task` becomes W4;
   - the claim is rebound with `claim.py` to task W4, a new scope hash and the base SHA.
3. **Proposed Decision D-015:** "Aave V4 positions are read as pinned state per generation, welded per account to the
   chain's own getter, bound to reviewed implementation identities, and refused at engine scope."
   - It also records the **scoped D-004 exception**: the sweeper runs in its own goroutine, writing only `v4_*` tables,
     with the V4 rewind as the only other writer of generation status, through a guarded compare-and-set (§5.3).
   - The owner accepts it.
4. **Stale lines corrected in the same transition:**
   - `roadmap/STATUS.md`'s "AIP not yet executed" blocker (it executed at block 154,924,987);
   - the ROADMAP's "Design dependencies" line.

   W1's "config-only" line is archived history. It is **not** rewritten; an insight records the correction.

These touch protected surfaces. They run with `CONTROL_PLANE_OWNER_REVIEWED=1` **only on the owner's explicit answer**,
in isolated commits.

## 12. Rulings of record for the owner

- **R1:** V4 is "Cash". The Debt Manager is "Cash · Debt Manager (migrating out)", a fold, never summed with V4.
- **R2:** The contract goes 1.8.0 → 2.0.0 to widen the engine enum, before the client's first publish.
- **R3:** The migration record is drawn as small multiples with separate value axes, the one sanctioned way two engines
  share a view.
- **R4:** The per-generation check is a third evidence subject, scoped to account health, with its sentence rendered
  from persisted fields. The "live never proven" law stands.
- **R5:** "Modelled" labels apply to:
  - numbers resting on an unproven liquidation branch;
  - CAPO-capped assets under scenarios;
  - the pro-rata to-target liquidation series.
- **R6:** V4 stress semantics differ by design:
  - direction-aware liquidation prices;
  - a non-latching waterfall;
  - ETH-up scenarios for debt-side risk, while the waterfall grid stays falls-only.

  The Debt Manager and v3 keep their semantics.
- **R7:** The sweeper runs in its own goroutine, a scoped D-004 exception recorded in D-015.

## 13. Review record

**Codex adversarial review, round 1** (session `01a0d532-302b-7e50-91c1-07f966750e4b`, 2026-09-24): "do not approve
yet". It found 7 HIGH and 10 MEDIUM findings, and no CRITICAL. The core arithmetic survived. Each finding is folded into
revision 2:

| # | Finding | Now |
|---|---|---|
| H1 | ring over borrowable reserves only | §5.5: every listed reserve, keyed by `(hub, assetId)` |
| H2 | complete ring ≠ whole-book totals | §5.5: three completeness claims; `totals_scope` |
| H3 | head-relative freshness never ages | §5.5: database clock, plus separate OP observation freshness |
| H4 | debt-side shocks break liqprice and waterfall | §5.4: direction boundaries; non-latching V4 waterfall |
| H5 | weld is no upgrade safety net | §5.3/§5.5: implementation identity, `IMPLEMENTATION_UNREVIEWED` |
| H6 | pacing arithmetic | one V4 stream (§5.1); go-live A1 enforced token bucket |
| H7 | unbounded SSE | go-live A5 |
| M8 | unread accounts dropped | §5.3: carried forward until zero debt is proven |
| M9 | escalation counted the wrong thing | §5.3: protocol-defined active count, after configs |
| M10 | closing read is one endpoint's view | §5.3: pin bound to custody hash; every serving endpoint witnesses; P age at open |
| M11 | B−1 is not a general pre-state | §5.10: gated only for proven-unchanged pre-state |
| M12 | absent stamp supersedes globally; shared reorg gating | §5.5: engine-scoped stamps; isolation promise narrowed |
| M13 | premium fork test | §9: collateral risk > 0, refresh, accrue |
| M14 | CAPO not observable | §5.4: linear on output, disclosed; R5 |
| M15 | rollback after migration | go-live A7 |
| M16 | backfill before deployment | §5.9: `not_deployed` state |
| M17 | Part A acceptance needs V4 | go-live §9: split acceptance |

**Codex round 2** (same session, 2026-09-24): "DO NOT APPROVE". Of the round-1 findings, 10 were resolved, 6 partial
and 1 not resolved. It also found 6 new defects: N1–N3 HIGH, N4–N6 MEDIUM. All are folded into revision 3:

| # | Round-2 verdict or finding | Now |
|---|---|---|
| H2 | PARTIAL: one total pair can't carry both claims | §5.5: two pairs, a withheld reason, precedence, no coercion (revision 4 replaces this with `book_scope`; see R3-2) |
| H4 / N2 | PARTIAL / HIGH: "both sides move ⇒ no boundary" is false | §5.4: solve the whole linear exposure; `boundary_state`; descriptions rewritten |
| H6 / N5 | PARTIAL / MEDIUM: per-domain buckets aren't a global ceiling; the runner charges walks | go-live A1: global + per-domain buckets, per-physical-request charge outside the timed attempt; §5.3 admission reservation |
| M10 | PARTIAL: `HeaderHashFrom` rotates | §5.3: no-rotation `HeaderHashAt(i)`, endpoint token checked |
| M11 | NOT RESOLVED: no log predicate proves pre-state | §5.10: realized backtest is evidence-only |
| M15 | PARTIAL: rollback ran new images | go-live A7: images tagged by commit, rollback pins the previous tag's images |
| M16 | PARTIAL: deployment-day sample predates deploy | §5.9: `not_deployed` by block comparison |
| N1 | HIGH: pin bound to ingest, not derivation; stream name used as engine key | §5.3 and §5.5: derive cursor caught up; engine key |
| N3 | HIGH: SSE cache by batch id hides live-state transitions | go-live A5: cache immutable children only; shared periodic live-metadata refresh |
| N4 | MEDIUM: waterfall contract and web invariants | §5.4: `semantics` per series; monotonicity scoped; web per-semantics |
| N6 | MEDIUM: reserve on a foreign hub bypasses the gate | §5.3 and §5.5: `foreign_hub` refusal; identity scope stated |

**Codex round 3 did not complete.** The Codex account hit its usage limit mid-review (job `task-mug1qkg4-y7xe7i`; the
limit resets 2026-09-27 15:38). Its one interim note was that reserving an estimate can't guarantee an admitted
generation never runs out of budget. That note was folded in before the stand-in round.

**Stand-in round 3** (2026-09-24; not Codex, and it does not satisfy D-006). Three independent lens reviewers covered
chain integrity, risk quant, and systems plus honesty; each finding went to an adversarial skeptic. Results are in
`.superpowers/sdd/2026-09-24-aave-v4/round3-panel.json`. **21 findings, none refuted.** After verification: 2 HIGH, 13
MEDIUM, 6 LOW. All are folded into revision 4:

| # | Finding (verified severity) | Now |
|---|---|---|
| R3-C1 | HIGH: the global decoder-revision bump restarts every engine's coverage, which fails v3 custody; the migration logs are never decoded | §5.2: per-engine revisions; migration evidence read from `raw_logs`; Debt Manager decoder untouched |
| R3-2 | HIGH: null totals don't fit the `NOT NULL` aggregates; Observatory and History would draw subset sums as the book | §5.5: stored pair = computed subset; `book_scope` on aggregates and `observatory_points`; every reader and every book-wide surface |
| R3-C2 / R3-1 | MEDIUM: the reservation can't be granted (83 against burst 20); cost depends on unmeasured chunk size | §5.3: V4 lane, lease, boot invariant, feasibility inequality gating W4, derived interval |
| R3-C3 | MEDIUM: epoch rows are pruned before close; the sweeper is a second writer | §5.3: `acked_epoch` leg, one-transaction compare-and-set seal, open generations superseded; D-004 exception in D-015 |
| R3-C4 | MEDIUM: the RPC recount (a second Step per round; the shared head conflicts with endpoint resolution) | go-live A1: caught-up signal, no shared head, recount; Part A comparator of about 100k |
| R3-C5 / R3-5 | MEDIUM: migration tagging races the Debt Manager cursor | §5.2: `moved_from` decided at read time, with three values including `pending` |
| Q1 | MEDIUM: book-level stress stays falls-only | §5.4: ETH-up scenarios and a `liquidated_above` count; the waterfall grid law is kept and stated |
| Q2 / R3-6 | MEDIUM: debt-to-target is per (collateral, debt) pair, so it is ambiguous per account | §5.4: pair-free headline; to-target as a modelled pro-rata series |
| Q3 | MEDIUM: the integer boundary vector can land liquidatable | §5.4: rounding toward raising f; `boundary_is_healthy` recomputed |
| Q5 | MEDIUM: ring gap not reflected in the stress aggregates | §5.5: `book_scope` on every book-wide surface |
| Q6 / R3-7 | MEDIUM / LOW: "continuous" and "every account" overclaim | §5.8: the per-generation check as structured data with a rendered, conditional sentence; go-live B1 uses a stamped instance |
| R3-3 | MEDIUM: database roles and grants break on restore and on new tables | go-live A4: an idempotent role matrix, re-applied after every migration and restore |
| Q4 | LOW: one engine-scoped resolver for every matrix consumer | §5.4 |
| R3-4 | LOW: rollback can silently rebuild | go-live A7: compose with no `build:`, `up --no-build --pull never`, a revision-label check |
| R3-C6 | LOW: the ceiling is per process | go-live A1: per-domain headroom reserved for reconcile and backfill; reconcile kept out of the acceptance window |
| Q7 | LOW: the migration record's stock/flow day alignment | §5.9 |
| R3-8 | LOW: the governance transition must be coherent; W4 paths | §11 |

**Codex round 3 on revision 4 is still owed** before any correctness-critical implementation (D-006). The saved prompt
is at scratchpad `round3_prompt.txt`, and the session resumes after 2026-09-27 15:38.
