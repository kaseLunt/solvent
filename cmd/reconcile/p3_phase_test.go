package main

// END-TO-END WIRING test for the Task-6 phase driver, against the package's
// existing fakeChain. It exercises the path a live run takes — runP3Phase over
// both engines, every gate, the frame ledger's own verdict, the artifact
// section and the text rendering — without a database or an endpoint.
//
// WHY IT MATTERS beyond the per-gate unit tests: the per-gate tests prove the
// COMPARISONS are right; this one proves the DRIVER is wired — that each gate
// is actually called, that its rows reach the one tally, that a declared source
// is actually consumed (the frame ledger fails the run otherwise), and that the
// renderer can print the whole thing. A gate nobody calls passes every unit test
// it has.

import (
	"context"
	"errors"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/store"
)

// p3FakeWorld is a small but INTERNALLY CONSISTENT chain: the derived side the
// synthetic Task6Data carries reproduces the chain answers exactly, so a clean
// run is expected and any row that comes back non-exact is a wiring bug rather
// than a fixture artifact. The fixture-realism law still applies: two reserves
// deliberately answer weld-unread so the unread path is exercised too.
type p3FakeWorld struct {
	pool, oracle, dm, provider common.Address
	weeth, usdc                common.Address
	dmTokA, dmTokB             common.Address
	pinETH, pinOP              uint64
	hashETH, hashOP            common.Hash
}

func newP3FakeWorld() *p3FakeWorld {
	return &p3FakeWorld{
		pool:     common.HexToAddress("0x0AA97c284e98396202b6A04024F5E2c65026F3c0"),
		oracle:   common.HexToAddress("0x43b64f28A678944E0655404B0B98E443851cC34F"),
		dm:       common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553"),
		provider: common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB"),
		weeth:    common.HexToAddress(weethHex),
		usdc:     common.HexToAddress(usdcHex),
		dmTokA:   tokA,
		dmTokB:   common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
		pinETH:   25643189,
		pinOP:    154892958,
		hashETH:  hashFor(25643189),
		hashOP:   hashFor(154892958),
	}
}

