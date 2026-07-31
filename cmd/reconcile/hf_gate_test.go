package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/risk"
)

// TestNeverSeenSubjectsAreDerivedFromTheCommittedSeed makes the empty-set cohort
// reproducible from the repository alone (risk-quant R2's freeze rule): the
// committed addresses must be the first 20 bytes of
// sha256("solvent-p3-task6-neverseen-v1|" + i). A run-time draw over "addresses
// we have not seen" could never be reproduced by a reviewer.
func TestNeverSeenSubjectsAreDerivedFromTheCommittedSeed(t *testing.T) {
	require.Equal(t, "solvent-p3-task6-neverseen-v1", neverSeenSeed)
	require.GreaterOrEqual(t, len(neverSeenSubjects), aaveNeverSeenFloor,
		"at least the floor's worth of subjects must be committed")
	for i, want := range neverSeenSubjects {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d", neverSeenSeed, i)))
		require.Equal(t, "0x"+hex.EncodeToString(sum[:20]), want,
			"subject %d must be derivable from the committed seed", i)
	}
	// The bytes handed to Stage A must be the same 20-byte addresses.
	raw := neverSeenBytes()
	require.Len(t, raw, len(neverSeenSubjects))
	for i, b := range raw {
		require.Len(t, b, 20)
		require.Equal(t, common.HexToAddress(neverSeenSubjects[i]).Bytes(), b)
	}
	// And a spare margin exists: two subjects can turn out to be real addresses
	// (a gated failure each) and the floor still holds.
	require.GreaterOrEqual(t, len(neverSeenSubjects)-aaveNeverSeenFloor, 2)
}

// TestZeroControlChunksPutAControlInEveryChunk is chain-truth R1.4 made
// mechanical: "every multicall chunk that contains only expected-zero subjects
// MUST also carry >=1 known-nonzero control account whose value is independently
// gated in the same run". The alignment must hold for EVERY probe count, because
// an off-by-one in the interleave leaves one chunk of pure zeros.
func TestZeroControlChunksPutAControlInEveryChunk(t *testing.T) {
	control := multicallCall{Target: common.HexToAddress("0x1"), CallData: []byte{0xaa}}
	for n := 0; n <= 60; n++ {
		probes := make([]multicallCall, n)
		for i := range probes {
			probes[i] = multicallCall{Target: common.HexToAddress("0x2"), CallData: []byte{byte(i)}}
		}
		calls, controlIdx, probeIdx := zeroControlChunks(control, probes)
		require.Len(t, probeIdx, n, "n=%d: every probe must be placed", n)

		chunks := (len(calls) + multicallChunkSize - 1) / multicallChunkSize
		if n == 0 {
			require.Empty(t, calls)
			require.Empty(t, controlIdx)
			continue
		}
		require.Equal(t, chunks, len(controlIdx), "n=%d: one control per chunk, no more and no fewer", n)
		seen := map[int]bool{}
		for _, idx := range controlIdx {
			require.Equal(t, 0, idx%multicallChunkSize, "n=%d: a control must sit at a chunk boundary", n)
			seen[idx/multicallChunkSize] = true
			require.Equal(t, control.CallData, calls[idx].CallData)
		}
		for c := 0; c < chunks; c++ {
			require.True(t, seen[c], "n=%d: chunk %d carries NO control — its zeros would be indistinguishable from a lying default", n, c)
		}
		// And every probe index really points at its own call.
		for i, idx := range probeIdx {
			require.Equal(t, []byte{byte(i)}, calls[idx].CallData, "n=%d probe %d", n, i)
		}
	}
}

// TestMaxUint256IsTheZeroDebtMarker pins the marker itself. The mapping is
// EXPLICIT by law (risk-quant R1) because treating type(uint256).max as a
// magnitude is how "infinitely healthy" becomes "healthiest account on the book"
// in a sort.
func TestMaxUint256IsTheZeroDebtMarker(t *testing.T) {
	require.Equal(t, 256, maxUint256.BitLen())
	expect := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	require.Equal(t, 0, maxUint256.Cmp(expect))
	// It must never compare as a magnitude against a real health factor.
	realHF := mustBig("726460718055075032")
	require.Equal(t, 1, maxUint256.Cmp(realHF),
		"the marker sorts above every real HF, which is exactly why it must be mapped rather than compared")
}

