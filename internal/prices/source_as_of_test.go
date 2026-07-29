package prices

// P3 Task 2 — adapter-output custody and the DURABLE TRUTHFUL AS-OF.
//
// Two claims are under test here, and they share a file because they are the
// same claim seen from two writers:
//
//   1. every price row records WHEN THE CHAIN SAID IT WAS TRUE (the pinned
//      block's header timestamp for a poll, AnswerUpdated.updatedAt for a feed),
//      never when this process happened to insert it;
//   2. the ETH round now also polls AaveOracle.getAssetPrice — the CAPPED price
//      the Aave pool charges against — inside the SAME round, the same
//      multicall, the same EIP-1898 pin and the same anchor as the weETH ratio.
//
// Every as-of test below is written so that the insertion clock and the chain
// clock are FAR APART, because an implementation that quietly derived one from
// the other would pass any test where they coincide.

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Poll side: the anchor block's own header timestamp.
// ---------------------------------------------------------------------------

// DELAYED INSERTION — the discriminating case. A round executes against a block
// whose header says 09:00; the row is written at 09:12. source_as_of must be
// 09:00, and it must be twelve minutes behind observed_at.
//
// The gap is what makes this falsifiable: an implementation stamping the row
// with a process clock, or with the store's insertion time, produces 09:12 and
// fails. The two clocks are driven independently on purpose — the header time
// lives on the fake CHAIN, the insertion time on the fake STORE.
func TestPollerStampsTheAnchorBlocksHeaderTimeNotTheInsertionTime(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	// The pinned block's header claims a time twelve minutes before the write.
	anchorTime := clk.now().Add(-12 * time.Minute).UTC()
	ch.setHeadTime(uint64(anchorTime.Unix()))

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	batch := st.lastBatch(t)
	require.Len(t, batch.obs, 20)
	for _, o := range batch.obs {
		require.True(t, anchorTime.Equal(o.SourceAsOf),
			"the as-of is the PINNED BLOCK's header timestamp: want %s, got %s", anchorTime, o.SourceAsOf)
	}

	// And it is durable, and distinct from insertion time by the full gap.
	require.NotEmpty(t, st.rows)
	for _, r := range st.rows {
		require.True(t, anchorTime.Equal(r.sourceAsOf), "stored row %s@%d", r.source, r.block)
		require.True(t, clk.now().Equal(r.observedAt), "observed_at is the DATABASE clock")
		require.Equal(t, 12*time.Minute, r.observedAt.Sub(r.sourceAsOf),
			"the two clocks must not be conflated — that conflation is what 00012 exists to stop")
	}
}

// The as-of is ROUND-SCOPED: one hash-pinned execution at one block means every
// row the round produced — across BOTH ETH mechanisms — carries that block's
// timestamp, and they all join the round's single anchor. One round, one anchor,
// one as-of, N sources.
func TestPollerAdapterAndRatioRowsShareOneRoundsAnchorAndAsOf(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 900, 5, 4_012_345_678)}
	ch.setHead(900)
	p, clk := newTestPoller(t, st, ch, 1)
	anchorTime := clk.now().Add(-90 * time.Second).UTC()
	ch.setHeadTime(uint64(anchorTime.Unix()))

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	batch := st.lastBatch(t)
	require.Len(t, batch.obs, 5, "the weETH ratio plus four adapter-output reads")
	sources := map[string]int{}
	for _, o := range batch.obs {
		require.True(t, anchorTime.Equal(o.SourceAsOf), "source %s", o.Source)
		require.Equal(t, uint64(900), o.BlockNumber)
		sources[o.Source]++
	}
	require.Equal(t, map[string]int{
		RatioSource("getRate()", weethETH):                      1,
		"aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f": 4,
	}, sources, "two mechanisms, each address-qualified to the contract it read")

	// ONE anchor for the whole round — no second anchor family was opened for
	// the new mechanism, which is what keeps reorg repair one protocol.
	require.NotNil(t, batch.anchor)
	require.Equal(t, uint64(900), batch.anchor.BlockNumber)
	require.Len(t, st.anchors[PollCursorEngine(1)], 1)
	require.Equal(t, uint64(900), st.anchors[PollCursorEngine(1)][0].BlockNumber)
	// And the whole round is bound to that one anchor as its provenance.
	for _, r := range st.rows {
		require.NotNil(t, r.anchorBlock)
		require.Equal(t, uint64(900), *r.anchorBlock)
	}
}

