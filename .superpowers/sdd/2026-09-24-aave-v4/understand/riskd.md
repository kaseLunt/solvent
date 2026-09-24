## riskd batch model: how a batch is formed and refused, and the minimal V4 change

### 1. Engine sets and the watermark vector
- **`consumedEngines`** (`cmd/riskd/main.go:167-172`) is a hard-coded list of six names: Aave position, param and price engines, and DM position, param and price engines. The DM param engine is `debt_manager` itself (`main.go:463-468`). This list filters the cursors that enter the vector (`cmd/riskd/gates.go:32-48`). Reorg epochs are kept only for consumed chains (`gates.go:53-61`).
- **`gatedEngines`** (`main.go:186-202`) holds (engine, chain) pairs for `aave_v3_etherfi`, `aave_param` and `debt_manager`. Price engines are left out on purpose. They are gated per position by G2 (`internal/riskfeed/assemble.go:428-441`).
- **`sweptEngines`** (`main.go:215-217`) is DM only.
- **`requiredStampEngines`** (`main.go:351-370`) is the consumed engines that have a cursor. An engine with no cursor is skipped (`:360-362`), on the reasoning that a missing position cursor has "already refused the pass at the gate".
- **`snapshotSpec`** (`main.go:375-404`) hard-codes `PositionEngines: {Aave, DM}`. Every read is bounded at that engine's own cursor.
- **Trigger.** `Changed` (`gates.go:159-215`) compares these legs:
  - last_block, acked_epoch and chain;
  - coverage (`sameCoverage`, `:136-157`);
  - max epochs;
  - the sweep aggregate (`sweepEqual`, `:100-119`).
  `runLoop` (`main.go:642-679`) runs a pass on startup, on a vector change, or at `freshnessDue`. The freshness deadline is armed only from consulted **prices** (`cmd/riskd/pass.go:206`).

### 2. What happens when one engine's input is missing or unacked
**If the engine is one of the gated three, the whole pass is refused. Nothing is written.**
- `gatePass` (`gates.go:293-305`) calls `riskfeed.GateEpochs` (`internal/riskfeed/gate.go:145-214`). Each of `missing_cursor`, `chain_mismatch` and `unacked_epoch` (`gate.go:55-68`) sets `OK=false`.
- `runPass` then returns `Gated=true` before reading the substrate (`pass.go:110-113`). `riskTick` logs this at info level and does **not** record the vector (`main.go:616-622`), so the previous batch keeps serving.
- **The pass-level refusal is never persisted.** It exists only in logs.
- The whole pass also fails on:
  - vector drift inside the snapshot (`pass.go:124-127`);
  - a param fold error (`assemble.go:444-459`);
  - a computed row with no liquidatable verdict (`assemble.go:1241-1244`).

Price engines are not gated this way. A missing price cursor becomes a per-position G1. An unacked price epoch becomes a per-position G2.

### 3. Batch identity
- `ComputeMaterializationIdentity` (`internal/riskfeed/identity.go:161-310`) builds the key from:
  - a policy line: revision, budget, step, producer and registry fingerprint (`:176-178`);
  - bindings for **Aave and DM only** (`:189-192`);
  - `required=` and `swept=` (`:192-193`);
  - one cursor line per engine, including coverage (`:217-222`);
  - epochs;
  - the sweep aggregate (`:236-256`);
  - freshness **phases** over consulted prices (`:269-285`);
  - a substrate digest (`:312-404`) over balances, conflicts, indexes, sweep rows, params, consulted flags and consulted prices.
- `IdentityPolicy` is defined at `identity.go:103-129`.
- `AlgorithmRevision = 6` (`assemble.go:126`). The rule at `:25-45` requires a bump for any change to refusal rules or aggregation.

### 4. How Debt Manager sweep collateral enters a batch
- **The vector leg.** `riskSweepState` always returns one row per swept engine, all zeros if the engine has never swept (`internal/store/risk.go:631-680`). Its fields are rows, failed, success_sum, max_updated_at, generation and open.
- **The stamp.** The sweep state is stamped on the DM watermark (`gates.go:328-335`). It is required at write time (`pass.go:195`, `store/risk.go:1186-1204`) and at serve time (the `NewestCompleteBatch` predicate, `store/risk.go:~1611-1625`). The table's all-or-nothing CHECK is `risk_batch_watermarks_sweep_all_or_nothing` (migration 00013, `:219`).
- **Per account** (`assemble.go:1000-1013`):
  - no sweep row → `SWEEP_NEVER`;
  - `last_success_block == 0` → `SWEEP_NEVER`;
  - status is not success → computed, with flag `collateral_sweep_stale` (`internal/riskfeed/prices.go:68`), stamped at last_success_block.
- **riskd has no age or time budget for sweeps.** Only prices age.

