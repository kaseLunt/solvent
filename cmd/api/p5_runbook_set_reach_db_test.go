package main

// The `shock_reach` laws — the two the whole component exists for, and the
// seven-arm totality law that keeps them apart.

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// srScenarioFile reads a COMMITTED definition through the loader, so a law that
// pins a number off a scenario file rots loudly the day the file is edited
// rather than silently asserting yesterday's shape.
func srScenarioFile(t *testing.T, id string) risk.Scenario {
	t.Helper()
	scenarios, err := risk.LoadScenarios()
	require.NoError(t, err)
	for _, sc := range scenarios {
		if sc.ID == id {
			return sc
		}
	}
	t.Fatalf("no committed scenario %q", id)
	return risk.Scenario{}
}

// srInject registers a SEEDED scenario on the running server.
//
// Three arms have NO committed exemplar, and the spec says so rather than naming
// a scenario that produces a different arm. A seeded definition is how those
// arms ship tested; each one below validates through `risk.Scenario.Validate`
// exactly as a committed file must, so a fixture that could not be committed
// cannot be tested either.
func (f *apiFixture) srInject(t *testing.T, sc risk.Scenario) {
	t.Helper()
	require.NoError(t, sc.Validate(), "a seeded scenario must satisfy the SAME validator a committed file does")
	f.srv.byID[sc.ID] = sc
}

func srAxis(axis risk.Axis, asset common.Address) risk.AxisRef {
	return risk.AxisRef{Axis: axis, Asset: asset.Hex()}
}

// ---------------------------------------------------------------------------
// The hold-cause book: arm 5 with a cause the pricing transforms did not supply
// ---------------------------------------------------------------------------

// srDustOp is a fixture-local Debt Manager mark whose whole job is the
// ARITHMETIC hold.
//
// At a 6-decimal USD mark of 500 (0.0005) under the up-factor 1001/1000,
// `MulDivFloor(500, 1001, 1000)` is floor(500.5) = 500: the mark comes back at
// the value it started at with no stable snap, no snapped base and no price cap
// anywhere near it, so `setRunHeldCause` classifies it `arithmetic`. The
// committed set has no exemplar of that hold, which is how a sentence blaming
// the pricing transforms for every arm-5 zero survived.
var srDustOp = common.HexToAddress("0x00000000000000000000000000000000000D0570")

const (
	srMixedHoldScenario      = "sr_mixed_hold_causes"
	srArithmeticHoldScenario = "sr_arithmetic_hold_only"
)

// srArithmeticHoldRow is the dust mark's propagation row: ONE asset_usd axis and
// no transform flag of any kind, so nothing but the arithmetic can hold it.
func srArithmeticHoldRow() risk.AssetResponse {
	return risk.AssetResponse{
		Asset: srDustOp.Hex(), ChainID: fxOPChain, Symbol: "DUST",
		RespondsTo: []risk.AxisRef{srAxis(risk.AxisAssetUSD, srDustOp)},
	}
}

func srArithmeticHoldShock() risk.Shock {
	return risk.Shock{Axis: risk.AxisAssetUSD, Asset: srDustOp.Hex(), FactorNum: 1001, FactorDen: 1000}
}

// newSetRunHoldCauseFixture prices BOTH hold causes on one book: a par-marked
// stable the committed in-band factor snaps back (a TRANSFORM hold) and the dust
// mark the arithmetic returns unchanged (an ARITHMETIC hold). It injects two
// seeded scenarios over them — one reaching both marks, one reaching only the
// dust — so arm 5 is exercised on the mixed composition and on the
// arithmetic-only composition, neither of which any committed scenario produces.
func newSetRunHoldCauseFixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	dm := srDMWithPrices(
		srDMPrice(fxAcctDM, srUSDCOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srDustOp, fxOPChain, "500"),
	)
	f.srSeed(t, srBatchWrite("set-run-hold-cause-1",
		fxAavePosition(), fxAaveRefused(), dm, fxDMRefused()))
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)

	f.srInject(t, risk.Scenario{
		ID: srMixedHoldScenario, Version: "v1",
		Label: "seeded: one mark pinned by a transform, one returned by arithmetic", Description: "seeded fixture",
		PathAssumption: "seeded fixture: two sized shocks, and every mark they reach comes back at the value it started " +
			"at for two DIFFERENT reasons",
		Engines: []string{risk.DMEngine},
		Shocks: []risk.Shock{
			{Axis: risk.AxisStableUSD, Asset: srUSDCOp.Hex(), FactorNum: 995, FactorDen: 1000},
			srArithmeticHoldShock(),
		},
		Propagation: []risk.AssetResponse{
			{
				Asset: srUSDCOp.Hex(), ChainID: fxOPChain, Symbol: "USDC",
				RespondsTo: []risk.AxisRef{srAxis(risk.AxisStableUSD, srUSDCOp)},
				StableSnap: true,
			},
			srArithmeticHoldRow(),
		},
		OutOfModel: []string{"seeded fixture for the mixed hold-cause composition"},
	})
	f.srInject(t, risk.Scenario{
		ID: srArithmeticHoldScenario, Version: "v1",
		Label: "seeded: every hold is exact-integer arithmetic", Description: "seeded fixture",
		PathAssumption: "seeded fixture: one sized shock, reaching one mark the arithmetic returns unchanged",
		Engines:        []string{risk.DMEngine},
		Shocks:         []risk.Shock{srArithmeticHoldShock()},
		Propagation:    []risk.AssetResponse{srArithmeticHoldRow()},
		OutOfModel:     []string{"seeded fixture for the arithmetic-only hold-cause composition"},
	})
	return f
}

// ---------------------------------------------------------------------------
// The declared-hold-inside-arm-5 book: a hold arm 3 does NOT take
// ---------------------------------------------------------------------------

const (
	srDeclaredAndTransformScenario = "sr_declared_and_transform_hold"
	srAllThreeHoldScenario         = "sr_all_three_hold_causes"
)

// srIdentityHoldRow is a plain propagation row — no snap, no base, no cap — so
// the ONLY thing that can hold the mark it describes is the identity factor the
// scenario declares for it. A row carrying a transform flag would leave the
// cause ambiguous to a reader even though `setRunHeldCause` orders it, and this
// fixture's whole point is a cause that is unarguable from the book.
func srIdentityHoldRow(asset common.Address, symbol string) risk.AssetResponse {
	return risk.AssetResponse{
		Asset: asset.Hex(), ChainID: fxOPChain, Symbol: symbol,
		RespondsTo: []risk.AxisRef{srAxis(risk.AxisAssetUSD, asset)},
	}
}

