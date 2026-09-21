// summarizeCash — the one derivation both the Book and the Overview strip
// print from (spec 2026-09-15 §5.1, §5.2). Rows come from the committed DM
// page through the client's own refinement, exactly as the hook reads them.
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { readCashRow } from "../../lib/cash-rows";
import type { WalkStopKind } from "../../lib/book-headline";
import { NEAR_CAP_BAND_IDS } from "../../lib/cash-rows";
import { attentionEmptyText, attentionFinding, bandsFinding, bandsSoFar, summarizeCash, tileBoundNote, unavailableHeadline, walkQualifier } from "../../lib/cash-summary";
import { POSITIONS_DM_PAGE_1 } from "../fixtures/book";

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
  expect(s.computed).toBe(1);
  expect(s.settled).toBe(true);
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
  expect(s.headline.dek).not.toContain("No position is liquidatable");
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

test("the attention table's empty line never clears the book over an unfinished walk or a hidden liquidatable position", () => {
  const nothing = { belowLine: { sum: 0n, count: 0 }, decimals: 6 };
  expect(attentionEmptyText({ settled: true, stopped: null, ...nothing })).toBe("No account needs attention.");
  expect(attentionEmptyText({ settled: false, stopped: null, ...nothing })).toBe("Walking the book…");
  expect(attentionEmptyText({ settled: false, stopped: "Failed to fetch", ...nothing })).toBe(
    "The walk stopped before the book was read; no account is cleared.",
  );
  expect(attentionEmptyText({ settled: true, stopped: null, belowLine: { sum: 50_000_000n, count: 1 }, decimals: 6 })).toBe(
    "Nothing material needs attention; 1 liquidatable position under $100 ($50) is behind the small & dust toggle.",
  );
  expect(attentionEmptyText({ settled: true, stopped: null, belowLine: { sum: 61_500_000n, count: 3 }, decimals: 6 })).toBe(
    "Nothing material needs attention; 3 liquidatable positions under $100 ($61.50) are behind the small & dust toggle.",
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

test("a walk past its census claims no bound anywhere: its rows may count an account twice — never 'at least', never 'lower bound'; a walk short at its last page still does", () => {
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
  const over = summary("over", [near, near]);
  expect(over.stopKind).toBe("over");
  const finding = bandsFinding(over);
  expect(finding).toEqual({
    lead: "Cash debt grouped by room under the borrow cap · bars are dollars, counts printed · ",
    figure: "$9,240",
    rest: " sits within 10% of the cap among the rows the walk landed · the walk ran past its census, figures are not a bound",
    barsNote: "The walk ran past its census: its rows may count an account twice, so no bar or count here is a total or a lower bound.",
  });
  expect(bandsFinding(summary("over", rows)).rest).toBe(" within 10% of the cap: a zero is claimed only by a complete walk · the walk ran past its census");
  expect(walkQualifier(over)).toBe(" · the walk ran past its census, figures are not a bound");
  expect(tileBoundNote(over)).toBe(" · not a bound, the walk ran past its census");
  expect(attentionFinding(over)).toBe("Material first, then by room · the walk ran past its census, figures are not a bound");
  expect(over.headline.dek).toContain("The walk ran past its census (the walk delivered 2 rows for a census of 1)");
  for (const words of [finding.lead, finding.rest, finding.barsNote ?? "", walkQualifier(over), tileBoundNote(over), over.headline.dek]) {
    expect(words).not.toMatch(/at least|a lower bound over|are a lower bound|· lower bound/);
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
  expect(tileBoundNote({ settled: true, stopped: null, stopKind: null })).toBe("");
  expect(tileBoundNote({ settled: false, stopped: null, stopKind: null })).toBe(" · lower bound, walking");
  expect(tileBoundNote({ settled: false, stopped: "Failed to fetch", stopKind: "before-end" })).toBe(" · lower bound, walk stopped");
  expect(attentionFinding(null)).toBe("Material first, then by room");
  expect(attentionFinding({ settled: true, stopped: null, stopKind: null })).toBe("Material first, then by room");
  expect(attentionFinding({ settled: false, stopped: null, stopKind: null })).toBe("Material first, then by room · walking the book, figures are a lower bound");
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
  const debtless = bandsSoFar({ settled: false, bands: [{ id: "50-plus", label: "≥50%", count: 3, debt: 0n }] });
  expect(debtless).toEqual([{ id: "50-plus", label: "≥50%", count: 3, debt: null }]);
});

test("the walk qualifier: nothing over a settled or unloaded book, the running and the stopped register otherwise", () => {
  expect(walkQualifier(null)).toBe("");
  expect(walkQualifier({ settled: true, stopped: null, stopKind: null })).toBe("");
  expect(walkQualifier({ settled: false, stopped: null, stopKind: null })).toBe(" · walking the book, figures are a lower bound");
  expect(walkQualifier({ settled: false, stopped: "Failed to fetch", stopKind: "before-end" })).toBe(" · the walk stopped, figures are a lower bound");
  expect(walkQualifier({ settled: false, stopped: "the walk delivered 3 of the 5 rows the wire advertised", stopKind: "at-end" })).toBe(" · the walk stopped, figures are a lower bound");
});

test("load failure headline", () => {
  expect(unavailableHeadline("no servable batch").emphasis).toBe("The Cash book could not be loaded.");
  expect(unavailableHeadline("no servable batch").dek).toBe("No servable batch.");
  expect(unavailableHeadline("  ").dek).toBe("The service gave no reason.");
});
