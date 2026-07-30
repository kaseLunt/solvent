package main

import (
	"math/big"
	"strings"
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

// TestSeizureIsAnchoredToLiquidatedUSD is the round-1 finding-5 regression.
//
// WHAT IT KILLS: the previous reconstruction inverted collateralAmountForDebt from
// the OBSERVED amount-minus-bonus and re-derived the bonus from that same inverted
// value, so any PROPORTIONALLY wrong pair satisfied it and LiquidatedUSD was never
// consumed. The MUTATION subtest scales amount and bonus together by 2x - which the
// old check accepted - and requires the new one to reject it.
func TestSeizureIsAnchoredToLiquidatedUSD(t *testing.T) {
	// One 6-dec token at P = 1.0 USD, 2% bonus. Budget u0 = 1,000,000 (=$1.00).
	// cAFD = floor(1e6 * 1e6 / 1e6) = 1,000,000 ; bonus = 2% = 20,000 ;
	// amount = 1,020,000. The Safe holds far more, so the FINAL branch applies.
	u0 := big.NewInt(1_000_000)
	cAFD := big.NewInt(1_000_000)
	bonus := new(big.Int).Mul(cAFD, bonus2Pct)
	bonus.Quo(bonus, hundredPercentDM)
	require.Equal(t, "20000", bonus.String())
	amount := new(big.Int).Add(cAFD, bonus)

	parent := parentFrame(
		map[common.Address]*big.Int{tokA: big.NewInt(50_000_000)},
		map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)},
		bonus2Pct, tokA)
	decs := map[common.Address]uint8{tokA: 6}

	mkRow := func(amt, bns *big.Int) snapshotdb.T6BacktestRow {
		return snapshotdb.T6BacktestRow{
			Seizures:        []snapshotdb.T6Seizure{seizure(1, tokA, amt.String(), bns.String())},
			LiquidatedUSD:   new(big.Int).Set(u0),
			NormalizedAfter: big.NewInt(0), IndexAtBlock: big.NewInt(1e18),
		}
	}

	t.Run("the honest pair passes and spends the budget exactly", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("case", newBacktestView(mkRow(amount, bonus), f), parent, decs, f)
		require.Zero(t, tallyP3(rows), "an exactly-reconstructed FINAL element must not gate")
		var sawBudget, sawPredicate bool
		for _, r := range rows {
			if strings.Contains(r.Leg, "carried repay budget fully spent") {
				sawBudget = true
				require.Equal(t, verdictExact, r.Verdict)
				require.Equal(t, u0.String(), r.Evidence["u0"], "the budget IS liquidatedAmt")
			}
			if strings.Contains(r.Leg, "branch predicate") {
				sawPredicate = true
				require.Equal(t, "FINAL", r.Expected)
			}
		}
		require.True(t, sawBudget, "the budget must be asserted, not merely carried")
		require.True(t, sawPredicate, "the branch PREDICATE must be welded at the carried budget")
		require.Equal(t, []toleranceID{tolSeizureTokenWei}, f.cited)
	})

	t.Run("MUTATION: a PROPORTIONALLY wrong pair is rejected", func(t *testing.T) {
		// Scale amount and bonus together. amount-bonus = 2x cAFD and
		// bonus = 2% of that, so the OLD inverted check was satisfied exactly.
		badCAFD := new(big.Int).Mul(cAFD, big.NewInt(2))
		badBonus := new(big.Int).Mul(badCAFD, bonus2Pct)
		badBonus.Quo(badBonus, hundredPercentDM)
		badAmount := new(big.Int).Add(badCAFD, badBonus)
		// Prove the old check would have passed: bonus == floor((amount-bonus)*b/HP).
		inverted := new(big.Int).Sub(badAmount, badBonus)
		check := new(big.Int).Mul(inverted, bonus2Pct)
		check.Quo(check, hundredPercentDM)
		require.Equal(t, badBonus.String(), check.String(),
			"the mutated pair satisfies the OLD inverted-cAFD identity, which is why that check could not catch it")

		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("case", newBacktestView(mkRow(badAmount, badBonus), f), parent, decs, f)
		require.Positive(t, tallyP3(rows),
			"a pair that does not follow from the CARRIED liquidatedAmt budget must gate: this is the finding-5 kill")
	})

	t.Run("MUTATION: a wrong budget is rejected", func(t *testing.T) {
		// The elements are internally perfect; only liquidatedAmt disagrees.
		row := mkRow(amount, bonus)
		row.LiquidatedUSD = big.NewInt(500_000)
		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("case", newBacktestView(row, f), parent, decs, f)
		require.Positive(t, tallyP3(rows),
			"LiquidatedUSD is now CONSUMED, so a budget that does not produce the observed elements must gate")
	})

	t.Run("an absent budget is weld-unread, never inverted from the elements", func(t *testing.T) {
		row := mkRow(amount, bonus)
		row.LiquidatedUSD = nil
		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("case", newBacktestView(row, f), parent, decs, f)
		require.Equal(t, verdictWeldUnread, rows[len(rows)-1].Verdict)
		require.Positive(t, tallyP3(rows))
	})
}

