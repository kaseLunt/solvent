### Task 6: Three small pure modules — stress preview, refusal phrasebook, live-pill words

**Files:**
- Create: `web/lib/stress-preview.ts`, `web/lib/refusal-phrasebook.ts`, `web/lib/live-pill.ts`
- Test: `web/tests/unit/stress-preview.spec.ts`, `web/tests/unit/refusal-phrasebook.spec.ts`, `web/tests/unit/live-pill.spec.ts`
- Read: `web/tests/fixtures/book.ts` (`BOOK`), `web/lib/freshness.ts` (`humanAge`), `web/lib/freshnessTiers.ts` (`FreshnessTier`)

**Interfaces:**
- `stressPreview(waterfall: Schemas["Waterfall"], engine: string): StressPreview` where `StressPreview = { kind: "absent" } | { kind: "refused"; reason: string } | { kind: "view"; scenarioId: string; lines: StressLine[] }` and `StressLine = { shock: string; deltaDebt: bigint; deltaAccounts: number; badDebt: bigint; decimals: number; text: string }`. `shock` is `"ETH −10%"` (axis word + signed percent from `factor / grid_scale`). `text` is `"ETH −10% → +$6,000 liquidatable · 1 account · bad debt $0"` or `"ETH −10% → no new liquidatable debt · bad debt $635.64"`.
- `plainCause(code: string, detail?: string | null): string`.
- `livePillWords(input: { streamState: "idle" | "connecting" | "open" | "waiting" | "closed"; hasBase: boolean; batchId: number | null; ageSeconds: number | null; tier: FreshnessTier | null }): { word: "Live" | "Reconnecting" | "Not connected"; tone: "ok" | "warn" | "dim"; batch: string | null; age: string | null; ageTone: "ok" | "warn" | "crit" | "dim" }`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/stress-preview.spec.ts
import { expect, test } from "@playwright/test";
import { stressPreview } from "../../lib/stress-preview";
import { BOOK } from "../fixtures/book";

test("the committed book fixture previews one line per shocked grid point, per engine", () => {
  const aave = stressPreview(BOOK.waterfall, "aave_v3_etherfi");
  expect(aave.kind).toBe("view");
  if (aave.kind !== "view") return;
  expect(aave.scenarioId).toBe("eth_minus_30");
  expect(aave.lines.map((l) => l.shock)).toEqual(["ETH −10%", "ETH −20%", "ETH −30%", "ETH −40%", "ETH −50%"]);
  expect(aave.lines[0]?.text).toBe("ETH −10% → +$6,000 liquidatable · 1 account · bad debt $0");
  expect(aave.lines[0]?.deltaDebt).toBe(600_000_000_000n);
  expect(aave.lines[0]?.deltaAccounts).toBe(1);

  const dm = stressPreview(BOOK.waterfall, "debt_manager");
  expect(dm.kind).toBe("view");
  if (dm.kind !== "view") return;
  expect(dm.lines[0]?.text).toBe("ETH −10% → no new liquidatable debt · bad debt $635.64");
  expect(dm.lines[0]?.deltaDebt).toBe(0n);
});

test("an engine absent from the grid is absent, never a zero line", () => {
  expect(stressPreview(BOOK.waterfall, "nobody")).toEqual({ kind: "absent" });
});

test("a malformed cumulative figure refuses the whole preview", () => {
  const broken = structuredClone(BOOK.waterfall);
  const at = broken.points[1]?.engines.find((e) => e.engine === "debt_manager");
  if (at === undefined) throw new Error("fixture invariant");
  at.cumulative_debt_eligible_usd = "-0";
  const out = stressPreview(broken, "debt_manager");
  expect(out.kind).toBe("refused");
});
```

```ts
// web/tests/unit/refusal-phrasebook.spec.ts
import { expect, test } from "@playwright/test";
import { plainCause } from "../../lib/refusal-phrasebook";

test("known codes lead with a plain cause; unknown codes fall back to the detail, then the code", () => {
  expect(plainCause("SWEEP_NEVER")).toBe("collateral sweep never ran");
  expect(plainCause("FLAG_CUSTODY_UNPROVEN")).toBe("collateral-flag custody unproven");
  expect(plainCause("G1", "gate G1: no fresh price for weETH")).toBe("gate G1: no fresh price for weETH");
  expect(plainCause("G1")).toBe("refused (G1)");
  expect(plainCause("SWEEP_NEVER", "ignored — the phrasebook wins for known codes")).toBe("collateral sweep never ran");
});
```

```ts
// web/tests/unit/live-pill.spec.ts
import { expect, test } from "@playwright/test";
import { livePillWords } from "../../lib/live-pill";

