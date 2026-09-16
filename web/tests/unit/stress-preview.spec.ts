// web/tests/unit/stress-preview.spec.ts
import { expect, test } from "@playwright/test";
import { stressPreview } from "../../lib/stress-preview";
import { BOOK, BOOK_ENGINE_REFUSED, BOOK_MONOTONICITY_VIOLATION } from "../fixtures/book";

type Waterfall = NonNullable<typeof BOOK.waterfall>;

/** The wire allows a null waterfall (a withheld grid); each committed book fixture serves one. */
function served(book: { readonly waterfall: Waterfall | null }): Waterfall {
  if (book.waterfall === null) throw new Error("fixture invariant: the book fixture serves a waterfall");
  return book.waterfall;
}

const waterfall = served(BOOK);

test("the committed book fixture previews one line per shocked grid point, per engine", () => {
  const aave = stressPreview(waterfall,"aave_v3_etherfi");
  expect(aave.kind).toBe("view");
  if (aave.kind !== "view") return;
  expect(aave.scenarioId).toBe("eth_minus_30");
  expect(aave.lines.map((l) => l.shock)).toEqual(["ETH −10%", "ETH −20%", "ETH −30%", "ETH −40%", "ETH −50%"]);
  expect(aave.lines[0]?.text).toBe("ETH −10% → +$6,000 liquidatable · 1 account · bad debt $0");
  expect(aave.lines[0]?.deltaDebt).toBe(600_000_000_000n);
  expect(aave.lines[0]?.deltaAccounts).toBe(1);

  const dm = stressPreview(waterfall,"debt_manager");
  expect(dm.kind).toBe("view");
  if (dm.kind !== "view") return;
  expect(dm.lines[0]?.text).toBe("ETH −10% → no new liquidatable debt · bad debt $635.64");
  expect(dm.lines[0]?.deltaDebt).toBe(0n);
});

test("an engine absent from the grid is absent, never a zero line", () => {
  expect(stressPreview(waterfall,"nobody")).toEqual({ kind: "absent" });
});

test("a malformed cumulative figure refuses the whole preview", () => {
  const broken = structuredClone(waterfall);
  const at = broken.points[1]?.engines.find((e) => e.engine === "debt_manager");
  if (at === undefined) throw new Error("fixture invariant");
  // "4.2e9" is what Number() would silently coerce to 4200000000; the wire guard rejects it.
  at.cumulative_debt_eligible_usd = "4.2e9";
  const out = stressPreview(broken, "debt_manager");
  expect(out.kind).toBe("refused");
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
  const at = unflagged.points[2]?.engines.find((e) => e.engine === "aave_v3_etherfi");
  if (at === undefined) throw new Error("fixture invariant");
  at.cumulative_debt_eligible_usd = "500000000000"; // below point 1's 600000000000
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
