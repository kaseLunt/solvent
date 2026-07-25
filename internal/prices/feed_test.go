package prices

// Chainlink feed deriver tests: construction's registry↔config match, the
// derivation window (order, per-log block stamps, last-wins, verbatim answers),
// the reorg-first ordering and rewind discipline, and the staleness surface —
// including the two ways it must NOT fire (backfill, and a head probe that
// failed) and the phase-change re-resolution it performs when it does.

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

var feedStreams = []string{"eth:feed-weeth", "eth:feed-usdc", "eth:feed-pyusd", "eth:feed-frax"}

// allAggregators returns the four configured raw aggregators, matching the
// registry exactly.
func allAggregators(t *testing.T) [][]byte {
	t.Helper()
	var out [][]byte
	for _, a := range realFeeds(t).StreamAssets(1) {
		out = append(out, a.Oracle.Contract.Bytes())
	}
	require.Len(t, out, 4)
	return out
}

const (
	testFeedStart    = uint64(20_999_000)
	testFeedFrontier = uint64(21_000_000)
	testFeedHead     = testFeedFrontier + 5
)

// newTestFeed builds a FeedDeriver on the REAL registry with an injected clock,
// and pre-seeds every stream's ingest cursor at frontier.
func newTestFeed(t *testing.T, st *fakePriceStore, ch *fakeFeedChain, startBlock, frontier uint64) (*FeedDeriver, *testClock) {
	t.Helper()
	f, err := NewFeedDeriver(st, decode.NewRegistry(), ch, realFeeds(t), FeedConfig{
		ChainID: 1, Streams: feedStreams, Addresses: allAggregators(t),
		StartBlock: startBlock, Window: 2000, Staleness: 26 * time.Hour,
	})
	require.NoError(t, err)
	clk := newTestClock()
	f.now = clk.now
	for _, s := range feedStreams {
		st.ingest[s] = &store.CursorPos{Block: frontier, Hash: []byte{0x01}}
	}
	return f, clk
}

// proxyResponder answers aggregator() per proxy address.
func proxyResponder(t *testing.T, byProxy map[common.Address]common.Address) func(common.Address, []byte) ([]byte, error) {
	t.Helper()
	return func(to common.Address, data []byte) ([]byte, error) {
		want, err := chainlinkProxyABI.Pack("aggregator")
		require.NoError(t, err)
		require.Equal(t, want, data, "the deriver must call aggregator() on the PROXY")
		resolved, ok := byProxy[to]
		require.True(t, ok, "unexpected proxy %s", to)
		return encodeAddress(t, resolved), nil
	}
}

// identityProxies maps each registry proxy to its CONFIGURED aggregator (the
// "not a phase change" answer).
func identityProxies(t *testing.T) map[common.Address]common.Address {
	t.Helper()
	out := map[common.Address]common.Address{}
	for _, a := range realFeeds(t).StreamAssets(1) {
		out[a.Oracle.Proxy] = a.Oracle.Contract
	}
	return out
}

// The registry and the configured stream set must match EXACTLY, in both
// directions — either mismatch silently loses an asset's prices.
func TestNewFeedDeriverRequiresExactRegistryConfigMatch(t *testing.T) {
	all := allAggregators(t)
	base := FeedConfig{
		ChainID: 1, Streams: feedStreams,
		StartBlock: testFeedStart, Window: 2000, Staleness: time.Hour,
	}

	missing := base
	missing.Addresses = all[:3]
	_, err := NewFeedDeriver(newFakePriceStore(), decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), missing)
	require.ErrorContains(t, err, "which no configured chainlink_feed stream ingests")

	extra := base
	extra.Addresses = append(append([][]byte{}, all...),
		common.HexToAddress("0x1111111111111111111111111111111111111111").Bytes())
	_, err = NewFeedDeriver(newFakePriceStore(), decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), extra)
	require.ErrorContains(t, err, "has no registry entry")

	short := base
	short.Addresses = [][]byte{{0x01, 0x02}}
	_, err = NewFeedDeriver(newFakePriceStore(), decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), short)
	require.ErrorContains(t, err, "not a 20-byte address")
}

