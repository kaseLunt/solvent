package ingest

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"math"
	"reflect"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/store"
)

// Chain is the walker's chain surface. Since Task 9 wave 12 it is ENDPOINT-
// AWARE: every read is a caller-scoped *From method that walks endpoints from
// an explicit start and stamps the token of the endpoint that answered
// (chain.Failover's doFrom contract). The walker was endpoint-blind before —
// no tokens, no From variants — which made its per-Step endpoint affinity
// "documented, not enforced": window pieces could legitimately be assembled
// cross-endpoint after any mid-window rotation, the exact ambiguity that made
// the OP incident undiagnosable for hours (chain-truth consult Q1).
//
// ActiveEndpoint is READ-ONLY here: it seeds the very first Step's start.
// Nothing in this package ever writes the shared routing hint — a shared hint
// structurally cannot carry a caller-specific exclusion (the Task 7 wave-6
// RotateAwayFrom deletion and d1e7d54's ambiguity rules are accepted-decision-
// level; the consult's R3 sibling-interference schedule exists to kill any
// reimplementation).
type Chain interface {
	ActiveEndpoint() int
	EndpointCount() int
	BlockNumberFrom(ctx context.Context, startIndex int) (uint64, chain.EndpointToken, error)
	HeaderHashFrom(ctx context.Context, startIndex int, n uint64) (common.Hash, chain.EndpointToken, error)
	LogsFrom(ctx context.Context, startIndex int, from, to uint64, addrs []common.Address) ([]types.Log, chain.EndpointToken, error)
}

type Store interface {
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	SaveBatch(ctx context.Context, stream string, chainID uint64, logs []store.RawLog, tipBlock uint64, tipHash []byte) error
	Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error
	HighestLogAtOrBelow(ctx context.Context, chainID, height uint64) (block uint64, blockHash []byte, found bool, err error)
}

// DiscardError is a Step's DISCARD outcome: the window (or rewind evidence)
// was incoherent — tip moved mid-fetch, cursor hash changed mid-Step, or a
// pinned read was served by a different endpoint — so nothing was saved and
// nothing was learned that clears the stream.
//
// It is a TYPED error deliberately (Task 9 wave 12 F2): the pre-wave shape
// returned (false, nil) for these arms, which the daemon counted as SUCCESS —
// backoff reset every round, no step_error, an invisible wedge with a WORSE
// detection profile than the incident's error loop. A discard now surfaces as
// its own outcome so the daemon can keep the failure streak growing and the
// health surface honest (the round-3 [medium] pacing/visibility law, applied
// at ingest), while remaining distinguishable from both a landing and a plain
// error. Routing does not depend on this type: the discard advances the
// stream's start through the same deferred seam as every non-landing exit.
type DiscardError struct {
	Stream string
	Reason string
}

func (d *DiscardError) Error() string {
	return fmt.Sprintf("window discarded (non-landing): %s", d.Reason)
}

type WalkerConfig struct {
	Stream        string
	ChainID       uint64
	Addresses     []common.Address
	StartBlock    uint64
	Window        uint64
	Confirmations uint64
}

