// DM comparison-semantics tests (brief §10): bridge floor + injectivity
// edge, zero-trim set equality in BOTH directions, the F2 exact residue
// hypothesis (fully_liquidated predicate is load-bearing — mutation target
// 9), the F1 weld census (mutation target: sampled-only weld), the §3.6
// recurrence, and the tolerance-laundering guard's row-level inputs.
package main

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

func bi(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad int " + s)
	}
	return v
}

// TestMulDivFloorBridge pins the §3.3 bridge to the contract's own
// arithmetic (DebtManagerStorageContract.sol:520-522, floor): the recon
// validation triple reproduces bit-exactly, and the floor-vs-ceil edge
// (mutation target 1) is decided by a remainder-bearing case.
func TestMulDivFloorBridge(t *testing.T) {
	idx := bi("1042402553573226850") // getCurrentIndex(USDC) at PIN 154,021,227
	require.Equal(t, "1004681", mulDivFloor(bi("963813"), idx).String(), "recon borrower 1")
	require.Equal(t, "4154797137", mulDivFloor(bi("3985789485"), idx).String(), "recon borrower 2")
	require.Equal(t, "7457111", mulDivFloor(bi("7153773"), idx).String(), "recon borrower 3")

	// floor vs ceil: n=1, I=1e18+1 → n·I/1e18 = 1.000…001 → floor 1, ceil 2.
	onePlus := new(big.Int).Add(wad, big.NewInt(1))
	require.Equal(t, "1", mulDivFloor(big.NewInt(1), onePlus).String(),
		"the bridge rounds DOWN — a ceil manufactures 1-wei drift on every remainder-bearing row")
}

// TestBridgeInjectivityEdge pins the §3.3 injectivity lemma at its boundary
// I = 1e18 (and I = 1e18+1): distinct normalized values never collide
// through the bridge, so USD-level equality ⟺ normalized equality.
func TestBridgeInjectivityEdge(t *testing.T) {
	for _, idx := range []*big.Int{new(big.Int).Set(wad), new(big.Int).Add(wad, big.NewInt(1))} {
		seen := map[string]string{}
		for n := int64(0); n < 1000; n++ {
			out := mulDivFloor(big.NewInt(n), idx).String()
			prev, dup := seen[out]
			require.False(t, dup, "collision at I=%s: n=%d and n=%s both bridge to %s", idx, n, prev, out)
			seen[out] = big.NewInt(n).String()
		}
	}
}

// TestCompareDMRowZeroTrimSetEquality pins §3.3's set semantics (L2-7) in
// BOTH directions (mutation target 3: "set-equality weakened to subset"):
// a DB amount-0 row is trimmed like the contract trims its array (healthy),
// a nonzero DB token absent from the chain array is phantom debt, and a
// chain token absent from the DB is a derivation miss — a SUBSET check
// would pass that last case.
func TestCompareDMRowZeroTrimSetEquality(t *testing.T) {
	usdc := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	usdt := common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	idx := map[common.Address]*big.Int{usdc: new(big.Int).Set(wad), usdt: new(big.Int).Set(wad)}

	// Healthy: closed position (amount-0 DB row) + one live token.
	row := compareDMRow("acct",
		map[common.Address]*big.Int{usdc: big.NewInt(100), usdt: big.NewInt(0)},
		[]tokenAmount{{Token: usdc, Amount: big.NewInt(100)}}, big.NewInt(100), idx)
	require.True(t, row.SetEqual, "an amount-0 DB row is EXCLUDED from the set — the contract assembly-trims zeros")
	require.Equal(t, verdictExact, row.Verdict)

	// Phantom debt: DB nonzero token, chain array empty.
	row = compareDMRow("acct",
		map[common.Address]*big.Int{usdc: big.NewInt(5)},
		nil, big.NewInt(0), idx)
	require.False(t, row.SetEqual)
	require.Equal(t, []string{usdc.Hex()}, row.SetOnlyDB)
	require.Equal(t, verdictDrift, row.Verdict)

	// Derivation miss: chain token the DB never derived — the leg a subset
	// check would silently pass.
	row = compareDMRow("acct",
		map[common.Address]*big.Int{},
		[]tokenAmount{{Token: usdt, Amount: big.NewInt(7)}}, big.NewInt(7), idx)
	require.False(t, row.SetEqual)
	require.Equal(t, []string{usdt.Hex()}, row.SetOnlyChain)
	require.Equal(t, verdictDrift, row.Verdict)
}

