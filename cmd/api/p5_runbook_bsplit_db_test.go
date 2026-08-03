package main

// Wave W-BS-A, DB-backed — the three run-book fields contract 1.6.0 adds,
// served END TO END over the seeded fixture through the real handler, the real
// reconstruction and the real contract validator.
//
// The unit half lives in p5_runbook_bsplit_test.go and pins the derivations in
// isolation. This half pins what a client actually receives: that the refused
// row is counted on BOTH sides, that the mover is the account that moved, and
// that the itemization reconciles with the total it decomposes.

import (
	"encoding/json"
	"math/big"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

func runBookBucket(t *testing.T, hist map[string]any, label string) float64 {
	t.Helper()
	for _, b := range asList(t, hist["buckets"]) {
		m := asMap(t, b)
		if m["label"] == label {
			return m["count"].(float64)
		}
	}
	t.Fatalf("no bucket labelled %q", label)
	return 0
}

// runBookHistogramCensus is the whole-run identity: every position on the
// engine is in a bucket, in infinite_count, or in refused_count.
func runBookHistogramCensus(t *testing.T, hist map[string]any) float64 {
	t.Helper()
	total := hist["infinite_count"].(float64) + hist["refused_count"].(float64)
	for _, b := range asList(t, hist["buckets"]) {
		total += asMap(t, b)["count"].(float64)
	}
	return total
}

// TestRunBookServesTheDistributionShiftAndTheMovers is the 1.6.0 weld over the
// SEEDED fixture: the two histograms are what the shift is read from, the
// movers are the accounts that moved, and the collateral itemization reconciles
// with the total it decomposes.
func TestRunBookServesTheDistributionShiftAndTheMovers(t *testing.T) {
	f := newP5Fixture(t)

	out := f.postJSON(t, "/v1/scenarios/eth_minus_10/run-book", runBookContractPath, http.StatusOK)
	engines := map[string]map[string]any{}
	for _, e := range asList(t, out["engines"]) {
		m := asMap(t, e)
		engines[m["engine"].(string)] = m
	}

	// --- B1: the distribution, per side, on each engine's own comparator -----
	aave := engines["aave_v3_etherfi"]
	aBefore, aAfter := asMap(t, aave["before"]), asMap(t, aave["after"])
	aHistBefore, aHistAfter := asMap(t, aBefore["hf_histogram"]), asMap(t, aAfter["hf_histogram"])

	require.Equal(t, "hf_wad", aHistBefore["comparator"], "Aave buckets on the pool's OWN wad")
	require.Equal(t, "hf_wad", aHistAfter["comparator"])
	// HF 1.08 before the shock, 0.972 after it. The account crosses the 1.00
	// edge, and the two histograms are where that crossing becomes visible.
	require.Equal(t, float64(1), runBookBucket(t, aHistBefore, "1.05 – 1.10"), "HF 1.08 at par")
	require.Equal(t, float64(0), runBookBucket(t, aHistBefore, "0.90 – 1.00"))
	require.Equal(t, float64(0), runBookBucket(t, aHistAfter, "1.05 – 1.10"))
	require.Equal(t, float64(1), runBookBucket(t, aHistAfter, "0.90 – 1.00"), "HF 0.972 after one 10% ETH step")

	// THE REFUSED ROW IS COUNTED, ON BOTH SIDES. The batch carries one refused
	// Aave position; nothing can shock it, and a distribution that dropped it
	// would describe a book of one where the batch holds two.
	require.Equal(t, float64(1), aHistBefore["refused_count"],
		"the refused Aave row is COUNTED refused, never dropped from the distribution")
	require.Equal(t, float64(1), aHistAfter["refused_count"],
		"and it is counted on the AFTER side too — a shock does not make a row rebuildable")
	require.Equal(t, float64(2), runBookHistogramCensus(t, aHistBefore),
		"buckets + infinite + refused must be every Aave position in the batch")
	require.Equal(t, float64(2), runBookHistogramCensus(t, aHistAfter))

	dm := engines["debt_manager"]
	dmBefore, dmAfter := asMap(t, dm["before"]), asMap(t, dm["after"])
	dmHistBefore, dmHistAfter := asMap(t, dmBefore["hf_histogram"]), asMap(t, dmAfter["hf_histogram"])
	require.Equal(t, "hf_num/hf_den", dmHistBefore["comparator"],
		"the Debt Manager has no wad: its buckets are the exact rational, and the contract says so")
	// 3200/4200 = 0.762 at par, 2880/4200 = 0.686 after: below 0.90 on both
	// sides, so the DM distribution does NOT move — and that is the finding.
	require.Equal(t, float64(1), runBookBucket(t, dmHistBefore, "< 0.90"))
	require.Equal(t, float64(1), runBookBucket(t, dmHistAfter, "< 0.90"))
	require.Equal(t, float64(1), dmHistBefore["refused_count"])
	require.Equal(t, float64(2), runBookHistogramCensus(t, dmHistBefore))
	require.Equal(t, risk.WadUnit().String(), dmHistBefore["wad_scale"],
		"the scale travels with the histogram — these buckets are read without /v1/book's envelope in scope")

	// --- B2: the movers ------------------------------------------------------
	aMovers := asList(t, aave["movers"])
	require.Len(t, aMovers, 1, "one Aave account, and its health factor dropped")
	require.Equal(t, float64(1), aave["movers_total"])
	m0 := asMap(t, aMovers[0])
	require.Equal(t, fxAaveHFWad, m0["hf_before_wad"])
	require.NotNil(t, m0["hf_after_wad"])
	require.NotNil(t, m0["hf_drop_wad"])
	drop, ok := new(big.Int).SetString(m0["hf_drop_wad"].(string), 10)
	require.True(t, ok)
	require.Equal(t, 1, drop.Sign(), "a mover's drop is strictly positive")
	require.Equal(t,
		new(big.Int).Sub(bi(fxAaveHFWad), bi(m0["hf_after_wad"].(string))).String(),
		m0["hf_drop_wad"], "the drop IS before minus after, in wad space")
	// The Debt Manager's vocabulary is NULL on an Aave row — never a zero that
	// would read as "no debt became eligible".
	require.Nil(t, m0["became_eligible"])
	require.Nil(t, m0["debt_usd"])
	require.Nil(t, m0["hf_before_num"])
	require.Contains(t, aave["movers_note"], "HEALTH-FACTOR DROP")

	// The DM account was ALREADY eligible at par, so nothing FLIPPED: zero
	// movers, and `newly_eligible_accounts` is zero for the same reason. This
	// pair is what proves movers_total is a flip count, not a headcount of the
	// eligible — the two numbers COINCIDE here, so the pair that proves they are
	// DIFFERENT MEASURES lives in
	// TestRunBookMoversTotalIsNotTheNetEligibilityChange below.
	require.Empty(t, asList(t, dm["movers"]), "an already-eligible account did not BECOME eligible")
	require.Equal(t, float64(0), dm["movers_total"])
	require.Equal(t, float64(0), dm["newly_eligible_accounts"])
	// AND THE HEADCOUNT DISAGREES WITH BOTH: one account is eligible on this
	// engine on both sides, so a movers_total that were a headcount of the
	// eligible would read 1 here rather than 0.
	require.Equal(t, float64(1), asMap(t, dm["after"])["eligible_accounts"],
		"the DM account is eligible at par and stays eligible")
	require.Contains(t, dm["movers_note"], "DEBT THAT BECAME ELIGIBLE")
	require.Contains(t, dm["movers_note"], "not `newly_eligible_accounts`")

	// --- B3: the collateral itemization --------------------------------------
	// Every side of every engine: the counted entries ARE the total.
	for _, side := range []struct {
		name string
		agg  map[string]any
	}{
		{"aave before", aBefore}, {"aave after", aAfter},
		{"dm before", dmBefore}, {"dm after", dmAfter},
	} {
		sum := new(big.Int)
		for _, c := range asList(t, side.agg["collateral_by_asset"]) {
			m := asMap(t, c)
			require.NotEmpty(t, m["amount"], "%s: every entry carries an exact balance", side.name)
			require.NotNil(t, m["unpriced"], "%s: every entry carries its disclosure", side.name)
			if m["value_usd"] == nil {
				continue
			}
			sum.Add(sum, bi(m["value_usd"].(string)))
		}
		require.Equal(t, side.agg["total_collateral_usd"], sum.String(),
			"%s: collateral_by_asset must sum EXACTLY to total_collateral_usd", side.name)
	}

	// The itemization is PER AGGREGATE: under an asset shock the two sides
	// carry different values for the same asset, which is the whole reason it
	// is not hoisted onto the engine.
	beforeWeETH := asMap(t, asList(t, aBefore["collateral_by_asset"])[0])
	afterWeETH := asMap(t, asList(t, aAfter["collateral_by_asset"])[0])
	require.Equal(t, fxWeETHEth.Hex(), beforeWeETH["asset"])
	require.Equal(t, fxAaveWeETHAmount, beforeWeETH["amount"])
	require.Equal(t, fxAaveWeETHAmount, afterWeETH["amount"],
		"the BALANCE does not move under a price shock — only its value does")
	require.Equal(t, fxAaveCollateralBase, beforeWeETH["value_usd"])
	require.Equal(t, "720000000000", afterWeETH["value_usd"], "weETH $4,000 -> $3,600")
	require.Equal(t, false, beforeWeETH["unpriced"])
}

// TestRunBookOracleHeldScenarioMovesNobody is the negative pin: a scenario that
// moves no oracle mark moves NO account, so both movers lists are empty and
// each engine's two histograms are identical. A movers implementation that
// ranked every account rather than the ones that moved lights up here.
func TestRunBookOracleHeldScenarioMovesNobody(t *testing.T) {
	f := newP5Fixture(t)

	out := f.postJSON(t, "/v1/scenarios/weeth_market_depeg_oracles_held/run-book", runBookContractPath, http.StatusOK)
	for _, e := range asList(t, out["engines"]) {
		m := asMap(t, e)
		name := m["engine"].(string)
		require.Empty(t, asList(t, m["movers"]), "%s: no oracle mark moved, so no account moved", name)
		require.Equal(t, float64(0), m["movers_total"], "%s", name)

		before, err := json.Marshal(asMap(t, m["before"])["hf_histogram"])
		require.NoError(t, err)
		after, err := json.Marshal(asMap(t, m["after"])["hf_histogram"])
		require.NoError(t, err)
		require.JSONEq(t, string(before), string(after),
			"%s: oracle marks held — the distribution is identical BY CONSTRUCTION", name)
	}
}

// ---------------------------------------------------------------------------
// Wave W-BS-B, finding 5 — THE MIXED-DIRECTION BOOK
// ---------------------------------------------------------------------------

// seedAaveUSDCParams writes the SECOND Aave param-ledger row the
// mixed-direction book needs: USDC's own liquidation threshold and bonus. The
// weETH row `seedSubstrate` writes says nothing about USDC, and
// `weldLegParams` refuses a leg whose threshold no custodied row asserts — so
// without this row the account that counts USDC as collateral would be an
// honest reconstruction REFUSAL rather than a position in the run.
//
// It sits at the same effective block as the weETH row with a distinct
// effective_log_index, so `riskfeed.FoldParams` still walks a totally ordered
// ledger.
func (f *apiFixture) seedAaveUSDCParams(t *testing.T) {
	t.Helper()
	_, err := f.admin.Exec(f.ctx,
		`INSERT INTO param_history (engine, chain_id, asset, ltv, liq_threshold, liq_bonus,
		                            emode_category, effective_block, effective_log_index, source_event, tx_hash)
		 VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,0,$7,1,$8,$9)`,
		risk.AaveParamEngine, int64(fxETHChain), fxUSDCEth.Bytes(),
		fxMDUSDCLTV, fxMDUSDCLTBps, fxMDUSDCBonusBps,
		int64(fxParamEffectiveBlock), "CollateralConfigurationChanged", hash32(0x55))
	require.NoError(t, err)
}

// seedMixedDirectionBatch writes the mixed-direction book as a NEWER batch over
// whatever the fixture already carries, through `store.WriteRiskBatch` — the
// same production writer every other batch in this suite goes through, with the
// same validation and the same completeness accounting. Every handler resolves
// the newest complete batch inside its own request snapshot, so the run-book
// route answers over this book from the next call onward.
func (f *apiFixture) seedMixedDirectionBatch(t *testing.T, key string) {
	t.Helper()
	f.seedAaveUSDCParams(t)
	id, err := f.store.WriteRiskBatch(f.ctx, fxMixedDirectionBatchWrite(key))
	require.NoError(t, err)
	require.Positive(t, id)
	f.batchID = id
}

// TestRunBookMoversTotalIsNotTheNetEligibilityChange is the DISCRIMINATING pin
// the 0/0 and 1/1 cases above cannot be: a served book in which `movers_total`
// and `newly_eligible_accounts` are DIFFERENT NUMBERS.
//
// Two Aave accounts cross DOWN through 1.00 and one crosses UP (its debt is
// denominated in the shocked asset, so a 30% ETH drawdown shrinks the debt
// while its USDC collateral holds its mark). The mover count admits strict
// drops only and reads 2; the eligibility change is a signed NET over the two
// sides and reads 1, because the flip back to healthy is subtracted out of it.
//
// THE MUTATION THIS KILLS: serializing `ea.eligibleAccounts - eb.eligibleAccounts`
// as `movers_total`. Against this book that reports 1 where the book has 2.
// Against every earlier fixture — 0/0 on the Debt Manager, 1/1 on Aave — it
// reports the right number for the wrong reason and passes.
func TestRunBookMoversTotalIsNotTheNetEligibilityChange(t *testing.T) {
	f := newP5Fixture(t)
	f.seedMixedDirectionBatch(t, "wave-w-bs-b-mixed-direction-1")

	out := f.postJSON(t, "/v1/scenarios/eth_minus_30/run-book", runBookContractPath, http.StatusOK)
	engines := map[string]map[string]any{}
	for _, e := range asList(t, out["engines"]) {
		m := asMap(t, e)
		engines[m["engine"].(string)] = m
	}
	aave := engines["aave_v3_etherfi"]
	require.NotNil(t, aave, "eth_minus_30 covers the Aave engine")
	before, after := asMap(t, aave["before"]), asMap(t, aave["after"])

	// The whole book reached the run: four positions, none refused, none
	// unrebuildable. A mixed-direction result over a partially-excluded book
	// would prove nothing about either count.
	cov := asMap(t, out["coverage"])
	require.Equal(t, float64(4), cov["batch_positions"])
	require.Equal(t, float64(4), cov["in_book"])
	require.Equal(t, float64(0), cov["excluded_by_this_layer"])
	require.Equal(t, float64(3), before["accounts"], "three Aave accounts in the run")
	require.Equal(t, float64(3), after["accounts"])

	// --- THE TWO NUMBERS, AND THEY DIFFER ------------------------------------
	require.Equal(t, float64(2), aave["movers_total"],
		"A and B crossed DOWN; both are movers")
	require.Equal(t, float64(1), aave["newly_eligible_accounts"],
		"after 2 minus before 1 — the NET count, with C's flip back to healthy subtracted out")
	require.NotEqual(t, aave["movers_total"], aave["newly_eligible_accounts"],
		"THE POINT: movers_total is a one-direction count and newly_eligible_accounts is a signed net")

	// The eligibility census on each side, which is where the net comes from.
	require.Equal(t, float64(1), before["eligible_accounts"], "only C is eligible at par")
	require.Equal(t, float64(2), after["eligible_accounts"], "A and B after the shock; C is out")

	// --- THE MOVERS ARE A AND B, RANKED BY THE DROP ---------------------------
	movers := asList(t, aave["movers"])
	require.Len(t, movers, 2)
	m0, m1 := asMap(t, movers[0]), asMap(t, movers[1])
	require.Equal(t, fxMDAcctDropsA.Hex(), m0["account"], "the larger drop ranks first")
	require.Equal(t, fxMDAcctDropsB.Hex(), m1["account"])
	require.Equal(t, fxMDAHFWad, m0["hf_before_wad"])
	require.Equal(t, fxMDAHFWadAfter, m0["hf_after_wad"])
	require.Equal(t, fxMDADropWad, m0["hf_drop_wad"])
	require.Equal(t, fxMDBHFWad, m1["hf_before_wad"])
	require.Equal(t, fxMDBHFWadAfter, m1["hf_after_wad"])
	require.Equal(t, fxMDBDropWad, m1["hf_drop_wad"])

	// AND THE ACCOUNT THAT CROSSED THE OTHER WAY IS IN NEITHER DIRECTION'S LIST.
	// `movers` admits strict drops only, so a risen health factor is not a
	// mover — and nothing on this wire reports it as one.
	for _, mv := range movers {
		require.NotEqual(t, fxMDAcctRises.Hex(), asMap(t, mv)["account"],
			"an account whose health factor ROSE is not a mover")
	}

	// --- THE HISTOGRAMS AGREE, AND SHOW WHY THE NET IS NOT THE GROSS ----------
	// Below 1.00: one account before (C), two after (A and B). The population
	// moved by ONE while THREE accounts changed bucket and one of them left the
	// region — which is exactly the limitation the run-book detail's histogram
	// sentence now discloses instead of calling the difference a crossing count.
	histBefore := asMap(t, before["hf_histogram"])
	histAfter := asMap(t, after["hf_histogram"])
	require.Equal(t, float64(1), runBookBucket(t, histBefore, "< 0.90"), "C at 0.74375")
	require.Equal(t, float64(1), runBookBucket(t, histBefore, "1.05 – 1.10"), "B at 1.08")
	require.Equal(t, float64(1), runBookBucket(t, histBefore, "1.10 – 1.25"), "A at 1.20")
	require.Equal(t, float64(2), runBookBucket(t, histAfter, "< 0.90"), "A at 0.84, B at 0.756")
	require.Equal(t, float64(1), runBookBucket(t, histAfter, "1.05 – 1.10"), "C at 1.0625")
	require.Equal(t, float64(0), runBookBucket(t, histAfter, "1.10 – 1.25"))
	// Both sides are a whole census of the engine's rows.
	require.Equal(t, float64(3), runBookHistogramCensus(t, histBefore))
	require.Equal(t, float64(3), runBookHistogramCensus(t, histAfter))

	// --- THE DEBT MANAGER RIDES ALONG AS THE CONTROL --------------------------
	// Nothing flips there under this scenario, so its two numbers COINCIDE at
	// zero — the vacuous pair, kept in view beside the discriminating one so the
	// difference between the two shapes is on the record.
	dm := engines["debt_manager"]
	require.Equal(t, float64(0), dm["movers_total"])
	require.Equal(t, float64(0), dm["newly_eligible_accounts"])
	require.Equal(t, float64(1), asMap(t, dm["after"])["eligible_accounts"],
		"already eligible at par and still eligible: a headcount would read 1, both counts read 0")
}
