// The Activity page's one view model: header, chips, tiles, table rows,
// order note, empty words and doctrine, derived once from the walk's state.
// The headline IS feedTakeaway's sentence (plan R2); the rows carry FeedList's
// row law (the untimed tail dim with its block number, the unit tags, the
// record-only word); every count is groupInt over the loaded window.
import { expect, test } from "@playwright/test";
import {
  ACTIVITY_DEK,
  ACTIVITY_DRIFT,
  ACTIVITY_FORENSICS,
  ACTIVITY_INTRO,
  ACTIVITY_LIST_TITLE,
  ACTIVITY_METHOD,
  ACTIVITY_TAIL_NOTE,
  END_OF_FEED,
  deriveActivityView,
  notABlockNumberNotice,
  sinceBlockDroppedNotice,
  type ActivityInput,
} from "../../lib/activity-view";
import { SINCE_BLOCK_IMPOSSIBILITY } from "../../lib/feed-data";
import { RAW_UNITS_TAG, feedTakeaway } from "../../lib/feed-view";
import { EM_DASH } from "../../lib/format";
import { DEMO_FEED_PAGE_1 } from "../fixtures/demo";
import { FEED_CROSS_PAGE_1, FEED_ENGINE_AAVE_PAGE_1 } from "../fixtures/feed";

const ROWS = DEMO_FEED_PAGE_1.events;

/** The demo page as the surface hands it over: cross-engine, page one loaded, a cursor behind it, DM's scale from the wire. */
const base = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  rows: ROWS,
  mode: "cross-engine",
  hasMore: DEMO_FEED_PAGE_1.next_cursor !== null,
  loading: false,
  engine: null,
  view: "all",
  types: [],
  sinceBlock: null,
  envelope: { filter: DEMO_FEED_PAGE_1.filter, limit: DEMO_FEED_PAGE_1.limit },
  refusal: null,
  error: null,
  valueDecimals: { debt_manager: 6 },
  ...over,
});

const chipValue = (input: ActivityInput, label: string): string | undefined =>
  deriveActivityView(input).chips.find((c) => c.label === label)?.value;

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
  expect(liquidations[0]?.detail).toEqual({
    liquidator: "0xBBbB000000000000000000000000000000000002",
    liquidatorHref: "/inspector/0xBBbB000000000000000000000000000000000002",
    repaid: "2,500",
    repaidAsset: "0xA0b86991…",
    seized: "0.65625 weETH",
    bonusRealized: EM_DASH,
    bonusConfigured: "500 bps",
    note: expect.stringContaining("never estimated"),
  });
  // The DM extracts carry no debt asset and no configured bonus: null is a dash, never "0".
  expect(liquidations[1]?.detail).toMatchObject({ repaidAsset: null, bonusRealized: EM_DASH, bonusConfigured: EM_DASH });
  expect(liquidations[1]?.detail?.bonusConfigured).not.toContain("0");
  expect(liquidations[2]?.detail?.liquidatorHref).toBe(`/inspector/${ROWS[37]?.liquidation?.liquidator ?? ""}`);
});

test("the surface's notices and the foot's word come from here: the since-block drop (cross-engine and one engine), the not-a-block-number quote at most 32 characters, the end of the feed", () => {
  expect(sinceBlockDroppedNotice(25635600, null)).toBe(`since_block 25635600 dropped: ${SINCE_BLOCK_IMPOSSIBILITY}`);
  expect(sinceBlockDroppedNotice(25635600, "aave_v3_etherfi")).toBe(
    "since_block 25635600 dropped: block heights are chain-scoped, and aave_v3_etherfi lives on a different chain",
  );
  expect(notABlockNumberNotice("abc")).toBe('"abc" is not a block number, so nothing was requested');
  expect(notABlockNumberNotice("x".repeat(40))).toBe(`"${"x".repeat(32)}" is not a block number, so nothing was requested`);
  expect(END_OF_FEED).toBe("end of the filtered feed");
  expect(deriveActivityView(base({ hasMore: false })).tiles.rows.sub).toBe(END_OF_FEED);
});

