# Task 11 report — the Scenarios page (integrator-built)

Status: DONE_WITH_CONCERNS. Commit ff78ac6 (parent 6855c01; 17 paths by pathspec; scope-gate OK). `npm run build` exit 0 (`/lab` prerendered static); `npx eslint app/lab components/kit app/inspector/[addr]` clean; `npm run lint:css` clean; `npx tsc --noEmit` 0 errors; unit project 1246 passed. The look: `scripts/screenshot-pages.mjs` (demo fixtures routed) for `lab`, `labBare`, `labAddress` in both themes — checked against the mockup and R16 (headline "$1.2M more Cash debt becomes liquidatable, across 118 accounts."; tiles 118 · +$1.2M · +$40K · 941; heatmap 49 held / 118 crossing / 932 held / 6 not measured; 20 of 118 movers; legacy folded). The e2e contract is Task 12's; the old Lab's e2e pins are expected red until it lands.

## What was done
- `app/lab/page.tsx` — Suspense + `LabSurface`; title "Scenarios". `lab.module.css` — the page grid (300 px library, one workspace), notice, banner, legacy fold, tiles pair, method (drawer body).
- `LabSurface.tsx` — the composition: `useLabReading` + `deriveLabView(reading, { selectedId, checked })`; one-address mode = `useAddressLookup` + `deriveInspectorView` + `addressWorkspace` (R8); deep links decided from the listing AT RENDER (`deepLinkDecision`; the notice is derived, never stored; `?scenarios=` pre-ticks its ids in the `useState` initializer) and dispatched once by a ref-guarded effect (no setState in the effect — `react-hooks/set-state-in-effect`); the "Computed" chip inserted from `useAnchoredAgeSeconds(resultReceipt(identity, 0))`; `compare={null}` (Task 13 wires it); mode switches and the address field write the URL with `router.replace`.
- `money.ts` — the page's money registers (R11): `bookMoney`/`signedBookMoney` (tiers), `accountMoney` (full), `wireExact` (drawer).
- `LabTiles.tsx`, `TransitionCard.tsx` (cells from `HeatmapView`, the finding sentence), `MoversTable.tsx`, `LegacyResult.tsx` (folded `<details>`, its own tiles and lanes, never beside a Cash sum), `StaleBanner.tsx` (R13), `AssumptionsDrawer.tsx` (R10; exact wire values; `lab-drawer-transitions-note`), `AddressWorkspace.tsx` (R8/R15).
- Inspector retargets: `InspectorSurface` secondary → `/lab?address=${addr}`; `StressTable` link → `/lab?address=${account}` (or `/lab` without a Cash book).
- `scripts/screenshot-pages.mjs` — `lab` (`?scenario=eth_minus_30`), `labBare`, `labAddress` keys; routes `**/v1/scenarios/run-book-set`, `**/v1/scenarios/*/run-book`, `**/v1/scenarios` to Task 10's demo exports.

## Rulings made while building (all in the ledger)
1. The plan's address-mode run button (`onRun` a no-op) is a plan defect — `ScenarioLibrary.run` is now optional (kit), the footer renders only with a run or a compare, address mode passes none: the field's own Inspect is the action. Task 12's contract: `lab-run` in book mode only.
2. The kit `AddressField` overflowed the 300 px column (`.searchIn { min-width: 320px }`) → `.libAddress .searchIn { min-width: 0; flex: 1 1 100% }`; the hint hidden there (the placeholder is the hint).
3. The kicker uppercased the address → the Inspector's `.kickAddr` promoted to the kit (`kit.kickAddr`), `inspector.module.css` loses its copy, both kickers use it.
4. `EngineResult.heat` is `HeatmapView` (Task 9 minor 2) — the tiles and the card read it directly.

## Concerns
- The address table prints a negative room after as "−$1,069" while the tile says "over cap by $1,069" — two spellings of one number on one page; the table mirrors the Inspector's StressTable (R8). Align once in the final triage.
- Address mode's library rows override the outcome word ("Applies to this address" / "Not on this address") from `space.rows` — a presentational override in the surface rather than a `lab-view` state; acceptable for the composition, noted.
- `chips` inserts "Computed" at index 2 by position (after batch and scenario) — the position is a surface choice.
