// The evidence-descriptor laws (lib/evidence.ts), pinned:
//   - comparators are ENGINE-EXACT and an unknown engine is a refusal, not a guess;
//   - every position descriptor is marked OPERATIONAL (LIVE · WATERMARKED) —
//     never "proven": reconcile welds belong to /v1/evidence;
//   - the materialization key is stated as NOT SERVED here, never invented;
//   - a stale price input surfaces with a non-default tone in the chain.

import { expect, test } from "@playwright/test";
import { refinePosition } from "@solvent/client";
import {
  comparatorFor,
  hfEvidence,
  liquidationPriceEvidence,
  totalEvidence,
} from "../../lib/evidence";
import { ADDRESS_FOUND } from "../fixtures/inspector";

const batch = ADDRESS_FOUND.batch;
const aaveWire = ADDRESS_FOUND.positions[0];
if (aaveWire === undefined) throw new Error("fixture invariant: aave position expected");
const aave = refinePosition(aaveWire);

test("comparators are engine-exact; an unknown engine refuses rather than guesses", () => {
  expect(comparatorFor("aave_v3_etherfi")).toContain("hf_wad < 1e18");
  expect(comparatorFor("aave_v3_etherfi")).toContain("equality is healthy");
  expect(comparatorFor("debt_manager")).toContain("debt > maxBorrowLT");
  expect(comparatorFor("some_future_engine")).toContain("refusing to guess");
});

test("a position descriptor is OPERATIONAL and never claims the proof marker", () => {
  const descriptor = hfEvidence(aave, batch, "1.08");
  expect(descriptor.marker).toBe("operational");
  expect(descriptor.markerNote).toContain("LIVE · WATERMARKED");
  expect(descriptor.markerNote).toContain("/v1/evidence");
});

test("the materialization key is stated as not-served — never invented", () => {
  const descriptor = hfEvidence(aave, batch, "1.08");
  const batchSection = descriptor.sections.find((s) => s.title === "BATCH · MATERIALIZATION");
  const keyRow = batchSection?.rows.find((row) => row.label === "materialization key");
  expect(keyRow?.value).toContain("not served on this surface");
  expect(keyRow?.value).toContain("/v1/evidence");
});

test("a stale price input travels through the chain with a visible (non-default) tone", () => {
  const descriptor = totalEvidence(aave, batch, "collateral", "8000");
  const priceSection = descriptor.sections.find((s) => s.title.startsWith("PRICE INPUTS"));
  const staleRow = priceSection?.rows.find((row) => row.value.includes("stale"));
  expect(staleRow).toBeDefined();
  expect(staleRow?.tone).toBe("warn");
});

// ---------------------------------------------------------------------------
// p0-8 finding 1, consistency leg — the DRAWER must obey the same law as the
// row: the ceil-health sentence ("at exactly this price the position is still
// HEALTHY") is a positive health claim, and it may only render when a numeric
// boundary EXISTS on the wire AND the wire itself asserts
// `boundary_is_healthy: true`. An absent boundary states "not established"
// instead; a declined one names `boundary_is_healthy: false`.
// ---------------------------------------------------------------------------

/** Every row of every section, flattened to searchable text. */
function drawerText(wire: NonNullable<typeof aaveWire>): string {
  const descriptor = liquidationPriceEvidence(refinePosition(wire), batch, "—");
  return descriptor.sections
    .flatMap((section) => section.rows)
    .map((row) => `${row.label}: ${row.value}`)
    .join("\n");
}

test("the drawer refuses the ceil-health assertion when prices is empty", () => {
  // structuredClone variant, single purpose: the contract-legal empty `prices`
  // array (no-debt / no-factor solves serve it) must not read as ceil-health.
  const wire = structuredClone(aaveWire);
  if (wire.liquidation_price === null) throw new Error("fixture invariant: aave lp expected");
  wire.liquidation_price.prices = [];
  const text = drawerText(wire);
  expect(text).not.toContain("still HEALTHY");
  expect(text).toContain("not established");
});

test("the drawer refuses the ceil-health assertion when lowest_healthy_price is null", () => {
  // structuredClone variant, single purpose: a served FactorPrice whose
  // boundary field is null (NullableDecimal) is an absent boundary too.
  const wire = structuredClone(aaveWire);
  const price = wire.liquidation_price?.prices[0];
  if (price === undefined) throw new Error("fixture invariant: factor price expected");
  price.lowest_healthy_price = null;
  const text = drawerText(wire);
  expect(text).not.toContain("still HEALTHY");
  expect(text).toContain("not established");
});

test("the drawer withholds the ceil assertion when the wire declines it (boundary_is_healthy: false)", () => {
  // structuredClone variant, single purpose: a numeric boundary the wire does
  // NOT certify as healthy keeps its number but loses the health sentence.
  const wire = structuredClone(aaveWire);
  if (wire.liquidation_price === null) throw new Error("fixture invariant: aave lp expected");
  wire.liquidation_price.boundary_is_healthy = false;
  const text = drawerText(wire);
  expect(text).not.toContain("still HEALTHY");
  expect(text).toContain("boundary_is_healthy: false");
});

test("the descriptor quotes the wire's own numbers for the HF law", () => {
  const descriptor = hfEvidence(aave, batch, "1.08");
  const focus = descriptor.sections[0];
  expect(focus?.title).toBe("THIS NUMBER");
  const values = focus?.rows.map((row) => row.value) ?? [];
  expect(values).toContain("1080000000000000000");
  expect(values).toContain("6480000000000000");
  expect(values).toContain("6000000000000000");
});
