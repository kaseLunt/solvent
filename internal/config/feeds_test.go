package config

// Feed-registry loader tests. The POSITIVE case reads the REAL
// recon/feeds.json — the artifact Task 8 is driven from — so a registry edit
// that breaks the normative facts (PriceProviderV2 address, 6-dec OP prices,
// 8-dec streams, the four raw aggregators and their proxies, the weETH ratio
// declaration) fails here rather than in production. The NEGATIVE cases are
// generated from one in-line template so every refusal branch is covered
// without carrying a testdata file per branch.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

var testFeedChains = map[string]Chain{
	"op":  {ChainID: 10, RPCURLs: []string{"https://a.example"}},
	"eth": {ChainID: 1, RPCURLs: []string{"https://b.example"}},
}

// TestLoadRealFeedRegistry pins the normative recon facts the price ingestion
// depends on (recon/derivation-notes.md "Oracle wiring").
func TestLoadRealFeedRegistry(t *testing.T) {
	feeds, err := LoadFeeds(filepath.Join("..", "..", "recon", "feeds.json"), testFeedChains)
	require.NoError(t, err)

	op := feeds.PollAssets(10)
	eth := feeds.StreamAssets(1)
	require.Len(t, op, 20, "20 OP poll assets")
	require.Len(t, eth, 4, "4 ETH chainlink_stream assets")
	require.Len(t, feeds.Assets, 28)
	require.Empty(t, feeds.StreamAssets(10), "OP is poll-only: no stream reproduces the engine price")

	// ADAPTER-OUTPUT CUSTODY (P3 Task 2): each of the four ETH reserves is ALSO
	// declared as a poll of AaveOracle.getAssetPrice — the CAPPED price the Aave
	// pool charges against, which is a different number from the uncapped stream
	// above whenever a cap binds. Both readings are custodied; neither replaces
	// the other, and the registry is what says so.
	ethPolls := feeds.PollAssets(1)
	require.Len(t, ethPolls, 4, "one adapter-output poll per ether.fi Aave reserve")
	gotPolled := map[string]bool{}
	for _, a := range ethPolls {
		require.Equal(t, "0x43b64f28A678944E0655404B0B98E443851cC34F", a.Oracle.Contract.Hex(), a.Symbol)
		require.Equal(t, "getAssetPrice(address)", a.Oracle.Method, a.Symbol)
		require.Equal(t, int32(8), a.Oracle.PriceDecimals, a.Symbol)
		require.Equal(t, "aave_v3_etherfi", a.Engine, a.Symbol)
		require.Zero(t, a.Oracle.StartBlock, a.Symbol)
		require.Equal(t, common.Address{}, a.Oracle.Proxy, a.Symbol)
		require.Nil(t, a.Ratio, "%s: the adapter-output entry declares no secondary ratio", a.Symbol)
		gotPolled[a.Symbol] = true
	}
	require.Equal(t, map[string]bool{"weETH": true, "USDC": true, "PYUSD": true, "FRAX": true}, gotPolled)
	// The two readings of one asset are DISTINCT entries, not a replacement: the
	// stream set is unchanged and every polled reserve still has its stream.
	streamSymbols := map[string]bool{}
	for _, a := range eth {
		streamSymbols[a.Symbol] = true
	}
	require.Equal(t, streamSymbols, gotPolled,
		"every adapter-output reserve keeps its uncapped stream, and vice versa")

	// Every OP asset polls the SAME PriceProviderV2 for USD at 6 decimals — the
	// exact function DebtManagerCore calls at borrow/repay/liquidation.
	for _, a := range op {
		require.Equal(t, "0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB", a.Oracle.Contract.Hex(), a.Symbol)
		require.Equal(t, "price(address)", a.Oracle.Method, a.Symbol)
		require.Equal(t, int32(6), a.Oracle.PriceDecimals, a.Symbol)
		require.Equal(t, "debt_manager", a.Engine, a.Symbol)
		require.Zero(t, a.Oracle.StartBlock, a.Symbol)
		require.Equal(t, common.Address{}, a.Oracle.Proxy, a.Symbol)
	}

	// The four raw aggregators (AnswerUpdated emitters) and their proxies, 8-dec.
	wantStreams := map[string][2]string{
		"weETH": {"0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5", "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"},
		"USDC":  {"0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7", "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6"},
		"PYUSD": {"0x39E31761911b9aaBAEF5fb81B18Fd1C24a60E884", "0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1"},
		"FRAX":  {"0x8F73090a7c58B8BDcC9A93cBB6816e5cC4f01E8c", "0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD"},
	}
	for _, a := range eth {
		want, ok := wantStreams[a.Symbol]
		require.True(t, ok, "unexpected stream asset %s", a.Symbol)
		require.Equal(t, want[0], a.Oracle.Contract.Hex(), "%s raw aggregator", a.Symbol)
		require.Equal(t, want[1], a.Oracle.Proxy.Hex(), "%s chainlink proxy", a.Symbol)
		require.Equal(t, int32(8), a.Oracle.PriceDecimals, a.Symbol)
		require.Equal(t, "aave_v3_etherfi", a.Engine, a.Symbol)
		require.NotZero(t, a.Oracle.StartBlock, a.Symbol)
		require.Empty(t, a.Oracle.Method, "%s: a stream carries no poll method", a.Symbol)
	}

	// weETH is the one asset that ALSO needs a polled ratio: the stream carries
	// only the ETH/USD leg, so the daily-moving getRate() ratio has to be polled
	// separately. Both rows are recorded and NEITHER is composed here.
	//
	// WHAT THE PAIR IS, EXACTLY: multiplying them yields an UNCAPPED REFERENCE
	// VALUE, never the Aave adapter's guaranteed output — the deployed weETH
	// adapter applies a GROWTH CAP to the rate it uses (recon "Oracle wiring" is
	// normative), so the raw product tracks the adapter only while that cap is
	// slack, and diverges exactly in the depeg/exploit scenarios where the
	// difference is most expensive. P3 must implement the growth-cap behaviour or
	// read the adapter's own output before claiming adapter equivalence.
	ratios := feeds.RatioAssets(1)
	require.Len(t, ratios, 1)
	require.Equal(t, "weETH", ratios[0].Symbol)
	require.Equal(t, "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", ratios[0].Ratio.Contract.Hex())
	require.Equal(t, "getRate()", ratios[0].Ratio.Method)
	require.Equal(t, int32(18), ratios[0].Ratio.Decimals)
	require.Empty(t, feeds.RatioAssets(10), "no OP asset declares a ratio poll")

	// The two same-symbol liquidRESERVE contracts must both survive: they are
	// distinct assets sharing a symbol, disambiguated by address only.
	var reserves int
	for _, a := range op {
		if a.Symbol == "liquidRESERVE" {
			reserves++
		}
	}
	require.Equal(t, 2, reserves, "both liquidRESERVE contracts are distinct assets")
}

