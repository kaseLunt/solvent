import { expect, test } from "@playwright/test";
import { parseRecents, pushRecent, RECENT_MAX } from "../../lib/recent-lookups";

const A = "0xAAaA000000000000000000000000000000000001";
const B = "0xBBbB000000000000000000000000000000000002";

test("parseRecents keeps only valid addresses from a JSON array, and refuses anything else", () => {
  expect(parseRecents(JSON.stringify([A, "nope", 7, B]))).toEqual([A, B]);
  expect(parseRecents("not json")).toEqual([]);
  expect(parseRecents(JSON.stringify({ a: 1 }))).toEqual([]);
  expect(parseRecents(null)).toEqual([]);
});

test("pushRecent moves a repeat to the front, dedupes, and caps at RECENT_MAX", () => {
  expect(pushRecent([B, A], A)).toEqual([A, B]);
  const many = Array.from({ length: 10 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
  expect(pushRecent(many, A)).toHaveLength(RECENT_MAX);
  expect(pushRecent(many, A)[0]).toBe(A);
});
