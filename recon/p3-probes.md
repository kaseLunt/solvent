# P3 Task 1 — Probe Pack Findings (2026-07-28/29)

Committed probe record for Phase 3 (W2). Three parallel read-only probe agents; integrator-
synthesized. Every chain read below is EIP-1898 hash-pinned; every DB read was a read-only
SELECT against the live db. **NORMATIVE for Tasks 2–6** alongside `recon/derivation-notes.md`;
where this document and the plan's pre-probe sketches disagree, this document wins (the plan
and spec were amended to match in the same commit).

Pins:
- **ETH pin (probes 1/2/4b): block 25,635,618, hash
  `0xbab4eee0b837a133236d0fbb3b7d16542eabde442cbe4ff1d333ff36a0977474`**, timestamp
  1785293507, provider eth-mainnet.g.alchemy.com (SOLVENT_RECON_RPC_ETH).
- Sweep head (probe 3): 25,635,725. DB freshness (probes 4a/5/6): OP cursor 154,848,114,
  ETH cursor 25,635,738 (2026-07-29 03:16Z).

## P-1 DISCHARGED — Aave collateral projection law: PURE FLOOR

`balanceOf = floor(scaled × getReserveNormalizedIncome / RAY)` in the current (regime-B)
deployment. 15/15 account×reserve pairs exact at the pin; 6 super-half cases each REFUTE
half-up and ceil; zero anomalies. The two discriminating vectors (all integers verbatim,
hard-code these in `internal/risk` — never compute expectations from the helper under test):

**Vector F-A (sub-half; kills ceil)** — golden borrower weETH:
`scaled 58420665095130 × index 1000002131081530318762840784` → quotient 58420789594330,
remainder 373169573115114310403781920 (frac ≈ 0.373170); chain balanceOf **58420789594330**
(= floor = half-up, ≠ ceil). aToken 0xbe1F842e7e0afd2c2322aae5d34bA899544b29db, account
0x70daaac436465a0d03e45916fa68ddee6086e5fe.

**Vector F-B (super-half; kills half-up AND ceil)** — USDC:
`scaled 348255839 × index 1060431730293296159488823376` → quotient 369301541, remainder
935513570098257995931692464 (frac ≈ 0.935514); chain balanceOf **369301541** (= floor only).
aToken 0x7380c583cDe4409eFF5DD3320D93a45D96B80E2e, account
0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c.

Five further super-half floor-only confirmations recorded in the probe transcript (weETH ×3,
PYUSD, FRAX). Debt side remains CEILING per the P2-proven law (derivation-notes.md:189).

## P-2 DISCHARGED BY FALSIFICATION — healthFactor is a SINGLE FUSED FLOOR DIVISION

The spec's pre-probe model `wadDiv(percentMul(C, LT), D)` matches the chain healthFactor for
**ZERO of 12 live borrowers under all four rounding-convention combinations** (percentMul
{half-up, floor} × wadDiv {half-up, floor}). One borrower's chain value lies strictly BETWEEN
the all-floor and all-half-up composites — the signature of no intermediate rounding.

**The deployed law (12/12 exact, 6 last-digit discriminators, fused-ceil 0/12):**

```
healthFactor = floor( totalCollateralBase × LT_bps × 1e18 / (10000 × totalDebtBase) )
```

one exact-integer multiplication, floored once (v3.5-style precision-preserving math).
Discriminator examples (chain = fused-floor; fused-half-up differs in last digit): golden
borrower C=12305519, D=13720591, LT=8100 → chain 726460718055075032 (half-up …033);
0x849b5e51… C=10000153, D=9604879 → chain 843334302285328112 (half-up …113); four more in
the transcript. `internal/risk` MUST implement the fused form; composing percentMul-then-
wadDiv is wrong under every convention.

