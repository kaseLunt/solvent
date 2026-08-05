package main

// The set-run's OPERATIONAL laws: freshness, withholding, named absence, the two
// movement counts and their denominator, the in-flight bound, the token charge,
// and the blast radius.

import (
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// srArmBookInterleave fires fn INSIDE the serving snapshot, between the batch
// resolution and the child reads. Everything it does is invisible to the rows
// already being read and VISIBLE to the freshness probe, which runs on the pool
// after the snapshot closes — which is exactly the window every law below needs.
func (f *apiFixture) srArmBookInterleave(t *testing.T, fn func()) *atomic.Bool {
	t.Helper()
	var fired atomic.Bool
	f.srv.bookInterleave = &atomic.Pointer[func()]{}
	hook := func() {
		fn()
		fired.Store(true)
	}
	f.srv.bookInterleave.Store(&hook)
	t.Cleanup(func() { f.srv.bookInterleave.Store(nil) })
	return &fired
}

// TestSetRunSupersessionMidComputeDisclosesAndDoesNotTear: a batch landing
// mid-compute is DISCLOSED and is never a refusal, and nothing leaks into the
// numbers.
func TestSetRunSupersessionMidComputeDisclosesAndDoesNotTear(t *testing.T) {
	f := newSetRunTwoChainFixture(t)
	n := f.batchID
	ids := []string{"eth_minus_30", "stable_depeg_0995_in_band"}

	// The answer over batch N ALONE, taken before anything else exists.
	baseline := f.srRun(t, http.StatusOK, ids...)
	require.Equal(t, float64(n), asMap(t, baseline["batch"])["id"])

	var newer int64
	fired := f.srArmBookInterleave(t, func() {
		id, err := f.store.WriteRiskBatch(f.ctx, srBatchWrite("set-run-superseded-2",
			fxAavePosition(), fxAaveRefused(), fxDMPosition(), fxDMRefused()))
		require.NoError(t, err)
		newer = id
	})

	out := f.srRun(t, http.StatusOK, ids...)
	require.True(t, fired.Load(), "the interleave never fired, so this test raced nothing")
	require.Greater(t, newer, n)

	// (a) THE RESOLVED BATCH IS N.
	require.Equal(t, float64(n), asMap(t, out["batch"])["id"])

	// (b) EVERY NUMBER IS BATCH N's. Resolution and every child read happen
	// inside ONE snapshot, so a materialization landing afterwards is invisible
	// to every row already in memory.
	normalizeSetRunServeTime(t, baseline)
	normalizeSetRunServeTime(t, out)
	baselineEval, outEval := asMap(t, baseline["evaluation"]), asMap(t, out["evaluation"])
	require.Equal(t, baseline["results"], out["results"], "a batch landing mid-compute leaked into the arithmetic")
	require.Equal(t, baseline["coverage"], out["coverage"])

	// (c) and (d) THE DISCLOSURE.
	require.Equal(t, freshnessStillNewest, baselineEval["freshness"])
	require.Equal(t, freshnessSuperseded, outEval["freshness"])
	require.Equal(t, float64(newer), outEval["newest_servable_batch_id"])
	require.Contains(t, outEval["note"].(string), "has SINCE MATERIALIZED")

	// (e) IT IS STILL A 200. Supersession mid-run is a disclosure, never a
	// refusal: discarding a correct measurement because the world moved is what
	// this surface refuses to do everywhere else.
	require.Equal(t, len(ids), intOf(t, outEval["scenarios_evaluated"]))
}

// TestSetRunFreshnessProbeIsOneStatementAndIsTotal drives all FOUR arms through
// the store, including the one no healthy deployment produces.
func TestSetRunFreshnessProbeIsOneStatementAndIsTotal(t *testing.T) {
	t.Run("still_newest", func(t *testing.T) {
		f := newSetRunTwoChainFixture(t)
		ev := asMap(t, f.srRun(t, http.StatusOK, "eth_minus_10")["evaluation"])
		require.Equal(t, freshnessStillNewest, ev["freshness"])
		require.Equal(t, float64(f.batchID), ev["newest_servable_batch_id"], "EQUAL exactly for still_newest")
	})

	t.Run("superseded", func(t *testing.T) {
		f := newSetRunTwoChainFixture(t)
		var newer int64
		f.srArmBookInterleave(t, func() {
			id, err := f.store.WriteRiskBatch(f.ctx, srBatchWrite("set-run-fresh-superseded",
				fxAavePosition(), fxAaveRefused(), fxDMPosition(), fxDMRefused()))
			require.NoError(t, err)
			newer = id
		})
		ev := asMap(t, f.srRun(t, http.StatusOK, "eth_minus_10")["evaluation"])
		require.Equal(t, freshnessSuperseded, ev["freshness"])
		require.Greater(t, intOf(t, ev["newest_servable_batch_id"]), int(f.batchID), "STRICTLY GREATER exactly for superseded")
		require.Equal(t, float64(newer), ev["newest_servable_batch_id"])
	})

	t.Run("none_servable", func(t *testing.T) {
		f := newSetRunTwoChainFixture(t)
		// The measured batch is PRUNED mid-request, with nothing to replace it.
		// The snapshot already holds every row, so the arithmetic is unaffected —
		// which is the point: the numbers are a real measurement of a batch that
		// WAS servable.
		f.srArmBookInterleave(t, func() {
			_, err := f.admin.Exec(f.ctx, `DELETE FROM risk_batches WHERE id = $1`, f.batchID)
			require.NoError(t, err)
		})
		out := f.srRun(t, http.StatusOK, "eth_minus_10")
		ev := asMap(t, out["evaluation"])
		require.Equal(t, freshnessNoneServable, ev["freshness"])
		require.Nil(t, ev["newest_servable_batch_id"],
			"NULL exactly in this arm — never 0 and never batch.id, the same shape and the same reason as "+
				"`BatchSupersededBody.current_batch_id`")
		require.Contains(t, ev["note"].(string), "NO batch satisfied the completeness predicate")
		require.Equal(t, float64(f.batchID), asMap(t, out["batch"])["id"], "the numbers still describe the batch measured")
	})

	t.Run("newest_is_older", func(t *testing.T) {
		f := newSetRunTwoChainFixture(t)
		older := f.batchID
		// A SECOND, newer complete batch. The request will resolve it, and the
		// seam then makes it INCOMPLETE while the older one remains servable —
		// `riskBatchCompleteConjuncts` re-checks the required stamp set at PROBE
		// time, so completeness is not a frozen property of a batch row.
		newer, err := f.store.WriteRiskBatch(f.ctx, srBatchWrite("set-run-fresh-older",
			fxAavePosition(), fxAaveRefused(), fxDMPosition(), fxDMRefused()))
		require.NoError(t, err)
		require.Greater(t, newer, older)

		f.srArmBookInterleave(t, func() {
			tag, err := f.admin.Exec(f.ctx,
				`DELETE FROM risk_batch_watermarks WHERE batch_id = $1 AND engine = $2`, newer, risk.DMEngine)
			require.NoError(t, err)
			require.EqualValues(t, 1, tag.RowsAffected())
		})

		out := f.srRun(t, http.StatusOK, "eth_minus_10")
		ev := asMap(t, out["evaluation"])
		require.Equal(t, float64(newer), asMap(t, out["batch"])["id"], "the request resolved the newer batch")
		require.Equal(t, freshnessNewestIsOlder, ev["freshness"])
		require.Equal(t, float64(older), ev["newest_servable_batch_id"], "STRICTLY LESS exactly for newest_is_older")
		note := ev["note"].(string)
		require.Contains(t, note, "OLDER")
		require.NotContains(t, note, "has SINCE MATERIALIZED",
			"THE SENTENCE THE THREE-ARM READING WOULD HAVE SERVED: an `otherwise` arm routes a LESSER id into "+
				"`superseded` and then claims a materialization about a batch that PREDATES the measurement")
	})

	// The two source-level halves — one statement, no default arm — live in
	// TestSetRunFreshnessProbeIsOneStatement and
	// TestSetRunFreshnessIsTotalAndHasNoDefaultArm, which need no database.
}

// TestSetRunWithheldEngineIsNamedAndNotZeroed: a withheld engine contributes NO
// row and NO zero, and the applied set narrows WITH IT rather than silently.
func TestSetRunWithheldEngineIsNamedAndNotZeroed(t *testing.T) {
	f := newP5Fixture(t)
	f.seedWithheldOverStandardBook(t, "set-run-withheld-1")

	out := f.srRun(t, http.StatusOK, "eth_minus_30", "weeth_rate_minus_5")
	res := srResults(t, out)["eth_minus_30"]

	require.Equal(t, []string{risk.AaveEngine}, srStrings(t, res["withheld_engines"]))
	excluded := asList(t, out["excluded_engines"])
	require.Len(t, excluded, 1)
	require.Equal(t, risk.AaveEngine, asMap(t, excluded[0])["engine"],
		"the code and detail live ONCE, on the shared array: withholding is a property of the BATCH, not of a scenario")

	require.NotContains(t, srEngines(t, res), risk.AaveEngine, "a withheld engine draws no row and no zero")
	for _, a := range asList(t, res["unmeasurable_engines"]) {
		require.NotEqual(t, risk.AaveEngine, asMap(t, a)["engine"],
			"withheld and unmeasurable are DIFFERENT facts and the three parts are pairwise disjoint")
	}

	census := srCensus(t, out)
	require.True(t, census[risk.AaveEngine]["withheld"].(bool))
	require.Equal(t, census[risk.AaveEngine]["measurable"], res["positions_withheld"],
		"the withheld engine's reconstructable positions are counted in `positions_withheld` and in NO number on any row")
	require.Positive(t, intOf(t, res["positions_withheld"]), "a vacuous withholding")
	sum := 0
	for _, e := range srEngines(t, res) {
		sum += intOf(t, e["accounts"])
	}
	require.Equal(t, sum, intOf(t, res["positions_answered"]))

	// THE APPLIED SET IS A STRICT SUBSET, and the note says so rather than
	// leaving it to be discovered. The single route filters only on
	// `covers(sc.Engines, p.Engine)` and drops the withheld ROW later, so its
	// pass sees the withheld engine's positions; the set-run's union excludes
	// them.
	single := f.postJSON(t, "/v1/scenarios/eth_minus_30/run-book", runBookContractPath, http.StatusOK)
	setKeys := map[string]bool{}
	for _, a := range asList(t, asMap(t, res["shock_reach"])["applied_shocks"]) {
		setKeys[asMap(t, a)["asset"].(string)+"|"+strconv.Itoa(intOf(t, asMap(t, a)["chain_id"]))] = true
	}
	singleKeys := map[string]bool{}
	for _, a := range asList(t, single["applied_shocks"]) {
		singleKeys[asMap(t, a)["asset"].(string)+"|"+strconv.Itoa(intOf(t, asMap(t, a)["chain_id"]))] = true
	}
	for k := range setKeys {
		require.True(t, singleKeys[k], "the set-run applied %s and the single route did not — it must be a SUBSET", k)
	}
	require.Less(t, len(setKeys), len(singleKeys),
		"on THIS fixture the subset must be STRICT: the withheld Aave book prices weETH on chain 1, which "+
			"eth_minus_30's matrix describes, so the single route applies a mark the set-run does not")
	require.Contains(t, res["note"].(string), "WITHHELD ON THIS BATCH")
	require.Contains(t, res["note"].(string), "strict SUBSET")

	// A SCENARIO ALL OF WHOSE COVERED ENGINES ARE WITHHELD still counts.
	f.srInject(t, risk.Scenario{
		ID: "sr_aave_only_harmless", Version: "v1",
		Label: "seeded: Aave-only", Description: "seeded fixture",
		PathAssumption: "seeded fixture: an Aave-only definition, so a withheld Aave book leaves it nothing to answer",
		Engines:        []string{risk.AaveEngine},
		Shocks:         []risk.Shock{{Axis: risk.AxisETHUSD, FactorNum: 90, FactorDen: 100}},
		Propagation: []risk.AssetResponse{{
			Asset: fxWeETHEth.Hex(), ChainID: fxETHChain, Symbol: "weETH",
			RespondsTo: []risk.AxisRef{{Axis: risk.AxisETHUSD}},
		}},
		OutOfModel: []string{"seeded fixture for the all-covered-engines-withheld case"},
	})
	out2 := f.srRun(t, http.StatusOK, "sr_aave_only_harmless")
	res2 := srResults(t, out2)["sr_aave_only_harmless"]
	require.Empty(t, asList(t, res2["engines"]), "engines: [] — it draws no bar and says why")
	require.Equal(t, []string{risk.AaveEngine}, srStrings(t, res2["withheld_engines"]))
	require.Equal(t, 1, intOf(t, asMap(t, out2["evaluation"])["scenarios_evaluated"]),
		"it WAS evaluated and it counts — an absence, never a zero")
	require.Contains(t, res2["note"].(string), "NO ANSWERABLE ENGINE")
}

// TestSetRunUnmeasurableEngineIsNamedAndNotZeroed is the ABSENCE law, in three
// fixtures — and with a NEGATIVE CONTROL against the single-scenario route, so
// the divergence is recorded rather than accidental.
func TestSetRunUnmeasurableEngineIsNamedAndNotZeroed(t *testing.T) {
	requireAbsence := func(t *testing.T, out map[string]any, id, engine, reason string) wireSetRunAbsenceCounts {
		t.Helper()
		res := srResults(t, out)[id]
		require.NotContains(t, srEngines(t, res), engine,
			"an engine with zero measurable accounts must NOT be a numeric row: every before_*, every delta and the "+
				"DENOMINATOR would read \"0\" under a census claiming coverage")
		var found *map[string]any
		for _, a := range asList(t, res["unmeasurable_engines"]) {
			m := asMap(t, a)
			if m["engine"] == engine {
				found = &m
			}
		}
		require.NotNil(t, found, "%s is covered, not withheld and unmeasurable, and is named nowhere", engine)
		require.Equal(t, reason, (*found)["reason"])
		counts := asMap(t, (*found)["counts"])
		require.NotEmpty(t, (*found)["note"])
		return wireSetRunAbsenceCounts{
			PositionsInBatch: intOf(t, counts["positions_in_batch"]),
			RefusedInBatch:   intOf(t, counts["refused_in_batch"]),
			Unrebuildable:    intOf(t, counts["unrebuildable"]),
		}
	}

	t.Run("(a) every position refused in batch", func(t *testing.T) {
		f := newBareAPIFixture(t)
		f.seedP5Events(t)
		f.seedSubstrate(t)
		f.seedP5ParamHistory(t)
		f.srSeed(t, srCountedBatchWrite("set-run-all-refused", fxAaveRefused(), fxDMRefused()))
		f.seedP5Headers(t)
		f.startServerWithFeeds(t, fxP5Feeds())
		f.srv.evidence = p5EvidenceStatics(t)

		out := f.srRun(t, http.StatusOK, "eth_minus_10")
		for _, engine := range []string{risk.AaveEngine, risk.DMEngine} {
			c := requireAbsence(t, out, "eth_minus_10", engine, absenceAllRefused)
			require.Equal(t, 1, c.PositionsInBatch)
			require.Equal(t, 1, c.RefusedInBatch)
			require.Equal(t, 0, c.Unrebuildable)
		}
		cov := asMap(t, out["coverage"])
		require.Equal(t, 0, intOf(t, cov["in_book"]))
		require.False(t, cov["book_is_measurable"].(bool),
			"`book_is_measurable` is false when in_book == 0. It deliberately does not reuse "+
				"`stress_coverage_is_full`, whose computation does not consider that case and reads GREEN over a batch "+
				"whose positions are ALL refused")

		// THE NEGATIVE CONTROL: the single-scenario route STILL serves the
		// all-zero row on this very book. The difference is deliberate and it is
		// recorded here rather than discovered later.
		single := f.postJSON(t, "/v1/scenarios/eth_minus_10/run-book", runBookContractPath, http.StatusOK)
		zeros := 0
		for _, e := range asList(t, single["engines"]) {
			m := asMap(t, e)
			if asMap(t, m["before"])["total_debt_usd"] == "0" && m["eligible_debt_delta_usd"] == "0" {
				zeros++
			}
		}
		require.Positive(t, zeros,
			"the single-scenario route is expected to still serve an all-zero engine row over an unmeasurable book. "+
				"That is a standing hazard on THAT route, recorded here as a deliberate divergence rather than fixed by "+
				"accident: closing it there changes what an existing required field means and needs its own wave.")
		require.True(t, asMap(t, single["coverage"])["stress_coverage_is_full"].(bool),
			"and it reads GREEN over that book, which is exactly why the set-run's census does not reuse the predicate")
	})

	t.Run("(b) a covered engine with zero positions in the batch", func(t *testing.T) {
		f := newBareAPIFixture(t)
		f.seedP5Events(t)
		f.seedSubstrate(t)
		f.seedP5ParamHistory(t)
		f.srSeed(t, srCountedBatchWrite("set-run-no-aave-rows", fxDMPosition(), fxDMRefused()))
		f.seedP5Headers(t)
		f.startServerWithFeeds(t, fxP5Feeds())
		f.srv.evidence = p5EvidenceStatics(t)

		out := f.srRun(t, http.StatusOK, "eth_minus_10")
		c := requireAbsence(t, out, "eth_minus_10", risk.AaveEngine, absenceNoPositions)
		require.Equal(t, wireSetRunAbsenceCounts{}, c, "no positions, so no refusals and nothing unrebuildable")
		require.Contains(t, srEngines(t, srResults(t, out)["eth_minus_10"]), risk.DMEngine,
			"the OTHER engine answers normally — an absence law that suppressed everything would prove nothing")
	})

	// breakAave moves the persisted VERDICT so the recomputation disagrees with
	// the row. The position stays `computed`, so `reconstructAll` ATTEMPTS it and
	// records a reconstruction error — the third census class, and a different one
	// from a batch refusal.
	breakAave := func(t *testing.T, f *apiFixture) {
		t.Helper()
		tag, err := f.admin.Exec(f.ctx,
			`UPDATE risk_positions SET hf_wad = hf_wad + 1 WHERE batch_id = $1 AND engine = $2 AND status = $3`,
			f.batchID, risk.AaveEngine, store.RiskPositionComputed)
		require.NoError(t, err)
		require.EqualValues(t, 1, tag.RowsAffected())
	}

	t.Run("(c) a covered engine whose positions all fail reconstruction", func(t *testing.T) {
		f := newBareAPIFixture(t)
		f.seedP5Events(t)
		f.seedSubstrate(t)
		f.seedP5ParamHistory(t)
		// The ONLY Aave row is the computed one, so breaking it leaves the engine
		// wholly unrebuildable and the single-cause reason is the honest one.
		f.srSeed(t, srCountedBatchWrite("set-run-all-unrebuildable",
			fxAavePosition(), fxDMPosition(), fxDMRefused()))
		f.seedP5Headers(t)
		f.startServerWithFeeds(t, fxP5Feeds())
		f.srv.evidence = p5EvidenceStatics(t)
		breakAave(t, f)

		out := f.srRun(t, http.StatusOK, "eth_minus_10")
		c := requireAbsence(t, out, "eth_minus_10", risk.AaveEngine, absenceAllUnrebuild)
		require.Equal(t, 1, c.PositionsInBatch)
		require.Equal(t, 0, c.RefusedInBatch)
		require.Equal(t, 1, c.Unrebuildable)
		cov := asMap(t, out["coverage"])
		require.Equal(t, 1, intOf(t, cov["excluded_by_this_layer"]))
		require.Len(t, asList(t, cov["excluded"]), 1, "and the row is NAMED, per account, in `excluded`")
		require.False(t, cov["book_is_measurable"].(bool))
		require.Contains(t, srEngines(t, srResults(t, out)["eth_minus_10"]), risk.DMEngine,
			"the OTHER engine answers normally")
	})

	t.Run("mixed causes get the mixed reason", func(t *testing.T) {
		// One Aave row refused by the batch and one this layer cannot rebuild:
		// neither cause accounts for the whole engine, so neither single-cause
		// reason may be published and the counts are what carry the split.
		f := newBareAPIFixture(t)
		f.seedP5Events(t)
		f.seedSubstrate(t)
		f.seedP5ParamHistory(t)
		f.srSeed(t, srCountedBatchWrite("set-run-mixed",
			fxAavePosition(), fxAaveRefused(), fxDMPosition(), fxDMRefused()))
		f.seedP5Headers(t)
		f.startServerWithFeeds(t, fxP5Feeds())
		f.srv.evidence = p5EvidenceStatics(t)
		breakAave(t, f)

		out := f.srRun(t, http.StatusOK, "eth_minus_10")
		c := requireAbsence(t, out, "eth_minus_10", risk.AaveEngine, absenceMixedNoMeasure)
		require.Equal(t, 2, c.PositionsInBatch)
		require.Equal(t, 1, c.RefusedInBatch)
		require.Equal(t, 1, c.Unrebuildable)
	})
}

// ---------------------------------------------------------------------------
// The two movement counts, and the denominator they answer to
// ---------------------------------------------------------------------------

// srAaveNoDebtPosition is a debt-free Aave account: collateral only, so its
// health factor is UNBOUNDED rather than large. It is the population
// `runBookMovers` cannot test at all on Aave.
func srAaveNoDebtPosition(account common.Address) *positionRow {
	return &positionRow{
		Engine: risk.AaveEngine, Account: account.Bytes(), Status: store.RiskPositionComputed,
		Flags: []string{}, ValueDecimals: 8,
		HFInfinite:          true,
		Liquidatable:        boolp(false),
		TotalCollateralBase: bi(fxAaveWeETHCollBse),
		TotalDebtBase:       bi("0"),
		WeightedLTSum:       bi(fxAaveWeightedLTSum),
		AvgLTBps:            bi(fxAaveAvgLTBps),
		BalancesBlock:       fxAaveBlock, ParamsBlock: fxAaveParamBlock,
		OldestPriceInput: timep(fxBase.Add(-time.Duration(fxAaveWeETHAge) * time.Second)),
		StalePriceInputs: true,
		Legs: []legRow{{
			Engine: risk.AaveEngine, Account: account.Bytes(), Asset: fxWeETHEth.Bytes(), Decimals: 18,
			LiveCollateral: bi(fxAaveWeETHAmount), CollateralBase: bi(fxAaveWeETHCollBse),
			WeightedLT: bi(fxAaveWeightedLTSum), LiveDebt: bi("0"), DebtBase: bi("0"),
			UsedAsCollateral: boolp(true), CollateralIndexBlock: u64p(fxAaveBlock),
			LiqThreshold: bi(fxAaveLTBps), LiqBonus: bi(fxAaveBonusBps),
		}},
		Prices: []store.RiskBatchPriceInput{{
			Engine: risk.AaveEngine, Account: account.Bytes(), Asset: fxWeETHEth.Bytes(),
			ChainID: int64(fxETHChain), Source: fxAaveSource, Provenance: risk.ProvenanceAdapterOutput,
			Value: bi(fxAaveWeETHPrice), Decimals: i16p(8), BlockNumber: i64p(fxAavePriceBlock),
			SourceAsOf:    timep(fxBase.Add(-time.Duration(fxAaveWeETHAge) * time.Second)),
			BudgetSeconds: fxPriceBudgetSecs, Verdict: riskfeed.VerdictStale, AgeSeconds: i64p(fxAaveWeETHAge),
		}},
	}
}

// srDMFlipPosition is a Debt Manager account that is HEALTHY at par and becomes
// eligible under a 10 percent weETH shock: maxBorrowLT 3200000000 at par against
// borrowings 3000000000, and 2880000000 after.
func srDMFlipPosition() *positionRow {
	const borrowings = "3000000000"
	p := fxDMPosition()
	p.Account = fxAcctDMDebt.Bytes()
	p.HFDen = bi(borrowings)
	p.Borrowings = bi(borrowings)
	p.Liquidatable = boolp(false)
	for i := range p.Legs {
		p.Legs[i].Account = fxAcctDMDebt.Bytes()
		if p.Legs[i].LiveDebt != nil {
			p.Legs[i].ScaledDebt, p.Legs[i].LiveDebt = bi(borrowings), bi(borrowings)
		}
	}
	for i := range p.Prices {
		p.Prices[i].Account = fxAcctDMDebt.Bytes()
	}
	return p
}

// srBigAaveCollateralPosition is an Aave account whose health factor DROPS under
// a 10 percent shock without crossing into eligibility: 4 weETH of collateral
// against the standing debt gives 2.16 at par and 1.944 after.
func srBigAaveCollateralPosition() *positionRow {
	p := fxAavePosition()
	const (
		amount = "4000000000000000000"
		collat = "1600000000000"
		wlt    = "12960000000000000"
	)
	p.TotalCollateralBase = bi(collat)
	p.WeightedLTSum = bi(wlt)
	p.HFNum = bi(wlt)
	p.HFWad = bi("2160000000000000000")
	for i := range p.Legs {
		if p.Legs[i].UsedAsCollateral != nil && *p.Legs[i].UsedAsCollateral {
			p.Legs[i].LiveCollateral = bi(amount)
			p.Legs[i].CollateralBase = bi(collat)
			p.Legs[i].WeightedLT = bi(wlt)
		}
	}
	return p
}

// TestSetRunMovementCountIsEngineCorrect is the designed-mutant kill for the
// mislabelled-count defect: a summary that fills `flipped_to_eligible` from
// `movers_total` on Aave fails here.
func TestSetRunMovementCountIsEngineCorrect(t *testing.T) {
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	w := srBatchWrite("set-run-movement-1",
		srBigAaveCollateralPosition(), fxAaveRefused(), srDMFlipPosition(), fxDMRefused())
	w.Aggregates[0].TotalCollateral = bi("1600000000000")
	w.Aggregates[1].TotalDebt = bi("3000000000")
	w.Aggregates[1].LiquidatablePositions = 0
	f.srSeed(t, w)
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)

	res := srResults(t, f.srRun(t, http.StatusOK, "eth_minus_10"))["eth_minus_10"]
	engines := srEngines(t, res)

	aave := engines[risk.AaveEngine]
	require.NotNil(t, aave)
	require.Equal(t, movementHFStrictlyDropped, aave["movement_rule"])
	require.Equal(t, float64(1), aave["hf_dropped_accounts"],
		"the account's health factor STRICTLY DROPPED (2.16 -> 1.944) and it never entered eligibility")
	require.Nil(t, aave["flipped_to_eligible"],
		"Aave does not speak eligibility flips: `runBookMovers` has NO eligibility test in its Aave branch at all, so a "+
			"count published under that name would assert something the arithmetic never computed")
	require.Equal(t, 0, intOf(t, aave["eligible_accounts_delta"]), "and it did NOT become eligible")

	dm := engines[risk.DMEngine]
	require.NotNil(t, dm)
	require.Equal(t, movementEligibilityFlip, dm["movement_rule"])
	require.Equal(t, float64(1), dm["flipped_to_eligible"], "the DM account flipped false -> true")
	require.Nil(t, dm["hf_dropped_accounts"], "the Debt Manager has no health-factor wad")
	require.Equal(t, 1, intOf(t, dm["eligible_accounts_delta"]))

	// EXACTLY ONE of the two is non-null on EVERY engine row of EVERY result.
	// Never both, never neither.
	for _, id := range []string{"eth_minus_10"} {
		for engine, sum := range srEngines(t, srResults(t, f.srRun(t, http.StatusOK, id))[id]) {
			hf, flip := sum["hf_dropped_accounts"], sum["flipped_to_eligible"]
			require.True(t, (hf == nil) != (flip == nil),
				"%s/%s: exactly one movement count is non-null, selected by `movement_rule`", id, engine)
		}
	}
}

