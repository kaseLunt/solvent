// Tests for the reconcile query layer (Task 9 wave 10, brief §5 + §10).
// Live-db tests reuse testDeriveStore's TEST_DATABASE_URL gating (skipped
// when unset) — the writable SCRATCH database (solvent_test after the wave's
// DB split), NEVER the backfilled live database: this file's helper
// truncates.
package store

import (
	"context"
	"math/big"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

func seedReconEvent(t *testing.T, s *Store, chainID int64, block uint64, txTag string, logIndex int, engine, eventType string, account, asset []byte, side, delta string) {
	t.Helper()
	var d any
	if delta != "" {
		n, ok := new(big.Int).SetString(delta, 10)
		require.True(t, ok, "delta %q", delta)
		d = pgtype.Numeric{Int: n, Valid: true}
	}
	_, err := s.pool.Exec(context.Background(), `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta)
		VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10)`,
		chainID, engine, block, []byte(txTag), logIndex, eventType, account, asset, side, d)
	require.NoError(t, err)
}

// TestAsOfEventSumsIncludesMigrationGenesisAndBoundary pins the as-of
// predicate (brief §3.2; mutation targets "drop migration_genesis from the
// as-of sum predicate" and "as-of sum boundary"):
//
//   - migration_genesis deltas ARE summed — the majority of DM debt genesis
//     is event-invisible on the log stream and enters ONLY through those
//     rows (recon derivation notes, Migration finding);
//   - the boundary is INCLUSIVE (an event AT P counts: ApplyDerived commits
//     events through the cursor block atomically with it);
//   - events above P are excluded.
func TestAsOfEventSumsIncludesMigrationGenesisAndBoundary(t *testing.T) {
	s := testDeriveStore(t)
	acct := []byte{0xaa, 0x01}
	asset := []byte{0xcc, 0x01}
	seedReconEvent(t, s, 10, 100, "tx-genesis", 0, "debt_manager", "migration_genesis", acct, asset, "debt", "1000")
	seedReconEvent(t, s, 10, 200, "tx-borrow", 0, "debt_manager", "borrow", acct, asset, "debt", "50")
	seedReconEvent(t, s, 10, 201, "tx-late", 0, "debt_manager", "borrow", acct, asset, "debt", "7")

	sums, err := AsOfEventSums(context.Background(), s.pool, "debt_manager", [][]byte{acct}, 200)
	require.NoError(t, err)
	require.Len(t, sums, 1)
	require.Equal(t, "1050", sums[0].Total.String(),
		"as-of ≤ 200 must include the genesis row (1000) and the boundary event AT 200 (50), and exclude 201")

	// Above-boundary sanity: at 201 the late borrow joins.
	sums, err = AsOfEventSums(context.Background(), s.pool, "debt_manager", [][]byte{acct}, 201)
	require.NoError(t, err)
	require.Equal(t, "1057", sums[0].Total.String())
}

// TestAssetNetSumsHasNoAccountFilter pins the F1 weld's census property at
// the SQL layer: AssetNetSums aggregates over ALL accounts — there is no
// account parameter to narrow it (risk-quant F1: the sampling universe is
// position_events, so a never-derived borrower is structurally unselectable;
// only a whole-table aggregate can catch phantom debt).
func TestAssetNetSumsHasNoAccountFilter(t *testing.T) {
	s := testDeriveStore(t)
	asset := []byte{0xcc, 0x02}
	seedReconEvent(t, s, 10, 100, "tx-a1", 0, "debt_manager", "borrow", []byte{0xaa, 0x11}, asset, "debt", "100")
	seedReconEvent(t, s, 10, 101, "tx-a2", 0, "debt_manager", "borrow", []byte{0xaa, 0x22}, asset, "debt", "50")

	sums, err := AssetNetSums(context.Background(), s.pool, "debt_manager", "debt", 200)
	require.NoError(t, err)
	require.Len(t, sums, 1)
	require.Equal(t, "150", sums[0].Total.String(),
		"both accounts' deltas must be in the census — a sampled-only weld is exactly the blindness F1 blocks")
}

// TestSampleDMBorrowersStrataPrecedenceAndDeterminism pins the §2
// classification (mutation target "strata partition"): the strata are a
// DISJOINT PRECEDENCE partition — liquidated beats migrated beats
// post_migration — with a live/zero split, and the retrieval order is a
// pure SEED-FREE function of DB-at-P (round-10 F5: the md5(seed||account)
// ordering moved to cmd/reconcile's orderPopulation so no RPC-derived value
// is needed while the snapshot is open).
func TestSampleDMBorrowersStrataPrecedenceAndDeterminism(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	liqMig := []byte{0xaa, 0x31} // liquidation AND migration history → liquidated
	mig := []byte{0xaa, 0x32}    // migration only → migrated
	post := []byte{0xaa, 0x33}   // neither → post_migration
	asset := []byte{0xcc, 0x03}
	seedReconEvent(t, s, 10, 10, "tx-m1", 0, "debt_manager", "migration_genesis", liqMig, asset, "debt", "500")
	seedReconEvent(t, s, 10, 20, "tx-l1", 0, "debt_manager", "liquidation", liqMig, asset, "debt", "-500")
	seedReconEvent(t, s, 10, 21, "tx-r1", 0, "debt_manager", "residue_zeroed", liqMig, asset, "debt", "0")
	seedReconEvent(t, s, 10, 10, "tx-m2", 0, "debt_manager", "migration_genesis", mig, asset, "debt", "300")
	seedReconEvent(t, s, 10, 30, "tx-b1", 0, "debt_manager", "borrow", post, asset, "debt", "100")

	rows, err := SampleDMBorrowers(ctx, s.pool, 100)
	require.NoError(t, err)
	require.Len(t, rows, 3)
	byAccount := map[string]DMBorrowerRow{}
	for _, r := range rows {
		byAccount[r.AccountHex] = r
	}
	require.Equal(t, "liquidated", byAccount["aa31"].Stratum,
		"liquidation history takes precedence over migration history")
	require.Equal(t, "migrated", byAccount["aa32"].Stratum)
	require.Equal(t, "post_migration", byAccount["aa33"].Stratum)
	require.False(t, byAccount["aa31"].Live, "net zero after full liquidation")
	require.True(t, byAccount["aa31"].FullyLiquidated)
	require.True(t, byAccount["aa31"].Residue)
	require.True(t, byAccount["aa32"].Live)

	// Determinism: same (DB, pin) ⇒ identical order; the order is
	// stratum-major and seed-free (the seed ordering is Go-side now).
	again, err := SampleDMBorrowers(ctx, s.pool, 100)
	require.NoError(t, err)
	require.Equal(t, rows, again, "same (DB, pin) must reproduce the identical classified order")
	var strata []string
	for _, r := range rows {
		strata = append(strata, r.Stratum)
	}
	require.Equal(t, []string{"liquidated", "migrated", "post_migration"}, strata)
}

// TestQuerierContractPoolAndTx pins the §5 store API contract: every
// reconcile function takes an explicit Querier and answers identically
// through a pool and through a transaction (the mechanism that lets
// cmd/reconcile hold ONE snapshot while tests use plain pools).
func TestQuerierContractPoolAndTx(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	acct := []byte{0xaa, 0x41}
	asset := []byte{0xcc, 0x04}
	seedReconEvent(t, s, 10, 50, "tx-q1", 0, "debt_manager", "borrow", acct, asset, "debt", "77")

	fromPool, err := AsOfEventSums(ctx, s.pool, "debt_manager", [][]byte{acct}, 100)
	require.NoError(t, err)

	tx, err := s.pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)
	fromTx, err := AsOfEventSums(ctx, tx, "debt_manager", [][]byte{acct}, 100)
	require.NoError(t, err)
	require.Equal(t, fromPool, fromTx)

	// The scans run through both surfaces too.
	_, err = InvariantEventSumMismatches(ctx, s.pool)
	require.NoError(t, err)
	_, err = InvariantEventSumMismatches(ctx, tx)
	require.NoError(t, err)
}

