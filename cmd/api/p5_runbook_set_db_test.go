package main

// The set-run's END-TO-END laws: equivalence, invariance, the count partitions,
// atomicity, determinism, the method gate, and the fail-closed census.

import (
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/store"
)

// newSetRunTwoChainFixture is the snap-control book PLUS one address held flat
// on a SECOND chain.
//
// The Aave book prices weETH-on-Ethereum, which `eth_minus_30`'s propagation
// matrix describes on chain 1. This adds a Debt Manager price input for THE SAME
// ADDRESS on chain 10, where that matrix has no row for it. Under `eth_minus_30`
// the one address therefore lands in `applied_shocks` under chain 1 and in
// `held_flat_assets` under chain 10.
//
// That is the fixture the held-flat identity laws need. An address-only list
// cannot state this book at all: it would collapse the two marks into one entry,
// serve a `held_flat_marks` the list cannot account for, and leave the ordering
// of two chains' entries to whatever a map walk chose.
func newSetRunTwoChainFixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	dm := srDMWithPrices(
		srDMPrice(fxAcctDM, srUSDCOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srUSDTOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srFrxUSDOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srLiquidUSDOp, fxOPChain, "1000000"),
		// THE SECOND CHAIN for an address the Aave side already prices.
		srDMPrice(fxAcctDM, fxWeETHEth, fxOPChain, "4000000"),
	)
	f.srSeed(t, srBatchWrite("set-run-two-chain-1",
		fxAavePosition(), fxAaveRefused(), dm, fxDMRefused()))
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)
	return f
}

