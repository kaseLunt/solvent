# chain-truth consult — P3 Task 6 weld semantics + collateral-flag micro-task sizing

> Archived verbatim from the standing chain-truth persona (fable), 2026-07-29 ~17:45
> local. Requested by the integrator BEFORE writing the Task 6 wave brief; includes a
> read-only live-DB probe (RR snapshot, forced read-only) sizing the collateral-flag
> micro-task. VERDICT: CUSTODY HOLDS for Task 6 as planned, conditional on the 6-item
> blocking list (final section) — NORMATIVE for the Task 6 wave. Micro-task: GO, with
> the material finding that riskd's assume-true collateral posture is wrong for 35/58
> (60%) of positive collateral rows (HF right by accident — LT=0; collateral
> aggregates wrong).

Both deliverables complete. Full ruling follows.

---

# CHAIN-TRUTH CONSULT — Task 6 weld semantics + collateral-flag micro-task sizing

Standing persona: chain-truth (fable). 2026-07-29, HEAD 846c241 (+ uncommitted reconcile pgxdsn work). Sources: repo reads; read-only live-DB SELECTs under session-forced `default_transaction_read_only=on` inside one RR snapshot; independent keccak derivation (golang.org/x/crypto/sha3, not the repo's go-ethereum path). Prior canon consumed: `chain-truth-p3-design.md` R3 (weld law), `chain-truth-task2-brief.md` blocking list + R5 (chain-is-expected-side), `recon/p3-probes.md` (NORMATIVE), plan Task 6 (`docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md:171-183`).

---

## DELIVERABLE 1 — WELD-SEMANTICS RULING FOR TASK 6

### R1 — Pin discipline for the HF gate. BINDING-RECOMMENDATION

**What makes a pinned comparison honest — five legs, all already house law, restated because Task 6 adds new read families that must inherit every one:**

1. **Pins are derive cursors, never operator-chosen** (`cmd/reconcile/main.go:207-211` taint law). Number→hash resolution happens ONCE per chain via `headerHash` — the hash the provider REPORTS for that number, never recomputed (the reported-hash law; recomputation is banned where the type model is incomplete). All subsequent reads are EIP-1898 by that hash (`callAtHash`, `main.go:363-376`).
2. **The weld ties the resolved hash to custody**: `runWeld` (`cmd/reconcile/phase1.go:286-314`) asserts the greatest `raw_logs` block ≤ P still carries its stored hash live, and ingest cursors at P match live headers. This is the cross-examination: the DB side was witnessed by the walker's coherent-window Step at ingest; the live side by `headerHash` now; equality proves the DB fold and the pinned reads describe the SAME fork. **Every new Task 6 gate must run inside the existing before/after weld bracket** (`main.go:954-975` / `1025-1042`), not as a phase appended after Phase 3 — `requireCanonical=false` means an orphaned pin serves silently, and the end-of-run re-weld is the only thing that catches it (L1-8, `main.go:1040`).
3. **In-band block equality per multicall chunk** (`main.go:392-423`, `errChunkDivergence`) — belt on the hash pin, because one lb hostname is many backends.
4. **Archive-completeness before trusting a zero — the new prescription Task 6 needs.** A pinned `eth_call` on a backend without state errors loudly (`classStatePruned`, judged only after the FULL retry budget — `rpcclass.go:269-273`, lb backends alternate). But two zero-shaped answers are NOT errors and will reach the comparator: (a) Multicall3 per-call `success=false` with empty returndata, and (b) geth's legal `0x` success for a call to an address with no code at that block. **Rule: a zero that gates a pass must be proven to be an archive-served zero.** Concretely, for the empty-set probes (≥10 zero-debt + never-seen accounts): every multicall chunk that contains only expected-zero subjects MUST also carry ≥1 known-nonzero control account whose value is independently gated in the same run — a chunk of all-zeros with no nonzero control is testimony indistinguishable from a lying default. And every decoder refuses `len(returndata)==0` rather than decoding zero (the `unpackBorrowTokenConfig` error path, `dm.go:410-414`, is the precedent; state it as a requirement for every NEW unpacker: `getUserAccountData`, `getConfiguration`, `tokenConfig`).
5. **Read-presence is a first-class fact**: absent/reverted/undecodable → `weld-unread`, GATED, never zero, never silently absent (round-10 F3 / round-11 F2 axiom, `dm.go:277-283`, `aave.go:166-174`). "Cannot verify" is never advisory.

**Two Task 6 read families need pins that are NOT the run pin — naming them now so the wave does not improvise:**

- **Adapter-output weld** (plan :180 "≥ 1 row per ETH reserve"): the sampled poll row was pinned at ITS OWN anchor (`price_poll_anchors` block + hash). The weld re-read of `getAssetPrice` MUST be EIP-1898 at the STORED ANCHOR HASH, not at the run's fresh pin — re-reading at a different block manufactures drift out of honest price movement and would be one witness (the oracle) judged across two different states. Anchor hash unserveable → loud `weld-unread`, never re-pin to a number.
- **Backtest (N=31)**: each replay's pin is the `raw_logs.block_hash` stored WITH the Liquidated event — not a fresh `headerHash(number)`. Our stored hash was witnessed under coherent-window custody at ingest; pinning to it guarantees the state read is on the same fork the derivation consumed, and if that hash were somehow orphaned the pinned call fails LOUD (`block-not-found`) instead of silently serving another fork. A live number→hash resolution here would route the comparison through a door our logs never went through. (These blocks are 150M–153.4M OP, deep-finalized; serving them requires the archive posture — a `state-pruned` verdict at a backtest pin is exit 2/3 per the existing `preflightExit` classes, never a skipped sample: N=31 is a floor, and a silently shrunk N is the silent-cap anti-canon.)

**Backtest intra-block honesty (name it or the wave false-fails or false-passes):** `liquidatable(user)` is evaluable only at block boundaries; the liquidation executed mid-block N against pre-state that may include same-block earlier transactions (DM prices are push-updates — same-block oracle writes are possible). Rule: evaluate at N−1; if `true`, exact-pass. If `false` at N−1, the row is NOT immediately a failure and NOT absorbable: check custodied `raw_logs` at (N, log_index < liquidation's) for a price/index write that flips the verdict, record the three-state outcome (`true-at-parent` / `flipped-in-block-with-custodied-witness` / `UNEXPLAINED` = gated fail). A naive "must be true at N−1" gate misreads chain mechanics as drift; a naive "check at N" reads post-liquidation state.

### R2 — Param weld: the set-equality law, and which side is the expected witness. BINDING-RECOMMENDATION

There are THREE parties here and the plan text flattens them into one comparison. Separate them or the weld proves less than it claims:

- **A (custody chain):** event-derived params — `param_history` as-of pin (ETH), `dm_param_history` view over `position_events` (OP).
- **B (independent chain testimony):** pinned state reads — `getConfiguration(asset)@pinHash` + `Pool.getReservesList()@pinHash` (ETH); `collateralTokenConfig(t)` / `borrowTokenConfig(t)` / `getCollateralTokens()` / `getBorrowTokens()` `@pinHash` (OP).
- **C (our committed registry):** `recon/feeds.json` — 4 ETH `aaveoracle` poll entries, 4 `chainlink_stream` entries, 20 OP DM entries.

**A vs B is the weld.** Under R5, the CHAIN (B) is the expected side, A is the tested side — logs and state are two independent doors to the chain, which is exactly what makes it a weld. Divergence = refuse to serve params, loud, never prefer either witness (P3-design R3, unchanged). Set-equality legs: `{reserves in param_history ReserveInitialized ≤ pin} == {getReservesList()@pin}` (ETH); `{tokens in dm_param_history config rows ≤ pin, minus custodied removals} == {getCollateralTokens()@pin} ∪ {getBorrowTokens()@pin}` (OP). Then per-member field equality (`LTV/LT/bonus` vs `getConfiguration` bit-decode; DM config fields vs the struct reads).

**C is not a witness at all — it is the CLAIM.** The precedent is `db_name_claimed` vs server-reported identity (`main.go:1177-1192`): claimed subject vs audited subject, mismatch verdict-bearing in EITHER direction. Treating our own committed registry as an expected truth against which the chain is judged would be the-RPC-said-so inverted — the-config-said-so. So the feeds.json comparison is a REGISTRY-CONSISTENCY GATE, judged against B (the chain state list at pin), and it fails the run on ANY set difference — but the artifact classifies the direction, because remediation differs:

- **only-in-chain** (a reserve/token the chain has that feeds.json lacks): an asset with no configured price witness — riskd already refuses per-asset (`internal/riskfeed/assemble.go:314-320`); the run FAILS naming the asset; operator action is a registry extension under ack. This is the liquidUSD class: coverage gap.
- **only-in-registry**: stale or mistyped entry. If a custodied `CollateralTokenRemoved` / removal event explains it, say so in the row — explained-but-still-failing until the registry is corrected. Never "disclose and continue": both directions gate, per the sharpened R3 ruling ("divergence = gated FAIL").

**Role-level equality, not just address-level** (OP side): feeds.json `roles` (collateral/debt) must match the chain's collateral-vs-borrow token list membership at pin — a token borrow-enabled on chain but marked collateral-only in our registry is a missed debt-pricing witness hiding inside an address-level "equal" verdict.

**Cohort floor for this gate:** "covering ALL configured reserves/collateral tokens (count asserted against config)" (plan :179) — assert the count against **B (the chain list at pin)**, not against feeds.json. Asserting coverage against your own registry is one witness through two doors: a registry missing a token would also shrink the floor that was supposed to catch it.

### R3 — tokenConfig sweep: custody hazards + required guards. BINDING-RECOMMENDATION

The sweep (risk-quant-promoted REQUIRED; plan :175) reads `PriceProviderV2.tokenConfig(address)` per DM token at the run pin. Hazards, each with its guard:

1. **This is a SAMPLE, not ledger — say so in the schema.** PriceProviderV2 (`0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB`) is NOT in the walker stream set; its `setTokenConfig`-class mutations are not in custody. The sweep's evidence is valid AT THE PIN with no continuity claim — label every row `input:pinned-read` (risk-quant R1's declared-input schema) and stamp `(pin block, pin hash, provider address)`. Do NOT let the wave describe it as "the oracle composition" unqualified; it is the composition the provider attested at one hash-pinned block. D-012's dichotomy applies: if these fields ever gate a live risk read (rather than a reconcile run), the provider address joins the stream set as ledger — not resampled harder.
2. **Which code answered:** the provider is a proxy; an impl upgrade between runs silently changes struct semantics (the exact class A1 taught us on ReserveInitialized). Guard: one `eth_getStorageAt(provider, EIP-1967 impl slot)@pinHash` recorded per run — one extra call, and the artifact can distinguish "config changed" from "decoder now reading a different shape". ABI skew on decode → `weld-unread`, never a partial decode (the `buildDMWeldReads` pattern, `dm.go:402-418`).
3. **Delisted tokens / zero-vs-absent:** classify by the CHAIN's own universe first. Sweep set = `getCollateralTokens()@pin ∪ getBorrowTokens()@pin ∪ feeds.json DM set` (the union — sweeping only feeds.json is a silent cap: a chain-configured token missing from our registry is precisely what the sweep exists to expose). Then: token in chain universe + revert/zero-struct → GATED `weld-unread`/anomaly; token NOT in chain universe (registry-only) → the EXPECTED outcome is revert-or-zero, and a SUCCESSFUL config read is the anomaly (a configured price for a delisted token — record it, it contradicts the delisting). Both directions asserted; a zeroed struct (oracle = 0x0) is the fact "unconfigured", never decoded as a config whose oracle is the zero address.
4. **baseAsset transitive closure — the liquidUSD lesson generalized.** The defect class the sweep closes was a COMPOSITION hidden one level down (`rate × snap(USDC)`, ledger :287-301). Reading only the ~20 top-level configs leaves the same class open one level deeper. Rule: for every swept config that names a `baseAsset`, read `tokenConfig(baseAsset)@pin` too, recursively, cycle-guarded, and record the full composition tree per token (3 of ~20 were read during the consult; the sweep is the enumeration that makes the class closed, so the enumeration must actually close).
5. **Pinned-call hygiene inherited:** all reads through the shared `pinnedReader`/runner (token bucket, per-attempt classification into the artifact); chunked multicall with in-band block equality; `len==0` refused by the unpacker.

### R4 — B3 heartbeat scan: what makes a GAP a chain fact. BINDING-RECOMMENDATION

A gap in `AnswerUpdated` rows has three candidate explanations, and the scan must discharge two of them before asserting the third:

1. **Our custody gap — discharged by construction, and the scan must CITE the construction.** The walker's coherent-window Step commits whole windows atomically with address-only filters; below the stream's ingest cursor there are no holes for a walked address. The scan's valid domain is exactly `[first AnswerUpdated ≥ startBlock, min(ingest cursor, pin)]` per aggregator stream, and the artifact states that domain per feed. Any scan row outside a stream's custody domain is `unscannable`, never extrapolated.
2. **Aggregator phase change — the trap that mimics a violation.** We walk RAW aggregators; Chainlink proxies re-point `aggregator()` on phase changes (derivation-notes :312-314). A phase change makes OUR aggregator go permanently quiet while the feed lives on at a new address — indistinguishable from a heartbeat stop inside raw_logs alone. Rule: any gap that is open-ended at the scan head, and any gap > 2× the published heartbeat, requires a pinned `proxy.aggregator()@pinHash` check against the walked aggregator (proxies are in feeds.json). Mismatch → the finding is **"stream requires re-resolution"** — a custody-config fact, gated as its own failure class, NOT a heartbeat violation and NOT a pass.
3. **Only then is the residual gap the feed's own behavior.** Gap arithmetic runs on `source_as_of` (= the round's `updatedAt`, chain testimony, backfilled 51,954/51,954 by the decoder-replay healing pass) — never `observed_at` (insert time) and never block-header time of OUR ingestion.