// TestSchemaVersionMatchesEmbeddedExpectation pins the Phase-0 schema gate's
// two halves against each other: after Migrate, the database's max applied
// goose version equals ExpectedSchemaVersion (derived from the embedded
// migrations — currently 9, since 00009 added the daemon's durable
// configured sweep cadence, round-14 F4).
func TestSchemaVersionMatchesEmbeddedExpectation(t *testing.T) {
	s := testDeriveStore(t)
	expected, err := ExpectedSchemaVersion()
	require.NoError(t, err)
	require.EqualValues(t, 9, expected, "embedded expected is currently 9 (migration 00009, round-14 F4)")
	got, err := SchemaVersion(context.Background(), s.pool)
	require.NoError(t, err)
	require.Equal(t, expected, got)
}

// TestEventBalanceInternalCheckLocalizesMismatch: matched state yields no
// rows; a doctored balance yields exactly the doctored key (the §3.2
// internal_inconsistency class localizes an indexer bug at the certified
// accounts).
func TestEventBalanceInternalCheckLocalizesMismatch(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	acct := []byte{0xaa, 0x51}
	asset := []byte{0xcc, 0x05}
	seedReconEvent(t, s, 10, 60, "tx-i1", 0, "debt_manager", "borrow", acct, asset, "debt", "40")
	_, err := s.pool.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
		VALUES ('debt_manager', $1, $2, 'debt', 'event', 40, 60)`, acct, asset)
	require.NoError(t, err)

	ms, err := EventBalanceInternalCheck(ctx, s.pool, "debt_manager", [][]byte{acct}, 100)
	require.NoError(t, err)
	require.Empty(t, ms, "matched event sum and balance must produce no rows")

	_, err = s.pool.Exec(ctx, `UPDATE position_balances SET amount = 41 WHERE account = $1`, acct)
	require.NoError(t, err)
	ms, err = EventBalanceInternalCheck(ctx, s.pool, "debt_manager", [][]byte{acct}, 100)
	require.NoError(t, err)
	require.Len(t, ms, 1)
	require.Equal(t, "40", ms[0].EventSum)
	require.Equal(t, "41", ms[0].Balance)
}

// TestLatestAPYObservationOrdersAcrossBothPayloadSources pins §3.6's APY
// sourcing: rate_indexes(kind='borrow_apy') is NEVER written, so the APY
// comes from position_events payloads — borrow_apy_set.new_apy and
// borrow_token_config_set.borrow_apy — latest (block, log_index, seq) wins.
func TestLatestAPYObservationOrdersAcrossBothPayloadSources(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	asset := []byte{0xcc, 0x06}
	_, err := s.pool.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta, payload)
		VALUES (10,'debt_manager',10,'tx-c1',0,0,'borrow_token_config_set','\x',$1,'',NULL,'{"borrow_apy":"111"}'),
		       (10,'debt_manager',20,'tx-a1',0,0,'borrow_apy_set','\x',$1,'',NULL,'{"new_apy":"222"}'),
		       (10,'debt_manager',30,'tx-a2',0,0,'borrow_apy_set','\x',$1,'',NULL,'{"new_apy":"333"}')`, asset)
	require.NoError(t, err)

	obs, err := LatestAPYObservation(ctx, s.pool, asset, 25)
	require.NoError(t, err)
	require.NotNil(t, obs)
	require.Equal(t, "222", obs.Value.String(), "latest observation ≤ 25 is the block-20 borrow_apy_set")
	require.Equal(t, "borrow_apy_set.new_apy", obs.Source)
	require.EqualValues(t, 20, obs.Block)

	obs, err = LatestAPYObservation(ctx, s.pool, asset, 15)
	require.NoError(t, err)
	require.NotNil(t, obs)
	require.Equal(t, "111", obs.Value.String())
	require.Equal(t, "borrow_token_config_set.borrow_apy", obs.Source)

	obs, err = LatestAPYObservation(ctx, s.pool, asset, 5)
	require.NoError(t, err)
	require.Nil(t, obs, "no observation below the first config event")
}

