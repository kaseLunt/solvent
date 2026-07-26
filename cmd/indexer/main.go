package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"math"
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
	// Per-WORKER error backoff, TIME-based (fix wave: round counting was
	// burnable — a busy sibling keeps rounds spinning hot, so "skip N
	// rounds" could elapse in milliseconds). An erroring round schedules
	// the worker's next attempt by TIMESTAMP: exponential from
	// retryBackoffBase, capped at retryBackoffCap, with ±retryBackoffJitter
	// so parallel broken workers do not retry in lockstep. Shared by the
	// walkers and by Task 8's price workers (renamed from walkerBackoff when
	// the second user arrived — one implementation, not two).
	retryBackoffBase   = 30 * time.Second
	retryBackoffCap    = 10 * time.Minute
	retryBackoffJitter = 0.20
)

// retryBackoff schedules a worker's retries by next-attempt timestamp.
// ready() is state-free — a hot loop may poll it arbitrarily often without
// burning any of the delay — and only failure()/success() move state.
type retryBackoff struct {
	now      func() time.Time // injectable clock (tests)
	rand     func() float64   // uniform [0,1) jitter source (tests inject)
	failures int
	next     time.Time
}

// ready reports whether the worker may attempt work this round.
func (b *retryBackoff) ready() bool { return !b.now().Before(b.next) }

// failure records an erroring round and schedules the next attempt:
// base·2^(failures-1), capped, jittered ±retryBackoffJitter. Returns the
// chosen delay for logging.
func (b *retryBackoff) failure() time.Duration {
	b.failures++
	d := retryBackoffCap
	// Guarded shift: beyond a handful of doublings the cap always wins.
	if shift := b.failures - 1; shift < 10 {
		if scaled := retryBackoffBase << shift; scaled < retryBackoffCap {
			d = scaled
		}
	}
	d = time.Duration(float64(d) * (1 + retryBackoffJitter*(2*b.rand()-1)))
	b.next = b.now().Add(d)
	return d
}

// success resets the schedule after any non-erroring round.
func (b *retryBackoff) success() {
	b.failures = 0
	b.next = time.Time{}
}

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

// maxDerivedStaleness is THE FRESHNESS REQUIREMENT every lag gate in this daemon
// is derived from. It is stated in TIME, once, because time is the property that
// matters and block counts are only its per-chain expression.
//
// WHAT THE REQUIREMENT IS, AND WHY IT IS THIS. The tables this daemon serves are
// read to answer "is this position liquidatable at the current price". An answer
// computed from state T behind chain head is blind to every borrow, repay,
// collateral movement and liquidation that landed inside T, and it is wrong in the
// direction that costs money: a position reported healthy may already be
// liquidatable. So the requirement is an upper bound on T, and the bound has to sit
// between two things the deployment actually fixes:
//
//   - THE FLOOR, from what the pipeline can achieve. Ingestion trails head by its
//     stream's `confirmations` by design (5 on both configured streams — about 60s
//     of chain time on Ethereum at 12s blocks, 10s on OP at 2s), and a caught-up
//     consumer ends each round at its walkers' frontier. So no achievable bound is
//     tighter than roughly one minute on Ethereum; a requirement below that would be
//     permanently unsatisfiable and would make /readyz meaningless rather than
//     strict.
//   - THE CEILING, from what this process is willing to call "current". The feed
//     deriver already refuses to judge oracle publication at all once the head block's
//     own timestamp is more than ten minutes old, reporting rpc_ingest_lag instead
//     (internal/prices.headFreshnessBound): past that point the daemon declares that
//     it cannot see the chain. Derived state further behind head than the daemon's own
//     threshold for "we can see the chain" cannot honestly be served as ready.
//
// TEN MINUTES is that ceiling, taken deliberately rather than by coincidence: it is
// the staleness at which this process already stops trusting its own view of the
// chain, so it is the loosest value at which /readyz can still mean anything. It
// leaves an order of magnitude above the achievable floor, so ordinary jitter
// cannot trip it.
//
// WHAT IT APPLIES TO, stated narrowly (amendment L8): LOG-DERIVED state and the
// prices built from it — the raw-log walkers and the raw-log consumers (derivation
// runners and the Chainlink feed deriver). It does NOT apply to collateral
// snapshots, which are not log-derived at all: OP collateral comes from a live view
// sweep on its own cadence, and its freshness is gated separately and on its own
// terms by collateralStaleBound / conditionCollateralUnusable. Applying this bound
// there would be permanently red on any deployment whose snapshot interval exceeds
// ten minutes, which is every realistic one.
//
// HOW IT IS CHECKED, and why the check is not a re-tuning of its predecessor. The
// previous gate converted this duration into a per-chain BLOCK COUNT using nominal
// cadences and compared distances. Produced-block distance is not elapsed time:
// under missed slots or degraded production the same count spans longer, so a
// distance comparison can pass while the state served is well past ten minutes old
// — false-green precisely when the chain is degraded. The gate now subtracts the
// CURSOR BLOCK'S OWN HEADER TIMESTAMP from now (see stalenessJudge). Block
// distances survive only as attribution metadata, never as the bound.
const maxDerivedStaleness = 10 * time.Minute

