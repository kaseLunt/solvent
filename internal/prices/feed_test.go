package prices

// Chainlink feed deriver tests: construction's registry↔config match, the
// derivation window (order, per-log block stamps, last-wins, verbatim answers),
// the reorg-first ordering and rewind discipline, the APPLY-ERROR RESET contract
// in both indeterminate worlds, DURABLE publication freshness across restart and
// rewind, PER-FEED heartbeat thresholds, and the liveness gate's three defences
// (header timestamp, independent routing, verdict TTL) with RPC/ingest lag
// reported separately from feed staleness.

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
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

// newTestFeed builds a FeedDeriver on the REAL registry with an injected clock
// shared by the deriver, the fake store and the fake chain's head timestamp, and
// pre-seeds every stream's ingest cursor at frontier.
func newTestFeed(t *testing.T, st *fakePriceStore, ch *fakeFeedChain, startBlock, frontier uint64) (*FeedDeriver, *testClock) {
	t.Helper()
	f, err := NewFeedDeriver(st, decode.NewRegistry(), ch, realFeeds(t), FeedConfig{
		ChainID: 1, Streams: feedStreams, Addresses: allAggregators(t),
		StartBlock: startBlock, Window: 2000,
	})
	require.NoError(t, err)
	clk := newTestClock()
	f.now = clk.now
	st.now = clk.now
	ch.now = clk.now
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

// feedConditions indexes a deriver's conditions by name.
func feedConditions(f *FeedDeriver) map[string]string {
	out := map[string]string{}
	for _, c := range f.Conditions() {
		out[c.Name] = c.Reason
	}
	return out
}

// The registry and the configured stream set must match EXACTLY, in both
// directions — either mismatch silently loses an asset's prices.
func TestNewFeedDeriverRequiresExactRegistryConfigMatch(t *testing.T) {
	all := allAggregators(t)
	base := FeedConfig{
		ChainID: 1, Streams: feedStreams,
		StartBlock: testFeedStart, Window: 2000,
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
		StartBlock: testFeedStart, Window: 2000,
	}
	_, err := NewFeedDeriver(nil, decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), ok)
	require.ErrorContains(t, err, "store, decoder, chain and feed registry are all required")

	noWindow := ok
	noWindow.Window = 0
	_, err = NewFeedDeriver(newFakePriceStore(), decode.NewRegistry(), &fakeFeedChain{}, realFeeds(t), noWindow)
	require.ErrorContains(t, err, "window, addresses, streams and start block are all required")
}

// B3: a registry stream carrying no heartbeat/grace has no publication bound, and
// construction refuses it rather than silently inheriting some default — the
// single-global-threshold failure, blocked one layer down.
func TestNewFeedDeriverRefusesStreamWithoutOwnThreshold(t *testing.T) {
	feeds := realFeeds(t)
	stripped := &config.Feeds{}
	for _, a := range feeds.Assets {
		if a.Oracle.Kind == config.FeedKindChainlinkStream && a.Symbol == "USDC" {
			a.Oracle.Heartbeat = 0
			a.Oracle.Grace = 0
		}
		stripped.Assets = append(stripped.Assets, a)
	}
	_, err := NewFeedDeriver(newFakePriceStore(), decode.NewRegistry(), &fakeFeedChain{}, stripped, FeedConfig{
		ChainID: 1, Streams: feedStreams, Addresses: allAggregators(t),
		StartBlock: testFeedStart, Window: 2000,
	})
	require.ErrorContains(t, err, "declares no positive staleness threshold")
}

// B3 FIXTURE PIN: every configured stream's threshold is its OWN heartbeat plus
// its OWN grace, read from the real registry. The ETH/USD stream behind the weETH
// adapter is the one Codex evidenced at a 3600-second heartbeat, and it must be
// far tighter than the 26h global bound it replaces.
func TestFeedDeriverPerFeedThresholds(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead}
	f, _ := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	require.Equal(t, map[string]time.Duration{
		"weETH": 90 * time.Minute, // ETH/USD: 3600s heartbeat + 1800s grace
		"USDC":  25 * time.Hour,   // 86400s heartbeat + 3600s grace
		"PYUSD": 25 * time.Hour,
		"FRAX":  25 * time.Hour,
	}, f.Thresholds())

	const retiredGlobalBound = 26 * time.Hour
	for symbol, got := range f.Thresholds() {
		require.LessOrEqual(t, got, retiredGlobalBound,
			"%s: no feed may be judged more loosely than the retired global bound", symbol)
	}
	require.Less(t, f.Thresholds()["weETH"], 2*time.Hour,
		"the ETH/USD stream's 3600s contractual heartbeat must actually bind")
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
	require.Nil(t, batch.anchor, "a re-derivable writer records no poll anchor")
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

