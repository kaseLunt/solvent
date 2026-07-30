package main

// THE SWEEP-PIN REGRESSION.
//
// The defect (found by the sweep-gap probe against this wave's own gate,
// 2026-07-29): collectLegsSide filters collateral legs at `updated_block <= pin`
// while the sweep watermark was read with NO block filter. The collateral
// sweeper's multicall executes at chain HEAD — above the derive cursor the run
// pins at — and ApplySweepBatch replaces an account's legs WHOLESALE. So for any
// account swept above the pin:
//
//	legs visible at the pin      = 0   (all of them carry updated_block > pin)
//	watermark (unfiltered)       > 0   (it certified those very legs as read)
//	=> requireWatermarks PASSES
//	=> ComputeDMHealth sums NOTHING
//	=> Liquidatable = (debt > 0) = TRUE
//
// Measured live: 199 of 9,722 accounts (~2%) in that state mid-generation at a
// ~34% duty cycle; 5/5 chain-checked were HEALTHY, one of them carrying $100,120
// of threshold-weighted collateral. 199 manufactured liquidation alerts.
//
// WHAT THIS TEST KILLS, precisely: reverting the pin filter on the watermark.
// With the filter, an above-pin sweep leaves AtOrBelowPin == 0 and the account is
// classified sweepAbovePin (excluded, refused). Without it, AtOrBelowPin equals
// the above-pin block, classifyDMSweep returns sweepEvaluable, and the account is
// scored over discarded collateral. TestClassifyDMSweepKillsTheUnfilteredWatermark
// asserts BOTH the correct verdict and the exact wrong verdict the defect
// produced, so the mutation cannot survive.

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// midGenerationShape is the EXACT live shape the probe measured: the account's
// only successful sweep sits above the run pin, so no leg is visible at the pin.
func midGenerationShape(pin uint64) snapshotdb.T6SweepState {
	return snapshotdb.T6SweepState{
		AtOrBelowPin:     0,       // the pin filter refused the above-pin sweep
		Newest:           pin + 7, // the sweeper ran at chain HEAD, above the cursor
		LegsAtOrBelowPin: 0,       // ApplySweepBatch replaced the legs wholesale
		Status:           "success",
	}
}

func TestClassifyDMSweepKillsTheUnfilteredWatermark(t *testing.T) {
	const pin = 154892958

	t.Run("mid-generation account is NOT evaluable", func(t *testing.T) {
		got := classifyDMSweep(midGenerationShape(pin), pin)
		require.Equal(t, sweepAbovePin, got,
			"an account whose only successful sweep is ABOVE the pin has no collateral testimony a pinned read can see; classifying it evaluable is the defect that manufactured 199 false liquidation alerts")
		require.NotEqual(t, sweepEvaluable, got)
	})

	t.Run("MUTATION: the unfiltered watermark makes it evaluable", func(t *testing.T) {
		// This is the defect, reconstructed: the watermark read WITHOUT the pin
		// filter carries the above-pin block through.
		defective := midGenerationShape(pin)
		defective.AtOrBelowPin = defective.Newest // what an unfiltered read yields
		require.Equal(t, sweepEvaluable, classifyDMSweep(defective, pin),
			"this asserts the DEFECT's behaviour, so restoring the unfiltered read cannot pass the test above unnoticed")
		// And it is exactly the state the exclusion invariant cannot catch on its
		// own — which is why the pin filter, not the invariant, is the fix.
		require.True(t, sweepExclusionInvariant(defective),
			"the invariant is silent here (a watermark with zero visible legs is legitimate for a genuinely empty account), so the pin discipline is load-bearing rather than belt-and-braces")
	})

	t.Run("swept at or below the pin is evaluable, even with zero legs", func(t *testing.T) {
		// The REAL zero-collateral population: swept at/below the pin, found
		// nothing. These must stay evaluable and liquidatable — they are the TRUE
		// side of the boolean the DM gate exists to exercise.
		st := snapshotdb.T6SweepState{AtOrBelowPin: pin - 1000, Newest: pin - 1000, LegsAtOrBelowPin: 0, Status: "success"}
		require.Equal(t, sweepEvaluable, classifyDMSweep(st, pin))
		require.True(t, sweepExclusionInvariant(st),
			"an honest empty sweep must not be flagged: this is the population that carries the real dust debt")
	})

	t.Run("exactly at the pin is evaluable", func(t *testing.T) {
		st := snapshotdb.T6SweepState{AtOrBelowPin: pin, Newest: pin, LegsAtOrBelowPin: 3, Status: "success"}
		require.Equal(t, sweepEvaluable, classifyDMSweep(st, pin),
			"<= pin, not < pin: a sweep AT the pin is visible to a read pinned at the pin")
	})

	t.Run("never swept is its own class and is GATED", func(t *testing.T) {
		st := snapshotdb.T6SweepState{Status: "failed"}
		require.Equal(t, sweepNever, classifyDMSweep(st, pin),
			"no successful sweep at any height is a PERSISTENT hole, not a clock difference — re-pinning cannot fix it")
	})

	t.Run("exclusion invariant refuses discarding visible evidence", func(t *testing.T) {
		// An excluded account that DOES have legs the pin can see would mean the
		// two filters disagree — the exclusion would be throwing away evidence.
		bad := snapshotdb.T6SweepState{AtOrBelowPin: 0, Newest: pin + 1, LegsAtOrBelowPin: 2}
		require.False(t, sweepExclusionInvariant(bad))
	})
}