test("stream words", () => {
  expect(livePillWords({ streamState: "open", hasBase: true, batchId: 18251, ageSeconds: 42, tier: "fresh" })).toEqual({
    word: "Live", tone: "ok", batch: "batch 18,251", age: "42s ago", ageTone: "ok",
  });
  expect(livePillWords({ streamState: "open", hasBase: false, batchId: null, ageSeconds: null, tier: null }).word).toBe("Reconnecting");
  expect(livePillWords({ streamState: "waiting", hasBase: true, batchId: 1, ageSeconds: 5, tier: "fresh" }).word).toBe("Reconnecting");
  expect(livePillWords({ streamState: "closed", hasBase: false, batchId: null, ageSeconds: null, tier: null })).toEqual({
    word: "Not connected", tone: "dim", batch: null, age: null, ageTone: "dim",
  });
});

test("age tone follows the ratified tiers; an unknown age is dim, never a tier color", () => {
  const base = { streamState: "open" as const, hasBase: true, batchId: 7 };
  expect(livePillWords({ ...base, ageSeconds: 200, tier: "aging" }).ageTone).toBe("warn");
  expect(livePillWords({ ...base, ageSeconds: 4000, tier: "stale" }).ageTone).toBe("crit");
  expect(livePillWords({ ...base, ageSeconds: 9000, tier: "critical" }).ageTone).toBe("crit");
  expect(livePillWords({ ...base, ageSeconds: 9000, tier: "critical" }).age).toBe("2h 30m ago");
  expect(livePillWords({ ...base, ageSeconds: null, tier: null })).toMatchObject({ age: null, ageTone: "dim", batch: "batch 7" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test --project=unit tests/unit/stress-preview.spec.ts tests/unit/refusal-phrasebook.spec.ts tests/unit/live-pill.spec.ts`
Expected: all FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// web/lib/stress-preview.ts
import type { components } from "@solvent/client";
import { humanUsd } from "./human-usd";
import { isWireDecimal } from "./wireGuard";

type Schemas = components["schemas"];
type Waterfall = Schemas["Waterfall"];

export interface StressLine {
  readonly shock: string;
  readonly deltaDebt: bigint;
  readonly deltaAccounts: number;
  readonly badDebt: bigint;
  readonly decimals: number;
  readonly text: string;
}

export type StressPreview =
  | { kind: "absent" }
  | { kind: "refused"; reason: string }
  | { kind: "view"; scenarioId: string; lines: StressLine[] };

const AXIS_WORD: Record<string, string> = { eth_usd: "ETH", weeth_usd: "weETH", ethfi_usd: "ETHFI" };

function axisWord(axis: string): string {
  return AXIS_WORD[axis] ?? axis.split("_")[0]?.toUpperCase() ?? axis;
}

/** Signed whole percent of the shock, truncated: factor 0.9e18 over 1e18 → "−10%". */
function shockPercent(factor: bigint, scale: bigint): string {
  const pct = ((factor - scale) * 100n) / scale;
  return pct < 0n ? `−${(-pct).toString()}%` : `+${pct.toString()}%`;
}

export function stressPreview(waterfall: Waterfall, engine: string): StressPreview {
  const points = waterfall.points
    .map((p) => ({ factor: p.factor, at: p.engines.find((e) => e.engine === engine) }))
    .filter((p): p is { factor: string; at: NonNullable<typeof p.at> } => p.at !== undefined);
  const base = points[0];
  if (base === undefined) return { kind: "absent" };
  if (!isWireDecimal(waterfall.grid_scale)) return { kind: "refused", reason: "grid_scale is not a wire decimal" };
  const scale = BigInt(waterfall.grid_scale);
  if (scale <= 0n) return { kind: "refused", reason: "grid_scale must be positive" };
  const fields = ["cumulative_debt_eligible_usd", "cumulative_bad_debt_usd"] as const;
  for (const p of points) {
    if (!isWireDecimal(p.factor)) return { kind: "refused", reason: "a grid factor is not a wire decimal" };
    for (const f of fields) {
      if (!isWireDecimal(p.at[f])) return { kind: "refused", reason: `${f} is not a wire decimal` };
    }
  }
  const decimals = base.at.usd_decimals;
  const baseDebt = BigInt(base.at.cumulative_debt_eligible_usd);
  const baseAccounts = base.at.cumulative_eligible_accounts;
  const word = axisWord(waterfall.axis);
  const lines: StressLine[] = points.slice(1).map((p) => {
    const deltaDebt = BigInt(p.at.cumulative_debt_eligible_usd) - baseDebt;
    const deltaAccounts = p.at.cumulative_eligible_accounts - baseAccounts;
    const badDebt = BigInt(p.at.cumulative_bad_debt_usd);
    const shock = `${word} ${shockPercent(BigInt(p.factor), scale)}`;
    const head =
      deltaDebt > 0n
        ? `+${humanUsd(deltaDebt, decimals)} liquidatable · ${String(deltaAccounts)} account${deltaAccounts === 1 ? "" : "s"}`
        : "no new liquidatable debt";
    return { shock, deltaDebt, deltaAccounts, badDebt, decimals, text: `${shock} → ${head} · bad debt ${humanUsd(badDebt, decimals)}` };
  });
  return { kind: "view", scenarioId: waterfall.scenario_id, lines };
}
```

```ts
// web/lib/refusal-phrasebook.ts
/** Wire refusal code → the plain cause a reader sees first (spec §3.2). The code itself is shown on hover / in evidence. */
const PHRASEBOOK: Record<string, string> = {
  SWEEP_NEVER: "collateral sweep never ran",
  SWEEP_FAILED: "collateral sweep failed",
  FLAG_CUSTODY_UNPROVEN: "collateral-flag custody unproven",
  STALE_PRICE: "price input past its freshness ceiling",
  PRICE_STALE: "price input past its freshness ceiling",
  NO_COMPARATOR: "no liquidation rule applies to this position",
};

export function plainCause(code: string, detail?: string | null): string {
  const known = PHRASEBOOK[code];
  if (known !== undefined) return known;
  if (typeof detail === "string" && detail.trim().length > 0) return detail.trim();
  return `refused (${code})`;
}
```

```ts
// web/lib/live-pill.ts
import { humanAge } from "./freshness";
import type { FreshnessTier } from "./freshnessTiers";

export interface LivePillInput {
  readonly streamState: "idle" | "connecting" | "open" | "waiting" | "closed";
  readonly hasBase: boolean;
  readonly batchId: number | null;
  readonly ageSeconds: number | null;
  readonly tier: FreshnessTier | null;
}

export interface LivePillWords {
  readonly word: "Live" | "Reconnecting" | "Not connected";
  readonly tone: "ok" | "warn" | "dim";
  readonly batch: string | null;
  readonly age: string | null;
  readonly ageTone: "ok" | "warn" | "crit" | "dim";
}

const TIER_TONE: Record<FreshnessTier, "ok" | "warn" | "crit"> = { fresh: "ok", aging: "warn", stale: "crit", critical: "crit" };

export function livePillWords(input: LivePillInput): LivePillWords {
  const connected = input.streamState === "open" && input.hasBase;
  const reconnecting = input.streamState === "connecting" || input.streamState === "waiting" || (input.streamState === "open" && !input.hasBase);
  const word = connected ? "Live" : reconnecting ? "Reconnecting" : "Not connected";
  const tone = connected ? "ok" : reconnecting ? "warn" : "dim";
  const batch = input.batchId === null ? null : `batch ${input.batchId.toLocaleString("en-US")}`;
  const age = input.ageSeconds === null ? null : `${humanAge(input.ageSeconds)} ago`;
  const ageTone = input.ageSeconds === null || input.tier === null ? "dim" : TIER_TONE[input.tier];
  return { word, tone, batch, age, ageTone };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test --project=unit tests/unit/stress-preview.spec.ts tests/unit/refusal-phrasebook.spec.ts tests/unit/live-pill.spec.ts && npm run typecheck`
Expected: 3 + 1 + 2 passed; typecheck exit 0. If the `Waterfall` point engine type names differ (`cumulative_eligible_accounts` etc.), read `grep -n "cumulative_" ../packages/client-ts/src/generated/schema.ts` and use the generated names — the fixture `book.json` is the authority for values.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/stress-preview.ts web/lib/refusal-phrasebook.ts web/lib/live-pill.ts web/tests/unit/stress-preview.spec.ts web/tests/unit/refusal-phrasebook.spec.ts web/tests/unit/live-pill.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): stress preview lines, refusal phrasebook, live-pill words - pure and pinned"
```

---

