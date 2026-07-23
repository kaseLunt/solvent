package derive

// Attempt-scoped state-lifecycle tests shared by both engines: committed-truth
// hydration through StateReader, batch commit/discard/retry identity, and the
// restart-equals-continuous property over the committed golden fixtures.

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Fake StateReader.
// ---------------------------------------------------------------------------

// fakeStateReader is the committed-state stand-in for tests: the exact
// store.BalancesFor shape (asset-hex -> side -> amount), keyed by account
// hex. Absent accounts return an empty map (= zero, the post-genesis
// invariant); a configured err simulates an unreachable store.
type fakeStateReader struct {
	balances map[string]map[string]map[string]*big.Int
	err      error
	calls    map[string]int
}

func newFakeReader() *fakeStateReader {
	return &fakeStateReader{
		balances: make(map[string]map[string]map[string]*big.Int),
		calls:    make(map[string]int),
	}
}

func (f *fakeStateReader) seed(account, asset common.Address, side string, amount *big.Int) *fakeStateReader {
	acct := hex.EncodeToString(account.Bytes())
	if f.balances[acct] == nil {
		f.balances[acct] = make(map[string]map[string]*big.Int)
	}
	assetHex := hex.EncodeToString(asset.Bytes())
	if f.balances[acct][assetHex] == nil {
		f.balances[acct][assetHex] = make(map[string]*big.Int)
	}
	f.balances[acct][assetHex][side] = new(big.Int).Set(amount)
	return f
}

func (f *fakeStateReader) BalancesFor(_ context.Context, _ string, account []byte) (map[string]map[string]*big.Int, error) {
	acct := hex.EncodeToString(account)
	f.calls[acct]++
	if f.err != nil {
		return nil, f.err
	}
	out := make(map[string]map[string]*big.Int, len(f.balances[acct]))
	for asset, sides := range f.balances[acct] {
		out[asset] = make(map[string]*big.Int, len(sides))
		for side, v := range sides {
			out[asset][side] = new(big.Int).Set(v)
		}
	}
	return out, nil
}

// beginBatch starts a batch against r (an empty committed state when nil).
func beginBatch(t *testing.T, e Engine, r StateReader) {
	t.Helper()
	if r == nil {
		r = newFakeReader()
	}
	require.NoError(t, e.BeginBatch(context.Background(), r))
}

// ---------------------------------------------------------------------------
// Replay plumbing.
// ---------------------------------------------------------------------------

type replayStep struct {
	raw store.RawLog
	ev  decode.Event
}

// aaveGoldenSteps decodes the merged pool + weETH aToken fixture streams in
// (block, logIndex) order (decode-skipped admin logs dropped).
func aaveGoldenSteps(t *testing.T) []replayStep {
	t.Helper()
	pool := aaveLoadDoc(t, "aave_pool_logs.json")
	atoken := aaveLoadDoc(t, "aave_atoken_weeth_logs.json")
	logs := append(append([]aaveFixtureLog{}, pool.Logs...), atoken.Logs...)
	sort.Slice(logs, func(i, j int) bool {
		if logs[i].BlockNumber != logs[j].BlockNumber {
			return logs[i].BlockNumber < logs[j].BlockNumber
		}
		return logs[i].LogIndex < logs[j].LogIndex
	})
	r := decode.NewRegistry()
	var steps []replayStep
	for _, fl := range logs {
		raw := fl.rawLog(pool.ChainID)
		d, ok, err := r.Decode(AaveEngineName, raw)
		require.NoError(t, err)
		if !ok {
			continue
		}
		steps = append(steps, replayStep{raw, d})
	}
	require.NotEmpty(t, steps)
	return steps
}

// dmGoldenSteps decodes one committed Debt Manager golden fixture.
func dmGoldenSteps(t *testing.T, fixture string) []replayStep {
	t.Helper()
	fx := loadGolden(t, fixture)
	require.Empty(t, fx.MigrationCalldata, "restart-scenario fixture must not need chain reads")
	reg := decode.NewRegistry()
	var steps []replayStep
	for i, fl := range fx.Logs {
		raw := fl.rawLog()
		d, ok, err := reg.Decode("debt_manager", raw)
		require.NoError(t, err, "fixture log %d", i)
		require.True(t, ok, "fixture log %d not in allowlist", i)
		steps = append(steps, replayStep{raw, d})
	}
	require.NotEmpty(t, steps)
	return steps
}

