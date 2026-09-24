// web/tests/unit/stress-preview.spec.ts
import { expect, test } from "@playwright/test";
import { stressPreview, unmeasuredSentence } from "../../lib/stress-preview";
import { BOOK, BOOK_ENGINE_REFUSED, BOOK_MONOTONICITY_VIOLATION } from "../fixtures/book";

type Waterfall = NonNullable<typeof BOOK.waterfall>;

/** The wire allows a null waterfall (a withheld grid); each committed book fixture serves one. */
function served(book: { readonly waterfall: Waterfall | null }): Waterfall {
  if (book.waterfall === null) throw new Error("fixture invariant: the book fixture serves a waterfall");
  return book.waterfall;
}

const waterfall = served(BOOK);

/** One engine's figures at one grid point of a cloned waterfall. */
function at(w: Waterfall, index: number, engine: string) {
  const point = w.points[index]?.engines.find((e) => e.engine === engine);
  if (point === undefined) throw new Error("fixture invariant");
  return point;
}

test("the committed book fixture previews one line per shocked grid point, per engine", () => {
  const aave = stressPreview(waterfall,"aave_v3_etherfi");
  expect(aave.kind).toBe("view");
  if (aave.kind !== "view") return;
  expect(aave.scenarioId).toBe("eth_minus_30");
  expect(aave.lines.map((l) => l.shock)).toEqual(["ETH −10%", "ETH −20%", "ETH −30%", "ETH −40%", "ETH −50%"]);
  expect(aave.lines[0]?.text).toBe("ETH −10%: +$6,000 liquidatable · 1 account · bad debt unchanged at $0");
  expect(aave.lines[0]?.deltaDebt).toBe(600_000_000_000n);
  expect(aave.lines[0]?.deltaAccounts).toBe(1);
  expect(aave.unmeasured).toBeNull();

  const dm = stressPreview(waterfall,"debt_manager");
  expect(dm.kind).toBe("view");
  if (dm.kind !== "view") return;
  expect(dm.lines[0]?.text).toBe("ETH −10%: no new liquidatable debt · bad debt +$396.03, to $635.64");
  expect(dm.lines[0]?.deltaDebt).toBe(0n);
});

test("bad debt is framed as the Scenarios page frames it — the rise over the grid's own unshocked point, then where it lands — never the standing figure alone", () => {
  const dm = stressPreview(waterfall, "debt_manager");
  if (dm.kind !== "view") throw new Error("expected a view");
  // The unshocked point carries $239.60 of standing bad debt; ETH −30% carries $1,427.72.
  expect(dm.lines.map((l) => l.text)).toEqual([
    "ETH −10%: no new liquidatable debt · bad debt +$396.03, to $635.64",
    "ETH −20%: no new liquidatable debt · bad debt +$792, to $1,031",
    "ETH −30%: no new liquidatable debt · bad debt +$1,188, to $1,427",
    "ETH −40%: no new liquidatable debt · bad debt +$1,584, to $1,823",
    "ETH −50%: no new liquidatable debt · bad debt +$1,980, to $2,219",
  ]);
  expect(dm.lines[0]?.deltaBadDebt).toBe(635_643_565n - 239_603_961n);
  // No rise is said as such, at the figure it holds; a fall carries U+2212, never a hyphen and never a "+".
  const aave = stressPreview(waterfall, "aave_v3_etherfi");
  if (aave.kind !== "view") throw new Error("expected a view");
  expect(aave.lines[0]?.text).toBe("ETH −10%: +$6,000 liquidatable · 1 account · bad debt unchanged at $0");
  const falling = structuredClone(waterfall);
  at(falling, 1, "debt_manager").cumulative_bad_debt_usd = "100000000";
  const fell = stressPreview(falling, "debt_manager");
  if (fell.kind !== "view") throw new Error("expected a view");
  expect(fell.lines[0]?.text).toBe("ETH −10%: no new liquidatable debt · bad debt −$139.60, to $100");
  // The line never points: an arrow on this product means a link to another page, and the line's own words say what moved.
  for (const line of [...dm.lines, ...aave.lines]) expect(line.text).not.toContain("→");
});

