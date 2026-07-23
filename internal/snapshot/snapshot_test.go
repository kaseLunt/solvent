package snapshot

// Snapshotter tests with a fake chain and a fake DURABLE store: request shape
// (multicall3 tryBlockAndAggregate of collateralOf reads, selectors pinned
// against `cast sig`), generation-driven batch consumption, cadence gating,
// crash-restart convergence (the durable lagging set IS the queue), the
// post-rewind durable bump + live fast path, and the per-account failure
// postures. Responses are encoded through the same ABI objects the
// snapshotter decodes with. The fake store mirrors the real store's
// generation semantics (lagging-first work batches, durable attempts,
// guarded completion) so restart scenarios exercise real resume logic.

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

var (
	testTarget = common.HexToAddress("0x0078C5a459132e279056B2371fE8A8eC973A9553")
	tokenUSDC  = common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	tokenWETH  = common.HexToAddress("0x4200000000000000000000000000000000000006")
)

// ---------------------------------------------------------------------------
// Fakes + response builders.
// ---------------------------------------------------------------------------

type capturedCall struct {
	to   common.Address
	data []byte
}

type fakeChain struct {
	calls   []capturedCall
	respond func(to common.Address, data []byte) ([]byte, error)
}

func (c *fakeChain) Call(_ context.Context, to common.Address, data []byte) ([]byte, error) {
	c.calls = append(c.calls, capturedCall{to: to, data: data})
	return c.respond(to, data)
}

// sweepRow mirrors one durable snapshot_sweeps row.
type sweepRow struct {
	generation  uint64
	attempts    int
	status      string
	lastAttempt uint64
	lastSuccess uint64
}

type applyRec struct {
	generation uint64
	block      uint64
	results    []store.SweepResult
}

type historyRec struct {
	account string
	block   uint64
}

// fakeSnapStore is an in-memory faithful model of the store's durable sweep
// machinery. It survives "process crashes" (fresh Snapshotters share it), so
// restart tests exercise the real resume semantics.
type fakeSnapStore struct {
	clock *time.Time

	// registry is the priority-ordered Safe registry (the SQL's within-bucket
	// order); tests mutate it to model rewinds.
	registry [][]byte

	gen         uint64
	open        bool
	completedAt time.Time

	rows     map[string]*sweepRow                      // account-hex → durable status
	balances map[string]map[string]map[string]*big.Int // account-hex → wholesale snapshot balances
	history  []historyRec                              // collateral history writes, in order

	genReads, opens, workBatches, completes int

	applyErr error // one-shot ApplySweepBatch failure injection
	applied  []applyRec
}

func newFakeSnapStore(registry [][]byte, clock *time.Time) *fakeSnapStore {
	return &fakeSnapStore{
		clock: clock, registry: registry,
		rows:     map[string]*sweepRow{},
		balances: map[string]map[string]map[string]*big.Int{},
	}
}

func (f *fakeSnapStore) SweepGeneration(context.Context, string) (uint64, bool, time.Time, error) {
	f.genReads++
	return f.gen, f.open, f.completedAt, nil
}

func (f *fakeSnapStore) OpenSweepGeneration(context.Context, string) (uint64, error) {
	f.opens++
	f.gen++
	f.open = true
	f.completedAt = time.Time{}
	return f.gen, nil
}

// bumpGeneration models store.RewindDerived's in-transaction generation bump
// — the DURABLE post-rewind re-sweep open (not routed through
// OpenSweepGeneration: the real bump happens inside the rewind transaction).
func (f *fakeSnapStore) bumpGeneration() {
	f.gen++
	f.open = true
	f.completedAt = time.Time{}
}

