package store

// Live upgrade-path test for migration 00005 (the Codex round-1 fix wave's
// storage changes) from the CURRENT PUSHED BASELINE, version 4.
//
// A database at version 4 carries `prices` rows with no owner_engine, no validity
// marker, and no poll anchors. The upgrade must:
//
//	(a) attribute every pre-existing row to the writer that produced it, derived
//	    from its source family, so an owner-scoped rewind can still find it —
//	    including a RETIRED Chainlink phase's aggregator, which is the row the
//	    orphan finding is about;
//	(b) quarantine the non-positive answers already recorded, without deleting
//	    them and without stalling anything;
//	(c) leave every positive row valid, and its value and scale untouched;
//	(d) make the invariants unbreakable afterwards — an unowned row, a valid
//	    non-positive row and an incoherent reason/validity pair must all be
//	    refused by the schema, not merely avoided by this code;
//	(e) leave every price operation functional on the upgraded schema: apply,
//	    polled apply with its anchor, the latest-USABLE read, per-asset freshness,
//	    and owner-scoped rewind.
//
// The baseline is reconstructed with goose's UpTo against the SAME embedded
// migration set store.Migrate uses, inside a scratch schema pinned via the DSN's
// search_path — fully isolated from the suite's main schema, whose goose version
// is already current.

