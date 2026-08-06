// THE ANTI-CONFOUND ENUMERATION, ONCE. (r57 item 12b -> r58 item 7 -> r60-C,
// welded by this module.)
//
// Three sites used to carry hand-mirrored copies of the same walk — the
// generator's refusal (generate-run-book-set.mjs), the committed-bytes law
// (tests/e2e/tornado.spec.ts) and the renderer mirror
// (tests/unit/tornado-lines.spec.ts) — and BOTH historical escapes were
// enumeration gaps present in every copy at once: r58's was declared-factor ==
// marks_snapped / arithmetic == marks_moved, r60's was arithmetic ==
// positions_answered == engines[0].accounts, counts the walk stopped short
// of. Identical copies are not independent checks; they are one check with
// three places to forget. The walk now lives here and all three import it.
//
// A NEW INTEGER OR ARRAY FIELD ON ANY OF THE THREE SCHEMAS (api/openapi.yaml:
// SetRunScenarioResult, SetRunShockReach, SetRunEngineSummary) MUST BE
// REGISTERED HERE — one file, one diff. The committed-bytes law pins the
// enumeration's yield, so a walk that quietly stops enumerating is a red
// gate, and the generator re-injects the r60 escape at every generation, so
// a walk that stops FIRING is one too.
//
// Figures are entry ARRAYS, not an object: an object key collision would
// silently overwrite one entry with another and shrink the enumeration —
// the exact silence this module exists to end.

/** The three cause figures of the §2.5 held-marks split, named. */
export const causeEntriesOf = (reach) => [
  ["marks_held_by_transform", reach.marks_held_by_transform],
  ["marks_held_by_declared_factor", reach.marks_held_by_declared_factor],
  ["marks_held_by_arithmetic", reach.marks_held_by_arithmetic],
];

/**
 * Every NON-CAUSE integer count or array length on one SetRunScenarioResult —
 * the figures a wrong-field renderer could source instead of a cause:
 * SetRunShockReach's totals, flag census and flag sums (rev2 §2.5), the
 * result's own counts (rev2 §2.4) and every SetRunEngineSummary integer
 * (rev2 §2.6), each entry NAMED so a collision names its source. A null
 * (hf_dropped_accounts on the DM, flipped_to_eligible on Aave) is an ABSENT
 * figure, never a zero, and registers nothing.
 */
export const nonCauseFiguresOf = (result) => {
  const reach = result.shock_reach;
  const figures = [
    // SetRunShockReach (rev2 §2.5) — the reach's own totals, census, sums.
    ["marks_snapped", reach.marks_snapped],
    ["marks_base_snapped", reach.marks_base_snapped],
    ["marks_cap_bound", reach.marks_cap_bound],
    ["marks_moved", reach.marks_moved],
    ["applied_shocks.length", reach.applied_shocks.length],
    ["declared_shocks", reach.declared_shocks],
    ["declared_shocks_at_identity", reach.declared_shocks_at_identity],
    ["held_flat_marks", reach.held_flat_marks],
    ["held_flat_assets.length", reach.held_flat_assets.length],
    ["marks_snapped+marks_base_snapped", reach.marks_snapped + reach.marks_base_snapped],
    ["marks_snapped+marks_cap_bound", reach.marks_snapped + reach.marks_cap_bound],
    ["marks_base_snapped+marks_cap_bound", reach.marks_base_snapped + reach.marks_cap_bound],
    ["flag_sum", reach.marks_snapped + reach.marks_base_snapped + reach.marks_cap_bound],
    // SetRunScenarioResult (rev2 §2.4) — r60-C: the result's own counts and
    // array lengths, the figures the r58/r59 enumerations omitted.
    ["shocks.length", result.shocks.length],
    ["covered_engines.length", result.covered_engines.length],
    ["withheld_engines.length", result.withheld_engines.length],
    ["unmeasurable_engines.length", result.unmeasurable_engines.length],
    ["engines.length", result.engines.length],
    ["positions_answered", result.positions_answered],
    ["positions_withheld", result.positions_withheld],
  ];
  result.unmeasurable_engines.forEach((absence, i) => {
    figures.push(
      [`unmeasurable_engines[${i}].counts.positions_in_batch`, absence.counts.positions_in_batch],
      [`unmeasurable_engines[${i}].counts.refused_in_batch`, absence.counts.refused_in_batch],
      [`unmeasurable_engines[${i}].counts.unrebuildable`, absence.counts.unrebuildable],
    );
  });
  result.engines.forEach((row, i) => {
    const register = (name, value) => {
      if (value !== null && value !== undefined) figures.push([`engines[${i}].${name}`, value]);
    };
    register("usd_decimals", row.usd_decimals);
    register("accounts", row.accounts);
    register("infinite_accounts", row.infinite_accounts);
    register("movement_excluded_accounts", row.movement_excluded_accounts);
    register("refused_in_batch_positions", row.refused_in_batch_positions);
    register("unrebuildable_positions", row.unrebuildable_positions);
    register("before_eligible_accounts", row.before_eligible_accounts);
    register("after_eligible_accounts", row.after_eligible_accounts);
    register("eligible_accounts_delta", row.eligible_accounts_delta);
    register("flipped_to_eligible", row.flipped_to_eligible);
    register("hf_dropped_accounts", row.hf_dropped_accounts);
    if (row.market_realization !== null && row.market_realization !== undefined) {
      register("market_realization.usd_decimals", row.market_realization.usd_decimals);
    }
    if (row.projection !== null && row.projection !== undefined) {
      register("projection.annual_delta_bps", row.projection.annual_delta_bps);
      register("projection.apy_observed_at_block", row.projection.apy_observed_at_block);
      register("projection.horizons.length", row.projection.horizons.length);
      row.projection.horizons.forEach((horizonRow, j) => {
        register(`projection.horizons[${j}].horizon_seconds`, horizonRow.horizon_seconds);
      });
    }
  });
  return figures;
};

/**
 * The refusal: every violation of the de-confound law on one result, each
 * naming its two colliding figures. Empty means every cause figure is
 * pairwise distinct from each other cause AND from every non-cause figure
 * on the result wire shape — the property that makes a wrong-field renderer
 * print a wrong number instead of accidentally the right one.
 */
export const causeConfoundsOf = (result) => {
  const causeEntries = causeEntriesOf(result.shock_reach);
  const violations = [];
  for (let i = 0; i < causeEntries.length; i += 1) {
    for (let j = i + 1; j < causeEntries.length; j += 1) {
      if (causeEntries[i][1] === causeEntries[j][1]) {
        violations.push(
          `${causeEntries[i][0]} and ${causeEntries[j][0]} are confounded at ` +
            `${causeEntries[i][1]}; a renderer swapping the two would print the right number`,
        );
      }
    }
  }
  for (const [causeName, causeValue] of causeEntries) {
    for (const [nonCauseName, nonCauseValue] of nonCauseFiguresOf(result)) {
      if (causeValue === nonCauseValue) {
        violations.push(
          `${causeName} (${causeValue}) is confounded with ${nonCauseName}; a renderer ` +
            "sourcing the wrong figure would print the right number and this fixture " +
            "could not catch it",
        );
      }
    }
  }
  return violations;
};
