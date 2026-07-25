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
	"github.com/kaselunt/solvent/internal/store"
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

// newStartingTestHealth builds a healthState exactly as the daemon does: CLOSED,
// with initialisation not yet complete.
func newStartingTestHealth() (*healthState, *fakeClock) {
	clk := &fakeClock{t: time.Unix(1_000_000, 0)}
	return newHealthState(clk.now), clk
}

// newTestHealth builds a healthState already PAST initialisation, which is the
// state every composition test below is actually about.
//
// Readiness genuinely starts closed — TestHealthStartsClosedUntilInitialised is
// the test for that — and if these tests inherited the startup condition they
// would all be re-asserting it by accident instead of testing composition.
func newTestHealth() (*healthState, *fakeClock) {
	h, clk := newStartingTestHealth()
	h.heartbeat()
	h.markInitialized()
	return h, clk
}

// ---------------------------------------------------------------------------
// Readiness starts CLOSED.
// ---------------------------------------------------------------------------

// READY-START: the health endpoint deliberately comes up before any dependency, so
// its FIRST answer must be a refusal. The previous version reported Ready=true from
// the same instant, so /readyz returned 200 throughout registry loading, the
// database connection, migrations, chain verification and worker construction — and
// indefinitely on a hung dependency, while ingestion had never started.
func TestHealthStartsClosedUntilInitialised(t *testing.T) {
	h, clk := newStartingTestHealth()

	r := h.report()
	require.False(t, r.Ready, "missing information must produce refusal, not permission")
	require.Equal(t, "starting", r.Status)
	require.True(t, r.Live, "a process that has not finished starting must not be restarted for it")
	require.Contains(t, r.Recoverable, startupWorker+"/"+conditionStartup)
	require.Contains(t, r.Recoverable[startupWorker+"/"+conditionStartup], "one full daemon round")

	// A round that has not completed cannot clear it.
	require.False(t, h.markInitialized(), "no round has completed yet")
	require.False(t, h.report().Ready)

	// Nor can a round in which a worker could not Step: the surface itself is the
	// evidence, so a caller cannot declare readiness the conditions contradict.
	h.heartbeat()
	h.setWorkerConditions("prices:poll:10", map[string]string{
		conditionStepError: "apply prices: boom",
	})
	require.False(t, h.markInitialized(), "a failing worker defers initialisation")
	require.Equal(t, "starting", h.report().Status)

	// Nor can a round with a terminal engine error.
	h.setWorkerConditions("prices:poll:10", nil)
	h.setTerminal("aave_v3_etherfi", "capability upgrade required")
	require.False(t, h.markInitialized())

	// A clean round does, and the state latches.
	h2, clk2 := newStartingTestHealth()
	h2.heartbeat()
	require.True(t, h2.markInitialized())
	require.True(t, h2.report().Ready)
	require.Equal(t, "healthy", h2.report().Status)
	require.False(t, h2.markInitialized(), "the transition is reported once")

	// Once initialised, later failures are reported as THEMSELVES, not as startup.
	h2.setWorkerConditions("prices:poll:10", map[string]string{conditionStepError: "boom"})
	r = h2.report()
	require.Equal(t, "degraded", r.Status)
	require.NotContains(t, r.Recoverable, startupWorker+"/"+conditionStartup)
	_, _ = clk, clk2
}

