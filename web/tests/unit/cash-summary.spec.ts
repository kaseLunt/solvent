// summarizeCash — the one derivation both the Book and the Overview strip
// print from (spec 2026-09-15 §5.1, §5.2). Rows come from the committed DM
// page through the client's own refinement, exactly as the hook reads them.
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { readCashRow, type SizedCashRow } from "../../lib/cash-rows";
import type { WalkStopKind } from "../../lib/book-headline";
import { NEAR_CAP_BAND_IDS } from "../../lib/cash-rows";
import {
  attentionEmptyText,
  attentionFinding,
  bandsFinding,
  bandsSoFar,
  belowLineToggleLabel,
  bookBars,
  liquidatableTile,
  liquidatableTileLabel,
  liquidatableTileSub,
  medianRoomTile,
  nearCapTile,
  nearCapToggleLabel,
  overviewLiveLine,
  summarizeCash,
  tileBoundNote,
  unavailableHeadline,
  unreadableHeadline,
  walkEntryLine,
  walkQualifier,
} from "../../lib/cash-summary";
import { POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { DEMO_POSITIONS_DM_PAGE_1, DEMO_POSITIONS_DM_PAGE_2 } from "../fixtures/demo";

const rows = POSITIONS_DM_PAGE_1.positions.map((p) => readCashRow(refinePositionSummary(p)));
const settled = { walkComplete: true, walkStopped: null, walkStopKind: null, refusedWhole: null } as const;

test("the committed DM page: one material liquidatable row, one refused", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  expect(s.headline.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(s.headline.rest).toBe(" across 1 account.");
  expect(s.material).toEqual({ sum: 4_200_000_000n, count: 1 });
  expect(s.belowLine).toEqual({ sum: 0n, count: 0 });
  expect(s.nearCap).toEqual({ sum: 0n, count: 0 });
  expect(s.notComputed).toBe(1);
  expect(s.unreadable).toBe(0);
  expect(s.computed).toBe(1);
  expect(s.settled).toBe(true);
  expect(s.whole).toBe(true);
  expect(s.stopped).toBeNull();
  expect(s.bands.reduce((n, b) => n + b.count, 0)).toBe(1);
});

test("a whole-engine refusal yields the refused headline with the plain cause", () => {
  const s = summarizeCash({
    rows: [],
    decimals: 6,
    refusedPositions: 0,
    walkComplete: true,
    walkStopped: null, walkStopKind: null,
    refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: null },
  });
  expect(s.headline.variant).toBe("refused");
  expect(s.headline.dek).toBe("Collateral-flag custody unproven.");
});

test("an unfinished walk is not settled and headlines the positive it has, as a lower bound", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(s.settled).toBe(false);
  expect(s.headline.variant).toBe("material");
  expect(s.headline.dek).toContain("every figure is a lower bound");
});

