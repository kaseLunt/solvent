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

// publishRound publishes one round's composed conditions and then CLOSES the round,
// in the order the daemon's loop does it (publish, then heartbeat).
//
// Every test that models more than one round goes through this rather than calling
// publish twice, because publishing the same worker twice inside ONE round is now a
// detected defect — the surface merges instead of replacing and logs an Error — and a
// test that tripped that path would be asserting against the safety net rather than
// against the daemon's actual behaviour.
func publishRound(h *healthState, rc roundConditions) {
	rc.publish(h)
	h.heartbeat()
}

// runPriceRound runs ONE price pass exactly as the daemon does: into the round's
// shared composition, published once with every other pass's verdicts.
//
// The price pass used to publish straight to the surface on its own, which is the
// regression this shape exists to prevent — the frontier pass publishes the same feed
// worker later in the round and replaced everything the price pass had reported.
func runPriceRound(h *healthState, states []*priceWorkerState) bool {
	rc := roundConditions{}
	advanced := stepPriceWorkers(context.Background(), states, rc)
	publishRound(h, rc)
	return advanced
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
	publishRound(h, roundConditions{"prices:poll:10": {
		conditionStepError: "apply prices: boom",
	}})
	require.False(t, h.markInitialized(), "a failing worker defers initialisation")
	require.Equal(t, "starting", h.report().Status)

	// Nor can a round with a terminal engine error.
	publishRound(h, roundConditions{"prices:poll:10": nil})
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
	publishRound(h2, roundConditions{"prices:poll:10": {conditionStepError: "boom"}})
	r = h2.report()
	require.Equal(t, "degraded", r.Status)
	require.NotContains(t, r.Recoverable, startupWorker+"/"+conditionStartup)
	_, _ = clk, clk2
}

