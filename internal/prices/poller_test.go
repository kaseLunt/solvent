package prices

// Poller tests: request shape against the REAL registry, the per-asset failure
// posture, the cadence gate, the reorg-first ordering, the HASH-ANCHORED rewind
// (retain what is provably canonical, discard only the unverified suffix), the
// PER-ASSET durable health surface, and the cause-classified endpoint routing
// (reorg vs frozen endpoint vs undetermined).

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// newTestPoller builds a Poller on the REAL registry with an injected clock
// shared by the poller AND the fake store (whose observed_at stands in for the
// database clock, which durable freshness is measured against).
func newTestPoller(t *testing.T, st *fakePriceStore, ch *fakePollChain, chainID uint64) (*Poller, *testClock) {
	t.Helper()
	p, err := NewPoller(st, ch, realFeeds(t), PollerConfig{
		ChainID: chainID, Interval: time.Minute,
	})
	require.NoError(t, err)
	clk := newTestClock()
	p.now = clk.now
	p.startedAt = clk.now()
	st.now = clk.now
	if ch.hashes == nil {
		ch.hashes = map[uint64]common.Hash{}
	}
	return p, clk
}

// okRound answers every call in a round successfully with price.
func okRound(t *testing.T, block uint64, targets int, price int64) func(int, common.Address, []byte) ([]byte, error) {
	return func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, targets)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(price))}
		}
		return encodeMulticall(t, block, rets), nil
	}
}

// canonicalAt makes the fake chain agree that block carries its standard hash —
// the "our frontier is still canonical" world, in which a cursor regression IS
// attributable to the endpoint that served it.
func canonicalAt(ch *fakePollChain, blocks ...uint64) {
	if ch.hashes == nil {
		ch.hashes = map[uint64]common.Hash{}
	}
	for _, b := range blocks {
		ch.hashes[b] = blockHashAt(b)
	}
}

// pollConditions indexes a poller's conditions by name.
func pollConditions(p *Poller) map[string]string {
	out := map[string]string{}
	for _, c := range p.Conditions() {
		out[c.Name] = c.Reason
	}
	return out
}

// A round is exactly ONE multicall3 tryBlockAndAggregate, requireSuccess=false,
// every call targeting the registry's PriceProviderV2 with price(asset)
// calldata, in registry order.
func TestPollerRoundRequestShape(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, ch.calls, 1, "one multicall per round: every row is as-of one block")
	require.Equal(t, Multicall3Address, ch.calls[0].to)

	requireSuccess, calls := decodeMulticallCalls(t, ch.calls[0].data)
	require.False(t, requireSuccess, "one broken oracle must not fail the round")
	require.Len(t, calls, 20)

	wantAssets := realFeeds(t).PollAssets(10)
	require.Len(t, wantAssets, 20)
	for i, c := range calls {
		require.Equal(t, priceProviderV2, c.Target, "call %d targets PriceProviderV2", i)
		want, err := priceProviderABI.Pack("price", wantAssets[i].Address)
		require.NoError(t, err)
		require.Equal(t, want, c.CallData, "call %d prices %s in registry order", i, wantAssets[i].Symbol)
	}
}

// Observations carry the multicall's EXECUTION block, the mechanism source and
// the registry scale; the batch's through-block is that same block.
func TestPollerRecordsObservations(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	batch := st.lastBatch(t)
	require.Equal(t, PollCursorEngine(10), batch.engine)
	require.Equal(t, uint64(10), batch.chainID)
	require.Equal(t, uint64(5000), batch.through)
	require.Len(t, batch.obs, 20)
	for _, o := range batch.obs {
		require.Equal(t, SourcePriceProviderV2, o.Source)
		require.Equal(t, int32(6), o.Decimals)
		require.Equal(t, uint64(5000), o.BlockNumber)
		require.Equal(t, "1000000", o.Price.String())
		require.Len(t, o.Asset, 20)
	}
	require.Equal(t, uint64(5000), st.cursor)
}

// A1: every landed round persists its EXECUTION (block, hash) as a durable poll
// anchor, in the same call as its rows — the anchor is what makes a later rewind
// able to prove which history is still canonical.
func TestPollerRoundPersistsHashAnchor(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	batch := st.lastBatch(t)
	require.NotNil(t, batch.anchor, "a poll round must anchor itself")
	require.Equal(t, uint64(5000), batch.anchor.BlockNumber, "the anchor is the round's execution block")
	require.Equal(t, blockHashAt(5000).Bytes(), batch.anchor.BlockHash,
		"the anchor carries the hash multicall3 returned, which the decoder used to discard")
	require.Len(t, st.anchors[PollCursorEngine(10)], 1)
	require.Equal(t, store.PollAnchor{BlockNumber: 5000, BlockHash: blockHashAt(5000).Bytes()},
		st.anchors[PollCursorEngine(10)][0].PollAnchor)
}

// The ETH poller's only obligation is the weETH getRate() ratio — recorded as
// its OWN row at 18 decimals, never composed with the stream price.
func TestPollerETHRatioRow(t *testing.T) {
	st := newFakePriceStore()
	rate := new(big.Int)
	rate.SetString("1069000000000000000", 10)
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		return encodeMulticall(t, 900, []mcRet{{Success: true, ReturnData: encodeUint256(t, rate)}}), nil
	}}
	p, _ := newTestPoller(t, st, ch, 1)

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	_, calls := decodeMulticallCalls(t, ch.calls[0].data)
	require.Len(t, calls, 1)
	require.Equal(t, weethETH, calls[0].Target, "getRate() is read on the weETH contract itself")
	wantData, err := rateProviderABI.Pack("getRate")
	require.NoError(t, err)
	require.Equal(t, wantData, calls[0].CallData)

	batch := st.lastBatch(t)
	require.Len(t, batch.obs, 1)
	require.Equal(t, weethETH.Bytes(), batch.obs[0].Asset)
	require.Equal(t, RatioSource("getRate()", weethETH), batch.obs[0].Source)
	require.Equal(t, int32(18), batch.obs[0].Decimals)
	require.Equal(t, rate.String(), batch.obs[0].Price.String())
}

