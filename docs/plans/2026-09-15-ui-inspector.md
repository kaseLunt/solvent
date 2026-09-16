# UI Plan 2 — Inspector · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/inspector` and `/inspector/[addr]` as the Console-register page the owner approved in `docs/specs/2026-09-15-ui-mockups/pages-console.html` (the Inspector block, lines 210–276): one verdict sentence a cardholder would want to read, five tiles, "What backs this debt", a Trust checklist with a room-over-batches sparkline, and — below the fold — History · Activity · Legacy Aave v3 position · Stress this address · the Inputs · Calculation · Provenance drawer. All seven states (healthy · near cap · liquidatable · cannot compute · no position · invalid address · loading) render into the same frame; a screenshot pin keeps the build from drifting.

**Architecture:** New pure modules in `web/lib/` carry every derivation and are unit-pinned first: `percent` and `human-price` (exact bigint formatting), `inspector-position` (a `RefinedPosition` → Cash reading, collateral legs, boundary sentence, Prices chip), `trust` (the five checklist items), `room-history` (room % per batch from `/history`, near-cap streak), `inspector-headline` (the §3.5 Inspector templates plus the honest extra states), `address-stress` and `activity-rows` (table models), `lookup-error`, `recent-lookups`. A `useAddressLookup` hook loads `/v1/address/{addr}`, `/history`, `/stress`, `/v1/params?engine=debt_manager` and `/v1/evidence`, address-keyed and resume-repaired (the existing surface's laws, moved). `deriveInspectorView` turns one reading into one view model that the surface AND the tests read — the same shape Plan 1 used for the Book (`lib/cash-view.ts`). The kit grows `AddressField`, `TrustChecklist` and a `Sparkline` re-export from the mockup's `.k-search` / `.k-check` CSS. Thin page components compose the kit. The old Inspector components, `lib/inspector-lines.ts`, and the e2e pins that described the old DOM are retired with ledger notes; semantic pins are re-expressed against the new `data-testid` contract.

**Tech Stack:** Next.js 16 App Router (client components for data), TypeScript strict, CSS modules + `tokens.css`, `@solvent/client` as the only data path (`address()`, `addressHistory()`, `addressStress()`, `events()`, `params()`, `evidence()` — all sealed lookups), Playwright (unit project for pure logic, e2e project against `next start` on :3111), stylelint token gate.

**Spec:** `docs/specs/2026-09-15-ui-product-register-design.md` — §5.3 Inspector, §3.5 Inspector headline templates, §3.2 names, §3.3 materiality (display only; the Inspector has one account so the line does not partition anything here), §4 kit rows `AddressField` / `TrustChecklist` / `Sparkline` / `EvidenceDrawer`, §6 layout, §7 tests, §9 process, §11 acceptance. Mockup: `docs/specs/2026-09-15-ui-mockups/pages-console.html:210-276`.

**Predecessor:** Plan 1, `docs/plans/2026-09-15-ui-kit-overview-book.md` (landed `b891fe7..d989286`). This plan consumes: `web/components/kit/*` (`VerdictHeader`, `KpiTile`, `ChartCard`, `KitTable`, `StatusPill`, `SectionHead`, `IdentityChips`, `SmallToggle`, `kit.module.css`), `lib/human-usd.ts` (`humanUsd`, `MINUS`), `lib/cash-view.ts` (`ViewChip`), `lib/refusal-phrasebook.ts` (`plainCause`), `lib/headroom.ts` (`headroomBand`, `headroomPercent`, `headroomTenths`, `WARN_HEADROOM_PCT`), `lib/freshness.ts` (`humanAge`, `receiptIdentity`), `lib/freshnessTiers.ts`, `lib/live-age.ts` (`useAnchoredAgeSeconds`), `lib/meta.tsx` (`useMetaConstants`), `lib/wireGuard.ts`, `lib/format.ts`, `lib/inspector-data.ts` (kept: `fetchAddressHistory`, `fetchEvents`, `fetchParams`, `txExplorerUrl`, the re-exported wire types), `lib/history-series.ts` (kept: `buildHistorySeries`, `displayHf` for the legacy card), `lib/factorPriceGuard.ts`, `lib/liq-distance.ts`, `lib/feed-view.ts` (`feedAmount`), `lib/pagination.ts` (`useCursorPages`), `components/Drawer.tsx`, `components/charts/Sparkline.tsx`, the demo dataset under `tests/fixtures/demo/`, and the screenshot gate (`tests/e2e/screenshots.spec.ts`, `scripts/screenshot-pages.mjs`).

## Global Constraints

- **Names:** `debt_manager` → **Cash**; `aave_v3_etherfi` → **Aave v3 market (legacy)**, "legacy" wherever it is named; `max_borrow_lt` → **borrow cap**; headroom → **room** (dollars, and % of cap). Wire names appear only in the drawer, on hover (`title`), and in evidence.
- **Three-valued `found`:** the page branches ONLY on `lookup.outcome` (`"found" | "not-found" | "unknowable"`). `unknowable` never renders as "no position"; the definitive negative renders only for `not-found`. A `found` with `complete: false` is a FLOOR and says so in the dek.
- **The engine's boolean decides:** the verdict is `liquidation_verdict` (refined by the client). Room bands choose only between *near cap* (room < 10 % of cap, `headroomBand` ∈ {1, 2, 3}) and *healthy*; they never contradict the verdict. Cash is judged by `debt > cap` (strict); the legacy market by its health factor. Never a shared formula; never summed.
- **Strict address law:** an address is `0x` + exactly 40 hex characters, verbatim (`isAddress`). An invalid input is an inline refusal — no navigation, no request, no coercion.
- **Refusals render honestly:** a refused position keeps its readable debt for display, never for a verdict; tiles go to the refused register (`—`, dashed); no `$0` ever stands for an unknown. Sub-cent values print `<$0.01`.
- **Wire guards:** every population read passes `readWirePopulation`; every decimal read passes `isWireDecimal` before `BigInt`; floats appear only as sparkline geometry, never in a printed number or a verdict. `"-0"` IS a legal wire decimal.
- **Resume law:** the age on the identity strip is THIS lookup's own (`useAnchoredAgeSeconds` keyed by `receiptIdentity(served_at, batch.id)`), repaired on resume by re-fetching the same lookup; a failed background repair never replaces a rendered position.
- **Copy is pinned:** the §3.5 Inspector headline templates are produced by `lib/inspector-headline.ts` and asserted verbatim in unit and e2e specs.
- **Type:** no font-size below 12px; every `font-size` is exactly `var(--type-*)` (or a legacy `--t-*`/`--fs-*` token until retired) — stylelint enforces it. Sans for UI text; mono only for addresses, hashes, and exact wire values.
- **`web/lib/**` existing files are untouched**, with two named exceptions: `lib/inspector-lines.ts` is deleted in Task 12 (its activity sentence moves to `lib/activity-rows.ts` in Task 7), and nothing else. New files are added beside the old ones.
- **Both themes, four widths:** the page renders in dark and light; the first viewport at 1440×900 holds the toolbar, the verdict header, the five tiles and the top of the 8/4 grid; below 900px the grid stacks; no horizontal scroll at 390 or 1366+.
- **Commands run from `web/`:** `npm run typecheck`, `npm run lint`, `npm run lint:css`, `npm run build`, `npx playwright test --project=unit <spec>`, `npx playwright test --project=e2e <spec>`. The unit project needs an existing `web/.next` build (run `npm run build` once first).
- **E2E runs against a PRODUCTION build on :3111.** `playwright.config.ts` reuses an existing server on :3111, so a stale `next start` serves the OLD build. Before any e2e run: `npm run build`, then make sure nothing is listening on 3111 (`netstat -ano | findstr :3111`; stop that PID) so Playwright starts a fresh `npm run start`.
- **Commits:** from the repo root, stage by name, run `python roadmap/tools/scope_gate.py` (must print `scope-gate: OK`), then commit. If the gate reports an expired claim, run `python roadmap/tools/claim.py renew claude-integrator --hours 24` and commit `roadmap/claims/CLAIM-claude-integrator.md` alone first. No `Co-Authored-By` lines, no AI attribution.
- **Fixtures are generated, never hand-shaped:** every new fixture file is written by a generator under `web/tests/fixtures/demo/` whose header records provenance; every stamped body passes `checkClocks` from `tests/fixtures/clock-law.mjs` before it is written; the census in `tests/unit/fixture-clock-law.spec.ts` moves in the same commit.
- **Subagents never dispatch subagents.** Implementers write the report file named in their dispatch and return status only.

## Rulings made while planning

The spec is the authority; where §5.3 is silent, these rulings settle it. Each is recorded so the reviewer can check the build against a decision rather than a guess.

- **R1 · Cash position fields.** On `/v1/address/{addr}` the Cash position carries debt in `borrowings`, the cap in `max_borrow_lt`, collateral in `collateral_value_usd`, and per-leg `amount` / `value_usd` / `max_borrow_contribution` (a leg's contribution IS value × that asset's LTV, so the table's **LTV** column is `contribution ÷ value`, shown as a percent and titled with that derivation). `liq_threshold` is null on Cash legs and is not read. Room = cap − debt via `lib/headroom.ts` (num = cap, den = debt), the same arithmetic the Book uses.
- **R2 · Prices chip comes from the position's own `price_inputs`**, not `/v1/params` (the handoff note said params; the wire says otherwise — `/v1/params` is the parameter timeline and feeds only the drawer's provenance section). Value: `{source display} · {oldest age}`; tone from the worst verdict (`fresh` → ok, `stale` → warn, anything else → crit). Source display: `priceproviderv2` → "PriceProvider v2"; `aaveoracle:0x…` → "Aave oracle"; otherwise the wire string.
- **R3 · The boundary sentence follows the wire's solve, not the mockup's prose.** `liquidation_price` is a factor-level closed form: every asset in `factor_assets` moves together by `scale_factor_num/den`, `held_assets` stay flat, and `lowest_healthy_price` per asset is the conservative ceil (healthy at exactly that price; liquidation strictly below). So the sentence is "Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat." (one factor asset) or "…if weETH and ETHFI fall 4.5% together — weETH below $X, ETHFI below $Y — with USDC flat." (several). `diagnostic: true` prefixes "Single-asset diagnostic: ". A liquidatable verdict renders "Already past the boundary" regardless of `never_liquidatable` (the flag is axis-scoped; the verdict is not — Wave R1 law). `never_liquidatable` on a non-liquidatable position renders "No downward move of {assets} alone reaches the boundary." with `noPricePathTitle(reason)` as the hover. Every `FactorPrice` entry is classified with `classifyFactorPrice` before any read; a malformed one renders "Boundary published but unreadable ({fields})", never a number.
- **R4 · Room over batches is derivable from `/history`.** A Debt Manager history point's `health_factor.num / den` IS `MaxBorrowLT / Borrowings` as an exact rational (`internal/risk/types.go:774`; the store reads `hf_num`/`hf_den` for `/history` in `internal/store/p5_address_history.go`), so room % per batch = `headroomTenths(num, den)`. Refused points, withheld batches, no-row batches and points without a published ratio are gaps with titles, never values. A no-debt point (`infinite`) is room 100 % — a knowable value. The Trust card's mini sparkline and the History card plot the same series; the 10 % reference line is `WARN_HEADROOM_PCT`. **Cost if wrong:** the sparkline is all gaps on real data — visible and honest, fixed by a one-line read.
- **R5 · Trust checklist items.** Five, in the mockup's order: *Computed this batch* (`status`), *Prices fresh* (worst `price_inputs[].verdict`, oldest age vs smallest budget), *Collateral sweep* (the `debt_manager` watermark's `sweep` + `as_of.sweep_block`; `0` = never swept, refused), *Price provenance* (`engine-exact` ok; `adapter-output` warn "not oracle-direct"), *Book reconciles to chain* (the `/v1/evidence` reconcile receipt's `debt_manager` weld — a BOOK-level, committed receipt, so the label says "Book" and the detail says "committed receipt"; unavailable → dim, never ok).
- **R6 · Headline variants beyond §3.5.** The spec names five Inspector templates; the page has states the spec does not word. Pinned here: *not computed* (found, Cash position refused) `Cannot say — this account's Cash position was not computed this batch.`; *legacy only* (found, no Cash position) `No Cash position in batch {id}; a legacy Aave v3 position exists.`; *loading* `Looking up this address…`; *unavailable* `The lookup could not be completed.`; *invalid* `Not an address.` The dek for the three Cash verdict states is `Borrowing {debt} against a {cap} cap — {used}% used.` followed by the state's own sentence (Task 6).
- **R7 · "Stress this address →" in the toolbar is an in-page link to `#stress`** (the inline results section) in this plan. Plan 3 (Scenarios) retargets it to `/lab?address={addr}` once the Lab reads that parameter; a link the destination ignores would be a dead end today.
- **R8 · The Overview's CTA form stays as it is** (it is a different composition: Open the book · address · Run a scenario, pinned by a screenshot). `AddressField` replaces only `app/inspector/AddressEntry.tsx`. Plan 4 may converge the Overview onto `AddressField`.
- **R9 · The landing (`/inspector`) H1 becomes "Is this address at risk?"** with kicker "Inspector"; `tests/e2e/shell.spec.ts`'s Inspector row is updated in Task 12. The landing carries the field, the recent lookups (browser-local), and one sentence.
- **R10 · `Sparkline` stays where it is and is re-exported from the kit** (`components/kit/index.ts`); its SVG internals are untouched (spec §4: "kept").
- **R11 · The legacy card is a collapsed `<details>`** like `BookLegacy`, HF-based, labeled legacy, never adjacent to a Cash sum. Its HF sparkline uses the kept `buildHistorySeries`.
- **R12 · Activity is a real table:** When (custodied block time, else the block number — never an invented time) · Action · Asset · Amount (engine accounting unit via `feedAmount`, unit on hover) · Tx (explorer link by chain id). The untimed-tail sentence (`activityTakeaway`) moves verbatim into `lib/activity-rows.ts`. The table is mounted with `key={addr}` so one address's rows can never sit under another's head.
- **R13 · `EvidenceDrawer` stays for the pages that use it** (Lab, Proof). The Inspector's "Inputs · Calculation · Provenance" is a new `InspectorDrawer` on `components/Drawer.tsx`, the way `BookMethodology` is built.
- **R14 · Retired e2e pins that expressed a semantic law are re-expressed, not dropped.** The mapping is enumerated in Task 12 (which old test → which new unit/e2e pin, or "retired, law now lives in `lib/…` unit spec").
- **R15 · "% used" is the printed complement of room.** Room is `headroomTenths(cap, debt)` (floored tenths, the Book's law); used is `1000 − roomTenths`, formatted. Truncating both independently prints "96.1% used" beside "3.8% room" for the mockup's account (4,822 of 5,012.50 = 96.1995…), and a reader adds them to 99.9. One figure is derived, the other is its complement, so the pair always sums to 100.0 and the liquidatable arm reads "107.8% used" beside "−7.8% room". A position with a zero cap has no room percent and prints "—" for both; it is still computed and still liquidatable.

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `web/lib/percent.ts` | `percentTenths`, `formatTenths`, `percentOf`, `fallPercent` — exact percent strings from two wire integers |
| `web/lib/human-price.ts` | `humanPrice` (unit prices: 4 places under $10, else 2), `humanAmount` (token amounts, ≤4 fraction digits, grouped), `humanUsdFull` (account-level money: grouped whole dollars ≥ $1,000, cents below, never the Book's K/M/B tiers) |
| `web/lib/inspector-position.ts` | `readCashPosition`, `isComputedCash`, `collateralTable`, `boundaryOf`, `pricesChip`, `sourceDisplay`, `symbolFor`, `CASH`, `LEGACY` |
| `web/lib/trust.ts` | `trustChecklist(input): TrustItem[]` — the five items (R5) |
| `web/lib/room-history.ts` | `roomSeries`, `nearCapStreak` — room % per batch from `/history` (R4) |
| `web/lib/inspector-headline.ts` | `engineName`, `cashHeadline`, `noPositionHeadline`, `cannotComputeHeadline`, `notComputedHeadline`, `otherEngineHeadline`, `unavailableLookupHeadline`, `LOADING_HEADLINE`, `INVALID_HEADLINE` |
| `web/lib/address-stress.ts` | `stressReading(lookup, account, decimals)` — inline scenario rows |
| `web/lib/activity-rows.ts` | `actionLabel`, `activityRows`, `activityTakeaway` (moved) |
| `web/lib/lookup-error.ts` | `describeLookupError` (moved from the old surface) |
| `web/lib/recent-lookups.ts` | `parseRecents`, `pushRecent`, `rememberLookup`, `useRecentLookups` |
| `web/lib/address-lookup.tsx` | `useAddressLookup(addr): AddressReading`, `useAddressActivity(addr)` |
| `web/lib/inspector-view.ts` | `deriveInspectorView(reading, constants): InspectorView` |
| `web/components/kit/AddressField.tsx` | the `.k-search` toolbar field: strict input, Inspect, optional ghost action, inline refusal |
| `web/components/kit/TrustChecklist.tsx` | the `.k-check` list |
| `web/app/inspector/InspectorLanding.tsx` | `/inspector`: kicker, H1, field, recents |
| `web/app/inspector/[addr]/{InspectorTiles,BackingTable,TrustCard,HistoryCard,ActivityTable,LegacyCard,StressTable,InspectorDrawer}.tsx` | page sections |
| `web/tests/unit/{percent,human-price,inspector-position,trust,room-history,inspector-headline,address-stress,activity-rows,lookup-error,recent-lookups,inspector-view,demo-inspector-weld}.spec.ts` | pure pins |
| `web/tests/fixtures/demo/generate-demo-inspector.mjs` | the Inspector demo dataset generator (batch 18,251, clock-law checked) |
| `web/tests/fixtures/demo/{address-demo-near,address-demo-liquidatable,address-demo-healthy,address-demo-refused,history-demo-near,events-demo-near,params-demo-dm,stress-demo-near}.json` | generated bodies |

**Modified**

| Path | Change |
|---|---|
| `web/components/kit/kit.module.css` | `.search*`, `.check*` rules (mockup `.k-search`, `.k-check`, tokens substituted) |
| `web/components/kit/index.ts` | export `AddressField`, `TrustChecklist`, re-export `Sparkline` |
| `web/app/inspector/page.tsx` | renders `InspectorLanding` |
| `web/app/inspector/[addr]/page.tsx` | renders `<InspectorSurface key={addr} addr={addr} />` |
| `web/app/inspector/[addr]/InspectorSurface.tsx` | rewritten as the composition |
| `web/app/inspector/inspector.module.css` | rewritten (small; page-local only) |
| `web/tests/fixtures/demo/index.ts` | exports the new bodies and `DEMO_NEAR_ADDR` etc. |
| `web/tests/unit/fixture-clock-law.spec.ts` | census entries + `CENSUS_TOTAL` |
| `web/tests/e2e/inspector.spec.ts` | rewritten: the page-test contract |
| `web/tests/e2e/{screenshots,shell,state-matrix,runbook-bsplit,p0-fixes,p1b-fixes,r1-fixes,r3-fixes,r4-fixes,r6-fixes}.spec.ts` | pins added / re-expressed / retired per Task 12 |
| `web/scripts/screenshot-pages.mjs` | `inspector` page + its route mocks |
| `.superpowers/sdd/progress-ui-overhaul.md` | retirement ledger lines |

**Retired (deleted in Task 12)**

`web/app/inspector/AddressEntry.tsx`, `web/app/inspector/[addr]/InspectorPositionCard.tsx`, `web/app/inspector/[addr]/InspectorHistory.tsx`, `web/app/inspector/[addr]/InspectorActivity.tsx`, `web/lib/inspector-lines.ts`, `web/tests/unit/inspector-lines.spec.ts`. Everything else the old Inspector imported (`EvidenceDrawer`, `RefusedTag`, `SeverityHF`, `EngineChip`, `MarksStamp`, `AddressMono`, `Stampline`, `lib/evidence.ts`, `lib/params-format.ts`, `lib/liq-distance.ts`, `lib/factorPriceGuard.ts`, `lib/history-series.ts`, `lib/sparkline-scale.ts`) is still imported by Lab / Proof / Observatory / Feed / the styleguide and stays for Plan 4.

## Who builds what (spec §9.2, owner's hybrid ruling)

The integrator builds the visual tasks personally: **Task 1** (kit parts), **Task 11** (the page), **Task 13** (screenshot pins + the owner's side-by-side gate). Subagents (`model: fable`, agent type `serena-coder`) build the logic tasks **2–10** and the test-heavy **Task 12**; each gets its brief, the interfaces named in this plan, and a report path. Task reviewers gate every task; the whole-branch review and the Codex round close the plan (Task 14).

## Test ID contract (the page-test contract's vocabulary)

| Element | `data-testid` | Notes |
|---|---|---|
| Surface root | `inspector-surface` | `data-state` ∈ `loading · invalid · unavailable · healthy · near · liquidatable · not-computed · cannot-compute · no-position · legacy-only` |
| Toolbar field | `inspector-address`, `-input`, `-inspect`, `-secondary`, `-refused` | from `AddressField` |
| Verdict header | `inspector-verdict`, `-headline`, `-dek`, `-identity` | from `VerdictHeader`; chips carry `data-chip="{label}"` |
| Tiles | `inspector-kpi-{debt,cap,room,collateral,status}` | `data-tone` from `KpiTile` |
| Backing table | `inspector-backing`, cap row `inspector-backing-cap`, sentence `inspector-boundary` | |
| Trust | `inspector-trust`, items `inspector-trust-{computed,prices,sweep,provenance,reconcile}` with `data-state` | |
| Room sparkline (Trust card) | `inspector-room-spark` | |
| History card | `inspector-history`, legacy HF `inspector-history-legacy` | |
| Activity | `inspector-activity`, `inspector-activity-more`, `inspector-activity-takeaway` | |
| Legacy card | `inspector-legacy` | `<details>` |
| Stress | `inspector-stress` (section, `id="stress"`), `inspector-stress-table` | |
| Drawer | `inspector-drawer` (button), `inspector-drawer-body` | |
| Landing | `inspector-landing`, `inspector-recent` | field is `inspector-address` here too |

---

### Task 1: Kit — `AddressField`, `TrustChecklist`, `Sparkline` re-export, `.k-search`/`.k-check` CSS; recent-lookups store

**Integrator builds this personally** (visual; spec §9.2).

**Files:**
- Modify: `web/components/kit/kit.module.css` (append after the `.kv*` rules, line 120)
- Create: `web/components/kit/AddressField.tsx`, `web/components/kit/TrustChecklist.tsx`
- Modify: `web/components/kit/index.ts`
- Create: `web/lib/recent-lookups.ts`
- Test: `web/tests/unit/recent-lookups.spec.ts`

**Interfaces:**
- Produces `AddressField({ initial?, onInspect(address), secondary?: {href,label}, hint?, testId })`, `TrustChecklist({ items: TrustCheckItem[], testId? })` with `TrustCheckItem { id; label; detail; state: "ok"|"warn"|"refused"|"dim"; title? }`, `ADDRESS_REFUSED_COPY`, and `Sparkline` (re-export of `components/charts/Sparkline`).
- Produces `parseRecents(raw: string | null): string[]`, `pushRecent(recents, address): string[]`, `rememberLookup(address): void`, `useRecentLookups(): string[]`, `RECENT_KEY = "solvent-recent-lookups"`, `RECENT_MAX = 8`.
- Task 4's `TrustItem` is structurally identical to `TrustCheckItem` (lib never imports from components).

- [ ] **Step 1: The failing unit spec**

```ts
// web/tests/unit/recent-lookups.spec.ts
import { expect, test } from "@playwright/test";
import { parseRecents, pushRecent, RECENT_MAX } from "../../lib/recent-lookups";

const A = "0xAAaA000000000000000000000000000000000001";
const B = "0xBBbB000000000000000000000000000000000002";

test("parseRecents keeps only valid addresses from a JSON array, and refuses anything else", () => {
  expect(parseRecents(JSON.stringify([A, "nope", 7, B]))).toEqual([A, B]);
  expect(parseRecents("not json")).toEqual([]);
  expect(parseRecents(JSON.stringify({ a: 1 }))).toEqual([]);
  expect(parseRecents(null)).toEqual([]);
});

test("pushRecent moves a repeat to the front, dedupes, and caps at RECENT_MAX", () => {
  expect(pushRecent([B, A], A)).toEqual([A, B]);
  const many = Array.from({ length: 10 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
  expect(pushRecent(many, A)).toHaveLength(RECENT_MAX);
  expect(pushRecent(many, A)[0]).toBe(A);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx playwright test --project=unit tests/unit/recent-lookups.spec.ts`
Expected: FAIL — cannot find module `../../lib/recent-lookups`.

- [ ] **Step 3: The store**

```ts
// web/lib/recent-lookups.ts
// Recent lookups are a browser-local convenience (localStorage), never data:
// the SSR snapshot is empty so server and client markup agree.
import { useMemo, useSyncExternalStore } from "react";
import { isAddress } from "./format";

export const RECENT_KEY = "solvent-recent-lookups";
export const RECENT_MAX = 8;

export function parseRecents(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && isAddress(entry));
  } catch {
    return [];
  }
}

export function pushRecent(recents: readonly string[], address: string): string[] {
  return [address, ...recents.filter((entry) => entry !== address)].slice(0, RECENT_MAX);
}

function readRaw(): string {
  try {
    return localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function rememberLookup(address: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(parseRecents(readRaw()), address)));
  } catch {
    // Storage unavailable (private mode) — recents are a convenience only.
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("storage", callback);
  };
}

export function useRecentLookups(): string[] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  return useMemo(() => parseRecents(raw), [raw]);
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/recent-lookups.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: The kit CSS — the mockup's rules, tokens substituted**

Append to `web/components/kit/kit.module.css` (mockup `pages-console.html:115-124`):

```css
/* .k-search — the Inspector toolbar (mockup pages-console.html:122-124) */
.search { display: flex; gap: 10px; margin-top: 4px; align-items: center; flex-wrap: wrap; }
.searchIn { flex: 1; min-width: 320px; height: 40px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); display: flex; align-items: center; gap: 12px; padding: 0 14px; font-family: var(--mono); font-size: var(--type-mono); color: var(--ink); }
.searchIn input { flex: 1; min-width: 0; background: none; border: 0; outline: none; font: inherit; color: inherit; }
.searchIn input::placeholder { color: var(--ink-3); }
.searchIn:focus-within { border-color: var(--accent); }
.searchInvalid, .searchInvalid:focus-within { border-color: var(--crit); }
.searchHint { margin-left: auto; color: var(--ink-3); font-family: var(--sans); font-size: var(--type-small); white-space: nowrap; }
.searchRefused { flex-basis: 100%; color: var(--crit-text); font-size: var(--type-small); margin: 0; }
/* .k-check — the Trust checklist (mockup pages-console.html:115-119) */
.check { list-style: none; margin: 12px 0 0; padding: 0; font-size: var(--type-body); }
.check li { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--chip-bg); align-items: baseline; color: var(--ink); }
.checkI { color: var(--ok-text); font-weight: var(--w-semibold); width: 14px; flex: none; }
.checkWarn { color: var(--warn-text); }
.checkRefused { color: var(--crit-text); }
.checkDim { color: var(--ink-3); }
.checkSmall { color: var(--ink-3); margin-left: auto; white-space: nowrap; font-size: var(--type-small); }
@media (max-width: 720px) { .searchIn { min-width: 0; flex-basis: 100%; } .checkSmall { white-space: normal; text-align: right; } }
```

Run: `npm run lint:css` — Expected: clean (every `font-size` is a `--type-*` token).

- [ ] **Step 6: `AddressField`**

```tsx
// web/components/kit/AddressField.tsx
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isAddress } from "@/lib/format";
import styles from "./kit.module.css";

export const ADDRESS_REFUSED_COPY = "An address is 0x followed by 40 hex characters — nothing else is looked up.";

export interface AddressFieldProps {
  /** The address the page is showing, if any — the field starts with it. */
  initial?: string;
  onInspect: (address: string) => void;
  /** A ghost action beside Inspect (the Inspector's "Stress this address →"). */
  secondary?: { href: string; label: string };
  hint?: string;
  testId: string;
}

/** Strict address entry (0x + 40 hex, verbatim). An invalid input is refused inline and never navigates. */
export function AddressField({ initial = "", onInspect, secondary, hint = "any 0x address", testId }: AddressFieldProps) {
  const [value, setValue] = useState(initial);
  const [refused, setRefused] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    onInspect(trimmed);
  };
  return (
    <form className={styles.search} onSubmit={submit} noValidate data-testid={testId}>
      <label className={`${styles.searchIn} ${refused ? styles.searchInvalid : ""}`}>
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setRefused(false);
          }}
          placeholder="0x…"
          aria-label="address to inspect"
          aria-invalid={refused ? "true" : undefined}
          spellCheck={false}
          autoComplete="off"
          data-testid={`${testId}-input`}
        />
        <small className={styles.searchHint}>{hint}</small>
      </label>
      <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} data-testid={`${testId}-inspect`}>
        Inspect
      </button>
      {secondary !== undefined && (
        <Link href={secondary.href} className={`${styles.btn} ${styles.btnGhost}`} data-testid={`${testId}-secondary`}>
          {secondary.label}
        </Link>
      )}
      {refused && (
        <p className={styles.searchRefused} role="alert" data-testid={`${testId}-refused`}>
          {ADDRESS_REFUSED_COPY}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 7: `TrustChecklist`**

```tsx
// web/components/kit/TrustChecklist.tsx
import styles from "./kit.module.css";

export interface TrustCheckItem {
  id: string;
  label: string;
  detail: string;
  state: "ok" | "warn" | "refused" | "dim";
  /** The wire words behind the item (a refusal code, a provenance word), on hover. */
  title?: string;
}

const GLYPH: Record<TrustCheckItem["state"], string> = { ok: "✓", warn: "!", refused: "×", dim: "·" };
const CLASS: Record<TrustCheckItem["state"], string | undefined> = {
  ok: undefined,
  warn: styles.checkWarn,
  refused: styles.checkRefused,
  dim: styles.checkDim,
};

/** The mockup's `.k-check` list: glyph · label · detail, one line per item. */
export function TrustChecklist({ items, testId }: { items: readonly TrustCheckItem[]; testId?: string }) {
  return (
    <ul className={styles.check} data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} data-testid={testId === undefined ? undefined : `${testId}-${item.id}`} data-state={item.state} title={item.title}>
          <span className={`${styles.checkI} ${CLASS[item.state] ?? ""}`} aria-hidden="true">
            {GLYPH[item.state]}
          </span>
          <span>{item.label}</span>
          <small className={styles.checkSmall}>{item.detail}</small>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 8: Exports**

Append to `web/components/kit/index.ts`:

```ts
export { AddressField, ADDRESS_REFUSED_COPY, type AddressFieldProps } from "./AddressField";
export { TrustChecklist, type TrustCheckItem } from "./TrustChecklist";
export { Sparkline, type SparklineProps } from "../charts/Sparkline";
```

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run lint:css`
Expected: clean.

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/components/kit/kit.module.css web/components/kit/AddressField.tsx web/components/kit/TrustChecklist.tsx web/components/kit/index.ts web/lib/recent-lookups.ts web/tests/unit/recent-lookups.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): kit grows AddressField and TrustChecklist from the mockup's search and check rules; recent lookups become a pure store"
```

---

### Task 2: `percent` and `human-price` — exact percent, unit-price and token-amount strings

**Files:**
- Create: `web/lib/percent.ts`, `web/lib/human-price.ts`
- Test: `web/tests/unit/percent.spec.ts`, `web/tests/unit/human-price.spec.ts`

**Interfaces:**
- Produces `percentTenths(num: bigint, den: bigint): bigint | null` (⌊1000·num/den⌉ toward zero; null when den ≤ 0), `formatTenths(tenths: bigint): string` ("96.2%", "50%", "−3.8%" with U+2212), `percentOf(num, den): string | null`, `fallPercent(to: bigint, from: bigint): string | null` (the fall from `from` to `to` as a percent of `from`; null when from ≤ 0 or to > from).
- Produces `humanPrice(value: bigint, decimals: number): string` (under $10 → 4 places, else 2; thousands grouped; truncating; U+2212 for negatives), `humanAmount(value: bigint, decimals: number, maxFraction = 4): string` (grouped whole part, fraction truncated to `maxFraction` digits with trailing zeros dropped), and `humanUsdFull(value: bigint, decimals: number): string` — the Inspector's money: the same rules as `humanUsd` below $10,000 (cents under $1,000, `<$0.01` for sub-cent, `$0` only for a true zero, U+2212) but grouped whole dollars above it, never `K`/`M`/`B`. One account's figures are read exactly; the Book's book-wide sums are read compactly.
- Consumed by Tasks 3, 6, 7, 11.

- [ ] **Step 1: Failing specs**

```ts
// web/tests/unit/percent.spec.ts
import { expect, test } from "@playwright/test";
import { fallPercent, formatTenths, percentOf, percentTenths } from "../../lib/percent";

test("percentTenths truncates toward zero and refuses a non-positive denominator", () => {
  expect(percentTenths(4822000000n, 5012500000n)).toBe(961n); // 96.1995… truncates to 96.1
  expect(percentTenths(190500000n, 5012500000n)).toBe(38n); // 3.80…
  expect(percentTenths(-1n, 3n)).toBe(-333n); // toward zero — floor would give −334
  expect(percentTenths(1n, 0n)).toBeNull();
  expect(percentTenths(1n, -5n)).toBeNull();
});

test("formatTenths prints one decimal only when it is non-zero, and the true minus sign", () => {
  expect(formatTenths(962n)).toBe("96.2%");
  expect(formatTenths(500n)).toBe("50%");
  expect(formatTenths(-38n)).toBe("−3.8%");
  expect(formatTenths(0n)).toBe("0%");
});

test("percentOf and fallPercent compose the two", () => {
  expect(percentOf(4200000000n, 8400000000n)).toBe("50%");
  expect(percentOf(1n, 0n)).toBeNull();
  expect(fallPercent(4009500000n, 4200000000n)).toBe("4.5%"); // 1 − 0.9546 = 4.53…
  expect(fallPercent(4200000000n, 4200000000n)).toBe("0%");
  expect(fallPercent(5n, 4n)).toBeNull(); // a rise is not a fall
  expect(fallPercent(1n, 0n)).toBeNull();
});
```

```ts
// web/tests/unit/human-price.spec.ts
import { expect, test } from "@playwright/test";
import { humanAmount, humanPrice, humanUsdFull } from "../../lib/human-price";

test("humanPrice keeps four places under $10 and two above, grouped, truncating", () => {
  expect(humanPrice(4000000000n, 6)).toBe("$4,000.00");
  expect(humanPrice(3818571429n, 6)).toBe("$3,818.57");
  expect(humanPrice(1250000n, 6)).toBe("$1.2500");
  expect(humanPrice(999999n, 6)).toBe("$0.9999");
  expect(humanPrice(100000000n, 8)).toBe("$1.0000");
  expect(humanPrice(999900000000n, 8)).toBe("$9,999.00");
  expect(humanPrice(-1250000n, 6)).toBe("−$1.2500");
  expect(humanPrice(0n, 6)).toBe("$0.0000");
});

test("humanUsdFull never compacts: grouped dollars above $1,000, cents below, dust and zero as humanUsd", () => {
  expect(humanUsdFull(12462500000n, 6)).toBe("$12,462");
  expect(humanUsdFull(4822000000n, 6)).toBe("$4,822");
  expect(humanUsdFull(190500000n, 6)).toBe("$190.50");
  expect(humanUsdFull(1234567890000n, 6)).toBe("$1,234,567");
  expect(humanUsdFull(-387500000n, 6)).toBe("−$387.50");
  expect(humanUsdFull(5n, 6)).toBe("<$0.01");
  expect(humanUsdFull(0n, 6)).toBe("$0");
  expect(humanUsdFull(600000000000n, 8)).toBe("$6,000");
});

test("humanAmount groups the whole part and trims the fraction to four meaningful digits", () => {
  expect(humanAmount(2100000000000000000n, 18)).toBe("2.1");
  expect(humanAmount(3250000000000000000000n, 18)).toBe("3,250");
  expect(humanAmount(656250000000000000n, 18)).toBe("0.6562");
  expect(humanAmount(4620000000n, 6)).toBe("4,620");
  expect(humanAmount(-150000000n, 6)).toBe("−150");
  expect(humanAmount(5n, 0)).toBe("5");
});
```

- [ ] **Step 2: Run to see both fail**

Run: `npx playwright test --project=unit tests/unit/percent.spec.ts tests/unit/human-price.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: The modules**

```ts
// web/lib/percent.ts
// Percent strings from two wire integers: exact in tenths, truncating toward
// zero, never through a float. The Book's headroom helpers own the room
// arithmetic; this module owns the plain "share of" and "fall from" cases.
import { MINUS } from "./human-usd";

/** ⌊1000 · num / den⌉ toward zero, as tenths of a percent. Null when den ≤ 0. */
export function percentTenths(num: bigint, den: bigint): bigint | null {
  if (den <= 0n) return null;
  return (1000n * num) / den;
}

export function formatTenths(tenths: bigint): string {
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  return `${negative ? MINUS : ""}${whole.toString()}${tenth === 0n ? "" : `.${tenth.toString()}`}%`;
}

/** The share `num` is of `den`, e.g. "96.2%". */
export function percentOf(num: bigint, den: bigint): string | null {
  const tenths = percentTenths(num, den);
  return tenths === null ? null : formatTenths(tenths);
}

/** The fall from `from` down to `to`, as a percent of `from`. Null when nothing fell or `from` ≤ 0. */
export function fallPercent(to: bigint, from: bigint): string | null {
  if (from <= 0n || to > from) return null;
  return formatTenths((1000n * (from - to)) / from);
}
```

```ts
// web/lib/human-price.ts
// Unit prices and token amounts for the collateral table. Prices keep more
// places than money totals do (a $1.25 token needs its cents and a bit); token
// amounts are grouped and trimmed. Both truncate; neither touches a float.
import { DUST_DISPLAY, MINUS } from "./human-usd";

const group = (whole: bigint): string => whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** value · 10^places / 10^decimals, truncating. */
function rescale(value: bigint, decimals: number, places: number): bigint {
  const shift = places - decimals;
  return shift >= 0 ? value * 10n ** BigInt(shift) : value / 10n ** BigInt(-shift);
}

/** A unit price: four places under $10, two otherwise. */
export function humanPrice(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanPrice(-value, decimals)}`;
  const tenThousandths = rescale(value, decimals, 4);
  const places = tenThousandths < 100_000n ? 4 : 2;
  const units = places === 4 ? tenThousandths : rescale(value, decimals, 2);
  const div = 10n ** BigInt(places);
  return `$${group(units / div)}.${(units % div).toString().padStart(places, "0")}`;
}