func processAll(t *testing.T, e Engine, steps []replayStep) []store.PositionEvent {
	t.Helper()
	var out []store.PositionEvent
	for i, s := range steps {
		evs, err := e.Process(s.raw, s.ev)
		require.NoError(t, err, "step %d (block %d log %d)", i, s.raw.BlockNumber, s.raw.LogIndex)
		out = append(out, evs...)
	}
	return out
}

// renderEvents serializes every PositionEvent field into a comparable string
// (fmt prints maps in sorted key order).
func renderEvents(evs []store.PositionEvent) string {
	var sb strings.Builder
	for _, ev := range evs {
		delta := "<nil>"
		if ev.Delta != nil {
			delta = ev.Delta.String()
		}
		fmt.Fprintf(&sb, "%d %s %d %x/%d/%d %s %x %x %s %s %v\n",
			ev.ChainID, ev.Engine, ev.BlockNumber, ev.TxHash, ev.LogIndex, ev.Seq,
			ev.EventType, ev.Account, ev.Asset, ev.Side, delta, ev.Payload)
	}
	return sb.String()
}

// committedFromEvents folds balance-bearing events into a fakeStateReader —
// exactly the running sums store.ApplyDerived would have persisted.
func committedFromEvents(evs []store.PositionEvent) *fakeStateReader {
	r := newFakeReader()
	for _, ev := range evs {
		if ev.Side == "" || ev.Delta == nil {
			continue
		}
		acct := hex.EncodeToString(ev.Account)
		assetHex := hex.EncodeToString(ev.Asset)
		if r.balances[acct] == nil {
			r.balances[acct] = make(map[string]map[string]*big.Int)
		}
		if r.balances[acct][assetHex] == nil {
			r.balances[acct][assetHex] = make(map[string]*big.Int)
		}
		cur := r.balances[acct][assetHex][ev.Side]
		if cur == nil {
			cur = new(big.Int)
		}
		r.balances[acct][assetHex][ev.Side] = new(big.Int).Add(cur, ev.Delta)
	}
	return r
}

// ---------------------------------------------------------------------------
// Promoted-state snapshots (test-side view of committed-truth layers).
// ---------------------------------------------------------------------------

func aaveStateSnapshot(e *AaveEngine) map[string]string {
	out := make(map[string]string)
	for acct, st := range e.promoted {
		for res, v := range st.debt {
			out["bal|"+acct.Hex()+"|"+res.Hex()+"|debt"] = v.String()
		}
		for res, v := range st.collateral {
			out["bal|"+acct.Hex()+"|"+res.Hex()+"|collateral"] = v.String()
		}
	}
	for res, r := range e.promotedRates {
		out["rates|"+res.Hex()] = fmt.Sprintf("%s|%s|%d", r.variableBorrowIndex, r.liquidityIndex, r.block)
	}
	return out
}

func dmStateSnapshot(dm *DebtManager) map[string]string {
	out := make(map[string]string)
	for acct, tokens := range dm.promoted {
		for tok, v := range tokens {
			out["bal|"+acct.Hex()+"|"+tok.Hex()+"|debt"] = v.String()
		}
	}
	for tok, snap := range dm.promotedIndex {
		out["index|"+tok.Hex()] = fmt.Sprintf("%s|%d", snap.value, snap.block)
	}
	return out
}

// requireStateSubset asserts every entry of subset matches full — used for
// the post-Reset engine, whose promoted layer only holds accounts touched
// after the reset (untouched committed accounts stay in the store, absent
// from memory, and absence means zero).
func requireStateSubset(t *testing.T, full, subset map[string]string, msg string) {
	t.Helper()
	for k, v := range subset {
		fv, ok := full[k]
		require.True(t, ok, "%s: unexpected state key %s", msg, k)
		require.Equal(t, fv, v, "%s: state divergence at %s", msg, k)
	}
}

// blockBoundarySplits picks two step indexes at block boundaries near 1/3 and
// 2/3 of the stream, so a Reset (whose resume must be block-aligned, like a
// real rewind) can reuse them.
func blockBoundarySplits(t *testing.T, steps []replayStep) (int, int) {
	t.Helper()
	find := func(from int) int {
		for i := from; i < len(steps); i++ {
			if steps[i].raw.BlockNumber != steps[i-1].raw.BlockNumber {
				return i
			}
		}
		t.Fatalf("no block boundary at or after step %d", from)
		return 0
	}
	a := find(len(steps) / 3)
	b := find(2 * len(steps) / 3)
	require.Greater(t, b, a, "need two distinct block-boundary split points")
	return a, b
}

