package main

// SSE integration against a live database: snapshot on connect, a tick when a new
// batch lands, a degradation event on a posture transition, heartbeat comment
// frames, and a fresh snapshot on reconnect.

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// sseFrame is one parsed SSE frame. A heartbeat is a comment and carries no data.
type sseFrame struct {
	Event   string
	ID      string
	Data    string
	Comment string
}

// sseReader consumes an event stream frame by frame.
type sseReader struct {
	cancel context.CancelFunc
	body   *bufio.Reader
	closer func()
}

func openStream(t *testing.T, url string) *sseReader {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	require.NoError(t, err)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
	require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"),
		"without this a buffering proxy turns the stream into a single delivery at close")

	r := &sseReader{cancel: cancel, body: bufio.NewReader(resp.Body)}
	r.closer = func() {
		cancel()
		_ = resp.Body.Close()
	}
	t.Cleanup(r.closer)
	return r
}

// next reads frames until one arrives or the deadline passes.
func (r *sseReader) next(t *testing.T, within time.Duration) sseFrame {
	t.Helper()
	type result struct {
		f   sseFrame
		err error
	}
	ch := make(chan result, 1)
	go func() {
		var f sseFrame
		for {
			line, err := r.body.ReadString('\n')
			if err != nil {
				ch <- result{err: err}
				return
			}
			line = strings.TrimRight(line, "\r\n")
			switch {
			case line == "":
				if f.Event != "" || f.Data != "" || f.Comment != "" {
					ch <- result{f: f}
					return
				}
			case strings.HasPrefix(line, ":"):
				f.Comment = strings.TrimSpace(strings.TrimPrefix(line, ":"))
				ch <- result{f: f}
				return
			case strings.HasPrefix(line, "event: "):
				f.Event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "id: "):
				f.ID = strings.TrimPrefix(line, "id: ")
			case strings.HasPrefix(line, "data: "):
				f.Data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	select {
	case res := <-ch:
		require.NoError(t, res.err)
		return res.f
	case <-time.After(within):
		t.Fatalf("no SSE frame within %s", within)
		return sseFrame{}
	}
}

// nextEvent skips heartbeat comment frames and returns the next named event.
func (r *sseReader) nextEvent(t *testing.T, within time.Duration) sseFrame {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		f := r.next(t, time.Until(deadline)+time.Second)
		if f.Event != "" {
			return f
		}
	}
	t.Fatalf("no named SSE event within %s", within)
	return sseFrame{}
}

func TestStreamSendsSnapshotOnConnect(t *testing.T) {
	f := newAPIFixture(t)
	r := openStream(t, f.http.URL+"/v1/stream")

	snap := r.nextEvent(t, 5*time.Second)
	require.Equal(t, eventSnapshot, snap.Event,
		"the FIRST named event must be a snapshot: a client that received only deltas would be rendering a posture it never saw the base of")
	require.NotEmpty(t, snap.Data)
	validateComponent(t, "StreamPayload", []byte(snap.Data))

	// The snapshot carries the batch, the aggregates and the degradation posture.
	body := decodeJSON(t, snap.Data)
	require.EqualValues(t, f.batchID, num(t, body, "batch", "id"))
	require.Equal(t, fxAaveCollateralBase,
		str(t, byKey(t, arr(t, body, "engines"), "engine", risk.AaveEngine), "total_collateral"))
	deg := at(t, body, "degradation").(map[string]any)
	require.EqualValues(t, 1, countFor(t, arr(t, byKey(t, arr(t, deg, "engines"), "engine", risk.AaveEngine), "refusals"), "G1"))
	require.Contains(t, str(t, body, "note"), "NEVER means `a new block`")
	require.EqualValues(t, int64(f.srv.cfg.SSEPoll/time.Second), num(t, body, "poll_interval_seconds"))
}

func TestStreamTicksWhenANewBatchLands(t *testing.T) {
	f := newAPIFixture(t)
	r := openStream(t, f.http.URL+"/v1/stream")
	snap := r.nextEvent(t, 5*time.Second)
	require.Equal(t, eventSnapshot, snap.Event)

	// A new materialization lands. WriteRiskBatch fires the doorbell inside the
	// commit, and the stream also polls — either path must produce the tick.
	second := f.seedBatch(t, "fixture-materialization-2")

	tick := r.nextEvent(t, 10*time.Second)
	require.Equal(t, eventBatch, tick.Event)
	validateComponent(t, "StreamPayload", []byte(tick.Data))
	body := decodeJSON(t, tick.Data)
	require.EqualValues(t, second, num(t, body, "batch", "id"))
	require.Equal(t, decimalString(second), tick.ID, "the frame id must be the batch id, so a client can correlate")
	// The tick carries the WATERMARK VECTOR, which is what makes it a statement
	// about a materialization rather than about a block.
	require.Len(t, arr(t, body, "batch", "watermarks"), 5)
}

func TestStreamEmitsADegradationEventOnAPostureTransition(t *testing.T) {
	f := newAPIFixture(t)
	r := openStream(t, f.http.URL+"/v1/stream")
	require.Equal(t, eventSnapshot, r.nextEvent(t, 5*time.Second).Event)

	// A rewind is acknowledged. NO new batch is written, so the batch id does not
	// move — and the posture still changes, because supersession is judged against
	// a LIVE cursor read. A degradation surface that only fired on new batches
	// would miss exactly this.
	_, err := f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET acked_epoch = 1 WHERE engine = $1`, risk.AaveEngine)
	require.NoError(t, err)

	ev := r.nextEvent(t, 10*time.Second)
	require.Equal(t, eventDegradation, ev.Event)
	validateComponent(t, "StreamPayload", []byte(ev.Data))
	body := decodeJSON(t, ev.Data)
	require.EqualValues(t, f.batchID, num(t, body, "batch", "id"), "the batch did not change; the POSTURE did")
	require.True(t, boolAt(t, body, "degradation", "superseded"))
	require.Contains(t, arr(t, body, "degradation", "supersession_legs"), legAckedEpochMoved)

	transitions := arr(t, body, "transitions")
	require.NotEmpty(t, transitions)
	found := false
	for _, tr := range transitions {
		if str(t, tr, "key") == "supersession|"+legAckedEpochMoved {
			require.EqualValues(t, 0, num(t, tr, "from"))
			require.EqualValues(t, 1, num(t, tr, "to"))
			found = true
		}
	}
	require.True(t, found, "the transition list must name the leg that fired")
}

func TestStreamSendsHeartbeatCommentFrames(t *testing.T) {
	f := newAPIFixture(t)
	r := openStream(t, f.http.URL+"/v1/stream")
	require.Equal(t, eventSnapshot, r.nextEvent(t, 5*time.Second).Event)

	// The fixture's heartbeat is 200ms. Nothing else changes, so a comment frame is
	// the only thing that can arrive — and it must, or an idle stream would be
	// indistinguishable from a dead one.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		f := r.next(t, 3*time.Second)
		if f.Comment != "" {
			require.True(t, strings.HasPrefix(f.Comment, "heartbeat "))
			require.Empty(t, f.Event, "a heartbeat must be a COMMENT, not a named event a client would try to parse")
			return
		}
	}
	t.Fatal("no heartbeat comment frame arrived on an idle stream")
}

func TestStreamReconnectGetsAFreshSnapshot(t *testing.T) {
	f := newAPIFixture(t)

	first := openStream(t, f.http.URL+"/v1/stream")
	require.Equal(t, eventSnapshot, first.nextEvent(t, 5*time.Second).Event)
	second := f.seedBatch(t, "fixture-materialization-2")
	require.Equal(t, eventBatch, first.nextEvent(t, 10*time.Second).Event)
	first.closer()

	// A RECONNECT — with a Last-Event-ID, which this service deliberately does not
	// use to resume: it answers with the whole current posture instead, so a client
	// that missed events while disconnected cannot end up rendering a stale base.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.http.URL+"/v1/stream", nil)
	require.NoError(t, err)
	req.Header.Set("Last-Event-ID", decimalString(f.batchID))
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	r := &sseReader{cancel: cancel, body: bufio.NewReader(resp.Body), closer: func() { cancel() }}

	snap := r.nextEvent(t, 5*time.Second)
	require.Equal(t, eventSnapshot, snap.Event, "a reconnect must receive a FRESH snapshot, not a resumed delta stream")
	body := decodeJSON(t, snap.Data)
	require.EqualValues(t, second, num(t, body, "batch", "id"),
		"the fresh snapshot must describe the CURRENT batch, not the one named in Last-Event-ID")
}

func TestStreamReportsUnavailableWhenNoBatchIsServable(t *testing.T) {
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches CASCADE`)
	require.NoError(t, err)

	r := openStream(t, f.http.URL+"/v1/stream")
	ev := r.nextEvent(t, 5*time.Second)
	require.Equal(t, eventUnavailable, ev.Event)
	validateComponent(t, "StreamPayload", []byte(ev.Data))
	body := decodeJSON(t, ev.Data)
	require.Nil(t, at(t, body, "batch"))
	require.Contains(t, str(t, body, "reason"), "not a claim that the book is empty")
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

func decodeJSON(t *testing.T, s string) map[string]any {
	t.Helper()
	var out map[string]any
	require.NoError(t, json.Unmarshal([]byte(s), &out))
	return out
}

func decimalString(v int64) string { return strconv.FormatInt(v, 10) }
