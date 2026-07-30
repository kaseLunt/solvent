package main

// /v1/stream — Server-Sent Events.
//
// The contract, from design spec §10:
//
//	snapshot-on-connect   every connection (including a reconnect) receives the
//	                      whole current posture BEFORE any tick, so a client is
//	                      never left inferring state from deltas it did not see
//	batch ticks           one event per newly-servable batch, carrying the
//	                      WATERMARK VECTOR — "new batch at vector V", NEVER "new
//	                      block": this service does not observe blocks
//	degradation events    a transition in the refusal/flag/supersession posture,
//	                      emitted the moment the posture changes rather than left
//	                      for a client to diff
//	heartbeat             SSE comment frames, so an idle stream is
//	                      distinguishable from a dead one through a buffering
//	                      proxy
//
// # NOTIFY is the optimization; the poll is the mechanism
//
// PostgreSQL drops queued notifications on reconnect, so a listener that trusted
// LISTEN alone would silently stop ticking after a network blip and look
// perfectly healthy. Every connection therefore ALSO polls on a ticker, and both
// paths converge on the same question: has the newest servable batch id changed?

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kaselunt/solvent/internal/store"
)

// notifier fans one LISTEN connection out to every open stream.
//
// ONE connection, not one per client: a public surface with a thousand streams
// must not hold a thousand PostgreSQL sessions, and the doorbell carries no
// per-client information to justify it.
type notifier struct {
	dsn  string
	poll time.Duration

	mu     sync.Mutex
	subs   map[int64]chan struct{}
	nextID int64
	// listening reports whether the LISTEN connection is currently up. It is
	// published on the snapshot so a client can see that it is relying on the
	// poll fallback rather than on the doorbell.
	listening bool
}

func newNotifier(dsn string, poll time.Duration) *notifier {
	return &notifier{dsn: dsn, poll: poll, subs: map[int64]chan struct{}{}}
}

func (n *notifier) subscribe() (int64, <-chan struct{}) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.nextID++
	id := n.nextID
	// Buffered depth 1: a doorbell is idempotent, so a subscriber that has not
	// drained the previous ring needs no second one. This is what keeps a slow
	// client from blocking the listener goroutine.
	ch := make(chan struct{}, 1)
	n.subs[id] = ch
	return id, ch
}

func (n *notifier) unsubscribe(id int64) {
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.subs, id)
}

func (n *notifier) broadcast() {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, ch := range n.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (n *notifier) isListening() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.listening
}

func (n *notifier) setListening(v bool) {
	n.mu.Lock()
	n.listening = v
	n.mu.Unlock()
}

// run holds the LISTEN connection, reconnecting with a fixed backoff.
//
// A failure here degrades latency, never correctness: with the doorbell down
// every stream still ticks on its poll.
func (n *notifier) run(ctx context.Context) {
	const backoff = 2 * time.Second
	for ctx.Err() == nil {
		if err := n.listenOnce(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("api: risk_batch listener dropped; streams fall back to polling",
				"err", sanitize(err.Error()), "retry_in", backoff)
		}
		n.setListening(false)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
	}
}

func (n *notifier) listenOnce(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, n.dsn)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(context.Background()) }()

	// The channel name is a compile-time constant of this repo, matching the one
	// riskd fires on. LISTEN cannot be parameterized; nothing from outside this
	// process reaches this statement.
	if _, err := conn.Exec(ctx, `LISTEN `+notifyChannel); err != nil {
		return err
	}
	n.setListening(true)
	for {
		// The payload is DELIBERATELY IGNORED: it is a batch id, and treating it as
		// state would let a listener serve a number it never read (chain-truth R1).
		if _, err := conn.WaitForNotification(ctx); err != nil {
			return err
		}
		n.broadcast()
	}
}

// ---------------------------------------------------------------------------
// The degradation posture.
// ---------------------------------------------------------------------------

