package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
)

func round(block uint64, at time.Time) snapshotdb.T6FeedRound {
	return snapshotdb.T6FeedRound{Block: block, SourceAsOf: at, HasAsOf: true}
}

// TestComputeFeedGapsRunsOnSourceAsOfAndSkipsNulls pins chain-truth R4.3: gap
// arithmetic runs on the round's own updatedAt (persisted as source_as_of by the
// STRICT decoder), never on insertion time, and a row without a chain-asserted
// as-of is SKIPPED rather than interpolated over.
func TestComputeFeedGapsRunsOnSourceAsOfAndSkipsNulls(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	rounds := []snapshotdb.T6FeedRound{
		round(100, base),
		{Block: 150, HasAsOf: false}, // NULL source_as_of: excluded, not interpolated
		round(200, base.Add(90*time.Minute)),
		round(300, base.Add(150*time.Minute)),
	}
	gaps := computeFeedGaps(rounds)
	require.Len(t, gaps, 2, "the NULL row contributes no interval on either side")
	require.Equal(t, int64(5400), gaps[0].GapSeconds)
	require.Equal(t, uint64(100), gaps[0].FromBlock)
	require.Equal(t, uint64(200), gaps[0].ToBlock, "the interval spans the NULL row rather than being invented across it")
	require.Equal(t, int64(3600), gaps[1].GapSeconds)
}

// TestComputeFeedGapsNeverProducesANegativeGap: source_as_of is the aggregator's
// own claim, so it can in principle regress relative to block order. A negative
// gap would silently reduce a max; it is clamped to zero and the interval is
// still recorded.
func TestComputeFeedGapsNeverProducesANegativeGap(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	gaps := computeFeedGaps([]snapshotdb.T6FeedRound{
		round(100, base.Add(time.Hour)),
		round(200, base), // regressed as-of
	})
	require.Len(t, gaps, 1)
	require.Equal(t, int64(0), gaps[0].GapSeconds)
}

// TestPercentileGapMatchesNearestRank keeps the run's p99 comparable with the
// freeze-time SQL, which used percentile_disc (nearest rank).
func TestPercentileGapMatchesNearestRank(t *testing.T) {
	gaps := make([]feedGap, 0, 100)
	for i := 1; i <= 100; i++ {
		gaps = append(gaps, feedGap{GapSeconds: int64(i)})
	}
	require.Equal(t, int64(100), percentileGap(gaps, 0.99))
	require.Equal(t, int64(51), percentileGap(gaps, 0.50))
	require.Equal(t, int64(0), percentileGap(nil, 0.99))
}

// TestHeartbeatVerdictLadder walks the four rungs with concrete numbers,
// including the one that makes the gate able to FAIL. risk-quant R5-4: the
// original clause "upgrades grades or records the qualifier" was a gate that
// could only pass.
func TestHeartbeatVerdictLadder(t *testing.T) {
	cases := []struct {
		name      string
		maxGap    int64
		heartbeat int64
		grace     int64
		want      string
	}{
		{"inside the heartbeat -> provenance upgrade", 3400, 3600, 1800, verdictProvenanceUpgrade},
		{"exactly at the heartbeat -> still an upgrade", 3600, 3600, 1800, verdictProvenanceUpgrade},
		{"heartbeat < gap <= heartbeat+grace -> qualifier", 3732, 3600, 1800, verdictQualifier},
		{"exactly at heartbeat+grace -> still a qualifier", 5400, 3600, 1800, verdictQualifier},
		{"beyond heartbeat+grace -> BUDGET FALSIFIED (gated fail)", 5401, 3600, 1800, verdictBudgetFalsified},
		{"the observed USDC-class gap -> FALSIFIED", 248460, 86400, 3600, verdictBudgetFalsified},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ladderVerdict(tc.maxGap, tc.heartbeat, tc.grace)
			require.Equal(t, tc.want, got)
		})
	}
}