// baseFeedRegistry is the mutation template for the refusal cases: one valid
// poll asset and one valid stream asset with a ratio.
func baseFeedRegistry() map[string]any {
	return map[string]any{
		"assets": []any{
			map[string]any{
				"chain": "op", "engine": "debt_manager",
				"address": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
				"symbol":  "USDC", "decimals": 6, "roles": []any{"collateral", "debt"},
				"oracle": map[string]any{
					"kind": "poll", "contract": "0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB",
					"method": "price(address)", "priceDecimals": 6,
				},
			},
			map[string]any{
				"chain": "eth", "engine": "aave_v3_etherfi",
				"address": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
				"symbol":  "weETH", "decimals": 18, "roles": []any{"collateral"},
				"oracle": map[string]any{
					"kind": "chainlink_stream", "contract": "0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5",
					"proxy":      "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
					"startBlock": 20779893, "priceDecimals": 8,
					"heartbeatSeconds": 3600, "graceSeconds": 1800,
				},
				"ratio": map[string]any{
					"contract": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
					"method":   "getRate()", "decimals": 18,
				},
			},
		},
	}
}

// writeFeedRegistry renders root to a temp file and returns its path.
func writeFeedRegistry(t *testing.T, root any) string {
	t.Helper()
	raw, err := json.Marshal(root)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "feeds.json")
	require.NoError(t, os.WriteFile(path, raw, 0o600))
	return path
}

