package ingest

// Task 9 wave 14 — the bounded retention lease regressions (Codex round-12
// [high], accepted; the adjudication REVISES the annex's unconditional
// retention-not-reset). Both failure modes of the retention axis get a
// binding regression here:
//
//   - Codex's PIN: unconditional retention keeps a just-below-timeout
//     endpoint forever — the slow-successful posture error-driven rotation
//     structurally cannot see (no error, no per-attempt timeout ever fires).
//   - the annex's BOUNCE, still binding: the lease's probe must never behave
//     as a reset-to-hint — a probe that lands no faster RETURNS to the
//     incumbent, and the R3/R5 family stays green unchanged.
//
// The schedules are built from the SAME two constants the budget derivation
// uses (chainAttemptTimeout, stepMaxPinnedReads), so a derivation drift is
// killed here, not merely commented about. The daemon-level scheduling half
// of the Codex regression lives in cmd/indexer/walker_latency_scheduling_test.go.

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// stepClock is the walker-side fake wall clock: the walker's `now` seam and
// the fake chain's advanceClock hook share it, so a Step's measured wall time
// is exactly the sum of its reads' scripted costs.
type stepClock struct{ t time.Time }

func (c *stepClock) now() time.Time          { return c.t }
func (c *stepClock) advance(d time.Duration) { c.t = c.t.Add(d) }
func newStepClock() *stepClock               { return &stepClock{t: time.Unix(1_700_000_000, 0)} }

// latencyHarness builds the two-endpoint latency schedule: every view fully
// synced and content-healthy (nothing here is a content fault — that is the
// point: only LATENCY distinguishes the endpoints), with per-read costs
// scripted per endpoint and the walker's clock wired to the fake's.
func latencyHarness(t *testing.T, cost0, cost1 time.Duration) (*fakeEndpointChain, *fakeStore, *Walker, *stepClock) {
	t.Helper()
	clk := newStepClock()
	ch := agreeingChain(1000)
	ch.view(0).readCost = cost0
	ch.view(1).readCost = cost1
	ch.advanceClock = clk.advance
	st := &fakeStore{}
	w := walker(ch, st)
	w.now = clk.now
	return ch, st, w, clk
}

