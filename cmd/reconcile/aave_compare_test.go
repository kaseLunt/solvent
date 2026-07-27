// Aave comparison-semantics tests (brief §10: ray-math pinned to the
// DEPLOYED token's ceiling rounding; scaled comparison; welds).
package main

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// TestRayMulCeil pins the §3.4(b) identity's one arithmetic operation to
// the DEPLOYED debt token's CEILING rounding: c = ceil(a×b / RAY). The
// below-half boundary case discriminates ceil from BOTH floor and
// WadRayMath half-up (the rounding the harness wrongly assumed until the
// 2026-07-27 acceptance run refuted it on-chain).
func TestRayMulCeil(t *testing.T) {
	// Exact multiple: no spurious +1 (kills an always-increment mutant).
	require.Equal(t, "2", rayMulCeil(big.NewInt(2), rayUnit).String())
	// Smallest nonzero fraction rounds UP: floor and half-up both give 0.
	require.Equal(t, "1", rayMulCeil(big.NewInt(1), big.NewInt(1)).String())
	// Below the half boundary: a=1, b=RAY/2−1 → ceil 1; half-up gives 0 —
	// THE discriminating case against the refuted half-up assumption.
	halfMinusOne := new(big.Int).Sub(new(big.Int).Rsh(rayUnit, 1), big.NewInt(1))
	require.Equal(t, "1", rayMulCeil(big.NewInt(1), halfMinusOne).String())
	// Fixture-scale sanity: scaled 125415 at index exactly RAY is itself.
	require.Equal(t, "125415", rayMulCeil(big.NewInt(125415), rayUnit).String())
	// Compounded index: 125415 × 1.05 = 131685.75 → 131686 (ceil; half-up
	// agrees here — the below-half case above is the separator).
	idx := new(big.Int).Mul(big.NewInt(105), new(big.Int).Exp(big.NewInt(10), big.NewInt(25), nil))
	require.Equal(t, "131686", rayMulCeil(big.NewInt(125415), idx).String())
}

func TestCompareScaledBitExact(t *testing.T) {
	require.Equal(t, verdictExact, compareScaled(bi("58420665095130"), bi("58420665095130")))
	require.Equal(t, verdictDrift, compareScaled(bi("58420665095130"), bi("58420665095131")), "one wei is drift — zero tolerance")
	require.Equal(t, verdictExact, compareScaled(nil, big.NewInt(0)), "no derived rows means zero, and the chain must agree")
	require.Equal(t, verdictDrift, compareScaled(nil, big.NewInt(1)))
}

// TestLiveValueIdentity pins the identity to TWO REAL ON-CHAIN VECTORS
// (ETH pin 25,627,125, hash 0x538c27da…, replayed via cast on 2026-07-27):
// the expected values are HARD-CODED chain balanceOf reads, never computed
// from the helper under test (the old self-referential fixture is exactly
// how the half-up assumption survived eleven review rounds). Half-up
// yields 137215/83 and floor the same — both false-drift these rows.
func TestLiveValueIdentity(t *testing.T) {
	// USDC leg, golden borrower 0x70daaac…: frac ≈ .235 — chain rounds UP.
	nUSDC, ok := new(big.Int).SetString("1094089501745475497022017896", 10)
	require.True(t, ok)
	computed, verdict := liveValueIdentity(big.NewInt(125415), nUSDC, big.NewInt(137216))
	require.Equal(t, "137216", computed)
	require.Equal(t, verdictExact, verdict)
	// PYUSD leg, borrower 0xe649a39…: frac ≈ .043 — dust still rounds UP.
	nPYUSD, ok := new(big.Int).SetString("1000520158840839583052050491", 10)
	require.True(t, ok)
	computed, verdict = liveValueIdentity(big.NewInt(83), nPYUSD, big.NewInt(84))
	require.Equal(t, "84", computed)
	require.Equal(t, verdictExact, verdict)
	// One unit of disagreement stays drift — zero tolerance.
	_, verdict = liveValueIdentity(big.NewInt(83), nPYUSD, big.NewInt(85))
	require.Equal(t, verdictDrift, verdict)
}

