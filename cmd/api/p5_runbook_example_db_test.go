package main

// Wave W-EX-A — THE STANDING LAW THAT MAKES THE CONTRACT-EXAMPLE DEFECT CLASS
// UNCONSTRUCTIBLE.
//
// `api/openapi.yaml`'s run-book 200 example used to be PROSE ABOUT a body:
// hand-written money that no book could produce. Five defects were ledgered
// against it (empty `held_flat` under a scenario whose propagation matrix names
// nothing, a histogram bucket its own /v1/params threshold contradicts, a
// census below the bucket it was drawn in, notes matching no sentence the
// server composes, and a shortfall over zero eligible accounts). Repairing five
// instances would have left the class alive.
//
// So the example stopped being written and started being CAPTURED. This test
// seeds a book that realizes the example's own committed identities, runs the
// REAL handler for the REAL committed scenario, and asserts that the contract's
// example IS that served body — modulo the four fields whose values are
// measured at serve time and can therefore never be pinned in a document.
//
// # The seeded book, and what it realizes
//
// The batch envelope is the standing fixture's (four positions, two refused,
// one flagged, batch id 1, the same watermark vector and the same sweep
// census), because the example commits those numbers and they are realizable
// exactly. The two computed positions carry the example's own money:
//
//	Aave (chain 1, base currency 8-dec)
//	  weETH 2e18 counted as collateral @ $4,000.00000000, LT 8100 bps
//	    collateral_base = floor(2e18 x 400000000000 / 1e18) = 800000000000
//	    weighted_lt     = 800000000000 x 8100               = 6480000000000000
//	  USDC 6000e6 borrowed @ $1.00000000
//	    debt_base = ceil(6000000000 x 100000000 / 1e6)      = 600000000000
//	  hf_wad = 1080000000000000000  (1.08 — HEALTHY, and NOT eligible)
//	  plus one held balance that is collateral-DISABLED and that no price
//	  witness describes: 5e18 of an asset the registry holds no symbol for.
//	  It is the example's `unpriced` disclosure, and it is a real reserve
//	  shape — ComputeAaveHealth admits it precisely because it needs no price.
//
//	Debt Manager (chain 10, USD 6-dec)
//	  weETH 1e18 held @ $4,000.000000, LT 80e18/100e18, bonus 1e18 (1%)
//	    value_usd    = 4000000000
//	    max_borrow_lt= floor(4000000000 x 80e18 / 100e18) = 3200000000
//	  borrowings 4620000000  >  3200000000  =>  LIQUIDATABLE
//	  comparator = 3200000000 / 4620000000 = 0.6926, which is `< 0.90`
//
// The Debt Manager's debt is the example's own `total_debt_usd`, 4620000000 —
// which is exactly the figure the old example could not reconcile with its own
// `eligible_debt_usd` of 4200000000. ONE account's debt is eligible whole or
// not at all, so the served body's eligible debt is 4620000000 and the split
// disappears by being impossible to seed.
//
// # The four normalized fields, and why each one
//
// A document cannot pin a number a clock produces. These four and no others are
// overwritten with the example's stylistic values before the comparison:
//
//	served_at                             the request's own instant
//	batch.computed_at                     the DATABASE clock at write time
//	batch.age_seconds                     now minus computed_at
//	batch.watermarks[].sweep.age_seconds  now minus the sweep stamp's max_updated_at
//
// `max_updated_at` itself is NOT normalized: it is a persisted stamp, seeded to
// a fixed instant, and the example carries it verbatim.
//
// EVERY OTHER BYTE OF THE EXAMPLE IS ASSERTED EQUAL. Editing the example by
// hand — adding a note the server does not compose, moving a bucket, inventing
// a shortfall — fails here.

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// The run-book example's scenario, and the two figures that are the example's
// alone (everything else it commits is already a fixture constant).
const (
	exScenarioID = "weeth_market_depeg_oracles_held"

	// The Debt Manager account's debt, as the example publishes it.
	exDMBorrowings = "4620000000"

	// The held, collateral-DISABLED, unpriced balance on the Aave account.
	exAaveUnpricedAmount = "5000000000000000000"
)