// TestReconBalancesForSourceConflict mirrors BalancesFor's exclusivity
// probe through the Querier surface (§7): both sources on one (asset, side)
// marks THAT account conflicted — message returned, rows withheld — while a
// clean account in the same batch keeps its rows (the batched shape is
// round-10 F5's one-snapshot-query reader).
func TestReconBalancesForSourceConflict(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	conflicted := []byte{0xaa, 0x61}
	clean := []byte{0xaa, 0x62}
	asset := []byte{0xcc, 0x07}
	_, err := s.pool.Exec(ctx, `INSERT INTO position_balances (engine, account, asset, side, source, amount, updated_block)
		VALUES ('debt_manager',$1,$3,'collateral','event',5,10),
		       ('debt_manager',$1,$3,'collateral','snapshot',5,10),
		       ('debt_manager',$2,$3,'collateral','snapshot',7,11)`, conflicted, clean, asset)
	require.NoError(t, err)
	rows, conflicts, err := ReconBalancesForAccounts(ctx, s.pool, "debt_manager", [][]byte{conflicted, clean})
	require.NoError(t, err)
	require.Contains(t, conflicts["aa61"], "both event- and snapshot-sourced rows")
	require.Contains(t, conflicts["aa61"], ErrBalanceSourceConflict.Error())
	require.NotContains(t, rows, "aa61", "a conflicted account reports the conflict, never rows")
	require.Len(t, rows["aa62"], 1, "a clean account in the same batch keeps its rows")
	require.Equal(t, "7", rows["aa62"][0].Amount.String())
	require.EqualValues(t, 11, rows["aa62"][0].UpdatedBlock)
}

