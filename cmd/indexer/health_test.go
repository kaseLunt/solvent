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
	// sweepBounds records the collateral staleness bound each call was given, for the
	// same reason: the bound is derived from the deployment's achieved cadence, and a
	// test must be able to prove the derived value is what actually reaches the store.
	sweepBounds []time.Duration
}

func (f *fakeProgress) IngestCursorProgress(context.Context) ([]store.CursorProgress, error) {
	return f.ingest, f.ingestErr
}

func (f *fakeProgress) DeriveCursorProgress(context.Context) ([]store.CursorProgress, error) {
	return f.derive, f.deriveErr
}

func (f *fakeProgress) SweepProgress(_ context.Context, engine string, maxAttempts int, staleBound time.Duration) (store.SweepProgress, bool, error) {
	f.sweepCalls = append(f.sweepCalls, engine)
	f.sweepBudgets = append(f.sweepBudgets, maxAttempts)
	f.sweepBounds = append(f.sweepBounds, staleBound)
	return f.sweep, f.sweepFound, f.sweepErr
}

// ---------------------------------------------------------------------------
// The block→time harness for the elapsed-time freshness gate.
// ---------------------------------------------------------------------------

// fakeHeaderTimes is the chain the staleness gate measures against: a
// (chain, block) → header-timestamp table, per-chain failure injection, and a CALL
// LOG.
//
// ITS SCHEDULE IS DELIBERATELY NONLINEAR, and that is the point of the harness
// rather than a detail of it. A fake returning base + block×12s would make elapsed
// time a strictly increasing linear function of block distance, so every test below
// would pass equally well against the BLOCK-COUNT predicate this wave removes — the
// tests would prove nothing about the change. This one models the real degradation
// instead: a stretch of MISSED SLOTS in which the chain produced very few blocks
// over a long wall-clock interval, so a small block distance spans a large elapsed
// time. That is the arrangement in which the old gate read green and the state
// served was hours old, and it is why seedMissedSlots exists.
//
// The CALL LOG carries the legs that are assertions about work NOT done: the
// per-round memo, the cross-round retained stamp, the fetch cooldown and the
// restamp throttle are all "no fetch happened here", which no verdict can express.
type fakeHeaderTimes struct {
	// at maps (chain, block) → header timestamp in unix seconds.
	at map[stampKey]uint64
	// fail, when set for a chain, fails every fetch on that chain.
	fail map[uint64]error
	// calls records every fetch attempt in order.
	calls []stampKey
}

func newFakeHeaderTimes() *fakeHeaderTimes {
	return &fakeHeaderTimes{at: map[stampKey]uint64{}, fail: map[uint64]error{}}
}

// set records one block's header timestamp.
func (f *fakeHeaderTimes) set(chainID, block uint64, t time.Time) *fakeHeaderTimes {
	f.at[stampKey{chainID: chainID, block: block}] = uint64(t.Unix())
	return f
}

// fetch is the headerTimeFetcher the judge drives.
func (f *fakeHeaderTimes) fetch(_ context.Context, chainID, block uint64) (uint64, error) {
	f.calls = append(f.calls, stampKey{chainID: chainID, block: block})
	if err := f.fail[chainID]; err != nil {
		return 0, err
	}
	secs, ok := f.at[stampKey{chainID: chainID, block: block}]
	if !ok {
		return 0, fmt.Errorf("fake has no header for block %d on chain %d", block, chainID)
	}
	return secs, nil
}

// seedMissedSlots lays down a DEGRADED stretch: `blocks` blocks ending at
// `headBlock`, whose header timestamps are `span` apart in total rather than at the
// chain's nominal cadence, with the newest stamped at headTime.
//
// On Ethereum's 12-second slots, 40 blocks nominally span 8 minutes — comfortably
// inside the ten-minute requirement, and comfortably inside the 50-block allowance
// the deleted gate used. Under heavy slot misses those same 40 blocks can span half
// an hour, and the deleted gate could not tell the two apart because it never
// looked at a timestamp. Every elapsed-time test below sits in that gap on purpose:
// each one would PASS against a block-count predicate and FAILS against the real
// one.
func (f *fakeHeaderTimes) seedMissedSlots(chainID, headBlock uint64, blocks int, span time.Duration, headTime time.Time) *fakeHeaderTimes {
	step := span / time.Duration(blocks)
	for i := 0; i <= blocks; i++ {
		f.set(chainID, headBlock-uint64(i), headTime.Add(-time.Duration(i)*step))
	}
	return f
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

// NOTE: TestStepWalkersReportsHeadLag was retired with the head_lag condition it
// pinned. It asserted a BLOCK DISTANCE from a head the walker held in memory, and
// both halves of that are gone: the freshness bound is now measured in elapsed time
// from the walker's own durable cursor block, by the progress pass rather than by
// stepWalkers. The property it protected — a walker that advances every round can
// still be too far behind to serve — is carried by
// TestWalkerStalenessFiresWhileTheWalkerIsAdvancing, which additionally FALSIFIES
// the block-distance reading it used to encode.

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
	// The chain schedule is shared by every leg: block 21,000,000 is stamped NOW and
	// the 40 blocks below it span half an hour of missed slots, so a consumer 40
	// blocks back is measurably stale while a consumer at the tip is measurably fresh.
	newWatch := func(now time.Time) (progressWatch, *fakeHeaderTimes) {
		hdr := newFakeHeaderTimes().seedMissedSlots(1, 21_000_000, 40, 30*time.Minute, now)
		return progressWatch{
			consumers: []frontierWatch{
				{worker: feed, streams: []string{"eth:feed-usdc"}, chainID: 1},
			},
			staleness: newStalenessJudge(hdr.fetch),
		}, hdr
	}

	// runRound is the daemon's inner loop for these two passes, in its real order:
	// the price pass first, the progress/frontier pass second, ONE publication.
	runRound := func(h *healthState, ps *priceWorkerState, pr *fakeProgress, watch progressWatch, now time.Time) {
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
		watch, _ := newWatch(now)
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: feed, Block: 21_000_000, UpdatedAt: now}},
		}
		runRound(h, newFeedState(clk), pr, watch, now)

		rep := h.report()
		require.Contains(t, rep.Recoverable, stepErrKey, "the feed Step failure survived the frontier pass")
		require.Contains(t, rep.Recoverable[stepErrKey], "boom")
		require.Contains(t, rep.Recoverable, staleKey, "and so did the publication-staleness verdict")
		require.NotContains(t, rep.Recoverable, feed+"/"+conditionStaleness,
			"there is no staleness to report — the point is that its ABSENCE erases nothing")
		require.NotContains(t, rep.Recoverable, feed+"/"+conditionFrontierLag,
			"and attribution cannot appear without a verdict to attribute (amendment L3)")
		require.False(t, rep.Ready, "/readyz must fail in the round a feed Step failed")
	})

	t.Run("staleness present: they used to be replaced by the progress pass alone", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		watch, _ := newWatch(now)
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: feed, Block: 21_000_000 - 40, UpdatedAt: now}},
		}
		runRound(h, newFeedState(clk), pr, watch, now)

		rep := h.report()
		require.Contains(t, rep.Recoverable, feed+"/"+conditionStaleness, "the freshness verdict is reported")
		require.Contains(t, rep.Recoverable, feed+"/"+conditionFrontierLag, "with its attribution split")
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
		watch, _ := newWatch(now)
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: feed, Block: 21_000_000, UpdatedAt: now}},
		}
		runRound(h, newFeedState(clk), pr, watch, now)
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

