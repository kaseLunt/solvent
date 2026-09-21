# Task 7 report — the pre-kit components retired; the styleguide shows the kit (R7)

Status: DONE_WITH_CONCERNS (unit gates green; the e2e project is NOT run — the controller runs it on the shared build per the pre-flight ruling). One planned deletion did not happen: `StatusChip` stays, because `states/*` — which R7 keeps — compose it.

Commit: `50c62a3` (one commit, by pathspec, 23 paths; scope gate OK; the commit hook's control-plane doctor OK). It sits on `ac3bbde` (the History fixer's round 1, which landed while I worked); my commit holds only my paths.

The brief's commit message listed `StatusChip` among the retired components. It was not retired, so the message says so instead: "...SeverityHF; StatusChip stays because states/* compose it; the styleguide shows the kit".

## Deletion table

Method: `get_symbols_overview` on each of the twelve files to enumerate every export, then `find_referencing_symbols` on every one of them (38 symbols), plus a grep for the CSS-module imports and a bare-name sweep over `app`, `components`, `lib`, `tests`, `scripts`. After the deletions: `tsc --noEmit` clean, and a code-only sweep for the twelve names finds none.

| Component (exports checked) | Consumers found | Disposition |
|---|---|---|
| `StatCard` (`StatCard`, `StatCardProps`) | styleguide `page.tsx` only | DELETED |
| `Stampline` (`Stampline`, `StampItem`, `StampItemProps`, `stamplineHiddenSummary`) | styleguide `page.tsx`, `DrawerDemo.tsx` | DELETED |
| `Ribbon` (`Ribbon`, `RibbonStreamChip`, `RibbonProps`, `RibbonAsOf`, `RibbonSnapshotChip`, `TIER_CLASS`, `TONE_CLASS`) | styleguide `page.tsx` only | DELETED |
| `EngineChip` | styleguide `page.tsx`, `TableSpecimen.tsx`, `PaginationDemo.tsx` | DELETED |
| `RefusedTag` | styleguide `page.tsx` only | DELETED |
| `AddressMono` (`AddressMono`, `AddressMonoProps`) | styleguide `page.tsx`, `TableSpecimen.tsx`, `PaginationDemo.tsx` | DELETED |
| `VerdictBanner` (`VerdictBanner`, `VerdictBannerProps`) | styleguide `page.tsx` only | DELETED |
| `DataTable` (`DataTable`, `LoadMoreFooter`, `Column`, `ColumnSortState`, `DataTableProps`, `LoadMoreProps`, `WindowingSeam`, `RowTone`) | styleguide `TableSpecimen.tsx`, `PaginationDemo.tsx` | DELETED |
| `MarksStamp` (`MarksStamp`, `Mark`) | styleguide `page.tsx` only | DELETED |
| `ProjectionBadge` | styleguide `page.tsx` only | DELETED |
| `SeverityHF` (`SeverityHF`, `SeverityHFProps`) | styleguide `page.tsx`, `TableSpecimen.tsx` | DELETED |
| **`StatusChip`** (`StatusChip`, `ChipVal`, `RefusedChip`, `EngineTag`, both props interfaces) | styleguide — **and `components/states/EmptyDefinitive.tsx`, `RefusedCard.tsx`, `SupersededCard.tsx`, `UnavailableCard.tsx`** (plus the deleted `VerdictBanner`) | **KEPT.** R7 keeps `states/*`, and four of the six cards render `StatusChip` / `ChipVal` / `RefusedChip`. The pre-flight note that it was styleguide-only was wrong on this one. `EngineTag` alone now has zero consumers (see Concerns 2). |
| `verdict.module.css` | `VerdictBanner.tsx` only | DELETED |
| `table.module.css` | `DataTable.tsx`, and `DrawerDemo.tsx` (its button borrowed `.loadMore`) | DELETED — `DrawerDemo` now uses the kit's ghost button |
| `chip.module.css` | `StatusChip.tsx` | KEPT (its importer stays) |
| `ribbon.module.css` | `Ribbon.tsx` and **`DegradationBanner.tsx`** | KEPT — `DegradationBanner` (kept by R7) imports it (see Concerns 3) |
| `primitives.module.css` | `RouteRefusal.tsx` | KEPT, as ruled (see Concerns 3) |
| `EvidenceDrawer.tsx`, `evidence.module.css` (named in R7) | already gone before this task | n/a |

