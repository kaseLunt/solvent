package derive

// Runner sequencing tests with fakes. A single shared call log spans the fake
// store and the fake engine so cross-object ordering — derive-after-rewind,
// rates-before-apply, Reset-on-ApplyDerived-error — is pinned as an exact
// call sequence, not inferred from end state.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Shared call log + fakes.
// ---------------------------------------------------------------------------

type callLog struct{ calls []string }

func (c *callLog) add(s string) { c.calls = append(c.calls, s) }

// since returns the calls appended after mark.
func (c *callLog) since(mark int) []string { return c.calls[mark:] }

type fakeRunnerStore struct {
	log *callLog

	cursor      uint64
	cursorFound bool
	ingest      map[string]*store.CursorPos
	logs        []store.RawLog
	unacked     bool

	// applyErr fails the next ApplyDerivedWithRates call (one-shot); when
	// applyAdvancesDespiteErr is set the cursor still advances — the
	// commit-landed-with-lost-ack world.
	applyErr                error
	applyAdvancesDespiteErr bool

	// lastRates captures the rate observations handed to the most recent
	// ApplyDerivedWithRates call (atomicity assertions).
	lastRates []store.RateObservation

	// rewindDeepTo, when set, lands the cursor at min(requested, rewindDeepTo)
	// — RewindDerived's deepest-unacked-epoch lowering.
	rewindDeepTo *uint64

	// snapshotsErr fails the next SaveSnapshots call (one-shot); snapDocs
	// captures every successful bulk write's documents in call order.
	snapshotsErr error
	snapDocs     []map[string]store.SnapshotDoc

	balances map[string]map[string]map[string]*big.Int // account-hex → asset → side → amount
}

func newFakeRunnerStore(log *callLog) *fakeRunnerStore {
	return &fakeRunnerStore{log: log, ingest: map[string]*store.CursorPos{}}
}

func (f *fakeRunnerStore) BalancesFor(_ context.Context, _ string, account []byte) (map[string]map[string]*big.Int, error) {
	f.log.add(fmt.Sprintf("BalancesFor(%x)", account))
	out := map[string]map[string]*big.Int{}
	for asset, sides := range f.balances[fmt.Sprintf("%x", account)] {
		out[asset] = map[string]*big.Int{}
		for side, v := range sides {
			out[asset][side] = new(big.Int).Set(v)
		}
	}
	return out, nil
}

func (f *fakeRunnerStore) DeriveCursor(context.Context, string) (uint64, bool, error) {
	f.log.add("DeriveCursor")
	return f.cursor, f.cursorFound, nil
}

func (f *fakeRunnerStore) ApplyDerivedWithRates(_ context.Context, _ string, _ uint64, events []store.PositionEvent, rates []store.RateObservation, throughBlock uint64) error {
	f.log.add(fmt.Sprintf("ApplyDerived(events=%d,rates=%d,through=%d)", len(events), len(rates), throughBlock))
	f.lastRates = rates
	if f.applyErr != nil {
		err := f.applyErr
		f.applyErr = nil
		if f.applyAdvancesDespiteErr {
			f.cursor, f.cursorFound = throughBlock, true
		}
		return err
	}
	f.cursor, f.cursorFound = throughBlock, true
	return nil
}

func (f *fakeRunnerStore) RewindDerived(_ context.Context, _ string, _ uint64, toBlock uint64) error {
	f.log.add(fmt.Sprintf("RewindDerived(to=%d)", toBlock))
	effective := toBlock
	if f.rewindDeepTo != nil && *f.rewindDeepTo < effective {
		effective = *f.rewindDeepTo
	}
	f.cursor, f.cursorFound = effective, true
	f.unacked = false // RewindDerived acks every epoch on the chain
	return nil
}

func (f *fakeRunnerStore) Cursor(_ context.Context, stream string) (*store.CursorPos, error) {
	f.log.add(fmt.Sprintf("Cursor(%s)", stream))
	return f.ingest[stream], nil
}

func (f *fakeRunnerStore) RawLogsInRange(_ context.Context, _ uint64, _ [][]byte, fromBlock, toBlock uint64) ([]store.RawLog, error) {
	f.log.add(fmt.Sprintf("RawLogs(%d-%d)", fromBlock, toBlock))
	var out []store.RawLog
	for _, l := range f.logs {
		if l.BlockNumber >= fromBlock && l.BlockNumber <= toBlock {
			out = append(out, l)
		}
	}
	return out, nil
}

func (f *fakeRunnerStore) HasUnackedReorg(context.Context, string, uint64) (bool, error) {
	f.log.add("HasUnackedReorg")
	return f.unacked, nil
}