type wireDegradationEngine struct {
	Engine                string      `json:"engine"`
	RefusedPositions      int         `json:"refused_positions"`
	FlaggedPositions      int         `json:"flagged_positions"`
	LiquidatablePositions int         `json:"liquidatable_positions"`
	Refusals              []wireCount `json:"refusals"`
	Flags                 []wireCount `json:"flags"`
}

type wireDegradation struct {
	Engines    []wireDegradationEngine `json:"engines"`
	Superseded bool                    `json:"superseded"`
	Legs       []string                `json:"supersession_legs"`
	// RefusedEngines names every engine whose WHOLE book is withheld. It is part of
	// the DEGRADATION POSTURE, so entering or leaving that state is a transition a
	// stream client is told about rather than one it has to notice.
	RefusedEngines []wireEngineRefusal `json:"refused_engines"`
	Note           string              `json:"note"`
}

// degradationKeys is the posture flattened into a comparable map, so a
// transition is a set difference rather than a hand-written comparison that a
// new field could silently escape.
func degradationKeys(d wireDegradation) map[string]int {
	out := map[string]int{}
	for _, e := range d.Engines {
		for _, c := range e.Refusals {
			out["refusal|"+e.Engine+"|"+c.Key] = c.Count
		}
		for _, c := range e.Flags {
			out["flag|"+e.Engine+"|"+c.Key] = c.Count
		}
	}
	for _, l := range d.Legs {
		out["supersession|"+l] = 1
	}
	// An engine's whole book being withheld is a POSTURE FACT, so it gets a key: a
	// stream that entered or left the withheld state must produce a transition, not
	// merely a differently-shaped snapshot nobody re-read.
	for _, r := range d.RefusedEngines {
		out["engine_refused|"+r.Engine+"|"+r.Code] = 1
	}
	return out
}

type wireTransition struct {
	Key  string `json:"key"`
	From int    `json:"from"`
	To   int    `json:"to"`
}

