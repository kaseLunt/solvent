// Whole-book scenario-dashboard (W-SD-A) fixture generation + THE PROVENANCE
// RECORD. Regenerate with:
//
//   node tests/fixtures/generate-lab-book.mjs        (from web/)
//
// Sibling waves each own their generator. This one writes ONLY the files
// listed below; `generate.mjs` owns the address-mode lab fixtures and
// `generate-book.mjs` owns the Book surface's. Every fixture here is GENERATED
// from committed contract artifacts — never hand-shaped wire data. The
// sanctioned sources, per file:
//
//  1. scenarios.json — `GET /v1/scenarios`.
//     Envelope (`served_at`, `scenario_config_version`, `notes`) extracted
//     VERBATIM from `api/openapi.yaml`'s own 200 example. `scenarios[]` is
//     the contract's OWN stated derivation applied mechanically:
//     `ScenarioDefinition` ≡ `Omit<Scenario, "results">` — welded at compile
//     time in `packages/client-ts/test/scenarios.test.ts` — so the committed
//     definitions are taken from the contract-validated `stress-aave.json`'s
//     `scenarios[]` with the per-address `results` key DELETED, in wire order,
//     then extended with any definition the openapi example carries that the
//     excerpt does not (deduped by id, example order). Nothing is invented and
//     no field is edited.
//
//  2. run-book.eth_minus_30.json — `POST /v1/scenarios/eth_minus_30/run-book`.
//     The contract's own run-book 200 example (already extracted verbatim by
//     `generate.mjs` into run-book.weeth_market_depeg_oracles_held.json) as
//     the ENVELOPE, RE-IDENTIFIED to the eth_minus_30 committed definition:
//     `scenario_id` / `scenario_version` / `label` / `description` /
//     `path_assumption` / `shocks` / `out_of_model` copied byte-identically
//     from that definition.
//     `market_realization` is set to null on every engine because the contract
//     says it is "present when the scenario carries a market-realization axis"
//     and eth_minus_30 does not carry one.
//
//     WAVE W-BS-C. Re-identifying an envelope is not free: the moment a body
//     says it answers eth_minus_30, THE PROPAGATION MATRIX BINDS IT. That matrix
//     lives in `internal/risk/scenarios/eth_minus_30.json` — the Go registry
//     `risk.LoadScenarios` reads and `risk.ApplyScenario` evaluates — and the
//     wire never publishes it, so this generator reads the registry file
//     directly. Its rule is absolute in both directions: an asset NO propagation
//     row describes is HELD FLAT (scenario.go:679-686), and an asset one DOES
//     describe moves by the product of the shocked axes it responds to. Two
//     halves of this file used to violate it:
//
//       - THE INVENTED ACCOUNT held an invented address and was shocked 70/100.
//         Production would have held that address flat, leaving the account at
//         $2,500 of collateral, $2,000 of maxBorrowLT and healthy — so the
//         mover, the flip and every aggregate under them described an event
//         that could not occur. It now holds WETH-on-Optimism, the matrix's
//         SECOND declared row, at the factor the matrix composes for it.
//       - THE AAVE ENGINE carried the oracles-held example's own rows, in which
//         both sides are bit-identical by construction, while `applied_shocks`
//         was flattened in from `stress-aave.json`'s per-address results. A
//         disclosure from a different book, over an aggregate that never moved.
//         The aave engine is now RE-MEASURED from `stress-aave.json`'s own
//         contract-validated eth_minus_30 result — same batch, same account,
//         same money — with `liq_threshold` / `liq_bonus` read from the
//         contract's OWN /v1/params example and the threshold PROVEN against the
//         result's published health-factor rationals before the bonus is used.
//
//     `applied_shocks` and `held_flat` are composed from THIS body's own price
//     inputs, the way `p5_runbook.go` composes them, so every disclosed shock
//     has an aggregate behind it and every held price is named.
//
//     ONE DOCUMENTED DERIVED DELTA on the Debt Manager side, kept internally
//     CONSISTENT so the delta is real in the data and not merely asserted: an
//     INVENTED WHOLE ACCOUNT is added to the debt_manager book on BOTH sides,
//     carrying its own debt and its own collateral, healthy before the shock and
//     eligible after it. Every aggregate it touches moves with it — `accounts`,
//     `total_debt_usd`, `total_collateral_usd` and its itemization,
//     `eligible_accounts`, `eligible_debt_usd`, `collateral_at_risk_usd`, the
//     histogram census — and `coverage.in_book` / `batch.position_count` count
//     it as the batch row it is. `newly_eligible_accounts` /
//     `eligible_debt_delta_usd` / `bad_debt_delta_usd` are recomputed from
//     before/after rather than stated independently, and `checkResponse` refuses
//     the write unless every cross-field law the web renders — AND every
//     propagation law above — holds over the WHOLE body. The guard's own
//     sensitivity is proven on two mutants at the write site: it must refuse the
//     W-BS-B shape and it must refuse an undeclared shock.
//
//  3. run-book.weeth.batch2.json and run-book.eth_minus_30.batch2.json — files
//     2 and the run-book example with ONE field changed: the batch id, plus its
//     `computed_at` advanced to stay ordered. These are the SUPERSESSION
//     inputs. A superseded result must differ from the current one in exactly
//     the batch it was measured at and in nothing else, which is why these
//     files edit exactly that — the weeth one drives a row out of the cohort,
//     the eth one proves a re-run brings it back.
//
//  4. run-book.weeth-withheld.json — the run-book 200 example with the aave
//     engine MOVED from `engines[]` into `excluded_engines[]`, carrying the
//     canonical FLAG_CUSTODY_UNPROVEN refusal copied byte-identically from
//     `book-engine-refused.json`. `coverage.withheld_engines` gets the same
//     refusal and `coverage.stress_coverage_is_full` becomes false, which is
//     the contract's own fail-closed rule ("false if any position could not be
//     rebuilt OR any engine is withheld"). The withheld engine is absent from
//     `engines[]` entirely — exactly as the schema says it must be.
//
//  5. run-book.names-nobody.json — the run-book 200 example with BOTH engine
//     arrays EMPTIED (`engines: []`, `excluded_engines: []`) and NOTHING ELSE
//     touched. This is the degraded 200 the contract's own schemas permit:
//     neither array carries `minItems`, and `lib/runbook.ts` does no cross-field
//     validation, so a body that names no engine at all parses and typechecks
//     exactly like a healthy one. `coverage` is deliberately left claiming
//     `stress_coverage_is_full: true` with an empty `withheld_engines` — the
//     whole point of the fixture is that the ENVELOPE still looks healthy while
//     the arrays name nobody, which is why row presentation must derive from the
//     arrays (Wave R11) and never from envelope presence.
//     run-book.names-nobody.batch2.json is that file with ONE field changed —
//     the batch id, `computed_at` advanced to stay ordered, exactly as in (3).
//     It is the ANCHOR half of the same finding: a book that displays nothing
//     must not raise the anchor or the watermark, so a NEWER batch carried by a
//     naming-nobody 200 must leave an older DISPLAYED result current rather than
//     repainting it SUPERSEDED under a cohort nothing belongs to.
//
//  6. run-book.contradictory.json — WAVE R12, FINDING 1. File (4) with ONE
//     array changed back: `engines[]` restored to the run-book example's own
//     full array, while `excluded_engines[]` KEEPS the FLAG_CUSTODY_UNPROVEN
//     refusal (4) put there. `coverage` is left exactly as (4) left it. The
//     result is the body a deployment produces when it records an engine's
//     refusal but fails to drop the served row: aave_v3_etherfi is named in
//     BOTH arrays, served and withheld at once, from one response.
//     Nothing here is invented — every byte comes from (4) or from the example
//     it derives from. The contract permits it: neither array carries
//     `uniqueItems`, there is no cross-field rule between them, and
//     `lib/runbook.ts` does no validation, so it parses and typechecks exactly
//     like a healthy body. It is the fixture that proves the OLD precedence
//     (engines[] before excluded_engines[]) rendered a numeric RESULT in the
//     matrix while the detail view rendered WITHHELD, from the same response.
//
//  7. run-book.named-twice.json — WAVE R12, FINDING 1, the other arm. The
//     run-book 200 example with its aave engine object APPENDED to `engines[]`
//     a second time, byte-identical, and nothing else touched. Two results
//     offered for one cell, with nothing in the body saying which is the
//     answer — the failure `Array.prototype.find` resolves silently by taking
//     whichever came first.
//
//  8. scenarios.v2.json + run-book.ethfi_minus_50.v2.json — WAVE R12,
//     FINDING 2: THE VERSION-SKEW PAIR. Both derive mechanically from committed
//     bytes, and BOTH ARE INDIVIDUALLY VALID — that is the whole point of the
//     finding, which is about the unguarded JOIN between them and not about
//     either response.
//
//     scenarios.v2.json is (1) with THREE fields moved, all on the same axis:
//     the set's `scenario_config_version` becomes "v2", and the ethfi_minus_50
//     definition's own `version` becomes "v2" with its `engines[]` narrowed to
//     ["aave_v3_etherfi"]. That is a committed definition being re-cut across a
//     deployment — the ordinary event the finding is about, not a malformed
//     body.
//
//     run-book.ethfi_minus_50.v2.json is the run-book example RE-IDENTIFIED to
//     that v2 definition exactly as (2) re-identifies to eth_minus_30 — id,
//     version, label, description, path_assumption, shocks, out_of_model copied
//     byte-identically from scenarios.v2.json's own entry — carrying
//     `scenario_config_version: "v2"` and, matching the v2 definition's
//     coverage, only the aave engine in `engines[]`.
//
//     THE DEFECT THIS PAIR REPRODUCES: joined by scenario id alone, this valid
//     v2 response read against the RETAINED v1 listing (which covers
//     debt_manager for this id) names none of v1's covered engines — so R11
//     classifies the row ALL-HOLE and the header says "the book named nobody"
//     while the detail view renders the real aave result the response carries.
//
//  9. scenarios.removed.json — WAVE R13, FINDING 1: THE DELISTED ROW. File (1)
//     with ONE definition FILTERED OUT — `weeth_market_depeg_oracles_held`, in
//     place, every surviving byte identical and in wire order. That is a
//     deployment dropping a committed scenario, which the contract's own note
//     already anticipates ("an id absent from this listing is a 404 there").
//
//     `scenario_config_version` IS DELIBERATELY LEFT AT v1, and that is the
//     fixture's whole point rather than an oversight. Wave R12's identity guard
//     is derived PER ROW, so moving the set token would refuse every SURVIVING
//     row as DEFINITION CHANGED and leave the table with nothing displayed —
//     hiding the defect behind a guard that never sees it. A guard keyed per row
//     cannot say anything about a row that is not there: `identity.get(id)` and
//     `coverage.get(id)` are both undefined for the dropped scenario, so
//     `definitionSkew` and `isAllHoleBook` each correctly decline to infer, and
//     the orphaned phase reaches the cohort as a DISPLAYED PIN with no rendered
//     row anywhere. Holding the token still isolates that orphan as the only
//     anomaly on the table.
//
// 10. scenarios.relisted.json + run-book.weeth.v2.json — WAVE R14, FINDING 1:
//     THE RE-LISTED ROW. (9) with the dropped definition PUT BACK, in its
//     original wire position, with ONE field moved: its own `version` becomes
//     "v2". The set's `scenario_config_version` is again LEFT at v1, for exactly
//     the reason (9) leaves it: moving it would refuse every surviving row and
//     hide the finding behind a guard that never sees it.
//
//     That is the sequence the finding is about, told in three listings the
//     deployment actually serves: v1 lists the scenario, the next deployment
//     drops it, the next republishes it RE-CUT. R13 filters the orphan out of
//     the middle listing correctly; the defect is the third step, where
//     `listedPhases` re-admits the stored phase on the strength of its id alone.
//     For a `kind: "ok"` outcome R12 catches it — the body publishes its own
//     identity — but a RUNNING phase and a NON-OK outcome publish nothing, so
//     the v1 failure renders on the v2 row as RUNNING or UNANSWERED and the
//     header counts v2 as attempted.
//
//     run-book.weeth.v2.json is what the third deployment answers for that id:
//     the run-book example with `scenario_version` moved to "v2" to match the
//     re-listed definition and NOTHING else touched — `scenario_config_version`
//     stays v1 because the set's token did not move. It is the clean re-run that
//     proves the row works normally once it is asked under the definition on
//     screen.
//
// 11. run-book.partial-hole.json — WAVE R14, FINDING 2: THE PARTIAL HOLE. File
//     (4) with its ONE edit undone: the aave engine is dropped from `engines[]`
//     exactly as (4) drops it, but `excluded_engines[]` is left EMPTY — no
//     refusal is recorded for it. `coverage` is left untouched, still claiming
//     `stress_coverage_is_full: true`, for the same reason (5) leaves it: the
//     envelope looks healthy while the arrays name only half the row.
//
//     It is the body a deployment produces when an engine's row is dropped
//     without its refusal being recorded, and the contract permits it for the
//     reasons (5) sets out. `weeth_market_depeg_oracles_held` is committed for
//     BOTH engines, so aave is named in neither array: its cell reads UNANSWERED
//     while `excluded_engines.length === 0` — which is the whole condition the
//     detail panel used to render "excluded engines: none — every engine's book
//     reached the run" on. One screen, two mutually exclusive statements.
//
// 12. run-book.collateral-collision.json + .swap.json — WAVE W-BS-B,
//     FINDING 4: THE COLLIDING COLLATERAL ROWS. The run-book example with ONE
//     entry added to the aave engine's `collateral_by_asset` on both sides —
//     the same weETH it already counts, carried a second time under the
//     NOT-COUNTED disclosure, which is the pair the LIVE book already serves.
//     The `.swap` file is the same body with different balances, so a rerun
//     that reconciled the two rows by guessing shows a wrong number rather than
//     a silent identity error. Full derivation at the write site.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (installed by `scripts/ensure-client.mjs`) — no new web dependency.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const contractPath = path.join(repoRoot, "api", "openapi.yaml");