// An individual revert is a per-asset skip, not a round failure: the other 19
// assets still get their prices.
func TestPollerRevertIsPerAsset(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		rets[3] = mcRet{Success: false} // one broken oracle
		return encodeMulticall(t, 5000, rets), nil
	}}
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.lastBatch(t).obs, 19, "the reverting asset is skipped, the rest land")
	require.True(t, containsSubstring(*msgs, "oracle read reverted"))
}

// A well-formed envelope carrying an UNDECODABLE inner return is the same
// per-asset posture as a revert — the round must not lose 19 good prices to one
// malformed one.
func TestPollerUndecodableInnerReturnIsPerAsset(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		rets[7] = mcRet{Success: true, ReturnData: []byte{0x01, 0x02}} // short word
		return encodeMulticall(t, 5000, rets), nil
	}}
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, st.lastBatch(t).obs, 19)
	require.True(t, containsSubstring(*msgs, "oracle return did not decode"))
}

// Every oracle failing is DEGRADED but still applies: the cursor is a reorg-ack
// anchor, and stalling it would wedge the epoch gate on an oracle outage.
func TestPollerAllFailedStillAdvancesCursor(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: false}
		}
		return encodeMulticall(t, 5000, rets), nil
	}}
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Empty(t, st.lastBatch(t).obs)
	require.Equal(t, uint64(5000), st.lastBatch(t).through)
	require.True(t, containsSubstring(*msgs, "every oracle read failed"))
}

// B1 (ALL TARGETS, MULTIPLE INTERVALS): an empty batch advances the cursor but is
// NOT a landed round. Health must therefore FAIL once the grace window passes,
// where the old round-level anchor kept it green forever with no price recorded.
func TestPollerHealthFailsWhenEveryOracleKeepsFailing(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1}
	block := uint64(5000)
	ch.respond = func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: false}
		}
		return encodeMulticall(t, block, rets), nil
	}
	p, clk := newTestPoller(t, st, ch, 10)

	// Four consecutive intervals in which every oracle reverts.
	for i := 0; i < 4; i++ {
		advanced, err := p.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced, "the cursor still advances for the epoch ack")
		block += 100
		clk.advance(time.Minute)
	}
	require.Equal(t, uint64(5300), st.cursor, "cursor moved every round")

	healthy, reason := p.Health()
	require.False(t, healthy, "no price was ever recorded: health must not be green")
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRound, "the round-level condition names the total outage")
	require.Contains(t, got, ConditionPollTargetFreshness, "and every asset is individually unpriced")
	require.Contains(t, reason, "never priced")
}

// B1 (SINGLE TARGET, MULTIPLE INTERVALS): one asset failing while the others
// succeed was invisible — rounds kept committing, so the round anchor stayed
// fresh. Per-asset freshness catches it and NAMES the asset.
func TestPollerHealthFailsForOneStaleAssetWhileOthersLand(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1}
	block := uint64(5000)
	ch.respond = func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		rets[2] = mcRet{Success: false} // weETH: the third registry asset on OP
		return encodeMulticall(t, block, rets), nil
	}
	p, clk := newTestPoller(t, st, ch, 10)

	for i := 0; i < 5; i++ {
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		block += 100
		clk.advance(time.Minute)
	}

	healthy, reason := p.Health()
	require.False(t, healthy, "one asset has had no price for five intervals")
	got := pollConditions(p)
	require.NotContains(t, got, ConditionPollRound, "rounds ARE landing: this is a partial failure, not an outage")
	require.Contains(t, got, ConditionPollTargetFreshness)
	broken := realFeeds(t).PollAssets(10)[2]
	require.Contains(t, reason, broken.Symbol)
	require.Contains(t, reason, broken.Address.Hex())
	require.Contains(t, got[ConditionPollTargetFreshness], "1 of 20 registry assets")
}

// B1/B2 CLASS (RESTART): a poller that comes up with a STALE durable row must not
// measure that asset from its own start time. Freshness is hydrated from the
// rows, so an asset last priced long ago is unhealthy immediately — no fresh
// grace window per restart.
func TestPollerHydratesStaleFreshnessAcrossRestart(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	// A previous process priced every asset, but one of them last landed hours
	// ago while the rest are current.
	assets := realFeeds(t).PollAssets(10)
	for i, a := range assets {
		at := clk.now()
		if i == 4 {
			at = clk.now().Add(-6 * time.Hour)
		}
		st.seedRow(PollCursorEngine(10), a.Address.Bytes(), SourcePriceProviderV2, 4900, at)
	}
	st.cursor, st.cursorFound = 4900, true
	// Make the round NOT due so only hydration can act.
	p.lastAttempt = clk.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "no round was due")
	require.Equal(t, 1, st.freshnessCalls, "freshness was hydrated from durable rows")

	healthy, reason := p.Health()
	require.False(t, healthy, "a restart must not reset an asset that has been stale for hours")
	require.Contains(t, reason, assets[4].Symbol)
	require.Contains(t, pollConditions(p), ConditionPollTargetFreshness)
	require.NotContains(t, reason, assets[0].Symbol, "the current assets are not implicated")
}

// A hydration FAILURE must degrade to an explicitly untrusted verdict, never to
// green: an unhydrated poller knows nothing about per-asset freshness.
func TestPollerUnhydratedFreshnessFailsClosed(t *testing.T) {
	st := newFakePriceStore()
	st.freshnessErr = errors.New("database unreachable")
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.ErrorContains(t, err, "hydrate durable price state")

	healthy, _ := p.Health()
	require.True(t, healthy, "inside the grace window an unhydrated poller is just starting up")

	clk.advance(time.Duration(pollHealthGrace)*time.Minute + time.Second)
	healthy, reason := p.Health()
	require.False(t, healthy)
	require.Contains(t, pollConditions(p), ConditionPollFreshnessUnhydrated)
	require.Contains(t, reason, "no freshness verdict can be trusted")
}

