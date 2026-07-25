package store

// Live-database tests for the three storage contracts migration 00005 introduced:
// durable OWNERSHIP (rewind by the engine that wrote a row, not by a caller's
// current source list), the VALIDITY gate (a non-positive answer is recorded but
// can never be read as usable), and POLL ANCHORS (hash-verified reorg repair that
// deletes only what it cannot prove canonical).

import (
	"bytes"
	"context"
	"fmt"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// plainAnchors strips the database timestamps off read-back anchors so a test can
// compare them by identity.
func plainAnchors(in []StoredPollAnchor) []PollAnchor {
	out := make([]PollAnchor, 0, len(in))
	for _, a := range in {
		out = append(out, a.PollAnchor)
	}
	return out
}

// applyErr discards an apply's durable ApplyResult and returns only its error,
// for the many tests whose subject is the refusal (or the plain success) rather
// than what landed. The tests that ARE about the result read it directly — see
// TestApplyPricesReportsOnlyRowsItActuallyInserted.
func applyErr(_ ApplyResult, err error) error { return err }

// hash32 builds a distinct 32-byte block hash from one discriminating byte.
func hash32(b byte) []byte {
	h := bytes.Repeat([]byte{0x00}, 32)
	h[31] = b
	return h
}

// anchor is a PollAnchor at block with a hash derived from it.
func anchorAt(block uint64) PollAnchor {
	return PollAnchor{BlockNumber: block, BlockHash: hash32(byte(block))}
}

// ownerOf reads a row's recorded owner engine.
func ownerOf(t *testing.T, s *Store, chainID uint64, asset []byte, source string, block uint64) string {
	t.Helper()
	var owner string
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT owner_engine FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, asset, source, block).Scan(&owner))
	return owner
}

// validityOf reads a row's validity marker and reason.
func validityOf(t *testing.T, s *Store, chainID uint64, asset []byte, source string, block uint64) (bool, string) {
	t.Helper()
	var valid bool
	var reason string
	require.NoError(t, s.pool.QueryRow(context.Background(),
		`SELECT valid, invalid_reason FROM prices
		 WHERE chain_id = $1 AND asset = $2 AND source = $3 AND block_number = $4`,
		chainID, asset, source, block).Scan(&valid, &reason))
	return valid, reason
}

// ---------------------------------------------------------------------------
// Ownership.
// ---------------------------------------------------------------------------

// Every row records the engine that wrote it. Ownership comes from the applying
// engine, so a row cannot claim a writer that did not produce it.
func TestApplyPricesRecordsDurableOwner(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1,
		[]PriceObservation{po(100, 0xAA, testFeedSource, 99_990_000, 8)}, 100)))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, "prices:poll:1", 1,
		[]PriceObservation{po(120, 0xBB, testRatioSrc, 1, 18)}, 120)))

	require.Equal(t, testFeedEngine, ownerOf(t, s, 1, addr20(0xAA), testFeedSource, 100))
	require.Equal(t, "prices:poll:1", ownerOf(t, s, 1, addr20(0xBB), testRatioSrc, 120))
}

// A replay from a DIFFERENT engine under an existing key is a divergence, not an
// idempotent write: silently re-attributing a recorded fact's provenance would
// make ownership — and therefore repair — unreliable.
func TestApplyPricesRefusesReplayFromAnotherOwner(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1,
		[]PriceObservation{po(100, 0xAA, testFeedSource, 99_990_000, 8)}, 100)))
	_, err := s.ApplyPrices(ctx, "prices:poll:1", 1,
		[]PriceObservation{po(100, 0xAA, testFeedSource, 99_990_000, 8)}, 100)
	require.ErrorContains(t, err, "is owned by")
	require.ErrorContains(t, err, "aborting batch")
	require.Equal(t, testFeedEngine, ownerOf(t, s, 1, addr20(0xAA), testFeedSource, 100),
		"the original attribution stands")
}

// An engine name is required: it IS the durable owner, so an empty one would
// produce a row no rewind can find.
func TestApplyPricesRequiresEngine(t *testing.T) {
	s := testDeriveStore(t)
	_, err := s.ApplyPrices(context.Background(), "", 1,
		[]PriceObservation{po(100, 0xAA, testFeedSource, 1, 8)}, 100)
	require.ErrorContains(t, err, "engine is required")
}

