# UI Overhaul Phase 1 Track B — Result Identity + Response-Boundary Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the malformed-wire class (Codex r3 findings, routed here by owner ruling) and generalize the cross-page brief §5 result-identity contract — honest refusal states for unreadable wire data at every high-traffic seam, route-level error boundaries as the long-tail net, and identity/race-guard fixes for the surfaces that fall short of §5.

**Architecture:** Extend the house *classify, don't throw* law (p0-8's `cellPrimaryOutcome` precedent) with a shared wire-guard module and per-shape classifiers consumed at the ingestion seams; add app-router `error.tsx` boundaries (none exist today — a render throw white-pages the route); fix the enumerated §5 gaps with the existing receipt/age primitives. The matrix/tornado identity nucleus (`matrixCells.ts`, ~2,800 lines, waves R8–R17) already EXCEEDS §5 and is **not** restructured — Track B extends its vocabulary only where classifiers plug in.

**Tech Stack:** Next.js app router, TypeScript, Playwright (unit + e2e projects, wave config pattern), `@solvent/client` (`file:` package with `DECIMAL_PATTERN`/`DecimalFormatError`/refine-lookup sealing already at runtime).

## Global Constraints

- **Spec authority:** `docs/specs/2026-08-09-ui-overhaul-program-design.md` (Phase 1 Track B as amended at Phase 0 close) and `docs/specs/2026-08-09-cross-page-ui-brief.md` §5.
- **All spawned agents run `model: 'fable'`.** Code edits use Serena symbolic tools (load via ToolSearch first); plain Edit only for CSS/config or where Serena can't express the change.
- **Test-first**; every new pin mutation-killed AT ITS OWN ASSERTION in isolation; kills recorded per task and formalized at close.
- **Classify, don't throw:** wire validation NEVER throws — it returns named malformed fields; render arms refuse honestly ("unreadable is not zero"). The registers established by p0-8/9 (`data-cell-outcome="malformed"`, `data-engine-outcome="malformed"`, "MALFORMED RESULT — … Nothing is claimed for it, and unreadable is not zero.") are the house voice — reuse them.
- **No validation library.** The repo's law is exact hand-rolled validators (`packages/client-ts/src/decimal.ts` tradition). Do not add zod/valibot/io-ts.
- **Preservation boundary:** no backend/Go changes, no API-contract changes, no `packages/client-ts` behavioral changes to existing exports (ADDITIVE exports are allowed there only if a task explicitly says so — default is web-side modules).
- **Matrix/tornado identity discipline is load-bearing** (batch cohort, watermark, settlement gates): tasks touch it only at the named plug points; any failure in `lab.spec.ts`/`tornado.spec.ts`/`runbook-*.spec.ts` beyond pins a task explicitly migrates is a regression in that task.
- **Wave config:** create `web/tests/playwright.p1b.config.ts` (Task 0) on port **3819**, mirroring `tests/playwright.p0.config.ts` exactly except port/comment. All runs: `npm run build && npx playwright test -c tests/playwright.p1b.config.ts <spec>` from `web/`.
- **Typecheck + lint must stay completely clean** — run `npm run typecheck` in every task's verification.
- Fixture provenance law: structuredClone of committed fixtures, one documented purpose per variant. Extend the p0 pin files (`p0-fixes.spec.ts` mocks are reusable) but new Track B pins live in `web/tests/e2e/p1b-fixes.spec.ts` and per-module unit specs.
- Ledger: append per task to `.superpowers/sdd/progress-ui-overhaul.md` (Phase 1 Track B section; created by Task 0). Retired/updated pins listed old→new.
- Commits: `fix(web): p1b-N <what>` / `test(web): p1b-N <what>`, staged by name, NO Co-Authored-By. Renew the claim lease if doctor reports expiry (isolated commit).
- Scout line anchors below were verified 2026-08-09 at commit 56ebe5d; re-anchor with Serena before editing.

---

### Task 0: Wave config + honest route error boundaries

No `error.tsx`, `global-error.tsx`, or custom React boundary exists anywhere under `web/app` (verified): a formatter throw during client render replaces the entire route — header included — with Next's generic "Application error" page. This task is the long-tail net that makes every later validation task fail-honest instead of fail-blank.