// headerTimeSkewTolerance is how far in the FUTURE a fetched header timestamp may
// sit before the daemon treats it as a broken measurement rather than a fresh block.
//
// Within the tolerance the age clamps to zero: chains legitimately produce blocks a
// second or two ahead of a daemon whose clock is not perfectly synchronised, and
// calling that a failure would flap on ordinary NTP drift. Beyond it the reading is
// not "very fresh", it is wrong — a wrong-unit timestamp (milliseconds read as
// seconds) lands ~56,000 years ahead — and it is reported as
// staleness_unmeasured and NEVER memoized (amendment L2). Memoizing it would pin
// the worker at age 0 permanently, which is the exact false-green this wave exists
// to remove.
const headerTimeSkewTolerance = 60 * time.Second

// headerFetchTimeout bounds ONE header measurement, including its failover walk.
// The chain client's own per-endpoint timeout is far larger (it is sized for
// getLogs), and a measurement is not worth stalling a daemon round for: an
// unanswered fetch is simply an unmeasured bound, which fails closed anyway.
const headerFetchTimeout = 10 * time.Second

// headerFetchCooldown is how long a chain whose header fetch FAILED is left alone
// before the next attempt (amendment L4b). Rounds inside the window emit
// staleness_unmeasured carrying the retained error WITHOUT paying the timeout
// again.
//
// It is load-bearing for throughput, not politeness. The staleness pass runs inside
// the daemon's HOT INNER LOOP — there is no ticker between rounds while any worker
// is advancing — so without a cooldown a single dead chain would burn
// headerFetchTimeout on EVERY round, and a concurrent backfill on a healthy chain
// would collapse by roughly the ratio of that timeout to a round.
//
// It is measurement SCHEDULING, not verdict memory: the red is re-derived from
// scratch each round and clears on the first successful fetch after the window.
const headerFetchCooldown = 30 * time.Second

// headerRestampThrottle is the fail-closed reuse window for a header stamp taken at
// an EARLIER block on the same chain (amendment L5, extended by round 9's [high]).
//
// A backfilling worker moves its cursor every round, so the exact-block memo misses
// every round and the pass would fetch a header per worker per round — on the same
// endpoints ingestion itself needs, for the whole multi-day backfill. Reuse is safe
// in ONE direction only and the code enforces exactly that direction: the retained
// stamp must belong to a block at or below the one being judged, so its timestamp is
// at or below the true one and the computed age can only be an OVER-estimate. A
// reused stamp can therefore report a worker stale that is actually fresh; it can
// never report one fresh that is actually stale.
//
// TWO DISJOINT REGIMES ARE ADMITTED, and the gap between them is deliberate:
//
//   - NEAR-HEAD, where the over-estimated age sits inside HALF the bound, so the
//     approximation is never what decides a verdict near the line.
//   - DEEP-STALE, where the retained stamp's own implied age ALREADY EXCEEDS the
//     bound. This arm exists because the near-head one is UNREACHABLE during a
//     genuine historical backfill — a cursor days behind head can never imply an age
//     inside five minutes — so before it every gated worker refetched every hot
//     round, taxing exactly the endpoints the backfill itself depends on (Codex
//     round 9's [high]). It is structurally incapable of a false green: the reused
//     timestamp is already past the bound, and reuse only over-estimates, so the
//     verdict it can produce is always `staleness`. The cost of being wrong is a
//     worker that has just caught up staying red a little longer — the fail-closed
//     direction.
//
// Between bound/2 and bound NEITHER arm applies: that band is where an approximation
// could flip a verdict, so it is paid for with an exact read.
//
// THE TWO BOUNDS ON REUSE, both stated because both are load-bearing:
//
//  1. TIME — this window, which is therefore also the PERIODIC EXACT-REFRESH
//     cadence: a stamp is reusable only for 30 s after THE FETCH THAT PRODUCED IT,
//     so every window each chain pays at least one real header read that re-anchors
//     the measurement, and a worker that has caught up is re-measured inside it. The
//     cadence is taken from the fetch budget this pass has ALREADY accepted on its
//     failure path — one attempt per chain per headerFetchCooldown (also 30 s), each
//     costing up to headerFetchTimeout (10 s). A success-path read is a single
//     eth_getBlockByNumber and costs far less than that, so the same cadence sits
//     strictly inside a budget already justified. Loosening it would only delay
//     catch-up detection; tightening it buys nothing, since a deep-stale worker's
//     verdict is red either way.
//  2. ROUNDS AND BLOCKS — bounded BY (1), not by a second constant, and that is a
//     deliberate refusal. A reuse never renews the window: fetchedAt is written only
//     by a real fetch, so no number of reuses, rounds or blocks can extend an
//     anchor's life past one window. A separate block-span cap would have to convert
//     blocks into elapsed time, which is precisely the nominal-cadence conversion
//     this wave deleted from the gate; there is no constant for it anyone could
//     derive, so none is invented. What the window guarantees is unit-free instead:
//     at most 30 s worth of rounds, and at most whatever block distance a worker can
//     cover in 30 s.
const headerRestampThrottle = 30 * time.Second

