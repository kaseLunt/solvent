// THE CLOCK LAW, ON THE PATH EVERY SUITE RUN TAKES (Wave W-EX-D, Codex round 37).
//
// THE FINDING, EXACTLY. `tests/fixtures/clock-law.mjs` is real, exact and
// production-faithful — and until this file it RAN IN EXACTLY ONE SITUATION:
// while a generator was rewriting a fixture. No package script, no test and no
// gate invoked the generators or imported the law. So the defect that created
// the law could be recreated by the most honest maintainer alive: repair the
// timestamps in `api/openapi.yaml`, forget the manual
// `node tests/fixtures/generate-feed.mjs`, and `feed-posture-snapshot.json`
// carries the pre-repair age again while `tsc --noEmit`, `next build` and the
// entire e2e suite stay green. `PostureRibbon` then prints the contradiction —
// a body stating a freshness its own stamps deny — with nothing anywhere
// saying so. The law existed; it just was not on anybody's path.
//
// THE REPAIR. The `unit` project runs on every `npx playwright test`, which is
// this repo's standing gate, so the law now walks the COMMITTED BYTES on every
// run. Not a generator's in-flight values: the files as they sit in git. That is
// the only reading which catches BOTH ways a stale byte actually arrives — a
// generator nobody re-ran, and a hand edit to a file already committed.
//
// WHY THE GENERATORS ARE NOT SPAWNED HERE. Running them from a test would be
// heavy (`generate-lab-book.mjs` is a five-thousand-line derivation over the
// contract), Windows-hostile (child processes, `yaml` resolved out of
// `packages/client-ts/node_modules`), and it would WRITE INTO THE WORKING TREE
// during a test run. It would also prove the wrong thing: a generator's output
// at runtime is law-clean by construction, because the generator refuses to
// write otherwise. The bytes that can be stale are the bytes already on disk.
// THE GENERATOR RUN REMAINS MANUAL; THE LAW IS WHAT STANDS GUARD.
//
// HOW THE MODULE IS IMPORTED, AND WHY IT LOOKS LIKE THIS. `clock-law.mjs` is
// JavaScript and this project sets `allowJs: false`, so a static
// `import { checkClocks } from "../fixtures/clock-law.mjs"` is TS7016 —
// "implicitly has an 'any' type" — under `strict`. Flipping `allowJs` would pull
// every generator in that directory into the type program to buy one import, and
// the tsconfig is not this wave's to move. So the module is loaded by RUNTIME
// FILE URL: the real bytes the two generators import, no shim and no copy. The
// cost of a specifier TypeScript cannot follow is that `ClockLaw` below is a
// CLAIM about a file this spec cannot type-check — so the claim is not left as a
// cast. The export surface is PROVEN at load ("the law's own export surface"),
// and every function it names is exercised further down.
//
// WHAT THIS FILE DOES, IN ORDER:
//
//   1. THE MODULE'S OWN MUTATION PROOF. The sub-millisecond boundary, the clamp
//      and the floor, run against `clock-law.mjs`'s EXPORTED arithmetic. Codex
//      round 36 closed the nanosecond case against the CLIENT test's private
//      implementation — a twin. The module the generators actually rely on was
//      unproven. It is proven here.
//   2. THE HISTORICAL DEFECT, IN MEMORY. The pre-repair 1200 re-injected into
//      the committed posture snapshot, and the law naming the trio.
//   3. THE WALK. Every committed JSON fixture, enumerated FROM THE DIRECTORY
//      TREE, re-derived age by age.
//   4. THE CENSUS. What the law found, pinned per file and in total, and
//      cross-checked against the two generators' OWN pins read out of their
//      source — so this spec and the generators cannot disagree about coverage
//      without one of them failing.
//
// AMENDMENT (Codex round 38). The first cut of this file enumerated with a FLAT
// `readdirSync`, which reads immediate children only — while the sentence above
// it promised every committed JSON fixture. A nested `fixtures/feed/snapshot.json`
// would have bypassed the walk AND all four census laws, silently, and the
// guarantee would have kept reading as though it were checked. The enumeration
// is now a recursive descent keyed on NORMALIZED RELATIVE PATHS, and the
// enumerator itself is proven against a synthetic nested tree ("the enumerator
// descends", below) rather than trusted — a walk that stops walking is the same
// failure as a law that stops matching, and it deserves the same treatment.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "..", "fixtures");
const LAW_SPECIFIER = pathToFileURL(path.join(fixturesDir, "clock-law.mjs")).href;

