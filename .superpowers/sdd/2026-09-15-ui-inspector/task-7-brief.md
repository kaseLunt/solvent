### Task 7: `address-stress` and `activity-rows` — the two below-the-fold table models

**Files:**
- Create: `web/lib/address-stress.ts`, `web/lib/activity-rows.ts`
- Test: `web/tests/unit/address-stress.spec.ts`, `web/tests/unit/activity-rows.spec.ts`

**Interfaces:**
- Consumes `StressLookup`, `lookup` from `@solvent/client`; `CASH` from `./inspector-position`; `plainCause`; `isWireDecimal`; `ChainEvent`, `EventDisplayType`, `txExplorerUrl` from `./inspector-data`; `feedAmount` from `./feed-view`; `formatBlock`, `renderBlockTime`, `truncateAddress` from `./format`; `humanAmount` from `./human-price`.
- Produces:

```ts
// address-stress.ts
export interface StressSide { readonly debt: bigint | null; readonly cap: bigint | null; readonly room: bigint | null; readonly verdict: "liquidatable" | "not-liquidatable" | "unknowable" }
export interface StressHorizon { readonly seconds: number; readonly extraInterest: bigint | null; readonly verdict: StressSide["verdict"] }
export interface StressRow { readonly id: string; readonly label: string; readonly applicable: boolean; readonly reason: string | null; readonly before: StressSide | null; readonly after: StressSide | null; readonly flips: boolean | null; readonly projection: StressHorizon[] | null }
export type StressReading = { kind: "rows"; rows: StressRow[] } | { kind: "no-position" } | { kind: "withheld"; cause: string };
export function stressReading(lookup: StressLookup, account: string): StressReading;
// activity-rows.ts
export const ACTION_LABEL: Record<EventDisplayType, string>;
export function actionLabel(type: string): string;
export interface ActivityRow { readonly key: string; readonly when: string; readonly timed: boolean; readonly action: string; readonly asset: string; readonly amount: string; readonly amountTitle: string | null; readonly tx: { hash: string; short: string; url: string | null }; readonly detail: string | null }
export function activityRows(events: readonly ChainEvent[]): ActivityRow[];
export function activityTakeaway(timed: number, untimed: number, hasMore: boolean): string; // moved VERBATIM from lib/inspector-lines.ts
```

- [ ] **Step 1: The failing specs**

```ts
// web/tests/unit/address-stress.spec.ts
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup, type components } from "@solvent/client";
import { stressReading } from "../../lib/address-stress";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = <T,>(name: string): T => JSON.parse(readFileSync(path.join(here, "..", "fixtures", name), "utf8")) as T;
const STRESS_DM = load<components["schemas"]["StressResponse"]>("stress-dm.json");
const STRESS_UNKNOWABLE = load<components["schemas"]["StressResponse"]>("stress-unknowable.json");

test("rows: one per scenario, before/after room from cap and debt, the flip, the projection horizons", () => {
  const r = stressReading(lookup(STRESS_DM), STRESS_DM.address);
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows.map((x) => x.id)).toEqual(STRESS_DM.scenarios.map((s) => s.id));
  const rate = r.rows.find((x) => x.id === "dm_rate_horizon_plus_200bps");
  if (rate === undefined) throw new Error("rate row");
  expect(rate.applicable).toBe(true);
  expect(rate.before).toEqual({ debt: 4200000000n, cap: 3200000000n, room: -1000000000n, verdict: "liquidatable" });
  expect(rate.after?.room).toBe(-1000000000n);
  expect(rate.flips).toBe(false); // already liquidatable before → not a flip
  expect(rate.projection?.map((h) => [h.seconds, h.extraInterest, h.verdict])).toEqual([
    [2592000, 6904109n, "liquidatable"],
    [7776000, 20712328n, "liquidatable"],
  ]);
  const depeg = r.rows.find((x) => x.id === "stable_depeg_0995_in_band");
  expect(depeg?.projection).toBeNull();
});

test("a scenario with no result for this account is a non-applicable row with a reason; another account's result is never read", () => {
  const r = stressReading(lookup(STRESS_DM), "0x0000000000000000000000000000000000000001");
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows.every((x) => !x.applicable && x.before === null && x.after === null)).toBe(true);
  expect(r.rows[0]?.reason).toBe("not evaluated for this account");
});

test("a withheld engine is a withheld reading with its plain cause; a definitive negative is no-position", () => {
  const withheld = stressReading(lookup(STRESS_UNKNOWABLE), STRESS_UNKNOWABLE.address);
  expect(withheld.kind).toBe("withheld");
  if (withheld.kind === "withheld") expect(withheld.cause.length).toBeGreaterThan(0);
  const none = lookup({ ...STRESS_DM, found: false, scenarios: [] });
  expect(stressReading(none, STRESS_DM.address).kind).toBe("no-position");
});

test("a flip is before not-liquidatable → after liquidatable; an unknowable side yields null", () => {
  const scenario = STRESS_DM.scenarios[0];
  const result = scenario?.results[0];
  if (scenario === undefined || result === undefined || result.before === null || result.after === null) throw new Error("fixture shape");
  const flipped = {
    ...STRESS_DM,
    scenarios: [{ ...scenario, results: [{ ...result, before: { ...result.before, liquidatable: false, debt_usd: "3000000000" }, after: { ...result.after, liquidatable: true } }] }],
  };
  const r = stressReading(lookup(flipped), STRESS_DM.address);
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows[0]?.flips).toBe(true);
  const unknown = { ...flipped, scenarios: [{ ...scenario, results: [{ ...result, after: { ...result.after, liquidatable: null } }] }] };
  const u = stressReading(lookup(unknown), STRESS_DM.address);
  if (u.kind !== "rows") throw new Error(u.kind);
  expect(u.rows[0]?.flips).toBeNull();
  expect(u.rows[0]?.after?.verdict).toBe("unknowable");
});
```

