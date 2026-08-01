// Wave H3 regression tests: the adjudicated BOOLEAN-LEG three-state law (the
// union of the chain-truth and risk-quant boolean-leg rulings, 2026-07-31)
// and the never-swept reshape, each pinned by the law it implements and by
// the designed mutant it must kill
// (testdata/mutation-transcripts/wave-h3.md).
//
//  1. classifyDMBoolean — MOTION reachable ONLY through ALL six conjuncts
//     (mutants m1: conjunct iii deleted; m2: conjunct iv deleted).
//  2. NO margin cutoff exists anywhere in the predicate (mutant m3: a margin
//     epsilon smuggled in) — margins are evidence, never a predicate input.
//  3. The population-level sweeper-health gate on the disclosed class
//     (mutant m4: the gate removed).
//  4. The never-swept age guard: refusal-weld + cycle arithmetic (mutant m5:
//     the guard widened to always-disclose).
//  5. The D-013 note fix: the boolean drift note branches on the ACTUAL
//     quantity-leg verdicts; the strict-inequality diagnosis prints only in
//     the one state where it is true.
package main

import (
	"context"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// fullMotionFacts builds a fact set with EVERY conjunct proven, FP direction.
// Tests mutate one conjunct at a time to prove each is load-bearing.
func fullMotionFacts() dmBooleanFacts {
	return dmBooleanFacts{
		Ours: true, Chain: false, // the accept-r5 false-positive shape
		MaxBorrowLegVerdict: verdictSampleGap, // (i) the full certificate
		DebtExactAtPin:      true,             // (ii)
		Own: &dmOwnClockResult{ // (iii) + (v)
			Block:    154961846,
			BoolRead: true, ChainLiqS: true,
			OursLiqComputed: true, OursLiqS: true, // welds: liquidatable at S, both sides
			DebtUSDAtS: big.NewInt(36933818),
			OurMax:     big.NewInt(21858263),
			AgeKnown:   true, AgeSeconds: 2756,
		},
		PinVec: &dmPinVectorResult{ // (iv)
			Read:       true,
			ScalarP:    big.NewInt(53950439),
			BoolP:      false,
			ScalarWeld: true, BoolWeld: true,
			DeltaSum:   big.NewInt(32092176),
			Reconciles: true,
		},
		BudgetSeconds: 5400, // inside the budget
	}
}

// TestClassifyDMBooleanThreeStateLaw pins the whole classifier: EXACT
// unchanged; MOTION reachable only through ALL conjuncts; every broken
// conjunct lands gated (drift or weld-unread) with the adjudicated class.
func TestClassifyDMBooleanThreeStateLaw(t *testing.T) {
	t.Run("exact is unchanged", func(t *testing.T) {
		v, cls, gated, _ := classifyDMBoolean(dmBooleanFacts{Ours: true, Chain: true})
		require.Equal(t, verdictExact, v)
		require.Empty(t, cls)
		require.True(t, gated)
	})

	t.Run("all conjuncts proven = MOTION, gated=false, direction-tagged", func(t *testing.T) {
		v, cls, gated, _ := classifyDMBoolean(fullMotionFacts())
		require.Equal(t, verdictBoundaryMotion, v)
		require.False(t, gated, "MOTION is a disclosed evidence row, never gated — and never a pass either")
		require.Contains(t, cls, "motion-proven")
		require.Contains(t, cls, dmDirectionFalsePositive)
	})

	t.Run("false-negative direction is tagged at the boolean's own granularity", func(t *testing.T) {
		fx := fullMotionFacts()
		fx.Ours, fx.Chain = false, true
		v, cls, gated, _ := classifyDMBoolean(fx)
		require.Equal(t, verdictBoundaryMotion, v)
		require.False(t, gated)
		require.Contains(t, cls, dmDirectionFalseNegative)
	})

	t.Run("conjunct (i): no sample-gap certificate = plain boolean drift", func(t *testing.T) {
		fx := fullMotionFacts()
		fx.MaxBorrowLegVerdict = verdictExact
		v, cls, gated, reasons := classifyDMBoolean(fx)
		require.Equal(t, verdictDrift, v)
		require.True(t, gated)
		require.Contains(t, cls, "boolean-direction")
		require.Contains(t, strings.Join(reasons, " "), "conjunct (i)")
	})

	t.Run("conjunct (ii): debt disagreement is drift, never motion", func(t *testing.T) {
		fx := fullMotionFacts()
		fx.DebtExactAtPin = false
		v, _, gated, reasons := classifyDMBoolean(fx)
		require.Equal(t, verdictDrift, v)
		require.True(t, gated)
		require.Contains(t, strings.Join(reasons, " "), "same-clock event-derived")
	})

	// MUTANT m1's kill (wave-h3.md): with conjunct (iii) deleted, BOTH of
	// these cases classify MOTION — the unread one silently and the
	// diverging one catastrophically (a broken composition law disclosed as
	// weather).
	t.Run("conjunct (iii) unread: MOTION is unreachable without the S-clock boolean weld", func(t *testing.T) {
		fx := fullMotionFacts()
		fx.Own.BoolRead = false
		v, cls, gated, _ := classifyDMBoolean(fx)
		require.Equal(t, verdictWeldUnread, v,
			"a flip whose S-clock boolean weld did not answer is CANNOT-VERIFY, never motion (m1 kill)")
		require.True(t, gated)
		require.Equal(t, "s-clock-boolean-weld-unread", cls)

		fx = fullMotionFacts()
		fx.Own.OursLiqComputed = false
		v, _, gated, _ = classifyDMBoolean(fx)
		require.Equal(t, verdictWeldUnread, v)
		require.True(t, gated)

		fx = fullMotionFacts()
		fx.Own = nil
		v, _, gated, _ = classifyDMBoolean(fx)
		require.Equal(t, verdictWeldUnread, v)
		require.True(t, gated)
	})

	t.Run("conjunct (iii) weld failure over a PASSING certificate ESCALATES as custody drift", func(t *testing.T) {
		fx := fullMotionFacts()
		fx.Own.OursLiqS = false // ours@S disagrees with chain@S while the vector certificate passed
		v, cls, gated, reasons := classifyDMBoolean(fx)
		require.Equal(t, verdictDrift, v, "m1 kill: the composition law diverging from chain must GATE, never disclose")
		require.True(t, gated)
		require.Equal(t, dmClassSClockCustodyDrift, cls,
			"the escalation is NAMED in the class string (chain-truth, boolean-leg ruling)")
		require.Contains(t, strings.Join(reasons, " "), "PASSING collateral certificate")
	})

	// MUTANT m2's kill: with conjunct (iv) deleted, a flip whose law@P
	// substitution fails — the chain's own pin vector refuting our law —
	// classifies MOTION.
	t.Run("conjunct (iv): the pin-vector substitution is load-bearing", func(t *testing.T) {
		fx := fullMotionFacts()
		fx.PinVec = nil
		v, cls, gated, _ := classifyDMBoolean(fx)
		require.Equal(t, verdictWeldUnread, v, "m2 kill: no substitution read = cannot verify")
		require.True(t, gated)
		require.Equal(t, "pin-vector-substitution-unread", cls)

		fx = fullMotionFacts()
		fx.PinVec.ScalarWeld = false
		v, cls, gated, _ = classifyDMBoolean(fx)
		require.Equal(t, verdictDrift, v,
			"m2 kill: the scalar over the chain's own pin vector must reproduce getMaxBorrowAmount@P bit-exact")
		require.True(t, gated)
		require.Contains(t, cls, "pin-vector-law-divergence")

		fx = fullMotionFacts()
		fx.PinVec.BoolWeld = false
		v, _, gated, _ = classifyDMBoolean(fx)
		require.Equal(t, verdictDrift, v,
			"the BOOLEAN over the pin vector is a conjunct of its own: an inequality-direction defect fails here even when the scalar matches")
		require.True(t, gated)

		fx = fullMotionFacts()
		fx.PinVec.Reconciles = false
		v, cls, gated, _ = classifyDMBoolean(fx)
		require.Equal(t, verdictDrift, v,
			"a vector delta that does not arithmetically produce the flip is drift, never motion")
		require.True(t, gated)
		require.Contains(t, cls, "motion-not-reconciled")
	})

	t.Run("conjunct (v): motion outside the freshness budget gates THERE", func(t *testing.T) {
		fx := fullMotionFacts()
		fx.Own.AgeSeconds = fx.BudgetSeconds + 1
		v, cls, gated, _ := classifyDMBoolean(fx)
		require.Equal(t, verdictDrift, v)
		require.True(t, gated)
		require.Contains(t, cls, "motion-outside-freshness-budget")

		fx = fullMotionFacts()
		fx.Own.AgeKnown = false
		v, _, gated, _ = classifyDMBoolean(fx)
		require.Equal(t, verdictWeldUnread, v, "an unknown sweep age cannot back a disclosed motion row")
		require.True(t, gated)

		fx = fullMotionFacts()
		fx.BudgetSeconds = 0
		v, _, gated, _ = classifyDMBoolean(fx)
		require.Equal(t, verdictWeldUnread, v, "no resolvable budget = cannot verify, never a free pass")
		require.True(t, gated)
	})
}

// TestClassifyDMBooleanHasNoMarginPredicate is mutant m3's kill: NO margin
// cutoff appears in ANY predicate — margins are evidence only (guardrail,
// both rulings verbatim: "gated=false is NOT an epsilon").
func TestClassifyDMBooleanHasNoMarginPredicate(t *testing.T) {
	// Structural: the classifier's input carries NO margin and NO threshold.
	// A margin cutoff needs a margin to cut on; the fact struct refuses to
	// carry one.
	typ := reflect.TypeOf(dmBooleanFacts{})
	for i := 0; i < typ.NumField(); i++ {
		name := strings.ToLower(typ.Field(i).Name)
		require.NotContains(t, name, "margin", "dmBooleanFacts must not carry a margin — margins are evidence, never a predicate input")
		require.NotContains(t, name, "threshold")
		require.NotContains(t, name, "epsilon")
	}

	// Behavioral, both directions of the cutoff mutant:
	// (a) a TINY implied margin with a FAILING conjunct must still gate — a
	// "small margins are motion" epsilon would disclose it;
	tiny := fullMotionFacts()
	tiny.Own.DebtUSDAtS = big.NewInt(1000001)
	tiny.Own.OurMax = big.NewInt(1000000) // implied S margin: 1 unit of USD-6
	tiny.MaxBorrowLegVerdict = verdictExact
	v, _, gated, _ := classifyDMBoolean(tiny)
	require.Equal(t, verdictDrift, v, "m3 kill: a one-unit margin cannot excuse a failed conjunct")
	require.True(t, gated)

	// (b) an ENORMOUS implied margin with EVERY conjunct proven must still
	// disclose — a "large margins are too big to be motion" cutoff would gate
	// it. Size is not a predicate in either direction.
	huge := fullMotionFacts()
	huge.Own.DebtUSDAtS, _ = new(big.Int).SetString("1000000000000000000", 10)
	huge.Own.OurMax = big.NewInt(1)
	v, cls, gated, _ := classifyDMBoolean(huge)
	require.Equal(t, verdictBoundaryMotion, v, "m3 kill: magnitude cannot block a fully-proven motion row either")
	require.False(t, gated)
	require.Contains(t, cls, "motion-proven")
}

// TestDMBooleanDriftNoteBranchesOnLegVerdicts is the D-013 note fix: the
// accept-r5 artifact printed "a boolean disagreement whose two inputs both
// weld exactly is a strict-inequality bug" over rows whose maxBorrow leg was
// sample-gap — a misdiagnosis in the receipt. The note now branches on the
// ACTUAL leg verdicts.
func TestDMBooleanDriftNoteBranchesOnLegVerdicts(t *testing.T) {
	// The one state where the diagnosis is TRUE: both legs exact.
	fx := fullMotionFacts()
	fx.MaxBorrowLegVerdict = verdictExact
	fx.DebtExactAtPin = true
	note := dmBooleanDriftNote(fx, "boolean-direction("+dmDirectionFalsePositive+")", []string{"conjunct (i) failed"})
	require.Contains(t, note, "strict-inequality bug",
		"both legs exact IS the strict-inequality state — the diagnosis belongs here")

	// The accept-r5 state: maxBorrow leg sample-gap. The old note printed the
	// strict-inequality diagnosis here, where it was FALSE.
	fx = fullMotionFacts()
	fx.DebtExactAtPin = false // any conjunct route into the drift note
	note = dmBooleanDriftNote(fx, "boolean-direction("+dmDirectionFalsePositive+")", []string{"conjunct (ii) failed"})
	require.NotContains(t, note, "strict-inequality bug",
		"D-013: the diagnosis must not print when its precondition (both legs exact) is false")
	require.Contains(t, note, verdictSampleGap, "the note names the actual maxBorrow leg verdict")

	// The false-negative direction is LOUDER and cross-references the
	// backtest frame.
	fx = fullMotionFacts()
	fx.Ours, fx.Chain = false, true
	fx.MaxBorrowLegVerdict = verdictDrift
	note = dmBooleanDriftNote(fx, "boolean-direction("+dmDirectionFalseNegative+")", nil)
	require.Contains(t, note, "RISK-HIDING")
	require.Contains(t, note, "backtest", "the FN direction cross-references the realized-liquidation backtest frame")

	// The motion note too: FN louder than FP.
	fnFx := fullMotionFacts()
	fnFx.Ours, fnFx.Chain = false, true
	require.Contains(t, dmMotionNote(fnFx), "RISK-HIDING")
	require.Contains(t, dmMotionNote(fnFx), "backtest")
	require.NotContains(t, dmMotionNote(fullMotionFacts()), "RISK-HIDING")
}

// TestDMMotionPopulationGate is mutant m4's kill: the ~1% population gate on
// the disclosed class — weather refuted by its own frequency is the sweep
// cadence collapsing.
func TestDMMotionPopulationGate(t *testing.T) {
	require.False(t, dmMotionPopulationGate(0, 9500))
	require.False(t, dmMotionPopulationGate(2, 9500), "the accept-r5 draw (2 over ~9.5k) is far inside the budget")
	require.False(t, dmMotionPopulationGate(95, 9500), "exactly 1% does not exceed ~1%")
	require.True(t, dmMotionPopulationGate(96, 9500), "m4 kill: exceeding ~1% gates")
	require.True(t, dmMotionPopulationGate(1, 50), "small universes gate on the first excess row")
	require.True(t, dmMotionPopulationGate(1, 0), "an empty evaluable universe cannot absorb any motion")

	// The census row: always emitted, gated=true, and it fails as
	// sweeper-health when the population gate fires.
	over := make([]dmMotionStat, 96)
	for i := range over {
		over[i] = dmMotionStat{direction: "boolean-boundary-crossing(motion-proven, " + dmDirectionFalsePositive + ")", margin: big.NewInt(int64(i + 1)), ageBlocks: 100, ageSeconds: 200}
	}
	row := dmMotionCensusRow(over, 9500, 5400)
	require.True(t, row.Gated)
	require.Equal(t, verdictDrift, row.Verdict, "m4 kill: the census row must GATE at >~1%")
	require.Equal(t, "sweeper-health", row.Class)

	quiet := dmMotionCensusRow([]dmMotionStat{
		{direction: "boolean-boundary-crossing(motion-proven, " + dmDirectionFalsePositive + ")", margin: big.NewInt(15075555), ageBlocks: 1378, ageSeconds: 2756},
		{direction: "boolean-boundary-crossing(motion-proven, " + dmDirectionFalseNegative + ")", margin: big.NewInt(70841134), ageBlocks: 1337, ageSeconds: 2674},
	}, 9500, 5400)
	require.True(t, quiet.Gated)
	require.Equal(t, verdictExact, quiet.Verdict)
	require.Equal(t, "1", quiet.Evidence["count_false_positive_at_pin"])
	require.Equal(t, "1", quiet.Evidence["count_false_negative_at_pin"])
	require.Equal(t, "15075555", quiet.Evidence["min_margin_usd6"])
	require.Equal(t, "70841134", quiet.Evidence["max_margin_usd6"])
	require.Contains(t, quiet.Evidence["max_sweep_age"], "1378 blocks")

	// A zero count is a statement, not an absence: the standing census exists
	// every run.
	zero := dmMotionCensusRow(nil, 9500, 5400)
	require.True(t, zero.Gated)
	require.Equal(t, verdictExact, zero.Verdict)
	require.Contains(t, zero.Actual, "0 motion row(s)")
}

// TestNeverSweptReshape is mutant m5's kill plus the whole reshaped law:
// refusal-weld consumed (not asserted), the age guard derived from the
// fleet's own watermarks, attempt-state disclosed, census denominator
// carried.
func TestNeverSweptReshape(t *testing.T) {
	t.Run("the race arithmetic (Wave H4a F2: per-generation, never fleet-min; Wave H5a round 4: completion-edge, never opening-edge)", func(t *testing.T) {
		const pin = uint64(1000)
		cy := func(g uint64, completed bool, spans map[uint64]snapshotdb.T6GenerationSpan) snapshotdb.T6SweepCycles {
			return snapshotdb.T6SweepCycles{
				Read: true, HaveGenerationRow: true,
				CurrentGeneration: g, CurrentCompleted: completed,
				Generations: spans,
			}
		}
		span := func(min, max uint64) snapshotdb.T6GenerationSpan {
			return snapshotdb.T6GenerationSpan{MinAttemptBlock: min, MaxAttemptBlock: max, Rows: 2}
		}

		race, _ := dmNeverSweptRace(0, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{3: span(50, 900)}))
		require.False(t, race, "unknown arrival fails CLOSED")

		race, why := dmNeverSweptRace(200, pin, snapshotdb.T6SweepCycles{})
		require.False(t, race, "Stage A never collected the cycle witness: missing cycle evidence GATES, never discloses")
		require.Contains(t, why, "unread")

		race, why = dmNeverSweptRace(200, pin, snapshotdb.T6SweepCycles{Read: true})
		require.True(t, race, "no sweep_generations row = no generation EVER opened = no completed cycle can exist (the stopped/never-started-sweeper shape — the census guard owns it en masse)")
		require.Contains(t, why, "no sweep_generations row")

		race, _ = dmNeverSweptRace(200, pin, cy(1, false, map[uint64]snapshotdb.T6GenerationSpan{1: span(500, 900)}))
		require.True(t, race, "generation 1 still open and nothing before it: no cycle can have completed since the arrival")

		race, why = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{3: span(150, 900)}))
		require.False(t, race,
			"Wave H5a (Codex round 4): the H4a opening-edge heuristic disclosed this (attempt 150 <= arrival 200), but the arrival OVERLAPS generation 3's open span [150, 900] — SweepWorkBatch re-queries the registry every batch, so the still-open generation was OWED this borrower and completed without attempting it: GATE")
		require.Contains(t, why, "OWED")

		race, why = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{3: span(250, 900)}))
		require.False(t, race,
			"m1 kill: generation 3 completed at or below the pin with its whole witnessed span above the arrival edge — a completed cycle since arrival that skipped the account is a sweeper defect, GATED")
		require.Contains(t, why, "skipped")

		race, why = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{3: span(150, 180)}))
		require.True(t, race,
			"the H5a disclosure path: generation 3's witnessed completion edge (180) sits strictly below the arrival (200) — every pin-completed cycle closed before this account existed")
		require.Contains(t, why, "completion edge")

		race, why = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{3: span(150, 200)}))
		require.False(t, race,
			"the exact-edge boundary: arrival == completion edge is overlap, not after — ambiguous chronology GATES")

		race, why = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{
			2: span(150, 400), 3: span(950, pin+200),
		}))
		require.False(t, race,
			"Wave H5a: the current generation completed ABOVE the pin, so the pin-completable candidate is generation 2 — a NON-CURRENT generation, whose completion edge the schema does not persist (its span only shrinks). The H4a shape disclosed this on generation 2's opening edge; unwitnessable chronology GATES")
		require.Contains(t, why, "not the current generation")

		race, _ = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{
			2: span(300, 400), 3: span(950, pin+200),
		}))
		require.False(t, race, "same shape with generation 2's whole span above the arrival: still no completion witness for a non-current generation — GATES")

		race, why = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{2: span(150, 400)}))
		require.False(t, race, "a generation stamped complete with NO visible attempt rows is sticky cycle evidence: GATED, never disclosed")
		require.Contains(t, why, "sticky")

		// THE F2 FALSE-PASS, reconstructed at the unit level: a stale straggler
		// success at block 100 pinned the OLD fleet-min floor below the
		// arrival (100 <= 200 => "race"), while the per-generation witness
		// says generation 3 opened at 250 — after the borrower — and completed
		// at 280, below the pin. The account it skipped must GATE.
		race, _ = dmNeverSweptRace(200, pin, cy(3, true, map[uint64]snapshotdb.T6GenerationSpan{
			3: span(250, 280),
		}))
		require.False(t, race,
			"the fleet-min shape false-passed exactly here: an old success below the arrival edge is not a cycle witness")
	})

	const pin = uint64(154963224)
	newBorrower := "d1fdf1bcb29d8709d1b2b82cc108d2a0755f8ce9"
	// base seeds one swept fleet member plus the never-swept borrower, with a
	// COMPLETED current generation whose witnessed attempt span is
	// [genMin, genMin+50] — so genMin+50 is the completion-edge witness the
	// H5a race law consumes (the fleet member's watermark no longer decides
	// anything).
	base := func(genMin uint64, firstDebt uint64, attempted bool, status string) (*p3Ctx, *snapshotdb.Task6Data, map[string]*big.Int) {
		c := &p3Ctx{pinOP: pin, o: &options{}}
		t6 := &snapshotdb.Task6Data{
			DMSweepByAccount: map[string]snapshotdb.T6SweepState{
				"aaaa": {AtOrBelowPin: genMin, Newest: genMin, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
			},
			DMFirstDebtBlock: map[string]uint64{newBorrower: firstDebt},
			DMSweepCycles: snapshotdb.T6SweepCycles{
				Read: true, HaveGenerationRow: true,
				CurrentGeneration: 3, CurrentCompleted: true,
				Generations: map[uint64]snapshotdb.T6GenerationSpan{
					3: {MinAttemptBlock: genMin, MaxAttemptBlock: genMin + 50, Rows: 1},
				},
			},
		}
		if attempted {
			t6.DMSweepByAccount[newBorrower] = snapshotdb.T6SweepState{Attempted: true, Status: status}
		}
		borrowers := map[string]*big.Int{"aaaa": big.NewInt(1), newBorrower: big.NewInt(40310720)}
		return c, t6, borrowers
	}
	rowFor := func(rows []p3Row, subject string) *p3Row {
		for i := range rows {
			if rows[i].Subject == "0x"+subject && rows[i].Leg == "collateral-testimony-at-pin" {
				return &rows[i]
			}
		}
		return nil
	}

	t.Run("honest race: disclosed coverage-gap, refusal CONSUMED, evidence complete", func(t *testing.T) {
		// The completed generation's witnessed COMPLETION edge (genMin+50 =
		// pin-4950) predates the borrower's arrival (pin-1000): every
		// pin-completed cycle closed before the borrower existed, so no cycle
		// has been owed it. The census is padded past 100 borrowers so the population
		// guard (owned by the en-masse subtest below) stays quiet and the
		// per-row law is isolated.
		c, t6, borrowers := base(pin-5000, pin-1000, false, "")
		for i := 0; i < 120; i++ {
			key := fmt.Sprintf("%040x", 0xf000+i)
			t6.DMSweepByAccount[key] = snapshotdb.T6SweepState{AtOrBelowPin: pin - 4000, Newest: pin - 4000, LegsAtOrBelowPin: 1, Status: "success", Attempted: true}
			borrowers[key] = big.NewInt(1)
		}
		rows, excluded := classifySweepTestimony(c, nil, t6, borrowers, nil)
		require.True(t, excluded[newBorrower], "coverage-gap accounts stay excluded from the evaluable universe")
		r := rowFor(rows, newBorrower)
		require.NotNil(t, r)
		require.False(t, r.Gated, "an honest race is DISCLOSED, not gated (risk-quant: any-never-swept-gates was stochastic on borrower arrival)")
		require.Equal(t, verdictUnscannable, r.Verdict)
		require.Contains(t, r.Class, "coverage-gap")
		require.NotEmpty(t, r.Evidence["refusal_proof"],
			"the refusal-weld is a CONSUMED read of risk.ComputeDMHealth — the proof string is the receipt")
		require.Contains(t, r.Evidence["refusal_proof"], "SweepBlock")
		require.Contains(t, r.Evidence["attempt_state"], "never-attempted")
		require.Contains(t, r.Evidence["cycle_witness"], "generation",
			"the race receipt names the generation evidence that carried the decision")
		require.NotEmpty(t, r.Evidence["sweep_cycle_state"])
		require.NotEmpty(t, r.Evidence["first_debt_block"])
		require.Zero(t, tallyP3(rows), "race + refusal-proven adds NO gated failure")
	})

	t.Run("completed cycle since arrival: GATED sweeper defect (m5 kill)", func(t *testing.T) {
		// The completed generation's witnessed completion edge (pin-50) sits
		// ABOVE the arrival (pin-1000): a full pass was open at or after the
		// borrower arrived, completed below the pin, and still skipped it.
		c, t6, borrowers := base(pin-100, pin-1000, true, "error")
		rows, excluded := classifySweepTestimony(c, nil, t6, borrowers, nil)
		require.True(t, excluded[newBorrower])
		r := rowFor(rows, newBorrower)
		require.NotNil(t, r)
		require.True(t, r.Gated,
			"m5 kill: older than one completed cycle is a sweeper defect — widening the guard to always-disclose is the vacuous-pass shape")
		require.Equal(t, sweepNever, r.Class)
		require.Contains(t, r.Evidence["attempt_state"], "attempted-and-failed",
			"chain-truth's minor: attempted-and-failed is a different fact from never-attempted, and Stage A now carries it")
		require.Equal(t, 1, tallyP3(rows))
	})

	t.Run("unknown arrival fails closed", func(t *testing.T) {
		c, t6, borrowers := base(pin-5000, 0, false, "")
		delete(t6.DMFirstDebtBlock, newBorrower)
		rows, _ := classifySweepTestimony(c, nil, t6, borrowers, nil)
		r := rowFor(rows, newBorrower)
		require.NotNil(t, r)
		require.True(t, r.Gated, "an account whose arrival edge custody cannot state cannot claim a race")
	})

	t.Run("the census denominator row exists every run and gates en masse", func(t *testing.T) {
		c, t6, borrowers := base(pin-5000, pin-1000, false, "")
		rows, _ := classifySweepTestimony(c, nil, t6, borrowers, nil)
		var census *p3Row
		for i := range rows {
			if rows[i].Subject == "cohort:never-swept" {
				census = &rows[i]
			}
		}
		require.NotNil(t, census, "the class carries its denominator every run")
		require.True(t, census.Gated)
		require.Equal(t, verdictDrift, census.Verdict,
			"1 coverage-gap over a 2-borrower census exceeds ~1% — the en-masse guard fires exactly here (a stopped sweeper classifies every arrival as a race per row; the population refutes it)")
		require.Equal(t, "sweeper-health", census.Class)
	})
}

