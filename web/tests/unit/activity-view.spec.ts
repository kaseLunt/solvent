// The Activity page's one view model: header, chips, tiles, table rows, the
// list's qualifier and notices, the state cards, the live strip's line, empty
// words and doctrine, derived once from the walk's state. The headline IS
// feedTakeaway's two parts under the neutral tone (a record is ink); the dek is
// facts computed from the loaded rows; before the first page answers nothing is
// counted; the rows carry the list's row law (the untimed tail dim with its
// block number, the unit tags, the record-only word); every count is groupInt
// over the loaded window. An instant in prose is humanUtc's (U+00A0 joins,
// hence `nb`), its year by the envelope's own served_at.
import { expect, test } from "@playwright/test";
import {
  ACTIVITY_AMOUNT_HEADER,
  ACTIVITY_CLEAR_FILTER_DEK,
  ACTIVITY_DRIFT,
  ACTIVITY_EXHAUSTED_DEK,
  ACTIVITY_FORENSICS,
  ACTIVITY_INTRO,
  ACTIVITY_LIST_TITLE,
  ACTIVITY_LIVE_LABEL,
  ACTIVITY_LIVE_LAW,
  ACTIVITY_LIVE_NOTE,
  ACTIVITY_LOADING_DEK,
  ACTIVITY_SINCE_FULL,
  ACTIVITY_SINCE_NOTE,
  ACTIVITY_SINCE_SHORT,
  ACTIVITY_TAIL_NOTE,
  ACTIVITY_TAIL_NOTICE,
  ACTIVITY_TAIL_NOTICE_UNORDERED,
  ACTIVITY_WHEN_HEADER,
  ALL_ENGINES,
  BONUS_MARK,
  END_OF_FEED,
  FILTER_LABEL,
  SERVICE_SAID,
  TYPE_WORDS,
  UNTIMED_WHEN,
  activeFilter,
  activityScales,
  deriveActivityView,
  deriveLiveStrip,
  notABlockNumberNotice,
  sinceBlockDroppedNotice,
  typeLabel,
  type ActivityInput,
  type LiquidationPart,
  type LiveStripInput,
  type NotePart,
} from "../../lib/activity-view";
import { EVENT_DISPLAY_TYPES } from "../../lib/feed-data";
import { LIQUIDATION_WORDS, RAW_UNITS_TAG, RECORD_ONLY_TITLE, RECORD_ONLY_WORD, feedTakeaway } from "../../lib/feed-view";
import { EM_DASH, shortHex, truncateAddress } from "../../lib/format";
import { DEMO_BOOK, DEMO_FEED_PAGE_1 } from "../fixtures/demo";
import { FEED_CROSS_PAGE_1, FEED_ENGINE_AAVE_PAGE_1, FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";

const ROWS = DEMO_FEED_PAGE_1.events;

/** humanUtc joins its tokens with U+00A0: an instant inside an expectation is written through this. */
const nb = (text: string): string => text.replaceAll(" ", " ");

/** The header's one sentence, as the page prints it: the emphasis, a space, the rest. */
const h1 = (input: ActivityInput): string => {
  const { emphasis, rest } = deriveActivityView(input).headline;
  return rest === "" ? emphasis : `${emphasis} ${rest}`;
};

/** The demo page as the surface hands it over: cross-engine, page one loaded, a cursor behind it, DM's scale from the wire. */
const base = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  rows: ROWS,
  mode: "cross-engine",
  hasMore: DEMO_FEED_PAGE_1.next_cursor !== null,
  engine: null,
  view: "all",
  types: [],
  sinceBlock: null,
  envelope: { filter: DEMO_FEED_PAGE_1.filter, limit: DEMO_FEED_PAGE_1.limit, served_at: DEMO_FEED_PAGE_1.served_at },
  refusal: null,
  failure: null,
  valueDecimals: { debt_manager: 6 },
  ...over,
});

const chip = (input: ActivityInput, label: string) => deriveActivityView(input).chips.find((c) => c.label === label);
const chipValue = (input: ActivityInput, label: string): string | undefined => chip(input, label)?.value;

/** The note's words as a reader sees them: every part's text, a bold part's own parts read in turn. */
const plainNote = (parts: readonly NotePart[]): string =>
  parts.map((part) => (part.kind === "strong" ? plainNote(part.parts) : part.text)).join("");

/** The extract's line as the table prints it: every part's text, in order. */
const plainLine = (parts: readonly LiquidationPart[]): string => parts.map((part) => part.text).join("");

const BAD_CURSOR = "400 bad_request: events page: cursor was minted for a engine-scoped page but this request is cross-engine-mode (http://x/v1/events?cursor=c)";

test("rows: 50 from the demo page; the last two are the untimed tail — dim, their block numbers where the time would be; every other row carries its custodied time, with the wire's instant as its title", () => {
  const v = deriveActivityView(base());
  expect(v.rows).toHaveLength(50);
  expect(v.rows.slice(0, 48).every((r) => !r.dim)).toBe(true);
  expect(v.rows[48]).toMatchObject({ dim: true, when: "block 155,318,218", engine: "Cash", type: "repay", whenTitle: UNTIMED_WHEN });
  expect(v.rows[49]).toMatchObject({ dim: true, when: "block 25,713,780", engine: "Aave v3 market (legacy)", type: "borrow" });
  // The When column is the exact instant typeset: every wire field, date and time joined by U+00A0, no zone word —
  // the header names the zone once, and each cell's title is the wire's own ISO.
  expect(ACTIVITY_WHEN_HEADER).toBe("When (UTC)");
  expect(ROWS[0]?.block_time).toBe("2026-08-08T20:21:05Z");
  expect(v.rows[0]?.when).toBe("2026-08-08 20:21:05");
  expect(v.rows[0]?.whenTitle).toBe("2026-08-08T20:21:05Z");
  expect(v.rows.every((r) => r.whenTitle !== "")).toBe(true);
  expect(UNTIMED_WHEN).toBe("No block time yet: the block number stands in, never an invented time.");
  expect(v.rows[0]?.dim).toBe(false);
  // The key is the row's own chain coordinates; the test id hangs on it.
  expect(v.rows[0]?.key).toBe(`10·${ROWS[0]?.tx_hash ?? ""}·38·0`);
});

test("rows: a liquidation and a bad-debt realization are key records — ink set apart by weight, never a crit pill — each liquidation with its typed extract; every other type is the plain record and carries no extract", () => {
  const v = deriveActivityView(base());
  const liquidations = v.rows.filter((r) => r.type === "liquidation");
  expect(liquidations).toHaveLength(3);
  expect(liquidations.every((r) => r.tone === "key")).toBe(true);
  const key = v.rows.filter((r) => r.tone === "key");
  expect(key.map((r) => r.type).sort()).toEqual(["deficit_created", "liquidation", "liquidation", "liquidation"]);
  expect(v.rows.filter((r) => r.type !== "liquidation" && r.type !== "deficit_created").every((r) => r.tone === "info")).toBe(true);
  expect(v.rows.some((r) => (r.tone as string) === "crit")).toBe(false);
  expect(v.rows.filter((r) => r.type !== "liquidation").every((r) => r.detail === null)).toBe(true);
  // The extract as parts the table prints visibly: the liquidator with its Inspector link, the amounts in the
  // extract's own units, an unestablished bonus an em dash with the footnote's mark (never an estimate), the
  // configured one in bps.
  expect(liquidations[0]?.detail).toMatchObject({
    liquidator: "0xBBbB000000000000000000000000000000000002",
    liquidatorHref: "/inspector/0xBBbB000000000000000000000000000000000002",
    repaid: "2,500",
    repaidUnit: "USDC",
    seized: "0.65625 weETH",
    bonusRealized: `${EM_DASH}${BONUS_MARK}`,
    bonusConfigured: "500 bps",
  });
  expect(BONUS_MARK).toBe("†");
  expect(plainNote(liquidations[0]?.detail?.note ?? [])).toContain("never estimated");
  // The DM extracts carry no configured bonus: a marked dash, never "0"; their repaid figure is the Debt Manager's own USD.
  expect(liquidations[1]?.detail).toMatchObject({ repaidUnit: "USD", bonusRealized: `${EM_DASH}${BONUS_MARK}`, bonusConfigured: `${EM_DASH}${BONUS_MARK}` });
  expect(liquidations[1]?.detail?.bonusConfigured).not.toContain("0");
  expect(liquidations[2]?.detail?.liquidatorHref).toBe(`/inspector/${ROWS[37]?.liquidation?.liquidator ?? ""}`);
});

