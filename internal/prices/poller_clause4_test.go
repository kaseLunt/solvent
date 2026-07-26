package prices

// D-012 CLAUSE 4 ON THE NO-CHECKPOINT ARM (Codex round 8's critical blocker), plus
// clause 6's transition-only accounting for the backlog count (round 8's [high] #5 and
// #6). Both families live here rather than in poller_test.go because both exist to
// pin arms an earlier wave's tests never reached.
//
// THE HOLE THE CLAUSE-4 TESTS CLOSE. verifyFloor returns floorUnverifiable WITHOUT
// probing anything when the engine holds no anchor at or below its cursor — D-012
// clause 5's legacy unanchored rows. No probe means no checkpoint, and wave 8's
// checkpointCorroborated returned unconditional success whenever no checkpoint was
// set. So the one population whose canonicality nothing can EVER establish was the one
// population marked with no endpoint-count enforcement at all: with two endpoints
// configured and no agreement, with zero endpoints configured, and on a fleet of one
// WITHOUT singleView — hence without the disclosure clause 4's ratified trade is paid
// for with.
//
// WHY THE EXISTING MUTATION PAIR MISSED IT, which is the part worth carrying forward.
// Wave 8's M5/M5b removed the count re-check inside the agreementUnobtainable arm and
// confirmed a test died. That proved the CHECKPOINTED arm was guarded and said nothing
// whatever about the other one. A mutation only covers the arms the tests it leans on
// reach, so the three cases below are written as one family — endpoint counts 0, 1 and
// 2 against the SAME no-anchor fixture — rather than as one case plus an assumption.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// noAnchorLegacyFixture is the state all three clause-4 cases share: polled rows above
// the cursor, NO anchor anywhere for this engine, and a reorg epoch whose walker target
// sits below the rows. It is the post-upgrade legacy shape, and the only shape that
// reaches checkpointCorroborated with no checkpoint set.
func noAnchorLegacyFixture(t *testing.T, endpoints int) (*fakePriceStore, *fakePollChain, *Poller) {
	t.Helper()
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: endpoints, respond: okRound(t, 5100, 20, 1_000_000)}
	ch.setHead(5100)
	p, clk := newTestPoller(t, st, ch, 10)

	asset := realFeeds(t).PollAssets(10)[0].Address
	st.seedRow(engine, asset.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(4900)
	st.rewindDeepTo = &deep
	// Every endpoint that exists has a complete, AGREEING view of the chain. That is
	// deliberate: the refusals below must come from the absence of a proof to
	// corroborate, not from a fork or an outage, so nothing about the chain's health
	// can be mistaken for the reason.
	for _, idx := range ch.endpointIndexes() {
		ch.canonicalOn(idx, 4900, 5000, 5100)
	}
	st.unacked = true
	p.lastAttempt = clk.now() // not due: isolate the repair leg
	return st, ch, p
}

// TWO ENDPOINTS CONFIGURED: fail closed. D-012 clause 4 — "marking requires
// cross-endpoint agreement when more than one endpoint is configured. Agreement
// unobtainable with >=2 endpoints configured => fail closed: retain unmarked, repair
// blocked, readiness red — an operator-visible fault, never a marking."
//
// Both endpoints here are healthy and in perfect agreement about the chain. It makes
// no difference, and that is the point: no hash was ever recorded for these rows, so
// there is nothing for a second endpoint to agree WITH. Agreement is not merely
// unavailable, it is unobtainable — and the clause reserves acting on unobtainable
// agreement to a fleet of exactly one.
func TestPollerRefusesToMarkUnanchoredLegacyRowsWithTwoEndpointsConfigured(t *testing.T) {
	st, _, p := noAnchorLegacyFixture(t, 2)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error")
	require.False(t, advanced)

	require.Empty(t, st.neutralized,
		"with 2 endpoints CONFIGURED, marking rows no anchor covers would require an agreement that cannot exist (D-012 clause 4)")
	require.Empty(t, st.rewinds, "and nothing is deleted either (D-010 clause 1)")
	require.Len(t, st.rows, 1)
	require.True(t, st.rows[0].valid,
		"the legacy row is RETAINED AND STILL READABLE — retention, not classification, is what failing closed means here")
	require.True(t, st.unacked, "the epoch stays unanswered: clause 4 prefers a visible fault to a marking")

	// AND IT IS OPERATOR-VISIBLE, which is the other half of the clause's sentence.
	// The stall is real — no price batch is admitted while the epoch stands — and the
	// clause chose it over marking history nothing can vouch for.
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)
	require.Contains(t, pollConditions(p)[ConditionPollRewindBlocked], "no poll anchor covers this history")
	require.False(t, containsSubstring(*msgs, "SINGLE-VIEW CLASSIFICATION"),
		"the ratified one-endpoint concession is not reachable from a fleet of two")
}