func (f *fakeSnapStore) SweepWorkBatch(_ context.Context, _ string, generation uint64, maxAttempts, limit int) ([][]byte, error) {
	f.workBatches++
	type lagEntry struct {
		account []byte
		stamp   int64
	}
	var lagging []lagEntry
	var retries [][]byte
	for _, acct := range f.registry {
		row := f.rows[hex.EncodeToString(acct)]
		switch {
		case row == nil:
			lagging = append(lagging, lagEntry{acct, -1})
		case row.generation < generation:
			lagging = append(lagging, lagEntry{acct, int64(row.generation)})
		case row.generation == generation && row.status == "failed" && row.attempts < maxAttempts:
			retries = append(retries, acct)
		}
	}
	// Oldest stamp first (stable: registry priority order within a bucket),
	// then current-generation retries — mirroring the SQL's ORDER BY.
	sort.SliceStable(lagging, func(i, j int) bool { return lagging[i].stamp < lagging[j].stamp })
	out := make([][]byte, 0, len(lagging)+len(retries))
	for _, l := range lagging {
		out = append(out, l.account)
	}
	out = append(out, retries...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeSnapStore) ApplySweepBatch(_ context.Context, _ string, generation, execBlock uint64, results []store.SweepResult) error {
	if f.applyErr != nil {
		err := f.applyErr
		f.applyErr = nil
		return err
	}
	for _, res := range results {
		key := hex.EncodeToString(res.Account)
		row := f.rows[key]
		if row == nil {
			row = &sweepRow{}
			f.rows[key] = row
		}
		if row.generation != generation {
			row.generation, row.attempts = generation, 0
		}
		row.attempts++
		row.lastAttempt = execBlock
		if res.OK {
			row.status = "success"
			row.lastSuccess = execBlock
			f.balances[key] = res.Balances
			f.history = append(f.history, historyRec{account: key, block: execBlock})
		} else {
			row.status = "failed"
		}
	}
	f.applied = append(f.applied, applyRec{generation: generation, block: execBlock, results: results})
	return nil
}

func (f *fakeSnapStore) CompleteSweepGeneration(_ context.Context, _ string, generation uint64) (int64, bool, error) {
	f.completes++
	var failed int64
	for _, row := range f.rows {
		if row.generation == generation && row.status == "failed" {
			failed++
		}
	}
	if f.open && f.gen == generation {
		f.open = false
		f.completedAt = *f.clock
		return failed, true, nil
	}
	return failed, false, nil
}

type mcResult struct {
	Success    bool
	ReturnData []byte
}

type tokenData struct {
	Token  common.Address
	Amount *big.Int
}

// encodeCollateralOf builds one collateralOf return payload.
func encodeCollateralOf(t *testing.T, tokens []tokenData, total *big.Int) []byte {
	t.Helper()
	out, err := dmLensABI.Methods["collateralOf"].Outputs.Pack(tokens, total)
	require.NoError(t, err)
	return out
}

// encodeMulticall builds one tryBlockAndAggregate return payload.
func encodeMulticall(t *testing.T, block uint64, results []mcResult) []byte {
	t.Helper()
	out, err := multicall3ABI.Methods["tryBlockAndAggregate"].Outputs.Pack(
		new(big.Int).SetUint64(block), [32]byte{0xbb}, results)
	require.NoError(t, err)
	return out
}

// uniformResponder answers every multicall with the same per-account token
// list at the given block, matching the request's call count.
func uniformResponder(t *testing.T, block uint64, tokens []tokenData) func(common.Address, []byte) ([]byte, error) {
	t.Helper()
	return func(_ common.Address, data []byte) ([]byte, error) {
		n := requestCallCount(t, data)
		results := make([]mcResult, n)
		for i := range results {
			results[i] = mcResult{Success: true, ReturnData: encodeCollateralOf(t, tokens, big.NewInt(0))}
		}
		return encodeMulticall(t, block, results), nil
	}
}

// requestCallCount unpacks a captured request and returns its call count.
func requestCallCount(t *testing.T, data []byte) int {
	t.Helper()
	_, calls := unpackRequest(t, data)
	return len(calls)
}

// requestAccounts unpacks a captured request into the per-call Safe
// addresses (raw 20-byte), so responders can answer per account.
func requestAccounts(t *testing.T, data []byte) [][]byte {
	t.Helper()
	_, calls := unpackRequest(t, data)
	var out [][]byte
	for _, c := range calls {
		args, err := dmLensABI.Methods["collateralOf"].Inputs.Unpack(c.data[4:])
		require.NoError(t, err)
		out = append(out, args[0].(common.Address).Bytes())
	}
	return out
}

// attemptCounts tallies, per account-hex, how many multicall attempts the
// chain has served — the "was this account reprocessed?" measure.
func attemptCounts(t *testing.T, ch *fakeChain) map[string]int {
	t.Helper()
	counts := map[string]int{}
	for _, c := range ch.calls {
		for _, acct := range requestAccounts(t, c.data) {
			counts[hex.EncodeToString(acct)]++
		}
	}
	return counts
}

// perAccountResponder answers each requested Safe individually: Safes in
// failing revert (success=false), the rest succeed with the given tokens.
func perAccountResponder(t *testing.T, block uint64, failing map[string]bool, tokens []tokenData) func(common.Address, []byte) ([]byte, error) {
	t.Helper()
	return func(_ common.Address, data []byte) ([]byte, error) {
		accounts := requestAccounts(t, data)
		results := make([]mcResult, len(accounts))
		for i, acct := range accounts {
			if failing[hex.EncodeToString(acct)] {
				results[i] = mcResult{Success: false}
			} else {
				results[i] = mcResult{Success: true, ReturnData: encodeCollateralOf(t, tokens, big.NewInt(0))}
			}
		}
		return encodeMulticall(t, block, results), nil
	}
}

// unpackRequest decodes a captured tryBlockAndAggregate request into
// (requireSuccess, per-call (target, calldata) pairs).
func unpackRequest(t *testing.T, data []byte) (bool, []capturedCall) {
	t.Helper()
	method := multicall3ABI.Methods["tryBlockAndAggregate"]
	require.Equal(t, method.ID, data[:4])
	vals, err := method.Inputs.Unpack(data[4:])
	require.NoError(t, err)
	require.Len(t, vals, 2)
	requireSuccess := vals[0].(bool)
	// The unpacked tuple slice is a geth-generated anonymous struct slice;
	// read it positionally, the same style the package under test uses.
	var out []capturedCall
	rv := reflect.ValueOf(vals[1])
	require.Equal(t, reflect.Slice, rv.Kind())
	for i := 0; i < rv.Len(); i++ {
		el := rv.Index(i)
		out = append(out, capturedCall{
			to:   el.Field(0).Interface().(common.Address),
			data: el.Field(1).Interface().([]byte),
		})
	}
	return requireSuccess, out
}

// harness wires a Snapshotter over a shared durable fake store with a
// controllable clock.
func harness(t *testing.T, registry [][]byte, respond func(common.Address, []byte) ([]byte, error), batchSize int) (*Snapshotter, *fakeSnapStore, *fakeChain, *time.Time) {
	t.Helper()
	clock := time.Date(2026, 7, 23, 0, 0, 0, 0, time.UTC)
	clockPtr := &clock
	st := newFakeSnapStore(registry, clockPtr)
	ch := &fakeChain{respond: respond}
	s := freshSnapshotter(t, st, ch, clockPtr, batchSize)
	return s, st, ch, clockPtr
}

// freshSnapshotter models a PROCESS RESTART: a brand-new Snapshotter (no
// memory) over the surviving durable store.
func freshSnapshotter(t *testing.T, st *fakeSnapStore, ch *fakeChain, clock *time.Time, batchSize int) *Snapshotter {
	t.Helper()
	s, err := New(st, ch, Config{
		Engine: "debt_manager", Target: testTarget,
		Interval: time.Hour, BatchSize: batchSize,
	})
	require.NoError(t, err)
	s.now = func() time.Time { return *clock }
	return s
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

func acct(b byte) []byte {
	a := make([]byte, 20)
	a[19] = b
	return a
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

func TestNewValidation(t *testing.T) {
	clock := time.Now()
	st := newFakeSnapStore(nil, &clock)
	ch := &fakeChain{}
	_, err := New(nil, ch, Config{Engine: "e", Target: testTarget, Interval: time.Hour})
	require.ErrorContains(t, err, "required")
	_, err = New(st, ch, Config{Target: testTarget, Interval: time.Hour})
	require.ErrorContains(t, err, "engine")
	_, err = New(st, ch, Config{Engine: "e", Interval: time.Hour})
	require.ErrorContains(t, err, "target")
	_, err = New(st, ch, Config{Engine: "e", Target: testTarget})
	require.ErrorContains(t, err, "interval")
}

// TestRequestShape pins the wire format: the call goes to the canonical
// multicall3 address, selector 0x399542e9 (tryBlockAndAggregate, `cast sig`),
// requireSuccess=false, one collateralOf(account) sub-call (selector
// 0x1aefb107, `cast sig "collateralOf(address)"`) per Safe against the Debt
// Manager proxy.
func TestRequestShape(t *testing.T) {
	registry := [][]byte{acct(0x01), acct(0x02)}
	s, _, ch, _ := harness(t, registry, uniformResponder(t, 500, nil), 10)

	_, err := s.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, ch.calls, 1)
	require.Equal(t, Multicall3Address, ch.calls[0].to)
	require.Equal(t, "399542e9", hex.EncodeToString(ch.calls[0].data[:4]))

	requireSuccess, calls := unpackRequest(t, ch.calls[0].data)
	require.False(t, requireSuccess, "one broken safe must not fail its batch")
	require.Len(t, calls, 2)
	for i, c := range calls {
		require.Equal(t, testTarget, c.to)
		require.Equal(t, "1aefb107", hex.EncodeToString(c.data[:4]))
		args, err := dmLensABI.Methods["collateralOf"].Inputs.Unpack(c.data[4:])
		require.NoError(t, err)
		require.Equal(t, common.BytesToAddress(registry[i]), args[0].(common.Address))
	}
}

// TestSweepRotatesInBatches: a 5-safe registry with batch size 2 is consumed
// across three Steps — one multicall and one atomic ApplySweepBatch each —
// in registry (priority) order, stamped with the multicall's execution
// block and the OPEN generation; a fourth Step finds nothing lagging and
// completes the generation; a fifth inside the cadence window does nothing.
func TestSweepRotatesInBatches(t *testing.T) {
	registry := [][]byte{acct(1), acct(2), acct(3), acct(4), acct(5)}
	tokens := []tokenData{{Token: tokenUSDC, Amount: big.NewInt(777)}}
	s, st, ch, _ := harness(t, registry, uniformResponder(t, 12345, tokens), 2)

	for i := 0; i < 3; i++ {
		advanced, err := s.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced)
	}
	require.Len(t, ch.calls, 3, "5 safes / batch 2 = 3 multicalls")
	require.Equal(t, 1, st.opens, "one generation per sweep")
	require.Len(t, st.applied, 3)
	var swept []string
	for _, rec := range st.applied {
		require.Equal(t, uint64(1), rec.generation)
		require.Equal(t, uint64(12345), rec.block)
		for _, res := range rec.results {
			require.True(t, res.OK)
			require.Equal(t, map[string]map[string]*big.Int{
				hex.EncodeToString(tokenUSDC.Bytes()): {"collateral": big.NewInt(777)},
			}, res.Balances)
			swept = append(swept, hex.EncodeToString(res.Account))
		}
	}
	var want []string
	for _, a := range registry {
		want = append(want, hex.EncodeToString(a))
	}
	require.Equal(t, want, swept, "registry priority order preserved across batches")

	// Fourth Step: nothing lags → the generation completes (that IS work).
	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, 1, st.completes)
	require.False(t, st.open)

	// Fifth Step: complete and inside the cadence window — idle.
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Len(t, ch.calls, 3, "no further multicalls")
}

