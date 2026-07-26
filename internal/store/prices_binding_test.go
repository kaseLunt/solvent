package store

// Live-database tests for Task 8 wave 10 (Codex round 8's findings 2, 3, 4 and 5):
// per-observation provenance binding, the structural split between the two repair
// primitives, the incremental prune, and the backlog aggregate's covering index.
//
// Everything here runs against real PostgreSQL. Three of the four findings are about
// what a QUERY PLAN or a SQL predicate does, and none of those is observable through a
// fake.

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// anchorBindingAt reads a row's recorded provenance binding: the block of the anchor
// written in the same transaction as the observation, or nil for "no anchor is known
// to vouch for this row".
func anchorBindingAt(t *testing.T, s *Store, chainID uint64, asset byte, source string, block uint64) *int64 {
	t.Helper()
	var bound *int64
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT anchor_block FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, addr20(asset), source, block).Scan(&bound))
	return bound
}

// anchorBlocks reads every surviving anchor height for an engine, ascending.
func anchorBlocks(t *testing.T, s *Store, engine string) []uint64 {
	t.Helper()
	rows, err := s.pool.Query(context.Background(),
		`SELECT block_number FROM price_poll_anchors WHERE engine = $1 ORDER BY block_number`, engine)
	require.NoError(t, err)
	defer rows.Close()
	var out []uint64
	for rows.Next() {
		var b uint64
		require.NoError(t, rows.Scan(&b))
		out = append(out, b)
	}
	require.NoError(t, rows.Err())
	return out
}

// ---------------------------------------------------------------------------
// FINDING 2: provenance is bound to the OBSERVATION, not inferred from the height.
// ---------------------------------------------------------------------------

// D-012 CLAUSE 2 — "provenance is retained forever... no retention bound, prune, or
// rewind may expire an anchor belonging to a neutralized height, on any store path" —
// exists so an OFFLINE reconciliation has a TRUE input. Codex round 8 found that the
// input could be FABRICATED instead of expired, which is worse: an expired anchor is
// visibly absent, a fabricated one is indistinguishable on disk from a real one.
//
// THE MECHANISM. applyPrices writes one height-wide anchor per round, and every read
// that asked "does this row have provenance?" asked it of the HEIGHT. So an unanchored
// legacy row at H, marked by a repair, became "anchored" the moment ANY later round
// executed at H — a round that never observed the marked row and whose hash says
// nothing about it. The controller's round-7 adjudication said this dissolved with the
// online consumer; it did not. Removing the reader removed the exploitation path and
// left the write-side corruption exactly where it was.
//
// THE PARTIAL-REVERT SHAPE, which is the reachable one: a reorg reverts to a height
// the poller still has rows at, so a later round lands at H again pricing SOME of the
// assets that were there before — the others reverted, or the oracle skipped them.
func TestALaterPartialRoundAtANeutralizedHeightDoesNotVouchForTheOldRows(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// LEGACY, UNANCHORED history at H: two assets, written before this engine
	// anchored its rounds. ApplyPrices (not ApplyPolledPrices) is how such a row got
	// there, and it records no anchor.
	const H = uint64(5000)
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(H, 0xAA, testPollSource, 1_000_000, 6),
		po(H, 0xBB, testPollSource, 2_000_000, 6),
	}, H)))
	require.Nil(t, anchorBindingAt(t, s, 10, 0xAA, testPollSource, H),
		"a round that recorded no anchor leaves the binding NULL — nothing vouches for these rows")

	// A reorg, and the repair marks both.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, H, 0)
	require.NoError(t, err)
	require.Equal(t, int64(2), marked)

	// THE PARTIAL REVERT: the chain comes back to H and a new round lands there, but
	// prices only ONE of the two assets. The round legitimately anchors at H.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(H, 0xAA, testPollSource, 1_500_000, 6),
	}, H, anchorAt(H))))

	// The row the new round DID observe is superseded, readable, and genuinely
	// vouched for — by the anchor its own round wrote.
	valid, _ := invalidReasonAt(t, s, 10, 0xAA, testPollSource, H)
	require.True(t, valid, "the superseding observation is a new durable fact and is usable")
	bound := anchorBindingAt(t, s, 10, 0xAA, testPollSource, H)
	require.NotNil(t, bound)
	require.EqualValues(t, H, *bound, "and it is bound to the anchor its own round recorded")

	// THE ROW THE NEW ROUND NEVER SAW IS THE FINDING. It is still marked, and it must
	// remain UN-VOUCHED: no hash was ever recorded for the round that produced it, and
	// an anchor written minutes later by a different round is not retroactive evidence
	// about it.
	valid, reason := invalidReasonAt(t, s, 10, 0xBB, testPollSource, H)
	require.False(t, valid)
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)
	require.Nil(t, anchorBindingAt(t, s, 10, 0xBB, testPollSource, H),
		"an anchor at this HEIGHT is not provenance for a row that round never observed (D-012 clause 2)")

	// AND THE ANCHOR ITSELF SURVIVES, because it IS real provenance — for the other
	// row. Clause 2 is about not losing true inputs, not about deleting the height.
	require.Contains(t, anchorBlocks(t, s, testPollEngine), H)
}

