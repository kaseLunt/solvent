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

/**
 * THE COUNT SPLIT (p1b-10, Codex round 2 finding 2). p1b-9's single
 * `isWireCount` was `Number.isInteger` alone — it admitted NEGATIVE
 * populations (a bucket count of -1; `movers_total: -1` rendered
 * "Showing all -1 accounts" as a computed-looking clause) and UNSAFE
 * integers (JSON.parse rounds 9007199254740992.5 to 2^53, and the exact
 * BigInt arithmetic downstream then renders a computed-looking WRONG
 * answer). The guard is now chosen by the field's SCHEMA SEMANTICS, and the
 * old name is gone so no call site can dodge the choice.
 *
 * THE ASSIGNMENT TABLE (every consumed count field, schema description read
 * before assigning — generated schema `packages/client-ts/src/generated/
 * schema.ts` is the authority):
 *
 * `isWirePopulation` — tallies of rows/accounts that exist, and lane
 * indices; nonnegative by meaning:
 *   - RunBookAggregate `accounts` / `eligible_accounts` (one engine's book
 *     reduced at one side);
 *   - RunBookHistogram `buckets[].count`, `infinite_count` ("accounts with
 *     NO DEBT on this side"), `refused_count` ("positions ... COUNTED here");
 *   - RunBookTransitions `lanes[].index` / `outflows[].from` / `cells[].to`
 *     ("this lane's position" — an index into the dense margins),
 *     `cells[].rows` ("a COUNT of position rows"), `from_rows[]` /
 *     `to_rows[]` ("each lane's whole BEFORE/AFTER population"),
 *     `total_rows` / `measured_rows` / `unmeasured_rows` /
 *     `unmeasured_refused_in_batch_rows` /
 *     `unmeasured_excluded_by_this_layer_rows` (the census totals), and the
 *     nullable `held_rows` / `lane_changed_rows` (diagonal/off-diagonal
 *     tallies of MEASURED rows — null is a statement, a negative is not);
 *   - RunBookEngine `movers_total` ("the FULL count of accounts that
 *     moved");
 *   - SetRunEngineSummary `accounts` ("measurable positions of this
 *     engine"), `movement_excluded_accounts` ("of those, accounts the
 *     movement rule could not TEST"), and the nullable
 *     `flipped_to_eligible` ("flips FALSE to TRUE, never a net") /
 *     `hf_dropped_accounts` ("health factors that STRICTLY DROPPED").
 *
 * `isWireSignedCount` — the schema's own nets/deltas, negative by design:
 *   - RunBookEngine `newly_eligible_accounts` ("a NET count that also
 *     subtracts any flip back to healthy" — movers_total's description; "a
 *     signed net" — lane_changed_rows's);
 *   - SetRunEngineSummary `eligible_accounts_delta` ("NET — after minus
 *     before, and it may be negative") WHEN a surface starts consuming it —
 *     today it is outside the consumed set by p1b-3's recorded scope
 *     decision.
 */

/** A wire POPULATION: a tally of things that exist. Nonnegative SAFE integer. */
export function isWirePopulation(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A wire SIGNED count: a net/delta the schema declares may be negative. Still a SAFE integer. */
export function isWireSignedCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
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
