// web/tests/unit/demo-secondary-weld.spec.ts
// The History and Activity demo bodies are the demo Book's own figures. The
// newest captured bucket of each series IS the Book's engine card (debt,
// collateral, accounts, liquidatable, refused, batch, watermark block, sweep);
// every older bucket drifts from it by the generator's stated rule, with two
// absent hours and one withheld hour the axis must count as such; the feed
// page is one cross-engine page under the Book's clock — 50 rows, the timed
// section newest first, a disclosed untimed tail of two, exactly three
// liquidations — whose amounts render through the Feed's own unit law. The
// clock law walks all three bodies and its census is the generator's own pin.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { EVENT_DISPLAY_TYPES, FEED_ENGINES, splitUntimedTail } from "../../lib/feed-data";
import { feedAmount } from "../../lib/feed-view";
import { NATIVE_BUCKET_SECONDS, buildBucketAxis } from "../../lib/observatory-series";
import {
  DEMO_BATCH_ID,
  DEMO_BOOK,
  DEMO_FEED_PAGE_1,
  DEMO_HISTORY_NEAR,
  DEMO_META,
  DEMO_OBSERVATORY_AAVE,
  DEMO_OBSERVATORY_DM,
  DEMO_POSITIONS_DM_PAGE_1,
  DEMO_POSITIONS_DM_PAGE_2,
} from "../fixtures/demo";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "..", "fixtures");

/** The generator's stated shape: 168 native buckets, hours 40 and 41 back absent, hour 90 back withheld. */
const HOURS = 168;
const ABSENT_HOURS_BACK = [40, 41];
const WITHHELD_HOUR_BACK = 90;
/** The generator's drift rule: at most 40 bps of the Book's figure per hour between neighbours. */
const DRIFT_BPS_PER_HOUR = 40n;
const HOUR_MS = NATIVE_BUCKET_SECONDS * 1000;

const SERIES = [
  { body: DEMO_OBSERVATORY_DM, engine: "debt_manager" },
  { body: DEMO_OBSERVATORY_AAVE, engine: "aave_v3_etherfi" },
] as const;

const card = (engine: string) => DEMO_BOOK.engines.find((e) => e.engine === engine)!;
const watermark = (engine: string) => DEMO_BOOK.batch.watermarks.find((w) => w.engine === engine)!;
const decimal = (value: string | null, what: string): bigint => {
  if (value === null) throw new Error(`${what} is null on the Book; the weld has nothing to hold`);
  return BigInt(value);
};
/** The newest bucket: the hour the Book's batch was computed in. */
const newestBucketMs = Math.floor(Date.parse(DEMO_BOOK.batch.computed_at) / HOUR_MS) * HOUR_MS;
const bucketIso = (hoursBack: number) =>
  new Date(newestBucketMs - hoursBack * HOUR_MS).toISOString().replace(/\.000Z$/, "Z");

test("every body shares the Book's demo clock and batch identity", () => {
  expect(DEMO_META.served_at).toBe(DEMO_BOOK.served_at);
  // The meta's batch is nullable on the contract; the demo's is the Book's, and the generator asserts the two agree.
  expect(DEMO_META.batch?.id).toBe(DEMO_BATCH_ID);
  for (const body of [DEMO_OBSERVATORY_DM, DEMO_OBSERVATORY_AAVE, DEMO_FEED_PAGE_1]) {
    expect(body.served_at).toBe(DEMO_BOOK.served_at);
  }
});