// A worker whose name happens to collide with the startup entry's prefix cannot
// clear it: the startup state lives in its own field, not in the recoverable map
// that publication replaces by prefix. Stream names come from config and
// legitimately contain colons, so this is a real collision surface.
func TestHealthStartupConditionSurvivesWorkerNamedLikeIt(t *testing.T) {
	h, _ := newStartingTestHealth()
	publishRound(h, roundConditions{startupWorker: nil})
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
	publishRound(h, roundConditions{"prices:poll:10": {
		prices.ConditionPollTargetFreshness: "3 of 20 assets stale",
	}})

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
	publishRound(h, roundConditions{"prices:chainlink_feed:1": {
		prices.ConditionFeedPublication: "USDC stale",
		prices.ConditionRPCIngestLag:    "no confirmed live head",
	}})

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
	publishRound(h, roundConditions{"a": {"x": "1", "y": "2"}})
	publishRound(h, roundConditions{"b": {"x": "3"}})
	require.Len(t, h.report().Recoverable, 3)

	publishRound(h, roundConditions{"a": {"y": "2b"}})
	r := h.report()
	require.Equal(t, map[string]string{"a/y": "2b", "b/x": "3"}, r.Recoverable,
		"a's stale entry is gone, b's is untouched")

	publishRound(h, roundConditions{"a": nil})
	publishRound(h, roundConditions{"b": nil})
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
	publishRound(h, roundConditions{"prices:poll:10": nil})
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

	advanced := runPriceRound(h, []*priceWorkerState{ps})
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

	runPriceRound(h, []*priceWorkerState{ps})
	require.Equal(t, 1, w.calls)

	// Inside the backoff window: no Step is attempted, but the surface still
	// reports both the worker's own condition and the step error.
	runPriceRound(h, []*priceWorkerState{ps})
	require.Equal(t, 1, w.calls, "the backoff held: no extra Step")
	r := h.report()
	require.Contains(t, r.Recoverable, "prices:chainlink_feed:1/"+prices.ConditionFeedPublication)
	require.Contains(t, r.Recoverable, "prices:chainlink_feed:1/"+conditionStepError)

	// Past the deadline it retries.
	clk.advance(retryBackoffBase * 2)
	runPriceRound(h, []*priceWorkerState{ps})
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

	runPriceRound(h, []*priceWorkerState{ps})
	require.False(t, h.report().Ready)
	require.Equal(t, 1, ps.bo.failures)

	clk.advance(retryBackoffBase * 2)
	w.conds = nil // the poller landed a round
	advanced := runPriceRound(h, []*priceWorkerState{ps})
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
		runPriceRound(h, []*priceWorkerState{ps})
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

	runPriceRound(h, []*priceWorkerState{ps})
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

	require.True(t, runPriceRound(h, []*priceWorkerState{ps}))
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

	require.True(t, runPriceRound(h, states))
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
	calls int
	lag   uint64
	// head is the chain head this walker last observed, and headSeen whether it has
	// observed one. They are what a CONSUMER's end-to-end distance is measured from,
	// so a fake that only carried a lag could not express the composition case at all.
	head     uint64
	headSeen bool
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

func (f *fakeIngestWorker) ObservedHead() (uint64, bool) { return f.head, f.headSeen }

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

// fakeProgress serves durable cursor and sweep progress.
type fakeProgress struct {
	ingest    []store.CursorProgress
	derive    []store.CursorProgress
	ingestErr error
	deriveErr error
	// sweep is the snapshotter's durable generation state; sweepFound=false models
	// an engine that has never opened a generation.
	sweep      store.SweepProgress
	sweepFound bool
	sweepErr   error
	sweepCalls []string
	// sweepBudgets records the attempt budget each SweepProgress call was given, so a
	// test can prove the daemon asks the store the same question the snapshotter does
	// rather than assuming a budget of its own.
	sweepBudgets []int
}

func (f *fakeProgress) IngestCursorProgress(context.Context) ([]store.CursorProgress, error) {
	return f.ingest, f.ingestErr
}

func (f *fakeProgress) DeriveCursorProgress(context.Context) ([]store.CursorProgress, error) {
	return f.derive, f.deriveErr
}

func (f *fakeProgress) SweepProgress(_ context.Context, engine string, maxAttempts int) (store.SweepProgress, bool, error) {
	f.sweepCalls = append(f.sweepCalls, engine)
	f.sweepBudgets = append(f.sweepBudgets, maxAttempts)
	return f.sweep, f.sweepFound, f.sweepErr
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
	publishRound(h, rc)

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
	publishRound(h, rc)
	require.Equal(t, 1, w.calls, "the backoff held")
	require.Contains(t, h.report().Recoverable, key)

	clk.advance(retryBackoffCap * 2)
	rc = roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	publishRound(h, rc)
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
	w := &fakeIngestWorker{name: "eth:feed-usdc", lag: chainLagBound(1) + 1, lagSeen: true}
	ws := &walkerState{w: w, chainID: 1, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}

	rc := roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	publishRound(h, rc)
	key := "eth:feed-usdc/" + conditionHeadLag
	require.Contains(t, h.report().Recoverable, key)
	require.Contains(t, h.report().Recoverable[key], "blocks behind the chain head")
	require.False(t, h.report().Ready)

	// Caught up: cleared.
	w.lag = 3
	rc = roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	publishRound(h, rc)
	require.NotContains(t, h.report().Recoverable, key)

	// A walker that has never observed a head reports nothing here — its Step
	// error is the signal instead.
	w.lagSeen = false
	rc = roundConditions{}
	stepWalkers(context.Background(), []*walkerState{ws}, rc)
	publishRound(h, rc)
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
	publishRound(h, rc)

	rep := h.report()
	require.False(t, rep.Ready)
	require.Equal(t, "unhealthy", rep.Status, "a terminal entry outranks the recoverable one")
	require.Contains(t, rep.Recoverable, "debt_manager/"+conditionStepError)
	require.Contains(t, rep.Recoverable["debt_manager/"+conditionStepError], "1 consecutive round(s)")
	require.Contains(t, rep.Terminal, "aave_v3_etherfi")

	// The recoverable class recovers; the terminal one deliberately does not.
	rc = roundConditions{}
	stepRunners(context.Background(), states, rc, h)
	publishRound(h, rc)
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
	publishRound(h, rc)
	key := snapshotName + "/" + conditionStepError
	require.Contains(t, h.report().Recoverable, key)
	require.Contains(t, h.report().Recoverable[key], "sweep batch: boom")
	require.False(t, h.report().Ready)

	rc = roundConditions{}
	require.True(t, stepSnapshotter(context.Background(), snap, &ss, rc))
	publishRound(h, rc)
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
	publishRound(h, rc)

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
	applyProgressConditions(context.Background(), pr, now, rc, progressWatch{walkers: walkers, runners: runners})
	publishRound(h, rc)

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
	applyProgressConditions(context.Background(), pr, now, rc, progressWatch{walkers: walkers, runners: runners})
	publishRound(h, rc)
	require.NotContains(t, h.report().Recoverable, key)
}

// A step error and a no-progress verdict on the SAME worker must coexist:
// publication replaces by worker, so publishing from two passes separately would let
// one erase the other and the survivor would depend on pass order.
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
	applyProgressConditions(context.Background(), pr, now, rc, progressWatch{walkers: walkers})
	publishRound(h, rc)

	rep := h.report()
	require.Contains(t, rep.Recoverable, "op:debt-manager/"+conditionStepError)
	require.Contains(t, rep.Recoverable, "op:debt-manager/"+conditionNoProgress)
}

