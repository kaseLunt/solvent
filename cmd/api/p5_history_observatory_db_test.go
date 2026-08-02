package main

// GET /v1/address/{addr}/history and GET /v1/observatory/series — the
// retained-batch and rollup histories, against the live scratch database.

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAddressHistoryServesPersistedPointsNewestFirst(t *testing.T) {
	f := newP5Fixture(t)
	second := f.seedBatch(t, "fixture-materialization-2")

	out := f.getJSON(t, "/v1/address/"+fxAcctAave.Hex()+"/history", "/v1/address/{addr}/history")
	require.Equal(t, true, out["found"])
	require.Equal(t, true, out["lookup_complete"])
	require.Equal(t, float64(defaultHistoryLimit), out["limit"])

	engines := asList(t, out["engines"])
	require.Len(t, engines, 2, "every engine in the window's rollups gets a series")
	var aave map[string]any
	for _, e := range engines {
		if asMap(t, e)["engine"] == "aave_v3_etherfi" {
			aave = asMap(t, e)
		}
	}
	require.NotNil(t, aave)
	require.Equal(t, float64(8), aave["value_decimals"])
	require.Empty(t, asList(t, aave["withheld_batch_ids"]))

	points := asList(t, aave["points"])
	require.Len(t, points, 2, "one persisted point per retained batch carrying the account")
	newest, oldest := asMap(t, points[0]), asMap(t, points[1])
	require.Equal(t, float64(second), newest["batch_id"], "newest batch first")
	require.Equal(t, float64(f.batchID), oldest["batch_id"])
	require.Equal(t, "computed", newest["status"])
	require.Equal(t, fxAaveHFWad, asMap(t, newest["health_factor"])["wad"], "the point is the PERSISTED row")
	require.Equal(t, fxAaveCollateralBase, newest["total_collateral_base"])
	require.Equal(t, fxAaveDebtBase, newest["total_debt_base"])
	// Wave R2 Finding A inverted this assertion, and the assertion it replaces is
	// worth naming: it read `require.Nil(..., "Aave has no strict boolean — null,
	// never false")`. That is true of the CHAIN — the pool exposes no
	// `liquidatable(user)` call — and it was silently taken to mean the VERDICT
	// was unpublishable, which is how a null column became codified as intended
	// behaviour on the read side while `/v1/book` published
	// `liquidatable_positions: 0` over a book with three breached accounts. The
	// verdict is derived (`HF < 1e18`, strict) and, since algorithm revision 6,
	// persisted per row. The fixture's HF wad is 1.08e18 — above the bar — so the
	// point carries a real FALSE.
	require.Equal(t, false, newest["liquidatable"],
		"Aave's verdict is derived and persisted since revision 6: false is a verdict, null was an omission")
	require.Equal(t, float64(0), newest["sweep_block"],
		"contract 1.2.1: every point carries its sweep watermark; Aave has no sweeper, so 0 is the disclosed absence")

	// The DM series: each point's watermark is ITS batch's persisted
	// sweep_block, beside the strict verdict it clocks — never the newest
	// batch's stamp (the mixed-clock lie the 1.2.1 field exists to prevent).
	dmOut := f.getJSON(t, "/v1/address/"+fxAcctDM.Hex()+"/history", "/v1/address/{addr}/history")
	var dm map[string]any
	for _, e := range asList(t, dmOut["engines"]) {
		if asMap(t, e)["engine"] == "debt_manager" {
			dm = asMap(t, e)
		}
	}
	require.NotNil(t, dm)
	dmPoints := asList(t, dm["points"])
	require.Len(t, dmPoints, 2)
	for _, p := range dmPoints {
		pt := asMap(t, p)
		require.Equal(t, true, pt["liquidatable"], "the fixture's DM row is liquidatable at par")
		require.Equal(t, float64(fxDMSweepBlock), pt["sweep_block"],
			"the point's OWN persisted sweep watermark travels with the verdict")
	}
}

// TestAddressHistoryRefusedBatchesArePointsNotGaps: an account the batch
// REFUSED appears as a refusal point with its named code — a missing point
// would read as "no risk here", the false-safety direction.
func TestAddressHistoryRefusedBatchesArePointsNotGaps(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/address/"+fxAcctDMRef.Hex()+"/history", "/v1/address/{addr}/history")
	require.Equal(t, true, out["found"])
	var dm map[string]any
	for _, e := range asList(t, out["engines"]) {
		if asMap(t, e)["engine"] == "debt_manager" {
			dm = asMap(t, e)
		}
	}
	require.NotNil(t, dm)
	points := asList(t, dm["points"])
	require.Len(t, points, 1)
	pt := asMap(t, points[0])
	require.Equal(t, "refused", pt["status"])
	require.Equal(t, "SWEEP_NEVER", asMap(t, pt["refusal"])["code"])
	require.Nil(t, pt["liquidatable"], "a refused row's verdict is WITHHELD — null, never false")
	require.Equal(t, "1500000000", pt["total_debt_base"], "the persisted debt the batch did record still serves")
	require.Nil(t, pt["total_collateral_base"], "unswept collateral is UNKNOWN — null, never zero")
	require.Equal(t, float64(0), pt["sweep_block"],
		"a SWEEP_NEVER refusal's watermark is 0 — an ABSENT sweep rendered visibly, never 'swept at genesis'")
}