let YAML;
try {
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  console.error(
    "generate-lab-book.mjs: cannot resolve the `yaml` package from\n" +
      "packages/client-ts/node_modules. Run `node scripts/ensure-client.mjs` first.",
  );
  process.exit(1);
}

const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const write = (name, body) => {
  writeFileSync(path.join(here, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote   ${name}`);
};

const fail = (message) => {
  console.error(`generate-lab-book.mjs: ${message}`);
  process.exit(1);
};

const contract = YAML.parse(readFileSync(contractPath, "utf8"));
const scenariosExample =
  contract.paths["/v1/scenarios"].get.responses["200"].content["application/json"].example;

// --- 1: the committed listing ---------------------------------------------

const stressAave = read("stress-aave.json");
const fromExcerpt = stressAave.scenarios.map((scenario) => {
  // The contract's OWN derivation: ScenarioDefinition ≡ Omit<Scenario,"results">.
  const definition = { ...scenario };
  delete definition.results;
  return definition;
});
const seen = new Set(fromExcerpt.map((definition) => definition.id));
const extra = scenariosExample.scenarios.filter((definition) => !seen.has(definition.id));

const committedListing = {
  served_at: scenariosExample.served_at,
  scenario_config_version: scenariosExample.scenario_config_version,
  scenarios: [...fromExcerpt, ...extra],
  notes: scenariosExample.notes,
};

write("scenarios.json", committedListing);

// --- 2 + 3: eth_minus_30 run-book, re-identified + one consistent delta ----

const runBookExample = read("run-book.weeth_market_depeg_oracles_held.json");
const ethDefinition = stressAave.scenarios.find((scenario) => scenario.id === "eth_minus_30");
if (ethDefinition === undefined) {
  fail("stress-aave.json carries no eth_minus_30 definition");
}

// --- THE PROPAGATION MATRIX: THE COMMITTED TRUTH -------------------------
//
// `GET /v1/scenarios` does NOT publish `propagation` — `ScenarioDefinition`
// carries id/version/label/description/path_assumption/engines/shocks/
// out_of_model and nothing else (verified against the live listing at :8080,
// and against `api/openapi.yaml`'s own schema). The propagation matrix — WHICH
// asset on WHICH chain responds to WHICH axis — lives in exactly one committed
// place: the Go scenario registry, `internal/risk/scenarios/eth_minus_30.json`,
// loaded by `risk.LoadScenarios` (internal/risk/scenario.go:262-320) and
// consumed by `risk.ApplyScenario` (internal/risk/scenario.go:654-789).
//
// THAT FILE IS THE SOURCE READ HERE, because it is the source PRODUCTION reads.
// `ApplyScenario` looks each price input up by `responseKey(chainID, asset)`
// (scenario.go:792-794) and, for an input NO propagation row describes, HOLDS
// THE PRICE FLAT and records it on `ScenarioApplication.HeldFlat`
// (scenario.go:679-686). An asset the matrix does not name CANNOT move, and an
// asset it does name CANNOT stay still. A fixture that shocks an unmapped asset
// is not a fixture of this system.
const scenarioRegistry = path.join(repoRoot, "internal", "risk", "scenarios");
const committedScenario = (id) => {
  try {
    return JSON.parse(readFileSync(path.join(scenarioRegistry, `${id}.json`), "utf8"));
  } catch {
    return fail(`the committed scenario registry holds no ${id}.json`);
  }
};
const ethCommitted = committedScenario("eth_minus_30");

// The registry file and the wire definition must be the SAME scenario, or the
// matrix read here describes something the response does not claim to be.
if (ethCommitted.id !== ethDefinition.id || ethCommitted.version !== ethDefinition.version) {
  fail(
    `the committed registry carries ${ethCommitted.id}@${ethCommitted.version} but the wire ` +
      `definition is ${ethDefinition.id}@${ethDefinition.version}`,
  );
}
if (JSON.stringify(ethCommitted.shocks) !== JSON.stringify(ethDefinition.shocks)) {
  fail("the committed registry's shocks[] and the wire definition's shocks[] differ");
}

/** ApplyScenario's OWN axis key — `axis|lowercased asset` (scenario.go:105-107). */
const axisKey = (ref) => `${ref.axis}|${(ref.asset ?? "").toLowerCase()}`;

/** ApplyScenario's OWN response key — `chain|lowercased address` (scenario.go:792-794). */
const responseKey = (chainId, asset) => `${String(chainId)}|${asset.toLowerCase()}`;

/**
 * One committed scenario's propagation truth, keyed the way the evaluator keys
 * it, plus the factor it composes for any row.
 *
 * `composedFactor` is `ApplyScenario`'s own composition (scenario.go:692-700):
 * the PRODUCT of the shocked axes a row responds to. An axis the scenario does
 * not shock contributes nothing — which is how weETH, declared against BOTH
 * `eth_usd` and `weeth_eth_rate`, moves by the eth_usd factor alone here.
 *
 * The snap paths are refused rather than reimplemented: a `stable_snap` or
 * `base_stable_snap` row does not move by a plain rational and this generator
 * has no standing to model the band. Neither scenario used here declares one.
 */
const matrixFor = (committed) => {
  const shockFactors = new Map(
    committed.shocks
      .filter((shock) => shock.axis !== "borrow_apy") // ApplyScenario skips it
      .map((shock) => [axisKey(shock), [BigInt(shock.factor_num), BigInt(shock.factor_den)]]),
  );
  const rows = new Map(
    committed.propagation.map((row) => [responseKey(row.chain_id, row.asset), row]),
  );
  const composedFactor = (row) => {
    if (row.stable_snap === true || row.base_stable_snap === true) {
      fail(`propagation row ${row.asset} carries a snap flag this generator does not model`);
    }
    let num = 1n;
    let den = 1n;
    for (const ref of row.responds_to) {
      const factor = shockFactors.get(axisKey(ref));
      if (factor === undefined) {
        continue;
      }
      num *= factor[0];
      den *= factor[1];
    }
    return [num, den];
  };
  return { rows, composedFactor };
};

const ethMatrix = matrixFor(ethCommitted);
const propagation = ethMatrix.rows;
const composedFactor = ethMatrix.composedFactor;

/** Each engine's chain, read from the response's OWN batch watermarks. */
const engineChain = new Map(
  runBookExample.batch.watermarks.map((watermark) => [watermark.engine, watermark.chain_id]),
);

/** The derived delta, in the Debt Manager's own 6-decimal USD. */
const DM_DELTA = 1_500_000_000n;

// --- CONTRACT 1.6.0: the three additive fields, DERIVED not stated ---------
//
// `hf_histogram`, `collateral_by_asset` (on each aggregate) and
// `movers`/`movers_total`/`movers_note` (on each engine) ride the run-book
// example VERBATIM into every file this generator spreads from, exactly as
// every other field does. Only ONE file derives anything: the eth_minus_30
// delta below, which invents a newly-eligible Debt Manager account.
//
// # THE ACCOUNT IS A WHOLE ACCOUNT, not a number added to one field
//
// An earlier revision of this block added DM_DELTA to `eligible_debt_usd` and
// stopped there. The result was a body that could not exist: 5,700,000,000 of
// eligible debt inside 4,620,000,000 of total debt, two accounts both eligible
// against one account's worth of debt, and three accounts across the two
// engines under a `coverage.in_book` of 2. Every one of those is a cross-field
// law the web renders, and `checkSide` greened all of it because it checked
// only three of them.
//
// So the invented account is constructed as an ACCOUNT and every aggregate it
// touches moves with it, mechanically:
//
//   accounts        1 -> 2 on BOTH sides. A price shock does not create an
//                   account; the second one must exist before it can flip.
//   total_debt_usd  += its borrowings, on BOTH sides. The Debt Manager's debt
//                   leg is USD-NORMALIZED and no scenario re-prices it (see
//                   `stable_depeg_0995_in_band`'s own out_of_model note), so
//                   the same figure rides both sides.
//   total_collateral_usd / collateral_by_asset
//                   += its holding, valued at its OWN price on each side. The
//                   entries still sum to the total EXACTLY, which is the
//                   contract's own law for that itemization.
//   eligible_*      the account is healthy before and eligible after, so it
//                   contributes to the AFTER side only — and `eligible_debt_usd`
//                   moves by exactly DM_DELTA, which is what keeps
//                   `eligible_debt_delta_usd` at its pinned "1500000000".
//   collateral_at_risk_usd / bad_debt_usd
//                   the waterfall's OWN formulas, applied to the after side:
//                   at risk is Σ min(collateral, debt × (1+bonus)) and bad debt
//                   is Σ max(0, debt − collateral/(1+bonus)) over the eligible
//                   (internal/risk/waterfall.go:96-103). Those two formulas
//                   reproduce the example's own 4,000,000,000 and 239,603,961
//                   from its own inputs, which is why they are trustworthy here.
//   hf_histogram    census == that side's `accounts`, and the count strictly
//                   below the 1.00 edge == that side's `eligible_accounts`. The
//                   BUCKET IS DERIVED from the same exact rational the mover row
//                   publishes, so the two can never tell different stories.
//   movers          exactly one row, the account that flipped, carrying that
//                   rational on each side and `debt_usd` equal to DM_DELTA.
//   coverage        `in_book` is the count of positions that reached the run —
//                   Σ of each engine's `accounts` — so it moves too, and
//                   `batch_positions` / `batch.position_count` with it.
//
// # What is NOT recomputed, and why
//
// The example's OWN rows are left byte-identical. This file's provenance (item
// 2 above) is a RE-IDENTIFICATION of the contract's example, not a re-run of
// the scenario against it: the example was measured under an oracles-held
// scenario, so its two sides are identical by construction, and recomputing
// them here would be this generator inventing a book rather than deriving one.
// The invented account is therefore the only row that responds to the shock —
// and it responds by the scenario's OWN committed factor, read from the
// definition's `shocks[]` rather than typed in.

/** A fixture account for the one derived Debt Manager flip. */
const DM_FLIP_ACCOUNT = "0x00000000000000000000000000000000000d0002";

/**
 * The collateral that account holds: WETH on Optimism — an asset the
 * eth_minus_30 propagation matrix DECLARES for the Debt Manager's own chain.
 *
 * # WHY THIS ASSET AND NOT AN INVENTED ONE
 *
 * The account used to hold an invented address. Production would have held that
 * address FLAT — `ApplyScenario` shocks nothing it cannot find in the matrix —
 * so the fixture's 70/100 move was a price no evaluator could have produced,
 * and the account would really have stayed at $2,500 of collateral, $2,000 of
 * maxBorrowLT and healthy. The mover row, the histogram flip and every
 * aggregate downstream of it described an event that could not happen.
 *
 * WETH-on-OP is `internal/risk/scenarios/eth_minus_30.json`'s second
 * propagation row: chain 10, `responds_to: [eth_usd]`, note "Chainlink ETH/USD
 * push proxy behind PriceProviderV2" — the Debt Manager's OWN price provider.
 * Three properties make it the right pick:
 *
 *   1. It responds to EXACTLY the scenario's one declared axis, so its factor is
 *      the scenario's own 70/100 with no composition and nothing to reconcile.
 *   2. It carries neither snap flag, so it moves by that plain rational.
 *   3. IT COLLIDES WITH NOTHING. The example's Debt Manager side already carries
 *      0xCd5f… (the mainnet weETH address) and the matrix does not describe that
 *      address ON CHAIN 10 — the DM's weETH is 0x5A7f… there — so the example's
 *      own entry is HELD FLAT by the matrix, exactly as its own bytes hold it.
 *      No entry has to claim two price paths and no (asset, disclosure) key
 *      repeats.
 *
 * The symbol is READ from the propagation row, not invented: the registry names
 * this one, so serving it is disclosure rather than fabrication.
 */
const DM_FLIP_ASSET = "0x4200000000000000000000000000000000000006";
const DM_FLIP_ASSET_DECIMALS = 18;
const DM_FLIP_AMOUNT = 2_500_000_000_000_000_000n; // 2.5 tokens at 18 decimals
const DM_FLIP_PRICE_BEFORE = 1_000_000_000n; // $1,000.000000 in the DM's 6-dec USD

const DM_CHAIN = engineChain.get("debt_manager");
if (DM_CHAIN === undefined) {
  fail("the run-book example's batch names no debt_manager watermark, so its chain is unknown");
}

/** THE DECLARATION, asserted against the committed matrix rather than assumed. */
const dmFlipRow = propagation.get(responseKey(DM_CHAIN, DM_FLIP_ASSET));
if (dmFlipRow === undefined) {
  fail(
    `the eth_minus_30 propagation matrix does not declare ${DM_FLIP_ASSET} on chain ` +
      `${String(DM_CHAIN)}, so production would hold it FLAT and the flip could not happen`,
  );
}
if (typeof dmFlipRow.symbol !== "string" || dmFlipRow.symbol.length === 0) {
  fail(`the propagation row for ${DM_FLIP_ASSET} names no symbol, and none is invented`);
}
const DM_FLIP_SYMBOL = dmFlipRow.symbol;

// The Debt Manager's committed weETH configuration, the same pair the seeded
// API fixture welds against: threshold 80e18/100e18 and an ADDITIVE 1e18 bonus
// over HUNDRED_PERCENT = 100e18, i.e. +1%.
const DM_LT_NUM = 80n;
const DM_LT_DEN = 100n;
const DM_BONUS_NUM = 101n;
const DM_BONUS_DEN = 100n;

/**
 * THE ASSET'S OWN FACTOR, composed the way the evaluator composes it — read
 * from the matrix, never typed in, and never read off the scenario's `shocks[]`
 * directly. An asset's factor is a PRODUCT over the axes it responds to, and
 * only an asset responding to exactly one shocked axis has the axis's own
 * factor. Deriving it per asset is what makes that distinction survive.
 */
const [FACTOR_NUM, FACTOR_DEN] = composedFactor(dmFlipRow);
if (FACTOR_NUM === 1n && FACTOR_DEN === 1n) {
  fail(`${DM_FLIP_SYMBOL} responds to no axis this scenario shocks, so nothing would move`);
}

// THE COLLISION CHECK. The invented balance may not land on an asset the
// example's Debt Manager side already carries: one asset at one price moves by
// one factor, so a second entry for it would be two rows claiming one identity —
// and folding the balance in would make the merged entry claim a price path the
// example's own bytes contradict.
for (const side of ["before", "after"]) {
  for (const entry of runBookExample.engines.find((e) => e.engine === "debt_manager")[side]
    .collateral_by_asset) {
    if (entry.asset.toLowerCase() === DM_FLIP_ASSET.toLowerCase()) {
      fail(
        `the example's debt_manager ${side} side already carries ${DM_FLIP_ASSET}; ` +
          `the invented balance would collide with it`,
      );
    }
  }
}

