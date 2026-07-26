package ingest

// Task 9 wave 12 — the walker rotation seam regressions (chain-truth consult,
// schedules R1–R7; R8 lives in internal/chain, R9 in cmd/indexer).
//
// THE LAW UNDER TEST, verbatim from the Codex task-9 round-2 controller
// ruling: LANDING IS THE ONLY OUTCOME THAT KEEPS THE STARTING POINT. Every
// test cites the clause it enforces (the post-D-012 test-integrity
// mechanism); every fixture is a state a real endpoint fleet can be in
// (fixture-realism law) — a lagging backend, a split load balancer, a
// content-faulty log-index shard, a recovered peer.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// walkerNamed builds a walker for a specific stream and start block on a
// shared fake — the R3 two-sibling schedule needs two walkers with disjoint
// ranges over one endpoint fleet.
func walkerNamed(ch Chain, st Store, stream string, startBlock uint64) *Walker {
	return NewWalker(ch, st, WalkerConfig{
		Stream: stream, ChainID: 10,
		Addresses:  []common.Address{testAddr},
		StartBlock: startBlock, Window: 50, Confirmations: 5,
	})
}

// faultyTipLog is a log AT the window tip whose block hash contradicts the
// serving endpoint's own header at that height — the incident's deterministic
// content fault (S2: a corrupt log-index shard; the OP-night wedge shape).
// Every other field is valid, so the ONLY arm that can reject it is the
// tip-log-vs-anchored-tip check — the validation the incident proved
// load-bearing (mutation M7 attacks exactly it).
func faultyTipLog(tip uint64) types.Log {
	l := testLog(tip)
	l.BlockHash = common.HexToHash("0xbad")
	return l
}

// goodTipLog is the same log sitting honestly on the canonical fork.
func goodTipLog(tip uint64) types.Log {
	l := testLog(tip)
	l.BlockHash = blockHashAt(tip)
	return l
}

// R1 — THE INCIDENT SCHEDULE. Endpoint 0 deterministically serves an
// internally-inconsistent window (its getLogs' tip log contradicts its own
// header at `to` — a same-witness contradiction now that the window is
// pinned); endpoint 1 is consistent. Pre-wave-12, this wedged the stream
// FOREVER at the backoff cap with the healthy peer idle (19 identical
// failures / 2.5h+, ledger :81-90). The law: the validation still fails
// closed (custody — nothing from the faulty window is saved), AND the
// failure advances routing, so the next Step resolves past endpoint 0 and
// LANDS on endpoint 1.
func TestContentFaultAdvancesRoutingAndLandsOnHealthyPeer(t *testing.T) {
	ch := agreeingChain(1000)
	ch.view(0).logs[149] = []types.Log{faultyTipLog(149)}
	ch.view(1).logs[149] = []types.Log{goodTipLog(149)}
	st := &fakeStore{}
	w := walker(ch, st)

	// Step k: endpoint 0 serves the fault; the arm fires; NOTHING is saved —
	// the custody half (M7's target: the validation, not just the routing,
	// is load-bearing).
	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "does not match anchored tip hash",
		"the same-witness contradiction is rejected, fail-closed")
	require.False(t, advanced)
	require.Empty(t, st.saved, "custody: nothing from the inconsistent window is persisted")

	// Step k+1: starts PAST endpoint 0 and lands on endpoint 1 (M1's target:
	// the deferred advance).
	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the healthy peer lands the window")
	require.Equal(t, uint64(149), st.cursor.Block)
	require.Len(t, st.saved, 1)
	require.Equal(t, blockHashAt(149).Bytes(), st.saved[0][0].BlockHash,
		"the saved batch is the HEALTHY endpoint's view")

	// Multi-round: retention keeps the stream on the witness that lands for
	// it; endpoint 0 is not revisited while 1 keeps landing.
	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []int{0, 1, 1}, ch.blockStarts,
		"the resolution trace: incident start, advance past the offender, retention")
	require.Equal(t, []int{0, 1, 1}, ch.blockServed)
}