// --- the law, loaded and its surface proven ---------------------------------

interface ClockCandidate {
  where: string;
  resolution: string;
  detail: string;
  failures?: string[];
}

interface ClockReport {
  checked: number;
  resolutions: string[];
  failures: string[];
}

interface ClockLaw {
  epochNanos: (stamp: string) => bigint;
  ageSeconds: (stamp: string, now: string) => bigint;
  STAMP_KEYS: string[];
  clockCandidates: (node: unknown) => ClockCandidate[];
  checkClocks: (body: unknown) => ClockReport;
}

/** Every name the generators import, plus what each one must be. */
const LAW_SURFACE: Record<string, "function" | "object"> = {
  epochNanos: "function",
  ageSeconds: "function",
  STAMP_KEYS: "object",
  clockCandidates: "function",
  checkClocks: "function",
};

let loading: Promise<ClockLaw> | null = null;

/**
 * The module by file URL. Node caches it, so the 50-odd callers below pay for
 * one load. The surface check is not ceremony: a cast over a specifier
 * TypeScript cannot follow would let a renamed export reach the tests as
 * `undefined is not a function` instead of a sentence.
 */
const theLaw = (): Promise<ClockLaw> => {
  loading ??= (async (): Promise<ClockLaw> => {
    const mod = (await import(LAW_SPECIFIER)) as Record<string, unknown>;
    const wrong = Object.entries(LAW_SURFACE)
      .filter(([name, kind]) => typeof mod[name] !== kind)
      .map(([name, kind]) => `${name} (want ${kind}, got ${typeof mod[name]})`);
    if (wrong.length > 0) {
      throw new Error(
        `clock-law.mjs no longer exports the surface its generators import: ${wrong.join(", ")}`,
      );
    }
    return mod as unknown as ClockLaw;
  })();
  return loading;
};

// --- the corpus, enumerated from the directory TREE --------------------------
//
// DERIVED, NEVER HAND-LISTED. A fixture added tomorrow is walked tomorrow, with
// nobody remembering to add a line here. The pinned census below is what turns
// "walked" into a countable claim.
//
// RECURSIVE, and the identifier is the RELATIVE PATH with forward slashes on
// every platform — `feed/snapshot.json`, never `feed\snapshot.json`. The
// separator is normalized at construction rather than at comparison, so a census
// key means one thing on Windows and Linux alike. Today the directory is FLAT, so
// every relative path is a bare filename and the census keys read exactly as they
// did before; the day someone nests a fixture, its key gains a directory and the
// census discriminates on it rather than colliding with a same-named sibling.

/** Directories that are never fixtures. Defensive: none exists today, and a test below pins that. */
const SKIPPED_DIR_NAMES = new Set(["node_modules", ".git"]);

interface Corpus {
  /** Every `.json` beneath the root, relative + forward-slashed, sorted. */
  files: string[];
  /** Every directory descended into, same form. */
  directories: string[];
  /** Every directory NOT descended into, same form. */
  skipped: string[];
}

const collectFixtures = (root: string): Corpus => {
  const files: string[] = [];
  const directories: string[] = [];
  const skipped: string[] = [];
  const descend = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIR_NAMES.has(entry.name)) {
          skipped.push(relative);
          continue;
        }
        directories.push(relative);
        descend(path.join(dir, entry.name), relative);
        continue;
      }
      if (entry.name.endsWith(".json")) {
        files.push(relative);
      }
    }
  };
  descend(root, "");
  return { files: files.sort(), directories: directories.sort(), skipped: skipped.sort() };
};