const TOKEN_UNIT = 10n ** BigInt(DM_FLIP_ASSET_DECIMALS);

/** floor(amount × price / 10^decimals) — the Debt Manager's own valuation. */
const dmValue = (amount, price) => (amount * price) / TOKEN_UNIT;

const DM_FLIP_PRICE_AFTER = (DM_FLIP_PRICE_BEFORE * FACTOR_NUM) / FACTOR_DEN;
const DM_FLIP_VALUE_BEFORE = dmValue(DM_FLIP_AMOUNT, DM_FLIP_PRICE_BEFORE);
const DM_FLIP_VALUE_AFTER = dmValue(DM_FLIP_AMOUNT, DM_FLIP_PRICE_AFTER);

// floor(value × LT / HUNDRED_PERCENT), per token then summed — one token here.
const DM_FLIP_MAXBORROW_BEFORE = (DM_FLIP_VALUE_BEFORE * DM_LT_NUM) / DM_LT_DEN;
const DM_FLIP_MAXBORROW_AFTER = (DM_FLIP_VALUE_AFTER * DM_LT_NUM) / DM_LT_DEN;

// THE FLIP IS ASSERTED FROM THE ARITHMETIC, not assumed. The Debt Manager's
// test is STRICT — borrowings > maxBorrowLT — and equality is healthy.
if (DM_DELTA > DM_FLIP_MAXBORROW_BEFORE) {
  console.error(
    `generate-lab-book.mjs: the invented account is already eligible BEFORE the shock ` +
      `(${String(DM_DELTA)} > ${String(DM_FLIP_MAXBORROW_BEFORE)}), so nothing flips`,
  );
  process.exit(1);
}
if (DM_DELTA <= DM_FLIP_MAXBORROW_AFTER) {
  console.error(
    `generate-lab-book.mjs: the invented account is still healthy AFTER the shock ` +
      `(${String(DM_DELTA)} <= ${String(DM_FLIP_MAXBORROW_AFTER)}), so nothing flips`,
  );
  process.exit(1);
}

// The waterfall's own two measures, over the ONE eligible-after account.
// internal/risk/waterfall.go:96-103.
const DM_FLIP_AT_RISK_AFTER = (() => {
  const seizable = (DM_DELTA * DM_BONUS_NUM) / DM_BONUS_DEN;
  return seizable < DM_FLIP_VALUE_AFTER ? seizable : DM_FLIP_VALUE_AFTER;
})();
const DM_FLIP_BAD_DEBT_AFTER = (() => {
  const recoverable = (DM_FLIP_VALUE_AFTER * DM_BONUS_DEN) / DM_BONUS_NUM;
  return DM_DELTA > recoverable ? DM_DELTA - recoverable : 0n;
})();

/** Clone a histogram, adding `delta` to the count of one labelled bucket. */
const withBucket = (histogram, label, delta) => {
  const buckets = histogram.buckets.map((bucket) =>
    bucket.label === label ? { ...bucket, count: bucket.count + delta } : bucket,
  );
  if (buckets.every((bucket, index) => bucket.count === histogram.buckets[index].count)) {
    console.error(`generate-lab-book.mjs: no bucket labelled ${label} in the run-book example`);
    process.exit(1);
  }
  return { ...histogram, buckets };
};

/**
 * The bucket an EXACT RATIONAL num/den falls in, tested the way the server
 * tests it: lower_wad × den <= num × wad_scale < upper_wad × den, with no
 * division and therefore no rounding. Deriving the label rather than typing it
 * is what makes the histogram and the mover row incapable of disagreeing.
 */
const bucketLabelForRational = (histogram, num, den) => {
  const scale = BigInt(histogram.wad_scale);
  for (const bucket of histogram.buckets) {
    const aboveLower = bucket.lower_wad === null || BigInt(bucket.lower_wad) * den <= num * scale;
    const belowUpper = bucket.upper_wad === null || num * scale < BigInt(bucket.upper_wad) * den;
    if (aboveLower && belowUpper) {
      return bucket.label;
    }
  }
  console.error(
    `generate-lab-book.mjs: no bucket holds the rational ${String(num)}/${String(den)}`,
  );
  return process.exit(1);
};

/** The count of accounts strictly below the 1.00 edge — the eligible region. */
const belowOne = (histogram) =>
  histogram.buckets.reduce(
    (sum, bucket) =>
      bucket.upper_wad !== null && BigInt(bucket.upper_wad) <= BigInt(histogram.wad_scale)
        ? sum + bucket.count
        : sum,
    0,
  );

/** buckets + infinite — every account this side measured. */
const census = (histogram) =>
  histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0) + histogram.infinite_count;

/**
 * Fail the generation rather than write a self-contradicting side.
 *
 * Every law here is one the web RENDERS, and every one of them is checked
 * against the untouched contract example first — a law the example itself
 * violates would refuse honest bytes this generator has no standing to rewrite.
 */
