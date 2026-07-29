package main

// Structural enforcement of riskd's defining law: it makes ZERO RPC calls
// (chain-truth R6.3, design spec §2).
//
// The law is normally defended by a comment and a reviewer's memory. Here it is
// defended by the LINK GRAPH: if no chain client, RPC transport or HTTP client
// is reachable from this binary at all, then "riskd never talks to a provider"
// stops being a promise and becomes a property of the build. That is strictly
// stronger than auditing call sites, because it also forecloses the change that
// adds one later.

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// forbiddenDeps are packages whose PRESENCE anywhere in riskd's transitive
// dependency set is a failure.
//
// Each entry is here for a specific reason:
//
//	internal/chain    the RPC client itself — the walker's provider machinery
//	internal/ingest   the walker, which reads chain
//	internal/prices   the poller/feed deriver; both dial providers, and it is
//	                  why internal/riskfeed mirrors two source-name helpers
//	                  rather than importing them (see riskfeed/sources.go)
//	internal/derive   the derivers, which hold chain readers
//	internal/snapshot the collateral sweeper, which multicalls
//	ethclient / rpc   go-ethereum's transports
//
// internal/store and pgx are ABSENT from this list on purpose: riskd's inputs
// are durable store facts, and a database is not a provider. The law is about
// chain testimony, not about I/O.
var forbiddenDeps = []string{
	"github.com/kaselunt/solvent/internal/chain",
	"github.com/kaselunt/solvent/internal/ingest",
	"github.com/kaselunt/solvent/internal/prices",
	"github.com/kaselunt/solvent/internal/derive",
	"github.com/kaselunt/solvent/internal/snapshot",
	"github.com/ethereum/go-ethereum/ethclient",
	"github.com/ethereum/go-ethereum/rpc",
}

// TestRiskdLinksNoChainClient is the zero-RPC law, proven rather than asserted.
func TestRiskdLinksNoChainClient(t *testing.T) {
	out, err := exec.Command("go", "list", "-deps", ".").Output()
	require.NoError(t, err, "go list -deps must succeed to prove the link graph")

	deps := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			deps[line] = true
		}
	}
	require.NotEmpty(t, deps)
	// Sanity: the graph really was read (a truncated read would vacuously pass).
	require.True(t, deps["github.com/kaselunt/solvent/internal/store"],
		"riskd must depend on internal/store — if this is missing, the dependency list was not read correctly and the assertions below prove nothing")
	require.True(t, deps["github.com/kaselunt/solvent/internal/risk"])
	require.True(t, deps["github.com/kaselunt/solvent/internal/riskfeed"])

	for _, forbidden := range forbiddenDeps {
		require.False(t, deps[forbidden],
			"riskd must not link %s: every input is a durable store fact, and a chain client in this binary reintroduces provider testimony into a layer with no custody machinery to judge it (chain-truth R6.3)",
			forbidden)
	}
}

// TestRiskfeedLinksNoChainClient holds the same line one layer down, so the
// adapter package cannot become the door the daemon's own test would miss.
func TestRiskfeedLinksNoChainClient(t *testing.T) {
	out, err := exec.Command("go", "list", "-deps", "../../internal/riskfeed").Output()
	require.NoError(t, err)

	deps := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			deps[line] = true
		}
	}
	require.True(t, deps["github.com/kaselunt/solvent/internal/risk"])
	for _, forbidden := range forbiddenDeps {
		require.False(t, deps[forbidden], "internal/riskfeed must not link %s", forbidden)
	}
}
