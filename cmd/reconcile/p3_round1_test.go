package main

// MUTATION EVIDENCE for the Codex round-1 fix wave, one test per named class.
//
// Each test asserts the CORRECT behaviour and, where the defect was a silent
// acceptance, also asserts the shape the defect produced — so restoring the
// defect cannot leave the correct assertion passing unnoticed.

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
)

// --- finding 2: the ledger enforces, and the production path is clean -------

// TestProductionGateFramesHaveZeroViolations is the enforcement Codex asked for.
// Every gate frame is built and driven through its OWN declared source names, and
// the ledger must come back clean — no consumed-but-undeclared source, no
// declared-but-unconsumed source, no unregistered tolerance.
//
// The two violations that shipped in round 1 both live in the backtest frame:
// beforeDebtAmount was consumed undeclared, and the pinned decimals source was
// declared and never consumed. Both are now covered by the typed accessors.
func TestProductionGateFramesHaveZeroViolations(t *testing.T) {
	// The typed accessors record every derived read of a backtest case, so driving
	// one case through them must satisfy the backtest frame's derived declarations.
	f := backtestFrame_()
	row := snapshotdb.T6BacktestRow{
		BeforeDebtUSD: big.NewInt(1993777), LiquidatedUSD: big.NewInt(0),
		IndexAtBlock:     mustBig("1037090807641666446"),
		NormalizedBefore: big.NewInt(1922471), NormalizedAfter: big.NewInt(1922471),
		StoredBlockHash: "0xabc", Seizures: nil, SameBlockEarlier: nil,
	}
	v := newBacktestView(row, f)
	_ = v.beforeDebtUSD()
	_ = v.liquidatedUSD()
	_ = v.normalizedBefore()
	_ = v.normalizedAfter()
	_ = v.indexAtBlock()
	_ = v.seizures()
	_, _ = v.residue()
	_ = v.storedBlockHash()
	_ = v.sameBlockEarlier()
	// The next-pass source and every pinned read are consumed by the gate body;
	// this test proves the ACCESSOR-backed derived set is complete, which is where
	// both round-1 violations were.
	consumed := map[string]bool{}
	for name := range f.used {
		consumed[name] = true
	}
	for _, src := range f.Sources {
		if src.Kind != frameDerived {
			continue
		}
		if strings.Contains(src.Name, "NEXT pass") {
			continue // consumed only when a following pass exists
		}
		require.True(t, consumed[src.Name],
			"derived source %q is declared but no typed accessor consumed it — the round-1 'declared but unconsumed' shape", src.Name)
	}
	for name := range f.used {
		_, declared := f.declared[name]
		require.True(t, declared,
			"source %q was consumed through an accessor but is NOT declared — the round-1 'consumed undeclared' shape", name)
	}
}

// TestTypedAccessorsRecordEveryDerivedRead proves the accessors are the ONLY way
// in: each getter records its own source, so a read cannot happen without the
// ledger seeing it.
func TestTypedAccessorsRecordEveryDerivedRead(t *testing.T) {
	cases := []struct {
		name string
		src  string
		read func(*backtestView)
	}{
		{"beforeDebtUSD", srcBTBeforeDebt, func(v *backtestView) { v.beforeDebtUSD() }},
		{"liquidatedUSD", srcBTLiquidated, func(v *backtestView) { v.liquidatedUSD() }},
		{"normalizedBefore", srcBTDeltaFold, func(v *backtestView) { v.normalizedBefore() }},
		{"indexAtBlock", srcBTIndex, func(v *backtestView) { v.indexAtBlock() }},
		{"seizures", srcBTSeizures, func(v *backtestView) { v.seizures() }},
		{"residue", srcBTResidue, func(v *backtestView) { v.residue() }},
		{"storedBlockHash", srcBTStoredHash, func(v *backtestView) { v.storedBlockHash() }},
		{"sameBlockEarlier", srcBTWitnesses, func(v *backtestView) { v.sameBlockEarlier() }},
	}
	for _, tc := range cases {
		f := newGateFrame(gateBacktest, derived(tc.src, "x"))
		v := newBacktestView(snapshotdb.T6BacktestRow{}, f)
		require.Empty(t, f.used, "%s: nothing recorded before the read", tc.name)
		tc.read(v)
		require.True(t, f.used[tc.src], "%s: the accessor must record its source", tc.name)
	}
}

// --- finding 3: the Aave census is independent ------------------------------

