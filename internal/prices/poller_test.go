package prices

// Poller tests: request shape against the REAL registry, the per-asset failure
// posture, the cadence gate, the reorg-first ordering and rewind discipline, and
// the frozen-endpoint routing (pin, ambiguity lease, release on progress).

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

// newTestPoller builds a Poller on the REAL registry with an injected clock.
func newTestPoller(t *testing.T, st *fakePriceStore, ch *fakePollChain, chainID uint64) (*Poller, *testClock) {
	t.Helper()
	p, err := NewPoller(st, ch, realFeeds(t), PollerConfig{
		ChainID: chainID, Interval: time.Minute,
	})
	require.NoError(t, err)
	clk := newTestClock()
	p.now = clk.now
	p.lastLanded = clk.now()
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
	require.Equal(t, []string{SourcePriceProviderV2}, r.sources, "only this writer's sources are scoped")
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

// Bootstrap (no cursor yet on an epoch-carrying chain) targets block 0: there is
// nothing of this writer's to delete, and the call exists to create the cursor
// and ack — which is exactly what ApplyPrices demands first.
func TestPollerBootstrapRewindTargetsZero(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursorFound = false
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(0), st.rewinds[0].toBlock)
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

// A frozen endpoint answers eth_call successfully with an OLD execution block;
// the store's monotonic cursor guard catches it and the poller pins the NEXT
// endpoint via CallFrom, leaving the shared hint alone.
func TestPollerStaleEndpointPinsNextEndpoint(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, active: 1, respond: okRound(t, 4000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a stale round is DEGRADED, not an error to back off on")
	require.False(t, advanced, "nothing was recorded")
	require.Equal(t, []int{1}, ch.served, "the first round followed the shared hint")
	require.Equal(t, 2, p.preferredStart, "one past the endpoint that served the stale batch")
	require.True(t, containsSubstring(*msgs, "stale rpc endpoint"))

	// The next round routes through CallFrom at the pinned start.
	clk.advance(time.Minute)
	ch.respond = okRound(t, 5100, 20, 1_000_001)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []int{2}, ch.starts, "CallFrom started at the pin")
	require.Equal(t, -1, p.preferredStart, "genuine progress released the preference")
}

// Cycling every endpoint without landing a round logs the all-endpoints-behind
// DEGRADED warning — telemetry, not a correctness gate.
func TestPollerAllEndpointsBehindWarns(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression,
		store.ErrDeriveCursorRegression,
	}
	ch := &fakePollChain{endpoints: 2, respond: okRound(t, 4000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
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
	st.cursor, st.cursorFound = 5000, true
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression, // pins preferredStart = 1
		errors.New("commit ack lost 1"),
		errors.New("commit ack lost 2"),
		errors.New("commit ack lost 3"),
	}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)
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

// Health: a poller that has not landed a round for pollHealthGrace intervals is
// UNHEALTHY, and it RECOVERS on the next landed round.
func TestPollerHealthIsRecoverable(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	p, clk := newTestPoller(t, st, ch, 10)

	healthy, _ := p.Health()
	require.True(t, healthy, "a fresh poller is healthy for its grace window")

	clk.advance(time.Duration(pollHealthGrace)*time.Minute + time.Second)
	healthy, reason := p.Health()
	require.False(t, healthy)
	require.Contains(t, reason, "no price round has landed")

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	healthy, _ = p.Health()
	require.True(t, healthy, "a landed round clears it — this state is recoverable")
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
