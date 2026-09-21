// walkStep — the Cash walk's law, one pure step per fetched page. The hook
// fetches and lands; every judgement about a page is made here: a page that
// cannot be read ends the walk by name and never as a throw, an account is one
// identity across the walk whatever the case of its address, and a terminal
// page completes the walk only when the distinct rows delivered equal the
// census the wire advertised.
import { expect, test } from "@playwright/test";
import { refinePositionsResponse, type RefinedPositionsResponse } from "@solvent/client";
import { WALK_START, walkStep, type WalkStep, type WalkTally } from "../../lib/book-walk";
import { readCashRow } from "../../lib/cash-rows";
import { summarizeCash } from "../../lib/cash-summary";
import { POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { DEMO_BOOK, DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";

type Page = RefinedPositionsResponse;
type PageRow = Page["positions"][number];

const BATCH = POSITIONS_DM_PAGE_1.batch.id;
const EXPECT = { batchId: BATCH, engine: "debt_manager", decimals: 6, census: 2 } as const;
const base = refinePositionsResponse(POSITIONS_DM_PAGE_1);
const [A, B] = base.positions;
if (A === undefined || B === undefined) throw new Error("fixture invariant: the committed page serves two rows");

const page = (positions: PageRow[], over: Partial<Page> = {}): Page => ({ ...base, positions, ...over });
const landed = (step: WalkStep): WalkTally => {
  if (step.kind !== "landed") throw new Error(`expected the page to land, got ${step.kind}`);
  return step.tally;
};

test("the committed page lands whole and completes the walk: two distinct rows for a census of two", () => {
  const step = walkStep(page([A, B]), EXPECT, WALK_START);
  expect(step).toMatchObject({ kind: "landed", complete: true, next: null });
  if (step.kind !== "landed") return;
  expect(step.rows.map((r) => r.account)).toEqual([A.account, B.account]);
  expect(step.tally).toMatchObject({ advertised: 2, delivered: 2, pages: 1 });
  expect([...step.tally.accounts.entries()]).toEqual([
    [A.account.toLowerCase(), 1],
    [B.account.toLowerCase(), 1],
  ]);
});

test("a page that cannot be read ends the walk BY NAME, never as a throw: no batch, no body, a body the decoder chokes on — every read of the page sits inside the judged path", () => {
  // `positions: []` with `batch: null` is the shape the client's refinement lets through: the array refines, the batch rides along.
  const bodies: unknown[] = [{ ...page([]), batch: null }, { ...page([A, B]), batch: undefined }, { ...page([A, B]), batch: { id: null } }, null, undefined, 7, "page", []];
  for (const body of bodies) {
    expect(() => walkStep(body, EXPECT, WALK_START)).not.toThrow();
    const step = walkStep(body, EXPECT, WALK_START);
    expect(step.kind).toBe("stopped");
    if (step.kind !== "stopped") continue;
    // Not known to be the last page: the walk stopped before it read its end, and nothing of the page lands.
    expect(step.stop).toBe("before-end");
    expect(step.rows).toEqual([]);
    expect(step.fault.length).toBeGreaterThan(0);
  }
  expect(walkStep({ ...page([]), batch: null }, EXPECT, WALK_START)).toEqual({ kind: "stopped", rows: [], fault: "batch is not an object (got null)", stop: "before-end" });
  // A getter that throws mid-decode is caught and named — never an unhandled rejection that leaves the walk looking alive.
  const hostile = { ...page([A, B]) } as Record<string, unknown>;
  Object.defineProperty(hostile, "positions", { get: () => { throw new Error("boom"); }, enumerable: true });
  expect(() => walkStep(hostile, EXPECT, WALK_START)).not.toThrow();
  expect(walkStep(hostile, EXPECT, WALK_START)).toEqual({ kind: "stopped", rows: [], fault: "the page could not be decoded: boom", stop: "before-end" });
});

test("a page of another batch is handed back for the caller's one reload; a refused page is the engine's refusal — neither lands a row", () => {
  expect(walkStep(page([A, B], { batch: { ...base.batch, id: BATCH + 1 } }), EXPECT, WALK_START)).toEqual({ kind: "moved", batchId: BATCH + 1 });
  const refused = page([], { refused: true, refusal: { engine: "debt_manager", code: "SWEEP_FAILED", detail: "collateral sweep failed", note: "" }, total_positions: null });
  expect(walkStep(refused, EXPECT, WALK_START)).toEqual({ kind: "refused", code: "SWEEP_FAILED", detail: "collateral sweep failed" });
});

test("a duplicate account never satisfies the census: page one returns A, the terminal page returns A again — the walk does not complete, A is landed once, and the fault names the account and both pages", () => {
  const first = walkStep(page([A], { next_cursor: "p2" }), EXPECT, WALK_START);
  expect(first).toMatchObject({ kind: "landed", complete: false, next: "p2" });
  // Both pages advertise two rows and deliver one each: counted blind, `delivered === total` would complete the walk.
  const second = walkStep(page([A]), EXPECT, landed(first));
  expect(second).toEqual({
    kind: "stopped",
    rows: [],
    fault: `account ${A.account} was delivered on page 1 and again on page 2`,
    stop: "duplicate",
  });
  // Every row the hook lands across the two steps: A, once — its debt is never doubled.
  const rows = [...(first.kind === "landed" ? first.rows : []), ...(second.kind === "stopped" ? second.rows : [])];
  expect(rows.map((r) => r.account)).toEqual([A.account]);
  const summary = summarizeCash({
    rows,
    decimals: 6,
    refusedPositions: 0,
    refusedWhole: null,
    walkComplete: false,
    walkStopped: second.kind === "stopped" ? second.fault : null,
    walkStopKind: second.kind === "stopped" ? second.stop : null,
  });
  expect(summary.material).toEqual({ sum: 4_200_000_000n, count: 1 });
  expect(summary.settled).toBe(false);
  // No lower bound is claimed over a walk that delivered a duplicate.
  expect(summary.headline.dek).toBe(
    `The walk was served an account twice (account ${A.account} was delivered on page 1 and again on page 2); pages that repeat an account do not partition the book, so no figure here is a total or a lower bound.`,
  );
  expect(summary.headline.dek).not.toMatch(/every figure is a lower bound|at least/);
});

test("identity ignores the case an address is spelled in: the checksummed and the lower-cased spelling are one account, named as the repeating page spelled it", () => {
  const first = walkStep(page([A], { next_cursor: "p2" }), EXPECT, WALK_START);
  const lower = { ...A, account: A.account.toLowerCase() };
  expect(lower.account).not.toBe(A.account);
  const second = walkStep(page([lower]), EXPECT, landed(first));
  expect(second).toMatchObject({ kind: "stopped", stop: "duplicate", rows: [] });
  if (second.kind === "stopped") expect(second.fault).toBe(`account ${lower.account} was delivered on page 1 and again on page 2`);
  const upper = { ...A, account: `0x${A.account.slice(2).toUpperCase()}` };
  expect(walkStep(page([upper]), EXPECT, landed(first))).toMatchObject({ kind: "stopped", stop: "duplicate" });
});

test("a duplicate before completion is the same fault: the page's distinct rows still land, the repeated row never does, and a repeat within one page is named as such", () => {
  const first = walkStep(page([A], { next_cursor: "p2", total_positions: 3 }), { ...EXPECT, census: 3 }, WALK_START);
  // Page two repeats A beside a new account, and is NOT the last page.
  const second = walkStep(page([A, B], { next_cursor: "p3", total_positions: 3 }), { ...EXPECT, census: 3 }, landed(first));
  expect(second).toMatchObject({ kind: "stopped", stop: "duplicate" });
  if (second.kind !== "stopped") return;
  expect(second.rows.map((r) => r.account)).toEqual([B.account]);
  expect(second.fault).toBe(`account ${A.account} was delivered on page 1 and again on page 2`);
  // Twice on one page; and further repeated rows of that page are counted, the first is named.
  const within = walkStep(page([A, A]), EXPECT, WALK_START);
  expect(within).toMatchObject({ kind: "stopped", stop: "duplicate", fault: `account ${A.account} was delivered twice on page 1` });
  if (within.kind === "stopped") expect(within.rows.map((r) => r.account)).toEqual([A.account]);
  const many = walkStep(page([A, B, A, B, A], { total_positions: 5 }), { ...EXPECT, census: 5 }, WALK_START);
  expect(many).toMatchObject({ kind: "stopped", stop: "duplicate", fault: `account ${A.account} was delivered twice on page 1, and 2 more repeated rows on that page` });
  // A duplicate outranks the census fault the same page would raise: past its census AND repeating, the repeat is named.
  expect(walkStep(page([A, B, A]), EXPECT, WALK_START)).toMatchObject({ kind: "stopped", stop: "duplicate" });
});

test("the census faults stand as they did over distinct rows: short at the last page, past the census on any page, a census that changes mid-walk", () => {
  expect(walkStep(page([A, B], { total_positions: 3 }), { ...EXPECT, census: 3 }, WALK_START)).toEqual({
    kind: "stopped",
    rows: [readCashRow(A), readCashRow(B)],
    fault: "the walk delivered 2 of the 3 rows the wire advertised",
    stop: "at-end",
  });
  expect(walkStep(page([A, B], { total_positions: 1, next_cursor: "more" }), { ...EXPECT, census: 1 }, WALK_START)).toMatchObject({
    kind: "stopped",
    fault: "the walk delivered 2 rows for a census of 1",
    stop: "over",
  });
  const first = walkStep(page([A], { next_cursor: "p2", total_positions: 2 }), { ...EXPECT, census: null }, WALK_START);
  expect(walkStep(page([B], { total_positions: 5, next_cursor: "p3" }), { ...EXPECT, census: null }, landed(first))).toMatchObject({
    kind: "stopped",
    fault: "the census changed mid-walk: 2 rows advertised, then 5",
    stop: "before-end",
  });
  expect(walkStep(page([B], { total_positions: 5 }), { ...EXPECT, census: null }, landed(first))).toMatchObject({ kind: "stopped", stop: "at-end" });
});

test("the demo walk is a served, complete, duplicate-free walk: two pages land every account once and complete on the census", () => {
  const engine = DEMO_BOOK.engines.find((e) => e.engine === "debt_manager");
  if (engine === undefined) throw new Error("fixture invariant: the demo book serves the Cash engine");
  const expectation = { batchId: DEMO_BOOK.batch.id, engine: "debt_manager", decimals: engine.value_decimals, census: engine.positions };
  const one = walkStep(refinePositionsResponse(DEMO_POSITIONS_DM_PAGE_1), expectation, WALK_START);
  expect(one).toMatchObject({ kind: "landed", complete: false });
  const two = walkStep(refinePositionsResponse(DEMO_POSITIONS_DM_PAGE_2), expectation, landed(one));
  expect(two).toMatchObject({ kind: "landed", complete: true, next: null });
  expect(landed(two).delivered).toBe(engine.positions);
  expect(landed(two).accounts.size).toBe(engine.positions);
});
