// Freshness tests (brief §7 / §10): gate scope (sampled gate, fleet
// advisory), NeverSucceeded and NULL-timestamp fail-closed classes, the
// policy bound, the zero-collateral conditional, and the replay/spot
// comparators' sweeper-identical folding.
package main

import (
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// TestFreshnessBoundIsPolicyMax is GONE with freshnessBound itself (round-16
// M4): the wave-15 max(2×interval, 2×lastPass) auto bound died — round 16
// proved it could be WIDER than the daemon's real additive rule. Every auto
// bound now comes out of sweepCadenceEvaluation, whose two arms (policy from
// the generation-bound persisted cadence; advisory-under-taint otherwise)
// are regression-tested in cadence_f4_test.go and env_test.go.

func TestFreshnessBoundLabelsSurviveEvaluation(t *testing.T) {
	// The label contract evaluateFreshness consumers rely on: the persisted
	// arm is "policy", the unverified arm is advisory and NEVER "policy".
	clearPgxEnv(t)
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	persisted := int64(3600)
	_, inputs, _ := sweepCadenceEvaluation(store.SweepGenerationState{Found: true, ConfiguredIntervalSeconds: &persisted})
	require.Equal(t, "policy", inputs["label"], "the generation-bound daemon cadence is the POLICY bound (risk-quant F7)")
	_, inputs, taints := sweepCadenceEvaluation(store.SweepGenerationState{Found: true})
	require.NotEqual(t, "policy", inputs["label"], "an unverified cadence must never present as policy")
	require.Contains(t, inputs["label"], "advisory")
	require.NotEmpty(t, taints)
}

func TestEvaluateFreshnessGateAndFleet(t *testing.T) {
	now := time.Now()
	recent := now.Add(-10 * time.Minute)
	old := now.Add(-3 * time.Hour)
	rows := []store.AccountFreshness{
		{Account: []byte{0x01}, HasRow: true, Status: "success", LastSuccessBlock: 100, LastSuccessAt: &recent}, // fresh
		{Account: []byte{0x02}, HasRow: true, Status: "success", LastSuccessBlock: 90, LastSuccessAt: &old},     // stale by bound
		{Account: []byte{0x03}, HasRow: true, Status: "failed", LastSuccessBlock: 80},                           // failed
		{Account: []byte{0x04}, HasRow: false},                                                                  // never swept (L0-6)
		{Account: []byte{0x05}, HasRow: true, Status: "success", LastSuccessBlock: 70, LastSuccessAt: nil},      // NULL — fail-closed
		{Account: []byte{0x06}, HasRow: true, Status: "success", LastSuccessBlock: 0},                           // never succeeded
	}
	sampled := map[string]bool{"01": true, "02": true, "04": true}
	res := evaluateFreshness(rows, sampled, time.Hour, map[string]string{"label": "policy"}, now)

	require.Len(t, res.Sampled, 3, "only SAMPLED accounts gate")
	require.Equal(t, 2, res.GateFailures, "stale + never-swept gate; the fresh one passes")
	byAcct := map[string]accountFreshnessVerdict{}
	for _, s := range res.Sampled {
		byAcct[s.AccountHex] = s
	}
	require.Equal(t, "fresh", byAcct["01"].Verdict)
	require.Equal(t, "stale", byAcct["02"].Verdict)
	require.Equal(t, "never-swept", byAcct["04"].Verdict)

	require.Equal(t, 6, res.Fleet.Registry)
	require.Equal(t, 1, res.Fleet.Fresh)
	require.Equal(t, 2, res.Fleet.StaleSuccess, "NULL last_success_at is fail-closed STALE (migration 00006)")
	require.Equal(t, 1, res.Fleet.Failed)
	require.Equal(t, 2, res.Fleet.NeverSwept, "no-row AND last_success_block=0 are both NeverSucceeded classes")
	require.Equal(t, advisoryFleetFreshFraction, res.Fleet.AdvisoryThreshold)
	require.True(t, res.Fleet.AdvisoryBreached)
	require.Contains(t, res.Fleet.Note, "advisory")
	// F8: the registry-exclusion statement is carried, not discovered.
	joined := ""
	for _, n := range res.Notes {
		joined += n + "\n"
	}
	require.Contains(t, joined, "collateral-only Safes are OUT OF CENSUS")
}

func TestZeroCollateralConditional(t *testing.T) {
	ok, detail := zeroCollateralConditional(nil, 100)
	require.True(t, ok, "an empty collateral document is a VALID observation (L2-12)")
	require.Contains(t, detail, "valid zero-collateral")

	rows := []store.BalanceRow{{AssetHex: "cc01", Side: "collateral", Source: "snapshot", Amount: big.NewInt(5), UpdatedBlock: 100}}
	ok, _ = zeroCollateralConditional(rows, 100)
	require.True(t, ok)
	ok, detail = zeroCollateralConditional(rows, 90)
	require.False(t, ok, "snapshot rows must sit exactly at last_success_block")
	require.Contains(t, detail, "90")
}

// TestFoldCollateralOfMatchesSweeperSemantics: zero amounts skipped,
// duplicate tokens summed — exactly internal/snapshot.decodeCollateralOf.
func TestFoldCollateralOfMatchesSweeperSemantics(t *testing.T) {
	tok := common.HexToAddress("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")
	folded := foldCollateralOf([]tokenAmount{
		{Token: tok, Amount: big.NewInt(5)},
		{Token: tok, Amount: big.NewInt(7)},
		{Token: common.HexToAddress("0x4200000000000000000000000000000000000006"), Amount: big.NewInt(0)},
	})
	require.Len(t, folded, 1, "zero amounts are trimmed like the sweeper trims them")
	require.Equal(t, "12", folded[hexLower(tok.Hex())].String(), "duplicate tokens sum")
}

func TestCompareCollateralReplayBitExactBothDirections(t *testing.T) {
	tok := hexLower("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF")
	verdict, diffs := compareCollateralReplay(map[string]string{tok: "12"}, map[string]*big.Int{tok: big.NewInt(12)})
	require.Equal(t, verdictExact, verdict)
	require.Empty(t, diffs)

	verdict, diffs = compareCollateralReplay(map[string]string{tok: "12"}, map[string]*big.Int{tok: big.NewInt(13)})
	require.Equal(t, verdictDrift, verdict)
	require.Len(t, diffs, 1)

	verdict, _ = compareCollateralReplay(map[string]string{tok: "12"}, map[string]*big.Int{})
	require.Equal(t, verdictDrift, verdict, "history token missing on chain surfaces")
	verdict, _ = compareCollateralReplay(map[string]string{}, map[string]*big.Int{tok: big.NewInt(1)})
	require.Equal(t, verdictDrift, verdict, "chain token missing from history surfaces")
	verdict, _ = compareCollateralReplay(map[string]string{}, map[string]*big.Int{})
	require.Equal(t, verdictExact, verdict, "empty == empty: the zero-collateral document replays exactly")
}

func TestBuildSpotReadRowIsReportOnly(t *testing.T) {
	rows := []store.BalanceRow{
		{AssetHex: "cc01", Side: "collateral", Source: "snapshot", Amount: big.NewInt(5), UpdatedBlock: 100},
		{AssetHex: "cc02", Side: "debt", Source: "event", Amount: big.NewInt(9), UpdatedBlock: 100}, // not collateral — excluded
	}
	spot := buildSpotReadRow("aa01", rows, map[string]*big.Int{"cc01": big.NewInt(6)}, 100, 150)
	require.False(t, spot.Match)
	require.EqualValues(t, 50, spot.BlockDistance)
	require.Contains(t, spot.Note, "report-only BY CONSTRUCTION", "the reason it cannot gate is stated on the row itself")
}
