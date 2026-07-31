// Wave H regression tests: the accept-r4 proof-surface fixes, each pinned by
// the law it implements and by the designed mutant it must kill
// (testdata/mutation-transcripts/wave-h.md).
//
//  1. dm_boolean_weld — classifyDMMaxBorrow's THREE-STATE law (mutant m1: the
//     classifier collapsed to two states).
//  2. aave_hf census — the ONE-LAW flag-gated value-projected membership
//     (mutant m2: the census flag-fold dropped).
//  3. b3_heartbeat_scan — the proxy-binding read UNCONDITIONAL (mutant m3: the
//     read made conditional again).
//  4. tokenconfig_sweep — the stable snap set DERIVED from the scenario claims.
//  5. aave_hf never-seen — the committed-list source consumed where used.
//  6. realized_liquidation_backtest — the PRIOR-PASS-DRAINED third shape
//     (mutant m4: the shape widened to a wildcard).
package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// --- fix 1: the DM maxBorrow three-state verdict law -------------------------

// TestClassifyDMMaxBorrowThreeStateLaw pins the adjudicated classifier
// (chain-truth ruling 08:55): bit-exact at one clock; sample-gap DISCLOSED when
// only the pin differs and the own-clock weld holds; snapshot-custody-drift
// GATED when the own-clock weld itself fails; weld-unread when the
// discrimination read did not answer. The mutant this kills (m1) collapses the
// middle state — the dangerous direction being own-clock FAILURE reported as a
// disclosed sample gap.
func TestClassifyDMMaxBorrowThreeStateLaw(t *testing.T) {
	pin := big.NewInt(1000)
	ours := big.NewInt(1000)
	v, cls := classifyDMMaxBorrow(pin, ours, nil)
	require.Equal(t, verdictExact, v, "pin agreement is bit-exact at ONE clock; no discrimination read is owed")
	require.Empty(t, cls)

	ours = big.NewInt(900)
	own := &dmOwnClockResult{Block: 42, ChainMax: big.NewInt(900), OurMax: big.NewInt(900)}
	v, cls = classifyDMMaxBorrow(pin, ours, own)
	require.Equal(t, verdictSampleGap, v,
		"pin drift + own-clock bit-exact = SAMPLE GAP, a verdict class with its own read, never a tolerance")
	require.Equal(t, verdictSampleGap, cls)
	require.False(t, verdictIsFailure(v), "a disclosed sample gap must not reach the exit code")

	own = &dmOwnClockResult{Block: 42, ChainMax: big.NewInt(901), OurMax: big.NewInt(900)}
	v, cls = classifyDMMaxBorrow(pin, ours, own)
	require.Equal(t, verdictDrift, v,
		"an own-clock weld failure is REAL custody drift — the arm the dissection found empty, and the arm that flips the accept-r4 classification if it ever fills")
	require.Equal(t, "snapshot-custody-drift", cls)
	require.True(t, verdictIsFailure(v))

	v, _ = classifyDMMaxBorrow(pin, ours, nil)
	require.Equal(t, verdictWeldUnread, v, "no discrimination read is 'cannot verify', never a pass")
	v, _ = classifyDMMaxBorrow(pin, ours, &dmOwnClockResult{Err: "headerHash did not resolve"})
	require.Equal(t, verdictWeldUnread, v)
	require.True(t, verdictIsFailure(verdictWeldUnread))
}

// TestDMGateFrameDeclaresTheSweepClockTruth is the accept-r4 false-declaration
// regression: the swept collateral amounts are @S(account) — the sweep block —
// and the frame must say so, and must declare the own-clock discrimination
// reads it now performs.
func TestDMGateFrameDeclaresTheSweepClockTruth(t *testing.T) {
	f := dmGateFrame()
	names := map[string]string{}
	for _, s := range f.Sources {
		names[s.Name] = s.Kind
	}
	require.Equal(t, frameDerived, names[dmCollateralSnapshotSource],
		"the snapshot legs are declared at their OWN clock S(account)")
	require.Contains(t, dmCollateralSnapshotSource, "@S(account)")
	require.NotContains(t, dmCollateralSnapshotSource, "@P_op",
		"declaring the sweep vector @P_op was accept-r4's FALSE declaration")
	require.Equal(t, framePinned, names[dmOwnClockMaxBorrowSource])
	require.Equal(t, framePinned, names[dmOwnClockPriceSource])
	require.Equal(t, framePinned, names[dmOwnClockHeaderSource])
}

// --- fix 2: the one-law zero-debt census -------------------------------------