// THE REGRESSION WAVE 4 INTRODUCED, and the only test in this file that runs a whole
// daemon round in the daemon's own pass order.
//
// The Chainlink feed deriver is claimed by TWO passes: it is a price worker (the price
// pass publishes its staleness, timestamp, RPC-lag and step_error conditions) and it
// is a raw-log CONSUMER (the frontier pass registers it, because it reads
// AnswerUpdated back out of raw_logs). While the price pass published straight to the
// surface, the frontier pass ran afterwards and REPLACED that worker's entries —
// deleting every condition the price pass had just reported. With no frontier lag the
// feed worker went completely clean; with frontier lag it was left carrying only
// frontier_lag. Either way /readyz could answer 200, and markInitialized could clear
// startup, in the same round a feed Step failed.
//
// Both passes now compose into one round and publish once. This asserts the two
// conditions Codex named — a feed step_error and a publication-staleness verdict —
// survive BOTH the no-lag pass and the frontier-lag pass.
func TestFeedWorkerConditionsSurviveTheFrontierPass(t *testing.T) {
	feed := "prices:chainlink_feed:1"
	stepErrKey := feed + "/" + conditionStepError
	staleKey := feed + "/" + prices.ConditionFeedPublication

	// The feed deriver fails its Step AND reports a stale stream — the state an
	// operator most needs to see, and the one that used to vanish.
	newFeedState := func(clk *fakeClock) *priceWorkerState {
		w := newFakeWorker(feed).script(false, errors.New("derive feed window [100,200]: boom"))
		w.conds = []prices.Condition{
			{Name: prices.ConditionFeedPublication, Reason: "USDC has not published within its heartbeat"},
		}
		return &priceWorkerState{w: w, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}
	}
	watch := progressWatch{consumers: []frontierWatch{
		{worker: feed, streams: []string{"eth:feed-usdc"}, chainID: 1},
	}}

	// runRound is the daemon's inner loop for these two passes, in its real order:
	// the price pass first, the progress/frontier pass second, ONE publication.
	runRound := func(h *healthState, ps *priceWorkerState, pr *fakeProgress, now time.Time) {
		rc := roundConditions{}
		stepPriceWorkers(context.Background(), []*priceWorkerState{ps}, rc)
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)
	}

	t.Run("no frontier lag: the feed conditions used to be erased entirely", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		// The consumer is exactly AT its frontier, so the frontier pass has no verdict
		// of its own to publish — which is precisely when it used to publish an EMPTY
		// entry set for this worker and delete everything.
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: feed, Block: 21_000_000, UpdatedAt: now}},
		}
		runRound(h, newFeedState(clk), pr, now)

		rep := h.report()
		require.Contains(t, rep.Recoverable, stepErrKey, "the feed Step failure survived the frontier pass")
		require.Contains(t, rep.Recoverable[stepErrKey], "boom")
		require.Contains(t, rep.Recoverable, staleKey, "and so did the publication-staleness verdict")
		require.NotContains(t, rep.Recoverable, feed+"/"+conditionFrontierLag,
			"there is no lag to report — the point is that its ABSENCE erases nothing")
		require.False(t, rep.Ready, "/readyz must fail in the round a feed Step failed")
	})

	t.Run("frontier lag present: they used to be replaced by frontier_lag alone", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: feed, Block: 20_000_000, UpdatedAt: now}},
		}
		runRound(h, newFeedState(clk), pr, now)

		rep := h.report()
		require.Contains(t, rep.Recoverable, feed+"/"+conditionFrontierLag, "the frontier verdict is reported")
		require.Contains(t, rep.Recoverable, stepErrKey, "AND the feed Step failure is still there")
		require.Contains(t, rep.Recoverable, staleKey, "AND the publication verdict is still there")
		require.False(t, rep.Ready)
	})

	t.Run("startup cannot clear in a round a feed Step failed", func(t *testing.T) {
		// The composition matters for more than the report: markInitialized derives its
		// decision from the surface, so a deleted step_error let a daemon whose feed
		// deriver had never completed a round declare itself initialised.
		h, clk := newStartingTestHealth()
		now := clk.now()
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: feed, Block: 21_000_000, UpdatedAt: now}},
		}
		runRound(h, newFeedState(clk), pr, now)
		require.False(t, h.markInitialized(), "a worker that could not Step must defer initialisation")
		require.Equal(t, "starting", h.report().Status)
	})
}

