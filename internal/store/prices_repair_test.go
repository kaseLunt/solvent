package store

// LIVE-DATABASE tests for the reorg-repair decision surface: the facts a caller
// reads before it may destroy anything (PriceRepairExposure,
// CountUnanchoredPricesAbove), and the fail-closed-but-terminating transition it
// takes when no evidence can ever exist (NeutralizeUnverifiablePrices).
//
// WHY THESE ARE LIVE TESTS AND NOT FAKE ONES. Every claim here is a claim about
// what POSTGRES does — which rows a DELETE spares, whether acked_epoch actually
// advances, whether ApplyPolledPrices stops refusing afterwards. A fake that
// modelled those transitions would be asserting its own model. The immediately
// preceding review round found a test that set an unacked-epoch flag directly, a
// transition the real store cannot perform, and thereby certified a permanent
// production deadlock as working behaviour. The state machine is therefore pinned
// here, against the database, and the ORCHESTRATION (which outcome the poller
// selects from which evidence) is pinned in internal/prices against a fake whose
// only epoch transitions are the ones these tests prove the store makes.

import (
	"context"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// unanchoredHistory puts the store into the exact state the deadlock finding
// describes: the poll engine owns rows through a cursor, NO poll anchor covers
// them, and a reorg epoch on the chain is unacknowledged with a rewind target below
// every row.
//
// The rows are written through ApplyPrices (not ApplyPolledPrices) under the
// poller's engine key, which is precisely the shape legacy pre-anchor history has
// on disk: owned, cursor-covered, and anchorless. The epoch comes from a real
// store.Rewind, so it is the same row the walker writes.
func unanchoredHistory(t *testing.T, s *Store, rewoundTo uint64) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(4950, 0xAA, testPollSource, 1_000_000, 6),
		po(5000, 0xAA, testPollSource, 1_010_000, 6),
	}, 5000)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, rewoundTo, []byte{0x01}))

	unacked, err := s.HasUnackedReorg(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.True(t, unacked, "the fixture must actually leave an unacknowledged epoch")
}

// invalidReasonAt reads one row's validity and quarantine reason.
func invalidReasonAt(t *testing.T, s *Store, chainID uint64, asset byte, source string, block uint64) (bool, string) {
	t.Helper()
	var valid bool
	var reason string
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT valid, invalid_reason FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, addr20(asset), source, block).Scan(&valid, &reason))
	return valid, reason
}

