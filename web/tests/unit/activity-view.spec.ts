// The Activity page's one view model: header, chips, tiles, table rows, the
// list's qualifier and notices, the live strip's line, empty words and
// doctrine, derived once from the walk's state. The headline IS feedTakeaway's
// two parts under the neutral tone (a record is ink); the dek is facts
// computed from the loaded rows; before the first page answers nothing is
// counted; the rows carry the list's row law (the untimed tail dim with its
// block number, the unit tags, the record-only word); every count is groupInt
// over the loaded window. An instant in prose is humanUtc's (U+00A0 joins,
// hence `nb`), its year by the envelope's own served_at.
import { expect, test } from "@playwright/test";
import {
  ACTIVITY_AMOUNT_HEADER,
  ACTIVITY_DRIFT,
  ACTIVITY_EXHAUSTED_DEK,
  ACTIVITY_FORENSICS,
  ACTIVITY_INTRO,
  ACTIVITY_LIST_TITLE,
  ACTIVITY_LIVE_LABEL,
  ACTIVITY_LIVE_LAW,
  ACTIVITY_LIVE_NOTE,
  ACTIVITY_LOADING_DEK,
  ACTIVITY_METHOD,
  ACTIVITY_SINCE_FULL,
  ACTIVITY_SINCE_NOTE,
  ACTIVITY_SINCE_SHORT,
  ACTIVITY_TAIL_NOTE,
  ACTIVITY_TAIL_NOTICE,
  ACTIVITY_TAIL_NOTICE_UNORDERED,
  ALL_ENGINES,
  END_OF_FEED,
  FILTER_APPLIED_LABEL,
  LIQUIDATIONS_SUB,
  TYPE_WORDS,
  activityScales,
  appliedFilter,
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
import { EM_DASH, truncateAddress } from "../../lib/format";
import { DEMO_BOOK, DEMO_FEED_PAGE_1 } from "../fixtures/demo";
import { FEED_CROSS_PAGE_1, FEED_ENGINE_AAVE_PAGE_1, FEED_POSTURE_SNAPSHOT } from "../fixtures/feed";

const ROWS = DEMO_FEED_PAGE_1.events;

/** humanUtc joins its tokens with U+00A0: an instant inside an expectation is written through this. */
const nb = (text: string): string => text.replaceAll(" ", "\u00a0");

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
  error: null,
  valueDecimals: { debt_manager: 6 },
  ...over,
});

const chipValue = (input: ActivityInput, label: string): string | undefined =>
  deriveActivityView(input).chips.find((c) => c.label === label)?.value;

/** The note's words as a reader sees them: every part's text, a bold part's own parts read in turn. */
const plainNote = (parts: readonly NotePart[]): string =>
  parts.map((part) => (part.kind === "strong" ? plainNote(part.parts) : part.text)).join("");

/** The extract's line as the table prints it: every part's text, in order. */
const plainLine = (parts: readonly LiquidationPart[]): string => parts.map((part) => part.text).join("");

test("rows: 50 from the demo page; the last two are the untimed tail — dim, their block numbers where the time would be; every other row carries its custodied time", () => {
  const v = deriveActivityView(base());
  expect(v.rows).toHaveLength(50);
  expect(v.rows.slice(0, 48).every((r) => !r.dim)).toBe(true);
  expect(v.rows[48]).toMatchObject({ dim: true, when: "block 155,318,218", engine: "Cash", type: "repay" });
  expect(v.rows[49]).toMatchObject({ dim: true, when: "block 25,713,780", engine: "Aave v3 market (legacy)", type: "borrow" });
  expect(v.rows[0]?.when).toBe(ROWS[0]?.block_time);
  expect(v.rows[0]?.dim).toBe(false);
  // The key is the row's own chain coordinates; the test id hangs on it.
  expect(v.rows[0]?.key).toBe(`10·${ROWS[0]?.tx_hash ?? ""}·38·0`);
});

test("rows: three liquidations, each the crit tone with its typed extract behind the pill; the pool's own deficit is crit too; every other type is the plain tone and carries no extract", () => {
  const v = deriveActivityView(base());
  const liquidations = v.rows.filter((r) => r.type === "liquidation");
  expect(liquidations).toHaveLength(3);
  expect(liquidations.every((r) => r.tone === "crit")).toBe(true);
  // Severity per the canon: a liquidation and a deficit_created are crit; nothing else is.
  const crit = v.rows.filter((r) => r.tone === "crit");
  expect(crit.length).toBeGreaterThanOrEqual(3);
  expect(crit.every((r) => r.type === "liquidation" || r.type === "deficit_created")).toBe(true);
  expect(v.rows.filter((r) => r.type !== "liquidation" && r.type !== "deficit_created").every((r) => r.tone === "info")).toBe(true);
  expect(v.rows.filter((r) => r.type !== "liquidation").every((r) => r.detail === null)).toBe(true);
  // The extract as parts the table prints visibly: the liquidator with its Inspector link, the amounts in the
  // extract's own units, an unestablished bonus an em dash (never an estimate), the configured one in bps.
  expect(liquidations[0]?.detail).toMatchObject({
    liquidator: "0xBBbB000000000000000000000000000000000002",
    liquidatorHref: "/inspector/0xBBbB000000000000000000000000000000000002",
    repaid: "2,500",
    repaidUnit: "USDC",
    seized: "0.65625 weETH",
    bonusRealized: EM_DASH,
    bonusConfigured: "500 bps",
  });
  expect(plainNote(liquidations[0]?.detail?.note ?? [])).toContain("never estimated");
  // The DM extracts carry no debt asset and no configured bonus: null is a dash, never "0"; their repaid figure is
  // the Debt Manager's own USD unit.
  expect(liquidations[1]?.detail).toMatchObject({ repaidUnit: "USD", bonusRealized: EM_DASH, bonusConfigured: EM_DASH });
  expect(liquidations[1]?.detail?.bonusConfigured).not.toContain("0");
  expect(liquidations[2]?.detail?.liquidatorHref).toBe(`/inspector/${ROWS[37]?.liquidation?.liquidator ?? ""}`);
});

test("the surface's notices and the foot's word come from here: the since-block removal (no single engine, and another engine) in reader words with the number grouped, the not-a-block-number quote at most 32 characters, the end of the feed", () => {
  expect(sinceBlockDroppedNotice(25635600, null)).toBe(
    "The since-block filter (25,635,600) was removed: a block number only means something on one chain, and no single engine is selected.",
  );
  expect(sinceBlockDroppedNotice(25635600, "aave_v3_etherfi")).toBe(
    "The since-block filter (25,635,600) was removed: a block number only means something on one chain, and Aave v3 market (legacy) is on a different one.",
  );
  expect(sinceBlockDroppedNotice(25635600, "debt_manager")).toContain("and Cash is on a different one.");
  // A typed number past the safe integers prints as typed, never re-rounded into digits the reader did not enter.
  expect(sinceBlockDroppedNotice(1e30, null)).toContain("(1e+30)");
  // No notice speaks the wire's parameter name.
  expect(sinceBlockDroppedNotice(25635600, null)).not.toContain("since_block");
  expect(notABlockNumberNotice("abc")).toBe('"abc" is not a block number, so nothing was requested');
  expect(notABlockNumberNotice("x".repeat(40))).toBe(`"${"x".repeat(32)}" is not a block number, so nothing was requested`);
  expect(END_OF_FEED).toBe("end of the filtered feed");
  expect(deriveActivityView(base({ hasMore: false })).tiles.rows.sub).toBe(END_OF_FEED);
});

