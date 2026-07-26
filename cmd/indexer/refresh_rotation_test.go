package main

// ROUND-11 tests for the refresh rotation's LIVENESS — Codex round 11's [high].
//
// THE HISTORY MATTERS, because this mechanism has now failed three times and each
// failure looked like the previous one's fix:
//
//	naive budget        STARVED   the first-judged workers won every window
//	due queue           DEADLOCK  (rejected before shipping) the queue's head is a
//	                              scope that stalls and never asks again
//	asked-set rotation  DEADLOCK  shipped in wave 13, and this is the finding: the
//	                              set had membership with NO EXPIRY, so a scope
//	                              recorded while the budget was exhausted that then
//	                              stopped asking blocked every other scope forever
//
// The tests below are the ones the previous wave could not have had, and the reason
// it could not is worth naming: its fairness harness keeps all nine cursors asking
// for its whole run, so nothing in it ever stops asking, so no expiry rule was ever
// exercised. A mechanism whose failure mode is "a participant leaves" cannot be
// tested by a harness in which nobody leaves.
//
//	property                                     test
//	───────────────────────────────────────────────────────────────────────────────
//	no scope repeats while another still asks    …RotatesStrictlyBetweenCallers
//	a scope that STOPS asking blocks nobody      …DoesNotDeadlockOnAStoppedCaller
//	…and it costs its VETO, not its PLACE        …DoesNotForgiveTheTurnOfAQuietScope
//	the whole shape, through the real pass        …CatchUpThroughTheNearHeadArm…
//
// AXES VARIED (the table in staleness_budget_test.go): the first three vary a NEW
// axis that table did not have — F, whether a scope keeps asking — at budget-one,
// with every other axis held easy so that the rotation is unambiguously the subject.
// The last varies A, B, D and F together through applyProgressConditions.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// rotationHarness drives admitRefresh/chargeRefresh directly at BUDGET-ONE: every
// admitted refresh is charged the entire per-window allowance, so exactly one scope
// per chain may be served per window.
//
// WHY BUDGET-ONE IS DRIVEN HERE RATHER THAN THROUGH A SLOW FETCH. One refresh per
// window requires a single read to spend headerFetchTimeout, and a read that takes
// the whole timeout is a read that TIMED OUT — a failure, governed by the retry
// cooldown, which is a different mechanism. Budget-one is therefore reachable only
// by charging it, and charging it is exactly what a chain of several slower-than-
// budget readers does in aggregate. The integration test at the bottom uses real
// reads at a latency that is physically possible, and pays the extra workers needed
// to make the budget bind.
type rotationHarness struct {
	j     *stalenessJudge
	clk   *fakeClock
	round uint64
}

func newRotationHarness() *rotationHarness {
	clk := &fakeClock{t: time.Unix(1_000_000, 0).UTC()}
	return &rotationHarness{j: newStalenessJudge(nil, clk.now), clk: clk}
}

// pass opens a new round and asks on behalf of each scope, in order, returning the
// scopes that were admitted. Scopes not named simply did not ask this round, which
// is the entire subject of these tests.
func (h *rotationHarness) pass(scopes ...string) []string {
	h.round++
	var served []string
	for _, s := range scopes {
		if h.j.admitRefresh(h.clk.now(), h.round, 1, s) {
			served = append(served, s)
			h.j.chargeRefresh(1, headerFetchTimeout)
		}
	}
	return served
}

// nextWindow moves the SCHEDULING clock past the budget window so the allowance
// renews.
func (h *rotationHarness) nextWindow() { h.clk.advance(headerRestampThrottle + time.Second) }

// TestTheRefreshRotationRotatesStrictlyBetweenCallers is the property the rotation
// exists for, at budget-one where it is unambiguous: with two scopes asking every
// round and room for one refresh per window, the refreshes must ALTERNATE.
//
// This is the assertion the expiry rule had to be added without breaking, and it is
// the direction the tempting version of that rule breaks (see the quiet-scope test).
func TestTheRefreshRotationRotatesStrictlyBetweenCallers(t *testing.T) {
	h := newRotationHarness()
	var order []string
	for w := 0; w < 6; w++ {
		for r := 0; r < 3; r++ { // several rounds per window; only one may be served
			order = append(order, h.pass("A", "B")...)
		}
		h.nextWindow()
	}
	require.Equal(t, []string{"A", "B", "A", "B", "A", "B"}, order,
		"one refresh per window, and never the same scope twice while the other is still asking: without this the scopes the daemon judges FIRST win every window and the rest are never re-anchored at all")
}

