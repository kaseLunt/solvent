# UI Overhaul Phase 0 — Trust Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the five cross-page-brief trust fixes against the current UI: address-bound stress results, outcome-aware matrix cells, the Health boundary price rename, engine-specific ratio terminology, and always-visible snapshot freshness separated from stream state.

**Architecture:** Each fix is a pure decision function (unit-tested) plus a thin render wiring (e2e-pinned), following the repo's decision-module pattern (`matrixCells.ts`, `tornadoLines.ts`, `freshness.ts`). No backend, API-contract, or chart changes. Three disjoint-path workstreams — Lab (Tasks 1–2), Inspector/Book (Tasks 3–4), shared header (Task 5) — may build in parallel; commits land serially in task order.

**Tech Stack:** Next.js 16 (app router), TypeScript, CSS modules, Playwright (unit project = pure functions, e2e project = mocked-API browser tests), `@solvent/client` (file: package).

## Global Constraints

- **Spec authority:** `docs/specs/2026-08-09-ui-overhaul-program-design.md` (Phase 0 section) and `docs/specs/2026-08-09-cross-page-ui-brief.md` (result-identity contract, §5).
- **Preservation boundary:** no backend, calculation, API-contract, or brand changes. Display/client logic only.
- **All spawned agents run `model: 'fable'`.**
- **Code edits use Serena symbolic tools** (`find_symbol`, `replace_symbol_body`, `insert_after_symbol`, `replace_content`) — executors should be `serena-coder`-style agents; Grep/Read only for discovery, plain Edit only where Serena cannot express the change (CSS, JSON, small in-method tweaks).
- **Test-first:** every behavioral change lands with its pin written red first. Every new pin gets a mutation kill observed AT ITS OWN ASSERTION in isolation ("a kill you did not SEE fail at its own assertion is not a kill" — `.superpowers/sdd/progress-phase3.md`).
- **Fixture provenance law:** fixtures are generated from contract artifacts, never hand-shaped (`web/tests/fixtures/generate.mjs` header). In-spec variants must be a `structuredClone` of a committed fixture with exactly one documented change, commented with the field and reason.
- **Badge strings are frozen this phase:** `LIVE · WATERMARKED`, `STREAM · *`, `NO SERVABLE BATCH` must not change (they carry ~30 pins and the Phase 1 status model owns any renaming). Task 5 adds a *separate* snapshot chip instead.
- **Retired pins get a ledger note** in `.superpowers/sdd/progress-ui-overhaul.md` (created by Task 1, appended by later tasks).
- **Build/test commands** (from `web/`): `npm run build` then `npx playwright test -c tests/playwright.p0.config.ts <spec>` (isolated server, port 3818). Full suite before each commit's final step: the affected spec files at minimum; full 1362-test suite at Task 6.
- **Commits:** repo style `fix(web): p0-N <what>` / `test(web): p0-N <what>`. NO Co-Authored-By lines. Claim lease must be active (`python roadmap/tools/claim.py renew claude-integrator --hours 24` if doctor reports expiry); the lease is committed separately and in isolation when renewed.
- **Landing order is task order** (1 → 6) even though workstreams build in parallel.
- Scout line numbers cited below were verified 2026-08-09; re-anchor with Serena before editing (symbols are authoritative, line numbers are hints).

---

### Task 0: Phase 0 wave config

**Files:**
- Create: `web/tests/playwright.p0.config.ts`

**Interfaces:**
- Produces: the isolated-server Playwright config every later task's test steps use (`-c tests/playwright.p0.config.ts`).

- [ ] **Step 1: Write the config** — copy the shape of `web/tests/playwright.r4.config.ts` (the newest wave config), change the port to **3818**, drop the `testIgnore` line (its proof-contract exclusion belonged to a finished contract train), and update the header comment:

```ts
// Phase 0 (UI-overhaul trust fixes) verification config.
// Own port + reuseExistingServer OFF so every run boots a server against the
// build it just made. Invoke: npm run build && npx playwright test -c tests/playwright.p0.config.ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3818;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "unit", testMatch: "**/unit/**/*.spec.ts" },
    {
      name: "e2e",
      testMatch: "**/e2e/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT}` },
    },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
```

Before writing, Read `web/tests/playwright.r4.config.ts` and mirror any option it carries that the block above lacks (e.g. `outputDir`, reporter) — the wave configs are deliberately uniform; match them exactly except port/comment/testIgnore.

- [ ] **Step 2: Verify the config loads** — Run: `cd web && npx playwright test -c tests/playwright.p0.config.ts --list | tail -2`
Expected: `Total: 1362 tests in 78 files` (same inventory as the default config; no server boots for --list).

- [ ] **Step 3: Commit**

```bash
git add web/tests/playwright.p0.config.ts
git commit -m "test(web): p0-0 phase-0 wave config on port 3818"
```

---

### Task 1: Lab — address-bound stress results (the P0)

The defect: `web/app/lab/LabClient.tsx` keeps a settled `StressPhase` fully rendered while the input is edited to a different address — `onChange` only calls `setInput(...)`; no code path compares `input` to `phase.addr`. The rendered result also never names its address.

The fix: a pure binding decision — when the input no longer equals the settled phase's address, the result body is replaced by a stale barrier naming the old address; when it matches, the result is rendered *with* a visible address-binding line. Retyping the exact old address restores the result (pure derivation, no data destruction — supersession-over-deletion is house law).

**Files:**
- Create: `web/app/lab/addressBinding.ts`
- Create: `web/tests/unit/address-binding.spec.ts`
- Create: `web/tests/e2e/p0-fixes.spec.ts`
- Modify: `web/app/lab/LabClient.tsx` (StressPhase type at lines ~50–54, address section render at ~248–313)
- Modify: `web/app/lab/lab.module.css`
- Create: `.superpowers/sdd/progress-ui-overhaul.md` (the Phase 0 ledger)

**Interfaces:**
- Consumes: `StressPhase` (currently a local type in `LabClient.tsx`; this task MOVES it), `StressLookup` from `@solvent/client` (mirror LabClient's existing import path for it).
- Produces: `addressBinding(input: string, phase: StressPhase): AddressBinding`, `staleBarrierLine(addr: string): string`, `boundResultLine(addr: string): string`, exported type `StressPhase` — Task 2 does not consume these; nothing else does. Testids produced: `lab-stale-result`, `lab-result-address`.

- [ ] **Step 1: Write the failing unit spec** — `web/tests/unit/address-binding.spec.ts`:

```ts
// Phase 0 fix 1 (cross-page brief §5, result identity): a settled stress result
// binds to the address it was computed for. Editing the input away from that
// address must yield "stale"; matching input yields "current"; unsettled
// phases bind nothing. Pure-function pins — the e2e pins in p0-fixes.spec.ts
// hold the render consequences.
import { expect, test } from "@playwright/test";
import {
  addressBinding,
  boundResultLine,
  staleBarrierLine,
  type StressPhase,
} from "../../app/lab/addressBinding";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const done = (addr: string): StressPhase =>
  ({ status: "done", addr, result: {} as never });
const errored = (addr: string): StressPhase =>
  ({ status: "error", addr, message: "boom" });

