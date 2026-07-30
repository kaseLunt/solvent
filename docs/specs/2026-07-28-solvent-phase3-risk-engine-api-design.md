# Solvent Phase 3 — Risk Engine + API: Design

Status: DRAFT pending owner review. Feeds the P3 implementation plan, the W2 work object, and
every Codex dispatch brief in P3.

Consult provenance (archived verbatim, binding rulings adopted):
`.superpowers/sdd/p3-consults/{risk-quant,oracle-sentinel,chain-truth}-p3-design.md`.
risk-quant: "numbers do not hold as proposed" → amended per its 3 blockers. oracle-sentinel:
"provenance breaks as drafted" → BL-1..BL-6 adopted. chain-truth: "custody holds" conditional on
its 6-item list → all adopted. This document is the amended design; every blocker is resolved in
a numbered section below.

## 1. Purpose, finish line, bar

P3 delivers the risk engine and the public API surface: health-factor math proven against chain
for **both** engines, a stress engine, and a REST+SSE API with a generated TypeScript client.

- **Finish line: built + proven, not deployed** (owner decision, 2026-07-28). Everything runs
  locally/CI with acceptance evidence; Fly.io deploy and npm publish are P5.
- **Bar: D-013 honest-use correctness, demo-grade.** Every Codex brief quotes D-013's
  adjudication line verbatim. Fix-worthy = wrong answer to an honest user; hostile-actor
  findings become disclosed limitations.
- Out of phase: alerter (P4), web UI (P5), deploys/publishing (P5).

## 2. Architecture

```
internal/risk        pure math: HF, liquidation price, stress, waterfall — zero I/O
cmd/riskd            daemon: watermark-gated recompute → risk tables → pg_notify
cmd/api              daemon: REST + SSE + OpenAPI, read-only, rate-limited, ZERO RPC calls
packages/client-ts   TS client generated from the OpenAPI spec (publishable, not published)
internal/derive      + param deriver for the new PoolConfigurator stream (§8)
internal/store       + risk-schema tables and param tables (new goose migrations)
```

Data flow: indexer (unchanged) → derived positions/prices → **riskd** (recompute on watermark
change) → risk batches → **api** (serve + SSE). Risk rows are derived-of-derived: always
rebuildable from positions + prices + params; no risk-side epoch machinery — reorg honesty comes
from watermark gating (§3) and supersession stamps (§4).

Laws inherited by construction:
- **riskd and api make zero RPC calls** (chain-truth R6.3). All inputs are durable store facts.
  Stress = price-shifts over stored inputs, never fresh reads. The only P3 component that talks
  to chain is the reconcile extension (proof harness) and the param-stream walker.
- riskd gets a PG role with SELECT-only on P2 tables, DDL/DML only on risk tables (SHOULD).
- Truth is `position_balances`; the `snapshots` history table is convenience, never input.

## 3. riskd pass: watermark vector, snapshot read, gate

(chain-truth R1 — adopted in full.)

**Watermark = a vector, not a scalar:** per engine `(last_block, acked_epoch)` from
`derive_cursors` (covers position AND price engines since Task 8 unification) + per chain
`MAX(reorg_epochs.epoch)` + DM collateral's `sweep_generations`/`snapshot_sweeps` state.

**Each pass:** one `REPEATABLE READ, READ ONLY` transaction (the `readRecheckState` shape,
`cmd/reconcile/main.go:504-522`, widened):
1. read the vector (`store.DeriveCursorStates` + `store.MaxReorgEpochs`, reused verbatim);
2. **gate**: every consumed engine must satisfy `acked_epoch ≥ COALESCE(max_epoch(chain), 0)`,
   else abort the pass as retryable — closes compute-time Window A (serving numbers computed
   from since-rewound state);
3. read all substrate (balances, rate indexes, sweeps, prices via the `LatestUsablePrice`
   predicate shape) inside the same snapshot; no network under the open snapshot;
4. commit; compute; write the batch in one separate write tx stamped with the step-1 vector.

