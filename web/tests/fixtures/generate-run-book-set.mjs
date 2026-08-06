// TORNADO (W-TN, extended W-TN-B) fixture generation + THE PROVENANCE RECORD.
// Regenerate with:
//
//   node tests/fixtures/generate-run-book-set.mjs        (from web/)
//
// Sibling waves each own their generator; this one writes ONLY the five files
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
//     W-TN-B (Codex round 57) EXTENDS THE VARIANT with two further results and
//     one reshaped reach, all re-identified to definitions the committed web
//     listing publishes:
//
//       weeth_market_depeg_oracles_held — the `no_shocks_declared` arm with a
//         MANDATORY `market_realization` block on BOTH covered engines (r57
//         item 5): the scenario's whole information content, rendered as its
//         own ledger rows. All deltas are zero BY CONSTRUCTION and both sides
//         of every two-sided figure are equal, because no pass moved anything.
//         Shortfall figures are asymmetric across engines (840/231 USD on
//         aave at 8dp; 3,100/1,250 USD on the DM at 6dp) so a renderer that
//         swaps blocks or engines goes red.
//       dm_rate_horizon_plus_200bps — the `projection_no_spot_pass` arm with
//         the MANDATORY `projection` block (r57 item 5). Horizon arithmetic is
//         re-derived below, delta-only over the DM's 4200000000 book:
//         floor(4200000000 × 200bps × t / year) = 230136 at 86400s and
//         6904109 at 2592000s; `becomes_liquidatable` exercises false AND
//         null, because null is "not stated", never false.
//       ethfi_minus_50 — reshaped from `every_mark_moved` to `some_marks_held`
//         with a DE-CONFOUNDED cause split (r57 item 12b, hardened by r58
//         item 7, completed by r60-C): 17 applied rows, 1 moved, 7 held by a
//         transform, 4 held at the declared factor (two of them snapped at
//         1/1, the §2.5 partition-order case), 5 held by exact-integer
//         arithmetic. ALL THREE cause figures (7/4/5) differ pairwise from
//         each other AND from EVERY non-cause figure on the result wire shape
//         a renderer could source instead — not just the reach's own totals
//         (applied length 17, marks_moved 1, declared_shocks 1, the flag
//         census 3/3/3 and every sum of those flags 6/6/6/9) but every
//         integer count and array length on SetRunScenarioResult (rev2 §2.4:
//         positions_answered 2, positions_withheld 0, the four
//         partition-array lengths, the declared shock list) and on its
//         SetRunEngineSummary rows (rev2 §2.6: accounts 2 and its sibling
//         counts, usd_decimals, the nested block figures when present). The
//         r58 confound was declared-factor == marks_snapped and arithmetic ==
//         marks_moved; the r60 confound was arithmetic == positions_answered
//         == engines[0].accounts, all at 2, because r58/r59 enumerated only
//         the reach. The check below enumerates the FULL shape, refuses
//         generation if any such pair ever collides again, and SELF-TESTS
//         that refusal against the r60 shape on every run. The bar still
//         draws: partly reached is a real bar with a stated qualification.
//
//  5. run-book-set.scenarios.json — the committed listing scenarios.json
//     EXTENDED with the two definitions the contract's own 200 example
//     answers and the base listing does not publish, each read from its
//     COMMITTED definition file (`internal/risk/scenarios/<id>.json`, minus
//     `propagation`, which ScenarioDefinition does not publish — rev2 §2.5).
//     It exists because r57 item 1 binds the rendered set to the DISPATCHED
//     ids and item 2 refuses a result with no listing row: the e2e happy path
//     must be able to DISPATCH the example's own three ids, so the listing it
//     runs under must publish them. Identity is asserted against the example's
//     own results, never assumed. No batch, no clock trios.
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
import { causeConfoundsOf } from "./confound-law.mjs";

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
  // A listing: no batch envelope and no age/stamp pair anywhere, so zero trios
  // — the same count generate-lab-book.mjs's four listings carry.
  "run-book-set.scenarios.json": 0,
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

// Pristine per-engine row templates, cloned from the UNMUTATED example so the
// no-denominator mutation above cannot leak into the new results.
const pristineEth = example.results.find((result) => result.scenario_id === "eth_minus_30");
if (pristineEth === undefined) fail("the contract example lost its eth_minus_30 result");
const pristineAaveRow = pristineEth.engines.find((engine) => engine.engine === "aave_v3_etherfi");
const pristineDmRow = pristineEth.engines.find((engine) => engine.engine === "debt_manager");
if (pristineAaveRow === undefined || pristineDmRow === undefined) {
  fail("the contract example's eth_minus_30 result lost an engine row");
}