/** One account's money: never compacted. Cents under $1,000, grouped whole dollars above; `<$0.01` for sub-cent; `$0` only for a true zero. */
export function humanUsdFull(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanUsdFull(-value, decimals)}`;
  if (value === 0n) return "$0";
  const cents = rescale(value, decimals, 2);
  if (cents === 0n) return DUST_DISPLAY;
  const dollars = cents / 100n;
  if (dollars >= 1_000n) return `$${group(dollars)}`;
  const rem = cents % 100n;
  return rem === 0n ? `$${dollars.toString()}` : `$${dollars.toString()}.${rem.toString().padStart(2, "0")}`;
}

/** A token amount in its own decimals, grouped, fraction trimmed to `maxFraction` digits. */
export function humanAmount(value: bigint, decimals: number, maxFraction = 4): string {
  if (value < 0n) return `${MINUS}${humanAmount(-value, decimals, maxFraction)}`;
  const div = 10n ** BigInt(decimals);
  const whole = group(value / div);
  if (decimals === 0) return whole;
  const fraction = (value % div).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}
```

- [ ] **Step 4: Run the specs**

Run: `npx playwright test --project=unit tests/unit/percent.spec.ts tests/unit/human-price.spec.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/percent.ts web/lib/human-price.ts web/tests/unit/percent.spec.ts web/tests/unit/human-price.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): exact percent, unit-price and token-amount strings for the Inspector - bigint only, truncating"
```

---

### Task 3: `inspector-position` — the Cash reading, the collateral table, the boundary sentence, the Prices chip

**Files:**
- Create: `web/lib/inspector-position.ts`
- Test: `web/tests/unit/inspector-position.spec.ts`

**Interfaces:**
- Consumes `RefinedPosition`, `RefinedLeg`, `PriceInput` from `@solvent/client`; `headroomBand/headroomPercent/headroomTenths` from `./headroom`; `percentOf/fallPercent` from `./percent`; `humanPrice/humanAmount` from `./human-price`; `classifyFactorPrice` from `./factorPriceGuard`; `noPricePathTitle` from `./liq-distance`; `humanAge` from `./freshness`; `isWireDecimal` from `./wireGuard`; `ViewChip` from `./cash-view`; `truncateAddress` from `./format`.
- Produces:

```ts
export const CASH = "debt_manager";
export const LEGACY = "aave_v3_etherfi";
export type CashStatus = "liquidatable" | "near" | "healthy" | "refused" | "unknowable";
export interface CashPosition { account; decimals; debt: bigint|null; cap: bigint|null; collateral: bigint|null; room: bigint|null; roomPercent: string|null; roomTenths: bigint|null; usedPercent: string|null /* R15: formatTenths(1000 − roomTenths) */; band: number|null; verdict: "liquidatable"|"not-liquidatable"|"unknowable"; status: CashStatus; refusal: {code; detail: string|null}|null; computed: boolean }
export type ComputedCash = CashPosition & { debt: bigint; cap: bigint; room: bigint; computed: true; status: "liquidatable"|"near"|"healthy" }; // percents stay nullable (zero cap)
export function readCashPosition(position: RefinedPosition): CashPosition;
export function isComputedCash(p: CashPosition): p is ComputedCash;
export interface CollateralLeg { asset; symbol; amount: string|null; price: string|null; priceVerdict: PriceInput["verdict"]|null; value: bigint|null; contribution: bigint|null; ltv: string|null; counted: RefinedLeg["collateral_use"] }
export interface CollateralTable { legs: CollateralLeg[]; sumValue: bigint|null; sumContribution: bigint|null; capAgrees: boolean|null; collateralAgrees: boolean|null }
export function collateralTable(position: RefinedPosition, cash: CashPosition): CollateralTable;
export type Boundary = {kind:"absent"} | {kind:"breached"} | {kind:"no-price-path"; sentence; title} | {kind:"unreadable"; fields: string[]} | {kind:"contradictory"; detail: string} | {kind:"boundary"; sentence; title; diagnostic: boolean; certified: boolean}; // contradictory added at review: a rise or already_breached under a not-liquidatable verdict
export function boundaryOf(position: RefinedPosition, cash: CashPosition): Boundary;
export function sourceDisplay(source: string): string;
export function symbolFor(position: RefinedPosition, asset: string): string;
export function oldestPriceAge(inputs: readonly PriceInput[]): number | null;
export function pricesChip(inputs: readonly PriceInput[]): ViewChip;
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/inspector-position.spec.ts
import { expect, test } from "@playwright/test";
import {
  boundaryOf,
  collateralTable,
  isComputedCash,
  pricesChip,
  readCashPosition,
  sourceDisplay,
} from "../../lib/inspector-position";
import { AAVE, ETHFI, near, WEETH } from "./helpers/cash-position";
```

