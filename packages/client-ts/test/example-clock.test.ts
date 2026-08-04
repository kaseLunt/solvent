// THE CONTRACT'S EXAMPLES ANSWER TO THEIR OWN CLOCKS (Wave W-EX-B, hardened by
// Wave W-EX-C against Codex round 36 findings 2 and 3).
//
// # The defect class this closes
//
// Every 200 example in `api/openapi.yaml` that carries a batch envelope states
// two kinds of number side by side: INSTANTS a document may stamp however it
// reads best, and AGES that are arithmetic over those instants. Production
// measures all of them from ONE database instant — the one it serves at:
//
//	served_at                            = v.Now                        (cmd/api/p5_runbook.go:511)
//	batch.age_seconds                    = v.Now - batch.computed_at     (cmd/api/meta.go:125)
//	batch.watermarks[].sweep.age_seconds = v.Now - sweep.max_updated_at  (cmd/api/meta.go:174)
//
// So an example is free to choose its instants and is NOT free to choose its
// ages. Codex round 35 found the run-book example publishing a 1200-second
// sweep age over rows stamped 1205 seconds before its own `served_at`: an
// UNDERSTATED FRESHNESS, contradicted by the two timestamps printed beside it,
// in a document a reader has no way to check by hand. The same wrong pair sat
// in the `GET /v1/positions` example, and neither was reachable by any test.
//
// # Why this file rather than a capture test per endpoint
//
// The run-book example is held by `cmd/api/p5_runbook_example_db_test.go`,
// which seeds a book, runs the REAL handler and asserts the example IS the
// served body. That is the strongest possible law and it is also the most
// expensive one: it costs a database, a fixture substrate and a scenario per
// route. Extending it to all sixteen operations is a wave in its own right.
//
// This is the cheap complement, and it closes the CLASS document-wide today: it
// walks every example the contract declares, finds every place a stated age
// sits beside the stamps it is measured from, and re-derives it. It cannot
// prove an example is a body the server would serve — only a capture test does
// that — but no example can state an age its own bytes contradict, which is
// exactly the defect that was found twice.
//
// # ROUND 36, FINDING 2: the walk used to record only what it already liked
//
// The first version pushed a case only when `age_seconds` was ALREADY a number
// and the stamp beside it was ALREADY a string. Every other shape fell through
// the filter and contributed NOTHING — silently. A schema-valid sweep stamp
// carrying `max_updated_at: null` beside `age_seconds: 1205` (both fields are
// `nullable: true` on `SweepStamp`) is a freshness claim with no evidence
// behind it, and the walk skipped it while the only completeness guard —
// `ages.length > 0` — stayed green off the other seven pairs.
//
// So the walk no longer FILTERS. It CLASSIFIES: every example object owning
// `age_seconds` or any recognized stamp becomes a CANDIDATE first, and every
// candidate must then resolve into exactly one of four outcomes —
//
//	checked     an age and the stamp it is measured from, both present:
//	            the arithmetic runs
//	both-null   a nullable pair, both absent: no stamp, so no age. Honest.
//	stamp-only  a stamp whose schema pairs it with no age at all
//	            (`AddressHistoryPoint`, `BatchResponse`, `PriceStatePoint`):
//	            nothing is claimed, so there is nothing to re-derive
//	MIXED / UNRESOLVED   anything else — and those FAIL, naming the path.
//
// `MIXED` is the finding's own shape: one half of a nullable pair present and
// the other half not. `UNRESOLVED` is everything the walk does not understand —
// an age with no stamp beside it, an age of the wrong type, an age with no
// `served_at` in scope. Neither can be reached by accident, and neither is
// silent.
//
// And the resolution of every candidate is PINNED, per path, in `CENSUS` below.
// A candidate that stops being found — because a walk rule narrowed, because an
// example moved, because a root stopped being collected — is a diff in that
// object, not an invisible drop into a smaller `it.each`.
//
// # ROUND 36, FINDING 3: `Date.parse` cannot see what Go subtracts
//
// The first version derived ages through `Date.parse`, which truncates to
// MILLISECONDS. Go keeps nanoseconds. So a stamp of `09:40:00.000001Z` against
// a `served_at` of `10:00:05Z` is 1204.999999 seconds — production floors it to
// 1204 — while `Date.parse` sees 1205.000 and blesses a document stating 1205.
// The check would have certified an off-by-one it was written to catch.
//
// `epochNanos` therefore parses RFC3339 itself, into EXACT INTEGER NANOSECONDS
// (BigInt; the fractional part is string-parsed, never divided), and
// `ageSeconds` reproduces `cmd/api/meta.go:255-261` operation for operation:
// subtract, clamp at zero, integer-divide by one second. Nanoseconds rather
// than microseconds because nanoseconds is the unit of Go's own
// `time.Duration` — quantising to microseconds would itself be a truncation
// step production does not perform.

