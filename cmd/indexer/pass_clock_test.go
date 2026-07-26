package main

// ROUND-11 tests for the health pass's ONE TIME AUTHORITY and for the difference
// between an authority and an INSTANT — Codex round 11's two [medium]s.
//
//	[medium] the stall gate still compared Postgres-written timestamps against the
//	         daemon's own time.Now. The previous wave fixed exactly one instance of
//	         this class (the freshness gate) and left two: cursor recency, and the
//	         snapshotter's open-generation check.
//	[medium] the pass-start reading of the trusted clock was reused verbatim for the
//	         whole pass, so tens of seconds of slow sequential reads were charged to
//	         nothing and every verdict was dated as though the pass were free.
//
// THE TWO ARE ONE FIX, and that is why they share a file: the authority is read once
// (the first finding's requirement) and then carried forward by monotonic elapsed
// time (the second's), so "one authority" never has to mean "one frozen number".
//
// AXES (extending the table in staleness_budget_test.go):
//
//	measurement                                              A  B  C  D  E
//	───────────────────────────────────────────────────────────────────────────────
//	…RollbackCannotSuppressAStall                            ·  ·  ·  ·  ✓
//	…RollbackCannotSuppressASweepStall                       ·  ·  ·  ·  ✓
//	…TrustedInstantAdvancesThroughASlowPass                  ✓  ✓  ·  ·  ·
//	…SlowDurableReadIsChargedToTheCursorsItDates             ·  ✓  ·  ·  ·
//
// Every one of them is a BOUNDARY measurement: the arranged state sits within
// seconds of the bound, and the fix is what decides which side of it the verdict
// lands on. A test whose state is far from the bound cannot tell a fixed clock from
// a broken one.

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// slowProgressReader is a progressReader whose durable reads COST TIME, charged to
// the supplied clock. It exists because the defect is precisely that a pass's own
// duration was attributed to nothing: a fake that answers instantly cannot show it.
type slowProgressReader struct {
	inner *fakeProgress
	clk   *fakeClock
	cost  time.Duration
}

func (s *slowProgressReader) IngestCursorProgress(ctx context.Context) ([]store.CursorProgress, error) {
	s.clk.advance(s.cost)
	return s.inner.IngestCursorProgress(ctx)
}

func (s *slowProgressReader) DeriveCursorProgress(ctx context.Context) ([]store.CursorProgress, error) {
	s.clk.advance(s.cost)
	return s.inner.DeriveCursorProgress(ctx)
}

func (s *slowProgressReader) SweepProgress(ctx context.Context, engine string, maxAttempts int, staleBound time.Duration) (store.SweepProgress, bool, error) {
	s.clk.advance(s.cost)
	return s.inner.SweepProgress(ctx, engine, maxAttempts, staleBound)
}

// roundTripAuthority is a time authority whose read COSTS TIME, modelled the way a
// real one does: the server captures its instant somewhere inside the trip, and the
// client only has the value once the trip is over.
//
// The instant returned is the one from BEFORE the trip — the worst case for the
// caller, and the one that makes the guarantee in passClock checkable: anchoring the
// monotonic reading before the call is what keeps now() from running BEHIND the
// database, which would shorten every age in the pass by the round-trip latency.
func roundTripAuthority(clk *fakeClock, trip time.Duration) timeAuthority {
	return timeAuthority{
		verdict: func(context.Context) (time.Time, error) {
			at := clk.now()
			clk.advance(trip)
			return at, nil
		},
		sched: clk.now,
	}
}

// TestAClockRollbackCannotSuppressAStall is Codex round 11's [medium] on the gate it
// was still open on: no_progress.
//
// THE MATERIAL CASE, stated because it is what makes this a false green rather than
// a cosmetic one. A worker that neither errors nor advances says NOTHING — that is
// the entire reason this gate exists — so the durable cursor timestamp is the only
// evidence there is. The daemon compared it against its own wall clock, and a clock
// stepped backwards (NTP correction, VM restore, hypervisor rollback) shortens every
// `since` by the whole rollback. Twenty minutes of genuine stall reads as ten and
// the gate stays green, on a surface that gates liquidation-facing data.
//
// AXES VARIED: E only. One worker, no chain, no staleness judge at all — so the
// clock is unambiguously the cause and nothing else in the pass can be.
func TestAClockRollbackCannotSuppressAStall(t *testing.T) {
	const (
		stalledFor = 20 * time.Minute
		rollback   = 10 * time.Minute
	)
	require.Greater(t, stalledFor, noProgressBound, "the true stall is over the bound")
	require.Less(t, stalledFor-rollback, noProgressBound,
		"and the rolled-back stall is under it: the rollback CROSSES the bound, which is what makes this a suppressed red rather than a rounding error")

	name := "eth:aave-etherfi"
	h, db := newTestHealth()    // db is the DATABASE clock: the time authority
	daemon := pinnedClock(db.t) // and this is the daemon's own wall clock
	daemon.advance(-rollback)   // which something moved backwards

	watch := progressWatch{walkers: []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}}}
	pr := &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: 20_000_000, UpdatedAt: db.now().Add(-stalledFor)}}}

	rc := roundConditions{}
	// The daemon's clock schedules; the DATABASE's clock judges.
	applyProgressConditions(context.Background(), pr, timeAuthority{verdict: db.verdict, sched: daemon.now}, rc, watch)
	publishRound(h, rc)

	rep := h.report()
	key := name + "/" + conditionNoProgress
	require.Contains(t, rep.Recoverable, key,
		"the cursor timestamp was written by Postgres, so it is measured against Postgres's clock: a wall-clock rollback must not talk this gate out of a stall it can see in durable state")
	require.Contains(t, rep.Recoverable[key], "20m0s",
		"and the reported figure is the REAL one — rendering 10m here would under-state the stall by exactly the rollback, on the surface an operator reads")
	require.False(t, rep.Ready)

	// THE COUNTERFACTUAL, so this cannot pass by coincidence: the identical durable
	// state, judged on the daemon's own rolled-back clock, is GREEN. That is the
	// shipped behaviour, reproduced rather than described.
	h2, _ := newTestHealth()
	rc2 := roundConditions{}
	applyProgressConditions(context.Background(), pr, daemon.authority(), rc2, watch)
	publishRound(h2, rc2)
	require.NotContains(t, h2.report().Recoverable, key,
		"with the wall clock as the authority the very same rows read GREEN — which is the defect, and why the authority is not negotiable on this gate either")
}