func TestNewFeedDeriverValidation(t *testing.T) {
	ok := FeedConfig{
		ChainID: 1, Streams: feedStreams, Addresses: allAggregators(t),
		StartBlock: testFeedStart, Window: 2000, Staleness: time.Hour,
	}
	_, err := NewFeedDeriver(nil, decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), ok)
	require.ErrorContains(t, err, "store, decoder, chain and feed registry are all required")

	noStale := ok
	noStale.Staleness = 0
	_, err = NewFeedDeriver(newFakePriceStore(), decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), noStale)
	require.ErrorContains(t, err, "staleness threshold must be positive")

	noWindow := ok
	noWindow.Window = 0
	_, err = NewFeedDeriver(newFakePriceStore(), decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), noWindow)
	require.ErrorContains(t, err, "window, addresses, streams and start block are all required")
}

// A derivation window maps each AnswerUpdated to its asset's row, stamped with
// the LOG's own block (not the window end) and the registry's 8-dec scale.
func TestFeedDeriverDerivesWindow(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, clk.unix(0)),
		answerUpdatedLog(testFeedStart+20, 3, aggWeETH, big.NewInt(340_512_000_000), 2, clk.unix(0)),
	}

	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	batch := st.lastBatch(t)
	require.Equal(t, FeedCursorEngine(1), batch.engine)
	require.Equal(t, uint64(1), batch.chainID)
	require.Equal(t, testFeedFrontier, batch.through, "the cursor covers the whole window")
	require.Len(t, batch.obs, 2)

	require.Equal(t, usdcETH.Bytes(), batch.obs[0].Asset)
	require.Equal(t, ChainlinkSource(aggUSDC), batch.obs[0].Source)
	require.Equal(t, int32(8), batch.obs[0].Decimals)
	require.Equal(t, testFeedStart+10, batch.obs[0].BlockNumber)
	require.Equal(t, "99990000", batch.obs[0].Price.String())

	require.Equal(t, weethETH.Bytes(), batch.obs[1].Asset)
	require.Equal(t, ChainlinkSource(aggWeETH), batch.obs[1].Source)
	require.Equal(t, testFeedStart+20, batch.obs[1].BlockNumber)
	require.Equal(t, "340512000000", batch.obs[1].Price.String())

	require.Equal(t, [][2]uint64{{testFeedStart, testFeedFrontier}}, st.rawLogsCalls)
}

// Two AnswerUpdated rounds in ONE block on one aggregator collapse LAST-WINS:
// they share the prices PK, and the store aborts a batch on a divergent replay.
func TestFeedDeriverLastWinsWithinABlock(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, clk.unix(0)),
		answerUpdatedLog(testFeedStart+10, 1, aggUSDC, big.NewInt(100_010_000), 2, clk.unix(0)),
	}

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	batch := st.lastBatch(t)
	require.Len(t, batch.obs, 1, "one row per (asset, source, block)")
	require.Equal(t, "100010000", batch.obs[0].Price.String(), "the block ends at the later answer")
}

// A non-positive answer is recorded VERBATIM (the store WARNs) — this layer
// stores what the aggregator published.
func TestFeedDeriverRecordsNegativeAnswerVerbatim(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(-42), 1, clk.unix(0)),
	}

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, "-42", st.lastBatch(t).obs[0].Price.String())
}

// An unallowlisted topic (e.g. NewRound) is a routine skip, never an error.
func TestFeedDeriverUnknownTopicSkipped(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true
	other := answerUpdatedLog(testFeedStart+5, 0, aggUSDC, big.NewInt(1), 1, clk.unix(0))
	other.Topics[0] = common.HexToHash("0xdeadbeef00000000000000000000000000000000000000000000000000000000").Bytes()
	st.logs = []store.RawLog{other}

	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Empty(t, st.lastBatch(t).obs)
	require.Equal(t, testFeedFrontier, st.lastBatch(t).through, "the window still closes")
}

// A malformed AnswerUpdated (truncated updatedAt word) is a DECODE failure: the
// stored bytes are wrong, and silently skipping them would lose a price.
func TestFeedDeriverDecodeErrorFailsTheStep(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true
	bad := answerUpdatedLog(testFeedStart+5, 0, aggUSDC, big.NewInt(1), 1, clk.unix(0))
	bad.Data = bad.Data[:8]
	st.logs = []store.RawLog{bad}

	advanced, err := f.Step(context.Background())
	require.Error(t, err)
	require.False(t, advanced)
	require.Empty(t, st.applied, "nothing reached the store")
}