// A non-positive answer is passed to the store VERBATIM — the store records the
// raw fact and QUARANTINES it, which is what keeps it out of usable-price reads.
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

// B2 (REWIND): a rewind must RE-HYDRATE publication freshness from the surviving
// durable logs, not clear it. Clearing made every feed "unobserved" and restarted
// the grace window, so a feed that died BEFORE the rewind was reported healthy for
// another full threshold.
func TestFeedDeriverRewindRehydratesRatherThanClearingFreshness(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// Durable history: USDC's newest surviving answer is 30h old and sits BELOW
	// the rewind target, so it survives the rewind.
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, clk.unix(-30*time.Hour)),
	}
	st.cursor, st.cursorFound = testFeedFrontier, true
	st.unacked = true

	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.rewinds, 1)
	require.Equal(t, FeedCursorEngine(1), st.rewinds[0].engine)
	require.Equal(t, testFeedFrontier, st.rewinds[0].toBlock, "the rewind targets the deriver's OWN cursor")
	require.Equal(t, uint64(0), st.rewinds[0].verifiedFloor,
		"a re-derivable writer passes no verified floor: the walker re-ingests its input")

	require.True(t, f.hydrated, "freshness was re-read from durable logs, not cleared")
	require.Equal(t, clk.now().Add(-30*time.Hour).UTC(), f.lastUsable[aggUSDC],
		"the surviving 30h-old answer is what USDC is measured from")
	require.False(t, f.lastLive, "the live verdict must be re-earned after a rewind")

	// Once the deriver is live again, USDC is stale on the spot — no fresh
	// threshold was granted by the rewind.
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	healthy, reason := f.Health()
	require.False(t, healthy, "a rewind must not resurrect an already-dead feed")
	require.Contains(t, reason, "USDC")
}

// B2 (RESTART): a fresh process meets a caught-up cursor, replays no older logs,
// and must still see that a feed died before it started. Freshness comes from
// raw_logs, so it does.
func TestFeedDeriverHydratesPreexistingStaleFeedOnRestart(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// A caught-up cursor: this process will derive NOTHING. USDC last published
	// 30h ago (past its 25h threshold); weETH published a minute ago.
	st.cursor, st.cursorFound = testFeedFrontier, true
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, clk.unix(-30*time.Hour)),
		answerUpdatedLog(testFeedStart+20, 0, aggWeETH, big.NewInt(340_000_000_000), 2, clk.unix(-time.Minute)),
	}

	advanced, err := f.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "already caught up: no window was derived")
	require.Empty(t, st.applied, "nothing was applied, so process memory alone would know nothing")
	require.Equal(t, []uint64{testFeedFrontier}, st.latestLogCalls,
		"freshness was hydrated from durable logs at the derive cursor")

	healthy, reason := f.Health()
	require.False(t, healthy, "the feed that died BEFORE this process started must be caught immediately")
	require.Contains(t, reason, "USDC")
	require.NotContains(t, reason, "weETH", "the feed that published a minute ago is not implicated")
	require.Contains(t, feedConditions(f), ConditionFeedPublication)
}

// B3 IN ACTION: the same 90-minute gap is STALE for the 3600s-heartbeat ETH/USD
// stream and FRESH for the 86400s-heartbeat stablecoin streams. One global bound
// could not express both.
func TestFeedDeriverPerFeedThresholdsDecideIndependently(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	st.cursor, st.cursorFound = testFeedFrontier, true
	gap := 100 * time.Minute // > weETH's 90m, far below the stables' 25h
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggWeETH, big.NewInt(340_000_000_000), 1, clk.unix(-gap)),
		answerUpdatedLog(testFeedStart+11, 0, aggUSDC, big.NewInt(99_990_000), 2, clk.unix(-gap)),
		answerUpdatedLog(testFeedStart+12, 0, aggPYUSD, big.NewInt(100_000_000), 3, clk.unix(-gap)),
		answerUpdatedLog(testFeedStart+13, 0, aggFRAX, big.NewInt(99_980_000), 4, clk.unix(-gap)),
	}

	_, err := f.Step(context.Background())
	require.NoError(t, err)

	healthy, reason := f.Health()
	require.False(t, healthy)
	require.Contains(t, reason, "weETH", "the 1h-heartbeat stream is stale after 100 minutes")
	require.NotContains(t, reason, "USDC", "a 24h-heartbeat stream is not")
	require.NotContains(t, reason, "PYUSD")
	require.NotContains(t, reason, "FRAX")
}

