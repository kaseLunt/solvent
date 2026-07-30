package main

// Wave-7 fixes for Codex round 6 (session 019fb3c0-b5eb-7cf1-a25a-18dd44cf309f,
// reviewed @ 1bc660e), governed by the NORMATIVE chain-truth ruling archived
// verbatim at .superpowers/sdd/p3-consults/chain-truth-basket-continuity-ruling.md.
//
//   H1  classifyIntraBlock consulted replayComplete BEFORE the parent
//       predicate, so a LATER witness refusal (e.g. a cross-token repayment)
//       rewrote a proven true-at-parent fact into gated UNEXPLAINED. Later
//       writes cannot invalidate the already-pinned parent fact. The fix
//       SPLITS parent-state completeness (the parent fold succeeded AND the
//       parent index reconstruction succeeded) from boundary-replay
//       completeness: the true-at-parent arm consults only the former;
//       crossing-based (marginal) arms require the latter.
//   L1  (ruling, verbatim) classifyIntraBlock gains a basketContinuityProven
//       conjunct on the eligFlippedWithWitness arm ONLY. Default false — NO
//       code path sets it true in this wave; only the L2 boundary-basket
//       continuity proof (the designed next wave) may. While false, every
//       marginal candidate resolves UNEXPLAINED with evidence key
//       basket_continuity carrying the ruling's disclosure text.
//   L5  (ruling, verbatim) per-token AGGREGATE seizure preflight before
//       applying ANY part of a Liquidated write; on insufficiency NOTHING is
//       applied and the refusal note names BOTH honest explanations — (a) an
//       unseen pre-pass inbound transfer (the H2 unseen move; evidence, never
//       excuse) and (b) the netting release (parent legs are netted, seizure
//       operates un-netted after _cancelOldWithdrawal). The silent collateral
//       clamp at the old :1680-1683 is REMOVED (it was a no-silent-caps
//       violation inside Complete()'s own evidence chain).
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation. Each mutant below must
// be killed by the named tests; after the suite passes, every mutant is CUT
// locally, the tests run, the kill confirmed, and the code restored
// (sha256-verified). Behavioural mutants only; a mutant that fails to compile
// is re-cut.
//
//   m1  restore replayComplete gating the true-at-parent arm (reorder
//       classifyIntraBlock so the !replayComplete arm precedes the parent
//       predicate again — the round-6 H1 defect).
//       KILLED BY: TestParentEligibleSurvivesLaterWitnessRefusal
//       (the composed verdict regresses to UNEXPLAINED under the mutant).
//   m2  delete the L1 basketContinuityProven conjunct from the marginal arm
//       (a proven, corroborated, complete-replay crossing passes marginal
//       again with no continuity proof).
//       KILLED BY: TestProvenCrossingIsContinuityGatedUnexplained
//       (the composed verdict becomes marginal-disclosed, the
//       tolIntraBlockMarginality tolerance is spent, and the
//       basket_continuity evidence key vanishes under the mutant).
//   m3  restore the silent over-seizure clamp (apply-with-clamp, no note:
//       subtract the seized amount and floor the leg at zero).
//       KILLED BY: TestOverSeizureRefusesEntireWrite (Applied becomes 1,
//       Proven flips true, the refusal note vanishes and Complete() stays
//       true under the mutant).
// ---------------------------------------------------------------------------
//
// FIXTURE-BACKED-OVER-TRANSCRIBED (Task 6 round-3 law): every ABI-shaped
// payload is packed by the SAME dmWitnessABI object that p3_witness_abi_test.go
// pins field-by-field against the committed forge artifact AND the captured
// logs. No hand-transcribed word offsets.

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// basketContinuityUnprovenText is the ruling's L1/L4 disclosure text, pinned
// LITERALLY (not via the production constant) so a drifted disclosure fails.
const basketContinuityUnprovenText = "unproven: Safe collateral moves without DM events (derivation-notes caveat 4) and the netting term moves without transfers (CashLens.sol:544-546)"

