package main

// GET /v1/positions — the batch-stable page's laws, against the live scratch
// database: contract shape, exact fixture values, the 409 supersession
// restart, the withheld-engine refusal, and the parameter refusals.

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

func TestPositionsPageServesTheEngineBook(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi", "/v1/positions")
	require.Equal(t, "aave_v3_etherfi", out["engine"])
	require.Equal(t, "liq_distance", out["sort"], "a defaulted request still states its order")
	require.Equal(t, float64(defaultPositionsLimit), out["limit"], "a defaulted request still states its page size")
	require.Equal(t, false, out["refused"])
	require.Nil(t, out["refusal"])
	require.Equal(t, float64(2), out["total_positions"], "refused rows are COUNTED in the total")
	require.Nil(t, out["next_cursor"], "two rows fit one page")

	positions := asList(t, out["positions"])
	require.Len(t, positions, 2)
	// liq_distance: the computed row ranks first, the refused row LAST but
	// PRESENT — a refusal is a row, never a dropped position.
	first, second := asMap(t, positions[0]), asMap(t, positions[1])
	require.Equal(t, fxAcctAave.Hex(), first["account"])
	require.Equal(t, "computed", first["status"])
	hf := asMap(t, first["health_factor"])
	require.Equal(t, fxAaveHFWad, hf["wad"], "the page serves the batch's own persisted wad")
	// Rows are the LEAN PositionSummary (1.2.0): no leg/price fan-out on the
	// page — the FULL Position stays on /v1/address.
	require.NotContains(t, first, "legs", "the summary carries no legs")
	require.NotContains(t, first, "price_inputs", "the summary carries no price inputs")
	// The summary's totals are the ENGINE's own quantities: Aave's base pair
	// at the row's own value_decimals.
	require.Equal(t, float64(8), first["value_decimals"])
	require.NotNil(t, first["total_collateral"])
	require.NotNil(t, first["total_debt"])
	// The as-of marks travel with the row.
	require.NotNil(t, first["balances_block"])
	require.NotNil(t, first["params_block"])
	// The boundary distance is the closed vocabulary; a computed healthy Aave
	// row with a factor-level solve serves the EXACT rational pair.
	liq := asMap(t, first["liq_distance"])
	require.Contains(t, []string{"distance", "breached", "never", "none"}, liq["kind"])

	require.Equal(t, fxAcctAaveRef.Hex(), second["account"])
	require.Equal(t, "refused", second["status"])
	refusal := asMap(t, second["refusal"])
	require.Equal(t, "G1", refusal["code"])
	// A refused row's distance is `none` NAMING the refusal — never a number.
	refLiq := asMap(t, second["liq_distance"])
	require.Equal(t, "none", refLiq["kind"])
	require.Equal(t, "G1", refLiq["reason"], "a refused row's absent distance names its refusal code")

	// The batch pin is on the wire.
	batch := asMap(t, out["batch"])
	require.Equal(t, float64(f.batchID), batch["id"])
}

func TestPositionsPageDebtManagerSortAndPagination(t *testing.T) {
	f := newP5Fixture(t)

	page1 := f.getJSON(t, "/v1/positions?engine=debt_manager&limit=1", "/v1/positions")
	require.Equal(t, float64(2), page1["total_positions"])
	rows := asList(t, page1["positions"])
	require.Len(t, rows, 1)
	require.Equal(t, fxAcctDM.Hex(), asMap(t, rows[0])["account"],
		"liq_distance: the liquidatable account (negative headroom) leads")
	require.Equal(t, true, asMap(t, rows[0])["liquidatable"])
	cursor, ok := page1["next_cursor"].(string)
	require.True(t, ok, "a full page with rows remaining mints a cursor")

	page2 := f.getJSON(t, "/v1/positions?engine=debt_manager&limit=1&cursor="+url.QueryEscape(cursor), "/v1/positions")
	rows2 := asList(t, page2["positions"])
	require.Len(t, rows2, 1)
	require.Equal(t, fxAcctDMRef.Hex(), asMap(t, rows2[0])["account"],
		"the refused row is a ROW on the last page")
	require.Nil(t, page2["next_cursor"])
}