// TestSetRunEqualsNSingleRunsAtTheSameBatch is THE EQUIVALENCE LAW, and it is
// what makes the shared-before optimization safe rather than merely fast.
//
// The set-run measures the before side ONCE over the union of the requested
// scenarios' covered engines and slices it per engine per scenario. That is
// sound because `risk.Waterfall` accumulates strictly through
// `engineOf(m.engine, ...)` and `measureRunBook`'s walk is per position — but a
// structural argument is not a test, and if slicing ever diverges from a
// per-scenario filtered measure this is where it fails.
//
// No materializer runs in this fixture, so the batch cannot move between the
// three calls and any difference is the implementation's.
func TestSetRunEqualsNSingleRunsAtTheSameBatch(t *testing.T) {
	f := newSetRunTwoChainFixture(t)
	ids := []string{"eth_minus_30", "stable_depeg_0995_in_band"}

	set := f.srRun(t, http.StatusOK, ids...)
	require.Empty(t, asList(t, set["excluded_engines"]),
		"THE PRECONDITION, ASSERTED RATHER THAN ASSUMED: the three per-result rows below hold only when NO covered "+
			"engine is withheld. The single route admits a withheld engine's positions into its ApplyScenario pass while "+
			"the set-run does not, so with a withheld engine the set's applied set is a strict SUBSET "+
			"(TestSetRunWithheldEngineIsNamedAndNotZeroed covers that case).")
	results := srResults(t, set)

	for _, id := range ids {
		single := f.postJSON(t, "/v1/scenarios/"+id+"/run-book", runBookContractPath, http.StatusOK)
		res := results[id]
		require.NotNil(t, res, "the set answered no result for %s", id)

		singleEngines := map[string]map[string]any{}
		for _, e := range asList(t, single["engines"]) {
			m := asMap(t, e)
			singleEngines[m["engine"].(string)] = m
		}

		for engine, sum := range srEngines(t, res) {
			one := singleEngines[engine]
			require.NotNil(t, one, "%s: the single body has no %s row to compare against", id, engine)
			before, after := asMap(t, one["before"]), asMap(t, one["after"])
			hist := asMap(t, before["hf_histogram"])

			// THE EXPLICIT MAPPING. Every row is a field the summary claims to
			// restate, and each is compared as SERVED — decimal strings byte for
			// byte, counts as counts.
			require.Equal(t, one["usd_decimals"], sum["usd_decimals"], "%s/%s usd_decimals", id, engine)
			require.Equal(t, before["accounts"], sum["accounts"], "%s/%s accounts vs before.accounts", id, engine)
			require.Equal(t, after["accounts"], sum["accounts"], "%s/%s accounts vs after.accounts", id, engine)
			require.Equal(t, hist["infinite_count"], sum["infinite_accounts"], "%s/%s infinite_accounts", id, engine)
			require.Equal(t, before["eligible_accounts"], sum["before_eligible_accounts"], "%s/%s", id, engine)
			require.Equal(t, after["eligible_accounts"], sum["after_eligible_accounts"], "%s/%s", id, engine)
			require.Equal(t, one["newly_eligible_accounts"], sum["eligible_accounts_delta"], "%s/%s", id, engine)
			require.Equal(t, before["eligible_debt_usd"], sum["before_eligible_debt_usd"], "%s/%s", id, engine)
			require.Equal(t, one["eligible_debt_delta_usd"], sum["eligible_debt_delta_usd"], "%s/%s", id, engine)
			require.Equal(t, before["bad_debt_usd"], sum["before_bad_debt_usd"], "%s/%s", id, engine)
			require.Equal(t, one["bad_debt_delta_usd"], sum["bad_debt_delta_usd"], "%s/%s", id, engine)
			require.Equal(t, before["collateral_at_risk_usd"], sum["before_collateral_at_risk_usd"], "%s/%s", id, engine)
			require.Equal(t, after["collateral_at_risk_usd"], sum["after_collateral_at_risk_usd"], "%s/%s", id, engine)
			require.Equal(t, before["total_debt_usd"], sum["total_debt_usd_before"], "%s/%s", id, engine)
			require.Equal(t, after["total_debt_usd"], sum["total_debt_usd_after"], "%s/%s", id, engine)
			require.Equal(t, before["total_collateral_usd"], sum["total_collateral_usd_before"], "%s/%s", id, engine)
			require.Equal(t, after["total_collateral_usd"], sum["total_collateral_usd_after"], "%s/%s", id, engine)
			require.Equal(t, one["market_realization"], sum["market_realization"], "%s/%s", id, engine)
			require.Equal(t, one["projection"], sum["projection"], "%s/%s", id, engine)

			// THE MOVEMENT COUNT IS ENGINE-CONDITIONAL. Mapping `movers_total` to
			// `flipped_to_eligible` on EVERY engine would enshrine the wrong
			// reading in the very test meant to catch it: on Aave that number is a
			// count of health-factor drops.
			switch engine {
			case risk.AaveEngine:
				require.Equal(t, movementHFStrictlyDropped, sum["movement_rule"])
				require.Equal(t, one["movers_total"], sum["hf_dropped_accounts"], "%s/%s hf_dropped", id, engine)
				require.Nil(t, sum["flipped_to_eligible"])
			default:
				require.Equal(t, movementEligibilityFlip, sum["movement_rule"])
				require.Equal(t, one["movers_total"], sum["flipped_to_eligible"], "%s/%s flips", id, engine)
				require.Nil(t, sum["hf_dropped_accounts"])
			}

			// THE THREE FIELDS WITH NO SINGLE-BODY COUNTERPART, asserted as such
			// rather than mapped to an invented one. `RunBookEngine` carries no
			// `refused_positions` property at all; the nearest number is
			// `before.hf_histogram.refused_count`, which folds refused-in-batch AND
			// unrebuildable AND rebuilt-rows-with-no-comparator into one integer
			// under a label naming only the third. So the relation is an
			// INEQUALITY, and stating it that way is what stops a future author
			// mistaking the histogram field for the sum.
			require.NotContains(t, one, "refused_positions",
				"the single-scenario engine row has grown a `refused_positions` field; the mapping table above must be "+
					"re-derived rather than extended, because that number is not this one")
			require.LessOrEqual(t,
				intOf(t, sum["refused_in_batch_positions"])+intOf(t, sum["unrebuildable_positions"]),
				intOf(t, hist["refused_count"]),
				"%s/%s: the two split counters must be BOUNDED BY, never equal to, the histogram's wider tally", id, engine)
		}

		// PER RESULT, NOT PER ENGINE.
		reach := asMap(t, res["shock_reach"])
		require.Equal(t, single["applied_shocks"], reach["applied_shocks"],
			"%s: the set-run's applied set is the single route's, element for element, at the same batch", id)

		held := asList(t, single["held_flat"])
		require.Equal(t, len(held), intOf(t, reach["held_flat_marks"]),
			"%s: held_flat_marks IS len(held_flat) on the single body", id)

		// THE PAIR MAPPING, and it is a PAIR mapping on purpose. Projecting the
		// single body's rows down to addresses before comparing would make this
		// row pass against a set-run that had LOST the chain id, which is the
		// defect it exists to catch.
		type pair struct {
			chain uint64
			asset string
		}
		seen := map[pair]bool{}
		var want []map[string]any
		for _, h := range held {
			m := asMap(t, h)
			p := pair{chain: uint64(intOf(t, m["chain_id"])), asset: m["asset"].(string)}
			if seen[p] {
				continue
			}
			seen[p] = true
			want = append(want, map[string]any{"chain_id": m["chain_id"], "asset": m["asset"]})
		}
		sort.Slice(want, func(i, j int) bool {
			ci, cj := intOf(t, want[i]["chain_id"]), intOf(t, want[j]["chain_id"])
			if ci != cj {
				return ci < cj
			}
			return strings.ToLower(want[i]["asset"].(string)) < strings.ToLower(want[j]["asset"].(string))
		})
		got := []map[string]any{}
		for _, a := range asList(t, reach["held_flat_assets"]) {
			got = append(got, asMap(t, a))
		}
		require.Equal(t, want, got, "%s: held_flat_assets is the distinct (chain_id, asset) PAIRS of the single body's held_flat", id)
	}

	// THE FIXTURE ITSELF IS DISCRIMINATING, asserted rather than assumed: one
	// address must appear under TWO chain ids across the two arrays, or the pair
	// mapping above is satisfiable by an address-only implementation and proves
	// nothing.
	reach := asMap(t, results["eth_minus_30"]["shock_reach"])
	appliedChains := map[int]bool{}
	for _, a := range asList(t, reach["applied_shocks"]) {
		m := asMap(t, a)
		if strings.EqualFold(m["asset"].(string), fxWeETHEth.Hex()) {
			appliedChains[intOf(t, m["chain_id"])] = true
		}
	}
	heldChains := map[int]bool{}
	for _, a := range asList(t, reach["held_flat_assets"]) {
		m := asMap(t, a)
		if strings.EqualFold(m["asset"].(string), fxWeETHEth.Hex()) {
			heldChains[intOf(t, m["chain_id"])] = true
		}
	}
	require.True(t, appliedChains[1], "the fixture must price %s on chain 1, where the matrix describes it", fxWeETHEth.Hex())
	require.True(t, heldChains[10], "the fixture must price the SAME address on chain 10, where the matrix does not — "+
		"without it, one address on two chains is never exercised and the pair identity is unfalsifiable")
}

