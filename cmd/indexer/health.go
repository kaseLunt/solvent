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
	// Status is the single word a dashboard shows: "healthy", "degraded"
	// (recoverable conditions only) or "unhealthy" (at least one terminal).
	Status string `json:"status"`
	// Ready is false whenever ANY condition is present.
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
}

func newHealthState(now func() time.Time) *healthState {
	return &healthState{
		terminal:    map[string]string{},
		recoverable: map[string]string{},
		now:         now,
	}
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

// setWorkerConditions REPLACES the recoverable entries belonging to one worker.
// Replacement is what makes recovery visible: a stale feed that resumes, or a
// step error that stops recurring, disappears from the surface on the next round
// instead of persisting as a pre-recovery verdict.
func (h *healthState) setWorkerConditions(worker string, conditions map[string]string) {
	prefix := worker + "/"
	h.mu.Lock()
	defer h.mu.Unlock()
	for k := range h.recoverable {
		if strings.HasPrefix(k, prefix) {
			delete(h.recoverable, k)
		}
	}
	for name, reason := range conditions {
		h.recoverable[prefix+name] = reason
	}
}

// heartbeat marks one completed daemon round, the liveness signal.
func (h *healthState) heartbeat() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastLoop = h.now()
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
	if len(h.recoverable) > 0 {
		r.Recoverable = make(map[string]string, len(h.recoverable))
		for k, v := range h.recoverable {
			r.Recoverable[k] = v
		}
	}
	switch {
	case len(h.terminal) > 0:
		r.Status, r.Ready = "unhealthy", false
	case len(h.recoverable) > 0:
		r.Status, r.Ready = "degraded", false
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
//	               balancer should use; fails for stale feeds, missing poll
//	               targets, persistent apply failures and terminal engine errors.
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