**Trigger:** poll the vector at 1–5s cadence; recompute when any component changed, compared by
`(last_block, acked_epoch)` — never `last_block` alone (ABA blindspot). NOTIFY is used only
riskd→api as a doorbell; api re-reads tables, never parses NOTIFY payloads. No NOTIFY from P2
producers (would reopen senior-approved store code for decoration).

## 4. Serve-time honesty: batch stamps + supersession

(chain-truth R2 — adopted in full.)

Every risk batch stamps per-engine `(last_block, acked_epoch)` + per-chain max-epoch-at-compute.
api flags a batch **superseded** when any of three legs fires against a live read of the two
cursor tables:
1. current `acked_epoch` ≠ stamped — rewind happened (monotone; survives epoch pruning);
2. current `last_block` < stamped — rewind in progress;
3. current `max_epoch` > current `acked_epoch` — recorded-but-unacked epoch.

Batch + member rows commit in **one transaction**; api selects only the newest complete batch
(no torn aggregates). Refuse-to-serve on supersession is not required at demo grade — the flag
is the contract and heals at the next pass.

Disclosed residual (accepted, D-012 class): a price sample used by a batch and neutralized
after the fact is invisible to these legs; the batch recomputes within one cadence.

## 5. Risk math: two surfaces, never blended

(risk-quant R1/R2 — adopted in full.)

**Proof surface** — the reconcile extension at hash-bound pins: **every component gates EXACT,
zero tolerance.** There is no honest epsilon anywhere: all inputs are same-pin reads, all ops
integer math with known rounding direction.

**Operational surface** — riskd's live rows: **never an epsilon, always watermarks.** An HF from
60-second samples has no rounding error; it has a shelf life. Every risk row carries its
as-ofs: balances block (derive cursor), price inputs (each at its own block/updatedAt), params
watermark, DM collateral's per-account `last_success_block`, **and per-asset rate-index as-of**
(Codex round 1 [H5]: `rate_indexes` updates only on `ReserveDataUpdated` and can trail the
derive cursor badly — a current balances watermark over an old index hides the debt leg's true
shelf life; the DM APY observation block is likewise stamped into any projection). One-block
stamping is the Task-7 finding class and is banned. The P1 spec's "within rounding tolerance" phrasing (§11.3)
is amended by this document: exact-at-pin / watermarked-live, no tolerance carpet.

### 5.1 Aave engine (HF gate components — each EXACT)