// THE ALL-REVERT SHAPE: a later round at H prices EVERY asset that was there. Every
// old row is superseded, so nothing is left marked — but the binding still has to be
// written by the round that witnessed it, and a row that somehow is not superseded
// must not inherit the anchor.
//
// Driven separately because the partial case leaves an obviously-orphaned row and this
// one does not: if the binding were height-derived, this test would pass either way,
// which is exactly why the assertion here is about the SOURCE of the binding rather
// than about the outcome.
func TestAnAllRevertRoundBindsOnlyTheRowsItActuallyObserved(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	const H = uint64(5000)
	// One legacy unanchored row at H, and one at a LOWER height the new round will
	// not reach at all — the row that proves the binding is per-observation and not
	// per-engine or per-round-range.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(4900, 0xCC, testPollSource, 900_000, 6),
		po(H, 0xAA, testPollSource, 1_000_000, 6),
	}, H)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, H, 0)
	require.NoError(t, err)
	require.Equal(t, int64(2), marked)

	// The all-revert round: every asset the round prices at H is superseded.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(H, 0xAA, testPollSource, 1_500_000, 6),
	}, H, anchorAt(H))))

	valid, _ := invalidReasonAt(t, s, 10, 0xAA, testPollSource, H)
	require.True(t, valid)
	require.NotNil(t, anchorBindingAt(t, s, 10, 0xAA, testPollSource, H))

	// The row at 4900 is untouched by the round and stays marked AND un-vouched. The
	// cursor is at H, so no poll can ever land at 4900 again (D-012 clause 3's
	// permanence is the cursor guard) — this row is durably unprovable, forever, and
	// the store says so rather than implying otherwise.
	valid, reason := invalidReasonAt(t, s, 10, 0xCC, testPollSource, 4900)
	require.False(t, valid)
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)
	require.Nil(t, anchorBindingAt(t, s, 10, 0xCC, testPollSource, 4900),
		"nothing a later round does at a HIGHER height can vouch for this row")
}

// THE OPERATOR-FACING CONSEQUENCE (D-012 clause 7): neutralization reports how many
// marked rows have provenance and how many never can, and those two numbers are the
// ones an operator's next step differs on. The split now asks each ROW's binding, so
// "the hash of the block that round executed against is on disk" is a true statement
// about every row counted on the anchored side.
func TestNeutralizationSplitsAnchoredFromUnanchoredByTheRowsOwnBinding(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// One row from a properly ANCHORED round, and one legacy row at a different
	// height with no anchor of its own.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000, anchorAt(5000))))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5010, 0xBB, testPollSource, 2_000_000, 6),
	}, 5010)))
	// And an anchor at the LEGACY row's height, written by a round that did not
	// observe it. Under the height-derived split this alone flipped the row to
	// "anchored"; under the binding it changes nothing.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, 5010, anchorAt(5010))))

	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))

	rec := captureWarnAttrs(t)
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5010, 0)
	require.NoError(t, err)
	require.Equal(t, int64(2), marked)

	require.EqualValues(t, 5000, *anchorBindingAt(t, s, 10, 0xAA, testPollSource, 5000),
		"the anchored round's row carries its own round's anchor")
	require.Nil(t, anchorBindingAt(t, s, 10, 0xBB, testPollSource, 5010),
		"the legacy row stays unprovable even though an anchor now sits at its height")

	// THE REPORTED SPLIT IS THE ASSERTION THAT BINDS THE FIX, and the column values
	// above are only the mechanism. This fixture is the one arrangement where the two
	// possible rules DISAGREE: both marked rows sit at heights carrying an anchor, so
	// the height-derived split reports 2 anchored / 0 unanchored, while the row's own
	// binding reports 1 / 1. The WARN's gloss on rowsAnchored — "the hash of the block
	// that round executed against is on disk" — is only true under the second.
	got := rec.find("rowsNeutralized")
	require.NotNil(t, got, "the classification is reported to the operator at all")
	require.Equal(t, int64(1), got["rowsAnchored"],
		"only the row whose OWN round wrote an anchor has provenance an offline check could use")
	require.Equal(t, int64(1), got["rowsUnanchored"],
		"the legacy row is reported as unprovable even though a later round anchored its height (D-012 clause 2)")
}