const checkSide = (name, side) => {
  if (census(side.hf_histogram) !== side.accounts) {
    fail(
      `${name} histogram census ${String(census(side.hf_histogram))} ` +
        `!= accounts ${String(side.accounts)}`,
    );
  }
  if (belowOne(side.hf_histogram) !== side.eligible_accounts) {
    fail(
      `${name} sub-1.00 count ${String(belowOne(side.hf_histogram))} ` +
        `!= eligible_accounts ${String(side.eligible_accounts)}`,
    );
  }
  // AN ELIGIBLE ACCOUNT IS AN ACCOUNT. The eligible set is a subset of the
  // measured set, so its count can never exceed it.
  if (side.eligible_accounts > side.accounts) {
    fail(
      `${name} eligible_accounts ${String(side.eligible_accounts)} ` +
        `> accounts ${String(side.accounts)} — the eligible set is a SUBSET`,
    );
  }
  // ELIGIBLE DEBT IS A SUBSET OF THE DEBT. `eligible_debt_usd` sums the
  // borrowings of the eligible accounts; `total_debt_usd` sums every account's.
  // A book claiming more eligible debt than debt is claiming money it does not
  // carry — the exact shape this wave exists to make impossible.
  if (BigInt(side.eligible_debt_usd) > BigInt(side.total_debt_usd)) {
    fail(
      `${name} eligible_debt_usd ${side.eligible_debt_usd} ` +
        `> total_debt_usd ${side.total_debt_usd} — impossible money`,
    );
  }
  // BAD DEBT IS THE UNRECOVERABLE PART OF THE ELIGIBLE DEBT, so it is bounded
  // by it. (Verified against the example: 239,603,961 of 4,200,000,000.)
  if (BigInt(side.bad_debt_usd) > BigInt(side.eligible_debt_usd)) {
    fail(
      `${name} bad_debt_usd ${side.bad_debt_usd} ` +
        `> eligible_debt_usd ${side.eligible_debt_usd} — bad debt is a PART of the eligible debt`,
    );
  }
  // COLLATERAL AT RISK IS COLLATERAL. It is Σ min(collateral, debt × (1+bonus))
  // over the eligible accounts, so the min alone bounds it by the whole book's
  // counted collateral.
  if (BigInt(side.collateral_at_risk_usd) > BigInt(side.total_collateral_usd)) {
    fail(
      `${name} collateral_at_risk_usd ${side.collateral_at_risk_usd} ` +
        `> total_collateral_usd ${side.total_collateral_usd}`,
    );
  }
  const counted = side.collateral_by_asset
    .filter((entry) => entry.value_usd !== null)
    .reduce((sum, entry) => sum + BigInt(entry.value_usd), 0n);
  if (counted !== BigInt(side.total_collateral_usd)) {
    fail(
      `${name} collateral_by_asset sums ${String(counted)} ` +
        `!= total_collateral_usd ${side.total_collateral_usd}`,
    );
  }
  // ONE ASSET, ONE DISCLOSURE, ONE ENTRY. The server itemizes by asset AND
  // disclosure, so a repeated (asset, disclosure) pair is two rows claiming one
  // identity — the collision the detail view's React key now encodes.
  const seen = new Set();
  for (const entry of side.collateral_by_asset) {
    const disclosure =
      entry.value_usd !== null ? "counted" : entry.unpriced ? "unpriced" : "not-counted";
    const key = `${entry.asset}::${disclosure}`;
    if (seen.has(key)) {
      fail(`${name} carries TWO collateral entries for ${key}`);
    }
    seen.add(key);
  }
};

/**
 * The laws that live ABOVE one side: the response's own account census against
 * the coverage it publishes, and each engine's deltas against its two sides.
 *
 * `coverage.in_book` is the count of positions that reached the run
 * (cmd/api/p5_runbook.go: `coverage(v.Positions, len(beforeInputs), refused)`),
 * and every one of those positions is counted exactly once by its engine's
 * `accounts`. So the two are the SAME number read two ways, and a book whose
 * engines name more accounts than the run admits is describing a different book
 * from the one its coverage describes.
 */
/**
 * THE PROPAGATION GUARD (Wave W-BS-C).
 *
 * `checkSide` and the census laws above check that a body agrees WITH ITSELF.
 * They cannot see the defect this guard exists for, because that defect is a
 * body that is internally perfect and externally impossible: every price it
 * moves has to be a price `risk.ApplyScenario` would have moved, by the factor
 * the committed propagation matrix composes, and every price it holds still has
 * to be one the matrix does not describe.
 *
 * The prices are never divided out. A holding's implied price is the exact
 * rational `value_usd / amount`, so "did the price move" is
 * `Vb × Aa ≠ Va × Ab` and "did it move by n/d" is `Va × Ab × d = Vb × Aa × n` —
 * cross-multiplied, with no floor anywhere to launder a discrepancy.
 *
 * THE LAWS, over every engine's itemization and every mover it publishes:
 *
 *   1. CHANGED ⇒ DISCLOSED. A price implied changed between the two sides must
 *      carry an `applied_shocks` entry. This is the law the invented account
 *      broke: it moved 70/100 and disclosed nothing.
 *   2. ABSENT ⇒ UNCHANGED. An asset with no `applied_shocks` entry must be
 *      bit-identical across the sides. Held flat is a claim, and the aggregates
 *      have to keep it.
 *   3. DISCLOSED ⇒ MOVED. An `applied_shocks` entry whose asset did not move is
 *      a shock with nothing behind it. This is the law the grafted aave row
 *      broke: the disclosure named a 70/100 move on an aggregate that never
 *      changed.
 *   4. THE FACTOR IS THE MATRIX'S. A disclosed factor must equal the factor
 *      `composedFactor` derives for that (chain, asset) from the committed
 *      propagation matrix, AND the itemization must have moved by exactly it.
 *      A shock on an asset the matrix does not name is refused outright.
 *   5. DECLARED ⇒ SHOCKED. An asset the matrix DOES name cannot sit still while
 *      the scenario shocks the axis it responds to. This is the other half of
 *      the same impossibility, and it is what forces the aave engine to be
 *      re-measured rather than carried over.
 *   6. HELD FLAT IS TRUE. Every `held_flat` entry names a price input NO
 *      propagation row described (`api/openapi.yaml`'s own words for the field),
 *      and its asset is unchanged wherever the body carries it.
 *   7. THE MOVERS AGREE. A mover's own numbers imply a factor too — the aave
 *      wads and the Debt Manager's maxBorrowLT rationals both scale with the
 *      collateral that moved — and it must be a factor the body disclosed. A
 *      mover row is also placed in a bucket its side actually populated.
 */
const checkPropagation = (name, response) => {
  // THE MATRIX IS THE RESPONSE'S OWN. A body is measured against the scenario it
  // says it answers, read from the committed registry by that id — never against
  // whichever matrix this generator happens to have open.
  const { rows: propagation, composedFactor } = matrixFor(committedScenario(response.scenario_id));
  const chains = new Map(
    response.batch.watermarks.map((watermark) => [watermark.engine, watermark.chain_id]),
  );

  const applied = new Map();
  for (const entry of response.applied_shocks) {
    const key = responseKey(entry.chain_id, entry.asset);
    if (applied.has(key)) {
      fail(`${name} discloses TWO applied shocks for ${key}`);
    }
    applied.set(key, entry);
    // LAW 4, first half: the matrix has to name it, and the factor has to be
    // the one the matrix composes for it.
    const row = propagation.get(key);
    if (row === undefined) {
      fail(
        `${name} applies a shock to ${key}, which the committed eth_minus_30 propagation matrix ` +
          `does not name — ApplyScenario would have HELD IT FLAT`,
      );
    }
    const [num, den] = composedFactor(row);
    if (BigInt(entry.factor_num) * den !== BigInt(entry.factor_den) * num) {
      fail(
        `${name} discloses factor ${entry.factor_num}/${entry.factor_den} for ${key} but the ` +
          `matrix composes ${String(num)}/${String(den)} from the scenario's own shocks[]`,
      );
    }
    // The disclosed price pair has to move by the disclosed factor too.
    if (BigInt(entry.after) * BigInt(entry.factor_den) !== BigInt(entry.before) * BigInt(entry.factor_num)) {
      fail(
        `${name} discloses ${entry.before} -> ${entry.after} for ${key}, which is not ` +
          `${entry.factor_num}/${entry.factor_den}`,
      );
    }
  }

  const heldFlat = new Map();
  for (const entry of response.held_flat) {
    const key = responseKey(entry.chain_id, entry.asset);
    if (heldFlat.has(key)) {
      fail(`${name} discloses TWO held-flat entries for ${key}`);
    }
    if (applied.has(key)) {
      fail(`${name} names ${key} as BOTH shocked and held flat`);
    }
    heldFlat.set(key, entry);
    // LAW 6. `held_flat` is not "did not move" — it is "no propagation row
    // described it". Naming a declared asset there is a false disclosure.
    if (propagation.has(key)) {
      fail(
        `${name} holds ${key} flat, but the committed matrix DOES describe it — ` +
          `held_flat names only inputs no propagation row covers`,
      );
    }
  }

  /** Every applied shock needs an aggregate that witnesses it (law 3). */
  const witnessed = new Set();

  for (const engine of response.engines) {
    const label = `${name} ${engine.engine}`;
    const chain = chains.get(engine.engine);
    if (chain === undefined) {
      fail(`${label} has no batch watermark, so its chain — and its propagation keys — are unknown`);
    }

    const disclosure = (entry) =>
      entry.value_usd !== null ? "counted" : entry.unpriced ? "unpriced" : "not-counted";
    const afterByKey = new Map(
      engine.after.collateral_by_asset.map((entry) => [`${entry.asset}::${disclosure(entry)}`, entry]),
    );

    for (const before of engine.before.collateral_by_asset) {
      const after = afterByKey.get(`${before.asset}::${disclosure(before)}`);
      // An entry present on one side only is a holding that appeared or left,
      // not a price move; `checkSide` already bounds what each side may claim.
      if (after === undefined || before.value_usd === null || after.value_usd === null) {
        continue;
      }
      const key = responseKey(chain, before.asset);
      const [Vb, Ab] = [BigInt(before.value_usd), BigInt(before.amount)];
      const [Va, Aa] = [BigInt(after.value_usd), BigInt(after.amount)];
      const moved = Vb * Aa !== Va * Ab;
      const shock = applied.get(key);

      if (shock === undefined) {
        // LAWS 1 and 2 — the same law read from both ends.
        if (moved) {
          fail(
            `${label} moves the price implied by ${before.asset} ` +
              `(${before.value_usd}/${before.amount} -> ${after.value_usd}/${after.amount}) ` +
              `with NO applied_shocks entry for ${key}`,
          );
        }
        // LAW 5. The matrix names it, the scenario shocks the axis it responds
        // to, and the aggregate did not move: production could not serve this.
        if (propagation.has(key)) {
          const [num, den] = composedFactor(propagation.get(key));
          if (num !== den) {
            fail(
              `${label} holds ${before.asset} FLAT, but the committed matrix declares it on chain ` +
                `${String(chain)} at ${String(num)}/${String(den)} — a declared asset cannot sit still`,
            );
          }
        }
        continue;
      }

      // LAW 3.
      if (!moved) {
        fail(
          `${label} discloses an applied shock for ${before.asset} but its implied price is ` +
            `UNCHANGED across the two sides (${before.value_usd}/${before.amount})`,
        );
      }
      // LAW 4, second half: the itemization moved by exactly the disclosed factor.
      if (Va * Ab * BigInt(shock.factor_den) !== Vb * Aa * BigInt(shock.factor_num)) {
        fail(
          `${label} moves ${before.asset} from ${before.value_usd}/${before.amount} to ` +
            `${after.value_usd}/${after.amount}, which is not the disclosed ` +
            `${shock.factor_num}/${shock.factor_den}`,
        );
      }
      witnessed.add(key);
    }

    // LAW 7. A mover's own numbers scale with the collateral that moved, so the
    // factor they imply has to be one this body disclosed for this engine.
    const factorsHere = response.applied_shocks
      .filter((entry) => entry.chain_id === chain)
      .map((entry) => [BigInt(entry.factor_num), BigInt(entry.factor_den)]);
    const disclosesFactor = (num, den) =>
      factorsHere.some(([fn, fd]) => num * fd === den * fn);

    for (const mover of engine.movers) {
      if (mover.hf_before_wad !== null && mover.hf_after_wad !== null) {
        const [wb, wa] = [BigInt(mover.hf_before_wad), BigInt(mover.hf_after_wad)];
        if (wb !== wa && !disclosesFactor(wa, wb)) {
          fail(
            `${label} mover ${mover.account} moves ${String(wb)} -> ${String(wa)} in wad, a factor ` +
              `no applied_shocks entry on chain ${String(chain)} discloses`,
          );
        }
        for (const [side, wad] of [["before", wb], ["after", wa]]) {
          const histogram = engine[side].hf_histogram;
          const bucket = bucketLabelForRational(histogram, wad, BigInt(histogram.wad_scale));
          if (histogram.buckets.find((entry) => entry.label === bucket).count === 0) {
            fail(`${label} mover ${mover.account} sits in an EMPTY ${side}-bucket ${bucket}`);
          }
        }
      }
      if (
        mover.hf_before_num !== null &&
        mover.hf_before_den !== null &&
        mover.hf_after_num !== null &&
        mover.hf_after_den !== null
      ) {
        // maxBorrowLT / borrowings. The debt leg is USD-normalized and no
        // scenario re-prices it, so the whole move is the collateral's.
        const [nb, db] = [BigInt(mover.hf_before_num), BigInt(mover.hf_before_den)];
        const [na, da] = [BigInt(mover.hf_after_num), BigInt(mover.hf_after_den)];
        if (nb * da !== na * db && !disclosesFactor(na * db, nb * da)) {
          fail(
            `${label} mover ${mover.account} moves ${String(nb)}/${String(db)} -> ` +
              `${String(na)}/${String(da)}, a factor no applied_shocks entry on chain ` +
              `${String(chain)} discloses`,
          );
        }
      }
    }
  }

  // LAW 3, book-wide: a disclosed shock with no aggregate behind it anywhere.
  for (const [key] of applied) {
    if (!witnessed.has(key)) {
      fail(
        `${name} discloses an applied shock for ${key} that NO engine's itemization moved by — ` +
          `the disclosure describes a book this response does not serve`,
      );
    }
  }
};

