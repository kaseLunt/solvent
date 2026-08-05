package main

// Wave W-TM — the run-book's BEFORE-to-AFTER transition matrix (contract
// 1.7.0), and the laws that keep it honest. NO DATABASE: every book here is a
// pair of `runMeasure`s constructed in memory, or the pure library called
// directly.
//
// # Why this file has no seed in it
//
// `cmd/api` splits every suite into a pure half and a database half by
// filename, and the split is load-bearing rather than stylistic: every
// `apiFixture` construction SKIPS the whole test when `TEST_DATABASE_URL` is
// unset (fixture_db_test.go:53). A fixture-driven law placed here would not
// fail without a database — it would silently skip, which is worse. So the
// three laws that genuinely need a seeded book (the end-to-end matrix, the
// unrebuildable/refused split, and the offsetting-moves anti-regression) live
// in p5_runbook_transition_db_test.go, where they will actually run.
//
// Each law below is written so that ONE named mutation fails it:
//
//	bucketing the matrix on its own edge table      -> TestRunBookTransitionsAgreeWithBothMarginals
//	dropping unmeasured rows from the joint         -> TestRunBookTransitionsAgreeWithBothMarginals
//	a row in two cells or in none                   -> TestRunBookTransitionCountsPartitionTheRun
//	"0 rows held" over a book nobody measured       -> TestRunBookTransitionHoldsNoOpinionWhenNothingWasMeasured
//	classifying the unmeasured by NEGATION          -> TestRunBookTransitionUnmeasuredSplitUsesTheCoverageCountersOwnPredicates
//	a measured row's debt hidden behind a null      -> TestRunBookTransitionLaneNPlusOneHoldsOnlyUnmeasuredRows
//	one debt figure copied into both sides          -> TestRunBookTransitionDebtReconcilesPerSide
//	a knowable zero rendered as an unknowable       -> TestRunBookTransitionInfiniteLaneDebtIsAKnowableZero
//	a covered engine silently in zero cells         -> TestRunBookMeasureRefusesAnEngineItHasNoArmFor
//	inheriting the primary key as an assumption     -> TestRunBookTransitionRefusesTwoRowsForOneAccount

