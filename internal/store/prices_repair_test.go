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
	"log/slog"
	"math/big"
	"reflect"
	"testing"
	"time"

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
// verify, the only thing that could supply one after the fact was adoption, adoption
// was refused while an epoch was pending, and acked_epoch only ever advanced through
// repair. Every subsequent Step repeated the refusal, so poll price ingestion stopped
// permanently after an upgrade-time reorg.
//
// THE CYCLE IS SHORTER NOW, NOT LONGER. Adoption is deleted (wave 12), so the second
// leg is no longer a refusal to assert — it is a path that does not exist. That does
// not re-open the deadlock, and this test is what says so: the exit was never adoption,
// it was neutralization, which needs no anchor at all.
//
// This drives every transition of the cycle against the database — including the one
// that CANNOT clear it — and then the one that can, asserting that ingestion really
// resumes afterwards.
func TestPendingEpochWithUnanchoredHistoryHasATerminatingTransition(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	unanchoredHistory(t, s, 4000)

	// (1) THE CYCLE. Applying is refused because the epoch is unacked, and nothing
	// else in the store can make the rows verifiable — there is no call that writes an
	// anchor for history a round did not anchor at the time.
	_, err := s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, 5100,
		PollAnchor{BlockNumber: 5100, BlockHash: hash32(0x51)})
	require.ErrorIs(t, err, ErrUnackedReorgEpoch, "no price can be applied while the epoch stands")

	// (2) THE EVIDENCE. The exposure read reports the boundary a rewind would act
	// above and that everything above it is UNPROVABLE — which is what makes the
	// choice between deleting and neutralizing a decision on facts.
	exp, err := s.PriceRepairExposure(ctx, testPollEngine, 10, 5000)
	require.NoError(t, err)
	require.Equal(t, uint64(4000), exp.EffectiveTarget,
		"the store lowers the caller's target to the deepest unacknowledged rewound_to; a caller cannot compute this itself")
	require.Equal(t, int64(2), exp.Owned)
	require.Equal(t, int64(2), exp.Unanchored, "no anchor covers either row")

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

	// AND THE MARKED ROWS STAY MARKED. The old version of this leg proved that
	// adoption became available again once the epoch was acked, and then that it was
	// STILL refused at a neutralized height — the circularity gate. Both legs are gone
	// with adoption itself, and what replaces them is stronger: the classified rows
	// cannot acquire provenance from any path at all, so the hazard the gate defended
	// against is unreachable rather than guarded.
	valid, reason := invalidReasonAt(t, s, 10, 0xAA, testPollSource, 5000)
	require.False(t, valid, "the row stays exactly as the repair left it")
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)
	require.Nil(t, anchorBindingAt(t, s, 10, 0xAA, testPollSource, 5000),
		"and it stays unprovable: nothing in the store can give a legacy row a binding after the fact")
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

// D-012 CLAUSE 2, AGAINST POSTGRES: NEUTRALIZATION MUST NOT DELETE THE ANCHORS ABOVE
// THE BOUNDARY, and D-012 CLAUSE 3: what it does to the rows is PERMANENT.
//
// Clause 2 — "neutralization never deletes anchors, and no retention bound, prune, or
// rewind may expire an anchor belonging to a neutralized height, on any store path."
// Wave 6 deleted them here, reasoning that an anchor outliving its round's usability
// would let a later repair "verify" a height the call had declared unplaceable. That
// inverted the anchor's role: it is not a blessing, it is the PROVENANCE — the hash of
// the block the round actually ran at — and it is the only thing from which "was that
// block canonical after all?" could ever be answered, by any future offline tool.
//
// Clause 3 — nothing in the running system reverses the marking. That is asserted here
// STRUCTURALLY rather than by exhausting call shapes: this store carries no online
// revalidation primitive at all (TestStoreHasNoOnlineRevalidationPrimitive), so the
// only thing that can clear the marker is a fresh observation at the row's own
// identity, which TestFreshObservationSupersedesANeutralizedRow pins.
func TestNeutralizationRetainsAnchorsAboveTheBoundary(t *testing.T) {
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
	require.Equal(t, []PollAnchor{{BlockNumber: 5000, BlockHash: hash32(0x50)}}, plainAnchors(anchors),
		"the anchor above the boundary SURVIVES: it is provenance, retained forever (D-012 clause 2)")
	require.Len(t, priceRows(t, s, 10), 2, "and the rows themselves are still retained")

	// The frontier read is a different question from the provenance read, and only the
	// first one is supposed to skip a neutralized height. While neutralization deleted
	// these anchors the distinction was implicit; retaining them makes it explicit, or a
	// deep reorg leaves the block-advance clock stuck on an orphaned round forever.
	_, found, err := s.NewestPollAnchor(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.False(t, found,
		"the only surviving anchor sits at a neutralized height, so this engine has no USABLE frontier")

	// D-012 CLAUSE 3, ON BOTH ROWS: the classification stands. Repeating the call
	// changes nothing, and there is no store path that would put either row back.
	_, again, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5010, 0)
	require.NoError(t, err)
	require.Zero(t, again, "already-marked rows are not re-marked")
	for _, c := range []struct {
		asset byte
		block uint64
		why   string
	}{
		{0xAA, 5000, "anchored: its provenance survives, but nothing ONLINE consumes it"},
		{0xBB, 5010, "unanchored legacy: nothing anywhere can ever place it (clause 5)"},
	} {
		valid, reason := invalidReasonAt(t, s, 10, c.asset, testPollSource, c.block)
		require.False(t, valid, c.why)
		require.Equal(t, InvalidReasonUnverifiableReorg, reason, c.why)
	}
}