test("rows: amounts follow the feed's unit law — DM scaled by the wire's own value_decimals, Aave raw and tagged, a record-only row a dash with its word in the unit cell; the unit's hover survives", () => {
  const scaled = deriveActivityView(base()).rows;
  expect(scaled[0]).toMatchObject({ amount: "252.733333", unit: "normalized debt · USDC" });
  expect(scaled[0]?.unitTitle).toContain("Debt Manager normalized debt units at the engine's own value_decimals");

  expect(scaled[0]?.amountTag).toBeNull();

  // An unscaled figure carries its raw word IN the Amount cell, beside the digits; the unit cell does not say it twice.
  const raw = deriveActivityView(base({ valueDecimals: {} })).rows;
  expect(raw[0]).toMatchObject({ amount: "252733333", amountTag: RAW_UNITS_TAG, unit: "normalized debt · USDC" });

  const aaveIndex = ROWS.findIndex((e) => e.engine === "aave_v3_etherfi" && e.amount !== null);
  expect(scaled[aaveIndex]).toMatchObject({ amount: ROWS[aaveIndex]?.amount, amountTag: RAW_UNITS_TAG, unit: "aave-scaled · USDC" });
  // Scaled Cash beside raw legacy integers: every unscaled figure is tagged where it is read, and only those.
  for (const [i, row] of scaled.entries()) {
    expect(row.unit).not.toContain(RAW_UNITS_TAG);
    const event = ROWS[i];
    expect(row.amountTag).toBe(event?.amount !== null && event?.engine === "aave_v3_etherfi" ? RAW_UNITS_TAG : null);
  }

  const recordOnlyIndex = ROWS.findIndex((e) => e.amount === null);
  expect(scaled[recordOnlyIndex]).toMatchObject({ amount: EM_DASH, amountTag: null, recordOnly: true, unit: "record-only", unitTitle: RECORD_ONLY_TITLE });
  expect(RECORD_ONLY_WORD).toBe("record-only");
  // The numeric column holds only figures or dashes; the record's word is the unit cell's, flagged so the table sets
  // the dash as a statement, never a figure; every valued row is not.
  expect(scaled.filter((r) => r.recordOnly).every((r) => r.amount === EM_DASH && r.unit === RECORD_ONLY_WORD)).toBe(true);
  expect(scaled.filter((r) => !r.recordOnly).every((r) => r.amount !== EM_DASH && r.unit !== RECORD_ONLY_WORD)).toBe(true);
  expect(scaled[0]?.recordOnly).toBe(false);
  // The raw integer stays verbatim: alignment is the table's, never a reformat of the wire's digits.
  expect(raw[0]?.amount).toBe(ROWS[0]?.amount);
  expect(ACTIVITY_AMOUNT_HEADER).toBe("Amount · engine units, not USD");

  // No unit here licenses a dollar figure.
  expect(scaled.some((r) => r.amount.includes("$") || r.unit.includes("$"))).toBe(false);
});

test("the book's own value_decimals are a second scale source beneath the stream's: a Cash row prints its decimal point; a legacy scaled row stays raw and tagged, whatever the book says of its engine", () => {
  const fromBook = activityScales(null, DEMO_BOOK);
  expect(fromBook).toEqual({ debt_manager: 6, aave_v3_etherfi: 8 });
  const rows = deriveActivityView(base({ valueDecimals: fromBook })).rows;
  expect(rows[0]).toMatchObject({ amount: "252.733333", unit: "normalized debt · USDC" });
  expect(rows[0]?.unit).not.toContain(RAW_UNITS_TAG);
  // The legacy market's 8 is its base-currency scale, a different unit from a ray-scaled token amount: never applied.
  const aaveIndex = ROWS.findIndex((e) => e.engine === "aave_v3_etherfi" && e.amount !== null);
  expect(rows[aaveIndex]).toMatchObject({ amount: ROWS[aaveIndex]?.amount, amountTag: RAW_UNITS_TAG, unit: "aave-scaled · USDC" });

  // The stream wins where it describes an engine; the book fills only what the stream has not described.
  const bookWith = (engines: readonly unknown[]): unknown => ({ ...DEMO_BOOK, engines });
  expect(
    activityScales([{ engine: "debt_manager", value_decimals: 6 }], bookWith([{ engine: "debt_manager", value_decimals: 9 }, { engine: "aave_v3_etherfi", value_decimals: 8 }])),
  ).toEqual({ debt_manager: 6, aave_v3_etherfi: 8 });
  expect(activityScales([{ engine: "debt_manager", value_decimals: 6 }], null)).toEqual({ debt_manager: 6 });
  // A scale the guard refuses licenses nothing, from either source.
  expect(activityScales([{ engine: "debt_manager", value_decimals: -1 }], bookWith([{ engine: "aave_v3_etherfi", value_decimals: 1.5 }]))).toEqual({});
  expect(activityScales([{ engine: "debt_manager", value_decimals: -1 }], bookWith([{ engine: "debt_manager", value_decimals: 6 }]))).toEqual({ debt_manager: 6 });
  expect(activityScales(null, bookWith([{ engine: 5, value_decimals: 6 }, { engine: "debt_manager" }, { engine: "aave_v3_etherfi", value_decimals: 1001 }]))).toEqual({});
  // An answer that is not a book licenses nothing — judged whole, before any engine in it is read.
  for (const answer of [undefined, null, "book", 7, {}, { engines: "all" }, { ...DEMO_BOOK, batch: null }, bookWith([null, { engine: "debt_manager", value_decimals: 6 }])]) {
    expect(activityScales(null, answer)).toEqual({});
  }
  // No scale at all: the raw integer, tagged — the same arm as before any source answered.
  expect(deriveActivityView(base({ valueDecimals: activityScales(null, null) })).rows[0]).toMatchObject({
    amount: "252733333",
    amountTag: RAW_UNITS_TAG,
    unit: "normalized debt · USDC",
  });
});

test("a liquidation names the unit it repaid: the Debt Manager's own USD, the legacy row's symbol — its debt asset shortened when no symbol is carried, a dash when neither is; a dash or an unreadable figure has no unit, and an unscaled figure is tagged raw, never dressed as dollars or tokens", () => {
  const liquidations = deriveActivityView(base()).rows.filter((r) => r.type === "liquidation");
  const line = (i: number): string => `debt repaid ${liquidations[i]?.detail?.repaid ?? ""} ${liquidations[i]?.detail?.repaidUnit ?? ""}`;
  // The demo's Cash liquidations are sub-dollar positions: the figures are the fixture's own, exact, never truncated.
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
  // Not a wire decimal: the word, never its bytes, and no unit beside it — scaled or not.
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, debt_repaid: "1e6", debt_decimals: null } })).toMatchObject({ repaid: "unreadable", repaidUnit: null });
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, debt_repaid: "1e6" } })).toMatchObject({ repaid: "unreadable", repaidUnit: null });
  // No scale on the extract: the wire's digits verbatim, tagged raw — never grouped, never a USD or token figure.
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, debt_decimals: null } })).toMatchObject({ repaid: "2500000000", repaidUnit: RAW_UNITS_TAG });
  const cash = ROWS[19];
  if (cash?.liquidation === null || cash?.liquidation === undefined) throw new Error("fixture: row 19 is a Cash liquidation");
  expect(detail({ ...cash, liquidation: { ...cash.liquidation, debt_decimals: null } })).toMatchObject({ repaid: "358120", repaidUnit: RAW_UNITS_TAG });
  expect(detail({ ...cash, liquidation: { ...cash.liquidation, debt_decimals: -1 } })).toMatchObject({ repaid: "358120", repaidUnit: RAW_UNITS_TAG });
  // A seizure leg the guards refuse is never scaled and never a throw.
  const leg = legacy.liquidation.seized[0];
  if (leg === undefined) throw new Error("fixture: the legacy liquidation seized one leg");
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, seized: [{ ...leg, amount: "6.5e17" }] } })?.seized).toBe("unreadable (weETH)");
  expect(detail({ ...legacy, liquidation: { ...legacy.liquidation, seized: [{ ...leg, decimals: 1001 }] } })?.seized).toBe(`${leg.amount} ${RAW_UNITS_TAG} (weETH)`);
});