// TestDMGateFrameDeclaresTheBooleanLegSources: every new read the boolean leg
// consumes is DECLARED (law 5) — the run's own input_frame_law fires on
// undeclared consumption, so the declaration is the license for the reads.
func TestDMGateFrameDeclaresTheBooleanLegSources(t *testing.T) {
	f := dmGateFrame()
	names := map[string]string{}
	for _, s := range f.Sources {
		names[s.Name] = s.Kind
	}
	require.Equal(t, framePinned, names[dmSClockLiquidatableSource],
		"the S-clock boolean custody weld's chain side (conjunct iii)")
	require.Equal(t, framePinned, names[dmSClockIndexSource])
	require.Equal(t, framePinned, names[dmPinVectorSource],
		"the Law@P pin-vector substitution (conjunct iv)")
	require.Equal(t, frameDerived, names[dmDebtFoldAtSSource],
		"the Stage-A debt fold at S is OUR state under test on the S-clock side")
	require.Equal(t, frameDerived, names[dmFirstDebtSource])
	require.Equal(t, frameDerived, names[dmSweepCycleSource],
		"the per-generation sweep-cycle witness (Wave H4a F2) is declared derived state")
	require.Equal(t, frameDerived, names[dmParamLedgerSource],
		"the raw DM config ledger prefix (Wave H4a F4) is declared derived state")
	require.Equal(t, framePinned, names[dmSweepAgeClockSource])
	require.Equal(t, frameCommitted, names[dmServingPostureSource],
		"the serving posture is committed code, consumed as a read")
}

// TestWeldDMCohortEmptyCohortStillStatesTheMotionCensus: the standing census
// is a statement every run makes, zero included.
func TestWeldDMCohortEmptyCohortStillStatesTheMotionCensus(t *testing.T) {
	rows, err := weldDMCohort(context.Background(), &p3Ctx{o: &options{}}, nil, nil, nil,
		dmTokenState{}, nil, nil, nil, 0)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "cohort:boundary-crossing-motion", rows[0].Subject)
	require.Equal(t, verdictExact, rows[0].Verdict)
}
