package main

// The SSE READ-HEALTH LATCH (Codex round 1 [medium]).
//
// The finding: after connection, every failed refresh was only logged, while the
// independent heartbeat ticker kept writing comment frames. A transient or
// prolonged database outage therefore left connected clients with an apparently
// live stream over indefinitely stale data, and recovery had no explicit
// stale-to-current transition either.
//
// The tests below drive failure and recovery through the `readFailure` seam
// (server.refresh), because the alternative — dropping the table under a running
// stream — makes the failure real but unrecoverable and untimed, so the recovery
// half could not be exercised at all.

import (
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// injectReadFailure arms the seam. Passing nil clears it.
func (f *apiFixture) injectReadFailure(err error) {
	if f.srv.readFailure == nil {
		f.srv.readFailure = &atomic.Pointer[error]{}
	}
	if err == nil {
		f.srv.readFailure.Store(nil)
		return
	}
	f.srv.readFailure.Store(&err)
}

func TestStreamNotifiesClientsWhenReadsStartFailing(t *testing.T) {
	f := newAPIFixture(t)
	f.srv.readFailure = &atomic.Pointer[error]{}

	r := openStream(t, f.http.URL+"/v1/stream")
	snap := r.nextEvent(t, 5*time.Second)
	require.Equal(t, eventSnapshot, snap.Event)
	require.False(t, decodeJSON(t, snap.Data)["recovered"] == true,
		"the connect-time snapshot is not a recovery")

	// The database goes away. The heartbeat ticker keeps running — that is the
	// point: a heartbeat is liveness of the CONNECTION, never of the DATA.
	f.injectReadFailure(errors.New("read newest complete risk batch: connection refused"))

	ev := r.nextEvent(t, 10*time.Second)
	require.Equal(t, eventUnavailable, ev.Event,
		"a failed refresh must reach the client; logging it and continuing to heartbeat is how an apparently-live stream serves indefinitely stale data")
	validateComponent(t, "StreamPayload", []byte(ev.Data))
	body := decodeJSON(t, ev.Data)
	require.Contains(t, str(t, body, "reason"), "could not read the risk tables")
	require.Contains(t, str(t, body, "reason"), "LAST GOOD read")
	require.EqualValues(t, f.batchID, num(t, body, "last_good_batch_id"),
		"the client must be told WHICH batch the state it is holding describes")
	require.GreaterOrEqual(t, num(t, body, "stale_since_seconds"), float64(0))
	// The reason is sanitized like every other served string.
	require.NotContains(t, ev.Data, "postgres://")
}

// TestStreamLatchesUnavailableAndEmitsARecoverySnapshot pins both halves: ONE
// event for a prolonged outage, and an explicit marked snapshot when reads return.
func TestStreamLatchesUnavailableAndEmitsARecoverySnapshot(t *testing.T) {
	f := newAPIFixture(t)
	f.srv.readFailure = &atomic.Pointer[error]{}

	r := openStream(t, f.http.URL+"/v1/stream")
	require.Equal(t, eventSnapshot, r.nextEvent(t, 5*time.Second).Event)

	f.injectReadFailure(errors.New("read newest complete risk batch: connection refused"))
	first := r.nextEvent(t, 10*time.Second)
	require.Equal(t, eventUnavailable, first.Event)

	// THE LATCH. The poll interval is 150ms, so several more failed refreshes happen
	// in the window below. None of them may produce another event: one event per poll
	// would be a flood, not a signal.
	//
	// Heartbeats DO continue, and that is asserted rather than merely tolerated —
	// the connection is genuinely alive and must keep saying so.
	deadline := time.Now().Add(1500 * time.Millisecond)
	heartbeats := 0
	for time.Now().Before(deadline) {
		fr := r.next(t, 2*time.Second)
		if fr.Comment != "" {
			heartbeats++
			continue
		}
		t.Fatalf("a second event arrived while the read failure was latched: %s %s", fr.Event, fr.Data)
	}
	require.Positive(t, heartbeats, "heartbeats must continue through the outage: the connection is alive even though the data is not fresh")

	// RECOVERY. Reads come back, and the client gets a fresh snapshot MARKED as the
	// stale-to-current transition rather than being left to infer it.
	f.injectReadFailure(nil)
	rec := r.nextEvent(t, 10*time.Second)
	require.Equal(t, eventSnapshot, rec.Event)
	validateComponent(t, "StreamPayload", []byte(rec.Data))
	body := decodeJSON(t, rec.Data)
	require.True(t, boolAt(t, body, "recovered"),
		"recovery must be explicit; a client cannot infer it from a batch id that did not move")
	require.EqualValues(t, f.batchID, num(t, body, "batch", "id"))
	require.NotNil(t, at(t, body, "degradation"))
}

// TestStreamRecoveryReportsABatchThatMovedDuringTheOutage is the case the latch
// exists for: the client's held state is not merely stale, it is WRONG, and the
// recovery snapshot has to carry the current book rather than a tick.
func TestStreamRecoveryReportsABatchThatMovedDuringTheOutage(t *testing.T) {
	f := newAPIFixture(t)
	f.srv.readFailure = &atomic.Pointer[error]{}

	r := openStream(t, f.http.URL+"/v1/stream")
	require.Equal(t, eventSnapshot, r.nextEvent(t, 5*time.Second).Event)

	f.injectReadFailure(errors.New("read newest complete risk batch: connection refused"))
	require.Equal(t, eventUnavailable, r.nextEvent(t, 10*time.Second).Event)

	// A new materialization lands WHILE the stream cannot read it.
	second := f.seedBatch(t, "fixture-materialization-during-outage")
	require.Greater(t, second, f.batchID)

	f.injectReadFailure(nil)
	rec := r.nextEvent(t, 10*time.Second)
	require.Equal(t, eventSnapshot, rec.Event)
	body := decodeJSON(t, rec.Data)
	require.True(t, boolAt(t, body, "recovered"))
	require.EqualValues(t, second, num(t, body, "batch", "id"),
		"the recovery snapshot must describe the CURRENT batch, not the one the client was holding")
	require.NotEmpty(t, arr(t, body, "engines"),
		"a recovery snapshot carries the whole posture, not a delta")
}

// TestStreamUnavailableOnConnectDoesNotClaimRecovery pins the boundary: a stream
// that was NEVER healthy has no stale-since and no last-good batch to report, and
// its first successful read is a plain snapshot rather than a recovery.
func TestStreamUnavailableOnConnectDoesNotClaimRecovery(t *testing.T) {
	f := newAPIFixture(t)
	f.srv.readFailure = &atomic.Pointer[error]{}
	f.injectReadFailure(errors.New("read newest complete risk batch: connection refused"))

	r := openStream(t, f.http.URL+"/v1/stream")
	first := r.nextEvent(t, 5*time.Second)
	require.Equal(t, eventUnavailable, first.Event)
	body := decodeJSON(t, first.Data)
	require.NotContains(t, first.Data, "stale_since_seconds",
		"a stream that was never healthy has no staleness to report")
	require.NotContains(t, first.Data, "last_good_batch_id")
	require.Nil(t, at(t, body, "batch"))

	// The first success IS marked recovered — the connect-time failure latched, so
	// the transition is real from this client's point of view.
	f.injectReadFailure(nil)
	rec := r.nextEvent(t, 10*time.Second)
	require.Equal(t, eventSnapshot, rec.Event)
	require.True(t, boolAt(t, decodeJSON(t, rec.Data), "recovered"))
}

// TestStreamEmitsARefusedEngineTransition pins the engine-scoped refusal on the
// STREAM: entering the withheld state is a degradation transition with a named key,
// not a differently-shaped snapshot a client has to diff for itself.
func TestStreamEmitsARefusedEngineTransition(t *testing.T) {
	f := newAPIFixture(t)
	r := openStream(t, f.http.URL+"/v1/stream")
	snap := r.nextEvent(t, 5*time.Second)
	require.Equal(t, eventSnapshot, snap.Event)
	require.Empty(t, arr(t, decodeJSON(t, snap.Data), "degradation", "refused_engines"))

	// The maintenance window opens: a new batch lands with the Aave engine withheld.
	withheld := f.seedWithheldBatch(t, "fixture-withheld-stream", false)

	// The batch tick arrives first, then (or with it) the degradation transition.
	var sawRefusal bool
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && !sawRefusal {
		ev := r.nextEvent(t, 10*time.Second)
		validateComponent(t, "StreamPayload", []byte(ev.Data))
		body := decodeJSON(t, ev.Data)
		if ev.Event == eventBatch {
			require.EqualValues(t, withheld, num(t, body, "batch", "id"))
			// Even the TICK cannot present the withheld engine as healthy.
			aave := byKey(t, arr(t, body, "engines"), "engine", "aave_v3_etherfi")
			require.True(t, boolAt(t, aave, "refused"))
			require.Nil(t, at(t, aave, "total_collateral"))
			continue
		}
		if ev.Event != eventDegradation {
			continue
		}
		refusedEngines := arr(t, body, "degradation", "refused_engines")
		require.Len(t, refusedEngines, 1)
		require.Equal(t, "aave_v3_etherfi", str(t, refusedEngines[0], "engine"))
		for _, tr := range arr(t, body, "transitions") {
			if strings.HasPrefix(str(t, tr, "key"), "engine_refused|") {
				require.EqualValues(t, 0, num(t, tr, "from"))
				require.EqualValues(t, 1, num(t, tr, "to"))
				sawRefusal = true
			}
		}
	}
	require.True(t, sawRefusal, "entering the withheld state must produce a named degradation transition")
}