// TestBuildDerivedFlagMapNeverEnabledDefaultsOff pins the absence law: a
// (reserve, user) pair with no custodied flag event is never-enabled, which is
// the chain fact OFF — both dissection exemplars classify from exactly this.
func TestBuildDerivedFlagMapNeverEnabledDefaultsOff(t *testing.T) {
	reserve := common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	user := common.HexToAddress("0x1199d06D5220Ee3b2911C811955C21A8BE2C716A")
	m := buildDerivedFlagMap([]store.CollateralFlagRow{
		{Reserve: reserve.Bytes(), User: user.Bytes(), Enabled: false, Block: 22551863},
	})
	key := hexLower(user.Hex())
	require.False(t, m[key][reserve], "an explicit disable folds OFF")
	require.False(t, m["never-seen-account"][reserve],
		"a pair with NO row reads OFF through the nil-map zero value — never-enabled is a chain fact, not a default")

	m2 := buildDerivedFlagMap([]store.CollateralFlagRow{
		{Reserve: reserve.Bytes(), User: user.Bytes(), Enabled: true, Block: 100},
	})
	require.True(t, m2[key][reserve])
}

// TestDerivedCensusIsFlagGatedAndValueProjected pins the one-law membership
// over a fixture: the flag fold gates the value projection exactly as the
// chain's totalCollateralBase does, and the dust edge (flag ON, value floors to
// zero in base units) resolves through the value-space law. The m2 mutant
// (derivedCensusReserves ignoring the fold) makes the disabled and
// never-enabled cases project a POSITIVE value, which this kills.
func TestDerivedCensusIsFlagGatedAndValueProjected(t *testing.T) {
	reserve := common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	ray := new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil)
	price := big.NewInt(250_000_000_000) // 2500 USD at 8 price decimals

	project := func(scaled *big.Int, flags map[common.Address]bool) *big.Int {
		in := risk.AaveInput{
			Account: common.HexToAddress("0x2c64a1D5D602E7Fb6d21dA6211DceCc6E17a0649"),
			Regime:  risk.RegimeAtBlock(25_650_676),
			Marks:   risk.Watermarks{BalancesBlock: 25_650_676, ParamsBlock: 25_650_676},
			Reserves: []risk.AaveReserve{{
				Asset: reserve, Decimals: 18,
				ScaledDebt: new(big.Int), ScaledCollateral: scaled,
				DebtIndex: ray, CollateralIndex: ray, IndexBlock: 25_650_676,
				UsedAsCollateral: true, // the pinned-bitmap posture the census must NOT inherit
			}},
			Prices: []risk.PriceInput{{
				ChainID: 1, Asset: reserve, Source: "test", Block: 25_650_676,
				Value: price, Decimals: 8, Provenance: risk.ProvenanceAdapterOutput, Fresh: true,
			}},
			Params: []risk.ParamRow{{
				Engine: risk.AaveParamEngine, ChainID: 1, Asset: reserve,
				LTV: big.NewInt(7000), LiqThreshold: big.NewInt(7500),
				LiqBonus: big.NewInt(10500), EffectiveBlock: 1,
			}},
		}
		in.Reserves = derivedCensusReserves(in.Reserves, flags)
		got, err := risk.ComputeAaveHealth(in)
		require.NoError(t, err)
		return got.TotalCollateralBase
	}

	balance := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil) // 1.0 of an 18-dec token

	require.Zero(t, project(balance, nil).Sign(),
		"NEVER-ENABLED (no fold row) => flag OFF => zero projected value => not a census member (dissection exemplar 1)")
	require.Zero(t, project(balance, map[common.Address]bool{reserve: false}).Sign(),
		"EXPLICITLY DISABLED (the custodied event at 22,551,863) => not a census member (dissection exemplar 2)")
	require.Positive(t, project(balance, map[common.Address]bool{reserve: true}).Sign(),
		"flag ON with real value => census member")
	require.Zero(t, project(big.NewInt(3), map[common.Address]bool{reserve: true}).Sign(),
		"flag ON but the value FLOORS TO ZERO in base units => the chain's value-space law says non-member (the dust edge)")
}

// --- fix 3: the unconditional proxy-binding read -----------------------------