// PRECEDENT CHANGE — controller ruling OQ1, and the reason it changed.
//
// This test previously asserted the opposite: a failed progress read issued NO
// verdict, on the reasoning that inventing a stall from a failed query would be a
// fabricated signal. The fabrication argument was right and the conclusion was not.
// The pass TOUCHES every watched worker before it reads, and publication REPLACES a
// touched worker's entries — so one failed query DELETED every standing red on
// those workers for that round. A worker that was stalled, stale and erroring went
// completely clean on /readyz for a round because the database hiccuped: a
// false-green pulse, on the surface that gates liquidation-facing data, produced by
// the very check meant to catch silence.
//
// progress_unmeasured fabricates nothing. It asserts exactly one thing — the daemon
// could not look — which is true, actionable, and fail-closed. It is also symmetric
// with the header-fetch rule the freshness gate uses (a bound that cannot be
// measured cannot be certified), so the surface now has one rule for unmeasurable
// state rather than two opposite ones.
func TestFailedProgressReadEmitsUnmeasuredRatherThanErasingStandingReds(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	walker := &fakeIngestWorker{name: "op:debt-manager"}
	runner := &fakeDeriveWorker{name: "debt_manager"}
	watch := progressWatch{
		walkers:   []*walkerState{{w: walker, chainID: 10}},
		runners:   []*runnerState{{r: runner}},
		consumers: []frontierWatch{{worker: "debt_manager", streams: []string{"op:debt-manager"}, chainID: 10}},
		// The consumer and the runner are the SAME worker by name, which is the
		// deduplication case: two sources of the same unmeasured verdict must produce
		// one condition, not a publisher collision.
		sweepEngine: "debt_manager", sweepMaxAttempts: 4,
		collateral: &collateralBoundState{interval: time.Hour},
	}

	// Round one: a genuine stall is standing on the surface.
	pr := &fakeProgress{
		ingest:     []store.CursorProgress{{Name: "op:debt-manager", Block: 500, UpdatedAt: now.Add(-noProgressBound - time.Minute)}},
		derive:     []store.CursorProgress{{Name: "debt_manager", Block: 480, UpdatedAt: now}},
		sweepFound: true,
		sweep:      store.SweepProgress{Generation: 3, Open: false, OpenedAt: now.Add(-2 * time.Hour), CompletedAt: now.Add(-time.Hour)},
	}
	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	stall := "op:debt-manager/" + conditionNoProgress
	require.Contains(t, h.report().Recoverable, stall, "the standing red this ruling is about")

	// Round two: every durable read fails. The standing red must not simply vanish.
	pr.ingestErr = errors.New("database unreachable")
	pr.deriveErr = errors.New("database unreachable")
	pr.sweepErr = errors.New("database unreachable")
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)

	rep := h.report()
	require.False(t, rep.Ready,
		"a round in which the daemon could not read durable progress must not read as ready — the old behaviour published a clean surface here")
	for _, key := range []string{
		"op:debt-manager/" + conditionProgressUnmeasured,
		"debt_manager/" + conditionProgressUnmeasured,
		snapshotName + "/" + conditionProgressUnmeasured,
	} {
		require.Contains(t, rep.Recoverable, key)
		require.Contains(t, rep.Recoverable[key], "database unreachable",
			"the reason names the failure rather than inventing a stall")
	}
	require.NotContains(t, rep.Recoverable, stall,
		"and it does NOT claim the stall it could not observe: the verdict is 'unmeasured', not 'stalled'")

	// Recovery: the reads come back and the unmeasured reds clear on their own.
	pr.ingestErr, pr.deriveErr, pr.sweepErr = nil, nil, nil
	pr.ingest[0].UpdatedAt = now
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	require.Empty(t, h.report().Recoverable, "unmeasured is a re-derived verdict, not a latch")
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

// FRONTIER: the price FEED deriver is a raw-log consumer too — it reads
// AnswerUpdated back out of raw_logs — and it is NOT a derive.Runner, so it has to
// be registered explicitly or it would be missed. Codex's finding named price
// workers as excluded outright.
func TestStalenessCoversTheFeedDeriver(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	chainHeaders := newFakeHeaderTimes().
		seedMissedSlots(1, 21_000_000, 40, 30*time.Minute, now)
	pr := &fakeProgress{
		ingest: []store.CursorProgress{{Name: "eth:feed-usdc", Block: 21_000_000, UpdatedAt: now}},
		derive: []store.CursorProgress{{Name: "prices:chainlink_feed:1", Block: 21_000_000 - 40, UpdatedAt: now}},
	}
	watch := progressWatch{
		consumers: []frontierWatch{
			{worker: "prices:chainlink_feed:1", streams: []string{"eth:feed-usdc"}, chainID: 1},
		},
		staleness: newStalenessJudge(chainHeaders.fetch),
	}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	require.Contains(t, h.report().Recoverable, "prices:chainlink_feed:1/"+conditionStaleness)
	require.False(t, h.report().Ready)
}

// STALENESS: the two no-cursor states, which used to be judged by inventing a
// distance or by saying nothing at all.
//
// The POLLER is absent by construction rather than by exclusion: it reads `latest`
// through eth_call and has no raw-log cursor at all, so no elapsed-time verdict
// applies to it. Its analogous gate is whether a NEW poll anchor row came into
// existence.
func TestStalenessIsUnmeasuredNotSilentWithoutACursor(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1_000_000, 0)}
	now := clk.now()

	// TestNeverIngestedWalkerIsUnmeasuredNotGreen [cites L1, invariant I10]: a
	// watched walker with no ingest_cursors row produces (false, nil) from every
	// Step with NO cursor write — a StartBlock the chain has not reached, or a
	// frozen endpoint — so it reports no error, no stall and no advance. The
	// deleted head_lag condition was the only red that ever covered it, so deleting
	// it without this leg would have opened a silent hole exactly where the wave
	// was closing one.
	t.Run("TestNeverIngestedWalkerIsUnmeasuredNotGreen", func(t *testing.T) {
		h, _ := newTestHealth()
		chainHeaders := newFakeHeaderTimes()
		watch := progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
			staleness: newStalenessJudge(chainHeaders.fetch),
		}
		// The ingest READ SUCCEEDED and simply has no row for this stream, which is
		// the distinction that makes this a verdict rather than a read failure.
		pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "other:stream", Block: 5, UpdatedAt: now}}}

		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		key := "eth:aave-etherfi/" + conditionStalenessUnmeasured
		require.Contains(t, rep.Recoverable, key)
		require.Contains(t, rep.Recoverable[key], "no ingest_cursors row")
		require.False(t, rep.Ready, "green-by-silence is exactly what this leg forbids")
		require.Empty(t, chainHeaders.calls, "there is no block to date, so nothing is fetched")
	})

	t.Run("a consumer that has never completed a window is unmeasured too", func(t *testing.T) {
		h, _ := newTestHealth()
		chainHeaders := newFakeHeaderTimes()
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 21_000_000, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
			consumers: []frontierWatch{
				{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi"}, chainID: 1},
			},
			staleness: newStalenessJudge(chainHeaders.fetch),
		})
		publishRound(h, rc)
		require.Contains(t, h.report().Recoverable, "aave_v3_etherfi/"+conditionStalenessUnmeasured)
		require.NotContains(t, h.report().Recoverable, "aave_v3_etherfi/"+conditionFrontierLag,
			"attribution needs a cursor of its own to attribute against")
	})

	t.Run("a price poller is never registered as a consumer", func(t *testing.T) {
		h, _ := newTestHealth()
		chainHeaders := newFakeHeaderTimes().set(10, 150_000_000, now)
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "op:debt-manager", Block: 150_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: "prices:poll:10", Block: 1, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: "op:debt-manager"}, chainID: 10}},
			staleness: newStalenessJudge(chainHeaders.fetch),
		})
		publishRound(h, rc)
		for _, c := range []string{conditionStaleness, conditionStalenessUnmeasured, conditionFrontierLag} {
			require.NotContains(t, h.report().Recoverable, "prices:poll:10/"+c)
		}
	})
}