test("idle and loading phases bind nothing", () => {
  expect(addressBinding(A, { status: "idle" })).toEqual({ kind: "none" });
  expect(addressBinding(A, { status: "loading", addr: A })).toEqual({ kind: "none" });
});

test("done phase with matching input is current", () => {
  expect(addressBinding(A, done(A))).toEqual({ kind: "current", addr: A });
});

test("done phase with edited input is stale and names the RESULT address", () => {
  expect(addressBinding(B, done(A))).toEqual({ kind: "stale", addr: A });
});

test("error phase binds the same way as done", () => {
  expect(addressBinding(A, errored(A))).toEqual({ kind: "current", addr: A });
  expect(addressBinding(B, errored(A))).toEqual({ kind: "stale", addr: A });
});

test("retyping the original address restores current (pure round-trip)", () => {
  const phase = done(A);
  expect(addressBinding(B, phase).kind).toBe("stale");
  expect(addressBinding(A, phase).kind).toBe("current");
});

test("barrier and binding lines name the address verbatim", () => {
  expect(staleBarrierLine(A)).toContain(A);
  expect(staleBarrierLine(A)).toContain("PREVIOUS INPUT");
  expect(boundResultLine(A)).toBe(`results for ${A}`);
});
```

- [ ] **Step 2: Run it red** — Run: `cd web && npx playwright test -c tests/playwright.p0.config.ts tests/unit/address-binding.spec.ts`
Expected: FAIL — cannot resolve `../../app/lab/addressBinding`.

- [ ] **Step 3: Write the module** — `web/app/lab/addressBinding.ts`:

```ts
// Phase 0 fix 1: the result-identity binding for the Lab's single-address mode.
// A settled stress result belongs to the address it was dispatched for
// (phase.addr, captured at submit). The input box is NOT part of the result's
// identity — so the moment they disagree, the render must stop presenting the
// result as an answer for what is in the box (cross-page brief §5).
import type { StressLookup } from "@solvent/client";

export type StressPhase =
  | { status: "idle" }
  | { status: "loading"; addr: string }
  | { status: "done"; addr: string; result: StressLookup }
  | { status: "error"; addr: string; message: string };

export type AddressBinding =
  | { kind: "none" }
  | { kind: "current"; addr: string }
  | { kind: "stale"; addr: string };

export function addressBinding(input: string, phase: StressPhase): AddressBinding {
  if (phase.status !== "done" && phase.status !== "error") return { kind: "none" };
  return input === phase.addr
    ? { kind: "current", addr: phase.addr }
    : { kind: "stale", addr: phase.addr };
}

export function staleBarrierLine(addr: string): string {
  return `RESULTS FOR PREVIOUS INPUT · ${addr} · the box above no longer matches these results — run committed set to answer for the new address`;
}

export function boundResultLine(addr: string): string {
  return `results for ${addr}`;
}
```

If `StressLookup` is not exported from the package root, mirror whatever import `LabClient.tsx` currently uses for it (Serena: `find_symbol StressLookup` in `packages/client-ts/src`).

- [ ] **Step 4: Run unit green** — same command as Step 2. Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing e2e pins** — create `web/tests/e2e/p0-fixes.spec.ts`. Copy the `fixture(name)` helper, the API-origin constant, the CORS-header mock shape, the `**/v1/stream**` abort, and the hydration-race fill idiom (`await expect(async () => { await input.fill(addr); await expect(button).toBeEnabled({ timeout: 250 }); }).toPass();`) from `web/tests/e2e/lab.spec.ts` — read its `mockCold`/stress-mock helpers first and reuse the exact same fixture files it uses for a `found` stress result. Then add:

```ts
test.describe("p0-1 · address-bound stress results", () => {
  test("editing the input raises the stale barrier and hides the result; retyping restores it", async ({ page }) => {
    await mockCold(page);           // same helper shape as lab.spec.ts
    await mockStress(page);         // serves the found-stress fixture for ADDR
    await page.goto("/lab");
    await page.getByTestId("mode-address").click();
    const input = page.getByTestId("lab-address-input");
    const button = page.getByTestId("run-stress-button");
    await expect(async () => {
      await input.fill(ADDR);
      await expect(button).toBeEnabled({ timeout: 250 });
    }).toPass();
    await button.click();
    await expect(page.getByTestId("lab-found")).toBeVisible();
    // the settled result names its address
    await expect(page.getByTestId("lab-result-address")).toContainText(`results for ${ADDR}`);
    // edit one character: barrier up, result body gone
    await input.fill(ADDR.slice(0, -1) + "0");
    const barrier = page.getByTestId("lab-stale-result");
    await expect(barrier).toBeVisible();
    await expect(barrier).toContainText("RESULTS FOR PREVIOUS INPUT");
    await expect(barrier).toContainText(ADDR);
    await expect(page.getByTestId("lab-found")).toHaveCount(0);
    // retype the exact original address: result restored, barrier gone
    await input.fill(ADDR);
    await expect(page.getByTestId("lab-found")).toBeVisible();
    await expect(page.getByTestId("lab-stale-result")).toHaveCount(0);
  });

  test("the error state is barriered the same way", async ({ page }) => {
    await mockCold(page);
    await mockStressFailure(page);  // route the stress GET to a 500 envelope fixture, as lab.spec.ts's failure tests do
    await page.goto("/lab");
    await page.getByTestId("mode-address").click();
    const input = page.getByTestId("lab-address-input");
    const button = page.getByTestId("run-stress-button");
    await expect(async () => {
      await input.fill(ADDR);
      await expect(button).toBeEnabled({ timeout: 250 });
    }).toPass();
    await button.click();
    await expect(page.getByTestId("lab-error")).toBeVisible();
    await input.fill(ADDR.slice(0, -1) + "0");
    await expect(page.getByTestId("lab-stale-result")).toBeVisible();
    await expect(page.getByTestId("lab-error")).toHaveCount(0);
  });
});
```

`ADDR` = the found-arm address `lab.spec.ts` already uses with its stress fixture (read it from that spec — do not invent one). File header comment: what p0-fixes pins, one line per fix, each tagged `p0-N`.

- [ ] **Step 6: Run e2e red** — Run: `cd web && npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts`
Expected: FAIL — `lab-result-address` and `lab-stale-result` testids do not exist.

- [ ] **Step 7: Wire the render** — in `web/app/lab/LabClient.tsx` (Serena on the component):
  1. Delete the local `StressPhase` type (lines ~50–54); `import { addressBinding, boundResultLine, staleBarrierLine, type StressPhase } from "./addressBinding";`.
  2. Inside the component, after the existing state declarations: `const binding = addressBinding(input, phase);`.
  3. In the address-section render (~lines 305–313), gate the settled branches: where the current code renders the error text and `StressResult`, wrap with the binding:

```tsx
{binding.kind === "stale" ? (
  <p data-testid="lab-stale-result" className={styles.staleBarrier}>
    {staleBarrierLine(binding.addr)}
  </p>
) : (
  <>
    {phase.status === "error" ? /* existing error render, unchanged */ : null}
    {phase.status === "done" ? (
      <>
        <p data-testid="lab-result-address" className={styles.resultAddress}>
          {boundResultLine(phase.addr)}
        </p>
        {/* existing <StressResult …/> render, unchanged */}
      </>
    ) : null}
  </>
)}
```

  Idle/loading branches stay exactly as they are (binding is `none` there; do not touch them).

- [ ] **Step 8: Style the two new lines** — in `web/app/lab/lab.module.css` add `.staleBarrier` and `.resultAddress`. Copy the declaration block of the existing warn-toned notice class used by the tornado deep-link notice (find the class the `tornado-deeplink-notice` element uses in `LabTornado.tsx` / `LabBookPanel.tsx` and mirror its color/border custom properties) for `.staleBarrier`; `.resultAddress` mirrors the muted mono line class used by the batch stamp (`LabBatchStamp.tsx`'s class). Do not invent new color tokens.

- [ ] **Step 9: Run e2e green** — Run: `cd web && npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts tests/e2e/lab.spec.ts tests/e2e/state-matrix.spec.ts`
Expected: PASS. (`lab.spec.ts`/`state-matrix.spec.ts` guard against collateral damage — their address-mode pins don't edit the input after submit, so they should stay green; if any fails, the failure is a real regression in this wiring, not a pin to retire.)

- [ ] **Step 10: Mutation kill (in isolation)** — apply this single mutant to `addressBinding.ts`: replace the return with `return { kind: "current", addr: phase.addr };` (comparison deleted). Run: `npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts -g "stale barrier"` — MUST fail at the `lab-stale-result` visibility assertion. Then `npx playwright test -c tests/playwright.p0.config.ts tests/unit/address-binding.spec.ts` — MUST fail at the "edited input is stale" assertion. Revert the mutant. Record both kills in the transcript (Task 6 formalizes it).

- [ ] **Step 11: Open the ledger + commit** — create `.superpowers/sdd/progress-ui-overhaul.md`:

```markdown
# UI Overhaul program ledger

