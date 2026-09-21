// web/lib/prose.ts
// The two prose helpers every Inspector module needs and none may own twice:
// an "a, b and c" joiner (no Oxford comma) and en-US digit grouping for a
// printed integer. Words and counts only — no money, no percent and no wire
// scalar is formatted here; those have their own guarded modules.

/** "a" · "a and b" · "a, b and c" · "" for an empty list. */
export function joinAnd(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** An integer with en-US thousands grouping: 18251 → "18,251". A bigint groups the same way. */
export function groupInt(value: number | bigint): string {
  return value.toLocaleString("en-US");
}

/** A grouped count with its noun, singular exactly at one: "1 liquidation", "1,200 chain actions", "0 hours". */
export function plural(n: number, noun: string): string {
  return `${groupInt(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * An engine as a SENTENCE names it, in one phrasing: Cash by its name, the legacy market with its article and its
 * qualifier first ("the legacy Aave v3 market") — the label form, "Aave v3 market (legacy)", reads as a label and
 * stays on chips, kickers and switches. An engine this product does not name prints as the wire's own id, never as
 * one of the two. The ids are the contract's (`debt_manager`, `aave_v3_etherfi`), welded to the app's constants by
 * this module's unit spec: it cannot import them without importing its own importers.
 */
export function engineInProse(wire: string): string {
  if (wire === "debt_manager") return "Cash";
  if (wire === "aave_v3_etherfi") return "the legacy Aave v3 market";
  return wire;
}