// THE DEADLOCK, AGAINST POSTGRES. From {cursor, unacknowledged epoch, owned rows,
// no anchors} the previous code had no exit at all: repair needed an anchor to
// verify, AdoptPollAnchor refuses while an epoch is pending, and acked_epoch only
// ever advanced through repair. Every subsequent Step repeated the refusal, so poll
// price ingestion stopped permanently after an upgrade-time reorg.
//
// This drives every transition of that cycle against the database — including the
// two that CANNOT clear it — and then the one that can, asserting that ingestion
// really resumes afterwards.
func TestPendingEpochWithUnanchoredHistoryHasATerminatingTransition(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	unanchoredHistory(t, s, 4000)

	// (1) THE CYCLE. Applying is refused because the epoch is unacked...
	_, err := s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, 5100,
		PollAnchor{BlockNumber: 5100, BlockHash: hash32(0x51)})
	require.ErrorIs(t, err, ErrUnackedReorgEpoch, "no price can be applied while the epoch stands")

	// ...and adoption, the only thing that could make the rows verifiable, is
	// refused for exactly as long as the epoch stands. Adopting here could record a
	// REPLACEMENT block's hash and let a later probe "verify" rows describing the
	// block the chain discarded.
	_, err = s.AdoptPollAnchor(ctx, testPollEngine, 10, PollAnchor{BlockNumber: 5000, BlockHash: hash32(0x50)})
	require.ErrorIs(t, err, ErrUnackedReorgEpoch,
		"adoption cannot break the cycle: it is gated on the very epoch repair is trying to clear")

	// (2) THE EVIDENCE. The exposure read reports the boundary a rewind would act
	// above and that everything above it is UNPROVABLE — which is what makes the
	// choice between deleting and neutralizing a decision on facts.
	exp, err := s.PriceRepairExposure(ctx, testPollEngine, 10, 5000)
	require.NoError(t, err)
	require.Equal(t, uint64(4000), exp.EffectiveTarget,
		"the store lowers the caller's target to the deepest unacknowledged rewound_to; a caller cannot compute this itself")
	require.Equal(t, int64(2), exp.Owned)
	require.Equal(t, int64(2), exp.Unanchored, "no anchor covers either row")
	require.Zero(t, exp.AnchoredHeights)

	// (3) THE EXIT. Neutralization acks WITHOUT deleting.
	boundary, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5000, 0)
	require.NoError(t, err)
	require.Equal(t, uint64(4000), boundary)
	require.Equal(t, int64(2), marked)

	require.Len(t, priceRows(t, s, 10), 2, "NOTHING was deleted — the unrecoverable history is still there")
	for _, b := range []uint64{4950, 5000} {
		valid, reason := invalidReasonAt(t, s, 10, 0xAA, testPollSource, b)
		require.False(t, valid, "row at %d", b)
		require.Equal(t, InvalidReasonUnverifiableReorg, reason, "row at %d", b)
	}
	_, found, err := s.LatestUsablePrice(ctx, 10, addr20(0xAA), testPollSource)
	require.NoError(t, err)
	require.False(t, found, "and no consumer can read a neutralized row as a usable price")

	// The epoch is genuinely acknowledged — by the database, in that transaction.
	unacked, err := s.HasUnackedReorg(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.False(t, unacked, "the epoch is cleared: fail-closed must not mean fail-forever")
	cursor, ok, err := s.DeriveCursor(ctx, testPollEngine)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, uint64(4000), cursor, "the cursor is reset to the boundary it acted above")

	// (4) INGESTION RESUMES. This is the property the deadlock denied, and it is
	// asserted against the same store that refused in step (1).
	res, err := s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5100, 0xAA, testPollSource, 1_020_000, 6),
	}, 5100, PollAnchor{BlockNumber: 5100, BlockHash: hash32(0x51)})
	require.NoError(t, err, "poll ingestion must work again")
	require.Len(t, res.Inserted, 1)
	require.True(t, res.AnchorInserted)

	// And adoption is available again, so the retained history that a LATER reorg
	// would ask about can be anchored — except for the rows this call neutralized,
	// which are deliberately left as unusable artifacts.
	adopted, err := s.AdoptPollAnchor(ctx, testPollEngine, 10, PollAnchor{BlockNumber: 5000, BlockHash: hash32(0x50)})
	require.NoError(t, err)
	require.True(t, adopted)
}

// A verified floor must confine neutralization to the UNPROVABLE suffix: history at
// or below a hash-verified anchor was proven canonical, so marking it unusable would
// be destroying a usable price on evidence that says the opposite.
func TestNeutralizationHonoursAVerifiedFloor(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Anchored, canonical history at 4900; an unanchored legacy row at 4950 above it.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(4900, 0xAA, testPollSource, 1_000_000, 6),
	}, 4900, PollAnchor{BlockNumber: 4900, BlockHash: hash32(0x49)})))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(4950, 0xBB, testPollSource, 2_000_000, 6),
	}, 4950)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 100, []byte{0x01}))

	boundary, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 4950, 4900)
	require.NoError(t, err)
	require.Equal(t, uint64(4900), boundary, "the verified floor raises the boundary above the walker's 100")
	require.Equal(t, int64(1), marked, "only the row above the floor is marked")

	valid, _ := invalidReasonAt(t, s, 10, 0xAA, testPollSource, 4900)
	require.True(t, valid, "provably-canonical history keeps its validity")
	valid, reason := invalidReasonAt(t, s, 10, 0xBB, testPollSource, 4950)
	require.False(t, valid)
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)

	// The anchor at or below the boundary survives; there were none above it.
	anchors, err := s.PollAnchorsBelow(ctx, testPollEngine, 10, 5000, 10)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{{BlockNumber: 4900, BlockHash: hash32(0x49)}}, plainAnchors(anchors))

	// A floor above the requested target is a caller bug and is refused outright,
	// exactly as RewindPrices refuses it.
	_, _, err = s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 4950, 5000)
	require.ErrorContains(t, err, "verified floor 5000 is above the requested target 4950")
}

