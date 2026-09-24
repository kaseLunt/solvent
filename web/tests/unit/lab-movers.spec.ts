// The most-affected table: the wire's movers listed in the engine's own
// ranking, room from the Cash ratio, HF wads for the legacy market, the $100
// line as a display tier, a null verdict as "cannot say", and unreadable
// fields named. The caption names which accounts they are in the contract's
// own terms per engine, the order they are listed in, and the service's
// stated cap.
import { expect, test } from "@playwright/test";
import { MOVERS_CAP, moversCaption, moversTable, roomFromRatio, type MoversTable } from "../../lib/lab-movers";
import { cashEngine, legacyEngine } from "./helpers/run-book-engine";

/** A table as the reader builds it: `shown` rows in the engine's ranking, the wire's full count beside them (null when it failed its guard). */
const table = ({ shown, total }: { shown: number; total: number | null }): MoversTable => ({
  rows: Array.from({ length: shown }, (_, i) => ({
    account: `0x${String(i + 1).padStart(40, "0")}`,
    roomBefore: "5.0%",
    roomAfter: "−2.0%",
    overBefore: false,
    overAfter: true,
    hfBefore: null,
    hfAfter: null,
    debt: null,
    debtText: "—",
    tier: null,
    becomesLiquidatable: true,
  })),
  shown,
  total,
  note: "",
  decimals: 6,
  unreadable: total === null ? ["movers_total"] : [],
});
/** A table refused for its scale, built by the reader itself. */
const unreadableScale = (): MoversTable => moversTable(cashEngine({ 3: { 0: 1 } }, { usd_decimals: 1.5, movers_total: 1, movers_note: "" }));

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

test("roomFromRatio: the room a cap/debt ratio means as a signed percent of the cap, floored to a fixed tenth; over the cap is negative; no debt is a knowable no-room", () => {
  expect(roomFromRatio(5_012_500_000n, 4_822_000_000n)).toBe("3.8%");
  expect(roomFromRatio(10n, 4n)).toBe("60.0%");
  expect(roomFromRatio(4n, 4n)).toBe("0.0%");
  // Floored, so an over-cap room is never friendlier than it is, and never truncated to a zero that reads as "at cap".
  expect(roomFromRatio(3n, 4n)).toBe("−33.4%");
  expect(roomFromRatio(1_000_000n, 1_000_001n)).toBe("−0.1%");
  expect(roomFromRatio(0n, 4n)).toBe("Over cap");
  expect(roomFromRatio(5n, 0n)).toBe("No debt");
});

test("Cash movers: largest debt first, room today → after from the ratios, debt in the account register, tiers, verdicts", () => {
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
  expect(near.roomAfter).toBe("−37.5%");
  // The cell's ink follows the side: over the cap after the shock, inside it today.
  expect([near.overBefore, near.overAfter]).toEqual([false, true]);
  expect(near.debtText).toBe("$4,822");
  expect(near.tier).toBe("material");
  expect(near.becomesLiquidatable).toBe(true);
  expect(near.hfBefore).toBeNull();
  const two = t.rows[1]!;
  expect(two.roomBefore).toBe("25.0%");
  expect(two.roomAfter).toBe("−7.2%");
  expect(two.debtText).toBe("$1,500");
  const three = t.rows[2]!;
  expect(three.roomBefore).toBe("23.0%");
  expect(three.roomAfter).toBe("−9.9%");
  expect(three.debtText).toBe("$50");
  expect(three.tier).toBe("small");
  expect(three.becomesLiquidatable).toBeNull();
  const four = t.rows[3]!;
  expect(four.roomBefore).toBe("28.5%");
  expect(four.roomAfter).toBe("−2.1%");
  expect(four.debtText).toBe("—");
  expect(four.tier).toBeNull();
  expect(four.becomesLiquidatable).toBe(false);
  expect(moversCaption(t, "debt_manager")).toBe(
    "The 4 largest of the 118 accounts that become liquidatable, by debt · listed largest debt first · the service returns at most 20",
  );
});

