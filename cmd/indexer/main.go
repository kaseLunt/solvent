// Command indexer is Solvent's single-writer indexing daemon: it walks raw
// logs, derives positions and prices from them, sweeps OP collateral
// snapshots, and serves the health surface all of those verdicts feed.
//
// The package is split by topic:
//
//	main.go             — flag wiring, the worker passes, the composition root (run)
//	backoff.go          — per-worker retry backoff scheduling
//	collateral_bound.go — the collateral staleness bound and its cross-round state
//	health.go           — the health surface (/readyz, /healthz, /health) and condition keys
//	round_conditions.go — per-round health-condition composition
//	staleness.go        — the header-staleness judge (elapsed-time freshness)
//	sweep_cadence.go    — sweep-cadence persistence (startup binding + per-round retry)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/derive"
	"github.com/kaselunt/solvent/internal/ingest"
	"github.com/kaselunt/solvent/internal/prices"
	"github.com/kaselunt/solvent/internal/snapshot"
	"github.com/kaselunt/solvent/internal/store"
)

func main() {
	configPath := flag.String("config", "config/contracts.json", "path to contracts config")
	feedsPath := flag.String("feeds", "recon/feeds.json", "path to the oracle feed registry")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *configPath, *feedsPath); err != nil {
		log.Error("indexer exited with error", "err", err)
		os.Exit(1)
	}
}

const (
	// stepsPerRound bounds how long one walker or runner may hold the loop: a
	// stream deep in backfill yields after this many windows so its siblings
	// keep making progress (fair round-robin instead of per-worker full drain).
	stepsPerRound = 5
)

// noProgressBound is how long a worker's DURABLE cursor may stand still before
// readiness fails on it. It is the silent-stall detector: walker failures used to
// only log and back off locally, and derivation Step errors and snapshot failures
// populated no health entry at all, so /readyz could answer 200 indefinitely while
// Debt Manager or Aave ingestion, position derivation or snapshot ingestion was
// wedged.
//
// Fifteen minutes is generous on purpose. A caught-up walker still writes its
// cursor as `head - confirmations` advances, and a caught-up runner still closes
// windows as the ingest frontier moves, so on any live chain both refresh this far
// more often; the bound exists to distinguish "stalled" from "slow", not to police
// throughput. It is also comfortably above the walkers' ten-minute capped retry
// backoff, so a worker in deep backoff is reported by its step error first.
//
// The same bound also measures the COLLATERAL SNAPSHOTTER, which has no cursor of
// its own: while a sweep generation is OPEN, work is owed and batches should be
// landing every round, so a generation that has not stamped a sweep status this long
// is stalled. See applySweepProgressCondition.
const noProgressBound = 15 * time.Minute

// ingestWorker / deriveWorker / snapshotWorker are the narrow surfaces the passes
// below drive (*ingest.Walker, *derive.Runner and *snapshot.Snapshotter satisfy
// them). They exist for the same reason priceWorker does: the composition — step,
// backoff, error reporting, condition rebuild — is what the review found untested,
// and it cannot be tested against concrete workers that need a chain and a
// database.
// NOTE: this interface deliberately no longer names HeadLag() or ObservedHead().
// Both existed to serve the deleted head_lag gate, which measured a worker's
// distance from an observed chain head in BLOCKS. The freshness bound is now
// measured in time from the cursor block's own header timestamp, which needs
// neither an observed head nor a distance, so the daemon stops depending on a
// walker's in-memory view of the chain entirely — every input to the gate is
// durable. *ingest.Walker still exposes both methods for its own tests and
// logging; the daemon simply no longer asks.
type ingestWorker interface {
	Name() string
	Step(ctx context.Context) (bool, error)
}

type deriveWorker interface {
	Name() string
	Step(ctx context.Context) (bool, error)
	Health() (healthy bool, reason string)
}

type snapshotWorker interface {
	Step(ctx context.Context) (bool, error)
}

var (
	_ ingestWorker   = (*ingest.Walker)(nil)
	_ deriveWorker   = (*derive.Runner)(nil)
	_ snapshotWorker = (*snapshot.Snapshotter)(nil)
)

// walkerState wraps a walker with its backoff bookkeeping and the error the health
// surface reports for it. Walker failures previously stopped at a log line and a
// local backoff, which is why a stalled raw-log stream was invisible to /readyz.
type walkerState struct {
	w  ingestWorker
	bo retryBackoff
	// chainID is the chain this stream walks, carried here because the lag bound is
	// CHAIN-SPECIFIC: a block distance only means a staleness once you know the
	// chain's block time (see chainLagBound).
	chainID uint64
	// lastErr is the most recent erroring round's error, and retryIn the backoff
	// delay chosen for it, both retained so the surface can report an ordinary
	// Step failure.
	lastErr error
	retryIn time.Duration
}

// runnerState wraps a derivation runner with the same bookkeeping. The runner's
// TERMINAL capability errors keep their own channel (health.setTerminal); this
// carries the ordinary, recoverable Step failures that previously only logged.
type runnerState struct {
	r       deriveWorker
	lastErr error
	rounds  int
}

// snapshotName is the health-surface worker name for the collateral snapshotter,
// which has no Name() of its own.
const snapshotName = "snapshotter"

// priceWorker is the daemon's uniform handle on Task 8's two price ingestion
// workers — the oracle poller (*prices.Poller) and the Chainlink feed deriver
// (*prices.FeedDeriver).
//
// Conditions, not Health, is what the loop consumes: a worker reports NAMED
// conditions, so "this aggregator stopped publishing" and "our RPC/ingest path is
// frozen" reach the health surface as separate, separately-routable keys instead
// of being concatenated into one string an operator has to parse.
type priceWorker interface {
	Name() string
	Step(ctx context.Context) (bool, error)
	Conditions() []prices.Condition
}

// priceWorkerState wraps a price worker with its backoff bookkeeping. The
// poller additionally rate-limits itself by its own cadence; this backoff is
// the error-storm bound on top of that.
type priceWorkerState struct {
	w  priceWorker
	bo retryBackoff
	// lastErr is the most recent erroring round's error, retained so the health
	// surface can report an ordinary Step failure. It used to be logged and
	// dropped, which meant persistent apply failures were invisible to any
	// supervisor unless the worker's own health verdict happened to fail too.
	lastErr error
	// retryIn is the backoff delay chosen for lastErr, for the same report.
	retryIn time.Duration
}

// stepPriceWorkers runs ONE price pass over every price worker and records each
// worker's recoverable health entries INTO THE ROUND'S composition. Returns whether
// any worker advanced.
//
// It exists as a separate function because this composition is what the review
// found untested and, in one respect, wrong: an ordinary Step error was logged
// and dropped, so a worker failing every round looked healthy to a supervisor
// unless its own condition set happened to fail too. The composition now is:
//
//   - step at most stepsPerRound times, stopping at the first error or at the
//     first non-advancing Step;
//   - a context cancellation is SHUTDOWN, not a failure: no backoff, no health
//     entry;
//   - any other error consumes one backoff unit and is recorded as the
//     step_error condition, alongside whatever the worker itself reports;
//   - conditions are read even while the worker is BACKING OFF — that is
//     precisely when the signal matters most, and skipping it would leave the
//     surface showing a pre-failure verdict for the whole backoff window;
//   - every worker is touched, so a recovered worker's entries clear.
//
// IT WRITES TO roundConditions, NOT TO THE SURFACE, and that is a correction rather
// than a refactor. It used to call setWorkerConditions directly, replacing each
// price worker's entries outright — and the frontier pass, which registers the FEED
// deriver as a raw-log consumer, published afterwards and replaced them again. The
// feed deriver's staleness, timestamp, RPC-lag and step_error conditions were
// therefore deleted every round by a later pass that knew nothing about them:
// /readyz could go green, and startup could even clear, immediately after a feed
// Step failure. Composing into one map per round and publishing once is what makes
// the two passes additive instead of destructive.
func stepPriceWorkers(ctx context.Context, workers []*priceWorkerState, rc roundConditions) bool {
	anyAdvanced := false
	for _, ps := range workers {
		rc.touch(ps.w.Name())
		if ps.bo.ready() {
			roundErred := false
			var lastErr error
			for i := 0; i < stepsPerRound; i++ {
				advanced, err := ps.w.Step(ctx)
				if advanced {
					anyAdvanced = true
				}
				if err != nil {
					if errors.Is(err, context.Canceled) {
						slog.Info("shutting down", "worker", ps.w.Name())
					} else {
						slog.Error("price step failed; will retry after backoff", "worker", ps.w.Name(), "err", err)
						roundErred = true
						lastErr = err
					}
					break
				}
				if !advanced {
					break
				}
			}
			if roundErred {
				delay := ps.bo.failure()
				ps.lastErr, ps.retryIn = lastErr, delay
				slog.Warn("price worker backing off after error",
					"worker", ps.w.Name(), "retryIn", delay, "consecutive", ps.bo.failures)
			} else {
				ps.bo.success()
				ps.lastErr, ps.retryIn = nil, 0
			}
		}
		for _, c := range ps.w.Conditions() {
			rc.set(ps.w.Name(), c.Name, c.Reason)
		}
		if ps.lastErr != nil {
			rc.set(ps.w.Name(), conditionStepError,
				fmt.Sprintf("Step failed %d consecutive round(s), retrying in %s: %v",
					ps.bo.failures, ps.retryIn.Truncate(time.Second), ps.lastErr))
		}
	}
	return anyAdvanced
}