// --- H1: a proven parent verdict survives a later witness refusal -----------

// TestParentEligibleSurvivesLaterWitnessRefusal is Codex round 6 H1's
// counterexample through the production composition: the account is ELIGIBLE
// at the parent boundary (a pinned N-1 fact), and a LATER same-block witness
// is a cross-token repayment the single-debt-token model refuses (a note, so
// boundary-replay completeness fails). The refusal is honest evidence about
// the BOUNDARY, but it cannot rewrite the parent fact: true-at-parent rests
// entirely on parent-state completeness and makes no intra-block claim
// (ruling, Part 2). The composed verdict must be true-at-parent EXACT, not
// gated UNEXPLAINED. Kills m1.
func TestParentEligibleSurvivesLaterWitnessRefusal(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	otherToken := common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58")
	acctHex := hexLower(acct.Hex())

	// Parent boundary: normalized debt $100.000001 at index 1e18 against a
	// $100.000000 basket at LT 100% — eligible under the strict > BEFORE any
	// in-block write.
	n := big.NewInt(100_000_001)
	// The later refusal: a cross-token repayment FOR this account (topic3 is
	// NOT the case's debt token) — the model refuses its debt leg, notes, and
	// boundary-replay completeness fails.
	crossRepay := packedWitness(t, "Repaid", 2, acctHex, acctHex,
		hexLower(otherToken.Hex()), big.NewInt(1_000_000))

	row := compositionRow(n, n, wad, []snapshotdb.T6Witness{crossRepay})
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, _ := driveObligation2(t, row, parent, exec, acct)
	require.Equal(t, "true-at-parent", o2.eligState,
		"a valid true-at-parent result was rewritten to gated UNEXPLAINED by a later refusal (round-6 H1): the parent fact is pinned at N-1 and a later write cannot invalidate it")
	require.Equal(t, verdictExact, o2.row.Verdict,
		"the binding gate rule: parent true is an exact pass")
	require.Contains(t, o2.row.Evidence["same_block_replay_notes"], "DIFFERENT borrow token",
		"the refusal stays disclosed as evidence — surviving it is not suppressing it")
	require.Equal(t, "false", o2.row.Evidence["same_block_replay_complete"],
		"boundary-replay completeness is honestly false; it just no longer gates the parent arm")

	// Replay-level: the parent reconstruction succeeded while the boundary
	// replay is incomplete — exactly the split the classifier must honor.
	r := replaySameBlockCauses([]snapshotdb.T6Witness{crossRepay}, replayTestDM, acct, replayTestUSDC, replayParentState{
		NormalizedAtParent: n, IndexAtBlock: new(big.Int).Set(wad),
		Collateral: parent.st.collateral, Prices: parent.st.prices, Configs: parent.st.configs,
		Decimals: map[common.Address]uint8{tokA: 6},
	})
	require.True(t, r.InitialEligible, "the parent fact: eligible at N-1")
	require.True(t, r.ParentComplete, "the parent fold and index reconstruction both succeeded — PARENT completeness holds")
	require.False(t, r.Complete(), "the cross-token refusal taints BOUNDARY completeness")
	require.NotEmpty(t, r.Notes)
	require.Equal(t, "true", o2.row.Evidence["same_block_replay_parent_complete"],
		"the split is disclosed: parent completeness true, boundary completeness false")
}

