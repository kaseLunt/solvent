package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

var KnownEngines = map[string]bool{
	"debt_manager":    true,
	"aave_v3_etherfi": true,
	"chainlink_feed":  true,
}

type Chain struct {
	ChainID uint64
	RPCURLs []string
}

type Stream struct {
	Name          string
	Chain         string
	Engine        string
	Addresses     []common.Address
	StartBlock    uint64
	Window        uint64
	Confirmations uint64
}

type Config struct {
	DatabaseURL  string
	PollInterval time.Duration
	// SnapshotInterval is the collateral snapshotter's full-sweep cadence
	// (SOLVENT_SNAPSHOT_INTERVAL, default 1h). Must be positive: a zero or
	// negative cadence would hot-loop full registry sweeps.
	SnapshotInterval time.Duration
	// PriceInterval is the oracle POLL cadence (SOLVENT_PRICE_INTERVAL,
	// default 60s — plan Task 8). Must be positive: a zero or negative cadence
	// would hot-loop a multicall of every registry asset's oracle.
	PriceInterval time.Duration
	// FeedStaleness is how long a Chainlink stream may go without an
	// AnswerUpdated before the feed deriver WARNs, fails its health check and
	// re-resolves the proxy's aggregator() (recon stream caveat ii). Must be
	// positive. The default is deliberately generous relative to the feeds'
	// own heartbeats: per-feed heartbeats differ (they are not recorded in
	// recon/feeds.json), so this ONE global bound is a conservative
	// simplification — a per-feed threshold is a documented deferral, not a
	// claim that this value matches any individual feed's heartbeat.
	FeedStaleness time.Duration
	Chains        map[string]Chain
	Streams       []Stream
}

type fileChain struct {
	ChainID uint64 `json:"chainId"`
	RPCEnv  string `json:"rpcEnv"`
}

type fileStream struct {
	Name          string   `json:"name"`
	Chain         string   `json:"chain"`
	Engine        string   `json:"engine"`
	Addresses     []string `json:"addresses"`
	StartBlock    uint64   `json:"startBlock"`
	Window        uint64   `json:"window"`
	Confirmations uint64   `json:"confirmations"`
}

type fileRoot struct {
	Chains  map[string]fileChain `json:"chains"`
	Streams []fileStream         `json:"streams"`
}

func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var root fileRoot
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	dbURL := os.Getenv("SOLVENT_DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("SOLVENT_DATABASE_URL is not set")
	}
	poll := 5 * time.Second
	if v := os.Getenv("SOLVENT_POLL_INTERVAL"); v != "" {
		poll, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("SOLVENT_POLL_INTERVAL: %w", err)
		}
	}
	snapshot := time.Hour
	if v := os.Getenv("SOLVENT_SNAPSHOT_INTERVAL"); v != "" {
		snapshot, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("SOLVENT_SNAPSHOT_INTERVAL: %w", err)
		}
		if snapshot <= 0 {
			return nil, fmt.Errorf("SOLVENT_SNAPSHOT_INTERVAL must be positive, got %q", v)
		}
	}

	price := time.Minute
	if v := os.Getenv("SOLVENT_PRICE_INTERVAL"); v != "" {
		price, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("SOLVENT_PRICE_INTERVAL: %w", err)
		}
		if price <= 0 {
			return nil, fmt.Errorf("SOLVENT_PRICE_INTERVAL must be positive, got %q", v)
		}
	}
	feedStaleness := 26 * time.Hour
	if v := os.Getenv("SOLVENT_FEED_STALENESS"); v != "" {
		feedStaleness, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("SOLVENT_FEED_STALENESS: %w", err)
		}
		if feedStaleness <= 0 {
			return nil, fmt.Errorf("SOLVENT_FEED_STALENESS must be positive, got %q", v)
		}
	}

	cfg := &Config{
		DatabaseURL: dbURL, PollInterval: poll, SnapshotInterval: snapshot,
		PriceInterval: price, FeedStaleness: feedStaleness, Chains: map[string]Chain{},
	}

	for name, fc := range root.Chains {
		urls := os.Getenv(fc.RPCEnv)
		if urls == "" {
			return nil, fmt.Errorf("rpc env %s (chain %q) is not set", fc.RPCEnv, name)
		}
		var trimmedURLs []string
		for _, url := range strings.Split(urls, ",") {
			url = strings.TrimSpace(url)
			if url != "" {
				trimmedURLs = append(trimmedURLs, url)
			}
		}
		if len(trimmedURLs) == 0 {
			return nil, fmt.Errorf("rpc env %s (chain %q) contains no urls", fc.RPCEnv, name)
		}
		cfg.Chains[name] = Chain{ChainID: fc.ChainID, RPCURLs: trimmedURLs}
	}

	seenStreams := make(map[string]struct{}, len(root.Streams))
	for _, fs := range root.Streams {
		if fs.Name == "" {
			return nil, fmt.Errorf("stream name must not be empty")
		}
		if !KnownEngines[fs.Engine] {
			return nil, fmt.Errorf("stream %q: unknown engine %q", fs.Name, fs.Engine)
		}
		// The cursor table is keyed by stream name: two streams sharing a
		// name would silently clobber each other's cursor.
		if _, dup := seenStreams[fs.Name]; dup {
			return nil, fmt.Errorf("duplicate stream name %q", fs.Name)
		}
		seenStreams[fs.Name] = struct{}{}
		if _, ok := cfg.Chains[fs.Chain]; !ok {
			return nil, fmt.Errorf("stream %q references unknown chain %q", fs.Name, fs.Chain)
		}
		if fs.Window == 0 || fs.Confirmations == 0 {
			return nil, fmt.Errorf("stream %q: window and confirmations must be > 0", fs.Name)
		}
		if fs.StartBlock == 0 {
			return nil, fmt.Errorf("stream %q: startBlock must be > 0 (genesis-start streams unsupported)", fs.Name)
		}
		// Streams must name their contracts: an empty address set would mean
		// a wildcard getLogs over every contract, which is unsupported (and
		// the walker rejects any log outside its configured address set).
		if len(fs.Addresses) == 0 {
			return nil, fmt.Errorf("stream %q: addresses must not be empty", fs.Name)
		}
		s := Stream{
			Name: fs.Name, Chain: fs.Chain, Engine: fs.Engine,
			StartBlock: fs.StartBlock, Window: fs.Window, Confirmations: fs.Confirmations,
		}
		for _, a := range fs.Addresses {
			if !common.IsHexAddress(a) {
				return nil, fmt.Errorf("stream %q: invalid address %q", fs.Name, a)
			}
			s.Addresses = append(s.Addresses, common.HexToAddress(a))
		}
		cfg.Streams = append(cfg.Streams, s)
	}
	return cfg, nil
}