// D-012 CLAUSE 1, AGAINST POSTGRES: THE STORE ITSELF REFUSES TO REWIND A POLL-OWNED
// ENGINE, and the refusal is on the IDENTITY rather than on the arguments.
//
// The clause: "the store must structurally reject RewindPrices for poll-owned
// engines (closes round 7's [medium] — the path the poller cannot reach but other
// store callers can)". D-010 expressed the same intent by leaving RewindPrices off
// the PollStore interface, which bounds internal/prices and nothing else; anything
// holding a *Store could still call it, and this repository's own tests did.
//
// TWO PROPERTIES, and the second is why the first matters. The call fails — and
// NOTHING it would otherwise have done happened: the rows above the target survive,
// the poll anchors survive (clause 2 forbids any store path expiring the anchor of a
// neutralized height, and this sweep has no such exemption), the cursor does not
// move, and the epoch stays unacknowledged. A refusal that had already deleted the
// anchors would satisfy the letter of clause 1 and defeat clause 2.
func TestRewindPricesRefusesAPollOwnedEngineAndChangesNothing(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// An anchored round, then a marked one — the exact state whose provenance clause 2
	// says no store path may expire.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(4900, 0xAA, testPollSource, 1_000_000, 6)}, 4900, anchorAt(4900))))
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(5000, 0xBB, testPollSource, 2_000_000, 6)}, 5000, anchorAt(5000))))
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4950, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 5000, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked)

	// A second epoch, so a rewind would have real work to do rather than being
	// vacuously harmless.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4800, []byte{0x02}))
	before := priceRows(t, s, 10)
	_, lastBefore, ackedBefore := cursorState(t, s, testPollEngine)

	err = s.RewindPrices(ctx, testPollEngine, 10, 5000, 0)
	require.ErrorIs(t, err, ErrPollOwnedRewindRefused,
		"the refusal is a contract a caller can assert on, not a message")
	require.ErrorContains(t, err, "NeutralizeUnverifiablePrices",
		"and it names the primitive this identity does have")

	require.Equal(t, before, priceRows(t, s, 10), "no row was deleted before the refusal")
	anchors, err := s.PollAnchorsBelow(ctx, testPollEngine, 10, 9000, 10)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{anchorAt(5000), anchorAt(4900)}, plainAnchors(anchors),
		"and NO anchor was deleted: the marked height's provenance is what D-012 clause 2 retains forever")
	_, lastAfter, ackedAfter := cursorState(t, s, testPollEngine)
	require.Equal(t, lastBefore, lastAfter, "the cursor did not move")
	require.Equal(t, ackedBefore, ackedAfter, "and the epoch was NOT acknowledged by a refused call")

	// IT IS THE IDENTITY, NOT THE ARGUMENTS. Every other shape of the same call is
	// refused identically — including the vacuous ones a caller might think are safe.
	for _, tc := range []struct {
		name                  string
		toBlock, verifiedFloo uint64
	}{
		{"target 0", 0, 0},
		{"target at the cursor", 4950, 0},
		{"with a verified floor", 5000, 4900},
	} {
		require.ErrorIs(t, s.RewindPrices(ctx, testPollEngine, 10, tc.toBlock, tc.verifiedFloo),
			ErrPollOwnedRewindRefused, tc.name)
	}
	// An engine whose key merely CONTAINS the namespace elsewhere is not poll-owned:
	// the discriminator is the prefix, matching how PollCursorEngine builds keys.
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 0, 0),
		"an event-derived identity still rewinds")
}