// TestParentIneligibleIncompleteReplayStaysUnexplained is the guard on the H1
// split: a parent-INeligible case with the SAME incomplete replay must still
// resolve UNEXPLAINED — the split narrows what replay completeness gates, it
// must not widen true-at-parent.
func TestParentIneligibleIncompleteReplayStaysUnexplained(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	otherToken := common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58")
	acctHex := hexLower(acct.Hex())

	// Parent boundary: debt $50.000000 against maxBorrowLT $100.000000 —
	// INELIGIBLE at N-1.
	n := big.NewInt(50_000_000)
	crossRepay := packedWitness(t, "Repaid", 2, acctHex, acctHex,
		hexLower(otherToken.Hex()), big.NewInt(1_000_000))

	row := compositionRow(n, n, wad, []snapshotdb.T6Witness{crossRepay})
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, _ := driveObligation2(t, row, parent, exec, acct)
	require.Equal(t, verdictUnexplained, o2.row.Verdict,
		"parent-ineligible + incomplete boundary replay is still gated UNEXPLAINED — the H1 split must not become a widening")
	require.Equal(t, verdictUnexplained, o2.eligState)
}

// --- L1: the continuity conjunct gates every marginal candidate -------------

// TestProvenCrossingIsContinuityGatedUnexplained is the L1 posture: a
// crossing the replay genuinely PROVES (an earlier InterestIndexUpdated whose
// decoded move crosses the threshold), holding to the boundary, with a fully
// complete replay and corroborating recomputation — the pre-ruling
// marginal-disclosed shape. Under L1 the marginal arm additionally requires
// basketContinuityProven, which NOTHING sets true in this wave: Safe
// collateral moves without DM events (derivation-notes caveat 4) and the
// netting term moves without transfers (CashLens.sol:544-546), so an unseen
// same-block basket move could be the actual cause and the attribution is
// uncertifiable. The verdict must be UNEXPLAINED with the disclosure carried
// under the basket_continuity evidence key. Kills m2.
//
// L1-era expectation; flips back to marginal-disclosed when L2 lands (see
// chain-truth-basket-continuity-ruling.md).
func TestProvenCrossingIsContinuityGatedUnexplained(t *testing.T) {
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	usdcHex := hexLower(replayTestUSDC.Hex())
	n := big.NewInt(100_000_000)

	idxW := packedWitness(t, "InterestIndexUpdated", 2, usdcHex, "", "",
		new(big.Int).Set(wad), idxOnePlusTick())
	row := compositionRow(n, n, idxOnePlusTick(), []snapshotdb.T6Witness{idxW})
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, f := driveObligation2(t, row, parent, exec, acct)
	require.Equal(t, verdictUnexplained, o2.row.Verdict,
		"a marginal candidate without a basket-continuity proof claims an attribution no custody supports (ruling L1); it must resolve UNEXPLAINED, not marginal-disclosed")
	require.Equal(t, verdictUnexplained, o2.eligState)
	require.Equal(t, basketContinuityUnprovenText, o2.row.Evidence["basket_continuity"],
		"the unproven state is DISCLOSED verbatim under the basket_continuity evidence key (ruling L1/L4)")
	require.Contains(t, o2.row.Note, "BASKET CONTINUITY",
		"the narrative must say WHY the proven crossing does not earn marginal")
	require.Empty(t, f.cited,
		"no marginal pass, no tolerance spent: citing tolIntraBlockMarginality without the continuity proof would be the silent-cap class")

	// The replay-level machinery is UNCHANGED and must stay pinned — it is
	// what the L2 wave certifies: the crossing is still proven, still holds
	// to the boundary, and the replay is complete.
	r := replaySameBlockCauses([]snapshotdb.T6Witness{idxW}, replayTestDM, acct, replayTestUSDC, replayParentState{
		NormalizedAtParent: n, IndexAtBlock: idxOnePlusTick(),
		Collateral: parent.st.collateral, Prices: parent.st.prices, Configs: parent.st.configs,
		Decimals: map[common.Address]uint8{tokA: 6},
	})
	require.True(t, r.Proven, "the replay still PROVES the crossing — L1 gates the verdict, not the machinery")
	require.True(t, r.BoundaryEligible)
	require.True(t, r.Complete())
	require.False(t, r.InitialEligible)
}

