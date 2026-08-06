// The book wave's anti-drift gate. Every file `generate-book.mjs` writes is a
// pure function of committed contract artifacts — the client package's
// contract-validated fixtures and `api/openapi.yaml` — so a re-run can never
// lawfully disagree with the committed corpus. This spec RE-RUNS the generator
// into a scratch directory on every run and fails on any disagreement, which
// closes the hole this file exists because of: contract 1.2.2 put `sweep` on
// the per-engine book row, the client fixtures followed, and the web copies
// sat stale for six contract versions because nothing on any path re-read
// their provenance. A generator whose outputs drift is now a red gate, not a
// comment that stopped being true.
//
// The comparison is parsed-JSON equality, not raw bytes: git may check the
// committed files out with CRLF line endings on Windows, and a law that fails
// on checkout weather would teach people to ignore it. Field- and value-level
// drift — the only drift a reader can be lied to by — still fails.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "..", "fixtures");
const repoRoot = path.resolve(here, "..", "..", "..");
const clientFixtures = path.join(repoRoot, "packages", "client-ts", "test", "fixtures");

const parse = (dir: string, name: string): unknown =>
  JSON.parse(readFileSync(path.join(dir, name), "utf8")) as unknown;

/**
 * Pinned separately from the directory read, census-style: a generator that
 * quietly stopped writing files would otherwise shrink the comparison set and
 * pass on whatever remained.
 */
const GENERATED_FILE_COUNT = 9;

test("a fresh generator run agrees with every committed output — the corpus is not stale", () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "book-fixtures-"));
  try {
    const run = spawnSync(
      process.execPath,
      [path.join(fixturesDir, "generate-book.mjs")],
      { env: { ...process.env, GENERATE_BOOK_OUT: scratch }, encoding: "utf8" },
    );
    expect(run.status, `generator failed:\n${run.stdout}\n${run.stderr}`).toBe(0);

    const written = readdirSync(scratch).sort();
    expect(written).toHaveLength(GENERATED_FILE_COUNT);

    for (const name of written) {
      expect(
        parse(fixturesDir, name),
        `${name} is stale — re-run \`node tests/fixtures/generate-book.mjs\` from web/`,
      ).toEqual(parse(scratch, name));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the copies really are the client package's contract-validated bodies", () => {
  // Independent of the generator's own code path: even a generator whose copy
  // step broke cannot make these pass against a drifted source.
  const COPIES: [string, string][] = [
    ["book.json", "book.json"],
    ["book-engine-refused.json", "book-engine-refused.json"],
    [path.join("errors", "unavailable.json"), "book-error-unavailable.json"],
    [path.join("errors", "bad-request.json"), "book-error-bad-request.json"],
  ];
  for (const [source, target] of COPIES) {
    expect(parse(fixturesDir, target), target).toEqual(parse(clientFixtures, source));
  }
});

test("the 1.2.2 defect, in memory: every engine row carries `sweep`, and the debt_manager stamp is the watermark's own", () => {
  // The exact bytes that were missing for six contract versions. The two laws
  // above make this unreachable while the client source stays lawful; this
  // test keeps the defect NAMED so a future relaxation of either law cannot
  // drop it silently.
  interface SweepStamp {
    rows: number;
  }
  interface BookShape {
    engines: { engine: string; sweep: SweepStamp | null }[];
    batch: { watermarks: { engine: string; sweep: SweepStamp | null }[] };
  }
  for (const name of ["book.json", "book-engine-refused.json", "book-monotonicity-violation.json"]) {
    const book = parse(fixturesDir, name) as BookShape;
    for (const row of book.engines) {
      expect("sweep" in row, `${name}: engines[${row.engine}] lost its sweep key`).toBe(true);
    }
    const dmRow = book.engines.find((row) => row.engine === "debt_manager");
    const dmStamp = book.batch.watermarks.find((stamp) => stamp.engine === "debt_manager");
    expect(dmRow, `${name} lost its debt_manager engine row`).toBeDefined();
    expect(dmStamp, `${name} lost its debt_manager watermark`).toBeDefined();
    // The contract's own coherence claim: the row's stamp is "the same
    // `SweepStamp` the batch envelope's `Stamp.sweep` serves".
    expect(dmRow?.sweep, `${name}: engine-row sweep must be the watermark's stamp`).toEqual(
      dmStamp?.sweep,
    );
    expect(dmRow?.sweep).not.toBeNull();
  }
});