// NOTE: TestLagBoundsDoNotComposeIntoAWiderTotal was retired with chainLagBound.
// It existed because the bound was a BLOCK DISTANCE applied to two hops of one
// path, and two per-hop distance allowances do not bound a path — the composition
// had to be proven non-additive. The elapsed-time gate has no hops to compose: each
// worker's own cursor block carries a timestamp and the age is one subtraction, so
// there is no arithmetic in which two allowances could add. What survives from that
// test is the boundary discipline (equality passes, one unit past fails), which
// TestStalenessBoundaryEqualityPassesAndOneSecondPastFails now pins in seconds.

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

	// REPLACED — this is where the round-5 test-integrity defect lived.
	//
	// The deleted subtest set Failed:2, Exhausted:0 and asserted `Ready == true`,
	// codifying "readiness stays green with two current failures" as the specified
	// behaviour. Codex named it: the test was not detecting the unsafe policy, it was
	// pinning it. What the subtest was ACTUALLY about — snapshot_failures is keyed on
	// exhausted rather than any failure, so an ordinary transient revert with budget
	// left does not fire it — is a real and correct property of THAT KEY, and it is
	// kept below. What is not kept is the readiness claim: an account with a failure in
	// flight may also have no usable collateral at all, and that is now a separate,
	// separately-keyed verdict.
	//
	// REPORT NOTE for round 9: the deleted assertion would still PASS against this
	// implementation as long as the fake reports no unusable accounts. Its deletion is
	// therefore a policy statement, not a bug fix — a test that says "green is correct
	// here" is a licence a future change can cite, and this surface has twice shipped
	// defects that a passing test had licensed.
	t.Run("failures still inside the retry budget do not fire the EXHAUSTED key", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
			Generation: 9, Open: true,
			OpenedAt: now.Add(-time.Minute), LastBatchAt: now.Add(-time.Second),
			Failed: 2, Exhausted: 0, LastSuccessAt: now.Add(-time.Second),
			// Those two accounts have NEVER produced collateral. That is the state the
			// deleted assertion called ready.
			NeverSucceeded: 2,
		}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		require.NotContains(t, rep.Recoverable, key,
			"snapshot_failures stays keyed on EXHAUSTED: a failure with budget left is in flight, and firing here would redden every transient revert")
		require.Contains(t, rep.Recoverable, snapshotName+"/"+conditionCollateralUnusable,
			"but the accounts have no collateral to serve, which is a different question and gets its own key")
		require.False(t, rep.Ready,
			"and readiness FAILS — the assertion this subtest replaced said the opposite, and that was the defect")
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
// DESIGN 2 — the MEASURED elapsed-time freshness gate.
// ---------------------------------------------------------------------------

// retiredBlockAllowance is the block count the DELETED gate permitted on chain 1:
// ten minutes divided by Ethereum's nominal 12-second slot. It is spelled out here
// for one purpose — every elapsed-time test below sits INSIDE it while being outside
// the real bound, so each one would have passed against the predicate this wave
// removes. Without that, the tests would be re-asserting the old gate in new words.
const retiredBlockAllowance = uint64(maxDerivedStaleness / (12 * time.Second))

// THE HARNESS ITSELF, tested as itself. Codex round 5's adjudication recorded that a
// fake can be the limiting factor — wave 5's hash fake was structurally incapable of
// expressing the disagreement its finding described, so no amount of test-writing
// discipline could have caught it. This is the equivalent check for this wave: the
// block→time schedule must be able to SEPARATE elapsed time from block distance, or
// every test built on it proves nothing about the change.
func TestHeaderTimeFakeFalsifiesBlockDistance(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	hdr := newFakeHeaderTimes().seedMissedSlots(1, 21_000_000, 40, 30*time.Minute, now)

	head := uint64(21_000_000)
	cursor := head - 40
	require.LessOrEqual(t, head-cursor, retiredBlockAllowance,
		"the cursor is INSIDE the block allowance the deleted gate permitted, so that gate read this state as ready")

	secs, err := hdr.fetch(context.Background(), 1, cursor)
	require.NoError(t, err)
	age := now.Sub(time.Unix(int64(secs), 0))
	require.Greater(t, age, maxDerivedStaleness,
		"and yet the block it stands at is older than the requirement: this is the gap between the two predicates, and every test below lives in it")
	require.Equal(t, 30*time.Minute, age)
}

// A walker can advance every round and still be too far behind to serve. That
// property used to be carried by head_lag, in blocks; it is carried here in seconds,
// and the arrangement is chosen so a block-count predicate would disagree.
func TestWalkerStalenessFiresWhileTheWalkerIsAdvancing(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	hdr := newFakeHeaderTimes().seedMissedSlots(10, 150_000_000, 40, 30*time.Minute, now)
	// The walker ADVANCES every round — no_progress cannot see it, and its Step
	// neither errors nor stalls.
	w := (&fakeIngestWorker{name: "op:debt-manager"}).script(true, nil)
	ws := &walkerState{w: w, chainID: 10, bo: retryBackoff{now: clk.now, rand: func() float64 { return 0.5 }}}
	watch := progressWatch{walkers: []*walkerState{ws}, staleness: newStalenessJudge(hdr.fetch)}
	pr := &fakeProgress{ingest: []store.CursorProgress{
		{Name: "op:debt-manager", Block: 150_000_000 - 40, UpdatedAt: now},
	}}

	rc := roundConditions{}
	require.True(t, stepWalkers(context.Background(), []*walkerState{ws}, rc), "the walker is advancing")
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)

	rep := h.report()
	key := "op:debt-manager/" + conditionStaleness
	require.Contains(t, rep.Recoverable, key)
	require.Contains(t, rep.Recoverable[key], "30m0s old")
	require.Contains(t, rep.Recoverable[key], "bound 10m0s")
	require.NotContains(t, rep.Recoverable, "op:debt-manager/"+conditionNoProgress,
		"the cursor is moving, which is exactly why recency cannot catch this")
	require.NotContains(t, rep.Recoverable, "op:debt-manager/"+conditionStepError)
	require.False(t, rep.Ready)

	// Caught up in TIME (not in blocks): it clears.
	pr.ingest[0].Block = 150_000_000
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	require.NotContains(t, h.report().Recoverable, key)
	require.True(t, h.report().Ready)
}

// THE BOUNDARY, in the unit the requirement is stated in. Equality PASSES — the
// requirement is "no more than ten minutes behind", and a bound that failed at
// exactly ten minutes would be a different requirement. One second past fails.
func TestStalenessBoundaryEqualityPassesAndOneSecondPastFails(t *testing.T) {
	for _, tc := range []struct {
		name    string
		age     time.Duration
		expects bool
	}{
		{"one second inside the bound passes", maxDerivedStaleness - time.Second, false},
		{"exactly at the bound passes", maxDerivedStaleness, false},
		{"one second past the bound fails", maxDerivedStaleness + time.Second, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, clk := newTestHealth()
			now := clk.now()
			hdr := newFakeHeaderTimes().set(1, 500, now.Add(-tc.age))
			pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 500, UpdatedAt: now}}}
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
				walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
				staleness: newStalenessJudge(hdr.fetch),
			})
			publishRound(h, rc)
			if tc.expects {
				require.Contains(t, h.report().Recoverable, "eth:aave-etherfi/"+conditionStaleness)
				require.False(t, h.report().Ready)
			} else {
				require.Empty(t, h.report().Recoverable)
				require.True(t, h.report().Ready)
			}
		})
	}
}