test("rows: amounts follow the feed's unit law — DM scaled by the wire's own value_decimals, Aave raw and tagged, a record-only row its own word; the unit's hover survives", () => {
  const scaled = deriveActivityView(base()).rows;
  expect(scaled[0]).toMatchObject({ amount: "252.733333", unit: "normalized debt · USDC" });
  expect(scaled[0]?.unitTitle).toContain("Debt Manager normalized debt units at the engine's own value_decimals");

  const raw = deriveActivityView(base({ valueDecimals: {} })).rows;
  expect(raw[0]).toMatchObject({ amount: "252733333", unit: `normalized debt · ${RAW_UNITS_TAG} · USDC` });

  const aaveIndex = ROWS.findIndex((e) => e.engine === "aave_v3_etherfi" && e.amount !== null);
  expect(scaled[aaveIndex]).toMatchObject({ amount: ROWS[aaveIndex]?.amount, unit: `aave-scaled · ${RAW_UNITS_TAG} · USDC` });

  const recordOnlyIndex = ROWS.findIndex((e) => e.amount === null);
  expect(scaled[recordOnlyIndex]).toMatchObject({ amount: "record-only", unit: "", unitTitle: null });

  // No unit here licenses a dollar figure.
  expect(scaled.some((r) => r.amount.includes("$") || r.unit.includes("$"))).toBe(false);
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
  // The smuggled timed row keeps its time and does not dim: dim marks a missing header time, not a position.
  expect(v.rows.map((r) => r.dim)).toEqual([false, true, false]);
});

test("header: the kicker names the scope, the headline IS feedTakeaway's sentence with tone ok and no rest, the dek is the one clause", () => {
  const v = deriveActivityView(base());
  expect(v.kicker).toBe("Activity · cross-engine");
  expect(v.headline).toEqual({ emphasis: feedTakeaway(ROWS, "cross-engine", true), rest: "", tone: "ok", dek: ACTIVITY_DEK });
  expect(v.headline.emphasis).toBe("50 chain action(s) loaded, 3 liquidation(s) · newest custodied 2026-08-08T20:21:05Z · more exist behind the cursor.");
  expect(ACTIVITY_DEK).toBe("The live strip and the paged record never blend.");
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).kicker).toBe("Activity · Cash");
  expect(deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" })).kicker).toBe("Activity · Aave v3 market (legacy)");
  expect(deriveActivityView(base({ engine: "aave_v3_etherfi", mode: "engine-scoped", hasMore: false })).headline.emphasis).toBe(
    feedTakeaway(ROWS, "engine-scoped", false),
  );
  expect(v.state).toBe("ok");
});

test("chips: Scope · View · Order · Rows · Filter echo in that order; the echo is the wire's own filter with its integers guarded; no envelope, no echo chip", () => {
  const v = deriveActivityView(base());
  expect(v.chips.map((c) => c.label)).toEqual(["Scope", "View", "Order", "Rows", "Filter echo"]);
  expect(chipValue(base(), "Scope")).toBe("cross-engine");
  expect(chipValue(base(), "View")).toBe("all actions");
  expect(chipValue(base(), "Order")).toBe("cross-engine");
  expect(chipValue(base(), "Rows")).toBe("50");
  expect(chipValue(base(), "Filter echo")).toBe(`engine ${EM_DASH} · types all · since_block ${EM_DASH} · limit 50`);

  expect(chipValue(base({ engine: "debt_manager", mode: "engine-scoped" }), "Scope")).toBe("Cash");
  expect(chipValue(base({ view: "ledger" }), "View")).toBe("liquidations ledger");
  expect(chipValue(base({ engine: "aave_v3_etherfi", mode: "engine-scoped" }), "Order")).toBe("engine-scoped");
  expect(deriveActivityView(base({ envelope: null })).chips.map((c) => c.label)).toEqual(["Scope", "View", "Order", "Rows"]);

  const scoped = base({
    engine: "aave_v3_etherfi",
    mode: "engine-scoped",
    envelope: { filter: { engine: "aave_v3_etherfi", types: ["borrow", "repay"], since_block: 25635600 }, limit: 50 },
  });
  expect(chipValue(scoped, "Filter echo")).toBe("engine aave_v3_etherfi · types borrow,repay · since_block 25635600 · limit 50");
  // An echoed integer outside the population law is refused before render, never printed.
  expect(() => deriveActivityView(base({ envelope: { filter: { engine: null, types: null, since_block: -1 }, limit: 50 } }))).toThrow(/since_block/);
  expect(() => deriveActivityView(base({ envelope: { filter: { engine: null, types: null, since_block: null }, limit: 1.5 } }))).toThrow(/limit/);
});