// srSnappedStableRow is the committed in-band control's shape for one stable:
// `stable_snap`, which pins floor(1000000 × 995/1000) = 995000 back to 1000000
// — a TRANSFORM hold on a par-marked mark.
func srSnappedStableRow(asset common.Address, symbol string) risk.AssetResponse {
	return risk.AssetResponse{
		Asset: asset.Hex(), ChainID: fxOPChain, Symbol: symbol,
		RespondsTo: []risk.AxisRef{srAxis(risk.AxisStableUSD, asset)},
		StableSnap: true,
	}
}

// newSetRunDeclaredHoldFixture is the round-53 book: arm 5 reached with a hold
// at a DECLARED IDENTITY FACTOR beside holds the definition had no part in.
//
// # Why this is reachable, and why no committed scenario produces it
//
// Arm 3 claims the scenario whose shocks are ALL at the identity factor, so a
// declared hold can only reach arm 5 in company: the scenario must ALSO declare
// a sized shock. Both seeded definitions below do exactly that, and both
// validate through `risk.Scenario.Validate` exactly as a committed file must.
//
//	sr_declared_and_transform_hold  USDC at 995/1000 under `stable_snap` (pinned
//	                                back to par — a TRANSFORM hold) beside DUST
//	                                at the identity factor 1/1 (a DECLARED hold).
//	                                Two held marks, two causes, and a composer
//	                                reading only the transform and arithmetic
//	                                counts publishes "all 1 held mark(s)".
//	sr_all_three_hold_causes        the same two plus USDT at 1/1, so all THREE
//	                                cause counts are nonzero in one response.
//
// The book is its own fixture rather than an addition to
// `newSetRunHoldCauseFixture`, so the two scenarios seeded there keep the exact
// applied sets their laws pin.
func newSetRunDeclaredHoldFixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	dm := srDMWithPrices(
		srDMPrice(fxAcctDM, srUSDCOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srDustOp, fxOPChain, "500"),
		srDMPrice(fxAcctDM, srUSDTOp, fxOPChain, "1000000"),
	)
	f.srSeed(t, srBatchWrite("set-run-declared-hold-1",
		fxAavePosition(), fxAaveRefused(), dm, fxDMRefused()))
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)

	f.srInject(t, risk.Scenario{
		ID: srDeclaredAndTransformScenario, Version: "v1",
		Label: "seeded: one mark held at a declared identity factor, one pinned by a transform", Description: "seeded fixture",
		PathAssumption: "seeded fixture: one sized shock and one identity shock, and the two marks they reach are both " +
			"held — for two DIFFERENT reasons, only one of which is the oracle path's",
		Engines: []string{risk.DMEngine},
		Shocks: []risk.Shock{
			{Axis: risk.AxisStableUSD, Asset: srUSDCOp.Hex(), FactorNum: 995, FactorDen: 1000},
			// THE DECLARED HOLD, and it is what keeps this out of arm 3: the
			// scenario's shocks are not ALL at identity.
			{Axis: risk.AxisAssetUSD, Asset: srDustOp.Hex(), FactorNum: 1, FactorDen: 1},
		},
		Propagation: []risk.AssetResponse{
			srSnappedStableRow(srUSDCOp, "USDC"),
			srIdentityHoldRow(srDustOp, "DUST"),
		},
		OutOfModel: []string{"seeded fixture for the declared-factor-plus-transform hold-cause composition"},
	})
	f.srInject(t, risk.Scenario{
		ID: srAllThreeHoldScenario, Version: "v1",
		Label: "seeded: all three hold causes on one book", Description: "seeded fixture",
		PathAssumption: "seeded fixture: three marks, three DIFFERENT reasons for coming back at the value they started at",
		Engines:        []string{risk.DMEngine},
		Shocks: []risk.Shock{
			{Axis: risk.AxisStableUSD, Asset: srUSDCOp.Hex(), FactorNum: 995, FactorDen: 1000},
			srArithmeticHoldShock(),
			{Axis: risk.AxisAssetUSD, Asset: srUSDTOp.Hex(), FactorNum: 1, FactorDen: 1},
		},
		Propagation: []risk.AssetResponse{
			srSnappedStableRow(srUSDCOp, "USDC"),
			srArithmeticHoldRow(),
			srIdentityHoldRow(srUSDTOp, "USDT"),
		},
		OutOfModel: []string{"seeded fixture for the three-cause hold composition"},
	})
	return f
}