// TestAddressHistoryWithheldWindowSemantics: a batch in which an engine's book
// was withheld is a NAMED hole per series, and `found` goes three-valued over
// the window.
func TestAddressHistoryWithheldWindowSemantics(t *testing.T) {
	f := newP5Fixture(t)
	withheldID := f.seedWithheldBatch(t, "withheld-materialization-1", false)

	// A known account: found stays TRUE (its points exist), the hole is named.
	out := f.getJSON(t, "/v1/address/"+fxAcctAave.Hex()+"/history", "/v1/address/{addr}/history")
	require.Equal(t, true, out["found"])
	require.Equal(t, false, out["lookup_complete"])
	var aave map[string]any
	for _, e := range asList(t, out["engines"]) {
		if asMap(t, e)["engine"] == "aave_v3_etherfi" {
			aave = asMap(t, e)
		}
	}
	require.Equal(t, []any{float64(withheldID)}, asList(t, aave["withheld_batch_ids"]),
		"the withheld batch is NAMED per series — without it, an engine-wide refusal is indistinguishable from a closed position")
	require.Len(t, asList(t, aave["points"]), 1, "the withheld batch contributes no point for ANY account")
	withheldEngines := asList(t, out["withheld_engines"])
	require.Len(t, withheldEngines, 1, "the NEWEST batch's withholding is on the response envelope")

	// An unknown account: the answer CANNOT be established — null, never false.
	unknown := f.getJSON(t, "/v1/address/"+fxAcctUnknown.Hex()+"/history", "/v1/address/{addr}/history")
	require.Nil(t, unknown["found"],
		"an engine's book was withheld somewhere in the window, so a definitive negative is unavailable — null, NEVER `no position`")

	// The control: with every engine consultable, the same lookup is a
	// definitive false.
	f2 := newP5Fixture(t)
	control := f2.getJSON(t, "/v1/address/"+fxAcctUnknown.Hex()+"/history", "/v1/address/{addr}/history")
	require.Equal(t, false, control["found"], "every engine was consultable in every covered batch: a definitive negative")
	require.Equal(t, true, control["lookup_complete"])
}

func TestAddressHistoryLimitBoundsTheWindow(t *testing.T) {
	f := newP5Fixture(t)
	second := f.seedBatch(t, "fixture-materialization-2")

	out := f.getJSON(t, "/v1/address/"+fxAcctAave.Hex()+"/history?limit=1", "/v1/address/{addr}/history")
	require.Equal(t, float64(1), out["limit"])
	var aave map[string]any
	for _, e := range asList(t, out["engines"]) {
		if asMap(t, e)["engine"] == "aave_v3_etherfi" {
			aave = asMap(t, e)
		}
	}
	points := asList(t, aave["points"])
	require.Len(t, points, 1, "limit covers RETAINED BATCHES, newest first")
	require.Equal(t, float64(second), asMap(t, points[0])["batch_id"])

	bad := f.getStatusJSON(t, "/v1/address/"+fxAcctAave.Hex()+"/history?limit=501", "/v1/address/{addr}/history", http.StatusBadRequest)
	require.Equal(t, "bad_request", asMap(t, bad["error"])["code"])
	badAddr := f.getStatusJSON(t, "/v1/address/0x123/history", "/v1/address/{addr}/history", http.StatusBadRequest)
	require.Equal(t, "bad_request", asMap(t, badAddr["error"])["code"])
}

// ---------------------------------------------------------------------------
// /v1/observatory/series
// ---------------------------------------------------------------------------

