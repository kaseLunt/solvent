package main

// Wave W-TM, DB-backed — the transition matrix served END TO END over a seeded
// book, through the real handler, the real reconstruction and the real contract
// validator.
//
// Everything here needs a seeded book, so everything here is in the `_db_test`
// half of the split. That placement is the whole point: `apiFixture` SKIPS when
// `TEST_DATABASE_URL` is unset, so a law that needs a seed and sits in the pure
// file does not fail without a database — it silently skips, taking the wave's
// stated reason for existing with it.
//
// The three laws that could not live in the pure half:
//
//	the matrix a client actually receives      -> TestRunBookServesTheTransitionMatrix
//	the OTHER unmeasured cause, end to end     -> TestRunBookTransitionSplitsAnUnrebuildableRowFromARefusedOne
//	offsetting moves + the debt asymmetry      -> TestRunBookTransitionSeparatesOffsettingMoves

import (
	"math/big"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// tdEngines indexes a served body's `engines[]` by engine name.
func tdEngines(t *testing.T, out map[string]any) map[string]map[string]any {
	t.Helper()
	engines := map[string]map[string]any{}
	for _, e := range asList(t, out["engines"]) {
		m := asMap(t, e)
		engines[m["engine"].(string)] = m
	}
	return engines
}

// tdInts reads a dense integer margin off the wire.
func tdInts(t *testing.T, v any) []int {
	t.Helper()
	out := []int{}
	for _, n := range asList(t, v) {
		out = append(out, int(n.(float64)))
	}
	return out
}

// tdCell returns the cell (from -> to) of a served matrix, or nil when the
// matrix does not carry it. An ABSENT cell is a knowable zero, so a caller that
// wants "zero rows here" asserts nil rather than a count.
func tdCell(t *testing.T, tr map[string]any, from, to int) map[string]any {
	t.Helper()
	outflows := asList(t, tr["outflows"])
	require.Len(t, outflows, 10, "outflows are DENSE: one entry per lane, always")
	of := asMap(t, outflows[from])
	require.Equal(t, float64(from), of["from"], "outflow %d must be lane %d: the array is positional", from, from)
	for _, c := range asList(t, of["cells"]) {
		m := asMap(t, c)
		if int(m["to"].(float64)) == to {
			return m
		}
	}
	return nil
}

// tdTally is the histogram tally for one lane: the three-way rule the margins
// must equal, read off a served histogram body.
func tdTally(t *testing.T, hist map[string]any, lane int) int {
	t.Helper()
	switch lane {
	case 8:
		return int(hist["infinite_count"].(float64))
	case 9:
		return int(hist["refused_count"].(float64))
	default:
		return int(asMap(t, asList(t, hist["buckets"])[lane])["count"].(float64))
	}
}

// tdRequireMarginsAreTheHistograms is the headline law observed on the WIRE:
// `from_rows` IS the before histogram and `to_rows` IS the after histogram, lane
// for lane, and both are the cells' own sums.
func tdRequireMarginsAreTheHistograms(t *testing.T, engine string, eng map[string]any) {
	t.Helper()
	tr := asMap(t, eng["hf_transitions"])
	beforeHist := asMap(t, asMap(t, eng["before"])["hf_histogram"])
	afterHist := asMap(t, asMap(t, eng["after"])["hf_histogram"])

	from, to := tdInts(t, tr["from_rows"]), tdInts(t, tr["to_rows"])
	require.Len(t, from, 10)
	require.Len(t, to, 10)

	rowSums, colSums := make([]int, 10), make([]int, 10)
	total := 0
	for _, o := range asList(t, tr["outflows"]) {
		om := asMap(t, o)
		prev := -1
		for _, c := range asList(t, om["cells"]) {
			cm := asMap(t, c)
			rows := int(cm["rows"].(float64))
			require.GreaterOrEqual(t, rows, 1, "%s: an empty cell is ABSENT, never a row of zeros", engine)
			toLane := int(cm["to"].(float64))
			require.Greater(t, toLane, prev, "%s: cells ascend strictly by `to`", engine)
			prev = toLane
			rowSums[int(om["from"].(float64))] += rows
			colSums[toLane] += rows
			total += rows
		}
	}
	for lane := 0; lane < 10; lane++ {
		require.Equal(t, from[lane], rowSums[lane],
			"%s lane %d: the cells leaving it must sum to its whole BEFORE population", engine, lane)
		require.Equal(t, tdTally(t, beforeHist, lane), from[lane],
			"%s lane %d: `from_rows` must BE the before histogram's own tally", engine, lane)
		require.Equal(t, to[lane], colSums[lane],
			"%s lane %d: the cells arriving in it must sum to its whole AFTER population", engine, lane)
		require.Equal(t, tdTally(t, afterHist, lane), to[lane],
			"%s lane %d: `to_rows` must BE the after histogram's own tally", engine, lane)
	}
	require.Equal(t, float64(total), tr["total_rows"], "%s: every cell together IS the grand total", engine)
	require.Equal(t, asMap(t, eng["before"])["accounts"], tr["measured_rows"],
		"%s: measured_rows IS before.accounts", engine)
	require.Equal(t, asMap(t, eng["after"])["accounts"], tr["measured_rows"])
	require.Equal(t, tr["total_rows"],
		tr["measured_rows"].(float64)+tr["unmeasured_rows"].(float64),
		"%s: total_rows is measured plus unmeasured, and nothing else", engine)
	require.Equal(t, tr["unmeasured_rows"],
		tr["unmeasured_refused_in_batch_rows"].(float64)+tr["unmeasured_excluded_by_this_layer_rows"].(float64),
		"%s: the cause split must SUM to the population it splits", engine)
	require.Equal(t, beforeHist["comparator"], tr["comparator"], "%s", engine)
}

// TestRunBookServesTheTransitionMatrix is the end-to-end weld on the standing P5
// book: a single Aave row crossing DOWN through 1.00, a Debt Manager row that
// holds its lane, and one unmeasured row per engine.
func TestRunBookServesTheTransitionMatrix(t *testing.T) {
	f := newP5Fixture(t)
	out := f.postJSON(t, "/v1/scenarios/eth_minus_10/run-book", runBookContractPath, http.StatusOK)
	engines := tdEngines(t, out)

	for name, eng := range engines {
		tdRequireMarginsAreTheHistograms(t, name, eng)
	}

	// --- AAVE: the crossing, visible as a CELL rather than as a difference ----
	aave := asMap(t, engines[risk.AaveEngine]["hf_transitions"])
	require.Equal(t, []int{0, 0, 0, 1, 0, 0, 0, 0, 0, 1}, tdInts(t, aave["from_rows"]),
		"HF 1.08 sits in lane 3 at par, and the refused batch row is in lane 9")
	require.Equal(t, []int{0, 1, 0, 0, 0, 0, 0, 0, 0, 1}, tdInts(t, aave["to_rows"]),
		"HF 0.972 after one 10% ETH step: lane 1")
	crossing := tdCell(t, aave, 3, 1)
	require.NotNil(t, crossing, "the crossing is an OCCUPIED CELL, not an inference from two bars")
	require.Equal(t, float64(1), crossing["rows"])
	require.NotNil(t, crossing["debt_before_usd"], "a measured row's debt is knowable on both sides")
	require.NotNil(t, crossing["debt_after_usd"])
	require.Equal(t, float64(1), aave["lane_changed_rows"], "one row changed lane on Aave")
	require.Equal(t, float64(0), aave["held_rows"])
	require.Equal(t, float64(2), aave["total_rows"])
	require.Equal(t, float64(1), aave["measured_rows"])

	// --- THE UNMEASURED ROW, ON EVERY ENGINE ---------------------------------
	for _, name := range []string{risk.AaveEngine, risk.DMEngine} {
		tr := asMap(t, engines[name]["hf_transitions"])
		require.Equal(t, float64(1), tr["unmeasured_rows"], "%s: one refused batch row", name)
		require.Equal(t, float64(1), tr["unmeasured_refused_in_batch_rows"],
			"%s: fxAaveRefused and fxDMRefused are both `Status: refused`, so this is riskd's own refusal", name)
		require.Equal(t, float64(0), tr["unmeasured_excluded_by_this_layer_rows"],
			"%s: this layer rebuilt everything it was given", name)
		cell := tdCell(t, tr, 9, 9)
		require.NotNil(t, cell, "%s: the unmeasured rows sit in the (9,9) cell", name)
		require.Equal(t, float64(1), cell["rows"])
		require.Nil(t, cell["debt_before_usd"],
			"%s: THIS RUN measured nothing for that row, so its debt is UNKNOWABLE here and never \"0\"", name)
		require.Nil(t, cell["debt_after_usd"])
	}
	// AND THE ROW IS NOT AN EMPTY ROW: /v1/positions publishes its persisted
	// debt, so a reader reconciling the two surfaces finds no contradiction.
	require.Equal(t, float64(2), asMap(t, out["coverage"])["refused_in_batch"],
		"both unmeasured rows are counted by the coverage field the matrix's note points at")

	// --- THE DEBT MANAGER HOLDS ITS LANE, and now says so explicitly ---------
	dm := asMap(t, engines[risk.DMEngine]["hf_transitions"])
	require.Equal(t, "hf_num/hf_den", dm["comparator"])
	require.Equal(t, []int{1, 0, 0, 0, 0, 0, 0, 0, 0, 1}, tdInts(t, dm["from_rows"]),
		"3200/4200 = 0.762 at par: below 0.90")
	require.Equal(t, []int{1, 0, 0, 0, 0, 0, 0, 0, 0, 1}, tdInts(t, dm["to_rows"]),
		"2880/4200 = 0.686 after: still below 0.90")
	require.Equal(t, float64(0), dm["lane_changed_rows"],
		"the finding the 1.6.0 test could only infer from two identical histograms is now STATED")
	require.Equal(t, float64(1), dm["held_rows"])
	held := tdCell(t, dm, 0, 0)
	require.NotNil(t, held)
	require.Equal(t, float64(1), held["rows"])

	// --- THE LANES ARE THE HISTOGRAM'S OWN BUCKETS ---------------------------
	lanes := asList(t, aave["lanes"])
	require.Len(t, lanes, 10)
	buckets := asList(t, asMap(t, asMap(t, engines[risk.AaveEngine]["before"])["hf_histogram"])["buckets"])
	for i, b := range buckets {
		l, bm := asMap(t, lanes[i]), asMap(t, b)
		require.Equal(t, float64(i), l["index"])
		require.Equal(t, "bucket", l["kind"])
		require.Equal(t, bm["label"], l["label"], "lane %d: the label is the histogram's own", i)
		require.Equal(t, bm["lower_wad"], l["lower_wad"])
		require.Equal(t, bm["upper_wad"], l["upper_wad"])
	}
	require.Equal(t, "infinite", asMap(t, lanes[8])["kind"])
	require.Equal(t, "no debt (unbounded)", asMap(t, lanes[8])["label"])
	require.Equal(t, "unmeasured", asMap(t, lanes[9])["kind"])
	require.Equal(t, "not measured", asMap(t, lanes[9])["label"])

	// --- THE NOTE CARRIES THE DISAMBIGUATIONS --------------------------------
	note := aave["note"].(string)
	require.Contains(t, note, "It is NOT `movers_total`")
	require.Contains(t, note, "NOT `newly_eligible_accounts`")
	require.Contains(t, note, "not a crossing count of any particular edge")
	require.Contains(t, note, "`from_rows` IS the before histogram")
	require.Contains(t, note, "A cell absent from `cells` holds ZERO rows")
	require.Contains(t, note, "It is not `coverage.batch_positions`")
	require.NotContains(t, note, "MEASURED NOTHING ON THIS ENGINE",
		"this engine measured a row, so the no-measurement disclosure must not appear")
}

// TestRunBookTransitionSplitsAnUnrebuildableRowFromARefusedOne drives the OTHER
// unmeasured cause through the real handler, which is the half the pure table
// structurally cannot supply.
//
// Every committed run-book fixture puts its unmeasured rows in the REFUSED
// cause: `fxAaveRefused` and `fxDMRefused` are both `Status: refused`, so
// TestRunBookServesTheTransitionMatrix above pins
// `unmeasured_excluded_by_this_layer_rows == 0` on both engines and could not
// distinguish two counts from one count copied into the first slot.
//
// The fixture is `seedMixedDirectionBatch`, whose four rows are all written
// COMPUTED with no refusals, and account A is then made unrebuildable by the
// committed mutation technique of TestLiqBonusMutationRefusesTheReconstruction:
// a liq_bonus that disagrees with the custodied param ledger, which reaches
// nothing the recomputation publishes and is caught only by the weld. The
// statement is scoped by (batch_id, engine, account, asset) and NOT by asset
// alone, because both `fxMDCollateralDown` rows carry a weETH collateral leg and
// an asset-scoped update would exclude two rows instead of one. The mutation
// touches no position count, so the batch stays servable.
//
// MUTATIONS THIS KILLS: building the two counts from anything the lane records
// carry (they carry no cause); serving one count and deriving the other by
// subtraction, which cannot tell 0+1 from 1+0; classifying by negation of
// `computed`; dropping the fail-closed sum guard.
func TestRunBookTransitionSplitsAnUnrebuildableRowFromARefusedOne(t *testing.T) {
	f := newP5Fixture(t)
	f.seedMixedDirectionBatch(t, "wave-w-tm-unrebuildable-1")

	// A CLEAN read first: the book must be whole before the mutation, or the
	// counts below would prove nothing about the split.
	clean := f.postJSON(t, "/v1/scenarios/eth_minus_30/run-book", runBookContractPath, http.StatusOK)
	cleanCov := asMap(t, clean["coverage"])
	require.Equal(t, float64(0), cleanCov["refused_in_batch"])
	require.Equal(t, float64(0), cleanCov["excluded_by_this_layer"])
	cleanAave := asMap(t, tdEngines(t, clean)[risk.AaveEngine]["hf_transitions"])
	require.Equal(t, float64(3), cleanAave["total_rows"])
	require.Equal(t, float64(0), cleanAave["unmeasured_rows"])

	// THE MUTATION: account A's weETH COLLATERAL leg only.
	tag, err := f.admin.Exec(f.ctx,
		`UPDATE risk_position_legs SET liq_bonus = $5::numeric
		  WHERE batch_id = $1 AND engine = $2 AND account = $3 AND asset = $4`,
		f.batchID, risk.AaveEngine, fxMDAcctDropsA.Bytes(), fxWeETHEth.Bytes(), "10501")
	require.NoError(t, err)
	require.EqualValues(t, 1, tag.RowsAffected(),
		"the statement must scope to ONE leg: an asset-scoped update would exclude two rows instead of one")

	out := f.postJSON(t, "/v1/scenarios/eth_minus_30/run-book", runBookContractPath, http.StatusOK)
	engines := tdEngines(t, out)
	aave := asMap(t, engines[risk.AaveEngine]["hf_transitions"])
	tdRequireMarginsAreTheHistograms(t, risk.AaveEngine, engines[risk.AaveEngine])

	// (1) THE SPLIT IS THE RECONSTRUCTION CAUSE, NOT THE REFUSAL CAUSE. A
	// classifier written as `p.Status != computed` reports 1 and 0 here and
	// fails; against every other fixture in the suite it passes.
	require.Equal(t, float64(0), aave["unmeasured_refused_in_batch_rows"],
		"riskd refused nothing in this batch: all four rows are written COMPUTED")
	require.Equal(t, float64(1), aave["unmeasured_excluded_by_this_layer_rows"],
		"THIS SERVICE could not verify the mutated row against the custodied param ledger")

	// (2) THE COVERAGE SURFACES THE COUNTS POINT AT ACTUALLY HOLD THE ROW. The
	// count that is 1 names the array that has 1 in it; the count that is 0
	// names the count that is 0.
	cov := asMap(t, out["coverage"])
	require.Equal(t, float64(0), cov["refused_in_batch"])
	require.Equal(t, float64(1), cov["excluded_by_this_layer"])
	excluded := asList(t, cov["excluded"])
	require.Len(t, excluded, 1)
	ex := asMap(t, excluded[0])
	require.Equal(t, risk.AaveEngine, ex["engine"])
	require.Equal(t, fxMDAcctDropsA.Hex(), ex["account"])
	require.Equal(t, refusalReconstruction, ex["code"])
	require.Contains(t, ex["reason"], "liquidation bonus")

	// (3) THE SPLIT SUMS, and the §4.4 construction guard is observed on the
	// wire: the whole unmeasured population is on the (9,9) cell with two nulls.
	require.Equal(t, float64(1), aave["unmeasured_rows"])
	require.Equal(t, 1, tdInts(t, aave["from_rows"])[9])
	require.Equal(t, 1, tdInts(t, aave["to_rows"])[9])
	cell := tdCell(t, aave, 9, 9)
	require.NotNil(t, cell)
	require.Equal(t, float64(1), cell["rows"])
	require.Nil(t, cell["debt_before_usd"])
	require.Nil(t, cell["debt_after_usd"])
	require.Len(t, asList(t, asMap(t, asList(t, aave["outflows"])[9])["cells"]), 1,
		"outflow 9 has exactly one cell, and it is the diagonal")

	// (4) THE REST OF THE MATRIX LOSES EXACTLY THAT ROW AND NO OTHER.
	require.Equal(t, float64(3), aave["total_rows"], "the row is still IN the matrix, in lane 9")
	require.Equal(t, float64(2), aave["measured_rows"])
	require.Equal(t, float64(3), cov["in_book"])
	require.NotNil(t, tdCell(t, aave, 3, 0), "B still crossed 3 -> 0")
	require.NotNil(t, tdCell(t, aave, 0, 3), "C still crossed 0 -> 3")
	require.Nil(t, tdCell(t, aave, 4, 0), "A is no longer measured, so its cell is gone")
	require.Equal(t, float64(0), aave["held_rows"])
	require.Equal(t, float64(2), aave["lane_changed_rows"])

	// THE DEBT MANAGER ROW IS UNTOUCHED, which also pins that a nil
	// *runUnmeasured reads as 0 and 0 rather than as a missing argument.
	dm := asMap(t, engines[risk.DMEngine]["hf_transitions"])
	require.Equal(t, float64(0), dm["unmeasured_rows"])
	require.Equal(t, float64(0), dm["unmeasured_refused_in_batch_rows"])
	require.Equal(t, float64(0), dm["unmeasured_excluded_by_this_layer_rows"])
	require.Equal(t, float64(1), dm["total_rows"])
	require.Equal(t, float64(1), dm["measured_rows"])
}

// TestRunBookTransitionSeparatesOffsettingMoves is THE WAVE'S REASON FOR
// EXISTING, over the committed mixed-direction book: two rows fall through 1.00
// and one rises past it, so the below-1.00 marginal moves by ONE while THREE
// rows change lane. Any "matrix" reconstructed from the two histograms fails
// this.
func TestRunBookTransitionSeparatesOffsettingMoves(t *testing.T) {
	f := newP5Fixture(t)
	f.seedMixedDirectionBatch(t, "wave-w-tm-offsetting-1")

	out := f.postJSON(t, "/v1/scenarios/eth_minus_30/run-book", runBookContractPath, http.StatusOK)
	engines := tdEngines(t, out)
	eng := engines[risk.AaveEngine]
	require.NotNil(t, eng, "eth_minus_30 covers the Aave engine")
	tdRequireMarginsAreTheHistograms(t, risk.AaveEngine, eng)
	tr := asMap(t, eng["hf_transitions"])

	// (1) THE OFFSETTING MOVES.
	from, to := tdInts(t, tr["from_rows"]), tdInts(t, tr["to_rows"])
	require.Equal(t, []int{1, 0, 0, 1, 1, 0, 0, 0, 0, 0}, from,
		"C at 0.74375 (lane 0), B at 1.08 (lane 3), A at 1.20 (lane 4)")
	require.Equal(t, []int{2, 0, 0, 1, 0, 0, 0, 0, 0, 0}, to,
		"A at 0.84 and B at 0.756 (lane 0), C at 1.0625 (lane 3)")
	belowOneDelta := (to[0] + to[1]) - (from[0] + from[1])
	require.Equal(t, 1, belowOneDelta,
		"the below-1.00 MARGINAL moves by exactly one: the number two histograms can produce")
	require.Equal(t, float64(3), tr["lane_changed_rows"],
		"THE POINT: three rows changed lane, and the marginal difference cannot see that")
	require.Equal(t, float64(0), tr["held_rows"])
	require.NotEqual(t, float64(belowOneDelta), tr["lane_changed_rows"],
		"a net that equalled the gross would make this book prove nothing")

	aToZero := tdCell(t, tr, 4, 0)
	bToZero := tdCell(t, tr, 3, 0)
	cToThree := tdCell(t, tr, 0, 3)
	require.NotNil(t, aToZero, "A: 1.20 -> 0.84")
	require.NotNil(t, bToZero, "B: 1.08 -> 0.756")
	require.NotNil(t, cToThree, "C: 0.74375 -> 1.0625, the move that cancels one of the others in the marginal")
	for _, c := range []map[string]any{aToZero, bToZero, cToThree} {
		require.Equal(t, float64(1), c["rows"])
	}

	// (2) DEBT IS SUMMED PER SIDE, NOT PER LANE — and the two sides genuinely
	// DIFFER on this book, so a mutation collapsing them fails rather than
	// passing vacuously.
	require.Equal(t, "800000000000", cToThree["debt_before_usd"],
		"C borrows weETH: 2e18 at $4,000 = 8,000.00")
	require.Equal(t, "560000000000", cToThree["debt_after_usd"],
		"eth_minus_30 re-prices weETH at 70/100, so C's PRICED debt falls to 5,600.00")
	require.NotEqual(t, cToThree["debt_before_usd"], cToThree["debt_after_usd"],
		"THE TWO-FIGURE DESIGN, falsifiable here and nowhere else in the suite")
	for _, c := range []map[string]any{aToZero, bToZero} {
		require.Equal(t, c["debt_before_usd"], c["debt_after_usd"],
			"A and B borrow USDC, which this scenario holds flat")
	}

	sumBefore, sumAfter := new(big.Int), new(big.Int)
	for _, o := range asList(t, tr["outflows"]) {
		for _, c := range asList(t, asMap(t, o)["cells"]) {
			cm := asMap(t, c)
			if cm["debt_before_usd"] != nil {
				sumBefore.Add(sumBefore, bi(cm["debt_before_usd"].(string)))
			}
			if cm["debt_after_usd"] != nil {
				sumAfter.Add(sumAfter, bi(cm["debt_after_usd"].(string)))
			}
		}
	}
	require.Equal(t, asMap(t, eng["before"])["total_debt_usd"], sumBefore.String(),
		"the non-null debt_before_usd figures reconcile EXACTLY against the engine's own served total")
	require.Equal(t, asMap(t, eng["after"])["total_debt_usd"], sumAfter.String())
	require.Equal(t, "1640000000000", sumBefore.String())
	require.Equal(t, "1400000000000", sumAfter.String())

	// (3) A LANE CHANGE IS NOT A MOVER. Four numbers about the same three rows,
	// read off ONE engine row of ONE response, and no two of them agree.
	require.Equal(t, float64(2), eng["movers_total"], "strict health-factor drops only: C rose")
	require.Equal(t, float64(1), eng["newly_eligible_accounts"], "a signed net: 2 eligible after minus 1 before")
	require.Equal(t, float64(3), tr["lane_changed_rows"])
	require.Equal(t, 1, belowOneDelta)
	require.Contains(t, tr["note"], "It is NOT `movers_total`")
	require.Contains(t, tr["note"], "NOT `newly_eligible_accounts`")

	// (4) COVERAGE ON THIS BOOK. `refused_in_batch: 0` becomes PINNED here; the
	// 1.6.0 mixed-direction test asserts the other three and not that one.
	cov := asMap(t, out["coverage"])
	require.Equal(t, float64(4), cov["batch_positions"])
	require.Equal(t, float64(4), cov["in_book"])
	require.Equal(t, float64(0), cov["refused_in_batch"])
	require.Equal(t, float64(0), cov["excluded_by_this_layer"])
	require.Equal(t, float64(0), tr["unmeasured_rows"])
}

// seedWithheldOverStandardBook writes the `run-book.weeth-withheld` shape: the
// STANDING four-position book with the Aave aggregate carrying the
// custody-unproven refusal.
//
// It exists because `seedWithheldBatch` writes a withheld Aave aggregate with
// ZERO positions behind it, while the web fixture the coincidence below is drawn
// from is the four-position `fxPositions` book. Withholding an engine that has
// rows is the whole point: those rows are inside `coverage.in_book` and inside
// no matrix.
func (f *apiFixture) seedWithheldOverStandardBook(t *testing.T, key string) {
	t.Helper()
	w := fxBatchWrite(key)
	for i := range w.Aggregates {
		if w.Aggregates[i].Engine != risk.AaveEngine {
			continue
		}
		w.Aggregates[i].RefusalCode = riskfeed.GateFlagCustodyUnproven
		w.Aggregates[i].RefusalDetail = fxWithheldDetail
	}
	id, err := f.store.WriteRiskBatch(f.ctx, w)
	require.NoError(t, err)
	require.Positive(t, id)
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found, "a withheld ENGINE must not make the batch unservable")
	require.Equal(t, id, batch.ID)
	require.Equal(t, []string{risk.AaveEngine}, batch.RefusedEngines)
	f.batchID = id
}

