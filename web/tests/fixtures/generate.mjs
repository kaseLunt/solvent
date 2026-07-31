// Fixture generation + THE PROVENANCE RECORD. Regenerate with:
//
//   node tests/fixtures/generate.mjs        (from web/)
//
// Every fixture in this directory is GENERATED from committed contract
// artifacts — never hand-shaped (plan `docs/plans/2026-07-30-solvent-phase5-web.md`,
// fixture rule):
//
//  1. `stress-aave.json`, `stress-dm.json`, `stress-unknowable.json` —
//     BYTE-IDENTICAL copies of `packages/client-ts/test/fixtures/*.json`, the
//     repo's contract-validated stress bodies. That package's
//     `fixtures.test.ts` validates each against `api/openapi.yaml` itself
//     (additionalProperties, Decimal pattern, required fields, enums), and its
//     provenance record (`test/fixtures/index.ts`) documents which numbers are
//     mirrored from `cmd/api`'s Go suite. The aave body is a committed-set
//     EXCERPT (three scenarios) by that record's own declaration — so specs
//     assert scenario identity BY CONTENT and never assert the count of the
//     full committed set.
//
//  2. `run-book.weeth_market_depeg_oracles_held.json` — the 200 example of
//     `POST /v1/scenarios/{id}/run-book` extracted VERBATIM from
//     `api/openapi.yaml` (the C1 contract; the handler itself lands later
//     through its own review train). YAML parsing uses the client package's
//     own pinned `yaml` devDependency — installed by `scripts/ensure-client.mjs`
//     — so this adds no web dependency.
//
//  3. `error-not-found.json`, `error-unavailable.json`, `error-rate-limited.json`
//     — the contract's error envelopes, byte-identical copies from the same
//     validated fixture set.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const clientFixtures = path.join(repoRoot, "packages", "client-ts", "test", "fixtures");
const contractPath = path.join(repoRoot, "api", "openapi.yaml");

// --- 1 + 3: byte-identical copies of the contract-validated fixtures -------

const COPIES = [
  ["stress-aave.json", "stress-aave.json"],
  ["stress-dm.json", "stress-dm.json"],
  ["stress-unknowable.json", "stress-unknowable.json"],
  [path.join("errors", "not-found.json"), "error-not-found.json"],
  [path.join("errors", "unavailable.json"), "error-unavailable.json"],
  [path.join("errors", "rate-limited.json"), "error-rate-limited.json"],
];

for (const [source, target] of COPIES) {
  copyFileSync(path.join(clientFixtures, source), path.join(here, target));
  console.log(`copied  ${source} -> ${target}`);
}

// --- 2: the run-book example, extracted verbatim from the contract ---------

let YAML;
try {
  // Resolve `yaml` from the CLIENT package's node_modules (its pinned devDep).
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  console.error(
    "generate.mjs: cannot resolve the `yaml` package from packages/client-ts/node_modules.\n" +
      "Run `node scripts/ensure-client.mjs` (or any web build) first — it installs the\n" +
      "client package's dev dependencies.",
  );
  process.exit(1);
}

const contract = YAML.parse(readFileSync(contractPath, "utf8"));
const example =
  contract?.paths?.["/v1/scenarios/{id}/run-book"]?.post?.responses?.["200"]?.content?.[
    "application/json"
  ]?.example;
if (example === undefined) {
  console.error(
    "generate.mjs: api/openapi.yaml carries no 200 example for POST /v1/scenarios/{id}/run-book",
  );
  process.exit(1);
}

const target = path.join(here, `run-book.${example.scenario_id}.json`);
writeFileSync(target, `${JSON.stringify(example, null, 2)}\n`, "utf8");
console.log(`extracted run-book 200 example -> run-book.${example.scenario_id}.json`);