**Files:**
- Create: `web/tests/playwright.p1b.config.ts` (port 3819; mirror `web/tests/playwright.p0.config.ts` exactly except port + header comment)
- Create: `web/components/RouteRefusal.tsx` + styles in an existing shared module (`web/components/primitives.module.css` — add a class copying the refused/warn tone already used by `RefusedTag`)
- Create: `web/app/error.tsx` (root boundary — one boundary above all surfaces; per-route boundaries are NOT needed because every surface is one client component under `layout.tsx`)
- Create: `web/tests/e2e/p1b-fixes.spec.ts`
- Create: `.superpowers/sdd/progress-ui-overhaul.md` Phase 1 Track B section (append)

**Interfaces:**
- Produces: `RouteRefusal({ error }: { error: Error & { digest?: string } })` — the honest register component; `web/app/error.tsx` default-exports the client boundary wiring `RouteRefusal` with a reset affordance. Testid: `route-refusal`.

- [ ] **Step 1: Wave config** — copy `playwright.p0.config.ts`, port 3819, comment "Phase 1 Track B verification config." Verify: `npx playwright test -c tests/playwright.p1b.config.ts --list | tail -1` prints the current inventory (record it in the ledger as the Track B baseline).

- [ ] **Step 2: Failing e2e** — in `p1b-fixes.spec.ts` (copy `fixture()`/`mockBookSurface`-style helpers from `p0-fixes.spec.ts` — read it first):

```ts
test.describe("p1b-0 · honest route refusal", () => {
  test("a render throw shows the refusal register, not the generic error page", async ({ page }) => {
    // Single documented change: BookResponse aggregate total_debt_usd = "" —
    // today this throws DecimalFormatError in BookStatRows and white-pages /book.
    const body = structuredClone(BOOK);
    const agg = body.engines[0];
    if (!agg) throw new Error("fixture shape: engines[0] missing");
    agg.total_debt_usd = "";
    await mockBookWith(page, body);
    await page.goto("/book");
    const refusal = page.getByTestId("route-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("refused to render");
    await expect(refusal).toContainText("Nothing is claimed");
    // the register is ours, not Next's generic page
    await expect(page.getByText("Application error: a client-side exception")).toHaveCount(0);
  });
});
```

Adjust field/mock names to the real fixture shape (read `web/tests/fixtures/book.ts` + the book mocks in `p0-fixes.spec.ts`). Run red: today the generic page renders (assert helpers may need `page.waitForLoadState`).

- [ ] **Step 3: Implement** — `RouteRefusal`: house-register copy, e.g. heading "THIS VIEW REFUSED TO RENDER", body: "A value in the served data could not be read, and an unreadable value is never rendered as a number. Nothing is claimed for this view." + the error message in a mono `<details>` (evidence layer) + a "try again" button calling `reset()`. `web/app/error.tsx`:

```tsx
"use client";
import { RouteRefusal } from "../components/RouteRefusal";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteRefusal error={error} reset={reset} />;
}
```

Run green. NOTE: the app-router boundary replaces the SEGMENT below layout.tsx, so the header/nav STAY mounted — pin that too (`getByRole("banner")` visible in the same test).

- [ ] **Step 4: Mutation kill** — mutant: `error.tsx` rethrows (boundary disabled). The e2e MUST fail at the `route-refusal` visibility assertion in isolation. Revert; record.

- [ ] **Step 5: Ledger + commit** — open the "Phase 1 Track B" ledger section (baseline inventory, task list). Commit: `test(web): p1b-0 wave config + honest route refusal boundary - a render throw states its refusal instead of white-paging the route`.

---

### Task 1: Shared wire-guard module + kill the silent BigInt coercion class

`BigInt("")` and `BigInt(" ")` silently coerce to `0n`, and `BigInt("0x10")` to `16n` — outside the wire contract (`/^-?[0-9]+$/`). Bare `BigInt(wire)` sites can launder malformed data into measured zeros (the p0-8 defect class, reachable again). Also: p0-8's primitives (`WIRE_DECIMAL`, `isWireDecimal`, `isZeroDecimal`) are module-private to `matrixCells.ts` — Track B needs them shared.

