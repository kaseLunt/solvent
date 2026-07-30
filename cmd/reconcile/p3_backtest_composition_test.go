package main

// Wave-6 fixes for Codex round 5 (session 019fb391-c30e-7420-81f4-68729fd3e247,
// reviewed @ 2aa714d): the replay CORE held; all three findings live in the
// PRODUCTION COMPOSITION around it. The round-5 lesson: isolated classifier
// calls with hand-fed booleans let composition defects hide, so every
// regression here drives obligation2Eligibility — the EXACT function
// runBacktestCase calls — from fixture/DB-shaped rows, exactly as production
// does.
//
//   H1  parent eligibility used liquidation-time debt (ourBefore), so an
//       index-caused in-block crossing was recorded as a true-at-parent EXACT
//       pass and the required marginal disclosure was lost.
//   H2  Proven latched: a false→true crossing stayed proven after a later
//       true→false write, so index→repaid→(uncustodied price)→liquidated
//       earned marginal-disclosed although the actual liquidation-time
//       crossing was the unproven price move.
//   M   a cross-token liquidation was PARTIALLY replayed (collateral removed,
//       debt leg refused-but-noted) and could still prove; Notes were
//       evidence-only, so the declared unreplayable→UNEXPLAINED rule had no
//       structural teeth.
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation. Each mutant below must
// be killed by the named tests; after the suite passes, every mutant is CUT
// locally, the tests run, the kill confirmed, and the code restored
// (sha256-verified). Behavioural mutants only; a mutant that fails to compile
// is re-cut.
//
//   m1  parent predicate reverts to the event-time fold (ourEligible computed
//       from eventDebt/ourBefore instead of the replay's InitialEligible).
//       KILLED BY: TestIndexCausedCrossingIsMarginalNotTrueAtParent
//       (production composition emits true-at-parent EXACT under the mutant).
//   m2  boundary check removed / latch restored (a false→true transition
//       stays Proven after a later true→false write — drop the reversal
//       branch in the replay's applied()).
//       KILLED BY: TestIndexThenRepaidThenPriceMoveIsUnexplained
//       (the composed verdict becomes marginal-disclosed under the mutant).
//   m3  partial application restored (a cross-token Liquidated removes seized
//       collateral again despite the refused debt leg).
//       KILLED BY: TestCrossTokenLiquidationAppliesNothing (Applied/Proven
//       assertions) and secondarily
//       TestRefusalTaintsAGenuineCrossing (Applied count + cause identity).
//   m4  classifier ignores the completeness flag (drop the !replayComplete
//       arm from classifyIntraBlock).
//       KILLED BY: TestRefusalTaintsAGenuineCrossing — DISTINCT from m3's
//       kill: under m4 the replay is intact (Applied/Proven/cause-identity
//       assertions all pass) and ONLY the composed UNEXPLAINED assertion
//       fails, because a genuine current-token crossing plus an incomplete
//       replay must not earn marginal-disclosed.
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

// seizedTuple mirrors Liquidated's userCollateralLiquidated element for ABI
// packing (token, amount, liquidationBonus) — amount INCLUDES the bonus.
type seizedTuple struct {
	Token            common.Address `abi:"token"`
	Amount           *big.Int       `abi:"amount"`
	LiquidationBonus *big.Int       `abi:"liquidationBonus"`
}

// compositionFrames builds the two pinned frames the way production reads
// them: one tokA leg (6-dec, LT 100%) priced parentPrice at N-1 and execPrice
// at N. Collateral and configs are read from the PARENT frame in production;
// the exec frame contributes only its prices.
func compositionFrames(legAmount int64, parentPrice, execPrice int64) (parentFrame, execFrame) {
	mk := func(price int64) *frameState {
		return &frameState{
			collateral: []collateralLeg{{token: tokA, amount: big.NewInt(legAmount)}},
			prices:     map[common.Address]*big.Int{tokA: big.NewInt(price)},
			configs: map[common.Address]collateralTokenConfigResult{tokA: {
				LTV: pctE18(50), LiquidationThreshold: pctE18(100), LiquidationBonus: new(big.Int).Set(wad),
			}},
		}
	}
	return parentFrame{st: mk(parentPrice)}, execFrame{st: mk(execPrice)}
}