// exAaveUnpriced is the asset nothing prices and the registry holds no symbol
// for. It is deliberately not a feeds-registry address: the example's whole
// point is that a balance can be exact while its worth is unknowable, and an
// invented symbol would be the invention the disclosure exists to refuse.
var exAaveUnpriced = common.HexToAddress("0x0000000000000000000000000000000000000BAD")

// exAavePosition is the fixture's Aave account plus the unpriced holding.
func exAavePosition() *positionRow {
	p := fxAavePosition()
	p.Legs = append(p.Legs, legRow{
		Engine: risk.AaveEngine, Account: fxAcctAave.Bytes(), Asset: exAaveUnpriced.Bytes(), Decimals: 18,
		// Held, collateral DISABLED, priced by nobody. The recomputation emits
		// zeros for every base-currency output of such a reserve and NO
		// threshold at all, so the persisted leg carries exactly that.
		LiveCollateral: bi(exAaveUnpricedAmount), CollateralBase: bi("0"), WeightedLT: bi("0"),
		LiveDebt: bi("0"), DebtBase: bi("0"),
		UsedAsCollateral: boolp(false), CollateralIndexBlock: u64p(fxAaveBlock),
	})
	return p
}

// exDMPosition is the fixture's Debt Manager account carrying the example's own
// borrowings. The collateral, the threshold and the bonus are unchanged, so the
// param ledger `seedSubstrate` writes still welds it.
func exDMPosition() *positionRow {
	p := fxDMPosition()
	p.HFDen = bi(exDMBorrowings)
	p.Borrowings = bi(exDMBorrowings)
	// The debt-side weld demands Σ live_debt == borrowings, so the borrow leg
	// moves with the position: a row whose legs did not add up to its own
	// borrowings is a row the writer accepts and the serve layer refuses.
	for i := range p.Legs {
		if p.Legs[i].LiveDebt != nil {
			p.Legs[i].ScaledDebt = bi(exDMBorrowings)
			p.Legs[i].LiveDebt = bi(exDMBorrowings)
		}
	}
	return p
}

// exBatchWrite is the example's book: the standing fixture's four positions,
// with the two computed ones carrying the example's money.
func exBatchWrite(key string) store.RiskBatchWrite {
	w := store.RiskBatchWrite{
		Producer:             fxBatchProduce,
		Watermarks:           fxWatermarks(),
		RequiredEngines:      fxRequiredEngines(),
		RequiredSweepEngines: []string{risk.DMEngine},
		Retention:            100,
		MaterializationKey:   key,
		Notify:               notifyChannel,
		Aggregates: []store.RiskEngineAggregate{
			{
				Engine: risk.AaveEngine, ValueDecimals: 8,
				Positions: 2, ComputedPositions: 1, RefusedPositions: 1, FlaggedPositions: 1,
				LiquidatablePositions: 0,
				TotalCollateral:       bi(fxAaveCollateralBase), TotalDebt: bi(fxAaveDebtBase),
			},
			{
				Engine: risk.DMEngine, ValueDecimals: 6,
				Positions: 2, ComputedPositions: 1, RefusedPositions: 1, FlaggedPositions: 0,
				LiquidatablePositions: 1,
				TotalCollateral:       bi(fxDMCollateralUSD), TotalDebt: bi(exDMBorrowings),
			},
		},
	}
	for _, p := range []*positionRow{exAavePosition(), fxAaveRefused(), exDMPosition(), fxDMRefused()} {
		w.Positions = append(w.Positions, toWrite(p))
	}
	return w
}

// newRunBookExampleFixture is the P5 fixture's substrate with the EXAMPLE's
// batch as the newest servable one. The substrate pass, the param ledger and
// the registry are the standing ones; only the book differs.
func newRunBookExampleFixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	id, err := f.store.WriteRiskBatch(f.ctx, exBatchWrite("example-materialization-1"))
	require.NoError(t, err)
	require.Positive(t, id)
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found, "the example's batch must clear the SERVING bar")
	require.Equal(t, id, batch.ID)
	f.batchID = id
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)
	return f
}