import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { CONTRACT_PATH } from "./fixtures/index.js";

const contract = parse(readFileSync(CONTRACT_PATH, "utf8")) as unknown;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// EXACT RFC3339 ARITHMETIC (finding 3)
// ---------------------------------------------------------------------------

const NANOS_PER_SECOND = 1_000_000_000n;
const NANOS_PER_MILLI = 1_000_000n;

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

/**
 * One RFC3339 instant as EXACT integer nanoseconds since the epoch.
 *
 * The fractional second is read as a STRING and padded to nine digits, so no
 * float ever touches it. The civil date goes through `Date` only for the
 * proleptic-Gregorian day count — an integer millisecond count — and is
 * round-tripped back out, because `Date` NORMALIZES impossible dates
 * (`2026-02-30` silently becomes `2026-03-02`) and an example is not allowed to
 * mean a day it did not write.
 */
const epochNanos = (stamp: string): bigint => {
  const m = RFC3339.exec(stamp);
  if (m === null) {
    throw new Error(`not an RFC3339 instant: ${JSON.stringify(stamp)}`);
  }
  const group = (i: number): string => {
    const v = m[i];
    if (v === undefined) {
      throw new Error(`RFC3339 group ${String(i)} missing in ${JSON.stringify(stamp)}`);
    }
    return v;
  };

  const year = Number(group(1));
  const month = Number(group(2));
  const day = Number(group(3));
  const hour = Number(group(4));
  const minute = Number(group(5));
  const second = Number(group(6));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`RFC3339 date out of range: ${JSON.stringify(stamp)}`);
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`RFC3339 time out of range: ${JSON.stringify(stamp)}`);
  }

  // `setUTCFullYear` rather than `Date.UTC`, which maps two-digit years into
  // the 1900s — a four-digit `0099` would otherwise silently become 1999.
  const civil = new Date(0);
  civil.setUTCFullYear(year, month - 1, day);
  civil.setUTCHours(hour, minute, second, 0);
  if (
    civil.getUTCFullYear() !== year ||
    civil.getUTCMonth() + 1 !== month ||
    civil.getUTCDate() !== day
  ) {
    throw new Error(`not a real calendar date: ${JSON.stringify(stamp)}`);
  }

  const fraction = m[7] ?? "";
  if (fraction.length > 9) {
    throw new Error(
      `${JSON.stringify(stamp)} carries ${String(fraction.length)} fractional digits — finer than the ` +
        `nanosecond resolution Go's time.Time holds, so this file cannot claim to reproduce what ` +
        `production would do with it`,
    );
  }
  const nanosOfSecond = BigInt(fraction.padEnd(9, "0"));

  let offsetNanos = 0n;
  const sign = m[8];
  if (sign !== undefined) {
    const offsetHour = BigInt(group(9));
    const offsetMinute = BigInt(group(10));
    if (offsetHour > 23n || offsetMinute > 59n) {
      throw new Error(`RFC3339 zone offset out of range: ${JSON.stringify(stamp)}`);
    }
    const magnitude = (offsetHour * 3600n + offsetMinute * 60n) * NANOS_PER_SECOND;
    offsetNanos = sign === "-" ? -magnitude : magnitude;
  }

  return BigInt(civil.getTime()) * NANOS_PER_MILLI + nanosOfSecond - offsetNanos;
};

