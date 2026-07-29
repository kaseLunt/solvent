package store

// Live-db tests for P3 Task 2's param custody: ApplyParamEvents' full
// write-side gate block, ParamsAsOf's effective ordering, ParamHead, and
// RewindParams' epoch arithmetic. Same harness (testDeriveStore) and
// NUMERIC/BYTEA discipline as derive_test.go.

import (
	"context"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

const testParamEngine = "aave_param"

// prow builds a param row on chain 1 for the param engine, varying only what a
// given test cares about. Values are Aave basis points, raw.
func prow(block uint64, logIndex uint32, tx byte, asset byte, ltv, lt, bonus int64) ParamRow {
	return ParamRow{
		Engine:            testParamEngine,
		ChainID:           1,
		Asset:             []byte{asset},
		LTV:               big.NewInt(ltv),
		LiqThreshold:      big.NewInt(lt),
		LiqBonus:          big.NewInt(bonus),
		EffectiveBlock:    block,
		EffectiveLogIndex: logIndex,
		SourceEvent:       "AaveCfgCollateralConfigurationChanged",
		TxHash:            []byte{0x77, tx},
	}
}

func paramRowCount(t *testing.T, s *Store) int {
	t.Helper()
	var n int
	require.NoError(t, s.pool.QueryRow(context.Background(), "SELECT count(*) FROM param_history").Scan(&n))
	return n
}

// TestApplyParamEventsRoundTrip: rows land with their raw denominators intact,
// per-field NULLs survive the round trip, and the cursor advances to the
// batch's through-block even though it sits well above the newest row (a quiet
// governance window still advances custody).
func TestApplyParamEventsRoundTrip(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	cat := uint8(0)
	registry := ParamRow{
		Engine: testParamEngine, ChainID: 1, Asset: []byte{0xAA},
		AToken: []byte{0xA1}, VariableDebtToken: []byte{0xA2}, Strategy: []byte{0xA3},
		EffectiveBlock: 100, EffectiveLogIndex: 1,
		SourceEvent: "AaveCfgReserveInitialized", TxHash: []byte{0x77, 0x01},
	}
	emode := ParamRow{
		Engine: testParamEngine, ChainID: 1, Asset: []byte{0xAA},
		EModeCategory:  &cat,
		EffectiveBlock: 100, EffectiveLogIndex: 2,
		SourceEvent: "AaveCfgEModeAssetCategoryChanged", TxHash: []byte{0x77, 0x01},
	}
	// 100e18-scale values prove NUMERIC carries a denominator BIGINT could not.
	huge, ok := new(big.Int).SetString("100000000000000000000", 10)
	require.True(t, ok)
	collateral := ParamRow{
		Engine: testParamEngine, ChainID: 1, Asset: []byte{0xAA},
		LTV: big.NewInt(7800), LiqThreshold: big.NewInt(8100), LiqBonus: huge,
		EffectiveBlock: 100, EffectiveLogIndex: 3,
		SourceEvent: "AaveCfgCollateralConfigurationChanged", TxHash: []byte{0x77, 0x01},
	}
	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1,
		[]ParamRow{registry, emode, collateral}, 5000))

	got, err := s.ParamsAsOf(ctx, testParamEngine, 1, 5000)
	require.NoError(t, err)
	require.Len(t, got, 3)

	require.Equal(t, "AaveCfgReserveInitialized", got[0].SourceEvent)
	require.Equal(t, []byte{0xA1}, got[0].AToken)
	require.Equal(t, []byte{0xA2}, got[0].VariableDebtToken)
	require.Equal(t, []byte{0xA3}, got[0].Strategy)
	require.Nil(t, got[0].LTV, "a registry row says NOTHING about the ratios — nil, never zero")
	require.Nil(t, got[0].EModeCategory)

	require.Equal(t, "AaveCfgEModeAssetCategoryChanged", got[1].SourceEvent)
	require.NotNil(t, got[1].EModeCategory)
	require.Equal(t, uint8(0), *got[1].EModeCategory)
	require.Nil(t, got[1].AToken)
	require.Nil(t, got[1].LiqThreshold)

	require.Equal(t, "AaveCfgCollateralConfigurationChanged", got[2].SourceEvent)
	require.Equal(t, 0, big.NewInt(7800).Cmp(got[2].LTV))
	require.Equal(t, 0, big.NewInt(8100).Cmp(got[2].LiqThreshold))
	require.Equal(t, 0, huge.Cmp(got[2].LiqBonus), "raw denominator survives — never rescaled at rest")
	require.Nil(t, got[2].AToken)

	// Custody reaches the through-block, not the newest row.
	head, found, err := s.ParamHead(ctx, testParamEngine, 1)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(5000), head)
}