// compositionRow builds the derived-state row the way the snapshot collector
// hands it to production: the parent-boundary fold, the event-time fold, the
// liquidation-time index snapshot, and the structured same-block witnesses.
func compositionRow(normalizedAtParent, normalizedBefore, indexAtBlock *big.Int, ws []snapshotdb.T6Witness) snapshotdb.T6BacktestRow {
	return snapshotdb.T6BacktestRow{
		NormalizedAtParent: new(big.Int).Set(normalizedAtParent),
		NormalizedBefore:   new(big.Int).Set(normalizedBefore),
		IndexAtBlock:       new(big.Int).Set(indexAtBlock),
		BeforeDebtUSD:      mulDivFloor(normalizedBefore, indexAtBlock),
		SameBlockWitnesses: ws,
	}
}

// driveObligation2 runs the case through the REAL production composition:
// the same accessors, the same event-time fold (obligation 1's bridge), the
// same obligation2Eligibility call runBacktestCase makes.
func driveObligation2(t *testing.T, row snapshotdb.T6BacktestRow, parent parentFrame, exec execFrame,
	account common.Address) (obl2Outcome, *gateFrame) {
	t.Helper()
	f := newGateFrame(gateBacktest)
	v := newBacktestView(row, f)
	eventDebt := mulDivFloor(v.normalizedBefore(), v.indexAtBlock())
	decs := map[common.Address]uint8{tokA: 6}
	o2 := obligation2Eligibility("composition-case", v, parent, exec,
		replayTestDM, account, replayTestUSDC, eventDebt, decs, f)
	return o2, f
}

// idxOnePlusTick is 1.00000001e18 — the smallest index move Codex's H1
// counterexample uses: 100,000,000 normalized crosses to 100,000,001 USD-6.
func idxOnePlusTick() *big.Int { return big.NewInt(1_000_000_010_000_000_000) }

// --- H1: the parent predicate must be the REPLAY's parent truth -------------