// EXACTLY ONE ENDPOINT CONFIGURED: mark, with the disclosure. Clause 4's ratified
// trade — "with exactly one endpoint configured, single-view marking is permitted and
// here ratified... configuration is not a fault."
//
// This is the arm wave 8 got right in outcome and wrong in substance: it marked, but
// with singleView=false, so the operator was never told that rows had been classified
// on one node's word with no hash evidence of any kind. Here that disclosure is the
// loudest thing in the log, because it is the only signal that exists.
func TestPollerMarksUnanchoredLegacyRowsOnAOneEndpointFleetWithTheDisclosure(t *testing.T) {
	st, _, p := noAnchorLegacyFixture(t, 1)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "a fleet of exactly one must not be wedged by an agreement no waiting could obtain")
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(0), st.neutralized[0].verifiedFloor,
		"no anchor was probed, so no height is blessed: the whole suffix above the walker target is marked")
	require.Len(t, st.rows, 1, "RETAINED, not deleted")
	require.False(t, st.rows[0].valid)
	require.False(t, st.unacked, "the store answered the epoch in the same transaction")

	require.True(t, containsSubstring(*msgs, "SINGLE-VIEW CLASSIFICATION"),
		"D-012 clause 4 ratifies the marking; ADD-1 is what requires it never be silent — the trade is acceptable BECAUSE it is auditable")
	require.True(t, containsSubstring(*msgs, "exactly one rpc endpoint configured"),
		"and the disclosure names the CONFIGURED count, which is the fact that authorises it")
	require.True(t, containsSubstring(*msgs, "heightRangeMarked"),
		"ADD-1 requires the WARN to name the affected height range; a disclosure that cannot say WHAT it classified is not a disclosure")
}

// ZERO ENDPOINTS CONFIGURED: fail closed. Clause 4 permits single-view marking "with
// exactly one endpoint configured"; zero is not one, and a fleet that can reach no
// chain at all is a misconfiguration rather than a ratified deployment.
//
// It is pinned separately because the natural way to write the one-endpoint concession
// is `count <= 1`, which sweeps this in — wave 7 did exactly that on the checkpointed
// arm, and the no-checkpoint arm had no count test at all to get wrong.
func TestPollerRefusesToMarkUnanchoredLegacyRowsWithNoEndpointsConfigured(t *testing.T) {
	st, _, p := noAnchorLegacyFixture(t, 0)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)

	require.Empty(t, st.neutralized, "zero configured endpoints is not clause 4's fleet of one")
	require.True(t, st.rows[0].valid, "nothing is marked on a fleet that can consult nothing")
	require.True(t, st.unacked)
	require.Contains(t, pollConditions(p)[ConditionPollRewindBlocked], "configured endpoints")
	require.False(t, containsSubstring(*msgs, "SINGLE-VIEW CLASSIFICATION"))
}

// ---------------------------------------------------------------------------
// D-012 CLAUSE 6: transition-only means transition-only (round 8's [high] #5).
// ---------------------------------------------------------------------------

// The clause bounds the COST of gap visibility: the stats surface "must be cheap — its
// cost may not scale with total price history". Wave 8's doc said the recount happens
// on transitions only, and its code called it from readDurableState — which is not a
// transition but the RE-READ, reached from rehydrateAfterUncertainty after every
// uncertain apply, and again inside neutralize. So an apply error paid for the
// aggregate, and a repair paid for it twice.
//
// This test drives the two non-transitions and asserts the count is untouched. The
// sibling in poller_test.go already pins the cadence case (landed rounds do not
// recount); what was missing was the ERROR paths, which is where the violation lived.
func TestNeutralizedBacklogIsNotRecountedOnUncertainApplyOrTwiceOnRepair(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)
	st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 4000, clk.now())
	st.cursor, st.cursorFound = 4000, true
	canonicalAt(ch, 4000, 5000)

	// HYDRATION is a genuine transition and is the one startup recount.
	require.NoError(t, p.hydrate(context.Background()))
	require.Equal(t, 1, st.neutralizedStatsCalls, "a restart reads the accumulated pile exactly once")

	// AN APPLY ERROR THAT IS A ROLLBACK. Nothing landed, so the backlog cannot have
	// moved, and re-hydrating the freshness caches must not drag the aggregate along.
	st.applyErrs = []error{errors.New("transport blew up mid-round")}
	clk.advance(2 * time.Minute)
	_, err := p.Step(context.Background())
	require.Error(t, err)
	require.Equal(t, 1, st.neutralizedStatsCalls,
		"an apply error re-reads freshness, not the backlog: a rollback changes no marker (D-012 clause 6)")

	// A REPAIR. This IS a transition — neutralization is the only thing that raises the
	// pile — so it recounts, and it recounts ONCE. Wave 8 counted two: rehydration's
	// and the explicit call after it.
	before := st.neutralizedStatsCalls
	st.unacked = true
	deep := uint64(3000)
	st.rewindDeepTo = &deep
	clk.advance(2 * time.Minute)
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, before+1, st.neutralizedStatsCalls,
		"exactly one recount per genuine transition — the marking's own, not the re-read's as well")
}

