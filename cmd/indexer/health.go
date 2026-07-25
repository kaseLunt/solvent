package main

// The daemon's HEALTH SURFACE.
//
// Before the Task 8 fix wave, "the health check FAILED" meant one thing in this
// binary: a periodic WARN line. Nothing a process supervisor, a load balancer or
// an operator dashboard can act on was affected — not the exit status, not a
// readiness probe, not any queryable endpoint — so a supervisor watched a
// perfectly live process through stale feeds, missing poll targets and persistent
// apply failures. Worse, an ordinary price Step error never reached the map at
// all: it was logged and dropped unless the worker's separate Health() also
// happened to fail.
//
// healthState is the composed, queryable answer. It carries BOTH classes of
// condition and keeps them distinguishable, because their remedies differ:
//
//   - TERMINAL (derive engines): a capability error. Derivation is gated and no
//     in-process recovery exists; the documented recovery is a restart at
//     upgraded code, since all state is durable and the restarted process
//     re-derives the refusing window. Entries only ever appear.
//   - RECOVERABLE (price workers): a stale Chainlink stream, an asset whose price
//     has aged past its grace window, RPC/ingest lag, a step error under backoff.
//     Entries are REBUILT each round, so a resumed feed or a landed round is
//     visible as recovery rather than sticking forever.
//
// READINESS STARTS CLOSED. newHealthState installs a startup condition, so the
// very first /readyz answer is 503. The endpoint deliberately comes up before any
// dependency — a supervisor needs a probe that answers while the daemon is still
// connecting — and the earlier version paired that with an initial report of
// Ready=true, so /readyz returned 200 throughout registry loading, the database
// connection, migrations, chain verification, worker construction and the first
// daemon round. A hung dependency held that 200 indefinitely while ingestion had
// never started. Missing information must produce refusal, not permission; the
// condition clears only through markInitialized, and only once a full daemon round
// has completed with nothing failing.
//
// READINESS vs LIVENESS, and why they differ here:
//
//   - /readyz fails for EITHER class. A process serving stale or missing prices
//     is not ready to be depended on, whichever kind of failure caused it.
//   - /healthz (liveness) tracks only whether the daemon's main loop is still
//     turning, and deliberately does NOT fail on a terminal engine error. A
//     supervisor's response to a liveness failure is a restart, and restarting
//     the SAME binary on a capability error just crash-loops; the operator has to
//     ship different code. Failing readiness (which drains traffic and alerts)
//     without failing liveness (which restarts) is the honest encoding of that.
//   - The startup condition is likewise NOT a liveness failure: a process that
//     has not finished initialising must not be restarted for not having finished
//     initialising.
//
// CONCURRENCY: the HTTP handlers run on the server's own goroutines while the
// daemon loop writes. Every field is behind the mutex and report() returns COPIES,
// so a handler never touches worker state and the single-writer contract (D-004,
// which is about the store) is untouched by this read surface.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// conditionStepError is the condition key for a worker whose Step returned an
// error and which is now under retry backoff. It is a DAEMON-level condition —
// the worker itself cannot report it, because the error is what stopped it —
// and its absence from the old health map is exactly why persistent apply
// failures were invisible to a supervisor.
const conditionStepError = "step_error"

// conditionNoProgress is the condition key for a worker that has made no DURABLE
// progress within noProgressBound. It is the silent-stall detector: a worker that
// neither errors nor advances reports nothing at all, and before this key existed
// /readyz stayed 200 through exactly that failure. Every measurement behind it is a
// database timestamp, so a restart cannot grant a wedged worker a fresh window.
//
// It covers two shapes of "no progress", because the workers differ in what durable
// evidence they leave: a walker's or runner's CURSOR standing still
// (ingest_cursors/derive_cursors.updated_at), and an OPEN sweep generation that has
// stopped stamping sweep statuses (the collateral snapshotter has no cursor at all,
// and its all-endpoints-stale path returns neither an error nor an advance).
const conditionNoProgress = "no_progress"

// conditionHeadLag is the condition key for ANY worker whose durable cursor sits
// more than chainLagBound(chain) blocks behind the chain head — a raw-log walker
// against the head it read itself, and a raw-log CONSUMER against the head its
// streams' walkers read. A worker can be progressing and still be falling behind;
// no-progress cannot see that.
//
// ONE KEY FOR BOTH, AND ONE BOUND, because it is one property: distance from chain
// head. The predecessor of this arrangement gated the walker hop and the consumer
// hop with two separate 5,000-block constants, which bounded neither the path nor
// anything an operator cares about — a walker at the limit feeding a consumer at the
// limit was reported READY about 10,000 blocks (33 hours of Ethereum) behind head.
// Measuring every worker from the same origin makes the two gates non-additive by
// construction.
//
// It fires during BACKFILL too, which is deliberate: a process that has not caught
// up to the chain is not ready to be depended on for liquidation-facing data. That
// is the same posture the feed deriver already takes with its rpc_ingest_lag
// condition.
const conditionHeadLag = "head_lag"