test("tiles: rows loaded with the cursor's word, liquidations in the loaded window with the mode; grouped counts", () => {
  const v = deriveActivityView(base());
  expect(v.tiles.rows).toEqual({ value: "50", sub: "more available", tone: "neutral" });
  expect(v.tiles.liquidations).toEqual({ value: "3", sub: "cross-engine", tone: "neutral" });
  const exhausted = deriveActivityView(base({ hasMore: false, engine: "debt_manager", mode: "engine-scoped" }));
  expect(exhausted.tiles.rows).toEqual({ value: "50", sub: "end of the filtered feed", tone: "neutral" });
  expect(exhausted.tiles.liquidations.sub).toBe("engine-scoped");
  const big = Array.from({ length: 1200 }, (_, i) => {
    const row = ROWS[i % 50];
    if (row === undefined) throw new Error("fixture: 50 rows expected");
    return { ...row, seq: i };
  });
  expect(deriveActivityView(base({ rows: big })).tiles.rows.value).toBe("1,200");
  expect(chipValue(base({ rows: big }), "Rows")).toBe("1,200");
});

test("a refused page: the dashed tone with the refusal's own words, the state, the list's restart word; a null code is bad_request", () => {
  const message = "400 bad_request: events page: cursor was minted for a engine-scoped page but this request is cross-engine-mode (http://x/v1/events?cursor=c)";
  const v = deriveActivityView(base({ refusal: { status: 400, code: "bad_request", message } }));
  expect(v.state).toBe("refused");
  expect(v.headline).toEqual({ emphasis: `Page refused · bad_request: ${message}`, rest: "", tone: "refused", dek: ACTIVITY_DEK });
  expect(v.emptyText).toBe("page refused · bad_request: restart below");
  // Served rows survive a refused continuation: the tiles keep counting them.
  expect(v.rows).toHaveLength(50);
  expect(v.tiles.rows).toEqual({ value: "50", sub: "more available", tone: "neutral" });
  const coded = deriveActivityView(base({ rows: [], refusal: { status: 400, code: null, message: "refused" } }));
  expect(coded.headline.emphasis).toBe("Page refused · bad_request: refused");
  expect(coded.emptyText).toBe("page refused · bad_request: restart below");
  // Nothing loaded behind a refusal is a dash, never a zero.
  expect(coded.tiles.rows).toEqual({ value: EM_DASH, sub: "page refused", tone: "refused" });
  expect(coded.tiles.liquidations).toEqual({ value: EM_DASH, sub: "cross-engine", tone: "refused" });
});