func transitions(prev, cur map[string]int) []wireTransition {
	seen := map[string]bool{}
	var out []wireTransition
	for k, v := range cur {
		seen[k] = true
		if prev[k] != v {
			out = append(out, wireTransition{Key: k, From: prev[k], To: v})
		}
	}
	for k, v := range prev {
		if !seen[k] {
			out = append(out, wireTransition{Key: k, From: v, To: 0})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// degradation builds the posture from the batch's own rows and the live
// supersession verdict.
func degradation(v *batchView, env wireBatch) wireDegradation {
	refusals := map[string]map[string]int{}
	flags := map[string]map[string]int{}
	refused := map[string]int{}
	flagged := map[string]int{}
	bump := func(m map[string]map[string]int, engine, key string) {
		if key == "" {
			return
		}
		inner, ok := m[engine]
		if !ok {
			inner = map[string]int{}
			m[engine] = inner
		}
		inner[key]++
	}
	for _, p := range v.Positions {
		if p.Status == store.RiskPositionRefused {
			refused[p.Engine]++
			bump(refusals, p.Engine, p.RefusalCode)
		}
		if p.reconstructionErr != "" {
			refused[p.Engine]++
			bump(refusals, p.Engine, refusalReconstruction)
		}
		if len(p.Flags) > 0 {
			flagged[p.Engine]++
		}
		for _, f := range p.Flags {
			bump(flags, p.Engine, f)
		}
	}

	out := wireDegradation{
		Engines:        []wireDegradationEngine{},
		Superseded:     env.Supersession.Superseded,
		Legs:           []string{},
		RefusedEngines: engineRefusals(v),
		Note: "a degradation event is a TRANSITION in this posture, not a new fact about the chain. " +
			"Refusals are named, counted and served; the book is never published with a position quietly missing, and an engine whose whole book is withheld appears in `refused_engines` rather than as a healthy empty one.",
	}
	names := map[string]bool{}
	for _, a := range v.Aggregates {
		names[a.Engine] = true
	}
	for e := range refusals {
		names[e] = true
	}
	for e := range flags {
		names[e] = true
	}
	sorted := make([]string, 0, len(names))
	for e := range names {
		sorted = append(sorted, e)
	}
	sort.Strings(sorted)
	byEngine := map[string]store.RiskEngineAggregate{}
	for _, a := range v.Aggregates {
		byEngine[a.Engine] = a
	}
	for _, e := range sorted {
		out.Engines = append(out.Engines, wireDegradationEngine{
			Engine:                e,
			RefusedPositions:      refused[e],
			FlaggedPositions:      flagged[e],
			LiquidatablePositions: byEngine[e].LiquidatablePositions,
			Refusals:              counts(refusals[e]),
			Flags:                 counts(flags[e]),
		})
	}
	legs := map[string]bool{}
	for _, l := range env.Supersession.Legs {
		legs[l.Leg] = true
	}
	for l := range legs {
		out.Legs = append(out.Legs, l)
	}
	sort.Strings(out.Legs)
	return out
}

// ---------------------------------------------------------------------------
// The stream.
// ---------------------------------------------------------------------------

// SSE event names. A closed set, so a client can switch on them.
const (
	eventSnapshot    = "snapshot"
	eventBatch       = "batch"
	eventDegradation = "degradation"
	eventUnavailable = "unavailable"
)

type streamPayload struct {
	ServedAt time.Time `json:"served_at"`
	// Reason is set only on the `unavailable` event.
	Reason string `json:"reason,omitempty"`
	// StaleSinceSeconds is set on an `unavailable` event raised AFTER the stream had
	// been healthy: how long the data a client is still holding has been the last
	// good read. Without it a client cannot tell a momentary hiccup from an outage
	// it has been rendering through.
	StaleSinceSeconds *int64 `json:"stale_since_seconds,omitempty"`
	// LastGoodBatchID is the batch the client's held state describes, if any.
	LastGoodBatchID *int64 `json:"last_good_batch_id,omitempty"`
	// Recovered marks the snapshot emitted when reads come back after a failure —
	// the explicit stale-to-current transition, so recovery is not left to be
	// inferred from whether the batch id happened to change.
	Recovered bool `json:"recovered,omitempty"`

	Batch       *wireBatch       `json:"batch"`
	Engines     []wireAggregate  `json:"engines"`
	Degradation *wireDegradation `json:"degradation"`
	// Transitions is set only on a `degradation` event.
	Transitions []wireTransition `json:"transitions,omitempty"`
	// ListenerConnected reports whether the LISTEN doorbell is up. When false the
	// stream is running on its poll fallback and ticks are up to
	// `poll_interval_seconds` late — which the client is entitled to know.
	ListenerConnected   bool   `json:"listener_connected"`
	PollIntervalSeconds int64  `json:"poll_interval_seconds"`
	Note                string `json:"note"`
}

const streamNote = "a batch tick means `a new batch exists at watermark vector V`. It NEVER means `a new block`: this service makes no chain calls and does not observe blocks."

func (s *server) handleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, codeInternal,
			"this server cannot stream: the response writer does not support flushing", nil)
		return
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-store")
	h.Set("Connection", "keep-alive")
	// nginx and friends buffer a response body by default, which turns a live
	// stream into a batch delivery at close. This is the documented opt-out.
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ctx := r.Context()
	subID, doorbell := s.notifier.subscribe()
	defer s.notifier.unsubscribe(subID)

	poll := time.NewTicker(s.cfg.SSEPoll)
	defer poll.Stop()
	beat := time.NewTicker(s.cfg.SSEHeartbeat)
	defer beat.Stop()

	// SNAPSHOT ON CONNECT, unconditionally — including on a reconnect. A client
	// that resumed mid-stream and received only deltas would be rendering a
	// posture it never saw the base of.
	st := &streamState{}
	s.emitSnapshot(ctx, w, flusher, st)

	for {
		select {
		case <-ctx.Done():
			return
		case <-beat.C:
			// A COMMENT frame: syntactically inert for every SSE client, and enough
			// to keep an idle connection observably alive.
			//
			// IT IS NOT A HEALTH SIGNAL, and that distinction is why the read-health
			// latch below exists: a heartbeat continuing through a database outage is
			// what made an apparently-live stream over indefinitely stale data
			// possible.
			if !writeRaw(w, flusher, ": heartbeat "+strconv.FormatInt(time.Now().UTC().Unix(), 10)+"\n\n") {
				return
			}
		case <-doorbell:
			if !s.emitIfChanged(ctx, w, flusher, st) {
				return
			}
		case <-poll.C:
			if !s.emitIfChanged(ctx, w, flusher, st) {
				return
			}
		}
	}
}

// streamState is one connection's carried state.
type streamState struct {
	batchID int64
	keys    map[string]int

	// unhealthy LATCHES on the first failed refresh, so a prolonged outage produces
	// exactly ONE `unavailable` event rather than one per poll — and recovery
	// produces exactly one `snapshot` marked `recovered`. Without the latch a client
	// either drowns in events or, as before, hears nothing at all.
	unhealthy bool
	// lastGood is when the held state was last refreshed successfully, on the
	// DATABASE clock, so `stale_since_seconds` is measured the same way every other
	// age on this surface is.
	lastGood time.Time
}

// emitSnapshot writes the connect-time snapshot and records the state it
// describes.
func (s *server) emitSnapshot(ctx context.Context, w http.ResponseWriter, f http.Flusher, st *streamState) bool {
	v, err := s.refresh(ctx)
	if err != nil {
		st.unhealthy = true
		st.keys = map[string]int{}
		return writeEvent(w, f, eventUnavailable, 0, streamPayload{
			ServedAt:            time.Now().UTC(),
			Reason:              unavailableReason(err),
			ListenerConnected:   s.notifier.isListening(),
			PollIntervalSeconds: int64(s.cfg.SSEPoll / time.Second),
			Note:                streamNote,
		})
	}
	env := batchEnvelope(v)
	deg := degradation(v, env)
	st.batchID, st.keys, st.unhealthy, st.lastGood = v.Batch.ID, degradationKeys(deg), false, v.Now
	return writeEvent(w, f, eventSnapshot, v.Batch.ID, streamPayload{
		ServedAt:            v.Now,
		Batch:               &env,
		Engines:             s.aggregates(v),
		Degradation:         &deg,
		ListenerConnected:   s.notifier.isListening(),
		PollIntervalSeconds: int64(s.cfg.SSEPoll / time.Second),
		Note:                streamNote,
	})
}

// unavailableReason renders a read failure for a client, sanitized.
func unavailableReason(err error) string {
	if errorsIsNoBatch(err) {
		return "no complete risk batch is available yet: this is a statement about this service, not a claim that the book is empty"
	}
	return "the service could not read the risk tables: " + sanitize(err.Error()) +
		". The state you are holding is the LAST GOOD read and is not being refreshed."
}

// emitIfChanged refreshes and emits whatever the refresh implies. ok=false means
// the client is gone.
//
// # The read-health latch
//
// A failed refresh used to be logged and nothing else, while the independent
// heartbeat ticker kept writing comment frames — so a database outage left every
// connected client with an apparently-live stream over indefinitely stale data.
// Now the FIRST failure emits one `unavailable` event carrying how long the held
// state has been stale and which batch it describes, and latches; subsequent
// failures are silent (an event per poll would be a flood, not a signal); and the
// first success after a failure emits a `snapshot` marked `recovered`, which is the
// explicit stale-to-current transition rather than one a client has to infer from
// whether the batch id happened to move.
func (s *server) emitIfChanged(ctx context.Context, w http.ResponseWriter, f http.Flusher, st *streamState) bool {
	v, err := s.refresh(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return false
		}
		if st.unhealthy {
			// Already latched: log and stay quiet.
			slog.Warn("api: stream read still failing", "err", sanitize(err.Error()))
			return true
		}
		st.unhealthy = true
		slog.Warn("api: stream read failed; clients notified", "err", sanitize(err.Error()))
		p := streamPayload{
			ServedAt:            time.Now().UTC(),
			Reason:              unavailableReason(err),
			ListenerConnected:   s.notifier.isListening(),
			PollIntervalSeconds: int64(s.cfg.SSEPoll / time.Second),
			Note:                streamNote,
		}
		if !st.lastGood.IsZero() {
			// Measured from the DATABASE clock of the last good read — the same basis as
			// every other age on this surface.
			stale := int64(time.Since(st.lastGood) / time.Second)
			if stale < 0 {
				stale = 0
			}
			p.StaleSinceSeconds = &stale
		}
		if st.batchID > 0 {
			id := st.batchID
			p.LastGoodBatchID = &id
		}
		return writeEvent(w, f, eventUnavailable, st.batchID, p)
	}

	env := batchEnvelope(v)
	deg := degradation(v, env)
	keys := degradationKeys(deg)
	recovered := st.unhealthy
	st.unhealthy, st.lastGood = false, v.Now

	if recovered {
		// RECOVERY IS ITS OWN EVENT. A fresh snapshot, marked, because the client's
		// held state may be arbitrarily far behind and nothing about a resumed tick
		// would tell it that.
		st.batchID, st.keys = v.Batch.ID, keys
		return writeEvent(w, f, eventSnapshot, v.Batch.ID, streamPayload{
			ServedAt:            v.Now,
			Batch:               &env,
			Engines:             s.aggregates(v),
			Degradation:         &deg,
			Recovered:           true,
			ListenerConnected:   s.notifier.isListening(),
			PollIntervalSeconds: int64(s.cfg.SSEPoll / time.Second),
			Note:                streamNote,
		})
	}

	if v.Batch.ID != st.batchID {
		if !writeEvent(w, f, eventBatch, v.Batch.ID, streamPayload{
			ServedAt:            v.Now,
			Batch:               &env,
			Engines:             s.aggregates(v),
			Degradation:         &deg,
			ListenerConnected:   s.notifier.isListening(),
			PollIntervalSeconds: int64(s.cfg.SSEPoll / time.Second),
			Note:                streamNote,
		}) {
			return false
		}
	}

	// The degradation event is emitted on a TRANSITION — including a transition
	// that happens without the batch id moving (a supersession leg firing against
	// a live cursor read does exactly that, and so does an engine's book being
	// withheld).
	if tr := transitions(st.keys, keys); len(tr) > 0 {
		if !writeEvent(w, f, eventDegradation, v.Batch.ID, streamPayload{
			ServedAt:            v.Now,
			Batch:               &env,
			Degradation:         &deg,
			Transitions:         tr,
			ListenerConnected:   s.notifier.isListening(),
			PollIntervalSeconds: int64(s.cfg.SSEPoll / time.Second),
			Note:                streamNote,
		}) {
			return false
		}
	}
	st.batchID, st.keys = v.Batch.ID, keys
	return true
}

// writeEvent emits one SSE frame. It returns false when the client is gone.
func writeEvent(w http.ResponseWriter, f http.Flusher, event string, id int64, payload streamPayload) bool {
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("api: encoding stream event failed", "event", event, "err", sanitize(err.Error()))
		return true
	}
	frame := "event: " + event + "\n"
	if id > 0 {
		frame += "id: " + strconv.FormatInt(id, 10) + "\n"
	}
	frame += "data: " + string(body) + "\n\n"
	return writeRaw(w, f, frame)
}

func writeRaw(w http.ResponseWriter, f http.Flusher, frame string) bool {
	if _, err := fmt.Fprint(w, frame); err != nil {
		return false
	}
	f.Flush()
	return true
}