// The cadence gate: a second Step inside the interval issues no RPC at all.
func TestPollerCadenceGate(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "not due")
	require.Len(t, ch.calls, 1, "no RPC while the cadence slot is unspent")

	clk.advance(time.Minute)
	ch.respond = okRound(t, 5100, 20, 1_000_001)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, ch.calls, 2)
	require.Equal(t, uint64(5100), st.lastBatch(t).through)
}

// A FAILED round consumes its cadence slot too, so a broken poller cannot hammer
// RPC once per daemon tick.
func TestPollerFailedRoundConsumesCadenceSlot(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		return nil, errors.New("transport boom")
	}}
	p, clk := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.ErrorContains(t, err, "transport boom")
	require.Len(t, ch.calls, 1)

	_, err = p.Step(context.Background())
	require.NoError(t, err, "the slot is spent: the round is simply not due")
	require.Len(t, ch.calls, 1, "no second RPC inside the interval")

	clk.advance(time.Minute)
	_, err = p.Step(context.Background())
	require.Error(t, err)
	require.Len(t, ch.calls, 2)
}

// A malformed multicall ENVELOPE is a round-level error: nothing is applied.
func TestPollerMalformedEnvelopeIsRoundError(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		return []byte{0xde, 0xad, 0xbe, 0xef}, nil
	}}
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.Error(t, err)
	require.False(t, advanced)
	require.Empty(t, st.applied, "nothing reached the store")
}

// Reorg coordination runs BEFORE the cadence gate: a durable epoch must be
// acknowledged whether or not a round is due, because ApplyPrices refuses every
// batch until it is.
func TestPollerReorgAnsweredBeforeCadenceGate(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = 4000, true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)
	// Make the round NOT due, so only the reorg leg can act.
	p.lastAttempt = p.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "a rewind is progress")
	require.Len(t, st.rewinds, 1)
	require.Empty(t, ch.calls, "no poll happened: the round was not due")

	r := st.rewinds[0]
	require.Equal(t, PollCursorEngine(10), r.engine)
	require.Equal(t, uint64(10), r.chainID)
	require.Equal(t, uint64(4000), r.toBlock, "rewind targets the poller's OWN cursor")
}

// A1 CORE: with a hash-verified poll anchor, a rewind retains everything at or
// below it and deletes only the unverified suffix — even though the walker's
// target would have taken the cursor far deeper. A hash match at H proves H and
// every ancestor are unchanged.
func TestPollerRewindRetainsRowsBelowVerifiedAnchor(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	// Durable history: three landed rounds, each with its anchor and a row.
	for _, b := range []uint64{4800, 4900, 5000} {
		st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, clk.now())
		st.seedAnchor(engine, b, blockHashAt(b))
	}
	st.cursor, st.cursorFound = 5000, true
	// The walker's rewind reached all the way down to a sparse-log ancestor: the
	// degenerate case that used to delete EVERY polled row.
	deep := uint64(100)
	st.rewindDeepTo = &deep
	// The live chain still carries 4900 and 4800; 5000 was replaced.
	canonicalAt(ch, 4800, 4900)
	ch.hashes[5000] = common.HexToHash("0xdead")
	st.unacked = true
	p.lastAttempt = clk.now() // not due: isolate the rewind
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	require.Len(t, st.rewinds, 1)
	require.Equal(t, uint64(5000), st.rewinds[0].toBlock, "the poller asked for its own cursor")
	require.Equal(t, uint64(4900), st.rewinds[0].verifiedFloor,
		"the highest anchor whose hash still matches is the floor")
	require.Equal(t, uint64(4900), st.cursor, "the cursor stops at the verified block, not at the walker's 100")

	var blocks []uint64
	for _, r := range st.rows {
		blocks = append(blocks, r.block)
	}
	require.ElementsMatch(t, []uint64{4800, 4900}, blocks,
		"provably-canonical polled history survives; only the orphaned round is deleted")
	require.True(t, containsSubstring(*msgs, "HASH-VERIFIED poll anchor"))
	require.True(t, containsSubstring(*msgs, "poll anchor is ORPHANED"), "the replaced round is named")
	// Probes walk down from the newest anchor and stop at the first match.
	require.Equal(t, []uint64{5000, 4900}, ch.hashCalls)
}

// A1, THE CORE FAIL-CLOSED PROPERTY. When anchor verification is UNAVAILABLE —
// here a transient hash-probe outage — repair must not ack the epoch and must not
// delete a row.
//
// This test replaces one that asserted the opposite. Wave 1 committed a test
// confirming that a transient probe outage left polled history EMPTY, documenting
// irreversible data loss as expected behaviour. Polled prices cannot be re-polled
// (this path only reads `latest`), so a stalled poller is recoverable and erased
// canonical history is not: the refusal is the correct outcome, and the previous
// assertion was encoding the bug.
func TestPollerRewindRefusesWhenAnchorVerificationIsUnavailable(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	ch.hashErr = errors.New("probe endpoint unreachable") // cannot verify anything
	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error to back off on")
	require.False(t, advanced, "nothing was acked and nothing was deleted")

	require.Empty(t, st.rewinds, "RewindPrices was never called: the deletion was refused, not performed")
	require.Equal(t, uint64(5000), st.cursor, "the cursor is untouched")
	require.Len(t, st.rows, 1, "the unrecoverable polled row survives an unverifiable rewind")
	require.True(t, st.unacked, "the epoch stays unacknowledged, so no price can be applied meanwhile")

	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRewindBlocked)
	require.Contains(t, got[ConditionPollRewindBlocked], "REFUSED to ack or delete")
	healthy, _ := p.Health()
	require.False(t, healthy, "/readyz must go red: the poller is stalled and an operator has to know")
	require.True(t, containsSubstring(*msgs, "repair BLOCKED and nothing was deleted"))

	// RETRY, which is the other half of Codex's recommendation: once the probe
	// endpoint recovers, the same verification succeeds and repair proceeds.
	ch.hashErr = nil
	canonicalAt(ch, 5000)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.rewinds, 1)
	require.Equal(t, uint64(5000), st.rewinds[0].verifiedFloor, "the recovered probe proved 5000 canonical")
	require.Len(t, st.rows, 1, "and the row was retained throughout")
	require.Empty(t, pollConditions(p)[ConditionPollRewindBlocked])
}

