### Task 3: `lab-headline` — the §3.5 Scenarios templates and the honest extra states (R3, R11, R14)

**Files:**
- Create: `web/lib/lab-headline.ts`
- Test: `web/tests/unit/lab-headline.spec.ts`

**Interfaces:**
- Consumes: `lib/human-usd.ts` (`humanUsd`, `MINUS` — the Book's tiers: one decimal, truncated: `$1.2M`, `$40K`, `$6,949`, `$239.60`), `lib/prose.ts` (`groupInt`, `joinAnd`), `lib/inspector-headline.ts` (`engineName`), `lib/lab-transitions.ts` (`HeatmapView`).
- Produces: `LabHeadline { emphasis, rest, tone: "crit" | "warn" | "ok" | "refused", dek }`; `signedUsd(value: bigint, decimals): string`; `resultHeadline(f: ResultFigures)`; `notRunHeadline(def: { label, description, path_assumption, shocks: number })`; `runningHeadline(label)`; `withheldHeadline(label, cause)`; `notCoveredHeadline(label, engines: string[], legacyBelow: boolean)`; `contradictoryHeadline(label, reasons)`; `definitionChangedHeadline(label, fields)`; `failureHeadline(kind: FailureKind, detail)`; `LISTING_LOADING`; `listingUnavailableHeadline(message)`; `FailureKind = "not-served" | "no-batch" | "rate-limited" | "busy" | "unreachable" | "failed" | "refused-locally"`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-headline.spec.ts
// Every sentence the Scenarios verdict header can print, pinned verbatim
// (spec §3.5 templates and the plan's extra states). Money is the Book's tiers.
import { expect, test } from "@playwright/test";
import {
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  signedUsd,
  withheldHeadline,
} from "../../lib/lab-headline";
import { laneReading } from "../../lib/lab-transitions";
import { cashEngine, DEMO_CASH_TABLE } from "./helpers/run-book-engine";

const heatOf = (table: Parameters<typeof cashEngine>[0]) => {
  const r = laneReading(cashEngine(table), { merge: true });
  if (r.kind !== "ok") throw new Error("helper table must read");
  return r.view;
};
const DEMO = {
  label: "ETH -30 percent",
  decimals: 6,
  newly: 118,
  beforeEligible: 49,
  afterEligible: 167,
  deltaEligibleDebt: 1_280_000_000_000n,
  deltaBadDebt: 40_780_396_039n,
  heat: heatOf(DEMO_CASH_TABLE),
  heatReason: null,
};

test("signedUsd: a sign on every delta, the Book's tiers, the true minus", () => {
  expect(signedUsd(1_280_000_000_000n, 6)).toBe("+$1.2M");
  expect(signedUsd(40_780_396_039n, 6)).toBe("+$40K");
  expect(signedUsd(-5_000_000n, 6)).toBe("−$5");
  expect(signedUsd(0n, 6)).toBe("+$0");
});

test("the demo result: the §3.5 template, money first, the dek from the wire's own figures and the merged bands", () => {
  const h = resultHeadline(DEMO);
  expect(h.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(h.rest).toBe("across 118 accounts.");
  expect(h.tone).toBe("crit");
  expect(h.dek).toBe(
    "Bad debt would rise by $40K if all 167 were liquidated at the shocked prices. 425 accounts move to a worse band; none improve. Of the 27 accounts within 9.09% of their cap today, all 27 cross it.",
  );
});

test("no change, band changes only, accounts flipping without a debt delta, improvements, a falling bad debt", () => {
  const none = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: 0n, deltaBadDebt: 0n, heat: heatOf({ 2: { 2: 3 }, 7: { 7: 9 } }) });
  expect(none.emphasis).toBe("No Cash account changes band under ETH -30 percent.");
  expect(none.rest).toBe("");
  expect(none.tone).toBe("ok");
  expect(none.dek).toBe("Bad debt at liquidation does not change.");

  const moved = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: 0n, deltaBadDebt: 0n, heat: heatOf({ 2: { 2: 1 }, 5: { 4: 5 }, 7: { 7: 2 } }) });
  expect(moved.emphasis).toBe("No Cash account becomes liquidatable under ETH -30 percent,");
  expect(moved.rest).toBe("but 5 change band.");
  expect(moved.tone).toBe("warn");
  expect(moved.dek).toBe("Bad debt at liquidation does not change. 5 accounts move to a worse band; none improve. Of the 1 account within 9.09% of its cap today, none cross it.");

  const flipped = resultHeadline({ ...DEMO, newly: 2, deltaEligibleDebt: 0n, heat: null, heatReason: "the matrix's lanes, outflows and two margins are not the same length" });
  expect(flipped.emphasis).toBe("2 accounts become liquidatable under ETH -30 percent.");
  expect(flipped.tone).toBe("crit");
  expect(flipped.dek).toContain("Where accounts move could not be read: the matrix's lanes, outflows and two margins are not the same length.");

  const better = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: -3_000_000_000n, deltaBadDebt: -1_000_000n, heat: heatOf({ 2: { 3: 4 }, 4: { 3: 2 } }) });
  expect(better.emphasis).toBe("No Cash account becomes liquidatable under ETH -30 percent,");
  expect(better.rest).toBe("but 6 change band.");
  expect(better.dek).toBe("Bad debt at liquidation would fall by $1. 6 accounts change band; 4 improve. Of the 4 accounts within 9.09% of their cap today, none cross it.");

  const single = resultHeadline({ ...DEMO, newly: 1, deltaEligibleDebt: 5_000_000n, afterEligible: 50, deltaBadDebt: 0n, heat: heatOf({ 3: { 0: 1 } }) });
  expect(single.emphasis).toBe("$5 more Cash debt becomes liquidatable,");
  expect(single.rest).toBe("across 1 account.");
  expect(single.dek).toBe("Bad debt at liquidation does not change. 1 account moves to a worse band; none improve. Of the 1 account within 9.09% of its cap today, all 1 cross it.");
});