// C1 (ROLLBACK WORLD): the apply's transaction rolled back, so memory must not
// describe the window. Freshness is re-hydrated from durable truth, which still
// holds only the pre-window answer.
func TestFeedDeriverApplyErrorRollbackResetsStagedFreshness(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// Durable: one OLD answer, below the window this Step will derive.
	old := answerUpdatedLog(testFeedStart-10, 0, aggUSDC, big.NewInt(99_000_000), 1, clk.unix(-30*time.Hour))
	fresh := answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 2, clk.unix(0))
	st.logs = []store.RawLog{old, fresh}
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.applyErrs = []error{errors.New("commit rolled back")}
	st.applyAdvancesDespiteErr = false

	_, err := f.Step(context.Background())
	require.ErrorContains(t, err, "commit rolled back")

	require.True(t, f.hydrated, "the reset re-hydrated from durable truth")
	require.Equal(t, clk.now().Add(-30*time.Hour).UTC(), f.lastUsable[aggUSDC],
		"the rolled-back window's fresh answer must NOT be retained in memory")
	require.Equal(t, []uint64{testFeedStart - 1, testFeedStart - 1}, st.latestLogCalls,
		"hydration runs at the unmoved durable cursor, before and after the failed apply")

	// THE CONSEQUENCE the finding cared about. Persisted ingestion is stalled at
	// the old cursor: the walker's frontier is there too and the chain head is
	// right above it, so the deriver is caught up AND live, and it must now issue
	// a verdict. Measured from durable truth, USDC's newest answer is 30h old and
	// the stream is STALE. With the pre-fix in-memory mutation, lastUsable would
	// hold the rolled-back window's fresh timestamp and this would report healthy.
	for _, s := range feedStreams {
		st.ingest[s] = &store.CursorPos{Block: testFeedStart - 1, Hash: []byte{0x03}}
	}
	ch.head = testFeedStart + 2
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, f.lastLive)
	healthy, reason := f.Health()
	require.False(t, healthy, "memory must not keep the feed looking fresh while nothing persisted")
	require.Contains(t, reason, "USDC")
	require.Contains(t, feedConditions(f), ConditionFeedPublication)
}

// C1 (COMMITTED-WITH-LOST-ACK WORLD): the transaction DID commit and only the
// acknowledgment was lost. Re-hydrating from durable truth picks up exactly what
// landed — which the caller could not have known from the error.
func TestFeedDeriverApplyErrorCommittedResetPicksUpWhatLanded(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	old := answerUpdatedLog(testFeedStart-10, 0, aggUSDC, big.NewInt(99_000_000), 1, clk.unix(-30*time.Hour))
	fresh := answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 2, clk.unix(0))
	st.logs = []store.RawLog{old, fresh}
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.applyErrs = []error{errors.New("commit ack lost")}
	st.applyAdvancesDespiteErr = true // the cursor DID move

	_, err := f.Step(context.Background())
	require.ErrorContains(t, err, "commit ack lost")

	require.True(t, f.hydrated)
	require.Equal(t, clk.now().UTC(), f.lastUsable[aggUSDC],
		"the window DID land, and re-hydration is what discovers that")
	require.Equal(t, []uint64{testFeedStart - 1, testFeedFrontier}, st.latestLogCalls,
		"the second hydration reads at the cursor the commit actually left behind")

	_, err = f.Step(context.Background())
	require.NoError(t, err)
	healthy, reason := f.Health()
	require.True(t, healthy, "the landed answer is genuinely fresh, got %q", reason)
}