// A REPLAYED ANCHOR IS STILL A WITNESSED ONE. A frozen endpoint re-reports the same
// execution block, so the anchor insert conflicts and reports inserted=false — but the
// anchor for THAT block was written by a real round, insertPollAnchor's divergence
// abort proves the hash still matches, and the observations of this round did execute
// against it. Withholding the binding here would manufacture an unprovable row out of
// a perfectly provable round.
func TestAReplayedAnchorStillBindsThisRoundsObservations(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000, anchorAt(5000))))
	// Same execution block, a DIFFERENT asset: the anchor replays, the row is new.
	res, err := s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xBB, testPollSource, 2_000_000, 6),
	}, 5000, anchorAt(5000))
	require.NoError(t, err)
	require.False(t, res.AnchorInserted, "the execution block was already anchored")
	require.Len(t, res.Inserted, 1)

	require.EqualValues(t, 5000, *anchorBindingAt(t, s, 10, 0xBB, testPollSource, 5000),
		"a replayed anchor is provenance the round genuinely executed against")
}

// THE EVENT-DERIVED WRITER HAS NO ANCHORS AT ALL, so its rows are permanently NULL —
// and that is not a defect being tolerated, it is the column's meaning. The Chainlink
// feed deriver's rows are replayable from raw_logs, so provenance-for-offline-recovery
// is not a question that arises for them.
func TestEventDerivedRowsCarryNoBindingBecauseTheyRecordNoAnchor(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(400, 0xAA, testFeedSource, 300, 8),
	}, 400)))
	require.Nil(t, anchorBindingAt(t, s, 10, 0xAA, testFeedSource, 400),
		"ApplyPrices records no anchor, so it can bind no provenance")
}

// ---------------------------------------------------------------------------
// FINDING 3: D-012 clause 2 holds on EVERY store path, structurally.
// ---------------------------------------------------------------------------

// THE ROOT ROUND 8 NAMED: clause 2 was implemented as poll-prefix-scoped, but
// NeutralizeUnverifiablePrices accepted ANY non-empty engine. A caller could therefore
// mark under an event-derived identity and then rewind that same identity — legal for
// non-poll engines — whose anchor sweep had no neutralized-height exemption. Two
// individually legal calls, one violated clause 2.
//
// The structural fix is the mirror of RewindPrices' own refusal: each repair primitive
// serves exactly one family of writers.
func TestNeutralizeRefusesANonPollEngineAndChangesNothing(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(5000, 0xAA, testFeedSource, 300, 8),
	}, 5000)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))

	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testFeedEngine10, 10, 5000, 0)
	require.ErrorIs(t, err, ErrNonPollNeutralizeRefused,
		"neutralization is the POLLED writer's answer to an epoch; an event-derived row is replayable from raw_logs (D-012 clause 2)")
	require.Zero(t, marked)

	// NOTHING CHANGED — not the row, not the epoch. The refusal is on the identity and
	// fires before any read of the target, so there is no partial effect to reason about.
	valid, reason := invalidReasonAt(t, s, 10, 0xAA, testFeedSource, 5000)
	require.True(t, valid, "the row is untouched")
	require.Empty(t, reason)
	unacked, err := s.HasUnackedReorg(ctx, testFeedEngine10, 10)
	require.NoError(t, err)
	require.True(t, unacked, "and the epoch is NOT acked by a refused call")

	// The engine's real primitive still works, which is what makes the refusal a
	// routing rule rather than a dead end.
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 5000, 0))
}

// THE TWO REFUSALS ARE EXHAUSTIVE AND DISJOINT: every engine identity has exactly one
// repair primitive, and no identity has both or neither. That is what makes clause 2
// structural rather than a convention two call sites happen to honour.
func TestEveryEngineIdentityHasExactlyOneRepairPrimitive(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.ErrorIs(t, s.RewindPrices(ctx, testPollEngine, 10, 100, 0), ErrPollOwnedRewindRefused)
	_, _, err := s.NeutralizeUnverifiablePrices(ctx, testFeedEngine10, 10, 100, 0)
	require.ErrorIs(t, err, ErrNonPollNeutralizeRefused)

	// And each identity's OWN primitive is reachable, so neither is stranded.
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 100, 0))
	_, _, err = s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 100, 0)
	require.NoError(t, err)
}

