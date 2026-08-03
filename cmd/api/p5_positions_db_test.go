package main

// GET /v1/positions — the batch-stable page's laws, against the live scratch
// database: contract shape, exact fixture values, the 409 supersession
// restart, the withheld-engine refusal, and the parameter refusals.

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
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
		"missing engine":           "/v1/positions",
		"unknown engine":           "/v1/positions?engine=compound",
		"unknown sort":             "/v1/positions?engine=aave_v3_etherfi&sort=apy",
		"hf on debt_manager":       "/v1/positions?engine=debt_manager&sort=hf",
		"limit too large":          "/v1/positions?engine=aave_v3_etherfi&limit=1001",
		"malformed cursor":         "/v1/positions?engine=aave_v3_etherfi&cursor=%21%21not-a-cursor",
		"unknown dir":              "/v1/positions?engine=aave_v3_etherfi&dir=sideways",
		"min_value not an integer": "/v1/positions?engine=aave_v3_etherfi&min_value=1.5",
		"min_value negative":       "/v1/positions?engine=aave_v3_etherfi&min_value=-3",
	} {
		out := f.getStatusJSON(t, path, "/v1/positions", http.StatusBadRequest)
		require.Equal(t, "bad_request", asMap(t, out["error"])["code"], name)
	}

	// The DM hf refusal names the reason rather than silently substituting a
	// sort — the store's ErrPositionsSortUnsupported surfaced. UNCHANGED by
	// 1.3.0: dir and min_value never invent a DM health-factor ordering.
	out := f.getStatusJSON(t, "/v1/positions?engine=debt_manager&sort=hf", "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, out["error"])["message"], "not defined for engine")

	// The min_value refusal NAMES the parameter and its grammar.
	bad := f.getStatusJSON(t, "/v1/positions?engine=aave_v3_etherfi&min_value=1e9", "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, bad["error"])["message"], "min_value")

	// And the dir refusal names its closed vocabulary.
	badDir := f.getStatusJSON(t, "/v1/positions?engine=aave_v3_etherfi&dir=ascending", "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, badDir["error"])["message"], "asc | desc")
}

// Contract 1.3.0: the relaxed page bound. 1000 is a page, 1001 is the house
// refusal, and the OLD ceiling's first illegal value (201) is now legal —
// the bound moved in the contract, not just in prose.
func TestPositionsPageLimitBoundIs1000(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi&limit=1000", "/v1/positions")
	require.Equal(t, float64(1000), out["limit"], "the applied page size is echoed")
	out = f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi&limit=201", "/v1/positions")
	require.Equal(t, float64(201), out["limit"], "the old ceiling's first illegal value is legal under the relaxed bound")

	bad := f.getStatusJSON(t, "/v1/positions?engine=aave_v3_etherfi&limit=1001", "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, bad["error"])["message"], "1..1000")
}

// Contract 1.3.0 min_value at the API: the exclusion law's serving half. The
// fixture's Aave book is one computed row (totals 8e11/6e11 at 8 decimals)
// and one REFUSED row with NULL totals; the DM book mirrors it in USD-6.
func TestPositionsPageMinValueNeverExcludesRefusedRows(t *testing.T) {
	f := newP5Fixture(t)

	// At the boundary: max(coll, debt) == min_value → strict < keeps the row.
	out := f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi&min_value="+fxAaveCollateralBase, "/v1/positions")
	require.Equal(t, float64(2), out["total_positions"], "a row exactly AT min_value stays — the exclusion is strict <")
	require.Len(t, asList(t, out["positions"]), 2)

	// One unit above the computed row's max: the computed row is excluded,
	// the REFUSED row (NULL totals) REMAINS, and total_positions becomes the
	// QUALIFYING count — the denominator of THIS walk, not the book's total.
	out = f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi&min_value=800000000001", "/v1/positions")
	require.Equal(t, float64(1), out["total_positions"], "min_value present: total_positions counts QUALIFYING rows only")
	rows := asList(t, out["positions"])
	require.Len(t, rows, 1)
	only := asMap(t, rows[0])
	require.Equal(t, fxAcctAaveRef.Hex(), only["account"],
		"the REFUSED row is never excluded by a size floor — an unknowable is not a small number")
	require.Equal(t, "refused", only["status"])
	// The interaction is disclosed on the wire.
	foundNote := false
	for _, n := range asList(t, out["notes"]) {
		if s, ok := n.(string); ok && strings.Contains(s, "QUALIFYING") {
			foundNote = true
		}
	}
	require.True(t, foundNote, "a min_value page names its qualifying-count semantics in notes")

	// The DM filter runs in the DM's OWN unit (USD-6) over ITS totals pair
	// (collateral_value_usd / borrowings): one unit above the computed row's
	// max leaves only the refused row.
	dm := f.getJSON(t, "/v1/positions?engine=debt_manager&min_value=4200000001", "/v1/positions")
	require.Equal(t, float64(1), dm["total_positions"])
	require.Equal(t, fxAcctDMRef.Hex(), asMap(t, asList(t, dm["positions"])[0])["account"])

	// Absent min_value: the engine aggregate's own total, semantics unchanged.
	out = f.getJSON(t, "/v1/positions?engine=aave_v3_etherfi", "/v1/positions")
	require.Equal(t, float64(2), out["total_positions"])
}

// CONTRACT 1.5.0 AT THE API: `headroom` is accepted, validated and ECHOED on
// BOTH engines; `liq_distance` is still accepted (the deprecated alias); the
// two mint DIFFERENT cursors and cannot be walked into each other; and the DM
// `hf` refusal now names `headroom` among the keys that DO work there.
//
// The ORDERING difference between the two DM keys is proven at the store layer
// (TestPositionsPageHeadroomIsTheRatioNotTheDollars) on a fixture built to make
// them disagree; what this test owns is the serving contract around it.
func TestPositionsPageHeadroomSortIsServedOnBothEngines(t *testing.T) {
	f := newP5Fixture(t)

	for _, engine := range []string{risk.AaveEngine, risk.DMEngine} {
		out := f.getJSON(t, "/v1/positions?engine="+engine+"&sort=headroom", "/v1/positions")
		require.Equal(t, "headroom", out["sort"],
			"%s: the applied ranking is echoed, so a client never has to assume it", engine)
		require.Equal(t, engine, out["engine"])
		require.Len(t, asList(t, out["positions"]), 2, "%s: the whole fixture book, refused row included", engine)

		// The direction is applied without being sent: headroom's canonical
		// direction is asc, and the explicit spelling is the same ranking.
		explicit := f.getJSON(t, "/v1/positions?engine="+engine+"&sort=headroom&dir=asc", "/v1/positions")
		require.Equal(t, accountsOf(t, out), accountsOf(t, explicit),
			"%s: absent dir IS headroom's canonical direction (asc)", engine)

		// THE UNKNOWN-LAST LAW ON THE WIRE (Wave W-HR-C, Codex round-15 finding
		// 2). `dir=desc` asks for the GREATEST headroom on the book, and this
		// fixture's book is one computed row plus one REFUSED row per engine —
		// a refusal has no headroom, so it must stay LAST in BOTH directions.
		// The old fragment led the reversed page with it on both engines, which
		// is the service asserting that an account it could not value has the
		// most room left. The store owns the multi-row ranking proof
		// (TestPositionsPageHeadroomIsTheRatioNotTheDollars); what this asserts
		// is that the fix is what the HTTP surface actually serves.
		reversed := f.getJSON(t, "/v1/positions?engine="+engine+"&sort=headroom&dir=desc", "/v1/positions")
		require.Equal(t, "computed", statusesOf(t, reversed)[0],
			"%s: dir=desc must not lead with a row whose headroom is unknown", engine)
		require.Equal(t, "refused", lastOf(statusesOf(t, reversed)),
			"%s: a refused row has no headroom and ranks LAST under dir=desc too", engine)
		require.Equal(t, "refused", lastOf(statusesOf(t, out)),
			"%s: …and under the canonical direction, unchanged", engine)
		// With exactly ONE valued row per engine here, asc and desc coincide by
		// construction — only the ranked axis reverses, and a single row cannot
		// reverse. `dir` being genuinely wired is proven where it can be: the
		// store's three-known-ratio fixture, and the cursor binding below, which
		// refuses an asc rank replayed into the desc ranking.
		require.Equal(t, accountsOf(t, out), accountsOf(t, reversed),
			"%s: one ranked row and one unranked row order the same either way", engine)
	}

	// THE ALIAS LAW ON THE WIRE: `liq_distance` is DEPRECATED, not withdrawn.
	// A pre-1.5.0 client that names it is served, and served the ranking it
	// asked for — the cursor it holds still round-trips.
	alias := f.getJSON(t, "/v1/positions?engine=debt_manager&sort=liq_distance&limit=1", "/v1/positions")
	require.Equal(t, "liq_distance", alias["sort"], "the deprecated key is echoed under its own name")
	aliasCursor, ok := alias["next_cursor"].(string)
	require.True(t, ok)
	aliasPage2 := f.getJSON(t, "/v1/positions?engine=debt_manager&sort=liq_distance&limit=1&cursor="+url.QueryEscape(aliasCursor), "/v1/positions")
	require.Len(t, asList(t, aliasPage2["positions"]), 1, "an in-flight liq_distance cursor still walks")

	// The two keys are DIFFERENT RANKINGS and their cursors are not
	// interchangeable — a rank replayed into another ordering is garbage.
	head := f.getJSON(t, "/v1/positions?engine=debt_manager&sort=headroom&limit=1", "/v1/positions")
	headCursor, ok := head["next_cursor"].(string)
	require.True(t, ok)
	bad := f.getStatusJSON(t, "/v1/positions?engine=debt_manager&sort=headroom&limit=1&cursor="+url.QueryEscape(aliasCursor), "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, bad["error"])["message"], "cursor does not match this request")
	bad = f.getStatusJSON(t, "/v1/positions?engine=debt_manager&sort=liq_distance&limit=1&cursor="+url.QueryEscape(headCursor), "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, bad["error"])["message"], "cursor does not match this request")

	// The two refusal sentences name the 1.5.0 vocabulary rather than a stale
	// one — a hint that omits a working key sends the reader the wrong way.
	unknown := f.getStatusJSON(t, "/v1/positions?engine=aave_v3_etherfi&sort=apy", "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, unknown["error"])["message"], "headroom | liq_distance | debt | hf | status")
	dmHF := f.getStatusJSON(t, "/v1/positions?engine=debt_manager&sort=hf", "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, dmHF["error"])["message"], "Use headroom, liq_distance, debt or status.")
}

// accountsOf is the page's account order — the only thing a ranking assertion
// actually needs.
func accountsOf(t *testing.T, out map[string]any) []string {
	t.Helper()
	var accounts []string
	for _, row := range asList(t, out["positions"]) {
		account, ok := asMap(t, row)["account"].(string)
		require.True(t, ok)
		accounts = append(accounts, account)
	}
	return accounts
}

// statusesOf is the page's status order — what a ranking assertion needs when
// the thing being ranked is WHERE THE UNKNOWNS GO rather than which account
// leads (Wave W-HR-C).
func statusesOf(t *testing.T, out map[string]any) []string {
	t.Helper()
	var statuses []string
	for _, row := range asList(t, out["positions"]) {
		status, ok := asMap(t, row)["status"].(string)
		require.True(t, ok)
		statuses = append(statuses, status)
	}
	require.NotEmpty(t, statuses, "an empty page cannot witness an ordering law")
	return statuses
}

func lastOf(values []string) string { return values[len(values)-1] }

// Contract 1.3.0 dir at the API: an explicit non-canonical direction reverses
// the walk (the account tie-break stays ascending — proven at the store
// layer), absent dir serves the canonical direction, and the cursor binds the
// FULL query (engine, sort, dir, min_value) — changing any of them mid-walk
// is the house 400, never a silently re-ranked page.
func TestPositionsPageDirReversesAndTheCursorBindsTheQuery(t *testing.T) {
	f := newP5Fixture(t)

	// debt's canonical direction IS desc: absent dir and explicit desc serve
	// the same first row — dir is absolute, never relative.
	canonical := f.getJSON(t, "/v1/positions?engine=debt_manager&sort=debt&limit=1", "/v1/positions")
	explicit := f.getJSON(t, "/v1/positions?engine=debt_manager&sort=debt&dir=desc&limit=1", "/v1/positions")
	require.Equal(t, fxAcctDM.Hex(), asMap(t, asList(t, canonical["positions"])[0])["account"])
	require.Equal(t,
		asMap(t, asList(t, canonical["positions"])[0])["account"],
		asMap(t, asList(t, explicit["positions"])[0])["account"],
		"absent dir IS the canonical direction (debt → desc)")

	// dir=asc reverses: the refused row (unrankable, canonical-last) leads.
	page1 := f.getJSON(t, "/v1/positions?engine=debt_manager&sort=debt&dir=asc&limit=1", "/v1/positions")
	require.Equal(t, fxAcctDMRef.Hex(), asMap(t, asList(t, page1["positions"])[0])["account"],
		"dir=asc on debt reverses the canonical desc ranking")
	cursor, ok := page1["next_cursor"].(string)
	require.True(t, ok, "a full page with rows remaining mints a cursor")

	// The SAME cursor under a different dir: the house 400 naming the law.
	out := f.getStatusJSON(t, "/v1/positions?engine=debt_manager&sort=debt&dir=desc&limit=1&cursor="+url.QueryEscape(cursor), "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, out["error"])["message"], "cursor does not match this request")
	// …and under a min_value it was not minted with: the same refusal.
	out = f.getStatusJSON(t, "/v1/positions?engine=debt_manager&sort=debt&dir=asc&min_value=1&limit=1&cursor="+url.QueryEscape(cursor), "/v1/positions", http.StatusBadRequest)
	require.Contains(t, asMap(t, out["error"])["message"], "cursor does not match this request")

	// Presented verbatim, the walk continues to the computed row.
	page2 := f.getJSON(t, "/v1/positions?engine=debt_manager&sort=debt&dir=asc&limit=1&cursor="+url.QueryEscape(cursor), "/v1/positions")
	require.Equal(t, fxAcctDM.Hex(), asMap(t, asList(t, page2["positions"])[0])["account"])
	require.Nil(t, page2["next_cursor"])
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
