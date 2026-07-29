package store

// Migration 00012 — prices.source_as_of, the CHAIN-ASSERTED as-of.
//
// The column exists because `observed_at` is database INSERTION time and
// nothing else. The two coincide only while ingestion is instantaneous, and the
// whole point of the column is the case where it is not: a price landed out of a
// backfill can be years old while its observed_at is seconds old, and a risk
// read that took observed_at for an as-of would rate it as fresh. Every test
// here therefore separates the two clocks explicitly, so a regression that
// re-derived the as-of from insertion time could not pass.

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// asOfOf reads prices.source_as_of for one row key, distinguishing NULL from a
// value — which is the distinction the whole column turns on.
func asOfOf(t *testing.T, s *Store, chainID uint64, asset []byte, source string, block uint64) (time.Time, bool) {
	t.Helper()
	var at *time.Time
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT source_as_of FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, asset, source, block).Scan(&at))
	if at == nil {
		return time.Time{}, false
	}
	return at.UTC(), true
}

// A written source_as_of survives the round trip verbatim and is reported by the
// read surface P3's risk engine consumes, SEPARATELY from observed_at — the two
// are hours apart here, which is the whole scenario the column exists for.
func TestSourceAsOfRoundTripsSeparatelyFromObservedAt(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// The chain said this price was true nine hours ago; we are inserting it
	// now. Nothing in the store may collapse that gap.
	asOf := time.Now().UTC().Add(-9 * time.Hour).Truncate(time.Second)
	obs := po(100, 0xAA, testPollSource, 1_000_000, 6)
	obs.SourceAsOf = asOf
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{obs}, 100)))

	got, ok := asOfOf(t, s, 10, addr20(0xAA), testPollSource, 100)
	require.True(t, ok)
	require.True(t, asOf.Equal(got), "want %s, got %s", asOf, got)

	usable, found, err := s.LatestUsablePrice(ctx, 10, addr20(0xAA), testPollSource)
	require.NoError(t, err)
	require.True(t, found)
	require.True(t, usable.HasSourceAsOf)
	require.True(t, asOf.Equal(usable.SourceAsOf))
	require.False(t, usable.ObservedAt.IsZero())
	require.True(t, usable.ObservedAt.Sub(usable.SourceAsOf) > 8*time.Hour,
		"observed_at is INSERTION time and must not be conflated with the chain's as-of (observed %s, as-of %s)",
		usable.ObservedAt, usable.SourceAsOf)

	fresh, err := s.LatestPriceFreshness(ctx, 10, testPollEngine)
	require.NoError(t, err)
	require.Len(t, fresh, 1)
	require.True(t, fresh[0].HasSourceAsOf)
	require.True(t, asOf.Equal(fresh[0].SourceAsOf))
	require.True(t, fresh[0].HasValidSourceAsOf)
	require.True(t, asOf.Equal(fresh[0].ValidSourceAsOf))
}

// An observation with NO chain-asserted as-of stores NULL, and every read
// surface reports it as ABSENT rather than as a zero time or as observed_at.
// A consumer has to be able to SEE that the input is missing.
func TestSourceAsOfAbsentIsReportedAbsentNotSubstituted(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6), // SourceAsOf left zero
	}, 100)))

	_, ok := asOfOf(t, s, 10, addr20(0xAA), testPollSource, 100)
	require.False(t, ok, "the Go zero time must store as SQL NULL, never as year-zero")

	usable, found, err := s.LatestUsablePrice(ctx, 10, addr20(0xAA), testPollSource)
	require.NoError(t, err)
	require.True(t, found, "a missing as-of never withholds the price itself")
	require.False(t, usable.HasSourceAsOf)
	require.True(t, usable.SourceAsOf.IsZero(),
		"absence must not be filled from observed_at — that substitution is the defect 00012 exists to prevent")

	fresh, err := s.LatestPriceFreshness(ctx, 10, testPollEngine)
	require.NoError(t, err)
	require.Len(t, fresh, 1)
	require.False(t, fresh[0].HasSourceAsOf)
	require.False(t, fresh[0].HasValidSourceAsOf)
	require.False(t, fresh[0].ObservedAt.IsZero(), "insertion time is still reported; it is simply not an as-of")
}

// An IDEMPOTENT REPLAY writes nothing, source_as_of included. The forward-only
// rule (migration 00012): a legacy NULL row is not opportunistically repaired by
// whichever later batch happens to replay its key, and — the direction that
// would hurt — a replay carrying a different stamp cannot abort the batch,
// because the column is a disclosure and not part of the row's identity.
func TestSourceAsOfReplayNeitherFillsNorAborts(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6), // lands with NULL
	}, 100)))

	replay := po(100, 0xAA, testPollSource, 1_000_000, 6)
	replay.SourceAsOf = time.Now().UTC().Add(-time.Hour)
	res, err := s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{replay}, 100)
	require.NoError(t, err, "a stamp on a replay of an unstamped row must never wedge ingestion")
	require.Empty(t, res.Inserted, "an idempotent replay creates nothing")

	_, ok := asOfOf(t, s, 10, addr20(0xAA), testPollSource, 100)
	require.False(t, ok, "the legacy row stays NULL: repair is the reviewed pass's job, not a replay's")

	// The value guard is untouched: a DIVERGENT price still aborts, stamp or no.
	diverge := po(100, 0xAA, testPollSource, 999, 6)
	diverge.SourceAsOf = replay.SourceAsOf
	_, err = s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{diverge}, 100)
	require.ErrorContains(t, err, "price divergence")
}

