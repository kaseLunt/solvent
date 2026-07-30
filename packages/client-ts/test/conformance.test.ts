// Test category (1), the compile-time half: TYPE-LEVEL CONFORMANCE.
//
// Every assertion in this file is checked by `tsc`, not at runtime. `npm run
// typecheck` is the gate; the runtime `it` blocks exist so the suite reports the
// checks it performed rather than leaving them invisible.
//
// The `@ts-expect-error` cases are the ANTI-VACUITY CONTROL. Each one is a
// mistake the contract forbids, and `tsc` FAILS THE BUILD if the error does not
// occur — so "the types compile" cannot be a statement about a type that accepts
// anything. Without these, `satisfies components["schemas"]["BookResponse"]`
// would be indistinguishable from `satisfies unknown`.

import { describe, expect, it } from "vitest";

import type {
  Aggregate,
  BookResponse,
  MetaResponse,
  Position,
  StreamPayload,
  components,
} from "../src/index.js";
import { SEIZURE_MODEL } from "../src/index.js";
import * as fixtures from "./fixtures/index.js";

// ---------------------------------------------------------------------------
// Positive: the generated types accept the recorded responses.
// ---------------------------------------------------------------------------

const book: BookResponse = fixtures.book;
const meta: MetaResponse = fixtures.meta;
const payload: StreamPayload = fixtures.streamSnapshot;
const position: Position = fixtures.addressAave.positions[0] as Position;

// The alias layer and the raw generated layer must be the same type, or the
// friendly names in `src/types.ts` are a second, drifting definition.
const viaGenerated: components["schemas"]["BookResponse"] = book;
const viaAlias: BookResponse = viaGenerated;

// ---------------------------------------------------------------------------
// Negative: each of these MUST be a type error.
// ---------------------------------------------------------------------------

// A money quantity as a JSON number.
const moneyAsNumber = {
  engine: "aave_v3_etherfi",
  value_decimals: 8,
  positions: 1,
  computed_positions: 1,
  refused_positions: 0,
  flagged_positions: 0,
  liquidatable_positions: 0,
  // @ts-expect-error — Decimal is a STRING in this contract; a number is the
  // exact failure the string convention exists to prevent.
  total_collateral: 800000000000,
  total_debt: "0",
  refusals: [],
  flags: [],
  unit_note: "n",
} satisfies Aggregate;

// An unknown field — `additionalProperties: false` on every object.
const unknownField = {
  ...fixtures.book,
  // @ts-expect-error — the contract admits no extra properties, so a client
  // generated from it must not accept one either.
  surprise: true,
} satisfies BookResponse;

// A missing required field.
// @ts-expect-error — `note` is required on Supersession.
const missingRequired: components["schemas"]["Supersession"] = { superseded: false, legs: [] };

// A value outside a closed enum.
const badEnum = {
  ...fixtures.meta.service,
  // @ts-expect-error — the seizure_model enum admits exactly one value.
  seizure_model: "first-come-first-served",
} satisfies components["schemas"]["Service"];

// Null where the contract forbids it.
const badNull = {
  ...fixtures.book,
  // @ts-expect-error — `engines` is a required, non-nullable array.
  engines: null,
} satisfies BookResponse;

// A nullable field read as always-present: the contract keeps ABSENT and ZERO
// distinguishable, and the type must force the caller to handle absence.
// @ts-expect-error — health_factor is `HealthFactor | null`.
const forcedHF: components["schemas"]["HealthFactor"] = position.health_factor;

// `found` is THREE-VALUED. Assigning it to a boolean is how "cannot answer"
// becomes "no position", so the type must refuse it. This is the compile-time
// half of the round-2 breaking change; `test/lookup.test.ts` carries the
// semantics.
// @ts-expect-error — found is `boolean | null`.
const foundAsBoolean: boolean = fixtures.addressUnknowable.found;

// ---------------------------------------------------------------------------
// Runtime echoes, so the suite reports what was checked.
// ---------------------------------------------------------------------------

describe("type-level conformance", () => {
  it("the generated types accept every recorded response", () => {
    expect(book.batch.status).toBe("complete");
    expect(meta.service.seizure_model).toBe(SEIZURE_MODEL);
    expect(payload.note).toContain("NEVER means `a new block`");
    expect(position.engine).toBe(fixtures.PINNED.engines.aave);
  });

  it("the alias layer and the generated layer are one type", () => {
    expect(viaAlias).toBe(viaGenerated);
  });

  it("seven contract violations are compile errors (see the @ts-expect-error markers)", () => {
    // tsc has already proven each of these is rejected. The runtime values are
    // referenced so `noUnusedLocals` keeps the checks in the file.
    expect([
      moneyAsNumber,
      unknownField,
      missingRequired,
      badEnum,
      badNull,
      forcedHF,
      foundAsBoolean,
    ]).toHaveLength(7);
  });
});