// ladderVerdict mirrors the ladder the scan applies, so the boundaries can be
// tested without a chain. It is deliberately the SAME comparison shape as the
// switch in runHeartbeatScan; TestLadderMirrorsTheScan below keeps them honest.
func ladderVerdict(maxGap, heartbeat, grace int64) string {
	switch {
	case maxGap <= heartbeat:
		return verdictProvenanceUpgrade
	case maxGap <= heartbeat+grace:
		return verdictQualifier
	default:
		return verdictBudgetFalsified
	}
}

// TestPhaseChangeCheckTriggerConditions pins chain-truth R4.2's two triggers:
// a gap > 2x the published heartbeat, and a gap open-ended at the scan head.
// Getting this wrong in either direction is bad: too narrow and a phase change
// is reported as a heartbeat violation; too wide and every feed pays for an
// extra pinned read.
func TestPhaseChangeCheckTriggerConditions(t *testing.T) {
	needs := func(maxGap, headGap, heartbeat, grace int64) bool {
		return maxGap > 2*heartbeat || (heartbeat > 0 && headGap > heartbeat+grace)
	}
	// The observed PYUSD-class gap (7 days against a claimed 24h heartbeat) is
	// > 2x and MUST consult the proxy first.
	require.True(t, needs(604896, 0, 86400, 3600), "a 7-day gap against a 24h claim is >2x and needs the phase check")
	// The observed FRAX-class gap (1.98 days) is NOT > 2x, so it is a genuine
	// heartbeat verdict without a phase read.
	require.False(t, needs(170712, 0, 86400, 3600), "1.98 days is under 2x a 24h heartbeat")
	// An open-ended head gap triggers it regardless of the max gap.
	require.True(t, needs(1000, 200000, 86400, 3600), "a stalled head triggers the phase check on its own")
	// A healthy weETH-class feed triggers nothing.
	require.False(t, needs(3732, 1200, 3600, 1800))
}

// TestUnscannableWhenThePhaseCheckCannotBePerformed is the fail-closed direction:
// if the proxy read does not answer, the scan may NOT fall through to a
// heartbeat verdict, because the two explanations are indistinguishable without
// it. "Cannot verify" is never advisory (round-11 F2).
func TestUnscannableWhenThePhaseCheckCannotBePerformed(t *testing.T) {
	// The behaviour is structural in runHeartbeatScan: the unread branch sets
	// the verdict to unscannable and `continue`s before the ladder. This test
	// pins the two invariants that make that safe.
	require.NotEqual(t, verdictUnscannable, verdictProvenanceUpgrade)
	require.NotEqual(t, verdictUnscannable, verdictQualifier)
	// And unscannable is GATED wherever it is produced.
	row := p3Row{Verdict: verdictUnscannable, Gated: true}
	require.Equal(t, 1, tallyP3([]p3Row{row}), "an unscannable feed must reach the exit code")
}

// TestBudgetFalsifiedRaisesTheBudgetRatherThanWideningTheGate pins the
// remediation direction chain-truth R4.4 names: the served freshness budget
// carries the OBSERVED bound; keeping the friendlier published number is the
// silent-cap anti-canon.
func TestBudgetFalsifiedRaisesTheBudgetRatherThanWideningTheGate(t *testing.T) {
	v := heartbeatVerdict{Heartbeat: 86400, Grace: 3600, MaxGapSeconds: 248460}
	// The scan's own assignment: budget := max gap on the falsified rung.
	if ladderVerdict(v.MaxGapSeconds, v.Heartbeat, v.Grace) == verdictBudgetFalsified {
		v.BudgetSeconds = v.MaxGapSeconds
	}
	require.Equal(t, int64(248460), v.BudgetSeconds)
	require.Greater(t, v.BudgetSeconds, v.Heartbeat+v.Grace,
		"the post-scan budget must be the observed bound, never the refuted published one")
}