test("the extract's line is the lib's, word for word: the liquidator's link, then the repaid figure with its unit, the seized legs and both bonus figures — every word and separator from here, the figures and the unit marked for the table", () => {
  const liquidations = deriveActivityView(base()).rows.filter((r) => r.type === "liquidation");
  const legacy = liquidations[0]?.detail;
  if (legacy === undefined || legacy === null) throw new Error("fixture: the legacy extract");
  expect(plainLine(legacy.line)).toBe("liquidator 0xBBbB…0002 · debt repaid 2,500 USDC · seized 0.65625 weETH · bonus realized — / configured 500 bps");
  expect(legacy.line.filter((part) => part.kind === "liquidator")).toEqual([
    { kind: "liquidator", text: "0xBBbB…0002", href: "/inspector/0xBBbB000000000000000000000000000000000002", title: "0xBBbB000000000000000000000000000000000002" },
  ]);
  expect(legacy.line.filter((part) => part.kind === "figure").map((part) => part.text)).toEqual(["2,500", "0.65625 weETH", EM_DASH, "500 bps"]);
  expect(legacy.line.filter((part) => part.kind === "unit").map((part) => part.text)).toEqual(["USDC"]);
  // The words are the one set both surfaces print.
  for (const word of Object.values(LIQUIDATION_WORDS)) expect(plainLine(legacy.line)).toContain(word);
  expect(plainLine(liquidations[1]?.detail?.line ?? [])).toContain("debt repaid 0.35812 USD · seized");
  // A dash has no unit part: nothing is named beside a figure that is not there.
  const row = ROWS[5];
  if (row?.liquidation === null || row?.liquidation === undefined) throw new Error("fixture: row 5 is the legacy liquidation");
  const dashed = deriveActivityView(base({ rows: [{ ...row, liquidation: { ...row.liquidation, debt_repaid: null } }] })).rows[0]?.detail;
  expect(dashed?.line.filter((part) => part.kind === "unit")).toEqual([]);
  expect(plainLine(dashed?.line ?? [])).toContain(`debt repaid ${EM_DASH} · seized`);
  // A bonus outside the Decimal pattern is the unreadable word, never its bytes with "bps" beside them.
  const skewed = deriveActivityView(
    base({ rows: [{ ...row, liquidation: { ...row.liquidation, configured_bonus_bps: "1e6", realized_bonus_bps: "1.5" } }] }),
  ).rows[0]?.detail;
  expect(skewed).toMatchObject({ bonusRealized: "unreadable", bonusConfigured: "unreadable" });
  expect(plainLine(skewed?.line ?? [])).toContain("bonus realized unreadable / configured unreadable");
  expect(plainLine(skewed?.line ?? [])).not.toContain("bps");
});

test("the wire's note keeps every word, its code spans read as code: no backtick prints, and an unbalanced marker stays literal", () => {
  const legacy = ROWS[5];
  if (legacy?.liquidation === null || legacy?.liquidation === undefined) throw new Error("fixture: row 5 is the legacy liquidation");
  const wire = legacy.liquidation.note;
  expect(wire).toContain("`configured_bonus_bps`");
  const note = deriveActivityView(base({ rows: [legacy] })).rows[0]?.detail?.note ?? [];
  expect(note.flatMap((part) => (part.kind === "code" ? [part.text] : []))).toEqual(["configured_bonus_bps", "realized_bonus_bps"]);
  expect(plainNote(note)).toBe(wire.replaceAll("`", ""));
  expect(plainNote(note)).not.toContain("`");
  // Bold reads its own code spans; a lone marker is the note's own character.
  const marked = deriveActivityView(base({ rows: [{ ...legacy, liquidation: { ...legacy.liquidation, note: "a **bold `x`** word and a lone ` tick" } }] })).rows[0]?.detail?.note;
  expect(marked).toEqual([
    { kind: "text", text: "a " },
    { kind: "strong", parts: [{ kind: "text", text: "bold " }, { kind: "code", text: "x" }] },
    { kind: "text", text: " word and a lone ` tick" },
  ]);
  // No note carried: no parts, so nothing prints.
  expect(deriveActivityView(base({ rows: [{ ...legacy, liquidation: { ...legacy.liquidation, note: "" } }] })).rows[0]?.detail?.note).toEqual([]);
});

test("a wire type that names an Object.prototype member prints verbatim in the row, never the prototype", () => {
  const first = ROWS[0];
  if (first === undefined) throw new Error("fixture: the demo page has rows");
  for (const type of ["__proto__", "constructor", "toString"]) {
    const row = deriveActivityView(base({ rows: [{ ...first, type: type as (typeof ROWS)[number]["type"] }] })).rows[0];
    expect(row?.typeLabel).toBe(type);
  }
});

test("the three raw enum words print plain — in the row and on the type buttons — with the wire word kept for the title; every other type is its own word", () => {
  expect(typeLabel("collateral_enabled")).toBe("collateral enabled");
  expect(typeLabel("collateral_disabled")).toBe("collateral disabled");
  expect(typeLabel("deficit_created")).toBe("bad debt realized");
  for (const word of ["borrow", "repay", "supply", "withdraw", "liquidation"]) expect(typeLabel(word)).toBe(word);
  // A word outside the vocabulary is printed as the wire sent it, never guessed at.
  expect(typeLabel("flash_thing")).toBe("flash_thing");
  // Every display type has a printed word, and none of them is a wire id with an underscore.
  for (const type of EVENT_DISPLAY_TYPES) expect(typeLabel(type)).not.toContain("_");
  expect(Object.keys(TYPE_WORDS).sort()).toEqual(["collateral_disabled", "collateral_enabled", "deficit_created"]);

  const rows = deriveActivityView(base()).rows;
  const deficit = rows.find((r) => r.type === "deficit_created");
  expect(deficit).toMatchObject({ typeLabel: "bad debt realized", tone: "crit" });
  expect(rows.find((r) => r.type === "collateral_enabled")?.typeLabel).toBe("collateral enabled");
  expect(rows.find((r) => r.type === "borrow")?.typeLabel).toBe("borrow");
  expect(rows.every((r) => r.typeLabel === typeLabel(r.type))).toBe(true);

  // The headline speaks the same words: a type filter, and a one-row answer, never print the wire's id.
  const filtered = ROWS.filter((event) => event.type === "deficit_created" || event.type === "collateral_enabled");
  const types = ["deficit_created", "collateral_enabled"] as const;
  expect(h1(base({ rows: filtered, types, hasMore: false }))).toBe(
    `4 chain actions loaded, filtered to bad debt realized and collateral enabled; the newest at ${nb("Aug 8, 20:06 UTC")}; that is every action matching this filter.`,
  );
  const lone = ROWS.filter((event) => event.type === "deficit_created");
  expect(h1(base({ rows: lone, types: ["deficit_created"], hasMore: false }))).toBe(
    `1 chain action loaded, bad debt realized, at ${nb("Aug 8, 20:06 UTC")}; that is the only action matching this filter.`,
  );
  for (const input of [base({ rows: filtered, types, hasMore: false }), base({ rows: lone, types: ["deficit_created"], hasMore: false })]) {
    expect(h1(input)).not.toContain("_");
  }
});