func (f *fakeRunnerStore) SaveSnapshots(_ context.Context, _ string, block uint64, docs map[string]store.SnapshotDoc) error {
	f.log.add(fmt.Sprintf("SaveSnapshots(%d@%d)", len(docs), block))
	if f.snapshotsErr != nil {
		err := f.snapshotsErr
		f.snapshotsErr = nil
		return err
	}
	f.snapDocs = append(f.snapDocs, docs)
	return nil
}

// fakeRunnerEngine records lifecycle calls into the shared log and enforces
// the batch guards so a runner lifecycle bug fails loudly.
type fakeRunnerEngine struct {
	log       *callLog
	name      string
	inBatch   bool
	processFn func(l store.RawLog, ev decode.Event) ([]store.PositionEvent, error)
}

func (e *fakeRunnerEngine) Name() string { return e.name }

func (e *fakeRunnerEngine) BeginBatch(ctx context.Context, reader StateReader) error {
	e.log.add("BeginBatch")
	if e.inBatch {
		return errors.New("fake engine: BeginBatch inside a batch")
	}
	if ctx == nil || reader == nil {
		return errors.New("fake engine: nil ctx or reader")
	}
	e.inBatch = true
	return nil
}

func (e *fakeRunnerEngine) Process(l store.RawLog, ev decode.Event) ([]store.PositionEvent, error) {
	e.log.add(fmt.Sprintf("Process(%d/%d)", l.BlockNumber, l.LogIndex))
	if !e.inBatch {
		return nil, errors.New("fake engine: Process outside a batch")
	}
	if e.processFn != nil {
		return e.processFn(l, ev)
	}
	return nil, nil
}

func (e *fakeRunnerEngine) CommitBatch()  { e.log.add("CommitBatch"); e.inBatch = false }
func (e *fakeRunnerEngine) DiscardBatch() { e.log.add("DiscardBatch"); e.inBatch = false }
func (e *fakeRunnerEngine) Reset()        { e.log.add("Reset"); e.inBatch = false }

// fakeRunnerDecoder maps "block/logIndex" → decoded event; unmapped logs are
// unallowlisted skips (ok=false, nil error), mirroring decode.Registry.
type fakeRunnerDecoder struct {
	events map[string]decode.Event
	errOn  map[string]error
}

func (d *fakeRunnerDecoder) Decode(_ string, l store.RawLog) (decode.Event, bool, error) {
	key := fmt.Sprintf("%d/%d", l.BlockNumber, l.LogIndex)
	if err := d.errOn[key]; err != nil {
		return nil, false, err
	}
	ev, ok := d.events[key]
	return ev, ok, nil
}

type stubEvent struct{ name string }

func (s stubEvent) Name() string { return s.name }

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

func rlog(block uint64, logIndex uint32) store.RawLog {
	return store.RawLog{
		ChainID: 10, BlockNumber: block, BlockHash: []byte{0xbb},
		TxHash: []byte{byte(block), byte(logIndex)}, LogIndex: logIndex,
		Address: []byte{0xA1}, Topics: [][]byte{{0x01}}, Data: nil,
	}
}

func testRunnerSpec() RunnerSpec {
	return RunnerSpec{
		Engine: "debt_manager", Chain: "op", ChainID: 10,
		Streams: []string{"s1"}, Addresses: [][]byte{{0xA1}},
		StartBlock: 100, Window: 10,
	}
}

type runnerHarness struct {
	log     *callLog
	st      *fakeRunnerStore
	eng     *fakeRunnerEngine
	dec     *fakeRunnerDecoder
	rewinds int
	r       *Runner
}

func newRunnerHarness(t *testing.T, spec RunnerSpec) *runnerHarness {
	t.Helper()
	h := &runnerHarness{log: &callLog{}}
	h.st = newFakeRunnerStore(h.log)
	h.eng = &fakeRunnerEngine{log: h.log, name: spec.Engine}
	h.dec = &fakeRunnerDecoder{events: map[string]decode.Event{}, errOn: map[string]error{}}
	r, err := NewRunner(h.st, h.dec, h.eng, spec, func() { h.rewinds++ })
	require.NoError(t, err)
	h.r = r
	return h
}

// debtEventFn returns a processFn deriving one debt event per log for the
// given per-log accounts (cycled).
func debtEventFn(accounts ...byte) func(l store.RawLog, ev decode.Event) ([]store.PositionEvent, error) {
	i := 0
	return func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
		acct := accounts[i%len(accounts)]
		i++
		return []store.PositionEvent{{
			ChainID: l.ChainID, Engine: "debt_manager", BlockNumber: l.BlockNumber,
			TxHash: l.TxHash, LogIndex: l.LogIndex, EventType: "test",
			Account: []byte{acct}, Asset: []byte{0xBB}, Side: "debt", Delta: big.NewInt(1),
		}}, nil
	}
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