// A2 — THE PHASE-CHANGE-THEN-DEEP-REORG REGRESSION.
//
// The scenario in full: the feed deriver ingests aggregator A, Chainlink performs
// a phase change, an operator manually re-points the registry to aggregator B, and
// the deriver resumes under source "chainlink:B". Its currently loaded registry
// now names ONLY B. A later deep reorg crosses the phase boundary.
//
// Rewinding by the caller's current source list left every "chainlink:A" row above
// the effective target while the same transaction advanced acked_epoch — and once
// the epoch was pruned there was no trigger left to repair them, ever. Rewinding
// by OWNER deletes them, because the writer's engine key does not change when its
// registry does.
func TestRewindPricesDeletesRetiredPhaseRowsByOwner(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	const (
		oldAgg = "chainlink:0x1111111111111111111111111111111111111111"
		newAgg = "chainlink:0x2222222222222222222222222222222222222222"
	)

	// Phase 1: the deriver writes under the OLD aggregator.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1, []PriceObservation{
		po(100, 0xAA, oldAgg, 99_000_000, 8),
		po(150, 0xAA, oldAgg, 99_500_000, 8),
	}, 150)))
	// Phase 2, after the manual registry update: the SAME engine writes under the
	// NEW aggregator. Nothing in the registry names the old source any more.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1, []PriceObservation{
		po(200, 0xAA, newAgg, 100_000_000, 8),
	}, 200)))
	// Another writer on the same chain, which must be untouched.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, "prices:poll:1", 1,
		[]PriceObservation{po(210, 0xBB, testRatioSrc, 1_060_000_000_000_000_000, 18)}, 210)))

	// A DEEP reorg crossing the phase boundary, to block 120.
	require.NoError(t, s.Rewind(ctx, "eth:stream", 1, 120, []byte{0x78}))
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine, 1, 200, 0))

	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + oldAgg + "@100":       "99000000:8",
		"00000000000000000000000000000000000000bb/" + testRatioSrc + "@210": "1060000000000000000:18",
	}, priceRows(t, s, 1),
		"the RETIRED aggregator's row above 120 is deleted despite not appearing in any current registry, "+
			"and the other writer's row survives untouched")

	_, last, acked := cursorState(t, s, testFeedEngine)
	require.Equal(t, uint64(120), last)
	var maxEpoch int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT MAX(epoch) FROM reorg_epochs WHERE chain_id = 1`).Scan(&maxEpoch))
	require.Equal(t, maxEpoch, acked, "the ack still reaches the chain's max epoch, atomically")

	// And the epoch becomes prunable once the OTHER writer acks too. That writer is
	// poll-owned, so its ack cannot come from a rewind (D-012 clause 1): it comes from
	// NeutralizeUnverifiablePrices, which RETAINS its row above the target and marks it
	// (D-010 clause 1). The two writers therefore leave the table in different states
	// from the same epoch, which is the whole of the two-primitives split.
	_, marked, nerr := s.NeutralizeUnverifiablePrices(ctx, "prices:poll:1", 1, 210, 0)
	require.NoError(t, nerr)
	require.Equal(t, int64(1), marked)
	pruned, err := s.PruneAckedReorgEpochs(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(1), pruned)
	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + oldAgg + "@100":       "99000000:8",
		"00000000000000000000000000000000000000bb/" + testRatioSrc + "@210": "1060000000000000000:18",
	}, priceRows(t, s, 1),
		"the feed engine's unverifiable suffix was DELETED and the poll engine's was RETAINED-and-marked")
	valid, reason := validityOf(t, s, 1, addr20(0xBB), testRatioSrc, 210)
	require.False(t, valid)
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)
}

// ---------------------------------------------------------------------------
// Validity / quarantine.
// ---------------------------------------------------------------------------

// D1: a non-positive answer is RECORDED (refusing it would wedge a feed deriver
// on a log that already exists) and the cursor still advances — but it is marked
// invalid with a reason, so it is not an ordinary price.
func TestApplyPricesQuarantinesNonPositiveAnswers(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(200, 0xAA, testPollSource, 1_000_000, 6),
		po(200, 0xBB, testPollSource, 0, 6),
		po(200, 0xCC, testPollSource, -5, 6),
	}, 200)))

	valid, reason := validityOf(t, s, 10, addr20(0xAA), testPollSource, 200)
	require.True(t, valid)
	require.Empty(t, reason)
	for _, b := range []byte{0xBB, 0xCC} {
		valid, reason = validityOf(t, s, 10, addr20(b), testPollSource, 200)
		require.False(t, valid, "asset %x", b)
		require.Equal(t, "non-positive oracle answer", reason, "asset %x", b)
	}
	_, last, _ := cursorState(t, s, testPollEngine)
	require.Equal(t, uint64(200), last, "the cursor advances: quarantine never wedges ingestion")
	// The raw facts are still there verbatim, exactly as before.
	rows := priceRows(t, s, 10)
	require.Equal(t, "0:6", rows["00000000000000000000000000000000000000bb/priceproviderv2@200"])
	require.Equal(t, "-5:6", rows["00000000000000000000000000000000000000cc/priceproviderv2@200"])
}

// D1: the store-level latest-USABLE-price contract can never return a quarantined
// row — including when the quarantined row is the NEWEST one for its key, which is
// exactly the case a naive `ORDER BY block_number DESC LIMIT 1` gets wrong.
func TestLatestUsablePriceNeverReturnsQuarantinedRows(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6), // good
		po(200, 0xAA, testPollSource, 0, 6),         // NEWEST, and broken
		po(150, 0xBB, testPollSource, -7, 6),        // only ever broken
	}, 200)))

	// The newest row for 0xAA is the zero; the contract returns the newest USABLE
	// one instead of a price that would divide by zero downstream.
	got, found, err := s.LatestUsablePrice(ctx, 10, addr20(0xAA), testPollSource)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "1000000", got.Price.String())
	require.Equal(t, uint64(100), got.BlockNumber)
	require.Equal(t, int32(6), got.Decimals)
	require.Equal(t, testPollSource, got.Source)
	require.False(t, got.ObservedAt.IsZero())

	// A key whose ONLY rows are quarantined reports "no usable price", never a
	// poisoned one. A caller must handle absence; it can never be handed a zero.
	_, found, err = s.LatestUsablePrice(ctx, 10, addr20(0xBB), testPollSource)
	require.NoError(t, err)
	require.False(t, found)

	// An unknown key is simply absent.
	_, found, err = s.LatestUsablePrice(ctx, 10, addr20(0xEE), testPollSource)
	require.NoError(t, err)
	require.False(t, found)
}

// DOWNSTREAM INVARIANT: whatever the mix of recorded rows, the usable contract
// only ever yields strictly positive prices. Stated as a property over the whole
// table rather than over hand-picked keys.
func TestLatestUsablePriceIsAlwaysStrictlyPositive(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	var obs []PriceObservation
	for i := 0; i < 12; i++ {
		// Alternating good/zero/negative across blocks and assets.
		price := int64(1_000_000 + i)
		switch i % 3 {
		case 1:
			price = 0
		case 2:
			price = -int64(i)
		}
		obs = append(obs, po(uint64(100+i), byte(0xA0+i%4), testPollSource, price, 6))
	}
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, obs, 200)))

	for i := 0; i < 4; i++ {
		got, found, err := s.LatestUsablePrice(ctx, 10, addr20(byte(0xA0+i)), testPollSource)
		require.NoError(t, err)
		if !found {
			continue
		}
		require.Equal(t, 1, got.Price.Sign(),
			"asset %x: a usable price is strictly positive by construction", 0xA0+i)
	}

	// And nothing in the table can contradict the marker: the CHECK makes
	// "valid AND non-positive" unrepresentable.
	var bad int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM prices WHERE valid AND price <= 0`).Scan(&bad))
	require.Zero(t, bad)
	// Both ways of trying to promote a broken answer are refused by the schema:
	// flipping the marker alone leaves an incoherent reason, and clearing the
	// reason too runs straight into the positivity CHECK.
	_, err := s.pool.Exec(ctx, `UPDATE prices SET valid = true WHERE price <= 0`)
	require.ErrorContains(t, err, "prices_invalid_reason_iff_invalid")
	_, err = s.pool.Exec(ctx, `UPDATE prices SET valid = true, invalid_reason = '' WHERE price <= 0`)
	require.ErrorContains(t, err, "prices_valid_is_positive",
		"the storage layer refuses to let a broken answer be marked usable")
}