// A1 (DEEP REORG, PAGINATION): verification is bounded PER STEP but not abandoned.
// The old code probed eight anchors and then degraded to the destructive walker
// target; it now pages deeper on each Step, and never deletes while the answer is
// still unknown.
func TestPollerRewindPagesAnchorProbesAcrossStepsWithoutDeleting(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, hashes: map[uint64]common.Hash{}}
	p, clk := newTestPoller(t, st, ch, 10)

	// Two pages' worth of anchored rounds. Everything above 4050 was replaced;
	// 4050 itself is still canonical, and it sits in the SECOND page.
	var blocks []uint64
	for i := 0; i < 2*anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		blocks = append(blocks, b)
		st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, clk.now())
		st.seedAnchor(engine, b, blockHashAt(b))
		ch.hashes[b] = common.HexToHash("0xbeef") // replaced
	}
	ch.hashes[4050] = blockHashAt(4050) // the deepest surviving canonical anchor
	st.cursor, st.cursorFound = blocks[len(blocks)-1], true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.unacked = true
	p.lastAttempt = clk.now()

	// FIRST Step: one page of probes, no conclusion, NOTHING deleted.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Len(t, ch.hashCalls, anchorProbePage, "a Step spends exactly one page of probes")
	require.Empty(t, st.rewinds, "an inconclusive page must not delete anything")
	require.Len(t, st.rows, 2*anchorProbePage)
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)

	// SECOND Step: it RESUMES below the page it already checked rather than
	// re-probing the top, and finds the surviving anchor.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Greater(t, len(ch.hashCalls), anchorProbePage, "verification continued instead of giving up")
	require.Less(t, ch.hashCalls[anchorProbePage], blocks[len(blocks)-1],
		"the second page starts BELOW the anchors already checked")
	require.Len(t, st.rewinds, 1)
	require.Equal(t, uint64(4050), st.rewinds[0].verifiedFloor)
	require.Equal(t, uint64(4050), st.cursor, "not the walker's 100")

	var kept []uint64
	for _, r := range st.rows {
		kept = append(kept, r.block)
	}
	require.ElementsMatch(t, []uint64{4000, 4010, 4020, 4030, 4040, 4050}, kept,
		"everything at or below the verified anchor survives; only the orphaned suffix goes")
}

// A1 (EVERY RETAINED ANCHOR ORPHANED): a reorg deeper than the entire retained
// anchor history is not repaired automatically. Paging reaches the bottom, proves
// nothing survives, and STILL refuses — deleting the whole history on that
// evidence is an operator decision, not an automatic one.
func TestPollerRewindRefusesWhenEveryRetainedAnchorIsOrphaned(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, hashes: map[uint64]common.Hash{}}
	p, clk := newTestPoller(t, st, ch, 10)

	for i := 0; i < anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, clk.now())
		st.seedAnchor(engine, b, blockHashAt(b))
		ch.hashes[b] = common.HexToHash("0xbeef")
	}
	st.cursor, st.cursorFound = 4000+10*uint64(anchorProbePage-1), true
	st.unacked = true
	p.lastAttempt = clk.now()

	// First Step consumes the only page; the second reaches the bottom.
	for i := 0; i < 2; i++ {
		advanced, err := p.Step(context.Background())
		require.NoError(t, err)
		require.False(t, advanced, "step %d", i)
	}
	require.Empty(t, st.rewinds, "nothing was deleted on the strength of a total orphaning")
	require.Len(t, st.rows, anchorProbePage)
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRewindBlocked)
	require.Contains(t, got[ConditionPollRewindBlocked], "every retained poll anchor is orphaned")
	require.Contains(t, got[ConditionPollRewindBlocked], "operator decision")
}

// A1 (UPGRADE / LEGACY UNANCHORED HISTORY): rows written before this engine
// anchored its rounds cannot be verified, so repair refuses them — and the poller
// ADOPTS anchors for them on a normal round instead, which is the explicit one-time
// policy. Adoption runs only with NO epoch pending, so it can never take the hash
// of a replacement block.
func TestPollerAdoptsAnchorsForLegacyUnanchoredRowsThenCanRepair(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5100, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	// Post-upgrade state: polled rows exist at 5000, with NO anchor anywhere.
	st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.cursor, st.cursorFound = 5000, true
	canonicalAt(ch, 5000, 5100)

	// A reorg arriving BEFORE adoption is refused, not guessed at.
	st.unacked = true
	p.lastAttempt = clk.now()
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.rewinds, "unanchored history is never deleted on faith")
	require.Contains(t, pollConditions(p)[ConditionPollRewindBlocked], "no poll anchor covers")

	// With the epoch cleared, the next due round adopts the missing anchor.
	st.unacked = false
	p.lastAttempt = time.Time{}
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []uint64{5000}, st.adopted, "the legacy block was anchored from the live chain")

	// And now a reorg IS repairable, retaining the adopted history.
	st.unacked = true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.rewinds, 1)
	require.Equal(t, uint64(5100), st.rewinds[0].verifiedFloor,
		"the newest verified anchor — the round that just landed — is the floor")
	require.NotEmpty(t, st.rows, "adopted legacy history survived the rewind")
}

// A1: adoption is REFUSED while a reorg epoch is pending, at the store as well as
// by the call site. Adopting then could record a replacement block's hash and let
// a later probe "verify" rows describing the block the chain discarded.
func TestPollerAnchorAdoptionRefusedWhileEpochPending(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5100, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.cursor, st.cursorFound = 5000, true
	canonicalAt(ch, 5000)
	st.unacked = true

	// Call adoption directly on the pending-epoch state: the store refuses it.
	p.adoptLegacyAnchors(context.Background())
	require.Empty(t, st.adopted, "no anchor may be adopted while the chain may have moved under that height")
}