// TestSetRunNoMarkMovedNamesADeclaredHoldBesideTheOtherCauses is the round-53
// regression ON A SERVED BODY.
//
// A composer reading only `marks_held_by_transform` and
// `marks_held_by_arithmetic` serves the transform-only sentence here — "all 1
// held mark(s) were pinned by the Debt Manager's stable snap band" — over a book
// that held TWO, and `heldSplitClause` then prints the accurate 1/1 split in the
// same object. The response contradicts itself about its own counts, under the
// one arm whose entire job is to refuse a true zero published under a false
// cause.
func TestSetRunNoMarkMovedNamesADeclaredHoldBesideTheOtherCauses(t *testing.T) {
	f := newSetRunDeclaredHoldFixture(t)
	results := srResults(t, f.srRun(t, http.StatusOK, srDeclaredAndTransformScenario, srAllThreeHoldScenario))

	t.Run("a declared hold beside a transform hold: both causes, both counts", func(t *testing.T) {
		reach := asMap(t, results[srDeclaredAndTransformScenario]["shock_reach"])

		// (a) THE ARM, and it is NOT arm 3 — the scenario declares two shocks and
		// only one of them is at the identity factor.
		require.Equal(t, reachNoMarkMoved, reach["reach"])
		require.Equal(t, 2, intOf(t, reach["declared_shocks"]))
		require.Equal(t, 1, intOf(t, reach["declared_shocks_at_identity"]),
			"one identity shock out of two: arm 3 requires ALL of them, which is what makes this hold arrive HERE")

		// (b) THE BOOK: two applied rows, neither moved, held for two different
		// reasons, and the causes are readable off the rows themselves.
		require.Equal(t, 2, len(asList(t, reach["applied_shocks"])))
		require.Equal(t, 0, intOf(t, reach["marks_moved"]))
		require.Equal(t, 1, intOf(t, reach["marks_held_by_transform"]), "USDC, snapped back to par by the band")
		require.Equal(t, 1, intOf(t, reach["marks_held_by_declared_factor"]), "DUST, held at the 1/1 this scenario declared")
		require.Equal(t, 0, intOf(t, reach["marks_held_by_arithmetic"]))
		for _, a := range asList(t, reach["applied_shocks"]) {
			m := asMap(t, a)
			require.Equal(t, m["before"], m["after"])
			if strings.EqualFold(m["asset"].(string), srDustOp.Hex()) {
				require.Equal(t, m["factor_num"], m["factor_den"], "the declared hold is the identity factor on the wire")
				require.False(t, m["snapped"].(bool))
				require.False(t, m["base_snapped"].(bool))
				require.False(t, m["cap_bound"].(bool),
					"no transform flag is set on this row at all, so nothing but the DECLARED FACTOR can be its cause")
				continue
			}
			require.True(t, m["snapped"].(bool), "the stable is the one the band pinned")
		}

		// (c) THE SENTENCE NAMES BOTH CAUSES WITH BOTH COUNTS, and its total is
		// the sum rather than one term of it.
		note := reach["note"].(string)
		require.Contains(t, note, "TWO causes")
		require.Contains(t, note, "1 mark(s) were pinned by a PRICING TRANSFORM")
		require.Contains(t, note, "1 mark(s) were held at the identity factor this scenario DECLARED")
		require.Contains(t, note, "all 2 held mark(s)")
		require.NotContains(t, note, "EXACT-INTEGER ARITHMETIC",
			"no mark on this book came back unchanged from the arithmetic and the sentence must not claim one did")

		// (d) THE REGRESSION, EXACTLY. The two-count composer serves the
		// transform-only sentence, whose leading total is the transform count.
		require.NotContains(t, note, "all 1 held mark(s)",
			"THE ROUND-53 DEFECT: `marks_held_by_transform` is 1 and the held total is 2, so a sentence leading with "+
				"\"all 1 held mark(s)\" is contradicted by `marks_held_by_declared_factor` in the same object")
		require.NotContains(t, note, "PRICING TRANSFORMS' doing, not the book's",
			"the transform-only sentence claims the whole zero for the oracle path; half of this zero is the "+
				"DEFINITION's own disclosed decision")

		// (e) AND THE SPLIT CLAUSE ONE SENTENCE LATER AGREES WITH IT. This is
		// where the old response contradicted itself, so the agreement is
		// asserted rather than assumed.
		require.Contains(t, note, "Of the held marks: 1 pinned by a pricing transform "+
			"(a stable snap, a snapped base or a bound cap), 1 held at the identity factor this scenario declared for them.")

		srRequireCauseClauseNamesExactly(t, srDeclaredAndTransformScenario, note, 1, 0, 1)
	})

	t.Run("all three causes on one book", func(t *testing.T) {
		reach := asMap(t, results[srAllThreeHoldScenario]["shock_reach"])
		require.Equal(t, reachNoMarkMoved, reach["reach"])
		require.Equal(t, 3, len(asList(t, reach["applied_shocks"])))
		require.Equal(t, 0, intOf(t, reach["marks_moved"]))
		require.Equal(t, 1, intOf(t, reach["marks_held_by_transform"]))
		require.Equal(t, 1, intOf(t, reach["marks_held_by_arithmetic"]))
		require.Equal(t, 1, intOf(t, reach["marks_held_by_declared_factor"]))

		note := reach["note"].(string)
		require.Contains(t, note, "THREE causes")
		require.Contains(t, note, "all 3 held mark(s)")
		srRequireCauseClauseNamesExactly(t, srAllThreeHoldScenario, note, 1, 1, 1)
	})

	// AND THE TWO COMPOSITIONS SERVE DIFFERENT SENTENCES, over one book and one
	// arm. A composer blind to the third count serves the SAME transform-only
	// string for both.
	require.NotEqual(t,
		asMap(t, results[srDeclaredAndTransformScenario]["shock_reach"])["note"],
		asMap(t, results[srAllThreeHoldScenario]["shock_reach"])["note"],
		"two arm-5 results whose cause counts differ served the same sentence")
}

// TestSetRunNoMarkMovedNamesTheCauseOnAServedBody is the DB corroboration for
// arm 5's composed sentence: the served note names the cause THIS book's counts
// show, on a book whose holds are not the transforms' doing.
//
// The pure law (TestSetRunNoMarkMovedNamesTheCauseItsCountsShow) pins every
// composition against stated facts. This one proves the facts occur: a real
// batch, through the real handler, serving arm 5 with `marks_held_by_transform`
// zero — the exact shape the old fixed sentence described as the pricing
// transforms' doing.
func TestSetRunNoMarkMovedNamesTheCauseOnAServedBody(t *testing.T) {
	f := newSetRunHoldCauseFixture(t)
	results := srResults(t, f.srRun(t, http.StatusOK, srMixedHoldScenario, srArithmeticHoldScenario))

	t.Run("arithmetic only: the transforms are not blamed", func(t *testing.T) {
		reach := asMap(t, results[srArithmeticHoldScenario]["shock_reach"])
		require.Equal(t, reachNoMarkMoved, reach["reach"])
		require.Equal(t, 1, len(asList(t, reach["applied_shocks"])))
		require.Equal(t, 0, intOf(t, reach["marks_moved"]))
		require.Equal(t, 1, intOf(t, reach["marks_held_by_arithmetic"]))
		require.Equal(t, 0, intOf(t, reach["marks_held_by_transform"]))
		require.Equal(t, 0, intOf(t, reach["marks_snapped"])+intOf(t, reach["marks_base_snapped"])+
			intOf(t, reach["marks_cap_bound"]),
			"no transform flag is set on this row at all, which is what makes the transform sentence flatly false here")
		row := asMap(t, asList(t, reach["applied_shocks"])[0])
		require.Equal(t, "500", row["before"])
		require.Equal(t, "500", row["after"], "floor(500 x 1001 / 1000) = 500: the arithmetic returned the mark unchanged")
		require.NotEqual(t, row["factor_num"], row["factor_den"], "and it is NOT the identity factor")

		note := reach["note"].(string)
		require.Contains(t, note, "EXACT-INTEGER ARITHMETIC")
		require.NotContains(t, note, "PRICING TRANSFORM",
			"THE REGRESSION, ON A SERVED BODY: this zero is the arithmetic's, and the arm used to publish the oracle "+
				"path as its cause")
	})

	t.Run("mixed: both causes, with both counts", func(t *testing.T) {
		reach := asMap(t, results[srMixedHoldScenario]["shock_reach"])
		require.Equal(t, reachNoMarkMoved, reach["reach"])
		require.Equal(t, 2, len(asList(t, reach["applied_shocks"])))
		require.Equal(t, 0, intOf(t, reach["marks_moved"]))
		require.Equal(t, 1, intOf(t, reach["marks_held_by_transform"]), "the par-marked stable, snapped back into the band")
		require.Equal(t, 1, intOf(t, reach["marks_held_by_arithmetic"]), "the dust mark, returned unchanged by the floor")

		note := reach["note"].(string)
		require.Contains(t, note, "TWO causes")
		require.Contains(t, note, "PRICING TRANSFORM")
		require.Contains(t, note, "EXACT-INTEGER ARITHMETIC")
		require.Contains(t, note, "1 mark(s) were pinned")
		require.Contains(t, note, "1 came back unchanged")
	})

	// THE TWO SENTENCES DIFFER, over one book and one arm. A fixed sentence
	// serves the same string for both compositions, and that is the defect.
	require.NotEqual(t,
		asMap(t, results[srMixedHoldScenario]["shock_reach"])["note"],
		asMap(t, results[srArithmeticHoldScenario]["shock_reach"])["note"],
		"two arm-5 results with DIFFERENT cause counts served the same sentence, which is a fixed cause wearing a "+
			"composed one's clothes")
}