**Verdict semantics (feeds R4.4 escalation):** the scan is a complete event ledger, so `max_gap` over the domain is exact history — it can REFUTE a published budget (observed gap > heartbeat+grace ⇒ meta must carry the observed bound; keeping the friendlier published number is the silent-cap anti-canon) but can only grade the future as `empirical-historical (N updates, max gap G, domain [a,b])`, never "verified". Published 86400s values remain published-not-verified in the CONTRACT sense either way; the scan upgrades the provenance grade, not the ontology. This satisfies the R4.4 trigger for riskd/api heartbeat-judged staleness, provided the meta payload carries the grade per feed.

### R5 — Plan-text scan against the blocking list. Findings:

1. **[BLOCKING — plan amendment required] The Aave cohort floor ≥ 20 is refuted by the chain.** Plan :177 requires "Aave HF-gated borrowers ≥ 20"; the probe record counts **12 live borrowers** (p3-probes, P-2: 12/12; eMode: "all 12 current borrowers"). As written the run can NEVER pass, and the predictable failure mode is the wave quietly widening "borrower" (zero-debt suppliers, historical accounts) to hit the number — anti-vacuous-green inverted into pro-fabrication. Prescription: the floor becomes population-derived — ALL current Aave borrowers, with the census itself welded (DB debt>0 count vs chain, both at pin) and a hard minimum the chain actually supports (12 today; the three sub-1.0 dust positions are mandatory members — the best discriminating subjects on the book). Risk-quant owns cohort sufficiency; my lane's ruling is only that a floor no honest run can meet is a custody hazard, not a strengthening.
2. **[blocking, restated from R2] Param-weld coverage counted against feeds.json instead of the chain list** would be one witness through two doors — count against `getReservesList()`/`getBorrowTokens()`@pin.
3. **[blocking, restated from R1] Adapter-output weld at the run pin instead of the stored anchor hash**, and **backtest pins resolved live instead of from `raw_logs.block_hash`** — both are two-doors violations; the plan text does not currently specify either pin, so the brief must.
4. **[should] New gates join the existing verdict machinery** — `computeResult`/taint set/`tallyTotals` (`main.go:577-588,1236-1277`), before/after weld bracket, artifact schema — never a side-channel exit path. Cohort-floor misses are GATED failures (exit 1, artifacts written), matching plan :176's "FAILS (gated)".
5. **[note] The HF gate's collateral-flag input:** risk-quant R1's declared-input reading of `getUserConfiguration@pin` (`risk-quant-p3-design.md:39-44`) is the correct first implementation and stays. But see Deliverable 2 — the flag now has a derivable event witness in custody, and the finding below materially interacts with component #5 of the Aave gate. Wave brief should say the pinned read is authoritative for Task 6 and becomes the WELD PARTNER for the event-derived flag once the micro-task lands.
6. **[note] Standing items apply unchanged:** walker rotation class (content-validation failures never rotate) recorded-unfixed; dRPC A2 archive flapping — a dRPC "0 logs"/zero remains a claim, not a fact; the shared Alchemy free key is never bulk traffic (A3).

