package main

// GET /v1/events, /v1/params, /v1/prices/{asset} — the durable-ledger reads,
// against the live scratch database with the REAL captured liquidation rows.

import (
	"net/http"
	"net/url"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

// eventKeys renders the served rows compactly for exact-order assertions.
func eventKeys(t *testing.T, out map[string]any) []string {
	t.Helper()
	var keys []string
	for _, e := range asList(t, out["events"]) {
		m := asMap(t, e)
		keys = append(keys, m["engine"].(string)+"/"+m["type"].(string)+"@"+
			strconv.FormatFloat(m["block_number"].(float64), 'f', -1, 64))
	}
	return keys
}

// TestEventsCrossEngineOrderingAndBlockTimes: timed rows order by CUSTODIED
// header time DESC — NOT by block height, which is incomparable across chains
// (the OP liquidation's height dwarfs every mainnet block while its time is
// the oldest) — and the untimed tail follows, disclosed by null block_time,
// never given an invented one.
func TestEventsCrossEngineOrderingAndBlockTimes(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/events", "/v1/events")
	require.Equal(t, []string{
		// Timed, newest header time first: flag(-2h) > aave liq(-3h) > dm liq(-4h).
		"aave_v3_etherfi/collateral_enabled@24466440",
		"aave_v3_etherfi/liquidation@24466431",
		"debt_manager/liquidation@153399414",
		// The untimed tail: deterministic tiebreak (chain DESC, block DESC),
		// presented as "time unknown", never as chronology.
		"debt_manager/repay@153399420",
		"debt_manager/borrow@153399400",
		"aave_v3_etherfi/borrow@24466400",
	}, eventKeys(t, out))

	events := asList(t, out["events"])
	require.NotNil(t, asMap(t, events[0])["block_time"], "custodied header time serves")
	for _, i := range []int{3, 4, 5} {
		require.Nil(t, asMap(t, events[i])["block_time"],
			"a block without custodied header time serves NULL — never a database clock, never fabricated")
	}

	// Bookkeeping and config rows are structurally absent.
	for _, e := range events {
		raw := asMap(t, e)["raw_type"].(string)
		require.NotContains(t, []string{"residue_zeroed", "aave_reserve_data_updated", "borrow_apy_set", "liquidation_collateral"}, raw)
	}

	// The filter echo states the defaulted scope.
	filter := asMap(t, out["filter"])
	require.Nil(t, filter["engine"])
	require.Nil(t, filter["account"])
	require.Empty(t, asList(t, filter["types"]))
	require.Nil(t, filter["since_block"])
}

// TestEventsLiquidationDetails: the typed extracts parse the REAL captured
// payloads — the Debt Manager's seizure fan-out folds into `seized` (the
// contract's zero-amount tuple elements are enumeration artifacts, not
// seizures), and the Aave detail carries the ledger's configured bonus at the
// EVENT's effective params.
func TestEventsLiquidationDetails(t *testing.T) {
	f := newP5Fixture(t)
	out := f.getJSON(t, "/v1/events?types=liquidation", "/v1/events")
	events := asList(t, out["events"])
	require.Len(t, events, 2)

	aave := asMap(t, events[0]) // newest header time first
	require.Equal(t, "aave_v3_etherfi", aave["engine"])
	require.Equal(t, "aave_liquidation_call", aave["raw_type"])
	require.Equal(t, "0", aave["amount"],
		"a deficit-paired liquidation's ZERO delta serves as \"0\" — zero and null are different statements")
	aaveDetail := asMap(t, aave["liquidation"])
	require.Equal(t, "0x36331E299247E5D0D3261e1d9852f6E0cFFEe95C", aaveDetail["liquidator"])
	require.Equal(t, fxUSDCEth.Hex(), aaveDetail["debt_asset"])
	require.Equal(t, "2429404", aaveDetail["debt_repaid"])
	require.Equal(t, float64(6), aaveDetail["debt_decimals"])
	seized := asList(t, aaveDetail["seized"])
	require.Len(t, seized, 1)
	require.Equal(t, fxWeETHEth.Hex(), asMap(t, seized[0])["asset"])
	require.Equal(t, "1201164823925659", asMap(t, seized[0])["amount"])
	require.Equal(t, float64(18), asMap(t, seized[0])["decimals"])
	require.Equal(t, "750", aaveDetail["configured_bonus_bps"],
		"the ledger's 10750 encoding at the event's block decodes to a 750bps premium")
	require.Nil(t, aaveDetail["realized_bonus_bps"], "never estimated from prices this service does not read")

	dm := asMap(t, events[1])
	require.Equal(t, "debt_manager", dm["engine"])
	require.Equal(t, p5DMLiqAccount, dm["account"])
	require.Equal(t, "-172026", dm["amount"], "the custodied normalized-debt delta, verbatim")
	require.Nil(t, dm["amount_decimals"], "no display scale is asserted for an accounting-unit delta")
	dmDetail := asMap(t, dm["liquidation"])
	require.Equal(t, "0x7d829d50aaf400b8b29b3b311f4ad70ad819dc6e", dmDetail["liquidator"])
	require.Equal(t, "179038", dmDetail["debt_repaid"])
	require.Equal(t, float64(6), dmDetail["debt_decimals"])
	dmSeized := asList(t, dmDetail["seized"])
	require.Len(t, dmSeized, 1, "12 zero-amount tuple elements are enumeration artifacts, not seizures")
	require.Equal(t, p5DMSeized, asMap(t, dmSeized[0])["asset"])
	require.Equal(t, "109428055803643", asMap(t, dmSeized[0])["amount"])
	require.Nil(t, dmDetail["configured_bonus_bps"], "the DM bonus denominator is 100e18, not bps — null, never a silent unit conversion")
	require.Nil(t, dmDetail["realized_bonus_bps"])
}

func TestEventsFilters(t *testing.T) {
	f := newP5Fixture(t)

	// Account scoping.
	out := f.getJSON(t, "/v1/events?account="+p5DMLiqAccount, "/v1/events")
	require.Equal(t, []string{"debt_manager/liquidation@153399414"}, eventKeys(t, out))

	// One collateral toggle direction: the store class covers both; the
	// narrowing happens honestly at this layer.
	out = f.getJSON(t, "/v1/events?types=collateral_enabled", "/v1/events")
	require.Equal(t, []string{"aave_v3_etherfi/collateral_enabled@24466440"}, eventKeys(t, out))
	require.Equal(t, []any{"collateral_enabled"}, asList(t, asMap(t, out["filter"])["types"]))

	// Display-type filter over both engines.
	out = f.getJSON(t, "/v1/events?types=borrow", "/v1/events")
	require.Equal(t, []string{
		"debt_manager/borrow@153399400",
		"aave_v3_etherfi/borrow@24466400",
	}, eventKeys(t, out), "both untimed borrows, tiebreak order")

	// Engine-scoped ordering is by height (comparable within one chain).
	out = f.getJSON(t, "/v1/events?engine=debt_manager", "/v1/events")
	require.Equal(t, []string{
		"debt_manager/repay@153399420",
		"debt_manager/liquidation@153399414",
		"debt_manager/borrow@153399400",
	}, eventKeys(t, out))

	// since_block, engine-scoped.
	out = f.getJSON(t, "/v1/events?engine=debt_manager&since_block=153399414", "/v1/events")
	require.Equal(t, []string{
		"debt_manager/repay@153399420",
		"debt_manager/liquidation@153399414",
	}, eventKeys(t, out))
}

func TestEventsKeysetPagination(t *testing.T) {
	f := newP5Fixture(t)

	page1 := f.getJSON(t, "/v1/events?engine=debt_manager&limit=2", "/v1/events")
	require.Equal(t, []string{
		"debt_manager/repay@153399420",
		"debt_manager/liquidation@153399414",
	}, eventKeys(t, page1))
	cursor, ok := page1["next_cursor"].(string)
	require.True(t, ok)

	page2 := f.getJSON(t, "/v1/events?engine=debt_manager&limit=2&cursor="+url.QueryEscape(cursor), "/v1/events")
	require.Equal(t, []string{"debt_manager/borrow@153399400"}, eventKeys(t, page2))
	require.Nil(t, page2["next_cursor"], "the feed is exhausted under the filter")
}

func TestEventsParameterRefusals(t *testing.T) {
	f := newP5Fixture(t)
	for name, path := range map[string]string{
		"since_block cross-engine": "/v1/events?since_block=100",
		"unknown display type":     "/v1/events?types=mint",
		"unknown engine":           "/v1/events?engine=compound",
		"bad account":              "/v1/events?account=0x123",
		"limit too large":          "/v1/events?limit=999",
		"malformed cursor":         "/v1/events?cursor=%21bad",
	} {
		out := f.getStatusJSON(t, path, "/v1/events", http.StatusBadRequest)
		require.Equal(t, "bad_request", asMap(t, out["error"])["code"], name)
	}
	// The cross-engine since_block refusal names the LAW, not just the shape.
	out := f.getStatusJSON(t, "/v1/events?since_block=100", "/v1/events", http.StatusBadRequest)
	require.Contains(t, asMap(t, out["error"])["message"], "incomparable")
}

// ---------------------------------------------------------------------------
// /v1/params
// ---------------------------------------------------------------------------

func TestParamsTimeline(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/params", "/v1/params")
	require.Nil(t, out["engine"])
	require.Nil(t, out["asset"])
	require.Nil(t, out["next_cursor"])
	params := asList(t, out["params"])
	require.Len(t, params, 4)

	// Ordered (block, …) DESC: DM config-set (154.79M) > DM borrow_apy_set
	// (153.40M) > Aave weETH row (25.63M) > the early Aave row (24.0M).
	dmCfg := asMap(t, params[0])
	require.Equal(t, "debt_manager", dmCfg["engine"])
	require.Equal(t, "collateral_token_config_set", dmCfg["source_event"])
	require.Nil(t, dmCfg["block_time"], "no custodied header for this block: null, never fabricated")
	fields := map[string]map[string]any{}
	for _, fl := range asList(t, dmCfg["fields"]) {
		m := asMap(t, fl)
		fields[m["name"].(string)] = m
	}
	require.Equal(t, fxDMLiqThreshold, fields["liq_threshold"]["value"])
	require.Equal(t, "percent-100e18", fields["liq_threshold"]["unit"], "the DM denominator is named VERBATIM — never normalized to bps")
	require.Equal(t, "75000000000000000000", fields["liq_threshold"]["prior"], "the prior THE EVENT ITSELF carried")
	require.Equal(t, fxDMLiqBonus, fields["liq_bonus"]["value"])
	require.Equal(t, "2000000000000000000", fields["liq_bonus"]["prior"])

	dmApy := asMap(t, params[1])
	require.Equal(t, "borrow_apy_set", dmApy["source_event"])
	apyFields := asList(t, dmApy["fields"])
	require.Len(t, apyFields, 1)
	apy := asMap(t, apyFields[0])
	require.Equal(t, "borrow_apy", apy["name"])
	require.Equal(t, "2", apy["value"])
	require.Equal(t, "1", apy["prior"])
	require.Equal(t, "per-second-100e18", apy["unit"])

	aaveNew := asMap(t, params[2])
	require.Equal(t, "aave_v3_etherfi", aaveNew["engine"], "the aave_param WRITER identity maps to the public engine name")
	require.Equal(t, fxWeETHEth.Hex(), aaveNew["asset"])
	require.Equal(t, "weETH", aaveNew["symbol"])
	aaveFields := map[string]map[string]any{}
	for _, fl := range asList(t, aaveNew["fields"]) {
		m := asMap(t, fl)
		aaveFields[m["name"].(string)] = m
	}
	require.Equal(t, fxAaveLTBps, aaveFields["liq_threshold"]["value"])
	require.Equal(t, "bps", aaveFields["liq_threshold"]["unit"])
	require.Nil(t, aaveFields["liq_threshold"]["prior"], "the configurator event carries no prior — null, never a ledger lookback")
	require.Nil(t, aaveNew["block_time"])

	aaveOld := asMap(t, params[3])
	require.Equal(t, float64(p5EarlyParamBlock), aaveOld["effective_block"])
	require.NotNil(t, aaveOld["block_time"], "this block's header IS custodied, so the chain-asserted time serves")
}

func TestParamsFilters(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/params?engine=aave_v3_etherfi", "/v1/params")
	require.Len(t, asList(t, out["params"]), 2)
	require.Equal(t, "aave_v3_etherfi", out["engine"])

	out = f.getJSON(t, "/v1/params?asset="+fxWeETHOp.Hex(), "/v1/params")
	params := asList(t, out["params"])
	require.Len(t, params, 1)
	require.Equal(t, "collateral_token_config_set", asMap(t, params[0])["source_event"])

	bad := f.getStatusJSON(t, "/v1/params?engine=nope", "/v1/params", http.StatusBadRequest)
	require.Equal(t, "bad_request", asMap(t, bad["error"])["code"])
	bad = f.getStatusJSON(t, "/v1/params?cursor=%21bad", "/v1/params", http.StatusBadRequest)
	require.Equal(t, "bad_request", asMap(t, bad["error"])["code"])
}

// ---------------------------------------------------------------------------
// /v1/prices/{asset}
// ---------------------------------------------------------------------------

func TestPricesServesTheRetainedLedgerWithQuarantine(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/prices/"+fxWeETHEth.Hex(), "/v1/prices/{asset}")
	series := asList(t, out["series"])
	require.Len(t, series, 1, "one series per (chain, source) key")
	s0 := asMap(t, series[0])
	require.Equal(t, float64(fxETHChain), s0["chain_id"])
	require.Equal(t, fxAaveSource, s0["source"])
	require.Equal(t, "adapter-output", s0["provenance"])
	require.Equal(t, float64(8), s0["decimals"])

	points := asList(t, s0["points"])
	require.Len(t, points, 3, "the QUARANTINED row is retained and served, never deleted")
	p0, p1, p2 := asMap(t, points[0]), asMap(t, points[1]), asMap(t, points[2])
	require.Equal(t, false, p0["valid"])
	require.Equal(t, "1", p0["value"], "the quarantined VALUE is served with its verdict — evidence, not garbage")
	require.NotEmpty(t, p0["invalid_reason"])
	require.Equal(t, true, p1["valid"])
	require.Equal(t, fxAaveWeETHPrice, p1["value"])
	require.NotNil(t, p1["anchor_block"], "the poll anchor binding this observation serves with it")
	require.Equal(t, true, p2["valid"])
	require.Equal(t, fxLivePriceAfterBatch, p2["value"])

	quarantined := asList(t, s0["quarantined_ranges"])
	require.Len(t, quarantined, 1)
	q0 := asMap(t, quarantined[0])
	require.Equal(t, float64(1), q0["rows"])
	reasons := asList(t, q0["reasons"])
	require.Len(t, reasons, 1)
	require.Equal(t, float64(1), asMap(t, reasons[0])["count"])
}

// TestPricesDownsamplingSelectsExactRowsAcrossValidityBoundaries: a stride
// wide enough to skip everything after the first row must STILL serve the
// first row of the next validity segment — a valid-invalid-valid sequence
// downsamples to exact rows from each segment, never to a blend.
func TestPricesDownsamplingSelectsExactRowsAcrossValidityBoundaries(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/prices/"+fxWeETHEth.Hex()+"?step=100000", "/v1/prices/{asset}")
	s0 := asMap(t, asList(t, out["series"])[0])
	points := asList(t, s0["points"])
	require.Len(t, points, 2)
	require.Equal(t, false, asMap(t, points[0])["valid"], "the invalid segment's exact first row")
	require.Equal(t, true, asMap(t, points[1])["valid"], "the valid segment's exact first row — served DESPITE the stride, because the stride restarts at the validity boundary")
	require.Equal(t, fxAaveWeETHPrice, asMap(t, points[1])["value"], "an EXACT custodied row, never an average")

	// The quarantine summary survives whatever the stride skipped.
	require.Len(t, asList(t, s0["quarantined_ranges"]), 1)
}

func TestPricesScopingAndRefusals(t *testing.T) {
	f := newP5Fixture(t)

	// Block-range scoping.
	out := f.getJSON(t, "/v1/prices/"+fxWeETHEth.Hex()+"?from_block="+strconv.FormatInt(fxAavePriceBlock, 10), "/v1/prices/{asset}")
	points := asList(t, asMap(t, asList(t, out["series"])[0])["points"])
	require.Len(t, points, 2, "the quarantined row below from_block is out of range")

	// An asset with no custodied observations: an EMPTY series — an answer
	// about custody, not a claim the asset has no price.
	out = f.getJSON(t, "/v1/prices/"+fxAcctUnknown.Hex(), "/v1/prices/{asset}")
	require.Empty(t, asList(t, out["series"]))

	// The OP asset resolves on its own chain.
	out = f.getJSON(t, "/v1/prices/"+fxWeETHOp.Hex(), "/v1/prices/{asset}")
	series := asList(t, out["series"])
	require.Len(t, series, 1)
	require.Equal(t, float64(fxOPChain), asMap(t, series[0])["chain_id"])
	require.Equal(t, fxDMSource, asMap(t, series[0])["source"])

	// Malformed inputs.
	for name, path := range map[string]string{
		"bad address": "/v1/prices/0xnothex",
		"bad step":    "/v1/prices/" + fxWeETHEth.Hex() + "?step=0",
		"bad from":    "/v1/prices/" + fxWeETHEth.Hex() + "?from_block=-1",
	} {
		bad := f.getStatusJSON(t, path, "/v1/prices/{asset}", http.StatusBadRequest)
		require.Equal(t, "bad_request", asMap(t, bad["error"])["code"], name)
	}
}