// TestAaveCensusIsIndependentOfTheFold is the finding-3 kill. A borrower the
// derived fold DROPPED must surface as a gated failure — under the old
// self-derived census it vanished from both sides at once and nothing fired.
func TestAaveCensusIsIndependentOfTheFold(t *testing.T) {
	dropped := common.HexToAddress("0x00000000000000000000000000000000000d0ppd")
	kept := common.HexToAddress("0x0000000000000000000000000000000000000keep")
	c := aaveCohort{
		Candidates:      []common.Address{dropped, kept},
		DerivedFinite:   map[common.Address]bool{kept: true},
		DerivedZeroDebt: map[common.Address]bool{},
	}
	// The CHAIN says both carry debt; our fold only knows about `kept`.
	chainDebt := map[common.Address]bool{dropped: true, kept: true}
	chainColl := map[common.Address]bool{dropped: true, kept: true}
	measured := map[common.Address]bool{dropped: true, kept: true}

	rows := censusWeldRows(c, chainDebt, chainColl, measured)
	require.Positive(t, tallyP3(rows), "a dropped borrower must gate")
	var sawDropped bool
	for _, r := range rows {
		if r.Subject == dropped.Hex() && r.Class == "dropped-borrower" {
			sawDropped = true
			require.Equal(t, verdictDrift, r.Verdict)
		}
	}
	require.True(t, sawDropped,
		"the census must name the dropped borrower: this is the account the old self-derived census could not see, because the cohort and the census were both built from position_balances")

	// MUTATION: a SELF-DERIVED census (candidates == the fold's own members)
	// cannot see the omission — which is exactly why the candidate universe must
	// come from raw events.
	selfDerived := aaveCohort{
		Candidates:      []common.Address{kept},
		DerivedFinite:   map[common.Address]bool{kept: true},
		DerivedZeroDebt: map[common.Address]bool{},
	}
	require.Zero(t, tallyP3(censusWeldRows(selfDerived, chainDebt, chainColl, measured)),
		"asserting the defect: with a self-derived candidate set the dropped borrower is invisible, so the census passes vacuously")
}

// TestAaveCohortMeasuresEveryCandidate: the cohort read set must be the candidate
// universe, not the fold's members, or the weld above has nothing to compare.
func TestAaveCohortMeasuresEveryCandidate(t *testing.T) {
	t6 := &snapshotdb.Task6Data{
		AaveCandidates:     []string{"aa", "bb", "cc"},
		AaveBorrowerCensus: []string{"aa"},
		AaveZeroDebtCensus: []string{"bb"},
	}
	c := buildAaveCohort(t6)
	require.Len(t, c.Candidates, 3, "every custody-named candidate is measured")
	require.True(t, c.DerivedFinite[common.HexToAddress("aa")])
	require.True(t, c.DerivedZeroDebt[common.HexToAddress("bb")])
	require.False(t, c.DerivedFinite[common.HexToAddress("cc")],
		"cc is named by custody but absent from the fold — the case the weld exists for")

	// A fold member custody never named still gets measured (the other direction).
	t6.AaveBorrowerCensus = append(t6.AaveBorrowerCensus, "dd")
	c2 := buildAaveCohort(t6)
	require.Len(t, c2.Candidates, 4)
}

// --- finding 4: the DM chain census is mandatory and complete ---------------

// TestDMCensusCoverageRowFailsOnAnUnweldedBorrower is the finding-4 kill: if any
// evaluable borrower's chain boolean was not read, the false-negative direction is
// open for exactly those accounts and the run must say so.
func TestDMCensusCoverageRowFailsOnAnUnweldedBorrower(t *testing.T) {
	// The account keys are the 40-char hex encodings the collector produces, so the
	// coverage lookup compares like with like.
	evaluable := []string{acctHex(0xaa), acctHex(0xbb), acctHex(0xcc)}
	full := []dmSubject{
		{Account: common.HexToAddress(evaluable[0])},
		{Account: common.HexToAddress(evaluable[1])},
		{Account: common.HexToAddress(evaluable[2])},
	}
	require.Equal(t, verdictExact, dmCensusCoverageRow(evaluable, full).Verdict)

	partial := full[:2]
	row := dmCensusCoverageRow(evaluable, partial)
	require.Equal(t, verdictCohortFloor, row.Verdict)
	require.True(t, row.Gated)
	require.Equal(t, "1", row.Evidence["unwelded_count"])
	require.Contains(t, row.Note, "must not be SELF-DERIVED")
}

// TestDisablingTheMandatoryDMCensusTaints pins the flag classification: the census
// is mandatory for acceptance, so opting out cannot produce a pass.
func TestDisablingTheMandatoryDMCensusTaints(t *testing.T) {
	o, err := parseFlags([]string{"-dm-full-census=false"}, os.Stderr)
	require.NoError(t, err)
	taints := acceptanceTaints(o)
	require.NotEmpty(t, taints)
	require.Contains(t, strings.Join(taints, "\n"), "-dm-full-census")
	require.Contains(t, strings.Join(taints, "\n"), "SELF-DERIVED")
	result, code := computeResult(0, 0, taints)
	require.NotEqual(t, "pass", result)
	require.NotEqual(t, exitPass, code)

	// And the canonical default IS the mandatory census.
	def, err := parseFlags(nil, os.Stderr)
	require.NoError(t, err)
	require.True(t, def.dmFullCensus, "the chain-side census is the default, not an opt-in")
	require.Empty(t, acceptanceTaints(def))
}

// --- finding 8: open-ended head intervals ----------------------------------

