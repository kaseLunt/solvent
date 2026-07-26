package main

// ROUND-9 tests for the two defects in the freshness gate's REUSE paths.
//
//   - [high] the restamp throttle could never fire during a genuine historical
//     backfill, because its only reuse arm required the retained stamp's implied
//     age to sit inside half the bound and a cursor days behind head can never
//     imply that. Every gated worker therefore refetched every hot round, taxing
//     the very endpoints the backfill depends on. Fixed by a second, DEEP-STALE
//     reuse arm, and measured here on OLD cursor timestamps — the hard case the
//     wave-9 harness did not model.
//   - [medium] every reuse path returned before the L2 future-skew guard, so a
//     daemon clock stepped backwards past the tolerance turned a legitimate cached
//     stamp grossly future and stalenessAge clamped the age to zero: false-green,
//     forever, at a block nothing ever re-read. Fixed by applying the guard at
//     read-out as well as at write-in, and exercised here on EVERY arm.
//
// These share health_test.go's harness (newTestHealth, fakeHeaderTimes, publishRound).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// uniqueStamps deduplicates a call log, so a cost assertion can distinguish "nine
// distinct measurements" from "nine reads of the same thing".
func uniqueStamps(reads []stampKey) map[stampKey]bool {
	out := map[stampKey]bool{}
	for _, k := range reads {
		out[k] = true
	}
	return out
}

// backfillAge is how far behind the chain a GENUINE historical backfill sits. It is
// the number the wave-9 cost harness did not use: its cursors were fresh and
// advancing, so its reuse arm was reachable and its measured 13-reads-per-20-rounds
// described a regime a backfilling deployment is never in.
const backfillAge = 72 * time.Hour

// TestDeepStaleBackfillReusesTheAnchorInsteadOfRefetchingEveryRound is the [high]
// finding's direct regression.
//
// The cursor is three days behind head and advances every round — the definition of
// a historical backfill. Before the deep-stale arm the retained stamp's implied age
// (three days) failed `age <= bound/2` on every single round, so every round paid a
// header read. The assertions here are on the CALL LOG, so a regression shows up as
// a count rather than as a plausible-looking pass.
func TestDeepStaleBackfillReusesTheAnchorInsteadOfRefetchingEveryRound(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes()
	start := uint64(20_000_000)
	// Every block in the backfill range carries a three-day-old header: this is a
	// backfill, so advancing does not make the state fresh.
	for b := start; b <= start+400; b++ {
		hdr.set(1, b, clk.now().Add(-backfillAge))
	}
	judge := newStalenessJudge(hdr.fetch)
	worker := &walkerState{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}
	watch := progressWatch{walkers: []*walkerState{worker}, staleness: judge}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: start, UpdatedAt: clk.now()}}}
	key := "eth:aave-etherfi/" + conditionStaleness

	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
	}

	round()
	require.Len(t, hdr.calls, 1, "the first measurement is a real fetch")
	require.Contains(t, h.report().Recoverable, key, "a three-day-old cursor is stale, and says so")

	// A hot inner loop: 100 rounds at 200 ms, the cursor advancing every round.
	// That is 20 s — inside one reuse window — and it must cost NOTHING.
	for i := 1; i <= 100; i++ {
		clk.advance(200 * time.Millisecond)
		pr.ingest[0].Block = start + uint64(i)
		round()
	}
	require.Len(t, hdr.calls, 1,
		"a deep-stale advancing cursor is answered from the retained anchor: before the deep-stale arm this was 101 sequential header reads")
	require.Contains(t, h.report().Recoverable, key,
		"and the reused anchor still yields the REAL verdict — the reuse is fail-closed, not silent")

	// THE PERIODIC EXACT REFRESH, and the proof that reuse does not renew the
	// window. 100 reuses have just happened; the window is nonetheless measured
	// from the FETCH, so it expires on schedule and the anchor is re-read exactly
	// once. If reuse renewed fetchedAt this assertion would fail — and a caught-up
	// worker would then be pinned red indefinitely.
	require.Less(t, clk.now().Sub(clk.now().Add(-20*time.Second)), headerRestampThrottle,
		"sanity: the 100 rounds above really did fit inside one reuse window")
	clk.advance(headerRestampThrottle)
	pr.ingest[0].Block = start + 101
	round()
	require.Len(t, hdr.calls, 2, "the anchor is re-read exactly once per reuse window, however many reuses rode on it")
	require.Equal(t, stampKey{chainID: 1, block: start + 101}, hdr.calls[1],
		"and the refresh is EXACT: it measures the block the cursor actually stands at now")
}

