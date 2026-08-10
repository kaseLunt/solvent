// p1b-3 — THE SetRunEngineSummary CLASSIFIER (closes Codex r3 finding 3).
// The tornado/set-run path had ZERO decimal validation: `barLength` called
// bare `BigInt` (`""` → a silent 0n — measured-zero laundering; `"-"` → a
// SyntaxError the route boundary ate), and the ledger's money renderers threw
// on malformed deltas, scales, realization and projection fields.
// `classifySetRunEngine` is the ONE law over the CONSUMED inventory, sibling
// of `classifyRunBookEngine` (p1b-2): wireGuard primitives, per-index naming
// (`projection.horizons[1].projected_usd`), schema-exact nullability.
//
// The skeleton is the COMMITTED set fixture's own engines
// (`run-book-set.no-denominator.json`, generated from contract artifacts —
// see generate-run-book-set.mjs): each test clones one, makes ONE documented
// corruption, and expects the classifier to name exactly that field. The
// untouched fixtures classify CLEAN — the law refuses no served body.
//
// SCOPE IS THE CONSUMED SET, BY DECISION (recorded in the module header):
// fields the wire serves but no tornado surface reads (before_bad_debt_usd,
// total_debt_usd_after, …) are NOT judged — pinned explicitly below so the
// scope decision cannot drift silently.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { classifySetRunEngine } from "../../app/lab/setRunClassification";
import type { RunBookSetResponse, SetRunEngineSummary } from "../../lib/runbookSet";

function fixture(name: string): RunBookSetResponse {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"),
  ) as RunBookSetResponse;
}

const VARIANT = fixture("run-book-set.no-denominator.json");

/** The committed variant's own engine row, cloned. */
function engineOf(scenarioId: string, engineName: string): SetRunEngineSummary {
  const result = VARIANT.results.find((candidate) => candidate.scenario_id === scenarioId);
  const found = result?.engines.find((candidate) => candidate.engine === engineName);
  if (found === undefined) throw new Error(`fixture carries no ${scenarioId}/${engineName} row`);
  return structuredClone(found);
}

/** Clone one committed engine row, apply ONE documented corruption, classify. */
function corrupted(
  scenarioId: string,
  engineName: string,
  mutate: (engine: SetRunEngineSummary) => void,
): string[] {
  const engine = engineOf(scenarioId, engineName);
  mutate(engine);
  return classifySetRunEngine(engine).malformedFields;
}

// ---------------------------------------------------------------------------
// The clean arm: every committed set fixture, every engine row.
// ---------------------------------------------------------------------------

test("p1b-3: every engine of every committed set fixture classifies CLEAN", () => {
  for (const name of [
    "run-book-set.json",
    "run-book-set.no-denominator.json",
    "run-book-set.superseded.json",
  ]) {
    for (const result of fixture(name).results) {
      for (const engine of result.engines) {
        expect(
          classifySetRunEngine(engine).malformedFields,
          `${name} · ${result.scenario_id} · ${engine.engine}`,
        ).toEqual([]);
      }
    }
  }
});

test("p1b-3: the schema-legal nulls are statements, never malformed", () => {
  // The fixture already carries all four (aave's null flipped_to_eligible,
  // the DM's null hf_dropped_accounts, null blocks) — each pinned explicitly
  // so a nullable arm cannot regress alone.
  expect(
    corrupted("eth_minus_30", "aave_v3_etherfi", (engine) => {
      engine.flipped_to_eligible = null;
    }),
  ).toEqual([]);
  expect(
    corrupted("eth_minus_30", "debt_manager", (engine) => {
      engine.hf_dropped_accounts = null;
    }),
  ).toEqual([]);
  expect(
    corrupted("weeth_market_depeg_oracles_held", "aave_v3_etherfi", (engine) => {
      engine.market_realization = null;
    }),
  ).toEqual([]);
  expect(
    corrupted("dm_rate_horizon_plus_200bps", "debt_manager", (engine) => {
      engine.projection = null;
    }),
  ).toEqual([]);
});

