// Aave comparison-semantics tests (brief §10: rayMulHalfUp round-trip
// against internal/derive's cases; scaled comparison; welds).
package main

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// TestRayMulHalfUp pins the §3.4(b) identity's one arithmetic operation to
// WadRayMath.rayMul's half-up rounding: c = (a×b + RAY/2) / RAY. The
// boundary case distinguishes half-up from floor.
func TestRayMulHalfUp(t *testing.T) {
	require.Equal(t, "2", rayMulHalfUp(big.NewInt(2), rayUnit).String())
	// a=1, b=RAY/2: floor gives 0; HALF-UP gives 1 — the discriminating case.
	require.Equal(t, "1", rayMulHalfUp(big.NewInt(1), halfRay).String())
	// Just below the rounding boundary: a=1, b=RAY/2−1 → 0.
	require.Equal(t, "0", rayMulHalfUp(big.NewInt(1), new(big.Int).Sub(halfRay, big.NewInt(1))).String())
	// Fixture-scale sanity: scaled 125415 at index exactly RAY is itself.
	require.Equal(t, "125415", rayMulHalfUp(big.NewInt(125415), rayUnit).String())
	// Compounded index: scaled × 1.05e27 half-up.
	idx := new(big.Int).Mul(big.NewInt(105), new(big.Int).Exp(big.NewInt(10), big.NewInt(25), nil))
	require.Equal(t, "131686", rayMulHalfUp(big.NewInt(125415), idx).String()) // 125415×1.05 = 131685.75 → 131686 half-up
}

func TestCompareScaledBitExact(t *testing.T) {
	require.Equal(t, verdictExact, compareScaled(bi("58420665095130"), bi("58420665095130")))
	require.Equal(t, verdictDrift, compareScaled(bi("58420665095130"), bi("58420665095131")), "one wei is drift — zero tolerance")
	require.Equal(t, verdictExact, compareScaled(nil, big.NewInt(0)), "no derived rows means zero, and the chain must agree")
	require.Equal(t, verdictDrift, compareScaled(nil, big.NewInt(1)))
}

func TestLiveValueIdentity(t *testing.T) {
	scaled := big.NewInt(125415)
	normalized := new(big.Int).Mul(big.NewInt(109386), new(big.Int).Exp(big.NewInt(10), big.NewInt(22), nil)) // ≈1.09386e27
	expected := rayMulHalfUp(scaled, normalized)
	computed, verdict := liveValueIdentity(scaled, normalized, expected)
	require.Equal(t, expected.String(), computed)
	require.Equal(t, verdictExact, verdict)
	_, verdict = liveValueIdentity(scaled, normalized, new(big.Int).Add(expected, big.NewInt(1)))
	require.Equal(t, verdictDrift, verdict)
}

// TestWeldAaveAggregate pins the F1 Aave weld: debt side gated at zero
// bound; collateral side advisory on the first run (amendment); union of
// key sets.
func TestWeldAaveAggregate(t *testing.T) {
	usdc := common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	pyusd := common.HexToAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8")
	vUSDC := common.HexToAddress("0x9355032d0e5c8Dc8bBcbB55f1b1e18DD6E971b8C")
	tokens := map[common.Address]common.Address{usdc: vUSDC, pyusd: {}}

	rows := weldAaveAggregate("debt", true,
		map[common.Address]*big.Int{usdc: big.NewInt(125498), pyusd: big.NewInt(83)},
		map[common.Address]*big.Int{usdc: big.NewInt(125498)},
		tokens)
	require.Len(t, rows, 2)
	byReserve := map[string]aaveWeldRow{}
	for _, r := range rows {
		require.True(t, r.Gated, "debt weld is GATED")
		byReserve[r.ReserveHex] = r
	}
	require.Equal(t, verdictExact, byReserve[usdc.Hex()].Verdict)
	require.Equal(t, verdictAggregateMismatch, byReserve[pyusd.Hex()].Verdict,
		"a derived sum with no chain total surfaces — union, never intersection")

	adv := weldAaveAggregate("collateral", false,
		map[common.Address]*big.Int{usdc: big.NewInt(1)},
		map[common.Address]*big.Int{usdc: big.NewInt(2)}, tokens)
	require.Len(t, adv, 1)
	require.False(t, adv[0].Gated, "collateral weld is ADVISORY on the first run (risk-quant F1, amendment)")
	require.Equal(t, verdictAggregateMismatch, adv[0].Verdict, "advisory still REPORTS the mismatch")
}

func TestDerivedScaledByReserve(t *testing.T) {
	usdc := common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	m := derivedScaledByReserve([]store.AssetNetSum{{Asset: usdc.Bytes(), Total: big.NewInt(9)}})
	require.Equal(t, "9", m[usdc].String())
}
