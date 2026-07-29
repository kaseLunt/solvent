# oracle-sentinel P3 design consult — 2026-07-28 (P3 entry, pre-plan)

Standing persona: oracle-sentinel (fable). Advise-only. Verbatim rulings archived from the live
consult; feeds the P3 design doc and every Codex brief touching prices/staleness/stress.

VERDICT: PROVENANCE BREAKS as drafted; adopt BL-1..BL-6 and it flips to PROVENANCE HOLDS.

---

## R1 — Staleness disclosure contract. BINDING-RECOMMENDATION

A single as-of timestamp is not honest for this pipeline, and there is a second trap in WHICH
timestamp.

**Why a single T lies.** Two lineages with incommensurable freshness semantics: OP polls are
60-second point samples with a 3-interval grace (`internal/prices/poller.go:188-192`); ETH feed
rows are event-driven with per-feed budgets from 1h30m (ETH/USD leg) to 25h (stables) — the 25h
heartbeat is an operational fact, not staleness (`recon/derivation-notes.md:325-330`). A single
T is either the newest input (hides a legitimately-24h-old USDC round behind a 60s-old poll) or
an unlabeled blend.

**The timestamp trap.** `prices.observed_at` is DATABASE insertion time
(`internal/store/prices.go:344-346` says so explicitly), and Task 9 backfilled from scratch, so
every historical feed row's `observed_at` is backfill time. Any "prices as-of T" derived from
`observed_at` for feed rows is fabricated freshness. The feed deriver already judges freshness
from the AnswerUpdated `updatedAt` in `raw_logs` (`internal/prices/prices.go:801-807`); the API
must draw as-of from the same well.

**Minimal per-input disclosure (the floor below which a served HF lies):**
1. **Witness identity**: the verbatim `source` string — `priceproviderv2`, `chainlink:0x…`,
   `ratio:getrate:0x…` (`internal/prices/prices.go:283-301`).
2. **Block binding**: `chain_id` + `block_number`. For poll rows this is the anchored,
   EIP-1898-pinned round block (`internal/prices/poller.go:825-860`).
3. **As-of time**: feed rows — the round's `updatedAt` (from raw_logs) or block timestamp,
   never `observed_at`; poll rows — the anchor block's timestamp (`observed_at` secondary).
4. **Freshness verdict against the input's OWN budget**: age, the per-feed threshold judged
   against (heartbeat+grace from the registry; cadence×grace for polls), fresh/stale. A verdict
   without its budget is a number without a shelf life.
5. **Provenance class**: `engine-exact` (DM poll — the exact function the engine charges
   against) vs `uncapped-feed` (Aave stream — "Nothing here claims stream == adapter price") vs
   `ratio-reference`. The public surface must not let a reader mistake an uncapped reference for
   the pool's guaranteed price; that caveat is currently a package comment and must survive the
   trip to JSON.

A single summary timestamp is permitted ONLY as `oldest_price_input` (the min), labeled as such,
linking to the per-input table.

**Persistence requirement:** riskd must persist the input identities
`(chain_id, asset, source, block_number)` with each materialized risk row. If `cmd/api`
re-derives disclosure at serve time from current newest rows, a poll landing between compute and
serve makes the HF testify about inputs it did not use — a TOCTOU lie.

## R2 — Degradation gates. BINDING-RECOMMENDATION

Fail closed on *unprovable*, compute-and-flag on *stale-but-provable*, never refuse on *value*
alone. All gates derived from durable store facts — never from IPC with the indexer's health
endpoint.

**REFUSE to recompute (serve last-good + `degraded` + reason; if no last-good, "unavailable" —
never a number):**
- **G1 — Missing input.** Any asset in a position's collateral/debt set with no usable price
  ever, or newest usable row older than the refuse ceiling `R = 2 × T_f` (T_f = that input's own
  budget: heartbeat+grace for feeds; pollHealthGrace × interval = 3×60s for polls). Scope
  refusal to the position, not the book. **Never silently drop an unpriced asset from the
  sums** — dropped collateral understates HF (false liquidation alarm), dropped debt overstates
  it (false safety).
- **G2 — Reorg epoch pending.** An unacked reorg epoch for the price engine on an asset's chain:
  newest rows may be minutes from permanent D-012 classification. Refuse for that chain's
  assets; last-good-with-flag is the public's answer.
- **G3 — Store unreadable / hydration failure.** Serve last-good degraded, mirroring
  `ConditionPollFreshnessUnhydrated`'s fail-closed-after-grace posture.