// TestTheRefreshRotationDoesNotDeadlockOnAStoppedCaller is Codex round 11's [high],
// reproduced exactly as the finding describes it.
//
// B asks while the budget is exhausted — so it is RECORDED as waiting and never
// served — and then stops asking, because it caught up and the exact/memo/near-head
// arm answers it now. Under the shipped rule B's membership never expired, so every
// completion check found B unserved, no rotation could ever complete, and A (and
// every other scope on the chain) was refused FOREVER. Not degraded: stopped. The
// chain's anchors are then never re-read again, catch-up never completes, and the
// deployment reads red until the process is restarted.
//
// The assertion is deliberately about the STEADY STATE rather than the next call:
// one window of delay while B ages out is correct and expected. Zero refreshes ever
// again is the defect.
func TestTheRefreshRotationDoesNotDeadlockOnAStoppedCaller(t *testing.T) {
	h := newRotationHarness()

	// Window 1: A wins the allowance, B asks and is refused — recorded, unserved.
	require.Equal(t, []string{"A"}, h.pass("A", "B"))
	require.Equal(t, uint64(1), h.j.refreshAsked[1]["B"],
		"THE PRECONDITION: B is on record as having asked and has NOT been served, which is the state the deadlock is built out of")
	require.False(t, h.j.refreshServed[1]["B"])

	// B STOPS ASKING. Nothing tells the rotation this; nothing can. From here on
	// only A asks.
	h.nextWindow()
	served := 0
	for w := 0; w < 8; w++ {
		for r := 0; r < 3; r++ {
			served += len(h.pass("A"))
		}
		h.nextWindow()
	}
	require.Equal(t, 8, served,
		"a scope that has stopped asking must block nobody: with the shipped rule this is ZERO — B is waiting forever, so no rotation can complete, so A is refused in every window for the life of the process and the chain is never re-anchored again")
	require.NotContains(t, h.j.refreshAsked[1], "B",
		"and B is gone from the waiting set rather than merely out-voted: membership with no expiry is indistinguishable from a queue head, which is the failure the queue design was rejected for")
}

// TestTheRefreshRotationDoesNotForgiveTheTurnOfAQuietScope is the other side of the
// expiry rule, and it is the side that was MEASURED rather than reasoned.
//
// Being served is exactly what makes a scope go quiet: a refreshed anchor is
// reusable for a whole window, so the scope stops reaching this arm until it
// expires. "Inactive" is therefore the NORMAL state of a scope that has just had its
// turn — which means an expiry rule that also clears the scope's served mark hands
// it a fresh turn every time it is served, and the scopes waiting behind it never
// advance. The first draft of this fix did exactly that, and the nine-worker harness
// reported worker 6 at zero refreshes over five minutes: the starvation the rotation
// was built to prevent, restored by its own liveness rule.
//
// Going quiet costs a scope its VETO. It must never cost the others their place.
func TestTheRefreshRotationDoesNotForgiveTheTurnOfAQuietScope(t *testing.T) {
	h := newRotationHarness()

	// Window 1: A is served; B and C are refused and keep asking.
	require.Equal(t, []string{"A"}, h.pass("A", "B", "C"))
	h.nextWindow()

	// A now goes QUIET for a whole window — which is what a scope with a freshly
	// re-anchored stamp does — while B and C keep asking.
	var order []string
	for r := 0; r < 3; r++ {
		order = append(order, h.pass("B", "C")...)
	}
	h.nextWindow()
	for r := 0; r < 3; r++ {
		order = append(order, h.pass("B", "C")...)
	}
	require.Equal(t, []string{"B", "C"}, order,
		"A went quiet, so it stops BLOCKING — but it does not get its turn back: B and C have been waiting since the first window and must be served before A repeats")
}