// TestSetRunMovementCountPublishesItsDenominator is the QUIET-ZERO law for the
// count itself.
//
// `hf_dropped_accounts: 0` beside `accounts: 5` reads as "none of 5 health
// factors dropped" when the truth is "4 of the 5 carry no health factor at all".
// The designed mutant — dropping either the field or the clause — serves "0 of
// 46" on this deployment's Aave side.
func TestSetRunMovementCountPublishesItsDenominator(t *testing.T) {
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)

	const m = 5
	positions := []*positionRow{fxAavePosition()}
	for i := 1; i < m; i++ {
		positions = append(positions, srAaveNoDebtPosition(
			common.HexToAddress("0x0000000000000000000000000000000000000A0"+strconv.Itoa(i))))
	}
	positions = append(positions, fxDMPosition())
	w := srBatchWrite("set-run-denominator-1", positions...)
	w.Aggregates[0].Positions, w.Aggregates[0].ComputedPositions, w.Aggregates[0].RefusedPositions = m, m, 0
	w.Aggregates[1].Positions, w.Aggregates[1].ComputedPositions, w.Aggregates[1].RefusedPositions = 1, 1, 0
	f.srSeed(t, w)
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)

	// A scenario covering BOTH engines that moves NO oracle mark, so the one
	// indebted Aave account's health factor does not drop.
	res := srResults(t, f.srRun(t, http.StatusOK, "weeth_market_depeg_oracles_held"))["weeth_market_depeg_oracles_held"]
	engines := srEngines(t, res)

	aave := engines[risk.AaveEngine]
	require.NotNil(t, aave)
	require.Equal(t, float64(0), aave["hf_dropped_accounts"])
	require.Equal(t, m, intOf(t, aave["accounts"]))
	require.Equal(t, m-1, intOf(t, aave["infinite_accounts"]), "M-1 accounts carry NO DEBT, so no health factor at all")
	require.Equal(t, m-1, intOf(t, aave["movement_excluded_accounts"]),
		"so the 0 is visibly out of a denominator of ONE, never out of M")

	note := aave["note"].(string)
	// ALL FIVE MANDATED CLAUSES.
	require.Contains(t, note, "8-decimal USD", "1: this engine's decimals")
	require.Contains(t, note, "`movement_rule` is hf_strictly_dropped", "2: the movement rule")
	require.Contains(t, note, runBookAaveExclusionClause,
		"3: the EXCLUDED POPULATION, in the single route's OWN words. A paraphrase here would be a second definition of "+
			"the same exclusion, and the sentence exists precisely to prevent a quiet zero.")
	require.Contains(t, note, "THE SANCTIONED DENOMINATOR is `total_debt_usd_before`", "4: the denominator")
	require.Contains(t, note, "COLLATERAL AT RISK is served as TWO SIDES", "5: the at-risk warning")
	require.Contains(t, note, "5 minus 4 = 1", "and the denominator is stated as arithmetic rather than left to be done")

	// The same sentence really is the single route's, welded rather than assumed.
	require.Contains(t, runBookMoversNote(risk.AaveEngine, 0, 0, 8), runBookAaveExclusionClause)

	dm := engines[risk.DMEngine]
	require.NotNil(t, dm)
	require.Equal(t, 0, intOf(t, dm["movement_excluded_accounts"]),
		"on the Debt Manager the flip is testable for every measured account, so the count's denominator IS `accounts`")
	require.Equal(t, float64(0), dm["flipped_to_eligible"], "and its zero is a REAL zero, out of a denominator of 1")
	require.Equal(t, 1, intOf(t, dm["accounts"]))
	require.Contains(t, dm["note"].(string), runBookDMExclusionClause)
}

