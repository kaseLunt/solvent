package main

// THE SEEDED EXACT-VALUE SUITE (plan Task 7 / design spec §11; Codex round 1 [H7]).
//
// Every assertion below is an EXACT, NON-EMPTY value derived by hand in
// fixture_test.go. That is the whole point of the obligation: a contract suite
// proves a response has the right SHAPE, and a shape assertion passes just as
// happily over a book of zeroes or a book of wrong numbers.
//
// Two negative controls prove the suite can actually fail:
//
//	TestSeededSuiteRejectsSchemaValidButWrong — a response with one number
//	  changed by ONE UNIT still satisfies api/openapi.yaml, and the exact-value
//	  assertions reject it.
//	TestSeededSuiteRejectsEmptyButValid — an all-zero, all-empty response also
//	  satisfies api/openapi.yaml, and the exact-value assertions reject it.
//
// Without those two, "the suite is green" would be a statement about JSON
// grammar.

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Small JSON navigation helpers. They FAIL rather than return a zero value: a
// missing field must never be read as "zero", which is the exact confusion the
// empty-but-valid control exists to catch.
// ---------------------------------------------------------------------------

type jt interface {
	Errorf(format string, args ...any)
	FailNow()
}

func at(t jt, v any, path ...any) any {
	cur := v
	for i, step := range path {
		switch k := step.(type) {
		case string:
			m, ok := cur.(map[string]any)
			if !ok {
				t.Errorf("path %v: element %d: expected an object, got %T", path, i, cur)
				t.FailNow()
				return nil
			}
			val, present := m[k]
			if !present {
				t.Errorf("path %v: key %q is absent", path, k)
				t.FailNow()
				return nil
			}
			cur = val
		case int:
			a, ok := cur.([]any)
			if !ok {
				t.Errorf("path %v: element %d: expected an array, got %T", path, i, cur)
				t.FailNow()
				return nil
			}
			if k >= len(a) {
				t.Errorf("path %v: index %d out of range (len %d)", path, k, len(a))
				t.FailNow()
				return nil
			}
			cur = a[k]
		}
	}
	return cur
}

func str(t jt, v any, path ...any) string {
	got := at(t, v, path...)
	s, ok := got.(string)
	if !ok {
		t.Errorf("path %v: expected a string, got %T (%v)", path, got, got)
		t.FailNow()
		return ""
	}
	return s
}

func num(t jt, v any, path ...any) float64 {
	got := at(t, v, path...)
	f, ok := got.(float64)
	if !ok {
		t.Errorf("path %v: expected a number, got %T (%v)", path, got, got)
		t.FailNow()
		return 0
	}
	return f
}

func boolAt(t jt, v any, path ...any) bool {
	got := at(t, v, path...)
	b, ok := got.(bool)
	if !ok {
		t.Errorf("path %v: expected a boolean, got %T (%v)", path, got, got)
		t.FailNow()
		return false
	}
	return b
}

func arr(t jt, v any, path ...any) []any {
	got := at(t, v, path...)
	a, ok := got.([]any)
	if !ok {
		t.Errorf("path %v: expected an array, got %T", path, got)
		t.FailNow()
		return nil
	}
	return a
}

// byKey finds the element of an array of objects whose `field` equals `want`.
func byKey(t jt, list []any, field, want string) map[string]any {
	for _, e := range list {
		m, ok := e.(map[string]any)
		if !ok {
			continue
		}
		if s, _ := m[field].(string); s == want {
			return m
		}
	}
	t.Errorf("no element with %s == %q in a list of %d", field, want, len(list))
	t.FailNow()
	return nil
}

// countFor reads a {key,count} breakdown.
func countFor(t jt, list []any, key string) float64 {
	return num(t, byKey(t, list, "key", key), "count")
}

// ---------------------------------------------------------------------------
// /v1/book
// ---------------------------------------------------------------------------

