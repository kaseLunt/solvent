package snapshot

// Snapshotter tests with a fake chain and store: request shape (multicall3
// tryBlockAndAggregate of collateralOf reads, selectors pinned against
// `cast sig`), rotating batch consumption, cadence gating, post-rewind
// re-sweep, and the partial/total failure postures. Responses are encoded
// through the same ABI objects the snapshotter decodes with.

import (
	"context"
	"encoding/hex"
	"errors"
	"math/big"
	"reflect"
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

type upsertRec struct {
	account  string
	block    uint64
	balances map[string]map[string]*big.Int
}

// sweepRec is one recorded per-account attempt outcome (account hex, the
// multicall block it was recorded at, and whether it succeeded).
type sweepRec struct {
	account string
	block   uint64
	success bool
}

type fakeSnapStore struct {
	registry      [][]byte
	registryCalls int
	upserts       []upsertRec
	records       []sweepRec
}

func (s *fakeSnapStore) SnapshotAccounts(context.Context, string) ([][]byte, error) {
	s.registryCalls++
	return s.registry, nil
}

func (s *fakeSnapStore) UpsertSnapshotBalances(_ context.Context, _ string, account []byte, balances map[string]map[string]*big.Int, block uint64) error {
	s.upserts = append(s.upserts, upsertRec{account: hex.EncodeToString(account), block: block, balances: balances})
	return nil
}

func (s *fakeSnapStore) RecordSnapshotSweep(_ context.Context, _ string, block uint64, outcomes []store.SweepOutcome) error {
	for _, o := range outcomes {
		s.records = append(s.records, sweepRec{account: hex.EncodeToString(o.Account), block: block, success: o.Success})
	}
	return nil
}

// recordsFor filters the recorded outcomes for one account.
func (s *fakeSnapStore) recordsFor(account []byte) []sweepRec {
	var out []sweepRec
	for _, r := range s.records {
		if r.account == hex.EncodeToString(account) {
			out = append(out, r)
		}
	}
	return out
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

// harness wires a Snapshotter with a controllable clock.
func harness(t *testing.T, registry [][]byte, respond func(common.Address, []byte) ([]byte, error), batchSize int) (*Snapshotter, *fakeSnapStore, *fakeChain, *time.Time) {
	t.Helper()
	st := &fakeSnapStore{registry: registry}
	ch := &fakeChain{respond: respond}
	s, err := New(st, ch, Config{
		Engine: "debt_manager", Target: testTarget,
		Interval: time.Hour, BatchSize: batchSize,
	})
	require.NoError(t, err)
	clock := time.Date(2026, 7, 23, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	return s, st, ch, &clock
}

func acct(b byte) []byte {
	a := make([]byte, 20)
	a[19] = b
	return a
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

func TestNewValidation(t *testing.T) {
	st := &fakeSnapStore{}
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
// across three Steps — one multicall each — in registry order (the store's
// nonzero-debt-first priority order), stamped with the multicall's execution
// block; a fourth Step inside the cadence window does nothing.
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
	require.Len(t, st.upserts, 5)
	for i, up := range st.upserts {
		require.Equal(t, hex.EncodeToString(registry[i]), up.account, "registry order preserved")
		require.Equal(t, uint64(12345), up.block)
		require.Equal(t, map[string]map[string]*big.Int{
			hex.EncodeToString(tokenUSDC.Bytes()): {"collateral": big.NewInt(777)},
		}, up.balances)
	}
	require.Equal(t, 1, st.registryCalls, "one registry read per sweep")

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "sweep complete and cadence not elapsed")
}

// TestCadenceGating: a completed sweep re-arms only after the configured
// interval elapses.
func TestCadenceGating(t *testing.T) {
	s, st, _, clock := harness(t, [][]byte{acct(1)}, uniformResponder(t, 10, nil), 10)

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	*clock = clock.Add(59 * time.Minute)
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "inside the interval: no new sweep")

	*clock = clock.Add(2 * time.Minute)
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "interval elapsed: new sweep starts")
	require.Equal(t, 2, st.registryCalls, "the new sweep re-reads the registry")
}

// TestTriggerResweepRestartsImmediately: a mid-sweep trigger (the runner's
// post-rewind hook) drops the in-flight queue and the next Step re-reads the
// registry from scratch — a rewind may have changed it.
func TestTriggerResweepRestartsImmediately(t *testing.T) {
	registry := [][]byte{acct(1), acct(2), acct(3)}
	s, st, _, _ := harness(t, registry, uniformResponder(t, 10, nil), 1)

	_, err := s.Step(context.Background()) // consumes acct(1); queue = 2,3
	require.NoError(t, err)
	require.Equal(t, 1, st.registryCalls)

	st.registry = [][]byte{acct(9)} // post-rewind registry differs
	s.TriggerResweep()

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, 2, st.registryCalls, "resweep must re-read the registry")
	require.Equal(t, hex.EncodeToString(acct(9)), st.upserts[len(st.upserts)-1].account,
		"the dropped queue's accounts are not swept; the fresh registry is")
}