// SUPERSEDING a neutralized row re-stamps source_as_of with the SUPERSEDING
// observation's, exactly as it re-stamps observed_at and the anchor binding: the
// row now holds a different value, so keeping the replaced value's as-of would
// describe a number that is no longer there.
func TestSourceAsOfMovesWithASupersedingObservation(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	const H = uint64(5000)

	old := time.Now().UTC().Add(-48 * time.Hour).Truncate(time.Second)
	first := po(H, 0xAA, testPollSource, 1_000_000, 6)
	first.SourceAsOf = old
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{first}, H)))

	// A reorg, and repair marks the row unplaceable.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, H, 0)
	require.NoError(t, err)
	require.EqualValues(t, 1, marked)

	// The chain comes back to H and a CURRENT round observes it again — a
	// genuinely new observation, carrying its own as-of.
	fresh := time.Now().UTC().Add(-time.Minute).Truncate(time.Second)
	second := po(H, 0xAA, testPollSource, 2_000_000, 6)
	second.SourceAsOf = fresh
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{second}, H, PollAnchor{BlockNumber: H, BlockHash: hash32(0xAB)})))

	got, ok := asOfOf(t, s, 10, addr20(0xAA), testPollSource, H)
	require.True(t, ok)
	require.True(t, fresh.Equal(got), "the surviving as-of belongs to the surviving value")
	require.False(t, old.Equal(got))
}

// FillPriceSourceAsOf's three structural guards, asserted against the SQL
// predicate rather than against the caller's good intentions: it fills only
// NULLs, only the engine's own rows, and it never touches a value.
func TestFillPriceSourceAsOfIsScopedNullOnlyAndValuePreserving(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	stamped := time.Now().UTC().Add(-3 * time.Hour).Truncate(time.Second)
	already := po(100, 0xAA, testFeedSource, 1_000_000, 8)
	already.SourceAsOf = stamped
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		already,
		po(101, 0xBB, testFeedSource, 2_000_000, 8), // NULL, fillable
	}, 101)))
	// Another engine's row, also NULL. It is NOT this engine's to repair.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(102, 0xCC, testPollSource, 3_000_000, 6),
	}, 102)))

	span, err := s.MissingSourceAsOfSpan(ctx, testFeedEngine10, 10)
	require.NoError(t, err)
	require.EqualValues(t, 1, span.Rows, "only the feed engine's own unstamped row is in scope")
	require.EqualValues(t, 101, span.MinBlock)
	require.EqualValues(t, 101, span.MaxBlock)

	keys, err := s.PricesMissingSourceAsOf(ctx, testFeedEngine10, 10, 0, 1000)
	require.NoError(t, err)
	require.Len(t, keys, 1)
	require.EqualValues(t, 101, keys[0].BlockNumber)

	// Ask it to fill all three keys — including the already-stamped one and the
	// other engine's. Only one may move.
	overwrite := time.Now().UTC().Truncate(time.Second)
	filled, err := s.FillPriceSourceAsOf(ctx, testFeedEngine10, 10, []SourceAsOfFill{
		{PriceRowKey: PriceRowKey{Asset: addr20(0xAA), Source: testFeedSource, BlockNumber: 100}, SourceAsOf: overwrite},
		{PriceRowKey: PriceRowKey{Asset: addr20(0xBB), Source: testFeedSource, BlockNumber: 101}, SourceAsOf: overwrite},
		{PriceRowKey: PriceRowKey{Asset: addr20(0xCC), Source: testPollSource, BlockNumber: 102}, SourceAsOf: overwrite},
	})
	require.NoError(t, err)
	require.EqualValues(t, 1, filled)

	got, ok := asOfOf(t, s, 10, addr20(0xAA), testFeedSource, 100)
	require.True(t, ok)
	require.True(t, stamped.Equal(got), "an existing stamp is NEVER overwritten")
	got, ok = asOfOf(t, s, 10, addr20(0xBB), testFeedSource, 101)
	require.True(t, ok)
	require.True(t, overwrite.Equal(got))
	_, ok = asOfOf(t, s, 10, addr20(0xCC), testPollSource, 102)
	require.False(t, ok, "another engine's row is out of reach: owner_engine is in the predicate")

	// Values, scales and validity are untouched — the UPDATE names one column.
	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + testFeedSource + "@100": "1000000:8",
		"00000000000000000000000000000000000000bb/" + testFeedSource + "@101": "2000000:8",
		"00000000000000000000000000000000000000cc/" + testPollSource + "@102": "3000000:6",
	}, priceRows(t, s, 10))

	// A second pass finds nothing: the guard is the IS-NULL predicate, so
	// idempotency is a property of the SQL and not of the caller's bookkeeping.
	filled, err = s.FillPriceSourceAsOf(ctx, testFeedEngine10, 10, []SourceAsOfFill{
		{PriceRowKey: PriceRowKey{Asset: addr20(0xBB), Source: testFeedSource, BlockNumber: 101}, SourceAsOf: overwrite},
	})
	require.NoError(t, err)
	require.Zero(t, filled)

	span, err = s.MissingSourceAsOfSpan(ctx, testFeedEngine10, 10)
	require.NoError(t, err)
	require.Zero(t, span.Rows)
}

