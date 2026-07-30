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
// whose tag has three cases and no boolean anywhere. A consumer that switches on
// `outcome` cannot fall into the "no position" branch by accident, and one that
// adds a `default: assertNever` gets a compile error if the vocabulary ever
// grows again.
//
// The raw `found` field stays on the response, because it is the contract. This
// is the recommended way to read it.

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
 * A lookup, discriminated on `outcome`.
 *
 * `response` is always the whole body, so nothing is hidden behind this wrapper.
 */
export type Lookup<T extends LookupBearing> =
  | {
      outcome: "found";
      /**
       * Whether every engine could be consulted. When false, the positions on
       * the response are a FLOOR: more may exist behind a withheld engine.
       */
      complete: boolean;
      withheldEngines: EngineRefusal[];
      note: string;
      response: T;
    }
  | {
      outcome: "not-found";
      /** Necessarily true: a definitive negative requires a complete lookup. */
      complete: true;
      withheldEngines: EngineRefusal[];
      note: string;
      response: T;
    }
  | {
      outcome: "unknowable";
      /** Necessarily false: that is what makes the answer unestablishable. */
      complete: false;
      /** The engines that could not be consulted. Never empty in this case. */
      withheldEngines: EngineRefusal[];
      note: string;
      response: T;
    };

export type AddressLookup = Lookup<AddressResponse>;
export type StressLookup = Lookup<StressResponse>;

/**
 * Read a three-valued lookup as a discriminated union.
 *
 * ```ts
 * const result = lookup(await client.address(addr));
 * switch (result.outcome) {
 *   case "found":       render(result.response.positions, { floor: !result.complete }); break;
 *   case "not-found":   renderNoPosition(); break;
 *   case "unknowable":  renderCannotAnswer(result.withheldEngines); break;
 * }
 * ```
 *
 * It also ENFORCES the contract's own invariants and throws
 * `ContractInvariantError` when a body contradicts itself — a `found: false`
 * carrying an incomplete lookup is precisely the definitive negative the service
 * is not entitled to publish, and a client that accepted it would undo the fix
 * this surface exists to be.
 */
export function lookup<T extends LookupBearing>(response: T): Lookup<T> {
  const { found, lookup_complete: complete, withheld_engines: withheld } = response;
  const note = response.lookup_complete_note;

  if (found === true) {
    return { outcome: "found", complete, withheldEngines: withheld, note, response };
  }

  if (found === false) {
    // A definitive negative requires that every engine was available to be
    // asked. Anything else is a negative the service cannot establish.
    if (!complete || withheld.length > 0) {
      throw new ContractInvariantError(
        "found=false requires a complete lookup",
        `the response claims a DEFINITIVE negative (found: false) while reporting ` +
          `lookup_complete: ${String(complete)} and ${withheld.length} withheld engine(s) ` +
          `(${withheld.map((e) => e.engine).join(", ") || "none"}). ` +
          `A negative derived from a row count over an incomplete lookup is exactly ` +
          `the false certainty this surface refuses to publish`,
      );
    }
    return { outcome: "not-found", complete: true, withheldEngines: withheld, note, response };
  }

  // found === null.
  if (complete || withheld.length === 0) {
    throw new ContractInvariantError(
      "found=null requires an incomplete lookup",
      `the response reports found: null — the answer cannot be established — while ` +
        `claiming lookup_complete: ${String(complete)} with ${withheld.length} withheld ` +
        `engine(s). Null must name what prevented the answer`,
    );
  }
  return { outcome: "unknowable", complete: false, withheldEngines: withheld, note, response };
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