// TestCollateralHistoryDocsAtLastSuccess pins the replay-target prefetch
// (round-10 F5): only success-swept accounts appear, each with the document
// at EXACTLY last_success_block and side='collateral' — a doc at another
// block or the wrong side never substitutes.
func TestCollateralHistoryDocsAtLastSuccess(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	swept := []byte{0xaa, 0x91}
	failed := []byte{0xaa, 0x92}
	_, err := s.pool.Exec(ctx, `INSERT INTO snapshot_sweeps (engine, account, last_attempt_block, last_success_block, status)
		VALUES ('debt_manager',$1,120,120,'success'), ('debt_manager',$2,130,0,'failed')`, swept, failed)
	require.NoError(t, err)
	_, err = s.pool.Exec(ctx, `INSERT INTO snapshots (engine, account, block_number, balances, side) VALUES
		('debt_manager',$1,120,'{"balances":{"cc01":"42"}}','collateral'),
		('debt_manager',$1,119,'{"balances":{"cc01":"41"}}','collateral'),
		('debt_manager',$1,120,'{"balances":{"cc01":"40"}}','debt')`, swept)
	require.NoError(t, err)

	docs, err := CollateralHistoryDocsAtLastSuccess(ctx, s.pool, "debt_manager")
	require.NoError(t, err)
	require.Len(t, docs, 1)
	require.EqualValues(t, 120, docs["aa91"].Block, "the document at EXACTLY last_success_block")
	require.Equal(t, map[string]string{"cc01": "42"}, docs["aa91"].Doc,
		"the collateral-side doc at 120 — never the 119 doc, never the debt-side doc")
	require.NotContains(t, docs, "aa92", "a failed sweep contributes no replay target")
}