// Neutralization drops the poll anchors above the boundary along with the rows'
// usability. An anchor that outlived its round's usability would let a later repair
// hash-verify a height whose row this call declared unplaceable — the opposite of
// what the marker means.
func TestNeutralizationDropsAnchorsAboveTheBoundary(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000, PollAnchor{BlockNumber: 5000, BlockHash: hash32(0x50)})))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5010, 0xBB, testPollSource, 1_000_000, 6),
	}, 5010)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))

	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5010, 0)
	require.NoError(t, err)
	require.Equal(t, int64(2), marked)

	anchors, err := s.PollAnchorsBelow(ctx, testPollEngine, 10, 6000, 10)
	require.NoError(t, err)
	require.Empty(t, anchors, "no anchor may survive above the boundary to vouch for a neutralized row")
	require.Len(t, priceRows(t, s, 10), 2, "the rows themselves are still retained")
}

// D-010 clause 4, AGAINST POSTGRES: the retained-but-unusable pile is countable,
// and the count is engine- and marker-scoped rather than "everything invalid".
//
// It matters that this is a live test. The claim is about which rows the aggregate
// selects — a non-positive answer carries a DIFFERENT invalid_reason and must not
// be counted as reorg fallout, and another engine's rows must not be counted at
// all — and both are properties of the predicate, not of any model of it.
func TestNeutralizedPriceStatsCountsOnlyReorgMarkedRowsOfOneEngine(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Nothing marked yet: an empty backlog reports zero and no timestamps.
	empty, err := s.NeutralizedPriceStats(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.Zero(t, empty.Rows)
	require.True(t, empty.Oldest.IsZero())
	require.Zero(t, empty.HighestBlock)

	// Two poll rows and one NON-POSITIVE answer, which the store quarantines under
	// its own reason. Only the first two are eligible to be neutralized.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(4900, 0xAA, testPollSource, 1_000_000, 6),
		po(5000, 0xBB, testPollSource, 2_000_000, 6),
		po(5000, 0xCC, testPollSource, 0, 6),
	}, 5000)))
	// A different engine's row above the same height, which must never be counted.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 10, []PriceObservation{
		po(5000, 0xDD, "chainlink:0xfeed", 3_000_000, 8),
	}, 5000)))

	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4800, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5000, 0)
	require.NoError(t, err)
	require.Equal(t, int64(2), marked, "the non-positive row already carried a different reason")

	got, err := s.NeutralizedPriceStats(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.Equal(t, int64(2), got.Rows,
		"the zero-answer row is quarantined for a different reason and is not reorg fallout")
	require.Equal(t, uint64(5000), got.HighestBlock)
	require.False(t, got.Oldest.IsZero())
	require.False(t, got.Newest.Before(got.Oldest))

	other, err := s.NeutralizedPriceStats(ctx, testFeedEngine, 10)
	require.NoError(t, err)
	require.Zero(t, other.Rows, "the backlog is owner-scoped")
}