// TestRunBookTransitionOnAWithheldEngineBookIsACoincidence asserts an EQUALITY
// and names it a coincidence. It is NOT the anti-regression.
//
// `coverage.in_book` differs from `Σ_engines total_rows` for two reasons that
// push in OPPOSITE directions: a withheld engine's rebuildable rows are inside
// `in_book` with no `engines[]` entry at all, and every engine's unmeasured rows
// are inside `total_rows` and outside `in_book`. On this book the two cancel
// exactly, so an implementation that made `total_rows` a book-wide count would
// pass here — which is why TestRunBookTotalRowsIsNotCoverageInBook exists beside
// it.
func TestRunBookTransitionOnAWithheldEngineBookIsACoincidence(t *testing.T) {
	f := newP5Fixture(t)
	f.seedWithheldOverStandardBook(t, "wave-w-tm-withheld-1")

	out := f.postJSON(t, "/v1/scenarios/eth_minus_10/run-book", runBookContractPath, http.StatusOK)
	engines := tdEngines(t, out)
	require.NotContains(t, engines, risk.AaveEngine,
		"a withheld engine contributes NO engines[] row, so it has no matrix at all")
	require.Contains(t, engines, risk.DMEngine)
	excludedEngines := asList(t, out["excluded_engines"])
	require.Len(t, excludedEngines, 1)
	require.Equal(t, risk.AaveEngine, asMap(t, excludedEngines[0])["engine"])

	dm := asMap(t, engines[risk.DMEngine]["hf_transitions"])
	tdRequireMarginsAreTheHistograms(t, risk.DMEngine, engines[risk.DMEngine])

	sum := 0.0
	for _, eng := range engines {
		sum += asMap(t, eng["hf_transitions"])["total_rows"].(float64)
	}
	cov := asMap(t, out["coverage"])
	require.Equal(t, float64(2), cov["in_book"])
	require.Equal(t, float64(2), sum,
		"THE TWO 2s ARE NOT THE SAME 2. `in_book` 2 is one WITHHELD-Aave rebuildable row plus one Debt Manager "+
			"rebuildable row; Σ total_rows 2 is one Debt Manager MEASURED row plus one Debt Manager UNMEASURED row. "+
			"The withheld engine's row (inside in_book, in no matrix) and the DM engine's unmeasured row (in the "+
			"matrix, outside in_book) cancel exactly on this book, which is why this equality is evidence of nothing.")
	require.Equal(t, float64(1), dm["measured_rows"], "the decomposition, stated rather than left to the sum")
	require.Equal(t, float64(1), dm["unmeasured_rows"])
	require.Equal(t, float64(2), dm["total_rows"])
	require.Equal(t, float64(4), cov["batch_positions"],
		"and neither number is batch_positions, which counts the whole batch")
}