// A worker whose name happens to collide with the startup entry's prefix cannot
// clear it: the startup state lives in its own field, not in the recoverable map
// that setWorkerConditions replaces by prefix. Stream names come from config and
// legitimately contain colons, so this is a real collision surface.
func TestHealthStartupConditionSurvivesWorkerNamedLikeIt(t *testing.T) {
	h, _ := newStartingTestHealth()
	h.setWorkerConditions(startupWorker, nil)
	require.Contains(t, h.report().Recoverable, startupWorker+"/"+conditionStartup)
	require.False(t, h.report().Ready)
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
	h, clk := newStartingTestHealth()

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
// B-workers: the non-price passes reach readiness too.
// ---------------------------------------------------------------------------

// fakeIngestWorker is a scripted raw-log walker.
type fakeIngestWorker struct {
	name    string
	results []struct {
		advanced bool
		err      error
	}
	calls    int
	lag      uint64
	lagSeen  bool
	stepHook func()
}

func (f *fakeIngestWorker) Name() string { return f.name }

func (f *fakeIngestWorker) Step(context.Context) (bool, error) {
	if f.stepHook != nil {
		f.stepHook()
	}
	if f.calls >= len(f.results) {
		f.calls++
		return false, nil
	}
	r := f.results[f.calls]
	f.calls++
	return r.advanced, r.err
}

func (f *fakeIngestWorker) HeadLag() (uint64, bool) { return f.lag, f.lagSeen }

func (f *fakeIngestWorker) script(advanced bool, err error) *fakeIngestWorker {
	f.results = append(f.results, struct {
		advanced bool
		err      error
	}{advanced, err})
	return f
}

// fakeDeriveWorker is a scripted derivation runner, including its TERMINAL
// capability verdict.
type fakeDeriveWorker struct {
	name    string
	results []struct {
		advanced bool
		err      error
	}
	calls    int
	unhealth string
}

func (f *fakeDeriveWorker) Name() string { return f.name }

func (f *fakeDeriveWorker) Step(context.Context) (bool, error) {
	if f.calls >= len(f.results) {
		f.calls++
		return false, nil
	}
	r := f.results[f.calls]
	f.calls++
	return r.advanced, r.err
}

func (f *fakeDeriveWorker) Health() (bool, string) {
	if f.unhealth == "" {
		return true, ""
	}
	return false, f.unhealth
}

func (f *fakeDeriveWorker) script(advanced bool, err error) *fakeDeriveWorker {
	f.results = append(f.results, struct {
		advanced bool
		err      error
	}{advanced, err})
	return f
}

// fakeSnapshotWorker is a scripted snapshotter.
type fakeSnapshotWorker struct {
	results []struct {
		advanced bool
		err      error
	}
	calls int
}

func (f *fakeSnapshotWorker) Step(context.Context) (bool, error) {
	if f.calls >= len(f.results) {
		f.calls++
		return false, nil
	}
	r := f.results[f.calls]
	f.calls++
	return r.advanced, r.err
}

func (f *fakeSnapshotWorker) script(advanced bool, err error) *fakeSnapshotWorker {
	f.results = append(f.results, struct {
		advanced bool
		err      error
	}{advanced, err})
	return f
}

// fakeProgress serves durable cursor progress.
type fakeProgress struct {
	ingest    []store.CursorProgress
	derive    []store.CursorProgress
	ingestErr error
	deriveErr error
}

func (f *fakeProgress) IngestCursorProgress(context.Context) ([]store.CursorProgress, error) {
	return f.ingest, f.ingestErr
}

func (f *fakeProgress) DeriveCursorProgress(context.Context) ([]store.CursorProgress, error) {
	return f.derive, f.deriveErr
}

// B-WORKERS (INGESTION): a walker error used to reach a log line and a local
// backoff and NOTHING else, so a raw-log stream failing every round for hours left
// /readyz answering 200. Ingestion is the input every derived table depends on.
func TestStepWalkersRoutesErrorsIntoReadiness(t *testing.T) {
	h, clk := newTestHealth()
	w := (&fakeIngestWorker{name: "op:debt-manager"}).script(false, errors.New("logs [100,200]: boom"))
	ws := &walkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	rc := roundConditions{}
	require.False(t, stepWalkers(context.Background(), []*walkerState{ws}, rc))
	rc.publish(h)

	r := h.report()
	require.False(t, r.Ready, "/readyz must fail while raw-log ingestion cannot Step")
	require.Equal(t, "degraded", r.Status)
	key := "op:debt-manager/" + conditionStepError
	require.Contains(t, r.Recoverable, key)
	require.Contains(t, r.Recoverable[key], "boom")
	require.Contains(t, r.Recoverable[key], "1 consecutive round(s)")

	// The condition persists through the backoff window, when the signal matters
	// most, and clears on recovery.
	rc = roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	rc.publish(h)
	require.Equal(t, 1, w.calls, "the backoff held")
	require.Contains(t, h.report().Recoverable, key)

	clk.advance(retryBackoffCap * 2)
	rc = roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	rc.publish(h)
	h.heartbeat() // the loop completed a round; liveness is a separate axis
	require.Equal(t, 2, w.calls)
	require.NotContains(t, h.report().Recoverable, key, "recovery is visible on the surface")
	require.True(t, h.report().Ready)
}

// A walker can advance every round and still be falling behind. Head lag is the
// condition no-progress cannot see, and it fires during backfill on purpose: a
// process that has not reached the chain is not ready to be depended on.
func TestStepWalkersReportsHeadLag(t *testing.T) {
	h, clk := newTestHealth()
	w := &fakeIngestWorker{name: "eth:feed-usdc", lag: headLagBound + 1, lagSeen: true}
	ws := &walkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	rc := roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	rc.publish(h)
	key := "eth:feed-usdc/" + conditionHeadLag
	require.Contains(t, h.report().Recoverable, key)
	require.Contains(t, h.report().Recoverable[key], "blocks behind the chain head")
	require.False(t, h.report().Ready)

	// Caught up: cleared.
	w.lag = 3
	rc = roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	rc.publish(h)
	require.NotContains(t, h.report().Recoverable, key)

	// A walker that has never observed a head reports nothing here — its Step
	// error is the signal instead.
	w.lagSeen = false
	rc = roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	rc.publish(h)
	require.NotContains(t, h.report().Recoverable, key)
}

// B-WORKERS (DERIVATION): ordinary derivation Step errors populated no health entry
// at all, so position derivation could fail every round while readiness stayed
// green. Terminal capability errors keep their own separate channel.
func TestStepRunnersRoutesBothFailureClasses(t *testing.T) {
	h, _ := newTestHealth()
	r1 := (&fakeDeriveWorker{name: "debt_manager"}).script(false, errors.New("apply derived: boom"))
	r2 := &fakeDeriveWorker{name: "aave_v3_etherfi", unhealth: "unknown event: capability upgrade required"}
	states := []*runnerState{{r: r1}, {r: r2}}

	rc := roundConditions{}
	require.False(t, stepRunners(context.Background(), states, rc, h))
	rc.publish(h)

	rep := h.report()
	require.False(t, rep.Ready)
	require.Equal(t, "unhealthy", rep.Status, "a terminal entry outranks the recoverable one")
	require.Contains(t, rep.Recoverable, "debt_manager/"+conditionStepError)
	require.Contains(t, rep.Recoverable["debt_manager/"+conditionStepError], "1 consecutive round(s)")
	require.Contains(t, rep.Terminal, "aave_v3_etherfi")

	// The recoverable class recovers; the terminal one deliberately does not.
	rc = roundConditions{}
	stepRunners(context.Background(), states, rc, h)
	rc.publish(h)
	rep = h.report()
	require.NotContains(t, rep.Recoverable, "debt_manager/"+conditionStepError)
	require.Contains(t, rep.Terminal, "aave_v3_etherfi")
}

// B-WORKERS (SNAPSHOTS): the third leg. Snapshot failures fed nothing into health.
func TestStepSnapshotterRoutesErrorsIntoReadiness(t *testing.T) {
	h, _ := newTestHealth()
	snap := (&fakeSnapshotWorker{}).script(false, errors.New("sweep batch: boom")).script(true, nil)
	var ss snapshotState

	rc := roundConditions{}
	require.False(t, stepSnapshotter(context.Background(), snap, &ss, rc))
	rc.publish(h)
	key := snapshotName + "/" + conditionStepError
	require.Contains(t, h.report().Recoverable, key)
	require.Contains(t, h.report().Recoverable[key], "sweep batch: boom")
	require.False(t, h.report().Ready)

	rc = roundConditions{}
	require.True(t, stepSnapshotter(context.Background(), snap, &ss, rc))
	rc.publish(h)
	require.NotContains(t, h.report().Recoverable, key)
	require.True(t, h.report().Ready)
}

// A context cancellation is SHUTDOWN, not failure, in every pass.
func TestNonPricePassesTreatCancellationAsShutdown(t *testing.T) {
	h, clk := newTestHealth()
	w := (&fakeIngestWorker{name: "op:debt-manager"}).script(false, context.Canceled)
	ws := &walkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}
	r := (&fakeDeriveWorker{name: "debt_manager"}).script(false, context.Canceled)
	snap := (&fakeSnapshotWorker{}).script(false, context.Canceled)
	var ss snapshotState

	rc := roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	stepRunners(context.Background(), []*runnerState{{r: r}}, rc, h)
	stepSnapshotter(context.Background(), snap, &ss, rc)
	rc.publish(h)

	require.Zero(t, ws.bo.failures)
	require.Equal(t, "healthy", h.report().Status)
	require.True(t, h.report().Ready)
}