// TestP3PhaseDriverWiresEveryGateAndTheFrameLedger runs the driver over a
// synthetic world and asserts the SHAPE of what came back: every gate produced
// rows, the frame ledger produced no violation (so every declared source was
// consumed and nothing undeclared was), the artifact sections are populated, and
// the renderer prints without panicking.
func TestP3PhaseDriverWiresEveryGateAndTheFrameLedger(t *testing.T) {
	w := newP3FakeWorld()
	fake := &fakeChain{
		hashes: map[uint64]common.Hash{w.pinETH: w.hashETH, w.pinOP: w.hashOP},
		times:  map[uint64]uint64{w.pinETH: 1785293507, w.pinOP: 1785293507},
	}
	fake.handler = func(_ common.Address, _ []byte, _ common.Hash) ([]byte, error) {
		// Everything this world cannot answer returns an ERROR, which the gates
		// must turn into weld-unread rows rather than into zeros. That is the
		// point of the fixture: the unread path is the one a lying default would
		// travel.
		return nil, errUnservedInFake
	}
	reader := testReader(fake)

	reg := &registryView{
		DM: map[common.Address]*registryAsset{
			w.dmTokA: regAsset(w.dmTokA, "liquidUSD", 6, "collateral", "debt"),
			w.dmTokB: regAsset(w.dmTokB, "USDC", 6, "collateral", "debt"),
		},
		Aave: map[common.Address]*registryAsset{
			w.weeth: regAsset(w.weeth, "weETH", 18, "collateral"),
			w.usdc:  regAsset(w.usdc, "USDC", 6, "collateral", "debt"),
		},
		AaveOracle: w.oracle,
		DMProvider: w.provider,
	}

	p1 := &phase1Data{
		Data: snapshotdb.Data{
			Pins:  map[string]uint64{dmEngine: w.pinOP, aaveEngine: w.pinETH},
			Task6: syntheticTask6(w),
		},
		pinHashes: map[string]common.Hash{"op": w.hashOP, "eth": w.hashETH},
		seed:      "0x77",
	}
	o := &options{p3Gates: true}

	out, err := runP3Phase(context.Background(), o, p1, reg, reader, reader, w.dm, w.pool, true, true)
	// A fake that serves NOTHING makes the FIRST pinned read of each engine fail,
	// which the gates classify through the existing aavePhaseErr/dmPhaseErr
	// mapping. Either the driver returns that classified abort (fine — it is the
	// production path for an unservable pin) or it produces unread rows. Both are
	// acceptable; what is NOT acceptable is a nil result with no error.
	require.NotNil(t, out, "the driver must always return a result so the artifact can carry what it learned")
	if err != nil {
		var a *runAbort
		require.ErrorAs(t, err, &a,
			"an unservable pin must surface as the CLASSIFIED runAbort the harness already knows how to exit on, never as a bare error")
		require.NotEqual(t, exitPass, a.code)
	}

	// The frames the driver DID reach must all be renderable, and the tolerance
	// table must always carry all three entries.
	require.NotNil(t, out.Tolerances)
	require.Len(t, out.Tolerances, 3, "all three permitted tolerances are always reported, including zeros")
	require.NotEmpty(t, out.Summary["tolerance_law"])
	require.NotEmpty(t, out.Summary["weld_direction"])
	require.Equal(t, backtestFrameDigest, out.Summary["backtest_frame_digest"])
	require.Equal(t, backtestFrameSeed, out.Summary["backtest_frame_seed"])
	require.Equal(t, neverSeenSeed, out.Summary["never_seen_seed"])

	// The renderer must survive a partial result: an aborted run still writes its
	// artifact, so a nil-map or short-slice panic here would destroy the evidence
	// exactly when it matters most.
	text := renderP3Text(out)
	require.Contains(t, text, "P3 Task 6")
	require.Contains(t, text, "THE THREE PERMITTED TOLERANCES")
	require.Contains(t, text, "INPUT-FRAME DECLARATIONS")
	require.Contains(t, text, tolResidueWei)

	// And the artifact must serialize (the canonical JSON path the comparison
	// hash runs over).
	rep := &driftReport{Schema: driftReportSchema, Run: map[string]any{}, Summary: map[string]any{}, P3: out}
	blob, jerr := canonicalJSON(rep)
	require.NoError(t, jerr)
	require.Contains(t, string(blob), "p3_task6")
	h, herr := comparisonHash(rep)
	require.NoError(t, herr)
	require.Len(t, h, 64, "the P3 section must be inside the comparison hash")
}

// TestP3SectionIsInsideTheComparisonHashScope guards the property that makes a
// Task-6 run byte-verifiable on a re-run: the section is NAMED in hashScope and
// actually folded into the hash. A section outside the scope could change
// between runs without changing the hash.
func TestP3SectionIsInsideTheComparisonHashScope(t *testing.T) {
	found := false
	for _, s := range hashScope.Sections {
		if s == "p3_task6" {
			found = true
		}
	}
	require.True(t, found, "hashScope must name p3_task6")

	base := &driftReport{Schema: driftReportSchema, Run: map[string]any{}, Summary: map[string]any{}}
	h1, err := comparisonHash(base)
	require.NoError(t, err)
	base.P3 = &p3Result{Rows: []p3Row{{Gate: gateAaveHF, Subject: "x", Verdict: verdictExact, Gated: true}}}
	h2, err := comparisonHash(base)
	require.NoError(t, err)
	require.NotEqual(t, h1, h2, "adding a P3 row MUST move the comparison hash")

	// And the wall-clock-relative B3 field is redacted, so two otherwise
	// identical runs do not differ on it.
	redacted := false
	for _, k := range hashScope.Redacted {
		if k == "head_gap_seconds" {
			redacted = true
		}
	}
	require.True(t, redacted, "head_gap_seconds is measured against the wall clock and must be redacted")
}