// TestSeizureAllPartialShapeTiesEveryElementToTheBudget covers the other
// determinate shape: the preference array ran out, so liquidatedAmt is the SUM of
// the credited USD over every element - one exact equation across the fan-out.
func TestSeizureAllPartialShapeTiesEveryElementToTheBudget(t *testing.T) {
	// The Safe holds exactly 777,777 of a 6-dec token at P = 1.0, 2% bonus, and the
	// debt exceeds it, so the PARTIAL branch takes the whole balance.
	bal := big.NewInt(777_777)
	net := new(big.Int).Mul(bal, hundredPercentDM)
	net.Quo(net, new(big.Int).Add(hundredPercentDM, bonus2Pct))
	wantBonus := new(big.Int).Sub(bal, net)
	credited := new(big.Int).Sub(bal, wantBonus)
	credited.Mul(credited, big.NewInt(1_000_000))
	credited.Quo(credited, pow10Big(6))

	parent := parentFrame(
		map[common.Address]*big.Int{tokA: bal},
		map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)},
		bonus2Pct, tokA)
	decs := map[common.Address]uint8{tokA: 6}
	row := snapshotdb.T6BacktestRow{
		Seizures:        []snapshotdb.T6Seizure{seizure(1, tokA, bal.String(), wantBonus.String())},
		LiquidatedUSD:   credited,
		NormalizedAfter: big.NewInt(0), IndexAtBlock: big.NewInt(1e18),
	}
	f := newGateFrame(gateBacktest)
	rows := reconstructSeizures("case", newBacktestView(row, f), parent, decs, f)
	require.Zero(t, tallyP3(rows), "the all-partial shape must reconcile exactly")
	var sawSum bool
	for _, r := range rows {
		if strings.Contains(r.Leg, "sum of credited USD over ALL elements") {
			sawSum = true
			require.Equal(t, verdictExact, r.Verdict)
			require.Equal(t, credited.String(), r.Actual)
		}
	}
	require.True(t, sawSum, "the all-partial shape must assert the budget equation")

	// MUTATION: a bonus one wei off breaks both the element check and the sum.
	row.Seizures = []snapshotdb.T6Seizure{seizure(1, tokA, bal.String(), new(big.Int).Add(wantBonus, big.NewInt(1)).String())}
	f2 := newGateFrame(gateBacktest)
	require.Positive(t, tallyP3(reconstructSeizures("case", newBacktestView(row, f2), parent, decs, f2)))
}

// TestZeroAmountSeizureAssertsTheSafeReallyHeldNone is the DOMINANT shape on this
// population (269 of 9,242 fan-out elements carry a nonzero amount): the
// liquidator named a preference token the account did not hold. The falsifiable
// content is that the Safe balance REALLY was zero.
func TestZeroAmountSeizureAssertsTheSafeReallyHeldNone(t *testing.T) {
	decs := map[common.Address]uint8{tokB: 8}
	row := snapshotdb.T6BacktestRow{
		Seizures:        []snapshotdb.T6Seizure{seizure(1, tokB, "0", "0")},
		LiquidatedUSD:   big.NewInt(0),
		NormalizedAfter: big.NewInt(0), IndexAtBlock: big.NewInt(1e18),
	}
	// Safe really held none: exact.
	parent := parentFrame(
		map[common.Address]*big.Int{tokB: big.NewInt(0)},
		map[common.Address]*big.Int{tokB: mustBig("118000000000")},
		bonus2Pct, tokB)
	f := newGateFrame(gateBacktest)
	require.Zero(t, tallyP3(reconstructSeizures("case", newBacktestView(row, f), parent, decs, f)))

	// The Safe DID hold some but the event seized zero: a real disagreement.
	parent.balances[tokB] = big.NewInt(12345)
	f2 := newGateFrame(gateBacktest)
	require.Positive(t, tallyP3(reconstructSeizures("case", newBacktestView(row, f2), parent, decs, f2)),
		"a zero-amount element over a NONZERO Safe balance must fail - otherwise the whole zero population is a vacuous pass")
}