// TestComponent4WitnessFindsANonzeroRemainder is risk-quant R1's sharpness
// clause: without at least one account x reserve whose (balance x price) has a
// nonzero remainder mod 10^dec, the weld cannot distinguish floor from half-up
// and proves LESS than it appears.
func TestComponent4WitnessFindsANonzeroRemainder(t *testing.T) {
	asset := common.HexToAddress("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee")
	// An 18-decimal balance against an 8-decimal price: the product almost
	// certainly has a nonzero remainder mod 1e18.
	h := risk.AaveHealth{Reserves: []risk.AaveReserveValue{{
		Asset: asset, Decimals: 18,
		LiveCollateral: mustBig("58420789594330"),
		LiveDebt:       new(big.Int),
		Price:          risk.PriceInput{Value: mustBig("209572000000")},
	}}}
	w := component4Witness("0xacct", h)
	require.NotEmpty(t, w, "an 18-dec balance x an 8-dec price must produce a nonzero remainder")
	require.Contains(t, w, "remainder=")
	require.Contains(t, w, "liveCollateral")

	// A product that divides EXACTLY provides no discriminator, and the witness
	// must say so by returning empty rather than pretending.
	exact := risk.AaveHealth{Reserves: []risk.AaveReserveValue{{
		Asset: asset, Decimals: 6,
		LiveCollateral: big.NewInt(1_000_000),
		LiveDebt:       new(big.Int),
		Price:          risk.PriceInput{Value: big.NewInt(1_000_000)},
	}}}
	require.Empty(t, component4Witness("0xacct", exact))

	// A reserve with no price contributes no witness (and must not panic).
	noPrice := risk.AaveHealth{Reserves: []risk.AaveReserveValue{{Asset: asset, Decimals: 18, LiveCollateral: big.NewInt(7)}}}
	require.Empty(t, component4Witness("0xacct", noPrice))
}

// TestBuildAaveCohortIsPopulationDerivedAndDeterministic pins R3's replacement
// for the infeasible >=20: ALL finite-HF borrowers (never a sample of them), the
// zero-debt subjects in census order, and the committed never-seen list. No
// seed, so the cohort is reproducible without one.
func TestBuildAaveCohortIsPopulationDerivedAndDeterministic(t *testing.T) {
	t6 := &snapshotdb.Task6Data{
		AaveBorrowerCensus: []string{"aa", "bb", "cc"},
		AaveZeroDebtCensus: []string{"dd", "ee"},
	}
	c1 := buildAaveCohort(t6)
	c2 := buildAaveCohort(t6)
	require.Equal(t, c1, c2, "cohort assembly must be deterministic")
	require.Len(t, c1.Finite, 3, "ALL finite-HF borrowers, not a sample")
	require.Equal(t, 3, c1.CensusFinite)
	require.Len(t, c1.ZeroDebt, 2)
	require.Len(t, c1.NeverSeen, len(neverSeenSubjects))
	require.True(t, c1.HasControl, "the first finite borrower is the nonzero control")
	require.Equal(t, common.HexToAddress("aa"), c1.Control)

	// With an EMPTY borrower census there is no control, and the probe must
	// refuse rather than run an all-zero chunk without one.
	empty := buildAaveCohort(&snapshotdb.Task6Data{})
	require.False(t, empty.HasControl)
}

// TestCohortFloorRowUsesThePopulationNotABareConstant pins the ruling both
// consults gave: a fixed constant above the population is a custody hazard, not
// a strengthening, so the floor is max(census, backstop) with the BASIS printed.
func TestCohortFloorRowUsesThePopulationNotABareConstant(t *testing.T) {
	// Population 12, backstop 10: the floor is the population, and 12 passes.
	row := cohortFloorRow(gateAaveHF, "finite", 12, 12, 10, "note")
	require.Equal(t, verdictExact, row.Verdict)
	require.Contains(t, row.Expected, "12")
	require.Contains(t, row.Expected, "population-derived census")

	// 11 of a 12-account population is a MISS: "all finite-HF borrowers" means all.
	row = cohortFloorRow(gateAaveHF, "finite", 11, 12, 10, "note")
	require.Equal(t, verdictCohortFloor, row.Verdict)
	require.True(t, row.Gated)

	// Backstop above the census is recorded AS a backstop, so a reader can see
	// the run is being held to a constant rather than to the book.
	row = cohortFloorRow(gateAaveHF, "zero-debt", 10, 3, 10, "note")
	require.Contains(t, row.Expected, "hard backstop")

	// EMPTY is always a failure, never a pass — even when the population is 0.
	row = cohortFloorRow(gateAaveHF, "empty", 0, 0, 0, "note")
	require.Equal(t, verdictCohortFloor, row.Verdict)
	require.Contains(t, row.Note, "Empty arrays are failures, never passes")
}

