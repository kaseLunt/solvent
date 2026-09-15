# UI Plan 1 — Kit, Overview, Book · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Console-register component kit, the new Overview front door at `/`, and the rebuilt Cash-first Book page — exactly as mocked in `docs/specs/2026-09-15-ui-mockups/` — with screenshot pins so the build cannot drift from the mockups.

**Architecture:** New pure modules in `web/lib/` (money humanizer, materiality partition, Cash row reading, headline grammar, stress preview) carry all logic and are unit-pinned; a `useCashBook` hook loads `/v1/book` and walks `/v1/positions?engine=debt_manager`; thin components in `web/components/kit/` render the mockups' CSS verbatim; the Overview and Book pages compose from the kit. Old Book components, their page-local pure modules, and the e2e pins that described them are retired with ledger notes.

**Tech Stack:** Next.js 16 App Router (client components for data), TypeScript strict, CSS modules + `tokens.css`, `@solvent/client` as the only data path, Playwright (unit project for pure logic, e2e project against `next start` on :3111), stylelint token gate.

**Spec:** `docs/specs/2026-09-15-ui-product-register-design.md` (§2 supersessions, §3 register/copy grammar, §4 kit, §5.1 Overview, §5.2 Book, §7 tests, §8 demo dataset, §9 process). Mockups: `docs/specs/2026-09-15-ui-mockups/pages-console.html` (Book), `front-door.html` (Overview, option A).

## Global Constraints

- **Materiality line:** material ≥ $100 · small $1–$100 · dust < $1, per account, in the engine's own USD. Headlines and default views read at the material line; sub-line counts and Σ are stated in the dek and behind a toggle. Materiality never changes a verdict's color. Sub-cent values print `<$0.01`, never `$0`.
- **Names:** `debt_manager` → **Cash** (section qualifier "Debt Manager engine · OP Mainnet"); `aave_v3_etherfi` → **Aave v3 market (legacy)**; borrow ceiling → **borrow cap**; headroom → **room**. Wire names appear only in the methodology drawer, on hover, and in evidence.
- **Never summed:** Cash and legacy figures never appear added together on any surface; a test pins that the arithmetic sum of the two engines' debt is absent from the page.
- **Refusals render honestly:** refused/withheld/null values never render as `0`; refused rows and tiles stay visible in the refused register (dashed tile, dimmed row, "Not computed" pill).
- **Type:** no font-size below 12px; every `font-size` is exactly `var(--type-*)` (or a legacy `--t-*`/`--fs-*` token until retired) — stylelint enforces it.
- **Copy is pinned:** the headline/dek strings in spec §3.5 are produced by `lib/book-headline.ts` and asserted verbatim in unit and e2e specs.
- **`web/lib/**` existing files are untouched.** New files are added beside them.
- **Both themes, four widths:** every page renders in dark and light; first viewport at 1440×900 contains the verdict header, tiles, and the top of the grid.
- **Commands run from `web/`:** `npm run typecheck`, `npm run lint`, `npm run lint:css`, `npm run build`, `npx playwright test --project=unit <spec>`, `npx playwright test --project=e2e <spec>`.
- **E2E runs against a PRODUCTION build on :3111.** `playwright.config.ts` reuses an existing server on :3111, so a stale `next start` serves the OLD build. Before any e2e run: `npm run build`, then make sure nothing is listening on 3111 (`netstat -ano | findstr :3111`; stop that PID) so Playwright starts a fresh `npm run start`.
- **Commits:** from the repo root, stage by name, run `python roadmap/tools/scope_gate.py` (must print `scope-gate: OK`), then commit. If the gate reports an expired claim, run `python roadmap/tools/claim.py renew claude-integrator --hours 24` and commit `roadmap/claims/CLAIM-claude-integrator.md` alone first. No `Co-Authored-By` lines.
- **Fixtures are generated, never hand-shaped:** every new fixture file is written by a generator script under `web/tests/fixtures/` whose header records provenance (byte copies of contract fixtures, or rows derived from a canonical row template).

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `web/lib/human-usd.ts` | `humanUsd(bigint, decimals)` — compact money for headlines/tiles, bigint only, truncating |
| `web/lib/materiality.ts` | tier lines, `materialityTier`, `partitionByMateriality`, `belowLineSentence` |
| `web/lib/cash-rows.ts` | `readCashRow` (wire → `CashRow`), `roomBands`, `nearCap`, `roomPercentiles`, `needsAttention` ordering |
| `web/lib/book-headline.ts` | `bookHeadline` — the §3.5 Book templates (material / quiet / refused) |
| `web/lib/stress-preview.ts` | `stressPreviewLines(waterfall, engine)` — one line per shocked grid point |
| `web/lib/refusal-phrasebook.ts` | wire refusal code → plain-cause sentence |
| `web/lib/live-pill.ts` | pure words/tone for the header's live pill |
| `web/lib/cash-book.tsx` | `useCashBook()` — `/v1/book` + full `debt_manager` positions walk, 409 restart, anchored age |
| `web/components/kit/kit.module.css` | the mockups' `.k-*` rules, verbatim, tokens substituted |
| `web/components/kit/{KpiTile,StatusPill,SectionHead,ChartCard,KitTable,SmallToggle,IdentityChips,VerdictHeader,BandBars,LivePill,AppShell}.tsx` | thin renderers over lib models |
| `web/app/overview/{OverviewSurface,Pipeline}.tsx`, `web/app/overview/overview.module.css`, `web/app/overview/copy.ts` | the front door |
| `web/app/book/{NeedsAttention,BookLegacy,StressPreview,BookMethodology}.tsx` | Book sections |
| `web/tests/unit/{human-usd,materiality,cash-rows,book-headline,stress-preview,live-pill,demo-fixture-weld}.spec.ts` | pure pins |
| `web/tests/e2e/{overview,screenshots}.spec.ts` | page-test contract for Overview; screenshot pins |
| `web/tests/fixtures/generate-overview.mjs`, `web/tests/fixtures/meta.json` | byte copy of the client's contract-validated `/v1/meta` fixture |
| `web/tests/fixtures/demo/{generate-demo.mjs,index.ts,book.demo.json,positions-dm-demo-page-1.json,positions-dm-demo-page-2.json}` | realistic-scale dataset (spec §8) |
| `web/scripts/screenshot-pages.mjs` | side-by-side gate: screenshots Overview + Book (mocked) for the visual companion |

**Modified**

| Path | Change |
|---|---|
| `web/app/tokens.css` | add the `--type-*` scale (spec §3.4) |
| `web/stylelint.config.mjs` | gate vocabulary gains `type-(…)` |
| `web/app/layout.tsx` | `AppHeader` → `AppShell` |
| `web/app/page.tsx` | redirect → Overview |
| `web/app/book/BookSurface.tsx`, `web/app/book/book.module.css` | rewritten to the mockup |
| `web/tests/e2e/shell.spec.ts` | nav labels, brand link, per-surface H1 table |
| `web/tests/e2e/book.spec.ts` | rewritten as the Book page-test contract |
| `.superpowers/sdd/progress-ui-overhaul.md` | retirement ledger |

**Deleted (Task 14)** — old Book components and page-local modules under `web/app/book/`, `web/components/{AppHeader,PostureRibbon,Ribbon,Stampline,StatCard}.tsx` + their CSS where no other page imports them, and the e2e/unit specs that pinned them.

---

### Task 1: Type tokens and the stylelint vocabulary

**Files:**
- Modify: `web/app/tokens.css` (after the `--t-stat` line, inside the light `:root` block)
- Modify: `web/stylelint.config.mjs:47-48` (`TYPE_TOKEN_PATTERN`)

**Interfaces:**
- Produces: CSS custom properties `--type-hero 44px`, `--type-h1 30px`, `--type-kpi 26px`, `--type-h2 17px`, `--type-card 15px`, `--type-dek 16px`, `--type-body 14px`, `--type-label 13px`, `--type-small 12.5px`, `--type-floor 12px`, `--type-mono 13px`, `--type-mono-sm 12.5px`, and weights `--w-semibold 600`, `--w-medium 500`. Every later CSS module uses only these.

- [ ] **Step 1: Add the tokens**

In `web/app/tokens.css`, directly after `--t-stat: 21px; /* KPI value */`, insert:

```css
  /* ---- product-register type scale (spec 2026-09-15 §3.4) ----
   * Replaces --t-* for new code; --t-*/--fs-* stay lawful only until the
   * pages that use them are rebuilt. Floor is 12px; nothing below exists. */
  --type-hero: 44px; /* Overview H1 only */
  --type-h1: 30px; /* page verdict headline */
  --type-kpi: 26px; /* KPI tile value */
  --type-h2: 17px; /* section head */
  --type-card: 15px; /* card title */
  --type-dek: 16px; /* verdict dek */
  --type-body: 14px; /* table cells, card text, nav */
  --type-label: 13px; /* tile labels, table headers */
  --type-small: 12.5px; /* chips, sub-labels */
  --type-floor: 12px; /* axis ticks, pills — ABSOLUTE floor */
  --type-mono: 13px; /* addresses, exact values */
  --type-mono-sm: 12.5px; /* small exact values */
  --w-semibold: 600;
  --w-medium: 500;
```

- [ ] **Step 2: Teach the gate the new names**

In `web/stylelint.config.mjs`, replace the `TYPE_TOKEN_PATTERN` constant with:

```js
const TYPE_TOKEN_PATTERN =
  /^var\(--(?:type-(?:hero|h1|kpi|h2|card|dek|body|label|small|floor|mono-sm|mono)|t-(?:display|chapter|section|fighead|body|ui|meta|floor|mono-lg|mono-sm|mono-floor|mono|stat-lg|stat)|fs-(?:h1|h2|lede|body|note|table|mono-sm|mono|caption|label|badge|stat|hf))\)$/;
```

- [ ] **Step 3: Prove the gate still bites**

Create `web/components/kit/_probe.module.css` containing `.x { font-size: var(--type-nope); }`.
Run: `npm run lint:css`
Expected: FAIL naming `_probe.module.css` and `--type-nope`. Delete the probe file.

- [ ] **Step 4: Verify clean**

Run: `npm run lint:css && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/tokens.css web/stylelint.config.mjs
python roadmap/tools/scope_gate.py
git commit -m "feat(web): product-register type tokens - the --type-* scale joins the stylelint vocabulary"
```

---

### Task 2: `humanUsd` — compact money without floats

**Files:**
- Create: `web/lib/human-usd.ts`
- Test: `web/tests/unit/human-usd.spec.ts`

**Interfaces:**
- Produces: `humanUsd(value: bigint, decimals: number): string`. `value` is base units at `decimals` (a wire integer already guarded). Truncates toward zero (never rounds money at risk up). Rules: `0 → "$0"`; `0 < v < $0.01 → "<$0.01"`; `< $1,000 → "$239.60" / "$18"` (cents only when nonzero); `$1,000–$9,999 → "$6,840"`; `$10K–$999K → "$312K"`; `≥ $1M → "$24.6M"` (one decimal, dropped when zero); `≥ $1B → "$1.2B"`; negative → leading `−` (U+2212).
- Also exports `DUST_DISPLAY = "<$0.01"` and `MINUS = "−"`.

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/human-usd.spec.ts
import { expect, test } from "@playwright/test";
import { DUST_DISPLAY, humanUsd } from "../../lib/human-usd";

const d6 = (dollars: string): bigint => BigInt(dollars.replace(".", "").padEnd(dollars.includes(".") ? dollars.length - 1 + 6 - (dollars.length - dollars.indexOf(".") - 1) : dollars.length + 6, "0"));

test.describe("humanUsd — compact money, truncating, bigint only", () => {
  test("zero and dust", () => {
    expect(humanUsd(0n, 6)).toBe("$0");
    expect(humanUsd(1n, 6)).toBe(DUST_DISPLAY); // $0.000001
    expect(humanUsd(9_999n, 6)).toBe(DUST_DISPLAY); // $0.009999
    expect(humanUsd(10_000n, 6)).toBe("$0.01");
  });
  test("under a thousand shows cents only when nonzero", () => {
    expect(humanUsd(239_603_961n, 6)).toBe("$239.60");
    expect(humanUsd(18_000_000n, 6)).toBe("$18");
    expect(humanUsd(4_620_000n, 6)).toBe("$4.62");
    expect(humanUsd(999_999_999n, 6)).toBe("$999.99");
  });
  test("thousands group, no cents", () => {
    expect(humanUsd(6_840_000_000n, 6)).toBe("$6,840");
    expect(humanUsd(4_620_000_000n, 6)).toBe("$4,620");
    expect(humanUsd(9_999_990_000n, 6)).toBe("$9,999");
  });
  test("ten thousand and up in K, million and up in M with one decimal", () => {
    expect(humanUsd(312_400_000_000n, 6)).toBe("$312K");
    expect(humanUsd(24_612_000_000_000n, 6)).toBe("$24.6M");
    expect(humanUsd(1_000_000_000_000n, 6)).toBe("$1M");
    expect(humanUsd(1_280_000_000_000n, 6)).toBe("$1.2M");
    expect(humanUsd(1_250_000_000_000_000n, 6)).toBe("$1.2B");
  });
  test("eight-decimal engines and negatives", () => {
    expect(humanUsd(600_000_000_000n, 8)).toBe("$6,000");
    expect(humanUsd(-184_000_000n, 6)).toBe("−$184");
    expect(humanUsd(-1n, 6)).toBe("−<$0.01");
  });
  test("decimals of zero", () => {
    expect(humanUsd(6840n, 0)).toBe("$6,840");
  });
});
```

Remove the unused `d6` helper before running (it is not needed; the literals above are explicit).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/human-usd.spec.ts`
Expected: FAIL — cannot resolve `../../lib/human-usd`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/human-usd.ts
/**
 * Compact money for headlines and tiles (spec 2026-09-15 §3.3–§3.4).
 * Bigint throughout; TRUNCATES toward zero so a figure "at risk" is never
 * rounded up. Exact strings stay on the exact layer (ExactValue); this is
 * layer 1 only.
 */
export const DUST_DISPLAY = "<$0.01";
export const MINUS = "−";

function groupThousands(whole: bigint): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Scale down by 10^n, truncating. */
function scaleDown(value: bigint, n: number): bigint {
  return n <= 0 ? value * 10n ** BigInt(-n) : value / 10n ** BigInt(n);
}

function oneDecimal(cents: bigint, unitCents: bigint, suffix: string): string {
  const tenths = (cents * 10n) / unitCents; // truncated tenths of the unit
  const whole = tenths / 10n;
  const tenth = tenths % 10n;
  return tenth === 0n ? `$${whole.toString()}${suffix}` : `$${whole.toString()}.${tenth.toString()}${suffix}`;
}

export function humanUsd(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanUsd(-value, decimals)}`;
  if (value === 0n) return "$0";
  const cents = scaleDown(value, decimals - 2);
  if (cents === 0n) return DUST_DISPLAY;
  const dollars = cents / 100n;
  if (dollars >= 1_000_000_000n) return oneDecimal(cents, 100_000_000_000n, "B");
  if (dollars >= 1_000_000n) return oneDecimal(cents, 100_000_000n, "M");
  if (dollars >= 10_000n) return `$${groupThousands(dollars / 1000n)}K`;
  if (dollars >= 1_000n) return `$${groupThousands(dollars)}`;
  const rem = cents % 100n;
  return rem === 0n ? `$${dollars.toString()}` : `$${dollars.toString()}.${rem.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/human-usd.spec.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/human-usd.ts web/tests/unit/human-usd.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): humanUsd - compact, truncating, bigint money for headlines and tiles"
```

---

### Task 3: Materiality partition

**Files:**
- Create: `web/lib/materiality.ts`
- Test: `web/tests/unit/materiality.spec.ts`

**Interfaces:**
- Produces:
  - `MATERIAL_LINE_USD = 100n`, `SMALL_LINE_USD = 1n`
  - `type MaterialityTier = "material" | "small" | "dust"`
  - `materialityTier(debt: bigint, decimals: number): MaterialityTier`
  - `interface Sized { readonly debt: bigint }`
  - `partitionByMateriality<T extends Sized>(rows: readonly T[], decimals: number): { material: T[]; small: T[]; dust: T[]; sums: { material: bigint; small: bigint; dust: bigint; belowLine: bigint }; counts: { material: number; small: number; dust: number; belowLine: number } }`
  - `belowLineSentence(counts: { belowLine: number }, sums: { belowLine: bigint }, decimals: number): string | null` → `"47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined."` (singular: `"1 more position is technically liquidatable but totals $4.62 — below the $100 line and not headlined."`); `null` when the count is 0.

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/materiality.spec.ts
import { expect, test } from "@playwright/test";
import {
  belowLineSentence,
  MATERIAL_LINE_USD,
  materialityTier,
  partitionByMateriality,
} from "../../lib/materiality";

const usd6 = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

test("the lines are $100 and $1, tiers are closed at the top", () => {
  expect(MATERIAL_LINE_USD).toBe(100n);
  expect(materialityTier(usd6(100), 6)).toBe("material");
  expect(materialityTier(usd6(99.999999), 6)).toBe("small");
  expect(materialityTier(usd6(1), 6)).toBe("small");
  expect(materialityTier(usd6(0.999999), 6)).toBe("dust");
  expect(materialityTier(1n, 6)).toBe("dust");
  expect(materialityTier(0n, 6)).toBe("dust");
  expect(materialityTier(100_00000000n, 8)).toBe("material");
});

test("partition keeps every row, sums by tier, and belowLine = small + dust", () => {
  const rows = [
    { account: "a", debt: usd6(4620) },
    { account: "b", debt: usd6(2220) },
    { account: "c", debt: usd6(42.5) },
    { account: "d", debt: usd6(0.31) },
    { account: "e", debt: 4n },
  ];
  const p = partitionByMateriality(rows, 6);
  expect(p.material.map((r) => r.account)).toEqual(["a", "b"]);
  expect(p.small.map((r) => r.account)).toEqual(["c"]);
  expect(p.dust.map((r) => r.account)).toEqual(["d", "e"]);
  expect(p.sums.material).toBe(usd6(6840));
  expect(p.sums.small).toBe(usd6(42.5));
  expect(p.sums.dust).toBe(usd6(0.31) + 4n);
  expect(p.sums.belowLine).toBe(p.sums.small + p.sums.dust);
  expect(p.counts).toEqual({ material: 2, small: 1, dust: 2, belowLine: 3 });
});

test("the below-line sentence, plural and singular, and absent at zero", () => {
  expect(belowLineSentence({ belowLine: 47 }, { belowLine: usd6(112.4) }, 6)).toBe(
    "47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 1 }, { belowLine: usd6(4.62) }, 6)).toBe(
    "1 more position is technically liquidatable but totals $4.62 — below the $100 line and not headlined.",
  );
  expect(belowLineSentence({ belowLine: 0 }, { belowLine: 0n }, 6)).toBeNull();
});

test("dust that is sub-cent still prints as <$0.01 in the sentence", () => {
  expect(belowLineSentence({ belowLine: 46 }, { belowLine: 46n }, 8)).toBe(
    "46 more positions are technically liquidatable but total <$0.01 — below the $100 line and not headlined.",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/materiality.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/materiality.ts
import { humanUsd } from "./human-usd";

/** Whole dollars. A DISPLAY rule (spec 2026-09-15 §3.3): counts and Σ always exist in full. */
export const MATERIAL_LINE_USD = 100n;
export const SMALL_LINE_USD = 1n;

export type MaterialityTier = "material" | "small" | "dust";

export interface Sized {
  readonly debt: bigint;
}

function lineInBaseUnits(lineUsd: bigint, decimals: number): bigint {
  return lineUsd * 10n ** BigInt(decimals);
}

export function materialityTier(debt: bigint, decimals: number): MaterialityTier {
  if (debt >= lineInBaseUnits(MATERIAL_LINE_USD, decimals)) return "material";
  if (debt >= lineInBaseUnits(SMALL_LINE_USD, decimals)) return "small";
  return "dust";
}

export interface MaterialityPartition<T extends Sized> {
  readonly material: T[];
  readonly small: T[];
  readonly dust: T[];
  readonly sums: { material: bigint; small: bigint; dust: bigint; belowLine: bigint };
  readonly counts: { material: number; small: number; dust: number; belowLine: number };
}

export function partitionByMateriality<T extends Sized>(
  rows: readonly T[],
  decimals: number,
): MaterialityPartition<T> {
  const material: T[] = [];
  const small: T[] = [];
  const dust: T[] = [];
  let sMaterial = 0n;
  let sSmall = 0n;
  let sDust = 0n;
  for (const row of rows) {
    const tier = materialityTier(row.debt, decimals);
    if (tier === "material") {
      material.push(row);
      sMaterial += row.debt;
    } else if (tier === "small") {
      small.push(row);
      sSmall += row.debt;
    } else {
      dust.push(row);
      sDust += row.debt;
    }
  }
  return {
    material,
    small,
    dust,
    sums: { material: sMaterial, small: sSmall, dust: sDust, belowLine: sSmall + sDust },
    counts: {
      material: material.length,
      small: small.length,
      dust: dust.length,
      belowLine: small.length + dust.length,
    },
  };
}

export function belowLineSentence(
  counts: { readonly belowLine: number },
  sums: { readonly belowLine: bigint },
  decimals: number,
): string | null {
  const n = counts.belowLine;
  if (n === 0) return null;
  const one = n === 1;
  return `${String(n)} more position${one ? "" : "s"} ${one ? "is" : "are"} technically liquidatable but total${one ? "s" : ""} ${humanUsd(sums.belowLine, decimals)} — below the $${MATERIAL_LINE_USD.toString()} line and not headlined.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/materiality.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/materiality.ts web/tests/unit/materiality.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): materiality partition - the \$100 line as a display rule with full counts kept"