```ts
// web/tests/unit/activity-rows.spec.ts
import { expect, test } from "@playwright/test";
import { EVENTS } from "../fixtures/inspector";
import { actionLabel, activityRows, activityTakeaway } from "../../lib/activity-rows";

test("rows: a custodied time renders; a null block_time falls back to the block number and is untimed", () => {
  const rows = activityRows(EVENTS.events);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.timed).toBe(true);
  expect(rows[0]?.action).toBe("Liquidation");
  expect(rows[1]?.timed).toBe(false);
  expect(rows[1]?.when).toContain("154,796,490");
  expect(rows[1]?.action).toBe("Borrow");
  expect(rows[1]?.asset).toBe("USDC");
  expect(rows[1]?.tx.url).toBe(`https://optimistic.etherscan.io/tx/${EVENTS.events[1]?.tx_hash ?? ""}`);
  expect(rows[0]?.tx.url).toBe(`https://etherscan.io/tx/${EVENTS.events[0]?.tx_hash ?? ""}`);
  expect(rows[0]?.tx.short).toBe(`${(EVENTS.events[0]?.tx_hash ?? "").slice(0, 10)}…`);
});

test("a liquidation row carries its extract: liquidator, repaid, seized", () => {
  const liq = activityRows(EVENTS.events)[0];
  expect(liq?.detail).toBe("liquidator 0xBBbB…0002 repaid 2,500 USDC; seized 0.6562 weETH");
});

test("amounts come from the feed's own vocabulary; a record-only event prints a dash", () => {
  const rows = activityRows(EVENTS.events);
  expect(rows[1]?.amount.length).toBeGreaterThan(0);
  expect(rows[1]?.amountTitle).not.toBeNull();
  const first = EVENTS.events[0];
  if (first === undefined) throw new Error("fixture");
  const recordOnly = activityRows([{ ...first, amount: null, amount_unit: "none" }])[0];
  expect(recordOnly?.amount).toBe("—");
});

test("action labels are human; an unknown wire word prints verbatim", () => {
  expect(actionLabel("collateral_enabled")).toBe("Collateral enabled");
  expect(actionLabel("deficit_created")).toBe("Deficit created");
  expect(actionLabel("flash_thing")).toBe("flash_thing");
});

// Moved verbatim from tests/unit/inspector-lines.spec.ts (that file is retired in Task 12).
test("activityTakeaway: newest-first is claimed only over timed rows; the untimed tail is disclaimed", () => {
  expect(activityTakeaway(3, 0, false)).toBe("3 custodied action(s) loaded for this account, newest first.");
  expect(activityTakeaway(0, 2, true)).toBe(
    "2 custodied action(s) loaded for this account, none with a custodied header time — their order is not chronology · more exist behind the cursor.",
  );
  expect(activityTakeaway(4, 1, false)).toBe(
    "5 custodied action(s) loaded for this account: 4 with custodied header time, newest first; 1 untimed row(s) follow, in an order that is not chronology.",
  );
});
```

Before writing `activity-rows.spec.ts`, open `web/tests/unit/inspector-lines.spec.ts` and copy its `activityTakeaway` cases verbatim in place of the three above if they differ — the existing pins are the contract; the three shown are the function's documented outputs.

- [ ] **Step 2: Run to see both fail**

Run: `npx playwright test --project=unit tests/unit/address-stress.spec.ts tests/unit/activity-rows.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: `address-stress.ts`**