type Walker struct {
	chain Chain
	store Store
	cfg   WalkerConfig
	// addrSet mirrors cfg.Addresses for O(1) log-address membership checks.
	// It is never empty: wildcard streams (empty address set) are unsupported
	// and rejected by config validation, so an empty set here would silently
	// fail every batch on the address check.
	addrSet map[common.Address]struct{}

	// startPref is THIS STREAM'S routing state: the endpoint index the next
	// Step's serving-endpoint resolution starts from. -1 until first touched,
	// which means "seed from the shared hint, read-only". It joins the
	// existing single-writer per-Step concurrency contract below — written
	// only from Step's goroutine, zero new concurrency surface.
	//
	// RETENTION, NOT RESET (chain-truth consult Q2.3): a landing sets it to
	// the endpoint that served the landed Step — the stream's own affinity —
	// and it is never reset to follow the shared hint afterwards. Resetting
	// would recreate the A-bounce the poller needed the wave-9 bounded lease
	// (d1e7d54) to escape: a sibling's legitimate success re-pins the hint at
	// the offender, this stream fails there, advances, lands elsewhere,
	// resets, bounces back — every other Step wasted. Retention converges
	// each stream to a witness that lands FOR IT; a recovered endpoint is
	// re-probed through the non-landing ping-pong (the liveness property:
	// with every endpoint failing, the advance cycles the fleet, so recovery
	// is revisited within one rotation, never excluded forever).
	//
	// Retention holds by DEFAULT, not unconditionally (Task 9 wave 14, the
	// round-12 revision): landings are also measured against slowStepBudget,
	// and the retention lease above bounds how long slow-but-successful
	// landings can keep the pin — an exit condition error-driven rotation
	// structurally cannot provide, because the pathological endpoint never
	// errs. The probe that follows a spent lease starts the NEXT Step one
	// past this preference WITHOUT writing it; only a strictly faster probe
	// landing moves it (recordLanding).
	startPref int

	// now is the Step's wall clock — the seam the latency-lease regressions
	// script pathological read latency through, instead of real half-minute
	// sleeps. NewWalker always sets time.Now; only tests in this package
	// replace it. Read solely from Step's goroutine (same single-writer
	// contract as every field here).
	now func() time.Time

	// slowLandings / slowBaseline are the retention lease's state (see the
	// slowStepBudget block above): slowLandings counts CONSECUTIVE landed
	// Steps on the retained endpoint whose wall time exceeded slowStepBudget
	// — a within-budget landing or any non-landing restarts it; a caught-up
	// Step attempts no window and leaves it untouched. slowBaseline is the
	// most recent such landing's wall time: the evidence a probe's landing
	// must BEAT for retention to transfer. Same single-writer per-Step
	// contract as startPref.
	slowLandings int
	slowBaseline time.Duration

	// lastHead / lastCursor / headSeen record what the most recent Step observed:
	// the chain head it read and where this stream's durable cursor stood. They
	// exist ONLY so the daemon can report ingest HEAD LAG on its readiness
	// surface — a walker can advance every round and still fall further behind,
	// which a no-progress check cannot see.
	//
	// They are a fresh observation per Step, not accumulated state, and nothing in
	// this file reads them. Written and read from the daemon's single loop
	// goroutine under the same single-writer contract every other worker field
	// here relies on; HeadLag is not safe to call concurrently with Step.
	lastHead   uint64
	lastCursor uint64
	headSeen   bool
}

// HeadLag reports how far this stream's durable cursor was behind the chain head
// at its most recent Step, and whether a Step has observed a head at all.
//
// It is the walker's contribution to the daemon's readiness surface. observed is
// false before the first successful head read, and stays false while head reads
// keep failing — in which case the Step error is the signal, not this.
func (w *Walker) HeadLag() (lag uint64, observed bool) {
	if !w.headSeen {
		return 0, false
	}
	if w.lastHead <= w.lastCursor {
		return 0, true
	}
	return w.lastHead - w.lastCursor, true
}

// ObservedHead reports the chain head this stream's most recent Step read, and
// whether a Step has read one at all.
//
// HeadLag already answers "how far is THIS stream behind head", but a CONSUMER of
// this stream's logs — a derivation runner, the Chainlink feed deriver — needs the
// head itself: its own distance from head is that head minus its durable derive
// cursor, and the daemon cannot get there from two separate lags without ADDING
// them, which is exactly the composition that let two locally-defensible per-hop
// bounds permit an unbounded total. Same freshness, concurrency and trust posture as
// HeadLag: a fresh per-Step observation, read from the daemon's single loop
// goroutine, never safe to call concurrently with Step.
func (w *Walker) ObservedHead() (block uint64, observed bool) {
	if !w.headSeen {
		return 0, false
	}
	return w.lastHead, true
}

func NewWalker(ch Chain, st Store, cfg WalkerConfig) *Walker {
	set := make(map[common.Address]struct{}, len(cfg.Addresses))
	for _, a := range cfg.Addresses {
		set[a] = struct{}{}
	}
	return &Walker{chain: ch, store: st, cfg: cfg, addrSet: set, startPref: -1, now: time.Now}
}

// Name returns the stream name this walker ingests, for log attribution.
func (w *Walker) Name() string { return w.cfg.Stream }

// THE BOUNDED RETENTION LEASE (Task 9 wave 14; Codex round-12 [high],
// accepted — and it REVISES the annex's unconditional retention: retention
// with no exit condition is fail-forever for LATENCY, the opposite pole of
// the A-bounce the retention rule was designed against). The pattern is the
// one this repo already ratified at the poller — d1e7d54's bounded ambiguity
// lease: retention holds by DEFAULT, and a caller-scoped budget bounds how
// long pathological-but-successful evidence may keep it, after which ONE
// probe of the neighbouring endpoint is paid — adopted only on a BETTER
// landing, the shared hint never touched, nothing ever reset.

// chainAttemptTimeout restates chain.Failover's per-endpoint attempt bound
// (chain.defaultAttemptTimeout, 30s), which that package keeps unexported.
// Restatement-with-citation is the repo's standing pattern for reusing a
// ratified constant across packages (internal/prices' maxConsecutiveAmbiguous
// restates internal/snapshot's, with the same sentence); the walker does not
// invent a number here, it MIRRORS the chain layer's, and if that bound ever
// moves this must move with it — the slowStepBudget derivation below is the
// reason the two are one value.
const chainAttemptTimeout = 30 * time.Second