// The rewind resumes from the CURSOR READ BACK, never from the requested target:
// the store may have lowered it to a deeper unacknowledged epoch.
func TestPollerRewindResumesFromCursorReadBack(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = 4000, true
	deep := uint64(3500)
	st.rewindDeepTo = &deep
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(4000), st.rewinds[0].toBlock, "the poller asked for its cursor")
	require.Equal(t, uint64(3500), st.cursor, "the store lowered it, and that is what stands")
}

// Bootstrap (no cursor yet on an epoch-carrying chain) targets block 0 with NO
// floor: there is nothing of this writer's to delete, and no anchor to verify.
func TestPollerBootstrapRewindTargetsZero(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursorFound = false
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(0), st.rewinds[0].toBlock)
	require.Equal(t, uint64(0), st.rewinds[0].verifiedFloor)
	require.Empty(t, ch.hashCalls, "no cursor means no anchor to verify: no probe is issued")
}

// A store that leaves no cursor after RewindPrices has violated its contract;
// the poller says so instead of proceeding on an unknown resume point.
func TestPollerRewindMissingCursorIsAnError(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = 4000, true
	st.rewindLeavesNoCursor = true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.ErrorContains(t, err, "store contract violated")
}

// The reactive backstop: an epoch recorded AFTER this Step's proactive check
// surfaces as ApplyPrices' ErrUnackedReorgEpoch and is answered by a rewind.
func TestPollerReactiveEpochRewind(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{store.ErrUnackedReorgEpoch}
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "recovered, not fatal")
	require.True(t, advanced)
	require.Len(t, st.rewinds, 1)
	require.Equal(t, uint64(4000), st.rewinds[0].toBlock)
}

// D3 (ENDPOINT BRANCH): a frozen endpoint answers eth_call successfully with an
// OLD execution block. The store's monotonic cursor guard catches it, the poller
// VERIFIES its own frontier anchor is still canonical — which rules a reorg out —
// and only then pins the NEXT endpoint via CallFrom, leaving the shared hint alone.
func TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, active: 1, respond: okRound(t, 4000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 5000) // our frontier is still canonical
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a stale round is DEGRADED, not an error to back off on")
	require.False(t, advanced, "nothing was recorded")
	require.Equal(t, []int{1}, ch.served, "the first round followed the shared hint")
	require.Equal(t, []int{2}, ch.hashStart, "the ancestry probe avoided the endpoint under suspicion")
	require.Equal(t, 2, p.preferredStart, "one past the endpoint that served the stale batch")
	require.True(t, containsSubstring(*msgs, "stale rpc endpoint"))
	require.Equal(t, 1, p.staleRotations)

	// The next round routes through CallFrom at the pinned start.
	clk.advance(time.Minute)
	ch.respond = okRound(t, 5100, 20, 1_000_001)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []int{2}, ch.starts, "CallFrom started at the pin")
	require.Equal(t, -1, p.preferredStart, "genuine progress released the preference")
}

// D3 (REORG BRANCH, WALKER IN BACKOFF): the walker has not recorded the epoch yet
// — it is backing off, for up to its ten-minute capped delay — so every
// cadence-due round sees a cursor regression. The poller must NOT blame an
// endpoint, must NOT rotate, and must NOT raise the all-endpoints-behind alarm
// across that whole window; the evidence is its own frontier anchor being orphaned.
func TestPollerRegressionDuringWalkerBackoffSuppressesEndpointBlame(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	// The chain replaced our frontier, and no epoch is recorded (walker backing off).
	ch := &fakePollChain{endpoints: 2, respond: okRound(t, 4900, 20, 1_000_000),
		hashes: map[uint64]common.Hash{5000: common.HexToHash("0xfeed")}}
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression,
		store.ErrDeriveCursorRegression,
		store.ErrDeriveCursorRegression,
	}
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	for i := 0; i < 3; i++ {
		advanced, err := p.Step(context.Background())
		require.NoError(t, err)
		require.False(t, advanced)
		require.Equal(t, -1, p.preferredStart, "round %d: no endpoint may be implicated", i)
		require.Zero(t, p.staleRotations, "round %d: the all-behind streak must not accrue", i)
		clk.advance(time.Minute)
	}
	require.True(t, containsSubstring(*msgs, "the cause is a REORG, not an endpoint"))
	require.False(t, containsSubstring(*msgs, "all endpoints behind"),
		"a reorg must never produce the all-endpoints-behind diagnosis")
	require.False(t, containsSubstring(*msgs, "stale rpc endpoint"))
}

// D3 (UNKNOWN BRANCH): with no anchor to verify against, the cause cannot be
// determined — a reorg remains possible — so no endpoint-specific conclusion is
// drawn. The disclosed cost is that a genuinely frozen endpoint is not routed
// around for that round.
func TestPollerRegressionWithUndeterminedCauseSuppressesRotation(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true // cursor but NO anchor (post-bootstrap)
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, -1, p.preferredStart, "nothing may be pinned on undetermined evidence")
	require.Zero(t, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "UNDETERMINED cause"))
	require.Empty(t, ch.hashCalls, "with no anchor there is nothing to probe")
}

// D3 (UNKNOWN BRANCH, PROBE FAILURE): an anchor exists but cannot be checked.
// Same posture — cause unknown, no rotation.
func TestPollerRegressionWithFailedAncestryProbeSuppressesRotation(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000),
		hashErr: errors.New("probe timed out")}
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, -1, p.preferredStart)
	require.Zero(t, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "UNDETERMINED cause"))
	require.True(t, containsSubstring(*msgs, "ancestry probe"))
}

// D3 (REORG BRANCH, EPOCH ALREADY RECORDED): the cheap check runs first and costs
// no RPC at all.
func TestPollerRegressionWithRecordedEpochNeedsNoProbe(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)
	// HasUnackedReorg is false on the proactive check and true by the time the
	// apply is classified: a walker rewind landed in between.
	st.unackedAfterApply = true
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, -1, p.preferredStart)
	require.Empty(t, ch.hashCalls, "the durable reorg check settles it without an RPC")
	require.True(t, containsSubstring(*msgs, "durable reorg epoch is already recorded"))
}

