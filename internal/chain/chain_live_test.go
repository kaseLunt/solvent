package chain

// LIVE pinned regression for Task 9 wave 5: the incident block's hash, from
// the incident chain, through the real Dial → endpointClient → Failover
// stack. The fake-backed suite proves the plumbing prefers the reported
// value; only a real OP endpoint can prove the reported value IS the
// canonical hash geth v1.13.0 cannot compute (hashcheck.go: computed
// 0x70f6bea2… ≠ canonical 0x3d957321…, MATCH false).
//
// NETWORK-GATED, following poller_live_test.go's gating convention (skip
// cleanly, with instructions, when the gating env var is absent): set
// SOLVENT_LIVE_RPC_TESTS=1 to run. The gate keeps ordinary suite runs
// hermetic; the wave-5 report records one ungated run proving it passes.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLiveOPIncidentBlockHashIsTheReportedCanonicalHash(t *testing.T) {
	if os.Getenv("SOLVENT_LIVE_RPC_TESTS") == "" {
		t.Skip("SOLVENT_LIVE_RPC_TESTS not set; this regression dials https://mainnet.optimism.io")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	f, err := Dial(ctx, []string{"https://mainnet.optimism.io"})
	require.NoError(t, err)

	got, err := f.HeaderHash(ctx, opIncidentBlock)
	require.NoError(t, err)
	require.Equal(t, opIncidentReportedHash, got,
		"OP block 150,105,227's hash must be the provider-reported canonical value — the recomputation this wave retired yields 0x70f6bea2… here and wedged the walker on it")

	// The caller-scoped path serves the same identity from the same stack.
	fromPath, token, err := f.HeaderHashFrom(ctx, 0, opIncidentBlock)
	require.NoError(t, err)
	require.Equal(t, 0, token.Index)
	require.Equal(t, opIncidentReportedHash, fromPath)
}
