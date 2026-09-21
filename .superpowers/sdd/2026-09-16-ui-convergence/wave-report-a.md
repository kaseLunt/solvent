# Task 12 fix wave — Area A (the lab, the Drawer)

**Status:** DONE_WITH_CONCERNS
**Commit:** `9a9874a` — `fix(web): close-out - a drawer holds focus from its first key, a selection names itself in the URL, the lab judges every member it prints, one rule holds and releases a result` (28 files, all inside Area A; staged by name, committed by pathspec; `scope_gate.py` OK 28 paths; hooks green; no `--no-verify`; no attribution line; not pushed).
**Gates (from `web/`, at commit time):** `npx tsc --noEmit` exit 0 · `npx eslint app lib components tests` exit 0 · `npm run lint:css` exit 0 (CSS moved) · `npx playwright test --project=unit` **1024 passed, 0 failed** (the lab's own specs: 165 passed; +7 tests, none deleted). E2E was NOT run (the :3111 build predates the edits); `next build` not run; nothing on :3111 touched; no `--update-snapshots`; no prettier.
Mid-wave, other areas' files failed and cleared on re-run — named under "Other areas" below.

## Per item

### 1 · W-drawer-shift-tab — `web/components/Drawer.tsx`, `web/tests/e2e/keyboard.spec.ts`
- **Change (key handling only).** The Tab handler decides against the panel's list of stops (`stopsOf`) and asks where `document.activeElement` stands in it. `-1` is OUTSIDE the cycle — the panel itself (where focus rests on open, and where a click on the panel's text puts it) or anything else that is not a stop: Shift+Tab enters at the LAST stop, Tab at the FIRST. On the first stop Shift+Tab wraps to the last; on the last, Tab wraps to the first (as before). Between two stops the browser's own order stands (no `preventDefault`). With no stop at all, Tab moves nothing (it used to fall through to the page).
- Because "not a stop → wrap" makes the handler depend on its stop list agreeing with the browser, the list is made accurate: `details > summary:first-of-type` joins the selector and a control the page does not render (`checkVisibility()`, falling back to client rects) is no stop. No drawer holds a fold today, so the seven drawers' stop lists are exactly HEAD's.
- **Closed DOM / open appearance:** `if (!open) return null` and the JSX are untouched; no CSS touched.
- **Pin:** the seven `test.fail()` cases are now ordinary tests (the one source line and its comment deleted — it sat in the `for (const drawer of DRAWERS)` loop). Strengthened: the first Shift+Tab must land on a STOP (`at >= 0`, not the panel), and Tab then Shift+Tab must come back to that same stop. They fail on the parent by the keyboard report's own observation (`test.fail()` passed there = the body failed). **Not run by me.**
- **Key paths reasoned through (not executed):** (a) open → panel focused → Shift+Tab → `at = -1` → last stop; (b) open → Tab → `at = -1` → first stop (the close button — the same element the browser's default reached at HEAD, so Test A's forward lap is unchanged); (c) first stop + Shift+Tab → last; (d) last stop + Tab → first; (e) middle stop, either key → browser default, inside the panel; (f) single-stop drawers (History, Activity, API, Scenarios, Verification's default): every Tab / Shift+Tab lands on the close button; (g) a click on the panel's text then either key → same as (a)/(b); (h) Escape unchanged.
- **NOT covered:** focus OUTSIDE the panel altogether while it is open (e.g. on `<body>` after a focused control is removed). The handler is the panel's `onKeyDown`, so it never sees that key — true at HEAD too, and no drawer removes a focused control today.

### 2 · W-lab-url — `web/app/lab/LabSurface.tsx`
- Selecting a row writes `?scenario=<id>` with `window.history.replaceState` (the page's `replaceUrl`), in both modes; `address` is kept.
- **Two consequences I had to decide, both from the deep-link law ("both params together run nothing"):** (i) the selection DELETES `scenarios` from the URL — a page that wrote `?scenario=x&scenarios=a,b` would be writing the link the law calls "a link nobody wrote"; (ii) the deep-link decision (the dispatch AND the notice) is now read from the link the page was OPENED with, captured once at mount (`inbound`), not from live params — otherwise the page's own write re-decides the link: on a `?scenarios=a,ghost` page a selection would have erased the notice that explains why the comparison shows one row. `selectedId` and the pre-ticks were already read once at mount; this makes the decision agree with them.
- The pinned deep link `/lab?scenario=eth_minus_30` renders as before: nothing is written without a selection (pinned: `new URL(page.url()).search === "?scenario=eth_minus_30"` after load).
- **Pin (e2e, new test in `lab.spec.ts`, not run):** select → URL names it, nothing runs; reload → same subject (row selected, kicker, Run label), and the link runs it as any `?scenario=` link does; one-address mode → `?address=…&scenario=…`, reload → same account under that scenario; a `?scenarios=…,ghost` page → the selection takes the set's place in the URL, the "ghost" notice stands, no "mutually exclusive" notice appears. Fails on the parent at the first `toHaveURL`.
- Behaviour to know: a reload of a selected-but-not-run scenario RUNS it (that is what `?scenario=` means). Ticks are still not in the URL (not in the ruling).

### 3 · W-lab-run-disabled — `web/lib/lab-view.ts`, `web/app/lab/lab.module.css`
- **Finding vs the ruling's words:** Run was ALREADY `disabled` while the listing is unavailable at HEAD (`definition === null`; pinned at `lab.spec.ts` "a listing that cannot be fetched…"). Two real defects sat beside it:
  1. **A live Compare.** `deriveLabView` returned `checked: [...ui.checked]` in the loading and unavailable arms, so a `?scenarios=a,b` link enabled "Compare 2 scenarios" beside "Nothing can run" — and a click dispatched ids no listing had filtered. Now both arms return `checked: []`: the listing names the ticks that count. **Unit pin** (`lab-view.spec.ts`, new) — saw it fail first (`["eth_minus_30","ethfi_minus_50","ghost"]` vs `[]`).
  2. **The look.** No stylesheet in the app has a `:disabled` rule, so a disabled primary button is as bright as a live one — that is what the persona saw. Page-local rule in `lab.module.css`, scoped to `data-state="listing-loading" | "listing-unavailable"` so the pinned Scenarios rendering (whose disabled "Compare…" is in the viewport) does not move: `opacity: 0.45; cursor: not-allowed`. **E2E pin** (extended, not run): both controls disabled, `cursor: not-allowed`, `opacity: 0.45`; and the `?scenarios=` leg — Compare disabled, reads "Compare…", no compare card, 0 runs / 0 sets.
- **Concern:** a kit-wide `.btn:disabled` register is the right home; `components/kit/kit.module.css` is not mine, and an unscoped rule would move the Scenarios pixel pin. Left for the owner.

### 4 · W-N5 / W-N6 / W-N7 — `web/lib/lab-classify.ts`
Checked in `api/openapi.yaml` first:
| Member | Schema | Judged as |
|---|---|---|
| `hf_transitions.lanes[i].label` | `RunBookTransitionLane` `required`, `type: string`, not nullable | a string (empty admitted) |
| `movers[i].became_eligible` | `RunBookMover` `required`, `type: boolean`, `nullable: true` | `true` / `false` / `null`; ABSENT, a string, a number, an object are named — never "No", never "Yes" |
| `movers_note` | `RunBookEngine` `required`, `type: string`, not nullable | a string (empty admitted) |
Named per index in wire read order (`…lanes[i].label` between `index` and `upper_wad`; `became_eligible` between the ratio wads and `debt_usd`; `movers_note` after `movers_total`). All 15 run-book fixtures still classify clean (swept through `runBookScenario` → `answerFault`).
- **Pins:** three new tests in `lab-classify-run-book.spec.ts` + five new rows in `lab-view.spec.ts`'s "named and never drawn" table (contradictory state, no mover row, library "Unreadable", held result stands). **All three classifier pins seen failing first.**

### 5 · W-M1 — `web/lib/lab-engine.ts`, `lab-view.ts`, `lab-library.ts`, `lab-reading.ts`
- ONE rule: `answerFault(run)` in `lab-engine.ts` (envelope → Cash refused → no Cash row → the row's classifier faults → the lane matrix against itself). `readsAsAnswer = answerFault(run) === null` — the record's hold rule. The view's release rule is now literally the same call (`bookOf`: `record.held === null || answerFault(o.response) === null`), and the view asks it FIRST: `readEngine` judges a served row before the definition's coverage, and `resultBook` / `cashOutcome` put the contradictory arm before the version skew. `readsAsAnswer`'s "where they part" paragraph is gone.
- **Behaviour change, on purpose:** a 200 that is version-skewed AND malformed in Cash is the contradictory state (fault named), not "definition changed"; beside a definition that does not model Cash, a malformed stray Cash row is contradictory, not "not modelled". Over a held result the hold STANDS from the moment the bad body settles, so a later failed re-run shows the same figures the page never withdrew. A clean version-skewed body is still "definition changed" and releases; a clean stray row is still "not modelled".
- **Pin:** the two corner pins re-pointed into one test whose title states the consequence (`lab-view.spec.ts`), plus a loop: over 8 bodies × 2 listings, `banner === "rerun-failed"` ⇔ `!readsAsAnswer(body)`. **Seen failing first** (`"definition-changed"` vs `"result"`).

### 6 · W-N3 — `web/lib/lab-classify.ts`
A horizon is sealed only when it carries one of the three verdicts AND no longer carries the wire's `becomes_liquidatable` (the client's seal removes it — `refineProjectionHorizon`). A stray wire member named `liquidation_verdict` beside an unsealed verdict seals nothing. **Pin** (new test) — **seen failing first**.

### 7 · W-lab-nobatch — `web/lib/lab-address.ts`, `web/app/lab/AddressWorkspace.tsx`
- The tiles compare only when BOTH batches are readable and the same. Otherwise: chip = the Inspector note's `chipValue` ("not readable", or "not readable · stress from the previous lookup"), tiles `null`, rows kept, headline "Cannot say — the stress result names no readable batch; the position above is batch 18,251.", dek the note's disclosure after a repair, else one plain sentence. The two-batch arm's words are byte-identical to before.
- The section qualifier moved from the component into the lib (`space.qualifier`) — it needed a no-batch arm, and the component was composing it (with a `?? 0` batch fallback).
- **Pins:** unit (new test, **seen failing first**: chip `null` vs `"not readable"`) + e2e (new test, not run).

### 8 · W-pin — `web/tests/unit/lab-address.spec.ts`, `lab-address.ts`, `AddressWorkspace.tsx`
The two source-text lines (and the file's `readFileSync` imports) are gone. The view model now hands the table its rows WITH their verdict words (`space.table: { row, verdict }[]`, `verdict = stressVerdictWords(rowVerdict(row))`), the component prints `verdict` and imports no word function. Runtime pin: for five shared demo bodies (served, a flipping projection, an unknowable horizon, a withheld side, an inapplicable row), `space.table.map(t => t.row)` equals `space.rows` and every `verdict` equals `stressVerdictWords(rowVerdict(row))`. **Seen failing first** (`space.table` undefined). `address-stress.ts` and `StressTable.tsx` imported from, not edited.

### 9 · Whole-branch Minors
- **M2 `liquidationEstablished` — NOT in my files:** it lives in `web/lib/feed-view.ts` with its pin in `tests/unit/feed-view.spec.ts` (Area C's globs). Untouched.
- **M3 `?? "bad_request"` — not in my files** (grep: none under Area A). M3(a) `retry` (`lab-headline.ts`) = `retryWords` (`verification-view.ts`, Area D's): one copy each side of an ownership line; left.
- **"Nothing was sent" said once:** the three local-refusal messages (`runbook.ts`, `runbookSet.ts` ×2) are the reason alone; the headline says nothing was sent. **Pin** (new test in `lab-run-book-seal.spec.ts`, through both dispatchers and `failureHeadline`, every arm): exactly one "nothing was sent". **Seen failing first** (2 matches). `tests/unit/set-run-outcome.spec.ts:196-203` (not mine) feeds `failureHeadline` its own literal message and still passes.
- **M4 / M5 comments:** every comment in Area A naming a plan ruling, task, round, review or the file's history reworded to the law it keeps (`(plan R2/R3/R4/R5/R8/R10/R11/R15/R16)`, `p1b-N`, `p0-N`, `Codex r…`, "Task 1's review", "moved verbatim from the old Lab", `runbook.ts`'s "CORRECTED at…/NOT this wave's work" preamble, the Drawer's "were dead code"). The `p1b-N: ` prefixes came off 39 test TITLES in the two classifier specs (no duplicate titles result; no snapshot is named by them).

## Pixel-pinned renderings moved
**None intended.** Scenarios (`/lab?scenario=eth_minus_30`, result state): no markup or style reachable in that state changed (the new CSS is scoped to the two listing states; the demo run-book classifies clean under the new checks). Drawer closed DOM unchanged on all seven pages.

## Lines broken in specs I do not own
None found (`screenshots`, `state-matrix`, `shell`, `p1a/p1b/r1-fixes`, `set-run-outcome` grepped for every string I changed).

## Test ids / `data-*` added, renamed, retired
None. New view-model fields (not DOM): `AddressWorkspace.table`, `AddressWorkspace.qualifier`; new exports `answerFault`, `RowFault` (`lab-engine.ts`), `AddressTableRow` (`lab-address.ts`).

## Other areas — seen mid-wave, not fixed
- Transient, cleared by the final run: `tests/unit/address-stress.spec.ts` imported `projectionWords` before `lib/address-stress.ts` exported it (B); `tests/unit/kit.spec.ts` ↔ `lib/kit.ts` `VERDICT_IDENTITY_ORDER` (D); `activity-view.spec.ts` ×2 and `ActivitySurface.tsx` / `feed-view.spec.ts` tsc errors on `ActivityInput.loading` / `plural` (C).
- **Cross-area follow-up (B's W-M2, the lab half):** B is adding `view.scaleAbsence` and an optional third argument to `sideRoomWords` / a new `projectionWords`. The lab's one-address table (`AddressWorkspace.tsx`) still calls `sideRoomWords(side, space.decimals)` and composes the projection cell itself, so where the lookup holds no Cash position its cells still say "unreadable scale". I did not wire it: my commit must type-check on its own and B's exports were uncommitted. Once B lands: carry `scaleAbsence` on `AddressWorkspace` (beside `decimals`) and pass it to both calls — about five lines in my two files.

## Concerns
1. Nothing e2e was executed: the seven un-failed keyboard tests, the three new `lab.spec.ts` tests and the extended listing-unavailable test are reasoned, not run.
2. W-lab-url's two decisions (drop `scenarios` on select; decide the inbound link once) go beyond the ruling's sentence — they are what keeps the page from writing a "conflict" link and from erasing a standing notice. Flagged for a ruling if the owner wants ticks in the URL instead.
3. W-lab-run-disabled: the disabled LOOK is page-local and state-scoped; the kit has no `:disabled` register.
4. `MoversTable.tsx` still words its verdict cell in the component ("Cannot say" / "Yes" / "No"); the classifier now guarantees the value is `true | false | null` before the table exists, so the law holds, but the copy is not in the lib. Not in this wave's items; left.