// stepWalkers runs ONE raw-log ingestion pass and records each walker's failure
// state on the health surface.
//
// The recording is the fix: a walker error used to reach a log line and a local
// backoff and nothing else, so a Debt Manager or Aave stream that failed every
// round for hours left /readyz answering 200. Ingestion is the input every derived
// table depends on; a stalled walker is the most consequential silent failure this
// daemon has.
//
// DISCARDS JOIN THE FAILURE STREAK (Task 9 wave 12, chain-truth consult F2).
// A discarded window used to arrive here as (false, nil) — indistinguishable
// from caught-up — so a deterministic discard loop (a stable split backend
// bracketing every fetch) reset the backoff EVERY round and published no
// condition: an invisible wedge with a worse detection profile than the
// incident's error loop. A discard now arrives as *ingest.DiscardError, its
// own outcome: it consumes a backoff unit (the streak keeps growing toward
// the cap, preserving outage pacing) and publishes the step_error condition
// with the discard named — the round-3 [medium] law verbatim ("persistent
// [failure] involvement neither resets the backoff streak nor clears
// step_error"), one layer up. The condition KEY stays step_error on purpose:
// under a mixed discard/error outage the postures alternate, and a separate
// key would flicker each one off on alternating rounds — the exact
// visibility failure round 3 closed; the discard is distinguished WHERE THE
// OPERATOR READS, in the reason. Only a genuine landing or a clean caught-up
// reaches bo.success(): the walker returns discards as errors, so this
// function cannot mistake one for progress even if a future walker arm
// forgets — the typed error is the contract.
func stepWalkers(ctx context.Context, walkers []*walkerState, rc roundConditions) bool {
	anyAdvanced := false
	for _, ws := range walkers {
		rc.touch(ws.w.Name())
		if ws.bo.ready() {
			roundErred := false
			var lastErr error
			for i := 0; i < stepsPerRound; i++ {
				advanced, err := ws.w.Step(ctx)
				if err != nil {
					if errors.Is(err, context.Canceled) {
						slog.Info("shutting down", "stream", ws.w.Name())
					} else {
						var discard *ingest.DiscardError
						if errors.As(err, &discard) {
							// The non-landing posture, not a malfunction: WARN,
							// but the streak below grows exactly as for an error.
							slog.Warn("ingest window discarded; the discard joins the failure streak",
								"stream", ws.w.Name(), "err", err)
						} else {
							slog.Error("step failed; will retry after backoff", "stream", ws.w.Name(), "err", err)
						}
						roundErred, lastErr = true, err
					}
					break
				}
				if !advanced {
					break
				}
				anyAdvanced = true
			}
			if roundErred {
				delay := ws.bo.failure()
				ws.lastErr, ws.retryIn = lastErr, delay
				slog.Warn("walker backing off after error",
					"stream", ws.w.Name(), "retryIn", delay, "consecutive", ws.bo.failures)
			} else {
				ws.bo.success()
				ws.lastErr, ws.retryIn = nil, 0
			}
		}
		// Read while BACKING OFF too: that is precisely when the signal matters.
		if ws.lastErr != nil {
			reason := fmt.Sprintf("ingest Step failed %d consecutive round(s), retrying in %s: %v",
				ws.bo.failures, ws.retryIn.Truncate(time.Second), ws.lastErr)
			var discard *ingest.DiscardError
			if errors.As(ws.lastErr, &discard) {
				reason = fmt.Sprintf("ingest window DISCARDED (non-landing) %d consecutive round(s), retrying in %s: %v",
					ws.bo.failures, ws.retryIn.Truncate(time.Second), ws.lastErr)
			}
			rc.set(ws.w.Name(), conditionStepError, reason)
		}
		// A walker's FRESHNESS verdict is deliberately not issued here. It used to
		// be (as head_lag, from the walker's in-memory head observation), which made
		// the gate depend on process memory a restart resets; it is now issued by the
		// durable progress pass from the walker's cursor block's header timestamp.
	}
	return anyAdvanced
}

// stepRunners runs ONE derivation pass and records both classes of failure.
//
// TERMINAL capability errors keep their own channel (setTerminal — recovery is a
// restart at upgraded code). Ordinary Step errors are RECOVERABLE and previously
// populated nothing at all, so position derivation could fail every round while
// readiness stayed green.
func stepRunners(ctx context.Context, runners []*runnerState, rc roundConditions, health *healthState) bool {
	anyAdvanced := false
	for _, rs := range runners {
		rc.touch(rs.r.Name())
		var lastErr error
		for i := 0; i < stepsPerRound; i++ {
			advanced, err := rs.r.Step(ctx)
			if advanced {
				// COUNT PROGRESS BEFORE ERRORS (M1): a Step can commit its window
				// and still error on the best-effort snapshot flush — advanced=true
				// means the cursor moved and the loop must stay hot.
				anyAdvanced = true
			}
			if err != nil {
				if errors.Is(err, context.Canceled) {
					slog.Info("shutting down", "engine", rs.r.Name())
				} else {
					slog.Error("derivation step failed; will retry next round", "engine", rs.r.Name(), "err", err)
					lastErr = err
				}
				break
			}
			if !advanced {
				break
			}
		}
		if lastErr != nil {
			rs.rounds++
			rs.lastErr = lastErr
		} else {
			rs.rounds, rs.lastErr = 0, nil
		}
		if rs.lastErr != nil {
			rc.set(rs.r.Name(), conditionStepError,
				fmt.Sprintf("derivation Step failed %d consecutive round(s), retrying next round: %v", rs.rounds, rs.lastErr))
		}
		if healthy, reason := rs.r.Health(); !healthy {
			if first := health.setTerminal(rs.r.Name(), reason); first {
				slog.Error("engine transitioned to UNHEALTHY: derivation gated (reorg repair still runs); restart after a capability upgrade to recover",
					"engine", rs.r.Name(), "reason", reason)
			}
		}
	}
	return anyAdvanced
}

// snapshotState carries the snapshotter's failure bookkeeping, which it has no
// Health() of its own to report.
type snapshotState struct {
	lastErr error
	rounds  int
}

// stepSnapshotter runs at most one collateral snapshot batch and records its
// failure state. Snapshot ingestion feeding nothing into health was the third leg
// of the same finding.
//
// The caller must not invoke this when there is no snapshotter: a nil
// *snapshot.Snapshotter in an interface is not a nil interface, so the guard
// belongs at the call site where the concrete type is still visible.
func stepSnapshotter(ctx context.Context, snap snapshotWorker, ss *snapshotState, rc roundConditions) bool {
	rc.touch(snapshotName)
	advanced, err := snap.Step(ctx)
	switch {
	case err == nil:
		ss.lastErr, ss.rounds = nil, 0
	case errors.Is(err, context.Canceled):
		slog.Info("shutting down", "worker", snapshotName)
	default:
		slog.Error("snapshot step failed; will retry next round", "err", err)
		ss.rounds++
		ss.lastErr = err
	}
	if ss.lastErr != nil {
		rc.set(snapshotName, conditionStepError,
			fmt.Sprintf("snapshot Step failed %d consecutive round(s), retrying next round: %v", ss.rounds, ss.lastErr))
	}
	return err == nil && advanced
}

// progressReader is the store surface the progress checks need (*store.Store
// satisfies it; tests pass a fake).
type progressReader interface {
	IngestCursorProgress(ctx context.Context) ([]store.CursorProgress, error)
	DeriveCursorProgress(ctx context.Context) ([]store.CursorProgress, error)
	SweepProgress(ctx context.Context, engine string, maxAttempts int, staleBound time.Duration) (store.SweepProgress, bool, error)
}

// verdictClock sources the ONE time a verdict is measured against. The daemon
// binds it to store.Store.Now — the database clock — and an error from it means
// the daemon has no trusted authority to judge against this round, which is
// reported as unmeasured rather than papered over with the local wall clock.
type verdictClock func(ctx context.Context) (time.Time, error)

// timeAuthority is everything a daemon round needs in order to date anything: the
// TRUSTED clock, and the MONOTONIC clock that carries one reading of it forward
// while the round runs. The daemon binds it to (store.Store.Now, time.Now).
//
// It is a PAIR rather than just the trusted clock because one reading is not the
// same thing as an instant, and Codex round 11's [medium] is precisely that
// difference — see passClock.
type timeAuthority struct {
	verdict verdictClock
	sched   func() time.Time
}

