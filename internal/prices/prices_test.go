package prices

// Shared fakes and the package's foundational pins: function selectors (against
// keccak of the signature strings, plus the literals recon recorded
// independently), source naming, cursor-key namespacing, batch de-duplication,
// and the registry → poll-obligation resolution against the REAL
// recon/feeds.json.
//
// Multicall and view responses are built through the SAME ABI objects the
// production code decodes with, so a shape mismatch cannot hide behind a
// hand-rolled fixture. AnswerUpdated logs are decoded by the REAL
// decode.Registry (not a fake), so the topic0, the indexed int256 and the
// updatedAt word are all exercised for real.

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Registry fixtures.
// ---------------------------------------------------------------------------

var testChains = map[string]config.Chain{
	"op":  {ChainID: 10, RPCURLs: []string{"https://a.example"}},
	"eth": {ChainID: 1, RPCURLs: []string{"https://b.example"}},
}

// realFeeds loads the production registry — the artifact the daemon runs on.
func realFeeds(t *testing.T) *config.Feeds {
	t.Helper()
	feeds, err := config.LoadFeeds(filepath.Join("..", "..", "recon", "feeds.json"), testChains)
	require.NoError(t, err)
	return feeds
}

// Registry addresses used across the tests.
var (
	priceProviderV2 = common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
	weethETH        = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	usdcETH         = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	aggWeETH        = common.HexToAddress("0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5")
	aggUSDC         = common.HexToAddress("0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7")
	proxyWeETH      = common.HexToAddress("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419")
	proxyUSDC       = common.HexToAddress("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6")
)

// answerUpdatedTopic0 is the AnswerUpdated signature hash recon recorded
// independently (recon/derivation-notes.md "Oracle wiring").
var answerUpdatedTopic0 = common.HexToHash("0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f")

// ---------------------------------------------------------------------------
// Fake store.
// ---------------------------------------------------------------------------

type appliedBatch struct {
	engine  string
	chainID uint64
	obs     []store.PriceObservation
	through uint64
}

type rewindRec struct {
	engine  string
	chainID uint64
	toBlock uint64
	sources []string
}

// fakePriceStore models the durable surface both workers drive: a single
// pseudo-engine cursor, the unacked-epoch flag, and the apply/rewind history.
type fakePriceStore struct {
	cursor      uint64
	cursorFound bool
	unacked     bool

	applied []appliedBatch
	rewinds []rewindRec

	// applyErrs is a FIFO of one-shot ApplyPrices failures. A non-nil entry is
	// returned instead of applying; applyAdvancesDespiteErr models the
	// commit-landed-with-lost-ack world.
	applyErrs               []error
	applyAdvancesDespiteErr bool

	// rewindDeepTo, when set, lands the cursor at min(requested, rewindDeepTo) —
	// RewindPrices' deepest-unacked-epoch lowering.
	rewindDeepTo *uint64
	// rewindLeavesNoCursor models the store-contract violation the workers
	// assert against.
	rewindLeavesNoCursor bool

	ingest map[string]*store.CursorPos
	logs   []store.RawLog

	rawLogsCalls [][2]uint64
}

func newFakePriceStore() *fakePriceStore {
	return &fakePriceStore{ingest: map[string]*store.CursorPos{}}
}

func (f *fakePriceStore) DeriveCursor(context.Context, string) (uint64, bool, error) {
	return f.cursor, f.cursorFound, nil
}

func (f *fakePriceStore) HasUnackedReorg(context.Context, string, uint64) (bool, error) {
	return f.unacked, nil
}

func (f *fakePriceStore) ApplyPrices(_ context.Context, engine string, chainID uint64, obs []store.PriceObservation, through uint64) error {
	f.applied = append(f.applied, appliedBatch{engine: engine, chainID: chainID, obs: obs, through: through})
	if len(f.applyErrs) > 0 {
		err := f.applyErrs[0]
		f.applyErrs = f.applyErrs[1:]
		if err != nil {
			if f.applyAdvancesDespiteErr {
				f.cursor, f.cursorFound = through, true
			}
			return err
		}
	}
	f.cursor, f.cursorFound = through, true
	return nil
}

func (f *fakePriceStore) RewindPrices(_ context.Context, engine string, chainID, toBlock uint64, sources []string) error {
	f.rewinds = append(f.rewinds, rewindRec{engine: engine, chainID: chainID, toBlock: toBlock, sources: sources})
	effective := toBlock
	if f.rewindDeepTo != nil && *f.rewindDeepTo < effective {
		effective = *f.rewindDeepTo
	}
	f.unacked = false // RewindPrices acks every epoch on the chain
	if f.rewindLeavesNoCursor {
		f.cursorFound = false
		return nil
	}
	f.cursor, f.cursorFound = effective, true
	return nil
}