**Files:**
- Create: `web/lib/wireGuard.ts`
- Modify: `web/app/lab/matrixCells.ts` (rebase its private helpers on the shared module; exports unchanged)
- Modify: `web/app/lab/badDebtRate.ts` (:61-62, :79, :93-94 — bare `BigInt(bad_debt_usd/eligible_debt_usd)`)
- Modify: `web/app/lab/labRunBookLines.ts` (:409 `BigInt(entry.value_usd)`, :420 `BigInt(total_collateral_usd)`, :28-33 `BigInt(wad_scale/upper_wad)`)
- Create: `web/tests/unit/wire-guard.spec.ts`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Produces (from `web/lib/wireGuard.ts`):

```ts
export const WIRE_DECIMAL = /^-?[0-9]+$/;
export function isWireDecimal(value: unknown): value is string;
export function isZeroDecimal(value: string): boolean;            // /^-?0+$/
export function isWireScale(value: unknown): value is number;     // integer in [0,1000] — mirrors assertScale's bounds
export function isWireCount(value: unknown): value is number;     // Number.isInteger
export function wireBigInt(value: string): bigint | null;         // null unless WIRE_DECIMAL matches; NEVER throws, NEVER coerces
export type FieldCheck = readonly [field: string, ok: boolean];
export function malformedFields(checks: readonly FieldCheck[]): string[];  // names of failed checks
```

- Consumed by: Tasks 2–4 classifiers; `matrixCells.ts` re-exports nothing new (internal rebase).

- [ ] **Step 1: Failing unit spec** — `wire-guard.spec.ts`: the p0-2 bad-value loop (`["", "-", ".", "0.0", "1e5", " 0", "0 ", "0x10", "+5"]` all rejected by `isWireDecimal`), `-0`/`000` accepted and zero, `wireBigInt("") === null` (the coercion kill), `wireBigInt("0x10") === null`, `wireBigInt("-15") === -15n`, `isWireScale` bounds (reject -1, 1001, 2.5, "8"), `malformedFields` naming. Run red, implement, run green.

- [ ] **Step 2: Rebase matrixCells** — replace its private `WIRE_DECIMAL`/`isWireDecimal`/`isZeroDecimal` with imports; `find_referencing_symbols` to confirm no behavior change; run `tests/unit/matrix-outcome.spec.ts` green unchanged.

- [ ] **Step 3: Kill the coercion sites** — in `badDebtRate.ts` and `labRunBookLines.ts`, replace each bare `BigInt(wireString)` with `wireBigInt(...)` + an explicit null arm that routes to the module's EXISTING refusal/contradiction arm (read each module's current refusal composition first — `badDebtRate.ts` and `moverDumbbells.ts` have r88-style refusal arms to mirror; where a module has no refusal arm, returning its established "cannot compose" state is correct — never invent a new register here, Task 2 owns the engine-level register). Unit-pin each site: malformed input → the refusal arm, `""` no longer a zero. (Read the existing unit specs for these modules — `lab-runbook-lines.spec.ts`, `bad-debt-rate.spec.ts` if present — and extend them.)

- [ ] **Step 4: Mutation kills (2)** — (i) `wireBigInt` reverts to bare `BigInt` → dies at the `""`-is-null unit pin; (ii) one coercion-site null-arm routed back to zero → dies at that site's refusal pin. In isolation; record.

- [ ] **Step 5: Verify + commit** — typecheck clean; run matrix-outcome + the touched modules' specs + `lab.spec.ts`. Commit: `fix(web): p1b-1 shared wire guard - BigInt coercion class killed, malformed strings can never launder into measured zeros`.

---

### Task 2: Full RunBookEngine subtree classification (closes Codex r3 finding 1)

The p0-9 gate validates 4 of ~40+ numeric fields the run-book detail consumes. The full inventory of unguarded throwing paths (scout-verified): `usd_decimals`; before/after aggregates ×5 Decimal fields per side; `hf_histogram.wad_scale` + `buckets[].upper_wad`; `hf_transitions.wad_scale` + `lanes[].upper_wad` + `cells[].debt_before_usd/debt_after_usd`; `movers[].hf_before_wad/hf_after_wad/hf_drop_wad/debt_usd`; `collateral_by_asset[].amount/decimals/value_usd` (both sides); `market_realization.bad_debt_at_liquidation_usd` + its `usd_decimals`; projection horizon Decimals render RAW (silent, no validation).