The shared helper (used again by Task 9's spec) — `web/tests/unit/helpers/cash-position.ts` (no `.spec` suffix, so the unit project does not run it as a test):

```ts
// web/tests/unit/helpers/cash-position.ts
// The mockup's near-cap account, on the wire: cap $5,012.50, debt $4,822, two
// collateral legs (weETH 2.1 @ $4,000 × 50 %, ETHFI 3,250 @ $1.25 × 20 %).
// Built from the contract fixture's Debt Manager position so every field the
// Inspector does not override is a real example value.
import { lookup, type RefinedPosition } from "@solvent/client";
import { ADDRESS_FOUND } from "../../fixtures/inspector";

const found = lookup(ADDRESS_FOUND);
if (found.outcome !== "found") throw new Error("fixture must be found");
const dm = found.response.positions.find((p) => p.engine === "debt_manager");
const aave = found.response.positions.find((p) => p.engine === "aave_v3_etherfi");
if (dm === undefined || aave === undefined) throw new Error("fixture must carry both engines");
export const DM: RefinedPosition = dm;
export const AAVE: RefinedPosition = aave;

export const WEETH = "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF";
export const ETHFI = "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f";

export function near(overrides: Partial<RefinedPosition> = {}): RefinedPosition {
  const leg = DM.legs[0];
  if (leg === undefined) throw new Error("fixture leg");
  const price = DM.price_inputs[0];
  if (price === undefined) throw new Error("fixture price");
  return {
    ...DM,
    liquidation_verdict: "not-liquidatable",
    borrowings: "4822000000",
    max_borrow_lt: "5012500000",
    collateral_value_usd: "12462500000",
    legs: [
      { ...leg, asset: WEETH, symbol: "weETH", decimals: 18, amount: "2100000000000000000", value_usd: "8400000000", max_borrow_contribution: "4200000000", collateral_use: "counted" },
      { ...leg, asset: ETHFI, symbol: "ETHFI", decimals: 18, amount: "3250000000000000000000", value_usd: "4062500000", max_borrow_contribution: "812500000", collateral_use: "counted" },
    ],
    price_inputs: [
      { ...price, asset: WEETH, value: "4000000000", decimals: 6, age_seconds: 35, budget_seconds: 180, verdict: "fresh", fresh: true },
      { ...price, asset: ETHFI, value: "1250000", decimals: 6, age_seconds: 35, budget_seconds: 180, verdict: "fresh", fresh: true },
    ],
    liquidation_price: {
      in_factor: true,
      never_liquidatable: false,
      scale_factor_num: "4009500000",
      scale_factor_den: "4200000000",
      already_breached: false,
      prices: [{ asset: WEETH, current_price: "4000000000", price_decimals: 6, price_floor: "3818571428", lowest_healthy_price: "3818571429" }],
      factor_assets: [WEETH],
      held_assets: [WEETH, ETHFI],
      boundary_is_healthy: true,
      per_token_floor_omitted: false,
      diagnostic: false,
      axis: "eth_usd",
      note: "",
    },
    ...overrides,
  };
}
```

The spec's tests continue (same file, `web/tests/unit/inspector-position.spec.ts`):

```ts
test("readCashPosition: room, percents and the near-cap status from cap and debt", () => {
  const p = readCashPosition(near());
  expect(p.computed).toBe(true);
  expect(p.debt).toBe(4822000000n);
  expect(p.cap).toBe(5012500000n);
  expect(p.room).toBe(190500000n);
  expect(p.roomPercent).toBe("3.8%");
  expect(p.usedPercent).toBe("96.2%");
  expect(p.band).toBe(2); // 2–5 % room
  expect(p.status).toBe("near");
  expect(isComputedCash(p)).toBe(true);
});

test("readCashPosition: the engine's verdict decides liquidatable; healthy is room ≥ 10 %", () => {
  const liq = readCashPosition(near({ borrowings: "5400000000", liquidation_verdict: "liquidatable" }));
  expect(liq.status).toBe("liquidatable");
  expect(liq.room).toBe(-387500000n);
  expect(liq.roomPercent).toBe("−7.8%");
  expect(liq.usedPercent).toBe("107.8%"); // R15: the complement of room, never an independent truncation (107.7)
  const healthy = readCashPosition(near({ borrowings: "2100000000" }));
  expect(healthy.status).toBe("healthy");
  expect(healthy.roomPercent).toBe("58.1%");
  expect(healthy.usedPercent).toBe("41.9%");
  // a zero cap has no room percent and is still computed and liquidatable
  const zeroCap = readCashPosition(near({ max_borrow_lt: "0", liquidation_verdict: "liquidatable" }));
  expect(zeroCap.status).toBe("liquidatable");
  expect(zeroCap.roomPercent).toBeNull();
  expect(zeroCap.usedPercent).toBeNull();
  expect(isComputedCash(zeroCap)).toBe(true);
  // debt == cap is healthy by the strict rule, and sits in the near band
  const equal = readCashPosition(near({ borrowings: "5012500000" }));
  expect(equal.status).toBe("near");
  expect(equal.room).toBe(0n);
});

test("readCashPosition: a refused position keeps its readable debt and computes nothing", () => {
  const refused = readCashPosition(
    near({ status: "refused", refusal: { code: "SWEEP_FAILED", detail: "sweep failed", note: "" }, max_borrow_lt: null, liquidation_verdict: "unknowable", borrowings: "4100000000" }),
  );
  expect(refused.computed).toBe(false);
  expect(refused.status).toBe("refused");
  expect(refused.debt).toBe(4100000000n);
  expect(refused.cap).toBeNull();
  expect(refused.room).toBeNull();
  expect(refused.refusal?.code).toBe("SWEEP_FAILED");
  expect(isComputedCash(refused)).toBe(false);
  // a malformed decimal never becomes a number
  expect(readCashPosition(near({ borrowings: "4.62e9" })).computed).toBe(false);
});

test("collateralTable: amount, price, value, derived LTV, contribution, and the cap/collateral welds", () => {
  const p = near();
  const table = collateralTable(p, readCashPosition(p));
  expect(table.legs.map((l) => l.symbol)).toEqual(["weETH", "ETHFI"]);
  expect(table.legs[0]?.amount).toBe("2.1");
  expect(table.legs[0]?.price).toBe("$4,000.00");
  expect(table.legs[0]?.ltv).toBe("50%");
  expect(table.legs[1]?.amount).toBe("3,250");
  expect(table.legs[1]?.price).toBe("$1.2500");
  expect(table.legs[1]?.ltv).toBe("20%");
  expect(table.sumValue).toBe(12462500000n);
  expect(table.sumContribution).toBe(5012500000n);
  expect(table.capAgrees).toBe(true);
  expect(table.collateralAgrees).toBe(true);
  const drifted = near({ max_borrow_lt: "5000000000" });
  expect(collateralTable(drifted, readCashPosition(drifted)).capAgrees).toBe(false);
});

test("collateralTable: a leg with no price input prints no price; a zero value has no LTV", () => {
  const p = near({ price_inputs: [] });
  const table = collateralTable(p, readCashPosition(p));
  expect(table.legs[0]?.price).toBeNull();
  const zero = near();
  const leg = zero.legs[1];
  if (leg === undefined) throw new Error("leg");
  zero.legs[1] = { ...leg, value_usd: "0", max_borrow_contribution: "0" };
  expect(collateralTable(zero, readCashPosition(zero)).legs[1]?.ltv).toBeNull();
});

test("boundaryOf: the factor-level sentence names the fall, the floor, and what is held flat", () => {
  const p = near();
  const b = boundaryOf(p, readCashPosition(p));
  expect(b.kind).toBe("boundary");
  if (b.kind !== "boundary") return;
  expect(b.sentence).toBe("Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
  expect(b.certified).toBe(true);
  expect(b.diagnostic).toBe(false);
});

test("boundaryOf: several factor assets fall together; a diagnostic solve says so; an uncertified boundary says near", () => {
  const p = near();
  if (p.liquidation_price === null) throw new Error("lp");
  const two = near({
    liquidation_price: {
      ...p.liquidation_price,
      factor_assets: [WEETH, ETHFI],
      held_assets: [WEETH, ETHFI],
      prices: [
        ...p.liquidation_price.prices,
        { asset: ETHFI, current_price: "1250000", price_decimals: 6, price_floor: "1193303", lowest_healthy_price: "1193304" },
      ],
    },
  });
  const b = boundaryOf(two, readCashPosition(two));
  if (b.kind !== "boundary") throw new Error(b.kind);
  expect(b.sentence).toBe("Liquidatable if weETH and ETHFI fall 4.5% together — weETH below $3,818.57, ETHFI below $1.1933.");
  const diag = near({ liquidation_price: { ...p.liquidation_price, diagnostic: true } });
  const d = boundaryOf(diag, readCashPosition(diag));
  if (d.kind !== "boundary") throw new Error(d.kind);
  expect(d.sentence.startsWith("Single-asset diagnostic: ")).toBe(true);
  const uncertified = near({ liquidation_price: { ...p.liquidation_price, boundary_is_healthy: false } });
  const u = boundaryOf(uncertified, readCashPosition(uncertified));
  if (u.kind !== "boundary") throw new Error(u.kind);
  expect(u.certified).toBe(false);
  expect(u.sentence).toContain("near $3,818.57");
});

test("boundaryOf: absent, breached, no-price-path and unreadable arms", () => {
  const absent = near({ liquidation_price: null });
  expect(boundaryOf(absent, readCashPosition(absent)).kind).toBe("absent");
  // a liquidatable verdict is past the boundary — even when the wire also says never_liquidatable
  const p = near();
  if (p.liquidation_price === null) throw new Error("lp");
  const liq = near({ borrowings: "5400000000", liquidation_verdict: "liquidatable", liquidation_price: { ...p.liquidation_price, never_liquidatable: true } });
  expect(boundaryOf(liq, readCashPosition(liq)).kind).toBe("breached");
  const never = near({ liquidation_price: { ...p.liquidation_price, never_liquidatable: true, reason: "position holds no counted collateral in the factor" } });
  const n = boundaryOf(never, readCashPosition(never));
  expect(n.kind).toBe("no-price-path");
  if (n.kind === "no-price-path") {
    expect(n.sentence).toBe("No downward move of weETH alone reaches the boundary.");
    expect(n.title).toContain("position holds no counted collateral in the factor");
  }
  // p1b-4: a null entry and a deleted price_decimals are classified before any read
  const nullEntry = near({ liquidation_price: { ...p.liquidation_price, prices: [null as never] } });
  expect(boundaryOf(nullEntry, readCashPosition(nullEntry)).kind).toBe("unreadable");
  const first = p.liquidation_price.prices[0];
  if (first === undefined) throw new Error("price");
  const { price_decimals: _dropped, ...noScale } = first;
  const unscaled = near({ liquidation_price: { ...p.liquidation_price, prices: [noScale as never] } });
  const u = boundaryOf(unscaled, readCashPosition(unscaled));
  expect(u.kind).toBe("unreadable");
  if (u.kind === "unreadable") expect(u.fields).toContain("price_decimals");
  // p0-8: a served entry without a boundary price is "absent", not a health claim
  const noFloor = near({ liquidation_price: { ...p.liquidation_price, prices: [{ ...first, lowest_healthy_price: null }] } });
  expect(boundaryOf(noFloor, readCashPosition(noFloor)).kind).toBe("absent");
  // p0-9: the observed prices:null serialization folds into the absent arm
  const nullPrices = near({ liquidation_price: { ...p.liquidation_price, prices: null as never } });
  expect(boundaryOf(nullPrices, readCashPosition(nullPrices)).kind).toBe("absent");
});

test("pricesChip: source display, oldest age, worst verdict", () => {
  expect(pricesChip(near().price_inputs)).toEqual({ label: "Prices", value: "PriceProvider v2 · 35s", tone: "ok" });
  const stale = near().price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i));
  expect(pricesChip(stale)).toEqual({ label: "Prices", value: "PriceProvider v2 · 3m", tone: "warn" });
  expect(pricesChip([...near().price_inputs, ...AAVE.price_inputs]).value).toBe("PriceProvider v2 + Aave oracle · 3m");
  expect(pricesChip([{ ...near().price_inputs[0]!, verdict: "missing", value: null, age_seconds: null }]).tone).toBe("crit");
  expect(pricesChip([])).toEqual({ label: "Prices", value: "no inputs", tone: "refused" });
  expect(sourceDisplay("priceproviderv2")).toBe("PriceProvider v2");
  expect(sourceDisplay("aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f")).toBe("Aave oracle");
  expect(sourceDisplay("redstone-classic")).toBe("redstone-classic");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/inspector-position.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/inspector-position.ts
// One Cash position on /v1/address/{addr}, read into what the Inspector prints
// (spec 2026-09-15 §5.3; plan 2 rulings R1–R3). Every decimal passes the wire
// guard before it becomes a bigint; the verdict is the engine's own boolean.
import type { PriceInput, RefinedLeg, RefinedPosition } from "@solvent/client";
import type { ViewChip } from "./cash-view";
import { classifyFactorPrice } from "./factorPriceGuard";
import { truncateAddress } from "./format";
import { humanAge } from "./freshness";
import { headroomBand, headroomPercent, headroomTenths } from "./headroom";
import { humanAmount, humanPrice } from "./human-price";
import { noPricePathTitle } from "./liq-distance";
import { fallPercent, formatTenths, percentOf } from "./percent";
import { isWireDecimal } from "./wireGuard";

export const CASH = "debt_manager";
export const LEGACY = "aave_v3_etherfi";

export type CashStatus = "liquidatable" | "near" | "healthy" | "refused" | "unknowable";

export interface CashPosition {
  readonly account: string;
  readonly decimals: number;
  readonly debt: bigint | null;
  readonly cap: bigint | null;
  readonly collateral: bigint | null;
  readonly room: bigint | null;
  readonly roomPercent: string | null;
  readonly roomTenths: bigint | null;
  readonly usedPercent: string | null;
  readonly band: number | null;
  readonly verdict: RefinedPosition["liquidation_verdict"];
  readonly status: CashStatus;
  readonly refusal: { code: string; detail: string | null } | null;
  readonly computed: boolean;
}

/** A computed Cash position with a verdict. Percents stay nullable: a zero cap has no room percent and is still liquidatable. */
export type ComputedCash = CashPosition & {
  readonly debt: bigint;
  readonly cap: bigint;
  readonly room: bigint;
  readonly computed: true;
  readonly status: "liquidatable" | "near" | "healthy";
};

function wireInt(value: string | null | undefined): bigint | null {
  return typeof value === "string" && isWireDecimal(value) ? BigInt(value) : null;
}

const NEAR_BANDS: ReadonlySet<number> = new Set([1, 2, 3]);

export function readCashPosition(position: RefinedPosition): CashPosition {
  const refusal = position.refusal === null ? null : { code: position.refusal.code, detail: position.refusal.detail ?? null };
  const debt = wireInt(position.borrowings);
  const cap = wireInt(position.max_borrow_lt);
  const collateral = wireInt(position.collateral_value_usd);
  const base = { account: position.account, decimals: position.value_decimals, debt, collateral, verdict: position.liquidation_verdict, refusal };
  const computed = position.status === "computed" && refusal === null && debt !== null && cap !== null;
  if (!computed || debt === null || cap === null) {
    return { ...base, cap: null, room: null, roomPercent: null, roomTenths: null, usedPercent: null, band: null, status: "refused", computed: false };
  }
  const band = headroomBand(cap, debt);
  const status: CashStatus =
    position.liquidation_verdict === "liquidatable"
      ? "liquidatable"
      : position.liquidation_verdict === "unknowable"
        ? "unknowable"
        : band !== null && NEAR_BANDS.has(band)
          ? "near"
          : "healthy";
  const roomTenths = headroomTenths(cap, debt);
  return {
    ...base,
    cap,
    room: cap - debt,
    roomPercent: headroomPercent(cap, debt),
    roomTenths,
    // R15: "used" is the printed complement of room, so the two always sum to 100.0 in print.
    usedPercent: roomTenths === null ? null : formatTenths(1000n - roomTenths),
    band,
    status,
    computed: true,
  };
}

export function isComputedCash(p: CashPosition): p is ComputedCash {
  return p.computed && p.debt !== null && p.cap !== null && p.room !== null && p.status !== "refused" && p.status !== "unknowable";
}

export function symbolFor(position: RefinedPosition, asset: string): string {
  const leg = position.legs.find((l) => l.asset.toLowerCase() === asset.toLowerCase());
  return leg?.symbol ?? truncateAddress(asset);
}

function priceInputFor(position: RefinedPosition, asset: string): PriceInput | null {
  return position.price_inputs.find((i) => i.asset.toLowerCase() === asset.toLowerCase()) ?? null;
}

export interface CollateralLeg {
  readonly asset: string;
  readonly symbol: string;
  readonly amount: string | null;
  readonly price: string | null;
  readonly priceVerdict: PriceInput["verdict"] | null;
  readonly value: bigint | null;
  readonly contribution: bigint | null;
  /** contribution ÷ value, as a percent — the asset's LTV as the engine applied it. */
  readonly ltv: string | null;
  readonly counted: RefinedLeg["collateral_use"];
}

export interface CollateralTable {
  readonly legs: CollateralLeg[];
  readonly sumValue: bigint | null;
  readonly sumContribution: bigint | null;
  /** Σ contribution === max_borrow_lt (null when either side is unreadable). */
  readonly capAgrees: boolean | null;
  readonly collateralAgrees: boolean | null;
}

function isCollateralLeg(leg: RefinedLeg): boolean {
  return leg.value_usd !== null || leg.max_borrow_contribution !== null || leg.amount !== null;
}

export function collateralTable(position: RefinedPosition, cash: CashPosition): CollateralTable {
  const legs = position.legs.filter(isCollateralLeg).map((leg): CollateralLeg => {
    const value = wireInt(leg.value_usd);
    const contribution = wireInt(leg.max_borrow_contribution);
    const amount = wireInt(leg.amount);
    const input = priceInputFor(position, leg.asset);
    const priceValue = input === null ? null : wireInt(input.value);
    return {
      asset: leg.asset,
      symbol: leg.symbol ?? truncateAddress(leg.asset),
      amount: amount === null ? null : humanAmount(amount, leg.decimals),
      price: input === null || priceValue === null || input.decimals === null ? null : humanPrice(priceValue, input.decimals),
      priceVerdict: input?.verdict ?? null,
      value,
      contribution,
      ltv: value === null || contribution === null || value <= 0n ? null : percentOf(contribution, value),
      counted: leg.collateral_use,
    };
  });
  const sum = (pick: (l: CollateralLeg) => bigint | null): bigint | null => {
    const values = legs.map(pick);
    return values.length === 0 || values.some((v) => v === null) ? null : values.reduce<bigint>((s, v) => s + (v ?? 0n), 0n);
  };
  const sumValue = sum((l) => l.value);
  const sumContribution = sum((l) => l.contribution);
  return {
    legs,
    sumValue,
    sumContribution,
    capAgrees: sumContribution === null || cash.cap === null ? null : sumContribution === cash.cap,
    collateralAgrees: sumValue === null || cash.collateral === null ? null : sumValue === cash.collateral,
  };
}

export type Boundary =
  | { kind: "absent" }
  | { kind: "breached" }
  | { kind: "no-price-path"; sentence: string; title: string }
  | { kind: "unreadable"; fields: string[] }
  | { kind: "boundary"; sentence: string; title: string; diagnostic: boolean; certified: boolean };

const list = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;

/** R3: the sentence follows the wire's factor-level solve — assets on the axis move together; held assets stay flat. */
export function boundaryOf(position: RefinedPosition, cash: CashPosition): Boundary {
  const lp = position.liquidation_price;
  if (cash.status === "liquidatable") return { kind: "breached" };
  if (lp === null) return { kind: "absent" };
  const factorSymbols = lp.factor_assets.map((a) => symbolFor(position, a));
  if (lp.never_liquidatable) {
    return {
      kind: "no-price-path",
      sentence: `No downward move of ${list(factorSymbols)} alone reaches the boundary.`,
      title: noPricePathTitle(lp.reason),
    };
  }
  // The API's solver-error path serializes `prices: null` (observed, p0-9): fold into "absent".
  const served = Array.isArray(lp.prices) ? lp.prices : [];
  if (served.length === 0) return { kind: "absent" };
  const classified = served.map((entry) => classifyFactorPrice(entry));
  const bad = classified.find((c) => !c.ok);
  if (bad !== undefined && !bad.ok) return { kind: "unreadable", fields: bad.fields };
  const floors = classified.flatMap((c) => {
    if (!c.ok || c.entry.lowest_healthy_price === null) return [];
    const price = wireInt(c.entry.lowest_healthy_price);
    return price === null ? [] : [{ symbol: symbolFor(position, c.entry.asset), price: humanPrice(price, c.entry.price_decimals) }];
  });
  if (floors.length === 0) return { kind: "absent" };
  const num = wireInt(lp.scale_factor_num);
  const den = wireInt(lp.scale_factor_den);
  const fall = num === null || den === null ? null : fallPercent(num, den);
  const factorSet = new Set(lp.factor_assets.map((a) => a.toLowerCase()));
  const held = lp.held_assets.filter((a) => !factorSet.has(a.toLowerCase())).map((a) => symbolFor(position, a));
  const verb = lp.boundary_is_healthy ? "below" : "near";
  const heldClause = held.length === 0 ? "" : ` — with ${list(held)} flat`;
  const body =
    floors.length === 1
      ? `Liquidatable if ${floors[0]?.symbol ?? ""} falls ${verb} ${floors[0]?.price ?? ""}${fall === null ? "" : ` — a ${fall} fall`}${heldClause}.`
      : `Liquidatable if ${list(floors.map((f) => f.symbol))} fall${fall === null ? "" : ` ${fall}`} together — ${floors.map((f) => `${f.symbol} ${verb} ${f.price}`).join(", ")}${heldClause}.`;
  return {
    kind: "boundary",
    sentence: `${lp.diagnostic ? "Single-asset diagnostic: " : ""}${body}`,
    title: lp.boundary_is_healthy
      ? `At exactly the boundary price the account is still healthy; liquidation begins strictly below it (axis ${lp.axis}).`
      : `The wire does not certify health at exactly this boundary (boundary_is_healthy: false), so no exact-price claim is made (axis ${lp.axis}).`,
    diagnostic: lp.diagnostic,
    certified: lp.boundary_is_healthy,
  };
}

/** R2: wire source names, made readable. Unknown sources print verbatim. */
export function sourceDisplay(source: string): string {
  if (source === "priceproviderv2") return "PriceProvider v2";
  if (source.startsWith("aaveoracle:")) return "Aave oracle";
  return source;
}

export function oldestPriceAge(inputs: readonly PriceInput[]): number | null {
  const ages = inputs.map((i) => i.age_seconds).filter((a): a is number => a !== null);
  return ages.length === 0 ? null : Math.max(...ages);
}

const VERDICT_RANK: Record<PriceInput["verdict"], 0 | 1 | 2> = { fresh: 0, stale: 1, "over-ceiling": 2, missing: 2, "no-as-of": 2, "reorg-unacked": 2 };

export function pricesChip(inputs: readonly PriceInput[]): ViewChip {
  if (inputs.length === 0) return { label: "Prices", value: "no inputs", tone: "refused" };
  const worst = Math.max(...inputs.map((i) => VERDICT_RANK[i.verdict]));
  const sources = [...new Set(inputs.map((i) => sourceDisplay(i.source)))].join(" + ");
  const oldest = oldestPriceAge(inputs);
  return {
    label: "Prices",
    value: `${sources} · ${oldest === null ? "age unknown" : humanAge(oldest)}`,
    tone: worst === 0 ? "ok" : worst === 1 ? "warn" : "crit",
  };
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/inspector-position.spec.ts`
Expected: 10 passed. If `classifyFactorPrice`'s `ok: false` arm names its field list under a different property than `fields`, read `lib/factorPriceGuard.ts:48-68` and use its name — the spec's `toContain("price_decimals")` is the contract, not the property name.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/inspector-position.ts web/tests/unit/inspector-position.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): read a Cash position into room, legs, the boundary sentence and the Prices chip - the engine's verdict decides, the wire's solve is followed"
```

---

### Task 4: `trust` — the five checklist items

**Files:**
- Create: `web/lib/trust.ts`
- Test: `web/tests/unit/trust.spec.ts`

**Interfaces:**
- Consumes `RefinedPosition`, `PriceInput`, `components` from `@solvent/client`; `symbolFor`, `oldestPriceAge`, `CASH` from `./inspector-position`; `plainCause` from `./refusal-phrasebook`; `humanAge` from `./freshness`; `readWirePopulation` from `./wireGuard`.
- Produces:

```ts
export type TrustState = "ok" | "warn" | "refused" | "dim";
export type TrustId = "computed" | "prices" | "sweep" | "provenance" | "reconcile";
export interface TrustItem { readonly id: TrustId; readonly label: string; readonly detail: string; readonly state: TrustState; readonly title?: string }
export interface TrustInput {
  readonly position: RefinedPosition;                 // the Cash position
  readonly batchId: number;                           // already guarded by the caller
  readonly sweep: components["schemas"]["SweepStamp"] | null;        // the debt_manager watermark's sweep
  readonly reconcile: components["schemas"]["ReconcileSummary"] | null; // /v1/evidence's committed receipt
}
export function trustChecklist(input: TrustInput): TrustItem[]; // always five, in this order
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/trust.spec.ts
import { expect, test } from "@playwright/test";
import { ADDRESS_FOUND } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";
import { trustChecklist } from "../../lib/trust";
import { near } from "./helpers/cash-position";

const sweep = ADDRESS_FOUND.batch.watermarks.find((w) => w.engine === "debt_manager")?.sweep ?? null;
if (sweep === null) throw new Error("fixture must carry the debt_manager sweep");
const reconcile = EVIDENCE_MANIFEST.reconcile;
if (reconcile === null || reconcile === undefined) throw new Error("fixture must carry a reconcile receipt");
const byId = (items: ReturnType<typeof trustChecklist>) => Object.fromEntries(items.map((i) => [i.id, i]));

test("five items, in the mockup's order; the happy account is all green except the batch-wide sweep failure", () => {
  const items = trustChecklist({ position: near(), batchId: 18251, sweep, reconcile });
  expect(items.map((i) => i.id)).toEqual(["computed", "prices", "sweep", "provenance", "reconcile"]);
  const t = byId(items);
  expect(t.computed).toMatchObject({ label: "Computed this batch", detail: "batch 18,251", state: "ok" });
  expect(t.prices).toMatchObject({ label: "Prices fresh", detail: "35s · within 180s", state: "ok" });
  // the fixture's sweep stamp: 1 of 3 rows failed, generation 4 — a book-wide caveat, so warn
  expect(t.sweep).toMatchObject({ label: "Collateral sweep", detail: "1 of 3 rows failed · gen 4", state: "warn" });
  expect(t.provenance).toMatchObject({ label: "Price provenance", detail: "engine-exact", state: "ok" });
  expect(t.reconcile).toMatchObject({ label: "Book reconciles to chain", detail: "29/29 Cash rows exact · committed receipt", state: "ok" });
});

test("a refused position names its cause; a stale price names the asset and the budget; a missing price refuses", () => {
  const refused = trustChecklist({
    position: near({ status: "refused", refusal: { code: "SWEEP_NEVER", detail: "no sweep", note: "" } }),
    batchId: 18251,
    sweep,
    reconcile,
  });
  expect(byId(refused).computed).toMatchObject({ state: "refused", detail: "collateral sweep never ran", title: "SWEEP_NEVER" });
  const base = near();
  const stale = base.price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: stale }), batchId: 1, sweep, reconcile })).prices).toMatchObject({
    state: "warn",
    detail: "weETH 210s old · budget 180s",
  });
  const missing = base.price_inputs.map((i, k) => (k === 1 ? { ...i, verdict: "missing" as const, value: null, age_seconds: null, fresh: false } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: missing }), batchId: 1, sweep, reconcile })).prices).toMatchObject({
    state: "refused",
    detail: "ETHFI price missing",
  });
  expect(byId(trustChecklist({ position: near({ price_inputs: [] }), batchId: 1, sweep, reconcile })).prices).toMatchObject({ state: "dim", detail: "no price inputs" });
});

test("sweep: never swept refuses; a clean stamp is ok with its generation and age; no stamp is dim", () => {
  const never = near({ as_of: { ...near().as_of, sweep_block: 0 } });
  expect(byId(trustChecklist({ position: never, batchId: 1, sweep, reconcile })).sweep).toMatchObject({ state: "refused", detail: "never swept · collateral clock absent" });
  const clean = { ...sweep, failed: 0, age_seconds: 1205 };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep: clean, reconcile })).sweep).toMatchObject({ state: "ok", detail: "gen 4 · 20m ago" });
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep: null, reconcile })).sweep).toMatchObject({ state: "dim", detail: "no sweep stamp on this batch" });
});

test("provenance: adapter output warns with the mockup's words; an unknown word is dim and shown verbatim", () => {
  const base = near();
  const adapter = base.price_inputs.map((i, k) => (k === 0 ? { ...i, provenance: "adapter-output" } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: adapter }), batchId: 1, sweep, reconcile })).provenance).toMatchObject({
    label: "weETH price is adapter output",
    detail: "not oracle-direct",
    state: "warn",
  });
  const odd = base.price_inputs.map((i) => ({ ...i, provenance: "replayed" }));
  expect(byId(trustChecklist({ position: near({ price_inputs: odd }), batchId: 1, sweep, reconcile })).provenance).toMatchObject({ state: "dim", detail: "replayed" });
});

test("reconcile: drift warns with the count; no receipt is dim, never ok", () => {
  const drifted = { ...reconcile, result: "fail", gated_drift: 2 };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: drifted })).reconcile).toMatchObject({ state: "warn", detail: "2 drifted rows · fail" });
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: null })).reconcile).toMatchObject({ state: "dim", detail: "receipt unavailable" });
  const noWeld = { ...reconcile, welds: [] };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: noWeld })).reconcile).toMatchObject({ state: "ok", detail: "87/87 rows exact · committed receipt" });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/trust.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/trust.ts
// The Trust checklist (spec 2026-09-15 §5.3; plan 2 ruling R5): five items,
// each a state and a short detail. Nothing here is a verdict — it is what the
// reader needs to decide how much to believe the verdict above it.
import type { PriceInput, RefinedPosition, components } from "@solvent/client";
import { humanAge } from "./freshness";
import { CASH, oldestPriceAge, symbolFor } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { readWirePopulation } from "./wireGuard";

type SweepStamp = components["schemas"]["SweepStamp"];
type ReconcileSummary = components["schemas"]["ReconcileSummary"];

export type TrustState = "ok" | "warn" | "refused" | "dim";
export type TrustId = "computed" | "prices" | "sweep" | "provenance" | "reconcile";

export interface TrustItem {
  readonly id: TrustId;
  readonly label: string;
  readonly detail: string;
  readonly state: TrustState;
  readonly title?: string;
}

export interface TrustInput {
  readonly position: RefinedPosition;
  readonly batchId: number;
  readonly sweep: SweepStamp | null;
  readonly reconcile: ReconcileSummary | null;
}

const n = (value: number): string => value.toLocaleString("en-US");
const isFreshOrStale = (v: PriceInput["verdict"]): boolean => v === "fresh" || v === "stale";

function computedItem(position: RefinedPosition, batchId: number): TrustItem {
  if (position.status === "computed" && position.refusal === null) {
    return { id: "computed", label: "Computed this batch", detail: `batch ${n(batchId)}`, state: "ok" };
  }
  const code = position.refusal?.code ?? "unnamed";
  return { id: "computed", label: "Computed this batch", detail: plainCause(code, position.refusal?.detail), state: "refused", title: code };
}

function pricesItem(position: RefinedPosition): TrustItem {
  const inputs = position.price_inputs;
  if (inputs.length === 0) return { id: "prices", label: "Prices fresh", detail: "no price inputs", state: "dim" };
  const broken = inputs.find((i) => !isFreshOrStale(i.verdict));
  if (broken !== undefined) {
    return { id: "prices", label: "Prices fresh", detail: `${symbolFor(position, broken.asset)} price ${broken.verdict}`, state: "refused", title: broken.verdict };
  }
  const stale = inputs.find((i) => i.verdict === "stale");
  if (stale !== undefined) {
    const age = stale.age_seconds === null ? "age unknown" : `${String(stale.age_seconds)}s old`;
    return { id: "prices", label: "Prices fresh", detail: `${symbolFor(position, stale.asset)} ${age} · budget ${String(stale.budget_seconds)}s`, state: "warn" };
  }
  const oldest = oldestPriceAge(inputs);
  const budget = Math.min(...inputs.map((i) => i.budget_seconds));
  return { id: "prices", label: "Prices fresh", detail: `${oldest === null ? "age unknown" : `${String(oldest)}s`} · within ${String(budget)}s`, state: "ok" };
}

function sweepItem(position: RefinedPosition, sweep: SweepStamp | null): TrustItem {
  if (sweep === null) return { id: "sweep", label: "Collateral sweep", detail: "no sweep stamp on this batch", state: "dim" };
  if (position.as_of.sweep_block === 0) return { id: "sweep", label: "Collateral sweep", detail: "never swept · collateral clock absent", state: "refused" };
  const generation = readWirePopulation(sweep.generation, "sweep.generation");
  const failed = readWirePopulation(sweep.failed, "sweep.failed");
  if (failed > 0) {
    return { id: "sweep", label: "Collateral sweep", detail: `${n(failed)} of ${n(readWirePopulation(sweep.rows, "sweep.rows"))} rows failed · gen ${n(generation)}`, state: "warn" };
  }
  const age = sweep.age_seconds === null ? "" : ` · ${humanAge(sweep.age_seconds)} ago`;
  return { id: "sweep", label: "Collateral sweep", detail: `gen ${n(generation)}${age}`, state: "ok" };
}

function provenanceItem(position: RefinedPosition): TrustItem {
  const inputs = position.price_inputs;
  if (inputs.length === 0) return { id: "provenance", label: "Price provenance", detail: "no price inputs", state: "dim" };
  const adapter = inputs.find((i) => i.provenance === "adapter-output");
  if (adapter !== undefined) {
    return { id: "provenance", label: `${symbolFor(position, adapter.asset)} price is adapter output`, detail: "not oracle-direct", state: "warn", title: "adapter-output" };
  }
  const other = inputs.find((i) => i.provenance !== "engine-exact");
  if (other !== undefined) return { id: "provenance", label: "Price provenance", detail: other.provenance, state: "dim", title: other.provenance };
  return { id: "provenance", label: "Price provenance", detail: "engine-exact", state: "ok" };
}

function reconcileItem(reconcile: ReconcileSummary | null): TrustItem {
  const label = "Book reconciles to chain";
  if (reconcile === null) return { id: "reconcile", label, detail: "receipt unavailable", state: "dim" };
  const drift = readWirePopulation(reconcile.gated_drift, "reconcile.gated_drift");
  if (reconcile.result !== "pass" || drift > 0) {
    return { id: "reconcile", label, detail: `${n(drift)} drifted rows · ${reconcile.result}`, state: "warn", title: reconcile.artifact_path };
  }
  const weld = reconcile.welds.find((w) => w.engine === CASH);
  const exact = weld === undefined ? `${n(readWirePopulation(reconcile.gated_exact, "reconcile.gated_exact"))}/${n(readWirePopulation(reconcile.gated_rows, "reconcile.gated_rows"))} rows exact` : `${n(readWirePopulation(weld.rows_exact, "weld.rows_exact"))}/${n(readWirePopulation(weld.rows_compared, "weld.rows_compared"))} Cash rows exact`;
  return { id: "reconcile", label, detail: `${exact} · committed receipt`, state: "ok", title: reconcile.artifact_path };
}