// DEFENCE IN DEPTH, AND THIS TEST SAYS SO EXPLICITLY. With the refusal above in place,
// no engine that reaches RewindPrices' anchor sweep can hold a neutralized row — so
// this state is UNREACHABLE THROUGH THE PUBLIC API and is constructed here with direct
// SQL. That is the honest way to test a defence: not by pretending the state is
// ordinary, but by saying which door was walked around and why the defence still earns
// its place.
//
// It earns it because round 8's own finding was that the invariant rested on a guard
// three hundred lines away, and the deleted defence-in-depth test is what would have
// caught the second door standing open. D-012 clause 2 says "on any store path"; this
// is the predicate that makes the sweep itself comply, independent of who may call it.
func TestRewindAnchorSweepSparesNeutralizedHeightsEvenThoughNoCallerCanReachThatState(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// An event-derived engine with rows and anchors above a target.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(5000, 0xAA, testFeedSource, 300, 8),
	}, 5000, anchorAt(5000))))
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(5100, 0xBB, testFeedSource, 400, 8),
	}, 5100, anchorAt(5100))))

	// THE DOOR WALKED AROUND: mark the row at 5000 directly. NeutralizeUnverifiablePrices
	// refuses this identity (TestNeutralizeRefusesANonPollEngineAndChangesNothing), so
	// no API sequence produces this state. It is written here to drive the predicate.
	_, err := s.pool.Exec(ctx,
		`UPDATE prices SET valid = FALSE, invalid_reason = $1
		 WHERE chain_id = 10 AND owner_engine = $2 AND block_number = 5000`,
		InvalidReasonUnverifiableReorg, testFeedEngine10)
	require.NoError(t, err)

	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 4000, 0))

	// The marked row is retained (that predicate was already there) AND so is the
	// anchor that records what its round executed against.
	require.Equal(t, []uint64{5000}, anchorBlocks(t, s, testFeedEngine10),
		"the neutralized height's anchor SURVIVES the rewind (D-012 clause 2: no store path may expire it); the unmarked height's does not")
	valid, reason := invalidReasonAt(t, s, 10, 0xAA, testFeedSource, 5000)
	require.False(t, valid)
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)
}

// ---------------------------------------------------------------------------
// FINDING 4: pruning is INCREMENTAL — protected anchors are considered once.
// ---------------------------------------------------------------------------

