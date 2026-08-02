package main

// Wave-H9 fix: the PARTIAL-LIQUIDATION basket truncation (classification (c)
// harness defect — all 5 r9 gated backtest failures).
//
//   THE DEFECT  readBacktestFrameState built the per-token subcall set from
//   db.Seizures ∪ alsoPrice only, and readParentFrame passes no alsoPrice, so
//   the parent frame issued price/config subcalls ONLY for seized tokens. A
//   collateralOf@N-1 leg outside the seizure fan-out got no subcalls →
//   maxBorrowAtFrame found prices[tok]==nil → allPriced=false →
//   parent_basket_complete=false → class intra-block-recompute-unpriced,
//   gated. Every PARTIAL liquidation (fan-out < basket) with an unseized leg
//   was structurally ungateable; the 26 passers were all full-sweep shapes
//   (basket ⊆ seized). D-013 dual: a fail that should be a pass is wrong data
//   surfaced to the operator reading the receipt.
//
//   THE LAW THIS WAVE LANDS
//   1. The parent frame values the WHOLE collateral universe at N-1: after
//      the existing frame multicall decodes, every token in
//      seized ∪ legs(collateralOf@N-1) ∪ supported(getCollateralTokens@N-1)
//      that is not yet valued gets price+config+balanceOf subcalls in a
//      hash-pinned follow-up multicall at the SAME parent pin. Every token
//      requested is one the chain itself asserted (a decoded leg or the DM's
//      own N-1 enumeration), so a failed subcall is a REAL refusal — the
//      wave-8 per-subcall law applies unsoftened: the fix widens WHAT IS
//      REQUESTED, never softens what an unanswered read means.
//   2. The exec frame values the SAME complete basket at exec prices:
//      execWant (the parent legs) already reaches readExecFrame; config
//      coverage follows through parent.st.configs, which now spans the
//      universe.
//   3. THE DECIMALS-GAP CLOSURE: a frame token absent from the pin-time
//      decimals map (a token delisted before the run pin) reads
//      ERC20.decimals at the PARENT's own hash before valuation — same
//      decode law, same refusal posture — and the historical decimals merge
//      into the case's decimals view for the exec frame and the composition.
//   4. No new special cases: a complete basket adjudicates on the REAL
//      three-state law, and a complete-basket case that genuinely mismatches
//      FAILS loudly (the negative control below).
//
// ---------------------------------------------------------------------------
// MUTATION SPEC — committed BEFORE the implementation (transcript:
// testdata/mutation-transcripts/wave-h9.md; sha256-verified restores).
// Behavioural mutants only; a mutant that fails to compile is re-cut.
//
//   M1  revert to the seizure-only token set: readBacktestFrameState drops
//       the frame-universe widening (legs ∪ supported never join the
//       valuation set; the follow-up valuation multicall is never issued).
//       KILLED BY: TestWaveH9PartialLiquidationValuesTheWholeBasket — the
//       unseized leg B is never priced/configured at N-1, the direct frame
//       assertions (prices[tokB], configs[tokB]) fail, and the composed case
//       degrades to intra-block-recompute-unpriced instead of the exact
//       adjudication. Secondarily TestWaveH9CompleteBasketMismatchFailsLoudly
//       (the mismatch class collapses to the unpriced refusal).
//   M2  universe-priced but the EXEC-side recomputation silently reuses the
//       OLD config subset (obligation2Eligibility's exec-frame
//       maxBorrowAtFrame consults configs filtered to the seized tokens
//       instead of the parent frame's complete config map).
//       KILLED BY: the exec-side completeness assertion in
//       TestWaveH9PartialLiquidationValuesTheWholeBasket —
//       every_leg_priced_both_frames must read "true"; under the mutant leg
//       B's config is absent at the exec recomputation, so execPriced=false
//       and the evidence key reads "false". DISTINCT from M1's kill: the
//       parent frame is complete under M2, so the direct frame assertions
//       and parent_basket_complete all pass.
// ---------------------------------------------------------------------------
//
// FIXTURE-BACKED-OVER-TRANSCRIBED (Task 6 round-3 law): the fixture chain
// speaks the SAME tryBlockAndAggregate envelope pinnedReader speaks, and every
// subcall response is packed by the SAME production ABI objects the decode
// layer unpacks with. The regression drives readParentFrame /
// readExecFrame / obligation2Eligibility — the exact production path — never
// hand-assembled frames.