// TestProxyBindingReadIsUnconditional kills m3 structurally: within
// runHeartbeatScan's per-stream loop, the readProxyAggregator call must be a
// DIRECT statement of the loop body — not nested under any if — so no gap or
// head condition can ever gate it again. The accept-r4 defect was precisely a
// conditional read that never fired on healthy feeds, issuing all four grades
// with no binding read at all (chain-truth ruling 08:55: DANGEROUS CONFIRMED).
func TestProxyBindingReadIsUnconditional(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "heartbeat_scan.go", nil, 0)
	require.NoError(t, err)

	src, err := os.ReadFile("heartbeat_scan.go")
	require.NoError(t, err)
	require.NotContains(t, string(src), "needPhaseCheck",
		"the conditional trigger must stay deleted — reintroducing it is the m3 mutant")

	var loop *ast.RangeStmt
	for _, d := range file.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "runHeartbeatScan" {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			if r, ok := n.(*ast.RangeStmt); ok && loop == nil {
				loop = r
				return false
			}
			return true
		})
	}
	require.NotNil(t, loop, "runHeartbeatScan must iterate the feed streams")

	callsReadProxy := func(n ast.Node) bool {
		found := false
		ast.Inspect(n, func(m ast.Node) bool {
			if c, ok := m.(*ast.CallExpr); ok {
				if id, ok := c.Fun.(*ast.Ident); ok && id.Name == "readProxyAggregator" {
					found = true
					return false
				}
			}
			return true
		})
		return found
	}
	direct := false
	for _, stmt := range loop.Body.List {
		// Only DIRECT statements count: a read wrapped in `if <anything>` is
		// conditional again and must fail this test.
		if _, isIf := stmt.(*ast.IfStmt); isIf {
			continue
		}
		if callsReadProxy(stmt) {
			direct = true
			break
		}
	}
	require.True(t, direct,
		"readProxyAggregator must be an UNCONDITIONAL direct statement of the per-stream loop body — one binding read per stream per run, before any verdict")
}

// --- fix 4: the stable snap set derived from the scenario claims -------------

// TestStableSnapSetIsDerivedFromScenarioClaims proves the hardcoded snap-set
// copy is gone by deriving the set the sweep now uses from the committed claim
// files and pinning its content in ADDRESS space — including the two chain
// facts a symbol-keyed or hardcoded set gets wrong: eUSD and EURC are
// isStableToken=FALSE on chain despite their names, and the twin liquidRESERVE
// addresses are distinct claims.
func TestStableSnapSetIsDerivedFromScenarioClaims(t *testing.T) {
	claims, err := loadScenarioBaseClaims(filepath.Join("..", "..", canonicalScenarioDir))
	require.NoError(t, err)

	stable := map[common.Address]bool{}
	for a, cl := range claims {
		if cl.Stable {
			stable[a] = true
		}
	}
	want := []common.Address{
		common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"), // USDC (OP)
		common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"), // USDT (OP)
		common.HexToAddress("0x80Eede496655FB9047dd39d9f418d5483ED600df"), // frxUSD (OP)
	}
	require.Len(t, stable, len(want), "the chain-derived snap set is exactly {USDC, USDT, frxUSD}")
	for _, a := range want {
		require.True(t, stable[a], "%s must be in the derived snap set", a.Hex())
	}

	// Stable-in-name-only assets carry claims but are NOT snap-set members.
	for _, a := range []common.Address{
		common.HexToAddress("0x939778D83b46B456224A33Fb59630B11DEC56663"), // eUSD
		common.HexToAddress("0xDCB612005417Dc906fF72c87DF732e5a90D49e11"), // EURC
	} {
		cl, ok := claims[a]
		require.True(t, ok, "%s must carry a committed claim (dm_composition_census)", a.Hex())
		require.False(t, cl.Stable, "%s is isStableToken=FALSE on chain despite its name", a.Hex())
	}

	// Twin-symbol assets: both liquidRESERVE addresses claimed BY ADDRESS.
	twinA := common.HexToAddress("0xE5d3854736e0D513aAE2D8D708Ad94d14Fd56A6a")
	twinB := common.HexToAddress("0xca5921DF65E2e1b0B98Ae91c0187BA80D4124898")
	_, okA := claims[twinA]
	_, okB := claims[twinB]
	require.True(t, okA && okB,
		"both liquidRESERVE addresses must carry their own claims — a symbol-keyed weld would collapse the twins")
}

// --- fix 6: the PRIOR-PASS-DRAINED third shape -------------------------------

// ob3Vector mirrors testdata/ob3-zero-credit-vector.json.
type ob3Vector struct {
	Account   string `json:"account"`
	DebtToken string `json:"debt_token"`
	PriorPass struct {
		LogIndex uint32 `json:"log_index"`
		Elements []struct {
			Token  string `json:"token"`
			Amount string `json:"amount"`
			Bonus  string `json:"bonus"`
		} `json:"elements"`
	} `json:"prior_pass"`
	CasePass struct {
		LogIndex   uint32 `json:"log_index"`
		Liquidated string `json:"liquidated_usd6"`
		Elements   []struct {
			Token  string `json:"token"`
			Amount string `json:"amount"`
			Bonus  string `json:"bonus"`
		} `json:"elements"`
	} `json:"case_pass"`
}

func loadOb3Vector(t *testing.T) ob3Vector {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "ob3-zero-credit-vector.json"))
	require.NoError(t, err)
	var v ob3Vector
	require.NoError(t, json.Unmarshal(raw, &v))
	return v
}