// THE STRUCTURAL GUARD, tested as itself. Composing into one round is what fixes the
// regression above; this is what stops the next publisher from reintroducing it. If a
// worker is published twice inside ONE round the surface MERGES rather than replaces,
// so the earlier pass's signal cannot be deleted — and replacement resumes on the next
// round, so recovery is still visible.
func TestPublishingAWorkerTwiceInOneRoundMergesInsteadOfErasing(t *testing.T) {
	h, _ := newTestHealth()

	// Pass one reports a step error. Pass two — a hypothetical future publisher that
	// forgot to compose — publishes the same worker with only its own verdict.
	roundConditions{"prices:chainlink_feed:1": {conditionStepError: "boom"}}.publish(h)
	roundConditions{"prices:chainlink_feed:1": {conditionFrontierLag: "900000 blocks behind"}}.publish(h)

	rep := h.report()
	require.Contains(t, rep.Recoverable, "prices:chainlink_feed:1/"+conditionStepError,
		"a second publication in the same round must not delete the first pass's signal")
	require.Contains(t, rep.Recoverable, "prices:chainlink_feed:1/"+conditionFrontierLag)

	// On the NEXT round, replacement is back: recovery must still be visible, or a
	// resolved condition would stick forever.
	h.heartbeat()
	roundConditions{"prices:chainlink_feed:1": nil}.publish(h)
	require.Empty(t, h.report().Recoverable, "a new round replaces, so a cleared condition clears")
}

// A progress READ failure must not invent a stall: a fabricated signal is its own
// defect, and the workers' step errors already cover a database that is not
// answering.
func TestApplyProgressConditionsIssuesNoVerdictOnReadFailure(t *testing.T) {
	h, clk := newTestHealth()
	walkers := []*walkerState{{w: &fakeIngestWorker{name: "op:debt-manager"}}}
	pr := &fakeProgress{
		ingestErr: errors.New("database unreachable"),
		deriveErr: errors.New("database unreachable"),
		sweepErr:  errors.New("database unreachable"),
	}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.now(), rc,
		progressWatch{walkers: walkers, sweepEngine: "debt_manager"})
	publishRound(h, rc)
	require.Empty(t, h.report().Recoverable)
}

// SNAPSHOT: the SEMANTIC stall. When every RPC endpoint serves sweep batches at an
// execution block behind the accounts' recorded successes, the store refuses each
// one, Step returns (false, nil) — no error, no advance — and it can do that
// forever. The wrapper's failure bookkeeping treats every nil error as recovery, the
// snapshotter has no ingest or derive cursor for the generic pass to watch, and the
// only signal was a warning log: /readyz answered 200 indefinitely while collateral
// snapshots stopped advancing.
//
// This drives Codex's exact scenario — every endpoint repeatedly produces stale
// sweep batches returning (false, nil) — and asserts readiness goes red.
func TestSnapshotSemanticStallFailsReadiness(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	opened := now.Add(-noProgressBound - 5*time.Minute)

	// Every round: the batch is refused as stale, so Step reports neither an error
	// nor an advance. The wrapper therefore records NOTHING.
	snap := &fakeSnapshotWorker{}
	var ss snapshotState
	rc := roundConditions{}
	for i := 0; i < 6; i++ {
		require.False(t, stepSnapshotter(context.Background(), snap, &ss, rc),
			"a wholesale-stale batch advances nothing, round %d", i)
	}
	require.Nil(t, ss.lastErr, "and it is not an error either — which is exactly why nothing was reported")
	require.NotContains(t, rc[snapshotName], conditionStepError)

	// The DURABLE state is what catches it: the generation is still OPEN and the
	// newest sweep status predates it.
	pr := &fakeProgress{
		sweepFound: true,
		sweep: store.SweepProgress{
			Generation: 7, Open: true, OpenedAt: opened,
			LastBatchAt: opened.Add(-time.Hour), Lagging: 3,
		},
	}
	applyProgressConditions(context.Background(), pr, now, rc, progressWatch{sweepEngine: "debt_manager"})
	publishRound(h, rc)

	rep := h.report()
	key := snapshotName + "/" + conditionNoProgress
	require.Contains(t, rep.Recoverable, key)
	require.Contains(t, rep.Recoverable[key], "generation 7 has been OPEN")
	require.Contains(t, rep.Recoverable[key], "without landing a batch")
	require.False(t, rep.Ready, "/readyz must fail while collateral snapshot ingestion is stalled")
	require.Equal(t, []string{"debt_manager"}, pr.sweepCalls)

	// A landed batch clears it: this class is recoverable.
	pr.sweep.LastBatchAt = now.Add(-time.Minute)
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, progressWatch{sweepEngine: "debt_manager"})
	publishRound(h, rc)
	require.NotContains(t, h.report().Recoverable, key)
}

