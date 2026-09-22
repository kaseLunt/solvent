import { expect, test } from "@playwright/test";
import {
  bookHeadline,
  bookHeadlineRefused,
  censusFaultWords,
  duplicateFaultWords,
  nearCapSentence,
  stopFrame,
  stopWords,
  unreadableSentence,
  walkSentence,
} from "../../lib/book-headline";

const usd6 = (n: number): bigint => BigInt(Math.round(n * 1_000_000));
/** A complete walk: the only state in which a negative may be claimed over the book. */
const settled = { computed: 10, complete: true, stopped: null, stopKind: null } as const;
const nothing = { sum: 0n, count: 0 } as const;

test("material: money first, the emphasized phrase carries the verdict", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(6840), count: 2 },
    belowLine: { sum: usd6(112), count: 47 },
    nearCap: { sum: usd6(312_400), count: 27 },
    notComputed: 6,
    ...settled,
  });
  expect(h.variant).toBe("material");
  expect(h.tone).toBe("crit");
  expect(h.emphasis).toBe("$6,840 of Cash debt is liquidatable right now,");
  expect(h.rest).toBe(" across 2 accounts.");
  expect(h.dek).toBe(
    "47 more positions are technically liquidatable, each under the $100 line — $112 together — and not headlined. " +
      "27 accounts are within 10% of their borrow cap, carrying $312K. " +
      "6 positions could not be computed this batch and are counted, not hidden.",
  );
});

test("material, singular everywhere", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(4200), count: 1 },
    belowLine: nothing,
    nearCap: nothing,
    notComputed: 1,
    ...settled,
  });
  expect(h.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(h.rest).toBe(" across 1 account.");
  expect(h.dek).toBe(
    "No account is within 10% of its borrow cap. 1 position could not be computed this batch and is counted, not hidden.",
  );
});

test("quiet: nothing material — the dek leads with the below-line count", () => {
  const h = bookHeadline({
    decimals: 8,
    material: nothing,
    belowLine: { sum: 46n, count: 46 },
    nearCap: nothing,
    notComputed: 0,
    ...settled,
  });
  expect(h.variant).toBe("quiet");
  expect(h.tone).toBe("ok");
  expect(h.emphasis).toBe("Nothing material is liquidatable on the Cash book right now.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe(
    "46 more positions are technically liquidatable, each under the $100 line — <$0.01 together — and not headlined. No account is within 10% of its borrow cap.",
  );
});

test("quiet with nothing liquidatable at all", () => {
  const h = bookHeadline({
    decimals: 6,
    material: nothing,
    belowLine: nothing,
    nearCap: { sum: usd6(11_200), count: 3 },
    notComputed: 0,
    ...settled,
  });
  expect(h.dek).toBe("No position is liquidatable. 3 accounts are within 10% of their borrow cap, carrying $11K.");
});

test("a negative is claimed only over computed accounts: beside refused accounts the dek says 'No computed position'", () => {
  const h = bookHeadline({ decimals: 6, material: nothing, belowLine: nothing, nearCap: nothing, notComputed: 2, computed: 5, complete: true, stopped: null, stopKind: null });
  expect(h.variant).toBe("quiet");
  expect(h.dek).toBe(
    "No computed position is liquidatable. No account is within 10% of its borrow cap. 2 positions could not be computed this batch and are counted, not hidden.",
  );
  expect(h.dek).not.toContain("No position is liquidatable.");
});

test("a complete walk that computed no account beside refused ones is a refusal, never a quiet verdict", () => {
  const h = bookHeadline({ decimals: 6, material: nothing, belowLine: nothing, nearCap: nothing, notComputed: 1, computed: 0, complete: true, stopped: null, stopKind: null });
  expect(h.variant).toBe("refused");
  expect(h.tone).toBe("refused");
  expect(h.emphasis).toBe("No Cash account could be computed this batch.");
  expect(h.dek).toBe("1 position could not be computed this batch and is counted, not hidden.");
  expect(h.dek).not.toContain("liquidatable");
});