test("the bonus footnote is said once, under the table, for exactly the engines whose loaded rows print a marked dash — and every clause is the service's own reason, never an estimate", () => {
  const v = deriveActivityView(base());
  expect(v.bonusNote).toBe(
    "† Not established, so never estimated: on the legacy Aave v3 market the realized bonus would need event-time prices this service does not re-read; Cash records its bonuses in its own 100e18 denomination, not in basis points, so neither is converted.",
  );
  // Only the legacy row: its clause alone.
  const legacy = ROWS[5];
  if (legacy?.liquidation === null || legacy?.liquidation === undefined) throw new Error("fixture: row 5 is the legacy liquidation");
  expect(deriveActivityView(base({ rows: [legacy] })).bonusNote).toBe(
    "† Not established, so never estimated: on the legacy Aave v3 market the realized bonus would need event-time prices this service does not re-read.",
  );
  // A legacy configured bonus the service's parameter record does not cover: its own clause.
  expect(deriveActivityView(base({ rows: [{ ...legacy, liquidation: { ...legacy.liquidation, configured_bonus_bps: null } }] })).bonusNote).toBe(
    "† Not established, so never estimated: on the legacy Aave v3 market the realized bonus would need event-time prices this service does not re-read, and the configured bonus is not stated where the service holds no parameter record for the event's block.",
  );
  // Every bonus established, or no liquidation loaded: no mark, no footnote.
  const settled = { ...legacy, liquidation: { ...legacy.liquidation, realized_bonus_bps: "480" } };
  expect(deriveActivityView(base({ rows: [settled] })).bonusNote).toBeNull();
  expect(plainLine(deriveActivityView(base({ rows: [settled] })).rows[0]?.detail?.line ?? [])).not.toContain(BONUS_MARK);
  expect(deriveActivityView(base({ rows: ROWS.filter((e) => e.type !== "liquidation") })).bonusNote).toBeNull();
  // An unreadable bonus is the unreadable word, never marked as unestablished.
  const skewed = deriveActivityView(base({ rows: [{ ...legacy, liquidation: { ...legacy.liquidation, realized_bonus_bps: "1.5" } }] }));
  expect(skewed.rows[0]?.detail?.bonusRealized).toBe("unreadable");
  expect(skewed.bonusNote).toBeNull();
});

test("the surface's notices and the foot's words come from here: the since-block removal in reader words with the number grouped, the not-a-block-number quote at most 32 characters, the end of the list and the page size", () => {
  expect(sinceBlockDroppedNotice(25635600, null)).toBe(
    "The since-block filter (25,635,600) was removed: a block number only means something on one chain, and no single engine is selected.",
  );
  expect(sinceBlockDroppedNotice(25635600, "aave_v3_etherfi")).toBe(
    "The since-block filter (25,635,600) was removed: a block number only means something on one chain, and Aave v3 market (legacy) is on a different one.",
  );
  expect(sinceBlockDroppedNotice(25635600, "debt_manager")).toContain("and Cash is on a different one.");
  // A typed number past the safe integers prints as typed, never re-rounded into digits the reader did not enter.
  expect(sinceBlockDroppedNotice(1e30, null)).toContain("(1e+30)");
  expect(sinceBlockDroppedNotice(25635600, null)).not.toContain("since_block");
  expect(notABlockNumberNotice("abc")).toBe('"abc" is not a block number, so nothing was requested.');
  expect(notABlockNumberNotice("x".repeat(40))).toBe(`"${"x".repeat(32)}" is not a block number, so nothing was requested.`);
  expect(END_OF_FEED).toBe("End of the list.");
  expect(deriveActivityView(base()).pageSize).toBe("Loads 50 at a time");
  // The page size is the envelope's own echo; with none yet it is not guessed.
  expect(deriveActivityView(base({ envelope: null })).pageSize).toBeNull();
});

test("rows: amounts follow the feed's unit law — DM scaled by the wire's own value_decimals, Aave raw (grouped, never scaled) and tagged, a record-only row a dash with its word in the unit cell; the unit's hover survives", () => {
  const scaled = deriveActivityView(base()).rows;
  expect(scaled[0]).toMatchObject({ amount: "252.733333", unit: "normalized debt · USDC" });
  expect(scaled[0]?.unitTitle).toContain("Debt Manager normalized debt units at the engine's own value_decimals");
  expect(scaled[0]?.amountTag).toBeNull();

  // An unscaled figure carries its raw word IN the Amount cell, beside the digits; the unit cell does not say it twice.
  const raw = deriveActivityView(base({ valueDecimals: {} })).rows;
  expect(raw[0]).toMatchObject({ amount: "252,733,333", amountTag: RAW_UNITS_TAG, unit: "normalized debt · USDC" });

  const aaveIndex = ROWS.findIndex((e) => e.engine === "aave_v3_etherfi" && e.amount !== null);
  expect(ROWS[aaveIndex]?.amount).toBe("180771428");
  expect(scaled[aaveIndex]).toMatchObject({ amount: "180,771,428", amountTag: RAW_UNITS_TAG, unit: "aave-scaled · USDC" });
  for (const [i, row] of scaled.entries()) {
    expect(row.unit).not.toContain(RAW_UNITS_TAG);
    const event = ROWS[i];
    expect(row.amountTag).toBe(event?.amount !== null && event?.engine === "aave_v3_etherfi" ? RAW_UNITS_TAG : null);
  }

  const recordOnlyIndex = ROWS.findIndex((e) => e.amount === null);
  expect(scaled[recordOnlyIndex]).toMatchObject({ amount: EM_DASH, amountTag: null, recordOnly: true, unit: "record-only", unitTitle: RECORD_ONLY_TITLE });
  expect(RECORD_ONLY_WORD).toBe("record-only");
  expect(scaled.filter((r) => r.recordOnly).every((r) => r.amount === EM_DASH && r.unit === RECORD_ONLY_WORD)).toBe(true);
  expect(scaled.filter((r) => !r.recordOnly).every((r) => r.amount !== EM_DASH && r.unit !== RECORD_ONLY_WORD)).toBe(true);
  expect(ACTIVITY_AMOUNT_HEADER).toBe("Amount · engine units, not USD");

  // No unit here licenses a dollar figure.
  expect(scaled.some((r) => r.amount.includes("$") || r.unit.includes("$"))).toBe(false);
});

test("the digits of the Amount column align on one axis ONLY when the view is scoped to one engine: all engines is a list of two engines' figures, never one axis", () => {
  expect(deriveActivityView(base()).alignAmounts).toBe(false);
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).alignAmounts).toBe(true);
  expect(deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" })).alignAmounts).toBe(true);
});