test("rows: the tx link is the chain's explorer or null, its label the short hash, its title the full hash with the row's chain coordinates (log always, block only beside a time, seq only when nonzero)", () => {
  const v = deriveActivityView(base());
  const first = ROWS[0];
  const last = ROWS[49];
  if (first === undefined || last === undefined) throw new Error("fixture: 50 rows expected");
  expect(v.rows[0]).toMatchObject({
    tx: `https://optimistic.etherscan.io/tx/${first.tx_hash}`,
    txLabel: `${first.tx_hash.slice(0, 10)}…`,
    txTitle: `${first.tx_hash} · block 155,323,392 · log 38`,
    account: first.account,
  });
  expect(v.rows[49]).toMatchObject({
    tx: `https://etherscan.io/tx/${last.tx_hash}`,
    txTitle: `${last.tx_hash} · log 6`,
  });
  const unknownChain = deriveActivityView(base({ rows: [{ ...first, chain_id: 8453, seq: 3 }] })).rows[0];
  expect(unknownChain?.tx).toBeNull();
  expect(unknownChain?.txTitle).toBe(`${first.tx_hash} (no explorer configured for chain 8453) · block 155,323,392 · log 38 · seq 3`);
});

test("engine-scoped: a null time is a per-row block fallback, never a tail — nothing dims; cross-engine drift is named, otherwise null", () => {
  const scoped = deriveActivityView(base({ rows: FEED_ENGINE_AAVE_PAGE_1.events, mode: "engine-scoped", engine: "aave_v3_etherfi", hasMore: false }));
  expect(scoped.rows.map((r) => r.when)).toEqual(["2026-07-29T09:57:11Z", "block 25,635,580"]);
  expect(scoped.rows.every((r) => !r.dim)).toBe(true);
  expect(scoped.drift).toBeNull();
  expect(deriveActivityView(base()).drift).toBeNull();

  // The committed cross page with its own timed row re-served after the untimed borrow: the law's one violation.
  const first = FEED_CROSS_PAGE_1.events[0];
  if (first === undefined) throw new Error("fixture: the timed head row expected");
  const drifted = [...FEED_CROSS_PAGE_1.events, { ...first, log_index: 43 }];
  const v = deriveActivityView(base({ rows: drifted, hasMore: false }));
  expect(v.drift).toBe(ACTIVITY_DRIFT);
  expect(v.drift).toContain("treat this walk as suspect");
  expect(ACTIVITY_DRIFT.startsWith("Ordering fault · the service sent a timed row inside the untimed tail")).toBe(true);
  // A broken ordering claims no order and no newest anywhere on the page: the qualifier, the chip, the tail notice, the dek.
  expect(v.listQualifier).toBe("in the order the service sent · loads 50 at a time");
  expect(v.chips.some((c) => c.label === "Newest")).toBe(false);
  expect(v.tailNote).toBeNull();
  expect(v.headline.rest).toContain("no newest is claimed");
  expect(v.headline.dek).toContain("1 has no block time yet.");
  expect(v.headline.dek).not.toContain("listed last");
  // The smuggled timed row keeps its time and does not dim: dim marks a missing header time, not a position.
  expect(v.rows.map((r) => r.dim)).toEqual([false, true, false]);
});

test("header: the kicker names the scope, the headline IS feedTakeaway's two parts under the neutral tone — a record is ink, never the health green — and the dek is the rows' own facts", () => {
  const v = deriveActivityView(base());
  expect(v.kicker).toBe("Activity · all engines");
  const takeaway = feedTakeaway(ROWS, "cross-engine", true, { types: [], ledger: false, servedAt: DEMO_FEED_PAGE_1.served_at });
  expect(v.headline).toEqual({
    ...takeaway,
    tone: "neutral",
    dek: "1 of them records bad debt being realized. 21 are on Cash and 29 on the legacy Aave v3 market. 2 have no block time yet and are listed last, by chain and then block number.",
  });
  expect(v.headline.emphasis).toBe("3 liquidations among the 50 chain actions loaded,");
  expect(v.headline.rest).toBe(`the newest at ${nb("Aug 8, 20:21 UTC")}; more exist beyond these.`);
  expect(h1(base())).toBe(`3 liquidations among the 50 chain actions loaded, the newest at ${nb("Aug 8, 20:21 UTC")}; more exist beyond these.`);
  // The reference year is the envelope's own served_at; with no envelope at hand the year prints — never the browser's clock.
  expect(deriveActivityView(base({ envelope: null })).headline.rest).toBe(`the newest at ${nb("Aug 8, 2026, 20:21 UTC")}; more exist beyond these.`);
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).kicker).toBe("Activity · Cash");
  expect(deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" })).kicker).toBe("Activity · Aave v3 market (legacy)");
  const scoped = deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped", hasMore: false }));
  expect({ emphasis: scoped.headline.emphasis, rest: scoped.headline.rest }).toEqual(
    feedTakeaway(ROWS, "engine-scoped", false, { types: [], ledger: false, servedAt: DEMO_FEED_PAGE_1.served_at }),
  );
  expect(scoped.headline.rest).toBe("the newest at block 155,323,392; that is every action matching this filter.");
  expect(v.state).toBe("ok");
  // No tone on this page is a verdict's: an answered arm is neutral, every other arm the dashed refusal tone.
  expect(["neutral", "refused"]).toContain(v.headline.tone);
});