// D-012 clause 6 requires permanent state to be cheap to CARRY. Wave 8's prune
// evaluated the neutralized-height exemption over every anchor below the retention
// window, on every anchored round — and protected anchors survive forever, so the
// per-round cost grew with the all-time number of classified heights.
//
// The frontier records "everything strictly below here has been considered", so a
// steady-state round looks at the heights that have NEWLY fallen out of retention and
// at nothing else. This test proves the protected anchors are still protected AND that
// the work no longer scales with how many there are.
func TestPruneDoesNotReconsiderPermanentlyProtectedAnchors(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// A run of classified heights, each with a marked row holding its anchor exempt.
	const protectedHeights = 300
	for i := 1; i <= protectedHeights; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
			po(uint64(i), 0xAA, testPollSource, 1_000_000, 6),
		}, uint64(i), anchorAt(uint64(i)))))
	}
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 0, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, protectedHeights, 0)
	require.NoError(t, err)
	require.EqualValues(t, protectedHeights, marked)

	// Then a long healthy run that pushes every classified height far past retention.
	// EVERY round writes a row, which is what a poller actually does — and it matters
	// for the measurement below, not just for realism: with a near-empty `prices` table
	// a sequential scan is genuinely the cheapest plan for any lookup into it, so a
	// toy-sized fixture would measure the planner's correct preference at toy scale
	// rather than the property this finding is about.
	total := uint64(pollAnchorRetention + protectedHeights + 50)
	for i := uint64(protectedHeights + 1); i <= total; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
			po(i, 0xAA, testPollSource, 1_000_000, 6),
		}, i, anchorAt(i))))
	}

	// CORRECTNESS FIRST: every classified height kept its anchor, and the ordinary
	// bound still holds for everything else.
	var kept, protectedKept int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE block_number <= $2)
		   FROM price_poll_anchors WHERE engine = $1`,
		testPollEngine, protectedHeights).Scan(&kept, &protectedKept))
	require.Equal(t, protectedHeights, protectedKept,
		"every anchor at a classified height survives retention (D-012 clause 2)")
	require.Equal(t, pollAnchorRetention+protectedHeights, kept,
		"and the retention bound still applies to every unclassified height")

	// THEN THE COST. A steady-state round's prune must not touch the protected pile.
	// EXPLAIN ANALYZE on the DELETE the next round would run: the window is
	// [frontier, cutoff), so the scan is bounded by the heights newly out of
	// retention, NOT by the 300 permanently-protected anchors below the frontier.
	var frontier, cutoff int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT frontier FROM price_poll_anchor_prune WHERE engine = $1`, testPollEngine).Scan(&frontier))
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT MIN(block_number) FROM (
			SELECT block_number FROM price_poll_anchors WHERE engine = $1
			ORDER BY block_number DESC LIMIT $2) keep`,
		testPollEngine, pollAnchorRetention).Scan(&cutoff))
	require.Greater(t, frontier, int64(protectedHeights),
		"the frontier has advanced past every protected height, so they are settled")

	// ANALYZE before measuring. A plan is a function of the statistics as well as of
	// the query, and stale statistics make the planner mis-estimate the anti-join's
	// inner side and fall back to hashing every marked row — which is a true statement
	// about a neglected database, not about this query's shape, and would make the
	// assertion below flap with suite ordering. The claim this test makes is therefore
	// precise: WITH CURRENT STATISTICS, the prune's work does not scale with the
	// protected pile. Keeping statistics current is autovacuum's job and is a
	// precondition here rather than something this wave establishes.
	_, aerr := s.pool.Exec(ctx, "ANALYZE prices")
	require.NoError(t, aerr)
	_, aerr = s.pool.Exec(ctx, "ANALYZE price_poll_anchors")
	require.NoError(t, aerr)

	// EXPLAIN THE PRODUCTION STATEMENT ITSELF (prunePollAnchorsQuery), not a copy of
	// it typed into the test. A copy is the classic way a plan test rots: the two drift
	// apart and the test goes on certifying a shape the code no longer has.
	plan := explainPrune(t, s, prunePollAnchorsQuery, testPollEngine, frontier, cutoff+1)
	t.Logf("F4 incremental prune, %d permanently-protected anchors below the frontier:\n%s", protectedHeights, plan)
	require.NotContains(t, plan, "Seq Scan on price_poll_anchors",
		"a sequential scan here is the finding: it reconsiders every protected anchor, every round")
	require.Contains(t, plan, "Index Cond: ((engine = ",
		"the prune window is reached by an index RANGE on (engine, block_number), not by scanning every anchor")

	// THE ASSERTION THAT ACTUALLY BINDS THE FINDING. The outer scan being narrow is
	// not enough: written with an `OR`, the exemption test becomes a hash anti-join
	// whose inner side materialises every marked row, and the per-round cost scales
	// with the classified-height count all the same — on the other side of the join.
	// So the measure is total rows TOUCHED by any node, which must not grow with the
	// 300 protected heights sitting below the frontier.
	require.Less(t, planRowsRemoved(t, plan), int64(protectedHeights),
		"no plan node may touch the permanently-protected pile: that is the reconsideration D-012 clause 6 forbids")

	// AND THE FRONTIER IS ACTUALLY CONSULTED AT RUNTIME, which the plan above cannot
	// show: it is EXPLAINed with the frontier read from the table, so code that ignored
	// the stored value would produce an identical plan here and a different query in
	// production. The behavioural signature is what settles it — an anchor sitting
	// BELOW the frontier is not reconsidered, so it survives even though it is far
	// outside retention and nothing protects it.
	//
	// THAT SURVIVAL IS THE OPTIMISATION'S COST, AND IT IS BENIGN AND BOUNDED. Retention
	// is the safe direction under clause 2 (an anchor kept too long forecloses nothing;
	// one expired early forecloses an offline check forever), and the state is not
	// reachable in the running system: a poll round's anchor is at or above the cursor,
	// and adoption — the only path that writes a legacy height — lowers the frontier
	// itself, which TestAdoptingALegacyAnchorLowersThePruneFrontierToIt drives. It is
	// written here with direct SQL precisely because no caller can produce it.
	// A height inside the SETTLED range that carries no anchor: above the protected
	// run (1..protectedHeights, whose anchors survive) and below the frontier, so its
	// own anchor was pruned by an earlier round and the slot is free.
	belowFrontier := uint64(protectedHeights + 5)
	require.Less(t, int64(belowFrontier), frontier, "the fixture must place this inside the settled range")
	require.NotContains(t, anchorBlocks(t, s, testPollEngine), belowFrontier,
		"and the slot must be free, or this asserts nothing about pruning")
	_, err = s.pool.Exec(ctx,
		`INSERT INTO price_poll_anchors (engine, chain_id, block_number, block_hash) VALUES ($1, 10, $2, $3)`,
		testPollEngine, belowFrontier, hash32(0x77))
	require.NoError(t, err)

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(total+1, 0xAA, testPollSource, 1_000_000, 6),
	}, total+1, anchorAt(total+1))))

	require.Contains(t, anchorBlocks(t, s, testPollEngine), belowFrontier,
		"an anchor below the frontier is NOT reconsidered — which is what makes the per-round cost independent of the protected pile")
}

// THE FRONTIER IS A CHECKED CLAIM, NOT A TRUSTED ONE. Its premise — "everything below
// here is settled" — is re-verified every round out of two numbers already in hand: a
// frontier above the current retention cutoff cannot describe the population it claims
// to. Nothing in the running system is known to produce that, which is precisely why
// the code must not assume it away: an optimisation that can silently stop deleting is
// worse than no optimisation.
func TestAFrontierAboveTheRetentionCutoffIsDiscardedRatherThanTrusted(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// A frontier far above anything this engine will ever anchor — the shape a reset
	// anchor population leaves behind. (Upserted rather than inserted: the suite's
	// fixture truncation does not clear this table, which is itself a small live
	// demonstration of why the claim has to be re-checked rather than trusted.)
	_, err := s.pool.Exec(ctx,
		`INSERT INTO price_poll_anchor_prune (engine, frontier) VALUES ($1, $2)
		 ON CONFLICT (engine) DO UPDATE SET frontier = EXCLUDED.frontier`,
		testPollEngine, 9_000_000)
	require.NoError(t, err)

	total := uint64(pollAnchorRetention + 25)
	for i := uint64(1); i <= total; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, i, anchorAt(i))))
	}

	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM price_poll_anchors WHERE engine = $1`, testPollEngine).Scan(&n))
	require.Equal(t, pollAnchorRetention, n,
		"retention still caps growth: a stale frontier costs one full pass, never a silent deletion leak")
}