// TestIndexCausedCrossingIsMarginalNotTrueAtParent is Codex round 5 H1's
// counterexample, driven through the production composition. At N-1 the
// account is EXACTLY at the threshold (debt == maxBorrowLT, ineligible under
// the strict >); an earlier same-block InterestIndexUpdated moves the debt to
// 100,000,001 and causes the crossing. The event-time fold (ourBefore) already
// contains that index, so a parent predicate computed from it claims
// true-at-parent EXACT and the required marginal disclosure is lost. The
// composed verdict must NOT be true-at-parent. Kills m1.
//
// L1-era expectation; flips back to marginal-disclosed when L2 lands (see
// chain-truth-basket-continuity-ruling.md): while basket continuity is
// unproven the crossing stays replay-PROVEN (asserted below — the machinery
// the L2 wave certifies) but the composed verdict is UNEXPLAINED with the
// basket_continuity disclosure, never a marginal pass and still never
// true-at-parent.
func TestIndexCausedCrossingIsMarginalNotTrueAtParent(t *testing.T) {
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	usdcHex := hexLower(replayTestUSDC.Hex())
	n := big.NewInt(100_000_000) // parent-boundary normalized debt: $100.000000 at 1e18

	idxW := packedWitness(t, "InterestIndexUpdated", 2, usdcHex, "", "",
		new(big.Int).Set(wad), idxOnePlusTick())
	row := compositionRow(n, n, idxOnePlusTick(), []snapshotdb.T6Witness{idxW})
	// $100.000000 of threshold-weighted collateral: ineligible at the parent
	// (strict >), eligible after the decoded index move. Prices identical in
	// both frames — the crossing is index-caused, not price-caused.
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, f := driveObligation2(t, row, parent, exec, acct)
	require.NotEqual(t, "true-at-parent", o2.eligState,
		"true-at-parent here means the parent predicate leaked liquidation-time debt (round-5 H1)")
	require.Equal(t, verdictUnexplained, o2.row.Verdict,
		"an index-caused in-block crossing is a marginal CANDIDATE; while basket continuity is unproven it resolves UNEXPLAINED with disclosure (ruling L1)")
	require.Contains(t, o2.row.Note, "InterestIndexUpdated",
		"the disclosure must still name the replayed cause")
	require.Equal(t, basketContinuityUnprovenText, o2.row.Evidence["basket_continuity"],
		"the gated marginal candidate carries the ruling's verbatim disclosure")
	require.Empty(t, f.cited,
		"no marginal pass, no tolerance spent while the continuity conjunct is unproven")
	require.Equal(t, "100000000", o2.row.Evidence["our_debt_usd6_at_parent"],
		"the artifact must disclose the reconstructed parent-boundary debt the predicate used")

	// The replay-level statement of the same law, from the same production
	// function: the parent boundary is INELIGIBLE and the crossing is proven.
	r := replaySameBlockCauses([]snapshotdb.T6Witness{idxW}, replayTestDM, acct, replayTestUSDC, replayParentState{
		NormalizedAtParent: n, IndexAtBlock: idxOnePlusTick(),
		Collateral: parent.st.collateral, Prices: parent.st.prices, Configs: parent.st.configs,
		Decimals: map[common.Address]uint8{tokA: 6},
	})
	require.False(t, r.InitialEligible, "debt == maxBorrowLT at the parent is INELIGIBLE under the strict >")
	require.Equal(t, "100000000", r.ParentDebtUSD.String())
	require.Equal(t, wad.String(), r.ParentIndex.String(),
		"the parent index is the event's own oldIndex, not the liquidation-time snapshot")
	require.True(t, r.Proven)
}

// --- H2: eligibility must HOLD to the liquidation boundary ------------------

// TestIndexThenRepaidThenPriceMoveIsUnexplained is Codex round 5 H2's
// counterexample, in the deployed order the wave-5 ordering test did not
// cover: InterestIndexUpdated (log 2) causes a genuine crossing, Repaid
// (log 4) reverses it, an UNCUSTODIED price move lowers the exec-frame
// maxBorrowLT, and the liquidation executes (log 6). The replay ends
// INELIGIBLE at the boundary, so the log-2 cause is stale: combining it with
// block-end execEligible must NOT earn marginal-disclosed — the actual
// liquidation-time crossing was the unproven price move. Kills m2.
func TestIndexThenRepaidThenPriceMoveIsUnexplained(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	acctHex := hexLower(acct.Hex())
	usdcHex := hexLower(replayTestUSDC.Hex())
	n := big.NewInt(100_000_000)

	idxW := packedWitness(t, "InterestIndexUpdated", 2, usdcHex, "", "",
		new(big.Int).Set(wad), idxOnePlusTick())
	// $1.00 repaid (USD-6 per the deployed Repaid semantics) restores health:
	// debt falls to ~$99.000001 against maxBorrowLT $100.000000.
	repayW := packedWitness(t, "Repaid", 4, acctHex, acctHex, usdcHex, big.NewInt(1_000_000))

	// The event-time fold contains the repayment (it happened before the
	// liquidation), exactly as the collector's Σ-delta fold would carry it.
	nBefore := new(big.Int).Sub(n, usdToNormalizedFloor(big.NewInt(1_000_000), idxOnePlusTick()))
	row := compositionRow(n, nBefore, idxOnePlusTick(), []snapshotdb.T6Witness{idxW, repayW})
	// The uncustodied price move: exec-frame price 0.98 drops maxBorrowLT to
	// $98.000000 < the event-time debt — execEligible is true at block end.
	parent, exec := compositionFrames(100_000_000, 1_000_000, 980_000)

	o2, _ := driveObligation2(t, row, parent, exec, acct)
	require.Equal(t, verdictUnexplained, o2.row.Verdict,
		"a crossing REVERSED before the liquidation is not the liquidation's cause; with only an uncustodied price move left, the case must fail UNEXPLAINED, not pass marginal-disclosed (round-5 H2)")
	require.Equal(t, verdictUnexplained, o2.eligState)

	// Replay-level: the crossing happened AND was invalidated — Proven must
	// not survive the true→false transition.
	r := replaySameBlockCauses([]snapshotdb.T6Witness{idxW, repayW}, replayTestDM, acct, replayTestUSDC, replayParentState{
		NormalizedAtParent: n, IndexAtBlock: idxOnePlusTick(),
		Collateral: parent.st.collateral, Prices: parent.st.prices, Configs: parent.st.configs,
		Decimals: map[common.Address]uint8{tokA: 6},
	})
	require.False(t, r.Proven,
		"Proven latched across a reversal is round-5 H2: the boundary state, not the crossing alone, is the law")
	require.False(t, r.BoundaryEligible, "the ordered replay ends ineligible at the liquidation boundary")
	require.Equal(t, 1, r.Reversals, "the true→false transition is counted and disclosed")
	require.Empty(t, r.Causes, "a reversed crossing's cause is cleared, never carried stale")
	require.True(t, r.Complete(), "both witnesses were fully modelled — this failure is H2, not incompleteness")
	require.Equal(t, 2, r.Applied)
}