// B-WORKERS (THE SILENT STALL): a worker that neither errors nor advances says
// nothing at all. The verdict comes from DURABLE storage — when each cursor last
// moved — so a restart cannot grant a wedged worker a fresh window.
func TestApplyProgressConditionsFailsReadinessOnASilentStall(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	walkers := []*walkerState{{w: &fakeIngestWorker{name: "op:debt-manager"}}}
	runners := []*runnerState{{r: &fakeDeriveWorker{name: "debt_manager"}}}
	pr := &fakeProgress{
		ingest: []store.CursorProgress{
			{Name: "op:debt-manager", Block: 500, UpdatedAt: now.Add(-noProgressBound - time.Minute)},
			{Name: "eth:not-watched", Block: 1, UpdatedAt: now.Add(-999 * time.Hour)},
		},
		derive: []store.CursorProgress{
			{Name: "debt_manager", Block: 480, UpdatedAt: now.Add(-time.Minute)},
			// The price poller is deliberately NOT judged here: a frozen endpoint
			// re-applies the same execution block, which refreshes this timestamp
			// without progress. It has its own anchor-based condition.
			{Name: "prices:poll:10", Block: 5000, UpdatedAt: now.Add(-999 * time.Hour)},
		},
	}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, walkers, runners)
	rc.publish(h)

	rep := h.report()
	key := "op:debt-manager/" + conditionNoProgress
	require.Contains(t, rep.Recoverable, key)
	require.Contains(t, rep.Recoverable[key], "has not moved for")
	require.Contains(t, rep.Recoverable[key], "block 500")
	require.False(t, rep.Ready, "a silently stalled walker must fail readiness")
	require.NotContains(t, rep.Recoverable, "debt_manager/"+conditionNoProgress,
		"a runner that moved a minute ago is fine")
	require.NotContains(t, rep.Recoverable, "eth:not-watched/"+conditionNoProgress,
		"only configured workers are judged")
	require.NotContains(t, rep.Recoverable, "prices:poll:10/"+conditionNoProgress,
		"price workers are judged by their own conditions, not by a cursor timestamp a replay can refresh")

	// Once the cursor moves, it clears.
	pr.ingest[0].UpdatedAt = now
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, walkers, runners)
	rc.publish(h)
	require.NotContains(t, h.report().Recoverable, key)
}

