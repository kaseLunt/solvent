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

// THE SAME ARRANGEMENT, ON THE READ SIDE — Codex round 9's [high] #1.
//
// Wave 10 bound provenance at WRITE time and converted exactly one reader: the
// neutralization split above. Every other consumer still joined an anchor to
// p.block_number, so the identical fixture — a NULL-bound row at H, an anchor at H
// written by a LATER round — was reported ANCHORED by the reads that decide what a
// repair may do. This drives all three of them against Postgres, plus the floor,
// because the floor is where the fabrication actually cashes out: a match at H used to
// bless the old observation and leave an orphan-fork price usable.
//
// The row is deliberately left UNMARKED here. A marked row is excluded from these
// reads by ADD-2 and would make every assertion below pass for the wrong reason.
func TestEveryRepairReadTreatsANullBoundRowAtAnAnchoredHeightAsUnprovable(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	const H = 5010
	// A properly anchored round below, whose row IS bound.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(5000, 0xAA, testPollSource, 1_000_000, 6),
	}, 5000, anchorAt(5000))))
	// The legacy row at H, and then a LATER, empty round anchoring H. Nothing in the
	// database records that this row's round ran at the block that anchor names — and
	// inferring it is the backfill migration 00007 prohibits.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(H, 0xBB, testPollSource, 2_000_000, 6),
	}, H)))
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, H, anchorAt(H))))
	require.Nil(t, anchorBindingAt(t, s, 10, 0xBB, testPollSource, H))

	// (a) CountUnanchoredPricesAbove — the read that forbids deleting above a floor.
	n, err := s.CountUnanchoredPricesAbove(ctx, testPollEngine, 10, 5000)
	require.NoError(t, err)
	require.Equal(t, int64(1), n,
		"the NULL-bound row above the floor is unprovable; the anchor at its height belongs to another round")
	n, err = s.CountUnanchoredPricesAbove(ctx, testPollEngine, 10, 4000)
	require.NoError(t, err)
	require.Equal(t, int64(1), n, "and the bound row at 5000 is NOT counted: its own round anchored it")

	// (b) PriceRepairExposure — the read repair actually decides on.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 4000, []byte{0x01}))
	exp, err := s.PriceRepairExposure(ctx, testPollEngine, 10, H)
	require.NoError(t, err)
	require.Equal(t, uint64(4000), exp.EffectiveTarget)
	require.Equal(t, int64(2), exp.Owned)
	require.Equal(t, int64(1), exp.Unanchored,
		"exposure counts the row's OWN binding, so a later round's anchor at its height cannot vouch for it")
	// AnchoredHeights used to be asserted here — 2 anchors above the target, alongside
	// 1 unanchored ROW. The two numbers were the height rule and the binding rule
	// sitting side by side in one struct, which is what made the field a misuse trap
	// with no production consumer; it is deleted (Codex round 10, residual (c)).

	// (c) THE FLOOR, WHICH IS WHERE THE FABRICATION CASHED OUT. Repair probes the
	// anchor at H, finds it canonical, and offers H as a verified floor. A match at H
	// proves the CHAIN at and below H is unchanged; it says nothing about a row whose
	// round never recorded which block it read. Under the old rule the row at H sat at
	// or below the floor and KEPT ITS VALIDITY — an orphan-fork price left usable on a
	// hash recorded for somebody else's round.
	boundary, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, H, H)
	require.NoError(t, err)
	require.Equal(t, uint64(H-1), boundary,
		"the floor is CLAMPED to just below the lowest unprovable row rather than admitted at its height")
	require.Equal(t, int64(1), marked,
		"and the row a floor may not vouch for is MARKED — under the height rule this call marked nothing at all")

	valid, reason := invalidReasonAt(t, s, 10, 0xBB, testPollSource, H)
	require.False(t, valid, "the NULL-bound row is unusable")
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)
	valid, _ = invalidReasonAt(t, s, 10, 0xAA, testPollSource, 5000)
	require.True(t, valid,
		"and the clamp is PRECISE, not a refusal to honour floors: the row whose own round anchored it keeps its validity")

	cursor, ok, err := s.DeriveCursor(ctx, testPollEngine)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, uint64(H-1), cursor, "the cursor stands at the boundary this call acted above")
}