// TestBuildRunnerSpecs pins the config→engine grouping: address union with
// dedupe, min start block, max window, per-engine stream lists, config order.
func TestBuildRunnerSpecs(t *testing.T) {
	a1 := common.HexToAddress("0x00000000000000000000000000000000000000A1")
	a2 := common.HexToAddress("0x00000000000000000000000000000000000000A2")
	a3 := common.HexToAddress("0x00000000000000000000000000000000000000A3")
	cfg := &config.Config{
		Chains: map[string]config.Chain{
			"op":  {ChainID: 10},
			"eth": {ChainID: 1},
		},
		Streams: []config.Stream{
			{Name: "eth:pool", Chain: "eth", Engine: "aave_v3_etherfi", Addresses: []common.Address{a1}, StartBlock: 500, Window: 2000},
			{Name: "op:dm", Chain: "op", Engine: "debt_manager", Addresses: []common.Address{a3}, StartBlock: 900, Window: 1000},
			{Name: "eth:atoken", Chain: "eth", Engine: "aave_v3_etherfi", Addresses: []common.Address{a2, a1}, StartBlock: 400, Window: 3000},
		},
	}
	specs, err := BuildRunnerSpecs(cfg)
	require.NoError(t, err)
	require.Len(t, specs, 2)

	require.Equal(t, RunnerSpec{
		Engine: "aave_v3_etherfi", Chain: "eth", ChainID: 1,
		Streams:    []string{"eth:pool", "eth:atoken"},
		Addresses:  [][]byte{a1.Bytes(), a2.Bytes()}, // a1 deduped across streams
		StartBlock: 400, Window: 3000,
	}, specs[0])
	require.Equal(t, RunnerSpec{
		Engine: "debt_manager", Chain: "op", ChainID: 10,
		Streams:    []string{"op:dm"},
		Addresses:  [][]byte{a3.Bytes()},
		StartBlock: 900, Window: 1000,
	}, specs[1])

	// One engine spanning two chains is refused: a serial (block, logIndex)
	// feed has no cross-chain total order.
	cfg.Streams = append(cfg.Streams, config.Stream{
		Name: "op:aave", Chain: "op", Engine: "aave_v3_etherfi",
		Addresses: []common.Address{a1}, StartBlock: 1, Window: 10,
	})
	_, err = BuildRunnerSpecs(cfg)
	require.ErrorContains(t, err, "spans chains")
}

func TestNewRunnerValidation(t *testing.T) {
	log := &callLog{}
	st := newFakeRunnerStore(log)
	eng := &fakeRunnerEngine{log: log, name: "debt_manager"}
	dec := &fakeRunnerDecoder{}

	_, err := NewRunner(nil, dec, eng, testRunnerSpec(), nil)
	require.ErrorContains(t, err, "required")

	spec := testRunnerSpec()
	spec.Engine = "aave_v3_etherfi" // engine.Name() mismatch
	_, err = NewRunner(st, dec, eng, spec, nil)
	require.ErrorContains(t, err, "does not match")

	spec = testRunnerSpec()
	spec.Window = 0
	_, err = NewRunner(st, dec, eng, spec, nil)
	require.ErrorContains(t, err, "required")
}

// TestRunnerHappyPathOrdering pins the full per-window call sequence:
// reorg check → frontier → cursor → windowed read → BeginBatch → serial
// Process → ApplyDerivedWithRates (one tx) → CommitBatch → ONE bulk
// side-scoped snapshot flush of the touched accounts. The window is capped
// by the ingest frontier, and a caught-up second Step (nothing pending) does
// nothing.
func TestRunnerHappyPathOrdering(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 104}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1), rlog(101, 0)}
	for _, k := range []string{"100/0", "100/1", "101/0"} {
		h.dec.events[k] = stubEvent{name: k}
	}
	h.eng.processFn = debtEventFn(0xAA, 0xAA, 0xBC) // two touches of AA dedupe into one snapshot doc

	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []string{
		"HasUnackedReorg",
		"Cursor(s1)",
		"DeriveCursor",
		"RawLogs(100-104)",
		"BeginBatch",
		"Process(100/0)",
		"Process(100/1)",
		"Process(101/0)",
		"ApplyDerived(events=3,rates=0,through=104)",
		"CommitBatch",
		"BalancesFor(aa)",
		"BalancesFor(bc)",
		"SaveSnapshots(2@104)",
	}, h.log.calls)

	// Caught up: cursor == frontier and nothing pending → nothing to do, no
	// batch started, no snapshot write.
	mark := len(h.log.calls)
	advanced, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, []string{"HasUnackedReorg", "Cursor(s1)", "DeriveCursor"}, h.log.since(mark))
}