// TestZeroAmountsOmittedAndEmptyUpsertClears: zero-amount tokens vanish from
// the balances map, and a Safe whose entire collateral is zero still gets an
// upsert with an EMPTY map — wholesale replacement is what clears its stale
// snapshot rows.
func TestZeroAmountsOmittedAndEmptyUpsertClears(t *testing.T) {
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
	require.Len(t, st.upserts, 2)
	require.Equal(t, map[string]map[string]*big.Int{
		hex.EncodeToString(tokenUSDC.Bytes()): {"collateral": big.NewInt(1000)},
	}, st.upserts[0].balances)
	require.Empty(t, st.upserts[1].balances, "all-zero safe upserts an empty map to clear stale rows")
}

// TestFailedAccountRetriedBoundedThenDegraded pins the full per-account
// failure lifecycle: a reverted Safe does not fail its batch (the sibling's
// upsert lands), is recorded status=failed, joins the immediate-retry queue,
// gets exactly maxAccountRetries further attempts this sweep — an
// all-reverted RETRY batch is per-account failure, never the fresh-batch
// target error — and then the sweep COMPLETES (degraded) instead of wedging.
func TestFailedAccountRetriedBoundedThenDegraded(t *testing.T) {
	bad, good := acct(1), acct(2)
	respond := perAccountResponder(t, 42, map[string]bool{hex.EncodeToString(bad): true},
		[]tokenData{{Token: tokenUSDC, Amount: big.NewInt(5)}})
	s, st, ch, _ := harness(t, [][]byte{bad, good}, respond, 10)

	// Fresh batch: good upserts + success record; bad records failed and is
	// requeued for immediate retry — the sweep is NOT complete yet.
	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.upserts, 1)
	require.Equal(t, hex.EncodeToString(good), st.upserts[0].account)
	require.Equal(t, []sweepRec{{account: hex.EncodeToString(good), block: 42, success: true}}, st.recordsFor(good))
	require.Equal(t, []sweepRec{{account: hex.EncodeToString(bad), block: 42, success: false}}, st.recordsFor(bad))

	// Retry batches: one per Step, all reverting, each recorded — until the
	// budget (maxAccountRetries) is spent and the sweep completes DEGRADED.
	for i := 0; i < maxAccountRetries; i++ {
		advanced, err = s.Step(context.Background())
		require.NoError(t, err, "an all-reverted RETRY batch must not be a target error")
		require.True(t, advanced)
	}
	require.Len(t, ch.calls, 1+maxAccountRetries, "1 fresh + bounded retry multicalls")
	require.Len(t, st.recordsFor(bad), 1+maxAccountRetries, "every attempt recorded")
	for _, r := range st.recordsFor(bad) {
		require.False(t, r.success)
	}
	require.Len(t, st.upserts, 1, "the reverting safe never upserts")

	// Sweep is over (degraded): inside the interval nothing more happens —
	// the failed safe waits for the NEXT sweep, status=failed meanwhile.
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, 1, st.registryCalls)
}

// TestFailedAccountRecoversOnRetry: a Safe that reverts once and then
// succeeds flips to status=success within the same sweep — the retry queue
// is a recovery path, not just failure accounting.
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
	recs := st.recordsFor(flaky)
	require.Len(t, recs, 2)
	require.False(t, recs[0].success)
	require.True(t, recs[1].success, "a successful retry must flip the status to success")
	require.Equal(t, hex.EncodeToString(flaky), st.upserts[len(st.upserts)-1].account)

	// Recovered and complete: nothing further inside the interval.
	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
}