// ---------------------------------------------------------------------------
// Concurrency, cost, and blast radius
// ---------------------------------------------------------------------------

// TestSetRunInFlightBoundRefusesWith503AndNeverLeaksASlot.
func TestSetRunInFlightBoundRefusesWith503AndNeverLeaksASlot(t *testing.T) {
	t.Run("the overflow is refused immediately, with its own code and NO Retry-After", func(t *testing.T) {
		f := newP5Fixture(t)
		f.srv.setRuns = newSetRunGate(1)
		release := f.srHoldOneSlot(t)
		defer release()

		start := time.Now()
		status, header, raw := f.srPostHeaders(t, srBody("eth_minus_10", "eth_minus_20"))
		require.Equal(t, http.StatusServiceUnavailable, status, "body: %s", truncate(raw))
		require.Less(t, time.Since(start), 20*time.Second, "the refusal must be IMMEDIATE, never queued")
		validateContractMethod(t, setRunContractPath, http.MethodPost, http.StatusServiceUnavailable, raw)

		body := string(raw)
		require.Contains(t, body, `"code":"set_run_busy"`)
		require.Contains(t, body, `"max_in_flight":1`)
		require.Contains(t, body, `"in_flight":1`)
		require.Empty(t, header.Get("Retry-After"),
			"NO Retry-After on this refusal. The limiter's instant is a TOKEN BUCKET's refill time; a semaphore has no "+
				"such instant, because the holder may have seconds of arithmetic left and this goroutine does not know "+
				"it. No retry time is offered rather than one invented.")
		require.Contains(t, body, "about nothing in the book",
			"the message must say this is about the EVALUATOR's capacity — a bare 503 is indistinguishable from an empty book")
	})

	t.Run("(a) the 503 for no servable batch releases the slot", func(t *testing.T) {
		f := newP5Fixture(t)
		f.srv.setRuns = newSetRunGate(1)
		// `errNoBatch` is raised INSIDE readBatchAccounts, which is AFTER the
		// acquire. That is the leak path, and a slot leaked there is leaked for
		// the life of the process — the second leak takes the deployment to zero
		// capacity permanently.
		_, err := f.admin.Exec(f.ctx, `DELETE FROM risk_batches`)
		require.NoError(t, err)

		status, raw := f.srPost(t, srBody("eth_minus_10"))
		require.Equal(t, http.StatusServiceUnavailable, status)
		require.Contains(t, string(raw), `"code":"unavailable"`,
			"this 503 is about the BOOK and it is structurally distinguishable from the busy one")
		require.Equal(t, 0, f.srv.setRuns.gauge(), "the slot must be released on the no-batch path")

		status, raw = f.srPost(t, srBody("eth_minus_10"))
		require.Equal(t, http.StatusServiceUnavailable, status)
		require.Contains(t, string(raw), `"code":"unavailable"`,
			"a subsequent set-run is ADMITTED (it reaches the batch read and answers about the book) rather than "+
				"refused `set_run_busy` by a slot nobody ever gave back")
	})

	t.Run("(b) the 500 for an arithmetic refusal releases the slot", func(t *testing.T) {
		f := newP5Fixture(t)
		f.srv.setRuns = newSetRunGate(1)
		_, err := f.admin.Exec(f.ctx,
			`UPDATE risk_positions SET status = 'compute' WHERE batch_id = $1 AND status = $2`,
			f.batchID, store.RiskPositionRefused)
		require.NoError(t, err)

		status, _ := f.srPost(t, srBody("eth_minus_10"))
		require.Equal(t, http.StatusInternalServerError, status)
		require.Equal(t, 0, f.srv.setRuns.gauge())
		status, _ = f.srPost(t, srBody("eth_minus_10"))
		require.Equal(t, http.StatusInternalServerError, status, "still refused for the SAME reason, not for busyness")
	})

	t.Run("(c) a panic inside the arithmetic releases the slot", func(t *testing.T) {
		f := newP5Fixture(t)
		f.srv.setRuns = newSetRunGate(1)
		f.srArmInterleave(func() { panic("seeded panic inside the set-run arithmetic") })
		status, _ := f.srPost(t, srBody("eth_minus_10"))
		require.Equal(t, http.StatusInternalServerError, status)
		f.srArmInterleave(nil)
		require.Equal(t, 0, f.srv.setRuns.gauge(),
			"the release is a `defer` established immediately after a successful acquire, so it runs on a panic too")
		f.srRun(t, http.StatusOK, "eth_minus_10")
	})

	t.Run("(d) the normal 200 releases the slot", func(t *testing.T) {
		f := newP5Fixture(t)
		f.srv.setRuns = newSetRunGate(1)
		for i := 0; i < 3; i++ {
			f.srRun(t, http.StatusOK, "eth_minus_10")
			require.Equal(t, 0, f.srv.setRuns.gauge())
		}
	})

	t.Run("the 400 and 429 paths never take a slot at all", func(t *testing.T) {
		// THE PRECONDITION FORM. Asserting a release on these paths is vacuous —
		// nothing is acquired — so the checkable claim is that the gauge never
		// ROSE. Every slot is held, so a request that TRIED to acquire would be
		// refused 503 busy instead of what it actually gets.
		f := newP5Fixture(t)
		f.srv.setRuns = newSetRunGate(1)
		release := f.srHoldOneSlot(t)
		defer release()

		status, _ := f.srPost(t, `{"scenario_ids":[]}`)
		require.Equal(t, http.StatusBadRequest, status, "the 400 is answered while every slot is held")

		// The 429, refused by the HANDLER charge — which happens after validation
		// and BEFORE the acquire. A burst of exactly 2 against a three-scenario
		// request: the middleware's one token is admitted and the handler's
		// remaining two are not.
		f.srv.limiter = newIPLimiter(1, 2, time.Minute)
		frozen := time.Now()
		f.srv.limiter.now = func() time.Time { return frozen }
		status, header, raw := f.srPostHeaders(t, srBody("eth_minus_10", "eth_minus_20", "eth_minus_30"))
		require.Equal(t, http.StatusTooManyRequests, status, "body: %s", truncate(raw))
		require.Contains(t, string(raw), "a set-run costs 1 token per scenario",
			"this 429 is the HANDLER's charge, which is what proves the charge precedes the acquire")
		require.NotEmpty(t, header.Get("Retry-After"), "a TOKEN BUCKET does compute when it refills, so this one is served")
		require.Equal(t, 1, f.srv.setRuns.gauge(), "the gauge never rose above the one slot the parked request holds")
	})
}