// passClock is ONE reading of the time authority, carried forward by MONOTONIC
// elapsed time — the whole of Codex round 11's third finding.
//
// WHY A READING IS NOT AN INSTANT. The pass reads the database clock once and then
// does work: two durable cursor listings, up to a header read per gated worker, a
// sweep-progress query. On a degraded endpoint that is tens of seconds, all of it
// before the verdicts are published — and the pass-start reading, reused verbatim,
// dates every one of those verdicts as if no time had passed. Measured on the
// nine-worker four-second-read harness the previous wave shipped, a pass runs 36 s,
// so a cursor 10m00s old at publication was judged 9m24s old and read GREEN. That
// is fail-OPEN on a liquidation-facing gate, and it gets worse exactly as the
// endpoint does.
//
// So `at` is anchored, not frozen: now() is the trusted reading plus however much
// monotonic time has elapsed since it was taken. Across passes nothing accumulates,
// because every pass re-reads the authority; within a pass the drift between the
// two clocks is bounded by the pass's own duration, which is the interval over
// which a monotonic clock and a database clock cannot meaningfully disagree.
//
// THE ANCHOR IS TAKEN BEFORE THE READ IS ISSUED, and that is not an accident. The
// trusted instant is the server's, captured somewhere inside a round trip this
// process cannot see into; anchoring after the call returns would credit the whole
// round trip to neither clock and make now() run BEHIND the database — ages short,
// verdicts green. Anchoring first makes now() run AHEAD by at most the round-trip
// latency instead: ages long, fail-closed, and bounded by a number that is
// milliseconds against a local server.
type passClock struct {
	// at is the trusted instant the authority returned.
	at time.Time
	// anchor is the MONOTONIC reading taken immediately BEFORE the trusted read was
	// issued. Only its difference from a later sched() reading is ever used.
	anchor time.Time
	sched  func() time.Time
}

// read takes the pass's one reading of the trusted clock.
func (a timeAuthority) read(ctx context.Context) (passClock, error) {
	anchor := a.sched()
	at, err := a.verdict(ctx)
	if err != nil {
		return passClock{}, err
	}
	return passClock{at: at, anchor: anchor, sched: a.sched}, nil
}

// now is the trusted instant as of RIGHT NOW: the reading, carried forward.
//
// Every timestamp this daemon judges — a header's, a cursor's updated_at, a sweep
// batch's — is compared against this and nothing else. Call it as LATE as the
// comparison allows: the cost of calling it early is a verdict aged from a stale
// instant, which is the finding this type exists to close.
func (c passClock) now() time.Time { return c.at.Add(c.sched().Sub(c.anchor)) }

// frontierWatch binds one raw-log CONSUMER to the ingest streams that feed it, so
// its cursor can be compared against the frontier those streams have reached.
//
// The frontier is the MINIMUM cursor across the streams, matching what both
// consumers use internally: above the lowest stream cursor some stream's logs may
// still be missing, so a window there would be derived from an incomplete address
// set.
type frontierWatch struct {
	worker  string
	streams []string
	// chainID is the chain those streams are on, so the consumer's cursor block can
	// be dated against the right chain's headers.
	chainID uint64
}

// progressWatch is the set of workers the durable progress pass judges, gathered
// into one value so the pass keeps a readable signature as its checks grow.
type progressWatch struct {
	// walkers and runners are judged on cursor RECENCY (no_progress). Walkers are
	// additionally judged on ELAPSED-TIME staleness of their own cursor block.
	walkers []*walkerState
	runners []*runnerState
	// consumers are judged on the ELAPSED-TIME staleness of their durable cursor
	// block, and — as pure attribution on top of that verdict — on how that
	// staleness splits between ingestion and derivation (frontier_lag). Every
	// derivation runner appears here as well as in runners; the price FEED deriver
	// appears here only, because it is not a derive.Runner.
	consumers []frontierWatch
	// sweepEngine is the snapshotter's engine key, empty when no snapshotter is
	// configured. It is judged on whether an OPEN sweep generation is still landing
	// batches, and on whether any account's snapshot is UNRESOLVED-failed.
	sweepEngine string
	// sweepMaxAttempts is the snapshotter's per-generation attempt budget
	// (snapshot.MaxSweepAttempts), which the store needs in order to say which
	// current-generation failures have spent it.
	sweepMaxAttempts int
	// staleness measures each raw-log worker's ELAPSED-TIME staleness. It is a
	// pointer because it carries the only cross-round state the pass has (retained
	// header stamps, the per-chain fetch cooldown), and the watch value is built
	// once outside the loop. A nil judge disables the gate entirely, which is how
	// tests that are about a different property avoid needing a chain.
	staleness *stalenessJudge
	// collateral carries the one-round-lagged input to the collateral staleness
	// bound. Pointer for the same reason.
	collateral *collateralBoundState
}

// applyProgressConditions adds a no_progress condition for every watched walker
// or derivation runner whose DURABLE cursor has not moved within noProgressBound.
//
// The timestamp compared is the database's own updated_at, so a restart cannot
// grant a wedged worker a fresh window — the restart-resets-the-clock defect this
// whole wave is about. store.CursorProgress documents the one shape that could
// refresh updated_at without progress (an idempotent same-height replay) and why
// neither a walker nor a runner can produce it.
//
// AND THE CLOCK IT IS COMPARED AGAINST IS THE DATABASE'S TOO (Codex round 11's
// [medium]). It used to be the daemon's wall clock, which meant this gate subtracted
// a Postgres-written timestamp from a locally-read one — two clocks, one
// subtraction, and nothing anywhere reconciling them. A wall clock stepped BACKWARDS
// shortens every `since` computed here and can suppress a genuine stall outright:
// the material case is a snapshotter quietly refusing stale collateral, which
// produces no step error at all and is visible only as an open sweep generation that
// has stopped landing batches. The previous wave fixed exactly one instance of this
// (the freshness gate) and left the two here; the authority is now read ONCE, at the
// top of this function, and every comparison in the pass — cursor recency, sweep
// progress, and the header ages applyStalenessConditions computes — is measured
// against it. A failure to read it is progress_unmeasured for everything watched:
// with no trusted clock there is no honest verdict, and the local one is the
// substitution the finding is about.
//
// SCOPE, stated rather than implied: PRICE workers are deliberately NOT judged
// here. The poller CAN re-apply the same execution block every interval, so a
// cursor timestamp would lie about it; it is judged instead by whether a NEW poll
// anchor row came into existence (prices.ConditionPollBlockAdvance), which a replay
// cannot fabricate. The feed deriver reports per-stream publication and RPC-lag
// conditions that are strictly more specific than "the cursor stopped".
//
// A READ FAILURE NOW EMITS AN EXPLICIT RED, and that reverses a pinned precedent
// (controller ruling OQ1). The old behaviour issued no verdict, reasoning that
// inventing a stall from a failed query would be a fabricated signal. The
// fabrication argument was right; the conclusion was not. This pass TOUCHES every
// watched worker before it reads, and publication REPLACES a touched worker's
// entries — so a single failed query silently deleted every standing red on those
// workers for that round: a false-green pulse on a surface that gates
// liquidation-facing data. progress_unmeasured fabricates nothing (it asserts only
// that the daemon could not look) and is symmetric with the header-fetch fail-red
// rule the staleness gate uses.
//
// It performs four checks, three of them from durable timestamps and heights and
// one from a bounded, cached chain read:
//
//	no_progress          walker/runner cursor recency, and an OPEN sweep generation
//	                     that has stopped landing batches (the snapshotter's
//	                     semantic stall);
//	staleness            how OLD, in elapsed time, the block each raw-log worker's
//	                     cursor stands at actually is — the freshness gate;
//	frontier_lag         how that staleness splits between ingestion and derivation
//	                     for a consumer, pure attribution on top of a verdict that
//	                     already fired;
//	snapshot_failures /  collateral accounts with no retry left, and accounts with
//	collateral_unusable  no usable collateral snapshot at all.
func applyProgressConditions(ctx context.Context, pr progressReader, auth timeAuthority, rc roundConditions, w progressWatch) {
	// Registering every watched worker makes this pass self-sufficient: publish
	// only replaces workers it knows about, so a worker whose stall CLEARS must
	// still be named here or its stale entry would survive the round.
	watchIngest := make(map[string]bool, len(w.walkers))
	for _, ws := range w.walkers {
		watchIngest[ws.w.Name()] = true
		rc.touch(ws.w.Name())
	}
	watchDerive := make(map[string]bool, len(w.runners))
	for _, rs := range w.runners {
		watchDerive[rs.r.Name()] = true
		rc.touch(rs.r.Name())
	}
	for _, c := range w.consumers {
		rc.touch(c.worker)
	}
	if w.sweepEngine != "" {
		rc.touch(snapshotName)
	}
	// SHUTDOWN CARVE-OUT (amendment L7, invariant I11): a cancelled round context
	// means the daemon is stopping, and every read below would fail for that reason
	// alone. Issuing unmeasured reds for a clean stop would make shutdown look like
	// an outage — the same rule every other pass already applies to context.Canceled.
	if ctx.Err() != nil {
		return
	}

	// THE PASS'S ONE TIME AUTHORITY, read here and nowhere else. Read BEFORE the
	// durable listings so that whatever those cost is elapsed time this pass can
	// account for rather than time it silently loses (see passClock).
	clk, clockErr := auth.read(ctx)
	if clockErr != nil {
		if ctx.Err() != nil {
			return // shutdown, not a verdict (amendment L7)
		}
		applyClockUnmeasured(rc, w, clockErr)
		return
	}

	// EVERY COMPARISON TAKES ITS OWN READING, as late as the comparison allows. The
	// listing above may have taken tens of seconds on a degraded database, and a
	// cursor's age must include that: dating these rows from the pass's opening
	// instant is Codex round 11's third finding in miniature.
	check := func(rows []store.CursorProgress, watched map[string]bool, kind string) {
		now := clk.now()
		for _, p := range rows {
			if !watched[p.Name] {
				continue
			}
			if since := now.Sub(p.UpdatedAt); since > noProgressBound {
				rc.set(p.Name, conditionNoProgress,
					fmt.Sprintf("this %s cursor has not moved for %s (bound %s): it stands at block %d and is neither erroring nor advancing",
						kind, since.Truncate(time.Second), noProgressBound, p.Block))
			}
		}
	}

	ingestRows, ingestErr := pr.IngestCursorProgress(ctx)
	if ingestErr != nil {
		slog.Warn("could not read ingest cursor progress; every watched walker is reported UNMEASURED for this round rather than losing its standing conditions", "err", ingestErr)
		for _, ws := range w.walkers {
			rc.set(ws.w.Name(), conditionProgressUnmeasured,
				fmt.Sprintf("the durable ingest progress read failed, so neither this walker's stall nor its freshness could be judged this round: %v", ingestErr))
		}
	} else {
		check(ingestRows, watchIngest, "ingest")
	}
	deriveRows, deriveErr := pr.DeriveCursorProgress(ctx)
	if deriveErr != nil {
		slog.Warn("could not read derive cursor progress; every watched runner and raw-log consumer is reported UNMEASURED for this round rather than losing its standing conditions", "err", deriveErr)
		// Runners and consumers overlap by name (every derivation runner is also a
		// consumer), so the set is deduplicated: writing the same condition key for
		// one worker twice in a round is a publisher collision, not two verdicts.
		unmeasured := make(map[string]bool, len(w.runners)+len(w.consumers))
		for _, rs := range w.runners {
			unmeasured[rs.r.Name()] = true
		}
		for _, c := range w.consumers {
			unmeasured[c.worker] = true
		}
		for name := range unmeasured {
			rc.set(name, conditionProgressUnmeasured,
				fmt.Sprintf("the durable derive progress read failed, so neither this worker's stall nor its freshness could be judged this round: %v", deriveErr))
		}
	} else {
		check(deriveRows, watchDerive, "derive")
	}

	// GIVEN THE PASS CLOCK, not a bare instant: the freshness gate reads it at each
	// worker it judges and again after each header read, because a pass of slow
	// sequential reads is exactly where a single instant goes stale.
	applyStalenessConditions(ctx, rc, w, clk, ingestRows, ingestErr, deriveRows, deriveErr)

	if w.sweepEngine != "" {
		applySweepProgressCondition(ctx, pr, clk, rc, w)
	}
}