// assertBookExactValues is factored out of the test so the two negative controls
// can run the SAME assertions over a mutated body and prove they reject it.
func assertBookExactValues(t jt, body map[string]any) {
	// The batch envelope: four positions, two refused, one flagged.
	require.EqualValues(t, 4, num(t, body, "batch", "position_count"))
	require.EqualValues(t, 2, num(t, body, "batch", "refused_count"))
	require.EqualValues(t, 1, num(t, body, "batch", "flagged_count"))
	require.Equal(t, store.RiskBatchComplete, str(t, body, "batch", "status"))
	require.False(t, boolAt(t, body, "batch", "supersession", "superseded"),
		"the fixture's cursors sit exactly on the batch's stamps and no epoch is recorded, so no leg may fire")
	require.Len(t, arr(t, body, "batch", "watermarks"), 5)
	// Nothing is withheld in the healthy fixture — asserted so the withheld-engine
	// test below is a genuine change of state rather than a difference nobody pinned.
	require.Empty(t, arr(t, body, "batch", "refused_engines"))
	require.Empty(t, arr(t, body, "refused_engines"))
	require.Empty(t, arr(t, body, "waterfall", "excluded_engines"))

	// Per-engine aggregates, in each engine's own scale, never summed.
	engines := arr(t, body, "engines")
	require.Len(t, engines, 2)

	aave := byKey(t, engines, "engine", risk.AaveEngine)
	require.EqualValues(t, 8, num(t, aave, "value_decimals"))
	require.False(t, boolAt(t, aave, "refused"))
	require.Nil(t, at(t, aave, "refusal"))
	require.Equal(t, fxAaveCollateralBase, str(t, aave, "total_collateral"))
	require.Equal(t, fxAaveDebtBase, str(t, aave, "total_debt"))
	require.EqualValues(t, 2, num(t, aave, "positions"))
	require.EqualValues(t, 1, num(t, aave, "computed_positions"))
	require.EqualValues(t, 1, num(t, aave, "refused_positions"))
	require.EqualValues(t, 1, num(t, aave, "flagged_positions"))
	require.EqualValues(t, 0, num(t, aave, "liquidatable_positions"))
	// The refusal is NAMED and COUNTED — the book is served with it.
	require.EqualValues(t, 1, countFor(t, arr(t, aave, "refusals"), riskfeed.GateMissingInput))
	require.EqualValues(t, 1, countFor(t, arr(t, aave, "flags"), riskfeed.FlagStalePrice))

	dm := byKey(t, engines, "engine", risk.DMEngine)
	require.EqualValues(t, 6, num(t, dm, "value_decimals"))
	require.Equal(t, fxDMCollateralUSD, str(t, dm, "total_collateral"))
	require.Equal(t, fxDMBorrowings, str(t, dm, "total_debt"))
	require.EqualValues(t, 1, num(t, dm, "liquidatable_positions"))
	require.EqualValues(t, 1, countFor(t, arr(t, dm, "refusals"), riskfeed.GateSweepNever))

	// The histogram, on each engine's OWN comparator.
	hist := arr(t, body, "hf_histogram", "engines")
	require.Equal(t, risk.WadUnit().String(), str(t, body, "hf_histogram", "wad_scale"))
	ah := byKey(t, hist, "engine", risk.AaveEngine)
	require.Equal(t, "hf_wad", str(t, ah, "comparator"))
	require.EqualValues(t, 1, num(t, byKey(t, arr(t, ah, "buckets"), "label", "1.05 – 1.10"), "count"),
		"HF 1.08 must land in [1.05, 1.10)")
	require.EqualValues(t, 0, num(t, byKey(t, arr(t, ah, "buckets"), "label", "< 0.90"), "count"))
	require.EqualValues(t, 1, num(t, ah, "refused_count"))
	dh := byKey(t, hist, "engine", risk.DMEngine)
	require.Equal(t, "hf_num/hf_den", str(t, dh, "comparator"))
	require.EqualValues(t, 1, num(t, byKey(t, arr(t, dh, "buckets"), "label", "< 0.90"), "count"),
		"3200/4200 = 0.7619… must land below 0.90")

	// The waterfall.
	require.Equal(t, defaultWaterfallScenario, str(t, body, "waterfall", "scenario_id"))
	require.Equal(t, "v1", str(t, body, "waterfall", "scenario_version"))
	require.Equal(t, string(risk.AxisETHUSD), str(t, body, "waterfall", "axis"))
	require.Equal(t, risk.WadUnit().String(), str(t, body, "waterfall", "grid_scale"))
	require.True(t, boolAt(t, body, "waterfall", "monotonicity", "ok"))
	points := arr(t, body, "waterfall", "points")
	// Seven points: 1.0 → 0.4 in ten-percent steps (Wave W-SC-A). The last one
	// is the deepest COMMITTED ETH rung and never deeper — the frontier borrows
	// eth_minus_60's out_of_model, so a grid point past it would be a number
	// with no disclosure of its own.
	require.Len(t, points, 7)

	// Point 0 — the UNSHOCKED book. Aave is healthy at 1.08; the Debt Manager is
	// already liquidatable AND insolvent, which is the standing bad debt.
	require.Equal(t, risk.WadUnit().String(), str(t, points[0], "factor"))
	p0aave := byKey(t, arr(t, points[0], "engines"), "engine", risk.AaveEngine)
	require.EqualValues(t, 0, num(t, p0aave, "cumulative_eligible_accounts"))
	require.Equal(t, "0", str(t, p0aave, "cumulative_debt_eligible_usd"))
	require.Equal(t, "0", str(t, p0aave, "cumulative_bad_debt_usd"))
	p0dm := byKey(t, arr(t, points[0], "engines"), "engine", risk.DMEngine)
	require.EqualValues(t, 6, num(t, p0dm, "usd_decimals"))
	require.EqualValues(t, 1, num(t, p0dm, "newly_eligible_accounts"))
	require.EqualValues(t, 1, num(t, p0dm, "cumulative_eligible_accounts"))
	require.Equal(t, fxDMBorrowings, str(t, p0dm, "cumulative_debt_eligible_usd"))
	require.Equal(t, fxDMAtRiskAtPar, str(t, p0dm, "cumulative_collateral_at_risk_usd"))
	require.EqualValues(t, 1, num(t, p0dm, "insolvent_if_liquidated_accounts"))
	require.Equal(t, fxDMBadDebtAtPar, str(t, p0dm, "cumulative_bad_debt_usd"))

	// Point 1 — ETH −10%. Aave crosses here: 8000×0.9×0.81/6000 = 0.972.
	require.Equal(t, "900000000000000000", str(t, points[1], "factor"))
	p1aave := byKey(t, arr(t, points[1], "engines"), "engine", risk.AaveEngine)
	require.EqualValues(t, 8, num(t, p1aave, "usd_decimals"))
	require.EqualValues(t, 1, num(t, p1aave, "newly_eligible_accounts"))
	require.Equal(t, fxAaveDebtAt90, str(t, p1aave, "cumulative_debt_eligible_usd"))
	require.Equal(t, fxAaveAtRiskAt90, str(t, p1aave, "cumulative_collateral_at_risk_usd"))
	require.EqualValues(t, 0, num(t, p1aave, "insolvent_if_liquidated_accounts"),
		"the Aave position's collateral net of the 5% bonus still covers its debt at −10%")
	p1dm := byKey(t, arr(t, points[1], "engines"), "engine", risk.DMEngine)
	require.EqualValues(t, 0, num(t, p1dm, "newly_eligible_accounts"), "the Debt Manager crossed at point 0 and must not be counted again")
	require.Equal(t, fxDMAtRiskAt90, str(t, p1dm, "cumulative_collateral_at_risk_usd"))
	require.Equal(t, fxDMBadDebtAt90, str(t, p1dm, "cumulative_bad_debt_usd"))

	// The TAIL POINT — ETH −60%, the deepest committed rung (Wave W-SC-A). The
	// Debt Manager's weETH collateral marks straight through the factor:
	// 4000000000 × 40/100 = 1600000000. Bad debt is strictly deeper than at
	// −50%, which is the monotonicity the frontier PUBLISHES rather than assumes.
	require.Equal(t, "400000000000000000", str(t, points[6], "factor"))
	p6dm := byKey(t, arr(t, points[6], "engines"), "engine", risk.DMEngine)
	require.Equal(t, "1600000000", str(t, p6dm, "cumulative_collateral_at_risk_usd"))
	p5dm := byKey(t, arr(t, points[5], "engines"), "engine", risk.DMEngine)
	deepBad, ok := new(big.Int).SetString(str(t, p6dm, "cumulative_bad_debt_usd"), 10)
	require.True(t, ok)
	prevBad, ok := new(big.Int).SetString(str(t, p5dm, "cumulative_bad_debt_usd"), 10)
	require.True(t, ok)
	require.Positive(t, deepBad.Cmp(prevBad), "bad debt must deepen from −50% to −60%")

	// The USDC leg is not in the eth_usd propagation matrix, so it is HELD FLAT —
	// and named, rather than silently unmoved.
	held := arr(t, body, "waterfall", "held_flat")
	require.NotEmpty(t, held)
	require.Equal(t, fxAaveUSDCPrice, str(t, byKey(t, held, "asset", fxUSDCEth.Hex()), "value"))

	// The standing bad-debt line.
	bad := arr(t, body, "bad_debt")
	require.Len(t, bad, 2)
	require.Equal(t, fxDMBadDebtAtPar, str(t, byKey(t, bad, "engine", risk.DMEngine), "current_bad_debt_usd"))
	require.EqualValues(t, 1, num(t, byKey(t, bad, "engine", risk.DMEngine), "insolvent_positions"))
	require.Equal(t, "0", str(t, byKey(t, bad, "engine", risk.AaveEngine), "current_bad_debt_usd"))

	// Coverage: both computed positions reached the derived arithmetic, and nothing
	// was silently excluded.
	require.EqualValues(t, 4, num(t, body, "coverage", "batch_positions"))
	require.EqualValues(t, 2, num(t, body, "coverage", "in_book"))
	require.EqualValues(t, 2, num(t, body, "coverage", "refused_in_batch"))
	require.EqualValues(t, 0, num(t, body, "coverage", "excluded_by_this_layer"))
	require.Empty(t, arr(t, body, "coverage", "withheld_engines"))
	require.True(t, boolAt(t, body, "coverage", "stress_coverage_is_full"))
}