const checkResponse = (name, response) => {
  checkPropagation(name, response);
  for (const side of ["before", "after"]) {
    const accounts = response.engines.reduce((sum, engine) => sum + engine[side].accounts, 0);
    if (accounts !== response.coverage.in_book) {
      fail(
        `${name} ${side}-side accounts across engines ${String(accounts)} ` +
          `!= coverage.in_book ${String(response.coverage.in_book)}`,
      );
    }
  }
  // Every position the batch carries is in the run, refused in the batch, or
  // excluded by this layer. (This scenario covers BOTH engines, so no position
  // is absent for want of coverage.)
  const accountedFor =
    response.coverage.in_book +
    response.coverage.refused_in_batch +
    response.coverage.excluded_by_this_layer;
  if (accountedFor !== response.coverage.batch_positions) {
    fail(
      `${name} coverage accounts for ${String(accountedFor)} positions ` +
        `but batch_positions is ${String(response.coverage.batch_positions)}`,
    );
  }
  if (response.batch.position_count !== response.coverage.batch_positions) {
    fail(
      `${name} batch.position_count ${String(response.batch.position_count)} ` +
        `!= coverage.batch_positions ${String(response.coverage.batch_positions)}`,
    );
  }
  if (response.batch.refused_count !== response.coverage.refused_in_batch) {
    fail(
      `${name} batch.refused_count ${String(response.batch.refused_count)} ` +
        `!= coverage.refused_in_batch ${String(response.coverage.refused_in_batch)}`,
    );
  }
  for (const engine of response.engines) {
    const label = `${name} ${engine.engine}`;
    checkSide(`${label} before`, engine.before);
    checkSide(`${label} after`, engine.after);
    // THE DELTAS ARE AFTER MINUS BEFORE. The matrix cell renders
    // `eligible_debt_delta_usd` as the run's own answer, so a delta that did
    // not come from the two sides beside it is a number with no witness.
    const deltas = [
      ["newly_eligible_accounts", engine.newly_eligible_accounts,
        engine.after.eligible_accounts - engine.before.eligible_accounts],
      ["eligible_debt_delta_usd", BigInt(engine.eligible_debt_delta_usd),
        BigInt(engine.after.eligible_debt_usd) - BigInt(engine.before.eligible_debt_usd)],
      ["bad_debt_delta_usd", BigInt(engine.bad_debt_delta_usd),
        BigInt(engine.after.bad_debt_usd) - BigInt(engine.before.bad_debt_usd)],
    ];
    for (const [field, stated, derived] of deltas) {
      if (stated !== derived) {
        fail(`${label} ${field} states ${String(stated)} but after-minus-before is ${String(derived)}`);
      }
    }
    // The disclosure sentence derives "top S of T" from these two; a slice
    // longer than the total it is a window onto is not a window.
    if (engine.movers.length > engine.movers_total) {
      fail(
        `${label} serves ${String(engine.movers.length)} movers ` +
          `under a movers_total of ${String(engine.movers_total)}`,
      );
    }
    // A DEBT MANAGER MOVER AND THE HISTOGRAM MUST TELL ONE STORY: the rational
    // the row publishes has to land where the flip says it landed.
    for (const mover of engine.movers) {
      if (mover.became_eligible !== true) {
        continue;
      }
      const before = bucketLabelForRational(
        engine.before.hf_histogram, BigInt(mover.hf_before_num), BigInt(mover.hf_before_den),
      );
      const after = bucketLabelForRational(
        engine.after.hf_histogram, BigInt(mover.hf_after_num), BigInt(mover.hf_after_den),
      );
      if (engine.before.hf_histogram.buckets.find((b) => b.label === before).count === 0) {
        fail(`${label} mover ${mover.account} sits in an EMPTY before-bucket ${before}`);
      }
      if (engine.after.hf_histogram.buckets.find((b) => b.label === after).count === 0) {
        fail(`${label} mover ${mover.account} sits in an EMPTY after-bucket ${after}`);
      }
    }
  }
};

/** The example's own COUNTED sentence, reused rather than paraphrased. */
const countedNote = runBookExample.engines
  .flatMap((engine) => engine.before.collateral_by_asset)
  .find((entry) => entry.value_usd !== null)?.note;
if (countedNote === undefined) {
  console.error("generate-lab-book.mjs: the run-book example carries no counted collateral entry");
  process.exit(1);
}

/**
 * The invented account's holding, valued at its own price on one side. The
 * symbol is the propagation row's own, so the entry names the asset the matrix
 * names rather than serving an address with no identity.
 */
const flipCollateralEntry = (valueUSD) => ({
  asset: DM_FLIP_ASSET,
  symbol: DM_FLIP_SYMBOL,
  decimals: DM_FLIP_ASSET_DECIMALS,
  amount: DM_FLIP_AMOUNT.toString(),
  value_usd: valueUSD.toString(),
  unpriced: false,
  note: countedNote,
});

/**
 * The server's own ordering: by `asset.Hex()`, then by disclosure — the exact
 * comparator at `cmd/api/p5_runbook.go:332-337`, whose stated purpose is that
 * "two runs over the same batch serve byte-identical arrays".
 *
 * APPLYING IT REORDERS THE CONTRACT EXAMPLE'S OWN AAVE ENTRIES, and that is
 * recorded rather than quietly done. The example lists weETH (0xCd5f…) before
 * the unpriced 0x0000…0BAD; production sorts by address, and "0x0000…" sorts
 * before "0xCd5f…", so the live server emits them the other way round. The
 * example's order is one this endpoint cannot produce. Once the aave rows are
 * re-measured they are re-serialized the way the endpoint serializes them, in
 * the same breath and for the same reason — a fixture may only claim what the
 * production evaluator could serve, and that includes the order it serves in.
 */
const byAsset = (entries) =>
  [...entries].sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));

// --- THE AAVE ENGINE, RE-MEASURED FROM THE SAME COMMITTED eth_minus_30 RUN --
//
// The example's aave rows were measured under `weeth_market_depeg_oracles_held`
// — `shocks: []`, `propagation: []` — so its two sides are bit-identical BY
// CONSTRUCTION. Re-identifying that envelope to eth_minus_30 and leaving those
// rows alone produced a body no evaluator could serve: the account holds weETH
// on mainnet, eth_minus_30's matrix DECLARES weETH-on-mainnet against `eth_usd`
// (internal/risk/scenarios/eth_minus_30.json, fifth propagation row), and a
// declared asset cannot hold still. The old file went further and grafted that
// shock into `applied_shocks` while the aggregate it names never moved — a
// disclosure with nothing behind it.
//
// The fix is not to delete the claim. It is to serve the measurement the
// contract already commits for exactly this account under exactly this
// scenario: `stress-aave.json`'s own eth_minus_30 result. That row is
// contract-validated, it was measured AT THE SAME BATCH as the run-book example
// (asserted below), and its before side carries THE SAME MONEY as the example's
// aave aggregate — one account, $8,000 of collateral, $6,000 of debt, healthy.
// It is the same book, and it already knows what eth_minus_30 does to it.
//
// Everything the aave engine publishes is derived from that result plus ONE
// committed parameter pair, and nothing is typed in:
//
//   both sides' money, eligibility, HF wads and HF rationals
//                     `stress-aave.json` → scenarios[eth_minus_30].results[0]
//   the price move + the held-flat debt leg
//                     the SAME result's own `applied_shocks` / `held_flat`
//   liq_threshold + liq_bonus
//                     `api/openapi.yaml`'s OWN /v1/params 200 example, for the
//                     same (engine, chain_id, asset) triple
//
// The threshold is not taken on trust: the result publishes its health factor
// as an EXACT rational, and that rational is Σ(collateral × liq_threshold) over
// (debt × 10000). Reproducing both sides' published num/den from the contract's
// committed 8100 is an algebraic proof that the params example and the stress
// excerpt describe ONE reserve — which is what licenses reading the bonus from
// the same row.

