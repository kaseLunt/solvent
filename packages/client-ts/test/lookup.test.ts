// THREE-VALUED `found` — asserted as CONTRACT LAW, not as fixture shape.
//
// Everything else the round-2 contract change added (`lookup_complete`,
// `withheld_engines`, `lookup_complete_note`, `coverage.withheld_engines`) is
// SHAPE-ONLY until server expectations pin it. The `found` SEMANTICS are not:
// `null` means the answer cannot be established, and rendering it as "no
// position" is a false negative on a liquidation surface. That rule is tested
// here, from both ends — the wire round-trip and the client's ergonomics.

import { describe, expect, it } from "vitest";

import {
  ContractInvariantError,
  SolventClient,
  isDefinitiveNegative,
  lookup,
} from "../src/index.js";
import type { AddressLookup, LookupBearing, LookupOutcome } from "../src/index.js";
import { FIXTURE_FILES, fixtureBytes, PINNED } from "./fixtures/index.js";
import * as fixtures from "./fixtures/index.js";
import { mockFetch } from "./helpers/mock-fetch.js";

const BASE = "http://localhost:8080";

function clientFor(path: string, file: string) {
  const mock = mockFetch({ [path]: { body: fixtureBytes(file) } });
  return new SolventClient({ baseUrl: BASE, fetch: mock.fetch });
}

// ---------------------------------------------------------------------------
// The wire round-trip: null survives, as null.
// ---------------------------------------------------------------------------