import (
	"bytes"
	"go/ast"
	"go/parser"
	"go/token"
	"math/big"
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

// waveH9Pins: the parent frame reads at block 100 (parentHash), the exec
// frame at block 101 (pinHash) — distinct hashes so every assertion about
// WHERE a read landed is a hash assertion, not a block-number one.
var (
	waveH9ParentHash = hashFor(100)
	waveH9PinHash    = hashFor(101)
)

// waveH9Read records one dispatched subcall: which method, on which target,
// at which pin. The decimals-gap test asserts hash-pinning from these.
type waveH9Read struct {
	method string
	target common.Address
	hash   common.Hash
}

// waveH9Server is the fixture DebtManager surface: a two-token account
// (tokA 6-dec, tokB 8-dec), served through the production Multicall3
// encoding at both case pins.
type waveH9Server struct {
	t         *testing.T
	legs      []collateralLeg
	supported []common.Address
	// prices is the engine-exact USD-6 price per WHOLE token, per pin hash —
	// identical at both pins in these fixtures (no intra-block move).
	prices map[common.Hash]map[common.Address]*big.Int
	// configsFor is the collateralTokenConfig answer per token (both pins).
	configsFor map[common.Address]cfgTuple
	// chainDecimals is ERC20.decimals ON-CHAIN truth (served at any pin —
	// decimals are immutable); the PIN-TIME map handed to the reader is the
	// per-test choice that exercises the gap.
	chainDecimals map[common.Address]uint8
	balances      map[common.Address]*big.Int
	borrowing     *big.Int
	reads         []waveH9Read
}

// serve answers one subcall by target+selector, packing through the
// production ABI objects.
func (s *waveH9Server) serve(target common.Address, callData []byte, hash common.Hash) multicallResult {
	s.t.Helper()
	sel := callData[:4]
	rec := func(method string) {
		s.reads = append(s.reads, waveH9Read{method: method, target: target, hash: hash})
	}
	switch {
	case bytes.Equal(sel, dmCollateralOfABI.Methods["collateralOf"].ID):
		rec("collateralOf")
		list := make([]tokenDataTuple, 0, len(s.legs))
		total := new(big.Int)
		for _, l := range s.legs {
			list = append(list, tokenDataTuple{Token: l.token, Amount: new(big.Int).Set(l.amount)})
			total.Add(total, l.amount)
		}
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, dmCollateralOfABI, "collateralOf", list, total)}
	case bytes.Equal(sel, dmGetCollateralTokensABI.Methods["getCollateralTokens"].ID):
		rec("getCollateralTokens")
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, dmGetCollateralTokensABI, "getCollateralTokens", s.supported)}
	case bytes.Equal(sel, dmGetDebtManagerAdminABI.Methods["getDebtManagerAdmin"].ID):
		rec("getDebtManagerAdmin")
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, dmGetDebtManagerAdminABI, "getDebtManagerAdmin", auditedDMAdminImpl)}
	case bytes.Equal(sel, dmBorrowingOfOneABI.Methods["borrowingOf"].ID):
		rec("borrowingOf")
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, dmBorrowingOfOneABI, "borrowingOf", new(big.Int).Set(s.borrowing))}
	case bytes.Equal(sel, dmConvertCollateralToUsdABI.Methods["convertCollateralTokenToUsd"].ID):
		rec("convertCollateralTokenToUsd")
		tok := common.BytesToAddress(callData[4:36])
		p, ok := s.prices[hash][tok]
		if !ok {
			// The engine's own posture for a token it does not price at this
			// pin: the view REVERTS — Success=false, never a zero.
			return multicallResult{Success: false}
		}
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, dmConvertCollateralToUsdABI, "convertCollateralTokenToUsd", new(big.Int).Set(p))}
	case bytes.Equal(sel, dmCollateralTokenConfigABI.Methods["collateralTokenConfig"].ID):
		rec("collateralTokenConfig")
		tok := common.BytesToAddress(callData[4:36])
		cfg, ok := s.configsFor[tok]
		if !ok {
			return multicallResult{Success: false}
		}
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, dmCollateralTokenConfigABI, "collateralTokenConfig", cfg)}
	case bytes.Equal(sel, erc20BalanceOfABI.Methods["balanceOf"].ID):
		rec("balanceOf")
		b, ok := s.balances[target]
		if !ok {
			return multicallResult{Success: false}
		}
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, erc20BalanceOfABI, "balanceOf", new(big.Int).Set(b))}
	case bytes.Equal(sel, erc20DecimalsABI.Methods["decimals"].ID):
		rec("decimals")
		d, ok := s.chainDecimals[target]
		if !ok {
			return multicallResult{Success: false}
		}
		return multicallResult{Success: true, ReturnData: packFrameReturn(s.t, erc20DecimalsABI, "decimals", d)}
	}
	s.t.Fatalf("wave-h9 fixture served an UNEXPECTED subcall: target %s selector %x", target.Hex(), sel)
	return multicallResult{}
}