1. scaled balances: bit-identity (P2's standing 87/87);
2. live debt: `rayMulCeil(scaled, normalizedDebt@pin)` — the ceiling law. Tests hard-code the
   two on-chain vectors (125415 × 1.094089…RAY → 137216; 83 × 1.000520…RAY → 84); expectations
   never computed from the helper under test;
3. live collateral: **pure floor — P-1 DISCHARGED** (probe pack, 15/15 exact at pin
   25,635,618 with super-half refutations of half-up AND ceil; vectors F-A/F-B in
   `recon/p3-probes.md`, hard-coded in the unit layer). Regime-A half-up applies only to
   historical pins < 23,088,584 (the probe sweep independently confirmed that boundary is a
   Pool impl upgrade);
4. per-reserve base value: `balance × AaveOracle.getAssetPrice@pin / 10^dec` — read the **cap
   adapter's own output** at the pin, never compose raw feed × ratio;
5. base totals vs `getUserAccountData@pin`: exact sums;
6. avg liquidation threshold: single floor division, exact;
7. healthFactor: **a single fused floor division — P-2 DISCHARGED BY FALSIFICATION** (probe
   pack): `HF = floor(totalCollateralBase × LT_bps × 1e18 / (10000 × totalDebtBase))`,
   12/12 exact at the pin with six last-digit discriminators; the previously-drafted
   `wadDiv(percentMul(...))` two-step matches ZERO borrowers under any rounding convention
   (v3.5-style precision-preserving math — no intermediate rounding). `internal/risk`
   implements the fused form over the exact weighted sum Σ(Cᵢ·LTᵢ); disclosed caveat: the
   live book's uniform LT=8100 cannot distinguish weighted-sum from aggregate-LT fusion, so
   a synthetic mixed-LT unit vector pins it and the #5/#6 gates isolate any divergence.

Declared-input honesty: prices, reserve params, eMode, `isUsingAsCollateral` flags are
`input:pinned-read` (`getUserConfiguration@pin`, `getUserEMode@pin`, `getConfiguration@pin`),
labeled as such in the gate schema — the gate proves derived balances + the math pipeline.
Empty-set probes included (accounts with zero on-chain debt, accounts never seen in events).

> **Amended 2026-07-29 (collateral-flag micro-task, 62c6196):** `isUsingAsCollateral` now has
> an event-derived witness in custody (`ReserveUsedAsCollateralEnabled/Disabled` folded into
> `position_events`; law: witnessed-true / witnessed-false / no-history ⇒ false). Per
> chain-truth R5.5, the pinned `getUserConfiguration@pin` read stays authoritative for the
> Task 6 gate AND becomes the WELD PARTNER for the event-derived flag: the gate now proves the
> derived flag against the chain bitmap rather than trusting either alone. riskd's former
> assume-true posture (`aave_collateral_flag_unwitnessed`) is retired.

### 5.2 Debt Manager engine

`HF_dm := getMaxBorrowAmount(user, false) / borrowingOf(user)` (both USD 6-dec). The view
functions are **proof-side witnesses only**; the operational surface recomputes the same
quantities from store facts (derived debt × replayed index, swept collateral, param table,
polled prices) under riskd's zero-RPC law. Gate legs, all EXACT at pins: (1) debt leg — derived replay × `getCurrentIndex@pin` vs `borrowingOf@pin`
(index linear between events, replayed exactly); (2) collateral+threshold leg — recompute from
`CashLens.getUserTotalCollateral@pin` (the lens nets pending withdrawals — raw Safe balance
reads drift) + `PriceProviderV2.price@pin` + param table, floor sites cited, vs
`getCollateralValueInUsd@pin` and `getMaxBorrowAmount@pin`; (3) **boolean weld** — recomputed
`debt > maxBorrowLT` equals `liquidatable(user)@pin` per sampled borrower (strict inequality;
equality is healthy); (4) empty-set probes; (5) the backtest below.

**Realized-liquidation backtest (named acceptance item):** **N=31, frame fixed by probe** —
5 uniform-random per 500k-block bucket (six near-uniform buckets over 150.06M–153.0M) + the
153,399,414 singleton, force-including each bucket's max-collateral-fan-out event; all 763
events sit in a single DM implementation era (both day-1 upgrades precede the first
liquidation), so no regime stratification; recompute state at liq-block−1 and liq-block from archive reads + param
table; assert `liquidatable == true` at execution. One table: N replayed, N agreeing, 0
tolerance.

**Detection-latency statement (product copy + meta):** DM collateral is sweep-dominated (~1h
worst case: 3600s interval + ~33min pass) while prices are 60s — every DM HF row and the alerts
docs state the per-leg bound. Never a 60s-fresh badge over hour-stale collateral.

Engines are never blended into one number: DM liquidatable is a strict boolean with two-pass 50%
closes and no bonus in the health test; Aave HF is continuous. Two labeled surfaces.

## 6. Stress engine

(risk-quant R3/R4 + oracle-sentinel R3/R4 — adopted in full; the spec's original depeg scenario
was oracle-counterfactual and is re-specified here.)

**Primitive axes only** — ETH/USD, weETH/ETH redemption rate, per-stable USD, borrow APY —
propagated through each engine's **actual pricing transforms**: DM stable snap band (±1% snaps
to exactly 1e6 — model the step, disclose the USD-normalized-debt asymmetry), Aave cap adapters
(caps bind upward; down-shocks pass through — cap-slack checked, not assumed), lens-asset base
composition (ETH shock propagates to composed assets via their base). Never linear-scale stored
rows; never shock derived USD feeds independently.

