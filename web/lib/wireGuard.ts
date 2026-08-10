// THE SHARED WIRE GUARD (p1b-1) — Track B's validation primitives, one law
// for every classifier and refusal arm on the web surface.
//
// Extracted from `app/lab/matrixCells.ts`, where p0-8 first pinned them as
// module-private helpers. Track B's classifiers (engine, set-run, factor
// price) all judge the same wire contract, so the primitives live here once.
//
// THE DEFECT CLASS THIS MODULE KILLS: `BigInt("")` and `BigInt(" ")` silently
// coerce to `0n`, and `BigInt("0x10")` to `16n` — all outside the wire
// contract. A bare `BigInt(wireString)` site can therefore launder a
// malformed or version-skewed field into a measured zero (or a plausible
// wrong number), which is the p0-8 finding reachable again through every
// unguarded call. `wireBigInt` is the only sanctioned string→bigint path:
// null unless the contract matches, never a throw, never a coercion.

/**
 * The wire Decimal contract, verbatim (api/openapi.yaml `Decimal` /
 * `NullableDecimal` pattern): an exact signed integer as a decimal string —
 * `^-?[0-9]+$`. NEVER a JSON number, never empty, never a fraction or
 * exponent, never whitespace, never a radix prefix.
 */
export const WIRE_DECIMAL = /^-?[0-9]+$/;

/** Runtime check: a JSON-cast gives no guarantee this is even a string. */
export function isWireDecimal(value: unknown): value is string {
  return typeof value === "string" && WIRE_DECIMAL.test(value);
}

/** Zero under the wire contract: every digit zero. Call ONLY on validated values. */
export function isZeroDecimal(value: string): boolean {
  return /^-?0+$/.test(value);
}

/**
 * A decimals scale the renderer may exponentiate: an integer in [0, 1000] —
 * mirrors `assertScale`'s bounds in `@solvent/client`'s decimal.ts, so what
 * this guard admits is exactly what the renderer will not throw on.
 */
export function isWireScale(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000;
}

/** A wire count: an integer, full stop. Sign is the field's business. */
export function isWireCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * The ONLY sanctioned string→bigint path for wire values. Returns null unless
 * the value satisfies the wire Decimal contract; NEVER throws and NEVER
 * coerces — `wireBigInt("")` is null where `BigInt("")` is a silent `0n`.
 *
 * (The runtime check runs through `isWireDecimal`, so a non-string smuggled
 * past the type system is null too, not a regex-coerced read.)
 */
export function wireBigInt(value: string): bigint | null {
  return isWireDecimal(value) ? BigInt(value) : null;
}

/** One named check: `[field, ok]`. Compose these in READ ORDER at each site. */
export type FieldCheck = readonly [field: string, ok: boolean];

/** The names of the failed checks — what a refusal arm reports, in order. */
export function malformedFields(checks: readonly FieldCheck[]): string[] {
  return checks.filter(([, ok]) => !ok).map(([field]) => field);
}
