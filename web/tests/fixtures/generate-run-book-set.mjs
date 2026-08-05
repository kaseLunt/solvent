// TORNADO (W-TN) fixture generation + THE PROVENANCE RECORD. Regenerate with:
//
//   node tests/fixtures/generate-run-book-set.mjs        (from web/)
//
// Sibling waves each own their generator; this one writes ONLY the four files
// below. Every fixture here is GENERATED from committed contract artifacts —
// never hand-shaped wire data. The sanctioned sources, per file:
//
//  1. run-book-set.json — `POST /v1/scenarios/run-book-set`, 200.
//     The contract's OWN 200 example, extracted VERBATIM from
//     `api/openapi.yaml` (the same discipline as `generate.mjs`'s run-book
//     extraction). It carries the three reach classes rev2 §2.5 exists for on
//     one wire: `every_mark_moved` (eth_minus_30, two engines),
//     `no_mark_moved` (stable_depeg_0995_in_band, the snap control) and
//     `all_shocks_declared_at_identity` (dm_composition_census), at
//     `freshness: still_newest`.
//
//  2. run-book-set.busy.json — the 503 `set_run_busy` example, extracted
//     VERBATIM from the same route's 503 example. `SetRunBusyBody`: its own
//     code on its own body type, no `Retry-After`, and the client dispatches
//     on the CODE, never the status.
//
//  3. run-book-set.superseded.json — ONE DOCUMENTED CHANGE against file 1:
//     `evaluation` moves to the `superseded` arm (`newest_servable_batch_id`
//     is `batch.id + 1`, and the note is rev2 §5's own superseded sentence).
//     Every clock byte is untouched, so the clock law's reading of this body
//     is byte-for-byte the reading of file 1.
//
//  4. run-book-set.no-denominator.json — the rendering states the contract
//     example cannot carry, derived with ASYMMETRIC values (the W-3L-D habit:
//     values chosen so a symmetric bug cannot cancel) and documented change by
//     change below. Two results, both re-identified to definitions the
//     COMMITTED web listing (`scenarios.json`, written by
//     `generate-lab-book.mjs` from the contract) actually publishes, so the
//     identity join holds against the listing the e2e suite serves:
//
//       eth_minus_30 (covers aave_v3_etherfi + debt_manager, both per the
//       committed listing — asserted below, never assumed):
//         - the AAVE row becomes the NO DENOMINATOR state: an answered engine
//           whose one measurable account carries NO DEBT. `total_debt_usd_*`,
//           `before_eligible_debt_usd`, both deltas and both
//           collateral-at-risk sides are "0"; `infinite_accounts` and
//           `movement_excluded_accounts` are 1 of 1 (an account with no debt
//           has no health factor to drop), so `hf_dropped_accounts` reads
//           0 of 0 with the excluded population named. Collateral still moves
//           under the shock (800000000000 -> 560000000000, the example's own
//           70/100), because a debt-free account still holds collateral.
//         - the DM row becomes a NEGATIVE drawable bar: two accounts (debts
//           1050000000 + 3150000000, summing to the example's own
//           4200000000), both eligible before; the smaller flips OUT.
//           `eligible_debt_delta_usd: "-1050000000"` (ratio -0.25 against the
//           4200000000 denominator), `eligible_accounts_delta: -1`,
//           `flipped_to_eligible: 0` (flips false-to-true ONLY, and this flip
//           went the other way), movement 0 of 2. `bad_debt_delta_usd` is set
//           to "0" (the example's positive bad-debt delta described a book
//           where eligible debt ROSE; this one fell).
//       ethfi_minus_50 (covers debt_manager ONLY per the committed listing —
//       asserted below):
//         - label / description / path_assumption / shocks / version copied
//           BYTE-IDENTICALLY from the committed listing's own definition.
//         - one DM row: two accounts (debts 2100000000 + 2100000000), none
//           eligible before, one flips IN. `eligible_debt_delta_usd:
//           "+2100000000"` -> ratio 0.5, movement 1 of 2.
//         - `shock_reach`: every_mark_moved over ONE applied row — the
//           definition's own ETHFI asset at its own 50/100 factor, before
//           "2000000" -> after "1000000" (floor(2000000×50/100)), on chain 10
//           where the DM book lives, source priceproviderv2.
//
//     WHY: the DM panel then holds TWO bars whose |ratio| order (0.5 > 0.25)
//     is the REVERSE of request order, pinning the tornado's sort; the two
//     signs pin the diverging axis; the aave panel holds a NO DENOMINATOR
//     state and no bar; and the movement sentences exercise both the plain
//     and the excluded-population grammar.
//
// THE CLOCK LAW GUARDS EVERY WRITE. Each emitted body is walked by
// `clock-law.mjs` (the same module `generate-feed.mjs` and
// `generate-lab-book.mjs` import); a body stating an age its own stamps do not
// support stops generation. The per-file trio counts are pinned here too —
// `SET_RUN_CLOCK_TRIOS` below — and `tests/unit/fixture-clock-law.spec.ts`'s
// CENSUS pins the same numbers over the committed bytes, so a re-run that
// moved a clock is a visible diff twice over.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkClocks } from "./clock-law.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const contractPath = path.join(repoRoot, "api", "openapi.yaml");