test("an unfinished walk with nothing material is pending — never 'Nothing material is liquidatable'", () => {
  const first = bookHeadline({ decimals: 6, material: nothing, belowLine: nothing, nearCap: nothing, notComputed: 1, computed: 0, complete: false, stopped: null, stopKind: null });
  expect(first.variant).toBe("pending");
  expect(first.tone).toBe("refused");
  expect(first.emphasis).toBe("Walking the Cash book…");
  expect(first.dek).toBe(
    "No page has landed yet. The verdict settles when the walk ends. 1 position could not be computed this batch and is counted, not hidden.",
  );
  expect(first.dek).not.toContain("No account is within 10%");
  const later = bookHeadline({ decimals: 6, material: nothing, belowLine: nothing, nearCap: nothing, notComputed: 0, computed: 40, complete: false, stopped: null, stopKind: null });
  expect(later.dek).toBe("Nothing material is liquidatable among the 40 computed accounts read so far. The verdict settles when the walk ends.");
});

test("a stopped walk names its cause and claims no verdict over the rest", () => {
  const h = bookHeadline({
    decimals: 6,
    material: nothing,
    belowLine: nothing,
    nearCap: nothing,
    notComputed: 0,
    computed: 3,
    complete: false,
    stopped: "Failed to fetch",
    stopKind: "before-end",
  });
  expect(h.variant).toBe("refused");
  expect(h.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(h.dek).toBe(
    "The walk stopped before the last page (Failed to fetch). " +
      "Nothing material is liquidatable among the 3 computed accounts read so far. No verdict is claimed over the rest.",
  );
  const blank = bookHeadline({ decimals: 6, material: nothing, belowLine: nothing, nearCap: nothing, notComputed: 0, computed: 0, complete: false, stopped: "  ", stopKind: "before-end" });
  expect(blank.dek).toBe("The walk stopped before the last page (the service gave no reason). No page has landed yet. No verdict is claimed over the rest.");
});

test("the dek words what happened to the walk: 'before the last page' is said only of a walk that never read its last page — a walk that reached it, or ran past its census, says so", () => {
  const base = { decimals: 6, material: nothing, belowLine: nothing, nearCap: nothing, notComputed: 0, computed: 3, complete: false } as const;
  const short = censusFaultWords(3, 5);
  const past = censusFaultWords(3, 2);
  expect(stopFrame("before-end", "Failed to fetch")).toBe("The walk stopped before the last page (Failed to fetch)");
  expect(stopFrame("at-end", short)).toBe(
    "The walk reached its last page and its rows do not reconcile with the census (the walk delivered 3 of the 5 rows the wire advertised)",
  );
  expect(stopFrame("over", past)).toBe("The walk ran past its census (the walk delivered 3 rows for a census of 2)");
  // The refused headline: the frame is the stop's own, and neither census fault is "before the last page".
  const atEnd = bookHeadline({ ...base, stopped: short, stopKind: "at-end" });
  expect(atEnd.dek).toBe(
    "The walk reached its last page and its rows do not reconcile with the census (the walk delivered 3 of the 5 rows the wire advertised). " +
      "Nothing material is liquidatable among the 3 computed accounts read so far. No verdict is claimed over the rest.",
  );
  const over = bookHeadline({ ...base, stopped: past, stopKind: "over" });
  expect(over.dek).toContain("The walk ran past its census (the walk delivered 3 rows for a census of 2).");
  for (const h of [atEnd, over]) expect(h.dek).not.toContain("before the last page");
  // A material finding beside each stop: a lower bound where the rows are distinct accounts of the census; a walk past
  // its census landed accounts the census does not count, so no bound is claimed — never "lower bound", never "at least".
  const material = { ...base, material: { sum: usd6(4200), count: 1 }, computed: 1 };
  expect(bookHeadline({ ...material, stopped: short, stopKind: "at-end" }).dek).toBe(
    "The walk reached its last page and its rows do not reconcile with the census (the walk delivered 3 of the 5 rows the wire advertised); every figure is a lower bound over the 1 computed account it read.",
  );
  const overMaterial = bookHeadline({ ...material, stopped: past, stopKind: "over" });
  expect(overMaterial.dek).toBe(
    "The walk ran past its census (the walk delivered 3 rows for a census of 2); it landed more accounts than the census counts, so no figure here is a total or a lower bound.",
  );
  expect(overMaterial.dek).not.toMatch(/every figure is a lower bound|at least/);
  // Identities are tracked across the walk: a walk past its census repeated no account, and never says it may have.
  expect(overMaterial.dek).not.toContain("count an account twice");
});

test("a walk served an account twice names the account and the pages, and claims no bound: the repeat is a fault of the paging, never a row counted twice", () => {
  const A = "0xccCc000000000000000000000000000000000003";
  expect(duplicateFaultWords(A, 1, 2)).toBe(`account ${A} was delivered on page 1 and again on page 2`);
  expect(duplicateFaultWords(A, 3, 3)).toBe(`account ${A} was delivered twice on page 3`);
  expect(duplicateFaultWords(A, 1, 2, 1)).toBe(`account ${A} was delivered on page 1 and again on page 2, and 1 more repeated row on that page`);
  expect(duplicateFaultWords(A, 1, 2, 4)).toBe(`account ${A} was delivered on page 1 and again on page 2, and 4 more repeated rows on that page`);
  const twice = duplicateFaultWords(A, 1, 2);
  expect(stopWords("duplicate")).toBe("The walk was served an account twice");
  expect(stopFrame("duplicate", twice)).toBe(`The walk was served an account twice (${twice})`);
  const base = { decimals: 6, belowLine: nothing, nearCap: nothing, notComputed: 0, complete: false, stopped: twice, stopKind: "duplicate" } as const;
  const quiet = bookHeadline({ ...base, material: nothing, computed: 1 });
  expect(quiet.variant).toBe("refused");
  expect(quiet.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(quiet.dek).toContain(`The walk was served an account twice (${twice}).`);
  expect(quiet.dek).not.toContain("before the last page");
  const material = bookHeadline({ ...base, material: { sum: usd6(4200), count: 1 }, computed: 1 });
  expect(material.dek).toBe(
    `The walk was served an account twice (${twice}); pages that repeat an account do not partition the book, so no figure here is a total or a lower bound.`,
  );
  expect(material.dek).not.toMatch(/every figure is a lower bound|at least/);
});

test("one frame is never said of every ending: each stop kind has its own words, with and without its cause", () => {
  expect(stopWords("before-end")).toBe("The walk stopped before the last page");
  expect(stopWords(null)).toBe("The walk stopped before the last page");
  expect(stopWords("at-end")).toBe("The walk reached its last page and its rows do not reconcile with the census");
  expect(stopWords("over")).toBe("The walk ran past its census");
  for (const kind of ["before-end", "at-end", "over", "duplicate"] as const) expect(stopFrame(kind, "why")).toBe(`${stopWords(kind)} (why)`);
});

test("an unreadable computed row withholds every negative the headline can say — the quiet emphasis, 'No position is liquidatable', 'No computed position', the near-cap negative — over a complete walk", () => {
  const complete = { decimals: 6, belowLine: nothing, nearCap: nothing, complete: true, stopped: null, stopKind: null } as const;
  const NEGATIVES = /Nothing material is liquidatable|No position is liquidatable|No computed position is liquidatable|No account is within 10%/;
  expect(unreadableSentence(0)).toBeNull();
  expect(unreadableSentence(1)).toBe("1 position the engine calls computed could not be read by this page and is counted, not cleared.");
  expect(unreadableSentence(3)).toBe("3 positions the engine calls computed could not be read by this page and are counted, not cleared.");
  // The aggregate refused nothing and the walk is complete: without the count this is the quiet, green all-clear.
  const blocked = bookHeadline({ ...complete, material: nothing, notComputed: 0, computed: 9, unreadable: 1 });
  expect(blocked.variant).toBe("refused");
  expect(blocked.tone).toBe("refused");
  expect(blocked.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(blocked.dek).toBe("1 position the engine calls computed could not be read by this page and is counted, not cleared. No verdict is claimed over it.");
  // With refused positions beside it, and with no account readable at all: still no negative, and never "could be computed".
  const beside = bookHeadline({ ...complete, material: nothing, notComputed: 2, computed: 5, unreadable: 2 });
  const none = bookHeadline({ ...complete, material: nothing, notComputed: 1, computed: 0, unreadable: 1 });
  expect(none.emphasis).toBe("The Cash book could not be fully read this batch.");
  // A positive finding stands, qualified; a positive near-cap count is still said; a near-cap ZERO is not.
  const material = bookHeadline({ ...complete, material: { sum: usd6(4200), count: 1 }, notComputed: 0, computed: 1, unreadable: 1 });
  expect(material.variant).toBe("material");
  expect(material.dek).toBe(
    "1 position the engine calls computed could not be read by this page and is counted, not cleared. Every figure is a lower bound over the 1 computed account this page could read.",
  );
  const near = bookHeadline({ ...complete, nearCap: { sum: usd6(500), count: 1 }, material: nothing, notComputed: 0, computed: 4, unreadable: 1 });
  expect(near.dek).toContain("1 account is within 10% of its borrow cap, carrying $500.");
  for (const h of [blocked, beside, none, material, near]) expect(`${h.emphasis} ${h.dek}`).not.toMatch(NEGATIVES);
  // Absent, or zero, the count withholds nothing: the same book read whole says its negatives.
  for (const unreadable of [undefined, 0]) {
    const whole = bookHeadline({ ...complete, material: nothing, notComputed: 0, computed: 9, ...(unreadable === undefined ? {} : { unreadable }) });
    expect(whole.variant).toBe("quiet");
    expect(whole.dek).toBe("No position is liquidatable. No account is within 10% of its borrow cap.");
  }
  expect(walkSentence({ complete: true, stopped: null, stopKind: null, computed: 9, unreadable: 0 })).toBeNull();
  expect(walkSentence({ complete: true, stopped: null, stopKind: null, computed: 9, unreadable: 2 })).toBe(
    "Every figure is a lower bound over the 9 computed accounts this page could read.",
  );
});

test("the census fault: a short walk delivered N of the M rows; a walk past its census delivered N rows FOR a census of M — never 'N of the M' with N the larger", () => {
  expect(censusFaultWords(2, 3)).toBe("the walk delivered 2 of the 3 rows the wire advertised");
  expect(censusFaultWords(0, 3)).toBe("the walk delivered 0 of the 3 rows the wire advertised");
  expect(censusFaultWords(3, 2)).toBe("the walk delivered 3 rows for a census of 2");
  expect(censusFaultWords(1, 0)).toBe("the walk delivered 1 row for a census of 0");
  expect(censusFaultWords(3, 2)).not.toMatch(/\d+ of the \d+/);
  const h = bookHeadline({
    decimals: 6,
    material: nothing,
    belowLine: nothing,
    nearCap: nothing,
    notComputed: 0,
    computed: 3,
    complete: false,
    stopped: censusFaultWords(3, 2),
    stopKind: "over",
  });
  expect(h.dek).toContain("(the walk delivered 3 rows for a census of 2)");
});

test("a material finding stands mid-walk as a lower bound; a zero near-cap count mid-walk is silence, not a negative", () => {
  const input = { decimals: 6, material: { sum: usd6(4200), count: 1 }, belowLine: nothing, nearCap: nothing, notComputed: 0, computed: 1 };
  const running = bookHeadline({ ...input, complete: false, stopped: null, stopKind: null });
  expect(running.variant).toBe("material");
  expect(running.dek).toBe("The walk is still running; every figure is a lower bound over the 1 computed account read so far.");
  const stopped = bookHeadline({ ...input, complete: false, stopped: "Failed to fetch", stopKind: "before-end" });
  expect(stopped.variant).toBe("material");
  expect(stopped.dek).toBe(
    "The walk stopped before the last page (Failed to fetch); every figure is a lower bound over the 1 computed account it read.",
  );
  expect(nearCapSentence(nothing, 6, false)).toBeNull();
  expect(nearCapSentence(nothing, 6, true)).toBe("No account is within 10% of its borrow cap.");
  expect(nearCapSentence({ sum: usd6(500), count: 1 }, 6, false)).toBe("1 account is within 10% of its borrow cap, carrying $500.");
  expect(walkSentence({ complete: true, stopped: null, stopKind: null, computed: 9 })).toBeNull();
});

test("refused: the whole engine withheld", () => {
  const h = bookHeadlineRefused("collateral-flag custody is unproven for this window");
  expect(h.variant).toBe("refused");
  expect(h.tone).toBe("refused");
  expect(h.emphasis).toBe("The Cash book could not be computed this batch.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe("Collateral-flag custody is unproven for this window.");
  expect(bookHeadlineRefused("").dek).toBe("The engine gave no reason.");
});