// TestRunBookTotalRowsIsNotCoverageInBook is the FALSIFIABLE anti-regression the
// coincidence above cannot be. Three rebuildable Aave rows sit behind a withheld
// engine, so `coverage.in_book` is 4 while `engines[]` carries the Debt Manager
// alone with `total_rows` 1.
//
// 4 does not equal 1, the gap is exactly the three withheld rows, and this fails
// the moment anyone makes `total_rows` a book-wide count or sums it across
// engines against `in_book`.
func TestRunBookTotalRowsIsNotCoverageInBook(t *testing.T) {
	f := newP5Fixture(t)
	f.seedAaveUSDCParams(t)

	w := fxMixedDirectionBatchWrite("wave-w-tm-total-rows-1")
	for i := range w.Aggregates {
		if w.Aggregates[i].Engine != risk.AaveEngine {
			continue
		}
		// Positions stay 3, so the aggregate-sum conjunct still holds and the
		// batch is servable: it is the ENGINE that is withheld, not the book.
		w.Aggregates[i].RefusalCode = riskfeed.GateFlagCustodyUnproven
		w.Aggregates[i].RefusalDetail = fxWithheldDetail
	}
	id, err := f.store.WriteRiskBatch(f.ctx, w)
	require.NoError(t, err)
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, id, batch.ID)
	f.batchID = id

	out := f.postJSON(t, "/v1/scenarios/eth_minus_30/run-book", runBookContractPath, http.StatusOK)
	engines := tdEngines(t, out)
	require.NotContains(t, engines, risk.AaveEngine)
	require.Len(t, engines, 1, "only the Debt Manager survives as an engines[] row")

	dm := asMap(t, engines[risk.DMEngine]["hf_transitions"])
	cov := asMap(t, out["coverage"])
	require.Equal(t, float64(4), cov["in_book"],
		"three rebuildable Aave rows plus one Debt Manager row, none refused")
	require.Equal(t, float64(1), dm["total_rows"])
	require.Equal(t, float64(0), dm["unmeasured_rows"])
	require.NotEqual(t, cov["in_book"], dm["total_rows"],
		"THE ANTI-REGRESSION: total_rows is a PER-ENGINE number and the gap is exactly the three withheld rows")

	sum := 0.0
	for _, eng := range engines {
		sum += asMap(t, eng["hf_transitions"])["total_rows"].(float64)
	}
	require.Equal(t, float64(1), sum)
	require.NotEqual(t, cov["in_book"], sum,
		"and summing across engines does not recover in_book either")
	require.Contains(t, dm["note"], "summing it across engines does not give `coverage.in_book`",
		"the note must say in prose what this test pins in arithmetic")
}