// TestCountReconRowsSubAssertions pins the named sub-assertion counters
// (risk-quant F3/F6): side-less and NULL-asset delta-bearing rows, the
// migration_genesis row-vs-distinct split, and the borrow price_source
// census.
func TestCountReconRowsSubAssertions(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	asset := []byte{0xcc, 0x08}
	acct := []byte{0xaa, 0x71}
	// Two genesis ROWS for one account: rows=2, distinct=1 — the gap the
	// artifact must surface, never normalize (L0-3/L2-8).
	seedReconEvent(t, s, 10, 10, "tx-g1", 0, "debt_manager", "migration_genesis", acct, asset, "debt", "1")
	seedReconEvent(t, s, 10, 11, "tx-g2", 0, "debt_manager", "migration_genesis", acct, asset, "debt", "2")
	// A stable-snap borrow for the census line.
	_, err := s.pool.Exec(ctx, `INSERT INTO position_events
		(chain_id, engine, block_number, tx_hash, log_index, seq, event_type, account, asset, side, delta, payload)
		VALUES (10,'debt_manager',12,'tx-b9',0,0,'borrow',$1,$2,'debt',3,'{"price_source":"stable_snap_1e6"}')`, acct, asset)
	require.NoError(t, err)
	// One side-less delta row and one NULL-asset delta row (synthetic — no
	// current event type produces them; the counters exist to NAME the
	// divergence if one ever does).
	seedReconEvent(t, s, 10, 13, "tx-s1", 0, "debt_manager", "synthetic", acct, asset, "", "4")
	seedReconEvent(t, s, 10, 14, "tx-n1", 0, "debt_manager", "synthetic", acct, nil, "debt", "5")

	c, err := CountReconRows(ctx, s.pool)
	require.NoError(t, err)
	require.EqualValues(t, 2, c.MigrationGenesisRows)
	require.EqualValues(t, 1, c.MigrationGenesisDistinct)
	require.EqualValues(t, 1, c.SidelessDeltaBearingRows)
	require.EqualValues(t, 1, c.NullAssetDeltaBearingRows)
	require.EqualValues(t, 1, c.BorrowPriceSourceCensus["stable_snap_1e6"])
}

// TestResidueZeroedAssetsPerToken pins the F2 requirement that residue
// presence is per (account, token), not per account.
func TestResidueZeroedAssetsPerToken(t *testing.T) {
	s := testDeriveStore(t)
	acct := []byte{0xaa, 0x81}
	assetA := []byte{0xcc, 0x09}
	seedReconEvent(t, s, 10, 10, "tx-rz1", 0, "debt_manager", "residue_zeroed", acct, assetA, "debt", "-1")
	m, err := ResidueZeroedAssets(context.Background(), s.pool, [][]byte{acct}, 100)
	require.NoError(t, err)
	require.True(t, m["aa81"]["cc09"], "the residue-bearing token is present")
	require.False(t, m["aa81"]["cc0a"], "a second token of the same account is NOT residue-marked")
}

// TestNumericToBigIntRefusesFractions: pgx's binary codec normalizes
// integral NUMERICs into (Int, Exp≥0) — accepted and rescaled exactly; a
// fractional value (Exp<0) is refused loudly (no float path, brief §3.2).
func TestNumericToBigIntRefusesFractions(t *testing.T) {
	v, err := NumericToBigInt(pgtype.Numeric{Int: big.NewInt(1), Exp: 6, Valid: true})
	require.NoError(t, err)
	require.Equal(t, "1000000", v.String())
	_, err = NumericToBigInt(pgtype.Numeric{Int: big.NewInt(15), Exp: -1, Valid: true})
	require.ErrorContains(t, err, "fractional")
	_, err = NumericToBigInt(pgtype.Numeric{})
	require.ErrorContains(t, err, "NULL")
	_, err = NumericToBigInt(pgtype.Numeric{NaN: true, Valid: true})
	require.ErrorContains(t, err, "NaN")
}