// SNAPSHOT: a CLOSED generation is idle by cadence, not stalled — the snapshot
// interval can legitimately exceed noProgressBound — and an engine that has never
// opened a generation has not started rather than stopped. Neither may fire, or the
// gate would be red on every healthy deployment between sweeps.
func TestSnapshotProgressDoesNotFireBetweenGenerations(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()

	for _, tc := range []struct {
		name  string
		found bool
		sweep store.SweepProgress
	}{
		{"closed generation waiting on the cadence", true, store.SweepProgress{
			Generation: 4, Open: false,
			OpenedAt: now.Add(-48 * time.Hour), CompletedAt: now.Add(-24 * time.Hour),
			LastBatchAt: now.Add(-24 * time.Hour),
		}},
		{"no generation ever opened", false, store.SweepProgress{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pr := &fakeProgress{sweepFound: tc.found, sweep: tc.sweep}
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, now, rc, progressWatch{sweepEngine: "debt_manager"})
			publishRound(h, rc)
			require.NotContains(t, h.report().Recoverable, snapshotName+"/"+conditionNoProgress)
		})
	}
}

// FRONTIER: readiness must require a raw-log CONSUMER to have caught up to its own
// input frontier, not merely to have moved recently.
//
// A worker advancing small backfill windows refreshes derive_cursors.updated_at
// every round, so no_progress never fires however stale it is; head_lag does not
// cover it either, because the walker feeding it can be exactly at the chain head.
// Wave 3's report claimed not-ready-until-chain-head behaviour and that was FALSE as
// implemented — the progress check only looked at recency. This is the gate that
// makes it true for consumers, and it names precisely what it measures: distance
// from the durable minimum ingest cursor of the streams that feed the worker.
func TestFrontierLagFailsReadinessWhenDerivationIsBehindItsInput(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()

	// Raw logs are AT HEAD and the runner's cursor moved a second ago — so both
	// head_lag and no_progress are silent — but derivation is 900k blocks behind.
	pr := &fakeProgress{
		ingest: []store.CursorProgress{
			{Name: "eth:aave-etherfi", Block: 21_000_000, UpdatedAt: now},
			{Name: "eth:atoken-weeth", Block: 20_999_000, UpdatedAt: now},
		},
		derive: []store.CursorProgress{
			{Name: "aave_v3_etherfi", Block: 20_100_000, UpdatedAt: now.Add(-time.Second)},
		},
	}
	watch := progressWatch{
		runners: []*runnerState{{r: &fakeDeriveWorker{name: "aave_v3_etherfi"}}},
		consumers: []frontierWatch{
			{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi", "eth:atoken-weeth"}, chainID: 1},
		},
	}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)

	rep := h.report()
	key := "aave_v3_etherfi/" + conditionFrontierLag
	require.Contains(t, rep.Recoverable, key)
	require.Contains(t, rep.Recoverable[key], "899000 blocks behind")
	require.Contains(t, rep.Recoverable[key], "20999000",
		"the frontier is the MINIMUM stream cursor: above it some stream's logs may be missing")
	require.False(t, rep.Ready, "a process whose derived state is not current is not ready")
	require.NotContains(t, rep.Recoverable, "aave_v3_etherfi/"+conditionNoProgress,
		"and no_progress is silent, which is exactly why this gate had to exist")

	// Caught up to within the bound: it clears.
	pr.derive[0].Block = 20_999_000 - chainLagBound(1)
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	require.NotContains(t, h.report().Recoverable, key)
	require.True(t, h.report().Ready)
}

