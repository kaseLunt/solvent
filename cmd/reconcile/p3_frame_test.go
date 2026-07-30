package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestBacktestFrameDigestMatchesTheCommittedProbeRecord is the freeze's own
// check, re-run against the Go literal: the committed 31 cases must hash to the
// value recon/p3-probes.md recorded at freeze time (computed twice out of band —
// Postgres sha256() and a local hash — and identical). A silent edit to the
// literal changes the digest and dies here, which is what makes the frame a
// COMMITTED INPUT rather than a table someone can nudge.
func TestBacktestFrameDigestMatchesTheCommittedProbeRecord(t *testing.T) {
	got, ok := backtestFrameDigestOK()
	require.True(t, ok, "frame digest %s != committed %s", got, backtestFrameDigest)
	require.Equal(t, backtestFrameDigest, got)

	// And the digest is computed the way the record says: sha256 over
	// newline-terminated "0x<tx>:<logIndex>" lines, 2,185 bytes of body.
	body := backtestFrameBody()
	require.Equal(t, 2185, len(body), "the probe record states a 2,185-byte digest body")
	sum := sha256.Sum256([]byte(body))
	require.Equal(t, backtestFrameDigest, "0x"+hex.EncodeToString(sum[:]))
}

// TestBacktestFrameSizeAndOrder pins N and the (block, log_index) ordering the
// digest preimage depends on. A re-sort would change the digest; asserting the
// order separately says WHICH invariant broke.
func TestBacktestFrameSizeAndOrder(t *testing.T) {
	require.Len(t, backtestFrame, backtestFrameSize)
	for i := 1; i < len(backtestFrame); i++ {
		prev, cur := backtestFrame[i-1], backtestFrame[i]
		if prev.Block == cur.Block {
			require.Less(t, prev.LogIndex, cur.LogIndex,
				"frame must be in (block_number, log_index) order at index %d", i)
			continue
		}
		require.Less(t, prev.Block, cur.Block, "frame must be in block order at index %d", i)
	}
}

// TestBacktestFrameSanityChecksFromTheProbeRecord re-asserts the freeze's own
// numbered sanity checks over the committed literal: 31 distinct keys, 30
// distinct tx hashes with the ONE intentional duplicate being the two-pass
// pair's two log indexes in one tx, every case inside the era, and the bucket
// totals 5+5+5+5+5+5+1.
func TestBacktestFrameSanityChecksFromTheProbeRecord(t *testing.T) {
	keys := map[string]bool{}
	txs := map[string]int{}
	buckets := map[string]int{}
	for _, c := range backtestFrame {
		k := strings.ToLower(c.TxHash) + fmt.Sprintf(":%d", c.LogIndex)
		require.False(t, keys[k], "duplicate frame key %s", k)
		keys[k] = true
		txs[strings.ToLower(c.TxHash)]++
		buckets[c.Bucket]++
		require.GreaterOrEqual(t, c.Block, uint64(150057202), "case %s is below the era's first liquidation", k)
		require.LessOrEqual(t, c.Block, uint64(153399414), "case %s is above the era's last liquidation", k)
		require.Len(t, c.BlockHash, 66, "block_hash must be 0x + 32 bytes")
		require.Len(t, c.TxHash, 66, "tx_hash must be 0x + 32 bytes")
		require.Len(t, c.Account, 42, "account must be 0x + 20 bytes")
	}
	require.Len(t, keys, backtestFrameSize)
	require.Len(t, txs, 30, "30 distinct tx hashes: the single duplicate is the two-pass pair")
	dupes := 0
	for tx, n := range txs {
		if n > 1 {
			dupes++
			require.Equal(t, 2, n, "the only duplicated tx is the two-pass pair, with exactly 2 events (%s)", tx)
		}
	}
	require.Equal(t, 1, dupes)
	require.Equal(t, map[string]int{"B0": 5, "B1": 5, "B2": 5, "B3": 5, "B4": 5, "B5": 5, "B6": 1}, buckets)
}

// TestFrameCompositionRowsFailWhenAForcedCaseIsRemoved proves the composition
// assertions are ASSERTIONS: composition-by-identity means the named cases must
// be present, so removing one has to fail rather than shrink a count.
func TestFrameCompositionRowsFailWhenAForcedCaseIsRemoved(t *testing.T) {
	rows := frameCompositionRows()
	require.NotEmpty(t, rows)
	for _, r := range rows {
		require.Equal(t, verdictExact, r.Verdict, "the committed frame must satisfy every identity constraint: %s", r.Subject)
		require.True(t, r.Gated)
	}

	// MUTATION: drop the singleton. The identity row must flip.
	original := backtestFrame
	t.Cleanup(func() { backtestFrame = original })
	var without []backtestCase
	for _, c := range original {
		if strings.Contains(c.Selection, "singleton") {
			continue
		}
		without = append(without, c)
	}
	backtestFrame = without
	mutated := frameCompositionRows()
	found := false
	for _, r := range mutated {
		if strings.Contains(r.Subject, "singleton") {
			found = true
			require.Equal(t, verdictCohortFloor, r.Verdict, "removing the singleton must fail the identity assertion")
		}
	}
	require.True(t, found)

	// MUTATION: drop one member of the two-pass pair. A HALF pair must fail —
	// the whole point of the force-include is that BOTH members are present,
	// because the second event's beforeDebtAmount is the first's after-state.
	var halfPair []backtestCase
	dropped := false
	for _, c := range original {
		if !dropped && strings.Contains(c.Selection, "two-pass") {
			dropped = true
			continue
		}
		halfPair = append(halfPair, c)
	}
	backtestFrame = halfPair
	for _, r := range frameCompositionRows() {
		if strings.Contains(r.Subject, "two-pass") {
			require.Equal(t, verdictCohortFloor, r.Verdict, "a HALF two-pass pair must fail: 1 member is not the pair")
		}
	}
}

// TestBacktestFrameKeysMatchTheDigestPreimage keeps the Stage-A lookup keys and
// the digest preimage derived from ONE rendering. Two spellings of "the case's
// key" is how a frame silently stops being the frame.
func TestBacktestFrameKeysMatchTheDigestPreimage(t *testing.T) {
	keys := backtestFrameKeys()
	require.Len(t, keys, backtestFrameSize)
	lines := strings.Split(strings.TrimRight(backtestFrameBody(), "\n"), "\n")
	require.Len(t, lines, backtestFrameSize)
	for i, k := range keys {
		require.Equal(t, "0x"+k, lines[i], "key %d must be the digest line minus the 0x", i)
	}
}