// collateralStaleBound is how old a per-account collateral snapshot may be before
// conditionCollateralUnusable fires — a RELATIVE bound, derived from the cadence
// the deployment actually achieves rather than from a constant.
//
// WHY IT CANNOT BE A CONSTANT, and why the obvious constant is arithmetically
// wrong. The natural guess is max(2·interval, noProgressBound). It does not hold:
// SweepWorkBatch never re-selects an account that already succeeded in the CURRENT
// generation, so an account is re-read once per generation, and a generation takes
// a full pass — interval + passDuration — to come round again. On any sizable
// registry the pass duration dominates the interval, so a bound ignoring it is
// permanently exceeded under perfectly healthy operation and the gate would be red
// forever on a working system. That is the false-positive direction, and a gate
// that is always red is a gate nobody reads.
//
// WHAT THE GATE THEREFORE CERTIFIES, stated honestly (controller ruling OQ3): "this
// account's collateral is as fresh as the sweep cadence this deployment actually
// achieves permits" — not an absolute age. If the registry grows until a pass takes
// a day, the bound grows with it and the gate stops meaning "fresh enough for
// liquidation decisions" while still reading green. That residual is ACCEPTED and
// recorded here rather than patched over with an absolute ceiling: any ceiling
// would be a number nobody derived, which is exactly the borrowed-constant
// reasoning that produced the block-count bound this wave is removing. The honest
// alarm for that scenario is the pass duration itself, which is visible in the
// condition's reason text.
//
// The factor of two absorbs ordinary jitter (a slow batch, a retry, a restart
// mid-pass) so the gate does not flap on a healthy deployment, and noProgressBound
// is the floor so a deployment with a very short interval and a tiny registry still
// gets a bound wide enough to be meaningful.
func collateralStaleBound(interval, lastPass time.Duration) time.Duration {
	if b := 2 * (interval + lastPass); b > noProgressBound {
		return b
	}
	return noProgressBound
}

// collateralBoundState carries collateralStaleBound's second input across daemon
// rounds. The achieved pass duration is only knowable from a COMPLETED generation,
// and the store reports it in the very call that needs the bound as an argument, so
// the daemon judges round N with the duration it learned in round N-1.
//
// The one-round lag is immaterial: a pass duration changes over the timescale of
// whole sweeps, not of daemon rounds. Before any generation has ever completed the
// retained value is zero and the bound degrades to max(2·interval, noProgressBound)
// — the naive formula, correct only while no pass duration exists to know.
//
// IT IS NO LONGER THE ONLY COPY, and that is round 9's restart finding. This value
// used to be pure process memory over a store fact that was destroyed the moment a
// generation opened (OpenSweepGeneration NULLs completed_at), so a restart during a
// long healthy sweep threw the achieved cadence away and collapsed the bound to the
// naive formula for the REST of that generation — false-red readiness for hours or
// days on a large registry, after every restart, on a surface whose entire premise
// is that a restart neither grants nor destroys a verdict. The duration is now
// durable (migration 00008), this state is HYDRATED from it before the first verdict
// (hydrate), and observe keeps carrying it across rounds so nothing changes in the
// hot path.
type collateralBoundState struct {
	// interval is the configured sweep cadence (SOLVENT_SNAPSHOT_INTERVAL).
	interval time.Duration
	// lastPass is the most recent COMPLETED generation's duration, retained across
	// rounds so the per-round read does not have to be the only source, and
	// re-established from the store at startup by hydrate.
	lastPass time.Duration
}

// bound is the value to judge this round with.
func (c *collateralBoundState) bound() time.Duration {
	return collateralStaleBound(c.interval, c.lastPass)
}

// observe retains a newly-reported pass duration. Zero is ignored rather than
// stored: it means "no generation has completed", not "a pass took no time".
func (c *collateralBoundState) observe(d time.Duration) {
	if d > 0 {
		c.lastPass = d
	}
}