// A HEADER THAT NAMES NO USABLE TIME costs the as-of and nothing else: the
// prices still land, with their anchor and their cursor advance, and the as-of
// is ABSENT rather than fabricated from a process clock. A consumer then sees a
// missing input, which is the fail-closed direction; discarding a round of real
// oracle answers over a disclosure column would not be.
func TestPollerUnusableHeaderTimestampLeavesTheAsOfAbsent(t *testing.T) {
	for _, tc := range []struct {
		name string
		time uint64
	}{
		{"zero", 0},
		{"beyond int64", 1 << 63},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := newFakePriceStore()
			ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
			ch.setHead(5000)
			ch.setHeadTime(tc.time)
			p, _ := newTestPoller(t, st, ch, 10)

			advanced, err := p.Step(context.Background())
			require.NoError(t, err)
			require.True(t, advanced, "a malformed header timestamp must not discard a round of real prices")

			batch := st.lastBatch(t)
			require.Len(t, batch.obs, 20)
			for _, o := range batch.obs {
				require.True(t, o.SourceAsOf.IsZero(), "an unusable header time yields NO stamp, never a substituted one")
			}
			require.Equal(t, uint64(5000), st.cursor)
			require.Len(t, st.anchors[PollCursorEngine(10)], 1)
		})
	}
}

// ---------------------------------------------------------------------------
// Feed side: the aggregator's own updatedAt.
// ---------------------------------------------------------------------------

// A feed row's as-of is the answer's OWN updatedAt, decoded from the log — and
// again, deliberately far from both the insertion clock and the log's ingestion
// time, so nothing can be passing by coincidence.
func TestFeedDeriverStampsTheAnswersOwnUpdatedAt(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true

	usdcAt := clk.now().Add(-4 * time.Hour).UTC().Truncate(time.Second)
	weethAt := clk.now().Add(-11 * time.Minute).UTC().Truncate(time.Second)
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, uint64(usdcAt.Unix())),
		answerUpdatedLog(testFeedStart+20, 3, aggWeETH, big.NewInt(340_512_000_000), 2, uint64(weethAt.Unix())),
	}

	_, err := f.Step(context.Background())
	require.NoError(t, err)

	batch := st.lastBatch(t)
	require.Len(t, batch.obs, 2)
	require.True(t, usdcAt.Equal(batch.obs[0].SourceAsOf), "USDC: want %s, got %s", usdcAt, batch.obs[0].SourceAsOf)
	require.True(t, weethAt.Equal(batch.obs[1].SourceAsOf), "weETH: want %s, got %s", weethAt, batch.obs[1].SourceAsOf)
	// PER ROW, not per window: two answers published four hours apart land with
	// four hours between their as-ofs, even though one apply wrote them both.
	require.Equal(t, usdcAt.Add(4*time.Hour-11*time.Minute), weethAt)
	for _, r := range st.rows {
		require.False(t, r.sourceAsOf.IsZero())
		require.True(t, r.observedAt.After(r.sourceAsOf), "insertion follows publication")
	}
}

// ---------------------------------------------------------------------------
// The one-time healing pass.
// ---------------------------------------------------------------------------

// seedUnstampedFeedRow writes a durable feed row carrying NULL source_as_of —
// the pre-00012 population — directly into the fake's table, which is how such a
// row genuinely got there: an older binary wrote it.
func seedUnstampedFeedRow(st *fakePriceStore, engine string, asset common.Address, agg common.Address, block uint64, at time.Time) {
	st.rows = append(st.rows, fakeRow{
		owner: engine, asset: asset.Bytes(), source: ChainlinkSource(agg),
		block: block, observedAt: at, valid: true,
	})
}

