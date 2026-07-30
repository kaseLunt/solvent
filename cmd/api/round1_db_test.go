package main

// The Codex round-1 fix regressions: engine-scoped refusals, the param-ledger
// weld, and observatory completeness.
//
// Each test below has a DISCRIMINATING CONTROL beside it, because every one of the
// findings it closes was a case where the wrong answer and the right answer had
// identical shapes.

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
	"github.com/kaselunt/solvent/internal/riskfeed"
	"github.com/kaselunt/solvent/internal/store"
)

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Engine-scoped refusals (Codex round 1 [critical]).
// ---------------------------------------------------------------------------

// TestWithheldEngineIsNeverServedAsAnEmptyBook drives the honest maintenance path
// end to end: the collateral-flag replay's deep rewind leaves the Aave engine with
// ZERO positions and an aggregate-level FLAG_CUSTODY_UNPROVEN.
//
// Before the fix, that state served as a clean, healthy, empty Aave book — zero
// positions, zero totals, no refusal anywhere on the wire — because the refusal
// lives on the AGGREGATE and this layer built refusal counts only from position
// rows. Every surface is checked, because one that still showed zeros would be
// enough to mislead.
func TestWithheldEngineIsNeverServedAsAnEmptyBook(t *testing.T) {
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches CASCADE`)
	require.NoError(t, err)
	withheld := f.seedWithheldBatch(t, "fixture-withheld-1", false)

	body := f.getJSON(t, "/v1/book", "/v1/book")
	require.EqualValues(t, withheld, num(t, body, "batch", "id"))

	// 1. The batch envelope names it — the summary alone must be enough.
	require.Equal(t, []any{risk.AaveEngine}, arr(t, body, "batch", "refused_engines"))
	require.EqualValues(t, 0, num(t, body, "batch", "refused_count"),
		"refused_count counts POSITION rows and is legitimately zero here; that is exactly why refused_engines exists")

	// 2. The top-level list names it.
	top := arr(t, body, "refused_engines")
	require.Len(t, top, 1)
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, str(t, top[0], "code"))
	require.Contains(t, str(t, top[0], "detail"), "not proven to have been walked")
	require.Contains(t, str(t, top[0], "note"), "WHOLE-ENGINE")

	// 3. The per-engine aggregate is refused and its totals are NULL, not "0".
	aave := byKey(t, arr(t, body, "engines"), "engine", risk.AaveEngine)
	require.True(t, boolAt(t, aave, "refused"))
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, str(t, aave, "refusal", "code"))
	require.Nil(t, at(t, aave, "total_collateral"),
		"a withheld engine's total must be NULL: zero is a number, and this book has none")
	require.Nil(t, at(t, aave, "total_debt"))
	require.Contains(t, str(t, aave, "unit_note"), "WITHHELD")

	// 4. The histogram row is marked, so all-zero buckets cannot read as "no
	//    position sits at any health factor".
	ah := byKey(t, arr(t, body, "hf_histogram", "engines"), "engine", risk.AaveEngine)
	require.True(t, boolAt(t, ah, "refused"))
	require.Equal(t, riskfeed.GateFlagCustodyUnproven, str(t, ah, "refusal", "code"))
	require.Contains(t, str(t, ah, "note"), "WITHHELD")

	// 5. The waterfall names it as EXCLUDED. A withheld engine contributes no
	//    positions, so it is absent from every point — an absence that must not be
	//    silent.
	excluded := arr(t, body, "waterfall", "excluded_engines")
	require.Len(t, excluded, 1)
	require.Equal(t, risk.AaveEngine, str(t, excluded[0], "engine"))
	for _, pt := range arr(t, body, "waterfall", "points") {
		for _, e := range arr(t, pt, "engines") {
			require.NotEqual(t, risk.AaveEngine, str(t, e, "engine"),
				"the withheld engine must not appear in the series with zeros")
		}
	}

	// 6. The bad-debt line carries a NULL row for it rather than a zero or nothing.
	bad := byKey(t, arr(t, body, "bad_debt"), "engine", risk.AaveEngine)
	require.True(t, boolAt(t, bad, "refused"))
	require.Nil(t, at(t, bad, "current_bad_debt_usd"))
	require.Nil(t, at(t, bad, "insolvent_positions"))

	// 7. The OTHER engine serves normally. A whole-engine refusal is scoped.
	dm := byKey(t, arr(t, body, "engines"), "engine", risk.DMEngine)
	require.False(t, boolAt(t, dm, "refused"))
	require.Equal(t, fxDMCollateralUSD, str(t, dm, "total_collateral"))
	require.Equal(t, fxDMBorrowings, str(t, dm, "total_debt"))
	dmBad := byKey(t, arr(t, body, "bad_debt"), "engine", risk.DMEngine)
	require.Equal(t, fxDMBadDebtAtPar, str(t, dmBad, "current_bad_debt_usd"))

	// 8. /v1/meta and /v1/observatory carry it too.
	meta := f.getJSON(t, "/v1/meta", "/v1/meta")
	require.Equal(t, []any{risk.AaveEngine}, arr(t, meta, "batch", "refused_engines"))
	obs := f.getJSON(t, "/v1/observatory", "/v1/observatory")
	obsAave := byKey(t, arr(t, arr(t, obs, "series")[0], "engines"), "engine", risk.AaveEngine)
	require.True(t, boolAt(t, obsAave, "refused"),
		"a time series is where a withheld engine's zero would be least noticeable and most misleading")
	require.Nil(t, at(t, obsAave, "total_collateral"))
}

// TestGenuinelyEmptyEngineIsServedAsHonestEmpty is the DISCRIMINATING CONTROL for
// the test above.
//
// The Aave engine here is byte-for-byte as empty — zero positions, zero totals —
// and GENUINELY PROVEN: no refusal code. It must serve as an honest empty book,
// with zeros and no refusal. Without this control, a serving path that marked
// every empty engine refused would pass the withheld test and be just as wrong in
// the other direction.
func TestGenuinelyEmptyEngineIsServedAsHonestEmpty(t *testing.T) {
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `TRUNCATE risk_batches CASCADE`)
	require.NoError(t, err)
	proven := f.seedWithheldBatch(t, "fixture-proven-empty-1", true)

	body := f.getJSON(t, "/v1/book", "/v1/book")
	require.EqualValues(t, proven, num(t, body, "batch", "id"))

	require.Empty(t, arr(t, body, "batch", "refused_engines"))
	require.Empty(t, arr(t, body, "refused_engines"))
	require.Empty(t, arr(t, body, "waterfall", "excluded_engines"))

	aave := byKey(t, arr(t, body, "engines"), "engine", risk.AaveEngine)
	require.False(t, boolAt(t, aave, "refused"))
	require.Nil(t, at(t, aave, "refusal"))
	require.Equal(t, "0", str(t, aave, "total_collateral"),
		"a genuinely empty book legitimately totals ZERO — the zero is the honest answer here")
	require.Equal(t, "0", str(t, aave, "total_debt"))
	require.EqualValues(t, 0, num(t, aave, "positions"))

	ah := byKey(t, arr(t, body, "hf_histogram", "engines"), "engine", risk.AaveEngine)
	require.False(t, boolAt(t, ah, "refused"))
	require.Nil(t, at(t, ah, "refusal"))
}

// ---------------------------------------------------------------------------
// The param-ledger weld (Codex round 1 [high]).
// ---------------------------------------------------------------------------

// TestLiqBonusMutationRefusesTheReconstruction is the demanded regression: mutate
// ONLY the persisted liquidation bonus and the position must be served as
// API_RECONSTRUCTION_MISMATCH.
//
// The bonus is the input whose corruption is otherwise invisible. It reaches no
// health factor, so every health comparison passes; it drives collateral-at-risk,
// bad debt and every market-realization number; and reconstruction FEEDS IT IN, so
// comparing the recomputation against the same row is tautological. The weld
// against the custodied param ledger is what makes it detectable.
func TestLiqBonusMutationRefusesTheReconstruction(t *testing.T) {
	for _, tc := range []struct {
		name      string
		engine    string
		asset     []byte
		bonus     string
		threshold bool
		expect    string
	}{
		{name: "aave bonus", engine: risk.AaveEngine, asset: fxWeETHEth.Bytes(), bonus: "10501", expect: "liquidation bonus"},
		// The THRESHOLD is caught twice over: it reaches the health factor, so the
		// wad comparison fires first and the ledger weld stands behind it. The BONUS
		// below reaches NOTHING the recomputation publishes — which is precisely why
		// the weld had to exist for it.
		{name: "aave threshold", engine: risk.AaveEngine, asset: fxWeETHEth.Bytes(), threshold: true, expect: "health factor wad"},
		{name: "dm bonus", engine: risk.DMEngine, asset: fxWeETHOp.Bytes(), bonus: "1000000000000000001", expect: "liquidation bonus"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newAPIFixture(t)

			// A CLEAN read first: the weld must PASS on the honest fixture, or a
			// mismatch below would prove nothing about the mutation.
			clean := f.getJSON(t, "/v1/book", "/v1/book")
			require.EqualValues(t, 0, num(t, clean, "coverage", "excluded_by_this_layer"))
			require.True(t, boolAt(t, clean, "coverage", "stress_coverage_is_full"))

			var err error
			if tc.threshold {
				_, err = f.admin.Exec(f.ctx,
					`UPDATE risk_position_legs SET liq_threshold = liq_threshold + 1
					  WHERE batch_id = $1 AND engine = $2 AND asset = $3`, f.batchID, tc.engine, tc.asset)
			} else {
				_, err = f.admin.Exec(f.ctx,
					`UPDATE risk_position_legs SET liq_bonus = $4::numeric
					  WHERE batch_id = $1 AND engine = $2 AND asset = $3`,
					f.batchID, tc.engine, tc.asset, tc.bonus)
			}
			require.NoError(t, err)

			body := f.getJSON(t, "/v1/book", "/v1/book")
			require.EqualValues(t, 1, num(t, body, "coverage", "excluded_by_this_layer"),
				"a leg parameter that disagrees with the custodied ledger must exclude the position from the derived arithmetic")
			require.False(t, boolAt(t, body, "coverage", "stress_coverage_is_full"))
			ex := arr(t, body, "coverage", "excluded")
			require.Len(t, ex, 1)
			require.Equal(t, refusalReconstruction, str(t, ex[0], "code"))
			require.Contains(t, str(t, ex[0], "reason"), tc.expect)
			if !tc.threshold {
				// THE BONUS IS CAUGHT ONLY BY THE WELD, and the reason says so. That is
				// the whole finding: a bonus mutation moves nothing the recomputation
				// publishes, so without an independent witness it passed silently while
				// changing every collateral-at-risk and bad-debt number served.
				require.Contains(t, str(t, ex[0], "reason"), "param ledger")
			}

			// And the ADDRESS surface serves it as a refusal naming this service —
			// never as a computed row, never omitted.
			acct := fxAcctAave
			if tc.engine == risk.DMEngine {
				acct = fxAcctDM
			}
			_, raw := f.get(t, "/v1/address/"+acct.Hex())
			validateContract(t, "/v1/address/{addr}", http.StatusOK, raw)
			var addrBody map[string]any
			require.NoError(t, json.Unmarshal(raw, &addrBody))
			p := arr(t, addrBody, "positions")[0]
			require.Equal(t, store.RiskPositionRefused, str(t, p, "status"))
			require.Equal(t, refusalReconstruction, str(t, p, "refusal", "code"))
			require.Nil(t, at(t, p, "liquidation_price"),
				"derived surfaces are withheld for a position this layer could not verify")
		})
	}
}

// TestMissingParamLedgerRowRefuses pins the gap case: a leg carrying a threshold
// that NO custodied param row asserts. "A gap is a wrong liquidation threshold"
// (design spec §8), so it is a refusal rather than a shrug.
func TestMissingParamLedgerRowRefuses(t *testing.T) {
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `DELETE FROM param_history WHERE engine = $1`, risk.AaveParamEngine)
	require.NoError(t, err)

	body := f.getJSON(t, "/v1/book", "/v1/book")
	ex := arr(t, body, "coverage", "excluded")
	require.Len(t, ex, 1)
	require.Equal(t, risk.AaveEngine, str(t, ex[0], "engine"))
	require.Contains(t, str(t, ex[0], "reason"), "NO custodied param row asserts")

	// The DM position, whose ledger is untouched, still verifies — so this is a
	// SCOPED refusal and not a blanket one.
	require.EqualValues(t, 1, num(t, body, "coverage", "in_book"))
}

// TestReconstructionVerifiesEveryServedHealthDisclosure pins the widened surface:
// each of these is published by /v1/address, and a served disclosure that is not
// verified is a number this layer could get wrong without noticing.
func TestReconstructionVerifiesEveryServedHealthDisclosure(t *testing.T) {
	for _, col := range []string{"avg_lt_bps", "hf_num", "hf_den", "weighted_lt_sum"} {
		t.Run(col, func(t *testing.T) {
			f := newAPIFixture(t)
			_, err := f.admin.Exec(f.ctx,
				`UPDATE risk_positions SET `+col+` = `+col+` + 1
				  WHERE batch_id = $1 AND engine = $2`, f.batchID, risk.AaveEngine)
			require.NoError(t, err)

			body := f.getJSON(t, "/v1/book", "/v1/book")
			ex := arr(t, body, "coverage", "excluded")
			require.Len(t, ex, 1, "a tampered %s must exclude the position", col)
			require.Contains(t, str(t, ex[0], "reason"), col)
		})
	}
}

// TestPerLegOutputMutationRefuses pins the per-leg output comparison. These are
// independent of the inputs fed back in, so they catch a mis-scaled or mis-mapped
// leg that the position-level totals could still survive.
func TestPerLegOutputMutationRefuses(t *testing.T) {
	// Each of these is an OUTPUT the recomputation derives independently, so a
	// tampered value genuinely disagrees. `live_collateral` is an INPUT — the
	// reconstruction feeds it back in — so it is moved by a whole token rather than
	// one wei, which is enough to change the base value it derives and therefore to
	// be caught; a one-wei change would floor away and is honestly undetectable at
	// this layer.
	for _, tc := range []struct{ col, delta string }{
		{"collateral_base", "1"},
		{"weighted_lt", "1"},
		{"live_collateral", "1000000000000000000"},
	} {
		col := tc.col
		t.Run(col, func(t *testing.T) {
			f := newAPIFixture(t)
			_, err := f.admin.Exec(f.ctx,
				`UPDATE risk_position_legs SET `+col+` = `+col+` + `+tc.delta+`
				  WHERE batch_id = $1 AND engine = $2 AND asset = $3`,
				f.batchID, risk.AaveEngine, fxWeETHEth.Bytes())
			require.NoError(t, err)
			body := f.getJSON(t, "/v1/book", "/v1/book")
			require.EqualValues(t, 1, num(t, body, "coverage", "excluded_by_this_layer"))
			require.NotEmpty(t, str(t, arr(t, body, "coverage", "excluded")[0], "reason"))
		})
	}
}

// ---------------------------------------------------------------------------
// Observatory completeness (Codex round 1 [medium]).
// ---------------------------------------------------------------------------

// TestObservatoryHonoursTheStoreCompletenessPredicate walks each mandatory child
// relation the store's predicate checks and asserts the series drops the batch —
// per component, because the api's previous inline predicate omitted exactly the
// components no single test would have noticed.
func TestObservatoryHonoursTheStoreCompletenessPredicate(t *testing.T) {
	for _, tc := range []struct {
		name string
		sql  string
	}{
		{"legs", `DELETE FROM risk_position_legs WHERE batch_id = $1`},
		{"price inputs", `DELETE FROM risk_price_inputs WHERE batch_id = $1`},
		{"positions", `DELETE FROM risk_positions WHERE batch_id = $1`},
		{"aggregates", `DELETE FROM risk_batch_aggregates WHERE batch_id = $1`},
		{"watermark stamps", `DELETE FROM risk_batch_watermarks WHERE batch_id = $1`},
		{"the swept engine's sweep payload", `UPDATE risk_batch_watermarks SET sweep_applicable = false,
			 sweep_rows = NULL, sweep_failed = NULL, sweep_success_sum = NULL,
			 sweep_max_updated_at = NULL, sweep_generation = NULL, sweep_generation_open = NULL
			 WHERE batch_id = $1 AND engine = 'debt_manager'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newAPIFixture(t)

			// The batch is servable BEFORE the damage — otherwise the assertion below
			// would pass for a batch that was never in the series to begin with.
			before := f.getJSON(t, "/v1/observatory", "/v1/observatory")
			require.Len(t, arr(t, before, "series"), 1)

			_, err := f.admin.Exec(f.ctx, tc.sql, f.batchID)
			require.NoError(t, err)

			after := f.getJSON(t, "/v1/observatory", "/v1/observatory")
			require.Empty(t, arr(t, after, "series"),
				"a batch missing %s is refused by store.NewestCompleteBatch, so the series must not publish it either", tc.name)

			// AND THE TWO AUTHORITIES AGREE. This is the property the duplicated
			// predicate broke: the series could publish a point no route would serve.
			status, _ := f.get(t, "/v1/book")
			require.Equal(t, http.StatusServiceUnavailable, status,
				"the serving path must reject the same batch the series rejected")
		})
	}
}

// TestObservatoryPublishesARestoredCompleteBatch is the control: with every child
// relation present the batch IS in the series. Without it, an observatory that
// published nothing at all would pass every assertion above.
func TestObservatoryPublishesARestoredCompleteBatch(t *testing.T) {
	f := newAPIFixture(t)
	_, err := f.admin.Exec(f.ctx, `DELETE FROM risk_position_legs WHERE batch_id = $1`, f.batchID)
	require.NoError(t, err)
	require.Empty(t, arr(t, f.getJSON(t, "/v1/observatory", "/v1/observatory"), "series"))

	// A second, WHOLE batch lands — the restore.
	restored := f.seedBatch(t, "fixture-materialization-restored")
	body := f.getJSON(t, "/v1/observatory", "/v1/observatory")
	series := arr(t, body, "series")
	require.Len(t, series, 1, "only the whole batch is in the series; the torn one stays out")
	require.EqualValues(t, restored, num(t, series[0], "batch_id"))
	require.Equal(t, fxAaveCollateralBase,
		str(t, byKey(t, arr(t, series[0], "engines"), "engine", risk.AaveEngine), "total_collateral"))
}