// INVARIANT I3′ — THE CLEARING PATH, and the single most important test in this
// design. Both adversarial hunters named the same failure: a fail-forever, in which
// an unmeasured red is recorded and nothing ever retries the measurement that would
// clear it. This drives the whole cycle — failure, cooldown suppression, recovery —
// and the CALL LOG is what makes the middle leg assertable at all, because "no fetch
// happened" is not visible in any verdict.
func TestStalenessUnmeasuredClearsWhenFetchRecovers(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes().set(1, 500, clk.now())
	hdr.fail[1] = errors.New("dial tcp: connection refused")
	judge := newStalenessJudge(hdr.fetch)
	watch := progressWatch{
		walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
		staleness: judge,
	}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 500, UpdatedAt: clk.now()}}}
	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
	}
	key := "eth:aave-etherfi/" + conditionStalenessUnmeasured

	// Round 1: the fetch fails. One attempt, one unmeasured red, no fabricated age.
	round()
	require.Contains(t, h.report().Recoverable, key)
	require.Contains(t, h.report().Recoverable[key], "connection refused")
	require.NotContains(t, h.report().Recoverable, "eth:aave-etherfi/"+conditionStaleness,
		"a failed measurement is NOT a staleness verdict: the daemon must not claim an age it never read")
	require.False(t, h.report().Ready)
	require.Len(t, hdr.calls, 1)

	// Rounds 2-5, inside the cooldown: the red is RE-DERIVED each round (it is not a
	// latch) and no further fetch is paid for. This is the leg that bounds the cost
	// of a dead chain in the hot inner loop.
	for i := 0; i < 4; i++ {
		clk.advance(time.Second)
		round()
		require.Contains(t, h.report().Recoverable, key, "round %d", i)
	}
	require.Len(t, hdr.calls, 1, "the cooldown suppressed four rounds of fetches, not the verdict")

	// Past the cooldown, still broken: exactly one more attempt.
	clk.advance(headerFetchCooldown)
	round()
	require.Len(t, hdr.calls, 2, "the retry is scheduled, not abandoned — this is the fail-forever the design was attacked for")
	require.Contains(t, h.report().Recoverable, key)

	// THE RECOVERY. The chain answers, the cursor block is fresh, and the red clears
	// on the surface rather than persisting as a pre-recovery verdict.
	delete(hdr.fail, 1)
	hdr.set(1, 500, clk.now())
	clk.advance(headerFetchCooldown + time.Second)
	hdr.set(1, 500, clk.now())
	round()
	require.NotContains(t, h.report().Recoverable, key, "the first successful fetch after the cooldown clears it")
	require.Empty(t, h.report().Recoverable)
	require.True(t, h.report().Ready)
}

// A FAILED MEASUREMENT IS NEVER MEMOIZED. The zero time is a real time — the Unix
// epoch — so a failure stored as a stamp would render as an age of roughly 56 years
// and, worse, would be reused by the memo instead of being retried. The call log is
// again the evidence: the next round after the cooldown refetches.
func TestFailedHeaderFetchIsNeverMemoized(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes()
	hdr.fail[1] = errors.New("upstream 502")
	judge := newStalenessJudge(hdr.fetch)
	watch := progressWatch{
		walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
		staleness: judge,
	}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 500, UpdatedAt: clk.now()}}}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
	publishRound(h, rc)
	reason := h.report().Recoverable["eth:aave-etherfi/"+conditionStalenessUnmeasured]
	require.NotEmpty(t, reason)
	require.NotContains(t, reason, "1970", "a failure must not be rendered as an epoch-dated observation")
	require.Empty(t, judge.stamp, "and nothing about it is retained as a measurement")

	clk.advance(headerFetchCooldown + time.Second)
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
	publishRound(h, rc)
	require.Len(t, hdr.calls, 2, "the block is refetched rather than answered from a memoized failure")
}

// AMENDMENT L2 — GROSS FUTURE SKEW. A header claiming a time far ahead of now is a
// broken measurement, not a fresh block: a wrong-unit timestamp (milliseconds read
// as seconds) lands tens of thousands of years ahead and would clamp to age 0. If
// that were memoized, every worker on the chain would read PERMANENTLY GREEN — a
// false-green that survives restarts, which is the worst shape this surface has.
//
// Small skew is different and must not flap: a header a few seconds ahead of this
// process's clock is ordinary drift and clamps to age 0.
func TestGrossFutureHeaderTimeIsUnmeasuredNotGreen(t *testing.T) {
	run := func(t *testing.T, skew time.Duration) (healthReport, *stalenessJudge, *fakeHeaderTimes) {
		t.Helper()
		h, clk := newTestHealth()
		now := clk.now()
		hdr := newFakeHeaderTimes().set(1, 500, now.Add(skew))
		judge := newStalenessJudge(hdr.fetch)
		pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 500, UpdatedAt: now}}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
			staleness: judge,
		})
		publishRound(h, rc)
		return h.report(), judge, hdr
	}

	t.Run("inside the tolerance clamps to age zero", func(t *testing.T) {
		rep, judge, _ := run(t, headerTimeSkewTolerance-time.Second)
		require.Empty(t, rep.Recoverable, "ordinary clock drift is not a fault")
		require.True(t, rep.Ready)
		require.Len(t, judge.stamp, 1, "and it is a real measurement, so it is retained")
	})

	t.Run("ten minutes ahead is a measurement failure, not freshness", func(t *testing.T) {
		rep, judge, _ := run(t, 10*time.Minute)
		key := "eth:aave-etherfi/" + conditionStalenessUnmeasured
		require.Contains(t, rep.Recoverable, key)
		require.Contains(t, rep.Recoverable[key], "in the future")
		require.NotContains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionStaleness)
		require.False(t, rep.Ready, "it must not read green, which is what deleting this check would produce")
		require.Empty(t, judge.stamp,
			"and it is NOT memoized: a memoized future stamp would pin this chain at age 0 permanently")
	})

	t.Run("a wrong-unit timestamp is caught by the same check", func(t *testing.T) {
		// Milliseconds mistaken for seconds. A time.Duration cannot even EXPRESS the
		// resulting skew (it overflows int64 nanoseconds at ~292 years), which is why
		// the check compares TIMES rather than subtracting them: a duration-based
		// future check would overflow into a negative and read as fresh.
		h, clk := newTestHealth()
		now := clk.now()
		hdr := newFakeHeaderTimes()
		hdr.at[stampKey{chainID: 1, block: 500}] = uint64(now.UnixMilli())
		judge := newStalenessJudge(hdr.fetch)
		pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 500, UpdatedAt: now}}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
			staleness: judge,
		})
		publishRound(h, rc)

		rep := h.report()
		require.Contains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionStalenessUnmeasured)
		require.NotContains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionStaleness)
		require.False(t, rep.Ready)
		require.Empty(t, judge.stamp, "and it is not memoized, or the chain would read age 0 forever")
	})
}

