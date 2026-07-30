package main

// Wave 9 — L2/L3/L6/L7 of the chain-truth basket-continuity ruling (NORMATIVE,
// archived verbatim at
// .superpowers/sdd/p3-consults/chain-truth-basket-continuity-ruling.md): the
// basket-continuity proof lands, and it is the ONLY discharger of L1's
// basketContinuityProven conjunct. This file is the COMPOSITION layer — every
// test drives obligation2Eligibility, the exact function runBacktestCase
// calls, with the continuity sweep injected the way production injects it.
// The sweep/decode/closure/attribution layer is basket_continuity_test.go;
// the captured-chain layer is basket_continuity_captured_test.go.
//
// THE FLIP-BACK (step 5 of the wave): the wave-7 positive controls marked
// "flips back when L2 lands" assert marginal-disclosed AGAIN here — where
// their fixtures carry a synthesized (or captured) continuity proof. The
// refusal polarity stays pinned too: the SAME shapes without a proof remain
// UNEXPLAINED with the verbatim basket_continuity disclosure (wave-7 tests,
// kept, plus TestProvenCrossingWithoutSweepStaysUnexplained below).
//
// ---------------------------------------------------------------------------
// MUTATION SPEC (the ruling's own list; behavioural, sha256-verified
// restores). Each mutant is CUT locally after the suite passes, the kill
// confirmed, the code restored byte-identically.
//
//   m1  delete the L1 conjunct discharge: obligation2Eligibility ignores the
//       proof result (basketContinuityProven := false — the wave-7/8 posture
//       restored).
//       KILLED BY: TestIndexTickCrossingWithProvenContinuityIsMarginalDisclosed
//       and TestSeizureCrossingUsesTheBoundaryBasket (the flipped-back
//       positive controls regress to UNEXPLAINED; the basket_continuity key
//       reverts to the unproven text; no tolerance cited).
//   m2  break the closure identity: drop the Δpending term (the EXACT
//       unsoundness the ruling found in Codex's literal remedy — proving
//       continuity from balances/Transfers alone).
//       KILLED BY (opposite directions, both asserted):
//       TestContinuityPendingWithdrawalLiquidationProves FALSE-REFUSES (the
//       honest pending-withdrawal liquidation stops proving) while
//       TestContinuityNettingMovedBalanceOnlyIsRefused FALSE-PASSES (the
//       netting-moved fixture starts proving).
//   m3  break attribution: accept unattributed pre-boundary movements (drop
//       the inbound/outbound refusal arms).
//       KILLED BY: TestContinuityUnattributedInboundIsRefused and
//       TestContinuityUnattributedOutboundIsRefused (both fixtures prove
//       under the mutant).
//   m4  skip the blockHash echo validation (the L6 answers-the-question law).
//       KILLED BY: TestContinuityWrongBlockHashEchoIsRefused (the
//       wrong-echo fixture assembles a clean sweep under the mutant and the
//       refusal vanishes). The L5-preflight half of the ruling's m4 remains
//       covered by wave-7's TestOverSeizureRefusesEntireWrite (unweakened).
// ---------------------------------------------------------------------------

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// quiescentSweep synthesizes the honest no-movement sweep for a composition
// fixture: one tokA leg, identical at both frames, no transfers, no netting.
// Closure holds trivially; nothing needs attribution — the proof PROVES.
func quiescentSweep(acct common.Address, leg int64) *continuitySweep {
	return &continuitySweep{
		Pin: contPin, Block: 150000000, BoundaryLogIndex: 6, CaseTx: contCase, Safe: acct,
		Tokens:     []common.Address{tokA},
		ParentLegs: map[common.Address]*big.Int{tokA: big.NewInt(leg)},
		ExecLegs:   map[common.Address]*big.Int{tokA: big.NewInt(leg)},
	}
}

// --- the flip-backs (positive controls; kill m1) ----------------------------