// stepMaxPinnedReads is the Step's ROUND SHAPE: the maximum number of
// sequential RPC reads one cursor-bearing window Step performs — the
// resolving head read, the reorg-check header, the tip header, the logs
// window, the tip recheck and the cursor recheck (count them in Step below).
// A description of Step's own structure, not a tuning knob: it exists so the
// latency budget's derivation is stated in code instead of prose, and so the
// regressions can build the pathological schedule from the same two facts
// the derivation uses.
const stepMaxPinnedReads = 6

// slowStepBudget is the per-Step wall-time budget behind the retention
// lease, DERIVED — not tuned — from the two constants above:
//
//   - the chain layer bounds each single read at chainAttemptTimeout, so a
//     Step's reads are bounded only by stepMaxPinnedReads×chainAttemptTimeout
//     (~3 minutes). That product is the failover's BLIND SPOT: an endpoint
//     answering every read successfully just below the per-attempt bound
//     trips no error and no timeout, so error-driven rotation never fires
//     (Codex round-12 [high]: five such Steps hold the serialized daemon
//     ~15 minutes with a fast peer never queried);
//   - a healthy endpoint lands a whole Step in a small fraction of ONE
//     attempt bound.
//
// The budget is therefore ONE chainAttemptTimeout for the WHOLE Step: a
// landed Step that spent more wall time than the chain layer allows a single
// read has spent at least one entire pathological read's worth of waiting
// across its round, and the round shape separates the postures unambiguously
// — the blind-spot ceiling sits stepMaxPinnedReads× ABOVE this budget while
// healthy landings sit far below it. No third constant is involved, so there
// is nothing to tune and nothing to drift except the two stated inputs.
const slowStepBudget = chainAttemptTimeout

// MaxConsecutiveSlowLandings bounds the retention lease: how many
// CONSECUTIVE over-budget landed Steps the retained endpoint survives before
// the next Step probes its neighbour. One slow landing is likely weather (a
// heavy window, a provider hiccup); persistent recurrence is bounded
// evidence that retention has stopped paying off — the same constant and the
// same reasoning as internal/prices' maxConsecutiveAmbiguous (d1e7d54) and
// internal/snapshot's before it. Exported for the daemon-level scheduling
// regression, which asserts the cross-layer bound
// MaxConsecutiveSlowLandings+1 <= stepsPerRound: the lease spends and the
// probe fires inside a SINGLE stepWalkers round, so a slow-successful
// endpoint's monopoly of the serialized loop ends within the round the
// pathology starts in, not whenever an operator notices.
const MaxConsecutiveSlowLandings = 3

// stepOutcome is what the Step's one deferred routing seam switches on. The
// ZERO VALUE IS NON-LANDING on purpose: an outcome nobody set is an outcome
// that advances routing, so every failure arm added after this writing gets
// the advance by NOT being a landed return — never by remembering a helper.
type stepOutcome int

const (
	// stepNonLanding: the Step resolved a serving endpoint and did not land —
	// an error, a discard, anything. The next Step starts past that endpoint.
	stepNonLanding stepOutcome = iota
	// stepLanded: a DURABLE write happened — a batch saved or a rewind
	// executed. The only outcome that keeps (and retains) the starting point.
	stepLanded
	// stepCaughtUp: no window was attempted, so there is no window outcome to
	// judge; the starting point is kept, unchanged. (The responsive-frozen-
	// endpoint hole this leaves is the consult's F4, recorded OPEN — the seam
	// deliberately does not claim to cover it.)
	stepCaughtUp
)

// coherent enforces the Step's ENDPOINT-COHERENT WINDOW contract: every read
// after the serving-endpoint resolution must have been served by exactly the
// resolved endpoint. A read the failover walk satisfied elsewhere belongs to
// another chain view — joining it to this Step's window would rebuild the
// cross-provider ambiguity that consumed the incident night — so the mismatch
// is a COHERENCE DISCARD: non-landing, nothing saved. With all reads pinned
// to one token, the tip-log-vs-tipBefore check below becomes a SAME-WITNESS
// contradiction — decidable, attributable — instead of cross-provider noise.
func (w *Walker) coherent(servedBy, tok chain.EndpointToken, what string, block uint64) error {
	if tok.Index == servedBy.Index {
		return nil
	}
	slog.Warn("pinned read served by a different endpoint, discarding window: pieces would join two chain views",
		"stream", w.cfg.Stream, "read", what, "block", block,
		"pinned", servedBy.Index, "servedBy", tok.Index)
	return &DiscardError{Stream: w.cfg.Stream,
		Reason: fmt.Sprintf("%s at %d served by endpoint %d while the Step is pinned to endpoint %d", what, block, tok.Index, servedBy.Index)}
}