func TestBookServesExactSeededValues(t *testing.T) {
	f := newAPIFixture(t)
	body := f.getJSON(t, "/v1/book", "/v1/book")
	require.EqualValues(t, f.batchID, num(t, body, "batch", "id"))
	assertBookExactValues(t, body)
}

// ---------------------------------------------------------------------------
// The two anti-vacuity controls.
// ---------------------------------------------------------------------------

// capture is a require.TestingT that RECORDS a failure instead of failing the
// enclosing test, so a negative control can assert that the assertions rejected
// something.
type capture struct {
	failed bool
	msgs   []string
}

func (c *capture) Errorf(format string, args ...any) {
	c.failed = true
	c.msgs = append(c.msgs, fmt.Sprintf(format, args...))
}

// FailNow panics with a sentinel that runCaptured recovers: require's contract is
// that FailNow does not return.
func (c *capture) FailNow() { panic(captureFailNow) }

type captureSentinel struct{}

var captureFailNow = captureSentinel{}

// runCaptured runs fn against a capture and reports whether it failed.
func runCaptured(fn func(t jt)) *capture {
	c := &capture{}
	func() {
		defer func() {
			if v := recover(); v != nil {
				if _, ok := v.(captureSentinel); ok {
					return
				}
				panic(v)
			}
		}()
		fn(c)
	}()
	return c
}

// TestSeededSuiteRejectsSchemaValidButWrong is the DISCRIMINATING NEGATIVE for
// "schema-valid but wrong".
//
// It takes the real response, changes ONE number by ONE UNIT, and proves two
// things at once: the mutant still satisfies api/openapi.yaml (so a contract
// suite alone would pass it), and the exact-value assertions reject it (so the
// seeded suite is what catches it). Both halves are required — without the first,
// the mutation might simply be malformed JSON.
func TestSeededSuiteRejectsSchemaValidButWrong(t *testing.T) {
	f := newAPIFixture(t)
	_, raw := f.get(t, "/v1/book")

	mutations := map[string]func(map[string]any){
		"engine total collateral off by one": func(b map[string]any) {
			e := byKey(t, arr(t, b, "engines"), "engine", risk.AaveEngine)
			e["total_collateral"] = "800000000001"
		},
		"waterfall bad debt off by one": func(b map[string]any) {
			pt := arr(t, b, "waterfall", "points")[0]
			byKey(t, arr(t, pt, "engines"), "engine", risk.DMEngine)["cumulative_bad_debt_usd"] = "239603962"
		},
		"histogram bucket moved one bucket over": func(b map[string]any) {
			ah := byKey(t, arr(t, b, "hf_histogram", "engines"), "engine", risk.AaveEngine)
			byKey(t, arr(t, ah, "buckets"), "label", "1.05 – 1.10")["count"] = float64(0)
			byKey(t, arr(t, ah, "buckets"), "label", "1.00 – 1.05")["count"] = float64(1)
		},
		"refusal count zeroed": func(b map[string]any) {
			e := byKey(t, arr(t, b, "engines"), "engine", risk.AaveEngine)
			e["refused_positions"] = float64(0)
		},
		"collateral at risk off by one": func(b map[string]any) {
			pt := arr(t, b, "waterfall", "points")[1]
			byKey(t, arr(t, pt, "engines"), "engine", risk.AaveEngine)["cumulative_collateral_at_risk_usd"] = "630000000001"
		},
	}

	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			var mutant map[string]any
			require.NoError(t, json.Unmarshal(raw, &mutant))
			mutate(mutant)

			// (a) Still schema-valid: a contract suite would wave it through.
			require.False(t, contractRejects(t, "/v1/book", http.StatusOK, mutant),
				"the mutation must remain SCHEMA-VALID, or this control would only prove the contract rejects malformed JSON")

			// (b) The exact-value suite rejects it.
			c := runCaptured(func(tt jt) { assertBookExactValues(tt, mutant) })
			require.True(t, c.failed,
				"the seeded exact-value suite accepted a wrong number — it is not discriminating")
		})
	}
}

// TestSeededSuiteRejectsEmptyButValid is the DISCRIMINATING NEGATIVE for
// "empty but valid": a book with no engines, no points and no numbers.
func TestSeededSuiteRejectsEmptyButValid(t *testing.T) {
	empty := map[string]any{
		"served_at": "2026-07-29T10:00:00Z",
		"batch": map[string]any{
			"id": float64(1), "computed_at": "2026-07-29T10:00:00Z", "age_seconds": float64(0),
			"producer": "riskd", "status": "complete",
			"position_count": float64(0), "refused_count": float64(0), "flagged_count": float64(0),
			"refused_engines": []any{},
			// One minimal stamp, not none: 1.2.2 requires the watermark vector
			// non-empty (minItems 1 — the sweep-disclosure law licenses
			// liquidatable counts through it), so "empty but valid" now means
			// an empty BOOK under a stamped envelope.
			"watermarks": []any{map[string]any{
				"engine": "aave_v3_etherfi", "chain_id": float64(1), "last_block": float64(0),
				"acked_epoch": float64(0), "max_epoch_at_compute": float64(0), "sweep": nil,
			}},
			"supersession": map[string]any{
				"superseded": false, "legs": []any{}, "note": "n",
			},
		},
		"refused_engines": []any{},
		"engines":         []any{},
		"hf_histogram":    map[string]any{"wad_scale": "1000000000000000000", "engines": []any{}},
		"waterfall":       nil,
		"bad_debt":        []any{},
		"coverage": map[string]any{
			"batch_positions": float64(0), "in_book": float64(0), "refused_in_batch": float64(0),
			"excluded_by_this_layer": float64(0), "excluded": []any{},
			"withheld_engines":        []any{},
			"stress_coverage_is_full": true, "note": "n",
		},
		"notes": []any{},
	}

	// (a) Schema-valid. Every required field is present and correctly typed.
	require.False(t, contractRejects(t, "/v1/book", http.StatusOK, empty),
		"the empty response must be SCHEMA-VALID — that is precisely why a contract suite cannot be the whole test")

	// (b) Rejected by the exact-value suite.
	c := runCaptured(func(tt jt) { assertBookExactValues(tt, empty) })
	require.True(t, c.failed, "the seeded exact-value suite accepted an EMPTY book")
	require.NotEmpty(t, c.msgs)
}