test("the states without a result: not run, running, withheld, not covered, contradictory, definition changed — the dashed tone, never a verdict", () => {
  const notRun = notRunHeadline({ label: "ETH -30 percent", description: "All ETH-linked collateral, instantaneous mark.", path_assumption: "instantaneous mark at the shocked level; single-step", shocks: 1 });
  expect(notRun).toEqual({
    emphasis: "ETH -30 percent",
    rest: "— 1 committed shock, not run yet.",
    tone: "refused",
    dek: "All ETH-linked collateral, instantaneous mark. Path: instantaneous mark at the shocked level; single-step.",
  });
  expect(notRunHeadline({ label: "X", description: "D.", path_assumption: "P.", shocks: 3 }).rest).toBe("— 3 committed shocks, not run yet.");
  expect(notRunHeadline({ label: "X", description: "D.", path_assumption: "P.", shocks: 0 }).rest).toBe("— no committed shock (a market-realization or projection scenario), not run yet.");
  expect(runningHeadline("ETH -30 percent")).toEqual({ emphasis: "Running ETH -30 percent…", rest: "", tone: "refused", dek: "One evaluation against the newest complete batch; nothing is written." });
  expect(withheldHeadline("ETH -30 percent", "Cash — the custody flag is unproven")).toEqual({
    emphasis: "Cannot say — the Cash book is withheld under ETH -30 percent.",
    rest: "",
    tone: "refused",
    dek: "Cash — the custody flag is unproven. A withheld book is not a computed book, and this page never fills it in.",
  });
  expect(notCoveredHeadline("ETHFI -50 percent", ["aave_v3_etherfi"], true)).toEqual({
    emphasis: "ETHFI -50 percent does not model the Cash book.",
    rest: "",
    tone: "refused",
    dek: "It models the Aave v3 market (legacy). The legacy result is below.",
  });
  expect(notCoveredHeadline("X", [], false).dek).toBe("It models no engine this deployment serves.");
  expect(contradictoryHeadline("ETH -30 percent", ["a", "b"])).toEqual({
    emphasis: "The result for ETH -30 percent contradicts itself.",
    rest: "",
    tone: "refused",
    dek: "a; b. Nothing from it is drawn.",
  });
  expect(definitionChangedHeadline("ETH -30 percent", ["version", "shocks"])).toEqual({
    emphasis: "ETH -30 percent changed since this result was computed.",
    rest: "",
    tone: "refused",
    dek: "Changed: version and shocks. Run it again for the current definition.",
  });
});