// R2 (walker half; the daemon-streak half is in cmd/indexer) — THE SILENT-
// DISCARD SPLIT. Endpoint 0's two bracketing header reads answer from two
// internal backends forever (tipBefore != tipAfter on every attempt — a
// STABLE lb split, the accepted round-1 premise: a token names a URL, not a
// backend); endpoint 1 is healthy. Pre-wave-12 this was the WORSE wedge: a
// (false, nil) loop the daemon counted as success. The law: the discard is
// its own outcome (F2), and it advances routing like every non-landing exit
// (M2's target: exempting the discard arm from the seam).
func TestSilentDiscardSplitAdvancesRoutingAndLandsOnHealthyPeer(t *testing.T) {
	ch := agreeingChain(1000)
	v0 := ch.view(0)
	v0.headerSeq[149] = []common.Hash{common.HexToHash("0xa1"), common.HexToHash("0xa2")}
	v0.seqLoop = true // the split is stable, not a one-shot glitch
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	var discard *DiscardError
	require.ErrorAs(t, err, &discard, "the discard surfaces as its own outcome")
	require.Contains(t, discard.Reason, "changed mid-fetch")
	require.False(t, advanced)
	require.Empty(t, st.saved)

	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the next Step starts past the split endpoint and lands")
	require.Equal(t, uint64(149), st.cursor.Block)
	require.Equal(t, []int{0, 1}, ch.blockStarts,
		"the discard advanced routing exactly like an error would")
}

// R3 — SIBLING INTERFERENCE: the design refutation of any shared-hint
// implementation (the Task 7 gate counter-schedule transposed; d1e7d54 and
// the RotateAwayFrom deletion are accepted-decision-level). Walker A takes a
// content failure on endpoint 0 and advances past it. Sibling walker B —
// disjoint range, clean on endpoint 0 — legitimately LANDS on endpoint 0,
// and the shared hint sits re-pinned at 0 (in production any shared-path
// success — a HeaderTime freshness probe, TxCalldata — re-pins it; B's own
// landing never writes it, structurally: the From surface has no writer).
// The law: A's next Step STILL starts past 0. A per-stream preference is the
// only structure that survives this schedule (M5's target: routing the
// advance through the shared hint).
func TestSiblingLandingOnOffenderDoesNotDragThisStreamBack(t *testing.T) {
	ch := agreeingChain(1000)
	ch.view(0).logs[149] = []types.Log{faultyTipLog(149)} // faulty ONLY in A's range
	ch.view(1).logs[149] = []types.Log{goodTipLog(149)}
	stA, stB := &fakeStore{}, &fakeStore{}
	a := walkerNamed(ch, stA, "op:stream-a", 100) // window [100,149]
	b := walkerNamed(ch, stB, "op:stream-b", 300) // window [300,349] — clean everywhere

	// A fails on 0 (content fault) and advances.
	_, err := a.Step(context.Background())
	require.ErrorContains(t, err, "does not match anchored tip hash")

	// B lands on 0 legitimately — its range is clean there. Content faults
	// are frequently range-scoped (S2), so the sibling's success is REAL.
	advanced, err := b.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(349), stB.cursor.Block)
	require.Equal(t, 0, ch.blockServed[1], "B resolved and landed on endpoint 0")
	require.Equal(t, 0, ch.active, "and B's landing never wrote the shared hint")

	// The shared hint is (re-)pinned at the offender — in production a
	// sibling's shared-path success does this within one round.
	ch.active = 0

	// A's next Step STILL starts past 0: the exclusion is A's own, and no
	// sibling traffic can erase it.
	advanced, err = a.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(149), stA.cursor.Block)
	require.Equal(t, []int{0, 0, 1}, ch.blockStarts,
		"A@0 (fault), B@0 (legitimate landing), A@1 (the exclusion HELD)")
}