// A neutralized row is never deleted by a LATER rewind either. It was kept once
// because nothing could place it on a chain; a later rewind has no more evidence
// than the first one did, so deferring the same unevidenced destruction is not an
// improvement. Its ordinary siblings above the target still go.
func TestRewindRetainsNeutralizedRowsAndDeletesTheRest(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5000, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked)

	// A fresh, ordinary round lands above the neutralized row, then a second reorg
	// rewinds below both.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5100, 0xBB, testPollSource, 3_000_000, 6),
	}, 5100, PollAnchor{BlockNumber: 5100, BlockHash: hash32(0x51)})))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4500, []byte{0x02}))
	require.NoError(t, s.RewindPrices(ctx, testPollEngine, 10, 5100, 0))

	rows := priceRows(t, s, 10)
	require.Len(t, rows, 1, "the ordinary row above the target is deleted; the neutralized one is not")
	require.Contains(t, rows, "00000000000000000000000000000000000000aa/"+testPollSource+"@5000")

	// And the exposure read does not count it, so its permanent presence cannot veto
	// a later PROVEN deletion.
	exp, err := s.PriceRepairExposure(ctx, testPollEngine, 10, 4000)
	require.NoError(t, err)
	require.Zero(t, exp.Owned, "a retained artifact is not history at risk")
	require.Zero(t, exp.Unanchored)
	n, err := s.CountOwnedPricesAbove(ctx, testPollEngine, 10, 0)
	require.NoError(t, err)
	require.Zero(t, n)
}

// A fresh observation at the identity of a neutralized row SUPERSEDES it rather
// than aborting the batch on a price divergence.
//
// Without this arm the divergence abort fires whenever the chain's head reaches a
// neutralized height with a different price, and the poller's round fails on a
// conflict it can never resolve. The recorded value was already declared
// unplaceable, so the new one is authoritative — and it is reported as an INSERT
// with a fresh observed_at, because it genuinely is a new durable observation.
func TestFreshObservationSupersedesANeutralizedRow(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	_, _, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5000, 0)
	require.NoError(t, err)

	// A round lands at the SAME height with a DIFFERENT price — the shape that used
	// to abort the whole batch.
	res, err := s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_234_567, 6),
	}, 5000, PollAnchor{BlockNumber: 5000, BlockHash: hash32(0x50)})
	require.NoError(t, err, "a neutralized row must not wedge the writer on a divergence it cannot resolve")
	require.Len(t, res.Inserted, 1, "the supersede is reported as a new durable observation")
	require.True(t, res.Inserted[0].Valid)

	valid, reason := invalidReasonAt(t, s, 10, 0xAA, testPollSource, 5000)
	require.True(t, valid, "the row is usable again because it was RE-OBSERVED, not because anything was assumed")
	require.Empty(t, reason)
	got, found, err := s.LatestUsablePrice(ctx, 10, addr20(0xAA), testPollSource)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "1234567", got.Price.String())

	// A DIFFERENT owner on the SAME chain may not take it over: the supersede arm is
	// owner-scoped, so the ordinary provenance abort still stands. (The foreign engine
	// bootstraps its own cursor first, because the chain carries epochs.)
	require.NoError(t, s.RewindPrices(ctx, "prices:chainlink_feed:10", 10, 4000, 0))
	_, err = s.ApplyPrices(ctx, "prices:chainlink_feed:10", 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_234_567, 6), // same value, so the OWNER check is what refuses
	}, 5000)
	require.ErrorContains(t, err, "refusing a replay from",
		"a foreign engine cannot claim another owner's row, neutralized or not")
}

// CountUnanchoredPricesAbove is the read that forbids deleting above a floor when
// something above it can never be proven. It is scoped by owner, by height, and by
// whether an anchor covers the row's exact block.
func TestCountUnanchoredPricesAboveIsOwnerHeightAndAnchorScoped(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Anchored rounds at 4900 and 5100; unanchored rows at 4950 and 5000.
	for _, b := range []uint64{4900, 5100} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
			po(b, 0xAA, testPollSource, 1_000_000, 6),
		}, b, PollAnchor{BlockNumber: b, BlockHash: hash32(byte(b % 251))})))
	}
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(4950, 0xBB, testPollSource, 1_000_000, 6),
		po(5000, 0xCC, testPollSource, 1_000_000, 6),
	}, 5100)))
	// Another owner's unanchored row on the same chain must not be counted.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, "prices:chainlink_feed:10", 10, []PriceObservation{
		po(5050, 0xDD, testFeedSource, 1_000_000, 6),
	}, 5050)))

	for _, tc := range []struct {
		above uint64
		want  int64
	}{
		{0, 2},    // both unanchored rows
		{4950, 1}, // only 5000
		{5000, 0}, // 5100 is anchored
		{5100, 0},
	} {
		n, err := s.CountUnanchoredPricesAbove(ctx, testPollEngine, 10, tc.above)
		require.NoError(t, err)
		require.Equal(t, tc.want, n, "above %d", tc.above)
	}
}

