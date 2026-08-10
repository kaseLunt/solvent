// p1b-4 — THE FactorPrice ENTRY CLASSIFIER (closes Codex r3 finding 2).
// Post-p0-9 the Inspector's boundary defenses covered the ARRAY (a non-array
// `prices` folds into the not-established arm) and the boundary's null-ness —
// but every read OF an entry was trusted: `prices: [null]` threw a TypeError
// at `first.lowest_healthy_price`; a malformed `lowest_healthy_price` /
// `current_price` threw parseDecimal inside `money()`; a mis-shaped
// `price_decimals` threw assertScale; and an ABSENT `price_decimals` was the
// worst class of all — `money()`'s no-scale branch rendered the RAW scaled
// integer as a plausible price (silent wrong display, no throw to catch).
// `classifyFactorPrice` is the ONE law consulted BEFORE any entry property is
// read, by the card's boundary row AND the evidence drawer's per-entry map.
//
// The skeleton is the COMMITTED inspector fixture's own entry
// (tests/fixtures/inspector.ts, ADDRESS_FOUND): each test clones it, makes
// ONE documented corruption, and expects the classifier to name exactly that
// field. The untouched entry classifies CLEAN — the law refuses no served
// body. Sibling of set-run-classification.spec.ts (p1b-3): wireGuard
// primitives, wire read order, schema-exact nullability.

import { expect, test } from "@playwright/test";
import { classifyFactorPrice, type FactorPrice } from "../../lib/factorPriceGuard";
import { ADDRESS_FOUND } from "../fixtures/inspector";

/** The committed fixture's own FactorPrice entry, cloned. */
function committedEntry(): FactorPrice {
  const entry = ADDRESS_FOUND.positions[0]?.liquidation_price?.prices[0];
  if (entry === undefined) throw new Error("fixture invariant: factor price expected");
  return structuredClone(entry);
}

/** Clone the committed entry, apply ONE documented corruption, classify. */
function fieldsAfter(mutate: (entry: FactorPrice) => void): string[] {
  const entry = committedEntry();
  mutate(entry);
  const classified = classifyFactorPrice(entry);
  if (classified.ok) return [];
  return classified.fields;
}

// ---------------------------------------------------------------------------
// The clean arm: the committed entry passes, and the SAME object comes back.
// ---------------------------------------------------------------------------

test("p1b-4: the committed entry classifies CLEAN and the same object comes back", () => {
  const entry = committedEntry();
  const classified = classifyFactorPrice(entry);
  expect(classified.ok).toBe(true);
  if (classified.ok) {
    // identity, not equality: the guard admits the object it judged — no
    // clone, no reshape, so downstream reads see exactly the wire's bytes.
    expect(classified.entry).toBe(entry);
  }
});

test("p1b-4: the schema-legal nulls are statements, never malformed", () => {
  // price_floor and lowest_healthy_price are NullableDecimal — null is the
  // wire's own statement (no floor / no boundary), pinned each alone so a
  // nullable arm cannot regress silently.
  expect(
    fieldsAfter((entry) => {
      entry.price_floor = null;
    }),
  ).toEqual([]);
  expect(
    fieldsAfter((entry) => {
      entry.lowest_healthy_price = null;
    }),
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// The non-object arm: null, undefined, and non-object entries refuse whole.
// ---------------------------------------------------------------------------

test("p1b-4: a null entry refuses whole — prices: [null] is the p0-9 class one level down", () => {
  // cmd/api marshals a Go nil pointer as JSON null; inside a served slice
  // that is `prices: [null]` — contract-violating per api/openapi.yaml
  // (FactorPrice is non-nullable in `prices`) but the same observed
  // serialization family p0-9 finding 3 recorded for `prices: null`.
  expect(classifyFactorPrice(null)).toEqual({ ok: false, fields: ["entry"] });
});

test("p1b-4: undefined and non-object entries refuse whole", () => {
  expect(classifyFactorPrice(undefined)).toEqual({ ok: false, fields: ["entry"] });
  expect(classifyFactorPrice("370370370371")).toEqual({ ok: false, fields: ["entry"] });
  expect(classifyFactorPrice(42)).toEqual({ ok: false, fields: ["entry"] });
});

// ---------------------------------------------------------------------------
// The decimal fields: one documented corruption each, named by field.
// ---------------------------------------------------------------------------

test("p1b-4: a fractional lowest_healthy_price is named — parseDecimal threw on it before", () => {
  expect(
    fieldsAfter((entry) => {
      entry.lowest_healthy_price = "12.5";
    }),
  ).toEqual(["lowest_healthy_price"]);
});

test("p1b-4: an empty current_price is named — the BigInt-coercion class, never a silent 0", () => {
  expect(
    fieldsAfter((entry) => {
      entry.current_price = "";
    }),
  ).toEqual(["current_price"]);
});

test("p1b-4: a non-string asset is named", () => {
  expect(
    fieldsAfter((entry) => {
      (entry as { asset: unknown }).asset = null;
    }),
  ).toEqual(["asset"]);
});

// ---------------------------------------------------------------------------
// price_decimals — REQUIRED. Absent is malformed, NEVER the raw-render
// branch: a missing scale is the one corruption that does not throw
// downstream, because `money()`'s no-scale branch renders the RAW scaled
// integer as a plausible number. The silent-wrong-display class dies here.
// ---------------------------------------------------------------------------

test("p1b-4: an ABSENT price_decimals is malformed — the silent-raw-render class", () => {
  expect(
    fieldsAfter((entry) => {
      delete (entry as { price_decimals?: number }).price_decimals;
    }),
  ).toEqual(["price_decimals"]);
});

test("p1b-4: a negative price_decimals is named — assertScale threw on it before", () => {
  expect(
    fieldsAfter((entry) => {
      entry.price_decimals = -1;
    }),
  ).toEqual(["price_decimals"]);
});

test("p1b-4: a fractional price_decimals is named", () => {
  expect(
    fieldsAfter((entry) => {
      entry.price_decimals = 2.5;
    }),
  ).toEqual(["price_decimals"]);
});

test("p1b-4: a price_decimals beyond the renderer's bound (1001) is named", () => {
  expect(
    fieldsAfter((entry) => {
      entry.price_decimals = 1001;
    }),
  ).toEqual(["price_decimals"]);
});

// ---------------------------------------------------------------------------
// Read order: multiple failures are named in the wire's own field order.
// ---------------------------------------------------------------------------

test("p1b-4: multiple failures are named in wire read order", () => {
  expect(
    fieldsAfter((entry) => {
      entry.current_price = "";
      delete (entry as { price_decimals?: number }).price_decimals;
      entry.price_floor = "0x10";
    }),
  ).toEqual(["current_price", "price_decimals", "price_floor"]);
});