**Disclosed caveat:** all 12 live borrowers have uniform LT=8100 bps, so "fused over the
exact weighted sum Σ(Cᵢ·LTᵢ)" and "fused over C × aggregate-LT" coincide on this book.
`internal/risk` implements the weighted-sum form (matching upstream v3.5 source); a synthetic
mixed-LT unit vector pins the distinction in the unit layer, and the reconcile component gate
(#5/#6 exact) isolates any divergence if the book ever gains mixed LTs.

Synthetic two-step boundary vectors (retained for the unit layer's convention tests):
percentMul: a=1, bps=8100 (half-up 1, floor 0); wadDiv: a=1000, bps=8100,
b=1215000000000000000001 (half-up 1, floor 0).

## eMode SETTLED — category 0 everywhere, both witnesses

- DB: **zero `UserEModeSet` events in the instance's entire life** (Pool topic0 census: 13
  distinct topic0s, 2,005 logs, UserEModeSet absent; coverage verified from configured start
  20,625,519 / first activity 20,713,917 to fresh head).
- Chain: `getUserEMode@pin` = 0 for all 12 current borrowers.
- Configurator: `EModeAssetCategoryChanged` emitted only at reserve-init, all categories 0.

HF math takes the non-eMode branch. `getUserConfiguration` worked example (golden borrower):
bitmap 6 = weETH collateral-only, USDC borrowing-only, PYUSD/FRAX untouched — consistent with
DB and both P-1/P-2 vectors.

## Book census (stress-set inputs)

- **Collateral $100.72M total; 99.97% on the DM engine** (Aave: ~$32.1k collateral, ~$2.8k
  debt — economically negligible). DM live debt ≈ $22.22M, single borrow reserve (OP USDC);
  book collateralization ≈ 4.5×. DM collateral spans 9,640 accounts / 19 assets.
- Top weights: liquidETH 41.2%, liquidUSD 27.1%, liquidRWA 7.7%, weETH 4.0%, USDC 4.0%,
  liquidBTC 3.2%, sETHFI 3.1%. ETH-linked ≈ 47%.
- **BTC leg CONFIRMED IN: liquidBTC + eBTC = $4.14M = 4.11%** (> 2% materiality bar).
- Cross-engine price sanity: composed Aave weETH (chainlink ETH/USD × getRate)
  $2,095.72 vs DM priceproviderv2 $2,099.38 — coherent.
- **Three sub-1.0 HF dust positions live at the pin** (0.496 / 0.726 / 0.843, all
  availableBorrows=0, magnitudes $0.06–$0.14) — the standing bad-debt line ships with real
  members from day one.

## Backtest frame (reconcile realized-liquidation gate)

- Population: **exactly 763** DM `Liquidated` events (topic0
  `0xfd54f2a27ee93a2b60fa895931f0067b8eab4f20662e14ef1ef0720eb772ea9c`), 1:1 raw↔typed, over
  blocks 150,057,202–153,399,414; plus 9,242 per-token `liquidation_collateral` fan-out rows
  (~12.1/event).
- **Single implementation era**: both day-1 `Upgraded` events (149,521,228 / 149,558,074)
  precede the first liquidation by ~500k blocks. No regime stratification needed.
- Distribution near-uniform per 500k blocks (121/124/128/134/111/144) + one event at
  153,399,414. **Zero liquidations in the last ~33 days** — every replay is an archive read;
  also a real protocol fact worth a side-glance in the writeup.
- **Frame fixed: N=31** — 5 uniform-random per full 500k bucket + the 153.4M singleton
  force-included, and each bucket's max-collateral-fan-out event force-included (hardest
  multi-collateral seizure math).

## Configurator sweep (Task 2 decode set) — COMPLETE, ZERO UNKNOWNS

**PoolConfigurator (proxy): `0x8438F4D29D895d75C86BDC25360c25eF0607E65d`** (via
ADDRESSES_PROVIDER `0xeBa440B438Ad808101d1c451C1C5322c90BEFCdA` .getPoolConfigurator()).
PriceOracle cross-check PASS (0x43b64f28…, set once at genesis, never changed). Governance:
provider owner/ACL admin = 0x5300A1a1…92A (Aave Governance V3 Ethereum Executor Lvl-1).

110 logs, 20 distinct topic0, 17 blocks, range 20,625,519→25,635,725. Verification: dual
independent discovery (Blockscout REST ×2 paths) + byte-identical re-fetch of all 26
event-bearing blocks on Alchemy + an independent dRPC window sweep over 34% of the range with
zero contradictions + one eth_getBlockReceipts extraction cross-check. Full per-topic0 table
with samples in the probe transcript; decode-relevant summary:

| Event | Count | HF-relevance |
|---|---|---|
| CollateralConfigurationChanged | **1** (weETH LTV 7800 / LT 8100 / bonus 10600, at reserve-init 20,713,917, NEVER re-tuned) | THE param event |
| ReserveInterestRateDataChanged | 25 | rate curve (indexes, indirect) |
| ATokenUpgraded / VariableDebtTokenUpgraded | 12+12 | token-impl semantics risk |
| SupplyCapChanged / BorrowCapChanged | 8+7 | caps (all slashed to 1 at 22,124,166 = 2025-03-25 **market wind-down** — explains the dust book; Observatory story) |
| Upgraded (configurator impl) | 5 (6 generations) | event-set era boundaries |
| ReserveInitialized | 4 | registry (**see A1**) |
| EModeAssetCategoryChanged | 4 (all → 0) | none in practice |
| ReserveFactorChanged | 4; ReserveInterestRateStrategyChanged 4; ReserveStableRateBorrowing 3 (gen-1 era name); flags/premiums/debt-ceiling/liq-protocol-fee singles | minor/indirect |

Never emitted (decode set may rule non-param by construction, but Task 2's deriver must still
refuse-loud on genuinely unknown topic0s): ReserveActive/Frozen/Paused/Dropped,
EModeCategoryAdded, UnbackedMintCapChanged, BridgeProtocolFeeUpdated, LiquidationGracePeriod*,
PendingLtvChanged, AssetCollateralInEModeChanged, AssetBorrowableInEModeChanged.

**Pool impl timeline (8 generations)** — genesis 0xF231D3E8…, then 20,920,979 / 20,977,092 /
21,917,056 / 22,839,362 / **23,088,584** (independently corroborates the P2 rounding-regime
boundary — it is exactly a Pool impl upgrade) / 24,196,552 / 24,920,567. Provider-address
events begin at **20,625,514** (5 blocks before Pool deploy) — any provider-address backfill
starts there, not 20,625,519.

