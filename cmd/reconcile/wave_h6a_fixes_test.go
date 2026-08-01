// Wave H6a regression tests — the Codex round-5 HIGH on the H5a completion-edge
// race law, pinned by the designed mutant it must kill
// (testdata/mutation-transcripts/wave-h6a.md):
//
//	m1  a failed sweep attempt must never be laundered into an honest race.
//	    The H5a never-swept branch called dmNeverSweptRace on completion-edge
//	    arithmetic alone: first debt 200 > completion edge 100 => disclosed
//	    coverage-gap. But the account's OWN snapshot_sweeps row can say
//	    attempted=true / status=failed — the completed cycle REACHED the
//	    account and exhausted retries (a lagging RPC exec clock can stamp
//	    that attempt below the first-debt block, exactly the exec-block-lag
//	    residue the H5a doc comment already named as unwitnessable). A
//	    positive attempt witness is proof of sampling, so the never-reached
//	    race exemption is unavailable — whatever the edge arithmetic says.
//	    A failure never widens into an exemption: fail closed, stay gated.
package main

import (
	"fmt"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// TestNeverSweptFailedAttemptGates is Codex round 5's exact scenario, end to
// end through classifySweepTestimony:
//
//   - generation 7 (the CURRENT generation) completes at or below the pin with
//     witnessed attempt span [50, 100] — its completion edge is 100;
//   - the borrower's first debt event lands at block 200 (a lagging RPC
//     execution stamped the borrower's own failed attempt at or below 100);
//   - the borrower's OWN snapshot_sweeps row says attempted=true,
//     status=failed: generation 7 REACHED it and exhausted retries;
//   - peer rows are all successful, and the census is padded past 100
//     borrowers so the ~1% population guard stays quiet — the false green
//     Codex names: a large census leaves the one laundered failure unsampled.
//
// Pre-H6a verdict: firstDebt(200) > completion edge(100) => honest race,
// DISCLOSED — a pass-that-should-fail (the account's own row proves the
// completed cycle sampled it). H6a verdict: an attempted account can never
// claim the never-reached exemption => GATED.
func TestNeverSweptFailedAttemptGates(t *testing.T) {
	const pin = uint64(1000)
	peerEarly := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	peerLate := "cccccccccccccccccccccccccccccccccccccccc"
	borrower := "d1fdf1bcb29d8709d1b2b82cc108d2a0755f8ce9"

	c := &p3Ctx{pinOP: pin, o: &options{}}
	t6 := &snapshotdb.Task6Data{
		DMSweepByAccount: map[string]snapshotdb.T6SweepState{
			// Generation 7's successful peers at blocks 50 and 100.
			peerEarly: {AtOrBelowPin: 50, Newest: 50, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
			peerLate:  {AtOrBelowPin: 100, Newest: 100, LegsAtOrBelowPin: 1, Status: "success", Attempted: true},
			// The borrower's OWN row: attempted and FAILED — no success at any
			// height (Newest 0), no legs the pin can see. The completed cycle
			// reached this account; retries were exhausted.
			borrower: {AtOrBelowPin: 0, Newest: 0, LegsAtOrBelowPin: 0, Status: "failed", Attempted: true},
		},
		DMFirstDebtBlock: map[string]uint64{borrower: 200},
		DMSweepCycles: snapshotdb.T6SweepCycles{
			Read: true, HaveGenerationRow: true,
			CurrentGeneration: 7, CurrentCompleted: true,
			Generations: map[uint64]snapshotdb.T6GenerationSpan{
				// The CURRENT generation's complete row set: attempts [50, 100]
				// (the borrower's failed attempt is stamped inside it, at or
				// below 100), completed at or below the pin. 100 is its
				// completion-edge witness — strictly below firstDebt 200, so
				// the pre-H6a arithmetic disclosed exactly this shape.
				7: {MinAttemptBlock: 50, MaxAttemptBlock: 100, Rows: 123},
			},
		},
	}
	borrowers := map[string]*big.Int{
		peerEarly: big.NewInt(1),
		peerLate:  big.NewInt(1),
		borrower:  big.NewInt(40310720),
	}
	// Pad the census past 100 borrowers with successful rows so the ~1%
	// population guard (owned by its own tests) stays quiet: the census row
	// CANNOT catch this account, only the per-row law can — Codex's
	// false-green vector.
	for i := 0; i < 120; i++ {
		key := fmt.Sprintf("%040x", 0xf000+i)
		t6.DMSweepByAccount[key] = snapshotdb.T6SweepState{AtOrBelowPin: 100, Newest: 100, LegsAtOrBelowPin: 1, Status: "success", Attempted: true}
		borrowers[key] = big.NewInt(1)
	}

	// The pre-H6a arithmetic, reconstructed for the record: the completion-edge
	// disclosure predicate (firstDebt > MaxAttemptBlock) HOLDS here, so the
	// edge law ALONE would disclose this borrower as an honest race.
	span := t6.DMSweepCycles.Generations[7]
	require.Greater(t, uint64(200), span.MaxAttemptBlock,
		"the H5a disclosure predicate (firstDebt > completion edge) holds: edge arithmetic alone FALSE-PASSES exactly this shape")
	require.True(t, t6.DMSweepByAccount[borrower].Attempted,
		"the borrower's own row witnesses the attempt — the fact the classifier must consume")

	rows, excluded := classifySweepTestimony(c, nil, t6, borrowers, nil)
	require.True(t, excluded[borrower], "never-swept accounts stay excluded from the evaluable universe")
	var r *p3Row
	for i := range rows {
		if rows[i].Subject == "0x"+borrower && rows[i].Leg == "collateral-testimony-at-pin" {
			r = &rows[i]
		}
	}
	require.NotNil(t, r)
	require.True(t, r.Gated,
		"m1 kill (Codex round 5 HIGH): the borrower's own snapshot_sweeps row says attempted=true/status=failed — generation 7 REACHED it and exhausted retries, so the never-reached race exemption is unavailable no matter that firstDebt 200 > completion edge 100 (a lagging exec clock stamps attempts below arrivals). A failure must never widen into an exemption")
	require.Equal(t, sweepNever, r.Class)
	require.NotContains(t, r.Class, "coverage-gap",
		"attempted-and-failed is a sweeper/coverage failure, never an honest race")
	require.Contains(t, r.Evidence["attempt_state"], "attempted-and-failed")
	require.Contains(t, r.Evidence["cycle_witness"], "attempted=true",
		"the receipt names the account's own attempt row as the fact that carried the decision")
	require.Equal(t, 1, tallyP3(rows), "exactly one gated failure: the laundered borrower")
}

// TestNeverSweptAttemptedKillsEveryExemption pins the H6a conjunct at the
// classifier layer: attempted=true makes the never-reached exemption
// unavailable on EVERY disclosure shape dmNeverSweptRace can produce — not
// just the completion-edge one — while attempted=false leaves each shape's
// H5a verdict untouched (no overcorrection).
func TestNeverSweptAttemptedKillsEveryExemption(t *testing.T) {
	const pin = uint64(1000)
	attempted := snapshotdb.T6SweepState{Attempted: true, Status: "failed"}
	virgin := snapshotdb.T6SweepState{}
	cy := func(g uint64, completed bool, spans map[uint64]snapshotdb.T6GenerationSpan) snapshotdb.T6SweepCycles {
		return snapshotdb.T6SweepCycles{
			Read: true, HaveGenerationRow: true,
			CurrentGeneration: g, CurrentCompleted: completed,
			Generations: spans,
		}
	}
	edgeBelowArrival := cy(7, true, map[uint64]snapshotdb.T6GenerationSpan{
		7: {MinAttemptBlock: 50, MaxAttemptBlock: 100, Rows: 3},
	})

	// Shape 1 — the Codex round-5 launder: completion edge 100 < firstDebt 200.
	race, why := dmNeverSweptRace(200, pin, virgin, edgeBelowArrival)
	require.True(t, race, "H5a preserved: an UNattempted account past the completion edge is still the honest race")
	race, why = dmNeverSweptRace(200, pin, attempted, edgeBelowArrival)
	require.False(t, race,
		"the H6a conjunct: the account's own attempt row proves the cycle reached it — the edge arithmetic cannot launder the failure into a race")
	require.Contains(t, why, "attempted=true", "the receipt names the attempt witness")
	require.Contains(t, why, `"failed"`, "the receipt carries the row's own status")

	// Shape 2 — no sweep_generations row (the never-started-sweeper disclosure).
	race, _ = dmNeverSweptRace(200, pin, virgin, snapshotdb.T6SweepCycles{Read: true})
	require.True(t, race, "H5a preserved: no generation ever opened discloses for an unattempted account")
	race, why = dmNeverSweptRace(200, pin, attempted, snapshotdb.T6SweepCycles{Read: true})
	require.False(t, race,
		"an attempt row with NO generation row is contradictory sticky evidence — the attempt witness overrides the never-started shape too")
	require.Contains(t, why, "attempted=true")

	// Shape 3 — first generation still open, nothing before it (k == 0).
	stillOpen := cy(1, false, map[uint64]snapshotdb.T6GenerationSpan{1: {MinAttemptBlock: 500, MaxAttemptBlock: 900, Rows: 2}})
	race, _ = dmNeverSweptRace(200, pin, virgin, stillOpen)
	require.True(t, race, "H5a preserved: an open first generation owes the unattempted borrower — still in flight")
	race, why = dmNeverSweptRace(200, pin, attempted, stillOpen)
	require.False(t, race,
		"sampled-and-failed is not in-flight: the attempt witness gates even when no cycle has completed")
	require.Contains(t, why, "attempted=true")

	// The fail-closed preconditions still precede the attempt witness.
	race, why = dmNeverSweptRace(0, pin, attempted, edgeBelowArrival)
	require.False(t, race, "unknown arrival still fails closed")
	race, why = dmNeverSweptRace(200, pin, attempted, snapshotdb.T6SweepCycles{})
	require.False(t, race, "an unread cycle witness still fails closed")
}