func (f *fakePriceStore) Cursor(_ context.Context, stream string) (*store.CursorPos, error) {
	return f.ingest[stream], nil
}

// RawLogsInRange mirrors the real store's ORDERING contract — ascending
// (block_number, log_index), the total order the derivation layer requires — so
// a test cannot pass merely because the fake handed logs back in insertion
// order.
func (f *fakePriceStore) RawLogsInRange(_ context.Context, _ uint64, _ [][]byte, from, to uint64) ([]store.RawLog, error) {
	f.rawLogsCalls = append(f.rawLogsCalls, [2]uint64{from, to})
	var out []store.RawLog
	for _, l := range f.logs {
		if l.BlockNumber >= from && l.BlockNumber <= to {
			out = append(out, l)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].BlockNumber != out[j].BlockNumber {
			return out[i].BlockNumber < out[j].BlockNumber
		}
		return out[i].LogIndex < out[j].LogIndex
	})
	return out, nil
}

// lastBatch returns the most recent ApplyPrices call.
func (f *fakePriceStore) lastBatch(t *testing.T) appliedBatch {
	t.Helper()
	require.NotEmpty(t, f.applied, "no ApplyPrices call was made")
	return f.applied[len(f.applied)-1]
}

// ---------------------------------------------------------------------------
// Fake chains.
// ---------------------------------------------------------------------------

type capturedCall struct {
	to   common.Address
	data []byte
}

// fakePollChain models chain.Failover's routing contract: CallWithToken serves
// from the SHARED sticky hint, CallFrom serves from the caller-given start
// WITHOUT touching that hint, and every call stamps its token with the endpoint
// that served it — so the tests prove the POLLER, not the fake, chooses the
// endpoint.
type fakePollChain struct {
	endpoints int
	active    int
	// respond answers per endpoint index; a nil entry means "reuse index 0".
	respond func(idx int, to common.Address, data []byte) ([]byte, error)

	calls  []capturedCall
	served []int
	starts []int // CallFrom start indices, in order
}

func (c *fakePollChain) CallWithToken(_ context.Context, to common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	return c.serve(c.active, to, data)
}

func (c *fakePollChain) CallFrom(_ context.Context, start int, to common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	c.starts = append(c.starts, start)
	idx := start
	if c.endpoints > 0 {
		idx = ((start % c.endpoints) + c.endpoints) % c.endpoints
	}
	return c.serve(idx, to, data)
}

func (c *fakePollChain) EndpointCount() int { return c.endpoints }

func (c *fakePollChain) serve(idx int, to common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	c.calls = append(c.calls, capturedCall{to: to, data: data})
	c.served = append(c.served, idx)
	out, err := c.respond(idx, to, data)
	if err != nil {
		return nil, chain.EndpointToken{Index: -1}, err
	}
	return out, chain.EndpointToken{Index: idx}, nil
}

// fakeFeedChain models the feed deriver's narrow surface: a head probe and a
// plain eth_call (for the proxy aggregator() re-resolution).
type fakeFeedChain struct {
	head     uint64
	headErr  error
	headHits int

	callResp func(to common.Address, data []byte) ([]byte, error)
	calls    []capturedCall
}

func (c *fakeFeedChain) BlockNumber(context.Context) (uint64, error) {
	c.headHits++
	return c.head, c.headErr
}

func (c *fakeFeedChain) Call(_ context.Context, to common.Address, data []byte) ([]byte, error) {
	c.calls = append(c.calls, capturedCall{to: to, data: data})
	if c.callResp == nil {
		return nil, fmt.Errorf("fake feed chain: no responder")
	}
	return c.callResp(to, data)
}

// ---------------------------------------------------------------------------
// Response builders (through the production ABI objects).
// ---------------------------------------------------------------------------

// mcRet mirrors multicall3's (bool success, bytes returnData) output tuple.
type mcRet struct {
	Success    bool
	ReturnData []byte
}

// encodeMulticall builds a tryBlockAndAggregate return carrying block and rets.
func encodeMulticall(t *testing.T, block uint64, rets []mcRet) []byte {
	t.Helper()
	out, err := multicall3ABI.Methods["tryBlockAndAggregate"].Outputs.Pack(
		new(big.Int).SetUint64(block), [32]byte{}, rets)
	require.NoError(t, err)
	return out
}