import (
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// The in-memory book builder
// ---------------------------------------------------------------------------

// tmRow is ONE position row of an in-memory book. A row whose `before` is nil is
// UNMEASURED: it reached no arithmetic on either side, exactly like a row the
// handler folds onto both histograms.
type tmRow struct {
	acct   common.Address
	before *runAccountState
	after  *runAccountState
	// excluded selects WHICH cause an unmeasured row carries: false is riskd's
	// own refusal (coverage.refused_in_batch), true is this layer's
	// reconstruction failure (coverage.excluded).
	excluded bool
}

// tmBook is a whole engine-side book, built the way the handler builds one:
// measured rows through `place` (the single statement that writes the histogram
// tally and the lane record together), then the unmeasured rows through the
// handler's own both-sides fold. Building it any other way would test a data
// path production does not have.
type tmBook struct {
	engine string
	rows   []tmRow
}

func (b tmBook) build(t *testing.T) (*runMeasure, *runMeasure, *runUnmeasured) {
	t.Helper()
	before, after := newRunMeasure(), newRunMeasure()
	var u *runUnmeasured

	for _, r := range b.rows {
		if r.before == nil {
			continue
		}
		r.before.account, r.after.account = r.acct, r.acct
		before.accounts++
		after.accounts++
		// `states` is written beside the tally exactly as measureRunBook writes
		// it, so `len(states) == accounts` holds here for the same reason it
		// holds in production — which is what makes the duplicate-account law
		// below a statement about the WHOLE population rather than about a
		// builder that happened to leave the maps empty.
		before.states[r.acct] = r.before
		after.states[r.acct] = r.after
		require.NoError(t, before.place(b.engine, r.before))
		require.NoError(t, after.place(b.engine, r.after))
	}
	for _, r := range b.rows {
		if r.before != nil {
			continue
		}
		if u == nil {
			u = &runUnmeasured{}
		}
		before.refused++
		after.refused++
		before.lanes = append(before.lanes, runLaneEntry{account: r.acct, lane: laneUnmeasured})
		after.lanes = append(after.lanes, runLaneEntry{account: r.acct, lane: laneUnmeasured})
		u.accounts = append(u.accounts, r.acct)
		if r.excluded {
			u.excludedByThisLayer++
			continue
		}
		u.refusedInBatch++
	}
	return before, after, u
}

func (b tmBook) transitions(t *testing.T) wireRunBookTransitions {
	t.Helper()
	before, after, u := b.build(t)
	tr, err := runBookTransitions(b.engine, before, after, tmDecimals(b.engine), u)
	require.NoError(t, err)
	return tr
}

func tmDecimals(engine string) uint8 {
	if engine == risk.AaveEngine {
		return 8
	}
	return 6
}

// aaveAt is one measured Aave state at a health-factor wad, carrying the debt
// this run computed for it on that side.
func aaveAt(hfWad, debt string) *runAccountState {
	return &runAccountState{hfWad: bi(hfWad), debtUSD: bi(debt)}
}

// dmAt is one measured Debt Manager state at the exact rational
// maxBorrowLT/borrowings — the disclosure its buckets are stated on.
func dmAt(num, den, debt string) *runAccountState {
	return &runAccountState{hfNum: bi(num), hfDen: bi(den), debtUSD: bi(debt)}
}

// noDebt is a measured row with NO debt: unbounded, never a bucket, and its "0"
// on both sides is a KNOWABLE zero.
func noDebt() *runAccountState {
	return &runAccountState{infinite: true, debtUSD: bi("0")}
}

// The health-factor wads of the committed mixed-direction book
// (seedMixedDirectionBatch under eth_minus_30), restated here as the shape the
// pure laws exercise. The DB-backed twin drives the same book through the real
// handler.
const (
	tmAHFBefore = "1200000000000000000" // A: 1.20, lane 4
	tmAHFAfter  = "840000000000000000"  // A: 0.84, lane 0
	tmBHFBefore = "1080000000000000000" // B: 1.08, lane 3
	tmBHFAfter  = "756000000000000000"  // B: 0.756, lane 0
	tmCHFBefore = "743750000000000000"  // C: 0.74375, lane 0
	tmCHFAfter  = "1062500000000000000" // C: 1.0625, lane 3

	// The debts, in the engine's 8-decimal unit. A and B borrow USDC, which
	// eth_minus_30 does not shock, so their two figures are EQUAL. C borrows
	// weETH, which the scenario re-prices at 70/100, so its two figures DIFFER
	// and the cell carries two different debt strings.
	tmADebt       = "540000000000"
	tmBDebt       = "300000000000"
	tmCDebtBefore = "800000000000"
	tmCDebtAfter  = "560000000000"
)

// tmMixedAave is §5.3's committed mixed-direction book: three offsetting moves,
// one of which carries the debt asymmetry.
func tmMixedAave() tmBook {
	return tmBook{engine: risk.AaveEngine, rows: []tmRow{
		{acct: acct(1), before: aaveAt(tmAHFBefore, tmADebt), after: aaveAt(tmAHFAfter, tmADebt)},
		{acct: acct(2), before: aaveAt(tmBHFBefore, tmBDebt), after: aaveAt(tmBHFAfter, tmBDebt)},
		{acct: acct(3), before: aaveAt(tmCHFBefore, tmCDebtBefore), after: aaveAt(tmCHFAfter, tmCDebtAfter)},
	}}
}

// tmExampleAave is §5.1's contract-example shape: one measured row that holds
// its lane, plus one row this run measured on neither side.
func tmExampleAave() tmBook {
	return tmBook{engine: risk.AaveEngine, rows: []tmRow{
		{acct: acct(1), before: aaveAt(tmBHFBefore, "600000000000"), after: aaveAt(tmBHFBefore, "600000000000")},
		{acct: acct(9)},
	}}
}

// tmExampleDM is the same shape on the other comparator.
func tmExampleDM() tmBook {
	return tmBook{engine: risk.DMEngine, rows: []tmRow{
		{acct: acct(1), before: dmAt("3200000000", "4620000000", "4620000000"),
			after: dmAt("3200000000", "4620000000", "4620000000")},
		{acct: acct(9)},
	}}
}

// tmCases is the table every structural law walks. Each entry is a book plus the
// one sentence that says why it is in the table.
func tmCases() []struct {
	name string
	book tmBook
} {
	return []struct {
		name string
		book tmBook
	}{
		{"the contract example's Aave shape: one held row, one unmeasured", tmExampleAave()},
		{"the contract example's Debt Manager shape, on the other comparator", tmExampleDM()},
		{"the mixed-direction book: three offsetting moves, nothing unmeasured", tmMixedAave()},
		{"the single-crossing book: one row down through 1.00, one unmeasured", tmBook{
			engine: risk.AaveEngine, rows: []tmRow{
				{acct: acct(1), before: aaveAt(tmBHFBefore, "600000000000"), after: aaveAt("972000000000000000", "600000000000")},
				{acct: acct(9)},
			}}},
		{"a book with a no-debt row beside a bucketed one", tmBook{
			engine: risk.AaveEngine, rows: []tmRow{
				{acct: acct(1), before: noDebt(), after: noDebt()},
				{acct: acct(2), before: aaveAt(tmAHFBefore, tmADebt), after: aaveAt(tmAHFAfter, tmADebt)},
			}}},
		{"an engine whose whole covered book is unmeasured", tmBook{
			engine: risk.DMEngine, rows: []tmRow{
				{acct: acct(1)},
				{acct: acct(2), excluded: true},
			}}},
		{"an engine with zero rows in the run", tmBook{engine: risk.AaveEngine}},
	}
}

// tmTally is the histogram tally for one lane, on the served wire object — the
// three-way rule the margins must equal.
func tmTally(hist wireRunBookHistogram, lane int) int {
	switch lane {
	case laneInfinite:
		return hist.InfiniteCount
	case laneUnmeasured:
		return hist.RefusedCount
	default:
		return hist.Buckets[lane].Count
	}
}

// ---------------------------------------------------------------------------
// 7.1 — THE HEADLINE: marginal agreement, enforced in Go
// ---------------------------------------------------------------------------

// TestRunBookTransitionsAgreeWithBothMarginals is the law the whole surface
// rests on: the matrix's two margins ARE the two histograms served beside it,
// lane for lane, over the SAME wire objects the response carries rather than
// over a re-derivation of them.
//
// MUTATIONS THIS KILLS: bucketing the matrix on its own edge table; dropping the
// unmeasured rows from the joint while the histogram still counts them; building
// the matrix from the account-keyed `states` maps when a count and a state
// disagree; folding the unmeasured rows onto one side only.
func TestRunBookTransitionsAgreeWithBothMarginals(t *testing.T) {
	s := fxServer(t)
	for _, tc := range tmCases() {
		t.Run(tc.name, func(t *testing.T) {
			before, after, u := tc.book.build(t)
			tr, err := runBookTransitions(tc.book.engine, before, after, tmDecimals(tc.book.engine), u)
			require.NoError(t, err)

			beforeHist := before.wire(tc.book.engine, s).HFHistogram
			afterHist := after.wire(tc.book.engine, s).HFHistogram

			require.Len(t, tr.FromRows, laneCount)
			require.Len(t, tr.ToRows, laneCount)

			rowSums := make([]int, laneCount)
			colSums := make([]int, laneCount)
			for _, of := range tr.Outflows {
				for _, c := range of.Cells {
					rowSums[of.From] += c.Rows
					colSums[c.To] += c.Rows
				}
			}
			for lane := 0; lane < laneCount; lane++ {
				require.Equal(t, tr.FromRows[lane], rowSums[lane],
					"lane %d: the cells leaving it must sum to its whole BEFORE population", lane)
				require.Equal(t, tmTally(beforeHist, lane), tr.FromRows[lane],
					"lane %d: `from_rows` must BE the before histogram's own tally, not a second count of it", lane)
				require.Equal(t, tr.ToRows[lane], colSums[lane],
					"lane %d: the cells arriving in it must sum to its whole AFTER population", lane)
				require.Equal(t, tmTally(afterHist, lane), tr.ToRows[lane],
					"lane %d: `to_rows` must BE the after histogram's own tally", lane)
			}

			// AND THE COMPARATOR IS THE HISTOGRAMS' OWN, repeated so the matrix
			// is readable without them in scope rather than restated differently.
			require.Equal(t, beforeHist.Comparator, tr.Comparator)
			require.Equal(t, afterHist.Comparator, tr.Comparator)
			require.Equal(t, risk.WadUnit().String(), tr.WadScale)
			require.Equal(t, beforeHist.WadScale, tr.WadScale)
		})
	}
}

// ---------------------------------------------------------------------------
// 7.2 — the rest of the pure laws
// ---------------------------------------------------------------------------

// TestRunBookTransitionLanesAreTheHistogramsOwnBuckets forecloses a SECOND EDGE
// TABLE. The bucket lanes must be byte-identical to the histogram's buckets, and
// the two lanes past them must be exactly the two tallies that sit beside them.
func TestRunBookTransitionLanesAreTheHistogramsOwnBuckets(t *testing.T) {
	s := fxServer(t)
	for _, engine := range []string{risk.AaveEngine, risk.DMEngine} {
		t.Run(engine, func(t *testing.T) {
			book := tmBook{engine: engine, rows: []tmRow{
				{acct: acct(1), before: aaveAt(tmAHFBefore, tmADebt), after: aaveAt(tmAHFAfter, tmADebt)},
			}}
			if engine == risk.DMEngine {
				book.rows = []tmRow{{acct: acct(1),
					before: dmAt("12", "10", "100"), after: dmAt("8", "10", "100")}}
			}
			before, _, _ := book.build(t)
			tr := book.transitions(t)
			hist := before.wire(engine, s).HFHistogram

			require.Equal(t, len(histogramEdges)+2, laneCount)
			require.Len(t, tr.Lanes, laneCount)
			require.Len(t, tr.Outflows, laneCount, "outflows are DENSE: one entry per lane, always")
			require.Len(t, tr.FromRows, laneCount)
			require.Len(t, tr.ToRows, laneCount)

			for i, b := range hist.Buckets {
				l := tr.Lanes[i]
				require.Equal(t, i, l.Index)
				require.Equal(t, laneKindBucket, l.Kind)
				require.Equal(t, b.Label, l.Label, "lane %d: the LABEL must be the histogram's own", i)
				require.Equal(t, b.LowerWad, l.LowerWad, "lane %d: the lower edge must be the histogram's own", i)
				require.Equal(t, b.UpperWad, l.UpperWad, "lane %d: the upper edge must be the histogram's own", i)
			}
			inf, un := tr.Lanes[laneInfinite], tr.Lanes[laneUnmeasured]
			require.Equal(t, laneKindInfinite, inf.Kind)
			require.Equal(t, "no debt (unbounded)", inf.Label)
			require.Equal(t, laneKindUnmeasured, un.Kind)
			require.Equal(t, "not measured", un.Label,
				"the label deliberately does NOT echo `refused_count`, whose 1.6.0 name predates the finding that it is wrong")
			for _, l := range []wireRunBookTransitionLane{inf, un} {
				require.Nil(t, l.LowerWad, "a non-bucket lane has no edges at all")
				require.Nil(t, l.UpperWad)
			}
			// The open-ended TOP bucket also carries a null upper edge, so the
			// null above is not the only reason a null appears here.
			require.Nil(t, tr.Lanes[len(histogramEdges)-1].UpperWad)

			for i, of := range tr.Outflows {
				require.Equal(t, i, of.From, "outflow %d must be lane %d: the array is positional", i, i)
			}
		})
	}
}

// TestRunBookTransitionCountsPartitionTheRun is the grand-total law: no position
// row is in two cells and none is in zero cells.
func TestRunBookTransitionCountsPartitionTheRun(t *testing.T) {
	for _, tc := range tmCases() {
		t.Run(tc.name, func(t *testing.T) {
			before, after, u := tc.book.build(t)
			tr, err := runBookTransitions(tc.book.engine, before, after, tmDecimals(tc.book.engine), u)
			require.NoError(t, err)

			cells := 0
			for _, of := range tr.Outflows {
				prev := -1
				for _, c := range of.Cells {
					require.GreaterOrEqual(t, c.Rows, 1,
						"an empty cell is ABSENT, never a row of zeros")
					require.Greater(t, c.To, prev,
						"cells are strictly ascending by `to`, so `to` is unique within an outflow")
					prev = c.To
					cells += c.Rows
				}
			}
			require.Equal(t, tr.TotalRows, cells, "every cell together IS the grand total")
			require.Equal(t, before.accounts+tr.UnmeasuredRows, tr.TotalRows,
				"total_rows is before.accounts plus the rows nobody measured")
			require.Equal(t, after.accounts+tr.UnmeasuredRows, tr.TotalRows,
				"and it is after.accounts plus the same number")
			require.Equal(t, before.accounts, tr.MeasuredRows,
				"measured_rows IS before.accounts: the denominator every movement statement is made against")
			require.Equal(t, after.accounts, tr.MeasuredRows)
			require.Equal(t, tr.TotalRows-tr.UnmeasuredRows, tr.MeasuredRows)
		})
	}
}

// TestRunBookTransitionNamesNoFieldItDoesNotCount is the NAMING LAW as a
// checkable property of the contract, not as a convention in a comment: in this
// subtree a name ending in `rows` holds a count of position rows or an array of
// such counts, and nothing holding OBJECTS is named that way.
//
// THE MUTATION THIS KILLS: the collision the earlier draft carried, where
// `RunBookTransitions.rows` was an array of row OBJECTS while
// `RunBookTransitionCell.rows` was an integer COUNT, two levels apart.
func TestRunBookTransitionNamesNoFieldItDoesNotCount(t *testing.T) {
	doc := loadContract(t)
	names := []string{"RunBookTransitions", "RunBookTransitionOutflow", "RunBookTransitionCell", "RunBookTransitionLane"}

	checked := 0
	for _, name := range names {
		ref, ok := doc.Components.Schemas[name]
		require.True(t, ok, "the contract declares no %s", name)
		s, _ := deref(ref, name)
		require.NotNil(t, s)
		require.NotEmpty(t, s.Properties, "%s declares no properties", name)

		for prop, pref := range s.Properties {
			ps, _ := deref(pref, "")
			require.NotNil(t, ps, "%s.%s resolves to no schema", name, prop)

			isInt := ps.Type != nil && ps.Type.Is(openapi3.TypeInteger)
			isIntArray := false
			holdsObjects := false
			if ps.Type != nil && ps.Type.Is(openapi3.TypeArray) && ps.Items != nil {
				items, _ := deref(ps.Items, "")
				if items != nil && items.Type != nil {
					isIntArray = items.Type.Is(openapi3.TypeInteger)
					holdsObjects = items.Type.Is(openapi3.TypeObject)
				}
			}
			if ps.Type != nil && ps.Type.Is(openapi3.TypeObject) {
				holdsObjects = true
			}

			if strings.HasSuffix(prop, "rows") {
				require.True(t, isInt || isIntArray,
					"%s.%s ends in `rows`, so it must be a COUNT of position rows or an array of such counts", name, prop)
				require.False(t, holdsObjects,
					"%s.%s ends in `rows` and holds objects: `rows` names a population, never a collection", name, prop)
				checked++
				continue
			}
			if holdsObjects {
				require.False(t, strings.HasSuffix(prop, "rows"),
					"%s.%s holds objects, so its name may not end in `rows`", name, prop)
			}
		}
	}
	// The law must actually have met the fields it polices, or it would pass
	// vacuously against a subtree that renamed them all.
	require.GreaterOrEqual(t, checked, 9,
		"the `rows` vocabulary is 9 fields wide (7 scalars on RunBookTransitions, 2 margins) plus the cell's own count")

	// AND NO FIELD IN THIS SUBTREE IS NAMED `*_accounts`. The 1.6.0
	// `before.accounts` / `after.accounts` keep their names — additive-only
	// forbids renaming them — but nothing added here may reintroduce the unit
	// confusion.
	for _, name := range names {
		s, _ := deref(doc.Components.Schemas[name], name)
		for prop := range s.Properties {
			require.False(t, strings.HasSuffix(prop, "accounts"),
				"%s.%s counts ROWS, not distinct addresses, and its name must say so", name, prop)
		}
	}
}

// TestRunBookTransitionHoldsNoOpinionWhenNothingWasMeasured is the null law, and
// it is the draft's own defect standing as a test.
//
// THE MUTATION THIS KILLS: serving `held_rows: N, lane_changed_rows: 0` over a
// book where nothing was measured. An honest user reads that as "this scenario
// moved nobody on this engine", which claims a measurement nobody made. It is
// the exact shape `web/app/lab/labRunBookLines.ts` already refuses to print,
// moved to the server where a client cannot forget it.
func TestRunBookTransitionHoldsNoOpinionWhenNothingWasMeasured(t *testing.T) {
	book := tmBook{engine: risk.DMEngine, rows: []tmRow{
		{acct: acct(1)},
		{acct: acct(2)},
		{acct: acct(3), excluded: true},
	}}
	tr := book.transitions(t)

	require.Equal(t, 0, tr.MeasuredRows)
	require.Equal(t, 3, tr.TotalRows)
	require.Equal(t, 3, tr.UnmeasuredRows, "total_rows IS unmeasured_rows when nothing was measured")
	require.Nil(t, tr.HeldRows, "a zero here would claim a measurement nobody made")
	require.Nil(t, tr.LaneChangedRows)
	require.Contains(t, tr.Note, "MEASURED NOTHING ON THIS ENGINE",
		"the note must SAY the book was not measured, not merely leave two nulls to be interpreted")

	// The whole population is in ONE cell, and its two debts are null.
	require.Equal(t, 3, tr.FromRows[laneUnmeasured])
	require.Equal(t, 3, tr.ToRows[laneUnmeasured])
	cells := tr.Outflows[laneUnmeasured].Cells
	require.Len(t, cells, 1)
	require.Equal(t, laneUnmeasured, cells[0].To)
	require.Equal(t, 3, cells[0].Rows)
	require.Nil(t, cells[0].DebtBeforeUSD)
	require.Nil(t, cells[0].DebtAfterUSD)
	for i, of := range tr.Outflows {
		if i == laneUnmeasured {
			continue
		}
		require.Empty(t, of.Cells, "lane %d held no row before the shock", i)
	}

	// AND A MEASURED BOOK IS NOT DESCRIBED THAT WAY, so the sentence above is a
	// disclosure rather than boilerplate.
	require.NotContains(t, tmMixedAave().transitions(t).Note, "MEASURED NOTHING ON THIS ENGINE")
}

// TestRunBookTransitionMovementPartitionsTheMeasured pins that the diagonal is
// taken over lanes 0..N ONLY: the (N+1, N+1) cell is never counted as "held".
func TestRunBookTransitionMovementPartitionsTheMeasured(t *testing.T) {
	for _, tc := range tmCases() {
		t.Run(tc.name, func(t *testing.T) {
			tr := tc.book.transitions(t)
			if tr.MeasuredRows == 0 {
				require.Nil(t, tr.HeldRows)
				require.Nil(t, tr.LaneChangedRows)
				return
			}
			require.NotNil(t, tr.HeldRows)
			require.NotNil(t, tr.LaneChangedRows)
			require.Equal(t, tr.TotalRows, *tr.HeldRows+*tr.LaneChangedRows+tr.UnmeasuredRows,
				"held + changed + unmeasured must be the whole matrix")

			// Recomputed from the cells, over lanes 0..N only.
			held, changed := 0, 0
			for _, of := range tr.Outflows {
				if of.From == laneUnmeasured {
					continue
				}
				for _, c := range of.Cells {
					if of.From == c.To {
						held += c.Rows
						continue
					}
					changed += c.Rows
				}
			}
			require.Equal(t, held, *tr.HeldRows)
			require.Equal(t, changed, *tr.LaneChangedRows)
			require.Equal(t, tr.MeasuredRows, held+changed,
				"the movement partition covers the MEASURED rows exactly")
		})
	}

	// The discriminating case: three lane changes on the committed
	// mixed-direction book, where the below-1.00 marginal moves by only one.
	mixed := tmMixedAave().transitions(t)
	require.Equal(t, 3, *mixed.LaneChangedRows,
		"A (4->0), B (3->0) and C (0->3) all changed lane")
	require.Equal(t, 0, *mixed.HeldRows)
	require.Equal(t, 1, (mixed.ToRows[0]+mixed.ToRows[1])-(mixed.FromRows[0]+mixed.FromRows[1]),
		"the below-1.00 MARGINAL moves by +1 while three rows changed lane: the fact two histograms cannot express")
}

// TestRunBookTransitionUnmeasuredSplitUsesTheCoverageCountersOwnPredicates is
// the fail-closed law on the cause split.
//
// THE MUTATION THIS KILLS: using `p.Status != computed` as a stand-in for
// `== refused`. `risk_positions.status` carries NO CHECK constraint, so the
// negation silently absorbs any third token the schema permits, counts it as
// refused-in-batch, and then points the reader at `coverage.refused_in_batch`,
// which is incremented on `== refused` and would not contain it.
func TestRunBookTransitionUnmeasuredSplitUsesTheCoverageCountersOwnPredicates(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    string
		reconErr  string
		want      unmeasuredCause
		wantError bool
	}{
		{
			name:   "riskd refused it: the positive predicate coverage.refused_in_batch uses",
			status: store.RiskPositionRefused, reconErr: "",
			want: unmeasuredRefusedInBatch,
		},
		{
			name:   "this layer could not rebuild it: the positive predicate coverage.excluded uses",
			status: store.RiskPositionComputed, reconErr: "liquidation bonus disagrees with the param ledger",
			want: unmeasuredExcludedByThisLayer,
		},
		{
			name:   "a THIRD status token the schema does not forbid",
			status: "quarantined", reconErr: "",
			wantError: true,
		},
		{
			name:   "a refused row that ALSO carries a reconstruction error",
			status: store.RiskPositionRefused, reconErr: "something",
			wantError: true,
		},
		{
			name:   "a computed row with no reconstruction error, which reached no arithmetic anyway",
			status: store.RiskPositionComputed, reconErr: "",
			wantError: true,
		},
		{
			name: "an empty status", status: "", reconErr: "", wantError: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := classifyUnmeasured(risk.AaveEngine, acct(1), tc.status, tc.reconErr)
			if tc.wantError {
				require.Error(t, err, "a row in neither coverage surface must REFUSE, never be swept into one")
				require.Contains(t, err.Error(), "in neither coverage.refused_in_batch nor")
				require.Contains(t, err.Error(), acct(1).Hex())
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}

	// AND THE TWO COUNTS REACH THE WIRE AS A SUM OVER THE POPULATION THE MATRIX
	// PLACED, not as a restatement beside it.
	book := tmBook{engine: risk.AaveEngine, rows: []tmRow{
		{acct: acct(1), before: aaveAt(tmAHFBefore, tmADebt), after: aaveAt(tmAHFAfter, tmADebt)},
		{acct: acct(7)},
		{acct: acct(8), excluded: true},
		{acct: acct(9), excluded: true},
	}}
	tr := book.transitions(t)
	require.Equal(t, 3, tr.UnmeasuredRows)
	require.Equal(t, 1, tr.UnmeasuredRefusedInBatchRows)
	require.Equal(t, 2, tr.UnmeasuredExcludedByThisLayerRows)
	require.Equal(t, tr.UnmeasuredRows, tr.UnmeasuredRefusedInBatchRows+tr.UnmeasuredExcludedByThisLayerRows)

	// THE FAIL-CLOSED GUARD: a split that does not add up to the population the
	// matrix actually placed is a named 500, never a served number.
	before, after, u := book.build(t)
	u.refusedInBatch++
	_, err := runBookTransitions(risk.AaveEngine, before, after, 8, u)
	require.Error(t, err)
	require.Contains(t, err.Error(), "against a cause split of")
	require.Contains(t, err.Error(), "coverage surface that does not hold those rows")

	// A NIL RECORD IS A LEGAL BOOK, not a missing argument: it reads as 0 and 0.
	nb, na, _ := tmMixedAave().build(t)
	clean, err := runBookTransitions(risk.AaveEngine, nb, na, 8, nil)
	require.NoError(t, err)
	require.Equal(t, 0, clean.UnmeasuredRows)
	require.Equal(t, 0, clean.UnmeasuredRefusedInBatchRows)
	require.Equal(t, 0, clean.UnmeasuredExcludedByThisLayerRows)
}

// TestRunBookTransitionLaneNPlusOneHoldsOnlyUnmeasuredRows pins that the last
// lane holds one population and one only, and that a null debt appears nowhere
// else.
//
// THE MUTATION THIS KILLS: reusing lane N+1 for a measured row and hiding its
// debt behind a null, which would break the per-side debt reconciliation while
// every margin still looked right.
func TestRunBookTransitionLaneNPlusOneHoldsOnlyUnmeasuredRows(t *testing.T) {
	for _, tc := range tmCases() {
		t.Run(tc.name, func(t *testing.T) {
			tr := tc.book.transitions(t)
			require.Equal(t, tr.UnmeasuredRows, tr.FromRows[laneUnmeasured])
			require.Equal(t, tr.UnmeasuredRows, tr.ToRows[laneUnmeasured])

			for _, of := range tr.Outflows {
				for _, c := range of.Cells {
					unmeasuredCell := of.From == laneUnmeasured && c.To == laneUnmeasured
					if unmeasuredCell {
						require.Nil(t, c.DebtBeforeUSD, "this run computed no debt for these rows")
						require.Nil(t, c.DebtAfterUSD)
						continue
					}
					require.NotNil(t, c.DebtBeforeUSD,
						"cell (%d,%d) holds rows this run MEASURED, so its debt is knowable and must not be null",
						of.From, c.To)
					require.NotNil(t, c.DebtAfterUSD,
						"cell (%d,%d): the same, on the after side", of.From, c.To)
				}
			}
			if tr.UnmeasuredRows > 0 {
				cells := tr.Outflows[laneUnmeasured].Cells
				require.Len(t, cells, 1, "the unmeasured rows live on exactly ONE cell")
				require.Equal(t, laneUnmeasured, cells[0].To)
				require.Equal(t, tr.UnmeasuredRows, cells[0].Rows)
			} else {
				require.Empty(t, tr.Outflows[laneUnmeasured].Cells)
			}
		})
	}
}

// TestMeasuredStatesAlwaysCarryAComparator is the assumption the whole lane
// vocabulary rests on, held as a property of the pure library rather than as a
// comment: a measured state has a comparator IF AND ONLY IF it is not infinite.
// If this ever fails, lane N+1 has grown a second population and the surface
// needs a new lane and a new histogram tally, not a quiet reroute.
func TestMeasuredStatesAlwaysCarryAComparator(t *testing.T) {
	t.Run("aave: HealthFactorWad is non-nil exactly when it is not infinite", func(t *testing.T) {
		for _, tc := range []struct {
			name string
			in   risk.PositionInput
		}{
			{"positive debt", bsAaveInput(false)},
			{"positive debt beside an unpriced holding", bsAaveInput(true)},
			{"NO debt at all", tmAaveNoDebtInput()},
		} {
			t.Run(tc.name, func(t *testing.T) {
				h, err := risk.ComputeAaveHealth(*tc.in.Aave)
				require.NoError(t, err)
				require.Equal(t, h.IsInfinite, h.HealthFactorWad == nil,
					"a measured Aave state carries a wad exactly when it is not unbounded")
				if !h.IsInfinite {
					require.GreaterOrEqual(t, bucketIndexOf(risk.AaveEngine, h.HealthFactorWad, nil, nil), 0,
						"and that wad is always placeable in a bucket")
				}
			})
		}
	})

	t.Run("debt manager: the rational's denominator is positive exactly when it is not infinite", func(t *testing.T) {
		for _, debt := range []string{"0", "1", "4200000000", "999999999999999999999"} {
			t.Run("debt "+debt, func(t *testing.T) {
				h, err := risk.ComputeDMHealth(tmDMInput(debt))
				require.NoError(t, err)
				if h.IsInfinite {
					require.Equal(t, "0", debt, "only a zero-borrowings row is unbounded")
					return
				}
				require.NotNil(t, h.HealthFactor.Den)
				require.Positive(t, h.HealthFactor.Den.Sign(),
					"NewRational refuses a non-positive denominator, so a measured DM state always has one")
				require.GreaterOrEqual(t,
					bucketIndexOf(risk.DMEngine, nil, h.HealthFactor.Num, h.HealthFactor.Den), 0,
					"and that rational is always placeable in a bucket")
			})
		}
	})
}

// tmAaveNoDebtInput is one Aave position holding collateral and NO debt: the
// unbounded case, which is a lane of its own and never a large number.
func tmAaveNoDebtInput() risk.PositionInput {
	in := bsAaveInput(false)
	kept := in.Aave.Reserves[:0]
	for _, rv := range in.Aave.Reserves {
		if rv.ScaledDebt != nil && rv.ScaledDebt.Sign() > 0 {
			continue
		}
		kept = append(kept, rv)
	}
	in.Aave.Reserves = kept
	return in
}

// tmDMInput is one Debt Manager position at a chosen debt, built on the standing
// fixture's collateral, threshold, bonus and price.
func tmDMInput(debt string) risk.DMInput {
	return risk.DMInput{
		Account:    acct(4),
		DebtUSD:    bi(debt),
		Collateral: []risk.DMCollateral{{Asset: fxWeETHOp, Amount: bi(fxDMWeETHAmount), Decimals: 18}},
		Params: []risk.ParamRow{{
			Engine: risk.DMEngine, ChainID: fxOPChain, Asset: fxWeETHOp,
			LiqThreshold: bi(fxDMLiqThreshold), LiqBonus: bi(fxDMLiqBonus), EffectiveBlock: fxDMBlock,
		}},
		Prices: []risk.PriceInput{{
			ChainID: fxOPChain, Asset: fxWeETHOp, Source: fxDMSource, Block: uint64(fxDMPriceBlock),
			AsOf: time.Unix(1, 0), Value: bi(fxDMWeETHPrice), Decimals: 6,
			BudgetSeconds: fxPriceBudgetSecs, Provenance: risk.ProvenanceEngineExact, Fresh: true,
		}},
		Marks: risk.Watermarks{BalancesBlock: fxDMBlock, ParamsBlock: fxDMBlock, SweepBlock: fxDMSweepBlock},
	}
}

// TestRunBookMeasureRefusesAMeasuredRowItCannotBucket is the second half of the
// changed 1.6.0 law: a MEASURED state with no comparator REFUSES with a named
// reason instead of being folded into `m.refused`.
//
// Folding it there is what would give lane N+1 two meanings — a measured row's
// debt behind a null — and it would break the per-side debt reconciliation while
// every margin still summed.
func TestRunBookMeasureRefusesAMeasuredRowItCannotBucket(t *testing.T) {
	for _, tc := range []struct {
		name   string
		engine string
		state  *runAccountState
	}{
		{"aave with no health-factor wad", risk.AaveEngine, &runAccountState{account: acct(7)}},
		{"debt manager with a zero denominator", risk.DMEngine,
			&runAccountState{account: acct(8), hfNum: bi("1"), hfDen: bi("0")}},
		{"debt manager with no rational at all", risk.DMEngine, &runAccountState{account: acct(6)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := newRunMeasure()
			err := m.place(tc.engine, tc.state)
			require.Error(t, err, "an impossible state must REFUSE, not be quietly counted")
			require.Contains(t, err.Error(), "measured but carries no comparator")
			require.Contains(t, err.Error(), "both need a new tally",
				"the refusal must name the remedy: a new lane and a new histogram tally")
			require.Contains(t, err.Error(), tc.state.account.Hex())

			// AND NOTHING WAS COUNTED. The 1.6.0 behavior incremented `refused`,
			// which is exactly the fold this lane vocabulary reserves for the
			// rows nobody measured.
			require.Zero(t, m.refused, "a refusal must not leave a tally behind")
			require.Zero(t, m.infinite)
			require.Empty(t, m.lanes, "and no lane record either")
		})
	}
}

// TestRunBookTransitionInfiniteLaneDebtIsAKnowableZero keeps the two kinds of
// absence apart: a row with NO DEBT contributes an exact "0", because that zero
// is knowable; a row nobody measured contributes a null.
func TestRunBookTransitionInfiniteLaneDebtIsAKnowableZero(t *testing.T) {
	book := tmBook{engine: risk.AaveEngine, rows: []tmRow{
		{acct: acct(1), before: noDebt(), after: noDebt()},
		{acct: acct(2), before: noDebt(), after: noDebt()},
		{acct: acct(9)},
	}}
	tr := book.transitions(t)

	cells := tr.Outflows[laneInfinite].Cells
	require.Len(t, cells, 1)
	require.Equal(t, laneInfinite, cells[0].To)
	require.Equal(t, 2, cells[0].Rows)
	require.NotNil(t, cells[0].DebtBeforeUSD, "a knowable zero is served AS a zero")
	require.Equal(t, "0", *cells[0].DebtBeforeUSD)
	require.NotNil(t, cells[0].DebtAfterUSD)
	require.Equal(t, "0", *cells[0].DebtAfterUSD)

	// And the unmeasured cell beside it carries nulls, so the two
	// representations are visibly different facts in one body.
	un := tr.Outflows[laneUnmeasured].Cells
	require.Len(t, un, 1)
	require.Nil(t, un[0].DebtBeforeUSD)
	require.Nil(t, un[0].DebtAfterUSD)
}

// TestRunBookTransitionDebtReconcilesPerSide is the two-figure law. The book
// carries a row whose two sides DIFFER, and the difference is asserted, so a
// mutation that collapses the pair into one figure fails rather than passing
// vacuously.
func TestRunBookTransitionDebtReconcilesPerSide(t *testing.T) {
	book := tmMixedAave()
	tr := book.transitions(t)

	wantBefore := new(big.Int)
	wantAfter := new(big.Int)
	for _, r := range book.rows {
		wantBefore.Add(wantBefore, r.before.debtUSD)
		wantAfter.Add(wantAfter, r.after.debtUSD)
	}
	require.Equal(t, "1640000000000", wantBefore.String())
	require.Equal(t, "1400000000000", wantAfter.String())
	require.NotEqual(t, wantBefore.String(), wantAfter.String(),
		"THE POINT: this book's two sides genuinely differ, so a single-figure mutation cannot pass here")

	gotBefore, gotAfter := new(big.Int), new(big.Int)
	for _, of := range tr.Outflows {
		for _, c := range of.Cells {
			if c.DebtBeforeUSD != nil {
				gotBefore.Add(gotBefore, bi(*c.DebtBeforeUSD))
			}
			if c.DebtAfterUSD != nil {
				gotAfter.Add(gotAfter, bi(*c.DebtAfterUSD))
			}
		}
	}
	require.Equal(t, wantBefore.String(), gotBefore.String(),
		"the non-null debt_before_usd figures must sum EXACTLY to the before-side total")
	require.Equal(t, wantAfter.String(), gotAfter.String(),
		"and the after-side figures to the after-side total")

	// THE CELL THAT CARRIES THE ASYMMETRY: C moved 0 -> 3 and its debt leg is
	// the shocked asset, so its two figures are different strings.
	cells := tr.Outflows[0].Cells
	require.Len(t, cells, 1)
	require.Equal(t, 3, cells[0].To)
	require.Equal(t, tmCDebtBefore, *cells[0].DebtBeforeUSD)
	require.Equal(t, tmCDebtAfter, *cells[0].DebtAfterUSD)
	require.NotEqual(t, *cells[0].DebtBeforeUSD, *cells[0].DebtAfterUSD)

	// The two cells whose debt is held flat carry EQUAL pairs, so the law is not
	// simply "the two figures always differ".
	for _, from := range []int{3, 4} {
		c := tr.Outflows[from].Cells
		require.Len(t, c, 1)
		require.Equal(t, *c[0].DebtBeforeUSD, *c[0].DebtAfterUSD,
			"lane %d's row borrows an asset this scenario holds flat", from)
	}
}

// TestRunBookTransitionRefusesAMisPairedZip is the guard against a future
// refactor that filters one side: a mis-paired zip is a named 500, never a
// matrix with plausible-looking wrong margins.
func TestRunBookTransitionRefusesAMisPairedZip(t *testing.T) {
	t.Run("unequal lane-slice lengths", func(t *testing.T) {
		before, after, u := tmMixedAave().build(t)
		after.lanes = after.lanes[:len(after.lanes)-1]
		_, err := runBookTransitions(risk.AaveEngine, before, after, 8, u)
		require.Error(t, err)
		require.Contains(t, err.Error(), "before-lane records against")
		require.Contains(t, err.Error(), "margins neither histogram supports")
	})

	t.Run("an account mismatch at one index", func(t *testing.T) {
		before, after, u := tmMixedAave().build(t)
		after.lanes[1].account = acct(200)
		_, err := runBookTransitions(risk.AaveEngine, before, after, 8, u)
		require.Error(t, err)
		require.Contains(t, err.Error(), "on the before side and account")
		require.Contains(t, err.Error(), acct(200).Hex())
	})
}

// TestRunBookTransitionRefusesTwoRowsForOneAccount is the unit check, and it
// covers BOTH populations the matrix places. `risk_positions`'s primary key makes
// a violation impossible today; checking it is what licenses the note's sentence
// "one row IS one account on this engine" over every row rather than over the
// measured half only.
func TestRunBookTransitionRefusesTwoRowsForOneAccount(t *testing.T) {
	t.Run("a duplicate among MEASURED rows", func(t *testing.T) {
		book := tmBook{engine: risk.AaveEngine, rows: []tmRow{
			{acct: acct(1), before: aaveAt(tmAHFBefore, tmADebt), after: aaveAt(tmAHFAfter, tmADebt)},
			{acct: acct(1), before: aaveAt(tmBHFBefore, tmBDebt), after: aaveAt(tmBHFAfter, tmBDebt)},
		}}
		before, after, u := book.build(t)
		_, err := runBookTransitions(risk.AaveEngine, before, after, 8, u)
		require.Error(t, err)
		require.Contains(t, err.Error(), "appears in more than one position row")
		require.Contains(t, err.Error(), acct(1).Hex())
	})

	t.Run("a duplicate between a MEASURED row and an UNMEASURED one", func(t *testing.T) {
		// This is the half `len(states) == accounts` structurally cannot see:
		// `accounts` and `states` are written only inside measureRunBook, and
		// the unmeasured rows never touch either.
		book := tmBook{engine: risk.AaveEngine, rows: []tmRow{
			{acct: acct(1), before: aaveAt(tmAHFBefore, tmADebt), after: aaveAt(tmAHFAfter, tmADebt)},
			{acct: acct(1)},
		}}
		before, after, u := book.build(t)
		require.Len(t, before.states, before.accounts,
			"the measured half is self-consistent here, so only a whole-population check can fail")
		_, err := runBookTransitions(risk.AaveEngine, before, after, 8, u)
		require.Error(t, err)
		require.Contains(t, err.Error(), "appears in more than one position row")
	})
}

// TestRunBookMeasureRefusesAnEngineItHasNoArmFor closes a pre-existing hole the
// matrix's partition claim makes untenable: a covered engine with no arm here
// would enter `run`, `beforeInputs` and therefore `coverage.in_book` while
// producing no tally and no lane entry — in ZERO cells while every margin still
// reconciled.
func TestRunBookMeasureRefusesAnEngineItHasNoArmFor(t *testing.T) {
	s := fxServer(t)
	_, err := s.measureRunBook([]risk.PositionInput{{Engine: "morpho_blue_etherfi"}})
	require.Error(t, err)
	require.Contains(t, err.Error(), "has no arm for engine")
	require.Contains(t, err.Error(), "morpho_blue_etherfi")
	require.Contains(t, err.Error(), "silently omit them")

	// The two engines that DO have arms are unaffected, so this is not a law
	// that refuses everything.
	ok, err := s.measureRunBook([]risk.PositionInput{bsAaveInput(false)})
	require.NoError(t, err)
	require.Equal(t, 1, ok[risk.AaveEngine].accounts)
}

// TestRunBookTransitionIsDeterministic pins that no map iteration order reaches
// the wire: outflows emit in lane order and cells ascending by `to`, both by
// index rather than by a sort.
func TestRunBookTransitionIsDeterministic(t *testing.T) {
	for _, tc := range tmCases() {
		t.Run(tc.name, func(t *testing.T) {
			first := tc.book.transitions(t)
			for i := 0; i < 8; i++ {
				require.Equal(t, first, tc.book.transitions(t),
					"two builds over the same measures must be byte-identical")
			}
		})
	}
}
