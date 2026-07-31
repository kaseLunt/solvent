// Proof-Center / Developers (W6) fixture + contract-extract generation, and
// THE PROVENANCE RECORD. Regenerate:
//
//   node tests/fixtures/generate-proof.mjs        (from web/)
//
// Sibling waves each own their generator (this one writes ONLY evidence-*
// fixtures and `lib/proof-contract.gen.ts`). Every emitted byte derives from
// committed contract artifacts — never hand-shaped wire data (plan, fixture
// rule). The sanctioned sources:
//
//  1. VERBATIM extract of `api/openapi.yaml`'s own inline example:
//       GET /v1/evidence 200 example   -> evidence-manifest.json
//
//  2. THREE DERIVED negatives, each a documented, CONSISTENT delta on that
//     example (the honest-state fixtures the surface must render loudly):
//       evidence-proof-failed.json — the receipt records a FAILED reconcile:
//         result "fail", exit_code 1, gated 84/87 exact with drift 3, and the
//         debt_manager weld inexact by exactly those same 3 rows (26/29) so the
//         drift is REAL in the data, not just asserted. aave weld untouched.
//       evidence-no-receipt.json  — reconcile null; the reason is the
//         EvidenceResponse schema's own description of that state, verbatim
//         ("no committed receipt artifact is present in this deployment").
//       evidence-no-batch.json    — substrate null; the reason is the
//         contract-validated NoBatch body's message, byte-identical from
//         `packages/client-ts/test/fixtures/errors/unavailable.json`.
//
//  3. `lib/proof-contract.gen.ts` — the Developers page's static render of
//     the committed contract: every operation of `api/openapi.yaml` (order
//     preserved), its summary/description/params/response-codes VERBATIM,
//     plus the 200 example for each JSON route:
//       - the yaml's own inline example where one exists;
//       - otherwise the contract-VALIDATED client fixture, byte-identical
//         (that package's fixtures.test.ts validates each body against the
//         schema: additionalProperties, Decimal patterns, required, enums).
//     Error-envelope samples come from the same two sources. The per-entry
//     `source` field cites which. tests/unit/proof-contract-fidelity.spec.ts
//     re-extracts from the yaml and fails on any drift.
//
// SANITIZATION (the build check): every emitted byte is scanned for URI
// schemes (`x://`), credentialed DSN fragments (`user:pass@host`) and
// secret-looking assignments. A hit hard-fails this script — committed
// artifacts name endpoints by ENVIRONMENT VARIABLE only, and this generator
// refuses to publish anything that doesn't.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (installed by `scripts/ensure-client.mjs`) — no new web dependency.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(webRoot, "..");
const clientFixtures = path.join(repoRoot, "packages", "client-ts", "test", "fixtures");
const contractPath = path.join(repoRoot, "api", "openapi.yaml");

const die = (message) => {
  console.error(`generate-proof.mjs: ${message}`);
  process.exit(1);
};

// --- sanitization: nothing publishable may carry an endpoint URL or DSN ----

// Kept in sync with lib/proof-data.ts (the render-time copy of this law).
// The DSN pattern requires a DOTTED host after the `@`: committed reconcile
// artifacts legitimately carry cohort labels like `preflight:eth@25584990`
// (label@block-number) — a block number is not a host.
const LEAK_PATTERNS = [
  /[a-z][a-z0-9+.-]*:\/\/\S+/gi, // any URI scheme: https://, postgres://, wss://…
  /\b[\w-]+:[^@\s:/]+@[\w-]+\.[\w.-]+/g, // credentialed fragment: user:pass@host.tld
  /\b(?:api[_-]?key|secret|password|token)\s*[=:]\s*\S+/gi, // secret-looking assignment
];

const findLeaks = (text) => {
  const hits = [];
  for (const pattern of LEAK_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) hits.push(match[0]);
  }
  return hits;
};

const emitted = [];
const emit = (relPath, text) => {
  const leaks = findLeaks(text);
  if (leaks.length > 0) {
    die(`refusing to emit ${relPath}: endpoint/DSN-shaped content: ${leaks.join(", ")}`);
  }
  writeFileSync(path.join(webRoot, relPath), text, "utf8");
  emitted.push(relPath);
  console.log(`wrote   ${relPath}`);
};

const emitJson = (name, value) =>
  emit(path.join("tests", "fixtures", name), `${JSON.stringify(value, null, 2)}\n`);

// --- parse the contract ----------------------------------------------------

let YAML;
try {
  const requireFromClient = createRequire(
    path.join(repoRoot, "packages", "client-ts", "package.json"),
  );
  YAML = requireFromClient("yaml");
} catch {
  die(
    "cannot resolve `yaml` from packages/client-ts/node_modules.\n" +
      "Run `node scripts/ensure-client.mjs` (or any web build) first.",
  );
}

const contract = YAML.parse(readFileSync(contractPath, "utf8"));
const readClientFixture = (name) =>
  JSON.parse(readFileSync(path.join(clientFixtures, name), "utf8"));

// --- 1 + 2: the evidence fixtures ------------------------------------------

