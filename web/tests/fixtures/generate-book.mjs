// Book-surface (W1) fixture generation + THE PROVENANCE RECORD. Regenerate:
//
//   node tests/fixtures/generate-book.mjs        (from web/)
//
// Sibling waves each own their generator (this one writes ONLY book-* and
// positions-* / batch-superseded files; `generate.mjs` belongs to the lab
// wave). Every fixture is GENERATED from committed contract artifacts — never
// hand-shaped wire data (plan, fixture rule). The sanctioned sources:
//
//  1. BYTE-IDENTICAL copies of `packages/client-ts/test/fixtures/*.json` —
//     the repo's contract-validated bodies (that package's `fixtures.test.ts`
//     validates each against `api/openapi.yaml`: additionalProperties,
//     Decimal patterns, required fields, enums):
//       book.json                      -> book.json
//       book-engine-refused.json       -> book-engine-refused.json
//       errors/unavailable.json        -> book-error-unavailable.json
//       errors/bad-request.json        -> book-error-bad-request.json
//
//  2. VERBATIM extracts of `api/openapi.yaml`'s own inline examples:
//       GET /v1/positions 200 example  -> positions-aave-page-1.json
//       BatchSuperseded 409 example    -> batch-superseded.json
//
//  3. COMPOSED pages — the /v1/positions example's envelope around
//     PositionSummary rows PROJECTED from the canonical Position rows of the
//     validated address fixtures (all sources pin batch id 1, so composed
//     pages stay batch-consistent). The projection (`summarize` below) is
//     the SAME field-selection the server documents for the 1.2.0 summary:
//     engine-mapped totals (aave: total_collateral_base/total_debt_base;
//     dm: collateral_value_usd/borrowings), the liq_distance fold over the
//     row's own solve flags and verdict, and the as_of block trio — nothing
//     invented, every value the canonical row's own:
//       positions-aave-page-2.json — the refused aave row
//         (address-aave-refused.json), next_cursor null.
//       positions-dm-page-1.json   — the liquidatable DM row
//         (address-dm.json) + the refused DM row (address-dm-refused.json),
//         engine/limit/total echoed, next_cursor null.
//
//  4. ONE DERIVED negative: book-monotonicity-violation.json — book.json with
//     a single documented, CONSISTENT delta: the DM debt-eligible series
//     falls between grid points 1 and 2, and `monotonicity` names exactly
//     that point. The violation is real in the data, not just asserted.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (installed by `scripts/ensure-client.mjs`) — no new web dependency.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const clientFixtures = path.join(repoRoot, "packages", "client-ts", "test", "fixtures");
const contractPath = path.join(repoRoot, "api", "openapi.yaml");

const readClientFixture = (name) =>
  JSON.parse(readFileSync(path.join(clientFixtures, name), "utf8"));
