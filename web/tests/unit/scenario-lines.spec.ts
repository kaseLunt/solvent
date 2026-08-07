// The committed scenario's takeaway (W-3L, inventory 201) — the label plus
// what it MOVES, in reader words, computed through the shared factor
// formatter; the zero-shock arm keeps the honest no-mark sentence. Pinned
// against the COMMITTED scenarios fixture, never hand-shaped rows.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { committedTakeaway, type TakeawayShock } from "../../app/lab/scenarioLines";

const here = path.dirname(fileURLToPath(import.meta.url));

interface ListedScenario {
  id: string;
  label: string;
  shocks: readonly TakeawayShock[];
}

const LISTING = JSON.parse(
  readFileSync(path.join(here, "..", "fixtures", "scenarios.json"), "utf8"),
) as { scenarios: ListedScenario[] };

function byId(id: string): ListedScenario {
  const found = LISTING.scenarios.find((scenario) => scenario.id === id);
  if (found === undefined) throw new Error(`fixture invariant: scenario ${id} expected`);
  return found;
}

test("a one-shock scenario: the label plus the DECLARED factor — never a movement claim", () => {
  expect(committedTakeaway(byId("eth_minus_30"))).toBe(
    "ETH -30 percent declares eth_usd ×0.7 — committed shock factors, applied through each " +
      "engine's own read path.",
  );
});

test("an asset-scoped shock names the asset in short form — never a bare axis", () => {
  expect(committedTakeaway(byId("ethfi_minus_50"))).toBe(
    "ETHFI -50 percent declares asset_usd 0xe008…fD3f ×0.5 — committed shock factors, " +
      "applied through each engine's own read path.",
  );
});

test("r84: a declared factor is NEVER claimed as a realized move — the snap-band no-op shape", () => {
  // A documented replica of the live stable_depeg_0995_in_band definition:
  // three 995/1000 stable marks that PriceProviderV2 snaps back to par —
  // the label itself says "a true no-op". The wire carries no transform
  // metadata, so the takeaway may state the DECLARED factors only; a
  // "moves ×0.995" beside that label is a wrong answer.
  const line = committedTakeaway({
    label: "Stable depeg to 0.995 (inside the snap band - a true no-op)",
    shocks: [
      {
        axis: "stable_usd",
        asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        factor_num: 995,
        factor_den: 1000,
      },
      {
        axis: "stable_usd",
        asset: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
        factor_num: 995,
        factor_den: 1000,
      },
      {
        axis: "stable_usd",
        asset: "0x80Eede496655FB9047dd39d9f418d5483ED600df",
        factor_num: 995,
        factor_den: 1000,
      },
    ],
  });
  expect(line).not.toContain("moves stable_usd");
  expect(line).toContain("declares");
  expect(line).toContain("read path");
});

test("zero shocks: the no-mark arm — an honest statement, never an empty definition", () => {
  const line = committedTakeaway(byId("weeth_market_depeg_oracles_held"));
  expect(line).toBe(
    "weETH market depeg to 0.95 (oracles held) moves no oracle mark — this scenario's " +
      "information lives on another axis.",
  );
  expect(line).not.toContain("×");
});

test("r83: a ×1 factor is an EXPLICIT HOLD, never a move — the committed rate projection pinned", () => {
  // dm_rate_horizon_plus_200bps carries a 1/1 placeholder: its +200bps
  // lives in projection metadata, not in an oracle mark. "moves borrow_apy
  // ×1" contradicted the scenario's own label.
  const line = committedTakeaway(byId("dm_rate_horizon_plus_200bps"));
  expect(line).toBe(
    "Debt Manager borrow APY +200bps (PROJECTION) moves no oracle mark — borrow_apy is held " +
      "at ×1, an explicit hold rather than a move.",
  );
  expect(line).not.toContain("moves borrow_apy ×1");
});

test("r83: a mixed definition names its moves AND its holds — never a hold dressed as a move", () => {
  const line = committedTakeaway({
    label: "mixed",
    shocks: [
      { axis: "eth_usd", factor_num: 70, factor_den: 100 },
      { axis: "usdc_usd", factor_num: 1, factor_den: 1 },
    ],
  });
  expect(line).toBe(
    "mixed declares eth_usd ×0.7 · usdc_usd held at ×1 — committed shock factors, applied " +
      "through each engine's own read path.",
  );
});

test("multiple shocks join with the interpunct, each through the formatter", () => {
  const line = committedTakeaway({
    label: "compound",
    shocks: [
      { axis: "eth_usd", factor_num: 70, factor_den: 100 },
      { axis: "steth_eth", factor_num: 995, factor_den: 1000 },
    ],
  });
  expect(line).toBe(
    "compound declares eth_usd ×0.7 · steth_eth ×0.995 — committed shock factors, applied " +
      "through each engine's own read path.",
  );
});