// D-012 CLAUSE 7, AGAINST POSTGRES: the operator-facing report of a classification
// separates the ANCHORED rows from the UNANCHORED ones, and the split describes
// exactly the rows THIS call marked.
//
// The clause: "operator-facing text must match this decision: anchored and unanchored
// classifications reported distinctly". Round 7's [low] was that one WARN asserted the
// unanchored story ("no poll anchor covers this observation... no later repair can
// verify them") for a call that is also used on anchored suffixes, in the most
// correctness-critical path the poller has. The two now travel separately because an
// operator's next step differs: an anchored row still has the block hash its round ran
// against on disk, so an offline reconciliation could settle it; an unanchored one
// never had a hash recorded, so nothing ever can.
//
// This asserts the attributes rather than the prose because the counts are the part a
// responder acts on, and it is a LIVE test because the split is computed by the same
// UPDATE that does the marking — a model of it would be asserting itself.
//
// THE UNANCHORED SIDE IS NOW ITSELF SPLIT (Codex round 10's [medium] #2), and this
// test covers the NEVER-BOUND half: a row written by ApplyPrices, which records no
// anchor at all, so its binding is NULL and no hash is known for its round. The other
// half — a binding that DANGLES because retention expired the anchor its round really
// did write — is covered by TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart,
// which constructs it. The reason the split exists is that the old single sentence
// ("no hash was ever recorded for these heights") is false for that second population.
func TestNeutralizationReportsAnchoredAndUnanchoredMarkingsDistinctly(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Two ANCHORED rounds and one UNANCHORED legacy row, all above the boundary.
	for _, b := range []uint64{4900, 5000} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
			[]PriceObservation{po(b, 0xAA, testPollSource, int64(1_000_000+b), 6)}, b, anchorAt(b))))
	}
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5050, 0xBB, testPollSource, 2_000_000, 6),
	}, 5050)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4800, []byte{0x01}))

	rec := captureWarnAttrs(t)
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5050, 0)
	require.NoError(t, err)
	require.Equal(t, int64(3), marked)

	got := rec.find("rowsNeutralized")
	require.NotNil(t, got, "the classification is reported to the operator at all")
	require.Equal(t, int64(3), got["rowsNeutralized"])
	require.Equal(t, int64(2), got["rowsAnchored"],
		"the two rounds whose block hash this engine recorded are reported as anchored")
	require.Equal(t, int64(1), got["rowsUnanchored"],
		"the legacy row, for which no hash is known, is reported separately")
	require.Equal(t, int64(1), got["rowsUnanchoredNeverBound"],
		"and it is attributed to the right cause: its binding is NULL, so no round ever recorded a hash for it")
	require.Zero(t, got["rowsUnanchoredBindingPruned"],
		"nothing here has a binding whose anchor was pruned, and the report must not invent one")
	require.Contains(t, got["msg"], "PERMANENT",
		"D-012 clause 3: the text must not describe this as a pending repair")
	require.Contains(t, got["msg"], "offline",
		"D-012 clause 2/7: it names the retained-provenance option, without promising a tool")
	require.NotContains(t, got["msg"], "no later repair can verify them",
		"the round-7 [low]: the unanchored claim must not be asserted for a mixed call")
	// AND THE RETENTION PROMISE IS SCOPED TO THE POPULATION IT HOLDS FOR (round 10's
	// [medium] #2). The message used to say the recorded block hash is retained forever
	// for everything it marked; for a row whose anchor is already gone that is false,
	// and the operator reading it would look for provenance that is not there.
	require.Contains(t, got["msg"], "retained only where one still exists",
		"the hash-retention claim names the rowsAnchored population and no other")
	require.NotContains(t, got["unanchoredMeans"], "no hash was ever recorded",
		"the retired gloss: it is false for a binding retention pruned")
	require.Contains(t, got["unanchoredMeans"], "no SURVIVING anchor is linked to the observation",
		"unanchored is a statement about what survives, not about what was written")

	// A SECOND call over an all-anchored suffix reports zero unanchored, so the split
	// tracks what each call actually did rather than the standing pile.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(5200, 0xCC, testPollSource, 3_000_000, 6)}, 5200, anchorAt(5200))))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 5100, []byte{0x02}))
	rec2 := captureWarnAttrs(t)
	_, marked, err = s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5200, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked)
	got = rec2.find("rowsNeutralized")
	require.NotNil(t, got)
	require.Equal(t, int64(1), got["rowsAnchored"])
	require.Equal(t, int64(0), got["rowsUnanchored"],
		"the three rows the FIRST call marked are not re-counted into this one's report")
}

