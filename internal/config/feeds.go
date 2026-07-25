package config

// The oracle FEED REGISTRY loader: recon/feeds.json, the per-asset oracle
// wiring Task 8's price ingestion is driven from (plan Task 8: "feeds.json
// loader (extends config surface, validated against KnownEngines-style
// vocabulary poll|chainlink_stream)").
//
// The registry is a MIRROR of the recon artifact, not a derived view: every
// declared field is parsed and validated here, including the ones price
// ingestion does not read (Symbol, Decimals, Roles — carried for log
// attribution and for later tasks). Validation is deliberately STRICT and
// FAIL-LOUD: a money-adjacent registry that silently tolerates a
// kind/field mismatch would ingest prices under the wrong mechanism, so
// fields that are meaningless for a given oracle kind are refused rather than
// ignored.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"

	"github.com/ethereum/go-ethereum/common"
)

// Oracle kinds — the registry vocabulary (recon "Oracle wiring"):
//
//   - FeedKindPoll: a view call on an oracle contract each interval. The Debt
//     Manager side is poll-ONLY and engine-exact: PriceProviderV2.price(token)
//     is the exact function DebtManagerCore calls at borrow/repay/liquidation
//     (recon: DebtManagerCore.sol:378, 501), and no AnswerUpdated stream
//     reproduces it (isStableToken configs snap to 1e6, accountant lenses emit
//     no logs at all).
//   - FeedKindChainlinkStream: an AnswerUpdated log stream on a RAW Chainlink
//     aggregator, ingested by the walker and read back by the feed deriver.
const (
	FeedKindPoll            = "poll"
	FeedKindChainlinkStream = "chainlink_stream"
)

// KnownFeedKinds is the closed oracle-kind vocabulary, mirroring KnownEngines'
// role for engines: an unrecognized kind is a load-time refusal, never a
// runtime skip that would silently drop an asset's prices.
var KnownFeedKinds = map[string]bool{
	FeedKindPoll:            true,
	FeedKindChainlinkStream: true,
}

// maxDecimals bounds every declared decimal scale in the registry. NUMERIC
// itself is unbounded, so this is a typo guard (a stray 1800 instead of 18),
// not a storage limit.
const maxDecimals = 36

// FeedRatio is an OPTIONAL secondary POLL declared alongside an asset's
// primary oracle: a pure exchange-RATIO read whose value is recorded as its
// own prices row, never composed with the primary price at ingest time.
//
// The one registry instance is Aave's weETH cap adapter, whose USD price is
// `getRate() x ETH/USD` (recon "Oracle wiring", Aave side): the AnswerUpdated
// stream carries only the ETH/USD leg, so the daily-moving weETH getRate()
// ratio has to be polled separately. The P3 risk engine composes the two rows;
// ingest records them side by side (plan Task 8: "record BOTH the ETH/USD
// stream price and a polled getRate() ratio row").
type FeedRatio struct {
	Contract common.Address // contract exposing the ratio view (Aave's RATIO_PROVIDER)
	Method   string         // ratio view signature, e.g. "getRate()"
	Decimals int32          // scale of the returned ratio
}

// FeedOracle is one asset's primary oracle wiring.
type FeedOracle struct {
	Kind string // FeedKindPoll | FeedKindChainlinkStream
	// Contract is the oracle read for a poll (the PriceProviderV2) or the RAW
	// AGGREGATOR that emits AnswerUpdated for a stream — never the Aave cap
	// adapter, whose aggregator() reverts (it is not a proxy).
	Contract common.Address
	// Method is the poll view signature, e.g. "price(address)". Streams carry
	// none.
	Method string
	// PriceDecimals is the scale of the recorded price: 6 for PriceProviderV2
	// (USD per whole token), 8 for the Chainlink aggregators.
	PriceDecimals int32
	// StartBlock is a stream's first AnswerUpdated block (streams only).
	StartBlock uint64
	// Proxy is the Chainlink PROXY in front of the raw aggregator (streams
	// only). Chainlink re-points a proxy's aggregator() on phase changes, so
	// the recorded raw aggregator covers the CURRENT PHASE ONLY; the feed
	// deriver re-resolves aggregator() here when a stream goes stale and logs
	// the address it finds. Config repair stays MANUAL — auto-repointing is an
	// explicit deferral, not an omission.
	Proxy common.Address
}

// Feed is one registry asset: the priced token plus its oracle wiring.
type Feed struct {
	Chain    string // config chain key ("op" / "eth")
	ChainID  uint64 // resolved from the config's chains at load
	Engine   string // owning lending engine (KnownEngines)
	Address  common.Address
	Symbol   string
	Decimals uint8 // the ASSET's ERC20 decimals (informational here: prices are per WHOLE token)
	Roles    []string
	Oracle   FeedOracle
	Ratio    *FeedRatio // optional secondary ratio poll; nil for most assets
}

// KnownFeedRoles is the closed role vocabulary of the registry.
var KnownFeedRoles = map[string]bool{"collateral": true, "debt": true}

