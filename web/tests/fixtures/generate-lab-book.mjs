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
//     from that definition, and `applied_shocks` composed from the SAME
//     scenario's own validated per-address applied-shock rows.
//     `market_realization` is set to null on every engine because the contract
//     says it is "present when the scenario carries a market-realization axis"
//     and eth_minus_30 does not carry one.
//     ONE DOCUMENTED DERIVED DELTA, kept internally CONSISTENT so the delta is
//     real in the data and not merely asserted: an INVENTED WHOLE ACCOUNT is
//     added to the debt_manager book on BOTH sides, carrying its own debt and
//     its own collateral, healthy before the shock and eligible after it. Every
//     aggregate it touches moves with it — `accounts`, `total_debt_usd`,
//     `total_collateral_usd` and its itemization, `eligible_accounts`,
//     `eligible_debt_usd`, `collateral_at_risk_usd`, the histogram census — and
//     `coverage.in_book` / `batch.position_count` count it as the batch row it
//     is. `newly_eligible_accounts` / `eligible_debt_delta_usd` /
//     `bad_debt_delta_usd` are recomputed from before/after rather than stated
//     independently, and `checkResponse` refuses the write unless every
//     cross-field law the web renders holds over the WHOLE body. The derivation
//     and its arithmetic are written out at the derivation site below.
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
  console.error("generate-lab-book.mjs: stress-aave.json carries no eth_minus_30 definition");
  process.exit(1);
}

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
 * The collateral that account holds. It is an invented identity in the SAME
 * register as the account itself, and it is deliberately NOT the example's own
 * weETH entry: two holdings of ONE asset at ONE price move by ONE factor, so
 * folding the invented balance into that entry would make the entry claim a
 * price move the example's own held-flat bytes contradict. A separate asset
 * keeps every entry internally exact. No symbol is served for it, because the
 * registry holds none and the contract says one is never invented.
 */
const DM_FLIP_ASSET = "0x00000000000000000000000000000000000d0003";
const DM_FLIP_ASSET_DECIMALS = 18;
const DM_FLIP_AMOUNT = 2_500_000_000_000_000_000n; // 2.5 tokens at 18 decimals
const DM_FLIP_PRICE_BEFORE = 1_000_000_000n; // $1,000.000000 in the DM's 6-dec USD

// The Debt Manager's committed weETH configuration, the same pair the seeded
// API fixture welds against: threshold 80e18/100e18 and an ADDITIVE 1e18 bonus
// over HUNDRED_PERCENT = 100e18, i.e. +1%.
const DM_LT_NUM = 80n;
const DM_LT_DEN = 100n;
const DM_BONUS_NUM = 101n;
const DM_BONUS_DEN = 100n;

/** The scenario's OWN factor on its own axis — read, never typed in. */
const ethShock = ethDefinition.shocks.find((shock) => shock.axis === "eth_usd");
if (ethShock === undefined) {
  console.error("generate-lab-book.mjs: the eth_minus_30 definition carries no eth_usd shock");
  process.exit(1);
}
const FACTOR_NUM = BigInt(ethShock.factor_num);
const FACTOR_DEN = BigInt(ethShock.factor_den);

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

const fail = (message) => {
  console.error(`generate-lab-book.mjs: ${message}`);
  process.exit(1);
};

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
const checkResponse = (name, response) => {
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

/** The invented account's holding, valued at its own price on one side. */
const flipCollateralEntry = (valueUSD) => ({
  asset: DM_FLIP_ASSET,
  decimals: DM_FLIP_ASSET_DECIMALS,
  amount: DM_FLIP_AMOUNT.toString(),
  value_usd: valueUSD.toString(),
  unpriced: false,
  note: countedNote,
});

/** The server's own ordering: by asset, then by disclosure. */
const byAsset = (entries) =>
  [...entries].sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));

const ethRunBook = {
  ...runBookExample,
  scenario_id: ethDefinition.id,
  scenario_version: ethDefinition.version,
  label: ethDefinition.label,
  description: ethDefinition.description,
  path_assumption: ethDefinition.path_assumption,
  shocks: ethDefinition.shocks,
  out_of_model: ethDefinition.out_of_model,
  applied_shocks: ethDefinition.results.flatMap((result) => result.applied_shocks),
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
    if (engine.engine !== "debt_manager") {
      return { ...engine, market_realization: null };
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
      note: "delta-only: after minus before over the positions in the run.",
    };
  }),
};

// THE WHOLE BODY, checked — both engines, both sides, the response-level census
// and every engine's deltas. Checking only the side that was edited is how the
// impossible book got written in the first place.
checkResponse("run-book.eth_minus_30", ethRunBook);

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