// conditionFrontierLag is the ATTRIBUTION key for a raw-log CONSUMER — a derivation
// runner or the Chainlink feed deriver — whose durable cursor sits more than
// chainLagBound(chain) blocks below the durable frontier of the streams feeding it.
//
// It answers "which component is behind": the raw logs are already in the database
// and this worker has not consumed them, as distinct from a walker that has not
// ingested them yet. It is NOT an independent allowance — the frontier is at or
// below the chain head, so this distance can never exceed the head distance
// head_lag already gates, and it therefore cannot widen the total. Before the two
// keys existed at all, /readyz could report 200 through an entire restart backfill
// with positions and prices describing a state days old.
const conditionFrontierLag = "frontier_lag"

// conditionSnapshotFailures is the condition key for collateral snapshot accounts
// whose sweep FAILED and has no retry left in the current generation.
//
// It exists because "the generation closed" was being read as "the sweep succeeded".
// CompleteSweepGeneration deliberately stamps a generation complete once no account
// still owes work — which includes accounts that exhausted their retry budget and
// stayed status='failed' — and reports them only through a WARN; per-account
// failures also return nil from ApplySweepBatch, so no step_error appears either.
// Readiness therefore went green the moment a degraded sweep closed, while named
// borrowers had no current collateral snapshot and would not get one until the next
// generation opened, a wait bounded only by SOLVENT_SNAPSHOT_INTERVAL.
const conditionSnapshotFailures = "snapshot_failures"

// startupWorker/conditionStartup name the initialisation entry that makes
// readiness start CLOSED. The key shape matches every other recoverable entry
// ("<worker>/<condition>") so alert routing needs no special case.
const (
	startupWorker    = "daemon"
	conditionStartup = "startup"
)

// startupReason is the text the startup condition carries until initialisation
// completes. It names what has to happen, so a 503 during boot is self-explaining.
const startupReason = "the daemon has not completed initialisation: dependency checks, worker construction, freshness hydration and one full daemon round must all succeed before this process claims readiness"

// loopLivenessBound is how long the daemon's inner loop may go without
// completing a round before liveness reports the process wedged. A round does one
// bounded unit of work per worker, so under any healthy configuration it
// completes far inside this; a value this generous exists so a slow RPC window or
// a long database statement cannot be mistaken for a wedge.
const loopLivenessBound = 5 * time.Minute

// healthReport is the queryable snapshot, and the JSON body every endpoint
// returns. Map keys are "<worker>/<condition>" for price workers and the engine
// name for terminal entries, so an alerting rule can route on the condition
// without parsing prose.
type healthReport struct {
	// Status is the single word a dashboard shows: "starting" (initialisation has
	// not completed), "healthy", "degraded" (recoverable conditions only) or
	// "unhealthy" (at least one terminal, or a wedged loop).
	Status string `json:"status"`
	// Ready is false whenever ANY condition is present, and false until
	// initialisation completes.
	Ready bool `json:"ready"`
	// Live is false only when the daemon loop has not completed a round within
	// loopLivenessBound.
	Live bool `json:"live"`
	// LoopAge is how long ago the loop last completed a round, or "never".
	LoopAge string `json:"loopAge"`
	// Terminal holds engine → capability error; recovery is a restart at
	// upgraded code.
	Terminal map[string]string `json:"terminal,omitempty"`
	// Recoverable holds "<worker>/<condition>" → reason; clears itself when the
	// underlying condition clears.
	Recoverable map[string]string `json:"recoverable,omitempty"`
}

// healthState is the daemon's live health composition. Zero value is not usable;
// build it with newHealthState.
type healthState struct {
	mu          sync.Mutex
	terminal    map[string]string
	recoverable map[string]string
	lastLoop    time.Time
	now         func() time.Time
	// initialised latches true once markInitialized has accepted a clean round.
	// Until then the startup condition stands and /readyz is 503.
	initialised bool
	// round counts completed daemon rounds (heartbeat advances it), and publishedIn
	// records the round each worker's entries were last replaced in. Together they
	// catch the one mistake this surface's replace-per-worker semantics invites: a
	// SECOND publication of the same worker inside one round, which replaces — and
	// therefore deletes — what an earlier pass published. See publishRound.
	round       uint64
	publishedIn map[string]uint64
}