// A zero timestamp is REFUSED, not silently skipped: skipping would report
// "nothing needed doing" through the same return value a successful fill uses,
// which is how a caller with a broken decoder concludes the heal worked.
func TestFillPriceSourceAsOfRefusesAZeroStamp(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(100, 0xAA, testFeedSource, 1_000_000, 8),
	}, 100)))

	_, err := s.FillPriceSourceAsOf(ctx, testFeedEngine10, 10, []SourceAsOfFill{
		{PriceRowKey: PriceRowKey{Asset: addr20(0xAA), Source: testFeedSource, BlockNumber: 100}},
	})
	require.ErrorContains(t, err, "zero timestamp")

	_, ok := asOfOf(t, s, 10, addr20(0xAA), testFeedSource, 100)
	require.False(t, ok, "the refusal is atomic: nothing in the batch was written")
}

// TestMigrateAddsSourceAsOfOnTopOfV11 is 00012's upgrade proof: the column and
// its partial index land on top of a REAL v11 baseline that already carries
// price rows, those rows survive with NULL, and the writer stamps rows written
// afterwards — the exact sequence a restarted indexer performs.
func TestMigrateAddsSourceAsOfOnTopOfV11(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()
	const schema = "solvent_migtest_v11_asof"

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

	// (a) The v11 baseline, with proof it IS that baseline.
	require.NoError(t, migrateUpTo(ctx, scratch, 11))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'prices' AND column_name = 'source_as_of'`, schema).Scan(&n))
	require.Zero(t, n, "prices.source_as_of must not exist at the v11 baseline")

	// (b) Pre-existing v11 price rows — one per writer identity — which the
	// upgrade must preserve untouched.
	//
	// WRITTEN IN RAW SQL ON PURPOSE. The compiled writer is v12-shaped: its
	// INSERT names source_as_of, so calling it here would fail against the very
	// baseline this test is reconstructing. The point of an upgrade proof is
	// rows that a PREVIOUS binary wrote, so the v11 column list is spelled out.
	_, err = s.pool.Exec(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason, anchor_block)
		VALUES (10, $1, $2, 1000000, 6, 100, $3, true, '', 100),
		       (10, $4, $5, 2000000, 8, 101, $6, true, '', NULL)`,
		addr20(0xAA), testPollSource, testPollEngine,
		addr20(0xBB), testFeedSource, testFeedEngine10)
	require.NoError(t, err)

	// (c) The forward upgrade, exactly as a restarted indexer would run it.
	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00012 must land on top of the v11 baseline")

	// (d) The column's shape, asserted against the schema rather than assumed.
	// NULLABLE FOREVER: a NOT NULL would force a writer with no chain-asserted
	// as-of to invent one, which is the whole defect.
	var dataType, nullable string
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT data_type, is_nullable FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'prices' AND column_name = 'source_as_of'`,
		schema).Scan(&dataType, &nullable))
	require.Equal(t, "timestamp with time zone", dataType)
	require.Equal(t, "YES", nullable)
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes
		WHERE schemaname = $1 AND indexname = 'prices_missing_source_as_of_idx'`, schema).Scan(&n))
	require.Equal(t, 1, n, "the healing guard's partial index must exist")

	// (e) NO DATA LOSS, and no backfill: the pre-existing rows keep their values
	// and carry NULL, which is the honest answer for a fact never recorded.
	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + testPollSource + "@100": "1000000:6",
		"00000000000000000000000000000000000000bb/" + testFeedSource + "@101": "2000000:8",
	}, priceRows(t, s, 10))
	_, ok := asOfOf(t, s, 10, addr20(0xAA), testPollSource, 100)
	require.False(t, ok)
	_, ok = asOfOf(t, s, 10, addr20(0xBB), testFeedSource, 101)
	require.False(t, ok)

	// (f) The writer works at v12: a row written after the upgrade carries its
	// stamp, alongside the legacy NULLs.
	asOf := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	stamped := PriceObservation{
		Asset: addr20(0xAA), Source: testPollSource, Price: big.NewInt(1_100_000),
		Decimals: 6, BlockNumber: 200, SourceAsOf: asOf,
	}
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{stamped}, 200, PollAnchor{BlockNumber: 200, BlockHash: hash32(0xCD)})))
	got, ok := asOfOf(t, s, 10, addr20(0xAA), testPollSource, 200)
	require.True(t, ok)
	require.True(t, asOf.Equal(got))

	span, err := s.MissingSourceAsOfSpan(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.EqualValues(t, 1, span.Rows, "the legacy poll row is still unstamped — forward-only, by design")
}