**Scenario set v1** (committed JSON config in-repo; each ships as shocked-axes + path assumption
+ census query + recomputable expected-loss arithmetic + propagation matrix + out-of-model
list):
- **ETH −10/−20/−30%** — factor shock; all ETH-linked collateral moves jointly (weETH =
  rate × ETH by construction).
- **weETH redemption-rate −5%** — the slashing/exploit counterfactual; the scenario that
  actually moves both engines' oracles (replaces the incoherent "market depeg 0.95" HF shock).
- **weETH market depeg (oracles held)** — explicitly NOT an HF event by oracle construction;
  implemented as a **separate market-realization axis** (market value ≠ oracle mark, distinct
  types — Codex round 1 [M8]) producing shortfall outputs: liquidation-execution shortfall +
  bad-debt-at-liquidation ("the protocol keeps pricing weETH at the rate; here is the gap it
  is not seeing"). Its pinned test asserts HFs bit-identical AND shortfall > 0 — the forbidden
  implementation is an HF shock wearing a depeg label.
- **Stable depeg crossing the snap band** — CORRECTED by Wave 4 against `PriceProvider.sol`
  source (:307-310): the band is **OPEN** — `(990000, 1010000)` exclusive — so exactly-0.99
  (990000) does NOT snap; it is a real price move. Three scenarios ship: 0.995 (true
  in-band no-op), 0.99 (the boundary discriminator — the original "0.99 no-op" claim was
  arithmetically false at exactly this point), 0.98 (unsnapped).
- **ETHFI −50%** — idiosyncratic own-ecosystem-token scenario.
- **DM rate horizon projection** — +200bps as closed-form debt(t) at 30d/90d +
  time-to-liquidatable, labeled PROJECTION (prices held flat, admin-set APY); no spot-HF rate
  shock; Aave engine excluded (utilization-driven, residual dust book) and disclosed.
- **BTC leg (liquidBTC/eBTC −20%)** — CONFIRMED IN by census: BTC-denominated collateral is
  4.11% of the book ($4.14M), above the 2% materiality bar (`recon/p3-probes.md`).

**Liquidation price:** headline = factor-level closed-form solve
(`s* = (debt − Σ_{i∉F} cᵢLTᵢ) / (Σ_{i∈F} cᵢLTᵢ)`, P* = s*·P_now); per-asset ceteris-paribus
demoted to a labeled diagnostic. Disclosures: factor membership, held inputs, watermarks, DM
strict-inequality boundary.

**Waterfall:** cumulative **debt eligible for liquidation** by grid point (not "will be
liquidated" — DM two-pass close noted on-surface), plus collateral-at-risk
(min(collateral, debt × (1+bonus))) and the insolvent-if-liquidated bad-debt census. Standing
invariant: single-factor down-shock series must be monotone — violations surface, never
smoothed. A standing "current bad debt" figure (the HF 0.73 golden-vector dust position makes
this a feature, not an embarrassment). Dust honesty: never render more precision than the chain
computes (8-dec base).

## 7. Price honesty at the API (adopted BL-1/BL-2)

**Per-input disclosure on every served number** (oracle-sentinel R1): witness source string,
chain + block binding, as-of from the round's `updatedAt`/anchor-block timestamp (NEVER
`observed_at` for feed rows — DB insert time, backfill-contaminated), freshness verdict against
that input's OWN budget (with the budget), provenance class (`engine-exact` /
**`adapter-output`** / `uncapped-feed` / `ratio-reference`). Single summary timestamp only as
`oldest_price_input`, labeled. **riskd persists FULL input snapshots — value, decimals, block,
as-of, source, provenance, budget, verdict — into the batch's own rows, never identity
references** — serve-time re-derivation is a TOCTOU lie, and identity joins break too: D-012
neutralization flips validity in place and later polls supersede the same key, so a
serve-time join can disclose a different input than the batch used (Codex round 1 [H6]).