// applyStalenessConditions issues the daemon's FRESHNESS verdict: for every watched
// raw-log worker, how old the block its durable cursor stands at actually is.
//
// WHY IT MEASURES TIME. Its predecessor converted the ten-minute requirement into a
// per-chain block count and compared distances. That conversion assumed nominal
// block production, and produced-block distance is not elapsed time: missed
// Ethereum slots or slower OP production make the same count span longer, so the
// comparison could pass while the state served was well past the bound — false-green
// exactly when the chain is degraded, which is when it matters. Nothing here
// converts anything: the cursor block's own header timestamp is subtracted from now.
//
// WHAT IT COSTS, both directions bounded (amendment L8):
//
//   - SUCCESS PATH: at most one header fetch per (chain, cursor block) per round,
//     shared across every worker at that height, and suppressed across rounds by the
//     restamp throttle in BOTH of its regimes — a near-head worker inside half the
//     bound, and (round 9's [high]) a deep-stale backfilling worker whose retained
//     stamp is already past it. The absolute per-round ceiling is still (number of
//     gated workers) × one header read, but that ceiling is only reachable in the
//     round after a window expires; sustained cost is bounded by the reuse window
//     instead — at most one read per chain per headerRestampThrottle per descent in
//     the order cursors happen to be judged in, since a fetch re-anchors the chain's
//     stamp for every worker judged after it at a HIGHER block. The erosion unit is
//     per gated WORKER rather than per endpoint because chain.Failover re-pins its
//     sticky hint on every success — a slow-but-succeeding endpoint is never rotated
//     away, so these reads ride the same endpoint ingestion uses.
//   - FAILURE PATH: at most one attempt per chain per headerFetchCooldown window,
//     each bounded by headerFetchTimeout. A dead chain therefore costs one timeout
//     per 30 seconds, not one per round — which matters because this pass runs
//     inside the hot inner loop with no ticker between rounds.
//
// A worker with no cursor row at all is UNMEASURED, never green (amendment L1,
// invariant I10). A walker in that state — a StartBlock the chain has not reached, a
// frozen endpoint — returns (false, nil) from every Step with no cursor write, no
// error and no stall, and the deleted head_lag condition was the only red that ever
// covered it.
func applyStalenessConditions(ctx context.Context, rc roundConditions, w progressWatch, clk passClock,
	ingestRows []store.CursorProgress, ingestErr error, deriveRows []store.CursorProgress, deriveErr error) {
	if w.staleness == nil {
		return
	}
	// ONE SOURCE OF TIME TRUTH PER VERDICT (Codex round 10's [medium]), and it is
	// NOT this process's wall clock. The age below is a chain-sourced timestamp
	// subtracted from "now", so "now" is an input to a liquidation-facing verdict,
	// and the daemon's own clock is an input nobody authenticates: NTP can step it,
	// a VM restore or hypervisor rollback can move it by minutes. The future-skew
	// guard does not cover this, and cannot — it only fires when a retained header
	// becomes FUTURE, so a rollback smaller than the header's own age is absorbed by
	// the header being old, and every age computed afterwards is short by the
	// rollback. Short ages read GREEN. Refetching does not help either: the fetch
	// path would compare the fresh header against the same skewed clock.
	//
	// So the verdict clock is the DATABASE's, which is already the authority the
	// collateral staleness verdict is decided on (in SQL, on the server). It is read
	// ONCE per pass — by applyProgressConditions, which hands the reading down here
	// so that this gate and the stall gate cannot drift onto different authorities.
	// Scheduling — reuse windows, retry cooldowns, the refresh budget — is a
	// separate, monotonic clock that no verdict reads (see stalenessJudge).
	//
	// ONE AUTHORITY IS NOT ONE INSTANT, and the previous wave conflated the two: it
	// froze the pass-start reading and judged every worker against it, which on a
	// slow endpoint under-ages the workers judged last by the whole duration of the
	// pass (Codex round 11's third finding — see passClock). The authority is read
	// once; the INSTANT is taken afresh at each worker, and again after each header
	// read, so a verdict is aged from the moment it is actually made.
	//
	// FRESH EVERY ROUND (amendment L4a): the down set and the per-round memo are
	// local values, so no verdict can outlive the round that derived it. The round is
	// numbered by the judge, which is what the refresh rotation's liveness rule reads.
	r := w.staleness.newRound()

	block := func(rows []store.CursorProgress) map[string]uint64 {
		m := make(map[string]uint64, len(rows))
		for _, p := range rows {
			m[p.Name] = p.Block
		}
		return m
	}

	// judge writes one worker's freshness verdict and reports the header time it
	// measured (measured=false when it could not be measured at all), along with the
	// instant it was judged against so the attribution below uses the same one.
	judge := func(worker, kind string, chainID, at uint64) (time.Time, time.Time, bool) {
		// TAKEN AT ENTRY for the reuse and skew arms inside measure: an earlier
		// instant makes the future-skew guard MORE likely to fire and the reuse
		// bands more likely to fall through to a real read, which is the
		// conservative direction for both.
		ts, err := w.staleness.measure(ctx, r, clk.now(), worker, chainID, at, maxDerivedStaleness)
		// TAKEN AGAIN AFTER THE READ, and this is the one the VERDICT is made from.
		// A header fetch is allowed headerFetchTimeout; charging that latency to
		// neither clock is how a cursor measurably past the bound at publication
		// gets reported inside it. The age can only grow by re-reading here, so this
		// is fail-closed by construction.
		now := clk.now()
		if err != nil {
			if ctx.Err() != nil {
				return time.Time{}, now, false // shutdown, not a verdict (amendment L7)
			}
			rc.set(worker, conditionStalenessUnmeasured,
				fmt.Sprintf("this %s cursor stands at block %d on chain %d and the daemon could not read that block's header timestamp, so it cannot certify the %s freshness bound: %v",
					kind, at, chainID, maxDerivedStaleness, err))
			return time.Time{}, now, false
		}
		if age := stalenessAge(now, ts); age > maxDerivedStaleness {
			rc.set(worker, conditionStaleness,
				fmt.Sprintf("this %s cursor stands at block %d on chain %d, whose header timestamp is %s (%s old, bound %s): the state this worker serves describes a chain that far in the past",
					kind, at, chainID, ts.Format(time.RFC3339), age.Truncate(time.Second), maxDerivedStaleness))
		}
		return ts, now, true
	}

	// WALKERS. Skipped wholesale when the ingest read failed — those workers already
	// carry progress_unmeasured from that failure, and a second unmeasured key would
	// say the same thing twice.
	if ingestErr == nil {
		cursor := block(ingestRows)
		for _, ws := range w.walkers {
			name := ws.w.Name()
			at, started := cursor[name]
			if !started {
				rc.set(name, conditionStalenessUnmeasured,
					"this walker has no ingest_cursors row at all, so there is no block whose age could be measured: nothing has been ingested for this stream. A stream that neither errors nor advances writes no cursor, so this is the only signal that covers it")
				continue
			}
			judge(name, "ingest", ws.chainID, at)
		}
	}

	// CONSUMERS. Judged on the DERIVE read alone (amendment L6): a consumer's own
	// freshness is a property of its own cursor, and suspending the
	// liquidation-facing bound because an unrelated ingest query failed would let a
	// transient failure on the attribution input silence the gate.
	if deriveErr == nil {
		cursor := block(deriveRows)
		// Frontier heights come from the ingest listing when it is available, and
		// feed ATTRIBUTION only.
		frontier := map[string]uint64{}
		if ingestErr == nil {
			frontier = block(ingestRows)
		}
		for _, c := range w.consumers {
			at, started := cursor[c.worker]
			if !started {
				rc.set(c.worker, conditionStalenessUnmeasured,
					"this raw-log consumer has no derive_cursors row at all, so there is no block whose age could be measured: it has never completed a window")
				continue
			}
			ts, now, measured := judge(c.worker, "derive", c.chainID, at)
			applyFrontierAttribution(ctx, now, rc, w, r, c, at, ts, measured, frontier, ingestErr)
		}
	}

	if r.fetches > 0 {
		slog.Debug("staleness pass header reads", "fetches", r.fetches,
			"gatedWorkers", len(w.walkers)+len(w.consumers))
	}
}