// ADOPTION IS THE ONE PATH THAT PLACES AN ANCHOR BELOW THE FRONTIER, so it lowers the
// frontier itself rather than leaning on the backstop above. A poll round's anchor is
// always at or above the cursor and therefore far above the frontier; an adopted
// anchor is by definition at a LEGACY height and may be anywhere.
//
// Without this, an adopted anchor would sit in the "already considered" range it was
// never considered in, and retention could never reach it.
func TestAdoptingALegacyAnchorLowersThePruneFrontierToIt(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Legacy rows at 100 with no anchor, then ordinary anchored rounds that carry the
	// frontier up past them.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6),
	}, 100)))
	// Enough anchored rounds ABOVE the legacy height that retention actually bites —
	// the frontier only advances once anchors start falling out of the window.
	total := uint64(100 + pollAnchorRetention + 25)
	for i := uint64(101); i <= total; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, i, anchorAt(i))))
	}
	var frontier int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT frontier FROM price_poll_anchor_prune WHERE engine = $1`, testPollEngine).Scan(&frontier))
	require.Greater(t, frontier, int64(100), "the frontier has moved well past the legacy height")

	adopted, err := s.AdoptPollAnchor(ctx, testPollEngine, 10, anchorAt(100))
	require.NoError(t, err)
	require.True(t, adopted)

	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT frontier FROM price_poll_anchor_prune WHERE engine = $1`, testPollEngine).Scan(&frontier))
	require.LessOrEqual(t, frontier, int64(100),
		"the frontier is lowered to the adopted height: it now claims only what has truly been considered")

	// And the adopted anchor is duly pruned by the next round, because it is a legacy
	// height far outside retention with no marked row holding it.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, total+1, anchorAt(total+1))))
	require.NotContains(t, anchorBlocks(t, s, testPollEngine), uint64(100),
		"retention reaches it, which it could not have done from inside the settled range")
}

// ---------------------------------------------------------------------------
// FINDING 5: the backlog aggregate costs the BACKLOG, not the history.
// ---------------------------------------------------------------------------

// D-012 clause 6: "the stats surface must be cheap — its cost may not scale with total
// price history... incremental accounting or a partial index, with measured evidence."
// This is the measured evidence, and it is measured against the REAL query text rather
// than a hand-written approximation of it — which matters more than usual here,
// because a partial index is only usable when PostgreSQL can PROVE the query predicate
// implies the index predicate, and a bound parameter defeats that proof under a generic
// plan. The query therefore inlines the marker, and this test is what would notice if
// that ever stopped being true.
func TestNeutralizedBacklogAggregateUsesItsCoveringIndex(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// History that is mostly USABLE, with a small marked backlog inside it — the
	// production shape, and the one where a full scan is expensive and an index scan
	// is not.
	const history = 2000
	const backlog = 40
	for i := 1; i <= history; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
			po(uint64(i), 0xAA, testPollSource, 1_000_000, 6),
		}, uint64(i), anchorAt(uint64(i)))))
	}
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, history-backlog, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, history, 0)
	require.NoError(t, err)
	require.EqualValues(t, backlog, marked)

	_, err = s.pool.Exec(ctx, "ANALYZE prices")
	require.NoError(t, err)

	// EXPLAIN the ACTUAL query, with the actual parameters bound.
	plan := explainParams(t, s, neutralizedBacklogQuery, uint64(10), testPollEngine)
	t.Logf("F5 backlog aggregate over %d rows of history with a backlog of %d:\n%s", history, backlog, plan)

	require.Contains(t, plan, "prices_neutralized_backlog_idx",
		"the aggregate must use migration 00007's partial covering index — without it this scans all of history (D-012 clause 6)")
	require.NotContains(t, plan, "Seq Scan on prices",
		"a sequential scan over prices IS the finding")
	require.LessOrEqual(t, planRowsRemoved(t, plan), int64(backlog),
		"the plan touches the backlog, not the history: rows examined must not scale with total price history")

	// And it is still CORRECT, which the plan says nothing about.
	stats, err := s.NeutralizedPriceStats(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.EqualValues(t, backlog, stats.Rows)
	require.EqualValues(t, history, stats.HighestBlock)
	require.False(t, stats.Oldest.IsZero())
	require.False(t, stats.Newest.Before(stats.Oldest))
}