// asset returns the nth asset map of a template, for mutation.
func asset(root map[string]any, n int) map[string]any {
	return root["assets"].([]any)[n].(map[string]any)
}

func oracle(root map[string]any, n int) map[string]any {
	return asset(root, n)["oracle"].(map[string]any)
}

func TestLoadFeedsAcceptsTemplate(t *testing.T) {
	feeds, err := LoadFeeds(writeFeedRegistry(t, baseFeedRegistry()), testFeedChains)
	require.NoError(t, err)
	require.Len(t, feeds.Assets, 2)
	require.Equal(t, uint64(10), feeds.Assets[0].ChainID, "chain key resolves to a chain id")
	require.Equal(t, uint64(1), feeds.Assets[1].ChainID)
}

// Every refusal branch of the loader. Each case mutates the template minimally,
// so the assertion is about ONE rule.
func TestLoadFeedsRefusals(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(root map[string]any)
		wantErr string
	}{
		{"unknown chain", func(r map[string]any) { asset(r, 0)["chain"] = "arbitrum" }, "unknown chain"},
		{"unknown engine", func(r map[string]any) { asset(r, 0)["engine"] = "compound" }, "unknown engine"},
		{"empty symbol", func(r map[string]any) { asset(r, 0)["symbol"] = "" }, "symbol must not be empty"},
		{"zero decimals", func(r map[string]any) { asset(r, 0)["decimals"] = 0 }, "decimals must be in [1,36]"},
		{"huge decimals", func(r map[string]any) { asset(r, 0)["decimals"] = 200 }, "decimals must be in [1,36]"},
		{"missing address", func(r map[string]any) { asset(r, 0)["address"] = "" }, "address is required"},
		{"malformed address", func(r map[string]any) { asset(r, 0)["address"] = "0xnothex" }, "is not an address"},
		{"zero address", func(r map[string]any) {
			asset(r, 0)["address"] = "0x0000000000000000000000000000000000000000"
		}, "must not be the zero address"},
		{"no roles", func(r map[string]any) { asset(r, 0)["roles"] = []any{} }, "roles must not be empty"},
		{"unknown role", func(r map[string]any) { asset(r, 0)["roles"] = []any{"supplier"} }, "unknown role"},
		{"unknown oracle kind", func(r map[string]any) { oracle(r, 0)["kind"] = "twap" }, "unknown oracle kind"},
		{"missing oracle contract", func(r map[string]any) { oracle(r, 0)["contract"] = "" }, "oracle.contract is required"},
		{"zero price decimals", func(r map[string]any) { oracle(r, 0)["priceDecimals"] = 0 }, "oracle.priceDecimals must be in [1,36]"},
		{"poll without method", func(r map[string]any) { oracle(r, 0)["method"] = "" }, "oracle.method is required"},
		{"poll with start block", func(r map[string]any) { oracle(r, 0)["startBlock"] = 123 }, "oracle.startBlock is meaningless"},
		{"poll with proxy", func(r map[string]any) {
			oracle(r, 0)["proxy"] = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
		}, "oracle.proxy is meaningless"},
		{"stream with method", func(r map[string]any) { oracle(r, 1)["method"] = "price(address)" }, "oracle.method is meaningless"},
		{"stream without start block", func(r map[string]any) { oracle(r, 1)["startBlock"] = 0 }, "oracle.startBlock must be > 0"},
		{"stream without proxy", func(r map[string]any) { delete(oracle(r, 1), "proxy") }, "oracle.proxy is required"},
		{"stream proxy equals aggregator", func(r map[string]any) {
			oracle(r, 1)["proxy"] = oracle(r, 1)["contract"]
		}, "must name the PROXY and the RAW AGGREGATOR separately"},
		// B3: a stream MUST state its own publication bound. Every way of not
		// stating one is refused, so no stream can silently inherit a default.
		{"stream without heartbeat", func(r map[string]any) {
			delete(oracle(r, 1), "heartbeatSeconds")
		}, "oracle.heartbeatSeconds must be in [1,604800]"},
		{"stream with zero heartbeat", func(r map[string]any) {
			oracle(r, 1)["heartbeatSeconds"] = 0
		}, "oracle.heartbeatSeconds must be in"},
		{"stream with absurd heartbeat", func(r map[string]any) {
			oracle(r, 1)["heartbeatSeconds"] = 864000
		}, "oracle.heartbeatSeconds must be in"},
		{"stream without grace", func(r map[string]any) {
			delete(oracle(r, 1), "graceSeconds")
		}, "oracle.graceSeconds must be in [1,604800]"},
		{"stream with absurd grace", func(r map[string]any) {
			oracle(r, 1)["graceSeconds"] = 864000
		}, "oracle.graceSeconds must be in"},
		{"poll with heartbeat", func(r map[string]any) {
			oracle(r, 0)["heartbeatSeconds"] = 3600
		}, "heartbeatSeconds/graceSeconds are meaningless"},
		{"poll with grace", func(r map[string]any) {
			oracle(r, 0)["graceSeconds"] = 60
		}, "heartbeatSeconds/graceSeconds are meaningless"},
		{"ratio without method", func(r map[string]any) {
			asset(r, 1)["ratio"].(map[string]any)["method"] = ""
		}, "ratio.method must not be empty"},
		{"ratio bad decimals", func(r map[string]any) {
			asset(r, 1)["ratio"].(map[string]any)["decimals"] = 0
		}, "ratio.decimals must be in [1,36]"},
		{"ratio missing contract", func(r map[string]any) {
			asset(r, 1)["ratio"].(map[string]any)["contract"] = ""
		}, "ratio.contract is required"},
		// The uniqueness key is (chain, asset, MECHANISM), so the duplicate this
		// refuses is the same asset read the same WAY twice — that is the pair
		// that would collide on the prices PK. Making asset 1 a byte-identical
		// copy of asset 0 (chain, address, oracle block and all) is what
		// reproduces it.
		{"duplicate asset+mechanism on one chain", func(r map[string]any) {
			asset(r, 1)["chain"] = asset(r, 0)["chain"]
			asset(r, 1)["address"] = asset(r, 0)["address"]
			asset(r, 1)["oracle"] = asset(r, 0)["oracle"]
			delete(asset(r, 1), "ratio")
		}, "not the same one twice"},
		{"unknown field", func(r map[string]any) { asset(r, 0)["_note"] = "provenance" }, "unknown field"},
		{"no assets", func(r map[string]any) { r["assets"] = []any{} }, "declares no assets"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := baseFeedRegistry()
			tc.mutate(root)
			_, err := LoadFeeds(writeFeedRegistry(t, root), testFeedChains)
			require.ErrorContains(t, err, tc.wantErr)
		})
	}
}