Program spec: docs/specs/2026-08-09-ui-overhaul-program-design.md

## Phase 0 — trust fixes

### p0-1 address-bound stress results (LabClient)
- New pins: tests/unit/address-binding.spec.ts (6), p0-fixes.spec.ts p0-1 (2 e2e).
- Retired pins: none.
- Mutants: comparison-deletion in addressBinding — killed at lab-stale-result
  visibility (e2e) and at the stale-arm equality (unit), each in isolation.
```

```bash
git add web/app/lab/addressBinding.ts web/app/lab/LabClient.tsx web/app/lab/lab.module.css web/tests/unit/address-binding.spec.ts web/tests/e2e/p0-fixes.spec.ts .superpowers/sdd/progress-ui-overhaul.md
git commit -m "fix(web): p0-1 stress results bind to their address - stale input raises a barrier, settled results name their address"
```

---

### Task 2: Lab — outcome-aware matrix cells

The defect: a settled matrix cell prints only `eligible_debt_delta_usd` + net eligible accounts. `bad_debt_delta_usd` and `market_realization.execution_shortfall_usd` exist on the same `LabRunBookEngine` object but never reach the cell — so a cell can read "$0" while the scenario produced bad debt or execution shortfall (brief: "Scenario matrix cells that show $0 while other material outcomes exist").

The fix: a pure `cellPrimaryOutcome(engine)` in `matrixCells.ts` composing every NONZERO outcome dimension into the cell's sub-line, with a "no effective movement" quiet arm.

**Files:**
- Modify: `web/app/lab/matrixCells.ts` (append the new section at the end)
- Modify: `web/app/lab/LabMatrix.tsx` (`Cell` component, `result` arm at ~lines 143–167)
- Create: `web/tests/unit/matrix-outcome.spec.ts`
- Modify: `web/tests/e2e/p0-fixes.spec.ts` (add the p0-2 describe)
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: `LabRunBookEngine` from `web/lib/runbook.ts` (already imported by `matrixCells.ts`); the `usd(value, decimals)` formatter `LabMatrix.tsx` already imports (reuse the same import — find it with Serena, do not add a second formatter).
- Produces: `cellPrimaryOutcome(engine: LabRunBookEngine): CellOutcome` where `CellOutcome = { kind: "movement"; parts: string[] } | { kind: "quiet" }`, and `CELL_QUIET_LINE = "no effective movement"` — consumed only by `LabMatrix.tsx`.

- [ ] **Step 1: Read the current sub-line pins** — Run: `cd web && grep -rn "net eligible accounts" tests/` and `grep -rn "matrix-cell" tests/e2e/ | head -20`. List every spec pinning the settled cell's sub-line. These pins are UPDATED (not retired) in Step 7 — the sub-line gains outcome parts but keeps `net eligible accounts …` and `batch #…` so most pins survive; record any that must change in the ledger.

- [ ] **Step 2: Write the failing unit spec** — `web/tests/unit/matrix-outcome.spec.ts`:

```ts
// Phase 0 fix 2: a settled matrix cell must surface EVERY nonzero outcome
// dimension of its engine result — Δ eligible debt alone is an incomplete
// account when bad debt or execution shortfall moved (cross-page brief,
// immediate trust fixes item 4).
import { expect, test } from "@playwright/test";
import { CELL_QUIET_LINE, cellPrimaryOutcome } from "../../app/lab/matrixCells";
import type { LabRunBookEngine } from "../../lib/runbook";

// Minimal engine skeleton: only the fields cellPrimaryOutcome reads.
// usd_decimals 2 keeps expectations legible.
function engine(over: Partial<LabRunBookEngine>): LabRunBookEngine {
  return {
    engine: "aave_v3_etherfi",
    usd_decimals: 2,
    eligible_debt_delta_usd: "0",
    bad_debt_delta_usd: "0",
    newly_eligible_accounts: 0,
    market_realization: null,
    ...over,
  } as LabRunBookEngine;
}

test("all-zero engine is quiet", () => {
  expect(cellPrimaryOutcome(engine({}))).toEqual({ kind: "quiet" });
  expect(CELL_QUIET_LINE).toBe("no effective movement");
});

test("nonzero bad debt surfaces even when eligible debt is zero", () => {
  const out = cellPrimaryOutcome(engine({ bad_debt_delta_usd: "15900" }));
  expect(out.kind).toBe("movement");
  expect((out as { parts: string[] }).parts.join(" · ")).toContain("Δ bad debt");
});

test("execution shortfall surfaces even when every delta is zero", () => {
  const out = cellPrimaryOutcome(
    engine({
      market_realization: {
        hfs_unchanged: true,
        execution_shortfall_usd: "3864",
        bad_debt_at_liquidation_usd: "0",
        usd_decimals: 2,
        seizure_model: "pro-rata-over-counted-collateral",
        note: "",
      },
    }),
  );
  expect(out.kind).toBe("movement");
  expect((out as { parts: string[] }).parts.join(" · ")).toContain("execution shortfall");
});

test("negative deltas count as movement (DELTA-ONLY can be negative)", () => {
  const out = cellPrimaryOutcome(engine({ eligible_debt_delta_usd: "-5" }));
  expect(out.kind).toBe("movement");
});

test("parts order is fixed: newly eligible, Δ eligible debt, Δ bad debt, shortfall", () => {
  const out = cellPrimaryOutcome(
    engine({
      newly_eligible_accounts: 2,
      eligible_debt_delta_usd: "100",
      bad_debt_delta_usd: "200",
      market_realization: {
        hfs_unchanged: false,
        execution_shortfall_usd: "300",
        bad_debt_at_liquidation_usd: "0",
        usd_decimals: 2,
        seizure_model: "pro-rata-over-counted-collateral",
        note: "",
      },
    }),
  ) as { kind: "movement"; parts: string[] };
  expect(out.parts).toHaveLength(4);
  expect(out.parts[0]).toContain("newly eligible");
  expect(out.parts[1]).toContain("Δ eligible debt");
  expect(out.parts[2]).toContain("Δ bad debt");
  expect(out.parts[3]).toContain("execution shortfall");
});
```

