package main

// Wave-8 fix for Codex round 7 (session 019fb3f2-1c6e-76e2-8229-777c3ef975d9,
// reviewed @ 6dea23a): L1 and L5 held; the wave-7 H1 split introduced a
// parent-basket completeness gap.
//
//   HIGH  ParentComplete could certify an UNREAD parent basket. Multicall3
//         subcalls with Success=false were silently skipped and full-frame
//         validation only checked prices for SEIZED tokens, so a failed
//         collateralOf left an empty basket with no unread; maxBorrowAtFrame
//         valued the empty basket to zero "fully priced", ParentComplete was
//         set from the debt fold/index alone, and the case emitted a
//         true-at-parent EXACT — a false green from an honest historical RPC
//         subcall failure. A failed config subcall similarly dropped a
//         collateral leg (understating maxBorrowLT, manufacturing parent
//         eligibility) and the parent arm preempted the unpriced refusal.
//
// THE LAW THIS WAVE LANDS (three layers, each mutated separately below):
//   1. DECODE: in applyBacktestFrameResults — the ONE decode path both
//      readParentFrame and readExecFrame reach — ANY subcall that is
//      Success=false, answers empty return data where the ABI promises a
//      value, or does not decode marks the frame UNREAD with the subcall
//      NAMED. Never a silently smaller basket, in EITHER frame.
//   2. COMPLETENESS: ParentComplete = debt fold present AND parent index
//      reconstruction ok AND parent basket valuation complete (every basket
//      subcall decoded — replayParentState.BasketNote — and every basket leg
//      priced+configured+decimal-pinned). True-at-parent requires the full
//      conjunction; so does the marginal arm (a degraded parent state can
//      certify nothing).
//   3. ARM ORDER: parent-INPUT completeness gates the parent arm;
//      witness-application refusals (round 6 H1) do not. A spuriously
//      eligible parent predicate over a degraded basket lands in the
//      unpriced/unexplained refusals, never in true-at-parent.
//
// THE ROUND-7 LESSON, honored here: complete in-memory frames cannot catch
// this class. The regressions below build the REAL call plan
// (buildBacktestFrameCalls) and drive the REAL decode layer
// (applyBacktestFrameResults) with crafted Multicall3 response fixtures,
// packed by the SAME production ABIs the frame reads with.
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation. Each mutant below must
// be killed by the named tests; after the suite passes, every mutant is CUT
// locally, the tests run, the kill confirmed, and the code restored
// (sha256-verified). Behavioural mutants only; a mutant that fails to compile
// is re-cut.
//
//   m1  restore the silent skip on Success=false (applyBacktestFrameResults
//       reverts to `if !res[i].Success { continue }` with no unread).
//       KILLED BY: TestWave8CollateralOfFailureIsUnreadNeverEmptyBasket —
//       test (a): st.unread stays empty under the mutant. DISTINCT from m2's
//       kill: test (c) has Success=true, so the restored skip never fires
//       there and (c) stays green under m1.
//   m2  drop basket-valuation from the ParentComplete conjunction (the replay
//       reverts to `out.ParentComplete = true` — BasketNote and the internal
//       valuation check both ignored).
//       KILLED BY: TestWave8CollateralOfEmptyOrGarbageIsRefused — test (c):
//       the decode law still refuses (Success=true, so m1's territory is
//       untouched), but the composed drive certifies true-at-parent EXACT
//       from the empty degraded basket under the mutant. DISTINCT from m1:
//       (c) does not exercise the Success=false skip at all.
//   m3  restore the arm order that lets the parent arm preempt the unpriced
//       refusal (classifyIntraBlock's first arm consults parentEligible
//       WITHOUT parentComplete).
//       KILLED BY: TestWave8ConfigFailureRefusesAndCannotBePreempted and
//       TestWave8NeverIssuedLegGatesTheParentArm — test (b): the dropped
//       config understates maxBorrowLT, the parent predicate is spuriously
//       eligible, and the mutant emits true-at-parent EXACT instead of the
//       unpriced refusal.
// ---------------------------------------------------------------------------
//
// FIXTURE-BACKED-OVER-TRANSCRIBED (Task 6 round-3 law): every response
// payload below is packed by the SAME ABI objects production decodes with
// (dmCollateralOfABI, dmConvertCollateralToUsdABI, dmCollateralTokenConfigABI,
// erc20BalanceOfABI, dmBorrowingOfOneABI). No hand-transcribed word offsets.

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// wave8Acct is the account the crafted frames are read for.
var wave8Acct = common.HexToAddress("0x983e36549d27ccfe30d37e615d35222f52fc104d")