test("the book's own value_decimals are a second scale source beneath the stream's: a Cash row prints its decimal point; a legacy scaled row stays raw and tagged, whatever the book says of its engine", () => {
  const fromBook = activityScales(null, DEMO_BOOK);
  expect(fromBook).toEqual({ debt_manager: 6, aave_v3_etherfi: 8 });
  const rows = deriveActivityView(base({ valueDecimals: fromBook })).rows;
  expect(rows[0]).toMatchObject({ amount: "252.733333", unit: "normalized debt · USDC" });
  const aaveIndex = ROWS.findIndex((e) => e.engine === "aave_v3_etherfi" && e.amount !== null);
  expect(rows[aaveIndex]).toMatchObject({ amount: "180,771,428", amountTag: RAW_UNITS_TAG, unit: "aave-scaled · USDC" });

  const bookWith = (engines: readonly unknown[]): unknown => ({ ...DEMO_BOOK, engines });
  expect(
    activityScales([{ engine: "debt_manager", value_decimals: 6 }], bookWith([{ engine: "debt_manager", value_decimals: 9 }, { engine: "aave_v3_etherfi", value_decimals: 8 }])),
  ).toEqual({ debt_manager: 6, aave_v3_etherfi: 8 });
  expect(activityScales([{ engine: "debt_manager", value_decimals: 6 }], null)).toEqual({ debt_manager: 6 });
  expect(activityScales([{ engine: "debt_manager", value_decimals: -1 }], bookWith([{ engine: "aave_v3_etherfi", value_decimals: 1.5 }]))).toEqual({});
  expect(activityScales([{ engine: "debt_manager", value_decimals: -1 }], bookWith([{ engine: "debt_manager", value_decimals: 6 }]))).toEqual({ debt_manager: 6 });
  expect(activityScales(null, bookWith([{ engine: 5, value_decimals: 6 }, { engine: "debt_manager" }, { engine: "aave_v3_etherfi", value_decimals: 1001 }]))).toEqual({});
  for (const answer of [undefined, null, "book", 7, {}, { engines: "all" }, { ...DEMO_BOOK, batch: null }, bookWith([null, { engine: "debt_manager", value_decimals: 6 }])]) {
    expect(activityScales(null, answer)).toEqual({});
  }
  expect(deriveActivityView(base({ valueDecimals: activityScales(null, null) })).rows[0]).toMatchObject({
    amount: "252,733,333",
    amountTag: RAW_UNITS_TAG,
    unit: "normalized debt · USDC",
  });
});

test("a liquidation names the unit it repaid: the Debt Manager's own USD, the legacy row's symbol — its debt asset shortened when no symbol is carried, a dash when neither is; a dash or an unreadable figure has no unit, and an unscaled figure is tagged raw, never dressed as dollars or tokens", () => {
  const liquidations = deriveActivityView(base()).rows.filter((r) => r.type === "liquidation");
  const line = (i: number): string => `debt repaid ${liquidations[i]?.detail?.repaid ?? ""} ${liquidations[i]?.detail?.repaidUnit ?? ""}`;
  expect(line(0)).toBe("debt repaid 2,500 USDC");
  expect(line(1)).toBe("debt repaid 0.35812 USD");
  expect(line(2)).toBe("debt repaid 0.409762 USD");

  const legacy = ROWS[5];
  if (legacy?.liquidation === null || legacy?.liquidation === undefined) throw new Error("fixture: row 5 is the legacy liquidation");
  const detail = (event: (typeof ROWS)[number]) => deriveActivityView(base({ rows: [event] })).rows[0]?.detail;
  const debtAsset = legacy.liquidation.debt_asset ?? "";
  expect(detail({ ...legacy, symbol: undefined })).toMatchObject({ repaid: "2,500", repaidUnit: truncateAddress(debtAsset) });
  expect(detail({ ...legacy, symbol: undefined, liquidation: { ...legacy.liquidation, debt_asset: null } })).toMatchObject({ repaid: "2,500", repaidUnit: EM_DASH });
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, debt_repaid: null } })).toMatchObject({ repaid: EM_DASH, repaidUnit: null });
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, debt_repaid: "1e6", debt_decimals: null } })).toMatchObject({ repaid: "unreadable", repaidUnit: null });
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, debt_repaid: "1e6" } })).toMatchObject({ repaid: "unreadable", repaidUnit: null });
  // No scale on the extract: the wire's digits, grouped and never scaled, tagged raw — never a USD or token figure.
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, debt_decimals: null } })).toMatchObject({ repaid: "2,500,000,000", repaidUnit: RAW_UNITS_TAG });
  const cash = ROWS[19];
  if (cash?.liquidation === null || cash?.liquidation === undefined) throw new Error("fixture: row 19 is a Cash liquidation");
  expect(detail({ ...cash, liquidation: { ...cash.liquidation, debt_decimals: null } })).toMatchObject({ repaid: "358,120", repaidUnit: RAW_UNITS_TAG });
  expect(detail({ ...cash, liquidation: { ...cash.liquidation, debt_decimals: -1 } })).toMatchObject({ repaid: "358,120", repaidUnit: RAW_UNITS_TAG });
  const leg = legacy.liquidation.seized[0];
  if (leg === undefined) throw new Error("fixture: the legacy liquidation seized one leg");
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, seized: [{ ...leg, amount: "6.5e17" }] } })?.seized).toBe("unreadable (weETH)");
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, seized: [{ ...leg, decimals: 1001 }] } })?.seized).toBe(`656,250,000,000,000,000 ${RAW_UNITS_TAG} (weETH)`);
});

test("the extract's line is the lib's, word for word, and starts with a capital: the liquidator's link, then the repaid figure with its unit, the seized legs and both bonus figures — the figures and the unit marked for the table", () => {
  const liquidations = deriveActivityView(base()).rows.filter((r) => r.type === "liquidation");
  const legacy = liquidations[0]?.detail;
  if (legacy === undefined || legacy === null) throw new Error("fixture: the legacy extract");
  expect(plainLine(legacy.line)).toBe("Liquidator 0xBBbB…0002 · debt repaid 2,500 USDC · seized 0.65625 weETH · bonus realized —† / configured 500 bps");
  expect(legacy.line.filter((part) => part.kind === "liquidator")).toEqual([
    { kind: "liquidator", text: "0xBBbB…0002", href: "/inspector/0xBBbB000000000000000000000000000000000002", title: "0xBBbB000000000000000000000000000000000002" },
  ]);
  expect(legacy.line.filter((part) => part.kind === "figure").map((part) => part.text)).toEqual(["2,500", "0.65625 weETH", `${EM_DASH}${BONUS_MARK}`, "500 bps"]);
  expect(legacy.line.filter((part) => part.kind === "unit").map((part) => part.text)).toEqual(["USDC"]);
  for (const word of Object.values(LIQUIDATION_WORDS)) expect(plainLine(legacy.line)).toContain(word);
  expect(plainLine(liquidations[1]?.detail?.line ?? [])).toContain("debt repaid 0.35812 USD · seized");
  const row = ROWS[5];
  if (row?.liquidation === null || row?.liquidation === undefined) throw new Error("fixture: row 5 is the legacy liquidation");
  const dashed = deriveActivityView(base({ rows: [{ ...row, liquidation: { ...row.liquidation, debt_repaid: null } }] })).rows[0]?.detail;
  expect(dashed?.line.filter((part) => part.kind === "unit")).toEqual([]);
  expect(plainLine(dashed?.line ?? [])).toContain(`debt repaid ${EM_DASH} · seized`);
  const skewed = deriveActivityView(
    base({ rows: [{ ...row, liquidation: { ...row.liquidation, configured_bonus_bps: "1e6", realized_bonus_bps: "1.5" } }] }),
  ).rows[0]?.detail;
  expect(skewed).toMatchObject({ bonusRealized: "unreadable", bonusConfigured: "unreadable" });
  expect(plainLine(skewed?.line ?? [])).toContain("bonus realized unreadable / configured unreadable");
  expect(plainLine(skewed?.line ?? [])).not.toContain("bps");
});