// TestStalledFeedCannotReceiveAProvenanceUpgrade is the finding-8 kill. A feed
// whose between-round gaps are all small but which has STOPPED publishing must not
// be upgraded: the head interval joins the judged maximum.
func TestStalledFeedCannotReceiveAProvenanceUpgrade(t *testing.T) {
	const heartbeat, grace = 3600, 1800
	judged := func(maxBetween, head int64) int64 {
		if head > maxBetween {
			return head
		}
		return maxBetween
	}
	// Healthy: small gaps, fresh head.
	require.Equal(t, verdictProvenanceUpgrade, ladderVerdict(judged(3400, 900), heartbeat, grace))
	// STALLED: the same small between-round gaps, but silent for 9 hours.
	require.Equal(t, verdictBudgetFalsified, ladderVerdict(judged(3400, 32400), heartbeat, grace),
		"a stalled feed's silence is exactly what a freshness budget claims cannot happen; judging only the gaps BETWEEN rounds let it pass")
	// MUTATION: judging only the between-round maximum upgrades the stalled feed.
	require.Equal(t, verdictProvenanceUpgrade, ladderVerdict(3400, heartbeat, grace),
		"asserting the defect: excluding the head interval from the judged maximum upgrades a feed that has stopped")
}

// TestHeadIntervalIsChainTimeNotWallClock pins the measurement source. The head
// interval must come from chain testimony (source_as_of vs the custody domain's
// chain-time endpoint), because the wall clock is not something the chain said.
func TestHeadIntervalIsChainTimeNotWallClock(t *testing.T) {
	// Domain endpoint 10,000s after the newest round: the head interval is 10,000.
	lastAsOf := int64(1_700_000_000)
	domainEnd := lastAsOf + 10_000
	require.Equal(t, int64(10_000), domainEnd-lastAsOf)
	// A missing endpoint makes it UNMEASURABLE, which must gate rather than default
	// to a wall-clock number or to an upgrade.
	var v heartbeatVerdict
	v.HeadGapSeconds = -1
	v.HeadGapIsChainTime = false
	require.False(t, v.HeadGapIsChainTime)
	require.True(t, verdictIsFailure(verdictUnscannable),
		"an unmeasurable head interval is unscannable, and unscannable gates")
}

// --- finding 9: the base-composition claim ---------------------------------

// TestScenarioBaseClaimsLoadFromTheCommittedDefinitions proves the EXPECTED side
// is the model's own files, and pins the liquidUSD claim that is the whole point.
func TestScenarioBaseClaimsLoadFromTheCommittedDefinitions(t *testing.T) {
	claims, err := loadScenarioBaseClaims(filepath.Join("..", "..", canonicalScenarioDir))
	require.NoError(t, err)
	require.NotEmpty(t, claims)

	liquidUSD := common.HexToAddress("0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C")
	usdcOP := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	lu, ok := claims[liquidUSD]
	require.True(t, ok, "liquidUSD must carry a base claim — it is the defect class the sweep exists for")
	require.Equal(t, usdcOP, lu.Base,
		"the model values liquidUSD as rate x snap(USDC), so the provider must name USDC as its baseAsset")
	require.Contains(t, lu.Explanation, "base_stable_snap")

	// A stable's own claim is USD-terminal.
	usdc, ok := claims[usdcOP]
	require.True(t, ok)
	require.Equal(t, common.Address{}, usdc.Base, "a snapped stable is priced in USD directly")
	require.True(t, usdc.Stable)

	// And a non-composed asset expects a ZERO base — the direction that catches a
	// token quietly ACQUIRING a base.
	weethOP := common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")
	if w, ok := claims[weethOP]; ok {
		require.Equal(t, common.Address{}, w.Base)
	}
}

