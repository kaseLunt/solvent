// THE FactorPrice ENTRY CLASSIFIER (p1b-4, closes Codex r3 finding 2).
//
// Post-p0-9 the Inspector's boundary defenses covered the ARRAY (a non-array
// `prices` folds into the not-established arm) and the boundary's null-ness —
// but every read OF an entry was trusted: `prices: [null]` threw a TypeError
// at `first.lowest_healthy_price` before the card could render; a malformed
// `lowest_healthy_price` / `current_price` threw parseDecimal inside
// `money()`; a mis-shaped `price_decimals` threw assertScale; and an ABSENT
// `price_decimals` was the worst class of all — `money()`'s no-scale branch
// rendered the RAW scaled integer as a plausible price (silent wrong display,
// no throw for any boundary to catch).
//
// `classifyFactorPrice` is the ONE law consulted BEFORE any entry property is
// read — by the boundary derivation (`boundaryOf`, inspector-position.ts) AND by the
// evidence drawer's per-entry map (evidence.ts). `price_decimals` is REQUIRED
// here precisely because a missing scale would NOT throw downstream: the
// no-throw path is the raw-render path, and a classifier that admitted it
// would launder a scaled integer into a price. Absent = malformed, never the
// raw-render branch.
//
// SIBLING of `engineClassification.ts` (p1b-2) and `setRunClassification.ts`
// (p1b-3), not a widening: FactorPrice is its own wire shape under its own
// schema (api/openapi.yaml FactorPrice), and one walker judging several
// shapes would judge one of them against the wrong contract. The conventions
// are shared — wireGuard primitives, checks in wire read order, nullability
// mirrored from the generated schema EXACTLY
// (`packages/client-ts/src/generated/schema.ts`, FactorPrice): `price_floor`
// and `lowest_healthy_price` are NullableDecimal — null is the wire's own
// statement (no floor / no boundary), never malformed.
//
// THE GUARD NEVER THROWS. Address bodies are JSON-cast without runtime
// validation, so an entry may be null or mis-shaped entirely (the p0-9
// family: cmd/api marshals Go nil pointers as JSON null); a guard that threw
// on the entries it exists to refuse would reopen the route-boundary hole it
// closes. A non-object entry is named whole, as `entry`.

import type { components } from "@solvent/client";
import { isWireDecimal, isWireScale, malformedFields, type FieldCheck } from "./wireGuard";

/** The generated wire shape this guard admits — re-exported for its callers. */
export type FactorPrice = components["schemas"]["FactorPrice"];

/**
 * The classification: `{ ok: true }` hands back the SAME object it judged
 * (no clone, no reshape — downstream reads see exactly the wire's bytes);
 * `{ ok: false }` names the failed checks in wire read order.
 */
export type FactorPriceClassification =
  | { ok: true; entry: FactorPrice }
  | { ok: false; fields: string[] };

/** A runtime object gate: the JSON cast guarantees nothing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The schema's NullableDecimal: null is the wire's own statement, non-null must satisfy the contract. */
function isNullableWireDecimal(value: unknown): boolean {
  return value === null || isWireDecimal(value);
}

/**
 * CLASSIFY ONE FactorPrice ENTRY, in wire read order, before ANY property of
 * it is read. `isWireScale(undefined)` is false, so an absent
 * `price_decimals` is malformed by construction — the silent-raw-render
 * class cannot pass this gate.
 */
export function classifyFactorPrice(entry: unknown): FactorPriceClassification {
  if (!isRecord(entry)) return { ok: false, fields: ["entry"] };
  const checks: FieldCheck[] = [
    ["asset", typeof entry.asset === "string"],
    ["current_price", isWireDecimal(entry.current_price)],
    ["price_decimals", isWireScale(entry.price_decimals)],
    ["price_floor", isNullableWireDecimal(entry.price_floor)],
    ["lowest_healthy_price", isNullableWireDecimal(entry.lowest_healthy_price)],
  ];
  const fields = malformedFields(checks);
  return fields.length === 0 ? { ok: true, entry: entry as FactorPrice } : { ok: false, fields };
}