// captureWarnAttrs routes slog through a collector that keeps each Warn record's
// ATTRIBUTES as well as its message, for the operator-facing surfaces whose contract
// is the numbers they carry rather than their prose.
func captureWarnAttrs(t *testing.T) *warnAttrRecorder {
	t.Helper()
	rec := &warnAttrRecorder{}
	prev := slog.Default()
	slog.SetDefault(slog.New(rec))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return rec
}

type warnAttrRecorder struct{ records []map[string]any }

func (w *warnAttrRecorder) Enabled(context.Context, slog.Level) bool { return true }

func (w *warnAttrRecorder) Handle(_ context.Context, r slog.Record) error {
	if r.Level < slog.LevelWarn {
		return nil
	}
	m := map[string]any{"msg": r.Message}
	r.Attrs(func(a slog.Attr) bool {
		m[a.Key] = a.Value.Any()
		return true
	})
	w.records = append(w.records, m)
	return nil
}

func (w *warnAttrRecorder) WithAttrs([]slog.Attr) slog.Handler { return w }
func (w *warnAttrRecorder) WithGroup(string) slog.Handler      { return w }

// find returns the first recorded WARN carrying key, or nil.
func (w *warnAttrRecorder) find(key string) map[string]any {
	for _, r := range w.records {
		if _, ok := r[key]; ok {
			return r
		}
	}
	return nil
}

