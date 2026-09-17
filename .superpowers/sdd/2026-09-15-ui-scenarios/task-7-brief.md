### Task 7: `lab-classify` (the two classifiers, moved) and `lab-compare` (the set run as signed shares) (R6, R9)

**Files:**
- Create: `web/lib/lab-classify.ts`, `web/lib/lab-compare.ts`
- Test: `web/tests/unit/lab-classify-run-book.spec.ts`, `web/tests/unit/lab-classify-set-run.spec.ts` (moved), `web/tests/unit/lab-compare.spec.ts`

**Interfaces:**
- Consumes: `lib/runbook.ts` (`LabRunBookEngine`), `lib/runbookSet.ts` (`SetRunEngineSummary`, `RunBookSetResponse`, `SetRunScenarioResult`), `lib/wireGuard.ts`, `lib/human-usd.ts`, `lib/lab-headline.ts` (`signedUsd`), `lib/percent.ts` (`formatTenths`).
- Produces: `classifyRunBookEngine(engine): { malformedFields: string[] }`, `classifySetRunEngine(engine): { malformedFields: string[] }` (moved verbatim); `CompareKind`, `CompareRow`, `CompareView`, `shareTenths(delta, denominator): bigint | null`, `compareRows(set, engine): CompareView`.

- [ ] **Step 1: The move — both classifiers verbatim**

Create `web/lib/lab-classify.ts`: the whole of `web/app/lab/engineClassification.ts` (its helpers `isRecord`, `isNullableWireDecimal`, `isNullableWirePopulation`, `aggregateChecks`, `transitionChecks` and `classifyRunBookEngine`, lines 48–324) followed by the whole of `web/app/lab/setRunClassification.ts` (its helpers and `classifySetRunEngine`, lines 70–149), each function body byte-for-byte; the two files' duplicated private helpers (`isRecord`, `isNullableWirePopulation`) are kept ONCE (they are identical — verify with `diff` and say so in the report); imports become `./runbook`, `./runbookSet`, `./wireGuard`. Header:

```ts
// web/lib/lab-classify.ts
// The run-book and set-run engine classifiers: every field a result carries,
// checked against the wire contract before anything is read from it. A
// malformed engine is refused by the names of its fields. Moved verbatim from
// the old Lab's engineClassification.ts and setRunClassification.ts.
```

Move the specs: copy `web/tests/unit/engine-classification.spec.ts` to `web/tests/unit/lab-classify-run-book.spec.ts` and `web/tests/unit/set-run-classification.spec.ts` to `web/tests/unit/lab-classify-set-run.spec.ts`, changing only the import paths to `../../lib/lab-classify`. Do not delete the originals (Task 12 does).

Run: `cd web && npx playwright test --project=unit tests/unit/lab-classify-run-book.spec.ts tests/unit/lab-classify-set-run.spec.ts`
Expected: 28 + 11 passed — the same counts as the originals.

- [ ] **Step 2: The compare pins (failing)**

