### Task 6: `inspector-headline` — the §3.5 Inspector templates and the honest extra states

**Files:**
- Create: `web/lib/inspector-headline.ts`
- Test: `web/tests/unit/inspector-headline.spec.ts`

**Interfaces:**
- Consumes `ComputedCash`, `LEGACY` from `./inspector-position`; `Streak` from `./room-history`; `humanUsdFull` from `./human-price` (one account's money is never compacted); `humanAge` from `./freshness`; `plainCause` from `./refusal-phrasebook`.
- Produces:

```ts
export type InspectorVariant = "liquidatable" | "near" | "healthy" | "no-position" | "cannot-compute" | "not-computed" | "other-engine" | "loading" | "unavailable" | "invalid";
export interface InspectorHeadline { readonly variant: InspectorVariant; readonly tone: "crit" | "warn" | "ok" | "refused"; readonly emphasis: string; readonly rest: string; readonly dek: string }
export function engineName(wire: string): string;               // "Cash" | "Aave v3 market (legacy)" | the wire word
export function engineList(names: readonly string[]): string;   // "Cash", "Cash and Aave v3 market (legacy)"
export function cashHeadline(p: ComputedCash, extras: { streak: Streak | null; floor: string | null }): InspectorHeadline;
export function noPositionHeadline(batchId: number): InspectorHeadline;
export function cannotComputeHeadline(withheld: readonly { engine: string; code: string; detail: string }[]): InspectorHeadline;
export function notComputedHeadline(cause: string, lastDebt: string | null): InspectorHeadline;
export function otherEngineHeadline(batchId: number, engines: readonly string[]): InspectorHeadline;
export function unavailableLookupHeadline(message: string): InspectorHeadline;
export const LOADING_HEADLINE: InspectorHeadline;
export const INVALID_HEADLINE: InspectorHeadline;
export const INVALID_ADDRESS_COPY = "An address is 0x followed by 40 hex characters — nothing else is looked up."; // same words as the kit's ADDRESS_REFUSED_COPY
```

- [ ] **Step 1: The failing spec — every template verbatim**

```ts
// web/tests/unit/inspector-headline.spec.ts
import { expect, test } from "@playwright/test";
import {
  cannotComputeHeadline,
  cashHeadline,
  engineList,
  engineName,
  INVALID_HEADLINE,
  LOADING_HEADLINE,
  noPositionHeadline,
  notComputedHeadline,
  otherEngineHeadline,
  unavailableLookupHeadline,
} from "../../lib/inspector-headline";
import { isComputedCash, readCashPosition } from "../../lib/inspector-position";
import { near } from "./helpers/cash-position";

function computed(overrides: Parameters<typeof near>[0] = {}) {
  const p = readCashPosition(near(overrides));
  if (!isComputedCash(p)) throw new Error("helper must be computed");
  return p;
}
const NONE = { streak: null, floor: null };

test("near cap — spec §3.5, with the fall, the extra debt, and the streak sentence", () => {
  const h = cashHeadline(computed(), { streak: { batches: 14, spanSeconds: 390 }, floor: null });
  expect(h).toMatchObject({ variant: "near", tone: "warn", emphasis: "Within $190.50 of its borrow cap.", rest: "Not liquidatable yet." });
  expect(h.dek).toBe(
    "Borrowing $4,822 against a $5,012 cap — 96.2% used. A 3.8% fall in collateral value, or $190.50 more debt, makes this account liquidatable. It has been within 10% of its cap for the last 14 batches (≈6m).",
  );
  // one batch is not a streak; no span → no parenthesis
  expect(cashHeadline(computed(), { streak: { batches: 1, spanSeconds: null }, floor: null }).dek).not.toContain("last");
  expect(cashHeadline(computed(), { streak: { batches: 3, spanSeconds: null }, floor: null }).dek).toContain("for the last 3 batches.");
});

test("liquidatable — spec §3.5", () => {
  const h = cashHeadline(computed({ borrowings: "5400000000", liquidation_verdict: "liquidatable" }), NONE);
  expect(h).toMatchObject({ variant: "liquidatable", tone: "crit", emphasis: "Liquidatable now — $5,400 against a $5,012 cap.", rest: "" });
  expect(h.dek).toBe("Borrowing $5,400 against a $5,012 cap — 107.8% used. $387.50 over the line: the strict rule is debt > cap.");
});

test("healthy — spec §3.5", () => {
  const h = cashHeadline(computed({ borrowings: "2100000000" }), NONE);
  expect(h).toMatchObject({ variant: "healthy", tone: "ok", emphasis: "58.1% of its borrow cap unused.", rest: "Not close to liquidation." });
  expect(h.dek).toBe("Borrowing $2,100 against a $5,012 cap — 41.9% used. Collateral value would have to fall 58.1% before this account reaches its cap.");
});

test("a floor note rides every Cash dek", () => {
  const floor = "Lookup incomplete: the Aave v3 market (legacy) book is withheld, so more positions may exist.";
  expect(cashHeadline(computed(), { streak: null, floor }).dek.endsWith(` ${floor}`)).toBe(true);
});

test("no position — the definitive negative, spec §3.5", () => {
  expect(noPositionHeadline(18251)).toEqual({
    variant: "no-position",
    tone: "refused",
    emphasis: "No Cash or Aave position in batch 18,251.",
    rest: "",
    dek: "The lookup was complete: every engine was available to be asked and none withheld its book, so this is a definitive answer for this batch.",
  });
});

test("cannot compute — spec §3.5, one or two withheld books, plain causes", () => {
  const one = cannotComputeHeadline([{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "" }]);
  expect(one).toMatchObject({ variant: "cannot-compute", tone: "refused", emphasis: "Cannot say — the Cash book is withheld this batch.", rest: "" });
  expect(one.dek).toBe("Collateral-flag custody unproven. A withheld book is never “no position”: this account may hold a position the service cannot currently read.");
  const two = cannotComputeHeadline([
    { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "" },
    { engine: "aave_v3_etherfi", code: "SWEEP_NEVER", detail: "" },
  ]);
  expect(two.emphasis).toBe("Cannot say — the Cash and Aave v3 market (legacy) books are withheld this batch.");
});

test("not computed, other engine, unavailable, loading, invalid — the honest extras (ruling R6)", () => {
  expect(notComputedHeadline("collateral sweep failed", "$4,100")).toEqual({
    variant: "not-computed",
    tone: "refused",
    emphasis: "Cannot say — this account's Cash position was not computed this batch.",
    rest: "",
    dek: "Collateral sweep failed. Its last readable debt is $4,100; no verdict is served for it.",
  });
  expect(notComputedHeadline("collateral sweep failed", null).dek).toBe("Collateral sweep failed. No verdict is served for it.");
  expect(otherEngineHeadline(18251, ["aave_v3_etherfi"])).toMatchObject({
    variant: "other-engine",
    tone: "refused",
    emphasis: "No Cash position in batch 18,251; a legacy Aave v3 position exists.",
    dek: "The legacy market is judged by its own health factor, below. The two books are never added together.",
  });
  expect(otherEngineHeadline(7, ["morpho_blue"]).emphasis).toBe("No Cash position in batch 7; a position exists on morpho_blue, which this page does not read.");
  expect(unavailableLookupHeadline("no servable batch: the service refuses to answer from nothing (503)")).toEqual({
    variant: "unavailable",
    tone: "refused",
    emphasis: "The lookup could not be completed.",
    rest: "",
    dek: "No servable batch: the service refuses to answer from nothing (503). This is neither “no position” nor a position — an error is not an answer.",
  });
  expect(LOADING_HEADLINE).toEqual({ variant: "loading", tone: "refused", emphasis: "Looking up this address…", rest: "", dek: "Fetching the newest batch." });
  expect(INVALID_HEADLINE).toEqual({
    variant: "invalid",
    tone: "refused",
    emphasis: "Not an address.",
    rest: "",
    dek: "An address is 0x followed by 40 hex characters — nothing else is looked up.",
  });
  expect(engineName("debt_manager")).toBe("Cash");
  expect(engineName("aave_v3_etherfi")).toBe("Aave v3 market (legacy)");
  expect(engineName("morpho_blue")).toBe("morpho_blue");
  expect(engineList(["Cash"])).toBe("Cash");
  expect(engineList(["Cash", "Aave v3 market (legacy)"])).toBe("Cash and Aave v3 market (legacy)");
  expect(engineList(["a", "b", "c"])).toBe("a, b and c");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/inspector-headline.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/inspector-headline.ts
// The Inspector's verdict sentences (spec 2026-09-15 §3.5, plan 2 ruling R6).
// One source per state; the surface renders these strings verbatim and the
// e2e contract pins them. Money through humanUsdFull (never compacted), percents from the position.
import { humanAge } from "./freshness";
import { humanUsdFull } from "./human-price";
import { LEGACY, type ComputedCash } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import type { Streak } from "./room-history";

export type InspectorVariant =
  | "liquidatable"
  | "near"
  | "healthy"
  | "no-position"
  | "cannot-compute"
  | "not-computed"
  | "other-engine"
  | "loading"
  | "unavailable"
  | "invalid";

export interface InspectorHeadline {
  readonly variant: InspectorVariant;
  readonly tone: "crit" | "warn" | "ok" | "refused";
  readonly emphasis: string;
  readonly rest: string;
  readonly dek: string;
}

/** The same words the kit's AddressField shows; kept here so lib never imports a component. */
export const INVALID_ADDRESS_COPY = "An address is 0x followed by 40 hex characters — nothing else is looked up.";

const n = (value: number): string => value.toLocaleString("en-US");
const capitalize = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

export function engineName(wire: string): string {
  if (wire === "debt_manager") return "Cash";
  if (wire === LEGACY) return "Aave v3 market (legacy)";
  return wire;
}

export function engineList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

export function cashHeadline(p: ComputedCash, extras: { streak: Streak | null; floor: string | null }): InspectorHeadline {
  const money = (v: bigint): string => humanUsdFull(v, p.decimals);
  const base = `Borrowing ${money(p.debt)} against a ${money(p.cap)} cap — ${p.usedPercent ?? "—"} used.`;
  const floor = extras.floor === null ? "" : ` ${extras.floor}`;
  if (p.status === "liquidatable") {
    return {
      variant: "liquidatable",
      tone: "crit",
      emphasis: `Liquidatable now — ${money(p.debt)} against a ${money(p.cap)} cap.`,
      rest: "",
      dek: `${base} ${money(-p.room)} over the line: the strict rule is debt > cap.${floor}`,
    };
  }
  if (p.status === "near") {
    const s = extras.streak;
    const streak =
      s !== null && s.batches >= 2
        ? ` It has been within 10% of its cap for the last ${String(s.batches)} batches${s.spanSeconds === null ? "" : ` (≈${humanAge(s.spanSeconds)})`}.`
        : "";
    return {
      variant: "near",
      tone: "warn",
      emphasis: `Within ${money(p.room)} of its borrow cap.`,
      rest: "Not liquidatable yet.",
      dek: `${base} A ${p.roomPercent ?? "—"} fall in collateral value, or ${money(p.room)} more debt, makes this account liquidatable.${streak}${floor}`,
    };
  }
  // near and healthy imply a positive cap (a band exists), so roomPercent is non-null here; the fallback is type honesty only.
  return {
    variant: "healthy",
    tone: "ok",
    emphasis: `${p.roomPercent ?? "—"} of its borrow cap unused.`,
    rest: "Not close to liquidation.",
    dek: `${base} Collateral value would have to fall ${p.roomPercent ?? "—"} before this account reaches its cap.${floor}`,
  };
}

export function noPositionHeadline(batchId: number): InspectorHeadline {
  return {
    variant: "no-position",
    tone: "refused",
    emphasis: `No Cash or Aave position in batch ${n(batchId)}.`,
    rest: "",
    dek: "The lookup was complete: every engine was available to be asked and none withheld its book, so this is a definitive answer for this batch.",
  };
}

export function cannotComputeHeadline(withheld: readonly { engine: string; code: string; detail: string }[]): InspectorHeadline {
  const names = withheld.map((w) => engineName(w.engine));
  const causes = withheld.map((w) => plainCause(w.code, w.detail)).join("; ");
  return {
    variant: "cannot-compute",
    tone: "refused",
    emphasis: `Cannot say — the ${engineList(names)} book${names.length === 1 ? " is" : "s are"} withheld this batch.`,
    rest: "",
    dek: `${capitalize(causes)}. A withheld book is never “no position”: this account may hold a position the service cannot currently read.`,
  };
}

export function notComputedHeadline(cause: string, lastDebt: string | null): InspectorHeadline {
  return {
    variant: "not-computed",
    tone: "refused",
    emphasis: "Cannot say — this account's Cash position was not computed this batch.",
    rest: "",
    dek: `${capitalize(cause)}. ${lastDebt === null ? "No verdict is served for it." : `Its last readable debt is ${lastDebt}; no verdict is served for it.`}`,
  };
}

export function otherEngineHeadline(batchId: number, engines: readonly string[]): InspectorHeadline {
  const legacyOnly = engines.length === 1 && engines[0] === LEGACY;
  return {
    variant: "other-engine",
    tone: "refused",
    emphasis: legacyOnly
      ? `No Cash position in batch ${n(batchId)}; a legacy Aave v3 position exists.`
      : `No Cash position in batch ${n(batchId)}; a position exists on ${engineList(engines.map(engineName))}, which this page does not read.`,
    rest: "",
    dek: legacyOnly
      ? "The legacy market is judged by its own health factor, below. The two books are never added together."
      : "Only the Cash book and the legacy Aave v3 market are read here.",
  };
}

export function unavailableLookupHeadline(message: string): InspectorHeadline {
  return {
    variant: "unavailable",
    tone: "refused",
    emphasis: "The lookup could not be completed.",
    rest: "",
    dek: `${capitalize(message)}. This is neither “no position” nor a position — an error is not an answer.`,
  };
}

export const LOADING_HEADLINE: InspectorHeadline = { variant: "loading", tone: "refused", emphasis: "Looking up this address…", rest: "", dek: "Fetching the newest batch." };
export const INVALID_HEADLINE: InspectorHeadline = { variant: "invalid", tone: "refused", emphasis: "Not an address.", rest: "", dek: INVALID_ADDRESS_COPY };
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/inspector-headline.spec.ts`
Expected: 7 passed. (`plainCause("FLAG_CUSTODY_UNPROVEN", "")` returns `"collateral-flag custody unproven"`; the spec capitalizes it once. If the phrasebook returns a different string for an empty detail, pass `undefined` for empty details.)

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/inspector-headline.ts web/tests/unit/inspector-headline.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Inspector headline grammar - the five spec templates and the honest extra states, pinned verbatim"
```

---

