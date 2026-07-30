package store

// Live upgrade-path test for migration 00013 (the P3 Task-5 risk-materialization
// tables + the riskd role): a database at the pushed 00012 baseline — version 12
// recorded WITHOUT any risk_* table — must reach the current schema through
// store.Migrate with no data loss, and every risk operation must function
// afterwards.
//
// The house rule this discharges: a new migration does not land without its own
// upgrade proof, asserted against currentSchemaVersion so the constant and the
// migration set cannot drift apart. Same scratch-schema construction as
// migrate_upgrade_test.go — goose UpTo against the SAME embedded set the
// production Migrate uses, inside a schema pinned via the DSN's search_path, so
// the suite's main schema (already current) is untouched.

import (
	"context"
	"encoding/hex"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrateUpgradesV12BaselineWithRiskTables(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v12"
	engine := riskAaveEngine

	admin, err := Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(admin.Close)
	_, err = admin.pool.Exec(ctx, "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = admin.pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	})
	scratch := scratchSchemaDSN(t, dsn, schema)

	// (a) The pushed v12 baseline, and proof it truly IS that baseline — no
	// risk_* table may exist yet, or the test would be asserting against a
	// schema that already had what 00013 is supposed to add.
	require.NoError(t, migrateUpTo(ctx, scratch, 12))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables
		WHERE table_schema = $1 AND table_name LIKE 'risk\_%'`, schema).Scan(&n))
	require.Zero(t, n, "the v12 baseline must carry NO risk tables — otherwise 00013 is not what is being tested")

	// (b) Pre-existing P2 data that riskd will read: a derived Aave position,
	// its rate index, a param row and a polled price.
	seedDerivedPre00014(t, s, engine, 1,
		[]PositionEvent{{
			ChainID: 1, Engine: engine, BlockNumber: 100, TxHash: []byte{0x01}, LogIndex: 0,
			EventType: "atoken_mint", Account: addr20(0xA1), Asset: addr20(0xC1),
			Side: "collateral", Delta: bigStr("1000000000000000000"),
		}},
		[]RateObservation{{Asset: addr20(0xC1), Block: 90, Kind: "liquidity_index",
			Value: bigStr("1000000000000000000000000000")}},
		100)
	require.NoError(t, s.ApplyParamEvents(ctx, riskParamEngine, 1, []ParamRow{{
		Engine: riskParamEngine, ChainID: 1, Asset: addr20(0xC1),
		LTV: big.NewInt(7800), LiqThreshold: big.NewInt(8100), LiqBonus: big.NewInt(10600),
		EffectiveBlock: 50, EffectiveLogIndex: 3,
		SourceEvent: "aave_cfg_collateral_configuration_changed", TxHash: []byte{0x0c},
	}}, 100))
	_, err = s.ApplyPolledPrices(ctx, riskPollEngine1, 1, []PriceObservation{{
		Asset: addr20(0xC1), Source: riskAaveOracleSource, Price: bigStr("300000000000"),
		Decimals: 8, BlockNumber: 95, SourceAsOf: time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC),
	}}, 95, PollAnchor{BlockNumber: 95, BlockHash: riskHash32(0x9a)})
	require.NoError(t, err)

	// (c) The forward upgrade — the production entry point, exactly as a
	// restarted daemon at the new code would run it.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version,
		"every forward migration above the v12 baseline must land, 00013 included")

	// (d) NO DATA LOSS: 00013 is purely additive, so every pre-existing P2 row
	// is exactly where it was.
	require.Equal(t, map[string]string{
		hex.EncodeToString(addr20(0xC1)) + "/collateral": "1000000000000000000@100",
	}, balanceRows(t, s, engine, addr20(0xA1), "event"))
	params, err := ParamsAsOfQ(ctx, s.pool, riskParamEngine, 1, 100)
	require.NoError(t, err)
	require.Len(t, params, 1)
	require.Equal(t, "8100", params[0].LiqThreshold.String())
	usable, err := RiskUsablePrices(ctx, s.pool, []RiskPriceKey{
		{ChainID: 1, Asset: addr20(0xC1), Source: riskAaveOracleSource},
	})
	require.NoError(t, err)
	require.Len(t, usable, 1)
	require.Equal(t, "300000000000", usable[0].Value.String())
	require.True(t, usable[0].HasSourceAsOf, "migration 00012's chain-asserted as-of survives 00013")

	// (e) Every risk operation functions on the upgraded schema: the RR snapshot
	// read, the one-transaction batch write with children, the completeness
	// check, and retention.
	tx, err := s.BeginRiskSnapshot(ctx)
	require.NoError(t, err)
	in, err := RiskInputSnapshot(ctx, tx, RiskSnapshotSpec{
		PositionEngines: []string{engine},
		IndexBounds:     map[string]uint64{engine: 100},
		AaveParamEngine: riskParamEngine, AaveParamChain: 1, AaveParamBlock: 100,
		Prices: []RiskPriceKey{{ChainID: 1, Asset: addr20(0xC1), Source: riskAaveOracleSource}},
	})
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
	require.Len(t, in.Balances, 1)
	require.Len(t, in.Indexes, 1)
	require.Len(t, in.AaveParams, 1)
	require.Len(t, in.Prices, 1)

	id, err := s.WriteRiskBatch(ctx, sampleBatch(3))
	require.NoError(t, err)
	require.Positive(t, id)

	batch, found, err := s.NewestCompleteBatch(ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, batch.ID)
	require.Len(t, batch.Watermarks, 4)

	positions, err := s.RiskBatchPositions(ctx, id)
	require.NoError(t, err)
	require.Len(t, positions, 2)
	prices, err := s.RiskBatchPriceInputs(ctx, id)
	require.NoError(t, err)
	require.Len(t, prices, 1)
	aggs, err := s.RiskBatchAggregates(ctx, id)
	require.NoError(t, err)
	require.Len(t, aggs, 2)

	// The deferred FK really is deferred: the children above were inserted
	// BEFORE their parent row and the transaction committed. Prove referential
	// integrity is nonetheless enforced — an orphan child must still abort.
	orphanTx, err := s.pool.Begin(ctx)
	require.NoError(t, err)
	_, err = orphanTx.Exec(ctx, `INSERT INTO risk_positions
		(batch_id, engine, account, status, value_decimals, balances_block, params_block)
		VALUES (999999, $1, $2, $3, 8, 1, 1)`, engine, addr20(0xEE), RiskPositionComputed)
	require.NoError(t, err, "a deferred FK does not complain at INSERT time")
	require.Error(t, orphanTx.Commit(ctx),
		"...but it MUST complain at COMMIT: deferring moves when integrity is checked, never whether")
	_ = orphanTx.Rollback(ctx)

	// Retention prunes to the newest N inside the write transaction.
	for i := 0; i < 4; i++ {
		_, err = s.WriteRiskBatch(ctx, sampleBatch(3))
		require.NoError(t, err)
	}
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM risk_batches`).Scan(&n))
	require.Equal(t, 3, n)
}
