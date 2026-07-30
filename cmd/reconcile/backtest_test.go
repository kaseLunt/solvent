package main

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

var (
	tokA = common.HexToAddress("0x08c6f91e2b681faf5e17227f2a44c307b3c1364c") // liquidUSD, 6 dec
	tokB = common.HexToAddress("0x5f46d540b6ed704c3c8789105f30e075aa900726") // liquidBTC, 8 dec
)

// bonus2Pct is a 2% liquidation bonus in the Debt Manager's HUNDRED_PERCENT
// (100e18) convention — liquidUSD's actual configured value.
var bonus2Pct = mustBig("2000000000000000000")

func seizure(seq uint16, tok common.Address, amount, bonus string) snapshotdb.T6Seizure {
	return snapshotdb.T6Seizure{
		Seq: seq, AssetHex: hexLower(tok.Hex()),
		Amount: mustBig(amount), Bonus: mustBig(bonus),
		AmountText: amount, BonusText: bonus,
	}
}

func parentFrame(bal, price map[common.Address]*big.Int, bonus *big.Int, tokens ...common.Address) *frameState {
	st := &frameState{
		prices:   price,
		balances: bal,
		configs:  map[common.Address]collateralTokenConfigResult{},
	}
	for _, tk := range tokens {
		st.configs[tk] = collateralTokenConfigResult{
			LTV:                  mustBig("80000000000000000000"),
			LiquidationThreshold: mustBig("90000000000000000000"),
			LiquidationBonus:     bonus,
		}
	}
	return st
}

// TestSeizureFinalBranchIsExactAndFalsifiable pins obligation 3's FINAL branch:
// bonus == floor(collateralAmountForDebt × b / HUNDRED_PERCENT), where
// collateralAmountForDebt is inverted from the recorded amount. Inverting and
// re-deriving is what makes the check falsifiable rather than circular — an
// amount and a bonus that do not satisfy the branch's own algebra cannot both be
// right.
func TestSeizureFinalBranchIsExactAndFalsifiable(t *testing.T) {
	// cAFD = 1,000,000 (1.0 liquidUSD at 6 dec); b = 2e18 / 100e18 = 2%.
	cAFD := big.NewInt(1_000_000)
	wantBonus := new(big.Int).Mul(cAFD, bonus2Pct)
	wantBonus.Quo(wantBonus, hundredPercentDM)
	require.Equal(t, "20000", wantBonus.String(), "2% of 1,000,000")
	amount := new(big.Int).Add(cAFD, wantBonus) // 1,020,000

	db := snapshotdb.T6BacktestRow{
		Seizures:        []snapshotdb.T6Seizure{seizure(1, tokA, amount.String(), wantBonus.String())},
		NormalizedAfter: big.NewInt(0), IndexAtBlock: big.NewInt(1e18),
	}
	// The Safe holds MORE than the seizure, so the partial branch cannot apply.
	parent := parentFrame(
		map[common.Address]*big.Int{tokA: big.NewInt(50_000_000)},
		map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)},
		bonus2Pct, tokA)
	f := newGateFrame(gateBacktest)
	rows := reconstructSeizures("case", db, parent, parent, map[common.Address]uint8{tokA: 6}, f)
	require.Len(t, rows, 1)
	require.Equal(t, verdictExact, rows[0].Verdict)
	require.Contains(t, rows[0].Leg, "final branch")
	require.Contains(t, rows[0].Evidence["branch"], "FINAL")
	require.Equal(t, tolSeizureTokenWei, rows[0].Evidence["tolerance"],
		"the round-trip slack must be the NAMED tolerance, not an anonymous epsilon")
	require.Equal(t, []string{tolSeizureTokenWei}, f.Tolerances)

	// MUTATION: a bonus one wei off must FAIL. The token-unit comparison is
	// exact — the one-token-wei slack lives on the USD leg only.
	bad := new(big.Int).Add(wantBonus, big.NewInt(1))
	db.Seizures = []snapshotdb.T6Seizure{seizure(1, tokA, amount.String(), bad.String())}
	rows = reconstructSeizures("case", db, parent, parent, map[common.Address]uint8{tokA: 6}, newGateFrame(gateBacktest))
	require.Equal(t, verdictDrift, rows[0].Verdict,
		"the FINAL branch's bonus is recomputed EXACTLY; one wei off is drift, because the token-unit leg carries no tolerance")
}