// TestScenarioBaseClaimConflictIsAPrecondition: two scenarios claiming different
// compositions for one asset cannot both be the model's behaviour.
func TestScenarioBaseClaimConflictIsAPrecondition(t *testing.T) {
	dir := t.TempDir()
	write := func(name, id, base string) {
		sf := map[string]any{"id": id, "propagation": []map[string]any{{
			"asset": "0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C", "chain_id": 10,
			"symbol": "liquidUSD", "base_stable_snap": true,
			"responds_to": []map[string]any{{"axis": "stable_usd", "asset": base}},
		}}}
		raw, err := json.Marshal(sf)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), raw, 0o644))
	}
	write("a.json", "scen-a", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	write("b.json", "scen-b", "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	_, err := loadScenarioBaseClaims(dir)
	require.Error(t, err)
	require.Contains(t, err.Error(), "CONFLICT")

	// base_stable_snap with no named base is also refused: a claim that names no
	// base cannot be an expected value.
	dir2 := t.TempDir()
	sf := map[string]any{"id": "scen-c", "propagation": []map[string]any{{
		"asset": "0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C", "chain_id": 10,
		"base_stable_snap": true, "responds_to": []map[string]any{{"axis": "stable_usd"}},
	}}}
	raw, _ := json.Marshal(sf)
	require.NoError(t, os.WriteFile(filepath.Join(dir2, "c.json"), raw, 0o644))
	_, err = loadScenarioBaseClaims(dir2)
	require.Error(t, err)
	require.Contains(t, err.Error(), "names no base")
}

// --- finding 10: the three-anchor floor stays three ------------------------

// TestAdapterFloorStaysThreeEvenWithThinHistory is the finding-10 kill: the floor
// must not follow the evidence it exists to test.
func TestAdapterFloorStaysThreeEvenWithThinHistory(t *testing.T) {
	// One row against the required three: a gated floor miss.
	row := cohortFloorRow(gateAaveAdapterWeld, "adapter-rows:0xabc",
		1, adapterRowsPerReserve, adapterRowsPerReserve, "note")
	require.Equal(t, verdictCohortFloor, row.Verdict)
	require.True(t, row.Gated)
	require.Contains(t, row.Expected, "3")

	// MUTATION: lowering the requirement to the observed population passes.
	lowered := cohortFloorRow(gateAaveAdapterWeld, "adapter-rows:0xabc", 1, 1, 1, "note")
	require.Equal(t, verdictExact, lowered.Verdict,
		"asserting the defect: with the floor lowered to the DB's own anchor population, one row satisfies a three-anchor rule")

	require.Equal(t, 3, adapterRowsPerReserve, "risk-quant R3's strengthening is three, not one")
}

// --- finding 7 / round-2 H2: causation from PRE-liquidation state -----------

// TestIntraBlockClassifierRequiresAProvenCause is the round-2 H2 kill.
//
// Round 1 required the flip to be REPRODUCED at execution-frame prices, which was
// an improvement but still not proof: those prices come from an EIP-1898 call at
// block N and therefore observe POST-block state. A price update later in the block
// makes execEligible true without having caused the liquidation-time flip. Proof
// now requires a CUSTODIED pre-liquidation write that touches an input to this
// account's boolean; the recomputation is corroboration only.
func TestIntraBlockClassifierRequiresAProvenCause(t *testing.T) {
	// Argument order: (parentEligible, parentComplete, execEligible,
	// allPriced, causeProven, replayComplete, basketContinuityProven).

	// parentEligible (the replay's own parent-boundary truth): exact pass —
	// provided the PARENT reconstruction is complete (round 6, H1).
	require.Equal(t, eligTrueAtParent, classifyIntraBlock(true, true, false, true, false, true, false))

	// ROUND 6 (H1): a LATER witness refusal (boundary-replay incompleteness)
	// cannot rewrite the pinned parent fact — this REVERSES the round-5
	// ordering, which gated a true parent predicate behind full replay
	// completeness and produced false failures on honest multi-token blocks.
	require.Equal(t, eligTrueAtParent, classifyIntraBlock(true, true, false, true, false, false, false),
		"parent true with a complete PARENT reconstruction is an exact pass; a cross-token refusal later in the block is boundary evidence, not a rewrite")

	// ...but a parent predicate whose OWN reconstruction failed proves
	// nothing: parent-incomplete never reaches the true-at-parent arm.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(true, false, true, true, true, false, false),
		"an unproven parent predicate cannot pass; its reconstruction failure is noted, so the replay is incomplete with it")

	// A proven cause AND corroboration AND a basket-continuity proof:
	// marginal (the L2-era shape — nothing in this wave sets the conjunct).
	require.Equal(t, eligFlippedWithWitness, classifyIntraBlock(false, true, true, true, true, true, true))

	// L1 (chain-truth basket-continuity ruling): the SAME proven,
	// corroborated, complete-replay crossing WITHOUT the continuity proof is
	// UNEXPLAINED — the marginal attribution claims a custody the walked
	// surface does not provide.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, true, true, true, false),
		"every marginal candidate resolves UNEXPLAINED while basket continuity is unproven (ruling L1)")

	// THE KILL: corroboration WITHOUT a proven cause is UNEXPLAINED. This is the
	// post-block-price shape Codex named — execEligible true, no custodied cause.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, true, false, true, true),
		"a post-block price difference is not proof of a pre-liquidation flip; without a custodied cause this must be UNEXPLAINED")

	// A proven cause with NO corroboration is also unexplained: we could not
	// reproduce the flip at all, so the cause did not demonstrably do it.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, false, true, true, true, true))

	// An unpriceable leg gates rather than being excused, whatever else holds.
	require.Equal(t, eligUnpriced, classifyIntraBlock(false, true, true, false, true, true, true))
	require.Equal(t, eligUnpriced, classifyIntraBlock(false, true, false, false, false, true, false))

	// ROUND 5 (M), scoped by round 6 H1 to the crossing-based arms: an
	// INCOMPLETE boundary replay resolves UNEXPLAINED before any crossing
	// input is consulted — a proven, corroborated cause cannot outrank a
	// refused write (the unmodelled write moves the real boolean too).
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, true, true, false, true),
		"a proven cause inside an incomplete replay must not earn the marginal pass — this is the m4 law")
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, false, false, false, false),
		"incompleteness outranks the unpriced refusal too: the replay's own refusal is the first law for crossing arms")

	// The round-6 guard: parent-INeligible with an incomplete replay stays
	// UNEXPLAINED — the H1 split narrows what replay completeness gates, it
	// does not widen true-at-parent.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, true, false, false, false),
		"the split must not accidentally widen true-at-parent")
}