export function trustChecklist({ position, batchId, sweep, reconcile }: TrustInput): TrustItem[] {
  return [computedItem(position, batchId), pricesItem(position), sweepItem(position, sweep), provenanceItem(position), reconcileItem(reconcile)];
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/trust.spec.ts`
Expected: 5 passed. (`plainCause("SWEEP_NEVER", "no sweep")` must return `"collateral sweep never ran"` — that is the phrasebook's existing entry; if the detail argument changes the output, read `lib/refusal-phrasebook.ts` and pass only the code.)

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/trust.ts web/tests/unit/trust.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Inspector's Trust checklist - five items with states, a book-level reconcile labelled as such"
```

---

### Task 5: `room-history` — room % per batch from `/history`, and the near-cap streak

**Files:**
- Create: `web/lib/room-history.ts`
- Test: `web/tests/unit/room-history.spec.ts`

**Interfaces:**
- Consumes `AddressHistoryEngine`, `AddressHistoryPoint` from `./inspector-data`; `headroomTenths`, `WARN_HEADROOM_PCT` from `./headroom`; `formatTenths` from `./percent`; `plainCause` from `./refusal-phrasebook`; `readWirePopulation`, `wireBigInt` from `./wireGuard`; `formatBlock` from `./format`.
- Produces:

```ts
export type RoomPointKind = "computed" | "refused" | "withheld" | "no-row" | "unpublished" | "zero-cap"; // zero-cap: a published zero cap with debt — past the cap, no percent geometry (review ruling)
export interface RoomPoint { readonly batchId: number; readonly computedAt: string | null; readonly roomTenths: bigint | null; readonly value: number | null; readonly kind: RoomPointKind; readonly title: string; readonly display: string }
export interface RoomSeries { readonly points: RoomPoint[]; readonly values: (number | null)[]; readonly titles: string[]; readonly newest: RoomPoint | null; readonly computedCount: number }
export interface Streak { readonly batches: number; readonly spanSeconds: number | null; readonly newestKind: RoomPointKind | null } // newestKind added at review: a consumer can say the newest batch is withheld
export const NEAR_LINE_TENTHS: bigint; // 10 % as tenths = 100n
export function roomSeries(engine: AddressHistoryEngine, knownBatchIds?: readonly number[]): RoomSeries;
export function nearCapStreak(series: RoomSeries): Streak;
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/room-history.spec.ts
import { expect, test } from "@playwright/test";
import type { AddressHistoryEngine, AddressHistoryPoint } from "../../lib/inspector-data";
import { NEAR_LINE_TENTHS, nearCapStreak, roomSeries } from "../../lib/room-history";

/** A Debt Manager point: num = cap, den = debt (the engine's exact rational, internal/risk/types.go:774). */
function point(batchId: number, cap: string | null, debt = "4822000000", extra: Partial<AddressHistoryPoint> = {}): AddressHistoryPoint {
  return {
    batch_id: batchId,
    computed_at: `2026-08-08T20:${String(batchId).padStart(2, "0")}:00Z`,
    balances_block: 155_323_000 + batchId,
    sweep_block: 155_322_900 + batchId,
    status: "computed",
    refusal: null,
    health_factor: cap === null ? null : { wad: null, num: cap, den: debt, infinite: false, note: "" },
    liquidatable: false,
    total_collateral_base: "12462500000",
    total_debt_base: debt,
    ...extra,
  };
}
const engine = (points: AddressHistoryPoint[], withheld: number[] = []): AddressHistoryEngine => ({
  engine: "debt_manager",
  value_decimals: 6,
  points,
  withheld_batch_ids: withheld,
  note: "",
});

test("room per point is (cap − debt) / cap in tenths; the series is ascending by batch; newest is last", () => {
  const s = roomSeries(engine([point(12, "5012500000"), point(10, "6000000000"), point(11, "5500000000")]));
  expect(s.points.map((p) => p.batchId)).toEqual([10, 11, 12]);
  expect(s.points.map((p) => p.display)).toEqual(["19.6%", "12.3%", "3.8%"]);
  expect(s.values).toEqual([19.6, 12.3, 3.8]);
  expect(s.newest?.batchId).toBe(12);
  expect(s.computedCount).toBe(3);
  expect(s.titles[2]).toContain("batch 12 · room 3.8% of cap @ block 155,323,012");
});

test("gaps: refused, withheld, no-row, no cap published, malformed — each a titled null, never a value", () => {
  const s = roomSeries(
    engine(
      [
        point(5, "5012500000"),
        point(4, null, "4822000000", { status: "refused", refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" }, total_collateral_base: null, total_debt_base: null }),
        point(3, null),
        point(1, "4.62e9"),
      ],
      [2],
    ),
    [0],
  );
  expect(s.points.map((p) => [p.batchId, p.kind, p.value])).toEqual([
    [0, "no-row", null],
    [1, "unpublished", null],
    [2, "withheld", null],
    [3, "unpublished", null],
    [4, "refused", null],
    [5, "computed", 3.8],
  ]);
  expect(s.titles[4]).toContain("not computed");
  expect(s.titles[4]).toContain("sweep failed");
  expect(s.titles[2]).toContain("withheld");
  expect(s.titles[2]).toContain("never");
  expect(s.computedCount).toBe(1);
});

test("a no-debt point is room 100 % — a knowable value, not a gap", () => {
  const s = roomSeries(engine([point(1, "5012500000", "0", { health_factor: { wad: null, num: "5012500000", den: "0", infinite: true, note: "" } })]));
  expect(s.points[0]?.kind).toBe("computed");
  expect(s.points[0]?.display).toBe("100%");
  expect(s.values).toEqual([100]);
});

test("nearCapStreak counts the newest run under the 10 % line and spans it from the stamps", () => {
  expect(NEAR_LINE_TENTHS).toBe(100n);
  const s = roomSeries(engine([point(1, "6000000000"), point(2, "5300000000"), point(3, "5200000000"), point(4, "5012500000")]));
  // 2: (5300−4822)/5300 = 9.0 % ✓, 3: 7.2 % ✓, 4: 3.8 % ✓, 1: 19.6 % ✗
  expect(nearCapStreak(s)).toEqual({ batches: 3, spanSeconds: 120 });
  const broken = roomSeries(engine([point(2, "5300000000"), point(3, null), point(4, "5012500000")]));
  expect(nearCapStreak(broken)).toEqual({ batches: 1, spanSeconds: null });
  expect(nearCapStreak(roomSeries(engine([point(4, "6000000000")])))).toEqual({ batches: 0, spanSeconds: null });
  expect(nearCapStreak(roomSeries(engine([])))).toEqual({ batches: 0, spanSeconds: null });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/room-history.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/room-history.ts
// Room over batches for one Cash account (plan 2 ruling R4). A Debt Manager
// history point's health_factor carries MaxBorrowLT / Borrowings as an exact
// rational (num / den), so room % per batch is the same arithmetic the Book
// uses. Everything the wire refused, withheld or never wrote is a GAP with a
// title — the line breaks rather than drawing across it. Values are geometry
// only (the printed figure is the tenths string).
import { formatBlock } from "./format";
import { headroomTenths, WARN_HEADROOM_PCT } from "./headroom";
import type { AddressHistoryEngine, AddressHistoryPoint } from "./inspector-data";
import { formatTenths } from "./percent";
import { plainCause } from "./refusal-phrasebook";
import { readWirePopulation, wireBigInt } from "./wireGuard";

export type RoomPointKind = "computed" | "refused" | "withheld" | "no-row" | "unpublished";

export interface RoomPoint {
  readonly batchId: number;
  readonly computedAt: string | null;
  readonly roomTenths: bigint | null;
  readonly value: number | null;
  readonly kind: RoomPointKind;
  readonly title: string;
  readonly display: string;
}

export interface RoomSeries {
  readonly points: RoomPoint[];
  readonly values: (number | null)[];
  readonly titles: string[];
  readonly newest: RoomPoint | null;
  readonly computedCount: number;
}

export interface Streak {
  readonly batches: number;
  readonly spanSeconds: number | null;
}

/** The near-cap line, in tenths of a percent of the cap. */
export const NEAR_LINE_TENTHS = BigInt(WARN_HEADROOM_PCT) * 10n;

const gap = (batchId: number, computedAt: string | null, kind: RoomPointKind, title: string, display: string): RoomPoint => ({
  batchId,
  computedAt,
  roomTenths: null,
  value: null,
  kind,
  title: `batch ${String(batchId)} · ${title}`,
  display,
});

function pointFor(point: AddressHistoryPoint): RoomPoint {
  const batchId = readWirePopulation(point.batch_id, "batch_id");
  if (point.status === "refused") {
    const code = point.refusal?.code ?? "unnamed";
    return gap(batchId, point.computed_at, "refused", `not computed · ${plainCause(code, point.refusal?.detail)}`, "not computed");
  }
  const hf = point.health_factor;
  if (hf === null) return gap(batchId, point.computed_at, "unpublished", "no cap published for this point", "—");
  const computed = (tenths: bigint, title: string): RoomPoint => ({
    batchId,
    computedAt: point.computed_at,
    roomTenths: tenths,
    value: Number(tenths) / 10,
    kind: "computed",
    title: `batch ${String(batchId)} · ${title}`,
    display: formatTenths(tenths),
  });
  if (hf.infinite) return computed(1000n, "no debt · room is the whole cap");
  const num = hf.num === null ? null : wireBigInt(hf.num);
  const den = hf.den === null ? null : wireBigInt(hf.den);
  if (num === null || den === null) return gap(batchId, point.computed_at, "unpublished", "the ratio behind this point is not readable", "—");
  const tenths = headroomTenths(num, den);
  if (tenths === null) return gap(batchId, point.computed_at, "unpublished", "cap not positive for this point", "—");
  return computed(tenths, `room ${formatTenths(tenths)} of cap @ block ${formatBlock(point.balances_block)}`);
}

export function roomSeries(engine: AddressHistoryEngine, knownBatchIds: readonly number[] = []): RoomSeries {
  const byBatch = new Map<number, RoomPoint>();
  for (const point of engine.points) {
    const entry = pointFor(point);
    byBatch.set(entry.batchId, entry);
  }
  for (const id of engine.withheld_batch_ids) {
    const batchId = readWirePopulation(id, "withheld_batch_ids[]");
    if (!byBatch.has(batchId)) byBatch.set(batchId, gap(batchId, null, "withheld", 'Cash book withheld — cannot be established (never "no position")', "withheld"));
  }
  for (const batchId of knownBatchIds) {
    if (!byBatch.has(batchId)) byBatch.set(batchId, gap(batchId, null, "no-row", "no row for this account in this batch", "no row"));
  }
  const points = [...byBatch.values()].sort((a, b) => a.batchId - b.batchId);
  return {
    points,
    values: points.map((p) => p.value),
    titles: points.map((p) => p.title),
    newest: points.length === 0 ? null : (points[points.length - 1] ?? null),
    computedCount: points.filter((p) => p.kind === "computed").length,
  };
}

/** The newest run of consecutive computed points under the near-cap line, and the time it spans. */
export function nearCapStreak(series: RoomSeries): Streak {
  let count = 0;
  let oldest: RoomPoint | null = null;
  for (let i = series.points.length - 1; i >= 0; i -= 1) {
    const p = series.points[i];
    if (p === undefined || p.kind !== "computed" || p.roomTenths === null || p.roomTenths >= NEAR_LINE_TENTHS) break;
    count += 1;
    oldest = p;
  }
  const newest = series.newest;
  const span =
    count >= 2 && oldest?.computedAt != null && newest?.computedAt != null
      ? Math.floor((Date.parse(newest.computedAt) - Date.parse(oldest.computedAt)) / 1000)
      : null;
  return { batches: count, spanSeconds: span === null || Number.isNaN(span) ? null : span };
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/room-history.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/room-history.ts web/tests/unit/room-history.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): room over batches from the address history - the engine's exact rational per point, gaps as gaps, the near-cap streak"
```

---

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

### Task 8: `lookup-error` and the `useAddressLookup` hook

**Files:**
- Create: `web/lib/lookup-error.ts`, `web/lib/address-lookup.ts`
- Test: `web/tests/unit/lookup-error.spec.ts` (the hook itself is exercised by the e2e contract in Task 12)

**Interfaces:**
- Consumes `getSolventClient`, `solventBaseUrl` from `./api`; `fetchAddressHistory`, `fetchEvents`, `fetchParams`, `ChainEvent`, `ParamChange` from `./inspector-data`; `useAnchoredAgeSeconds`, `LiveAgeReading` from `./live-age`; `receiptIdentity` from `./freshness`; `useCursorPages`, `CursorPages` from `./pagination`; `EvidenceManifest` from `./evidence`; `CASH` from `./inspector-position`; `AddressLookup`, `HistoryLookup`, `StressLookup`, the error classes from `@solvent/client`.
- Produces:

```ts
export function describeLookupError(cause: unknown): string;   // moved verbatim from app/inspector/[addr]/InspectorSurface.tsx
export type Phase<T> = { readonly phase: "loading" } | { readonly phase: "error"; readonly message: string } | { readonly phase: "ready"; readonly value: T };
export interface AddressReading {
  readonly address: string; readonly valid: boolean;
  readonly lookup: Phase<AddressLookup>; readonly history: Phase<HistoryLookup>; readonly stress: Phase<StressLookup>;
  readonly params: Phase<readonly ParamChange[]>;   // debt_manager timeline; fetched only when a Cash position exists
  readonly evidence: EvidenceManifest | null;        // book-level; null until it arrives or if it fails
  readonly age: LiveAgeReading; readonly reload: () => void;
}
export function useAddressLookup(addr: string): AddressReading;
export function useAddressActivity(addr: string, valid: boolean): CursorPages<ChainEvent>;  // the caller mounts its table with key={addr}
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/lookup-error.spec.ts
import { expect, test } from "@playwright/test";
import { describeLookupError } from "../../lib/lookup-error";

test("an Error is its message; a non-Error is stringified — an error is never turned into an answer", () => {
  expect(describeLookupError(new Error("the socket closed"))).toBe("the socket closed");
  expect(describeLookupError("offline")).toBe("offline");
  expect(describeLookupError(42)).toBe("42");
});
```

(The typed arms — 503 `UnavailableError`, 429 `RateLimitedError`, `ContractInvariantError`, `SolventHttpError` — are pinned end-to-end in Task 12: the 503 test asserts the dek contains "no servable batch".)

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/lookup-error.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `lookup-error.ts`**

Move `describeLookupError` out of `web/app/inspector/[addr]/InspectorSurface.tsx` (lines 55–70 at HEAD) verbatim:

```ts
// web/lib/lookup-error.ts
// A lookup failure, in words. An error is not an answer: none of these
// sentences is "no position", and none is a position.
import { ContractInvariantError, RateLimitedError, SolventHttpError, UnavailableError } from "@solvent/client";

export function describeLookupError(cause: unknown): string {
  if (cause instanceof UnavailableError) {
    return "no servable batch: the service refuses to answer from nothing (503)";
  }
  if (cause instanceof RateLimitedError) {
    const retry = cause.retryAfterSeconds;
    return `rate limited (429)${retry === null ? "" : `, retry after ${String(retry)}s`}`;
  }
  if (cause instanceof ContractInvariantError) {
    return `the response contradicts its own contract, so it is not rendered (${cause.message})`;
  }
  if (cause instanceof SolventHttpError) {
    return `${String(cause.status)} ${cause.code}: ${cause.message}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
```

- [ ] **Step 4: `address-lookup.ts`**

```ts
// web/lib/address-lookup.ts
"use client";

// The Inspector's data seam (spec 2026-09-15 §5.3). Every result is keyed by
// the address it answers FOR — a result for another address is simply not
// this page's state — and the position lookup is repaired on resume with its
// own envelope (Wave R4/R6 laws, moved from the old surface). The surface is
// mounted with key={addr} as well; the keying here is the second lock.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AddressLookup, HistoryLookup, StressLookup } from "@solvent/client";
import { getSolventClient, solventBaseUrl } from "./api";
import type { EvidenceManifest } from "./evidence";
import { isAddress } from "./format";
import { receiptIdentity } from "./freshness";
import { fetchAddressHistory, fetchEvents, fetchParams, type ChainEvent, type ParamChange } from "./inspector-data";
import { CASH } from "./inspector-position";
import { useAnchoredAgeSeconds, type LiveAgeReading } from "./live-age";
import { describeLookupError } from "./lookup-error";
import { useCursorPages, type CursorPages } from "./pagination";

export type Phase<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly value: T };

export interface AddressReading {
  readonly address: string;
  readonly valid: boolean;
  readonly lookup: Phase<AddressLookup>;
  readonly history: Phase<HistoryLookup>;
  readonly stress: Phase<StressLookup>;
  readonly params: Phase<readonly ParamChange[]>;
  readonly evidence: EvidenceManifest | null;
  readonly age: LiveAgeReading;
  readonly reload: () => void;
}

type Keyed<T> = { readonly for: string; readonly state: Phase<T> } | null;
const LOADING = { phase: "loading" } as const;

function forAddress<T>(keyed: Keyed<T>, addr: string): Phase<T> {
  return keyed !== null && keyed.for === addr ? keyed.state : LOADING;
}

/** One address-keyed fetch. `fetcher` must be referentially stable per address (useCallback on addr). */
function useKeyedFetch<T>(addr: string, enabled: boolean, epoch: number, fetcher: (signal: AbortSignal) => Promise<T>): Phase<T> {
  const [result, setResult] = useState<Keyed<T>>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetcher(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "ready", value } });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "error", message: describeLookupError(cause) } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [addr, enabled, epoch, fetcher]);
  return enabled ? forAddress(result, addr) : LOADING;
}

const fetchCashParams = async (signal: AbortSignal): Promise<readonly ParamChange[]> =>
  (await fetchParams(solventBaseUrl(), { engine: CASH }, signal)).params;

export function useAddressLookup(addr: string): AddressReading {
  const valid = isAddress(addr);
  const [epoch, setEpoch] = useState(0);
  const [lookupResult, setLookupResult] = useState<Keyed<AddressLookup>>(null);
  const [evidence, setEvidence] = useState<EvidenceManifest | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const loadLookup = useCallback(
    (options?: { keepOnFailure?: boolean }): Promise<boolean> => {
      if (!valid) return Promise.resolve(false);
      const keepOnFailure = options?.keepOnFailure ?? false;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      return getSolventClient()
        .address(addr, controller.signal)
        .then(
          (value) => {
            // An abort is a supersession, not an answer: the request that replaced this one reports for itself.
            if (controller.signal.aborted) return false;
            setLookupResult({ for: addr, state: { phase: "ready", value } });
            return true;
          },
          (cause: unknown) => {
            if (controller.signal.aborted) return false;
            const failure: Keyed<AddressLookup> = { for: addr, state: { phase: "error", message: describeLookupError(cause) } };
            // A failed BACKGROUND repair never replaces a rendered position; a foreground failure is stated in full.
            setLookupResult((previous) =>
              keepOnFailure && previous !== null && previous.for === addr && previous.state.phase === "ready" ? previous : failure,
            );
            return false;
          },
        );
    },
    [addr, valid],
  );

  useEffect(() => {
    void loadLookup();
    return () => {
      controllerRef.current?.abort();
    };
  }, [loadLookup, epoch]);

  const lookup = forAddress(lookupResult, addr);
  const ready = lookup.phase === "ready" ? lookup.value : null;
  const hasCash = ready !== null && ready.outcome === "found" && ready.response.positions.some((p) => p.engine === CASH);

  const fetchHistory = useCallback((signal: AbortSignal) => fetchAddressHistory(solventBaseUrl(), addr, { limit: 100, signal }), [addr]);
  const fetchStress = useCallback((signal: AbortSignal) => getSolventClient().addressStress(addr, signal), [addr]);
  const history = useKeyedFetch(addr, valid, epoch, fetchHistory);
  const stress = useKeyedFetch(addr, valid, epoch, fetchStress);
  const params = useKeyedFetch(addr, hasCash, epoch, fetchCashParams);

  // Book-level, not address-keyed: the committed reconcile receipt behind the Trust card's last item.
  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .evidence(controller.signal)
      .then(
        (manifest) => {
          if (!controller.signal.aborted) setEvidence(manifest);
        },
        () => {
          /* the Trust item reads "receipt unavailable" */
        },
      );
    return () => {
      controller.abort();
    };
  }, [epoch]);

  const repair = useCallback(() => loadLookup({ keepOnFailure: true }), [loadLookup]);
  const age = useAnchoredAgeSeconds(
    ready === null
      ? null
      : { ageSeconds: ready.response.batch.age_seconds, receiptId: receiptIdentity(ready.response.served_at, ready.response.batch.id) },
    repair,
  );
  const reload = useCallback(() => {
    setEpoch((e) => e + 1);
  }, []);

  return { address: addr, valid, lookup, history, stress, params, evidence, age, reload };
}

/** Cursor-paged activity for one address. Mount the consumer with key={addr}: a fresh mount can never hold another address's rows. */
export function useAddressActivity(addr: string, valid: boolean): CursorPages<ChainEvent> {
  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      const page = await fetchEvents(solventBaseUrl(), { account: addr, limit: 25, ...(cursor === null ? {} : { cursor }) }, signal);
      return { rows: page.events, nextCursor: page.next_cursor };
    },
    [addr],
  );
  const pages = useCursorPages<ChainEvent, string>(fetchPage);
  const { loadMore } = pages;
  const startedRef = useRef(false);
  useEffect(() => {
    if (!valid || startedRef.current) return;
    startedRef.current = true;
    loadMore();
  }, [valid, loadMore]);
  return pages;
}
```

If `SolventClient.evidence` takes no signal, call it without one and ignore the abort. If `react-hooks/exhaustive-deps` flags `epoch` in the two effects as unnecessary, keep it and add `// eslint-disable-next-line react-hooks/exhaustive-deps -- epoch re-runs the fetch on reload()` on that one line only; do NOT restructure the keying. If `react-hooks/set-state-in-effect` fires anywhere here, the fix is the `{for: addr}`-keyed pattern already used, never a synchronous `setState` at the top of an effect.

- [ ] **Step 5: Verify**

Run: `npx playwright test --project=unit tests/unit/lookup-error.spec.ts && npm run typecheck && npm run lint`
Expected: 1 passed; typecheck and lint clean (the hook is not yet imported anywhere — that is fine).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lookup-error.ts web/lib/address-lookup.ts web/tests/unit/lookup-error.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): useAddressLookup - one address-keyed, resume-repaired seam for the lookup, history, stress, params and the evidence receipt"
```

---

### Task 9: `inspector-view` — one view model for the surface and the tests

**Files:**
- Create: `web/lib/inspector-view.ts`
- Test: `web/tests/unit/inspector-view.spec.ts`

**Interfaces:**
- Consumes `AddressReading` (Task 8), `readCashPosition` / `isComputedCash` / `collateralTable` / `boundaryOf` / `pricesChip` / `CASH` / `LEGACY` (Task 3), `trustChecklist` (Task 4), `roomSeries` / `nearCapStreak` (Task 5), the headline functions (Task 6), `ViewChip` from `./cash-view`, `freshnessTier` / `TierConstants`, `humanAge`, `humanUsdFull` (Task 2), `plainCause`, `truncateAddress`, `readWirePopulation`.
- Produces:

```ts
export type InspectorState = "loading" | "invalid" | "unavailable" | "healthy" | "near" | "liquidatable" | "not-computed" | "cannot-compute" | "no-position" | "legacy-only";
export interface InspectorView {
  readonly state: InspectorState; readonly kicker: string; readonly headline: InspectorHeadline; readonly chips: ViewChip[];
  readonly batchId: number | null; readonly decimals: number;
  readonly cash: CashPosition | null; readonly cashWire: RefinedPosition | null; readonly legacy: RefinedPosition | null;
  readonly table: CollateralTable | null; readonly boundary: Boundary | null; readonly trust: TrustItem[] | null;
  readonly room: RoomSeries | null; readonly streak: Streak | null; readonly historyBatchId: number | null;
  readonly refusedTiles: boolean; readonly floor: string | null; readonly tier: FreshnessTier | null; readonly ageSeconds: number | null;
}
export function deriveInspectorView(reading: AddressReading, constants: TierConstants): InspectorView;
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/inspector-view.spec.ts
import { expect, test } from "@playwright/test";
import { lookup, type components } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView } from "../../lib/inspector-view";
import { ADDRESS_FOUND, ADDRESS_NOT_FOUND, ADDRESS_UNKNOWABLE, FOUND_ADDR, HISTORY } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";
import { AAVE, DM, near } from "./helpers/cash-position";

type Schemas = components["schemas"];

function reading(overrides: Partial<AddressReading>): AddressReading {
  return {
    address: FOUND_ADDR,
    valid: true,
    lookup: { phase: "loading" },
    history: { phase: "loading" },
    stress: { phase: "loading" },
    params: { phase: "loading" },
    evidence: EVIDENCE_MANIFEST,
    age: { seconds: 42, unresolved: false, refreshFailed: false },
    reload: () => {},
    ...overrides,
  };
}
const found = (positions: Schemas["Position"][], extra: Partial<Schemas["AddressResponse"]> = {}) =>
  lookup({ ...ADDRESS_FOUND, positions, ...extra });
/** The raw wire shape of the helper's near-cap position (lookup() refines it again). */
const nearWire = (overrides: Partial<Schemas["Position"]> = {}): Schemas["Position"] => {
  const raw = ADDRESS_FOUND.positions.find((p) => p.engine === "debt_manager");
  if (raw === undefined) throw new Error("fixture");
  const refined = near();
  const { liquidation_verdict: _v, legs, ...rest } = refined;
  return {
    ...raw,
    ...rest,
    liquidatable: false,
    legs: legs.map(({ collateral_use: _c, ...leg }) => ({ ...leg, used_as_collateral: true })),
    ...overrides,
  };
};
/** A Cash history engine with three near-cap points ending at the position's own cap and debt. */
const dmHistory = (address: string, batchId: number): Schemas["AddressHistoryResponse"] => ({
  ...HISTORY,
  address,
  batch: { ...HISTORY.batch, id: batchId },
  engines: [
    {
      engine: "debt_manager",
      value_decimals: 6,
      withheld_batch_ids: [],
      note: "",
      points: [batchId, batchId - 1, batchId - 2].map((id, k) => ({
        batch_id: id,
        computed_at: `2026-07-29T10:0${String(2 - k)}:00Z`,
        balances_block: 1000 + id,
        sweep_block: 900 + id,
        status: "computed" as const,
        refusal: null,
        health_factor: { wad: null, num: k === 0 ? "5012500000" : "5200000000", den: "4822000000", infinite: false, note: "" },
        liquidatable: false,
        total_collateral_base: "12462500000",
        total_debt_base: "4822000000",
      })),
    },
  ],
});

test("invalid, loading and unavailable render into the frame with an honest identity chip", () => {
  const invalid = deriveInspectorView(reading({ address: "nope", valid: false }), TIER_FALLBACK);
  expect(invalid.state).toBe("invalid");
  expect(invalid.kicker).toBe("Inspector");
  expect(invalid.headline.emphasis).toBe("Not an address.");
  expect(invalid.chips).toEqual([{ label: "Identity", value: "nothing looked up", tone: "refused" }]);
  const loading = deriveInspectorView(reading({}), TIER_FALLBACK);
  expect(loading.state).toBe("loading");
  expect(loading.refusedTiles).toBe(true);
  expect(loading.chips[0]?.value).toBe("pending");
  const failed = deriveInspectorView(reading({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" } }), TIER_FALLBACK);
  expect(failed.state).toBe("unavailable");
  expect(failed.headline.dek).toContain("Rate limited (429), retry after 30s.");
  expect(failed.chips[0]?.value).toBe("unavailable");
});

test("near cap: state, kicker, headline, chips, table, boundary, trust and the room streak all derive from one reading", () => {
  const view = deriveInspectorView(
    reading({ lookup: { phase: "ready", value: found([nearWire()]) }, history: { phase: "ready", value: lookup(dmHistory(FOUND_ADDR, 1)) } }),
    TIER_FALLBACK,
  );
  expect(view.state).toBe("near");
  expect(view.kicker).toBe("Cash · account 0xAAaA…0001");
  expect(view.headline.emphasis).toBe("Within $190.50 of its borrow cap.");
  expect(view.headline.dek).toContain("for the last 3 batches (≈2m).");
  expect(view.chips).toEqual([
    { label: "Batch", value: "1" },
    { label: "Snapshot", value: "42s · fresh", tone: "ok" },
    { label: "Lookup", value: "complete · both engines", tone: "ok" },
    { label: "Prices", value: "PriceProvider v2 · 35s", tone: "ok" },
    { label: "Current", value: "not projected" },
  ]);
  expect(view.table?.legs).toHaveLength(2);
  expect(view.boundary?.kind).toBe("boundary");
  expect(view.trust?.map((t) => t.id)).toEqual(["computed", "prices", "sweep", "provenance", "reconcile"]);
  expect(view.room?.computedCount).toBe(3);
  expect(view.streak).toEqual({ batches: 3, spanSeconds: 120, newestKind: "computed" });
  expect(view.historyBatchId).toBe(1);
  expect(view.refusedTiles).toBe(false);
  expect(view.legacy).toBeNull();
});

test("the contract fixture: Cash liquidatable beside a legacy position; the kicker and legacy card follow", () => {
  const view = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_FOUND) } }), TIER_FALLBACK);
  expect(view.state).toBe("liquidatable");
  expect(view.headline.emphasis).toBe("Liquidatable now — $4,620 against a $4,200 cap.");
  expect(view.legacy?.engine).toBe("aave_v3_etherfi");
  expect(view.boundary?.kind).toBe("breached");
});