// seedObservatoryBuckets writes three hourly buckets through the PRODUCTION
// rollup writer, time-shifting each written bucket into the past (the writer
// only ever writes the current hour; the shift moves a production-shaped row,
// exactly as internal/store's own series tests do):
//
//	-2h: observing the base batch
//	-1h: observing a second identical batch
//	 0h: observing a batch whose Aave book is WITHHELD
func seedObservatoryBuckets(t *testing.T, f *apiFixture) {
	t.Helper()
	shift := func(hours int) {
		_, err := f.admin.Exec(f.ctx,
			`UPDATE observatory_points SET bucket_start = bucket_start - make_interval(hours => $1)
			  WHERE bucket_start = date_trunc('hour', now())`, hours)
		require.NoError(t, err)
	}
	_, wrote, err := f.store.WriteObservatoryPoints(f.ctx)
	require.NoError(t, err)
	require.True(t, wrote)
	shift(2)

	f.seedBatch(t, "obs-materialization-2")
	_, wrote, err = f.store.WriteObservatoryPoints(f.ctx)
	require.NoError(t, err)
	require.True(t, wrote)
	shift(1)

	f.seedWithheldBatch(t, "obs-withheld-3", false)
	_, wrote, err = f.store.WriteObservatoryPoints(f.ctx)
	require.NoError(t, err)
	require.True(t, wrote)
}

func TestObservatorySeriesServesCapturedBucketsWithHonestWithholding(t *testing.T) {
	f := newP5Fixture(t)
	seedObservatoryBuckets(t, f)

	out := f.getJSON(t, "/v1/observatory/series?engine=aave_v3_etherfi", "/v1/observatory/series")
	require.Equal(t, "aave_v3_etherfi", out["engine"])
	require.Equal(t, float64(8), out["usd_decimals"])
	require.Nil(t, out["step_seconds"])

	points := asList(t, out["points"])
	require.Len(t, points, 3)
	p0, p2 := asMap(t, points[0]), asMap(t, points[2])

	// Oldest first: a computed bucket carries the batch's own copied totals.
	require.Equal(t, false, p0["refused"])
	require.Nil(t, p0["refusal_code"])
	require.Equal(t, fxAaveDebtBase, p0["debt_usd"])
	require.Equal(t, fxAaveCollateralBase, p0["collateral_usd"])
	require.Equal(t, float64(2), p0["accounts"])
	require.Equal(t, float64(fxAaveBlock), p0["last_block"], "the bucket's own as-of: the engine's balances watermark AT CAPTURE, never a later head")

	// The sweep stamp (1.2.2): the aave engine's absence is RECORDED — the
	// batch stated "no sweeper", which is a different fact from "the record
	// does not exist" (sweep_recorded false).
	require.Equal(t, true, p0["sweep_recorded"])
	require.Nil(t, p0["sweep"], "aave has no collateral sweep: a recorded null, never a stamp invented for it")
	rates := asList(t, p0["rates"])
	require.Len(t, rates, 1)
	r0 := asMap(t, rates[0])
	require.Equal(t, fxWeETHEth.Hex(), r0["asset"])
	require.Equal(t, "liquidity_index", r0["kind"])
	require.Equal(t, fxRateIndexValue, r0["value"], "the NEWEST observation per (asset, kind), verbatim decimal string")
	require.Equal(t, float64(fxRateIndexBlock), r0["as_of_block"], "the index's OWN as-of block")

	// The newest bucket observed the WITHHELD batch: totals are NULL for that
	// reason — never the persisted zeros.
	require.Equal(t, true, p2["refused"])
	require.Equal(t, "FLAG_CUSTODY_UNPROVEN", p2["refusal_code"])
	require.Nil(t, p2["debt_usd"], "a withheld bucket's totals are null, never 0 — the most dangerous zero")
	require.Nil(t, p2["collateral_usd"])
	require.Nil(t, p2["accounts"])
	require.Nil(t, p2["liquidatable_positions"])
	require.Equal(t, true, p2["sweep_recorded"],
		"withholding the BOOK never erases the watermark record: the stamp pair and the sweep record are batch facts, not book facts")

	// The other engine's series is whole — and every DM bucket serves the
	// observed batch's sweep stamp VERBATIM (the fixture stamp: rows 3,
	// failed 1, success_sum 309593004, generation 4, closed), because the
	// bucket's liquidatable count aggregates that sweep-cut.
	dm := f.getJSON(t, "/v1/observatory/series?engine=debt_manager", "/v1/observatory/series")
	dmPoints := asList(t, dm["points"])
	require.Len(t, dmPoints, 3)
	for _, p := range dmPoints {
		pm := asMap(t, p)
		require.Equal(t, false, pm["refused"])
		require.Equal(t, true, pm["sweep_recorded"])
		sw := asMap(t, pm["sweep"])
		require.Equal(t, float64(3), sw["rows"])
		require.Equal(t, float64(1), sw["failed"])
		require.Equal(t, "309593004", sw["success_sum"], "a decimal STRING, the house no-floats law")
		require.Equal(t, float64(4), sw["generation"])
		require.Equal(t, false, sw["generation_open"])
		require.NotNil(t, sw["max_updated_at"])
		require.NotNil(t, sw["age_seconds"], "DB-now minus the stamp — the only serve-time quantity in the stamp")
	}
	require.Equal(t, float64(6), dm["usd_decimals"])
}