// applyClockUnmeasured is what the WHOLE PASS reports when it has no trusted clock
// to judge against.
//
// IT IS THE POINT OF THE VERDICT-CLOCK RULE, NOT AN EDGE CASE OF IT. The obvious
// handling of "the database clock read failed" is to carry on with the daemon's own
// wall clock, and that substitution is exactly what the finding is about: a clock
// that has been stepped backwards reports every age shorter than it is, and a gate
// that reads short is a false green on liquidation-facing data. An unmeasured red
// asserts only that the daemon could not look, which is true, and it fails
// readiness, which is the fail-closed direction. Anything the wall clock could
// contribute here is a number nobody can vouch for.
//
// IT COVERS EVERY WATCHED WORKER, not just the freshness gate's, because the clock
// is no longer one gate's input: cursor recency, sweep progress and header age are
// all measured against it. A pass that cannot read it has judged nothing, and
// publication REPLACES a touched worker's entries — so anything left unwritten here
// would be a standing red silently deleted for the round, which is the false-green
// pulse OQ1 was reversed to prevent.
//
// ONE CAUSE, ONE KEY. progress_unmeasured is the whole verdict, and no worker also
// receives staleness_unmeasured for the same failure: that pairing is already how
// this pass encodes "a durable read failed, so neither the stall nor the freshness
// could be judged" (see the ingest-read failure above), and writing both would say
// the same thing twice under two keys.
func applyClockUnmeasured(rc roundConditions, w progressWatch, clockErr error) {
	reason := fmt.Sprintf("the daemon could not read the database clock, which is the one time authority every verdict in this pass — cursor recency, sweep progress and header age alike — is measured against, so nothing about this worker could be judged this round. It does not fall back to its own wall clock: a wall clock stepped backwards reports every age shorter than it is, and these gates would report green: %v", clockErr)
	named := make(map[string]bool, len(w.walkers)+len(w.runners)+len(w.consumers)+1)
	name := func(n string) {
		if !named[n] {
			named[n] = true
			rc.set(n, conditionProgressUnmeasured, reason)
		}
	}
	for _, ws := range w.walkers {
		name(ws.w.Name())
	}
	for _, rs := range w.runners {
		name(rs.r.Name())
	}
	for _, c := range w.consumers {
		name(c.worker)
	}
	if w.sweepEngine != "" {
		name(snapshotName)
	}
}

// applyFrontierAttribution splits a raw-log consumer's staleness between the two
// components that can cause it — ingestion and derivation — and reports the split
// as frontier_lag.
//
// IT IS ATTRIBUTION, AND IT IS STRUCTURALLY INCAPABLE OF BEING A GATE (amendment
// L3, invariant I7′). It emits ONLY for a consumer that ALREADY carries staleness
// or staleness_unmeasured in this same round, so its presence can never be the
// reason readiness fails; a consumer measurably inside the bound gets no entry here
// whatever its input frontier looks like. That constraint is not decoration. The
// unclamped predecessor of this function compared a frontier block against the
// consumer's cursor and could redden a demonstrably fresh consumer on the strength
// of a frontier block stamped in the future — attribution deciding a verdict, which
// is precisely backwards.
//
// The frontier timestamp is clamped to now for the same reason: a header a little
// ahead of this process's clock must contribute zero to the ingestion share rather
// than a negative one that would inflate the derivation share to compensate.
//
// It usually costs NO extra header read: the frontier block is some walker's cursor
// block on the same chain, which this round's memo has already measured. When it
// cannot be measured at all the block distances are still reported — an unmeasured
// attribution is better than none, and by construction it cannot change the verdict.
func applyFrontierAttribution(ctx context.Context, now time.Time, rc roundConditions, w progressWatch,
	r *stalenessRound, c frontierWatch, cursorBlock uint64, cursorTime time.Time, cursorMeasured bool,
	frontier map[string]uint64, ingestErr error) {
	// THE STRUCTURAL GATE: no verdict on this consumer this round, no attribution.
	if !rc.has(c.worker, conditionStaleness) && !rc.has(c.worker, conditionStalenessUnmeasured) {
		return
	}
	if ingestErr != nil || len(c.streams) == 0 {
		return // no durable input listing to attribute against
	}
	// The frontier is the MINIMUM cursor across the feeding streams, matching what
	// both consumers use internally: above the lowest stream cursor some stream's
	// logs may still be missing, so a window there would be derived from an
	// incomplete address set.
	var input uint64
	for i, s := range c.streams {
		b, ok := frontier[s]
		if !ok {
			return // a feeding stream has never ingested: there is no frontier yet
		}
		if i == 0 || b < input {
			input = b
		}
	}

	blocks := fmt.Sprintf("its durable input frontier is block %d and its own cursor is block %d (%d block(s) of raw logs already stored and not yet consumed)",
		input, cursorBlock, gapOrZero(input, cursorBlock))
	if w.staleness == nil {
		rc.set(c.worker, conditionFrontierLag, blocks)
		return
	}
	// SCOPE IS EMPTY, deliberately. The frontier block belongs to the feeding
	// STREAMS, not to this consumer, so borrowing the consumer's deep-stale anchor
	// for it would attribute one worker's backfill to another's input. It costs
	// nothing: the frontier is the minimum cursor across streams this pass has
	// already judged this round, so the round memo answers first.
	inputTime, err := w.staleness.measure(ctx, r, now, "", c.chainID, input, maxDerivedStaleness)
	if err != nil || ctx.Err() != nil {
		rc.set(c.worker, conditionFrontierLag, blocks+
			"; the frontier block's own timestamp could not be read this round, so the split between ingestion and derivation is not available")
		return
	}
	// CLAMP (amendment L3): a frontier block stamped ahead of this process's clock
	// contributes zero ingestion lag, never a negative one.
	if inputTime.After(now) {
		inputTime = now
	}
	ingestShare := stalenessAge(now, inputTime)
	if !cursorMeasured {
		rc.set(c.worker, conditionFrontierLag, fmt.Sprintf(
			"%s; the raw logs available to it reach %s ago, so ingestion is that far behind — this worker's own age could not be measured, so how much of the total is derivation is unknown",
			blocks, ingestShare.Truncate(time.Second)))
		return
	}
	total := stalenessAge(now, cursorTime)
	deriveShare := total - ingestShare
	if deriveShare < 0 {
		deriveShare = 0
	}
	rc.set(c.worker, conditionFrontierLag, fmt.Sprintf(
		"%s; of the %s this worker's state is behind, %s is ingestion (the raw logs are not stored yet) and %s is derivation (the raw logs are stored and not consumed)",
		blocks, total.Truncate(time.Second), ingestShare.Truncate(time.Second), deriveShare.Truncate(time.Second)))
}

// gapOrZero is a - b clamped at zero, for the attribution arithmetic in a lag
// message: an input frontier can legitimately sit above a cursor an older Step
// observed, and an unsigned message must not underflow into a nonsense number.
func gapOrZero(a, b uint64) uint64 {
	if a <= b {
		return 0
	}
	return a - b
}