const evidenceExample =
  contract?.paths?.["/v1/evidence"]?.get?.responses?.["200"]?.content?.["application/json"]
    ?.example;
if (evidenceExample === undefined) die("api/openapi.yaml carries no 200 example for GET /v1/evidence");
emitJson("evidence-manifest.json", evidenceExample);

// evidence-proof-failed.json — the documented consistent delta.
{
  const failed = structuredClone(evidenceExample);
  const rec = failed.reconcile;
  if (rec?.result !== "pass" || rec.exit_code !== 0 || rec.gated_rows !== 87 || rec.gated_exact !== 87 || rec.gated_drift !== 0) {
    die("the contract's evidence example no longer carries the 87/87 pass receipt this delta is derived from — re-derive the failed fixture");
  }
  const dmWeld = rec.welds.find((weld) => weld.engine === "debt_manager");
  if (dmWeld === undefined || dmWeld.rows_compared !== 29 || dmWeld.rows_exact !== 29) {
    die("the evidence example lost its 29/29 debt_manager weld — re-derive the failed fixture");
  }
  rec.result = "fail";
  rec.exit_code = 1; // the receipt schema's own vocabulary: 1 = verdict fail
  rec.gated_exact = 84;
  rec.gated_drift = 3;
  dmWeld.rows_exact = 26; // the SAME 3 rows: the drift is real in the data
  if (rec.gated_exact + rec.gated_drift !== rec.gated_rows) die("derived receipt is internally inconsistent");
  if (dmWeld.rows_compared - dmWeld.rows_exact !== rec.gated_drift) die("derived weld delta does not carry the drift");
  // The 1.2.0 wire status stays CONSISTENT with the doctored receipt (the
  // server derives it from the same conjunction, so a fixture where the two
  // disagreed would be the contradiction case, not the failed-receipt case).
  failed.proof_subject = {
    status: "rejected",
    detail: `receipt verdict "fail" (exit 1)`,
    pin: rec.comparison_sha256,
  };
  emitJson("evidence-proof-failed.json", failed);
}

// evidence-no-receipt.json — reconcile null, reason from the schema's own prose.
{
  const noReceipt = structuredClone(evidenceExample);
  noReceipt.reconcile = null;
  noReceipt.reconcile_unavailable_reason =
    "no committed receipt artifact is present in this deployment";
  noReceipt.proof_subject = {
    status: "unavailable",
    detail: noReceipt.reconcile_unavailable_reason,
    pin: null, // no receipt, no pin — never fabricated
  };
  emitJson("evidence-no-receipt.json", noReceipt);
}

// evidence-no-batch.json — substrate null, reason from the contract-validated
// NoBatch body (byte-identical message).
{
  const unavailable = readClientFixture(path.join("errors", "unavailable.json"));
  const message = unavailable?.error?.message;
  if (typeof message !== "string") die("errors/unavailable.json lost its message");
  const noBatch = structuredClone(evidenceExample);
  noBatch.substrate = null;
  noBatch.substrate_unavailable_reason = message;
  noBatch.live_subject = { status: "no_batch", reason: message };
  emitJson("evidence-no-batch.json", noBatch);
}

// --- 3: the contract extract for the Developers page -----------------------

const resolveParam = (param) => {
  if (param.$ref !== undefined) {
    const name = param.$ref.split("/").pop();
    const resolved = contract?.components?.parameters?.[name];
    if (resolved === undefined) die(`unresolvable parameter $ref: ${param.$ref}`);
    return resolved;
  }
  return param;
};

const responseEntry = (code, response) => {
  if (response.$ref !== undefined) {
    const name = response.$ref.split("/").pop();
    const resolved = contract?.components?.responses?.[name];
    if (resolved === undefined) die(`unresolvable response $ref: ${response.$ref}`);
    return { code, ref: name, description: String(resolved.description ?? "").trim() };
  }
  return { code, ref: null, description: String(response.description ?? "").trim() };
};

// The contract-validated client fixture standing in as the 200 body for the
// routes whose yaml carries no inline example.
const CLIENT_FIXTURE_FOR = {
  getBook: "book.json",
  getAddress: "address-aave.json",
  getAddressStress: "stress-aave.json",
  getObservatory: "observatory.json",
  getMeta: "meta.json",
};

// The concrete request each curl sample makes, derived from the example body
// itself (never a hand-typed address/id).
const samplePathFor = (operationId, wirePath, example) => {
  switch (operationId) {
    case "getPositions":
      return `/v1/positions?engine=${example.engine}`;
    case "getObservatorySeries":
      return `/v1/observatory/series?engine=${example.engine}`;
    case "getAddress":
      return `/v1/address/${example.address}`;
    case "getAddressStress":
      return `/v1/address/${example.address}/stress`;
    case "getAddressHistory":
      return `/v1/address/${example.address}/history`;
    case "getPriceHistory":
      return `/v1/prices/${example.asset}`;
    case "runBookScenario":
      return `/v1/scenarios/${example.scenario_id}/run-book`;
    case "getBatch":
      return `/v1/batches/${example.batch_id}`;
    default:
      return wirePath;
  }
};

