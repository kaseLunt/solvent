package main

// ROUND-10 tests for the two defects Codex found in the freshness gate's
// SCHEDULING and its choice of CLOCK.
//
//   - [high] one round-start `now` stamped every fetch in a pass, so a pass of nine
//     sequential reads averaging more than 30 s ÷ 9 — still well inside the 10 s
//     per-read timeout — expired every anchor before the next pass reached it. The
//     throttle switched itself off exactly when the endpoint was slow enough to need
//     it. Fixed by stamping from a monotonic clock at fetch COMPLETION and by a
//     per-chain refresh budget, and measured here with SLOW SUCCESSFUL reads.
//   - [medium] the age a verdict is made from was `now - headerTime` on the DAEMON's
//     own wall clock. A rollback smaller than a cached header's age slips under the
//     future-skew predicate and shortens every age computed afterwards; short ages
//     read green. Fixed by measuring against the DATABASE clock, and exercised here
//     with the two clocks deliberately disagreeing.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE AXES A "HARD CASE" HAS, and which of them each measurement varies.
//
// This table exists because the same lesson has now been learned three times, each
// time on an axis the previous harness held easy. Wave 9 measured fresh cursors;
// wave 11 measured the data-age axis and correctly called it the hard case — but it
// left LATENCY at zero, and zero-latency reads are what made its 9-per-20-rounds
// arithmetic true. A cost figure is a claim about a POINT in this space, and it is
// worth only what the point it was measured at is worth. Every measurement below
// therefore names its own coordinates.
//
//	axis                     easy                    hard
//	───────────────────────────────────────────────────────────────────────────────
//	A  cursor data age       at head                 days behind (backfill)
//	B  fetch latency         instantaneous           seconds, under the 10 s timeout
//	C  fetch outcome         succeeds                fails / times out
//	D  workers per chain     one                     the deployment's fan-out
//	E  clock behaviour       monotone, agreeing      stepped back; daemon ≠ database
//
//	measurement                                              A  B  C  D  E
//	───────────────────────────────────────────────────────────────────────────────
//	wave 9   cost harness (deleted)                          ·  ·  ·  ✓  ·
//	wave 11  TestStalenessPassCostOnAGenuineHistorical…      ✓  ·  ✓  ✓  ·
//	wave 11  TestEveryStampReuseIsRevalidated…               ✓  ·  ·  ·  ✓ (rollback > anchor age)
//	wave 13  TestSlowSuccessfulReadsStayBounded…             ✓  ✓  ·  ✓  ·
//	wave 13  TestAClockRollbackSmallerThanTheHeaderAge…      ✓  ·  ·  ·  ✓ (rollback < anchor age)
//
// Nothing below claims to close axis C at hard latency: a chain that both fails AND
// takes ten seconds to fail is governed by the retry cooldown, which wave 11 already
// measured, and adding latency to it would re-measure the cooldown rather than this
// budget. Said here rather than left for the next reviewer to discover.
// ═══════════════════════════════════════════════════════════════════════════════

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// slowChainWorkers is the fan-out the finding names: nine gated workers sharing one
// chain, which is what the configured deployment has on Ethereum.
const slowChainWorkers = 9

// slowReadLatency is one successful header read on a DEGRADED-BUT-WORKING endpoint.
// It is deliberately under headerFetchTimeout — this is the shape the finding is
// about, a chain that answers every time and answers slowly, which no failure-path
// guard covers because nothing has failed.
//
// At this latency the budget affords ⌊headerFetchTimeout / 4 s⌋ + 1 = 3 refresh
// reads per window, so a full round-robin over nine workers takes ⌈9/3⌉ = 3 windows.
const slowReadLatency = 4 * time.Second

// slowBudgetRotation is ⌈W/R⌉ from headerRestampThrottle's bound 2, in windows.
const slowBudgetRotation = 3