**Files:**
- Create: `web/app/lab/engineClassification.ts`
- Modify: `web/app/lab/matrixCells.ts` (`cellPrimaryOutcome` rebased: its malformed arm now consults the full classification — same `CellOutcome` shape, `fields` list grows)
- Modify: `web/app/lab/LabBookPanel.tsx` (EngineResult gate :148-167 and parent gate :354-359/:419-421 consult the full classification — invocation sites only, register unchanged)
- Create: `web/tests/unit/engine-classification.spec.ts`
- Modify: `web/tests/e2e/p1b-fixes.spec.ts`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: `wireGuard` (Task 1), `LabRunBookEngine` from `web/lib/runbook.ts`.
- Produces: `classifyRunBookEngine(engine: LabRunBookEngine): { malformedFields: string[] }` — exhaustive over every numeric wire field the subtree feeds into a throwing or silently-permissive path (the inventory above, with array fields named per-index, e.g. `movers[2].hf_before_wad`, `before.hf_histogram.buckets[0].upper_wad`). Empty list = renderable. `cellPrimaryOutcome`'s malformed arm delegates to it (one law, one function).

- [ ] **Step 1: Failing unit spec** — build a contract-legal engine skeleton from the committed `RUN_BOOK_200` fixture (import the fixture, take `engines[0]`), then per field group one test: corrupt the field via structuredClone → `classifyRunBookEngine` names it exactly; the untouched skeleton classifies clean. Cover: an aggregate field, `usd_decimals: 2.5`, a bucket `upper_wad`, a transitions cell `debt_before_usd`, a mover wad, a collateral `decimals: -1`, `market_realization.bad_debt_at_liquidation_usd`, a projection horizon Decimal, plus per-index naming. Run red.

- [ ] **Step 2: Implement** — pure walker over the engine object using `wireGuard` primitives; nullable fields checked only when non-null (`parseNullableDecimal` semantics: null is a statement, not malformed); optional subtrees (`market_realization`, `projection`, `hf_transitions` nullable?) — read the generated schema (`packages/client-ts/src/generated/schema.ts`, RunBookEngine ~:2550-2600) and mirror its nullability EXACTLY; a field the schema allows null must not be flagged when null. Run green.

- [ ] **Step 3: Wire the gates** — `cellPrimaryOutcome`: before its current 4-field check, run `classifyRunBookEngine`; malformed → `{ kind: "malformed", fields }` (the 4-field check folds into the classifier — delete the duplication). LabBookPanel gates unchanged in shape (they call `cellPrimaryOutcome`). Failing e2e first: structuredClone `RUN_BOOK_200` with `engines[0].before.total_debt_usd = ""` → run from the matrix; route stays live; the engine panel shows the p0-8 malformed register naming `before.total_debt_usd`; the healthy second engine renders normally. Then a second variant: `movers[0].hf_before_wad = "1e5"` → same register, per-index field name. Run red → green.

- [ ] **Step 4: Mutation kills (2)** — (i) classifier skips the aggregates group → dies at the `before.total_debt_usd` e2e pin; (ii) per-index naming replaced by a bare group name → dies at the unit per-index pin. In isolation; record.

- [ ] **Step 5: Verify + commit** — typecheck; run matrix-outcome, engine-classification, p0-fixes (its p0-8/9 pins must survive — the register is unchanged, fields list only grows; if a p0 pin asserts an EXACT fields list, update it and ledger old→new), lab.spec, p1b-fixes. Commit: `fix(web): p1b-2 the run-book engine classifier covers its whole subtree - forty fields, one law, per-index naming`.

---

### Task 3: SetRunEngineSummary validation + tornado malformed arm (closes Codex r3 finding 3)

The tornado path has ZERO decimal validation: `barLength` calls bare `BigInt` (`""` → measured-zero laundering, `"-"` → route crash), and the renderer's `renderSignedUsdAmount`/`renderUsdAmount` calls throw on malformed deltas/scales/realization/projection fields. `tornadoCellState` has identity/coverage arms but no malformed arm.