// TestObservatorySeriesUnrecordedSweepIsDisclosedNeverInvented: a pre-00018
// bucket whose observed batch was pruned before the backfill has NO sweep
// record — the wire serves `sweep_recorded: false` with a null stamp, never
// "this engine has no sweeper" and never a fabricated stamp. The row is
// doctored to the exact state migration 00018's backfill leaves such history
// in: every sweep column NULL.
func TestObservatorySeriesUnrecordedSweepIsDisclosedNeverInvented(t *testing.T) {
	f := newP5Fixture(t)
	seedObservatoryBuckets(t, f)

	_, err := f.admin.Exec(f.ctx, `UPDATE observatory_points SET
		sweep_applicable = NULL, sweep_rows = NULL, sweep_failed = NULL,
		sweep_success_sum = NULL, sweep_max_updated_at = NULL,
		sweep_generation = NULL, sweep_generation_open = NULL
		WHERE engine = 'debt_manager'`)
	require.NoError(t, err)

	out := f.getJSON(t, "/v1/observatory/series?engine=debt_manager", "/v1/observatory/series")
	points := asList(t, out["points"])
	require.Len(t, points, 3)
	for _, p := range points {
		pm := asMap(t, p)
		require.Equal(t, false, pm["sweep_recorded"],
			"an unrecoverable pre-00018 record is DISCLOSED as unrecorded")
		require.Nil(t, pm["sweep"], "and no stamp is invented for it")
	}
}

func TestObservatorySeriesStrideServesEveryNthBucketVerbatim(t *testing.T) {
	f := newP5Fixture(t)
	seedObservatoryBuckets(t, f)

	out := f.getJSON(t, "/v1/observatory/series?engine=debt_manager&step=7200", "/v1/observatory/series")
	require.Equal(t, float64(7200), out["step_seconds"])
	points := asList(t, out["points"])
	require.Len(t, points, 2, "a 2h stride over 3 hourly buckets serves the 1st and 3rd — VERBATIM, never an average")
	require.Equal(t, fxDMBorrowings, asMap(t, points[0])["debt_usd"], "an exact captured bucket")
	require.Equal(t, fxDMBorrowings, asMap(t, points[1])["debt_usd"])

	t0, err := time.Parse(time.RFC3339, asMap(t, points[0])["bucket_start"].(string))
	require.NoError(t, err)
	t1, err := time.Parse(time.RFC3339, asMap(t, points[1])["bucket_start"].(string))
	require.NoError(t, err)
	require.Equal(t, 2*time.Hour, t1.Sub(t0))
}

func TestObservatorySeriesTimeBoundsAndRefusals(t *testing.T) {
	f := newP5Fixture(t)
	seedObservatoryBuckets(t, f)

	// An inclusive from-bound drops the oldest bucket.
	all := f.getJSON(t, "/v1/observatory/series?engine=debt_manager", "/v1/observatory/series")
	oldest := asMap(t, asList(t, all["points"])[1])["bucket_start"].(string)
	out := f.getJSON(t, "/v1/observatory/series?engine=debt_manager&from="+oldest, "/v1/observatory/series")
	require.Len(t, asList(t, out["points"]), 2)
	require.Equal(t, oldest, out["from"].(string))

	for name, path := range map[string]string{
		"missing engine":  "/v1/observatory/series",
		"unknown engine":  "/v1/observatory/series?engine=compound",
		"bad from":        "/v1/observatory/series?engine=debt_manager&from=yesterday",
		"sub-native step": "/v1/observatory/series?engine=debt_manager&step=60",
	} {
		bad := f.getStatusJSON(t, path, "/v1/observatory/series", http.StatusBadRequest)
		require.Equal(t, "bad_request", asMap(t, bad["error"])["code"], name)
	}
}

// TestObservatorySeriesPre00016DatabaseIsATypedRefusal: a database without the
// rollup table answers a NAMED unavailable error — never an empty series
// pretending the record exists and is blank.
func TestObservatorySeriesPre00016DatabaseIsATypedRefusal(t *testing.T) {
	f := newP5Fixture(t)
	_, err := f.admin.Exec(f.ctx, `ALTER TABLE observatory_points RENAME TO observatory_points_hidden`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = f.admin.Exec(f.ctx, `ALTER TABLE observatory_points_hidden RENAME TO observatory_points`)
	})

	out := f.getStatusJSON(t, "/v1/observatory/series?engine=debt_manager", "/v1/observatory/series", http.StatusInternalServerError)
	errObj := asMap(t, out["error"])
	require.Equal(t, "unavailable", errObj["code"])
	require.Contains(t, errObj["message"], "migration 00016", "the refusal NAMES the missing substrate")
	require.Contains(t, errObj["message"], "not a claim that the record is empty")
}