// TestSetRunBeforeSideIsScenarioInvariant enumerates ELEVEN fields and never
// pattern-matches a prefix.
//
// A law written over `before_*` and `total_*` would sweep in
// `total_collateral_usd_after` and `total_debt_usd_after`, which are AFTER-side
// quantities that vary with the shock BY CONSTRUCTION — so the law as written
// over prefixes fails on the very body it describes.
func TestSetRunBeforeSideIsScenarioInvariant(t *testing.T) {
	f := newSetRunTwoChainFixture(t)
	// Four scenarios covering the Debt Manager, of which two also cover Aave,
	// and spanning four DIFFERENT reach arms — so invariance is asserted across
	// scenarios that do genuinely different things to the after side.
	out := f.srRun(t, http.StatusOK,
		"eth_minus_30", "eth_minus_60", "stable_depeg_0995_in_band", "dm_composition_census")

	invariant := []string{
		"accounts", "infinite_accounts", "movement_excluded_accounts",
		"refused_in_batch_positions", "unrebuildable_positions",
		"before_eligible_accounts", "before_eligible_debt_usd", "before_bad_debt_usd",
		"before_collateral_at_risk_usd", "total_debt_usd_before", "total_collateral_usd_before",
	}
	first := map[string]map[string]any{}
	firstID := map[string]string{}
	varies := 0
	for _, res := range srResults(t, out) {
		id := res["scenario_id"].(string)
		for engine, sum := range srEngines(t, res) {
			base, seen := first[engine]
			if !seen {
				first[engine], firstID[engine] = sum, id
				continue
			}
			for _, field := range invariant {
				require.Equal(t, base[field], sum[field],
					"%s differs on %s between scenarios %s and %s. At a FIXED BATCH this field is scenario-invariant: "+
						"`risk.Waterfall` accumulates only through the position's own engine and `measureRunBook`'s walk "+
						"is per position, so slicing ONE shared before measure per engine must give every scenario exactly "+
						"what a per-scenario filtered measure would.",
					field, engine, firstID[engine], id)
			}
			if base["total_debt_usd_after"] != sum["total_debt_usd_after"] ||
				base["total_collateral_usd_after"] != sum["total_collateral_usd_after"] {
				varies++
			}
		}
	}
	require.NotEmpty(t, first, "the run answered no engine at all — a vacuous invariance")
	require.Positive(t, varies,
		"NO after-side quantity varied across these scenarios, so this law could have been written over the `total_*` "+
			"PREFIX and passed. The fixture must include scenarios whose after side genuinely differs, or the "+
			"never-pattern-match rule is untested.")

	// `movement_excluded_accounts` is in the invariant set ON PURPOSE and is the
	// one non-obvious member: on Aave the exclusion reads the AFTER side too, and
	// a shock neither gives a debt-free account a health factor nor takes one
	// away. If a scenario ever makes it vary, that is a finding and this is where
	// it surfaces.
	require.Contains(t, invariant, "movement_excluded_accounts")
}