// PriceRepairExposure reports the target a rewind would act above even when NO
// epoch is pending (then it is the caller's own target), and counts only rows above
// it. Without the epoch-derived target a caller reasoning from its cursor alone
// would measure the wrong boundary — which is how "is there history at risk here"
// became undecidable.
func TestPriceRepairExposureReportsTheBoundaryAndWhatIsAboveIt(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000, PollAnchor{BlockNumber: 5000, BlockHash: hash32(0x50)})))

	// No epoch: the effective target is the caller's own, so nothing is above it.
	exp, err := s.PriceRepairExposure(ctx, testPollEngine, 10, 5000)
	require.NoError(t, err)
	require.Equal(t, uint64(5000), exp.EffectiveTarget)
	require.Zero(t, exp.Owned, "nothing above the target means a rewind here deletes nothing")

	// Two epochs, the DEEPER of which sets the boundary: an ack reaches every epoch
	// on the chain, so the deletion must reach the deepest one's target.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4800, []byte{0x01}))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4600, []byte{0x02}))
	exp, err = s.PriceRepairExposure(ctx, testPollEngine, 10, 5000)
	require.NoError(t, err)
	require.Equal(t, uint64(4600), exp.EffectiveTarget, "the DEEPEST unacknowledged target wins")
	require.Equal(t, int64(1), exp.Owned)
	require.Zero(t, exp.Unanchored, "the row's own height is anchored")
	require.Equal(t, int64(1), exp.AnchoredHeights)

	// An engine with no cursor at all is a bootstrap: every epoch counts as unacked.
	exp, err = s.PriceRepairExposure(ctx, "prices:poll:999", 10, 5000)
	require.NoError(t, err)
	require.Equal(t, uint64(4600), exp.EffectiveTarget)
	require.Zero(t, exp.Owned, "and it owns nothing, so there is nothing at risk")
}

// testSweepBudget is the per-generation attempt budget these tests pass to
// SweepProgress. It matches snapshot.MaxSweepAttempts (1 first attempt + 3 retries),
// which this package cannot import — internal/snapshot imports internal/store, so the
// dependency only runs one way. The budget is a PARAMETER of SweepProgress precisely
// because it is the snapshotter's policy rather than the store's.
const testSweepBudget = 4