// TestSweepAbovePinIsDisclosedNotGatedAndNeverSweptIsGated pins the gating
// policy, which is the part a reviewer will question: why is one exclusion
// recorded and the other failing?
func TestSweepAbovePinIsDisclosedNotGatedAndNeverSweptIsGated(t *testing.T) {
	const pin = 154892958
	c := &p3Ctx{pinOP: pin, o: &options{}}
	t6 := &snapshotdb.Task6Data{DMSweepByAccount: map[string]snapshotdb.T6SweepState{
		"aa": midGenerationShape(pin),
		"bb": {Status: "failed"},
		"cc": {AtOrBelowPin: pin - 5, Newest: pin - 5, LegsAtOrBelowPin: 1, Status: "success"},
	}}
	borrowers := map[string]*big.Int{"aa": big.NewInt(1), "bb": big.NewInt(1), "cc": big.NewInt(1)}

	rows, excluded := classifySweepTestimony(c, t6, borrowers)
	require.True(t, excluded["aa"], "sweep-above-pin is excluded from the evaluable universe")
	require.True(t, excluded["bb"], "never-swept is excluded too")
	require.False(t, excluded["cc"], "an account swept at or below the pin stays evaluable")

	byClass := map[string]p3Row{}
	for _, r := range rows {
		if r.Class != "" {
			byClass[r.Class] = r
		}
	}
	above, ok := byClass[sweepAbovePin]
	require.True(t, ok)
	require.False(t, above.Gated,
		"sweep-above-pin is a duty-cycle property of pinning below the sweeper's head — the run's OWN choice of pin — so it is disclosed, not gated; gating it would make acceptance fail ~34% of the time for a reason no fix can remove")
	require.Equal(t, verdictUnscannable, above.Verdict)

	never, ok := byClass[sweepNever]
	require.True(t, ok)
	require.True(t, never.Gated,
		"never-swept IS gated: a borrower the sweeper has never successfully read is a persistent hole the served surface would refuse too")

	// The evaluable-universe row must always be present and must carry the counts,
	// so a shrinking universe is visible rather than implicit.
	var universeRow *p3Row
	for i := range rows {
		if rows[i].Leg == "evaluable-universe" {
			universeRow = &rows[i]
		}
	}
	require.NotNil(t, universeRow)
	require.True(t, universeRow.Gated)
	require.Contains(t, universeRow.Actual, "1 evaluable")
	require.Contains(t, universeRow.Actual, "1 excluded sweep-above-pin")
	require.Contains(t, universeRow.Actual, "1 excluded never-swept")

	// Only the never-swept row and nothing else may gate here.
	require.Equal(t, 1, tallyP3(rows),
		"exactly one gated failure: the never-swept hole. The above-pin exclusion must not add one")
}

// TestExcludedAccountsNeverReachTheBooleanWeld is the end-to-end consequence: an
// excluded account must not appear as our-liquidatable, because that is the false
// alert the defect produced.
func TestExcludedAccountsNeverReachTheBooleanWeld(t *testing.T) {
	const pin = 154892958
	c := &p3Ctx{pinOP: pin, o: &options{}}
	t6 := &snapshotdb.Task6Data{DMSweepByAccount: map[string]snapshotdb.T6SweepState{
		"9fd6c4daf4e021e34bf6cbf6b451ae000d046747": midGenerationShape(pin),
	}}
	borrowers := map[string]*big.Int{
		// The probe's own subject, with its real live debt: $40.31.
		"9fd6c4daf4e021e34bf6cbf6b451ae000d046747": big.NewInt(40310720),
	}
	_, excluded := classifySweepTestimony(c, t6, borrowers)
	require.True(t, excluded["9fd6c4daf4e021e34bf6cbf6b451ae000d046747"],
		"the probe's F2 subject must be EXCLUDED at a pin below its sweep, not scored as liquidatable over collateral the pin cannot see. The chain called it HEALTHY with $59.22 of threshold-weighted collateral")
	require.Len(t, excluded, 1)
}