describe("`found: null` round-trips through the client as null", () => {
  it("survives JSON.parse and the typed response, on /v1/address", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const body = await clientFor(path, FIXTURE_FILES.addressUnknowable).address(PINNED.accounts.aave);
    // Not undefined, not false, not coerced. Null.
    expect(body.found).toBeNull();
    expect(body.found).not.toBe(false);
    expect(Object.hasOwn(body, "found")).toBe(true);
    expect(body.lookup_complete).toBe(false);
    expect(body.withheld_engines).toHaveLength(1);
    expect(body.withheld_engines[0]?.engine).toBe(PINNED.engines.aave);
    expect(body.lookup_complete_note).toContain("never that no position exists");
    // The raw bytes say null too — nothing in the client rewrote it.
    expect(fixtureBytes(FIXTURE_FILES.addressUnknowable)).toContain('"found": null');
  });

  it("survives on /v1/address/{addr}/stress with the same contract", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}/stress`;
    const body = await clientFor(path, FIXTURE_FILES.stressUnknowable).addressStress(PINNED.accounts.aave);
    expect(body.found).toBeNull();
    expect(body.lookup_complete).toBe(false);
    expect(body.withheld_engines).toHaveLength(1);
    // A withheld engine has no positions to stress — which is exactly why the
    // answer is unestablishable rather than negative.
    expect(body.scenarios).toEqual([]);
  });

  it("keeps `false` a DEFINITIVE negative, distinct from null", async () => {
    const path = `/v1/address/${PINNED.accounts.unknown}`;
    const body = await clientFor(path, FIXTURE_FILES.addressNotFound).address(PINNED.accounts.unknown);
    expect(body.found).toBe(false);
    expect(body.found).not.toBeNull();
    // A definitive negative requires that every engine was available to be asked.
    expect(body.lookup_complete).toBe(true);
    expect(body.withheld_engines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The trap, demonstrated.
// ---------------------------------------------------------------------------

describe("why the nullable type alone protects nobody", () => {
  it("`!found` treats CANNOT-ANSWER as NO-POSITION, and the compiler allows it", () => {
    const unknowable = fixtures.addressUnknowable;
    const negative = fixtures.addressNotFound;

    // This is the line a consumer writes. It type-checks. It is wrong.
    expect(!unknowable.found).toBe(true);
    expect(!negative.found).toBe(true);
    expect(!unknowable.found).toBe(!negative.found);

    // So does every other boolean-shaped read.
    expect(unknowable.found === false).toBe(false); // this one is right...
    expect(Boolean(unknowable.found)).toBe(false); //  ...and this one is not.

    // The discriminant is what separates them.
    expect(lookup(unknowable).outcome).toBe("unknowable");
    expect(lookup(negative).outcome).toBe("not-found");
    expect(lookup(unknowable).outcome).not.toBe(lookup(negative).outcome);
  });

  it("isDefinitiveNegative is true for exactly ONE of the three states", () => {
    expect(isDefinitiveNegative(fixtures.addressNotFound)).toBe(true);
    expect(isDefinitiveNegative(fixtures.addressUnknowable)).toBe(false);
    expect(isDefinitiveNegative(fixtures.addressAave)).toBe(false);
    expect(isDefinitiveNegative(fixtures.stressUnknowable)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The discriminated union.
// ---------------------------------------------------------------------------

describe("lookup() discriminates all three states", () => {
  it("found -> the positive existence claim", () => {
    const result = lookup(fixtures.addressAave);
    expect(result.outcome).toBe("found");
    expect(result.complete).toBe(true);
    expect(result.withheldEngines).toEqual([]);
    expect(result.response.positions).toHaveLength(1);
  });

  it("not-found -> the definitive negative, complete by construction", () => {
    const result = lookup(fixtures.addressNotFound);
    expect(result.outcome).toBe("not-found");
    // Narrowed to the literal `true`: a definitive negative cannot be incomplete.
    if (result.outcome === "not-found") expect(result.complete).toBe(true);
  });

  it("unknowable -> names what prevented the answer", () => {
    const result = lookup(fixtures.addressUnknowable);
    expect(result.outcome).toBe("unknowable");
    if (result.outcome === "unknowable") {
      expect(result.complete).toBe(false);
      expect(result.withheldEngines).toHaveLength(1);
      expect(result.withheldEngines[0]?.code).toBe("FLAG_CUSTODY_UNPROVEN");
      expect(result.withheldEngines).not.toEqual([]);
    }
  });

  it("found under an INCOMPLETE lookup is a FLOOR, not a total", () => {
    // The Debt Manager answered; the Aave engine could not be consulted at all.
    const result = lookup(fixtures.addressPartial);
    expect(result.outcome).toBe("found");
    // The existence claim is safe...
    expect(result.response.positions).toHaveLength(1);
    // ...and the count is not. `complete` is what says so.
    expect(result.complete).toBe(false);
    expect(result.withheldEngines).toHaveLength(1);
  });

  it("works on a stress response through the same function", () => {
    expect(lookup(fixtures.stressUnknowable).outcome).toBe("unknowable");
    expect(lookup(fixtures.stressAave).outcome).toBe("found");
  });

  it("forces a consumer to handle all three — an exhaustive switch compiles", () => {
    const render = (result: AddressLookup): string => {
      switch (result.outcome) {
        case "found":
          return result.complete ? "positions" : "positions (at least)";
        case "not-found":
          return "no position";
        case "unknowable":
          return `cannot answer: ${result.withheldEngines.map((e) => e.engine).join(", ")} withheld`;
        default: {
          // If the vocabulary ever grows, this stops compiling.
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    };

    expect(render(lookup(fixtures.addressAave))).toBe("positions");
    expect(render(lookup(fixtures.addressPartial))).toBe("positions (at least)");
    expect(render(lookup(fixtures.addressNotFound))).toBe("no position");
    expect(render(lookup(fixtures.addressUnknowable))).toBe(
      `cannot answer: ${PINNED.engines.aave} withheld`,
    );
  });

  it("covers the whole vocabulary and nothing else", () => {
    const seen = new Set<LookupOutcome>([
      lookup(fixtures.addressAave).outcome,
      lookup(fixtures.addressNotFound).outcome,
      lookup(fixtures.addressUnknowable).outcome,
    ]);
    expect([...seen].sort()).toEqual(["found", "not-found", "unknowable"]);
  });
});

// ---------------------------------------------------------------------------
// The invariants. A self-contradicting body is refused rather than believed.
// ---------------------------------------------------------------------------

describe("lookup() refuses a body that contradicts itself", () => {
  const bearing = (over: Partial<LookupBearing>): LookupBearing => ({
    found: false,
    lookup_complete: true,
    withheld_engines: [],
    lookup_complete_note: "n",
    ...over,
  });

  it("REFUSES found=false over an incomplete lookup", () => {
    // This is the false certainty the round-2 fix exists to prevent: a negative
    // derived from a row count where the service could not consult every engine.
    expect(() => lookup(bearing({ found: false, lookup_complete: false }))).toThrow(ContractInvariantError);
    try {
      lookup(bearing({ found: false, lookup_complete: false }));
    } catch (error) {
      const e = error as ContractInvariantError;
      expect(e.invariant).toBe("found=false requires a complete lookup");
      expect(e.message).toContain("DEFINITIVE negative");
      expect(e.message).toContain("false certainty");
    }
  });

  it("REFUSES found=false alongside a named withheld engine", () => {
    expect(() =>
      lookup(
        bearing({
          found: false,
          lookup_complete: true,
          withheld_engines: [{ engine: PINNED.engines.aave, code: "X", detail: "d", note: "n" }],
        }),
      ),
    ).toThrow(ContractInvariantError);
  });

  it("REFUSES found=null that claims a complete lookup", () => {
    expect(() => lookup(bearing({ found: null, lookup_complete: true }))).toThrow(ContractInvariantError);
    try {
      lookup(bearing({ found: null, lookup_complete: true }));
    } catch (error) {
      expect((error as ContractInvariantError).invariant).toBe("found=null requires an incomplete lookup");
    }
  });

  it("REFUSES found=null that names nothing as the cause", () => {
    expect(() => lookup(bearing({ found: null, lookup_complete: false, withheld_engines: [] }))).toThrow(
      /must name what prevented the answer/,
    );
  });

  it("accepts every committed fixture — the invariants hold on real bodies", () => {
    for (const fixture of [
      fixtures.addressAave,
      fixtures.addressAaveRefused,
      fixtures.addressDM,
      fixtures.addressDMRefused,
      fixtures.addressNotFound,
      fixtures.addressUnknowable,
      fixtures.addressPartial,
      fixtures.stressAave,
      fixtures.stressDM,
      fixtures.stressUnknowable,
    ]) {
      expect(() => lookup(fixture)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// coverage.withheld_engines — the book-wide claim its name promises.
// ---------------------------------------------------------------------------

describe("coverage is now a BOOK-WIDE claim", () => {
  it("is full on a whole book, with nothing withheld", async () => {
    const book = await clientFor("/v1/book", FIXTURE_FILES.book).book();
    expect(book.coverage.withheld_engines).toEqual([]);
    expect(book.coverage.excluded).toEqual([]);
    expect(book.coverage.stress_coverage_is_full).toBe(true);
  });

  it("is FALSE when an engine is withheld, even though nothing failed to rebuild", async () => {
    const book = await clientFor("/v1/book", FIXTURE_FILES.bookEngineRefused).book();
    // Nothing failed the reconstruction...
    expect(book.coverage.excluded).toEqual([]);
    expect(book.coverage.excluded_by_this_layer).toBe(0);
    // ...and coverage is still not full, because an ENGINE is absent from every
    // scenario. Green coverage over an exclusion was the round-2 bug.
    expect(book.coverage.withheld_engines).toHaveLength(1);
    expect(book.coverage.withheld_engines[0]?.engine).toBe(PINNED.engines.aave);
    expect(book.coverage.stress_coverage_is_full).toBe(false);
  });
});