// TestContractValidatorCanReject proves the validator itself has teeth. Without
// this, every `validateContract` call in the suite could be a no-op.
func TestContractValidatorCanReject(t *testing.T) {
	loadContract(t)
	for name, bad := range map[string]any{
		"missing required field": map[string]any{"served_at": "2026-07-29T10:00:00Z"},
		"money as a JSON number": func() any {
			return map[string]any{
				"served_at": "2026-07-29T10:00:00Z",
				"batch": map[string]any{
					"id": float64(1), "computed_at": "2026-07-29T10:00:00Z", "age_seconds": float64(0),
					"producer": "riskd", "status": "complete",
					"position_count": float64(0), "refused_count": float64(0), "flagged_count": float64(0),
					"refused_engines": []any{},
					"watermarks":      []any{},
					"supersession":    map[string]any{"superseded": false, "legs": []any{}, "note": "n"},
				},
				"refused_engines": []any{},
				"engines": []any{map[string]any{
					"engine": "aave_v3_etherfi", "value_decimals": float64(8),
					"positions": float64(1), "computed_positions": float64(1), "refused_positions": float64(0),
					"flagged_positions": float64(0), "liquidatable_positions": float64(0),
					"refused": false, "refusal": nil,
					"total_collateral": float64(800000000000), // A NUMBER, not a decimal string.
					"total_debt":       "0",
					"refusals":         []any{}, "flags": []any{}, "unit_note": "n",
				}},
				"hf_histogram": map[string]any{"wad_scale": "1", "engines": []any{}},
				"waterfall":    nil, "bad_debt": []any{},
				"coverage": map[string]any{
					"batch_positions": float64(0), "in_book": float64(0), "refused_in_batch": float64(0),
					"excluded_by_this_layer": float64(0), "excluded": []any{},
					"withheld_engines":        []any{},
					"stress_coverage_is_full": true, "note": "n",
				},
				"notes": []any{},
			}
		}(),
		"unknown field": map[string]any{
			"served_at": "2026-07-29T10:00:00Z", "surprise": true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			require.True(t, contractRejects(t, "/v1/book", http.StatusOK, bad),
				"the contract must reject this body; a validator that accepts everything validates nothing")
		})
	}
}

// ---------------------------------------------------------------------------
// /v1/address — isolation, disclosures, liquidation price
// ---------------------------------------------------------------------------

func TestAddressServesExactSeededValuesAndIsIsolated(t *testing.T) {
	f := newAPIFixture(t)
	path := "/v1/address/" + fxAcctAave.Hex()
	status, raw := f.get(t, path)
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)

	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))

	require.True(t, boolAt(t, body, "found"))
	require.True(t, boolAt(t, body, "lookup_complete"),
		"every engine is available in the healthy fixture, so `found` is a definitive answer")
	require.Empty(t, arr(t, body, "withheld_engines"))
	require.Equal(t, fxAcctAave.Hex(), str(t, body, "address"))
	positions := arr(t, body, "positions")
	require.Len(t, positions, 1, "the requested address holds exactly one position in this batch")

	p := positions[0].(map[string]any)
	require.Equal(t, risk.AaveEngine, str(t, p, "engine"))
	require.Equal(t, store.RiskPositionComputed, str(t, p, "status"))
	require.Equal(t, fxAaveHFWad, str(t, p, "health_factor", "wad"))
	require.Equal(t, fxAaveHFNum, str(t, p, "health_factor", "num"))
	require.Equal(t, fxAaveHFDen, str(t, p, "health_factor", "den"))
	require.Equal(t, fxAaveCollateralBase, str(t, p, "total_collateral_base"))
	require.Equal(t, fxAaveDebtBase, str(t, p, "total_debt_base"))
	require.Equal(t, fxAaveWeightedLTSum, str(t, p, "weighted_lt_sum"))
	require.Equal(t, fxAaveAvgLTBps, str(t, p, "avg_lt_bps"))
	require.Equal(t, []any{riskfeed.FlagStalePrice}, arr(t, p, "flags"))

	// The as-ofs are the batch's durable stamps.
	require.EqualValues(t, fxAaveBlock, num(t, p, "as_of", "balances_block"))
	require.EqualValues(t, fxAaveParamBlock, num(t, p, "as_of", "params_block"))
	require.True(t, boolAt(t, p, "as_of", "stale_price_inputs"))

	// Legs, each with its OWN rate-index as-of block.
	legs := arr(t, p, "legs")
	require.Len(t, legs, 2)
	weeth := byKey(t, legs, "asset", fxWeETHEth.Hex())
	require.Equal(t, fxAaveWeETHAmount, str(t, weeth, "live_collateral"))
	require.Equal(t, fxAaveCollateralBase, str(t, weeth, "collateral_base"))
	require.Equal(t, fxAaveLTBps, str(t, weeth, "liq_threshold"))
	require.Equal(t, fxAaveBonusBps, str(t, weeth, "liq_bonus"))
	require.EqualValues(t, fxAaveBlock, num(t, weeth, "collateral_index_block"))
	require.True(t, boolAt(t, weeth, "used_as_collateral"))
	usdc := byKey(t, legs, "asset", fxUSDCEth.Hex())
	require.Equal(t, fxAaveUSDCDebt, str(t, usdc, "live_debt"))
	require.Equal(t, fxAaveDebtBase, str(t, usdc, "debt_base"))
	require.False(t, boolAt(t, usdc, "used_as_collateral"))

	// PER-INPUT PRICE DISCLOSURES, from the PERSISTED batch rows.
	inputs := arr(t, p, "price_inputs")
	require.Len(t, inputs, 2)
	pw := byKey(t, inputs, "asset", fxWeETHEth.Hex())
	require.Equal(t, fxAaveWeETHPrice, str(t, pw, "value"))
	require.EqualValues(t, 8, num(t, pw, "decimals"))
	require.EqualValues(t, fxAavePriceBlock, num(t, pw, "block_number"))
	require.Equal(t, risk.ProvenanceAdapterOutput, str(t, pw, "provenance"))
	require.Equal(t, riskfeed.VerdictStale, str(t, pw, "verdict"))
	require.EqualValues(t, fxAaveWeETHAge, num(t, pw, "age_seconds"))
	require.EqualValues(t, fxPriceBudgetSecs, num(t, pw, "budget_seconds"))
	require.False(t, boolAt(t, pw, "fresh"))
	pu := byKey(t, inputs, "asset", fxUSDCEth.Hex())
	require.Equal(t, fxAaveUSDCPrice, str(t, pu, "value"))
	require.True(t, boolAt(t, pu, "fresh"))
	require.EqualValues(t, fxAaveUSDCAge, num(t, pu, "age_seconds"))

	// LAST-GOOD KEEPS ITS ORIGINAL DISCLOSURE. A newer, wildly different poll for
	// the same witness landed in `prices` AFTER this batch. The served disclosure
	// must be the batch's own — value and age — because re-deriving it at serve
	// time would disclose an input the batch never used (design spec §7, Codex
	// round 1 [H6]).
	require.NotContains(t, string(raw), fxLivePriceAfterBatch,
		"a price that landed after the batch must NOT appear on a served disclosure")

	// The factor-level liquidation price: s* = 1e4×6e11 / 6.48e15 = 0.925925…,
	// so P* = 0.925925…×4000.00000000 = 370370370370.37 (8-dec).
	lp := at(t, p, "liquidation_price").(map[string]any)
	require.True(t, boolAt(t, lp, "in_factor"))
	require.False(t, boolAt(t, lp, "never_liquidatable"))
	require.False(t, boolAt(t, lp, "already_breached"))
	require.True(t, boolAt(t, lp, "boundary_is_healthy"))
	prices := arr(t, lp, "prices")
	require.Len(t, prices, 1)
	require.Equal(t, fxWeETHEth.Hex(), str(t, prices[0], "asset"))
	require.Equal(t, fxAaveWeETHPrice, str(t, prices[0], "current_price"))
	require.Equal(t, "370370370370", str(t, prices[0], "price_floor"))
	require.Equal(t, "370370370371", str(t, prices[0], "lowest_healthy_price"))
	// The exact rational, checked by cross-multiplication so a reduced form passes.
	sn, sd := bi(str(t, lp, "scale_factor_num")), bi(str(t, lp, "scale_factor_den"))
	require.Zero(t,
		new(big.Int).Mul(sn, bi("6480000000000000")).Cmp(new(big.Int).Mul(sd, bi("6000000000000000"))),
		"s* must equal 6e15/6.48e15 exactly")
	require.Equal(t, []any{fxWeETHEth.Hex()}, arr(t, lp, "factor_assets"))

	// PER-ADDRESS ISOLATION. No other account's row may appear anywhere in the
	// body — not as a position, not inside a disclosure.
	for _, other := range []string{fxAcctAaveRef.Hex(), fxAcctDM.Hex(), fxAcctDMRef.Hex()} {
		require.NotContains(t, string(raw), other,
			"address A's response must contain no address-B rows")
	}
	require.NotContains(t, string(raw), fxWeETHOp.Hex(),
		"the Optimism weETH address belongs to the other engine's position and must not leak in")
}

