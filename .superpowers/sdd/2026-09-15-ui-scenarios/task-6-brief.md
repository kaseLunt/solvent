### Task 6: `lab-address` — the one-address workspace over the Inspector's reading (R8, R15)

**Files:**
- Create: `web/lib/lab-address.ts`
- Test: `web/tests/unit/lab-address.spec.ts`

**Interfaces:**
- Consumes: `lib/inspector-view.ts` (`InspectorView`, `deriveInspectorView`), `lib/address-stress.ts` (`StressRow`, `StressSide`), `lib/human-price.ts` (`humanUsdFull`), `lib/format.ts` (`truncateAddress`), `lib/wireGuard.ts` (`isWireScale`), `lib/lab-headline.ts` (`LabHeadline`), `lib/inspector-position.ts` (`CashStatus`).
- Produces: `AddressWorkspaceState`, `AddressTile { value, tone }`, `AddressTiles`, `AddressWorkspace`, `addressWorkspace(input: { address: string; view: InspectorView | null; selectedId: string | null }): AddressWorkspace`.

- [ ] **Step 1: The pins (failing)**

```ts
// web/tests/unit/lab-address.spec.ts
// The one-address workspace is the Inspector's own reading: its stress rows,
// its decimals, its Cash position as "today". Every state has a sentence; the
// before/after tiles print the Inspector's registers.
import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView } from "../../lib/inspector-view";
import { addressWorkspace } from "../../lib/lab-address";
import { DEMO_ADDRESS_NEAR, DEMO_NEAR_ADDR, DEMO_STRESS_NEAR } from "../fixtures/demo";
import { ADDRESS_NOT_FOUND, NOT_FOUND_ADDR } from "../fixtures/inspector";

function reading(overrides: Partial<AddressReading>): AddressReading {
  return {
    address: DEMO_NEAR_ADDR,
    valid: true,
    lookup: { phase: "loading" },
    history: { phase: "loading" },
    stress: { phase: "loading" },
    params: { phase: "loading" },
    evidence: null,
    age: { seconds: null, unresolved: false, refreshFailed: false },
    reload: () => {},
    ...overrides,
  };
}
const view = (overrides: Partial<AddressReading>) => deriveInspectorView(reading(overrides), TIER_FALLBACK);
const near = () => view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "ready", value: lookup(DEMO_STRESS_NEAR) } });

test("idle and invalid: no address is a prompt, a bad address is a refusal; nothing is looked up", () => {
  const idle = addressWorkspace({ address: "", view: null, selectedId: null });
  expect(idle.state).toBe("idle");
  expect(idle.headline).toEqual({ emphasis: "Stress one address.", rest: "", tone: "refused", dek: "Enter an address; the committed scenarios are applied to its Cash position." });
  expect(idle.rows).toEqual([]);
  expect(idle.tiles).toBeNull();
  const invalid = addressWorkspace({ address: "0xnope", view: view({ address: "0xnope", valid: false }), selectedId: null });
  expect(invalid.state).toBe("invalid");
  expect(invalid.headline.emphasis).toBe("Not an address.");
  expect(invalid.headline.dek).toBe("An address is 0x followed by exactly 40 hex characters. Nothing was looked up.");
});

test("loading and unavailable follow the lookup, then the stress lookup", () => {
  const l = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({}), selectedId: null });
  expect(l.state).toBe("loading");
  expect(l.headline.emphasis).toBe("Looking up 0x7a3f…c21e…");
  const stressLoading = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) } }), selectedId: null });
  expect(stressLoading.state).toBe("loading");
  expect(stressLoading.headline.emphasis).toBe("Running the committed scenarios for 0x7a3f…c21e…");
  const u = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" } }), selectedId: null });
  expect(u.state).toBe("unavailable");
  expect(u.headline.emphasis).toBe("The lookup for 0x7a3f…c21e could not be completed.");
  expect(u.headline.dek).toBe("Rate limited (429), retry after 30s. Nothing about this address is known from a failed lookup.");
  const su = addressWorkspace({ address: DEMO_NEAR_ADDR, view: view({ lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) }, stress: { phase: "error", message: "rate limited (429), retry after 30s" } }), selectedId: null });
  expect(su.state).toBe("unavailable");
  expect(su.headline.emphasis).toBe("The scenarios for 0x7a3f…c21e could not be run.");
});

test("no position and withheld are the stress reading's own words", () => {
  const none = addressWorkspace({
    address: NOT_FOUND_ADDR,
    view: view({ address: NOT_FOUND_ADDR, lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) }, stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, address: NOT_FOUND_ADDR, found: false, scenarios: [] }) } }),
    selectedId: null,
  });
  expect(none.state).toBe("no-position");
  expect(none.headline.emphasis).toBe(`No Cash position for ${NOT_FOUND_ADDR.slice(0, 6)}…${NOT_FOUND_ADDR.slice(-4)} in batch 1.`);
  expect(none.headline.tone).toBe("refused");
  const withheld = addressWorkspace({
    address: DEMO_NEAR_ADDR,
    view: view({
      lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_NEAR) },
      stress: { phase: "ready", value: lookup({ ...DEMO_STRESS_NEAR, found: null, lookup_complete: false, scenarios: [], withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] }) },
    }),
    selectedId: null,
  });
  expect(withheld.state).toBe("withheld");
  expect(withheld.headline.emphasis).toBe("Cannot say — the Cash book is withheld for 0x7a3f…c21e.");
  expect(withheld.cause).not.toBeNull();
});

test("rows: the demo near account under its three scenarios, the selection, the before/after tiles in the Inspector's registers", () => {
  const w = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "eth_minus_30" });
  expect(w.state).toBe("rows");
  expect(w.rows.map((r) => r.id)).toEqual(DEMO_STRESS_NEAR.scenarios.map((s) => s.id));
  expect(w.selected?.id).toBe("eth_minus_30");
  expect(w.batchId).toBe(18251);
  expect(w.decimals).toBe(6);
  expect(w.headline.emphasis).toBe("0x7a3f…c21e becomes liquidatable under ETH -30 percent.");
  expect(w.headline.tone).toBe("crit");
  expect(w.headline.dek).toMatch(/^Room today \$190\.50; after the shock, over cap by \$[0-9,]+\./);
  const t = w.tiles!;
  expect(t.debtBefore).toEqual({ value: "$4,822", tone: "neutral" });
  expect(t.capBefore).toEqual({ value: "$5,012", tone: "neutral" });
  expect(t.roomBefore).toEqual({ value: "$190.50", tone: "warn" });
  expect(t.statusBefore).toEqual({ value: "Near cap", tone: "warn" });
  expect(t.debtAfter.value).toBe("$4,822");
  expect(t.capAfter.value).toMatch(/^\$[0-9,]+/);
  expect(t.roomAfter.value).toMatch(/^over cap by \$/);
  expect(t.roomAfter.tone).toBe("crit");
  expect(t.statusAfter).toEqual({ value: "Liquidatable", tone: "crit" });
  // A selection the address does not carry falls back to the first row; a null selection too.
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "ghost" }).selected?.id).toBe("eth_minus_30");
  expect(addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: null }).selected?.id).toBe("eth_minus_30");
  // The projection row: no flip within its horizons reads as staying inside the cap, in its own words.
  const proj = addressWorkspace({ address: DEMO_NEAR_ADDR, view: near(), selectedId: "dm_rate_horizon_plus_200bps" });
  expect(proj.selected?.projection).not.toBeNull();
  expect(["ok", "warn", "crit"]).toContain(proj.headline.tone);
});
```