// newHealthState builds the surface in its CLOSED state: initialised is false, so
// report() carries the startup condition and /readyz answers 503 from the first
// instant — before any dependency has been checked.
//
// The startup entry lives in its OWN field rather than in the recoverable map
// because publication REPLACES a worker's entries by name prefix, and worker names
// come from config (stream names legitimately contain colons). A dedicated field
// cannot be cleared by a coincidentally-named worker.
func newHealthState(now func() time.Time) *healthState {
	return &healthState{
		terminal:    map[string]string{},
		recoverable: map[string]string{},
		publishedIn: map[string]uint64{},
		now:         now,
		round:       1, // 1-based so a missing publishedIn entry (zero) is never "this round"
	}
}

// markInitialized clears the startup condition, but only when the daemon has
// genuinely finished starting: a full round completed and the surface carries no
// terminal entry and no worker step error.
//
// Deriving the decision FROM THE SURFACE rather than from a caller's boolean is
// deliberate — the surface already knows which workers failed this round, so the
// two cannot drift apart, and a caller cannot declare readiness the conditions
// contradict. Anything still failing simply defers initialisation, which is the
// fail-closed direction. Once cleared it stays cleared: later failures are
// reported as themselves, not as "still starting up".
func (h *healthState) markInitialized() (cleared bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.initialised {
		return false
	}
	if h.lastLoop.IsZero() {
		return false // no round has completed yet
	}
	if len(h.terminal) > 0 {
		return false
	}
	for k := range h.recoverable {
		if strings.HasSuffix(k, "/"+conditionStepError) {
			return false // a worker could not complete its round
		}
	}
	h.initialised = true
	return true
}

// setTerminal records a terminal (restart-to-recover) condition and reports
// whether this is the first time it has been seen, so the caller can log the
// TRANSITION at Error exactly once instead of every round.
func (h *healthState) setTerminal(key, reason string) (first bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, seen := h.terminal[key]
	h.terminal[key] = reason
	return !seen
}

// publishRound REPLACES the recoverable entries of every worker named in round.
// Replacement is what makes recovery visible: a stale feed that resumes, or a
// step error that stops recurring, disappears from the surface on the next round
// instead of persisting as a pre-recovery verdict.
//
// IT TAKES THE WHOLE ROUND, not one worker, and that shape is the fix for a real
// regression. The per-worker entry point it replaces let each daemon pass publish
// independently, and two passes legitimately own the same worker — the Chainlink
// feed deriver is both a price worker and a raw-log consumer — so the pass that ran
// LAST silently deleted the other's conditions. A feed Step failure could vanish
// from /readyz in the same round it was recorded. With one entry point taking one
// composed map, the passes compose (see roundConditions) instead of racing to be
// last.
//
// THE ROUND GUARD is the second half. Nothing in the type system stops a future pass
// from calling this a second time inside one round, so a repeat publication of a
// worker already published in the CURRENT round is treated as a defect: the entries
// are MERGED rather than replaced — so no signal is lost even when the mistake is
// made — and it is logged at Error naming the worker. Replacement resumes on the
// next round, so recovery stays visible.
func (h *healthState) publishRound(round map[string]map[string]string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for worker, conditions := range round {
		prefix := worker + "/"
		if h.publishedIn[worker] == h.round {
			slog.Error("a worker's health conditions were published TWICE in one daemon round; MERGING instead of replacing so the earlier pass's signal is not deleted — compose into the round's conditions and publish once",
				"worker", worker, "round", h.round, "entriesNow", len(conditions))
		} else {
			for k := range h.recoverable {
				if strings.HasPrefix(k, prefix) {
					delete(h.recoverable, k)
				}
			}
			h.publishedIn[worker] = h.round
		}
		for name, reason := range conditions {
			h.recoverable[prefix+name] = reason
		}
	}
}

// heartbeat marks one completed daemon round, the liveness signal — and opens the
// next publication round, so the round guard in publishRound measures against the
// daemon's actual round boundary rather than against wall time.
func (h *healthState) heartbeat() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastLoop = h.now()
	h.round++
}