// TestSetRunCountsPartitionExactly is the arithmetic every other law leans on.
func TestSetRunCountsPartitionExactly(t *testing.T) {
	f := newSetRunTwoChainFixture(t)
	out := f.srRun(t, http.StatusOK,
		"eth_minus_30", "stable_depeg_0995_in_band", "dm_composition_census", "weeth_market_depeg_oracles_held")

	requested := srStrings(t, out["requested_scenario_ids"])
	results := srResults(t, out)

	// (a) MEMBERSHIP PARTITIONS EXACTLY, as multisets.
	got := []string{}
	for _, r := range asList(t, out["results"]) {
		got = append(got, asMap(t, r)["scenario_id"].(string))
	}
	sortedRequested := append([]string(nil), requested...)
	sortedGot := append([]string(nil), got...)
	sort.Strings(sortedRequested)
	sort.Strings(sortedGot)
	require.Equal(t, sortedRequested, sortedGot,
		"`results[].scenario_id` and `requested_scenario_ids` must be the SAME MULTISET — no id in two results, none in "+
			"none. It is one line to check and it is impossible to satisfy while hiding a hole.")

	// (b)
	require.Equal(t, len(got), intOf(t, asMap(t, out["evaluation"])["scenarios_evaluated"]))

	census := srCensus(t, out)
	cov := asMap(t, out["coverage"])

	for id, res := range results {
		covered := srStrings(t, res["covered_engines"])
		withheld := srStrings(t, res["withheld_engines"])
		var unmeasurable []string
		for _, a := range asList(t, res["unmeasurable_engines"]) {
			unmeasurable = append(unmeasurable, asMap(t, a)["engine"].(string))
		}
		answered := []string{}
		for e := range srEngines(t, res) {
			answered = append(answered, e)
		}

		// (c) THE ENGINE PARTITION, IN THREE PARTS, pairwise disjoint.
		union := append(append(append([]string{}, answered...), withheld...), unmeasurable...)
		sortedUnion := append([]string(nil), union...)
		sortedCovered := append([]string(nil), covered...)
		sort.Strings(sortedUnion)
		sort.Strings(sortedCovered)
		require.Equal(t, sortedCovered, sortedUnion,
			"%s: engines ++ withheld_engines ++ unmeasurable_engines is not sort(covered_engines). A covered engine "+
				"absent from all three is the HOLE class; one in two of them is the CONTRADICTION class.", id)
		seen := map[string]bool{}
		for _, e := range union {
			require.False(t, seen[e], "%s: engine %s appears in more than one part of the partition", id, e)
			seen[e] = true
		}
		for e, sum := range srEngines(t, res) {
			require.Positive(t, intOf(t, sum["accounts"]),
				"%s: engine %s is served as a NUMERIC ROW with zero measurable accounts — the zero-row class. It belongs "+
					"in `unmeasurable_engines` with its reason.", id, e)
		}

		// (d) THE TWO POSITION COUNTS.
		sumAccounts := 0
		for _, sum := range srEngines(t, res) {
			sumAccounts += intOf(t, sum["accounts"])
		}
		require.Equal(t, sumAccounts, intOf(t, res["positions_answered"]), "%s: positions_answered", id)
		measurable := 0
		for _, e := range covered {
			if row, ok := census[e]; ok {
				measurable += intOf(t, row["measurable"])
			}
		}
		require.Equal(t, measurable, intOf(t, res["positions_answered"])+intOf(t, res["positions_withheld"]),
			"%s: answered + withheld must be exactly the reconstructable population of this scenario's covered engines", id)

		// (g) THE TWO REFUSAL CLASSES CANNOT DRIFT FROM THE CENSUS.
		for e, sum := range srEngines(t, res) {
			row := census[e]
			require.NotNil(t, row, "%s: engine %s answers a row and has no census entry", id, e)
			require.Equal(t, row["refused_in_batch"], sum["refused_in_batch_positions"], "%s/%s", id, e)
			require.Equal(t, row["unrebuildable"], sum["unrebuildable_positions"], "%s/%s", id, e)
			require.Equal(t, row["measurable"], sum["accounts"], "%s/%s", id, e)

			// (h) THE MOVEMENT DENOMINATOR BOUNDS.
			acc := intOf(t, sum["accounts"])
			exc := intOf(t, sum["movement_excluded_accounts"])
			require.LessOrEqual(t, intOf(t, sum["infinite_accounts"]), acc, "%s/%s infinite <= accounts", id, e)
			require.LessOrEqual(t, exc, acc, "%s/%s excluded <= accounts", id, e)
			if e == risk.AaveEngine {
				require.LessOrEqual(t, intOf(t, sum["hf_dropped_accounts"]), acc-exc, "%s/%s", id, e)
			} else {
				require.LessOrEqual(t, intOf(t, sum["flipped_to_eligible"]), acc-exc, "%s/%s", id, e)
			}
		}

		// (i) THE FLAG CENSUS IS BOUNDED AND NEVER SUMMED.
		reach := asMap(t, res["shock_reach"])
		applied := len(asList(t, reach["applied_shocks"]))
		for _, k := range []string{"marks_moved", "marks_snapped", "marks_base_snapped", "marks_cap_bound"} {
			require.LessOrEqual(t, intOf(t, reach[k]), applied, "%s: %s exceeds len(applied_shocks)", id, k)
		}

		// (j) THE CAUSE PARTITION CLOSES EXACTLY.
		require.Equal(t, applied,
			intOf(t, reach["marks_moved"])+intOf(t, reach["marks_held_by_declared_factor"])+
				intOf(t, reach["marks_held_by_transform"])+intOf(t, reach["marks_held_by_arithmetic"]),
			"%s: marks_moved plus the three cause counts must be EXACTLY len(applied_shocks)", id)
		require.LessOrEqual(t, intOf(t, reach["declared_shocks_at_identity"]), intOf(t, reach["declared_shocks"]), id)
		require.Equal(t, len(asList(t, res["shocks"])), intOf(t, reach["declared_shocks"]), id)
	}

	// (e) THE SET-LEVEL CENSUS PARTITION on a served 200. Test Law 25 is what
	// makes this true rather than lucky, by driving the row that would break it
	// and asserting no 200 is served at all.
	require.Equal(t, intOf(t, cov["batch_positions"]),
		intOf(t, cov["in_book"])+intOf(t, cov["refused_in_batch"])+intOf(t, cov["excluded_by_this_layer"]),
		"batch_positions must be EXACTLY in_book + refused_in_batch + excluded_by_this_layer")
	require.Positive(t, intOf(t, cov["batch_positions"]), "a vacuous census")

	// (f) THE PER-ENGINE CENSUS SUMS TO EACH SET-LEVEL FIELD.
	for _, pair := range [][2]string{
		{"positions_in_batch", "batch_positions"}, {"measurable", "in_book"},
		{"refused_in_batch", "refused_in_batch"}, {"unrebuildable", "excluded_by_this_layer"},
	} {
		total := 0
		for _, row := range census {
			total += intOf(t, row[pair[0]])
		}
		require.Equal(t, intOf(t, cov[pair[1]]), total, "Σ engines[].%s must equal coverage.%s", pair[0], pair[1])
	}
}

