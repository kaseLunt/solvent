### Task 5: The Book headline grammar

**Files:**
- Create: `web/lib/book-headline.ts`
- Test: `web/tests/unit/book-headline.spec.ts`

**Interfaces:**
- Consumes: `humanUsd` (Task 2), `belowLineSentence` (Task 3).
- Produces:
  - `interface Sum { sum: bigint; count: number }`
  - `interface BookHeadlineInput { decimals: number; material: Sum; belowLine: Sum; nearCap: Sum; notComputed: number }`
  - `interface Headline { variant: "material" | "quiet" | "refused"; tone: "crit" | "ok" | "refused"; emphasis: string; rest: string; dek: string }`
  - `bookHeadline(input): Headline`; `bookHeadlineRefused(cause: string): Headline`
  - `nearCapSentence(nearCap: Sum, decimals): string`; `notComputedSentence(n): string | null` (reused by the Overview strip)

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/book-headline.spec.ts
import { expect, test } from "@playwright/test";
import { bookHeadline, bookHeadlineRefused } from "../../lib/book-headline";

const usd6 = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

test("material: money first, the emphasized phrase carries the verdict", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(6840), count: 2 },
    belowLine: { sum: usd6(112.4), count: 47 },
    nearCap: { sum: usd6(312_400), count: 27 },
    notComputed: 6,
  });
  expect(h.variant).toBe("material");
  expect(h.tone).toBe("crit");
  expect(h.emphasis).toBe("$6,840 of Cash debt is liquidatable right now,");
  expect(h.rest).toBe(" across 2 accounts.");
  expect(h.dek).toBe(
    "47 more positions are technically liquidatable but total $112 — below the $100 line and not headlined. " +
      "27 accounts are within 10% of their borrow cap, carrying $312K. " +
      "6 positions could not be computed this batch and are counted, not hidden.",
  );
});

test("material, singular everywhere", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: usd6(4200), count: 1 },
    belowLine: { sum: 0n, count: 0 },
    nearCap: { sum: 0n, count: 0 },
    notComputed: 1,
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
    material: { sum: 0n, count: 0 },
    belowLine: { sum: 46n, count: 46 },
    nearCap: { sum: 0n, count: 0 },
    notComputed: 0,
  });
  expect(h.variant).toBe("quiet");
  expect(h.tone).toBe("ok");
  expect(h.emphasis).toBe("Nothing material is liquidatable on the Cash book right now.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe(
    "46 more positions are technically liquidatable but total <$0.01 — below the $100 line and not headlined. No account is within 10% of its borrow cap.",
  );
});

test("quiet with nothing liquidatable at all", () => {
  const h = bookHeadline({
    decimals: 6,
    material: { sum: 0n, count: 0 },
    belowLine: { sum: 0n, count: 0 },
    nearCap: { sum: usd6(11_200), count: 3 },
    notComputed: 0,
  });
  expect(h.dek).toBe("No position is liquidatable. 3 accounts are within 10% of their borrow cap, carrying $11K.");
});

test("refused: the whole engine withheld", () => {
  const h = bookHeadlineRefused("collateral-flag custody is unproven for this window");
  expect(h.variant).toBe("refused");
  expect(h.tone).toBe("refused");
  expect(h.emphasis).toBe("The Cash book could not be computed this batch.");
  expect(h.rest).toBe("");
  expect(h.dek).toBe("Collateral-flag custody is unproven for this window.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/book-headline.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/book-headline.ts
import { humanUsd } from "./human-usd";
import { belowLineSentence } from "./materiality";

export interface Sum {
  readonly sum: bigint;
  readonly count: number;
}

export interface BookHeadlineInput {
  readonly decimals: number;
  readonly material: Sum;
  readonly belowLine: Sum;
  readonly nearCap: Sum;
  readonly notComputed: number;
}

export interface Headline {
  readonly variant: "material" | "quiet" | "refused";
  readonly tone: "crit" | "ok" | "refused";
  readonly emphasis: string;
  readonly rest: string;
  readonly dek: string;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

export function nearCapSentence(nearCap: Sum, decimals: number): string {
  if (nearCap.count === 0) return "No account is within 10% of its borrow cap.";
  const one = nearCap.count === 1;
  return `${plural(nearCap.count, "account")} ${one ? "is" : "are"} within 10% of ${one ? "its" : "their"} borrow cap, carrying ${humanUsd(nearCap.sum, decimals)}.`;
}

export function notComputedSentence(n: number): string | null {
  if (n === 0) return null;
  const one = n === 1;
  return `${plural(n, "position")} could not be computed this batch and ${one ? "is" : "are"} counted, not hidden.`;
}

function joinSentences(parts: readonly (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(" ");
}

export function bookHeadline(input: BookHeadlineInput): Headline {
  const below = belowLineSentence({ belowLine: input.belowLine.count }, { belowLine: input.belowLine.sum }, input.decimals);
  const near = nearCapSentence(input.nearCap, input.decimals);
  const notComputed = notComputedSentence(input.notComputed);
  if (input.material.count > 0) {
    return {
      variant: "material",
      tone: "crit",
      emphasis: `${humanUsd(input.material.sum, input.decimals)} of Cash debt is liquidatable right now,`,
      rest: ` across ${plural(input.material.count, "account")}.`,
      dek: joinSentences([below, near, notComputed]),
    };
  }
  return {
    variant: "quiet",
    tone: "ok",
    emphasis: "Nothing material is liquidatable on the Cash book right now.",
    rest: "",
    dek: joinSentences([below ?? "No position is liquidatable.", near, notComputed]),
  };
}

export function bookHeadlineRefused(cause: string): Headline {
  const trimmed = cause.trim();
  const first = trimmed.charAt(0).toUpperCase();
  const sentence =
    trimmed.length === 0 ? "The engine gave no reason." : `${first}${trimmed.slice(1)}${trimmed.endsWith(".") ? "" : "."}`;
  return { variant: "refused", tone: "refused", emphasis: "The Cash book could not be computed this batch.", rest: "", dek: sentence };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/book-headline.spec.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/book-headline.ts web/tests/unit/book-headline.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): book headline grammar - material, quiet and refused variants pinned verbatim"
```

---

