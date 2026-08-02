// `GET /v1/scenarios` (contract 1.4.0) — the committed scenario listing.
//
// Three laws, at three layers:
//
//  1. TYPE-LEVEL WELD (checked by `tsc`, not at runtime): `ScenarioDefinition`
//     IS `Omit<Scenario, "results">`, and therefore also
//     `Omit<RefinedScenario, "results">`. The two contract schemas are
//     hand-written — the server proves the SERIALIZER cannot drift, but nothing
//     stops a future contract edit from adding a field to one schema and
//     forgetting the other, and the generated types are what a consumer builds
//     against. A mutual-assignability check fails this compile the day they
//     diverge. The anti-vacuity control below proves the check discriminates.
//
//  2. RUNTIME WELD against the COMMITTED stress fixture bytes: every entry of
//     `stress-aave.json`'s `scenarios` array, minus `results`, must validate
//     against the contract's `/v1/scenarios` response schema. That is the
//     client-side mirror of the server's wire weld, and it uses fixture bytes
//     the Go suite pins rather than a shape typed here.
//
//  3. THE ROUTE: `scenarios()` GETs the right path and returns the wire body
//     verbatim — including `engines` and the exact-rational shocks, the two
//     fields a Lab needs to tell "not covered by this scenario" from "withheld"
//     and to group by axis.

import { describe, expect, it } from "vitest";

import {
  SolventClient,
  type RefinedScenario,
  type Scenario,
  type ScenarioDefinition,
  type ScenariosResponse,
} from "../src/index.js";
import * as fixtures from "./fixtures/index.js";
import { CONTRACT_PATH } from "./fixtures/index.js";
import { loadContract } from "./helpers/contract.js";
import { mockFetch } from "./helpers/mock-fetch.js";

const BASE = "http://localhost:8080";
const contract = loadContract(CONTRACT_PATH);

// ---------------------------------------------------------------------------
// 1. The type-level weld.
// ---------------------------------------------------------------------------

/** Mutual assignability — `true` only when A and B are the same type. */
type ExactlyEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// The weld itself: a contract drift between the two schemas fails HERE.
const definitionIsScenarioMinusResults: ExactlyEqual<ScenarioDefinition, Omit<Scenario, "results">> = true;

// And against the REFINED shape the stress surface hands consumers, since that
// is what a Lab actually holds: refining touches `results` and nothing else.
const definitionIsRefinedScenarioMinusResults: ExactlyEqual<
  ScenarioDefinition,
  Omit<RefinedScenario, "results">
> = true;

// ANTI-VACUITY CONTROL. If `ExactlyEqual` resolved to `true` for any pair, the
// two welds above would be decoration. Dropping `engines` as well must NOT be
// equal to `ScenarioDefinition` — and `tsc` fails the build if this assignment
// turns out to be legal.
// @ts-expect-error — ScenarioDefinition carries `engines`; a type without it is a different type.
const controlMustNotBeEqual: ExactlyEqual<ScenarioDefinition, Omit<Scenario, "results" | "engines">> = true;

