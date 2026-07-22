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

func TestLoadFailsWhenRPCEnvMissing(t *testing.T) {
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	// SOLVENT_RPC_OP deliberately unset
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