// SweepProgress reports the snapshotter's durable progress, which is the only way
// the daemon can see a SEMANTIC sweep stall: an all-endpoints-stale sweep refuses
// every batch, returns no error and advances nothing, and the snapshotter has no
// cursor in ingest_cursors or derive_cursors for the generic progress pass to watch.
func TestSweepProgressReportsDurableSweepState(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	_, found, err := s.SweepProgress(ctx, "debt_manager", testSweepBudget)
	require.NoError(t, err)
	require.False(t, found, "an engine that has never opened a generation has not started, not stalled")

	gen, err := s.OpenSweepGeneration(ctx, "debt_manager")
	require.NoError(t, err)
	p, found, err := s.SweepProgress(ctx, "debt_manager", testSweepBudget)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, gen, p.Generation)
	require.True(t, p.Open, "an open generation owes work, so batches should be landing")
	require.False(t, p.OpenedAt.IsZero(), "and the stall clock can be measured from its own opened_at")
	require.True(t, p.LastBatchAt.IsZero(), "nothing has landed yet")
	require.True(t, p.CompletedAt.IsZero())

	// A landed batch stamps snapshot_sweeps, which is the durable "something is
	// still happening" fact.
	require.NoError(t, s.ApplySweepBatch(ctx, "debt_manager", gen, 5000, []SweepResult{
		{Account: addr20(0xAA), OK: true, Balances: map[string]map[string]*big.Int{
			"00000000000000000000000000000000000000bb": {"collateral": big.NewInt(1)},
		}},
	}))
	p, _, err = s.SweepProgress(ctx, "debt_manager", testSweepBudget)
	require.NoError(t, err)
	require.False(t, p.LastBatchAt.IsZero(), "the timestamp is the database's, so a restart cannot reset it")
	require.Zero(t, p.Lagging, "the only account is at the current generation")

	// A new generation makes it lag again, and completion closes the window.
	next, err := s.OpenSweepGeneration(ctx, "debt_manager")
	require.NoError(t, err)
	p, _, err = s.SweepProgress(ctx, "debt_manager", testSweepBudget)
	require.NoError(t, err)
	require.Equal(t, int64(1), p.Lagging)
	_, stamped, err := s.CompleteSweepGeneration(ctx, "debt_manager", next)
	require.NoError(t, err)
	require.True(t, stamped)
	p, _, err = s.SweepProgress(ctx, "debt_manager", testSweepBudget)
	require.NoError(t, err)
	require.False(t, p.Open, "a closed generation is idle by cadence, not stalled")
	require.False(t, p.CompletedAt.IsZero())
	require.Zero(t, p.Failed, "nothing failed in that generation")
	require.False(t, p.LastSuccessAt.IsZero(), "and one account did succeed, in an earlier generation")
}

// "CLOSED" IS NOT "SUCCEEDED". CompleteSweepGeneration deliberately stamps a
// generation complete once no account still OWES work, and an account that has
// spent its retry budget owes none — so a generation closes with status='failed'
// rows in it, reporting them only through a return value and a WARN. Per-account
// failures also return nil from ApplySweepBatch, so the daemon's failure
// bookkeeping stays clear. The readiness gate returned immediately for every
// closed generation, so /readyz went green while named borrowers had no current
// collateral snapshot at all until the next generation opened.
//
// This drives the whole real transition — attempts accumulate through
// ApplySweepBatch until SweepWorkBatch stops offering the account, then the
// generation closes — and pins the counts SweepProgress must report at each stage.
// Nothing here writes a status row or an attempts counter directly: the durable
// budget is the point, and a test that set attempts itself would prove nothing
// about whether the store's own arithmetic reaches the exhausted state.
func TestSweepProgressReportsExhaustedFailuresThroughGenerationClose(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	engine := "debt_manager"

	good, bad := addr20(0xAA), addr20(0xBB)
	// Both accounts need a debt position event, or SweepWorkBatch's registry read
	// does not see them at all.
	seedSweepRegistry(t, s, engine, good, bad)

	gen, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)

	// One account succeeds; the other reverts on every attempt. Drain the queue the
	// way the snapshotter does, so `attempts` is accumulated by the store.
	rounds := 0
	for {
		batch, err := s.SweepWorkBatch(ctx, engine, gen, testSweepBudget, 10)
		require.NoError(t, err)
		if len(batch) == 0 {
			break
		}
		rounds++
		require.Less(t, rounds, 10, "the durable retry budget must terminate the queue")
		results := make([]SweepResult, 0, len(batch))
		for _, acct := range batch {
			if string(acct) == string(good) {
				results = append(results, SweepResult{Account: acct, OK: true,
					Balances: map[string]map[string]*big.Int{
						"00000000000000000000000000000000000000cc": {"collateral": big.NewInt(7)},
					}})
				continue
			}
			results = append(results, SweepResult{Account: acct, OK: false})
		}
		require.NoError(t, s.ApplySweepBatch(ctx, engine, gen, 5_000+uint64(rounds), results),
			"a per-account revert is NOT a batch error — which is exactly why nothing else reports it")

		p, _, err := s.SweepProgress(ctx, engine, testSweepBudget)
		require.NoError(t, err)
		require.Equal(t, int64(1), p.Failed, "the failing account is recorded as failed from its first attempt")
		if rounds < testSweepBudget {
			require.Zero(t, p.Exhausted,
				"round %d: budget remains, so this failure is IN FLIGHT and not yet unresolved", rounds)
		}
	}
	require.Equal(t, testSweepBudget, rounds, "the account was retried exactly to its budget")

	// The queue is empty while an account is still status='failed', and the
	// generation closes on that.
	failed, stamped, err := s.CompleteSweepGeneration(ctx, engine, gen)
	require.NoError(t, err)
	require.True(t, stamped)
	require.Equal(t, int64(1), failed, "completion reports the degradation — and only through this value and a WARN")

	p, found, err := s.SweepProgress(ctx, engine, testSweepBudget)
	require.NoError(t, err)
	require.True(t, found)
	require.False(t, p.Open, "the generation is CLOSED")
	require.Equal(t, int64(1), p.Failed, "and it closed with a failed account in it")
	require.Equal(t, int64(1), p.Exhausted,
		"a generation cannot close while an account still has budget, so a closed generation's failures are ALL exhausted")
	require.False(t, p.LastSuccessAt.IsZero(), "the other account's success is the staleness reference")

	// The NEXT generation grants a fresh budget, so the same row stops being
	// exhausted the moment work is owed again — the state is recoverable, which is
	// why it belongs in the recoverable half of the health surface.
	next, err := s.OpenSweepGeneration(ctx, engine)
	require.NoError(t, err)
	require.Greater(t, next, gen)
	p, _, err = s.SweepProgress(ctx, engine, testSweepBudget)
	require.NoError(t, err)
	require.Zero(t, p.Failed, "the failed row now belongs to an EARLIER generation, so it counts as lagging instead")
	require.Zero(t, p.Exhausted)
	require.Equal(t, int64(2), p.Lagging)
}