// THE DEEP-STALE ARM IS GREEN-PROOF, and that is why it is safe to admit at all.
//
// Reuse is upward-only, so the reused timestamp is at or below the true one and the
// age it yields is an OVER-estimate; the arm additionally requires the anchor's own
// age to already exceed the bound. The two together mean this arm can only ever
// return a timestamp a verdict reads as STALE. The price is the opposite error — a
// worker that has just caught up is held red — and this pins how long that lasts:
// one reuse window, not indefinitely.
func TestDeepStaleReuseCanOnlyOverstateAgeAndIsCorrectedWithinOneWindow(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes()
	old, caughtUp := uint64(20_000_000), uint64(20_000_050)
	hdr.set(1, old, clk.now().Add(-backfillAge))
	judge := newStalenessJudge(hdr.fetch)
	worker := &walkerState{w: &fakeIngestWorker{name: "eth:aave-etherfi"}, chainID: 1}
	watch := progressWatch{walkers: []*walkerState{worker}, staleness: judge}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: "eth:aave-etherfi", Block: old, UpdatedAt: clk.now()}}}
	stale := "eth:aave-etherfi/" + conditionStaleness
	round := func() {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
	}

	round()
	require.Contains(t, h.report().Recoverable, stale)

	// The walker CATCHES UP: its new cursor block is genuinely current. The anchor
	// is not, so the reused answer is wrong — in the fail-closed direction.
	clk.advance(time.Second)
	hdr.set(1, caughtUp, clk.now().Add(-30*time.Second))
	pr.ingest[0].Block = caughtUp
	round()
	require.Len(t, hdr.calls, 1, "still riding the anchor")
	require.Contains(t, h.report().Recoverable, stale,
		"a caught-up worker reads RED off a stale anchor: reuse over-estimates age, which is the only direction that is safe")

	// And the over-estimate has a deadline: the next exact refresh clears it.
	clk.advance(headerRestampThrottle)
	hdr.set(1, caughtUp, clk.now().Add(-30*time.Second))
	round()
	require.Len(t, hdr.calls, 2)
	require.NotContains(t, h.report().Recoverable, stale,
		"one reuse window is the whole cost of the approximation being wrong")
}