const corpus = collectFixtures(fixturesDir);
const fixtureFiles = corpus.files;

const readFixture = (relative: string): unknown => {
  const text = readFileSync(path.join(fixturesDir, relative), "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`${relative} is not parseable JSON: ${String(cause)}`);
  }
};

/**
 * The GENERATORS' structural rule for "this body carries a batch envelope",
 * applied to committed bytes. Held separately from the law's own reading so the
 * two can be made to agree: a batch-bearing body that the law finds NOTHING in
 * is precisely the silent hole this wave exists to close — a `batch` whose age
 * and stamp both went null would sail through a census that only counted trios.
 */
const isBatchBearing = (node: unknown): boolean => {
  if (Array.isArray(node)) {
    return node.some(isBatchBearing);
  }
  if (typeof node !== "object" || node === null) {
    return false;
  }
  const record = node as Record<string, unknown>;
  return "batch" in record || Object.values(record).some(isBatchBearing);
};

// --- THE CENSUS -------------------------------------------------------------
//
// Every committed fixture the clock law resolves a stamp/age trio in, and how
// many. KEYED BY RELATIVE PATH beneath `tests/fixtures` — which for a flat
// directory is just the filename, and which stays honest the moment it stops
// being flat. PINNED, for the same reason both generators pin theirs: a law that
// stopped matching would pass exactly as quietly as the stale byte it exists to
// catch. A new batch-bearing fixture that skips the law is therefore a VISIBLE
// DIFF — the walk finds trios the census does not name, and the census test
// fails naming the file.
//
// Twenty-four of these carry a `batch` envelope and state two ages: the batch's
// own over `computed_at`, and the debt_manager sweep's over `max_updated_at`.
// The twenty-fifth, `observatory-series-dm.json`, carries no batch at all — it
// is a series of points whose two sweeps each state an age. Which is the reason
// the walk is over the DIRECTORY and not over "the batch-bearing files": the
// clock-bearing set is strictly larger than the batch-bearing set, and always
// was.
//
// NOTE WHICH GENERATOR WROTE WHAT. Only eleven of these files come from a
// generator that imports the law at all (`generate-feed.mjs`, one file with
// trios; `generate-lab-book.mjs`, thirteen). The other eleven — `book.json`,
// the three `positions-*`, the three `stress-*`, the two `book-*` defect bodies,
// `run-book.weeth_market_depeg_oracles_held.json` and `observatory-series-dm`
// — come from `generate.mjs`, `generate-book.mjs` and `generate-observatory.mjs`,
// which have NO clock guard. Before this spec nothing on any path had ever read
// their ages.
const CENSUS: Record<string, number> = {
  "book-engine-refused.json": 2,
  "book-monotonicity-violation.json": 2,
  "book.json": 2,
  "feed-posture-snapshot.json": 2,
  "observatory-series-dm.json": 2,
  "positions-aave-page-1.json": 2,
  "positions-aave-page-2.json": 2,
  "positions-dm-page-1.json": 2,
  "run-book.collateral-collision.json": 2,
  "run-book.collateral-collision.swap.json": 2,
  "run-book.contradictory.json": 2,
  "run-book.eth_minus_30.batch2.json": 2,
  "run-book.eth_minus_30.json": 2,
  "run-book.ethfi_minus_50.v2.json": 2,
  "run-book.named-twice.json": 2,
  "run-book.names-nobody.batch2.json": 2,
  "run-book.names-nobody.json": 2,
  "run-book.partial-hole.json": 2,
  "run-book.weeth-withheld.json": 2,
  "run-book.weeth.batch2.json": 2,
  "run-book.weeth.v2.json": 2,
  "run-book.weeth_market_depeg_oracles_held.json": 2,
  "stress-aave.json": 2,
  "stress-dm.json": 2,
  "stress-unknowable.json": 2,
};

/** 25 files × 2 trios. Stated separately so a census edit cannot move it silently. */
const CENSUS_TOTAL = 50;