// ---------------------------------------------------------------------------
// EXPLAIN helpers.
// ---------------------------------------------------------------------------

// explainPrune runs EXPLAIN (ANALYZE, BUFFERS) on the prune's real DELETE inside a
// rolled-back transaction, so the statement under measurement changes nothing.
//
// It goes through PREPARE/EXECUTE over the SIMPLE protocol for the same reason
// explainParams does: the statement text carries $1..$4 of its own, which the extended
// protocol would try to bind as the outer EXPLAIN's parameters. force_generic_plan
// keeps the measurement honest about what a long-running process gets.
func explainPrune(t *testing.T, s *Store, stmt, engine string, frontier, cutoff int64) string {
	t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, "SET LOCAL plan_cache_mode = force_generic_plan", pgx.QueryExecModeSimpleProtocol)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, fmt.Sprintf("PREPARE prune_plan (TEXT, BIGINT, BIGINT, TEXT) AS %s", stmt),
		pgx.QueryExecModeSimpleProtocol)
	require.NoError(t, err)

	rows, err := tx.Query(ctx, fmt.Sprintf("EXPLAIN (ANALYZE, BUFFERS) EXECUTE prune_plan('%s', %d, %d, '%s')",
		engine, frontier, cutoff, InvalidReasonUnverifiableReorg), pgx.QueryExecModeSimpleProtocol)
	require.NoError(t, err)
	defer rows.Close()
	var b strings.Builder
	for rows.Next() {
		var line string
		require.NoError(t, rows.Scan(&line))
		b.WriteString(line)
		b.WriteString("\n")
	}
	require.NoError(t, rows.Err())
	return b.String()
}

// explainParams runs EXPLAIN (ANALYZE) on a PARAMETERISED statement. It goes through a
// server-side PREPARE/EXPLAIN EXECUTE so the plan measured is the one the application's
// own bound query gets, not one PostgreSQL built from inlined constants — the exact
// distinction that decides whether a partial index is usable.
func explainParams(t *testing.T, s *Store, stmt string, chainID uint64, engine string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// force_generic_plan is the whole point. A CUSTOM plan sees the parameter VALUES
	// at planning time, which can rescue a partial index whose predicate the generic
	// plan cannot prove — so measuring a custom plan would hide exactly the regression
	// this test exists to catch. A long-running poller gets the generic plan.
	//
	// Everything below goes through the SIMPLE protocol: the statements CONTAIN $1/$2
	// as part of a PREPARE/EXECUTE body, and the extended protocol would try to bind
	// them as the outer statement's own parameters.
	_, err = tx.Exec(ctx, "SET LOCAL plan_cache_mode = force_generic_plan", pgx.QueryExecModeSimpleProtocol)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, fmt.Sprintf("PREPARE backlog_plan (BIGINT, TEXT) AS %s", stmt), pgx.QueryExecModeSimpleProtocol)
	require.NoError(t, err)

	rows, err := tx.Query(ctx,
		fmt.Sprintf("EXPLAIN (ANALYZE) EXECUTE backlog_plan(%d, '%s')", chainID, engine),
		pgx.QueryExecModeSimpleProtocol)
	require.NoError(t, err)
	defer rows.Close()
	var b strings.Builder
	for rows.Next() {
		var line string
		require.NoError(t, rows.Scan(&line))
		b.WriteString(line)
		b.WriteString("\n")
	}
	require.NoError(t, rows.Err())
	return b.String()
}

// planRowsRemoved is the largest actual row count any node in the plan reported —
// the measure of how much data the query TOUCHED, which is the quantity D-012 clause 6
// bounds. Parsing "rows=N" out of the actual-time sections is crude and deliberately
// conservative: it over-counts rather than under-counts, so an assertion built on it
// cannot pass by reading too little.
func planRowsRemoved(t *testing.T, plan string) int64 {
	t.Helper()
	var worst int64
	for _, line := range strings.Split(plan, "\n") {
		idx := strings.Index(line, "actual time")
		if idx < 0 {
			continue
		}
		seg := line[idx:]
		r := strings.Index(seg, "rows=")
		if r < 0 {
			continue
		}
		seg = seg[r+len("rows="):]
		end := strings.IndexAny(seg, " )")
		if end < 0 {
			end = len(seg)
		}
		var n int64
		if _, err := fmt.Sscanf(seg[:end], "%d", &n); err == nil && n > worst {
			worst = n
		}
	}
	return worst
}