// ---------------------------------------------------------------------------
// Poll anchors.
// ---------------------------------------------------------------------------

// A polled round records its (block, hash) anchor in the SAME transaction as its
// rows and cursor move, so an anchor can never describe a round that did not
// commit.
func TestApplyPolledPricesAnchorsAtomically(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1_000_000, 6)}, 500, anchorAt(500))))
	anchors, err := s.PollAnchorsBelow(ctx, testPollEngine, 10, 500, 8)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{anchorAt(500)}, plainAnchors(anchors))
	require.False(t, anchors[0].ObservedAt.IsZero(), "a read-back anchor carries its database insertion time")

	// A batch that ROLLS BACK leaves no anchor: the round did not happen.
	_, err = s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(400, 0xAA, testPollSource, 2, 6)}, 400, anchorAt(400))
	require.ErrorIs(t, err, ErrDeriveCursorRegression)
	anchors, err = s.PollAnchorsBelow(ctx, testPollEngine, 10, 500, 8)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{anchorAt(500)}, plainAnchors(anchors), "the refused round anchored nothing")
}

// The anchor must describe the round it claims to: a hash of the wrong length, or
// a block other than the batch's through-block, is a caller error and is refused
// before anything is written.
func TestApplyPolledPricesValidatesAnchor(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	_, err := s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, 500,
		PollAnchor{BlockNumber: 500, BlockHash: []byte{0x01}})
	require.ErrorContains(t, err, "block hash is 1 bytes, want 32")

	_, err = s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, 500, anchorAt(499))
	require.ErrorContains(t, err, "must equal the batch through-block")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM price_poll_anchors`).Scan(&n))
	require.Zero(t, n, "validation runs before any write")
}

// Re-anchoring the same height with the SAME hash is idempotent; with a DIFFERENT
// hash it is ErrPollAnchorDivergence and the whole batch rolls back — the chain at
// that height changed, which is a reorg to be repaired, not a fact to overwrite.
func TestApplyPolledPricesAnchorDivergenceAbortsBatch(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1_000_000, 6)}, 500, anchorAt(500))))
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1_000_000, 6)}, 500, anchorAt(500))),
		"an identical replay is idempotent")

	_, err := s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xBB, testPollSource, 7, 6)}, 500,
		PollAnchor{BlockNumber: 500, BlockHash: hash32(0xFF)})
	require.ErrorIs(t, err, ErrPollAnchorDivergence)
	require.ErrorContains(t, err, "the chain at that height changed")
	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/priceproviderv2@500": "1000000:6",
	}, priceRows(t, s, 10), "the batch rolled back whole: the new row did not land")
}

// A1 CORE, on real storage: a verified floor RAISES the effective target above the
// walker's deepest unacknowledged rewind, so rows the caller has proven canonical
// survive while the unverified suffix is deleted — and the epoch ack is unchanged.
func TestRewindPricesVerifiedFloorRetainsProvenHistory(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	for _, b := range []uint64{4800, 4900, 5000} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10,
			[]PriceObservation{po(b, 0xAA, testFeedSource, int64(1_000_000+b), 8)}, b, anchorAt(b))))
	}
	// The walker's rewind reached a sparse-log ancestor far below: the degenerate
	// case that used to delete EVERY row above it.
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 100, []byte{0x64}))

	// The caller re-verified block 4900's hash against the live chain.
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 5000, 4900))

	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + testFeedSource + "@4800": "1004800:8",
		"00000000000000000000000000000000000000aa/" + testFeedSource + "@4900": "1004900:8",
	}, priceRows(t, s, 10),
		"provably-canonical history survives; only the unverified suffix above 4900 is deleted")

	_, last, acked := cursorState(t, s, testFeedEngine10)
	require.Equal(t, uint64(4900), last, "the cursor stops at the verified block, not at the walker's 100")
	var maxEpoch int64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT MAX(epoch) FROM reorg_epochs WHERE chain_id = 10`).Scan(&maxEpoch))
	require.Equal(t, maxEpoch, acked, "the epoch ack is unaffected by the floor")

	// The orphaned round's anchor is deleted with its rows: an anchor for history
	// that no longer exists must not be able to "verify" a later repair. This sweep
	// carries NO neutralized-height exemption, which is safe only because D-012
	// clause 1 keeps every poll-owned identity out of this call — see
	// TestRewindPricesRefusesAPollOwnedEngineAndChangesNothing.
	anchors, err := s.PollAnchorsBelow(ctx, testFeedEngine10, 10, 5000, 8)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{anchorAt(4900), anchorAt(4800)}, plainAnchors(anchors))
}

