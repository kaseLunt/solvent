# Task 10 report — Debt: the Inspector and the Book (R11, second set)

**Status:** DONE_WITH_CONCERNS
**Commit:** `646aee9` on `main` (19 paths, by pathspec; no attribution line; hooks ran — control-plane doctor OK, scope-gate OK 19 paths). Not pushed.
**Gates (from `web/`, on the committed tree):** `npx tsc --noEmit` clean · `npx eslint app lib components tests` clean · `npx playwright test --project=unit` 920 passed · no CSS moved, `lint:css` not needed. No `next build`, nothing on :3111 started or killed, no `--update-snapshots`, no prettier.
**E2E pins were written, not run** (parallel-phase rule): the integrator runs `book.spec.ts`, `inspector.spec.ts`, `verification.spec.ts`.

## Per item

### 1. `readCashPage` judges `page.engine` before `refused` — `web/lib/cash-rows.ts`
- The engine check now precedes the `refused` read; the doc comment states the law (another engine's refusal is a wrong-engine fault, never Cash's refusal).
- Unit pin: `cash-rows.spec.ts` "readCashPage: the page's engine is judged before its refusal …". **Seen failing first** (received `{kind:"refused", code:"SWEEP_FAILED"}`), then green.
- E2E pin (unrun): `book.spec.ts` "another engine's refused page is a wrong-engine fault — never Cash's refusal".

### 2. Over-delivery wording — `web/lib/book-headline.ts` (+ one call site in `web/lib/cash-book.tsx`)
- New `censusFaultWords(delivered, census)`: short → "the walk delivered N of the M rows the wire advertised" (unchanged bytes, existing pins hold); past the census → "the walk delivered N rows for a census of M".
- Unit pin: `book-headline.spec.ts` "the census fault: …". **Seen failing first** — as a load failure (the export did not exist), not an assertion failure: the sentence was an inline template inside the hook, so there was no unit-reachable seam before. Green after.
- E2E pin (unrun): `book.spec.ts` "a walk past its census is worded against the census …" (2 rows against a census of 1; asserts the new words and `not "2 of the 1"`).

### 3. The distance chart's mid-walk qualifier — `web/lib/cash-summary.ts`, `web/app/book/BookSurface.tsx`
- New `walkQualifier(summary|null)` (the two strings moved out of the component byte-for-byte; the Needs-attention card reads the same function) and `bandsFinding(summary)` → `{lead, figure, rest, barsNote}`. The component now prints the parts and composes nothing.
- Settled rendering is byte-identical ("… counts printed · **$X** sits within 10% of the cap", no note) — the pixel-pinned demo Book does not move.
- Incomplete walk, running AND stopped alike: the figure is a floor in its own words ("at least **$X** sits within 10% of the cap · walking the book / the walk stopped, figures are a lower bound"), the bars carry their own line under the chart (`data-testid="book-bands-note"`: "Walking the book: every bar and every count is a lower bound over the accounts read so far." / "The walk stopped: … it read."), and a walk-derived zero is "—", never "$0 sits within 10%".
- Unit pins: `cash-summary.spec.ts` "the distance chart's finding …" and "the walk qualifier …". **Seen failing first** as a load failure (exports absent). Green after.
- E2E pins (unrun): assertions added to the existing pending-walk and census-stop tests, plus a new test that holds demo page two open ("at least $…", note present) then releases it (note gone, no "at least", no "lower bound").

### 4. An empty `waterfall.points` is a refusal — `web/lib/cash-view.ts`
- `emptyGrid(points)` runs before `stressPreview`: `[]` → `{kind:"refused", reason:"no points published"}`; a non-list → "waterfall.points is not a list". A withheld engine keeps its own cause (checked first). The card prints "Preview withheld: no points published."; the Overview's entry line inherits it.
- Unit pin: `cash-view.spec.ts` "a waterfall served with no points is a refusal …". **Seen failing first** (received `{kind:"absent"}`), then green.
- E2E pin (unrun): `book.spec.ts` "a waterfall served with no points is a named refusal on the preview card …".