test("an unfinished walk with no rows is pending — never a quiet verdict, never a near-cap negative", () => {
  const s = summarizeCash({ rows: [], decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(s.headline.variant).toBe("pending");
  expect(s.headline.emphasis).toBe("Walking the Cash book…");
  expect(s.headline.dek).not.toContain("No account is within 10%");
  expect(s.headline.dek).not.toContain("No account is liquidatable");
});

test("a stopped walk is named on the summary and in the headline; a complete walk carries no stop", () => {
  const s = summarizeCash({ rows: [], decimals: 6, refusedPositions: 0, walkComplete: false, walkStopped: "Failed to fetch", walkStopKind: "before-end", refusedWhole: null });
  expect(s.stopped).toBe("Failed to fetch");
  expect(s.settled).toBe(false);
  expect(s.headline.variant).toBe("refused");
  expect(s.headline.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(s.headline.dek).toContain("Failed to fetch");
  const done = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: true, walkStopped: "stale", walkStopKind: "before-end", refusedWhole: null });
  expect(done.stopped).toBeNull();
  expect(done.headline.variant).toBe("material");
});

test("the attention table's empty line never clears the book over an unfinished walk, an unreadable row or a hidden liquidatable position — and a stopped walk is framed by how it ended", () => {
  const nothing = { belowLine: { sum: 0n, count: 0 }, decimals: 6, stopKind: null, unreadable: 0 };
  expect(attentionEmptyText({ settled: true, stopped: null, ...nothing })).toBe("No account needs attention.");
  expect(attentionEmptyText({ settled: false, stopped: null, ...nothing })).toBe("Walking the book…");
  expect(attentionEmptyText({ settled: false, stopped: "Failed to fetch", ...nothing, stopKind: "before-end" })).toBe(
    "The walk stopped before the last page; no account is cleared.",
  );
  // "Before the last page" is said only of a walk that never read it: the other endings wear their own frame.
  expect(attentionEmptyText({ settled: false, stopped: "short", ...nothing, stopKind: "at-end" })).toBe(
    "The walk reached its last page and its rows do not reconcile with the census; no account is cleared.",
  );
  expect(attentionEmptyText({ settled: false, stopped: "past", ...nothing, stopKind: "over" })).toBe("The walk ran past its census; no account is cleared.");
  expect(attentionEmptyText({ settled: false, stopped: "twice", ...nothing, stopKind: "duplicate" })).toBe(
    "The walk was served an account twice; no account is cleared.",
  );
  // A complete walk over a row this page could not read clears nobody.
  expect(attentionEmptyText({ settled: true, stopped: null, ...nothing, unreadable: 2 })).toBe("2 rows could not be read; no account is cleared.");
  expect(attentionEmptyText({ settled: true, stopped: null, ...nothing, belowLine: { sum: 50_000_000n, count: 1 } })).toBe(
    "Nothing material needs attention; 1 liquidatable account under $100 ($50) is folded under the toggle below.",
  );
  expect(attentionEmptyText({ settled: true, stopped: null, ...nothing, belowLine: { sum: 61_500_000n, count: 3 } })).toBe(
    "Nothing material needs attention; 3 liquidatable accounts under $100 ($61.50) are folded under the toggle below.",
  );
});

test("the distance chart's finding: settled it states the figure; over an incomplete walk — still running or stopped — the figure AND the bars each wear the lower-bound qualifier, and a walk-derived zero is a dash", () => {
  const first = POSITIONS_DM_PAGE_1.positions[0];
  if (first === undefined) throw new Error("fixture invariant: the committed page serves a row");
  // Room 184 under a cap of 4,804: the 2–5% band, not liquidatable.
  const near = readCashRow(
    refinePositionSummary({
      ...first,
      account: "0xnear",
      status: "computed",
      refusal: null,
      liquidatable: false,
      health_factor: { wad: null, num: "4804000000", den: "4620000000", infinite: false, note: "" },
      total_debt: "4620000000",
    }),
  );
  expect(near.band).toBe(2);
  const LEAD = "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ";
  const of = (input: { rows: typeof rows; walkComplete: boolean; walkStopped: string | null; walkStopKind: WalkStopKind | null }) =>
    bandsFinding(summarizeCash({ decimals: 6, refusedPositions: 0, refusedWhole: null, ...input }));

  // Settled: the figure stands alone, a settled zero is a finding, and nothing is qualified.
  expect(of({ rows: [near], walkComplete: true, walkStopped: null, walkStopKind: null })).toEqual({
    lead: LEAD,
    figure: "$4,620",
    rest: " sits within 10% of the cap",
    barsNote: null,
  });
  expect(of({ rows, walkComplete: true, walkStopped: null, walkStopKind: null })).toMatchObject({ lead: LEAD, figure: "$0", rest: " sits within 10% of the cap", barsNote: null });

  // Still running, a positive read: the figure is a floor in its own words, and the bars say so themselves.
  expect(of({ rows: [near], walkComplete: false, walkStopped: null, walkStopKind: null })).toEqual({
    lead: `${LEAD}at least `,
    figure: "$4,620",
    rest: " sits within 10% of the cap · walking the book, figures are a lower bound",
    barsNote: "Walking the book: every bar and every count is a lower bound over the accounts read so far.",
  });
  // Stopped, a positive read: the same two qualifiers, in the stopped register.
  expect(of({ rows: [near], walkComplete: false, walkStopped: "Failed to fetch", walkStopKind: "before-end" })).toEqual({
    lead: `${LEAD}at least `,
    figure: "$4,620",
    rest: " sits within 10% of the cap · the walk stopped, figures are a lower bound",
    barsNote: "The walk stopped: every bar and every count is a lower bound over the accounts it read.",
  });
  // A walk-derived zero is never "$0" before the walk ends — in either register — and the clause after the dash
  // names the walk's state: it never qualifies ("figures are a lower bound") a figure the sentence declined to print.
  const running = of({ rows, walkComplete: false, walkStopped: null, walkStopKind: null });
  expect(running.rest).toBe(" within 10% of the cap: a zero is claimed only by a complete walk · the walk is still running");
  const halted = of({ rows, walkComplete: false, walkStopped: "Failed to fetch", walkStopKind: "before-end" });
  expect(halted.rest).toBe(" within 10% of the cap: a zero is claimed only by a complete walk · the walk stopped");
  for (const zero of [running, halted]) {
    expect(zero.figure).toBe("—");
    expect(zero.rest).not.toContain("lower bound");
    expect(zero.barsNote).not.toBeNull();
    expect(`${zero.lead}${zero.figure}${zero.rest}`).not.toContain("$0");
  }
});

test("a walk past its census claims no bound anywhere: it landed more accounts than the census counts — never 'at least', never 'lower bound'; a walk short at its last page still does", () => {
  const first = POSITIONS_DM_PAGE_1.positions[0];
  if (first === undefined) throw new Error("fixture invariant: the committed page serves a row");
  const near = readCashRow(
    refinePositionSummary({
      ...first,
      account: "0xnear",
      status: "computed",
      refusal: null,
      liquidatable: false,
      health_factor: { wad: null, num: "4804000000", den: "4620000000", infinite: false, note: "" },
      total_debt: "4620000000",
    }),
  );
  const past = "the walk delivered 2 rows for a census of 1";
  const summary = (walkStopKind: WalkStopKind, input: typeof rows) =>
    summarizeCash({ rows: input, decimals: 6, refusedPositions: 0, refusedWhole: null, walkComplete: false, walkStopped: past, walkStopKind });
  const over = summary("over", [near, { ...near, account: "0xnear2" }]);
  expect(over.stopKind).toBe("over");
  const finding = bandsFinding(over);
  expect(finding).toEqual({
    lead: "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ",
    figure: "$9,240",
    rest: " sits within 10% of the cap among the rows the walk landed · the walk ran past its census, figures are not a bound",
    barsNote: "The walk ran past its census: it landed more accounts than the book counts, so no bar or count here is a total or a lower bound.",
  });
  expect(bandsFinding(summary("over", rows)).rest).toBe(" within 10% of the cap: a zero is claimed only by a complete walk · the walk ran past its census");
  expect(walkQualifier(over)).toBe(" · the walk ran past its census, figures are not a bound");
  expect(tileBoundNote(over)).toBe(" · not a bound, the walk ran past its census");
  expect(attentionFinding(over)).toBe("Material first, then by room · the walk ran past its census, figures are not a bound");
  expect(over.headline.dek).toContain("The walk ran past its census (the walk delivered 2 rows for a census of 1)");
  for (const words of [finding.lead, finding.rest, finding.barsNote ?? "", walkQualifier(over), tileBoundNote(over), over.headline.dek]) {
    expect(words).not.toMatch(/at least|a lower bound over|are a lower bound|· lower bound/);
    // Identities are tracked across the walk, so a walk past its census repeated no account — and never says it may have.
    expect(words).not.toContain("count an account twice");
  }
  // Short at its last page: the rows are distinct accounts, so the floor stands — and the frame says the walk reached its end.
  const short = summary("at-end", [near]);
  expect(bandsFinding(short).lead).toMatch(/at least $/);
  expect(tileBoundNote(short)).toBe(" · lower bound, walk stopped");
  expect(short.headline.dek).toContain("The walk reached its last page and its rows do not reconcile with the census");
  // A complete walk carries no stop kind, whatever the input held.
  expect(summarizeCash({ rows, decimals: 6, refusedPositions: 1, refusedWhole: null, walkComplete: true, walkStopped: past, walkStopKind: "over" }).stopKind).toBeNull();
});

test("the tiles' bound note and the attention card's finding speak in the walk's registers; the near-cap bands have one definition", () => {
  expect(tileBoundNote(null)).toBe("");
  expect(tileBoundNote({ settled: true, stopped: null, stopKind: null, unreadable: 0 })).toBe("");
  expect(tileBoundNote({ settled: false, stopped: null, stopKind: null, unreadable: 0 })).toBe(" · lower bound, walking");
  expect(tileBoundNote({ settled: false, stopped: "Failed to fetch", stopKind: "before-end", unreadable: 0 })).toBe(" · lower bound, walk stopped");
  expect(attentionFinding(null)).toBe("Material first, then by room");
  expect(attentionFinding({ settled: true, stopped: null, stopKind: null, unreadable: 0 })).toBe("Material first, then by room");
  expect(attentionFinding({ settled: false, stopped: null, stopKind: null, unreadable: 0 })).toBe("Material first, then by room · walking the book, figures are a lower bound");
  expect([...NEAR_CAP_BAND_IDS]).toEqual(["0-2", "2-5", "5-10"]);
});

test("the distance chart's bars keep the card's own law: a band the walk has read nothing in is unknown so far — no figure, no count — and only a complete walk prints a zero", () => {
  // The committed page: one liquidatable row ($4,200, the breached band), one refused row in no band.
  const of = (walkComplete: boolean, walkStopped: string | null = null) =>
    bandsSoFar(summarizeCash({ rows, decimals: 6, refusedPositions: 1, refusedWhole: null, walkComplete, walkStopped, walkStopKind: walkStopped === null ? null : "before-end" }));
  const settled = of(true);
  expect(settled.map((b) => b.id)).toEqual(["breached", "0-2", "2-5", "5-10", "10-25", "25-50", "50-plus"]);
  // Complete: every band is the book's, and a zero is a finding.
  expect(settled[0]).toMatchObject({ id: "breached", count: 1, debt: 4_200_000_000n });
  for (const band of settled.slice(1)) expect(band).toMatchObject({ count: 0, debt: 0n });
  // Still running, and stopped: the positive read so far prints as read; every unread band is unknown so far.
  for (const unsettled of [of(false), of(false, "Failed to fetch")]) {
    expect(unsettled.map((b) => b.id)).toEqual(settled.map((b) => b.id));
    expect(unsettled.map((b) => b.label)).toEqual(settled.map((b) => b.label));
    expect(unsettled[0]).toMatchObject({ id: "breached", count: 1, debt: 4_200_000_000n });
    for (const band of unsettled.slice(1)) expect(band).toMatchObject({ count: null, debt: null });
  }
  // No page landed: nothing is known of any band.
  const pending = bandsSoFar(summarizeCash({ rows: [], decimals: 6, refusedPositions: 0, refusedWhole: null, walkComplete: false, walkStopped: null, walkStopKind: null }));
  expect(pending).toHaveLength(7);
  for (const band of pending) expect(band).toMatchObject({ count: null, debt: null });
  // Accounts read with no debt between them: the count is a positive read, the dollars are still not a claimed zero.
  const debtless = bandsSoFar({ whole: false, computed: 3, notComputed: 0, bands: [{ id: "50-plus", label: "≥50%", count: 3, debt: 0n }] });
  expect(debtless).toEqual([{ id: "50-plus", label: "≥50%", count: 3, debt: null }]);
});

test("the walk qualifier: nothing over a settled or unloaded book, the running and the stopped register otherwise", () => {
  expect(walkQualifier(null)).toBe("");
  expect(walkQualifier({ settled: true, stopped: null, stopKind: null, unreadable: 0 })).toBe("");
  expect(walkQualifier({ settled: false, stopped: null, stopKind: null, unreadable: 0 })).toBe(" · walking the book, figures are a lower bound");
  expect(walkQualifier({ settled: false, stopped: "Failed to fetch", stopKind: "before-end", unreadable: 0 })).toBe(" · the walk stopped, figures are a lower bound");
  expect(walkQualifier({ settled: false, stopped: "the walk delivered 3 of the 5 rows the wire advertised", stopKind: "at-end", unreadable: 0 })).toBe(" · the walk stopped, figures are a lower bound");
  // The running and the stopped registers keep their own words over an unreadable row: the walk's state is said first.
  expect(walkQualifier({ settled: false, stopped: null, stopKind: null, unreadable: 1 })).toBe(" · walking the book, figures are a lower bound");
  expect(walkQualifier({ settled: false, stopped: "Failed to fetch", stopKind: "before-end", unreadable: 1 })).toBe(" · the walk stopped, figures are a lower bound");
});

// ---------------------------------------------------------------------------
// An unreadable computed row: the engine computed it, this page cannot read it.
// ---------------------------------------------------------------------------

const firstRow = POSITIONS_DM_PAGE_1.positions[0];
if (firstRow === undefined) throw new Error("fixture invariant: the committed page serves a row");
const readable = { status: "computed", refusal: null, health_factor: { wad: null, num: "10000000000", den: "5000000000", infinite: false, note: "" }, total_debt: "5000000000" } as const;
/** `status: "computed"`, `liquidatable: true`, and a debt the decimal guard refuses — the row a false all-clear was said over. */
const unreadable = readCashRow(refinePositionSummary({ ...firstRow, account: "0xbad", status: "computed", refusal: null, liquidatable: true, total_debt: "1e6" }));
const far = readCashRow(refinePositionSummary({ ...firstRow, ...readable, account: "0xfar", liquidatable: false }));
const NEGATIVES = /Nothing material is liquidatable|No account is liquidatable|No computed account is liquidatable|No account is within 10%|No account needs attention/;

test("an unreadable computed row is counted and blocks every all-clear: no quiet headline, no 'No account is liquidatable', no near-cap negative — over a COMPLETE walk whose aggregate refused nothing", () => {
  expect(unreadable.computed).toBe(false);
  const s = summarizeCash({ rows: [unreadable, far], decimals: 6, refusedPositions: 0, ...settled });
  expect(s.unreadable).toBe(1);
  expect(s.notComputed).toBe(0);
  expect(s.computed).toBe(1);
  expect(s.settled).toBe(true);
  expect(s.whole).toBe(false);
  expect(s.headline.variant).toBe("refused");
  expect(s.headline.tone).toBe("absent");
  expect(s.headline.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(s.headline.dek).toBe("1 account the engine calls computed could not be read by this page. No verdict is claimed over it.");
  expect(`${s.headline.emphasis} ${s.headline.dek}`).not.toMatch(NEGATIVES);
  // Never worded as the engine's refusal: the engine refused nothing.
  expect(s.headline.dek).not.toMatch(/refus|could not be computed/i);
  // Alone on the book it is still not "No Cash account could be computed": the engine computed it.
  const alone = summarizeCash({ rows: [unreadable], decimals: 6, refusedPositions: 0, ...settled });
  expect(alone.headline.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(`${alone.headline.emphasis} ${alone.headline.dek}`).not.toMatch(NEGATIVES);
  // Beside refused positions both are counted, each in its own sentence.
  const both = summarizeCash({ rows: [unreadable, unreadable, far], decimals: 6, refusedPositions: 2, ...settled });
  expect(both.headline.dek).toBe(
    "2 accounts the engine calls computed could not be read by this page. No verdict is claimed over them. " +
      "2 accounts have no verdict in this batch.",
  );
});

test("beside an unreadable row a positive finding stands as a lower bound, and no negative rides with it", () => {
  const s = summarizeCash({ rows: [...rows, unreadable], decimals: 6, refusedPositions: 1, ...settled });
  expect(s.headline.variant).toBe("material");
  expect(s.headline.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(s.headline.dek).toBe(
    "1 account has no verdict in this batch. " +
      "1 account the engine calls computed could not be read by this page. " +
      "Every figure is a lower bound over the 1 computed account this page could read.",
  );
  expect(s.headline.dek).not.toMatch(NEGATIVES);
  // The same rows read whole keep the near-cap negative: it is the unreadable row that withholds it.
  expect(summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled }).headline.dek).toContain("No account is within 10% of its borrow cap.");
});

test("over an unreadable row no zero is a finding and no sum a total: the tiles' note, the bars, the distance finding, the table's empty line and the entry card all say lower bound — a complete walk is settled, and not whole", () => {
  const s = summarizeCash({ rows: [unreadable, far], decimals: 6, refusedPositions: 0, ...settled });
  expect(tileBoundNote(s)).toBe(" · lower bound, 1 row unreadable");
  expect(walkQualifier(s)).toBe(" · 1 row could not be read, figures are a lower bound");
  expect(attentionFinding(s)).toBe("Material first, then by room · 1 row could not be read, figures are a lower bound");
  expect(attentionEmptyText(s)).toBe("1 row could not be read; no account is cleared.");
  expect(walkEntryLine(s)).toBe("1 row of the book could not be read");
  // The bars: the band read in prints what was read; every other band is unknown — never "$0 · 0".
  const bars = bandsSoFar(s);
  expect(bars.find((b) => b.id === "50-plus")).toMatchObject({ count: 1, debt: 5_000_000_000n });
  for (const band of bars.filter((b) => b.id !== "50-plus")) expect(band).toMatchObject({ count: null, debt: null });
  // The finding: a walk-derived zero is a dash, and the clause names the unreadable row — the walk itself is complete.
  expect(bandsFinding(s)).toEqual({
    lead: "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ",
    figure: "—",
    rest: " within 10% of the cap: a zero is claimed only over a book read whole · 1 row could not be read",
    barsNote: "1 row could not be read: every bar and every count is a lower bound over the accounts this page could read.",
  });
  // A positive read is a floor in its own words.
  const near = readCashRow(refinePositionSummary({ ...firstRow, ...readable, account: "0xnear", liquidatable: false, health_factor: { ...readable.health_factor, num: "4804000000", den: "4620000000" }, total_debt: "4620000000" }));
  const positive = bandsFinding(summarizeCash({ rows: [unreadable, unreadable, near], decimals: 6, refusedPositions: 0, ...settled }));
  expect(positive.lead).toMatch(/at least $/);
  expect(positive.rest).toBe(" sits within 10% of the cap · 2 rows could not be read, figures are a lower bound");
  // Read whole, the same book claims its zeros and its total.
  const whole = summarizeCash({ rows: [far], decimals: 6, refusedPositions: 0, ...settled });
  expect(whole.whole).toBe(true);
  expect(tileBoundNote(whole)).toBe("");
  expect(bandsFinding(whole).figure).toBe("$0");
  expect(walkEntryLine(whole)).toBe("$0 within 10% of cap");
  expect(whole.headline.emphasis).toBe("Nothing material is liquidatable on the Cash book right now.");
});

test("an unreadable row is stated as soon as it lands: a running and a stopped walk count it in the dek beside their own registers", () => {
  const running = summarizeCash({ rows: [unreadable], decimals: 6, refusedPositions: 0, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(running.headline.variant).toBe("pending");
  expect(running.headline.dek).toContain("1 account the engine calls computed could not be read by this page.");
  expect(tileBoundNote(running)).toBe(" · lower bound, walking");
  const stopped = summarizeCash({ rows: [unreadable], decimals: 6, refusedPositions: 0, walkComplete: false, walkStopped: "Failed to fetch", walkStopKind: "before-end", refusedWhole: null });
  expect(stopped.headline.dek).toContain("1 account the engine calls computed could not be read by this page.");
  expect(tileBoundNote(stopped)).toBe(" · lower bound, walk stopped");
});

test("the demo walk is read whole: not one unreadable row, so its settled rendering carries no qualifier", () => {
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const s = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(s.unreadable).toBe(0);
  expect(s.whole).toBe(true);
  expect(tileBoundNote(s)).toBe("");
  expect(bandsFinding(s).barsNote).toBeNull();
});

test("the demo's refused rows carry no debt figure, as the engine serves a refusal: the dek sizes the blind spot in words — their debt is not known, never $0 and never summed — and one refused row served with a figure silences it", () => {
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const refused = demo.filter((r) => !r.computed);
  expect(refused).toHaveLength(6);
  for (const r of refused) expect(r.debt).toBeNull();
  const s = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(s.headline.dek).toContain("6 accounts have no verdict in this batch; their debt is not known.");
  expect(s.headline.dek).not.toMatch(/could not be computed this batch/);
  // The committed page's refused row is served with a debt figure: nothing is said about absence.
  const committed = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  expect(committed.headline.dek).toBe("No account is within 10% of its borrow cap. 1 account has no verdict in this batch.");
  // One refused row with a figure beside the demo's six: the clause would be false of it, so it is not said.
  const withFigure = rows.find((r) => !r.computed);
  if (withFigure === undefined || withFigure.debt === null) throw new Error("fixture invariant: the committed refused row carries a debt figure");
  const mixed = summarizeCash({ rows: [...demo, withFigure], decimals: 6, refusedPositions: 7, ...settled });
  expect(mixed.headline.dek).not.toContain("debt is not known");
  // No refused row landed yet: nothing is known of their debt, so nothing is said.
  const computedOnly = demo.filter((r) => r.computed);
  const early = summarizeCash({ rows: computedOnly, decimals: 6, refusedPositions: 6, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(early.headline.dek).toContain("6 accounts have no verdict in this batch.");
  expect(early.headline.dek).not.toContain("debt is not known");
  // A row the page could not read is not a refusal: its missing figure says nothing of the engine's refusals.
  const unreadableOnly = summarizeCash({ rows: [unreadable, far], decimals: 6, refusedPositions: 2, ...settled });
  expect(unreadableOnly.headline.dek).not.toContain("debt is not known");
});

test("a refused row served a debt this page cannot read — a malformed string or a JSON number — is a figure served, not a figure absent: the dek never says their debt is not served", () => {
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => refinePositionSummary(p));
  const refusedWire = demo.find((p) => p.status === "refused");
  if (refusedWire === undefined) throw new Error("fixture invariant: the demo serves a refused row");
  for (const served of ["1e6", 1500] as const) {
    const bad = readCashRow({ ...refusedWire, account: "0xmalformed", total_debt: served as unknown as string });
    expect(bad.computed).toBe(false);
    expect(bad.debt).toBeNull();
    const alone = summarizeCash({ rows: [bad], decimals: 6, refusedPositions: 1, ...settled });
    expect(alone.headline.dek).toContain("1 account has no verdict in this batch.");
    expect(alone.headline.dek).not.toContain("debt is not known");
    expect(alone.headline.dek).not.toContain("No debt figure is served");
    const beside = summarizeCash({ rows: [...demo.map(readCashRow), bad], decimals: 6, refusedPositions: 7, ...settled });
    expect(beside.headline.dek).not.toContain("debt is not known");
  }
});

/** The tile's inputs over a book read whole, and over a walk still running: the partition's counts, as summarizeCash states them. */
const partitionOf = (material: number, belowLine: number) => ({
  material: { sum: 4_620_000_000n * BigInt(material), count: material },
  belowLine: { sum: 2_330_000n * BigInt(belowLine), count: belowLine },
});
const populationOf = (material: number, belowLine: number) => ({ computed: material + belowLine, notComputed: 0 });
const wholeSummaryWith = (c: { material: number; belowLine: number }) => ({
  ...partitionOf(c.material, c.belowLine),
  ...populationOf(c.material, c.belowLine),
  whole: true,
});
const walkingSummaryWith = (c: { material: number; belowLine: number }) => ({
  ...partitionOf(c.material, c.belowLine),
  ...populationOf(c.material, c.belowLine),
  whole: false,
});

test("the liquidatable tile states the partition's total only over a book read whole", () => {
  expect(liquidatableTileLabel).toBe("Liquidatable · ≥ $100");
  expect(liquidatableTileSub(wholeSummaryWith({ material: 2, belowLine: 47 }), "")).toBe("2 accounts · 47 more under $100 · 49 in all");
  // mid-walk: no total is claimed; the bound note keeps its place
  expect(liquidatableTileSub(walkingSummaryWith({ material: 2, belowLine: 47 }), " · lower bound, walking")).toBe(
    "2 accounts · 47 more under $100 · lower bound, walking",
  );
  expect(liquidatableTileSub(wholeSummaryWith({ material: 1, belowLine: 0 }), "")).toBe("1 account · 0 more under $100 · 1 in all");
  // Every register short of a book read whole keeps its own note and claims no total.
  const first = POSITIONS_DM_PAGE_1.positions[0];
  if (first === undefined) throw new Error("fixture invariant: the committed page serves a row");
  const unreadableRow = readCashRow(refinePositionSummary({ ...first, account: "0xbad", status: "computed", refusal: null, liquidatable: true, total_debt: "1e6" }));
  const registers = [
    summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null }),
    summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: "Failed to fetch", walkStopKind: "before-end", refusedWhole: null }),
    summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: "past", walkStopKind: "over", refusedWhole: null }),
    summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: "twice", walkStopKind: "duplicate", refusedWhole: null }),
    summarizeCash({ rows: [...rows, unreadableRow], decimals: 6, refusedPositions: 1, ...settled }),
  ];
  for (const s of registers) {
    expect(s.whole).toBe(false);
    const sub = liquidatableTileSub(s, tileBoundNote(s));
    expect(sub).toBe(`1 account · 0 more under $100${tileBoundNote(s)}`);
    expect(sub).not.toContain("in all");
  }
  // The demo walk, read whole: the tile states the same 49 as the batch aggregate's liquidatable_positions.
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const read = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(liquidatableTileSub(read, tileBoundNote(read))).toBe("2 accounts · 47 more under $100 · 49 in all");
});