// TestRunnerUnallowlistedLogsSkipped: a log the decoder does not know
// (ok=false) is skipped without reaching the engine.
func TestRunnerUnallowlistedLogsSkipped(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1)}
	h.dec.events["100/1"] = stubEvent{name: "known"} // 100/0 unallowlisted

	_, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.NotContains(t, h.log.calls, "Process(100/0)")
	require.Contains(t, h.log.calls, "Process(100/1)")
}

// TestRunnerWindowCapping: a frontier far ahead is consumed Window blocks at
// a time, from the cursor read fresh each Step.
func TestRunnerWindowCapping(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec()) // StartBlock 100, Window 10
	h.st.ingest["s1"] = &store.CursorPos{Block: 500}

	_, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.Contains(t, h.log.calls, "RawLogs(100-109)")

	_, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.Contains(t, h.log.calls, "RawLogs(110-119)")
}

// TestRunnerFrontierGating: the derive frontier is the MIN over the engine's
// stream cursors (above it some stream's logs may be missing), and a stream
// that has never ingested blocks derivation entirely.
func TestRunnerFrontierGating(t *testing.T) {
	spec := testRunnerSpec()
	spec.Streams = []string{"s1", "s2"}
	h := newRunnerHarness(t, spec)
	h.st.ingest["s1"] = &store.CursorPos{Block: 300}
	h.st.ingest["s2"] = &store.CursorPos{Block: 102}

	_, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.Contains(t, h.log.calls, "RawLogs(100-102)", "window must stop at the laggard stream's cursor")

	// A stream with no cursor at all: no complete window exists.
	delete(h.st.ingest, "s2")
	mark := len(h.log.calls)
	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	for _, c := range h.log.since(mark) {
		require.NotContains(t, c, "RawLogs", "no window may be read while a stream has never ingested")
	}
}

// TestRunnerResetOnApplyDerivedErrorNeverDiscard pins the commit-indeterminacy
// rule: ANY ApplyDerived error → Engine.Reset(), never DiscardBatch — and the
// next Step resumes from the CURSOR READ BACK, here simulating the
// commit-landed-with-lost-ack world where the cursor advanced despite the
// error.
func TestRunnerResetOnApplyDerivedErrorNeverDiscard(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 120}
	h.st.applyErr = errors.New("connection reset during commit")
	h.st.applyAdvancesDespiteErr = true

	_, err := h.r.Step(context.Background())
	require.ErrorContains(t, err, "connection reset")
	require.Contains(t, h.log.calls, "Reset")
	require.NotContains(t, h.log.calls, "DiscardBatch",
		"DiscardBatch after an ApplyDerived error would preserve pre-batch memory against a possibly-advanced store")

	// The commit landed (cursor 109); the next window starts at 110, proving
	// the runner trusts the cursor, not its own memory of the failed attempt.
	mark := len(h.log.calls)
	_, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.Contains(t, h.log.since(mark), "RawLogs(110-119)")
}

// TestRunnerDiscardOnProcessError: a Process error mid-batch provably never
// reached ApplyDerived — DiscardBatch, never Reset, and no apply call.
func TestRunnerDiscardOnProcessError(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0)}
	h.dec.events["100/0"] = stubEvent{name: "x"}
	h.eng.processFn = func(store.RawLog, decode.Event) ([]store.PositionEvent, error) {
		return nil, errors.New("fold divergence")
	}

	_, err := h.r.Step(context.Background())
	require.ErrorContains(t, err, "fold divergence")
	require.Contains(t, h.log.calls, "DiscardBatch")
	require.NotContains(t, h.log.calls, "Reset")
	for _, c := range h.log.calls {
		require.NotContains(t, c, "ApplyDerived")
	}
}

// TestRunnerDecodeErrorDiscards: a decode failure is likewise
// pre-persistence — DiscardBatch and no apply.
func TestRunnerDecodeErrorDiscards(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0)}
	h.dec.errOn["100/0"] = errors.New("malformed data")

	_, err := h.r.Step(context.Background())
	require.ErrorContains(t, err, "malformed data")
	require.Contains(t, h.log.calls, "DiscardBatch")
	for _, c := range h.log.calls {
		require.NotContains(t, c, "ApplyDerived")
	}
}