// TestSetRunTokenChargeIsPerScenario: the limiter counts REQUESTS, so a set-run
// pays one token per scenario or a cost-blind bucket lets one client turn the
// burst into 24 times as many book evaluations.
func TestSetRunTokenChargeIsPerScenario(t *testing.T) {
	all := []string{
		"btc_leg_minus_20", "dm_composition_census", "dm_rate_horizon_plus_200bps",
		"eth_minus_10", "eth_minus_20", "eth_minus_30", "eth_minus_40", "eth_minus_50",
		"eth_minus_60", "ethfi_minus_50", "stable_depeg_098_unsnapped",
		"stable_depeg_0995_in_band", "stable_depeg_099_boundary",
		"weeth_market_depeg_oracles_held", "weeth_rate_minus_5",
	}
	require.Len(t, all, 15)

	t.Run("burst 40 admits two 15-scenario runs and refuses the third", func(t *testing.T) {
		f := newP5Fixture(t)
		// THE CLOCK IS FROZEN through the limiter's existing seam, so no refill
		// can occur and the arithmetic below is exact rather than approximate.
		f.srv.limiter = newIPLimiter(defaultRateLimit, defaultRateBurst, time.Minute)
		frozen := time.Now()
		f.srv.limiter.now = func() time.Time { return frozen }

		// 2 middleware tokens + 28 handler tokens = 30 of 40.
		f.srRun(t, http.StatusOK, all...)
		f.srRun(t, http.StatusOK, all...)

		status, header, raw := f.srPostHeaders(t, srBody(all...))
		require.Equal(t, http.StatusTooManyRequests, status,
			"the third 15-scenario run costs 45 tokens against a burst of 40 and must be refused")
		require.NotEmpty(t, header.Get("Retry-After"))
		body := string(raw)
		require.Contains(t, body, `"code":"rate_limited"`,
			"THE 429 IS `ErrorBody`, structurally distinct from the 503 busy body — the two refusals cannot be confused "+
				"by a client or in a log")
		require.NotContains(t, body, "max_in_flight")
		require.Contains(t, body, "a set-run costs 1 token per scenario",
			"the message names the per-scenario cost, so a client is not puzzled by a FIRST request being refused")
		require.Contains(t, body, "This request asked for 15.")
	})

	t.Run("a 400 costs exactly one token, not N", func(t *testing.T) {
		f := newP5Fixture(t)
		// A burst of exactly 2. If the malformed request cost N the single-id run
		// below would be refused.
		f.srv.limiter = newIPLimiter(defaultRateLimit, 2, time.Minute)
		frozen := time.Now()
		f.srv.limiter.now = func() time.Time { return frozen }

		status, _ := f.srPost(t, srBody(append(append([]string{}, all...), all...)...))
		require.Equal(t, http.StatusBadRequest, status, "duplicates: refused on shape, before the second charge")

		f.srRun(t, http.StatusOK, "eth_minus_10")
		status, _ = f.srPost(t, srBody("eth_minus_10"))
		require.Equal(t, http.StatusTooManyRequests, status,
			"the bucket held exactly two tokens: one spent by the malformed request's MIDDLEWARE charge and one by the "+
				"valid single-scenario run. If the malformed request had cost N, the valid run would have been refused "+
				"instead — and it did no compute, so N would have been a charge for nothing.")
	})

	t.Run("the startup check refuses a burst below the cap", func(t *testing.T) {
		// `ReserveN` returns `!res.OK()` when n exceeds the burst, so an operator
		// who lowers the burst makes a LEGAL request permanently unservable with a
		// 429 carrying no meaningful retry instant. That is said at boot.
		lim := newIPLimiter(defaultRateLimit, maxSetRunScenarios-1, time.Minute)
		ok, wait := lim.allowN("k", maxSetRunScenarios)
		require.False(t, ok)
		require.Zero(t, wait, "a bucket that can NEVER admit the request promises no retry — which is why boot must refuse it")

		require.GreaterOrEqual(t, defaultRateBurst, maxSetRunScenarios*setRunTokenCostPerScenario,
			"the shipped defaults must satisfy the config invariant")

		require.NoError(t, setRunBurstInvariant(defaultRateBurst))
		require.NoError(t, setRunBurstInvariant(maxSetRunScenarios*setRunTokenCostPerScenario))
		err := setRunBurstInvariant(10)
		require.Error(t, err, "a burst below the set-run cap must FAIL FAST at boot")
		require.Contains(t, err.Error(), "below the set-run cap")
		require.Contains(t, err.Error(), "SOLVENT_API_RATE_BURST")

		// And it really is the BOOT check, not a function nobody calls: the
		// configuration loader's only rate-burst guard is this one.
		require.Contains(t, srFuncSource(t, "main.go", "loadServerConfig"), "setRunBurstInvariant(sc.RateBurst)",
			"loadServerConfig must apply the invariant — a config check the composition root does not run is a comment")
	})
}