// applySweepProgressCondition reports no_progress for the collateral snapshotter
// when an OPEN sweep generation has stopped landing batches.
//
// THIS IS THE SNAPSHOTTER'S SEMANTIC STALL, and it was invisible. When every RPC
// endpoint serves sweep batches at an execution block behind the accounts' recorded
// successes, the store refuses each batch and Step returns (false, nil) — no error
// for the wrapper's failure bookkeeping to record, no advance for the loop to
// notice — and it can do that forever. The snapshotter also has no cursor in
// ingest_cursors or derive_cursors, so the generic passes above could not see it
// either: /readyz answered 200 indefinitely while collateral snapshots stopped.
//
// The verdict rests on two durable facts: the generation is OPEN (work is owed, so
// batches SHOULD be landing) and the newest snapshot_sweeps.updated_at for this
// engine is older than noProgressBound. Both are database values, so a restart
// cannot grant a wedged sweep a fresh window. A generation that has never landed
// anything is measured from its own opened_at.
//
// A CLOSED generation is not judged for no_progress: between generations the
// snapshotter is idle by cadence (SOLVENT_SNAPSHOT_INTERVAL can legitimately exceed
// noProgressBound), and an idle-by-design worker is not a stalled one.
//
// IT IS STILL JUDGED FOR FAILURES, and that is the second verdict here. "Closed"
// does not mean "succeeded": CompleteSweepGeneration stamps a generation complete
// once nothing still owes work, which includes accounts that burned their retry
// budget and stayed status='failed', and it reports them only through a WARN.
// Per-account failures also return nil from ApplySweepBatch, so the daemon's
// failure bookkeeping never sees them either. The earlier version returned
// immediately for every closed generation, so readiness went green the moment a
// degraded sweep closed — with named accounts holding no current collateral
// snapshot at all until the next generation opened, a wait bounded only by the
// snapshot interval. snapshot_failures is that state, and it is deliberately keyed
// on EXHAUSTED failures rather than on any failure: a failure with retry budget
// left is in flight within this generation, one without it is stuck until the next.
// (In a closed generation the two counts coincide by construction — a generation
// cannot close while an account still has budget — so one gate covers both the
// open-but-stuck and the closed-degraded cases, and it fires as soon as an account
// burns its budget rather than waiting for the close.)
//
// AND IT IS JUDGED FOR USABILITY, which is the verdict snapshot_failures could not
// give however it was keyed. Exhausted is STATUS-keyed and CURRENT-GENERATION-keyed:
// a first failed read leaves Exhausted == 0 while the account may never have
// produced collateral at all, retries queue behind every lagging and never-swept
// account so "in flight" can mean a whole pass, and opening the next generation
// drops the failed row out of the count before anything succeeded — clearing the
// signal without resolving anything. collateral_unusable is computed from the
// DURABLE SUCCESS RECORD instead (NeverSucceeded / StaleSuccess), which no
// generation rollover and no status churn can move; only that account succeeding
// clears it. The two are complementary and both are kept.
func applySweepProgressCondition(ctx context.Context, pr progressReader, clk passClock, rc roundConditions, w progressWatch) {
	engine, maxAttempts := w.sweepEngine, w.sweepMaxAttempts
	// The bound is the deployment's ACHIEVED cadence, one round stale (see
	// collateralBoundState). A watch with no bound state configured cannot ask the
	// usability question at all, so it falls back to the naive formula with no
	// retained pass duration rather than inventing one.
	boundState := w.collateral
	if boundState == nil {
		boundState = &collateralBoundState{}
	}
	staleBound := boundState.bound()
	p, found, err := pr.SweepProgress(ctx, engine, maxAttempts, staleBound)
	if err != nil {
		// OQ1, applied to the sweep read as well: a failed read USED to return
		// silently, which — because this pass touches the snapshotter before it
		// reads — deleted every standing snapshot red for the round.
		slog.Warn("could not read sweep progress; the snapshotter is reported UNMEASURED for this round rather than losing its standing conditions",
			"engine", engine, "err", err)
		rc.set(snapshotName, conditionProgressUnmeasured,
			fmt.Sprintf("the durable sweep progress read failed, so neither the sweep's stall nor its collateral usability could be judged this round: %v", err))
		return
	}
	if !found {
		return
	}
	// THE INSTANT IS TAKEN AFTER THE READ THAT PRODUCED THE TIMESTAMPS, and against
	// the database's authority rather than this process's wall clock. Both halves are
	// Codex round 11's [medium]: every timestamp below (last batch, generation
	// opened, last and oldest successful sweep) was written by Postgres, and this
	// used to subtract them from a locally-read time.Now. The stall this suppresses
	// when the local clock runs behind is the SILENT one — a snapshotter refusing
	// every stale batch reports no error at all, and an open generation that has
	// stopped landing batches is the only thing that catches it.
	now := clk.now()
	// Retain the achieved pass duration for the NEXT round's bound. Doing it here,
	// from the value this call returned, is what makes the one-round lag explicit
	// rather than a hidden coupling.
	boundState.observe(p.LastPassDuration)
	if p.Exhausted > 0 {
		lastSuccess := "no account has ever been swept successfully"
		if !p.LastSuccessAt.IsZero() {
			lastSuccess = fmt.Sprintf("the newest successful sweep of any account landed %s ago (%s)",
				now.Sub(p.LastSuccessAt).Truncate(time.Second), p.LastSuccessAt.Format(time.RFC3339))
		}
		state := "and that generation is still OPEN"
		if !p.Open {
			state = fmt.Sprintf("and that generation was CLOSED at %s — completion is not success, and nothing retries these accounts until the next generation opens",
				p.CompletedAt.Format(time.RFC3339))
		}
		rc.set(snapshotName, conditionSnapshotFailures,
			fmt.Sprintf("%d of %d account(s) failed under sweep generation %d have spent the %d-attempt retry budget %s: their collateral snapshot is missing or stale, %s",
				p.Exhausted, p.Failed, p.Generation, maxAttempts, state, lastSuccess))
	}

	// PLACEMENT IS LOAD-BEARING (amendment A4): this block sits ABOVE the
	// closed-generation return below. A generation closes once nothing still owes
	// work — which is exactly the state a permanently-reverting account leaves
	// behind — so a usability check placed after that return would go silent for
	// the entire gap between generations, which is the window the accounts are
	// unusable in. Both legs (Open and closed) are covered here, and both are
	// pinned as tested properties rather than left to a fake's zero value.
	if p.NeverSucceeded > 0 || p.StaleSuccess > 0 {
		oldest := "no account carries a recorded successful-read time"
		if !p.OldestSuccessAt.IsZero() {
			oldest = fmt.Sprintf("the oldest surviving successful read is %s old (%s)",
				now.Sub(p.OldestSuccessAt).Truncate(time.Second), p.OldestSuccessAt.Format(time.RFC3339))
		}
		cadence := "no full sweep has completed yet, so the bound is the configured interval alone"
		if p.LastPassDuration > 0 {
			cadence = fmt.Sprintf("the last full sweep took %s, so the bound is twice interval-plus-pass",
				p.LastPassDuration.Truncate(time.Second))
		}
		rc.set(snapshotName, conditionCollateralUnusable,
			fmt.Sprintf("collateral is UNUSABLE for %d registry account(s) with no successful snapshot ever and %d whose newest successful snapshot is older than %s: liquidation arithmetic naming them would be computed from an absent or outdated collateral figure. %s; %s. This clears per account only when that account's own sweep succeeds — generation rollover, retries and status changes do not clear it. The bound is RELATIVE to the cadence this deployment achieves (%s), so it certifies freshness the sweep can actually deliver, not an absolute age",
				p.NeverSucceeded, p.StaleSuccess, staleBound, oldest, cadence, staleBound))
	}

	if !p.Open {
		return
	}
	ref := p.LastBatchAt
	landed := "the newest sweep status landed at " + ref.Format(time.RFC3339)
	if ref.Before(p.OpenedAt) {
		// Either nothing has ever landed for this engine, or everything that has
		// predates this generation: measure from when the generation opened.
		ref = p.OpenedAt
		landed = "no sweep status has landed since this generation opened"
	}
	if ref.IsZero() {
		return // an open generation with no opened_at cannot happen; do not invent a verdict
	}
	if since := now.Sub(ref); since > noProgressBound {
		rc.set(snapshotName, conditionNoProgress,
			fmt.Sprintf("sweep generation %d has been OPEN for %s without landing a batch (bound %s, at least %d account(s) still owe work): %s. An all-endpoints-stale sweep refuses every batch and returns no error, so this is the signal that catches it",
				p.Generation, since.Truncate(time.Second), noProgressBound, p.Lagging, landed))
	}
}

