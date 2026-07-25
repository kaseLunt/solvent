package main

// Daemon health-surface tests: the composition of terminal and recoverable
// conditions, the readiness/liveness split, the price pass's step/backoff/recovery
// bookkeeping (which previously dropped ordinary Step errors on the floor), and
// what a PROCESS SUPERVISOR actually sees over HTTP.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/prices"
)

// TestMain silences the daemon's operational logging for the whole package.
func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	os.Exit(m.Run())
}

// fakePriceWorker is a scripted price worker: per-call (advanced, error) results
// and a settable condition set, so the daemon's composition can be tested without
// a store, a chain or a clock.
type fakePriceWorker struct {
	name    string
	results []struct {
		advanced bool
		err      error
	}
	calls int
	conds []prices.Condition
}

func newFakeWorker(name string) *fakePriceWorker { return &fakePriceWorker{name: name} }

// script appends one Step outcome.
func (f *fakePriceWorker) script(advanced bool, err error) *fakePriceWorker {
	f.results = append(f.results, struct {
		advanced bool
		err      error
	}{advanced, err})
	return f
}

func (f *fakePriceWorker) Name() string { return f.name }

func (f *fakePriceWorker) Step(context.Context) (bool, error) {
	if f.calls >= len(f.results) {
		f.calls++
		return false, nil // nothing left to do
	}
	r := f.results[f.calls]
	f.calls++
	return r.advanced, r.err
}

func (f *fakePriceWorker) Conditions() []prices.Condition { return f.conds }

// newTestHealth builds a healthState on a manually-advanced clock.
func newTestHealth() (*healthState, *fakeClock) {
	clk := &fakeClock{t: time.Unix(1_000_000, 0)}
	return newHealthState(clk.now), clk
}

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

// A clean daemon is healthy, ready and live — and says so with no conditions.
func TestHealthReportCleanState(t *testing.T) {
	h, _ := newTestHealth()
	h.heartbeat()
	r := h.report()
	require.Equal(t, "healthy", r.Status)
	require.True(t, r.Ready)
	require.True(t, r.Live)
	require.Empty(t, r.Terminal)
	require.Empty(t, r.Recoverable)
}

// RECOVERABLE conditions make the daemon NOT READY but still LIVE: restarting a
// process with a stale feed does not un-stale the feed, so a restart is the wrong
// supervisor response — draining traffic is the right one.
func TestHealthRecoverableIsDegradedNotDead(t *testing.T) {
	h, _ := newTestHealth()
	h.heartbeat()
	h.setWorkerConditions("prices:poll:10", map[string]string{
		prices.ConditionPollTargetFreshness: "3 of 20 assets stale",
	})

	r := h.report()
	require.Equal(t, "degraded", r.Status)
	require.False(t, r.Ready, "a process serving missing prices is not ready to be depended on")
	require.True(t, r.Live, "but restarting it would not help")
	require.Equal(t, map[string]string{
		"prices:poll:10/" + prices.ConditionPollTargetFreshness: "3 of 20 assets stale",
	}, r.Recoverable)
}

// TERMINAL conditions make the daemon unhealthy and NOT READY, and still not a
// liveness failure: recovery needs different code, so a restart loop would only
// crash-loop.
func TestHealthTerminalIsUnhealthyButNotALivenessFailure(t *testing.T) {
	h, _ := newTestHealth()
	h.heartbeat()
	first := h.setTerminal("aave_v3_etherfi", "unknown event: capability upgrade required")
	require.True(t, first, "the transition is reported once so the caller can log it at Error")
	require.False(t, h.setTerminal("aave_v3_etherfi", "same"), "and only once")

	r := h.report()
	require.Equal(t, "unhealthy", r.Status)
	require.False(t, r.Ready)
	require.True(t, r.Live)
	require.Contains(t, r.Terminal, "aave_v3_etherfi")
}

// Terminal outranks recoverable in the summary word, and BOTH sets are reported —
// the composition the review asked for.
func TestHealthReportComposesBothMaps(t *testing.T) {
	h, _ := newTestHealth()
	h.heartbeat()
	h.setTerminal("debt_manager", "terminal reason")
	h.setWorkerConditions("prices:chainlink_feed:1", map[string]string{
		prices.ConditionFeedPublication: "USDC stale",
		prices.ConditionRPCIngestLag:    "no confirmed live head",
	})

	r := h.report()
	require.Equal(t, "unhealthy", r.Status)
	require.False(t, r.Ready)
	require.Len(t, r.Terminal, 1)
	require.Len(t, r.Recoverable, 2, "the two feed conditions stay SEPARATELY keyed")
	require.Contains(t, r.Recoverable, "prices:chainlink_feed:1/"+prices.ConditionFeedPublication)
	require.Contains(t, r.Recoverable, "prices:chainlink_feed:1/"+prices.ConditionRPCIngestLag)
}