// TestAClockRollbackCannotSuppressASweepStall is the same finding on the other
// timestamp it was still open on, and the one the finding singles out as material.
//
// A snapshotter whose endpoints are all stale REFUSES every batch and returns NO
// ERROR. There is no step failure, no advancing cursor, nothing at all — the only
// evidence is an OPEN sweep generation that has stopped landing batches, which is
// the check this test is about. Its collateral_unusable sibling fires on a much
// wider cadence-relative bound, so for the whole width of that gap this is the only
// signal there is, and a rolled-back clock removes it.
func TestAClockRollbackCannotSuppressASweepStall(t *testing.T) {
	const (
		stalledFor = 20 * time.Minute
		rollback   = 10 * time.Minute
	)
	h, db := newTestHealth()
	daemon := pinnedClock(db.t)
	daemon.advance(-rollback)

	pr := &fakeProgress{
		sweepFound: true,
		sweep: store.SweepProgress{
			Generation: 7, Open: true,
			OpenedAt:    db.now().Add(-2 * time.Hour),
			LastBatchAt: db.now().Add(-stalledFor),
			Lagging:     3,
		},
	}
	watch := progressWatch{sweepEngine: "debt_manager", sweepMaxAttempts: 3}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, timeAuthority{verdict: db.verdict, sched: daemon.now}, rc, watch)
	publishRound(h, rc)

	key := snapshotName + "/" + conditionNoProgress
	rep := h.report()
	require.Contains(t, rep.Recoverable, key,
		"an all-endpoints-stale sweep reports no error at all, so an open generation that has stopped landing batches is the only signal there is — and it must not be measurable away by the daemon's own clock")
	require.Contains(t, rep.Recoverable[key], "20m0s")
	require.False(t, rep.Ready)

	h2, _ := newTestHealth()
	rc2 := roundConditions{}
	applyProgressConditions(context.Background(), pr, daemon.authority(), rc2, watch)
	publishRound(h2, rc2)
	require.NotContains(t, h2.report().Recoverable, key,
		"on the rolled-back wall clock the same open generation reads healthy")
}

