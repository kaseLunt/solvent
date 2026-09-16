// web/tests/unit/stress-preview.spec.ts
import { expect, test } from "@playwright/test";
import { stressPreview } from "../../lib/stress-preview";
import { BOOK } from "../fixtures/book";

// The wire allows a null waterfall (a withheld grid); the committed book serves one.
const waterfall = BOOK.waterfall;
if (waterfall === null) throw new Error("fixture invariant: book.json serves a waterfall");

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