const AAVE_ENGINE = "aave_v3_etherfi";
const AAVE_CHAIN = engineChain.get(AAVE_ENGINE);
if (AAVE_CHAIN === undefined) {
  fail(`the run-book example's batch names no ${AAVE_ENGINE} watermark, so its chain is unknown`);
}

const aaveResults = ethDefinition.results.filter((result) => result.engine === AAVE_ENGINE);
if (aaveResults.length !== 1) {
  fail(
    `stress-aave.json's eth_minus_30 carries ${String(aaveResults.length)} ${AAVE_ENGINE} results; ` +
      `the aave engine is re-measured from exactly one`,
  );
}
const aaveResult = aaveResults[0];
if (aaveResult.applicable !== true) {
  fail("the committed eth_minus_30 aave result is not applicable, so it measures nothing");
}

// SAME BATCH. Two measurements of one book at two batches are two books.
for (const field of ["id", "computed_at", "position_count"]) {
  if (JSON.stringify(stressAave.batch[field]) !== JSON.stringify(runBookExample.batch[field])) {
    fail(
      `the stress excerpt's batch.${field} is ${JSON.stringify(stressAave.batch[field])} but the ` +
        `run-book example's is ${JSON.stringify(runBookExample.batch[field])} — different runs`,
    );
  }
}

const aaveExample = runBookExample.engines.find((engine) => engine.engine === AAVE_ENGINE);
if (aaveExample === undefined) {
  fail(`the run-book example carries no ${AAVE_ENGINE} engine`);
}

// SAME BOOK. One account, and the before side's money agrees to the digit.
if (aaveExample.before.accounts !== 1) {
  fail(
    `the example's aave side measures ${String(aaveExample.before.accounts)} accounts; the ` +
      `committed result describes ONE, so the re-measurement would not cover the book`,
  );
}
if (
  BigInt(aaveExample.before.total_collateral_usd) !== BigInt(aaveResult.before.collateral_usd) ||
  BigInt(aaveExample.before.total_debt_usd) !== BigInt(aaveResult.before.debt_usd) ||
  aaveExample.before.eligible_accounts !== (aaveResult.before.eligible === true ? 1 : 0)
) {
  fail(
    "the example's aave before side and the committed eth_minus_30 result describe different " +
      "books, so the result may not re-measure it",
  );
}

/** The committed Aave reserve parameters, from the contract's OWN /v1/params example. */
const paramsExample =
  contract.paths["/v1/params"].get.responses["200"].content["application/json"].example;
const aaveReserveParams = paramsExample.params.find(
  (row) =>
    row.engine === AAVE_ENGINE &&
    row.chain_id === AAVE_CHAIN &&
    typeof row.asset === "string" &&
    row.asset.toLowerCase() ===
      aaveResult.applied_shocks.find((shock) => shock.chain_id === AAVE_CHAIN)?.asset.toLowerCase(),
);
if (aaveReserveParams === undefined) {
  fail("the contract's /v1/params example carries no row for the shocked aave reserve");
}
const paramField = (name) => {
  const field = aaveReserveParams.fields.find((entry) => entry.name === name);
  if (field === undefined || field.value === null) {
    fail(`the committed aave reserve params carry no ${name}`);
  }
  if (field.unit !== "bps") {
    fail(`the committed aave ${name} is in ${String(field.unit)}, not bps`);
  }
  return BigInt(field.value);
};
const AAVE_LT_BPS = paramField("liq_threshold");
const AAVE_BONUS_BPS = paramField("liq_bonus");
const BPS = 10_000n;

// THE ALGEBRAIC WELD. `health_factor_num` is Σ(collateral × liq_threshold) and
// `health_factor_den` is debt × 10000, so the contract's committed threshold has
// to reproduce BOTH published rationals exactly. If it does not, the params
// example and the stress excerpt are describing different reserves and nothing
// below may borrow the bonus from the params row.
for (const side of ["before", "after"]) {
  const measured = aaveResult[side];
  const num = BigInt(measured.collateral_usd) * AAVE_LT_BPS;
  const den = BigInt(measured.debt_usd) * BPS;
  if (num !== BigInt(measured.health_factor_num) || den !== BigInt(measured.health_factor_den)) {
    fail(
      `the committed liq_threshold ${String(AAVE_LT_BPS)} does not reproduce the aave result's ` +
        `${side} rational: derived ${String(num)}/${String(den)} but the result publishes ` +
        `${measured.health_factor_num}/${measured.health_factor_den}`,
    );
  }
}

/** The waterfall's own two measures over ONE eligible account (waterfall.go:96-103). */
const atRiskFor = (collateral, debt) => {
  const seizable = (debt * AAVE_BONUS_BPS) / BPS;
  return seizable < collateral ? seizable : collateral;
};
const badDebtFor = (collateral, debt) => {
  const recoverable = (collateral * BPS) / AAVE_BONUS_BPS;
  return debt > recoverable ? debt - recoverable : 0n;
};

/** Shock one side's itemization by each asset's OWN matrix factor. */
const shockedCollateral = (entries, chainId) =>
  entries.map((entry) => {
    // An UNPRICED holding has no price witness at all, so there is nothing for a
    // scenario to move: `ApplyScenario` only ever walks `PriceInput`s.
    if (entry.value_usd === null) {
      return entry;
    }
    const row = propagation.get(responseKey(chainId, entry.asset));
    if (row === undefined) {
      return entry; // undeclared — HELD FLAT, which is production's own default
    }
    const [num, den] = composedFactor(row);
    return { ...entry, value_usd: ((BigInt(entry.value_usd) * num) / den).toString() };
  });

/** A ONE-ACCOUNT histogram, rebuilt so the census sits where the rational lands. */
const histogramForOneRational = (histogram, num, den) => {
  if (census(histogram) !== 1 || histogram.infinite_count !== 0) {
    fail("the example's aave histogram does not census exactly one finite account");
  }
  const label = bucketLabelForRational(histogram, num, den);
  return {
    ...histogram,
    buckets: histogram.buckets.map((bucket) => ({
      ...bucket,
      count: bucket.label === label ? 1 : 0,
    })),
  };
};

/** One measured side of the aave engine, entirely derived from the committed result. */
const aaveSide = (sideName) => {
  const measured = aaveResult[sideName];
  const eligible = measured.eligible === true;
  const collateral = BigInt(measured.collateral_usd);
  const debt = BigInt(measured.debt_usd);
  const entries =
    sideName === "before"
      ? aaveExample.before.collateral_by_asset
      : shockedCollateral(aaveExample.after.collateral_by_asset, AAVE_CHAIN);
  const counted = entries
    .filter((entry) => entry.value_usd !== null)
    .reduce((sum, entry) => sum + BigInt(entry.value_usd), 0n);
  if (counted !== collateral) {
    fail(
      `the aave ${sideName} itemization sums to ${String(counted)} but the committed result ` +
        `measures ${String(collateral)} of collateral`,
    );
  }
  return {
    ...aaveExample[sideName],
    accounts: 1,
    eligible_accounts: eligible ? 1 : 0,
    total_collateral_usd: collateral.toString(),
    total_debt_usd: debt.toString(),
    eligible_debt_usd: (eligible ? debt : 0n).toString(),
    collateral_at_risk_usd: (eligible ? atRiskFor(collateral, debt) : 0n).toString(),
    bad_debt_usd: (eligible ? badDebtFor(collateral, debt) : 0n).toString(),
    collateral_by_asset: byAsset(entries),
    hf_histogram: histogramForOneRational(
      aaveExample[sideName].hf_histogram,
      BigInt(measured.health_factor_num),
      BigInt(measured.health_factor_den),
    ),
  };
};

/**
 * The engine `note` and `movers_note` the SERVING LAYER would write for this
 * scenario, reproduced from its own templates rather than carried over.
 *
 * The example's aave notes say "oracle marks held ... the shortfall axis is
 * where this scenario's information lives" — a sentence `p5_runbook.go:614`
 * writes ONLY when a market-realization axis exists. eth_minus_30 has none, this
 * file already sets `market_realization: null`, and a note pointing at an axis
 * the body says is absent is one more thing the response cannot mean.
 */
const engineNote = (usdDecimals) =>
  "delta-only: after minus before over the positions in the run, in this engine's own " +
  `${String(usdDecimals)}-decimal unit.`;

/** p5_runbook.go:842-856, the aave rule plus its truncation sentence. */
const aaveMoversNote = (total) =>
  "RANKED BY HEALTH-FACTOR DROP: before minus after, in the pool's own WAD, largest drop first. " +
  "Only accounts whose health factor STRICTLY DROPPED are movers. An account with no debt has an " +
  "unbounded health factor on either side, so it has no drop to rank and is not counted here — it " +
  `is not a quiet zero. \`movers\` carries all ${String(total)} of them.`;

const aaveBefore = aaveSide("before");
const aaveAfter = aaveSide("after");

// THE MOVER IS ASSERTED FROM THE WADS, not assumed. Aave ranks by STRICT drop,
// so a side that did not fall is not a mover and this fixture would be claiming
// one that the engine's own rule excludes.
const AAVE_HF_BEFORE = BigInt(aaveResult.before.health_factor_wad);
const AAVE_HF_AFTER = BigInt(aaveResult.after.health_factor_wad);
if (AAVE_HF_AFTER >= AAVE_HF_BEFORE) {
  fail(
    `the committed aave result's health factor did not strictly drop ` +
      `(${String(AAVE_HF_BEFORE)} -> ${String(AAVE_HF_AFTER)}), so it ranks no mover`,
  );
}

const ethAaveEngine = {
  ...aaveExample,
  before: aaveBefore,
  after: aaveAfter,
  newly_eligible_accounts: aaveAfter.eligible_accounts - aaveBefore.eligible_accounts,
  eligible_debt_delta_usd: (
    BigInt(aaveAfter.eligible_debt_usd) - BigInt(aaveBefore.eligible_debt_usd)
  ).toString(),
  bad_debt_delta_usd: (
    BigInt(aaveAfter.bad_debt_usd) - BigInt(aaveBefore.bad_debt_usd)
  ).toString(),
  // Aave speaks WADS and nothing else: the rational columns and the Debt
  // Manager's eligibility flip are NULL here, never a stand-in zero
  // (p5_runbook.go:115-138, 777-792).
  movers: [
    {
      account: aaveResult.account,
      engine: AAVE_ENGINE,
      hf_before_wad: AAVE_HF_BEFORE.toString(),
      hf_after_wad: AAVE_HF_AFTER.toString(),
      hf_drop_wad: (AAVE_HF_BEFORE - AAVE_HF_AFTER).toString(),
      hf_before_num: null,
      hf_before_den: null,
      hf_after_num: null,
      hf_after_den: null,
      became_eligible: null,
      debt_usd: null,
    },
  ],
  movers_total: 1,
  movers_note: aaveMoversNote(1),
  market_realization: null,
  note: engineNote(8),
};