test("p1b-3: served fields NO tornado surface consumes are OUT OF SCOPE — the recorded decision, pinned", () => {
  // A classifier refusing a renderable row over a field no renderer reads
  // would refuse real answers over dead weight. A surface that starts
  // consuming one of these owes the module the check FIRST — this pin is
  // where that obligation becomes visible.
  expect(
    corrupted("eth_minus_30", "debt_manager", (engine) => {
      engine.before_bad_debt_usd = "";
      engine.total_debt_usd_after = "-";
      engine.before_eligible_debt_usd = "0x10";
      engine.infinite_accounts = 1.5;
    }),
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// The consumed scalars, group by group. One documented corruption each.
// ---------------------------------------------------------------------------

test("p1b-3: a fractional usd_decimals is named — the scale every money renderer exponentiates", () => {
  expect(
    corrupted("eth_minus_30", "debt_manager", (engine) => {
      engine.usd_decimals = 2.5;
    }),
  ).toEqual(["usd_decimals"]);
});

test("p1b-3: the two ratio Decimals are named — the empty string that laundered and the dash that crashed", () => {
  expect(
    corrupted("eth_minus_30", "debt_manager", (engine) => {
      engine.eligible_debt_delta_usd = "";
    }),
  ).toEqual(["eligible_debt_delta_usd"]);
  expect(
    corrupted("eth_minus_30", "debt_manager", (engine) => {
      engine.total_debt_usd_before = "-";
    }),
  ).toEqual(["total_debt_usd_before"]);
  // a non-string smuggled past the JSON cast is malformed, never a coerced read
  expect(
    corrupted("eth_minus_30", "debt_manager", (engine) => {
      engine.eligible_debt_delta_usd = 5 as unknown as string;
    }),
  ).toEqual(["eligible_debt_delta_usd"]);
});

test("p1b-3: the movement counts are named — the denominator's two inputs", () => {
  expect(
    corrupted("ethfi_minus_50", "debt_manager", (engine) => {
      engine.accounts = 1.5;
    }),
  ).toEqual(["accounts"]);
  expect(
    corrupted("ethfi_minus_50", "debt_manager", (engine) => {
      engine.movement_excluded_accounts = "0" as unknown as number;
    }),
  ).toEqual(["movement_excluded_accounts"]);
});

// p1b-10 (Codex round 2, finding 2 completion): the set-run counts are
// POPULATIONS by their schema descriptions ("Measurable positions of this
// engine"; "accounts the movement rule could not TEST"; "flips FALSE to TRUE,
// never a net"; "health factors that STRICTLY DROPPED") — nonnegative SAFE
// integers, the same law as the run-book classifier. `eligible_accounts_delta`
// (the schema's "NET — may be negative") stays out of scope by the recorded
// p1b-3 decision; a surface that starts consuming it owes `isWireSignedCount`.

test("p1b-10: a NEGATIVE or UNSAFE set-run population is named; the nullable subjects stay statements", () => {
  expect(
    corrupted("ethfi_minus_50", "debt_manager", (engine) => {
      engine.accounts = -1;
    }),
  ).toEqual(["accounts"]);
  // 2^53 — what JSON.parse makes of 9007199254740992.5.
  expect(
    corrupted("ethfi_minus_50", "debt_manager", (engine) => {
      engine.movement_excluded_accounts = 9007199254740992;
    }),
  ).toEqual(["movement_excluded_accounts"]);
  // The nullable movement subjects are populations too: null stays the
  // engine's own vocabulary statement; a negative non-null is named.
  expect(
    corrupted("eth_minus_30", "aave_v3_etherfi", (engine) => {
      engine.hf_dropped_accounts = -2;
    }),
  ).toEqual(["hf_dropped_accounts"]);
  expect(
    corrupted("ethfi_minus_50", "debt_manager", (engine) => {
      engine.flipped_to_eligible = null;
    }),
  ).toEqual([]);
});

test("p1b-3: the two nullable movement subjects are judged only when non-null", () => {
  expect(
    corrupted("eth_minus_30", "aave_v3_etherfi", (engine) => {
      engine.hf_dropped_accounts = 1.5;
    }),
  ).toEqual(["hf_dropped_accounts"]);
  expect(
    corrupted("ethfi_minus_50", "debt_manager", (engine) => {
      engine.flipped_to_eligible = "1" as unknown as number;
    }),
  ).toEqual(["flipped_to_eligible"]);
});

// ---------------------------------------------------------------------------
// The two blocks — judged ONLY when served (null is a statement).
// ---------------------------------------------------------------------------

test("p1b-3: a served market_realization is judged whole, field by field", () => {
  expect(
    corrupted("weeth_market_depeg_oracles_held", "aave_v3_etherfi", (engine) => {
      if (engine.market_realization === null) throw new Error("fixture shape: block missing");
      engine.market_realization.execution_shortfall_usd = "1e5";
    }),
  ).toEqual(["market_realization.execution_shortfall_usd"]);
  expect(
    corrupted("weeth_market_depeg_oracles_held", "debt_manager", (engine) => {
      if (engine.market_realization === null) throw new Error("fixture shape: block missing");
      engine.market_realization.bad_debt_at_liquidation_usd = " 1";
    }),
  ).toEqual(["market_realization.bad_debt_at_liquidation_usd"]);
  expect(
    corrupted("weeth_market_depeg_oracles_held", "debt_manager", (engine) => {
      if (engine.market_realization === null) throw new Error("fixture shape: block missing");
      engine.market_realization.usd_decimals = -1;
    }),
  ).toEqual(["market_realization.usd_decimals"]);
  // a mis-shaped block is named as its own malformed field, never a throw
  expect(
    corrupted("weeth_market_depeg_oracles_held", "debt_manager", (engine) => {
      engine.market_realization = "gone" as unknown as SetRunEngineSummary["market_realization"];
    }),
  ).toEqual(["market_realization"]);
});

test("p1b-3: a served projection's horizon Decimals are named PER INDEX", () => {
  expect(
    corrupted("dm_rate_horizon_plus_200bps", "debt_manager", (engine) => {
      const horizon = engine.projection?.horizons[1];
      if (!horizon) throw new Error("fixture shape: horizons[1] missing");
      horizon.projected_usd = "0x10";
    }),
  ).toEqual(["projection.horizons[1].projected_usd"]);
  expect(
    corrupted("dm_rate_horizon_plus_200bps", "debt_manager", (engine) => {
      const horizon = engine.projection?.horizons[0];
      if (!horizon) throw new Error("fixture shape: horizons[0] missing");
      horizon.debt_usd = "";
      horizon.additional_interest_usd = "4200.5";
    }),
  ).toEqual([
    "projection.horizons[0].debt_usd",
    "projection.horizons[0].additional_interest_usd",
  ]);
  // a mis-shaped horizons array / projection is named, never walked blind
  expect(
    corrupted("dm_rate_horizon_plus_200bps", "debt_manager", (engine) => {
      if (engine.projection === null) throw new Error("fixture shape: block missing");
      engine.projection.horizons = "gone" as unknown as NonNullable<
        SetRunEngineSummary["projection"]
      >["horizons"];
    }),
  ).toEqual(["projection.horizons"]);
  expect(
    corrupted("dm_rate_horizon_plus_200bps", "debt_manager", (engine) => {
      engine.projection = 7 as unknown as SetRunEngineSummary["projection"];
    }),
  ).toEqual(["projection"]);
});

// ---------------------------------------------------------------------------
// Read order.
// ---------------------------------------------------------------------------

test("p1b-3: fields are named in wire read order across the whole row", () => {
  expect(
    corrupted("dm_rate_horizon_plus_200bps", "debt_manager", (engine) => {
      engine.usd_decimals = 2.5;
      engine.eligible_debt_delta_usd = "";
      engine.total_debt_usd_before = "-";
      const horizon = engine.projection?.horizons[0];
      if (!horizon) throw new Error("fixture shape: horizons[0] missing");
      horizon.projected_usd = "x";
    }),
  ).toEqual([
    "usd_decimals",
    "eligible_debt_delta_usd",
    "total_debt_usd_before",
    "projection.horizons[0].projected_usd",
  ]);
});