// TestSetRunShockReachDisclosesASnappedControlAndADeclaredHold is the law this
// whole component exists for, in TWO halves — because there are two committed
// scenarios that render as undisclosed zeros and they have DIFFERENT causes.
func TestSetRunShockReachDisclosesASnappedControlAndADeclaredHold(t *testing.T) {
	// (A) THE SNAPPED CONTROL.
	t.Run("the snapped control publishes the transform as the cause", func(t *testing.T) {
		f := newSetRunStableFixture(t, true)

		// The fixture's four marks ARE the committed matrix's four rows, asserted
		// against the file rather than transcribed.
		file := srScenarioFile(t, "stable_depeg_0995_in_band")
		require.Len(t, file.Propagation, 4)
		flags := map[common.Address][2]bool{}
		for _, r := range file.Propagation {
			flags[common.HexToAddress(r.Asset)] = [2]bool{r.StableSnap, r.BaseStableSnap}
		}
		require.Equal(t, [2]bool{true, false}, flags[srUSDCOp])
		require.Equal(t, [2]bool{true, false}, flags[srUSDTOp])
		require.Equal(t, [2]bool{true, false}, flags[srFrxUSDOp])
		require.Equal(t, [2]bool{false, true}, flags[srLiquidUSDOp],
			"liquidUSD is the committed set's ONLY base_stable_snap row, and it is why a law written over `snapped` "+
				"alone is red on arrival")

		out := f.srRun(t, http.StatusOK, "stable_depeg_0995_in_band", "stable_depeg_099_boundary")
		results := srResults(t, out)
		inband := asMap(t, results["stable_depeg_0995_in_band"]["shock_reach"])
		boundary := asMap(t, results["stable_depeg_099_boundary"]["shock_reach"])

		// (a) THE ARM AND THE SPLIT.
		require.Equal(t, reachNoMarkMoved, inband["reach"])
		require.Equal(t, 0, intOf(t, inband["marks_moved"]))
		require.Equal(t, 4, len(asList(t, inband["applied_shocks"])))
		require.Equal(t, 3, intOf(t, inband["marks_snapped"]), "USDC, USDT and frxUSD carry `stable_snap`")
		require.Equal(t, 1, intOf(t, inband["marks_base_snapped"]), "liquidUSD carries `base_stable_snap`")
		require.Equal(t, 4, intOf(t, inband["marks_snapped"])+intOf(t, inband["marks_base_snapped"]),
			"the TWO flags together account for all four rows — never `marks_snapped` alone, which is 3 of 4 here and "+
				"would print \"3 of 4 snapped\" under a header claiming nothing moved")
		for _, a := range asList(t, inband["applied_shocks"]) {
			m := asMap(t, a)
			require.True(t, m["snapped"].(bool) || m["base_snapped"].(bool),
				"every applied row in this arm carries one of the two snap flags")
			require.Equal(t, m["before"], m["after"], "and comes back at the value it started at, as exact strings")
		}

		// (b) THE PUBLISHED CAUSE IS THE TRANSFORM, and it is checkable as such.
		require.Equal(t, 4, intOf(t, inband["marks_held_by_transform"]))
		require.Equal(t, 0, intOf(t, inband["marks_held_by_declared_factor"]))
		require.Equal(t, 0, intOf(t, inband["marks_held_by_arithmetic"]))

		// (c) THE BOUNDARY IS A DIFFERENT ANSWER TO A REQUEST ONE THOUSANDTH AWAY.
		// The band is OPEN at 0.99, and liquidUSD's base is snap(990000) = 990000,
		// also unsnapped — so `marks_base_snapped` is zero too.
		require.Equal(t, reachEveryMarkMoved, boundary["reach"])
		require.Equal(t, 0, intOf(t, boundary["marks_snapped"]))
		require.Equal(t, 0, intOf(t, boundary["marks_base_snapped"]))
		require.Equal(t, 4, intOf(t, boundary["marks_moved"]))

		// (d) THE ENGINE ROWS ARE PRESENT. No true number was suppressed to hide a
		// true zero.
		engines := srEngines(t, results["stable_depeg_0995_in_band"])
		require.NotEmpty(t, engines)
		dm := engines[risk.DMEngine]
		require.NotNil(t, dm)
		require.Positive(t, bigOf(t, dm["before_eligible_debt_usd"]).Sign(),
			"the before side is a real measurement of a real book")
		require.Equal(t, "0", dm["eligible_debt_delta_usd"])
		require.Equal(t, "0", dm["bad_debt_delta_usd"])
		require.Equal(t, 0, intOf(t, dm["eligible_accounts_delta"]))

		// (e) BOTH NOTES NAME BOTH TRANSFORMS.
		resNote := results["stable_depeg_0995_in_band"]["note"].(string)
		reachNote := inband["note"].(string)
		for _, note := range []string{resNote, reachNote} {
			require.Contains(t, note, "PRICING TRANSFORMS")
			require.Contains(t, note, "stable snap")
			require.Contains(t, note, "snapped stable BASE",
				"naming the stable snap ALONE is the sentence that is false on the fourth row of the committed control")
			require.Contains(t, note, "not the book's")
		}

		// (f) THE TWO RESULTS ARE DISTINGUISHABLE FROM THE BODY ALONE — no join
		// against GET /v1/scenarios and no access to `propagation`, which
		// `ScenarioDefinition` does not publish.
		require.NotEqual(t, inband["reach"], boundary["reach"])
		require.NotEqual(t, inband["note"], boundary["note"])
		require.NotEqual(t, results["stable_depeg_0995_in_band"]["shocks"], results["stable_depeg_099_boundary"]["shocks"])
	})

	// (B) THE DECLARED HOLD.
	t.Run("the identity census publishes the definition as the cause", func(t *testing.T) {
		f := newSetRunCensusFixture(t)

		// (g) READ OFF THE COMMITTED FILE, so the fixture rots loudly if a future
		// edit sizes one of those shocks.
		file := srScenarioFile(t, "dm_composition_census")
		require.Len(t, file.Shocks, 8)
		for i, sh := range file.Shocks {
			require.Equal(t, sh.FactorNum, sh.FactorDen, "shocks[%d] is no longer the identity factor 1/1", i)
		}

		out := f.srRun(t, http.StatusOK, "dm_composition_census")
		res := srResults(t, out)["dm_composition_census"]
		reach := asMap(t, res["shock_reach"])

		require.Equal(t, 8, intOf(t, reach["declared_shocks"]))
		require.Equal(t, 8, intOf(t, reach["declared_shocks_at_identity"]))

		// (h) THE ARM, and it is NOT no_mark_moved.
		require.Equal(t, reachAllShocksDeclaredAtIdentity, reach["reach"])

		// (i) A NON-EMPTY APPLIED SET IS THE POINT: a matched price is recorded
		// whatever the factor, so this arm normally serves rows.
		require.Positive(t, len(asList(t, reach["applied_shocks"])))
		require.Equal(t, 0, intOf(t, reach["marks_moved"]))
		require.Equal(t, 0, intOf(t, reach["marks_snapped"]))
		require.Equal(t, 0, intOf(t, reach["marks_base_snapped"]))
		require.Equal(t, len(asList(t, reach["applied_shocks"])), intOf(t, reach["marks_held_by_declared_factor"]))

		// (j) THE NOTE NAMES THE DEFINITION AND MAKES NO CLAIM ABOUT THE ORACLE —
		// asserted in BOTH directions. An implementation that omits arm 3 serves
		// this scenario under `no_mark_moved` with "a pricing transform swallowed
		// the move" beside "0 of 9 snapped", and fails here.
		note := reach["note"].(string)
		require.Contains(t, note, "DECLARED HOLD")
		require.Contains(t, note, "BY DECISION rather than by accident")
		require.Contains(t, note, sanitize(file.PathAssumption),
			"the arm must carry the scenario's OWN disclosure language for the hold — its `path_assumption` says \"no "+
				"move is asserted\", and that is the definition speaking rather than this service paraphrasing it")
		require.NotContains(t, note, "PRICING TRANSFORMS")
		require.NotContains(t, note, "swallow")
		require.NotContains(t, note, "snapped")
	})

	// THE GENERAL LAW, over EVERY result of EVERY fixture in this file: an
	// all-zero engine row must carry a PUBLISHED CAUSE, and the cause must be
	// TRUE.
	//
	// Revision 2's version had only the first clause, which the identity census
	// satisfied VACUOUSLY while publishing a false cause — which is precisely how
	// the defect survived a law written to catch it. The second clause is the
	// repair: the cause must be consistent with the counts.
	t.Run("every all-zero row carries a cause the counts corroborate", func(t *testing.T) {
		// THE DELIBERATE FINDINGS, declared here rather than tolerated silently.
		//
		// A result may serve three zero deltas under `every_mark_moved` with
		// neither a realization nor a projection — that is a REAL FINDING about
		// the book, not a defect — but ONLY when the fixture says so in writing.
		// On these books the shocked stables are priced and are NOT collateral the
		// measured account holds, so the marks genuinely moved and the account's
		// arithmetic genuinely did not change. Anything else all-zero under this
		// arm is an undisclosed zero and fails.
		deliberate := map[string]string{
			"stable_depeg_099_boundary": "all four stable marks re-price (0.99 is OUTSIDE the open snap band), and the " +
				"measured DM account's collateral is weETH — so the book is genuinely insensitive to this depeg. The " +
				"non-zero `marks_moved` beside the zero deltas is what makes that readable.",
			"stable_depeg_098_unsnapped": "same book, deeper depeg, same finding: 980000 is outside the band, all four " +
				"marks move, and none of them is collateral this account holds.",
		}

		for _, tc := range []struct {
			name string
			f    func(*testing.T) *apiFixture
			ids  []string
		}{
			{"snap control", func(t *testing.T) *apiFixture { return newSetRunStableFixture(t, true) },
				[]string{"stable_depeg_0995_in_band", "stable_depeg_099_boundary", "stable_depeg_098_unsnapped"}},
			{"identity census", newSetRunCensusFixture,
				[]string{"dm_composition_census", "weeth_market_depeg_oracles_held", "dm_rate_horizon_plus_200bps"}},
			{"off-par band", func(t *testing.T) *apiFixture { return newSetRunStableFixture(t, false) },
				[]string{"stable_depeg_0995_in_band"}},
			// The two seeded hold-cause books. Without them every arm-5 result
			// reaching the corroboration below is transform-only, so the
			// composition check would only ever see the composition that was
			// already right.
			{"hold causes", newSetRunHoldCauseFixture,
				[]string{srMixedHoldScenario, srArithmeticHoldScenario}},
			// And the two books whose holds include one the DEFINITION declared.
			// Without them the sweep never sees a nonzero
			// `marks_held_by_declared_factor` under arm 5 — which is how a rule
			// REQUIRING that count to be zero here stood for two rounds while the
			// composer quietly ignored it.
			{"declared holds", newSetRunDeclaredHoldFixture,
				[]string{srDeclaredAndTransformScenario, srAllThreeHoldScenario}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				f := tc.f(t)
				out := f.srRun(t, http.StatusOK, tc.ids...)
				for id, res := range srResults(t, out) {
					engines := srEngines(t, res)
					if len(engines) == 0 {
						continue
					}
					allZero, anyRealization, anyProjection := true, false, false
					for _, sum := range engines {
						if sum["eligible_debt_delta_usd"] != "0" || sum["bad_debt_delta_usd"] != "0" ||
							intOf(t, sum["eligible_accounts_delta"]) != 0 {
							allZero = false
						}
						anyRealization = anyRealization || sum["market_realization"] != nil
						anyProjection = anyProjection || sum["projection"] != nil
					}
					if !allZero {
						continue
					}
					reach := asMap(t, res["shock_reach"])
					arm := reach["reach"].(string)
					if arm == reachEveryMarkMoved && !anyRealization && !anyProjection {
						why, declared := deliberate[id]
						require.True(t, declared,
							"%s serves three zero deltas on every engine under `every_mark_moved` with neither a market "+
								"realization nor a projection, and NO fixture declares it. That shape is a genuine FINDING "+
								"about the book and it is allowed only when asserted deliberately — an undisclosed "+
								"all-zero row is the defect this component exists to refuse.", id)
						require.Positive(t, intOf(t, reach["marks_moved"]),
							"%s is declared a real finding (%s), so its marks MUST have moved — a zero `marks_moved` "+
								"under this arm would mean the finding is not the one declared", id, why)
						require.Contains(t, reach["note"].(string), "real finding about the book",
							"%s: the arm's own sentence must say that an all-zero delta HERE is a finding rather than a "+
								"swallowed move", id)
						continue
					}

					// AND THE CAUSE MUST BE CONSISTENT WITH THE COUNTS.
					switch arm {
					case reachNoMarkMoved:
						// THE SENTENCE MUST NAME EXACTLY THE CAUSES ITS COUNTS
						// SHOW, in whatever composition this book produced.
						//
						// This sweep first required `no_mark_moved` to hold NO
						// mark at its declared factor, which is not a property
						// of the arm at all: arm 3 takes the scenario whose
						// shocks are ALL at identity, so a scenario declaring
						// one identity shock beside one sized shock reaches arm
						// 5 with a declared hold in hand. The old rule was a
						// fixture-shaped assumption dressed as a law, and while
						// it stood the composer was free to read two of the
						// three counts and publish a total that contradicted the
						// third one object away.
						transform := intOf(t, reach["marks_held_by_transform"])
						arithmetic := intOf(t, reach["marks_held_by_arithmetic"])
						declared := intOf(t, reach["marks_held_by_declared_factor"])
						require.Equal(t, len(asList(t, reach["applied_shocks"])), transform+arithmetic+declared,
							"%s publishes `no_mark_moved`, so every applied row is a HELD row and the three cause counts "+
								"must account for all of them", id)
						srRequireCauseClauseNamesExactly(t, id, reach["note"].(string), transform, arithmetic, declared)
					case reachAllShocksDeclaredAtIdentity:
						require.Equal(t, len(asList(t, reach["applied_shocks"])),
							intOf(t, reach["marks_held_by_declared_factor"]),
							"%s publishes `all_shocks_declared_at_identity` and attributes a held mark to something "+
								"other than the definition", id)
					}
				}
			})
		}
	})
}