Before Step 3, run once with `console.log(JSON.stringify(w.tiles), w.headline.dek)` in the last test to read the demo's exact after-cap and over-cap figures from `DEMO_STRESS_NEAR`, then replace the two regexes on `dek` and `capAfter` with the literal strings and delete the log. The report states the literals.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-address'`.

- [ ] **Step 3: The module**

```ts
// web/lib/lab-address.ts
// The one-address workspace. It is the Inspector's reading — its stress rows,
// its decimals, its Cash position as today — arranged under the selected
// scenario. No second stress reader exists; the Inspector's laws hold here.
import type { StressRow, StressSide } from "./address-stress";
import { truncateAddress } from "./format";
import { humanUsdFull } from "./human-price";
import type { CashStatus } from "./inspector-position";
import type { InspectorView } from "./inspector-view";
import type { LabHeadline } from "./lab-headline";
import { isWireScale } from "./wireGuard";

export type AddressWorkspaceState = "idle" | "invalid" | "loading" | "unavailable" | "no-position" | "withheld" | "rows";
export type TileTone = "crit" | "warn" | "ok" | "neutral" | "refused";
export interface AddressTile {
  readonly value: string;
  readonly tone: TileTone;
}
export interface AddressTiles {
  readonly debtBefore: AddressTile;
  readonly debtAfter: AddressTile;
  readonly capBefore: AddressTile;
  readonly capAfter: AddressTile;
  readonly roomBefore: AddressTile;
  readonly roomAfter: AddressTile;
  readonly statusBefore: AddressTile;
  readonly statusAfter: AddressTile;
}
export interface AddressWorkspace {
  readonly state: AddressWorkspaceState;
  readonly address: string;
  readonly rows: readonly StressRow[];
  readonly selected: StressRow | null;
  readonly headline: LabHeadline;
  readonly tiles: AddressTiles | null;
  readonly batchId: number | null;
  readonly decimals: number | null;
  readonly cause: string | null;
}