test("the liquidatable tile states no total over nothing computed, and no zero total a refused account could sit inside", () => {
  const refusedRow = rows.find((r) => !r.computed);
  if (refusedRow === undefined) throw new Error("fixture invariant: the committed page serves a refused row");
  // A walk read whole over rows the engine refused one by one (every account SWEEP_NEVER on a fresh deploy): nothing
  // was computed, the headline declines any verdict, and no walk-derived tile prints a figure or a count — a zero over
  // nothing computed counts nothing. Each says what happened instead, in the refused register.
  const noneComputed = summarizeCash({ rows: [refusedRow], decimals: 6, refusedPositions: 1, ...settled });
  expect(noneComputed.whole).toBe(true);
  expect(noneComputed.computed).toBe(0);
  expect(noneComputed.headline.emphasis).toBe("No Cash account could be computed this batch.");
  expect(liquidatableTileSub(noneComputed, tileBoundNote(noneComputed))).toBe("No account computed");
  expect(liquidatableTile(noneComputed)).toEqual({ value: "", sub: "No account computed", tone: "refused", pending: false, state: "refused", stateWord: "No verdict" });
  expect(nearCapTile(noneComputed)).toEqual({ value: "", sub: "No account computed", tone: "refused", pending: false, state: "refused", stateWord: "No verdict" });
  expect(walkEntryLine(noneComputed)).toBe("No account could be computed this batch");
  const said = [liquidatableTile(noneComputed), nearCapTile(noneComputed)].flatMap((t) => [t.value, t.sub]);
  for (const words of [...said, walkEntryLine(noneComputed)]) expect(words).not.toMatch(/\$0|\b0 accounts?\b|\b0 more\b|—/);
  // A book with nothing in it computed nothing either: no total is stated over it — and, nothing refused, its zero is
  // the book's own finding, as the headline says it.
  const empty = summarizeCash({ rows: [], decimals: 6, refusedPositions: 0, ...settled });
  expect(empty.whole).toBe(true);
  expect(liquidatableTileSub(empty, tileBoundNote(empty))).toBe("0 accounts · 0 more under $100");
  expect(liquidatableTile(empty)).toEqual({ value: "$0", sub: "0 accounts · 0 more under $100", tone: "neutral", pending: false });
  expect(walkEntryLine(empty)).toBe("$0 within 10% of cap");
  // Computed accounts, none liquidatable, beside refused ones: the headline scopes its negative to the computed
  // positions, and the tile claims no zero total the refused accounts would sit inside.
  const zeroBesideRefused = summarizeCash({ rows: [far, refusedRow], decimals: 6, refusedPositions: 1, ...settled });
  expect(zeroBesideRefused.headline.dek).toContain("No computed account is liquidatable.");
  expect(liquidatableTileSub(zeroBesideRefused, tileBoundNote(zeroBesideRefused))).toBe("0 accounts · 0 more under $100");
  // Nothing refused: the zero is the book's own finding, as the headline says it unscoped.
  const zeroWhole = summarizeCash({ rows: [far], decimals: 6, refusedPositions: 0, ...settled });
  expect(zeroWhole.headline.dek).toContain("No account is liquidatable.");
  expect(liquidatableTileSub(zeroWhole, tileBoundNote(zeroWhole))).toBe("0 accounts · 0 more under $100 · 0 in all");
  // A positive total beside refused accounts still stands: it counts the positions the engine computed liquidatable.
  const committed = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  expect(liquidatableTileSub(committed, tileBoundNote(committed))).toBe("1 account · 0 more under $100 · 1 in all");
});