// runRestartScenarios is the mandated restart-equals-continuous proof: one
// golden stream replayed (1) continuously, (2) split into three batches with
// Commit between, (3) with a Discard+retry in the middle, and (4) with a
// Reset mid-stream followed by re-hydration from a fake reader carrying the
// committed state — all four must produce identical PositionEvents and
// identical final state.
func runRestartScenarios(t *testing.T, mk func() Engine, steps []replayStep, snapshot func(Engine) map[string]string) {
	t.Helper()
	a, b := blockBoundarySplits(t, steps)

	// 1. Continuous single batch.
	cont := mk()
	beginBatch(t, cont, nil)
	contEvents := processAll(t, cont, steps)
	cont.CommitBatch()

	// 2. Three batches, Commit between.
	batched := mk()
	var batchedEvents []store.PositionEvent
	for _, seg := range [][2]int{{0, a}, {a, b}, {b, len(steps)}} {
		beginBatch(t, batched, nil)
		batchedEvents = append(batchedEvents, processAll(t, batched, steps[seg[0]:seg[1]])...)
		batched.CommitBatch()
	}

	// 3. Discard + retry in the middle (a PRE-persistence failure of batch 2:
	// the attempt never reached ApplyDerived — an ApplyDerived error would
	// take Reset instead, see TestIndeterminateCommit* in lifecycle_live_test.go).
	retried := mk()
	beginBatch(t, retried, nil)
	kept := processAll(t, retried, steps[:a])
	retried.CommitBatch()
	beginBatch(t, retried, nil)
	attempt := processAll(t, retried, steps[a:b])
	retried.DiscardBatch()
	beginBatch(t, retried, nil)
	retry := processAll(t, retried, steps[a:b])
	require.Equal(t, renderEvents(attempt), renderEvents(retry),
		"retry after Discard must reproduce identical events — no double-mutation")
	retried.CommitBatch()
	kept = append(kept, retry...)
	beginBatch(t, retried, nil)
	kept = append(kept, processAll(t, retried, steps[b:])...)
	retried.CommitBatch()

	// 4. Reset mid-stream, then re-hydrate from the committed state a real
	// runner would have persisted for the first segment.
	resetEng := mk()
	beginBatch(t, resetEng, nil)
	first := processAll(t, resetEng, steps[:b])
	resetEng.CommitBatch()
	resetEng.Reset()
	beginBatch(t, resetEng, committedFromEvents(first))
	resetEvents := append(append([]store.PositionEvent{}, first...), processAll(t, resetEng, steps[b:])...)
	resetEng.CommitBatch()

	want := renderEvents(contEvents)
	require.Equal(t, want, renderEvents(batchedEvents), "3-batch replay diverged from continuous")
	require.Equal(t, want, renderEvents(kept), "discard+retry replay diverged from continuous")
	require.Equal(t, want, renderEvents(resetEvents), "reset+rehydrate replay diverged from continuous")

	wantState := snapshot(cont)
	require.Equal(t, wantState, snapshot(batched), "3-batch final state diverged")
	require.Equal(t, wantState, snapshot(retried), "discard+retry final state diverged")
	requireStateSubset(t, wantState, snapshot(resetEng), "reset+rehydrate final state")
}

func TestAaveRestartEqualsContinuous(t *testing.T) {
	runRestartScenarios(t,
		func() Engine { return NewAaveEngine() },
		aaveGoldenSteps(t),
		func(e Engine) map[string]string { return aaveStateSnapshot(e.(*AaveEngine)) })
}

func TestDebtManagerRestartEqualsContinuous(t *testing.T) {
	runRestartScenarios(t,
		func() Engine { return NewDebtManager(nil) },
		dmGoldenSteps(t, "dm_golden_borrower_0303a641.json"),
		func(e Engine) map[string]string { return dmStateSnapshot(e.(*DebtManager)) })
}

// ---------------------------------------------------------------------------
// Lifecycle guards.
// ---------------------------------------------------------------------------

func TestLifecycleGuards(t *testing.T) {
	for _, tc := range []struct {
		name string
		mk   func() Engine
	}{
		{"aave", func() Engine { return NewAaveEngine() }},
		{"debt_manager", func() Engine { return NewDebtManager(nil) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := tc.mk()

			// Process outside a batch is refused.
			_, err := e.Process(store.RawLog{ChainID: 1, BlockNumber: 1, TxHash: make([]byte, 32)}, decode.AaveBorrow{})
			require.ErrorContains(t, err, "outside a batch")

			// Commit/Discard outside a batch are safe no-ops.
			e.CommitBatch()
			e.DiscardBatch()

			// Nil reader / nil context are refused.
			require.ErrorContains(t, e.BeginBatch(context.Background(), nil), "StateReader")
			require.ErrorContains(t, e.BeginBatch(nil, newFakeReader()), "non-nil context")

			// Double BeginBatch is refused; Discard clears the way.
			beginBatch(t, e, nil)
			require.ErrorContains(t, e.BeginBatch(context.Background(), newFakeReader()), "in progress")
			e.DiscardBatch()
			beginBatch(t, e, nil)
			e.CommitBatch()
		})
	}
}