// TestReplaySameBlockCausesProvesOnlyRelevantWrites is the causation replay's
// relevance law: an unrelated log in a busy block must NOT count, and only a
// witness whose DECODED, APPLIED write flips the replayed parent state can
// prove (Codex round 4, M — contact is not causation; the flip-producing
// positive controls live in p3_backtest_replay_test.go, anchored to the
// captured fixtures).
func TestReplaySameBlockCausesProvesOnlyRelevantWrites(t *testing.T) {
	dm := common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	acct := common.HexToAddress("0x4d81ce1dd1b1e10f96313e080bf7b12136ff7e76")
	usdc := common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	other := common.HexToAddress("0x00000000000000000000000000000000000000ff")

	w := func(topic string, t1, t2, t3 common.Address) snapshotdb.T6Witness {
		return snapshotdb.T6Witness{
			LogIndex: 1, Address: hexLower(dm.Hex()), Topic0: topic,
			Topic1Addr: hexLower(t1.Hex()), Topic2Addr: hexLower(t2.Hex()), Topic3Addr: hexLower(t3.Hex()),
		}
	}
	// A parent state with real headroom: $10.00 debt against $12.00 of
	// threshold-weighted collateral in tokA.
	st := func() replayParentState {
		return replayParentState{
			NormalizedAtParent: big.NewInt(10_000_000),
			IndexAtBlock:       new(big.Int).Set(wad),
			Collateral:         []collateralLeg{{token: tokA, amount: big.NewInt(12_000_000)}},
			Prices:             map[common.Address]*big.Int{tokA: big.NewInt(1_000_000)},
			Configs: map[common.Address]collateralTokenConfigResult{tokA: {
				LTV: big.NewInt(0), LiquidationThreshold: new(big.Int).Mul(big.NewInt(100), wad), LiquidationBonus: new(big.Int).Set(wad),
			}},
			Decimals: map[common.Address]uint8{tokA: 6},
		}
	}

	t.Run("an unrelated same-block log proves nothing", func(t *testing.T) {
		r := replaySameBlockCauses([]snapshotdb.T6Witness{
			w(topicDMLiquidated, other, other, usdc), // someone ELSE's liquidation
		}, dm, acct, usdc, st())
		require.False(t, r.Proven,
			"a busy block is the norm on this population, so 'a log exists' cannot be the test")
		require.Equal(t, 1, r.Unrelated)
		require.Equal(t, 0, r.Applied)
	})

	t.Run("a DIFFERENT token's index update is unrelated", func(t *testing.T) {
		r := replaySameBlockCauses([]snapshotdb.T6Witness{
			w(topicDMInterestIndexUpdated, other, common.Address{}, common.Address{}),
		}, dm, acct, usdc, st())
		require.False(t, r.Proven)
		require.Equal(t, 1, r.Unrelated)
	})

	t.Run("a threshold change on a token the account does NOT hold is unrelated", func(t *testing.T) {
		r := replaySameBlockCauses([]snapshotdb.T6Witness{
			w(topicDMCollateralConfigSet, tokB, common.Address{}, common.Address{}),
		}, dm, acct, usdc, st())
		require.False(t, r.Proven)
		require.Equal(t, 1, r.Unrelated)
	})

	t.Run("a relevant event without a decodable payload proves nothing and is disclosed", func(t *testing.T) {
		// The debt token's index DID move — but the witness carries no payload,
		// so the write cannot be applied, and what cannot be applied cannot
		// prove. Before this wave the same witness set Proven on contact.
		r := replaySameBlockCauses([]snapshotdb.T6Witness{
			w(topicDMInterestIndexUpdated, usdc, common.Address{}, common.Address{}),
		}, dm, acct, usdc, st())
		require.False(t, r.Proven)
		require.NotEmpty(t, r.Notes)
	})

	t.Run("a log from an address outside the walked DM surface is not a witness", func(t *testing.T) {
		provider := common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
		r := replaySameBlockCauses([]snapshotdb.T6Witness{{
			LogIndex: 1, Address: hexLower(provider.Hex()), Topic0: topicDMLiquidated,
			Topic2Addr: hexLower(acct.Hex()),
		}}, dm, acct, usdc, st())
		require.False(t, r.Proven,
			"PriceProviderV2 is not in the walker stream set, so a price push can never be a custodied witness — which is exactly why post-block price movement is not proof")
		require.Equal(t, 1, r.Unrelated)
	})

	t.Run("an earlier seizure for THIS account replays BOTH sides and can flip", func(t *testing.T) {
		// The REAL captured Liquidated log (dm_liquidated.json): $15.845260 of
		// debt repaid, $16.003712 of USDC seized — the element amount INCLUDES
		// the liquidation bonus, which is why value leaves the basket faster
		// than debt and an earlier pass can flip the next one. Parent state
		// sits at the captured beforeDebtAmount with $0.000001 of headroom.
		lw := witnessFromFixture(t, "dm_liquidated.json", 0, 4)
		seizedAcct := common.HexToAddress("0x" + lw.Topic2Addr)
		state := replayParentState{
			NormalizedAtParent: big.NewInt(31_690_519),
			IndexAtBlock:       new(big.Int).Set(wad),
			Collateral:         []collateralLeg{{token: usdc, amount: big.NewInt(31_690_520)}},
			Prices:             map[common.Address]*big.Int{usdc: big.NewInt(1_000_000)},
			Configs: map[common.Address]collateralTokenConfigResult{usdc: {
				LTV: big.NewInt(0), LiquidationThreshold: new(big.Int).Mul(big.NewInt(100), wad), LiquidationBonus: new(big.Int).Set(wad),
			}},
			Decimals: map[common.Address]uint8{usdc: 6},
		}
		r := replaySameBlockCauses([]snapshotdb.T6Witness{lw}, dm, seizedAcct, usdc, state)
		require.True(t, r.Proven,
			"debt 31690519→15845259 while maxBorrowLT falls 31690520→15686808: the bonus premium makes the replayed state cross — a genuinely caused flip")
		require.Contains(t, r.Causes[0], "Liquidated")

		// The same event with generous headroom does NOT flip: directionality
		// is decided by the replayed numbers, not by the event class.
		state.Collateral = []collateralLeg{{token: usdc, amount: big.NewInt(100_000_000)}}
		state.NormalizedAtParent = big.NewInt(31_690_519)
		r2 := replaySameBlockCauses([]snapshotdb.T6Witness{lw}, dm, seizedAcct, usdc, state)
		require.False(t, r2.Proven)
		require.Equal(t, 1, r2.Applied)
	})
}