// --- the generators' own pins, read out of their source ---------------------
//
// The two guarded generators each pin their own trio count. If this spec pinned
// a SECOND, independent number over the same files, the two pins could drift
// apart and each would keep passing — two clocks that may disagree, which is the
// exact shape this whole train of waves is about. So the generators' pins are
// EXTRACTED and compared against this census. The extraction's own yield is
// pinned too (`GENERATOR_PIN_SHAPE`): a regex that quietly stopped matching
// would make the cross-check vacuous in the same silent way.

const generatorText = (name: string): string => readFileSync(path.join(fixturesDir, name), "utf8");

const capture = (source: string, pattern: RegExp): string[] => {
  const out: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined) {
      out.push(value);
    }
  }
  return out;
};

const labBookSource = generatorText("generate-lab-book.mjs");
/** Every file `generate-lab-book.mjs` writes, taken from its own `write(...)` calls. */
const labBookWrites = capture(labBookSource, /\bwrite\("([^"]+\.json)"/g);
/** Its `CLOCK_TRIOS_TOTAL`. NaN if the pin were renamed — which the shape test catches. */
const labBookPin = Number(capture(labBookSource, /const CLOCK_TRIOS_TOTAL = (\d+);/g)[0]);

const feedSource = generatorText("generate-feed.mjs");
const feedCensusBlock = capture(feedSource, /const CLOCK_TRIOS = \{([\s\S]*?)\n\};/g)[0] ?? "";
/** `generate-feed.mjs`'s per-file pin, file by file. */
const feedPins = new Map<string, number>(
  [...feedCensusBlock.matchAll(/"([^"]+\.json)":\s*(\d+)/g)].map((match) => [
    match[1] ?? "",
    Number(match[2]),
  ]),
);

/** What the extraction must yield. A regex that stops matching fails HERE. */
const GENERATOR_PIN_SHAPE = { labBookWrites: 17, labBookPin: 26, feedPins: 11 };

// ---------------------------------------------------------------------------
// 1. THE MODULE'S OWN MUTATION PROOF
// ---------------------------------------------------------------------------
//
// `packages/client-ts/test/example-clock.test.ts` proved the nanosecond boundary
// against ITS OWN implementation of the arithmetic. That is a twin of this
// module, not this module. The generators import THESE functions, so these are
// the ones put under the boundary.