// AMENDMENT L5 — THE ORDER OF THE CHECKS, pinned as its own property.
//
// The memo is consulted BEFORE the round's down-set and before the cooldown. A block's
// header timestamp is immutable, so a stamp taken while the chain was reachable stays
// exactly correct however unreachable the chain becomes — and it keeps producing a
// REAL measured verdict, which is what lets a wedged worker on a dead chain go
// legitimately red on elapsed time instead of being reported merely unmeasurable.
// Reversing the order would replace a true verdict with an "I don't know".
func TestHeldStampYieldsAMeasuredVerdictOnADownChain(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes().set(1, 500, clk.now())
	judge := newStalenessJudge(hdr.fetch)
	watch := progressWatch{
		walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
		staleness: judge,
	}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 500, UpdatedAt: clk.now()}}}
	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
	}

	round()
	require.Empty(t, h.report().Recoverable, "the block is fresh and the chain is up")
	require.Len(t, hdr.calls, 1)

	// The chain dies AND the worker wedges at the same block. Time passes.
	hdr.fail[1] = errors.New("all rpc endpoints failed")
	clk.advance(maxDerivedStaleness + time.Minute)
	round()

	rep := h.report()
	require.Contains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionStaleness,
		"the retained stamp is still exact, so this is a real staleness verdict")
	require.NotContains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionStalenessUnmeasured,
		"and NOT an unmeasured one: the daemon does know how old that block is")
	require.Len(t, hdr.calls, 1, "no fetch was attempted, because none was needed")
	require.False(t, rep.Ready)
}

// AMENDMENT L5 — THE RESTAMP THROTTLE, and the direction that makes it safe.
//
// A backfilling worker moves its cursor every round, so the exact-block memo misses
// every round and the pass would fetch a header per worker per round for the whole
// backfill — on the endpoints ingestion itself needs. Reuse is admitted in ONE
// direction only: the retained stamp must belong to a block at or BELOW the one being
// judged, so its timestamp is at or below the true one and the age computed is an
// OVER-estimate. That can report a fresh worker stale; it can never report a stale
// worker fresh.
func TestRestampThrottleReusesOnlyOlderStampsAndOnlyFarFromTheBound(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes()
	// A dense schedule around the cursor, all recent.
	for b := uint64(990); b <= 1010; b++ {
		hdr.set(1, b, clk.now().Add(-time.Duration(1010-b)*time.Second))
	}
	judge := newStalenessJudge(hdr.fetch)
	worker := &walkerState{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}
	watch := progressWatch{walkers: []*walkerState{worker}, staleness: judge}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 1000, UpdatedAt: clk.now()}}}
	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
	}

	round()
	require.Len(t, hdr.calls, 1, "the first measurement is a real fetch")

	// The cursor ADVANCES a few seconds later. The retained stamp belongs to an
	// earlier block and is well inside half the bound, so it is reused.
	clk.advance(10 * time.Second)
	pr.ingest[0].Block = 1005
	round()
	require.Len(t, hdr.calls, 1, "an advancing backfill does not pay a header read every round")
	require.Empty(t, h.report().Recoverable, "and the reused stamp still yields a verdict")

	// Past the reuse window: measured exactly again.
	clk.advance(headerRestampThrottle)
	pr.ingest[0].Block = 1006
	round()
	require.Len(t, hdr.calls, 2, "the stamp is refreshed once the reuse window expires")

	// THE FAIL-CLOSED DIRECTION. A worker at a LOWER block must never be answered
	// from a stamp taken at a higher one: a newer block's timestamp would
	// UNDER-estimate its age, which is the only direction that can false-green.
	before := len(hdr.calls)
	pr.ingest[0].Block = 995
	round()
	require.Equal(t, before+1, len(hdr.calls),
		"a lower block is measured on its own header — reusing a newer stamp for it would under-state its age")

	// NEAR THE BOUND, always exact. Reuse is an approximation, so it is refused
	// whenever the approximated age is more than half the bound: the gate's verdict
	// near the line is never decided by an estimate.
	judge2 := newStalenessJudge(hdr.fetch)
	watch2 := progressWatch{walkers: []*walkerState{worker}, staleness: judge2}
	hdr2calls := len(hdr.calls)
	hdr.set(1, 2000, clk.now().Add(-maxDerivedStaleness+time.Minute)) // age 9m, well past bound/2
	hdr.set(1, 2001, clk.now().Add(-maxDerivedStaleness+time.Minute))
	pr.ingest[0].Block = 2000
	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.now(), rc, watch2)
	publishRound(h, rc)
	pr.ingest[0].Block = 2001
	rc = roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.now(), rc, watch2)
	publishRound(h, rc)
	require.Equal(t, hdr2calls+2, len(hdr.calls),
		"an age past half the bound is always measured exactly, never approximated from an older block")
}

// INVARIANT I4′ — at most one header fetch per (chain, cursor block) per round,
// shared across every worker at that height. This is the bound on the SUCCESS path's
// cost, and without it a deployment with several workers on one chain would multiply
// its header reads by the worker count for no additional information.
func TestOneHeaderFetchPerChainBlockPerRound(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	hdr := newFakeHeaderTimes().set(1, 21_000_000, now).set(10, 150_000_000, now)
	watch := progressWatch{
		walkers: []*walkerState{
			{w: &fakeIngestWorker{name: "eth:a"}, chainID: 1},
			{w: &fakeIngestWorker{name: "eth:b"}, chainID: 1},
			{w: &fakeIngestWorker{name: "op:c"}, chainID: 10},
		},
		consumers: []frontierWatch{
			{worker: "aave_v3_etherfi", streams: []string{"eth:a", "eth:b"}, chainID: 1},
		},
		staleness: newStalenessJudge(hdr.fetch),
	}
	pr := &fakeProgress{
		ingest: []store.CursorProgress{
			{Name: "eth:a", Block: 21_000_000, UpdatedAt: now},
			{Name: "eth:b", Block: 21_000_000, UpdatedAt: now},
			{Name: "op:c", Block: 150_000_000, UpdatedAt: now},
		},
		derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: 21_000_000, UpdatedAt: now}},
	}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	require.Equal(t, []stampKey{{chainID: 1, block: 21_000_000}, {chainID: 10, block: 150_000_000}}, hdr.calls,
		"four workers across two chains at two distinct heights cost exactly two header reads")
	require.Empty(t, h.report().Recoverable)
}

// AMENDMENT L4a — chainDown is ROUND-SCOPED, and this is what that buys.
//
// A chain marked down must not stay down. The ambiguity the design was attacked for
// admitted a judge field, which would have made the first failure permanent until
// something explicitly cleared it — and "something explicitly clears it" is the
// shape of every fail-forever this surface has shipped. Here the down-set is a local
// value: two workers on one dead chain share ONE failed attempt within a round, and
// the next round after the cooldown starts from nothing.
func TestChainDownIsRoundScopedNotRemembered(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes()
	hdr.fail[1] = errors.New("connection refused")
	watch := progressWatch{
		walkers: []*walkerState{
			{w: &fakeIngestWorker{name: "eth:a"}, chainID: 1},
			{w: &fakeIngestWorker{name: "eth:b"}, chainID: 1},
		},
		staleness: newStalenessJudge(hdr.fetch),
	}
	pr := &fakeProgress{ingest: []store.CursorProgress{
		{Name: "eth:a", Block: 100, UpdatedAt: clk.now()},
		{Name: "eth:b", Block: 200, UpdatedAt: clk.now()},
	}}
	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
	}

	round()
	require.Len(t, hdr.calls, 1,
		"two workers at DIFFERENT heights on one dead chain share one failed attempt: the down-set covers the chain, not the block")
	require.Contains(t, h.report().Recoverable, "eth:a/"+conditionStalenessUnmeasured)
	require.Contains(t, h.report().Recoverable, "eth:b/"+conditionStalenessUnmeasured)

	// The chain recovers. Nothing had to clear the down-set, because it never
	// outlived its round — only the cooldown had to expire.
	delete(hdr.fail, 1)
	hdr.set(1, 100, clk.now()).set(1, 200, clk.now())
	clk.advance(headerFetchCooldown + time.Second)
	hdr.set(1, 100, clk.now()).set(1, 200, clk.now())
	round()
	require.Empty(t, h.report().Recoverable, "both workers recover in the same round the chain does")
	require.Len(t, hdr.calls, 2,
		"one fetch cleared the chain for both: the second worker sits at a HIGHER block, so the restamp throttle answers it from the stamp just taken at the lower one — reuse in the over-estimating direction, which cannot false-green")
}