```

---

### Task 4: Cash rows — reading a `debt_manager` position into room, band, and verdict

**Files:**
- Create: `web/lib/cash-rows.ts`
- Test: `web/tests/unit/cash-rows.spec.ts`
- Read (do not modify): `web/lib/headroom.ts` (`headroomBand`, `headroomPercent`, `headroomTenths`, `HEADROOM_BANDS`), `web/lib/wireGuard.ts` (`isWireDecimal`)

**Interfaces:**
- Consumes: a positions-page row as `@solvent/client` serves it — `Schemas["PositionSummary"]` refined: `{ engine, account, status, value_decimals, refusal: { code, detail? } | null, health_factor: { wad, num, den, infinite, note } | null, liquidation_verdict: "liquidatable" | "not-liquidatable" | "unknowable", total_collateral: string | null, total_debt: string | null }`. For Cash, `health_factor.num` is the borrow cap (maxBorrowLT) and `health_factor.den` the borrowings, both decimal-integer strings at `value_decimals`.
- Produces:
  - `interface CashRow { account; decimals; debt: bigint | null; collateral: bigint | null; cap: bigint | null; room: bigint | null; roomPercent: string | null; roomTenths: bigint | null; band: number | null; verdict; refusal: { code; detail: string | null } | null; computed: boolean }` — `band` indexes `HEADROOM_BANDS` (0 breached · 1 "0–2%" · 2 "2–5%" · 3 "5–10%" · 4 "10–25%" · 5 "25–50%" · 6 "≥50%").
  - `readCashRow(row): CashRow` — refused or malformed integers yield `null` fields and `computed: false`; never throws.
  - `liquidatableRows(rows): SizedCashRow[]` — verdict `liquidatable` with a readable debt.
  - `nearCapRows(rows): SizedCashRow[]` — computed, not liquidatable, band ∈ {1,2,3} (room < 10%), sorted by `roomTenths` ascending.
  - `roomBands(rows): RoomBand[]` — one entry per `HEADROOM_BANDS` entry in order: `{ id, label, count, debt }`, computed rows only.
  - `roomPercentiles(rows): { median: string | null; p10: string | null }` — lower-median over computed rows' `roomTenths`, formatted like `headroomPercent`.
  - `sumDebt(rows: readonly { debt: bigint }[]): bigint`.

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/cash-rows.spec.ts
import { expect, test } from "@playwright/test";
import {
  liquidatableRows,
  nearCapRows,
  readCashRow,
  roomBands,
  roomPercentiles,
  sumDebt,
  type CashWireRow,
} from "../../lib/cash-rows";

function row(over: Partial<CashWireRow> & { account: string }): CashWireRow {
  return {
    engine: "debt_manager",
    status: "computed",
    value_decimals: 6,
    refusal: null,
    flags: [],
    health_factor: { wad: null, num: "4804000000", den: "4620000000", infinite: false, note: "" },
    liquidation_verdict: "not-liquidatable",
    total_collateral: "12050000000",
    total_debt: "4620000000",
    liq_distance: { kind: "solved", scale_factor_num: "1", scale_factor_den: "1", factor_asset: "weETH", reason: null },
    balances_block: 1,
    params_block: 1,
    sweep_block: 1,
    ...over,
  } as CashWireRow;
}

test("a computed Cash row: room = cap − debt, percent and band from headroom.ts", () => {
  const r = readCashRow(row({ account: "0xa" }));
  expect(r.computed).toBe(true);
  expect(r.debt).toBe(4_620_000_000n);
  expect(r.cap).toBe(4_804_000_000n);
  expect(r.room).toBe(184_000_000n);
  expect(r.roomPercent).toBe("3.8%");
  expect(r.band).toBe(2); // 2–5%
  expect(r.verdict).toBe("not-liquidatable");
});

test("a liquidatable row has negative room and the breached band", () => {
  const r = readCashRow(
    row({
      account: "0xb",
      liquidation_verdict: "liquidatable",
      health_factor: { wad: null, num: "3200000000", den: "4200000000", infinite: false, note: "" },
      total_debt: "4200000000",
    }),
  );
  expect(r.room).toBe(-1_000_000_000n);
  expect(r.band).toBe(0);
  expect(r.roomPercent).toBe("−31.2%");
});

test("a refused row reads as not computed with null figures — never zero", () => {
  const r = readCashRow(
    row({
      account: "0xc",
      status: "refused",
      refusal: { code: "SWEEP_NEVER", detail: "the sweep never ran" },
      health_factor: null,
      total_debt: null,
      total_collateral: null,
      liquidation_verdict: "unknowable",
    }),
  );
  expect(r.computed).toBe(false);
  expect(r.debt).toBeNull();
  expect(r.room).toBeNull();
  expect(r.band).toBeNull();
  expect(r.refusal).toEqual({ code: "SWEEP_NEVER", detail: "the sweep never ran" });
});

test("a malformed wire integer is refused, not coerced", () => {
  const r = readCashRow(row({ account: "0xd", total_debt: "-0" }));
  expect(r.computed).toBe(false);
  expect(r.debt).toBeNull();
});

test("selectors: liquidatable, near cap (<10%, sorted by room), bands, percentiles, sums", () => {
  const cap = (num: string, den: string) => ({ wad: null, num, den, infinite: false, note: "" });
  const rows = [
    readCashRow(row({ account: "0xliq", liquidation_verdict: "liquidatable", health_factor: cap("3200000000", "4200000000"), total_debt: "4200000000" })),
    readCashRow(row({ account: "0xnear1" })), // 3.8%
    readCashRow(row({ account: "0xnear2", health_factor: cap("10000000000", "9100000000"), total_debt: "9100000000" })), // 9%
    readCashRow(row({ account: "0xfar", health_factor: cap("10000000000", "5000000000"), total_debt: "5000000000" })), // 50%
    readCashRow(row({ account: "0xref", status: "refused", refusal: { code: "SWEEP_NEVER", detail: null }, health_factor: null, total_debt: null, liquidation_verdict: "unknowable" })),
  ];
  expect(liquidatableRows(rows).map((r) => r.account)).toEqual(["0xliq"]);
  expect(nearCapRows(rows).map((r) => r.account)).toEqual(["0xnear1", "0xnear2"]);
  expect(sumDebt(nearCapRows(rows))).toBe(4_620_000_000n + 9_100_000_000n);
  const bands = roomBands(rows);
  expect(bands.map((b) => b.id)).toEqual(["breached", "0-2", "2-5", "5-10", "10-25", "25-50", "50-plus"]);
  expect(bands[0]).toMatchObject({ count: 1, debt: 4_200_000_000n });
  expect(bands[2]).toMatchObject({ count: 1, debt: 4_620_000_000n });
  expect(bands[3]).toMatchObject({ count: 1, debt: 9_100_000_000n });
  expect(bands[6]).toMatchObject({ count: 1, debt: 5_000_000_000n });
  expect(bands.reduce((n, b) => n + b.count, 0)).toBe(4); // the refused row is in no band
  // computed rows' room tenths sorted: −312, 38, 90, 500 → lower median 38 → "3.8%"; p10 → "−31.2%"
  expect(roomPercentiles(rows)).toEqual({ median: "3.8%", p10: "−31.2%" });
  expect(roomPercentiles([rows[4]!])).toEqual({ median: null, p10: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/cash-rows.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/cash-rows.ts
import type { components } from "@solvent/client";
import { HEADROOM_BANDS, headroomBand, headroomPercent, headroomTenths } from "./headroom";
import { isWireDecimal } from "./wireGuard";

type Schemas = components["schemas"];
type Verdict = "liquidatable" | "not-liquidatable" | "unknowable";

/** The refined positions-page row as @solvent/client serves it. */
export type CashWireRow = Omit<Schemas["PositionSummary"], "liquidatable"> & {
  liquidation_verdict: Verdict;
};

export interface CashRow {
  readonly account: string;
  readonly decimals: number;
  readonly debt: bigint | null;
  readonly collateral: bigint | null;
  readonly cap: bigint | null;
  readonly room: bigint | null;
  readonly roomPercent: string | null;
  readonly roomTenths: bigint | null;
  /** Index into HEADROOM_BANDS; null when not computable. */
  readonly band: number | null;
  readonly verdict: Verdict;
  readonly refusal: { code: string; detail: string | null } | null;
  readonly computed: boolean;
}

function wireInt(value: string | null | undefined): bigint | null {
  if (typeof value !== "string" || !isWireDecimal(value)) return null;
  return BigInt(value);
}

export function readCashRow(row: CashWireRow): CashRow {
  const refusal =
    row.refusal === null || row.refusal === undefined
      ? null
      : { code: row.refusal.code, detail: row.refusal.detail ?? null };
  const debt = wireInt(row.total_debt);
  const collateral = wireInt(row.total_collateral);
  const cap = row.health_factor === null ? null : wireInt(row.health_factor.num);
  const borrowings = row.health_factor === null ? null : wireInt(row.health_factor.den);
  const computed =
    row.status === "computed" && refusal === null && debt !== null && cap !== null && borrowings !== null;
  if (!computed || debt === null || cap === null || borrowings === null) {
    return {
      account: row.account, decimals: row.value_decimals, debt: null, collateral, cap: null, room: null,
      roomPercent: null, roomTenths: null, band: null, verdict: row.liquidation_verdict, refusal, computed: false,
    };
  }
  return {
    account: row.account,
    decimals: row.value_decimals,
    debt,
    collateral,
    cap,
    room: cap - borrowings,
    roomPercent: headroomPercent(cap, borrowings),
    roomTenths: headroomTenths(cap, borrowings),
    band: headroomBand(cap, borrowings),
    verdict: row.liquidation_verdict,
    refusal,
    computed: true,
  };
}

export type SizedCashRow = CashRow & { readonly debt: bigint };

function withDebt(rows: readonly CashRow[]): SizedCashRow[] {
  return rows.filter((r): r is SizedCashRow => r.debt !== null);
}

export function liquidatableRows(rows: readonly CashRow[]): SizedCashRow[] {
  return withDebt(rows).filter((r) => r.verdict === "liquidatable");
}

const NEAR_CAP_BANDS: ReadonlySet<number> = new Set([1, 2, 3]);

function byRoom(a: CashRow, b: CashRow): number {
  const x = a.roomTenths ?? 0n;
  const y = b.roomTenths ?? 0n;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function nearCapRows(rows: readonly CashRow[]): SizedCashRow[] {
  return withDebt(rows)
    .filter((r) => r.computed && r.verdict !== "liquidatable" && r.band !== null && NEAR_CAP_BANDS.has(r.band))
    .sort(byRoom);
}

export interface RoomBand {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly debt: bigint;
}

export function roomBands(rows: readonly CashRow[]): RoomBand[] {
  const out: RoomBand[] = HEADROOM_BANDS.map((band) => ({ id: band.id, label: band.label, count: 0, debt: 0n }));
  for (const r of rows) {
    if (!r.computed || r.band === null || r.debt === null) continue;
    const slot = out[r.band];
    if (slot === undefined) continue;
    out[r.band] = { ...slot, count: slot.count + 1, debt: slot.debt + r.debt };
  }
  return out;
}

function formatTenths(tenths: bigint): string {
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  const body = tenth === 0n ? whole.toString() : `${whole.toString()}.${tenth.toString()}`;
  return `${negative ? "−" : ""}${body}%`;
}

/** Lower median / lower 10th percentile over computed rows. */
export function roomPercentiles(rows: readonly CashRow[]): { median: string | null; p10: string | null } {
  const tenths = rows
    .map((r) => r.roomTenths)
    .filter((t): t is bigint => t !== null)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const first = tenths[0];
  if (first === undefined) return { median: null, p10: null };
  const at = (fraction: number): bigint => tenths[Math.floor((tenths.length - 1) * fraction)] ?? first;
  return { median: formatTenths(at(0.5)), p10: formatTenths(at(0.1)) };
}

export function sumDebt(rows: readonly { readonly debt: bigint }[]): bigint {
  return rows.reduce((sum, r) => sum + r.debt, 0n);
}
```

If `Schemas["PositionSummary"]` is not the generated schema's name, find it with `grep -n "PositionSummary" ../packages/client-ts/src/generated/schema.ts` and use that name. If the refusal object has no `detail` field, drop the `?? null` on that line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/cash-rows.spec.ts && npm run typecheck`
Expected: 5 passed; typecheck exit 0. If `headroomBand` numbers the breached band differently, read `HEADROOM_BREACHED_BAND` in `web/lib/headroom.ts` and align the test's `band` expectations — the library is the authority.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/cash-rows.ts web/tests/unit/cash-rows.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): cash rows - room, band, verdict and selectors read from the wire without coercion"
```

---

### Task 5: The Book headline grammar

**Files:**
- Create: `web/lib/book-headline.ts`
- Test: `web/tests/unit/book-headline.spec.ts`

**Interfaces:**
- Consumes: `humanUsd` (Task 2), `belowLineSentence` (Task 3).
- Produces:
  - `interface Sum { sum: bigint; count: number }`
  - `interface BookHeadlineInput { decimals: number; material: Sum; belowLine: Sum; nearCap: Sum; notComputed: number }`
  - `interface Headline { variant: "material" | "quiet" | "refused"; tone: "crit" | "ok" | "refused"; emphasis: string; rest: string; dek: string }`
  - `bookHeadline(input): Headline`; `bookHeadlineRefused(cause: string): Headline`
  - `nearCapSentence(nearCap: Sum, decimals): string`; `notComputedSentence(n): string | null` (reused by the Overview strip)

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/book-headline.spec.ts
import { expect, test } from "@playwright/test";
import { bookHeadline, bookHeadlineRefused } from "../../lib/book-headline";

const usd6 = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

test("material: money first, the emphasized phrase carries the verdict", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(6840), count: 2 },
    belowLine: { sum: usd6(112.4), count: 47 },
    nearCap: { sum: usd6(312_400), count: 27 },
    notComputed: 6,
  });
  expect(h.variant).toBe("material");
  expect(h.tone).toBe("crit");
  expect(h.emphasis).toBe("$6,840 of Cash debt is liquidatable right now,");
  expect(h.rest).toBe(" across 2 accounts.");
  expect(h.dek).toBe(
    "47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined. " +
      "27 accounts are within 10% of their borrow cap, carrying $312K. " +
      "6 positions could not be computed this batch and are counted, not hidden.",
  );
});

test("material, singular everywhere", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(4200), count: 1 },
    belowLine: { sum: 0n, count: 0 },
    nearCap: { sum: 0n, count: 0 },
    notComputed: 1,
  });
  expect(h.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(h.rest).toBe(" across 1 account.");
  expect(h.dek).toBe(
    "No account is within 10% of its borrow cap. 1 position could not be computed this batch and is counted, not hidden.",
  );
});

test("quiet: nothing material — the dek leads with the below-line count", () => {
  const h = bookHeadline({
    decimals: 8,
    material: { sum: 0n, count: 0 },
    belowLine: { sum: 46n, count: 46 },
    nearCap: { sum: 0n, count: 0 },
    notComputed: 0,
  });
  expect(h.variant).toBe("quiet");
  expect(h.tone).toBe("ok");
  expect(h.emphasis).toBe("Nothing material is liquidatable on the Cash book right now.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe(
    "46 more positions are technically liquidatable but total <$0.01 — below the $100 line and not headlined. No account is within 10% of its borrow cap.",
  );
});

test("quiet with nothing liquidatable at all", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: 0n, count: 0 },
    belowLine: { sum: 0n, count: 0 },
    nearCap: { sum: usd6(11_200), count: 3 },
    notComputed: 0,
  });
  expect(h.dek).toBe("No position is liquidatable. 3 accounts are within 10% of their borrow cap, carrying $11K.");
});

test("refused: the whole engine withheld", () => {
  const h = bookHeadlineRefused("collateral-flag custody is unproven for this window");
  expect(h.variant).toBe("refused");
  expect(h.tone).toBe("refused");
  expect(h.emphasis).toBe("The Cash book could not be computed this batch.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe("Collateral-flag custody is unproven for this window.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/book-headline.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/book-headline.ts
import { humanUsd } from "./human-usd";
import { belowLineSentence } from "./materiality";

export interface Sum {
  readonly sum: bigint;
  readonly count: number;
}

export interface BookHeadlineInput {
  readonly decimals: number;
  readonly material: Sum;
  readonly belowLine: Sum;
  readonly nearCap: Sum;
  readonly notComputed: number;
}

export interface Headline {
  readonly variant: "material" | "quiet" | "refused";
  readonly tone: "crit" | "ok" | "refused";
  readonly emphasis: string;
  readonly rest: string;
  readonly dek: string;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

export function nearCapSentence(nearCap: Sum, decimals: number): string {
  if (nearCap.count === 0) return "No account is within 10% of its borrow cap.";
  const one = nearCap.count === 1;
  return `${plural(nearCap.count, "account")} ${one ? "is" : "are"} within 10% of ${one ? "its" : "their"} borrow cap, carrying ${humanUsd(nearCap.sum, decimals)}.`;
}

export function notComputedSentence(n: number): string | null {
  if (n === 0) return null;
  const one = n === 1;
  return `${plural(n, "position")} could not be computed this batch and ${one ? "is" : "are"} counted, not hidden.`;
}

function joinSentences(parts: readonly (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(" ");
}

export function bookHeadline(input: BookHeadlineInput): Headline {
  const below = belowLineSentence({ belowLine: input.belowLine.count }, { belowLine: input.belowLine.sum }, input.decimals);
  const near = nearCapSentence(input.nearCap, input.decimals);
  const notComputed = notComputedSentence(input.notComputed);
  if (input.material.count > 0) {
    return {
      variant: "material",
      tone: "crit",
      emphasis: `${humanUsd(input.material.sum, input.decimals)} of Cash debt is liquidatable right now,`,
      rest: ` across ${plural(input.material.count, "account")}.`,
      dek: joinSentences([below, near, notComputed]),
    };
  }
  return {
    variant: "quiet",
    tone: "ok",
    emphasis: "Nothing material is liquidatable on the Cash book right now.",
    rest: "",
    dek: joinSentences([below ?? "No position is liquidatable.", near, notComputed]),
  };
}

export function bookHeadlineRefused(cause: string): Headline {
  const trimmed = cause.trim();
  const first = trimmed.charAt(0).toUpperCase();
  const sentence =
    trimmed.length === 0 ? "The engine gave no reason." : `${first}${trimmed.slice(1)}${trimmed.endsWith(".") ? "" : "."}`;
  return { variant: "refused", tone: "refused", emphasis: "The Cash book could not be computed this batch.", rest: "", dek: sentence };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/book-headline.spec.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/book-headline.ts web/tests/unit/book-headline.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): book headline grammar - material, quiet and refused variants pinned verbatim"
```

---

### Task 6: Three small pure modules — stress preview, refusal phrasebook, live-pill words

**Files:**
- Create: `web/lib/stress-preview.ts`, `web/lib/refusal-phrasebook.ts`, `web/lib/live-pill.ts`
- Test: `web/tests/unit/stress-preview.spec.ts`, `web/tests/unit/refusal-phrasebook.spec.ts`, `web/tests/unit/live-pill.spec.ts`
- Read: `web/tests/fixtures/book.ts` (`BOOK`), `web/lib/freshness.ts` (`humanAge`), `web/lib/freshnessTiers.ts` (`FreshnessTier`)