test("the dek counts what is loaded, each sentence conditional on its own count: every number is the rows' own, the two engines side by side and never summed, the tail's order as the service keeps it", () => {
  const count = (test: (event: (typeof ROWS)[number]) => boolean): number => ROWS.filter(test).length;
  const deficits = count((e) => e.type === "deficit_created");
  const cash = count((e) => e.engine === "debt_manager");
  const legacy = count((e) => e.engine === "aave_v3_etherfi");
  const untimed = count((e) => e.block_time === null);
  expect([deficits, cash, legacy, untimed]).toEqual([1, 21, 29, 2]);
  expect(cash + legacy).toBe(ROWS.length);
  expect(deriveActivityView(base()).headline.dek).toBe(
    `${String(deficits)} of them records bad debt being realized. ${String(cash)} are on Cash and ${String(legacy)} on the legacy Aave v3 market. ${String(untimed)} have no block time yet and are listed last, by chain and then block number.`,
  );

  // No deficit, no tail: only the split is said. One engine among the rows: "All n".
  const timed = ROWS.filter((e) => e.block_time !== null && e.type !== "deficit_created");
  expect(deriveActivityView(base({ rows: timed })).headline.dek).toBe("20 are on Cash and 27 on the legacy Aave v3 market.");
  const cashOnly = timed.filter((e) => e.engine === "debt_manager");
  expect(deriveActivityView(base({ rows: cashOnly })).headline.dek).toBe("All 20 are on Cash.");
  // Singular grammar: one row on an engine, one untimed row, two deficits.
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
  // An engine this page does not name is counted as such, never folded into one of the two.
  const foreign = [...cashOnly.slice(0, 2), { ...deficit, type: "borrow" as const, engine: "morpho_blue" }];
  expect(deriveActivityView(base({ rows: foreign })).headline.dek).toBe("2 are on Cash and 1 on an engine this page does not name.");
  // One row: the headline names it, the dek says where it sits.
  expect(deriveActivityView(base({ rows: [deficit] })).headline.dek).toBe(
    "It records bad debt being realized. It is on the legacy Aave v3 market.",
  );

  // One engine chosen: no split and no tail (a null time is a per-row fallback there); nothing else to say, so the order is said.
  expect(deriveActivityView(base({ rows: cashOnly, engine: "debt_manager", mode: "engine-scoped" })).headline.dek).toBe(
    "Listed newest first, by block number on Cash's chain.",
  );
  expect(deriveActivityView(base({ rows: FEED_ENGINE_AAVE_PAGE_1.events, engine: "aave_v3_etherfi", mode: "engine-scoped" })).headline.dek).toBe(
    "Listed newest first, by block number on the legacy Aave v3 market's chain.",
  );
  // No dek names a dollar, a sum across engines, a cursor or the custody word.
  for (const rows of [ROWS, timed, cashOnly, oneCash, foreign]) {
    expect(deriveActivityView(base({ rows })).headline.dek).not.toMatch(/\$|cursor|custod|in total|combined/);
  }
  // The dek glosses no wire word the page no longer prints: a type is said in the page's words or not at all.
  for (const rows of [ROWS, [deficit], [deficit, { ...deficit, log_index: 99 }, ...cashOnly]]) {
    expect(deriveActivityView(base({ rows })).headline.dek).not.toMatch(/_|deficit_created/);
  }
});

