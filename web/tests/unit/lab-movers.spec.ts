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
  // The Book's display law: three fraction digits, truncated (never rounded),
  // trailing zeros trimmed — 1.080 prints 1.08, 0.756 prints 0.756.
  expect(t.rows[0]?.hfBefore).toBe("1.08");
  expect(t.rows[0]?.hfAfter).toBe("0.756");
  expect(t.rows[0]?.roomBefore).toBe("—");
  expect(t.rows[0]?.debtText).toBe("—");
  expect(moversCaption(t)).toBe("showing 1 of 1 account moved");
});

test("unreadable fields are named and never printed as numbers; an unreadable scale refuses the whole table", () => {
  // The after side is derived from a readable numerator; only the before
  // numerator is the unreadable one, so exactly that field is named.
  const engine = cashEngine(
    { 3: { 0: 1 } },
    {
      movers: [{ ...mover("0x00000000000000000000000000000000000d0001", "1000000000", "1000000000", "0x10", true), hf_before_num: "1e9" }],
      movers_total: -1,
      movers_note: "",
    },
  );
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