// TestCompareExactPutsTheChainOnTheExpectedSide pins chain-truth R5's direction
// convention for every row this phase emits. Swapping the sides per gate is how a
// reviewer stops being able to read a diff.
func TestCompareExactPutsTheChainOnTheExpectedSide(t *testing.T) {
	row := compareExact("g", "s", "leg", big.NewInt(7), big.NewInt(9), "cls")
	require.Equal(t, "7", row.Expected, "expected_chain")
	require.Equal(t, "9", row.Actual, "actual_derived")
	require.Equal(t, verdictDrift, row.Verdict)
	require.Equal(t, "cls", row.Class)
	require.Contains(t, row.Note, "tolerance ZERO")

	same := compareExact("g", "s", "leg", big.NewInt(7), big.NewInt(7), "cls")
	require.Equal(t, verdictExact, same.Verdict)
	require.True(t, same.Gated)
}

// TestTallyP3CountsOnlyGatedFailingVerdicts is the round-1 finding-1 regression.
//
// WHAT IT KILLS: tallyP3 previously counted "gated AND not exact" as failure,
// which swept in every richer verdict this gate set deliberately introduced — a
// provenance UPGRADE (B3's BEST outcome), a within-grace QUALIFIER, and a
// causation-proven intra-block MARGINAL case. exit 0 was therefore unreachable on
// an honest book. A gate that cannot pass is as useless as one that cannot fail.
func TestTallyP3CountsOnlyGatedFailingVerdicts(t *testing.T) {
	rows := []p3Row{
		{Gated: true, Verdict: verdictExact},
		{Gated: true, Verdict: verdictProvenanceUpgrade}, // SUCCESS
		{Gated: true, Verdict: verdictQualifier},         // SUCCESS
		{Gated: true, Verdict: verdictMarginal},          // SUCCESS (causation proven)
		{Gated: true, Verdict: verdictDrift},             // failure
		{Gated: true, Verdict: verdictWeldUnread},        // failure
		{Gated: true, Verdict: verdictBudgetFalsified},   // failure
		{Gated: false, Verdict: verdictEvidence},         // never counts
		{Gated: false, Verdict: verdictDrift},            // ungated: recorded, not gating
	}
	require.Equal(t, 3, tallyP3(rows),
		"only the three FAILING gated verdicts count; the upgrade, the qualifier and the marginal case are successes")
}

// TestEveryVerdictHasATallyClass is the completeness assertion the closed set
// needs: every verdict the gate set can emit must be classified on exactly one
// side of the pass/fail line, so a new verdict cannot slip in unclassified and be
// silently treated as a failure (or, worse, as a pass).
func TestEveryVerdictHasATallyClass(t *testing.T) {
	all := []string{
		verdictExact, verdictDrift, verdictWeldUnread, verdictCohortFloor,
		verdictOnlyInChain, verdictOnlyInRegistry, verdictAnomaly, verdictEvidence,
		verdictProvenanceUpgrade, verdictQualifier, verdictBudgetFalsified,
		verdictReResolution, verdictUnscannable, verdictUnexplained, verdictMarginal,
		verdictSampleGap,
	}
	for _, v := range all {
		inFail := failingVerdicts[v]
		inPass := passingVerdicts[v]
		if v == verdictEvidence {
			// Evidence rows are never gated, so they are outside both sets by
			// construction; asserting that keeps the exemption explicit.
			require.False(t, inFail, "%s must not be classified as failing", v)
			require.False(t, inPass, "%s is ungated evidence and needs no pass class", v)
			continue
		}
		require.NotEqual(t, inFail, inPass,
			"verdict %q must be in EXACTLY one of failingVerdicts / passingVerdicts", v)
	}
	// And the predicate agrees with the sets, for every verdict.
	for _, v := range all {
		if passingVerdicts[v] {
			require.False(t, verdictIsFailure(v), "%s is a success", v)
		} else {
			require.True(t, verdictIsFailure(v), "%s is a failure", v)
		}
	}
	// An UNRECOGNISED verdict fails closed: a verdict nobody classified is a
	// verdict nobody reasoned about.
	require.True(t, verdictIsFailure("some-verdict-nobody-classified"))
}

// TestMarginalIsDisclosedNotAbsorbedAndNotAFailure states the intra-block band's
// corrected semantics. "Disclosed, not absorbed" means the case is listed
// INDIVIDUALLY with its margin and its causation evidence — it does NOT mean the
// run fails. The gated third state (UNEXPLAINED) is what fails, and it is a
// separate verdict.
func TestMarginalIsDisclosedNotAbsorbedAndNotAFailure(t *testing.T) {
	require.Zero(t, tallyP3([]p3Row{{Gated: true, Verdict: verdictMarginal}}),
		"a causation-PROVEN intra-block flip is a success: the boolean was reproduced in the execution frame")
	require.Equal(t, 1, tallyP3([]p3Row{{Gated: true, Verdict: verdictUnexplained}}),
		"the UNEXPLAINED third state is the one that fails — a false negative the block's own witnesses do not explain")
	require.Contains(t, tolIntraBlockMarginality.String(), "never absorption")
}