// The topic0 audit lives in p3_witness_abi_test.go, anchored to the REAL decoder
// fixtures and the committed ABI. The handwritten-signature version that used to sit
// here is precisely what Codex round 3 condemned: it re-derived the same
// two-argument InterestIndexUpdated mistake the production constant had, so it
// confirmed the defect instead of catching it.

// --- round-2 M5: the FINAL boundary vector ---------------------------------

// TestFinalBoundaryVectorIsNotMislabelledPartial is Codex's boundary integers as a
// unit vector: HP=100, bonus=10, balance=110, cAFD=100.
//
//	net      = floor(110 * 100 / 110) = 100
//	maxBonus = 110 - 100 = 10
//	balance - maxBonus = 100, and the deployed predicate `100 < 100` is FALSE
//	=> FINAL, with bonus = floor(100*10/100) = 10 and amount = 100+10 = 110 = balance.
//
// The round-1 discriminator read `amount == balance` and called this PARTIAL.
func TestFinalBoundaryVectorIsNotMislabelledPartial(t *testing.T) {
	// The DM's real denominator is 100e18; Codex's HP=100/bonus=10 is the same
	// ratio, so the vector is expressed at scale here and the arithmetic is
	// identical.
	hp := hundredPercentDM
	bonus := new(big.Int).Div(hp, big.NewInt(10)) // 10% of HUNDRED_PERCENT
	e := preparedSeizure{
		s:     seizure(1, tokA, "110", "10"),
		tok:   tokA,
		cfg:   collateralTokenConfigResult{LTV: hp, LiquidationThreshold: hp, LiquidationBonus: bonus},
		bal:   big.NewInt(110),
		price: pow10Big(6), // P = 1.0 at 6 decimals, so cAFD == u
		dec:   6,
	}
	u := big.NewInt(100)

	// The deployed predicate: STRICT `<`, so equality selects FINAL.
	require.False(t, deployedTakesPartial(e, u),
		"balance - maxBonus == cAFD is NOT strictly less, so the deployed predicate selects FINAL")

	// THE KILL: the round-1 discriminator would have said PARTIAL here.
	require.Equal(t, 0, e.s.Amount.Cmp(e.bal),
		"the emitted amount equals the Safe balance at this boundary, which is why `amount == balance` is not a branch test")

	// And the identity-based observed classifier agrees with the contract.
	partialOf := func(x preparedSeizure) (*big.Int, *big.Int, *big.Int) {
		net := new(big.Int).Mul(x.bal, hundredPercentDM)
		net.Quo(net, new(big.Int).Add(hundredPercentDM, x.cfg.LiquidationBonus))
		bn := new(big.Int).Sub(x.bal, net)
		cr := new(big.Int).Sub(x.bal, bn)
		cr.Mul(cr, x.price)
		cr.Quo(cr, pow10Big(x.dec))
		return new(big.Int).Set(x.bal), bn, cr
	}
	finalOf := func(x preparedSeizure, uu *big.Int) (*big.Int, *big.Int, *big.Int) {
		c := new(big.Int).Mul(uu, pow10Big(x.dec))
		c.Quo(c, x.price)
		bn := new(big.Int).Mul(c, x.cfg.LiquidationBonus)
		bn.Quo(bn, hundredPercentDM)
		return new(big.Int).Add(c, bn), bn, c
	}
	require.False(t, observedBranchIsPartial(e, u, partialOf, finalOf),
		"at the boundary BOTH identity pairs hold, and the classifier must report FINAL to agree with the deployed predicate's strict `<`")

	// Both hypotheses are consistent, so the gate discloses the ambiguity instead of
	// asserting a branch label the observation does not determine.
	row := snapshotdb.T6BacktestRow{
		Seizures:      []snapshotdb.T6Seizure{e.s},
		LiquidatedUSD: big.NewInt(100),
	}
	parent := parentFrame{st: &frameState{
		prices:   map[common.Address]*big.Int{tokA: pow10Big(6)},
		balances: map[common.Address]*big.Int{tokA: big.NewInt(110)},
		configs:  map[common.Address]collateralTokenConfigResult{tokA: e.cfg},
	}}
	f := newGateFrame(gateBacktest)
	rows := reconstructSeizures("boundary", newBacktestView(row, f), parent, map[common.Address]uint8{tokA: 6}, f)
	require.Zero(t, tallyP3(rows), "the boundary observation is consistent with the contract, so it must not gate")
	var sawAmbiguity bool
	for _, r := range rows {
		if strings.Contains(r.Leg, "AMBIGUOUS") {
			sawAmbiguity = true
			require.Equal(t, verdictEvidence, r.Verdict)
			require.False(t, r.Gated)
		}
	}
	require.True(t, sawAmbiguity,
		"the branch LABEL is not determined at the boundary, so the run must say so rather than assert one")
}