// TestCadenceGating: a completed generation re-arms only after the configured
// interval elapses past its durable completion stamp.
func TestCadenceGating(t *testing.T) {
	s, st, _, clock := harness(t, [][]byte{acct(1)}, uniformResponder(t, 10, nil), 10)

	advanced, err := s.Step(context.Background()) // opens gen 1, sweeps the safe
	require.NoError(t, err)
	require.True(t, advanced)
	advanced, err = s.Step(context.Background()) // completes gen 1
	require.NoError(t, err)
	require.True(t, advanced)

	*clock = clock.Add(59 * time.Minute)
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "inside the interval: no new generation")
	require.Equal(t, 1, st.opens)

	*clock = clock.Add(2 * time.Minute)
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "interval elapsed: a new generation opens and sweeps")
	require.Equal(t, 2, st.opens)
}

// TestRestartLoopConvergence is the startup-resweep durability injection: a
// multi-account registry is swept by a CRASH LOOP — every Step runs on a
// brand-new Snapshotter (fresh process, zero memory) over the surviving
// durable store. The sweep must converge (every account stamped with the
// current generation) WITHOUT ever reprocessing an already-swept prefix:
// exactly one multicall attempt per account per generation. Repeated for a
// second generation to prove the loop, not a lucky first pass.
func TestRestartLoopConvergence(t *testing.T) {
	registry := [][]byte{acct(1), acct(2), acct(3), acct(4), acct(5)}
	_, st, ch, clock := harness(t, registry, uniformResponder(t, 100, nil), 2)

	runCrashLoopSweep := func(wantGen uint64) {
		t.Helper()
		// 3 batches + 1 completion, each on a FRESH process.
		for i := 0; i < 4; i++ {
			s := freshSnapshotter(t, st, ch, clock, 2)
			advanced, err := s.Step(context.Background())
			require.NoError(t, err)
			require.True(t, advanced)
		}
		require.False(t, st.open, "the crash loop must still complete the generation")
		for _, a := range registry {
			row := st.rows[hex.EncodeToString(a)]
			require.NotNil(t, row)
			require.Equal(t, wantGen, row.generation, "every account converges to the current generation")
			require.Equal(t, "success", row.status)
		}
	}

	runCrashLoopSweep(1)
	require.Equal(t, 1, st.opens, "a restart RESUMES the open generation — it never opens another")
	for acctHex, n := range attemptCounts(t, ch) {
		require.Equal(t, 1, n, "account %s was reprocessed after a crash — the durable queue failed", acctHex)
	}

	// Second generation after the cadence: the same crash loop, attempts
	// exactly double (one per generation, still none within a generation).
	*clock = clock.Add(2 * time.Hour)
	runCrashLoopSweep(2)
	require.Equal(t, 2, st.opens)
	for acctHex, n := range attemptCounts(t, ch) {
		require.Equal(t, 2, n, "account %s: expected exactly one attempt per generation", acctHex)
	}
}