// Feeds is the loaded registry.
type Feeds struct {
	Assets []Feed
}

// PollAssets returns the registry's poll-oracle assets on chainID, in file
// order (deterministic).
func (f *Feeds) PollAssets(chainID uint64) []Feed {
	var out []Feed
	for _, a := range f.Assets {
		if a.ChainID == chainID && a.Oracle.Kind == FeedKindPoll {
			out = append(out, a)
		}
	}
	return out
}

// RatioAssets returns the registry's assets on chainID that declare a
// secondary ratio poll, in file order.
func (f *Feeds) RatioAssets(chainID uint64) []Feed {
	var out []Feed
	for _, a := range f.Assets {
		if a.ChainID == chainID && a.Ratio != nil {
			out = append(out, a)
		}
	}
	return out
}

// StreamAssets returns the registry's chainlink_stream assets on chainID, in
// file order.
func (f *Feeds) StreamAssets(chainID uint64) []Feed {
	var out []Feed
	for _, a := range f.Assets {
		if a.ChainID == chainID && a.Oracle.Kind == FeedKindChainlinkStream {
			out = append(out, a)
		}
	}
	return out
}

type fileFeedRatio struct {
	Contract string `json:"contract"`
	Method   string `json:"method"`
	Decimals int32  `json:"decimals"`
}

type fileFeedOracle struct {
	Kind          string `json:"kind"`
	Contract      string `json:"contract"`
	Method        string `json:"method"`
	PriceDecimals int32  `json:"priceDecimals"`
	StartBlock    uint64 `json:"startBlock"`
	Proxy         string `json:"proxy"`
}

type fileFeed struct {
	Chain    string         `json:"chain"`
	Engine   string         `json:"engine"`
	Address  string         `json:"address"`
	Symbol   string         `json:"symbol"`
	Decimals uint8          `json:"decimals"`
	Roles    []string       `json:"roles"`
	Oracle   fileFeedOracle `json:"oracle"`
	Ratio    *fileFeedRatio `json:"ratio"`
}

type fileFeeds struct {
	Assets []fileFeed `json:"assets"`
}