// ONE ASSET, SEVERAL MECHANISMS, and the loader accepts them (P3 Task 2).
//
// The uniqueness key was the asset alone until adapter-output custody landed,
// which was strictly stronger than the collision it guarded: an ether.fi Aave
// reserve is legitimately observed through BOTH its raw Chainlink aggregator
// (the uncapped feed) and AaveOracle.getAssetPrice (the capped price the pool
// charges against), and those are different numbers exactly when a cap binds.
// The rows do not collide, because `source` differs — which is what the key now
// keys on.
func TestLoadFeedsAcceptsOneAssetReadThroughSeveralMechanisms(t *testing.T) {
	root := baseFeedRegistry()
	// The SAME asset as the template's stream entry (weETH on eth), read through
	// the Aave adapter instead of the aggregator.
	adapter := map[string]any{
		"chain": "eth", "engine": "aave_v3_etherfi",
		"address": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
		"symbol":  "weETH", "decimals": 18, "roles": []any{"collateral"},
		"oracle": map[string]any{
			"kind": "poll", "contract": "0x43b64f28A678944E0655404B0B98E443851cC34F",
			"method": "getAssetPrice(address)", "priceDecimals": 8,
		},
	}
	root["assets"] = append(root["assets"].([]any), adapter)
	feeds, err := LoadFeeds(writeFeedRegistry(t, root), testFeedChains)
	require.NoError(t, err)
	require.Len(t, feeds.Assets, 3)
	require.Len(t, feeds.StreamAssets(1), 1, "the stream reading survives")
	require.Len(t, feeds.PollAssets(1), 1, "the adapter-output reading joins it")
	require.Equal(t, feeds.StreamAssets(1)[0].Address, feeds.PollAssets(1)[0].Address,
		"both readings describe the same token")

	// ...but the SAME mechanism twice is still refused, because those two WOULD
	// collide row-for-row.
	root["assets"] = append(root["assets"].([]any), adapter)
	_, err = LoadFeeds(writeFeedRegistry(t, root), testFeedChains)
	require.ErrorContains(t, err, "not the same one twice")
}