// encodeUint256 builds a single-uint256 view return.
func encodeUint256(t *testing.T, v *big.Int) []byte {
	t.Helper()
	out, err := priceProviderABI.Methods["price"].Outputs.Pack(v)
	require.NoError(t, err)
	return out
}

// encodeAddress builds a single-address view return (aggregator()).
func encodeAddress(t *testing.T, a common.Address) []byte {
	t.Helper()
	out, err := chainlinkProxyABI.Methods["aggregator"].Outputs.Pack(a)
	require.NoError(t, err)
	return out
}

// decodeMulticallCalls unpacks a tryBlockAndAggregate REQUEST so a test can
// assert the exact (target, callData) list the worker submitted.
func decodeMulticallCalls(t *testing.T, input []byte) (bool, []multicall3Call) {
	t.Helper()
	m := multicall3ABI.Methods["tryBlockAndAggregate"]
	require.Equal(t, m.ID, input[:4], "selector")
	vals, err := m.Inputs.Unpack(input[4:])
	require.NoError(t, err)
	require.Len(t, vals, 2)
	requireSuccess := vals[0].(bool)
	raw := vals[1].([]struct {
		Target   common.Address `json:"target"`
		CallData []byte         `json:"callData"`
	})
	out := make([]multicall3Call, len(raw))
	for i, c := range raw {
		out[i] = multicall3Call{Target: c.Target, CallData: c.CallData}
	}
	return requireSuccess, out
}

// answerUpdatedLog builds a raw AnswerUpdated log the REAL decode.Registry can
// decode: topic0 from recon, the indexed int256 answer in two's complement, the
// indexed roundId, and updatedAt in the data word.
func answerUpdatedLog(block uint64, logIndex uint32, agg common.Address, answer *big.Int, roundID, updatedAt uint64) store.RawLog {
	current := math.U256Bytes(new(big.Int).Set(answer))
	return store.RawLog{
		ChainID:     1,
		BlockNumber: block,
		BlockHash:   common.BytesToHash([]byte{byte(block)}).Bytes(),
		TxHash:      common.BytesToHash([]byte{byte(block), byte(logIndex)}).Bytes(),
		LogIndex:    logIndex,
		Address:     agg.Bytes(),
		Topics: [][]byte{
			answerUpdatedTopic0.Bytes(),
			current,
			common.BigToHash(new(big.Int).SetUint64(roundID)).Bytes(),
		},
		Data: common.BigToHash(new(big.Int).SetUint64(updatedAt)).Bytes(),
	}
}

// ---------------------------------------------------------------------------
// Selector and naming pins.
// ---------------------------------------------------------------------------

// TestSelectors pins every function selector this package packs against keccak
// of its signature string. Three of them are cross-checked against literals
// recorded INDEPENDENTLY in recon/derivation-notes.md and internal/snapshot, so
// the pin is not merely self-consistent with the ABI JSON in this file.
func TestSelectors(t *testing.T) {
	cases := []struct {
		signature string
		got       []byte
		literal   string // independently recorded value, "" when none
	}{
		{"price(address)", priceProviderABI.Methods["price"].ID, "0xaea91078"},
		// recon "Oracle wiring": accountant lenses, calldata 0x679aefce = getRate()
		{"getRate()", rateProviderABI.Methods["getRate"].ID, "0x679aefce"},
		{"aggregator()", chainlinkProxyABI.Methods["aggregator"].ID, "0x245a7bfc"},
		// internal/snapshot pins the same multicall3 selector against `cast sig`.
		{"tryBlockAndAggregate(bool,(address,bytes)[])",
			multicall3ABI.Methods["tryBlockAndAggregate"].ID, "0x399542e9"},
	}
	for _, tc := range cases {
		want := crypto.Keccak256([]byte(tc.signature))[:4]
		require.Equal(t, want, tc.got, "%s: ABI-derived selector must equal keccak(signature)[:4]", tc.signature)
		if tc.literal != "" {
			require.Equal(t, tc.literal, fmt.Sprintf("0x%x", tc.got), tc.signature)
		}
	}

	// The AnswerUpdated topic0 the walker ingests and the deriver reads back.
	require.Equal(t, answerUpdatedTopic0.Bytes(),
		crypto.Keccak256([]byte("AnswerUpdated(int256,uint256,uint256)")),
		"recon's recorded AnswerUpdated topic0")
}

