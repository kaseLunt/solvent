package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

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
	Chains       map[string]Chain
	Streams      []Stream
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

	cfg := &Config{DatabaseURL: dbURL, PollInterval: poll, Chains: map[string]Chain{}}

	for name, fc := range root.Chains {
		urls := os.Getenv(fc.RPCEnv)
		if urls == "" {
			return nil, fmt.Errorf("rpc env %s (chain %q) is not set", fc.RPCEnv, name)
		}
		cfg.Chains[name] = Chain{ChainID: fc.ChainID, RPCURLs: strings.Split(urls, ",")}
	}

	for _, fs := range root.Streams {
		if _, ok := cfg.Chains[fs.Chain]; !ok {
			return nil, fmt.Errorf("stream %q references unknown chain %q", fs.Name, fs.Chain)
		}
		if fs.Window == 0 || fs.Confirmations == 0 {
			return nil, fmt.Errorf("stream %q: window and confirmations must be > 0", fs.Name)
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