```ts
// web/lib/address-stress.ts
// The committed scenarios applied to one account (spec 2026-09-15 §5.3
// "Stress this address"), read into table rows. Cash only; the before/after
// states are the wire's own — room is cap − debt on each side.
import type { StressLookup } from "@solvent/client";
import { CASH } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal } from "./wireGuard";

type Scenario = StressLookup["response"]["scenarios"][number];
type Result = Scenario["results"][number];
type State = NonNullable<Result["before"]>;

export interface StressSide {
  readonly debt: bigint | null;
  readonly cap: bigint | null;
  readonly room: bigint | null;
  readonly verdict: State["liquidation_verdict"];
}

export interface StressHorizon {
  readonly seconds: number;
  readonly extraInterest: bigint | null;
  readonly verdict: State["liquidation_verdict"];
}

export interface StressRow {
  readonly id: string;
  readonly label: string;
  readonly applicable: boolean;
  readonly reason: string | null;
  readonly before: StressSide | null;
  readonly after: StressSide | null;
  /** before not liquidatable → after liquidatable. Null when either side is missing or unknowable. */
  readonly flips: boolean | null;
  readonly projection: StressHorizon[] | null;
}

export type StressReading = { kind: "rows"; rows: StressRow[] } | { kind: "no-position" } | { kind: "withheld"; cause: string };

const wireInt = (v: string | null | undefined): bigint | null => (typeof v === "string" && isWireDecimal(v) ? BigInt(v) : null);

function side(state: State | null): StressSide | null {
  if (state === null) return null;
  const debt = wireInt(state.debt_usd);
  const cap = wireInt(state.max_borrow_lt);
  return { debt, cap, room: debt === null || cap === null ? null : cap - debt, verdict: state.liquidation_verdict };
}

function row(scenario: Scenario, account: string): StressRow {
  const result = scenario.results.find((r) => r.engine === CASH && r.account.toLowerCase() === account.toLowerCase());
  if (result === undefined) {
    return { id: scenario.id, label: scenario.label, applicable: false, reason: "not evaluated for this account", before: null, after: null, flips: null, projection: null };
  }
  const before = side(result.before);
  const after = side(result.after);
  const flips =
    before === null || after === null || before.verdict === "unknowable" || after.verdict === "unknowable"
      ? null
      : before.verdict !== "liquidatable" && after.verdict === "liquidatable";
  const projection =
    result.projection === null
      ? null
      : result.projection.horizons.map((h) => ({ seconds: h.horizon_seconds, extraInterest: wireInt(h.additional_interest_usd), verdict: h.liquidation_verdict }));
  return { id: scenario.id, label: scenario.label, applicable: result.applicable, reason: result.reason ?? null, before, after, flips, projection };
}

export function stressReading(lookup: StressLookup, account: string): StressReading {
  if (lookup.outcome === "unknowable") {
    return { kind: "withheld", cause: lookup.withheldEngines.map((w) => plainCause(w.code, w.detail)).join("; ") };
  }
  if (lookup.outcome === "not-found") return { kind: "no-position" };
  return { kind: "rows", rows: lookup.response.scenarios.map((s) => row(s, account)) };
}
```

- [ ] **Step 4: `activity-rows.ts`**