const operations = [];
for (const [wirePath, methods] of Object.entries(contract.paths)) {
  for (const method of ["get", "post"]) {
    const op = methods[method];
    if (op === undefined) continue;
    const isSse =
      op.responses?.["200"]?.content?.["text/event-stream"] !== undefined;
    const inlineExample =
      op.responses?.["200"]?.content?.["application/json"]?.example;
    let example = null;
    let exampleSource = null;
    if (inlineExample !== undefined) {
      example = inlineExample;
      exampleSource = `api/openapi.yaml — ${method.toUpperCase()} ${wirePath} 200 example (verbatim)`;
    } else if (CLIENT_FIXTURE_FOR[op.operationId] !== undefined) {
      example = readClientFixture(CLIENT_FIXTURE_FOR[op.operationId]);
      exampleSource = `packages/client-ts/test/fixtures/${CLIENT_FIXTURE_FOR[op.operationId]} (contract-validated 200 body, byte-identical)`;
    } else if (!isSse) {
      die(`${method.toUpperCase()} ${wirePath} has neither an inline example nor a sanctioned fixture`);
    }
    operations.push({
      method: method.toUpperCase(),
      path: wirePath,
      operationId: op.operationId,
      tag: op.tags?.[0] ?? "untagged",
      summary: String(op.summary ?? "").trim(),
      description: String(op.description ?? "").trim(),
      parameters: (op.parameters ?? []).map(resolveParam).map((param) => ({
        name: param.name,
        in: param.in,
        required: param.required === true,
        description: String(param.description ?? "").trim(),
      })),
      responses: Object.entries(op.responses).map(([code, response]) =>
        responseEntry(code, response),
      ),
      samplePath: example === null ? wirePath : samplePathFor(op.operationId, wirePath, example),
      sse: isSse,
      example,
      exampleSource,
    });
  }
}
if (operations.length === 0) die("no operations extracted");

// Error-envelope samples: the yaml's own BatchSuperseded example + the
// contract-validated error fixtures for the rest.
const ERROR_SOURCES = [
  ["BadRequest", 400, path.join("errors", "bad-request.json")],
  ["NotFound", 404, path.join("errors", "not-found.json")],
  ["BatchSuperseded", 409, null],
  ["RateLimited", 429, path.join("errors", "rate-limited.json")],
  ["InternalError", 500, path.join("errors", "internal.json")],
  ["NoBatch", 503, path.join("errors", "unavailable.json")],
];
const errorResponses = ERROR_SOURCES.map(([name, status, fixture]) => {
  const component = contract?.components?.responses?.[name];
  if (component === undefined) die(`components.responses.${name} missing`);
  let body;
  let source;
  if (fixture === null) {
    body = component?.content?.["application/json"]?.example;
    if (body === undefined) die(`components.responses.${name} carries no example`);
    source = `api/openapi.yaml — components.responses.${name} example (verbatim)`;
  } else {
    body = readClientFixture(fixture);
    source = `packages/client-ts/test/fixtures/${fixture.replace(/\\/g, "/")} (contract-validated)`;
  }
  return {
    name,
    status,
    description: String(component.description ?? "").trim(),
    body,
    source,
  };
});

const genModule = `// GENERATED by tests/fixtures/generate-proof.mjs — DO NOT EDIT BY HAND.
//
// The Developers surface's static render of the committed contract
// (api/openapi.yaml, title "${contract.info.title}" v${contract.info.version}).
// Summaries, descriptions, parameters and response codes are the yaml's own
// text VERBATIM; each 200 sample is the yaml's inline example or the
// contract-validated client fixture — every entry's \`source\` field says
// which. tests/unit/proof-contract-fidelity.spec.ts re-extracts from the yaml
// and FAILS on any drift between this module and the contract.

export interface ContractParam {
  name: string;
  in: string;
  required: boolean;
  description: string;
}

export interface ContractResponse {
  code: string;
  ref: string | null;
  description: string;
}

export interface ContractOperation {
  method: string;
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  parameters: ContractParam[];
  responses: ContractResponse[];
  /** The concrete request the curl sample makes (values from the sample body itself). */
  samplePath: string;
  /** text/event-stream — no JSON sample exists or is invented. */
  sse: boolean;
  /** The 200 body sample, or null for SSE. */
  example: unknown;
  /** Where the sample comes from. Committed provenance, rendered on the page. */
  exampleSource: string | null;
}

export interface ContractErrorResponse {
  name: string;
  status: number;
  description: string;
  body: unknown;
  source: string;
}

export const CONTRACT_META = ${JSON.stringify(
  {
    title: contract.info.title,
    version: contract.info.version,
    sourcePath: "api/openapi.yaml",
  },
  null,
  2,
)} as const;

export const OPERATIONS: readonly ContractOperation[] = ${JSON.stringify(operations, null, 2)};

export const ERROR_RESPONSES: readonly ContractErrorResponse[] = ${JSON.stringify(
  errorResponses,
  null,
  2,
)};
`;

emit(path.join("lib", "proof-contract.gen.ts"), genModule);

console.log(`done. ${operations.length} operations extracted; ${emitted.length} files emitted.`);