/**
 * Production's `ageSeconds` (cmd/api/meta.go:255-261), operation for operation:
 * `now.Sub(stamp)` in nanoseconds, floored at zero, integer-divided by one
 * second. BigInt division truncates toward zero and the clamp has already made
 * the numerator non-negative, so it is Go's floor exactly.
 */
const ageSeconds = (stamp: string, now: string): bigint => {
  const d = epochNanos(now) - epochNanos(stamp);
  return d < 0n ? 0n : d / NANOS_PER_SECOND;
};

/**
 * The derivation this file USED to carry, kept as the thing being refuted.
 * `Date.parse` truncates to milliseconds, so it cannot see the sub-millisecond
 * difference Go subtracts. Referenced only by the negative test below.
 */
const millisecondAgeSeconds = (stamp: string, now: string): number => {
  const d = (Date.parse(now) - Date.parse(stamp)) / 1000;
  return d < 0 ? 0 : Math.floor(d);
};

// ---------------------------------------------------------------------------
// THE EXAMPLE ROOTS
// ---------------------------------------------------------------------------

interface ExampleRoot {
  /** A label a failure can be read from: `POST /v1/x 200 (application/json)`. */
  label: string;
  body: unknown;
}

const collectMediaExamples = (response: unknown, label: string, out: ExampleRoot[]): void => {
  if (!isRecord(response) || !isRecord(response.content)) {
    return;
  }
  for (const mediaType of Object.keys(response.content).sort()) {
    const media = response.content[mediaType];
    if (isRecord(media) && "example" in media) {
      out.push({ label: `${label} (${mediaType})`, body: media.example });
    }
  }
};

/**
 * Every example the contract DECLARES — the operation responses plus the shared
 * `components.responses` bodies. Schema property bags are deliberately out of
 * scope: `components.schemas.SweepStamp.properties` owns the KEY `age_seconds`
 * while its value is a type declaration, and the old whole-document walk
 * survived that only by accident (the value was an object, so the filter
 * dropped it). A classifier that refuses what it does not understand cannot
 * afford that accident.
 */
const exampleRoots = (doc: unknown): ExampleRoot[] => {
  const out: ExampleRoot[] = [];
  if (!isRecord(doc)) {
    return out;
  }
  const paths = isRecord(doc.paths) ? doc.paths : {};
  for (const route of Object.keys(paths).sort()) {
    const item = paths[route];
    if (!isRecord(item)) {
      continue;
    }
    for (const method of Object.keys(item).sort()) {
      const operation = item[method];
      if (!isRecord(operation) || !isRecord(operation.responses)) {
        continue;
      }
      for (const status of Object.keys(operation.responses).sort()) {
        collectMediaExamples(
          operation.responses[status],
          `${method.toUpperCase()} ${route} ${status}`,
          out,
        );
      }
    }
  }
  const shared =
    isRecord(doc.components) && isRecord(doc.components.responses) ? doc.components.responses : {};
  for (const name of Object.keys(shared).sort()) {
    collectMediaExamples(shared[name], `components.responses.${name}`, out);
  }
  return out;
};

// ---------------------------------------------------------------------------
// THE CLASSIFIER (finding 2)
// ---------------------------------------------------------------------------

/**
 * The stamps a stated age can be measured FROM, and the contract's own words
 * for each:
 *
 *  - `computed_at`     "Database clock minus `computed_at`, floored at zero."
 *  - `max_updated_at`  "the database clock at SERVE time minus the stamp"
 *  - `source_as_of`    "Database clock minus `source_as_of`. Null when the row
 *                       carries no chain-asserted as-of."
 *
 * `observed_at` is NOT here and must never be: the contract calls it DATABASE
 * INSERT TIME and says outright that it is never an as-of.
 */
const STAMP_KEYS = ["computed_at", "max_updated_at", "source_as_of"] as const;
type StampKey = (typeof STAMP_KEYS)[number];

/** One stated age, and the stamp the contract says it is measured from. */
interface StatedAge {
  /** Where it lives, so a failure names the example rather than a line number. */
  where: string;
  /** The instant the age is measured TO — always the body's own `served_at`. */
  servedAt: string;
  stampName: StampKey;
  stamp: string;
  /** What the document says. */
  stated: number;
}