// tokenDataTuple mirrors collateralOf's TokenData element for ABI packing.
type tokenDataTuple struct {
	Token  common.Address `abi:"token"`
	Amount *big.Int       `abi:"amount"`
}

// packFrameReturn packs a subcall RETURN through the production ABI object —
// the same Outputs the decode layer unpacks with.
func packFrameReturn(t *testing.T, a abi.ABI, method string, vals ...interface{}) []byte {
	t.Helper()
	b, err := a.Methods[method].Outputs.Pack(vals...)
	require.NoError(t, err, "packing %s return via the production ABI", method)
	return b
}

// wave8Plan builds the REAL call plan for a one-token frame (tokA, 6 dec).
func wave8Plan(t *testing.T, full bool) []backtestFrameTag {
	t.Helper()
	_, tags, err := buildBacktestFrameCalls(replayTestDM, wave8Acct, replayTestUSDC, full,
		map[common.Address]bool{tokA: true}, map[common.Address]uint8{tokA: 6})
	require.NoError(t, err)
	kinds := make([]string, len(tags))
	for i, tg := range tags {
		kinds[i] = tg.kind
	}
	if full {
		require.Equal(t, []string{"collateralOf", "price", "config", "balanceOf"}, kinds,
			"the parent frame's canonical subcall order — the SUBCALL INVENTORY this wave's law covers")
	} else {
		// The exec inventory gained collateralOf in the L2 wave (basket-
		// continuity ruling L2(a): leg@N is one side of the closure identity).
		// The wave-8 decode law covers the new subcall automatically — same
		// loop, same per-subcall refusal.
		require.Equal(t, []string{"borrowingOf", "collateralOf", "price"}, kinds,
			"the execution frame's canonical subcall order — the same decode path, the same law")
	}
	return tags
}

