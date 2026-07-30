// Three-valued `found`, made safe to consume.
//
// # The problem this module exists to solve
//
// `/v1/address/{addr}` and `/v1/address/{addr}/stress` publish `found` as
// THREE-VALUED:
//
//   true   at least one position was found — a positive existence claim, safe to
//          assert whatever else is withheld. But `lookup_complete` may still be
//          false, in which case it is a FLOOR, not a total.
//   false  a DEFINITIVE negative: no position exists in this batch, and every
//          engine was available to be asked.
//   null   the answer CANNOT BE ESTABLISHED — a relevant engine's whole book is
//          withheld. It must NEVER render as "no position".
//
// # Why the nullable type alone protects nobody
//
// The obvious consumer code is `if (!found) renderNoPosition()`. Under
// `boolean | null` that branch is taken for BOTH `false` and `null`, and
// TypeScript raises nothing — `!null` is perfectly legal. The breaking type
// change makes the third state visible in tooling and says nothing at all about
// the one line of code that gets it wrong.
//
// So the fix is an AFFIRMATIVE api: `lookup()` returns a discriminated union
// whose tags are safe to branch on. `outcome` has three cases and no boolean
// anywhere; `found` is carried as each arm's LITERAL (`true`, `false`, `null`),
// so comparing it with `===` narrows the whole result. A consumer that switches
// on `outcome` cannot fall into the "no position" branch by accident, and one
// that adds a `default: assertNever` gets a compile error if the vocabulary
// ever grows again.
//
// The union is SEALED: the wide `boolean | null` field is not reachable from
// any arm — `response` carries everything else the wire said, with `found`
// removed at the type level AND at runtime. The unrefined wire body stays
// available where its name declares the hazard: `SolventClient.addressRaw()` /
// `addressStressRaw()`, or whatever body the caller handed to `lookup()`.

import { ContractInvariantError } from "./errors.js";
import type { AddressResponse, EngineRefusal, StressResponse } from "./types.js";

/** The three states, named. `unknowable` is never "no position". */
export type LookupOutcome = "found" | "not-found" | "unknowable";

/** The lookup-completeness fields both endpoints carry. */
export interface LookupBearing {
  found: boolean | null;
  lookup_complete: boolean;
  withheld_engines: EngineRefusal[];
  lookup_complete_note: string;
}

/**
 * A lookup, discriminated on `outcome` (and equally on the literal `found`).
 *
 * `response` is the whole body MINUS the three-valued `found` field: everything
 * a consumer renders is there, and the one field that conflates "no position"
 * with "cannot answer" under a `!` is not. Branch on `outcome`, or on
 * `found === false` — never on falsiness.
 */
export type Lookup<T extends LookupBearing> =
  | {
      outcome: "found";
      /** The literal `true`: a positive existence claim. */
      found: true;
      /**
       * Whether every engine could be consulted. When false, the positions on
       * the response are a FLOOR: more may exist behind a withheld engine.
       */
      complete: boolean;
      withheldEngines: EngineRefusal[];
      note: string;
      /** The wire body with the three-valued `found` sealed off. */
      response: Omit<T, "found">;
    }
  | {
      outcome: "not-found";
      /** The literal `false`: the only state in which "no position" is true. */
      found: false;
      /** Necessarily true: a definitive negative requires a complete lookup. */
      complete: true;
      /** Necessarily empty: a complete lookup withheld nothing. */
      withheldEngines: EngineRefusal[];
      note: string;
      /** The wire body with the three-valued `found` sealed off. */
      response: Omit<T, "found">;
    }
  | {
      outcome: "unknowable";
      /** The literal `null`: the answer cannot be established. NEVER "no position". */
      found: null;
      /** Necessarily false: that is what makes the answer unestablishable. */
      complete: false;
      /** The engines that could not be consulted. Never empty in this case. */
      withheldEngines: EngineRefusal[];
      note: string;
      /** The wire body with the three-valued `found` sealed off. */
      response: Omit<T, "found">;
    };