// ONE WORKER'S BACKFILL MUST NOT DATE ANOTHER WORKER'S CURSOR.
//
// This is the defect the deep-stale arm would have introduced if it read the
// CHAIN-keyed stamp the other two arms read. Chains routinely carry a caught-up
// worker and a backfilling one at the same time — a newly-added stream, a
// post-rewind re-derive — and if the backfiller's three-day-old anchor could answer
// for the caught-up worker, the gate would report a demonstrably fresh worker stale.
// Fail-closed, and wrong: a gate that names the wrong worker is one an operator
// learns to distrust. The anchor is therefore keyed per worker.
//
// The lagging worker is judged FIRST, which is the order that makes the mistake
// possible; judged second it would never arise, and a test that arranged it that way
// would prove nothing.
func TestOneWorkersBackfillAnchorNeverDatesAnotherWorkersCursor(t *testing.T) {
	h, clk := newTestHealth()
	hdr := newFakeHeaderTimes()
	lagging, fresh := "eth:feed-pyusd", "eth:aave-etherfi"
	lagBlock, freshBlock := uint64(19_626_469), uint64(20_780_000)
	for i := uint64(0); i <= 40; i++ {
		hdr.set(1, lagBlock+i, clk.now().Add(-backfillAge))
		hdr.set(1, freshBlock+i, clk.now().Add(-30*time.Second))
	}
	watch := progressWatch{
		walkers: []*walkerState{
			{w: &fakeIngestWorker{name: lagging}, chainID: 1},
			{w: &fakeIngestWorker{name: fresh}, chainID: 1},
		},
		staleness: newStalenessJudge(hdr.fetch),
	}
	pr := &fakeProgress{ingest: []store.CursorProgress{
		{Name: lagging, Block: lagBlock, UpdatedAt: clk.now()},
		{Name: fresh, Block: freshBlock, UpdatedAt: clk.now()},
	}}

	for i := uint64(0); i < 20; i++ {
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
		publishRound(h, rc)
		rep := h.report()
		require.Contains(t, rep.Recoverable, lagging+"/"+conditionStaleness,
			"round %d: the worker that really is three days behind is red", i)
		require.NotContains(t, rep.Recoverable, fresh+"/"+conditionStaleness,
			"round %d: and the worker that is NOT behind must not inherit the other one's anchor", i)
		clk.advance(200 * time.Millisecond)
		pr.ingest[0].Block++
		pr.ingest[1].Block++
	}
	require.Len(t, hdr.calls, 2,
		"one exact read each, then both ride their own anchors: the separation costs nothing")
}