// slowWorkerBlock keeps each worker's cursor in its own million-block range, so a
// read's block identifies the worker that paid for it and no two workers ever share
// the round memo. (Sharing is correct, and wave 11 measures it; here it would hide
// which worker the budget actually served.)
//
// THE RANGES DESCEND WITH THE JUDGED ORDER, which is the adversarial arrangement and
// is chosen deliberately. A successful read re-anchors the CHAIN stamp for every
// worker judged after it at a HIGHER block — applyStalenessConditions says so, and
// it is why the pass's ceiling is "one read per descent in the judged order". With
// ascending blocks that near-head reuse re-greens most of the deployment off a
// single read and the refresh rotation is never asked to do anything, which would
// make the recovery bound below look good for a reason that has nothing to do with
// it. Descending, no worker can be helped by another's read, and every one of the
// nine must be re-anchored on its own.
func slowWorkerBlock(i int) uint64 { return uint64(10_000_000 - 1_000_000*i) }

func slowWorkerOf(block uint64) int { return 10 - int(block/1_000_000) }

// TestSlowSuccessfulReadsStayBoundedAndStillRecover is Codex round 10's [high],
// measured on the axis wave 11 left easy.
//
// AXES VARIED: A (cursors three days behind), B (every successful read costs four
// seconds), D (nine workers on one chain). Axis C is held easy on purpose — every
// read SUCCEEDS. That is the whole point: nothing here is a failure, so no failure
// guard fires, and the pre-fix daemon paid nine reads per pass forever while every
// health signal said the chain was fine.
func TestSlowSuccessfulReadsStayBoundedAndStillRecover(t *testing.T) {
	const (
		roundCost = 200 * time.Millisecond // the daemon's own hot-loop round
		span      = 300 * time.Second      // ten reuse windows of simulated time
	)

	h, clk := newTestHealth()
	start := clk.now()
	caughtUp := false
	var reads []stampKey

	// THE LATENCY AXIS, and it is inside the fetch rather than around the pass on
	// purpose: the defect is that a pass's own duration was not attributed to the
	// reads that caused it, so a harness that advanced the clock only between passes
	// could not see it. This advances DURING each read, which is where the time
	// actually goes.
	fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
		reads = append(reads, stampKey{chainID: chainID, block: block})
		clk.advance(slowReadLatency)
		if caughtUp {
			return uint64(clk.now().Add(-30 * time.Second).Unix()), nil
		}
		return uint64(clk.now().Add(-backfillAge).Unix()), nil
	}

	judge := newStalenessJudge(fetch, clk.now, clk.verdict)
	var walkers []*walkerState
	pr := &fakeProgress{}
	names := make([]string, slowChainWorkers)
	for i := 0; i < slowChainWorkers; i++ {
		names[i] = fmt.Sprintf("eth:stream-%d", i)
		walkers = append(walkers, &walkerState{w: &fakeIngestWorker{name: names[i]}, chainID: 1})
		pr.ingest = append(pr.ingest, store.CursorProgress{Name: names[i], Block: slowWorkerBlock(i), UpdatedAt: clk.now()})
	}
	watch := progressWatch{walkers: walkers, staleness: judge}

	rounds := 0
	round := func() {
		rounds++
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
		clk.advance(roundCost)
		// A backfill advances every cursor every round — which is what defeats the
		// exact-block memo and made this pass cost a read per worker per round.
		for i := range pr.ingest {
			pr.ingest[i].Block++
			pr.ingest[i].UpdatedAt = clk.now() // the stall gate is not this test's subject
		}
	}

	round()
	require.Len(t, reads, slowChainWorkers,
		"the FIRST pass anchors every worker, and that read is unbudgeted: a worker with no anchor at all has nothing to reuse, and refusing it would report a measurable worker as unmeasured")
	require.Equal(t, slowChainWorkers*slowReadLatency, clk.now().Sub(start)-roundCost,
		"and that first pass took 36 s — longer than the 30 s reuse window, which is the precondition of the whole finding")

	for clk.now().Sub(start) < span {
		round()
	}
	elapsed := clk.now().Sub(start)
	windows := int(elapsed / headerRestampThrottle)
	t.Logf("slow successful reads: %d header reads and %d completed rounds over %s (%d reuse windows)",
		len(reads), rounds, elapsed.Truncate(time.Second), windows)

	// THE MEASURED COMPARISON, both halves of the fix reverted (round-start stamping
	// and no refresh budget), same harness, same five minutes:
	//
	//	                       header reads   COMPLETED ROUNDS   simulated
	//	pre-fix (measured)              81                  9      5m25s
	//	this code                       36                780      5m00s
	//
	// The read count barely doubles. The ROUND COUNT is the finding: nine sequential
	// four-second reads is 36 s of wall clock per pass, so the daemon completes nine
	// rounds in five minutes and a backfill runs at that rate — the hot-loop collapse
	// the throttle was added to prevent, restored in full, on an endpoint that never
	// once failed.
	//
	// And the number that makes the axes table worth writing: wave 11's cost harness,
	// run against this same reverted code, still reports its 9-reads-per-20-rounds.
	// It cannot see any of this, because its reads are instantaneous.
	require.LessOrEqual(t, len(reads), slowChainWorkers+windows*slowBudgetRotation,
		"a chain may not spend more than headerFetchTimeout of refresh reads per reuse window, whatever a pass costs and however many workers are gated (pre-fix, measured: 81)")
	require.Greater(t, rounds, 500,
		"the hot loop must keep turning (pre-fix, measured: 9 rounds in five minutes)")

	// BOUND 2, FRESHNESS — AND THAT IT IS FAIR. Every worker must have been
	// re-anchored, not just the ones the judged order reaches first. Without the due
	// queue the first three workers win the budget in every window and the last six
	// are never re-read at all, which would make "⌈W/R⌉ windows" a claim with nothing
	// behind it.
	refreshes := map[int]int{}
	for _, k := range reads[slowChainWorkers:] {
		refreshes[slowWorkerOf(k.block)]++
	}
	for i := 0; i < slowChainWorkers; i++ {
		require.GreaterOrEqualf(t, refreshes[i], 2,
			"worker %d was starved of the chain's refresh budget: refreshes are QUEUED when the budget is spent, so no worker may be passed over twice while another repeats", i)
	}

	// CATCH-UP RECOVERY. The workers reach the head. Their anchors do not know that,
	// so they keep reading red off them until each is re-anchored — the fail-closed
	// price, and the thing that must be BOUNDED rather than merely small.
	caughtUp = true
	recoveryStart := clk.now()
	recoveryBound := time.Duration(slowBudgetRotation+1) * headerRestampThrottle
	stillRedAfterOneWindow := -1
	greenAfter := time.Duration(-1)
	for greenAfter < 0 {
		round()
		rep := h.report()
		red := 0
		for _, n := range names {
			if _, ok := rep.Recoverable[n+"/"+conditionStaleness]; ok {
				red++
			}
		}
		since := clk.now().Sub(recoveryStart)
		if stillRedAfterOneWindow < 0 && since >= headerRestampThrottle {
			stillRedAfterOneWindow = red
		}
		if red == 0 {
			greenAfter = since
		}
		require.Less(t, since, recoveryBound,
			"the red is BOUNDED: every anchor is re-read within ⌈W/R⌉ windows, so a caught-up deployment recovers rather than staying red for as long as the endpoint stays slow")
	}
	// Asserted after the loop, and on a value the loop had to have recorded: a
	// recovery that finished inside the first window would leave this at -1 and fail
	// here rather than silently skipping the assertion.
	require.Greater(t, stillRedAfterOneWindow, 0,
		"one window is NOT enough once the budget binds, and this is the disclosure that changed: wave 11 said a caught-up worker stays red for at most one reuse window, and with a slow endpoint the honest ceiling is ⌈W/R⌉ of them")
	t.Logf("catch-up: %d of %d workers still red after one window; all green after %s (bound %s)",
		stillRedAfterOneWindow, slowChainWorkers, greenAfter.Truncate(time.Second), recoveryBound)
}