test("the wire's note keeps every word, its code spans read as code: it is the drawer's, once per distinct note, and never repeated under each row", () => {
  const legacy = ROWS[5];
  if (legacy?.liquidation === null || legacy?.liquidation === undefined) throw new Error("fixture: row 5 is the legacy liquidation");
  const wire = legacy.liquidation.note;
  expect(wire).toContain("`configured_bonus_bps`");
  const note = deriveActivityView(base({ rows: [legacy] })).rows[0]?.detail?.note ?? [];
  expect(note.flatMap((part) => (part.kind === "code" ? [part.text] : []))).toEqual(["configured_bonus_bps", "realized_bonus_bps"]);
  expect(plainNote(note)).toBe(wire.replaceAll("`", ""));
  const marked = deriveActivityView(base({ rows: [{ ...legacy, liquidation: { ...legacy.liquidation, note: "a **bold `x`** word and a lone ` tick" } }] })).rows[0]?.detail?.note;
  expect(marked).toEqual([
    { kind: "text", text: "a " },
    { kind: "strong", parts: [{ kind: "text", text: "bold " }, { kind: "code", text: "x" }] },
    { kind: "text", text: " word and a lone ` tick" },
  ]);
  expect(deriveActivityView(base({ rows: [{ ...legacy, liquidation: { ...legacy.liquidation, note: "" } }] })).rows[0]?.detail?.note).toEqual([]);
  // The drawer holds each distinct note once: the demo's two Cash liquidations share one note, the legacy row its own.
  const notes = deriveActivityView(base()).notes;
  expect(notes).toHaveLength(2);
  expect(notes.map(plainNote)).toContain(wire.replaceAll("`", ""));
  expect(deriveActivityView(base({ rows: ROWS.filter((e) => e.type !== "liquidation") })).notes).toEqual([]);
});

test("a wire type that names an Object.prototype member prints verbatim in the row, never the prototype", () => {
  const first = ROWS[0];
  if (first === undefined) throw new Error("fixture: the demo page has rows");
  for (const type of ["__proto__", "constructor", "toString"]) {
    const row = deriveActivityView(base({ rows: [{ ...first, type: type as (typeof ROWS)[number]["type"] }] })).rows[0];
    expect(row?.typeLabel).toBe(type);
  }
});

test("types print in sentence case — in the row and on the type buttons — with the wire word kept for the title; the headline says them in lower case inside its sentence", () => {
  expect(typeLabel("collateral_enabled")).toBe("Collateral enabled");
  expect(typeLabel("collateral_disabled")).toBe("Collateral disabled");
  expect(typeLabel("deficit_created")).toBe("Bad debt realized");
  expect(typeLabel("borrow")).toBe("Borrow");
  expect(typeLabel("flash_thing")).toBe("flash_thing");
  for (const type of EVENT_DISPLAY_TYPES) expect(typeLabel(type)).not.toContain("_");
  expect(Object.keys(TYPE_WORDS).sort()).toEqual(["collateral_disabled", "collateral_enabled", "deficit_created"]);

  const rows = deriveActivityView(base()).rows;
  expect(rows.find((r) => r.type === "deficit_created")).toMatchObject({ typeLabel: "Bad debt realized", tone: "key" });
  expect(rows.find((r) => r.type === "collateral_enabled")?.typeLabel).toBe("Collateral enabled");
  expect(rows.find((r) => r.type === "borrow")?.typeLabel).toBe("Borrow");
  expect(rows.every((r) => r.typeLabel === typeLabel(r.type))).toBe(true);

  const filtered = ROWS.filter((event) => event.type === "deficit_created" || event.type === "collateral_enabled");
  const types = ["deficit_created", "collateral_enabled"] as const;
  expect(h1(base({ rows: filtered, types, hasMore: false }))).toBe(
    `4 chain actions loaded, filtered to bad debt realized and collateral enabled; the newest at ${nb("Aug 8, 20:06 UTC")}; that is every action matching this filter.`,
  );
  const lone = ROWS.filter((event) => event.type === "deficit_created");
  expect(h1(base({ rows: lone, types: ["deficit_created"], hasMore: false }))).toBe(
    `1 chain action loaded, bad debt realized, at ${nb("Aug 8, 20:06 UTC")}; that is the only action matching this filter.`,
  );
});

test("rows: the tx link is the chain's explorer or null, its label the one hex shortener, its title the full hash with the row's chain coordinates (log always, block only beside a time, seq only when nonzero)", () => {
  const v = deriveActivityView(base());
  const first = ROWS[0];
  const last = ROWS[49];
  if (first === undefined || last === undefined) throw new Error("fixture: 50 rows expected");
  expect(v.rows[0]).toMatchObject({
    tx: `https://optimistic.etherscan.io/tx/${first.tx_hash}`,
    txLabel: shortHex(first.tx_hash),
    txTitle: `${first.tx_hash} · block 155,323,392 · log 38`,
    account: first.account,
  });
  expect(v.rows[0]?.txLabel).toBe("0x3354…e6bb");
  expect(v.rows[49]).toMatchObject({ tx: `https://etherscan.io/tx/${last.tx_hash}`, txTitle: `${last.tx_hash} · log 6` });
  const unknownChain = deriveActivityView(base({ rows: [{ ...first, chain_id: 8453, seq: 3 }] })).rows[0];
  expect(unknownChain?.tx).toBeNull();
  expect(unknownChain?.txTitle).toBe(`${first.tx_hash} (no explorer configured for chain 8453) · block 155,323,392 · log 38 · seq 3`);
});

test("engine-scoped: a null time is a per-row block fallback, never a tail — nothing dims; cross-engine drift is named, otherwise null", () => {
  const scoped = deriveActivityView(base({ rows: FEED_ENGINE_AAVE_PAGE_1.events, mode: "engine-scoped", engine: "aave_v3_etherfi", hasMore: false }));
  expect(scoped.rows.map((r) => r.when)).toEqual(["2026-07-29 09:57:11", "block 25,635,580"]);
  expect(scoped.rows.map((r) => r.whenTitle)).toEqual(["2026-07-29T09:57:11Z", UNTIMED_WHEN]);
  expect(scoped.rows.every((r) => !r.dim)).toBe(true);
  expect(scoped.drift).toBeNull();
  expect(deriveActivityView(base()).drift).toBeNull();

  const first = FEED_CROSS_PAGE_1.events[0];
  if (first === undefined) throw new Error("fixture: the timed head row expected");
  const drifted = [...FEED_CROSS_PAGE_1.events, { ...first, log_index: 43 }];
  const v = deriveActivityView(base({ rows: drifted, hasMore: false }));
  expect(v.drift).toEqual(ACTIVITY_DRIFT);
  expect(ACTIVITY_DRIFT).toEqual({
    head: "Ordering fault",
    body: "The service sent a timed row inside the untimed tail, which the ordering law forbids. Rows stay in wire order (re-sorting would hide the service bug); treat this walk as suspect.",
  });
  // A broken ordering claims no order and no newest anywhere on the page: the qualifier, the chip, the tail notice, the dek.
  expect(v.listQualifier).toBe("In the order the service sent");
  expect(v.chips.some((c) => c.label === "Newest")).toBe(false);
  expect(v.tailNote).toBeNull();
  expect(v.headline.rest).toContain("no newest is claimed");
  expect(v.headline.dek).toContain("1 has no block time yet.");
  expect(v.headline.dek).not.toContain("listed last");
  expect(v.rows.map((r) => r.dim)).toEqual([false, true, false]);
});