**COMPUTE-AND-FLAG:**
- **G4 — Stale within ceiling.** T_f < age ≤ R: compute, flag the input stale, propagate the
  flag to the HF and every aggregate containing it (a waterfall built on one flagged HF is a
  flagged waterfall).
- **G5 — Large single-step move.** Move beyond a disclosed per-class policy bound (registry
  records no deviation thresholds, so any bound is policy — say so): flag `large_move`, compute
  with the new value. **Never refuse on value:** for `priceproviderv2` the polled number is what
  the engine charges at liquidation — refusing it makes our HF diverge from the engine's own
  liquidation decision exactly when it matters. Value-refusal is how a risk surface goes blind
  during the event it exists to observe. The one legitimate value-refusal already exists at the
  store (non-positive quarantine, migration 00005 CHECK).
- **G6 — Neutralized rows near the window.** No input gate needed — marked rows are structurally
  invisible to `LatestUsablePrice`, absence surfaces as age (G1/G4). Prescriptions: (a) never
  interpolate across the hole — filling a D-012 gap is fabrication; (b) surface
  `NeutralizedPriceStats` on riskd's/api's status surface (clause 6 visibility goes public).

**Last-good discipline:** a re-served last-good keeps its ORIGINAL per-input disclosure and
as-of; re-stamping with serving time is fabricated freshness. Degradation transitions ride the
SSE stream as events, not only REST fields.

## R3 — weETH/ETH depeg shock coherence. BINDING-RECOMMENDATION

The 0.95 "market depeg" shock, applied to either engine's oracle, **shocks a feed neither
protocol uses** — the single largest coherence defect in §4 as drafted.

**Actual wiring (recon, NORMATIVE):**
- **EtherFi Aave market (ETH):** NOT RedStone, not a market feed.
  `AaveOracle.getSourceOfAsset(weETH)` is the cap adapter "Capped weETH / eETH(ETH) / USD":
  ETH/USD Chainlink proxy × `RATIO_PROVIDER()` = weETH `getRate()` — the contract's own exchange
  rate, growth-capped on the upside (`recon/derivation-notes.md:290-297`). No secondary-market
  weETH price anywhere in that read path.
- **Debt Manager (OP):** composite of a weETH/ETH *exchange-rate* feed (18-dec) × ETH/USD
  (`recon/derivation-notes.md:283`).

**Consequence:** weETH at 0.95 on market with `getRate()` unchanged → both protocols keep
pricing at the exchange rate → no HF moves, no liquidations. A stress row reporting "$X becomes
liquidatable" reports liquidations the protocols' read paths cannot produce —
manipulation-theater: names one attack (market depeg), models another (rate collapse) silently.

**Honest expressions — pick one, disclose in the scenario definition:**
- **(a) Rename the axis: "weETH exchange-rate shock −5%"** (slashing/exploit counterfactual).
  Coherently moves both engines' oracles (DM composite follows the rate feed; Aave adapter
  passes downside through — the growth cap binds upward only). The scenario that actually
  produces liquidations.
- **(b) Keep "market depeg 0.95" and model what it actually does:** oracles unchanged, HFs
  unchanged; report liquidation-execution shortfall (liquidators receive collateral worth 0.95×
  oracle on market) and bad-debt-at-liquidation. The more sophisticated product: "the protocol
  keeps pricing weETH at the rate; here is the gap it is not seeing."

(a)+(b) as two labeled scenarios is best. Silently shocking a nonexistent market feed is a
blocking finding against the design.

## R4 — Correlated shock propagation. BINDING-RECOMMENDATION

Shock the **primitive axes the wiring actually has**, propagate through each engine's actual
pricing function; never shock derived USD feeds independently.

**Primitive axes:** (1) ETH/USD market; (2) weETH/ETH exchange rate; (3) per-stable USD;
(4) borrow rate. "weETH −20%, ETH flat" is an implicit 20% slashing claim wearing a market-crash
costume; "weETH −20% AND ETH −20%" double-counts through the ratio.

**Propagation through protocol transforms, not linear scaling of stored rows:**
- **DM stable snap:** `isStableToken` snaps to exactly 1e6 inside ±1%. USDC −0.5% moves the DM
  price not at all; USDC −5% exits the band and jumps to the feed. Linear scaling of stored
  `priceproviderv2` rows is wrong in both directions.