// TestSetRunBlastRadiusIsOnlyIf: the property is a ONE-WAY implication, scoped
// to arithmetic, and the fixture that would prove a biconditional does not
// exist.
func TestSetRunBlastRadiusIsOnlyIf(t *testing.T) {
	// A definition whose propagation row declares `stable_snap` on an EIGHT
	// DECIMAL Aave mark. `ApplyScenario` refuses that outright — the snap band is
	// defined at 1e6 — and a refusal there is classified by the existing handler
	// as "a defect in this layer, not a property of the data", which is a 500.
	aaveDefect := risk.Scenario{
		ID: "sr_aave_defect", Version: "v1",
		Label: "seeded: an Aave-covering definition this layer refuses to apply", Description: "seeded fixture",
		PathAssumption: "seeded fixture: the propagation row demands a 6-decimal price and the Aave mark is 8-decimal",
		Engines:        []string{risk.AaveEngine},
		Shocks:         []risk.Shock{{Axis: risk.AxisStableUSD, Asset: fxWeETHEth.Hex(), FactorNum: 99, FactorDen: 100}},
		Propagation: []risk.AssetResponse{{
			Asset: fxWeETHEth.Hex(), ChainID: fxETHChain, Symbol: "weETH",
			RespondsTo: []risk.AxisRef{srAxis(risk.AxisStableUSD, fxWeETHEth)},
			StableSnap: true,
		}},
		OutOfModel: []string{"seeded fixture for the arithmetic-refusal blast radius"},
	}

	t.Run("(a) a defect on an engine no requested scenario covers does not refuse the set", func(t *testing.T) {
		f := newP5Fixture(t)
		f.srInject(t, aaveDefect)

		// A DM-only set over a book carrying the defective Aave position: 200.
		// Measuring the WHOLE book would let that position refuse a set-run that
		// N single runs would each have served.
		out := f.srRun(t, http.StatusOK, "stable_depeg_0995_in_band", "btc_leg_minus_20")
		require.Len(t, asList(t, out["results"]), 2)

		// Request the scenario that DOES cover it: 500.
		status, raw := f.srPost(t, srBody("sr_aave_defect"))
		require.Equal(t, http.StatusInternalServerError, status, "body: %s", truncate(raw))
		require.Contains(t, string(raw), `"code":"internal"`)

		// And the single-scenario endpoint 500s for the same scenario, so the set
		// refused only because a member would have refused alone.
		status, _ = f.post(t, "/v1/scenarios/sr_aave_defect/run-book")
		require.Equal(t, http.StatusInternalServerError, status)
	})

	t.Run("(b) the WITHHELD asymmetry, recorded rather than papered over", func(t *testing.T) {
		f := newP5Fixture(t)
		f.seedWithheldOverStandardBook(t, "set-run-blast-withheld")
		f.srInject(t, aaveDefect)

		// THE SINGLE ROUTE 500s: it filters only on `covers(sc.Engines, p.Engine)`
		// and drops the withheld ROW later, so the defective position reaches
		// `measureRunBook` and `risk.Waterfall` first.
		status, raw := f.post(t, "/v1/scenarios/sr_aave_defect/run-book")
		require.Equal(t, http.StatusInternalServerError, status, "body: %s", truncate(raw))

		// THE SET-RUN SERVES 200: its union excludes withheld engines.
		out := f.srRun(t, http.StatusOK, "sr_aave_defect")
		res := srResults(t, out)["sr_aave_defect"]
		require.Equal(t, []string{risk.AaveEngine}, srStrings(t, res["withheld_engines"]))
		require.Empty(t, asList(t, res["engines"]))

		// THE POINT OF THIS CASE: "the set refuses IF AND ONLY IF a member would
		// have refused alone" is FALSE in the reverse direction, and must never be
		// written that way again. The set-run behaviour is the better one.
	})

	t.Run("(c) the direction that IS true, over both fixtures", func(t *testing.T) {
		// The set refuses with an ARITHMETIC 500 ONLY IF at least one requested
		// scenario would have refused alone. The scope word is load-bearing: the
		// freshness probe and the census classification are SET-ONLY refusal
		// sources with no single-scenario counterpart at all, so no member could
		// have exhibited them alone (TestSetRunCensusRefusesAThirdStatusToken is
		// the census half).
		f := newP5Fixture(t)
		f.srInject(t, aaveDefect)
		for _, ids := range [][]string{
			{"eth_minus_10"},
			{"stable_depeg_0995_in_band", "dm_composition_census"},
			{"eth_minus_10", "eth_minus_30", "weeth_market_depeg_oracles_held"},
		} {
			out := f.srRun(t, http.StatusOK, ids...)
			require.Len(t, asList(t, out["results"]), len(ids))
			for _, id := range ids {
				status, _ := f.post(t, "/v1/scenarios/"+id+"/run-book")
				require.Equal(t, http.StatusOK, status,
					"%s serves alone, and the set carrying it serves too — the implication runs that way and only that way", id)
			}
		}
	})
}
