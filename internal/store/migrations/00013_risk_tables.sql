-- +goose Up
-- P3 Task 5: the RISK MATERIALIZATION schema — cmd/riskd's output tables and
-- the riskd PG role. FORWARD migration only; nothing in 00001-00012 is edited,
-- per the 00003 incident's law (goose tracks applied versions by NUMBER, so an
-- in-place edit of an already-applied file silently never runs).
--
-- WHAT THESE TABLES ARE. Risk rows are DERIVED-OF-DERIVED: always rebuildable
-- from position_balances + rate_indexes + snapshot_sweeps + param_history +
-- prices, and therefore carrying no epoch machinery of their own (design spec
-- §2). Reorg honesty comes from two places instead:
--
--   * the COMPUTE-time gate — riskd refuses a pass whose consumed engines have
--     not acknowledged every reorg epoch on their chain (spec §3), and
--   * the SERVE-time stamps — every batch records, per engine, the
--     (last_block, acked_epoch) pair it computed from plus the chain's
--     max-epoch-at-compute, so `cmd/api` can run the three-leg supersession
--     check against a live read of derive_cursors/reorg_epochs (spec §4).
--
-- `acked_epoch` is on the stamp because it is PRUNE-IMMUNE. PruneAckedReorgEpochs
-- deletes acked epochs, so a rewind→ack→prune cycle leaves MAX(reorg_epochs.epoch)
-- unchanged, and `last_block` can regain its old height after the re-walk — the
-- ABA blindspot. RewindDerived always bumps acked_epoch and acks are monotone,
-- so the acked_epoch leg is the one that survives (chain-truth R2).
--
-- NO FLOATS ANYWHERE. Every value quantity is NUMERIC bound from a *big.Int via
-- pgtype.Numeric{Exp: 0} and read back through ::text, exactly as
-- position_events.delta and param_history's ratios are. Addresses are BYTEA,
-- the house encoding. Nothing in this schema is DOUBLE PRECISION and nothing
-- stores a decimal as a JSON number.