// TestParamsAsOfOrdersByBlockThenLogIndex: the effective order is
// (block, logIndex), including the DISCRIMINATING same-block case — two param
// changes in one block must rank by log index, and the as-of bound is
// inclusive at its block.
func TestParamsAsOfOrdersByBlockThenLogIndex(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Inserted in an order that is neither block- nor index-sorted, so a
	// missing ORDER BY cannot pass by accident.
	rows := []ParamRow{
		prow(200, 4, 0x03, 0xAA, 7000, 7500, 10500),
		prow(100, 9, 0x01, 0xAA, 7800, 8100, 10600), // same block as the next, HIGHER index
		prow(100, 2, 0x02, 0xAA, 5000, 6000, 11000), // same block, LOWER index: must sort first
	}
	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1, rows, 300))

	got, err := s.ParamsAsOf(ctx, testParamEngine, 1, 300)
	require.NoError(t, err)
	require.Len(t, got, 3)
	require.Equal(t, []uint64{100, 100, 200},
		[]uint64{got[0].EffectiveBlock, got[1].EffectiveBlock, got[2].EffectiveBlock})
	require.Equal(t, []uint32{2, 9, 4},
		[]uint32{got[0].EffectiveLogIndex, got[1].EffectiveLogIndex, got[2].EffectiveLogIndex})
	// Same-block discrimination: the LAST row of block 100 is the log-index-9
	// one, so a per-field fold over this prefix lands on LTV 7800, not 5000.
	require.Equal(t, 0, big.NewInt(7800).Cmp(got[1].LTV))

	// The as-of bound is inclusive at its own block and excludes above it.
	got, err = s.ParamsAsOf(ctx, testParamEngine, 1, 100)
	require.NoError(t, err)
	require.Len(t, got, 2)
	got, err = s.ParamsAsOf(ctx, testParamEngine, 1, 99)
	require.NoError(t, err)
	require.Empty(t, got)

	// Engine and chain scoping: another engine's rows are invisible.
	other := prow(100, 1, 0x09, 0xAA, 1, 2, 3)
	other.Engine = "other_param_engine"
	require.NoError(t, s.ApplyParamEvents(ctx, "other_param_engine", 1, []ParamRow{other}, 300))
	got, err = s.ParamsAsOf(ctx, testParamEngine, 1, 300)
	require.NoError(t, err)
	require.Len(t, got, 3, "the other engine's row must not leak into this engine's ledger")
	got, err = s.ParamsAsOf(ctx, testParamEngine, 10, 300)
	require.NoError(t, err)
	require.Empty(t, got, "chain scoping")
}