// R4 — ENDPOINT COHERENCE. The Step is pinned to endpoint 0; its getLogs
// fails there (the publicnode shape: header path healthy, deep getLogs
// 403s — R-001 probe, ledger :76) and the failover walk serves the window
// from endpoint 1 — WHICH SITS ON ANOTHER VIEW. Pre-wave-12 those pieces
// were joined silently ("affinity documented, not enforced"); the incident
// night was spent disproving exactly such an assembly. The law: token
// mismatch = coherence discard — SaveBatch is never called with
// cross-endpoint pieces (M4's target: the token-equality gate; under M4 the
// mixed window SAVES, because no content arm can see this fault), and the
// non-landing advances routing.
func TestCrossEndpointWindowPiecesAreDiscardedNotSaved(t *testing.T) {
	ch := agreeingChain(1000)
	ch.view(0).logsErr = errors.New("403 deep getLogs refused")
	// Endpoint 1's log is honest ON ITS OWN FORK at a mid-window height —
	// in-window, right address, one hash per height, not at the tip — so
	// every content check passes; ONLY the coherence gate stands between
	// these pieces and SaveBatch.
	l := testLog(110)
	l.BlockHash = common.HexToHash("0xe1e1")
	ch.view(1).hashes[110] = common.HexToHash("0xe1e1")
	ch.view(1).logs[110] = []types.Log{l}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	var discard *DiscardError
	require.ErrorAs(t, err, &discard)
	require.Contains(t, discard.Reason, "logs window")
	require.Contains(t, discard.Reason, "served by endpoint 1")
	require.False(t, advanced)
	require.Empty(t, st.saved, "SaveBatch is NEVER called with cross-endpoint pieces")
	require.Nil(t, st.cursor)

	// The header-read face of the same law: the tip header rotating to
	// another endpoint is the same discard.
	ch2 := agreeingChain(1000)
	ch2.view(0).errAt[149] = errors.New("header shard timeout")
	st2 := &fakeStore{}
	w2 := walker(ch2, st2)
	_, err = w2.Step(context.Background())
	require.ErrorAs(t, err, &discard)
	require.Contains(t, discard.Reason, "tip header")
	require.Empty(t, st2.saved)

	// And the non-landing advanced routing in both cases.
	require.Equal(t, []int{0}, ch.blockStarts)
	_, err = w.Step(context.Background()) // next Step resolves from 1
	require.NoError(t, err)
	require.Equal(t, []int{0, 1}, ch.blockStarts)
}

// R5 — RETENTION + LIVENESS, the n=2 termination trace pinned (the Task 7
// closing-gate discipline). Landing keeps the start across Steps; a wedge on
// the retained endpoint advances and the stream converges on the peer; a
// LATER wedge on the peer re-probes the recovered original within ONE
// rotation. Retention-not-reset is M6's target: resetting to the shared hint
// on landing recreates the A-bounce (hint at 0 would drag Step 5 back to 0).
func TestRetentionKeepsLandingEndpointAndRecoveryIsReprobedWithinOneRotation(t *testing.T) {
	ch := agreeingChain(1000) // shared hint sits at 0 the whole time
	st := &fakeStore{}
	w := walker(ch, st)
	ctx := context.Background()

	// Steps 1-2: land on 0, stay on 0 (retention).
	for i := 0; i < 2; i++ {
		advanced, err := w.Step(ctx)
		require.NoError(t, err)
		require.True(t, advanced)
	}
	require.Equal(t, uint64(199), st.cursor.Block)

	// Endpoint 0 develops a content fault at the next window's tip (249):
	// step 3 fails there, step 4 lands on 1, step 5 RETAINS 1.
	ch.view(0).logs[249] = []types.Log{faultyTipLog(249)}
	ch.view(1).logs[249] = []types.Log{goodTipLog(249)}
	_, err := w.Step(ctx)
	require.ErrorContains(t, err, "does not match anchored tip hash")
	for i := 0; i < 2; i++ {
		advanced, err := w.Step(ctx)
		require.NoError(t, err)
		require.True(t, advanced)
	}
	require.Equal(t, uint64(299), st.cursor.Block)

	// Later, endpoint 1 wedges at ITS next window (349) and 0 has recovered
	// (its fault was range-scoped): step 6 fails on 1, step 7 starts at
	// (1+1)%2 == 0 — the recovered endpoint is re-probed within one
	// rotation, never excluded forever — and LANDS.
	ch.view(1).logs[349] = []types.Log{faultyTipLog(349)}
	ch.view(0).logs[349] = []types.Log{goodTipLog(349)}
	_, err = w.Step(ctx)
	require.ErrorContains(t, err, "does not match anchored tip hash")
	advanced, err := w.Step(ctx)
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(349), st.cursor.Block)

	require.Equal(t, []int{0, 0, 0, 1, 1, 1, 0}, ch.blockStarts,
		"the n=2 termination trace, pinned: retention on 0, advance to 1, retention on 1, re-probe of 0 within one rotation")
}