func run(ctx context.Context, configPath, feedsPath string) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	// The health surface comes up FIRST, before any dependency: a supervisor
	// needs a probe that answers while the daemon is still connecting, and a
	// bind failure must be fatal here rather than silently leaving the process
	// without a readiness signal.
	//
	// It comes up CLOSED. newHealthState carries a startup condition, so every
	// probe from here until one full daemon round has completed cleanly answers
	// 503 — through registry loading, the database connection, the writer lock,
	// migrations, chain verification, worker construction and freshness
	// hydration. The earlier version exposed the endpoint just as early and
	// reported Ready=true while doing it, so a hung dependency held a 200 open
	// while ingestion had never started.
	health := newHealthState(time.Now)
	if cfg.HealthAddr == "" {
		slog.Warn("health endpoint DISABLED by SOLVENT_HEALTH_ADDR=off: this process exposes no readiness or liveness probe, so a supervisor cannot see stale feeds, missing poll targets or persistent apply failures")
	} else {
		addr, shutdown, err := serveHealth(ctx, cfg.HealthAddr, health)
		if err != nil {
			return err
		}
		defer shutdown()
		slog.Info("health endpoint listening", "addr", addr,
			"readiness", "GET /readyz", "liveness", "GET /healthz", "detail", "GET /health")
	}
	// The oracle feed registry (recon/feeds.json) is loaded against the config's
	// chains, so a registry chain the config does not define fails fast here
	// rather than silently dropping that chain's prices.
	feeds, err := config.LoadFeeds(feedsPath, cfg.Chains)
	if err != nil {
		return err
	}
	slog.Info("feed registry loaded", "path", feedsPath, "assets", len(feeds.Assets))
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()
	// Enforce the single-writer contract before touching any state — even
	// migrations — so a second indexer process fails fast.
	if err := st.AcquireWriterLock(ctx); err != nil {
		return err
	}
	slog.Info("writer lock acquired")
	if err := store.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}

	clients := map[string]*chain.Failover{}
	// clientsByChainID is what the staleness gate reads: it dates a cursor block by
	// its CHAIN, and the workers carry chain ids rather than config chain names.
	// A chain id declared twice under different names would silently make one of
	// them unreachable for measurement, so the collision is refused.
	clientsByChainID := map[uint64]*chain.Failover{}
	for name, c := range cfg.Chains {
		fc, err := chain.Dial(ctx, c.RPCURLs)
		if err != nil {
			return err
		}
		if err := fc.VerifyChainID(ctx, c.ChainID); err != nil {
			return fmt.Errorf("chain %q: %w", name, err)
		}
		if _, dup := clientsByChainID[c.ChainID]; dup {
			return fmt.Errorf("chain %q declares chain id %d, which another configured chain already uses: the freshness gate dates every cursor by chain id and cannot tell the two apart", name, c.ChainID)
		}
		clientsByChainID[c.ChainID] = fc
		// NOTE: there is deliberately no per-chain block-time table here any more.
		// It existed to convert maxDerivedStaleness into a block allowance, which is
		// the unit-conversion fallacy this wave removes — the gate now reads each
		// cursor block's own header timestamp, so an unlisted chain needs no
		// assumption about its cadence and no startup warning about one.
		slog.Info("chain id verified", "chain", name, "chainId", c.ChainID,
			"stalenessRequirement", maxDerivedStaleness, "measuredAs", "now - header timestamp of the cursor block")
		clients[name] = fc
	}
	// headerTime is the staleness gate's only chain dependency, bounded by the
	// judge's own timeout and cooldown (see stalenessJudge).
	headerTime := func(ctx context.Context, chainID, block uint64) (uint64, error) {
		fc, ok := clientsByChainID[chainID]
		if !ok {
			return 0, fmt.Errorf("no rpc client configured for chain %d", chainID)
		}
		return fc.HeaderTime(ctx, block)
	}

	var walkers []*walkerState
	for _, s := range cfg.Streams {
		walkers = append(walkers, &walkerState{
			w: ingest.NewWalker(clients[s.Chain], st, ingest.WalkerConfig{
				Stream:        s.Name,
				ChainID:       cfg.Chains[s.Chain].ChainID,
				Addresses:     s.Addresses,
				StartBlock:    s.StartBlock,
				Window:        s.Window,
				Confirmations: s.Confirmations,
			}),
			chainID: cfg.Chains[s.Chain].ChainID,
			bo:      retryBackoff{now: time.Now, rand: rand.Float64},
		})
		// NOTE: the confirmations-versus-bound startup warning was removed with the
		// block-count gate it belonged to. It compared `confirmations` against a
		// block allowance derived from a nominal cadence, which is the conversion
		// this wave deletes; the same conflict now shows up honestly and in the right
		// unit — a caught-up walker's cursor block simply dates older than
		// maxDerivedStaleness and the staleness condition says so, with the block's
		// actual timestamp in the reason.
		slog.Info("stream configured", "stream", s.Name, "start", s.StartBlock,
			"confirmations", s.Confirmations, "stalenessRequirement", maxDerivedStaleness)
	}

	// Derivation runners + OP collateral snapshotter (Task 7). The engine
	// bindings come from the config's streams (address→engine mapping).
	specs, err := derive.BuildRunnerSpecs(cfg)
	if err != nil {
		return err
	}
	registry := decode.NewRegistry()

	// Snapshotter first: the debt_manager runner's post-rewind hook targets
	// it (a rewind may change the Safe registry, so it re-sweeps). The hook
	// is only the LIVE fast path — sweeps run on durable generations
	// (sweep_generations/snapshot_sweeps), RewindDerived bumps the generation
	// in its own transaction, and a restarted process resumes the open
	// generation's lagging set on its first Step.
	// consumers accumulates every raw-log CONSUMER with the streams that feed it,
	// so the durable progress pass can measure each one against its own input
	// frontier. sweepEngine names the snapshotter's engine for the same pass.
	var consumers []frontierWatch
	var sweepEngine string

	var snap *snapshot.Snapshotter
	for _, spec := range specs {
		if spec.Engine != "debt_manager" {
			continue
		}
		if len(spec.Addresses) != 1 {
			return fmt.Errorf("engine %q: expected exactly one contract address for the snapshotter target, got %d",
				spec.Engine, len(spec.Addresses))
		}
		snap, err = snapshot.New(st, clients[spec.Chain], snapshot.Config{
			Engine:   spec.Engine,
			Target:   common.BytesToAddress(spec.Addresses[0]),
			Interval: cfg.SnapshotInterval,
		})
		if err != nil {
			return err
		}
		sweepEngine = spec.Engine
		slog.Info("collateral snapshotter configured", "engine", spec.Engine, "interval", cfg.SnapshotInterval)
	}

	var runners []*runnerState
	for _, spec := range specs {
		var eng derive.Engine
		var onRewind func()
		switch spec.Engine {
		case "debt_manager":
			// The DM deriver needs its own chain's calldata reads (migration
			// genesis seeds live in tx calldata, not logs).
			eng = derive.NewDebtManager(clients[spec.Chain])
			if snap != nil {
				onRewind = snap.TriggerResweep
			}
		case "aave_v3_etherfi":
			eng = derive.NewAaveEngine()
		case "chainlink_feed":
			// Price feeds are ingested raw; their derivation is Task 8's
			// prices.FeedDeriver, built below — it writes prices rows under its
			// own pseudo-engine cursor and holds no per-account state, so it is
			// deliberately not a derive.Engine. Skipped here on purpose.
			continue
		default:
			return fmt.Errorf("no deriver wired for engine %q", spec.Engine)
		}
		r, err := derive.NewRunner(st, registry, eng, spec, onRewind)
		if err != nil {
			return err
		}
		runners = append(runners, &runnerState{r: r})
		consumers = append(consumers, frontierWatch{worker: r.Name(), streams: spec.Streams, chainID: spec.ChainID})
		slog.Info("derivation runner configured", "engine", spec.Engine, "streams", len(spec.Streams))
	}

	// Price ingestion (Task 8): one POLLER per chain carrying registry poll
	// obligations (the engine-exact OP PriceProviderV2 assets, plus the ETH
	// weETH getRate() ratio), and one FEED DERIVER per chainlink_feed spec.
	// Chain keys are sorted so construction and log order are deterministic
	// across runs (Go map iteration is not).
	var priceWorkers []*priceWorkerState
	chainKeys := make([]string, 0, len(cfg.Chains))
	for name := range cfg.Chains {
		chainKeys = append(chainKeys, name)
	}
	sort.Strings(chainKeys)
	for _, name := range chainKeys {
		chainID := cfg.Chains[name].ChainID
		if len(feeds.PollAssets(chainID)) == 0 && len(feeds.RatioAssets(chainID)) == 0 {
			continue // nothing to poll on this chain
		}
		p, err := prices.NewPoller(st, clients[name], feeds, prices.PollerConfig{
			ChainID: chainID, Interval: cfg.PriceInterval,
		})
		if err != nil {
			return err
		}
		priceWorkers = append(priceWorkers, &priceWorkerState{
			w: p, bo: retryBackoff{now: time.Now, rand: rand.Float64},
		})
		slog.Info("oracle poller configured", "engine", p.Name(), "chain", name,
			"interval", cfg.PriceInterval, "sources", len(p.Sources()))
	}
	for _, spec := range specs {
		if spec.Engine != "chainlink_feed" {
			continue
		}
		fd, err := prices.NewFeedDeriver(st, registry, clients[spec.Chain], feeds, prices.FeedConfig{
			ChainID: spec.ChainID, Streams: spec.Streams,
			Addresses: spec.Addresses, StartBlock: spec.StartBlock, Window: spec.Window,
		})
		if err != nil {
			return err
		}
		priceWorkers = append(priceWorkers, &priceWorkerState{
			w: fd, bo: retryBackoff{now: time.Now, rand: rand.Float64},
		})
		// The feed deriver is a raw-log consumer like a derivation runner (it reads
		// AnswerUpdated back out of raw_logs), so it is measured against the same
		// frontier gate. It is NOT a derive.Runner, which is why it has to be
		// registered here rather than falling out of the runners list.
		consumers = append(consumers, frontierWatch{worker: fd.Name(), streams: spec.Streams, chainID: spec.ChainID})
		// Staleness thresholds are PER FEED (each stream's own heartbeat + grace
		// from recon/feeds.json), so the startup log names them individually
		// rather than reporting one global number that applies to none of them.
		slog.Info("chainlink feed deriver configured", "engine", fd.Name(), "chain", spec.Chain,
			"streams", len(spec.Streams), "perFeedStaleness", fmt.Sprintf("%v", fd.Thresholds()))
	}

	var snapState snapshotState
	// The durable progress pass judges every worker whose stall would otherwise be
	// silent: walker and runner cursor recency, the measured age of every raw-log
	// worker's cursor block (and its attribution split, for consumers), an open sweep
	// generation that has stopped landing batches, collateral accounts whose snapshot
	// failed with no retry left in the current generation, and collateral accounts
	// with no usable snapshot at all.
	//
	// The judge and the bound state are built ONCE and shared across rounds: they
	// carry the retained header stamps, the per-chain fetch cooldown and the achieved
	// sweep pass duration, all of which are meaningless if rebuilt every round.
	collateral := &collateralBoundState{interval: cfg.SnapshotInterval}
	// FAIL CLOSED AT STARTUP: a non-positive collateral bound cannot express a
	// staleness question, and the store refuses one. Config validation already
	// rejects a non-positive interval, so this is a structural guard against a
	// future formula change rather than a reachable configuration today — which is
	// exactly when a guard is worth having, because nothing else would catch it.
	if sweepEngine != "" && collateral.bound() <= 0 {
		return fmt.Errorf("collateral staleness bound is %s for snapshot interval %s: a non-positive bound cannot gate collateral freshness",
			collateral.bound(), cfg.SnapshotInterval)
	}
	// HYDRATE BEFORE THE FIRST VERDICT (round 9's restart finding). The achieved
	// pass duration is durable now, but the per-round read only feeds the NEXT
	// round, so without this a restarted process would spend its first round
	// judging with the naive bound it just learned not to trust.
	if sweepEngine != "" {
		collateral.hydrate(ctx, st, sweepEngine)
		// And the converse direction (round-14 F4), MANDATORY AND FATAL
		// since round-19 H1: the daemon may not enter its loop until the
		// durable row's cadence provably belongs to THIS instance. Restart
		// does not roll current_generation, so a PREVIOUS instance's stamp
		// would otherwise remain readable-as-verified while this instance
		// enforces a different rule — Codex's round-19 scenario (2h stamped,
		// a 30m daemon whose writes all fail, reconcile still handed 2h as
		// verified). Refusing to run adds no availability dependency the
		// daemon does not already have — it cannot run without this
		// database — and per-round write failures STAY tolerated+surfaced,
		// because startup guaranteed instance ownership (see
		// requireStartupSweepCadence for the mid-run rollover argument).
		if err := requireStartupSweepCadence(ctx, st, sweepEngine, cfg.SnapshotInterval); err != nil {
			return err
		}
	}
	watch := progressWatch{
		walkers: walkers, runners: runners, consumers: consumers,
		sweepEngine: sweepEngine, sweepMaxAttempts: snapshot.MaxSweepAttempts,
		// SCHEDULING ONLY. time.Now's differences are Go's monotonic readings, which
		// no clock step can move; the judge holds no verdict clock at all, so it
		// cannot date anything against this (see stalenessJudge).
		staleness: newStalenessJudge(headerTime, time.Now), collateral: collateral,
	}
	// THE PASS'S TIME AUTHORITY, wired at the one place the split is decided: st.Now
	// is the DATABASE clock — the sole authority every verdict in the health pass is
	// measured against — and time.Now carries one reading of it forward through the
	// pass without ever being an authority itself (see timeAuthority and passClock).
	authority := timeAuthority{verdict: st.Now, sched: time.Now}
	if sweepEngine != "" {
		slog.Info("collateral usability gate configured", "engine", sweepEngine,
			"initialStaleBound", collateral.bound(), "snapshotInterval", cfg.SnapshotInterval,
			"note", "the bound widens to twice interval-plus-pass once a full sweep completes")
	}
	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	for {
		for {
			anyAdvanced := false
			// EVERY worker's conditions — price workers included — are composed for the
			// WHOLE round and published ONCE. Two reasons, and the second one is a
			// regression this ordering exists to prevent: a step error and a no-progress
			// verdict on the same worker must coexist rather than erase each other; and
			// the Chainlink feed deriver is claimed by TWO passes (it is a price worker
			// and a raw-log consumer), so while the price pass published on its own the
			// later frontier pass replaced — deleted — everything it had reported.
			rc := roundConditions{}

			// Walker pass: ingestion first, so derivation sees the freshest
			// raw logs (and any rewind's reorg epoch) in the same round.
			if stepWalkers(ctx, walkers, rc) {
				anyAdvanced = true
			}

			// Derivation pass: each runner handles any pending reorg epoch
			// (RewindDerived before further apply — mandatory even for an
			// unhealthy engine) and derives bounded windows.
			if stepRunners(ctx, runners, rc, health) {
				anyAdvanced = true
			}

			// Snapshot pass: at most one multicall batch per round; a due
			// sweep keeps the loop hot until its generation completes. The
			// queue is durable — an error leaves it untouched for retry.
			if snap != nil {
				if stepSnapshotter(ctx, snap, &snapState, rc) {
					anyAdvanced = true
				}
				// Round-14 F4 / round-16 M4: keep the durable row's configured
				// cadence stamped on the CURRENT generation every round (no-op
				// once landed and stamped; a failure joins THIS round's health
				// composition — see persistSweepInterval).
				persistSweepInterval(ctx, st, sweepEngine, cfg.SnapshotInterval, rc)
			}

			// Price pass: each price worker answers any pending reorg epoch
			// (RewindPrices before further apply) and then does one bounded unit
			// of work — the poller at most one cadence-due multicall round, the
			// feed deriver at most stepsPerRound windows of AnswerUpdated logs.
			// Extracted into its own function so the composition (step, backoff,
			// error reporting, condition rebuild) is unit-testable against fake
			// workers, which it previously was not. Its conditions are richer than the
			// generic set the other passes produce, and they go into the SAME round
			// composition — the feed deriver is also judged by the frontier pass below,
			// and separate publications meant the later one won.
			if stepPriceWorkers(ctx, priceWorkers, rc) {
				anyAdvanced = true
			}

			// Silent-stall pass: a worker that neither errors nor advances says
			// nothing, and used to be invisible. This asks DURABLE storage when each
			// cursor last moved, how far each raw-log consumer is behind the chain head
			// its streams observed, whether an open sweep generation has stopped landing
			// batches, and whether any collateral account's snapshot has failed out of
			// its retry budget.
			applyProgressConditions(ctx, st, authority, rc, watch)
			rc.publish(health)

			health.heartbeat()
			if cleared := health.markInitialized(); cleared {
				slog.Info("daemon INITIALISED: dependency checks, worker construction and one full daemon round have all completed without a step failure; /readyz now reflects worker health rather than startup",
					"walkers", len(walkers), "runners", len(runners), "priceWorkers", len(priceWorkers))
			}
			if ctx.Err() != nil {
				break
			}
			// Advisory-lock liveness re-check per round (Phase 1 deferral):
			// a lost lock means another writer may be active — fatal.
			if err := st.CheckWriterLock(ctx); err != nil {
				return fmt.Errorf("writer-lock liveness check failed: %w", err)
			}
			if !anyAdvanced {
				break
			}
		}

		// Housekeeping per tick: drop reorg epochs every engine has acked, and
		// surface the composed health report once per tick round while anything
		// is wrong (a terminal transition itself was logged at Error). The log is
		// now a MIRROR of the queryable surface, not the surface itself.
		if ctx.Err() == nil {
			if pruned, err := st.PruneAckedReorgEpochs(ctx); err != nil {
				slog.Error("prune acked reorg epochs failed; will retry next tick", "err", err)
			} else if pruned > 0 {
				slog.Info("pruned fully-acknowledged reorg epochs", "rows", pruned)
			}
			if report := health.report(); !report.Ready {
				slog.Warn("daemon NOT READY (/readyz is failing): a \"starting\" status means initialisation has not completed; terminal entries need a restart at upgraded code; recoverable entries clear when the feed resumes, a round lands, a cursor moves, or the dependency recovers",
					"status", report.Status, "live", report.Live, "loopAge", report.LoopAge,
					"terminal", fmt.Sprintf("%v", report.Terminal),
					"recoverable", fmt.Sprintf("%v", report.Recoverable))
			}
		}

		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