// The (chain 10) asset pool the committed scenarios themselves shock and hold
// flat, reused so every applied row names an address the committed set names.
// Extended for r58 item 7 (13 distinct held marks) and again for r60-C (the
// 17-row de-confounded cause split needs 16); every added address is still
// read out of the committed scenario definition files under
// internal/risk/scenarios/, never invented (the last three are
// dm_composition_census.json's own chain-10 book).
const OP_ASSETS = [
  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  "0x80Eede496655FB9047dd39d9f418d5483ED600df",
  "0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C",
  "0x939778D83b46B456224A33Fb59630B11DEC56663",
  "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
  "0x4200000000000000000000000000000000000006",
  "0x4200000000000000000000000000000000000042",
  "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
  "0x5f46d540b6eD704C3c8789105F30E075AA900726",
  "0x657e8C867D8B37dCC18fA4Caead9C45EB088C642",
  "0x17bC8Ffd82b8a36e737Ca1141C025089589B915e",
  "0xA519AfBc91986c0e7501d7e34968FEE51CD901aC",
  "0xDCB612005417Dc906fF72c87DF732e5a90D49e11",
  "0xE5d3854736e0D513aAE2D8D708Ad94d14Fd56A6a",
  "0xca5921DF65E2e1b0B98Ae91c0187BA80D4124898",
];
const appliedRow = (asset, factorNum, factorDen, before, after, flags = {}) => ({
  after,
  asset,
  base_snapped: flags.base_snapped ?? false,
  before,
  cap_bound: flags.cap_bound ?? false,
  chain_id: 10,
  factor_den: String(factorDen),
  factor_num: String(factorNum),
  snapped: flags.snapped ?? false,
  source: "priceproviderv2",
});

// ethfi_minus_50, RE-IDENTIFIED byte-for-byte from the committed definition —
// now the `some_marks_held` arm with the DE-CONFOUNDED cause split (r57 12b,
// hardened by r58 item 7: every cause figure is pairwise distinct from every
// other cause figure and from every non-cause figure, checked below).
const ethfiApplied = [
  // 1 — the definition's own mark, MOVED at its own 50/100 factor.
  appliedRow(ethfiDefinition.shocks[0].asset, 50, 100, "2000000", "1000000"),
  // 2..8 — held by a TRANSFORM: non-identity factors carrying a snap (1), a
  // snapped base (3) or a bound cap (3), each back at its before value.
  appliedRow(OP_ASSETS[0], 995, 1000, "1000000", "1000000", { snapped: true }),
  appliedRow(OP_ASSETS[1], 995, 1000, "1000000", "1000000", { base_snapped: true }),
  appliedRow(OP_ASSETS[2], 995, 1000, "2000000", "2000000", { base_snapped: true }),
  appliedRow(OP_ASSETS[3], 998, 1000, "750000", "750000", { base_snapped: true }),
  appliedRow(OP_ASSETS[4], 90, 100, "500000", "500000", { cap_bound: true }),
  appliedRow(OP_ASSETS[5], 80, 100, "900000", "900000", { cap_bound: true }),
  appliedRow(OP_ASSETS[6], 90, 100, "1200000", "1200000", { cap_bound: true }),
  // 9..12 — held at the DECLARED factor 1/1. Rows 9 and 10 also carry
  // snapped: true, which is §2.5's partition-order case: a par-marked stable
  // under 1/1 comes back snapped and unmoved, and its hold is attributed to
  // the DEFINITION, never to the snap.
  appliedRow(OP_ASSETS[7], 1, 1, "1000000", "1000000", { snapped: true }),
  appliedRow(OP_ASSETS[8], 1, 1, "3000000", "3000000", { snapped: true }),
  appliedRow(OP_ASSETS[9], 1, 1, "4000000", "4000000"),
  appliedRow(OP_ASSETS[10], 1, 1, "2500000", "2500000"),
  // 13..17 — held by EXACT-INTEGER ARITHMETIC: non-identity factors, no flags,
  // floor(n × 1000001/1000000) = n for every n below 1000000 — 500, 700, 300,
  // 900 and 1100 all come back at themselves. Five rows (grown from two by
  // r60-C) so the arithmetic cause figure is 5, pairwise distinct from the
  // other causes AND from positions_answered / engines[0].accounts (both 2),
  // the counts the r58/r59 enumerations omitted and r60 collided with.
  appliedRow(OP_ASSETS[11], 1000001, 1000000, "500", "500"),
  appliedRow(OP_ASSETS[12], 1000001, 1000000, "700", "700"),
  appliedRow(OP_ASSETS[13], 1000001, 1000000, "300", "300"),
  appliedRow(OP_ASSETS[14], 1000001, 1000000, "900", "900"),
  appliedRow(OP_ASSETS[15], 1000001, 1000000, "1100", "1100"),
];
const ethfiReach = {
  declared_shocks: ethfiDefinition.shocks.length,
  declared_shocks_at_identity: 0,
  reach: "some_marks_held",
  applied_shocks: ethfiApplied,
  marks_moved: 1,
  marks_held_by_declared_factor: 4,
  marks_held_by_transform: 7,
  marks_held_by_arithmetic: 5,
  marks_snapped: 3,
  marks_base_snapped: 3,
  marks_cap_bound: 3,
  held_flat_marks: 0,
  held_flat_assets: [],
  note:
    "PARTLY REACHED: 1 of the 17 marks this scenario's matrix describes moved. Of the held " +
    "marks: 7 pinned by a pricing transform, 4 held at the factor the definition declared, " +
    "5 unchanged by exact-integer arithmetic. The counts are a partition; the flag census " +
    "(3 snapped, 3 base-snapped, 3 cap-bound) attributes no cause.",
};