-- ---------------------------------------------------------------------------
-- risk_batches — one materialization pass.
-- ---------------------------------------------------------------------------
--
-- COMPLETENESS IS STRUCTURAL, NOT A FLAG YOU TRUST. The batch row and every
-- child row commit in ONE transaction (chain-truth R6.5), and the batch row is
-- inserted LAST inside that transaction, so a visible batch id already has its
-- children by write order. `position_count` is the declared cardinality and
-- `NewestCompleteBatch` verifies the ACTUAL child count against it before
-- serving — belt and braces, because "the writer promises" is not a property a
-- serving path may rest on. A row whose children are missing is skipped, never
-- served half-empty.
--
-- EVERY CHILD FK IS `DEFERRABLE INITIALLY DEFERRED`, and that is what makes the
-- write order above legal. An immediately-checked FK would reject the first
-- child row, forcing the parent to be inserted FIRST — which is precisely the
-- window this schema is shaped to avoid: a `risk_batches` row visible to a
-- concurrent reader before its children exist. Deferring moves the check to
-- COMMIT, so referential integrity is fully enforced (a child with no parent
-- still aborts the transaction) while the parent stays the last row written.
-- Integrity is not traded away here; only the moment of checking moves.
--
-- computed_at is the DATABASE clock (`now()` inside the write transaction),
-- never a process clock: every age `cmd/api` publishes is DB-now minus a
-- durable stamp (chain-truth R4.1).
CREATE TABLE risk_batches (
    id             BIGSERIAL PRIMARY KEY,
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 'complete' is the only value riskd writes. The column exists so a future
    -- producer can mark a batch it deliberately abandoned without deleting the
    -- evidence; NewestCompleteBatch requires it AND the count check.
    status         TEXT   NOT NULL,

    -- DECLARED CARDINALITIES FOR EVERY MANDATORY CHILD RELATION.
    --
    -- position_count alone was not enough, and the gap was a false pass: a
    -- partial restore holding every position header but no price snapshots and
    -- no aggregates satisfied a positions-only check, so a stored health factor
    -- could be served with NO input evidence behind it and a book total could
    -- read empty. A guard that does not guard its own premise is worse than no
    -- guard, because it is believed. NewestCompleteBatch now validates ALL of
    -- these against the actual rows.
    position_count      INT NOT NULL,
    leg_count           INT NOT NULL DEFAULT 0,
    price_input_count   INT NOT NULL DEFAULT 0,
    aggregate_count     INT NOT NULL DEFAULT 0,
    -- The engines whose stamps MUST be present for this batch to be servable.
    -- "any one watermark exists" was the same false-pass shape: supersession is
    -- checked per engine, so a batch missing one engine's stamp cannot be judged
    -- for that engine and must not be served at all.
    required_engines    TEXT[] NOT NULL DEFAULT '{}',

    -- Counts are DECLARED here and recomputed per engine in
    -- risk_batch_aggregates. They are the batch-level rollup a book endpoint
    -- reads without touching the position rows.
    refused_count  INT    NOT NULL DEFAULT 0,
    flagged_count  INT    NOT NULL DEFAULT 0,
    -- The riskd build that produced the batch, so a number can be traced to the
    -- code that computed it.
    producer       TEXT   NOT NULL DEFAULT '',

    -- IDEMPOTENCY KEY FOR THE INDETERMINATE COMMIT.
    --
    -- A lost commit acknowledgement is not a rollback: PostgreSQL may have
    -- committed and the reply may have died on the wire. A producer that simply
    -- retried would write the batch TWICE, and the duplicate is not harmless —
    -- the first (committed) attempt becomes the step-comparison baseline, so a
    -- 100→200 price move that the first attempt correctly FLAGGED is re-judged
    -- as 200→200 on the retry, and the newest batch silently loses the
    -- large-step warning an operator was supposed to see.
    --
    -- AN ATTEMPT-SCOPED KEY IS NOT ENOUGH, and that was the first attempt's
    -- mistake. A key minted per pass invocation and discarded on error protects
    -- only the path where the reconciliation lookup ITSELF succeeds. Three
    -- ordinary histories walk straight past it:
    --
    --   * the commit lands and the reconciliation lookup also fails (one network
    --     event kills both);
    --   * the process restarts before it reconciles;
    --   * a second honest riskd instance starts after the flagged batch
    --     committed.
    --
    -- In every one of them the next pass re-reads the committed POST-MOVE price
    -- as its baseline, mints a FRESH key, and writes an unflagged duplicate —
    -- the original harm, untouched.
    --
    -- So the key is DETERMINISTIC IN WHAT IS BEING MATERIALIZED, never in who is
    -- materializing it or when: any process that reads the same substrate at the
    -- same watermarks under the same policy derives the SAME key, and therefore
    -- ADOPTS the committed batch instead of duplicating it. The re-baselining
    -- hole closes as a consequence rather than as a second guard.
    --
    -- materialization_vector and substrate_digest are persisted ALONGSIDE the key
    -- so adoption is VERIFIED rather than assumed: a key that matches while the
    -- identity behind it differs is refused LOUDLY, never silently adopted. The
    -- vector string is deliberately human-readable — it is also the operational
    -- answer to "what was this batch computed from".
    materialization_key    TEXT NOT NULL UNIQUE,
    materialization_vector TEXT NOT NULL DEFAULT '',
    substrate_digest       TEXT NOT NULL DEFAULT '',

    -- The engines for which a SWEEP DISCLOSURE is MANDATORY on this batch.
    --
    -- Without it, "every required engine has a watermark row" was satisfiable by
    -- a debt_manager row carrying only cursor fields. The sweep columns must stay
    -- nullable — the Aave engine genuinely has no sweeper — so a restored or
    -- hand-inserted batch could omit the sweep payload entirely, pass every count
    -- and required-engine check, and read back with Sweep nil. A swept engine
    -- then becomes indistinguishable from an engine with NO sweeper, a serving
    -- consumer cannot compare the batch against later sweep movement, and
    -- hour-stale Debt Manager collateral becomes presentable as current.
    -- Recording the requirement is what makes the absence detectable.
    required_sweep_engines TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX risk_batches_newest_idx ON risk_batches (id DESC);

-- ---------------------------------------------------------------------------
-- risk_batch_watermarks — the per-engine stamp vector (spec §4).
-- ---------------------------------------------------------------------------
--
-- ONE ROW PER CONSUMED ENGINE. chain_id is carried alongside because the
-- per-chain max-epoch-at-compute is stamped HERE rather than in a second table:
-- derive_cursors binds each engine to exactly one chain (the binding is enforced
-- on every write path in this package), so an engine row IS a chain row for the
-- chain it names. Two engines on one chain therefore carry the same
-- max_epoch_at_compute, and that redundancy is the point — the stamp is readable
-- from any engine's row without a join.
--
-- THE SWEEP COLUMNS ARE PART OF THE WATERMARK, not decoration. Debt Manager
-- collateral is produced by the ~1h snapshot sweep, and `ApplySweepBatch` moves
-- `snapshot_sweeps` and the snapshot-sourced balances WITHOUT touching any
-- derive cursor or reorg epoch. A recompute trigger watching only cursors is
-- therefore blind to the two transitions that matter most:
--
--   * a first SUCCESSFUL sweep, after which a published SWEEP_NEVER refusal is
--     stale and wrong — the account's collateral is now known;
--   * a FAILED sweep after a prior success, after which the previously
--     published unflagged result is stale and carries no staleness flag.
--
-- Either could stand until some unrelated cursor happened to move. So the sweep
-- state joins the vector, and the state a batch CONSUMED is stamped here — the
-- same reason the cursor pair is stamped: a serving surface has to be able to
-- ask "is what I am about to serve still current?".
CREATE TABLE risk_batch_watermarks (
    batch_id             BIGINT NOT NULL REFERENCES risk_batches(id) ON DELETE CASCADE
                                  DEFERRABLE INITIALLY DEFERRED,
    engine               TEXT   NOT NULL,
    chain_id             BIGINT NOT NULL,
    last_block           BIGINT NOT NULL,
    acked_epoch          BIGINT NOT NULL,
    max_epoch_at_compute BIGINT NOT NULL,

    -- Per-engine sweep state at compute time; NULL for engines that have no
    -- collateral sweep (the Aave engine, the param engine, the price pollers).
    -- Absence is meaningful and must stay distinguishable from "zero rows".
    sweep_rows           BIGINT,
    sweep_failed         BIGINT,
    -- The SUM of last_success_block over all swept accounts. A sum moves
    -- whenever any single account's last success moves, which a MAX would miss
    -- when a lagging account catches up behind an already-higher peer.
    sweep_success_sum    NUMERIC,
    sweep_max_updated_at TIMESTAMPTZ,
    sweep_generation     BIGINT,
    sweep_generation_open BOOLEAN,

    -- sweep_applicable is the ROW'S OWN statement about whether this engine has a
    -- collateral sweep at all, and it is NOT NULL so the statement cannot be
    -- omitted. Together with the CHECK below it makes the sweep payload
    -- ALL-OR-NOTHING: an applicable row carries every sweep column, a
    -- non-applicable row carries none.
    --
    -- The distinction it protects is load-bearing: "this engine has no sweeper"
    -- (Aave, whose collateral is event-derived from aToken transfers) and "this
    -- engine swept and found nothing" are different facts, and a reader that
    -- confused them would treat hour-stale collateral as freshly confirmed. A
    -- nullable-everything shape let a partially-filled row assert neither.
    sweep_applicable BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (batch_id, engine),

    -- ALL-OR-NOTHING on the sweep column group. A partial sweep payload is not a
    -- degraded disclosure, it is an uninterpretable one: a consumer cannot tell
    -- whether a NULL means "no sweeper", "not recorded", or "zero", and each of
    -- those licenses a different conclusion about freshness.
    --
    -- sweep_max_updated_at is deliberately EXCLUDED from the NOT NULL side: a
    -- swept engine with zero attempted accounts legitimately has no most-recent
    -- write, and forcing a timestamp there would mean inventing one.
    CONSTRAINT risk_batch_watermarks_sweep_all_or_nothing CHECK (
        (sweep_applicable AND sweep_rows IS NOT NULL
                          AND sweep_failed IS NOT NULL
                          AND sweep_success_sum IS NOT NULL
                          AND sweep_generation IS NOT NULL
                          AND sweep_generation_open IS NOT NULL)
        OR
        (NOT sweep_applicable AND sweep_rows IS NULL
                              AND sweep_failed IS NULL
                              AND sweep_success_sum IS NULL
                              AND sweep_max_updated_at IS NULL
                              AND sweep_generation IS NULL
                              AND sweep_generation_open IS NULL)
    )
);

-- ---------------------------------------------------------------------------
-- risk_positions — one account's verdict on one engine.
-- ---------------------------------------------------------------------------
--
-- THE TWO ENGINES ARE NEVER BLENDED (spec §5.2). Aave is a continuous health
-- factor in base currency (8-dec, thresholds in basis points); the Debt Manager
-- is a STRICT liquidatable boolean in USD 6-dec with HUNDRED_PERCENT (100e18)
-- thresholds. `value_decimals` records which scale THIS row's money columns are
-- in, so nothing downstream has to infer it, and the engine-specific columns are
-- nullable rather than shared.
--
-- HF IS STORED AS AN EXACT RATIONAL (hf_num/hf_den) *and* as the chain-identical
-- wad. The wad is the single fused floor division the deployed contract performs
-- (P-2); the rational is what downstream exact arithmetic (liquidation price,
-- waterfall crossings) needs, and a wad cannot be un-rounded back into it.
-- hf_infinite is a TYPED MARKER for zero debt — undefined-because-unbounded —
-- never a large number standing in for infinity, because a comparison against a
-- threshold would silently succeed against the stand-in.
--
-- REFUSALS ARE ROWS, NOT ABSENCES. A position the degradation gates refused
-- (spec §7 G1-G3) is written with status='refused', its refusal_code and the
-- asset that caused it — because an account that disappears from a batch reads
-- as "no risk here", which is the false-safety direction. The never-swept and
-- failed-sweep Debt Manager accounts land here rather than as HF≈0 (chain-truth
-- R6.4: the 0xe957…bf20 posture, at the row level).
--
-- `flags` is a TEXT[] and propagates upward: any flag on a position is counted
-- into risk_batch_aggregates for its engine (oracle-sentinel R2/G4).
CREATE TABLE risk_positions (
    batch_id       BIGINT NOT NULL REFERENCES risk_batches(id) ON DELETE CASCADE
                                  DEFERRABLE INITIALLY DEFERRED,
    engine         TEXT   NOT NULL,
    account        BYTEA  NOT NULL,

    -- 'computed' | 'refused'
    status         TEXT   NOT NULL,
    -- G1 | G2 | G3 | SWEEP_NEVER | SWEEP_FAILED | ENGINE — empty when computed.
    refusal_code   TEXT   NOT NULL DEFAULT '',
    refusal_detail TEXT   NOT NULL DEFAULT '',
    refusal_asset  BYTEA,
    flags          TEXT[] NOT NULL DEFAULT '{}',

    value_decimals SMALLINT NOT NULL,

    -- Health factor, both forms. NULL on a refused row and on a row with no
    -- debt (where hf_infinite is true instead).
    hf_num         NUMERIC,
    hf_den         NUMERIC,
    hf_wad         NUMERIC,
    hf_infinite    BOOLEAN NOT NULL DEFAULT false,

    -- Aave legs (NULL on Debt Manager rows).
    total_collateral_base NUMERIC,
    total_debt_base       NUMERIC,
    weighted_lt_sum       NUMERIC,
    avg_lt_bps            NUMERIC,

    -- Debt Manager legs (NULL on Aave rows). liquidatable is the STRICT
    -- ground-truth boolean, `borrowings > max_borrow_lt`; equality is healthy.
    collateral_value_usd  NUMERIC,
    max_borrow_lt         NUMERIC,
    borrowings            NUMERIC,
    liquidatable          BOOLEAN,

    -- The three as-ofs every served number carries (chain-truth R6.2). A risk
    -- row stamped with ONE block is the Task-7 finding class and is banned:
    -- debt is as-of the derive cursor, DM collateral as-of that account's
    -- last_success_block, params as-of the param cursor. Per-asset rate-index
    -- as-ofs live on risk_position_legs, and per-price as-ofs on
    -- risk_price_inputs, because both genuinely vary per asset.
    balances_block BIGINT NOT NULL,
    params_block   BIGINT NOT NULL,
    sweep_block    BIGINT NOT NULL DEFAULT 0,

    -- Labeled exactly as oracle-sentinel R1 permits a single summary timestamp
    -- to be: the MINIMUM as-of over the inputs actually consumed. NULL when the
    -- position consumed no price.
    oldest_price_input TIMESTAMPTZ,
    stale_price_inputs BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (batch_id, engine, account)
);
CREATE INDEX risk_positions_account_idx ON risk_positions (account, batch_id);

-- ---------------------------------------------------------------------------
-- risk_position_legs — one asset's contribution, with its OWN index as-of.
-- ---------------------------------------------------------------------------
--
-- WHY THIS TABLE EXISTS AT ALL. `rate_indexes` rows appear only when
-- ReserveDataUpdated fired, so an index can trail the derive cursor badly, and a
-- current balances watermark sitting over an old index hides the debt leg's true
-- shelf life (design spec §5, Codex round 1 [H5]). The index as-of is therefore
-- PER RESERVE and cannot live on risk_positions. It is stamped as a BLOCK and
-- not a time because this schema holds no block header timestamps — raw_logs
-- records none — and inventing one from insertion time is exactly the
-- fabricated-freshness class migration 00012 exists to close.
--
-- The table is a union over the two engines: Aave rows carry scaled/live/base
-- legs and two index blocks; Debt Manager rows carry amount/value/contribution.
CREATE TABLE risk_position_legs (
    batch_id  BIGINT NOT NULL REFERENCES risk_batches(id) ON DELETE CASCADE
                                  DEFERRABLE INITIALLY DEFERRED,
    engine    TEXT   NOT NULL,
    account   BYTEA  NOT NULL,
    asset     BYTEA  NOT NULL,
    decimals  SMALLINT NOT NULL,

    -- Aave.
    scaled_debt        NUMERIC,
    scaled_collateral  NUMERIC,
    live_debt          NUMERIC,
    live_collateral    NUMERIC,
    debt_base          NUMERIC,
    collateral_base    NUMERIC,
    weighted_lt        NUMERIC,
    used_as_collateral BOOLEAN,
    debt_index_block       BIGINT,
    collateral_index_block BIGINT,

    -- Debt Manager.
    amount                  NUMERIC,
    value_usd               NUMERIC,
    max_borrow_contribution NUMERIC,

    -- Raw in the emitting protocol's denominator (bps for Aave, 100e18 for the
    -- Debt Manager) — storage never normalizes, exactly as param_history does not.
    liq_threshold NUMERIC,
    liq_bonus     NUMERIC,

    PRIMARY KEY (batch_id, engine, account, asset),
    -- A leg belongs to a POSITION, and the composite FK says so structurally: a
    -- leg whose position row is absent cannot exist, so "positions restored but
    -- legs orphaned" is not a reachable state rather than a state a serving
    -- predicate has to remember to check.
    FOREIGN KEY (batch_id, engine, account)
        REFERENCES risk_positions(batch_id, engine, account) ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED
);