// TestTheReuseWindowStartsWhenTheReadFINISHES isolates the completion stamp from
// the budget, because the two fixes are separable and a test that only exercises
// them together cannot say which one is load-bearing.
//
// AXES VARIED: A (cursor three days behind), B (one twenty-second read). ONE worker,
// so the budget can never bind and nothing here depends on it.
//
// The arithmetic is chosen so the two stampings disagree and nothing else does. The
// read starts at t=0 and finishes at t=20. At t=40 the anchor is 20 s old measured
// from the FETCH COMPLETING (reusable) and 40 s old measured from the pass STARTING
// (expired). One implementation pays a second read there; the other does not.
func TestTheReuseWindowStartsWhenTheReadFINISHES(t *testing.T) {
	const readLatency = 20 * time.Second

	h, clk := newTestHealth()
	var reads []stampKey
	fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
		reads = append(reads, stampKey{chainID: chainID, block: block})
		clk.advance(readLatency)
		return uint64(clk.now().Add(-backfillAge).Unix()), nil
	}
	name := "eth:aave-etherfi"
	watch := progressWatch{
		walkers:   []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}},
		staleness: newStalenessJudge(fetch, clk.now, clk.verdict),
	}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: 20_000_000, UpdatedAt: clk.now()}}}
	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
		pr.ingest[0].Block++
		pr.ingest[0].UpdatedAt = clk.now()
	}

	round() // starts at t=0, the read completes at t=20
	require.Len(t, reads, 1)
	require.Equal(t, readLatency, clk.now().Sub(time.Unix(1_000_000, 0)), "the pass cost exactly one slow read")

	clk.advance(20 * time.Second) // t = 40: 20 s past the completion, 40 s past the pass start
	round()
	require.Len(t, reads, 1,
		"the reuse window runs from the moment the read FINISHED. Stamping it with the time the pass began charges the anchor for the latency of the read that produced it, and at nine sequential reads that expires every anchor in the pass before the next pass can use one")

	clk.advance(11 * time.Second) // t = 51: 31 s past the completion
	round()
	require.Len(t, reads, 2,
		"and it is still a WINDOW: past 30 s from the completion the anchor is re-read, so the completion stamp lengthens nothing — it merely stops the window being spent before it starts")
}