test("a change and the total it lands at print at one precision, and never alike when they differ; a count never parts from its noun", () => {
  // The unshocked point carries $240.20 of standing bad debt on Cash; from ETH −30% on, 118 more accounts are liquidatable.
  const book = structuredClone(waterfall);
  const base = at(book, 0, "debt_manager");
  base.cumulative_bad_debt_usd = "240200000";
  at(book, 1, "debt_manager").cumulative_bad_debt_usd = "1204590000";
  at(book, 2, "debt_manager").cumulative_bad_debt_usd = "118900000000";
  for (const i of [3, 4, 5]) {
    const point = at(book, i, "debt_manager");
    point.cumulative_bad_debt_usd = "118900000000";
    point.cumulative_debt_eligible_usd = (BigInt(base.cumulative_debt_eligible_usd) + 118_000_000_000n).toString();
    point.cumulative_eligible_accounts = base.cumulative_eligible_accounts + 118;
  }
  const out = stressPreview(book, "debt_manager");
  if (out.kind !== "view") throw new Error(`expected a view, got ${JSON.stringify(out)}`);
  // Not "+$964.39, to $1,204": the total's tier prints both.
  expect(out.lines[0]?.text).toBe("ETH −10%: no new liquidatable debt · bad debt +$964, to $1,204");
  // Not "+$118K, to $118K" for two different values: both take a digit.
  expect(out.lines[1]?.text).toBe("ETH −20%: no new liquidatable debt · bad debt +$118.6K, to $118.9K");
  // "118 accounts" is one unit: the no-break space keeps the count on its noun's line.
  expect(out.lines[2]?.text).toBe("ETH −30%: +$118K liquidatable · 118 accounts · bad debt +$118.6K, to $118.9K");
});

test("a shock is named by the one name builder: the grid's axis word and the factor's own exact percent; an axis this product does not name prints the wire's id", () => {
  const ethfi = { ...structuredClone(waterfall), axis: "asset_usd", axis_asset: "0xE0080D2F853ECDDBD81A643DC10DA075DF26FD3F" };
  const named = stressPreview(ethfi, "debt_manager");
  if (named.kind !== "view") throw new Error("expected a view");
  expect(named.lines.map((l) => l.shock)).toEqual(["ETHFI −10%", "ETHFI −20%", "ETHFI −30%", "ETHFI −40%", "ETHFI −50%"]);
  const unnamed = stressPreview({ ...structuredClone(waterfall), axis: "stable_usd" }, "debt_manager");
  if (unnamed.kind !== "view") throw new Error("expected a view");
  expect(unnamed.lines[0]?.shock).toBe("stable_usd −10%");
  // A factor off the tenths is printed exactly, never truncated to a whole percent.
  const odd = structuredClone(waterfall);
  const second = odd.points[1];
  if (second === undefined) throw new Error("fixture invariant");
  second.factor = "875000000000000000";
  const exact = stressPreview(odd, "debt_manager");
  if (exact.kind !== "view") throw new Error("expected a view");
  expect(exact.lines[0]?.shock).toBe("ETH −12.5%");
});

test("an engine absent from the grid is absent, never a zero line", () => {
  expect(stressPreview(waterfall,"nobody")).toEqual({ kind: "absent" });
});

test("an engine on the unshocked point but missing from a shocked one is missing coverage, named — never a shorter list", () => {
  const partial = structuredClone(waterfall);
  for (const p of partial.points.slice(1)) p.engines = p.engines.filter((e) => e.engine !== "debt_manager");
  expect(stressPreview(partial, "debt_manager")).toEqual({ kind: "refused", reason: "the engine is missing from grid point 1" });
  const hole = structuredClone(waterfall);
  const third = hole.points[3];
  if (third === undefined) throw new Error("fixture invariant");
  third.engines = third.engines.filter((e) => e.engine !== "aave_v3_etherfi");
  expect(stressPreview(hole, "aave_v3_etherfi")).toEqual({ kind: "refused", reason: "the engine is missing from grid point 3" });
  const unshocked = structuredClone(waterfall);
  unshocked.points = unshocked.points.slice(0, 1);
  expect(stressPreview(unshocked, "debt_manager")).toEqual({ kind: "refused", reason: "the grid has no shocked point" });
});