describe("the type-level weld between ScenarioDefinition and Scenario", () => {
  it("is checked by tsc: the listing element IS the stress element minus results", () => {
    expect(definitionIsScenarioMinusResults).toBe(true);
    expect(definitionIsRefinedScenarioMinusResults).toBe(true);
    // The control's VALUE is irrelevant — its ts-expect-error is the assertion.
    expect(controlMustNotBeEqual).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The runtime weld, against committed fixture bytes.
// ---------------------------------------------------------------------------

describe("the committed stress fixture's scenarios, minus results, ARE a valid listing", () => {
  it("validates against the /v1/scenarios response schema", () => {
    const schema = contract.schemaFor("/v1/scenarios", 200);

    const definitions = fixtures.stressAave.scenarios.map((scenario) => {
      const { results, ...definition } = scenario;
      // ANTI-VACUITY: the stress entry must really carry the per-address half,
      // or this is a comparison of a shape against itself.
      expect(Array.isArray(results)).toBe(true);
      return definition;
    });
    expect(definitions.length).toBeGreaterThan(0);

    const listing = {
      served_at: fixtures.stressAave.served_at,
      scenario_config_version: fixtures.stressAave.scenario_config_version,
      scenarios: definitions,
      notes: [],
    } satisfies ScenariosResponse;

    // `additionalProperties: false` runs through this validator, so a stress
    // field the listing schema does not declare would be caught here — the
    // client-side half of "the listing is the stress entry minus results".
    expect(contract.validate(schema, listing)).toEqual([]);
  });

  it("REJECTS a listing entry that still carries results — the two halves are not interchangeable", () => {
    const schema = contract.schemaFor("/v1/scenarios", 200);
    const withResults = {
      served_at: fixtures.stressAave.served_at,
      scenario_config_version: fixtures.stressAave.scenario_config_version,
      scenarios: fixtures.stressAave.scenarios,
      notes: [],
    };
    expect(contract.validate(schema, withResults).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The route.
// ---------------------------------------------------------------------------

const listingBody = {
  served_at: "2026-07-29T10:00:05Z",
  scenario_config_version: "v1",
  scenarios: [
    {
      id: "ethfi_minus_50",
      version: "v1",
      label: "ETHFI -50 percent",
      description: "Idiosyncratic own-ecosystem-token shock.",
      path_assumption: "instantaneous mark at the shocked level; single-step, no path",
      // DM-only, and that is a property of the DEFINITION: the Aave engine is
      // not covered here, which a consumer must not render as "withheld".
      engines: ["debt_manager"],
      shocks: [
        {
          axis: "asset_usd" as const,
          asset: "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f",
          factor_num: 50,
          factor_den: 100,
        },
      ],
      out_of_model: ["liquidator liquidity, gas costs, execution latency and cascade dynamics"],
    },
    {
      id: "dm_rate_horizon_plus_200bps",
      version: "v1",
      label: "Debt Manager borrow APY +200bps (PROJECTION)",
      description: "A rate change does not move a spot health factor.",
      path_assumption: "collateral prices held flat at the current sample",
      engines: ["debt_manager"],
      // The 1/1 shock: the rate axis ships as a projection, not a spot mark.
      shocks: [{ axis: "borrow_apy" as const, factor_num: 1, factor_den: 1 }],
      out_of_model: ["borrower behaviour: no repayment, no top-up, no new borrowing over the horizon"],
    },
  ],
  notes: ["configuration, not batch data"],
} satisfies ScenariosResponse;

describe("scenarios()", () => {
  it("GETs /v1/scenarios and returns the wire body verbatim", async () => {
    const mock = mockFetch({ "/v1/scenarios": { body: JSON.stringify(listingBody) } });
    const client = new SolventClient({ baseUrl: BASE, fetch: mock.fetch });

    const body = await client.scenarios();
    expect(mock.calls).toEqual([`${BASE}/v1/scenarios`]);
    expect(body.scenario_config_version).toBe("v1");
    expect(body.scenarios.map((s) => s.id)).toEqual(["ethfi_minus_50", "dm_rate_horizon_plus_200bps"]);

    // `engines` survives the round trip: it is how a caller tells "this
    // scenario does not cover that engine" from "that engine is withheld".
    expect(body.scenarios[0]!.engines).toEqual(["debt_manager"]);

    // Shocks stay EXACT rationals — the axis (for grouping and for deriving
    // the projection badge) and the integer factor, never a float.
    const shock = body.scenarios[0]!.shocks[0]!;
    expect(shock.axis).toBe("asset_usd");
    expect(shock.asset).toBe("0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f");
    expect(shock.factor_num / shock.factor_den).toBe(0.5);
    expect(body.scenarios[1]!.shocks[0]).toEqual({ axis: "borrow_apy", factor_num: 1, factor_den: 1 });
  });

  it("the served body is contract-valid, and the mocked one is the shape the contract's example teaches", () => {
    const schema = contract.schemaFor("/v1/scenarios", 200);
    expect(contract.validate(schema, listingBody)).toEqual([]);
  });

  it("carries no batch envelope — the listing is servable cold and says nothing about a book", () => {
    // A batch field would be a claim a committed definition does not make, and
    // `additionalProperties: false` makes the absence structural rather than a
    // convention.
    const schema = contract.schemaFor("/v1/scenarios", 200);
    expect(contract.validate(schema, { ...listingBody, batch: null }).length).toBeGreaterThan(0);
    expect(Object.keys(listingBody)).toEqual([
      "served_at",
      "scenario_config_version",
      "scenarios",
      "notes",
    ]);
  });
});