Adjust the skeleton if `LabRunBookEngine` requires more fields to satisfy the cast cleanly — keep the cast (`as LabRunBookEngine`) so the skeleton stays minimal.

- [ ] **Step 3: Run unit red** — `npx playwright test -c tests/playwright.p0.config.ts tests/unit/matrix-outcome.spec.ts`. Expected: FAIL — `cellPrimaryOutcome` not exported.

- [ ] **Step 4: Implement** — append to `web/app/lab/matrixCells.ts` (Serena `insert_after_symbol` on the last exported symbol):

```ts
// ————— Phase 0 fix 2: the cell's primary-outcome composition —————
// A settled cell must not read "$0" while ANY outcome dimension moved.
// Wire deltas are integer decimal strings scaled by usd_decimals; zero is
// any string whose digits are all zero (sign irrelevant).
export const CELL_QUIET_LINE = "no effective movement";

export type CellOutcome =
  | { kind: "movement"; parts: string[] }
  | { kind: "quiet" };

function isZeroDecimal(value: string): boolean {
  return /^-?0*\.?0*$/.test(value);
}

export function cellPrimaryOutcome(engine: LabRunBookEngine): CellOutcome {
  const parts: string[] = [];
  if (engine.newly_eligible_accounts !== 0) {
    parts.push(`${renderSignedCount(engine.newly_eligible_accounts)} newly eligible`);
  }
  if (!isZeroDecimal(engine.eligible_debt_delta_usd)) {
    parts.push(`Δ eligible debt ${usd(engine.eligible_debt_delta_usd, engine.usd_decimals)}`);
  }
  if (!isZeroDecimal(engine.bad_debt_delta_usd)) {
    parts.push(`Δ bad debt ${usd(engine.bad_debt_delta_usd, engine.usd_decimals)}`);
  }
  const mr = engine.market_realization;
  if (mr && !isZeroDecimal(mr.execution_shortfall_usd)) {
    parts.push(`execution shortfall ${usd(mr.execution_shortfall_usd, mr.usd_decimals)}`);
  }
  return parts.length === 0 ? { kind: "quiet" } : { kind: "movement", parts };
}
```

`renderSignedCount` and `usd`: locate the existing helpers (Serena `find_symbol renderSignedCount` — it lives where `LabMatrix.tsx` gets it; `usd` likewise). If they live in `LabMatrix.tsx` rather than an importable module, move nothing — instead have `cellPrimaryOutcome` accept them is WRONG (keep it dependency-free): import them from their module; if they are module-private to LabMatrix.tsx, relocate the two helpers into `matrixCells.ts` and re-export to LabMatrix (Serena `find_referencing_symbols` after the move to confirm no other consumer broke).

- [ ] **Step 5: Run unit green** — same command. Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing e2e pin** — append to `p0-fixes.spec.ts`:

```ts
test.describe("p0-2 · outcome-aware matrix cells", () => {
  test("a run with bad debt and shortfall surfaces both in the cell; a quiet run says so", async ({ page }) => {
    await mockCold(page);
    // Single documented change to the committed run-book fixture: the first
    // engine's bad_debt_delta_usd raised from its committed value to "15900"
    // and market_realization.execution_shortfall_usd to "3864" — the exact
    // fields fix p0-2 must surface. Everything else byte-identical.
    const body = structuredClone(RUN_BOOK_200);
    body.engines[0].bad_debt_delta_usd = "15900";
    if (body.engines[0].market_realization) {
      body.engines[0].market_realization.execution_shortfall_usd = "3864";
    }
    await mockRunBook(page, body);   // same POST-mock shape lab.spec.ts uses (CORS + OPTIONS)
    await page.goto("/lab");
    const runButtons = page.getByTestId("matrix-run");
    await runButtons.first().click();
    const cell = page.getByTestId(matrixCellTestId).first();   // read the settled cell's testid from LabMatrix.tsx
    await expect(cell).toContainText("Δ bad debt");
    await expect(cell).toContainText("execution shortfall");
  });
});
```

Before writing: read `lab.spec.ts`'s run-book mock helper and the settled cell's actual testid/selector in `LabMatrix.tsx` (the Cell renders `data-testid` — use the real name). `RUN_BOOK_200` = the committed run-book fixture `lab.spec.ts` loads. If `market_realization` is null in the committed fixture, set the whole object in the clone (all seven fields, values from the openapi `Shortfall` example) — still one documented variant. Add a second test asserting the quiet arm: mock a run-book response whose engine deltas are all "0" (single documented variant zeroing `eligible_debt_delta_usd` and `newly_eligible_accounts`) and pin `toContainText("no effective movement")`.

- [ ] **Step 7: Run e2e red, wire the render, run green** — red first (cell lacks the text). Then in `LabMatrix.tsx`'s `Cell` result arm (~143–167): keep the top value (`usd(eligible_debt_delta_usd, …)`) and the `title` attr unchanged; replace the sub-line composition so it renders `cellPrimaryOutcome(state.engine)`: quiet → `${CELL_QUIET_LINE} · batch #${batchId}`; movement → `${parts.join(" · ")} · batch #${batchId}`. Keep `net eligible accounts` phrasing OUT only if Step 1 found no pin requiring it — if pins exist on `net eligible accounts`, keep that fragment as the first part for zero-count cells too and note the duplication for Phase 3 cleanup in the ledger. Re-run Step 6's command plus every spec Step 1 listed: `npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts tests/e2e/lab.spec.ts tests/e2e/tornado.spec.ts <others-from-step-1>`. Expected: all PASS, with any legitimately-changed pin updated in the same change and listed in the ledger.

- [ ] **Step 8: Mutation kill** — mutant: in `cellPrimaryOutcome`, delete the `bad_debt_delta_usd` block. Build, run the p0-2 e2e test alone — MUST fail at `toContainText("Δ bad debt")`. Second mutant: make `isZeroDecimal` always return `false` (quiet arm unreachable) — the quiet-arm test MUST fail at `"no effective movement"`. Revert both; record.

- [ ] **Step 9: Ledger + commit**

```bash
git add web/app/lab/matrixCells.ts web/app/lab/LabMatrix.tsx web/tests/unit/matrix-outcome.spec.ts web/tests/e2e/p0-fixes.spec.ts .superpowers/sdd/progress-ui-overhaul.md
git commit -m "fix(web): p0-2 matrix cells carry every nonzero outcome - bad debt and execution shortfall can no longer hide behind a \$0 eligible-debt delta"
```

---

### Task 3: Inspector — "Health boundary price" rename

The defect: the row labels `$4,237.60…` as "Liquidation price" while the account can already be liquidatable and the current mark is far below — the number is the price required for HEALTH, not a price at which liquidation happens. Scout verified: **no e2e or unit spec pins the literal strings** — this is a rename + one copy addition, cheap by design.