Kept untouched as ruled: `Drawer`, `ExactValue`, `DegradationBanner`, `SurfacePlaceholder`, `states/*`, `ThemeToggle`. `RouteRefusal` and `StatusChip` got comment-only edits (Deviations 2).

## The styleguide's sections

Section order is preserved; `sg-tokens` (with `ContrastSpecimens`, the self-measuring block), `sg-type`, `sg-exact`, `sg-states`, `sg-charts`, `sg-interaction` are byte-for-byte untouched. `ContrastSpecimens.tsx` and `InteractionRegisterDemo.tsx` were not opened for edit.

| Section (in page order) | Before | After |
|---|---|---|
| `sg-verdict` | `VerdictBanner` ×5 variants + the missing-strip refusal | `VerdictHeader` in its four tones — `sg-verdict-{crit,warn,ok,refused}` — each with kicker, computed sentence, dek and chips; plus `sg-verdict-identity-law`, a header composed with `chips={[]}`, which renders the kit's own dashed "Identity missing" chip |
| `sg-freshness` | `StatusChip` tier chips | UNCHANGED in markup (`StatusChip` is kept); the two comments that named the retired appbar / `Ribbon TIER_CLASS` now state the tier→tone law itself |
| `sg-dimensions` | `StatusChip` ×9 dimensions + `ProjectionBadge` in dim 7 and composition 2 | same, with the two `ProjectionBadge`s replaced by `StatusPill tone="projection"` (the kit's dashed projection register) |
| `sg-table` | `DataTable` + `EngineChip` / `AddressMono` / `SeverityHF` / `RefusedChip` | `KitTable` (`sg-table-kit`): the refused row `dim` (rendered, counted, never dropped), its collateral / debt / health-factor cells printing the word `refused` in amber; a Status column of `StatusPill`s (the refused pill's label is the plain cause, its `title` the wire code); two small & dust rows folded behind a `SmallToggle` (`sg-table-toggle`) whose label names their count and sum; the per-engine reconciliation footer kept |
| `sg-pagination` | `DataTable` + `LoadMoreFooter` + `useCursorPages` | `KitTable` + `useCursorPages` (still live: Activity and `address-lookup` use it) with a kit ghost "Load more" and the words "end reached" when exhausted |
| `sg-drawer` | `Drawer` opened by a `table.module.css` button, a `Stampline` inside | the kit's `Drawer` (imported from `@/components/kit`), opened by the kit ghost button labelled "Methodology & evidence" (R3's label), key → value rows inside |
| `sg-identity` (was `sg-ribbon`) | `Ribbon` ×4 — the appbar | `IdentityChips`: the four-truth strip with a trailing slot, and a tone strip (ok / warn / crit / refused-dashed). "Each truth its own chip" is the law both carried |
| `sg-kpi` (was `sg-statcard`) | `StatCard` ×4 | `KpiTile` ×6: neutral, crit, warn, ok, refused (dashed, the gap word), pending (`…`, `aria-busy`) |
| `sg-pills` (was `sg-severity`) | `SeverityHF` ×5 | `StatusPill`'s vocabulary: crit / warn / ok / refused (with its `title`) / projection |
| `sg-chips` | `EngineChip`, `EngineTag`, `AddressMono`, `RefusedTag`, `ProjectionBadge` | RETIRED with its components. Engine and address identity ride the table specimen (`kit.addr`); refusal and projection ride `sg-pills` |
| `sg-marks` | `MarksStamp` ×2 | RETIRED — the kit has no B·P·S stamp and no page renders one |
| `sg-stampline` | `Stampline` | RETIRED — its successor, key → value rows, is shown in `sg-drawer` and `sg-truth` |
| `sg-truth` | `Stampline` over the `lib/format` renderers | the same four `lib/format` outputs on key → value rows |

`styleguide.module.css`: `.statrow` removed (no user left); `.kv` (+ `.kvWarn`, `.kvDim`) and `.pageFoot` added, tokens only.

## Pins

`tests/e2e/p1a-fixes.spec.ts`:

| Pin | Disposition |
|---|---|
| p1a-6 "every text swatch's LIVE ratio clears 4.5…" (the contrast-swatch pin) | UNTOUCHED — it measures tokens; the block it reads was not edited |
| "the five banner variants render their identity strips — and the structural refusal names the omission" | RE-EXPRESSED as "the four VerdictHeader tones render their identity strips — and an empty chip list renders the refusal chip": per tone `data-variant`, one non-empty `[data-slot="identity"]`, and the emphasis colour resolved to `--{tone}-text` (`--ink-2` for refused); the refused header's dashed cause chip with the wire code in its `title`; the law specimen renders exactly one chip, "Identity missing", dashed |
| — its arm "the current banner's value wears the exact affordance (`[title="$8,468.238278"]`)" | RETIRED — `VerdictHeader.emphasis` is a string, so no `ExactValue` can sit inside it. The affordance's own pin ("the exact affordance carries its cue…") is unchanged |
| — its arms `data-identity-refusal="missing-identity-strip"` / "Verdict withheld" | RETIRED with `VerdictBanner`; the kit's equivalent law is the empty-chip-list arm above. `lib/kit.ts`'s `verdictBannerModel` keeps its unit pins in `tests/unit/kit.spec.ts` |
| "the freshness tier row renders all five states in the appbar recipes" | KEPT, body unchanged; the title no longer names the retired appbar ("…each in its tier's register") |
| "the nine dimensions and three compositions mount…" | UNTOUCHED — it never asserted the `ProjectionBadge` |
| "the six states mount… and refused table cells say the word" | KEPT; the count of the exact word `refused` inside `sg-table` goes 2 → 3 (the health-factor cell says it too, where the old table put a `RefusedChip`) |
| NEW "the kit table: the refused row stays rendered and dimmed, and the small & dust rows fold behind a toggle that names them" | the dim cell resolves to `--ink-3` while the word inside keeps `--warn-text`; the refused pill's label and `title`; the toggle is a `switch`, names "2 … ($14.55)", 3 rows → 5 rows; the refused row is visible in both positions |
| NEW "the kit specimens: KpiTile's tones…, StatusPill's vocabulary, IdentityChips' tones" | `data-tone` per tile, crit value in `--crit-text`, the refused tile dashed with its gap word in `--ink-2`, the pending tile `aria-busy` printing `…` and not the value it was handed; the five pill labels, the refused pill's `title`, projection dashed and unfilled; four identity chips, tone values in their `-text` grade, the refused chip dashed |
| type scale · interaction register · p1a-9 F5 consumer specimen · both F3 pins · the four p1a-1 pins | UNTOUCHED |

`tests/e2e/shell.spec.ts` — "styleguide renders every specimen section": the walk is the new sixteen ids (three renamed, three retired, with the mapping in the comment); the drawer is opened by `getByRole("button", { name: "Methodology & evidence" })` (was "OPEN EXPLAIN-THIS-NUMBER DRAWER"). No other test in the file changed.

`tests/e2e/r1-fixes.spec.ts` — test (10) deleted: all four arms had retired (Tasks 3–6) and it asserted nothing. A comment in its place names where each intro is pinned and which clause each dek keeps. The header's item (10) now records the retirement; item (6)'s note, the (6) divider and the (5) divider name the pages by their present names, with a line mapping the route paths in `SURFACES` to the pages they serve. No other test in the file was touched (test (4)'s inner comments still say "the Feed").

## Gates

- `npx tsc --noEmit`: clean.
- `npx eslint .` (from `web/`): clean.
- `npm run lint:css`: clean.
- `npx playwright test --project=unit`: 899 passed.
- `npx playwright test --project=e2e --list` on the three edited specs: parses, 30 tests listed. Nothing was built and no e2e test was run.
- The gates ran on a tree that held the History fixer's then-uncommitted changes, which have since landed as `ac3bbde`; the tree the gates saw is the tree at `50c62a3`.

## Deviations

1. `StatusChip.tsx` and `chip.module.css` kept (above). Consequently `sg-freshness` and `sg-dimensions` still show `StatusChip`, so the styleguide shows the kit plus one pre-kit chip.
2. Comment-only edits in two kept components, so they do not name deleted files: `RouteRefusal.tsx` ("the dashed register `RefusedTag` carries" → "the dashed warn register"); `StatusChip.tsx` (dropped "match the landed appbar family (ribbon.module.css) byte-for-byte" and "the legacy RefusedTag… stays untouched this phase"). No code changed in either.
3. Three section ids renamed to what they show, three sections retired — hence the `shell.spec.ts` walk edit. Keeping the old ids would have left `sg-statcard` showing a `KpiTile`.
4. The drawer button's label changed to R3's "Methodology & evidence", with the one shell pin that clicks it.
5. The commit message differs from the brief's (above).

## Concerns

1. **The e2e project is unrun.** The likeliest failures, in order: (a) the new colour assertions assume `.tbl tr.dim td` beats `.tbl td` and that `.kpiRefused .kpiV` / `.emRefused` resolve to `--ink-2` — read from `kit.module.css`, not observed in a browser; (b) `toHaveText("Refused sweep failed twice")` relies on Playwright's whitespace normalisation across `{label} <b>{value}</b>`; (c) `sg-table`'s exact-`refused` count of 3; (d) the styleguide pins skip unless the build sets `NEXT_PUBLIC_SHOW_STYLEGUIDE=1` — a build without it reports them skipped, not passed.
2. **`states/*` and `StatusChip` are styleguide-only.** No file under `app/` imports any `components/states/*` card; their only consumer is `sg-states`. R7 keeps them by name, so I did. A ruling to retire `states/*` would take `StatusChip.tsx`, `chip.module.css`, `sg-freshness` and most of `sg-dimensions` with it. `EngineTag` (in `StatusChip.tsx`) and `.engineTag` (in `chip.module.css`) have no consumer today; I left the code alone.
3. **Dead CSS in two kept modules.** `ribbon.module.css`: `DegradationBanner` uses six classes (`banner`, `warn`, `bannerInner`, `bannerTag`, `warnTag`, `bannerBody`); the appbar, chip family, popover and proof-ribbon rules (about 190 lines) have no user, and the file's name and header comment still describe the appbar. `primitives.module.css`: `RouteRefusal` uses the `routeRefusal*` rules; `.address`, `.engine`, `.hf`, `.marks*`, `.projection`, `.refusedTag`, `.sev`, `.stamp*`, `.stat*` have no user. The ruling was delete-or-keep per module, so neither was pruned.
4. **Stale comments outside my files** still name deleted components: `lib/stream-posture.ts:41,146` (`components/Ribbon.tsx`), `lib/freshness.ts:623` (the Stampline), `lib/pagination.ts:3` and `lib/useMeasuredWidth.ts:14` (DataTable), `lib/posture.tsx:4` (the integrity Ribbon). `lib/kit.ts` still exports `verdictBannerModel`, `VERDICT_TONE_CLASS`, `verdictIdentityChips` and friends, which only `tests/unit/kit.spec.ts` consumes now; `CHIP_TONE_CLASS` and `refusedChipSegments` are still live through `StatusChip`.
5. **The table specimen's law differs slightly from the Book's.** The Book's refused row prints "—" in its room and debt cells; the specimen keeps the older §9 law (the word `refused`, never a dash). I kept the canon's wording because the existing pin asserts it; if the Book's rendering is the intended law, the specimen and that pin should follow it.
6. `kit.kv` / `kvK` / `kvV` exist in `kit.module.css` with no consumer anywhere; the styleguide's key → value rows use a page-local `.kv` on a `dl` (as History's point card does) rather than adopting an unused kit class.

## Fix round 1 (after task-7-review.md)

Status: DONE_WITH_CONCERNS — every ruling landed; one gate (`tsc`) is red on a file that is not mine (below). Commit `de8dcbe`, on `b928a0b`: one commit by pathspec, six paths (`web/app/styleguide/{TableSpecimen,DrawerDemo,page}.tsx`, `styleguide.module.css`, `web/tests/e2e/p1a-fixes.spec.ts`, `web/README.md`), staged by name, scope gate OK, hook OK, subject line only. The controller's browser run of `50c62a3` (212 passed) covered the pins as first written; the pins this round changes or adds have NOT been run.

| Ruling | What changed | Its pin |
|---|---|---|
| **I1** one engine | `TableSpecimen.tsx` is rewritten on `app/book/NeedsAttention.tsx`'s composition: every row is a Cash position, the columns are the Book's (Account · Room · Debt · Status — no Engine column, no Collateral, no Health factor), rows carry bigints at the engine's scale and print through `humanUsd`. Order follows the Book: two material liquidatable rows, one near-cap row, the refused row, and the two below-the-line rows appended after it when unfolded. The toggle's count and sum are derived from the rows (`belowLine.length`, a `reduce` over their debt), not a hand constant: `Show 2 small & dust positions ($75.75)` = $61.20 + $14.55, both Cash. The product's folded rows are below-the-line LIQUIDATABLE rows, so a zero-debt row cannot be among them; the old `$0.00` no-debt row and the healthy row are gone, as the Book's table carries neither. The file comment says the sum is one engine's. The footer's two-engine reconciliation sentence is gone; the footer now says only how many Cash rows show and that a refused row never folds. | kit-table pin: the header row is exactly `Account, Room, Debt, Status`; the toggle's text is the new label; 4 rows → 6; `sg-table-row-small` carries `$61.20` and `sg-table-row-dust` `$14.55` once unfolded (the old id `sg-table-row-dust-liquidatable` is gone) |
| **I2** the em dash | The refused row's Room and Debt cells are the bare string `"—"` and its `StatusPill tone="refused"` names the refusal, as `NeedsAttention.tsx:55-60`. `refusedCell()` and the old header comment are gone; `.refcell` is deleted from `styleguide.module.css`. The title is composed as the product composes it (`notComputedCause`: plain cause, then the wire code) through `plainCause` from `lib/refusal-phrasebook`, with a real Cash code: `collateral sweep failed · SWEEP_FAILED`. The old specimen code `sweep_failed_no_success` is not in the phrasebook and would have printed `refused (sweep_failed_no_success) · …`. | the six-states test is retitled "…and a refused row prints an em dash under the pill that names it, never 0 and never $0"; its comment states the law as it stands; its arm counts the refused row's cells (4), its `—` cells (2), asserts no cell matches `/^\$?0(\.0+)?$/`, and the pill's label. Kit-table pin: the `--warn-text` word arm is replaced — the Room `td` has text `—`, has no child element (a bare text node, so the glyph inherits), and computes `--ink-3`; the pill's label + title arm stays, the title now the product-shaped string |
| **I3** the exact value's home | `DrawerDemo.tsx` gains one row in the key → value list: `liquidatable debt` → `$6,840 · exact wire value 6,840.238278` (`sg-drawer-exact`; the exact string in a `code`, as the Inspector drawer's "Exact wire values" prints it). It is the crit header's own figure, and the table's two material debts (4,200.118139 + 2,640.120139) sum to it, so the header, the table and the drawer state one number. `.kv dd code { font: inherit }` keeps the row's mono register. `sg-exact`, its pin and `ExactValue` are untouched. | one new short test in `p1a-fixes.spec.ts` (p1a had no drawer test to add a line to, and `shell.spec.ts` is not mine this round): open by `sg-drawer-open`; inside the dialog `sg-drawer-exact` contains `$6,840` and its `code` is `6,840.238278` |
| **M1** README | `web/README.md`: `components/` names the kit (`VerdictHeader`, `IdentityChips`, `KpiTile`, `StatusPill`, `KitTable`, `Drawer`); `lib/posture.tsx` "feeds the header's live pill" (was the Ribbon — `LivePill` does read `usePosture`); law 3 points at `StatusPill tone="crit"`, law 4 at `StatusPill tone="refused"` + the dim `KitTable` row with "—" + the dashed refused `KpiTile`, law 5 at `IdentityChips`' Batch · Snapshot and the drawer's as-of line, law 7 at `StatusPill tone="projection"` (its three product users: Scenarios, the address workspace, the Inspector's stress table). Every law's sentence is kept; no section added. | none (prose) |
| **M4** the crit header | kicker `Cash book · right now` (the Book's own), the sentence in `bookHeadline`'s grammar (`$6,840 of Cash debt is liquidatable right now,` + `across 2 accounts.`), the dek in the lib's sentence forms with figures that match the table specimen (2 below-the-line rows totalling $75.75; 1 near-cap account carrying $142K; 1 position not computed), and the Book's strip from `lib/cash-view.ts:155-173`: Batch `18,251` · Snapshot `48s · fresh` (ok) · Coverage `551 / 552 computed` · Current `not projected`. | the VerdictHeader pin is unchanged and still holds (it reads tone, strip presence and emphasis colour, not these strings) |
| **M5** the lost law | one sentence added to the `sg-verdict` note, as ruled | none (prose) |

Untouched, verified: the `sg-tokens` section hashes identically to `b928a0b`; `ContrastSpecimens.tsx` and `InteractionRegisterDemo.tsx` have no diff; the p1a-6 contrast test body hashes identically. M2, M3, M6, M7, M8, M9 were not touched.

### Gates

- `npx eslint app/styleguide tests/e2e/p1a-fixes.spec.ts`: clean.
- `npm run lint:css`: clean.
- `npx playwright test --project=unit`: 904 passed, 0 failed.
- `npx tsc --noEmit`: **1 error, not in my files** — `tests/unit/cash-summary.spec.ts(92,7): TS2353 … 'liquidation_verdict' does not exist in type …`. That spec, `lib/cash-summary.ts` and `lib/cash-rows.ts` are another implementer's uncommitted edits (Task 10's `cash-*`). Re-run once after the unit project, as ruled: same single error. It is the only error `tsc` reports, so the six files of this commit typecheck. Not fixed, not touched.
- No build, no e2e, no snapshot update, :3111 not touched.

### Concerns

1. The re-expressed and new pins are unrun in a browser. Likeliest failures: (a) `toHaveText(["Account","Room","Debt","Status"])` on `thead th`; (b) `filter({ hasText: /^—$/ })` matching exactly the two dash cells; (c) the dash `td` computing `--ink-3` — read from `.tbl tr.dim td` beating `.tbl td`, which the reviewer traced too, but still not observed; (d) the new drawer test leaves the drawer open when it ends (each test has its own page, so nothing downstream sees it).
2. The refused pill's title changed value, not just shape: `sweep_failed_no_success` → `collateral sweep failed · SWEEP_FAILED`. The ruling said the label + title arm stays; the arm stays, its string follows the product's `notComputedCause`. The other specimens on the page (`sg-pills`, the refused header chip, `sg-identity`, the `states/*` cards, `sg-dimensions`) still show the old lowercase code, which is not a code the phrasebook knows. If the canon should use real wire codes throughout, that is a small follow-up outside this round's rulings.
3. `TableSpecimen.tsx` now imports two libs, `lib/human-usd` and `lib/refusal-phrasebook`. Neither is in the set Tasks 9 and 10 are editing, and both were clean in `git status` when I read them.
4. The `tsc` error above will fail anyone's typecheck gate until Task 10 lands or reverts its spec edit.