// Source names are deterministic functions of the mechanism, lowercase so a
// checksum-cased variant can never split one aggregator's history in two.
func TestSourceNaming(t *testing.T) {
	require.Equal(t, "priceproviderv2", SourcePriceProviderV2)
	require.Equal(t, "chainlink:0x7d4e742018fb52e48b08be73d041c18b21de6fb5", ChainlinkSource(aggWeETH))
	require.Equal(t, "ratio:getrate:0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
		RatioSource("getRate()", weethETH))
	// Case-insensitive input, identical output.
	require.Equal(t, ChainlinkSource(aggWeETH),
		ChainlinkSource(common.HexToAddress("0x7D4E742018FB52E48B08BE73D041C18B21DE6FB5")))
}

// Cursor keys are colon-namespaced and chain-id-qualified, so they can never
// collide with a config engine name (review flag M4's accepted resolution).
func TestCursorKeysCannotCollideWithEngines(t *testing.T) {
	keys := []string{PollCursorEngine(10), PollCursorEngine(1), FeedCursorEngine(1)}
	require.Equal(t, []string{"prices:poll:10", "prices:poll:1", "prices:chainlink_feed:1"}, keys)
	for _, k := range keys {
		require.False(t, config.KnownEngines[k], "%s must not be a config engine name", k)
		require.Contains(t, k, ":", "%s must carry the namespace separator engine names lack", k)
	}
	for engine := range config.KnownEngines {
		require.NotContains(t, engine, ":",
			"engine %q gained a colon: the price cursor namespace is no longer collision-proof", engine)
	}
	require.NotEqual(t, PollCursorEngine(1), PollCursorEngine(10),
		"the poller spans two chains, so its cursor must be per-chain")
}

// Two observations on ONE (asset, source, block) key collapse LAST-WINS: the
// store aborts a batch on a divergent replay of a key, so a legitimate
// same-block re-publication must not wedge the write.
func TestPriceSetLastWinsAndCopies(t *testing.T) {
	set := newPriceSet()
	asset := weethETH.Bytes()
	price := big.NewInt(100)
	set.add(store.PriceObservation{Asset: asset, Source: "s", Price: price, Decimals: 8, BlockNumber: 5})
	set.add(store.PriceObservation{Asset: asset, Source: "s", Price: big.NewInt(200), Decimals: 8, BlockNumber: 5})
	set.add(store.PriceObservation{Asset: asset, Source: "s", Price: big.NewInt(300), Decimals: 8, BlockNumber: 6})

	obs := set.observations()
	require.Len(t, obs, 2, "one row per key")
	require.Equal(t, uint64(5), obs[0].BlockNumber, "insertion order preserved")
	require.Equal(t, "200", obs[0].Price.String(), "last write wins at block 5")
	require.Equal(t, "300", obs[1].Price.String())

	// Defensive copies: mutating the caller's inputs must not touch the batch.
	price.SetInt64(999)
	asset[0] = 0xFF
	require.Equal(t, "200", obs[0].Price.String())
	require.Equal(t, weethETH.Bytes()[0], obs[0].Asset[0])
}

// A nil price is passed through UNCHANGED (never copied — which would panic —
// and never coerced to zero, which would fabricate a price): the store's named
// refusal is the fail-loud path.
func TestPriceSetPassesNilPriceThrough(t *testing.T) {
	set := newPriceSet()
	set.add(store.PriceObservation{Asset: weethETH.Bytes(), Source: "s", Decimals: 8, BlockNumber: 5})
	obs := set.observations()
	require.Len(t, obs, 1)
	require.Nil(t, obs[0].Price)
}

// buildPollTargets resolves the REAL registry: 20 engine-exact OP obligations
// and the single ETH weETH getRate() ratio.
func TestBuildPollTargetsFromRealRegistry(t *testing.T) {
	feeds := realFeeds(t)

	op, err := buildPollTargets(feeds, 10)
	require.NoError(t, err)
	require.Len(t, op, 20)
	for _, tg := range op {
		require.Equal(t, priceProviderV2, tg.Contract, tg.Symbol)
		require.Equal(t, "price(address)", tg.Method, tg.Symbol)
		require.Equal(t, SourcePriceProviderV2, tg.Source, tg.Symbol)
		require.Equal(t, int32(6), tg.Decimals, tg.Symbol)
	}
	require.Equal(t, []string{SourcePriceProviderV2}, sourcesOf(op),
		"all 20 OP obligations share one mechanism name")

	eth, err := buildPollTargets(feeds, 1)
	require.NoError(t, err)
	require.Len(t, eth, 1, "only the weETH ratio is polled on ETH")
	require.Equal(t, "weETH", eth[0].Symbol)
	require.Equal(t, weethETH, eth[0].Asset)
	require.Equal(t, "getRate()", eth[0].Method)
	require.Equal(t, int32(18), eth[0].Decimals)
	require.Equal(t, RatioSource("getRate()", weethETH), eth[0].Source)
}

