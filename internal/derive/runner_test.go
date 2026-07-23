package derive

// Runner sequencing tests with fakes. A single shared call log spans the fake
// store and the fake engine so cross-object ordering — derive-after-rewind,
// rates-before-apply, Reset-on-ApplyDerived-error — is pinned as an exact
// call sequence, not inferred from end state.

import (
	"context"
	"errors"
	"fmt"
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

	// applyErr fails the next ApplyDerived call (one-shot); when
	// applyAdvancesDespiteErr is set the cursor still advances — the
	// commit-landed-with-lost-ack world.
	applyErr                error
	applyAdvancesDespiteErr bool

	// rewindDeepTo, when set, lands the cursor at min(requested, rewindDeepTo)
	// — RewindDerived's deepest-unacked-epoch lowering.
	rewindDeepTo *uint64

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

func (f *fakeRunnerStore) ApplyDerived(_ context.Context, _ string, _ uint64, events []store.PositionEvent, throughBlock uint64) error {
	f.log.add(fmt.Sprintf("ApplyDerived(events=%d,through=%d)", len(events), throughBlock))
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

func (f *fakeRunnerStore) SaveRateIndex(_ context.Context, _ string, asset []byte, block uint64, kind string, value *big.Int) error {
	f.log.add(fmt.Sprintf("SaveRateIndex(%s,%x@%d=%s)", kind, asset, block, value))
	return nil
}

func (f *fakeRunnerStore) DeleteRateIndexesAbove(_ context.Context, _ string, block uint64) error {
	f.log.add(fmt.Sprintf("DeleteRateIndexesAbove(%d)", block))
	return nil
}

func (f *fakeRunnerStore) SaveSnapshot(_ context.Context, _ string, account []byte, block uint64, _ map[string]map[string]*big.Int) error {
	f.log.add(fmt.Sprintf("SaveSnapshot(%x@%d)", account, block))
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
// Process → ApplyDerived → CommitBatch → per-touched-account snapshots. The
// window is capped by the ingest frontier, and a caught-up second Step does
// nothing.
func TestRunnerHappyPathOrdering(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 104}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1), rlog(101, 0)}
	for _, k := range []string{"100/0", "100/1", "101/0"} {
		h.dec.events[k] = stubEvent{name: k}
	}
	h.eng.processFn = debtEventFn(0xAA, 0xAA, 0xBC) // two touches of AA dedupe into one snapshot

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
		"ApplyDerived(events=3,through=104)",
		"CommitBatch",
		"BalancesFor(aa)",
		"SaveSnapshot(aa@104)",
		"BalancesFor(bc)",
		"SaveSnapshot(bc@104)",
	}, h.log.calls)

	// Caught up: cursor == frontier → nothing to do, no batch started.
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
// subsequent Step is a complete no-op.
func TestRunnerUnsupportedBorrowTokenMarksUnhealthy(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0)}
	h.dec.events["100/0"] = stubEvent{name: "x"}
	h.eng.processFn = func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
		return nil, fmt.Errorf("token %x: %w", l.Address, ErrUnsupportedBorrowToken)
	}

	_, err := h.r.Step(context.Background())
	require.ErrorIs(t, err, ErrUnsupportedBorrowToken)
	require.ErrorIs(t, h.r.Unhealthy(), ErrUnsupportedBorrowToken)
	require.Contains(t, h.log.calls, "DiscardBatch")

	mark := len(h.log.calls)
	advanced, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, h.log.since(mark), "an unhealthy engine must not touch the store at all")
}

