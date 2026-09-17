### Task 5: `lab-movers` — the most-affected accounts (R4, R5)

**Files:**
- Create: `web/lib/lab-movers.ts`
- Test: `web/tests/unit/lab-movers.spec.ts`

**Interfaces:**
- Consumes: `lib/book-format.ts` (`hfDisplayFromWad`), `lib/human-price.ts` (`humanUsdFull`), `lib/materiality.ts` (`materialityTier`, `MaterialityTier`), `lib/percent.ts` (`percentTenths`, `formatTenths`), `lib/wireGuard.ts`, `lib/prose.ts` (`groupInt`).
- Produces: `MoverRow`, `MoversTable`, `moversTable(engine: RunBookEngine): MoversTable`, `moversCaption(table): string`, `roomFromRatio(num, den): string`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-movers.spec.ts
// The most-affected table: the wire's movers in the wire's order, room from
// the Cash ratio, HF wads for the legacy market, the $100 line as a display
// tier, a null verdict as "cannot say", and unreadable fields named.
import { expect, test } from "@playwright/test";
import { moversCaption, moversTable, roomFromRatio } from "../../lib/lab-movers";
import { cashEngine, legacyEngine } from "./helpers/run-book-engine";

const mover = (account: string, num: string, den: string, debt: string | null, became: boolean | null) => ({
  account,
  engine: "debt_manager",
  hf_before_wad: null,
  hf_after_wad: null,
  hf_drop_wad: null,
  hf_before_num: num,
  hf_before_den: den,
  hf_after_num: String(BigInt(num) * 7n),
  hf_after_den: String(BigInt(den) * 10n),
  became_eligible: became,
  debt_usd: debt,
});

test("roomFromRatio: the room a cap/debt ratio means, floored to tenths; at or over the cap says so; no debt is a knowable no-room", () => {
  expect(roomFromRatio(5_012_500_000n, 4_822_000_000n)).toBe("3.8%");
  expect(roomFromRatio(10n, 4n)).toBe("60%");
  expect(roomFromRatio(4n, 4n)).toBe("at cap");
  expect(roomFromRatio(3n, 4n)).toBe("over cap");
  expect(roomFromRatio(5n, 0n)).toBe("no debt");
});

test("Cash movers: wire order, room today → after from the ratios, debt in the account register, tiers, verdicts", () => {
  const engine = cashEngine(
    { 3: { 0: 2 }, 5: { 2: 1 } },
    {
      movers: [
        mover("0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e", "5012500000", "4822000000", "4822000000", true),
        mover("0x00000000000000000000000000000000000d0002", "2000000000", "1500000000", "1500000000", true),
        mover("0x00000000000000000000000000000000000d0003", "1300000000", "1000000000", "50000000", null),
        mover("0x00000000000000000000000000000000000d0004", "1400000000", "1000000000", null, false),
      ],
      movers_total: 118,
      movers_note: "ranked by the drop in the engine's own ratio; the top 20 of 118",
    },
  );
  const t = moversTable(engine);
  expect(t.decimals).toBe(6);
  expect(t.total).toBe(118);
  expect(t.shown).toBe(4);
  expect(t.note).toBe("ranked by the drop in the engine's own ratio; the top 20 of 118");
  expect(t.unreadable).toEqual([]);
  expect(t.rows.map((r) => r.account)).toEqual([
    "0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e",
    "0x00000000000000000000000000000000000d0002",
    "0x00000000000000000000000000000000000d0003",
    "0x00000000000000000000000000000000000d0004",
  ]);
  const near = t.rows[0]!;
  expect(near.roomBefore).toBe("3.8%");
  expect(near.roomAfter).toBe("over cap");
  expect(near.debtText).toBe("$4,822");
  expect(near.tier).toBe("material");
  expect(near.becomesLiquidatable).toBe(true);
  expect(near.hfBefore).toBeNull();
  const two = t.rows[1]!;
  expect(two.roomBefore).toBe("25%");
  expect(two.roomAfter).toBe("over cap");
  expect(two.debtText).toBe("$1,500");
  const three = t.rows[2]!;
  expect(three.roomBefore).toBe("23%");
  expect(three.roomAfter).toBe("over cap");
  expect(three.debtText).toBe("$50");
  expect(three.tier).toBe("small");
  expect(three.becomesLiquidatable).toBeNull();
  const four = t.rows[3]!;
  expect(four.roomBefore).toBe("28.5%");
  expect(four.roomAfter).toBe("over cap");
  expect(four.debtText).toBe("—");
  expect(four.tier).toBeNull();
  expect(four.becomesLiquidatable).toBe(false);
  expect(moversCaption(t)).toBe("showing 4 of 118 accounts moved");
});

