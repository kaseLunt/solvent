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

// conditionCadenceUnpersisted is the condition key for the snapshotter when
// the round's configured-cadence write (persistSweepInterval, round-14 F4 /
// round-16 M4) failed. It is its OWN key, not step_error, because
// stepSnapshotter already publishes step_error for the snapshotter and one
// condition key must identify one publisher (roundConditions.set treats a
// same-key double-write as a collision); the two conditions coexist on the
// worker. WHY THE HEALTH SURFACE and not the sweep evidence: the failing
// operation IS a write to the database that carries the sweep evidence — a
// channel that just refused a one-column UPDATE cannot be trusted to
// durably record its own refusal — while this surface is process-local,
// already the daemon's failure-visibility contract, and self-clearing (the
// round composition REPLACES each round, so the first landed write makes
// the condition disappear — recovery stays visible, healthState.publishRound).
// The consequence it surfaces is real: while the cadence is unstamped,
// every reconcile acceptance run TAINTS (round-16 M4 — an acceptance
// verdict never rests on an unverified cadence).
const conditionCadenceUnpersisted = "cadence_unpersisted"

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

// conditionStaleness is the condition key for ANY raw-log worker — a walker or a
// raw-log CONSUMER — whose durable cursor points at a block whose own HEADER
// TIMESTAMP is more than maxDerivedStaleness old. A worker can be progressing and
// still be falling behind; no-progress cannot see that.
//
// IT MEASURES ELAPSED TIME, NOT BLOCK DISTANCE, and that replacement is the point.
// Its predecessor (head_lag) converted the ten-minute requirement into a fixed
// block count using nominal cadences — 50 blocks on Ethereum at 12s, 300 on OP at
// 2s — and then compared distances. Produced-block distance is not elapsed time:
// missed Ethereum slots or degraded OP production make those same 50 or 300 blocks
// span materially more than ten minutes while every comparison still passes, so the
// documented liquidation-facing guarantee could be false-green exactly when the
// chain was struggling. Head freshness does not rescue it either — that the HEAD is
// current says nothing about the timestamp of the CURSOR. Subtracting the cursor
// block's own header timestamp from now gates the stated property directly, with no
// cadence assumption anywhere in the path.
//
// It fires during BACKFILL too, which is deliberate: a process that has not caught
// up to the chain is not ready to be depended on for liquidation-facing data. That
// is the same posture the feed deriver already takes with its rpc_ingest_lag
// condition.
const conditionStaleness = "staleness"

// conditionStalenessUnmeasured is the FAIL-CLOSED partner of conditionStaleness: a
// bound the daemon cannot measure is one it cannot certify.
//
// It is emitted for four genuinely different unmeasurable states, all of which
// used to read as green-by-silence:
//
//   - the header fetch failed, timed out, or is inside its retry cooldown, so
//     there is no timestamp to subtract (amendment L4);
//   - the header came back claiming a time more than headerTimeSkewTolerance in the
//     FUTURE, which is a measurement failure rather than a fresh block — and is
//     never memoized, or a wrong-unit timestamp would pin the worker at age 0
//     forever (amendment L2);
//   - a RETAINED timestamp that was valid when it was taken has since become more
//     than headerTimeSkewTolerance future because THIS DAEMON'S CLOCK moved
//     backwards. Validity is a relation between the stamp and the current clock, not
//     a property of the stamp, so the same guard is applied at every reuse and the
//     invalidated stamp is evicted rather than served (Codex round 9). Without it the
//     memo answered first, forever, at an age stalenessAge clamped to zero;
//   - the worker has NO durable cursor row at all, so there is no block to date
//     (amendment L1, invariant I10). A watched walker in that state produces
//     (false, nil) every Step with no cursor write — a StartBlock typo or a frozen
//     endpoint — and reports no error and no stall; the deleted head_lag condition
//     was the only red covering it.
//
// Honest residual: a stream configured with a StartBlock the chain has not reached
// stays unmeasured-red until it does. That is the correct reading — nothing has
// been ingested — but it is a red an operator will see at deploy time.
const conditionStalenessUnmeasured = "staleness_unmeasured"

// conditionProgressUnmeasured is the same fail-closed shape for a failed DURABLE
// PROGRESS READ, and it changes a pinned precedent (controller ruling OQ1).
//
// The previous behaviour was "a read failure issues no verdict", on the reasoning
// that inventing a stall from a failed query would be a fabricated signal. That
// reasoning was right about fabrication and wrong about the consequence: the pass
// TOUCHES every watched worker before it reads, and publication REPLACES a touched
// worker's entries, so a single failed query deleted every standing red for those
// workers — a one-round false-green pulse on a surface that now gates
// liquidation-facing data. Emitting an explicit unmeasured red instead fabricates
// nothing (it asserts only that the daemon could not look) and is symmetric with
// the header-fetch fail-red rationale above.
const conditionProgressUnmeasured = "progress_unmeasured"

// conditionFrontierLag is the pure ATTRIBUTION key for a raw-log CONSUMER — a
// derivation runner or the Chainlink feed deriver — reporting how the worker's
// staleness splits between ingestion and derivation: how far its durable input
// frontier trails now, and how far the consumer trails that frontier.
//
// IT IS NOT A GATE, and after amendment L3 it is structurally incapable of being
// one: it is emitted only for a consumer that ALREADY carries conditionStaleness or
// conditionStalenessUnmeasured in the same round, so its presence can never be the
// reason readiness fails. That is not decoration — the unclamped predecessor let a
// frontier block stamped in the future redden a consumer that was measurably fresh,
// which is attribution deciding a verdict.
const conditionFrontierLag = "frontier_lag"

// conditionCollateralUnusable is the condition key for collateral snapshot accounts
// whose snapshot is ABSENT or older than the sweep cadence can explain.
//
// It exists because snapshot_failures — keyed on exhausted CURRENT-GENERATION
// failures — cannot answer the question an operator actually has. A first failed
// read leaves Failed > 0 and Exhausted == 0, so readiness stayed green for an
// account that had never produced collateral at all; retries queue behind every
// lagging and never-swept account, so "in flight" can mean an entire pass; and
// opening the next generation drops the failed row out of the current-generation
// count before the account ever succeeded, silently clearing the signal. This key
// is computed from the DURABLE SUCCESS RECORD instead (last_success_block /
// last_success_at), which generation rollover and status churn cannot move, so it
// clears only when that account itself succeeds again.
//
// snapshot_failures stays as a complementary signal: it names the accounts burning
// retry budget right now, which is the actionable-today view, while this key names
// the accounts whose collateral cannot be used.
const conditionCollateralUnusable = "collateral_unusable"

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
//	               accounts whose snapshot failed with no retry left, collateral
//	               accounts with no usable snapshot at all, any walker or consumer
//	               whose cursor block is older than maxDerivedStaleness (or whose
//	               age cannot be measured), a failed durable progress read,
//	               persistent Step failures and terminal engine errors.
//
//	               WHAT IT DOES NOT CLAIM: it is not a statement that every
//	               cursor is at the chain head. The gates are bounds
//	               (maxDerivedStaleness, noProgressBound, blockAdvanceTTL, the
//	               collateral staleness bound) — readiness means "inside every
//	               bound", not "exactly current". What it DOES now claim is that
//	               the freshness bound is measured in the unit it is stated in:
//	               each raw-log worker's own cursor block carries a header
//	               timestamp, and the gate subtracts it from now, so no composition
//	               of hops and no assumption about block production sits between
//	               the requirement and the check.
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
