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

describe("`found: null` round-trips through the RAW accessors as null", () => {
  // `addressRaw()` / `addressStressRaw()` are the wire-truth surface: the raw
  // three-valued `found`, no lookup enforcement. The PRIMARY `address()` path
  // returns the discriminated lookup — proven in the round-1 H1 suite below.
  it("survives JSON.parse and the typed response, on /v1/address", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const body = await clientFor(path, FIXTURE_FILES.addressUnknowable).addressRaw(PINNED.accounts.aave);
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
    const body = await clientFor(path, FIXTURE_FILES.stressUnknowable).addressStressRaw(PINNED.accounts.aave);
    expect(body.found).toBeNull();
    expect(body.lookup_complete).toBe(false);
    expect(body.withheld_engines).toHaveLength(1);
    // A withheld engine has no positions to stress — which is exactly why the
    // answer is unestablishable rather than negative.
    expect(body.scenarios).toEqual([]);
  });

  it("keeps `false` a DEFINITIVE negative, distinct from null", async () => {
    const path = `/v1/address/${PINNED.accounts.unknown}`;
    const body = await clientFor(path, FIXTURE_FILES.addressNotFound).addressRaw(PINNED.accounts.unknown);
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
    // The withheld engine is named so the completeness pairing itself is
    // consistent and the found=false law is what fires (an incomplete lookup
    // naming NO engine is refused earlier, by the round-1 H2 consistency law).
    const incompleteNegative = bearing({
      found: false,
      lookup_complete: false,
      withheld_engines: [{ engine: PINNED.engines.aave, code: "X", detail: "d", note: "n" }],
    });
    expect(() => lookup(incompleteNegative)).toThrow(ContractInvariantError);
    try {
      lookup(incompleteNegative);
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
// Round-1 review fixes.
//
// H1: the union is SEALED — the three-valued field is off the discriminated
//     response, and the primary address methods return the lookup rather than
//     the raw wire body. (Round 1 also gave each arm `found` as its literal;
//     round 2 removed the field from every arm — any top-level `found`
//     presents `boolean | null` on an unnarrowed result — so `outcome` is now
//     the sole discriminant. See the round-2 H1 suite at the end of this
//     file.)
// H2: the lookup_complete <-> withheld_engines consistency check runs BEFORE
//     the found branch, on all three outcomes.
// ---------------------------------------------------------------------------

describe("the union is SEALED (round-1 H1)", () => {
  it("narrowing on `outcome === \"not-found\"` reaches the definitive-negative arm alone", () => {
    const result = lookup(fixtures.addressNotFound);
    if (result.outcome === "not-found") {
      // Compile-level proof: `complete` narrows to the literal `true`.
      const complete: true = result.complete;
      expect(complete).toBe(true);
    } else {
      throw new Error("the definitive-negative fixture must narrow to outcome === 'not-found'");
    }
  });

  it("seals the three-valued field OFF the discriminated response", () => {
    const result = lookup(fixtures.addressAave);
    expect(Object.hasOwn(result.response, "found")).toBe(false);
    // @ts-expect-error — `found` does not exist on the sealed response: the
    // wide `boolean | null` is unreachable from a Lookup without a type
    // assertion. Branch on `outcome`, or go through an accessor whose name
    // declares the hazard (`addressRaw`).
    expect(result.response.found).toBeUndefined();
    // The data a consumer renders is still all there.
    expect(result.response.positions).toHaveLength(1);
    expect(result.response.batch.position_count).toBe(PINNED.batch.positionCount);
  });
});

describe("the PRIMARY address paths return the discriminated lookup (round-1 H1)", () => {
  it("address() returns the lookup, not the raw wire body", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const result = await clientFor(path, FIXTURE_FILES.addressUnknowable).address(PINNED.accounts.aave);
    expect(result.outcome).toBe("unknowable");
    expect(result.complete).toBe(false);
    expect(result.withheldEngines).toHaveLength(1);
    expect(Object.hasOwn(result.response, "found")).toBe(false);
  });

  it("addressStress() does the same", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}/stress`;
    const result = await clientFor(path, FIXTURE_FILES.stressUnknowable).addressStress(PINNED.accounts.aave);
    expect(result.outcome).toBe("unknowable");
    expect(result.response.scenarios).toEqual([]);
  });

  it("address() ENFORCES the invariants: a contradictory positive rejects", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const contradictory = JSON.stringify({
      ...fixtures.addressAave,
      found: true,
      lookup_complete: true,
      withheld_engines: [{ engine: PINNED.engines.aave, code: "X", detail: "d", note: "n" }],
    });
    const mock = mockFetch({ [path]: { body: contradictory } });
    const client = new SolventClient({ baseUrl: BASE, fetch: mock.fetch });
    await expect(client.address(PINNED.accounts.aave)).rejects.toBeInstanceOf(ContractInvariantError);
  });

  it("the raw wire body stays reachable ONLY through the accessor named raw", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const body = await clientFor(path, FIXTURE_FILES.addressUnknowable).addressRaw(PINNED.accounts.aave);
    // Three-valued, exactly as the wire carried it — no lookup enforcement.
    expect(body.found).toBeNull();
    expect(body.lookup_complete).toBe(false);
  });
});

describe("completeness is validated BEFORE the found branch, on every outcome (round-1 H2)", () => {
  const withheldOne = () => [
    { engine: PINNED.engines.aave, code: "FLAG_CUSTODY_UNPROVEN", detail: "d", note: "n" },
  ];
  const bearing = (over: Partial<LookupBearing>): LookupBearing => ({
    found: true,
    lookup_complete: true,
    withheld_engines: [],
    lookup_complete_note: "n",
    ...over,
  });

  it("REFUSES the contradictory POSITIVE: a complete lookup naming withheld engines", () => {
    // The response a documented consumer would render as a TOTAL, while the
    // withheld list says it is at best a floor.
    expect(() =>
      lookup(bearing({ found: true, lookup_complete: true, withheld_engines: withheldOne() })),
    ).toThrow(ContractInvariantError);
    try {
      lookup(bearing({ found: true, lookup_complete: true, withheld_engines: withheldOne() }));
    } catch (error) {
      const e = error as ContractInvariantError;
      expect(e.invariant).toBe("lookup_complete=true forbids withheld engines");
      expect(e.message).toContain("floor");
    }
  });

  it("REFUSES an incomplete lookup that names no withheld engine, whatever `found` says", () => {
    // The contract defines `withheld_engines` as the engines "which this lookup
    // therefore could not consult" — an incomplete lookup that names none has
    // an unattributed incompleteness on every outcome, not just on null.
    for (const found of [true, false, null]) {
      expect(() =>
        lookup(bearing({ found, lookup_complete: false, withheld_engines: [] })),
      ).toThrow(/must name what prevented the answer/);
    }
  });

  it("still accepts the honest FLOOR: found=true, incomplete, engines named", () => {
    const result = lookup(bearing({ found: true, lookup_complete: false, withheld_engines: withheldOne() }));
    expect(result.outcome).toBe("found");
    expect(result.complete).toBe(false);
    expect(result.withheldEngines).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// Round-2 review fix (H1): `outcome` is the ONLY discriminant.
//
// Wave 1 sealed `response` but left each arm a top-level literal `found`.
// Round 2 correctly observed that ANY top-level `found`, literal or not,
// presents `boolean | null` on an UNNARROWED result — so
// `if (!result.found) renderNoPosition()` still compiled and mapped
// `unknowable` to a definitive negative through the primary methods
// themselves. Removing the field completes wave 1's own logic rather than
// reversing it: a non-empty string literal cannot be falsiness-conflated
// (`!result.outcome` is dead code), and narrowing it requires `===`.
//
// The @ts-expect-error directives below are PERMANENT enforcement, the same
// pattern as the response-seal test above: if `found` ever returns to any arm,
// the directive goes unused and `npm run typecheck` fails.
// ---------------------------------------------------------------------------

describe("`outcome` is the SOLE discriminant — no arm carries `found` (round-2 H1)", () => {
  it("PERMANENT: `result.found` does not exist on an unnarrowed lookup", () => {
    const result = lookup(fixtures.addressUnknowable);
    // @ts-expect-error — no top-level `found` on the Lookup union: the field
    // whose falsiness conflated "cannot answer" with "no position" is not on
    // the public surface at all. Branch on `outcome`.
    const trapped = result.found;
    expect(trapped).toBeUndefined();
    expect(result.outcome).toBe("unknowable");
  });

  it("PERMANENT: the reviewer's exact line — `if (!result.found)` — no longer compiles", () => {
    const result = lookup(fixtures.addressUnknowable);
    let rendered = "";
    // @ts-expect-error — the falsiness trap is closed at the type level. This
    // is the exact consumer line round 2 flagged; were the type not refusing
    // it, the runtime WOULD take the false-negative branch (asserted below),
    // which is precisely why the field cannot exist.
    if (!result.found) rendered = "no position";
    expect(rendered).toBe("no position"); // the branch a compiling `!found` takes
    expect(result.outcome).toBe("unknowable"); // on an answer that is NOT "no position"
  });

  it("PERMANENT: `found` is absent from every NARROWED arm too", () => {
    // Restoring the literal on ANY single arm re-opens the unnarrowed
    // `boolean | null` presentation, so each arm is pinned separately.
    const positive = lookup(fixtures.addressAave);
    if (positive.outcome !== "found") throw new Error("fixture must discriminate to found");
    // @ts-expect-error — no `found` on the "found" arm.
    expect(positive.found).toBeUndefined();

    const negative = lookup(fixtures.addressNotFound);
    if (negative.outcome !== "not-found") throw new Error("fixture must discriminate to not-found");
    // @ts-expect-error — no `found` on the "not-found" arm.
    expect(negative.found).toBeUndefined();

    const unknowable = lookup(fixtures.addressUnknowable);
    if (unknowable.outcome !== "unknowable") throw new Error("fixture must discriminate to unknowable");
    // @ts-expect-error — no `found` on the "unknowable" arm.
    expect(unknowable.found).toBeUndefined();
  });

  it("no arm carries `found` at RUNTIME either", () => {
    for (const result of [
      lookup(fixtures.addressAave),
      lookup(fixtures.addressNotFound),
      lookup(fixtures.addressUnknowable),
      lookup(fixtures.addressPartial),
      lookup(fixtures.stressAave),
      lookup(fixtures.stressUnknowable),
    ]) {
      expect(Object.hasOwn(result, "found")).toBe(false);
    }
  });

  it("PERMANENT: the direct primary-method path is closed — client.address()", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const result = await clientFor(path, FIXTURE_FILES.addressUnknowable).address(PINNED.accounts.aave);
    // @ts-expect-error — an unnarrowed result from the PRIMARY method exposes
    // no `found`: this is the direct path round 2 showed the response-seal
    // alone could not close.
    expect(result.found).toBeUndefined();
    expect(Object.hasOwn(result, "found")).toBe(false);
    expect(result.outcome).toBe("unknowable");
  });

  it("PERMANENT: and client.addressStress()", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}/stress`;
    const result = await clientFor(path, FIXTURE_FILES.stressUnknowable).addressStress(PINNED.accounts.aave);
    // @ts-expect-error — same law on the stress lookup.
    expect(result.found).toBeUndefined();
    expect(Object.hasOwn(result, "found")).toBe(false);
    expect(result.outcome).toBe("unknowable");
  });

  it("the wire-level `found` stays where its name declares the hazard: the RAW surface", async () => {
    const path = `/v1/address/${PINNED.accounts.aave}`;
    const body = await clientFor(path, FIXTURE_FILES.addressUnknowable).addressRaw(PINNED.accounts.aave);
    // Unchanged by this fix: the raw accessors carry the contract's
    // three-valued field, and `response` remains Omit'd/sealed (wave 1).
    expect(body.found).toBeNull();
    expect(Object.hasOwn(body, "found")).toBe(true);
  });
});