// FRONTIER: the price FEED deriver is a raw-log consumer too — it reads
// AnswerUpdated back out of raw_logs — and it is NOT a derive.Runner, so it has to
// be registered explicitly or it would be missed. Codex's finding named price
// workers as excluded outright.
func TestFrontierLagCoversTheFeedDeriver(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	pr := &fakeProgress{
		ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
		derive: []store.CursorProgress{{Name: "prices:chainlink_feed:1", Block: 20_000_000, UpdatedAt: now}},
	}
	watch := progressWatch{consumers: []frontierWatch{
		{worker: "prices:chainlink_feed:1", streams: []string{"eth:feed-usdc"}, chainID: 1},
	}}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	require.Contains(t, h.report().Recoverable, "prices:chainlink_feed:1/"+conditionFrontierLag)
	require.False(t, h.report().Ready)
}

// FRONTIER: the two states the gate deliberately does not judge, because judging
// them would mean inventing a distance. A stream with no ingest cursor has no
// frontier to be behind, and a consumer with no derive cursor has no height to
// compare — its first Step either creates one or reports step_error, and the
// daemon's startup condition holds readiness closed until a full round completes.
//
// The POLLER is absent by construction rather than by exclusion: it reads `latest`
// through eth_call and has no raw-log input at all, so there is no frontier for it.
func TestFrontierLagIssuesNoVerdictWithoutBothCursors(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()

	t.Run("a feeding stream has never ingested", func(t *testing.T) {
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: 1, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{consumers: []frontierWatch{
			{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi", "eth:atoken-weeth"}, chainID: 1},
		}})
		publishRound(h, rc)
		require.NotContains(t, h.report().Recoverable, "aave_v3_etherfi/"+conditionFrontierLag)
	})

	t.Run("the consumer has no cursor yet", func(t *testing.T) {
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 21_000_000, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{consumers: []frontierWatch{
			{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi"}, chainID: 1},
		}})
		publishRound(h, rc)
		require.NotContains(t, h.report().Recoverable, "aave_v3_etherfi/"+conditionFrontierLag)
	})

	t.Run("a price poller is never registered as a consumer", func(t *testing.T) {
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "op:debt-manager", Block: 150_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: "prices:poll:10", Block: 1, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{consumers: []frontierWatch{
			{worker: "aave_v3_etherfi", streams: []string{"op:debt-manager"}, chainID: 10},
		}})
		publishRound(h, rc)
		require.NotContains(t, h.report().Recoverable, "prices:poll:10/"+conditionFrontierLag)
	})
}