**Files:**
- Create: `web/app/lab/setRunClassification.ts`
- Modify: `web/app/lab/tornadoCells.ts` (`barLength` :482-511 → `wireBigInt`; `tornadoCellState` :267-378 gains a `malformed` arm ahead of the reach-based drawable states, after the identity gates)
- Modify: `web/app/lab/LabTornado.tsx` (render the malformed arm: excluded from bars/geometry/header drawn-counts, visible in the ledger with the p0-8 register voice + fields named; panel value column and block rows render only for non-malformed rows)
- Create: `web/tests/unit/set-run-classification.spec.ts`
- Modify: `web/tests/unit/set-run-outcome.spec.ts`, `web/tests/unit/tornado-lines.spec.ts` (extend: malformed arms; existing pins survive)
- Modify: `web/tests/e2e/p1b-fixes.spec.ts`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: `wireGuard`; `SetRunEngineSummary` from `@solvent/client` generated schema (via the types `tornadoCells.ts` already imports).
- Produces: `classifySetRunEngine(engine: SetRunEngineSummary): { malformedFields: string[] }` covering the CONSUMED fields (scout inventory): `eligible_debt_delta_usd`, `total_debt_usd_before`, `usd_decimals`, `market_realization.execution_shortfall_usd/bad_debt_at_liquidation_usd/usd_decimals` (when non-null), `projection.horizons[].debt_usd/projected_usd/additional_interest_usd` (when non-null), counts `accounts`/`movement_excluded_accounts` (+ nullable `hf_dropped_accounts`/`flipped_to_eligible` when non-null). Fields served but consumed nowhere (scout list: `before_bad_debt_usd`, `total_debt_usd_after`, etc.) are OUT of scope — record the scope decision in the module's header comment. New `tornadoCells` state: extend the cell-state union with `{ kind: "malformed"; fields: string[] }` (read the exact existing union shape first and mirror its conventions).