test("the debt column prints at one precision, picked once from its own figures: whole dollars when any is $1,000 or more, else cents", () => {
  const cents = moversTable(
    cashEngine(
      { 3: { 0: 1 } },
      {
        movers: [mover("0x00000000000000000000000000000000000d0001", "2000000000", "1500000000", "812500000", true), mover("0x00000000000000000000000000000000000d0002", "2000000000", "1500000000", "50000000", true)],
        movers_total: 2,
        movers_note: "",
      },
    ),
  );
  expect(cents.rows.map((r) => r.debtText)).toEqual(["$812.50", "$50.00"]);
  const whole = moversTable(
    cashEngine(
      { 3: { 0: 1 } },
      {
        movers: [mover("0x00000000000000000000000000000000000d0001", "2000000000", "1500000000", "4200000000", true), mover("0x00000000000000000000000000000000000d0002", "2000000000", "1500000000", "812500000", true)],
        movers_total: 2,
        movers_note: "",
      },
    ),
  );
  expect(whole.rows.map((r) => r.debtText)).toEqual(["$4,200", "$812"]);
});

test("the movers caption says which accounts they are, in the contract's own terms, the order they are listed in, and the service's cap", () => {
  // The cap is the contract's own ("BOUNDED to the top 20"), never read off the length of one answer.
  expect(MOVERS_CAP).toBe(20);
  expect(moversCaption(table({ shown: 20, total: 118 }), "debt_manager")).toBe(
    "The 20 largest of the 118 accounts that become liquidatable, by debt · listed largest debt first · the service returns at most 20",
  );
  expect(moversCaption(table({ shown: 5, total: 5 }), "debt_manager")).toBe("All 5 accounts that become liquidatable · listed largest debt first");
  expect(moversCaption(table({ shown: 1, total: 1 }), "debt_manager")).toBe("The 1 account that becomes liquidatable");
  expect(moversCaption(table({ shown: 20, total: 300 }), "aave_v3_etherfi")).toBe(
    "The 20 largest health-factor drops of 300 accounts · listed largest drop first · the service returns at most 20",
  );
  expect(moversCaption(table({ shown: 5, total: 5 }), "aave_v3_etherfi")).toBe("All 5 accounts whose health factor drops · listed largest drop first");
  expect(moversCaption(table({ shown: 1, total: 1 }), "aave_v3_etherfi")).toBe("The 1 account whose health factor drops");
  expect(moversCaption(table({ shown: 20, total: null }), "debt_manager")).toBe("20 accounts shown · listed largest debt first · total not stated");
  expect(moversCaption(table({ shown: 20, total: null }), "aave_v3_etherfi")).toBe("20 accounts shown · listed largest drop first · total not stated");
  expect(moversCaption(unreadableScale(), "debt_manager")).toBe("Not readable: unreadable scale");
  // No arm says "moved": that verb is the web's band count in the dek, and the lane tile is a third population.
  for (const shown of [0, 1, 5, 20]) {
    for (const total of [null, 0, 1, 5, 118]) {
      for (const engine of ["debt_manager", "aave_v3_etherfi"] as const) {
        expect(moversCaption(table({ shown, total }), engine)).not.toMatch(/\bmoved?\b/);
      }
    }
  }
});

test("no mover is a count the service stated; a list its own count cannot hold is said as it stands, never as all of them", () => {
  expect(moversCaption(table({ shown: 0, total: 0 }), "debt_manager")).toBe("No account becomes liquidatable");
  // The legacy zero claims only what the service's note licenses: no health factor it measured on both sides strictly
  // dropped. An account with no debt has none to drop and is not counted, so the zero is never "no account's" anything.
  expect(moversCaption(table({ shown: 0, total: 0 }), "aave_v3_etherfi")).toBe(
    "Of the health factors measured today and after the shock, none drops · an account with no debt has none to drop",
  );
  expect(moversCaption(table({ shown: 0, total: 0 }), "aave_v3_etherfi")).not.toMatch(/\bno account\b/);
  expect(moversCaption(table({ shown: 5, total: 3 }), "debt_manager")).toBe("5 accounts shown · listed largest debt first · the service states 3 in all");
  expect(moversCaption(table({ shown: 0, total: 5 }), "aave_v3_etherfi")).toBe("0 accounts shown · the service states 5 in all");
  // A list longer than the stated cap is never captioned "at most 20" — the rows on the page would contradict it.
  expect(moversCaption(table({ shown: 25, total: 118 }), "debt_manager")).toBe(
    "The 25 largest of the 118 accounts that become liquidatable, by debt · listed largest debt first",
  );
});

const account = (n: number) => `0x${String(n).padStart(40, "0")}`;
const aaveMover = (n: number, before: string, after: string, drop: string | null) => ({
  account: account(n),
  engine: "aave_v3_etherfi",
  hf_before_wad: before,
  hf_after_wad: after,
  hf_drop_wad: drop,
  hf_before_num: null,
  hf_before_den: null,
  hf_after_num: null,
  hf_after_den: null,
  became_eligible: null,
  debt_usd: null,
});