const refused = (emphasis: string, dek: string): LabHeadline => ({ emphasis, rest: "", tone: "refused", dek });
const REFUSED_TILE: AddressTile = { value: "—", tone: "refused" };

function sentence(text: string): string {
  const t = text.trim();
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

function empty(state: AddressWorkspaceState, address: string, headline: LabHeadline, cause: string | null = null): AddressWorkspace {
  return { state, address, rows: [], selected: null, headline, tiles: null, batchId: null, decimals: null, cause };
}

const STATUS_WORD: Record<CashStatus, AddressTile> = {
  liquidatable: { value: "Liquidatable", tone: "crit" },
  near: { value: "Near cap", tone: "warn" },
  healthy: { value: "Healthy", tone: "ok" },
  refused: { value: "Not computed", tone: "refused" },
  unknowable: { value: "Not computed", tone: "refused" },
};

function afterStatus(side: StressSide | null): AddressTile {
  if (side === null || side.verdict === "unknowable") return { value: "Not computed", tone: "refused" };
  return side.verdict === "liquidatable" ? { value: "Liquidatable", tone: "crit" } : { value: "Healthy", tone: "ok" };
}

function roomTile(room: bigint | null, decimals: number, tone: TileTone): AddressTile {
  if (room === null) return REFUSED_TILE;
  if (room < 0n) return { value: `over cap by ${humanUsdFull(-room, decimals)}`, tone: "crit" };
  return { value: humanUsdFull(room, decimals), tone };
}

function roomWords(room: bigint | null, decimals: number): string {
  if (room === null) return "not computed";
  return room < 0n ? `over cap by ${humanUsdFull(-room, decimals)}` : humanUsdFull(room, decimals);
}

function rowHeadline(short: string, row: StressRow, decimals: number): LabHeadline {
  if (!row.applicable) return refused(`${row.label} does not apply to ${short}.`, sentence(row.reason ?? "the engine gave no reason"));
  const before = row.before === null ? "not computed" : roomWords(row.before.room, decimals);
  const after = row.after === null ? "not computed" : roomWords(row.after.room, decimals);
  const dek = `Room today ${before}; after the shock, ${after}.`;
  if (row.flips === null) return refused(`Cannot say whether ${short} becomes liquidatable under ${row.label}.`, `${dek} One side of the comparison is withheld or unknowable.`);
  if (row.flips) return { emphasis: `${short} becomes liquidatable under ${row.label}.`, rest: "", tone: "crit", dek };
  if (row.after?.verdict === "liquidatable") return { emphasis: `${short} is liquidatable today and stays so under ${row.label}.`, rest: "", tone: "crit", dek };
  return { emphasis: `${short} stays inside its cap under ${row.label}.`, rest: "", tone: "ok", dek };
}

export function addressWorkspace(input: { address: string; view: InspectorView | null; selectedId: string | null }): AddressWorkspace {
  const { address, view, selectedId } = input;
  if (view === null || address === "") {
    return empty("idle", address, refused("Stress one address.", "Enter an address; the committed scenarios are applied to its Cash position."));
  }
  const short = truncateAddress(address);
  if (view.state === "invalid") return empty("invalid", address, refused("Not an address.", "An address is 0x followed by exactly 40 hex characters. Nothing was looked up."));
  if (view.state === "loading") return empty("loading", address, refused(`Looking up ${short}…`, "The position first; the committed scenarios follow it."));
  if (view.state === "unavailable") {
    return empty("unavailable", address, refused(`The lookup for ${short} could not be completed.`, `${sentence(view.headline.dek.split(". ")[0] ?? view.headline.dek)} Nothing about this address is known from a failed lookup.`));
  }
  if (view.stressLoad.phase === "loading") return empty("loading", address, refused(`Running the committed scenarios for ${short}…`, "One evaluation per scenario against this batch; nothing is written."));
  if (view.stressLoad.phase === "error") return empty("unavailable", address, refused(`The scenarios for ${short} could not be run.`, `${sentence(view.stressLoad.message)} The position above is unaffected.`));
  const stress = view.stress;
  if (stress === null) return empty("loading", address, refused(`Running the committed scenarios for ${short}…`, "One evaluation per scenario against this batch; nothing is written."));
  const batchId = view.batchId;
  if (stress.kind === "no-position") {
    return empty("no-position", address, refused(`No Cash position for ${short} in batch ${batchId === null ? "?" : String(batchId)}.`, "The lookup is complete: there is nothing to stress."));
  }
  if (stress.kind === "withheld") {
    return empty("withheld", address, refused(`Cannot say — the Cash book is withheld for ${short}.`, `${sentence(stress.cause)} A withheld book is not a computed book.`), stress.cause);
  }
  const rows = stress.rows;
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const decimals = view.decimals !== null && isWireScale(view.decimals) ? view.decimals : null;
  if (selected === null || decimals === null || view.cash === null) {
    return { state: "rows", address, rows, selected, headline: refused(`No scenario applies to ${short}.`, "The stress response carried no scenario for this account."), tiles: null, batchId, decimals, cause: null };
  }
  const money = (v: bigint | null): AddressTile => (v === null ? REFUSED_TILE : { value: humanUsdFull(v, decimals), tone: "neutral" });
  const before = view.cash;
  const roomToneBefore: TileTone = before.status === "liquidatable" ? "crit" : before.status === "near" ? "warn" : "neutral";
  const after = selected.after;
  const tiles: AddressTiles = {
    debtBefore: money(before.debt),
    capBefore: money(before.cap),
    roomBefore: roomTile(before.room, decimals, roomToneBefore),
    statusBefore: STATUS_WORD[before.status],
    debtAfter: money(after?.debt ?? null),
    capAfter: money(after?.cap ?? null),
    roomAfter: after === null ? REFUSED_TILE : roomTile(after.room, decimals, after.verdict === "liquidatable" ? "crit" : "neutral"),
    statusAfter: afterStatus(after),
  };
  return { state: "rows", address, rows, selected, headline: rowHeadline(short, selected, decimals), tiles, batchId, decimals, cause: null };
}
```

`CashPosition.debt/cap/room` are the Plan 2 reader's bigint-or-null fields; `view.cash.status` is `CashStatus`. `truncateAddress` prints `0x7a3f…c21e` (the Inspector's kicker form); if it prints a different width the pins follow it — it is the shared law.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-address.spec.ts`
Expected: 4 passed, after the two regexes are frozen into literals (Step 1's note). If `DEMO_STRESS_NEAR`'s `eth_minus_30` row does not flip the near account, the demo body — not this module — is wrong: report it and stop (the Plan 2 weld pinned "Yes" for that row).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-address.ts web/tests/unit/lab-address.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): lab-address - the one-address workspace over the Inspector's own reading, every state its own sentence, before/after tiles in the account register" -- web/lib/lab-address.ts web/tests/unit/lab-address.spec.ts
```

---