// --- THE DISCLOSURES: THIS BODY'S OWN PRICE INPUTS, NOT ANOTHER BOOK'S ------
//
// `applied_shocks` and `held_flat` are the DEDUPED UNION over the positions that
// reached the run, sorted by the server's own key (p5_runbook.go:460-484,
// 537-542). They are not free text and they are not transferable: every entry
// has to be a price THIS response's own aggregates moved (or held).
//
// The old file built `applied_shocks` by flattening `stress-aave.json`'s
// per-address results straight onto the body. That is a different book's
// disclosure, and it showed: the one entry it carried named an aave price whose
// aggregate never budged, while the Debt Manager's own moved price appeared
// nowhere and `held_flat` was empty on a response where a whole holding was
// being held flat.
//
// Each entry below is welded to the row that witnesses it:
//
//   aave weETH   APPLIED — verbatim from the committed result whose aggregates
//                this response now serves.
//   aave USDC    HELD FLAT — verbatim from the same result. The debt leg's
//                price: the matrix does not name USDC, so it does not move.
//   DM WETH      APPLIED — the invented account's holding, at the price the
//                itemization values it at on each side.
//   DM weETH     HELD FLAT — the example's own entry. `responseKey(10, 0xCd5f…)`
//                is not in the matrix, so production holds it, and the example's
//                bytes hold it. The disclosure finally says so.

/** The DM price source key, named verbatim by the contract (api/openapi.yaml:910). */
const DM_PRICE_SOURCE = "priceproviderv2";

/** The DM's own price for a holding: value × 10^decimals / amount, exact here. */
const dmPriceOf = (entry) =>
  (BigInt(entry.value_usd) * 10n ** BigInt(entry.decimals)) / BigInt(entry.amount);

const dmExample = runBookExample.engines.find((engine) => engine.engine === "debt_manager");
const dmHeldEntries = dmExample.before.collateral_by_asset.filter(
  (entry) => entry.value_usd !== null && !propagation.has(responseKey(DM_CHAIN, entry.asset)),
);

const APPLIED_SHOCKS = [
  ...aaveResult.applied_shocks,
  {
    asset: DM_FLIP_ASSET,
    chain_id: DM_CHAIN,
    source: DM_PRICE_SOURCE,
    factor_num: FACTOR_NUM.toString(),
    factor_den: FACTOR_DEN.toString(),
    before: DM_FLIP_PRICE_BEFORE.toString(),
    after: DM_FLIP_PRICE_AFTER.toString(),
    snapped: false,
    base_snapped: false,
    cap_bound: false,
  },
].sort((a, b) =>
  `${a.asset}|${String(a.chain_id)}|${a.source}`.localeCompare(
    `${b.asset}|${String(b.chain_id)}|${b.source}`,
  ),
);

const HELD_FLAT = [
  ...aaveResult.held_flat,
  ...dmHeldEntries.map((entry) => ({
    asset: entry.asset,
    chain_id: DM_CHAIN,
    source: DM_PRICE_SOURCE,
    value: dmPriceOf(entry).toString(),
  })),
].sort((a, b) =>
  `${a.asset}|${String(a.chain_id)}|${a.source}`.localeCompare(
    `${b.asset}|${String(b.chain_id)}|${b.source}`,
  ),
);

const ethRunBook = {
  ...runBookExample,
  scenario_id: ethDefinition.id,
  scenario_version: ethDefinition.version,
  label: ethDefinition.label,
  description: ethDefinition.description,
  path_assumption: ethDefinition.path_assumption,
  shocks: ethDefinition.shocks,
  out_of_model: ethDefinition.out_of_model,
  applied_shocks: APPLIED_SHOCKS,
  held_flat: HELD_FLAT,
  // The invented account is a REAL ROW of the batch, so the batch counts it.
  batch: {
    ...runBookExample.batch,
    position_count: runBookExample.batch.position_count + 1,
  },
  coverage: {
    ...runBookExample.coverage,
    batch_positions: runBookExample.coverage.batch_positions + 1,
    in_book: runBookExample.coverage.in_book + 1,
  },
  engines: runBookExample.engines.map((engine) => {
    if (engine.engine === AAVE_ENGINE) {
      return ethAaveEngine;
    }
    if (engine.engine !== "debt_manager") {
      fail(`the run-book example carries an engine this generator does not derive: ${engine.engine}`);
    }
    // The second account must EXIST on both sides before it can flip on one,
    // and it brings its own debt and its own collateral with it.
    const before = {
      ...engine.before,
      accounts: engine.before.accounts + 1,
      total_debt_usd: (BigInt(engine.before.total_debt_usd) + DM_DELTA).toString(),
      total_collateral_usd: (
        BigInt(engine.before.total_collateral_usd) + DM_FLIP_VALUE_BEFORE
      ).toString(),
      collateral_by_asset: byAsset([
        ...engine.before.collateral_by_asset,
        flipCollateralEntry(DM_FLIP_VALUE_BEFORE),
      ]),
      hf_histogram: withBucket(
        engine.before.hf_histogram,
        bucketLabelForRational(engine.before.hf_histogram, DM_FLIP_MAXBORROW_BEFORE, DM_DELTA),
        1,
      ),
    };
    const after = {
      ...engine.after,
      accounts: engine.after.accounts + 1,
      eligible_accounts: engine.after.eligible_accounts + 1,
      eligible_debt_usd: (BigInt(engine.after.eligible_debt_usd) + DM_DELTA).toString(),
      total_debt_usd: (BigInt(engine.after.total_debt_usd) + DM_DELTA).toString(),
      total_collateral_usd: (
        BigInt(engine.after.total_collateral_usd) + DM_FLIP_VALUE_AFTER
      ).toString(),
      collateral_at_risk_usd: (
        BigInt(engine.after.collateral_at_risk_usd) + DM_FLIP_AT_RISK_AFTER
      ).toString(),
      bad_debt_usd: (BigInt(engine.after.bad_debt_usd) + DM_FLIP_BAD_DEBT_AFTER).toString(),
      collateral_by_asset: byAsset([
        ...engine.after.collateral_by_asset,
        flipCollateralEntry(DM_FLIP_VALUE_AFTER),
      ]),
      // The flip IS the account crossing the 1.00 edge — the same event
      // `newly_eligible_accounts` counts, drawn where a reader can see it.
      hf_histogram: withBucket(
        engine.after.hf_histogram,
        bucketLabelForRational(engine.after.hf_histogram, DM_FLIP_MAXBORROW_AFTER, DM_DELTA),
        1,
      ),
    };
    return {
      ...engine,
      before,
      after,
      market_realization: null,
      // Recomputed FROM before/after, never stated independently.
      newly_eligible_accounts: after.eligible_accounts - before.eligible_accounts,
      eligible_debt_delta_usd: (
        BigInt(after.eligible_debt_usd) - BigInt(before.eligible_debt_usd)
      ).toString(),
      bad_debt_delta_usd: (
        BigInt(after.bad_debt_usd) - BigInt(before.bad_debt_usd)
      ).toString(),
      // The one account that flipped, with the EXACT rational on each side —
      // the same two rationals the histogram placement above is derived from —
      // and the debt that became eligible equal to the delta that created it.
      movers: [
        {
          account: DM_FLIP_ACCOUNT,
          engine: engine.engine,
          hf_before_wad: null,
          hf_after_wad: null,
          hf_drop_wad: null,
          hf_before_num: DM_FLIP_MAXBORROW_BEFORE.toString(),
          hf_before_den: DM_DELTA.toString(),
          hf_after_num: DM_FLIP_MAXBORROW_AFTER.toString(),
          hf_after_den: DM_DELTA.toString(),
          became_eligible: true,
          debt_usd: DM_DELTA.toString(),
        },
      ],
      movers_total: 1,
      movers_note:
        "RANKED BY THE DEBT THAT BECAME ELIGIBLE: only accounts whose Debt Manager eligibility " +
        "FLIPPED false -> true under this scenario are movers, ranked by their debt in this " +
        "engine's 6-decimal USD, largest first. The Debt Manager has no health-factor wad, so " +
        "`hf_before_num/den` and `hf_after_num/den` are the EXACT rational maxBorrowLT/borrowings, " +
        "a disclosure only. `movers_total` counts flips to eligible ONLY, so it is not " +
        "`newly_eligible_accounts`, which is a NET count and also subtracts any flip back to " +
        "healthy. `movers` carries all 1 of them.",
      note: engineNote(6),
    };
  }),
};

// THE WHOLE BODY, checked — both engines, both sides, the response-level census
// and every engine's deltas. Checking only the side that was edited is how the
// impossible book got written in the first place.
checkResponse("run-book.eth_minus_30", ethRunBook);

// --- THE GUARD'S OWN SENSITIVITY: it has to fail on the bodies it exists for -
//
// A guard that cannot fail is not a guard. Both mutants below are built from the
// body just written, so they cannot drift away from what the guard actually
// sees, and BOTH must be refused:
//
//   A  THE W-BS-B SHAPE. The invented account's holding put back on an address
//      the propagation matrix does not name, with the old grafted disclosure.
//      That is the finding, reproduced exactly.
//   B  AN UNDECLARED SHOCK. The example's own held-flat weETH moved by the
//      scenario's factor and disclosed as if the matrix covered it.
const refuses = (what, mutate) => {
  const mutant = JSON.parse(JSON.stringify(ethRunBook));
  mutate(mutant);
  const realFail = console.error;
  let refused = null;
  console.error = (message) => {
    refused ??= message;
  };
  const realExit = process.exit;
  process.exit = () => {
    throw new Error("__guard_refused__");
  };
  try {
    checkResponse("mutant", mutant);
  } catch (error) {
    if (error.message !== "__guard_refused__") {
      throw error;
    }
  } finally {
    console.error = realFail;
    process.exit = realExit;
  }
  if (refused === null) {
    fail(`THE GUARD IS BLIND: it accepted ${what}`);
  }
  console.log(`refused ${what}\n        ${refused.replace(/^generate-lab-book\.mjs: /, "")}`);
};

refuses("A: the W-BS-B shape — an undeclared asset shocked, the aave graft restored", (mutant) => {
  const invented = "0x00000000000000000000000000000000000d0003";
  for (const engine of mutant.engines) {
    for (const side of ["before", "after"]) {
      for (const entry of engine[side].collateral_by_asset) {
        if (entry.asset === DM_FLIP_ASSET) {
          entry.asset = invented;
          delete entry.symbol;
        }
      }
    }
  }
  mutant.applied_shocks = aaveResult.applied_shocks;
  mutant.held_flat = [];
});

refuses("B: an undeclared shock — the example's held-flat weETH moved and disclosed", (mutant) => {
  const held = mutant.held_flat.find((entry) => entry.chain_id === DM_CHAIN);
  for (const engine of mutant.engines) {
    if (engine.engine !== "debt_manager") {
      continue;
    }
    for (const entry of engine.after.collateral_by_asset) {
      if (entry.asset.toLowerCase() === held.asset.toLowerCase()) {
        entry.value_usd = ((BigInt(entry.value_usd) * FACTOR_NUM) / FACTOR_DEN).toString();
      }
    }
  }
  mutant.held_flat = mutant.held_flat.filter((entry) => entry !== held);
  mutant.applied_shocks = [
    ...mutant.applied_shocks,
    {
      asset: held.asset,
      chain_id: held.chain_id,
      source: held.source,
      factor_num: FACTOR_NUM.toString(),
      factor_den: FACTOR_DEN.toString(),
      before: held.value,
      after: ((BigInt(held.value) * FACTOR_NUM) / FACTOR_DEN).toString(),
      snapped: false,
      base_snapped: false,
      cap_bound: false,
    },
  ];
});