test("Cash rows are listed largest debt first whatever order they arrive in; equal debts keep their order, and a debt absent or unreadable goes last", () => {
  // Arrival ordered by room today: the caption states the table's order, so the table keeps it whatever the wire's.
  const engine = cashEngine(
    { 3: { 0: 1 } },
    {
      movers: [
        mover(account(1), "1003400000", "1000000000", "12621352543", true),
        mover(account(2), "1003500000", "1000000000", "45061282814", true),
        mover(account(3), "1003600000", "1000000000", null, true),
        mover(account(4), "1004600000", "1000000000", "0x10", true),
        mover(account(5), "1005100000", "1000000000", "48501009860", true),
        mover(account(6), "1008400000", "1000000000", "45061282814", true),
      ],
      movers_total: 118,
      movers_note: "",
    },
  );
  const t = moversTable(engine);
  expect(t.rows.map((r) => r.account)).toEqual([account(5), account(2), account(6), account(1), account(3), account(4)]);
  expect(t.rows.map((r) => r.roomBefore)).toEqual(["0.5%", "0.3%", "0.8%", "0.3%", "0.3%", "0.4%"]);
  // An unreadable field is named by its place on the wire, not by its row in the table.
  expect(t.unreadable).toEqual(["movers[3].debt_usd"]);
  expect(moversCaption(t, "debt_manager")).toBe(
    "The 6 largest of the 118 accounts that become liquidatable, by debt · listed largest debt first · the service returns at most 20",
  );
});

test("legacy rows are listed largest drop first whatever order they arrive in; a drop absent or unreadable goes last, and an unreadable one is named", () => {
  const engine = legacyEngine(
    { 4: { 0: 1 } },
    {
      movers: [
        aaveMover(1, "1100000000000000000", "1050000000000000000", "50000000000000000"),
        aaveMover(2, "1400000000000000000", "980000000000000000", "420000000000000000"),
        aaveMover(3, "1200000000000000000", "1000000000000000000", "2e17"),
        aaveMover(4, "1300000000000000000", "1100000000000000000", null),
        aaveMover(5, "1250000000000000000", "1050000000000000000", "200000000000000000"),
      ],
      movers_total: 5,
      movers_note: "",
    },
  );
  const t = moversTable(engine);
  expect(t.rows.map((r) => r.account)).toEqual([account(2), account(5), account(1), account(3), account(4)]);
  expect(t.rows.map((r) => r.hfBefore)).toEqual(["1.4", "1.25", "1.1", "1.2", "1.3"]);
  expect(t.unreadable).toEqual(["movers[2].hf_drop_wad"]);
  expect(moversCaption(t, "aave_v3_etherfi")).toBe("All 5 accounts whose health factor drops · listed largest drop first");
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
  expect(moversCaption(t, "aave_v3_etherfi")).toBe("The 1 account whose health factor drops");
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
  expect(t.rows[0]?.roomBefore).toBe("Unreadable");
  expect(t.rows[0]?.debtText).toBe("Unreadable");
  expect(t.rows[0]?.tier).toBeNull();
  expect(t.total).toBeNull();
  expect(t.unreadable).toEqual(["movers[0].hf_before_num", "movers[0].debt_usd", "movers_total"]);
  expect(moversCaption(t, "debt_manager")).toBe("1 account shown · total not stated");
  const badScale = moversTable(cashEngine({ 3: { 0: 1 } }, { usd_decimals: 1.5, movers: [mover("0x00000000000000000000000000000000000d0001", "2", "1", "5", true)], movers_total: 1, movers_note: "" }));
  expect(badScale.rows).toEqual([]);
  expect(badScale.unreadable).toEqual(["usd_decimals"]);
  expect(moversCaption(badScale, "debt_manager")).toBe("Not readable: unreadable scale");
});

test("a ratio pair with one side null names the null side and prints unreadable; a null pair is a dash", () => {
  const engine = cashEngine(
    { 3: { 0: 1 } },
    {
      movers: [{ ...mover("0x00000000000000000000000000000000000d0005", "1300000000", "1000000000", "50000000", true), hf_before_den: null, hf_after_num: null, hf_after_den: null }],
      movers_total: 1,
      movers_note: "",
    },
  );
  const t = moversTable(engine);
  expect(t.rows[0]?.roomBefore).toBe("Unreadable");
  expect(t.rows[0]?.roomAfter).toBe("—");
  expect(t.unreadable).toEqual(["movers[0].hf_before_den"]);
});
