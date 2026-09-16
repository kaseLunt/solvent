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