type Resolution = "checked" | "both-null" | "stamp-only" | "mixed" | "unresolved";

interface Candidate {
  where: string;
  resolution: Resolution;
  /** The census line: the resolution plus why, in one readable phrase. */
  detail: string;
  cases: StatedAge[];
}

const show = (v: unknown): string => (v === undefined ? "absent" : JSON.stringify(v));

/**
 * Resolve ONE clock-bearing object. Total by construction: every shape returns
 * a resolution, and the two that mean "this walk does not understand what it is
 * looking at" are failures rather than silence.
 */
const classify = (
  node: Record<string, unknown>,
  where: string,
  servedAt: string | null,
): Candidate => {
  const stamps = STAMP_KEYS.filter((key) => key in node);
  const named = stamps.join("+");
  const unresolved = (why: string): Candidate => ({
    where,
    resolution: "unresolved",
    detail: `unresolved: ${why}`,
    cases: [],
  });

  if (!("age_seconds" in node)) {
    // A stamp with no age beside it claims no freshness, so there is nothing to
    // re-derive — but it is RECORDED, so narrowing the walk until a real pair
    // lands here shows up in the census.
    return { where, resolution: "stamp-only", detail: `stamp-only: ${named}`, cases: [] };
  }

  const age = node.age_seconds;
  if (stamps.length === 0) {
    return unresolved(
      `age_seconds ${show(age)} with no stamp beside it — nothing in this object says what the age ` +
        `is measured FROM, so no arithmetic can check it`,
    );
  }

  const nulled = stamps.filter((key) => node[key] === null);
  const present = stamps.filter((key) => typeof node[key] === "string");
  if (nulled.length + present.length !== stamps.length) {
    return unresolved(
      `a stamp on this object is neither a string nor null (${stamps
        .map((key) => `${key}=${show(node[key])}`)
        .join(", ")})`,
    );
  }

  if (age === null) {
    if (present.length === 0) {
      // Both halves of a nullable pair absent: no stamp, therefore no age. This
      // is the contract's honest refusal shape, not a gap.
      return { where, resolution: "both-null", detail: `both-null: ${named}`, cases: [] };
    }
    return {
      where,
      resolution: "mixed",
      detail:
        `MIXED: age_seconds is null while ${present.join("+")} is present. A stamp with no age ` +
        `beside it is fine on a schema that pairs it with none, but these two are ONE nullable ` +
        `pair and half of it has been dropped.`,
      cases: [],
    };
  }

  if (typeof age !== "number" || !Number.isInteger(age)) {
    return unresolved(`age_seconds is ${show(age)}, which is not the integer the contract declares`);
  }

  if (nulled.length > 0) {
    return {
      where,
      resolution: "mixed",
      detail:
        `MIXED: age_seconds ${String(age)} sits beside a NULL ${nulled.join("+")}. This is a ` +
        `freshness claim with no evidence behind it: the age says the stamp is ${String(age)} ` +
        `seconds old and the stamp says there is no stamp. Production derives one from the other ` +
        `(cmd/api/meta.go:174), so no response can carry this pair.`,
      cases: [],
    };
  }

  if (servedAt === null) {
    return unresolved(
      `age_seconds ${String(age)} sits beside ${named} with NO served_at anywhere above it. Every ` +
        `age on a response is measured from the instant the response was served, so an age with ` +
        `no serve instant in scope cannot be checked — and must not be assumed correct`,
    );
  }

  return {
    where,
    resolution: "checked",
    detail: `checked: ${named}`,
    cases: present.map((stampName) => ({
      where,
      servedAt,
      stampName,
      stamp: String(node[stampName]),
      stated: age,
    })),
  };
};

/**
 * Every clock-bearing object under `node`, classified.
 *
 * `served_at` is inherited downward: the batch envelope and its watermark
 * vector are nested inside the body that stamps it, and production measures
 * their ages from that one instant.
 */