// TestDurableBumpResumesAfterRewindCrash pins the durable post-rewind leg:
// RewindDerived's in-transaction generation bump (modeled by the fake's
// bumpGeneration) opens the re-sweep with NO process-memory involvement — a
// crash that loses the TriggerResweep hook loses nothing, because a fresh
// process finds the generation OPEN, reads the post-rewind registry, and
// sweeps exactly it (the dropped old registry's accounts are gone).
func TestDurableBumpResumesAfterRewindCrash(t *testing.T) {
	registry := [][]byte{acct(1), acct(2), acct(3)}
	s, st, _, clock := harness(t, registry, uniformResponder(t, 10, nil), 1)

	_, err := s.Step(context.Background()) // gen 1: sweeps acct(1); 2,3 still lag
	require.NoError(t, err)

	// The rewind: registry shrinks, and the REWIND TRANSACTION bumps the
	// generation durably. The process crashes before TriggerResweep fires.
	st.registry = [][]byte{acct(9)}
	st.bumpGeneration()

	restarted := freshSnapshotter(t, st, &fakeChain{respond: uniformResponder(t, 11, nil)}, clock, 1)
	advanced, err := restarted.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, 1, st.opens, "the rewind's own bump IS the open — no extra generation")
	last := st.applied[len(st.applied)-1]
	require.Equal(t, uint64(2), last.generation)
	require.Len(t, last.results, 1)
	require.Equal(t, hex.EncodeToString(acct(9)), hex.EncodeToString(last.results[0].Account),
		"the post-rewind registry is swept; the dropped registry's accounts are not")
}