// C1: a re-hydration that FAILS must suppress the verdict entirely rather than
// continue from state whose relationship to storage is unknown.
func TestFeedDeriverFailedRehydrationSuppressesVerdict(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+10, 0, aggUSDC, big.NewInt(99_990_000), 1, clk.unix(0)),
	}
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.applyErrs = []error{errors.New("commit rolled back")}
	// The first hydration succeeds; the database goes away before the reset's
	// re-read, which is the case that must not be papered over.
	st.latestLogsErrAfter = 1
	st.latestLogsErr = errors.New("database unreachable")

	_, err := f.Step(context.Background())
	require.Error(t, err)
	require.False(t, f.hydrated)
	require.True(t, containsSubstring(*msgs, "could not re-hydrate publication freshness"))
	require.Contains(t, feedConditions(f), ConditionFeedFreshnessUnhydrated)
	healthy, _ := f.Health()
	require.False(t, healthy, "an unknown freshness state must not read as healthy")
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
// every feed's newest answer is legitimately old, so no publication verdict is
// made at all — and the lag is reported as OURS.
func TestFeedDeriverStalenessSuspendedDuringBackfill(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedFrontier + 100_000, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{
		aggUSDC: 90 * 24 * time.Hour, // three months old, deep in history
	}, testFeedStart, testFeedFrontier)

	require.False(t, f.lastLive, "the frontier is 100k blocks behind head")
	got := feedConditions(f)
	require.NotContains(t, got, ConditionFeedPublication, "no publication verdict during backfill")
	require.Contains(t, got, ConditionRPCIngestLag, "the lag is reported as ours, separately")
	require.Contains(t, got[ConditionRPCIngestLag], "not feed staleness")
	require.Empty(t, ch.calls, "no aggregator() re-resolution during backfill")
}

// At live head, a feed past ITS OWN threshold goes STALE: WARN, FAILED health, and
// one aggregator() re-resolution on its PROXY.
func TestFeedDeriverStaleAtLiveHeadWarnsAndReResolves(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	// USDC last published 30h ago (> its 25h threshold); weETH just now.
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
	require.NotContains(t, feedConditions(f), ConditionRPCIngestLag,
		"our dependencies are fine: this is the feed's failure and must not be blended with ours")
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
	st.logs = append(st.logs,
		answerUpdatedLog(testFeedFrontier+5, 0, aggUSDC, big.NewInt(100_000_000), 9, clk.unix(0)))
	_, err := f.Step(context.Background()) // derives the new window
	require.NoError(t, err)
	clk.advance(headProbeInterval + time.Second) // let the head probe re-run
	_, err = f.Step(context.Background())        // caught up: re-evaluates
	require.NoError(t, err)

	healthy, reason := f.Health()
	require.True(t, healthy, "the resumed feed cleared the verdict, got %q", reason)
}

// A feed that has published NOTHING at all still trips after its own threshold:
// "never observed" must not read as "forever fresh".
func TestFeedDeriverNeverPublishedTripsAfterThreshold(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// No logs at all: every stream is unobserved.
	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{}, testFeedStart, testFeedFrontier)
	healthy, _ := f.Health()
	require.True(t, healthy, "within the grace window since going live, nothing is stale yet")

	// Past weETH's 90-minute bound but inside the stables' 25h: only weETH trips,
	// and it trips on ITS OWN clock.
	clk.advance(2 * time.Hour)
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	healthy, reason := f.Health()
	require.False(t, healthy)
	require.Contains(t, reason, "weETH")
	require.NotContains(t, reason, "PYUSD")

	clk.advance(26 * time.Hour)
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	_, reason = f.Health()
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

// B5 (PROBE FAILURE + TTL): a head probe that FAILS keeps the previous verdict
// briefly — an RPC hiccup should not flip an operator signal — but the verdict
// EXPIRES, and the failure is then reported as RPC/ingest lag rather than as four
// stale feeds. Without the TTL, repeated errors preserved lastLive forever.
func TestFeedDeriverLiveVerdictExpiresAndReportsLagNotStaleFeeds(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{aggUSDC: 0}, testFeedStart, testFeedFrontier)
	require.True(t, f.lastLive)

	// Probes start failing.
	ch.headErr = context.DeadlineExceeded
	clk.advance(headProbeInterval + time.Second)
	advanced, err := f.Step(context.Background())
	require.NoError(t, err, "a probe failure is telemetry, not a Step failure")
	require.False(t, advanced)
	require.True(t, f.lastLive, "one hiccup does not flip the verdict")
	require.True(t, containsSubstring(*msgs, "chain head probe failed"))
	require.NotContains(t, feedConditions(f), ConditionRPCIngestLag)

	// Keep failing past the TTL.
	clk.advance(liveVerdictTTL + time.Second)
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	require.False(t, f.lastLive, "the cached verdict must expire without confirmation")
	got := feedConditions(f)
	require.Contains(t, got, ConditionRPCIngestLag)
	require.Contains(t, got[ConditionRPCIngestLag], "no confirmed live head")
	require.NotContains(t, got, ConditionFeedPublication,
		"an RPC outage must not be reported as feed publication staleness")
	require.True(t, containsSubstring(*msgs, "live-head verdict EXPIRED"))
}