// TestSetRunIsAtomicOnAnUnknownId: one uncommitted id refuses the WHOLE set,
// before any compute, naming EVERY unknown id.
//
// Serving 14 of 15 under a shared envelope while dropping one is the silent-hole
// class this whole surface is built to refuse: the reader would see 14 bars and
// no statement that a 15th was asked for.
func TestSetRunIsAtomicOnAnUnknownId(t *testing.T) {
	f := newP5Fixture(t)

	// The ids are asserted NOT COMMITTED against the loader itself, so the
	// fixture cannot rot the day somebody commits one of them.
	scenarios, err := risk.LoadScenarios()
	require.NoError(t, err)
	committed := map[string]bool{}
	for _, sc := range scenarios {
		committed[sc.ID] = true
	}
	for _, id := range []string{"eth_minus_99", "eth_plus_10"} {
		require.False(t, committed[id], "%s is now COMMITTED; pick an id this deployment does not publish", id)
	}

	// THE PRECONDITION FORM OF THE RELEASE LAW. Asserting "the slot was released"
	// on this path would be vacuous — nothing is acquired before a 404 — so what
	// is checkable is that the gauge never ROSE. The bound is narrowed to one and
	// a slot is HELD, so a request that tried to acquire would be refused 503
	// busy instead of 404.
	f.srv.setRuns = newSetRunGate(1)
	release := f.srHoldOneSlot(t)
	defer release()

	status, raw := f.srPost(t, srBody("eth_minus_10", "eth_minus_99", "eth_plus_10"))
	require.Equal(t, http.StatusNotFound, status,
		"a 404 must be answered while every slot is held — the membership check happens BEFORE the acquire, and this "+
			"body proves the gauge never rose rather than merely returned to zero")
	validateContractMethod(t, setRunContractPath, http.MethodPost, http.StatusNotFound, raw)
	body := string(raw)
	require.Contains(t, body, `\"eth_minus_99\"`)
	require.Contains(t, body, `\"eth_plus_10\"`)
	require.Contains(t, body, "The WHOLE set is refused rather than partly served")
	require.NotContains(t, body, "results", "no partial body")
	require.NotContains(t, body, "coverage")

	// NO COMPUTE HAPPENED, asserted through the handler's own seam rather than
	// through timing: the interleave hook fires immediately after the acquire and
	// before the batch read, so a request that reached any compute would have
	// fired it.
	require.Equal(t, 1, f.srv.setRuns.gauge(),
		"the gauge moved during a 404: the membership refusal must happen before the acquire")
}

