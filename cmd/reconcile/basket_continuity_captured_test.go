package main

// The DEFAULT-HERMETIC captured suite (ruling L7): every frozen case's
// committed getLogs envelopes + call words replayed through the PRODUCTION
// decode path (assembleContinuitySweep over the captured bytes, then
// proveBasketContinuity), with the proof outcome pinned to what the live
// chain answered at capture time. No network, no DB.
//
// FIXTURE-REALISM LAW (the P0 lesson): a liquidation-case fixture without the
// case's own pre-boundary seizure transfers is CHAIN-IMPOSSIBLE
// (DebtManagerCore.sol:575 < :584) — asserted here on every capture whose
// case seized a nonzero amount, so the committed fixtures can never decay
// into the fixtures-that-cannot-fail anti-pattern.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// loadContinuityCaptures reads every committed capture, keyed by case.
func loadContinuityCaptures(t *testing.T) map[string]*continuityCapture {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("testdata", "continuity", "*.json"))
	require.NoError(t, err)
	out := map[string]*continuityCapture{}
	for _, f := range files {
		body, err := os.ReadFile(f)
		require.NoError(t, err)
		var cap continuityCapture
		require.NoError(t, json.Unmarshal(body, &cap), "capture %s must parse", f)
		out[cap.Case] = &cap
	}
	return out
}

// TestContinuityCaptureCoversTheFrozenFrame pins the capture split honestly:
// every frozen case has a committed capture, keyed by its own (tx, log_index)
// and pinned to its own stored hash. If a future re-capture loses cases, this
// names each one — a case without a capture REFUSES continuity at test time
// (never fabricates), but the LOSS itself must be visible, not silent.
func TestContinuityCaptureCoversTheFrozenFrame(t *testing.T) {
	caps := loadContinuityCaptures(t)
	var missing []string
	for _, fc := range backtestFrame {
		key := strings.TrimPrefix(strings.ToLower(fc.TxHash), "0x") + fmt.Sprintf(":%d", fc.LogIndex)
		cap, ok := caps[key]
		if !ok {
			missing = append(missing, key)
			continue
		}
		require.Equal(t, fc.Block, cap.Block, "case %s: captured block must be the frame's", key)
		require.Equal(t, strings.ToLower(fc.BlockHash), cap.Pin,
			"case %s: the capture is pinned to the frame's STORED raw_logs hash, never a re-resolution", key)
		require.Equal(t, strings.ToLower(fc.Account), cap.Account, key)
	}
	require.Empty(t, missing, "every frozen case must carry a committed capture (the 2026-07-30 capture took all 31); a shrunk capture set is reported by name, never silently tolerated")
	require.Len(t, caps, backtestFrameSize, "no orphan captures beyond the frame either")
}

// TestContinuityCapturedCasesReplayToTheirPinnedOutcome replays every capture
// through the production sweep assembly + proof and requires the EXACT
// outcome observed against the live chain at capture time — proven stays
// proven, and a refusal stays the SAME refusal (refusal-over-fabrication:
// an honestly-refusing case is pinned as refusing, not massaged into a pass).
func TestContinuityCapturedCasesReplayToTheirPinnedOutcome(t *testing.T) {
	caps := loadContinuityCaptures(t)
	require.NotEmpty(t, caps)
	proven, refused := 0, 0
	for _, fc := range backtestFrame {
		key := strings.TrimPrefix(strings.ToLower(fc.TxHash), "0x") + fmt.Sprintf(":%d", fc.LogIndex)
		cap, ok := caps[key]
		if !ok {
			continue // named by TestContinuityCaptureCoversTheFrozenFrame
		}
		t.Run(key, func(t *testing.T) {
			sw, seizures, witnesses := continuityCaptureInputs(t, cap)
			require.Empty(t, sw.Refusal, "the captured envelopes assembled cleanly at capture time; they must keep doing so")
			o := proveBasketContinuity(sw, seizures, witnesses)
			require.Equal(t, cap.Expected.Proven, o.Proven,
				"case %s: the proof outcome over the SAME chain bytes drifted from the capture-time outcome", key)
			require.Equal(t, cap.Expected.Refusals, o.Refusals,
				"case %s: the refusal set must be byte-stable — a changed refusal is a changed law", key)
			if o.Proven {
				proven++
			} else {
				refused++
			}

			// FIXTURE REALISM: the case's own seizure transfers are present
			// and pre-boundary whenever the case seized a nonzero amount.
			seizedNonzero := false
			for _, s := range seizures {
				if s.Amount != nil && s.Amount.Sign() > 0 {
					seizedNonzero = true
				}
			}
			if seizedNonzero {
				sawOwnOutbound := false
				for _, tr := range sw.Transfers {
					if tr.TxHash == sw.CaseTx && tr.From == sw.Safe && tr.LogIndex < uint64(sw.BoundaryLogIndex) {
						sawOwnOutbound = true
					}
				}
				require.True(t, sawOwnOutbound,
					"case %s seized a nonzero amount but its capture carries NO pre-boundary outbound seizure transfer — chain-impossible (:575<:584); the fixture is dishonest", key)
			}
		})
	}
	t.Logf("captured replay: %d proven, %d honestly refused (of %d captures)", proven, refused, len(caps))
}
