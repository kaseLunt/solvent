// THE CONTRACT'S EXAMPLES ANSWER TO THEIR OWN CLOCKS (Wave W-EX-B).
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
// A trio it does not recognize is not silently skipped: `age_seconds` beside a
// stamp is what it looks for, so an example that grows a new stated age gets
// checked the day it lands.

import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { CONTRACT_PATH } from "./fixtures/index.js";

const contract = parse(readFileSync(CONTRACT_PATH, "utf8")) as unknown;

/** One stated age, and the two stamps the contract says it is measured from. */
interface StatedAge {
  /** Where it lives, so a failure names the example rather than a line number. */
  path: string;
  /** The instant the age is measured TO — always the body's own `served_at`. */
  servedAt: string;
  /** The instant the age is measured FROM. */
  stampName: string;
  stamp: string;
  /** What the document says. */
  stated: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every stated age under `node`, with the `served_at` in scope.
 *
 * `served_at` is inherited downward: the batch envelope and its watermark
 * vector are nested inside the body that stamps it, and production measures
 * their ages from that one instant.
 */
const statedAges = (node: unknown, path: string, servedAt: string | null, out: StatedAge[]): StatedAge[] => {
  if (Array.isArray(node)) {
    node.forEach((entry, i) => statedAges(entry, `${path}[${i}]`, servedAt, out));
    return out;
  }
  if (!isRecord(node)) {
    return out;
  }
  const served = typeof node.served_at === "string" ? node.served_at : servedAt;

  if (typeof node.age_seconds === "number" && served !== null) {
    for (const stampName of ["computed_at", "max_updated_at"] as const) {
      const stamp = node[stampName];
      if (typeof stamp === "string") {
        out.push({ path, servedAt: served, stampName, stamp, stated: node.age_seconds });
      }
    }
  }
  for (const key of Object.keys(node)) {
    statedAges(node[key], `${path}.${key}`, served, out);
  }
  return out;
};

/** Production's `ageSeconds` (cmd/api/meta.go:255-261): floored, never negative. */
const ageSeconds = (stamp: string, now: string): number => {
  const d = (Date.parse(now) - Date.parse(stamp)) / 1000;
  return d < 0 ? 0 : Math.floor(d);
};

const ages = statedAges(contract, "$", null, []);

describe("every example in api/openapi.yaml states an age its own stamps support", () => {
  it("finds stated ages to check — a walk that matched nothing would pass vacuously", () => {
    expect(ages.length).toBeGreaterThan(0);
  });

  it.each(ages)("$path: $stampName -> age_seconds", ({ path, servedAt, stampName, stamp, stated }) => {
    expect(
      { where: path, age_seconds: stated },
      `${path} states age_seconds ${stated}, but its own bytes give ` +
        `${ageSeconds(stamp, servedAt)}: served_at ${servedAt} minus ${stampName} ${stamp}, floored at ` +
        `zero. Production measures every age on a response from the ONE database instant it serves at ` +
        `(cmd/api/meta.go:125 and :174), so an example may choose its INSTANTS freely and may never ` +
        `choose its AGES — a stated age no response at the stated instant can carry is a freshness ` +
        `claim contradicted by the timestamps printed beside it.`,
    ).toEqual({ where: path, age_seconds: ageSeconds(stamp, servedAt) });
  });
});
