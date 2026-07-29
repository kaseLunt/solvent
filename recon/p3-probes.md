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