write("run-book.eth_minus_30.json", ethRunBook);
write("run-book.eth_minus_30.batch2.json", {
  ...ethRunBook,
  batch: { ...ethRunBook.batch, id: ethRunBook.batch.id + 1, computed_at: "2026-07-29T10:00:30Z" },
});
write("run-book.weeth.batch2.json", {
  ...runBookExample,
  batch: {
    ...runBookExample.batch,
    id: runBookExample.batch.id + 1,
    computed_at: "2026-07-29T10:00:30Z",
  },
});

// --- 4: the withheld-engine run -------------------------------------------

const refusal = read("book-engine-refused.json").refused_engines.find(
  (entry) => entry.engine === "aave_v3_etherfi",
);
if (refusal === undefined) {
  console.error("generate-lab-book.mjs: book-engine-refused.json carries no aave refusal");
  process.exit(1);
}

write("run-book.weeth-withheld.json", {
  ...runBookExample,
  engines: runBookExample.engines.filter((engine) => engine.engine !== refusal.engine),
  excluded_engines: [refusal],
  coverage: {
    ...runBookExample.coverage,
    withheld_engines: [refusal],
    stress_coverage_is_full: false,
  },
});

// --- 5: the 200 that names NOBODY (Wave R11) -------------------------------
//
// Both arrays emptied, everything else byte-identical to the example. A book
// that names none of a row's covered engines leaves every one of that row's
// cells UNANSWERED, so the row displays no result — while the envelope it
// arrived in still carries a batch and a full-coverage claim.

const namesNobody = {
  ...runBookExample,
  engines: [],
  excluded_engines: [],
};

write("run-book.names-nobody.json", namesNobody);
write("run-book.names-nobody.batch2.json", {
  ...namesNobody,
  batch: { ...namesNobody.batch, id: namesNobody.batch.id + 1, computed_at: "2026-07-29T10:00:30Z" },
});

// --- 6: the 200 that CONTRADICTS ITSELF (Wave R12, finding 1) --------------
//
// File (4) with `engines[]` restored to the example's full array while
// `excluded_engines[]` keeps the refusal (4) put there. aave_v3_etherfi is
// therefore named in BOTH — served and withheld at once, from one response.
// The old cell precedence read `engines[]` first and rendered its number; the
// detail view rendered the refusal. Same body, two answers, one cell.

write("run-book.contradictory.json", {
  ...runBookExample,
  engines: runBookExample.engines,
  excluded_engines: [refusal],
  coverage: {
    ...runBookExample.coverage,
    withheld_engines: [refusal],
    stress_coverage_is_full: false,
  },
});

// --- 7: the 200 that names ONE engine TWICE (Wave R12, finding 1) ----------
//
// The example with its aave engine object appended a second time, byte
// identical. Two results for one cell and nothing saying which; `find()`
// silently answers with whichever the array happens to carry first.

const aaveEngine = runBookExample.engines.find((engine) => engine.engine === "aave_v3_etherfi");
if (aaveEngine === undefined) {
  console.error("generate-lab-book.mjs: the run-book example carries no aave engine");
  process.exit(1);
}

write("run-book.named-twice.json", {
  ...runBookExample,
  engines: [...runBookExample.engines, aaveEngine],
});

// --- 8: THE VERSION-SKEW PAIR (Wave R12, finding 2) ------------------------
//
// Two INDIVIDUALLY VALID responses from two deployments of the same service.
// The defect is neither of them; it is the join between them being bound to a
// scenario id alone, so a v2 book gets read against a v1 listing's coverage.

const SKEWED_ID = "ethfi_minus_50";
const V2 = "v2";

const v2Scenarios = committedListing.scenarios.map((definition) =>
  definition.id === SKEWED_ID
    ? { ...definition, version: V2, engines: ["aave_v3_etherfi"] }
    : definition,
);
const v2Definition = v2Scenarios.find((definition) => definition.id === SKEWED_ID);
if (v2Definition === undefined) {
  console.error(`generate-lab-book.mjs: the committed listing carries no ${SKEWED_ID}`);
  process.exit(1);
}

write("scenarios.v2.json", {
  ...committedListing,
  scenario_config_version: V2,
  scenarios: v2Scenarios,
});

write("run-book.ethfi_minus_50.v2.json", {
  ...runBookExample,
  scenario_config_version: V2,
  scenario_id: v2Definition.id,
  scenario_version: v2Definition.version,
  label: v2Definition.label,
  description: v2Definition.description,
  path_assumption: v2Definition.path_assumption,
  shocks: v2Definition.shocks,
  out_of_model: v2Definition.out_of_model,
  // The v2 definition covers aave alone, so the v2 run answers for aave alone.
  engines: runBookExample.engines.filter((engine) => engine.engine === "aave_v3_etherfi"),
});

// --- 9: THE DELISTED ROW (Wave R13, finding 1) -----------------------------
//
// The committed listing with ONE definition dropped, in place, and the set's
// own token LEFT WHERE IT WAS. Not a malformed listing: a deployment that
// stopped publishing a scenario. Everything that survives is byte-identical to
// (1), so the only difference between the two files is the row that is gone —
// which is exactly the difference the finding is about.

const DELISTED_ID = "weeth_market_depeg_oracles_held";

const delistedListing = {
  ...committedListing,
  scenarios: committedListing.scenarios.filter((definition) => definition.id !== DELISTED_ID),
};
if (delistedListing.scenarios.length !== committedListing.scenarios.length - 1) {
  console.error(`generate-lab-book.mjs: the committed listing carries no ${DELISTED_ID}`);
  process.exit(1);
}

write("scenarios.removed.json", delistedListing);

// --- 10: THE RE-LISTED ROW (Wave R14, finding 1) ---------------------------
//
// The dropped definition, republished RE-CUT: back in its original wire
// position with its own `version` moved to v2, and the set's token held at v1 so
// every other row is untouched. A phase stored while the row read v1 is
// re-admitted here by scenario id alone — and a phase with no served body has
// nothing but the identity it was DISPATCHED under to say otherwise.

const relistedDefinition = committedListing.scenarios.find(
  (definition) => definition.id === DELISTED_ID,
);
if (relistedDefinition === undefined) {
  console.error(`generate-lab-book.mjs: the committed listing carries no ${DELISTED_ID}`);
  process.exit(1);
}

write("scenarios.relisted.json", {
  ...committedListing,
  scenarios: committedListing.scenarios.map((definition) =>
    definition.id === DELISTED_ID ? { ...definition, version: V2 } : definition,
  ),
});

// What the republishing deployment answers for that id: the example with its
// `scenario_version` moved to match, and nothing else. The set token did not
// move, so `scenario_config_version` does not either.
write("run-book.weeth.v2.json", {
  ...runBookExample,
  scenario_version: V2,
});

// --- 11: THE PARTIAL HOLE (Wave R14, finding 2) ----------------------------
//
// (4) without its refusal: aave dropped from `engines[]` and NOT named in
// `excluded_engines[]`. One of the row's two covered engines reached the run;
// the other is in neither array, so its cell reads UNANSWERED while
// `excluded_engines.length === 0` — the exact condition the detail panel's
// "every engine's book reached the run" line used to be gated on.

write("run-book.partial-hole.json", {
  ...runBookExample,
  engines: runBookExample.engines.filter((engine) => engine.engine !== refusal.engine),
});

// --- 12: THE COLLIDING COLLATERAL ROWS (Wave W-BS-B, finding 4) ------------
//
// The run-book example with ONE entry ADDED to the aave engine's
// `collateral_by_asset`, on both sides: the SAME weETH asset it already counts,
// carried a second time under the NOT-COUNTED disclosure. Nothing else moves —
// a not-counted holding is outside `total_collateral_usd` by construction, so
// the counted entries still sum to it exactly.
//
// This is not a hypothetical shape. `cmd/api/p5_runbook.go` keys the
// itemization by asset AND disclosure (`runCollateralKey`), and the LIVE book
// already serves weETH twice for an Aave aggregate: COUNTED for the accounts
// that enabled it as collateral and NOT COUNTED for the accounts that did not.
// The contract's own `unpriced` description says the same thing in the other
// direction ("An entry may appear twice for one asset").
//
// It is the fixture the OLD React key could not tell apart. COUNTED and
// NOT-COUNTED share `unpriced: false`, so `asset + unpriced` gave both rows one
// key, and a rerun then reconciled two rows that claimed one identity. The
// `.swap` file is the second serve of that rerun: the same two colliding rows
// with DIFFERENT balances and a different counted value, so a row that survived
// stale, doubled or dropped shows up as a wrong number on the page rather than
// as a silent identity error.
//
// The NOT-COUNTED note is `runCollateralNotCounted`'s own sentence from
// cmd/api/p5_runbook.go, verbatim — the wire's words, not a paraphrase.

const NOT_COUNTED_NOTE =
  "NOT COUNTED AS COLLATERAL: the engine counts none of this holding toward collateral " +
  "(Aave `usedAsCollateral = false`), so the reviewed arithmetic assigned it no value and none " +
  "is invented here. `amount` is exact; none of this holding is inside `total_collateral_usd`.";

/**
 * The example's aave engine with its counted weETH entry restated at
 * `countedAmount`/`countedValue` and shadowed by a NOT-COUNTED row for the SAME
 * asset at `notCountedAmount`. `total_collateral_usd` follows the counted value,
 * because the counted entries sum to it EXACTLY and that law does not bend.
 */
const withCollidingCollateral = (countedAmount, countedValue, notCountedAmount) => {
  const side = (aggregate) => {
    const counted = aggregate.collateral_by_asset.find((entry) => entry.value_usd !== null);
    if (counted === undefined) {
      console.error("generate-lab-book.mjs: the aave side carries no counted collateral entry");
      process.exit(1);
    }
    const rest = aggregate.collateral_by_asset.filter((entry) => entry !== counted);
    return {
      ...aggregate,
      total_collateral_usd: countedValue,
      collateral_by_asset: [
        { ...counted, amount: countedAmount, value_usd: countedValue },
        // Same asset, same `unpriced: false`, a DIFFERENT disclosure — the
        // pair the row key must keep apart.
        {
          ...counted,
          amount: notCountedAmount,
          value_usd: null,
          unpriced: false,
          note: NOT_COUNTED_NOTE,
        },
        ...rest,
      ],
    };
  };
  return {
    ...runBookExample,
    engines: runBookExample.engines.map((engine) =>
      engine.engine === "aave_v3_etherfi"
        ? { ...engine, before: side(engine.before), after: side(engine.after) }
        : engine,
    ),
  };
};

const collision = withCollidingCollateral(
  "2000000000000000000",
  "800000000000",
  "5000000000000000000",
);
const collisionSwap = withCollidingCollateral(
  "3000000000000000000",
  "1200000000000",
  "7000000000000000000",
);

checkResponse("run-book.collateral-collision", collision);
checkResponse("run-book.collateral-collision.swap", collisionSwap);

write("run-book.collateral-collision.json", collision);
write("run-book.collateral-collision.swap.json", collisionSwap);
