# Solvent Phase 3: Risk Engine + API — Implementation Plan (W2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Execution runs through the repo's SDD wave machinery with D-006 Codex gates; every dispatch brief quotes D-013's adjudication line verbatim.

**Goal:** Health-factor math proven exact against chain for both engines, a stress engine on honest primitive axes, and a public-shaped REST+SSE API with a generated TS client — built + proven locally/CI (deploy/publish is P5).

**Architecture:** Pure math in `internal/risk` (zero I/O, golden-vector pinned). `cmd/riskd` materializes risk batches from a repeatable-read snapshot of P2's derived state, gated on the reorg-epoch watermark vector, stamped with per-engine `(last_block, acked_epoch)` + price-input identities. `cmd/api` serves REST/SSE from those tables with three-leg supersession and per-input price disclosure; riskd and api make **zero RPC calls**. Param custody: DM params are a view over already-custodied `position_events`; Aave params arrive via a new PoolConfigurator walker stream, welded at pins against `getConfiguration` reads. Proof lives in the `cmd/reconcile` extension (HF gates, boolean weld, empty-set probes, realized-liquidation backtest), all EXACT at hash-bound pins.

**Tech Stack:** Go 1.24 stdlib `net/http` (no framework), `golang.org/x/time/rate` (rate limit), `github.com/getkin/kin-openapi` (contract tests only — one new Go module, owner-visible choice), pgx/v5, goose/v3, testify; packages/client-ts: TypeScript + `openapi-typescript` + vitest (Node toolchain confined to that directory).

**Design authority:** `docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md` (adopted consult blockers §1) + `.superpowers/sdd/p3-consults/*.md` (verbatim rulings) + `recon/derivation-notes.md` (NORMATIVE). Where this plan and the spec disagree, the spec wins and the disagreement is a plan bug.

## Global Constraints

- All Phase 1/2 Global Constraints carry over verbatim (repo root, module path, env names, quality gates, conventional commits, no Co-Authored-By, commit identity per D-002, sandbox notes incl. `dangerouslyDisableSandbox: true` + Go PATH export for build/test/network commands).
- **Numbers from chain:** `NUMERIC`/`BYTEA` in Postgres, `*big.Int` in Go; JSONB amounts as decimal strings. HF stored as integer legs (numerator/denominator), never floats; display-layer division only.
- **Store public signatures frozen** (P2 law): additive changes only across `internal/store`.
- **riskd/api zero-RPC law** (spec §2): only the reconcile extension and the walker touch chain.
- **New dependencies:** exactly `golang.org/x/time/rate` + `getkin/kin-openapi` (Go, the latter test-only) and the `packages/client-ts` Node toolchain. Nothing else without owner consent.
- **D-012 is settled law** (samples, never delete); **D-013 binds every review brief** (quote its adjudication line verbatim in each Codex dispatch).
- **Governance:** active work item W2 (`roadmap/work/W2-phase3-risk-engine-api.md`, created in Task 0); staged paths stay within its `allowed_paths`; serial writer; pre-commit gates enforce.
- **Rounding laws are normative:** live debt = `rayMulCeil`; collateral floor per regime B (half-up regime A < 23,088,584); DM floor sites as cited in the spec §5.2. Tests hard-code on-chain vectors; expectations never computed from the helper under test.
- **Verified anchors (do not re-derive):** DM proxy `0x0078C5a459132e279056B2371fE8A8eC973A9553` (OP), Aave Pool `0x0AA97c284e98396202b6A04024F5E2c65026F3c0` (ETH), AaveOracle `0x43b64f28A678944E0655404B0B98E443851cC34F`, golden borrower `0x70daaac436465a0d03e45916fa68ddee6086e5fe`; ceiling vectors in `cmd/reconcile/aave_compare_test.go`.

## Plan staging

Tasks 0–1 are fully specified and executable now. Tasks 2–9 are scoped and locked below (files, interfaces, gates, acceptance); their wave-level steps are appended to this file as each predecessor gate passes, mirroring the P2 pattern. Probe-fed values (floor-law vectors, configurator topic0 table, eMode census, BTC weight, backtest N) are **data dependencies produced by Task 1**, not placeholders; the sections below say exactly which probe feeds which brief.