// TestTheTrustedInstantAdvancesThroughASlowPass is Codex round 11's third finding,
// measured at the boundary in BOTH directions.
//
// One authority is not one instant. The pass reads the trusted clock once and then
// spends real time — durable listings, a header read per gated worker — before it
// publishes anything, and the pass-start reading reused verbatim dates every one of
// those verdicts as though the pass were free. On the nine-worker four-second-read
// harness the previous wave shipped, that is 36 s of under-ageing at a ten-minute
// boundary: a cursor measurably past the bound at publication, reported inside it.
//
// AXES VARIED: A and B. The subtests differ ONLY in how far from the bound the
// cursor starts, which is what makes the second one worth as much as the first — a
// fix that simply widened everything would pass the first and fail the second.
func TestTheTrustedInstantAdvancesThroughASlowPass(t *testing.T) {
	const readLatency = 5 * time.Second
	name, block := "eth:aave-etherfi", uint64(20_000_000)

	// run judges one worker whose header is `headerAge` old AT PASS START, through a
	// pass whose single header read costs readLatency.
	run := func(t *testing.T, headerAge time.Duration) *healthState {
		t.Helper()
		h, clk := newTestHealth()
		headerTime := clk.now().Add(-headerAge)
		fetch := func(_ context.Context, chainID, b uint64) (uint64, error) {
			clk.advance(readLatency) // the read costs what a degraded endpoint costs
			return uint64(headerTime.Unix()), nil
		}
		watch := progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}},
			staleness: newStalenessJudge(fetch, clk.now),
		}
		pr := &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: block, UpdatedAt: clk.now()}}}
		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, clk.authority(), rc, watch)
		publishRound(h, rc)
		return h
	}

	t.Run("a cursor that crosses the bound DURING the pass is red at publication", func(t *testing.T) {
		// One second inside the bound when the pass starts; four seconds outside it
		// when the verdict is made.
		age := maxDerivedStaleness - time.Second
		require.Less(t, age, maxDerivedStaleness, "THE PRECONDITION: green on the pass-start reading")
		require.Greater(t, age+readLatency, maxDerivedStaleness, "and red by the time the read that measured it has returned")

		rep := run(t, age).report()
		key := name + "/" + conditionStaleness
		require.Contains(t, rep.Recoverable, key,
			"the age is taken when the verdict is MADE, not when the pass opened: a header read is allowed ten seconds, and charging that latency to neither clock is how a cursor past the bound at publication gets reported inside it")
		require.Contains(t, rep.Recoverable[key], "10m4s",
			"and the reported age is the real one at publication, not the one it had before the read")
		require.False(t, rep.Ready)
	})

	t.Run("and one that is still inside at publication stays green", func(t *testing.T) {
		// Six seconds inside the bound at pass start, one second inside it at the
		// verdict: the fix must move the boundary by exactly the elapsed time, not by
		// a margin.
		age := maxDerivedStaleness - 6*time.Second
		require.Less(t, age+readLatency, maxDerivedStaleness, "THE PRECONDITION: still inside the bound when the read returns, by one second")

		rep := run(t, age).report()
		require.NotContains(t, rep.Recoverable, name+"/"+conditionStaleness,
			"advancing the trusted instant must track elapsed time exactly: a fix that widened the bound, or that re-read the clock more than once per elapsed second, would redden this demonstrably fresh cursor")
		require.NotContains(t, rep.Recoverable, name+"/"+conditionStalenessUnmeasured)
	})

	t.Run("the clock read's own round trip is counted", func(t *testing.T) {
		// No slow fetch at all this time: the ONLY elapsed time in the pass is the
		// round trip of the trusted read itself, and it is enough to cross the bound.
		const trip = 3 * time.Second
		h, clk := newTestHealth()
		headerTime := clk.now().Add(-(maxDerivedStaleness - time.Second))
		hdr := newFakeHeaderTimes().set(1, block, headerTime)
		watch := progressWatch{
			walkers:   []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}},
			staleness: newStalenessJudge(hdr.fetch, clk.now),
		}
		pr := &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: block, UpdatedAt: clk.now()}}}

		rc := roundConditions{}
		applyProgressConditions(context.Background(), pr, roundTripAuthority(clk, trip), rc, watch)
		publishRound(h, rc)

		key := name + "/" + conditionStaleness
		rep := h.report()
		require.Contains(t, rep.Recoverable, key,
			"the trusted instant is captured on the SERVER, inside a round trip this process cannot see into, so the monotonic anchor is taken BEFORE the read is issued. Anchoring it after would credit the trip to neither clock and make every age in the pass short by it — fail-open, and worse the slower the database")
		require.Contains(t, rep.Recoverable[key], "10m2s",
			"the age includes the trip: 9m59s at capture plus three seconds of it")
	})
}

// TestASlowDurableReadIsChargedToTheCursorsItDates is the same finding on the STALL
// gate, whose timestamps come out of the very read whose latency is at issue.
//
// The ordering here is the point: the trusted clock is read, THEN the cursor listing
// is issued, and only when it returns is a cursor's age computed. A pass that dated
// these rows from the instant it opened would report a cursor that spent the whole
// listing crossing the bound as still inside it — and the slower the database, the
// larger the error, which is exactly backwards for a gate whose subject is a
// database that has stopped responding properly.
func TestASlowDurableReadIsChargedToTheCursorsItDates(t *testing.T) {
	const listingCost = 90 * time.Second
	name := "eth:aave-etherfi"
	h, clk := newTestHealth()

	// Sixty seconds inside the bound when the pass opens; thirty seconds outside it
	// by the time the listing that produced the row has come back.
	stalledFor := noProgressBound - time.Minute
	require.Less(t, stalledFor, noProgressBound, "THE PRECONDITION: green on the pass-start reading")
	require.Greater(t, stalledFor+listingCost, noProgressBound, "and red once the read that produced the row has returned")

	pr := &slowProgressReader{
		clk:   clk,
		cost:  listingCost,
		inner: &fakeProgress{ingest: []store.CursorProgress{{Name: name, Block: 20_000_000, UpdatedAt: clk.now().Add(-stalledFor)}}},
	}
	watch := progressWatch{walkers: []*walkerState{{w: &fakeIngestWorker{name: name}, chainID: 1}}}

	rc := roundConditions{}
	applyProgressConditions(context.Background(), pr, clk.authority(), rc, watch)
	publishRound(h, rc)

	key := name + "/" + conditionNoProgress
	rep := h.report()
	require.Contains(t, rep.Recoverable, key,
		"a cursor's age is taken when it is JUDGED, after the read that produced it: dating it from the pass's opening instant hides exactly as much stall as the database is slow, which is the wrong way round")
	require.Contains(t, rep.Recoverable[key], "15m30s")
	require.False(t, rep.Ready)
}