test("over a book the engine computed none of, the distance chart claims no zero: the figure is a dash, the finding and the bars say no account was computed, and no bar prints '$0 · 0'", () => {
  const refusedRow = rows.find((r) => !r.computed);
  if (refusedRow === undefined) throw new Error("fixture invariant: the committed page serves a refused row");
  const LEAD = "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ";
  // Read whole, every account refused on its own: the bands group computed accounts only, so each band's zero counts
  // nothing — the tiles beside the chart already refuse that zero, and the chart says the same.
  const noneComputed = summarizeCash({ rows: [refusedRow], decimals: 6, refusedPositions: 1, ...settled });
  expect(noneComputed.whole).toBe(true);
  const finding = bandsFinding(noneComputed);
  expect(finding).toEqual({
    lead: LEAD,
    figure: "—",
    rest: " within 10% of the cap: no account computed",
    barsNote: "No account was computed this batch: the bands group computed accounts only, so no bar holds a figure or a count.",
  });
  expect(`${finding.lead}${finding.figure}${finding.rest}${finding.barsNote ?? ""}`).not.toMatch(/\$0|\b0 accounts?\b/);
  const bars = bandsSoFar(noneComputed);
  expect(bars.map((b) => b.id)).toEqual(["breached", "0-2", "2-5", "5-10", "10-25", "25-50", "50-plus"]);
  for (const band of bars) expect(band).toMatchObject({ count: null, debt: null });
  // An empty book refused nothing: its zeros are the book's own findings, bars and figure alike.
  const empty = summarizeCash({ rows: [], decimals: 6, refusedPositions: 0, ...settled });
  expect(bandsFinding(empty)).toEqual({ lead: LEAD, figure: "$0", rest: " sits within 10% of the cap", barsNote: null });
  for (const band of bandsSoFar(empty)) expect(band).toMatchObject({ count: 0, debt: 0n });
  // Computed accounts beside a refused one: every band is the book's, zeros included, and nothing is qualified.
  const committed = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  expect(bandsFinding(committed)).toEqual({ lead: LEAD, figure: "$0", rest: " sits within 10% of the cap", barsNote: null });
  expect(bandsSoFar(committed).slice(1).every((b) => b.count === 0 && b.debt === 0n)).toBe(true);
});