// TestTriggerResweepFastPathBypassesCadence: the live hook makes the next
// Step sweep immediately even though the cadence has not elapsed — the fast
// path over the durable leg's worst-case one-interval wait.
func TestTriggerResweepFastPathBypassesCadence(t *testing.T) {
	s, st, _, _ := harness(t, [][]byte{acct(1)}, uniformResponder(t, 10, nil), 10)

	for i := 0; i < 2; i++ { // sweep + complete generation 1
		_, err := s.Step(context.Background())
		require.NoError(t, err)
	}
	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "cadence not elapsed: idle without a trigger")

	s.TriggerResweep()
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the trigger defeats the cadence gate")
	require.Equal(t, 2, st.opens)
}

// TestZeroAmountsOmittedAndEmptyResultClears: zero-amount tokens vanish from
// the balances map, and a Safe whose entire collateral is zero still lands an
// OK result with an EMPTY map — wholesale replacement is what clears its
// stale snapshot rows.
func TestZeroAmountsOmittedAndEmptyResultClears(t *testing.T) {
	respond := func(_ common.Address, data []byte) ([]byte, error) {
		n := requestCallCount(t, data)
		require.Equal(t, 2, n)
		return encodeMulticall(t, 42, []mcResult{
			{Success: true, ReturnData: encodeCollateralOf(t, []tokenData{
				{Token: tokenUSDC, Amount: big.NewInt(1000)},
				{Token: tokenWETH, Amount: big.NewInt(0)}, // zero: omitted
			}, big.NewInt(1000))},
			{Success: true, ReturnData: encodeCollateralOf(t, []tokenData{
				{Token: tokenUSDC, Amount: big.NewInt(0)},
			}, big.NewInt(0))},
		}), nil
	}
	s, st, _, _ := harness(t, [][]byte{acct(1), acct(2)}, respond, 10)

	_, err := s.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, st.applied, 1)
	results := st.applied[0].results
	require.Len(t, results, 2)
	require.True(t, results[0].OK)
	require.Equal(t, map[string]map[string]*big.Int{
		hex.EncodeToString(tokenUSDC.Bytes()): {"collateral": big.NewInt(1000)},
	}, results[0].Balances)
	require.True(t, results[1].OK)
	require.Empty(t, results[1].Balances, "an all-zero safe lands an OK result with an empty map to clear stale rows")
}