// A step error and a no-progress verdict on the SAME worker must coexist:
// setWorkerConditions replaces by worker, so publishing from two passes separately
// would let one erase the other and the survivor would depend on pass order.
func TestRoundConditionsComposeStepErrorAndNoProgressTogether(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	w := (&fakeIngestWorker{name: "op:debt-manager"}).script(false, errors.New("boom"))
	walkers := []*walkerState{{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}}
	pr := &fakeProgress{ingest: []store.CursorProgress{
		{Name: "op:debt-manager", Block: 500, UpdatedAt: now.Add(-noProgressBound - time.Minute)},
	}}

	rc := roundConditions{}
	stepWalkers(context.Background(), walkers, rc)
	applyProgressConditions(context.Background(), pr, now, rc, walkers, nil)
	rc.publish(h)

	rep := h.report()
	require.Contains(t, rep.Recoverable, "op:debt-manager/"+conditionStepError)
	require.Contains(t, rep.Recoverable, "op:debt-manager/"+conditionNoProgress)
}

// A progress READ failure must not invent a stall: a fabricated signal is its own
// defect, and the workers' step errors already cover a database that is not
// answering.
func TestApplyProgressConditionsIssuesNoVerdictOnReadFailure(t *testing.T) {
	h, clk := newTestHealth()
	walkers := []*walkerState{{w: &fakeIngestWorker{name: "op:debt-manager"}}}
	pr := &fakeProgress{ingestErr: errors.New("database unreachable"), deriveErr: errors.New("database unreachable")}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.now(), rc, walkers, nil)
	rc.publish(h)
	require.Empty(t, h.report().Recoverable)
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