// A floor of 0 means "retain nothing above the walker's target", and this layer
// obeys it. That is a STORE contract test, not a description of the poller's
// posture: internal/prices.Poller no longer passes 0 when it merely failed to
// verify — it refuses to call this at all while it owns rows it cannot prove
// canonical, and passes 0 only when it owns nothing above the target. The
// destructive path still has to exist and still has to be exact, which is what
// this pins.
func TestRewindPricesWithZeroFloorDeletesEverythingAboveTheTarget(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	for _, b := range []uint64{4800, 4900, 5000} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10,
			[]PriceObservation{po(b, 0xAA, testFeedSource, int64(1_000_000+b), 8)}, b, anchorAt(b))))
	}
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 100, []byte{0x64}))
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 5000, 0))

	require.Empty(t, priceRows(t, s, 10))
	_, last, _ := cursorState(t, s, testFeedEngine10)
	require.Equal(t, uint64(100), last)
	anchors, err := s.PollAnchorsBelow(ctx, testFeedEngine10, 10, 5000, 8)
	require.NoError(t, err)
	require.Empty(t, anchors)
}

// A floor ABOVE the requested target is a caller bug: it would bless rows outside
// the cursor's coverage, which a later rewind targeting the cursor would then miss.
// Refused before anything is deleted or acked.
func TestRewindPricesRefusesFloorAboveTarget(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10,
		[]PriceObservation{po(500, 0xAA, testFeedSource, 1, 8)}, 500, anchorAt(500))))

	err := s.RewindPrices(ctx, testFeedEngine10, 10, 400, 500)
	require.ErrorContains(t, err, "verified floor 500 is above the requested target 400")
	require.Len(t, priceRows(t, s, 10), 1, "nothing was deleted before the refusal")
}

// A floor BELOW the walker's already-lowered target changes nothing: it can only
// ever raise the target, never lower it further.
func TestRewindPricesFloorNeverLowersTheTarget(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	for _, b := range []uint64{300, 400, 500} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10,
			[]PriceObservation{po(b, 0xAA, testFeedSource, int64(b), 8)}, b, anchorAt(b))))
	}
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 450, []byte{0x45}))

	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 500, 300))
	_, last, _ := cursorState(t, s, testFeedEngine10)
	require.Equal(t, uint64(450), last, "the walker's 450 already exceeds the floor and stands")
	require.Equal(t, map[string]string{
		"00000000000000000000000000000000000000aa/" + testFeedSource + "@300": "300:8",
		"00000000000000000000000000000000000000aa/" + testFeedSource + "@400": "400:8",
	}, priceRows(t, s, 10))
}

// Anchor retention is BOUNDED: growth is capped at pollAnchorRetention rows per
// engine, so a long-running poller cannot accumulate them without limit. Losing
// old anchors degrades repair depth; it never corrupts it.
func TestPollAnchorRetentionIsBounded(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Rounds beyond the retention bound, each anchoring one block.
	total := pollAnchorRetention + 25
	for i := 1; i <= total; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, uint64(i), anchorAt(uint64(i)))))
	}
	var n int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FROM price_poll_anchors WHERE engine = $1`, testPollEngine).Scan(&n))
	require.Equal(t, pollAnchorRetention, n, "retention caps anchor growth")

	var oldest, newest uint64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT min(block_number), max(block_number) FROM price_poll_anchors WHERE engine = $1`,
		testPollEngine).Scan(&oldest, &newest))
	require.Equal(t, uint64(total), newest, "the newest anchors are the ones kept")
	require.Equal(t, uint64(total-pollAnchorRetention+1), oldest)
}