```ts
// web/tests/unit/lab-compare.spec.ts
// Compare: each scenario's contribution as a signed share of the engine's own
// book, the wire's sanctioned denominator; every non-answer is its own kind
// and never a dot at zero.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { compareRows, shareTenths, type RunBookSetResponse, type SetRunEngineSummary, type SetRunScenarioResult } from "../../lib/lab-compare";

const BASE = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/run-book-set.json", import.meta.url)), "utf8")) as RunBookSetResponse;
const TEMPLATE_ENGINE = BASE.results[0]!.engines[0]!;
const TEMPLATE_RESULT = BASE.results[0]!;

const summary = (overrides: Partial<SetRunEngineSummary>): SetRunEngineSummary => ({ ...TEMPLATE_ENGINE, engine: "debt_manager", usd_decimals: 6, ...overrides });
const result = (id: string, label: string, overrides: Partial<SetRunScenarioResult>): SetRunScenarioResult => ({
  ...TEMPLATE_RESULT,
  scenario_id: id,
  scenario_version: "v1",
  label,
  covered_engines: ["debt_manager"],
  withheld_engines: [],
  unmeasurable_engines: [],
  engines: [],
  ...overrides,
});
const setOf = (results: SetRunScenarioResult[]): RunBookSetResponse => ({ ...BASE, requested_scenario_ids: results.map((r) => r.scenario_id), results });

test("shareTenths: signed, truncated toward zero, null without a positive denominator", () => {
  expect(shareTenths(1_280_000_000_000n, 27_828_808_216_758n)).toBe(45n);
  expect(shareTenths(-1n, 3n)).toBe(0n);
  expect(shareTenths(-3n, 2n)).toBe(-1500n);
  expect(shareTenths(1n, 0n)).toBeNull();
  expect(shareTenths(1n, -5n)).toBeNull();
});

test("points are ranked by |share|, the words carry sign and tier, every non-answer keeps its own kind in wire order after the points", () => {
  const set = setOf([
    result("ethfi_minus_50", "ETHFI -50 percent", { engines: [summary({ eligible_debt_delta_usd: "9800000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: 2 })] }),
    result("eth_minus_30", "ETH -30 percent", { engines: [summary({ eligible_debt_delta_usd: "1280000000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: 118 })] }),
    result("weeth_market_depeg_oracles_held", "weETH market depeg to 0.95 (oracles held)", { engines: [summary({ eligible_debt_delta_usd: "0", total_debt_usd_before: "27828808216758", flipped_to_eligible: 0 })] }),
    result("held", "Withheld one", { covered_engines: [], withheld_engines: ["debt_manager"] }),
    result("legacy_only", "Legacy only", { covered_engines: ["aave_v3_etherfi"], engines: [summary({ engine: "aave_v3_etherfi", usd_decimals: 8 })] }),
    result("absent", "Unmeasurable one", { covered_engines: [], unmeasurable_engines: [{ engine: "debt_manager", reason: "no_measurable_positions", counts: { positions_in_batch: 0, refused_in_batch: 0, unrebuildable: 0 }, note: "n" }] }),
    result("zero_book", "Empty book", { engines: [summary({ eligible_debt_delta_usd: "5", total_debt_usd_before: "0" })] }),
    result("bad", "Bad wire", { engines: [summary({ eligible_debt_delta_usd: "1e6" })] }),
    result("rate", "Rate step", { engines: [summary({ eligible_debt_delta_usd: "-2000000000", total_debt_usd_before: "27828808216758", flipped_to_eligible: null })] }),
  ]);
  const v = compareRows(set, "debt_manager");
  expect(v.engine).toBe("debt_manager");
  expect(v.batchId).toBe(BASE.batch.id);
  expect(v.freshness).toBe(BASE.evaluation.freshness);
  // Points ranked by |share|, then by |Δ| (a tie under a tenth still ranks by contribution), then wire order; every non-answer after, in wire order.
  expect(v.rows.map((r) => [r.id, r.kind])).toEqual([
    ["eth_minus_30", "point"],
    ["ethfi_minus_50", "point"],
    ["rate", "point"],
    ["weeth_market_depeg_oracles_held", "point"],
    ["held", "withheld"],
    ["legacy_only", "not-covered"],
    ["absent", "unmeasurable"],
    ["zero_book", "no-denominator"],
    ["bad", "unreadable"],
  ]);
  const eth = v.rows[0]!;
  expect(eth.shareTenths).toBe(45n);
  expect(eth.shareText).toBe("+4.5%");
  expect(eth.deltaText).toBe("+$1.2M");
  expect(eth.newly).toBe(118);
  // A contribution too small for a tenth keeps its sign and says it is under the resolution — never "+0%".
  expect(v.rows[1]?.shareText).toBe("+<0.1%");
  expect(v.rows[1]?.deltaText).toBe("+$9,800");
  expect(v.rows[2]?.shareText).toBe("−<0.1%");
  expect(v.rows[2]?.deltaText).toBe("−$2,000");
  expect(v.rows[2]?.newly).toBeNull();
  expect(v.rows[3]?.shareText).toBe("0%");
  expect(v.rows[3]?.deltaText).toBe("+$0");
  expect(v.rows[4]?.reason).toBe("withheld");
  expect(v.rows[5]?.reason).toBe("not modelled");
  expect(v.rows[6]?.reason).toBe("no_measurable_positions");
  expect(v.rows[7]?.reason).toBe("no denominator");
  expect(v.rows[7]?.deltaText).toBe("+<$0.01");
  expect(v.rows[8]?.reason).toContain("eligible_debt_delta_usd");
  for (const r of v.rows.slice(4)) expect(r.shareTenths).toBeNull();
});

test("a malformed summary is contradictory, named by the classifier, and never a point", () => {
  const set = setOf([result("x", "X", { engines: [summary({ accounts: -1 })] })]);
  const v = compareRows(set, "debt_manager");
  expect(v.rows[0]?.kind).toBe("contradictory");
  expect(v.rows[0]?.reason).toContain("accounts");
  expect(v.rows[0]?.shareTenths).toBeNull();
});
```