test.describe("clock-law.mjs, the module the generators import", () => {
  test("the law's own export surface", async () => {
    const law = await theLaw();
    expect(Object.keys(LAW_SURFACE).sort()).toEqual([
      "STAMP_KEYS",
      "ageSeconds",
      "checkClocks",
      "clockCandidates",
      "epochNanos",
    ]);
    // `observed_at` is DATABASE INSERT TIME and is never an as-of. It must never
    // appear here, or the law would start certifying ages against a stamp the
    // contract says means nothing about freshness.
    expect(law.STAMP_KEYS).toEqual(["computed_at", "max_updated_at", "source_as_of"]);
  });

  test("sub-millisecond boundary: the naive reading says 1205, the law says 1204", async () => {
    const law = await theLaw();
    const stamp = "2026-07-29T09:40:00.000001Z";
    const servedAt = "2026-07-29T10:00:05Z";

    // The mutant this test exists to kill: `Date.parse` truncates to
    // milliseconds, so the microsecond vanishes and 1204.999999s reads as a
    // whole 1205 — the very off-by-one the law is here to catch.
    const naive = Math.floor((Date.parse(servedAt) - Date.parse(stamp)) / 1000);
    expect(naive).toBe(1205);

    // Production subtracts on nanoseconds (`cmd/api/meta.go:255-261` over Go's
    // `time.Time`), so 1204 is the only age that response could carry.
    expect(law.ageSeconds(stamp, servedAt)).toBe(1204n);

    // And the exactness is in `epochNanos`, not in a rounding step after it.
    expect(law.epochNanos(servedAt) - law.epochNanos(stamp)).toBe(1_204_999_999_000n);
  });

  test("the clamp: a stamp AFTER served_at is age zero, never a negative", async () => {
    const law = await theLaw();
    // The `.batch2` shape, exactly: `computed_at` 25 seconds after the instant
    // the body was served. Production floors at zero, so 0 is the only age that
    // response can state — and the fixtures once said 5.
    expect(law.ageSeconds("2026-07-29T10:00:30Z", "2026-07-29T10:00:05Z")).toBe(0n);
    expect(law.ageSeconds("2026-07-29T10:00:05.000000001Z", "2026-07-29T10:00:05Z")).toBe(0n);
    // The boundary itself: equal instants are zero, not one.
    expect(law.ageSeconds("2026-07-29T10:00:05Z", "2026-07-29T10:00:05Z")).toBe(0n);
  });

  test("the floor: a part-second never rounds up", async () => {
    const law = await theLaw();
    // 1.999999999s is one second old, not two. BigInt division truncates toward
    // zero and the clamp has already made the numerator non-negative, so
    // truncation IS Go's floor here.
    expect(law.ageSeconds("2026-07-29T10:00:03.000000001Z", "2026-07-29T10:00:05Z")).toBe(1n);
    expect(law.ageSeconds("2026-07-29T10:00:04.999999999Z", "2026-07-29T10:00:05Z")).toBe(0n);
    expect(law.ageSeconds("2026-07-29T10:00:04Z", "2026-07-29T10:00:05Z")).toBe(1n);
  });

  test("a zone offset is resolved before the subtraction, not after", async () => {
    const law = await theLaw();
    // Same instant, three spellings. An age must not depend on how a stamp was
    // written down.
    expect(law.ageSeconds("2026-07-29T09:40:00Z", "2026-07-29T10:00:05Z")).toBe(1205n);
    expect(law.ageSeconds("2026-07-29T11:40:00+02:00", "2026-07-29T10:00:05Z")).toBe(1205n);
    expect(law.ageSeconds("2026-07-29T04:40:00-05:00", "2026-07-29T10:00:05Z")).toBe(1205n);
  });

  test("a half-stated pair is a failure, not a silent skip", async () => {
    const law = await theLaw();
    // An age with a NULL stamp beside it is a freshness claim with no evidence.
    // Nothing may fall through a filter and contribute nothing.
    const mixed = law.checkClocks({
      served_at: "2026-07-29T10:00:05Z",
      batch: { age_seconds: 5, computed_at: null },
    });
    expect(mixed.checked).toBe(0);
    expect(mixed.failures.join("\n")).toContain("MIXED");

    // An age with NO stamp at all cannot be measured from anything.
    const orphan = law.checkClocks({
      served_at: "2026-07-29T10:00:05Z",
      batch: { age_seconds: 5 },
    });
    expect(orphan.failures.join("\n")).toContain("unresolved");
  });
});

// ---------------------------------------------------------------------------
// 2. THE HISTORICAL DEFECT, IN MEMORY
// ---------------------------------------------------------------------------

test.describe("the round-36 defect, replayed", () => {
  test("re-injecting the pre-repair 1200 fails the law, naming the trio", async () => {
    const law = await theLaw();
    const name = "feed-posture-snapshot.json";
    const body = readFixture(name) as {
      batch: { watermarks: { sweep: { age_seconds: number } | null }[] };
    };

    // Committed, this body is clean and states two ages.
    expect(law.checkClocks(body).failures).toEqual([]);
    expect(law.checkClocks(body).checked).toBe(2);

    const sweeps = body.batch.watermarks.filter((w) => w.sweep !== null);
    expect(sweeps).toHaveLength(1);
    const sweep = sweeps[0]?.sweep;
    expect(sweep?.age_seconds).toBe(1205);
    if (sweep === undefined || sweep === null) {
      throw new Error(`${name} no longer carries the debt_manager sweep this test replays`);
    }

    // The byte as it stood before Wave W-EX-C: the age measured from
    // `computed_at` rather than from `served_at`, copied verbatim out of a
    // contract example that had since been repaired.
    sweep.age_seconds = 1200;

    const report = law.checkClocks(body);
    expect(report.checked).toBe(2);
    expect(report.failures).toHaveLength(1);
    const failure = report.failures.join("\n");
    expect(failure).toContain("$.batch.watermarks[1].sweep");
    expect(failure).toContain("age_seconds is 1200");
    expect(failure).toContain("IS 1205");
  });
});