// PollAnchorsBelow is descending, at-or-below-bounded, engine- and chain-scoped,
// and limit-bounded — the exact shape a PAGED repair walk needs: the caller lowers
// belowOrAt to just under the deepest anchor it has already probed and continues.
func TestPollAnchorsBelowOrderingAndScope(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	for _, b := range []uint64{100, 200, 300, 400} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, b, anchorAt(b))))
	}
	// A different engine on a different chain must not appear.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, "prices:poll:1", 1, nil, 350, anchorAt(350))))

	got, err := s.PollAnchorsBelow(ctx, testPollEngine, 10, 400, 2)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{anchorAt(400), anchorAt(300)}, plainAnchors(got),
		"newest first, at or below the given block, capped at the limit")

	// The paging step: resume just below the deepest anchor already probed.
	got, err = s.PollAnchorsBelow(ctx, testPollEngine, 10, 299, 2)
	require.NoError(t, err)
	require.Equal(t, []PollAnchor{anchorAt(200), anchorAt(100)}, plainAnchors(got),
		"the next page continues deeper instead of repeating the first")

	got, err = s.PollAnchorsBelow(ctx, testPollEngine, 10, 400, 0)
	require.NoError(t, err)
	require.Empty(t, got, "a non-positive limit reads nothing")

	got, err = s.PollAnchorsBelow(ctx, testPollEngine, 1, 400, 8)
	require.NoError(t, err)
	require.Empty(t, got, "the anchor is chain-scoped: this engine has none on chain 1")
}

// ---------------------------------------------------------------------------
// Per-asset freshness.
// ---------------------------------------------------------------------------

// LatestPriceFreshness reports the newest row per (asset, source) for ONE owner,
// including quarantined rows — reaching the oracle at all is one of the two things
// a health verdict needs — and never another owner's rows.
func TestLatestPriceFreshnessIsPerKeyAndOwnerScoped(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6),
		po(200, 0xAA, testPollSource, 1_000_100, 6), // newer for the same key
		po(150, 0xBB, testPollSource, 0, 6),         // quarantined, but still an observation
	}, 200)))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1,
		[]PriceObservation{po(300, 0xCC, testFeedSource, 5, 8)}, 300)))

	got, err := s.LatestPriceFreshness(ctx, 10, testPollEngine)
	require.NoError(t, err)
	byKey := map[string]uint64{}
	for _, f := range got {
		byKey[fmt.Sprintf("%x/%s", f.Asset, f.Source)] = f.BlockNumber
		require.False(t, f.ObservedAt.IsZero())
	}
	require.Equal(t, map[string]uint64{
		"00000000000000000000000000000000000000aa/" + testPollSource: 200,
		"00000000000000000000000000000000000000bb/" + testPollSource: 150,
	}, byKey, "newest per key, quarantined rows included, nothing from another owner or chain")

	other, err := s.LatestPriceFreshness(ctx, 10, testFeedEngine)
	require.NoError(t, err)
	require.Empty(t, other, "the feed engine owns nothing on chain 10")
}

// B-invalid AT THE STORE: freshness must report the newest row's VALIDITY and,
// separately, the newest VALID row. One timestamp that deliberately included
// quarantined rows is what let an oracle answering zero every interval stay
// "fresh" while no usable price existed.
func TestLatestPriceFreshnessSeparatesReachedFromUsable(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// 0xAA: a good answer, then zeros. 0xBB: only ever zeros.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6),
		po(200, 0xAA, testPollSource, 0, 6),
		po(200, 0xBB, testPollSource, 0, 6),
	}, 200)))

	byKey := map[string]PriceFreshness{}
	got, err := s.LatestPriceFreshness(ctx, 10, testPollEngine)
	require.NoError(t, err)
	for _, f := range got {
		byKey[fmt.Sprintf("%x", f.Asset)] = f
	}

	aa := byKey["00000000000000000000000000000000000000aa"]
	require.Equal(t, uint64(200), aa.BlockNumber, "the oracle was reached at 200")
	require.False(t, aa.Valid, "and what it said there is unusable")
	require.Equal(t, invalidReasonNonPositive, aa.InvalidReason)
	require.True(t, aa.HasValid)
	require.Equal(t, uint64(100), aa.ValidBlockNumber,
		"usable freshness stands at the last GOOD answer, which is what must age")
	require.True(t, aa.ValidObservedAt.Before(aa.ObservedAt) || aa.ValidObservedAt.Equal(aa.ObservedAt))

	bb := byKey["00000000000000000000000000000000000000bb"]
	require.Equal(t, uint64(200), bb.BlockNumber)
	require.False(t, bb.Valid)
	require.False(t, bb.HasValid, "a key that has NEVER had a usable price says so")
	require.Zero(t, bb.ValidBlockNumber)
}

// ---------------------------------------------------------------------------
// The durable-fact contract: what an apply actually did.
// ---------------------------------------------------------------------------