// THE PASS FILLS EXACTLY THE NULLs IT OWNS, from the strict decoder's reading of
// the logs those rows came from — and nothing else moves: an already-stamped
// row keeps its stamp, another engine's rows are untouched, and no value
// changes.
func TestFeedHealFillsOnlyItsOwnUnstampedRows(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	engine := FeedCursorEngine(1)

	usdcAt := clk.now().Add(-5 * time.Hour).UTC().Truncate(time.Second)
	weethAt := clk.now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	alreadyAt := clk.now().Add(-99 * time.Hour).UTC().Truncate(time.Second)

	seedUnstampedFeedRow(st, engine, usdcETH, aggUSDC, testFeedStart+10, clk.now())
	seedUnstampedFeedRow(st, engine, weethETH, aggWeETH, testFeedStart+20, clk.now())
	// An already-stamped feed row. Its stamp is deliberately absurd — if the
	// pass overwrote stamps, this is where it would show.
	st.rows = append(st.rows, fakeRow{
		owner: engine, asset: usdcETH.Bytes(), source: ChainlinkSource(aggUSDC),
		block: testFeedStart + 30, observedAt: clk.now(), valid: true, sourceAsOf: alreadyAt,
	})
	// A POLL row, unstamped, at a block the pass will walk over. Poll history is
	// forward-only (migration 00012) and belongs to another engine entirely.
	st.rows = append(st.rows, fakeRow{
		owner: PollCursorEngine(1), asset: weethETH.Bytes(),
		source: RatioSource("getRate()", weethETH),
		block:  testFeedStart + 15, observedAt: clk.now(), valid: true,
	})

	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, uint64(usdcAt.Unix())),
		answerUpdatedLog(testFeedStart+20, 3, aggWeETH, big.NewInt(340_512_000_000), 2, uint64(weethAt.Unix())),
		answerUpdatedLog(testFeedStart+30, 0, aggUSDC, big.NewInt(100_010_000), 3, uint64(clk.now().Unix())),
	}

	filled, err := f.HealSourceAsOf(context.Background())
	require.NoError(t, err)
	require.EqualValues(t, 2, filled)

	byKey := map[string]fakeRow{}
	for _, r := range st.rows {
		byKey[r.owner+"|"+r.key()] = r
	}
	usdc := byKey[engine+"|"+rowKey(usdcETH, ChainlinkSource(aggUSDC), testFeedStart+10)]
	require.True(t, usdcAt.Equal(usdc.sourceAsOf))
	weeth := byKey[engine+"|"+rowKey(weethETH, ChainlinkSource(aggWeETH), testFeedStart+20)]
	require.True(t, weethAt.Equal(weeth.sourceAsOf))

	stamped := byKey[engine+"|"+rowKey(usdcETH, ChainlinkSource(aggUSDC), testFeedStart+30)]
	require.True(t, alreadyAt.Equal(stamped.sourceAsOf), "an existing stamp is never overwritten")

	poll := byKey[PollCursorEngine(1)+"|"+rowKey(weethETH, RatioSource("getRate()", weethETH), testFeedStart+15)]
	require.True(t, poll.sourceAsOf.IsZero(), "poll history stays NULL: forward-only, and not this engine's to touch")

	// No value column moved. The pass writes one column and the fake enforces it
	// no more than the real UPDATE does — so this is a real assertion.
	for _, r := range st.rows {
		require.True(t, r.valid)
		require.Empty(t, r.invalidReason)
	}

	// IDEMPOTENT: the second run finds nothing to do and reads no logs.
	st.rawLogsCalls = nil
	filled, err = f.HealSourceAsOf(context.Background())
	require.NoError(t, err)
	require.Zero(t, filled)
	require.Empty(t, st.rawLogsCalls, "an already-healed database costs one indexed count, not a log scan")
}

// TWO UPDATES IN ONE BLOCK — the edge the fold order exists for. The stored row
// holds the SECOND answer's value (priceSet is last-wins over ascending
// (block, log_index)), so its as-of must be the SECOND answer's updatedAt.
// A pass that took the first log in the block, or the largest updatedAt, would
// stamp the surviving value with a timestamp belonging to the overwritten one.
//
// The fixture makes those three candidate rules disagree deliberately: the
// later log carries the EARLIER updatedAt, so "last in block" and "largest
// timestamp" pick opposite witnesses.
func TestFeedHealPicksTheSameLastInBlockWitnessDerivationDid(t *testing.T) {
	ctx := context.Background()
	block := testFeedStart + 10
	first := time.Date(2026, 7, 24, 9, 0, 0, 0, time.UTC)
	second := first.Add(-30 * time.Second) // EARLIER, and it is the one that wins

	// (a) What DERIVATION produces for this block, through the ordinary path.
	stDerive := newFakePriceStore()
	chDerive := &fakeFeedChain{head: testFeedHead}
	fDerive, _ := newTestFeed(t, stDerive, chDerive, testFeedStart, testFeedFrontier)
	stDerive.cursor, stDerive.cursorFound = testFeedStart-1, true
	logs := []store.RawLog{
		answerUpdatedLog(block, 0, aggUSDC, big.NewInt(99_990_000), 1, uint64(first.Unix())),
		answerUpdatedLog(block, 1, aggUSDC, big.NewInt(100_010_000), 2, uint64(second.Unix())),
	}
	stDerive.logs = logs
	_, err := fDerive.Step(ctx)
	require.NoError(t, err)
	derived := stDerive.lastBatch(t)
	require.Len(t, derived.obs, 1, "one row per (asset, source, block)")
	require.Equal(t, "100010000", derived.obs[0].Price.String(), "the block ends at the later LOG")
	require.True(t, second.Equal(derived.obs[0].SourceAsOf))

	// (b) What HEALING produces for the same row, from the same logs.
	stHeal := newFakePriceStore()
	chHeal := &fakeFeedChain{head: testFeedHead}
	fHeal, clk := newTestFeed(t, stHeal, chHeal, testFeedStart, testFeedFrontier)
	stHeal.logs = logs
	seedUnstampedFeedRow(stHeal, FeedCursorEngine(1), usdcETH, aggUSDC, block, clk.now())

	filled, err := fHeal.HealSourceAsOf(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, filled)
	require.True(t, second.Equal(stHeal.rows[0].sourceAsOf),
		"the heal must pick the LAST log in the block — the one whose value survived — not the earliest log and not the largest timestamp")
	require.False(t, first.Equal(stHeal.rows[0].sourceAsOf))

	// The two paths agree, which is the property that actually matters: a healed
	// row is indistinguishable from a freshly-derived one.
	require.True(t, derived.obs[0].SourceAsOf.Equal(stHeal.rows[0].sourceAsOf))
}