// TestCatchUpThroughTheNearHeadArmDoesNotWedgeTheChain is the finding's own
// scenario, end to end through applyProgressConditions rather than through the
// admission rule: a worker that catches up and is thereafter answered by the
// NEAR-HEAD arm, exactly as Codex names it, having been recorded as waiting first.
//
// AXES VARIED: A (three-day-old cursors), B (five-second reads), D (four workers on
// one chain), F (one of them stops asking mid-run, and never resumes).
//
// THE ARRANGEMENT, because every part of it is load-bearing:
//
//   - `head` sits near the chain head and is judged THIRD, so the chain's retained
//     stamp is FRESH by the time the fourth worker is judged and stale for the first
//     two. That is what lets one worker be answered by the near-head arm while the
//     others are not — the arm is chain-wide, so the only way to split it is by
//     block height.
//   - `slowA` and `slowC` are far behind and BELOW head's block, so the fresh stamp
//     cannot answer them (reuse is upward-only) and they keep asking forever.
//   - `catchup` starts below head's block (so it asks) and later jumps ABOVE it (so
//     the near-head arm answers it and it never asks again) — and it makes that jump
//     WITHOUT ever being served, which is precisely the state the shipped rule could
//     not represent.
//   - Reads cost five seconds, so slowA and slowC together exhaust the ten-second
//     allowance and `catchup` is refused. That is a latency an endpoint can actually
//     have, unlike the one budget-one would need.
func TestCatchUpThroughTheNearHeadArmDoesNotWedgeTheChain(t *testing.T) {
	const readLatency = 5 * time.Second // two of these exhaust headerFetchTimeout
	h, clk := newTestHealth()

	const (
		slowABlock   = 5_000_000
		slowCBlock   = 4_000_000
		headBlock    = 10_000_000
		catchupStart = 3_000_000
		catchupHead  = 20_000_000
	)
	names := struct{ slowA, slowC, head, catchup string }{"eth:slow-a", "eth:slow-c", "eth:head", "eth:catchup"}
	caughtUp := false
	var reads []stampKey

	fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
		reads = append(reads, stampKey{chainID: chainID, block: block})
		clk.advance(readLatency)
		// Near the head, or three days behind, decided by the block itself — which is
		// what makes `catchup` change regime simply by moving its cursor.
		if block >= headBlock {
			return uint64(clk.now().Add(-30 * time.Second).Unix()), nil
		}
		return uint64(clk.now().Add(-backfillAge).Unix()), nil
	}

	judge := newStalenessJudge(fetch, clk.now)
	// JUDGED ORDER IS THE SLICE ORDER, and it is chosen: head must be read before
	// catchup so the chain stamp is fresh when catchup is judged.
	order := []struct {
		name  string
		block uint64
	}{{names.slowA, slowABlock}, {names.slowC, slowCBlock}, {names.head, headBlock}, {names.catchup, catchupStart}}
	var walkers []*walkerState
	pr := &fakeProgress{}
	for _, o := range order {
		walkers = append(walkers, &walkerState{w: &fakeIngestWorker{name: o.name}, chainID: 1})
		pr.ingest = append(pr.ingest, store.CursorProgress{Name: o.name, Block: o.block, UpdatedAt: clk.now()})
	}
	watch := progressWatch{walkers: walkers, staleness: judge}

	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.authority(), rc, watch)
		publishRound(h, rc)
		clk.advance(200 * time.Millisecond)
		for i := range pr.ingest {
			pr.ingest[i].Block++
			pr.ingest[i].UpdatedAt = clk.now()
		}
		if caughtUp {
			pr.ingest[3].Block = catchupHead + uint64(len(reads))
		}
	}

	// PHASE 1 — run until `catchup` has asked and been refused: recorded as waiting,
	// never served. Two windows is ample; the assertion proves it rather than the
	// arithmetic.
	start := clk.now()
	for clk.now().Sub(start) < 2*headerRestampThrottle {
		round()
	}
	require.Equal(t, judge.refreshAsked[1][names.catchup], judge.round,
		"THE PRECONDITION: catchup asked in the most recent round")
	require.False(t, judge.refreshServed[1][names.catchup],
		"and was never served — the budget went to the two workers judged before it, which is the state the deadlock is built out of")

	// PHASE 2 — catchup reaches the head. From here the near-head arm answers it off
	// the chain's fresh stamp and it never reaches the refresh arm again.
	caughtUp = true
	round()

	refreshStart := len(reads)
	phase2 := clk.now()
	for clk.now().Sub(phase2) < 6*headerRestampThrottle {
		round()
	}
	refreshes := map[uint64]int{}
	for _, k := range reads[refreshStart:] {
		refreshes[k.block/1_000_000]++
	}
	require.Zero(t, refreshes[catchupHead/1_000_000],
		"THE OTHER PRECONDITION: catchup was never read again in six windows, because the NEAR-HEAD arm answers it off the chain's fresh stamp before it can reach the refresh arm — which is exactly the way out of this arm the finding names, and the reason it never asks again")
	require.GreaterOrEqualf(t, refreshes[slowABlock/1_000_000], 2,
		"%s is starved: with a stopped caller on record the rotation can never complete, so every remaining scope is refused for the life of the process (shipped rule: 0)", names.slowA)
	require.GreaterOrEqualf(t, refreshes[slowCBlock/1_000_000], 2,
		"%s is starved by the same deadlock", names.slowC)

	// And the deployment actually recovers: a chain that keeps re-anchoring is a
	// chain whose backfill verdicts keep tracking reality.
	require.NotContains(t, judge.refreshAsked[1], names.catchup,
		"the stopped caller has aged out of the waiting set entirely rather than merely being out-voted")
	t.Logf("after catch-up: slowA=%d slowC=%d refreshes over six windows",
		refreshes[slowABlock/1_000_000], refreshes[slowCBlock/1_000_000])
}