**Interfaces:**
- `stressPreview(waterfall: Schemas["Waterfall"], engine: string): StressPreview` where `StressPreview = { kind: "absent" } | { kind: "refused"; reason: string } | { kind: "view"; scenarioId: string; lines: StressLine[] }` and `StressLine = { shock: string; deltaDebt: bigint; deltaAccounts: number; badDebt: bigint; decimals: number; text: string }`. `shock` is `"ETH −10%"` (axis word + signed percent from `factor / grid_scale`). `text` is `"ETH −10% → +$6,000 liquidatable · 1 account · bad debt $0"` or `"ETH −10% → no new liquidatable debt · bad debt $635.64"`.
- `plainCause(code: string, detail?: string | null): string`.
- `livePillWords(input: { streamState: "idle" | "connecting" | "open" | "waiting" | "closed"; hasBase: boolean; batchId: number | null; ageSeconds: number | null; tier: FreshnessTier | null }): { word: "Live" | "Reconnecting" | "Not connected"; tone: "ok" | "warn" | "dim"; batch: string | null; age: string | null; ageTone: "ok" | "warn" | "crit" | "dim" }`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/stress-preview.spec.ts
import { expect, test } from "@playwright/test";
import { stressPreview } from "../../lib/stress-preview";
import { BOOK } from "../fixtures/book";

test("the committed book fixture previews one line per shocked grid point, per engine", () => {
  const aave = stressPreview(BOOK.waterfall, "aave_v3_etherfi");
  expect(aave.kind).toBe("view");
  if (aave.kind !== "view") return;
  expect(aave.scenarioId).toBe("eth_minus_30");
  expect(aave.lines.map((l) => l.shock)).toEqual(["ETH −10%", "ETH −20%", "ETH −30%", "ETH −40%", "ETH −50%"]);
  expect(aave.lines[0]?.text).toBe("ETH −10% → +$6,000 liquidatable · 1 account · bad debt $0");
  expect(aave.lines[0]?.deltaDebt).toBe(600_000_000_000n);
  expect(aave.lines[0]?.deltaAccounts).toBe(1);

  const dm = stressPreview(BOOK.waterfall, "debt_manager");
  expect(dm.kind).toBe("view");
  if (dm.kind !== "view") return;
  expect(dm.lines[0]?.text).toBe("ETH −10% → no new liquidatable debt · bad debt $635.64");
  expect(dm.lines[0]?.deltaDebt).toBe(0n);
});

test("an engine absent from the grid is absent, never a zero line", () => {
  expect(stressPreview(BOOK.waterfall, "nobody")).toEqual({ kind: "absent" });
});

test("a malformed cumulative figure refuses the whole preview", () => {
  const broken = structuredClone(BOOK.waterfall);
  const at = broken.points[1]?.engines.find((e) => e.engine === "debt_manager");
  if (at === undefined) throw new Error("fixture invariant");
  at.cumulative_debt_eligible_usd = "-0";
  const out = stressPreview(broken, "debt_manager");
  expect(out.kind).toBe("refused");
});
```

```ts
// web/tests/unit/refusal-phrasebook.spec.ts
import { expect, test } from "@playwright/test";
import { plainCause } from "../../lib/refusal-phrasebook";

test("known codes lead with a plain cause; unknown codes fall back to the detail, then the code", () => {
  expect(plainCause("SWEEP_NEVER")).toBe("collateral sweep never ran");
  expect(plainCause("FLAG_CUSTODY_UNPROVEN")).toBe("collateral-flag custody unproven");
  expect(plainCause("G1", "gate G1: no fresh price for weETH")).toBe("gate G1: no fresh price for weETH");
  expect(plainCause("G1")).toBe("refused (G1)");
  expect(plainCause("SWEEP_NEVER", "ignored — the phrasebook wins for known codes")).toBe("collateral sweep never ran");
});
```

```ts
// web/tests/unit/live-pill.spec.ts
import { expect, test } from "@playwright/test";
import { livePillWords } from "../../lib/live-pill";

test("stream words", () => {
  expect(livePillWords({ streamState: "open", hasBase: true, batchId: 18251, ageSeconds: 42, tier: "fresh" })).toEqual({
    word: "Live", tone: "ok", batch: "batch 18,251", age: "42s ago", ageTone: "ok",
  });
  expect(livePillWords({ streamState: "open", hasBase: false, batchId: null, ageSeconds: null, tier: null }).word).toBe("Reconnecting");
  expect(livePillWords({ streamState: "waiting", hasBase: true, batchId: 1, ageSeconds: 5, tier: "fresh" }).word).toBe("Reconnecting");
  expect(livePillWords({ streamState: "closed", hasBase: false, batchId: null, ageSeconds: null, tier: null })).toEqual({
    word: "Not connected", tone: "dim", batch: null, age: null, ageTone: "dim",
  });
});