// TestAllRevertedBatchIsPerAccountFailure pins the reclassification that
// un-wedges the old posture: a batch where EVERY collateralOf call reverted
// is N per-account failures — statuses recorded, WARN emitted, the durable
// queue ADVANCES through the bounded retry budget, and the generation
// completes DEGRADED instead of erroring forever. (Batch-level errors are
// only transport/malformed-response; a systemically broken view surfaces as
// N degraded accounts, which cannot wedge the sweep.)
func TestAllRevertedBatchIsPerAccountFailure(t *testing.T) {
	warnings := captureWarnings(t)
	a1, a2 := acct(1), acct(2)
	respond := func(_ common.Address, data []byte) ([]byte, error) {
		return encodeMulticall(t, 42, []mcResult{{Success: false}, {Success: false}}), nil
	}
	s, st, ch, _ := harness(t, [][]byte{a1, a2}, respond, 10)

	// First batch: NO error, statuses recorded as failed, WARN per safe.
	advanced, err := s.Step(context.Background())
	require.NoError(t, err, "an all-reverted batch is per-account failure, never a batch error")
	require.True(t, advanced)
	for _, a := range [][]byte{a1, a2} {
		row := st.rows[hex.EncodeToString(a)]
		require.NotNil(t, row, "the failed status must be recorded")
		require.Equal(t, "failed", row.status)
		require.Equal(t, 1, row.attempts)
	}
	require.NotEmpty(t, *warnings, "the reverts must be surfaced as warnings")

	// The durable retry budget drains: maxAccountRetries further batches,
	// then the generation COMPLETES degraded — the queue advanced.
	for i := 0; i < maxAccountRetries; i++ {
		advanced, err = s.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced)
	}
	require.Len(t, ch.calls, 1+maxAccountRetries)
	advanced, err = s.Step(context.Background()) // completion
	require.NoError(t, err)
	require.True(t, advanced)
	require.False(t, st.open, "the generation completes DEGRADED instead of wedging")
	require.Equal(t, maxSweepAttempts, st.rows[hex.EncodeToString(a1)].attempts)
	degraded := false
	for _, msg := range *warnings {
		if msg == "collateral snapshot sweep completed DEGRADED — some safes stayed failed through the retry budget" {
			degraded = true
		}
	}
	require.True(t, degraded, "completion with exhausted safes must alarm DEGRADED")

	// Idle afterwards: the failed safes wait for the next generation.
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
}