func TestPositionsPageParameterRefusals(t *testing.T) {
	f := newP5Fixture(t)

	for name, path := range map[string]string{
		"missing engine":     "/v1/positions",
		"unknown engine":     "/v1/positions?engine=compound",
		"unknown sort":       "/v1/positions?engine=aave_v3_etherfi&sort=apy",
		"hf on debt_manager": "/v1/positions?engine=debt_manager&sort=hf",
		"limit too large":    "/v1/positions?engine=aave_v3_etherfi&limit=201",
		"malformed cursor":   "/v1/positions?engine=aave_v3_etherfi&cursor=%21%21not-a-cursor",
	} {
		out := f.getStatusJSON(t, path, "/v1/positions", http.StatusBadRequest)
		require.Equal(t, "bad_request", asMap(t, out["error"])["code"], name)
	}

	// The DM hf refusal names the reason rather than silently substituting a
	// sort — the store's ErrPositionsSortUnsupported surfaced.
	out := f.getStatusJSON(t, "/v1/positions?engine=debt_manager&sort=hf", "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, out["error"])["message"], "not defined for engine")
}

// TestPositionsPageAnswers409WhenTheCursorBatchIsSuperseded is the honest
// restart: a cursor bound to a batch that is no longer the newest servable
// batch NEVER yields a page — a page silently mixing two materializations is
// exactly what the 409 exists to prevent.
func TestPositionsPageAnswers409WhenTheCursorBatchIsSuperseded(t *testing.T) {
	f := newP5Fixture(t)

	page1 := f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi&limit=1", "/v1/positions")
	cursor, ok := page1["next_cursor"].(string)
	require.True(t, ok)

	// A newer batch lands mid-pagination.
	newID := f.seedBatch(t, "fixture-materialization-2")
	require.Greater(t, newID, f.batchID)

	status, body := f.get(t, "/v1/positions?engine=aave_v3_etherfi&limit=1&cursor="+url.QueryEscape(cursor))
	require.Equal(t, http.StatusConflict, status, "body: %s", truncate(body))
	validateContractMethod(t, "/v1/positions", http.MethodGet, http.StatusConflict, body)

	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	errObj := asMap(t, out["error"])
	require.Equal(t, "batch_superseded", errObj["code"])
	require.Equal(t, float64(f.batchID), errObj["cursor_batch_id"], "the 409 NAMES the cursor's batch")
	require.Equal(t, float64(newID), errObj["current_batch_id"], "…and the batch a restart would read")

	// The restart succeeds against the fresh batch.
	fresh := f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi&limit=1", "/v1/positions")
	require.Equal(t, float64(newID), asMap(t, fresh["batch"])["id"])
}

// TestPositionsPageWithheldEngineIsRefusedNeverEmpty: a withheld engine's page
// is `refused: true` with a NAMED refusal and a NULL total — never an empty
// healthy book — while the other engine serves normally, and the PROVEN empty
// control still serves as a genuine empty book.
func TestPositionsPageWithheldEngineIsRefusedNeverEmpty(t *testing.T) {
	f := newP5Fixture(t)
	f.seedWithheldBatch(t, "withheld-materialization-1", false)

	out := f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi", "/v1/positions")
	require.Equal(t, true, out["refused"])
	refusal := asMap(t, out["refusal"])
	require.Equal(t, "FLAG_CUSTODY_UNPROVEN", refusal["code"])
	require.Nil(t, out["total_positions"], "a withheld engine's total is NULL, never 0")
	require.Empty(t, asList(t, out["positions"]))
	require.Nil(t, out["next_cursor"], "no cursor is minted over a book nobody may read")

	dm := f.getJSON(t, "/v1/positions?engine=debt_manager", "/v1/positions")
	require.Equal(t, false, dm["refused"], "the other engine serves normally")
	require.Equal(t, float64(1), dm["total_positions"])
	require.Len(t, asList(t, dm["positions"]), 1)

	// THE DISCRIMINATING CONTROL: an identically-empty PROVEN engine is an
	// honest empty book, not a refusal.
	f.seedWithheldBatch(t, "proven-empty-materialization-1", true)
	proven := f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi", "/v1/positions")
	require.Equal(t, false, proven["refused"])
	require.Equal(t, float64(0), proven["total_positions"], "a genuinely empty proven book totals 0, not null")
	require.Empty(t, asList(t, proven["positions"]))
}

// TestPositionsPageRowsMatchTheAddressSurface: the SAME account served by the
// page and by /v1/address must carry the SAME persisted numbers — two
// surfaces, one materialization. The page's lean summary maps the engine's
// OWN quantities onto its one totals pair (DM: collateral_value_usd →
// total_collateral, borrowings → total_debt), so the weld compares across
// that documented mapping.
func TestPositionsPageRowsMatchTheAddressSurface(t *testing.T) {
	f := newP5Fixture(t)

	page := f.getJSON(t, "/v1/positions?engine=debt_manager&limit=1", "/v1/positions")
	pageRow := asMap(t, asList(t, page["positions"])[0])

	addr := f.getJSON(t, "/v1/address/"+fxAcctDM.Hex(), "/v1/address/{addr}")
	var addrRow map[string]any
	for _, p := range asList(t, addr["positions"]) {
		if asMap(t, p)["engine"] == risk.DMEngine {
			addrRow = asMap(t, p)
		}
	}
	require.NotNil(t, addrRow)
	for _, field := range []string{"account", "status", "liquidatable", "value_decimals"} {
		require.Equal(t, addrRow[field], pageRow[field], "field %s must be identical across the two surfaces", field)
	}
	require.Equal(t, addrRow["collateral_value_usd"], pageRow["total_collateral"],
		"the DM summary's total_collateral IS the address surface's collateral_value_usd")
	require.Equal(t, addrRow["borrowings"], pageRow["total_debt"],
		"the DM summary's total_debt IS the address surface's borrowings")
	addrAsOf := asMap(t, addrRow["as_of"])
	require.Equal(t, addrAsOf["balances_block"], pageRow["balances_block"])
	require.Equal(t, addrAsOf["params_block"], pageRow["params_block"])
	require.Equal(t, addrAsOf["sweep_block"], pageRow["sweep_block"])
}

// TestPositionsPageLiqDistanceBreachedNeverServesANumber: a row the engine's
// OWN comparator already judges liquidatable serves `breached` — never a
// "distance" wearing an exact rational that would read as headroom.
func TestPositionsPageLiqDistanceBreachedNeverServesANumber(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/positions?engine=debt_manager", "/v1/positions")
	rows := asList(t, out["positions"])
	require.NotEmpty(t, rows)
	// liq_distance sort: the liquidatable account (negative headroom) leads.
	first := asMap(t, rows[0])
	require.Equal(t, fxAcctDM.Hex(), first["account"])
	require.Equal(t, true, first["liquidatable"])
	liq := asMap(t, first["liq_distance"])
	require.Equal(t, "breached", liq["kind"],
		"the engine's own strict boolean says liquidatable — the distance MUST fold to breached")
	require.Nil(t, liq["scale_factor_num"], "a breached row serves no scale factor")
	require.Nil(t, liq["scale_factor_den"])
}