// THE COST HARNESS, REBUILT ON OLD CURSOR TIMESTAMPS.
//
// Wave 9 measured a backfill whose cursors were FRESH and advancing. That regime
// keeps the near-head reuse arm reachable, so the numbers it produced (13 reads
// across 20 rounds) described a case that cannot occur during the thing the gate has
// to survive. Every number below models the HARD case: cursors three days behind
// head, in the real deployment's shape — config/contracts.json's 10 streams over 2
// chains plus 2 derivation runners and 1 feed deriver as raw-log consumers, i.e. 13
// gated workers, judged in the order the daemon judges them.
//
// It is a SHIPPED test, with assertions, deliberately: wave 9's cost figures lived
// in a throwaway harness and were therefore undefended by CI (its own residual #2).
func TestStalenessPassCostOnAGenuineHistoricalBackfillAndADeadChain(t *testing.T) {
	// The real deployment's streams, in config order, with their configured
	// StartBlocks — so the ORDER cursors are judged in is the deployment's, not a
	// convenient ascending one. Order matters: a fetch re-anchors the chain for
	// every worker judged after it at a HIGHER block, so a descent in the sequence
	// is what a refresh window actually costs.
	type stream struct {
		name    string
		chainID uint64
		start   uint64
	}
	streams := []stream{
		{"op:debt-manager", 10, 149_521_228},
		{"eth:aave-etherfi", 1, 20_625_519},
		{"eth:atoken-weeth", 1, 20_625_519},
		{"eth:atoken-usdc", 1, 20_625_519},
		{"eth:atoken-pyusd", 1, 20_625_519},
		{"eth:atoken-frax", 1, 20_625_519},
		{"eth:feed-weeth", 1, 20_779_893},
		{"eth:feed-usdc", 1, 20_188_117},
		{"eth:feed-pyusd", 1, 19_626_469},
		{"eth:feed-frax", 1, 20_191_185},
	}
	// The three raw-log CONSUMERS, each trailing its feeding streams' frontier.
	type consumer struct {
		name    string
		chainID uint64
		streams []string
		start   uint64
	}
	consumers := []consumer{
		{"debt_manager", 10, []string{"op:debt-manager"}, 149_521_000},
		{"aave", 1, []string{"eth:aave-etherfi", "eth:atoken-weeth", "eth:atoken-usdc", "eth:atoken-pyusd", "eth:atoken-frax"}, 20_625_000},
		{"prices:feed:1", 1, []string{"eth:feed-weeth", "eth:feed-usdc", "eth:feed-pyusd", "eth:feed-frax"}, 19_626_000},
	}

	// build assembles the watch and the durable cursor listing for one scenario.
	build := func(clk *fakeClock, fetch headerTimeFetcher) (progressWatch, *fakeProgress) {
		var walkers []*walkerState
		var watched []frontierWatch
		pr := &fakeProgress{}
		for _, s := range streams {
			walkers = append(walkers, &walkerState{w: &fakeIngestWorker{name: s.name}, chainID: s.chainID})
			pr.ingest = append(pr.ingest, store.CursorProgress{Name: s.name, Block: s.start, UpdatedAt: clk.now()})
		}
		for _, c := range consumers {
			watched = append(watched, frontierWatch{worker: c.name, streams: c.streams, chainID: c.chainID})
			pr.derive = append(pr.derive, store.CursorProgress{Name: c.name, Block: c.start, UpdatedAt: clk.now()})
		}
		return progressWatch{walkers: walkers, consumers: watched, staleness: newStalenessJudge(fetch)}, pr
	}
	require.Equal(t, 13, len(streams)+len(consumers), "13 gated workers, as deployed")

	// advance moves every cursor on by one block, which is what a backfilling
	// round does and what defeated the exact-block memo every round.
	advance := func(pr *fakeProgress) {
		for i := range pr.ingest {
			pr.ingest[i].Block++
		}
		for i := range pr.derive {
			pr.derive[i].Block++
		}
	}

	const rounds = 20

	t.Run("stale successful backfill, hot loop at 200ms", func(t *testing.T) {
		h, clk := newTestHealth()
		// EVERY block, on either chain, carries a three-day-old header — which is
		// what "successful historical backfill" means: the reads succeed, and the
		// state they describe is still days behind. Nothing here can be answered
		// by a fetch that failed for want of fake data.
		var reads []stampKey
		fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
			reads = append(reads, stampKey{chainID: chainID, block: block})
			return uint64(clk.now().Add(-backfillAge).Unix()), nil
		}
		watch, pr := build(clk, fetch)
		for i := 0; i < rounds; i++ {
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
			publishRound(h, rc)
			clk.advance(200 * time.Millisecond)
			advance(pr)
		}
		t.Logf("stale backfill: %d header reads over %d rounds (%.2f/round)", len(reads), rounds, float64(len(reads))/rounds)
		require.Equal(t, 9, len(reads),
			"a genuine three-day-behind backfill costs NINE header reads across 20 hot rounds — one per DISTINCT (chain, cursor block) among the 13 gated workers, once, and nothing more until the reuse window expires. Before the deep-stale arm the same 20 rounds cost 260 reads, because every worker's anchor failed the near-head test every round")
		require.Len(t, uniqueStamps(reads), 9,
			"and every one of them is a distinct measurement: none is a re-read of something already anchored")
		// The verdict is not bought with silence: every gated worker is red.
		rep := h.report()
		for _, s := range streams {
			require.Contains(t, rep.Recoverable, s.name+"/"+conditionStaleness, "%s", s.name)
		}
		for _, c := range consumers {
			require.Contains(t, rep.Recoverable, c.name+"/"+conditionStaleness, "%s", c.name)
		}
	})

	t.Run("both chains dead, hot loop at 200ms", func(t *testing.T) {
		h, clk := newTestHealth()
		var reads []stampKey
		fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
			reads = append(reads, stampKey{chainID: chainID, block: block})
			return 0, errors.New("rpc unreachable")
		}
		watch, pr := build(clk, fetch)
		for i := 0; i < rounds; i++ {
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
			publishRound(h, rc)
			clk.advance(200 * time.Millisecond)
			advance(pr)
		}
		t.Logf("dead chains: %d header reads over %d rounds (%.2f/round)", len(reads), rounds, float64(len(reads))/rounds)
		require.Equal(t, 2, len(reads),
			"a dead chain costs ONE attempt per chain per headerFetchCooldown window, not one per worker per round: the round down-set collapses the round and the cooldown collapses the rounds")
		rep := h.report()
		for _, s := range streams {
			require.Contains(t, rep.Recoverable, s.name+"/"+conditionStalenessUnmeasured, "%s", s.name)
		}
	})

	// WHAT THE COOLDOWN IS WORTH, stated in the unit the down-set leaves. The
	// wave-9 report claimed 13 failures per round without it; that was wrong, and
	// Codex was right to say so — the per-round down-set already collapses a
	// round's failures to one per CHAIN. The honest counterfactual is one timeout
	// per chain per round, which this leg measures by running the same dead-chain
	// scenario with rounds spaced past the cooldown.
	t.Run("dead chains with every round past the cooldown — the no-cooldown counterfactual", func(t *testing.T) {
		h, clk := newTestHealth()
		var reads []stampKey
		fetch := func(_ context.Context, chainID, block uint64) (uint64, error) {
			reads = append(reads, stampKey{chainID: chainID, block: block})
			return 0, errors.New("rpc unreachable")
		}
		watch, pr := build(clk, fetch)
		for i := 0; i < rounds; i++ {
			rc := roundConditions{}
			applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
			publishRound(h, rc)
			clk.advance(headerFetchCooldown + time.Second)
			advance(pr)
		}
		t.Logf("dead chains, rounds past the cooldown: %d header reads over %d rounds (%.2f/round)", len(reads), rounds, float64(len(reads))/rounds)
		require.Equal(t, 2*rounds, len(reads),
			"once every round outlives the cooldown the cost is one attempt per CHAIN per round — 2, not 13: the down-set, not the cooldown, is what bounds a round")
	})
}

