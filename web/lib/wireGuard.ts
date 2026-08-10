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
 * this guard admits the renderer will not throw on. The -0 refusal landed
 * here first (p1b-12, Codex round 4), when `assertScale` still ADMITTED -0
 * (`Number.isInteger(-0)` is true and `-0 < 0` is false) and would render
 * base-unit strings at ZERO decimal places — a plausible, severely
 * mis-scaled price. Since p1b-13 (round 5, controller-sanctioned)
 * `assertScale` refuses -0 too, closing the unclassified surfaces that feed
 * it directly; the asymmetry is history and the two gates agree (the
 * NEGATIVE ZERO block below).
 */
export function isWireScale(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1000 &&
    !Object.is(value, -0)
  );
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
 *     `from_rows[]` / `to_rows[]` ("each lane's whole BEFORE/AFTER
 *     population"),
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
 *
 * `isWireOccupancy` (p1b-11, Codex round 3 finding B) — populations the
 * schema FLOORS AT 1 (`minimum: 1`):
 *   - RunBookTransitions `cells[].rows` ("a COUNT of position rows" an
 *     emitted cell holds AT LEAST ONE of — "An empty cell is ABSENT, never a
 *     row of zeros"). THE MINIMUM SWEEP (p1b-11, recorded): `rows` is the
 *     ONLY `minimum:`-carrying field in the contract's RESPONSE schemas
 *     (api/openapi.yaml `components:` holds exactly one `minimum:`, on
 *     RunBookTransitionCell.rows; every other `minimum: 1` in the file is a
 *     request parameter), so no other population-guarded field carries a
 *     floor a zero-admitting guard could miss.
 */

/**
 * NEGATIVE ZERO IS REFUSED (p1b-11, Codex round 3 finding A1). These guards
 * judge the PARSED binary64, never the JSON token, and
 * `JSON.parse("-1e-324")` rounds to NEGATIVE ZERO — which is `=== 0` and
 * passed `>= 0`, so a fractional token wore a legal population
 * (`movers_total: -1e-324` rendered moversDisclosure's "No account…"
 * sentence as a computed-looking claim). A conforming integer marshal never
 * emits a token that parses to -0 (Go's encoding/json prints an int64 zero
 * as `0`), so a post-parse -0 is the surviving fingerprint of an
 * out-of-contract token, and BOTH count guards refuse it through
 * `Object.is` — the only equality that sees the sign bit. `0` stays legal.
 *
 * p1b-12 (Codex round 4): the SAME class, one guard over — `isWireScale`
 * judged `Number.isInteger && >= 0 && <= 1000`, all true of -0, so
 * `JSON.parse("-1e-324")` on `usd_decimals` / `price_decimals` /
 * market-realization scales / collateral decimals wore a legal scale (and
 * downstream `assertScale` accepts -0 too: base-unit strings would render at
 * zero decimal places — plausible, severely mis-scaled prices). -0 coverage
 * now spans ALL wire integer guards in this module — scale, population,
 * occupancy (through population), signed count — and the p1b-12 audit
 * carried the same refusal to the local integer gates outside it
 * (`runbookSet.ts` `positiveInt`, `factor.ts` `toBig`).
 *
 * DOCUMENTED LIMITATION — THE POST-PARSE INFORMATION BOUNDARY (finding A2,
 * recorded, NOT closed, and not closable at this layer): fractional JSON
 * tokens that round to a SAFE integer during JSON.parse are
 * indistinguishable from integer tokens afterwards — `9007199254740991.1`
 * parses to exactly `9007199254740991`, and no predicate over the parsed
 * number can separate them. -0 is refusable only because its rounding
 * leaves a fingerprint (the sign bit); a token that rounds onto a plain
 * safe integer leaves none. Complete closure requires RAW-TEXT response
 * validation (a re-parse architecture) — a Phase-3+ architectural
 * candidate, or server-side contract testing. Ledgered in the p1b seal's
 * structural-limitations inventory
 * (.superpowers/sdd/progress-ui-overhaul.md).
 */

/** A wire POPULATION: a tally of things that exist. Nonnegative SAFE integer, never -0. */
export function isWirePopulation(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}

/**
 * A wire OCCUPANCY (p1b-11, finding B): a population the schema FLOORS AT 1.
 * `RunBookTransitionCell.rows` is `minimum: 1` — "A cell is emitted only
 * when it holds at least one row" — and a fake `{rows: 0}` cell passes every
 * margin and census reconciliation precisely because 0 changes no sum, so
 * this floor is the only gate that can refuse it.
 */
export function isWireOccupancy(value: unknown): value is number {
  return isWirePopulation(value) && value >= 1;
}

/** A wire SIGNED count: a net/delta the schema declares may be negative. Still a SAFE integer, never -0. */
export function isWireSignedCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0);
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

/**
 * THE THROWING READS (p1b-14, Codex round 6). Round 6 found the -0 class on
 * yet another unclassified surface (BookHistogram's bucket counts), and the
 * class audit found the same posture at every unclassified integer render:
 * `String(x)` / arithmetic over a wire integer that never met a guard. The
 * two readers below are the population/scale twins of `parseDecimal` /
 * `assertScale` — the established consumption posture on classifier-less
 * surfaces: anything the contract would not have produced THROWS rather than
 * becoming a silently different number, and the throw lands in the p1b-0
 * route boundary ("the honest arm on a surface with no classifier"). Surfaces
 * that DO hold a scoped refusal arm (the histogram panel, the live strips)
 * classify with the predicates directly instead.
 */
export class WireIntegerError extends Error {}

/** Names -0 explicitly — `String(-0)` is `"0"` and would hide the sign. */
function describeWireInt(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

/**
 * Read a wire POPULATION at a render/arithmetic site, or refuse. Returns the
 * value untouched when `isWirePopulation` admits it; throws `WireIntegerError`
 * naming the field otherwise. `0` stays legal.
 */
export function readWirePopulation(value: number, field: string): number {
  if (isWirePopulation(value)) return value;
  throw new WireIntegerError(
    `${field} is not a wire population (a nonnegative safe integer, never -0): ` +
      `got ${describeWireInt(value)} — out of contract, refused before render`,
  );
}

/**
 * Read a wire SCALE rendered as its own caption (e.g. "18-dec"), or refuse.
 * The formatting path already refuses through `assertScale` (p1b-13); this
 * covers the sites that print the scale as a bare integer without formatting
 * anything at it.
 */
export function readWireScale(value: number, field: string): number {
  if (isWireScale(value)) return value;
  throw new WireIntegerError(
    `${field} is not a wire scale (an integer in [0, 1000], never -0): ` +
      `got ${describeWireInt(value)} — out of contract, refused before render`,
  );
}

/** One named check: `[field, ok]`. Compose these in READ ORDER at each site. */
export type FieldCheck = readonly [field: string, ok: boolean];

/** The names of the failed checks — what a refusal arm reports, in order. */
export function malformedFields(checks: readonly FieldCheck[]): string[] {
  return checks.filter(([, ok]) => !ok).map(([field]) => field);
}
