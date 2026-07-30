// Test category (1), the runtime half: every fixture is CONTRACT-VALID against
// `api/openapi.yaml`, and the committed .json bytes match the type-checked
// literal in `data.ts`.
//
// The compile-time half lives in `conformance.test.ts` and in the `satisfies`
// clauses of `data.ts`; `npm run typecheck` is what runs it.

import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "../src/index.js";
import * as fixtures from "./fixtures/index.js";
import { CONTRACT_PATH, FIXTURE_FILES, fixtureJson, PINNED } from "./fixtures/index.js";
import { loadContract } from "./helpers/contract.js";

const contract = loadContract(CONTRACT_PATH);

/** Which contract schema each fixture must satisfy. */
const SCHEMAS: Record<keyof typeof FIXTURE_FILES, { path?: string; status?: number; component?: string }> = {
  book: { path: "/v1/book", status: 200 },
  bookEngineRefused: { path: "/v1/book", status: 200 },
  addressAave: { path: "/v1/address/{addr}", status: 200 },
  addressAaveRefused: { path: "/v1/address/{addr}", status: 200 },
  addressDM: { path: "/v1/address/{addr}", status: 200 },
  addressDMRefused: { path: "/v1/address/{addr}", status: 200 },
  addressNotFound: { path: "/v1/address/{addr}", status: 200 },
  addressUnknowable: { path: "/v1/address/{addr}", status: 200 },
  addressPartial: { path: "/v1/address/{addr}", status: 200 },
  stressAave: { path: "/v1/address/{addr}/stress", status: 200 },
  stressDM: { path: "/v1/address/{addr}/stress", status: 200 },
  stressUnknowable: { path: "/v1/address/{addr}/stress", status: 200 },
  observatory: { path: "/v1/observatory", status: 200 },
  meta: { path: "/v1/meta", status: 200 },
  metaNoBatch: { path: "/v1/meta", status: 200 },
  errorBadRequest: { path: "/v1/address/{addr}", status: 400 },
  errorNotFound: { component: "ErrorBody" },
  errorRateLimited: { path: "/v1/book", status: 429 },
  errorUnavailable: { path: "/v1/book", status: 503 },
  errorInternal: { path: "/v1/book", status: 500 },
  streamSnapshot: { component: "StreamPayload" },
  streamSnapshotRecovered: { component: "StreamPayload" },
  streamBatch: { component: "StreamPayload" },
  streamDegradation: { component: "StreamPayload" },
  streamUnavailable: { component: "StreamPayload" },
  streamUnavailableStale: { component: "StreamPayload" },
};

function schemaFor(name: keyof typeof FIXTURE_FILES) {
  const spec = SCHEMAS[name];
  if (spec.component !== undefined) return contract.component(spec.component);
  return contract.schemaFor(spec.path as string, spec.status as number);
}

describe("the contract this package was generated from", () => {
  it("is the version the client publishes", () => {
    expect(contract.version).toBe(CONTRACT_VERSION);
  });
});