func TestHydrationReaderErrorPropagates(t *testing.T) {
	t.Run("aave", func(t *testing.T) {
		r := newFakeReader()
		r.err = errors.New("store unreachable")
		e := NewAaveEngine()
		beginBatch(t, e, r)
		aaveFeedRDU(t, e, 21000000, 1, 1, aaveUSDC, new(big.Int).Set(rayUnit))
		_, err := e.Process(aaveSynthLog(21000000, 2, 1, aavePool), decode.AaveBorrow{
			Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
			Amount: big.NewInt(5), InterestRateMode: 2, BorrowRate: big.NewInt(0),
		})
		require.ErrorContains(t, err, "hydrating account")
		require.ErrorIs(t, err, r.err, "the reader's error must surface, never a silent zero")
	})
	t.Run("debt_manager", func(t *testing.T) {
		r := newFakeReader()
		r.err = errors.New("store unreachable")
		dm := NewDebtManager(nil)
		beginBatch(t, dm, r)
		feedIndex(t, dm, 100, tUSDC, num("1000000000000000000"))
		_, err := dm.Process(tLog(100, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(5)})
		require.ErrorContains(t, err, "hydrating account")
		require.ErrorIs(t, err, r.err)
	})
}

// TestHydrationOncePerLifetimeUntilReset: committed truth is consulted once
// per account per engine lifetime — surviving Commit AND Discard — and only
// Reset forces re-hydration.
func TestHydrationOncePerLifetimeUntilReset(t *testing.T) {
	r := newFakeReader().seed(tUser, tUSDC, "debt", big.NewInt(10))
	acctHex := hex.EncodeToString(tUser.Bytes())
	dm := NewDebtManager(nil)

	beginBatch(t, dm, r)
	feedIndex(t, dm, 100, tUSDC, num("1000000000000000000"))
	evs, err := dm.Process(tLog(100, 0x01, 5), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(3)})
	require.NoError(t, err)
	require.Equal(t, "-3", evs[0].Delta.String())
	dm.CommitBatch()
	require.Equal(t, 1, r.calls[acctHex])

	// Second batch re-touches the account: no re-read (promoted layer serves).
	beginBatch(t, dm, r)
	feedIndex(t, dm, 101, tUSDC, num("1000000000000000000"))
	evs, err = dm.Process(tLog(101, 0x02, 5), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(7)})
	require.NoError(t, err)
	require.Equal(t, "-7", evs[0].Delta.String(), "10 - 3 leaves exactly 7")
	dm.DiscardBatch()
	require.Equal(t, 1, r.calls[acctHex])

	// After Reset, the next touch re-hydrates (the discarded -7 never
	// happened; committed truth is still 10-3=7 — simulate it).
	dm.Reset()
	r2 := newFakeReader().seed(tUser, tUSDC, "debt", big.NewInt(7))
	beginBatch(t, dm, r2)
	feedIndex(t, dm, 101, tUSDC, num("1000000000000000000"))
	evs, err = dm.Process(tLog(101, 0x02, 5), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(7)})
	require.NoError(t, err)
	require.Equal(t, "-7", evs[0].Delta.String())
	_, err = dm.Process(tLog(101, 0x03, 7), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(1)})
	require.ErrorContains(t, err, "negative", "hydrated balance fully consumed — absence-of-more is mechanical zero")
	require.Equal(t, 1, r2.calls[acctHex])
}