```ts
// web/lib/activity-rows.ts
// This account's chain actions as table rows (spec 2026-09-15 §5.3; plan 2
// ruling R12). Times are custodied header times or nothing — a null
// block_time renders the block number, never an invented clock. Amounts speak
// the feed's own accounting vocabulary (lib/feed-view.ts).
import { feedAmount } from "./feed-view";
import { renderBlockTime, truncateAddress } from "./format";
import { humanAmount } from "./human-price";
import { txExplorerUrl, type ChainEvent, type EventDisplayType } from "./inspector-data";
import { isWireDecimal } from "./wireGuard";

export const ACTION_LABEL: Record<EventDisplayType, string> = {
  borrow: "Borrow",
  repay: "Repay",
  supply: "Supply",
  withdraw: "Withdraw",
  liquidation: "Liquidation",
  collateral_enabled: "Collateral enabled",
  collateral_disabled: "Collateral disabled",
  deficit_created: "Deficit created",
};

export function actionLabel(type: string): string {
  return (ACTION_LABEL as Record<string, string | undefined>)[type] ?? type;
}

export interface ActivityRow {
  readonly key: string;
  readonly when: string;
  readonly timed: boolean;
  readonly action: string;
  readonly asset: string;
  readonly amount: string;
  readonly amountTitle: string | null;
  readonly tx: { hash: string; short: string; url: string | null };
  readonly detail: string | null;
}

const tokenAmount = (value: string | null, decimals: number | null): string | null =>
  value !== null && decimals !== null && isWireDecimal(value) ? humanAmount(BigInt(value), decimals) : null;

function liquidationDetail(event: ChainEvent): string | null {
  const l = event.liquidation;
  if (l === null) return null;
  const repaid = tokenAmount(l.debt_repaid, l.debt_decimals);
  const debtSymbol = event.symbol ?? truncateAddress(l.debt_asset);
  const seized = l.seized
    .map((s) => `${tokenAmount(s.amount, s.decimals) ?? "—"} ${s.symbol ?? truncateAddress(s.asset)}`)
    .join(", ");
  return `liquidator ${truncateAddress(l.liquidator)} repaid ${repaid ?? "—"} ${debtSymbol}${seized === "" ? "" : `; seized ${seized}`}`;
}

export function activityRows(events: readonly ChainEvent[]): ActivityRow[] {
  return events.map((event) => {
    const amount = feedAmount(event);
    return {
      key: `${event.tx_hash}:${String(event.log_index)}:${String(event.seq)}`,
      when: renderBlockTime(event.block_number, event.block_time), // "block 155,315,000" when the header time is not custodied
      timed: event.block_time !== null,
      action: actionLabel(event.type),
      asset: event.symbol ?? (event.asset === null ? "—" : truncateAddress(event.asset)),
      amount: amount.kind === "record-only" ? "—" : `${amount.display}${amount.symbol === null ? "" : ` ${amount.symbol}`}`,
      amountTitle: amount.kind === "record-only" ? "record only: this event carries no amount" : (amount.unitTitle ?? amount.unitChip),
      tx: { hash: event.tx_hash, short: `${event.tx_hash.slice(0, 10)}…`, url: txExplorerUrl(event.chain_id, event.tx_hash) },
      detail: liquidationDetail(event),
    };
  });
}

/**
 * The activity section's takeaway (r74): the feed orders CUSTODIED header
 * times newest-first, but null-time rows form a deterministic untimed TAIL
 * whose internal order is explicitly not chronology — so "newest first" may
 * only be claimed over the rows that carry a time.
 */
export function activityTakeaway(timed: number, untimed: number, hasMore: boolean): string {
  const total = timed + untimed;
  const more = hasMore ? " · more exist behind the cursor" : "";
  if (untimed === 0) {
    return `${String(total)} custodied action(s) loaded for this account, newest first${more}.`;
  }
  if (timed === 0) {
    return (
      `${String(total)} custodied action(s) loaded for this account, none with a custodied ` +
      `header time — their order is not chronology${more}.`
    );
  }
  return (
    `${String(total)} custodied action(s) loaded for this account: ${String(timed)} with ` +
    `custodied header time, newest first; ${String(untimed)} untimed row(s) follow, in an ` +
    `order that is not chronology${more}.`
  );
}
```

If `feedAmount`'s parameter type is narrower than `ChainEvent`, import its type from `./feed-view` and pass `event` through it — the two are the same wire schema (`components["schemas"]["ChainEvent"]`); do not cast through `unknown`. If `FeedAmount`'s fields are named differently from `display` / `unitChip` / `unitTitle` / `symbol`, read `lib/feed-view.ts:60-90` and use its names — the unit spec's assertions are the contract.

- [ ] **Step 5: Run the specs**

Run: `npx playwright test --project=unit tests/unit/address-stress.spec.ts tests/unit/activity-rows.spec.ts`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/address-stress.ts web/lib/activity-rows.ts web/tests/unit/address-stress.spec.ts web/tests/unit/activity-rows.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): stress rows and activity rows for one account - the wire's own sides and units, untimed rows disclaimed"
```

---