// TestApplyParamEventsReplaySemantics: an identical replay of a persisted
// (chain_id, tx_hash, log_index) is a NO-OP; a DIVERGENT replay aborts the
// whole batch with nothing partially applied.
func TestApplyParamEventsReplaySemantics(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	first := prow(100, 1, 0x01, 0xAA, 7800, 8100, 10600)
	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{first}, 100))
	require.Equal(t, 1, paramRowCount(t, s))

	// Identical replay: no-op, no duplicate, cursor may still advance.
	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{first}, 150))
	require.Equal(t, 1, paramRowCount(t, s))
	head, _, err := s.ParamHead(ctx, testParamEngine, 1)
	require.NoError(t, err)
	require.Equal(t, uint64(150), head)

	// Divergent replay under the SAME key, batched alongside a fresh row: the
	// WHOLE batch rolls back, so the fresh row must not survive either.
	divergent := first
	divergent.LiqThreshold = big.NewInt(9999)
	fresh := prow(160, 1, 0x02, 0xBB, 1, 2, 3)
	err = s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{fresh, divergent}, 200)
	require.ErrorContains(t, err, "divergent replay")
	require.Equal(t, 1, paramRowCount(t, s), "the fresh row rolled back with the batch")
	head, _, err = s.ParamHead(ctx, testParamEngine, 1)
	require.NoError(t, err)
	require.Equal(t, uint64(150), head, "the cursor did not move")

	// A nil-vs-set field is a divergence too, not a tolerated absence.
	nilled := first
	nilled.LiqBonus = nil
	err = s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{nilled}, 200)
	require.ErrorContains(t, err, "divergent replay")

	// ...and so is a changed source_event under an unchanged value set.
	relabelled := first
	relabelled.SourceEvent = "AaveCfgReserveInitialized"
	err = s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{relabelled}, 200)
	require.ErrorContains(t, err, "divergent replay")
}

// TestApplyParamEventsGateBlock exercises the full write-side gate: chain
// binding, the unacked-epoch refusal, the no-cursor-on-epoch-carrying-chain
// bootstrap refusal, and the height-regression refusal.
func TestApplyParamEventsGateBlock(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// (a) Bootstrap refusal: a NEW engine on a chain that already carries an
	// epoch gets no implicit ack.
	require.NoError(t, s.Rewind(ctx, "eth:aave-param", 1, 90, []byte{0x90}))
	err := s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{prow(95, 1, 0x01, 0xAA, 1, 2, 3)}, 95)
	require.ErrorIs(t, err, ErrUnackedReorgEpoch)
	require.ErrorContains(t, err, "bootstrap via RewindParams")
	require.Zero(t, paramRowCount(t, s))

	// RewindParams IS the bootstrap entry point; after it, the batch lands.
	require.NoError(t, s.RewindParams(ctx, testParamEngine, 1, 89))
	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1,
		[]ParamRow{prow(89, 1, 0x01, 0xAA, 7800, 8100, 10600)}, 89))

	// (b) Unacked-epoch refusal on an ESTABLISHED cursor: a fresh raw rewind
	// re-arms the gate and the next batch is refused until RewindParams acks.
	require.NoError(t, s.Rewind(ctx, "eth:aave-param", 1, 80, []byte{0x80}))
	err = s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{prow(85, 1, 0x02, 0xAA, 1, 2, 3)}, 85)
	require.ErrorIs(t, err, ErrUnackedReorgEpoch)
	require.Equal(t, 1, paramRowCount(t, s), "the refused batch wrote nothing")

	// The ack rewinds to the engine's own cursor (89), which the store lowers
	// to the epoch's rewound_to (80) — so the block-89 row goes with it.
	require.NoError(t, s.RewindParams(ctx, testParamEngine, 1, 89))
	require.Zero(t, paramRowCount(t, s), "the row above the effective target went with the ack")
	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1,
		[]ParamRow{prow(81, 1, 0x02, 0xAA, 1, 2, 3)}, 85))
	require.Equal(t, 1, paramRowCount(t, s))

	// (c) Chain binding: the engine is bound to chain 1; a chain-10 batch is
	// refused BEFORE any epoch reasoning.
	crossChain := prow(86, 1, 0x03, 0xAA, 1, 2, 3)
	crossChain.ChainID = 10
	err = s.ApplyParamEvents(ctx, testParamEngine, 10, []ParamRow{crossChain}, 86)
	require.ErrorIs(t, err, ErrDeriveCursorChainMismatch)
	// ...and ParamHead refuses the same conflation rather than reporting absent.
	_, _, err = s.ParamHead(ctx, testParamEngine, 10)
	require.ErrorIs(t, err, ErrDeriveCursorChainMismatch)

	// (d) Height regression: the cursor sits at 85; a batch claiming 84 is
	// refused, and nothing it carried lands.
	err = s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{prow(84, 9, 0x04, 0xAA, 1, 2, 3)}, 84)
	require.ErrorIs(t, err, ErrDeriveCursorRegression)
	require.Equal(t, 1, paramRowCount(t, s), "the refused batch rolled back its row too")

	// (e) A row above its own batch's through-block is refused up front: the
	// cursor would otherwise claim custody it does not have.
	err = s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{prow(200, 1, 0x05, 0xAA, 1, 2, 3)}, 150)
	require.ErrorContains(t, err, "above the batch through-block")
}

