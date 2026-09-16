### Task 11: Fixtures — the `/v1/meta` copy and the realistic-scale demo dataset

**Files:**
- Create: `web/tests/fixtures/generate-overview.mjs`, `web/tests/fixtures/meta.ts` (+ generated `web/tests/fixtures/meta.json`)
- Create: `web/tests/fixtures/demo/generate-demo.mjs`, `web/tests/fixtures/demo/index.ts` (+ generated `book.demo.json`, `positions-dm-demo-page-1.json`, `positions-dm-demo-page-2.json`, `meta.demo.json`)
- Test: `web/tests/unit/demo-fixture-weld.spec.ts`
- Read: `web/tests/fixtures/generate-book.mjs` (the provenance-header convention), `web/tests/fixtures/positions-dm-page-1.json` (the two canonical DM rows used as templates)

**Interfaces:**
- `META: Schemas["MetaResponse"]` from `tests/fixtures/meta.ts`.
- From `tests/fixtures/demo/index.ts`: `DEMO_BOOK: Schemas["BookResponse"]`, `DEMO_POSITIONS_DM_PAGE_1`, `DEMO_POSITIONS_DM_PAGE_2: Schemas["PositionsResponse"]`, `DEMO_META: Schemas["MetaResponse"]`, and `DEMO_BATCH_ID = 18251`.
- Demo shape (spec §8, proportions to be corrected once the hosted API reports the real split): 1,412 Cash accounts — 49 liquidatable (2 material · 4 small · 43 dust), 27 near cap (room < 10%), 6 refused (`SWEEP_NEVER`), the rest computed with 10–80% room; Σ debt ≈ $24.6M; legacy engine 8,552 positions with 46 dust liquidatables; batch 18,251 computed `2026-08-08T20:22:08Z`, age 42s; watermark blocks from the real riskd log (`aave_v3_etherfi@25714690`, `debt_manager@155323444`).

- [ ] **Step 1: The meta copy**

```js
// web/tests/fixtures/generate-overview.mjs
// Overview fixture generation + PROVENANCE. Regenerate: node tests/fixtures/generate-overview.mjs (from web/)
//   meta.json <- BYTE-IDENTICAL copy of packages/client-ts/test/fixtures/meta.json
//   (contract-validated there by fixtures.test.ts against api/openapi.yaml).
import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../packages/client-ts/test/fixtures/meta.json");
copyFileSync(src, path.join(here, "meta.json"));
console.log("wrote tests/fixtures/meta.json (byte copy)");
```

```ts
// web/tests/fixtures/meta.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { components } from "@solvent/client";

type Schemas = components["schemas"];
const here = path.dirname(fileURLToPath(import.meta.url));

/** /v1/meta — the contract-validated client fixture, byte-copied by generate-overview.mjs. */
export const META: Schemas["MetaResponse"] = JSON.parse(readFileSync(path.join(here, "meta.json"), "utf8")) as Schemas["MetaResponse"];
```

Run: `node tests/fixtures/generate-overview.mjs` → `meta.json` appears.

- [ ] **Step 2: Write the weld spec (failing)**

```ts
// web/tests/unit/demo-fixture-weld.spec.ts
import { expect, test } from "@playwright/test";
import { liquidatableRows, nearCapRows, readCashRow, sumDebt, type CashWireRow } from "../../lib/cash-rows";
import { partitionByMateriality } from "../../lib/materiality";
import { DEMO_BATCH_ID, DEMO_BOOK, DEMO_META, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";

const pages = [DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2];
const wire = pages.flatMap((p) => p.positions) as unknown as CashWireRow[];
const rows = wire.map(readCashRow);
const cash = DEMO_BOOK.engines.find((e) => e.engine === "debt_manager");
const cashBadDebt = DEMO_BOOK.bad_debt.find((e) => e.engine === "debt_manager");
if (cash === undefined || cashBadDebt === undefined) throw new Error("demo book must carry the Cash engine");

test("pages chain and cover the population", () => {
  expect(DEMO_POSITIONS_DM_PAGE_1.next_cursor).not.toBeNull();
  expect(DEMO_POSITIONS_DM_PAGE_2.next_cursor).toBeNull();
  expect(wire.length).toBe(1412);
  expect(DEMO_POSITIONS_DM_PAGE_1.total_positions).toBe(1412);
  expect(cash.positions).toBe(1412);
  for (const p of pages) expect(p.batch.id).toBe(DEMO_BATCH_ID);
  expect(DEMO_BOOK.batch.id).toBe(DEMO_BATCH_ID);
  expect(DEMO_META.batch?.id).toBe(DEMO_BATCH_ID);
});

test("every row carries the canonical row's keys", () => {
  const template = Object.keys(DEMO_POSITIONS_DM_PAGE_1.positions[0] ?? {}).sort();
  for (const row of wire) expect(Object.keys(row).sort()).toEqual(template);
});

test("the engine aggregates reconcile to the rows", () => {
  const computed = rows.filter((r) => r.computed);
  expect(computed.length).toBe(cash.computed_positions);
  expect(rows.length - computed.length).toBe(cash.refused_positions);
  expect(cash.refused_positions).toBe(6);
  expect(sumDebt(computed.map((r) => ({ debt: r.debt ?? 0n })))).toBe(BigInt(cash.total_debt ?? "0"));
  const liq = liquidatableRows(rows);
  expect(liq.length).toBe(cash.liquidatable_positions);
  expect(liq.length).toBe(cashBadDebt.eligible_positions);
  expect(sumDebt(liq)).toBe(BigInt(cashBadDebt.eligible_debt_usd ?? "0"));
});

test("materiality and near-cap proportions are the designed ones", () => {
  const p = partitionByMateriality(liquidatableRows(rows), 6);
  expect(p.counts).toEqual({ material: 2, small: 4, dust: 43, belowLine: 47 });
  expect(nearCapRows(rows).length).toBe(27);
});

test("rows are served least room first, breached before everything", () => {
  const tenths = rows.filter((r) => r.roomTenths !== null).map((r) => r.roomTenths as bigint);
  for (let i = 1; i < tenths.length; i += 1) expect(tenths[i]! >= tenths[i - 1]!).toBe(true);
});
```