import (
	"bytes"
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMigrateUpgradesV4PriceBaselineWithoutDataLoss(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	ctx := context.Background()
	const schema = "solvent_migtest_v4_prices"
	const (
		pollEngine   = "prices:poll:10"
		ethPollEng   = "prices:poll:1"
		feedEngine   = "prices:chainlink_feed:1"
		pollSource   = "priceproviderv2"
		ratioSource  = "ratio:getrate:0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee"
		oldAggSource = "chainlink:0x1111111111111111111111111111111111111111"
		newAggSource = "chainlink:0xc9e1a09622afdb659913fefe800feae5dbbfe9d7"
	)

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

	// (a) The pushed v4 baseline, and proof it truly IS that baseline — the guard
	// against 00005's shapes creeping into an already-applied migration, which is
	// the process failure 00004 exists to remember.
	require.NoError(t, migrateUpTo(ctx, scratch, 4))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'prices'
		  AND column_name IN ('owner_engine', 'valid', 'invalid_reason')`, schema).Scan(&n))
	require.Zero(t, n, "the v4 baseline must NOT carry owner_engine/valid/invalid_reason")
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables
		WHERE table_schema = $1 AND table_name = 'price_poll_anchors'`, schema).Scan(&n))
	require.Zero(t, n, "price_poll_anchors must not exist at the v4 baseline")

	// (b) Pre-existing v4 data, written the only way v4 could: no owner, no
	// validity. It covers every source family this codebase has ever produced,
	// including a retired phase's aggregator and two non-positive answers.
	_, err = s.pool.Exec(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number) VALUES
		(10, $1, $5, 1000000, 6, 100),
		(10, $2, $5, 0, 6, 100),
		(10, $3, $5, -5, 6, 100),
		(1,  $4, $6, 1069000000000000000, 18, 120),
		(1,  $1, $7, 99990000, 8, 150),
		(1,  $1, $8, 99980000, 8, 90)`,
		addr20(0xAA), addr20(0xBB), addr20(0xCC), addr20(0xDD),
		pollSource, ratioSource, newAggSource, oldAggSource)
	require.NoError(t, err)

	// (c) The forward upgrade — the production entry point, exactly as a restarted
	// indexer at the new code would run it.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00005 and everything above it must land on top of the v4 baseline")

	// (d) No data loss, and correct attribution/quarantine of every legacy row.
	type legacyRow struct {
		owner  string
		valid  bool
		reason string
		price  string
	}
	read := func(chainID uint64, a []byte, source string, block uint64) legacyRow {
		var g legacyRow
		require.NoError(t, s.pool.QueryRow(ctx,
			`SELECT owner_engine, valid, invalid_reason, price::text FROM prices
			 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
			chainID, a, source, block).Scan(&g.owner, &g.valid, &g.reason, &g.price))
		return g
	}
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM prices`).Scan(&n))
	require.Equal(t, 6, n, "every legacy row survives: the upgrade quarantines, it never deletes")

	require.Equal(t, legacyRow{pollEngine, true, "", "1000000"}, read(10, addr20(0xAA), pollSource, 100))
	require.Equal(t, legacyRow{pollEngine, false, "non-positive oracle answer", "0"},
		read(10, addr20(0xBB), pollSource, 100), "a zero answer is recorded but quarantined")
	require.Equal(t, legacyRow{pollEngine, false, "non-positive oracle answer", "-5"},
		read(10, addr20(0xCC), pollSource, 100), "a negative answer likewise")
	require.Equal(t, legacyRow{ethPollEng, true, "", "1069000000000000000"},
		read(1, addr20(0xDD), ratioSource, 120), "a ratio row belongs to its chain's poller")
	require.Equal(t, legacyRow{feedEngine, true, "", "99990000"}, read(1, addr20(0xAA), newAggSource, 150))
	require.Equal(t, legacyRow{feedEngine, true, "", "99980000"}, read(1, addr20(0xAA), oldAggSource, 90),
		"a RETIRED phase's aggregator row is attributed to the same feed engine — the orphan fix")

	// (e) The invariants are now enforced by the schema, not merely respected by
	// this code. Each of these is what a future writer would have to do to
	// reintroduce the finding, and each is refused.
	_, err = s.pool.Exec(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason)
		VALUES (10, $1, $2, 1, 6, 900, '', true, '')`, addr20(0xEE), pollSource)
	require.ErrorContains(t, err, "prices_owner_engine_present", "an unowned row is refused by the schema")
	_, err = s.pool.Exec(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason)
		VALUES (10, $1, $2, 0, 6, 900, $3, true, '')`, addr20(0xEE), pollSource, pollEngine)
	require.ErrorContains(t, err, "prices_valid_is_positive",
		"no writer can mark a non-positive answer usable, whatever its code says")
	_, err = s.pool.Exec(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason)
		VALUES (10, $1, $2, 5, 6, 900, $3, false, '')`, addr20(0xEE), pollSource, pollEngine)
	require.ErrorContains(t, err, "prices_invalid_reason_iff_invalid", "invalid with no reason is incoherent")

	// (f) Every price operation functions on the upgraded schema. The v4 rows were
	// inserted directly, so neither engine has a derive cursor; ApplyPrices'
	// implicit first-write ack admits them (these chains carry no epochs).
	anchorHash := bytes.Repeat([]byte{0x20}, 32)
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, pollEngine, 10,
		[]PriceObservation{po(200, 0xAA, pollSource, 1_000_100, 6)}, 200,
		PollAnchor{BlockNumber: 200, BlockHash: anchorHash})))
	anchors, err := s.PollAnchorsBelow(ctx, pollEngine, 10, 200, 8)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{{BlockNumber: 200, BlockHash: anchorHash}}, plainAnchors(anchors))

	usable, found, err := s.LatestUsablePrice(ctx, 10, addr20(0xAA), pollSource)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "1000100", usable.Price.String())
	// The quarantined legacy rows are unreachable through the usable contract even
	// though they are the ONLY rows their keys have — the point of the contract.
	_, found, err = s.LatestUsablePrice(ctx, 10, addr20(0xBB), pollSource)
	require.NoError(t, err)
	require.False(t, found, "a zero answer must never be returned as a usable price")
	_, found, err = s.LatestUsablePrice(ctx, 10, addr20(0xCC), pollSource)
	require.NoError(t, err)
	require.False(t, found, "nor a negative one")

	fresh, err := s.LatestPriceFreshness(ctx, 10, pollEngine)
	require.NoError(t, err)
	require.Len(t, fresh, 3, "freshness covers every (asset, source) key this engine owns")

	// The orphan regression on real storage: the feed engine rewinds by OWNER, so
	// the retired phase's row above the target is deleted even though no currently
	// loaded registry names its source — while the poller's row on the same chain
	// survives.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, feedEngine, 1,
		[]PriceObservation{po(160, 0xAA, newAggSource, 100_000_000, 8)}, 160)))
	require.NoError(t, s.RewindPrices(ctx, feedEngine, 1, 80, 0))
	rows, err := s.pool.Query(ctx,
		`SELECT source || '@' || block_number::text FROM prices WHERE chain_id = 1 ORDER BY 1`)
	require.NoError(t, err)
	defer rows.Close()
	var remaining []string
	for rows.Next() {
		var k string
		require.NoError(t, rows.Scan(&k))
		remaining = append(remaining, k)
	}
	require.NoError(t, rows.Err())
	require.Equal(t, []string{ratioSource + "@120"}, remaining,
		"both feed-owned rows above 80 are gone — the retired aggregator's included — and the poller's ratio row survives")
}