test("legacy only, not computed, no position, cannot compute — each is its own state and none prints a Cash figure", () => {
  const legacyOnly = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([ADDRESS_FOUND.positions[0]!]) } }), TIER_FALLBACK);
  expect(legacyOnly.state).toBe("legacy-only");
  expect(legacyOnly.headline.emphasis).toBe("No Cash position in batch 1; a legacy Aave v3 position exists.");
  expect(legacyOnly.kicker).toBe("Account 0xAAaA…0001");
  expect(legacyOnly.chips.find((c) => c.label === "Prices")?.value).toBe("Aave oracle · 3m");
  const refused = deriveInspectorView(
    reading({
      lookup: {
        phase: "ready",
        value: found([nearWire({ status: "refused", refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" }, liquidatable: null, max_borrow_lt: null, borrowings: "4100000000" })]),
      },
    }),
    TIER_FALLBACK,
  );
  expect(refused.state).toBe("not-computed");
  expect(refused.refusedTiles).toBe(true);
  expect(refused.headline.dek).toBe("Collateral sweep failed. Its last readable debt is $4,100; no verdict is served for it.");
  expect(refused.trust?.[0]).toMatchObject({ id: "computed", state: "refused" });
  const none = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) } }), TIER_FALLBACK);
  expect(none.state).toBe("no-position");
  expect(none.headline.emphasis).toBe("No Cash or Aave position in batch 1.");
  expect(none.cash).toBeNull();
  expect(none.trust).toBeNull();
  expect(none.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "complete · both engines", tone: "ok" });
  const unknowable = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_UNKNOWABLE) } }), TIER_FALLBACK);
  expect(unknowable.state).toBe("cannot-compute");
  expect(unknowable.headline.emphasis).toBe("Cannot say — the Cash book is withheld this batch.");
  expect(unknowable.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "withheld · Cash", tone: "refused" });
  expect(unknowable.refusedTiles).toBe(true);
});

test("a floor rides the dek and the Lookup chip; an unresolved age is 'age unknown' in the refused register", () => {
  const floor = deriveInspectorView(
    reading({
      lookup: {
        phase: "ready",
        value: found([nearWire()], {
          lookup_complete: false,
          withheld_engines: [{ engine: "aave_v3_etherfi", code: "SWEEP_NEVER", detail: "", note: "" }],
        }),
      },
      age: { seconds: null, unresolved: true, refreshFailed: true },
    }),
    TIER_FALLBACK,
  );
  expect(floor.floor).toBe("Lookup incomplete: the Aave v3 market (legacy) book is withheld, so more positions may exist.");
  expect(floor.headline.dek.endsWith(floor.floor ?? "")).toBe(true);
  expect(floor.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "floor · Aave v3 market (legacy) withheld", tone: "warn" });
  expect(floor.chips.find((c) => c.label === "Snapshot")).toEqual({ label: "Snapshot", value: "age unknown", tone: "refused" });
  expect(floor.tier).toBeNull();
});

test("the room series is keyed to the history's own vantage, never the lookup's newer batch", () => {
  // history vantage 1 with points 1..−1; the lookup says batch 2 — no "no row" gap is invented for batch 2
  const view = deriveInspectorView(
    reading({
      lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: 2 } }) },
      history: { phase: "ready", value: lookup(dmHistory(FOUND_ADDR, 1)) },
    }),
    TIER_FALLBACK,
  );
  expect(view.batchId).toBe(2);
  expect(view.historyBatchId).toBe(1);
  expect(view.room?.points.map((p) => p.batchId)).toEqual([-1, 0, 1]);
  expect(void DM, void AAVE).toBeUndefined();
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/inspector-view.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/inspector-view.ts
// Everything the Inspector prints, derived ONCE from a reading (spec
// 2026-09-15 §5.3) — the same shape lib/cash-view.ts gives the Book. The laws
// live here so the surface and the tests read one model: the outcome decides
// the state, the engine's verdict decides liquidatable, a floor is said, a
// withheld book is never "no position", and no Cash figure is printed for an
// account whose Cash position was not computed.
import type { RefinedPosition } from "@solvent/client";
import type { AddressReading } from "./address-lookup";
import type { ViewChip } from "./cash-view";
import { truncateAddress } from "./format";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { humanUsdFull } from "./human-price";
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
  type InspectorHeadline,
} from "./inspector-headline";
import {
  boundaryOf,
  CASH,
  collateralTable,
  isComputedCash,
  LEGACY,
  pricesChip,
  readCashPosition,
  type Boundary,
  type CashPosition,
  type CollateralTable,
} from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { nearCapStreak, roomSeries, type RoomSeries, type Streak } from "./room-history";
import { trustChecklist, type TrustItem } from "./trust";
import { readWirePopulation } from "./wireGuard";

export type InspectorState =
  | "loading"
  | "invalid"
  | "unavailable"
  | "healthy"
  | "near"
  | "liquidatable"
  | "not-computed"
  | "cannot-compute"
  | "no-position"
  | "legacy-only";

export interface InspectorView {
  readonly state: InspectorState;
  readonly kicker: string;
  readonly headline: InspectorHeadline;
  readonly chips: ViewChip[];
  readonly batchId: number | null;
  readonly decimals: number;
  readonly cash: CashPosition | null;
  readonly cashWire: RefinedPosition | null;
  readonly legacy: RefinedPosition | null;
  readonly table: CollateralTable | null;
  readonly boundary: Boundary | null;
  readonly trust: TrustItem[] | null;
  readonly room: RoomSeries | null;
  readonly streak: Streak | null;
  readonly historyBatchId: number | null;
  readonly refusedTiles: boolean;
  readonly floor: string | null;
  readonly tier: FreshnessTier | null;
  readonly ageSeconds: number | null;
}

const n = (value: number): string => value.toLocaleString("en-US");

function empty(state: InspectorState, kicker: string, headline: InspectorHeadline, chips: ViewChip[]): InspectorView {
  return {
    state, kicker, headline, chips, batchId: null, decimals: 6, cash: null, cashWire: null, legacy: null, table: null, boundary: null,
    trust: null, room: null, streak: null, historyBatchId: null, refusedTiles: true, floor: null, tier: null, ageSeconds: null,
  };
}

const tierTone = (t: FreshnessTier | null): ViewChip["tone"] => (t === null ? "refused" : t === "fresh" ? "ok" : t === "aging" ? "warn" : "crit");