// wave8Honest builds one honest Multicall3 response per subcall: a $100.00
// tokA leg priced $1.00 at LT 100% — the same shape compositionFrames uses,
// but produced through the ABI encode/decode round-trip.
func wave8Honest(t *testing.T, tags []backtestFrameTag, legAmount int64) []multicallResult {
	t.Helper()
	res := make([]multicallResult, len(tags))
	for i, tg := range tags {
		switch tg.kind {
		case "collateralOf":
			res[i] = multicallResult{Success: true, ReturnData: packFrameReturn(t, dmCollateralOfABI, "collateralOf",
				[]tokenDataTuple{{Token: tokA, Amount: big.NewInt(legAmount)}}, big.NewInt(legAmount))}
		case "borrowingOf":
			res[i] = multicallResult{Success: true, ReturnData: packFrameReturn(t, dmBorrowingOfOneABI, "borrowingOf", big.NewInt(legAmount))}
		case "price":
			res[i] = multicallResult{Success: true, ReturnData: packFrameReturn(t, dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", big.NewInt(1_000_000))}
		case "config":
			res[i] = multicallResult{Success: true, ReturnData: packFrameReturn(t, dmCollateralTokenConfigABI, "collateralTokenConfig",
				cfgTuple{Ltv: pctE18(50), LiquidationThreshold: pctE18(100), LiquidationBonus: new(big.Int).Set(wad)})}
		case "balanceOf":
			res[i] = multicallResult{Success: true, ReturnData: packFrameReturn(t, erc20BalanceOfABI, "balanceOf", big.NewInt(legAmount))}
		}
	}
	return res
}

// wave8Decode drives the REAL decode layer over crafted responses.
func wave8Decode(t *testing.T, full bool, tags []backtestFrameTag, res []multicallResult) *frameState {
	t.Helper()
	st := newBacktestFrameState(100, common.Hash{0x01}, full)
	applyBacktestFrameResults(st, newGateFrame(gateBacktest), tags, res)
	return st
}

// wave8Compose drives the decoded frame through the REAL production
// composition (the defense-in-depth layer: production refuses an unread frame
// in runBacktestCase BEFORE obligation 2, and the ParentComplete conjunction
// makes the false green unrepresentable even if that gate were bypassed).
func wave8Compose(t *testing.T, st *frameState, debtUSD6 int64) obl2Outcome {
	t.Helper()
	row := compositionRow(big.NewInt(debtUSD6), big.NewInt(debtUSD6), wad, nil)
	_, exec := compositionFrames(100_000_000, 1_000_000, 1_000_000)
	o2, _ := driveObligation2(t, row, parentFrame{st: st}, exec, wave8Acct)
	return o2
}

// --- (a): collateralOf Success=false — the finding's headline shape ---------

// TestWave8CollateralOfFailureIsUnreadNeverEmptyBasket injects the exact
// degradation Codex named: the collateralOf subcall fails (an honest
// historical RPC subcall failure or view revert). The frame must be UNREAD
// with the subcall named — the silent skip left an EMPTY basket that
// maxBorrowAtFrame valued to zero "fully priced", and the case passed
// true-at-parent EXACT. Kills m1.
func TestWave8CollateralOfFailureIsUnreadNeverEmptyBasket(t *testing.T) {
	tags := wave8Plan(t, true)
	res := wave8Honest(t, tags, 100_000_000)
	res[0] = multicallResult{Success: false} // collateralOf reverts at the pin

	st := wave8Decode(t, true, tags, res)
	require.NotEmpty(t, st.unread,
		"a failed collateralOf subcall must mark the frame UNREAD — the silent skip is how an empty basket certified an EXACT pass (Codex round 7, H1)")
	require.Contains(t, st.unread, "collateralOf", "the refusal names the failed subcall")
	require.Empty(t, st.collateral, "nothing decoded, nothing invented")

	// Defense in depth: even driven straight into the composition, the
	// degraded frame can never value an empty basket into parent eligibility.
	o2 := wave8Compose(t, st, 100_000_000)
	require.NotEqual(t, "true-at-parent", o2.eligState,
		"empty-basket → maxBorrow 0 → 'eligible' is the silent-zero path; it must be unrepresentable")
	require.NotEqual(t, verdictExact, o2.row.Verdict, "no EXACT verdict from a degraded parent basket")
	require.Equal(t, "false", o2.row.Evidence["parent_basket_complete"],
		"parent-basket completeness is disclosed as evidence")
	require.Contains(t, o2.row.Evidence["parent_basket_note"], "collateralOf",
		"the disclosure names the failed subcall")
}

// --- (b): config subcall failed / never issued ------------------------------

// TestWave8ConfigFailureRefusesAndCannotBePreempted injects a failed
// collateralTokenConfig subcall. The decode layer refuses the frame; and even
// composed, the leg whose config is missing is DROPPED by maxBorrowAtFrame —
// understating maxBorrowLT to zero and making the parent predicate SPURIOUSLY
// eligible — so the parent arm must not preempt the parent-input refusal.
// Kills m3 (with TestWave8NeverIssuedLegGatesTheParentArm).
func TestWave8ConfigFailureRefusesAndCannotBePreempted(t *testing.T) {
	tags := wave8Plan(t, true)
	res := wave8Honest(t, tags, 100_000_000)
	for i, tg := range tags {
		if tg.kind == "config" {
			res[i] = multicallResult{Success: false} // config reverts at the pin
		}
	}

	st := wave8Decode(t, true, tags, res)
	require.NotEmpty(t, st.unread, "a failed config subcall must mark the frame UNREAD, never a silently unconfigured leg")
	require.Contains(t, st.unread, "collateralTokenConfig", "the refusal names the failed subcall")
	require.Len(t, st.collateral, 1, "the basket itself decoded before the degradation")
	require.Empty(t, st.configs, "the failed config is absent, not defaulted")

	// The spurious shape at the replay level: the unconfigured leg values to
	// nothing, debt $100 > maxBorrowLT $0, so InitialEligible is TRUE — and
	// the basket-valuation conjunct must fail ParentComplete for exactly that
	// reason.
	r := replaySameBlockCauses(nil, replayTestDM, wave8Acct, replayTestUSDC, replayParentState{
		NormalizedAtParent: big.NewInt(100_000_000), IndexAtBlock: new(big.Int).Set(wad),
		Collateral: st.collateral, Prices: st.prices, Configs: st.configs,
		Decimals: map[common.Address]uint8{tokA: 6},
	})
	require.True(t, r.InitialEligible,
		"the degraded basket VALUES eligible — this is the spurious parent predicate the arm order must not honor")
	require.False(t, r.ParentComplete,
		"parent basket valuation joins the ParentComplete conjunction: an unvalued leg fails it (Codex round 7, H1)")

	// Composed: the parent-input refusal, never true-at-parent.
	o2 := wave8Compose(t, st, 100_000_000)
	require.NotEqual(t, "true-at-parent", o2.eligState,
		"the parent arm must not preempt the parent-input (unpriced) refusal — round-7 H1's arm-order lesson")
	require.NotEqual(t, verdictExact, o2.row.Verdict)
	require.Equal(t, "unpriced-leg", o2.eligState, "the honest landing: the unpriced/unvalued refusal class")
	require.Equal(t, verdictWeldUnread, o2.row.Verdict)
	require.Equal(t, "false", o2.row.Evidence["parent_basket_complete"])
}

// TestWave8NeverIssuedLegGatesTheParentArm is (b)'s second shape: a basket
// token OUTSIDE the seized ∪ alsoPrice set gets NO price/config subcall at
// all (nothing failed — the call plan never contained it), so the decode
// layer cannot see it. The valuation-completeness conjunct must catch it:
// the dropped leg understates maxBorrowLT ($50 valued of a $150 basket
// against $100 debt), the parent predicate is spuriously eligible, and the
// composed verdict must be the unpriced refusal, never true-at-parent.
// Kills m3.
func TestWave8NeverIssuedLegGatesTheParentArm(t *testing.T) {
	tokB := common.HexToAddress("0x2416092f143378750bb29b79ed961ab195cceea5")
	st := newBacktestFrameState(100, common.Hash{0x01}, true)
	st.collateral = []collateralLeg{
		{token: tokA, amount: big.NewInt(50_000_000)},  // valued: $50.00 at LT 100%
		{token: tokB, amount: big.NewInt(100_000_000)}, // never valued: no subcall was ever issued for it
	}
	st.prices[tokA] = big.NewInt(1_000_000)
	st.configs[tokA] = collateralTokenConfigResult{
		LTV: pctE18(50), LiquidationThreshold: pctE18(100), LiquidationBonus: new(big.Int).Set(wad),
	}

	o2 := wave8Compose(t, st, 100_000_000)
	require.NotEqual(t, "true-at-parent", o2.eligState,
		"a spuriously eligible parent predicate over a partially valued basket must never reach the parent arm")
	require.NotEqual(t, verdictExact, o2.row.Verdict)
	require.Equal(t, "unpriced-leg", o2.eligState)
	require.Equal(t, verdictWeldUnread, o2.row.Verdict)
	require.Equal(t, "false", o2.row.Evidence["parent_basket_complete"])
	require.Contains(t, o2.row.Evidence["parent_basket_note"], "valuation incomplete",
		"the disclosure says WHY: a leg the frame never valued")
}

// --- (c): collateralOf Success=true, empty/undecodable return ---------------

// TestWave8CollateralOfEmptyOrGarbageIsRefused injects a collateralOf that
// SUCCEEDS but answers empty or undecodable bytes. The decode layer refuses
// with the subcall named; and the composed drive proves the ParentComplete
// basket conjunction carries the refusal — under m2 the empty degraded basket
// values to maxBorrow 0 and certifies a true-at-parent EXACT. Kills m2
// (distinct from m1: Success=true, so the restored silent skip never fires).
func TestWave8CollateralOfEmptyOrGarbageIsRefused(t *testing.T) {
	drive := func(t *testing.T, ret []byte) {
		t.Helper()
		tags := wave8Plan(t, true)
		res := wave8Honest(t, tags, 100_000_000)
		res[0] = multicallResult{Success: true, ReturnData: ret}

		st := wave8Decode(t, true, tags, res)
		require.NotEmpty(t, st.unread, "a successful-but-unusable collateralOf must mark the frame UNREAD")
		require.Contains(t, st.unread, "collateralOf", "the refusal names the failed subcall")
		require.Empty(t, st.collateral)

		o2 := wave8Compose(t, st, 100_000_000)
		require.NotEqual(t, "true-at-parent", o2.eligState,
			"the empty degraded basket must not certify the parent fact (the ParentComplete basket conjunction — m2's law)")
		require.NotEqual(t, verdictExact, o2.row.Verdict, "no EXACT verdict from a basket the frame did not read")
		require.Equal(t, "false", o2.row.Evidence["parent_basket_complete"])
		require.Contains(t, o2.row.Evidence["parent_basket_note"], "collateralOf")
	}
	t.Run("empty return data where the ABI promises a list", func(t *testing.T) {
		drive(t, []byte{})
	})
	t.Run("undecodable return data", func(t *testing.T) {
		garbage := make([]byte, 32)
		for i := range garbage {
			garbage[i] = 0xff
		}
		drive(t, garbage)
	})
}

// --- guard: honest frames still pass ----------------------------------------

// TestWave8HonestFrameStillPassesTrueAtParent is the over-refusal guard: a
// fully-successful response set decodes cleanly through the same law and a
// genuinely parent-eligible case still emits true-at-parent EXACT. The fix
// must refuse degraded frames, not honest ones.
func TestWave8HonestFrameStillPassesTrueAtParent(t *testing.T) {
	tags := wave8Plan(t, true)
	res := wave8Honest(t, tags, 100_000_000)

	st := wave8Decode(t, true, tags, res)
	require.Empty(t, st.unread, "an honest frame must not be refused")
	require.Len(t, st.collateral, 1)
	require.Equal(t, "100000000", st.collateral[0].amount.String())
	require.Equal(t, "1000000", st.prices[tokA].String())
	require.Equal(t, pctE18(100).String(), st.configs[tokA].LiquidationThreshold.String())
	require.Equal(t, "100000000", st.balances[tokA].String())

	// $100.000001 debt against $100.000000 maxBorrowLT: eligible at N-1 under
	// the strict > — a genuine true-at-parent case.
	o2 := wave8Compose(t, st, 100_000_001)
	require.Equal(t, "true-at-parent", o2.eligState)
	require.Equal(t, verdictExact, o2.row.Verdict)
	require.Equal(t, "true", o2.row.Evidence["parent_basket_complete"],
		"completeness is disclosed positively on honest frames too")
	require.NotContains(t, o2.row.Evidence, "parent_basket_note",
		"no degradation, no note — the key appears only when there is something to say")
}

// --- the execution frame shares the decode path — and the law ---------------

// TestWave8ExecFrameSharesTheDecodeLaw pins the sharing answer the finding
// asked for: readExecFrame reaches the SAME applyBacktestFrameResults, so the
// per-subcall refusal law covers borrowingOf and the exec-frame price reads
// identically (runBacktestCase consumes exec.st.unread the same way it
// consumes the parent's).
func TestWave8ExecFrameSharesTheDecodeLaw(t *testing.T) {
	t.Run("borrowingOf success=false is unread", func(t *testing.T) {
		tags := wave8Plan(t, false)
		res := wave8Honest(t, tags, 100_000_000)
		res[0] = multicallResult{Success: false}
		st := wave8Decode(t, false, tags, res)
		require.NotEmpty(t, st.unread, "the exec frame's residue read degrades to UNREAD, never to a silently nil chainDebt")
		require.Contains(t, st.unread, "borrowingOf", "the refusal names the failed subcall")
		require.Nil(t, st.chainDebt)
	})
	t.Run("price empty return is unread", func(t *testing.T) {
		tags := wave8Plan(t, false)
		res := wave8Honest(t, tags, 100_000_000)
		for i, tg := range tags {
			if tg.kind == "price" {
				res[i] = multicallResult{Success: true, ReturnData: []byte{}}
			}
		}
		st := wave8Decode(t, false, tags, res)
		require.NotEmpty(t, st.unread, "an exec-frame price that answers no bytes is UNREAD, never a silently unpriced token")
		require.Contains(t, st.unread, "convertCollateralTokenToUsd", "the refusal names the failed subcall")
	})
	t.Run("exec collateralOf failure is unread (the L2(a) subcall joins the law)", func(t *testing.T) {
		tags := wave8Plan(t, false)
		res := wave8Honest(t, tags, 100_000_000)
		for i, tg := range tags {
			if tg.kind == "collateralOf" {
				res[i] = multicallResult{Success: false}
			}
		}
		st := wave8Decode(t, false, tags, res)
		require.NotEmpty(t, st.unread, "a failed exec-frame collateralOf is UNREAD — leg@N is one side of the closure identity and must never be a silently empty basket")
		require.Contains(t, st.unread, "collateralOf", "the refusal names the failed subcall")
	})
	t.Run("honest exec frame decodes cleanly", func(t *testing.T) {
		tags := wave8Plan(t, false)
		st := wave8Decode(t, false, tags, wave8Honest(t, tags, 100_000_000))
		require.Empty(t, st.unread)
		require.Equal(t, "100000000", st.chainDebt.String())
		require.Equal(t, "1000000", st.prices[tokA].String())
	})
}

// --- the classifier's parent-INPUT vs WITNESS refusal ordering --------------

// TestWave8ClassifierParentInputOrdering pins requirement 3 as pure classifier
// law: parent-INPUT completeness (fold, index, basket — parentComplete) gates
// the parent arm AND the marginal arm; witness-application refusals
// (replayComplete, round 6 H1) gate only the crossing-based arms.
func TestWave8ClassifierParentInputOrdering(t *testing.T) {
	// A parent-input refusal outranks a spuriously eligible parent predicate:
	// the case lands in the unpriced refusal, never true-at-parent.
	require.Equal(t, eligUnpriced, classifyIntraBlock(true, false, false, false, false, true, false),
		"parent 'eligible' over an incompletely valued basket is the round-7 false green; the parent-input refusal must win")
	// A degraded parent state certifies NOTHING — not the parent fact, and
	// not a marginal attribution either, even with every crossing input true.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(true, false, true, true, true, true, true),
		"the marginal arm rests on the replayed parent state too: parentComplete is a conjunct there as well")
	// The round-6 law RESTATED (positive control): a witness-application
	// refusal (replayComplete=false) does NOT gate the parent arm.
	require.Equal(t, eligTrueAtParent, classifyIntraBlock(true, true, false, true, false, false, false),
		"a later witness refusal is boundary evidence, not a rewrite of the pinned parent fact (round 6 H1)")
}