## Parallelization map

Serial writer: one task in flight at a time. Task 0 (entry train) → Task 1 (probe pack) → Task 2+3 (param custody + harness; close together — the harness is Task 2's acceptance gate) → Task 4 (risk library; independent of 2/3 in content, sequenced after to keep the ledger linear) → Task 5 (riskd) → Task 6 (reconcile extension) → Task 7 (api) → Task 8 (client-ts) → Task 9 (W2 acceptance + exit train). Codex plan review happens BEFORE Task 0 lands (this document is the review target).

---

### Task 0: P3-entry control-plane train (no product code)

**Files:**
- Commit (already drafted, uncommitted): `roadmap/decisions/D-013-honest-use-correctness-bar.md`, `docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md`, `.superpowers/sdd/p3-consults/{risk-quant,oracle-sentinel,chain-truth}-p3-design.md`, this plan.
- Create: `roadmap/work/W2-phase3-risk-engine-api.md` (type:work, status:active; objective = spec §1; acceptance = §11 canonical commands; deliverables = exact file list maintained as tasks land; `invalidated_by`: `internal/store/migrations/**`, `internal/derive/**`, `internal/prices/**`, `internal/risk/**`, `cmd/riskd/**`, `cmd/api/**`, `cmd/reconcile/**`, `config/contracts.json`, `recon/derivation-notes.md`; non-goals: deploy, npm publish, alerter, web).
- Create: fresh integrator claim `roadmap/claims/CLAIM-claude-integrator.md` bound to W2 (claim.py open).
- Modify: `roadmap/ROADMAP.md` (W2 row + W1 row archived, exact projection), `roadmap/STATUS.md` (active_task: W2), `roadmap/work/W1-phase2-positions-prices.md` (`status: achieved → archived` + handoff archival note; **the recorded receipt is NEVER edited**).
- Modify: `roadmap/tools/doctor.py` + `roadmap/tools/selftest.py` (**archived-evidence policy** — Codex round 2 [H2]: `validate_evidence_receipt` unconditionally recomputes contract/input fingerprints against the CURRENT snapshot for every evidence object, so W1's receipt fails doctor on Task 2's first migration even with W1 archived. Change: when the receipt's referenced work has status `archived` or `superseded`, skip the current-snapshot drift comparisons and keep the tested-commit-internal checks (recorded == tested fingerprints, ancestry, schema) — the receipt remains a true historical record without asserting current-input validity. Selftest case: archived work + receipt + a post-archive change to an `invalidated_by` path ⇒ doctor green; the same change with the work still `achieved` ⇒ doctor error. Enforcement-change surface: rides commit A under the owner ack).
- Modify: `.superpowers/sdd/progress-phase3.md` (create — the P3 execution ledger, seeded with the entry-train entry and the consult pointers).

**Steps — TWO commits (Codex plan-review round 1 [H1]: `scope_gate.py:1006` — a newly staged
claim is bootstrap authority and "must be metadata-only", roadmap/** paths exclusively):**
1. **Commit A (roadmap-only bootstrap, owner ack):** D-013 + W2 object + fresh claim (claim.py
   open) + ROADMAP (W2 row active; W1 row **archived**) + STATUS (active_task: W2) + W1 object
   `status: achieved → archived` (+ handoff archival note) + **`roadmap/tools/doctor.py` and
   `roadmap/tools/selftest.py`** (the archived-evidence policy — ALREADY IMPLEMENTED and
   selftest-green in the working tree as of plan-review round 3; the enforcement-change surface
   rides this ack). W1 archived skips ALL
   achieved-status re-validation (doctor.py gates fingerprint/receipt/deliverable checks on
   `status == "achieved"`), so Task 2's migrations cannot trip it; the receipt stays immutable
   in history. **W2 declares `depends_on: []`** — doctor requires active work's dependencies to
   be status:achieved (doctor.py:721), so the W1 lineage is recorded in W2's prose, not
   frontmatter. Deliverables may name commit-B files (existence is only enforced at achieved).
2. **Commit B (under the now-committed claim):** this plan + the design spec + consult archives
   + the P3 ledger + the `.superpowers/sdd/.gitignore` re-inclusion (Codex round 2 [NEW-M]: the
   `*` pattern excluded `p3-consults/` and `!*.md` cannot re-include descendants of an excluded
   directory — the binding rulings were silently untracked). Gate: `git ls-files
   --error-unmatch` on all three consult archives after the commit. All within W2
   `allowed_paths`.
Then: `python roadmap/tools/doctor.py` 0 errors after EACH commit → push → CI green.

**Acceptance:** doctor 0 errors with W2 active + claim open + W1 archived; both commits gate-clean; CI green; ledger seeded.
**Hazard:** claim.py refuses mutations while >1 worktree registered — `git worktree prune` first. Owner ack required for commit A (protected transition). Never stage non-roadmap paths into commit A.

---

### Task 1: Probe pack (read-only; feeds vectors and tables into Tasks 2–6 briefs)

> **EXECUTED 2026-07-28/29** — all six probes complete, findings committed as
> `recon/p3-probes.md` (NORMATIVE for Tasks 2–6). Headlines: P-1 = pure floor (two
> discriminating vectors); P-2 = the drafted two-step HF model FALSIFIED, deployed law is the
> fused floor division (12/12); eMode settled at 0 both ways; BTC leg IN (4.11%); backtest
> N=31 single-era frame; configurator = 0x8438F4D29D895d75C86BDC25360c25eF0607E65d, 20 topic0s
> zero UNKNOWNs, ReserveInitialized has a NONCANONICAL 3-word body (A1); provider posture
> A2/A3 (dRPC-primary windows, never bulk on the shared Alchemy key).

**Files:**
- Create: `recon/p3-probes.md` (findings, committed) + append probe-fed constants to this plan's task sections.
- No product code. All chain reads via `cast` on the recon RPC config (`SOLVENT_RECON_RPC_*`), EIP-1898 hash-pinned; DB reads via psql against the live db (read-only).

**Probes (each with its consumer named):**
1. **P-1 floor-law vectors** (→ Task 4/6): at a fresh ETH pin, pick two aToken positions with sub-half and super-half fractional parts of `scaled × liquidityIndex / RAY`; record `(scaled, index, balanceOf)` triples; confirm floor (regime B). Method: `cast call` scaledBalanceOf/balanceOf/getReserveNormalizedIncome at the same pinned block.
2. **P-2 percentMul/wadDiv boundary** (→ Task 4/6): read deployed PercentageMath/WadRayMath bytecode-backed behavior via a borrower whose `avgLT × collateral` product sits near a 0.5 rounding boundary (search sampled borrowers at the pin); record one exact `getUserAccountData` vector where half-up vs floor differ in the last digit. If no natural boundary borrower exists, record the closest and note the discriminating synthetic vector for the unit layer instead.
3. **Configurator topic0 sweep** (→ Task 2): `cast logs` over the PoolConfigurator address (resolve via `PoolAddressesProvider.getPoolConfigurator()` at the pin) from Pool deploy block to head in bounded windows on the recon RPC; emit the complete `topic0 → event name → decoded/ruled-non-param` table. Fallback posture if archive getLogs contracts: Alchemy window-10 (catch-up playbook).
4. **eMode census** (→ Task 2/4/6): distinct `UserEModeSet` accounts from raw_logs + `getUserEMode@pin` for all current borrowers; if any non-zero → category param rows join Task 2's table and the HF path gains the category branch (spec §8).
5. **Collateral-weight census** (→ Task 4 scenario set): SUM(USD) by asset over current book from derived state; decides the BTC-leg scenario (spec §6) and the backtest stratification.
6. **Backtest sample frame** (→ Task 6): count + block-range histogram of DM `Liquidated` events (expected 763); fix N (≥25, stratified across the regime/upgrade boundaries) against the archive-read budget observed in probe 3.

**Acceptance:** `recon/p3-probes.md` committed with every probe's raw outputs (pinned block + hash per read); consumers' constants appended to this plan; no unresolved probe.
**Hazard:** free-tier archive volatility is recorded standing behavior — every probe notes provider + endpoint; a refused probe switches provider rather than weakening its consumer's gate.

---

### Task 2: Param + adapter-price custody (PoolConfigurator stream, dedicated engine wiring, DM param view, adapter-output polling, first P3 migrations)

**Files:**
- Modify: `config/contracts.json` (new ETH stream: PoolConfigurator address, startBlock = Pool deploy block, confirmations/window per existing ETH streams, **engine: `aave_param`** — a NEW engine identity).
- Modify: `internal/config/config.go` + tests (accept `aave_param` in the engine enum — Codex round 1 [H3]: the current enum {debt_manager, aave_v3_etherfi, chainlink_feed} rejects an unknown engine, and routing configurator events into `aave_v3_etherfi` would crash AaveEngine on unhandled topic0s).
- Modify: `cmd/indexer/main.go` (wire the `aave_param` stream: walker + param deriver worker + health/frontier registration, same shape as the existing engine wiring).
- Create: `internal/decode/configurator.go` + `configurator_test.go` — typed events for the COMPLETE 20-topic0 inventory in `recon/p3-probes.md` (zero UNKNOWNs; configurator proxy `0x8438F4D29D895d75C86BDC25360c25eF0607E65d`, stream startBlock 20,625,519), strict per-topic0 decode under the `checkCanonicalData` canons, refuse-loud on any topic0 outside the inventory. **A1 (binding): `ReserveInitialized` decodes with the deployment-verified 3-word body (asset indexed; aToken, variableDebtToken, interestRateStrategy — NO stableDebtToken slot) — a canonical-ABI decode silently misaligns.** Backfill posture per probes A2/A3: walker on dRPC-primary 10k windows with adaptive halving; Alchemy window-10 targeted fallback ONLY — never bulk on the shared free-tier key (it 429-starves the live daemon; observed twice).
- Create: `internal/derive/params.go` + `params_test.go` (param deriver → `param_history`; record-only semantics; `(block_number, log_index)`-keyed effective ordering).
- Create: `internal/store/migrations/000NN_param_history.sql` (+ store methods `ApplyParamEvents`, `ParamsAsOf(engine, chainID, block) ([]ParamRow, error)`, `ParamHead(engine, chainID)`, **`RewindParams(ctx, engine, chainID, toBlock)`** carrying `RewindDerived`'s FULL contract (Codex round 2 [H3]: caller-supplied epochs and a single-height delete break under stacked honest reorgs — the shallower delete greens the cursor over orphaned rows): engine binding, `acked_epoch` read, effective target lowered to the deepest UNACKED `rewound_to`, `MAX(epoch)` read, deletion above the effective target, cursor reset, and epoch ack — all in ONE transaction, mirroring `internal/store/derive.go:443-467,491-517,641-650`; stacked-epoch regression with DISCRIMINATING geometry mirroring `internal/store/derive_test.go:618-642` (Codex round 3 [H3]: a deepest-target call passes a broken implementation): unacked rewind targets at blocks 50 and 80, param rows at 60 and 90, call `RewindParams` with the SHALLOW target 80 — assert rows in (50, 80] are deleted (the row at 60 gone, proving effective-target lowering to 50), cursor resets to 50, `acked_epoch == MAX(epoch)`; DM view `dm_param_history` over `position_events` record-only config rows — zero new RPC, chain-truth R3).
- Modify: `internal/prices/poller.go` + tests (**adapter-output custody** — Codex round 1 [H4]: P2 stores only the UNCAPPED feed stream + uncapped ratio reference, so riskd would value Aave collateral off an uncapped price exactly when a cap binds. Extend the ETH-side poller to poll `AaveOracle.getAssetPrice(asset)` per reserve at the existing 60s cadence, EIP-1898 anchor-pinned like PriceProviderV2 polls, source string `aaveoracle:<oracle addr>`, provenance class `adapter-output`. riskd's Aave valuation consumes adapter-output rows ONLY; feed rows remain provenance/observatory references. Reconcile welds sampled adapter-output rows against pinned `getAssetPrice` reads in Task 6.)
- Modify: price schema + store (**durable truthful as-of** — Codex round 2 [NEW-H]: `prices.observed_at` and `StoredPollAnchor`'s timestamp are DB insertion time, and `PriceObservation` carries no chain timestamp, so `PriceInput.AsOf` for poll rows would fabricate freshness from insert time — with riskd forbidden from RPC there is no recovery path at read time. Additive migration column `prices.source_as_of timestamptz NULL` + additive store surface: poll rounds capture the pinned anchor block's header timestamp during the round and persist it; feed derivation persists `AnswerUpdated.updatedAt` (already decoded from raw_logs) into the same column; existing rows stay NULL. riskd/api REFUSE a price input with NULL `source_as_of` for as-of purposes (falls into G1 missing-input handling, never silently substitutes `observed_at`). Tests: delayed-insertion (insert a poll row minutes after its round → `AsOf` reflects the anchor block, not the insert), backfilled feed row (`source_as_of` = updatedAt), NULL-provenance refusal.)
- Test: deriver replay tests from raw fixture logs captured by the Task-1 sweep (real log bytes, not synthetic); rewind test proving a changed param row is REPLACED (not merely re-appended) across a rewind; poller test for the new source's anchor + provenance fields.

**Interfaces (later tasks consume):**
- `store.ParamsAsOf(engine string, chainID uint64, block uint64) ([]ParamRow, error)`; `ParamRow{Asset common.Address, LTV, LiqThreshold, LiqBonus *big.Int, EffectiveBlock uint64, EffectiveLogIndex uint, Source string}` — denominators: Aave bps (1e4), DM `HUNDRED_PERCENT = 100e18`; NEVER normalized in storage, conversion lives in `internal/risk`.
- `CollateralTokenRemoved` recorded as valuation discontinuity rows (spec §8).

**Gates:** step-0 topic0 table committed (every configurator topic0 decoded or ruled non-param — for params, silence is unavailable); backfill of the stream through the existing walker (bounded windows, provider fallback posture); suite green; **close is gated by Task 3** (harness green over the new stream).
**Hazard:** first migration lands here — W1 already archived in Task 0, so doctor stays green. Do not touch frozen store signatures; additive only.

---

### Task 3: Pipeline-replay harness (Task 2's acceptance gate; the C2-amendment item)

**Files:**
- Create: `internal/pipelinereplay/pipeline_replay_test.go` (+ small helpers file) — opt-in env pair (`ANVIL_BIN` + `ANVIL_FORK_RPC`), fails-never-skips once opted in, sanitized sinks (`sanitizeForkOutput` pattern from `internal/forkreplay`).
- Modify: `Makefile` (`test-pipeline-replay` target mirroring `test-fork-replay`).

**Scope (chain-truth R5, verbatim):** anvil fork at a hash-pinned ETH block containing known subjects (one configurator param change from the Task-1 sweep, one borrow, one liquidation); drive walker `Step` → decode → derive over that pinned range against a derived test DB; assert (a) `raw_logs` bytes == fork's `eth_getLogs` bytes, (b) derived rows == fork view calls (`borrowingOf`/`scaledBalanceOf`/`getConfiguration`), (c) **the reorg leg**: `anvil` snapshot → divergent re-mine → walker `Rewind` → durable epoch → `RewindDerived` + `RewindParams` → a riskd-shaped consumer refuses at the gate (`acked_epoch < max_epoch`) → post-ack recompute matches the re-mined chain, **including proof that a param row changed by the re-mine is REPLACED, not orphaned** (Codex round 1 [H3]). The riskd gate-refusal assertion targets the Task 5 watermark reader; until Task 5 lands, leg (c) asserts through a thin test consumer using `store.DeriveCursorStates`/`MaxReorgEpochs` directly (same predicate, promoted to the real reader in Task 5's wave).

**Acceptance:** `make test-pipeline-replay` PASS at its pins on demand; wired into W2's canonical commands. D-006 close of Tasks 2+3 together.

---

### Task 4: `internal/risk` — the pure library

**Files:**
- Create: `internal/risk/{types.go, aave.go, dm.go, liqprice.go, scenario.go, waterfall.go}` + mirrored `_test.go` files; `internal/risk/scenarios/*.json` (committed scenario configs, spec §6 set).

**Interfaces (produced; riskd/reconcile consume):**
```go
type Watermarks struct{ BalancesBlock uint64; ParamsBlock uint64; SweepBlock uint64 } // per-row as-ofs; per-asset index as-ofs live on AaveReserve/DMInput (Codex round 1 [H5])
type PriceInput struct{ ChainID uint64; Asset common.Address; Source string; Block uint64; AsOf time.Time; Value *big.Int; Decimals uint8; BudgetSeconds int64; Provenance string; Fresh bool }
type AaveReserve struct{ Asset common.Address; ScaledDebt, ScaledCollateral *big.Int; DebtIndex, CollateralIndex *big.Int; IndexBlock uint64; IndexTime time.Time; UsedAsCollateral bool } // IndexBlock/IndexTime = rate_indexes as-of, stamped + disclosed per row — indexes update only on ReserveDataUpdated and can trail the derive cursor badly
type AaveInput struct{ Account common.Address; Reserves []AaveReserve; Params []ParamRow; EMode uint8; Prices []PriceInput /* adapter-output rows ONLY (Task 2) */ }
func AaveHealth(in AaveInput) (AaveHealth, error)   // integer pipeline per spec §5.1; HF as (Num, Den *big.Int)
type DMInput struct{ Account common.Address; DebtUSD *big.Int; Collateral []DMCollateral; Params []ParamRow; Prices []PriceInput }
func DMHealth(in DMInput) (DMHealth, error)          // MaxBorrowLT, Borrowings (USD 6-dec), Liquidatable bool (strict >)
type PositionInput struct{ Engine string; Aave *AaveInput; DM *DMInput; Marks Watermarks } // engine-tagged union consumed by liqprice/scenario/waterfall
func ProjectDMDebt(in DMInput, apy100e18 *big.Int, apyObservedBlock uint64, horizonSeconds int64) (*big.Int, error) // closed-form linear index (spec §6 PROJECTION; prices held flat; APY observation block stamped into the result's disclosure)
type MarketRealization struct{ Asset common.Address; MarketOverOracle *big.Int /* e.g. 0.95e18 */ } // market-value axis, SEPARATE from oracle marks (Codex round 1 [M8])
type ShortfallResult struct{ HFsUnchanged bool; ExecutionShortfallUSD, BadDebtAtLiquidationUSD *big.Int } // the market-depeg output: oracles held, HFs identical, realized-value gap quantified
func ExecutionShortfall(book []PositionInput, real []MarketRealization) (ShortfallResult, error)
func LiquidationPrice(book PositionInput, factor []common.Address) (*big.Int, bool /*inFactor*/, error) // closed form, spec §6
func ApplyScenario(in PositionInput, sc Scenario) (PositionInput, error) // primitive axes → protocol transforms (snap band ±1%→1e6 step, caps upward-binding, lens base composition)
func Waterfall(book []PositionInput, grid []*big.Int) (WaterfallSeries, error) // debt-eligible + collateral-at-risk + insolvent census; returns ErrNonMonotone on violation (never smoothed)
```
- Rounding: `rayMulCeil` (copied shape from `cmd/reconcile/aave.go`, single home in `internal/risk`, reconcile refactored to consume it in Task 6), `rayMulFloor` (P-1-proven), DM `mulDiv(…, Floor)` sites per spec §5.2.

**Test obligations (all hard-coded vectors, mutation-batteried):** ceiling pair (125415/137216, 83/84); floor pair F-A/F-B from `recon/p3-probes.md` (58420665095130 × 1000002131081530318762840784 → 58420789594330; 348255839 × 1060431730293296159488823376 → 369301541 — the super-half case kills half-up AND ceil); **fused-floor HF vectors** (golden: C=12305519, D=13720591, LT=8100 → 726460718055075032, half-up differs in last digit; plus 0x849b5e51: C=10000153, D=9604879 → 843334302285328112) and a synthetic mixed-LT weighted-sum discriminator; the retained two-step convention boundary vectors (percentMul a=1/bps=8100; wadDiv a=1000/bps=8100/b=1215000000000000000001) proving the two-step model is NOT what ships; cap-binding synthetic vectors (uncapped feed > cap ⇒ adapter output pinned at cap); snap-band step (0.99 no-op / 0.98 unsnap); strict-inequality boundary (`debt == maxBorrowLT` healthy); `ErrNonMonotone` surfacing; scenario JSON round-trip + propagation-matrix assertions; empty/zero-position behaviors; **market-depeg pinned test: `ExecutionShortfall` with oracles held asserts every HF bit-identical AND shortfall > 0 on a fixture book** (Codex round 1 [M8] — the forbidden implementation is an HF shock wearing a depeg label); **stale-index interval test: an AaveReserve whose IndexBlock trails BalancesBlock by >1000 blocks computes with the last index and surfaces the index as-of in its disclosure** (Codex round 1 [H5]). Coverage target ~100% (spec §11); no I/O imports permitted (enforced by a package-import test).

---

### Task 5: `cmd/riskd` — materializer daemon

**Files:**
- Create: `cmd/riskd/{main.go, pass.go, gates.go}` + tests (incl. live-db choreography tests per the P2 lock-rendezvous pattern); `internal/store/migrations/000NN_risk_tables.sql`; store methods `WriteRiskBatch` (one tx: batch + watermark stamps + rows + **full price-input SNAPSHOTS** — value, decimals, block, as-of, source, provenance, budget, verdict copied into batch rows, NOT identity references; Codex round 1 [H6]: D-012 neutralization flips validity in place and a later poll supersedes the same PK, so identity joins at serve time can disclose a different input than the batch used), `NewestCompleteBatch`, `RiskInputSnapshot(ctx, tx)` (the RR read: cursors, max epochs, balances, indexes + their as-of blocks, sweeps, params-as-of, latest usable prices incl. adapter-output rows).

**Behavior (spec §3/§4/§7):** poll vector at 2s; recompute on any `(last_block, acked_epoch)` change; RR READ ONLY snapshot; gate `acked_epoch ≥ COALESCE(max_epoch,0)` per consumed engine else retryable abort; degradation gates G1–G3 refuse position-scoped (flags persisted), G4/G5 compute-and-flag; never drop unpriced assets; never interpolate D-012 gaps; never-swept/failed-sweep accounts → refused/flagged rows (the `0xe957…bf20` posture); batch stamps per spec §4; `pg_notify('risk_batch', batch_id)` post-commit (doorbell only); retention: keep newest 5,000 batches (config `SOLVENT_RISK_RETENTION`), prune in the write tx. Migration ships the SELECT-only riskd PG role (SELECT on P2 tables, ALL on risk tables — spec §2 SHOULD, done structurally since it's one GRANT block); local compose + `.env.example` gain `SOLVENT_RISKD_DATABASE_URL`.
**Tests:** gate-refusal under injected epoch lag; ABA regression (last_block regains height, acked_epoch differs → recompute fires); torn-batch unservability; flag propagation into aggregates; **post-batch mutation regression: neutralize AND supersede a source price row after batch commit → served batch disclosure byte-identical to compute-time snapshot** (Codex round 1 [H6]); `-race`.

---

### Task 6: `cmd/reconcile` extension — the proof surface

**Files:** Modify `cmd/reconcile/` (new files `hf_gate.go`, `dm_gate.go`, `param_weld.go`, `backtest.go` + tests); reuse pins/sampling/report machinery; fold into `make reconcile` gated set.

**Gates (all EXACT, spec §5):** Aave 7-component table incl. adapter-output price reads at pin, declared `input:pinned-read` schema fields; DM legs 1–4 (index replay, lens-based collateral recompute, boolean weld vs `liquidatable@pin`, empty-set probes over never-seen + zero-debt accounts); param weld (event-derived head vs `getConfiguration`/`collateralTokenConfig@pin`, divergence ⇒ gated FAIL refusing param serving); realized-liquidation backtest (N per Task-1 frame, `liquidatable==true` at execution, one table in the drift report); B3 heartbeat scan (empirical inter-update gaps from raw_logs AnswerUpdated history vs published budgets → upgrades meta provenance grades or records the qualifier).
**Cohort floors (Codex round 1 [H7] — anti-vacuous-green):** the run FAILS (gated) unless every
required cohort is populated at its floor: Aave HF-gated borrowers ≥ 20, DM HF-gated borrowers
≥ 25, empty-set probes ≥ 10 per class (zero-debt, never-seen), backtest N ≥ 25, param weld
covering ALL configured reserves/collateral tokens (count asserted against config), adapter-
output weld ≥ 1 row per ETH reserve. Empty arrays are failures, never passes.
**Acceptance:** `make reconcile` result: pass, 0 gated failures, cohort counts printed and at floor, report carries the new sections + backtest table.

---

### Task 7: `cmd/api` — REST + SSE

**Files:** Create `cmd/api/{main.go, handlers.go, sse.go, meta.go, middleware.go}` + tests; `api/openapi.yaml` (the contract, source of truth); contract tests via kin-openapi validating every handler response against the spec.

**Endpoints + laws:** spec §10 verbatim (book/address/stress/observatory/stream/meta); per-input price disclosure from **persisted batch identities** (never re-derived at serve time); three-leg supersession computed against live cursor reads (DB only); staleness ages DB-clock vs durable stamps; SSE = snapshot-on-connect + batch ticks + degradation events + heartbeat comment frames; rate limit `x/time/rate` per-IP token bucket (env-tuned); CORS open, read-only, no auth; every string sanitized of endpoint URLs; last-good responses keep ORIGINAL disclosures.
**Tests:** contract suite green; **seeded exact-value suite (Codex round 1 [H7]): a fixture store with known positions/prices/params asserts exact non-empty JSON values for book aggregates + histogram + waterfall, per-address isolation (address A's response contains no address-B rows), stress numbers recomputable from the fixture, observatory series, per-input disclosures, and last-good-keeps-original-disclosure behavior — schema-valid-but-wrong and empty-but-valid both fail**; supersession-leg unit tests (all three legs + prune-survival); SSE integration (connect, tick on NOTIFY, degradation event, reconnect snapshot); rate-limit 429 shape; `valid=false` price quarantine visible in meta.

---

### Task 8: `packages/client-ts`

**Files:** Create `packages/client-ts/{package.json, tsconfig.json, src/index.ts, src/sse.ts, test/*.test.ts}`; types generated from `api/openapi.yaml` via `openapi-typescript` (checked-in generated file + regeneration script + CI drift check); fetch-based client + typed SSE helper (EventSource wrapper with snapshot+tick contract); vitest against a recorded fixture server + one live-local integration test against `cmd/api`.
**Acceptance:** `npm test` green in the package; `npm pack` produces a publishable tarball (NOT published); README documents the P5 publish step.

---

### Task 9: W2 acceptance + P3 exit train

Mirror of P2's close: full-suite live-db + `make reconcile` (HF gates) + `make test-pipeline-replay` + `make test-fork-replay` + client-ts tests, exit codes captured directly at final HEAD; whole-branch Codex exit review (D-006, D-013-calibrated) + fix train to SHIP; receipt `roadmap/evidence/receipts/E-w2-acceptance.md`; `doctor.py --receipt-basis W2 --snapshot` + `--stamp W2`; ROADMAP W2 achieved + P3 Done / P4 In progress; STATUS transition; claim released; ledger closed.

---

## Review protocol for this plan

Before Task 0 lands: one Codex review pass over this plan + the spec (brief quotes D-013; asks for coverage gaps, sequencing hazards, interface contradictions, and any claim the repo's record refutes). Findings adjudicated under D-013, fixed inline, plan re-committed with the entry train.