test("a failed fetch: the dashed tone with the failure's message; a refusal outranks an error", () => {
  const v = deriveActivityView(base({ rows: [], error: "429 rate_limited: rate limit exceeded (http://x/v1/events)" }));
  expect(v.state).toBe("error");
  expect(v.headline).toEqual({
    emphasis: "Page fetch failed: 429 rate_limited: rate limit exceeded (http://x/v1/events)",
    rest: "",
    tone: "refused",
    dek: ACTIVITY_DEK,
  });
  expect(v.emptyText).toBe("page fetch failed: 429 rate_limited: rate limit exceeded (http://x/v1/events)");
  expect(v.tiles.rows).toEqual({ value: EM_DASH, sub: "page fetch failed", tone: "refused" });
  const both = deriveActivityView(base({ error: "boom", refusal: { status: 400, code: "bad_request", message: "no" } }));
  expect(both.state).toBe("refused");
  expect(both.headline.emphasis).toBe("Page refused · bad_request: no");
});

test("exhausted: no rows and no cursor is a real answer — the state, the sentence, the tone ok, zero counts that are true", () => {
  const v = deriveActivityView(base({ rows: [], hasMore: false }));
  expect(v.state).toBe("exhausted");
  expect(v.emptyText).toBe("no custodied chain actions match this filter. An empty page here is a real answer from the service.");
  expect(v.headline).toEqual({ emphasis: feedTakeaway([], "cross-engine", false), rest: "", tone: "ok", dek: ACTIVITY_DEK });
  expect(v.headline.emphasis).toBe("0 chain actions loaded in this window — the list below states the reason.");
  expect(v.tiles.rows).toEqual({ value: "0", sub: "end of the filtered feed", tone: "neutral" });
  expect(v.tiles.liquidations).toEqual({ value: "0", sub: "cross-engine", tone: "neutral" });
});

test("loading: no rows yet with a cursor ahead — the state and its word, the tiles a dash with the load word, the headline still feedTakeaway's", () => {
  const v = deriveActivityView(base({ rows: [], hasMore: true }));
  expect(v.state).toBe("loading");
  expect(v.emptyText).toBe("loading the feed…");
  expect(v.headline.emphasis).toBe(feedTakeaway([], "cross-engine", true));
  expect(v.headline.tone).toBe("refused");
  expect(v.tiles.rows).toEqual({ value: EM_DASH, sub: "loading the feed…", tone: "neutral" });
  // Rows already shown while the next page loads: the page has answered.
  expect(deriveActivityView(base({ loading: true })).state).toBe("ok");
});

test("the order note is the mode's own sentence; the doctrine is the intro, the list's name, the method line, the forensics note and the tail note, verbatim", () => {
  const cross = deriveActivityView(base());
  expect(cross.orderNote).toBe(
    "ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are never compared across chains, and rows without header time follow in the disclosed untimed tail.",
  );
  expect(deriveActivityView(base({ engine: "debt_manager", mode: "engine-scoped" })).orderNote).toBe(
    "ordered by block height (block, tx, log, seq) DESC, because heights are comparable within debt_manager's own chain.",
  );
  expect(cross.doctrine).toEqual([ACTIVITY_INTRO, ACTIVITY_LIST_TITLE, ACTIVITY_METHOD, ACTIVITY_FORENSICS, ACTIVITY_TAIL_NOTE]);
  expect(ACTIVITY_INTRO).toBe(
    "Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The live strip shows the stream's posture now; the list below pages through durable history. The two never blend.",
  );
  expect(ACTIVITY_LIST_TITLE).toBe("History: recorded chain actions");
  expect(ACTIVITY_METHOD).toBe(
    "block_time is chain-asserted header custody, never invented; amounts are the engine's own accounting units, named per row, and a scaled or normalized value is never dressed up as a token or USD figure.",
  );
  expect(ACTIVITY_FORENSICS).toBe(
    "block_time is chain-asserted header custody: null until custodied, in which case the block number renders instead. A timestamp is never invented. Amounts are the engine's own accounting units, named per row, and a scaled or normalized value is never dressed up as a token or USD figure.",
  );
  expect(ACTIVITY_TAIL_NOTE).toContain("the tail's internal order is not chronology");
  // The dek is the intro's closing clause restated: the header never says what the drawer does not.
  expect(ACTIVITY_INTRO.endsWith("The two never blend.")).toBe(true);
});