**Adapter-output custody (Codex round 1 [H4]):** the P2 feed stream is deliberately uncapped,
so riskd valuing Aave collateral from it would go wrong exactly when a cap binds. Task 2
extends the ETH poller to poll `AaveOracle.getAssetPrice(asset)` per reserve (60s cadence,
EIP-1898 anchor-pinned, source `aaveoracle:<addr>`, class `adapter-output`); riskd's Aave
valuation consumes ONLY `adapter-output`/`engine-exact` rows; the reconcile weld compares
sampled adapter-output rows against pinned reads. Uncapped feed rows remain
reference/observatory surfaces.

**Durable truthful as-of (Codex round 2 [NEW-H]):** `prices.observed_at` and the stored poll
anchor's timestamp are DB insertion time — fabricated freshness if served as an as-of, and
riskd's zero-RPC law forbids recovery at read time. Additive `prices.source_as_of` column:
poll rounds persist the pinned anchor block's header timestamp; feed derivation persists
`AnswerUpdated.updatedAt`. A NULL `source_as_of` input is REFUSED for as-of purposes (G1
missing-input handling) — `observed_at` is never silently substituted.

**Degradation gates:** REFUSE-and-serve-last-good (position-scoped): G1 missing/over-ceiling
input (`R = 2 × T_f`; never silently drop an unpriced asset), G2 unacked price reorg epoch on
the asset's chain, G3 store unreadable. COMPUTE-AND-FLAG: G4 stale-within-ceiling (flag
propagates to every containing aggregate), G5 large single-step move (policy bound, disclosed
as policy; never refuse on value — the polled price IS the engine's charging price). Never
interpolate across D-012 gaps. Last-good keeps its ORIGINAL disclosure; re-stamping is
fabricated freshness. Degradation transitions ride SSE as events.

**Heartbeat provenance (BL-6, escalation trigger):** three of four feed budgets are
published-not-verified. P3 wires heartbeat bounds into public staleness verdicts, so: the meta
payload carries a per-feed provenance grade (`verified` / `published-not-verified`) from day
one, and the **B3 empirical heartbeat scan is a named P3 task** that upgrades the grade.

**Single-view disclosure (no new infra):** static trust statement per source class in API docs;
per-response manipulation-window note (60s samples; intra-interval wicks invisible by
construction; for `priceproviderv2` inputs our numbers are exactly as manipulable as the engine
itself — no more, no less); public status surface includes `NeutralizedPriceStats`.

## 8. Parameter custody

(chain-truth R3 + risk-quant R5 — adopted; chain-truth's ledger-classification wins over
poll-sampling: params are ledger data, a gap is a wrong liquidation threshold.)

- **DM: zero new RPC.** Param history is already custodied — `CollateralTokenConfigSet` /
  `BorrowTokenConfigSet` live in `position_events` from genesis (record-only rows, payload
  carries old+new tuples). P3 adds a derived param table/view over existing rows.
  `LiquidationThresholdUpdated` is declared-never-emitted — not designed against.
  `CollateralTokenRemoved` recorded as a valuation discontinuity (lens omits the token; convert
  reverts); stress must not crash on held-but-removed tokens.
- **Aave: one new walker stream — the PoolConfigurator address.** Reserve-config and
  eMode-category events are configurator-emitted and currently un-indexed; without the stream,
  Aave param history is unobtainable. The stream inherits coherent-window custody, reorg
  epochs, and raw_logs SoT for free — **via a dedicated `aave_param` engine identity wired
  end-to-end** (config enum, decode registration, cmd/indexer worker, health/frontier; Codex
  round 1 [H3]: the existing enum rejects unknown engines and routing configurator events into
  the Aave position engine crashes on unhandled topic0s), **with an atomic `RewindParams` leg
  carrying `RewindDerived`'s FULL contract** (engine binding, acked-epoch read, effective
  target lowered to the deepest unacked `rewound_to`, MAX-epoch read, deletion, cursor reset,
  and ack in ONE transaction — Codex round 2 [H3]: a caller-supplied epoch with a single-height
  delete greens the cursor over orphaned rows under stacked honest reorgs; stacked-epoch
  regression required; the harness proves a re-mined param row is replaced, not orphaned). **Step-0 topic0 sweep** (mandatory): every topic0 the
  configurator ever emitted is decoded or explicitly ruled non-param in a committed table —
  for params, an unhandled config event IS a wrong HF. Backfill posture: probe first (R-001
  discipline); dRPC archive-getLogs contraction is recorded volatility — carry the
  Alchemy-window-10 fallback from the catch-up playbook.