// AMENDMENT L3 / INVARIANT I7′ — frontier_lag ATTRIBUTES, it never GATES.
func TestFrontierLagAttributesInTime(t *testing.T) {
	// The pass is driven for real, end to end. Hand-seeding the judge's memo would
	// be shape without substance: the property under test is that the ATTRIBUTION
	// and the VERDICT come from the same measurement in the same round, and only the
	// real pass composes them.
	newFixture := func(t *testing.T) (*healthState, *fakeClock, *fakeHeaderTimes, progressWatch) {
		t.Helper()
		h, clk := newTestHealth()
		hdr := newFakeHeaderTimes()
		watch := progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
			consumers: []frontierWatch{{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi"}, chainID: 1}},
			staleness: newStalenessJudge(hdr.fetch),
		}
		return h, clk, hdr, watch
	}
	key := "aave_v3_etherfi/" + conditionFrontierLag

	t.Run("the split names the component that is behind", func(t *testing.T) {
		h, clk, hdr, watch := newFixture(t)
		now := clk.now()
		// Ingestion is nearly current (2 minutes); derivation is 40 minutes behind.
		hdr.set(1, 21_000_000, now.Add(-2*time.Minute)).set(1, 20_999_960, now.Add(-40*time.Minute))
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: 20_999_960, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		require.Contains(t, rep.Recoverable, "aave_v3_etherfi/"+conditionStaleness, "the verdict fires first")
		require.Contains(t, rep.Recoverable, key)
		require.Contains(t, rep.Recoverable[key], "of the 40m0s this worker's state is behind")
		require.Contains(t, rep.Recoverable[key], "2m0s is ingestion")
		require.Contains(t, rep.Recoverable[key], "38m0s is derivation")
		require.Contains(t, rep.Recoverable[key], "40 block(s) of raw logs already stored and not yet consumed",
			"block distances survive as metadata inside the attribution, never as the bound")
		require.NotContains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionStaleness,
			"and the walker itself is inside the bound, which is what makes the split informative")
	})

	t.Run("a measurably fresh consumer gets no attribution at all", func(t *testing.T) {
		// THE STRUCTURAL PROPERTY. The frontier is stamped in the FUTURE — the exact
		// input that let the unclamped predecessor redden a green consumer — and the
		// consumer is a minute old. No verdict, therefore no attribution, therefore
		// readiness is untouched by anything the frontier looks like.
		h, clk, hdr, watch := newFixture(t)
		now := clk.now()
		hdr.set(1, 21_000_000, now.Add(30*time.Second)).set(1, 20_999_999, now.Add(-time.Minute))
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: 20_999_999, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		rep := h.report()
		require.NotContains(t, rep.Recoverable, key,
			"attribution cannot appear without a verdict to attribute — that is what makes it structurally unable to gate")
		require.Empty(t, rep.Recoverable)
		require.True(t, rep.Ready)
	})

	t.Run("a future-stamped frontier contributes zero ingestion lag, not a negative one", func(t *testing.T) {
		h, clk, hdr, watch := newFixture(t)
		now := clk.now()
		hdr.set(1, 21_000_000, now.Add(30*time.Second)).set(1, 20_999_000, now.Add(-25*time.Minute))
		pr := &fakeProgress{
			ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: 21_000_000, UpdatedAt: now}},
			derive: []store.CursorProgress{{Name: "aave_v3_etherfi", Block: 20_999_000, UpdatedAt: now}},
		}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)

		reason := h.report().Recoverable[key]
		require.NotEmpty(t, reason)
		require.Contains(t, reason, "0s is ingestion", "the clamp holds the ingestion share at zero")
		require.Contains(t, reason, "25m0s is derivation", "and the whole age is attributed to derivation")
		require.NotContains(t, reason, "-", "no negative duration can reach an operator-facing message")
	})
}

// AMENDMENT L6 — CONSUMER INPUT DECOUPLING. A consumer's freshness is a property of
// its OWN cursor. Suspending the liquidation-facing verdict because an unrelated
// ingest query failed would let a transient failure on the ATTRIBUTION input silence
// the GATE, which is the wrong dependency direction entirely.
func TestConsumerStalenessSurvivesAnIngestReadFailure(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	hdr := newFakeHeaderTimes().seedMissedSlots(1, 21_000_000, 40, 30*time.Minute, now)
	pr := &fakeProgress{
		ingestErr: errors.New("ingest_cursors: statement timeout"),
		derive:    []store.CursorProgress{{Name: "aave_v3_etherfi", Block: 21_000_000 - 40, UpdatedAt: now}},
	}
	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
		walkers:   []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
		consumers: []frontierWatch{{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi"}, chainID: 1}},
		staleness: newStalenessJudge(hdr.fetch),
	})
	publishRound(h, rc)

	rep := h.report()
	require.Contains(t, rep.Recoverable, "aave_v3_etherfi/"+conditionStaleness,
		"the consumer's own cursor was readable, so its bound is still judged")
	require.NotContains(t, rep.Recoverable, "aave_v3_etherfi/"+conditionFrontierLag,
		"only the ATTRIBUTION is skipped, silently, because its input is what failed")
	require.Contains(t, rep.Recoverable, "eth:aave-etherfi/"+conditionProgressUnmeasured,
		"and the walkers that DID depend on that read are reported unmeasured (ruling OQ1)")
	require.False(t, rep.Ready)
}

// AMENDMENT L7 / INVARIANT I11 — SHUTDOWN. A cancelled round context means the
// daemon is stopping; every read would fail for that reason alone, and publishing
// unmeasured reds for a clean stop would make shutdown look like an outage. This
// matches what every other pass already does with context.Canceled.
func TestCanceledRoundProducesNoWave9Conditions(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	hdr := newFakeHeaderTimes()
	hdr.fail[1] = errors.New("context canceled")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	pr := &fakeProgress{
		ingestErr: context.Canceled,
		deriveErr: context.Canceled,
		sweepErr:  context.Canceled,
	}
	rc := roundConditions{}
	applyProgressConditions(ctx, pr, now, rc, progressWatch{
		walkers:     []*walkerState{{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}},
		consumers:   []frontierWatch{{worker: "aave_v3_etherfi", streams: []string{"eth:aave-etherfi"}, chainID: 1}},
		sweepEngine: "debt_manager", sweepMaxAttempts: 4,
		collateral: &collateralBoundState{interval: time.Hour},
		staleness:  newStalenessJudge(hdr.fetch),
	})
	publishRound(h, rc)

	require.Empty(t, h.report().Recoverable, "a clean stop is not an outage")
	require.Empty(t, hdr.calls, "and no chain read is paid for during shutdown")
	require.Empty(t, pr.sweepCalls)
}