const candidatesIn = (
  node: unknown,
  where: string,
  servedAt: string | null,
  out: Candidate[],
): Candidate[] => {
  if (Array.isArray(node)) {
    node.forEach((entry, i) => candidatesIn(entry, `${where}[${String(i)}]`, servedAt, out));
    return out;
  }
  if (!isRecord(node)) {
    return out;
  }
  const served = typeof node.served_at === "string" ? node.served_at : servedAt;

  if ("age_seconds" in node || STAMP_KEYS.some((key) => key in node)) {
    out.push(classify(node, where, served));
  }
  for (const key of Object.keys(node)) {
    candidatesIn(node[key], `${where}.${key}`, served, out);
  }
  return out;
};

const roots = exampleRoots(contract);
const candidates = roots.flatMap((root) => candidatesIn(root.body, `${root.label} $`, null, []));
const cases = candidates.flatMap((candidate) => candidate.cases);
const census = Object.fromEntries(candidates.map((c) => [c.where, c.detail]));

// ---------------------------------------------------------------------------
// THE PINNED CENSUS (finding 2)
// ---------------------------------------------------------------------------

/**
 * Every clock-bearing object in every declared example, and how it resolved.
 *
 * This is the completeness guard, and it replaces `ages.length > 0` — a check
 * that stayed green while a candidate was being dropped, because seven other
 * pairs kept the count positive. A dropped candidate is a KEY that disappears
 * here; a new one is a key that appears; a candidate whose shape degrades is a
 * VALUE that changes. All three are diffs, and none of them is silent.
 *
 * `stamp-only` entries are the shapes whose schemas pair the stamp with no age
 * at all — `AddressHistoryPoint` (a history point carries `computed_at` and no
 * age), `BatchResponse` (the /v1/batches/{id} envelope, same), and the
 * /v1/prices/{asset} series points (`source_as_of` with no age beside it).
 * They are listed, not skipped: the day one of them grows an age, its value
 * changes to `checked` and the arithmetic starts running.
 */
const CENSUS: Record<string, string> = {
  "GET /v1/address/{addr}/history 200 (application/json) $.batch": "checked: computed_at",
  "GET /v1/address/{addr}/history 200 (application/json) $.engines[0].points[0]":
    "stamp-only: computed_at",
  "GET /v1/address/{addr}/history 200 (application/json) $.engines[0].points[1]":
    "stamp-only: computed_at",
  "GET /v1/batches/{id} 200 (application/json) $": "stamp-only: computed_at",
  "GET /v1/batches/{id} 200 (application/json) $.aggregates[1].sweep": "checked: max_updated_at",
  "GET /v1/observatory/series 200 (application/json) $.points[0].sweep": "checked: max_updated_at",
  "GET /v1/observatory/series 200 (application/json) $.points[1].sweep": "checked: max_updated_at",
  "GET /v1/positions 200 (application/json) $.batch": "checked: computed_at",
  "GET /v1/positions 200 (application/json) $.batch.watermarks[1].sweep": "checked: max_updated_at",
  "GET /v1/prices/{asset} 200 (application/json) $.series[0].points[0]": "stamp-only: source_as_of",
  "GET /v1/prices/{asset} 200 (application/json) $.series[0].points[1]": "stamp-only: source_as_of",
  "POST /v1/scenarios/{id}/run-book 200 (application/json) $.batch": "checked: computed_at",
  "POST /v1/scenarios/{id}/run-book 200 (application/json) $.batch.watermarks[2].sweep":
    "checked: max_updated_at",
};

/** The example roots the walk collected. A root that stops being collected takes
 *  its candidates with it, so the root list is pinned beside the census — a root
 *  carrying no clock at all would otherwise vanish without a trace. */
const ROOTS: string[] = [
  "GET /v1/address/{addr}/history 200 (application/json)",
  "GET /v1/batches/{id} 200 (application/json)",
  "GET /v1/events 200 (application/json)",
  "GET /v1/evidence 200 (application/json)",
  "GET /v1/observatory/series 200 (application/json)",
  "GET /v1/params 200 (application/json)",
  "GET /v1/positions 200 (application/json)",
  "GET /v1/prices/{asset} 200 (application/json)",
  "GET /v1/scenarios 200 (application/json)",
  "POST /v1/scenarios/{id}/run-book 200 (application/json)",
  "components.responses.BatchSuperseded (application/json)",
];

