// Wave H5a regression tests — the Codex round-4 HIGH on the H4a cycle-witness
// law, pinned by the designed mutant it must kill
// (testdata/mutation-transcripts/wave-h5a.md):
//
//	m1  the never-swept race guard decides on COMPLETION-EDGE arithmetic,
//	    never on a candidate generation's opening edge. The H4a heuristic
//	    took "generation K attempted at some block <= firstDebt" as proof the
//	    borrower arrived too late for K — but internal/snapshot's Step
//	    completes a generation only after store.SweepWorkBatch (a dynamic
//	    registry re-query, every batch) returns EMPTY, so a borrower
//	    appearing while a generation is still OPEN is OWED by that
//	    generation. Codex's scenario: generation 7 attempts a peer at block
//	    100, the borrower's first debt lands at 200, another attempt lands at
//	    300, generation 7 completes at or below the pin without ever
//	    attempting the borrower. H4a disclosed honest-race (100 <= 200) — a
//	    pass-that-should-fail. H5a GATES any first-debt block that does not
//	    strictly exceed the pin-completed generation's witnessed completion
//	    edge (max attempt block over the CURRENT generation's complete row
//	    set — the only completion witness today's schema can state).
package main

import (
	"fmt"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// TestNeverSweptOverlapGates is Codex round 4's exact 100/200/300 scenario,
// end to end through classifySweepTestimony:
//
//   - generation 7 (the CURRENT generation) attempts a peer at block 100;
//   - the borrower's first debt event lands at block 200;
//   - generation 7 attempts another peer at block 300, then COMPLETES at or
//     below the pin — without ever attempting the borrower.
//
// H4a verdict: MinAttemptBlock(100) <= firstDebt(200) => "generation 7 opened
// at or before the arrival" => honest race, DISCLOSED. But SweepWorkBatch
// re-queries the debt registry on every batch and Step completes a generation
// only after an EMPTY query, so generation 7 — still open when the borrower
// arrived — was OWED the borrower and completed without reading it.
// H5a verdict: firstDebt(200) <= completion edge(300) => the arrival OVERLAPS
// the completed generation's open span => GATED.
func TestNeverSweptOverlapGates(t *testing.T) {
	const pin = uint64(1000)
	peerEarly := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	peerLate := "cccccccccccccccccccccccccccccccccccccccc"
	borrower := "d1fdf1bcb29d8709d1b2b82cc108d2a0755f8ce9"

	c := &p3Ctx{pinOP: pin, o: &options{}}
	t6 := &snapshotdb.Task6Data{
		DMSweepByAccount: map[string]snapshotdb.T6SweepState{
			// Generation 7's two witnessed attempts: block 100 and block 300.
			peerEarly: {AtOrBelowPin: 100, Newest: 100, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
			peerLate:  {AtOrBelowPin: 300, Newest: 300, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
		},
		DMFirstDebtBlock: map[string]uint64{borrower: 200},
		DMSweepCycles: snapshotdb.T6SweepCycles{
			Read: true, HaveGenerationRow: true,
			CurrentGeneration: 7, CurrentCompleted: true,
			Generations: map[uint64]snapshotdb.T6GenerationSpan{
				// The CURRENT generation's complete row set: attempts
				// [100, 300], completed at or below the pin. 300 is its
				// completion-edge witness.
				7: {MinAttemptBlock: 100, MaxAttemptBlock: 300, Rows: 2},
			},
		},
	}
	borrowers := map[string]*big.Int{
		peerEarly: big.NewInt(1),
		peerLate:  big.NewInt(1),
		borrower:  big.NewInt(40310720),
	}

	// The H4a arithmetic, reconstructed for the record: the opening-edge
	// witness (an attempt at or below the arrival) HOLDS here, so the old law
	// would have disclosed this borrower as an honest race.
	span := t6.DMSweepCycles.Generations[7]
	require.LessOrEqual(t, span.MinAttemptBlock, uint64(200),
		"the H4a predicate (MinAttemptBlock <= firstDebt) holds: the opening-edge heuristic FALSE-PASSES exactly this shape")
	require.LessOrEqual(t, span.MaxAttemptBlock, pin,
		"generation 7 completed at or below the pin — it IS the pin-completed candidate")

	rows, excluded := classifySweepTestimony(c, nil, t6, borrowers, nil)
	require.True(t, excluded[borrower])
	var r *p3Row
	for i := range rows {
		if rows[i].Subject == "0x"+borrower && rows[i].Leg == "collateral-testimony-at-pin" {
			r = &rows[i]
		}
	}
	require.NotNil(t, r)
	require.True(t, r.Gated,
		"m1 kill (Codex round 4 HIGH): the borrower's first debt block 200 OVERLAPS generation 7's open span [100, 300] — SweepWorkBatch re-queries the registry every batch, so the still-open generation was OWED this borrower and completed without attempting it. The H4a opening-edge heuristic disclosed exactly this shape (100 <= 200)")
	require.Equal(t, sweepNever, r.Class)
	require.NotContains(t, r.Class, "coverage-gap")
	require.Contains(t, r.Evidence["cycle_witness"], "GATE",
		"the receipt states why the race is not claimable")
	require.Contains(t, r.Evidence["cycle_witness"], "completion edge 300",
		"the receipt prints the completion-edge arithmetic")
	require.Contains(t, r.Evidence["cycle_witness"], "first debt block 200",
		"the receipt prints the arrival side of the arithmetic")
	require.Equal(t, 1, tallyP3(rows), "exactly one gated failure: the overlapped borrower")
}

// TestNeverSweptCompletionEdgeDiscloses is the H5a disclosure counterpart on
// the same fixture shape: the borrower's first debt block (400) strictly
// exceeds generation 7's witnessed completion edge (300), so every cycle that
// ever completed at or below the pin had already closed before the borrower
// existed — the honest race, disclosed with the completion-edge receipt.
func TestNeverSweptCompletionEdgeDiscloses(t *testing.T) {
	const pin = uint64(1000)
	peerEarly := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	peerLate := "cccccccccccccccccccccccccccccccccccccccc"
	borrower := "d1fdf1bcb29d8709d1b2b82cc108d2a0755f8ce9"

	c := &p3Ctx{pinOP: pin, o: &options{}}
	t6 := &snapshotdb.Task6Data{
		DMSweepByAccount: map[string]snapshotdb.T6SweepState{
			peerEarly: {AtOrBelowPin: 100, Newest: 100, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
			peerLate:  {AtOrBelowPin: 300, Newest: 300, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
		},
		DMFirstDebtBlock: map[string]uint64{borrower: 400},
		DMSweepCycles: snapshotdb.T6SweepCycles{
			Read: true, HaveGenerationRow: true,
			CurrentGeneration: 7, CurrentCompleted: true,
			Generations: map[uint64]snapshotdb.T6GenerationSpan{
				7: {MinAttemptBlock: 100, MaxAttemptBlock: 300, Rows: 2},
			},
		},
	}
	// Pad the census past 100 borrowers so the ~1% population guard (owned by
	// its own tests) stays quiet and the per-row law is isolated.
	borrowers := map[string]*big.Int{
		peerEarly: big.NewInt(1),
		peerLate:  big.NewInt(1),
		borrower:  big.NewInt(40310720),
	}
	for i := 0; i < 120; i++ {
		key := fmt.Sprintf("%040x", 0xf000+i)
		t6.DMSweepByAccount[key] = snapshotdb.T6SweepState{AtOrBelowPin: 300, Newest: 300, LegsAtOrBelowPin: 1, Status: "success", Attempted: true}
		borrowers[key] = big.NewInt(1)
	}

	rows, excluded := classifySweepTestimony(c, nil, t6, borrowers, nil)
	require.True(t, excluded[borrower], "coverage-gap accounts stay excluded from the evaluable universe")
	var r *p3Row
	for i := range rows {
		if rows[i].Subject == "0x"+borrower && rows[i].Leg == "collateral-testimony-at-pin" {
			r = &rows[i]
		}
	}
	require.NotNil(t, r)
	require.False(t, r.Gated,
		"first debt 400 > completion edge 300: every pin-completed cycle closed before the borrower existed — the honest race is DISCLOSED, not gated")
	require.Equal(t, verdictUnscannable, r.Verdict)
	require.Contains(t, r.Class, "coverage-gap")
	require.Contains(t, r.Evidence["cycle_witness"], "completion edge 300",
		"the disclosure receipt prints the completion-edge arithmetic too")
	require.Contains(t, r.Evidence["cycle_witness"], "first debt block 400")
	require.Zero(t, tallyP3(rows), "race + refusal-proven adds NO gated failure")
}