// ---------------------------------------------------------------------------
// 3. THE WALK
// ---------------------------------------------------------------------------
//
// One test per committed fixture, so a failure NAMES THE FILE in its own title
// rather than in a haystack of paths inside one assertion.

test.describe("every committed fixture states only ages its own stamps support", () => {
  test("the corpus is not empty", () => {
    // A directory read that started returning nothing would make every test
    // below vacuous — the walk's own version of a law that stops matching.
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(51);
    // Every key is relative and forward-slashed, on every platform.
    expect(fixtureFiles.filter((name) => name.includes("\\"))).toEqual([]);
    expect(fixtureFiles.filter((name) => path.isAbsolute(name))).toEqual([]);
  });

  test("nothing in the fixtures tree was skipped as noise", () => {
    // The skip list is defensive, and today it never fires: `tests/fixtures` is
    // flat and holds fixtures and generators, nothing installed. If this ever
    // fails, a directory appeared that nobody decided about — decide, rather
    // than let the walk quietly stop covering it.
    expect(corpus.skipped).toEqual([]);
    expect(corpus.directories).toEqual([]);
  });

  test("the enumerator descends", async () => {
    // PROVEN, NOT TRUSTED (Codex round 38). The flat `readdirSync` this replaced
    // read as though it walked everything and did not, so the recursion gets its
    // own mutant: a synthetic tree — built OUTSIDE the repo, in the OS temp dir,
    // and torn down here — with a stale trio buried two levels down. A walker
    // that stopped descending would return two files instead of four, and a
    // walker that leaked the platform separator would fail the key assertions.
    const law = await theLaw();
    const root = mkdtempSync(path.join(tmpdir(), "clock-law-enum-"));
    try {
      mkdirSync(path.join(root, "feed", "deep"), { recursive: true });
      const stale = {
        served_at: "2026-07-29T10:00:05Z",
        batch: { computed_at: "2026-07-29T09:40:00Z", age_seconds: 1200 },
      };
      writeFileSync(path.join(root, "top.json"), JSON.stringify(stale));
      writeFileSync(path.join(root, "notes.txt"), "not a fixture");
      writeFileSync(path.join(root, "feed", "snapshot.json"), JSON.stringify(stale));
      writeFileSync(path.join(root, "feed", "deep", "buried.json"), JSON.stringify(stale));
      mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
      writeFileSync(path.join(root, "node_modules", "pkg", "package.json"), "{}");

      const found = collectFixtures(root);
      expect(found.files).toEqual(["feed/deep/buried.json", "feed/snapshot.json", "top.json"]);
      expect(found.directories).toEqual(["feed", "feed/deep"]);
      expect(found.skipped).toEqual(["node_modules"]);

      // And a nested body IS readable and IS refused by the law — the two halves
      // the round-38 gap left unjoined.
      for (const name of found.files) {
        const text = readFileSync(path.join(root, name), "utf8");
        const report = law.checkClocks(JSON.parse(text) as unknown);
        expect(report.checked).toBe(1);
        expect(report.failures.join("\n")).toContain("IS 1205");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const name of fixtureFiles) {
    test(name, async () => {
      const law = await theLaw();
      const report = law.checkClocks(readFixture(name));
      expect(
        report.failures,
        `${name} states an age its own stamps do not support:\n  ${report.failures.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. THE CENSUS
// ---------------------------------------------------------------------------

test.describe("the clock census", () => {
  const walkCounts = async (): Promise<Map<string, number>> => {
    const law = await theLaw();
    const counts = new Map<string, number>();
    for (const name of fixtureFiles) {
      counts.set(name, law.checkClocks(readFixture(name)).checked);
    }
    return counts;
  };

  test("no fixture carries a trio the census does not name", async () => {
    const counts = await walkCounts();
    const unpinned = [...counts]
      .filter(([name, checked]) => checked > 0 && CENSUS[name] === undefined)
      .map(([name, checked]) => `${name} (${String(checked)})`);
    expect(
      unpinned,
      "a committed fixture states an age nobody pinned. If it is new, add it to CENSUS " +
        "and move CENSUS_TOTAL in the same diff — that is the point of the pin.",
    ).toEqual([]);
  });

  test("every pinned file still exists and still carries its pinned trios", async () => {
    const counts = await walkCounts();
    const moved = Object.entries(CENSUS)
      .filter(([name, want]) => counts.get(name) !== want)
      .map(([name, want]) => `${name}: pinned ${String(want)}, found ${String(counts.get(name))}`);
    expect(
      moved,
      "the clock law stopped matching where it used to match — which passes exactly as " +
        "silently as the stale byte it exists to catch.",
    ).toEqual([]);
  });

  test("the total is pinned", async () => {
    const counts = await walkCounts();
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBe(CENSUS_TOTAL);
    expect(Object.values(CENSUS).reduce((sum, n) => sum + n, 0)).toBe(CENSUS_TOTAL);
  });

  test("every batch-bearing body resolves at least one trio", async () => {
    const counts = await walkCounts();
    const silent = fixtureFiles.filter(
      (name) => isBatchBearing(readFixture(name)) && (counts.get(name) ?? 0) === 0,
    );
    expect(
      silent,
      "a body carrying a batch envelope that the clock law resolves NOTHING in — a batch whose " +
        "age and stamp both went null would otherwise slip past a census that only counts trios.",
    ).toEqual([]);
    // 24 batch-bearing bodies today; `observatory-series-dm.json` is the
    // clock-bearing file that carries no batch, which is why the walk is over the
    // directory rather than over the batch-bearing subset.
    expect(fixtureFiles.filter((name) => isBatchBearing(readFixture(name)))).toHaveLength(24);
  });
});

test.describe("this census and the generators' own pins cannot disagree", () => {
  test("the pins were actually extracted", () => {
    expect({
      labBookWrites: labBookWrites.length,
      labBookPin,
      feedPins: feedPins.size,
    }).toEqual(GENERATOR_PIN_SHAPE);
    // Both generators write with `path.join(here, name)`, so every name they
    // emit is a TOP-LEVEL file and its bare name is already a valid relative
    // census key. Pinned, because a generator that started nesting would
    // otherwise look up `feed/x.json` under the key `x.json` and quietly agree
    // with nothing.
    expect([...labBookWrites, ...feedPins.keys()].filter((name) => name.includes("/"))).toEqual([]);
  });

  test("generate-lab-book.mjs's 26 is this census's 26", () => {
    const total = labBookWrites.reduce((sum, name) => sum + (CENSUS[name] ?? 0), 0);
    expect(
      total,
      `the thirteen batch-bearing run-book bodies plus the four scenario listings that ` +
        `generate-lab-book.mjs writes: it pins ${String(labBookPin)} trios across them, this ` +
        `census reads ${String(total)} off the committed bytes.`,
    ).toBe(labBookPin);
    // Its own arithmetic, restated: 2 per batch-bearing body, 0 per listing.
    expect(labBookWrites.filter((name) => (CENSUS[name] ?? 0) === 2)).toHaveLength(13);
    expect(labBookWrites.filter((name) => (CENSUS[name] ?? 0) === 0)).toHaveLength(4);
  });

  test("generate-feed.mjs's per-file pins are this census's counts", () => {
    const disagreements = [...feedPins]
      .filter(([name, want]) => (CENSUS[name] ?? 0) !== want)
      .map(([name, want]) => `${name}: generator pins ${String(want)}, census has ${String(CENSUS[name] ?? 0)}`);
    expect(disagreements).toEqual([]);
    // The one feed body with a clock, and both of its trios.
    expect(feedPins.get("feed-posture-snapshot.json")).toBe(2);
  });
});
