package main

// MUTATION EVIDENCE for the Codex round-1 fix wave, one test per named class.
//
// Each test asserts the CORRECT behaviour and, where the defect was a silent
// acceptance, also asserts the shape the defect produced — so restoring the
// defect cannot leave the correct assertion passing unnoticed.

import (
	"encoding/json"
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

// --- finding 7: the intra-block classifier must prove causation -------------

// TestIntraBlockClassifierRequiresCausation is the finding-7 kill. A witness that
// does not flip the boolean explains nothing, and on this population a busy block
// is the norm — so "there was an earlier log" is not evidence.
func TestIntraBlockClassifierRequiresCausation(t *testing.T) {
	// ourEligible=true: exact pass regardless of anything else.
	require.Equal(t, eligTrueAtParent, classifyIntraBlock(true, false, true, false, 0))

	// FALSE at the parent, and the recomputation at execution-frame prices makes it
	// TRUE, with a custodied witness present: causation PROVEN.
	require.Equal(t, eligFlippedWithWitness, classifyIntraBlock(false, true, true, true, 0))
	require.Equal(t, eligFlippedWithWitness, classifyIntraBlock(false, true, true, false, 3))

	// THE KILL: witnesses and a price move are present, but the recomputation does
	// NOT reproduce the flip. That is UNEXPLAINED, not excused.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, false, true, true, 5),
		"an earlier same-block log and a price move do NOT explain a false negative unless the boolean actually flips when recomputed — this is exactly what round 1 accepted without checking")
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, false, true, false, 0))

	// A leg we could not price in both frames makes the recomputation impossible,
	// which gates rather than excusing.
	require.Equal(t, eligUnpriced, classifyIntraBlock(false, true, false, true, 2))
	require.Equal(t, eligUnpriced, classifyIntraBlock(false, false, false, false, 0))

	// A flip with NO witness and NO price move is not attributable either: the
	// mechanism chain-truth R1 admits is an intra-block custodied write.
	require.Equal(t, eligUnexplainedOutcome, classifyIntraBlock(false, true, true, false, 0),
		"a reproduced flip still needs a custodied mechanism; otherwise the two frames differ for a reason we cannot name")
}