test("age tone follows the ratified tiers; an unknown age is dim, never a tier color", () => {
  const base = { streamState: "open" as const, hasBase: true, batchId: 7 };
  expect(livePillWords({ ...base, ageSeconds: 200, tier: "aging" }).ageTone).toBe("warn");
  expect(livePillWords({ ...base, ageSeconds: 4000, tier: "stale" }).ageTone).toBe("crit");
  expect(livePillWords({ ...base, ageSeconds: 9000, tier: "critical" }).ageTone).toBe("crit");
  expect(livePillWords({ ...base, ageSeconds: 9000, tier: "critical" }).age).toBe("2h 30m ago");
  expect(livePillWords({ ...base, ageSeconds: null, tier: null })).toMatchObject({ age: null, ageTone: "dim", batch: "batch 7" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test --project=unit tests/unit/stress-preview.spec.ts tests/unit/refusal-phrasebook.spec.ts tests/unit/live-pill.spec.ts`
Expected: all FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// web/lib/stress-preview.ts
import type { components } from "@solvent/client";
import { humanUsd } from "./human-usd";
import { isWireDecimal } from "./wireGuard";

type Schemas = components["schemas"];
type Waterfall = Schemas["Waterfall"];

export interface StressLine {
  readonly shock: string;
  readonly deltaDebt: bigint;
  readonly deltaAccounts: number;
  readonly badDebt: bigint;
  readonly decimals: number;
  readonly text: string;
}

export type StressPreview =
  | { kind: "absent" }
  | { kind: "refused"; reason: string }
  | { kind: "view"; scenarioId: string; lines: StressLine[] };

const AXIS_WORD: Record<string, string> = { eth_usd: "ETH", weeth_usd: "weETH", ethfi_usd: "ETHFI" };

function axisWord(axis: string): string {
  return AXIS_WORD[axis] ?? axis.split("_")[0]?.toUpperCase() ?? axis;
}

/** Signed whole percent of the shock, truncated: factor 0.9e18 over 1e18 → "−10%". */
function shockPercent(factor: bigint, scale: bigint): string {
  const pct = ((factor - scale) * 100n) / scale;
  return pct < 0n ? `−${(-pct).toString()}%` : `+${pct.toString()}%`;
}

export function stressPreview(waterfall: Waterfall, engine: string): StressPreview {
  const points = waterfall.points
    .map((p) => ({ factor: p.factor, at: p.engines.find((e) => e.engine === engine) }))
    .filter((p): p is { factor: string; at: NonNullable<typeof p.at> } => p.at !== undefined);
  const base = points[0];
  if (base === undefined) return { kind: "absent" };
  if (!isWireDecimal(waterfall.grid_scale)) return { kind: "refused", reason: "grid_scale is not a wire decimal" };
  const scale = BigInt(waterfall.grid_scale);
  if (scale <= 0n) return { kind: "refused", reason: "grid_scale must be positive" };
  const fields = ["cumulative_debt_eligible_usd", "cumulative_bad_debt_usd"] as const;
  for (const p of points) {
    if (!isWireDecimal(p.factor)) return { kind: "refused", reason: "a grid factor is not a wire decimal" };
    for (const f of fields) {
      if (!isWireDecimal(p.at[f])) return { kind: "refused", reason: `${f} is not a wire decimal` };
    }
  }
  const decimals = base.at.usd_decimals;
  const baseDebt = BigInt(base.at.cumulative_debt_eligible_usd);
  const baseAccounts = base.at.cumulative_eligible_accounts;
  const word = axisWord(waterfall.axis);
  const lines: StressLine[] = points.slice(1).map((p) => {
    const deltaDebt = BigInt(p.at.cumulative_debt_eligible_usd) - baseDebt;
    const deltaAccounts = p.at.cumulative_eligible_accounts - baseAccounts;
    const badDebt = BigInt(p.at.cumulative_bad_debt_usd);
    const shock = `${word} ${shockPercent(BigInt(p.factor), scale)}`;
    const head =
      deltaDebt > 0n
        ? `+${humanUsd(deltaDebt, decimals)} liquidatable · ${String(deltaAccounts)} account${deltaAccounts === 1 ? "" : "s"}`
        : "no new liquidatable debt";
    return { shock, deltaDebt, deltaAccounts, badDebt, decimals, text: `${shock} → ${head} · bad debt ${humanUsd(badDebt, decimals)}` };
  });
  return { kind: "view", scenarioId: waterfall.scenario_id, lines };
}
```

```ts
// web/lib/refusal-phrasebook.ts
/** Wire refusal code → the plain cause a reader sees first (spec §3.2). The code itself is shown on hover / in evidence. */
const PHRASEBOOK: Record<string, string> = {
  SWEEP_NEVER: "collateral sweep never ran",
  SWEEP_FAILED: "collateral sweep failed",
  FLAG_CUSTODY_UNPROVEN: "collateral-flag custody unproven",
  STALE_PRICE: "price input past its freshness ceiling",
  PRICE_STALE: "price input past its freshness ceiling",
  NO_COMPARATOR: "no liquidation rule applies to this position",
};

export function plainCause(code: string, detail?: string | null): string {
  const known = PHRASEBOOK[code];
  if (known !== undefined) return known;
  if (typeof detail === "string" && detail.trim().length > 0) return detail.trim();
  return `refused (${code})`;
}
```

```ts
// web/lib/live-pill.ts
import { humanAge } from "./freshness";
import type { FreshnessTier } from "./freshnessTiers";

export interface LivePillInput {
  readonly streamState: "idle" | "connecting" | "open" | "waiting" | "closed";
  readonly hasBase: boolean;
  readonly batchId: number | null;
  readonly ageSeconds: number | null;
  readonly tier: FreshnessTier | null;
}

export interface LivePillWords {
  readonly word: "Live" | "Reconnecting" | "Not connected";
  readonly tone: "ok" | "warn" | "dim";
  readonly batch: string | null;
  readonly age: string | null;
  readonly ageTone: "ok" | "warn" | "crit" | "dim";
}

const TIER_TONE: Record<FreshnessTier, "ok" | "warn" | "crit"> = { fresh: "ok", aging: "warn", stale: "crit", critical: "crit" };

export function livePillWords(input: LivePillInput): LivePillWords {
  const connected = input.streamState === "open" && input.hasBase;
  const reconnecting = input.streamState === "connecting" || input.streamState === "waiting" || (input.streamState === "open" && !input.hasBase);
  const word = connected ? "Live" : reconnecting ? "Reconnecting" : "Not connected";
  const tone = connected ? "ok" : reconnecting ? "warn" : "dim";
  const batch = input.batchId === null ? null : `batch ${input.batchId.toLocaleString("en-US")}`;
  const age = input.ageSeconds === null ? null : `${humanAge(input.ageSeconds)} ago`;
  const ageTone = input.ageSeconds === null || input.tier === null ? "dim" : TIER_TONE[input.tier];
  return { word, tone, batch, age, ageTone };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test --project=unit tests/unit/stress-preview.spec.ts tests/unit/refusal-phrasebook.spec.ts tests/unit/live-pill.spec.ts && npm run typecheck`
Expected: 3 + 1 + 2 passed; typecheck exit 0. If the `Waterfall` point engine type names differ (`cumulative_eligible_accounts` etc.), read `grep -n "cumulative_" ../packages/client-ts/src/generated/schema.ts` and use the generated names — the fixture `book.json` is the authority for values.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/stress-preview.ts web/lib/refusal-phrasebook.ts web/lib/live-pill.ts web/tests/unit/stress-preview.spec.ts web/tests/unit/refusal-phrasebook.spec.ts web/tests/unit/live-pill.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): stress preview lines, refusal phrasebook, live-pill words - pure and pinned"
```

---

### Task 7: `useCashBook` — one hook that loads the book and walks the Cash positions

**Files:**
- Create: `web/lib/cash-book.tsx`
- Read: `web/app/book/BookSurface.tsx:69-160` (the current `loadBook` abort/supersession pattern — copied, not imported), `web/lib/positions.ts` (`fetchPositionsPage`, `classifyPositionsFailure`, `PositionsFailure`), `web/lib/live-age.ts` (`useAnchoredAgeSeconds`), `web/lib/freshness.ts` (`receiptIdentity`)

**Interfaces:**
- Consumes: `readCashRow` (Task 4); `getSolventClient` from `web/lib/api.ts`; `BatchSupersededError`, `UnavailableError` from `@solvent/client`.
- Produces:

```ts
export type CashBookPhase = "loading" | "ok" | "no-batch" | "error";
export interface CashBookReading {
  readonly phase: CashBookPhase;
  readonly book: BookResponse | null;                 // set when phase === "ok"
  readonly failure: { message: string; retryAfterSeconds: number | null } | null;
  readonly cash: {
    readonly engine: BookEngine | null;               // book.engines[debt_manager]
    readonly badDebt: BadDebtEngine | null;           // book.bad_debt[debt_manager]
    readonly refusedWhole: { code: string; detail: string | null } | null; // book.refused_engines[debt_manager]
    readonly rows: readonly CashRow[];                // accumulates during the walk
    readonly walkComplete: boolean;
    readonly walkFailure: PositionsFailure | null;
  };
  readonly legacy: { readonly engine: BookEngine | null; readonly badDebt: BadDebtEngine | null; readonly histogram: HistogramEngine | null };
  readonly age: LiveAgeReading;
  readonly reload: () => void;
}
export function useCashBook(): CashBookReading;
```

No unit test (React hook; the unit project cannot render). It is exercised by the Overview and Book e2e specs (Tasks 11–12), including the 409 restart.

- [ ] **Step 1: Write the hook**

```tsx
// web/lib/cash-book.tsx
"use client";

import { BatchSupersededError, UnavailableError, type components } from "@solvent/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSolventClient } from "./api";
import { readCashRow, type CashRow, type CashWireRow } from "./cash-rows";
import { receiptIdentity } from "./freshness";
import { useAnchoredAgeSeconds, type LiveAgeReading } from "./live-age";
import { classifyPositionsFailure, fetchPositionsPage, type PositionsFailure } from "./positions";

type Schemas = components["schemas"];
export type BookResponse = Schemas["BookResponse"];
export type BookEngine = BookResponse["engines"][number];
export type BadDebtEngine = BookResponse["bad_debt"][number];
export type HistogramEngine = BookResponse["hf_histogram"]["engines"][number];

const CASH = "debt_manager";
const LEGACY = "aave_v3_etherfi";
const PAGE_LIMIT = 1000;

export type CashBookPhase = "loading" | "ok" | "no-batch" | "error";

export interface CashBookReading {
  readonly phase: CashBookPhase;
  readonly book: BookResponse | null;
  readonly failure: { message: string; retryAfterSeconds: number | null } | null;
  readonly cash: {
    readonly engine: BookEngine | null;
    readonly badDebt: BadDebtEngine | null;
    readonly refusedWhole: { code: string; detail: string | null } | null;
    readonly rows: readonly CashRow[];
    readonly walkComplete: boolean;
    readonly walkFailure: PositionsFailure | null;
  };
  readonly legacy: {
    readonly engine: BookEngine | null;
    readonly badDebt: BadDebtEngine | null;
    readonly histogram: HistogramEngine | null;
  };
  readonly age: LiveAgeReading;
  readonly reload: () => void;
}

type BookState =
  | { phase: "loading" }
  | { phase: "ok"; book: BookResponse }
  | { phase: "no-batch"; message: string; retryAfterSeconds: number | null }
  | { phase: "error"; message: string };

interface WalkState {
  readonly forBatch: number | null;
  readonly rows: readonly CashRow[];
  readonly complete: boolean;
  readonly failure: PositionsFailure | null;
}

const WALK_IDLE: WalkState = { forBatch: null, rows: [], complete: false, failure: null };

export function useCashBook(): CashBookReading {
  const [state, setState] = useState<BookState>({ phase: "loading" });
  const [walk, setWalk] = useState<WalkState>(WALK_IDLE);
  const bookControllerRef = useRef<AbortController | null>(null);
  const walkControllerRef = useRef<AbortController | null>(null);
  /** One automatic restart per superseding batch id, so a server that keeps superseding cannot be hammered. */
  const restartedForRef = useRef<number | null>(null);

  const loadBook = useCallback((options?: { keepOnFailure?: boolean }): Promise<boolean> => {
    const keepOnFailure = options?.keepOnFailure ?? false;
    bookControllerRef.current?.abort();
    const controller = new AbortController();
    bookControllerRef.current = controller;
    return getSolventClient()
      .book(controller.signal)
      .then(
        (book) => {
          if (controller.signal.aborted) return false;
          setState({ phase: "ok", book });
          return true;
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return false;
          const failure: BookState =
            cause instanceof UnavailableError
              ? { phase: "no-batch", message: cause.body.error.message, retryAfterSeconds: cause.retryAfterSeconds }
              : { phase: "error", message: cause instanceof Error ? cause.message : String(cause) };
          setState((previous) => (keepOnFailure && previous.phase === "ok" ? previous : failure));
          return false;
        },
      );
  }, []);

  useEffect(() => {
    void loadBook();
    return () => {
      bookControllerRef.current?.abort();
    };
  }, [loadBook]);

  // The walk: every page of the Cash engine, least room first, so liquidatable
  // rows arrive on page one and the headline can settle before the walk ends.
  const batchId = state.phase === "ok" ? state.book.batch.id : null;
  useEffect(() => {
    if (batchId === null) return;
    walkControllerRef.current?.abort();
    const controller = new AbortController();
    walkControllerRef.current = controller;
    setWalk({ forBatch: batchId, rows: [], complete: false, failure: null });

    const step = (cursor: string | null): void => {
      fetchPositionsPage({ engine: CASH, sort: "headroom", dir: "asc", limit: PAGE_LIMIT, cursor, signal: controller.signal }).then(
        (page) => {
          if (controller.signal.aborted) return;
          const rows = (page.positions as unknown as CashWireRow[]).map(readCashRow);
          setWalk((previous) => ({ ...previous, rows: [...previous.rows, ...rows], complete: page.next_cursor === null }));
          if (page.next_cursor !== null) step(page.next_cursor);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof BatchSupersededError) {
            // The batch moved under the walk. Reload the book ONCE for this
            // superseding id; the new book id re-runs this effect from page one.
            const superseding = cause.body.current_batch_id ?? null;
            if (superseding !== restartedForRef.current) {
              restartedForRef.current = superseding;
              void loadBook();
              return;
            }
          }
          const error = cause instanceof Error ? cause : new Error(String(cause));
          setWalk((previous) => ({ ...previous, complete: false, failure: classifyPositionsFailure(error) }));
        },
      );
    };
    step(null);
    return () => {
      controller.abort();
    };
  }, [batchId, loadBook]);

  const reloadOnResume = useCallback(() => loadBook({ keepOnFailure: true }), [loadBook]);
  const age = useAnchoredAgeSeconds(
    state.phase === "ok"
      ? { ageSeconds: state.book.batch.age_seconds, receiptId: receiptIdentity(state.book.served_at, state.book.batch.id) }
      : null,
    reloadOnResume,
  );

  const book = state.phase === "ok" ? state.book : null;
  const engineOf = (name: string): BookEngine | null => book?.engines.find((e) => e.engine === name) ?? null;
  const badDebtOf = (name: string): BadDebtEngine | null => book?.bad_debt.find((e) => e.engine === name) ?? null;
  const refused = book?.refused_engines.find((r) => r.engine === CASH) ?? null;
  const walkForThisBook = walk.forBatch === batchId;

  return {
    phase: state.phase,
    book,
    failure:
      state.phase === "no-batch"
        ? { message: state.message, retryAfterSeconds: state.retryAfterSeconds }
        : state.phase === "error"
          ? { message: state.message, retryAfterSeconds: null }
          : null,
    cash: {
      engine: engineOf(CASH),
      badDebt: badDebtOf(CASH),
      refusedWhole: refused === null ? null : { code: refused.code ?? "withheld", detail: refused.detail ?? null },
      rows: walkForThisBook ? walk.rows : [],
      walkComplete: walkForThisBook && walk.complete,
      walkFailure: walkForThisBook ? walk.failure : null,
    },
    legacy: {
      engine: engineOf(LEGACY),
      badDebt: badDebtOf(LEGACY),
      histogram: book?.hf_histogram.engines.find((e) => e.engine === LEGACY) ?? null,
    },
    age,
    reload: () => {
      void loadBook();
    },
  };
}
```

If `BatchSupersededError` does not carry `body.current_batch_id`, open `packages/client-ts/src/errors.ts:185` and use the field it does expose for the superseding id (fall back to `Date.now()` as the restart key only if none exists — the guard still limits to one restart per failure).

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0. Common fixes: the positions page row type — if `page.positions` is already `CashWireRow`-compatible, drop the `as unknown as` cast; `refused.engine` may be optional on `refused_engines[]` entries — the comparison still typechecks.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/cash-book.tsx
python roadmap/tools/scope_gate.py
git commit -m "feat(web): useCashBook - /v1/book plus the full Cash positions walk, least room first, 409 restart"
```

---

### Task 8: The kit stylesheet — the mockup's CSS, tokens substituted

**Files:**
- Create: `web/components/kit/kit.module.css`
- Modify: `web/app/tokens.css` — add `--chart-fill` beside the palette in all four theme blocks (light `:root` and `[data-theme="light"]`: `#2e7d8c`; dark media block and `[data-theme="dark"]`: `#2e7d8c`)
- Read: `docs/specs/2026-09-15-ui-mockups/pages-console.html` lines 20–110 (the `.k-*` rules this file transcribes)

**Interfaces:**
- Produces the class names every kit component and both pages use. Hex → token substitutions, applied uniformly: `#0c1215→var(--bg)`, `#131c20→var(--panel)`, `#0f171a→var(--panel-2)`, `#dbe5e8→var(--ink)`, `#93a5ab→var(--ink-2)`, `#71868e→var(--ink-3)`, `#223034→var(--line)`, `#1b262b→var(--chip-bg)`, `#5ab3c4→var(--accent-text)` for text / `var(--accent)` for fills, `#63b98a→var(--ok-text)`, `#d0a04a→var(--warn-text)`, `#d96a5d→var(--crit-text)`, `#2e7d8c→var(--chart-fill)`, translucent state fills → `var(--crit-bg)` / `var(--warn-bg)` / `var(--refused-bg)`. Font sizes: 30→`--type-h1`, 26→`--type-kpi`, 17→`--type-h2`, 16→`--type-dek`, 15→`--type-card`, 14 and 13.5→`--type-body`, 13→`--type-label`, 12.5→`--type-small`, 12→`--type-floor`; mono 12.5→`--type-mono-sm`.

- [ ] **Step 1: Write the stylesheet**

```css
/* web/components/kit/kit.module.css
 * The Console register (spec 2026-09-15 §3.1, §4). Transcribed from the
 * approved mockup docs/specs/2026-09-15-ui-mockups/pages-console.html —
 * hex colors replaced by tokens, px sizes by the --type-* scale, nothing
 * else changed. Class names keep the mockup's k- vocabulary so a diff
 * against the mockup is mechanical. */

/* ---- shell ---- */
.hd { display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 28px; border-bottom: 1px solid var(--line); background: var(--panel-2); }
.brand { display: flex; align-items: center; gap: 10px; font-weight: var(--w-semibold); font-size: var(--type-card); letter-spacing: -0.01em; color: var(--ink); }
.brandMark { width: 18px; height: 18px; border-radius: 5px; background: linear-gradient(135deg, var(--accent), var(--chart-fill)); display: inline-block; }
.brandTag { font-weight: 400; color: var(--ink-2); font-size: var(--type-label); margin-left: 6px; }
.nav { display: flex; gap: 4px; }
.nav a { padding: 6px 12px; border-radius: 6px; color: var(--ink-2); font-size: var(--type-body); }
.nav a.on { color: var(--ink); background: var(--chip-bg); }
.status { display: flex; align-items: center; gap: 14px; color: var(--ink-2); font-size: var(--type-label); }
.status a { color: var(--ink-2); }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink); font-size: var(--type-label); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-3); }
.dotOk { background: var(--ok); box-shadow: 0 0 0 3px var(--refused-bg); }
.dotWarn { background: var(--warn); }
.pillAgeOk { color: var(--ink-2); }
.pillAgeWarn { color: var(--warn-text); }
.pillAgeCrit { color: var(--crit-text); }
.pillAgeDim { color: var(--ink-3); }
.body { padding: 28px 28px 24px; }

/* ---- verdict header ---- */
.kick { font-size: var(--type-small); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); font-weight: var(--w-semibold); margin: 0 0 8px; }
.h1 { font-size: var(--type-h1); font-weight: var(--w-semibold); letter-spacing: -0.02em; line-height: 1.2; max-width: 860px; margin: 0; color: var(--ink); }
.h1 b { font-weight: var(--w-semibold); }
.emCrit { color: var(--crit-text); }
.emWarn { color: var(--warn-text); }
.emOk { color: var(--ok-text); }
.emRefused { color: var(--ink-2); }
.dek { color: var(--ink-2); font-size: var(--type-dek); max-width: 800px; margin: 10px 0 0; }
.dek b { color: var(--ink); font-weight: var(--w-medium); }
.meta { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
.chip { font-size: var(--type-small); padding: 4px 10px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); color: var(--ink-2); }
.chip b { color: var(--ink); font-weight: var(--w-medium); }
.chipOk b { color: var(--ok-text); }
.chipWarn { border-color: var(--warn); }
.chipWarn b { color: var(--warn-text); }
.chipCrit { border-color: var(--crit); }
.chipCrit b { color: var(--crit-text); }
.chipRefused { border-style: dashed; }
.spacer { flex: 1; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 8px; font-size: var(--type-body); font-weight: var(--w-medium); border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
.btnPrimary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.btnGhost { background: none; }

/* ---- section head ---- */
.sec { display: flex; align-items: baseline; justify-content: space-between; margin-top: 26px; }
.sec h2 { font-size: var(--type-h2); font-weight: var(--w-semibold); margin: 0; color: var(--ink); }
.sec h2 small { font-weight: 400; color: var(--ink-2); font-size: var(--type-body); margin-left: 10px; }
.sec a { font-size: var(--type-label); color: var(--accent-text); }

/* ---- KPI tiles ---- */
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-top: 12px; }
.kpis5 { grid-template-columns: repeat(5, 1fr); }
.kpis4 { grid-template-columns: repeat(4, 1fr); }
.kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.kpiL { color: var(--ink-2); font-size: var(--type-label); }
.kpiV { font-size: var(--type-kpi); font-weight: var(--w-semibold); letter-spacing: -0.02em; margin-top: 6px; color: var(--ink); font-variant-numeric: tabular-nums; }
.kpiS { color: var(--ink-3); font-size: var(--type-small); margin-top: 4px; }
.kpiCrit .kpiV { color: var(--crit-text); }
.kpiWarn .kpiV { color: var(--warn-text); }
.kpiOk .kpiV { color: var(--ok-text); }
.kpiRefused { border-style: dashed; }
.kpiRefused .kpiV { color: var(--ink-2); }
.kpiPending .kpiV { color: var(--ink-3); }

/* ---- cards ---- */
.grid { display: grid; grid-template-columns: 7fr 5fr; gap: 16px; margin-top: 12px; }
.gridRail { grid-template-columns: 8fr 4fr; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; }
.cardT { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.cardT h3 { font-size: var(--type-card); font-weight: var(--w-semibold); margin: 0; color: var(--ink); }
.cardT a { font-size: var(--type-label); color: var(--accent-text); white-space: nowrap; }
.cardF { color: var(--ink-2); font-size: var(--type-body); margin-top: 4px; }
.cardF b { color: var(--ink); font-weight: var(--w-medium); }

/* ---- bars ---- */
.bars { display: grid; gap: 10px; align-items: end; height: 160px; margin-top: 22px; }
.bar { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.bar i { display: block; width: 100%; background: var(--chart-fill); border-radius: 4px 4px 0 0; }
.barCrit i { background: var(--crit); }
.barWarn i { background: var(--warn); }
.barDim i { background: var(--line); }
.barCnt { font-size: var(--type-small); color: var(--ink); margin-bottom: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.barCnt small { color: var(--ink-3); font-size: var(--type-floor); }
.barLab { font-size: var(--type-floor); color: var(--ink-3); margin-top: 8px; text-align: center; }

/* ---- table ---- */
.tbl { border-collapse: collapse; width: 100%; margin-top: 10px; }
.tbl th { text-align: left; font-weight: var(--w-medium); color: var(--ink-2); font-size: var(--type-small); padding: 10px 8px 8px; border-bottom: 1px solid var(--line); }
.tbl td { padding: 9px 8px; border-bottom: 1px solid var(--chip-bg); font-size: var(--type-body); white-space: nowrap; color: var(--ink); font-variant-numeric: tabular-nums; }
.tbl td.r, .tbl th.r { text-align: right; }
.addr { font-family: var(--mono); font-size: var(--type-mono-sm); color: var(--ink); }
.sub { color: var(--ink-3); font-size: var(--type-floor); }
.tbl tr.dim td { color: var(--ink-3); }
.pillStatus { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: var(--type-floor); font-weight: var(--w-medium); white-space: nowrap; }
.pillCrit { background: var(--crit-bg); color: var(--crit-text); }
.pillWarn { background: var(--warn-bg); color: var(--warn-text); }
.pillOk { background: var(--refused-bg); color: var(--ok-text); }
.pillRefused { background: var(--refused-bg); color: var(--ink-2); }
.pillProj { background: none; border: 1px dashed var(--warn); color: var(--warn-text); }
.toggle { display: inline-flex; align-items: center; gap: 8px; font-size: var(--type-small); color: var(--ink-2); margin-top: 10px; background: none; border: 0; padding: 0; cursor: pointer; }
.toggle i { width: 28px; height: 16px; border-radius: 999px; background: var(--line); position: relative; display: inline-block; }
.toggle i::after { content: ""; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--ink-2); transition: left 120ms; }
.toggleOn i { background: var(--accent); }
.toggleOn i::after { left: 14px; background: var(--accent-ink); }

/* ---- kv rows / checklist (Inspector, plan 2) ---- */
.kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; font-size: var(--type-body); margin-top: 12px; }
.kvK { color: var(--ink-2); }
.kvV { text-align: right; font-variant-numeric: tabular-nums; }

/* ---- responsive (spec §6): stack below 900px, never drop table columns ---- */
@media (max-width: 900px) {
  .hd { height: auto; flex-wrap: wrap; gap: 8px; padding: 10px 16px; }
  .body { padding: 20px 16px; }
  .kpis, .kpis5, .kpis4 { grid-template-columns: repeat(2, 1fr); }
  .grid, .gridRail { grid-template-columns: 1fr; }
  .tbl { display: block; overflow-x: auto; }
}
```

- [ ] **Step 2: Add the chart-fill token**

In `web/app/tokens.css`, add `--chart-fill: #2e7d8c;` after `--crit-text` in each of the four palette blocks (`:root`, the `prefers-color-scheme: dark` block, `[data-theme="light"]`, `[data-theme="dark"]`). Comment once: `/* chart bar fill — the same teal in both themes; ≥3:1 non-text on both grounds */`.

- [ ] **Step 3: Lint**

Run: `npm run lint:css && npm run typecheck`
Expected: exit 0 for both. Any `font-size` the gate rejects means a token was left as px — substitute, never add a fallback.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/components/kit/kit.module.css web/app/tokens.css
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the kit stylesheet - the approved mockup's CSS with tokens substituted"
```

---

### Task 9: Kit components — thin renderers over the stylesheet

**Files:**
- Create: `web/components/kit/KpiTile.tsx`, `StatusPill.tsx`, `SectionHead.tsx`, `ChartCard.tsx`, `KitTable.tsx`, `SmallToggle.tsx`, `IdentityChips.tsx`, `VerdictHeader.tsx`, `BandBars.tsx`, `index.ts`
- Read: `web/components/ExactValue.tsx` (reused as-is for exact-layer subs)

**Interfaces (all exported from `web/components/kit/index.ts`):**

```ts
export type Tone = "neutral" | "crit" | "warn" | "ok" | "refused";
// KpiTile
export interface KpiTileProps { label: string; value: string; sub?: ReactNode; tone?: Tone; pending?: boolean; testId?: string }
// StatusPill
export interface StatusPillProps { tone: "crit" | "warn" | "ok" | "refused" | "projection"; children: ReactNode; title?: string }
// SectionHead
export interface SectionHeadProps { title: string; qualifier?: string; link?: { href: string; label: string }; testId?: string }
// ChartCard
export interface ChartCardProps { title: string; finding?: ReactNode; link?: { href: string; label: string }; children: ReactNode; testId?: string }
// KitTable
export interface KitColumn { key: string; header: string; align?: "left" | "right" }
export interface KitRow { key: string; cells: Record<string, ReactNode>; dim?: boolean; testId?: string }
export interface KitTableProps { columns: KitColumn[]; rows: KitRow[]; testId?: string; emptyText?: string }
// SmallToggle
export interface SmallToggleProps { on: boolean; onChange: (on: boolean) => void; label: string; testId?: string }
// IdentityChips
export interface IdentityChip { label: string; value: string; tone?: "neutral" | "ok" | "warn" | "crit" | "refused"; title?: string }
export interface IdentityChipsProps { chips: IdentityChip[]; trailing?: ReactNode; testId?: string }
// VerdictHeader
export interface VerdictHeaderProps { kicker: string; emphasis: string; rest?: string; tone: "crit" | "warn" | "ok" | "refused"; dek: string; chips: IdentityChip[]; actions?: ReactNode; testId?: string }
// BandBars
export interface Band { id: string; label: string; count: number; value: bigint | null; tone?: "neutral" | "crit" | "warn" | "dim" }
export interface BandBarsProps { bands: Band[]; decimals: number; weightedBy: "value" | "count"; testId?: string }
```

Behavioral laws the components enforce (pinned by the page specs, not here):
- `VerdictHeader` never renders without at least one chip: with an empty `chips` array it renders a single refused chip `Identity · missing` (keeps the p1a-9 law from `VerdictBanner`).
- `KpiTile pending` renders the value as `…` in the pending register and sets `aria-busy="true"`.
- `BandBars` draws a nonzero band at a minimum of 4px and prints the value (money via `humanUsd`) with the count in small; a `null` value prints `—` with no bar.

- [ ] **Step 1: Write the components**

```tsx
// web/components/kit/KpiTile.tsx
import type { ReactNode } from "react";
import styles from "./kit.module.css";

export type Tone = "neutral" | "crit" | "warn" | "ok" | "refused";

export interface KpiTileProps {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: Tone;
  pending?: boolean;
  testId?: string;
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "",
  crit: styles.kpiCrit,
  warn: styles.kpiWarn,
  ok: styles.kpiOk,
  refused: styles.kpiRefused,
};

export function KpiTile({ label, value, sub, tone = "neutral", pending = false, testId }: KpiTileProps) {
  const className = [styles.kpi, TONE_CLASS[tone], pending ? styles.kpiPending : ""].filter(Boolean).join(" ");
  return (
    <div className={className} data-testid={testId} data-tone={tone} aria-busy={pending ? "true" : undefined}>
      <div className={styles.kpiL}>{label}</div>
      <div className={styles.kpiV}>{pending ? "…" : value}</div>
      {sub !== undefined && <div className={styles.kpiS}>{sub}</div>}
    </div>
  );
}
```

```tsx
// web/components/kit/StatusPill.tsx
import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface StatusPillProps {
  tone: "crit" | "warn" | "ok" | "refused" | "projection";
  children: ReactNode;
  title?: string;
}

const PILL_CLASS = {
  crit: styles.pillCrit,
  warn: styles.pillWarn,
  ok: styles.pillOk,
  refused: styles.pillRefused,
  projection: styles.pillProj,
} as const;

export function StatusPill({ tone, children, title }: StatusPillProps) {
  return (
    <span className={`${styles.pillStatus} ${PILL_CLASS[tone]}`} data-tone={tone} title={title}>
      {children}
    </span>
  );
}
```

```tsx
// web/components/kit/SectionHead.tsx
import Link from "next/link";
import styles from "./kit.module.css";

export interface SectionHeadProps {
  title: string;
  qualifier?: string;
  link?: { href: string; label: string };
  testId?: string;
}

export function SectionHead({ title, qualifier, link, testId }: SectionHeadProps) {
  return (
    <div className={styles.sec} data-testid={testId}>
      <h2>
        {title}
        {qualifier !== undefined && <small>{qualifier}</small>}
      </h2>
      {link !== undefined && <Link href={link.href}>{link.label}</Link>}
    </div>
  );
}
```

```tsx
// web/components/kit/ChartCard.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface ChartCardProps {
  title: string;
  finding?: ReactNode;
  link?: { href: string; label: string };
  children: ReactNode;
  testId?: string;
}

export function ChartCard({ title, finding, link, children, testId }: ChartCardProps) {
  return (
    <section className={styles.card} data-testid={testId} aria-label={title}>
      <div className={styles.cardT}>
        <h3>{title}</h3>
        {link !== undefined && <Link href={link.href}>{link.label}</Link>}
      </div>
      {finding !== undefined && <div className={styles.cardF}>{finding}</div>}
      {children}
    </section>
  );
}
```

```tsx
// web/components/kit/KitTable.tsx
import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface KitColumn { key: string; header: string; align?: "left" | "right" }
export interface KitRow { key: string; cells: Record<string, ReactNode>; dim?: boolean; testId?: string }
export interface KitTableProps { columns: KitColumn[]; rows: KitRow[]; testId?: string; emptyText?: string }

export function KitTable({ columns, rows, testId, emptyText = "Nothing to show." }: KitTableProps) {
  return (
    <table className={styles.tbl} data-testid={testId}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={c.align === "right" ? styles.r : undefined} scope="col">{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={columns.length} className={styles.sub}>{emptyText}</td></tr>
        )}
        {rows.map((row) => (
          <tr key={row.key} className={row.dim ? styles.dim : undefined} data-testid={row.testId}>
            {columns.map((c) => (
              <td key={c.key} className={c.align === "right" ? styles.r : undefined}>{row.cells[c.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Note: CSS modules rename `.r` and `.dim`; reference them as `styles.r` / `styles.dim` (they are defined in `kit.module.css` as `.tbl td.r` / `.tbl tr.dim` — add standalone `.r {}` and `.dim {}` declarations at the top of the table section so the module exports them).

```tsx
// web/components/kit/SmallToggle.tsx
"use client";

import styles from "./kit.module.css";

export interface SmallToggleProps { on: boolean; onChange: (on: boolean) => void; label: string; testId?: string }

export function SmallToggle({ on, onChange, label, testId }: SmallToggleProps) {
  return (
    <button
      type="button"
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      data-testid={testId}
    >
      <i aria-hidden="true" />
      {label}
    </button>
  );
}
```

```tsx
// web/components/kit/IdentityChips.tsx
import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface IdentityChip {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn" | "crit" | "refused";
  title?: string;
}
export interface IdentityChipsProps { chips: IdentityChip[]; trailing?: ReactNode; testId?: string }

const CHIP_CLASS = { neutral: "", ok: styles.chipOk, warn: styles.chipWarn, crit: styles.chipCrit, refused: styles.chipRefused } as const;

export function IdentityChips({ chips, trailing, testId }: IdentityChipsProps) {
  return (
    <div className={styles.meta} data-testid={testId} data-slot="identity">
      {chips.map((chip) => (
        <span key={chip.label} className={`${styles.chip} ${CHIP_CLASS[chip.tone ?? "neutral"]}`} title={chip.title} data-chip={chip.label}>
          {chip.label} <b>{chip.value}</b>
        </span>
      ))}
      {trailing !== undefined && (
        <>
          <span className={styles.spacer} />
          {trailing}
        </>
      )}
    </div>
  );
}
```

```tsx
// web/components/kit/VerdictHeader.tsx
import type { ReactNode } from "react";
import { IdentityChips, type IdentityChip } from "./IdentityChips";
import styles from "./kit.module.css";

export interface VerdictHeaderProps {
  kicker: string;
  emphasis: string;
  rest?: string;
  tone: "crit" | "warn" | "ok" | "refused";
  dek: string;
  chips: IdentityChip[];
  actions?: ReactNode;
  testId?: string;
}

const EM_CLASS = { crit: styles.emCrit, warn: styles.emWarn, ok: styles.emOk, refused: styles.emRefused } as const;

/** The page answer. Never renders without identity: an empty chip list renders the refusal chip. */
export function VerdictHeader({ kicker, emphasis, rest = "", tone, dek, chips, actions, testId }: VerdictHeaderProps) {
  const identity: IdentityChip[] = chips.length > 0 ? chips : [{ label: "Identity", value: "missing", tone: "refused" }];
  return (
    <header data-testid={testId} data-variant={tone}>
      <p className={styles.kick}>{kicker}</p>
      <h1 className={styles.h1} data-testid={testId === undefined ? undefined : `${testId}-headline`}>
        <b className={EM_CLASS[tone]}>{emphasis}</b>
        {rest}
      </h1>
      <p className={styles.dek} data-testid={testId === undefined ? undefined : `${testId}-dek`}>{dek}</p>
      <IdentityChips chips={identity} trailing={actions} testId={testId === undefined ? undefined : `${testId}-identity`} />
    </header>
  );
}
```

```tsx
// web/components/kit/BandBars.tsx
import { humanUsd } from "@/lib/human-usd";
import styles from "./kit.module.css";

export interface Band {
  id: string;
  label: string;
  count: number;
  value: bigint | null;
  tone?: "neutral" | "crit" | "warn" | "dim";
}
export interface BandBarsProps { bands: Band[]; decimals: number; weightedBy: "value" | "count"; testId?: string }

const BAR_CLASS = { neutral: "", crit: styles.barCrit, warn: styles.barWarn, dim: styles.barDim } as const;
const MAX_PX = 128;
const MIN_PX = 4;

function weight(band: Band, weightedBy: "value" | "count"): bigint {
  return weightedBy === "count" ? BigInt(band.count) : (band.value ?? 0n);
}

export function BandBars({ bands, decimals, weightedBy, testId }: BandBarsProps) {
  const max = bands.reduce((m, b) => (weight(b, weightedBy) > m ? weight(b, weightedBy) : m), 0n);
  return (
    <div className={styles.bars} style={{ gridTemplateColumns: `repeat(${String(bands.length)}, 1fr)` }} data-testid={testId} role="img" aria-label="distribution by band">
      {bands.map((band) => {
        const w = weight(band, weightedBy);
        const px = max === 0n || w === 0n ? 0 : Math.max(MIN_PX, Number((w * BigInt(MAX_PX)) / max));
        const printed = weightedBy === "count" ? band.count.toLocaleString("en-US") : band.value === null ? "—" : humanUsd(band.value, decimals);
        return (
          <div key={band.id} className={`${styles.bar} ${BAR_CLASS[band.tone ?? "neutral"]}`} data-band={band.id} data-count={band.count}>
            <span className={styles.barCnt}>
              {printed}
              {weightedBy === "value" && <small> · {band.count.toLocaleString("en-US")}</small>}
            </span>
            <i style={{ height: `${String(px)}px` }} aria-hidden="true" />
            <span className={styles.barLab}>{band.label}</span>
          </div>
        );
      })}
    </div>
  );
}
```

```ts
// web/components/kit/index.ts
export { BandBars, type Band, type BandBarsProps } from "./BandBars";
export { ChartCard, type ChartCardProps } from "./ChartCard";
export { IdentityChips, type IdentityChip, type IdentityChipsProps } from "./IdentityChips";
export { KitTable, type KitColumn, type KitRow, type KitTableProps } from "./KitTable";
export { KpiTile, type KpiTileProps, type Tone } from "./KpiTile";
export { SectionHead, type SectionHeadProps } from "./SectionHead";
export { SmallToggle, type SmallToggleProps } from "./SmallToggle";
export { StatusPill, type StatusPillProps } from "./StatusPill";
export { VerdictHeader, type VerdictHeaderProps } from "./VerdictHeader";
```

- [ ] **Step 2: Add the two standalone table classes**

In `kit.module.css`, immediately before `.tbl {`, add:

```css
.r { text-align: right; }
.dim { color: var(--ink-3); }
```

- [ ] **Step 3: Typecheck, lint, lint:css**

Run: `npm run typecheck && npm run lint && npm run lint:css`
Expected: all exit 0. (`@/lib/human-usd` resolves through the existing `@/*` path alias in `tsconfig.json`.)

- [ ] **Step 4: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/components/kit
python roadmap/tools/scope_gate.py
git commit -m "feat(web): kit components - verdict header, tiles, chips, pills, table, toggle, band bars"
```

---

### Task 10: AppShell with the live pill; layout swap; shell spec

**Files:**
- Create: `web/components/kit/LivePill.tsx`, `web/components/kit/AppShell.tsx`
- Modify: `web/app/layout.tsx` (import `AppShell` instead of `AppHeader`)
- Modify: `web/tests/e2e/shell.spec.ts` (nav labels, brand link name, per-surface H1 table)
- Read: `web/components/AppHeader.tsx` (retired in Task 14), `web/components/ThemeToggle.tsx` (reused), `web/lib/posture.tsx` (`usePosture`), `web/lib/meta.tsx` (`useMetaConstants`), `web/lib/freshnessTiers.ts` (`freshnessTier`), `web/lib/live-age.ts` (`useAnchoredAgeSeconds`), `web/lib/freshness.ts` (`receiptIdentity`)

**Interfaces:**
- `AppShell()` — the header (brand → `/`, nav: Overview `/`, Book `/book`, Inspector `/inspector`, Scenarios `/lab`, History `/observatory`, Activity `/feed`, Verification `/proof`, API `/developers`; right: `LivePill`, GitHub link, `ThemeToggle`). `aria-label="app surfaces"` on the nav (the shell spec relies on it). Brand link `aria-label="Solvent · go to the overview"`.
- `LivePill()` — reads posture + meta constants + anchored age and renders `livePillWords` (Task 6): `<span data-testid="live-pill" data-word="Live|Reconnecting|Not connected">`.

- [ ] **Step 1: Update the shell spec first (it will fail until Step 3)**

Replace the `SURFACES`/label table at the top of `web/tests/e2e/shell.spec.ts` with:

```ts
const SURFACES = [
  { href: "/", label: "Overview", h1: /70,000 people borrow against crypto/ },
  { href: "/book", label: "Book", h1: /liquidatable|could not be computed/ },
  { href: "/inspector", label: "Inspector", h1: "Inspector" },
  { href: "/lab", label: "Scenarios", h1: "Scenario Lab" },
  { href: "/observatory", label: "History", h1: "Observatory" },
  { href: "/feed", label: "Activity", h1: "Feed" },
  { href: "/proof", label: "Verification", h1: "Proof" },
  { href: "/developers", label: "API", h1: "Developers" },
] as const;
```

and change the brand assertion to `header.getByRole("link", { name: "Solvent · go to the overview" })`, the H1 assertion to `page.getByRole("heading", { level: 1, name: surface.h1 })`, and add after the nav loop:

```ts
await expect(header.getByTestId("live-pill")).toHaveAttribute("data-word", /Live|Reconnecting|Not connected/);
```

Keep the theme-toggle tests unchanged. Book and Overview surfaces need the API mocked to render their H1 — add at the top of the per-surface test: `await page.route("**/v1/**", (route) => route.abort());` (the refused register still renders an H1 that matches `could not be computed`; for Overview the hero H1 is static).

- [ ] **Step 2: Run the shell spec to see it fail**

Run: `npm run build && npx playwright test --project=e2e tests/e2e/shell.spec.ts`
Expected: FAIL on the "Overview" link and the brand name.

- [ ] **Step 3: Write the components and swap the layout**

```tsx
// web/components/kit/LivePill.tsx
"use client";

import { receiptIdentity } from "@/lib/freshness";
import { freshnessTier } from "@/lib/freshnessTiers";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { livePillWords } from "@/lib/live-pill";
import { useMetaConstants } from "@/lib/meta";
import { usePosture } from "@/lib/posture";
import styles from "./kit.module.css";

const AGE_CLASS = { ok: styles.pillAgeOk, warn: styles.pillAgeWarn, crit: styles.pillAgeCrit, dim: styles.pillAgeDim } as const;

export function LivePill() {
  const posture = usePosture();
  const meta = useMetaConstants();
  const batch = posture.batch;
  const age = useAnchoredAgeSeconds(
    batch === null || posture.batchReceiptId === null ? null : { ageSeconds: batch.age_seconds, receiptId: posture.batchReceiptId },
  );
  const ageSeconds = age.unresolved ? null : age.seconds;
  const words = livePillWords({
    streamState: posture.streamState,
    hasBase: posture.hasBase,
    batchId: batch?.id ?? null,
    ageSeconds,
    tier: ageSeconds === null ? null : freshnessTier(ageSeconds, meta.constants),
  });
  const dotClass = words.tone === "ok" ? styles.dotOk : words.tone === "warn" ? styles.dotWarn : "";
  return (
    <span className={styles.pill} data-testid="live-pill" data-word={words.word} title={`stream ${posture.streamState}${batch === null ? "" : ` · batch ${String(batch.id)}`}`}>
      <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
      {words.word}
      {words.batch !== null && <> · {words.batch}</>}
      {words.age !== null && <span className={AGE_CLASS[words.ageTone]}> · {words.age}</span>}
    </span>
  );
}
```

If `receiptIdentity` ends up unused (the posture already exposes `batchReceiptId`), remove that import.

```tsx
// web/components/kit/AppShell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "../ThemeToggle";
import styles from "./kit.module.css";
import { LivePill } from "./LivePill";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/book", label: "Book" },
  { href: "/inspector", label: "Inspector" },
  { href: "/lab", label: "Scenarios" },
  { href: "/observatory", label: "History" },
  { href: "/feed", label: "Activity" },
  { href: "/proof", label: "Verification" },
  { href: "/developers", label: "API" },
] as const;

export const GITHUB_URL = "https://github.com/kaseLunt/solvent";

export function AppShell() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <header className={styles.hd}>
      <Link href="/" className={styles.brand} aria-label="Solvent · go to the overview">
        <i className={styles.brandMark} aria-hidden="true" />
        Solvent<span className={styles.brandTag}>ether.fi Cash risk</span>
      </Link>
      <nav className={styles.nav} aria-label="app surfaces">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className={isActive(tab.href) ? styles.on : undefined} aria-current={isActive(tab.href) ? "page" : undefined}>
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className={styles.status}>
        <LivePill />
        <a href={GITHUB_URL} rel="noreferrer">GitHub</a>
        <ThemeToggle />
      </div>
    </header>
  );
}
```

`ThemeToggle` currently imports `header.module.css` for its button class; that file is retired in Task 14 — in this task, leave it, and in Task 14 move the one `.themeToggle` rule it uses into `kit.module.css` and update the import.

In `web/app/layout.tsx`, replace `import { AppHeader } from "@/components/AppHeader";` with `import { AppShell } from "@/components/kit/AppShell";` and `<AppHeader />` with `<AppShell />`.

- [ ] **Step 4: Build and run the shell spec**

Run: `npm run typecheck && npm run build && npx playwright test --project=e2e tests/e2e/shell.spec.ts`
Expected: the nav/brand/theme tests pass. The Overview and Book H1 assertions fail until Tasks 12–13 land their pages — mark those two SURFACES entries with `test.fixme` guarded by a `pendingPages` set for now and remove the guard in Task 13's final step. (The old `/` redirect still sends `/` to `/book`; that is why Overview cannot pass yet.)

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/components/kit/LivePill.tsx web/components/kit/AppShell.tsx web/app/layout.tsx web/tests/e2e/shell.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): app shell - product header with the live pill, Overview tab, Verification and API labels"
```

---

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

### Task 12: `summarizeCash` and the Overview page

**Files:**
- Create: `web/lib/cash-summary.ts`, `web/tests/unit/cash-summary.spec.ts`
- Create: `web/app/overview/copy.ts`, `web/app/overview/OverviewSurface.tsx`, `web/app/overview/Pipeline.tsx`, `web/app/overview/overview.module.css`
- Modify: `web/app/page.tsx` (redirect → the Overview)
- Test: `web/tests/e2e/overview.spec.ts`
- Read: `docs/specs/2026-09-15-ui-mockups/front-door.html` (option A — the layout and every string), `web/lib/proof-data.ts` (`fetchEvidence(baseUrl, signal)`), `web/lib/api.ts` (`getSolventClient`, `solventBaseUrl`)

**Interfaces:**
- `lib/cash-summary.ts`:

```ts
export interface CashSummaryInput {
  rows: readonly CashRow[]; decimals: number; refusedPositions: number; walkComplete: boolean;
  refusedWhole: { code: string; detail: string | null } | null;
}
export interface CashSummary {
  decimals: number; headline: Headline; material: Sum; belowLine: Sum; nearCap: Sum; notComputed: number;
  liquidatable: MaterialityPartition<SizedCashRow>; nearCapRows: SizedCashRow[]; bands: RoomBand[];
  percentiles: { median: string | null; p10: string | null }; settled: boolean;
}
export function summarizeCash(input: CashSummaryInput): CashSummary;
export function unavailableHeadline(reason: string): Headline; // "The Cash book could not be loaded."
```

- `app/overview/copy.ts` exports the hero strings and `PUBLIC_ENDPOINTS: readonly string[]` (the 17 routes the API page lists; the count on the pipeline card is `PUBLIC_ENDPOINTS.length`).
- Overview test ids: `overview-hero`, `overview-live` (the strip, `data-variant`), `overview-live-headline`, `overview-entry-book|inspector|scenarios`, `pipeline-index|compute|verify|serve` with a `data-value` attribute carrying the printed number.

- [ ] **Step 1: Unit-pin `summarizeCash` (failing first)**

```ts
// web/tests/unit/cash-summary.spec.ts
import { expect, test } from "@playwright/test";
import { readCashRow, type CashWireRow } from "../../lib/cash-rows";
import { summarizeCash, unavailableHeadline } from "../../lib/cash-summary";
import { POSITIONS_DM_PAGE_1 } from "../fixtures/book";

const rows = (POSITIONS_DM_PAGE_1.positions as unknown as CashWireRow[]).map(readCashRow);

test("the committed DM page: one material liquidatable row, one refused", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: true, refusedWhole: null });
  expect(s.headline.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(s.headline.rest).toBe(" across 1 account.");
  expect(s.material).toEqual({ sum: 4_200_000_000n, count: 1 });
  expect(s.belowLine).toEqual({ sum: 0n, count: 0 });
  expect(s.nearCap).toEqual({ sum: 0n, count: 0 });
  expect(s.notComputed).toBe(1);
  expect(s.settled).toBe(true);
  expect(s.bands.reduce((n, b) => n + b.count, 0)).toBe(1);
});

test("a whole-engine refusal yields the refused headline with the plain cause", () => {
  const s = summarizeCash({ rows: [], decimals: 6, refusedPositions: 0, walkComplete: true, refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: null } });
  expect(s.headline.variant).toBe("refused");
  expect(s.headline.dek).toBe("Collateral-flag custody unproven.");
});

test("an unfinished walk is not settled and headlines what it has", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, refusedWhole: null });
  expect(s.settled).toBe(false);
  expect(s.headline.variant).toBe("material");
});

test("load failure headline", () => {
  expect(unavailableHeadline("no servable batch").emphasis).toBe("The Cash book could not be loaded.");
  expect(unavailableHeadline("no servable batch").dek).toBe("No servable batch.");
});
```

Run: `npx playwright test --project=unit tests/unit/cash-summary.spec.ts` → FAIL (module not found).

- [ ] **Step 2: Write `cash-summary.ts`**

```ts
// web/lib/cash-summary.ts
import { bookHeadline, bookHeadlineRefused, type Headline, type Sum } from "./book-headline";
import { liquidatableRows, nearCapRows, roomBands, roomPercentiles, sumDebt, type CashRow, type RoomBand, type SizedCashRow } from "./cash-rows";
import { partitionByMateriality, type MaterialityPartition } from "./materiality";
import { plainCause } from "./refusal-phrasebook";

export interface CashSummaryInput {
  readonly rows: readonly CashRow[];
  readonly decimals: number;
  readonly refusedPositions: number;
  readonly walkComplete: boolean;
  readonly refusedWhole: { code: string; detail: string | null } | null;
}

export interface CashSummary {
  readonly decimals: number;
  readonly headline: Headline;
  readonly material: Sum;
  readonly belowLine: Sum;
  readonly nearCap: Sum;
  readonly notComputed: number;
  readonly liquidatable: MaterialityPartition<SizedCashRow>;
  readonly nearCapRows: SizedCashRow[];
  readonly bands: RoomBand[];
  readonly percentiles: { median: string | null; p10: string | null };
  readonly settled: boolean;
}

export function summarizeCash(input: CashSummaryInput): CashSummary {
  const liquidatable = partitionByMateriality(liquidatableRows(input.rows), input.decimals);
  const near = nearCapRows(input.rows);
  const material: Sum = { sum: liquidatable.sums.material, count: liquidatable.counts.material };
  const belowLine: Sum = { sum: liquidatable.sums.belowLine, count: liquidatable.counts.belowLine };
  const nearCap: Sum = { sum: sumDebt(near), count: near.length };
  const headline =
    input.refusedWhole !== null
      ? bookHeadlineRefused(plainCause(input.refusedWhole.code, input.refusedWhole.detail))
      : bookHeadline({ decimals: input.decimals, material, belowLine, nearCap, notComputed: input.refusedPositions });
  return {
    decimals: input.decimals,
    headline,
    material,
    belowLine,
    nearCap,
    notComputed: input.refusedPositions,
    liquidatable,
    nearCapRows: near,
    bands: roomBands(input.rows),
    percentiles: roomPercentiles(input.rows),
    settled: input.walkComplete,
  };
}

export function unavailableHeadline(reason: string): Headline {
  const trimmed = reason.trim();
  const dek = trimmed.length === 0 ? "The service gave no reason." : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${trimmed.endsWith(".") ? "" : "."}`;
  return { variant: "refused", tone: "refused", emphasis: "The Cash book could not be loaded.", rest: "", dek };
}
```

Run the unit spec → 4 passed.

- [ ] **Step 3: Write the Overview e2e spec (failing first)**

```ts
// web/tests/e2e/overview.spec.ts
// The front door (spec §5.1). Mocked from committed fixtures; the live strip
// is the SAME headline grammar the Book renders, so the string is pinned here too.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { META } from "../fixtures/meta";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockAll(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/book", (route) => json(route, BOOK));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
}

test("hero, live strip, entries and pipeline render from the fixtures", async ({ page }) => {
  await mockAll(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("70,000 people borrow against crypto to spend on a Visa card.");
  const live = page.getByTestId("overview-live");
  await expect(live).toHaveAttribute("data-variant", "material");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("$4,200 of Cash debt is liquidatable right now, across 1 account.");
  await expect(live.getByTestId("overview-live-identity")).toContainText("Batch 1");
  for (const id of ["book", "inspector", "scenarios"]) await expect(page.getByTestId(`overview-entry-${id}`)).toBeVisible();
  const dm = META.watermark_vector.find((w) => w.engine === "debt_manager");
  if (dm === undefined) throw new Error("meta fixture must carry the debt_manager watermark");
  await expect(page.getByTestId("pipeline-index")).toHaveAttribute("data-value", dm.last_block.toLocaleString("en-US"));
  await expect(page.getByTestId("pipeline-compute")).toContainText(`batch ${BOOK.batch.id.toLocaleString("en-US")}`);
  await expect(page.getByTestId("pipeline-verify")).toHaveAttribute("data-value", `${String(EVIDENCE_MANIFEST.reconcile?.gated_exact ?? "")}/${String(EVIDENCE_MANIFEST.reconcile?.gated_rows ?? "")}`);
  await expect(page.getByTestId("pipeline-serve")).toContainText("17 endpoints");
  // Never summed: the two engines' debts never appear as one figure.
  await expect(page.locator("body")).not.toContainText("$10,200"); // 6,000 (aave, 8-dec) + 4,200 (dm, 6-dec)
});

test("with the API unreachable the hero still renders and the strip refuses honestly", async ({ page }) => {
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("70,000 people");
  await expect(page.getByTestId("overview-live")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("overview-live-headline")).toHaveText("The Cash book could not be loaded.");
  for (const id of ["index", "verify"]) await expect(page.getByTestId(`pipeline-${id}`)).toHaveAttribute("data-value", "unavailable");
  await expect(page.locator("body")).not.toContainText("$0 of Cash debt");
});

test("first viewport at 1440×900 holds hero, strip and entries", async ({ page }) => {
  await mockAll(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("overview-live-headline")).toBeVisible();
  const bottom = await page.getByTestId("overview-entry-scenarios").evaluate((el) => el.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThanOrEqual(900);
});
```

If `EVIDENCE_MANIFEST.reconcile` is non-optional in the schema, drop the `?.`/`?? ""`.

- [ ] **Step 4: Write the page**

```ts
// web/app/overview/copy.ts
export const HERO_KICKER = "A live risk surface for ether.fi Cash";
export const HERO_H1_LEAD = "70,000 people borrow against crypto to spend on a Visa card.";
export const HERO_H1_TAIL = " This is how close each of them is to liquidation — right now.";
export const HERO_DEK_LEAD = "Solvent indexes the Cash lending book straight from chain, recomputes every account's distance to liquidation each batch, and shows its work: ";
export const HERO_DEK_STRONG = "every number opens its evidence";
export const HERO_DEK_TAIL = ", and anything it can't defend renders as a named refusal — never a guess, never a zero.";
export const FOOTER_STACK = "Built with Go · PostgreSQL · Next.js · TypeScript · OP Mainnet + Ethereum · RedStone";
export const FOOTER_NOTE = "a portfolio project, not affiliated with ether.fi";
/** Mirror of the API page's route list; the pipeline card prints this list's length. */
export const PUBLIC_ENDPOINTS = [
  "GET /v1/book", "GET /v1/positions", "GET /v1/address/{addr}", "GET /v1/address/{addr}/stress", "GET /v1/address/{addr}/history",
  "GET /v1/observatory", "GET /v1/observatory/series", "GET /v1/events", "GET /v1/params", "GET /v1/prices/{asset}",
  "GET /v1/scenarios", "POST /v1/scenarios/{id}/run-book", "POST /v1/scenarios/run-book-set", "GET /v1/evidence",
  "GET /v1/batches/{id}", "GET /v1/stream", "GET /v1/meta",
] as const;
```

```css
/* web/app/overview/overview.module.css — Overview-only layout (mockup front-door.html, option A). */
.hero { padding: 56px 28px 40px; }
.h1 { font-size: var(--type-hero); font-weight: var(--w-semibold); letter-spacing: -0.025em; line-height: 1.1; max-width: 900px; margin: 0; color: var(--ink); }
.h1 span { color: var(--ink-2); font-weight: var(--w-medium); }
.dek { color: var(--ink-2); font-size: var(--type-dek); max-width: 760px; margin: 18px 0 0; line-height: 1.5; }
.dek b { color: var(--ink); font-weight: var(--w-medium); }
.cta { display: flex; gap: 10px; margin-top: 26px; align-items: center; flex-wrap: wrap; }
.ctaInput { width: 380px; max-width: 100%; height: 40px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); color: var(--ink); padding: 0 14px; font-family: var(--mono); font-size: var(--type-mono); }
.live { margin-top: 40px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); padding: 20px 22px; display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; }
.liveKick { font-size: var(--type-small); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); font-weight: var(--w-semibold); display: flex; align-items: center; gap: 8px; margin: 0; }
.liveH { font-size: var(--type-kpi); font-weight: var(--w-semibold); letter-spacing: -0.02em; margin: 8px 0 0; color: var(--ink); }
.liveS { color: var(--ink-2); font-size: var(--type-body); margin: 6px 0 0; }
.liveStats { display: grid; grid-template-columns: repeat(3, auto); gap: 28px; }
.liveStats div { text-align: right; }
.liveStatL { color: var(--ink-2); font-size: var(--type-small); }
.liveStatV { font-size: var(--type-h2); font-weight: var(--w-semibold); letter-spacing: -0.02em; margin-top: 2px; font-variant-numeric: tabular-nums; color: var(--ink); }
.entries { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 16px; }
.entry { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--panel-2); color: inherit; display: block; }
.entryQ { font-size: var(--type-label); color: var(--ink-2); }
.entryN { font-size: var(--type-h2); font-weight: var(--w-semibold); margin-top: 4px; color: var(--ink); }
.entryD { font-size: var(--type-body); color: var(--ink-2); margin-top: 8px; line-height: 1.45; }
.entryS { font-size: var(--type-label); margin-top: 12px; color: var(--accent-text); }
.sec { margin-top: 44px; display: flex; align-items: baseline; justify-content: space-between; }
.sec h2 { font-size: var(--type-h2); font-weight: var(--w-semibold); margin: 0; color: var(--ink); }
.sec a { font-size: var(--type-label); color: var(--accent-text); }
.pipe { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 14px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.step { padding: 18px 20px; border-right: 1px solid var(--line); background: var(--panel-2); }
.step:last-child { border-right: 0; }
.stepNum { font-size: var(--type-floor); color: var(--accent-text); font-weight: var(--w-semibold); letter-spacing: 0.08em; }
.stepN { font-size: var(--type-card); font-weight: var(--w-semibold); margin-top: 6px; color: var(--ink); }
.stepD { font-size: var(--type-label); color: var(--ink-2); margin-top: 6px; line-height: 1.45; min-height: 58px; }
.stepV { font-size: var(--type-label); margin-top: 10px; color: var(--ink); font-variant-numeric: tabular-nums; }
.stepV b { font-weight: var(--w-semibold); }
.foot { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 16px; color: var(--ink-3); font-size: var(--type-label); flex-wrap: wrap; }
.foot b { color: var(--ink-2); font-weight: var(--w-medium); }
@media (max-width: 900px) {
  .hero { padding: 32px 16px; }
  .live { grid-template-columns: 1fr; }
  .liveStats div { text-align: left; }
  .entries, .pipe { grid-template-columns: 1fr; }
  .step { border-right: 0; border-bottom: 1px solid var(--line); }
}
```

```tsx
// web/app/overview/Pipeline.tsx
import type { components } from "@solvent/client";
import styles from "./overview.module.css";
import { PUBLIC_ENDPOINTS } from "./copy";

type Schemas = components["schemas"];

export interface PipelineProps {
  meta: Schemas["MetaResponse"] | null;
  evidence: Schemas["EvidenceResponse"] | null;
  book: Schemas["BookResponse"] | null;
  cashAccounts: number | null;
}

const UNAVAILABLE = "unavailable";
const n = (value: number | null | undefined): string => (typeof value === "number" ? value.toLocaleString("en-US") : UNAVAILABLE);

export function Pipeline({ meta, evidence, book, cashAccounts }: PipelineProps) {
  const dm = meta?.watermark_vector.find((w) => w.engine === "debt_manager") ?? null;
  const eth = meta?.watermark_vector.find((w) => w.engine === "aave_v3_etherfi") ?? null;
  const indexValue = dm === null ? UNAVAILABLE : n(dm.last_block);
  const verifyValue = evidence === null ? UNAVAILABLE : `${n(evidence.reconcile.gated_exact)}/${n(evidence.reconcile.gated_rows)}`;
  return (
    <div className={styles.pipe}>
      <div className={styles.step} data-testid="pipeline-index" data-value={indexValue}>
        <div className={styles.stepNum}>01 · INDEX</div>
        <div className={styles.stepN}>Reorg-safe indexer</div>
        <div className={styles.stepD}>Raw logs from OP Mainnet and Ethereum into Postgres. Verified-ancestor rewind handles forks of any depth; every derived table rebuilds from raw logs.</div>
        <div className={styles.stepV}>OP block <b>{indexValue}</b> · Ethereum block <b>{eth === null ? UNAVAILABLE : n(eth.last_block)}</b></div>
      </div>
      <div className={styles.step} data-testid="pipeline-compute" data-value={book === null ? UNAVAILABLE : n(book.batch.id)}>
        <div className={styles.stepNum}>02 · COMPUTE</div>
        <div className={styles.stepN}>Risk engine</div>
        <div className={styles.stepD}>Each batch recomputes every account with its engine's own rule — Cash's borrow cap, Aave's health factor — using RedStone prices with a freshness budget.</div>
        <div className={styles.stepV}>{book === null ? <b>{UNAVAILABLE}</b> : <>batch <b>{n(book.batch.id)}</b> · <b>{n(cashAccounts)}</b> Cash accounts</>}</div>
      </div>
      <div className={styles.step} data-testid="pipeline-verify" data-value={verifyValue}>
        <div className={styles.stepNum}>03 · VERIFY</div>
        <div className={styles.stepN}>Reconciled to chain</div>
        <div className={styles.stepD}>Positions are re-derived against live contract reads; drift is pinned as a proof. What can't be verified is refused and shown as refused.</div>
        <div className={styles.stepV}><b>{verifyValue}</b> gated rows exact{evidence === null ? "" : <> · drift <b>{n(evidence.reconcile.gated_drift)}</b></>}</div>
      </div>
      <div className={styles.step} data-testid="pipeline-serve" data-value={String(PUBLIC_ENDPOINTS.length)}>
        <div className={styles.stepNum}>04 · SERVE</div>
        <div className={styles.stepN}>Public API + this UI</div>
        <div className={styles.stepD}>Read-only JSON, every money value a decimal string, a typed TypeScript client, and a live stream. This site is a client of the same API.</div>
        <div className={styles.stepV}><b>{String(PUBLIC_ENDPOINTS.length)}</b> endpoints · typed TypeScript client</div>
      </div>
    </div>
  );
}
```

```tsx
// web/app/overview/OverviewSurface.tsx
"use client";

import type { components } from "@solvent/client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { IdentityChips, type IdentityChip } from "@/components/kit";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import { useCashBook } from "@/lib/cash-book";
import { summarizeCash, unavailableHeadline } from "@/lib/cash-summary";
import { humanAge } from "@/lib/freshness";
import { humanUsd } from "@/lib/human-usd";
import { fetchEvidence } from "@/lib/proof-data";
import { stressPreview } from "@/lib/stress-preview";
import kit from "@/components/kit/kit.module.css";
import { FOOTER_NOTE, FOOTER_STACK, HERO_DEK_LEAD, HERO_DEK_STRONG, HERO_DEK_TAIL, HERO_H1_LEAD, HERO_H1_TAIL, HERO_KICKER } from "./copy";
import styles from "./overview.module.css";
import { Pipeline } from "./Pipeline";

type Schemas = components["schemas"];

export function OverviewSurface() {
  const reading = useCashBook();
  const [meta, setMeta] = useState<Schemas["MetaResponse"] | null>(null);
  const [evidence, setEvidence] = useState<Schemas["EvidenceResponse"] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSolventClient().meta(controller.signal).then(setMeta, () => setMeta(null));
    fetchEvidence(solventBaseUrl(), controller.signal).then(setEvidence, () => setEvidence(null));
    return () => controller.abort();
  }, []);

  const cash = reading.cash;
  const decimals = cash.engine?.value_decimals ?? 6;
  const summary =
    reading.phase === "ok"
      ? summarizeCash({ rows: cash.rows, decimals, refusedPositions: cash.engine?.refused_positions ?? 0, walkComplete: cash.walkComplete, refusedWhole: cash.refusedWhole })
      : null;
  const headline =
    summary !== null ? summary.headline : reading.phase === "loading" ? null : unavailableHeadline(reading.failure?.message ?? "the service did not answer");
  const ageText = reading.age.unresolved || reading.age.seconds === null ? null : `${humanAge(reading.age.seconds)} ago`;
  const chips: IdentityChip[] =
    reading.book === null
      ? []
      : [
          { label: "Batch", value: reading.book.batch.id.toLocaleString("en-US") },
          { label: "Snapshot", value: ageText ?? "age unknown", tone: ageText === null ? "refused" : "ok" },
          { label: "Coverage", value: `${(cash.engine?.computed_positions ?? 0).toLocaleString("en-US")} / ${(cash.engine?.positions ?? 0).toLocaleString("en-US")} computed` },
        ];
  const preview = reading.book === null ? null : stressPreview(reading.book.waterfall, "debt_manager");
  const nearest = summary?.liquidatable.material[0] ?? summary?.nearCapRows[0] ?? null;

  return (
    <div className={styles.hero} data-testid="overview-hero">
      <p className={kit.kick}>{HERO_KICKER}</p>
      <h1 className={styles.h1}>{HERO_H1_LEAD}<span>{HERO_H1_TAIL}</span></h1>
      <p className={styles.dek}>{HERO_DEK_LEAD}<b>{HERO_DEK_STRONG}</b>{HERO_DEK_TAIL}</p>
      <form className={styles.cta} action="/inspector" method="get">
        <Link href="/book" className={`${kit.btn} ${kit.btnPrimary}`}>Open the book</Link>
        <input className={styles.ctaInput} name="addr" placeholder="Inspect an address · 0x…" aria-label="address to inspect" />
        <Link href="/lab" className={`${kit.btn} ${kit.btnGhost}`}>Run a stress scenario</Link>
      </form>

      <section className={styles.live} data-testid="overview-live" data-variant={headline?.variant ?? "loading"} aria-live="polite">
        <div>
          <p className={styles.liveKick}><span className={`${kit.dot} ${reading.phase === "ok" ? kit.dotOk : ""}`} aria-hidden="true" />Cash book · right now</p>
          <p className={styles.liveH} data-testid="overview-live-headline">
            {headline === null ? "Loading the Cash book…" : <><b className={headline.tone === "crit" ? kit.emCrit : headline.tone === "ok" ? kit.emOk : kit.emRefused}>{headline.emphasis}</b>{headline.rest}</>}
          </p>
          {headline !== null && <p className={styles.liveS}>{headline.dek}</p>}
          <IdentityChips chips={chips.length > 0 ? chips : [{ label: "Identity", value: reading.phase === "loading" ? "pending" : "unavailable", tone: "refused" }]} testId="overview-live-identity" />
        </div>
        <div className={styles.liveStats}>
          <div><div className={styles.liveStatL}>Cash debt outstanding</div><div className={styles.liveStatV}>{cash.engine?.total_debt == null ? "—" : humanUsd(BigInt(cash.engine.total_debt), decimals)}</div></div>
          <div><div className={styles.liveStatL}>Collateral</div><div className={styles.liveStatV}>{cash.engine?.total_collateral == null ? "—" : humanUsd(BigInt(cash.engine.total_collateral), decimals)}</div></div>
          <div><div className={styles.liveStatL}>Accounts</div><div className={styles.liveStatV}>{cash.engine === null ? "—" : cash.engine.positions.toLocaleString("en-US")}</div></div>
        </div>
      </section>

      <div className={styles.entries}>
        <Link href="/book" className={styles.entry} data-testid="overview-entry-book">
          <div className={styles.entryQ}>What is at risk now?</div><div className={styles.entryN}>Book →</div>
          <div className={styles.entryD}>The whole Cash lending book: what's liquidatable, what's close, what backs it, and where the bad debt sits.</div>
          <div className={styles.entryS}>{summary === null ? "Live figures" : `${humanUsd(summary.nearCap.sum, decimals)} within 10% of cap`}</div>
        </Link>
        <Link href={nearest === null ? "/inspector" : `/inspector/${nearest.account}`} className={styles.entry} data-testid="overview-entry-inspector">
          <div className={styles.entryQ}>Is this address at risk?</div><div className={styles.entryN}>Inspector →</div>
          <div className={styles.entryD}>One account: its distance to liquidation, the prices that decide it, and the exact calculation with its numbers substituted.</div>
          <div className={styles.entryS}>{nearest === null ? "Try any 0x address" : `Try ${nearest.account.slice(0, 6)}…${nearest.account.slice(-4)} — ${nearest.room !== null && nearest.room < 0n ? "liquidatable now" : `${humanUsd(nearest.room ?? 0n, decimals)} from its cap`}`}</div>
        </Link>
        <Link href="/lab" className={styles.entry} data-testid="overview-entry-scenarios">
          <div className={styles.entryQ}>What if ETH falls 30%?</div><div className={styles.entryN}>Scenarios →</div>
          <div className={styles.entryD}>Committed, versioned shocks run against the live book. Every shocked number is labeled a projection.</div>
          <div className={styles.entryS}>{preview !== null && preview.kind === "view" ? (preview.lines.find((l) => l.shock === "ETH −30%")?.text ?? preview.lines[0]?.text ?? "Committed scenarios") : "Committed scenarios"}</div>
        </Link>
      </div>

      <div className={styles.sec}><h2>How it works</h2><Link href="/proof">Architecture &amp; verification →</Link></div>
      <Pipeline meta={meta} evidence={evidence} book={reading.book} cashAccounts={cash.engine?.positions ?? null} />
      <div className={styles.foot}><span>{FOOTER_STACK}</span><span>Open source · <b>github.com/kaseLunt/solvent</b> · {FOOTER_NOTE}</span></div>
    </div>
  );
}
```

```tsx
// web/app/page.tsx
import type { Metadata } from "next";
import { OverviewSurface } from "./overview/OverviewSurface";

export const metadata: Metadata = { title: "Overview" };

/** The front door (spec §5.1). */
export default function RootPage() {
  return <OverviewSurface />;
}
```

The Inspector landing must accept `?addr=` from the hero form: in `web/app/inspector/AddressEntry.tsx`, read `useSearchParams().get("addr")` as the input's initial value (one line; the strict `0x` + 40-hex law still applies on submit). If that component is a server component, skip this and change the form to `action="/inspector"` with no name — the CTA then just navigates.

- [ ] **Step 5: Build, run the Overview spec and the shell spec**

Run: `npm run typecheck && npm run lint && npm run lint:css && npm run build && npx playwright test --project=e2e tests/e2e/overview.spec.ts tests/e2e/shell.spec.ts`
Expected: overview 3 passed; shell's Overview row now passes (remove it from `pendingPages`). Fix: if `fetchEvidence` rejects on a non-2xx with `ProofFetchError`, the catch already maps it to `null` — the pipeline prints `unavailable`.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/cash-summary.ts web/tests/unit/cash-summary.spec.ts web/app/overview web/app/page.tsx web/app/inspector/AddressEntry.tsx web/tests/e2e/overview.spec.ts web/tests/e2e/shell.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Overview front door - story, live Cash verdict, three entries, the pipeline with live numbers"
```

---

### Task 13: The Book, rebuilt to the mockup

**Files:**
- Rewrite: `web/app/book/BookSurface.tsx`, `web/app/book/book.module.css`
- Create: `web/app/book/NeedsAttention.tsx`, `web/app/book/StressPreview.tsx`, `web/app/book/BookLegacy.tsx`, `web/app/book/BookMethodology.tsx`
- Rewrite: `web/tests/e2e/book.spec.ts` (the page-test contract)
- Read: `docs/specs/2026-09-15-ui-mockups/pages-console.html` (Book block — every label and the section order), `web/components/Drawer.tsx` (`DrawerProps { open, onClose, title, children }`)

**Interfaces:**
- Consumes: `useCashBook`, `summarizeCash`, `unavailableHeadline`, `stressPreview`, `plainCause`, `humanUsd`, `MINUS`, `freshnessTier`, `useMetaConstants`, the kit.
- Produces test ids: `book-verdict` (+ `-headline`, `-dek`, `-identity`), `book-kpi-debt|liquidatable|near|median|baddebt|notcomputed`, `book-bands`, `book-attention` (table; rows `book-row-<account>`), `book-dust-toggle`, `book-stress-preview`, `book-baddebt`, `book-legacy` (`<details>`), `book-methodology` (button) → `role="dialog"`.
- Not in this plan (recorded in the ledger, Task 14): the "All N accounts →" explorer link and the Collateral-mix section — `/v1/book` carries no per-asset collateral, and the explorer is a product decision the spec leaves open.

- [ ] **Step 1: Write the page-test contract first (failing)**

```ts
// web/tests/e2e/book.spec.ts
// The Book page-test contract (spec 2026-09-15 §5.2, §7). Every pin is a
// semantic invariant against the running production build with the API
// mocked from committed fixtures; strings come from lib/book-headline.ts.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BATCH_SUPERSEDED, BOOK, BOOK_ERROR_UNAVAILABLE, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { DEMO_BOOK, DEMO_META, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";
import { META } from "../fixtures/meta";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockCommitted(page: Page, book: unknown = BOOK, bookStatus = 200) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => json(route, book, bookStatus));
  await page.route("**/v1/positions*", (route) => json(route, POSITIONS_DM_PAGE_1));
}

async function mockDemo(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, cursor === null ? DEMO_POSITIONS_DM_PAGE_1 : DEMO_POSITIONS_DM_PAGE_2);
  });
}

test("committed fixture: the verdict, its identity, six tiles, the attention table, the legacy section", async ({ page }) => {
  await mockCommitted(page);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "crit");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("$4,200 of Cash debt is liquidatable right now, across 1 account.");
  await expect(page.getByTestId("book-verdict-dek")).toHaveText(
    "No account is within 10% of its borrow cap. 1 position could not be computed this batch and is counted, not hidden.",
  );
  const identity = page.getByTestId("book-verdict-identity");
  await expect(identity).toContainText("Batch 1");
  await expect(identity).toContainText("Coverage 1 / 2 computed");
  await expect(identity).toContainText("Current");

  await expect(page.getByTestId("book-kpi-debt")).toContainText("$4,200");
  await expect(page.getByTestId("book-kpi-liquidatable")).toHaveAttribute("data-tone", "crit");
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("$4,200");
  await expect(page.getByTestId("book-kpi-near")).toContainText("0 accounts");
  await expect(page.getByTestId("book-kpi-baddebt")).toContainText("$239.60");
  await expect(page.getByTestId("book-kpi-notcomputed")).toHaveAttribute("data-tone", "refused");
  await expect(page.getByTestId("book-kpi-notcomputed")).toContainText("collateral sweep never ran");

  const rows = page.getByTestId("book-attention").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Liquidatable");
  await expect(rows.nth(1)).toContainText("Not computed");
  await expect(rows.nth(1)).toHaveClass(/dim/);
  await expect(page.getByTestId("book-dust-toggle")).toHaveCount(0); // nothing below the line

  const legacy = page.getByTestId("book-legacy");
  await expect(legacy).not.toHaveAttribute("open", /.*/);
  await expect(legacy.locator("summary")).toContainText("Legacy · Aave v3 market");
  await expect(legacy.locator("summary")).toContainText("2 positions");
  // Never summed: 4,200 (Cash) + 6,000 (legacy) appears nowhere.
  await expect(page.locator("body")).not.toContainText("$10,200");
  // Wire names live in the drawer, not on the page.
  await expect(page.locator("main")).not.toContainText("debt_manager");
  await page.getByTestId("book-methodology").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("debt_manager");
  await expect(dialog).toContainText("$100");
});

test("demo scale: money-first headline, the dust toggle restates the count, bands sum to the computed population", async ({ page }) => {
  await mockDemo(page);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("$6,840 of Cash debt is liquidatable right now, across 2 accounts.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText("47 more positions are technically liquidatable");
  await expect(page.getByTestId("book-kpi-near")).toContainText("27 accounts");
  const toggle = page.getByTestId("book-dust-toggle");
  await expect(toggle).toContainText("Show 47 small & dust positions");
  const before = await page.getByTestId("book-attention").locator("tbody tr").count();
  await toggle.click();
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(before + 47);
  const counts = await page.getByTestId("book-bands").locator("[data-count]").evaluateAll((els) => els.reduce((n, el) => n + Number(el.getAttribute("data-count")), 0));
  expect(counts).toBe(1406);
});

test("the Cash engine withheld whole: refused headline, refused tiles, nothing rendered as zero", async ({ page }) => {
  const withheld = {
    ...BOOK,
    refused_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "collateral-flag custody is unproven for this window" }],
    engines: BOOK.engines.map((e) => (e.engine === "debt_manager" ? { ...e, refused: true, total_debt: null, total_collateral: null } : e)),
  };
  await mockCommitted(page, withheld);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict")).toHaveAttribute("data-variant", "refused");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be computed this batch.");
  await expect(page.getByTestId("book-kpi-debt")).toContainText("—");
  await expect(page.getByTestId("book-kpi-debt")).toHaveAttribute("data-tone", "refused");
  await expect(page.locator("main")).not.toContainText("$0 of Cash debt");
});

test("no servable batch (503): the load-failure headline names the reason", async ({ page }) => {
  await mockCommitted(page, BOOK_ERROR_UNAVAILABLE, 503);
  await page.goto("/book");
  await expect(page.getByTestId("book-verdict-headline")).toHaveText("The Cash book could not be loaded.");
  await expect(page.getByTestId("book-verdict-dek")).toContainText(BOOK_ERROR_UNAVAILABLE.error.message.slice(1, 20));
  await expect(page.getByTestId("book-kpi-liquidatable")).toContainText("—");
});

test("a 409 during the walk restarts it on the new book", async ({ page }) => {
  let bookRequests = 0;
  let positionsRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, META));
  await page.route("**/v1/book", (route) => { bookRequests += 1; return json(route, BOOK); });
  await page.route("**/v1/positions*", (route) => {
    positionsRequests += 1;
    return positionsRequests === 1 ? json(route, BATCH_SUPERSEDED, 409) : json(route, POSITIONS_DM_PAGE_1);
  });
  await page.goto("/book");
  await expect(page.getByTestId("book-attention").locator("tbody tr")).toHaveCount(2);
  expect(bookRequests).toBe(2);
  expect(positionsRequests).toBe(2);
});

test("first viewport at 1440×900 holds the verdict, the tiles and the top of the grid", async ({ page }) => {
  await mockDemo(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/book");
  await expect(page.getByTestId("book-kpi-notcomputed")).toBeVisible();
  const tilesBottom = await page.getByTestId("book-kpi-notcomputed").evaluate((el) => el.getBoundingClientRect().bottom);
  const chartTop = await page.getByTestId("book-bands").evaluate((el) => el.getBoundingClientRect().top);
  expect(tilesBottom).toBeLessThanOrEqual(900);
  expect(chartTop).toBeLessThan(900);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(1440); // no primary horizontal scroll
});
```

Run: `npm run build && npx playwright test --project=e2e tests/e2e/book.spec.ts` → FAIL (old page).

- [ ] **Step 2: Write the sections**

```tsx
// web/app/book/NeedsAttention.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { KitTable, SmallToggle, StatusPill, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { CashRow, SizedCashRow } from "@/lib/cash-rows";
import type { CashSummary } from "@/lib/cash-summary";
import { humanUsd, MINUS } from "@/lib/human-usd";
import { plainCause } from "@/lib/refusal-phrasebook";

const DEFAULT_ROWS = 8;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function byRoom(a: CashRow, b: CashRow): number {
  const x = a.roomTenths ?? 0n;
  const y = b.roomTenths ?? 0n;
  return x < y ? -1 : x > y ? 1 : 0;
}

function toRow(r: SizedCashRow, status: "liquidatable" | "near"): KitRow {
  const room = r.room ?? 0n;
  return {
    key: r.account,
    testId: `book-row-${r.account}`,
    cells: {
      account: <Link href={`/inspector/${r.account}`} className={kit.addr}>{short(r.account)}</Link>,
      room: status === "liquidatable" ? `${MINUS}${humanUsd(room < 0n ? -room : room, r.decimals)}` : (r.roomPercent ?? "—"),
      debt: humanUsd(r.debt, r.decimals),
      status: status === "liquidatable" ? <StatusPill tone="crit">Liquidatable</StatusPill> : <StatusPill tone="warn">Near cap</StatusPill>,
    },
  };
}

function refusedRow(r: CashRow): KitRow {
  return {
    key: r.account,
    testId: `book-row-${r.account}`,
    dim: true,
    cells: {
      account: <Link href={`/inspector/${r.account}`} className={kit.addr}>{short(r.account)}</Link>,
      room: "—",
      debt: r.debt === null ? "—" : humanUsd(r.debt, r.decimals),
      status: <StatusPill tone="refused" title={r.refusal?.code}>Not computed</StatusPill>,
    },
  };
}

export function NeedsAttention({ summary, rows }: { summary: CashSummary; rows: readonly CashRow[] }) {
  const [showSmall, setShowSmall] = useState(false);
  const material = [...summary.liquidatable.material].sort(byRoom).map((r) => toRow(r, "liquidatable"));
  const near = summary.nearCapRows.map((r) => toRow(r, "near"));
  const refused = rows.filter((r) => !r.computed).map(refusedRow);
  const belowLine = [...summary.liquidatable.small, ...summary.liquidatable.dust].sort(byRoom).map((r) => toRow(r, "liquidatable"));
  const base = [...material, ...near, ...refused].slice(0, Math.max(DEFAULT_ROWS, material.length + refused.length));
  const shown = showSmall ? [...base, ...belowLine] : base;
  const n = summary.liquidatable.counts.belowLine;
  return (
    <>
      <KitTable
        testId="book-attention"
        columns={[
          { key: "account", header: "Account" },
          { key: "room", header: "Room", align: "right" },
          { key: "debt", header: "Debt", align: "right" },
          { key: "status", header: "Status", align: "right" },
        ]}
        rows={shown}
        emptyText={summary.settled ? "No account needs attention." : "Walking the book…"}
      />
      {n > 0 && (
        <SmallToggle
          on={showSmall}
          onChange={setShowSmall}
          testId="book-dust-toggle"
          label={`Show ${String(n)} small & dust positions (${humanUsd(summary.liquidatable.sums.belowLine, summary.decimals)})`}
        />
      )}
    </>
  );
}
```

```tsx
// web/app/book/StressPreview.tsx
import Link from "next/link";
import { ChartCard } from "@/components/kit";
import type { StressPreview as Preview } from "@/lib/stress-preview";
import styles from "./book.module.css";

export function StressPreview({ preview }: { preview: Preview }) {
  return (
    <ChartCard title="Stress preview" finding="The committed ETH shock grid, run against this batch. Every figure below is a projection." link={{ href: "/lab", label: "Scenarios →" }} testId="book-stress-preview">
      {preview.kind === "view" ? (
        <ul className={styles.lines}>
          {preview.lines.map((line) => (
            <li key={line.shock}><Link href={`/lab?scenario=${preview.scenarioId}`}>{line.text}</Link></li>
          ))}
        </ul>
      ) : preview.kind === "refused" ? (
        <p className={styles.note}>Preview withheld: {preview.reason}.</p>
      ) : (
        <p className={styles.note}>The Cash engine is not on this batch's stress grid.</p>
      )}
    </ChartCard>
  );
}
```

```tsx
// web/app/book/BookLegacy.tsx
import { BandBars, KpiTile, type Band } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { BadDebtEngine, BookEngine, HistogramEngine } from "@/lib/cash-book";
import { humanUsd } from "@/lib/human-usd";
import styles from "./book.module.css";

export function BookLegacy({ engine, badDebt, histogram }: { engine: BookEngine | null; badDebt: BadDebtEngine | null; histogram: HistogramEngine | null }) {
  if (engine === null) return null;
  const d = engine.value_decimals;
  const bands: Band[] = (histogram?.buckets ?? []).map((b, i) => ({ id: b.label, label: b.label, count: b.count, value: null, tone: i === 0 ? "crit" : i <= 2 ? "warn" : "neutral" }));
  return (
    <details className={styles.legacy} data-testid="book-legacy" id="legacy">
      <summary>
        Legacy · Aave v3 market — {engine.positions.toLocaleString("en-US")} positions · {engine.total_debt === null ? "debt withheld" : `${humanUsd(BigInt(engine.total_debt), d)} debt`} · {String(engine.liquidatable_positions)} liquidatable · {String(engine.refused_positions)} refused
      </summary>
      <p className={styles.note}>The ether.fi Aave v3 market is being wound down. Its figures are shown for completeness and are never added to the Cash book.</p>
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        <KpiTile label="Positions" value={engine.positions.toLocaleString("en-US")} sub={`${engine.computed_positions.toLocaleString("en-US")} computed`} />
        <KpiTile label="Debt" value={engine.total_debt === null ? "—" : humanUsd(BigInt(engine.total_debt), d)} tone={engine.total_debt === null ? "refused" : "neutral"} />
        <KpiTile label="Liquidatable" value={String(engine.liquidatable_positions)} sub={badDebt?.eligible_debt_usd == null ? "Σ withheld" : `${humanUsd(BigInt(badDebt.eligible_debt_usd), badDebt.usd_decimals)} eligible debt`} tone={engine.liquidatable_positions > 0 ? "crit" : "neutral"} />
        <KpiTile label="Not computed" value={String(engine.refused_positions)} tone="refused" />
      </div>
      {bands.length > 0 && <BandBars bands={bands} decimals={d} weightedBy="count" testId="book-legacy-bands" />}
    </details>
  );
}
```

```tsx
// web/app/book/BookMethodology.tsx
"use client";

import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import type { BookResponse } from "@/lib/cash-book";
import { MATERIAL_LINE_USD, SMALL_LINE_USD } from "@/lib/materiality";
import { plainCause } from "@/lib/refusal-phrasebook";
import styles from "./book.module.css";

export function BookMethodology({ open, onClose, book }: { open: boolean; onClose: () => void; book: BookResponse | null }) {
  const cash = book?.engines.find((e) => e.engine === "debt_manager") ?? null;
  return (
    <Drawer open={open} onClose={onClose} title="Methodology & evidence">
      <div className={styles.method}>
        <h3>Engines</h3>
        <p><b>Cash</b> is the Debt Manager engine (<code>debt_manager</code>, OP Mainnet). An account is liquidatable when its borrowings exceed its borrow cap — the strict rule <code>debt &gt; maxBorrowLT</code>. Room is <code>cap − debt</code>. Values are USD at {String(cash?.value_decimals ?? 6)} decimals.</p>
        <p>The <b>Aave v3 market (legacy)</b> is <code>aave_v3_etherfi</code> on Ethereum, judged by its own health factor. The two books are never added together.</p>
        <h3>Materiality</h3>
        <p>Headlines and default views read at <b>${MATERIAL_LINE_USD.toString()}</b> of liquidatable debt per account. Small is ${SMALL_LINE_USD.toString()}–${MATERIAL_LINE_USD.toString()}; dust is under ${SMALL_LINE_USD.toString()}. Every count and sum exists in full; the line only decides what leads. Sub-cent values print as <code>&lt;$0.01</code>.</p>
        <h3>Refusals on this batch</h3>
        {cash === null ? <p>No Cash engine on this batch.</p> : cash.refusals.length === 0 ? <p>None.</p> : (
          <ul>{cash.refusals.map((r) => <li key={r.key}>{plainCause(r.key)} — <code>{r.key}</code> × {String(r.count)}</li>)}</ul>
        )}
        <h3>Identity</h3>
        {book === null ? <p>No batch loaded.</p> : (
          <p>Batch <code>{String(book.batch.id)}</code> computed <code>{book.batch.computed_at}</code> by <code>{book.batch.producer}</code>; served <code>{book.served_at}</code>. Coverage: {String(book.coverage.in_book)} of {String(book.coverage.batch_positions)} positions on the wire, {String(book.coverage.refused_in_batch)} refused.</p>
        )}
        <p>Exact evidence and the reconcile receipt: <Link href="/proof">Verification</Link>. Every endpoint this page reads: <Link href="/developers">API</Link>.</p>
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 3: Rewrite `BookSurface.tsx` and `book.module.css`**

```tsx
// web/app/book/BookSurface.tsx
"use client";

import { useState } from "react";
import { BandBars, ChartCard, KpiTile, SectionHead, VerdictHeader, type Band, type IdentityChip } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useCashBook } from "@/lib/cash-book";
import { summarizeCash, unavailableHeadline } from "@/lib/cash-summary";
import { humanAge } from "@/lib/freshness";
import { freshnessTier } from "@/lib/freshnessTiers";
import { humanUsd } from "@/lib/human-usd";
import { useMetaConstants } from "@/lib/meta";
import { plainCause } from "@/lib/refusal-phrasebook";
import { stressPreview } from "@/lib/stress-preview";
import { BookLegacy } from "./BookLegacy";
import { BookMethodology } from "./BookMethodology";
import { NeedsAttention } from "./NeedsAttention";
import { StressPreview } from "./StressPreview";
import styles from "./book.module.css";

const BAND_TONE = (id: string): Band["tone"] => (id === "breached" ? "crit" : id === "0-2" || id === "2-5" || id === "5-10" ? "warn" : "neutral");
const BAND_LABEL = (id: string, label: string): string => (id === "breached" ? "over cap · liquidatable" : id === "0-2" ? "< 2% room" : id === "50-plus" ? "≥ 50% room" : label);

export function BookSurface() {
  const reading = useCashBook();
  const meta = useMetaConstants();
  const [methodOpen, setMethodOpen] = useState(false);
  const cash = reading.cash;
  const decimals = cash.engine?.value_decimals ?? 6;
  const loaded = reading.phase === "ok";
  const summary = loaded
    ? summarizeCash({ rows: cash.rows, decimals, refusedPositions: cash.engine?.refused_positions ?? 0, walkComplete: cash.walkComplete, refusedWhole: cash.refusedWhole })
    : null;
  const headline =
    summary?.headline ?? (reading.phase === "loading" ? { variant: "refused" as const, tone: "refused" as const, emphasis: "Loading the Cash book…", rest: "", dek: "Fetching the newest batch." } : unavailableHeadline(reading.failure?.message ?? "the service did not answer"));
  const refusedTiles = !loaded || cash.refusedWhole !== null;
  const pending = loaded && !cash.walkComplete && cash.refusedWhole === null;

  const ageSeconds = reading.age.unresolved ? null : reading.age.seconds;
  const tier = ageSeconds === null ? null : freshnessTier(ageSeconds, meta.constants);
  const chips: IdentityChip[] = !loaded || reading.book === null ? [] : [
    { label: "Batch", value: reading.book.batch.id.toLocaleString("en-US") },
    { label: "Snapshot", value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(), tone: tier === null ? "refused" : tier === "fresh" ? "ok" : tier === "aging" ? "warn" : "crit" },
    { label: "Coverage", value: `${(cash.engine?.computed_positions ?? 0).toLocaleString("en-US")} / ${(cash.engine?.positions ?? 0).toLocaleString("en-US")} computed` },
    { label: "Current", value: "not projected" },
  ];

  const money = (v: string | null | undefined): string => (v == null ? "—" : humanUsd(BigInt(v), decimals));
  const bands: Band[] = (summary?.bands ?? []).map((b) => ({ id: b.id, label: BAND_LABEL(b.id, b.label), count: b.count, value: b.debt, tone: BAND_TONE(b.id) }));
  const nearTenPct = summary === null ? 0n : summary.bands.filter((b) => b.id === "0-2" || b.id === "2-5" || b.id === "5-10").reduce((s, b) => s + b.debt, 0n);
  const refusalKey = cash.engine?.refusals[0]?.key;

  return (
    <div className={styles.page}>
      <VerdictHeader
        testId="book-verdict"
        kicker="Cash book · right now"
        emphasis={headline.emphasis}
        rest={headline.rest}
        tone={headline.tone}
        dek={headline.dek}
        chips={chips}
        actions={<button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setMethodOpen(true)} data-testid="book-methodology">Methodology &amp; evidence</button>}
      />
      <SectionHead title="Cash" qualifier={`Debt Manager engine · OP Mainnet · ${(cash.engine?.positions ?? 0).toLocaleString("en-US")} borrowing accounts`} link={{ href: "#legacy", label: "Legacy Aave v3 market ↓" }} />
      <div className={kit.kpis}>
        <KpiTile testId="book-kpi-debt" label="Debt outstanding" value={money(cash.engine?.total_debt)} sub={`against ${money(cash.engine?.total_collateral)} collateral`} tone={refusedTiles ? "refused" : "neutral"} />
        <KpiTile testId="book-kpi-liquidatable" label="Liquidatable · material" value={summary === null ? "—" : humanUsd(summary.material.sum, decimals)} sub={summary === null ? "" : `${String(summary.material.count)} account${summary.material.count === 1 ? "" : "s"} · ${String(summary.belowLine.count)} more under $100`} tone={refusedTiles ? "refused" : summary !== null && summary.material.count > 0 ? "crit" : "neutral"} pending={pending && (summary?.liquidatable.material.length ?? 0) === 0} />
        <KpiTile testId="book-kpi-near" label="Near cap · <10% room" value={summary === null ? "—" : humanUsd(summary.nearCap.sum, decimals)} sub={summary === null ? "" : `${String(summary.nearCap.count)} accounts`} tone={refusedTiles ? "refused" : summary !== null && summary.nearCap.count > 0 ? "warn" : "neutral"} pending={pending} />
        <KpiTile testId="book-kpi-median" label="Median room" value={summary?.percentiles.median ?? "—"} sub={summary?.percentiles.p10 === null || summary === undefined ? "of borrow cap" : `of borrow cap · 10th pct ${summary?.percentiles.p10 ?? "—"}`} tone={refusedTiles ? "refused" : "neutral"} pending={pending} />
        <KpiTile testId="book-kpi-baddebt" label="Standing bad debt" value={cash.badDebt?.current_bad_debt_usd == null ? "—" : humanUsd(BigInt(cash.badDebt.current_bad_debt_usd), cash.badDebt.usd_decimals)} sub={cash.badDebt === null ? "" : `${String(cash.badDebt.insolvent_positions)} account${cash.badDebt.insolvent_positions === 1 ? "" : "s"}`} tone={refusedTiles ? "refused" : cash.badDebt !== null && cash.badDebt.current_bad_debt_usd !== "0" ? "warn" : "neutral"} />
        <KpiTile testId="book-kpi-notcomputed" label="Not computed" value={cash.engine === null ? "—" : String(cash.engine.refused_positions)} sub={refusalKey === undefined ? "nothing refused" : plainCause(refusalKey)} tone="refused" />
      </div>
      <div className={kit.grid}>
        <ChartCard title="Distance to liquidation, by debt" finding={<>Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · <b>{humanUsd(nearTenPct, decimals)}</b> sits within 10% of the cap</>} link={{ href: "#", label: "Exact bins →" }} testId="book-bands-card">
          {summary === null ? <p className={styles.note}>{refusedTiles ? "Not computed." : "Loading…"}</p> : <BandBars bands={bands} decimals={decimals} weightedBy="value" testId="book-bands" />}
        </ChartCard>
        <ChartCard title="Needs attention" finding="Material first, then by room">
          {summary === null ? <p className={styles.note}>{refusedTiles ? "Not computed." : "Loading…"}</p> : <NeedsAttention summary={summary} rows={cash.rows} />}
        </ChartCard>
      </div>
      {reading.book !== null && <div className={kit.grid}>
        <StressPreview preview={stressPreview(reading.book.waterfall, "debt_manager")} />
        <ChartCard title="Bad debt on the book" testId="book-baddebt" finding={cash.badDebt === null ? "Not reported." : `${humanUsd(BigInt(cash.badDebt.current_bad_debt_usd ?? "0"), cash.badDebt.usd_decimals)} of debt is no longer covered by collateral, across ${String(cash.badDebt.insolvent_positions)} account${cash.badDebt.insolvent_positions === 1 ? "" : "s"}.`}>
          <p className={styles.note}>Standing bad debt is measured, not projected: collateral value today is below the debt it secures.</p>
        </ChartCard>
      </div>}
      <BookLegacy engine={reading.legacy.engine} badDebt={reading.legacy.badDebt} histogram={reading.legacy.histogram} />
      <BookMethodology open={methodOpen} onClose={() => setMethodOpen(false)} book={reading.book} />
    </div>
  );
}
```

Wire the "Exact bins →" link to open the methodology drawer (`onClick` on an anchor is not available through `ChartCard.link`; either extend `ChartCardProps.link` with an optional `onClick`, or omit the link — do not leave a dead `#` link).