// LAG COMPOSITION — the boundary case. Two locally-defensible per-hop bounds do not
// bound a path. With walker-to-head and consumer-to-frontier each allowed 5,000
// blocks, and each comparison permitting equality, a walker exactly at its limit
// feeding a consumer exactly at its limit was reported READY about 10,000 blocks
// behind head: roughly 33 hours of Ethereum for a liquidation-facing table.
//
// This drives exactly that arrangement — MAXIMUM permitted walker lag combined with
// MAXIMUM permitted consumer lag — and asserts readiness now fails, because the
// consumer is judged on its distance from the chain HEAD rather than from a frontier
// that is itself allowed to be stale.
func TestLagBoundsDoNotComposeIntoAWiderTotal(t *testing.T) {
	const chainID = uint64(1)
	bound := chainLagBound(chainID)
	require.Positive(t, bound)

	// One walker on chain 1, at exactly its permitted lag: head 21,000,000, cursor
	// `bound` behind it. head_lag therefore does NOT fire for the walker.
	head := uint64(21_000_000)
	frontier := head - bound
	newWatch := func(clk *fakeClock, w *fakeIngestWorker) (progressWatch, *walkerState) {
		ws := &walkerState{w: w, chainID: chainID,
			bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}
		return progressWatch{
			walkers: []*walkerState{ws},
			consumers: []frontierWatch{
				{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi"}, chainID: chainID},
			},
		}, ws
	}

	t.Run("each hop at its limit was ready and must not be", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		w := &fakeIngestWorker{name: "eth:aave-etherfi", lag: bound, lagSeen: true, head: head, headSeen: true}
		watch, ws := newWatch(clk, w)
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: frontier, UpdatedAt: now}},
			// The consumer sits its OWN full allowance below that frontier.
			derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: frontier - bound, UpdatedAt: now}},
		}

		rc := roundConditions{}
		require.False(t, stepWalkers(context.Background(), []*walkerState{ws}, rc))
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		require.NotContains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionHeadLag,
			"the walker is at its limit, not past it — each hop really is individually within bounds")
		key := "aave_v3_etherfi/" + conditionHeadLag
		require.Contains(t, rep.Recoverable, key,
			"but the PATH is 2x the bound from head, which is the composition that used to read as ready")
		require.Contains(t, rep.Recoverable[key], fmt.Sprintf("%d blocks behind the chain head", 2*bound))
		require.Contains(t, rep.Recoverable[key], "of that gap is ingestion",
			"the message attributes the distance across the two hops so an operator knows which to chase")
		require.False(t, rep.Ready, "derived state 2x the freshness bound behind head is not ready")
	})

	t.Run("a caught-up consumer behind a caught-up walker stays ready", func(t *testing.T) {
		// The gate must not simply be red always: a consumer AT its frontier, behind a
		// walker at its own permitted lag, is exactly at the bound and equality passes.
		h, clk := newTestHealth()
		now := clk.now()
		w := &fakeIngestWorker{name: "eth:aave-etherfi", lag: bound, lagSeen: true, head: head, headSeen: true}
		watch, ws := newWatch(clk, w)
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: frontier, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: frontier, UpdatedAt: now}},
		}

		rc := roundConditions{}
		stepWalkers(context.Background(), []*walkerState{ws}, rc)
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		require.NotContains(t, rep.Recoverable, "aave_v3_efi/"+conditionHeadLag)
		require.Empty(t, rep.Recoverable, "everything is inside the one bound, measured from head")
		require.True(t, rep.Ready)
	})

	t.Run("one block past the bound, from either hop, fails", func(t *testing.T) {
		for _, tc := range []struct {
			name             string
			walkerLag, extra uint64
		}{
			{"the walker is one block too far behind head", bound + 1, 0},
			{"the consumer is one block too far behind the frontier", bound, 1},
		} {
			t.Run(tc.name, func(t *testing.T) {
				h, clk := newTestHealth()
				now := clk.now()
				w := &fakeIngestWorker{name: "eth:aave-etherfi", lag: tc.walkerLag, lagSeen: true,
					head: head, headSeen: true}
				watch, ws := newWatch(clk, w)
				pr := &fakeProgress{
					ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: head - tc.walkerLag, UpdatedAt: now}},
					derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: head - tc.walkerLag - tc.extra, UpdatedAt: now}},
				}
				rc := roundConditions{}
				stepWalkers(context.Background(), []*walkerState{ws}, rc)
				applyProgressConditions(context.Background(), pr, now, rc, watch)
				publishRound(h, rc)
				require.False(t, h.report().Ready)
			})
		}
	})

	t.Run("the bound is chain-specific and derived from the stated requirement", func(t *testing.T) {
		// The requirement is a TIME; the block counts are only its per-chain
		// expression, and a faster chain must therefore allow MORE blocks for the same
		// staleness. A single shared constant cannot express that at all.
		require.Equal(t, uint64(maxDerivedStaleness/(12*time.Second)), chainLagBound(1))
		require.Equal(t, uint64(maxDerivedStaleness/(2*time.Second)), chainLagBound(10))
		require.Greater(t, chainLagBound(10), chainLagBound(1),
			"OP's 2s blocks mean the same wall-clock staleness is more blocks")
		require.Equal(t, uint64(maxDerivedStaleness/fallbackBlockTime), chainLagBound(999_999),
			"an unlisted chain falls back to the SLOWEST configured block time, which is the tightest bound")
	})
}