test("header: the kicker names the scope, the headline IS feedTakeaway's two parts under the neutral tone — a record is ink, never the health green — and the dek is the rows' own facts", () => {
  const v = deriveActivityView(base());
  expect(v.kicker).toBe("Activity · All engines");
  expect(ALL_ENGINES).toBe("All engines");
  const takeaway = feedTakeaway(ROWS, "cross-engine", true, { types: [], ledger: false, servedAt: DEMO_FEED_PAGE_1.served_at });
  expect(v.headline).toEqual({
    ...takeaway,
    tone: "neutral",
    dek: "1 of them records bad debt being realized. 21 are on Cash and 29 on the legacy Aave v3 market. 2 have no block time yet and are listed last, by chain and then block number.",
  });
  expect(v.headline.emphasis).toBe("3 liquidations among the 50 chain actions loaded,");
  expect(v.headline.rest).toBe(`the newest at ${nb("Aug 8, 20:21 UTC")}; more exist beyond these.`);
  expect(deriveActivityView(base({ envelope: null })).headline.rest).toBe(`the newest at ${nb("Aug 8, 2026, 20:21 UTC")}; more exist beyond these.`);
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).kicker).toBe("Activity · Cash");
  expect(deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" })).kicker).toBe("Activity · Aave v3 market (legacy)");
  const scoped = deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped", hasMore: false }));
  expect(scoped.headline.rest).toBe("the newest at block 155,323,392; that is every action matching this filter.");
  expect(v.state).toBe("ok");
});

test("the dek counts what is loaded, each sentence conditional on its own count: every number is the rows' own, the two engines side by side and never summed, the tail's order as the service keeps it", () => {
  const count = (test: (event: (typeof ROWS)[number]) => boolean): number => ROWS.filter(test).length;
  const deficits = count((e) => e.type === "deficit_created");
  const cash = count((e) => e.engine === "debt_manager");
  const legacy = count((e) => e.engine === "aave_v3_etherfi");
  const untimed = count((e) => e.block_time === null);
  expect([deficits, cash, legacy, untimed]).toEqual([1, 21, 29, 2]);
  expect(deriveActivityView(base()).headline.dek).toBe(
    `${String(deficits)} of them records bad debt being realized. ${String(cash)} are on Cash and ${String(legacy)} on the legacy Aave v3 market. ${String(untimed)} have no block time yet and are listed last, by chain and then block number.`,
  );
  const timed = ROWS.filter((e) => e.block_time !== null && e.type !== "deficit_created");
  expect(deriveActivityView(base({ rows: timed })).headline.dek).toBe("20 are on Cash and 27 on the legacy Aave v3 market.");
  const cashOnly = timed.filter((e) => e.engine === "debt_manager");
  expect(deriveActivityView(base({ rows: cashOnly })).headline.dek).toBe("All 20 are on Cash.");
  const oneCash = [...timed.filter((e) => e.engine === "aave_v3_etherfi"), ...cashOnly.slice(0, 1)];
  expect(deriveActivityView(base({ rows: oneCash })).headline.dek).toBe("1 is on Cash and 27 on the legacy Aave v3 market.");
  expect(deriveActivityView(base({ rows: FEED_CROSS_PAGE_1.events })).headline.dek).toBe(
    "1 is on Cash and 1 on the legacy Aave v3 market. 1 has no block time yet and is listed last, by chain and then block number.",
  );
  const deficit = ROWS.find((e) => e.type === "deficit_created");
  if (deficit === undefined) throw new Error("fixture: the demo page carries a deficit_created row");
  expect(deriveActivityView(base({ rows: [deficit, { ...deficit, log_index: 99 }, ...cashOnly] })).headline.dek).toBe(
    "2 of them record bad debt being realized. 20 are on Cash and 2 on the legacy Aave v3 market.",
  );
  const foreign = [...cashOnly.slice(0, 2), { ...deficit, type: "borrow" as const, engine: "morpho_blue" }];
  expect(deriveActivityView(base({ rows: foreign })).headline.dek).toBe("2 are on Cash and 1 on an engine this page does not name.");
  expect(deriveActivityView(base({ rows: [deficit] })).headline.dek).toBe("It records bad debt being realized. It is on the legacy Aave v3 market.");
  expect(deriveActivityView(base({ rows: cashOnly, engine: "debt_manager", mode: "engine-scoped" })).headline.dek).toBe(
    "Listed newest first, by block number on Cash's chain.",
  );
  for (const rows of [ROWS, timed, cashOnly, oneCash, foreign]) {
    expect(deriveActivityView(base({ rows })).headline.dek).not.toMatch(/\$|cursor|custod|in total|combined/);
  }
});