// ---------------------------------------------------------------------------
// The 00007 upgrade path, from the pushed baseline.
// ---------------------------------------------------------------------------

// A database at version 5 carries `prices` rows with no provenance binding, no prune
// frontier and no backlog index. The upgrade must be purely ADDITIVE — no row
// rewritten, no constraint tightened over stored data, nothing that can fail on
// whatever is already there — and it must leave every pre-existing row NULL.
//
// THE NULL IS THE ASSERTION, not an omission. A backfill of "anchor_block =
// block_number where an anchor exists at that height" is available, obvious, and is
// exactly the fabricated binding this column exists to prevent: it would write, for
// every legacy row, the inference D-012 clause 2 forbids — permanently and
// invisibly. So the upgrade records ignorance, and every consumer reads NULL as
// unprovable.
func TestMigrateAddsProvenanceBindingWithoutClaimingProvenanceForOldRows(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	ctx := context.Background()
	const schema = "solvent_migtest_v5_binding"

	admin, err := Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(admin.Close)
	_, err = admin.pool.Exec(ctx, "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	require.NoError(t, err)
	_, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = admin.pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	})
	scratch := scratchSchemaDSN(t, dsn, schema)

	// The pushed baseline, and proof it IS that baseline.
	require.NoError(t, migrateUpTo(ctx, scratch, 5))
	s, err := Open(ctx, scratch)
	require.NoError(t, err)
	t.Cleanup(s.Close)

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'prices' AND column_name = 'anchor_block'`, schema).Scan(&n))
	require.Zero(t, n, "the v5 baseline must NOT carry anchor_block")

	// Legacy rows of both kinds: one at a height that HAS an anchor, one that does
	// not. The first is the interesting one — it is precisely the row a backfill
	// would have claimed provenance for.
	_, err = s.pool.Exec(ctx, `INSERT INTO prices
		(chain_id, asset, source, price, price_decimals, block_number, owner_engine, valid, invalid_reason)
		VALUES (10, $1, $2, 1000000, 6, 5000, $3, TRUE, ''),
		       (10, $4, $2, 2000000, 6, 5010, $3, TRUE, '')`,
		addr20(0xAA), testPollSource, testPollEngine, addr20(0xBB))
	require.NoError(t, err)
	_, err = s.pool.Exec(ctx, `INSERT INTO price_poll_anchors (engine, chain_id, block_number, block_hash)
		VALUES ($1, 10, 5000, $2)`, testPollEngine, hash32(0x11))
	require.NoError(t, err)

	require.NoError(t, Migrate(ctx, scratch))
	var version int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version`).Scan(&version))
	require.EqualValues(t, currentSchemaVersion, version, "00007 must land on top of the v5 baseline")

	// (a) NO DATA LOSS: both rows survive with their values.
	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + testPollSource + "@5000": "1000000:6",
		"00000000000000000000000000000000000000bb/" + testPollSource + "@5010": "2000000:6",
	}, priceRows(t, s, 10))

	// (b) BOTH BINDINGS ARE NULL — including the row whose height carries an anchor.
	// Whether that anchor was written by the round that produced this row was never
	// recorded, so the honest value is "unknown", and unknown fails toward unprovable.
	require.Nil(t, anchorBindingAt(t, s, 10, 0xAA, testPollSource, 5000),
		"a pre-00007 row at an ANCHORED height is still unprovable: the binding was never recorded, and inferring it is the fabrication clause 2 forbids")
	require.Nil(t, anchorBindingAt(t, s, 10, 0xBB, testPollSource, 5010))

	// (c) EVERY OPERATION STILL WORKS on the upgraded schema, and a NEW round does
	// record its binding — so the upgrade leaves the old rows honest without leaving
	// the column useless.
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables
		WHERE table_schema = $1 AND table_name = 'price_poll_anchor_prune'`, schema).Scan(&n))
	require.Equal(t, 1, n, "the prune frontier table lands with it")

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5100, 0xCC, testPollSource, 3_000_000, 6),
	}, 5100, anchorAt(5100))))
	require.EqualValues(t, 5100, *anchorBindingAt(t, s, 10, 0xCC, testPollSource, 5100),
		"a post-upgrade round binds its observations to the anchor it actually wrote")

	// (d) And the marked-row accounting reads the upgraded shape correctly: a legacy
	// NULL-bound row counts as UNANCHORED, which is what the operator WARN reports.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5100, 0)
	require.NoError(t, err)
	require.EqualValues(t, 3, marked)
	stats, err := s.NeutralizedPriceStats(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.EqualValues(t, 3, stats.Rows, "and the backlog aggregate works against the new index")
}
