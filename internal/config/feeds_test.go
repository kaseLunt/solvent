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
	require.Len(t, feeds.Assets, 24)
	require.Empty(t, feeds.StreamAssets(10), "OP is poll-only: no stream reproduces the engine price")
	require.Empty(t, feeds.PollAssets(1), "the ETH assets' primary oracle is the stream")

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

	// weETH is the one asset that ALSO needs a polled ratio: its Aave cap
	// adapter is getRate() x ETH/USD, and the stream only carries the ETH/USD
	// leg. Both rows are recorded; composition is P3's.
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
		{"ratio without method", func(r map[string]any) {
			asset(r, 1)["ratio"].(map[string]any)["method"] = ""
		}, "ratio.method must not be empty"},
		{"ratio bad decimals", func(r map[string]any) {
			asset(r, 1)["ratio"].(map[string]any)["decimals"] = 0
		}, "ratio.decimals must be in [1,36]"},
		{"ratio missing contract", func(r map[string]any) {
			asset(r, 1)["ratio"].(map[string]any)["contract"] = ""
		}, "ratio.contract is required"},
		{"duplicate asset on one chain", func(r map[string]any) {
			asset(r, 1)["chain"] = "op"
			asset(r, 1)["address"] = asset(r, 0)["address"]
			// keep it a stream so only the duplicate rule can fire
		}, "already declared as"},
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

// SOLVENT_FEED_STALENESS: default 26h, env-parsed, positive-only.
func TestLoadFeedStaleness(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")

	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, 26*time.Hour, cfg.FeedStaleness, "default is 26h")

	t.Setenv("SOLVENT_FEED_STALENESS", "90m")
	cfg, err = Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, 90*time.Minute, cfg.FeedStaleness)

	t.Setenv("SOLVENT_FEED_STALENESS", "nope")
	_, err = Load("testdata/contracts.json")
	require.ErrorContains(t, err, "SOLVENT_FEED_STALENESS")

	t.Setenv("SOLVENT_FEED_STALENESS", "-1h")
	_, err = Load("testdata/contracts.json")
	require.ErrorContains(t, err, "must be positive")
}