test("chips: Newest · Order · Loaded · Filter — the identity is never empty; Newest is the headline's instant in reader words with the wire's ISO as its title; the order key ALWAYS stays; the filter chip only while a filter narrows the list", () => {
  const v = deriveActivityView(base());
  expect(v.chips.map((c) => c.label)).toEqual(["Newest", "Order", "Loaded"]);
  expect(chip(base(), "Newest")).toEqual({ label: "Newest", value: nb("Aug 8, 20:21 UTC"), title: "2026-08-08T20:21:05Z" });
  expect(chipValue(base(), "Order")).toBe("by block time");
  expect(chipValue(base(), "Loaded")).toBe("50 · more available");
  expect(chipValue(base({ hasMore: false }), "Loaded")).toBe("50 · end of the list");
  // No chip restates a control: the scope is the kicker's, the view the toggle's.
  for (const gone of ["Scope", "View", "Filter applied", "Rows"]) expect(chipValue(base(), gone)).toBeUndefined();

  expect(chipValue(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" }), "Order")).toBe("by block number");
  expect(chip(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" }), "Newest")).toEqual({ label: "Newest", value: "block 155,323,392" });
  // Nothing loaded yet: no newest and no count — and still the order key, so the header never names nothing.
  expect(deriveActivityView(base({ rows: [], envelope: null })).chips.map((c) => c.label)).toEqual(["Order"]);
  expect(chipValue(base({ rows: ROWS.slice(48) }), "Newest")).toBeUndefined();
  // The error and refused states keep the order key; a refused continuation keeps the loaded rows' newest and count.
  const refusal = { status: 400, code: "bad_request", message: BAD_CURSOR };
  expect(deriveActivityView(base({ rows: [], refusal })).chips.map((c) => c.label)).toEqual(["Order"]);
  expect(deriveActivityView(base({ rows: [], failure: { status: 500, code: "internal", message: "boom" } })).chips.map((c) => c.label)).toEqual(["Order"]);
  expect(chipValue(base({ refusal }), "Newest")).toBe(nb("Aug 8, 20:21 UTC"));
  expect(chipValue(base({ refusal }), "Loaded")).toBe("50 · next page refused");
  expect(chipValue(base({ failure: { status: 500, code: "internal", message: "boom" } }), "Loaded")).toBe("50 · next page unavailable");
  expect(chipValue(base({ rows: [], hasMore: false }), "Loaded")).toBe("0 · end of the list");

  // The filter chip: the service's own echo of what narrows the list, in words — never the engine (the kicker's),
  // never the view (the toggle's), never the page size.
  expect(FILTER_LABEL).toBe("Filter");
  const echoed = base({
    engine: "aave_v3_etherfi",
    mode: "engine-scoped",
    types: ["borrow", "repay"],
    sinceBlock: 25635600,
    envelope: { filter: { engine: "aave_v3_etherfi", types: ["borrow", "repay"], since_block: 25635600 }, limit: 50, served_at: DEMO_FEED_PAGE_1.served_at },
  });
  expect(deriveActivityView(echoed).chips.map((c) => c.label)).toEqual(["Newest", "Order", "Loaded", "Filter"]);
  expect(chipValue(echoed, "Filter")).toBe("borrow and repay · from block 25,635,600");
  expect(chipValue(base({ engine: "debt_manager", mode: "engine-scoped" }), "Filter")).toBeUndefined();
  // Before the echo, the page's own choice; in the ledger view the pinned type is the view's word, not a filter.
  expect(chipValue(base({ envelope: null, types: ["deficit_created"] }), "Filter")).toBe("bad debt realized");
  expect(chipValue(base({ view: "ledger", types: [], envelope: { filter: { engine: null, types: ["liquidation"], since_block: null }, limit: 50, served_at: DEMO_FEED_PAGE_1.served_at } }), "Filter")).toBeUndefined();
  const served_at = DEMO_FEED_PAGE_1.served_at;
  expect(activeFilter({ filter: { engine: null, account: null, types: null, since_block: null }, limit: 50, served_at }, "all")).toBeNull();
  expect(activeFilter({ filter: { engine: "debt_manager", types: ["deficit_created", "collateral_enabled", "liquidation"], since_block: null }, limit: 1000, served_at }, "all")).toBe(
    "bad debt realized, collateral enabled and liquidation",
  );
  expect(activeFilter({ filter: { engine: null, account: "0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e", types: null, since_block: null }, limit: 25, served_at }, "all")).toBe("account 0x7a3f…c21e");
  // An echoed integer outside the population law is refused before render, never printed.
  expect(() => deriveActivityView(base({ envelope: { filter: { engine: null, types: null, since_block: -1 }, limit: 50, served_at } }))).toThrow(/since_block/);
  expect(() => deriveActivityView(base({ envelope: { filter: { engine: null, types: null, since_block: null }, limit: 1.5, served_at } }))).toThrow(/limit/);
});

test("tiles: liquidations and bad debt realized among the loaded rows, grouped — and a count the type filter excludes is never a zero", () => {
  const v = deriveActivityView(base());
  expect(v.tiles.liquidations).toEqual({ label: "Liquidations", value: "3", sub: "among the 50 loaded", state: null, stateWord: null });
  expect(v.tiles.deficits).toEqual({ label: "Bad debt realized", value: "1", sub: "among the 50 loaded", state: null, stateWord: null });
  const big = Array.from({ length: 1200 }, (_, i) => {
    const row = ROWS[i % 50];
    if (row === undefined) throw new Error("fixture: 50 rows expected");
    return { ...row, seq: i };
  });
  expect(deriveActivityView(base({ rows: big })).tiles.liquidations).toMatchObject({ value: "72", sub: "among the 1,200 loaded" });
  expect(deriveActivityView(base({ rows: big })).headline.emphasis).toBe("72 liquidations among the 1,200 chain actions loaded,");
  // The ledger pins the type to liquidation: its bad-debt count is not the chain's zero, it is filtered out.
  const ledger = deriveActivityView(base({ view: "ledger", rows: ROWS.filter((e) => e.type === "liquidation") }));
  expect(ledger.tiles.deficits).toEqual({ label: "Bad debt realized", value: "", sub: "The filter excludes it", state: "not-served", stateWord: "Filtered out" });
  expect(ledger.tiles.liquidations).toMatchObject({ value: "3", state: null });
  const borrows = deriveActivityView(base({ types: ["borrow"], rows: ROWS.filter((e) => e.type === "borrow") }));
  expect(borrows.tiles.liquidations.stateWord).toBe("Filtered out");
  expect(borrows.tiles.deficits.stateWord).toBe("Filtered out");
});

test("a refused page: the refused register, emphasis only; the dek in reader words and the next step; the service's verbatim words move into the state card's disclosure, said once; the table's empty row names the state", () => {
  const v = deriveActivityView(base({ refusal: { status: 400, code: "bad_request", message: BAD_CURSOR } }));
  expect(v.state).toBe("refused");
  expect(v.headline).toEqual({
    emphasis: "The next page was refused, after 50 chain actions loaded.",
    rest: "",
    tone: "refused",
    dek: "The service would not return the next page of the list. Start again from the newest actions.",
  });
  expect(v.refusal).toEqual({
    title: "Page refused",
    cause: "The rows below were served before it and still stand.",
    serviceSaid: { label: SERVICE_SAID, text: BAD_CURSOR },
    action: "Start from the newest",
  });
  expect(SERVICE_SAID).toBe("What the service said");
  expect(v.failure).toBeNull();
  expect(v.rows).toHaveLength(50);
  expect(v.tiles.liquidations).toMatchObject({ value: "3", state: null });
  const cold = deriveActivityView(base({ rows: [], refusal: { status: 400, code: null, message: "refused" } }));
  expect(cold.headline).toEqual({
    emphasis: "The service refused this page.",
    rest: "",
    tone: "refused",
    dek: "The service would not return this page of the list. Start again from the newest actions.",
  });
  expect(cold.refusal?.cause).toBe("No row of the list was read.");
  expect(cold.emptyText).toBe("Refused");
  // Nothing loaded behind a refusal is the refused register's word, never a zero and never a bare dash.
  expect(cold.tiles.liquidations).toEqual({ label: "Liquidations", value: "", sub: "This page was refused", state: "refused", stateWord: null });
  expect(cold.tiles.deficits).toMatchObject({ state: "refused", sub: "This page was refused" });
  expect(h1(base({ rows: [], refusal: { status: 400, code: null, message: "refused" } }))).not.toMatch(/\d/);
  const one = deriveActivityView(base({ rows: ROWS.slice(0, 1), refusal: { status: 400, code: "bad_request", message: "no" } }));
  expect(one.headline.emphasis).toBe("The next page was refused, after 1 chain action loaded.");
});

test("a refused walk offers no next page — with nothing loaded or with rows loaded: its cursor was refused, and the restart is the one way forward; the service's words are the card's disclosure alone", () => {
  const refusal = { status: 400, code: "bad_request", message: BAD_CURSOR };
  const cold = deriveActivityView(base({ rows: [], hasMore: true, envelope: null, refusal }));
  expect(cold.state).toBe("refused");
  expect(cold.foot).toBe("none");
  expect(deriveActivityView(base({ hasMore: true, refusal })).foot).toBe("none");
  expect(deriveActivityView(base()).foot).toBe("more");
  expect(deriveActivityView(base({ hasMore: false })).foot).toBe("end");
  expect(deriveActivityView(base({ rows: [], hasMore: true, envelope: null })).foot).toBe("more");
  expect(deriveActivityView(base({ rows: [], hasMore: false })).foot).toBe("end");
  expect(deriveActivityView(base({ rows: [], failure: { status: null, code: null, message: "boom" } })).foot).toBe("more");
  expect(deriveActivityView(base()).refusal).toBeNull();
  const elsewhere = [cold.kicker, cold.headline.emphasis, cold.headline.rest, cold.headline.dek, cold.emptyText, cold.refusal?.title ?? "", cold.refusal?.cause ?? "", cold.listQualifier, cold.tiles.liquidations.sub, ...cold.chips.map((c) => c.value)];
  for (const words of elsewhere) expect(words).not.toContain("cursor was minted");
  expect(cold.refusal?.serviceSaid?.text).toContain("cursor was minted for a engine-scoped page");
});

test("a failed fetch is never a refusal: the absent register, a plain-cause dek with the one status code, the unavailable card with the service's words disclosed and a retry; rows already loaded still stand; a refusal outranks a failure", () => {
  const failure = { status: 429, code: "rate_limited", message: "429 rate_limited: rate limit exceeded (http://x/v1/events)" };
  const v = deriveActivityView(base({ rows: [], failure }));
  expect(v.state).toBe("error");
  expect(v.headline).toEqual({
    emphasis: "Recorded chain actions could not be fetched.",
    rest: "",
    tone: "absent",
    dek: "The service did not return this page (HTTP 429), so no row of it is shown.",
  });
  expect(v.failure).toEqual({
    title: "Page unavailable",
    cause: "No row of the list was read.",
    serviceSaid: { label: SERVICE_SAID, text: failure.message },
    action: "Try again",
  });
  expect(v.refusal).toBeNull();
  expect(v.emptyText).toBe("Unavailable");
  // A fetch failure's tile word is Unavailable, never Refused.
  expect(v.tiles.liquidations).toEqual({ label: "Liquidations", value: "", sub: "This page could not be fetched", state: "unavailable", stateWord: null });
  const later = deriveActivityView(base({ failure: { status: null, code: null, message: "Failed to fetch" } }));
  expect(later.headline).toEqual({
    emphasis: "The next page could not be fetched, after 50 chain actions loaded.",
    rest: "",
    tone: "absent",
    dek: "The request for the next page did not reach the service; the rows below were served before it.",
  });
  expect(deriveActivityView(base({ failure: { status: 500, code: "internal", message: "x" } })).headline.dek).toBe(
    "The service did not return the next page (HTTP 500); the rows below were served before it.",
  );
  const both = deriveActivityView(base({ failure: { status: 500, code: null, message: "boom" }, refusal: { status: 400, code: "bad_request", message: "no" } }));
  expect(both.state).toBe("refused");
  expect(both.headline.emphasis).toBe("The next page was refused, after 50 chain actions loaded.");
});

test("exhausted: an empty list is a real answer in ink, and the H1 names the scope it answers for — engine, types and since-block, as the service echoed them — never an unscoped negative; a narrowed list offers to clear its filter", () => {
  const plain = deriveActivityView(base({ rows: [], hasMore: false }));
  expect(plain.state).toBe("exhausted");
  expect(plain.emptyText).toBe("No rows");
  expect(plain.headline).toEqual({ emphasis: "No chain action is recorded.", rest: "", tone: "neutral", dek: ACTIVITY_EXHAUSTED_DEK });
  expect(ACTIVITY_EXHAUSTED_DEK).toBe("That is the service's real answer, not a loading state.");
  expect(plain.clearFilter).toBe(false);
  expect(plain.tiles.liquidations).toEqual({ label: "Liquidations", value: "0", sub: "No rows loaded", state: null, stateWord: null });

  /** The service's echo of an applied filter, as an exhausted page carries it. */
  const echo = (filter: { engine?: string | null; types?: string[] | null; since_block?: number | null }) => ({
    filter: { engine: null, types: [], since_block: null, ...filter },
    limit: 50,
    served_at: DEMO_FEED_PAGE_1.served_at,
  });
  const typed = deriveActivityView(base({ rows: [], hasMore: false, types: ["deficit_created"], envelope: echo({ types: ["deficit_created"] }) }));
  expect(typed.headline.emphasis).toBe("No recorded chain action is a bad-debt realization.");
  expect(typed.headline.dek).toBe(ACTIVITY_CLEAR_FILTER_DEK);
  expect(ACTIVITY_CLEAR_FILTER_DEK).toBe("Clear the filter to see every recorded action.");
  expect(typed.clearFilter).toBe(true);
  expect(deriveActivityView(base({ rows: [], hasMore: false, types: ["borrow", "repay", "withdraw"], envelope: echo({ types: ["borrow", "repay", "withdraw"] }) })).headline.emphasis).toBe(
    "No recorded chain action is a borrow, a repay or a withdrawal.",
  );
  expect(deriveActivityView(base({ rows: [], hasMore: false, view: "ledger", envelope: echo({ types: ["liquidation"] }) })).headline.emphasis).toBe(
    "No recorded chain action is a liquidation.",
  );
  const scoped = deriveActivityView(
    base({ rows: [], hasMore: false, engine: "debt_manager", mode: "engine-scoped", sinceBlock: 25635600, types: ["liquidation"], envelope: echo({ engine: "debt_manager", types: ["liquidation"], since_block: 25635600 }) }),
  );
  expect(scoped.headline.emphasis).toBe("No recorded chain action on Cash since block 25,635,600 is a liquidation.");
  const legacy = base({ rows: [], hasMore: false, engine: "aave_v3_etherfi", mode: "engine-scoped", envelope: echo({ engine: "aave_v3_etherfi" }) });
  expect(deriveActivityView(legacy).headline.emphasis).toBe("No chain action is recorded on the legacy Aave v3 market.");
  expect(deriveActivityView(legacy).clearFilter).toBe(true);
  // Before the echo, the page's own choice scopes the sentence.
  expect(deriveActivityView(base({ rows: [], hasMore: false, view: "ledger", envelope: null })).headline.emphasis).toBe("No recorded chain action is a liquidation.");
  expect(`${typed.headline.emphasis} ${typed.headline.dek}`).not.toContain("_");
});

test("loading: no rows yet with a cursor ahead — NOTHING is counted: the headline names the load in the absent register and prints no digit, the dek says what will be here, the tiles are pending", () => {
  const v = deriveActivityView(base({ rows: [], hasMore: true, envelope: null }));
  expect(v.state).toBe("loading");
  expect(v.emptyText).toBe("Loading…");
  expect(v.headline).toEqual({
    emphasis: "Loading recorded chain actions…",
    rest: "",
    tone: "absent",
    dek: ACTIVITY_LOADING_DEK,
  });
  expect(ACTIVITY_LOADING_DEK).toBe("Borrows, repays, supplies, withdrawals and liquidations, as recorded from the chain.");
  expect(`${v.headline.emphasis}${v.headline.rest}${v.headline.dek}`).not.toMatch(/\d/);
  expect(v.tiles.liquidations).toEqual({ label: "Liquidations", value: "", sub: "", state: null, stateWord: null });
  for (const engine of [null, "debt_manager", "aave_v3_etherfi"] as const) {
    const arm = deriveActivityView(base({ rows: [], hasMore: true, envelope: null, engine, mode: engine === null ? "cross-engine" : "engine-scoped" }));
    expect(arm.headline.emphasis).toBe("Loading recorded chain actions…");
    expect(arm.chips.some((c) => c.label === "Newest")).toBe(false);
  }
  expect(deriveActivityView(base()).state).toBe("ok");
});

test("the list's head: its own name with the order in short form (six words at most); the tail's notice only when a tail is loaded; the drawer holds the doctrine in sentences that start with a capital", () => {
  const cross = deriveActivityView(base());
  expect(ACTIVITY_LIST_TITLE).toBe("Recorded chain actions");
  expect(cross.listQualifier).toBe("Newest first · by block time");
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).listQualifier).toBe("Newest first · by block number");
  for (const qualifier of [cross.listQualifier, "In the order the service sent"]) expect(qualifier.split(" ").filter((w) => w !== "·").length).toBeLessThanOrEqual(6);

  expect(cross.tailNote).toBe(ACTIVITY_TAIL_NOTICE);
  expect(ACTIVITY_TAIL_NOTICE).toBe("Rows with no block time yet come last, listed by chain and then block number; that tail is not in time order.");
  expect(deriveActivityView(base({ rows: ROWS.slice(0, 48) })).tailNote).toBeNull();
  const head = ROWS.slice(0, 48);
  const [cashTail, legacyTail] = [ROWS[48], ROWS[49]];
  if (cashTail === undefined || legacyTail === undefined) throw new Error("fixture: the demo page's two untimed rows expected");
  const swapped = deriveActivityView(base({ rows: [...head, legacyTail, cashTail] }));
  expect(swapped.tailNote).toBe(ACTIVITY_TAIL_NOTICE_UNORDERED);
  expect(ACTIVITY_TAIL_NOTICE_UNORDERED).toBe("Rows with no block time yet come last; that tail is not in time order.");
  expect(swapped.headline.dek.endsWith("2 have no block time yet and are listed last.")).toBe(true);
  expect(deriveActivityView(base({ rows: FEED_ENGINE_AAVE_PAGE_1.events, engine: "aave_v3_etherfi", mode: "engine-scoped" })).tailNote).toBeNull();

  expect(cross.doctrine).not.toContain(ACTIVITY_LIST_TITLE);
  for (const paragraph of cross.doctrine) {
    expect(paragraph).toMatch(/[.…]$/);
    expect(paragraph.charAt(0)).toBe(paragraph.charAt(0).toUpperCase());
  }
  expect(cross.doctrine).toEqual([
    ACTIVITY_INTRO,
    ACTIVITY_FORENSICS,
    ACTIVITY_TAIL_NOTE,
    "Ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are never compared across chains, and rows without header time follow in the disclosed untimed tail.",
    ACTIVITY_SINCE_NOTE,
    ACTIVITY_LIVE_NOTE,
  ]);
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).doctrine[3]).toBe(
    "Ordered by block height (block, tx, log, seq) DESC, because heights are comparable within Cash's own chain.",
  );
  expect(ACTIVITY_FORENSICS).toBe(
    "The block_time field is chain-asserted header custody: null until custodied, in which case the block number renders instead. A timestamp is never invented. Amounts are the engine's own accounting units, named per row, and a scaled or normalized value is never dressed up as a token or USD figure.",
  );
  expect(ACTIVITY_INTRO.endsWith("The two never blend.")).toBe(true);
  expect(ACTIVITY_SINCE_SHORT).toBe("Since block · choose one engine");
  expect(ACTIVITY_SINCE_NOTE).toBe(`${ACTIVITY_SINCE_FULL} That is a property of chains, not an error.`);
});