func TestCompareDMRowSumAgainstTotal(t *testing.T) {
	usdc := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	idx := map[common.Address]*big.Int{usdc: new(big.Int).Set(wad)}
	row := compareDMRow("acct",
		map[common.Address]*big.Int{usdc: big.NewInt(100)},
		[]tokenAmount{{Token: usdc, Amount: big.NewInt(100)}}, big.NewInt(101), idx)
	require.False(t, row.SumEqualsTotal, "Σ per-token must equal the view's own total")
	require.Equal(t, verdictDrift, row.Verdict)
}

// TestResidueShapedExactHypothesis is the F2 replacement for the deleted
// ±1-wei epsilon: residue-shaped iff fully-liquidated AND no residue_zeroed
// event for the (account, token) AND floor((n−1)·I/1e18) == chain amount
// BIT-EXACTLY — derived-high-only by construction, no tunable value.
// Mutation target 9 ("residue classification without the fully_liquidated
// predicate") is killed by the first case.
func TestResidueShapedExactHypothesis(t *testing.T) {
	idx := bi("1042402553573226850")
	nDerived := big.NewInt(101)
	chainAmt := mulDivFloor(big.NewInt(100), idx) // the contract zeroed 1 wei

	require.False(t, residueShaped(false, false, nDerived, idx, chainAmt),
		"a NON-liquidated account with the same numeric shape is a DIFFERENT bug — the fully_liquidated predicate is load-bearing")
	require.True(t, residueShaped(true, false, nDerived, idx, chainAmt))
	require.False(t, residueShaped(true, true, nDerived, idx, chainAmt),
		"a residue_zeroed event means the deriver already modeled the zeroing — this drift is something else")
	// Direction: derived-LOW is never residue-shaped (a floor/ceil
	// inversion elsewhere, per the consult).
	lowDerived := big.NewInt(99)
	require.False(t, residueShaped(true, false, lowDerived, idx, chainAmt))
	// Magnitude: exactly one normalized wei, not two.
	require.False(t, residueShaped(true, false, big.NewInt(102), idx, chainAmt))
	// Zero/negative derived can never be residue-shaped.
	require.False(t, residueShaped(true, false, big.NewInt(0), idx, chainAmt))
}

func TestClassifyDMMismatchPrecedence(t *testing.T) {
	idx := bi("1042402553573226850")
	// residue-shaped beats everything.
	require.Equal(t, classResidueShaped,
		classifyDMMismatch(true, false, big.NewInt(101), idx, mulDivFloor(big.NewInt(100), idx), nil, true, 5))
	// missing-genesis: no derived events, zero DB, nonzero chain.
	require.Equal(t, classMissingGenesis,
		classifyDMMismatch(false, false, big.NewInt(0), idx, big.NewInt(777), nil, false, 0))
	// index-class: the DB's latest persisted index reproduces the chain
	// amount where getCurrentIndex does not.
	dbIdx := bi("1042000000000000000")
	n := big.NewInt(963813)
	require.Equal(t, classIndexClass,
		classifyDMMismatch(false, false, n, idx, mulDivFloor(n, dbIdx), dbIdx, true, 0))
	// stable-snap-suspect (F6): unexplained drift on an account whose
	// borrows were snap-priced — hypothesis label, still fails.
	require.Equal(t, classStableSnapSuspect,
		classifyDMMismatch(false, false, big.NewInt(50), idx, big.NewInt(60), nil, true, 3))
	// unclassified when nothing matches.
	require.Equal(t, classUnclassified,
		classifyDMMismatch(false, false, big.NewInt(50), idx, big.NewInt(60), nil, true, 0))
}

// TestWeldDMAggregateZeroBoundAndUnion pins the F1 weld: zero bound, both
// key directions surfaced, the migration caveat NAMED on every row.
func TestWeldDMAggregateZeroBoundAndUnion(t *testing.T) {
	usdc := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	usdt := common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	weeth := common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")

	inputs := dmWeldInputs{
		All: []store.AssetNetSum{
			{Asset: usdc.Bytes(), Total: big.NewInt(1000)},
			{Asset: usdt.Bytes(), Total: big.NewInt(5)}, // derived, no chain config
		},
		SampleTotals: map[string]*big.Int{hexLower(usdc.Hex()): big.NewInt(400)},
	}
	chainTotals := map[common.Address]*big.Int{
		usdc:  big.NewInt(1000),
		weeth: big.NewInt(9), // chain total, nothing derived
	}
	rows := weldDMAggregate(inputs, chainTotals)
	require.Len(t, rows, 3, "the union of both key sets — a one-sided token must surface, not vanish")
	byToken := map[string]dmWeldRow{}
	for _, r := range rows {
		byToken[r.TokenHex] = r
		require.Equal(t, dmWeldNote, r.Note, "the migration-era seeding caveat is NAMED on every row")
	}
	require.Equal(t, verdictExact, byToken[usdc.Hex()].Verdict)
	require.Equal(t, "400", byToken[usdc.Hex()].SampleCoverage)
	require.Equal(t, verdictAggregateMismatch, byToken[usdt.Hex()].Verdict)
	require.Equal(t, verdictAggregateMismatch, byToken[weeth.Hex()].Verdict)
	// ZERO bound: a 1-wei delta is a mismatch.
	chainTotals[usdc] = big.NewInt(1001)
	rows = weldDMAggregate(inputs, chainTotals)
	for _, r := range rows {
		if r.TokenHex == usdc.Hex() {
			require.Equal(t, verdictAggregateMismatch, r.Verdict)
		}
	}
}