// chain wires the server behind the production pinnedReader: the handler
// decodes the REAL tryBlockAndAggregate envelope and answers in-band with the
// pin the hash identifies, so the chunk block assertion runs for real.
func (s *waveH9Server) chain() *fakeChain {
	blocks := map[common.Hash]uint64{waveH9ParentHash: 100, waveH9PinHash: 101}
	f := &fakeChain{hashes: map[uint64]common.Hash{100: waveH9ParentHash, 101: waveH9PinHash}}
	f.handler = func(to common.Address, data []byte, hash common.Hash) ([]byte, error) {
		require.Equal(s.t, multicall3Address, to, "every frame read travels through Multicall3")
		block, ok := blocks[hash]
		require.True(s.t, ok, "frame read at an unknown pin hash %s", hash.Hex())
		vals, err := multicall3ABI.Methods["tryBlockAndAggregate"].Inputs.Unpack(data[4:])
		require.NoError(s.t, err, "the fixture decodes the production request envelope")
		raw := reflect.ValueOf(vals[1])
		results := make([]multicallResult, 0, raw.Len())
		for i := 0; i < raw.Len(); i++ {
			el := raw.Index(i)
			results = append(results, s.serve(
				el.Field(0).Interface().(common.Address),
				el.Field(1).Interface().([]byte),
				hash))
		}
		ret, err := multicall3ABI.Methods["tryBlockAndAggregate"].Outputs.Pack(
			new(big.Int).SetUint64(block), [32]byte(hash), results)
		require.NoError(s.t, err)
		return ret, nil
	}
	return f
}

// waveH9Book builds the standard two-token book: legA of tokA (6-dec) and
// legB of tokB (8-dec), both priced $1.00 per whole token at BOTH pins,
// both at LT 100% — so maxBorrowLT is exactly legA$ + legB$.
func waveH9Book(t *testing.T, legA, legB *big.Int) *waveH9Server {
	prices := map[common.Address]*big.Int{tokA: big.NewInt(1_000_000), tokB: big.NewInt(1_000_000)}
	cfg := cfgTuple{Ltv: pctE18(50), LiquidationThreshold: pctE18(100), LiquidationBonus: new(big.Int).Set(wad)}
	return &waveH9Server{
		t:         t,
		legs:      []collateralLeg{{token: tokA, amount: legA}, {token: tokB, amount: legB}},
		supported: []common.Address{tokA, tokB},
		prices: map[common.Hash]map[common.Address]*big.Int{
			waveH9ParentHash: prices, waveH9PinHash: prices,
		},
		configsFor:    map[common.Address]cfgTuple{tokA: cfg, tokB: cfg},
		chainDecimals: map[common.Address]uint8{tokA: 6, tokB: 8},
		balances:      map[common.Address]*big.Int{tokA: new(big.Int).Set(legA), tokB: new(big.Int).Set(legB)},
		borrowing:     big.NewInt(0),
	}
}

// waveH9Row is the derived side of a PARTIAL liquidation: only tokA seized,
// while the account holds {tokA, tokB} at N-1.
func waveH9Row(normalized *big.Int) snapshotdb.T6BacktestRow {
	row := compositionRow(normalized, normalized, new(big.Int).Set(wad), nil)
	row.Seizures = []snapshotdb.T6Seizure{{Seq: 0, AssetHex: hexLower(tokA.Hex())}}
	return row
}