// TestSchedulingRunsOnTheMonotonicClockAndTheVerdictDoesNot pins the SEPARATION
// itself, on both reuse arms, which neither of the other tests can do.
//
// AXES VARIED: E, in its second form — not a rollback, but the two clocks simply
// being different clocks. Everything else is held easy.
//
// Every other test in this package drives both of the judge's clocks from ONE fake,
// which is realistic (a healthy daemon's monotonic clock and its database's clock do
// advance together) and is exactly why it cannot see a confusion between them. Here
// they are moved independently, so each assertion fails if either role reads the
// other's clock. The direction that matters is stated in stalenessJudge: a verdict
// may never be measured on the daemon's wall clock, and scheduling may never be
// measured on a clock a verdict depends on — a database clock step would otherwise
// expire or extend every reuse window in the deployment at once.
func TestSchedulingRunsOnTheMonotonicClockAndTheVerdictDoesNot(t *testing.T) {
	base := time.Unix(1_000_000, 0).UTC()
	name := "eth:aave-etherfi"

	// run drives one worker whose header is headerAge old, and returns the read log.
	run := func(t *testing.T, headerAge time.Duration, verdictStep time.Duration) []stampKey {
		t.Helper()
		h, _ := newTestHealth()
		sched, db := pinnedClock(base), pinnedClock(base)
		var reads []stampKey
		fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
			reads = append(reads, stampKey{chainID: chainID, block: block})
			return uint64(db.now().Add(-headerAge).Unix()), nil
		}
		watch := progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}},
			staleness: newStalenessJudge(fetch, sched.now, db.verdict),
		}
		pr := &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: 20_000_000, UpdatedAt: base}}}
		round := func() {
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, sched.now(), rc, watch)
			publishRound(h, rc)
			pr.ingest[0].Block++
		}

		round()
		require.Len(t, reads, 1, "the first measurement is a real read")

		// THE VERDICT CLOCK MOVES, well past the reuse window; scheduling does not.
		db.advance(verdictStep)
		round()
		require.Len(t, reads, 1,
			"the reuse window is SCHEDULING, so it is measured on the monotonic clock alone: a database-clock step must not expire every retained stamp in the deployment at once")

		// THE SCHEDULING CLOCK MOVES past the window; the verdict clock does not.
		sched.advance(headerRestampThrottle + time.Second)
		round()
		require.Len(t, reads, 2,
			"and the window really is a window — it is simply measured on the clock whose job that is")
		return reads
	}

	t.Run("deep-stale arm", func(t *testing.T) {
		// Three days old, so the deep-stale arm answers, and a five-minute verdict-clock
		// step cannot take it out of that arm.
		run(t, backfillAge, 10*headerRestampThrottle)
	})

	t.Run("near-head arm", func(t *testing.T) {
		// One minute old, so the near-head arm answers. The verdict step is two minutes
		// — four times the reuse window, and still inside bound/2 once added to the
		// header's age, so the arm is the same arm before and after.
		run(t, time.Minute, 2*time.Minute)
	})

	// THE REFRESH BUDGET'S OWN WINDOW is scheduling as well, and it is the arm with
	// the worst failure mode of the three, which is why it gets its own scenario
	// rather than a line in the one above. A budget windowed on the verdict clock
	// stops rolling the moment that clock stops moving or steps back: the first
	// window's allowance is spent, never renewed, and every deep-stale worker on the
	// chain rides an anchor nothing ever re-reads again. That is a permanent, silent
	// loss of the catch-up guarantee — the very guarantee the budget was added
	// alongside — and no verdict would ever look wrong. Found by mutation (M15), not
	// by review.
	t.Run("refresh budget window", func(t *testing.T) {
		h, _ := newTestHealth()
		sched, db := pinnedClock(base), pinnedClock(base) // db deliberately never moves
		var reads []stampKey
		fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
			reads = append(reads, stampKey{chainID: chainID, block: block})
			sched.advance(slowReadLatency)
			return uint64(db.now().Add(-backfillAge).Unix()), nil
		}
		var walkers []*walkerState
		pr := &fakeProgress{}
		for i := 0; i < slowChainWorkers; i++ {
			n := fmt.Sprintf("eth:stream-%d", i)
			walkers = append(walkers, &walkerState{w: &fakeIngestWorker{name: n}, chainID: 1})
			pr.ingest = append(pr.ingest, store.CursorProgress{Name: n, Block: slowWorkerBlock(i), UpdatedAt: base})
		}
		watch := progressWatch{walkers: walkers, staleness: newStalenessJudge(fetch, sched.now, db.verdict)}
		start := sched.now()
		for sched.now().Sub(start) < 4*headerRestampThrottle {
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, sched.now(), rc, watch)
			publishRound(h, rc)
			sched.advance(200 * time.Millisecond)
			for i := range pr.ingest {
				pr.ingest[i].Block++
			}
		}
		require.Greater(t, len(reads), slowChainWorkers+slowBudgetRotation,
			"the budget window must roll on the MONOTONIC clock: windowed on a verdict clock that is not moving, it spends its first allowance and renews it never, and the deployment silently stops re-anchoring altogether")
	})
}