// TestFailedAccountRetriedBoundedThenDegraded pins the mixed-batch failure
// lifecycle: a reverted Safe does not fail its batch (the sibling's result
// lands atomically beside its failed status), is retried up to
// maxAccountRetries further times this generation — lagging accounts first,
// so retries never starve fresh work — then skipped, and the generation
// completes DEGRADED.
func TestFailedAccountRetriedBoundedThenDegraded(t *testing.T) {
	bad, good := acct(1), acct(2)
	respond := perAccountResponder(t, 42, map[string]bool{hex.EncodeToString(bad): true},
		[]tokenData{{Token: tokenUSDC, Amount: big.NewInt(5)}})
	s, st, ch, _ := harness(t, [][]byte{bad, good}, respond, 10)

	// Fresh batch: good lands (status success + balances, one transaction);
	// bad records failed attempt 1.
	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, "success", st.rows[hex.EncodeToString(good)].status)
	require.Equal(t, map[string]map[string]*big.Int{
		hex.EncodeToString(tokenUSDC.Bytes()): {"collateral": big.NewInt(5)},
	}, st.balances[hex.EncodeToString(good)])
	require.Equal(t, "failed", st.rows[hex.EncodeToString(bad)].status)

	// Bounded retries, then completion (degraded).
	for i := 0; i < maxAccountRetries; i++ {
		advanced, err = s.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced)
	}
	require.Len(t, ch.calls, 1+maxAccountRetries, "1 fresh + bounded retry multicalls")
	counts := attemptCounts(t, ch)
	require.Equal(t, maxSweepAttempts, counts[hex.EncodeToString(bad)])
	require.Equal(t, 1, counts[hex.EncodeToString(good)], "the succeeded sibling is never re-read")
	require.Nil(t, st.balances[hex.EncodeToString(bad)], "the reverting safe never lands balances")

	advanced, err = s.Step(context.Background()) // degraded completion
	require.NoError(t, err)
	require.True(t, advanced)
	require.False(t, st.open)

	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "the failed safe waits for the NEXT generation")
}

// TestFailedAccountRecoversOnRetry: a Safe that reverts once and then
// succeeds flips to status=success within the same generation — the durable
// retry budget is a recovery path, not just failure accounting.
func TestFailedAccountRecoversOnRetry(t *testing.T) {
	flaky, good := acct(1), acct(2)
	failing := map[string]bool{hex.EncodeToString(flaky): true}
	respond := perAccountResponder(t, 42, failing, []tokenData{{Token: tokenUSDC, Amount: big.NewInt(5)}})
	s, st, _, _ := harness(t, [][]byte{flaky, good}, respond, 10)

	_, err := s.Step(context.Background()) // fresh batch: flaky fails, good lands
	require.NoError(t, err)
	failing[hex.EncodeToString(flaky)] = false // the view recovers

	advanced, err := s.Step(context.Background()) // retry batch: flaky succeeds
	require.NoError(t, err)
	require.True(t, advanced)
	row := st.rows[hex.EncodeToString(flaky)]
	require.Equal(t, "success", row.status, "a successful retry must flip the status to success")
	require.Equal(t, 2, row.attempts)
	require.NotNil(t, st.balances[hex.EncodeToString(flaky)])

	advanced, err = s.Step(context.Background()) // clean completion
	require.NoError(t, err)
	require.True(t, advanced)
	require.False(t, st.open)
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
}

// TestZeroCollateralSuccessDistinguishableFromNeverSwept pins the three-way
// disambiguation at the snapshotter level: a swept all-zero Safe produces a
// SUCCESS status plus an empty wholesale balance set (and a history row),
// while a Safe absent from the registry produces NO row at all — so "empty
// because read" and "empty because never read" are different states.
func TestZeroCollateralSuccessDistinguishableFromNeverSwept(t *testing.T) {
	swept, neverSwept := acct(1), acct(9)
	s, st, _, _ := harness(t, [][]byte{swept}, uniformResponder(t, 77, nil), 10)

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	row := st.rows[hex.EncodeToString(swept)]
	require.NotNil(t, row)
	require.Equal(t, "success", row.status, "zero collateral is a SUCCESS outcome")
	require.Equal(t, uint64(77), row.lastSuccess)
	require.Empty(t, st.balances[hex.EncodeToString(swept)], "the empty wholesale set clears any stale rows")
	require.Equal(t, []historyRec{{account: hex.EncodeToString(swept), block: 77}}, st.history,
		"a zero-collateral success still writes its history row")
	require.Nil(t, st.rows[hex.EncodeToString(neverSwept)], "never-swept means no record, not a failed one")
}