// The frontier is the MIN over the deriver's stream cursors: above it some
// stream's logs may be missing.
func TestFeedDeriverFrontierIsMinOverStreams(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.ingest["eth:feed-frax"] = &store.CursorPos{Block: testFeedStart + 50, Hash: []byte{0x01}}

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, [][2]uint64{{testFeedStart, testFeedStart + 50}}, st.rawLogsCalls)
}

// A stream that has never ingested means no complete window exists yet.
func TestFeedDeriverWaitsForEveryStreamCursor(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	delete(st.ingest, "eth:feed-pyusd")

	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.applied)
	require.Empty(t, st.rawLogsCalls)
}

// Windows are capped at cfg.Window blocks.
func TestFeedDeriverWindowCap(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	st.cursor, st.cursorFound = testFeedStart-1, true
	// Push the frontier far above the window.
	for _, s := range feedStreams {
		st.ingest[s] = &store.CursorPos{Block: testFeedStart + 10_000, Hash: []byte{0x01}}
	}

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, [][2]uint64{{testFeedStart, testFeedStart + 1999}}, st.rawLogsCalls)
}

// Reorg coordination runs FIRST and clears the staleness tracking, whose
// timestamps came from logs at blocks the rewind may have orphaned.
func TestFeedDeriverReorgFirstAndResetsStalenessTracking(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// Derive once so tracking is populated and the deriver goes live.
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, clk.unix(0)),
	}
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	_, err = f.Step(context.Background()) // caught up: probes head, goes live
	require.NoError(t, err)
	require.NotEmpty(t, f.lastSeen)
	require.True(t, f.lastLive)

	st.unacked = true
	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.rewinds, 1)
	require.Equal(t, FeedCursorEngine(1), st.rewinds[0].engine)
	require.Equal(t, testFeedFrontier, st.rewinds[0].toBlock, "the rewind targets the deriver's OWN cursor")
	require.Len(t, st.rewinds[0].sources, 4, "only the four chainlink: sources are scoped")

	require.Empty(t, f.lastSeen, "tracking cleared: its blocks may be orphaned")
	require.False(t, f.lastLive)
	require.True(t, f.liveSince.IsZero())
	healthy, _ := f.Health()
	require.True(t, healthy, "no verdict can be made until re-derivation re-observes")
}

// Bootstrap (no cursor on an epoch-carrying chain) targets StartBlock-1.
func TestFeedDeriverBootstrapRewindTarget(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, testFeedStart-1, st.rewinds[0].toBlock)
}

// The rewind resumes from the CURSOR READ BACK, not the requested target.
func TestFeedDeriverRewindResumesFromCursorReadBack(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = testFeedFrontier, true
	deep := testFeedStart + 100
	st.rewindDeepTo = &deep
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, testFeedFrontier, st.rewinds[0].toBlock)
	require.Equal(t, deep, st.cursor, "the deeper effective target is what the next Step resumes from")
}

func TestFeedDeriverRewindMissingCursorIsAnError(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = testFeedFrontier, true
	st.rewindLeavesNoCursor = true
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	_, err := f.Step(context.Background())
	require.ErrorContains(t, err, "store contract violated")
}

// The reactive backstop: an epoch recorded after the proactive check surfaces as
// ApplyPrices' ErrUnackedReorgEpoch and is recovered from, not fatal.
func TestFeedDeriverReactiveEpochRewind(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.applyErrs = []error{store.ErrUnackedReorgEpoch}
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.rewinds, 1)
	require.Equal(t, testFeedStart-1, st.rewinds[0].toBlock)
}

// deriveToCaughtUp runs one derivation window carrying `observed` per aggregator
// and then one caught-up Step, leaving the deriver at live head.
func deriveToCaughtUp(t *testing.T, f *FeedDeriver, st *fakePriceStore, clk *testClock, observed map[common.Address]time.Duration, startBlock, frontier uint64) {
	t.Helper()
	st.cursor, st.cursorFound = startBlock-1, true
	var logs []store.RawLog
	i := uint32(0)
	for agg, age := range observed {
		logs = append(logs, answerUpdatedLog(startBlock+1, i, agg, big.NewInt(100_000_000), uint64(i+1), clk.unix(-age)))
		i++
	}
	st.logs = logs
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	_, err = f.Step(context.Background())
	require.NoError(t, err)
}