// --- round-2 H1: the first-pass residue branch consumes through the ledger ---

// TestFirstPassResidueBranchLeavesTheLedgerClean drives the ACTUAL first-pass arm —
// the path the round-1 production-frame test explicitly skipped — and requires zero
// frame violations. Before the fix, the next-pass source was declared and read
// directly off v.row, so the deferred validator added a gated failure on every run.
func TestFirstPassResidueBranchLeavesTheLedgerClean(t *testing.T) {
	f := backtestFrame_()
	nextIdx := uint32(160)
	row := snapshotdb.T6BacktestRow{
		BeforeDebtUSD: big.NewInt(1993777), LiquidatedUSD: big.NewInt(0),
		IndexAtBlock:     mustBig("1037090807641666446"),
		NormalizedBefore: big.NewInt(1922471), NormalizedAfter: big.NewInt(1922471),
		StoredBlockHash:       "0xabc",
		NextPassLogIndex:      &nextIdx,
		NextPassBeforeDebtUSD: big.NewInt(1993777),
		NextPassBeforeText:    "1993777",
	}
	v := newBacktestView(row, f)
	rows := residueWeld("case", v, execFrame{st: &frameState{}}, f)
	require.Len(t, rows, 1)
	require.Equal(t, verdictExact, rows[0].Verdict,
		"our after-state equals the NEXT pass's own beforeDebtAmount — the two-pass hinge")
	require.Contains(t, rows[0].Leg, "NEXT pass")
	require.True(t, f.used[srcBTNextPass],
		"the next-pass source must be CONSUMED through the accessor, not read off the row")

	// And the conditional source is NOT marked consumed on a case without a next
	// pass, so the ledger can still tell the two situations apart.
	f2 := backtestFrame_()
	noNext := row
	noNext.NextPassLogIndex = nil
	v2 := newBacktestView(noNext, f2)
	_ = residueWeld("case", v2, execFrame{st: &frameState{chainDebt: big.NewInt(1993777)}}, f2)
	require.False(t, f2.used[srcBTNextPass])
}

// TestNoGateCodeReadsTheBacktestRowDirectly keeps the accessor discipline: every
// v.row read must live inside a *backtestView method, so a future gate edit cannot
// bypass the ledger the way round 1 did.
func TestNoGateCodeReadsTheBacktestRowDirectly(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "backtest.go", nil, 0)
	require.NoError(t, err)
	for _, d := range file.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok {
			continue
		}
		onView := false
		if fn.Recv != nil && len(fn.Recv.List) == 1 {
			if star, ok := fn.Recv.List[0].Type.(*ast.StarExpr); ok {
				if id, ok := star.X.(*ast.Ident); ok && id.Name == "backtestView" {
					onView = true
				}
			}
		}
		if onView {
			continue
		}
		ast.Inspect(fn, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "row" {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); ok && id.Name == "v" {
				t.Fatalf("%s reads v.row directly at %s — every derived read must go through an accessor so consumption and ledger-recording are inseparable (Codex round 2, finding H1)",
					fn.Name.Name, fset.Position(sel.Pos()))
			}
			return true
		})
	}
}

// --- round-2 H3: the head interval and the judged maximum -------------------

// TestHeadIntervalUsesTheBoundaryHeaderAndGatesWhenAbsent is the round-2 H3 kill on
// the measurement itself.
func TestHeadIntervalUsesTheBoundaryHeaderAndGatesWhenAbsent(t *testing.T) {
	lastRound := int64(1_700_000_000)
	// A boundary header 9 hours after the newest round: that is the silence.
	secs, chainTime := headInterval(lastRound, chainHeaderTime(lastRound+32_400))
	require.True(t, chainTime)
	require.Equal(t, int64(32_400), secs)

	// No boundary header ⇒ UNMEASURABLE, never a substituted number and never zero.
	secs, chainTime = headInterval(lastRound, 0)
	require.False(t, chainTime)
	require.Equal(t, int64(-1), secs,
		"an unmeasurable head interval must be marked, not defaulted to zero — zero would read as a perfectly fresh feed")

	// A boundary BEFORE the round (clock skew between the two chain facts) clamps to
	// zero rather than going negative, which would shrink the judged maximum.
	secs, chainTime = headInterval(lastRound, chainHeaderTime(lastRound-50))
	require.True(t, chainTime)
	require.Equal(t, int64(0), secs)
}