// TestRunnerUnsupportedBorrowTokenMarksUnhealthy pins the terminal capability
// error: ErrUnsupportedBorrowToken → engine UNHEALTHY, never retried — every
// subsequent Step performs the MANDATORY reorg check and nothing else
// (derivation is gated; repair is not), and Health() surfaces the reason.
func TestRunnerUnsupportedBorrowTokenMarksUnhealthy(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0)}
	h.dec.events["100/0"] = stubEvent{name: "x"}
	h.eng.processFn = func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
		return nil, fmt.Errorf("token %x: %w", l.Address, ErrUnsupportedBorrowToken)
	}

	healthy, reason := h.r.Health()
	require.True(t, healthy)
	require.Empty(t, reason)

	_, err := h.r.Step(context.Background())
	require.ErrorIs(t, err, ErrUnsupportedBorrowToken)
	require.ErrorIs(t, h.r.Unhealthy(), ErrUnsupportedBorrowToken)
	require.Contains(t, h.log.calls, "DiscardBatch")
	healthy, reason = h.r.Health()
	require.False(t, healthy)
	require.Contains(t, reason, "unsupported")

	mark := len(h.log.calls)
	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, []string{"HasUnackedReorg"}, h.log.since(mark),
		"an unhealthy engine still runs the reorg check (repair is mandatory) but derives nothing")
}

// TestRunnerRewindBeforeDerive pins the reorg-coordination ordering: an
// unacked epoch is answered with RewindDerived → Reset → cursor re-read →
// re-sweep trigger BEFORE any window read or apply — rate-index hygiene is
// INSIDE RewindDerived's transaction now, so no separate delete call may
// appear — and the store may rewind DEEPER than the requested target
// (deepest-unacked-epoch lowering), so the next window starts at the
// read-back cursor, not the requested target.
func TestRunnerRewindBeforeDerive(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 200}
	h.st.cursor, h.st.cursorFound = 150, true
	h.st.unacked = true
	deep := uint64(120)
	h.st.rewindDeepTo = &deep

	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []string{
		"HasUnackedReorg",
		"DeriveCursor",
		"RewindDerived(to=150)",
		"Reset",
		"DeriveCursor",
	}, h.log.calls, "rewind must complete before any derivation; hygiene is transactional inside RewindDerived")
	require.Equal(t, 1, h.rewinds, "snapshot re-sweep trigger must fire on rewind")

	// Next Step: epoch acked, derivation resumes from the DEEPER cursor.
	mark := len(h.log.calls)
	_, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.Contains(t, h.log.since(mark), "RawLogs(121-130)")
}

// TestRunnerBootstrapRewindOnEpochChain: a cursor-less engine on an
// epoch-carrying chain bootstraps through RewindDerived at StartBlock-1.
func TestRunnerBootstrapRewindOnEpochChain(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.unacked = true // no cursor + recorded epochs

	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Contains(t, h.log.calls, "RewindDerived(to=99)")
}

// TestRunnerEpochRecoveryOnApplyRefusal pins the reactive backstop: the
// proactive check saw no epoch, but the apply refused with
// ErrUnackedReorgEpoch (a rewind raced in) — Reset first (commit
// indeterminacy applies to EVERY apply error), then RewindDerived (which
// carries the rate hygiene in its own transaction), cursor re-read, re-sweep
// trigger.
func TestRunnerEpochRecoveryOnApplyRefusal(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 104}
	h.st.applyErr = fmt.Errorf("engine has %w 3 on chain 10", store.ErrUnackedReorgEpoch)

	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []string{
		"HasUnackedReorg",
		"Cursor(s1)",
		"DeriveCursor",
		"RawLogs(100-104)",
		"BeginBatch",
		"ApplyDerived(events=0,rates=0,through=104)",
		"Reset",
		"DeriveCursor",
		"RewindDerived(to=99)",
		"Reset",
		"DeriveCursor",
	}, h.log.calls)
	require.NotContains(t, h.log.calls, "DiscardBatch")
	require.Equal(t, 1, h.rewinds)
}