// TestSeizureInputsUnreadIsGatedNotSkipped: a missing pinned input makes the
// element weld-unread (gated), never silently exact.
func TestSeizureInputsUnreadIsGatedNotSkipped(t *testing.T) {
	row := snapshotdb.T6BacktestRow{
		Seizures:      []snapshotdb.T6Seizure{seizure(1, tokA, "1000", "20")},
		LiquidatedUSD: big.NewInt(1000),
	}
	parent := &frameState{
		prices:   map[common.Address]*big.Int{},
		balances: map[common.Address]*big.Int{},
		configs:  map[common.Address]collateralTokenConfigResult{},
	}
	f := newGateFrame(gateBacktest)
	rows := reconstructSeizures("case", newBacktestView(row, f), parent, map[common.Address]uint8{}, f)
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
		rows := residueWeld("c", newBacktestView(snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(0), IndexAtBlock: idx}, f), exec(0), f)
		require.Equal(t, verdictExact, rows[0].Verdict)
		require.Empty(t, f.Tolerances, "an exact row must not cite a tolerance it did not need")
	})

	t.Run("1 wei high on a fully-liquidated account: the tolerance", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		// NormalizedAfter 1 -> our USD 1; chain says 0 (the silent zeroing).
		rows := residueWeld("c", newBacktestView(snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(1), IndexAtBlock: idx}, f), exec(0), f)
		require.Equal(t, verdictExact, rows[0].Verdict)
		require.Equal(t, "residue-1-wei-tolerance-spent", rows[0].Class)
		require.Equal(t, []toleranceID{tolResidueWei}, f.cited)
		require.Equal(t, tolResidueWei.String(), rows[0].Evidence["tolerance"])
	})

	t.Run("2 wei high: outside the bound, drift", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", newBacktestView(snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(2), IndexAtBlock: idx}, f), exec(0), f)
		require.Equal(t, verdictDrift, rows[0].Verdict)
		require.Empty(t, f.Tolerances)
	})

	t.Run("1 wei LOW: wrong direction, drift", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", newBacktestView(snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(0), IndexAtBlock: idx}, f), exec(1), f)
		require.Equal(t, verdictDrift, rows[0].Verdict,
			"the tolerance is derived-HIGH only: the contract zeroes what we kept, never the other way")
		require.Empty(t, f.Tolerances)
	})

	t.Run("not fully liquidated: drift", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", newBacktestView(snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(1000), IndexAtBlock: idx}, f), exec(999), f)
		require.Equal(t, verdictDrift, rows[0].Verdict)
		require.Empty(t, f.Tolerances)
	})

	t.Run("residue already MODELLED: the tolerance is unavailable", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", newBacktestView(snapshotdb.T6BacktestRow{
			NormalizedAfter: big.NewInt(1), IndexAtBlock: idx,
			ResidueZeroed: true, ResidueText: "1",
		}, f), exec(0), f)
		require.Equal(t, verdictDrift, rows[0].Verdict,
			"the deriver already emitted a residue_zeroed event, so the drift is something else and the tolerance must not be spent twice")
		require.Equal(t, "residue-modelled-yet-drifting", rows[0].Class)
		require.Empty(t, f.Tolerances)
	})

	t.Run("chain leg unread: weld-unread, gated", func(t *testing.T) {
		f := newGateFrame(gateBacktest)
		rows := residueWeld("c", newBacktestView(snapshotdb.T6BacktestRow{NormalizedAfter: big.NewInt(0), IndexAtBlock: idx}, f),
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
