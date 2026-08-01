package main

// POST /v1/scenarios/{id}/run-book and GET /v1/evidence.
//
// The run-book expectations are HAND-DERIVED from the seeded fixture (the
// derivations live in fixture_test.go's header): the same constants the
// waterfall tests pin, asserted here at the run-book's before/after sides.
//
//	eth_minus_10, Aave: weETH $4,000 -> $3,600, collateral_base 720000000000,
//	  HF = 720x0.81/600 = 0.972 < 1 => the account BECOMES eligible; at 0.9 the
//	  fixture constants pin eligible debt 600000000000, at-risk 630000000000
//	  (bonus-capped), bad debt 0 (recoverable 685714285714 >= debt).
//	eth_minus_10, DM: weETH $4,000 -> $3,600, collateral 3600000000, maxBorrowLT
//	  2880000000; borrowings 4200000000 were ALREADY over => eligible before and
//	  after; bad debt grows 239603961 -> 635643565 (fixture constants).

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// postJSON POSTs, requires status, contract-validates, and decodes.
func (f *apiFixture) postJSON(t *testing.T, path, contractPath string, status int) map[string]any {
	t.Helper()
	got, body := f.post(t, path)
	require.Equal(t, status, got, "body: %s", truncate(body))
	validateContractMethod(t, contractPath, http.MethodPost, status, body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	return out
}

const runBookContractPath = "/v1/scenarios/{id}/run-book"

func TestRunBookEthMinus10DeltasAreTheScenarioContribution(t *testing.T) {
	f := newP5Fixture(t)

	out := f.postJSON(t, "/v1/scenarios/eth_minus_10/run-book", runBookContractPath, http.StatusOK)
	require.Equal(t, "eth_minus_10", out["scenario_id"])
	require.Empty(t, asList(t, out["excluded_engines"]))

	engines := map[string]map[string]any{}
	for _, e := range asList(t, out["engines"]) {
		m := asMap(t, e)
		engines[m["engine"].(string)] = m
	}
	require.Len(t, engines, 2)

	aave := engines["aave_v3_etherfi"]
	require.Equal(t, float64(8), aave["usd_decimals"])
	before, after := asMap(t, aave["before"]), asMap(t, aave["after"])
	require.Equal(t, float64(1), before["accounts"])
	require.Equal(t, float64(0), before["eligible_accounts"], "HF 1.08: healthy at par")
	require.Equal(t, fxAaveCollateralBase, before["total_collateral_usd"])
	require.Equal(t, fxAaveDebtBase, before["total_debt_usd"])
	require.Equal(t, "0", before["eligible_debt_usd"])
	require.Equal(t, "0", before["bad_debt_usd"])
	require.Equal(t, float64(1), after["eligible_accounts"], "one 10% ETH step makes the account eligible")
	require.Equal(t, "720000000000", after["total_collateral_usd"], "floor(2e18 x 3600e8 / 1e18)")
	require.Equal(t, fxAaveDebtAt90, after["eligible_debt_usd"])
	require.Equal(t, fxAaveAtRiskAt90, after["collateral_at_risk_usd"], "bonus-capped seizable value")
	require.Equal(t, "0", after["bad_debt_usd"], "recoverable 685714285714 >= debt: no insolvency yet")
	require.Equal(t, float64(1), aave["newly_eligible_accounts"])
	require.Equal(t, fxAaveDebtAt90, aave["eligible_debt_delta_usd"], "delta-only: 600000000000 - 0")
	require.Nil(t, aave["market_realization"])
	require.Nil(t, aave["projection"])

	dm := engines["debt_manager"]
	require.Equal(t, float64(6), dm["usd_decimals"])
	dmBefore, dmAfter := asMap(t, dm["before"]), asMap(t, dm["after"])
	require.Equal(t, float64(1), dmBefore["eligible_accounts"], "already liquidatable at par")
	require.Equal(t, fxDMBorrowings, dmBefore["eligible_debt_usd"])
	require.Equal(t, fxDMBadDebtAtPar, dmBefore["bad_debt_usd"], "the STANDING bad-debt census at the unshocked point")
	require.Equal(t, fxDMAtRiskAtPar, dmBefore["collateral_at_risk_usd"])
	require.Equal(t, fxDMBadDebtAt90, dmAfter["bad_debt_usd"])
	require.Equal(t, fxDMAtRiskAt90, dmAfter["collateral_at_risk_usd"])
	require.Equal(t, float64(0), dm["newly_eligible_accounts"])
	require.Equal(t, "0", dm["eligible_debt_delta_usd"], "eligible debt does not move — the FINDING is the bad-debt growth")
	require.Equal(t, "396039604", dm["bad_debt_delta_usd"], "635643565 - 239603961")

	// The coverage audit: every batch position is accounted for.
	cov := asMap(t, out["coverage"])
	require.Equal(t, float64(4), cov["batch_positions"])
	require.Equal(t, float64(2), cov["in_book"])
	require.Equal(t, float64(2), cov["refused_in_batch"])
	require.Equal(t, true, cov["stress_coverage_is_full"])

	// The shocks were APPLIED, and the application is disclosed book-wide.
	require.NotEmpty(t, asList(t, out["applied_shocks"]))
}

// TestRunBookDepegOraclesHeld: the flagship — a market depeg with oracles held
// moves NO health factor (asserted, not promised) and its information lives on
// the shortfall axis.
func TestRunBookDepegOraclesHeld(t *testing.T) {
	f := newP5Fixture(t)

	out := f.postJSON(t, "/v1/scenarios/weeth_market_depeg_oracles_held/run-book", runBookContractPath, http.StatusOK)
	engines := map[string]map[string]any{}
	for _, e := range asList(t, out["engines"]) {
		m := asMap(t, e)
		engines[m["engine"].(string)] = m
	}

	for name, e := range engines {
		before, err := json.Marshal(e["before"])
		require.NoError(t, err)
		after, err := json.Marshal(e["after"])
		require.NoError(t, err)
		require.JSONEq(t, string(before), string(after),
			"%s: oracle marks held — before and after aggregates are identical BY CONSTRUCTION", name)
		sf := asMap(t, e["market_realization"])
		require.Equal(t, true, sf["hfs_unchanged"], "computed by the double-evaluation guard, not asserted")
	}

	// The DM account is liquidatable, so its seized collateral realizes 5%
	// under the oracle mark: floor-level arithmetic pins $200 on the $4,000
	// pro-rata seizure — the contract example's own number.
	dmSF := asMap(t, engines["debt_manager"]["market_realization"])
	require.Equal(t, "200000000", dmSF["execution_shortfall_usd"])
	require.Equal(t, "pro-rata-over-counted-collateral", dmSF["seizure_model"])

	// No oracle moved, so nothing was applied and the depeg axis is out of the
	// pricing pipeline entirely.
	require.Empty(t, asList(t, out["applied_shocks"]))
	require.Empty(t, asList(t, out["shocks"]))
}

// TestRunBookRateProjection: the rate axis ships as a PROJECTION on the
// delta-only basis — identical spot aggregates, and horizon figures that match
// the address-level surface summed over the book.
func TestRunBookRateProjection(t *testing.T) {
	f := newP5Fixture(t)

	out := f.postJSON(t, "/v1/scenarios/dm_rate_horizon_plus_200bps/run-book", runBookContractPath, http.StatusOK)
	engines := asList(t, out["engines"])
	require.Len(t, engines, 1, "the scenario covers the Debt Manager only; Aave's absence is named in notes")
	dm := asMap(t, engines[0])
	require.Equal(t, "debt_manager", dm["engine"])

	before, err := json.Marshal(dm["before"])
	require.NoError(t, err)
	after, err := json.Marshal(dm["after"])
	require.NoError(t, err)
	require.JSONEq(t, string(before), string(after), "a rate change moves no spot aggregate")

	proj := asMap(t, dm["projection"])
	require.Equal(t, "PROJECTION", proj["label"])
	require.Equal(t, "delta-only", proj["basis"])
	horizons := asList(t, proj["horizons"])
	require.NotEmpty(t, horizons)
	for _, h := range horizons {
		require.Nil(t, asMap(t, h)["becomes_liquidatable"],
			"no book-wide liquidatability claim is published from a delta-only path")
	}

	// Cross-surface weld: the single DM position means the book-wide sums must
	// EQUAL the address-level projection, horizon by horizon.
	stress := f.getJSON(t, "/v1/address/"+fxAcctDM.Hex()+"/stress", "/v1/address/{addr}/stress")
	var addrHorizons []any
	for _, sc := range asList(t, stress["scenarios"]) {
		m := asMap(t, sc)
		if m["id"] != "dm_rate_horizon_plus_200bps" {
			continue
		}
		for _, res := range asList(t, m["results"]) {
			r := asMap(t, res)
			if r["engine"] == "debt_manager" && r["projection"] != nil {
				addrHorizons = asList(t, asMap(t, r["projection"])["horizons"])
			}
		}
	}
	require.NotEmpty(t, addrHorizons)
	require.Len(t, horizons, len(addrHorizons))
	for i := range horizons {
		got, want := asMap(t, horizons[i]), asMap(t, addrHorizons[i])
		for _, field := range []string{"horizon_seconds", "debt_usd", "projected_usd", "additional_interest_usd"} {
			require.Equal(t, want[field], got[field], "horizon %d field %s must match the address surface", i, field)
		}
	}
}

func TestRunBookWithheldEngineIsExcludedByName(t *testing.T) {
	f := newP5Fixture(t)
	f.seedWithheldBatch(t, "withheld-materialization-1", false)

	out := f.postJSON(t, "/v1/scenarios/eth_minus_10/run-book", runBookContractPath, http.StatusOK)
	excluded := asList(t, out["excluded_engines"])
	require.Len(t, excluded, 1)
	require.Equal(t, "aave_v3_etherfi", asMap(t, excluded[0])["engine"])
	require.Equal(t, "FLAG_CUSTODY_UNPROVEN", asMap(t, excluded[0])["code"])

	for _, e := range asList(t, out["engines"]) {
		require.NotEqual(t, "aave_v3_etherfi", asMap(t, e)["engine"],
			"a withheld engine appears NOWHERE but excluded_engines")
	}
	cov := asMap(t, out["coverage"])
	require.Equal(t, false, cov["stress_coverage_is_full"], "a withheld engine makes the book-wide claim false")
	require.Len(t, asList(t, cov["withheld_engines"]), 1)
}

func TestRunBookRefusals(t *testing.T) {
	f := newP5Fixture(t)

	status, body := f.post(t, "/v1/scenarios/no_such_scenario/run-book")
	require.Equal(t, http.StatusNotFound, status)
	validateContractMethod(t, runBookContractPath, http.MethodPost, http.StatusNotFound, body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	require.Equal(t, "not_found", asMap(t, out["error"])["code"])
	require.Contains(t, asMap(t, out["error"])["message"], "COMMITTED scenario set",
		"an unknown id is a 404 naming the law, never a silently empty run")

	status, _ = f.post(t, "/v1/scenarios/UPPER-not-allowed/run-book")
	require.Equal(t, http.StatusBadRequest, status)

	// GET on the one POST route is refused by the router.
	status, _ = f.get(t, "/v1/scenarios/eth_minus_10/run-book")
	require.Equal(t, http.StatusMethodNotAllowed, status)

	// POST anywhere else stays refused: the read-only gate opens for exactly
	// one path.
	req, err := http.NewRequest(http.MethodPost, f.http.URL+"/v1/book", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	resp.Body.Close()
	require.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}

// ---------------------------------------------------------------------------
// /v1/evidence
// ---------------------------------------------------------------------------

func TestEvidenceServesTheDeployBoundManifest(t *testing.T) {
	f := newP5Fixture(t)

	out := f.getJSON(t, "/v1/evidence", "/v1/evidence")
	svc := asMap(t, out["service"])
	require.Equal(t, "solvent-api", svc["name"])
	require.Equal(t, float64(19), svc["schema_version"], "the P5 schema pin (19: 00019 two-valued observatory sweep CHECK, wave H6b)")
	require.Equal(t, f.srv.registry.Fingerprint(), svc["registry_fingerprint"])
	require.Equal(t, "test", out["commit"], "the build stamp, served verbatim")

	sub := asMap(t, out["substrate"])
	require.Equal(t, float64(f.batchID), sub["batch_id"])
	require.Equal(t, "fixture-materialization-1", sub["materialization_key"])

	feeds := asMap(t, out["feeds_registry"])
	require.Equal(t, "recon/feeds.json", feeds["path"])
	require.Equal(t, f.srv.evidence.FeedsSHA256, feeds["file_sha256"])
	require.Len(t, feeds["file_sha256"], 64)

	// The COMMITTED drift-report receipt's summary, verbatim.
	rec := asMap(t, out["reconcile"])
	require.Equal(t, "solvent.reconcile.drift-report/v1", rec["schema"])
	require.Equal(t, "pass", rec["result"])
	require.Equal(t, float64(0), rec["exit_code"])
	require.Equal(t, float64(87), rec["gated_rows"])
	require.Equal(t, float64(87), rec["gated_exact"])
	require.Equal(t, float64(0), rec["gated_drift"])
	require.Equal(t, float64(21), rec["advisory_rows"])
	welds := map[string]map[string]any{}
	for _, wd := range asList(t, rec["welds"]) {
		m := asMap(t, wd)
		welds[m["engine"].(string)] = m
	}
	require.Equal(t, float64(14), welds["aave_v3_etherfi"]["rows_compared"])
	require.Equal(t, float64(14), welds["aave_v3_etherfi"]["rows_exact"])
	require.Equal(t, float64(29), welds["debt_manager"]["rows_compared"])
	require.Equal(t, float64(29), welds["debt_manager"]["rows_exact"])
	require.NotEmpty(t, rec["comparison_sha256"])

	probes := asList(t, out["probe_records"])
	require.NotEmpty(t, probes)
	require.Equal(t, "recon/p3-probes.md", asMap(t, probes[0])["path"])
}

// TestEvidenceStatesAbsenceInsteadOfApproximating: a deployment without the
// receipt artifact serves `reconcile: null` WITH its reason; a deployment with
// no servable batch serves `substrate: null` with its reason. Both still 200 —
// the manifest describes the deployment.
func TestEvidenceStatesAbsenceInsteadOfApproximating(t *testing.T) {
	f := newP5Fixture(t)

	// No committed receipt.
	ev, err := loadEvidenceStatics("../..", "recon/feeds.json", "roadmap/evidence/artifacts/does-not-exist.json")
	require.NoError(t, err, "an absent receipt is a stated absence, not a startup failure")
	require.Nil(t, ev.Reconcile)
	require.NotEmpty(t, ev.ReconcileUnavailable)
	f.srv.evidence = ev

	out := f.getJSON(t, "/v1/evidence", "/v1/evidence")
	require.Nil(t, out["reconcile"])
	require.Contains(t, out["reconcile_unavailable_reason"], "no committed reconcile receipt")

	// No servable batch: wipe the risk tables (this test owns its fixture).
	_, err = f.admin.Exec(f.ctx, `TRUNCATE risk_batches RESTART IDENTITY CASCADE`)
	require.NoError(t, err)
	out = f.getJSON(t, "/v1/evidence", "/v1/evidence")
	require.Nil(t, out["substrate"], "no batch: the substrate is null with its reason, and the route still answers 200")
	require.Contains(t, out["substrate_unavailable_reason"], "no complete risk batch")
}