// lastPassReader is the narrow store surface hydrate needs (*store.Store satisfies
// it). It is deliberately not progressReader: hydration happens once, at startup,
// before any verdict, and it must not be able to reach the per-round counts.
type lastPassReader interface {
	SweepLastPassDuration(ctx context.Context, engine string) (time.Duration, bool, error)
}

// hydrate re-establishes the achieved pass duration from durable state, before the
// daemon issues its FIRST collateral verdict.
//
// WITHOUT IT the fix to the store is only half a fix. The bound's input is durable
// now, but the first round of a restarted process would still judge with lastPass
// zero — the naive formula — because the per-round read only feeds the NEXT round
// (that is the one-round lag the type exists to manage). One round of false-red at
// every restart is small, but it is the same defect in miniature, and a surface that
// gates liquidation-facing data should not have to be described as "wrong only
// briefly".
//
// A FAILED READ IS NOT FATAL and is not silent either. The naive bound is the
// TIGHTER of the two (a smaller bound counts more accounts stale), so falling back
// to it errs red — the fail-closed direction — and the very next round's
// SweepProgress restores the durable value through observe anyway. Refusing to boot
// over a transient query failure would trade a brief over-strict readiness answer
// for no readiness answer at all.
func (c *collateralBoundState) hydrate(ctx context.Context, r lastPassReader, engine string) {
	d, found, err := r.SweepLastPassDuration(ctx, engine)
	if err != nil {
		slog.Warn("could not hydrate the collateral staleness bound from durable sweep state; this round judges with the naive interval-only bound, which is the TIGHTER of the two (it errs red, never green), and the next round restores it",
			"engine", engine, "err", err)
		return
	}
	if !found {
		return // no completed pass on record: the naive bound is the honest one
	}
	c.observe(d)
}

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

// roundConditions accumulates EVERY worker's conditions for ONE daemon round so
// each worker's entry set reaches the surface in a single replacement.
//
// IT IS THE ONLY WAY RECOVERABLE CONDITIONS REACH THE SURFACE, and that is a
// correctness property, not a style choice. Publication REPLACES a worker's
// entries — which is what makes recovery visible — so two passes publishing the
// same worker separately erase each other and the survivor depends on pass order.
// That is not hypothetical: the frontier pass and the price pass both own the
// Chainlink feed deriver (it is a raw-log consumer AND a price worker), and while
// they published independently the later one deleted the earlier one's conditions
// every round. Composing first makes them additive.
//
// Two things keep it that way rather than merely fixing that instance:
//
//   - there is no per-worker replace primitive left to misuse. healthState exposes
//     publishRound, which takes the WHOLE round's composition; a new publisher has
//     nowhere to write except into a roundConditions someone else may also write to,
//     and set() merges by condition name.
//   - a second publication of the same worker inside ONE round is detected by
//     healthState and MERGED rather than allowed to replace, with an Error log
//     naming the worker. See healthState.publishRound.
type roundConditions map[string]map[string]string

// set records one condition for one worker. Two different conditions on one worker
// coexist; the same condition name written twice in one round is a NAME COLLISION
// between publishers, which is reported and resolved first-writer-wins — readiness
// turns on a condition's presence, so the collision itself is the defect worth
// surfacing, not which of the two reasons survived.
func (rc roundConditions) set(worker, name, reason string) {
	m := rc[worker]
	if m == nil {
		m = map[string]string{}
		rc[worker] = m
	}
	if existing, dup := m[name]; dup {
		slog.Error("two daemon passes published the SAME condition key for the same worker in one round; keeping the first and reporting the collision — condition keys are an operational contract and must identify one publisher",
			"worker", worker, "condition", name, "kept", existing, "dropped", reason)
		return
	}
	m[name] = reason
}

// touch registers a worker with (so far) no conditions. Without it a recovered
// worker would keep its previous round's entries forever, because publication only
// replaces the workers it knows about.
func (rc roundConditions) touch(worker string) {
	if rc[worker] == nil {
		rc[worker] = map[string]string{}
	}
}

// has reports whether this round already carries a named condition for a worker.
//
// It exists for ONE purpose: making an attribution-only signal structurally unable
// to act as a gate. frontier_lag is emitted only when the same consumer already
// carries a freshness verdict this round (amendment L3), and asking the round's own
// composition is what makes that a property of the code rather than a convention a
// later publisher could quietly break.
func (rc roundConditions) has(worker, name string) bool {
	_, ok := rc[worker][name]
	return ok
}

// publish hands the whole round's composition to the surface in one call.
func (rc roundConditions) publish(health *healthState) {
	health.publishRound(rc)
}

