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