// TestIndexTickCrossingWithProvenContinuityIsMarginalDisclosed is wave-7's
// TestProvenCrossingIsContinuityGatedUnexplained fixture WITH the continuity
// proof its verdict was waiting for: the replay proves the index-caused
// crossing, holds it to the boundary, the recomputation corroborates, AND the
// sweep proves the basket quiescent. The composed verdict flips back to
// MARGINAL-DISCLOSED: the tolerance is cited, the margin printed, and the
// basket_continuity evidence key carries the PROOF OUTCOME (the unproven text
// is reserved for the refusal path). Kills m1.
func TestIndexTickCrossingWithProvenContinuityIsMarginalDisclosed(t *testing.T) {
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	usdcHex := hexLower(replayTestUSDC.Hex())
	n := big.NewInt(100_000_000)

	idxW := packedWitness(t, "InterestIndexUpdated", 2, usdcHex, "", "",
		new(big.Int).Set(wad), idxOnePlusTick())
	row := compositionRow(n, n, idxOnePlusTick(), []snapshotdb.T6Witness{idxW})
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, f := driveObligation2WithSweep(t, row, parent, exec, acct, quiescentSweep(acct, 100_000_000))
	require.Equal(t, "flipped-in-block-with-custodied-witness", o2.eligState,
		"the L1-era gate on this shape existed ONLY for the missing continuity proof; with the proof it is marginal-disclosed again")
	require.Equal(t, verdictMarginal, o2.row.Verdict)
	require.Contains(t, o2.row.Note, "InterestIndexUpdated", "the cause is still named")
	require.Contains(t, o2.row.Note, "BASKET CONTINUITY", "the note states WHY marginal is now earnable")
	require.Contains(t, o2.row.Evidence["basket_continuity"], "proven:",
		"the evidence key's text is the PROOF OUTCOME on the discharged path")
	require.NotContains(t, o2.row.Evidence, "basket_continuity_refusals",
		"no refusals key on the proven path")
	require.Equal(t, []toleranceID{tolIntraBlockMarginality}, f.cited,
		"the disclosed marginality tolerance is spent exactly once, now that it is earnable")
}

// TestSeizureCrossingUsesTheBoundaryBasket is the L3 prong with a
// discriminating fixture: an earlier-pass seizure shrinks the basket, and the
// crossing is only visible over the REPLAYED BOUNDARY BASKET
// (causeReplay.BoundaryCollateral) — over the parent basket the event-time
// debt does not cross, so a classifier still consulting parent.st.collateral
// resolves UNEXPLAINED. Kills m1 AND any mutant that reverts L3's basket
// switch ("without L3, L2 certifies a basket the classifier never consults").
func TestSeizureCrossingUsesTheBoundaryBasket(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	liquidator := common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205")
	usdcHex := hexLower(replayTestUSDC.Hex())
	txW := common.HexToHash("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee07")

	// Parent: debt $95 against a $100 basket — ineligible. The witnessed
	// earlier pass (a different tx, log 2) repays $10 of the case's debt
	// token and seizes $60 of tokA: boundary debt $85 vs boundary basket $40
	// — the crossing is real and holds. Over the PARENT basket $100, $85
	// does not cross.
	n := big.NewInt(95_000_000)
	liqW := witnessWithTx(packedWitness(t, "Liquidated", 2,
		hexLower(liquidator.Hex()), hexLower(acct.Hex()), usdcHex,
		[]seizedTuple{{Token: tokA, Amount: big.NewInt(60_000_000), LiquidationBonus: big.NewInt(600_000)}},
		big.NewInt(95_000_000), big.NewInt(10_000_000)), txW)
	nBefore := new(big.Int).Sub(n, usdToNormalizedFloor(big.NewInt(10_000_000), wad))
	row := compositionRow(n, nBefore, wad, []snapshotdb.T6Witness{liqW})
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	// The sweep tells the SAME story the witness decodes to: $60 of tokA
	// leaves the safe pre-boundary in tx W (the seizure transfers — a
	// fixture without them is chain-impossible), legs 100 → 40.
	sweep := &continuitySweep{
		Pin: contPin, Block: 150000000, BoundaryLogIndex: 6, CaseTx: contCase, Safe: acct,
		Tokens:     []common.Address{tokA},
		ParentLegs: map[common.Address]*big.Int{tokA: big.NewInt(100_000_000)},
		ExecLegs:   map[common.Address]*big.Int{tokA: big.NewInt(40_000_000)},
		Transfers: []sweptTransfer{{Token: tokA, From: acct, To: liquidator,
			Value: big.NewInt(60_000_000), TxHash: txW, LogIndex: 1}},
	}

	o2, f := driveObligation2WithSweep(t, row, parent, exec, acct, sweep)
	require.Equal(t, verdictMarginal, o2.row.Verdict,
		"the crossing exists over the replayed boundary basket; consulting the parent basket here is exactly the theater L3 removes")
	require.Equal(t, "flipped-in-block-with-custodied-witness", o2.eligState)
	require.Contains(t, o2.row.Evidence["exec_eligibility_basket"], "REPLAYED BOUNDARY BASKET",
		"the artifact discloses WHICH basket the recomputation ran over")
	require.Equal(t, "40000000", o2.row.Evidence["our_max_borrow_lt_at_exec"],
		"maxBorrowLT at exec is computed over the $40 boundary basket, not the $100 parent basket")
	require.Contains(t, o2.row.Evidence["basket_continuity"], "proven:")
	require.Equal(t, []toleranceID{tolIntraBlockMarginality}, f.cited)
}

