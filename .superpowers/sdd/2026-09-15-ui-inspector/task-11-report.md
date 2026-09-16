# Task 11 report — the Inspector page (integrator)

Status: DONE. Built by the integrator (visual task, spec §9.2) against the landed interfaces of Tasks 1–10, looked at in both themes on a production build with the demo routes mocked, iterated twice, committed as one commit (hash in the ledger).

## What was done
- `web/app/inspector/page.tsx` → `InspectorLanding` (kicker "Inspector", H1 "Is this address at risk?", `AddressField`, recent lookups — ruling R9).
- `web/app/inspector/[addr]/page.tsx` → `<InspectorSurface key={addr} addr={addr} />` (a new address is a new surface).
- `InspectorSurface.tsx` rewritten: `useAddressLookup` → `deriveInspectorView` → toolbar (`AddressField` with the current address and "Stress this address →" anchored to `#stress`, ruling R7), `VerdictHeader` (kicker with the address rendered mono/no-transform inside the kit's small caps; drawer button when found), tiles, the 8/4 grid, History, Activity (`key={addr}` — double lock with the surface), Legacy (only when present), Stress (only with a Cash position), the drawer. `data-testid="inspector-surface"` carries `data-state`.
- Sections: `InspectorTiles` (five tiles; refused register prints the state's own word: not computed / no position / withheld / lookup unavailable; the refused arm keeps "last readable" debt in the sub only), `BackingTable` (legs, LTV derived with hover, cap row, all six `Boundary` arms incl. `contradictory` → "Boundary withheld: …"), `TrustCard` (checklist + mini sparkline, "10% line" label top-right as mocked), `HistoryCard` (room over batches full width, legacy HF series when present, `historyOutcome` worded — withheld is never "no history"; the streak sentence or "the newest batch is withheld"), `ActivityTable` (scale from the wire's own `value_decimals` per engine; "raw units" pill; `raw_type` on hover; untimed rows dimmed; takeaway; Load more), `LegacyCard` (`<details>`, HF-based, labeled legacy), `StressTable` (before/after room, flips, PROJECTION pill with the note on hover, `marketRealization` gated by `isWireScale`), `InspectorDrawer` (calculation with substituted numbers, inputs, provenance incl. the params timeline, exact wire values), `MeasuredSparkline` (frame + `useMeasuredWidth` mount together — a frame rendered after its data arrives is measured on its own mount).
- Kit: `VerdictHeader.kicker` is a `ReactNode` and a non-empty `rest` is separated from the emphasis by a space (the Book's `rest` values are unaffected); `TrustChecklist` label gets `.checkLabel` so the detail column wraps instead of the label; `kit.module.css` `.checkLabel`/`.checkSmall` (wrapping detail, right-aligned).
- `inspector.module.css` rewritten (page-local only).
- `scripts/screenshot-pages.mjs` gains the `inspector` page and its five routes (Task 13's change, pulled forward to look at the page).

## Verification
- `npm run typecheck`, `npm run lint`, `npm run lint:css`, `npm run build` clean.
- Looked at (1440×900, dark + light, fold + full) against the mockup: near-cap account matches the mockup's composition; liquidatable, not-computed, no-position, cannot-compute states render into the same frame with honest words and no `$0`.
- E2E contract lands in Task 12; screenshot pins and the owner gate in Task 13.

## Deviations from the brief
- `TrustCard`/`HistoryCard` use `MeasuredSparkline` instead of calling `Sparkline` with no width: the kit's `Sparkline` defaults to 140px and `useMeasuredWidth` measures once at mount — the brief's shape rendered both charts narrow.
- The "10% line" reference label is not passed to `Sparkline` (it collided with the newest-value label); the mini chart prints it as an absolutely positioned label as the mockup does, the History chart names it in the finding.
- `InspectorTiles` sub-line words per state (brief said "not computed" everywhere).
- `HistoryCard` words `historyOutcome` (added to the view in Task 9's fix round).
- Five typographic apostrophes (’) in JSX text where the brief had ASCII (`react/no-unescaped-entities`).

## Fix round 1 (after task-11-review.md)
- C1: the legacy HF chart renders only when the legacy engine was ever present (`engineNeverPresent`), and its series is built on `knownBatchAxis(response)` so both charts share one axis and gaps stay gaps (#2).
- #3: `newestLabel` is passed only when the newest point is plotted (computed / zero-cap).
- #4: the debt tile's "last readable" follows the view's rule (only a non-negative debt).
- #5: new page helper `[addr]/money.ts` — `moneyFor`, `wireMoney`, `wirePrice`, `wireExact` — every wire scale through `isWireScale` and every decimal through `isWireDecimal` before formatting; a bad scale prints "unreadable scale", never throws. Used by the tiles, backing table, stress table, drawer, legacy card.
- #6/#8: the Trust card's and the tiles' empty/refused words are the state's own (no position / no Cash position / withheld / lookup unavailable / not computed); #7 batch/batches; #9 `oldestPriceAge` + `humanAge` in the backing finding; #10 the drawer's verdict line only for a computed position, otherwise "none served"; #11 sub-day horizons print hours; #12 no empty sub while pending; #13 the MeasuredSparkline comment states the real reason it passes the refs rule; #15 the activity table mounts once the lookup has answered so amounts never flip from raw to scaled.
- Task 9's note: the drawer button shows only when there is a Cash position to explain.
- Gates: typecheck, lint, lint:css clean.

## Concerns
- Demo tx hashes were zero-padded counters until Task 10's fix round (sha256-derived, landed 1d772dd).
- The live pill reads "Reconnecting" in every capture because the stream is aborted by the mocks (same as Plan 1's gates; masked in the pins).

## Fix round 2 (after re-review of d1032e4)
- #3: `HistoryCard` passes `newestLabel` only when `room.newest.value !== null` — a zero-cap point has no geometry either, so a label would sit on nothing.
- #10: the drawer's no-verdict line reads "the engine served no verdict for this row (`debt > maxBorrowLT` is the rule it would apply)" — the engine's word, not "not computed".
- Gates: typecheck, lint clean. Commit 3410c42 (pathspec-limited).