// An unsupported oracle method is a CONSTRUCTION refusal, not a runtime skip: a
// silently-skipped asset is a silently-missing price.
func TestBuildPollTargetsRefusesUnsupportedMethod(t *testing.T) {
	feeds := &config.Feeds{Assets: []config.Feed{{
		Chain: "op", ChainID: 10, Engine: "debt_manager", Address: usdcETH,
		Symbol: "USDC", Decimals: 6, Roles: []string{"debt"},
		Oracle: config.FeedOracle{
			Kind: config.FeedKindPoll, Contract: priceProviderV2,
			Method: "latestAnswer()", PriceDecimals: 8,
		},
	}}}
	_, err := buildPollTargets(feeds, 10)
	require.ErrorContains(t, err, `oracle method "latestAnswer()" is not supported`)
}

// The flat "priceproviderv2" source carries no address, so two PriceProvider
// deployments would write rows claiming a provenance they do not have.
func TestBuildPollTargetsRefusesTwoContractsUnderOneSource(t *testing.T) {
	other := common.HexToAddress("0x1111111111111111111111111111111111111111")
	mk := func(asset, oracle common.Address, symbol string) config.Feed {
		return config.Feed{
			Chain: "op", ChainID: 10, Engine: "debt_manager", Address: asset,
			Symbol: symbol, Decimals: 6, Roles: []string{"debt"},
			Oracle: config.FeedOracle{
				Kind: config.FeedKindPoll, Contract: oracle,
				Method: "price(address)", PriceDecimals: 6,
			},
		}
	}
	feeds := &config.Feeds{Assets: []config.Feed{
		mk(usdcETH, priceProviderV2, "USDC"),
		mk(weethETH, other, "weETH"),
	}}
	_, err := buildPollTargets(feeds, 10)
	require.ErrorContains(t, err, "already bound to contract")
}

// unpack* convert malformed provider bytes into errors rather than panicking.
func TestUnpackHardening(t *testing.T) {
	_, err := unpackUint256("price", priceProviderABI, []byte{0x01, 0x02})
	require.Error(t, err)
	_, err = unpackAddress("aggregator", chainlinkProxyABI, []byte{0x01})
	require.Error(t, err)
	_, _, err = unpackMulticallResult([]byte{0xde, 0xad}, 1)
	require.Error(t, err)

	// A well-formed envelope with the WRONG result count is refused: silently
	// zipping N results onto M targets would mis-attribute prices.
	out := encodeMulticall(t, 100, []mcRet{{Success: true, ReturnData: encodeUint256(t, big.NewInt(1))}})
	_, _, err = unpackMulticallResult(out, 2)
	require.ErrorContains(t, err, "1 results for 2 calls")
}

// ---------------------------------------------------------------------------
// Shared test clock.
// ---------------------------------------------------------------------------

type testClock struct{ t time.Time }

func newTestClock() *testClock {
	return &testClock{t: time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)}
}

func (c *testClock) now() time.Time          { return c.t }
func (c *testClock) advance(d time.Duration) { c.t = c.t.Add(d) }
func (c *testClock) unix(offset time.Duration) uint64 {
	return uint64(c.t.Add(offset).Unix())
}

// ---------------------------------------------------------------------------
// Log capture.
// ---------------------------------------------------------------------------

// TestMain silences the workers' operational logging by default; individual
// tests that assert ON a log route it through captureWarnings instead.
func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	os.Exit(m.Run())
}

// captureWarnings routes slog through a collector for the duration of the test
// and returns the accumulating WARN/ERROR message slice.
func captureWarnings(t *testing.T) *[]string {
	t.Helper()
	msgs := []string{}
	prev := slog.Default()
	slog.SetDefault(slog.New(warnCollector{msgs: &msgs}))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &msgs
}

type warnCollector struct{ msgs *[]string }

func (w warnCollector) Enabled(context.Context, slog.Level) bool { return true }
func (w warnCollector) Handle(_ context.Context, r slog.Record) error {
	if r.Level >= slog.LevelWarn {
		*w.msgs = append(*w.msgs, r.Message)
	}
	return nil
}
func (w warnCollector) WithAttrs([]slog.Attr) slog.Handler { return w }
func (w warnCollector) WithGroup(string) slog.Handler      { return w }

// containsSubstring reports whether any captured message contains want.
func containsSubstring(msgs []string, want string) bool {
	for _, m := range msgs {
		if strings.Contains(m, want) {
			return true
		}
	}
	return false
}