// D-012 CLAUSE 3, STRUCTURALLY: there is no online revalidation primitive on the
// store at all.
//
// The clause says "online revalidation is removed. Neutralization is a permanent
// classification in the running system." This is the same kind of assertion as
// internal/prices' TestPollStoreHasNoDeletionPrimitive, and for the same reason: a
// behaviour that is enforced by the ABSENCE of a method cannot be re-introduced by
// someone editing around a guard. The two methods D-011 added and D-012 removes are
// named explicitly, so a future re-introduction under either name fails here rather
// than silently restoring the machinery that carried both of round 7's criticals.
func TestStoreHasNoOnlineRevalidationPrimitive(t *testing.T) {
	st := reflect.TypeOf((*Store)(nil))
	for _, gone := range []string{"RevalidateNeutralizedPrices", "NeutralizedPriceAnchors"} {
		_, ok := st.MethodByName(gone)
		require.False(t, ok,
			"%s is the online revalidation subsystem D-012 clause 3 removes; re-adding it needs a new decision, not a new method", gone)
	}
	// And the classification is still COUNTABLE, which is the part clause 6 keeps.
	_, ok := st.MethodByName("NeutralizedPriceStats")
	require.True(t, ok, "clause 6 keeps the gap visible even though clause 3 removes the repair")
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

// A LATER REORG CANNOT REACH A NEUTRALIZED ROW EITHER, because a poll-owned engine
// has no path into RewindPrices at all (D-012 clause 1).
//
// This test used to drive s.RewindPrices with the poll engine and assert that the
// DELETE's predicate spared the marked row. That call was itself the [medium] Codex
// round 7 found: it deletes every anchor above the target with no neutralized-height
// exemption, so each invocation destroyed exactly the provenance clause 2 retains
// forever. The predicate is still there as defence in depth, but the reachable
// property is now the refusal — asserted in
// TestRewindPricesRefusesAPollOwnedEngineAndChangesNothing.
//
// What this test keeps is the half that is still reachable and still load-bearing:
// after the classification, the retained row is invisible to the exposure reads, so
// its permanent presence cannot veto a later PROVEN repair of genuinely new history.
//
// THAT HALF IS ADD-2, AND THE HEADER ONCE CLAIMED CLAUSE 1 FOR IT (round 8's
// [medium]). Clause 1 is about deletion and the RewindPrices refusal; it does not
// specify what the exposure reads count. Wave 10 could only say the behaviour was
// sound and uncited, because the addendum did not exist yet; it was ratified at
// fdb9f8d and is the citation now.
//
// ADD-2 (.superpowers/sdd/task-8-normative-addenda.md): "PriceRepairExposure (and any
// repair-scoping read) excludes rows already marked InvalidReasonUnverifiableReorg
// when computing what a repair must prove." Its rationale is what this test drives:
// D-012 clause 3 makes marking permanent, so if marked rows still counted as
// history-at-risk, every epoch after the first would demand proof about rows that can
// never be proven — permanence would veto all future repair, a fail-forever by
// composition. Excluding them is what lets permanence and continued operation coexist.
func TestNeutralizedRowsAreNotHistoryAtRiskForALaterRepair(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000)))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5000, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked)

	// A fresh, ordinary round lands above the marked row, then a second reorg.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5100, 0xBB, testPollSource, 3_000_000, 6),
	}, 5100, PollAnchor{BlockNumber: 5100, BlockHash: hash32(0x51)})))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4500, []byte{0x02}))

	// The exposure read sees ONE row at risk — the new one — and not the retained
	// artifact, which was already accounted for once and is never deleted.
	exp, err := s.PriceRepairExposure(ctx, testPollEngine, 10, 5100)
	require.NoError(t, err)
	require.Equal(t, int64(1), exp.Owned, "only the genuinely new row above the boundary is at risk")
	n, err := s.CountOwnedPricesAbove(ctx, testPollEngine, 10, 4000)
	require.NoError(t, err)
	require.Equal(t, int64(1), n, "a retained artifact is not history at risk")

	// And once the second epoch is answered the same way, both rows are still on disk.
	_, marked, err = s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5100, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked, "the already-marked row is not counted twice")
	require.Len(t, priceRows(t, s, 10), 2, "nothing was ever deleted (D-010 clause 1)")
	exp, err = s.PriceRepairExposure(ctx, testPollEngine, 10, 4000)
	require.NoError(t, err)
	require.Zero(t, exp.Owned)
	require.Zero(t, exp.Unanchored)
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
	// D-012 CLAUSE 6: the supersede is reported SEPARATELY from the insert, because it
	// is the only landed-round event that can lower the neutralized backlog and the
	// clause forbids paying for that aggregate on a cadence. The caller therefore has a
	// durable fact to key the recount on rather than a guess.
	require.Equal(t, int64(1), res.Superseded,
		"the store reports that this insert REPLACED a classified row, not merely that a row landed")

	valid, reason := invalidReasonAt(t, s, 10, 0xAA, testPollSource, 5000)
	require.True(t, valid, "the row is usable again because it was RE-OBSERVED, not because anything was assumed")
	require.Empty(t, reason)
	got, found, err := s.LatestUsablePrice(ctx, 10, addr20(0xAA), testPollSource)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "1234567", got.Price.String())

	// An ORDINARY replay after the supersede is not a second supersede: the marker is
	// gone, so this is the plain idempotent path and the count stays at zero.
	res, err = s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_234_567, 6),
	}, 5000, PollAnchor{BlockNumber: 5000, BlockHash: hash32(0x50)})
	require.NoError(t, err)
	require.Empty(t, res.Inserted)
	require.Zero(t, res.Superseded,
		"a replay of an already-restored row changes no classification, so it must not trigger a recount")

	// A DIFFERENT owner on the SAME chain may not take it over: the supersede arm is
	// owner-scoped, so the ordinary provenance abort still stands. (The foreign engine
	// bootstraps its own cursor first, because the chain carries epochs — and it is an
	// event-derived identity, because D-012 clause 1 leaves a poll-owned one no rewind.)
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 4000, 0))
	_, err = s.ApplyPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_234_567, 6), // same value, so the OWNER check is what refuses
	}, 5000)
	require.ErrorContains(t, err, "refusing a replay from",
		"a foreign engine cannot claim another owner's row, neutralized or not")
}