func TestAddressServesRefusalsWithTheirReasons(t *testing.T) {
	f := newAPIFixture(t)

	// The G1 refusal: named code, named asset, and a note explaining the code.
	status, raw := f.get(t, "/v1/address/"+fxAcctAaveRef.Hex())
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	p := arr(t, body, "positions")[0]
	require.Equal(t, store.RiskPositionRefused, str(t, p, "status"))
	require.Equal(t, riskfeed.GateMissingInput, str(t, p, "refusal", "code"))
	require.Equal(t, fxWeETHEth.Hex(), str(t, p, "refusal", "asset"))
	require.Contains(t, str(t, p, "refusal", "note"), "never silently dropped")
	require.Nil(t, at(t, p, "health_factor"), "a refused position must not carry a health factor")
	require.Nil(t, at(t, p, "liquidation_price"))
	// The refused position still discloses the input that refused it.
	require.Equal(t, riskfeed.VerdictMissing, str(t, arr(t, p, "price_inputs")[0], "verdict"))
	require.Nil(t, at(t, arr(t, p, "price_inputs")[0], "value"))

	// The never-swept refusal: the `0xe957…bf20` posture at the row level.
	status, raw = f.get(t, "/v1/address/"+fxAcctDMRef.Hex())
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)
	require.NoError(t, json.Unmarshal(raw, &body))
	p = arr(t, body, "positions")[0]
	require.Equal(t, riskfeed.GateSweepNever, str(t, p, "refusal", "code"))
	require.Contains(t, str(t, p, "refusal", "note"), "UNKNOWN size")
	require.Nil(t, at(t, p, "liquidatable"),
		"a never-swept account must not be served a liquidatable verdict at all — HF≈0 over unknown collateral is a false alarm")
}

func TestAddressWithNoPositionAnswersFoundFalse(t *testing.T) {
	f := newAPIFixture(t)
	status, raw := f.get(t, "/v1/address/"+fxAcctUnknown.Hex())
	require.Equal(t, http.StatusOK, status, "no position in this batch is an ANSWER, not a 404")
	validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	require.False(t, boolAt(t, body, "found"),
		"with every engine available, no position is a DEFINITIVE negative")
	require.True(t, boolAt(t, body, "lookup_complete"))
	require.Empty(t, arr(t, body, "withheld_engines"))
	require.Empty(t, arr(t, body, "positions"))
	// It still says WHICH batch answered.
	require.EqualValues(t, f.batchID, num(t, body, "batch", "id"))
}

func TestAddressRejectsMalformedAddress(t *testing.T) {
	f := newAPIFixture(t)
	status, raw := f.get(t, "/v1/address/0xnothex")
	require.Equal(t, http.StatusBadRequest, status)
	validateContract(t, "/v1/address/{addr}", http.StatusBadRequest, raw)
	var e errorBody
	require.NoError(t, json.Unmarshal(raw, &e))
	require.Equal(t, codeBadRequest, e.Error.Code)
}

// ---------------------------------------------------------------------------
// /v1/address/{addr}/stress
// ---------------------------------------------------------------------------

func TestStressServesExactRecomputableValues(t *testing.T) {
	f := newAPIFixture(t)
	status, raw := f.get(t, "/v1/address/"+fxAcctAave.Hex()+"/stress")
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}/stress", http.StatusOK, raw)

	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	require.Equal(t, "v1", str(t, body, "scenario_config_version"))
	scenarios := arr(t, body, "scenarios")
	// 15 = the 14 stress scenarios + dm_composition_census (Wave S: the
	// explicit-claim-or-explicit-decision record whose axes shock ×1/1).
	// Wave W-SC-A added the deep ETH rungs −40/−50/−60.
	require.Len(t, scenarios, 15, "the whole committed scenario set must be evaluated, not a subset")

	// ETH −30%: weETH 4000.00000000 × 70/100 = 2800.00000000, so
	// collateral = 2 × 2800 = 5600.00000000, weighted = 5600×0.81 = 4536,
	// HF = 4536/6000 = 0.756 → eligible.
	eth30 := byKey(t, scenarios, "id", "eth_minus_30")
	require.Equal(t, "v1", str(t, eth30, "version"))
	res := arr(t, eth30, "results")
	require.Len(t, res, 1)
	r := res[0]
	require.True(t, boolAt(t, r, "applicable"))
	require.Equal(t, fxAaveHFWad, str(t, r, "before", "health_factor_wad"))
	require.False(t, boolAt(t, r, "before", "eligible"))
	require.Equal(t, "756000000000000000", str(t, r, "after", "health_factor_wad"))
	require.Equal(t, "560000000000", str(t, r, "after", "collateral_usd"))
	require.Equal(t, fxAaveDebtBase, str(t, r, "after", "debt_usd"))
	require.True(t, boolAt(t, r, "after", "eligible"))

	shocks := arr(t, r, "applied_shocks")
	sw := byKey(t, shocks, "asset", fxWeETHEth.Hex())
	require.Equal(t, fxAaveWeETHPrice, str(t, sw, "before"))
	require.Equal(t, "280000000000", str(t, sw, "after"))
	require.False(t, boolAt(t, sw, "cap_bound"))
	require.False(t, boolAt(t, sw, "snapped"))
	// The USDC leg has no propagation row on this axis and is NAMED as held flat.
	require.Equal(t, fxAaveUSDCPrice, str(t, byKey(t, arr(t, r, "held_flat"), "asset", fxUSDCEth.Hex()), "value"))

	// The market-realization axis: oracles held, so the health factors are
	// bit-identical and the output is a shortfall.
	depeg := byKey(t, scenarios, "id", "weeth_market_depeg_oracles_held")
	dres := arr(t, depeg, "results")[0]
	require.True(t, boolAt(t, dres, "applicable"))
	require.Equal(t, fxAaveHFWad, str(t, dres, "after", "health_factor_wad"),
		"a market depeg with oracles held must not move the health factor by a single wei")
	mr := at(t, dres, "market_realization").(map[string]any)
	require.True(t, boolAt(t, mr, "hfs_unchanged"))
	require.Equal(t, risk.SeizureModelProRata, str(t, mr, "seizure_model"))

	// The rate axis does not cover the Aave engine, and says so rather than
	// silently omitting a result.
	rate := byKey(t, scenarios, "id", "dm_rate_horizon_plus_200bps")
	rr := arr(t, rate, "results")[0]
	require.False(t, boolAt(t, rr, "applicable"))
	require.Contains(t, str(t, rr, "reason"), "not defined for engine")
}