// Two stream assets naming ONE aggregator is refused: the feed deriver maps a
// log's emitting address to exactly one asset, so a shared aggregator would
// make that mapping ambiguous.
func TestLoadFeedsRefusesSharedAggregator(t *testing.T) {
	root := baseFeedRegistry()
	dup := map[string]any{
		"chain": "eth", "engine": "aave_v3_etherfi",
		"address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		"symbol":  "USDC", "decimals": 6, "roles": []any{"collateral", "debt"},
		"oracle": map[string]any{
			"kind": "chainlink_stream", "contract": "0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5",
			"proxy":      "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
			"startBlock": 20188117, "priceDecimals": 8,
			"heartbeatSeconds": 86400, "graceSeconds": 3600,
		},
	}
	root["assets"] = append(root["assets"].([]any), dup)
	_, err := LoadFeeds(writeFeedRegistry(t, root), testFeedChains)
	require.ErrorContains(t, err, "one aggregator feeds one asset")
}

func TestLoadFeedsMissingFile(t *testing.T) {
	_, err := LoadFeeds(filepath.Join(t.TempDir(), "absent.json"), testFeedChains)
	require.ErrorContains(t, err, "read feed registry")
}

func TestLoadFeedsMalformedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "feeds.json")
	require.NoError(t, os.WriteFile(path, []byte("{not json"), 0o600))
	_, err := LoadFeeds(path, testFeedChains)
	require.ErrorContains(t, err, "parse feed registry")
}

// SOLVENT_PRICE_INTERVAL: default 60s, env-parsed, positive-only (a zero or
// negative cadence would hot-loop a multicall of every registry oracle).
func TestLoadPriceInterval(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")

	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, time.Minute, cfg.PriceInterval, "default is 60s")

	t.Setenv("SOLVENT_PRICE_INTERVAL", "15s")
	cfg, err = Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, 15*time.Second, cfg.PriceInterval)

	t.Setenv("SOLVENT_PRICE_INTERVAL", "bogus")
	_, err = Load("testdata/contracts.json")
	require.ErrorContains(t, err, "SOLVENT_PRICE_INTERVAL")

	t.Setenv("SOLVENT_PRICE_INTERVAL", "0s")
	_, err = Load("testdata/contracts.json")
	require.ErrorContains(t, err, "must be positive")
}

// SOLVENT_FEED_STALENESS is RETIRED and REFUSED, not ignored. One global bound
// could not express per-feed heartbeats, and silently dropping a variable an
// operator set would leave them believing a threshold they configured is still
// being applied.
func TestLoadRefusesRetiredFeedStalenessVariable(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	// Hermetic against an ambient value (make exports .env): empty reads as unset.
	t.Setenv("SOLVENT_FEED_STALENESS", "")

	_, err := Load("testdata/contracts.json")
	require.NoError(t, err, "unset is the normal case")

	t.Setenv("SOLVENT_FEED_STALENESS", "26h")
	_, err = Load("testdata/contracts.json")
	require.ErrorContains(t, err, "SOLVENT_FEED_STALENESS is retired")
	require.ErrorContains(t, err, "oracle.heartbeatSeconds")
}