// routeNextStepPastNonLanding is the routing half of the Step's one seam —
// the deferred outcome handler's non-landing arm. It advances this stream's
// caller-scoped starting preference past the Step's serving endpoint.
//
// THE INVARIANT, verbatim from the Codex task-9 round-2 ruling (the closed
// law this walker transposes from the poller): LANDING IS THE ONLY OUTCOME
// THAT KEEPS THE STARTING POINT. Failure classification decides the ERROR
// POSTURE (discard vs error), never whether routing moves. The advance
// attributes no fault and costs one preference move; the shared routing hint
// is never written (see the Chain interface contract). With a single
// configured endpoint there is nowhere else to start and this says so rather
// than pretending; with every endpoint failing, the advance ping-pongs across
// the fleet — the LIVENESS property: a recovered endpoint is revisited within
// one rotation, never excluded forever.
func (w *Walker) routeNextStepPastNonLanding(servedBy chain.EndpointToken) {
	n := w.chain.EndpointCount()
	if n <= 1 {
		slog.Warn("non-landing step with a single configured endpoint: nowhere else to start, keeping the starting point rather than pretending to rotate",
			"stream", w.cfg.Stream, "endpoint", servedBy.Index)
		return
	}
	next := ((servedBy.Index+1)%n + n) % n
	if w.startPref != next {
		slog.Info("stream routing advanced past non-landing endpoint",
			"stream", w.cfg.Stream, "from", servedBy.Index, "to", next)
	}
	w.startPref = next
}

// recordLanding is the seam's LANDED arm: retention, plus the retention
// lease's accounting (the d1e7d54 bounded-lease pattern at the walker; Codex
// task-9 round-12 [high], accepted — the adjudication that revised the
// annex's unconditional retention-not-reset).
//
// RETENTION HOLDS BY DEFAULT: an ordinary landing keeps the stream on the
// endpoint that landed for it, exactly as wave 12 shipped it. What this adds
// is the bounded exit for the one posture error-driven rotation structurally
// cannot see — the slow-but-successful endpoint answering every read just
// below the chain layer's per-attempt bound, landing forever at pathological
// wall cost. Every landing is measured against slowStepBudget:
//
//   - within budget → the lease restarts; retention exactly as before.
//   - over budget on the SAME retained endpoint → the lease is consumed one
//     landing further, and this landing's wall time becomes the probe's
//     baseline. At MaxConsecutiveSlowLandings the NEXT Step probes the
//     neighbour (Step's probe block).
//   - over budget on a DIFFERENT endpoint → that endpoint starts its own
//     lease at one: the count is evidence about ONE witness, never
//     inherited across witnesses.
//
// A PROBE landing is adjudicated, never blindly retained: strictly faster
// than the baseline → ADOPTED (retention transfers; the adopted endpoint's
// own lease accounting starts from this landing's measurement, so a
// uniformly slow fleet keeps probing round-robin instead of laundering the
// count across witnesses); no faster → the stream RETURNS to the incumbent —
// startPref never moved, so the return is a routing no-op — and the lease
// re-arms in full, so the incumbent gets a fresh MaxConsecutiveSlowLandings
// landings before the next probe. Ties keep the incumbent: a probe that
// cannot beat the evidence is no reason to move. In no arm is the shared
// hint read or written, and in no arm does startPref revert to it — the
// probe is a bounded exploration, not a reset, which is what keeps the
// annex's A-bounce regressions (R3/R5) binding alongside Codex's pin
// regression (the probe-adopts-unconditionally mutation dies on exactly
// this).
func (w *Walker) recordLanding(servedBy chain.EndpointToken, wall time.Duration, probing bool, incumbent int) {
	if probing && servedBy.Index != incumbent {
		if wall < w.slowBaseline {
			slog.Info("latency probe landed faster; retention transfers",
				"stream", w.cfg.Stream, "from", incumbent, "to", servedBy.Index,
				"probeWall", wall, "incumbentWall", w.slowBaseline)
			w.startPref = servedBy.Index
			w.slowLandings, w.slowBaseline = 0, 0
			if wall > slowStepBudget {
				w.slowLandings, w.slowBaseline = 1, wall
			}
			return
		}
		slog.Info("latency probe landed no faster; returning to the incumbent and re-arming the lease",
			"stream", w.cfg.Stream, "incumbent", incumbent, "probe", servedBy.Index,
			"probeWall", wall, "incumbentWall", w.slowBaseline)
		w.slowLandings, w.slowBaseline = 0, 0
		return
	}
	// Ordinary landing — including a probe Step the failover walk answered
	// from the incumbent itself (the probed neighbour was down and the walk
	// wrapped): no second witness was measured, so there is nothing to
	// adjudicate; if the landing ran slow the lease stays spent and the next
	// Step probes again, which is the liveness the probe owes a recovering
	// neighbour.
	prev := w.startPref
	w.startPref = servedBy.Index
	if wall <= slowStepBudget {
		w.slowLandings, w.slowBaseline = 0, 0
		return
	}
	if servedBy.Index == prev {
		w.slowLandings++
	} else {
		w.slowLandings = 1
	}
	w.slowBaseline = wall
	if w.slowLandings == MaxConsecutiveSlowLandings {
		slog.Warn("retention lease spent: consecutive landings exceeded the latency budget; the next Step probes the neighbouring endpoint",
			"stream", w.cfg.Stream, "endpoint", servedBy.Index,
			"consecutiveSlow", w.slowLandings, "wall", wall, "budget", slowStepBudget)
	}
}