let YAML;
try {
  // Resolve `yaml` from the CLIENT package's node_modules (its pinned devDep).
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  console.error(
    "generate-run-book-set.mjs: cannot resolve the `yaml` package from packages/client-ts/node_modules.\n" +
      "Run `node scripts/ensure-client.mjs` (or any web build) first — it installs the\n" +
      "client package's dev dependencies.",
  );
  process.exit(1);
}

/** The pinned trio count per emitted file. The census spec pins the same. */
const SET_RUN_CLOCK_TRIOS = {
  "run-book-set.json": 2,
  "run-book-set.busy.json": 0,
  "run-book-set.superseded.json": 2,
  "run-book-set.no-denominator.json": 2,
};

const fail = (message) => {
  console.error(`generate-run-book-set.mjs: ${message}`);
  process.exit(1);
};

/** One write path: the clock law, the trio pin, then the bytes. */
const write = (name, body) => {
  const report = checkClocks(body);
  if (report.failures.length > 0) {
    fail(`${name} refused by the clock law:\n  ${report.failures.join("\n  ")}`);
  }
  const pinned = SET_RUN_CLOCK_TRIOS[name];
  if (report.checked !== pinned) {
    fail(
      `${name} resolved ${report.checked} clock trio(s); this generator pins ${pinned}. ` +
        `Move the pin AND the census in tests/unit/fixture-clock-law.spec.ts in the same diff.`,
    );
  }
  writeFileSync(path.join(here, name), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  console.log(`wrote  ${name} (${report.checked} clock trio(s))`);
};

// --- the two verbatim extractions -------------------------------------------

const contract = YAML.parse(readFileSync(contractPath, "utf8"));
const route = contract?.paths?.["/v1/scenarios/run-book-set"]?.post?.responses;
const example = route?.["200"]?.content?.["application/json"]?.example;
if (example === undefined) {
  fail("api/openapi.yaml carries no 200 example for POST /v1/scenarios/run-book-set");
}
const busy = route?.["503"]?.content?.["application/json"]?.example;
if (busy?.error?.code !== "set_run_busy") {
  fail("api/openapi.yaml's run-book-set 503 example is not the set_run_busy body");
}

// The set-level membership law, checked on every body this file emits: the
// tornado's own gate refuses a body that breaks it, so a fixture breaking it
// would be a fixture that renders nothing.
const assertMembership = (name, body) => {
  const requested = [...body.requested_scenario_ids].sort();
  const answered = body.results.map((result) => result.scenario_id).sort();
  if (JSON.stringify(requested) !== JSON.stringify(answered)) {
    fail(`${name}: requested_scenario_ids and results[].scenario_id are not the same multiset`);
  }
  if (body.evaluation.scenarios_evaluated !== body.results.length) {
    fail(`${name}: scenarios_evaluated disagrees with len(results)`);
  }
  for (const result of body.results) {
    const parts = [
      ...result.engines.map((engine) => engine.engine),
      ...result.withheld_engines,
      ...result.unmeasurable_engines.map((absence) => absence.engine),
    ].sort();
    const covered = [...result.covered_engines].sort();
    if (JSON.stringify(parts) !== JSON.stringify(covered)) {
      fail(`${name}: ${result.scenario_id}'s engine arrays are not a partition of covered_engines`);
    }
    const answeredAccounts = result.engines.reduce((sum, engine) => sum + engine.accounts, 0);
    if (result.positions_answered !== answeredAccounts) {
      fail(`${name}: ${result.scenario_id}'s positions_answered is not Σ engines[].accounts`);
    }
  }
};

assertMembership("run-book-set.json", example);
write("run-book-set.json", example);
write("run-book-set.busy.json", busy);

// --- 3: the superseded arm, one documented change ----------------------------

const superseded = structuredClone(example);
superseded.evaluation.freshness = "superseded";
superseded.evaluation.newest_servable_batch_id = superseded.batch.id + 1;
superseded.evaluation.note =
  `Every scenario here was evaluated against batch ${superseded.batch.id}, resolved once at ` +
  `${superseded.evaluation.resolved_at}. The comparison across scenarios is therefore exact and ` +
  `cross-scenario reading is sound. Batch ${superseded.evaluation.newest_servable_batch_id} has ` +
  `since materialized: these numbers describe batch ${superseded.batch.id} and not the current ` +
  `head of the book.`;
assertMembership("run-book-set.superseded.json", superseded);
write("run-book-set.superseded.json", superseded);

// --- 4: the no-denominator / ordering / movement-grammar variant -------------

// The COMMITTED listing this deployment's e2e suite serves. The variant's two
// results are re-identified against IT, so the definitions are read, asserted
// and copied — never assumed.
const listing = JSON.parse(readFileSync(path.join(here, "scenarios.json"), "utf8"));
const definitionOf = (id) => {
  const definition = listing.scenarios.find((scenario) => scenario.id === id);
  if (definition === undefined) fail(`scenarios.json does not publish ${id}`);
  return definition;
};
const ethDefinition = definitionOf("eth_minus_30");
const ethfiDefinition = definitionOf("ethfi_minus_50");
if (JSON.stringify(ethDefinition.engines) !== JSON.stringify(["aave_v3_etherfi", "debt_manager"])) {
  fail("eth_minus_30's committed coverage moved; re-derive this variant against it");
}
if (JSON.stringify(ethfiDefinition.engines) !== JSON.stringify(["debt_manager"])) {
  fail("ethfi_minus_50's committed coverage moved; re-derive this variant against it");
}
if (listing.scenario_config_version !== example.scenario_config_version) {
  fail("the listing and the contract example disagree about scenario_config_version");
}

const variant = structuredClone(example);
const ethResult = variant.results.find((result) => result.scenario_id === "eth_minus_30");
if (ethResult === undefined) fail("the contract example lost its eth_minus_30 result");

// eth_minus_30, aave row -> NO DENOMINATOR (documented above).
const aaveRow = ethResult.engines.find((engine) => engine.engine === "aave_v3_etherfi");
if (aaveRow === undefined) fail("the example's eth_minus_30 result lost its aave row");
Object.assign(aaveRow, {
  infinite_accounts: 1,
  movement_excluded_accounts: 1,
  before_eligible_accounts: 0,
  after_eligible_accounts: 0,
  eligible_accounts_delta: 0,
  hf_dropped_accounts: 0,
  before_eligible_debt_usd: "0",
  eligible_debt_delta_usd: "0",
  before_bad_debt_usd: "0",
  bad_debt_delta_usd: "0",
  before_collateral_at_risk_usd: "0",
  after_collateral_at_risk_usd: "0",
  total_debt_usd_before: "0",
  total_debt_usd_after: "0",
  note:
    "DERIVED VARIANT (W-TN): this engine's one measurable account carries no debt, so every " +
    "debt-side figure is a computed zero and total_debt_usd_before is the zero denominator the " +
    "axis law refuses to divide by. Collateral still moves under the shock; the movement count's " +
    "denominator is accounts minus movement_excluded_accounts (1 minus 1 = 0), and the excluded " +
    "population is named rather than left a quiet zero.",
});

// eth_minus_30, dm row -> a NEGATIVE drawable bar (documented above).
const ethDmRow = ethResult.engines.find((engine) => engine.engine === "debt_manager");
if (ethDmRow === undefined) fail("the example's eth_minus_30 result lost its dm row");
Object.assign(ethDmRow, {
  accounts: 2,
  before_eligible_accounts: 2,
  after_eligible_accounts: 1,
  eligible_accounts_delta: -1,
  flipped_to_eligible: 0,
  eligible_debt_delta_usd: "-1050000000",
  bad_debt_delta_usd: "0",
});
ethResult.positions_answered = 3;

// ethfi_minus_50 replaces the two results the variant does not need, RE-IDENTIFIED
// byte-for-byte from the committed definition.
const ethfiResult = {
  scenario_id: ethfiDefinition.id,
  scenario_version: ethfiDefinition.version,
  label: ethfiDefinition.label,
  path_assumption: ethfiDefinition.path_assumption,
  shocks: structuredClone(ethfiDefinition.shocks),
  shock_reach: {
    declared_shocks: ethfiDefinition.shocks.length,
    declared_shocks_at_identity: 0,
    reach: "every_mark_moved",
    applied_shocks: [
      {
        after: "1000000",
        asset: ethfiDefinition.shocks[0].asset,
        base_snapped: false,
        before: "2000000",
        cap_bound: false,
        chain_id: 10,
        factor_den: String(ethfiDefinition.shocks[0].factor_den),
        factor_num: String(ethfiDefinition.shocks[0].factor_num),
        snapped: false,
        source: "priceproviderv2",
      },
    ],
    marks_moved: 1,
    marks_held_by_declared_factor: 0,
    marks_held_by_transform: 0,
    marks_held_by_arithmetic: 0,
    marks_snapped: 0,
    marks_base_snapped: 0,
    marks_cap_bound: 0,
    held_flat_marks: 0,
    held_flat_assets: [],
    note:
      "EVERY MARK MOVED: the shock reached every mark this scenario's propagation matrix " +
      "describes (1 of 1). An all-zero delta under THIS arm is a real finding about the book: " +
      "the prices moved and the engines' arithmetic did not change these figures.",
  },
  covered_engines: structuredClone(ethfiDefinition.engines),
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [
    {
      ...structuredClone(ethDmRow),
      accounts: 2,
      infinite_accounts: 0,
      movement_excluded_accounts: 0,
      before_eligible_accounts: 0,
      after_eligible_accounts: 1,
      eligible_accounts_delta: 1,
      flipped_to_eligible: 1,
      hf_dropped_accounts: null,
      before_eligible_debt_usd: "0",
      eligible_debt_delta_usd: "2100000000",
      before_bad_debt_usd: "0",
      bad_debt_delta_usd: "0",
      before_collateral_at_risk_usd: "4000000000",
      after_collateral_at_risk_usd: "2000000000",
      total_debt_usd_before: "4200000000",
      total_debt_usd_after: "4200000000",
      total_collateral_usd_before: "4000000000",
      total_collateral_usd_after: "2000000000",
      note:
        "DERIVED VARIANT (W-TN): two measurable accounts, none eligible before, one flipped in. " +
        "The sanctioned denominator is total_debt_usd_before; the DM's debt is USD-normalized " +
        "and shock-invariant, so both sides carry the same total.",
    },
  ],
  positions_answered: 2,
  positions_withheld: 0,
  note:
    "DERIVED VARIANT (W-TN): re-identified byte-for-byte to the committed ethfi_minus_50 " +
    "definition the web listing publishes; the numbers are documented derivations in " +
    "generate-run-book-set.mjs, chosen asymmetric so the tornado's ordering and sign handling " +
    "cannot pass by cancellation.",
};

variant.requested_scenario_ids = ["eth_minus_30", "ethfi_minus_50"];
variant.results = [ethResult, ethfiResult];
variant.evaluation.scenarios_evaluated = 2;

assertMembership("run-book-set.no-denominator.json", variant);

// The variant's own arithmetic, re-derived rather than trusted: the two DM
// ratios must order 0.5 above 0.25 with opposite signs, and the aave row must
// be the exact zero-denominator state.
const ratioOf = (row) => Number(row.eligible_debt_delta_usd) / Number(row.total_debt_usd_before);
if (aaveRow.total_debt_usd_before !== "0") fail("variant: the aave row lost its zero denominator");
if (ratioOf(ethDmRow) !== -0.25) fail("variant: eth_minus_30's dm ratio is not -0.25");
if (ratioOf(ethfiResult.engines[0]) !== 0.5) fail("variant: ethfi_minus_50's dm ratio is not 0.5");

write("run-book-set.no-denominator.json", variant);
