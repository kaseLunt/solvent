// The Developers surface's anti-drift gate: lib/proof-contract.gen.ts is a
// GENERATED extract of api/openapi.yaml, and this spec RE-EXTRACTS the
// load-bearing fields from the yaml on every run and fails on any
// disagreement. The samples on the page can therefore never drift from the
// contract without CI saying so — the fidelity law the page's provenance
// footer promises.
//
// YAML parsing uses the client package's own pinned `yaml` devDependency
// (the generator's trick, verbatim) — no new web dependency.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { CONTRACT_META, ERROR_RESPONSES, OPERATIONS } from "../../lib/proof-contract.gen";
import { findEndpointLeaks } from "../../lib/proof-data";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const clientFixtures = path.join(repoRoot, "packages", "client-ts", "test", "fixtures");

interface YamlParam {
  $ref?: string;
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
}

interface YamlResponse {
  $ref?: string;
  description?: string;
  content?: Record<string, { example?: unknown }>;
}

interface YamlOperation {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: YamlParam[];
  responses: Record<string, YamlResponse>;
}

interface YamlContract {
  info: { title: string; version: string };
  paths: Record<string, Record<string, YamlOperation>>;
  components: {
    parameters: Record<string, YamlParam>;
    responses: Record<string, YamlResponse>;
  };
}

const requireFromClient = createRequire(path.join(repoRoot, "packages", "client-ts", "package.json"));
const YAML = requireFromClient("yaml") as { parse: (text: string) => unknown };
const contract = YAML.parse(
  readFileSync(path.join(repoRoot, "api", "openapi.yaml"), "utf8"),
) as YamlContract;

const yamlOp = (method: string, wirePath: string): YamlOperation => {
  const op = contract.paths[wirePath]?.[method.toLowerCase()];
  if (op === undefined) throw new Error(`contract has no ${method} ${wirePath}`);
  return op;
};

const resolveParam = (param: YamlParam): YamlParam => {
  if (param.$ref === undefined) return param;
  const name = param.$ref.split("/").pop() ?? "";
  const resolved = contract.components.parameters[name];
  if (resolved === undefined) throw new Error(`unresolvable parameter $ref ${param.$ref}`);
  return resolved;
};

test("CONTRACT_META names the committed contract", () => {
  expect(CONTRACT_META.title).toBe(contract.info.title);
  expect(CONTRACT_META.version).toBe(contract.info.version);
  expect(CONTRACT_META.sourcePath).toBe("api/openapi.yaml");
});

test("every contract operation is extracted — none added, none dropped", () => {
  const yamlOps: string[] = [];
  for (const [wirePath, methods] of Object.entries(contract.paths)) {
    for (const method of ["get", "post"]) {
      if (methods[method] !== undefined) yamlOps.push(`${method.toUpperCase()} ${wirePath}`);
    }
  }
  expect(OPERATIONS.map((op) => `${op.method} ${op.path}`)).toEqual(yamlOps);
});

test("summaries, descriptions, params and response codes are the yaml's text verbatim", () => {
  for (const op of OPERATIONS) {
    const source = yamlOp(op.method, op.path);
    expect(op.operationId, `${op.method} ${op.path}`).toBe(source.operationId);
    expect(op.summary).toBe(String(source.summary ?? "").trim());
    expect(op.description).toBe(String(source.description ?? "").trim());

    const expectedParams = (source.parameters ?? []).map(resolveParam).map((param) => ({
      name: param.name,
      in: param.in,
      required: param.required === true,
      description: String(param.description ?? "").trim(),
    }));
    expect(op.parameters).toEqual(expectedParams);

    const expectedCodes = Object.keys(source.responses);
    expect(op.responses.map((response) => response.code)).toEqual(expectedCodes);
    for (const response of op.responses) {
      const sourceResponse = source.responses[response.code];
      if (sourceResponse?.$ref !== undefined) {
        const refName = sourceResponse.$ref.split("/").pop() ?? "";
        expect(response.ref).toBe(refName);
        expect(response.description).toBe(
          String(contract.components.responses[refName]?.description ?? "").trim(),
        );
      } else {
        expect(response.ref).toBeNull();
      }
    }
  }
});

test("every 200 sample is the contract's example or the contract-validated fixture, byte-faithful", () => {
  for (const op of OPERATIONS) {
    const source = yamlOp(op.method, op.path);
    const inline = source.responses["200"]?.content?.["application/json"]?.example;

    if (op.sse) {
      expect(op.example).toBeNull();
      continue;
    }
    expect(op.example, `${op.method} ${op.path} must carry a sample`).not.toBeNull();

    if (inline !== undefined) {
      expect(op.example, `${op.method} ${op.path}`).toEqual(inline);
      expect(op.exampleSource).toContain("api/openapi.yaml");
    } else {
      // The generator's cited client fixture, re-read from its committed bytes.
      const cited = /packages\/client-ts\/test\/fixtures\/([\w./-]+) /.exec(op.exampleSource ?? "");
      expect(cited, `${op.method} ${op.path} must cite its fixture`).not.toBeNull();
      const fixturePath = path.join(clientFixtures, cited?.[1] ?? "");
      expect(op.example).toEqual(JSON.parse(readFileSync(fixturePath, "utf8")));
    }
  }
});

test("the evidence sample, the page and the e2e fixtures agree — one extraction path", () => {
  const evidenceOp = OPERATIONS.find((op) => op.operationId === "getEvidence");
  expect(evidenceOp).toBeDefined();
  expect(evidenceOp?.example).toEqual(EVIDENCE_MANIFEST);
});

test("error-envelope samples are byte-faithful to their cited sources", () => {
  expect(ERROR_RESPONSES.map((error) => error.name)).toEqual([
    "BadRequest",
    "NotFound",
    "BatchSuperseded",
    "RateLimited",
    "InternalError",
    "NoBatch",
  ]);
  for (const error of ERROR_RESPONSES) {
    const component = contract.components.responses[error.name];
    expect(component, error.name).toBeDefined();
    expect(error.description).toBe(String(component?.description ?? "").trim());
    if (error.source.includes("api/openapi.yaml")) {
      expect(error.body).toEqual(component?.content?.["application/json"]?.example);
    } else {
      const cited = /packages\/client-ts\/test\/fixtures\/([\w./-]+) /.exec(error.source);
      expect(cited, `${error.name} must cite its fixture`).not.toBeNull();
      expect(error.body).toEqual(
        JSON.parse(readFileSync(path.join(clientFixtures, cited?.[1] ?? ""), "utf8")),
      );
    }
  }
});

test("the whole extract is publishable — no endpoint URL, no DSN (the build check, re-run in CI)", () => {
  const generated = readFileSync(
    path.join(repoRoot, "web", "lib", "proof-contract.gen.ts"),
    "utf8",
  );
  expect(findEndpointLeaks(generated)).toEqual([]);
});