test("a malformed cumulative figure refuses the whole preview", () => {
  const broken = structuredClone(waterfall);
  // "4.2e9" is what Number() would silently coerce to 4200000000; the wire guard rejects it.
  at(broken, 1, "debt_manager").cumulative_debt_eligible_usd = "4.2e9";
  const out = stressPreview(broken, "debt_manager");
  expect(out.kind).toBe("refused");
});

test("populations pass their guard before subtraction: a null shocked population is refused, never '-1 accounts'; a falling one is a contradiction", () => {
  const nul = structuredClone(waterfall);
  at(nul, 1, "debt_manager").cumulative_eligible_accounts = null as unknown as number;
  expect(stressPreview(nul, "debt_manager")).toEqual({ kind: "refused", reason: "cumulative_eligible_accounts is not a wire population" });
  const negativeZero = structuredClone(waterfall);
  at(negativeZero, 2, "debt_manager").cumulative_eligible_accounts = -0;
  expect(stressPreview(negativeZero, "debt_manager")).toEqual({ kind: "refused", reason: "cumulative_eligible_accounts is not a wire population" });
  // aave's cumulative accounts run 0, 1, 1, 1, 1, 1: a drop back to 0 at point 2 is a cumulative population falling.
  const falling = structuredClone(waterfall);
  at(falling, 2, "aave_v3_etherfi").cumulative_eligible_accounts = 0;
  expect(stressPreview(falling, "aave_v3_etherfi")).toEqual({ kind: "refused", reason: "eligible accounts fall between grid points" });
});

test("scales are validated and reconciled before any figure is formatted or subtracted", () => {
  const negativeZero = structuredClone(waterfall);
  at(negativeZero, 0, "debt_manager").usd_decimals = -0;
  expect(stressPreview(negativeZero, "debt_manager")).toEqual({ kind: "refused", reason: "usd_decimals is not a wire scale" });
  const mixed = structuredClone(waterfall);
  at(mixed, 2, "debt_manager").usd_decimals = 18;
  expect(stressPreview(mixed, "debt_manager")).toEqual({ kind: "refused", reason: "grid points disagree on usd_decimals" });
});

test("positions the stress arithmetic excluded ride the preview, named beside the lines; the drawer's count is the wire's", () => {
  const excluded = [
    {
      engine: "debt_manager",
      account: "0xEEee000000000000000000000000000000000005",
      code: "API_RECONSTRUCTION_MISMATCH" as const,
      reason: "the position could not be rebuilt from its legs",
    },
  ];
  const coverage = { ...BOOK.coverage, excluded_by_this_layer: 1, stress_coverage_is_full: false, excluded };
  const dm = stressPreview(waterfall, "debt_manager", coverage);
  expect(dm.kind).toBe("view");
  if (dm.kind !== "view") return;
  expect(dm.unmeasured).toEqual({ count: 1, bookWide: 1, causes: ["could not be rebuilt for the stress arithmetic"], noun: "account" });
  expect(unmeasuredSentence(dm.unmeasured)).toBe(
    "1 account on this engine is excluded from the stress arithmetic (could not be rebuilt for the stress arithmetic); its movement is unmeasured and no line above speaks for it.",
  );
  // The lines themselves are unchanged: the exclusion is carried beside them, not folded into a figure.
  expect(dm.lines[0]?.text).toBe("ETH −10%: no new liquidatable debt · bad debt +$396.03, to $635.64");
  const aave = stressPreview(waterfall, "aave_v3_etherfi", coverage);
  if (aave.kind !== "view") throw new Error("expected a view");
  expect(aave.unmeasured).toEqual({ count: 0, bookWide: 1, causes: [], noun: "position" });
  expect(unmeasuredSentence(aave.unmeasured)).toBe("1 position on the book is excluded from the stress arithmetic, none on this engine.");
  // Nothing excluded: nothing said.
  const none = stressPreview(waterfall, "debt_manager", BOOK.coverage);
  if (none.kind !== "view") throw new Error("expected a view");
  expect(none.unmeasured).toBeNull();
  expect(unmeasuredSentence(null)).toBeNull();
  // A count the guard refuses, or a list longer than its count, refuses the preview.
  expect(stressPreview(waterfall, "debt_manager", { ...coverage, excluded_by_this_layer: -0 })).toEqual({
    kind: "refused",
    reason: "coverage.excluded_by_this_layer is not a wire population",
  });
  expect(stressPreview(waterfall, "debt_manager", { ...coverage, excluded_by_this_layer: 0 })).toEqual({
    kind: "refused",
    reason: "coverage lists more excluded positions than it counts",
  });
});