```css
/* web/app/book/book.module.css — Book-only rules; everything else is the kit. */
.page { padding: 28px 0 24px; }
.note { color: var(--ink-2); font-size: var(--type-body); margin: 12px 0 0; }
.lines { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; font-size: var(--type-body); font-variant-numeric: tabular-nums; }
.lines a { color: var(--ink); }
.lines a:hover { color: var(--accent-text); }
.legacy { margin-top: 26px; border: 1px solid var(--line); border-radius: 10px; padding: 0 20px 18px; background: var(--panel-2); }
.legacy summary { cursor: pointer; padding: 14px 0; font-size: var(--type-card); font-weight: var(--w-semibold); color: var(--ink); }
.method { display: grid; gap: 8px; font-size: var(--type-body); color: var(--ink); }
.method h3 { font-size: var(--type-card); margin: 14px 0 0; }
.method code { font-family: var(--mono); font-size: var(--type-mono-sm); }
```

Delete the now-unused old imports; the retired components are removed in Task 14 (until then they still compile, unused).

- [ ] **Step 4: Build and run the Book contract**

Run: `npm run typecheck && npm run lint && npm run lint:css && npm run build && npx playwright test --project=e2e tests/e2e/book.spec.ts tests/e2e/shell.spec.ts`
Expected: book 6 passed; shell fully green — remove the `pendingPages` guard.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/book/BookSurface.tsx web/app/book/book.module.css web/app/book/NeedsAttention.tsx web/app/book/StressPreview.tsx web/app/book/BookLegacy.tsx web/app/book/BookMethodology.tsx web/tests/e2e/book.spec.ts web/tests/e2e/shell.spec.ts web/components/kit/ChartCard.tsx
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Book rebuilt - Cash first, money first, six tiles, dollar-weighted bands, needs-attention, legacy collapsed, one drawer"
```

---

### Task 14: Retire the old Book surface, its page-local modules, and the pins that described them

**Files:**
- Delete: every file under `web/app/book/` except `page.tsx`, `BookSurface.tsx`, `book.module.css`, `NeedsAttention.tsx`, `StressPreview.tsx`, `BookLegacy.tsx`, `BookMethodology.tsx`
- Delete: `web/components/AppHeader.tsx`, `web/components/PostureRibbon.tsx`, `web/components/Ribbon.tsx`, `web/components/Stampline.tsx`, `web/components/StatCard.tsx`, `web/components/header.module.css`, `web/components/ribbon.module.css` — **only if** `find_referencing_symbols` (or `grep -rn "<Name>" web/app web/components`) shows no remaining importer outside the deleted set. Anything still imported by History/Activity/Verification/API pages stays until Plan 4 (convergence).
- Delete: `web/tests/e2e/book-charts.spec.ts`, `web/tests/e2e/book-table.spec.ts`, `web/tests/e2e/chart-spec-v4.spec.ts`; remove the Book-scoped tests inside `w3l-slots.spec.ts`, `state-matrix.spec.ts`, `p0-fixes.spec.ts`, `p1a-fixes.spec.ts`, `p1b-fixes.spec.ts`, `r1-fixes.spec.ts`, `r3-fixes.spec.ts` … `r8-fixes.spec.ts`
- Delete: unit specs whose subject was deleted (`book-charts-copy`, `book-dek`, `book-row`, `book-sort-vocabulary`, `book-table`, `book-fixture-fidelity`, `dust`, `flip-ranking`, `headroom-pareto`, `stress-increments` — check each import line; a spec that imports only from `web/lib/**` STAYS)
- Modify: `web/components/ThemeToggle.tsx` (move its one class into `kit.module.css`), `.superpowers/sdd/progress-ui-overhaul.md` (ledger)

**Decision rule per e2e test** (open each file; the retired-surface tests are those that `goto("/book")` or assert `book-*` test ids):
- The test pins an *invariant the new Book still owes* (refused never zero · null never zero · engine-withheld variant · 503 variant · 409 restart · the dek computed from the response · never summed · batch identity shown) → confirm the same invariant is asserted in the new `book.spec.ts` (Task 13 covers each of these); then delete the old test.
- The test pins *copy or DOM of the retired surface* (stat-row wording, heatmap geometry, dust chips, sort-remap acknowledgements, stampline slots, exact-bin ledgers, waterfall captions) → delete.
- Either way, one ledger line per deleted test: `- <file> · "<test title>" — retired: <invariant moved to book.spec.ts "<new title>" | copy/DOM of the retired Book surface>`.

- [ ] **Step 1: Inventory**

Run from `web/`:

```bash
grep -ln 'goto("/book\|goto(`/book\|getByTestId("book-' tests/e2e/*.spec.ts
grep -n '^test(\|^  test(\|^    test(' tests/e2e/w3l-slots.spec.ts tests/e2e/state-matrix.spec.ts tests/e2e/p0-fixes.spec.ts tests/e2e/p1a-fixes.spec.ts tests/e2e/p1b-fixes.spec.ts tests/e2e/r1-fixes.spec.ts tests/e2e/r3-fixes.spec.ts tests/e2e/r4-fixes.spec.ts tests/e2e/r5-fixes.spec.ts tests/e2e/r6-fixes.spec.ts tests/e2e/r7-fixes.spec.ts tests/e2e/r8-fixes.spec.ts
ls app/book
grep -ln "app/book\|\.\./\.\./app/book" tests/unit/*.spec.ts
```

Paste the inventory (file · test title · decision) into the ledger section before deleting anything.

- [ ] **Step 2: Delete the old Book modules and components; move the theme-toggle rule**

```bash
cd web/app/book && ls | grep -vE '^(page\.tsx|BookSurface\.tsx|book\.module\.css|NeedsAttention\.tsx|StressPreview\.tsx|BookLegacy\.tsx|BookMethodology\.tsx)$' | xargs git rm -q
```

For each candidate under `web/components/`, run `grep -rn "from \"@/components/<Name>\"\|from \"\.\./<Name>\"\|from \"\./<Name>\"" web/app web/components` and `git rm` only the ones with zero hits. Copy the `.themeToggle`-class rule (whatever `ThemeToggle.tsx` references from `header.module.css`) into `kit.module.css` under a `/* ---- theme toggle ---- */` heading and change the import in `ThemeToggle.tsx` to `./kit/kit.module.css`.

- [ ] **Step 3: Delete the retired specs, trim the mixed files**

`git rm` the three whole Book e2e files and the unit specs whose imports point at deleted modules. In the mixed e2e files delete the retired `test(...)` blocks and any now-unused imports/helpers. Add the ledger section:

```markdown
## 2026-09-15 · Plan 1 (kit · Overview · Book) — pin retirement ledger