test("chips: Scope · View · Order · Newest · Filter applied in that order — the row count is the tile's, said once; Newest is the headline's exact instant verbatim, a block when one engine is chosen, absent when no newest is claimed; the applied filter is the wire's own echo in words, its integers guarded", () => {
  const v = deriveActivityView(base());
  expect(FILTER_APPLIED_LABEL).toBe("Filter applied");
  expect(v.chips.map((c) => c.label)).toEqual(["Scope", "View", "Order", "Newest", "Filter applied"]);
  expect(chipValue(base(), "Scope")).toBe("all engines");
  expect(ALL_ENGINES).toBe("all engines");
  expect(chipValue(base(), "View")).toBe("all actions");
  expect(chipValue(base(), "Order")).toBe("by block time");
  expect(chipValue(base(), "Rows")).toBeUndefined();
  // The exact layer of the spoken instant: the wire's ISO string, untouched.
  expect(chipValue(base(), "Newest")).toBe("2026-08-08T20:21:05Z");
  expect(chipValue(base(), "Newest")).toBe(ROWS[0]?.block_time);
  // A null constraint is "any" — the dash means refused or absent everywhere else on the page — and no wire field name prints.
  expect(chipValue(base(), "Filter applied")).toBe("all engines · all types · any block · 50 per page");
  expect(chipValue(base(), "Filter applied")).not.toContain(EM_DASH);
  expect(chipValue(base(), "Filter applied")).not.toMatch(/since_block|\blimit\b|types all|\bengine —/);
  // One scope, one word: the applied filter's engine with none chosen is the Scope chip's own word beside it.
  expect(chipValue(base(), "Filter applied")?.startsWith(`${ALL_ENGINES} · `)).toBe(true);
  expect(chipValue(base(), "Filter applied")).not.toContain("any engine");

  expect(chipValue(base({ engine: "debt_manager", mode: "engine-scoped" }), "Scope")).toBe("Cash");
  expect(chipValue(base({ view: "ledger" }), "View")).toBe("liquidations ledger");
  expect(chipValue(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" }), "Order")).toBe("by block number");
  expect(chipValue(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" }), "Newest")).toBe("block 155,323,392");
  expect(deriveActivityView(base({ envelope: null })).chips.map((c) => c.label)).toEqual(["Scope", "View", "Order", "Newest"]);
  // No newest claimed — nothing loaded, or no row with a block time — no Newest chip.
  expect(deriveActivityView(base({ rows: [], envelope: null })).chips.map((c) => c.label)).toEqual(["Scope", "View", "Order"]);
  expect(chipValue(base({ rows: ROWS.slice(48) }), "Newest")).toBeUndefined();
  // A refused continuation keeps the loaded rows' newest: the rows still license it.
  expect(chipValue(base({ refusal: { status: 400, code: "bad_request", message: "no" } }), "Newest")).toBe("2026-08-08T20:21:05Z");

  const scoped = base({
    engine: "aave_v3_etherfi",
    mode: "engine-scoped",
    envelope: { filter: { engine: "aave_v3_etherfi", types: ["borrow", "repay"], since_block: 25635600 }, limit: 50, served_at: DEMO_FEED_PAGE_1.served_at },
  });
  expect(chipValue(scoped, "Filter applied")).toBe("Aave v3 market (legacy) · borrow and repay · from block 25,635,600 · 50 per page");
  const served_at = DEMO_FEED_PAGE_1.served_at;
  // Every constraint null: each is said as its scope with none chosen, and the page size is the wire's echo.
  expect(appliedFilter({ filter: { engine: null, account: null, types: null, since_block: null }, limit: 50, served_at: "…" })).toBe(
    "all engines · all types · any block · 50 per page",
  );
  // Types in the page's own words; an empty list is every type; an account the service echoed is said, shortened.
  expect(appliedFilter({ filter: { engine: "debt_manager", types: ["deficit_created", "collateral_enabled", "liquidation"], since_block: null }, limit: 1000, served_at })).toBe(
    "Cash · bad debt realized, collateral enabled and liquidation · any block · 1,000 per page",
  );
  expect(appliedFilter({ filter: { engine: null, types: [], since_block: null }, limit: 25, served_at })).toBe("all engines · all types · any block · 25 per page");
  expect(appliedFilter({ filter: { engine: null, account: "0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e", types: null, since_block: null }, limit: 25, served_at })).toBe(
    "all engines · account 0x7a3f…c21e · all types · any block · 25 per page",
  );
  // An echoed integer outside the population law is refused before render, never printed.
  expect(() => deriveActivityView(base({ envelope: { filter: { engine: null, types: null, since_block: -1 }, limit: 50, served_at } }))).toThrow(/since_block/);
  expect(() => deriveActivityView(base({ envelope: { filter: { engine: null, types: null, since_block: null }, limit: 1.5, served_at } }))).toThrow(/limit/);
});

test("tiles: rows loaded with the cursor's word, liquidations among the loaded rows; grouped counts", () => {
  const v = deriveActivityView(base());
  expect(v.tiles.rows).toEqual({ value: "50", sub: "more available", tone: "neutral" });
  expect(v.tiles.liquidations).toEqual({ value: "3", sub: "among the loaded rows", tone: "neutral" });
  expect(LIQUIDATIONS_SUB).toBe("among the loaded rows");
  const exhausted = deriveActivityView(base({ hasMore: false, engine: "debt_manager", mode: "engine-scoped" }));
  expect(exhausted.tiles.rows).toEqual({ value: "50", sub: "end of the filtered feed", tone: "neutral" });
  expect(exhausted.tiles.liquidations.sub).toBe("among the loaded rows");
  const big = Array.from({ length: 1200 }, (_, i) => {
    const row = ROWS[i % 50];
    if (row === undefined) throw new Error("fixture: 50 rows expected");
    return { ...row, seq: i };
  });
  expect(deriveActivityView(base({ rows: big })).tiles.rows.value).toBe("1,200");
  // The headline speaks the same grouped count: 24 × 3 liquidations among 1,200 rows.
  expect(deriveActivityView(base({ rows: big })).headline.emphasis).toBe("72 liquidations among the 1,200 chain actions loaded,");
});

test("a refused page: the dashed tone, emphasis only — the state named, the loaded rows counted as loaded; the service's own words in the dek with the code it stated named once, and never a code it did not state; the list's restart word", () => {
  const message = "400 bad_request: events page: cursor was minted for a engine-scoped page but this request is cross-engine-mode (http://x/v1/events?cursor=c)";
  const v = deriveActivityView(base({ refusal: { status: 400, code: "bad_request", message } }));
  expect(v.state).toBe("refused");
  expect(v.headline).toEqual({
    emphasis: "The next page was refused, after 50 chain actions loaded.",
    rest: "",
    tone: "refused",
    dek: `${message}. Restart the list below.`,
  });
  // The service's words carry their own code: it is not said twice.
  expect(v.headline.dek.match(/bad_request/g)).toHaveLength(1);
  // The restart is the refusal strip's, which stands ABOVE the table these words print in.
  expect(v.emptyText).toBe("page refused · bad_request: restart above");
  expect(v.refusalHead).toBe("PAGE REFUSED · bad_request");
  // Served rows survive a refused continuation: the tiles keep counting them.
  expect(v.rows).toHaveLength(50);
  expect(v.tiles.rows).toEqual({ value: "50", sub: "more available", tone: "neutral" });
  const coded = deriveActivityView(base({ rows: [], refusal: { status: 400, code: null, message: "refused" } }));
  expect(coded.headline.emphasis).toBe("The service refused this page.");
  // A refusal that stated NO code is given none — in the dek, the table's words and the strip's head. A code the
  // service did not state is never printed as its code.
  expect(coded.headline.dek).toBe("Refused. Restart the list below.");
  expect(coded.emptyText).toBe("page refused: restart above");
  expect(coded.refusalHead).toBe("PAGE REFUSED");
  for (const blank of [null, "", "  "]) {
    const arm = deriveActivityView(base({ rows: [], refusal: { status: 400, code: blank, message: "refused" } }));
    expect(`${arm.headline.dek} ${arm.emptyText} ${arm.refusalHead ?? ""}`).not.toContain("bad_request");
  }
  // Words that carry no code, under a code the service DID state: the code is named after them, never dropped.
  const named = deriveActivityView(base({ rows: [], refusal: { status: 400, code: "bad_cursor", message: "refused" } }));
  expect(named.headline.dek).toBe("Refused. (bad_cursor). Restart the list below.");
  expect(named.emptyText).toBe("page refused · bad_cursor: restart above");
  expect(named.refusalHead).toBe("PAGE REFUSED · bad_cursor");
  // Nothing loaded behind a refusal is a dash, never a zero — in the tiles and in the headline.
  expect(coded.tiles.rows).toEqual({ value: EM_DASH, sub: "page refused", tone: "refused" });
  expect(coded.tiles.liquidations).toEqual({ value: EM_DASH, sub: "page refused", tone: "refused" });
  expect(h1(base({ rows: [], refusal: { status: 400, code: null, message: "refused" } }))).not.toMatch(/\d/);
  const one = deriveActivityView(base({ rows: ROWS.slice(0, 1), refusal: { status: 400, code: "bad_request", message: "no" } }));
  expect(one.headline.emphasis).toBe("The next page was refused, after 1 chain action loaded.");
});

test("a refused walk offers no next page — with nothing loaded or with rows loaded: its cursor was refused, and the restart is the one way forward; the service's words are the dek's alone", () => {
  const message = "400 bad_request: events page: cursor was minted for a engine-scoped page but this request is cross-engine-mode (http://x/v1/events?limit=50)";
  const refusal = { status: 400, code: "bad_request", message };
  // The cold load the service refused: the cursor is still open (hasMore), and the foot still offers nothing.
  const cold = deriveActivityView(base({ rows: [], hasMore: true, envelope: null, refusal }));
  expect(cold.state).toBe("refused");
  expect(cold.foot).toBe("none");
  const later = deriveActivityView(base({ hasMore: true, refusal }));
  expect(later.foot).toBe("none");
  // Every other state keeps the cursor's own answer.
  expect(deriveActivityView(base()).foot).toBe("more");
  expect(deriveActivityView(base({ hasMore: false })).foot).toBe("end");
  expect(deriveActivityView(base({ rows: [], hasMore: true, envelope: null })).foot).toBe("more");
  expect(deriveActivityView(base({ rows: [], hasMore: false })).foot).toBe("end");
  expect(deriveActivityView(base({ rows: [], error: "boom" })).foot).toBe("more");
  expect(deriveActivityView(base()).refusalHead).toBeNull();
  expect(deriveActivityView(base({ rows: [], error: "boom" })).refusalHead).toBeNull();
  // Said once: the service's words are in the dek and in no other string the view hands the page.
  const elsewhere = [cold.kicker, cold.headline.emphasis, cold.headline.rest, cold.emptyText, cold.refusalHead ?? "", cold.listQualifier, cold.tiles.rows.sub, cold.tiles.liquidations.sub, ...cold.chips.map((c) => c.value)];
  expect(cold.headline.dek).toContain("cursor was minted for a engine-scoped page");
  for (const words of elsewhere) expect(words).not.toContain("cursor was minted");
  expect(cold.headline.dek.match(/cursor was minted/g)).toHaveLength(1);
});

test("a failed fetch: the dashed tone, emphasis only, the failure's own message as the dek; rows already loaded are counted as loaded; a refusal outranks an error", () => {
  const v = deriveActivityView(base({ rows: [], error: "429 rate_limited: rate limit exceeded (http://x/v1/events)" }));
  expect(v.state).toBe("error");
  expect(v.headline).toEqual({
    emphasis: "Recorded chain actions could not be fetched.",
    rest: "",
    tone: "refused",
    dek: "429 rate_limited: rate limit exceeded (http://x/v1/events).",
  });
  expect(v.emptyText).toBe("page fetch failed: 429 rate_limited: rate limit exceeded (http://x/v1/events)");
  expect(v.tiles.rows).toEqual({ value: EM_DASH, sub: "page fetch failed", tone: "refused" });
  expect(v.tiles.liquidations).toEqual({ value: EM_DASH, sub: "page fetch failed", tone: "refused" });
  const later = deriveActivityView(base({ error: "Failed to fetch" }));
  expect(later.headline).toEqual({
    emphasis: "The next page could not be fetched, after 50 chain actions loaded.",
    rest: "",
    tone: "refused",
    dek: "Failed to fetch.",
  });
  const both = deriveActivityView(base({ error: "boom", refusal: { status: 400, code: "bad_request", message: "no" } }));
  expect(both.state).toBe("refused");
  expect(both.headline.emphasis).toBe("The next page was refused, after 50 chain actions loaded.");
});

test("exhausted: no rows and no cursor is a real answer — the state, the sentence in ink, the dek that says so, zero counts that are true", () => {
  const v = deriveActivityView(base({ rows: [], hasMore: false }));
  expect(v.state).toBe("exhausted");
  expect(v.emptyText).toBe("no recorded chain action matches this filter. An empty page here is a real answer from the service.");
  expect(v.headline).toEqual({ ...feedTakeaway([], "cross-engine", false), tone: "neutral", dek: ACTIVITY_EXHAUSTED_DEK });
  expect(v.headline.emphasis).toBe("No recorded chain action matches this filter.");
  expect(ACTIVITY_EXHAUSTED_DEK).toBe("That is the service's real answer for this filter, not a loading state.");
  expect(v.tiles.rows).toEqual({ value: "0", sub: "end of the filtered feed", tone: "neutral" });
  expect(v.tiles.liquidations).toEqual({ value: "0", sub: "among the loaded rows", tone: "neutral" });
});

test("loading: no rows yet with a cursor ahead — NOTHING is counted: the headline names the load under the dashed tone and prints no digit, the dek says what will be here, the tiles a dash with the load word", () => {
  const v = deriveActivityView(base({ rows: [], hasMore: true, envelope: null }));
  expect(v.state).toBe("loading");
  expect(v.emptyText).toBe("loading recorded chain actions…");
  expect(v.headline).toEqual({ ...feedTakeaway([], "cross-engine", true), tone: "refused", dek: ACTIVITY_LOADING_DEK });
  expect(v.headline).toEqual({
    emphasis: "Loading recorded chain actions…",
    rest: "",
    tone: "refused",
    dek: "Borrows, repays, supplies, withdrawals and liquidations, as recorded from the chain.",
  });
  // Nothing loaded is a dash, never a zero: the H1, the dek and both tiles print no digit at all.
  expect(`${v.headline.emphasis}${v.headline.rest}${v.headline.dek}`).not.toMatch(/\d/);
  expect(v.tiles.rows).toEqual({ value: EM_DASH, sub: "loading recorded chain actions…", tone: "neutral" });
  expect(v.tiles.liquidations).toEqual({ value: EM_DASH, sub: "loading recorded chain actions…", tone: "neutral" });
  for (const engine of [null, "debt_manager", "aave_v3_etherfi"] as const) {
    const arm = deriveActivityView(base({ rows: [], hasMore: true, envelope: null, engine, mode: engine === null ? "cross-engine" : "engine-scoped" }));
    expect(arm.headline.emphasis).toBe("Loading recorded chain actions…");
    expect(arm.chips.some((c) => c.label === "Newest")).toBe(false);
  }
  // Rows already shown: the page has answered. The state is decided by the rows, the cursor and the last failure
  // alone — whether a fetch is in flight is the surface's own (aria-busy, the button's word) and is not an input.
  expect(deriveActivityView(base()).state).toBe("ok");
  expect(Object.keys(base())).not.toContain("loading");
});

test("the list's head: its own name — never another page's — with the order in short form and the envelope's page size; the tail's notice only when a tail is loaded; the full order sentence, the since-block law and the live strip's law are the drawer's", () => {
  const cross = deriveActivityView(base());
  expect(ACTIVITY_LIST_TITLE).toBe("Recorded chain actions");
  expect(ACTIVITY_LIST_TITLE).not.toMatch(/^(History|Overview|Book|Inspector|Scenarios|Verification|API)\b/);
  expect(cross.listQualifier).toBe("newest first, by block time · loads 50 at a time");
  // The page size is the envelope's own echo, guarded; with no envelope yet it is not guessed.
  expect(deriveActivityView(base({ envelope: null })).listQualifier).toBe("newest first, by block time");
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).listQualifier).toBe(
    "newest first, by block number on Cash's chain · loads 50 at a time",
  );
  expect(deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" })).listQualifier).toBe(
    "newest first, by block number on the legacy Aave v3 market's chain · loads 50 at a time",
  );

  expect(cross.tailNote).toBe(ACTIVITY_TAIL_NOTICE);
  expect(ACTIVITY_TAIL_NOTICE).toBe("Rows with no block time yet come last, listed by chain and then block number; that tail is not in time order.");
  expect(deriveActivityView(base({ rows: ROWS.slice(0, 48) })).tailNote).toBeNull();
  // The tail's own order is said only when the loaded rows SHOW it (chain, then block number, both descending): a
  // tail that does not is still named and still "last", and the order is left unsaid — in the notice and in the dek.
  const head = ROWS.slice(0, 48);
  const [cashTail, legacyTail] = [ROWS[48], ROWS[49]];
  if (cashTail === undefined || legacyTail === undefined) throw new Error("fixture: the demo page's two untimed rows expected");
  expect(cashTail.chain_id).toBeGreaterThan(legacyTail.chain_id);
  const swapped = deriveActivityView(base({ rows: [...head, legacyTail, cashTail] }));
  expect(swapped.tailNote).toBe(ACTIVITY_TAIL_NOTICE_UNORDERED);
  expect(ACTIVITY_TAIL_NOTICE_UNORDERED).toBe("Rows with no block time yet come last; that tail is not in time order.");
  expect(swapped.headline.dek.endsWith("2 have no block time yet and are listed last.")).toBe(true);
  const climbing = deriveActivityView(base({ rows: [...head, cashTail, { ...cashTail, block_number: cashTail.block_number + 1, log_index: 99 }] }));
  expect(climbing.tailNote).toBe(ACTIVITY_TAIL_NOTICE_UNORDERED);
  const falling = deriveActivityView(base({ rows: [...head, cashTail, { ...cashTail, block_number: cashTail.block_number - 1, log_index: 99 }, legacyTail] }));
  expect(falling.tailNote).toBe(ACTIVITY_TAIL_NOTICE);
  expect(falling.headline.dek.endsWith("3 have no block time yet and are listed last, by chain and then block number.")).toBe(true);
  // One engine chosen: a null time is a per-row fallback, never a tail.
  expect(deriveActivityView(base({ rows: FEED_ENGINE_AAVE_PAGE_1.events, engine: "aave_v3_etherfi", mode: "engine-scoped" })).tailNote).toBeNull();

  // Sentences only: the list's title is the list head's and is never a drawer paragraph.
  expect(cross.doctrine).not.toContain(ACTIVITY_LIST_TITLE);
  for (const paragraph of cross.doctrine) expect(paragraph).toMatch(/[.…]$/);
  expect(cross.doctrine).toEqual([
    ACTIVITY_INTRO,
    ACTIVITY_METHOD,
    ACTIVITY_FORENSICS,
    ACTIVITY_TAIL_NOTE,
    "Ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are never compared across chains, and rows without header time follow in the disclosed untimed tail.",
    ACTIVITY_SINCE_NOTE,
    ACTIVITY_LIVE_NOTE,
  ]);
  // The engine in a sentence is the product's name for it — one phrasing (lib/prose) — never the wire's id.
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).doctrine[4]).toBe(
    "Ordered by block height (block, tx, log, seq) DESC, because heights are comparable within Cash's own chain.",
  );
  expect(deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" })).doctrine[4]).toBe(
    "Ordered by block height (block, tx, log, seq) DESC, because heights are comparable within the legacy Aave v3 market's own chain.",
  );
  expect(ACTIVITY_INTRO).toBe(
    "Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The live strip shows the stream's posture now; the list below pages through durable history. The two never blend.",
  );
  expect(ACTIVITY_METHOD).toBe(
    "block_time is chain-asserted header custody, never invented; amounts are the engine's own accounting units, named per row, and a scaled or normalized value is never dressed up as a token or USD figure.",
  );
  expect(ACTIVITY_FORENSICS).toBe(
    "block_time is chain-asserted header custody: null until custodied, in which case the block number renders instead. A timestamp is never invented. Amounts are the engine's own accounting units, named per row, and a scaled or normalized value is never dressed up as a token or USD figure.",
  );
  expect(ACTIVITY_TAIL_NOTE).toContain("the tail's internal order is not chronology");
  // The slogan the header once carried is still the intro's closing clause: nothing honest left the page.
  expect(ACTIVITY_INTRO.endsWith("The two never blend.")).toBe(true);
  expect(ACTIVITY_SINCE_SHORT).toBe("Since block · choose one engine");
  expect(ACTIVITY_SINCE_FULL).toBe(
    "Since block: choose one engine to filter by block number. Cash and the legacy market run on different chains, so one block number cannot bound both.",
  );
  expect(ACTIVITY_SINCE_NOTE).toBe(`${ACTIVITY_SINCE_FULL} That is a property of chains, not an error.`);
  expect(ACTIVITY_LIVE_NOTE).toBe(
    "The live strip shows the stream's state on this connection only. Past stream states are not stored, so they cannot be replayed here; the recorded list is chain fact held by Solvent.",
  );
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
  // Mono is for ids and numbers alone: every figure is one, and no prose run is.
  expect(v.line.filter((part) => part.kind === "figure").map((part) => part.text)).toEqual(["1", "4", "2", "25,635,618", "154,796,552"]);
  expect(v.line.filter((part) => part.kind === "text").every((part) => !/\d/.test(part.text.replace("Aave v3 market (legacy)", "")))).toBe(true);
  expect(v.label).toBe(ACTIVITY_LIVE_LABEL);
  expect(ACTIVITY_LIVE_LABEL).toBe("Live stream · this connection only");
  expect(v.law).toBe(ACTIVITY_LIVE_LAW);
  expect(ACTIVITY_LIVE_LAW).toBe("This browser connection only — not a record. The list below is the record.");
  expect(v.degraded).toBeNull();

  // Grouped counts and a real singular; a superseded batch is warned in words, not capitals.
  if (SNAPSHOT_BATCH === null || SNAPSHOT_BATCH === undefined) throw new Error("fixture: the snapshot carries a batch");
  const big = { ...SNAPSHOT_BATCH, id: 18251, position_count: 1412, refused_count: 6, supersession: { ...SNAPSHOT_BATCH.supersession, superseded: true } };
  const superseded = deriveLiveStrip(strip({ batch: big, streamState: "waiting", hasBase: false }));
  expect(superseded.line.map((part) => part.text).join("")).toBe(
    "Batch 18,251 · 1,412 positions, 6 not computed · superseded, still served · received on an earlier connection · Aave v3 market (legacy) at block 25,635,618 · Cash at block 154,796,552",
  );
  expect(superseded.line.filter((part) => part.kind === "warn").map((part) => part.text)).toEqual(["superseded, still served"]);
  expect(said(strip({ batch: { ...SNAPSHOT_BATCH, position_count: 1 } }))).toContain("1 position, ");
  // An envelope integer outside the population law is the word, scoped to the number: the strip never takes the list down.
  expect(said(strip({ batch: { ...SNAPSHOT_BATCH, id: -1, position_count: 1.5 } }))).toContain("Batch unreadable · unreadable positions, 2 not computed");
});