export type AddressLookup = Lookup<AddressResponse>;
export type StressLookup = Lookup<StressResponse>;

/**
 * Read a three-valued lookup as a discriminated union.
 *
 * ```ts
 * const result = await client.address(addr); // the client calls lookup() for you
 * switch (result.outcome) {
 *   case "found":       render(result.response.positions, { floor: !result.complete }); break;
 *   case "not-found":   renderNoPosition(); break;
 *   case "unknowable":  renderCannotAnswer(result.withheldEngines); break;
 * }
 * ```
 *
 * It also ENFORCES the contract's own invariants and throws
 * `ContractInvariantError` when a body contradicts itself. The completeness
 * law runs FIRST, before `found` is even read, so it holds on every outcome:
 * `lookup_complete` ("every engine could be consulted") and `withheld_engines`
 * ("the engines this lookup could not consult") are one fact stated twice, and
 * a body where they disagree is refused. A contradictory POSITIVE — `found:
 * true`, `lookup_complete: true`, an engine withheld — would otherwise render
 * as a TOTAL where the service only established a floor, and a `found: false`
 * carrying an incomplete lookup is precisely the definitive negative the
 * service is not entitled to publish.
 */
export function lookup<T extends LookupBearing>(response: T): Lookup<T> {
  const { found, ...sealed } = response;
  const complete = response.lookup_complete;
  const withheld = response.withheld_engines;
  const note = response.lookup_complete_note;

  // The completeness <-> withheld-engines consistency law, for EVERY outcome.
  if (complete && withheld.length > 0) {
    throw new ContractInvariantError(
      "lookup_complete=true forbids withheld engines",
      `the response claims lookup_complete: true — every engine consulted — while naming ` +
        `${withheld.length} withheld engine(s) (${withheld.map((e) => e.engine).join(", ")}). ` +
        `A consumer would render these positions as a total when the withheld list says ` +
        `they are at best a floor; this surface refuses the contradiction instead`,
    );
  }
  if (!complete && withheld.length === 0) {
    throw new ContractInvariantError(
      "lookup_complete=false requires a named withheld engine",
      `the response claims lookup_complete: false while withheld_engines is empty. The ` +
        `contract defines withheld_engines as the engines this lookup could not consult, ` +
        `so an incomplete lookup must name what prevented the answer`,
    );
  }

  if (found === true) {
    return { outcome: "found", found: true, complete, withheldEngines: withheld, note, response: sealed };
  }

  if (found === false) {
    // A definitive negative requires that every engine was available to be
    // asked. Anything else is a negative the service cannot establish. (The
    // consistency law above already guarantees `complete` implies nothing
    // withheld.)
    if (!complete) {
      throw new ContractInvariantError(
        "found=false requires a complete lookup",
        `the response claims a DEFINITIVE negative (found: false) while reporting ` +
          `lookup_complete: ${String(complete)} and ${withheld.length} withheld engine(s) ` +
          `(${withheld.map((e) => e.engine).join(", ") || "none"}). ` +
          `A negative derived from a row count over an incomplete lookup is exactly ` +
          `the false certainty this surface refuses to publish`,
      );
    }
    return { outcome: "not-found", found: false, complete: true, withheldEngines: withheld, note, response: sealed };
  }

  // found === null.
  if (complete) {
    throw new ContractInvariantError(
      "found=null requires an incomplete lookup",
      `the response reports found: null — the answer cannot be established — while ` +
        `claiming lookup_complete: ${String(complete)} with ${withheld.length} withheld ` +
        `engine(s). Null must name what prevented the answer`,
    );
  }
  return { outcome: "unknowable", found: null, complete: false, withheldEngines: withheld, note, response: sealed };
}

/**
 * Whether this lookup is a DEFINITIVE negative — the only state in which "no
 * position" is a true thing to render.
 *
 * Deliberately not the negation of anything: `!found` is the bug.
 */
export function isDefinitiveNegative(response: LookupBearing): boolean {
  return lookup(response).outcome === "not-found";
}