// TestSetRunRefusesDuplicatesAndOverCap: every SHAPE refusal, each naming what
// is wrong rather than the nearest wrong thing.
func TestSetRunRefusesDuplicatesAndOverCap(t *testing.T) {
	f := newP5Fixture(t)

	t.Run("duplicates name every repeat", func(t *testing.T) {
		status, raw := f.srPost(t, srBody("eth_minus_10", "eth_minus_10", "eth_minus_20", "eth_minus_20", "eth_minus_30"))
		require.Equal(t, http.StatusBadRequest, status)
		validateContractMethod(t, setRunContractPath, http.MethodPost, http.StatusBadRequest, raw)
		require.Contains(t, string(raw), `eth_minus_10`)
		require.Contains(t, string(raw), `eth_minus_20`)
		require.Contains(t, string(raw), "a set is a set")
	})

	t.Run("over the cap names the bound and the count", func(t *testing.T) {
		ids := make([]string, 0, maxSetRunScenarios+1)
		for i := 0; i <= maxSetRunScenarios; i++ {
			ids = append(ids, "id_"+strings.Repeat("a", i%5)+"_"+string(rune('a'+i)))
		}
		require.Len(t, ids, maxSetRunScenarios+1)
		status, raw := f.srPost(t, srBody(ids...))
		require.Equal(t, http.StatusBadRequest, status)
		require.Contains(t, string(raw), "25 ids")
		require.Contains(t, string(raw), "at most 24")
	})

	t.Run("an empty array states there is no implicit all", func(t *testing.T) {
		status, raw := f.srPost(t, `{"scenario_ids":[]}`)
		require.Equal(t, http.StatusBadRequest, status)
		require.Contains(t, string(raw), "no implicit")
		require.Contains(t, string(raw), "GET /v1/scenarios")
	})

	t.Run("an unknown field is named, NOT reported as an empty set", func(t *testing.T) {
		status, raw := f.srPost(t, `{"scenarios":["eth_minus_10"]}`)
		require.Equal(t, http.StatusBadRequest, status)
		require.Contains(t, string(raw), "scenarios",
			"the FIELD NAME must be named: a 400 about an empty set reads as \"you asked for nothing\", which is a "+
				"different and false statement about what the client did")
		require.NotContains(t, string(raw), "no implicit")
	})

	t.Run("an oversized body is refused on its size", func(t *testing.T) {
		status, raw := f.srPost(t, `{"scenario_ids":["`+strings.Repeat("a", 9<<10)+`"]}`)
		require.Equal(t, http.StatusBadRequest, status)
		require.Contains(t, string(raw), "exceeds 8192 bytes")
	})

	t.Run("an absent body names the required field", func(t *testing.T) {
		status, raw := f.srPost(t, ``)
		require.Equal(t, http.StatusBadRequest, status)
		require.Contains(t, string(raw), "scenario_ids")
	})

	t.Run("a malformed id names every offender", func(t *testing.T) {
		status, raw := f.srPost(t, srBody("eth_minus_10", "NOT AN ID", "../../etc/passwd"))
		require.Equal(t, http.StatusBadRequest, status)
		require.Contains(t, string(raw), "NOT AN ID")
		require.Contains(t, string(raw), "etc/passwd")
	})
}

// TestSetRunResultsAreInRequestOrder: the client asked in an order and gets its
// answer back in it. A tornado's row order is the client's to choose.
func TestSetRunResultsAreInRequestOrder(t *testing.T) {
	f := newSetRunTwoChainFixture(t)
	// DELIBERATELY UNSORTED, and deliberately not the alphabetical order either,
	// so a server that sorted would differ from a server that did not.
	ids := []string{"stable_depeg_0995_in_band", "eth_minus_30", "dm_composition_census", "btc_leg_minus_20"}
	sorted := append([]string(nil), ids...)
	sort.Strings(sorted)
	require.NotEqual(t, sorted, ids, "the request order must differ from sorted order or this law is untestable")

	out := f.srRun(t, http.StatusOK, ids...)
	got := []string{}
	for _, r := range asList(t, out["results"]) {
		got = append(got, asMap(t, r)["scenario_id"].(string))
	}
	require.Equal(t, ids, got)
	require.Equal(t, ids, srStrings(t, out["requested_scenario_ids"]), "`requested_scenario_ids` is echoed VERBATIM")
}