// TestTrueAtParentCarriesNoContinuityKey pins L1's scope: true-at-parent is
// NOT gated on (and not decorated with) basket continuity — it rests entirely
// on pinned N-1 reads and makes no intra-block claim (ruling, Part 2).
func TestTrueAtParentCarriesNoContinuityKey(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	n := big.NewInt(100_000_001)
	row := compositionRow(n, n, wad, nil)
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, _ := driveObligation2(t, row, parent, exec, acct)
	require.Equal(t, "true-at-parent", o2.eligState)
	require.Equal(t, verdictExact, o2.row.Verdict)
	require.NotContains(t, o2.row.Evidence, "basket_continuity",
		"true-at-parent makes no intra-block attribution; decorating it with the continuity caveat would blur what the key gates")
}

// --- L5: seizure-insufficiency preflight, refuse-entire-write ---------------

// TestOverSeizureRefusesEntireWrite is the L5 law through both levels: an
// earlier same-token Liquidated whose seized amount EXCEEDS the replayed
// basket leg. The old code silently clamped the leg to zero (no note,
// Complete() stayed true) — a no-silent-caps violation that let a partially
// coherent replay keep certifying. Now a per-token AGGREGATE preflight runs
// BEFORE any part of the write is applied; on insufficiency NOTHING is
// applied (debt leg included) and the refusal note names BOTH honest
// explanations. Kills m3.
func TestOverSeizureRefusesEntireWrite(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	liquidator := common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205")
	usdcHex := hexLower(replayTestUSDC.Hex())

	assertRefused := func(t *testing.T, seized []seizedTuple, liqUSD *big.Int) {
		t.Helper()
		liqW := packedWitness(t, "Liquidated", 2,
			hexLower(liquidator.Hex()), hexLower(acct.Hex()), usdcHex,
			seized, big.NewInt(40_000_000), liqUSD)

		// Parent: debt $20.000000 against a $30.000000 basket (LT 100%) —
		// ineligible at N-1; the event-time fold carries the repaid debt.
		n := big.NewInt(20_000_000)
		nBefore := new(big.Int).Sub(n, usdToNormalizedFloor(liqUSD, wad))
		row := compositionRow(n, nBefore, wad, []snapshotdb.T6Witness{liqW})
		parent, exec := compositionFrames(30_000_000, 1_000_000, 1_000_000)

		o2, _ := driveObligation2(t, row, parent, exec, acct)
		require.Equal(t, verdictUnexplained, o2.row.Verdict,
			"an over-seized write the model refuses leaves the case UNEXPLAINED (Complete()==false)")
		require.Equal(t, "0", o2.row.Evidence["same_block_replay_applied"],
			"NOTHING of the liquidation is applied — no debt move, no basket removal")
		require.Equal(t, "false", o2.row.Evidence["same_block_replay_complete"])
		notes := o2.row.Evidence["same_block_replay_notes"]
		require.Contains(t, notes, "OVER-SEIZES",
			"the refusal is a NOTE, never a silent clamp (clampDebt's own pattern)")
		require.Contains(t, notes, "inbound transfer",
			"explanation (a): an unseen pre-pass inbound transfer — the H2 unseen move, evidence never excuse")
		require.Contains(t, notes, "netting release",
			"explanation (b): parent legs are netted, seizure operates un-netted after _cancelOldWithdrawal — a pending-withdrawal Safe over-seizes with no unseen transfer at all")

		// Replay-level: no partial application is observable anywhere.
		r := replaySameBlockCauses([]snapshotdb.T6Witness{liqW}, replayTestDM, acct, replayTestUSDC, replayParentState{
			NormalizedAtParent: n, IndexAtBlock: new(big.Int).Set(wad),
			Collateral: parent.st.collateral, Prices: parent.st.prices, Configs: parent.st.configs,
			Decimals: map[common.Address]uint8{tokA: 6},
		})
		require.Equal(t, 0, r.Applied, "all-or-nothing: the preflight refuses BEFORE any leg moves")
		require.False(t, r.Proven,
			"the silent clamp manufactured a crossing (debt down, basket floored at zero); refusing whole removes it")
		require.False(t, r.BoundaryEligible, "the replayed state is untouched — still ineligible at the boundary")
		require.False(t, r.Complete(), "the refusal is structural, not evidence-only")
		require.NotEmpty(t, r.Notes)
		require.Equal(t, "30000000", parent.st.collateral[0].amount.String(),
			"the caller's parent basket is never mutated")
		require.Equal(t, "30000000", r.BoundaryCollateral[0].amount.String(),
			"the exposed boundary basket (the L3 surface) is untouched by the refused write — no partial application is observable anywhere")
	}

	t.Run("single element over-seizes the leg", func(t *testing.T) {
		// Seizes $40.00 of tokA against a $30.00 replayed leg.
		assertRefused(t, []seizedTuple{
			{Token: tokA, Amount: big.NewInt(40_000_000), LiquidationBonus: big.NewInt(400_000)},
		}, big.NewInt(10_000_000))
	})

	t.Run("aggregate across elements over-seizes the leg", func(t *testing.T) {
		// Each element alone fits ($20.00, $15.00 vs the $30.00 leg); the
		// AGGREGATE does not. The law is per-token AGGREGATE, so a
		// per-element check would pass this and under-refuse.
		assertRefused(t, []seizedTuple{
			{Token: tokA, Amount: big.NewInt(20_000_000), LiquidationBonus: big.NewInt(200_000)},
			{Token: tokA, Amount: big.NewInt(15_000_000), LiquidationBonus: big.NewInt(150_000)},
		}, big.NewInt(10_000_000))
	})
}