// waveH9Frames drives BOTH production frame reads over the fixture chain —
// the same call sequence runBacktestCase makes: parent at N-1, then the exec
// frame with execWant = the parent legs.
func waveH9Frames(t *testing.T, s *waveH9Server, row snapshotdb.T6BacktestRow,
	decimals map[common.Address]uint8) (parentFrame, execFrame, map[common.Address]uint8, *gateFrame) {
	t.Helper()
	c := &p3Ctx{opR: testReader(s.chain()), dmProxy: replayTestDM}
	f := newGateFrame(gateBacktest)
	ctx := t.Context()

	parent, err := readParentFrame(ctx, c, f, wave8Acct, replayTestUSDC, row, decimals, 100, waveH9ParentHash)
	require.NoError(t, err)
	require.Empty(t, parent.st.unread, "the parent frame must decode clean — the fixture serves every requested subcall")

	// The production execWant derivation (runBacktestCase): the exec frame
	// prices the PARENT's whole collateral basket.
	execWant := make([]common.Address, 0, len(parent.st.collateral))
	for _, leg := range parent.st.collateral {
		execWant = append(execWant, leg.token)
	}
	exec, err := readExecFrame(ctx, c, f, wave8Acct, replayTestUSDC, row, decimals, 101, waveH9PinHash, execWant...)
	require.NoError(t, err)
	require.Empty(t, exec.st.unread, "the exec frame must decode clean")
	return parent, exec, decimals, f
}

// driveObligation2H9 is driveObligation2 with the two-token decimals view —
// the same production composition call, nil continuity sweep (the refusal
// posture; the true-at-parent arm and the unexplained default need no proof).
func driveObligation2H9(t *testing.T, row snapshotdb.T6BacktestRow, parent parentFrame, exec execFrame,
	decs map[common.Address]uint8) obl2Outcome {
	t.Helper()
	f := newGateFrame(gateBacktest)
	v := newBacktestView(row, f)
	eventDebt := mulDivFloor(v.normalizedBefore(), v.indexAtBlock())
	return obligation2Eligibility("wave-h9-case", v, parent, exec,
		replayTestDM, wave8Acct, replayTestUSDC, eventDebt, decs, nil, f)
}

// --- the regression: a PARTIAL liquidation values the WHOLE basket ----------

// TestWaveH9PartialLiquidationValuesTheWholeBasket is the r9 defect's exact
// shape: the account holds {tokA, tokB}, only tokA is seized, and leg B is
// priced+configured on-chain at the case's own N-1. Pre-fix the parent frame
// never asked about tokB (parent_basket_complete=false, class
// intra-block-recompute-unpriced — the captured RED); post-fix the basket is
// complete and the case adjudicates on the real three-state law: debt $100 >
// maxBorrowLT $80 at the parent boundary → TRUE-AT-PARENT, exact, with the
// margin printed. Kills M1 (frame assertions + class) and M2 (the exec-side
// completeness assertion on every_leg_priced_both_frames).
func TestWaveH9PartialLiquidationValuesTheWholeBasket(t *testing.T) {
	decs := map[common.Address]uint8{tokA: 6, tokB: 8}
	// legA: 50 tokA = $50.00; legB: 30 tokB (8-dec) = $30.00; LT 100% ⇒
	// maxBorrowLT $80.00. Debt $100.00 ⇒ eligible at the parent boundary.
	s := waveH9Book(t, big.NewInt(50_000_000), big.NewInt(3_000_000_000))
	row := waveH9Row(big.NewInt(100_000_000))

	parent, exec, decs, _ := waveH9Frames(t, s, row, decs)

	// The frame-level law: the unseized leg is VALUED at N-1 — price, config,
	// decimals — exactly like the seized one.
	require.Len(t, parent.st.collateral, 2, "collateralOf decoded both legs")
	require.NotNil(t, parent.st.prices[tokB],
		"the unseized leg's engine-exact price must be READ at N-1 — the seizure fan-out must never truncate the valued basket (wave H9)")
	_, okCfg := parent.st.configs[tokB]
	require.True(t, okCfg, "the unseized leg's collateralTokenConfig must be read at N-1")
	require.NotNil(t, exec.st.prices[tokB], "the exec frame prices the SAME complete basket (execWant)")

	// The composed adjudication: the REAL three-state law over the complete
	// basket — no new special case.
	o2 := driveObligation2H9(t, row, parent, exec, decs)
	require.Equal(t, "true", o2.row.Evidence["parent_basket_complete"],
		"the whole basket is valued, so parent completeness holds")
	require.Equal(t, "true", o2.row.Evidence["every_leg_priced_both_frames"],
		"THE EXEC-SIDE COMPLETENESS ASSERTION (kills M2): every parent leg is priced at exec AND configured through the parent's complete config map")
	require.Equal(t, "true-at-parent", o2.eligState,
		"debt $100 > maxBorrowLT $80 over the COMPLETE basket — the gate's own exact arm, not a special case")
	require.Equal(t, verdictExact, o2.row.Verdict)
	require.NotEqual(t, "intra-block-recompute-unpriced", o2.row.Class,
		"the r9 defect class must be gone for a fully served partial liquidation")
	require.Equal(t, "20000000", o2.row.Evidence["margin_usd6"],
		"bit-exact margin: $100.000000 debt − $80.000000 maxBorrowLT")
}