// A1/D3: a poll round that re-anchors a height with a DIFFERENT hash is positive
// proof of a reorg. The store aborts the batch and the poller treats it as a
// reorg, never as evidence about the endpoint.
func TestPollerAnchorDivergenceIsTreatedAsReorg(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true
	st.applyErrs = []error{store.ErrPollAnchorDivergence}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a detected reorg is not an error to back off on")
	require.False(t, advanced)
	require.Equal(t, -1, p.preferredStart, "no endpoint is implicated by a reorg")
	require.Zero(t, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "the cause is a REORG, not an endpoint"))
}

// Cycling every endpoint without landing a round logs the all-endpoints-behind
// DEGRADED warning — telemetry, not a correctness gate. It requires the ENDPOINT
// attribution, which requires a verified frontier.
func TestPollerAllEndpointsBehindWarns(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression,
		store.ErrDeriveCursorRegression,
	}
	ch := &fakePollChain{endpoints: 2, respond: okRound(t, 4000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 5000)
	msgs := captureWarnings(t)

	for i := 0; i < 2; i++ {
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		clk.advance(time.Minute)
	}
	require.Equal(t, 2, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "all endpoints behind"))
}

// An AMBIGUOUS apply error retains the pin (releasing it would let the next
// round fall back to a shared hint that may still point at a rejected endpoint)
// but the retention is LEASED: the third consecutive ambiguity rotates it.
func TestPollerAmbiguousApplyRetainsPinThenRotates(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression, // pins preferredStart = 1
		errors.New("commit ack lost 1"),
		errors.New("commit ack lost 2"),
		errors.New("commit ack lost 3"),
	}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 5000)
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, p.preferredStart)

	for i := 1; i <= 2; i++ {
		clk.advance(time.Minute)
		_, err := p.Step(context.Background())
		require.Error(t, err)
		require.Equal(t, 1, p.preferredStart, "ambiguity %d retains the pin", i)
		require.Equal(t, i, p.consecutiveAmbiguous)
		require.Zero(t, p.staleRotations, "an apply error restarts the stale telemetry")
	}

	clk.advance(time.Minute)
	_, err = p.Step(context.Background())
	require.Error(t, err)
	require.Equal(t, 2, p.preferredStart, "the lease is spent: rotate so a recovered endpoint is reprobed")
	require.Zero(t, p.consecutiveAmbiguous)
	require.True(t, containsSubstring(*msgs, "rotating preferred endpoint"))
}

// With NO pin, an ambiguous error consumes no lease: multicalls already follow
// the shared hint and there is nothing to bound.
func TestPollerAmbiguousApplyWithoutPinConsumesNoLease(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{errors.New("commit ack lost")}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.Error(t, err)
	require.Equal(t, -1, p.preferredStart)
	require.Zero(t, p.consecutiveAmbiguous)
}

// THE APPLY-ERROR RESET, poller side: in the commit-landed-with-lost-ack world
// the rows DID land, and re-hydrating from durable truth is the only way to know
// it. Freshness must reflect what actually persisted, not what the error implied.
func TestPollerRehydratesFreshnessAfterAmbiguousApply(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{errors.New("commit ack lost")}
	st.applyAdvancesDespiteErr = true // the transaction committed; the ack was lost
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.Error(t, err, "the caller still sees the indeterminate error")
	require.Equal(t, 2, st.freshnessCalls, "hydrate at Step, then re-hydrate after the uncertain apply")
	require.True(t, p.hydrated)
	require.Len(t, p.lastUsable, 20, "the rows that DID land are reflected in freshness")

	clk.advance(time.Duration(pollHealthGrace)*time.Minute - time.Second)
	healthy, reason := p.Health()
	require.True(t, healthy, "prices landed within the grace window, got %q", reason)
}

// A failed re-hydration after an uncertain apply must not leave a green verdict
// resting on state whose relationship to storage is unknown.
func TestPollerFailedRehydrationMarksVerdictUntrusted(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{errors.New("commit ack lost")}
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	// Hydration succeeds at Step, then the database goes away.
	st.freshnessErrAfter = 1
	st.freshnessErr = errors.New("database unreachable")

	_, err := p.Step(context.Background())
	require.Error(t, err)
	require.False(t, p.hydrated)
	require.True(t, containsSubstring(*msgs, "could not re-hydrate durable price state"))

	clk.advance(time.Duration(pollHealthGrace)*time.Minute + time.Second)
	healthy, _ := p.Health()
	require.False(t, healthy)
	require.Contains(t, pollConditions(p), ConditionPollFreshnessUnhydrated)
}

// Health recovers: a landed round clears both conditions.
func TestPollerHealthIsRecoverable(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	healthy, _ := p.Health()
	require.True(t, healthy, "a fresh poller is healthy for its grace window")

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	healthy, _ = p.Health()
	require.True(t, healthy)

	clk.advance(time.Duration(pollHealthGrace)*time.Minute + time.Second)
	healthy, reason := p.Health()
	require.False(t, healthy)
	require.Contains(t, reason, "no poll round has durably recorded a usable price")

	ch.respond = okRound(t, 5100, 20, 1_000_001)
	_, err = p.Step(context.Background())
	require.NoError(t, err)
	healthy, reason = p.Health()
	require.True(t, healthy, "a landed round clears it — this state is recoverable, got %q", reason)
}

func TestNewPollerValidation(t *testing.T) {
	feeds := realFeeds(t)
	ch := &fakePollChain{endpoints: 1}

	_, err := NewPoller(nil, ch, feeds, PollerConfig{ChainID: 10, Interval: time.Minute})
	require.ErrorContains(t, err, "store, chain and feed registry are all required")

	_, err = NewPoller(newFakePriceStore(), ch, feeds, PollerConfig{ChainID: 0, Interval: time.Minute})
	require.ErrorContains(t, err, "chain id is required")

	_, err = NewPoller(newFakePriceStore(), ch, feeds, PollerConfig{ChainID: 10, Interval: 0})
	require.ErrorContains(t, err, "interval must be positive")

	// A chain with no obligations is a refusal, not an empty poller.
	_, err = NewPoller(newFakePriceStore(), ch, feeds, PollerConfig{ChainID: 42161, Interval: time.Minute})
	require.ErrorContains(t, err, "declares no poll obligations on chain 42161")
}