// stepWalkers runs ONE raw-log ingestion pass and records each walker's failure
// state on the health surface.
//
// The recording is the fix: a walker error used to reach a log line and a local
// backoff and nothing else, so a Debt Manager or Aave stream that failed every
// round for hours left /readyz answering 200. Ingestion is the input every derived
// table depends on; a stalled walker is the most consequential silent failure this
// daemon has.
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
						slog.Error("step failed; will retry after backoff", "stream", ws.w.Name(), "err", err)
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
			rc.set(ws.w.Name(), conditionStepError,
				fmt.Sprintf("ingest Step failed %d consecutive round(s), retrying in %s: %v",
					ws.bo.failures, ws.retryIn.Truncate(time.Second), ws.lastErr))
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

// headerTimeFetcher reads the header TIMESTAMP (unix seconds) of one block on one
// chain. *chain.Failover's HeaderTime satisfies it through the daemon's per-chain
// client map; tests pass a fake so the elapsed-time gate can be driven without a
// chain.
type headerTimeFetcher func(ctx context.Context, chainID, block uint64) (uint64, error)

// stampKey identifies one header measurement: a block on a chain. Deliberately NOT
// keyed by worker (amendment L5) — two workers sitting at the same cursor block on
// the same chain are asking one question, and keying by worker would pay for it
// twice. (The ONE thing that is worker-keyed is the deep-stale backfill anchor, and
// stalenessJudge.backfill says why that key is right there and wrong here.)
type stampKey struct {
	chainID uint64
	block   uint64
}

// headerStamp is one successful header measurement, retained per chain.
type headerStamp struct {
	// block is the height the stamp describes. Reuse for a DIFFERENT height is
	// admitted only upward (block <= the height being judged), which is what makes
	// the approximation fail-closed — see headerRestampThrottle.
	block uint64
	// at is the header's own timestamp.
	at time.Time
	// fetchedAt is when the daemon read it, for the reuse window.
	fetchedAt time.Time
}

// stalenessJudge measures how old the state a worker serves actually is, and holds
// the only state that must survive between daemon rounds: retained header stamps
// and the per-chain retry cooldown.
//
// WHAT IS DELIBERATELY NOT HERE: the set of chains whose fetch failed THIS ROUND.
// That set lives in stalenessRound, constructed fresh by the caller every round
// (amendment L4a). Holding it on the judge admits a fail-forever — a chain marked
// down once would stay down until something explicitly cleared it, and "something
// explicitly clears it" is exactly the shape of bug this surface has shipped
// before. A verdict here is re-derived from scratch each round; only the
// measurement SCHEDULE persists.
type stalenessJudge struct {
	fetch headerTimeFetcher
	// stamp is the most recent successful measurement per chain (see headerStamp).
	stamp map[uint64]headerStamp
	// backfill is the DEEP-STALE anchor, and it is keyed per REUSE SCOPE (a worker)
	// rather than per chain — the one place in this judge where that is the right
	// key, and for a reason worth stating because the chain key is right everywhere
	// else.
	//
	// "This cursor is deep-stale and advancing" is a claim about ONE worker, not
	// about a chain. Chains routinely carry a caught-up worker and a backfilling one
	// at once (a newly-added stream, a post-rewind re-derive), and letting the
	// backfiller's three-day-old anchor answer for the caught-up worker would report
	// a demonstrably fresh worker as stale. That is fail-closed, but it is also
	// wrong, and a gate that names the wrong worker is a gate an operator learns to
	// distrust. The chain-keyed stamp above still serves the exact-block hit and the
	// near-head throttle, where sharing across workers IS the right answer because
	// the approximation there is small by construction.
	backfill map[string]headerStamp
	// nextFetchAttempt and lastFetchErr are the per-chain retry cooldown: while now
	// is before the attempt time, the retained error is reported and no fetch is
	// paid for. Both are cleared by the next successful fetch.
	nextFetchAttempt map[uint64]time.Time
	lastFetchErr     map[uint64]error
}

func newStalenessJudge(fetch headerTimeFetcher) *stalenessJudge {
	return &stalenessJudge{
		fetch:            fetch,
		stamp:            map[uint64]headerStamp{},
		backfill:         map[string]headerStamp{},
		nextFetchAttempt: map[uint64]time.Time{},
		lastFetchErr:     map[uint64]error{},
	}
}

// stalenessRound is the ROUND-SCOPED half of the measurement, constructed fresh by
// the caller for every round (amendment L4a — see stalenessJudge). It bounds the
// round's cost: one fetch per (chain, block) at most, and one failed fetch per
// chain at most.
type stalenessRound struct {
	// stamps memoizes this round's measurements by (chain, block), so several
	// workers at one height share one fetch (invariant I4′).
	stamps map[stampKey]time.Time
	// down records the chains whose fetch failed THIS round, with the error, so the
	// second worker on a dead chain reports the same failure without paying the
	// timeout again.
	down map[uint64]error
	// fetches counts header reads actually attempted this round. It exists so the
	// pass can report its own cost rather than the report asserting one.
	fetches int
}