export function deriveInspectorView(reading: AddressReading, constants: TierConstants): InspectorView {
  const short = truncateAddress(reading.address);
  if (!reading.valid) return empty("invalid", "Inspector", INVALID_HEADLINE, [{ label: "Identity", value: "nothing looked up", tone: "refused" }]);
  if (reading.lookup.phase === "loading") return empty("loading", `Account ${short}`, LOADING_HEADLINE, [{ label: "Identity", value: "pending", tone: "refused" }]);
  if (reading.lookup.phase === "error") {
    return empty("unavailable", `Account ${short}`, unavailableLookupHeadline(reading.lookup.message), [{ label: "Identity", value: "unavailable", tone: "refused" }]);
  }

  const lookup = reading.lookup.value;
  const batch = lookup.response.batch;
  const batchId = readWirePopulation(batch.id, "batch.id");
  const ageSeconds = reading.age.unresolved ? null : reading.age.seconds;
  const tier = ageSeconds === null ? null : freshnessTier(ageSeconds, constants);
  const withheldNames = lookup.withheldEngines.map((w) => engineName(w.engine));
  const positions = lookup.outcome === "found" ? lookup.response.positions : [];
  const cashWire = positions.find((p) => p.engine === CASH) ?? null;
  const legacy = positions.find((p) => p.engine === LEGACY) ?? null;
  const cash = cashWire === null ? null : readCashPosition(cashWire);
  const decimals = cashWire?.value_decimals ?? 6;
  const floor = lookup.complete
    ? null
    : `Lookup incomplete: the ${engineList(withheldNames)} book${withheldNames.length === 1 ? " is" : "s are"} withheld, so more positions may exist.`;

  // Room over batches, keyed to the HISTORY's own vantage (its batch, its points, its withheld list) — never the lookup's newer batch.
  let room: RoomSeries | null = null;
  let historyBatchId: number | null = null;
  if (reading.history.phase === "ready" && reading.history.value.outcome === "found") {
    const h = reading.history.value.response;
    historyBatchId = readWirePopulation(h.batch.id, "history.batch.id");
    const engine = h.engines.find((e) => e.engine === CASH);
    if (engine !== undefined) {
      const known = new Set<number>([historyBatchId]);
      for (const e of h.engines) {
        for (const p of e.points) known.add(readWirePopulation(p.batch_id, "batch_id"));
        for (const id of e.withheld_batch_ids) known.add(readWirePopulation(id, "withheld_batch_ids[]"));
      }
      room = roomSeries(engine, [...known]);
    }
  }
  const streak = room === null ? null : nearCapStreak(room);

  const sweep = batch.watermarks.find((w) => w.engine === CASH)?.sweep ?? null;
  const trust = cashWire === null ? null : trustChecklist({ position: cashWire, batchId, sweep, reconcile: reading.evidence?.reconcile ?? null });
  const table = cashWire === null || cash === null ? null : collateralTable(cashWire, cash);
  const boundary = cashWire === null || cash === null ? null : boundaryOf(cashWire, cash);

  const lookupChip: ViewChip =
    lookup.outcome === "unknowable"
      ? { label: "Lookup", value: `withheld · ${engineList(withheldNames)}`, tone: "refused" }
      : lookup.complete
        ? { label: "Lookup", value: "complete · both engines", tone: "ok" }
        : { label: "Lookup", value: `floor · ${engineList(withheldNames)} withheld`, tone: "warn" };
  const priceSource = cashWire ?? legacy;
  const chips: ViewChip[] = [
    { label: "Batch", value: n(batchId) },
    { label: "Snapshot", value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(), tone: tierTone(tier) },
    lookupChip,
    ...(priceSource === null ? [] : [pricesChip(priceSource.price_inputs)]),
    { label: "Current", value: "not projected" },
  ];

  let state: InspectorState;
  let headline: InspectorHeadline;
  if (lookup.outcome === "not-found") {
    state = "no-position";
    headline = noPositionHeadline(batchId);
  } else if (lookup.outcome === "unknowable") {
    state = "cannot-compute";
    headline = cannotComputeHeadline(lookup.withheldEngines);
  } else if (cash === null) {
    state = "legacy-only";
    headline = otherEngineHeadline(batchId, [...new Set(positions.map((p) => p.engine))]);
  } else if (!isComputedCash(cash)) {
    state = "not-computed";
    const cause =
      cash.refusal !== null
        ? plainCause(cash.refusal.code, cash.refusal.detail ?? undefined)
        : cash.status === "unknowable"
          ? "the engine published no verdict for this account"
          : "the engine published no cap for this account";
    headline = notComputedHeadline(cause, cash.debt === null ? null : humanUsdFull(cash.debt, decimals));
  } else {
    state = cash.status;
    headline = cashHeadline(cash, { streak, floor });
  }

  return {
    state,
    kicker: cash === null ? `Account ${short}` : `Cash · account ${short}`,
    headline,
    chips,
    batchId,
    decimals,
    cash,
    cashWire,
    legacy,
    table,
    boundary,
    trust,
    room,
    streak,
    historyBatchId,
    refusedTiles: cash === null || !isComputedCash(cash),
    floor,
    tier,
    ageSeconds,
  };
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/inspector-view.spec.ts`
Expected: 6 passed. `plainCause("SWEEP_FAILED", "the sweep failed")` must yield `"collateral sweep failed"` (phrasebook entry `SWEEP_FAILED`); if the phrasebook appends the detail, the spec's expected dek is the contract — pass only the code in that arm.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/inspector-view.ts web/tests/unit/inspector-view.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): deriveInspectorView - one model for the Inspector's ten states; the outcome decides, the engine's verdict decides, a floor is said"
```

---

### Task 10: The Inspector demo dataset — generated, clock-law checked, welded

**Files:**
- Create: `web/tests/fixtures/demo/generate-demo-inspector.mjs`
- Create (generated): `web/tests/fixtures/demo/{address-demo-near,address-demo-liquidatable,address-demo-healthy,address-demo-refused,history-demo-near,events-demo-near,params-demo-dm,stress-demo-near}.json`
- Modify: `web/tests/fixtures/demo/index.ts`
- Modify: `web/tests/unit/fixture-clock-law.spec.ts` (census)
- Test: `web/tests/unit/demo-inspector-weld.spec.ts`

**Interfaces:**
- Consumes `book.demo.json` (batch 18,251 identity and the `debt_manager` watermark), `meta.demo.json` (the chain-10 weETH witness: `priceproviderv2`, `engine-exact`, `4000000000` @ 6), `../scenarios.json` (the committed scenario definitions), `../stress-dm.json` (the projection note and the lookup note), `../clock-law.mjs` (`ageSeconds`, `checkClocks`).
- Produces from `tests/fixtures/demo/index.ts`: `DEMO_ADDRESS_NEAR`, `DEMO_ADDRESS_LIQUIDATABLE`, `DEMO_ADDRESS_HEALTHY`, `DEMO_ADDRESS_REFUSED: Schemas["AddressResponse"]`, `DEMO_HISTORY_NEAR: Schemas["AddressHistoryResponse"]`, `DEMO_EVENTS_NEAR: Schemas["EventsResponse"]`, `DEMO_PARAMS_DM: Schemas["ParamsResponse"]`, `DEMO_STRESS_NEAR: Schemas["StressResponse"]`, and the address constants `DEMO_NEAR_ADDR`, `DEMO_LIQUIDATABLE_ADDR`, `DEMO_HEALTHY_ADDR`, `DEMO_REFUSED_ADDR` (read off the bodies).
- The near account IS the mockup's: debt $4,822 · cap $5,012.50 · room $190.50 (3.8 %) · collateral $12,462.50 · weETH 2.1 @ $4,000.00 × 50 % · ETHFI 3,250 @ $1.25 × 20 % · boundary weETH below $3,818.57 (a 4.5 % fall) with ETHFI flat · 14 batches under the 10 % line · sweep 1 of 3 rows failed, gen 4 (from the batch watermark) · prices 35 s within 180 s.

- [ ] **Step 1: The failing weld spec**

```ts
// web/tests/unit/demo-inspector-weld.spec.ts
// The Inspector demo dataset welds to itself and to the Book's demo batch:
// the numbers the screenshot pins show are derivable from the bodies served.
import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import { boundaryOf, collateralTable, readCashPosition } from "../../lib/inspector-position";
import { nearCapStreak, roomSeries } from "../../lib/room-history";
import { stressReading } from "../../lib/address-stress";
import {
  DEMO_ADDRESS_HEALTHY,
  DEMO_ADDRESS_LIQUIDATABLE,
  DEMO_ADDRESS_NEAR,
  DEMO_ADDRESS_REFUSED,
  DEMO_BATCH_ID,
  DEMO_BOOK,
  DEMO_EVENTS_NEAR,
  DEMO_HISTORY_NEAR,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";

const cashOf = (body: typeof DEMO_ADDRESS_NEAR) => {
  const l = lookup(body);
  if (l.outcome !== "found") throw new Error("demo address must be found");
  const p = l.response.positions.find((x) => x.engine === "debt_manager");
  if (p === undefined) throw new Error("demo address must carry a Cash position");
  return p;
};

test("every body shares the Book's demo batch identity", () => {
  for (const body of [DEMO_ADDRESS_NEAR, DEMO_ADDRESS_LIQUIDATABLE, DEMO_ADDRESS_HEALTHY, DEMO_ADDRESS_REFUSED, DEMO_HISTORY_NEAR, DEMO_STRESS_NEAR]) {
    expect(body.batch.id).toBe(DEMO_BATCH_ID);
    expect(body.served_at).toBe(DEMO_BOOK.served_at);
    expect(body.batch.computed_at).toBe(DEMO_BOOK.batch.computed_at);
  }
  expect(DEMO_EVENTS_NEAR.served_at).toBe(DEMO_BOOK.served_at);
  expect(DEMO_PARAMS_DM.served_at).toBe(DEMO_BOOK.served_at);
});

test("the near account is the mockup's: cap, debt, room, legs, boundary", () => {
  const wire = cashOf(DEMO_ADDRESS_NEAR);
  const cash = readCashPosition(wire);
  expect(cash.debt).toBe(4822000000n);
  expect(cash.cap).toBe(5012500000n);
  expect(cash.room).toBe(190500000n);
  expect(cash.roomPercent).toBe("3.8%");
  expect(cash.status).toBe("near");
  const table = collateralTable(wire, cash);
  expect(table.capAgrees).toBe(true);
  expect(table.collateralAgrees).toBe(true);
  expect(table.legs.map((l) => [l.symbol, l.amount, l.price, l.ltv])).toEqual([
    ["weETH", "2.1", "$4,000.00", "50%"],
    ["ETHFI", "3,250", "$1.2500", "20%"],
  ]);
  const b = boundaryOf(wire, cash);
  expect(b.kind).toBe("boundary");
  if (b.kind === "boundary") expect(b.sentence).toBe("Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
});

test("liquidatable, healthy and refused accounts read as their states", () => {
  expect(readCashPosition(cashOf(DEMO_ADDRESS_LIQUIDATABLE)).status).toBe("liquidatable");
  expect(readCashPosition(cashOf(DEMO_ADDRESS_HEALTHY)).status).toBe("healthy");
  const refused = readCashPosition(cashOf(DEMO_ADDRESS_REFUSED));
  expect(refused.computed).toBe(false);
  expect(refused.debt).toBe(4100000000n);
  expect(refused.refusal?.code).toBe("SWEEP_FAILED");
});

test("the history's newest point IS the position; 14 batches sit under the 10 % line; one refused point, two withheld batches", () => {
  const h = lookup(DEMO_HISTORY_NEAR);
  if (h.outcome !== "found") throw new Error("history must be found");
  const engine = h.response.engines.find((e) => e.engine === "debt_manager");
  if (engine === undefined) throw new Error("history must carry the Cash engine");
  const newest = engine.points[0];
  expect(newest?.batch_id).toBe(DEMO_BATCH_ID);
  expect(newest?.health_factor?.num).toBe("5012500000");
  expect(newest?.health_factor?.den).toBe("4822000000");
  expect(engine.points.filter((p) => p.status === "refused")).toHaveLength(1);
  expect(engine.withheld_batch_ids).toEqual([DEMO_BATCH_ID - 50, DEMO_BATCH_ID - 49]);
  const series = roomSeries(engine, engine.withheld_batch_ids);
  expect(series.computedCount).toBe(97);
  expect(nearCapStreak(series)).toEqual({ batches: 14, spanSeconds: 390, newestKind: "computed" });
});

test("stress: ETH −30 % and ETHFI −50 % flip the account; the rate projection does not", () => {
  const r = stressReading(lookup(DEMO_STRESS_NEAR), DEMO_NEAR_ADDR);
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows.map((x) => [x.id, x.flips])).toEqual([
    ["eth_minus_30", true],
    ["ethfi_minus_50", true],
    ["dm_rate_horizon_plus_200bps", false],
  ]);
  expect(r.rows[2]?.projection?.every((h) => h.verdict === "not-liquidatable")).toBe(true);
});

test("events: six rows for the near account, newest first, exactly one without a custodied time", () => {
  expect(DEMO_EVENTS_NEAR.events).toHaveLength(6);
  expect(DEMO_EVENTS_NEAR.events.every((e) => e.account === DEMO_NEAR_ADDR)).toBe(true);
  expect(DEMO_EVENTS_NEAR.events.filter((e) => e.block_time === null)).toHaveLength(1);
  const blocks = DEMO_EVENTS_NEAR.events.map((e) => e.block_number);
  expect([...blocks].sort((a, b) => b - a)).toEqual(blocks);
  expect(DEMO_PARAMS_DM.params[0]?.fields[0]?.name).toBe("borrow_apy");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts`
Expected: FAIL — the demo index has no `DEMO_ADDRESS_NEAR`.

- [ ] **Step 3: The generator**

```js
// web/tests/fixtures/demo/generate-demo-inspector.mjs
//
// PROVENANCE. The Inspector's demo dataset (spec 2026-09-15 §8; plan 2 Task 10),
// derived — never hand-shaped — from committed bodies:
//   - batch identity, served_at and the debt_manager watermark (sweep: 1 of 3
//     rows failed, generation 4) are read VERBATIM from book.demo.json, so the
//     Inspector agrees with the Book and the Overview on batch 18,251;
//   - the weETH price witness (chain 10, priceproviderv2, engine-exact,
//     4000000000 @ 6 decimals) is read from meta.demo.json;
//   - scenario definitions are read VERBATIM from ../scenarios.json by id; the
//     projection note and the lookup note from ../stress-dm.json;
//   - the ETHFI asset is the committed ethfi_minus_50 scenario's asset;
//     USDC is the /v1/events example's OP USDC.
// The near account is the mockup's (pages-console.html:224-247): debt $4,822,
// cap $5,012.50, room $190.50 (3.8 %), two collateral legs, 14 batches under
// the 10 % line. Every age is derived from its stamp against served_at with
// the clock law's own ageSeconds(), and every body passes checkClocks() before
// it is written. Regenerate: `node tests/fixtures/demo/generate-demo-inspector.mjs` (from web/).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ageSeconds, checkClocks } from "../clock-law.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(here, name), "utf8"));
const readFixture = (name) => JSON.parse(readFileSync(path.join(here, "..", name), "utf8"));

const book = read("book.demo.json");
const meta = read("meta.demo.json");
const scenarios = readFixture("scenarios.json");
const stressTemplate = readFixture("stress-dm.json");

const BATCH = book.batch;
const SERVED_AT = book.served_at;
const servedMs = Date.parse(SERVED_AT);
const computedMs = Date.parse(BATCH.computed_at);
const iso = (ms) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");
const age = (stamp) => Number(ageSeconds(stamp, SERVED_AT));
const dm = BATCH.watermarks.find((w) => w.engine === "debt_manager");
if (dm === undefined) throw new Error("book.demo.json must carry the debt_manager watermark");
const weethWitness = meta.prices.find((p) => p.chain_id === 10 && p.symbol === "weETH");
if (weethWitness === undefined) throw new Error("meta.demo.json must carry the chain-10 weETH witness");
const LOOKUP_NOTE = stressTemplate.lookup_complete_note;

const NEAR_ADDR = "0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e";
const LIQ_ADDR = "0x5d11c0ffee00000000000000000000000000a1b2";
const HEALTHY_ADDR = "0x9e0d1c2b3a49586776655443322110ffeeddccbb";
const REFUSED_ADDR = "0x4444444444444444444444444444444444444404";
const USDC = { asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 };
const WEETH = { asset: weethWitness.asset, symbol: "weETH", decimals: 18 };
const ETHFI = { asset: "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f", symbol: "ETHFI", decimals: 18 };

const PRICE_DECIMALS = weethWitness.decimals; // 6
const WEETH_PRICE = BigInt(weethWitness.value); // $4,000.00
const ETHFI_PRICE = 1250000n; // $1.25
const LTV_BPS = { weETH: 5000n, ETHFI: 2000n };
const USD = (dollars) => BigInt(Math.round(dollars * 1e6)); // Cash value_decimals = 6
const TOKEN = (units) => BigInt(Math.round(units * 1e6)) * 10n ** 12n; // 18-dec amounts, 6 places of precision
const ceilDiv = (a, b) => (a + b - 1n) / b;
const s = (v) => v.toString();
const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;

const PRICE_AS_OF = iso(servedMs - 35_000);
const priceInput = (token, value) => ({
  asset: token.asset,
  chain_id: 10,
  source: weethWitness.source,
  provenance: weethWitness.provenance,
  value: s(value),
  decimals: PRICE_DECIMALS,
  block_number: dm.last_block - 14,
  source_as_of: PRICE_AS_OF,
  budget_seconds: 180,
  verdict: "fresh",
  age_seconds: age(PRICE_AS_OF),
  fresh: true,
  note: "engine-exact custody: the value the engine itself computed with.",
});

function legsFor(weethUnits, ethfiUnits) {
  return [
    [WEETH, weethUnits, WEETH_PRICE, LTV_BPS.weETH],
    [ETHFI, ethfiUnits, ETHFI_PRICE, LTV_BPS.ETHFI],
  ].map(([token, units, price, ltv]) => {
    const amount = TOKEN(units);
    const value = (amount * price) / 10n ** 18n; // 6-dec USD
    return { token, amount, value, contribution: (value * ltv) / 10_000n };
  });
}

/** One Cash position. Returns the wire body and the bigints the other bodies weld to. */
function cashPosition({ account, weethUnits, ethfiUnits, debt, refused = false }) {
  const legs = legsFor(weethUnits, ethfiUnits);
  const collateral = legs.reduce((sum, l) => sum + l.value, 0n);
  const cap = legs.reduce((sum, l) => sum + l.contribution, 0n);
  const debtUsd = USD(debt);
  const liquidatable = debtUsd > cap;
  const wireLegs = legs.map((l) => ({
    asset: l.token.asset,
    symbol: l.token.symbol,
    decimals: l.token.decimals,
    live_debt: null,
    live_collateral: null,
    debt_base: null,
    collateral_base: null,
    weighted_lt: null,
    used_as_collateral: refused ? null : true,
    debt_index_block: null,
    collateral_index_block: null,
    amount: s(l.amount),
    value_usd: refused ? null : s(l.value),
    max_borrow_contribution: refused ? null : s(l.contribution),
    liq_threshold: null,
    liq_bonus: null,
  }));
  const base = {
    engine: "debt_manager",
    account,
    value_decimals: 6,
    health_factor: null,
    total_collateral_base: refused ? null : s(collateral),
    total_debt_base: s(debtUsd),
    weighted_lt_sum: null,
    avg_lt_bps: null,
    legs: wireLegs,
    price_inputs: [priceInput(WEETH, WEETH_PRICE), priceInput(ETHFI, ETHFI_PRICE)],
    as_of: {
      balances_block: dm.last_block,
      params_block: 155300000,
      sweep_block: dm.last_block - 54,
      oldest_price_input: PRICE_AS_OF,
      stale_price_inputs: false,
      note: "each leg additionally carries its OWN rate-index as-of block.",
    },
  };
  if (refused) {
    const position = {
      ...base,
      status: "refused",
      flags: ["sweep_failed"],
      refusal: { code: "SWEEP_FAILED", detail: "collateral sweep failed for this account in this batch", note: "a refused row keeps its persisted debt for display; no verdict is served for it." },
      liquidatable: null,
      collateral_value_usd: null,
      max_borrow_lt: null,
      borrowings: s(debtUsd),
      liquidation_price: null,
    };
    return { position, cap: null, collateral: null, debt: debtUsd, legs };
  }
  // Boundary: weETH alone falls with ETHFI flat — ethfi + weeth·k = debt ⇒ k = (debt − ethfi) / weeth.
  const [weeth, ethfi] = legs;
  const num = debtUsd - ethfi.contribution;
  const den = weeth.contribution;
  const never = num <= 0n;
  const position = {
    ...base,
    status: "computed",
    flags: [],
    refusal: null,
    liquidatable,
    collateral_value_usd: s(collateral),
    max_borrow_lt: s(cap),
    borrowings: s(debtUsd),
    liquidation_price: {
      in_factor: true,
      never_liquidatable: never,
      ...(never ? { reason: "collateral outside the factor already covers the debt at threshold" } : {}),
      scale_factor_num: never ? null : s(num),
      scale_factor_den: never ? null : s(den),
      already_breached: liquidatable,
      prices: never
        ? []
        : [{ asset: WEETH.asset, current_price: s(WEETH_PRICE), price_decimals: PRICE_DECIMALS, price_floor: s((WEETH_PRICE * num) / den), lowest_healthy_price: s(ceilDiv(WEETH_PRICE * num, den)) }],
      factor_assets: [WEETH.asset],
      held_assets: [WEETH.asset, ETHFI.asset],
      boundary_is_healthy: true,
      per_token_floor_omitted: false,
      diagnostic: false,
      axis: "eth_usd",
      note: "at exactly this price the position is HEALTHY — liquidation begins strictly below it. Render `lowest_healthy_price`, the conservative ceil.",
    },
  };
  return { position, cap, collateral, debt: debtUsd, legs };
}

const addressBody = (account, position) => ({
  served_at: SERVED_AT,
  batch: BATCH,
  address: account,
  positions: [position],
  found: true,
  lookup_complete: true,
  withheld_engines: [],
  lookup_complete_note: LOOKUP_NOTE,
  notes: [],
});

/** 100 batches at a 30-second cadence; room drifts from ~38 % to 3.8 %; the last 14 sit under 10 %. */
function historyBody(account, near) {
  const COUNT = 100;
  const CADENCE_MS = 30_000;
  const BLOCKS_PER_BATCH = 15;
  const withheld = [BATCH.id - 50, BATCH.id - 49];
  const refusedAt = BATCH.id - 81;
  const points = [];
  for (let k = 0; k < COUNT; k += 1) {
    const back = COUNT - 1 - k;
    const id = BATCH.id - back;
    if (withheld.includes(id)) continue;
    const balancesBlock = dm.last_block - back * BLOCKS_PER_BATCH;
    const common = { batch_id: id, computed_at: iso(computedMs - back * CADENCE_MS), balances_block: balancesBlock, sweep_block: balancesBlock - 54 };
    if (id === refusedAt) {
      points.push({ ...common, status: "refused", refusal: { code: "SWEEP_FAILED", detail: "collateral sweep failed for this account in this batch", note: "" }, health_factor: null, liquidatable: null, total_collateral_base: null, total_debt_base: null });
      continue;
    }
    let cap;
    let collateral;
    if (k === COUNT - 1) {
      cap = near.cap;
      collateral = near.collateral;
    } else {
      const t = k / (COUNT - 1);
      const wobble = k < 84 ? 0.4 * Math.sin(k * 1.7) : 0;
      const roomPct = 38 - 34.2 * t ** 1.4 + wobble; // k ≥ 86 → under 10 %
      cap = USD(Number(near.debt) / 1e6 / (1 - roomPct / 100));
      collateral = (cap * near.collateral) / near.cap;
    }
    points.push({
      ...common,
      status: "computed",
      refusal: null,
      health_factor: { wad: null, num: s(cap), den: s(near.debt), infinite: false, note: "the Debt Manager's MaxBorrowLT / Borrowings as an exact rational — a disclosure, not the verdict; the strict boolean decides." },
      liquidatable: false,
      total_collateral_base: s(collateral),
      total_debt_base: s(near.debt),
    });
  }
  points.reverse(); // newest first, as the wire serves it
  return {
    served_at: SERVED_AT,
    batch: BATCH,
    address: account,
    limit: 100,
    engines: [{ engine: "debt_manager", value_decimals: 6, points, withheld_batch_ids: withheld, note: "one persisted row per batch; a refused batch is a point, not a gap." }],
    found: true,
    lookup_complete: true,
    withheld_engines: [],
    lookup_complete_note: LOOKUP_NOTE,
    notes: [],
  };
}

function eventsBody(account) {
  const ev = (blocksBack, minutesAgo, type, token, amount, unit, decimals, logIndex) => ({
    chain_id: 10,
    engine: "debt_manager",
    block_number: dm.last_block - blocksBack,
    block_time: minutesAgo === null ? null : iso(servedMs - minutesAgo * 60_000),
    tx_hash: hash((dm.last_block - blocksBack) * 1000 + logIndex),
    log_index: logIndex,
    seq: 0,
    type,
    raw_type: type,
    account,
    asset: token.asset,
    symbol: token.symbol,
    amount,
    amount_unit: unit,
    amount_decimals: decimals,
    liquidation: null,
  });
  return {
    served_at: SERVED_AT,
    filter: { engine: null, account, types: [], since_block: null },
    limit: 25,
    events: [
      ev(344, 9, "borrow", USDC, "622000000", "dm_normalized_debt", null, 12),
      ev(1444, 25, "supply", WEETH, s(TOKEN(0.6)), "opaque", 18, 4),
      ev(1454, 25, "collateral_enabled", WEETH, null, "none", null, 3),
      ev(2944, 48, "supply", ETHFI, s(TOKEN(1250)), "opaque", 18, 7),
      ev(5444, 110, "borrow", USDC, "4200000000", "dm_normalized_debt", null, 2),
      ev(8444, null, "repay", USDC, "150000000", "dm_normalized_debt", null, 9),
    ],
    next_cursor: null,
    notes: ["`block_time` is null until the block's header is custodied — never fabricated. Render the block number in the meantime."],
  };
}

const paramsBody = () => ({
  served_at: SERVED_AT,
  engine: "debt_manager",
  asset: null,
  params: [
    {
      engine: "debt_manager",
      chain_id: 10,
      asset: null,
      fields: [{ name: "borrow_apy", value: "50000000000000000", address: null, prior: "40000000000000000", unit: "per-second-1e18" }],
      effective_block: 155300000,
      effective_log_index: 3,
      source_event: "borrow_apy_set",
      tx_hash: hash(155300000003),
      block_time: iso(servedMs - 3 * 3_600_000),
    },
  ],
  next_cursor: null,
  notes: ["denominations are the ENGINE's own and are named per field; the Debt Manager's percent scale is 100e18."],
});

function stressBody(account, near) {
  const def = (id) => {
    const d = scenarios.scenarios.find((x) => x.id === id);
    if (d === undefined) throw new Error(`scenarios.json lacks ${id}`);
    return d;
  };
  const state = (cap, debt, collateral) => ({
    health_factor_wad: null,
    health_factor_num: s(cap),
    health_factor_den: s(debt),
    infinite: false,
    liquidatable: debt > cap,
    eligible: debt > cap,
    collateral_usd: s(collateral),
    debt_usd: s(debt),
    max_borrow_lt: s(cap),
  });
  const before = state(near.cap, near.debt, near.collateral);
  const priceOf = (token) => (token.symbol === "weETH" ? WEETH_PRICE : ETHFI_PRICE);
  /** One factor asset falls by num/den; the other is held flat. */
  const shocked = (token, num, den) => {
    const legs = near.legs.map((l) => (l.token.symbol === token.symbol ? { ...l, value: (l.value * num) / den, contribution: (l.contribution * num) / den } : l));
    const cap = legs.reduce((a, l) => a + l.contribution, 0n);
    const collateral = legs.reduce((a, l) => a + l.value, 0n);
    const other = token.symbol === "weETH" ? ETHFI : WEETH;
    return {
      after: state(cap, near.debt, collateral),
      applied_shocks: [{ asset: token.asset, chain_id: 10, source: weethWitness.source, factor_num: s(num), factor_den: s(den), before: s(priceOf(token)), after: s((priceOf(token) * num) / den), snapped: false, base_snapped: false, cap_bound: false }],
      held_flat: [{ asset: other.asset, chain_id: 10, source: weethWitness.source, value: s(priceOf(other)) }],
    };
  };
  const result = (extra) => ({ engine: "debt_manager", account, applicable: true, before, market_realization: null, projection: null, ...extra });
  const horizon = (seconds) => {
    const extra = (near.debt * 200n * BigInt(seconds)) / (10_000n * 31_536_000n);
    const projected = near.debt + extra;
    return { horizon_seconds: seconds, debt_usd: s(near.debt), projected_usd: s(projected), additional_interest_usd: s(extra), becomes_liquidatable: projected > near.cap };
  };
  const projection = {
    label: "PROJECTION",
    basis: "delta-only",
    annual_delta_bps: 200,
    apy_observed_at_block: dm.last_block,
    prices_held_flat: true,
    horizons: [horizon(2_592_000), horizon(7_776_000)],
    note: stressTemplate.scenarios[0].results[0].projection.note,
  };
  return {
    served_at: SERVED_AT,
    batch: BATCH,
    address: account,
    scenario_config_version: scenarios.scenario_config_version,
    found: true,
    lookup_complete: true,
    withheld_engines: [],
    lookup_complete_note: LOOKUP_NOTE,
    scenarios: [
      { ...def("eth_minus_30"), results: [result(shocked(WEETH, 70n, 100n))] },
      { ...def("ethfi_minus_50"), results: [result(shocked(ETHFI, 50n, 100n))] },
      { ...def("dm_rate_horizon_plus_200bps"), results: [result({ after: before, applied_shocks: [], held_flat: [], projection })] },
    ],
    notes: stressTemplate.notes,
  };
}

const writeChecked = (name, body) => {
  const report = checkClocks(body);
  if (report.failures.length > 0) throw new Error(`${name} violates the clock law:\n${report.failures.join("\n")}`);
  writeFileSync(path.join(here, name), JSON.stringify(body, null, 2));
  console.log(`wrote ${name} (${String(report.checked)} clocks checked)`);
};

const near = cashPosition({ account: NEAR_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 4822 });
const liq = cashPosition({ account: LIQ_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 5400 });
const healthy = cashPosition({ account: HEALTHY_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 2100 });
const refused = cashPosition({ account: REFUSED_ADDR, weethUnits: 2.1, ethfiUnits: 3250, debt: 4100, refused: true });

writeChecked("address-demo-near.json", addressBody(NEAR_ADDR, near.position));
writeChecked("address-demo-liquidatable.json", addressBody(LIQ_ADDR, liq.position));
writeChecked("address-demo-healthy.json", addressBody(HEALTHY_ADDR, healthy.position));
writeChecked("address-demo-refused.json", addressBody(REFUSED_ADDR, refused.position));
writeChecked("history-demo-near.json", historyBody(NEAR_ADDR, near));
writeChecked("events-demo-near.json", eventsBody(NEAR_ADDR));
writeChecked("params-demo-dm.json", paramsBody());
writeChecked("stress-demo-near.json", stressBody(NEAR_ADDR, near));
```

Run: `node tests/fixtures/demo/generate-demo-inspector.mjs` (from `web/`)
Expected: eight `wrote …` lines. If `checkClocks` reports a failure, the age is wrong relative to its stamp — fix the STAMP or the derivation; never hand-edit an `age_seconds`. If `scenarios.json`'s `scenario_config_version` is absent, read it from `stress-dm.json` instead.

- [ ] **Step 4: The index**

Append to `web/tests/fixtures/demo/index.ts`:

```ts
/** GENERATED by generate-demo-inspector.mjs — see its provenance header. The near account is the mockup's. */
export const DEMO_ADDRESS_NEAR: Schemas["AddressResponse"] = load("address-demo-near.json");
export const DEMO_ADDRESS_LIQUIDATABLE: Schemas["AddressResponse"] = load("address-demo-liquidatable.json");
export const DEMO_ADDRESS_HEALTHY: Schemas["AddressResponse"] = load("address-demo-healthy.json");
export const DEMO_ADDRESS_REFUSED: Schemas["AddressResponse"] = load("address-demo-refused.json");
export const DEMO_HISTORY_NEAR: Schemas["AddressHistoryResponse"] = load("history-demo-near.json");
export const DEMO_EVENTS_NEAR: Schemas["EventsResponse"] = load("events-demo-near.json");
export const DEMO_PARAMS_DM: Schemas["ParamsResponse"] = load("params-demo-dm.json");
export const DEMO_STRESS_NEAR: Schemas["StressResponse"] = load("stress-demo-near.json");
export const DEMO_NEAR_ADDR: string = DEMO_ADDRESS_NEAR.address;
export const DEMO_LIQUIDATABLE_ADDR: string = DEMO_ADDRESS_LIQUIDATABLE.address;
export const DEMO_HEALTHY_ADDR: string = DEMO_ADDRESS_HEALTHY.address;
export const DEMO_REFUSED_ADDR: string = DEMO_ADDRESS_REFUSED.address;
```

- [ ] **Step 5: The census**

Run: `npx playwright test --project=unit tests/unit/fixture-clock-law.spec.ts`
Expected: FAIL with the census message naming each new demo file that "states an age nobody pinned", with its checked-clock count. Add one `"demo/<file>.json": <count>` entry per named file to `CENSUS` in `web/tests/unit/fixture-clock-law.spec.ts` (keyed the way the existing `demo/…` entries are), and raise `CENSUS_TOTAL` by the sum of the new counts. Re-run — Expected: PASS. (The `directories` pin stays `["demo"]`; the batch-bearing pin, if it counts files, rises by the six batch-bearing bodies — the four address bodies, the history and the stress — move it by six.)

- [ ] **Step 6: Run the weld spec and the whole unit project**

Run: `npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts && npx playwright test --project=unit`
Expected: 6 passed; the whole unit project green.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/fixtures/demo/generate-demo-inspector.mjs web/tests/fixtures/demo/address-demo-near.json web/tests/fixtures/demo/address-demo-liquidatable.json web/tests/fixtures/demo/address-demo-healthy.json web/tests/fixtures/demo/address-demo-refused.json web/tests/fixtures/demo/history-demo-near.json web/tests/fixtures/demo/events-demo-near.json web/tests/fixtures/demo/params-demo-dm.json web/tests/fixtures/demo/stress-demo-near.json web/tests/fixtures/demo/index.ts web/tests/unit/fixture-clock-law.spec.ts web/tests/unit/demo-inspector-weld.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Inspector demo dataset - the mockup's near-cap account on batch 18,251, generated under the clock law and welded to the Book's demo"
```

---

### Task 11: The Inspector page — landing, surface, sections, drawer

**Integrator builds this personally** (visual; spec §9.2). The mockup is `docs/specs/2026-09-15-ui-mockups/pages-console.html:210-276`; the CSS is the kit's. Every element below names its data source in the view model (Task 9) and its `data-testid` from the contract table.

**Files:**
- Modify: `web/app/inspector/page.tsx` (renders `InspectorLanding`), `web/app/inspector/[addr]/page.tsx` (`key={addr}`)
- Create: `web/app/inspector/InspectorLanding.tsx`
- Rewrite: `web/app/inspector/[addr]/InspectorSurface.tsx`
- Create: `web/app/inspector/[addr]/{InspectorTiles,BackingTable,TrustCard,HistoryCard,ActivityTable,LegacyCard,StressTable,InspectorDrawer}.tsx`
- Rewrite: `web/app/inspector/inspector.module.css`
- The old `AddressEntry.tsx`, `InspectorPositionCard.tsx`, `InspectorHistory.tsx`, `InspectorActivity.tsx` stop being imported here; Task 12 deletes them together with their pins.

**Interfaces:**
- Consumes `useAddressLookup`, `useAddressActivity` (Task 8), `deriveInspectorView`, `InspectorView` (Task 9), `stressReading` (Task 7), `activityRows`, `activityTakeaway` (Task 7), `rememberLookup`, `useRecentLookups` (Task 1), the kit (`AddressField`, `TrustChecklist`, `Sparkline`, `VerdictHeader`, `KpiTile`, `ChartCard`, `KitTable`, `StatusPill`, `SectionHead`), `Drawer`, `useMetaConstants`, `humanUsdFull` (every account-level dollar figure on this page — never the Book's compact `humanUsd`), `humanPrice`, `humanAmount`, `formatUnits` (client), `groupDecimalString`, `renderBlockTime`, `displayHf`, `buildHistorySeries`.
- Produces the DOM contract in the test-id table; Task 12 pins it.

- [ ] **Step 1: The routes**

```tsx
// web/app/inspector/[addr]/page.tsx — unchanged except the key: a new address is a new surface, so no state can survive a navigation.
export default async function InspectorAddressPage({ params }: RouteParams) {
  const { addr } = await params;
  return <InspectorSurface key={addr} addr={addr} />;
}
```

```tsx
// web/app/inspector/page.tsx
import type { Metadata } from "next";
import { InspectorLanding } from "./InspectorLanding";

export const metadata: Metadata = { title: "Inspector" };

export default function InspectorPage() {
  return <InspectorLanding />;
}
```

- [ ] **Step 2: The landing**

```tsx
// web/app/inspector/InspectorLanding.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddressField } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { rememberLookup, useRecentLookups } from "@/lib/recent-lookups";
import { truncateAddress } from "@/lib/format";
import styles from "./inspector.module.css";

/** /inspector — the question, the field, and the reader's own recent lookups (browser-local). */
export function InspectorLanding() {
  const router = useRouter();
  const recents = useRecentLookups();
  return (
    <div className={styles.landing} data-testid="inspector-landing">
      <p className={kit.kick}>Inspector</p>
      <h1 className={kit.h1}>Is this address at risk?</h1>
      <p className={kit.dek}>
        Paste any 0x address. You get one sentence — how close it is to its borrow cap and why — with every number
        traceable to the inputs behind it. Anything the service cannot defend renders as a named refusal, never a guess.
      </p>
      <div className={styles.toolbar}>
        <AddressField
          testId="inspector-address"
          hint="any 0x address"
          onInspect={(address) => {
            rememberLookup(address);
            router.push(`/inspector/${address}`);
          }}
        />
      </div>
      {recents.length > 0 && (
        <>
          <p className={styles.note}>Recent lookups · stored in this browser only</p>
          <ul className={styles.recent} data-testid="inspector-recent">
            {recents.map((address) => (
              <li key={address}>
                <Link href={`/inspector/${address}`} className={kit.addr} title={address}>
                  {truncateAddress(address)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: The surface**

```tsx
// web/app/inspector/[addr]/InspectorSurface.tsx
"use client";

// One address, every number defended (spec 2026-09-15 §5.3). The view model
// decides everything printed; this file only places it. All ten states render
// into the same frame — the toolbar, the verdict header, the tiles, the grid.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddressField, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useAddressLookup } from "@/lib/address-lookup";
import { deriveInspectorView } from "@/lib/inspector-view";
import { useMetaConstants } from "@/lib/meta";
import { rememberLookup } from "@/lib/recent-lookups";
import styles from "../inspector.module.css";
import { ActivityTable } from "./ActivityTable";
import { BackingTable } from "./BackingTable";
import { HistoryCard } from "./HistoryCard";
import { InspectorDrawer } from "./InspectorDrawer";
import { InspectorTiles } from "./InspectorTiles";
import { LegacyCard } from "./LegacyCard";
import { StressTable } from "./StressTable";
import { TrustCard } from "./TrustCard";

export function InspectorSurface({ addr }: { addr: string }) {
  const router = useRouter();
  const reading = useAddressLookup(addr);
  const meta = useMetaConstants();
  const view = deriveInspectorView(reading, meta.constants);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const found = reading.lookup.phase === "ready" && reading.lookup.value.outcome === "found";
  return (
    <div className={styles.page} data-testid="inspector-surface" data-state={view.state} aria-busy={view.state === "loading" ? "true" : undefined}>
      <div className={styles.toolbar}>
        <AddressField
          testId="inspector-address"
          initial={reading.valid ? addr : ""}
          hint="any 0x address"
          secondary={view.cash === null ? undefined : { href: "#stress", label: "Stress this address →" }}
          onInspect={(address) => {
            rememberLookup(address);
            router.push(`/inspector/${address}`);
          }}
        />
      </div>
      <VerdictHeader
        testId="inspector-verdict"
        kicker={view.kicker}
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={
          found ? (
            <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setDrawerOpen(true)} data-testid="inspector-drawer">
              Inputs · Calculation · Provenance
            </button>
          ) : undefined
        }
      />
      {view.state !== "invalid" && (
        <>
          <InspectorTiles view={view} />
          <div className={`${kit.grid} ${kit.gridRail}`}>
            <BackingTable view={view} onPrices={() => setDrawerOpen(true)} />
            <TrustCard view={view} />
          </div>
          <HistoryCard view={view} reading={reading} />
          <ActivityTable key={addr} addr={addr} valid={reading.valid} />
          {view.legacy !== null && <LegacyCard position={view.legacy} reading={reading} view={view} />}
          {view.cash !== null && <StressTable reading={reading} view={view} />}
          <InspectorDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} view={view} reading={reading} />
        </>
      )}
    </div>
  );
}
```

`VerdictHeader` already stamps `data-variant={tone}` on its `<header>` (`components/kit/VerdictHeader.tsx:30`); the page's own state rides `data-state` on the surface root, which is what the contract pins. No kit change is needed here.

- [ ] **Step 4: The five tiles**

```tsx
// web/app/inspector/[addr]/InspectorTiles.tsx
import { formatUnits } from "@solvent/client";
import { KpiTile, type Tone } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { groupDecimalString } from "@/lib/book-format";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";

const STATUS_WORD = { liquidatable: "Liquidatable", near: "Near cap", healthy: "Healthy", refused: "Not computed", unknowable: "Not computed" } as const;
const STATUS_TONE: Record<keyof typeof STATUS_WORD, Tone> = { liquidatable: "crit", near: "warn", healthy: "ok", refused: "refused", unknowable: "refused" };

/** Debt · Borrow cap · Room · Collateral · Status — the same five in every state; only the readings change. */
export function InspectorTiles({ view }: { view: InspectorView }) {
  const { cash, refusedTiles, decimals } = view;
  const pending = view.state === "loading";
  const money = (v: bigint | null): string => (v === null ? "—" : humanUsdFull(v, decimals));
  const notComputed = view.state === "loading" ? "" : "not computed";
  const exactDebt = cash?.debt == null ? null : groupDecimalString(formatUnits(cash.debt.toString(), decimals, { trim: false }));
  const roomTone: Tone = cash === null || refusedTiles ? "refused" : cash.status === "liquidatable" ? "crit" : cash.status === "near" ? "warn" : "neutral";
  return (
    <div className={`${kit.kpis} ${kit.kpis5}`}>
      <KpiTile
        testId="inspector-kpi-debt"
        label="Debt"
        value={refusedTiles ? "—" : money(cash?.debt ?? null)}
        sub={refusedTiles ? (cash?.debt != null ? `last readable ${money(cash.debt)} · ${notComputed}` : notComputed) : `USD · ${exactDebt ?? "—"} exact`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile testId="inspector-kpi-cap" label="Borrow cap" value={refusedTiles ? "—" : money(cash?.cap ?? null)} sub={refusedTiles ? notComputed : "Σ collateral × per-asset LTV"} tone={refusedTiles ? "refused" : "neutral"} pending={pending} />
      <KpiTile testId="inspector-kpi-room" label="Room" value={refusedTiles ? "—" : money(cash?.room ?? null)} sub={refusedTiles ? notComputed : `${cash?.roomPercent ?? "—"} of cap`} tone={roomTone} pending={pending} />
      <KpiTile
        testId="inspector-kpi-collateral"
        label="Collateral"
        value={refusedTiles ? "—" : money(cash?.collateral ?? null)}
        sub={refusedTiles ? notComputed : `${String(view.table?.legs.length ?? 0)} asset${(view.table?.legs.length ?? 0) === 1 ? "" : "s"} · by asset ↓`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-status"
        label="Status"
        value={cash === null ? "—" : STATUS_WORD[cash.status]}
        sub="strict rule: debt > cap"
        tone={cash === null ? "refused" : STATUS_TONE[cash.status]}
        pending={pending}
      />
    </div>
  );
}
```

- [ ] **Step 5: What backs this debt**

```tsx
// web/app/inspector/[addr]/BackingTable.tsx
import { ChartCard, KitTable, StatusPill, type KitRow } from "@/components/kit";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";
import styles from "../inspector.module.css";

const COLUMNS = [
  { key: "asset", header: "Asset" },
  { key: "amount", header: "Amount", align: "right" as const },
  { key: "price", header: "Price", align: "right" as const },
  { key: "value", header: "Value", align: "right" as const },
  { key: "ltv", header: "LTV", align: "right" as const },
  { key: "contribution", header: "Counts toward cap", align: "right" as const },
];

export function BackingTable({ view, onPrices }: { view: InspectorView; onPrices: () => void }) {
  const { table, cash, decimals, boundary } = view;
  const money = (v: bigint | null): string => (v === null ? "—" : humanUsdFull(v, decimals));
  const oldest = view.cashWire === null ? null : Math.max(...view.cashWire.price_inputs.map((i) => i.age_seconds ?? 0));
  const rows: KitRow[] =
    table === null
      ? []
      : [
          ...table.legs.map((leg): KitRow => ({
            key: leg.asset,
            testId: `inspector-backing-${leg.symbol}`,
            dim: leg.counted === "not-counted",
            cells: {
              asset: leg.symbol,
              amount: leg.amount ?? "—",
              price:
                leg.price === null ? (
                  "—"
                ) : leg.priceVerdict !== null && leg.priceVerdict !== "fresh" ? (
                  <>
                    {leg.price} <StatusPill tone={leg.priceVerdict === "stale" ? "warn" : "crit"}>{leg.priceVerdict}</StatusPill>
                  </>
                ) : (
                  leg.price
                ),
              value: money(leg.value),
              ltv: <span title="counts toward cap ÷ value — the LTV the engine applied to this asset">{leg.ltv ?? "—"}</span>,
              contribution: money(leg.contribution),
            },
          })),
          {
            key: "cap",
            testId: "inspector-backing-cap",
            cells: { asset: <span className={styles.capLabel}>Borrow cap</span>, amount: "", price: "", value: money(cash?.collateral ?? null), ltv: "", contribution: <b>{money(cash?.cap ?? null)}</b> },
          },
        ];
  return (
    <ChartCard
      title="What backs this debt"
      testId="inspector-backing-card"
      link={table === null ? undefined : { onClick: onPrices, label: "Price inputs →" }}
      finding={
        table === null
          ? view.refusedTiles && view.state !== "loading"
            ? "Not computed."
            : "Loading…"
          : `Cap = Σ (collateral value × that asset's LTV)${oldest === null ? "" : ` · prices as of ${String(oldest)}s ago`}`
      }
    >
      {table === null ? (
        <p className={styles.note}>{view.state === "no-position" ? "No Cash position in this batch — nothing to back." : view.state === "loading" ? "Loading…" : "Not computed."}</p>
      ) : (
        <>
          <KitTable testId="inspector-backing" columns={COLUMNS} rows={rows} />
          {table.capAgrees === false && (
            <p className={`${styles.note} ${styles.dim}`}>
              The legs sum to {money(table.sumContribution)}; the engine's cap is {money(cash?.cap ?? null)} — the engine's figure leads.
            </p>
          )}
          {boundary !== null && (
            <p className={styles.boundary} data-testid="inspector-boundary" data-kind={boundary.kind} title={"title" in boundary ? boundary.title : undefined}>
              {boundary.kind === "boundary" && <>Boundary: {boundary.sentence}</>}
              {boundary.kind === "breached" && "Already past the boundary: the current prices are below the level that keeps this account healthy."}
              {boundary.kind === "no-price-path" && boundary.sentence}
              {boundary.kind === "absent" && "No boundary price was published for this position."}
              {boundary.kind === "unreadable" && `Boundary published but unreadable (${boundary.fields.join(", ")}) — not read.`}
              {boundary.kind === "contradictory" && `Boundary withheld: ${boundary.detail}.`}
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 6: Trust**

```tsx
// web/app/inspector/[addr]/TrustCard.tsx
import { ChartCard, Sparkline, TrustChecklist } from "@/components/kit";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import type { InspectorView } from "@/lib/inspector-view";
import styles from "../inspector.module.css";

export function TrustCard({ view }: { view: InspectorView }) {
  const { trust, room } = view;
  const nearLine = Number(NEAR_LINE_TENTHS) / 10;
  return (
    <ChartCard title="Trust" testId="inspector-trust-card" link={{ href: "/proof", label: "Evidence →" }}>
      {trust === null ? (
        <p className={styles.note}>{view.state === "loading" ? "Loading…" : "Not computed."}</p>
      ) : (
        <TrustChecklist items={trust} testId="inspector-trust" />
      )}
      <p className={`${styles.note} ${styles.sparkHead}`}>
        {room === null ? "History · no Cash history for this account" : `History · room % over the last ${String(room.points.length)} batches`}
      </p>
      {room !== null && (
        <div className={styles.spark} data-testid="inspector-room-spark">
          <Sparkline
            values={room.values}
            pointTitles={room.titles}
            referenceValue={nearLine}
            referenceLabel="10% line"
            height={54}
            label="room as a percent of the borrow cap, per batch; gaps are batches the engine refused, withheld or never wrote"
            domain={{ min: 0, max: Math.max(nearLine + 2, ...room.values.filter((v): v is number => v !== null)) }}
          />
        </div>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 7: History, Activity, Legacy, Stress**

```tsx
// web/app/inspector/[addr]/HistoryCard.tsx
import { ChartCard, SectionHead, Sparkline } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { AddressReading } from "@/lib/address-lookup";
import { buildHistorySeries } from "@/lib/history-series";
import type { InspectorView } from "@/lib/inspector-view";
import { LEGACY } from "@/lib/inspector-position";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import styles from "../inspector.module.css";

const n = (v: number): string => v.toLocaleString("en-US");

export function HistoryCard({ view, reading }: { view: InspectorView; reading: AddressReading }) {
  const { room, streak } = view;
  const history = reading.history;
  const vantage = view.historyBatchId !== null && view.batchId !== null && view.historyBatchId !== view.batchId ? ` · history as of batch ${n(view.historyBatchId)}, position as of batch ${n(view.batchId)}` : "";
  const legacyEngine = history.phase === "ready" && history.value.outcome === "found" ? (history.value.response.engines.find((e) => e.engine === LEGACY) ?? null) : null;
  const legacySeries = legacyEngine === null ? null : buildHistorySeries(legacyEngine);
  const finding =
    history.phase === "loading"
      ? "Loading history…"
      : history.phase === "error"
        ? `History unavailable: ${history.message}`
        : room === null
          ? "No Cash history for this account in the covered window."
          : streak !== null && streak.batches >= 2
            ? `Within 10% of its cap for the last ${String(streak.batches)} batches${vantage}`
            : `Room has stayed above the 10% line in the newest batch${vantage}`;
  return (
    <section data-testid="inspector-history">
      <SectionHead title="History" qualifier="room % across batches · gaps drawn as gaps" />
      <div className={kit.grid}>
        <ChartCard title="Room under the borrow cap" finding={finding}>
          {room !== null && (
            <Sparkline
              values={room.values}
              pointTitles={room.titles}
              referenceValue={Number(NEAR_LINE_TENTHS) / 10}
              referenceLabel="10% line"
              height={140}
              label="room as a percent of the borrow cap, per batch"
              xLabels={{ start: `batch ${n(room.points[0]?.batchId ?? 0)}`, end: `batch ${n(room.newest?.batchId ?? 0)}` }}
              newestLabel={room.newest?.display}
            />
          )}
        </ChartCard>
        {legacySeries !== null && (
          <ChartCard title="Legacy · Aave v3 health factor" finding="Judged by its own health factor; liquidatable strictly below 1.0" testId="inspector-history-legacy">
            <Sparkline values={legacySeries.values} pointTitles={legacySeries.titles} referenceValue={1} referenceLabel="1.0" height={140} label="health factor per batch (legacy Aave v3 market)" />
          </ChartCard>
        )}
      </div>
      <p className={styles.dim}>Cash room per batch is the engine's own cap ÷ borrowings for that batch. A refused, withheld or missing batch is a gap; the line never draws across it.</p>
    </section>
  );
}
```

```tsx
// web/app/inspector/[addr]/ActivityTable.tsx
"use client";
import { KitTable, SectionHead, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { activityRows, activityTakeaway } from "@/lib/activity-rows";
import { useAddressActivity } from "@/lib/address-lookup";
import styles from "../inspector.module.css";

const COLUMNS = [
  { key: "when", header: "When" },
  { key: "action", header: "Action" },
  { key: "asset", header: "Asset" },
  { key: "amount", header: "Amount", align: "right" as const },
  { key: "tx", header: "Tx", align: "right" as const },
];

/** Mounted with key={addr} by the surface: a fresh mount can never hold another address's rows. */
export function ActivityTable({ addr, valid }: { addr: string; valid: boolean }) {
  const activity = useAddressActivity(addr, valid);
  const rows = activityRows(activity.rows);
  const timed = rows.filter((r) => r.timed).length;
  const kitRows: KitRow[] = rows.map((r) => ({
    key: r.key,
    dim: !r.timed,
    cells: {
      when: <span title={r.timed ? undefined : "no custodied header time yet — the block number stands in"}>{r.when}</span>,
      action: r.detail === null ? r.action : (<>{r.action}<span className={styles.detail}>{r.detail}</span></>),
      asset: r.asset,
      amount: <span title={r.amountTitle ?? undefined}>{r.amount}</span>,
      tx: r.tx.url === null ? <span className={kit.addr}>{r.tx.short}</span> : <a className={kit.addr} href={r.tx.url} rel="noreferrer" target="_blank">{r.tx.short}</a>,
    },
  }));
  return (
    <section>
      <SectionHead title="Activity" qualifier="this account's chain actions · custodied times, newest first" />
      <KitTable testId="inspector-activity" columns={COLUMNS} rows={kitRows} emptyText={activity.loading ? "Loading activity…" : activity.error !== null ? `Activity unavailable: ${activity.error.message}` : "No custodied actions for this account."} />
      {rows.length > 0 && <p className={styles.note} data-testid="inspector-activity-takeaway">{activityTakeaway(timed, rows.length - timed, activity.hasMore)}</p>}
      {activity.hasMore && (
        <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={activity.loadMore} disabled={activity.loading} data-testid="inspector-activity-more">
          Load more
        </button>
      )}
    </section>
  );
}
```

```tsx
// web/app/inspector/[addr]/LegacyCard.tsx
import type { RefinedPosition } from "@solvent/client";
import { KpiTile, StatusPill } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { AddressReading } from "@/lib/address-lookup";
import { displayHf } from "@/lib/history-series";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";
import { isWireDecimal } from "@/lib/wireGuard";
import styles from "../inspector.module.css";

const money = (v: string | null, decimals: number): string => (v !== null && isWireDecimal(v) ? humanUsdFull(BigInt(v), decimals) : "—");

/** Only when the address holds a legacy Aave v3 position. HF-based, labeled legacy, never beside a Cash sum. */
export function LegacyCard({ position }: { position: RefinedPosition; reading: AddressReading; view: InspectorView }) {
  const verdict = position.liquidation_verdict;
  const hf = position.health_factor === null ? null : displayHf(position.health_factor);
  return (
    <details className={styles.legacy} data-testid="inspector-legacy">
      <summary>Legacy · Aave v3 market position</summary>
      <div className={`${kit.kpis} ${kit.kpis4} ${styles.legacyBody}`}>
        <KpiTile label="Health factor" value={hf ?? "—"} sub="liquidatable strictly below 1.0" tone={verdict === "liquidatable" ? "crit" : verdict === "unknowable" ? "refused" : "neutral"} />
        <KpiTile label="Collateral" value={money(position.total_collateral_base, position.value_decimals)} sub="legacy market · own unit" />
        <KpiTile label="Debt" value={money(position.total_debt_base, position.value_decimals)} sub="never added to Cash" />
        <KpiTile label="Status" value={verdict === "liquidatable" ? "Liquidatable" : verdict === "unknowable" ? "Not computed" : "Healthy"} sub={position.flags.includes("stale_price") ? "stale price input" : "own health factor"} tone={verdict === "liquidatable" ? "crit" : verdict === "unknowable" ? "refused" : "ok"} />
      </div>
      {position.flags.includes("stale_price") && <p className={styles.note}><StatusPill tone="warn">stale price</StatusPill> a price input behind this position is older than its budget; the figure is computed and flagged.</p>}
      <p className={styles.dim}>The legacy market is judged by its own health factor. The two books are never added together.</p>
    </details>
  );
}
```

```tsx
// web/app/inspector/[addr]/StressTable.tsx
import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import type { AddressReading } from "@/lib/address-lookup";
import { stressReading, type StressSide } from "@/lib/address-stress";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";
import styles from "../inspector.module.css";

const COLUMNS = [
  { key: "scenario", header: "Scenario" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];
const days = (seconds: number): string => `${String(Math.round(seconds / 86_400))}d`;

export function StressTable({ reading, view }: { reading: AddressReading; view: InspectorView }) {
  const { decimals } = view;
  const room = (side: StressSide | null): string => (side === null || side.room === null ? "—" : humanUsdFull(side.room, decimals));
  const stress = reading.stress;
  const result = stress.phase === "ready" ? stressReading(stress.value, reading.address) : null;
  const rows: KitRow[] =
    result === null || result.kind !== "rows"
      ? []
      : result.rows.map((r) => ({
          key: r.id,
          dim: !r.applicable,
          cells: {
            scenario: r.projection === null ? r.label : (<>{r.label} <StatusPill tone="projection">PROJECTION</StatusPill></>),
            before: room(r.before),
            after:
              r.projection !== null
                ? r.projection.map((h) => `${days(h.seconds)}: ${h.extraInterest === null ? "—" : `+${humanUsdFull(h.extraInterest, decimals)}`} interest`).join(" · ")
                : room(r.after),
            flips: !r.applicable ? (r.reason ?? "not applicable") : r.flips === null ? (<StatusPill tone="refused">Cannot say</StatusPill>) : r.flips ? (<StatusPill tone="crit">Yes</StatusPill>) : r.projection !== null ? (r.projection.some((h) => h.verdict === "liquidatable") ? <StatusPill tone="warn">Within {days(r.projection.find((h) => h.verdict === "liquidatable")?.seconds ?? 0)}</StatusPill> : "No") : "No",
          },
        }));
  const empty =
    stress.phase === "loading" ? "Running the committed scenarios…" : stress.phase === "error" ? `Stress unavailable: ${stress.message}` : result?.kind === "withheld" ? `Stress withheld: ${result.cause}.` : result?.kind === "no-position" ? "No position to stress." : "No scenarios.";
  return (
    <section id="stress" data-testid="inspector-stress">
      <SectionHead title="Stress this address" qualifier="the committed scenarios, applied to this account · shocked figures are projections, not readings" link={{ href: "/lab", label: "Open Scenarios →" }} />
      <KitTable testId="inspector-stress-table" columns={COLUMNS} rows={rows} emptyText={empty} />
      <p className={styles.dim}>Before and after are the engine's own cap and debt under each shock; a rate step is a delta-only projection with prices held flat.</p>
    </section>
  );
}
```

- [ ] **Step 8: The drawer**

```tsx
// web/app/inspector/[addr]/InspectorDrawer.tsx
"use client";
import Link from "next/link";
import { formatUnits } from "@solvent/client";
import { Drawer } from "@/components/Drawer";
import type { AddressReading } from "@/lib/address-lookup";
import { groupDecimalString } from "@/lib/book-format";
import { formatBlock, renderBlockTime } from "@/lib/format";
import { humanPrice, humanUsdFull } from "@/lib/human-price";
import { sourceDisplay, symbolFor } from "@/lib/inspector-position";
import type { InspectorView } from "@/lib/inspector-view";
import { plainCause } from "@/lib/refusal-phrasebook";
import { isWireDecimal } from "@/lib/wireGuard";
import styles from "../inspector.module.css";

const exact = (v: string | null, decimals: number): string => (v !== null && isWireDecimal(v) ? groupDecimalString(formatUnits(v, decimals, { trim: false })) : "—");

/** Inputs · Calculation · Provenance — the formula with this account's numbers substituted, every input's source and age, the exact wire values. */
export function InspectorDrawer({ open, onClose, view, reading }: { open: boolean; onClose: () => void; view: InspectorView; reading: AddressReading }) {
  const p = view.cashWire;
  const cash = view.cash;
  const money = (v: bigint | null): string => (v === null ? "—" : humanUsdFull(v, view.decimals));
  const batch = reading.lookup.phase === "ready" ? reading.lookup.value.response.batch : null;
  const servedAt = reading.lookup.phase === "ready" ? reading.lookup.value.response.served_at : null;
  return (
    <Drawer open={open} onClose={onClose} title="Inputs · Calculation · Provenance">
      <div className={styles.method} data-testid="inspector-drawer-body">
        {p === null || cash === null ? (
          <p>No Cash position in this batch; nothing to calculate.</p>
        ) : (
          <>
            <h3>Calculation</h3>
            <p>
              Borrow cap = Σ (collateral value × LTV) ={" "}
              {view.table?.legs.map((l) => `${money(l.value)} × ${l.ltv ?? "—"}`).join(" + ")} = <b>{money(cash.cap)}</b>
            </p>
            <p>
              Room = cap − debt = {money(cash.cap)} − {money(cash.debt)} = <b>{money(cash.room)}</b> ({cash.roomPercent ?? "—"} of cap)
            </p>
            <p>
              Verdict: debt {cash.debt !== null && cash.cap !== null && cash.debt > cash.cap ? ">" : "≤"} cap → <b>{cash.verdict}</b> (the engine's strict boolean, <code>debt &gt; maxBorrowLT</code>; equality is healthy)
            </p>
            {cash.refusal !== null && <p>Refused: {plainCause(cash.refusal.code, cash.refusal.detail ?? undefined)} · <code>{cash.refusal.code}</code></p>}
            <h3>Inputs</h3>
            <ul>
              {p.price_inputs.map((i) => (
                <li key={i.asset}>
                  {symbolFor(p, i.asset)} · {sourceDisplay(i.source)} (<code>{i.source}</code>) · {i.provenance} ·{" "}
                  {i.value !== null && i.decimals !== null && isWireDecimal(i.value) ? humanPrice(BigInt(i.value), i.decimals) : "—"} · {i.age_seconds === null ? "age unknown" : `${String(i.age_seconds)}s`} · {i.verdict}
                  {i.block_number === null ? "" : ` · block ${formatBlock(i.block_number)}`}
                </li>
              ))}
            </ul>
            <p>
              As of: balances block {formatBlock(p.as_of.balances_block)} · params block {formatBlock(p.as_of.params_block)} · sweep block{" "}
              {p.as_of.sweep_block === 0 ? "none (never swept)" : formatBlock(p.as_of.sweep_block)}
            </p>
            <h3>Provenance</h3>
            {batch !== null && (
              <p>
                Batch <code>{String(batch.id)}</code> computed <code>{batch.computed_at}</code> by <code>{batch.producer}</code>; served <code>{servedAt ?? ""}</code>.
              </p>
            )}
            {reading.params.phase === "ready" ? (
              reading.params.value.length === 0 ? (
                <p>No Cash parameter changes on record.</p>
              ) : (
                <ul>
                  {reading.params.value.map((change) => (
                    <li key={`${change.tx_hash}:${String(change.effective_log_index)}`}>
                      {change.fields.map((f) => `${f.name} ${f.value ?? "—"}${f.prior === null ? "" : ` (was ${f.prior})`} ${f.unit}`).join("; ")} · effective {renderBlockTime(change.effective_block, change.block_time)} · <code>{change.source_event}</code>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p>{reading.params.phase === "error" ? `Parameter timeline unavailable: ${reading.params.message}` : "Loading the parameter timeline…"}</p>
            )}
            <h3>Exact wire values</h3>
            <p>
              <code>borrowings</code> {exact(p.borrowings, p.value_decimals)} · <code>max_borrow_lt</code> {exact(p.max_borrow_lt, p.value_decimals)} · <code>collateral_value_usd</code>{" "}
              {exact(p.collateral_value_usd, p.value_decimals)}
            </p>
            <ul>
              {p.legs.map((l) => (
                <li key={l.asset}>
                  <code>{l.symbol ?? l.asset}</code> amount {exact(l.amount, l.decimals)} · value_usd {exact(l.value_usd, p.value_decimals)} · max_borrow_contribution {exact(l.max_borrow_contribution, p.value_decimals)}
                </li>
              ))}
            </ul>
          </>
        )}
        <p>
          Exact evidence and the reconcile receipt: <Link href="/proof">Verification</Link>. Every endpoint this page reads: <Link href="/developers">API</Link>.
        </p>
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 9: The page CSS (rewrite `web/app/inspector/inspector.module.css`)**

```css
/* The Inspector's page-local layout. Everything visual is the kit's; this file only places it. */
.page { display: flex; flex-direction: column; gap: 14px; }
.toolbar { margin-bottom: 8px; }
.landing { max-width: 860px; }
.note { color: var(--ink-2); font-size: var(--type-body); margin: 12px 0 0; }
.dim { color: var(--ink-3); font-size: var(--type-small); margin: 10px 0 0; }
.boundary { color: var(--ink-2); font-size: var(--type-body); margin: 12px 0 0; }
.boundary b { color: var(--ink); font-weight: var(--w-medium); }
.capLabel { color: var(--ink-2); }
.sparkHead { margin-top: 14px; }
.spark { height: 54px; margin-top: 8px; border-bottom: 1px solid var(--line); position: relative; }
.legacy { margin-top: 6px; }
.legacy summary { cursor: pointer; font-size: var(--type-h2); font-weight: var(--w-semibold); color: var(--ink); }
.legacyBody { margin-top: 12px; }
.recent { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 8px 0 0; padding: 0; list-style: none; }
.detail { display: block; color: var(--ink-3); font-size: var(--type-floor); white-space: normal; }
.method h3 { font-size: var(--type-card); font-weight: var(--w-semibold); margin: 18px 0 6px; color: var(--ink); }
.method p, .method li { font-size: var(--type-body); color: var(--ink-2); margin: 6px 0; }
.method b { color: var(--ink); font-weight: var(--w-medium); }
.method code { font-family: var(--mono); font-size: var(--type-mono-sm); color: var(--ink); }
```

- [ ] **Step 10: Build, look, iterate**

Run: `npm run typecheck && npm run lint && npm run lint:css && npm run build`, then start `npm run start` (port 3111), open `/inspector/0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e` with the demo routes mocked — the quickest way is `node scripts/screenshot-pages.mjs <out> inspector` once Task 13's script change is in; before that, run the Task 12 e2e spec's near-cap test with `--headed`. Compare against the mockup block. Iterate on spacing only through the kit/page CSS; never restyle from prose.

- [ ] **Step 11: Commit (the page alone; retirement and pins are Task 12)**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/inspector/page.tsx web/app/inspector/InspectorLanding.tsx web/app/inspector/inspector.module.css web/app/inspector/[addr]/page.tsx web/app/inspector/[addr]/InspectorSurface.tsx web/app/inspector/[addr]/InspectorTiles.tsx web/app/inspector/[addr]/BackingTable.tsx web/app/inspector/[addr]/TrustCard.tsx web/app/inspector/[addr]/HistoryCard.tsx web/app/inspector/[addr]/ActivityTable.tsx web/app/inspector/[addr]/LegacyCard.tsx web/app/inspector/[addr]/StressTable.tsx web/app/inspector/[addr]/InspectorDrawer.tsx
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Inspector, rebuilt to the mockup - one verdict sentence, five tiles, what backs the debt, trust, room over batches, activity, legacy, stress, the drawer"
```

(Some old e2e specs fail at this commit — the old DOM is gone. Task 12 lands next and closes them; run the suite there, not here.)

---

### Task 12: The page-test contract, and retiring the old Inspector's components and pins

**Files:**
- Rewrite: `web/tests/e2e/inspector.spec.ts`
- Delete: `web/app/inspector/AddressEntry.tsx`, `web/app/inspector/[addr]/InspectorPositionCard.tsx`, `web/app/inspector/[addr]/InspectorHistory.tsx`, `web/app/inspector/[addr]/InspectorActivity.tsx`, `web/lib/inspector-lines.ts`, `web/tests/unit/inspector-lines.spec.ts`
- Modify: `web/tests/e2e/{shell,state-matrix,runbook-bsplit,p0-fixes,p1b-fixes,r1-fixes,r3-fixes,r4-fixes,r6-fixes}.spec.ts`
- Modify: `.superpowers/sdd/progress-ui-overhaul.md` (retirement ledger)

**Interfaces:**
- Consumes the test-id contract (Task 11) and the fixtures: `tests/fixtures/demo` (Task 10), `tests/fixtures/inspector.ts` (`ADDRESS_FOUND`, `ADDRESS_NOT_FOUND`, `ADDRESS_UNKNOWABLE`, `HISTORY`, `EVENTS`, `PARAMS`, the three addresses), `tests/fixtures/meta.ts`, `tests/fixtures/proof.ts`, `tests/fixtures/book.ts` (`BOOK_ERROR_UNAVAILABLE`).
- Produces the Inspector's page-test contract (spec §7): first-viewport answer, identity chips present, refused never zero, never summed, deep links carry the address, the seven states.

- [ ] **Step 1: The contract spec (replaces the file)**

```ts
// web/tests/e2e/inspector.spec.ts
// The Inspector's page-test contract (spec 2026-09-15 §5.3, §7). Mocked from
// committed fixtures: the demo dataset for the primary state (the mockup's
// near-cap account) and the openapi-example fixtures for the other outcomes.
// Every headline string here is produced by lib/inspector-headline.ts.
import { expect, test, type Page, type Route } from "@playwright/test";
import { BOOK_ERROR_UNAVAILABLE } from "../fixtures/book";
import {
  DEMO_ADDRESS_HEALTHY,
  DEMO_ADDRESS_LIQUIDATABLE,
  DEMO_ADDRESS_NEAR,
  DEMO_ADDRESS_REFUSED,
  DEMO_EVENTS_NEAR,
  DEMO_HEALTHY_ADDR,
  DEMO_HISTORY_NEAR,
  DEMO_LIQUIDATABLE_ADDR,
  DEMO_META,
  DEMO_NEAR_ADDR,
  DEMO_PARAMS_DM,
  DEMO_REFUSED_ADDR,
  DEMO_STRESS_NEAR,
} from "../fixtures/demo";
import { ADDRESS_FOUND, ADDRESS_NOT_FOUND, ADDRESS_UNKNOWABLE, EVENTS, FOUND_ADDR, HISTORY, NOT_FOUND_ADDR, PARAMS, UNKNOWABLE_ADDR } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";

const CORS = { "access-control-allow-origin": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

interface Mocks {
  address: unknown;
  history?: unknown;
  events?: unknown;
  params?: unknown;
  stress?: unknown;
  addressStatus?: number;
}

/** `*` never crosses `/`, so the /history and /stress routes are not swallowed by the address route. */
async function mockInspector(page: Page, m: Mocks) {
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/evidence*", (route) => json(route, EVIDENCE_MANIFEST));
  await page.route("**/v1/params*", (route) => json(route, m.params ?? DEMO_PARAMS_DM));
  await page.route("**/v1/events*", (route) => json(route, m.events ?? DEMO_EVENTS_NEAR));
  await page.route("**/v1/address/*/history*", (route) => json(route, m.history ?? DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, m.stress ?? DEMO_STRESS_NEAR));
  await page.route("**/v1/address/*", (route) => json(route, m.address, m.addressStatus ?? 200));
}

const surface = (page: Page) => page.getByTestId("inspector-surface");
const headline = (page: Page) => page.getByTestId("inspector-verdict-headline");
const dek = (page: Page) => page.getByTestId("inspector-verdict-dek");
const chip = (page: Page, label: string) => page.locator(`[data-chip='${label}']`);

test("near cap — the mockup's account: one sentence, five tiles, chips, what backs the debt, trust, the room sparkline", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await expect(headline(page)).toHaveText("Within $190.50 of its borrow cap. Not liquidatable yet.");
  await expect(dek(page)).toContainText("Borrowing $4,822 against a $5,012 cap — 96.2% used. A 3.8% fall in collateral value, or $190.50 more debt, makes this account liquidatable.");
  await expect(dek(page)).toContainText("within 10% of its cap for the last 14 batches (≈6m).");
  await expect(page.getByTestId("inspector-verdict-identity")).toContainText("Batch 18,251");
  await expect(chip(page, "Lookup")).toContainText("complete · both engines");
  await expect(chip(page, "Prices")).toContainText("PriceProvider v2 · 35s");
  await expect(chip(page, "Current")).toContainText("not projected");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("$4,822");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("4,822.000000 exact");
  await expect(page.getByTestId("inspector-kpi-cap")).toContainText("$5,012");
  await expect(page.getByTestId("inspector-kpi-room")).toContainText("$190.50");
  await expect(page.getByTestId("inspector-kpi-room")).toContainText("3.8% of cap");
  await expect(page.getByTestId("inspector-kpi-room")).toHaveAttribute("data-tone", "warn");
  await expect(page.getByTestId("inspector-kpi-collateral")).toContainText("$12,462");
  await expect(page.getByTestId("inspector-kpi-status")).toContainText("Near cap");
  const backing = page.getByTestId("inspector-backing");
  await expect(backing.locator("tbody tr")).toHaveCount(3);
  await expect(backing).toContainText("weETH");
  await expect(backing).toContainText("$4,000.00");
  await expect(backing).toContainText("50%");
  await expect(backing).toContainText("20%");
  await expect(page.getByTestId("inspector-backing-cap")).toContainText("$5,012");
  await expect(page.getByTestId("inspector-boundary")).toHaveText("Boundary: Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
  const trust = page.getByTestId("inspector-trust");
  await expect(trust.locator("li")).toHaveCount(5);
  await expect(page.getByTestId("inspector-trust-computed")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("inspector-trust-prices")).toContainText("35s · within 180s");
  await expect(page.getByTestId("inspector-trust-sweep")).toHaveAttribute("data-state", "warn");
  await expect(page.getByTestId("inspector-trust-sweep")).toContainText("1 of 3 rows failed · gen 4");
  await expect(page.getByTestId("inspector-trust-reconcile")).toContainText("29/29 Cash rows exact");
  await expect(page.getByTestId("inspector-room-spark").locator("svg")).toBeVisible();
  await expect(page.getByTestId("inspector-legacy")).toHaveCount(0);
  await expect(page.getByTestId("inspector-address-secondary")).toHaveAttribute("href", "#stress");
});

test("liquidatable and healthy — the other two spec templates, verbatim", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_LIQUIDATABLE });
  await page.goto(`/inspector/${DEMO_LIQUIDATABLE_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "liquidatable");
  await expect(headline(page)).toHaveText("Liquidatable now — $5,400 against a $5,012 cap.");
  await expect(page.getByTestId("inspector-kpi-status")).toHaveAttribute("data-tone", "crit");
  await expect(page.getByTestId("inspector-kpi-room")).toContainText("−$387.50");
  await expect(page.getByTestId("inspector-boundary")).toHaveAttribute("data-kind", "breached");
  await page.unroute("**/v1/address/*");
  await page.route("**/v1/address/*", (route) => json(route, DEMO_ADDRESS_HEALTHY));
  await page.goto(`/inspector/${DEMO_HEALTHY_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "healthy");
  await expect(headline(page)).toHaveText("58.1% of its borrow cap unused. Not close to liquidation.");
  await expect(page.getByTestId("inspector-kpi-status")).toHaveAttribute("data-tone", "ok");
});

test("a refused Cash position: cannot say, tiles refused, the last readable debt named, never $0", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_REFUSED });
  await page.goto(`/inspector/${DEMO_REFUSED_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "not-computed");
  await expect(headline(page)).toHaveText("Cannot say — this account's Cash position was not computed this batch.");
  await expect(dek(page)).toContainText("Its last readable debt is $4,100; no verdict is served for it.");
  for (const id of ["debt", "cap", "room", "collateral", "status"]) {
    await expect(page.getByTestId(`inspector-kpi-${id}`)).toHaveAttribute("data-tone", "refused");
  }
  await expect(page.getByTestId("inspector-kpi-cap")).toContainText("—");
  await expect(page.getByTestId("inspector-trust-computed")).toHaveAttribute("data-state", "refused");
  await expect(page.locator("main")).not.toContainText("$0");
});

test("no position — the definitive negative, entitled by a complete lookup", async ({ page }) => {
  await mockInspector(page, { address: ADDRESS_NOT_FOUND, history: HISTORY, events: EVENTS, params: PARAMS });
  await page.goto(`/inspector/${NOT_FOUND_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "no-position");
  await expect(headline(page)).toHaveText("No Cash or Aave position in batch 1.");
  await expect(chip(page, "Lookup")).toContainText("complete");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("—");
  await expect(page.locator("main")).not.toContainText("$0");
  await expect(page.locator("main")).not.toContainText("Cannot say");
});

test("cannot compute — a withheld book is named and is never 'no position'", async ({ page }) => {
  await mockInspector(page, { address: ADDRESS_UNKNOWABLE, history: HISTORY, events: EVENTS, params: PARAMS });
  await page.goto(`/inspector/${UNKNOWABLE_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "cannot-compute");
  await expect(headline(page)).toHaveText("Cannot say — the Cash book is withheld this batch.");
  await expect(dek(page)).toContainText("never “no position”");
  await expect(chip(page, "Lookup")).toContainText("withheld · Cash");
  await expect(page.locator("main")).not.toContainText("No Cash or Aave position");
  await expect(page.locator("main")).not.toContainText("$0");
});

test("the contract fixture: Cash liquidatable beside a legacy position — never summed, the legacy card present and labeled", async ({ page }) => {
  await mockInspector(page, { address: ADDRESS_FOUND, history: HISTORY, events: EVENTS, params: PARAMS });
  await page.goto(`/inspector/${FOUND_ADDR}`);
  await expect(headline(page)).toHaveText("Liquidatable now — $4,620 against a $4,200 cap.");
  await expect(page.getByTestId("inspector-legacy")).toBeVisible();
  await expect(page.getByTestId("inspector-legacy")).toContainText("Legacy · Aave v3 market position");
  await page.getByTestId("inspector-legacy").locator("summary").click();
  await expect(page.getByTestId("inspector-legacy")).toContainText(/1\.08/);
  // 4,620 (Cash, 6 dec) + 6,000 (legacy, 8 dec) must never appear as one figure
  await expect(page.locator("body")).not.toContainText("$10,620");
  // the stale legacy price rides the legacy card, not the Cash verdict
  await expect(page.getByTestId("inspector-legacy")).toContainText("stale price");
  await expect(page.getByTestId("inspector-history-legacy")).toBeVisible();
});

test("a stale Cash price input turns the Prices chip and the Trust item amber", async ({ page }) => {
  const position = DEMO_ADDRESS_NEAR.positions[0];
  if (position === undefined) throw new Error("demo position");
  const stale = {
    ...DEMO_ADDRESS_NEAR,
    positions: [
      {
        ...position,
        price_inputs: position.price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i)),
        as_of: { ...position.as_of, stale_price_inputs: true },
      },
    ],
  };
  await mockInspector(page, { address: stale });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(chip(page, "Prices")).toContainText("3m");
  await expect(chip(page, "Prices")).toHaveClass(/chipWarn/);
  await expect(page.getByTestId("inspector-trust-prices")).toHaveAttribute("data-state", "warn");
  await expect(page.getByTestId("inspector-trust-prices")).toContainText("weETH 210s old · budget 180s");
  await expect(page.getByTestId("inspector-backing")).toContainText("stale");
});

test("503: the lookup could not be completed — neither a position nor 'no position'", async ({ page }) => {
  await mockInspector(page, { address: BOOK_ERROR_UNAVAILABLE, addressStatus: 503 });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "unavailable");
  await expect(headline(page)).toHaveText("The lookup could not be completed.");
  await expect(dek(page)).toContainText("no servable batch");
  await expect(dek(page)).toContainText("an error is not an answer");
  await expect(page.locator("main")).not.toContainText("No Cash or Aave position");
  await expect(page.locator("main")).not.toContainText("$0");
});

test("an invalid path segment is refused inline — nothing is looked up", async ({ page }) => {
  let addressRequests = 0;
  await page.route("**/v1/stream**", (route) => route.abort());
  await page.route("**/v1/meta*", (route) => json(route, DEMO_META));
  await page.route("**/v1/address/**", (route) => {
    addressRequests += 1;
    return route.abort();
  });
  await page.goto("/inspector/not-an-address");
  await expect(surface(page)).toHaveAttribute("data-state", "invalid");
  await expect(headline(page)).toHaveText("Not an address.");
  await expect(dek(page)).toHaveText("An address is 0x followed by 40 hex characters — nothing else is looked up.");
  await expect(page.getByTestId("inspector-kpi-debt")).toHaveCount(0);
  expect(addressRequests).toBe(0);
});

test("the landing refuses a non-address inline and never navigates; a real one routes and is remembered", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto("/inspector");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Is this address at risk?");
  const input = page.getByTestId("inspector-address-input");
  await input.fill("0x123");
  await input.press("Enter");
  await expect(page.getByTestId("inspector-address-refused")).toBeVisible();
  await expect(page).toHaveURL(/\/inspector$/);
  await input.fill(DEMO_NEAR_ADDR);
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/inspector/${DEMO_NEAR_ADDR}$`));
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await page.goto("/inspector");
  await expect(page.getByTestId("inspector-recent")).toContainText("0x7a3f…c21e");
});

test("activity: six rows, a null block_time falls back to the block number, the untimed tail is disclaimed", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  const table = page.getByTestId("inspector-activity");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  await expect(table).toContainText("Borrow");
  await expect(table).toContainText("Collateral enabled");
  await expect(table.locator("tbody tr").last()).toContainText("block 155,315,000");
  await expect(page.getByTestId("inspector-activity-takeaway")).toContainText("5 with custodied header time, newest first; 1 untimed row(s) follow");
  await expect(page.getByTestId("inspector-activity-more")).toHaveCount(0);
});

test("stress: the committed scenarios inline — two flips, one projection", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  const table = page.getByTestId("inspector-stress-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("tbody tr").nth(0)).toContainText("ETH -30 percent");
  await expect(table.locator("tbody tr").nth(0)).toContainText("Yes");
  await expect(table.locator("tbody tr").nth(2)).toContainText("PROJECTION");
  await expect(table.locator("tbody tr").nth(2)).toContainText("30d");
  await expect(page.getByTestId("inspector-stress")).toHaveAttribute("id", "stress");
});

test("history: a differing vantage is stated; the drawer opens with the formula substituted", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR, history: { ...DEMO_HISTORY_NEAR, batch: { ...DEMO_HISTORY_NEAR.batch, id: DEMO_HISTORY_NEAR.batch.id - 1 } } });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(page.getByTestId("inspector-history")).toContainText("history as of batch 18,250, position as of batch 18,251");
  await page.getByTestId("inspector-drawer").click();
  const body = page.getByTestId("inspector-drawer-body");
  await expect(body).toContainText("Room = cap − debt = $5,012 − $4,822 = $190.50");
  await expect(body).toContainText("PriceProvider v2 (priceproviderv2)");
  await expect(body).toContainText("borrow_apy");
  await expect(body).toContainText("4,822.000000");
  await page.keyboard.press("Escape");
  await expect(body).toBeHidden();
});

test("resume: a failed background repair never replaces the rendered position", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await page.unroute("**/v1/address/*");
  await page.route("**/v1/address/*", (route) => route.abort());
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await page.waitForTimeout(500);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  await expect(page.getByTestId("inspector-kpi-debt")).toContainText("$4,822");
});

test("first viewport at 1440×900 holds the toolbar, the verdict, the tiles and the top of the grid; 390 has no horizontal scroll", async ({ page }) => {
  await mockInspector(page, { address: DEMO_ADDRESS_NEAR });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/inspector/${DEMO_NEAR_ADDR}`);
  await expect(surface(page)).toHaveAttribute("data-state", "near");
  const top = await page.getByTestId("inspector-backing").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(900);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 2: Build, run the contract**

Run: `npm run build`, kill any stale :3111 server, then `npx playwright test --project=e2e tests/e2e/inspector.spec.ts`
Expected: 15 passed. A failing assertion here is either the page (fix in the Task 11 files) or a wrong expectation about a fixture value (recompute from the fixture; the unit welds in Task 10 already pin the same numbers).

- [ ] **Step 3: Delete the old components and module**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent/web
git rm app/inspector/AddressEntry.tsx "app/inspector/[addr]/InspectorPositionCard.tsx" "app/inspector/[addr]/InspectorHistory.tsx" "app/inspector/[addr]/InspectorActivity.tsx" lib/inspector-lines.ts tests/unit/inspector-lines.spec.ts
npm run typecheck && npm run lint
```
Expected: clean — nothing else imports them (verified at planning: only the Inspector's own files did). If typecheck names an importer, that importer is a Lab/Proof/Observatory file and the module it needs must stay; report it rather than deleting further.

- [ ] **Step 4: Re-express and retire the legacy e2e pins (ruling R14)**

Edit each file exactly as listed. "Retire" means delete the `test(...)` (or `test.describe(...)`) block and any import that becomes unused. Every retirement gets one ledger line in Step 6.

| File | Test(s) | Action | Where the law now lives |
|---|---|---|---|
| `shell.spec.ts` | the `SURFACES` row for `/inspector` | change `h1: "Inspector"` → `h1: "Is this address at risk?"` | landing H1 (R9) |
| `state-matrix.spec.ts` | the 7 `surface: "inspector"` cells | re-express each `verify`: `loading` → `await expect(page.getByTestId("inspector-surface")).toHaveAttribute("data-state", "loading")` and `await expect(page.getByTestId("inspector-verdict-headline")).toHaveText("Looking up this address…")`; `ok:found-with-stale-price` → `data-state` is `liquidatable` and `page.getByTestId("inspector-legacy")` contains `stale price`; `empty:not-found-definitive` → `data-state` `no-position`, headline `No Cash or Aave position in batch 1.`, `main` not containing `Cannot say`; `refused:found-null-unknowable` → `data-state` `cannot-compute`, headline `Cannot say — the Cash book is withheld this batch.`, `main` not containing `No Cash or Aave position`; `ok:history-gaps-hoverable` → `page.getByTestId("inspector-history-legacy")` visible and `page.getByTestId("inspector-history")` contains `gaps drawn as gaps`; `error:429` → `data-state` `unavailable`, dek contains `rate limited (429)` and `an error is not an answer`; `responsive:mobile` → `data-state` matches `/liquidatable|near|healthy/` and `expectNoHorizontalOverflow(page)` unchanged. Its `mockInspector` helper gains a `**/v1/address/*/stress*` route serving `stress-dm.json` (import the JSON through `tests/fixtures/inspector.ts` or read it as the lab fixtures do) and a `**/v1/evidence*` route serving `EVIDENCE_MANIFEST`. | the contract spec + `inspector-view.spec.ts` |
| `runbook-bsplit.spec.ts` | "CLICKING a mover opens the Inspector's DYNAMIC route with that account on it" | keep the click and the URL assertion; replace the three DOM assertions after it with `await expect(page.getByTestId("inspector-address-input")).toHaveValue(DM_MOVER_ACCOUNT)`, `await expect(page.getByTestId("inspector-verdict")).toContainText(truncateAddress(DM_MOVER_ACCOUNT))` and `await expect(page.getByTestId("inspector-surface")).toHaveAttribute("data-state", /liquidatable|near|healthy/)`; add the `/stress` and `/evidence` routes to `mockInspectorFor` | deep link carries the address (spec §7) |
| `p0-fixes.spec.ts` | `p0-3` (2), `p0-4` (1), `p0-8 · absent boundaries` (3), `p0-9` "finding 3: the observed prices:null…" (1) | retire (7) | `inspector-position.spec.ts` "boundaryOf: absent, breached, no-price-path and unreadable arms" pins the absent, `prices:null`, null-`lowest_healthy_price` and uncertified arms; the DM/Aave card vocabulary is now the legacy card's own words |
| `p1b-fixes.spec.ts` | `p1b-4` (2), `p1b-6` "fix 4" (2) | retire (4) | `inspector-position.spec.ts` (the `[null]` entry and the deleted `price_decimals` → `unreadable`); the contract spec "history: a differing vantage is stated" |
| `r1-fixes.spec.ts` | "(2) THE BLOCKER…", "(2) a HEALTHY never_liquidatable…", "(12) the DM card renders its OWN totals…", "(12) DM risk params render as PERCENTAGES…", "(3) the Inspector states its own lookup's batch age", "(11) the history head and meta line…", "(11) an engine the account has NEVER touched…", "(10) the adjudicated intros render…" | retire (8) | `boundaryOf` returns `breached` for a liquidatable verdict even with `never_liquidatable: true`, and `no-price-path` with the wire reason on a healthy one (unit-pinned); tiles are the position's own numbers (contract spec); the Snapshot chip is the lookup's own age (`inspector-view.spec.ts`); the landing's copy is R9's |
| `r3-fixes.spec.ts` | all 3 | retire (3) | liq-bonus rendering left the Inspector with the position card; `params-format.spec.ts` still pins the arithmetic |
| `r4-fixes.spec.ts` | "(1) the Inspector reconciles its OWN lookup on resume…" | retire (1) | contract spec "resume: a failed background repair never replaces the rendered position" |
| `r6-fixes.spec.ts` | "(2) the Inspector: same law, its own envelope…" | retire (1) | same |

After editing, remove imports that became unused (eslint will name them).

- [ ] **Step 5: The whole suite**

Run: `npm run typecheck && npm run lint && npm run lint:css && npm run build`, kill any stale :3111 server, then `npx playwright test`
Expected: all green; the unit count is higher than Plan 1's close (1,057) despite the retired `inspector-lines.spec.ts`.

- [ ] **Step 6: The ledger**

Append to `.superpowers/sdd/progress-ui-overhaul.md` under a heading `## 2026-09-15 · Plan 2 (Inspector) — retirements`, one line per file:

```
- tests/e2e/inspector.spec.ts: rewritten as the Inspector page-test contract (15 pins); the 19 old pins described the retired position card, HF-history card and proof fold.
- tests/e2e/p0-fixes.spec.ts: 7 Inspector pins retired (p0-3, p0-4, p0-8 boundary arms, p0-9 f3) — the boundary arms are unit-pinned in tests/unit/inspector-position.spec.ts.
- tests/e2e/p1b-fixes.spec.ts: 4 retired (p1b-4 ×2 → unit "unreadable" arms; p1b-6 fix 4 ×2 → contract "history: a differing vantage is stated").
- tests/e2e/r1-fixes.spec.ts: 8 retired — never_liquidatable vs verdict, own totals, DM percent params, own age, history head, never-touched engine, landing intro; laws now in inspector-position / inspector-view unit specs and the contract.
- tests/e2e/r3-fixes.spec.ts: 3 retired — liq-bonus premium rendering left the Inspector with the position card; params-format.spec.ts keeps the arithmetic.
- tests/e2e/r4-fixes.spec.ts, r6-fixes.spec.ts: 1 each retired → contract "resume: a failed background repair never replaces the rendered position".
- tests/e2e/state-matrix.spec.ts: 7 Inspector cells re-expressed against data-state and the pinned headlines.
- tests/e2e/runbook-bsplit.spec.ts: the mover deep link re-expressed (field value, kicker, data-state).
- tests/e2e/shell.spec.ts: /inspector H1 → "Is this address at risk?" (ruling R9).
- tests/unit/inspector-lines.spec.ts: retired with lib/inspector-lines.ts; activityTakeaway and its pins moved verbatim to lib/activity-rows.ts / tests/unit/activity-rows.spec.ts.
- Deleted: app/inspector/AddressEntry.tsx, app/inspector/[addr]/{InspectorPositionCard,InspectorHistory,InspectorActivity}.tsx, lib/inspector-lines.ts.
```

- [ ] **Step 7: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/e2e/inspector.spec.ts web/tests/e2e/shell.spec.ts web/tests/e2e/state-matrix.spec.ts web/tests/e2e/runbook-bsplit.spec.ts web/tests/e2e/p0-fixes.spec.ts web/tests/e2e/p1b-fixes.spec.ts web/tests/e2e/r1-fixes.spec.ts web/tests/e2e/r3-fixes.spec.ts web/tests/e2e/r4-fixes.spec.ts web/tests/e2e/r6-fixes.spec.ts .superpowers/sdd/progress-ui-overhaul.md
git add -u web/app/inspector web/lib/inspector-lines.ts web/tests/unit/inspector-lines.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "test(web): the Inspector page-test contract; the old position card, history card, activity list and their pins retired with ledger notes"
```

---

### Task 13: Screenshot pins, the gate script, and the owner's side-by-side gate

**Integrator runs this personally** (spec §9.3–9.4).

**Files:**
- Modify: `web/tests/e2e/screenshots.spec.ts` (+ two new baselines under `screenshots.spec.ts-snapshots/`)
- Modify: `web/scripts/screenshot-pages.mjs`

- [ ] **Step 1: The pin spec gains the Inspector**

In `web/tests/e2e/screenshots.spec.ts`: import `DEMO_ADDRESS_NEAR, DEMO_EVENTS_NEAR, DEMO_HISTORY_NEAR, DEMO_NEAR_ADDR, DEMO_PARAMS_DM, DEMO_STRESS_NEAR` from `../fixtures/demo`; extend `mockDemo` with

```ts
  await page.route("**/v1/params*", (route) => json(route, DEMO_PARAMS_DM));
  await page.route("**/v1/events*", (route) => json(route, DEMO_EVENTS_NEAR));
  await page.route("**/v1/address/*/history*", (route) => json(route, DEMO_HISTORY_NEAR));
  await page.route("**/v1/address/*/stress*", (route) => json(route, DEMO_STRESS_NEAR));
  await page.route("**/v1/address/*", (route) => json(route, DEMO_ADDRESS_NEAR));
```

and change `PAGES` to carry a readiness check per page:

```ts
const PAGES = [
  { name: "overview", path: "/", ready: async (tab: Page) => expect(tab.getByTestId("overview-live")).not.toHaveAttribute("aria-busy", "true") },
  { name: "book", path: "/book", ready: async (tab: Page) => expect(tab.getByTestId("book-kpi-near")).not.toHaveAttribute("aria-busy", "true") },
  {
    name: "inspector",
    path: `/inspector/${DEMO_NEAR_ADDR}`,
    ready: async (tab: Page) => {
      await expect(tab.getByTestId("inspector-surface")).toHaveAttribute("data-state", "near");
      await expect(tab.getByTestId("inspector-room-spark").locator("svg")).toBeVisible();
      await expect(tab.getByTestId("inspector-stress-table").locator("tbody tr")).toHaveCount(3);
      await expect(tab.getByTestId("inspector-activity").locator("tbody tr")).toHaveCount(6);
    },
  },
] as const;
```

with the loop calling `await page.ready(tab)` in place of the old `settled` wait. The mask stays `[live-pill, [data-chip='Snapshot']]` — every other figure on the Inspector derives from fixture stamps and does not tick.

- [ ] **Step 2: The gate script gains the Inspector**

In `web/scripts/screenshot-pages.mjs`: `PAGES` gains `inspector: \`/inspector/${demo.DEMO_NEAR_ADDR}\`` (define `PAGES` after `demo` is imported), and the route block gains the five Inspector routes above (using `demo.DEMO_*`). Update the usage comment to `[overview|book|inspector ...]`.

- [ ] **Step 3: Baselines**

Run: `npm run build`, kill any stale :3111, then `npx playwright test --project=e2e tests/e2e/screenshots.spec.ts -g inspector --update-snapshots`, then `npx playwright test --project=e2e tests/e2e/screenshots.spec.ts`
Expected: `inspector-dark.png` and `inspector-light.png` written; 6 passed on the second run (the Overview and Book baselines unchanged — the kit CSS additions are new classes only).

- [ ] **Step 4: The owner's side-by-side gate (spec §9.3) — BEFORE the commit**

Run: `node scripts/screenshot-pages.mjs <scratch>/gate3 inspector` (server on :3111). Copy `inspector-dark-fold.png`, `inspector-light-fold.png`, `inspector-dark-full.png` into the visual companion's content dir (`.superpowers/brainstorm/2116-1789507948/content/`) as `gate3-*.png`, write a `gate3.html` screen that shows the mockup's Inspector block (`pages-console.html:210-276`, rendered) beside the dark fold, with the light fold and the full page below, and ask the owner to approve or name the diff. A named diff is fixed in the Task 11 files, baselines regenerated, and the gate repeated. Nothing in this task is committed until the owner says yes.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/tests/e2e/screenshots.spec.ts web/tests/e2e/screenshots.spec.ts-snapshots web/scripts/screenshot-pages.mjs
python roadmap/tools/scope_gate.py
git commit -m "test(web): screenshot pins for the Inspector at 1440x900 in both themes, owner-approved side by side with the mockup"
```

---

### Task 14: Final verification, widths, the whole-branch review, the Codex rounds

- [ ] **Step 1: The gates**

From `web/`: `npm run typecheck && npm run lint && npm run lint:css && npm run build`; kill any stale :3111; `npx playwright test`.
Expected: all clean; unit count > 1,057; e2e 0 failed.

- [ ] **Step 2: Widths and themes**

With a production server on :3111 and the demo routes mocked (reuse `scripts/screenshot-pages.mjs` with a temporary `viewport` argument, or a one-off Playwright script in the scratchpad), load `/inspector/${DEMO_NEAR_ADDR}` at 1366, 1440, 1920 and 2560 wide in both themes and assert `document.documentElement.scrollWidth <= clientWidth` at each; also load `/inspector` (the landing) at 1366 and 390. Expected: no horizontal scroll anywhere; the five tiles stay on one row at 1366+; the 8/4 grid stacks below 900px.

- [ ] **Step 3: Contrast**

The Inspector introduces no new text/ground pairs: `.checkI` uses `--ok-text`, `.checkWarn` `--warn-text`, `.checkRefused` `--crit-text` on `--panel` — pairs already audited ≥4.5:1 in Plan 1's close. Confirm by reading the two theme blocks in `web/app/tokens.css`; if any of the three `*-text` tokens is missing in either theme, add nothing — use the existing `--ink` and report the gap.

- [ ] **Step 4: Whole-branch review and the Codex rounds (spec §9.5)**

Dispatch the final whole-branch review (`requesting-code-review`, most capable model per the SDD skill) on `git diff d989286..HEAD -- web`. Fix Criticals and Importants in one wave; re-review. Then produce the slim diff for Codex:

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
mkdir -p .superpowers/sdd/2026-09-15-ui-inspector
git diff d989286..HEAD -- web/lib web/app/inspector web/components/kit web/tests/unit ':!web/tests/fixtures/**/*.json' > .superpowers/sdd/2026-09-15-ui-inspector/final-review-slim.diff
```

Dispatch `codex-reviewer` on that file scoped to correctness and honesty regressions (three-valued `found`, the engine's verdict, refusals never zero, never summed, the resume law), and re-dispatch Plan 1's owed round on `.superpowers/sdd/2026-09-15-ui-kit-overview-book/final-review-slim.diff`. If the Codex CLI still rejects the configured model, record `BLOCKED-owner: Codex CLI rejects the configured model; owner upgrades the CLI` in the ledger and do not modify the Codex config or CLI.

- [ ] **Step 5: Close the ledger**

Append the close entry to `.superpowers/sdd/progress-ui-overhaul.md` (commit range, suite counts, gates, owner approval timestamp, review outcomes, carry-forwards: Plan 3 retargets the toolbar's stress link to `/lab?address=`; Plan 4 converges the Overview's CTA onto `AddressField` if wanted, retires `--t-*`/`--fs-*`, `PostureRibbon`/`Ribbon`/`Stampline`/`StatCard`; the `Collateral` tile's "by asset" link becomes an in-page anchor when the table gets an id). Re-include the plan workspace in `.superpowers/sdd/.gitignore` (`!2026-09-15-ui-inspector/`) if the SDD scripts overwrote it.

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add .superpowers/sdd/progress-ui-overhaul.md .superpowers/sdd/.gitignore .superpowers/sdd/2026-09-15-ui-inspector
python roadmap/tools/scope_gate.py
git commit -m "docs(sdd): plan 2 closes - the Inspector landed behind screenshot pins; ledger, briefs and reports recorded"
```

---

## Self-review (writing-plans checklist)

**Spec coverage (§5.3):** toolbar with the address, Inspect and "Stress this address →" — Task 1 + Task 11 Step 3 (R7 anchors it in-page); verdict header per §3.5 with kicker "Cash · account 0x…" and "Lookup complete · both engines" — Tasks 6, 9, 11; five tiles with the mocked subs — Task 11 Step 4; 8/4 grid "What backs this debt" with cap total row and boundary sentence — Tasks 3, 11 Step 5 (R3 corrects the mockup's per-asset prose to the wire's solve); Trust checklist and room sparkline with the 10 % line — Tasks 4, 5, 11 Step 6 (R4/R5); below the fold History (room %, HF for legacy, gaps as gaps), Activity table, Legacy card only if present, inline Stress, the drawer — Task 11 Steps 7–8; seven states in one frame — Task 9's `InspectorState` (ten, the seven plus `unavailable`, `not-computed`, `legacy-only`) and the contract spec; data from the five endpoints — Task 8. §3.2 names — headline and labels use Cash / Aave v3 market (legacy) / borrow cap / room; wire names only in the drawer and hovers. §7 — unit-first for every pure module; the page-test contract; screenshot pins; retirements ledgered per file. §9 — mockup CSS extracted verbatim (Task 1), owner gate before the pin commit (Task 13), Codex round after (Task 14).

**Placeholder scan:** no TBD/TODO; every code step carries its code; the two "if the API differs" notes name the file and line to read and keep the spec's assertion as the contract; the census step names the exact failure message to act on.

**Type consistency:** `CashPosition.status` values (`liquidatable | near | healthy | refused | unknowable`) match `STATUS_WORD`/`STATUS_TONE` (Task 11) and `InspectorState` (Task 9) uses the first three verbatim; `Boundary` kinds (`absent | breached | no-price-path | unreadable | boundary`) match `BackingTable`'s branches and the `data-kind` pin; `TrustItem` (Task 4) is structurally `TrustCheckItem` (Task 1) — same field names and state union; `Phase<T>` is `phase: "loading" | "error" | "ready"` with `value` (not `lookup`) everywhere (Tasks 8, 9, 11); `stressReading(lookup, account)` (Task 7) is called with `(stress.value, reading.address)` (Task 11); `roomSeries(engine, knownBatchIds)` and `nearCapStreak(series)` (Task 5) match Task 9; `humanPrice`/`humanAmount` signatures (Task 2) match every call; `pricesChip` returns a `ViewChip` and `IdentityChips` accepts it (`label`, `value`, `tone?`); `VerdictHeader` takes `emphasis`/`rest`/`tone`/`dek`/`chips`/`actions`/`testId`/`kicker` as in `components/kit/VerdictHeader.tsx:5-25`.