// --- M: all-or-nothing witness application + structural completeness --------

// TestCrossTokenLiquidationAppliesNothing is Codex round 5 M's counterexample:
// an earlier Liquidated on ANOTHER debt token. The single-debt-token model
// cannot replay its debt leg, so it must apply NOTHING — the wave-5 code
// removed the seized collateral anyway, and that partial replay manufactured
// a crossing (debt $90 vs maxBorrowLT dropping 120→89.7). Kills m3.
func TestCrossTokenLiquidationAppliesNothing(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	liquidator := common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205")
	otherToken := common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58")
	n := big.NewInt(90_000_000) // debt in the CASE's token: $90.000000

	// The earlier pass liquidates token B: repays $30.000000 of B and seizes
	// $30.30 of tokA (bonus included) — Codex's A=90/B=40/maxBorrow=120 shape.
	liqW := packedWitness(t, "Liquidated", 2,
		hexLower(liquidator.Hex()), hexLower(acct.Hex()), hexLower(otherToken.Hex()),
		[]seizedTuple{{Token: tokA, Amount: big.NewInt(30_300_000), LiquidationBonus: big.NewInt(300_000)}},
		big.NewInt(40_000_000), big.NewInt(30_000_000))

	row := compositionRow(n, n, wad, []snapshotdb.T6Witness{liqW})
	// Parent basket $120.000000; exec price 0.70 makes block-end recomputation
	// eligible ($84 < $90) — the bait the partial replay turned into a pass.
	parent, exec := compositionFrames(120_000_000, 1_000_000, 700_000)

	o2, _ := driveObligation2(t, row, parent, exec, acct)
	require.Equal(t, verdictUnexplained, o2.row.Verdict,
		"an unreplayable cross-token liquidation resolves UNEXPLAINED by the declared rule — a partially replayed basket removal must never prove a crossing (round-5 M)")
	require.Equal(t, verdictUnexplained, o2.eligState)
	require.Contains(t, o2.row.Evidence["same_block_replay_notes"], "DIFFERENT borrow token",
		"the refusal stays disclosed as evidence")

	// Replay-level: NOTHING was applied — no debt move, no collateral removal,
	// no crossing, and the refusal taints completeness.
	st := replayParentState{
		NormalizedAtParent: n, IndexAtBlock: new(big.Int).Set(wad),
		Collateral: parent.st.collateral, Prices: parent.st.prices, Configs: parent.st.configs,
		Decimals: map[common.Address]uint8{tokA: 6},
	}
	r := replaySameBlockCauses([]snapshotdb.T6Witness{liqW}, replayTestDM, acct, replayTestUSDC, st)
	require.Equal(t, 0, r.Applied, "all-or-nothing: a witness the model cannot fully apply applies NOTHING")
	require.False(t, r.Proven, "the partial basket removal was the manufactured crossing — it must be gone")
	require.False(t, r.BoundaryEligible)
	require.NotEmpty(t, r.Notes)
	require.False(t, r.Complete(), "the refusal is structural, not evidence-only")
	require.Equal(t, "120000000", parent.st.collateral[0].amount.String(),
		"the caller's parent basket is never mutated by the replay")
}