func newStalenessRound() *stalenessRound {
	return &stalenessRound{stamps: map[stampKey]time.Time{}, down: map[uint64]error{}}
}

// measure returns the header timestamp of (chainID, block), or an error naming why
// no measurement could be made this round.
//
// THE ORDER OF THE CHECKS IS THE CONTRACT (amendment L5), not an optimisation:
//
//  0. the future-skew guard, applied to EVERY reuse path before anything is returned
//     from one (round 9's memo-bypass finding — see rejectSkewedReuse);
//  1. this round's memo — one fetch per (chain, block) per round;
//  2. a retained CHAIN stamp for the SAME block — a block's timestamp is immutable,
//     so a stamp taken an hour ago is still exactly right, and the age computed from
//     it grows correctly as the cursor stands still. This is why a worker wedged on a
//     dead chain still gets a REAL measured verdict (and goes red on elapsed time)
//     rather than an unmeasured one;
//  3. a retained CHAIN stamp for an EARLIER block, inside the reuse window and
//     comfortably inside the bound — the near-head fail-closed throttle;
//  4. this WORKER's own deep-stale anchor, inside the same window — the
//     historical-backfill arm (see headerRestampThrottle for both bounds);
//  5. only then the round's down set, then the cooldown, then an actual fetch.
//
// Steps 1-4 run BEFORE 5 deliberately: a held valid stamp must not be discarded
// because the chain happens to be unreachable right now. Step 0 runs before ALL of
// them for the opposite reason: a held stamp that has become invalid must not be
// served just because it is held.
//
// scope names the reuse scope of step 4 — the worker whose cursor is being dated.
// An empty scope disables that arm, which is what a measurement belonging to no
// single worker should do rather than borrow another worker's anchor.
func (j *stalenessJudge) measure(ctx context.Context, r *stalenessRound, now time.Time, scope string, chainID, block uint64, bound time.Duration) (time.Time, error) {
	key := stampKey{chainID: chainID, block: block}
	if t, ok := r.stamps[key]; ok {
		if err := j.rejectSkewedReuse(r, now, scope, chainID, t); err != nil {
			return time.Time{}, err
		}
		return t, nil
	}
	if s, held := j.stamp[chainID]; held {
		if err := j.rejectSkewedReuse(r, now, scope, chainID, s.at); err != nil {
			return time.Time{}, err
		}
		switch {
		case s.block == block:
			// Exact and immutable: no fetch, no staleness of its own.
			r.stamps[key] = s.at
			return s.at, nil
		case s.block < block &&
			now.Sub(s.fetchedAt) < headerRestampThrottle &&
			now.Sub(s.at) <= bound/2:
			// NEAR-HEAD fail-closed reuse: an earlier block's timestamp is at or
			// below the true one, so the age this yields is an over-estimate, and
			// the over-estimate is far enough from the bound not to decide anything.
			r.stamps[key] = s.at
			return s.at, nil
		}
	}
	// DEEP-STALE fail-closed reuse — the historical-backfill arm (round 9's [high]),
	// and the reason it reads THIS WORKER'S anchor rather than the chain's is in
	// stalenessJudge.backfill. The anchor is already past the bound and reuse only
	// over-estimates age, so this arm cannot return anything a verdict would read as
	// fresh: it is green-proof by construction, not by argument. It is what stops a
	// genuine backfill — where the near-head arm above is arithmetically unreachable
	// — from paying one header read per gated worker per hot round. Reuse does not
	// renew the window, so the worker is re-anchored by a real read at least once
	// per headerRestampThrottle.
	if s, held := j.backfill[scope]; scope != "" && held {
		if err := j.rejectSkewedReuse(r, now, scope, chainID, s.at); err != nil {
			return time.Time{}, err
		}
		if s.block < block &&
			now.Sub(s.fetchedAt) < headerRestampThrottle &&
			now.Sub(s.at) > bound {
			r.stamps[key] = s.at
			return s.at, nil
		}
	}
	if err, down := r.down[chainID]; down {
		return time.Time{}, err
	}
	if next, scheduled := j.nextFetchAttempt[chainID]; scheduled && now.Before(next) {
		err := j.lastFetchErr[chainID]
		if err == nil {
			err = errors.New("header fetch is in its retry cooldown")
		}
		retained := fmt.Errorf("no header fetch attempted (retrying in %s after: %w)",
			next.Sub(now).Truncate(time.Second), err)
		r.down[chainID] = retained
		return time.Time{}, retained
	}

	fetchCtx, cancel := context.WithTimeout(ctx, headerFetchTimeout)
	secs, err := j.fetch(fetchCtx, chainID, block)
	cancel()
	r.fetches++
	if err != nil {
		// A CANCELLED round context is shutdown, not a measurement failure
		// (amendment L7): it must not arm a cooldown or produce a verdict.
		if ctx.Err() != nil {
			return time.Time{}, err
		}
		wrapped := fmt.Errorf("header %d on chain %d: %w", block, chainID, err)
		r.down[chainID] = wrapped
		j.nextFetchAttempt[chainID] = now.Add(headerFetchCooldown)
		j.lastFetchErr[chainID] = wrapped
		return time.Time{}, wrapped
	}
	// The uint64→int64 conversion is guarded rather than trusted: a wrapped value
	// would land far in the past and read as stale, which is at least fail-closed,
	// but naming it is honest and keeps the future-skew check below meaningful.
	if secs > uint64(math.MaxInt64) {
		wrapped := fmt.Errorf("header %d on chain %d reports timestamp %d, which is not a representable time", block, chainID, secs)
		r.down[chainID] = wrapped
		j.nextFetchAttempt[chainID] = now.Add(headerFetchCooldown)
		j.lastFetchErr[chainID] = wrapped
		return time.Time{}, wrapped
	}
	ts := time.Unix(int64(secs), 0).UTC()
	// FUTURE-SKEW SANITY (amendment L2). A timestamp beyond the tolerance is a
	// broken measurement, not a fresh block, and it is NEVER memoized — memoizing
	// one would pin every worker on this chain at age 0 permanently. It arms the
	// cooldown for the same reason a transport failure does: the endpoint's answer
	// is unusable and retrying it immediately, every round, buys nothing.
	if beyondSkewTolerance(ts, now) {
		wrapped := fmt.Errorf("header %d on chain %d claims %s, which is more than %s in the future: the timestamp is unusable, not fresh",
			block, chainID, ts.Format(time.RFC3339), headerTimeSkewTolerance)
		r.down[chainID] = wrapped
		j.nextFetchAttempt[chainID] = now.Add(headerFetchCooldown)
		j.lastFetchErr[chainID] = wrapped
		return time.Time{}, wrapped
	}
	r.stamps[key] = ts
	stamp := headerStamp{block: block, at: ts, fetchedAt: now}
	j.stamp[chainID] = stamp
	// The exact read just taken is also this worker's new deep-stale anchor, and
	// re-anchoring is the ONLY thing that resets the reuse window: reuse never
	// writes here, so the window measures from the fetch (see headerRestampThrottle).
	if scope != "" {
		j.backfill[scope] = stamp
	}
	delete(j.nextFetchAttempt, chainID)
	delete(j.lastFetchErr, chainID)
	return ts, nil
}