// TestRunnerRewindBeforeDerive pins the reorg-coordination ordering: an
// unacked epoch is answered with RewindDerived → Reset → cursor re-read →
// rate-index hygiene → re-sweep trigger BEFORE any window read or
// ApplyDerived — and the store may rewind DEEPER than the requested target
// (deepest-unacked-epoch lowering), so the next window starts at the read-back
// cursor, not the requested target.
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
		"DeleteRateIndexesAbove(120)",
	}, h.log.calls, "rewind must complete — and hygiene must key off the READ-BACK cursor — before any derivation")
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
// proactive check saw no epoch, but ApplyDerived refused with
// ErrUnackedReorgEpoch (a rewind raced in) — Reset first (commit
// indeterminacy applies to EVERY ApplyDerived error), then RewindDerived,
// cursor re-read, hygiene, re-sweep trigger.
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
		"ApplyDerived(events=0,through=104)",
		"Reset",
		"DeriveCursor",
		"RewindDerived(to=99)",
		"Reset",
		"DeriveCursor",
		"DeleteRateIndexesAbove(99)",
	}, h.log.calls)
	require.NotContains(t, h.log.calls, "DiscardBatch")
	require.Equal(t, 1, h.rewinds)
}

// TestRunnerRateObservations pins what the runner persists and when: DM
// InterestIndexUpdated → borrow_index (last same-key observation wins), Aave
// ReserveDataUpdated → variable_borrow_index + liquidity_index, all saved
// BEFORE ApplyDerived.
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
	require.Equal(t, []string{
		"SaveRateIndex(borrow_index,00000000000000000000000000000000000000bb@100=222)",
		"SaveRateIndex(variable_borrow_index,00000000000000000000000000000000000000cc@100=333)",
		"SaveRateIndex(liquidity_index,00000000000000000000000000000000000000cc@100=444)",
	}, filterCalls(h.log.calls, "SaveRateIndex"))

	// Saved BEFORE ApplyDerived: replay-safe idempotence beats
	// lost-observation risk.
	require.Less(t,
		indexOfPrefix(t, h.log.calls, "SaveRateIndex"),
		indexOfPrefix(t, h.log.calls, "ApplyDerived"))
}

// TestRunnerSnapshotsTouchedAccountsOnly: record-only events (no side / nil
// delta) touch no balances and get no snapshot row.
func TestRunnerSnapshotsTouchedAccountsOnly(t *testing.T) {
	h := newRunnerHarness(t, testRunnerSpec())
	h.st.ingest["s1"] = &store.CursorPos{Block: 100}
	h.st.logs = []store.RawLog{rlog(100, 0), rlog(100, 1)}
	h.dec.events["100/0"] = stubEvent{name: "a"}
	h.dec.events["100/1"] = stubEvent{name: "b"}
	h.eng.processFn = func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
		if l.LogIndex == 0 {
			return []store.PositionEvent{{
				ChainID: 10, Engine: "debt_manager", BlockNumber: l.BlockNumber, TxHash: l.TxHash,
				LogIndex: l.LogIndex, EventType: "borrow", Account: []byte{0xAA}, Asset: []byte{0xBB},
				Side: "debt", Delta: big.NewInt(5),
			}}, nil
		}
		return []store.PositionEvent{{ // record-only: must not snapshot
			ChainID: 10, Engine: "debt_manager", BlockNumber: l.BlockNumber, TxHash: l.TxHash,
			LogIndex: l.LogIndex, EventType: "config", Account: []byte{0xCC}, Asset: []byte{0xBB},
			Side: "", Delta: nil,
		}}, nil
	}

	_, err := h.r.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, []string{"SaveSnapshot(aa@100)"}, filterCalls(h.log.calls, "SaveSnapshot"))
}

func filterCalls(calls []string, prefix string) []string {
	var out []string
	for _, c := range calls {
		if len(c) >= len(prefix) && c[:len(prefix)] == prefix {
			out = append(out, c)
		}
	}
	return out
}

func indexOfPrefix(t *testing.T, calls []string, prefix string) int {
	t.Helper()
	for i, c := range calls {
		if len(c) >= len(prefix) && c[:len(prefix)] == prefix {
			return i
		}
	}
	t.Fatalf("no call with prefix %q in %v", prefix, calls)
	return -1
}