// ob3DrainedFixture builds the reconstructSeizures inputs from the committed
// vector: the case pass's all-zero elements, parent balances equal to what the
// prior pass seized (the partial branch takes the WHOLE balance), and the
// prior-seizure fold.
func ob3DrainedFixture(t *testing.T, v ob3Vector) (snapshotdb.T6BacktestRow, parentFrame, map[common.Address]uint8) {
	t.Helper()
	balances := map[common.Address]*big.Int{}
	prices := map[common.Address]*big.Int{}
	decs := map[common.Address]uint8{}
	priorSeized := map[string]*big.Int{}
	var tokens []common.Address
	for _, e := range v.PriorPass.Elements {
		tok := common.HexToAddress(e.Token)
		amt := mustBig(e.Amount)
		balances[tok] = amt // partial branch seized the whole balance
		priorSeized[hexLower(tok.Hex())] = amt
	}
	var seizures []snapshotdb.T6Seizure
	for i, e := range v.CasePass.Elements {
		tok := common.HexToAddress(e.Token)
		tokens = append(tokens, tok)
		prices[tok] = big.NewInt(1_000_000)
		decs[tok] = 6
		seizures = append(seizures, seizure(uint16(i+1), tok, e.Amount, e.Bonus))
	}
	prior := v.PriorPass.LogIndex
	row := snapshotdb.T6BacktestRow{
		Seizures:           seizures,
		LiquidatedUSD:      mustBig(v.CasePass.Liquidated),
		PriorPassLogIndex:  &prior,
		PriorSeizedByAsset: priorSeized,
		NormalizedAfter:    big.NewInt(0), IndexAtBlock: big.NewInt(1e18),
	}
	parent := testParentFrame(balances, prices, bonus2Pct, tokens...)
	return row, parent, decs
}

// TestPriorPassDrainedShapeFromTheCommittedVector runs the third-shape law over
// the committed 846bd1cb…:187 receipt facts, then kills the m4 wildcard in
// three directions: the shape must REJECT when the residual balance cannot be
// proven zero from prior-pass custody, when no prior pass exists, and when any
// element is nonzero.
func TestPriorPassDrainedShapeFromTheCommittedVector(t *testing.T) {
	v := loadOb3Vector(t)
	require.Equal(t, "0", v.CasePass.Liquidated, "the vector IS the zero-credit case")

	t.Run("the committed vector classifies PRIOR-PASS-DRAINED, ungated", func(t *testing.T) {
		row, parent, decs := ob3DrainedFixture(t, v)
		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("846bd1cb:187", newBacktestView(row, f), parent, decs, f)
		require.Zero(t, tallyP3(rows),
			"the receipt-confirmed drained shape must not gate: every zero element is proven legitimate from prior-pass custody")
		drainedRows := 0
		for _, r := range rows {
			if strings.Contains(r.Leg, "drained-book zero element") {
				drainedRows++
				require.Equal(t, verdictExact, r.Verdict)
			}
		}
		require.Equal(t, len(v.CasePass.Elements), drainedRows,
			"every element carries its own residual-zero proof row — the shape is per-element falsifiable, not a wildcard")
	})

	t.Run("MUTATION m4 kill: an unproven residual REJECTS the shape", func(t *testing.T) {
		row, parent, decs := ob3DrainedFixture(t, v)
		// Drop the WETH prior seizure: the parent balance 152142334693194 now has
		// NO custody proof of being drained, so the zero element over it is
		// exactly the illegitimate zero the widened wildcard would wave through.
		weth := hexLower(common.HexToAddress("0x4200000000000000000000000000000000000006").Hex())
		delete(row.PriorSeizedByAsset, weth)
		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("846bd1cb:187", newBacktestView(row, f), parent, decs, f)
		require.Positive(t, tallyP3(rows),
			"a zero element whose residual balance is NOT provably zero must gate — the third shape is a proof obligation, never a wildcard")
	})

	t.Run("MUTATION m4 kill: no prior pass REJECTS the shape", func(t *testing.T) {
		row, parent, decs := ob3DrainedFixture(t, v)
		row.PriorPassLogIndex = nil
		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("846bd1cb:187", newBacktestView(row, f), parent, decs, f)
		require.Positive(t, tallyP3(rows),
			"without an earlier same-tx pass a drained book cannot be proven, so the shape must reject")
	})

	t.Run("MUTATION m4 kill: a nonzero element REJECTS the shape", func(t *testing.T) {
		row, parent, decs := ob3DrainedFixture(t, v)
		row.Seizures[7] = seizure(8, common.HexToAddress("0x4200000000000000000000000000000000000006"), "5", "0")
		f := newGateFrame(gateBacktest)
		rows := reconstructSeizures("846bd1cb:187", newBacktestView(row, f), parent, decs, f)
		require.Positive(t, tallyP3(rows),
			"a nonzero element cannot come from a zero-credit walk; no shape reproduces it and the case gates")
	})
}