const emit = (name, value) => {
  writeFileSync(path.join(here, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`wrote   ${name}`);
};

// --- 1: byte-identical copies ----------------------------------------------

const COPIES = [
  ["book.json", "book.json"],
  ["book-engine-refused.json", "book-engine-refused.json"],
  [path.join("errors", "unavailable.json"), "book-error-unavailable.json"],
  [path.join("errors", "bad-request.json"), "book-error-bad-request.json"],
];
for (const [source, target] of COPIES) {
  copyFileSync(path.join(clientFixtures, source), path.join(here, target));
  console.log(`copied  ${source} -> ${target}`);
}

// --- 2: verbatim contract examples -----------------------------------------

let YAML;
try {
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  console.error(
    "generate-book.mjs: cannot resolve `yaml` from packages/client-ts/node_modules.\n" +
      "Run `node scripts/ensure-client.mjs` (or any web build) first.",
  );
  process.exit(1);
}

const contract = YAML.parse(readFileSync(contractPath, "utf8"));

const positionsExample =
  contract?.paths?.["/v1/positions"]?.get?.responses?.["200"]?.content?.["application/json"]
    ?.example;
if (positionsExample === undefined) {
  console.error("generate-book.mjs: api/openapi.yaml carries no 200 example for GET /v1/positions");
  process.exit(1);
}
emit("positions-aave-page-1.json", positionsExample);

const supersededExample =
  contract?.components?.responses?.BatchSuperseded?.content?.["application/json"]?.example;
if (supersededExample === undefined) {
  console.error("generate-book.mjs: api/openapi.yaml carries no BatchSuperseded example");
  process.exit(1);
}
emit("batch-superseded.json", supersededExample);

// --- 3: composed pages from canonical rows (projected to PositionSummary) --

const positionOf = (fixture) => {
  const rows = readClientFixture(fixture).positions;
  if (rows.length !== 1) {
    console.error(`generate-book.mjs: ${fixture} should carry exactly one position`);
    process.exit(1);
  }
  return rows[0];
};

const WAD = 10n ** 18n;

/**
 * The server's documented 1.2.0 projection, applied to a canonical FULL
 * Position row: field selection + the liq_distance fold. Every value is the
 * canonical row's own; nothing is invented.
 */
const summarize = (position) => {
  const isAave = position.engine === "aave_v3_etherfi";
  const hf = position.health_factor;
  const liquidatable =
    position.liquidatable === true ||
    (hf !== null && hf !== undefined && !hf.infinite && hf.wad !== null && hf.wad !== undefined &&
      BigInt(hf.wad) < WAD);
  const lp = position.liquidation_price ?? null;

  let liq_distance;
  if (lp === null) {
    liq_distance = {
      kind: "none",
      scale_factor_num: null,
      scale_factor_den: null,
      factor_asset: null,
      reason: position.refusal === null ? null : position.refusal.code,
    };
  } else if (lp.already_breached || liquidatable) {
    liq_distance = {
      kind: "breached",
      scale_factor_num: null,
      scale_factor_den: null,
      factor_asset: null,
      reason: null,
    };
  } else if (lp.never_liquidatable) {
    liq_distance = {
      kind: "never",
      scale_factor_num: null,
      scale_factor_den: null,
      factor_asset: null,
      reason: lp.reason ?? null,
    };
  } else if (!lp.in_factor || lp.scale_factor_num === null || lp.scale_factor_den === null) {
    liq_distance = {
      kind: "none",
      scale_factor_num: null,
      scale_factor_den: null,
      factor_asset: null,
      reason: lp.reason ?? null,
    };
  } else {
    const factorAsset = lp.factor_assets[0] ?? null;
    const leg = position.legs.find((candidate) => candidate.asset === factorAsset);
    liq_distance = {
      kind: "distance",
      scale_factor_num: lp.scale_factor_num,
      scale_factor_den: lp.scale_factor_den,
      factor_asset: factorAsset,
      ...(leg?.symbol === undefined ? {} : { factor_symbol: leg.symbol }),
      reason: null,
    };
  }

  return {
    engine: position.engine,
    account: position.account,
    status: position.status,
    value_decimals: position.value_decimals,
    refusal: position.refusal,
    flags: position.flags,
    health_factor: position.health_factor,
    liquidatable: position.liquidatable,
    total_collateral: isAave ? position.total_collateral_base : position.collateral_value_usd,
    total_debt: isAave ? position.total_debt_base : position.borrowings,
    liq_distance,
    balances_block: position.as_of.balances_block,
    params_block: position.as_of.params_block,
    sweep_block: position.as_of.sweep_block,
  };
};

const aaveRefused = summarize(positionOf("address-aave-refused.json"));
const dmComputed = summarize(positionOf("address-dm.json")); // liquidatable: true — the crit row
const dmRefused = summarize(positionOf("address-dm-refused.json"));

emit("positions-aave-page-2.json", {
  ...positionsExample,
  positions: [aaveRefused],
  next_cursor: null,
});

emit("positions-dm-page-1.json", {
  ...positionsExample,
  engine: "debt_manager",
  limit: 50,
  total_positions: 2,
  positions: [dmComputed, dmRefused],
  next_cursor: null,
});

// --- 4: the derived monotonicity violation ---------------------------------

const violation = structuredClone(readClientFixture("book.json"));
const wfPoints = violation.waterfall.points;
const dmAtOne = wfPoints[1].engines.find((engine) => engine.engine === "debt_manager");
const dmAtTwo = wfPoints[2].engines.find((engine) => engine.engine === "debt_manager");
if (dmAtOne === undefined || dmAtTwo === undefined) {
  console.error("generate-book.mjs: book.json waterfall lost debt_manager at points 1/2");
  process.exit(1);
}
const fallen = "4100000000"; // strictly below point 1's cumulative eligible debt
if (BigInt(fallen) >= BigInt(dmAtOne.cumulative_debt_eligible_usd)) {
  console.error("generate-book.mjs: the derived delta would not actually violate monotonicity");
  process.exit(1);
}
dmAtTwo.cumulative_debt_eligible_usd = fallen;
violation.waterfall.monotonicity = {
  ok: false,
  engine: "debt_manager",
  index: 2,
  factor: wfPoints[2].factor,
  detail: `cumulative_debt_eligible_usd fell from ${dmAtOne.cumulative_debt_eligible_usd} to ${fallen} between grid points 1 and 2`,
};
emit("book-monotonicity-violation.json", violation);

console.log("done.");
