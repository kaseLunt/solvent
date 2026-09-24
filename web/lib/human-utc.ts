/**
 * An instant, in one of two registers, from the ISO string's OWN UTC fields — the text is parsed, never handed to a
 * `Date`: no browser zone, no browser clock, no locale formatter can move the hour or the day a reader is told.
 *
 * Reader altitude (headline, dek, chip, tile sub, card caption, chart axis end) is `humanUtc`:
 * `2026-08-08T20:00:00Z` reads `Aug 8, 20:00 UTC`, seconds dropped. A table column or record field is `exactUtc`,
 * which keeps every wire field — seconds, and any fraction of a second the wire carries — and typesets only the `T`
 * and the `Z`: `2026-08-08 20:21:05 UTC`. It invents none either: an instant stated to the minute prints to the
 * minute. The wire ISO string itself appears only in a title attribute and in the evidence drawer. A malformed
 * instant prints verbatim everywhere.
 *
 * `humanUtc` prints the year (`Aug 8, 2025, 20:00 UTC`) exactly when it is not the year of `referenceIso` — the
 * `served_at` of the envelope that carried the instant. With no reference, or a reference that is not itself a
 * well-formed UTC instant, the year always prints: an instant is never left to a year the caller could not name.
 *
 * The tokens are joined with U+00A0 (NO-BREAK SPACE), never U+0020, so the instant cannot break mid-phrase at a
 * line end. A pin compares the exact string, no-break spaces included.
 *
 * A string that is not a well-formed UTC instant — an offset other than `Z`, a month 13, a Feb 30, an hour 24, a
 * date alone — is returned VERBATIM: a malformed instant is never repaired, shifted or reformatted into a time the
 * wire did not state.
 */

const NBSP = " ";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `YYYY-MM-DDTHH:MM[:SS[.fraction]]Z` — upper-case `T` and `Z` only, the wire's own form. */
const UTC_INSTANT = /^((\d{4})-(\d{2})-(\d{2}))T((\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)Z$/;

interface UtcFields {
  /** The four digits as written — printed and compared as text, never re-rendered from a number. */
  readonly year: string;
  readonly month: number;
  readonly day: number;
  readonly hour: string;
  readonly minute: string;
  /** `YYYY-MM-DD`, as written. */
  readonly date: string;
  /** Everything between the `T` and the `Z`, as written: `HH:MM`, `HH:MM:SS` or `HH:MM:SS.fraction`. */
  readonly clock: string;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** The instant's own fields, or null when the text is not a well-formed UTC instant. */
function utcFields(iso: string): UtcFields | null {
  const match = UTC_INSTANT.exec(iso);
  if (match === null) return null;
  const [, date = "", year = "", mo = "", d = "", clock = "", hour = "", minute = "", second = "00"] = match;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(Number(year), month)) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  return { year, month, day, hour, minute, date, clock };
}

/** The wire's own UTC fields, joined with U+00A0; the year by `referenceIso`; text that is no UTC instant verbatim. */
export function humanUtc(iso: string, referenceIso?: string): string {
  const fields = utcFields(iso);
  if (fields === null) return iso;
  const reference = referenceIso === undefined ? null : utcFields(referenceIso);
  const date = `${MONTHS[fields.month - 1] ?? ""}${NBSP}${String(fields.day)},`;
  const year = reference !== null && reference.year === fields.year ? [] : [`${fields.year},`];
  return [date, ...year, `${fields.hour}:${fields.minute}`, "UTC"].join(NBSP);
}

/**
 * The instant a column or record field states: every wire field, the `T` a no-break space and the `Z` spelled `UTC`
 * — `2026-08-08 20:21:05 UTC`. `zone: false` leaves the zone word to a header that names it (`When (UTC)`). Text that
 * is no UTC instant is returned verbatim.
 */
export function exactUtc(iso: string, options: { readonly zone?: boolean } = {}): string {
  const fields = utcFields(iso);
  if (fields === null) return iso;
  const instant = `${fields.date}${NBSP}${fields.clock}`;
  return options.zone === false ? instant : `${instant}${NBSP}UTC`;
}