- **The weld (binding):** at each reconcile pin, event-derived current params vs pinned
  `getConfiguration`/`collateralTokenConfig` reads (EIP-1898, reported-hash law). Divergence =
  refuse to serve params, loud. Detects config mutation without events (upgrade risk) and
  genesis gaps on day one. Params-as-of keys on `(block_number, log_index)` per chain, joined
  per-engine (DM↔OP cursor, Aave↔ETH cursor); "HF as-of block H" = end-of-block state. Proxy
  `Upgraded` events mark regime boundaries; no historical-exactness claim across unverified
  impl windows beyond P2's archive-pinned record.
- eMode census run once during implementation; if any live borrower has non-zero category, the
  category param rows join the table (configurator-emitted).

## 9. Pipeline-replay harness (C2 amendment honored)

(chain-truth R5.) Early placement: **bound to the param-stream task as its acceptance gate**;
the reorg leg exists before api serves public numbers. Scope: anvil fork at a hash-pinned block
(opt-in env pair, fails-never-skips once opted in, sanitized sinks — the Task-10 pattern);
walker Step → decode → derive over a small pinned range with known subjects (a config change, a
borrow, a liquidation), `raw_logs` bytes asserted equal to fork logs, derived rows asserted
against fork view calls; **the reorg leg**: forced fork-side reorg driving Rewind → durable
epoch → RewindDerived → riskd gate-refusal → recompute, end-to-end.

## 10. API surface

```
GET /v1/book                     aggregates, HF histogram, waterfall (+ bad-debt line)
GET /v1/address/{addr}           per-engine positions, HF/liquidatable, liq prices, as-ofs
GET /v1/address/{addr}/stress    scenario results (scenario config version included)
GET /v1/observatory              migration time series (per-engine TVL/counts/rates)
GET /v1/stream                   SSE: batch ticks carrying the watermark vector; heartbeat;
                                 degradation transitions as events; snapshot-on-connect
GET /v1/meta                     watermark vector + ages (DB-clock), reorg posture (3 legs),
                                 per-(asset,source) price state incl. valid=false visibility,
                                 sweep three-state counts, NeutralizedPriceStats,
                                 confirmation-lag constants, heartbeat provenance grades,
                                 scenario config version, service versions
```

OpenAPI-first: the spec file is the contract; handlers contract-tested against it; client-ts
generated from it. Read-only, no auth, rate-limit middleware, CORS open. Lag/staleness always
computed DB-clock vs durable stamps (never per-request RPC head — api makes zero RPC calls; the
SSE tick means "new batch at watermark V", never "new block"; ≥5-block confirmation trail + 60s
price cadence + ~1h sweep cadence published as constants). Every string surface sanitized of
endpoint URLs (round-22 M2 class). Never-swept/failed-sweep accounts serve refused/flagged HF,
not HF≈0 (the `0xe957…bf20` posture, row-level).

## 11. Testing & acceptance shape

- `internal/risk`: golden vectors hard-coded from chain (ceiling vectors; floor vectors from
  P-1; percentMul boundary from P-2; **cap-binding synthetic vectors** — validation must not
  only pass in calm weather; snap-band step vectors), ~100% coverage target, mutation waves.