describe("every fixture is contract-valid", () => {
  for (const name of Object.keys(FIXTURE_FILES) as (keyof typeof FIXTURE_FILES)[]) {
    it(`${name} (${FIXTURE_FILES[name]}) validates against api/openapi.yaml`, () => {
      const errors = contract.validate(schemaFor(name), fixtureJson(FIXTURE_FILES[name]));
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});

describe("the committed bytes and the type-checked literal are the same response", () => {
  for (const name of Object.keys(FIXTURE_FILES) as (keyof typeof FIXTURE_FILES)[]) {
    it(`${name}`, () => {
      // `data.ts` carries the `satisfies` check; the .json file is what the mock
      // server puts on the wire. If they ever drift, one of the two suites would
      // be testing something the other does not.
      expect(fixtureJson(FIXTURE_FILES[name])).toEqual(fixtures[name]);
    });
  }
});

// ---------------------------------------------------------------------------
// The validator must have teeth. Without these, every `validate` call above
// could be a no-op — the same hole `TestContractValidatorCanReject` closes on
// the Go side.
// ---------------------------------------------------------------------------

describe("the contract validator can reject", () => {
  const book = () => structuredClone(fixtures.book) as Record<string, unknown>;

  it("rejects a missing required field", () => {
    const mutant = book();
    delete (mutant["batch"] as Record<string, unknown>)["position_count"];
    expect(contract.validate(schemaFor("book"), mutant)).toContainEqual(
      expect.stringContaining("required property is absent"),
    );
  });

  it("rejects an unknown field — additionalProperties is false everywhere", () => {
    const mutant = book();
    mutant["surprise"] = true;
    expect(contract.validate(schemaFor("book"), mutant)).toContainEqual(
      expect.stringContaining("unknown property"),
    );
  });

  it("rejects MONEY AS A JSON NUMBER, which is the whole point of the string convention", () => {
    const mutant = book();
    const engines = mutant["engines"] as Record<string, unknown>[];
    (engines[0] as Record<string, unknown>)["total_collateral"] = 800000000000;
    expect(contract.validate(schemaFor("book"), mutant)).toContainEqual(
      expect.stringContaining("expected a string"),
    );
  });

  it("rejects a decimal string that is not an integer", () => {
    const mutant = book();
    const engines = mutant["engines"] as Record<string, unknown>[];
    (engines[0] as Record<string, unknown>)["total_collateral"] = "8000.00000000";
    expect(contract.validate(schemaFor("book"), mutant)).toContainEqual(
      expect.stringContaining("does not match"),
    );
  });

  it("rejects a value outside a closed enum", () => {
    const mutant = structuredClone(fixtures.meta) as Record<string, unknown>;
    (mutant["service"] as Record<string, unknown>)["seizure_model"] = "first-come-first-served";
    expect(contract.validate(schemaFor("meta"), mutant)).toContainEqual(
      expect.stringContaining("is not one of"),
    );
  });

  it("rejects null where the contract does not permit it", () => {
    const mutant = book();
    mutant["engines"] = null;
    expect(contract.validate(schemaFor("book"), mutant)).toContainEqual(
      expect.stringContaining("null is not permitted"),
    );
  });

  it("PERMITS null where the contract does — absent and zero stay distinguishable", () => {
    // `waterfall` is nullable, and a null waterfall is a legal book.
    const mutant = book();
    mutant["waterfall"] = null;
    expect(contract.validate(schemaFor("book"), mutant)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The fixture must not be vacuous. A book of zeroes is schema-valid; the whole
// reason the Go side added `TestSeededSuiteRejectsEmptyButValid` is that a
// contract test alone cannot tell the difference.
// ---------------------------------------------------------------------------

describe("the fixture is not an empty book", () => {
  it("carries non-zero totals on both engines, in their own scales", () => {
    const [aave, dm] = fixtures.book.engines;
    expect(aave?.total_collateral).toBe(PINNED.aave.collateralBase);
    expect(dm?.total_collateral).toBe(PINNED.dm.collateralUSD);
    expect(BigInt(aave?.total_collateral ?? "0")).toBeGreaterThan(0n);
    expect(BigInt(dm?.total_debt ?? "0")).toBeGreaterThan(0n);
    expect(aave?.value_decimals).not.toBe(dm?.value_decimals);
  });

  it("carries refusals, so the served-with-its-refusals rule is demonstrable", () => {
    expect(fixtures.book.batch.refused_count).toBe(PINNED.batch.refusedCount);
    expect(fixtures.book.engines.flatMap((e) => e.refusals).length).toBeGreaterThan(0);
  });

  it("carries a STANDING bad debt at the unshocked grid point", () => {
    const dm = fixtures.book.bad_debt.find((b) => b.engine === PINNED.engines.dm);
    expect(dm?.current_bad_debt_usd).toBe(PINNED.dm.badDebtAtPar);
    expect(BigInt(dm?.current_bad_debt_usd ?? "0")).toBeGreaterThan(0n);
  });
});