// TestTransportErrorLeavesQueue: a failed multicall is a batch-level error —
// the durable queue is untouched and the SAME batch retries next round.
func TestTransportErrorLeavesQueue(t *testing.T) {
	failing := true
	respond := func(_ common.Address, data []byte) ([]byte, error) {
		if failing {
			return nil, errors.New("all rpc endpoints failed")
		}
		n := requestCallCount(t, data)
		results := make([]mcResult, n)
		for i := range results {
			results[i] = mcResult{Success: true, ReturnData: encodeCollateralOf(t, nil, big.NewInt(0))}
		}
		return encodeMulticall(t, 42, results), nil
	}
	s, st, ch, _ := harness(t, [][]byte{acct(1)}, respond, 10)

	_, err := s.Step(context.Background())
	require.ErrorContains(t, err, "all rpc endpoints failed")
	require.Empty(t, st.rows, "a transport error records nothing")

	failing = false
	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, ch.calls[0].data, ch.calls[1].data, "the identical batch retries")
	require.Equal(t, "success", st.rows[hex.EncodeToString(acct(1))].status)
}

// TestMalformedResponseErrors: garbage bytes from the provider are a
// batch-level error — never a panic, never a partial apply.
func TestMalformedResponseErrors(t *testing.T) {
	respond := func(common.Address, []byte) ([]byte, error) {
		return []byte{0x01, 0x02, 0x03}, nil
	}
	s, st, _, _ := harness(t, [][]byte{acct(1)}, respond, 10)

	_, err := s.Step(context.Background())
	require.Error(t, err)
	require.Empty(t, st.applied)
	require.Empty(t, st.rows)
}

// TestApplyErrorLeavesDurableQueue: a failed ApplySweepBatch (the store
// refused the transaction) leaves the durable queue untouched — the same
// batch re-pulls and re-applies next round, and the atomic batch write means
// no partial state exists to reconcile.
func TestApplyErrorLeavesDurableQueue(t *testing.T) {
	s, st, ch, _ := harness(t, [][]byte{acct(1)}, uniformResponder(t, 42, nil), 10)
	st.applyErr = errors.New("db connection lost")

	_, err := s.Step(context.Background())
	require.ErrorContains(t, err, "db connection lost")
	require.Empty(t, st.rows, "the refused transaction wrote nothing")

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, ch.calls[0].data, ch.calls[1].data, "the identical batch retries")
	require.Equal(t, "success", st.rows[hex.EncodeToString(acct(1))].status)
}

// TestEmptyRegistryCompletesGeneration: an empty registry (early backfill)
// opens and immediately completes its generation, then idles on the cadence —
// the store is not hammered with work-batch reads every round.
func TestEmptyRegistryCompletesGeneration(t *testing.T) {
	s, st, ch, clock := harness(t, nil, uniformResponder(t, 1, nil), 10)

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "opening + completing the empty generation is work")
	require.Empty(t, ch.calls)
	require.Equal(t, 1, st.opens)
	require.False(t, st.open)

	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, 1, st.workBatches, "an idle round reads only the generation row, never the work batch")

	*clock = clock.Add(2 * time.Hour)
	_, err = s.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, 2, st.opens, "the cadence re-arms from the durable completion stamp")
}

// TestStaleSweepBatchIsDegradedRoundNotError: a wholesale-stale batch — the
// store's monotonic guard refused every result with ErrStaleSweepBatch
// (multicall served by a failed-over endpoint BEHIND the accounts' recorded
// successes) — is a DEGRADED round, not a step error and not progress: Step
// logs the WARN and returns (false, nil), the durable queue is untouched, and
// the identical batch retries next round (landing once an endpoint catches
// up).
func TestStaleSweepBatchIsDegradedRoundNotError(t *testing.T) {
	s, st, ch, _ := harness(t, [][]byte{acct(1)}, uniformResponder(t, 42, nil), 10)
	warnings := captureWarnings(t)
	st.applyErr = fmt.Errorf("apply sweep batch: %w", store.ErrStaleSweepBatch)

	advanced, err := s.Step(context.Background())
	require.NoError(t, err, "an all-stale batch is a degraded round, never a step error")
	require.False(t, advanced, "nothing was applied: the round is not progress")
	require.Empty(t, st.rows, "the store's typed refusal applied nothing")
	degraded := false
	for _, m := range *warnings {
		if strings.Contains(m, "DEGRADED") {
			degraded = true
		}
	}
	require.True(t, degraded, "the degraded round must be logged, got %v", *warnings)

	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, ch.calls[0].data, ch.calls[1].data, "the identical batch retries against the durable queue")
	require.Equal(t, "success", st.rows[hex.EncodeToString(acct(1))].status)
}
