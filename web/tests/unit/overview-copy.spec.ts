// The front door's words (lib/overview-copy): the hero, the entry cards, the pipeline's steps and the footer — every
// sentence true, the step names the shared pipeline vocabulary, and no price source the system does not read.
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import { readCashRow } from "../../lib/cash-rows";
import { summarizeCash } from "../../lib/cash-summary";
import * as copy from "../../lib/overview-copy";
import { CASH_PRICE_SOURCE, CASH_PRICE_SOURCE_CHIP, PIPELINE_STEPS } from "../../lib/prose";
import { BOOK_LOADING, bookAnswered, pipelineSteps, type BookReading, type PipelineStep } from "../../lib/verification-view";
import { BOOK, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { META } from "../fixtures/meta";
import { EVIDENCE_MANIFEST, EVIDENCE_NO_RECEIPT } from "../fixtures/proof";

const settled = { walkComplete: true, walkStopped: null, walkStopKind: null, refusedWhole: null } as const;
const rows = POSITIONS_DM_PAGE_1.positions.map((p) => readCashRow(refinePositionSummary(p)));

/** Every string the module exports, however deep: the words a reader can meet on the front door. */
function words(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(words);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(words);
  return [];
}

test("no front-door sentence names a price source this system does not read: Cash's prices are its own contract's, named in the shared phrase", () => {
  for (const line of words(copy)) expect(line).not.toMatch(/redstone/i);
  expect(copy.PIPELINE_DESCRIPTIONS.compute).toContain(CASH_PRICE_SOURCE);
  expect(copy.FOOTER.stack).toBe(`Built with Go · PostgreSQL · Next.js · TypeScript · OP Mainnet + Ethereum · ${CASH_PRICE_SOURCE_CHIP}`);
  // Cash reader copy says "account", never "position".
  expect(copy.PIPELINE_DESCRIPTIONS.verify).toMatch(/^Accounts are re-derived/);
  for (const line of Object.values(copy.PIPELINE_DESCRIPTIONS)) expect(line).not.toMatch(/\bpositions?\b/i);
});

test("the hero carries no figure, and every entry card's name is a link to another page — its arrow after the words", () => {
  expect(`${copy.HERO_H1_LEAD}${copy.HERO_H1_TAIL}`).not.toMatch(/\d/);
  for (const entry of Object.values(copy.ENTRIES)) {
    expect(entry.name).toMatch(/^[A-Z][a-z]+ →$/);
    expect(entry.question.charAt(0)).toMatch(/[A-Z]/);
  }
  expect(copy.HOW_IT_WORKS.link).toEqual({ href: "/proof#architecture", label: "Architecture & verification →" });
});

test("the hero's address field says what it does in its own placeholder: the hint is not shown there, so the field keeps its words on a phone", () => {
  expect(copy.CTA.addressPlaceholder).toBe("Inspect an address · 0x…");
  expect(copy.CTA.addressPlaceholder.startsWith(copy.CTA.addressHint)).toBe(true);
});

const step = (over: Partial<PipelineStep> & Pick<PipelineStep, "key">): PipelineStep => ({
  label: "",
  ordinal: "",
  value: "1",
  sub: "",
  tone: "neutral",
  pending: false,
  sentence: "",
  line: { before: "", figure: "1", after: "" },
  ...over,
});

test("the pipeline's steps: the shared names and ordinals; a figure in ink (a check that passed is Verification's to colour); a read in flight pending; a failed read unavailable — never refused, never a dash", () => {
  const out = copy.overviewPipeline([
    step({ key: "index", line: { before: "OP block ", figure: "12,345", after: " · Ethereum block 23,456" } }),
    step({ key: "compute", line: { before: "batch ", figure: "18,251", after: " · 1,412 Cash accounts" } }),
    step({ key: "verify", tone: "ok", line: { before: "", figure: "87/87", after: " checked rows exact · 0 drifted" } }),
    step({ key: "serve", line: { before: "", figure: "17", after: " endpoints" } }),
  ]);
  expect(out.map((s) => `${s.ordinal} · ${s.name}`)).toEqual(Object.values(PIPELINE_STEPS).map((s) => s.heading));
  // A line that opens with a word opens with a capital; the figure stays as the shared law printed it.
  expect(out[0]?.line).toEqual({ before: "OP block ", figure: "12,345", after: " · Ethereum block 23,456" });
  expect(out[1]?.line).toEqual({ before: "Batch ", figure: "18,251", after: " · 1,412 Cash accounts" });
  expect(out[2]).toMatchObject({ tone: "neutral", line: { figure: "87/87" } });
  expect(out.map((s) => s.description)).toEqual([
    copy.PIPELINE_DESCRIPTIONS.index,
    copy.PIPELINE_DESCRIPTIONS.compute,
    copy.PIPELINE_DESCRIPTIONS.verify,
    copy.PIPELINE_DESCRIPTIONS.serve,
  ]);

  const absent = copy.overviewPipeline([
    step({ key: "index", value: "—", sub: "pending", pending: true, state: "pending", line: { before: "OP block ", figure: "unavailable", after: "" } }),
    step({ key: "compute", value: "—", sub: "unavailable", state: "unavailable", stateWord: "Unavailable", line: { before: "", figure: "unavailable", after: "" } }),
    step({ key: "verify", value: "—", sub: "no committed receipt", tone: "refused", state: "refused", stateWord: "No committed receipt", line: { before: "", figure: "unavailable", after: " checked rows exact" } }),
    step({ key: "serve", tone: "refused", line: { before: "batch ", figure: "18,251", after: " · Cash accounts withheld" } }),
  ]);
  expect(absent[0]).toMatchObject({ state: "pending", tone: "neutral", line: null });
  expect(absent[1]).toMatchObject({ state: "unavailable", stateWord: "Unavailable", tone: "neutral", line: null });
  expect(absent[2]).toMatchObject({ state: "refused", stateWord: "No committed receipt", tone: "refused", line: null });
  // A refused census keeps its figure, in the refused register: the batch printed, the census named withheld.
  expect(absent[3]).toMatchObject({ tone: "refused", line: { before: "Batch ", figure: "18,251" } });
  for (const s of absent) expect(s.tone).not.toBe("ok");
  for (const s of [...out, ...absent]) expect(`${s.stateWord ?? ""}${s.line?.figure ?? ""}`).not.toBe("—");
});

test("a step with no figure wears the shared law's register on the front door as on Verification: a receipt the wire says is not committed is refused in its own word, a failed read unavailable, a stated no-batch refused, a read in flight pending", () => {
  const NO_BATCH: BookReading = { phase: "no-batch", book: null, failure: { message: "no complete risk batch is available", retryAfterSeconds: null } };
  const FAILED: BookReading = { phase: "error", book: null, failure: { message: "Failed to fetch", retryAfterSeconds: null } };
  const cases: { shared: readonly PipelineStep[]; key: PipelineStep["key"]; state: string; stateWord: string | undefined; tone: string }[] = [
    { shared: pipelineSteps(META, EVIDENCE_NO_RECEIPT, bookAnswered(BOOK)), key: "verify", state: "refused", stateWord: "No committed receipt", tone: "refused" },
    { shared: pipelineSteps(null, null, FAILED), key: "verify", state: "unavailable", stateWord: "Unavailable", tone: "neutral" },
    { shared: pipelineSteps(null, null, FAILED), key: "compute", state: "unavailable", stateWord: "Unavailable", tone: "neutral" },
    { shared: pipelineSteps(META, EVIDENCE_MANIFEST, NO_BATCH), key: "compute", state: "refused", stateWord: "No servable batch", tone: "refused" },
    { shared: pipelineSteps(null, null, BOOK_LOADING, { meta: true, evidence: true }), key: "verify", state: "pending", stateWord: undefined, tone: "neutral" },
  ];
  for (const { shared, key, state, stateWord, tone } of cases) {
    const verification = shared.find((s) => s.key === key);
    const front = copy.overviewPipeline(shared).find((s) => s.key === key);
    // One state, one register: the Verification step and the front door's step are the same frame, word and tone.
    expect(verification).toMatchObject({ state, tone });
    expect(verification?.stateWord).toBe(stateWord);
    expect(front).toMatchObject({ line: null, state, tone });
    expect(front?.stateWord).toBe(stateWord);
  }
});

test("the Inspector entry offers the account nearest liquidation, shortened with one ellipsis, its room worded over cap by — never a minus on dollars", () => {
  const s = summarizeCash({ rows, decimals: 6, refusedPositions: 1, ...settled });
  expect(copy.inspectorEntry(s)).toEqual({
    href: "/inspector/0xccCc000000000000000000000000000000000003",
    line: "Try 0xccCc…0003 — over cap by $1,000",
  });
  const first = POSITIONS_DM_PAGE_1.positions[0];
  if (first === undefined || first.health_factor === null) throw new Error("fixture invariant");
  const near = readCashRow(
    refinePositionSummary({ ...first, liquidatable: false, health_factor: { ...first.health_factor, num: "4804000000", den: "4620000000" }, total_debt: "4620000000" }),
  );
  expect(copy.inspectorEntry(summarizeCash({ rows: [near], decimals: 6, refusedPositions: 0, ...settled })).line).toBe("Try 0xccCc…0003 — $184 from its cap");
  expect(copy.inspectorEntry(null)).toEqual({ href: "/inspector", line: "Try any 0x address" });
  for (const line of [copy.inspectorEntry(s).line, copy.inspectorEntry(null).line]) expect(line).not.toMatch(/\.\.\.|−\$/);
});