## ANOMALIES (binding on Task 2)

- **A1 (CRITICAL, decode) — CORRECTED 2026-07-28 by the Wave 2a implementation (four
  witnesses: wire topics, on-chain `symbol()` reads, verified genesis-impl ABI, Pool state
  getters).** The original probe reading ("3-word body, no stableDebtToken slot: aToken,
  variableDebtToken, strategy in data") was WRONG in interpretation: the event has **TWO
  indexed args** — `topics[1]`=asset, `topics[2]`=aToken — and the 96-byte body is
  **(stableDebtToken, variableDebtToken, interestRateStrategy)**; a canonical 5-address event
  with two indexed args produces exactly this shape. `symbol()` on body word 0 reads
  "stableDebtEthEtherFiweETH"; `topics[2]` equals the aToken proxy 4/4. Implementing the
  original reading would have written the stable-debt token into the aToken registry column.
  The STRICT-READER prescription stands unchanged (canonical topic0 registration + hand-read
  `len(data)==96` + dirty-padding checks — a 4-word body is still rejected); only the field
  assignment was corrected. Landed as such in `internal/decode/configurator.go` (evidence
  trail in its header). The probes' 20-topic0 inventory and all counts were independently
  re-verified during the wave (Blockscout + Alchemy, 110/110 byte-identical).
- **A2:** dRPC free-tier archive getLogs is nondeterministically available (same query flips
  between exact data and loud E:12/E:15) and degrades under sustained load; it NEVER returned
  false/partial data when it answered — but treat a dRPC "0 logs" as a claim, not a fact.
- **A3 (operational):** the Alchemy key in .env is FREE TIER (hard 10-block getLogs cap) and
  is SHARED with the live indexer — bulk probe/backfill traffic on it 429-starves the daemon
  (observed twice). Task 2's configurator backfill (5M blocks) runs through the walker on the
  dRPC-primary posture at **FIXED window 2000** (the walker has NO adaptive halving —
  `internal/ingest/walker.go:791-793` uses the configured window as-is; corrected 2026-07-28
  per the chain-truth consult R6.4 and Codex Wave-2a round: 10k can wedge into a permanent
  backoff loop under the dRPC/publicnode posture). ≈2.5k getLogs one-time, jagged under A2
  flapping but loud and self-healing. Alchemy window-10 is a MANUAL operator playbook for
  targeted ranges only — never automatic, never bulk on the shared key.
- **A6 (curio):** provider registry contains an ASCII `MOCK_STABLE_DEBT` AddressSet
  (20,977,092) pointing at the weETH aToken — upgrade-script artifact, harmless, recorded.
- Probe-agent self-correction recorded in the transcript (an early "dRPC lied" claim was the
  agent's own hex arithmetic bug; retracted after fix — no provider dishonesty observed).

## Provider posture (Task 2 backfill calibration)

| Provider | Behavior |
|---|---|
| Alchemy free (recon + indexer key) | archive-complete, ≤10-block getLogs, loud refusal above; SHARED with daemon (A3) |
| dRPC free (lb.drpc.org) | 10k windows accepted when routed; nondeterministic archive routing, loud errors, no false data observed |
| publicnode | getLogs unusable (archive-token wall even near head), always loud |
| Blockscout REST (keyless) | discovery-grade third-party index; byte-identical to Alchemy on all 140 verified logs; never sole authority |

Integration provenance: three probe-agent reports (DB censuses; pinned vector hunts;
configurator sweep), synthesized 2026-07-28 by the integrator; agents wrote nothing to the
repo or DB. Raw agent transcripts live in the session task files; scratch evidence files
(jsonl/tsv) in the session scratchpad.

## Task 6 frozen backtest frame (committed 2026-07-29)

> **This frame is FROZEN — Task 6 consumes these exact 31 cases; re-drawing is a plan
> violation.** Any change to the seed, the bucket rule, the force-include rules, or the
> population predicate yields a different frame and invalidates every backtest result recorded
> against this one. A case whose pin is unserveable at run time is a `preflightExit`
> (chain-truth R1) — never a shrunk N, never a substitute case.

Frozen from the live db by read-only SELECT under session-forced
`default_transaction_read_only=on` (writes proven refused in the same session: `CREATE TEMP
TABLE` → `ERROR: cannot execute CREATE TABLE in a read-only transaction`). **Zero chain reads
were performed** — every pin below is the `block_hash` **as stored in `raw_logs`**, which is
the pin authority per chain-truth R1; a fresh `number→hash` resolution is banned here.

### Seed and draw algorithm (reproducible from SQL alone)

- **Seed string: `solvent-p3-task6-backtest-v1`** (exact bytes, no whitespace).
- **Population predicate:** `raw_logs` rows with `chain_id = 10` AND
  `topics[1] = 0xfd54f2a27ee93a2b60fa895931f0067b8eab4f20662e14ef1ef0720eb772ea9c`. That topic0
  was **re-derived at freeze time** rather than copied: keccak256 (golang.org/x/crypto/sha3, not
  the repo's go-ethereum path) over the canonical signature assembled from the committed ABIs
  `internal/decode/abis/DebtManagerCore.json` and `DebtManagerAdmin.json` —
  `Liquidated(address,address,address,(address,uint256,uint256)[],uint256,uint256)` — both files
  yielding the same hash, with 3 indexed args ⇒ topic arity 4, matching
  `decode.go:398`'s `requireTopics("DMLiquidated", topics, 4)`.
- **Buckets:** `bucket_start = (block_number / 500000) * 500000` (integer division — absolute
  500k-aligned OP block buckets). **B0–B5** are the six FULL buckets spanning 150.0M–153.0M;
  **B6** (153.0M–153.5M) holds exactly the singleton. This reproduces the probe record's
  121/124/128/134/111/144 + 1 histogram exactly (see census below).
- **Keyed pseudorandom order, NOT a language PRNG** (deliberate: no dependency on any runtime's
  RNG version, and re-derivable by anyone with psql):
  - case key `key(e) = lower(hex(tx_hash)) || ':' || log_index` (no `0x`, decimal log index)
  - `rank(e) = md5(seed || '|' || key(e))` — 32-char lowercase hex
  - order ascending by `rank(e)` as text, tie-break `(block_number, log_index)` ascending
- **Force-includes** (each replaces a sampled slot in its own bucket so the total stays 31):
  - **F1 singleton** — the sole member of B6 (block 153,399,414, log_index 120).
  - **F2 max-fanout, one per full bucket B0–B5** — among that bucket's events at
    `max(collateral_elements)`, the one with the lowest `rank(e)`.
  - **F3 two-pass** — pair rank `md5(seed || '|pair|' || hex(tx_hash) || ':' || hex(account))`
    over every `(tx_hash, account)` group holding ≥2 `Liquidated` events; lowest wins; **BOTH**
    member events enter the frame (the one legitimate shared tx hash in the frame).
- **Slot math:** per full bucket, `slots = 5 − |forced members of that bucket|`; the draw takes
  the `slots` lowest-`rank(e)` **non-forced** candidates of that bucket (without replacement by
  construction). Totals: 6 × 5 + 1 = **31**.
- **`collateral_elements`** (the `userCollateralLiquidated` array length) is derived **two
  independent ways and cross-checked 763/763**: (a) from the raw ABI body — the array-length
  word at `data` bytes 97..128, with the layout asserted for all 763 rows (`offset word == 96`
  and `octet_length(data) == 128 + 96·len`); (b) the count of derived `position_events` rows with
  `event_type='liquidation_collateral'` for the same `(tx_hash, log_index)`. Zero mismatches.
- **Frame digest** (so the committed frame can be verified byte-exactly): sha256 over the
  newline-terminated lines `"0x<tx_hash>:<log_index>"` in `(block_number, log_index)` order =
  **`0x740ac24077271059e1bd32511fec5f7ab5b23c2c4c182300512dcefa20f0fbf3`** (2,185-byte body).
  Computed twice — Postgres `sha256()` and an out-of-band local hash — identical.

### Census assertion — MATCHES the probe record exactly (763), era boundary NOT improvised

- **763** `Liquidated` logs on `chain_id=10` — exact match to the population recorded above.
  Single emitting address `0x0078c5a459132e279056b2371fe8a8ec973a9553`; blocks
  **150,057,202 – 153,399,414**; 471 distinct txs; 471 distinct blocks; 170 distinct accounts;
  1 distinct debt token; topic arity 4 on all 763; **zero dirty padding** on all three address
  topics; **9,242** fan-out elements (probe record: 9,242, ~12.1/event).
- **1:1 raw↔typed re-confirmed:** all 763 raw rows join to derived rows, each with exactly one
  `event_type='liquidation'` row, and per-event fan-out equal on all 763.
- **Single-implementation era re-confirmed at freeze time:** exactly two `Upgraded`
  (topic0 `0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b`) logs at the DM
  proxy, blocks **149,521,228** and **149,558,074** — both before the first liquidation, and
  **zero impl upgrades inside 150,057,202–153,399,414**. No regime stratification needed.
- **Era is closed:** OP `raw_logs` reaches 154,888,671 while the last liquidation is
  153,399,414 — ~1.49M blocks (~34 days) of zero liquidations. Every replay is an archive read.

### Composition summary

| bucket | block range | population | frame | seeded-draw | force-include |
|---|---|---|---|---|---|
| B0 | 150,000,000–150,499,999 | 121 | 5 | 4 | 1 — max-fanout (15) |
| B1 | 150,500,000–150,999,999 | 124 | 5 | 4 | 1 — max-fanout (15) |
| B2 | 151,000,000–151,499,999 | 128 | 5 | 4 | 1 — max-fanout (15) |
| B3 | 151,500,000–151,999,999 | 134 | 5 | 4 | 1 — max-fanout (15) |
| B4 | 152,000,000–152,499,999 | 111 | 5 | 2 | 3 — max-fanout (17, global max) + two-pass pair ×2 |
| B5 | 152,500,000–152,999,999 | 144 | 5 | 4 | 1 — max-fanout (10) |
| B6 | 153,000,000–153,499,999 | 1 | 1 | 0 | 1 — singleton @153,399,414 |
| **total** | 150,057,202–153,399,414 | **763** | **31** | **22** | **9** |

Frame totals: **389** `userCollateralLiquidated` elements across the 31 cases; per-case fan-out
spans the full population range (min 1, max 17).

### Two-pass census — they are the DOMINANT pattern, not a rare tail

R2 warned "a random draw may miss it"; the population says the opposite about *events* and
confirms it about *pairs*:

- Of 471 `(tx_hash, account)` groups: **179 single-pass, 292 two-pass, zero with ≥3**. So
  **584 of 763 events (76.5%) are members of a two-pass pair.**
- **Every tx carries exactly one account** (471 groups over 471 txs), so "two `Liquidated` in
  one tx" and "two `Liquidated` for the same account in one tx" coincide on this population.
- Drawing 30 of 763 catches *both* members of some pair with p ≈ 0.35 — so F3 remains load-
  bearing and force-includes both members of one seeded-picked pair
  (`0x84249d47…72a9c` @152,007,376, log indexes 157 and 160, fan-out 17 each).
- By draw, the frame also holds **14 second-pass, 8 first-pass and 9 single-pass** events, so
  the 50%-then-remainder path and the residue rule are exercised well beyond the forced pair.

### Disclosures (read these before over-reading the frame)

- **Account concentration is faithful, not a sampling defect.** `0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76`
  is **566/763 = 74.2%** of the population and **22/31 = 71%** of the frame; the other 9 cases
  span 9 distinct accounts. A per-bucket uniform draw over *events* reproduces the population's
  concentration by construction, and the probe record's rule was applied unchanged rather than
  quietly re-specified as per-account.
- **The max-fanout force-include is a weak constraint in most buckets**, because fan-out is
  heavily tied. Events at their bucket's max: 118/121 (B0), **124/124 (B1)**, **128/128 (B2)**,
  130/134 (B3), 64/111 (B4), 3/144 (B5). In B1 and B2 *every* event has fan-out 15, so F2 there
  degenerates into an extra seeded pick — stated so nobody reads it as a selective strengthening.
  Global fan-out distribution: 15×502, 1×85, 17×64, 6×53, 2×28, 4×20, 3×5, 10×3, 13×2, 14×1. The
  global max (17) occurs only in B4 and appears three times in the frame.

### Sanity checks — all PASS

1. **31** cases, **31** distinct `(tx_hash, log_index)` keys.
2. **30** distinct tx hashes. The single duplicate is intentional and legitimate: both passes of
   the force-included two-pass case `0x84249d4722ea66b898bb62300faa91fddd53cde0425c5375b2018b3290d72a9c`
   (block 152,007,376, log indexes 157 and 160) — same tx ⇒ same `block_hash` by construction.
3. `block_hash` non-null, exactly 32 bytes, and **byte-equal to the value stored in `raw_logs`**
   for that `(chain_id, tx_hash, log_index)` on all 31 — 0 mismatches, 0 nulls.
4. All 31 inside the era `[150,057,202, 153,399,414]` — 0 outside.
5. Bucket totals 5+5+5+5+5+5+1 = **31**.
6. The seeded draw is a **contiguous lowest-`rank(e)` prefix** of each bucket's non-forced
   candidates, verified per bucket — the draw provably was not cherry-picked past a skipped
   candidate.
7. Fan-out dual witness agrees on all 31 (and on all 763).

### The 31 cases

`selection` is `seeded-draw` or `force-include:<reason>`; `block_hash` is the stored `raw_logs`
pin; `account` is the DM `user` (`topics[3]`); `collateral_elements` is the
`userCollateralLiquidated` array length.

```json
[
  {"bucket": "B0", "block_number": 150057202, "log_index": 187,
   "tx_hash": "0x846bd1cb53cdc3a8d1e3910631c48d8f93e74423d29d02395e46a87406d04a17",
   "block_hash": "0x9e536de1af09f42ee10c674b850dbe452db3d8222bd61b9792b1288c8af4f8e5",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B0", "block_number": 150201196, "log_index": 279,
   "tx_hash": "0x6b1845354cfaf1126de0233c9bb3e21d596155b5a14eb47259db3b3322d1fdd7",
   "block_hash": "0x6de525185a5752a60cbb4dc67d9e0d65dee39c13da8f5279548d830d7d405cdd",
   "account": "0xbd62208344625689615b7e39204a594af6ae0a13",
   "collateral_elements": 14, "selection": "seeded-draw"},
  {"bucket": "B0", "block_number": 150201256, "log_index": 237,
   "tx_hash": "0xbe6429c436a0dd499a09f178982e863c8c4fbc4ee04d26dc4e917ae9108093d9",
   "block_hash": "0x97a999763406ecf627b44f0c94483ed6c52f2cfc9b6afe1f71250171b6223551",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "force-include:max-fanout"},
  {"bucket": "B0", "block_number": 150446029, "log_index": 221,
   "tx_hash": "0x033c9e23ee14899e1fb3b9ba7ac95164f77d48dc1edc82144b48a0b7b4bd7de4",
   "block_hash": "0xc011f3163209e33d8b90f4dcb7333aedfa653fc341fe265c522ce26ccc9aecf3",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B0", "block_number": 150467629, "log_index": 78,
   "tx_hash": "0xb15cfd33dd529e6cc02b34a8a252dc2e957728ff27181da868b3345243758a91",
   "block_hash": "0xedb61cb1a86961cde954da74dcf3c700bc4f9289f7c69ea558c391dca802bdf2",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B1", "block_number": 150856433, "log_index": 44,
   "tx_hash": "0x7fde432a6379e003d8cb36623ebc0effeacfb8a21d573cc5f2e8498498d8998b",
   "block_hash": "0x58142bd2bbd27f77d7d974de9acdc726d25a80871640c5ceb0219aa90b829b79",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B1", "block_number": 150863633, "log_index": 7,
   "tx_hash": "0x545e98387ae1e05397a4fa1c1bc166ea3f57dbeb10ed6cc8f2253da478197ff0",
   "block_hash": "0x8cb85029e12e700374f0ce34b6ceec2a98af7428d7d274e59ded5195caeb335b",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B1", "block_number": 150928436, "log_index": 93,
   "tx_hash": "0x5c1ff34d265b35a53df37302bb93c544288a34037ab2cf25cbc2b4a0a48d4dac",
   "block_hash": "0xf40425f73709f7b7b3ff35b56c2588118f881903a2c8aef818a332ad25ffe619",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "force-include:max-fanout"},
  {"bucket": "B1", "block_number": 150957238, "log_index": 72,
   "tx_hash": "0x5322d267c0d20fa5c71e4a7961e04fb132f07cc86f32d19eb3fd65ed75ac922e",
   "block_hash": "0xff5ae00e2b2b9cccb12348b57c63d5b3ab61549401d3a2cdd43e98d57269592d",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B1", "block_number": 150964436, "log_index": 105,
   "tx_hash": "0xbc925716e374a5c0cf024b2920937fafd49a1c8bcb52d316d89cf2c2bcbde67e",
   "block_hash": "0x76e914975efe63f84ec3942ec42afb8b90039324f0787c934bfece17e1ce8b79",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B2", "block_number": 151050834, "log_index": 144,
   "tx_hash": "0x14f99e7d134b7b45adae06efec4d644071f7ad273ea1eb9d5e3e7afb2b0076df",
   "block_hash": "0xafd4966481569c40812ecee3a0e3928986c3353a0e089404ca4ae10cb6f90cdd",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B2", "block_number": 151101237, "log_index": 97,
   "tx_hash": "0xe41ae8c17a2eec7aebc39434ad82f0c6c400e045c2ce09ccbc5b6ee39fd2a820",
   "block_hash": "0x58e82018e6f06124234961739dc1daec61f0bdcb7476cfaebccf22917213698b",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "force-include:max-fanout"},
  {"bucket": "B2", "block_number": 151324448, "log_index": 114,
   "tx_hash": "0x9ce2a4f071e190f39fec9514de5a85edb0cf4713905c6bcce7bc221d508a6780",
   "block_hash": "0xdc2c63408de5a5fa7d54c02082a75a87263c3b85683df0510af5c529fb60d908",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B2", "block_number": 151382043, "log_index": 5,
   "tx_hash": "0x1f82886a652a2c6556eea929623de345f3347430b4ac1cbee9ff005e9acbf4b7",
   "block_hash": "0xb644ab740fa518e4735252bd4e1e44117af689343de88aef3a877ee36ca21f34",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B2", "block_number": 151396444, "log_index": 106,
   "tx_hash": "0xec85464bc77501852e1715c508bddf8ce568a179d1b4e55204fd9886e6ba74e2",
   "block_hash": "0x10bffce9093f3899768a8654d7c7e0f42fb7b0fb1510f9a800b12bf1bb5cfda8",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B3", "block_number": 151511643, "log_index": 83,
   "tx_hash": "0x0fb4a5b0bf355f6ddfc15eb7ebd63d68320d6c6a67bda26e5b11876eca81068d",
   "block_hash": "0x6edd17394b6927f2c5729744146d92c99af9c2776b4aa58bea6c86f0f7991124",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B3", "block_number": 151533245, "log_index": 98,
   "tx_hash": "0xec29f4a2e11dc6181d40f35ef46d99ebe9af08bf2cba4b34c469c3f0ee45dd65",
   "block_hash": "0x98d931483f6ba25210b568a4c3a2b95ce4d348dad495c8731e40361df7911292",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B3", "block_number": 151554841, "log_index": 12,
   "tx_hash": "0x60376916ffc5d4c98b467c8931f27a12cf7e8b8139402b420be4f74c803828cf",
   "block_hash": "0x35a132a3639599c519e8f41da85deceeb8182c1ce17f51625f1e4e5ddaa9288b",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B3", "block_number": 151857246, "log_index": 74,
   "tx_hash": "0xc25718a732d8942d35abaec6486f1e6bd59fa9beb61d1e26449fc08a15b0b481",
   "block_hash": "0x4de70166fcbf3d7ed73d2dcb214b2af673d29971c4f6072e60328b147766d75d",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "force-include:max-fanout"},
  {"bucket": "B3", "block_number": 151958045, "log_index": 102,
   "tx_hash": "0xcd10a0d8c914631471113a02f018248417014f569a8549cd0c81a348623dbec7",
   "block_hash": "0xa9932be6d6ae532378f3cbdfa0f5f5fd111e9f92ef72c997df73052db8fc3607",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 15, "selection": "seeded-draw"},
  {"bucket": "B4", "block_number": 152007376, "log_index": 157,
   "tx_hash": "0x84249d4722ea66b898bb62300faa91fddd53cde0425c5375b2018b3290d72a9c",
   "block_hash": "0x60a1dc499938a1c70dc6377408b31bc0f8e6490ebeb4a18b1eb37b214687caf7",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 17, "selection": "force-include:two-pass"},
  {"bucket": "B4", "block_number": 152007376, "log_index": 160,
   "tx_hash": "0x84249d4722ea66b898bb62300faa91fddd53cde0425c5375b2018b3290d72a9c",
   "block_hash": "0x60a1dc499938a1c70dc6377408b31bc0f8e6490ebeb4a18b1eb37b214687caf7",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 17, "selection": "force-include:two-pass"},
  {"bucket": "B4", "block_number": 152158566, "log_index": 111,
   "tx_hash": "0x770e93363516e8f55caa5d63257a6c8306fef4648c960d9f3591e60caf607089",
   "block_hash": "0x359f777b5bcc855acd5538b41d87245ffd3d493b3e25ccd30a5ab43694b07c2f",
   "account": "0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76",
   "collateral_elements": 17, "selection": "force-include:max-fanout"},
  {"bucket": "B4", "block_number": 152423457, "log_index": 50,
   "tx_hash": "0x6c4b67f112be015a8347ee2332e8bc5c268da58898cafd46959447b20968e1e4",
   "block_hash": "0xd87dbeb88d02ce826dbcb6f59e303144ebb941407e126ed9530105f652b2c56f",
   "account": "0x80dbee8c92d4b9d36811d4e32598ceb47e690da9",
   "collateral_elements": 1, "selection": "seeded-draw"},
  {"bucket": "B4", "block_number": 152469659, "log_index": 74,
   "tx_hash": "0x3077cabd88c03759d3740db89310714ce3713c73d1f4ae278dde14f16b7bc763",
   "block_hash": "0x7350f1ce93de5fdd9e0ba21b294ec908cf07bebace17072650abc28bdb297860",
   "account": "0x145ce848119d589c35a353f736161ae9a6c537bc",
   "collateral_elements": 1, "selection": "seeded-draw"},
  {"bucket": "B5", "block_number": 152521428, "log_index": 41,
   "tx_hash": "0x44e1e9cffe66eea4a83a02e176efabe589796544d2f7f78e2d5dccc2643ea0c5",
   "block_hash": "0x74584c150b8a6f9264f107e8662e2543d022c5c2a9ec565cc036888dff1466ba",
   "account": "0xea3e4cb31c9453642cfae5077bd272dc503c58f8",
   "collateral_elements": 10, "selection": "force-include:max-fanout"},
  {"bucket": "B5", "block_number": 152543289, "log_index": 194,
   "tx_hash": "0x88c4ba9477a33191aad403e9c59b3fe3bb1fa1dc8f65a4797517bca07227f2b0",
   "block_hash": "0x2ebbdf5274e3bad24fa91d2e5c1992b2b87b4b878dda2666e795b4c04e7e1495",
   "account": "0xfd1ab83c52f577a2f607414aa06ff0396f7406b9",
   "collateral_elements": 1, "selection": "seeded-draw"},
  {"bucket": "B5", "block_number": 152543672, "log_index": 304,
   "tx_hash": "0x85923ca6e330cb5dc48752e9db9cdc0708247581805bb304dc5dcfb1d7d8a011",
   "block_hash": "0xfba10d555f75ea52bb60245aa987dc11edb7ea111ee7d59d719a05ed72a1204c",
   "account": "0x06eea344bb8dd2c38fdb8d1c6acbe2fe2821513d",
   "collateral_elements": 6, "selection": "seeded-draw"},
  {"bucket": "B5", "block_number": 152543767, "log_index": 645,
   "tx_hash": "0x5cb8161e8c63e37ea8c76ac81c0be502c045c7ca4ae9014d37b65dd6816ffc35",
   "block_hash": "0x2456c721d901a8472083cbd9d2b96ea0e81e1380b995e867c589d30d39e597db",
   "account": "0xf1b8c6f4868f9a6cd19a4a1050a0b1fc441450ca",
   "collateral_elements": 1, "selection": "seeded-draw"},
  {"bucket": "B5", "block_number": 152560935, "log_index": 104,
   "tx_hash": "0x25577e0b14eeb4067f3fe1acf8a8a4241ce3c9823805e236891fe5ff27175994",
   "block_hash": "0x33063adc6f5a0881bb6454dd2dead0235746e7d5676edae62dd43434a281a6b6",
   "account": "0x4e98223542c7957f38a71de1e44676d3f41a60f1",
   "collateral_elements": 6, "selection": "seeded-draw"},
  {"bucket": "B6", "block_number": 153399414, "log_index": 120,
   "tx_hash": "0x5cd245365f421c75196b7b64ae0347f27b69cf92f8a1ca08036565de3e741640",
   "block_hash": "0xd0df4d3002e7c83ddf835e51087776e9bc2faa1858a9777210e2d1bea2c2e1aa",
   "account": "0xe4747ad00964096f74d554324add3d87aaaffce2",
   "collateral_elements": 13, "selection": "force-include:singleton"}
]
```

### Reproducer (exact selection SQL, read-only)

```sql
WITH liq AS (
  SELECT r.tx_hash, r.log_index, r.block_number, r.block_hash,
         (r.block_number / 500000) * 500000 AS bucket_start,
         substring(r.topics[3] FROM 13 FOR 20) AS account,
         ('x' || encode(substring(r.data FROM 121 FOR 8), 'hex'))::bit(64)::bigint AS fanout,
         md5('solvent-p3-task6-backtest-v1' || '|' || encode(r.tx_hash,'hex') || ':' || r.log_index::text) AS rank_key
  FROM raw_logs r
  WHERE r.chain_id = 10
    AND r.topics[1] = decode('fd54f2a27ee93a2b60fa895931f0067b8eab4f20662e14ef1ef0720eb772ea9c','hex')
),
singleton AS (SELECT tx_hash, log_index FROM liq WHERE bucket_start >= 153000000),
bucket_max AS (SELECT bucket_start, max(fanout) mx FROM liq WHERE bucket_start < 153000000 GROUP BY 1),
maxfan AS (SELECT DISTINCT ON (l.bucket_start) l.tx_hash, l.log_index
           FROM liq l JOIN bucket_max m ON m.bucket_start=l.bucket_start AND m.mx=l.fanout
           ORDER BY l.bucket_start, l.rank_key, l.block_number, l.log_index),
pairs AS (SELECT tx_hash, account,
                 md5('solvent-p3-task6-backtest-v1'||'|pair|'||encode(tx_hash,'hex')||':'||encode(account,'hex')) pair_rank
          FROM liq GROUP BY 1,2 HAVING count(*) >= 2),
pair_pick AS (SELECT tx_hash, account FROM pairs ORDER BY pair_rank, encode(tx_hash,'hex') LIMIT 1),
twopass AS (SELECT l.tx_hash, l.log_index FROM liq l JOIN pair_pick p ON p.tx_hash=l.tx_hash AND p.account=l.account),
forced_raw AS (SELECT tx_hash, log_index, 'force-include:singleton'::text reason FROM singleton
               UNION ALL SELECT tx_hash, log_index, 'force-include:max-fanout' FROM maxfan
               UNION ALL SELECT tx_hash, log_index, 'force-include:two-pass'   FROM twopass),
forced AS (SELECT tx_hash, log_index, string_agg(reason,' + ' ORDER BY reason) reason
           FROM forced_raw GROUP BY 1,2),
fpb AS (SELECT l.bucket_start, count(*) n FROM liq l
        JOIN forced f ON f.tx_hash=l.tx_hash AND f.log_index=l.log_index
        WHERE l.bucket_start < 153000000 GROUP BY 1),
quota AS (SELECT b.bucket_start, 5 - COALESCE(fpb.n,0) slots
          FROM (SELECT DISTINCT bucket_start FROM liq WHERE bucket_start < 153000000) b
          LEFT JOIN fpb ON fpb.bucket_start=b.bucket_start),
ranked AS (SELECT l.tx_hash, l.log_index, l.bucket_start,
                  row_number() OVER (PARTITION BY l.bucket_start
                                     ORDER BY l.rank_key, l.block_number, l.log_index) rn
           FROM liq l WHERE l.bucket_start < 153000000
             AND NOT EXISTS (SELECT 1 FROM forced f WHERE f.tx_hash=l.tx_hash AND f.log_index=l.log_index)),
drawn AS (SELECT r.tx_hash, r.log_index, 'seeded-draw'::text reason
          FROM ranked r JOIN quota q ON q.bucket_start=r.bucket_start WHERE r.rn <= q.slots),
frame AS (SELECT tx_hash, log_index, reason FROM forced
          UNION ALL SELECT tx_hash, log_index, reason FROM drawn)
SELECT l.bucket_start AS bucket, l.block_number, l.log_index,
       '0x'||encode(l.tx_hash,'hex')    AS tx_hash,
       '0x'||encode(l.block_hash,'hex') AS block_hash,
       '0x'||encode(l.account,'hex')    AS account,
       l.fanout, f.reason, l.rank_key
FROM frame f JOIN liq l ON l.tx_hash=f.tx_hash AND l.log_index=f.log_index
ORDER BY l.block_number, l.log_index;
```