// TestSeizurePartialBranchUsesTheSafeBalance pins the PARTIAL branch: amount ==
// the Safe's whole balance, bonus == totalCollateral −
// floor(totalCollateral·HP/(HP+b)).
func TestSeizurePartialBranchUsesTheSafeBalance(t *testing.T) {
	bal := big.NewInt(777_777)
	net := new(big.Int).Mul(bal, hundredPercentDM)
	net.Quo(net, new(big.Int).Add(hundredPercentDM, bonus2Pct))
	wantBonus := new(big.Int).Sub(bal, net)

	db := snapshotdb.T6BacktestRow{
		Seizures:        []snapshotdb.T6Seizure{seizure(1, tokA, bal.String(), wantBonus.String())},
		NormalizedAfter: big.NewInt(0), IndexAtBlock: big.NewInt(1e18),
	}
	parent := parentFrame(
		map[common.Address]*big.Int{tokA: bal},
		map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)},
		bonus2Pct, tokA)
	rows := reconstructSeizures("case", db, parent, parent, map[common.Address]uint8{tokA: 6}, newGateFrame(gateBacktest))
	require.Len(t, rows, 1)
	require.Equal(t, verdictExact, rows[0].Verdict)
	require.Contains(t, rows[0].Leg, "partial branch")
	require.Equal(t, bal.String(), rows[0].Evidence["total_collateral"])

	// MUTATION: the same amount with a WRONG bonus must fail.
	db.Seizures = []snapshotdb.T6Seizure{seizure(1, tokA, bal.String(), "0")}
	rows = reconstructSeizures("case", db, parent, parent, map[common.Address]uint8{tokA: 6}, newGateFrame(gateBacktest))
	require.Equal(t, verdictDrift, rows[0].Verdict)
}

// TestZeroAmountSeizureAssertsTheSafeReallyHeldNone is the DOMINANT shape on
// this population (269 of 9,242 fan-out elements carry a nonzero amount, so most
// elements are zero): the liquidator named a preference token the account did
// not hold. The falsifiable content is that the Safe balance REALLY was zero.
func TestZeroAmountSeizureAssertsTheSafeReallyHeldNone(t *testing.T) {
	db := snapshotdb.T6BacktestRow{
		Seizures:        []snapshotdb.T6Seizure{seizure(1, tokB, "0", "0")},
		NormalizedAfter: big.NewInt(0), IndexAtBlock: big.NewInt(1e18),
	}
	// Safe really held none: exact.
	parent := parentFrame(
		map[common.Address]*big.Int{tokB: big.NewInt(0)},
		map[common.Address]*big.Int{tokB: mustBig("118000000000")},
		bonus2Pct, tokB)
	rows := reconstructSeizures("case", db, parent, parent, map[common.Address]uint8{tokB: 8}, newGateFrame(gateBacktest))
	require.Len(t, rows, 1)
	require.Equal(t, verdictExact, rows[0].Verdict)

	// The Safe DID hold some but the event seized zero: that is a real
	// disagreement, not a vacuous pass.
	parent.balances[tokB] = big.NewInt(12345)
	rows = reconstructSeizures("case", db, parent, parent, map[common.Address]uint8{tokB: 8}, newGateFrame(gateBacktest))
	require.Equal(t, verdictDrift, rows[0].Verdict,
		"a zero-amount element over a NONZERO Safe balance must fail — otherwise the whole zero population would be a vacuous pass")
}

// TestSeizureInputsUnreadIsGatedNotSkipped: a missing pinned input makes the
// element weld-unread (gated), never silently exact.
func TestSeizureInputsUnreadIsGatedNotSkipped(t *testing.T) {
	db := snapshotdb.T6BacktestRow{
		Seizures: []snapshotdb.T6Seizure{seizure(1, tokA, "1000", "20")},
	}
	parent := &frameState{
		prices:   map[common.Address]*big.Int{},
		balances: map[common.Address]*big.Int{},
		configs:  map[common.Address]collateralTokenConfigResult{},
	}
	rows := reconstructSeizures("case", db, parent, parent, map[common.Address]uint8{}, newGateFrame(gateBacktest))
	require.Len(t, rows, 1)
	require.Equal(t, verdictWeldUnread, rows[0].Verdict)
	require.True(t, rows[0].Gated)
}