const ethfiResult = {
  scenario_id: ethfiDefinition.id,
  scenario_version: ethfiDefinition.version,
  label: ethfiDefinition.label,
  path_assumption: ethfiDefinition.path_assumption,
  shocks: structuredClone(ethfiDefinition.shocks),
  shock_reach: ethfiReach,
  covered_engines: structuredClone(ethfiDefinition.engines),
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [
    {
      ...structuredClone(pristineDmRow),
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
    "generate-run-book-set.mjs, chosen asymmetric so the tornado's ordering, sign handling " +
    "and cause attribution cannot pass by cancellation.",
};

// THE CAUSE SPLIT IS RE-DERIVED FROM THE APPLIED ROWS, never trusted. Each row
// is classified by the §2.5 partition order and the result must equal the
// stated counts, and the de-confound inequalities must actually hold.
{
  const rows = ethfiReach.applied_shocks;
  const identity = (row) => row.factor_num === row.factor_den;
  const flagged = (row) => row.snapped || row.base_snapped || row.cap_bound;
  const moved = rows.filter((row) => row.before !== row.after).length;
  const held = rows.filter((row) => row.before === row.after);
  const byDeclared = held.filter(identity).length;
  const byTransform = held.filter((row) => !identity(row) && flagged(row)).length;
  const byArithmetic = held.filter((row) => !identity(row) && !flagged(row)).length;
  const census = {
    marks_moved: moved,
    marks_held_by_declared_factor: byDeclared,
    marks_held_by_transform: byTransform,
    marks_held_by_arithmetic: byArithmetic,
    marks_snapped: rows.filter((row) => row.snapped).length,
    marks_base_snapped: rows.filter((row) => row.base_snapped).length,
    marks_cap_bound: rows.filter((row) => row.cap_bound).length,
  };
  for (const [key, derived] of Object.entries(census)) {
    if (ethfiReach[key] !== derived) {
      fail(`variant: ethfi's stated ${key} is ${ethfiReach[key]}; its own rows derive ${derived}`);
    }
  }
  if (moved + byDeclared + byTransform + byArithmetic !== rows.length) {
    fail("variant: ethfi's cause split is not a partition of its applied rows");
  }
  // r57 item 12b, hardened by r58 item 7, COMPLETED by r60-C, WELDED by the
  // three-mirror consolidation — the de-confound covers ALL THREE cause
  // figures against the FULL RESULT WIRE SHAPE. The enumeration itself lives
  // ONCE in ./confound-law.mjs (this refusal, the committed-bytes law in
  // tests/e2e/tornado.spec.ts and the renderer mirror in
  // tests/unit/tornado-lines.spec.ts all import it); a new integer or array
  // field on any of the three schemas is registered THERE, in one diff.
  // r58's escape was declared-factor == marks_snapped and arithmetic ==
  // marks_moved; r60's escape was arithmetic == positions_answered ==
  // engines[0].accounts, all at 2, because r58/r59 enumerated only the reach
  // — in every hand-mirrored copy at once, which is why the copies are gone.
  const flagSum = census.marks_snapped + census.marks_base_snapped + census.marks_cap_bound;
  // PERMANENT SELF-TEST — the refusal must FIRE on the exact r60-C escape
  // shape: marks_held_by_arithmetic back at 2, equal to positions_answered
  // AND engines[0].accounts, naming both sources. A checker that goes quiet
  // on the shape this enumeration exists to refuse is itself refused, at
  // every generation.
  {
    const confounded = structuredClone(ethfiResult);
    confounded.shock_reach.marks_held_by_arithmetic = 2;
    const caught = causeConfoundsOf(confounded).join("\n");
    if (!caught.includes("positions_answered") || !caught.includes("engines[0].accounts")) {
      fail(
        "self-test: the anti-confound refusal no longer fires on the r60-C shape " +
          "(marks_held_by_arithmetic == positions_answered == engines[0].accounts == 2); " +
          "the refusal is dead, so nothing is generated",
      );
    }
  }
  const confounds = causeConfoundsOf(ethfiResult);
  if (confounds.length > 0) {
    fail(`variant:\n  ${confounds.join("\n  ")}`);
  }
  if (rows.length === moved || rows.length === flagSum) {
    fail("variant: the applied length is confounded with another reach total");
  }
}

// weeth_market_depeg_oracles_held — `no_shocks_declared`, whose entire
// information content is the MANDATORY market_realization block (r57 item 5).
const weethDefinition = definitionOf("weeth_market_depeg_oracles_held");
if (
  JSON.stringify(weethDefinition.engines) !==
  JSON.stringify(["aave_v3_etherfi", "debt_manager"])
) {
  fail("weeth_market_depeg_oracles_held's committed coverage moved; re-derive this variant");
}
if (weethDefinition.shocks.length !== 0) {
  fail("weeth_market_depeg_oracles_held now declares shocks; the no_shocks_declared arm moved");
}
const unshockedSides = {
  before_eligible_accounts: 0,
  after_eligible_accounts: 0,
  eligible_accounts_delta: 0,
  before_eligible_debt_usd: "0",
  eligible_debt_delta_usd: "0",
  before_bad_debt_usd: "0",
  bad_debt_delta_usd: "0",
  before_collateral_at_risk_usd: "0",
  after_collateral_at_risk_usd: "0",
  infinite_accounts: 0,
  movement_excluded_accounts: 0,
  accounts: 1,
};
const weethResult = {
  scenario_id: weethDefinition.id,
  scenario_version: weethDefinition.version,
  label: weethDefinition.label,
  path_assumption: weethDefinition.path_assumption,
  shocks: [],
  shock_reach: {
    declared_shocks: 0,
    declared_shocks_at_identity: 0,
    reach: "no_shocks_declared",
    applied_shocks: [],
    marks_moved: 0,
    marks_held_by_declared_factor: 0,
    marks_held_by_transform: 0,
    marks_held_by_arithmetic: 0,
    marks_snapped: 0,
    marks_base_snapped: 0,
    marks_cap_bound: 0,
    held_flat_marks: 2,
    held_flat_assets: [
      { asset: OP_ASSETS[0], chain_id: 10 },
      { asset: OP_ASSETS[4], chain_id: 10 },
    ],
    note:
      "NO SHOCKS DECLARED: this definition asks for no price move at all; its propagation " +
      "matrix is empty, so every described mark lands in held_flat. The information is in " +
      "market_realization, which is mandatory on every answered engine of this scenario.",
  },
  covered_engines: structuredClone(weethDefinition.engines),
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [
    {
      ...structuredClone(pristineAaveRow),
      ...unshockedSides,
      hf_dropped_accounts: 0,
      flipped_to_eligible: null,
      total_debt_usd_before: "600000000000",
      total_debt_usd_after: "600000000000",
      total_collateral_usd_before: "800000000000",
      total_collateral_usd_after: "800000000000",
      market_realization: {
        hfs_unchanged: true,
        execution_shortfall_usd: "84000000000",
        bad_debt_at_liquidation_usd: "23100000000",
        usd_decimals: 8,
        seizure_model: "pro-rata-over-counted-collateral",
        note:
          "DERIVED VARIANT (W-TN-B): market value is not an oracle mark, so no health factor " +
          "moved; the gap the protocol is not seeing is this block's two figures.",
      },
      projection: null,
      note:
        "DERIVED VARIANT (W-TN-B): no oracle mark moved, so both sides of every figure are " +
        "equal by construction and the three deltas are structural zeros. The scenario's " +
        "information content is the market_realization block on this row.",
    },
    {
      ...structuredClone(pristineDmRow),
      ...unshockedSides,
      hf_dropped_accounts: null,
      flipped_to_eligible: 0,
      total_debt_usd_before: "4200000000",
      total_debt_usd_after: "4200000000",
      total_collateral_usd_before: "4000000000",
      total_collateral_usd_after: "4000000000",
      market_realization: {
        hfs_unchanged: true,
        execution_shortfall_usd: "3100000000",
        bad_debt_at_liquidation_usd: "1250000000",
        usd_decimals: 6,
        seizure_model: "pro-rata-over-counted-collateral",
        note:
          "DERIVED VARIANT (W-TN-B): market value is not an oracle mark, so no eligibility " +
          "flipped; the gap the protocol is not seeing is this block's two figures.",
      },
      projection: null,
      note:
        "DERIVED VARIANT (W-TN-B): no oracle mark moved, so both sides of every figure are " +
        "equal by construction and the three deltas are structural zeros. The scenario's " +
        "information content is the market_realization block on this row.",
    },
  ],
  positions_answered: 2,
  positions_withheld: 0,
  note:
    "DERIVED VARIANT (W-TN-B): re-identified byte-for-byte to the committed " +
    "weeth_market_depeg_oracles_held definition; shortfall figures are documented derivations, " +
    "asymmetric across engines so a swapped block cannot pass.",
};

// dm_rate_horizon_plus_200bps — `projection_no_spot_pass`, whose answer is the
// MANDATORY projection block (r57 item 5). Horizon arithmetic re-derived.
const dmRateDefinition = definitionOf("dm_rate_horizon_plus_200bps");
if (JSON.stringify(dmRateDefinition.engines) !== JSON.stringify(["debt_manager"])) {
  fail("dm_rate_horizon_plus_200bps's committed coverage moved; re-derive this variant");
}
const DM_RATE_DEBT = 4200000000n;
const DM_RATE_BPS = 200n;
const YEAR_SECONDS = 31536000n;
const horizonInterest = (seconds) =>
  (DM_RATE_DEBT * DM_RATE_BPS * BigInt(seconds)) / (10000n * YEAR_SECONDS);
const horizon = (seconds, becomesLiquidatable) => {
  const interest = horizonInterest(seconds);
  return {
    horizon_seconds: seconds,
    debt_usd: DM_RATE_DEBT.toString(),
    projected_usd: (DM_RATE_DEBT + interest).toString(),
    additional_interest_usd: interest.toString(),
    becomes_liquidatable: becomesLiquidatable,
  };
};
if (horizonInterest(86400).toString() !== "230136" || horizonInterest(2592000).toString() !== "6904109") {
  fail("variant: the projection's delta-only horizon arithmetic moved; re-derive it");
}
const dmRateResult = {
  scenario_id: dmRateDefinition.id,
  scenario_version: dmRateDefinition.version,
  label: dmRateDefinition.label,
  path_assumption: dmRateDefinition.path_assumption,
  shocks: structuredClone(dmRateDefinition.shocks),
  shock_reach: {
    declared_shocks: dmRateDefinition.shocks.length,
    declared_shocks_at_identity: dmRateDefinition.shocks.filter(
      (shock) => shock.factor_num === shock.factor_den,
    ).length,
    reach: "projection_no_spot_pass",
    applied_shocks: [],
    marks_moved: 0,
    marks_held_by_declared_factor: 0,
    marks_held_by_transform: 0,
    marks_held_by_arithmetic: 0,
    marks_snapped: 0,
    marks_base_snapped: 0,
    marks_cap_bound: 0,
    held_flat_marks: 0,
    held_flat_assets: [],
    note:
      "PROJECTION, NO SPOT PASS: no ApplyScenario pass ran at all, so the after side IS the " +
      "before side, nothing was applied and nothing was held flat. The declared borrow_apy " +
      "shock at 1/1 was not applied to any mark; the projection block is the answer.",
  },
  covered_engines: structuredClone(dmRateDefinition.engines),
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [
    {
      ...structuredClone(pristineDmRow),
      ...unshockedSides,
      hf_dropped_accounts: null,
      flipped_to_eligible: 0,
      total_debt_usd_before: "4200000000",
      total_debt_usd_after: "4200000000",
      total_collateral_usd_before: "4000000000",
      total_collateral_usd_after: "4000000000",
      market_realization: null,
      projection: {
        label: "PROJECTION",
        basis: "delta-only",
        annual_delta_bps: 200,
        apy_observed_at_block: 22334455,
        prices_held_flat: true,
        horizons: [horizon(86400, false), horizon(2592000, null)],
        note:
          "DERIVED VARIANT (W-TN-B): delta-only over this engine's own 4200000000 book; " +
          "floor(debt x 200bps x t / year) per horizon. The 30-day becomes_liquidatable is " +
          "null because it is NOT STATED, which is a different fact from false.",
      },
      note:
        "DERIVED VARIANT (W-TN-B): the after side IS the before side, so every two-sided " +
        "figure is equal by construction. The projection block on this row is the answer.",
    },
  ],
  positions_answered: 1,
  positions_withheld: 0,
  note:
    "DERIVED VARIANT (W-TN-B): re-identified byte-for-byte to the committed " +
    "dm_rate_horizon_plus_200bps definition; the projection figures are documented " +
    "derivations in generate-run-book-set.mjs.",
};

variant.requested_scenario_ids = [
  "eth_minus_30",
  "weeth_market_depeg_oracles_held",
  "dm_rate_horizon_plus_200bps",
  "ethfi_minus_50",
];
variant.results = [ethResult, weethResult, dmRateResult, ethfiResult];
variant.evaluation.scenarios_evaluated = 4;

assertMembership("run-book-set.no-denominator.json", variant);

// The variant's own arithmetic, re-derived rather than trusted: the two DM
// ratios must order 0.5 above 0.25 with opposite signs, and the aave row must
// be the exact zero-denominator state.
const ratioOf = (row) => Number(row.eligible_debt_delta_usd) / Number(row.total_debt_usd_before);
if (aaveRow.total_debt_usd_before !== "0") fail("variant: the aave row lost its zero denominator");
if (ratioOf(ethDmRow) !== -0.25) fail("variant: eth_minus_30's dm ratio is not -0.25");
if (ratioOf(ethfiResult.engines[0]) !== 0.5) fail("variant: ethfi_minus_50's dm ratio is not 0.5");

write("run-book-set.no-denominator.json", variant);

// --- 5: the listing that publishes the example's own three ids ---------------

const scenarioFileOf = (id) => {
  const file = path.join(repoRoot, "internal", "risk", "scenarios", `${id}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
};

const extendedListing = structuredClone(listing);
for (const id of ["stable_depeg_0995_in_band", "dm_composition_census"]) {
  if (extendedListing.scenarios.some((scenario) => scenario.id === id)) {
    fail(`the committed listing now publishes ${id}; drop the extension for it`);
  }
  const committed = scenarioFileOf(id);
  const answered = example.results.find((result) => result.scenario_id === id);
  if (answered === undefined) {
    fail(`the contract example no longer answers ${id}; re-derive the extended listing`);
  }
  // The identity join the tornado makes is asserted here, against the
  // committed definition file AND the example's own result: a drifted pair
  // would make every e2e row read DEFINITION CHANGED or COVERAGE SKEW.
  if (committed.version !== answered.scenario_version) {
    fail(`${id}: the committed definition's version disagrees with the example's result`);
  }
  if (
    JSON.stringify([...committed.engines].sort()) !==
    JSON.stringify([...answered.covered_engines].sort())
  ) {
    fail(`${id}: the committed definition's engines disagree with the example's covered set`);
  }
  // ScenarioDefinition's exact property set — `propagation` is deliberately
  // NOT copied: the listing route does not publish it (rev2 §2.5).
  extendedListing.scenarios.push({
    id: committed.id,
    version: committed.version,
    label: committed.label,
    description: committed.description,
    path_assumption: committed.path_assumption,
    engines: structuredClone(committed.engines),
    shocks: structuredClone(committed.shocks),
    out_of_model: structuredClone(committed.out_of_model),
  });
}
write("run-book-set.scenarios.json", extendedListing);