// THE CODEX ROUND-12 REGRESSION (binding, the finding verbatim): "endpoint 0
// repeatedly lands just below the timeout while endpoint 1 is fast, proving
// endpoint 1 is reached within a finite bound". Endpoint 0 answers every
// read successfully at chainAttemptTimeout-1s — inside the failover's blind
// spot, so no error arm and no per-attempt timeout can ever rotate away from
// it — and unconditional retention would pin it FOREVER while endpoint 1
// sits fast and idle (the pre-wave-14 behavior; mutation W14M1 restores it
// and dies here).
//
// THE BOUND, FINITE AND STATED: endpoint 1 is reached at Step
// MaxConsecutiveSlowLandings+1 exactly — the lease spends over three slow
// landings and the next Step probes startPref+1 — and the pathological
// phase's total wall cost is bounded by (MaxConsecutiveSlowLandings+1) x
// stepMaxPinnedReads x chainAttemptTimeout. No landing is sacrificed along
// the way: every Step of the schedule lands and advances the cursor.
func TestSlowSuccessfulEndpointIsEscapedWithinTheStatedBound(t *testing.T) {
	ch, st, w, clk := latencyHarness(t, chainAttemptTimeout-time.Second, 50*time.Millisecond)
	ctx := context.Background()
	begin := clk.now()

	// Steps 1..MaxConsecutiveSlowLandings: every Step LANDS on endpoint 0 —
	// its content is impeccable, only its latency is pathological — and each
	// landing exceeds the budget, consuming the lease. Retention holds
	// throughout (the closed law: landing keeps the starting point).
	for i := 0; i < MaxConsecutiveSlowLandings; i++ {
		advanced, err := w.Step(ctx)
		require.NoError(t, err, "step %d: slow is not failure — the Step lands", i+1)
		require.True(t, advanced)
	}
	require.Equal(t, uint64(249), st.cursor.Block, "three windows landed while the lease spent")

	// Step MaxConsecutiveSlowLandings+1: the probe. It starts one past the
	// incumbent (caller-scoped — the shared hint is never consulted), lands
	// fast, and ADOPTS: retention transfers to the witness that is actually
	// serving well.
	advanced, err := w.Step(ctx)
	require.NoError(t, err)
	require.True(t, advanced, "the probe Step still lands a window — probing costs no landing")

	// And the stream STAYS there.
	advanced, err = w.Step(ctx)
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(349), st.cursor.Block, "every Step of the schedule landed")

	require.Equal(t, []int{0, 0, 0, 1, 1}, ch.blockStarts,
		"THE FINITE BOUND, STATED: MaxConsecutiveSlowLandings slow landings on 0, the probe reaches 1 at Step MaxConsecutiveSlowLandings+1, retention transfers")
	require.Equal(t, 1, w.startPref, "retention TRANSFERRED to the faster witness")
	require.Equal(t, 0, ch.active,
		"the shared hint was never consulted for the probe and never written — caller-scoped throughout")

	// The wall-cost bound of the pathological phase, from the same constants
	// the budget derives from: the lease plus its probe can never cost more
	// than lease-length+1 blind-spot-ceiling Steps.
	require.LessOrEqual(t, clk.now().Sub(begin),
		time.Duration(MaxConsecutiveSlowLandings+1)*stepMaxPinnedReads*chainAttemptTimeout,
		"the escape's total wall cost is bounded by the stated derivation")

	// THE DERIVATION IS LOAD-BEARING, not prose: the pathological posture
	// sits ABOVE the budget (one chainAttemptTimeout) and BELOW the blind-spot
	// ceiling (stepMaxPinnedReads x chainAttemptTimeout) — which is exactly
	// what lets the lease see what the failover cannot. Drifting the budget
	// up to the ceiling (mutation W14M3) makes the just-below-timeout posture
	// invisible again and dies on the trace above and on this inequality.
	slowStepWall := stepMaxPinnedReads * (chainAttemptTimeout - time.Second)
	require.Greater(t, slowStepWall, slowStepBudget,
		"a just-below-timeout Step is OVER budget — the lease can see it")
	require.Less(t, slowStepWall, time.Duration(stepMaxPinnedReads)*chainAttemptTimeout,
		"and UNDER the failover's blind-spot ceiling — the failover cannot")
}

// THE ANNEX REGRESSION, STILL BINDING (the R3/R5 family's law carried into
// the lease): THE PROBE IS NOT A RESET. When the neighbour lands NO FASTER
// than the incumbent's evidence, the stream returns to the incumbent —
// startPref never moved, the shared hint is untouched — and the lease
// re-arms IN FULL: one probe Step per spent lease, periodic and bounded,
// never an A-bounce. Mutation W14M2 (the probe adopts unconditionally) dies
// here: adopting the no-better witness would put Steps 5-7 on endpoint 1.
//
// Fixture-realism: BOTH endpoints are inside the per-attempt bound — a
// uniformly degraded fleet is a real provider posture — endpoint 1 merely
// degraded WORSE. There is nowhere better to be, and the honest behavior is
// to stay put and keep paying one bounded probe per lease.
func TestSlowerProbeReturnsToTheIncumbentAndReArmsTheLease(t *testing.T) {
	ch, st, w, _ := latencyHarness(t,
		chainAttemptTimeout-time.Second,          // incumbent: slow
		chainAttemptTimeout-500*time.Millisecond) // neighbour: SLOWER, still landing
	ctx := context.Background()

	for i := 0; i < 8; i++ {
		advanced, err := w.Step(ctx)
		require.NoError(t, err, "step %d: every Step of the schedule lands", i+1)
		require.True(t, advanced, "step %d", i+1)
	}

	require.Equal(t, []int{0, 0, 0, 1, 0, 0, 0, 1}, ch.blockStarts,
		"lease spent -> one probe; no faster -> RETURN to the incumbent for a full re-armed lease; spent again -> probe again: bounded and periodic, never a bounce")
	require.Equal(t, 0, w.startPref,
		"retention never left the incumbent: the no-better probe did not adopt and did NOT reset to the hint")
	require.Equal(t, 0, ch.active, "the shared hint is untouched through both probes")
	require.Equal(t, uint64(499), st.cursor.Block,
		"the probe costs no landing: all 8 Steps landed, including both probe Steps")
}