// B5 (THE CO-FROZEN CASE): RPC and ingest frozen at the SAME old height keeps the
// block GAP small, so the gap test alone says "live" and wall-clock aging then
// marks every feed stale. The head's own header TIMESTAMP is what catches it.
func TestFeedDeriverFrozenHeadTimestampIsReportedAsLagNotStaleFeeds(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{aggUSDC: 0}, testFeedStart, testFeedFrontier)
	require.True(t, f.lastLive)

	// Everything freezes: the endpoint still answers, the height is unchanged and
	// within slack, but the header it returns keeps claiming its original time.
	ch.headAge = 3 * time.Hour
	clk.advance(headProbeInterval + time.Second)
	_, err := f.Step(context.Background())
	require.NoError(t, err)

	require.False(t, f.lastLive, "a head whose own timestamp is hours old is not a live head")
	got := feedConditions(f)
	require.Contains(t, got, ConditionRPCIngestLag)
	require.Contains(t, got[ConditionRPCIngestLag], "by its own header timestamp")
	require.NotContains(t, got, ConditionFeedPublication,
		"the four feeds must not be blamed for one frozen dependency")
	require.True(t, containsSubstring(*msgs, "own TIMESTAMP is stale"))

	// And it recovers cleanly once the dependency does.
	ch.headAge = 0
	clk.advance(headProbeInterval + time.Second)
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, f.lastLive)
	healthy, reason := f.Health()
	require.True(t, healthy, "got %q", reason)
}

// B5 (INDEPENDENT ROUTING): the probe deliberately avoids the endpoint ingestion
// is pinned to, so it does not ask the possibly-frozen node whether it is frozen.
func TestFeedDeriverHeadProbeAvoidsTheSharedIngestEndpoint(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, endpoints: 3, active: 1,
		callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{aggUSDC: 0}, testFeedStart, testFeedFrontier)
	require.Equal(t, []int{2}, ch.headStarts, "one past the shared hint the walker is using")

	ch.active = 2
	clk.advance(headProbeInterval + time.Second)
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, []int{2, 0}, ch.headStarts, "it tracks the shared hint as it moves")
}

// With a SINGLE endpoint, independent routing is impossible. That is disclosed,
// not hidden: the probe still runs (from index 0) and the timestamp check plus the
// TTL are the guards.
func TestFeedDeriverSingleEndpointProbeIsNotIndependent(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, endpoints: 1,
		callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	deriveToCaughtUp(t, f, st, clk, map[common.Address]time.Duration{aggUSDC: 0}, testFeedStart, testFeedFrontier)
	require.Equal(t, []int{0}, ch.headStarts, "nothing to route around")
	require.True(t, f.lastLive)
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

// TIMESTAMP: an oracle-supplied updatedAt is untrusted input to the health signal.
// An implausible one must establish no freshness, and the verdict must be a
// function of DURABLE facts only.
//
// Two earlier versions each failed half of that. Clamping to f.now() made the
// observation time a process timestamp, so the same log re-clamped on every
// hydration. Refusing against f.now() was durable only while wall-clock stayed
// behind the claimed time — the round-3 finding. The comparison is now against the
// log's own raw_logs.ingested_at, so it cannot move at all.
func TestFeedDeriverRefusesImplausibleUpdatedAtInsteadOfClamping(t *testing.T) {
	for _, tc := range []struct {
		name      string
		updatedAt func(clk *testClock) uint64
		wantWarn  string
	}{
		{"far future", func(clk *testClock) uint64 { return clk.unix(100 * time.Hour) }, "implausibly far AHEAD OF ITS OWN DURABLE INGESTION TIME"},
		{"out of int64 range", func(*testClock) uint64 { return ^uint64(0) }, "OUT-OF-RANGE updatedAt"},
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
			require.NotContains(t, f.lastUsable, aggUSDC,
				"an unusable timestamp must establish NO freshness — substituting the process clock is what made freshness resettable by restart")
			require.Contains(t, f.timestampFlawed, aggUSDC)

			_, err = f.Step(context.Background()) // caught up: go live
			require.NoError(t, err)
			healthy, reason := f.Health()
			require.False(t, healthy, "an unusable newest timestamp is an unhealthy DURABLE condition, got %q", reason)
			require.Contains(t, feedConditions(f), ConditionFeedTimestamp)

			// THE RESTART TEST: a fresh process re-decodes the SAME log at the SAME
			// cursor. Under the clamp it re-derived a brand-new "observed now" and
			// reported the feed healthy for another full threshold.
			f2, clk2 := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
			clk2.advance(3 * time.Hour) // a much later process start
			st.cursor, st.cursorFound = testFeedFrontier, true
			_, err = f2.Step(context.Background())
			require.NoError(t, err)
			require.NotContains(t, f2.lastUsable, aggUSDC,
				"the restarted process must reach the same conclusion from the same durable log")
			require.Contains(t, feedConditions(f2), ConditionFeedTimestamp)
			healthy, _ = f2.Health()
			require.False(t, healthy, "a restart must not grant a malformed-timestamp feed a fresh window")
		})
	}
}