// THE PROVENANCE PREDICATE IS CHAIN-SCOPED, AND ONLY THE PREDICATE CAN BE (Codex round
// 10, residual (b)). Every other fixture in this package runs on chain 10 alone, so a
// mutation dropping `a.chain_id = $1` from unprovableRow would have survived all of
// them — the wave-12 report said so and did not close it. This is the two-chain fixture
// that closes it.
//
// WHY THE TABLE CANNOT DO THIS JOB. 00005 keys price_poll_anchors by (engine,
// block_number); chain_id is a COLUMN, not part of the key. So the table itself permits
// one engine to carry anchors for more than one chain, and an anchor row found by
// (engine, block) alone is not necessarily a fact about the chain being read. The read
// is what has to ask.
//
// TWO ARMS, and the second is the one a mutation dies on:
//
//   - ORDINARY TWO-CHAIN OPERATION. Two chains, two engines, rows and anchors at the
//     SAME heights on both. Each chain's reads see only its own, which is the outer
//     scoping (p.chain_id) doing its job.
//   - A FOREIGN-CHAIN ANCHOR AT A BOUND HEIGHT. The row's binding names block 5000 and
//     the only anchor at 5000 for that engine belongs to another chain. With the clause,
//     the row is unprovable — correct, because nothing on THIS chain vouches for it.
//     Without the clause it reads as anchored, and a repair would treat another chain's
//     hash as this observation's provenance.
//
// The second arm is built with direct SQL, and that is stated rather than hidden: no
// writer produces it, because a poll engine's name embeds its chain and the derive
// cursor's chain binding refuses a second one. It is defence-in-depth on a predicate
// whose scoping the schema cannot enforce — the same posture as
// TestRewindAnchorSweepSparesNeutralizedHeightsEvenThoughNoCallerCanReachThatState.
func TestProvenanceReadsAreScopedToTheirOwnChain(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	const otherEngine = "prices:poll:999"

	// CHAIN 10: two ordinary anchored rounds.
	for _, b := range []uint64{5000, 6000} {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10,
			[]PriceObservation{po(b, 0xAA, testPollSource, int64(1_000_000+b), 6)}, b, anchorAt(b))))
	}
	// CHAIN 999: its own engine, its own round, at a height chain 10 also uses.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, otherEngine, 999,
		[]PriceObservation{po(5000, 0xAA, testPollSource, 2_000_000, 6)}, 5000, anchorAt(5000))))

	// ARM 1: ordinary operation. Every row on both chains is provable through its own
	// round's anchor, and neither chain's reads are disturbed by the other's rows.
	n, err := s.CountUnanchoredPricesAbove(ctx, testPollEngine, 10, 0)
	require.NoError(t, err)
	require.Zero(t, n, "chain 10's rows are all bound to anchors its own rounds wrote")
	n, err = s.CountUnanchoredPricesAbove(ctx, otherEngine, 999, 0)
	require.NoError(t, err)
	require.Zero(t, n, "and so are chain 999's")

	// ARM 2: the anchor engine 10 wrote at 5000 now belongs to another chain. Direct
	// SQL, because nothing in the running system can put it there.
	_, err = s.pool.Exec(ctx,
		`UPDATE price_poll_anchors SET chain_id = 999 WHERE engine = $1 AND block_number = 5000`,
		testPollEngine)
	require.NoError(t, err)

	n, err = s.CountUnanchoredPricesAbove(ctx, testPollEngine, 10, 4999)
	require.NoError(t, err)
	require.Equal(t, int64(1), n,
		"the row at 5000 is UNPROVABLE on chain 10: the only anchor at that block is another chain's, and a hash from another chain vouches for nothing here")

	// The row at 6000, whose anchor is still chain 10's, is untouched — so this is the
	// chain clause discriminating, not the read having stopped finding anchors at all.
	exp, err := s.PriceRepairExposure(ctx, testPollEngine, 10, 4999)
	require.NoError(t, err)
	require.Equal(t, int64(2), exp.Owned)
	require.Equal(t, int64(1), exp.Unanchored,
		"exactly one of the two rows lost its provenance, and it is the one whose anchor left the chain")

	// And chain 999's own read is unaffected: its row is still bound to its own
	// engine's anchor, which never moved.
	n, err = s.CountUnanchoredPricesAbove(ctx, otherEngine, 999, 0)
	require.NoError(t, err)
	require.Zero(t, n, "the clause scopes a read to its chain; it does not make everything unprovable")
}

