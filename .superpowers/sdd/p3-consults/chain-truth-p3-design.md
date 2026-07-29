# chain-truth P3 design consult — 2026-07-28 (P3 entry, pre-plan)

Standing persona: chain-truth (fable). Advise-only. Verbatim rulings archived from the live
consult; feeds the P3 design doc and every Codex brief touching riskd/watermarks/params/ingest.

VERDICT: CUSTODY HOLDS for the proposed shape (derived-of-derived, recompute-on-next-watermark,
no new epoch machinery) conditional on the blocking list at the end.

---

## R1 — Watermark design. BINDING-RECOMMENDATION

**What P2 exposes.** The coherent derived head is a **vector, not a scalar**:
`derive_cursors (engine, chain_id, last_block, acked_epoch)` covers both position engines AND
all price engines (poll/feed cursors unified into `derive_cursors` in Task 8,
`internal/store/prices.go:539-556`). Add `MAX(reorg_epochs.epoch)` per chain and, for DM
collateral, `sweep_generations (current_generation, completed_at)` + per-account
`snapshot_sweeps.last_success_block` (migrations 00003/00004/00010). `store.DeriveCursorStates`
and `store.MaxReorgEpochs` (`internal/store/reconcile.go:220,278`) are written against a
`Querier` — riskd reuses them verbatim inside its own tx.

**The read pattern:** one `REPEATABLE READ, READ ONLY` transaction per riskd pass, the
`readRecheckState` shape (`cmd/reconcile/main.go:504-522`) widened to the full input read:

1. `DeriveCursorStates` + `MaxReorgEpochs` (the watermark vector, read INSIDE the snapshot);
2. **gate**: for every engine consumed, `acked_epoch >= COALESCE(max_epoch(chain_id), 0)` —
   else abort the pass as retryable (the C1 snapshot-gate law, already implemented twice in
   reconcile);
3. all substrate reads (`position_balances`, `rate_indexes`, `snapshot_sweeps`,
   `sweep_generations`, prices via the `LatestUsablePrice` predicate shape) in the same
   snapshot;
4. commit; then compute; then write the risk batch in **one separate write tx** stamped with
   the vector from step 1.

Sufficiency against mid-flush races: every producer write is one transaction
(`ApplyDerivedWithRates` derive.go:175; `RewindDerived` derive.go:491; `ApplySweepBatch`), so
any PG snapshot is transactionally coherent — RR only makes riskd's multiple statements share
one snapshot. Constraints carried from the record: (a) **no network under the open snapshot**
(round-10 M5, xmin retention) — trivially satisfied, riskd makes zero RPC calls (R6.3); (b) do
NOT read the `snapshots` history table as truth — best-effort convenience (`runner.go:53-69`);
truth is `position_balances`.

**LISTEN/NOTIFY vs polling — rule: polling on the P2 side; NOTIFY permitted only riskd→api.**
(1) emitting NOTIFY from the producer reopens senior-approved store transactions for a
convenience; (2) NOTIFY is a doorbell, not a truth channel — delivery is post-commit, droppable
on reconnect; every honest listener needs the poll fallback anyway, so the poll IS the mechanism;
(3) the watermark read is a 2-table ~15-row query — invisible at 1–5s cadence. riskd may
`pg_notify` after its batch commit; api treats it as wake-up only and re-reads `risk_batches` —
never parses state out of the payload. Recompute trigger: any component of the vector changed,
compared by `(last_block, acked_epoch)` per engine — not `last_block` alone (ABA leg, R2).

## R2 — Reorg window honesty. BINDING-RECOMMENDATION

The naked design has two windows; the fix is pure reuse — no new epoch machinery.

**Window A (compute-time):** walker `Rewind` commits epoch E atomically with the raw deletion
(migration 00002:79-90); the runner's ack lands on its next Step (`runner.go:288-297`). Between
those commits, `position_balances` holds since-rewound state. A riskd pass in that window
computes HF from a chain that no longer exists and stamps it "fresh". **Closed by R1's gate** —
`acked_epoch >= max_epoch` inside the snapshot, the same refusal `ApplyDerivedWithRates` makes
at derive.go:221-224.

