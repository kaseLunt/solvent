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

test("the drawer folds the observed prices:null serialization into the absent-boundary arm", () => {
  // p0-9 finding 3 — structuredClone variant, single purpose: REPRODUCE the
  // API's actual solver-error serialization (cmd/api's wireLiquidationPrice
  // marshals a Go nil slice as `prices: null`), CONTRACT-VIOLATING per
  // api/openapi.yaml's required array but OBSERVED on the wire. `as never`
  // marks the deliberate violation. The drawer must fold it into the same
  // not-established arm — reason exposed, no crash, no health claim.
  const wire = structuredClone(aaveWire);
  if (wire.liquidation_price === null) throw new Error("fixture invariant: aave lp expected");
  wire.liquidation_price.prices = null as never;
  wire.liquidation_price.reason = "solver error: the boundary solve did not complete";
  const text = drawerText(wire);
  expect(text).not.toContain("still HEALTHY");
  expect(text).toContain("not established");
  expect(text).toContain("solver error: the boundary solve did not complete");
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

// ---------------------------------------------------------------------------
// p1b-4 (closes Codex r3 finding 2) — the drawer classifies EVERY FactorPrice
// entry BEFORE it reads it. Post-p0-9 the defenses covered the array's
// existence and the boundary's null-ness only; every entry read was trusted:
// `prices: [null]` threw a TypeError at `first.lowest_healthy_price`, and an
// ABSENT `price_decimals` made `renderNullableDecimal` return the RAW scaled
// integer as a plausible number (silent wrong display — the worst class).
// PER-ENTRY INDEPENDENCE, decided and pinned here: each entry is classified
// independently; a bad entry renders its OWN malformed row and a good entry
// renders normally — one bad entry never hides a good one, and a good first
// entry's established boundary is never withdrawn by a bad second.
// ---------------------------------------------------------------------------

test("the drawer refuses an entry-level null (prices: [null]) without throwing", () => {
  // structuredClone variant, single purpose: REPRODUCE the p0-9
  // serialization class one level down — cmd/api marshals a Go nil pointer
  // as JSON null, and inside a served slice that is `prices: [null]`:
  // CONTRACT-VIOLATING per api/openapi.yaml (FactorPrice is non-nullable in
  // `prices`) but the same observed server family as p0-9's `prices: null`.
  // `as never` marks the deliberate violation.
  const wire = structuredClone(aaveWire);
  if (wire.liquidation_price === null) throw new Error("fixture invariant: aave lp expected");
  wire.liquidation_price.prices = [null as never];
  // p1b-8: the wire's own `reason` rides the unreadable row too — the card
  // arm and the not-established row both expose it, and the drawer's
  // unreadable boundary row was the one register that dropped it.
  wire.liquidation_price.reason = "solver detail the wire itself served";
  const text = drawerText(wire);
  // the entry's own malformed row, by index — nothing read off it
  expect(text).toContain("prices[0]");
  expect(text).toContain("malformed");
  // the boundary register is the UNREADABLE arm, not the not-established one:
  // "not established" states the solve published nothing; here the solve
  // published something nobody can read.
  expect(text).toContain("unreadable");
  expect(text).toContain("solver detail the wire itself served");
  expect(text).not.toContain("not established");
  expect(text).not.toContain("still HEALTHY");
});

test("a missing price_decimals refuses — the RAW scaled integer never renders as a price", () => {
  // structuredClone variant, single purpose: the silent-raw-render class.
  // Deleting the REQUIRED `price_decimals` (a version-skewed or partial
  // serializer's shape) hit renderNullableDecimal's no-scale branch, which
  // returned the raw "370370370371" as a plausible drawer value. The guard
  // must name the field and the raw digit-run must be ABSENT.
  const wire = structuredClone(aaveWire);
  const price = wire.liquidation_price?.prices[0];
  if (price === undefined) throw new Error("fixture invariant: factor price expected");
  delete (price as { price_decimals?: number }).price_decimals;
  const text = drawerText(wire);
  // THE KILL PIN: the fixture's raw scaled integer never appears as a value.
  expect(text).not.toContain("370370370371");
  expect(text).toContain("price_decimals");
  expect(text).toContain("unreadable");
  expect(text).not.toContain("still HEALTHY");
});

test("per-entry independence: a bad first entry does not hide a good second entry", () => {
  // structuredClone variant, single purpose: the independence law, bad-first
  // direction. Entry 0 is the entry-level null; entry 1 is the committed
  // entry untouched. The good entry renders its normal row (label + scaled
  // value); the bad one renders its own malformed row; no throw.
  const wire = structuredClone(aaveWire);
  if (wire.liquidation_price === null) throw new Error("fixture invariant: aave lp expected");
  const good = wire.liquidation_price.prices[0];
  if (good === undefined) throw new Error("fixture invariant: factor price expected");
  wire.liquidation_price.prices = [null as never, good];
  const text = drawerText(wire);
  expect(text).toContain("prices[0]");
  expect(text).toContain("malformed");
  // the good entry's normal row: committed asset prefix + the scaled value
  expect(text).toContain("lowest_healthy_price · 0xCd5fE23C…");
  expect(text).toContain("3703.70370371");
  // the BOUNDARY claim reads prices[0], which is unreadable — no health claim
  expect(text).toContain("unreadable");
  expect(text).not.toContain("still HEALTHY");
});

test("per-entry independence: a bad second entry is named without withdrawing the first's boundary", () => {
  // structuredClone variant, single purpose: the independence law, bad-second
  // direction. Entry 0 stays the committed entry (boundary established,
  // boundary_is_healthy true); entry 1 carries ONE documented corruption
  // (current_price: "" — outside the wire Decimal contract). The ceil
  // disclosure still renders off the readable first entry; the second is
  // refused by name.
  const wire = structuredClone(aaveWire);
  if (wire.liquidation_price === null) throw new Error("fixture invariant: aave lp expected");
  const good = wire.liquidation_price.prices[0];
  if (good === undefined) throw new Error("fixture invariant: factor price expected");
  const bad = structuredClone(good);
  bad.current_price = "";
  wire.liquidation_price.prices = [good, bad];
  const text = drawerText(wire);
  expect(text).toContain("still HEALTHY");
  expect(text).toContain("prices[1]");
  expect(text).toContain("current_price");
  expect(text).toContain("malformed");
});
