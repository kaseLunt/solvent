package main

// Shared fixtures and readers for the set-run laws.
//
// Everything here builds books through the PRODUCTION writer
// (`store.WriteRiskBatch`) and reads them back through the REAL handler chain,
// so a law never asserts against a shape the daemon cannot produce.

import (
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

const setRunContractPath = "/v1/scenarios/run-book-set"

// The committed OP marks the stable-depeg control names. They are read from the
// COMMITTED FILES' own propagation matrices (asserted in
// `TestSetRunShockReachDisclosesASnappedControlAndADeclaredHold`), so a fixture
// built on them rots loudly rather than silently if a file is edited.
var (
	srUSDCOp      = common.HexToAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")
	srUSDTOp      = common.HexToAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58")
	srFrxUSDOp    = common.HexToAddress("0x80Eede496655FB9047dd39d9f418d5483ED600df")
	srLiquidUSDOp = common.HexToAddress("0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C")
	// The identity census's own marks.
	srEUSDOp      = common.HexToAddress("0x939778D83b46B456224A33Fb59630B11DEC56663")
	srLiquidRWAOp = common.HexToAddress("0x17bC8Ffd82b8a36e737Ca1141C025089589B915e")
)

// srPost issues the raw POST and returns the status and body, so a law can
// assert on a refusal shape the contract validator would reject.
func (f *apiFixture) srPost(t *testing.T, body string) (int, []byte) {
	t.Helper()
	resp, err := http.Post(f.http.URL+setRunContractPath, "application/json", strings.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, raw
}

// srPostHeaders is srPost keeping the response header, for the two laws that are
// about a header's PRESENCE or ABSENCE.
func (f *apiFixture) srPostHeaders(t *testing.T, body string) (int, http.Header, []byte) {
	t.Helper()
	resp, err := http.Post(f.http.URL+setRunContractPath, "application/json", strings.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, resp.Header, raw
}

func srBody(ids ...string) string {
	raw, err := json.Marshal(setRunRequest{ScenarioIDs: ids})
	if err != nil {
		panic(err)
	}
	return string(raw)
}

// srRun posts a set of ids, requires the status, CONTRACT-VALIDATES the body
// against the declared response for that status, and decodes it.
func (f *apiFixture) srRun(t *testing.T, status int, ids ...string) map[string]any {
	t.Helper()
	got, raw := f.srPost(t, srBody(ids...))
	require.Equal(t, status, got, "body: %s", truncate(raw))
	validateContractMethod(t, setRunContractPath, http.MethodPost, status, raw)
	var out map[string]any
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

// srResults indexes a served body's results by scenario id.
func srResults(t *testing.T, out map[string]any) map[string]map[string]any {
	t.Helper()
	byID := map[string]map[string]any{}
	for _, r := range asList(t, out["results"]) {
		m := asMap(t, r)
		byID[m["scenario_id"].(string)] = m
	}
	return byID
}

// srEngines indexes one result's engine summaries by engine.
func srEngines(t *testing.T, res map[string]any) map[string]map[string]any {
	t.Helper()
	byEngine := map[string]map[string]any{}
	for _, e := range asList(t, res["engines"]) {
		m := asMap(t, e)
		byEngine[m["engine"].(string)] = m
	}
	return byEngine
}

// srCensus indexes the shared coverage census by engine.
func srCensus(t *testing.T, out map[string]any) map[string]map[string]any {
	t.Helper()
	byEngine := map[string]map[string]any{}
	for _, e := range asList(t, asMap(t, out["coverage"])["engines"]) {
		m := asMap(t, e)
		byEngine[m["engine"].(string)] = m
	}
	return byEngine
}

func srStrings(t *testing.T, v any) []string {
	t.Helper()
	out := []string{}
	for _, s := range asList(t, v) {
		str, ok := s.(string)
		require.True(t, ok, "expected a string, got %T", s)
		out = append(out, str)
	}
	return out
}

// ---------------------------------------------------------------------------
// Book builders
// ---------------------------------------------------------------------------

// srDMPrice is one extra DEBT MANAGER price input on an existing position.
//
// A price input needs NO leg and no param-ledger row: `reconstructPrices` reads
// the persisted snapshot straight through, and the param weld is over LEGS. That
// is what makes a propagation-matrix fixture cheap — `ApplyScenario` walks
// `DM.Prices`, so the applied/held-flat split is decided entirely by the price
// vector.
func srDMPrice(account common.Address, asset common.Address, chainID uint64, value string) store.RiskBatchPriceInput {
	return store.RiskBatchPriceInput{
		Engine: risk.DMEngine, Account: account.Bytes(), Asset: asset.Bytes(),
		ChainID: int64(chainID), Source: fxDMSource, Provenance: risk.ProvenanceEngineExact,
		Value: bi(value), Decimals: i16p(6), BlockNumber: i64p(fxDMPriceBlock),
		SourceAsOf:    timep(fxBase.Add(-time.Duration(fxDMWeETHAge) * time.Second)),
		BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictFresh, AgeSeconds: i64p(fxDMWeETHAge),
	}
}

// srDMWithPrices is the standing Debt Manager position carrying EXTRA price
// inputs. Its legs, thresholds and money are untouched, so the reconstruction
// weld and every existing constant still hold.
func srDMWithPrices(extra ...store.RiskBatchPriceInput) *positionRow {
	p := fxDMPosition()
	p.Prices = append(p.Prices, extra...)
	return p
}

// srBatchWrite is the standing four-position book with the DM position replaced.
func srBatchWrite(key string, positions ...*positionRow) store.RiskBatchWrite {
	w := store.RiskBatchWrite{
		Producer:             fxBatchProduce,
		Watermarks:           fxWatermarks(),
		RequiredEngines:      fxRequiredEngines(),
		RequiredSweepEngines: []string{risk.DMEngine},
		Retention:            100,
		MaterializationKey:   key,
		Notify:               notifyChannel,
		Aggregates:           fxAggregates(),
	}
	for _, p := range positions {
		w.Positions = append(w.Positions, toWrite(p))
	}
	return w
}

// srCountedBatchWrite is srBatchWrite with the per-engine aggregate COUNTS
// derived from the positions rather than restated: `WriteRiskBatch` refuses a
// batch whose aggregates account for a different number of positions than the
// batch carries, and a fixture that hand-typed them would drift the moment a law
// changed its book.
func srCountedBatchWrite(key string, positions ...*positionRow) store.RiskBatchWrite {
	w := srBatchWrite(key, positions...)
	counts := map[string][2]int{}
	for _, p := range positions {
		c := counts[p.Engine]
		c[0]++
		if p.Status == store.RiskPositionRefused {
			c[1]++
		}
		counts[p.Engine] = c
	}
	for i := range w.Aggregates {
		c := counts[w.Aggregates[i].Engine]
		w.Aggregates[i].Positions = c[0]
		w.Aggregates[i].RefusedPositions = c[1]
		w.Aggregates[i].ComputedPositions = c[0] - c[1]
		w.Aggregates[i].FlaggedPositions = 0
		w.Aggregates[i].LiquidatablePositions = 0
	}
	return w
}

// srSeed writes a book and requires it to clear the SERVING bar.
func (f *apiFixture) srSeed(t *testing.T, w store.RiskBatchWrite) int64 {
	t.Helper()
	id, err := f.store.WriteRiskBatch(f.ctx, w)
	require.NoError(t, err)
	require.Positive(t, id)
	batch, found, err := f.store.NewestCompleteBatch(f.ctx)
	require.NoError(t, err)
	require.True(t, found, "the seeded batch must satisfy the completeness predicate")
	require.Equal(t, id, batch.ID)
	f.batchID = id
	return id
}

// newSetRunStableFixture is the SNAP-CONTROL book: the standing P5 fixture with
// four extra Debt Manager marks — the three `stable_snap` stables and the one
// `base_stable_snap` composition — every one of them at 6 price decimals,
// because `base_stable_snap` refuses any other decimals outright and liquidUSD
// is the only `base_stable_snap` row in the committed set.
func newSetRunStableFixture(t *testing.T, parMarks bool) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)

	liquid := "1000000"
	if !parMarks {
		liquid = "1000500"
	}
	dm := srDMWithPrices(
		srDMPrice(fxAcctDM, srUSDCOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srUSDTOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srFrxUSDOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srLiquidUSDOp, fxOPChain, liquid),
	)
	f.srSeed(t, srBatchWrite("set-run-stable-1",
		exAavePosition(), fxAaveRefused(), dm, fxDMRefused()))
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)
	return f
}

// srArmInterleave arms (or disarms, with nil) the handler's in-flight seam.
func (f *apiFixture) srArmInterleave(fn func()) {
	f.srv.setRunInterleave.Store(&fn)
}

// srHoldOneSlot parks a set-run INSIDE the handler with its slot held, and
// returns the release. It uses a raw client rather than `f.srPost` because a
// `require` in a background goroutine that outlives the test is a panic rather
// than a failure.
func (f *apiFixture) srHoldOneSlot(t *testing.T) func() {
	t.Helper()
	entered := make(chan struct{})
	hold := make(chan struct{})
	done := make(chan struct{})
	var once sync.Once
	f.srArmInterleave(func() {
		once.Do(func() { close(entered) })
		<-hold
	})
	go func() {
		defer close(done)
		resp, err := http.Post(f.http.URL+setRunContractPath, "application/json", strings.NewReader(srBody("eth_minus_10")))
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(30 * time.Second):
		t.Fatal("the parked set-run never reached the in-flight seam")
	}
	var released sync.Once
	return func() {
		released.Do(func() {
			close(hold)
			<-done
			f.srArmInterleave(nil)
		})
	}
}

// normalizeSetRunServeTime overwrites EXACTLY the six fields a clock produces
// and returns the list it touched. It FAILS if a field it expects to normalize
// is absent — a normalizer that silently normalizes nothing makes every
// comparison beneath it vacuous.
//
// Two of the six are FREE ANCHORS (`served_at`/`evaluation.resolved_at`, which
// are one instant, and `evaluation.probed_at`, a second reading) plus
// `batch.computed_at`, a persisted anchor. The two AGES are DERIVED from those
// anchors and never written as literals: production measures both from the one
// database instant it serves at, so once the anchors are chosen the ages are not
// a further choice.
var runBookSetExampleServeTimeFields = []string{
	"served_at",
	"batch.computed_at",
	"batch.age_seconds",
	"batch.watermarks[].sweep.age_seconds",
	"evaluation.resolved_at",
	"evaluation.probed_at",
}

func normalizeSetRunServeTime(t *testing.T, body map[string]any) {
	t.Helper()
	require.Contains(t, body, "served_at")
	body["served_at"] = exampleServedAt.UTC().Format(time.RFC3339)

	ev := asMap(t, body["evaluation"])
	require.Contains(t, ev, "resolved_at")
	require.Contains(t, ev, "probed_at")
	// `resolved_at` IS `served_at` — one instant, read twice — so it is
	// normalized to the same value rather than to a second stylistic one.
	ev["resolved_at"] = exampleServedAt.UTC().Format(time.RFC3339)
	ev["probed_at"] = setRunExampleProbedAt.UTC().Format(time.RFC3339)

	batch := asMap(t, body["batch"])
	require.Contains(t, batch, "computed_at")
	require.Contains(t, batch, "age_seconds")
	batch["computed_at"] = exampleComputedAt.UTC().Format(time.RFC3339)
	batch["age_seconds"] = exampleAgeSeconds(t, exampleServedAt, batch["computed_at"])

	sweeps := 0
	for _, w := range asList(t, batch["watermarks"]) {
		m := asMap(t, w)
		sweep, ok := m["sweep"].(map[string]any)
		if !ok {
			continue
		}
		require.Contains(t, sweep, "age_seconds")
		require.Contains(t, sweep, "max_updated_at",
			"the sweep's age is DERIVED from its own stamp, so a stamp-less sweep cannot be normalized")
		sweep["age_seconds"] = exampleAgeSeconds(t, exampleServedAt, sweep["max_updated_at"])
		sweeps++
	}
	require.Equal(t, 1, sweeps,
		"the example's book carries exactly one sweep stamp; normalizing a different number of them means the book moved")
}

// setRunExampleProbedAt is the instant the contract's example states its
// freshness probe was taken at. It is a FREE ANCHOR like `served_at` — the probe
// is a second, later reading of the database clock, taken after the arithmetic —
// and the two seconds between them are the example's own statement that the
// arithmetic took time. Nothing is derived from it except the coherence check
// `resolved_at <= probed_at`.
var setRunExampleProbedAt = exampleServedAt.Add(2 * time.Second)

// bigOf parses a served decimal string.
func bigOf(t *testing.T, v any) *big.Int {
	t.Helper()
	s, ok := v.(string)
	require.True(t, ok, "expected an exact decimal string, got %T", v)
	n, ok := new(big.Int).SetString(s, 10)
	require.True(t, ok, "not an exact integer: %q", s)
	return n
}

func intOf(t *testing.T, v any) int {
	t.Helper()
	f, ok := v.(float64)
	require.True(t, ok, "expected a JSON number, got %T (%v)", v, v)
	return int(f)
}