- **Aave cap adapters:** stored feed rows are the *uncapped* stream. Downside shocks pass
  through (caps bind upward), so down-grid results approximate adapter output only while caps
  are slack — must be checked, not assumed. Derivation note NORMATIVE: "P3 must implement the
  growth-cap behaviour, or read the adapter's own output, before claiming adapter equivalence"
  (:309-311).
- **Lens-asset composition:** several OP lens assets carry baseAsset composition (ETH, WBTC,
  USDC, ETHFI — :284); an ETH shock must propagate via their base or the waterfall silently
  holds a chunk of TVL at pre-shock prices.

**Scenario-definition disclosure contract:** primitive axes moved and held; full propagation
matrix (asset × axis → response); which protocol transforms applied (snap, caps, adapter
semantics); explicit out-of-model list — oracle lag/heartbeat during the move,
deviation-trigger discreteness, liquidator liquidity and cascades, market correlation not
mechanically implied by the wiring.

## R5 — Single-view risk disclosure. BINDING-RECOMMENDATION (disclosure only)

1. **Static L2Beat-grade trust statement** in API docs, one row per source class: Chainlink OCR
   quorum for feed rows; ether.fi accountants/updaters for lens and custom feeds (not AMM-spot,
   not donation-manipulable — a genuine strength); the serving RPC node's implementation of the
   EIP-1898 hash pin per poll round; the D-012 clause-4 endpoint rule for markings, including
   ADD-1's single-view disclosure when only one endpoint is configured.
2. **Per-response provenance note + manipulation-window statement:** polled prices are 60-second
   point samples — an intra-interval spike is invisible to us and to nothing else we could have
   read; feed rows capture only committed AnswerUpdated rounds. The honest asymmetry: for
   `priceproviderv2` inputs single-view is not a valuation weakness — the polled value IS the
   engine's charging price, so our numbers are exactly as manipulable as the protocol, no more
   no less. Residual single-view exposure is availability and witness trust, not value.
3. **Public /status surface** carrying pipeline conditions, pending reorg epochs, and
   `NeutralizedPriceStats` (count + age) — D-012 clause 6 visibility promoted to public.

## R6 — Remaining embarrassments

1. **BINDING — Golden vectors must include cap-binding cases.** Validation against
   `getUserAccountData()` passes trivially while caps are slack and diverges exactly in a
   crisis. Add synthetic cap-binding vectors or a live read of the adapters' own outputs.
2. **BINDING — B3 heartbeat provenance must ride the API.** Three of four budgets
   (USDC/PYUSD/FRAX, 86400s) are published-not-verified ("open work, not a completed claim",
   derivation-notes :328-341). Verify before public serving, or the disclosure carries the
   qualifier verbatim.
3. **SHOULD — Kill the RedStone claim in public copy.** Spec §3 says the indexer "reads
   RedStone/Chainlink prices"; nothing in this repo reads RedStone. Falsifiable in one Etherscan
   visit.
4. **SHOULD — Sample-freshness vs oracle-freshness.** Some OP custom adapters tolerate 7-day
   staleness internally (:286). Poll freshness attests "we read the contract 60s ago," not "the
   value inside it is recent." Engine-exact covers valuation; the disclosure must carry both
   ages or label the distinction.
5. **SHOULD — Anchor identity on the traceability hover.** Join `price_poll_anchors` to show
   the round's block hash for poll inputs — value + block + witness, the full triple.
6. **NOTE — Compute-block vs price-block honesty.** "Computed at eth N / op M" describes
   position state; price inputs sit at their own blocks. Never let the summary line imply all
   inputs sit at N/M.

## Verdict — PROVENANCE BREAKS as drafted; blocking list

- **BL-1 (R1):** per-input disclosure (witness/source, block binding, per-budget freshness
  verdict, provenance class); input identities persisted with every materialized risk row;
  as-of from oracle `updatedAt`/block time, never `observed_at`.
- **BL-2 (R2):** refuse gates G1–G3 with last-good-plus-degraded; no silent asset drops; no
  interpolation across D-012 gaps; no value-based refusal.
- **BL-3 (R3):** depeg scenario must not shock a feed neither protocol uses — re-axis as
  exchange-rate shock, or model market depeg as execution-shortfall with oracles held.
- **BL-4 (R4):** shocks on primitive axes propagated through snap/cap/adapter semantics;
  scenario definitions publish propagation matrix + out-of-model list.
- **BL-5 (R6-1):** cap-binding validation vectors before any "matches on-chain" claim.
- **BL-6 (R6-2):** B3 heartbeat provenance qualifier (or verification) before per-feed budgets
  are published as fact.