// R5, single-endpoint leg: with one configured endpoint there is nowhere
// else to start — no pretend rotation, the discard/error posture is
// unchanged, and the telemetry SAYS SO rather than pretending (the poller's
// single-endpoint honesty rule, transposed).
func TestSingleEndpointNonLandingKeepsStartAndSaysSo(t *testing.T) {
	var logbuf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logbuf, nil)))
	defer slog.SetDefault(prev)

	ch := newFakeEndpointChain(1).setHeadAll(1000).canonAll()
	v := ch.view(0)
	v.headerSeq[149] = []common.Hash{common.HexToHash("0xa1"), common.HexToHash("0xa2")}
	v.seqLoop = true
	st := &fakeStore{}
	w := walker(ch, st)

	for i := 0; i < 2; i++ {
		advanced, err := w.Step(context.Background())
		var discard *DiscardError
		require.ErrorAs(t, err, &discard, "the posture stays an honest discard, round after round")
		require.False(t, advanced)
	}
	require.Equal(t, []int{0, 0}, ch.blockStarts, "no pretend rotation: the start never moves")
	require.Contains(t, logbuf.String(), "nowhere else to start",
		"the telemetry says so instead of pretending")
}

// R6 — CAUGHT-UP KEEPS THE START (consult Q3): no window was attempted, so
// there is no window outcome to judge — neither an advance nor a retention
// write. A stream that landed on endpoint 1 and then catches up KEEPS
// starting at 1. (The frozen-head hole this leaves is F4, recorded OPEN —
// this test deliberately does not claim it.)
func TestCaughtUpKeepsTheStartingPoint(t *testing.T) {
	ch := agreeingChain(1000)
	ch.view(0).headErr = errors.New("height probe down") // resolution rotates to 1
	st := &fakeStore{}
	w := walker(ch, st)

	// Step 1 resolves on endpoint 1 (0's head probe is down) and lands.
	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(149), st.cursor.Block)

	// The chain stops moving: safe head == cursor. Caught-up, twice.
	ch.setHeadAll(154)
	for i := 0; i < 2; i++ {
		advanced, err = w.Step(context.Background())
		require.NoError(t, err, "caught-up is NOT a discard and NOT an error")
		require.False(t, advanced)
	}
	require.Equal(t, []int{0, 1, 1}, ch.blockStarts,
		"retention put the stream on 1; caught-up rounds keep it there, unchanged")
}

// R7 (first half; the F3 corroboration half is OUT of wave 12 by the
// controller's cut) — REWIND COUNTS AS LANDING: a genuine reorg (every view
// agrees the cursor hash is stale) rewinds to the verified ancestor — a
// durable write — and the re-ingest lands on the SAME starting endpoint.
func TestGenuineReorgRewindsAndReingestsFromTheSameStart(t *testing.T) {
	ch := agreeingChain(1000)
	st := &fakeStore{
		cursor:      &store.CursorPos{Block: 200, Hash: common.HexToHash("0x22").Bytes()}, // stale on EVERY view
		highestLogs: map[uint64][]byte{150: blockHashAt(150).Bytes()},                     // verified ancestor at 150
	}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "rewind is a durable write: advanced=true")
	require.NotNil(t, st.rewound)
	require.Equal(t, uint64(150), st.rewound.toBlock)

	// Re-ingest: the next Step starts at the SAME endpoint (rewind landed).
	advanced, err = w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(200), st.cursor.Block, "the re-walk re-ingests past the rewind point")
	require.Equal(t, []int{0, 0}, ch.blockStarts, "rewind kept (and retained) the starting point")
}

// The resolution-failure edge: when EVERY endpoint fails the head read there
// is no serving endpoint to route past — the seam is installed only after a
// resolution exists (the poller's shape). The error posture carries the
// outage; the preference is untouched.
func TestResolutionFailureLeavesRoutingUntouched(t *testing.T) {
	ch := newFakeEndpointChain(2)
	ch.view(0).down = errors.New("dial refused")
	ch.view(1).down = errors.New("dial refused")
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "head:")
	require.False(t, advanced)
	require.Equal(t, -1, w.startPref, "no resolution, no routing change")
	var discard *DiscardError
	require.False(t, errors.As(err, &discard), "a total resolution failure is an ERROR, not a discard")
}

// The DiscardError's message carries the non-landing framing wherever the
// error is printed — the daemon logs %v of it into step_error.
func TestDiscardErrorNamesItselfNonLanding(t *testing.T) {
	err := &DiscardError{Stream: "op:test", Reason: "tip header 149 changed mid-fetch on endpoint 0"}
	require.Equal(t, "window discarded (non-landing): tip header 149 changed mid-fetch on endpoint 0", err.Error())
	require.Equal(t, fmt.Sprintf("%v", err), err.Error())
}
