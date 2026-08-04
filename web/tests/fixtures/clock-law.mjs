// THE CLOCK LAW — one implementation of "what age does this stamp support",
// shared by the fixture generators that emit bodies carrying one.
//
// # Why this file exists at all (Wave W-EX-C, Codex round 36 finding 4)
//
// Every sibling generator in this directory is otherwise STANDALONE — node:*
// imports and nothing else — and that is deliberate: a generator that reaches
// into a sibling makes "who owns this byte" ambiguous. This module is the one
// exception, and the reason is the defect it closes.
//
// `feed-posture-snapshot.json` copied the `/v1/positions` example's batch
// envelope VERBATIM, said so in its generator's provenance record, and carried
// a sweep age of 1200 over a stamp 1205 seconds before its own `served_at`.
// The generator's promise was sound; its OUTPUT was stale, because the contract
// had been repaired (Wave W-EX-B) and nobody re-ran the generator. `PostureRibbon`
// printed the 1200 verbatim and two e2e suites served it as SSE, so a fixture
// nobody re-derived was teaching the product's own tests an understated
// freshness.
//
// The fix is not "re-run it". The fix is that a stale clock byte can no longer
// SURVIVE a run: every body a guarded generator emits is walked, and any age it
// states that its own stamps do not support stops generation.
//
// Two generators need that law (`generate-feed.mjs` and `generate-lab-book.mjs`),
// and two independent implementations of "what an age means" is exactly the
// two-clocks-that-may-disagree shape this whole wave is about. So the arithmetic
// lives once, here, and both import it.
//
// # The arithmetic is PRODUCTION'S, not an approximation of it
//
// `cmd/api/meta.go:255-261`:
//
//	func ageSeconds(now, stamp time.Time) int64 {
//	    d := now.Sub(stamp)
//	    if d < 0 { return 0 }
//	    return int64(d / time.Second)
//	}
//
// Subtract, clamp at zero, integer-divide by one second. Reproduced here to the
// NANOSECOND, on BigInt, because `Date.parse` truncates to milliseconds and Go
// does not: a stamp of `09:40:00.000001Z` against a `served_at` of `10:00:05Z`
// is 1204 seconds old in production and 1205 through `Date.parse`, and a law
// that cannot see that difference would certify the off-by-one it exists to
// catch (Codex round 36 finding 3, closed in the same wave against
// `packages/client-ts/test/example-clock.test.ts`).
//
// # SCOPE — read this before reaching for it
//
// This law looks at CLOCKS AND NOTHING ELSE: `served_at`, the stamps an age can
// be measured from, and the ages beside them. It says nothing about money,
// counts, coverage, engine arrays or any other byte, and it must not grow to.
// Several fixtures in this directory are MALFORMED ON PURPOSE — they reproduce
// defects the product must survive — and a guard that refused them would be
// refusing the evidence. A narrow clock law can run over those bodies precisely
// because their deliberate wrongness is never a clock.

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
 * (`2026-02-30` silently becomes `2026-03-02`).
 *
 * @param {string} stamp
 * @returns {bigint}
 */
export const epochNanos = (stamp) => {
  const m = RFC3339.exec(stamp);
  if (m === null) {
    throw new Error(`not an RFC3339 instant: ${JSON.stringify(stamp)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`RFC3339 date out of range: ${JSON.stringify(stamp)}`);
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`RFC3339 time out of range: ${JSON.stringify(stamp)}`);
  }

  // `setUTCFullYear` rather than `Date.UTC`, which maps two-digit years into the
  // 1900s — a four-digit `0099` would otherwise silently become 1999.
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
      `${JSON.stringify(stamp)} carries ${fraction.length} fractional digits — finer than the ` +
        `nanosecond resolution Go's time.Time holds`,
    );
  }

  let offsetNanos = 0n;
  if (m[8] !== undefined) {
    const offsetHour = BigInt(m[9]);
    const offsetMinute = BigInt(m[10]);
    if (offsetHour > 23n || offsetMinute > 59n) {
      throw new Error(`RFC3339 zone offset out of range: ${JSON.stringify(stamp)}`);
    }
    const magnitude = (offsetHour * 3600n + offsetMinute * 60n) * NANOS_PER_SECOND;
    offsetNanos = m[8] === "-" ? -magnitude : magnitude;
  }

  return BigInt(civil.getTime()) * NANOS_PER_MILLI + BigInt(fraction.padEnd(9, "0")) - offsetNanos;
};

/**
 * Production's `ageSeconds` (cmd/api/meta.go:255-261), operation for operation.
 * BigInt division truncates toward zero and the clamp has already made the
 * numerator non-negative, so it is Go's floor exactly.
 *
 * @param {string} stamp
 * @param {string} now
 * @returns {bigint}
 */
export const ageSeconds = (stamp, now) => {
  const d = epochNanos(now) - epochNanos(stamp);
  return d < 0n ? 0n : d / NANOS_PER_SECOND;
};