for (const { body, engine } of SERIES) {
  test.describe(`the ${engine} series`, () => {
    test("168 native buckets, oldest first: 165 captured, 2 absent, 1 withheld — the axis counts them", () => {
      expect(body.engine).toBe(engine);
      expect(body.usd_decimals).toBe(card(engine).value_decimals);
      expect(body.step_seconds).toBeNull();
      expect(body.to).toBeNull();
      const axis = buildBucketAxis(body);
      expect(axis.strideSeconds).toBe(NATIVE_BUCKET_SECONDS);
      expect(axis.entries).toHaveLength(HOURS);
      expect(axis.capturedCount).toBe(HOURS - ABSENT_HOURS_BACK.length - 1);
      expect(axis.absentCount).toBe(ABSENT_HOURS_BACK.length);
      expect(axis.withheldCount).toBe(1);
      expect(axis.newestPointIndex).toBe(HOURS - 1);
      axis.entries.forEach((entry, i) => expect(entry.bucketStart).toBe(bucketIso(HOURS - 1 - i)));
      // The wire is oldest first (the contract), one point per non-absent hour; `from` is the oldest bucket.
      expect(body.points).toHaveLength(HOURS - ABSENT_HOURS_BACK.length);
      expect(body.points.map((p) => p.bucket_start)).toEqual(
        axis.entries.filter((e) => e.point !== null).map((e) => e.bucketStart),
      );
      expect(body.from).toBe(bucketIso(HOURS - 1));
      // Provenance is monotone: a newer bucket observed a newer batch at a higher watermark.
      for (let i = 1; i < body.points.length; i += 1) {
        expect(body.points[i]!.batch_id).toBeGreaterThan(body.points[i - 1]!.batch_id);
        expect(body.points[i]!.last_block).toBeGreaterThan(body.points[i - 1]!.last_block);
      }
    });

    test("the newest captured bucket IS the Book's engine card and watermark", () => {
      const c = card(engine);
      const w = watermark(engine);
      const newest = body.points[body.points.length - 1]!;
      expect(newest.bucket_start).toBe(bucketIso(0));
      expect(newest.refused).toBe(false);
      expect(newest.refusal_code).toBeNull();
      expect(newest.debt_usd).toBe(String(c.total_debt));
      expect(newest.collateral_usd).toBe(String(c.total_collateral));
      expect(newest.accounts).toBe(c.positions);
      expect(newest.refused_positions).toBe(c.refused_positions);
      expect(newest.liquidatable_positions).toBe(c.liquidatable_positions);
      expect(newest.batch_id).toBe(DEMO_BATCH_ID);
      expect(newest.batch_id).toBe(DEMO_BOOK.batch.id);
      expect(newest.last_block).toBe(w.last_block);
      expect(newest.acked_epoch).toBe(w.acked_epoch);
      expect(newest.max_epoch_at_compute).toBe(w.max_epoch_at_compute);
      // The sweep stamp travels on the point: the Book's own (its age is against the same served_at), or the disclosed null.
      expect(newest.sweep_recorded).toBe(true);
      expect(newest.sweep).toEqual(w.sweep);
      expect(newest.sweep).toEqual(c.sweep);
      expect(newest.materialization_key).toMatch(/^[0-9a-f]{64}$/);
    });

    test("the holes are honest: hours 40 and 41 back carry no point; hour 90 back is withheld with null totals and a named code", () => {
      const axis = buildBucketAxis(body);
      const kinds = new Map(axis.entries.map((e) => [e.bucketStart, e.kind]));
      for (const h of ABSENT_HOURS_BACK) {
        expect(kinds.get(bucketIso(h))).toBe("absent");
        expect(body.points.some((p) => p.bucket_start === bucketIso(h))).toBe(false);
      }
      expect(kinds.get(bucketIso(WITHHELD_HOUR_BACK))).toBe("withheld");
      const withheld = body.points.filter((p) => p.refused);
      expect(withheld).toHaveLength(1);
      const point = withheld[0]!;
      expect(point.bucket_start).toBe(bucketIso(WITHHELD_HOUR_BACK));
      expect(point.refusal_code).toBe("FLAG_CUSTODY_UNPROVEN");
      expect(point.accounts).toBeNull();
      expect(point.liquidatable_positions).toBeNull();
      expect(point.debt_usd).toBeNull();
      expect(point.collateral_usd).toBeNull();
      expect(point.refused_positions).toBe(0);
      expect(point.rates).toEqual([]);
      expect(point.sweep_recorded).toBe(true);
    });

    test("every older bucket drifts from the Book by at most 0.4 percent an hour; liquidatable stays within one of the Book's count", () => {
      const c = card(engine);
      const bookDebt = decimal(c.total_debt, `${engine} total_debt`);
      const bookCollateral = decimal(c.total_collateral, `${engine} total_collateral`);
      const captured = body.points.filter((p) => !p.refused);
      const bound = (book: bigint, hours: number) => (book * DRIFT_BPS_PER_HOUR * BigInt(hours)) / 10_000n + 1n;
      const abs = (v: bigint) => (v < 0n ? -v : v);
      for (let i = 1; i < captured.length; i += 1) {
        const older = captured[i - 1]!;
        const newer = captured[i]!;
        const hours = Math.round((Date.parse(newer.bucket_start) - Date.parse(older.bucket_start)) / HOUR_MS);
        expect(hours).toBeGreaterThanOrEqual(1);
        const within = (metric: string, delta: bigint, book: bigint) =>
          expect(delta <= bound(book, hours), `${engine} ${metric} moved ${String(delta)} between ${older.bucket_start} and ${newer.bucket_start}`).toBe(true);
        within("debt_usd", abs(BigInt(newer.debt_usd!) - BigInt(older.debt_usd!)), bookDebt);
        within("collateral_usd", abs(BigInt(newer.collateral_usd!) - BigInt(older.collateral_usd!)), bookCollateral);
        within("accounts", abs(BigInt(newer.accounts!) - BigInt(older.accounts!)), BigInt(c.positions));
      }
      for (const p of captured) {
        expect(Math.abs(p.liquidatable_positions! - c.liquidatable_positions)).toBeLessThanOrEqual(1);
        expect(p.refused_positions).toBe(c.refused_positions);
        expect(p.accounts!).toBeGreaterThan(p.refused_positions + p.liquidatable_positions!);
        expect(p.debt_usd).toMatch(/^[1-9]\d*$/);
        expect(p.collateral_usd).toMatch(/^[1-9]\d*$/);
        expect(BigInt(p.collateral_usd!) > BigInt(p.debt_usd!)).toBe(true);
        expect(p.rates).toHaveLength(1);
        expect(p.rates[0]!.engine).toBe(engine);
        expect(p.rates[0]!.as_of_block).toBeLessThanOrEqual(p.last_block);
      }
      // A record, not a flat line: the walk actually moved.
      expect(new Set(captured.map((p) => p.debt_usd)).size).toBeGreaterThan(100);
      expect(captured.some((p) => p.liquidatable_positions !== c.liquidatable_positions)).toBe(true);
    });
  });
}