// ---- the live strip ----------------------------------------------------------

const SNAPSHOT_BATCH = FEED_POSTURE_SNAPSHOT.batch;

const strip = (over: Partial<LiveStripInput> = {}): LiveStripInput => ({
  streamState: "open",
  hasBase: true,
  batch: SNAPSHOT_BATCH,
  unavailable: null,
  degradation: null,
  ...over,
});

const said = (input: LiveStripInput): string =>
  deriveLiveStrip(input)
    .line.map((part) => part.text)
    .join("");

test("the live strip: one plain line in reader words — the batch grouped with no '#', refused rows said as the Book says them, engines named, a block per engine; only ids and numbers are figures; the law stays on the instrument in a few words", () => {
  const v = deriveLiveStrip(strip());
  expect(v.arm).toBe("batch");
  expect(said(strip())).toBe("Batch 1 · 4 positions, 2 not computed · Aave v3 market (legacy) at block 25,635,618 · Cash at block 154,796,552");
  expect(v.line.filter((part) => part.kind === "figure").map((part) => part.text)).toEqual(["1", "4", "2", "25,635,618", "154,796,552"]);
  expect(v.label).toBe(ACTIVITY_LIVE_LABEL);
  expect(ACTIVITY_LIVE_LABEL).toBe("Live stream · this connection only");
  expect(v.law).toBe(ACTIVITY_LIVE_LAW);
  expect(ACTIVITY_LIVE_LAW).toBe("This browser connection only — not a record. The list below is the record.");
  expect(v.degraded).toBeNull();
  if (SNAPSHOT_BATCH === null || SNAPSHOT_BATCH === undefined) throw new Error("fixture: the snapshot carries a batch");
  const big = { ...SNAPSHOT_BATCH, id: 18251, position_count: 1412, refused_count: 6, supersession: { ...SNAPSHOT_BATCH.supersession, superseded: true } };
  const superseded = deriveLiveStrip(strip({ batch: big, streamState: "waiting", hasBase: false }));
  expect(superseded.line.map((part) => part.text).join("")).toBe(
    "Batch 18,251 · 1,412 positions, 6 not computed · superseded, still served · received on an earlier connection · Aave v3 market (legacy) at block 25,635,618 · Cash at block 154,796,552",
  );
  expect(superseded.line.filter((part) => part.kind === "warn").map((part) => part.text)).toEqual(["superseded, still served"]);
  expect(said(strip({ batch: { ...SNAPSHOT_BATCH, position_count: 1 } }))).toContain("1 position, ");
  expect(said(strip({ batch: { ...SNAPSHOT_BATCH, id: -1, position_count: 1.5 } }))).toContain("Batch unreadable · unreadable positions, 2 not computed");
});