// --- the negative control: a complete basket that mismatches FAILS ----------

// TestWaveH9CompleteBasketMismatchFailsLoudly flips the parent predicate with
// leg B's value: 150 tokB ⇒ maxBorrowLT $200 > debt $100 ⇒ our boolean says
// NOT eligible while the chain liquidated. With the basket COMPLETE (that is
// the point — pre-fix this case hid in intra-block-recompute-unpriced) the
// gate must surface the mismatch class: UNEXPLAINED, gated — never exact,
// never the unpriced refusal. D-013: a fail that should be a pass and a pass
// that should be a fail are both always-fix; this pins the fail side stays a
// REAL fail.
func TestWaveH9CompleteBasketMismatchFailsLoudly(t *testing.T) {
	decs := map[common.Address]uint8{tokA: 6, tokB: 8}
	// legB: 150 tokB = $150.00 ⇒ maxBorrowLT $200.00 ≥ debt $100.00.
	s := waveH9Book(t, big.NewInt(50_000_000), big.NewInt(15_000_000_000))
	row := waveH9Row(big.NewInt(100_000_000))

	parent, exec, decs, _ := waveH9Frames(t, s, row, decs)
	require.NotNil(t, parent.st.prices[tokB], "the complete basket is what makes this mismatch VISIBLE")

	o2 := driveObligation2H9(t, row, parent, exec, decs)
	require.Equal(t, "true", o2.row.Evidence["parent_basket_complete"],
		"the basket is complete — this is a genuine mismatch, not a valuation refusal")
	require.Equal(t, verdictUnexplained, o2.eligState,
		"a complete-basket case that genuinely mismatches resolves UNEXPLAINED — the gated third state, loudly")
	require.Equal(t, verdictUnexplained, o2.row.Verdict)
	require.Equal(t, verdictUnexplained, o2.row.Class)
	require.NotEqual(t, verdictExact, o2.row.Verdict, "never a pass from a mismatching basket")
	require.NotEqual(t, "intra-block-recompute-unpriced", o2.row.Class,
		"the mismatch must not hide behind the unpriced refusal — that was the r9 shape")
	require.True(t, o2.row.Gated, "the mismatch is a gated failure on the receipt")
}

// --- the decimals gap: a frame token absent from the pin-time universe ------