Run: `npx playwright test --project=unit tests/unit/demo-fixture-weld.spec.ts`
Expected: FAIL — `../fixtures/demo` not found.

- [ ] **Step 3: Write the generator**

```js
// web/tests/fixtures/demo/generate-demo.mjs
// Realistic-scale DEMO dataset (spec 2026-09-15 §8) + PROVENANCE.
// Regenerate: node tests/fixtures/demo/generate-demo.mjs (from web/)
//
// Nothing here is hand-shaped wire data:
//   * envelopes (book, positions pages, meta) are the committed contract
//     fixtures book.json / positions-dm-page-1.json / meta.json with ONLY the
//     batch identity and the aggregate fields recomputed from the rows;
//   * every Cash row is positions-dm-page-1.json's canonical COMPUTED row
//     (positions[0]) or REFUSED row (positions[1]) with account, debt, cap
//     and collateral varied by a seeded PRNG; all other fields verbatim;
//   * aggregates are SUMMED from the rows below, so the weld spec
//     (tests/unit/demo-fixture-weld.spec.ts) can prove them.
// Proportions are the design's assumptions (§8) until the hosted API reports
// the real split: 1,412 accounts · 49 liquidatable (2 material, 4 small,
// 43 dust) · 27 near cap · 6 refused · Σ debt ≈ $24.6M.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "..");
const read = (name) => JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));

const BATCH_ID = 18251;
const COMPUTED_AT = "2026-08-08T20:22:08Z";
const SERVED_AT = "2026-08-08T20:22:50Z";
const AGE_SECONDS = 42;
const DEC = 6; // Cash value_decimals
const USD = (dollars) => BigInt(Math.round(dollars * 1e6));

// mulberry32 — deterministic across runs and platforms.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(18251);
const between = (lo, hi) => lo + (hi - lo) * rand();
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
const account = () => `0x${hex(40)}`;

const page1 = read("positions-dm-page-1.json");
const computedTemplate = page1.positions.find((p) => p.status === "computed");
const refusedTemplate = page1.positions.find((p) => p.status === "refused");
if (!computedTemplate || !refusedTemplate) throw new Error("positions-dm-page-1.json must carry one computed and one refused row");

/** A computed Cash row: debt, cap (maxBorrowLT) and collateral in 6-dec USD. cap/debt decide liquidatable. */
function computedRow(debtUsd, roomFraction) {
  const debt = USD(debtUsd);
  const cap = roomFraction >= 0 ? debt + USD(debtUsd * roomFraction) : debt - USD(debtUsd * -roomFraction);
  const collateral = (cap * 100n) / 40n; // cap ≈ 40% of collateral value
  const liquidatable = debt > cap;
  return {
    ...computedTemplate,
    account: account(),
    liquidatable,
    total_collateral: collateral.toString(),
    total_debt: debt.toString(),
    health_factor: { ...computedTemplate.health_factor, wad: null, num: cap.toString(), den: debt.toString(), infinite: false },
    liq_distance: liquidatable
      ? { kind: "breached", scale_factor_num: null, scale_factor_den: null, factor_asset: null, reason: null }
      : { ...computedTemplate.liq_distance, kind: "solved", factor_asset: "weETH" },
  };
}
function refusedRow() {
  return { ...refusedTemplate, account: account(), refusal: { ...refusedTemplate.refusal, code: "SWEEP_NEVER" } };
}

const rows = [];
// 2 material liquidatable, 4 small, 43 dust — room slightly negative.
rows.push(computedRow(4620, -0.04), computedRow(2220, -0.019));
for (let i = 0; i < 4; i += 1) rows.push(computedRow(between(2, 60), -between(0.01, 0.2)));
for (let i = 0; i < 43; i += 1) rows.push(computedRow(between(0.000001, 0.9), -between(0.01, 0.5)));
// 27 near cap: room 0.2%–9.9%, debts $900–$61,300.
for (let i = 0; i < 27; i += 1) rows.push(computedRow(between(900, 61300), between(0.002, 0.099)));
// 6 refused.
for (let i = 0; i < 6; i += 1) rows.push(refusedRow());
// The rest: 1,412 − 82 = 1,330 accounts, room 10%–80%, log-ish debt sizes to land near $24.6M.
for (let i = 0; i < 1330; i += 1) {
  const size = Math.exp(between(Math.log(300), Math.log(120000)));
  rows.push(computedRow(size, between(0.1, 0.8)));
}
// Server ordering for sort=headroom asc: breached first (most negative room), then rising room; refused last.
const roomTenths = (r) => (r.status !== "computed" ? null : ((BigInt(r.health_factor.num) - BigInt(r.health_factor.den)) * 1000n) / BigInt(r.health_factor.num));
rows.sort((a, b) => {
  const x = roomTenths(a);
  const y = roomTenths(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x < y ? -1 : x > y ? 1 : 0;
});

const computed = rows.filter((r) => r.status === "computed");
const liquidatable = computed.filter((r) => r.liquidatable);
const sum = (list, key) => list.reduce((s, r) => s + BigInt(r[key]), 0n);
const totalDebt = sum(computed, "total_debt");
const totalCollateral = sum(computed, "total_collateral");
const eligibleDebt = sum(liquidatable, "total_debt");

// ---- positions pages (envelope from the committed page 1) ----
const batch = { ...page1.batch, id: BATCH_ID, computed_at: COMPUTED_AT, age_seconds: AGE_SECONDS, position_count: 9964, refused_count: 6, flagged_count: 30 };
const envelope = (positions, nextCursor) => ({ ...page1, served_at: SERVED_AT, batch, sort: "headroom", limit: 1000, total_positions: rows.length, positions, next_cursor: nextCursor });
writeFileSync(path.join(here, "positions-dm-demo-page-1.json"), JSON.stringify(envelope(rows.slice(0, 1000), "demo-cursor-2"), null, 2));
writeFileSync(path.join(here, "positions-dm-demo-page-2.json"), JSON.stringify(envelope(rows.slice(1000), null), null, 2));

// ---- book (envelope from the committed book.json; aggregates from the rows) ----
const book = read("book.json");
book.served_at = SERVED_AT;
book.batch = { ...book.batch, ...batch };
book.engines = book.engines.map((e) =>
  e.engine === "debt_manager"
    ? { ...e, positions: rows.length, computed_positions: computed.length, refused_positions: rows.length - computed.length, flagged_positions: 0, liquidatable_positions: liquidatable.length, total_collateral: totalCollateral.toString(), total_debt: totalDebt.toString(), refusals: [{ key: "SWEEP_NEVER", count: rows.length - computed.length }], flags: [] }
    : { ...e, positions: 8552, computed_positions: 8552, refused_positions: 0, flagged_positions: 30, liquidatable_positions: 46, total_collateral: "410000000000000", total_debt: "190000000000000", refusals: [], flags: [{ key: "stale_price", count: 30 }] },
);
book.bad_debt = book.bad_debt.map((b) =>
  b.engine === "debt_manager"
    ? { ...b, current_bad_debt_usd: "239603961", insolvent_positions: 1, eligible_positions: liquidatable.length, eligible_debt_usd: eligibleDebt.toString(), collateral_at_risk_usd: sum(liquidatable, "total_collateral").toString() }
    : { ...b, current_bad_debt_usd: "0", insolvent_positions: 0, eligible_positions: 46, eligible_debt_usd: "4600", collateral_at_risk_usd: "9100" },
);
// Legacy HF histogram: counts only, summing to 8,552, danger concentrated in the low buckets.
const legacyHist = book.hf_histogram.engines.find((e) => e.engine === "aave_v3_etherfi");
if (legacyHist) {
  const counts = [46, 12, 27, 318, 1204, 2890, 4055];
  legacyHist.buckets = legacyHist.buckets.map((bucket, i) => ({ ...bucket, count: counts[i] ?? 0 }));
  if (legacyHist.buckets.reduce((n, b) => n + b.count, 0) !== 8552) throw new Error("legacy histogram must sum to 8552 — adjust counts to the bucket count");
}
// Cash waterfall: the same eth_minus_30 grid, cumulative figures scaled to this book (monotone, so `monotonicity` stays "holds").
const cashCum = [
  { debt: eligibleDebt, acc: liquidatable.length, bad: 239603961n },
  { debt: eligibleDebt + USD(118000), acc: liquidatable.length + 9, bad: USD(1204) },
  { debt: eligibleDebt + USD(312000), acc: liquidatable.length + 27, bad: USD(8410) },
  { debt: eligibleDebt + USD(1280000), acc: liquidatable.length + 118, bad: USD(41020) },
  { debt: eligibleDebt + USD(2900000), acc: liquidatable.length + 252, bad: USD(118300) },
  { debt: eligibleDebt + USD(5100000), acc: liquidatable.length + 463, bad: USD(402000) },
];
book.waterfall.points = book.waterfall.points.map((point, i) => ({
  ...point,
  engines: point.engines.map((e) => {
    if (e.engine !== "debt_manager") return e;
    const c = cashCum[Math.min(i, cashCum.length - 1)];
    const prev = i === 0 ? c : cashCum[Math.min(i - 1, cashCum.length - 1)];
    return { ...e, newly_eligible_accounts: c.acc - (i === 0 ? 0 : prev.acc), cumulative_eligible_accounts: c.acc, cumulative_debt_eligible_usd: c.debt.toString(), cumulative_collateral_at_risk_usd: ((c.debt * 100n) / 40n).toString(), insolvent_if_liquidated_accounts: i === 0 ? 1 : 1 + i * 3, cumulative_bad_debt_usd: c.bad.toString() };
  }),
}));
book.coverage = { ...book.coverage, batch_positions: 9964, in_book: 9958, refused_in_batch: 6 };
writeFileSync(path.join(here, "book.demo.json"), JSON.stringify(book, null, 2));

// ---- meta (envelope from the committed meta.json; batch + real watermark heights) ----
const meta = read("meta.json");
meta.served_at = SERVED_AT;
meta.batch = { ...meta.batch, ...batch };
meta.watermark_vector = meta.watermark_vector.map((w) =>
  w.engine === "aave_v3_etherfi" || w.engine === "aave_param" ? { ...w, last_block: 25714690 } : w.engine === "debt_manager" ? { ...w, last_block: 155323444 } : w,
);
writeFileSync(path.join(here, "meta.demo.json"), JSON.stringify(meta, null, 2));
console.log(`wrote demo dataset: ${String(rows.length)} Cash rows · ${String(liquidatable.length)} liquidatable · Σ debt ${totalDebt.toString()} (6-dec)`);
```