test("the live strip's other arms: no batch on this connection is said, never pretended; no servable batch with the age and the last good batch; a withheld engine named with its cause and code; the chip is the connection's whole claim and no socket is green", () => {
  const none = deriveLiveStrip(strip({ batch: null, streamState: "waiting", hasBase: false }));
  expect(none.arm).toBe("none");
  expect(none.line).toEqual([{ text: "No batch has arrived on this connection yet, so nothing live is shown.", kind: "text" }]);
  expect(none.chip).toEqual({ label: "reconnecting", tone: "warn" });
  // A closed connection will deliver nothing more: "yet" would promise what it cannot.
  expect(said(strip({ batch: null, streamState: "closed", hasBase: false }))).toBe("No batch arrived on this connection, so nothing live is shown.");

  const unavailable = strip({ unavailable: { staleSinceSeconds: 1205, lastGoodBatchId: 18250 } });
  expect(deriveLiveStrip(unavailable).arm).toBe("unavailable");
  expect(said(unavailable)).toBe("No batch can be served right now · the data held is 1,205s old · last good batch 18,250");
  expect(said(strip({ unavailable: { staleSinceSeconds: null, lastGoodBatchId: null } }))).toBe("No batch can be served right now");
  // An absent age or batch is left out — never a zero.
  expect(said(strip({ unavailable: { staleSinceSeconds: null, lastGoodBatchId: null } }))).not.toMatch(/\d/);

  const degraded = deriveLiveStrip(
    strip({ degradation: { refused_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "custody of the flag set is unproven" }] } }),
  );
  expect(degraded.degraded).toMatch(/^Withheld now: Cash \(.+ · FLAG_CUSTODY_UNPROVEN\)$/);
  expect(deriveLiveStrip(strip({ degradation: { refused_engines: [] } })).degraded).toBeNull();

  expect(deriveLiveStrip(strip()).chip).toEqual({ label: "streaming", tone: "accent" });
  expect(deriveLiveStrip(strip({ hasBase: false })).chip).toEqual({ label: "awaiting base", tone: "unknown" });
  expect(deriveLiveStrip(strip({ streamState: "idle" })).chip).toEqual({ label: "connecting", tone: "warn" });
  expect(deriveLiveStrip(strip({ streamState: "connecting" })).chip).toEqual({ label: "connecting", tone: "warn" });
  expect(deriveLiveStrip(strip({ streamState: "closed" })).chip).toEqual({ label: "closed", tone: "down" });
});