- Reconcile extension: both engines' HF gates + boolean weld + empty-set probes + param weld +
  adapter-output weld + realized-liquidation backtest, all EXACT, folded into `make reconcile`
  acceptance — **with cohort floors** (Codex round 1 [H7]: Aave ≥ 20, DM ≥ 25, empty-set
  probes ≥ 10 per class, backtest ≥ 25, welds covering all configured reserves; an empty
  cohort is a gated FAILURE, never a pass).
- API: contract tests from the OpenAPI spec PLUS a **seeded exact-value suite** (fixture store
  → exact non-empty JSON assertions for book/address/stress/observatory, per-address
  isolation, disclosures, last-good-keeps-original-disclosure; schema-valid-but-wrong and
  empty-but-valid both fail — Codex round 1 [H7]); SSE integration test; supersession-leg
  tests.
- Harness (§9) gates the param-stream task; `-race` suite; live-db suite unchanged.
- D-006 Codex review on every complex surface; **every brief quotes D-013's adjudication line**.
- W2 acceptance (canonical commands, W1 shape): full suite green live-db; `make reconcile` with
  HF gates 0 gated failures; contract tests green; harness green at its pins.

## 12. Control-plane transition (this document's landing)

One coherent P3-entry train: D-013 + this design doc + W2 work object (owned paths:
`internal/risk/**`, `cmd/riskd/**`, `cmd/api/**`, `packages/client-ts/**`, param
deriver/migrations, reconcile extension; acceptance per §11; `invalidated_by`: migrations,
derive, prices, store read surfaces, recon notes) + integrator claim opened + **W1 archived at the
work level** (`status: achieved → archived`, a legal work status that skips achieved-state
re-validation, so P3 migrations cannot trip its fingerprint; the receipt stays immutable in
history — we archive rather than pretend re-attainment). Mechanics per Codex rounds 1–2 [H1/H2]:
the train is TWO commits — a roadmap-only bootstrap (scope_gate law: a newly staged claim
authorizes roadmap/** only) carrying D-013 + W2 + claim + ROADMAP/STATUS + the W1 archival
**+ the doctor archived-evidence policy** (receipts of archived/superseded work keep their
tested-commit-internal checks but skip current-snapshot fingerprint drift — otherwise W1's
receipt fails doctor on the first P3 migration regardless of W1's status; selftest-covered,
enforcement change under the owner ack), then the plan/spec/consult artifacts + the
`.superpowers/sdd/.gitignore` consult-archive re-inclusion under the committed claim. W2 declares `depends_on: []`
(doctor requires an active work's dependencies to be status:achieved; the W1 lineage lives in
W2's prose).

## 13. Disclosed limitations (carried or new; none honest-use-blocking)

1. Batch-then-neutralized price residual (§4; D-012 class, heals in one cadence).
2. Single-view price pipeline (disclosure contract §7; availability/witness-trust class).
3. Intra-sample price wicks invisible by construction (D-012).
4. DM collateral sweep-dominated staleness ~1h worst case (stated per-row, §5.2).
5. Aave rate scenarios excluded (utilization-driven; residual dust book).
6. `rate_indexes` is as-of-last-event; the index's own as-of block is stamped and disclosed on
   every row (§5), and accrual-to-timestamp projection stays optional-with-vectors.
7. P2 carryovers: L1 flush-time empty-doc backstop; wiring-guard identifier tail; round-20
   TLS/hostile-context class (all recorded in P2 archives).

## 14. Errata this document issues against earlier docs

- P1 design spec §3 "reads RedStone/Chainlink prices": **false against the built system** —
  actual read paths are PriceProviderV2 (OP), Chainlink aggregators + cap adapters (ETH). No
  RedStone anywhere. Public copy must never repeat it.
- P1 design spec §11.3 "within rounding tolerance": amended to exact-at-pin /
  watermarked-live (§5).
- P1 design spec §4 stress list: "weETH/ETH depeg to 0.95" as an HF shock is
  oracle-counterfactual; superseded by §6's two-scenario treatment.