test("both series observe the same batches, and bucket 1 observes the Inspector history's newest batch before the hour", () => {
  expect(DEMO_OBSERVATORY_AAVE.points.map((p) => p.batch_id)).toEqual(DEMO_OBSERVATORY_DM.points.map((p) => p.batch_id));
  expect(DEMO_OBSERVATORY_AAVE.points.map((p) => p.bucket_start)).toEqual(DEMO_OBSERVATORY_DM.points.map((p) => p.bucket_start));
  const boundary = bucketIso(0);
  const prior = DEMO_HISTORY_NEAR.engines
    .find((e) => e.engine === "debt_manager")!
    .points.filter((p) => p.computed_at < boundary)
    .sort((a, b) => b.batch_id - a.batch_id)[0]!;
  const bucket1 = DEMO_OBSERVATORY_DM.points.find((p) => p.bucket_start === bucketIso(1))!;
  expect(bucket1.batch_id).toBe(prior.batch_id);
  expect(bucket1.last_block).toBe(prior.balances_block);
  // The Aave sweep is the contract's disclosed "no sweeper" null on every point; the Cash sweep rides every point.
  for (const p of DEMO_OBSERVATORY_AAVE.points) expect(p.sweep).toBeNull();
  for (const p of DEMO_OBSERVATORY_DM.points) expect(p.sweep).not.toBeNull();
});