// TestRefusalTaintsAGenuineCrossing is the m4 discriminator: the SAME
// cross-token refusal plus a GENUINE current-token crossing (the index tick).
// The replay honestly proves the crossing (Applied=1, cause = the index
// event) — and the composed verdict must STILL be UNEXPLAINED, because an
// incomplete replay cannot certify that the modelled crossing is the whole
// story (the unmodelled debt leg moves the real account's boolean too). Under
// m4 (classifier ignores the completeness flag) every replay-level assertion
// here passes and only the composed verdict differs — a kill DISTINCT from m3.
func TestRefusalTaintsAGenuineCrossing(t *testing.T) {
	acct := common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")
	liquidator := common.HexToAddress("0x0c51a1690899b4482458f432a5e80c9682574205")
	otherToken := common.HexToAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58")
	usdcHex := hexLower(replayTestUSDC.Hex())
	n := big.NewInt(100_000_000)

	liqW := packedWitness(t, "Liquidated", 2,
		hexLower(liquidator.Hex()), hexLower(acct.Hex()), hexLower(otherToken.Hex()),
		[]seizedTuple{{Token: tokA, Amount: big.NewInt(2_000_000), LiquidationBonus: big.NewInt(20_000)}},
		big.NewInt(40_000_000), big.NewInt(2_000_000))
	idxW := packedWitness(t, "InterestIndexUpdated", 4, usdcHex, "", "",
		new(big.Int).Set(wad), idxOnePlusTick())

	row := compositionRow(n, n, idxOnePlusTick(), []snapshotdb.T6Witness{liqW, idxW})
	parent, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)

	o2, _ := driveObligation2(t, row, parent, exec, acct)
	require.Equal(t, verdictUnexplained, o2.row.Verdict,
		"a proven current-token crossing inside an INCOMPLETE replay must not earn marginal-disclosed: the refused write moves the real boolean too, so the proof is not the whole story (round-5 M)")
	require.Equal(t, verdictUnexplained, o2.eligState)

	// Replay-level: the crossing is genuinely proven and attributed to the
	// index event ONLY — the refused liquidation contributed nothing.
	r := replaySameBlockCauses([]snapshotdb.T6Witness{liqW, idxW}, replayTestDM, acct, replayTestUSDC, replayParentState{
		NormalizedAtParent: n, IndexAtBlock: idxOnePlusTick(),
		Collateral: parent.st.collateral, Prices: parent.st.prices, Configs: parent.st.configs,
		Decimals: map[common.Address]uint8{tokA: 6},
	})
	require.True(t, r.Proven, "the index move crosses on its own; the refusal must not erase a genuine crossing")
	require.Equal(t, 1, r.Applied, "only the index event is applied; the refused liquidation applies nothing (m3's secondary kill)")
	require.Len(t, r.Causes, 1)
	require.Contains(t, r.Causes[0], "InterestIndexUpdated",
		"the cause is the index event, not the refused liquidation")
	require.False(t, r.Complete(), "the refusal taints the replay even though a genuine cause exists")
}