// TIMESTAMP, THE ROUND-3 FINDING ITSELF: the refusal must not dissolve when
// wall-clock catches up to the claimed time.
//
// The previous implementation compared updatedAt against the process clock. The
// same persisted log was therefore rejected while the clock was more than the
// tolerance behind the claimed timestamp and ACCEPTED after a later restart once
// the clock had approached it — with no new durable fact anywhere. Acceptance then
// moved lastUsable to that future time, greening readiness for the tolerance plus
// a full heartbeat-and-grace window without a single new publication.
//
// This drives the exact crossover: one log, one ingestion time, and a restart on
// the far side of the two-minute boundary. The verdict must be identical.
func TestFeedDeriverFutureTimestampRefusalSurvivesTheWallClockCrossover(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// The log is ingested NOW and claims a timestamp 30 minutes ahead of that —
	// far outside the two-minute tolerance.
	ingestedAt := clk.now()
	claimed := ingestedAt.Add(30 * time.Minute)
	log := answerUpdatedLog(testFeedStart+1, 0, aggUSDC, big.NewInt(100_000_000), 1, uint64(claimed.Unix()))
	log.IngestedAt = ingestedAt
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{log}

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	require.Contains(t, feedConditions(f), ConditionFeedTimestamp, "rejected on first observation")
	require.NotContains(t, f.lastUsable, aggUSDC)

	// A LATER PROCESS, started an hour after the claimed timestamp: wall-clock is
	// now well PAST the time the log claimed, which is exactly the state in which
	// the old code accepted it. The durable ingestion time has not changed, so the
	// verdict must not either.
	f2, clk2 := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	clk2.advance(90 * time.Minute)
	require.True(t, clk2.now().After(claimed), "the restarted process's clock is past the claimed timestamp")
	st.cursor, st.cursorFound = testFeedFrontier, true

	_, err = f2.Step(context.Background())
	require.NoError(t, err)
	require.NotContains(t, f2.lastUsable, aggUSDC,
		"the clock moving is not a new durable fact: a previously implausible log must not become usable")
	require.Contains(t, feedConditions(f2), ConditionFeedTimestamp)
	require.Contains(t, feedConditions(f2)[ConditionFeedTimestamp], "durable ingestion time",
		"the reason names the durable fact the verdict rests on, not a clock")
	healthy, _ := f2.Health()
	require.False(t, healthy)
}

// A future timestamp INSIDE the tolerance is a clock artefact, not a malformed
// answer: it is accepted — and CAPPED at the log's durable ingestion time, so
// freshness can never run ahead of the moment the log became durable.
//
// The earlier version took such a timestamp verbatim, which suppressed staleness by
// up to the tolerance. Capping removes that window rather than bounding it.
func TestFeedDeriverAcceptsSmallClockSkewButCapsFreshnessAtIngestion(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	skew := futureTimestampTolerance / 2
	ingestedAt := clk.now()
	// One aggregator's answer leans into the future inside the tolerance; another's
	// is an ordinary past publication. Both are ingested at the same instant, so the
	// two together show that the cap only ever LOWERS.
	skewed := answerUpdatedLog(testFeedStart+1, 0, aggUSDC, big.NewInt(100_000_000), 1, clk.unix(skew))
	skewed.IngestedAt = ingestedAt
	past := clk.now().Add(-time.Hour)
	ordinary := answerUpdatedLog(testFeedStart+2, 0, aggWeETH, big.NewInt(300_000_000_000), 1, uint64(past.Unix()))
	ordinary.IngestedAt = ingestedAt
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{skewed, ordinary}

	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.NotContains(t, f.timestampFlawed, aggUSDC, "a within-tolerance skew is accepted, not refused")
	require.Equal(t, ingestedAt.UTC(), f.lastUsable[aggUSDC],
		"freshness is capped at the DURABLE observation time, so a future-leaning oracle clock cannot buy a fresher verdict")
	require.Equal(t, past.UTC(), f.lastUsable[aggWeETH],
		"a publication legitimately precedes its ingestion, and that time stands unchanged")
}