// TestAClockRollbackSmallerThanTheHeaderAgeCannotTurnStalenessGreen is Codex round
// 10's [medium], in the arrangement wave 11's rollback tests could not reach.
//
// AXES VARIED: E only (the daemon's wall clock is stepped back and disagrees with
// the database's). Everything else is held easy so that the clock is unambiguously
// the cause: one worker, one chain, one instantaneous successful read.
//
// Wave 11's rollback tests all used a rollback LARGER than the retained stamp's age,
// which makes the stamp future and trips beyondSkewTolerance. This is the other
// side: a header fifteen minutes old under a ten-minute rollback is still five
// minutes in the past, so nothing trips, and the age the gate computes is five
// minutes — green against a ten-minute bound while the state served is fifteen
// minutes old. The test asserts the precondition explicitly so it cannot pass for
// the wrong reason, and asserts the counterfactual so it cannot pass by accident.
func TestAClockRollbackSmallerThanTheHeaderAgeCannotTurnStalenessGreen(t *testing.T) {
	const (
		headerAge = 15 * time.Minute
		rollback  = 10 * time.Minute
	)
	name := "eth:aave-etherfi"
	block := uint64(20_000_000)

	h, db := newTestHealth()    // db is the DATABASE clock: the time authority
	daemon := pinnedClock(db.t) // and this is the daemon's own wall clock
	daemon.advance(-rollback)   // which an NTP step, a VM restore or a snapshot rollback has moved

	headerTime := db.now().Add(-headerAge)
	require.False(t, beyondSkewTolerance(headerTime, daemon.now()),
		"THE PRECONDITION: on the rolled-back clock the header is still five minutes in the PAST, so the future-skew guard does not fire and cannot be what saves this. An old header absorbs a rollback smaller than its own age")
	require.Greater(t, headerAge, maxDerivedStaleness, "the true age is over the bound")
	require.Less(t, headerAge-rollback, maxDerivedStaleness, "and the rolled-back age is under it: the rollback crosses the health boundary, which is what makes this a false GREEN rather than a rounding error")

	hdr := newFakeHeaderTimes().set(1, block, headerTime)
	watch := progressWatch{
		walkers: []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}},
		// THE FIX: scheduling runs off the daemon's clock (it may, it is monotonic and
		// no verdict reads it); the VERDICT runs off the database's.
		staleness: newStalenessJudge(hdr.fetch, daemon.now, db.verdict),
	}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: block, UpdatedAt: db.now()}}}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, daemon.now(), rc, watch)
	publishRound(h, rc)

	rep := h.report()
	require.Contains(t, rep.Recoverable, name+"/"+conditionStaleness,
		"a rollback of the daemon's wall clock must not move a liquidation-facing freshness verdict: the age is measured against the database clock, which did not move")
	require.NotContains(t, rep.Recoverable, name+"/"+conditionStalenessUnmeasured,
		"and it is a MEASURED red, not a refusal: the daemon can still measure this cursor perfectly well, it simply must not use its own clock to do it")
	require.Contains(t, rep.Recoverable[name+"/"+conditionStaleness], "15m0s old",
		"the reported age is the real one. Rendering 5m here would under-state the exposure by exactly the rollback, on the surface an operator reads")
	require.False(t, rep.Ready)

	// THE COUNTERFACTUAL, so this cannot pass by coincidence: the same round, judged
	// against the daemon's own clock, is GREEN. That is the shipped behaviour Codex
	// found, reproduced here rather than described.
	h2, _ := newTestHealth()
	hdr2 := newFakeHeaderTimes().set(1, block, headerTime)
	watch2 := progressWatch{
		walkers:   []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}},
		staleness: newStalenessJudge(hdr2.fetch, daemon.now, daemon.verdict),
	}
	rc2 := roundConditions{}
	applyProgressConditions(context.Background(), pr, daemon.now(), rc2, watch2)
	publishRound(h2, rc2)
	require.NotContains(t, h2.report().Recoverable, name+"/"+conditionStaleness,
		"with the daemon's wall clock as the time authority the very same state reads GREEN — which is the defect, and the reason the authority is not negotiable")
}