// Recoverable entries are REPLACED per worker, so recovery is visible instead of
// sticking at a pre-recovery verdict — and one worker's entries never clear
// another's.
func TestHealthWorkerConditionsAreReplacedPerWorker(t *testing.T) {
	h, _ := newTestHealth()
	h.heartbeat()
	h.setWorkerConditions("a", map[string]string{"x": "1", "y": "2"})
	h.setWorkerConditions("b", map[string]string{"x": "3"})
	require.Len(t, h.report().Recoverable, 3)

	h.setWorkerConditions("a", map[string]string{"y": "2b"})
	r := h.report()
	require.Equal(t, map[string]string{"a/y": "2b", "b/x": "3"}, r.Recoverable,
		"a's stale entry is gone, b's is untouched")

	h.setWorkerConditions("a", nil)
	h.setWorkerConditions("b", nil)
	r = h.report()
	require.Equal(t, "healthy", r.Status)
	require.True(t, r.Ready, "full recovery is reachable — this class is not terminal")
}

// Terminal entries deliberately never clear: the documented recovery is a restart
// at upgraded code, and pretending otherwise would hide a gated engine.
func TestHealthTerminalNeverClears(t *testing.T) {
	h, _ := newTestHealth()
	h.heartbeat()
	h.setTerminal("debt_manager", "capability error")
	h.setWorkerConditions("prices:poll:10", nil)
	require.False(t, h.report().Ready)
	require.Contains(t, h.report().Terminal, "debt_manager")
}

// ---------------------------------------------------------------------------
// Liveness.
// ---------------------------------------------------------------------------

// LIVENESS is the loop heartbeat: a daemon whose inner loop has stopped completing
// rounds is wedged, and its condition set is simply not being refreshed — so the
// verdict flips to unhealthy regardless of how clean that stale set looks.
func TestHealthLivenessFailsOnWedgedLoop(t *testing.T) {
	h, clk := newTestHealth()

	r := h.report()
	require.True(t, r.Live, "startup: the first round has not completed yet")
	require.Equal(t, "never", r.LoopAge)

	h.heartbeat()
	clk.advance(loopLivenessBound - time.Second)
	require.True(t, h.report().Live)

	clk.advance(2 * time.Second)
	r = h.report()
	require.False(t, r.Live, "the loop has not completed a round within the bound")
	require.Equal(t, "unhealthy", r.Status)
	require.False(t, r.Ready)

	h.heartbeat()
	require.True(t, h.report().Live, "a completed round re-arms liveness")
}

// ---------------------------------------------------------------------------
// The price pass.
// ---------------------------------------------------------------------------

// AN ORDINARY STEP ERROR REACHES THE SURFACE. This is the defect the review
// named: the error used to be logged and dropped unless the worker's own health
// verdict happened to fail too, so a worker failing every round looked fine to a
// supervisor.
func TestStepPriceWorkersRecordsStepError(t *testing.T) {
	h, clk := newTestHealth()
	clk.advance(0)
	w := newFakeWorker("prices:poll:10").script(false, errors.New("apply prices at 5000: boom"))
	ps := &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	advanced := stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
	require.False(t, advanced)

	r := h.report()
	require.Equal(t, "degraded", r.Status)
	require.False(t, r.Ready, "/readyz must fail while a worker cannot Step")
	key := "prices:poll:10/" + conditionStepError
	require.Contains(t, r.Recoverable, key)
	require.Contains(t, r.Recoverable[key], "boom")
	require.Contains(t, r.Recoverable[key], "1 consecutive round(s)")
	require.Contains(t, r.Recoverable[key], "retrying in 30s")
}