// TestSetRunIsByteDeterministic: two identical requests against one batch serve
// byte-identical responses modulo the three clock fields and the ages derived
// from them.
func TestSetRunIsByteDeterministic(t *testing.T) {
	f := newSetRunTwoChainFixture(t)
	ids := []string{"eth_minus_30", "stable_depeg_0995_in_band", "dm_composition_census"}

	first := f.srRun(t, http.StatusOK, ids...)
	second := f.srRun(t, http.StatusOK, ids...)
	for _, body := range []map[string]any{first, second} {
		normalizeSetRunServeTime(t, body)
	}
	require.Equal(t, first, second,
		"two identical requests against the same batch served different bytes. Every array on this surface is ordered by "+
			"a stated key — engine name, `appliedShockKey`, and (chain_id, asset) for held-flat identities — so a "+
			"difference here is a map walk reaching the wire.")

	// The ordering laws, stated over the served body rather than trusted.
	for _, res := range srResults(t, first) {
		id := res["scenario_id"].(string)
		for _, key := range []string{"covered_engines", "withheld_engines"} {
			require.True(t, sort.StringsAreSorted(srStrings(t, res[key])),
				"%s: %s is not sorted by engine name", id, key)
		}
		var engines []string
		for _, e := range asList(t, res["engines"]) {
			engines = append(engines, asMap(t, e)["engine"].(string))
		}
		require.True(t, sort.StringsAreSorted(engines), "%s: engines[] is not sorted by engine name", id)

		var keys []string
		for _, a := range asList(t, asMap(t, res["shock_reach"])["applied_shocks"]) {
			m := asMap(t, a)
			keys = append(keys, appliedShockKey(wireAppliedShock{
				Asset: m["asset"].(string), ChainID: uint64(intOf(t, m["chain_id"])), Source: m["source"].(string),
				FactorNum: m["factor_num"].(string), FactorDen: m["factor_den"].(string),
				Before: m["before"].(string), After: m["after"].(string),
				Snapped: m["snapped"].(bool), BaseSnapped: m["base_snapped"].(bool), CapBound: m["cap_bound"].(bool),
			}))
		}
		require.True(t, sort.StringsAreSorted(keys), "%s: applied_shocks is not sorted by appliedShockKey", id)

		// (chain_id, asset), chain id FIRST. Sorting by address alone leaves the
		// order of two chains' entries for one address to the map walk, and this
		// fixture is the one that can see it.
		var pairs []string
		for _, a := range asList(t, asMap(t, res["shock_reach"])["held_flat_assets"]) {
			m := asMap(t, a)
			pairs = append(pairs, string(rune('0'+intOf(t, m["chain_id"])))+"|"+strings.ToLower(m["asset"].(string)))
		}
		sorted := append([]string(nil), pairs...)
		sort.Strings(sorted)
		require.Equal(t, sorted, pairs, "%s: held_flat_assets is not ascending on (chain_id, lowercased asset)", id)
	}

	var cens []string
	for _, e := range asList(t, asMap(t, first["coverage"])["engines"]) {
		cens = append(cens, asMap(t, e)["engine"].(string))
	}
	require.True(t, sort.StringsAreSorted(cens), "coverage.engines is not sorted by engine name")
}

// TestReadOnlyGateAdmitsExactlyTwoPosts: the gate opens by EXACT MATCH, never
// for a path family.
//
// `/v1/scenarios/set/run-book` is deliberately NOT special-cased: `set` matches
// the committed-id pattern, so reserving that word out of the id space would be
// a trap that fires the day someone commits a scenario called `set`. It reaches
// the id route and gets the honest answer — a 404 about a committed scenario.
func TestReadOnlyGateAdmitsExactlyTwoPosts(t *testing.T) {
	f := newP5Fixture(t)

	f.srRun(t, http.StatusOK, "eth_minus_10")

	status, raw := f.post(t, "/v1/scenarios/run-book-set/anything")
	require.Equal(t, http.StatusMethodNotAllowed, status, "body: %s", truncate(raw))
	require.Contains(t, string(raw), "/v1/scenarios/{id}/run-book")
	require.Contains(t, string(raw), "/v1/scenarios/run-book-set")

	status, raw = f.post(t, "/v1/scenarios/set/run-book")
	require.Equal(t, http.StatusNotFound, status, "body: %s", truncate(raw))
	require.Contains(t, string(raw), "no committed scenario",
		"`set` is a legal committed id, so this path must reach the id route and answer honestly about the id — never "+
			"be special-cased into the set-run")

	status, raw = f.post(t, "/v1/book")
	require.Equal(t, http.StatusMethodNotAllowed, status, "body: %s", truncate(raw))
	require.Contains(t, string(raw), "read-only")
}

