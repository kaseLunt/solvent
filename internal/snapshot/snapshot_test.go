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

type fakeSnapStore struct {
	registry      [][]byte
	registryCalls int
	upserts       []upsertRec
}

func (s *fakeSnapStore) SnapshotAccounts(context.Context, string) ([][]byte, error) {
	s.registryCalls++
	return s.registry, nil
}

func (s *fakeSnapStore) UpsertSnapshotBalances(_ context.Context, _ string, account []byte, balances map[string]map[string]*big.Int, block uint64) error {
	s.upserts = append(s.upserts, upsertRec{account: hex.EncodeToString(account), block: block, balances: balances})
	return nil
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

// TestFailedAccountSkippedPartial: one reverted collateralOf skips that Safe
// (keeping its previous snapshot) without failing the batch.
func TestFailedAccountSkippedPartial(t *testing.T) {
	respond := func(_ common.Address, data []byte) ([]byte, error) {
		return encodeMulticall(t, 42, []mcResult{
			{Success: false, ReturnData: nil},
			{Success: true, ReturnData: encodeCollateralOf(t, []tokenData{
				{Token: tokenUSDC, Amount: big.NewInt(5)},
			}, big.NewInt(5))},
		}), nil
	}
	s, st, _, _ := harness(t, [][]byte{acct(1), acct(2)}, respond, 10)

	advanced, err := s.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.upserts, 1)
	require.Equal(t, hex.EncodeToString(acct(2)), st.upserts[0].account)
}

// TestAllFailedBatchErrors: a batch where EVERY call reverted is a target
// failure, not per-safe noise — the queue is untouched and the same batch
// retries next round.
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