func TestStressProjectionIsDeltaOnlyAndSaysSo(t *testing.T) {
	f := newAPIFixture(t)
	status, raw := f.get(t, "/v1/address/"+fxAcctDM.Hex()+"/stress")
	require.Equal(t, http.StatusOK, status)
	validateContract(t, "/v1/address/{addr}/stress", http.StatusOK, raw)

	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	rate := byKey(t, arr(t, body, "scenarios"), "id", "dm_rate_horizon_plus_200bps")
	r := arr(t, rate, "results")[0]
	require.True(t, boolAt(t, r, "applicable"))
	proj := at(t, r, "projection").(map[string]any)
	require.Equal(t, "PROJECTION", str(t, proj, "label"))
	require.Equal(t, "delta-only", str(t, proj, "basis"))
	require.True(t, boolAt(t, proj, "prices_held_flat"))
	require.Contains(t, str(t, proj, "note"), "DELTA-ONLY")
	require.Contains(t, str(t, proj, "note"), "No time-to-liquidatable")
	horizons := arr(t, proj, "horizons")
	require.NotEmpty(t, horizons)
	for _, h := range horizons {
		require.Equal(t, fxDMBorrowings, str(t, h, "debt_usd"),
			"the projection must start from the batch's own debt")
	}

	// The stable-band scenarios must not move a weETH mark, and the DM position's
	// collateral is weETH only — so the in-band scenario is a true no-op.
	inBand := byKey(t, arr(t, body, "scenarios"), "id", "stable_depeg_0995_in_band")
	ir := arr(t, inBand, "results")[0]
	if boolAt(t, ir, "applicable") {
		require.Equal(t, str(t, ir, "before", "collateral_usd"), str(t, ir, "after", "collateral_usd"))
	}
}

// ---------------------------------------------------------------------------
// /v1/observatory
// ---------------------------------------------------------------------------

func TestObservatoryServesExactSeededSeries(t *testing.T) {
	f := newAPIFixture(t)
	body := f.getJSON(t, "/v1/observatory", "/v1/observatory")

	series := arr(t, body, "series")
	require.Len(t, series, 1)
	require.EqualValues(t, f.batchID, num(t, series[0], "batch_id"))
	engines := arr(t, series[0], "engines")
	require.Equal(t, fxAaveCollateralBase, str(t, byKey(t, engines, "engine", risk.AaveEngine), "total_collateral"))
	require.Equal(t, fxAaveDebtBase, str(t, byKey(t, engines, "engine", risk.AaveEngine), "total_debt"))
	require.Equal(t, fxDMCollateralUSD, str(t, byKey(t, engines, "engine", risk.DMEngine), "total_collateral"))
	require.EqualValues(t, 1, num(t, byKey(t, engines, "engine", risk.DMEngine), "liquidatable_positions"))

	// 1.2.2: the point carries its batch's OWN watermark vector (the point
	// re-clocks the response, so the envelope cannot vouch for it), and each
	// engine row names the sweep-cut its liquidatable count aggregates.
	stamps := arr(t, series[0], "watermarks")
	require.Len(t, stamps, len(fxWatermarks()), "the FULL stamped engine set, not just the aggregate engines")
	dmStamp := byKey(t, stamps, "engine", risk.DMEngine)
	dmStampSweep := asMap(t, asMap(t, dmStamp)["sweep"])
	require.Equal(t, "309593004", dmStampSweep["success_sum"], "the batch's persisted sweep stamp, verbatim")
	dmRow := byKey(t, engines, "engine", risk.DMEngine)
	dmRowSweep := asMap(t, asMap(t, dmRow)["sweep"])
	require.Equal(t, float64(3), dmRowSweep["rows"])
	require.Equal(t, "309593004", dmRowSweep["success_sum"])
	require.Nil(t, asMap(t, byKey(t, engines, "engine", risk.AaveEngine))["sweep"],
		"aave has no collateral sweep: a recorded null, never a stamp invented for it")

	// The rate index: the NEWEST row per key, disclosing ITS OWN block — not the
	// derive cursor's, which is 900 blocks higher.
	idx := arr(t, body, "rate_indexes")
	require.Len(t, idx, 1, "two heights were seeded for one key; only the newest is the current index")
	require.Equal(t, fxRateIndexValue, str(t, idx[0], "value"))
	require.EqualValues(t, fxRateIndexBlock, num(t, idx[0], "as_of_block"))
	require.Equal(t, "liquidity_index", str(t, idx[0], "kind"))
	require.Contains(t, str(t, idx[0], "note"), "trail the derive cursor")
	require.NotEqual(t, float64(fxAaveBlock), num(t, idx[0], "as_of_block"),
		"the index as-of must not be the balances cursor: borrowing the cursor's freshness is the banned one-block stamping")
}

// TestObservatorySeriesGrowsWithBatches pins that a second materialization
// appears, newest first.
func TestObservatorySeriesGrowsWithBatches(t *testing.T) {
	f := newAPIFixture(t)
	second := f.seedBatch(t, "fixture-materialization-2")
	require.Greater(t, second, f.batchID)

	body := f.getJSON(t, "/v1/observatory?limit=5", "/v1/observatory")
	series := arr(t, body, "series")
	require.Len(t, series, 2)
	require.EqualValues(t, second, num(t, series[0], "batch_id"), "newest first")
	require.EqualValues(t, f.batchID, num(t, series[1], "batch_id"))

	// And the book now serves the newer batch.
	book := f.getJSON(t, "/v1/book", "/v1/book")
	require.EqualValues(t, second, num(t, book, "batch", "id"))
}

func TestObservatoryRejectsABadLimit(t *testing.T) {
	f := newAPIFixture(t)
	for _, q := range []string{"?limit=0", "?limit=-1", "?limit=abc", "?limit=100000"} {
		status, raw := f.get(t, "/v1/observatory"+q)
		require.Equal(t, http.StatusBadRequest, status, "limit %q", q)
		validateContract(t, "/v1/observatory", http.StatusBadRequest, raw)
	}
}

// ---------------------------------------------------------------------------
// /v1/meta
// ---------------------------------------------------------------------------