**Window B (serve-time):** batch computed honestly pre-reorg; reorg lands after; api serves the
old batch until the next pass. The trap inside the trap: `PruneAckedReorgEpochs` (derive.go:859)
deletes acked epochs, so "compare stamped max_epoch to current max_epoch" goes silent after a
full rewind→ack→prune cycle — and `last_block` can regain its old height after the re-walk, an
ABA blindspot. The prune-immune signal is already law: `rewindMoved`'s movement leg reads
`acked_epoch`, never MAX alone. **Rule:** every risk batch stamps, per engine,
`(last_block, acked_epoch)` plus per-chain max-epoch-at-compute; api's staleness surface flags a
batch **superseded** when any of three legs fires against a live read of the two tiny tables:
1. current `acked_epoch` ≠ stamped (rewind happened; monotone, survives prune);
2. current `last_block` < stamped (rewind in progress);
3. current `max_epoch` > current `acked_epoch` (recorded-but-unacked, the complementary leg).

Refuse-to-serve on epoch regression is OPTIONAL at demo grade — reorgs here are ≥5-deep by
construction (walker brackets at `to = head−5`) and the flag heals at the next pass.

**Disclosed residual (record, don't fix):** a polled price row used by a batch and later
neutralized by a D-012 clause-4 marking is invisible to these legs. Per D-012 the row is a
sample and the batch recomputes within one cadence; accepted-and-disclosed, same class as a
missed poll.

## R3 — Param ingestion. BINDING-RECOMMENDATION (core); weld leg BINDING; RPC-historical as primary source is a blocking anti-pattern

**A fact the design must not re-purchase: half the param history is already in custody.** The
walker's getLogs filter is address-only — no topic filter (`internal/chain/chain.go:1498-1501`)
— so `raw_logs` holds every log the DM contract ever emitted; and the DM deriver ALREADY
persists `BorrowTokenConfigSet`/`CollateralTokenConfigSet` as record-only `position_events` with
payload values (`internal/derive/debtmanager.go:429-443`), from genesis, epoch-protected,
replayable. **The DM param-history table is a derived VIEW over existing rows. Zero new RPC.
Any design that polls DM params via RPC at historical blocks is re-fetching what the custody
chain already holds — a blocking finding if it appears.**

**Aave side:** LTV/liq-threshold/liq-bonus/eMode-category params are **PoolConfigurator**
events, and that address is NOT in the current stream set. Classification first: **params are
ledger data, not samples** — a gap is a wrong liquidation threshold in an HF, i.e. corruption.
D-012's own dichotomy (ledger ⇒ event-derived with replay; samples ⇒ poll) puts params on the
event side. Sampling `getConfiguration` at watermarks would be the *inverse* of the D-011
mistake: telemetry-grade custody applied to ledger-grade data, with governance changes between
samples invisible. **Prescription:** one new ingest stream (PoolConfigurator address) through
the existing walker — coherent-window custody, reorg epochs, raw_logs SoT inherited for free —
plus a new param deriver. Backfill is a few thousand getLogs windows on ETH; **probe before you
plan** (R-001 discipline): the dRPC free-tier archive-getLogs contraction is recorded standing
volatility; the brief carries the Alchemy-window-10 fallback posture from the catch-up playbook.

**Pitfalls, ruled:**
- **Proxy upgrades / layout drift:** decode strictly per topic0 under the `checkCanonicalData`
  canons, and — mandatory — a **step-0 topic0 sweep** of the configurator address in `raw_logs`:
  every emitted topic0 either decoded or explicitly ruled non-param in a committed table. For
  params an unhandled config event IS a wrong HF; silence is not available.
- **Governance timing vs pins:** params-as-of keys on `(block_number, log_index)` per chain,
  joined against the watermark vector's per-engine block — DM params against the OP cursor,
  Aave params against the ETH cursor. Never date-effective, never cross-chain by timestamp.
- **The weld (BINDING):** one pinned `getConfiguration`/`borrowTokenConfig` read at the run's
  hash-pinned block (EIP-1898, reported-hash law), on the reconcile RPC config, compared against
  event-derived current params. Divergence = **refuse to serve params, loud** — never silently
  prefer either witness. The only detector for a config path that mutates without emitting
  (upgrade risk). O(reserves) calls at one block. Genesis backstop: config predating the
  stream's first event surfaces as day-one divergence.

## R4 — SSE / live-follow posture. BINDING-RECOMMENDATION (meta contract); daemon-health passthrough OPTIONAL

1. **Never compute public lag against a live RPC head fetched per-request.** One lb hostname is
   many backends on possibly different forks; free-tier head reads flap. The daemon itself
   deleted its block-count `head_lag` condition as a unit fallacy (health.go:112) and moved to
   seconds-based DB-clock-judged staleness. api exposes the same class: **age = DB `now()`
   (Store.Now) minus durable stamps** — `derive_cursors.updated_at` per engine,
   `prices.observed_at` per (asset,source) via `LatestPriceFreshness` (prices.go:1707),
   `sweep_generations.completed_at`, per-account `last_success_block`. **api makes zero RPC
   calls.**
2. **Confirmation-lag disclosure:** publish the design constant — numbers trail head by ≥5
   blocks (walker brackets at to = head−5) plus poll/sweep cadences (60s prices, ~1h
   collateral). The SSE tick means "new risk batch at watermark V", carrying the vector +
   stamps — never "new block".
3. **Meta endpoint minimum honest schema:** per-engine `(last_block, acked_epoch, age)`; reorg
   posture (the three R2 legs + current epoch state); per-(asset,source) price
   `(block, observed_at, valid, invalid_reason)` — the `valid=false` quarantine state must be
   visible, not filtered into absence (D-012 clause 6); DM collateral: sweep generation
   open/complete + never-swept/failed counts (the three-state disambiguation, migration
   00003:2-15). Sanitize every operator-facing string of endpoint URLs (round-22 M2 lesson).
4. **The recorded escalation trigger fires here** (B3): "the moment P3 wires heartbeat-derived
   bounds into risk reads, an unverified heartbeat becomes BLOCKING." Three of four feed
   heartbeats are published-not-verified. If api's staleness verdicts or riskd's usability gate
   judge against them, the B3 empirical-heartbeat scan must land first, or the meta payload
   carries the provenance grade per feed. Do not let a published-not-verified 86400 silently
   green a depegged stable for 25h in a public endpoint.

## R5 — Pipeline-replay harness placement. BINDING-RECOMMENDATION (placement + reorg leg); breadth OPTIONAL

**Placement: early — bound to the first ingest-adjacent P3 task (the Aave param stream), as its
acceptance gate; the reorg leg must exist before api serves public numbers.** The param stream
is the first NEW walker stream since the hash-law/probe-discipline rework, exercising
bootstrap-cursor and startBlock paths P2 only tested destructively against live providers; both
P0s (Multicall3 zero-hash, v1.13.0 header shape) were invisible to every fake and caught only by
real-chain contact — a hermetic fork-backed replay is the cheapest standing instrument with real
EVM semantics without provider roulette. riskd's own tests need a realistic substrate, which the
harness produces deterministically.

**Minimal honest scope:** (a) anvil fork at a hash-pinned block (Task-10 pattern: opt-in env
pair, fails-never-skips once opted in, sanitized sinks); (b) walker `Step` → decode → derive
over a SMALL pinned range containing known subjects (one config change, one borrow, one
liquidation) with `raw_logs` bytes asserted equal to the fork's logs and derived rows asserted
against the fork's view calls; (c) **the reorg leg — the highest-value item**: force a fork-side
reorg (anvil snapshot/revert + re-mine, or `anvil_reorg` where available) and drive `Rewind` →
durable epoch → `RewindDerived` → riskd gate-refusal → recompute end-to-end. That path is the
load-bearing spine of R2's honesty story and has fired live exactly twice, both under incident
conditions. The fork IS the fake, so the fake cannot return physically-impossible values.

## R6 — TrueBlocks/Graph-grade embarrassments

1. **BINDING — the ceiling law.** riskd's scaled→live debt projection MUST use `rayMulCeil`;
   derivation-notes :189 was corrected after acceptance run #1 failed on live chain truth
   because the harness used half-up with a self-referential test. riskd's projection tests
   hard-code the two on-chain vectors (scaled 125415 × 1.094089…RAY → 137216; 83 ×
   1.000520…RAY → 84), never compute expectations from the helper under test.
2. **BINDING — no as-of lie in the HF row.** Debt is as-of the derive cursor; DM collateral is
   as-of that account's `last_success_block`; prices are as-of their own (block, observed_at).
   A risk row stamped with ONE block is the exact "snapshot rows labeled with blocks their
   collateral doesn't represent" finding from Task 7. Carry all three as-ofs; composition is
   read-time and must say so (runner.go:57-60).
3. **BINDING — riskd makes zero RPC calls.** All inputs durable. Any live read inside riskd
   reintroduces provider testimony into a layer with no custody machinery. Stress scenarios are
   price-shifts over stored inputs, not fresh reads.
4. **BINDING — never-swept ≠ zero collateral.** An account with `snapshot_sweeps`
   NeverSucceeded/failed must yield a refused/flagged HF, not HF≈0 (a false liquidation alarm is
   a wrong answer to an honest operator). The live borrower 2026-07-27 (`0xe957…bf20`, held red
   by `collateral_unusable` until first sweep) is the worked example; riskd reproduces that
   posture at the row level.
5. **BINDING — half-written batches unservable.** Risk batch row + member rows in one tx; api
   selects only the max complete batch.
6. **SHOULD — structural read-only.** riskd gets a PG role with SELECT-only on P2 tables,
   DDL/DML only on the risk schema — D-004 single-writer extended by construction.
7. **NOTE — W1 evidence invalidation.** First P3 migration flags W1's stamped evidence — archive
   or re-stamp in the P3-entry transition (ledger P3 entry note).
8. **NOTE — index freshness disclosure.** `rate_indexes` rows exist only when
   `ReserveDataUpdated` fired; live debt accrues between updates. Demo-grade: compute with the
   last observed index and stamp its as-of block (BINDING disclosure); Aave accrual-to-timestamp
   projection is OPTIONAL and requires pinned on-chain vectors if done.

## Verdict — CUSTODY HOLDS, conditional on:

1. R1 — RR read-only snapshot per pass; watermark = per-engine (last_block, acked_epoch) vector
   + per-chain max epoch, read inside it; gate `acked_epoch ≥ max_epoch` refuses the pass.
2. R2 — batch stamps carry `acked_epoch` (prune-immune), and api's three-leg supersession check.
3. R3 — DM params from existing `position_events` (no RPC re-fetch); Aave params via a new
   PoolConfigurator stream (ledger-grade, not sampled) + step-0 topic0 sweep + hash-pinned
   divergence-refusing weld.
4. R6.1 — `rayMulCeil` with hard-coded on-chain vectors.
5. R6.2/R6.4 — three-as-of risk rows; never-swept refusal.
6. R4.4 — heartbeat-provenance handling resolved (B3 scan or provenance-graded meta) before
   heartbeat bounds gate any public risk read.

Key files for the design doc: `cmd/reconcile/main.go:504-554` (read pattern to lift),
`internal/store/reconcile.go:220,278` (reusable watermark readers),
`internal/store/derive.go:198-230,491-651` (gates riskd inherits),
`internal/derive/debtmanager.go:429-443` (DM params already custodied),
`internal/chain/chain.go:1498-1501` (address-complete ingestion),
`internal/store/prices.go:1751-1789` (the only price read contract),
`recon/derivation-notes.md:189,315-340` (ceiling law; heartbeat provenance).