### 5. Resume/stress disclosure — `web/lib/address-lookup.ts`, `web/lib/inspector-view.ts`
- The hook records whether the lookup on the page was landed by a repair (`repaired: keepOnFailure` on the keyed result) and exposes `AddressReading.lookupRepaired`. A repair that rides an in-flight foreground load is that load's landing, so it is not marked.
- The view carries the fact as data: `InspectorView.stressFromPreviousLookup` (false when no stress has answered). `stressBatchNote` says it in both arms: disclosure "Stress from the previous lookup, for batch N; the position above was refreshed since and is batch M. …" and row label "batch N · stress from the previous lookup". Same batch on both sides → still `null` (one batch's stress is that batch's, whichever lookup it was read for).
- **No `StressTable.tsx` edit was needed**: it already renders `stressBatchNote(view).disclosure` and `.rowLabel`, so the words reach the page through the existing seam. Nothing for the integrator to wire.
- Unit pin: `inspector-view.spec.ts` "a resume repair refreshes the lookup alone …". **Seen failing first** (`stressFromPreviousLookup` undefined), then green.
- E2E pin (unrun): `inspector.spec.ts` "resume: a repair that moves the position replays no stress …" — placed beside the other resume tests, not among the stress-table tests; it also pins the premise (the stress request count does not move across the repair).