// ROUND 9's [medium] — THE GUARD APPLIED AT WRITE-IN BUT NOT AT READ-OUT.
//
// Each subtest arranges ONE of measure's reuse paths, then steps the daemon clock
// BACKWARDS far enough to put the retained stamp past headerTimeSkewTolerance — an
// NTP correction, a VM restore, a hypervisor rollback. Before the fix each of these
// returned the now-future stamp, stalenessAge clamped the negative age to zero, and
// the worker read green forever at a block nothing re-read. Every arm is covered
// because "one arm gated, the other open" is precisely the shape this surface keeps
// shipping.
//
// STATED PLAINLY so the coverage claim is not overread: the guard is evaluated ONCE,
// before the arm is selected, so all three arrangements below execute the same
// comparison. They are still all here — the arrangements are what a future edit
// would break, by moving the check inside a case or duplicating it into two.
//
// The rollback each case needs is a function of the arrangement, which is itself a
// finding worth stating: a DEEP-STALE anchor is three days old, so no plausible NTP
// step can make it future. That arm is nearly immune to this attack by construction
// — nearly, not entirely: a VM restored from a snapshot older than the anchor gets
// there, and that is what the third case models.
func TestEveryStampReuseIsRevalidatedAgainstTheCurrentClock(t *testing.T) {
	name := "eth:aave-etherfi"
	unmeasured := name + "/" + conditionStalenessUnmeasured
	measured := name + "/" + conditionStaleness

	for _, tc := range []struct {
		name string
		// anchorAge is how old the anchor's header is when it is taken.
		anchorAge time.Duration
		// offset is added to the anchor block to pick the arm: 0 exercises the
		// exact-block hit, a positive value one of the restamp-throttle arms.
		offset uint64
		// rollback is how far the daemon clock steps BACKWARDS. It must exceed
		// anchorAge + headerTimeSkewTolerance for the anchor to become invalid.
		rollback time.Duration
	}{
		{"the exact-block retained stamp", time.Minute, 0, 10 * time.Minute},
		{"the near-head restamp throttle", time.Minute, 5, 10 * time.Minute},
		{"the deep-stale restamp throttle", backfillAge, 5, backfillAge + 5*time.Minute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, clk := newTestHealth()
			hdr := newFakeHeaderTimes()
			anchor := uint64(20_000_000)
			hdr.set(1, anchor, clk.now().Add(-tc.anchorAge))
			judge := newStalenessJudge(hdr.fetch)
			watch := progressWatch{
				walkers:   []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}},
				staleness: judge,
			}
			pr := &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: anchor, UpdatedAt: clk.now()}}}
			round := func() {
				rc := roundConditions{}
				applyProgressConditions(context.Background(), pr, clk.now(), rc, watch)
				publishRound(h, rc)
			}

			round()
			require.Len(t, hdr.calls, 1, "the anchor is taken by a real fetch, which passes the guard at write-in")
			require.NotContains(t, h.report().Recoverable, unmeasured, "and it is a usable measurement")

			// THE CLOCK MOVES BACKWARDS. Nothing about the endpoint changed; the
			// retained stamp is simply no longer a valid measurement relative to
			// the clock the daemon is judging with.
			clk.advance(-tc.rollback)
			pr.ingest[0].Block = anchor + tc.offset
			hdr.set(1, anchor+tc.offset, clk.now().Add(-tc.anchorAge)) // available, if it chose to fetch
			round()

			rep := h.report()
			require.Contains(t, rep.Recoverable, unmeasured,
				"a retained stamp invalidated by the clock must be REFUSED, not served: serving it clamps the age to zero and pins this worker green forever")
			require.NotContains(t, rep.Recoverable, measured,
				"and it must not be reported as a measured age either — nothing was measured")
			require.Len(t, hdr.calls, 1,
				"the eviction costs no fetch of its own: this round has no answer, and the next one re-reads")
			require.False(t, rep.Ready)

			// RECOVERY. The clock is corrected; the evicted stamp is gone, so the
			// next round measures again and the worker returns to a real verdict.
			clk.advance(tc.rollback + time.Second)
			hdr.set(1, anchor+tc.offset, clk.now().Add(-time.Minute))
			round()
			require.Len(t, hdr.calls, 2, "eviction means the next round genuinely re-reads")
			rep = h.report()
			require.NotContains(t, rep.Recoverable, unmeasured, "and recovers")
			require.NotContains(t, rep.Recoverable, measured)
		})
	}
}