func TestMetaServesTheFullPosture(t *testing.T) {
	f := newAPIFixture(t)
	body := f.getJSON(t, "/v1/meta", "/v1/meta")

	// Service identity, including the schema version this build is pinned to.
	require.Equal(t, "solvent-api", str(t, body, "service", "name"))
	require.EqualValues(t, expectedSchemaVersionForTest(t), num(t, body, "service", "schema_version"))
	require.Equal(t, "v1", str(t, body, "service", "scenario_config_version"))
	require.Equal(t, risk.SeizureModelProRata, str(t, body, "service", "seizure_model"))
	require.EqualValues(t, riskfeed.AlgorithmRevision, num(t, body, "service", "algorithm_revision"))

	// The watermark vector, with derivation-coverage provenance.
	vec := arr(t, body, "watermark_vector")
	require.Len(t, vec, 5)
	aaveCur := byKey(t, vec, "engine", risk.AaveEngine)
	require.EqualValues(t, fxAaveBlock, num(t, aaveCur, "last_block"))
	require.EqualValues(t, 20_625_519, num(t, aaveCur, "covered_from_block"))
	require.True(t, boolAt(t, aaveCur, "consumed_by_risk"))

	// The reorg posture: clean, with all three leg names published.
	require.False(t, boolAt(t, body, "reorg_posture", "superseded"))
	require.ElementsMatch(t,
		[]any{legAckedEpochMoved, legLastBlockRewound, legUnackedEpoch},
		arr(t, body, "reorg_posture", "leg_names"))

	// PRICE STATE, including the valid=false quarantine. Note the contrast with
	// /v1/address: here the LIVE newest row is disclosed (the post-batch poll),
	// and the quarantined row below it is still counted because D-012 retains it.
	prices := arr(t, body, "prices")
	weeth := byKey(t, prices, "asset", fxWeETHEth.Hex())
	require.Equal(t, fxLivePriceAfterBatch, str(t, weeth, "value"),
		"/v1/meta reports the live price state — that is its job, and it is why the address surface must serve the batch's own value instead")
	require.True(t, boolAt(t, weeth, "valid"))
	require.EqualValues(t, 1, num(t, weeth, "quarantined_rows"),
		"a neutralized row is RETAINED, never deleted, and must stay visible after a newer valid poll lands above it")
	require.EqualValues(t, fxAavePriceBlock-100, num(t, weeth, "highest_quarantined_block"))
	require.True(t, boolAt(t, weeth, "is_valuation_witness"))
	require.Equal(t, risk.ProvenanceAdapterOutput, str(t, weeth, "provenance"))
	require.Equal(t, "weETH", str(t, weeth, "symbol"))

	// The neutralized backlog is countable.
	neutral := byKey(t, arr(t, body, "neutralized_prices"), "owner_engine", store.PollOwnedEnginePrefix+"1")
	require.EqualValues(t, 1, num(t, neutral, "rows"))

	// The sweep three-state census.
	sweeps := byKey(t, arr(t, body, "sweeps"), "engine", risk.DMEngine)
	require.EqualValues(t, 3, num(t, sweeps, "rows"))
	require.EqualValues(t, 1, num(t, sweeps, "never_swept"))
	require.EqualValues(t, 1, num(t, sweeps, "failed_since_success"))
	require.EqualValues(t, 1, num(t, sweeps, "success"))
	require.EqualValues(t, 1, num(t, body, "sweep_never_refusals_in_batch"))

	// HEARTBEAT PROVENANCE — the grades, each with the evidence behind it.
	//
	// A SCANNED budget must NOT be reported as merely awaiting confirmation:
	// the measurement is in, and grading it `published-not-verified`
	// would overstate provenance while quietly keeping the friendlier published
	// number (the silent-cap anti-canon with a nicer label).
	hb := arr(t, body, "heartbeat_provenance")
	require.Len(t, hb, 3)

	qualified := byKey(t, hb, "proxy", fxProxyQualified.Hex())
	require.Equal(t, "empirical-historical-with-qualifier", str(t, qualified, "provenance_grade"))
	require.EqualValues(t, 3600, num(t, qualified, "heartbeat_seconds"))
	require.EqualValues(t, 1800, num(t, qualified, "grace_seconds"))
	require.EqualValues(t, 3732, num(t, qualified, "observed_max_gap_seconds"),
		"the measured gap exceeds the published 3600s heartbeat")
	require.EqualValues(t, 5400, num(t, qualified, "tested_budget_seconds"),
		"and survives only inside heartbeat + grace")
	require.False(t, boolAt(t, qualified, "budget_refuted"))
	require.Contains(t, str(t, qualified, "basis"), "never graded `verified`")

	// Codex r65: USDC is graded against the ACTIVE budget (09d496e's 302400s),
	// which its 248460s observation sits WITHIN — `empirical-historical`, not
	// refuted. The retired 90000s budget's refutation is preserved as history
	// in the basis, and the COHERENCE law below is what forbids this row from
	// ever wearing `published-and-refuted` again while its own numbers say the
	// observation is inside the budget.
	regraded := byKey(t, hb, "proxy", fxProxyRefuted.Hex())
	require.Equal(t, "empirical-historical", str(t, regraded, "provenance_grade"))
	require.False(t, boolAt(t, regraded, "budget_refuted"))
	require.EqualValues(t, 248460, num(t, regraded, "observed_max_gap_seconds"))
	require.EqualValues(t, 302400, num(t, regraded, "tested_budget_seconds"))
	require.Contains(t, str(t, regraded, "basis"), "09d496e")
	require.Contains(t, str(t, regraded, "basis"), "REFUTED the retired published budget")

	// THE COHERENCE LAW (Codex r65): every scanned row's verdict must agree
	// with its own served arithmetic. `budget_refuted` iff the observation
	// exceeds the tested budget; a qualified row exceeds its heartbeat but not
	// its budget; and a scanned row's tested budget IS the row's own served
	// heartbeat + grace — the exact inconsistency the old table carried
	// (grade `refuted`, tested budget 90000s, served budget 302400s).
	for _, row := range hb {
		grade := str(t, row, "provenance_grade")
		if at(t, row, "observed_max_gap_seconds") == nil {
			require.Equal(t, "published-not-verified", grade)
			continue
		}
		gap := num(t, row, "observed_max_gap_seconds")
		tested := num(t, row, "tested_budget_seconds")
		require.Equal(t, gap > tested, boolAt(t, row, "budget_refuted"),
			"grade/arithmetic coherence for %v", str(t, row, "proxy"))
		require.EqualValues(t, num(t, row, "heartbeat_seconds")+num(t, row, "grace_seconds"), tested,
			"a scanned row is judged against ITS OWN served budget, %v", str(t, row, "proxy"))
		if grade == "empirical-historical-with-qualifier" {
			require.Greater(t, gap, num(t, row, "heartbeat_seconds"))
			require.LessOrEqual(t, gap, tested)
		}
		if grade == "empirical-historical" {
			require.LessOrEqual(t, gap, num(t, row, "heartbeat_seconds"))
		}
	}

	// The DISCRIMINATOR: a feed the record has NOT judged still reports
	// published-not-verified with NO measurement attached. Without this, a table
	// that graded everything refuted would pass the assertions above.
	unjudged := byKey(t, hb, "proxy", fxProxyUnjudged.Hex())
	require.Equal(t, "published-not-verified", str(t, unjudged, "provenance_grade"))
	require.False(t, boolAt(t, unjudged, "budget_refuted"))
	require.Nil(t, at(t, unjudged, "observed_max_gap_seconds"))
	require.Nil(t, at(t, unjudged, "tested_budget_seconds"))
	require.Contains(t, str(t, unjudged, "basis"), "NOT independently confirmed")

	// And the heartbeat story is loud in the standing disclosures, not only in
	// a nested field a client might never enumerate — CURRENT-TENSE (Codex
	// r65): the active budgets are empirically corrected and NOT refuted; the
	// retired published ones stay refuted as history.
	var heartbeatDisclosure bool
	for _, d := range arr(t, body, "disclosures") {
		if s, _ := d.(string); s != "" &&
			containsAll(s, "empirically corrected heartbeat budgets", "retired published budgets remain refuted") {
			heartbeatDisclosure = true
		}
	}
	require.True(t, heartbeatDisclosure,
		"the corrected heartbeat budgets and their retired refutations must be named in the standing disclosures")

	// Published constants.
	require.EqualValues(t, 5, num(t, body, "constants", "confirmation_blocks"))
	require.EqualValues(t, 60, num(t, body, "constants", "price_poll_seconds"))
	require.EqualValues(t, 5580, num(t, body, "constants", "dm_sweep_worst_case_seconds"))
	require.EqualValues(t, fxPriceBudgetSecs, num(t, body, "constants", "price_budget_seconds"))
	require.EqualValues(t, 2*fxPriceBudgetSecs, num(t, body, "constants", "price_ceiling_seconds"))

	// And the standing disclosures ride on the wire.
	require.GreaterOrEqual(t, len(arr(t, body, "disclosures")), 8)
}