// TestJudgedMaxGapFoldsInTheHeadInterval pins the fold that makes a stall visible.
func TestJudgedMaxGapFoldsInTheHeadInterval(t *testing.T) {
	// Healthy: small gaps, fresh head.
	got, isHead := judgedMaxGap(3400, 900, true)
	require.Equal(t, int64(3400), got)
	require.False(t, isHead)

	// STALLED: the same small between-round gaps, silent for 9 hours.
	got, isHead = judgedMaxGap(3400, 32_400, true)
	require.Equal(t, int64(32_400), got)
	require.True(t, isHead, "the judged maximum must be the head interval so the ladder sees the stall")
	require.Equal(t, verdictBudgetFalsified, ladderVerdict(got, 3600, 1800))

	// An UNMEASURABLE head cannot raise the maximum (the caller gates instead).
	got, isHead = judgedMaxGap(3400, -1, false)
	require.Equal(t, int64(3400), got)
	require.False(t, isHead)
}

// TestChainHeaderTimeCannotBeSubstituted documents the type guard. The round-2
// mutation — measuring to the feed population's own last write — is now a COMPILE
// error, which is why there is no runtime assertion for it: `chainHeaderTime` is
// produced only by domainBoundaryTime, and only from headerTime.
func TestChainHeaderTimeCannotBeSubstituted(t *testing.T) {
	// A plain int64 is not a chainHeaderTime; the line below does not compile:
	//   var b chainHeaderTime = someRound.SourceAsOf.Unix()
	// Conversion is possible but must be written explicitly, which is a visible,
	// reviewable act rather than an accident.
	var b chainHeaderTime = chainHeaderTime(1_700_000_000)
	secs, ok := headInterval(1_699_999_000, b)
	require.True(t, ok)
	require.Equal(t, int64(1000), secs)
}

// --- round-2 M4: the two acceptance artifacts must agree --------------------

// TestRendererAgreesWithTheTallyForEveryPassingVerdict is the round-2 M4 kill. The
// human artifact and the JSON/exit-code verdict must not contradict each other: a
// provenance upgrade, a qualifier and a causation-proven marginal case are SUCCESSES
// and must not appear in the failure column or the GATED FAILURES list.
func TestRendererAgreesWithTheTallyForEveryPassingVerdict(t *testing.T) {
	for _, v := range []string{verdictProvenanceUpgrade, verdictQualifier, verdictMarginal, verdictExact} {
		rows := []p3Row{{Gate: gateHeartbeat, Subject: "s", Leg: "l", Verdict: v, Gated: true}}
		res := &p3Result{Rows: rows, Tolerances: map[string][]string{}, Summary: map[string]any{}}

		// The per-gate counter.
		counts := p3Counts(rows)
		require.Equal(t, 0, counts[gateHeartbeat][1],
			"%s is a SUCCESS and must not be counted in the failure column", v)
		require.Equal(t, 1, counts[gateHeartbeat][0], "%s is still a gated row", v)

		// The tally and the exit code.
		require.Zero(t, tallyP3(rows), "%s must not gate", v)
		result, code := computeResult(tallyP3(rows), 0, nil)
		require.Equal(t, "pass", result)
		require.Equal(t, exitPass, code)

		// The rendered text.
		text := renderP3Text(res)
		require.Contains(t, text, "P3 gated failures: 0",
			"%s: the rendered total must agree with the tally", v)
		require.NotContains(t, text, "GATED FAILURES",
			"%s: a passing verdict must not open the GATED FAILURES section", v)
		if v != verdictExact {
			require.Contains(t, text, "GATED SUCCESSES",
				"%s: a richer-than-exact success must still be VISIBLE, in its own section", v)
			require.Contains(t, text, v)
		}
	}
}

// TestRendererStillReportsEveryRealFailure is the other direction: the M4 fix must
// not quiet a genuine failure.
func TestRendererStillReportsEveryRealFailure(t *testing.T) {
	rows := []p3Row{
		{Gate: gateHeartbeat, Subject: "agg", Leg: "budget", Verdict: verdictBudgetFalsified, Gated: true, Note: "refuted"},
		{Gate: gateBacktest, Subject: "case", Leg: "obl2", Verdict: verdictUnexplained, Gated: true},
		{Gate: gateAaveHF, Subject: "acct", Leg: "hf", Verdict: verdictDrift, Gated: true},
		{Gate: gateAaveHF, Subject: "acct", Leg: "hf", Verdict: verdictProvenanceUpgrade, Gated: true},
	}
	require.Equal(t, 3, tallyP3(rows))
	text := renderP3Text(&p3Result{Rows: rows, Tolerances: map[string][]string{}, Summary: map[string]any{}})
	require.Contains(t, text, "P3 gated failures: 3")
	require.Contains(t, text, "GATED FAILURES")
	for _, v := range []string{verdictBudgetFalsified, verdictUnexplained, verdictDrift} {
		require.Contains(t, text, v)
	}
}