// The ROUND MEMO's arm of the same guard, exercised directly.
//
// HONEST SCOPE, because it matters for what this test claims: applyStalenessConditions
// passes ONE `now` to every measure call in a round, so a memo entry written this
// round cannot become skewed later in the same round — that arm is unreachable
// through the daemon's caller today. It is still checked, and still tested, because
// "unreachable through today's caller" is not a property of the function: measure
// takes `now` as a parameter, and a future caller passing a per-worker clock would
// walk straight into the bypass the other arms just had removed. The call below uses
// nothing but measure's own signature.
func TestTheRoundMemoIsRevalidatedAgainstTheClockToo(t *testing.T) {
	hdr := newFakeHeaderTimes()
	base := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	hdr.set(1, 1000, base.Add(-time.Minute))
	j := newStalenessJudge(hdr.fetch)
	r := newStalenessRound()

	ts, err := j.measure(context.Background(), r, base, "eth:aave-etherfi", 1, 1000, maxDerivedStaleness)
	require.NoError(t, err)
	require.Equal(t, base.Add(-time.Minute).Unix(), ts.Unix())
	require.Len(t, hdr.calls, 1)
	require.Contains(t, r.stamps, stampKey{chainID: 1, block: 1000}, "the round memo now holds it")

	// The same round value, a clock that has moved backwards past the tolerance.
	_, err = j.measure(context.Background(), r, base.Add(-10*time.Minute), "eth:aave-etherfi", 1, 1000, maxDerivedStaleness)
	require.Error(t, err, "the memo is revalidated, not trusted")
	require.Contains(t, err.Error(), "ahead of this daemon's clock")
	require.NotContains(t, r.stamps, stampKey{chainID: 1, block: 1000}, "and the invalidated entry is evicted from the round")
	require.NotContains(t, j.stamp, uint64(1), "as is the retained anchor it came from")
	require.Len(t, hdr.calls, 1, "eviction pays for no fetch")
}