// SNAPSHOT FAILURES: "closed" is not "succeeded".
//
// CompleteSweepGeneration stamps a generation complete once no account still owes
// work — which includes accounts that exhausted their retry budget and stayed
// status='failed' — and reports them only through a WARN. Per-account failures return
// nil from ApplySweepBatch, so no step_error appears either. The progress gate
// returned immediately for EVERY closed generation, so readiness went green the moment
// a degraded sweep closed, while named borrowers had no current collateral snapshot
// until the next generation opened.
func TestSnapshotExhaustedFailuresFailReadinessEvenWhenTheGenerationClosed(t *testing.T) {
	watch := progressWatch{sweepEngine: "debt_manager", sweepMaxAttempts: 4}
	key := snapshotName + "/" + conditionSnapshotFailures

	t.Run("a CLOSED degraded generation is not healthy", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
			Generation: 7, Open: false,
			OpenedAt:    now.Add(-2 * time.Hour),
			CompletedAt: now.Add(-90 * time.Minute),
			LastBatchAt: now.Add(-90 * time.Minute),
			// A generation cannot close while an account still has retry budget, so a
			// closed generation's failures are all exhausted — which is the real store
			// state TestSweepProgressReportsExhaustedFailuresThroughGenerationClose
			// drives end to end.
			Failed: 3, Exhausted: 3,
			LastSuccessAt: now.Add(-90 * time.Minute),
		}}

		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		require.Contains(t, rep.Recoverable, key)
		require.Contains(t, rep.Recoverable[key], "generation 7")
		require.Contains(t, rep.Recoverable[key], "spent the 4-attempt retry budget")
		require.Contains(t, rep.Recoverable[key], "was CLOSED",
			"the reason states the thing that was being read as success")
		require.Contains(t, rep.Recoverable[key], "1h30m0s ago", "and how stale the surviving snapshots are")
		require.False(t, rep.Ready, "/readyz must fail while collateral snapshots are missing or stale")
		require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionNoProgress,
			"a closed generation is still idle-by-cadence rather than stalled: the two verdicts are distinct")
		require.Equal(t, []int{4}, pr.sweepBudgets,
			"the daemon asks the store with the snapshotter's own budget, not one of its own")
	})

	t.Run("an OPEN generation fires as soon as an account burns its budget", func(t *testing.T) {
		// It does not wait for the close: the account is already stuck for the rest of
		// this generation, and the close may be a whole batch queue away.
		h, clk := newTestHealth()
		now := clk.now()
		pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
			Generation: 8, Open: true,
			OpenedAt: now.Add(-time.Minute), LastBatchAt: now.Add(-time.Second),
			Failed: 2, Exhausted: 1, LastSuccessAt: now.Add(-time.Second),
		}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		require.Contains(t, rep.Recoverable, key)
		require.Contains(t, rep.Recoverable[key], "1 of 2 account(s)")
		require.Contains(t, rep.Recoverable[key], "still OPEN")
		require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionNoProgress,
			"batches are landing, so this is a failure verdict and not a stall verdict")
		require.False(t, rep.Ready)
	})

	t.Run("failures still inside the retry budget are in flight, not unresolved", func(t *testing.T) {
		// Reporting these would make the gate red through every ordinary transient
		// revert, which is the false-positive direction. They become visible the moment
		// the budget is spent.
		h, clk := newTestHealth()
		now := clk.now()
		pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
			Generation: 9, Open: true,
			OpenedAt: now.Add(-time.Minute), LastBatchAt: now.Add(-time.Second),
			Failed: 2, Exhausted: 0, LastSuccessAt: now.Add(-time.Second),
		}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)
		require.NotContains(t, h.report().Recoverable, key)
		require.True(t, h.report().Ready)
	})

	t.Run("a clean generation, open or closed, reports nothing", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
			Generation: 10, Open: false,
			OpenedAt: now.Add(-2 * time.Hour), CompletedAt: now.Add(-time.Hour),
			LastBatchAt: now.Add(-time.Hour), LastSuccessAt: now.Add(-time.Hour),
		}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)
		require.Empty(t, h.report().Recoverable)
		require.True(t, h.report().Ready)
	})

	t.Run("a never-swept engine has not started, so it fails nothing", func(t *testing.T) {
		h, clk := newTestHealth()
		rc := roundConditions{}
		applyProgressConditions(context.Background(), &fakeProgress{}, clk.now(), rc, watch)
		publishRound(h, rc)
		require.Empty(t, h.report().Recoverable)
	})
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
	runPriceRound(h, []*priceWorkerState{ps})

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