// newSetRunCensusFixture prices the identity census's OWN marks, so
// `dm_composition_census` serves a NON-EMPTY applied set — which is the point of
// arm 3 and the shape revision 2's derivation had no arm for.
func newSetRunCensusFixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	dm := srDMWithPrices(
		srDMPrice(fxAcctDM, srEUSDOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srLiquidRWAOp, fxOPChain, "1234567"),
	)
	f.srSeed(t, srBatchWrite("set-run-census-1",
		fxAavePosition(), fxAaveRefused(), dm, fxDMRefused()))
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)
	return f
}

// TestSetRunShockReachArmsAreTotalAndOrdered exercises all SEVEN arms against
// real books, and exercises the ORDER rather than assuming it.
func TestSetRunShockReachArmsAreTotalAndOrdered(t *testing.T) {
	seen := map[string]string{}
	record := func(t *testing.T, arm, note string) {
		t.Helper()
		for other, n := range seen {
			if other != arm {
				require.NotEqual(t, n, note, "arm %q served arm %q's sentence", arm, other)
			}
		}
		seen[arm] = note
	}

	t.Run("arm 1: a projection beats the identity factor", func(t *testing.T) {
		f := newSetRunCensusFixture(t)
		// dm_rate_horizon_plus_200bps declares ONE shock, on the borrow_apy axis,
		// at the identity factor 1/1. Arm 2 does not claim it (declared == 1) but
		// ARM 3 WOULD. This is a real ordering test, not a decorative one.
		file := srScenarioFile(t, "dm_rate_horizon_plus_200bps")
		require.Len(t, file.Shocks, 1)
		require.Equal(t, risk.AxisBorrowAPY, file.Shocks[0].Axis)
		require.Equal(t, file.Shocks[0].FactorNum, file.Shocks[0].FactorDen)
		require.NotNil(t, file.Projection)

		res := srResults(t, f.srRun(t, http.StatusOK, "dm_rate_horizon_plus_200bps"))["dm_rate_horizon_plus_200bps"]
		reach := asMap(t, res["shock_reach"])
		require.Equal(t, reachProjectionNoSpotPass, reach["reach"])
		require.Equal(t, 1, intOf(t, reach["declared_shocks"]))
		require.Equal(t, 1, intOf(t, reach["declared_shocks_at_identity"]))
		require.Empty(t, asList(t, reach["applied_shocks"]),
			"empty BY CONSTRUCTION here: no ApplyScenario pass ran at all")
		require.NotNil(t, srEngines(t, res)[risk.DMEngine]["projection"],
			"the projection block is where this scenario's information lives")
		record(t, reachProjectionNoSpotPass, reach["note"].(string))
	})

	t.Run("arm 2: no shock was asked for", func(t *testing.T) {
		f := newSetRunCensusFixture(t)
		file := srScenarioFile(t, "weeth_market_depeg_oracles_held")
		require.Empty(t, file.Shocks)
		// AN ACCIDENT OF THIS FILE, NOT A LAW: its propagation matrix is ALSO
		// empty, which `Validate` does not require. That is why emptiness is
		// asserted as a property of the FIXTURE here and the positive case is
		// asserted separately below.
		require.Empty(t, file.Propagation,
			"this committed file happens to carry an empty matrix too; the arm does not require it")

		res := srResults(t, f.srRun(t, http.StatusOK, "weeth_market_depeg_oracles_held"))["weeth_market_depeg_oracles_held"]
		reach := asMap(t, res["shock_reach"])
		require.Equal(t, reachNoShocksDeclared, reach["reach"])
		require.Equal(t, 0, intOf(t, reach["declared_shocks"]))
		require.Positive(t, intOf(t, reach["held_flat_marks"]))
		record(t, reachNoShocksDeclared, reach["note"].(string))
	})

	t.Run("arm 2 positively: a zero-shock scenario with a NON-EMPTY matrix", func(t *testing.T) {
		// The committed zero-shock scenario's empty applied set is an accident of
		// that file. This seeded one has a matrix, so it serves applied rows at
		// factor 1/1 — some of them SNAPPED — and every held row is attributed to
		// the DECLARED FACTOR rather than to the transform.
		f := newSetRunStableFixture(t, true)
		f.srInject(t, risk.Scenario{
			ID: "sr_zero_shock_with_matrix", Version: "v1",
			Label: "seeded: zero shocks, non-empty matrix", Description: "seeded fixture",
			PathAssumption: "seeded fixture: no shock is declared and the matrix still describes marks",
			Engines:        []string{risk.DMEngine},
			Propagation: []risk.AssetResponse{{
				Asset: srUSDCOp.Hex(), ChainID: fxOPChain, Symbol: "USDC",
				RespondsTo: []risk.AxisRef{srAxis(risk.AxisStableUSD, srUSDCOp)},
				StableSnap: true,
			}},
			// A zero-shock scenario must still MOVE SOMETHING to validate, so it
			// carries a market realization. That keeps it a genuine zero-shock
			// definition rather than a smuggled shock.
			MarketRealizations: []risk.MarketRealizationSpec{{
				Asset: fxWeETHOp.Hex(), ChainID: fxOPChain, MarketOverOracleWad: "980000000000000000",
			}},
			OutOfModel: []string{"seeded fixture for the zero-shock-with-matrix case"},
		})

		res := srResults(t, f.srRun(t, http.StatusOK, "sr_zero_shock_with_matrix"))["sr_zero_shock_with_matrix"]
		reach := asMap(t, res["shock_reach"])
		require.Equal(t, reachNoShocksDeclared, reach["reach"])
		require.Equal(t, 1, len(asList(t, reach["applied_shocks"])),
			"a matched price is recorded whatever the factor, so `applied_shocks` is NOT structurally empty in this arm")
		row := asMap(t, asList(t, reach["applied_shocks"])[0])
		require.Equal(t, "1", row["factor_num"])
		require.Equal(t, "1", row["factor_den"])
		require.True(t, row["snapped"].(bool), "a par-marked stable comes back SNAPPED even at the identity factor")
		require.Equal(t, 1, intOf(t, reach["marks_snapped"]))
		require.Equal(t, 1, intOf(t, reach["marks_held_by_declared_factor"]),
			"and the hold is attributed to the FACTOR, not to the snap — blaming the oracle for a hold nobody asked for "+
				"is the cause-attribution defect in miniature")
		require.Equal(t, 0, intOf(t, reach["marks_held_by_transform"]))
	})

	t.Run("arm 3: every shock declared at the identity factor", func(t *testing.T) {
		f := newSetRunCensusFixture(t)
		res := srResults(t, f.srRun(t, http.StatusOK, "dm_composition_census"))["dm_composition_census"]
		reach := asMap(t, res["shock_reach"])
		require.Equal(t, reachAllShocksDeclaredAtIdentity, reach["reach"])
		require.Positive(t, len(asList(t, reach["applied_shocks"])), "NON-EMPTY, which is the point")
		record(t, reachAllShocksDeclaredAtIdentity, reach["note"].(string))
	})

	t.Run("arm 4: the matrix, not the shock list, is what did not reach", func(t *testing.T) {
		f := newSetRunStableFixture(t, true)
		// THE DISCRIMINATING FIXTURE: the scenario SHOCKS an asset the book HOLDS,
		// and that asset has NO propagation row of its own. `Validate` requires
		// only that each shocked AXIS be referenced by some row, so this is a
		// legal committed shape — and "the book holds none of the assets the shock
		// names" is false of it.
		f.srInject(t, risk.Scenario{
			ID: "sr_shocked_asset_no_row", Version: "v1",
			Label: "seeded: a shocked asset with no matrix row of its own", Description: "seeded fixture",
			PathAssumption: "seeded fixture: the shocked asset is held by the book and described by no propagation row",
			Engines:        []string{risk.DMEngine},
			Shocks: []risk.Shock{
				{Axis: risk.AxisAssetUSD, Asset: srUSDTOp.Hex(), FactorNum: 70, FactorDen: 100},
			},
			// The axis IS referenced — by a row for a DIFFERENT asset the book does
			// not price. So the shock is legal and reaches nothing.
			Propagation: []risk.AssetResponse{{
				Asset: srEUSDOp.Hex(), ChainID: fxOPChain, Symbol: "eUSD",
				RespondsTo: []risk.AxisRef{srAxis(risk.AxisAssetUSD, srUSDTOp)},
			}},
			OutOfModel: []string{"seeded fixture for the shocked-asset-with-no-row case"},
		})

		res := srResults(t, f.srRun(t, http.StatusOK, "sr_shocked_asset_no_row"))["sr_shocked_asset_no_row"]
		reach := asMap(t, res["shock_reach"])
		require.Equal(t, reachNoShockReachedTheBook, reach["reach"])
		require.Empty(t, asList(t, reach["applied_shocks"]), "empty BY CONSTRUCTION: that is this arm's own condition")
		require.Positive(t, intOf(t, reach["held_flat_marks"]))

		// The SHOCKED asset is in the book and is named among the held-flat
		// identities, BY ITS (chain_id, asset) PAIR.
		var found bool
		for _, a := range asList(t, reach["held_flat_assets"]) {
			m := asMap(t, a)
			if strings.EqualFold(m["asset"].(string), srUSDTOp.Hex()) && intOf(t, m["chain_id"]) == int(fxOPChain) {
				found = true
			}
		}
		require.True(t, found,
			"the book HOLDS the shocked asset and the matrix does not describe it, so the mark went to held-flat and is "+
				"named there by its pair — the arm's honest pointer")

		note := reach["note"].(string)
		require.Contains(t, note, "PROPAGATION MATRIX")
		require.Contains(t, note, "held_flat_assets")
		require.Contains(t, note, "a shock need not name an asset",
			"the note must name the MATRIX rather than the shock list: a shock need not name an asset at all, and a "+
				"shocked asset is not required to have a row")
		record(t, reachNoShockReachedTheBook, note)
	})

	t.Run("arm 4 discrimination: one address, two chains, two different fates", func(t *testing.T) {
		// The matrix lookup is keyed (chain_id, asset), so the discriminating book
		// is ONE ADDRESS with a row on ONE chain and none on the other. An
		// address-only list cannot state this book at all.
		f := newSetRunTwoChainFixture(t)
		res := srResults(t, f.srRun(t, http.StatusOK, "eth_minus_30"))["eth_minus_30"]
		reach := asMap(t, res["shock_reach"])

		appliedChain, heldChain := -1, -1
		for _, a := range asList(t, reach["applied_shocks"]) {
			m := asMap(t, a)
			if strings.EqualFold(m["asset"].(string), fxWeETHEth.Hex()) {
				appliedChain = intOf(t, m["chain_id"])
			}
		}
		for _, a := range asList(t, reach["held_flat_assets"]) {
			m := asMap(t, a)
			if strings.EqualFold(m["asset"].(string), fxWeETHEth.Hex()) {
				heldChain = intOf(t, m["chain_id"])
			}
		}
		require.Equal(t, 1, appliedChain, "the chain WITH a matrix row lands in applied_shocks")
		require.Equal(t, 10, heldChain, "the chain WITHOUT one lands in held_flat_assets")
		require.NotEqual(t, appliedChain, heldChain,
			"one address in both arrays under two DIFFERENT chain ids: this is the state an address-only list would "+
				"collapse into one entry, leaving `held_flat_marks` unreconcilable against the list")
	})

	t.Run("arm 5: the snap control", func(t *testing.T) {
		f := newSetRunStableFixture(t, true)
		res := srResults(t, f.srRun(t, http.StatusOK, "stable_depeg_0995_in_band"))["stable_depeg_0995_in_band"]
		reach := asMap(t, res["shock_reach"])
		require.Equal(t, reachNoMarkMoved, reach["reach"])
		record(t, reachNoMarkMoved, reach["note"].(string))
	})

	t.Run("arm 6: some marks held, and `snapped` does not imply before == after", func(t *testing.T) {
		// A SEEDED BOOK, because the committed set has NO exemplar of this arm.
		// (`stable_depeg_098_unsnapped` snaps nothing — 980000 sits outside the
		// band and all four of its marks move, so it is `every_mark_moved`.)
		//
		// Two DM stables under the COMMITTED in-band control: one persisted at
		// exactly 1000000 and one persisted off par but inside the band, 1000500.
		//   par:    floor(1000000 × 995/1000) = 995000, snapped back to 1000000 == before  → HELD
		//   offpar: floor(1000500 × 995/1000) = 995497, snapped to 1000000     != 1000500  → MOVED
		f := newSetRunPartialFixture(t)
		res := srResults(t, f.srRun(t, http.StatusOK, "stable_depeg_0995_in_band"))["stable_depeg_0995_in_band"]
		reach := asMap(t, res["shock_reach"])

		require.Equal(t, reachSomeMarksHeld, reach["reach"])
		require.Equal(t, 2, len(asList(t, reach["applied_shocks"])))
		require.Equal(t, 1, intOf(t, reach["marks_moved"]))
		require.Equal(t, 2, intOf(t, reach["marks_snapped"]),
			"BOTH marks snapped, and one of them MOVED — this is the standing proof that `snapped` does not imply "+
				"`before == after`, and why no partition is asserted between the flag census and `marks_moved`")
		require.Equal(t, 1, intOf(t, reach["marks_held_by_transform"]))
		for _, a := range asList(t, reach["applied_shocks"]) {
			m := asMap(t, a)
			if m["before"] == "1000500" {
				require.Equal(t, "1000000", m["after"], "the off-par mark is pinned INTO the band, which moves it")
				require.True(t, m["snapped"].(bool))
			}
		}
		record(t, reachSomeMarksHeld, reach["note"].(string))
	})

	t.Run("arm 7: every mark moved", func(t *testing.T) {
		f := newSetRunStableFixture(t, true)
		out := f.srRun(t, http.StatusOK, "eth_minus_30", "stable_depeg_098_unsnapped")
		results := srResults(t, out)
		for _, id := range []string{"eth_minus_30", "stable_depeg_098_unsnapped"} {
			reach := asMap(t, results[id]["shock_reach"])
			require.Equal(t, reachEveryMarkMoved, reach["reach"],
				"%s reaches every mark its matrix describes. `stable_depeg_098_unsnapped` in particular SNAPS NOTHING: "+
					"980000 sits outside the open band, so all four of its marks move — it is the SAME arm as eth_minus_30, "+
					"and pinning that here is what keeps the corrected claim a test rather than prose.", id)
			require.Equal(t, len(asList(t, reach["applied_shocks"])), intOf(t, reach["marks_moved"]))
			require.Positive(t, intOf(t, reach["marks_moved"]))
			record(t, reachEveryMarkMoved, reach["note"].(string))
		}
		require.Equal(t, 0, intOf(t, asMap(t, results["stable_depeg_098_unsnapped"]["shock_reach"])["marks_snapped"]))
	})

	require.Len(t, seen, 7, "all seven arms must be exercised against a real book, not six of them")
}

// newSetRunPartialFixture is the `some_marks_held` book: EXACTLY two Debt
// Manager stables under the committed in-band control, one at par and one off
// par but inside the band.
func newSetRunPartialFixture(t *testing.T) *apiFixture {
	t.Helper()
	f := newBareAPIFixture(t)
	f.seedP5Events(t)
	f.seedSubstrate(t)
	f.seedP5ParamHistory(t)
	dm := srDMWithPrices(
		srDMPrice(fxAcctDM, srUSDCOp, fxOPChain, "1000000"),
		srDMPrice(fxAcctDM, srUSDTOp, fxOPChain, "1000500"),
	)
	f.srSeed(t, srBatchWrite("set-run-partial-1",
		fxAavePosition(), fxAaveRefused(), dm, fxDMRefused()))
	f.seedP5Headers(t)
	f.startServerWithFeeds(t, fxP5Feeds())
	f.srv.evidence = p5EvidenceStatics(t)
	return f
}