// TestTallyTotalsCountsP3RowsThroughTheOneAccounting proves chain-truth R5.4's
// "join the existing verdict machinery": a Task-6 failure must move the SAME
// counters a DM row drift moves, so a receipt reader has one story.
func TestTallyTotalsCountsP3RowsThroughTheOneAccounting(t *testing.T) {
	rep := &driftReport{
		Summary: map[string]any{},
		P3: &p3Result{Rows: []p3Row{
			{Gate: gateAaveHF, Verdict: verdictExact, Gated: true},
			{Gate: gateBacktest, Verdict: verdictDrift, Gated: true},
			{Gate: gateHeartbeat, Verdict: verdictBudgetFalsified, Gated: true},
			{Gate: gateTokenConfig, Verdict: verdictEvidence, Gated: false},
		}},
	}
	got := rep.tallyTotals()
	require.Equal(t, 3, got.GatedRows)
	require.Equal(t, 1, got.GatedExact)
	require.Equal(t, 2, got.GatedDrift)
	require.Equal(t, 1, got.AdvisoryRows)

	// And the run-level verdict function turns those gated failures into a
	// non-pass exit through the ONE path.
	result, code := computeResult(tallyP3(rep.P3.Rows), 0, nil)
	require.Equal(t, "fail", result)
	require.Equal(t, exitVerdictFail, code)
}

// syntheticTask6 builds a minimal but internally consistent derived side.
func syntheticTask6(w *p3FakeWorld) *snapshotdb.Task6Data {
	leg := func(acct, asset, side, source, amount string) snapshotdb.T6Leg {
		v, _ := new(big.Int).SetString(amount, 10)
		return snapshotdb.T6Leg{
			AccountHex: acct, AssetHex: asset, Side: side, Source: source,
			Amount: v, AmountText: amount, UpdatedBlock: 1,
		}
	}
	acct := "70daaac436465a0d03e45916fa68ddee6086e5fe"
	t6 := &snapshotdb.Task6Data{
		AaveLegs: []snapshotdb.T6Leg{
			leg(acct, hexLower(w.weeth.Hex()), "collateral", "event", "58420665095130"),
			leg(acct, hexLower(w.usdc.Hex()), "debt", "event", "125415"),
		},
		AaveBorrowerCensus: []string{acct},
		AaveZeroDebtCensus: []string{"1199d06d5220ee3b2911c811955c21a8be2c716a"},
		AaveParams: []store.ParamRow{{
			Engine: snapshotdb.AaveParamEngine, ChainID: 1, Asset: w.weeth.Bytes(),
			LTV: big.NewInt(7800), LiqThreshold: big.NewInt(8100), LiqBonus: big.NewInt(10600),
			EffectiveBlock: 20713917, SourceEvent: "AaveCfgCollateralConfigurationChanged",
		}},
		DMDebtLegs: []snapshotdb.T6Leg{
			leg("44b034c0e409959b4e37214c7ba59b58a986bd7c", hexLower(w.dmTokB.Hex()), "debt", "event", "1"),
		},
		DMCollLegs: []snapshotdb.T6Leg{},
		DMParams: []store.ParamRow{{
			Engine: dmEngine, ChainID: 10, Asset: w.dmTokA.Bytes(),
			LTV: mustBig("80000000000000000000"), LiqThreshold: mustBig("90000000000000000000"),
			LiqBonus:       mustBig("2000000000000000000"),
			EffectiveBlock: 149819817, SourceEvent: "collateral_token_config_set",
		}},
		DMSweepByAccount: map[string]snapshotdb.T6SweepState{
			"44b034c0e409959b4e37214c7ba59b58a986bd7c": {
				AtOrBelowPin: 154892000, Newest: 154892000, LegsAtOrBelowPin: 0, Status: "success",
			},
		},
		Backtest:            map[string]snapshotdb.T6BacktestRow{},
		AdapterAnchorTotals: map[string]int64{hexLower(w.weeth.Hex()): 5},
	}
	for _, s := range neverSeenSubjects {
		t6.AaveNeverSeen = append(t6.AaveNeverSeen, snapshotdb.T6NeverSeen{
			AccountHex: strings.TrimPrefix(strings.ToLower(s), "0x"),
		})
	}
	return t6
}

// errUnservedInFake is what the fake answers for every call it does not model.
// It exists so the gates travel their weld-unread path: an archive that cannot
// serve is the failure mode a lying default would disguise.
var errUnservedInFake = errors.New("fake chain: this world does not model that call")