// The worker BACKS OFF by timestamp, its conditions are still read while it does,
// and the step_error entry persists for the whole backoff window rather than
// silently disappearing.
func TestStepPriceWorkersConditionsReadWhileBackingOff(t *testing.T) {
	h, clk := newTestHealth()
	w := newFakeWorker("prices:chainlink_feed:1").script(false, errors.New("first failure"))
	w.conds = []prices.Condition{{Name: prices.ConditionFeedPublication, Reason: "USDC stale"}}
	ps := &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
	require.Equal(t, 1, w.calls)

	// Inside the backoff window: no Step is attempted, but the surface still
	// reports both the worker's own condition and the step error.
	stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
	require.Equal(t, 1, w.calls, "the backoff held: no extra Step")
	r := h.report()
	require.Contains(t, r.Recoverable, "prices:chainlink_feed:1/"+prices.ConditionFeedPublication)
	require.Contains(t, r.Recoverable, "prices:chainlink_feed:1/"+conditionStepError)

	// Past the deadline it retries.
	clk.advance(retryBackoffBase * 2)
	stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
	require.Equal(t, 2, w.calls)
}

// RECOVERY: a clean round clears the step error, re-arms the backoff, and — once
// the worker's own conditions clear too — restores readiness.
func TestStepPriceWorkersRecoveryClearsTheSurface(t *testing.T) {
	h, clk := newTestHealth()
	w := newFakeWorker("prices:poll:10").
		script(false, errors.New("boom")).
		script(true, nil).
		script(false, nil)
	w.conds = []prices.Condition{{Name: prices.ConditionPollRound, Reason: "no round landed"}}
	ps := &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
	require.False(t, h.report().Ready)
	require.Equal(t, 1, ps.bo.failures)

	clk.advance(retryBackoffBase * 2)
	w.conds = nil // the poller landed a round
	advanced := stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
	require.True(t, advanced)
	require.Zero(t, ps.bo.failures, "a clean round re-arms the backoff")
	require.Nil(t, ps.lastErr)

	h.heartbeat()
	r := h.report()
	require.Equal(t, "healthy", r.Status)
	require.True(t, r.Ready, "recovery is visible on the surface, not just in the log")
	require.Empty(t, r.Recoverable)
}

// A worker that keeps failing keeps failing readiness, and the reported
// consecutive count grows — a supervisor sees a persistent failure as persistent.
func TestStepPriceWorkersPersistentFailureStaysUnready(t *testing.T) {
	h, clk := newTestHealth()
	w := newFakeWorker("prices:poll:10")
	for i := 0; i < 4; i++ {
		w.script(false, fmt.Errorf("failure %d", i))
	}
	ps := &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	for i := 0; i < 4; i++ {
		stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
		require.False(t, h.report().Ready, "round %d", i)
		clk.advance(retryBackoffCap * 2) // always past the deadline
	}
	require.Equal(t, 4, ps.bo.failures)
	require.Contains(t, h.report().Recoverable["prices:poll:10/"+conditionStepError],
		"4 consecutive round(s)")
}

// A CONTEXT CANCELLATION is shutdown, not failure: no backoff is consumed and no
// health entry is recorded, so a clean stop does not look like an outage.
func TestStepPriceWorkersContextCancelIsNotAFailure(t *testing.T) {
	h, clk := newTestHealth()
	h.heartbeat()
	w := newFakeWorker("prices:poll:10").script(false, context.Canceled)
	ps := &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)
	require.Zero(t, ps.bo.failures)
	require.Nil(t, ps.lastErr)
	require.Equal(t, "healthy", h.report().Status)
}

// The pass is bounded at stepsPerRound per worker even when the worker keeps
// advancing, so one worker cannot hold the loop.
func TestStepPriceWorkersBoundedPerRound(t *testing.T) {
	h, clk := newTestHealth()
	w := newFakeWorker("prices:poll:10")
	for i := 0; i < stepsPerRound*3; i++ {
		w.script(true, nil)
	}
	ps := &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	require.True(t, stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h))
	require.Equal(t, stepsPerRound, w.calls)
}

// Several workers are independent: one failing does not stop the others stepping,
// and each owns its own keyed entries.
func TestStepPriceWorkersAreIndependent(t *testing.T) {
	h, clk := newTestHealth()
	bad := newFakeWorker("prices:poll:10").script(false, errors.New("boom"))
	good := newFakeWorker("prices:chainlink_feed:1").script(true, nil).script(false, nil)
	states := []*priceWorkerState{
		{w: bad, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}},
		{w: good, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}},
	}

	require.True(t, stepPriceWorkers(context.Background(), states, h))
	require.Equal(t, 2, good.calls, "the healthy worker ran to its non-advancing Step")
	r := h.report()
	require.Contains(t, r.Recoverable, "prices:poll:10/"+conditionStepError)
	require.NotContains(t, r.Recoverable, "prices:chainlink_feed:1/"+conditionStepError)
}