// Step performs one bounded unit of work: a reorg check + at most one
// getLogs window. Returns advanced=false when caught up to the safe head.
// A DISCARDED window returns advanced=false with a *DiscardError — its own
// outcome, distinct from both success and a plain error (F2: the daemon
// counts it into the failure streak instead of resetting backoff on it).
//
// Since Task 9 wave 14 the landing's WALL TIME is part of the outcome:
// retention is bounded by the latency lease (slowStepBudget above), so a
// stream pinned to a slow-but-successful endpoint escapes it within
// MaxConsecutiveSlowLandings+1 Steps instead of never.
//
// Residual TOCTOU: a fork landing between the pre-save cursor recheck and
// SaveBatch can still persist stale rows, but it is caught by the NEXT
// Step's cursor check + verified-ancestor rewind. Trust assumptions:
// per-Step endpoint affinity is ENFORCED since Task 9 wave 12 — the first
// read resolves the serving endpoint, every later read is pinned to it with
// token equality required — but a successful-but-incomplete getLogs response
// is still trusted, inherent to the RPC model (the consult's F5 disclosure:
// rotation does not touch silent truncation; the detection net is the
// wave-10 reconcile aggregate welds). Deferred hardening: per-block header
// verification of every returned log, receipt-membership proofs, and a
// distinct-hash-per-height store invariant check remain deliberate deferrals
// to the derivation layer's health checks.
func (w *Walker) Step(ctx context.Context) (bool, error) {
	// RESOLVE THE SERVING ENDPOINT FIRST (the poller's readRound shape,
	// transposed). The head read doubles as the resolution: whichever
	// endpoint answers it is the Step's one serving endpoint, and every later
	// read is pinned to exactly it. The start honours this stream's own
	// retained preference; the shared hint is READ once, only before the
	// first preference exists.
	start := w.startPref
	if start < 0 {
		start = w.chain.ActiveEndpoint()
	}
	// THE RETENTION LEASE'S PROBE (see slowStepBudget): when the lease is
	// spent — MaxConsecutiveSlowLandings consecutive over-budget landings on
	// the retained endpoint — this Step STARTS one past it. Caller-scoped
	// through and through: the shared hint is neither consulted nor written,
	// and startPref is NOT reset — retention still points at the incumbent
	// unless this probe LANDS strictly faster (the adjudicated round-12
	// revision of the annex: the probe must never behave as a reset-to-hint,
	// which is the A-bounce the retention rule exists to prevent).
	incumbent := w.startPref
	probing := false
	if incumbent >= 0 && w.slowLandings >= MaxConsecutiveSlowLandings {
		if n := w.chain.EndpointCount(); n > 1 {
			start = ((incumbent+1)%n + n) % n
			probing = true
			slog.Info("retention lease spent: probing the neighbouring endpoint for a faster landing",
				"stream", w.cfg.Stream, "incumbent", incumbent, "probe", start,
				"consecutiveSlow", w.slowLandings, "budget", slowStepBudget)
		}
		// n <= 1: nowhere to probe — retention stands, honestly unprobed
		// (the single-endpoint telemetry rule already covers non-landings).
	}
	began := w.now()
	head, servedBy, err := w.chain.BlockNumberFrom(ctx, start)
	if err != nil {
		// The resolution walk itself visited every endpoint and none served;
		// there is no serving endpoint to route past. The error posture and
		// the daemon's backoff carry the outage.
		return false, fmt.Errorf("head: %w", err)
	}

	// THE ROUTING SEAM — one deferred outcome handler, keyed on the Step's
	// outcome flag (the poller.go readRound seam, structurally verbatim).
	// From this point on the Step HAS a serving endpoint, and the invariant
	// holds structurally: LANDING IS THE ONLY OUTCOME THAT KEEPS THE STARTING
	// POINT (Codex task-9 round 2, both findings accepted; controller ruling —
	// the per-arm approach missed twice at the poller and is not re-run at
	// ingest). Every return below that does not first mark the Step landed or
	// caught-up — every discard, every error, and every failure arm anyone
	// adds later — advances this stream's start past the serving endpoint
	// through this defer, FOR FREE. Classification at each return decides
	// only how the failure is REPORTED (discard vs error), never whether
	// routing moves. Landing RETAINS: the stream's next Step starts at the
	// endpoint that just landed for it, never back at the shared hint — by
	// DEFAULT, bounded by the retention lease (recordLanding), the one exit
	// for the posture the failover cannot see: successful pathological
	// latency. Caught-up KEEPS: no window was attempted, nothing is judged.
	// Rewind COUNTS AS LANDING: it is a durable write.
	outcome := stepNonLanding
	defer func() {
		wall := w.now().Sub(began)
		switch outcome {
		case stepLanded:
			w.recordLanding(servedBy, wall, probing, incumbent)
		case stepCaughtUp:
			// keep the starting point AND the lease state, unchanged: no
			// window was attempted, so nothing is judged — not routing, not
			// latency (a caught-up Step reads no window; its wall time says
			// nothing about the endpoint's landing latency). An armed probe
			// stays armed for the next Step that attempts a window.
		default:
			w.routeNextStepPastNonLanding(servedBy)
			// A non-landing breaks the lease's consecutive-landings chain
			// and dissolves any armed probe: the seam's advance has already
			// moved routing (a FAILED probe is exactly this arm — a
			// non-landing that advances past the probed endpoint), and the
			// lease re-arms from zero wherever the stream next lands.
			w.slowLandings, w.slowBaseline = 0, 0
		}
	}()

	if head < w.cfg.Confirmations {
		outcome = stepCaughtUp
		return false, nil
	}
	safe := head - w.cfg.Confirmations

	cur, err := w.store.Cursor(ctx, w.cfg.Stream)
	if err != nil {
		return false, fmt.Errorf("cursor: %w", err)
	}
	// Record the freshly observed (head, cursor) pair for the daemon's head-lag
	// readiness condition. A stream with no cursor yet is reported as lagging by
	// the whole head, which is the honest reading: nothing has been ingested.
	w.lastHead, w.headSeen = head, true
	w.lastCursor = 0
	if cur != nil {
		w.lastCursor = cur.Block
	}

	var next uint64 // first block of the next window
	if cur == nil {
		next = w.cfg.StartBlock
	} else {
		// Reorg check must run before the caught-up return: a mismatched
		// cursor needs rewinding even when there is nothing new to ingest.
		chainHash, tok, err := w.chain.HeaderHashFrom(ctx, servedBy.Index, cur.Block)
		if err != nil {
			return false, fmt.Errorf("reorg check header %d: %w", cur.Block, err)
		}
		if err := w.coherent(servedBy, tok, "reorg-check header", cur.Block); err != nil {
			return false, err
		}
		if !bytes.Equal(chainHash.Bytes(), cur.Hash) {
			adv, err := w.rewindToVerifiedAncestor(ctx, cur, servedBy)
			if err == nil {
				outcome = stepLanded // rewind counts as landing: a durable write
			}
			return adv, err
		}
		// Caught-up check BEFORE computing next: a cursor at MaxUint64 would
		// wrap next to 0 and silently restart the walk from genesis.
		if cur.Block >= safe {
			outcome = stepCaughtUp
			return false, nil
		}
		next = cur.Block + 1
	}

	if next > safe {
		outcome = stepCaughtUp
		return false, nil
	}
	// Overflow-safe window cap: compare distances instead of computing
	// next+Window-1 first (safe >= next holds after the return above;
	// Window >= 1 is enforced by config validation).
	to := safe
	if delta := safe - next; delta > w.cfg.Window-1 {
		to = next + w.cfg.Window - 1
	}

	// Coherent-window fetch: pin the tip hash on both sides of getLogs so a
	// mid-fetch reorg cannot anchor the cursor to a hash the logs never
	// belonged to — and pin every read to the Step's one serving endpoint so
	// both sides are the SAME WITNESS's answers.
	tipBefore, tok, err := w.chain.HeaderHashFrom(ctx, servedBy.Index, to)
	if err != nil {
		return false, fmt.Errorf("tip header %d: %w", to, err)
	}
	if err := w.coherent(servedBy, tok, "tip header", to); err != nil {
		return false, err
	}
	logs, tok, err := w.chain.LogsFrom(ctx, servedBy.Index, next, to, w.cfg.Addresses)
	if err != nil {
		return false, fmt.Errorf("logs [%d,%d]: %w", next, to, err)
	}
	if err := w.coherent(servedBy, tok, "logs window", to); err != nil {
		return false, err
	}
	tipAfter, tok, err := w.chain.HeaderHashFrom(ctx, servedBy.Index, to)
	if err != nil {
		return false, fmt.Errorf("tip header recheck %d: %w", to, err)
	}
	if err := w.coherent(servedBy, tok, "tip header recheck", to); err != nil {
		return false, err
	}
	if tipAfter != tipBefore {
		// One token, two answers: genuine chain movement at depth
		// Confirmations (a ≥conf-deep reorg — an anomaly, not weather) and a
		// split backend behind one URL are indistinguishable from here. The
		// discard posture is fail-closed either way, and the seam advances
		// routing either way (consult Q3: no discrimination machinery).
		slog.Warn("tip changed mid-fetch, discarding window",
			"stream", w.cfg.Stream, "block", to,
			"before", tipBefore, "after", tipAfter)
		return false, &DiscardError{Stream: w.cfg.Stream,
			Reason: fmt.Sprintf("tip header %d changed mid-fetch on endpoint %d (%s -> %s)", to, servedBy.Index, tipBefore, tipAfter)}
	}
	if cur != nil {
		// Re-check the cursor ancestor: a reorg below the window during the
		// fetch would splice this batch onto a dead fork.
		recheck, tok, err := w.chain.HeaderHashFrom(ctx, servedBy.Index, cur.Block)
		if err != nil {
			return false, fmt.Errorf("cursor recheck header %d: %w", cur.Block, err)
		}
		if err := w.coherent(servedBy, tok, "cursor recheck header", cur.Block); err != nil {
			return false, err
		}
		if !bytes.Equal(recheck.Bytes(), cur.Hash) {
			slog.Warn("cursor hash changed mid-step, discarding window",
				"stream", w.cfg.Stream, "block", cur.Block)
			return false, &DiscardError{Stream: w.cfg.Stream,
				Reason: fmt.Sprintf("cursor hash at %d changed mid-step on endpoint %d", cur.Block, servedBy.Index)}
		}
	}

	// Validate every log before conversion: any violation aborts the whole
	// batch — nothing is saved. Byte-identical duplicates are the one
	// exception: they are coalesced, not fatal.
	type logKey struct {
		tx    common.Hash
		index uint
	}
	hashAt := map[uint64][]byte{}                 // fork consistency: one hash per height
	seen := make(map[logKey]types.Log, len(logs)) // duplicate identity: (TxHash, Index)
	deduped := logs[:0:0]
	for _, l := range logs {
		if l.Removed {
			return false, fmt.Errorf("log %s/%d: provider returned removed log", l.TxHash, l.Index)
		}
		if l.BlockNumber < next || l.BlockNumber > to {
			return false, fmt.Errorf("log %s/%d: block %d outside requested window [%d,%d]",
				l.TxHash, l.Index, l.BlockNumber, next, to)
		}
		if _, ok := w.addrSet[l.Address]; !ok {
			return false, fmt.Errorf("log %s/%d: address %s not in the configured address set",
				l.TxHash, l.Index, l.Address)
		}
		// Store column is INT: reject before the uint32 narrowing below.
		if l.Index > math.MaxInt32 {
			return false, fmt.Errorf("log %s/%d: log index exceeds int32 range", l.TxHash, l.Index)
		}
		// Fork consistency: every log in the batch at the same height must
		// carry the same block hash.
		if prev, ok := hashAt[l.BlockNumber]; ok {
			if !bytes.Equal(prev, l.BlockHash.Bytes()) {
				return false, fmt.Errorf("mixed block hashes at height %d — fork-inconsistent getLogs response", l.BlockNumber)
			}
		} else {
			hashAt[l.BlockNumber] = l.BlockHash.Bytes()
		}
		// Logs at the window tip must sit on the fork the cursor is being
		// anchored to. With the Step pinned to one endpoint this is a
		// SAME-WITNESS contradiction when it fires: the serving endpoint's
		// own getLogs disagreeing with its own header — decidable evidence,
		// not cross-provider noise.
		if l.BlockNumber == to && l.BlockHash != tipBefore {
			return false, fmt.Errorf("log %s/%d: log at window tip does not match anchored tip hash", l.TxHash, l.Index)
		}
		// Duplicate identity keyed (TxHash, Index): byte-identical copies are
		// coalesced; any field diverging is a protocol violation.
		k := logKey{tx: l.TxHash, index: l.Index}
		if prev, ok := seen[k]; ok {
			if reflect.DeepEqual(prev, l) {
				continue // coalesce byte-identical duplicate
			}
			return false, fmt.Errorf("conflicting duplicate log %x/%d", l.TxHash, l.Index)
		}
		seen[k] = l
		deduped = append(deduped, l)
	}
	logs = deduped

	raw := make([]store.RawLog, len(logs))
	for i, l := range logs {
		topics := make([][]byte, len(l.Topics))
		for j, t := range l.Topics {
			topics[j] = t.Bytes()
		}
		data := make([]byte, len(l.Data))
		copy(data, l.Data)
		raw[i] = store.RawLog{
			ChainID:     w.cfg.ChainID,
			BlockNumber: l.BlockNumber,
			BlockHash:   l.BlockHash.Bytes(),
			TxHash:      l.TxHash.Bytes(),
			LogIndex:    uint32(l.Index),
			Address:     l.Address.Bytes(),
			Topics:      topics,
			Data:        data,
		}
	}
	// Anchor the cursor to tipBefore (== tipAfter): the hash observed on
	// both sides of the fetch, so cursor and logs describe the same fork.
	if err := w.store.SaveBatch(ctx, w.cfg.Stream, w.cfg.ChainID, raw, to, tipBefore.Bytes()); err != nil {
		return false, fmt.Errorf("save batch: %w", err)
	}
	// THE ONE LANDED RETURN of the window path — the only exit (with the
	// rewind above) that keeps and retains the starting point.
	outcome = stepLanded
	return true, nil
}