// TestRunnerRateObservations pins what the runner persists and HOW: DM
// InterestIndexUpdated → borrow_index (last same-key observation wins), Aave
// ReserveDataUpdated → variable_borrow_index + liquidity_index, all handed
// to ApplyDerivedWithRates ATOMICALLY with the window — no separate
// SaveRateIndex pre-pass exists anymore.
func TestRunnerRateObservations(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1), rlog(100, 2)}
	token := common.HexToAddress("0x00000000000000000000000000000000000000BB")
	reserve := common.HexToAddress("0x00000000000000000000000000000000000000CC")
	h.dec.events["100/0"] = decode.DMInterestIndexUpdated{Token: token, NewIndex: big.NewInt(111)}
	h.dec.events["100/1"] = decode.DMInterestIndexUpdated{Token: token, NewIndex: big.NewInt(222)} // supersedes 111
	h.dec.events["100/2"] = decode.AaveReserveDataUpdated{
		Reserve: reserve, VariableBorrowIndex: big.NewInt(333), LiquidityIndex: big.NewInt(444),
	}

	_, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.Contains(t, h.log.calls, "ApplyDerived(events=0,rates=3,through=100)",
		"the deduped observations ride the window's own transaction")
	require.Equal(t, []store.RateObservation{
		{Asset: token.Bytes(), Block: 100, Kind: "borrow_index", Value: big.NewInt(222)},
		{Asset: reserve.Bytes(), Block: 100, Kind: "variable_borrow_index", Value: big.NewInt(333)},
		{Asset: reserve.Bytes(), Block: 100, Kind: "liquidity_index", Value: big.NewInt(444)},
	}, h.st.lastRates, "last-wins dedupe per (asset, block, kind), insertion order preserved")
}

// TestRunnerSnapshotsDebtSideTouchedOnly: only DEBT-side balance-touched
// accounts are snapshotted — record-only events (no side / nil delta) and
// collateral-side events (observed truth belongs to the snapshotter at its
// own block) get no history row — and the flushed document is side-scoped:
// "side":"debt" with ONLY the debt-side balances, even when the account also
// carries collateral.
func TestRunnerSnapshotsDebtSideTouchedOnly(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1), rlog(100, 2)}
	for _, k := range []string{"100/0", "100/1", "100/2"} {
		h.dec.events[k] = stubEvent{name: k}
	}
	h.eng.processFn = func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
		switch l.LogIndex {
		case 0:
			return []store.PositionEvent{{
				ChainID: 10, Engine: "debt_manager", BlockNumber: l.BlockNumber, TxHash: l.TxHash,
				LogIndex: l.LogIndex, EventType: "borrow", Account: []byte{0xAA}, Asset: []byte{0xBB},
				Side: "debt", Delta: big.NewInt(5),
			}}, nil
		case 1:
			return []store.PositionEvent{{ // collateral-side: must not snapshot
				ChainID: 10, Engine: "debt_manager", BlockNumber: l.BlockNumber, TxHash: l.TxHash,
				LogIndex: l.LogIndex, EventType: "supply", Account: []byte{0xDD}, Asset: []byte{0xBB},
				Side: "collateral", Delta: big.NewInt(7),
			}}, nil
		default:
			return []store.PositionEvent{{ // record-only: must not snapshot
				ChainID: 10, Engine: "debt_manager", BlockNumber: l.BlockNumber, TxHash: l.TxHash,
				LogIndex: l.LogIndex, EventType: "config", Account: []byte{0xCC}, Asset: []byte{0xBB},
				Side: "", Delta: nil,
			}}, nil
		}
	}
	// The touched account holds BOTH sides in committed truth; the flushed
	// document must carry only the debt side.
	h.st.balances = map[string]map[string]map[string]*big.Int{
		"aa": {"bb": {"debt": big.NewInt(5), "collateral": big.NewInt(999)}},
	}

	_, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, []string{"SaveSnapshots(1@100)"}, filterCalls(h.log.calls, "SaveSnapshots"))
	require.Len(t, h.st.snapDocs, 1)
	require.Equal(t, map[string]store.SnapshotDoc{
		"aa": {Side: "debt", Balances: map[string]*big.Int{"bb": big.NewInt(5)}},
	}, h.st.snapDocs[0], "side-scoped document: debt only, collateral excluded")
}