// Growing the registry past what one multicall may carry is a CONSTRUCTION
// refusal, not silent chunking: splitting a round gives up its single as-of
// block, and that must be a deliberate decision.
func TestNewPollerRefusesOversizedRegistry(t *testing.T) {
	var assets []config.Feed
	for i := 0; i <= maxPollTargets; i++ {
		var a common.Address
		a[19] = byte(i)
		a[18] = byte(i >> 8)
		assets = append(assets, config.Feed{
			Chain: "op", ChainID: 10, Engine: "debt_manager", Address: a,
			Symbol: "T", Decimals: 18, Roles: []string{"debt"},
			Oracle: config.FeedOracle{
				Kind: config.FeedKindPoll, Contract: priceProviderV2,
				Method: "price(address)", PriceDecimals: 6,
			},
		})
	}
	_, err := NewPoller(newFakePriceStore(), &fakePollChain{endpoints: 1},
		&config.Feeds{Assets: assets}, PollerConfig{ChainID: 10, Interval: time.Minute})
	require.ErrorContains(t, err, "exceed the 100-per-round bound")
}

// ---------------------------------------------------------------------------
// Principle 1: only a durable, newly-observed fact may refresh health.
// ---------------------------------------------------------------------------

// B-FROZEN: an rpc endpoint frozen EXACTLY at the cursor is the one semantic
// failure that never surfaces as an RPC error. Every eth_call succeeds, the store
// accepts the equal-height replay as idempotent success, no cursor regression
// fires, and nothing new is inserted. The previous version stamped every returned
// target with process time on that nil error, so health stayed green forever.
//
// The fix is structural: freshness can only move from the rows the apply reports
// having inserted, and a replay reports none.
func TestPollerFrozenEndpointAtCursorRefreshesNothing(t *testing.T) {
	st := newFakePriceStore()
	st.enforceCursorMonotonic = true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	// One healthy round establishes the cursor, the rows and the anchor.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.rows, 20)
	healthy, _ := p.Health()
	require.True(t, healthy)

	// The endpoint now freezes at that exact height and answers identically
	// forever.
	for i := 0; i < 6; i++ {
		clk.advance(time.Minute)
		advanced, err = p.Step(context.Background())
		require.NoError(t, err, "round %d: the RPC call and the apply both succeed", i)
		require.True(t, advanced, "round %d: the store accepts an equal-height replay", i)
	}
	require.Len(t, st.rows, 20, "six further rounds inserted NOTHING")
	require.Len(t, st.anchors[PollCursorEngine(10)], 1, "and anchored no new execution block")

	healthy, reason := p.Health()
	require.False(t, healthy, "a stalled oracle path must not read as healthy: %q", reason)
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRound, "no round durably recorded a usable price")
	require.Contains(t, got, ConditionPollTargetFreshness, "and every asset's usable price has aged out")
	require.Contains(t, got, ConditionPollBlockAdvance,
		"and the execution block has not advanced within its bounded TTL")
	require.Contains(t, got[ConditionPollBlockAdvance], "no NEW execution block")
	require.Contains(t, got[ConditionPollBlockAdvance], "5000")
	require.True(t, containsSubstring(*msgs, "recorded NOTHING NEW"),
		"the operator log names the replay explicitly")
}

// The block-advance clock is hydrated from the newest ANCHOR ROW's own database
// timestamp, so a restart cannot grant a frozen chain view a fresh window — the
// restart-reset defect, applied to the block-advance signal.
func TestPollerHydratesBlockAdvanceClockFromDurableAnchor(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	// Durable history a previous process left: every asset priced a moment ago, but
	// the newest anchor is HOURS old — the chain view froze long before this
	// process started.
	for _, a := range realFeeds(t).PollAssets(10) {
		st.seedRow(engine, a.Address.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	}
	st.seedAnchorAt(engine, 5000, blockHashAt(5000), clk.now().Add(-3*time.Hour))
	st.cursor, st.cursorFound = 5000, true
	p.lastAttempt = clk.now() // not due: isolate hydration

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)

	got := pollConditions(p)
	require.Contains(t, got, ConditionPollBlockAdvance)
	require.Contains(t, got[ConditionPollBlockAdvance], "5000")
	require.NotContains(t, got, ConditionPollTargetFreshness,
		"the recorded prices themselves are current: this condition is about the CHAIN not moving")
	require.NotContains(t, got, ConditionPollRound)
}

// B-INVALID (POLL SIDE): a quarantined non-positive answer is a real observation —
// it proves the oracle was reached, which is why the cursor may advance on it — but
// it is not a usable price. It must never refresh usable-price freshness, and it is
// reported as its own condition so "no data" and "poisoned data" stay
// distinguishable.
func TestPollerQuarantinedAnswerDoesNotRefreshUsableFreshness(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1}
	block := uint64(5000)
	zeroed := false
	ch.respond = func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		if zeroed {
			rets[2] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(0))}
		}
		return encodeMulticall(t, block, rets), nil
	}
	p, clk := newTestPoller(t, st, ch, 10)

	// One good round, then four rounds in which one oracle answers ZERO while the
	// rest stay healthy. Rounds keep landing and the block keeps advancing.
	_, err := p.Step(context.Background())
	require.NoError(t, err)
	zeroed = true
	for i := 0; i < 4; i++ {
		block += 100
		clk.advance(time.Minute)
		_, err = p.Step(context.Background())
		require.NoError(t, err)
	}

	healthy, reason := p.Health()
	require.False(t, healthy, "an oracle answering zero every interval is not healthy")
	got := pollConditions(p)
	require.NotContains(t, got, ConditionPollRound, "other assets ARE landing usable prices")
	require.Contains(t, got, ConditionPollInvalidAnswer)
	require.Contains(t, got, ConditionPollTargetFreshness,
		"usable freshness for that asset aged out exactly as if the oracle had answered nothing")

	broken := realFeeds(t).PollAssets(10)[2]
	require.Contains(t, got[ConditionPollInvalidAnswer], broken.Symbol)
	require.Contains(t, got[ConditionPollInvalidAnswer], "non-positive oracle answer")
	require.Contains(t, got[ConditionPollTargetFreshness], "1 of 20 registry assets")
	require.Contains(t, reason, broken.Symbol)

	// A usable answer clears both: this class is recoverable.
	zeroed = false
	block += 100
	clk.advance(time.Minute)
	_, err = p.Step(context.Background())
	require.NoError(t, err)
	got = pollConditions(p)
	require.NotContains(t, got, ConditionPollInvalidAnswer)
	require.NotContains(t, got, ConditionPollTargetFreshness)
}