// runBookExampleServeTimeFields names, once, the fields whose values a clock
// produces. The list is used both to normalize the served body and to report
// itself in the failure message, so a field can never be normalized silently.
var runBookExampleServeTimeFields = []string{
	"served_at",
	"batch.computed_at",
	"batch.age_seconds",
	"batch.watermarks[].sweep.age_seconds",
}

// exampleStyle is the instant the contract's example is written at: the fixture
// reference instant plus the five seconds of batch age the example discloses.
var (
	exampleServedAt   = fxBase.Add(5 * time.Second)
	exampleComputedAt = fxBase
)

// normalizeServeTime overwrites exactly the four measured fields with the
// example's stylistic values and returns the field list it touched. It fails if
// a field it expects to normalize is absent — a normalizer that silently
// normalizes nothing would make the whole comparison vacuous.
func normalizeServeTime(t *testing.T, body map[string]any) {
	t.Helper()
	require.Contains(t, body, "served_at")
	body["served_at"] = exampleServedAt.UTC().Format(time.RFC3339)

	batch := asMap(t, body["batch"])
	require.Contains(t, batch, "computed_at")
	require.Contains(t, batch, "age_seconds")
	batch["computed_at"] = exampleComputedAt.UTC().Format(time.RFC3339)
	batch["age_seconds"] = float64(5)

	sweeps := 0
	for _, w := range asList(t, batch["watermarks"]) {
		m := asMap(t, w)
		sweep, ok := m["sweep"].(map[string]any)
		if !ok {
			continue
		}
		require.Contains(t, sweep, "age_seconds")
		sweep["age_seconds"] = float64(1200)
		sweeps++
	}
	require.Equal(t, 1, sweeps,
		"the example's book carries exactly one sweep stamp; normalizing a different number of them means the book moved")
}

// runBookContractExample reads the contract's declared 200 example for the
// run-book route and re-encodes it through JSON, so both sides of the
// comparison carry the same Go types (YAML integers and JSON numbers are
// otherwise incomparable by ==).
func runBookContractExample(t *testing.T) map[string]any {
	t.Helper()
	doc := loadContract(t)
	item := doc.Paths.Find(runBookContractPath)
	require.NotNil(t, item, "the contract declares no %q", runBookContractPath)
	op := item.GetOperation(http.MethodPost)
	require.NotNil(t, op)
	mt := op.Responses.Status(http.StatusOK).Value.Content.Get("application/json")
	require.NotNil(t, mt)
	require.NotNil(t, mt.Example, "the contract declares no 200 example for the run-book route")

	raw, err := json.Marshal(mt.Example)
	require.NoError(t, err)
	var out map[string]any
	require.NoError(t, json.Unmarshal(raw, &out))

	// The example must also satisfy its OWN schema. A hand-edited example that
	// no longer validates would otherwise fail below as a diff rather than as
	// the schema violation it is.
	require.NoError(t, mt.Schema.Value.VisitJSON(mt.Example, openapi3.MultiErrors()),
		"the contract's run-book 200 example violates the contract's own schema")
	return out
}

// TestRunBookExampleIsAServedBody is the standing law.
//
// THE MUTATION THIS KILLS: editing `api/openapi.yaml`'s run-book 200 example to
// say anything the server does not serve. Every one of the five ledgered
// defects is one instance of that mutation, and none of them is constructible
// while this test stands.
func TestRunBookExampleIsAServedBody(t *testing.T) {
	f := newRunBookExampleFixture(t)

	served := f.postJSON(t, "/v1/scenarios/"+exScenarioID+"/run-book", runBookContractPath, http.StatusOK)
	normalizeServeTime(t, served)

	// The seeded book really is the example's book, asserted here rather than
	// left to the diff: a comparison that failed because the fixture drifted
	// would read as a contract defect.
	require.Equal(t, float64(1), asMap(t, served["batch"])["id"],
		"the example's batch is batch 1")
	byEngine := map[string]map[string]any{}
	for _, e := range asList(t, served["engines"]) {
		m := asMap(t, e)
		byEngine[m["engine"].(string)] = m
	}
	aave := asMap(t, byEngine[risk.AaveEngine]["before"])
	require.Equal(t, fxAaveCollateralBase, aave["total_collateral_usd"])
	require.Equal(t, fxAaveDebtBase, aave["total_debt_usd"])
	dm := asMap(t, byEngine[risk.DMEngine]["before"])
	require.Equal(t, fxDMCollateralUSD, dm["total_collateral_usd"])
	require.Equal(t, exDMBorrowings, dm["total_debt_usd"])
	require.Equal(t, exDMBorrowings, dm["eligible_debt_usd"],
		"ONE eligible account's debt is eligible WHOLE: an eligible-debt figure below the account's own debt reproduces from no single-account model")

	require.Equal(t, runBookContractExample(t), served,
		"api/openapi.yaml's run-book 200 example is not a body this server serves.\n"+
			"The example is CAPTURED, never composed: re-run this test's book through the handler and transplant the response.\n"+
			"Normalized serve-time fields (the only ones a document may differ on): %v",
		runBookExampleServeTimeFields)
}