test("legacy movers speak wads; a null side is a dash, never a zero", () => {
  const engine = legacyEngine(
    { 4: { 0: 1 } },
    {
      movers: [
        {
          account: "0xAAaA000000000000000000000000000000000001",
          engine: "aave_v3_etherfi",
          hf_before_wad: "1080000000000000000",
          hf_after_wad: "756000000000000000",
          hf_drop_wad: "324000000000000000",
          hf_before_num: null,
          hf_before_den: null,
          hf_after_num: null,
          hf_after_den: null,
          became_eligible: null,
          debt_usd: null,
        },
      ],
      movers_total: 1,
      movers_note: "n",
    },
  );
  const t = moversTable(engine);
  expect(t.rows[0]?.hfBefore).toBe("1.08");
  expect(t.rows[0]?.hfAfter).toBe("0.75");
  expect(t.rows[0]?.roomBefore).toBe("—");
  expect(t.rows[0]?.debtText).toBe("—");
  expect(moversCaption(t)).toBe("showing 1 of 1 account moved");
});

test("unreadable fields are named and never printed as numbers; an unreadable scale refuses the whole table", () => {
  const engine = cashEngine({ 3: { 0: 1 } }, { movers: [mover("0x00000000000000000000000000000000000d0001", "1e9", "1000000000", "0x10", true)], movers_total: -1, movers_note: "" });
  const t = moversTable(engine);
  expect(t.rows[0]?.roomBefore).toBe("unreadable");
  expect(t.rows[0]?.debtText).toBe("unreadable");
  expect(t.rows[0]?.tier).toBeNull();
  expect(t.total).toBeNull();
  expect(t.unreadable).toEqual(["movers[0].hf_before_num", "movers[0].debt_usd", "movers_total"]);
  expect(moversCaption(t)).toBe("showing 1 account moved · total not stated");
  const badScale = moversTable(cashEngine({ 3: { 0: 1 } }, { usd_decimals: 1.5, movers: [mover("0x00000000000000000000000000000000000d0001", "2", "1", "5", true)], movers_total: 1, movers_note: "" }));
  expect(badScale.rows).toEqual([]);
  expect(badScale.unreadable).toEqual(["usd_decimals"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-movers.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-movers'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-movers.ts
// The most-affected accounts: the wire's `movers`, in the wire's order, each
// side's room from the Cash ratio (cap ÷ debt) or the legacy market's health
// factor from its wad. Every field passes the guards; a field that fails is
// named and its cell prints "unreadable", never a number.
import type { components } from "@solvent/client";
import { hfDisplayFromWad } from "./book-format";
import { humanUsdFull } from "./human-price";
import { materialityTier, type MaterialityTier } from "./materiality";
import { formatTenths, percentTenths } from "./percent";
import { groupInt } from "./prose";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
export type RunBookEngine = Schemas["RunBookEngine"];
export type RunBookMover = Schemas["RunBookMover"];

export interface MoverRow {
  readonly account: string;
  readonly roomBefore: string;
  readonly roomAfter: string;
  readonly hfBefore: string | null;
  readonly hfAfter: string | null;
  readonly debt: bigint | null;
  readonly debtText: string;
  readonly tier: MaterialityTier | null;
  readonly becomesLiquidatable: boolean | null;
}

export interface MoversTable {
  readonly rows: readonly MoverRow[];
  readonly shown: number;
  readonly total: number | null;
  readonly note: string;
  readonly decimals: number;
  readonly unreadable: readonly string[];
}

/** The room a cap ÷ debt ratio means, floored to tenths. */
export function roomFromRatio(num: bigint, den: bigint): string {
  if (den === 0n) return "no debt";
  if (num === den) return "at cap";
  if (num < den) return "over cap";
  const tenths = percentTenths(num - den, num);
  return tenths === null ? "unreadable" : formatTenths(tenths);
}

function ratio(num: string | null, den: string | null, at: string, unreadable: string[]): string {
  if (num === null || den === null) return "—";
  const n = isWireDecimal(num);
  const d = isWireDecimal(den);
  if (!n) unreadable.push(`${at}_num`);
  if (!d) unreadable.push(`${at}_den`);
  if (!n || !d) return "unreadable";
  return roomFromRatio(BigInt(num), BigInt(den));
}

function wad(value: string | null, at: string, unreadable: string[]): string | null {
  if (value === null) return null;
  if (!isWireDecimal(value)) {
    unreadable.push(at);
    return "unreadable";
  }
  return hfDisplayFromWad(value);
}

export function moversTable(engine: RunBookEngine): MoversTable {
  const unreadable: string[] = [];
  const decimals = engine.usd_decimals;
  if (!isWireScale(decimals)) {
    return { rows: [], shown: 0, total: null, note: engine.movers_note, decimals: 0, unreadable: ["usd_decimals"] };
  }
  const rows: MoverRow[] = engine.movers.map((m, i) => {
    const at = `movers[${String(i)}]`;
    const roomBefore = ratio(m.hf_before_num, m.hf_before_den, `${at}.hf_before`, unreadable);
    const roomAfter = ratio(m.hf_after_num, m.hf_after_den, `${at}.hf_after`, unreadable);
    const hfBefore = wad(m.hf_before_wad, `${at}.hf_before_wad`, unreadable);
    const hfAfter = wad(m.hf_after_wad, `${at}.hf_after_wad`, unreadable);
    let debt: bigint | null = null;
    let debtText = "—";
    if (m.debt_usd !== null) {
      if (isWireDecimal(m.debt_usd)) {
        debt = BigInt(m.debt_usd);
        debtText = humanUsdFull(debt, decimals);
      } else {
        unreadable.push(`${at}.debt_usd`);
        debtText = "unreadable";
      }
    }
    return {
      account: m.account,
      roomBefore,
      roomAfter,
      hfBefore,
      hfAfter,
      debt,
      debtText,
      tier: debt === null ? null : materialityTier(debt, decimals),
      becomesLiquidatable: m.became_eligible,
    };
  });
  let total: number | null = engine.movers_total;
  if (!isWirePopulation(engine.movers_total)) {
    unreadable.push("movers_total");
    total = null;
  }
  return { rows, shown: rows.length, total, note: engine.movers_note, decimals, unreadable };
}

export function moversCaption(t: MoversTable): string {
  const noun = (n: number) => `${groupInt(n)} account${n === 1 ? "" : "s"} moved`;
  if (t.total === null) return `showing ${noun(t.shown)} · total not stated`;
  return `showing ${groupInt(t.shown)} of ${noun(t.total)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-movers.spec.ts`
Expected: 4 passed. `hfDisplayFromWad("756000000000000000")` must print `0.75` (the Book's two-decimal truncation) — if it prints `0.756`, read `lib/book-format.ts:140` and pin what it does; the law is the Book's.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-movers.ts web/tests/unit/lab-movers.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-movers - the most-affected accounts in the wire's order, room from the Cash ratio, wads for the legacy market, the materiality tier as display, unreadable fields named" -- web/lib/lab-movers.ts web/tests/unit/lab-movers.spec.ts
```

---