// THE FRONTIER READ ASKS THE BINDING TOO — the last height-join consumer converted in
// wave 12, and the one the mutation loop caught untested (M12 survived until this
// existed).
//
// NewestPollAnchor answers "the newest round this engine still stands behind", and two
// consumers depend on that meaning: the block-advance health clock and the cursor
// regression classifier. A round that stamped its observation BELOW its own execution
// block, and whose row was then marked, is a round we do NOT stand behind — but no
// marked row sits at its anchor's height, so the height clause alone hands the anchor
// straight back as the frontier. The consequences are both wrong in the unsafe
// direction: a stale block-advance clock refreshed by a round that was repudiated, and
// a regression attributed against an anchor the repair already disowned.
//
// The height clause is KEPT alongside, and this test does not challenge it: it is the
// conservative one that protects pre-00007 marked rows, whose binding is NULL and
// whose height anchor may well be their genuine provenance. Both clauses only ever
// EXCLUDE, and for this read exclusion is always the safe direction.
func TestTheFrontierExcludesAnAnchorAMarkedRowIsBoundTo(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// A clean round: executes at 50, stamps at 40. Nothing here is ever marked, so
	// this anchor stays eligible and is what the frontier must fall back to.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(40, 0xAA, testPollSource, 1_000_000, 6),
	}, 50, anchorAt(50))))
	// The round under test: executes at 100, stamps at 90. Its row is bound to 100,
	// and NO row of any kind exists at height 100.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(90, 0xBB, testPollSource, 2_000_000, 6),
	}, 100, anchorAt(100))))
	require.EqualValues(t, 100, *anchorBindingAt(t, s, 10, 0xBB, testPollSource, 90))

	newest, found, err := s.NewestPollAnchor(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.True(t, found)
	require.EqualValues(t, 100, newest.BlockNumber, "before any marking, the newest round is the frontier")

	// A repair marks the row at 90 and nothing else.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, 80, []byte{0x01}))
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, 100, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked, "only the row above the walker's target")

	// THE PROPERTY. No marked row sits at height 100, so the height clause sees a clean
	// anchor there; the binding clause sees the round that was repudiated.
	newest, found, err = s.NewestPollAnchor(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.True(t, found, "the frontier falls back rather than disappearing — an engine with a usable older round still has one")
	require.EqualValues(t, 50, newest.BlockNumber,
		"the anchor of a round whose observations were marked is NOT the frontier, even though its own height carries no marked row")

	// And the repudiated anchor is still ON DISK — the frontier read excludes it, it
	// does not delete it (D-012 clause 2).
	require.Contains(t, anchorBlocks(t, s, testPollEngine), uint64(100))
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
//
// AND IT NOW DRIVES BOTH EXEMPTIONS, WHICH IS ROUND 9's [medium] #3. The sweep used to
// spare only an anchor at a marked row's OWN HEIGHT. ApplyPolledPrices legally accepts
// observations BELOW throughBlock, so a marked row's provenance may be an anchor at a
// different height entirely — and in that shape the old sweep retained the row and
// deleted its actual anchor, leaving anchor_block dangling. Clause 2 was satisfied for
// the easy arrangement and violated for the legal one; the third round of history at
// 5200/5150 below is the arrangement that shows it.
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
	// A round executing at 5200 that stamps an observation at 5150 — BELOW its own
	// execution block, which ApplyPolledPrices accepts. The row's provenance is the
	// anchor at 5200; there is no anchor at 5150 at all. ONLY THE BINDING CLAUSE can
	// spare 5200.
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(5150, 0xCC, testFeedSource, 500, 8),
	}, 5200, anchorAt(5200))))
	require.EqualValues(t, 5200, *anchorBindingAt(t, s, 10, 0xCC, testFeedSource, 5150),
		"the observation is bound to the block its ROUND executed at, not to its own height")
	// And the mirror shape: a PRE-00007 row — NULL binding — at a height that carries
	// an anchor written by a different, empty round. ONLY THE HEIGHT CLAUSE can spare
	// 5300, which is why both clauses are here and neither is redundant.
	require.NoError(t, applyErr(s.ApplyPrices(ctx, testFeedEngine10, 10, []PriceObservation{
		po(5300, 0xDD, testFeedSource, 600, 8),
	}, 5300)))
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testFeedEngine10, 10, nil, 5300, anchorAt(5300))))
	require.Nil(t, anchorBindingAt(t, s, 10, 0xDD, testFeedSource, 5300),
		"the legacy row's binding stays NULL even though an anchor now sits at its height")

	// THE DOOR WALKED AROUND: mark the rows at 5000, 5150 and 5300 directly.
	// NeutralizeUnverifiablePrices refuses this identity
	// (TestNeutralizeRefusesANonPollEngineAndChangesNothing), so no API sequence
	// produces this state. It is written here to drive the predicate.
	_, err := s.pool.Exec(ctx,
		`UPDATE prices SET valid = FALSE, invalid_reason = $1
		 WHERE chain_id = 10 AND owner_engine = $2 AND block_number IN (5000, 5150, 5300)`,
		InvalidReasonUnverifiableReorg, testFeedEngine10)
	require.NoError(t, err)

	require.NoError(t, s.RewindPrices(ctx, testFeedEngine10, 10, 4000, 0))

	// The marked rows are retained (that predicate was already there) AND so is every
	// anchor that records what a marked row's round executed against: 5000 by either
	// clause, 5200 by the BINDING clause alone (no marked row sits at 5200), 5300 by
	// the HEIGHT clause alone (the marked row there has no binding). 5100's round left
	// nothing marked, so its anchor goes — retention still works.
	require.Equal(t, []uint64{5000, 5200, 5300}, anchorBlocks(t, s, testFeedEngine10),
		"the anchor a marked row is BOUND to survives even though no marked row sits at its height, AND a pre-00007 marked row still protects the anchor at its height (D-012 clause 2: no store path may expire either)")
	valid, reason := invalidReasonAt(t, s, 10, 0xAA, testFeedSource, 5000)
	require.False(t, valid)
	require.Equal(t, InvalidReasonUnverifiableReorg, reason)

	// THE BINDING IS NOT LEFT DANGLING, which is the whole finding: the row still names
	// 5200, and 5200 is still on disk, so an offline reconciliation has the hash it
	// would need. A sweep that spared the row and dropped the anchor would have
	// destroyed exactly the provenance the retention exists for.
	require.EqualValues(t, 5200, *anchorBindingAt(t, s, 10, 0xCC, testFeedSource, 5150))
	require.Contains(t, anchorBlocks(t, s, testFeedEngine10), uint64(5200))
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
// THAT PATH IS GONE, AND THIS IS THE REGRESSION THAT REPLACES ITS TEST (Codex round
// 9's [high] #2). What follows is the exact cycle the finding describes, driven
// against Postgres: an ordinary anchored round, retention pruning its anchor, the
// chain changing at that height, and then a RESTART — which is what used to clear the
// poller's one-time adoption latch and start the whole thing again at cadence.
//
// The property is that nothing can put an anchor back at that height. Not adoption,
// which no longer exists; and not the one anchor writer that remains, because
// ApplyPolledPrices is refused below the cursor. So the row keeps its binding, the
// binding stays dangling, and the row stays UNPROVABLE — which is the honest state,
// and the one the fabricated re-adoption used to paper over with a replacement block's
// hash.
func TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart(t *testing.T) {
	s := testDeriveStore(t)
	ctx := context.Background()

	// An ordinary anchored round at 100: a row BOUND to the anchor it wrote. This is
	// post-00007 history with genuine provenance — not a legacy row.
	const H = 100
	require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, []PriceObservation{
		po(H, 0xAA, testPollSource, 1_000_000, 6),
	}, H, anchorAt(H))))
	require.EqualValues(t, H, *anchorBindingAt(t, s, 10, 0xAA, testPollSource, H))

	// Enough anchored rounds above it that retention actually bites.
	total := uint64(H + pollAnchorRetention + 25)
	for i := uint64(H + 1); i <= total; i++ {
		require.NoError(t, applyErr(s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, i, anchorAt(i))))
	}

	// (1) THE GENUINE ANCHOR IS GONE, AND THE BINDING SURVIVES IT. This is the state
	// UnanchoredPriceBlocks used to select for adoption, and the reason that selection
	// was wrong: the row is not legacy history missing an anchor, it is real history
	// whose anchor was deliberately expired.
	require.NotContains(t, anchorBlocks(t, s, testPollEngine), uint64(H),
		"retention expired the anchor, which is what it is for")
	require.EqualValues(t, H, *anchorBindingAt(t, s, 10, 0xAA, testPollSource, H),
		"the binding is not rewritten by a prune: it still NAMES the block, and the hash is simply no longer on disk")

	// (2) THE ROW IS UNPROVABLE, AND EVERY READ AGREES. A dangling binding is not a
	// weaker proof, it is no proof: the name survives and the fact does not.
	n, err := s.CountUnanchoredPricesAbove(ctx, testPollEngine, 10, H-1)
	require.NoError(t, err)
	require.Equal(t, int64(1), n, "a bound row whose anchor was pruned is unprovable")

	// (3) THE CHAIN MOVES AT THAT HEIGHT, AND THE EPOCH IS RECORDED. This is the
	// ordering the finding turns on: the hash changed BEFORE anything went looking for
	// a hash to adopt, so an adoption here would have recorded the REPLACEMENT block's.
	require.NoError(t, s.Rewind(ctx, "op:debt-manager", 10, H-1, []byte{0x01}))

	// (4) THE RESTART. In-process latches are gone with the process; what a restarted
	// writer can do is exactly what the store lets it do. The only remaining anchor
	// writer is ApplyPolledPrices, and the cursor's monotonic guard refuses it at a
	// height the cursor has passed — with a DIVERGENT hash, which is what makes this a
	// test about fabrication rather than about idempotency.
	_, err = s.ApplyPolledPrices(ctx, testPollEngine, 10, nil, H,
		PollAnchor{BlockNumber: H, BlockHash: hash32(0x99)})
	require.Error(t, err, "no path may re-anchor a height whose provenance retention removed")
	require.NotContains(t, anchorBlocks(t, s, testPollEngine), uint64(H),
		"and no anchor appeared there: the adopt/prune cycle cannot start")

	// (5) AND THE EPOCH IS STILL ANSWERABLE — deleting adoption did not re-open the
	// deadlock, because neutralization never needed it.
	rec := captureWarnAttrs(t)
	_, marked, err := s.NeutralizeUnverifiablePrices(ctx, testPollEngine, 10, total, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), marked, "the unprovable row is marked rather than blessed")
	unacked, err := s.HasUnackedReorg(ctx, testPollEngine, 10)
	require.NoError(t, err)
	require.False(t, unacked, "fail-closed must not mean fail-forever")

	// (6) AND THE OPERATOR REPORT DESCRIBES *THIS* ROW HONESTLY (Codex round 10's
	// [medium] #2). This fixture is the exact population the old text got wrong: the
	// round DID record a hash, retention expired it, and the binding still names the
	// block. Two claims were false for it — "the recorded block hash is retained
	// forever" (it is not; it is gone) and "no hash was ever recorded for these
	// heights" (one was, which is why a backup or WAL archive is a lead here and is
	// not for a NULL-bound row). The counts and the glosses now separate the two
	// causes, and neither promises retention for what this call marked.
	got := rec.find("rowsNeutralized")
	require.NotNil(t, got, "the classification is reported at all")
	require.Zero(t, got["rowsAnchored"],
		"no surviving anchor is linked to this observation, so it is not the anchored population")
	require.Equal(t, int64(1), got["rowsUnanchored"])
	require.Equal(t, int64(1), got["rowsUnanchoredBindingPruned"],
		"the cause is a binding whose anchor retention removed — the row is not legacy history")
	require.Zero(t, got["rowsUnanchoredNeverBound"],
		"and it must not be reported as a row that never recorded provenance: that would send a responder looking in the wrong place")
	require.NotContains(t, got["unanchoredMeans"], "no hash was ever recorded",
		"false for this row: its round recorded one and retention expired it")
	require.Contains(t, got["unanchoredMeans"], "no SURVIVING anchor is linked to the observation")
	require.Contains(t, got["unanchoredMeans"], "a hash WAS recorded and is no longer here",
		"the dangling half names what actually happened, which is the difference an offline responder acts on")
	require.NotContains(t, got["msg"], "provenance — the row, its value and the recorded block hash — is retained FOREVER",
		"the retired unconditional retention claim: this row's hash is already gone")
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
	dsn := destructiveTestDSN(t)
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
