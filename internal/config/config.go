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
	// aave_param is the Aave v3 ether.fi-market PoolConfigurator stream (P3
	// Task 2). It is a SEPARATE engine identity from aave_v3_etherfi on
	// purpose: the configurator's topic0 space is disjoint from the Pool's,
	// and routing configurator logs into aave_v3_etherfi would hand the
	// AaveEngine events it has no arm for. Its deriver is
	// derive.ParamRunner (param_history), not a derive.Engine.
	"aave_param": true,
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
	// NOTE: there is deliberately NO global feed-staleness threshold here any
	// more. It used to be SOLVENT_FEED_STALENESS (default 26h) applied to every
	// Chainlink stream alike, which was PERMISSIVE rather than conservative for
	// liquidation-facing freshness — the ETH/USD stream behind the weETH adapter
	// is consumed with a 3600-second heartbeat by deployed code, so a stopped
	// stream could evade that signal for roughly 25h beyond its contractual
	// bound. Each stream now declares its own heartbeat and grace in
	// recon/feeds.json (config.FeedOracle.StalenessThreshold), so no single
	// value can be simultaneously right for a 1h feed and a 24h one. Load
	// REFUSES the retired variable rather than ignoring it, so an operator who
	// still sets it learns that their bound is no longer being applied.
	// HealthAddr is where the daemon serves its health/readiness surface
	// (SOLVENT_HEALTH_ADDR, default 127.0.0.1:9090). Empty means DISABLED, which
	// only happens when an operator sets the variable to "off" — there is no
	// accidental path to a daemon with no probe, because a health signal that
	// exists only as a log line is what the fix wave removed. A bind failure is
	// fatal at startup for the same reason.
	HealthAddr string
	Chains     map[string]Chain
	Streams    []Stream
}

// healthAddrOff is the explicit opt-out value for SOLVENT_HEALTH_ADDR.
const healthAddrOff = "off"

// DefaultHealthAddr is the loopback address the health surface binds when
// SOLVENT_HEALTH_ADDR is unset. Loopback, not 0.0.0.0: the surface reports
// internal failure detail and should be reachable by a local supervisor or a
// sidecar, not by the network at large.
const DefaultHealthAddr = "127.0.0.1:9090"

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
	// RETIRED, and refused rather than ignored: a single global staleness bound
	// cannot express the per-feed heartbeats that liquidation-facing freshness
	// depends on. Silently ignoring the variable would leave an operator
	// believing a bound they set is still in force, which is the worse failure.
	if v := os.Getenv("SOLVENT_FEED_STALENESS"); v != "" {
		return nil, fmt.Errorf("SOLVENT_FEED_STALENESS is retired (set to %q): feed staleness is now per-feed, declared as oracle.heartbeatSeconds + oracle.graceSeconds in recon/feeds.json — unset the variable and edit the registry instead", v)
	}

	healthAddr := DefaultHealthAddr
	if v := os.Getenv("SOLVENT_HEALTH_ADDR"); v != "" {
		if strings.EqualFold(strings.TrimSpace(v), healthAddrOff) {
			healthAddr = "" // explicit opt-out
		} else {
			healthAddr = strings.TrimSpace(v)
		}
	}

	cfg := &Config{
		DatabaseURL: dbURL, PollInterval: poll, SnapshotInterval: snapshot,
		PriceInterval: price, HealthAddr: healthAddr, Chains: map[string]Chain{},
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