// A row whose WITNESS NO LONGER EXISTS is left NULL, and that is not an error:
// NULL is the honest answer, and refusing to start over it would wedge
// ingestion on a provenance gap.
func TestFeedHealLeavesUnwitnessedRowsNullWithoutFailing(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	engine := FeedCursorEngine(1)

	usdcAt := clk.now().Add(-time.Hour).UTC().Truncate(time.Second)
	seedUnstampedFeedRow(st, engine, usdcETH, aggUSDC, testFeedStart+10, clk.now())
	seedUnstampedFeedRow(st, engine, weethETH, aggWeETH, testFeedStart+20, clk.now())
	// Only the first row's log survives.
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, uint64(usdcAt.Unix())),
	}

	filled, err := f.HealSourceAsOf(context.Background())
	require.NoError(t, err)
	require.EqualValues(t, 1, filled)
	require.True(t, usdcAt.Equal(st.rows[0].sourceAsOf))
	require.True(t, st.rows[1].sourceAsOf.IsZero(), "no witness, no stamp — never a guess")
}

// The pass is WIRED, runs ONCE per process, and its failure is LOUD. Wiring is
// asserted through Step rather than by calling the pass directly, because "the
// method exists" and "the daemon runs it" are different claims.
func TestFeedHealRunsOnceThroughStepAndPropagatesFailure(t *testing.T) {
	ctx := context.Background()

	t.Run("wired and once-only", func(t *testing.T) {
		st := newFakePriceStore()
		ch := &fakeFeedChain{head: testFeedHead}
		f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
		st.cursor, st.cursorFound = testFeedFrontier, true // caught up: no derivation work
		at := clk.now().Add(-3 * time.Hour).UTC().Truncate(time.Second)
		seedUnstampedFeedRow(st, FeedCursorEngine(1), usdcETH, aggUSDC, testFeedStart+10, clk.now())
		st.logs = []store.RawLog{
			answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, uint64(at.Unix())),
		}

		_, err := f.Step(ctx)
		require.NoError(t, err)
		require.True(t, at.Equal(st.rows[0].sourceAsOf), "an ordinary Step healed the legacy row")

		// A second Step does not re-run it: a NULL row seeded afterwards stays
		// NULL for this process, which is what "once at startup" means.
		seedUnstampedFeedRow(st, FeedCursorEngine(1), weethETH, aggWeETH, testFeedStart+20, clk.now())
		st.logs = append(st.logs,
			answerUpdatedLog(testFeedStart+20, 0, aggWeETH, big.NewInt(340_000_000_000), 2, uint64(at.Unix())))
		_, err = f.Step(ctx)
		require.NoError(t, err)
		require.True(t, st.rows[1].sourceAsOf.IsZero(), "the pass is once-per-process, not once-per-Step")
	})

	t.Run("failure is loud and not latched", func(t *testing.T) {
		st := newFakePriceStore()
		ch := &fakeFeedChain{head: testFeedHead}
		f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
		st.cursor, st.cursorFound = testFeedFrontier, true
		boom := errors.New("count refused")
		st.missingSpanErr = boom

		_, err := f.Step(ctx)
		require.ErrorIs(t, err, boom, "a heal failure surfaces as a Step error, into the daemon's backoff")

		// It did not mark itself done on the way out: once the store recovers,
		// the next Step heals.
		st.missingSpanErr = nil
		_, err = f.Step(ctx)
		require.NoError(t, err)
	})
}

// rowKey renders the fake table's row identity, matching fakeRow.key().
func rowKey(asset common.Address, source string, block uint64) string {
	return fakeRowKey(asset.Bytes(), source, block)
}