// LoadFeeds reads and validates the oracle feed registry at path, resolving
// each asset's chain reference against chains (the loaded config's chain map)
// into a concrete chain id. A chain the config does not define is a REFUSAL,
// not a skip: price ingestion needs an RPC client for every registry chain, so
// a silently-dropped chain would silently drop that chain's prices.
func LoadFeeds(path string, chains map[string]Chain) (*Feeds, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read feed registry: %w", err)
	}
	// STRICTER than config.Load's tolerant Unmarshal, deliberately: every
	// required field here is bounds-checked below, so a typo'd REQUIRED key is
	// already caught by its zero value failing validation — but a typo'd
	// OPTIONAL key ("ratios" for "ratio") would silently drop an entire prices
	// row family with no error anywhere. Unknown keys are therefore refused.
	// Consequence: the registry schema carries no annotation fields; notes
	// belong in recon/derivation-notes.md.
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var root fileFeeds
	if err := dec.Decode(&root); err != nil {
		return nil, fmt.Errorf("parse feed registry: %w", err)
	}
	if len(root.Assets) == 0 {
		return nil, fmt.Errorf("feed registry %s declares no assets", path)
	}

	feeds := &Feeds{}
	// (chainID, asset) must be unique: the prices PK is
	// (chain_id, asset, source, block_number), so two registry entries for one
	// asset on one chain under the same mechanism would collide row-for-row.
	seenAsset := map[string]string{}
	// (chainID, stream aggregator) must be unique: the feed deriver maps a log's
	// emitting address to exactly one asset.
	seenAggregator := map[string]string{}

	for i, fa := range root.Assets {
		where := fmt.Sprintf("feed registry asset %d", i)
		if fa.Symbol != "" {
			where = fmt.Sprintf("feed registry asset %d (%s)", i, fa.Symbol)
		}
		chain, ok := chains[fa.Chain]
		if !ok {
			return nil, fmt.Errorf("%s: references unknown chain %q", where, fa.Chain)
		}
		if !KnownEngines[fa.Engine] {
			return nil, fmt.Errorf("%s: unknown engine %q", where, fa.Engine)
		}
		if fa.Symbol == "" {
			return nil, fmt.Errorf("%s: symbol must not be empty", where)
		}
		if fa.Decimals == 0 || fa.Decimals > maxDecimals {
			return nil, fmt.Errorf("%s: decimals must be in [1,%d], got %d", where, maxDecimals, fa.Decimals)
		}
		addr, err := parseFeedAddress(where, "address", fa.Address)
		if err != nil {
			return nil, err
		}
		if len(fa.Roles) == 0 {
			return nil, fmt.Errorf("%s: roles must not be empty", where)
		}
		for _, r := range fa.Roles {
			if !KnownFeedRoles[r] {
				return nil, fmt.Errorf("%s: unknown role %q", where, r)
			}
		}

		o := fa.Oracle
		if !KnownFeedKinds[o.Kind] {
			return nil, fmt.Errorf("%s: unknown oracle kind %q", where, o.Kind)
		}
		oracleAddr, err := parseFeedAddress(where, "oracle.contract", o.Contract)
		if err != nil {
			return nil, err
		}
		if o.PriceDecimals <= 0 || o.PriceDecimals > maxDecimals {
			return nil, fmt.Errorf("%s: oracle.priceDecimals must be in [1,%d], got %d",
				where, maxDecimals, o.PriceDecimals)
		}
		oracle := FeedOracle{
			Kind: o.Kind, Contract: oracleAddr, Method: o.Method,
			PriceDecimals: o.PriceDecimals, StartBlock: o.StartBlock,
		}
		switch o.Kind {
		case FeedKindPoll:
			// A poll is answered by a view call, so it has no log stream and no
			// proxy to re-resolve. Both are refused rather than ignored: a
			// registry entry carrying them means its kind and its intent
			// disagree.
			if o.Method == "" {
				return nil, fmt.Errorf("%s: oracle.method is required for kind %q", where, FeedKindPoll)
			}
			if o.StartBlock != 0 {
				return nil, fmt.Errorf("%s: oracle.startBlock is meaningless for kind %q (poll reads have no log stream)",
					where, FeedKindPoll)
			}
			if o.Proxy != "" {
				return nil, fmt.Errorf("%s: oracle.proxy is meaningless for kind %q (nothing to re-resolve)",
					where, FeedKindPoll)
			}
		case FeedKindChainlinkStream:
			if o.Method != "" {
				return nil, fmt.Errorf("%s: oracle.method is meaningless for kind %q (AnswerUpdated logs carry the price)",
					where, FeedKindChainlinkStream)
			}
			if o.StartBlock == 0 {
				return nil, fmt.Errorf("%s: oracle.startBlock must be > 0 for kind %q", where, FeedKindChainlinkStream)
			}
			// The proxy is what a staleness check re-resolves aggregator() on
			// (recon stream caveat ii: proxies re-point on phase changes, and
			// the recorded raw aggregator covers the current phase only).
			proxy, err := parseFeedAddress(where, "oracle.proxy", o.Proxy)
			if err != nil {
				return nil, err
			}
			if proxy == oracleAddr {
				return nil, fmt.Errorf("%s: oracle.proxy equals oracle.contract — the registry must name the PROXY and the RAW AGGREGATOR separately", where)
			}
			oracle.Proxy = proxy
			aggKey := fmt.Sprintf("%d/%x", chain.ChainID, oracleAddr)
			if prev, dup := seenAggregator[aggKey]; dup {
				return nil, fmt.Errorf("%s: aggregator %s already bound to %s — one aggregator feeds one asset",
					where, oracleAddr, prev)
			}
			seenAggregator[aggKey] = fa.Symbol
		}

		var ratio *FeedRatio
		if fa.Ratio != nil {
			ratioAddr, err := parseFeedAddress(where, "ratio.contract", fa.Ratio.Contract)
			if err != nil {
				return nil, err
			}
			if fa.Ratio.Method == "" {
				return nil, fmt.Errorf("%s: ratio.method must not be empty", where)
			}
			if fa.Ratio.Decimals <= 0 || fa.Ratio.Decimals > maxDecimals {
				return nil, fmt.Errorf("%s: ratio.decimals must be in [1,%d], got %d",
					where, maxDecimals, fa.Ratio.Decimals)
			}
			ratio = &FeedRatio{Contract: ratioAddr, Method: fa.Ratio.Method, Decimals: fa.Ratio.Decimals}
		}

		assetKey := fmt.Sprintf("%d/%x", chain.ChainID, addr)
		if prev, dup := seenAsset[assetKey]; dup {
			return nil, fmt.Errorf("%s: asset %s on chain %d already declared as %s",
				where, addr, chain.ChainID, prev)
		}
		seenAsset[assetKey] = fa.Symbol

		feeds.Assets = append(feeds.Assets, Feed{
			Chain: fa.Chain, ChainID: chain.ChainID, Engine: fa.Engine,
			Address: addr, Symbol: fa.Symbol, Decimals: fa.Decimals,
			Roles: fa.Roles, Oracle: oracle, Ratio: ratio,
		})
	}
	return feeds, nil
}

// parseFeedAddress validates one registry address field: hex-shaped and
// non-zero (the zero address is never a real token or oracle, and reading it
// would poll/derive nothing while looking configured).
func parseFeedAddress(where, field, value string) (common.Address, error) {
	if value == "" {
		return common.Address{}, fmt.Errorf("%s: %s is required", where, field)
	}
	if !common.IsHexAddress(value) {
		return common.Address{}, fmt.Errorf("%s: %s %q is not an address", where, field, value)
	}
	addr := common.HexToAddress(value)
	if addr == (common.Address{}) {
		return common.Address{}, fmt.Errorf("%s: %s must not be the zero address", where, field)
	}
	return addr, nil
}