// The quarantine marker is HYDRATED from durable rows, so a restart cannot hide an
// oracle whose newest recorded answer is unusable.
func TestPollerHydratesQuarantineMarkerAcrossRestart(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	assets := realFeeds(t).PollAssets(10)
	for i, a := range assets {
		st.seedRow(engine, a.Address.Bytes(), SourcePriceProviderV2, 4900, clk.now())
		if i == 4 {
			// A newer, QUARANTINED row on top of the good one.
			st.seedInvalidRow(engine, a.Address.Bytes(), SourcePriceProviderV2, 5000, clk.now())
		}
	}
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.cursor, st.cursorFound = 5000, true
	p.lastAttempt = clk.now()

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	got := pollConditions(p)
	require.Contains(t, got, ConditionPollInvalidAnswer)
	require.Contains(t, got[ConditionPollInvalidAnswer], assets[4].Symbol)
	require.NotContains(t, got, ConditionPollTargetFreshness,
		"the underlying good answer is still recent, so only the validity condition fires")
}

// ---------------------------------------------------------------------------
// D3: diagnosis and recovery are separate.
// ---------------------------------------------------------------------------

// D3-STALL: with the shared endpoint frozen BELOW the cursor and no anchor to
// classify against, wave 1's behaviour was an indefinite stall — every eth_call
// succeeded so error-driven failover never fired, every apply regressed, and no
// round could ever land the anchor that would make classification decidable.
//
// Attribution is still withheld (nothing is provable), but the next round is routed
// to a DIFFERENT endpoint as bounded exploration, which is what ends the stall.
func TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress(t *testing.T) {
	st := newFakePriceStore()
	st.enforceCursorMonotonic = true
	st.cursor, st.cursorFound = 5000, true // a cursor but NO anchor: undiagnosable
	ch := &fakePollChain{endpoints: 3, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if idx == 2 {
			return okRound(t, 5100, 20, 1_000_000)(idx, to, data) // the healthy node
		}
		return okRound(t, 4000, 20, 1_000_000)(idx, to, data) // frozen below the cursor
	}
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	for i := 0; i < 3; i++ {
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		require.Equal(t, -1, p.preferredStart, "round %d: nothing may be ATTRIBUTED on undetermined evidence", i)
		require.Zero(t, p.staleRotations, "round %d: no all-behind streak may accrue", i)
		clk.advance(time.Minute)
	}

	require.Equal(t, []int{1, 2}, ch.starts,
		"exploration moved one endpoint further each undiagnosable round, and stopped once a round landed")
	require.Equal(t, uint64(5100), st.cursor, "the healthy endpoint ended the stall")
	require.Len(t, st.rows, 20)
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
	require.True(t, containsSubstring(*msgs, "bounded exploration"))
	require.False(t, containsSubstring(*msgs, "stale rpc endpoint"),
		"no endpoint was ever accused")
	require.False(t, containsSubstring(*msgs, "all endpoints behind"))
}

// With a SINGLE endpoint there is nothing to explore towards, and the code says so
// rather than pretending otherwise.
func TestPollerCauseUnknownWithOneEndpointCannotExplore(t *testing.T) {
	st := newFakePriceStore()
	st.enforceCursorMonotonic = true
	st.cursor, st.cursorFound = 5000, true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 4000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, -1, p.exploreStart, "one endpoint: exploration is unavailable, not faked")
	require.Equal(t, -1, p.preferredStart)
	require.Empty(t, ch.starts, "no CallFrom was issued")
}

// D3-BOUND: an anchor BELOW the cursor cannot cover the heights a regression is
// about, so verifying it proves nothing and attribution would be guesswork.
//
// Wave 1 attributed those rounds to the endpoint anyway and documented the cost as
// "one misattributed pin released by the next round's progress". Progress is not
// guaranteed: with the canonical head below the cursor every healthy endpoint
// regresses, the same lower anchor keeps verifying, and each round accuses another
// node — cycling all of them and emitting a false all-endpoints-behind diagnosis
// for the whole walker backoff window. This is now cause-unknown.
func TestPollerRegressionWithFrontierBelowCursorIsCauseUnknown(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.enforceCursorMonotonic = true
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 4000, blockHashAt(4000)) // the anchor does NOT reach the cursor
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4500, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 4000) // it still verifies — and that is exactly the trap
	msgs := captureWarnings(t)

	for i := 0; i < 4; i++ {
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		require.Equal(t, -1, p.preferredStart,
			"round %d: ancestry that stops below the cursor cannot implicate an endpoint", i)
		require.Zero(t, p.staleRotations, "round %d", i)
		clk.advance(time.Minute)
	}

	require.Empty(t, ch.hashCalls,
		"the probe is not even issued: an anchor below the cursor cannot answer the question")
	require.True(t, containsSubstring(*msgs, "UNDETERMINED cause"))
	require.True(t, containsSubstring(*msgs, "but the cursor is at"))
	require.False(t, containsSubstring(*msgs, "stale rpc endpoint"))
	require.False(t, containsSubstring(*msgs, "all endpoints behind"),
		"the false all-endpoints-behind diagnosis is exactly what this branch prevents")
}