test("an engine the wire withheld at the aggregate level is a refusal with the plain cause, never absent", () => {
  // book-engine-refused.json: aave is in excluded_engines (FLAG_CUSTODY_UNPROVEN) and on no grid point.
  const refused = served(BOOK_ENGINE_REFUSED);
  expect(refused.points.every((p) => p.engines.every((e) => e.engine !== "aave_v3_etherfi"))).toBe(true);
  expect(stressPreview(refused, "aave_v3_etherfi")).toEqual({ kind: "refused", reason: "collateral-flag custody unproven" });
  // The refusal is whole-engine by design; the other engine serves normally.
  expect(stressPreview(refused, "debt_manager").kind).toBe("view");
  // A code that collides with Object.prototype falls through to the code, never to a prototype member.
  const collided = structuredClone(refused);
  collided.excluded_engines.push({ engine: "ghost", code: "constructor", detail: "", note: "" });
  expect(stressPreview(collided, "ghost")).toEqual({ kind: "refused", reason: "refused (constructor)" });
});

test("a non-monotone eligible-debt series is refused, never smoothed into 'no new liquidatable debt'", () => {
  // The wire's own report: book-monotonicity-violation.json names debt_manager at index 2.
  const reported = served(BOOK_MONOTONICITY_VIOLATION);
  expect(reported.monotonicity.ok).toBe(false);
  expect(stressPreview(reported, "debt_manager")).toEqual({
    kind: "refused",
    reason: "cumulative_debt_eligible_usd fell from 4200000000 to 4100000000 between grid points 1 and 2",
  });
  // The report names one engine; the other's monotone series still previews.
  expect(stressPreview(reported, "aave_v3_etherfi").kind).toBe("view");
  // Independently of the report: a dip the wire did not flag is still caught between consecutive points.
  const unflagged = structuredClone(waterfall);
  at(unflagged, 2, "aave_v3_etherfi").cumulative_debt_eligible_usd = "500000000000"; // below point 1's 600000000000
  expect(unflagged.monotonicity).toEqual({ ok: true });
  expect(stressPreview(unflagged, "aave_v3_etherfi")).toEqual({ kind: "refused", reason: "eligible debt falls between grid points" });
});

test("a grid whose first point is not the unshocked mark is refused", () => {
  const skewed = structuredClone(waterfall);
  const first = skewed.points[0];
  if (first === undefined) throw new Error("fixture invariant");
  first.factor = "999999999999999999";
  expect(stressPreview(skewed, "aave_v3_etherfi")).toEqual({ kind: "refused", reason: "the grid's first point is not the unshocked mark" });
});

test("a waterfall served with no points is a named refusal for every caller — never 'absent' — and the engine's own cause still speaks first", () => {
  expect(stressPreview({ ...waterfall, points: [] }, "debt_manager")).toEqual({ kind: "refused", reason: "no points published" });
  expect(stressPreview({ ...waterfall, points: null as unknown as Waterfall["points"] }, "debt_manager")).toEqual({
    kind: "refused",
    reason: "waterfall.points is not a list",
  });
  // The grid excludes the engine by name AND serves no points: the more specific refusal is the engine's.
  const excluded = { ...waterfall, points: [], excluded_engines: [{ engine: "debt_manager", code: "SWEEP_FAILED", detail: "", note: "" }] };
  expect(stressPreview(excluded, "debt_manager")).toEqual({ kind: "refused", reason: "collateral sweep failed" });
});