// TestRunBookExampleHeldFlatNamesEveryPriceInput is the ledgered defect 1 as a
// standing law in its own right, expressed against PRODUCTION rather than
// against the document.
//
// `weeth_market_depeg_oracles_held` carries `propagation: []`, so
// `risk.ApplyScenario` records EVERY consulted price input on `HeldFlat`. A
// served body for this scenario therefore names them all; an empty `held_flat`
// is a disclosure this server cannot produce, whatever a document says.
func TestRunBookExampleHeldFlatNamesEveryPriceInput(t *testing.T) {
	f := newRunBookExampleFixture(t)
	served := f.postJSON(t, "/v1/scenarios/"+exScenarioID+"/run-book", runBookContractPath, http.StatusOK)

	require.Empty(t, asList(t, served["applied_shocks"]),
		"the scenario shocks no oracle mark, so nothing is applied")
	held := asList(t, served["held_flat"])
	require.NotEmpty(t, held,
		"a scenario whose propagation matrix describes no asset holds EVERY price flat, and every one of them is named")

	got := map[string]string{}
	for _, h := range held {
		m := asMap(t, h)
		got[m["asset"].(string)] = m["value"].(string)
	}
	require.Equal(t, map[string]string{
		fxWeETHEth.Hex(): fxAaveWeETHPrice,
		fxUSDCEth.Hex():  fxAaveUSDCPrice,
		fxWeETHOp.Hex():  fxDMWeETHPrice,
	}, got, "every price the book consulted is disclosed at the value it was held at")
}

// TestRunBookExampleShortfallOnlyCountsEligibleAccounts is ledgered defect 5 as
// a law: an execution shortfall is the sum over LIQUIDATABLE positions, so an
// engine with no eligible account has an EMPTY sum, which is "0" — never a
// figure a liquidator would realize on a book nobody may liquidate.
func TestRunBookExampleShortfallOnlyCountsEligibleAccounts(t *testing.T) {
	f := newRunBookExampleFixture(t)
	served := f.postJSON(t, "/v1/scenarios/"+exScenarioID+"/run-book", runBookContractPath, http.StatusOK)

	for _, e := range asList(t, served["engines"]) {
		m := asMap(t, e)
		before := asMap(t, m["before"])
		real := asMap(t, m["market_realization"])
		require.Equal(t, true, real["hfs_unchanged"],
			"oracles held: this axis never moves a health factor")
		if before["eligible_accounts"] == float64(0) {
			require.Equal(t, "0", real["execution_shortfall_usd"],
				"%s has no eligible account, so the shortfall sum is EMPTY", m["engine"])
			require.Equal(t, "0", real["bad_debt_at_liquidation_usd"],
				"%s has no eligible account, so there is no bad debt at a liquidation nobody may perform", m["engine"])
			continue
		}
		// The engine WITH an eligible account must carry a positive shortfall:
		// a law that only ever asserted zeros would pass on a server that
		// served zeros everywhere.
		require.Positive(t, bi(real["execution_shortfall_usd"].(string)).Sign(),
			"%s has an eligible account whose collateral realizes below its mark", m["engine"])
	}
}