Authority: docs/specs/2026-09-15-ui-product-register-design.md §7. The Book surface was rebuilt;
its page-local modules (app/book/*.ts) and the pins describing the old surface are retired.
Semantic invariants re-expressed in tests/e2e/book.spec.ts: refused never zero · null never zero ·
engine withheld whole · 503 no-batch · 409 walk restart · dek computed from the response ·
never summed · batch identity rendered. Not carried into Plan 1 (recorded, not lost): the
"All N accounts" explorer link and the Collateral-mix section (no per-asset collateral on /v1/book).

- tests/e2e/book-charts.spec.ts · (all 17) — retired: copy/DOM of the retired Book charts
- … one line per test …
```

- [ ] **Step 4: Prove nothing dangles**

Run: `npm run typecheck && npm run lint && npm run lint:css && npx playwright test --project=unit && npm run build && npx playwright test --project=e2e`
Expected: all green. `web/lib` unit spec files: count before and after — the count must not decrease (`ls tests/unit | wc -l` minus the deleted page-module specs equals the new count; list the new specs added by this plan: human-usd, materiality, cash-rows, book-headline, stress-preview, refusal-phrasebook, live-pill, cash-summary, demo-fixture-weld).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add -u web/app/book web/components web/tests
git add web/components/kit/kit.module.css web/components/ThemeToggle.tsx .superpowers/sdd/progress-ui-overhaul.md
python roadmap/tools/scope_gate.py
git commit -m "chore(web): retire the old Book surface, its page-local modules and the pins that described it - ledgered"
```

(`git add -u` stages only tracked deletions/modifications under those paths; verify with `git status --short` that no `.log` files were staged.)

---

### Task 15: Screenshot pins and the side-by-side gate script

**Files:**
- Create: `web/tests/e2e/screenshots.spec.ts` (+ committed baselines under `web/tests/e2e/screenshots.spec.ts-snapshots/`)
- Create: `web/scripts/screenshot-pages.mjs`
- Modify: `web/playwright.config.ts` (snapshot path template without the platform suffix)

**Interfaces:**
- `npx playwright test --project=e2e tests/e2e/screenshots.spec.ts` compares Overview and Book at 1440×900, both themes, against the demo fixtures. Skipped on CI (`process.env.CI`) because font rasterization differs across runners; the pins are the local anti-drift gate (spec §7, §9.4).
- `node scripts/screenshot-pages.mjs <outDir>` writes `overview-dark.png`, `overview-light.png`, `book-dark.png`, `book-light.png` (fold and full) for the visual-companion comparison (spec §9.3). Requires a running production server on :3111.

- [ ] **Step 1: Snapshot path template**

In `web/playwright.config.ts`, inside `defineConfig({ … })`, add:

```ts
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
```

- [ ] **Step 2: The pin spec**

```ts
// web/tests/e2e/screenshots.spec.ts
// The anti-drift gate (spec §7, §9.4): the built pages must keep matching the
// composition the owner approved. Demo-scale fixtures so density is real.
// Local only — CI runners rasterize fonts differently.
import { expect, test, type Page, type Route } from "@playwright/test";
import { DEMO_BOOK, DEMO_META, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

test.skip(!!process.env.CI, "screenshot pins are a local gate; font rendering differs on CI runners");

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

async function mockDemo(page: Page) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/book", (route) => json(route, DEMO_BOOK));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.route("**/v1/positions*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return json(route, cursor === null ? DEMO_POSITIONS_DM_PAGE_1 : DEMO_POSITIONS_DM_PAGE_2);
  });
}

