package main

// hf_transitions — the run-book's BEFORE-to-AFTER transition matrix, contract
// 1.7.0. Additive: one new field per `engines[]` row, computed at SERVE TIME
// from rows this handler already walked. Nothing persisted changes and this file
// issues no SQL.
//
// # Why the server has to compute it
//
// The run-book already carries `before.hf_histogram` and `after.hf_histogram`
// per engine. Two MARGINALS DO NOT DETERMINE A JOINT: a row that fell below 1.00
// and another that rose above it cancel exactly in a marginal difference, and no
// client-side arithmetic can separate them. `movers` does not close it either —
// it is capped at 20 and ranked by drop magnitude on Aave or by an eligibility
// flip on the Debt Manager, rather than by lane change, and on Aave it
// structurally excludes every account whose health factor rose. A flow picture
// drawn from marginals plus a truncated top-20 would be a picture the server
// never computed.
//
// So the joint is computed HERE, in the one place that holds both sides of the
// same position row in the same request.

import (
	"fmt"
	"math/big"
	"strconv"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// runUnmeasured is ONE engine's record of the position rows that reached NO
// arithmetic in this run, split by the CAUSE that kept them out.
//
// The split exists because the two causes land on two DIFFERENT coverage
// surfaces, and a per-engine count that named the wrong one would point a reader
// at a surface that does not hold its rows. This record is the ONLY carrier of
// that split on the whole data path: `runLaneEntry` is deliberately cause-blind
// (a cause field there would sit on every MEASURED entry too, where it has no
// meaning), and the both-sides fold copies only the account.
type runUnmeasured struct {
	accounts            []common.Address
	refusedInBatch      int // riskd refused: counted by coverage.refused_in_batch
	excludedByThisLayer int // this layer could not rebuild: listed in coverage.excluded
}

type unmeasuredCause int

const (
	unmeasuredRefusedInBatch unmeasuredCause = iota + 1
	unmeasuredExcludedByThisLayer
)

// classifyUnmeasured names WHY one row reached no arithmetic. It is a PURE
// function, deliberately, so all three of its arms are testable with no database
// and no http.ResponseWriter.
//
// EACH LIVE ARM IS THE POSITIVE PREDICATE OF THE COVERAGE COUNTER IT POINTS AT,
// not the negation of the other one. coverage() increments RefusedInBatch on
// `p.Status == store.RiskPositionRefused` and ExcludedByThisLayer on
// `p.reconstructionErr != ""`, so these two arms must be those same tests.
//
// The negation would be cheaper and it would be wrong. `risk_positions.status`
// carries NO CHECK constraint — migration 00013 documents the vocabulary in a
// comment only — so `p.Status != computed` silently absorbs any third token the
// schema permits, counts it as refused-in-batch, and serves a note telling the
// reader to find the row in `coverage.refused_in_batch`, which is incremented on
// `== refused` and therefore would not contain it. That is a served count
// pointing at a surface that does not hold its rows.
//
// The two live arms are exhaustive over today's data, and the reason is
// checkable: `reconstructAll` sets `reconstructionErr` only on rows it
// attempted, and it attempts only `Status == computed` rows. The default arm is
// what keeps the served pointer honest if that ever stops being true, and it
// fires as a named 500 rather than as a wrong count.
func classifyUnmeasured(engine string, account common.Address, status, reconstructionErr string) (unmeasuredCause, error) {
	switch {
	case status == store.RiskPositionRefused && reconstructionErr == "":
		return unmeasuredRefusedInBatch, nil
	case status == store.RiskPositionComputed && reconstructionErr != "":
		return unmeasuredExcludedByThisLayer, nil
	default:
		return 0, fmt.Errorf("run-book: %s account %s reached no arithmetic with status %q "+
			"and reconstruction error %q; it is in neither coverage.refused_in_batch nor "+
			"coverage.excluded, so no per-engine count on this response could name a "+
			"surface that actually holds it",
			engine, account.Hex(), sanitize(status), sanitize(reconstructionErr))
	}
}

// runBookTransitions builds ONE engine's before-to-after joint distribution over
// the lane vocabulary its two histograms are already stated in.
//
// # Pairing is POSITIONAL, and that is the whole design
//
// `beforeInputs` and `afterInputs` are index-aligned by construction:
// `afterInputs` is built 1:1 from `run` in the same order (or IS `beforeInputs`
// on a projection), and `ApplyScenario` neither reorders nor drops. So the two
// per-engine lane slices are index-aligned too, and pairing by index makes
// MARGINAL AGREEMENT TRUE BY CONSTRUCTION rather than asserted about it. The
// account equality check at each index is the guard against a future refactor
// that filters one side.
//
// # `u` is the cause split, and nil is a legal book
//
// Nothing else on the data path carries a cause, so the per-engine record
// `classifyUnmeasured` filled is what this builder is handed. A nil record means
// this engine folded no unmeasured row: it reads as 0 and 0, not as a missing
// argument. The sum is RE-CHECKED against the lane-N+1 population this function
// actually placed, so the two served counts are derivations rather than
// restatements, and a fold the classifier never saw fails closed.
//
// Every refusal here is a defect in this layer or a violation of a database
// constraint, never a property of the data. It never degrades to a matrix with
// wrong margins.
func runBookTransitions(engine string, before, after *runMeasure, dec uint8, u *runUnmeasured) (wireRunBookTransitions, error) {
	if len(before.lanes) != len(after.lanes) {
		return wireRunBookTransitions{}, fmt.Errorf(
			"%s: %d before-lane records against %d after-lane records; the two sides "+
				"measured different books and a matrix over them would have margins "+
				"neither histogram supports", engine, len(before.lanes), len(after.lanes))
	}

	// Dense accumulators: laneCount is 10, so this is 100 cells whether the book
	// holds 4 positions or 400,000. No map reaches the wire, so two runs of one
	// batch serve byte-identical bytes with no sort anywhere.
	rows := make([][]int, laneCount)
	debtBefore := make([][]*big.Int, laneCount)
	debtAfter := make([][]*big.Int, laneCount)
	for i := range rows {
		rows[i] = make([]int, laneCount)
		debtBefore[i] = make([]*big.Int, laneCount)
		debtAfter[i] = make([]*big.Int, laneCount)
	}

	// ONE PASS, carrying three obligations: the zip, the positional account
	// guard, and the distinctness check over EVERY row the matrix places —
	// measured entries and unmeasured ones alike. `len(states) == accounts`
	// could not do the last of those: both of those fields are written only
	// inside measureRunBook, and the unmeasured rows never touch either.
	seen := make(map[common.Address]struct{}, len(before.lanes))
	unmeasuredRows := 0
	for k, b := range before.lanes {
		a := after.lanes[k]
		if b.account != a.account {
			return wireRunBookTransitions{}, fmt.Errorf(
				"%s: position row %d is account %s on the before side and account %s on the after "+
					"side; the two sides are index-aligned by construction, so a mismatch means one "+
					"of them was filtered and a joint distribution over them would be a fiction",
				engine, k, b.account.Hex(), a.account.Hex())
		}
		if _, dup := seen[b.account]; dup {
			return wireRunBookTransitions{}, fmt.Errorf(
				"%s: account %s appears in more than one position row of this batch; the "+
					"row-level matrix and the account-level movers list would count different "+
					"things and neither could be read against the other",
				engine, b.account.Hex())
		}
		seen[b.account] = struct{}{}

		if b.lane < 0 || b.lane >= laneCount || a.lane < 0 || a.lane >= laneCount {
			return wireRunBookTransitions{}, fmt.Errorf(
				"%s: account %s was placed in lane %d before and lane %d after, and this "+
					"vocabulary has %d lanes; a row outside it would be in no margin and in no cell",
				engine, b.account.Hex(), b.lane, a.lane, laneCount)
		}
		rows[b.lane][a.lane]++
		if b.lane == laneUnmeasured {
			unmeasuredRows++
		}
		// The two debt figures are derived PER SIDE, each from the row's own
		// computation on that side, and never from the lane. A nil contributes
		// nothing and leaves the cell's figure nil, which is what makes the
		// unmeasured cell's two debts null rather than "0".
		if b.debtUSD != nil {
			if debtBefore[b.lane][a.lane] == nil {
				debtBefore[b.lane][a.lane] = new(big.Int)
			}
			debtBefore[b.lane][a.lane].Add(debtBefore[b.lane][a.lane], b.debtUSD)
		}
		if a.debtUSD != nil {
			if debtAfter[b.lane][a.lane] == nil {
				debtAfter[b.lane][a.lane] = new(big.Int)
			}
			debtAfter[b.lane][a.lane].Add(debtAfter[b.lane][a.lane], a.debtUSD)
		}
	}

	// THE CAUSE SPLIT IS CHECKED AGAINST THE POPULATION THE MATRIX PLACED, not
	// against the number the handler believes it folded.
	refusedInBatch, excludedByThisLayer := 0, 0
	if u != nil {
		refusedInBatch, excludedByThisLayer = u.refusedInBatch, u.excludedByThisLayer
	}
	if refusedInBatch+excludedByThisLayer != unmeasuredRows {
		return wireRunBookTransitions{}, fmt.Errorf(
			"%s: %d unmeasured rows in the matrix against a cause split of %d refused-in-batch "+
				"plus %d excluded-by-this-layer; serving that split would point a per-engine "+
				"count at a coverage surface that does not hold those rows",
			engine, unmeasuredRows, refusedInBatch, excludedByThisLayer)
	}

	fromRows := make([]int, laneCount)
	toRows := make([]int, laneCount)
	total := 0
	for i := range rows {
		for j, n := range rows[i] {
			fromRows[i] += n
			toRows[j] += n
			total += n
		}
	}

	// The movement partition is over the MEASURED rows only: the diagonal runs
	// across lanes 0..N and excludes the unmeasured lane entirely, so the
	// (N+1, N+1) cell can never be counted as "held".
	held, changed := 0, 0
	for i := 0; i < laneUnmeasured; i++ {
		for j, n := range rows[i] {
			if i == j {
				held += n
				continue
			}
			changed += n
		}
	}

	comparator, _ := histogramComparator(engine)
	out := wireRunBookTransitions{
		Comparator:                        comparator,
		WadScale:                          risk.WadUnit().String(),
		Lanes:                             runBookTransitionLanes(),
		Outflows:                          make([]wireRunBookTransitionOutflow, 0, laneCount),
		FromRows:                          fromRows,
		ToRows:                            toRows,
		TotalRows:                         total,
		MeasuredRows:                      total - unmeasuredRows,
		UnmeasuredRows:                    unmeasuredRows,
		UnmeasuredRefusedInBatchRows:      refusedInBatch,
		UnmeasuredExcludedByThisLayerRows: excludedByThisLayer,
	}
	for i := 0; i < laneCount; i++ {
		of := wireRunBookTransitionOutflow{From: i, Cells: []wireRunBookTransitionCell{}}
		for j := 0; j < laneCount; j++ {
			if rows[i][j] == 0 {
				// SPARSE: an empty cell is ABSENT, never a row of zeros. The
				// absence is a knowable zero only because both margins and the
				// whole lane vocabulary are served densely beside it.
				continue
			}
			c := wireRunBookTransitionCell{To: j, Rows: rows[i][j]}
			if v := debtBefore[i][j]; v != nil {
				s := v.String()
				c.DebtBeforeUSD = &s
			}
			if v := debtAfter[i][j]; v != nil {
				s := v.String()
				c.DebtAfterUSD = &s
			}
			of.Cells = append(of.Cells, c)
		}
		out.Outflows = append(out.Outflows, of)
	}
	// NULL, NEVER ZERO, over a book this run never measured: "0 rows held" would
	// claim a measurement nobody made. This is the guard `labRunBookLines.ts`
	// already applies client-side, moved to the server where a client cannot
	// forget it.
	if out.MeasuredRows > 0 {
		out.HeldRows, out.LaneChangedRows = &held, &changed
	}
	out.Note = runBookTransitionNote(dec, out.MeasuredRows)
	return out, nil
}

// runBookTransitionLanes is the lane vocabulary: the histogram's OWN buckets,
// built by the SAME edge walk and the SAME edgeWad the histogram uses, plus the
// two tallies that sit beside them. An edge that moves moves in both places at
// once, because there is only one edge table.
func runBookTransitionLanes() []wireRunBookTransitionLane {
	out := make([]wireRunBookTransitionLane, 0, laneCount)
	var lower *string
	for i, e := range histogramEdges {
		l := wireRunBookTransitionLane{Index: i, Kind: laneKindBucket, Label: e.label, LowerWad: lower}
		if e.upper != 0 {
			u := edgeWad(e.upper).String()
			l.UpperWad = &u
			lower = &u
		}
		out = append(out, l)
	}
	// Both edges null on both: an unbounded health factor is not a large number,
	// and a row nobody measured has no health factor to bound.
	out = append(out,
		wireRunBookTransitionLane{Index: laneInfinite, Kind: laneKindInfinite, Label: "no debt (unbounded)"},
		wireRunBookTransitionLane{Index: laneUnmeasured, Kind: laneKindUnmeasured, Label: "not measured"},
	)
	return out
}

// runBookTransitionNote is the server-composed disclosure. Every sentence here
// is a sentence the contract's CAPTURED example carries verbatim, so the note
// and the document cannot drift.
func runBookTransitionNote(dec uint8, measured int) string {
	lastBucket := strconv.Itoa(len(histogramEdges) - 1)
	inf := strconv.Itoa(laneInfinite)
	un := strconv.Itoa(laneUnmeasured)

	note := "ROWS ARE THE BEFORE LANE AND COLUMNS ARE THE AFTER LANE, over the POSITION ROWS of this engine in this run. " +
		"Every count here counts rows, the same unit `coverage.batch_positions` uses, never distinct addresses; on this batch one row IS one account on this engine, " +
		"and the server CHECKED that over every row in this matrix, measured and unmeasured alike, rather than assuming it. " +

		"Lanes 0 to " + lastBucket + " are the SAME buckets, on the SAME comparator and the SAME edges, that the two `hf_histogram`s beside them serve. " +
		"Lane " + inf + " is rows with NO DEBT, unbounded and never a bucket, and IS `infinite_count`'s population. " +
		"Lane " + un + " is rows this run measured on NEITHER side, and IS `refused_count`'s population. " +

		"`from_rows` IS the before histogram and `to_rows` IS the after histogram, lane for lane: a weld, not a hope. " +

		"A cell absent from `cells` holds ZERO rows. The dense `lanes`, `outflows`, `from_rows` and `to_rows` arrays are what make that omission complete. " +

		"Lane " + un + "'s rows reached no arithmetic here: `unmeasured_refused_in_batch_rows` of them riskd refused (counted in `coverage.refused_in_batch`, and served per row with its refusal code by `/v1/positions` and `/v1/address/{addr}`), " +
		"and `unmeasured_excluded_by_this_layer_rows` of them this service could not rebuild or verify (listed per row in `coverage.excluded`). " +
		"Their persisted numbers still exist on those surfaces. THIS RUN measured none of them, which is why their cell's two debts are null and never \"0\". " +

		"Debt is in THIS engine's own " + strconv.Itoa(int(dec)) + "-decimal unit and is never summed with another engine's. " +
		"The two sides are SEPARATE figures because Aave's debt is a PRICED sum a shock can move, while the Debt Manager's is USD-normalized and copied across the shock unchanged. " +
		"A no-debt row's \"0\" is a knowable zero; a null is an unknowable. " +

		"`lane_changed_rows` counts rows whose LANE changed. A move of any size INSIDE one lane is not counted and a move of one wei across an edge is, so it follows the histogram's edges rather than the scenario's magnitude. " +
		"It is NOT `movers_total` (Aave ranks strict health-factor drops; the Debt Manager counts eligibility flips) and NOT `newly_eligible_accounts` (a signed net), and it is not a crossing count of any particular edge: derive that from the cells. " +

		"Under this scenario no row can enter or leave lane " + inf + " or lane " + un + ", so every lane change here is between buckets. " +

		"On the Debt Manager these lanes are the exact rational maxBorrowLT/borrowings, a DISCLOSURE and not the liquidation verdict: take eligibility from `newly_eligible_accounts` and `movers`. " +

		"When `measured_rows` is 0 both `held_rows` and `lane_changed_rows` are NULL rather than 0, because a zero there would claim a measurement nobody made. " +

		"`total_rows` is THIS ENGINE's whole book in this run. It is not `coverage.batch_positions`, which counts the whole batch including engines this scenario does not cover, " +
		"and summing it across engines does not give `coverage.in_book`: a withheld engine's rebuildable rows are inside `coverage.in_book` with no `engines[]` entry at all, " +
		"and this engine's unmeasured rows are inside `total_rows` and outside `coverage.in_book`. The two differences can cancel on a given book, so an equality seen once is not a law."

	if measured == 0 {
		note += " MEASURED NOTHING ON THIS ENGINE: this run measured no row here, so the two movement counts are null and no statement about movement is made."
	}
	return note
}