// PRINCIPLE 1 AT ITS SOURCE. An apply reports the rows it INSERTED with their
// database timestamps, and an idempotent replay reports NOTHING — the shape that
// makes it impossible for a frozen endpoint's same-height replay to refresh a
// caller's freshness.
func TestApplyPricesReportsOnlyRowsItActuallyInserted(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	obs := []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6),
		po(100, 0xBB, testPollSource, 0, 6), // quarantined
	}
	res, err := s.ApplyPrices(ctx, testPollEngine, 10, obs, 100)
	require.NoError(t, err)
	require.Len(t, res.Inserted, 2, "both rows are new durable facts")
	require.Equal(t, addr20(0xAA), res.Inserted[0].Asset)
	require.True(t, res.Inserted[0].Valid)
	require.Empty(t, res.Inserted[0].InvalidReason)
	require.False(t, res.Inserted[0].ObservedAt.IsZero(),
		"the timestamp comes from the database, not from a caller's clock")
	require.False(t, res.Inserted[1].Valid, "a quarantined insert is reported AS invalid")
	require.Equal(t, invalidReasonNonPositive, res.Inserted[1].InvalidReason)

	// THE FROZEN-ENDPOINT CASE: the identical batch replayed at the identical
	// through-block. It commits (the cursor guard permits equal heights) and
	// inserts nothing.
	res, err = s.ApplyPrices(ctx, testPollEngine, 10, obs, 100)
	require.NoError(t, err, "an identical replay is idempotent success")
	require.Empty(t, res.Inserted,
		"nothing new exists, so there is nothing a caller could use to refresh health")
}

// The anchor half of the same contract: a NEW execution block reports
// AnchorInserted with its database timestamp; replaying the same (block, hash)
// reports false. That flag is the durable answer to "is the chain we can see
// moving", which no replay can fabricate.
func TestApplyPolledPricesReportsAnchorInsertionOnlyOnce(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	res, err := s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1_000_000, 6)}, 500, anchorAt(500))
	require.NoError(t, err)
	require.True(t, res.AnchorInserted)
	require.Equal(t, uint64(500), res.AnchorBlock)
	require.False(t, res.AnchorObservedAt.IsZero())

	res, err = s.ApplyPolledPrices(ctx, testPollEngine, 10,
		[]PriceObservation{po(500, 0xAA, testPollSource, 1_000_000, 6)}, 500, anchorAt(500))
	require.NoError(t, err)
	require.False(t, res.AnchorInserted, "the same execution block is not a new observation")
	require.True(t, res.AnchorObservedAt.IsZero())
	require.Empty(t, res.Inserted)
}

// NewestPollAnchor is the durable reference a restarted poller hydrates its
// block-advance clock from, so a restart cannot grant a frozen chain view a fresh
// window.
func TestNewestPollAnchorCarriesItsDatabaseTimestamp(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	_, found, err := s.NewestPollAnchor(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.False(t, found, "an engine that has never anchored says so")

	for _, b := range []uint64{100, 200} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, b, anchorAt(b))))
	}
	got, found, err := s.NewestPollAnchor(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, anchorAt(200), got.PollAnchor)
	require.False(t, got.ObservedAt.IsZero())

	_, found, err = s.NewestPollAnchor(ctx, testPollEngine, 1)
	require.NoError(t, err)
	require.False(t, found, "chain-scoped")
}

// A1: repair must be able to ask whether an unverifiable rewind would actually
// destroy anything, because "nothing verified and nothing to lose" and "nothing
// verified and history at stake" have opposite correct answers.
func TestCountOwnedPricesAboveIsOwnerAndHeightScoped(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	n, err := s.CountOwnedPricesAbove(ctx, testPollEngine, 10, 0)
	require.NoError(t, err)
	require.Zero(t, n, "an engine with no rows can be rewound without losing anything")

	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1, 6),
		po(200, 0xAA, testPollSource, 2, 6),
	}, 200)))
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine, 1,
		[]PriceObservation{po(300, 0xCC, testFeedSource, 3, 8)}, 300)))

	n, err = s.CountOwnedPricesAbove(ctx, testPollEngine, 10, 0)
	require.NoError(t, err)
	require.Equal(t, int64(2), n)
	n, err = s.CountOwnedPricesAbove(ctx, testPollEngine, 10, 150)
	require.NoError(t, err)
	require.Equal(t, int64(1), n, "strictly above")
	n, err = s.CountOwnedPricesAbove(ctx, testPollEngine, 10, 200)
	require.NoError(t, err)
	require.Zero(t, n, "another owner's rows are not this engine's to lose")
}