// TestRunBookTransitionRefusesAnUnclassifiableUnmeasuredRow is the fail-closed
// arm observed END TO END: a row that reached no arithmetic and matches NEITHER
// coverage predicate is a named 500, never a count pointing at a coverage
// surface that does not hold it.
//
// `risk_positions.status` carries no CHECK constraint, so a third token is
// writable straight into the column — which is exactly why the serving layer
// must not sweep it into either count.
func TestRunBookTransitionRefusesAnUnclassifiableUnmeasuredRow(t *testing.T) {
	f := newP5Fixture(t)

	// The clean book serves, so the 500 below is the mutation's doing.
	f.postJSON(t, "/v1/scenarios/eth_minus_10/run-book", runBookContractPath, http.StatusOK)

	tag, err := f.admin.Exec(f.ctx,
		`UPDATE risk_positions SET status = 'quarantined'
		  WHERE batch_id = $1 AND engine = $2 AND status = $3`,
		f.batchID, risk.AaveEngine, store.RiskPositionRefused)
	require.NoError(t, err)
	require.EqualValues(t, 1, tag.RowsAffected())

	status, body := f.post(t, "/v1/scenarios/eth_minus_10/run-book")
	require.Equal(t, http.StatusInternalServerError, status,
		"a status token in neither coverage vocabulary must REFUSE, not be counted as one of them")
	require.Contains(t, string(body), "reached no arithmetic with status")
	require.Contains(t, string(body), "neither coverage.refused_in_batch nor")
}