for (const theme of ["dark", "light"] as const) {
  for (const [name, path] of [["overview", "/"], ["book", "/book"]] as const) {
    test(`${name} · ${theme} · 1440×900`, async ({ page }) => {
      await page.addInitScript((t) => { try { localStorage.setItem("solvent-theme", t); } catch { /* private mode */ } }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockDemo(page);
      await page.goto(path, { waitUntil: "networkidle" });
      // The live pill's age ticks; freeze it by waiting for the walk to settle, then mask the pill.
      await expect(page.getByTestId(name === "book" ? "book-kpi-near" : "overview-live")).not.toHaveAttribute("aria-busy", "true");
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
        maxDiffPixelRatio: 0.01,
        mask: [page.getByTestId("live-pill"), page.locator("[data-chip='Snapshot']")],
      });
    });
  }
}
```

- [ ] **Step 3: Generate baselines, then verify they hold**

Run: `npm run build && npx playwright test --project=e2e tests/e2e/screenshots.spec.ts --update-snapshots` then `npx playwright test --project=e2e tests/e2e/screenshots.spec.ts`
Expected: 4 baselines written on the first run; 4 passed on the second. Open the four PNGs and compare against `docs/specs/2026-09-15-ui-mockups/` — this is the owner's side-by-side gate (spec §9.3): push the PNG next to the mockup in the visual companion and get a yes before the commit below.

- [ ] **Step 4: The companion script**

```js
// web/scripts/screenshot-pages.mjs — side-by-side gate helper (spec §9.3).
// Usage (from web/, with a production server on :3111): node scripts/screenshot-pages.mjs <outDir>
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = process.argv[2] ?? "screenshots";
mkdirSync(out, { recursive: true });
const fx = (name) => import(pathToFileURL(path.resolve("tests/fixtures", name)).href);
const demo = await fx("demo/index.ts");
const proof = await fx("proof.ts");
const CORS = { "access-control-allow-origin": "*" };
const json = (route, body) => route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("solvent-theme", t); } catch {} }, theme);
  for (const [name, url] of [["overview", "/"], ["book", "/book"]]) {
    const page = await ctx.newPage();
    await page.route("**/v1/stream**", (r) => r.abort());
    await page.route("**/v1/meta*", (r) => json(r, demo.DEMO_META));
    await page.route("**/v1/book", (r) => json(r, demo.DEMO_BOOK));
    await page.route("**/v1/evidence*", (r) => json(r, proof.EVIDENCE_MANIFEST));
    await page.route("**/v1/positions*", (r) => json(r, new URL(r.request().url()).searchParams.get("cursor") === null ? demo.DEMO_POSITIONS_DM_PAGE_1 : demo.DEMO_POSITIONS_DM_PAGE_2));
    await page.goto(`http://localhost:3111${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `${name}-${theme}-fold.png`) });
    await page.screenshot({ path: path.join(out, `${name}-${theme}-full.png`), fullPage: true });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(`wrote 8 screenshots to ${out}`);
```

Node 22 strips the TypeScript types in the fixture loaders at import time (the loaders have only `import type` and `node:` imports), so no build step is needed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/playwright.config.ts web/tests/e2e/screenshots.spec.ts web/tests/e2e/screenshots.spec.ts-snapshots web/scripts/screenshot-pages.mjs
python roadmap/tools/scope_gate.py
git commit -m "test(web): screenshot pins for Overview and Book at 1440x900 in both themes - the anti-drift gate"
```

---

### Task 16: Final verification, widths, and the Codex round

**Files:**
- Modify: `.superpowers/sdd/progress-ui-overhaul.md` (close-out entry)

- [ ] **Step 1: Full suites on a fresh build**

Run from `web/` with nothing listening on :3111:

```bash
npm run typecheck && npm run lint && npm run lint:css && npm run build && npx playwright test
```

Expected: unit + e2e green; record the counts.

- [ ] **Step 2: Widths and themes**

Run `node scripts/screenshot-pages.mjs ../.superpowers/brainstorm/plan1-final` against a running `npm run start`, then repeat the Book at 1366, 1920 and 2560 by editing the viewport in a one-off copy of the script (or via `npx playwright screenshot --viewport-size=1366,900 http://localhost:3111/book book-1366.png` with the API mocked off — the refused register must still lay out). Check: no horizontal scroll at 1366; the shell steps to 1520 at 1920 and 1680 at 2560 (`--shell-max`); nothing below 12px (`npm run lint:css` already proves it).

- [ ] **Step 3: Contrast spot-check**

In the browser at `/book` (dark, then light) run in DevTools: `getComputedStyle(document.querySelector('[data-testid="book-kpi-near"] div:nth-child(3)')).color` and confirm the sub-label color is `--ink-3` (`#71868e` dark / `#637075` light) on `--panel` — both ≥ 4.5:1 per the tokens.css amendment ledger. Any new color pair introduced by the kit (there should be none — every color is a token) gets the same check.

- [ ] **Step 4: The Codex round (spec §9.5)**

Dispatch one `codex-reviewer` review over `git diff <first-plan-commit>^..HEAD -- web/` scoped to *correctness and honesty regressions*: null/refused rendered as zero, sums across engines, materiality mis-tiering, 409 restart races, the walk's abort path, and copy drift from `lib/book-headline.ts`. Fix confirmed findings in a `fix(web): plan-1 codex round` commit; record findings and dispositions in the ledger.

- [ ] **Step 5: Close-out ledger entry and commit**

Append to `.superpowers/sdd/progress-ui-overhaul.md`:

```markdown
## 2026-09-15 · Plan 1 CLOSES — kit, Overview, Book
Suites: unit N / e2e M green on <commit>; typecheck/lint/lint:css clean; screenshot pins landed for
Overview + Book (dark/light, 1440×900); owner approved the side-by-side on <date>. Codex round: K
findings, dispositions above. Carried forward to Plan 2 (Inspector): AddressField, TrustChecklist,
Sparkline in the kit; Plan 4 (convergence): retire --t-*/--fs-* aliases, retire PostureRibbon/Ribbon/
Stampline/StatCard if still imported by History/Activity/Verification/API.
```

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add .superpowers/sdd/progress-ui-overhaul.md
python roadmap/tools/scope_gate.py
git commit -m "docs(sdd): plan 1 closes - kit, Overview and Book landed behind screenshot pins"
```

---

## Self-review notes (written with the plan)

- **Spec coverage.** §3.1 register → Tasks 8–9; §3.2 names → Tasks 10, 13 (nav labels, section qualifiers, drawer keeps wire names); §3.3 materiality → Tasks 3, 12, 13; §3.4 type scale → Task 1; §3.5 copy grammar → Task 5 (+ `unavailableHeadline` in Task 12); §4 kit → Tasks 8–10 (AddressField, TrustChecklist, Sparkline, ScenarioLibrary, TransitionHeatmap deferred to Plans 2–3 — they have no consumer in this plan); §5.1 Overview → Task 12; §5.2 Book → Task 13 (Collateral mix and the explorer link recorded as not carried, Task 14 ledger); §6 layout → Task 8 (responsive block), Task 16; §7 tests → Tasks 2–7, 11–15; §8 demo dataset → Task 11; §9 process → Tasks 15–16; §10 step 1 → this plan. Prices chip on the identity strip is deferred: `/v1/book` carries no price age; Plan 2 reads it from `/v1/params` for the Inspector and the Book can adopt it then.
- **Type consistency.** `Headline`/`Sum` defined in Task 5 and consumed unchanged in Tasks 12–13; `CashRow`/`SizedCashRow`/`RoomBand` from Task 4 consumed in Tasks 7, 12, 13; `IdentityChip` from Task 9 consumed in Tasks 12–13; `BookEngine`/`BadDebtEngine`/`HistogramEngine`/`BookResponse` exported from Task 7 and consumed in Task 13's `BookLegacy`/`BookMethodology`.
- **Known dependency on the generated schema names** (`PositionSummary`, `Waterfall`, `MetaResponse`, `EvidenceResponse`): each task that imports one says where to look if the name differs.