// A log carrying NO durable ingestion time cannot have its timestamp judged, so it
// establishes no freshness rather than falling back to a clock. raw_logs.ingested_at
// is NOT NULL, so this row is impossible in production — the test exists to prove
// the guard is there rather than assumed away.
func TestFeedDeriverRefusesAnswerWithNoDurableIngestionTime(t *testing.T) {
	st := newFakePriceStore()
	st.logsWithoutIngestionTime = true
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)
	msgs := captureWarnings(t)

	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+1, 0, aggUSDC, big.NewInt(100_000_000), 1, clk.unix(-time.Minute)),
	}
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	require.True(t, containsSubstring(*msgs, "carries no durable ingestion time"))
	require.NotContains(t, f.lastUsable, aggUSDC)
	require.Contains(t, f.timestampFlawed, aggUSDC)
}

// B-invalid (FEED SIDE): a stream publishing a non-positive answer every heartbeat
// is publishing, and the store quarantines the row so no consumer can select it —
// but that protects consumers, not health. The answer must not refresh usable
// freshness, and the unusable newest answer is reported explicitly.
func TestFeedDeriverNonPositiveAnswerDoesNotRefreshFreshness(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakeFeedChain{head: testFeedHead, callResp: proxyResponder(t, identityProxies(t))}
	f, clk := newTestFeed(t, st, ch, testFeedStart, testFeedFrontier)

	// A good answer 30 hours ago (past USDC's 25h threshold), then zeros right up
	// to the present. The stream looks perfectly alive.
	st.cursor, st.cursorFound = testFeedStart-1, true
	st.logs = []store.RawLog{
		answerUpdatedLog(testFeedStart+1, 0, aggUSDC, big.NewInt(99_990_000), 1, clk.unix(-30*time.Hour)),
		answerUpdatedLog(testFeedStart+2, 0, aggUSDC, big.NewInt(0), 2, clk.unix(-time.Minute)),
	}
	_, err := f.Step(context.Background())
	require.NoError(t, err)
	_, err = f.Step(context.Background()) // caught up: go live and evaluate
	require.NoError(t, err)

	require.Equal(t, clk.now().Add(-30*time.Hour).UTC(), f.lastUsable[aggUSDC],
		"freshness stands at the last USABLE answer, not at the zero published a minute ago")
	got := feedConditions(f)
	require.Contains(t, got, ConditionFeedInvalidAnswer, "the unusable newest answer is named")
	require.Contains(t, got[ConditionFeedInvalidAnswer], "USDC")
	require.Contains(t, got, ConditionFeedPublication,
		"and there has been no usable answer inside this feed's own heartbeat+grace")
	healthy, _ := f.Health()
	require.False(t, healthy)

	// A usable answer clears both: this class is recoverable.
	for _, s := range feedStreams {
		st.ingest[s] = &store.CursorPos{Block: testFeedFrontier + 10, Hash: []byte{0x02}}
	}
	ch.head = testFeedFrontier + 15
	st.logs = append(st.logs,
		answerUpdatedLog(testFeedFrontier+5, 0, aggUSDC, big.NewInt(100_000_000), 3, clk.unix(0)))
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	clk.advance(headProbeInterval + time.Second)
	_, err = f.Step(context.Background())
	require.NoError(t, err)
	got = feedConditions(f)
	require.NotContains(t, got, ConditionFeedInvalidAnswer)
	require.NotContains(t, got, ConditionFeedPublication)
}

// Sources() reports the mechanism names this deriver writes: exactly the four
// chainlink:<aggregator> names, one per configured stream. It is NOT the rewind
// scope any more — that is the owner engine, which is what makes a phase change
// unable to orphan rows.
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