// TestWaveH9DelistedTokenDecimalsReadAtParentPin closes the latent decimals
// gap: tokB is a leg at N-1 (and in the DM's own N-1 enumeration) but ABSENT
// from the pin-time decimals map — the delisted-before-the-run-pin shape.
// Pre-fix the token got NO subcalls at all (the silent `continue` in
// buildBacktestFrameCalls) and the case gated unpriced. Post-fix the frame
// reads ERC20.decimals(tokB) at the PARENT's own hash — hash-pinned,
// asserted below — then values the leg with them.
func TestWaveH9DelistedTokenDecimalsReadAtParentPin(t *testing.T) {
	pinDecs := map[common.Address]uint8{tokA: 6} // tokB missing: delisted before the run pin
	s := waveH9Book(t, big.NewInt(50_000_000), big.NewInt(3_000_000_000))
	row := waveH9Row(big.NewInt(100_000_000))

	c := &p3Ctx{opR: testReader(s.chain()), dmProxy: replayTestDM}
	f := newGateFrame(gateBacktest)
	parent, err := readParentFrame(t.Context(), c, f, wave8Acct, replayTestUSDC, row, pinDecs, 100, waveH9ParentHash)
	require.NoError(t, err)
	require.Empty(t, parent.st.unread, "a pin-time-absent token is READ historically, never a refusal when the chain serves it")

	// The decimals read happened, for tokB only, AT THE PARENT PIN.
	var decReads []waveH9Read
	for _, r := range s.reads {
		if r.method == "decimals" {
			decReads = append(decReads, r)
		}
	}
	require.Len(t, decReads, 1, "exactly the pin-time-absent token reads decimals historically")
	require.Equal(t, tokB, decReads[0].target)
	require.Equal(t, waveH9ParentHash, decReads[0].hash,
		"the historical decimals read is HASH-PINNED at the case's own parent pin — never latest, never by number")

	// And the leg is fully valued with them.
	require.NotNil(t, parent.st.prices[tokB], "priced at N-1 with the historically read decimals")
	_, okCfg := parent.st.configs[tokB]
	require.True(t, okCfg, "configured at N-1")
	require.Equal(t, map[common.Address]uint8{tokB: 8}, parent.st.histDecimals,
		"the frame carries exactly the historically read decimals")

	// The case-level merge (the same call runBacktestCase makes): the merged
	// view feeds the exec frame and the composition, so the historically
	// valued leg stays valued end to end and the case adjudicates on the
	// REAL three-state law.
	merged := mergeFrameDecimals(pinDecs, parent.st.histDecimals)
	require.Equal(t, uint8(6), merged[tokA])
	require.Equal(t, uint8(8), merged[tokB])
	require.NotContains(t, pinDecs, tokB, "the shared pin-time map is NEVER mutated — it is copied")

	execWant := make([]common.Address, 0, len(parent.st.collateral))
	for _, leg := range parent.st.collateral {
		execWant = append(execWant, leg.token)
	}
	exec, err := readExecFrame(t.Context(), c, f, wave8Acct, replayTestUSDC, row, merged, 101, waveH9PinHash, execWant...)
	require.NoError(t, err)
	require.Empty(t, exec.st.unread)
	require.NotNil(t, exec.st.prices[tokB], "the exec frame prices the delisted leg with the merged decimals")

	o2 := driveObligation2H9(t, row, parent, exec, merged)
	require.Equal(t, "true", o2.row.Evidence["parent_basket_complete"])
	require.Equal(t, "true", o2.row.Evidence["every_leg_priced_both_frames"])
	require.Equal(t, "true-at-parent", o2.eligState,
		"debt $100 > maxBorrowLT $80 over the complete basket, delisted leg included")
	require.Equal(t, verdictExact, o2.row.Verdict)
}

// TestWaveH9MergedDecimalsAreWiredIntoTheCase pins the composition seam the
// frame-level tests cannot see: runBacktestCase must consume the parent
// frame's historical decimals through mergeFrameDecimals before the exec
// read, the replay and the seizure reconstruction run — a merge helper that
// exists but is never called is the same gap as no helper (the
// admin_epoch_test.go detachment pattern).
func TestWaveH9MergedDecimalsAreWiredIntoTheCase(t *testing.T) {
	fset := token.NewFileSet()
	fileNode, err := parser.ParseFile(fset, "backtest.go", nil, 0)
	require.NoError(t, err)
	called := false
	for _, d := range fileNode.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "runBacktestCase" {
			continue
		}
		ast.Inspect(fn, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			if ident, ok := call.Fun.(*ast.Ident); ok && ident.Name == "mergeFrameDecimals" {
				called = true
			}
			return true
		})
	}
	require.True(t, called,
		"mergeFrameDecimals must be CALLED from runBacktestCase — the merged decimals view is what carries a historically read leg into the exec frame and the composition")
}