Before Step 4, check the fixture's `BASE.results[0].engines[0]` has every field `SetRunEngineSummary` requires (it is the contract's own 200 example, so it does); the `summary()` spread rides on it. If `unmeasurable_engines[].reason` is an enum the literal `"no_measurable_positions"` is not in, use the fixture's own value from `web/tests/fixtures/run-book-set.no-denominator.json` (grep `unmeasurable_engines`) and pin that.

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-compare.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-compare'`.

- [ ] **Step 4: The compare module**

```ts
// web/lib/lab-compare.ts
// Compare scenarios: the set run's per-scenario summary for one engine as a
// signed share of that engine's book — `eligible_debt_delta_usd` over
// `total_debt_usd_before`, the denominator the wire itself sanctions. A
// scenario that did not answer for the engine keeps its own kind; it is never
// a dot at zero.
import type { components } from "@solvent/client";
import { classifySetRunEngine } from "./lab-classify";
import { signedUsd } from "./lab-headline";
import { formatTenths } from "./percent";
import { isWireDecimal, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookSetResponse = Schemas["RunBookSetResponse"];
export type SetRunScenarioResult = Schemas["SetRunScenarioResult"];
export type SetRunEngineSummary = Schemas["SetRunEngineSummary"];

export type CompareKind = "point" | "withheld" | "not-covered" | "unmeasurable" | "contradictory" | "no-denominator" | "unreadable";

export interface CompareRow {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly kind: CompareKind;
  readonly deltaUsd: bigint | null;
  readonly decimals: number | null;
  readonly shareTenths: bigint | null;
  readonly shareText: string;
  readonly deltaText: string;
  readonly reason: string | null;
  /** The engine's own flip count (`flipped_to_eligible`); null where the engine does not speak it. */
  readonly newly: number | null;
}

export interface CompareView {
  readonly engine: string;
  readonly rows: readonly CompareRow[];
  readonly batchId: number;
  readonly freshness: Schemas["SetRunEvaluation"]["freshness"];
  readonly newestServable: number | null;
  readonly evaluated: number;
  readonly configVersion: string;
  readonly servedAt: string;
}

/** Signed tenths of a percent, truncated toward zero; null without a positive denominator. */
export function shareTenths(delta: bigint, denominator: bigint): bigint | null {
  if (denominator <= 0n) return null;
  return (delta * 1000n) / denominator;
}

/** The share's words: a zero delta is "0%"; a nonzero delta under a tenth keeps its sign and says so; otherwise the signed tenths. */
function shareWords(delta: bigint, tenths: bigint): string {
  if (delta === 0n) return "0%";
  if (tenths === 0n) return delta < 0n ? "−<0.1%" : "+<0.1%";
  return tenths < 0n ? formatTenths(tenths) : `+${formatTenths(tenths)}`;
}

function rowOf(r: SetRunScenarioResult, engine: string): CompareRow {
  const base = { id: r.scenario_id, version: r.scenario_version, label: r.label, deltaUsd: null, decimals: null, shareTenths: null, shareText: "—", deltaText: "—", newly: null };
  if (r.withheld_engines.includes(engine)) return { ...base, kind: "withheld", reason: "withheld" };
  const absent = r.unmeasurable_engines.find((a) => a.engine === engine);
  if (absent !== undefined) return { ...base, kind: "unmeasurable", reason: absent.reason };
  const e = r.engines.find((s) => s.engine === engine);
  if (e === undefined) return { ...base, kind: "not-covered", reason: "not modelled" };
  const malformed = classifySetRunEngine(e).malformedFields;
  if (malformed.length > 0) return { ...base, kind: "contradictory", reason: malformed.join(", ") };
  if (!isWireScale(e.usd_decimals) || !isWireDecimal(e.eligible_debt_delta_usd) || !isWireDecimal(e.total_debt_usd_before)) {
    const bad = [
      isWireScale(e.usd_decimals) ? null : "usd_decimals",
      isWireDecimal(e.eligible_debt_delta_usd) ? null : "eligible_debt_delta_usd",
      isWireDecimal(e.total_debt_usd_before) ? null : "total_debt_usd_before",
    ].filter((f): f is string => f !== null);
    return { ...base, kind: "unreadable", reason: bad.join(", ") };
  }
  const delta = BigInt(e.eligible_debt_delta_usd);
  const share = shareTenths(delta, BigInt(e.total_debt_usd_before));
  const deltaText = signedUsd(delta, e.usd_decimals);
  const newly = e.flipped_to_eligible;
  if (share === null) return { ...base, kind: "no-denominator", deltaUsd: delta, decimals: e.usd_decimals, deltaText, reason: "no denominator", newly };
  return { ...base, kind: "point", deltaUsd: delta, decimals: e.usd_decimals, shareTenths: share, shareText: shareWords(delta, share), deltaText, reason: null, newly };
}

const abs = (t: bigint): bigint => (t < 0n ? -t : t);
const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

export function compareRows(set: RunBookSetResponse, engine: string): CompareView {
  const rows = set.results.map((r) => rowOf(r, engine));
  // |share| descending, then |Δ| descending (a tie under a tenth still ranks by contribution), then wire order (a stable sort).
  const points = rows
    .filter((r) => r.kind === "point")
    .sort((a, b) => compareBig(abs(b.shareTenths ?? 0n), abs(a.shareTenths ?? 0n)) || compareBig(abs(b.deltaUsd ?? 0n), abs(a.deltaUsd ?? 0n)));
  const rest = rows.filter((r) => r.kind !== "point");
  return {
    engine,
    rows: [...points, ...rest],
    batchId: set.batch.id,
    freshness: set.evaluation.freshness,
    newestServable: set.evaluation.newest_servable_batch_id,
    evaluated: set.evaluation.scenarios_evaluated,
    configVersion: set.scenario_config_version,
    servedAt: set.served_at,
  };
}
```

`Array.prototype.sort` is stable, so rows equal on both keys keep wire order. `signedUsd(5n, 6)` is `+<$0.01` — the Book's dust display keeps its sign.

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-compare.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-classify.ts web/lib/lab-compare.ts web/tests/unit/lab-classify-run-book.spec.ts web/tests/unit/lab-classify-set-run.spec.ts web/tests/unit/lab-compare.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-classify moved verbatim into lib; lab-compare - each scenario as a signed share of the engine's own book, every non-answer its own kind" -- web/lib/lab-classify.ts web/lib/lab-compare.ts web/tests/unit/lab-classify-run-book.spec.ts web/tests/unit/lab-classify-set-run.spec.ts web/tests/unit/lab-compare.spec.ts
```

---