// report snapshots the state. The returned maps are copies: a handler must never
// hold a reference into live state.
func (h *healthState) report() healthReport {
	h.mu.Lock()
	defer h.mu.Unlock()

	r := healthReport{Status: "healthy", Ready: true, Live: true, LoopAge: "never"}
	if h.lastLoop.IsZero() {
		// Startup: the loop has not completed a round yet. Liveness must not fail
		// here, or a supervisor would kill the process during its first pass.
		r.Live = true
	} else {
		age := h.now().Sub(h.lastLoop)
		r.LoopAge = age.Truncate(time.Second).String()
		r.Live = age <= loopLivenessBound
	}
	if len(h.terminal) > 0 {
		r.Terminal = make(map[string]string, len(h.terminal))
		for k, v := range h.terminal {
			r.Terminal[k] = v
		}
	}
	if len(h.recoverable) > 0 || !h.initialised {
		r.Recoverable = make(map[string]string, len(h.recoverable)+1)
		for k, v := range h.recoverable {
			r.Recoverable[k] = v
		}
		if !h.initialised {
			r.Recoverable[startupWorker+"/"+conditionStartup] = startupReason
		}
	}
	switch {
	case len(h.terminal) > 0:
		r.Status, r.Ready = "unhealthy", false
	case len(h.recoverable) > 0:
		r.Status, r.Ready = "degraded", false
	}
	if !h.initialised {
		// Startup outranks the other summary words: "degraded" would suggest a
		// process that was ready and regressed. It is NOT a liveness failure.
		r.Status, r.Ready = "starting", false
	}
	if !r.Live {
		// A wedged loop overrides any nominally-clean condition set: the
		// conditions are simply not being refreshed.
		r.Status, r.Ready = "unhealthy", false
	}
	return r
}

// handler serves the surface:
//
//	GET /readyz  — 200 when Ready, else 503. The probe a supervisor or load
//	               balancer should use. It fails while the daemon is still
//	               initialising, and thereafter for stale feeds, missing poll
//	               targets, quarantined answers, a frozen chain view, stalled
//	               ingestion or derivation, a stalled collateral sweep, collateral
//	               accounts whose snapshot failed with no retry left, any walker or
//	               consumer too far behind the chain head, persistent Step failures
//	               and terminal engine errors.
//
//	               WHAT IT DOES NOT CLAIM: it is not a statement that every
//	               cursor is at the chain head. The gates are bounds
//	               (maxDerivedStaleness expressed per chain by chainLagBound,
//	               noProgressBound, blockAdvanceTTL) — readiness means "inside
//	               every bound", not "exactly current". What it DOES now claim is
//	               that no COMPOSITION of those bounds is looser than the widest
//	               one: the lag gates all measure distance from chain head, so they
//	               cannot be added together.
//	GET /healthz — 200 when Live, else 503. Restart-worthy failures only.
//	GET /health  — always 200 with the full report, for humans and dashboards
//	               that want the detail without an HTTP failure.
//
// Every response carries the same JSON body, so a failing probe is
// self-explaining rather than an opaque 503.
func (h *healthState) handler() http.Handler {
	mux := http.NewServeMux()
	write := func(w http.ResponseWriter, code int, r healthReport) {
		body, err := json.Marshal(r)
		if err != nil {
			// Marshalling a map[string]string cannot realistically fail; if it
			// does, say so rather than emitting a misleading 200.
			http.Error(w, fmt.Sprintf(`{"status":"unhealthy","error":%q}`, err.Error()), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write(body)
	}
	status := func(ok bool) int {
		if ok {
			return http.StatusOK
		}
		return http.StatusServiceUnavailable
	}
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		r := h.report()
		write(w, status(r.Ready), r)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		r := h.report()
		write(w, status(r.Live), r)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		write(w, http.StatusOK, h.report())
	})
	return mux
}

// serveHealth binds addr and serves the surface until ctx is cancelled.
//
// A BIND FAILURE IS FATAL, deliberately. A health endpoint that silently failed
// to come up would recreate the exact defect this file exists to fix: an operator
// believing there is a probe when there is only a log line. Callers that do not
// want the endpoint disable it explicitly (SOLVENT_HEALTH_ADDR=off) rather than
// by accident.
//
// Returns the resolved address (useful when addr uses port 0) and a shutdown
// function the caller defers.
func serveHealth(ctx context.Context, addr string, h *healthState) (string, func(), error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return "", nil, fmt.Errorf("bind health endpoint on %q: %w (set SOLVENT_HEALTH_ADDR=off to run without a health surface)", addr, err)
	}
	srv := &http.Server{Handler: h.handler(), ReadHeaderTimeout: 5 * time.Second}
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("health endpoint stopped serving", "addr", ln.Addr().String(), "err", err)
		}
	}()
	shutdown := func() {
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
		<-done
	}
	go func() {
		<-ctx.Done()
		shutdown()
	}()
	return ln.Addr().String(), shutdown, nil
}