// D-012 CLAUSE 2 SURVIVES RETENTION. The clause is explicit that "no retention
// bound, prune, or rewind may expire an anchor belonging to a neutralized height, on
// any store path" — so anchors age out beyond pollAnchorRetention, and one at a
// NEUTRALIZED height is exempt.
//
// The clause forbids it because the anchor is the whole input an OFFLINE
// reconciliation would need, and clause 2 keeps that option open at zero ongoing
// cost. A retention bound that aged it out would foreclose the option quietly, some
// days after the classification, which is strictly worse than never having kept it:
// the operator would have no way to know when the door closed.
func TestPollAnchorRetentionExemptsNeutralizedHeights(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// One anchored round with a row, then a repair marks it.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(1, 0xAA, testPollSource, 1_000_000, 6),
	}, 1, anchorAt(1))))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 0, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 1, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked)

	// Then a long, healthy run pushes the anchor far past the retention window.
	total := uint64(pollAnchorRetention + 25)
	for i := uint64(2); i <= total; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, i, anchorAt(i))))
	}

	var oldest uint64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT min(block_number) FROM price_poll_anchors WHERE engine = $1`, testPollEngine).Scan(&oldest))
	require.Equal(t, uint64(1), oldest,
		"the neutralized height's anchor outlives the retention bound: it is the recovery path, not history")

	// THE COST OF THE EXEMPTION IS EXACTLY ONE ANCHOR ROW PER CLASSIFIED HEIGHT, which
	// is the accepted cost clause 2 names — not a leak that grows with the run.
	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM price_poll_anchors WHERE engine = $1`, testPollEngine).Scan(&n))
	require.Equal(t, pollAnchorRetention+1, n,
		"the ordinary bound still holds for every unclassified height; the exemption adds one row")

	// AND THE EXEMPTION IS PERMANENT HERE, WHICH IS THE POINT RATHER THAN A GAP.
	//
	// Wave 7 argued the exemption was SELF-LIMITING because a revalidation (or a fresh
	// observation) would clear the marker and hand the anchor back. D-012 clause 3
	// removed the revalidation, and the store itself shows why the remaining mechanism
	// cannot reach a height retention has already aged past: the ONLY thing that clears
	// a marker is a poll landing at that identity, and the cursor's monotonic guard
	// refuses a batch below the cursor. So for any height the head has passed, the
	// classification — and the anchor clause 2 keeps with it — is permanent by
	// construction.
	//
	// Asserted rather than reasoned, because this is precisely the claim wave 7 got
	// wrong by asserting the reachable case and generalising it.
	_, err = s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(1, 0xAA, testPollSource, 1_000_000, 6),
	}, 1, anchorAt(1))
	require.ErrorIs(t, err, ErrDeriveCursorRegression,
		"a poll cannot land at a past height, so the supersede arm cannot reach this row: D-012 clause 3's permanence is a property of the cursor guard, not a policy")

	// The release path IS reachable while the head is still at the classified height —
	// the shallow-reorg shape — and that is where the exemption gives the anchor back.
	// TestFreshObservationSupersedesANeutralizedRow pins the supersede itself; here it
	// is enough that the exemption is keyed on the ROW's marker, so nothing about the
	// anchor makes it sticky.
	valid, reason := invalidReasonAt(t, s, 10, 0xAA, testPollSource, 1)
	require.False(t, valid)
	require.Equal(t, InvalidReasonUnverifiableReorg, reason,
		"the row is still classified, which is what holds its anchor exempt")
}