---

## DELIVERABLE 2 — COLLATERAL-FLAG MICRO-TASK SIZING (read-only probe, executed)

### Topic0 derivation (independent keccak, golang.org/x/crypto/sha3)

```
keccak256("ReserveUsedAsCollateralEnabled(address,address)")  = 0x00058a56ea94653cdf4f152d227ace22d4c00ad99e2a43f58cb7d9e3feb295f2
keccak256("ReserveUsedAsCollateralDisabled(address,address)") = 0x44c58d81365b66dd4b1a7f36c25aa97b8c71c361ee4937adc1a00000227db5dd
```

Both match `recon/report.md:100-101` exactly (the `00000` run in the Disabled hash is genuine). Canonical signatures confirmed against the committed ABI (`internal/decode/abis/AaveV3Pool.json:414-451`): both events, two `address` args, BOTH indexed ⇒ `topics[1]`=reserve, `topics[2]`=user, empty data.

### Census (chain_id=1, address = Pool `0x0AA97c284e98396202b6A04024F5E2c65026F3c0`, one RR read-only snapshot)

| | rows | block range | distinct users | distinct reserves | nonempty data | topic arity ≠ 3 |
|---|---|---|---|---|---|---|
| Enabled | **98** | 20,713,917 – 23,357,693 | 94 | **1** | 0 | 0 |
| Disabled | **75** | 20,721,368 – 25,334,454 | 71 | **1** | 0 | 0 |