test("the failure arms name themselves; a retry is stated only when the service stated it", () => {
  expect(failureHeadline("not-served", {})).toEqual({
    emphasis: "Book-wide stress is not served by this deployment.",
    rest: "",
    tone: "refused",
    dek: "The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book.",
  });
  expect(failureHeadline("no-batch", { message: "no complete risk batch is available", retryAfterSeconds: 30 }).dek).toBe("No complete risk batch is available (503). Retry after 30s.");
  expect(failureHeadline("no-batch", { message: "no complete risk batch is available", retryAfterSeconds: null }).dek).toBe("No complete risk batch is available (503). The service did not say when to retry.");
  expect(failureHeadline("no-batch", {}).emphasis).toBe("No servable batch.");
  expect(failureHeadline("rate-limited", { retryAfterSeconds: 12 })).toEqual({ emphasis: "Rate limited (429).", rest: "", tone: "refused", dek: "Retry after 12s." });
  expect(failureHeadline("busy", { message: "another evaluation holds the slot", inFlight: 1, maxInFlight: 1 }).dek).toBe("Another evaluation holds the slot. 1 of 1 slots in use.");
  expect(failureHeadline("busy", { message: "busy", inFlight: null, maxInFlight: null }).dek).toBe("Busy. The service did not state its capacity.");
  expect(failureHeadline("unreachable", { message: "fetch failed" })).toEqual({ emphasis: "The service could not be reached.", rest: "", tone: "refused", dek: "Fetch failed." });
  expect(failureHeadline("failed", { status: 500, message: "internal" })).toEqual({ emphasis: "The service answered 500.", rest: "", tone: "refused", dek: "Internal." });
  expect(failureHeadline("refused-locally", { message: "ids exceed the cap" }).emphasis).toBe("Nothing was sent.");
  expect(LISTING_LOADING).toEqual({ emphasis: "Loading the committed scenarios…", rest: "", tone: "refused", dek: "The library is the committed, versioned set this deployment serves. Nothing runs until it is listed." });
  expect(EMPTY_LISTING).toEqual({ emphasis: "No committed scenarios are listed.", rest: "", tone: "refused", dek: "This deployment serves an empty committed set. Nothing can run." });
  expect(listingUnavailableHeadline("rate limited (429), retry after 30s")).toEqual({
    emphasis: "The committed scenarios could not be listed.",
    rest: "",
    tone: "refused",
    dek: "Rate limited (429), retry after 30s. Nothing can run until the listing answers.",
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-headline.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-headline'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-headline.ts
// The Scenarios verdict header's sentences (spec §3.5 templates, plan R3).
// Every state the workspace can be in has its own sentence; a definition, a
// run in flight and every refusal use the dashed tone, because none of them is
// a verdict. Money is the Book's tiers (plan R11).
import { humanUsd, MINUS } from "./human-usd";
import { engineName } from "./inspector-headline";
import type { HeatmapView } from "./lab-transitions";
import { groupInt, joinAnd } from "./prose";

export interface LabHeadline {
  readonly emphasis: string;
  readonly rest: string;
  readonly tone: "crit" | "warn" | "ok" | "refused";
  readonly dek: string;
}

export function signedUsd(value: bigint, decimals: number): string {
  return value < 0n ? `${MINUS}${humanUsd(-value, decimals)}` : `+${humanUsd(value, decimals)}`;
}

function sentence(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  const capitalised = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

const accounts = (n: number): string => `${groupInt(n)} account${n === 1 ? "" : "s"}`;
const refused = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "refused", dek });

export interface ResultFigures {
  readonly label: string;
  readonly decimals: number;
  readonly newly: number;
  readonly beforeEligible: number;
  readonly afterEligible: number;
  readonly deltaEligibleDebt: bigint;
  readonly deltaBadDebt: bigint;
  /** Null when the matrix contradicted itself; then `heatReason` says why. */
  readonly heat: HeatmapView | null;
  readonly heatReason: string | null;
}

function badDebtSentence(f: ResultFigures): string {
  if (f.deltaBadDebt > 0n) {
    return `Bad debt would rise by ${humanUsd(f.deltaBadDebt, f.decimals)} if all ${groupInt(f.afterEligible)} were liquidated at the shocked prices.`;
  }
  if (f.deltaBadDebt < 0n) return `Bad debt at liquidation would fall by ${humanUsd(-f.deltaBadDebt, f.decimals)}.`;
  return "Bad debt at liquidation does not change.";
}

function movementSentence(h: HeatmapView): string {
  if (h.bandChanged === 0) return "";
  const n = groupInt(h.bandChanged);
  const verb = h.bandChanged === 1 ? "moves" : "move";
  if (h.improved === 0) return ` ${n} ${h.bandChanged === 1 ? "account" : "accounts"} ${verb} to a worse band; none improve.`;
  return ` ${n} ${h.bandChanged === 1 ? "account changes" : "accounts change"} band; ${groupInt(h.improved)} improve.`;
}

function nearSentence(h: HeatmapView): string {
  // Silent when nothing moved: the headline already said so, and "none cross it" would restate it.
  if (h.nearLabel === null || h.nearToday === 0 || h.bandChanged === 0) return "";
  const who = h.nearToday === 1 ? `the 1 account within ${h.nearLabel} of its cap today` : `the ${groupInt(h.nearToday)} accounts within ${h.nearLabel} of their cap today`;
  const crossed = h.nearCrossed === 0 ? "none" : h.nearCrossed === h.nearToday ? `all ${groupInt(h.nearCrossed)}` : groupInt(h.nearCrossed);
  return ` Of ${who}, ${crossed} cross it.`;
}

export function resultHeadline(f: ResultFigures): LabHeadline {
  const movement =
    f.heat === null
      ? f.heatReason === null
        ? ""
        : ` Where accounts move could not be read: ${f.heatReason}.`
      : `${movementSentence(f.heat)}${nearSentence(f.heat)}`;
  const dek = `${badDebtSentence(f)}${movement}`;
  if (f.newly > 0 && f.deltaEligibleDebt > 0n) {
    return { emphasis: `${humanUsd(f.deltaEligibleDebt, f.decimals)} more Cash debt becomes liquidatable,`, rest: `across ${accounts(f.newly)}.`, tone: "crit", dek };
  }
  if (f.newly > 0) return { emphasis: `${accounts(f.newly)} become liquidatable under ${f.label}.`, rest: "", tone: "crit", dek };
  const moves = f.heat?.bandChanged ?? 0;
  if (moves === 0) return { emphasis: `No Cash account changes band under ${f.label}.`, rest: "", tone: "ok", dek };
  return { emphasis: `No Cash account becomes liquidatable under ${f.label},`, rest: `but ${groupInt(moves)} change band.`, tone: "warn", dek };
}

export function notRunHeadline(def: { label: string; description: string; path_assumption: string; shocks: number }): LabHeadline {
  const shocks =
    def.shocks === 0
      ? "no committed shock (a market-realization or projection scenario)"
      : `${String(def.shocks)} committed shock${def.shocks === 1 ? "" : "s"}`;
  return { emphasis: def.label, rest: `— ${shocks}, not run yet.`, tone: "refused", dek: `${sentence(def.description)} Path: ${sentence(def.path_assumption)}` };
}

export const runningHeadline = (label: string): LabHeadline =>
  refused(`Running ${label}…`, "One evaluation against the newest complete batch; nothing is written.");

export const withheldHeadline = (label: string, cause: string): LabHeadline =>
  refused(`Cannot say — the Cash book is withheld under ${label}.`, `${sentence(cause)} A withheld book is not a computed book, and this page never fills it in.`);

export function notCoveredHeadline(label: string, engines: readonly string[], legacyBelow: boolean): LabHeadline {
  const models = engines.length === 0 ? "It models no engine this deployment serves." : `It models ${joinAnd(engines.map(engineName))}.`;
  return refused(`${label} does not model the Cash book.`, legacyBelow ? `${models} The legacy result is below.` : models);
}

export const contradictoryHeadline = (label: string, reasons: readonly string[]): LabHeadline =>
  refused(`The result for ${label} contradicts itself.`, `${reasons.join("; ")}. Nothing from it is drawn.`);

export const definitionChangedHeadline = (label: string, fields: readonly string[]): LabHeadline =>
  refused(`${label} changed since this result was computed.`, `Changed: ${joinAnd(fields)}. Run it again for the current definition.`);

export type FailureKind = "not-served" | "no-batch" | "rate-limited" | "busy" | "unreachable" | "failed" | "refused-locally";
export interface FailureDetail {
  readonly message?: string;
  readonly retryAfterSeconds?: number | null;
  readonly status?: number;
  readonly inFlight?: number | null;
  readonly maxInFlight?: number | null;
}

function retry(seconds: number | null | undefined): string {
  return typeof seconds === "number" ? `Retry after ${String(seconds)}s.` : "The service did not say when to retry.";
}

export function failureHeadline(kind: FailureKind, d: FailureDetail): LabHeadline {
  switch (kind) {
    case "not-served":
      return refused("Book-wide stress is not served by this deployment.", "The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book.");
    case "no-batch":
      return refused("No servable batch.", `${sentence(d.message ?? "no complete risk batch is available").replace(/\.$/, "")} (503). ${retry(d.retryAfterSeconds)}`);
    case "rate-limited":
      return refused("Rate limited (429).", retry(d.retryAfterSeconds));
    case "busy": {
      const slots =
        typeof d.inFlight === "number" && typeof d.maxInFlight === "number"
          ? `${String(d.inFlight)} of ${String(d.maxInFlight)} slots in use.`
          : "The service did not state its capacity.";
      return refused("The evaluator is busy.", `${sentence(d.message ?? "busy")} ${slots}`);
    }
    case "unreachable":
      return refused("The service could not be reached.", sentence(d.message ?? "no HTTP response"));
    case "failed":
      return refused(`The service answered ${String(d.status ?? 0)}.`, sentence(d.message ?? "without the contract's error envelope"));
    case "refused-locally":
      return refused("Nothing was sent.", sentence(d.message ?? "the request was refused before dispatch"));
  }
}

export const LISTING_LOADING: LabHeadline = refused(
  "Loading the committed scenarios…",
  "The library is the committed, versioned set this deployment serves. Nothing runs until it is listed.",
);

export const listingUnavailableHeadline = (message: string): LabHeadline =>
  refused("The committed scenarios could not be listed.", `${sentence(message)} Nothing can run until the listing answers.`);

export const EMPTY_LISTING: LabHeadline = refused("No committed scenarios are listed.", "This deployment serves an empty committed set. Nothing can run.");
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-headline.spec.ts`
Expected: 5 passed. The pins are the law: if a sentence differs, the code moves, not the pin — except where a pin's arithmetic is provably wrong (recount from the helper table and say so in the report).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-headline.ts web/tests/unit/lab-headline.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-headline - the Scenarios templates and every state's own sentence, money in the Book's tiers, the dashed tone for anything that is not a verdict" -- web/lib/lab-headline.ts web/tests/unit/lab-headline.spec.ts
```

---