### 6. Verification reads the Cash census only — `web/lib/verification-view.ts`, `web/app/proof/VerificationSurface.tsx`
- Read first, as instructed: `pipelineSteps` consumes `reading.phase`, `reading.book.batch.id`, `reading.book.batch.computed_at`, and `cashAccounts` — which was `deriveCashView(...).positions`, i.e. `/v1/book`'s own `engines[debt_manager].positions` through the population guard. No walked row is read. The census is enough for an honest step; not stopped.
- `VerificationSurface` no longer mounts `useCashBook` (nor `deriveCashView` / `useMetaConstants`); it asks `/v1/book` once, beside its existing evidence and meta asks. Pure helpers in the lib: `BOOK_LOADING`, `bookAnswered`, `bookFailed` (503 → "no-batch", anything else → "error" — the hook's own mapping) and `cashCensus` (same guard and field name as `deriveCashView`). `Pipeline`'s `reading` prop and the Overview are untouched.
- Unit pin: `verification-view.spec.ts` "the compute step reads the census, not a walk …". **Seen failing first** as a load failure (exports absent). Green after.
- E2E pin (unrun): `verification.spec.ts` "the compute step reads the census only: /proof asks /v1/book once and never walks /v1/positions …" — counts requests by pathname and follows the repo's `waitForTimeout(300)` convention before a zero-count assertion. On the old code this fails on `asked.positions` (the walk asks page one as soon as the book lands).

## Deviations, with reasons

1. **`web/lib/cash-book.tsx` touched (2 lines: one import, one call).** It is in neither my owned list nor the never-touch list. The over-delivery sentence lived there as an inline template, not in `cash-summary.ts` / `book-headline.ts` as the plan guessed; the words moved to `book-headline.ts` and the hook now calls them. Task 9's files are disjoint from it.
2. **Item 3's "both bounds" is my reading of an ambiguous phrase.** Neither the plan nor the originating review (`2026-09-15-ui-scenarios/plan1-codex-wave-review.md` §3: "$0 sits within 10% of the cap · walking …" is "softer than the tiles' dash-until-settled") defines "bounds". I read it as: mid-walk the chart carries two lower bounds — the finding's figure and the bars — where only a single trailing qualifier existed; and I made both incomplete registers (running, stopped) equally strict, with the tiles' dash-until-settled law for a zero. If the controller meant something narrower, `bandsFinding` is the one place to change and `barsNote` the one element to drop.
3. **The plan's StressTable negative-room item was not done** — it is Task 9's, per the addendum.
4. **Three of the six pins "failed first" as module-load failures, not assertion failures** (items 2, 3, 6): each fix introduces the lib seam the pin reads, so no assertion could run against the old code. Items 1, 4, 5 failed on an assertion. For 2, 3 and 6 the e2e pins are the ones that would fail by assertion on the old code; I could not run them.

## Concerns

- **E2E pins are unverified by me.** Two I would check first: the `book-bands-card` regexes assume `humanUsd` renders the demo's page-one near-cap sum (~$830K by my count of 27 rows) as text matching `\$[\d.,]+[KMB]?`; and `asked.book === 1` on `/proof` assumes nothing else in the shell asks `/v1/book` (I found no other caller besides `useCashBook`, which `/proof` no longer mounts).
- **`/proof` lost the book's resume repair.** `useCashBook` re-fetched `/v1/book` on a pageshow/visibility resume; the census-only ask is one-shot, like the page's evidence and meta asks beside it. The compute step's batch id therefore no longer refreshes on resume — the other two steps never did. Consistent, but a behaviour change; owner's call whether `/proof` wants a resume repair for all three asks.
- **A pre-existing wording residue, not fixed (out of scope):** when over-delivery strikes on the terminal page, the headline still frames it as "The walk stopped before the last page (the walk delivered 2 rows for a census of 1)" — the walk did reach the last page. The cause words are now right; the frame sentence belongs to `walkSentence` / `bookHeadline`.
- **After `reload()` (epoch bump) the old stress can stand beside the new lookup until the new stress lands**; that window is disclosed by the plain batch-mismatch note, not by "from the previous lookup" (only a repair sets the flag). Recording the load epoch on both results would close it; I kept the change to what the item names.
- **Shared tree:** one full unit run showed two load failures inside Task 9's files (`address-stress` no longer exporting `stressVerdict`; `lab-address` not exporting `sideRoomWords`) — theirs mid-edit, gone on the re-run a minute later (920 passed). An untracked `web/tests/unit/zz-tmp-failfirst.spec.ts` is in the tree and is not mine. `web/tests/e2e/inspector.spec.ts` is shared with Task 9: at commit time its diff held only my one hunk, so the pathspec commit carried nothing of theirs.
- **HEAD moved under me:** my parent is `de8dcbe` (a styleguide commit), not the brief's `b928a0b`. It touches none of my paths.
- Working-tree line endings are mixed across files (`core.autocrlf=true`); git normalises on commit and the committed diffs are minimal. Serena's symbol inserts rewrote `book-headline.ts` / `cash-summary.ts` as CRLF in the working tree only.

---

# Fix round 1

**Status:** DONE_WITH_CONCERNS
**Commit:** `3066133` on `main`, parent `6df392a` (19 paths, staged by name, by pathspec; no attribution line; hooks ran — control-plane doctor OK, scope-gate OK 19 paths). Not pushed. The two integrator files (`web/scripts/screenshot-pages.mjs`, `web/tests/e2e/screenshots.spec.ts`) and the untracked baselines were not touched or staged.
**Gates (from `web/`, on the committed tree):** `npx tsc --noEmit` clean · `npx eslint app lib components tests` clean · `npx playwright test --project=unit` 923 passed · no CSS moved. No `next build`, :3111 untouched, no `--update-snapshots`, no prettier. **E2E pins written, not run.**

## I1 — a band unread so far is a dash under the walk's own sentence

- **Who decides — the lib.** `bandsSoFar(summary)` in `web/lib/cash-summary.ts` returns each band as `{id, label, count: number | null, debt: bigint | null}`. Settled: every band is the book's, zeros included. Unsettled (running or stopped): `debt` is null unless positive, `count` is null unless positive.
- **`BookSurface.tsx`** maps `bandsSoFar(summary)` instead of `summary.bands` (one line + the import).
- **`components/kit/BandBars.tsx`** — `Band.count: number | null`. A null count never reaches `readWirePopulation` (every non-null count still does), weighs nothing, prints no `· N`, and sets no `data-count`. `Band.value: null` already printed "—". With `weightedBy="count"` a null count prints "—" — unreachable from `BookLegacy`, whose counts are never null; its rendering is unchanged.
- **Settled rendering is unchanged**: `bandsSoFar` is the identity on a settled summary, so the demo Book's bars are the same DOM. The pixel pin is the check; I did not run it.
- **Pins.** Unit `cash-summary.spec.ts` "the distance chart's bars keep the card's own law …" (mid-walk zero → null/null in both registers; complete walk zero → `0`/`0n`; positive mid-walk → its figure; no page landed → all seven unknown). **Seen failing first as a load failure** (the export did not exist). E2E (unrun), all in `book.spec.ts`: the pending-walk and census-stop pins are WIDENED to `not.toContainText("$0")` outright and now assert each bar — "—", no `<small>`, zero-height `<i>`, no `[data-count]`; the census-stop pin also asserts the read band stands as "$4,200 · 1"; the held-page-two pin asserts `not "$0"` mid-walk; and a new test "a complete walk prints its empty bands as zeros — the dash is the unfinished walk's alone" asserts "$0 · 0" and `data-count="0"` on the six empty bands of the settled committed page. These fail by assertion on `646aee9` (it printed "$0 · 0" on every unread bar).
- **One judgement beyond the ruling's letter:** a band with accounts read but no debt between them (count > 0, debt 0) prints "— · N", not "—" alone: the count is a positive read and stays; the dollars are still not a claimed zero. Unreachable in the fixtures; pinned in the unit spec.

## I2 — the lab's stress chip discloses a repaired lookup

- **One author.** `stressBatchNote` (`web/lib/inspector-view.ts`) now returns a named `StressBatchNote` with a third field, `chipValue` — the stress batch as a chip prints it beside its own label ("18,251", or "18,251 · stress from the previous lookup"). `rowLabel` is now literally `batch ${chipValue}`, so the phrase exists once.
- **`web/lib/lab-address.ts`** — `AddressWorkspace.stressBatchChip: string | null` (the note's `chipValue`, present exactly when the chip showed before: both batches readable and different). On that arm the emphasis is unchanged; the dek is the note's `disclosure` when `view.stressFromPreviousLookup`, and the old sentence byte-for-byte otherwise.
- **`web/app/lab/AddressWorkspace.tsx`** — the chip prints `space.stressBatchChip` (one line); the component composes nothing new.
- **`lookupRepaired` is REQUIRED** on `AddressReading` (`web/lib/address-lookup.ts`); `deriveInspectorView` reads it as a boolean. The two spec literals took the field: `tests/unit/lab-address.spec.ts` and `tests/unit/inspector-view.spec.ts` (`lookupRepaired: false` in each `reading()` helper); the `undefined` arm of my round-0 pin is gone.
- **Pins.** Unit `lab-address.spec.ts` "a repaired lookup beside the stress it kept …" (repaired + old stress → chip "18,251 · stress from the previous lookup", dek === the Inspector note's `disclosure`, `rowLabel === "batch " + chipValue`; same skew unrepaired → chip "18,251" and the old dek; fresh pair and a same-batch repair → no chip, tiles compare). The existing `inspector-view.spec.ts` note pins gained `chipValue`. **Seen failing first by assertion** (three tests red: the two note pins on the missing `chipValue`, the lab pin on the missing chip). E2E (unrun): **a resume CAN be driven in the lab** — it mounts the same `useAddressLookup`, whose `useAnchoredAgeSeconds` repair answers `pageshow` — so `lab.spec.ts` has "one-address mode, resume: a repair that moves the position replays no stress …", the twin of the Inspector pin (chip, headline, dek, row count, and the premise: no stress request across the repair).

## I3 — a withheld Cash census is named on the pipeline and never zero

**What the contract says (read first).** `api/openapi.yaml` `Aggregate` (the book's engine card, `:2452-2505`): `positions`, `computed_positions`, `refused_positions` are REQUIRED, non-nullable integers; `refused` is "True when this ENGINE's whole book is withheld, **whatever the position counts say**"; `refusal` is a nullable `EngineRefusal` (`engine`, `code`, `detail`, `note`); `total_collateral` / `total_debt` are "NULL on a refused engine, never '0'". `BookResponse.refused_engines` repeats the refusal at the head "so a consumer that reads only the head … cannot conclude the book is whole". The contract's withheld example (`tests/fixtures/book-engine-refused.json`, the Aave arm) carries `positions: 0, computed_positions: 0, refused_positions: 0`. The handler (`cmd/api/handlers.go:331-361`, read only) copies the persisted aggregate's counts verbatim onto the card and, when `a.RefusalCode != ""`, sets `Refused`, fills `Refusal` with the code/detail/note, and leaves both totals nil — its own comment: "the persisted sums are zero because a refusal is the absence of a number". So a whole-engine-withheld `debt_manager` card carries: `refused: true`, its `refusal` with the wire's code, null totals, and integer counts that are placeholders (0 in the contract's example) — never a census.

- **One function, by construction.** `cashCensus(reading)` (`web/lib/verification-view.ts`) returns `{kind:"count", accounts}` | `{kind:"refused", reason:"withheld"|"missing", code, cause}` | `null` (book unanswered/unread). Withheld = named in `refused_engines` OR the card's `refused` flag (the head's entry wins; `cause` is `plainCause(code, detail)`, `code` is the wire's or null); an engine the book does not list is `missing`. A withheld card's count is never read — not even by the guard.
- **`pipelineSteps(meta, evidence, reading)` reads the census itself**; the fourth parameter is gone, so neither page can hand the step another count. The compute step under a refused census: value = the batch, sub = "batch · Cash accounts withheld" (or "batch · Cash engine not in this batch"), tone `refused`, sentence "Batch N computed at T; the Cash book is withheld this batch (cause)." The served arm's bytes are unchanged ("batch · 2 Cash accounts", neutral), so the Overview's happy path and `/proof`'s are byte-identical. The old "unavailable Cash accounts" arm is unreachable under one reader and was removed with its pin.
- **Call sites:** `VerificationInput.cashAccounts` removed (`VerificationSurface.tsx` no longer imports `cashCensus`); `app/overview/Pipeline.tsx` drops its `cashAccounts` prop and `OverviewSurface.tsx:190` stops passing `view.positions`. `Pipeline`'s `reading` prop is unchanged.
- **Pins.** Unit `verification-view.spec.ts` "a withheld Cash engine's census is a refusal, never its card's placeholder count …" (the contract's zero-count card, a count left standing, head-only naming, a flag with no refusal, a guard-refusable placeholder that must not throw, the missing engine, and the step's value/sub/tone/sentence/line for each; plus the served bytes). **Seen failing first by assertion** (`cashCensus` returned `2`; the step printed neutral). E2E (unrun): `verification.spec.ts` "a withheld Cash engine: the compute step prints the batch and names the census withheld, in the refused tone …" and ONE test in `overview.spec.ts` "a withheld Cash engine: the pipeline's compute step prints the batch and names the census withheld …" — both use the Book spec's withheld shape with the contract's zero counts, and both assert `not "0 Cash accounts"`.

## Minors

- **Taken:** M2 (`lookupRepaired` required) — by I2's ruling.
- **Left, none being a one-line fix inside my files:**
  - M1 — `emptyGrid` ahead of the waterfall's own `excluded_engines` check. The honest home is `stressPreview` (`lib/stress-preview.ts`, not opened to me); doing it from `cash-view.ts` means copying that check.
  - M3 — three copies of the near-cap band set, and two derivations of "within 10%" on one page.
  - M4 — `bookFailed` duplicates the hook's failure mapping; the fix is in `cash-book.tsx`, not open this round. **I3 adds one more of the same kind:** `cashCensus` re-states `cash-book.tsx`'s private `wholeRefusal` rule (head entry, else the card's flag) because a pure lib cannot import the hook file. One pure home for both would close M4 and this together.
  - M5 — the hook half of item 5 still has no unit seam (the ride-an-in-flight-load arm is unpinned).
  - M6 — the stale comment at `app/proof/page.tsx:9`; outside my list.
  - M7 — the zero-arm sentence ("— within 10% of the cap: a zero is claimed only by a complete walk · …, figures are a lower bound"). Copy only, but it is pinned verbatim in one unit and two e2e tests that just ran green; not a one-line change.
  - M8 — `BookSurface.tsx` still composes "Material first, then by room" + the lib's qualifier.
  - M9 — the over-delivery residues (controller's carry-forward).
- **Same family as I3, not ruled, not touched:** the Book's `SectionHead` prints "0 borrowing accounts" under a withheld Cash engine (`BookSurface.tsx:90`, from `deriveCashView(...).positions`), and the Book's Coverage chip prints "0 / 0 computed". `cashCensus` is now the function that could answer both.

## Concerns

- The seven new or widened e2e pins of this round are unrun by me. The ones I would watch: `toHaveCSS("height", "0px")` on the bars' `<i>` (from the kit CSS — `display:block`, inline `height: 0px`, no min-height — not from a browser); and the lab resume pin's `expect.poll(() => repairs).toBe(1)`, which assumes the lab's other resume listeners ask nothing of `/v1/address/*`.
- I3 changed `pipelineSteps`' signature and removed a `Pipeline` prop — wider than "the function returns a refused census", but it is what makes one reader a fact rather than a convention. The Overview's rendering on a served engine is byte-identical by construction; its pixel pin is the check.
- The tree gained two files that are not mine while I worked (`web/tests/fixtures/demo/index.ts` modified, `web/tests/unit/lab-run-book-seal.spec.ts` untracked); neither is in my commit.