test.describe("the feed page", () => {
  const rows = DEMO_FEED_PAGE_1.events;
  const positions = new Map(
    [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => [p.account.toLowerCase(), p]),
  );

  test("one cross-engine page: 50 rows, 48 timed newest first, a disclosed untimed tail of 2, more behind the cursor", () => {
    expect(DEMO_FEED_PAGE_1.limit).toBe(50);
    expect(rows).toHaveLength(50);
    expect(DEMO_FEED_PAGE_1.filter).toEqual({ engine: null, account: null, types: [], since_block: null });
    expect(DEMO_FEED_PAGE_1.next_cursor).not.toBeNull();
    const split = splitUntimedTail(rows);
    expect(split.timed).toHaveLength(48);
    expect(split.untimed).toHaveLength(2);
    expect(split.orderViolated).toBe(false);
    const servedMs = Date.parse(DEMO_FEED_PAGE_1.served_at);
    for (let i = 0; i < split.timed.length; i += 1) {
      const at = Date.parse(split.timed[i]!.block_time!);
      expect(at).toBeLessThan(servedMs);
      if (i > 0) expect(at).toBeLessThanOrEqual(Date.parse(split.timed[i - 1]!.block_time!));
    }
    // The tail's tiebreak is chain-aware, never chronology: chain_id DESC puts the OP row before the ETH row.
    expect(split.untimed.map((r) => r.chain_id)).toEqual([10, 1]);
    expect(split.untimed.every((r) => r.block_time === null)).toBe(true);
    // Both engines, interleaved; every row sits on its engine's chain at or below the Book's watermark.
    expect(new Set(rows.map((r) => r.engine))).toEqual(new Set(FEED_ENGINES));
    expect(new Set(split.timed.slice(0, 6).map((r) => r.engine)).size).toBe(2);
    for (const r of rows) {
      const w = watermark(r.engine);
      expect(r.chain_id).toBe(w.chain_id);
      expect(r.block_number).toBeLessThanOrEqual(w.last_block);
      expect(r.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(r.account).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(r.seq).toBe(0);
    }
    // Within one engine, heights fall with the walk (the untimed row of each engine is its oldest).
    for (const engine of FEED_ENGINES) {
      const heights = rows.filter((r) => r.engine === engine).map((r) => r.block_number);
      for (let i = 1; i < heights.length; i += 1) expect(heights[i]!).toBeLessThanOrEqual(heights[i - 1]!);
    }
  });

  test("the vocabulary is the Feed's closed set with every class drawn; exactly three liquidations carry the extract", () => {
    for (const r of rows) expect(EVENT_DISPLAY_TYPES).toContain(r.type);
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(EVENT_DISPLAY_TYPES));
    expect(rows.filter((r) => r.type === "liquidation")).toHaveLength(3);
    for (const r of rows) expect(r.liquidation === null, `${r.type} row ${r.tx_hash}`).toBe(r.type !== "liquidation");
    // The store's own classification (internal/store/p5_events.go): raw type and unit per engine and class.
    for (const r of rows) {
      const aave = r.engine === "aave_v3_etherfi";
      if (r.type === "liquidation") expect(r.raw_type).toBe(aave ? "aave_liquidation_call" : "liquidation");
      if (r.type === "borrow") expect(r.raw_type).toBe(aave ? "aave_borrow" : "borrow");
      if (r.type === "repay") expect(r.raw_type).toBe(aave ? "aave_repay" : "repay");
      if (r.type === "supply") expect(r.raw_type).toBe(aave ? "aave_supply" : "supplied");
      if (r.type === "withdraw") expect(r.raw_type).toBe(aave ? "aave_withdraw" : "withdraw_borrow_token");
      if (r.type === "collateral_enabled" || r.type === "collateral_disabled" || r.type === "deficit_created") expect(aave).toBe(true);
    }
  });

  test("every amount is a wire decimal in its engine's own unit and renders through the Feed's unit law", () => {
    for (const r of rows) {
      expect(r.amount_decimals).toBeNull();
      if (r.amount_unit === "none") {
        expect(r.amount).toBeNull();
        expect(["supply", "withdraw", "collateral_enabled", "collateral_disabled"]).toContain(r.type);
        expect(feedAmount(r).kind).toBe("record-only");
        continue;
      }
      expect(r.amount).toMatch(/^-?[1-9]\d*$/);
      const rendered = feedAmount(r, { engineValueDecimals: card(r.engine).value_decimals });
      if (rendered.kind !== "amount") throw new Error(`${r.tx_hash}: a tagged amount rendered as ${rendered.kind}`);
      if (r.engine === "debt_manager") {
        // Normalized debt IS a fixed point at the Book's value_decimals: the decimal lands there
        // (the formatter trims trailing zeros, so the pin is the integer part, not a digit count).
        expect(r.amount_unit).toBe("dm_normalized_debt");
        expect(rendered.rawUnits).toBe(false);
        const value = BigInt(r.amount!);
        const magnitude = value < 0n ? -value : value;
        const whole = (magnitude / 10n ** BigInt(card("debt_manager").value_decimals)).toString();
        const display = rendered.display.replace(/^−/, "").replace(/,/g, "");
        expect(display === whole || display.startsWith(`${whole}.`), `${rendered.display} places ${r.amount!}`).toBe(true);
        // A negative figure prints the typographic minus, never the hyphen.
        expect(rendered.display.startsWith("−")).toBe(value < 0n);
      } else {
        // Ray-scaled units: the engine's base-currency decimals are a different unit and are NOT applied.
        expect(r.amount_unit).toBe("aave_scaled");
        expect(rendered.rawUnits).toBe(true);
        // The wire's own digits, grouped for reading and never scaled; the sign is the display minus.
        expect(rendered.display.replace(/,/g, "").replace(/^−/, "-")).toBe(r.amount);
      }
      // Signed on the debt side: borrows add, repays / liquidations / write-offs remove.
      if (r.type === "borrow") expect(r.amount!.startsWith("-")).toBe(false);
      if (r.type === "repay" || r.type === "liquidation" || r.type === "deficit_created") expect(r.amount!.startsWith("-")).toBe(true);
    }
  });

  test("the Debt Manager rows are the demo positions' own accounts; its liquidations close the Book's first pass on liquidatable rows", () => {
    const dm = card("debt_manager");
    for (const r of rows.filter((r) => r.engine === "debt_manager")) {
      expect(positions.has(r.account.toLowerCase()), `${r.account} is not a demo position`).toBe(true);
    }
    const liquidations = rows.filter((r) => r.type === "liquidation" && r.engine === "debt_manager");
    expect(liquidations).toHaveLength(2);
    expect(new Set(liquidations.map((r) => r.account)).size).toBe(2);
    for (const r of liquidations) {
      const position = positions.get(r.account.toLowerCase())!;
      expect(position.liquidatable).toBe(true);
      const d = r.liquidation!;
      expect(d.before_debt_usd).toBe(String(position.total_debt));
      expect(d.debt_repaid).toBe((decimal(position.total_debt, "position total_debt") / 2n).toString());
      expect(d.debt_decimals).toBe(dm.value_decimals);
      expect(d.debt_asset).toBeNull();
      expect(d.deficit_paired).toBeNull();
      expect(d.interest_index).toMatch(/^[1-9]\d*$/);
      expect(d.realized_bonus_bps).toBeNull();
      expect(d.configured_bonus_bps).toBeNull();
      expect(d.seized.length).toBeGreaterThan(0);
      for (const leg of d.seized) {
        expect(leg.amount).toMatch(/^[1-9]\d*$/);
        expect(leg.bonus).not.toBeNull();
      }
    }
    // The other DM rows are computed, non-liquidatable positions.
    for (const r of rows.filter((r) => r.engine === "debt_manager" && r.type !== "liquidation")) {
      const position = positions.get(r.account.toLowerCase())!;
      expect(position.status).toBe("computed");
      expect(position.liquidatable).toBe(false);
    }
  });

  test("the Aave liquidation is deficit-paired with the write-off that shares its transaction", () => {
    const liquidation = rows.find((r) => r.type === "liquidation" && r.engine === "aave_v3_etherfi")!;
    const deficits = rows.filter((r) => r.type === "deficit_created");
    expect(deficits).toHaveLength(1);
    const deficit = deficits[0]!;
    expect(deficit.engine).toBe("aave_v3_etherfi");
    expect(deficit.tx_hash).toBe(liquidation.tx_hash);
    expect(deficit.block_number).toBe(liquidation.block_number);
    expect(deficit.block_time).toBe(liquidation.block_time);
    expect(deficit.account).toBe(liquidation.account);
    // Same block: the higher log index serves first in DESC order.
    expect(deficit.log_index).toBe(liquidation.log_index + 1);
    expect(rows.indexOf(deficit)).toBe(rows.indexOf(liquidation) - 1);
    const d = liquidation.liquidation!;
    expect(d.deficit_paired).toBe(true);
    expect(d.before_debt_usd).toBeNull();
    expect(d.interest_index).toBeNull();
    expect(d.realized_bonus_bps).toBeNull();
    expect(d.configured_bonus_bps).toBe("500");
    expect(d.debt_asset).toBe(liquidation.asset);
    expect(d.seized).toHaveLength(1);
    expect(d.seized[0]!.bonus).toBeNull();
  });
});