If `book.waterfall.points` has a different length than six, `cashCum` is indexed with `Math.min`, so the generator still runs; the weld spec does not pin the waterfall.

```ts
// web/tests/fixtures/demo/index.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { components } from "@solvent/client";

type Schemas = components["schemas"];
const here = path.dirname(fileURLToPath(import.meta.url));
function load<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(here, name), "utf8")) as T;
}

export const DEMO_BATCH_ID = 18251;
/** GENERATED by generate-demo.mjs — see its provenance header. */
export const DEMO_BOOK: Schemas["BookResponse"] = load("book.demo.json");
export const DEMO_POSITIONS_DM_PAGE_1: Schemas["PositionsResponse"] = load("positions-dm-demo-page-1.json");
export const DEMO_POSITIONS_DM_PAGE_2: Schemas["PositionsResponse"] = load("positions-dm-demo-page-2.json");
export const DEMO_META: Schemas["MetaResponse"] = load("meta.demo.json");
```

Run: `node tests/fixtures/demo/generate-demo.mjs`
Expected: `wrote demo dataset: 1412 Cash rows · 49 liquidatable · …`. If the material/small/dust split in the weld spec does not come out 2/4/43 (a `between` draw landing on a tier boundary), widen the draw ranges in the generator (small: 2–60 dollars is safely inside $1–$100; dust: ≤ $0.9) — never edit the JSON by hand.

- [ ] **Step 4: Run the weld spec**

Run: `npx playwright test --project=unit tests/unit/demo-fixture-weld.spec.ts && npm run typecheck`
Expected: 5 passed; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/fixtures/generate-overview.mjs web/tests/fixtures/meta.ts web/tests/fixtures/meta.json web/tests/fixtures/demo web/tests/unit/demo-fixture-weld.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "test(web): fixtures - /v1/meta byte copy and the generated realistic-scale demo dataset, welded"
```

---