test("the median room tile is the lib's decision: over a book the engine computed none of it is refused in the tiles' word — never the neutral dash of an empty book", () => {
  const refusedRow = rows.find((r) => !r.computed);
  if (refusedRow === undefined) throw new Error("fixture invariant: the committed page serves a refused row");
  const noneComputed = summarizeCash({ rows: [refusedRow], decimals: 6, refusedPositions: 1, ...settled });
  expect(medianRoomTile(noneComputed)).toEqual({ value: "", sub: "No account computed", tone: "refused", pending: false, state: "refused", stateWord: "No verdict" });
  // An empty book read whole holds no room to take a median of, and refused nothing: it says so, in ink — never a dash.
  const empty = summarizeCash({ rows: [], decimals: 6, refusedPositions: 0, ...settled });
  expect(medianRoomTile(empty)).toEqual({ value: "No accounts", sub: "No room to measure", tone: "neutral", pending: false });
  // Walking: the median so far, busy. Stopped: no figure, in the unavailable register, the stop said.
  const walking = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  const { median, p10 } = walking.percentiles;
  if (median === null || p10 === null) throw new Error("fixture invariant: the committed page serves a computed row");
  expect(medianRoomTile(walking)).toEqual({ value: median, sub: `Of borrow cap · 10th pct ${p10}`, tone: "neutral", pending: true });
  const stopped = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: "Failed to fetch", walkStopKind: "before-end", refusedWhole: null });
  // A walk that stopped refused nothing: the tile carries no refused tone.
  expect(medianRoomTile(stopped)).toEqual({ value: "", sub: "Walk stopped", tone: "neutral", pending: false, state: "unavailable" });
  // The demo walk, read whole: the tile the Book prints.
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const read = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(medianRoomTile(read)).toEqual({ value: read.percentiles.median, sub: `Of borrow cap · 10th pct ${read.percentiles.p10 ?? ""}`, tone: "neutral", pending: false });
  expect(medianRoomTile(read)).toMatchObject({ value: "53.9%", sub: "Of borrow cap · 10th pct 19.2%" });
});

