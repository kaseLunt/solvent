import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { components } from "@solvent/client";
import { SCENARIOS } from "../fixtures/lab-book";
import { DEMO_SCENARIOS } from "../fixtures/demo";
import { SCENARIO_GISTS, SCENARIO_NAMES, scenarioGist, scenarioName, shockWord } from "../../lib/scenario-name";

type ScenarioDefinition = components["schemas"]["ScenarioDefinition"];

const here = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.resolve(here, "..", "..", "..", "internal", "risk", "scenarios");
/** Every committed scenario definition, as the service loads it. */
const COMMITTED: ScenarioDefinition[] = readdirSync(configDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(path.join(configDir, name), "utf8")) as ScenarioDefinition);
const committed = (id: string): ScenarioDefinition => {
  const def = COMMITTED.find((d) => d.id === id);
  if (def === undefined) throw new Error(`no committed scenario ${id}`);
  return def;
};
const listed = (id: string): ScenarioDefinition => {
  const def = SCENARIOS.scenarios.find((d) => d.id === id);
  if (def === undefined) throw new Error(`fixture: no listed scenario ${id}`);
  return def;
};

test.describe("scenarioName — one name per scenario, built from its definition", () => {
  test("a single factor shock on a named axis is named by the axis and the factor's own exact percent", () => {
    expect(scenarioName(listed("eth_minus_30"))).toBe("ETH −30%");
    expect(scenarioName(listed("ethfi_minus_50"))).toBe("ETHFI −50%");
    expect(scenarioName(committed("eth_minus_10"))).toBe("ETH −10%");
    expect(scenarioName(committed("eth_minus_60"))).toBe("ETH −60%");
    expect(scenarioName(committed("btc_leg_minus_20"))).toBe("BTC −20%");
    expect(scenarioName(committed("weeth_rate_minus_5"))).toBe("weETH redemption rate −5%");
  });

  test("the name changes when the definition's factor does — it is never a typed string that can go stale", () => {
    const def = listed("eth_minus_30");
    expect(scenarioName({ ...def, shocks: [{ axis: "eth_usd", factor_num: 75, factor_den: 100 }] })).toBe("ETH −25%");
    expect(scenarioName({ ...def, shocks: [{ axis: "eth_usd", factor_num: 3, factor_den: 2 }] })).toBe("ETH +50%");
  });

  test("a factor that does not terminate is marked approximate, never silently rounded", () => {
    const def = listed("eth_minus_30");
    expect(scenarioName({ ...def, shocks: [{ axis: "eth_usd", factor_num: 2, factor_den: 3 }] })).toBe("ETH ≈−33.3333%");
  });

  test("a scenario with no single named shock takes its display name, else the wire's label verbatim", () => {
    expect(scenarioName(listed("weeth_market_depeg_oracles_held"))).toBe("weETH depeg to 0.95, oracles held");
    expect(scenarioName(listed("dm_rate_horizon_plus_200bps"))).toBe("Cash borrow APY +200 bps");
    expect(scenarioName(committed("stable_depeg_098_unsnapped"))).toBe(committed("stable_depeg_098_unsnapped").label);
    expect(scenarioName(committed("dm_composition_census"))).toBe(committed("dm_composition_census").label);
    const unknown = { ...listed("eth_minus_30"), id: "some_new_scenario", label: "Some new scenario", shocks: [] };
    expect(scenarioName(unknown)).toBe("Some new scenario");
  });

  test("a shock the wire guard refuses is never arithmetic: the name falls back to the label, and nothing throws", () => {
    const def = listed("eth_minus_30");
    for (const shock of [
      { axis: "eth_usd" as const, factor_num: 70, factor_den: 0 },
      { axis: "eth_usd" as const, factor_num: 70, factor_den: -100 },
      { axis: "eth_usd" as const, factor_num: 70.5, factor_den: 100 },
      { axis: "eth_usd" as const, factor_num: -0, factor_den: 100 },
      { axis: "eth_usd" as const, factor_num: 2 ** 60, factor_den: 100 },
    ]) {
      expect(scenarioName({ ...def, shocks: [shock] }), JSON.stringify(shock)).toBe(def.label);
    }
  });

  test("two shocks are not one axis: no factor name is claimed", () => {
    const def = listed("eth_minus_30");
    const two = [
      { axis: "eth_usd" as const, factor_num: 70, factor_den: 100 },
      { axis: "eth_usd" as const, factor_num: 70, factor_den: 100 },
    ];
    expect(scenarioName({ ...def, shocks: two })).toBe(def.label);
  });

  test("no displayed name carries the projection marker, a hyphen for a minus or the word 'percent'", () => {
    for (const def of [...COMMITTED, ...SCENARIOS.scenarios, ...DEMO_SCENARIOS.scenarios]) {
      const name = scenarioName(def);
      expect(name, def.id).not.toContain("(PROJECTION)");
      if (name !== def.label) {
        expect(name, def.id).not.toMatch(/-\d/);
        expect(name, def.id).not.toContain("percent");
      }
    }
  });

  test("shockWord names only the axes the contract has, and an asset axis only by an asset it names", () => {
    expect(shockWord({ axis: "eth_usd" })).toBe("ETH");
    expect(shockWord({ axis: "weeth_eth_rate" })).toBe("weETH redemption rate");
    expect(shockWord({ axis: "asset_usd", asset: "0xE0080D2F853ECDDBD81A643DC10DA075DF26FD3F" })).toBe("ETHFI");
    expect(shockWord({ axis: "asset_usd", asset: "0x0000000000000000000000000000000000000001" })).toBeNull();
    expect(shockWord({ axis: "asset_usd" })).toBeNull();
    expect(shockWord({ axis: "stable_usd", asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" })).toBeNull();
    expect(shockWord({ axis: "borrow_apy" })).toBeNull();
    // The stress grid names its axis the same way, its asset optional: the same words, no second map.
    expect(shockWord({ axis: "eth_usd", asset: null })).toBe("ETH");
    expect(shockWord({ axis: "asset_usd", asset: null })).toBeNull();
    expect(shockWord({ axis: "some_new_axis" })).toBeNull();
  });

  test("the display names are keyed to committed scenarios", () => {
    for (const id of [...Object.keys(SCENARIO_NAMES), ...Object.keys(SCENARIO_GISTS)]) expect(() => committed(id), id).not.toThrow();
  });
});

test.describe("scenarioGist — one line under the name", () => {
  test("a listed gist is at most 70 characters", () => {
    for (const [id, gist] of Object.entries(SCENARIO_GISTS)) expect(gist.length, id).toBeLessThanOrEqual(70);
  });

  test("the four library scenarios take their gist", () => {
    expect(scenarioGist(listed("eth_minus_30"))).toBe("All ETH-linked collateral, instantaneous mark");
    expect(scenarioGist(listed("weeth_market_depeg_oracles_held"))).toBe("Market price 5% under redemption; oracles unchanged");
    expect(scenarioGist(listed("dm_rate_horizon_plus_200bps"))).toBe("Closed-form horizon projection; prices held flat");
    expect(scenarioGist(listed("ethfi_minus_50"))).toBe("Own-ecosystem token shock; sETHFI moves with it");
  });

  test("any other scenario takes the first sentence of its own description — a decimal point is not a sentence end", () => {
    expect(scenarioGist(committed("eth_minus_20"))).toBe("Factor shock on ETH/USD.");
    expect(scenarioGist(committed("stable_depeg_0995_in_band"))).toBe("Every configured Debt Manager stable is marked 0.5 percent below par.");
    const def = listed("eth_minus_30");
    expect(scenarioGist({ ...def, id: "x", description: "No full stop here" })).toBe("No full stop here");
    expect(scenarioGist({ ...def, id: "x", description: "" })).toBe("");
  });
});