// TestRewindParamsUsesDeepestUnackedTarget is the DISCRIMINATING stacked-epoch
// regression (plan Task 2; geometry mirroring derive_test.go's
// TestRewindDerivedUsesDeepestUnackedTarget). Unacked rewind targets at 50 and
// 80, param rows at 60 and 90, caller passes the SHALLOW target 80:
//
//   - the row at 60 must be DELETED (it lies in (50, 80] — proving the target
//     was lowered to the deepest unacked rewound_to, which only happens if
//     rewindTarget is actually being consumed);
//   - the cursor must reset to 50, not 80;
//   - acked_epoch must equal MAX(epoch) — BOTH epochs acked in the one call.
//
// A deepest-target call would pass a broken implementation; this one cannot.
func TestRewindParamsUsesDeepestUnackedTarget(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{
		prow(45, 1, 0x01, 0xAA, 7000, 7500, 10500),
		prow(60, 1, 0x02, 0xAA, 7800, 8100, 10600),
		prow(90, 1, 0x03, 0xAA, 100, 200, 300),
	}, 90))

	// Stacked raw rewinds: epoch1 rewound_to=50, then epoch2 rewound_to=80.
	require.NoError(t, s.Rewind(ctx, "eth:aave-param", 1, 50, []byte{0x50}))
	require.NoError(t, s.Rewind(ctx, "eth:aave-param", 1, 80, []byte{0x80}))

	// The caller names the SHALLOW target 80; the effective target must be 50.
	require.NoError(t, s.RewindParams(ctx, testParamEngine, 1, 80))

	got, err := s.ParamsAsOf(ctx, testParamEngine, 1, 1000)
	require.NoError(t, err)
	require.Len(t, got, 1, "rows at 60 AND 90 deleted; only block-45 survives")
	require.Equal(t, uint64(45), got[0].EffectiveBlock)

	head, found, err := s.ParamHead(ctx, testParamEngine, 1)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(50), head, "cursor at the effective target, not the caller's 80")

	var acked, maxEpoch int64
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT acked_epoch FROM derive_cursors WHERE engine = $1", testParamEngine).Scan(&acked))
	require.NoError(t, s.pool.QueryRow(ctx,
		"SELECT MAX(epoch) FROM reorg_epochs WHERE chain_id = 1").Scan(&maxEpoch))
	require.Equal(t, maxEpoch, acked, "both epochs acked in the same call")

	// The engine may immediately re-derive the purged range, and a REPLACED
	// value at the same block is accepted (the divergence refusal must not
	// wedge post-rewind re-derivation: the old row is gone, so there is nothing
	// to diverge from).
	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1, []ParamRow{
		prow(60, 1, 0x02, 0xAA, 1111, 2222, 3333),
	}, 90))
	got, err = s.ParamsAsOf(ctx, testParamEngine, 1, 1000)
	require.NoError(t, err)
	require.Len(t, got, 2)
	require.Equal(t, 0, big.NewInt(2222).Cmp(got[1].LiqThreshold),
		"the re-derived row REPLACED the pre-reorg one — not appended alongside it")
}