// BACKFILL MUST NOT FALSE-POSITIVE: with the frontier far below the chain head,
// every feed's newest answer is legitimately old, so no verdict is made at all.
func TestFeedDeriverStalenessSuspendedDuringBackfill(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedFrontier + 100_000, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{
		aggUSDC: 90 * 24 * time.Hour, // three months old, deep in history
	}, testFeedStart, testFeedFrontier)

	require.False(t, f.lastLive, "the frontier is 100k blocks behind head")
	healthy, _ := f.Health()
	require.True(t, healthy, "no staleness verdict during backfill")
	require.Empty(t, ch.calls, "no aggregator() re-resolution during backfill")
}

// At live head, a feed past the threshold goes STALE: WARN, FAILED health, and
// one aggregator() re-resolution on its PROXY.
func TestFeedDeriverStaleAtLiveHeadWarnsAndReResolves(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	// USDC last published 30h ago (> the 26h threshold); the others just now.
	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{
		aggUSDC:  30 * time.Hour,
		aggWeETH: 0,
	}, testFeedStart, testFeedFrontier)

	require.True(t, f.lastLive)
	healthy, reason := f.Health()
	require.False(t, healthy, "a stale stream FAILS the health check")
	require.Contains(t, reason, "USDC")
	require.Contains(t, reason, aggUSDC.Hex())
	require.NotContains(t, reason, "weETH", "the fresh stream is not implicated")
	require.True(t, containsSubstring(*msgs, "chainlink stream STALE"))
	require.True(t, containsSubstring(*msgs, "still points at the CONFIGURED aggregator"),
		"the proxy is unchanged, so this is not a phase change")

	require.Len(t, ch.calls, 1, "exactly one re-resolution, on the stale stream's proxy")
	require.Equal(t, proxyUSDC, ch.calls[0].to)
}

// A proxy that has RE-POINTED is the phase-change case: the log names the new
// aggregator and says the repair is manual.
func TestFeedDeriverStalePhaseChangeNamesNewAggregator(t *testing.T) {
	st := newFakePriceStore()
	newAgg := common.HexToAddress("0x2222222222222222222222222222222222222222")
	proxies := identityProxies(t)
	proxies[proxyUSDC] = newAgg
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, proxies)}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{
		aggUSDC:  30 * time.Hour,
		aggWeETH: 0,
	}, testFeedStart, testFeedFrontier)

	require.True(t, containsSubstring(*msgs, "RE-POINTED to a new aggregator"))
	require.True(t, containsSubstring(*msgs, "automatic re-pointing is a deliberate deferral"))
	healthy, _ := f.Health()
	require.False(t, healthy)
}

// A resumed feed clears the verdict: this health state is RECOVERABLE.
func TestFeedDeriverStaleResumeClearsHealth(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{
		aggUSDC:  30 * time.Hour,
		aggWeETH: 0,
	}, testFeedStart, testFeedFrontier)
	healthy, _ := f.Health()
	require.False(t, healthy)

	// The walker ingests a fresh USDC answer and the deriver picks it up.
	for _, s := range feedStreams {
		st.ingest[s] = &store.CursorPos{Block: testFeedFrontier + 10, Hash: []byte{0x02}}
	}
	ch.head = testFeedFrontier + 15
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedFrontier+5, 0, aggUSDC, big.NewInt(100_000_000), 9, clk.unix(0)),
	}
	_, err := f.Step(context.Background()) // derives the new window
	require.NoError(t, err)
	clk.advance(headProbeInterval + time.Second) // let the head probe re-run
	_, err = f.Step(context.Background())        // caught up: re-evaluates
	require.NoError(t, err)

	healthy, reason := f.Health()
	require.True(t, healthy, "the resumed feed cleared the verdict, got %q", reason)
}

// A feed that has published NOTHING since the deriver went live still trips
// after the threshold: "never observed" must not read as "forever fresh".
func TestFeedDeriverNeverPublishedTripsAfterThreshold(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// No logs at all: every stream is unobserved.
	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{}, testFeedStart, testFeedFrontier)
	healthy, _ := f.Health()
	require.True(t, healthy, "within the grace window since going live, nothing is stale yet")

	clk.advance(27 * time.Hour)
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	healthy, reason := f.Health()
	require.False(t, healthy)
	for _, sym := range []string{"weETH", "USDC", "PYUSD", "FRAX"} {
		require.Contains(t, reason, sym)
	}
}