// beyondSkewTolerance is amendment L2's predicate, factored out so the ONE rule is
// evaluated at every point a header timestamp enters a verdict — at the fetch that
// produces it AND at every reuse of a retained one. Two copies of the same
// comparison is how the two arms drift apart, and one arm gated with the other open
// is the exact shape this surface has now shipped twice.
func beyondSkewTolerance(headerTime, now time.Time) bool {
	return headerTime.After(now.Add(headerTimeSkewTolerance))
}

// rejectSkewedReuse is the READ-OUT half of the future-skew guard (Codex round 9's
// memo-bypass finding). It returns nil when the retained measurement is still usable
// and, when it is not, EVICTS it and returns the measurement failure the round must
// report.
//
// WHY A WRITE-TIME CHECK WAS NOT ENOUGH. measure validated skew only at the fetch,
// so the memo, the exact-block hit and the restamp throttle all returned a retained
// timestamp without re-examining it. Validity of a stamp is not a property of the
// stamp alone — it is a relation between the stamp and the CURRENT clock, and the
// clock moves. A daemon clock stepped backwards by more than the tolerance (an NTP
// correction, a VM restore, a hypervisor rollback) turns an entirely legitimate
// cached stamp grossly future; stalenessAge then clamps the negative age to zero and
// every worker on that chain reads FOREVER-FRESH, at a block nothing ever re-reads
// because the memo answers first. That is a false-green with no exit — precisely
// what amendment L2 was written to make impossible, defeated by the path L2 was not
// applied to.
//
// The eviction is CHAIN-WIDE and covers this round's memo as well: the retained
// stamp and every memo entry derived from it come from the same broken relation, so
// leaving any of them in place would just move the false green one lookup along.
//
// It deliberately does NOT arm the per-chain fetch cooldown. Nothing has been shown
// to be wrong with the ENDPOINT — the daemon's own clock is the thing that moved —
// and arming a 30 s cooldown here would extend the unmeasured window past the moment
// the clock is corrected. The chain is put in the round's down set so the remaining
// workers on it pay nothing more this round, and the NEXT round re-fetches: if the
// clock is still rolled back the fetch path's own L2 check fires and arms the
// cooldown there, which is where endpoint-fault semantics belong.
func (j *stalenessJudge) rejectSkewedReuse(r *stalenessRound, now time.Time, scope string, chainID uint64, headerTime time.Time) error {
	if !beyondSkewTolerance(headerTime, now) {
		return nil
	}
	wrapped := fmt.Errorf("the retained header timestamp for chain %d reads %s, which is more than %s ahead of this daemon's clock (%s): a measurement that was valid when it was taken has been invalidated by the clock moving, so it is discarded rather than reused",
		chainID, headerTime.Format(time.RFC3339), headerTimeSkewTolerance, now.Format(time.RFC3339))
	delete(j.stamp, chainID)
	delete(j.backfill, scope)
	for k := range r.stamps {
		if k.chainID == chainID {
			delete(r.stamps, k)
		}
	}
	r.down[chainID] = wrapped
	return wrapped
}