// TestWeldAaveAggregate pins the F1 Aave weld: debt side gated at zero
// bound; collateral side advisory on the first run (amendment); the row set
// is the AUTHORITATIVE universe (getReservesList@pin ∪ derived, round-10
// F3) unioned with both fact sets — and an unread leg is a weld-unread row,
// never an absent one and never a fake zero.
func TestWeldAaveAggregate(t *testing.T) {
	usdc := common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	pyusd := common.HexToAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8")
	ghost := common.HexToAddress("0x83F20F44975D03b1b09e64809B757c47f942BEeA") // listed reserve, nothing derived, read failed
	vUSDC := common.HexToAddress("0x9355032d0e5c8Dc8bBcbB55f1b1e18DD6E971b8C")
	tokens := map[common.Address]common.Address{usdc: vUSDC, pyusd: {}}
	universe := []common.Address{usdc, ghost} // the Pool's own list; pyusd is derived-only

	rows := weldAaveAggregate("debt", true,
		map[common.Address]*big.Int{usdc: big.NewInt(125498), pyusd: big.NewInt(83)},
		map[common.Address]chainRead{
			usdc:  {Total: big.NewInt(125498), OK: true},
			pyusd: {Total: big.NewInt(0), OK: true}, // a REAL zero read
			ghost: {Note: "getReserveVariableDebtToken unsuccessful (reverted) at the pin"},
		},
		tokens, universe)
	require.Len(t, rows, 3, "universe ∪ derived ∪ reads — no reserve vanishes")
	byReserve := map[string]aaveWeldRow{}
	for _, r := range rows {
		require.True(t, r.Gated, "debt weld is GATED")
		byReserve[r.ReserveHex] = r
	}
	require.Equal(t, verdictExact, byReserve[usdc.Hex()].Verdict)
	require.Equal(t, verdictAggregateMismatch, byReserve[pyusd.Hex()].Verdict,
		"a derived sum against a REAL chain zero is a numeric disagreement — union, never intersection")
	require.Equal(t, verdictWeldUnread, byReserve[ghost.Hex()].Verdict,
		"an unreadable universe reserve is a GATED weld-unread row (round-10 F3)")
	require.Equal(t, "(unread)", byReserve[ghost.Hex()].ChainTotal)
	require.Contains(t, byReserve[ghost.Hex()].ReadError, "reverted")

	adv := weldAaveAggregate("collateral", false,
		map[common.Address]*big.Int{usdc: big.NewInt(1)},
		map[common.Address]chainRead{usdc: {Total: big.NewInt(2), OK: true}},
		tokens, []common.Address{usdc})
	require.Len(t, adv, 1)
	require.False(t, adv[0].Gated, "collateral weld is ADVISORY on the first run (risk-quant F1, amendment)")
	require.Equal(t, verdictAggregateMismatch, adv[0].Verdict, "advisory still REPORTS the mismatch")
}

// TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory — round-11 F2. Two
// SEPARATE policies meet in the collateral weld: the NUMERIC-mismatch
// policy (advisory on the first run, per the amendment) and the
// ability-to-check policy — "cannot verify" is NEVER advisory. A universe
// reserve whose getReserveAToken resolution reverted (phase 2 wires
// unresolvedColl into the read map in exactly the OK=false shape used
// here), or whose scaledTotalSupply leg was never read at all, must GATE
// the run even while the side's numeric rows stay advisory — and the
// assertion runs through the REAL accounting (aaveWeldGatedFailures, the
// phase-2 site's own function) into the REAL verdict.
func TestCollateralUnreadIsGatedEvenWhenNumericIsAdvisory(t *testing.T) {
	usdc := common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	weeth := common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee") // universe reserve, NO read recorded at all
	ghost := common.HexToAddress("0x83F20F44975D03b1b09e64809B757c47f942BEeA") // getReserveAToken reverted at the pin

	rows := weldAaveAggregate("collateral", false, /* numeric policy: advisory (amendment) */
		map[common.Address]*big.Int{usdc: big.NewInt(5)},
		map[common.Address]chainRead{
			usdc:  {Total: big.NewInt(7), OK: true}, // read fine, numbers disagree
			ghost: {Note: "getReserveAToken unsuccessful (reverted) at the pin"},
		},
		map[common.Address]common.Address{},
		[]common.Address{usdc, weeth, ghost})
	require.Len(t, rows, 3)
	byReserve := map[string]aaveWeldRow{}
	for _, r := range rows {
		byReserve[r.ReserveHex] = r
	}

	// Policy 1 — numeric collateral mismatch stays ADVISORY (amendment).
	require.Equal(t, verdictAggregateMismatch, byReserve[usdc.Hex()].Verdict)
	require.False(t, byReserve[usdc.Hex()].Gated,
		"a READ collateral mismatch stays advisory on the first run (amendment)")

	// Policy 2 — inability to check GATES, whichever weld produced it.
	for _, r := range []common.Address{ghost, weeth} {
		require.Equal(t, verdictWeldUnread, byReserve[r.Hex()].Verdict)
		require.True(t, byReserve[r.Hex()].Gated,
			"weld-unread is ALWAYS GATED — 'cannot verify' is never advisory (round-11 F2)")
	}
	require.Contains(t, byReserve[ghost.Hex()].ReadError, "getReserveAToken")

	// The REAL accounting + the REAL verdict: two unread collateral legs
	// are two gated failures; the run is structurally non-pass.
	failures := aaveWeldGatedFailures(rows)
	require.Equal(t, 2, failures, "the advisory numeric row must NOT count; both unread rows MUST")
	result, code := computeResult(failures, 0, nil)
	require.Equal(t, "fail", result)
	require.Equal(t, exitVerdictFail, code)

	// And a fully-read collateral weld with only numeric drift still
	// contributes ZERO gated failures — the separation cuts both ways.
	clean := weldAaveAggregate("collateral", false,
		map[common.Address]*big.Int{usdc: big.NewInt(5)},
		map[common.Address]chainRead{usdc: {Total: big.NewInt(7), OK: true}},
		map[common.Address]common.Address{}, []common.Address{usdc})
	require.Zero(t, aaveWeldGatedFailures(clean),
		"numeric-advisory alone must not gate — the two policies are separate")
}

func TestDerivedScaledByReserve(t *testing.T) {
	usdc := common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	m := derivedScaledByReserve([]store.AssetNetSum{{Asset: usdc.Bytes(), Total: big.NewInt(9)}})
	require.Equal(t, "9", m[usdc].String())
}