-- ---------------------------------------------------------------------------
-- risk_price_inputs — FULL price snapshots, never identity references.
-- ---------------------------------------------------------------------------
--
-- THIS IS A COPY, ON PURPOSE, AND THE COPY IS THE CONTRACT (design spec §7,
-- Codex round 1 [H6]). Serve-time re-derivation of a price disclosure is a TOCTOU
-- lie, and an identity JOIN back into `prices` breaks for two independent
-- reasons: D-012 neutralization flips `valid` IN PLACE on the very row a batch
-- consumed, and a later poll supersedes the same (chain, asset, source) key at a
-- higher block. Either one lets a serve-time join disclose a DIFFERENT input than
-- the batch actually used. So value, decimals, block, as-of, source, provenance,
-- budget and verdict are all copied here at write time, and nothing downstream
-- ever needs to look at `prices` to describe a served number.
--
-- A MISSING PRICE IS A ROW. value NULL with verdict='missing' is how an unpriced
-- asset is recorded: "never drop an unpriced asset" (oracle-sentinel R2/G1) means
-- the asset must still be visible on the position that refused because of it.
--
-- source_as_of is the CHAIN's own as-of — a poll round's anchor block header
-- timestamp, or a feed round's AnswerUpdated.updatedAt (migration 00012). It is
-- NULL only on a 'missing' row: a NULL source_as_of on a real price row is
-- REFUSED for as-of purposes upstream (G1), and `observed_at` is never
-- substituted for it.
CREATE TABLE risk_price_inputs (
    batch_id   BIGINT NOT NULL REFERENCES risk_batches(id) ON DELETE CASCADE
                                  DEFERRABLE INITIALLY DEFERRED,
    engine     TEXT   NOT NULL,
    account    BYTEA  NOT NULL,
    asset      BYTEA  NOT NULL,

    chain_id   BIGINT NOT NULL,
    source     TEXT   NOT NULL,
    provenance TEXT   NOT NULL,

    value        NUMERIC,
    decimals     SMALLINT,
    block_number BIGINT,
    source_as_of TIMESTAMPTZ,

    -- The input's OWN budget, stored with the verdict it produced, so a reader
    -- sees what the verdict was judged against rather than having to know the
    -- policy (design spec §7: "freshness verdict against that input's OWN
    -- budget (with the budget)").
    budget_seconds BIGINT NOT NULL,
    -- 'fresh' | 'stale' | 'over-ceiling' | 'missing' | 'no-as-of' | 'reorg-unacked'
    verdict        TEXT   NOT NULL,
    age_seconds    BIGINT,

    PRIMARY KEY (batch_id, engine, account, asset, source),
    -- Same law as the legs: a price disclosure exists only as evidence FOR a
    -- position, so it cannot outlive or precede one.
    FOREIGN KEY (batch_id, engine, account)
        REFERENCES risk_positions(batch_id, engine, account) ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED
);

-- ---------------------------------------------------------------------------
-- risk_batch_aggregates — the per-engine rollup, un-blended.
-- ---------------------------------------------------------------------------
--
-- One row per (batch, engine). The engines keep SEPARATE money columns and
-- separate scales because their USD scales differ and summing them would be a
-- silent 100× error (spec §5.2: engines are never blended into one number).
--
-- flagged_positions is the FLAG PROPAGATION leg: a stale price input on one
-- position must be visible in the aggregate that contains it, or an operator
-- reading the book sees a clean total over degraded rows (oracle-sentinel R2/G4).
CREATE TABLE risk_batch_aggregates (
    batch_id       BIGINT NOT NULL REFERENCES risk_batches(id) ON DELETE CASCADE
                                  DEFERRABLE INITIALLY DEFERRED,
    engine         TEXT   NOT NULL,
    value_decimals SMALLINT NOT NULL,

    positions            INT NOT NULL,
    computed_positions   INT NOT NULL,
    refused_positions    INT NOT NULL,
    flagged_positions    INT NOT NULL,
    liquidatable_positions INT NOT NULL,

    -- Sums over COMPUTED rows only, in this engine's own scale. Refused rows
    -- contribute nothing and are counted separately: silently folding a refused
    -- position in as zero is the understatement a refusal exists to prevent.
    total_collateral NUMERIC NOT NULL,
    total_debt       NUMERIC NOT NULL,

    PRIMARY KEY (batch_id, engine)
);

-- ---------------------------------------------------------------------------
-- risk_scenarios / risk_waterfall — batch children, schema landed, UNPOPULATED.
-- ---------------------------------------------------------------------------
--
-- These two are created here so the stress and waterfall surfaces do not have to
-- reopen this migration later, and they are DELIBERATELY NOT WRITTEN by the
-- Task-5 riskd. Their producers (risk.ApplyScenario / risk.Waterfall over the
-- assembled book) carry no acceptance test in this task's brief, and
-- materializing untested stress numbers into a table an API will serve is
-- precisely the "schema-valid-but-wrong" failure the plan's Task-7 test
-- obligations exist to catch. Populating them is owed forward with their tests.
--
-- grid_point and every money column are NUMERIC decimal integers; the grid is
-- WAD-scaled (risk.WaterfallGridScale) and stored as such, never as a float
-- fraction.
CREATE TABLE risk_scenarios (
    batch_id    BIGINT NOT NULL REFERENCES risk_batches(id) ON DELETE CASCADE
                                  DEFERRABLE INITIALLY DEFERRED,
    scenario_id TEXT   NOT NULL,
    engine      TEXT   NOT NULL,
    value_decimals SMALLINT NOT NULL,

    liquidatable_positions INT NOT NULL DEFAULT 0,
    debt_eligible          NUMERIC,
    collateral_at_risk     NUMERIC,
    bad_debt               NUMERIC,
    execution_shortfall    NUMERIC,
    -- Assets the scenario HELD FLAT for want of a propagation entry, named on
    -- the output because an asset silently held at its pre-shock price is
    -- oracle-sentinel R4's named failure.
    held_flat_assets BYTEA[] NOT NULL DEFAULT '{}',

    PRIMARY KEY (batch_id, scenario_id, engine)
);

CREATE TABLE risk_waterfall (
    batch_id    BIGINT NOT NULL REFERENCES risk_batches(id) ON DELETE CASCADE
                                  DEFERRABLE INITIALLY DEFERRED,
    scenario_id TEXT   NOT NULL,
    engine      TEXT   NOT NULL,
    grid_point  NUMERIC NOT NULL,
    value_decimals SMALLINT NOT NULL,

    debt_eligible      NUMERIC NOT NULL,
    collateral_at_risk NUMERIC NOT NULL,
    bad_debt           NUMERIC NOT NULL,
    positions          INT NOT NULL,

    PRIMARY KEY (batch_id, scenario_id, engine, grid_point)
);

-- ---------------------------------------------------------------------------
-- The riskd role — structural read-only over P2 (spec §2 SHOULD).
-- ---------------------------------------------------------------------------
--
-- D-004's single-writer contract extended BY CONSTRUCTION rather than by
-- convention: riskd can SELECT the indexer's tables and can only ever write the
-- risk schema, so "riskd never writes P2 state" is enforced by the database
-- instead of by review (chain-truth R6.6).
--
-- THE ROLE IS CREATED NOLOGIN AND CARRIES NO PASSWORD. A credential committed to
-- a migration is a credential published to everyone who clones the repo; the
-- operator grants LOGIN with a password of their choosing (see .env.example,
-- SOLVENT_RISKD_DATABASE_URL). The GRANT block below is the part that is
-- structural, and it stands whether or not anyone ever logs in as this role.
--
-- THE WHOLE BLOCK IS EXCEPTION-GUARDED. Creating a role needs CREATEROLE, which
-- an ordinary owner in a managed Postgres may not have. Failing every migration
-- on every database to enforce a SHOULD would be a worse outcome than a NOTICE:
-- the risk tables above are what the daemon actually needs, and they are already
-- committed by the time this runs.
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solvent_riskd') THEN
        CREATE ROLE solvent_riskd NOLOGIN;
    END IF;

    -- P2 tables: SELECT only. Named explicitly rather than granted with ALL
    -- TABLES IN SCHEMA, so a table added later does not silently inherit
    -- access nobody decided to give it.
    GRANT SELECT ON
        raw_logs, ingest_cursors,
        position_events, position_balances, derive_cursors, rate_indexes,
        reorg_epochs, prices, snapshots, snapshot_sweeps, sweep_generations,
        price_poll_anchors, param_history, goose_db_version
        TO solvent_riskd;

    -- Risk tables: full DML. riskd is their only writer.
    GRANT SELECT, INSERT, UPDATE, DELETE ON
        risk_batches, risk_batch_watermarks, risk_positions,
        risk_position_legs, risk_price_inputs, risk_batch_aggregates,
        risk_scenarios, risk_waterfall
        TO solvent_riskd;
    GRANT USAGE, SELECT ON SEQUENCE risk_batches_id_seq TO solvent_riskd;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'riskd role not provisioned (insufficient privilege): %. The risk tables are committed; grant the role manually to get the structural read-only posture.', SQLERRM;
END
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solvent_riskd') THEN
        REVOKE ALL ON
            risk_batches, risk_batch_watermarks, risk_positions,
            risk_position_legs, risk_price_inputs, risk_batch_aggregates,
            risk_scenarios, risk_waterfall
            FROM solvent_riskd;
        REVOKE ALL ON SEQUENCE risk_batches_id_seq FROM solvent_riskd;
        REVOKE ALL ON
            raw_logs, ingest_cursors,
            position_events, position_balances, derive_cursors, rate_indexes,
            reorg_epochs, prices, snapshots, snapshot_sweeps, sweep_generations,
            price_poll_anchors, param_history, goose_db_version
            FROM solvent_riskd;
        DROP ROLE solvent_riskd;
    END IF;
EXCEPTION
    -- WHEN OTHERS, and only on the DOWN path. A role is CLUSTER-global while
    -- these tables are schema-local, so a second schema that ran this migration
    -- still holds grants and DROP ROLE fails with dependent_objects_still_exist.
    -- That is a correct refusal, not a corruption: the role simply outlives one
    -- schema's rollback. Failing the whole down-migration over it would block a
    -- developer resetting a scratch schema.
    WHEN OTHERS THEN
        RAISE NOTICE 'riskd role not removed: %', SQLERRM;
END
$$;
-- +goose StatementEnd
DROP TABLE risk_waterfall;
DROP TABLE risk_scenarios;
DROP TABLE risk_batch_aggregates;
DROP TABLE risk_price_inputs;
DROP TABLE risk_position_legs;
DROP TABLE risk_positions;
DROP TABLE risk_batch_watermarks;
DROP TABLE risk_batches;
