// p1b-9 (Codex round, finding 3): the render-synchronous ownership mask for a
// scope-keyed cursor walk (`scopedRows`, lib/pagination.ts).
//
// THE DEFECT: the Inspector's activity reset is EFFECT-timed (p1b-6 fix 5's
// drop-and-restart), so on an A→B component reuse the first B render still
// held A's accumulated rows — one frame of another address's activity under
// B's head. The mask derives the rendered rows at render time: rows pass
// through ONLY while the walk's dispatched scope is the scope being rendered.
//
// RECORDED CHOICE (per brief): the A→B reuse is remount-dependent in the real
// router — e2e navigation between two inspector addresses is a full-document
// load here, so the reuse frame cannot be produced from outside. The pin is
// therefore the mask's own law at the unit level, and the mutation kill
// (mask removed → rows pass through unconditionally) dies at the
// mismatched-scope pin below. The pass-through arm is exercised by every
// existing inspector activity e2e (rows visibly render when the scope
// matches), so a mask inverted or over-eager dies there instead.

import { expect, test } from "@playwright/test";
import { scopedRows } from "../../lib/pagination";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const ROWS = [{ tx: "0xaaa" }, { tx: "0xbbb" }] as const;

test("p1b-9: rows pass through — identically, uncopied — when the walk's scope IS the rendered scope", () => {
  expect(scopedRows(A, A, ROWS)).toBe(ROWS);
});

test("p1b-9: another address's rows NEVER render under this one — the mask derives empty, not A's data", () => {
  // The A→B reuse frame: the walk was dispatched for A, the render is for B,
  // and the reset that will drop A's rows has not run yet. The mask must
  // already answer with the empty walk.
  expect(scopedRows(A, B, ROWS)).toEqual([]);
});

test("p1b-9: an undispatched walk (scope null) renders the empty walk", () => {
  // First render of a fresh mount: no walk has been dispatched for ANY
  // address yet, so no row can claim an owner.
  expect(scopedRows(null, B, ROWS)).toEqual([]);
});