/**
 * The stamps a stated age can be measured FROM, and the contract's own words:
 *
 *  - `computed_at`     "Database clock minus `computed_at`, floored at zero."
 *  - `max_updated_at`  "the database clock at SERVE time minus the stamp"
 *  - `source_as_of`    "Database clock minus `source_as_of`."
 *
 * `observed_at` is NOT here and must never be: the contract calls it DATABASE
 * INSERT TIME and says outright that it is never an as-of.
 */
export const STAMP_KEYS = ["computed_at", "max_updated_at", "source_as_of"];

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v) => (v === undefined ? "absent" : JSON.stringify(v));

/**
 * Resolve ONE clock-bearing object into exactly one outcome. Total by
 * construction — nothing falls through a filter and contributes silently, which
 * is the whole shape of Codex round 36 finding 2.
 *
 *   checked     an age and the stamp it is measured from, both present
 *   both-null   a nullable pair, both halves absent: no stamp, so no age
 *   stamp-only  a stamp whose schema pairs it with no age at all
 *   mixed       half a nullable pair — a freshness claim with no evidence
 *   unresolved  a shape this law does not understand
 *
 * `mixed` and `unresolved` are FAILURES. So is a `checked` trio whose stated
 * age is not the one its own stamps support.
 */
const classify = (node, where, servedAt) => {
  const stamps = STAMP_KEYS.filter((key) => key in node);
  const named = stamps.join("+");
  const unresolved = (why) => ({ where, resolution: "unresolved", detail: `unresolved: ${why}` });

  if (!("age_seconds" in node)) {
    return { where, resolution: "stamp-only", detail: `stamp-only: ${named}` };
  }
  const age = node.age_seconds;
  if (stamps.length === 0) {
    return unresolved(
      `age_seconds ${show(age)} with no stamp beside it — nothing in this object says what the age is measured FROM`,
    );
  }

  const nulled = stamps.filter((key) => node[key] === null);
  const present = stamps.filter((key) => typeof node[key] === "string");
  if (nulled.length + present.length !== stamps.length) {
    return unresolved(
      `a stamp here is neither a string nor null (${stamps.map((k) => `${k}=${show(node[k])}`).join(", ")})`,
    );
  }

  if (age === null) {
    if (present.length === 0) {
      return { where, resolution: "both-null", detail: `both-null: ${named}` };
    }
    return {
      where,
      resolution: "mixed",
      detail: `MIXED: age_seconds is null while ${present.join("+")} is present — half a nullable pair`,
    };
  }
  if (!Number.isInteger(age)) {
    return unresolved(`age_seconds is ${show(age)}, which is not the integer the contract declares`);
  }
  if (nulled.length > 0) {
    return {
      where,
      resolution: "mixed",
      detail:
        `MIXED: age_seconds ${age} sits beside a NULL ${nulled.join("+")} — a freshness claim with no ` +
        `evidence behind it`,
    };
  }
  if (servedAt === null) {
    return unresolved(
      `age_seconds ${age} sits beside ${named} with NO served_at above it — every age on a response is ` +
        `measured from the instant it was served, so this one cannot be checked`,
    );
  }

  const failures = [];
  for (const stampName of present) {
    const want = ageSeconds(node[stampName], servedAt);
    if (BigInt(age) !== want) {
      failures.push(
        `${where}: age_seconds is ${age}, but served_at ${servedAt} minus ${stampName} ` +
          `${node[stampName]}, floored at zero, IS ${want}. Production measures every age on a ` +
          `response from the ONE database instant it serves at (cmd/api/meta.go:125 and :174), so a ` +
          `body may choose its INSTANTS freely and may never choose its AGES.`,
      );
    }
  }
  return { where, resolution: "checked", detail: `checked: ${named}`, failures };
};

/**
 * Every clock-bearing object under `node`, classified. `served_at` is inherited
 * downward: a batch envelope and its watermark vector are nested inside the body
 * that stamps them, and production measures their ages from that one instant.
 *
 * @returns {{where: string, resolution: string, detail: string, failures?: string[]}[]}
 */
export const clockCandidates = (node, where = "$", servedAt = null, out = []) => {
  if (Array.isArray(node)) {
    node.forEach((entry, i) => clockCandidates(entry, `${where}[${i}]`, servedAt, out));
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
    clockCandidates(node[key], `${where}.${key}`, served, out);
  }
  return out;
};

/**
 * The generator-facing entry point: walk one emitted body and return what the
 * law found. `failures` non-empty means the body may not be written.
 *
 * @param {unknown} body
 * @returns {{checked: number, resolutions: string[], failures: string[]}}
 */
export const checkClocks = (body) => {
  const found = clockCandidates(body);
  const failures = [];
  let checked = 0;
  for (const candidate of found) {
    if (candidate.resolution === "checked") {
      checked += 1;
      failures.push(...(candidate.failures ?? []));
      continue;
    }
    if (candidate.resolution === "mixed" || candidate.resolution === "unresolved") {
      failures.push(`${candidate.where}: ${candidate.detail}`);
    }
  }
  return { checked, resolutions: found.map((c) => `${c.where} ${c.detail}`), failures };
};