**Files:**
- Modify: `web/app/inspector/[addr]/InspectorPositionCard.tsx` (`renderLiquidationPriceRow`, lines ~398–454)
- Modify: `web/lib/evidence.ts` (`liquidationPriceEvidence`, lines ~281–328)
- Modify: `web/tests/e2e/p0-fixes.spec.ts` (p0-3 describe)
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: `lp = position.liquidation_price` (`LiquidationPrice`), `first = lp.prices[0]` (`FactorPrice`: `current_price`, `price_decimals`, `lowest_healthy_price`), the card's `money(value, { decimals })` and `symbolForAsset(asset)` helpers (all already in scope in the component).
- Produces: visible copy only — label `Health boundary price`, trailing line `· current {SYM} ≈ {X} · still healthy at exactly this price (ceil P*)`, drawer title `EXPLAIN · HEALTH BOUNDARY PRICE`. No new exports.

- [ ] **Step 1: Confirm zero pins** — Run: `cd web && grep -rn "Liquidation price\|LIQUIDATION PRICE\|explain liquidation price" tests/`. Expected: no hits (scout-verified); if any appear, list them for update in Step 4.

- [ ] **Step 2: Write the failing e2e pins** — append to `p0-fixes.spec.ts` (reuse `inspector.spec.ts`'s mock helpers + the found-address fixture `web/tests/fixtures/inspector.ts`; its Aave position carries `current_price: "400000000000"`, `lowest_healthy_price: "370370370371"` @ 8 decimals):

```ts
test.describe("p0-3 · health boundary price", () => {
  test("the boundary row names health, shows the current mark, and never says Liquidation price", async ({ page }) => {
    await mockInspectorFound(page);       // same helper shape as inspector.spec.ts
    await page.goto(`/inspector/${FOUND_ADDR}`);
    const card = page.getByTestId("position-aave_v3_etherfi");
    await expect(card.getByText("Health boundary price")).toBeVisible();
    await expect(card).toContainText("current");
    await expect(card).toContainText("$4,000");        // current_price 400000000000 @ 8dec — verify the exact rendering money() produces and pin THAT string
    await expect(card).toContainText("$3,703.7");      // boundary 370370370371 @ 8dec — same: pin money()'s actual output
    await expect(card.getByText("Liquidation price")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "explain health boundary price" }),
    ).toBeVisible();
  });

  test("the evidence drawer is retitled", async ({ page }) => {
    await mockInspectorFound(page);
    await page.goto(`/inspector/${FOUND_ADDR}`);
    await page
      .getByTestId("position-aave_v3_etherfi")
      .getByRole("button", { name: "explain health boundary price" })
      .click();
    await expect(page.getByText("EXPLAIN · HEALTH BOUNDARY PRICE")).toBeVisible();
    await expect(page.getByText("EXPLAIN · LIQUIDATION PRICE")).toHaveCount(0);
  });
});
```

Before pinning the two dollar strings, render them through the same helper the card uses (or run the test once and read the actual output) — pin what `money()` truly produces, never a guess.

- [ ] **Step 3: Run red** — `npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts -g "p0-3"`. Expected: FAIL on "Health boundary price" visibility.

- [ ] **Step 4: Implement** — in `renderLiquidationPriceRow` (Serena `replace_symbol_body` if it's a named function, else `replace_content` on the exact blocks):
  - Line ~403 (null arm) and ~415 (value arm): label → `Health boundary price`.
  - Value arm trailing copy (~425–427) becomes:

```tsx
<span className={styles.dim}>
  {` · current ${symbolForAsset(first.asset)} ≈ ${money(first.current_price, { decimals: first.price_decimals })} · still healthy at exactly this price (ceil P*)`}
</span>
```

  (Match the existing dim-span classname — read the current JSX; keep the `diagnostic` and `already breached` chips exactly as they are.)
  - ExplainButton (~418): `label="explain health boundary price"`.
  - `web/lib/evidence.ts`: title (~327) → `"EXPLAIN · HEALTH BOUNDARY PRICE"`; null-arm row label (~289) → `"health boundary price"`. Leave every other row (ceil disclosure, already-breached, never_liquidatable) untouched — the wire-field vocabulary in the drawer body is provenance, not presentation.

- [ ] **Step 5: Run green** — Step 3's command plus `tests/e2e/inspector.spec.ts tests/e2e/r1-fixes.spec.ts` (adjacent surface guards). Expected: PASS everywhere.

- [ ] **Step 6: Mutation kill** — mutant: revert the value-arm label string to `Liquidation price`. Run the p0-3 test alone — MUST fail at the `toHaveCount(0)` assertion (the discriminating pin: presence of old copy is itself pinned against). Revert; record.

- [ ] **Step 7: Ledger + commit**

```bash
git add "web/app/inspector/[addr]/InspectorPositionCard.tsx" web/lib/evidence.ts web/tests/e2e/p0-fixes.spec.ts .superpowers/sdd/progress-ui-overhaul.md
git commit -m "fix(web): p0-3 'Liquidation price' becomes 'Health boundary price' with the current mark alongside - the number is the price required for health, not a liquidation trigger"
```

---

### Task 4: Engine-specific ratio terminology (Inspector history + Book histogram)

The defect: the Debt Manager's disclosure ratio (maxBorrowLT/borrowings) wears "health factor" clothing in four places — the history section head, the DM sparkline's aria label, point hover titles ("HF ≈x.xxxx" on DM points), and Book's histogram panel printing raw wire tokens ("comparator: hf_num/hf_den") as reader copy.

**Files:**
- Modify: `web/lib/history-series.ts` (`HF_HISTORY_HEAD` ~312, hover title ~167)
- Modify: `web/app/inspector/[addr]/InspectorHistory.tsx` (head use ~92, aria label ~272)
- Modify: `web/lib/book-copy.ts` (new `comparatorReaderLabel`)
- Modify: `web/app/book/BookHistogram.tsx` (~76, ~100)
- Modify: `web/tests/unit/history-copy.spec.ts` (pin update, ~28)
- Modify: `web/tests/e2e/r1-fixes.spec.ts` (pin update, ~437)
- Create: `web/tests/unit/comparator-label.spec.ts`
- Modify: `web/tests/e2e/p0-fixes.spec.ts` (p0-4 describe)
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: engine id strings `"aave_v3_etherfi"` / `"debt_manager"` (the repo's exact-match-with-no-claim-fallback convention — see `web/lib/inspector-lines.ts:56–85`); histogram `comparator` wire tokens `"hf_wad"` / `"hf_num/hf_den"`.
- Produces: `historyHead(engine: string): string` and `pointTitlePrefix(engine: string): string` from `history-series.ts`; `comparatorReaderLabel(comparator: string): string` from `book-copy.ts`. `HF_HISTORY_HEAD` is retired (deleted, with its unit pin rewritten).

- [ ] **Step 1: Update the unit pins first (red)** — in `web/tests/unit/history-copy.spec.ts` replace the `HF_HISTORY_HEAD` pin (~line 28) with:

```ts
test("history head is engine-specific and never dresses the DM ratio as a health factor", () => {
  expect(historyHead("aave_v3_etherfi")).toBe("Health factor across batches");
  expect(historyHead("debt_manager")).toBe("Borrow headroom (disclosure) across batches");
  expect(historyHead("unknown_engine")).toBe("Plotted series across batches");
});

test("point hover prefix is engine-specific", () => {
  expect(pointTitlePrefix("aave_v3_etherfi")).toBe("HF");
  expect(pointTitlePrefix("debt_manager")).toBe("disclosure ratio");
  expect(pointTitlePrefix("unknown_engine")).toBe("value");
});
```

Create `web/tests/unit/comparator-label.spec.ts`:

```ts
// Phase 0 fix 4: wire tokens are identifiers, not reader copy (audit: Book
// histogram printed "comparator: hf_num/hf_den" verbatim).
import { expect, test } from "@playwright/test";
import { comparatorReaderLabel } from "../../lib/book-copy";

test("comparator tokens humanize per engine semantics", () => {
  expect(comparatorReaderLabel("hf_wad")).toBe("the pool's own health factor (wad)");
  expect(comparatorReaderLabel("hf_num/hf_den")).toBe(
    "maxBorrowLT/borrowings — a disclosure, not the engine's trigger",
  );
});

test("an unknown token passes through verbatim rather than being guessed at", () => {
  expect(comparatorReaderLabel("something_new")).toBe("something_new");
});
```

Run both: `npx playwright test -c tests/playwright.p0.config.ts tests/unit/history-copy.spec.ts tests/unit/comparator-label.spec.ts`. Expected: FAIL (functions missing).

- [ ] **Step 2: Implement the pure functions** — in `web/lib/history-series.ts`, delete `HF_HISTORY_HEAD` and add (near the other copy constants ~312):

```ts
// Phase 0 fix 4: the DM plots a DISCLOSURE ratio (maxBorrowLT/borrowings),
// not a health factor — the section vocabulary must say which one it is.
// Exact-match engine ids with a no-claim fallback, per house convention.
export function historyHead(engine: string): string {
  if (engine === "aave_v3_etherfi") return "Health factor across batches";
  if (engine === "debt_manager") return "Borrow headroom (disclosure) across batches";
  return "Plotted series across batches";
}

export function pointTitlePrefix(engine: string): string {
  if (engine === "aave_v3_etherfi") return "HF";
  if (engine === "debt_manager") return "disclosure ratio";
  return "value";
}
```

Then rewire the hover-title builder (~167) to take/receive the engine and use `pointTitlePrefix(engine)` in place of the literal `"HF"` — trace the builder's signature with Serena (`find_referencing_symbols`) and thread the engine from its call site in `InspectorHistory.tsx`; also replace the generic strings at ~139/~158 ("no health factor published for this point" → "no plotted value published for this point"; "health factor carries neither wad nor num/den" → "the plotted series carries neither wad nor num/den"). In `web/lib/book-copy.ts` add:

```ts
export function comparatorReaderLabel(comparator: string): string {
  if (comparator === "hf_wad") return "the pool's own health factor (wad)";
  if (comparator === "hf_num/hf_den") {
    return "maxBorrowLT/borrowings — a disclosure, not the engine's trigger";
  }
  return comparator;
}
```

Run Step 1's command green.

- [ ] **Step 3: Wire the renders (red e2e first)** — append to `p0-fixes.spec.ts`:

```ts
test.describe("p0-4 · engine-specific terminology", () => {
  test("the DM history card is headed as a disclosure, the Aave card as a health factor", async ({ page }) => {
    await mockInspectorFound(page);       // fixture serves both engines' history
    await page.goto(`/inspector/${FOUND_ADDR}`);
    await expect(page.getByText("Borrow headroom (disclosure) across batches")).toBeVisible();
    await expect(page.getByText("Health factor across batches")).toBeVisible();
    // the DM sparkline no longer claims a health factor in its aria label
    await expect(page.getByLabel("debt_manager health factor across retained batches")).toHaveCount(0);
    await expect(page.getByLabel("debt_manager borrow-headroom disclosure across retained batches")).toBeVisible();
  });

  test("Book histogram panels humanize the comparator token", async ({ page }) => {
    await mockBook(page);                  // same helper shape as book.spec.ts
    await page.goto("/book");
    await expect(page.getByText("comparator: hf_wad")).toHaveCount(0);
    await expect(page.getByText("comparator: hf_num/hf_den")).toHaveCount(0);
    await expect(page.getByText("the pool's own health factor (wad)")).toBeVisible();
    await expect(page.getByText("maxBorrowLT/borrowings — a disclosure, not the engine's trigger")).toBeVisible();
  });
});
```

NOTE the head-placement decision: the section head at `InspectorHistory.tsx:92` currently spans BOTH engines' cards. Move the engine-specific head to the per-engine card level: the section-level heading becomes per-card `historyHead(engine.engine)` (each history card already renders per engine — put the head inside the card header). If the section outer heading must remain for landmark structure, make it `"Risk history across batches"` and pin that instead of the Aave arm above — decide by reading the actual JSX and keep heading hierarchy intact (no h-level skips introduced). Aria label at ~272 → `` `${engine.engine} ${engine.engine === "debt_manager" ? "borrow-headroom disclosure" : "health factor"} across retained batches` `` — or better, derive from `historyHead` to keep one vocabulary source. `BookHistogram.tsx` ~76/~100: `comparator: {histogram.comparator}` → `{comparatorReaderLabel(histogram.comparator)}` (drop the `comparator:` prefix; the label is self-describing).

- [ ] **Step 4: Update the displaced pins** — `web/tests/e2e/r1-fixes.spec.ts:437` pins `"Health factor across batches"` visible on the DM-inclusive page — retarget it to the new per-engine reality (Aave card still shows that exact string, so the pin likely survives pointed at the Aave card; scope its locator to the aave card if it was page-global). Run: `grep -rn "comparator: hf\|comparator:" web/tests/` and update any histogram-token pins (book-charts.spec.ts / chart-spec-v4.spec.ts are the likely holders). Every touched pin goes in the ledger with old → new.

- [ ] **Step 5: Run green** — `npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts tests/e2e/inspector.spec.ts tests/e2e/r1-fixes.spec.ts tests/e2e/book-charts.spec.ts tests/e2e/chart-spec-v4.spec.ts tests/unit/history-copy.spec.ts tests/unit/history-series.spec.ts tests/unit/comparator-label.spec.ts`. Expected: PASS.

- [ ] **Step 6: Mutation kills** — mutant A: `historyHead` returns the Aave string for every engine — p0-4 test MUST fail at the DM-head visibility assertion. Mutant B: `comparatorReaderLabel` returns its input unchanged for `hf_wad` — the Book test MUST fail at `toHaveCount(0)`. Revert both; record.

- [ ] **Step 7: Ledger + commit**

```bash
git add web/lib/history-series.ts "web/app/inspector/[addr]/InspectorHistory.tsx" web/lib/book-copy.ts web/app/book/BookHistogram.tsx web/tests/unit/history-copy.spec.ts web/tests/unit/comparator-label.spec.ts web/tests/e2e/r1-fixes.spec.ts web/tests/e2e/p0-fixes.spec.ts .superpowers/sdd/progress-ui-overhaul.md
git commit -m "fix(web): p0-4 the DM disclosure ratio stops wearing health-factor clothing - engine-specific history heads, hover prefixes, humanized comparator labels"
```

---

### Task 5: Header — snapshot freshness always visible, separate from stream state

The defect: `LIVE · WATERMARKED` renders beside an 18-hour-old snapshot with the age hidden unless >1h (and then only as a coarse `· batch 18h old` suffix INSIDE the badge). Connection state and snapshot freshness are one visual unit.

The fix (churn-minimizing, badge strings frozen): the badge keeps its exact strings; a **separate, always-visible snapshot chip** (`snapshot #18251 · 18h 12m old`) renders beside it as its own element with its own testid, replacing the >1h-only suffix. Severity styling waits for Phase 1's SLA. This is integrator-owned (shared components).

**Files:**
- Modify: `web/lib/freshness.ts` (new `snapshotChip` + `snapshotChipUnknown`; retire `ribbonBatchAgeSuffix`)
- Modify: `web/components/Ribbon.tsx` (suffix slot → sibling chip, ~lines 106–117)
- Modify: `web/components/PostureRibbon.tsx` (pass chip text, ~lines 88–136)
- Modify: `web/tests/e2e/r3-fixes.spec.ts` (~196–206), `web/tests/e2e/r4-fixes.spec.ts` (~179–192), `web/tests/e2e/r6-fixes.spec.ts` (batch-age pins)
- Create: `web/tests/unit/freshness-snapshot.spec.ts`
- Modify: `web/tests/e2e/p0-fixes.spec.ts` (p0-5 describe)
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: `posture.batch.id` + the anchored age from `useAnchoredAgeSeconds` (both already read in `PostureRibbon.tsx`); `humanAge(ageSeconds)` and `unknownSincePhrase(refreshFailed)` from `freshness.ts`.
- Produces: `snapshotChip(batchId: number, ageSeconds: number): string` → `` `snapshot #${batchId} · ${humanAge(ageSeconds)} old` ``; `snapshotChipUnknown(batchId: number, refreshFailed: boolean): string` → `` `snapshot #${batchId} · age ${unknownSincePhrase(refreshFailed)}` ``. Testid produced: `ribbon-snapshot`. Testids retired: `ribbon-batch-age`, `ribbon-batch-age-unknown`.

- [ ] **Step 1: Write the failing unit spec** — `web/tests/unit/freshness-snapshot.spec.ts`:

```ts
// Phase 0 fix 5: snapshot freshness is its own always-visible statement,
// never a >1h-only suffix inside the connection badge (cross-page brief:
// "Always show the age"). Severity styling arrives with the Phase 1 SLA.
import { expect, test } from "@playwright/test";
import { snapshotChip, snapshotChipUnknown } from "../../lib/freshness";

test("the chip names the batch and the human age at every age", () => {
  expect(snapshotChip(18251, 42)).toBe("snapshot #18251 · 42s old");
  expect(snapshotChip(18251, 300)).toBe("snapshot #18251 · 5m old");
  expect(snapshotChip(18251, 65_532)).toBe("snapshot #18251 · 18h 12m old");
});

test("the unknown register survives into the chip", () => {
  expect(snapshotChipUnknown(18251, false)).toBe(
    "snapshot #18251 · age UNKNOWN since resume · refreshing",
  );
  expect(snapshotChipUnknown(18251, true)).toBe(
    "snapshot #18251 · age UNKNOWN since resume · refresh failed, data retained",
  );
});
```

Verify the exact `unknownSincePhrase` outputs against `freshness.ts` lines ~646–649 before pinning (the two constants are quoted in the scout report; trust the file). Run red.

- [ ] **Step 2: Implement the pure functions** — in `web/lib/freshness.ts`, beside `ribbonBatchAgeSuffix` (~712):

```ts
// Phase 0 fix 5: the always-on snapshot chip. Replaces ribbonBatchAgeSuffix's
// >1h gate — freshness is stated at EVERY age, in humanAge precision, as its
// own element beside the connection badge (never inside it).
export function snapshotChip(batchId: number, ageSeconds: number): string {
  return `snapshot #${String(batchId)} · ${humanAge(ageSeconds)} old`;
}

export function snapshotChipUnknown(batchId: number, refreshFailed: boolean): string {
  return `snapshot #${String(batchId)} · age ${unknownSincePhrase(refreshFailed)}`;
}
```

Delete `ribbonBatchAgeSuffix` and `ribbonBatchAgeUnknown` only AFTER Step 4 removes their last references (Serena `find_referencing_symbols` to confirm, then `safe_delete_symbol`). Keep `RIBBON_STALE_BATCH_SECONDS` if anything else consumes it; otherwise it goes too. Run Step 1 green.

- [ ] **Step 3: Write the failing e2e pins** — append to `p0-fixes.spec.ts` (reuse the posture mocks from `r7-fixes.spec.ts` / `state-matrix.spec.ts` — they build stream snapshots with controlled `batch.age_seconds`):

```ts
test.describe("p0-5 · snapshot chip", () => {
  test("a FRESH batch still shows its age beside the live badge", async ({ page }) => {
    await mockPostureWithBatchAge(page, 42);   // helper shape from r7-fixes: snapshot frame, age_seconds 42
    await page.goto("/book");
    const header = page.getByRole("banner");
    await expect(header.getByText("LIVE · WATERMARKED")).toBeVisible();  // badge untouched
    const chip = header.getByTestId("ribbon-snapshot");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("42s old");
    await expect(chip).toContainText("snapshot #");
  });

  test("an old batch reads in hours+minutes, not a coarse suffix", async ({ page }) => {
    await mockPostureWithBatchAge(page, 65_532);
    await page.goto("/book");
    await expect(page.getByRole("banner").getByTestId("ribbon-snapshot")).toContainText("18h 12m old");
    await expect(page.getByRole("banner").getByTestId("ribbon-batch-age")).toHaveCount(0); // old suffix retired
  });
});
```

Read the actual SSE-mock helper used by `r7-fixes.spec.ts` first and reuse it verbatim (the stream is mocked via the fixture snapshot frames, not `page.route` JSON) — whatever mechanism those specs use to deliver a batch with a chosen `age_seconds` is the mechanism here.

- [ ] **Step 4: Run red, wire the render, run green** — red first. Then: `Ribbon.tsx` (~106–117): remove the `batchAgeSuffix`/`batchAgeUnknown` props and their in-badge render; add a sibling element after the badge span:

```tsx
{props.snapshot ? (
  <span data-testid="ribbon-snapshot" className={styles.snapshot} title="snapshot freshness — how old the served batch is; the badge beside this is the stream connection, a separate statement">
    {props.snapshot}
  </span>
) : null}
```

with `snapshot?: string` added to `RibbonProps`. `PostureRibbon.tsx` batch branch (~88–136): replace the suffix/unknown wiring with `snapshot={ageReading.unresolved ? snapshotChipUnknown(posture.batch.id, ageReading.refreshFailed) : snapshotChip(posture.batch.id, ageReading.seconds ?? posture.batch.age_seconds)}` — read the exact `LiveAgeReading` field names (`{ seconds, unresolved, refreshFailed }`) at the existing call site and mirror its current suffix logic one-to-one onto the two chip functions. Style `.snapshot` in `ribbon.module.css` by copying the class the old suffix text used (same muted tone; it simply moved out of the badge). Run the p0-5 tests green.

- [ ] **Step 5: Update the displaced pins** — the old suffix pins now legitimately change; update each and ledger it:
  - `r3-fixes.spec.ts` ~196–206: pins asserting `ribbon-batch-age` ABSENT below 1h → assert `ribbon-snapshot` PRESENT with the exact sub-hour age instead (the policy inverted deliberately: brief says always show).
  - `r4-fixes.spec.ts` ~179–192: `"· batch 5h old"` → `"5h 0m old"` chip text (compute exact from the fixture's `age_seconds` through `humanAge`).
  - `r6-fixes.spec.ts` batch-age + unknown pins (~207–249, ~306–344, ~564–578): unknown-register pins move from `ribbon-batch-age-unknown` to `ribbon-snapshot` containing `age UNKNOWN since resume …` (phrases unchanged); aged pins move to the new chip text.
  Do NOT touch the badge-string pins in `shell.spec.ts` / `state-matrix.spec.ts` / `r7-fixes.spec.ts` — the badge is frozen and they must pass unmodified. Run: `npm run build && npx playwright test -c tests/playwright.p0.config.ts tests/e2e/p0-fixes.spec.ts tests/e2e/shell.spec.ts tests/e2e/state-matrix.spec.ts tests/e2e/r3-fixes.spec.ts tests/e2e/r4-fixes.spec.ts tests/e2e/r6-fixes.spec.ts tests/e2e/r7-fixes.spec.ts tests/unit/freshness-snapshot.spec.ts tests/unit/stream-posture.spec.ts tests/unit/freshness-blind-resume.spec.ts`. Expected: PASS.

- [ ] **Step 6: Mutation kills** — mutant A: `snapshotChip` gates on `ageSeconds > 3600` returning `""` below it (the old policy resurrected) — the fresh-batch p0-5 test MUST fail at `"42s old"`. Mutant B: in `PostureRibbon.tsx`, pass `snapshotChip(...)` unconditionally ignoring `unresolved` — an r6 unknown-register pin (now on the chip) MUST fail at its `age UNKNOWN` assertion. Revert both; record.

- [ ] **Step 7: Ledger + commit**

```bash
git add web/lib/freshness.ts web/components/Ribbon.tsx web/components/PostureRibbon.tsx web/components/ribbon.module.css web/tests/unit/freshness-snapshot.spec.ts web/tests/e2e/p0-fixes.spec.ts web/tests/e2e/r3-fixes.spec.ts web/tests/e2e/r4-fixes.spec.ts web/tests/e2e/r6-fixes.spec.ts .superpowers/sdd/progress-ui-overhaul.md
git commit -m "fix(web): p0-5 snapshot age is always visible as its own chip - stream connection and snapshot freshness are separate statements"
```

---

### Task 6: Phase 0 close — full suite, mutation transcript, ledger seal

**Files:**
- Create: `.superpowers/sdd/p0-mutations/mutations.json`
- Create: `.superpowers/sdd/p0-mutations/transcript.md`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: the mutation records accumulated by Tasks 1–5 (each task's Step "Mutation kill" noted its mutants inline in the ledger).
- Produces: the committed Phase 0 record; the green full-suite count that Phase 1 builds on.

- [ ] **Step 1: Formalize the mutation transcript** — following the format of `.superpowers/sdd/t9w20-mutations/` (read its `mutations.json` + `transcript.md` first): `mutations.json` lists the 9 mutants (2 per task 1/2/4/5, 1 for task 3) with property-under-attack + exact diff; `transcript.md` records per mutant the single command, the assertion it died at, and `Result: KILLED`. Every kill was observed in isolation during its task — the transcript is the formal record, not a re-run; re-run any mutant whose isolation observation was not clean.

- [ ] **Step 2: Full-suite verification** — Run: `cd web && npm run build && npx playwright test -c tests/playwright.p0.config.ts`
Expected: **1362 + (new tests added this phase) passed, 1 pre-existing skip** (the styleguide smoke self-skips unless `NEXT_PUBLIC_SHOW_STYLEGUIDE=1` was set at build). Record the exact count. Any failure is a Phase 0 regression: fix before landing, never quarantine.

- [ ] **Step 3: Typecheck + lint** — Run: `cd web && npm run typecheck && npm run lint`
Expected: clean (CI runs both before the suite).

- [ ] **Step 4: Seal the ledger** — append to `.superpowers/sdd/progress-ui-overhaul.md`: the closing count (old → new suite total), the retired/updated pin inventory (r3/r4/r6 batch-age pins → snapshot chip; r1:437 retarget; any Step-1-of-Task-2 finds), and the note that Phase 0 is complete pending Codex review.

- [ ] **Step 5: Commit**

```bash
git add .superpowers/sdd/p0-mutations/mutations.json .superpowers/sdd/p0-mutations/transcript.md .superpowers/sdd/progress-ui-overhaul.md
git commit -m "test(web): p0-6 phase-0 close - mutation transcript (9 kills in isolation), full suite green, pin-migration ledger sealed"
```

- [ ] **Step 6: Codex adversarial review** — dispatch the codex-reviewer agent over the Phase 0 diff range (`git log --oneline` from the p0-0 commit to HEAD) per landing discipline; fix findings test-first as `p0-7…` commits. Phase 0 is DONE when the review round closes clean.

---

## Parallelization map (for the orchestrator, not the task executor)

- **Workstream A (Lab):** Task 1 → Task 2 (both touch `p0-fixes.spec.ts` and lab files; serial within the stream).
- **Workstream B (Inspector/Book):** Task 3 → Task 4 (serial within the stream).
- **Workstream C (shared, integrator-owned):** Task 5.
- Task 0 first; A, B, C build in parallel after it; **landing order stays 1→2→3→4→5**; Task 6 last.
- `p0-fixes.spec.ts` is shared by all three streams: streams B and C append their describes in their own worktree-less path-disjoint files ONLY at landing time (the integrator merges the describes in task order) — or simpler, each stream hands its describe block to the integrator as part of its landing. Do not let two parallel agents edit `p0-fixes.spec.ts` simultaneously.

## Self-review notes (already applied)

- Spec coverage: brief's five trust-fix items → Tasks 1–5; program-design Phase 0 items 1–5 → same; wave config + close ritual → Tasks 0/6. The result-identity generalization (typed envelope for ALL async surfaces) is deliberately Phase 1 Track B, not here — Task 1 fixes the address-mode instance only.
- Badge-string freeze is consistent with Task 5's design (chip is additive; suffix retirement is inside the ribbon, badge untouched).
- Naming is consistent: `addressBinding`/`AddressBinding`/`StressPhase` (Task 1), `cellPrimaryOutcome`/`CellOutcome`/`CELL_QUIET_LINE` (Task 2), `historyHead`/`pointTitlePrefix`/`comparatorReaderLabel` (Task 4), `snapshotChip`/`snapshotChipUnknown` (Task 5) — each defined once, consumed only where its task says.
- Known drift risks called out inline: exact `money()` renderings (Task 3 Step 2), the run-book mock helper + cell testid (Task 2 Step 6), the SSE posture mock mechanism (Task 5 Step 3), `LiveAgeReading` field names (Task 5 Step 4). Each step instructs the executor to read the real code first and pin actual outputs.