// seedSweepRegistry gives each account a debt position event, which is what
// SweepWorkBatch's registry read (DISTINCT debt-side accounts) selects on. Without
// it the queue is empty and a sweep test would pass by doing nothing.
func seedSweepRegistry(t *testing.T, s *Store, engine string, accounts ...[]byte) {
	t.Helper()
	ctx := context.Background()
	for i, acct := range accounts {
		require.NoError(t, s.ApplyDerived(ctx, engine, 10, []PositionEvent{{
			ChainID: 10, Engine: engine, Account: acct, Asset: addr20(0xC0),
			Side: "debt", EventType: "borrow", Delta: big.NewInt(1),
			BlockNumber: 100 + uint64(i), TxHash: hash32(byte(0xD0 + i)), LogIndex: uint32(i),
		}}, 200))
	}
}

// Both raw-log reads carry raw_logs.ingested_at, which is the durable observation
// context the feed deriver judges an oracle timestamp against. Returning it as the
// zero time would send that judgement back to a process clock.
func TestRawLogReadsCarryTheDurableIngestionTime(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	topic := hash32(0xAB)
	addr := addr20(0xAA)

	require.NoError(t, s.SaveBatch(ctx, "eth:feed-usdc", 1, []RawLog{{
		ChainID: 1, BlockNumber: 100, BlockHash: hash32(0x64), TxHash: hash32(0x01),
		LogIndex: 0, Address: addr, Topics: [][]byte{topic}, Data: []byte{0x01},
	}}, 100, hash32(0x64)))

	inRange, err := s.RawLogsInRange(ctx, 1, [][]byte{addr}, 100, 100)
	require.NoError(t, err)
	require.Len(t, inRange, 1)
	require.False(t, inRange[0].IngestedAt.IsZero(),
		"RawLogsInRange must carry the durable ingestion time; without it a timestamp verdict falls back to a clock")

	byTopic, err := s.LatestLogsByTopic(ctx, 1, [][]byte{addr}, topic, 100)
	require.NoError(t, err)
	require.Len(t, byTopic, 1)
	require.Equal(t, inRange[0].IngestedAt, byTopic[0].IngestedAt,
		"and both reads must report the SAME instant for the same row, or a rehydration would reach a different verdict than the live pass")
}