// TestComputeDMWeldInputsCoversAllAccounts is the amendment's NAMED mutation
// kill (F1: "a weld computed over sampled-accounts-only must be killed"):
// the weld's derived side is the ALL-ACCOUNTS census (p1.dmAllNet), and the
// sampled aggregation exists ONLY as the coverage diagnostic. A mutant that
// swaps the sample aggregation into .All shows 400 where the census says
// 1000 — the phantom borrower's 600 vanishes exactly as F1 describes.
func TestComputeDMWeldInputsCoversAllAccounts(t *testing.T) {
	usdc := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	sampledAccount := []byte{0xaa, 0x01}
	p1 := &phase1Data{
		dmAllNet: []store.AssetNetSum{{Asset: usdc.Bytes(), Total: big.NewInt(1000)}}, // ALL accounts (incl. the never-sampled 600)
		dmAsOf: []store.AsOfSum{
			{Account: sampledAccount, Asset: usdc.Bytes(), Side: "debt", Total: big.NewInt(400)},
		},
	}
	inputs := computeDMWeldInputs(p1)
	require.Len(t, inputs.All, 1)
	require.Equal(t, "1000", inputs.All[0].Total.String(),
		"the weld's derived side is the WHOLE-TABLE census — a sampled-only weld cannot see phantom debt")
	require.Equal(t, "400", inputs.SampleTotals[hexLower(usdc.Hex())].String(),
		"the sampled subset is recorded as coverage, never as the weld input")
}

// TestRecomputeIndexRecurrence pins §3.6's single mulDiv-floor formula
// (DebtManagerStorageContract.sol:559-567): idx_rec = idx_b + floor(idx_b ×
// apy × dt / 100e18).
func TestRecomputeIndexRecurrence(t *testing.T) {
	idxB := new(big.Int).Set(wad)     // 1e18
	apy := bi("10000000000000000000") // 10e18 on the 100e18 = 100% scale
	// dt = 100 s: accrual = floor(1e18 × 10e18 × 100 / 100e18) = 1e19.
	rec := recomputeIndex(idxB, apy, 100)
	require.Equal(t, "1000000000000000000", idxB.String(), "inputs are never mutated")
	want := new(big.Int).Add(new(big.Int).Set(wad), bi("10000000000000000000"))
	require.Equal(t, want.String(), rec.String())
	// Floor: dt=1, apy=1 → accrual floor(1e18×1×1/1e20) = 0.
	rec = recomputeIndex(idxB, big.NewInt(1), 1)
	require.Equal(t, idxB.String(), rec.String())
}

func TestEvaluateIndexCheckVerdicts(t *testing.T) {
	idxB := new(big.Int).Set(wad)
	apy := &store.APYObservation{Value: bi("10000000000000000000"), Block: 50, Source: "borrow_apy_set.new_apy"}
	chain := recomputeIndex(idxB, apy.Value, 100)

	// no IIU history: NOT gated, never a vacuous pass.
	row := evaluateIndexCheck("0xT", nil, 0, nil, 0, nil, false)
	require.Equal(t, verdictNoIIUHistory, row.Verdict)
	require.False(t, row.Gated)

	// IIU history + sampled debt + NO APY: gated named failure (§3.6 —
	// config events are persisted; absence is a derivation gap).
	row = evaluateIndexCheck("0xT", idxB, 50, nil, 0, chain, true)
	require.Equal(t, verdictMissingAPY, row.Verdict)
	require.True(t, row.Gated)

	// Exact recurrence.
	row = evaluateIndexCheck("0xT", idxB, 50, apy, 100, chain, true)
	require.Equal(t, verdictExact, row.Verdict)
	require.True(t, row.Gated)

	// Off-by-one is a MISMATCH (separate verdict class, still gated).
	row = evaluateIndexCheck("0xT", idxB, 50, apy, 101, chain, true)
	require.Equal(t, verdictIndexMismatch, row.Verdict)
	require.True(t, row.Gated)
}