// THE SAME EXEMPTION, THROUGH THE BINDING CLAUSE — the arm the test above cannot
// reach, because there the marked row sits at its anchor's own height and either
// clause would spare it.
//
// ApplyPolledPrices accepts observations BELOW throughBlock, so a round executing at
// B may stamp a row at some lower height. That row's provenance is the anchor at B,
// and NO marked row sits at B at all. prunePollAnchorsQuery's height clause is blind
// to it; only its anchor_block clause keeps the anchor alive. Without this test the
// clause is unprotected, and D-012 clause 2's "no retention bound may expire it" holds
// for the easy arrangement and quietly fails for the legal one — which is exactly the
// shape round 9 found in RewindPrices' sweep. (Found by wave 12's mutation loop: M9
// survived until this test existed.)
func TestPollAnchorRetentionExemptsTheAnchorAMarkedRowIsBoundTo(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// A round executing at 10 that stamps its observation at 5. The row is bound to
	// 10; nothing is ever written at height 10.
	const execBlock, obsBlock = uint64(10), uint64(5)
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(obsBlock, 0xAA, testPollSource, 1_000_000, 6),
	}, execBlock, anchorAt(execBlock))))
	require.EqualValues(t, execBlock, *anchorBindingAt(t, s, 10, 0xAA, testPollSource, obsBlock))

	// A repair marks it. The boundary sits below the row, above nothing else.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, obsBlock-1, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, execBlock, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked)

	// Then a long, healthy run pushes the anchor at 10 far past the retention window.
	total := uint64(pollAnchorRetention + 40)
	for i := execBlock + 1; i <= total; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, i, anchorAt(i))))
	}

	require.Contains(t, anchorBlocks(t, s, testPollEngine), execBlock,
		"the anchor a marked row is BOUND to outlives retention, even though no marked row sits at its height")
	// And the binding is not left dangling — the pair is what an offline reconciliation
	// would need, and half of it is worth nothing.
	require.EqualValues(t, execBlock, *anchorBindingAt(t, s, 10, 0xAA, testPollSource, obsBlock))

	// The cost is still bounded: exactly the retained window plus this one exempt row.
	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM price_poll_anchors WHERE engine = $1`, testPollEngine).Scan(&n))
	require.Equal(t, pollAnchorRetention+1, n,
		"one anchor row per classified round, which is the accepted cost clause 2 names — not a leak")
}

// The circularity gate this test guarded — never propose a NEUTRALIZED height as an
// adoption candidate — is gone with the query and the call it guarded (Codex round 9's
// [high] #2). It was a real hazard and the gate was correct; what removes it is that
// nothing can adopt an anchor at ANY height any more, marked or not. The structural
// proof lives in TestLegacyRowsHaveNoProvenanceAndTheStoreOffersNoWayToInventOne.

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
	require.Zero(t, exp.Unanchored, "the row's own round anchored it")

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

// testStaleBound is the collateral freshness bound these tests pass to
// SweepProgress. It is deliberately WIDE: the tests below are about generations,
// retry budgets and status transitions, and every success they write is seconds old,
// so a wide bound keeps the usability counts out of their way. The usability
// counting itself is pinned by its own tests, which drive the bound directly.
const testStaleBound = time.Hour

// SweepProgress reports the snapshotter's durable progress, which is the only way
// the daemon can see a SEMANTIC sweep stall: an all-endpoints-stale sweep refuses
// every batch, returns no error and advances nothing, and the snapshotter has no
// cursor in ingest_cursors or derive_cursors for the generic progress pass to watch.
func TestSweepProgressReportsDurableSweepState(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	_, found, err := s.SweepProgress(ctx, "debt_manager", testSweepBudget, testStaleBound)
	require.NoError(t, err)
	require.False(t, found, "an engine that has never opened a generation has not started, not stalled")

	gen, err := s.OpenSweepGeneration(ctx, "debt_manager")
	require.NoError(t, err)
	p, found, err := s.SweepProgress(ctx, "debt_manager", testSweepBudget, testStaleBound)
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
	p, _, err = s.SweepProgress(ctx, "debt_manager", testSweepBudget, testStaleBound)
	require.NoError(t, err)
	require.False(t, p.LastBatchAt.IsZero(), "the timestamp is the database's, so a restart cannot reset it")
	require.Zero(t, p.Lagging, "the only account is at the current generation")

	// A new generation makes it lag again, and completion closes the window.
	next, err := s.OpenSweepGeneration(ctx, "debt_manager")
	require.NoError(t, err)
	p, _, err = s.SweepProgress(ctx, "debt_manager", testSweepBudget, testStaleBound)
	require.NoError(t, err)
	require.Equal(t, int64(1), p.Lagging)
	_, stamped, err := s.CompleteSweepGeneration(ctx, "debt_manager", next)
	require.NoError(t, err)
	require.True(t, stamped)
	p, _, err = s.SweepProgress(ctx, "debt_manager", testSweepBudget, testStaleBound)
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

		p, _, err := s.SweepProgress(ctx, engine, testSweepBudget, testStaleBound)
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

	p, found, err := s.SweepProgress(ctx, engine, testSweepBudget, testStaleBound)
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
	p, _, err = s.SweepProgress(ctx, engine, testSweepBudget, testStaleBound)
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