test("no public string on this page names the roadmap: not 'P4', not an 'outbox' — in any arm's header, notice, strip or doctrine", () => {
  const inputs: ActivityInput[] = [
    base(),
    base({ rows: [], hasMore: true, envelope: null }),
    base({ rows: [], hasMore: false }),
    base({ refusal: { status: 400, code: "bad_request", message: "no" } }),
    base({ rows: [], error: "boom" }),
    base({ engine: "debt_manager", mode: "engine-scoped" }),
    base({ view: "ledger" }),
  ];
  const strips: LiveStripInput[] = [
    strip(),
    strip({ batch: null, streamState: "waiting", hasBase: false }),
    strip({ unavailable: { staleSinceSeconds: 5, lastGoodBatchId: 1 } }),
  ];
  const printed = [
    ...inputs.flatMap((input) => {
      const v = deriveActivityView(input);
      return [v.kicker, v.headline.emphasis, v.headline.rest, v.headline.dek, v.emptyText, v.refusalHead ?? "", v.listQualifier, v.tailNote ?? "", v.drift ?? "", ...v.doctrine, ...v.chips.map((c) => `${c.label} ${c.value}`), v.tiles.rows.sub, v.tiles.liquidations.sub];
    }),
    ...strips.flatMap((input) => {
      const v = deriveLiveStrip(input);
      return [v.label, v.law, v.chip.label, v.degraded ?? "", ...v.line.map((part) => part.text)];
    }),
    ACTIVITY_SINCE_SHORT,
    ACTIVITY_SINCE_FULL,
    ACTIVITY_AMOUNT_HEADER,
    ACTIVITY_DRIFT,
    sinceBlockDroppedNotice(1, null),
    notABlockNumberNotice("x"),
  ].join("\n");
  expect(printed).not.toMatch(/\bP4\b/);
  expect(printed).not.toMatch(/outbox/i);
});