// stalenessAge is now minus a header timestamp, clamped at zero.
//
// The clamp is amendment L2's other half: a header a few seconds ahead of this
// process's clock is ordinary skew, and a negative age would render as nonsense
// in the reason text. Anything genuinely far ahead never reaches here — measure
// rejects it as a broken measurement at the fetch that produced it AND at every
// reuse of a retained one (beyondSkewTolerance / rejectSkewedReuse), so the clamp
// can only ever be absorbing ordinary skew, never hiding a rolled-back clock.
func stalenessAge(now, headerTime time.Time) time.Duration {
	if age := now.Sub(headerTime); age > 0 {
		return age
	}
	return 0
}

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
func applyProgressConditions(ctx context.Context, pr progressReader, now time.Time, rc roundConditions, w progressWatch) {
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

	check := func(rows []store.CursorProgress, watched map[string]bool, kind string) {
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

	applyStalenessConditions(ctx, now, rc, w, ingestRows, ingestErr, deriveRows, deriveErr)

	if w.sweepEngine != "" {
		applySweepProgressCondition(ctx, pr, now, rc, w)
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
func applyStalenessConditions(ctx context.Context, now time.Time, rc roundConditions, w progressWatch,
	ingestRows []store.CursorProgress, ingestErr error, deriveRows []store.CursorProgress, deriveErr error) {
	if w.staleness == nil {
		return
	}
	// FRESH EVERY ROUND (amendment L4a): the down set and the per-round memo are
	// local values, so no verdict can outlive the round that derived it.
	r := newStalenessRound()

	block := func(rows []store.CursorProgress) map[string]uint64 {
		m := make(map[string]uint64, len(rows))
		for _, p := range rows {
			m[p.Name] = p.Block
		}
		return m
	}

	// judge writes one worker's freshness verdict and reports the header time it
	// measured (measured=false when it could not be measured at all).
	judge := func(worker, kind string, chainID, at uint64) (time.Time, bool) {
		ts, err := w.staleness.measure(ctx, r, now, worker, chainID, at, maxDerivedStaleness)
		if err != nil {
			if ctx.Err() != nil {
				return time.Time{}, false // shutdown, not a verdict (amendment L7)
			}
			rc.set(worker, conditionStalenessUnmeasured,
				fmt.Sprintf("this %s cursor stands at block %d on chain %d and the daemon could not read that block's header timestamp, so it cannot certify the %s freshness bound: %v",
					kind, at, chainID, maxDerivedStaleness, err))
			return time.Time{}, false
		}
		if age := stalenessAge(now, ts); age > maxDerivedStaleness {
			rc.set(worker, conditionStaleness,
				fmt.Sprintf("this %s cursor stands at block %d on chain %d, whose header timestamp is %s (%s old, bound %s): the state this worker serves describes a chain that far in the past",
					kind, at, chainID, ts.Format(time.RFC3339), age.Truncate(time.Second), maxDerivedStaleness))
		}
		return ts, true
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
			ts, measured := judge(c.worker, "derive", c.chainID, at)
			applyFrontierAttribution(ctx, now, rc, w, r, c, at, ts, measured, frontier, ingestErr)
		}
	}

	if r.fetches > 0 {
		slog.Debug("staleness pass header reads", "fetches", r.fetches,
			"gatedWorkers", len(w.walkers)+len(w.consumers))
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
func applySweepProgressCondition(ctx context.Context, pr progressReader, now time.Time, rc roundConditions, w progressWatch) {
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
	}
	watch := progressWatch{
		walkers: walkers, runners: runners, consumers: consumers,
		sweepEngine: sweepEngine, sweepMaxAttempts: snapshot.MaxSweepAttempts,
		staleness: newStalenessJudge(headerTime), collateral: collateral,
	}
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
			if snap != nil && stepSnapshotter(ctx, snap, &snapState, rc) {
				anyAdvanced = true
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
			applyProgressConditions(ctx, st, time.Now(), rc, watch)
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