// TestZeroCollateralSuccessDistinguishableFromNeverSwept pins the three-way
// disambiguation at the snapshotter level: a swept all-zero Safe produces a
// SUCCESS record plus an empty wholesale upsert, while a Safe absent from
// the registry produces NO record at all — so "empty because read" and
// "empty because never read" are different states.
func TestZeroCollateralSuccessDistinguishableFromNeverSwept(t *testing.T) {
	swept, neverSwept := acct(1), acct(9)
	s, st, _, _ := harness(t, [][]byte{swept}, uniformResponder(t, 77, nil), 10)

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []sweepRec{{account: hex.EncodeToString(swept), block: 77, success: true}},
		st.recordsFor(swept), "zero collateral is a SUCCESS outcome")
	require.Len(t, st.upserts, 1)
	require.Empty(t, st.upserts[0].balances, "the empty upsert clears any stale rows")
	require.Empty(t, st.recordsFor(neverSwept), "never-swept means no record, not a failed one")
}

// TestStartupSweepCoversRewindCrash pins the DURABLE half of the post-rewind
// re-sweep contract: TriggerResweep is process memory, and a crash between
// the runner's RewindDerived and the hook loses it — recovery needs no
// durable marker because a FRESH snapshotter (a restarted process) starts
// its first sweep unconditionally, superseding any lost re-sweep request.
func TestStartupSweepCoversRewindCrash(t *testing.T) {
	// A "restarted process": a brand-new Snapshotter that never saw the
	// pre-crash TriggerResweep. Its very first Step must sweep.
	s, st, ch, _ := harness(t, [][]byte{acct(1)}, uniformResponder(t, 10, nil), 10)
	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the startup sweep must start with no trigger and no elapsed interval")
	require.Equal(t, 1, st.registryCalls)
	require.Len(t, ch.calls, 1)
}

// TestAllFailedBatchErrors: a FRESH batch where EVERY call reverted is a
// target failure, not per-safe noise — the queue is untouched, the same
// batch retries next round, and NO status rows are recorded (the target
// being down says nothing about individual Safes).
func TestAllFailedBatchErrors(t *testing.T) {
	respond := func(_ common.Address, data []byte) ([]byte, error) {
		return encodeMulticall(t, 42, []mcResult{
			{Success: false}, {Success: false},
		}), nil
	}
	s, st, ch, _ := harness(t, [][]byte{acct(1), acct(2)}, respond, 10)

	_, err := s.Step(context.Background())
	require.ErrorContains(t, err, "every collateralOf call")
	require.Empty(t, st.upserts)
	require.Empty(t, st.records, "a target-broken batch must not smear failed status over its safes")

	// Queue untouched: the next Step retries the same batch.
	_, err = s.Step(context.Background())
	require.ErrorContains(t, err, "every collateralOf call")
	require.Len(t, ch.calls, 2)
	require.Equal(t, ch.calls[0].data, ch.calls[1].data)
	require.Equal(t, 1, st.registryCalls, "a retried batch must not restart the sweep")
}

// TestTransportErrorLeavesQueue: a failed multicall leaves the queue
// untouched for retry.
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
	s, st, _, _ := harness(t, [][]byte{acct(1)}, respond, 10)

	_, err := s.Step(context.Background())
	require.ErrorContains(t, err, "all rpc endpoints failed")

	failing = false
	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.upserts, 1)
}

// TestMalformedResponseErrors: garbage bytes from the provider are an error,
// never a panic and never a partial upsert.
func TestMalformedResponseErrors(t *testing.T) {
	respond := func(common.Address, []byte) ([]byte, error) {
		return []byte{0x01, 0x02, 0x03}, nil
	}
	s, st, _, _ := harness(t, [][]byte{acct(1)}, respond, 10)

	_, err := s.Step(context.Background())
	require.Error(t, err)
	require.Empty(t, st.upserts)
}

// TestEmptyRegistryCountsAsSweep: an empty registry (early backfill) marks
// the sweep done so the store is not re-queried every round.
func TestEmptyRegistryCountsAsSweep(t *testing.T) {
	s, st, ch, clock := harness(t, nil, uniformResponder(t, 1, nil), 10)

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, ch.calls)
	require.Equal(t, 1, st.registryCalls)

	advanced, err = s.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, 1, st.registryCalls, "inside the interval the registry is not re-read")

	*clock = clock.Add(2 * time.Hour)
	_, err = s.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, 2, st.registryCalls)
}