// TestResidueWeldSpendsTheToleranceOnlyUnderAllThreeConditions is obligation 4
// and the ONE legitimate standing tolerance: ≤1 normalized wei, derived-high
// direction only, fully-liquidated accounts only. All three conditions, or it is
// drift.
func TestResidueWeldSpendsTheToleranceOnlyUnderAllThreeConditions(t *testing.T) {
	idx := big.NewInt(1e18)
	exec := func(chainDebt int64) *frameState {
		return &frameState{chainDebt: big.NewInt(chainDebt)}
	}

	t.Run("exact: no tolerance spent", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(0), IndexAtBlock: idx}, exec(0), f)
		require.Equal(t, verdictExact, rows[0].Verdict)
		require.Empty(t, f.Tolerances, "an exact row must not cite a tolerance it did not need")
	})

	t.Run("1 wei high on a fully-liquidated account: the tolerance", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		// NormalizedAfter 1 -> our USD 1; chain says 0 (the silent zeroing).
		rows := residueWeld("c", snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(1), IndexAtBlock: idx}, exec(0), f)
		require.Equal(t, verdictExact, rows[0].Verdict)
		require.Equal(t, "residue-1-wei-tolerance-spent", rows[0].Class)
		require.Equal(t, []string{tolResidueWei}, f.Tolerances)
		require.Equal(t, tolResidueWei, rows[0].Evidence["tolerance"])
	})

	t.Run("2 wei high: outside the bound, drift", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(2), IndexAtBlock: idx}, exec(0), f)
		require.Equal(t, verdictDrift, rows[0].Verdict)
		require.Empty(t, f.Tolerances)
	})

	t.Run("1 wei LOW: wrong direction, drift", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(0), IndexAtBlock: idx}, exec(1), f)
		require.Equal(t, verdictDrift, rows[0].Verdict,
			"the tolerance is derived-HIGH only: the contract zeroes what we kept, never the other way")
		require.Empty(t, f.Tolerances)
	})

	t.Run("not fully liquidated: drift", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(1000), IndexAtBlock: idx}, exec(999), f)
		require.Equal(t, verdictDrift, rows[0].Verdict)
		require.Empty(t, f.Tolerances)
	})

	t.Run("residue already MODELLED: the tolerance is unavailable", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", snapshotdb.T6BacktestRow{
			NormalizedAfter: big.NewInt(1), IndexAtBlock: idx,
			ResidueZeroed: true, ResidueText: "1",
		}, exec(0), f)
		require.Equal(t, verdictDrift, rows[0].Verdict,
			"the deriver already emitted a residue_zeroed event, so the drift is something else and the tolerance must not be spent twice")
		require.Equal(t, "residue-modelled-yet-drifting", rows[0].Class)
		require.Empty(t, f.Tolerances)
	})

	t.Run("chain leg unread: weld-unread, gated", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(0), IndexAtBlock: idx},
			&frameState{}, f)
		require.Equal(t, verdictWeldUnread, rows[0].Verdict)
		require.True(t, rows[0].Gated)
	})
}

// TestObligation1IsTheP2Identity pins obligation 1's arithmetic: our normalized
// fold times the same-block index, floored, must equal the event's own
// beforeDebtAmount. The numbers are the two-pass case's real payload
// (before_debt_usd 1993777, index 1037090807641666446).
func TestObligation1IsTheP2Identity(t *testing.T) {
	idx := mustBig("1037090807641666446")
	// The normalized balance is HARD-CODED, never computed from the helper under
	// test (the house law): 1,922,471 x 1,037,090,807,641,666,446 / 1e18 =
	// 1,993,777 exactly, verified out of band with arbitrary-precision integer
	// arithmetic. Its neighbours land on 1,993,775 and 1,993,778, so the vector
	// is a last-digit discriminator for the bridge's rounding.
	n := mustBig("1922471")
	require.Equal(t, "1993777", mulDivFloor(n, idx).String(),
		"floor(normalized x index / 1e18) is the _getActualBorrowAmount bridge (DebtManagerStorageContract.sol:517-521)")
	require.Equal(t, "1993775", mulDivFloor(mustBig("1922470"), idx).String(), "one below")
	require.Equal(t, "1993778", mulDivFloor(mustBig("1922472"), idx).String(), "one above")
}

// TestPriceFrameDeltaDetectsAnIntraBlockMove pins risk-quant R2's detector (b):
// a price that differs between the parent and execution frames makes the case
// marginal, and the note names the token and both values.
func TestPriceFrameDeltaDetectsAnIntraBlockMove(t *testing.T) {
	parent := &frameState{prices: map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)}}
	same := &frameState{prices: map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)}}
	moved, note := priceFrameDelta(parent, same)
	require.False(t, moved)
	require.Contains(t, note, "IDENTICAL")

	execMoved := &frameState{prices: map[common.Address]*big.Int{tokA: big.NewInt(999_000)}}
	moved, note = priceFrameDelta(parent, execMoved)
	require.True(t, moved)
	require.Contains(t, note, "1000000")
	require.Contains(t, note, "999000")

	// A frame whose price is unread is NOT silently "unchanged".
	moved, note = priceFrameDelta(parent, &frameState{prices: map[common.Address]*big.Int{}})
	require.False(t, moved)
	require.Contains(t, note, "one frame's price is unread")
}