// TestRewindParamsIsolation: RewindParams touches ONLY its own engine's param
// rows. Another param engine's rows above the target survive, and the position
// tables are not in its blast radius at all.
func TestRewindParamsIsolation(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, s.ApplyParamEvents(ctx, testParamEngine, 1,
		[]ParamRow{prow(100, 1, 0x01, 0xAA, 1, 2, 3)}, 100))
	other := prow(100, 1, 0x02, 0xAA, 4, 5, 6)
	other.Engine = "other_param_engine"
	require.NoError(t, s.ApplyParamEvents(ctx, "other_param_engine", 1, []ParamRow{other}, 100))

	// A position engine on the SAME chain, with derived state above the target.
	posEvent := pe(100, 0x33, 0xAA, 0xBB, "debt", 5)
	posEvent.ChainID = 1
	posEvent.Engine = "debt_manager"
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 1, []PositionEvent{posEvent}, 100))

	require.NoError(t, s.RewindParams(ctx, testParamEngine, 1, 50))

	got, err := s.ParamsAsOf(ctx, testParamEngine, 1, 1000)
	require.NoError(t, err)
	require.Empty(t, got)
	got, err = s.ParamsAsOf(ctx, "other_param_engine", 1, 1000)
	require.NoError(t, err)
	require.Len(t, got, 1, "another engine's param rows are not this engine's to delete")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n, "a param rewind owns no position_events")

	// Chain binding is refused before anything is deleted or acked.
	err = s.RewindParams(ctx, testParamEngine, 10, 50)
	require.ErrorIs(t, err, ErrDeriveCursorChainMismatch)
	got, err = s.ParamsAsOf(ctx, "other_param_engine", 1, 1000)
	require.NoError(t, err)
	require.Len(t, got, 1)
}

// TestParamHeadAbsentBeforeFirstWindow: no cursor means found=false, not a
// zero block that a reader could mistake for genesis custody.
func TestParamHeadAbsentBeforeFirstWindow(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	block, found, err := s.ParamHead(ctx, testParamEngine, 1)
	require.NoError(t, err)
	require.False(t, found)
	require.Zero(t, block)
}

// TestMigrateAddsParamHistoryOnTopOfV10 is 00011's upgrade proof: the table
// lands on top of a real v10 baseline that already carries data, with the
// documented column set and primary key, and nothing below it is disturbed.
func TestMigrateAddsParamHistoryOnTopOfV10(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v10_params"

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

	// (a) The v10 baseline, with proof it IS that baseline.
	require.NoError(t, migrateUpTo(ctx, scratch, 10))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables
		WHERE table_schema = $1 AND table_name = 'param_history'`, schema).Scan(&n))
	require.Zero(t, n, "param_history must not exist at the v10 baseline")

	// (b) Pre-existing v10 data an upgrade must not disturb.
	require.NoError(t, s.ApplyDerived(ctx, "debt_manager", 10,
		[]PositionEvent{pe(50, 1, 0xA1, 0xBB, "debt", 40)}, 60))

	// (c) The forward upgrade, exactly as a restarted indexer would run it.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00011 must land on top of the v10 baseline")

	// (d) The table's shape, asserted against the schema rather than assumed.
	cols := map[string]string{}
	rows, err := s.pool.Query(ctx, `SELECT column_name, is_nullable FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'param_history'`, schema)
	require.NoError(t, err)
	defer rows.Close()
	for rows.Next() {
		var name, nullable string
		require.NoError(t, rows.Scan(&name, &nullable))
		cols[name] = nullable
	}
	require.NoError(t, rows.Err())
	for _, notNull := range []string{"engine", "chain_id", "asset", "effective_block",
		"effective_log_index", "source_event", "tx_hash"} {
		require.Equal(t, "NO", cols[notNull], "%s must be NOT NULL", notNull)
	}
	for _, nullable := range []string{"ltv", "liq_threshold", "liq_bonus", "emode_category",
		"atoken", "variable_debt_token", "strategy"} {
		require.Equal(t, "YES", cols[nullable],
			"%s must be NULLABLE — nil means 'this event said nothing about it', never zero", nullable)
	}

	var pk string
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT string_agg(a.attname, ',' ORDER BY k.ord)
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indrelid
		JOIN pg_namespace ns ON ns.oid = c.relnamespace
		CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
		WHERE ns.nspname = $1 AND c.relname = 'param_history' AND i.indisprimary`, schema).Scan(&pk))
	require.Equal(t, "chain_id,tx_hash,effective_log_index", pk,
		"the PK is the LOG's identity — what makes divergent-replay refusal possible")

	// (e) Nothing below was disturbed.
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM position_events").Scan(&n))
	require.Equal(t, 1, n)
}