test("the Book's walk tiles are the lib's decision in every register — the figure, its sub, its tone and its busy mark", () => {
  // Read whole: the positive in the crit register with the partition's total; a near-cap zero is a finding.
  const committed = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  expect(liquidatableTile(committed)).toEqual({ value: "$4,200", sub: "1 account · 0 more under $100 · 1 in all", tone: "crit", pending: false });
  expect(nearCapTile(committed)).toEqual({ value: "$0", sub: "0 accounts", tone: "neutral", pending: false });
  // Walking: a positive read so far stands as a lower bound; a zero is not yet a figure, and the tile is busy.
  const walking = summarizeCash({ rows, decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(liquidatableTile(walking)).toEqual({ value: "$4,200", sub: "1 account · 0 more under $100 · lower bound, walking", tone: "crit", pending: false });
  expect(nearCapTile(walking)).toEqual({ value: "", sub: "0 accounts · lower bound, walking", tone: "neutral", pending: true });
  const nothingYet = summarizeCash({ rows: [], decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(liquidatableTile(nothingYet)).toEqual({ value: "", sub: "0 accounts · 0 more under $100 · lower bound, walking", tone: "neutral", pending: true });
  // Stopped over nothing material: no figure — the unavailable register, never a dash — the stop named, never a zero.
  const stopped = summarizeCash({ rows: [far], decimals: 6, refusedPositions: 0, walkComplete: false, walkStopped: "Failed to fetch", walkStopKind: "before-end", refusedWhole: null });
  expect(liquidatableTile(stopped)).toEqual({ value: "", sub: "0 accounts · 0 more under $100 · lower bound, walk stopped", tone: "neutral", pending: false, state: "unavailable" });
  expect(nearCapTile(stopped)).toEqual({ value: "", sub: "0 accounts · lower bound, walk stopped", tone: "neutral", pending: false, state: "unavailable" });
  // A row this page could not read beside nothing material: no figure, in the unreadable register.
  const unread = summarizeCash({ rows: [far, unreadable], decimals: 6, refusedPositions: 0, ...settled });
  expect(nearCapTile(unread)).toEqual({ value: "", sub: "0 accounts · lower bound, 1 row unreadable", tone: "refused", pending: false, state: "unreadable" });
  // One account near the cap is one account.
  const near = readCashRow(refinePositionSummary({ ...firstRow, ...readable, account: "0xnear", liquidatable: false, health_factor: { ...readable.health_factor, num: "4804000000", den: "4620000000" }, total_debt: "4620000000" }));
  const one = summarizeCash({ rows: [near], decimals: 6, refusedPositions: 0, ...settled });
  expect(nearCapTile(one)).toEqual({ value: "$4,620", sub: "1 account", tone: "warn", pending: false });
  // The demo walk, read whole: the tiles the Book prints.
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const read = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(liquidatableTile(read)).toEqual({ value: "$6,840", sub: "2 accounts · 47 more under $100 · 49 in all", tone: "crit", pending: false });
  expect(nearCapTile(read)).toMatchObject({ sub: "27 accounts", tone: "warn", pending: false });
});

test("a walk served an account twice claims no bound anywhere, in its own words — never 'at least', never 'lower bound'", () => {
  const near = readCashRow(refinePositionSummary({ ...firstRow, ...readable, account: "0xnear", liquidatable: false, health_factor: { ...readable.health_factor, num: "4804000000", den: "4620000000" }, total_debt: "4620000000" }));
  const twice = "account 0xnear was delivered on page 1 and again on page 2";
  const s = summarizeCash({ rows: [near], decimals: 6, refusedPositions: 0, refusedWhole: null, walkComplete: false, walkStopped: twice, walkStopKind: "duplicate" });
  expect(s.stopKind).toBe("duplicate");
  expect(walkQualifier(s)).toBe(" · the walk was served an account twice, figures are not a bound");
  expect(tileBoundNote(s)).toBe(" · not a bound, the walk was served an account twice");
  expect(walkEntryLine(s)).toBe("The walk was served an account twice");
  const finding = bandsFinding(s);
  expect(finding).toEqual({
    lead: "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ",
    figure: "$4,620",
    rest: " sits within 10% of the cap among the rows the walk landed · the walk was served an account twice, figures are not a bound",
    barsNote: "The walk was served an account twice: pages that repeat an account do not partition the book, so no bar or count here is a total or a lower bound.",
  });
  expect(bandsFinding({ ...s, bands: s.bands.map((b) => ({ ...b, count: 0, debt: 0n })) }).rest).toBe(
    " within 10% of the cap: a zero is claimed only by a complete walk · the walk was served an account twice",
  );
  expect(s.headline.dek).toContain(`The walk was served an account twice (${twice})`);
  for (const words of [finding.lead, finding.rest, finding.barsNote ?? "", walkQualifier(s), tileBoundNote(s), s.headline.dek]) {
    expect(words).not.toMatch(/at least|a lower bound over|are a lower bound|· lower bound/);
  }
});

test("the entry card's line is framed by how the walk ended — 'before the last page' is said only of a walk that never read it", () => {
  const base = { settled: false, whole: false, unreadable: 0, computed: 1, notComputed: 0, nearCap: { sum: 0n, count: 0 }, decimals: 6 } as const;
  expect(walkEntryLine({ ...base, stopped: null, stopKind: null })).toBe("Walking the book…");
  expect(walkEntryLine({ ...base, stopped: "Failed to fetch", stopKind: "before-end" })).toBe("The walk stopped before the last page");
  expect(walkEntryLine({ ...base, stopped: "short", stopKind: "at-end" })).toBe("The walk reached its last page and its rows do not reconcile with the census");
  expect(walkEntryLine({ ...base, stopped: "past", stopKind: "over" })).toBe("The walk ran past its census");
  for (const kind of ["at-end", "over", "duplicate"] as const) {
    expect(walkEntryLine({ ...base, stopped: "x", stopKind: kind })).not.toMatch(/before the (book was read|last page)/);
  }
  expect(walkEntryLine({ ...base, settled: true, whole: true, stopped: null, stopKind: null, nearCap: { sum: 4_620_000_000n, count: 1 } })).toBe("$4,620 within 10% of cap");
});

test("load failure headline", () => {
  expect(unavailableHeadline("no servable batch").emphasis).toBe("The Cash book could not be loaded.");
  // A fetch failure is never a refusal: the headline states there is no answer, in the absent register.
  expect(unavailableHeadline("no servable batch").tone).toBe("absent");
  expect(unavailableHeadline("no servable batch").dek).toBe("No servable batch.");
  expect(unavailableHeadline("  ").dek).toBe("The service gave no reason.");
});

test("an answer that is not a book has its own headline: it was not 'not loaded' and nothing was 'not computed' — the fault is named", () => {
  const h = unreadableHeadline("engines is not a list (got null)");
  expect(h.variant).toBe("refused");
  expect(h.tone).toBe("absent");
  expect(h.emphasis).toBe("The Cash book's answer could not be read.");
  expect(h.dek).toBe("The service answered, and the body is not a book: engines is not a list (got null).");
  expect(`${h.emphasis} ${h.dek}`).not.toMatch(/could not be loaded|could not be computed|unavailable/);
});

/** `n` rows whose debts sum to `total` exactly: the first carries the remainder. */
function rowsWithDebts(n: number, total: bigint): SizedCashRow[] {
  const each = total / BigInt(n);
  return Array.from({ length: n }, (_, i) => ({ ...far, account: `0xnear${String(i)}`, debt: i === 0 ? total - each * BigInt(n - 1) : each }));
}

test("the near-cap fold names the rows it hides and their debt — never 'all N', which would claim a total mid-walk", () => {
  expect(nearCapToggleLabel(rowsWithDebts(21, 622_000_000_000n), 6)).toBe("Show 21 more near-cap accounts ($622K)");
  expect(nearCapToggleLabel(rowsWithDebts(1, 12_000_000_000n), 6)).toBe("Show 1 more near-cap account ($12K)");
  expect(belowLineToggleLabel(47, 109_450_000n, 6)).toBe("Show 47 accounts under $100 ($109.45)");
  expect(belowLineToggleLabel(1, 50_000_000n, 6)).toBe("Show 1 account under $100 ($50)");
  for (const label of [nearCapToggleLabel(rowsWithDebts(21, 622_000_000_000n), 6), belowLineToggleLabel(47, 109_450_000n, 6)]) {
    expect(label).not.toMatch(/\ball\b/);
  }
  // The demo walk, read whole: the attention table shows 8 rows ahead of the refused ones — its 2 material rows and the
  // first 6 near-cap rows by room — so the fold holds the other 21 of the 27 and their debt.
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const read = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(read.nearCapRows).toHaveLength(27);
  expect(read.liquidatable.counts.material).toBe(2);
  expect(nearCapToggleLabel(read.nearCapRows.slice(6), read.decimals)).toBe("Show 21 more near-cap accounts ($622K)");
  expect(belowLineToggleLabel(read.liquidatable.counts.belowLine, read.liquidatable.sums.belowLine, read.decimals)).toBe(
    "Show 47 accounts under $100 ($109.45)",
  );
});

test("the distance chart reconciles its over-cap bar with the headline: over a book read whole, the finding says the bar includes the accounts under the $100 line", () => {
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const read = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(bandsFinding(read).rest).toBe(" sits within 10% of the cap · the over-cap bar includes the 47 accounts under $100");
  // One account under the line is one account; none under it, nothing said.
  const small = readCashRow(refinePositionSummary({ ...firstRow, ...readable, account: "0xsmall", liquidatable: true, health_factor: { ...readable.health_factor, num: "32000000", den: "50000000" }, total_debt: "50000000" }));
  const one = summarizeCash({ rows: [small], decimals: 6, refusedPositions: 0, ...settled });
  expect(bandsFinding(one).rest).toBe(" sits within 10% of the cap · the over-cap bar includes the 1 account under $100");
  expect(bandsFinding(summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled })).rest).toBe(" sits within 10% of the cap");
  // Short of a whole read the bars already say they are a lower bound; the clause is not said over them.
  const walking = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(bandsFinding(walking).rest).not.toContain("over-cap bar");
});

test("the Book's bars: the breached band is named 'Over cap' — the band's name, in sentence case — and each bar wears its band's tone; a band the walk cannot yet speak for prints nothing", () => {
  const committed = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  const bars = bookBars(committed);
  expect(bars.map((b) => b.label)).toEqual(["Over cap", "< 2% room", "2–5%", "5–10%", "10–25%", "25–50%", "≥ 50% room"]);
  expect(bars.map((b) => b.tone)).toEqual(["crit", "warn", "warn", "warn", "neutral", "neutral", "neutral"]);
  expect(bars[0]).toMatchObject({ id: "breached", count: 1, value: 4_200_000_000n });
  for (const bar of bars) expect(bar.label.charAt(0)).not.toMatch(/[a-z]/);
  const walking = summarizeCash({ rows: [], decimals: 6, refusedPositions: 1, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  for (const bar of bookBars(walking)) expect(bar).toMatchObject({ count: null, value: null });
});

test("the Overview's live line is one line of facts over a book read whole — each clause omitted when zero — and says nothing over a book it could not read whole", () => {
  const demo = [...DEMO_POSITIONS_DM_PAGE_1.positions, ...DEMO_POSITIONS_DM_PAGE_2.positions].map((p) => readCashRow(refinePositionSummary(p)));
  const read = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, ...settled });
  expect(overviewLiveLine(read)).toBe("47 more under the $100 line ($109.45 together) · 27 accounts within 10% of their cap ($830K) · 6 with no verdict");
  // The committed book: one material account, nothing under the line, nothing near the cap, one with no verdict.
  expect(overviewLiveLine(summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled }))).toBe("1 with no verdict");
  // Nothing material: the accounts under the line are not "more" of anything.
  const small = readCashRow(refinePositionSummary({ ...firstRow, ...readable, account: "0xsmall", liquidatable: true, health_factor: { ...readable.health_factor, num: "32000000", den: "50000000" }, total_debt: "50000000" }));
  const near = readCashRow(refinePositionSummary({ ...firstRow, ...readable, account: "0xnear", liquidatable: false, health_factor: { ...readable.health_factor, num: "4804000000", den: "4620000000" }, total_debt: "4620000000" }));
  expect(overviewLiveLine(summarizeCash({ rows: [small, near], decimals: 6, refusedPositions: 0, ...settled }))).toBe(
    "1 liquidatable under the $100 line ($50) · 1 account within 10% of its cap ($4,620)",
  );
  // Every clause zero: no line — the headline's dek speaks instead.
  expect(overviewLiveLine(summarizeCash({ rows: [far], decimals: 6, refusedPositions: 0, ...settled }))).toBeNull();
  // Short of a whole read, or over a book the engine computed none of, no count is a total: no line.
  const walking = summarizeCash({ rows: demo, decimals: 6, refusedPositions: 6, walkComplete: false, walkStopped: null, walkStopKind: null, refusedWhole: null });
  expect(overviewLiveLine(walking)).toBeNull();
  expect(overviewLiveLine(summarizeCash({ rows: [far, unreadable], decimals: 6, refusedPositions: 0, ...settled }))).toBeNull();
  const refusedRow = rows.find((r) => !r.computed);
  if (refusedRow === undefined) throw new Error("fixture invariant: the committed page serves a refused row");
  expect(overviewLiveLine(summarizeCash({ rows: [refusedRow], decimals: 6, refusedPositions: 1, ...settled }))).toBeNull();
});