// ---------------------------------------------------------------------------
// DESIGN 1 — the collateral usability gate.
// ---------------------------------------------------------------------------

// AMENDMENT A4 — PLACEMENT. The `if !p.Open { return }` guard sits between the
// exhausted-failures gate and the no-progress gate, so a usability check placed
// after it would go silent for the whole gap between generations — which is exactly
// the window the accounts are unusable in, and a generation CLOSES once nothing owes
// work, which is the state a permanently-reverting account leaves behind.
//
// Both legs are driven explicitly rather than relying on a fake's zero value: an
// Open field that happened to default to the covered case would make this coverage
// an accident.
func TestCollateralUnusableFiresWhetherTheGenerationIsOpenOrClosed(t *testing.T) {
	key := snapshotName + "/" + conditionCollateralUnusable
	for _, tc := range []struct {
		name  string
		sweep store.SweepProgress
		want  string
	}{
		{
			name: "Open:false — a CLOSED generation still holding unusable accounts",
			sweep: store.SweepProgress{
				Generation: 7, Open: false, StaleSuccess: 1,
				LastPassDuration: 20 * time.Minute,
			},
			want: "1 whose newest successful snapshot is older than",
		},
		{
			name: "Open:true — an OPEN generation, before it closes",
			sweep: store.SweepProgress{
				Generation: 8, Open: true, StaleSuccess: 1,
				LastPassDuration: 20 * time.Minute,
			},
			want: "1 whose newest successful snapshot is older than",
		},
		{
			name: "never-succeeded accounts, with no stale ones at all",
			sweep: store.SweepProgress{
				Generation: 9, Open: true, NeverSucceeded: 3,
			},
			want: "3 registry account(s) with no successful snapshot ever",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, clk := newTestHealth()
			now := clk.now()
			s := tc.sweep
			s.OpenedAt = now.Add(-time.Minute)
			s.LastBatchAt = now.Add(-time.Second)
			if !s.Open {
				s.CompletedAt = now.Add(-time.Minute)
			}
			pr := &fakeProgress{sweepFound: true, sweep: s}
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
				sweepEngine: "debt_manager", sweepMaxAttempts: 4,
				collateral: &collateralBoundState{interval: time.Hour},
			})
			publishRound(h, rc)

			rep := h.report()
			require.Contains(t, rep.Recoverable, key)
			require.Contains(t, rep.Recoverable[key], tc.want)
			require.Contains(t, rep.Recoverable[key], "clears per account only when that account's own sweep succeeds",
				"the reason states what will and will not clear it, because rollover clearing it silently is the finding")
			require.False(t, rep.Ready, "collateral that cannot be used must fail readiness")
			require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionSnapshotFailures,
				"and it is a DISTINCT key from the retry-budget signal: the two answer different questions")
		})
	}

	t.Run("a fully usable registry reports nothing", func(t *testing.T) {
		h, clk := newTestHealth()
		now := clk.now()
		pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
			Generation: 10, Open: false,
			OpenedAt: now.Add(-2 * time.Hour), CompletedAt: now.Add(-time.Hour),
			LastBatchAt: now.Add(-time.Hour), LastSuccessAt: now.Add(-time.Hour),
		}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
			sweepEngine: "debt_manager", sweepMaxAttempts: 4,
			collateral: &collateralBoundState{interval: time.Hour},
		})
		publishRound(h, rc)
		require.Empty(t, h.report().Recoverable, "the gate must not simply be red always")
		require.True(t, h.report().Ready)
	})
}

// THE QUIET-REFUSAL LEG. A generation in which every batch is refused as stale
// (store.ErrStaleSweepBatch) produces Step returning (false, nil) — no error for the
// daemon's failure bookkeeping, no advance for the loop — and if that generation then
// closes with accounts that never succeeded, NOTHING in the daemon's own state says
// so. This is the composite state Codex's finding describes, and it must read red.
func TestQuietlyRefusedGenerationFailsReadinessThroughUsability(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()

	// The snapshotter reports nothing at all, round after round.
	snap := &fakeSnapshotWorker{}
	var ss snapshotState
	rc := roundConditions{}
	for i := 0; i < 5; i++ {
		require.False(t, stepSnapshotter(context.Background(), snap, &ss, rc),
			"a wholesale-stale batch advances nothing, round %d", i)
	}
	require.Nil(t, ss.lastErr)
	require.NotContains(t, rc[snapshotName], conditionStepError, "which is exactly why nothing was reported")

	// The generation closed recently, so no_progress is silent too, and no account
	// is currently failed — the counts snapshot_failures reads are all zero.
	pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
		Generation: 12, Open: false,
		OpenedAt: now.Add(-30 * time.Minute), CompletedAt: now.Add(-time.Minute),
		LastBatchAt: now.Add(-time.Minute),
		Failed:      0, Exhausted: 0,
		StaleSuccess:     1,
		OldestSuccessAt:  now.Add(-3 * time.Hour),
		LastPassDuration: 29 * time.Minute,
	}}
	applyProgressConditions(context.Background(), pr, now, rc, progressWatch{
		sweepEngine: "debt_manager", sweepMaxAttempts: 4,
		collateral: &collateralBoundState{interval: time.Hour},
	})
	publishRound(h, rc)

	rep := h.report()
	require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionStepError)
	require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionNoProgress)
	require.NotContains(t, rep.Recoverable, snapshotName+"/"+conditionSnapshotFailures)
	require.Contains(t, rep.Recoverable, snapshotName+"/"+conditionCollateralUnusable,
		"every other signal is silent by construction, so this is the only thing that can catch it")
	require.Contains(t, rep.Recoverable[snapshotName+"/"+conditionCollateralUnusable], "3h0m0s old")
	require.False(t, rep.Ready)
}

// AMENDMENT A3 — the bound is a PROPERTY of the achieved cadence, not a constant.
//
// The naive max(2·interval, noProgressBound) is arithmetically wrong: SweepWorkBatch
// never re-selects a current-generation success, so an account is re-read once per
// (interval + pass duration) and a bound ignoring the pass duration is permanently
// exceeded on a healthy system — permanently RED, which is a gate nobody reads.
func TestCollateralStaleBoundCoversIntervalPlusAchievedPass(t *testing.T) {
	for _, interval := range []time.Duration{time.Second, time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour} {
		for _, pass := range []time.Duration{0, time.Second, 90 * time.Second, 25 * time.Minute, 4 * time.Hour} {
			got := collateralStaleBound(interval, pass)
			require.GreaterOrEqual(t, got, 2*(interval+pass),
				"interval=%s pass=%s: the bound must cover two full refresh periods, or a healthy deployment trips it",
				interval, pass)
			require.GreaterOrEqual(t, got, noProgressBound,
				"interval=%s pass=%s: and never fall below the stall bound, which would make it the tighter of two gates on the same worker",
				interval, pass)
			require.Positive(t, got, "a non-positive bound cannot express a staleness question and the store refuses one")
		}
	}
	// The pass duration genuinely MOVES it — a test that only asserted the
	// inequality would pass against a mutant that ignored the second argument.
	require.Greater(t, collateralStaleBound(time.Hour, 4*time.Hour), collateralStaleBound(time.Hour, 0),
		"a longer achieved pass widens the bound, which is the whole reason the store reports it")
	require.Equal(t, noProgressBound, collateralStaleBound(time.Second, 0),
		"and a tiny interval with no completed pass floors at the stall bound rather than at seconds")
}