test("checkClocks passes over the three bodies, and the trio census is the generator's own pin", async () => {
  const law = (await import(pathToFileURL(path.join(fixturesDir, "clock-law.mjs")).href)) as {
    checkClocks: (body: unknown) => { checked: number; failures: string[] };
  };
  expect(typeof law.checkClocks).toBe("function");
  const source = readFileSync(path.join(fixturesDir, "demo", "generate-demo-secondary.mjs"), "utf8");
  const block = /const CLOCK_TRIOS = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
  const pins = new Map([...block.matchAll(/"([^"]+\.json)":\s*(\d+)/g)].map((m) => [m[1] ?? "", Number(m[2])]));
  const bodies: Record<string, unknown> = {
    "observatory-demo-dm.json": DEMO_OBSERVATORY_DM,
    "observatory-demo-aave.json": DEMO_OBSERVATORY_AAVE,
    "events-demo-feed-page-1.json": DEMO_FEED_PAGE_1,
  };
  expect([...pins.keys()].sort()).toEqual(Object.keys(bodies).sort());
  for (const [name, body] of Object.entries(bodies)) {
    const report = law.checkClocks(body);
    expect(report.failures, name).toEqual([]);
    expect(report.checked, name).toBe(pins.get(name));
  }
  // Every debt_manager point carries the sweep stamp (a trio each); the Aave series has no sweeper; the feed carries no clock.
  expect(pins.get("observatory-demo-dm.json")).toBe(DEMO_OBSERVATORY_DM.points.length);
  expect(pins.get("observatory-demo-aave.json")).toBe(0);
  expect(pins.get("events-demo-feed-page-1.json")).toBe(0);
});