- [ ] **Step 1: Failing unit specs** — `set-run-classification.spec.ts`: skeleton from the committed set-run fixture (`web/tests/fixtures/run-book-set*.json` via the generators — read `generate-run-book-set.mjs`); per consumed group corrupt-and-name tests; clean skeleton classifies clean. `set-run-outcome.spec.ts` extension: `barLength` on `total_debt_usd_before: ""` no longer returns a zero/no-denominator state — the row is malformed upstream (assert whatever composition Task's design routes: classification runs BEFORE barLength; barLength itself asserts contract-legal input via `wireBigInt` null-arm returning the existing no-denominator refusal AND never coercing). Run red.

- [ ] **Step 2: Implement + wire** — classifier; `tornadoCellState` gains the malformed arm (position: after `setContradiction`/identity/coverage gates, before reach/drawable — a malformed row is still identity-bound; the batch/identity disclosures stay); `barLength` on `wireBigInt`; `LabTornado.tsx` renders malformed rows in the ledger (fields named, no bar, excluded from drawn counts — read the header drawn-count composition in `tornadoLines.ts tornadoHeaderLine` and keep its arithmetic honest: malformed rows get their own count clause, not silently dropped). Failing e2e first: structuredClone set-run 200 with one engine's `eligible_debt_delta_usd = ""` → run the set; route live; that row shows the malformed register naming the field; the other engine's bar draws; header names the malformed row. Run red → green.

- [ ] **Step 3: Mutation kills (2)** — (i) classifier bypassed in `tornadoCellState` (malformed arm unreachable) → dies at the e2e malformed-register pin; (ii) `barLength` reverts to bare `BigInt` → dies at the `set-run-outcome` no-coercion pin. In isolation; record.

- [ ] **Step 4: Verify + commit** — typecheck; tornado.spec.ts + set-run-outcome + tornado-lines + p1b-fixes green (existing tornado pins must survive — malformed arm is additive; ledger any legitimately updated pin). Commit: `fix(web): p1b-3 the tornado classifies before it draws - malformed set-run rows name their fields and never launder into zeros or crashes`.

---

### Task 4: FactorPrice entry validation (closes Codex r3 finding 2)

Post-p0-9 defenses cover the array's existence and boundary null-ness only. Trusted-entry reads remain: `prices: [null]` → TypeError at `first.lowest_healthy_price`; malformed `lowest_healthy_price`/`current_price` → parseDecimal throw in `money()`; bad `price_decimals` shape → assertScale throw; ABSENT `price_decimals` → `money()`'s no-scale branch renders the RAW scaled integer as a plausible number (silent wrong display — the worst class).

**Files:**
- Create: `web/lib/factorPriceGuard.ts`
- Modify: `web/app/inspector/[addr]/InspectorPositionCard.tsx` (`renderLiquidationPriceRow` :398-503 — entry validation folds invalid entries into a malformed-boundary refusal arm alongside the existing not-established arm)
- Modify: `web/lib/evidence.ts` (`liquidationPriceEvidence` :281-366 — same guard for `[0]` AND the per-entry `.map`)
- Create: `web/tests/unit/factor-price-guard.spec.ts`
- Modify: `web/tests/unit/inspector-evidence.spec.ts` (extend the p0-8 drawer pins)
- Modify: `web/tests/e2e/p1b-fixes.spec.ts`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: `wireGuard`; `FactorPrice` from the generated schema.
- Produces: `classifyFactorPrice(entry: unknown): { ok: true; entry: FactorPrice } | { ok: false; fields: string[] }` — requires a non-null object; `asset` a string; `current_price` a wire Decimal; `price_decimals` a wire scale (REQUIRED — absent/undefined is malformed, never the raw-render branch); `price_floor`/`lowest_healthy_price` null or wire Decimal. Register: the card renders a "health boundary unreadable" arm (mirror the not-established arm's tone + testid convention: `boundary-malformed`, fields named, `lp.reason` still shown if present, NO health assertion, no raw numbers).

- [ ] **Step 1: Failing unit spec** — `factor-price-guard.spec.ts`: null entry, non-object, malformed `lowest_healthy_price` (`"12.5"`), malformed `current_price` (`""`), `price_decimals` absent / `-1` / `2.5` / `1001`, valid entry passes with the same object back. `inspector-evidence.spec.ts` extension: drawer with `prices: [null]` and with a malformed entry → the malformed arm text, no throw, per-entry independence (one bad entry does not hide a good second entry — decide and pin: each entry classified independently, bad entries render their own malformed row). Run red.

- [ ] **Step 2: Implement + wire** — guard module; card: classify `lp.prices[0]` before ANY property read (fold `{ok:false}` into the new `boundary-malformed` arm; the existing not-established arm remains for the classified-ok-but-null-boundary case); drawer: classify every entry in the map. Failing e2e first (extend the p0-8 describe's mock pattern): variant `prices: [null]` → card renders, `boundary-malformed` visible, no crash; variant `prices[0].price_decimals` deleted → same arm, and pin the ABSENCE of any digit-run that equals the raw `lowest_healthy_price` string (the silent-raw-render kill: `await expect(card).not.toContainText("370370370371")`). Run red → green.

- [ ] **Step 3: Mutation kills (2)** — (i) guard's `price_decimals` requirement dropped (absent passes) → dies at the raw-digits absence pin; (ii) card classifies but routes `{ok:false}` to the value arm → dies at the `boundary-malformed` visibility pin. In isolation; record.

- [ ] **Step 4: Verify + commit** — typecheck; inspector.spec + p0-fixes (p0-8 boundary pins must survive) + p1b-fixes green. Commit: `fix(web): p1b-4 factor-price entries are classified before they are read - a missing scale can never render a raw integer as a price`.

---

### Task 5: Shared result-identity module + Lab address-mode completion

§5 requires every async result bound to scope/address/batch/scenario-set/config-version/engines/computed-at, with visible identity. The matrix/tornado already exceed this; the Lab address mode binds ONLY the address (batch/config-version are display-only, no age anchor, no supersession statement).

**Files:**
- Create: `web/lib/resultIdentity.ts`
- Modify: `web/app/lab/LabClient.tsx` (address-mode done arm: identity line + anchored age)
- Modify: `web/app/lab/addressBinding.ts` (compose the identity line from the settled result — pure)
- Create: `web/tests/unit/result-identity.spec.ts`
- Modify: `web/tests/unit/address-binding.spec.ts`, `web/tests/e2e/p1b-fixes.spec.ts`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md`

**Interfaces:**
- Consumes: `receiptIdentity`/`AgeReceipt` from `web/lib/freshness.ts` (:232-234, :210-218), `useAnchoredAgeSeconds` from `web/lib/live-age.ts` (:204, returns `{seconds, unresolved, refreshFailed}`), `StressLookup`.
- Produces (from `resultIdentity.ts`):

```ts
export interface ResultIdentity {
  scope: "book" | "address" | "set";
  address?: string;
  batchId: number;
  configVersion: string;
  engines: readonly string[];        // answered engines; withheld listed separately by the surface
  servedAt: string;                  // identity + receipt source, never a duration source
}
export function identityLine(id: ResultIdentity): string;
// e.g. "results for 0xAAaA…0001 · batch #18251 · config v3 · engines aave_v3_etherfi, debt_manager"
export function stressResultIdentity(addr: string, response: { batch: { id: number }; scenario_config_version: string; ... }): ResultIdentity;
```

(Read `StressResponse`'s exact refined shape in `packages/client-ts` before finalizing the extractor's parameter type — mirror what `LabClient` actually holds.) The visible line REPLACES the p0-1 `boundResultLine` (`results for {addr}`) — the `lab-result-address` testid keeps its name, its text grows; migrate the p0-1 pin and ledger old→new.

- [ ] **Step 1: Failing unit specs** — `result-identity.spec.ts`: `identityLine` composition (each field present; address omitted for book scope), `stressResultIdentity` extraction from a fixture-shaped response. `address-binding.spec.ts` extension: the composed line contains addr AND batch id (pure fn test). Run red, implement, green.

- [ ] **Step 2: Wire + age anchor (failing e2e first)** — the done arm renders `identityLine(...)` in `lab-result-address` and an anchored age line (testid `lab-result-age`) via `useAnchoredAgeSeconds({ ageSeconds: response.batch.age_seconds, receiptId: receiptIdentity(response.served_at, response.batch.id) })` — mirror InspectorSurface's usage (:174-185) exactly, including the unknown register (`unresolved` → the "age UNKNOWN since resume" phrasing from `freshness.ts`). E2E: settled stress result shows the identity line with batch id and an age ("Xs old" from the fixture's `age_seconds`); the stale barrier still works (p0-1 pins unchanged except the migrated text pin). Run red → green.

- [ ] **Step 3: Mutation kills (2)** — (i) `identityLine` drops the batch clause → dies at the batch-id pin (unit + e2e); (ii) the age wired to a constant receipt (never re-anchors) — pin via the unknown-register arm if cheaply testable in e2e, else kill at a unit pin on the receipt composition in the extractor. In isolation; record.

- [ ] **Step 4: Verify + commit** — typecheck; lab.spec + p0-fixes (migrated pin ledgered) + p1b-fixes + address-binding + result-identity green. Commit: `fix(web): p1b-5 stress results carry their full identity - address, batch, config version, engines, anchored age`.

---

### Task 6: Race-guard and identity gap fixes (the §5 audit's remaining rows)

Five enumerated gaps, each small and independently testable:

1. **Book success-arm abort check** — `web/app/book/BookSurface.tsx` `loadBook` (:87-116): the failure handler checks `controller.signal.aborted` (:103) but the success handler (:95-99) does not. Mirror the failure arm's check. (Unit-testable only via e2e race simulation — acceptable to pin with a code-level unit test if the module exposes the loader; otherwise document as review-verified and pin the OTHER arms' behavior unchanged: book.spec green.)
2. **Feed envelope-echo race** — `web/app/feed/FeedSurface.tsx` (:109-120): `setEnvelope`/`setRefusal` fire inside `fetchPage` BEFORE `useCursorPages`' epoch check — a page resolving concurrently with `restartWalk()` writes a stale filter echo. Fix: capture the epoch (or scope token) at dispatch and gate the two setters on it (read `web/lib/pagination.ts` :34-88 for the epoch mechanism — expose the current epoch or pass an `isCurrent()` predicate into `fetchPage`; smallest honest change wins). E2E: change filters twice rapidly with a delayed first-page mock → the envelope echo names the SECOND scope (mock two scopes with distinguishable filter echoes).
3. **Observatory anchoring + abort symmetry** — `web/app/observatory/ObservatorySurface.tsx` (:103-127): add the success-arm abort check; anchor the age: render served_at's batchless receipt age via `useAnchoredAgeSeconds({ ageSeconds: <derive from response if served — read the response shape; if the wire carries no age_seconds for the rollup, render "as of {served_at}" VERBATIM and skip the tick — never compute age from the browser clock (house law, freshness.ts:1-80)>, receiptId: receiptIdentity(served_at) })`. Decide from the actual wire shape and record the decision in the ledger.
4. **Inspector history batch-weld disclosure** — `web/app/inspector/[addr]/InspectorSurface.tsx` (:188-206): when the history response's newest batch ≠ the lookup's batch, state it (a dim one-liner near the history head: "history window newest batch #X · position read at batch #Y" — read the history response shape for the newest-batch field; if no such field exists, weld on what IS shared and record the decision). Testid `history-batch-weld`, rendered only on mismatch.
5. **Inspector params/activity explicit keying** — params results accumulate keyed by engine only; activity's address lives in a fetch closure; both rely on App Router remount semantics. Make the binding explicit: key both states by `addr` (the `{for: addr, state}` pattern InspectorSurface already uses for the lookup — mirror it), so a future refactor that reuses the component across addresses cannot leak rows.

**Files:** the five sites above + `web/tests/e2e/p1b-fixes.spec.ts` + touched unit specs + ledger.

- [ ] **Step 1**: fixes 1/3/5 (mechanical, review-verified + suite-green): implement, run book.spec/observatory.spec/inspector.spec green, typecheck clean.
- [ ] **Step 2**: fix 2 (failing e2e first per the two-scope mock above; mutation kill: gate removed → stale echo renders → pin dies).
- [ ] **Step 3**: fix 4 (failing e2e first: history fixture variant with a different newest batch → weld line visible; matching batches → `toHaveCount(0)`; mutation kill: weld condition inverted → dies at the count-0 pin).
- [ ] **Step 4: Verify + commit** — full affected set green; ledger records each decision point (3's wire-shape decision, 4's weld field). Commit: `fix(web): p1b-6 the identity gap audit closes - abort symmetry, scoped feed echoes, anchored observatory age, history batch weld, explicit inspector keying`.

---

### Task 7: Track B close

- [ ] **Step 1**: mutation transcript `.superpowers/sdd/p1b-mutations/{mutations.json,transcript.md}` (t9w20 format; reconcile the true mutant/kill counts from task records — do not force a predicted number).
- [ ] **Step 2**: full suite `npm run build && npx playwright test -c tests/playwright.p1b.config.ts` — record exact numbers (baseline from Task 0 + new pins, 1 pre-existing skip, 0 failures); `npm run typecheck` + `npm run lint` clean (the pre-existing `UnavailableError` lint warning at `LabBookPanel.tsx:27` may be removed in passing — it is a one-line unused import, ledger it).
- [ ] **Step 3**: ledger seal (Track B section: delivered scope, the deliberate OUT-of-scope inventory — un-consumed SetRunEngineSummary fields, non-classified surfaces covered by the route boundary — and the still-open server defect: solver-error `prices:null` serialization).
- [ ] **Step 4**: commit `test(web): p1b-7 track B close - transcript, full suite green, scope ledger sealed`. Then the controller runs the Codex adversarial round (fresh session; context = the r3 findings as the checklist + this plan's scope statement; the round verifies the three findings CLOSED and hunts the residual class within the declared scope).

---

## Parallelization map (for the orchestrator)

Serial dispatch (single tree, shared build/port): 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Tasks 2/3/4 are independent of each other but share `p1b-fixes.spec.ts` and the build tree — landing order as numbered. Task 5 depends on nothing after 0; Task 6 after 5 (shares p1b spec file conventions).

## Self-review notes (applied)

- Codex r3 findings → Tasks 2 (finding 1), 3 (finding 3), 4 (finding 2); the route boundary (Task 0) covers the declared-out-of-scope long tail honestly; the silent-coercion class (r3's BigInt observations) → Task 1.
- §5 audit rows → Task 5 (address mode) + Task 6 (five gaps); matrix/tornado/walk/inspector-lookup rows already meet or exceed §5 — untouched by design.
- Type consistency: `wireGuard` names used identically in Tasks 1–4; `classifyRunBookEngine`/`classifySetRunEngine`/`classifyFactorPrice` return shapes deliberately parallel; `ResultIdentity`/`identityLine` defined once (Task 5).
- Known verify-anchors: schema nullability (Task 2 Step 2), set-run fixture generators (Task 3 Step 1), StressResponse refined shape (Task 5), observatory/history wire shapes (Task 6 items 3-4) — each step instructs the executor to read the real shape and record decisions in the ledger.