// SOLVENT_HEALTH_ADDR: loopback by default, overridable, and disabled ONLY by an
// explicit "off" — there is no accidental path to a daemon with no probe.
func TestLoadHealthAddr(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	// Hermetic against an ambient value (make exports .env): empty reads as unset.
	t.Setenv("SOLVENT_HEALTH_ADDR", "")

	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, DefaultHealthAddr, cfg.HealthAddr)
	require.Equal(t, "127.0.0.1:9090", cfg.HealthAddr, "loopback: the surface reports internal failure detail")

	t.Setenv("SOLVENT_HEALTH_ADDR", "0.0.0.0:8080")
	cfg, err = Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, "0.0.0.0:8080", cfg.HealthAddr)

	for _, off := range []string{"off", "OFF", " off "} {
		t.Setenv("SOLVENT_HEALTH_ADDR", off)
		cfg, err = Load("testdata/contracts.json")
		require.NoError(t, err)
		require.Empty(t, cfg.HealthAddr, "%q disables the surface explicitly", off)
	}
}

// B3 FIXTURE PIN: every configured stream in the REAL registry declares its own
// heartbeat and grace, and the resulting threshold is pinned here so a registry
// edit that moves a liquidation-facing bound fails in this test rather than in
// production.
//
// PROVENANCE, stated exactly (see recon/derivation-notes.md for the long form):
// the ETH/USD heartbeat of 3600s is evidence-backed — Codex's round-1 review
// independently observed deployed code consuming this exact proxy with a
// 3600-second bound (constructor evidence 0x641169f048ee8de8b3037c9d9c840060fe03e463).
// The three stablecoin budgets are EMPIRICAL, not published: the B3 heartbeat
// scan (Task 7 acceptance evidence, drift-report grade empirical-historical)
// measured max publication gaps FRAX 170,712s / USDC 248,460s / PYUSD 604,896s
// against the published 86400+3600=90,000s budgets — all three FALSIFIED — and
// commit 09d496e raised the registry to the observed bounds with explicit
// operator margins (PYUSD's heartbeat sits at the validator's 7-day cap; the
// margin carries the excess). The grace values are this repo's operator margin,
// not contractual quantities.
func TestRealFeedRegistryStalenessThresholds(t *testing.T) {
	feeds, err := LoadFeeds(filepath.Join("..", "..", "recon", "feeds.json"), testFeedChains)
	require.NoError(t, err)

	type bound struct{ heartbeat, grace, threshold time.Duration }
	want := map[string]bound{
		"weETH": {3600 * time.Second, 1800 * time.Second, 90 * time.Minute},
		"USDC":  {259200 * time.Second, 43200 * time.Second, 84 * time.Hour},
		"PYUSD": {604800 * time.Second, 86400 * time.Second, 192 * time.Hour},
		"FRAX":  {172800 * time.Second, 43200 * time.Second, 60 * time.Hour},
	}
	streams := feeds.StreamAssets(1)
	require.Len(t, streams, 4)
	for _, a := range streams {
		w, ok := want[a.Symbol]
		require.True(t, ok, "unexpected stream asset %s", a.Symbol)
		require.Equal(t, w.heartbeat, a.Oracle.Heartbeat, "%s heartbeat", a.Symbol)
		require.Equal(t, w.grace, a.Oracle.Grace, "%s grace", a.Symbol)
		require.Equal(t, w.threshold, a.Oracle.StalenessThreshold(), "%s threshold", a.Symbol)
		// The retired 26h global bound no longer caps the three stables — the
		// B3 scan's own doctrine raised each refuted budget to its feed's
		// OBSERVED bound (09d496e). What survives as law: a budget may never
		// exceed PYUSD's 192h ceiling (the validator's 7-day cap plus its
		// declared margin), and any loosening beyond the exact pins above
		// demands new B3 evidence, not an edit.
		require.LessOrEqual(t, a.Oracle.StalenessThreshold(), 192*time.Hour, a.Symbol)
	}

	// A poll oracle has no publication stream, so it declares no heartbeat and
	// reports no threshold.
	for _, a := range feeds.PollAssets(10) {
		require.Zero(t, a.Oracle.Heartbeat, a.Symbol)
		require.Zero(t, a.Oracle.Grace, a.Symbol)
		require.Zero(t, a.Oracle.StalenessThreshold(), a.Symbol)
	}
}