// TestAaveHydratedFoldExactNoAmplification is Codex's drift example as a
// test: index i = 6*RAY/5 (= 1.2 ray, exact), committed scaled s = 4
// hydrated from the reader, and a regime-B Mint transitioning s to 5
// (on-chain: nominal moves floor(4*1.2)=4 -> floor(5*1.2)=6, so Mint.Value =
// 2 with BalanceIncrease = 0). The inversion must recover s' = 5 EXACTLY:
// delta is 1 scaled wei — not rayDivCeil(Value, i) = 2, the naive per-event
// division that would amplify the hydrated state by rounding.
func TestAaveHydratedFoldExactNoAmplification(t *testing.T) {
	idx := new(big.Int).Div(new(big.Int).Mul(rayUnit, big.NewInt(6)), big.NewInt(5)) // exact 1.2e27
	acct := aaveUserA
	r := newFakeReader().seed(acct, aaveWEETH, "collateral", big.NewInt(4))
	e := NewAaveEngine()
	beginBatch(t, e, r)

	evs, err := e.Process(aaveSynthLog(aaveTokenMathFromBlock+100, 5, 1, aaveAWEETH), decode.ATokenMint{
		Caller: acct, OnBehalfOf: acct,
		Value: big.NewInt(2), BalanceIncrease: big.NewInt(0), Index: idx,
	})
	require.NoError(t, err)
	require.Len(t, evs, 1)
	require.Equal(t, "1", evs[0].Delta.String(), "exact inversion: s 4 -> 5, no rounding amplification")
	require.Equal(t, "5", aaveTracked(e, "collateral", aaveWEETH, acct), "tracked scaled balance is exactly 5")
	require.Equal(t, "6", rayMulFloor(big.NewInt(5), idx).String(), "recovered s' reproduces the on-chain nominal")
}

// TestDiscardRetryNoDoubleMutation (synthetic, both engines): a discarded
// attempt leaves committed/promoted truth untouched, so the retry folds from
// the same base and the post-commit balance reflects exactly one application.
func TestDiscardRetryNoDoubleMutation(t *testing.T) {
	t.Run("aave", func(t *testing.T) {
		r := newFakeReader().seed(aaveUserA, aaveUSDC, "debt", big.NewInt(100))
		e := NewAaveEngine()
		run := func() []store.PositionEvent {
			beginBatch(t, e, r)
			aaveFeedRDU(t, e, 25000000, 1, 1, aaveUSDC, new(big.Int).Set(rayUnit))
			evs, err := e.Process(aaveSynthLog(25000000, 2, 1, aavePool), decode.AaveBorrow{
				Reserve: aaveUSDC, User: aaveUserA, OnBehalfOf: aaveUserA,
				Amount: big.NewInt(50), InterestRateMode: 2, BorrowRate: big.NewInt(0),
			})
			require.NoError(t, err)
			return evs
		}
		attempt := run()
		e.DiscardBatch()
		retry := run()
		require.Equal(t, renderEvents(attempt), renderEvents(retry), "identical events on retry")
		e.CommitBatch()

		// Balance is exactly 100+50 once: repaying 150 succeeds, 1 more fails.
		beginBatch(t, e, r)
		aaveFeedRDU(t, e, 25000001, 1, 2, aaveUSDC, new(big.Int).Set(rayUnit))
		_, err := e.Process(aaveSynthLog(25000001, 2, 2, aavePool), decode.AaveRepay{
			Reserve: aaveUSDC, User: aaveUserA, Repayer: aaveUserA,
			Amount: big.NewInt(150), UseATokens: false,
		})
		require.NoError(t, err)
		_, err = e.Process(aaveSynthLog(25000001, 3, 2, aavePool), decode.AaveRepay{
			Reserve: aaveUSDC, User: aaveUserA, Repayer: aaveUserA,
			Amount: big.NewInt(1), UseATokens: false,
		})
		require.ErrorContains(t, err, "negative", "the discarded attempt must not have double-applied")
	})
	t.Run("debt_manager", func(t *testing.T) {
		r := newFakeReader().seed(tUser, tUSDC, "debt", big.NewInt(100))
		dm := NewDebtManager(nil)
		run := func() []store.PositionEvent {
			beginBatch(t, dm, r)
			feedIndex(t, dm, 200, tUSDC, num("1000000000000000000"))
			evs, err := dm.Process(tLog(200, 0x01, 5), decode.DMBorrowed{User: tUser, Token: tUSDC, Amount: big.NewInt(50)})
			require.NoError(t, err)
			return evs
		}
		attempt := run()
		dm.DiscardBatch()
		retry := run()
		require.Equal(t, renderEvents(attempt), renderEvents(retry), "identical events on retry")
		dm.CommitBatch()

		beginBatch(t, dm, r)
		feedIndex(t, dm, 201, tUSDC, num("1000000000000000000"))
		_, err := dm.Process(tLog(201, 0x02, 5), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(150)})
		require.NoError(t, err)
		_, err = dm.Process(tLog(201, 0x03, 7), decode.DMRepaid{User: tUser, Payer: tPayer, Token: tUSDC, UsdAmount: big.NewInt(1)})
		require.ErrorContains(t, err, "negative", "the discarded attempt must not have double-applied")
	})
}