// The derived bound must REACH THE STORE, with the documented one-round lag, and the
// retained pass duration must survive a generation reopening.
func TestCollateralBoundReachesTheStoreWithOneRoundLag(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	bound := &collateralBoundState{interval: time.Hour}
	watch := progressWatch{sweepEngine: "debt_manager", sweepMaxAttempts: 4, collateral: bound}
	pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
		Generation: 5, Open: false,
		OpenedAt: now.Add(-3 * time.Hour), CompletedAt: now.Add(-time.Hour),
		LastBatchAt: now.Add(-time.Hour), LastSuccessAt: now.Add(-time.Hour),
		LastPassDuration: 2 * time.Hour,
	}}
	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, now, rc, watch)
		publishRound(h, rc)
	}

	round()
	require.Equal(t, []time.Duration{collateralStaleBound(time.Hour, 0)}, pr.sweepBounds,
		"the FIRST round cannot know the pass duration — the store reports it in the very call that needs the bound")

	round()
	require.Equal(t, collateralStaleBound(time.Hour, 2*time.Hour), pr.sweepBounds[1],
		"the second round uses what the first learned: the documented one-round lag")
	require.Greater(t, pr.sweepBounds[1], pr.sweepBounds[0],
		"and it is genuinely wider — a mutant discarding the reported duration would leave these equal")

	// A REOPENED generation reports no completed pass. The daemon must retain the
	// last value it saw rather than snapping back to the naive formula mid-sweep,
	// which would redden a healthy deployment for the length of every generation.
	pr.sweep.Open = true
	pr.sweep.CompletedAt = time.Time{}
	pr.sweep.LastPassDuration = 0
	round()
	require.Equal(t, pr.sweepBounds[1], pr.sweepBounds[2],
		"an open generation has no pass to report, so the retained value stands")
}

// COMPOSITION, asserted STRUCTURALLY. Every snapshotter verdict this wave can produce
// must reach the surface from exactly ONE publishRound — the round guard merges a
// second publication and logs an Error, so a pass that published twice would look
// correct here while having tripped the safety net. And the next round must REPLACE
// them, or a resolved condition would stick forever.
//
// It deliberately does not assert on log output: the package discards slog globally
// (see TestMain), so a log-based assertion would be asserting nothing.
func TestSnapshotterConditionsComposeInOneRoundAndClearInTheNext(t *testing.T) {
	h, clk := newTestHealth()
	now := clk.now()
	watch := progressWatch{
		sweepEngine: "debt_manager", sweepMaxAttempts: 4,
		collateral: &collateralBoundState{interval: time.Hour},
	}
	// Every snapshotter signal at once: a stalled OPEN generation, exhausted
	// failures, unusable collateral — plus a Step error from the snapshot pass, which
	// is published by a DIFFERENT pass for the SAME worker.
	pr := &fakeProgress{sweepFound: true, sweep: store.SweepProgress{
		Generation: 14, Open: true,
		OpenedAt: now.Add(-2 * time.Hour), LastBatchAt: now.Add(-time.Hour),
		Lagging: 5, Failed: 3, Exhausted: 3,
		LastSuccessAt:  now.Add(-2 * time.Hour),
		NeverSucceeded: 2, StaleSuccess: 1,
		OldestSuccessAt: now.Add(-5 * time.Hour),
	}}
	snap := (&fakeSnapshotWorker{}).script(false, errors.New("multicall: boom"))
	var ss snapshotState

	rc := roundConditions{}
	stepSnapshotter(context.Background(), snap, &ss, rc)
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	require.Len(t, rc[snapshotName], 4,
		"all four keys are composed into ONE worker entry before anything is published")
	publishRound(h, rc)

	rep := h.report()
	for _, name := range []string{
		conditionStepError, conditionNoProgress, conditionSnapshotFailures, conditionCollateralUnusable,
	} {
		require.Contains(t, rep.Recoverable, snapshotName+"/"+name,
			"%s must survive composition with the other three", name)
	}
	require.False(t, rep.Ready)

	// The next round: everything resolves, and the surface says so.
	pr.sweep = store.SweepProgress{
		Generation: 15, Open: false,
		OpenedAt: now.Add(-time.Hour), CompletedAt: now.Add(-time.Minute),
		LastBatchAt: now.Add(-time.Minute), LastSuccessAt: now.Add(-time.Minute),
		LastPassDuration: 59 * time.Minute,
	}
	rc = roundConditions{}
	stepSnapshotter(context.Background(), snap, &ss, rc)
	applyProgressConditions(context.Background(), pr, now, rc, watch)
	publishRound(h, rc)
	require.Empty(t, h.report().Recoverable, "replacement is what makes recovery visible")
	require.True(t, h.report().Ready)
}

// AMENDMENT L9 — CONDITION KEY DISTINCTNESS.
//
// Condition keys are an operational contract: alerting routes on them, and
// roundConditions.set treats one key written twice for one worker as a publisher
// COLLISION — it keeps the first and drops the second. The Chainlink feed deriver is
// published by BOTH the price pass (which surfaces internal/prices' keys verbatim)
// and the progress pass (which surfaces the keys below), so a collision between the
// two namespaces would silently drop one publisher's verdict on the one worker they
// share.
//
// The prices-side names are referenced through their exported constants rather than
// copied as literals: a RENAME then breaks this build, and a VALUE change is caught
// by the assertion. HONEST RESIDUAL: a NEW constant added to internal/prices is not
// caught here — Go has no reflection over constants — so this is a guard against
// drift in the names that exist, not a proof of exhaustiveness.
func TestDaemonConditionKeysDoNotCollideWithPriceWorkerKeys(t *testing.T) {
	priceKeys := []string{
		prices.ConditionPollRound,
		prices.ConditionPollTargetFreshness,
		prices.ConditionPollInvalidAnswer,
		prices.ConditionPollFreshnessUnhydrated,
		prices.ConditionPollBlockAdvance,
		prices.ConditionPollRewindBlocked,
		prices.ConditionFeedPublication,
		prices.ConditionFeedInvalidAnswer,
		prices.ConditionFeedTimestamp,
		prices.ConditionFeedFreshnessUnhydrated,
		prices.ConditionRPCIngestLag,
	}
	daemonKeys := []string{
		conditionStepError,
		conditionNoProgress,
		conditionStaleness,
		conditionStalenessUnmeasured,
		conditionProgressUnmeasured,
		conditionFrontierLag,
		conditionSnapshotFailures,
		conditionCollateralUnusable,
		conditionStartup,
	}

	seen := map[string]string{}
	for _, k := range priceKeys {
		require.NotEmpty(t, k)
		require.NotContains(t, seen, k, "internal/prices publishes %q twice", k)
		seen[k] = "prices"
	}
	for _, k := range daemonKeys {
		require.NotEmpty(t, k)
		require.NotContains(t, seen, k,
			"daemon condition key %q collides with an internal/prices key: on the feed deriver, which both passes publish, one verdict would be silently dropped", k)
		seen[k] = "daemon"
	}
	require.Len(t, seen, len(priceKeys)+len(daemonKeys))

	// The two wave-9 additions are also distinct from EACH OTHER and from the key
	// they replaced, which is the collision a rename is most likely to introduce.
	require.NotEqual(t, conditionStaleness, conditionStalenessUnmeasured)
	require.NotEqual(t, conditionStaleness, prices.ConditionRPCIngestLag,
		"the daemon's freshness key and the feed deriver's own RPC-lag key are different questions and must route separately")
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
