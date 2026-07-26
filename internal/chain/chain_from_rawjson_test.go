package chain

// Task 9 wave 12 — R8: the caller-scoped From methods the walker's rotation
// seam consumes (BlockNumberFrom / LogsFrom), proven at the REAL-DIAL
// raw-JSON layer below the fake seam (the wave-7/8 hermetic harness in
// chain_rawjson_test.go). What R8 pins: a ''-quantity / malformed envelope
// FAILS THE ATTEMPT — it never decodes into a plausible zero — and the walk
// rotates from the CALLER'S start index to a healthy secondary, which
// demonstrably lands with its own token. The question on the wire is the
// blind path's question, unchanged.

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"
)

// R8, face one: BlockNumberFrom over a malformed primary. The empty quantity
// is the round-7 incident shape — the ungated typed decode would record
// height ZERO without error, the attempt would SUCCEED, and the caller-scoped
// walk would stop at the malformed primary exactly like the shared path did.
func TestRawJSONBlockNumberFromEmptyQuantityFailsAttemptAndSecondaryLands(t *testing.T) {
	// Alone: the canon gate names the violation; no token, no zero height.
	empty := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", `""`)
	f := rawDial(t, empty)
	n, tok, err := f.BlockNumberFrom(context.Background(), 0)
	require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
	require.ErrorContains(t, err, "eth_blockNumber response result")
	require.Equal(t, -1, tok.Index, "a failed walk stamps no serving endpoint")
	require.Zero(t, n)

	// With a healthy secondary: the attempt fails, the walk rotates from the
	// caller's start, and the secondary's height lands under ITS token.
	primary := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", `""`)
	secondary := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_blockNumber", hexQuoted(rawHead))
	f = rawDial(t, primary, secondary)
	n, tok, err = f.BlockNumberFrom(context.Background(), 0)
	require.NoError(t, err)
	require.Equal(t, rawHead, n, "the healthy secondary's height LANDS")
	require.Equal(t, 1, tok.Index, "and the token names the endpoint that actually answered")
	require.Equal(t, 1, primary.asksOf("eth_blockNumber"), "the malformed primary was asked exactly once and rotated past")
	require.Equal(t, 1, secondary.asksOf("eth_blockNumber"), "the question on the wire stays eth_blockNumber")
}

// R8, face two: LogsFrom over a primary serving a malformed getLogs envelope
// (logIndex "" — the round-7 face-two shape: a PRESENT ZERO under the ungated
// decode, i.e. raw-log identity corruption, not a routing wart).
func TestRawJSONLogsFromMalformedEnvelopeFailsAttemptAndSecondaryLands(t *testing.T) {
	brokenLogs := func() *rawJSONEndpoint {
		entry := rawLogEntry()
		entry["logIndex"] = `""`
		return newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_getLogs", rawLogsResult(entry))
	}

	// Alone: a named canon violation; no index-zero log escapes, no token.
	f := rawDial(t, brokenLogs())
	logs, tok, err := f.LogsFrom(context.Background(), 0, rawCursor, rawCursor, []common.Address{rawLogAddr})
	require.ErrorContains(t, err, "not a canonical JSON-RPC quantity")
	require.ErrorContains(t, err, "log response logIndex")
	require.Equal(t, -1, tok.Index)
	require.Nil(t, logs)

	// With a healthy secondary: rotation from the caller's start, and the
	// secondary lands the FULL window under its own token.
	primary := brokenLogs()
	secondary := newRawJSONEndpoint(t, map[string]string{}).scriptMethod("eth_getLogs", rawLogsResult(rawLogEntry()))
	f = rawDial(t, primary, secondary)
	logs, tok, err = f.LogsFrom(context.Background(), 0, rawCursor, rawCursor, []common.Address{rawLogAddr})
	require.NoError(t, err)
	require.Equal(t, []types.Log{wantRawLog()}, logs,
		"the FULL window lands from the honest endpoint — every consumed field is the crafted response's own")
	require.Equal(t, 1, tok.Index)
	require.Equal(t, 1, primary.asksOf("eth_getLogs"), "the malformed primary was asked exactly once and rotated past")
	require.Equal(t, 1, secondary.asksOf("eth_getLogs"))
}

// The caller-scoped start is HONOURED, the shared hint is neither read nor
// written, and the wire question carries the exact window asked: with two
// healthy endpoints and start=1, endpoint 0 is never consulted at all, and a
// wrapping start (3 on a fleet of 2) normalizes exactly like doFrom.
func TestRawJSONFromMethodsHonourTheCallerScopedStart(t *testing.T) {
	e0 := newRawJSONEndpoint(t, map[string]string{}).
		scriptMethod("eth_blockNumber", hexQuoted(rawHead)).
		scriptMethod("eth_getLogs", rawLogsResult(rawLogEntry()))
	e1 := newRawJSONEndpoint(t, map[string]string{}).
		scriptMethod("eth_blockNumber", hexQuoted(rawHead)).
		scriptMethod("eth_getLogs", rawLogsResult(rawLogEntry()))
	f := rawDial(t, e0, e1)

	before := f.ActiveEndpoint()

	n, tok, err := f.BlockNumberFrom(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, rawHead, n)
	require.Equal(t, 1, tok.Index, "the walk starts where the caller said")

	logs, tok, err := f.LogsFrom(context.Background(), 1, rawCursor, rawCursor, []common.Address{rawLogAddr})
	require.NoError(t, err)
	require.Equal(t, []types.Log{wantRawLog()}, logs)
	require.Equal(t, 1, tok.Index)

	_, tok, err = f.BlockNumberFrom(context.Background(), 3) // 3 % 2 == 1
	require.NoError(t, err)
	require.Equal(t, 1, tok.Index, "a wrapping start index normalizes exactly like doFrom")

	require.Zero(t, e0.asksOf("eth_blockNumber"), "endpoint 0 was never consulted")
	require.Zero(t, e0.asksOf("eth_getLogs"))
	require.Equal(t, before, f.ActiveEndpoint(),
		"caller-scoped reads never write the shared routing hint (d1e7d54's rule, unchanged here)")

	// The eth_getLogs ask carries the exact window: fromBlock == toBlock ==
	// the asked height, addresses the asked set.
	e1.mu.Lock()
	defer e1.mu.Unlock()
	var sawGetLogs bool
	for _, a := range e1.asks {
		if a.method != "eth_getLogs" {
			continue
		}
		sawGetLogs = true
		require.Len(t, a.params, 1)
		var filter struct {
			FromBlock string `json:"fromBlock"`
			ToBlock   string `json:"toBlock"`
		}
		require.NoError(t, json.Unmarshal(a.params[0], &filter))
		require.Equal(t, "0x5a", filter.FromBlock, "the question on the wire is the exact window asked")
		require.Equal(t, "0x5a", filter.ToBlock)
	}
	require.True(t, sawGetLogs)
}