// rewindToVerifiedAncestor walks stored logs downward from the mismatched
// cursor until one's block hash matches the live chain. Forks are suffixes:
// a single stored log whose hash matches the live header proves every stored
// row at or below it is canonical, so rewinding there is safe at any fork
// depth — unlike a fixed-distance rewind, which silently blesses stale rows
// below its target when the fork is deeper.
//
// Every header read here is PINNED to the Step's serving endpoint (Task 9
// wave 12): the rewind decision is evidence about ONE witness's chain, and a
// probe answered by a different endpoint would authorize a destructive
// Rewind against a view the reorg check never saw — that mismatch is a
// coherence discard, and no Rewind runs. (Corroborating the mismatch on a
// SECOND endpoint before rewinding is the consult's F3, deliberately NOT
// implemented this wave — it needs its own ratified clause.)
func (w *Walker) rewindToVerifiedAncestor(ctx context.Context, cur *store.CursorPos, servedBy chain.EndpointToken) (bool, error) {
	var (
		target     uint64
		targetHash []byte
		verified   bool
	)
	// pinnedHeader is the one probe shape this decision may use.
	pinnedHeader := func(at uint64, what string) (common.Hash, error) {
		h, tok, err := w.chain.HeaderHashFrom(ctx, servedBy.Index, at)
		if err != nil {
			return common.Hash{}, fmt.Errorf("%s %d: %w", what, at, err)
		}
		if err := w.coherent(servedBy, tok, what, at); err != nil {
			return common.Hash{}, err
		}
		return h, nil
	}
	// fullRewalk targets StartBlock-1 (or 0 in the degenerate StartBlock==0
	// case) so the next Step re-ingests the stream's entire range.
	fullRewalk := func() error {
		at := uint64(0)
		if w.cfg.StartBlock > 0 {
			at = w.cfg.StartBlock - 1
		}
		h, err := pinnedHeader(at, "rewind header")
		if err != nil {
			return err
		}
		target, targetHash, verified = at, h.Bytes(), false
		return nil
	}

	if cur.Block == 0 {
		if err := fullRewalk(); err != nil {
			return false, err
		}
	} else {
		probe := cur.Block - 1 // fork point is at or below cur.Block
		for {
			b, storedHash, found, err := w.store.HighestLogAtOrBelow(ctx, w.cfg.ChainID, probe)
			if err != nil {
				return false, fmt.Errorf("highest log at or below %d: %w", probe, err)
			}
			if !found {
				// Nothing stored below the probe — nothing to verify against.
				if err := fullRewalk(); err != nil {
					return false, err
				}
				break
			}
			liveHash, err := pinnedHeader(b, "rewind header")
			if err != nil {
				return false, err
			}
			if bytes.Equal(liveHash.Bytes(), storedHash) {
				// PROVEN canonical: stored == live. Anchor to the stored
				// hash — it is the hash the surviving rows were saved under.
				// A verified match is accepted even below this stream's
				// StartBlock: a hash match is a chain-canonical proof, and
				// clamping the target up to an unverified height would anchor
				// sibling cursors to unverified (possibly post-fork) hashes.
				// The cost of a deep verified target is a bounded sibling
				// re-walk, not corruption.
				target, targetHash, verified = b, storedHash, true
				break
			}
			if b == 0 || b <= w.cfg.StartBlock {
				// Fork extends past everything verifiable in this range.
				if err := fullRewalk(); err != nil {
					return false, err
				}
				break
			}
			probe = b - 1
		}
	}

	if err := w.store.Rewind(ctx, w.cfg.Stream, w.cfg.ChainID, target, targetHash); err != nil {
		return false, fmt.Errorf("rewind: %w", err)
	}
	slog.Warn("reorg detected, rewound to verified ancestor",
		"stream", w.cfg.Stream, "from", cur.Block, "to", target, "verified", verified)
	return true, nil // rewound; next Step re-ingests
}