// ---------------------------------------------------------------------------
// D-012 CLAUSE 6: a failed recount marks the count UNKNOWN (round 8's [high] #6).
// ---------------------------------------------------------------------------
//
// The durable-fact rule underneath clause 6 is that this number is READ FROM STORAGE
// rather than accumulated in memory. Wave 8's error arm returned without clearing
// neutralizedKnown, so the pre-transition value stayed marked as current — and because
// this function is only ever called ON a transition, a failure there is always a
// failure to observe a CHANGE. The stale value was therefore always wrong in a
// specific, directional way: it hid a gap that had just opened, or claimed one that
// had just closed. For a permanent classification (clause 3) the next correcting
// transition may never come.
//
// Both directions are driven, because they fail differently and an operator acts
// differently on each.

// UPWARD: a repair opens a gap and the recount fails. The count must not read as a
// known zero — that is the reading under which an operator concludes nothing happened.
func TestFailedRecountAfterANeutralizationReportsUnknownAndTheNextRoundCorrectsIt(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5100, 20, 1_000_000)}
	ch.setHead(5100)
	p, clk := newTestPoller(t, st, ch, 10)
	st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(4900)
	st.rewindDeepTo = &deep
	canonicalAt(ch, 4900, 5000, 5100)

	require.NoError(t, p.hydrate(context.Background()))
	_, known := p.NeutralizedBacklog()
	require.True(t, known, "hydration succeeded, so zero is a KNOWN zero here")

	// The repair lands and the recount that would observe it fails.
	st.neutralizedStatsErr = errors.New("statement timeout counting the backlog")
	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)
	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a counting failure must not take the repair down with it")
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1, "the marking itself committed")

	stats, known := p.NeutralizedBacklog()
	require.False(t, known,
		"the recount failed on a transition, so the number is UNKNOWN — never the pre-transition value reported as current (D-012 clause 6)")
	require.Zero(t, stats.Rows,
		"and the last value it ever read is what it still carries; `known` is what says not to trust it")
	require.True(t, containsSubstring(*msgs, "UNKNOWN rather than assumed unchanged"))

	// THE NEXT ORDINARY ROUND CORRECTS IT. No new transition is required: the unknown
	// flag is itself what re-arms the read, which is the whole reason it exists.
	st.neutralizedStatsErr = nil
	clk.advance(2 * time.Minute)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	stats, known = p.NeutralizedBacklog()
	require.True(t, known, "the next ordinary round retried and the count is a durable fact again")
	require.Equal(t, int64(1), stats.Rows, "and it is the TRUE post-repair count, not the stale zero")
}

// DOWNWARD: a superseding round drains the gap and the recount fails. The stale value
// here is a non-zero one, and reporting it as current claims a gap that no longer
// exists — an operator chasing rows that were repaired minutes ago.
func TestFailedRecountAfterASupersedeReportsUnknownAndTheNextRoundCorrectsIt(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	// A marked row at the head — the shallow shape where a current poll can still land
	// at the classified height, which is the only thing that lowers the backlog.
	const H = uint64(5000)
	asset := realFeeds(t).PollAssets(10)[0].Address
	st.seedNeutralizedRow(engine, asset.Bytes(), SourcePriceProviderV2, H, clk.now())
	st.cursor, st.cursorFound = H, true
	st.seedAnchor(engine, H, blockHashAt(H))
	canonicalAt(ch, H)

	require.NoError(t, p.hydrate(context.Background()))
	stats, known := p.NeutralizedBacklog()
	require.True(t, known)
	require.Equal(t, int64(1), stats.Rows, "the gap is real and known before the round")

	// The round supersedes it, and the recount that would observe the drain fails.
	st.neutralizedStatsErr = errors.New("connection reset counting the backlog")
	ch.respond = okRound(t, H, 20, 1_000_000)
	ch.setHead(H)
	clk.advance(2 * time.Minute)
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	stats, known = p.NeutralizedBacklog()
	require.False(t, known,
		"a supersede is a transition; failing to observe it leaves the count UNKNOWN, not the old non-zero value reported as current")
	require.Equal(t, int64(1), stats.Rows, "the carried value is still the last one read — `known` is the honest part")

	st.neutralizedStatsErr = nil
	clk.advance(2 * time.Minute)
	_, err = p.Step(context.Background())
	require.NoError(t, err)
	stats, known = p.NeutralizedBacklog()
	require.True(t, known, "the next ordinary round retried")
	require.Zero(t, stats.Rows, "and the gap really had closed: the stale 1 would have been a phantom")
}