// TestNoTrustedClockIsUnmeasuredNeverGreen pins the other half of the verdict-clock
// rule: what happens when the authority cannot be reached.
//
// The tempting handling is to fall back to the daemon's wall clock "just for this
// round", and that is precisely the substitution the [medium] is about — the
// fallback is not a degraded verdict, it is an unverifiable one, and on this surface
// unverifiable resolves to green. The header here is FRESH, so a fallback would
// produce a confident, wrong all-clear.
func TestNoTrustedClockIsUnmeasuredNeverGreen(t *testing.T) {
	h, clk := newTestHealth()
	walker, consumer := "eth:aave-etherfi", "aave"
	hdr := newFakeHeaderTimes().set(1, 20_000_000, clk.now().Add(-time.Second))
	watch := progressWatch{
		walkers:   []*walkerState{{w: &fakeIngestWorker{name: walker}, chainID: 1}},
		consumers: []frontierWatch{{worker: consumer, streams: []string{walker}, chainID: 1}},
		staleness: newStalenessJudge(hdr.fetch, clk.now, brokenClock(errors.New("dial tcp: connection refused"))),
	}
	pr := &fakeProgress{
		ingest: []store.CursorProgress{{Name: walker, Block: 20_000_000, UpdatedAt: clk.now()}},
		derive: []store.CursorProgress{{Name: consumer, Block: 20_000_000, UpdatedAt: clk.now()}},
	}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
	publishRound(h, rc)

	rep := h.report()
	for _, w := range []string{walker, consumer} {
		require.Containsf(t, rep.Recoverable, w+"/"+conditionStalenessUnmeasured,
			"%s: with no trusted clock there is no honest age, and the gate says so rather than substituting one", w)
		require.NotContainsf(t, rep.Recoverable, w+"/"+conditionStaleness,
			"%s: and it does not fabricate a RED either — it asserts only that it could not look", w)
		require.Contains(t, rep.Recoverable[w+"/"+conditionStalenessUnmeasured], "connection refused",
			"the operator is told what actually failed")
	}
	require.False(t, rep.Ready, "an unmeasured freshness bound fails readiness")
	require.Empty(t, hdr.calls,
		"and no header read is paid for: without a clock to judge the answer against, the read could not be turned into a verdict anyway")
}