// TestRunnerUnhealthyEngineStillRepairsReorgSiblingUnaffected is the named
// unhealthy+reorg+sibling failure injection: an UNHEALTHY engine must still
// acknowledge a reorg epoch (RewindDerived + Reset + re-sweep trigger) —
// repair is mandatory, only DERIVATION is gated — and a healthy sibling
// runner keeps deriving normally throughout.
func TestRunnerUnhealthyEngineStillRepairsReorgSiblingUnaffected(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0)}
	h.dec.events["100/0"] = stubEvent{name: "x"}
	h.eng.processFn = func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
		return nil, fmt.Errorf("token %x: %w", l.Address, ErrUnsupportedBorrowToken)
	}
	_, err := h.r.Step(context.Background())
	require.ErrorIs(t, err, ErrUnsupportedBorrowToken)

	// A walker rewind lands a durable epoch while the engine is unhealthy.
	h.st.unacked = true
	h.st.cursor, h.st.cursorFound = 80, true
	mark := len(h.log.calls)
	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the rewind is real progress even for an unhealthy engine")
	require.Equal(t, []string{
		"HasUnackedReorg",
		"DeriveCursor",
		"RewindDerived(to=80)",
		"Reset",
		"DeriveCursor",
	}, h.log.since(mark), "repair must run for an unhealthy engine")
	require.Equal(t, 1, h.rewinds, "the snapshot re-sweep trigger fires even while unhealthy")

	// Epoch acked: derivation stays gated — the reorg check and nothing else.
	mark = len(h.log.calls)
	advanced, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, []string{"HasUnackedReorg"}, h.log.since(mark))

	// A healthy sibling (its own engine, same daemon round in production)
	// derives normally the whole time.
	sib := newRunnerHarness(t, testRunnerSpec())
	sib.st.ingest["s1"] = &store.CursorPos{Block: 100}
	sib.st.logs = []store.RawLog{rlog(100, 0)}
	sib.dec.events["100/0"] = stubEvent{name: "x"}
	sib.eng.processFn = debtEventFn(0xAA)
	advanced, err = sib.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Contains(t, sib.log.calls, "CommitBatch")
}

// TestRunnerSnapshotFanOutCarryOver is the named fan-out carry-over failure
// injection: a window touching more debt accounts than the per-round cap
// flushes exactly cap accounts in ONE bulk write, carries the remainder in
// memory, and drains it on the next (caught-up) Step — which counts as
// progress — leaving nothing pending after.
func TestRunnerSnapshotFanOutCarryOver(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.r.snapCap = 2
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1), rlog(100, 2)}
	for _, k := range []string{"100/0", "100/1", "100/2"} {
		h.dec.events[k] = stubEvent{name: k}
	}
	h.eng.processFn = debtEventFn(0xAA, 0xBC, 0xCD)

	// Round 1: window commits, cap-bounded flush writes 2 of 3 accounts
	// (bytewise order: aa, bc) at the through-block.
	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []string{"SaveSnapshots(2@100)"}, filterCalls(h.log.calls, "SaveSnapshots"))
	require.Len(t, h.st.snapDocs, 1)
	require.Len(t, h.st.snapDocs[0], 2)
	require.Contains(t, h.st.snapDocs[0], "aa")
	require.Contains(t, h.st.snapDocs[0], "bc")

	// Round 2: caught up, but the carried-over account flushes at the cursor
	// block — and that IS progress (advanced=true keeps the loop hot until
	// the backlog drains).
	mark := len(h.log.calls)
	advanced, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []string{"SaveSnapshots(1@100)"}, filterCalls(h.log.since(mark), "SaveSnapshots"))
	require.Contains(t, h.st.snapDocs[1], "cd")

	// Round 3: nothing pending, nothing derived — idle.
	mark = len(h.log.calls)
	advanced, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, filterCalls(h.log.since(mark), "SaveSnapshots"))
}

// TestRunnerSnapshotFailureAdvancesAndRetains pins the best-effort contract
// end to end: a failed bulk flush after a committed window reports
// advanced=true WITH the error (M1: the cursor moved — callers must count
// progress), keeps every unwritten account pending, and the next Step
// retries and drains them.
func TestRunnerSnapshotFailureAdvancesAndRetains(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0)}
	h.dec.events["100/0"] = stubEvent{name: "x"}
	h.eng.processFn = debtEventFn(0xAA)
	h.st.snapshotsErr = errors.New("history write refused")

	advanced, err := h.r.Step(context.Background())
	require.ErrorContains(t, err, "history write refused")
	require.True(t, advanced, "the window committed — an errored Step can still be progress (M1)")
	require.Contains(t, h.log.calls, "CommitBatch")

	// Retry on the next (caught-up) Step: the pending account flushes.
	mark := len(h.log.calls)
	advanced, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []string{"SaveSnapshots(1@100)"}, filterCalls(h.log.since(mark), "SaveSnapshots"))
	require.Len(t, h.st.snapDocs, 1)
}