test("the live strip's other arms: no batch on this connection is said, never pretended; no servable batch with the age and the last good batch; a withheld engine named with its cause and code; the chip is the connection's whole claim, in sentence case, and no socket is green", () => {
  const none = deriveLiveStrip(strip({ batch: null, streamState: "waiting", hasBase: false }));
  expect(none.arm).toBe("none");
  expect(none.line).toEqual([{ text: "No batch has arrived on this connection yet, so nothing live is shown.", kind: "text" }]);
  expect(none.chip).toEqual({ label: "Reconnecting", tone: "warn" });
  expect(said(strip({ batch: null, streamState: "closed", hasBase: false }))).toBe("No batch arrived on this connection, so nothing live is shown.");
  const unavailable = strip({ unavailable: { staleSinceSeconds: 1205, lastGoodBatchId: 18250 } });
  expect(deriveLiveStrip(unavailable).arm).toBe("unavailable");
  expect(said(unavailable)).toBe("No batch can be served right now · the data held is 1,205s old · last good batch 18,250");
  expect(said(strip({ unavailable: { staleSinceSeconds: null, lastGoodBatchId: null } }))).toBe("No batch can be served right now");
  const degraded = deriveLiveStrip(
    strip({ degradation: { refused_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "custody of the flag set is unproven" }] } }),
  );
  expect(degraded.degraded).toMatch(/^Withheld now: Cash \(.+ · FLAG_CUSTODY_UNPROVEN\)$/);
  expect(deriveLiveStrip(strip({ degradation: { refused_engines: [] } })).degraded).toBeNull();
  expect(deriveLiveStrip(strip()).chip).toEqual({ label: "Streaming", tone: "accent" });
  expect(deriveLiveStrip(strip({ hasBase: false })).chip).toEqual({ label: "Awaiting first batch", tone: "unknown" });
  expect(deriveLiveStrip(strip({ streamState: "idle" })).chip).toEqual({ label: "Connecting", tone: "warn" });
  expect(deriveLiveStrip(strip({ streamState: "connecting" })).chip).toEqual({ label: "Connecting", tone: "warn" });
  expect(deriveLiveStrip(strip({ streamState: "closed" })).chip).toEqual({ label: "Closed", tone: "down" });
});

test("no public string on this page names the roadmap: not 'P4', not an 'outbox' — in any arm's header, notice, card, strip or doctrine", () => {
  const inputs: ActivityInput[] = [
    base(),
    base({ rows: [], hasMore: true, envelope: null }),
    base({ rows: [], hasMore: false }),
    base({ refusal: { status: 400, code: "bad_request", message: "no" } }),
    base({ rows: [], failure: { status: null, code: null, message: "boom" } }),
    base({ engine: "debt_manager", mode: "engine-scoped" }),
    base({ view: "ledger" }),
  ];
  const strips: LiveStripInput[] = [strip(), strip({ batch: null, streamState: "waiting", hasBase: false }), strip({ unavailable: { staleSinceSeconds: 5, lastGoodBatchId: 1 } })];
  const printed = [
    ...inputs.flatMap((input) => {
      const v = deriveActivityView(input);
      return [
        v.kicker,
        v.headline.emphasis,
        v.headline.rest,
        v.headline.dek,
        v.emptyText,
        v.refusal?.cause ?? "",
        v.failure?.cause ?? "",
        v.listQualifier,
        v.tailNote ?? "",
        v.bonusNote ?? "",
        ...v.doctrine,
        ...v.chips.map((c) => `${c.label} ${c.value}`),
        v.tiles.liquidations.sub,
        v.tiles.deficits.sub,
      ];
    }),
    ...strips.flatMap((input) => {
      const v = deriveLiveStrip(input);
      return [v.label, v.law, v.chip.label, v.degraded ?? "", ...v.line.map((part) => part.text)];
    }),
    ACTIVITY_SINCE_SHORT,
    ACTIVITY_SINCE_FULL,
    ACTIVITY_AMOUNT_HEADER,
    ACTIVITY_DRIFT.body,
    sinceBlockDroppedNotice(1, null),
    notABlockNumberNotice("x"),
  ].join("\n");
  expect(printed).not.toMatch(/\bP4\b/);
  expect(printed).not.toMatch(/outbox/i);
});