// ---------------------------------------------------------------------------
// What a supervisor sees.
// ---------------------------------------------------------------------------

// decodeReport reads a handler response into a healthReport.
func decodeReport(t *testing.T, body io.Reader) healthReport {
	t.Helper()
	var r healthReport
	require.NoError(t, json.NewDecoder(body).Decode(&r))
	return r
}

// SUPERVISOR VISIBILITY: /readyz turns 503 the moment a price worker is unhealthy,
// /healthz stays 200 because a restart would not help, and /health always answers
// with the detail. The old surface was a WARN line: none of this existed.
func TestHealthEndpointsReflectWorkerFailure(t *testing.T) {
	h, clk := newTestHealth()
	h.heartbeat()
	srv := httptest.NewServer(h.handler())
	t.Cleanup(srv.Close)

	get := func(path string) (int, healthReport) {
		resp, err := http.Get(srv.URL + path)
		require.NoError(t, err)
		defer resp.Body.Close()
		return resp.StatusCode, decodeReport(t, resp.Body)
	}

	code, r := get("/readyz")
	require.Equal(t, http.StatusOK, code)
	require.True(t, r.Ready)

	// A worker starts failing.
	w := newFakeWorker("prices:poll:10").script(false, errors.New("apply prices: boom"))
	w.conds = []prices.Condition{{Name: prices.ConditionPollRound, Reason: "no round landed for 5m"}}
	ps := &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}
	stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, h)

	code, r = get("/readyz")
	require.Equal(t, http.StatusServiceUnavailable, code, "a supervisor can now SEE the failure")
	require.False(t, r.Ready)
	require.Equal(t, "degraded", r.Status)
	require.Contains(t, r.Recoverable, "prices:poll:10/"+prices.ConditionPollRound)
	require.Contains(t, r.Recoverable, "prices:poll:10/"+conditionStepError)

	code, _ = get("/healthz")
	require.Equal(t, http.StatusOK, code, "liveness: restarting would not fix a stale feed")

	code, r = get("/health")
	require.Equal(t, http.StatusOK, code, "the detail endpoint never fails, it just reports")
	require.False(t, r.Ready)
}

// A wedged loop DOES fail liveness, which is the one case where a restart is the
// right supervisor response.
func TestHealthEndpointLivenessFailsWhenLoopWedges(t *testing.T) {
	h, clk := newTestHealth()
	h.heartbeat()
	srv := httptest.NewServer(h.handler())
	t.Cleanup(srv.Close)

	clk.advance(loopLivenessBound + time.Second)
	resp, err := http.Get(srv.URL + "/healthz")
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
	r := decodeReport(t, resp.Body)
	require.False(t, r.Live)
	require.NotEqual(t, "never", r.LoopAge, "the response says HOW stale the loop is")
}

// serveHealth binds a real socket and serves until the context is cancelled.
func TestServeHealthServesAndShutsDown(t *testing.T) {
	h, _ := newTestHealth()
	h.heartbeat()
	ctx, cancel := context.WithCancel(context.Background())
	addr, shutdown, err := serveHealth(ctx, "127.0.0.1:0", h)
	require.NoError(t, err)
	require.NotEmpty(t, addr)

	resp, err := http.Get("http://" + addr + "/readyz")
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	cancel()
	shutdown() // idempotent with the ctx-driven shutdown
	_, err = http.Get("http://" + addr + "/readyz")
	require.Error(t, err, "the surface is gone once the daemon stops")
}

// A BIND FAILURE IS FATAL. A health endpoint that silently failed to come up
// would recreate the exact defect this surface exists to fix: an operator
// believing there is a probe when there is only a log line.
func TestServeHealthBindFailureIsAnError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	h, _ := newTestHealth()
	_, _, err = serveHealth(context.Background(), ln.Addr().String(), h)
	require.Error(t, err)
	require.ErrorContains(t, err, "bind health endpoint")
	require.ErrorContains(t, err, "SOLVENT_HEALTH_ADDR=off",
		"the error names the only sanctioned way to run without a probe")
}
