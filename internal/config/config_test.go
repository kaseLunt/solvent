package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLoadValidConfig(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example,https://b.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	t.Setenv("SOLVENT_POLL_INTERVAL", "7s")

	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, "postgres://x", cfg.DatabaseURL)
	require.Equal(t, 7*time.Second, cfg.PollInterval)
	require.Equal(t, uint64(10), cfg.Chains["op"].ChainID)
	require.Equal(t, []string{"https://a.example", "https://b.example"}, cfg.Chains["op"].RPCURLs)
	require.Len(t, cfg.Streams, 1)
	s := cfg.Streams[0]
	require.Equal(t, "op:test", s.Name)
	require.Equal(t, "0x794a61358D6845594F94dc1DB02A252b5b4814aD", s.Addresses[0].Hex())
	require.Equal(t, uint64(5), s.Confirmations)
}

// SOLVENT_SNAPSHOT_INTERVAL: default 1h, env-parsed, positive-only (a zero
// or negative cadence would hot-loop full collateral sweeps).
func TestLoadSnapshotInterval(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")

	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, time.Hour, cfg.SnapshotInterval, "default is 1h")

	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "30m")
	cfg, err = Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, 30*time.Minute, cfg.SnapshotInterval)

	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "bogus")
	_, err = Load("testdata/contracts.json")
	require.ErrorContains(t, err, "SOLVENT_SNAPSHOT_INTERVAL")

	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "-5m")
	_, err = Load("testdata/contracts.json")
	require.ErrorContains(t, err, "must be positive")
}

func TestLoadFailsWhenRPCEnvMissing(t *testing.T) {
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	// Explicitly EMPTY, not assumed-absent: `make test` exports the whole
	// .env (that is how the fork-replay and reconcile vars flow), so on any
	// dev box with a populated .env this test would false-fail if it relied
	// on ambient absence. Load treats empty as unset (config.go:162).
	t.Setenv("SOLVENT_RPC_OP", "")
	_, err := Load("testdata/contracts.json")
	require.ErrorContains(t, err, "SOLVENT_RPC_OP")
}

func TestLoadFailsOnUnknownChainRef(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_chain_ref.json")
	require.ErrorContains(t, err, "unknown chain")
}

// Invariant: genesis-start streams are unsupported — StartBlock 0 would make
// the walker's StartBlock-1 full-rewalk target underflow-prone and ambiguous.
func TestLoadFailsOnZeroStartBlock(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/zero_start.json")
	require.ErrorContains(t, err, "startBlock must be > 0")
}

// Invariant: streams must name their contracts — an empty address set would
// be a wildcard getLogs subscription, which is unsupported.
func TestLoadFailsOnEmptyAddresses(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/empty_addresses.json")
	require.ErrorContains(t, err, "addresses must not be empty")
}

// Invariant: the cursor table is keyed by stream name, so duplicate names
// would clobber each other's cursor.
func TestLoadFailsOnDuplicateStreamName(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/dup_stream.json")
	require.ErrorContains(t, err, `duplicate stream name "op:test"`)
}

func TestLoadTrimsWhitespaceInRPCURLs(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", " https://a.example , https://b.example ")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, []string{"https://a.example", "https://b.example"}, cfg.Chains["op"].RPCURLs)
}

func TestLoadFailsOnEmptyStreamName(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/empty_name.json")
	require.ErrorContains(t, err, "name must not be empty")
}

func TestLoadFailsOnUnknownEngine(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_engine.json")
	require.ErrorContains(t, err, "unknown engine")
}

func TestLoadFailsOnInvalidAddress(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_address.json")
	require.ErrorContains(t, err, "invalid address")
}

func TestLoadFailsOnZeroWindow(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/zero_window.json")
	require.ErrorContains(t, err, "window and confirmations")
}

func TestProductionContractsJSONParses(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_RPC_ETH", "https://b.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := Load("../../config/contracts.json")
	require.NoError(t, err)
	require.NotEmpty(t, cfg.Streams)
}

// TestKnownEnginesAcceptsAaveParam pins the P3 Task 2 engine identity on BOTH
// sides: the enum admits aave_param, and it still rejects an engine nobody
// wired (the accept half alone would pass against an enum that accepted
// everything).
func TestKnownEnginesAcceptsAaveParam(t *testing.T) {
	require.True(t, KnownEngines["aave_param"])
	require.False(t, KnownEngines["aave_params"], "the enum is a closed set, not a prefix match")
}

// TestProductionConfiguratorStreamShape pins the shipped aave_param stream
// against the values the Task-1 probe and the chain-truth consult fixed:
// the PoolConfigurator PROXY (never the implementation, never the addresses
// provider), the Pool deploy block, window 2000 (consult R6.4: the walker has
// NO adaptive halving, so a 10k window would wedge on the dRPC archive flap),
// and confirmations matching the other ETH streams.
func TestProductionConfiguratorStreamShape(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_RPC_ETH", "https://b.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := Load("../../config/contracts.json")
	require.NoError(t, err)

	var param *Stream
	ethConfirmations := map[uint64]bool{}
	for i := range cfg.Streams {
		s := &cfg.Streams[i]
		if s.Chain == "eth" {
			ethConfirmations[s.Confirmations] = true
		}
		if s.Engine == "aave_param" {
			require.Nil(t, param, "exactly one aave_param stream")
			param = s
		}
	}
	require.NotNil(t, param, "config/contracts.json must carry the aave_param stream")
	require.Equal(t, "eth:aave-param", param.Name)
	require.Equal(t, "eth", param.Chain)
	require.Len(t, param.Addresses, 1, "singleton address — the decode registry keys address-blind")
	require.Equal(t, "0x8438F4D29D895d75C86BDC25360c25eF0607E65d", param.Addresses[0].Hex())
	require.Equal(t, uint64(20625519), param.StartBlock)
	require.Equal(t, uint64(2000), param.Window)
	require.Len(t, ethConfirmations, 1, "every ETH stream shares one confirmations depth")
	require.Equal(t, uint64(5), param.Confirmations)
}