### 5. Where refusals are recorded, and the closed vocabulary
- **Account level:** `risk_positions.refusal_code` (00013, `:273-274`), written by `refuse` (`assemble.go:1162-1181`).
  - Refusal codes: `G1`, `G2`, `G3` (`prices.go:33-51`), plus `SWEEP_NEVER` and `ENGINE` (`assemble.go:242-267`).
  - `G4` and `G5` compute and flag rather than refuse.
  - Flags: `stale_price`, `large_price_step`, `collateral_sweep_stale`, `aave_collateral_opted_out`, `aave_collateral_never_enabled` (`prices.go:65-89`).
  - The 00013 comment lists `SWEEP_FAILED` (`:273`), but no Go code emits it. The comment has drifted from the code.
- **Engine level:** `risk_batch_aggregates.refusal_code` (00014, `:88-94`). It is plain TEXT with no CHECK.
  - Assemble fills an `engineRefusals` map of engine → detail (`assemble.go:586-589`).
  - `aggregate` then **hard-codes** the code to `GateFlagCustodyUnproven` (`assemble.go:1265-1271`).
  - `engine_refusal_test.go:32-56` pins the set at `Len == 1`. `:65-88` pins the literal in the 00014 backfill (`00014:126-133`).
- **The API.** `engineRefusalNote` already has a generic fallback (`cmd/api/handlers.go:110-116`). But `readBatchAccounts` **refuses the whole view** if any aggregate or position engine has no watermark stamp (`cmd/api/read.go:~408-425`).

### 6. Minimal change: make an absent or stale V4 generation an engine-scoped refusal
1. **Keep V4 out of `gatedEngines`.** Handle it the way `priceReorg` handles price engines: judge it once inside Assemble and scope the result to that engine.
   - V4's discovery cursor (chain 10) goes into `consumedEngines`, so it drives the trigger and gets a stamp.
   - A missing cursor, an unacked OP epoch, an absent sealed generation, a stale one, or a failed completeness ring each becomes a V4 engine refusal. None of them sets `Gated`.
2. **Add a generation leg to the vector.** Mirror `RiskSweepStateFor`: one row per generation engine, always present, carrying generation id, pinned block and hash, ring verdict and sealed_at.
   - Add it to `Changed`, to the identity (a new `generation:` line), and to the substrate digest over the stored pinned inputs.
   - Put the generation's freshness **phase** in the identity, not its timestamp. This follows the existing rule for prices (`identity.go:269-285`).
   - Arm a generation freshness deadline alongside `NextFreshnessDeadline`. Otherwise a stalled sweeper leaves "fresh" standing.
3. **Let the engine-refusal map carry a code as well as the detail.** Currently it is detail only, with the code hard-coded at `:1269`.
   - Add V4 to `aggregate`'s `order` and `decimals` (`assemble.go:1197-1198`). Without this, V4 positions are silently skipped, and `WriteRiskBatch`'s aggregate-count check (`store/risk.go:~1210-1220`) fails the **whole** write.
   - Add one justified code, for example `GENERATION_UNSERVABLE`, with the sub-reason in the detail. Update `engine_refusal_test.go` to `Len == 2`, and record that 00014 needs no backfill because V4 has no legacy rollups.
4. **Always stamp V4, even when the generation or cursor is absent.** Otherwise the API's stamp requirement (`read.go`) refuses DM and Aave too.
   - This needs the V4 stamp sourced from the generation row, or `requiredStampEngines` / `stampsFor` taught about it.
   - Add generation columns to `risk_batch_watermarks` with an all-or-nothing CHECK like the sweep columns, plus a `required_generation_engines` check in `NewestCompleteBatch`. That means a new migration, and `requireSchema` compares the version for exact equality.
5. **Bump `AlgorithmRevision` to 7, and add the V4 binding to the identity policy loop** (`identity.go:189-192`).

### Implications for the V4 design
- **Must change:**
  - `aggregate`'s hard-coded code and its fixed Aave/DM engine list;
  - `snapshotSpec.PositionEngines`;
  - the identity bindings;
  - the stamp and required sets, which need a generation stamp;
  - the closed-vocabulary test;
  - `AlgorithmRevision`;
  - a new migration for the generation stamp columns;
  - a freshness deadline for generation age.
- **Can reuse:**
  - `GateEpochs`, called with V4-only requirements inside Assemble;
  - the always-present-row pattern from `riskSweepState`;
  - the engine-rollup refusal columns (no CHECK, so no DDL change);
  - the API's generic `engineRefusalNote`;
  - the consulted-set digest discipline;
  - per-position `refuse()` for weld mismatches against the stored `getUserAccountData`.
- **Would break:**
  - Putting V4 in `gatedEngines` means one stale generation blocks every DM and Aave batch.
  - An unstamped V4 aggregate makes the API refuse the whole batch.
  - Leaving V4 out of `aggregate` makes `WriteRiskBatch` fail.
  - Not bumping the revision lets a new binary adopt a rev-6 batch.
  - The price gates G1, G2, G4 and G5 don't apply as written: V4's oracle prices are pinned in the generation, not polled.