// TestRunnerSnapshotCarryOverBoundedFIFO is the sustained-arrival injection
// for the bounded snapshot FIFO: continuous new touches across windows must
// (1) never grow the queue past its hard cap — overflow drops the NEWEST
// touches with a WARN and counts them, (2) drain OLDEST-FIRST across
// windows, and (3) dedupe a re-touched account onto its ORIGINAL position
// instead of letting it jump (or re-enter) the line.
func TestRunnerSnapshotCarryOverBoundedFIFO(t *testing.T) {
	warnings := captureWarnings(t)
	h := newRunnerHarness(t, testRunnerSpec())
	h.r.snapCap = 1
	h.r.pendingMax = 3

	accountByKey := map[string]byte{
		"100/0": 0xAA, "100/1": 0xBC, "100/2": 0xCD, // window 1: fills the FIFO to cap
		"101/0": 0xCD, // window 2: re-touch (must keep its original position)
		"101/1": 0xDE, // fits after window 1's flush freed a slot
		"101/2": 0xEF, // overflows: dropped-newest
	}
	h.eng.processFn = func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
		b := accountByKey[fmt.Sprintf("%d/%d", l.BlockNumber, l.LogIndex)]
		return []store.PositionEvent{{
			ChainID: l.ChainID, Engine: "debt_manager", BlockNumber: l.BlockNumber,
			TxHash: l.TxHash, LogIndex: l.LogIndex, EventType: "test",
			Account: []byte{b}, Asset: []byte{0xBB}, Side: "debt", Delta: big.NewInt(1),
		}}, nil
	}
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1), rlog(100, 2)}
	for _, k := range []string{"100/0", "100/1", "100/2"} {
		h.dec.events[k] = stubEvent{name: k}
	}

	// Window 1: aa, bc, cd queued (exactly at cap — nothing dropped), the
	// OLDEST (aa) flushes.
	_, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, []string{"SaveSnapshots(1@100)"}, filterCalls(h.log.calls, "SaveSnapshots"))
	require.Contains(t, h.st.snapDocs[0], "aa", "the oldest entry flushes first")
	require.Len(t, h.r.pendingOrder, 2)
	require.Zero(t, h.r.droppedSnapshots)
	require.Empty(t, *warnings)

	// Window 2 arrives while bc, cd still pend: cd re-touches (dedupe, keeps
	// its position), de fits, ef overflows and is DROPPED with a WARN. The
	// flush again takes the oldest: bc.
	h.st.ingest["s1"] = &store.CursorPos{Block: 101}
	h.st.logs = append(h.st.logs, rlog(101, 0), rlog(101, 1), rlog(101, 2))
	for _, k := range []string{"101/0", "101/1", "101/2"} {
		h.dec.events[k] = stubEvent{name: k}
	}
	mark := len(h.log.calls)
	_, err = h.r.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, []string{"SaveSnapshots(1@101)"}, filterCalls(h.log.since(mark), "SaveSnapshots"))
	require.Contains(t, h.st.snapDocs[1], "bc", "oldest-first across windows — later arrivals cannot starve it")
	require.LessOrEqual(t, len(h.r.pendingOrder), h.r.pendingMax, "the hard cap bounds memory under sustained arrivals")
	require.Equal(t, uint64(1), h.r.droppedSnapshots, "the overflowing newest touch is dropped, not queued")
	require.NotEmpty(t, *warnings, "the drop must be surfaced as a WARN")

	// Caught-up drain: cd flushes BEFORE de — its re-touch kept the original
	// position — then de; ef never appears (it was dropped).
	for i, want := range []string{"cd", "de"} {
		mark = len(h.log.calls)
		advanced, err := h.r.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced)
		require.Contains(t, h.st.snapDocs[2+i], want)
		require.Len(t, h.st.snapDocs[2+i], 1)
	}
	mark = len(h.log.calls)
	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "the dropped account owes nothing — it regains history on its next touch")
	require.Empty(t, filterCalls(h.log.since(mark), "SaveSnapshots"))
}

// captureWarnings routes slog through a collector for the duration of the
// test, returning the collected Warn+ messages.
func captureWarnings(t *testing.T) *[]string {
	t.Helper()
	var msgs []string
	prev := slog.Default()
	slog.SetDefault(slog.New(warnCollector{msgs: &msgs}))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &msgs
}

type warnCollector struct{ msgs *[]string }

func (w warnCollector) Enabled(context.Context, slog.Level) bool { return true }
func (w warnCollector) Handle(_ context.Context, r slog.Record) error {
	if r.Level >= slog.LevelWarn {
		*w.msgs = append(*w.msgs, r.Message)
	}
	return nil
}
func (w warnCollector) WithAttrs([]slog.Attr) slog.Handler { return w }
func (w warnCollector) WithGroup(string) slog.Handler      { return w }

func filterCalls(calls []string, prefix string) []string {
	var out []string
	for _, c := range calls {
		if len(c) >= len(prefix) && c[:len(prefix)] == prefix {
			out = append(out, c)
		}
	}
	return out
}