// TestExactFullSeizureStillApplies is the L5 boundary control: seizing
// EXACTLY the replayed leg is sufficient (a full liquidation of the leg is
// honest chain behavior) and must still apply — the preflight refuses strict
// insufficiency only, not equality. No tolerance, no direction filter: the
// comparison is exact arithmetic (ruling L4 — a magnitude tolerance on an
// attribution claim is the silent-cap class).
func TestExactFullSeizureStillApplies(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	liquidator := common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205")
	usdcHex := hexLower(replayTestUSDC.Hex())

	// Seizes exactly the $30.00 leg; repays $10.00 of the case's debt token.
	liqW := packedWitness(t, "Liquidated", 2,
		hexLower(liquidator.Hex()), hexLower(acct.Hex()), usdcHex,
		[]seizedTuple{{Token: tokA, Amount: big.NewInt(30_000_000), LiquidationBonus: big.NewInt(300_000)}},
		big.NewInt(40_000_000), big.NewInt(10_000_000))

	n := big.NewInt(20_000_000)
	st := replayParentState{
		NormalizedAtParent: n, IndexAtBlock: new(big.Int).Set(wad),
		Collateral: []collateralLeg{{token: tokA, amount: big.NewInt(30_000_000)}},
		Prices:     map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)},
		Configs: map[common.Address]collateralTokenConfigResult{tokA: {
			LTV: pctE18(50), LiquidationThreshold: pctE18(100), LiquidationBonus: wad,
		}},
		Decimals: map[common.Address]uint8{tokA: 6},
	}
	r := replaySameBlockCauses([]snapshotdb.T6Witness{liqW}, replayTestDM, acct, replayTestUSDC, st)
	require.Equal(t, 1, r.Applied, "an exactly-sufficient seizure is fully modellable and must apply")
	require.True(t, r.Complete(), "no refusal: sufficiency is exact arithmetic, not a band")
	require.True(t, r.Proven,
		"the applied seizure zeroes the basket while debt remains — the replay itself crosses to eligible (bonus-premium shape)")
	require.Len(t, r.BoundaryCollateral, 1)
	require.Equal(t, "0", r.BoundaryCollateral[0].amount.String(),
		"the exposed boundary basket (the L3 surface) reflects the applied seizure exactly: zero by subtraction, never clamped-from-negative")
}
