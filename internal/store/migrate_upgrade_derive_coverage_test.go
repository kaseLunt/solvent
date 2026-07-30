package store

// Live upgrade-path test for migration 00014 (derivation-coverage provenance): a
// database at the 00013 baseline must reach the current schema through
// store.Migrate with no data loss — and, the load-bearing part, its PRE-EXISTING
// derived state must come out reading UNPROVEN.
//
// That last assertion is the migration's actual contract. Every derive_cursors row
// that exists when 00014 runs was written by a binary that never recorded coverage,
// so its true provenance is unknown; a DEFAULT that claimed coverage would make
// this migration the bug it was written to prevent. The live database is exactly
// this case — cursor at head, flag ledger never derived — so an upgraded daemon has
// to find its Aave state unproven and refuse the book until a rewind-and-rederive
// re-establishes coverage.
//
// Same scratch-schema construction as the other upgrade proofs: goose UpTo against
// the SAME embedded set production uses, inside a schema pinned via the DSN's
// search_path, so the suite's main schema is untouched.

import (
	"context"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMigrateUpgradesV13BaselineWithDerivationCoverage(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v13"
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

	// (a) The 00013 baseline, and proof it truly IS that baseline — the coverage
	// columns must not exist yet, or this test would assert against a schema that
	// already had what 00014 adds.
	require.NoError(t, migrateUpTo(ctx, scratch, 13))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var cols int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'derive_cursors'
		  AND column_name IN ('covered_from_block', 'decoder_revision')`, schema).Scan(&cols))
	require.Zero(t, cols, "the v13 baseline must carry NEITHER coverage column")

	// (b) Pre-existing derived state, written the only way a v13 binary could: a
	// cursor at "head" with a balance behind it, and NO coverage recorded anywhere.
	seedDerivedPre00014(t, s, engine, 1,
		[]PositionEvent{{
			ChainID: 1, Engine: engine, BlockNumber: 25_000_000, TxHash: []byte{0x01}, LogIndex: 0,
			EventType: "atoken_mint", Account: addr20(0xA1), Asset: addr20(0xC1),
			Side: "collateral", Delta: bigStr("1000000000000000000"),
		}},
		[]RateObservation{{Asset: addr20(0xC1), Block: 24_900_000, Kind: "liquidity_index",
			Value: bigStr("1000000000000000000000000000")}},
		25_000_000)

	// (c) The forward upgrade — the production entry point, exactly as a restarted
	// daemon at the new code would run it.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version,
		"every forward migration above the v13 baseline must land, 00014 included")

	// (d) NO DATA LOSS: 00014 is purely additive.
	require.Equal(t, map[string]string{
		hex.EncodeToString(addr20(0xC1)) + "/collateral": "1000000000000000000@25000000",
	}, balanceRows(t, s, engine, addr20(0xA1), "event"))

	// (e) THE MIGRATION'S CONTRACT: pre-existing derived state reads UNPROVEN.
	//
	// This is the live database's situation. The cursor is at head, the balance is
	// real, and nothing about it licenses reading a missing collateral-flag witness
	// as chain truth — so the coverage predicate must say NO, and riskfeed's
	// whole-engine refusal follows from that.
	c := cvCursor(t, s, engine)
	require.EqualValues(t, 25_000_000, c.LastBlock, "the cursor survived the upgrade at head")
	require.Nil(t, c.CoveredFromBlock,
		"a row that predates 00014 has UNKNOWN provenance, and NULL is how that must read")
	require.EqualValues(t, 0, c.DecoderRevision,
		"a DEFAULT that claimed a revision would license the absence-is-truth reading over an unwalked ledger")
	require.False(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev),
		"THE POINT OF THIS MIGRATION: an upgraded daemon finds its inherited state unproven and refuses, "+
			"instead of publishing zero collateral for every enabled position")

	// (f) And the upgrade did not merely add columns nothing can write: a walking
	// window through the new entry point establishes coverage on the SAME row.
	require.NoError(t, s.ApplyDerivedWindow(ctx, engine, 1, nil, nil, 25_000_100,
		DerivationCoverage{FromBlock: cvGenesis, DecoderRevision: cvRev}))
	c = cvCursor(t, s, engine)
	require.NotNil(t, c.CoveredFromBlock)
	require.Equal(t, cvGenesis, *c.CoveredFromBlock)
	require.True(t, CoverageProvenBack(c.CoveredFromBlock, c.DecoderRevision, cvGenesis, cvRev))
}