// TestSetRunCensusRefusesAThirdStatusToken is the law that EARNS the census
// equality.
//
// Test Law 4(e) asserts the partition on a served body, and it cannot fail on a
// book where the partition is already true — every committed fixture writes only
// `computed` and `refused`. This law constructs the row the partition has no
// cell for.
//
// The mutation is legal against the schema PRECISELY because the column carries
// no CHECK: `risk_positions.status` is bare `TEXT NOT NULL` with the vocabulary
// in a comment, `WriteRiskBatch` binds it unvalidated, and `reconstructAll`
// skips a non-computed row without setting `reconstructionErr`. That is the
// fact under test. The SQL is admin-side test setup, not handler code, so
// `TestAPIIssuesNoWritingSQL` is unaffected; and it changes no COUNT, so the
// batch stays complete and servable and the request gets far enough to reach the
// census, which is the point.
func TestSetRunCensusRefusesAThirdStatusToken(t *testing.T) {
	f := newP5Fixture(t)

	// (d) THE CONTROL, FIRST: the clean book serves 200 and satisfies the
	// partition, so the refusal below is the mutation's doing and this law
	// cannot pass by refusing everything.
	clean := f.srRun(t, http.StatusOK, "eth_minus_10")
	cov := asMap(t, clean["coverage"])
	require.Equal(t, intOf(t, cov["batch_positions"]),
		intOf(t, cov["in_book"])+intOf(t, cov["refused_in_batch"])+intOf(t, cov["excluded_by_this_layer"]))

	var mutated struct{ engine, account string }
	require.NoError(t, f.admin.QueryRow(f.ctx,
		`UPDATE risk_positions SET status = 'compute'
		  WHERE batch_id = $1 AND engine = $2 AND status = $3
		  RETURNING engine, encode(account, 'hex')`,
		f.batchID, risk.AaveEngine, store.RiskPositionRefused).Scan(&mutated.engine, &mutated.account))

	status, raw := f.srPost(t, srBody("eth_minus_10"))
	body := string(raw)

	// (a) NO 200 IS SERVED. The assertion is on the STATUS and the CODE rather
	// than only on the absence of the equality, because "the 200 was wrong" and
	// "there was no 200" are different outcomes and only the second is the claim.
	require.Equal(t, http.StatusInternalServerError, status, "body: %s", truncate(raw))
	require.Contains(t, body, `"code":"internal"`)

	// (b) THE MESSAGE NAMES THE ROW, so an operator finds it without reading code.
	require.Contains(t, body, mutated.engine)
	require.Contains(t, strings.ToLower(body), strings.ToLower(mutated.account))
	require.Contains(t, body, `\"compute\"`, "the offending status verbatim, through sanitize")

	// (c) THE BODY IS NOT PARTIAL.
	for _, absent := range []string{`"results"`, `"coverage"`, `"batch"`} {
		require.NotContains(t, body, absent, "a refusal must carry no fragment of the answer it refused to give")
	}

	// (e) THE NEGATIVE CONTROL THAT PINS THE DEFECT THIS REPLACES, at the
	// `positionRow` level and in this package, so the test states the REASON the
	// refusal exists and not merely its effect.
	v, err := f.srv.readBatch(f.ctx, nil)
	require.NoError(t, err)
	var row *positionRow
	for _, p := range v.Positions {
		if p.Status == "compute" {
			row = p
		}
	}
	require.NotNil(t, row, "the mutated row must still be READ — it is inside the batch and inside coverage()'s len(positions)")
	require.NotEqual(t, store.RiskPositionRefused, row.Status,
		"it does not match coverage()'s POSITIVE refused-in-batch predicate")
	require.Empty(t, row.reconstructionErr,
		"and it does not match the excluded-by-this-layer predicate either: reconstructAll skips a non-computed row "+
			"WITHOUT recording a reconstruction error")
	require.Nil(t, row.input, "and it never reached reconstruction, so it is not in_book")
	require.NotEmpty(t, coverage(v.Positions, 0, nil).BatchPositions,
		"while `batch_positions` counts it, because that field is len(positions). THAT is the hole: the stated equality "+
			"would be FALSE on a served 200, `book_is_measurable` would read true, `excluded` would be empty, and the "+
			"response would drop a row while publishing a census saying nothing was dropped.")
}