// --- refusal polarity retained (the L1 posture stays reachable and pinned) --

// TestProvenCrossingWithoutSweepStaysUnexplained pins the refusal path AFTER
// L2: the same proven-crossing fixture with NO sweep (or a refused one)
// resolves UNEXPLAINED with the VERBATIM unproven disclosure — and now also
// carries the per-case refusal reasons under basket_continuity_refusals.
// (The wave-7 originals, driven through driveObligation2's nil sweep, pin the
// same polarity; this test additionally pins the refusals key and the
// refused-sweep variant.)
func TestProvenCrossingWithoutSweepStaysUnexplained(t *testing.T) {
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	usdcHex := hexLower(replayTestUSDC.Hex())
	n := big.NewInt(100_000_000)
	idxW := packedWitness(t, "InterestIndexUpdated", 2, usdcHex, "", "",
		new(big.Int).Set(wad), idxOnePlusTick())
	row := compositionRow(n, n, idxOnePlusTick(), []snapshotdb.T6Witness{idxW})

	for name, sweep := range map[string]*continuitySweep{
		"nil sweep":     nil,
		"refused sweep": refusedSweep("netting sweep (ruling L2 c) refused: endpoint failed"),
	} {
		t.Run(name, func(t *testing.T) {
			parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)
			o2, f := driveObligation2WithSweep(t, row, parent, exec, acct, sweep)
			require.Equal(t, verdictUnexplained, o2.row.Verdict,
				"continuity unproven → UNEXPLAINED remains reachable and pinned (refusal polarity)")
			require.Equal(t, basketContinuityUnprovenText, o2.row.Evidence["basket_continuity"],
				"the unproven text stays VERBATIM-STABLE on the refusal path")
			require.NotEmpty(t, o2.row.Evidence["basket_continuity_refusals"],
				"the per-case refusal reasons are disclosed under their own key, never absorbed into the stable text")
			require.Empty(t, f.cited, "no marginal pass, no tolerance spent")
		})
	}
}

// TestContinuityProofAloneNeverClassifies: a PROVEN sweep with NO replayed
// crossing must stay UNEXPLAINED — the proof discharges a conjunct, it is not
// itself a cause (per-case archive reads inform, they do not classify).
func TestContinuityProofAloneNeverClassifies(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	n := big.NewInt(100_000_000)
	// No witnesses at all: parent-ineligible, no cause, quiescent basket.
	row := compositionRow(n, n, wad, nil)
	parent, exec := compositionFrames(100_000_000, 1_000_000, 980_000)

	o2, f := driveObligation2WithSweep(t, row, parent, exec, acct, quiescentSweep(acct, 100_000_000))
	require.Equal(t, verdictUnexplained, o2.row.Verdict,
		"a proven-quiescent basket plus an uncustodied price move is still NOT a custodied cause")
	require.Empty(t, f.cited)
	require.NotContains(t, o2.row.Evidence, "basket_continuity",
		"no marginal candidacy, no continuity key — the key gates the marginal attribution, nothing else")
}

// TestTrueAtParentStillCarriesNoContinuityKeyWithProof: L1's scope is
// unchanged by L2 — true-at-parent makes no intra-block claim, so even a
// PROVEN sweep must not decorate it.
func TestTrueAtParentStillCarriesNoContinuityKeyWithProof(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	n := big.NewInt(100_000_001)
	row := compositionRow(n, n, wad, nil)
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, _ := driveObligation2WithSweep(t, row, parent, exec, acct, quiescentSweep(acct, 100_000_000))
	require.Equal(t, "true-at-parent", o2.eligState)
	require.Equal(t, verdictExact, o2.row.Verdict)
	require.NotContains(t, o2.row.Evidence, "basket_continuity")
}

// --- L5 wiring: sweep (c) discriminates the over-seizure explanations -------