func expectedSchemaVersionForTest(t *testing.T) int64 {
	t.Helper()
	v, err := store.ExpectedSchemaVersion()
	require.NoError(t, err)
	return v
}

// ---------------------------------------------------------------------------
// Supersession against the LIVE cursor read, end to end.
// ---------------------------------------------------------------------------

// TestSupersededBatchIsFlaggedAndStillServed is the law of design spec §4 on the
// wire: the flag is the contract, and the numbers are still served under it.
func TestSupersededBatchIsFlaggedAndStillServed(t *testing.T) {
	f := newAPIFixture(t)

	// A clean read first, so the change below is what produces the flag.
	before := f.getJSON(t, "/v1/book", "/v1/book")
	require.False(t, boolAt(t, before, "batch", "supersession", "superseded"))

	// A rewind happened and was acknowledged: leg 1 fires. The epoch table stays
	// EMPTY, which is the pruned world — so this also exercises the prune-survival
	// case against a real database.
	_, err := f.admin.Exec(f.ctx,
		`UPDATE derive_cursors SET acked_epoch = 1 WHERE engine = $1`, risk.AaveEngine)
	require.NoError(t, err)

	after := f.getJSON(t, "/v1/book", "/v1/book")
	require.True(t, boolAt(t, after, "batch", "supersession", "superseded"))
	legs := arr(t, after, "batch", "supersession", "legs")
	require.Len(t, legs, 1)
	require.Equal(t, legAckedEpochMoved, str(t, legs[0], "leg"))
	require.Equal(t, risk.AaveEngine, str(t, legs[0], "engine"))
	require.Nil(t, at(t, legs[0], "current_max_epoch"), "the epoch rows are pruned; only the monotone ack betrays the rewind")

	// AND THE BOOK IS STILL SERVED, unchanged. Refusing here is not the contract at
	// this grade — the flag is.
	assertBookExactValues(&passthroughT{t}, mustSetSuperseded(after))
}

// passthroughT adapts *testing.T to the jt interface.
type passthroughT struct{ t *testing.T }

func (p *passthroughT) Errorf(format string, args ...any) { p.t.Errorf(format, args...) }
func (p *passthroughT) FailNow()                          { p.t.FailNow() }

// mustSetSuperseded relaxes the one assertion that legitimately differs under a
// superseded batch, so the rest of the exact-value suite can be re-run verbatim.
func mustSetSuperseded(body map[string]any) map[string]any {
	batch := body["batch"].(map[string]any)
	sup := batch["supersession"].(map[string]any)
	sup["superseded"] = false
	sup["legs"] = []any{}
	return body
}

// TestNoCompleteBatchIsAnHonest503 pins that an empty risk schema is reported as a
// statement about the SERVICE, never as an empty book.
func TestNoCompleteBatchIsAnHonest503(t *testing.T) {
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches CASCADE`)
	require.NoError(t, err)

	for _, path := range []struct{ url, contract string }{
		{"/v1/book", "/v1/book"},
		{"/v1/address/" + fxAcctAave.Hex(), "/v1/address/{addr}"},
		{"/v1/address/" + fxAcctAave.Hex() + "/stress", "/v1/address/{addr}/stress"},
	} {
		status, raw := f.get(t, path.url)
		require.Equal(t, http.StatusServiceUnavailable, status, path.url)
		validateContract(t, path.contract, http.StatusServiceUnavailable, raw)
		var e errorBody
		require.NoError(t, json.Unmarshal(raw, &e))
		require.Equal(t, codeUnavailable, e.Error.Code)
		require.Contains(t, e.Error.Message, "NOT a claim that the book is empty")
		require.NotNil(t, e.Error.RetryAfterSeconds)
	}

	// /v1/meta still answers 200: a status surface that goes dark exactly when
	// something is wrong is not a status surface.
	body := f.getJSON(t, "/v1/meta", "/v1/meta")
	require.Nil(t, at(t, body, "batch"))
	require.Contains(t, str(t, body, "batch_unavailable_reason"), "no complete risk batch")
	require.Len(t, arr(t, body, "watermark_vector"), 5)
}

// TestIncompleteBatchIsSkippedNotServed pins the no-torn-aggregates rule: a batch
// whose children were partly removed is UNSERVABLE, and an older whole batch is
// served instead.
func TestIncompleteBatchIsSkippedNotServed(t *testing.T) {
	f := newAPIFixture(t)
	second := f.seedBatch(t, "fixture-materialization-2")

	// Tear the NEWER batch by deleting one aggregate row.
	_, err := f.admin.Exec(f.ctx,
		`DELETE FROM risk_batch_aggregates WHERE batch_id = $1 AND engine = $2`, second, risk.DMEngine)
	require.NoError(t, err)

	body := f.getJSON(t, "/v1/book", "/v1/book")
	require.EqualValues(t, f.batchID, num(t, body, "batch", "id"),
		"the torn batch must be skipped and the older WHOLE batch served — never a torn aggregate")
	assertBookExactValues(&passthroughT{t}, body)
}