// TestTheRotationLivenessRuleDoesNotDependOnEitherCLOCK is the lesson the previous
// wave's mutation loop taught (M15), applied to the new mechanism before a mutation
// has to teach it again.
//
// The budget's WINDOW is scheduling and rolls on the monotonic clock. The rotation's
// EXPIRY is neither: it is the pass counter. That distinction is worth a test
// because the obvious implementation of "expire inactive askers" is a timestamp, and
// a timestamp makes liveness depend on a clock — so a stopped clock (the exact
// failure M15 found, where the verdict clock froze and the budget silently stopped
// rolling) would freeze the expiry too and restore the deadlock in full.
//
// Here BOTH clocks are frozen and only the rounds advance. The rotation must still
// come unstuck.
func TestTheRotationLivenessRuleDoesNotDependOnEitherCLOCK(t *testing.T) {
	h := newRotationHarness()
	require.Equal(t, []string{"A"}, h.pass("A", "B"))

	// Neither clock ever moves again — no nextWindow, no verdict clock at all — so
	// the budget window never rolls and the allowance is never renewed. A is refused
	// on SPEND, which is correct and is not what this test is about.
	for r := 0; r < 5; r++ {
		require.Empty(t, h.pass("A"), "the allowance is spent and the window cannot roll on a frozen clock")
	}
	require.NotContains(t, h.j.refreshAsked[1], "B",
		"but B has still aged out: the rotation's liveness rule counts ROUNDS, so a frozen clock cannot freeze it. Had it been a timestamp, the deadlock would survive exactly the failure mode M15 found")

	// And the moment the window does roll, A is served immediately rather than
	// waiting on a scope that stopped asking five rounds ago.
	h.nextWindow()
	require.Equal(t, []string{"A"}, h.pass("A"))
}

// TestASingleDeepStaleWorkerIsRefreshedEveryWindow pins the degenerate case the
// rotation must not make worse: one worker on a chain completes its rotation by
// itself and is refreshed every window, exactly as it was before any of this existed.
//
// It is here because both the deadlock and the starvation bug are invisible at W=1,
// so this is the assertion that says the mechanism costs the ordinary deployment
// nothing.
func TestASingleDeepStaleWorkerIsRefreshedEveryWindow(t *testing.T) {
	h := newRotationHarness()
	for w := 0; w < 5; w++ {
		require.Equal(t, []string{"solo"}, h.pass("solo"),
			fmt.Sprintf("window %d: a lone scope is its own whole rotation", w))
		require.Empty(t, h.pass("solo"), "and it is still budgeted within the window")
		h.nextWindow()
	}
}