// TestOverSeizureDiscriminationFromNettingSweep drives the wave-7 over-seizure
// refusal WITH sweep data: the ruling's L5 paragraph says sweep (c) now
// discriminates (a) unseen inbound from (b) netting release, and the note
// must carry the discrimination. The refusal itself (NOTHING applied,
// Complete()==false, UNEXPLAINED) is wave-7 law, unweakened.
func TestOverSeizureDiscriminationFromNettingSweep(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	liquidator := common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205")
	usdcHex := hexLower(replayTestUSDC.Hex())
	txW := common.HexToHash("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee08")

	mkCase := func(netting []nettingEvent, transfers []sweptTransfer,
		parentLeg, execLeg int64) (obl2Outcome, *gateFrame) {
		liqW := witnessWithTx(packedWitness(t, "Liquidated", 2,
			hexLower(liquidator.Hex()), hexLower(acct.Hex()), usdcHex,
			[]seizedTuple{{Token: tokA, Amount: big.NewInt(40_000_000), LiquidationBonus: big.NewInt(400_000)}},
			big.NewInt(40_000_000), big.NewInt(10_000_000)), txW)
		n := big.NewInt(20_000_000)
		nBefore := new(big.Int).Sub(n, usdToNormalizedFloor(big.NewInt(10_000_000), wad))
		row := compositionRow(n, nBefore, wad, []snapshotdb.T6Witness{liqW})
		parent, exec := compositionFrames(parentLeg, 1_000_000, 1_000_000)
		sweep := &continuitySweep{
			Pin: contPin, Block: 150000000, BoundaryLogIndex: 6, CaseTx: contCase, Safe: acct,
			Tokens:     []common.Address{tokA},
			ParentLegs: map[common.Address]*big.Int{tokA: big.NewInt(parentLeg)},
			ExecLegs:   map[common.Address]*big.Int{tokA: big.NewInt(execLeg)},
			Transfers:  transfers, Netting: netting,
		}
		return driveObligation2WithSweep(t, row, parent, exec, acct, sweep)
	}

	t.Run("shape (b): a netting release is observed", func(t *testing.T) {
		// Un-netted seizure 40 vs netted parent leg 30 (balance 60, pending
		// 30): the tx cancels 30 with zero transfers, then transfers 40 out.
		o2, _ := mkCase(
			[]nettingEvent{{Kind: "WithdrawalCancelled", TxHash: txW, LogIndex: 1,
				Tokens: []common.Address{tokA}, Amounts: []*big.Int{big.NewInt(30_000_000)}}},
			[]sweptTransfer{{Token: tokA, From: acct, To: liquidator,
				Value: big.NewInt(40_000_000), TxHash: txW, LogIndex: 3}},
			30_000_000, 20_000_000)
		require.Equal(t, verdictUnexplained, o2.row.Verdict, "the L5 refusal itself is unchanged")
		require.Contains(t, o2.row.Evidence["same_block_replay_notes"], "OVER-SEIZES")
		require.Contains(t, o2.row.Evidence["over_seizure_discrimination"], "explanation (b) is evidenced",
			"sweep (c) observed the WithdrawalCancelled release — the netted-vs-un-netted shape, no unseen transfer at all")
		require.Contains(t, o2.row.Evidence["over_seizure_discrimination"], "30000000")
	})

	t.Run("shape (a): no netting release observed", func(t *testing.T) {
		// Same over-seizure, but sweep (c) is EMPTY: the only honest
		// explanation left is the unseen pre-pass inbound transfer.
		o2, _ := mkCase(nil,
			[]sweptTransfer{
				{Token: tokA, From: liquidator, To: acct, Value: big.NewInt(10_000_000), TxHash: txW, LogIndex: 1},
				{Token: tokA, From: acct, To: liquidator, Value: big.NewInt(40_000_000), TxHash: txW, LogIndex: 3},
			},
			30_000_000, 0)
		require.Equal(t, verdictUnexplained, o2.row.Verdict)
		require.Contains(t, o2.row.Evidence["over_seizure_discrimination"], "explanation (a)",
			"no release observed → the unseen-inbound explanation stands, evidence never excuse")
	})
}

// TestUnprovenContinuityKeepsParentBasketAtExec pins L3's OFF state: while
// continuity is unproven the recomputation stays over the parent basket and
// says so — a boundary basket the proof cannot back must never be consulted.
func TestUnprovenContinuityKeepsParentBasketAtExec(t *testing.T) {
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	usdcHex := hexLower(replayTestUSDC.Hex())
	n := big.NewInt(100_000_000)
	idxW := packedWitness(t, "InterestIndexUpdated", 2, usdcHex, "", "",
		new(big.Int).Set(wad), idxOnePlusTick())
	row := compositionRow(n, n, idxOnePlusTick(), []snapshotdb.T6Witness{idxW})
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, _ := driveObligation2WithSweep(t, row, parent, exec, acct, nil)
	require.Contains(t, o2.row.Evidence["exec_eligibility_basket"], "parent collateralOf legs",
		"L3 activates only with L2 — both prongs together, or neither")
}