// A stream whose first answer is above the derived cursor has had no chance to
// publish yet, so it is exempt from the verdict.
func TestFeedDeriverSkipsStreamsBelowTheirStartBlock(t *testing.T) {
	const (
		start    = uint64(20_199_000)
		frontier = uint64(20_200_000)
	)
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: frontier + 5, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, start, frontier)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{}, start, frontier)
	clk.advance(27 * time.Hour)
	_, err := f.Step(context.Background())
	require.NoError(t, err)

	healthy, reason := f.Health()
	require.False(t, healthy)
	// weETH's first AnswerUpdated is at 20,779,893 — above the cursor.
	require.NotContains(t, reason, "weETH", "a stream we have not reached yet cannot be stale")
	for _, sym := range []string{"USDC", "PYUSD", "FRAX"} {
		require.Contains(t, reason, sym)
	}
}

// A head probe that FAILS keeps the previous live/backfill verdict rather than
// silencing or faking the signal — and never fails the Step.
func TestFeedDeriverHeadProbeFailureKeepsVerdict(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{aggUSDC: 0}, testFeedStart, testFeedFrontier)
	require.True(t, f.lastLive)

	ch.headErr = context.DeadlineExceeded
	clk.advance(headProbeInterval + time.Second)
	advanced, err := f.Step(context.Background())
	require.NoError(t, err, "a probe failure is telemetry, not a Step failure")
	require.False(t, advanced)
	require.True(t, f.lastLive, "the previous verdict stands")
	require.True(t, containsSubstring(*msgs, "chain head probe failed"))
}

// The head probe is rate-limited: repeated caught-up Steps inside the interval
// do not add an RPC each.
func TestFeedDeriverHeadProbeRateLimited(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{aggUSDC: 0}, testFeedStart, testFeedFrontier)
	before := ch.headHits
	for i := 0; i < 5; i++ {
		_, err := f.Step(context.Background())
		require.NoError(t, err)
	}
	require.Equal(t, before, ch.headHits, "no extra probes inside the interval")

	clk.advance(headProbeInterval + time.Second)
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, before+1, ch.headHits)
}

// Caught up with nothing pending is not progress.
func TestFeedDeriverCaughtUpIsNotProgress(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = testFeedFrontier, true
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.applied)
}

// An oracle-supplied updatedAt is untrusted input to the health signal. A FUTURE
// timestamp would make the feed look fresh for as long as it is ahead — a
// year-3000 value would silence it for centuries — and an out-of-int64 value
// would wrap negative and pin it permanently stale. Both clamp to the
// OBSERVATION time, so the normal staleness clock still applies.
func TestFeedDeriverClampsImplausibleUpdatedAt(t *testing.T) {
	for _, tc := range []struct {
		name      string
		updatedAt func(clk *testClock) uint64
		wantWarn  string
	}{
		{"far future", func(clk *testClock) uint64 { return clk.unix(100 * time.Hour) }, "FUTURE updatedAt"},
		{"out of int64 range", func(*testClock) uint64 { return ^uint64(0) }, "out-of-range updatedAt"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := newFakePriceStore()
			ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
			f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
			msgs := captureWarnings(t)

			st.cursor, st.cursorFound = testFeedStart-1, true
			st.logs = []store.RawLog{
				answerUpdatedLog(testFeedStart+1, 0, aggUSDC, big.NewInt(100_000_000), 1, tc.updatedAt(clk)),
			}
			_, err := f.Step(context.Background())
			require.NoError(t, err)
			require.True(t, containsSubstring(*msgs, tc.wantWarn))
			require.Equal(t, clk.now(), f.lastSeen[aggUSDC], "clamped to the observation time")

			_, err = f.Step(context.Background()) // caught up: go live
			require.NoError(t, err)
			healthy, _ := f.Health()
			require.True(t, healthy)

			// Past the threshold, the clamped observation still trips.
			clk.advance(27 * time.Hour)
			_, err = f.Step(context.Background())
			require.NoError(t, err)
			healthy, reason := f.Health()
			require.False(t, healthy, "a clamped timestamp must not suppress the verdict")
			require.Contains(t, reason, "USDC")
		})
	}
}

// Sources() is the ownership scope handed to RewindPrices: exactly the four
// chainlink:<aggregator> names, one per configured stream.
func TestFeedDeriverSources(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	got := f.Sources()
	require.Len(t, got, 4)
	for _, s := range got {
		require.Contains(t, s, "chainlink:0x")
	}
	require.Contains(t, got, ChainlinkSource(aggUSDC))
	require.Contains(t, got, ChainlinkSource(aggWeETH))
}