describe("every example in api/openapi.yaml states an age its own stamps support", () => {
  it("collects every example root the contract declares", () => {
    expect(roots.map((root) => root.label)).toEqual(ROOTS);
  });

  it("classifies every clock-bearing object, and the census says which and how", () => {
    expect(census).toEqual(CENSUS);
  });

  it("resolves every candidate — a MIXED or UNRESOLVED shape is a defect, named", () => {
    expect(
      candidates
        .filter((c) => c.resolution === "mixed" || c.resolution === "unresolved")
        .map((c) => `${c.where}: ${c.detail}`),
    ).toEqual([]);
  });

  it("finds stated ages to check — a walk that matched nothing would pass vacuously", () => {
    expect(cases.length).toBe(
      Object.values(CENSUS).filter((detail) => detail.startsWith("checked:")).length,
    );
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("$where: $stampName -> age_seconds", ({ where, servedAt, stampName, stamp, stated }) => {
    const derived = ageSeconds(stamp, servedAt);
    expect(
      { where, age_seconds: BigInt(stated) },
      `${where} states age_seconds ${String(stated)}, but its own bytes give ` +
        `${String(derived)}: served_at ${servedAt} minus ${stampName} ${stamp}, floored at ` +
        `zero. Production measures every age on a response from the ONE database instant it serves at ` +
        `(cmd/api/meta.go:125 and :174), so an example may choose its INSTANTS freely and may never ` +
        `choose its AGES — a stated age no response at the stated instant can carry is a freshness ` +
        `claim contradicted by the timestamps printed beside it.`,
    ).toEqual({ where, age_seconds: derived });
  });
});

// ---------------------------------------------------------------------------
// THE NEGATIVES — the shapes each fix exists for
// ---------------------------------------------------------------------------

/** Convenience: classify a synthetic body the way the contract walk does. */
const classifyBody = (body: unknown): Candidate[] => candidatesIn(body, "$", null, []);

describe("the classifier refuses the shapes the old filter dropped (round 36, finding 2)", () => {
  it("fails a sweep stating an age beside a NULL stamp — the shape that used to contribute nothing", () => {
    const body = {
      served_at: "2026-07-29T10:00:05Z",
      batch: {
        computed_at: "2026-07-29T10:00:00Z",
        age_seconds: 5,
        watermarks: [{ engine: "debt_manager", sweep: { max_updated_at: null, age_seconds: 1205 } }],
      },
    };
    const found = classifyBody(body);
    const sweep = found.find((c) => c.where === "$.batch.watermarks[0].sweep");
    expect(sweep?.resolution).toBe("mixed");
    expect(sweep?.detail).toContain("freshness claim with no evidence behind it");

    // AND the reason it needed fixing: the old walk's own predicate — an
    // age_seconds that is already a number beside a stamp that is already a
    // string — matches NOTHING here, so the case simply never existed.
    const oldWalkWouldHaveMatched =
      typeof body.batch.watermarks[0]?.sweep.age_seconds === "number" &&
      typeof body.batch.watermarks[0]?.sweep.max_updated_at === "string";
    expect(oldWalkWouldHaveMatched).toBe(false);
  });

  it("accepts a nullable pair that is honestly absent on BOTH halves", () => {
    const found = classifyBody({
      served_at: "2026-07-29T10:00:05Z",
      sweep: { max_updated_at: null, age_seconds: null },
    });
    expect(found.map((c) => [c.where, c.resolution])).toEqual([["$.sweep", "both-null"]]);
  });

  it("fails an age with no stamp beside it", () => {
    const found = classifyBody({ served_at: "2026-07-29T10:00:05Z", thing: { age_seconds: 10 } });
    expect(found.map((c) => [c.where, c.resolution])).toEqual([["$.thing", "unresolved"]]);
    expect(found[0]?.detail).toContain("no stamp beside it");
  });

  it("fails a stated age with no served_at in scope rather than assuming it correct", () => {
    const found = classifyBody({ batch: { computed_at: "2026-07-29T10:00:00Z", age_seconds: 5 } });
    expect(found.map((c) => [c.where, c.resolution])).toEqual([["$.batch", "unresolved"]]);
    expect(found[0]?.detail).toContain("NO served_at anywhere above it");
  });

  it("fails an age of the wrong type instead of skipping it", () => {
    const found = classifyBody({
      served_at: "2026-07-29T10:00:05Z",
      batch: { computed_at: "2026-07-29T10:00:00Z", age_seconds: "5" },
    });
    expect(found.map((c) => [c.where, c.resolution])).toEqual([["$.batch", "unresolved"]]);
  });

  it("records a stamp the schema pairs with no age, rather than dropping it", () => {
    const found = classifyBody({
      served_at: "2026-07-29T10:00:05Z",
      point: { computed_at: "2026-07-29T09:45:00Z" },
    });
    expect(found.map((c) => [c.where, c.detail])).toEqual([["$.point", "stamp-only: computed_at"]]);
  });
});

describe("the age arithmetic is Go's, to the nanosecond (round 36, finding 3)", () => {
  it("REFUSES a sub-millisecond age that Date.parse would have blessed", () => {
    // 10:00:05.000000Z minus 09:40:00.000001Z is 1204.999999 seconds.
    // Production floors that to 1204. `Date.parse` truncates both instants to
    // whole milliseconds, sees exactly 1205.000, and certifies a document that
    // overstates its own freshness by a second.
    const stamp = "2026-07-29T09:40:00.000001Z";
    const now = "2026-07-29T10:00:05Z";

    expect(millisecondAgeSeconds(stamp, now)).toBe(1205);
    expect(ageSeconds(stamp, now)).toBe(1204n);
    expect(BigInt(millisecondAgeSeconds(stamp, now))).not.toBe(ageSeconds(stamp, now));
  });

  it("agrees with the millisecond reading wherever milliseconds are enough", () => {
    for (const [stamp, now, want] of [
      ["2026-07-29T09:40:00Z", "2026-07-29T10:00:05Z", 1205n],
      ["2026-07-29T10:00:00Z", "2026-07-29T10:00:05Z", 5n],
      ["2026-07-29T07:58:40Z", "2026-07-29T10:00:05Z", 7285n],
      ["2026-07-29T09:58:40Z", "2026-07-29T10:00:05Z", 85n],
    ] as const) {
      expect(ageSeconds(stamp, now)).toBe(want);
      expect(BigInt(millisecondAgeSeconds(stamp, now))).toBe(want);
    }
  });

  it("floors rather than rounds, on both sides of the second", () => {
    expect(ageSeconds("2026-07-29T09:59:59.000000001Z", "2026-07-29T10:00:05Z")).toBe(5n);
    expect(ageSeconds("2026-07-29T09:59:59.999999999Z", "2026-07-29T10:00:05Z")).toBe(5n);
    expect(ageSeconds("2026-07-29T10:00:00Z", "2026-07-29T10:00:04.999999999Z")).toBe(4n);
  });

  it("clamps a stamp in the future to zero, exactly as production does", () => {
    expect(ageSeconds("2026-07-29T10:00:06Z", "2026-07-29T10:00:05Z")).toBe(0n);
    expect(ageSeconds("2026-07-29T10:00:05.000000001Z", "2026-07-29T10:00:05Z")).toBe(0n);
  });

  it("reads zone offsets rather than assuming Z", () => {
    expect(epochNanos("2026-07-29T12:00:05+02:00")).toBe(epochNanos("2026-07-29T10:00:05Z"));
    expect(epochNanos("2026-07-29T08:00:05-02:00")).toBe(epochNanos("2026-07-29T10:00:05Z"));
  });

  it("refuses what it cannot parse exactly rather than guessing", () => {
    expect(() => epochNanos("2026-07-29 10:00:05")).toThrow(/not an RFC3339 instant/);
    expect(() => epochNanos("2026-02-30T10:00:05Z")).toThrow(/not a real calendar date/);
    expect(() => epochNanos("2026-07-29T25:00:05Z")).toThrow(/out of range/);
    expect(() => epochNanos("2026-07-29T10:00:05.0000000001Z")).toThrow(/fractional digits/);
  });
});