Union distinct users: **94**. Latest-state fold per (reserve,user): 94 pairs, **71 currently Disabled**. The single reserve across all 173 events is weETH (proven by the impact join below matching on the weETH asset while distinct_reserves=1).

### Completeness assessment — four agreeing witnesses

1. **Coherent-window custody:** stream `eth:aave-etherfi` startBlock 20,625,519 < first flag event 20,713,917; ingest cursor at 25,642,052; below-cursor completeness for a walked address is the walker Step law — no holes by construction.
2. **Third-party-corroborated census:** Pool-address totals in this snapshot — 2,005 logs, 13 distinct topic0, blocks 20,713,917–25,364,636 — match the probe pack's dual-witnessed (Blockscout + Alchemy) census EXACTLY (`recon/p3-probes.md` eMode section).
3. **State-machine closure:** union users (94) == Enabled users (94) ⇒ every Disabled user has a prior Enabled — nobody disables what was never enabled. A single missed Enabled log for any Disabled user would break this invariant.
4. **Source-law consistency:** flags exist ONLY for weETH — the one reserve ever given LTV>0 (the configurator ledger's single `CollateralConfigurationChanged`, weETH 7800/8100/10600); Aave v3 skips auto-enable and forbids manual enable for LTV-0 reserves, so zero flag events for USDC/PYUSD/FRAX is exactly what the custodied param ledger predicts. First Enabled at 20,713,917 = the genesis-cluster first supply.

### Decodability

Trivial and strict-parse-friendly: arity==3, `len(data)==0` on all 173 rows (verified), both payload facts in topics. The strict decoder is: canonical-ID registration + assert arity 3 + assert empty data + assert 12 zero-padding bytes on both address topics. No body decode exists to get wrong.

### Material impact (the finding that upgrades this micro-task)

Joining the latest-flag fold against `position_balances` (engine `aave_v3_etherfi`, side collateral, source event, amount>0): **58 positive collateral rows → 23 latest-ENABLED / 1 latest-DISABLED / 34 NO-HISTORY.**

- The 1 DISABLED-with-balance: `0x2c64a1d5d602e7fb6d21da6211dcecc6e17a0649`, weETH, 2e15 wei (~$8), flag off since block 22,551,863 — the disclosed "user opted out" case, economically dust but a perfect discriminating test subject.
- **The 34 NO-HISTORY rows are the real story: all USDC/FRAX/PYUSD.** These reserves were never configured as collateral (LTV 0 from init, per our own param custody), so their chain flag is false BY CONSTRUCTION — auto-enable never fired. riskd's current assume-true posture (`internal/riskfeed/assemble.go:328`) is therefore wrong not for a rare opt-out tail but for **35 of 58 (60%) of positive collateral rows, systematically**. Mitigating nuance, stated honestly: because those reserves' LT is also 0 in `param_history`, the HF numerator Σ(Cᵢ·LTᵢ) is unaffected — HF is right by accident. What IS wrong today: `totalCollateralBase`-class outputs (served collateral USD, avgLT denominator, waterfall collateral-at-risk), and exactly component #5/#6 of Task 6's Aave gate if any comparison leg consumes riskd's flag posture rather than the pinned bitmap.

### Go/no-go and surfaces

**GO — dispatch the deriver micro-wave, sequenced to land before or alongside Task 6.** Bounded (173 logs, one reserve in practice, empty bodies), genesis-complete custody proven above, and it converts Task 6's declared-input `getUserConfiguration@pin` read into a two-door weld (event-derived flag vs pinned bitmap, per sampled account) instead of a trusted input.

Surfaces (no new stream — the Pool is already walked; the logs were skipped by the registry's deliberate unknown-topic contract, `internal/decode/decode.go:253-262` → `internal/derive/runner.go:360-362` `continue`):
- `internal/decode`: two entries in `engineTopics["aave_v3_etherfi"]` + the strict reader above.
- `internal/derive/aave.go`: fold both events as record-only `position_events` (the DM config-row precedent, `debtmanager.go:429-443`) — inherits epoch protection, rewind, divergent-replay refusal for free.
- `internal/store`: additive `CollateralFlagsAsOf(engine, chainID, block)` (DISTINCT ON fold) + `RiskInputSnapshot` wiring; `risk_position_legs.used_as_collateral` already exists as nullable bool (`internal/store/risk.go:999`).
- `internal/riskfeed/assemble.go`: `UsedAsCollateral` from witness; law: witnessed-true / witnessed-false / **no-history ⇒ false** — chain-exact under genesis-complete custody (every enable path emits through the Pool: supply auto-enable, setUserUseReserveAsCollateral, transfer/liquidation finalizeTransfer), and conservative in direction (shrinks collateral, never inflates). `FlagCollateralFlagUnwitnessed` (`internal/riskfeed/prices.go:71`) retires in favor of per-row witness provenance.
- **History backfill — binding mechanism ruling:** the Aave engine's cursor is at head and the 173 logs are behind it. Use **rewind-and-rederive** (RewindDerived to StartBlock−1, runner re-steps from the cursor read back — zero RPC, one decoder, one path, the exact machinery harness leg 3 proved), NOT an out-of-band healing insert: the wave-2b healing precedent filled a NULL column and never inserted rows; inserting historical position_events beneath a live cursor makes derived state a fold of two passes. Operator choreography: maintenance-window it; during re-derivation riskd/api's supersession legs fire honestly (last_block below stamped = "rewind in progress") and self-heal — by design, but say so in the wave brief.
- Behavior change to disclose loudly: 34 stable rows flip collateral→not-collateral; served Aave collateral aggregates DROP. That is the false-safety direction closing, and the Task 6 component welds are the proof it closed correctly.

---

## VERDICT: **CUSTODY HOLDS** for Task 6 as planned, conditional on this blocking list

1. R5.1 — the Aave cohort floor ≥20 replaced by a population-derived, census-welded floor (12 live borrowers; a floor no honest run can meet breeds fabricated cohorts).
2. R1 — adapter-output weld pinned at the STORED anchor hash; backtest replays pinned at the STORED `raw_logs.block_hash`; both never re-resolved live.
3. R1.4 — empty-set probes carry a nonzero control in every all-zero chunk; every new unpacker refuses `len==0`; zero-shaped answers never gate a pass without an archive-served proof.
4. R2 — param weld: chain state @pin is the expected side vs event-derived (A vs B); feeds.json is the CLAIM, gated both directions against B, never a witness; coverage floors counted against the chain list, not the registry; role-level equality on the DM side.
5. R3 — tokenConfig sweep labeled `input:pinned-read` sample (provider mutations un-custodied), swept over the chain-∪-registry union, impl-slot recorded at pin, revert/zero classified by chain-universe membership, baseAsset transitive closure.
6. R4 — heartbeat gaps attributed only after custody-domain bounding AND the proxy-`aggregator()` phase-change check; gap arithmetic on `source_as_of`; refute-or-grade semantics, never "verified".

Micro-task: **GO** (sizing above; touches decode/derive/store/riskfeed + a rewind-rederive window; no new stream, no new RPC class, no migration strictly required).

Key files: `cmd/reconcile/main.go:207-211,363-423,954-1042,1177-1192`, `cmd/reconcile/phase1.go:286-314`, `cmd/reconcile/dm.go:277-418`, `cmd/reconcile/aave.go:109-192`, `internal/riskfeed/assemble.go:264-335`, `internal/riskfeed/prices.go:71`, `internal/decode/decode.go:253-262`, `internal/derive/runner.go:360-362`, `internal/store/risk.go:732,999`, `recon/feeds.json`, `recon/p3-probes.md`, `docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md:171-183`. Probe tooling (scratchpad, disposable): `...\scratchpad\collatflag\main.go`, `...\scratchpad\collatflag\impact\main.go`.