// A1 (LEGACY POLICY): rows written before this engine anchored its rounds are
// reported as unanchored, and adoption records the anchor the round should have
// written — refusing a block this engine owns no row at, and refusing entirely
// while a reorg epoch is pending.
func TestUnanchoredPriceBlocksAndAnchorAdoption(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// Legacy shape: rows applied WITHOUT an anchor (the pre-anchor code path).
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(100, 0xAA, testPollSource, 1_000_000, 6),
		po(200, 0xAA, testPollSource, 1_000_100, 6),
	}, 200)))

	blocks, err := s.UnanchoredPriceBlocks(ctx, testPollEngine, 10, 8)
	require.NoError(t, err)
	require.Equal(t, []uint64{200, 100}, blocks, "newest first, so the useful floor is adopted first")

	adopted, err := s.AdoptPollAnchor(ctx, testPollEngine, 10, anchorAt(200))
	require.NoError(t, err)
	require.True(t, adopted)
	adopted, err = s.AdoptPollAnchor(ctx, testPollEngine, 10, anchorAt(200))
	require.NoError(t, err)
	require.False(t, adopted, "adoption is idempotent")

	blocks, err = s.UnanchoredPriceBlocks(ctx, testPollEngine, 10, 8)
	require.NoError(t, err)
	require.Equal(t, []uint64{100}, blocks)

	// It cannot fabricate an anchor for history this engine does not own.
	_, err = s.AdoptPollAnchor(ctx, testPollEngine, 10, anchorAt(150))
	require.ErrorContains(t, err, "owns no row there")

	// A divergent hash at an already-anchored height is still a divergence.
	_, err = s.AdoptPollAnchor(ctx, testPollEngine, 10,
		PollAnchor{BlockNumber: 200, BlockHash: hash32(0xFE)})
	require.ErrorIs(t, err, ErrPollAnchorDivergence)

	// THE LOAD-BEARING REFUSAL: adopting while a reorg epoch is unacknowledged
	// could record a REPLACEMENT block's hash at that height and let a later probe
	// "verify" rows describing the block the chain discarded.
	require.NoError(t, s.Rewind(ctx, "op:stream", 10, 50, []byte{0x32}))
	_, err = s.AdoptPollAnchor(ctx, testPollEngine, 10, anchorAt(100))
	require.ErrorIs(t, err, ErrUnackedReorgEpoch)
}

// A rewind removes the rows a freshness verdict was built from, so the read must
// stop reporting them — the reason workers re-hydrate after every rewind.
func TestLatestPriceFreshnessFollowsRewind(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(100, 0xAA, testFeedSource, 1_000_000, 8),
		po(200, 0xAA, testFeedSource, 1_000_100, 8),
	}, 200, anchorAt(200))))
	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 150, 0))

	got, err := s.LatestPriceFreshness(ctx, 10, testFeedEngine10)
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, uint64(100), got[0].BlockNumber, "the deleted newer row no longer counts")
}

// ---------------------------------------------------------------------------
// Publication-freshness hydration source.
// ---------------------------------------------------------------------------

// LatestLogsByTopic returns the newest matching log per address at or below the
// bound: the durable read a feed deriver hydrates publication freshness from, so a
// restart cannot reset an already-dead feed.
func TestLatestLogsByTopicNewestPerAddressBounded(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	topic := hash32(0xAB)
	other := hash32(0xCD)
	addrA := addr20(0x11)
	addrB := addr20(0x22)
	mk := func(block uint64, idx int32, addr, t0 []byte) RawLog {
		// A distinct tx hash per (block, index, address): the raw_logs PK is
		// (chain_id, tx_hash, log_index), so colliding hashes would be rejected as
		// divergent duplicates before this test could say anything useful.
		tx := hash32(byte(block))
		tx[30] = byte(idx)
		tx[29] = addr[19]
		return RawLog{
			ChainID: 1, BlockNumber: block, BlockHash: hash32(byte(block)),
			TxHash: tx, LogIndex: uint32(idx),
			Address: addr, Topics: [][]byte{t0}, Data: []byte{0x01},
		}
	}
	require.NoError(t, s.SaveBatch(ctx, "eth:stream", 1, []RawLog{
		mk(100, 0, addrA, topic),
		mk(200, 0, addrA, topic), // newest for A within the bound
		mk(200, 1, addrA, topic), // ... and the higher log index at that block wins
		mk(300, 0, addrA, topic), // above the bound
		mk(150, 0, addrB, topic),
		mk(250, 0, addrB, other), // wrong topic0: not a publication
	}, 300, hash32(0x99)))

	got, err := s.LatestLogsByTopic(ctx, 1, [][]byte{addrA, addrB}, topic, 250)
	require.NoError(t, err)
	require.Len(t, got, 2)
	byAddr := map[string]RawLog{}
	for _, l := range got {
		byAddr[fmt.Sprintf("%x", l.Address)] = l
	}
	a := byAddr[fmt.Sprintf("%x", addrA)]
	require.Equal(t, uint64(200), a.BlockNumber, "bounded by the through-block")
	require.Equal(t, uint32(1), a.LogIndex, "the last log in the block is the newest")
	require.Equal(t, uint64(150), byAddr[fmt.Sprintf("%x", addrB)].BlockNumber,
		"the wrong-topic log at 250 is not a publication")

	none, err := s.LatestLogsByTopic(ctx, 1, nil, topic, 250)
	require.NoError(t, err)
	require.Empty(t, none, "no addresses, no reads")
}

// A NUMERIC round-trip guard on the usable read: a large 18-decimal ratio comes
// back exactly, not through a float.
func TestLatestUsablePriceNumericRoundTrip(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()
	big18, ok := new(big.Int).SetString("1069123456789012345678", 10)
	require.True(t, ok)

	require.NoError(t, applyErr(s.ApplyPrices(ctx, "prices:poll:1", 1, []PriceObservation{{
		Asset: addr20(0xAA), Source: testRatioSrc, Price: big18, Decimals: 18, BlockNumber: 100,
	}}, 100)))
	got, found, err := s.LatestUsablePrice(ctx, 1, addr20(0xAA), testRatioSrc)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big18.String(), got.Price.String())
}
