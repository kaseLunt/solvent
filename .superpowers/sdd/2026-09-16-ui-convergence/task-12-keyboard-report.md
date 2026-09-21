# Task 12 Step 3 — keyboard operability pins

**Status:** DONE_WITH_CONCERNS (one keyboard defect, present on all seven drawer pages, pinned as expected-failures)
**Commit:** `5840b57` — `web/tests/e2e/keyboard.spec.ts` (new, 464 lines; the only file touched)
**Run:** `npx playwright test tests/e2e/keyboard.spec.ts --project=e2e --reporter=list` against the running :3111 build → **22 passed** = 15 passing pins + 7 `test.fail()` expected-failures. `--repeat-each=3` → 66 passed, no flake.
**Gates:** `npx tsc --noEmit` exit 0; `npx eslint tests/e2e/keyboard.spec.ts` exit 0; `scope_gate.py` OK (1 path); commit hooks green; no `--no-verify`, no attribution lines, not pushed.

Fixtures and mocks: `mockDemo` copied from `screenshots.spec.ts` (`/v1/events` routed by `account`, `/v1/observatory/series` by `engine`), plus a counted `/v1/scenarios/run-book-set` route (OPTIONS preflight answered, never counted) so a stray set dispatch is counted and never reaches a live API. 1440x900, `waitUntil: "networkidle"`, each page's own ready condition.

## What is pinned, per page (22 tests)

### 1 · The drawer — 7 pages x 2 tests = 14 (+1 Overview)

| Page | Path | Header button (test id · label) |
|---|---|---|
| Book | `/book` | `book-methodology` · Methodology & evidence |
| Inspector | `/inspector/<DEMO_NEAR_ADDR>` | `inspector-drawer` · **Inputs · Calculation · Provenance** (not "Methodology & evidence") |
| Scenarios | `/lab?scenario=eth_minus_30` | `lab-drawer` · Assumptions · Out of model |
| History | `/observatory` | `history-drawer` · Methodology & evidence |
| Activity | `/feed` | `activity-drawer` · Methodology & evidence |
| Verification | `/proof` | `verification-drawer` · Methodology & evidence |
| API | `/developers` | `api-drawer` · Methodology & evidence |
| Overview | `/` | none — the page has no drawer and no header action (pinned: no such button, no dialog) |

Test A per page (all 7 PASS) — "the drawer takes focus on Enter, Tab and Shift+Tab cycle inside it, Escape closes it and hands focus back to its button":
- the button's label; `button.focus()` → `toBeFocused` → `Enter` → `role=dialog` visible (no pointer involved);
- the opener no longer holds focus, and `document.activeElement` is the dialog or a descendant (`dialog.contains(activeElement)` evaluated in the page — cannot match the page behind; no dialog → false);
- forward: `candidates + 1` Tabs (one more than the dialog could have stops), every press asserted inside; the first stop must recur (the wrap past the last happened); the lap is in DOM order, each stop once;
- standing on the first stop: Shift+Tab → the last stop; Tab → the first stop; then a whole lap backwards equals the forward lap reversed, every press inside;
- `Escape` → dialog count 0 and `expect(button).toBeFocused()`.

Test B per page (all 7 `test.fail()`) — "Shift+Tab as the first key in an open drawer stays inside it". See the defect below. `test.fail()` is placed AFTER the open + focus-inside assertions, so only the Shift+Tab step is the expected failure; a load or open failure still fails the test for real.

### 2 · Links / controls are Tab stops in DOM order — 4 tests (all PASS)

`walkByTab(container, selector)`: lists the rendered stops in DOM order (`checkVisibility()`), focuses the first, Shift+Tabs off it (asserted to have left the stops), then Tabs until focus leaves the container, recording every stop landed on. Asserted: walked indexes == DOM indexes AND walked hrefs == DOM hrefs — the whole list, not a first-N sample (Activity's ~100+ links walk in ~2.5 s).
- **Activity** `activity-table` `a[href]`: every account link (>= 50 `/inspector/…`), liquidator link and tx explorer link, none skipped.
- **Verification**: the probes table carries NO links or buttons (pinned as such) — so the pin is every control of `verification-surface` (`a[href], button:not([disabled]), summary`): the drawer button, both subjects' explain buttons, the visible copy chip, the two forensics summaries, the `/developers` link, the Raw JSON toggle — in DOM order; `verification-drawer` and `verification-raw` named as among the walked stops. Then each forensics `<details>` is opened with Enter on its focused summary (`open` attribute asserted) and the walk is repeated: all 13 stops, the five folded copy chips now included, in DOM order.
- **API** `api-toc` `a[href]`: one anchor per endpoint card (count equals `api-endpoint-*` cards), each `#operationId`, all in DOM order.
- **Book** `book-attention` `a[href]`: one account link per row (count equals `tbody tr`), each `/inspector/0x…40`, all in DOM order.

### 3 · The Scenarios library — 3 tests (all PASS)
- every row's tick and row button are Tab stops — tick then row, row after row, in the listing's order (8 stops for the 4 demo scenarios; stop 2i is `lab-library-check-<id_i>`);
- Space: Tab from `lab-mode-address` to the `eth_minus_30` box → Space → checked, Compare still `Compare…` disabled (one tick compares nothing); Tab on to `ethfi_minus_50` → Space → checked, Compare `Compare 2 scenarios` enabled; Space again → unchecked, Compare back to `Compare…` disabled; set-run count 0; the selection did not move;
- Enter: Tab to `ethfi_minus_50`'s row button → Enter → that row `data-selected="true"` / `aria-pressed="true"`, `eth_minus_30` loses both, surface `data-state="not-run"`, the headline names "ETHFI -50 percent" and differs from before, `lab-run` reads `Run ETHFI -50 percent`, focus stays on the pressed button, set-run count 0.

## `test.fail()` cases — one defect, seven pages

**Defect: Shift+Tab pressed first in an open drawer walks focus out of the modal onto the page behind.**
Observed landing per page: Book → the `Legacy · Aave v3 market` fold's `<summary>`; Inspector → the `Open Scenarios →` link; Scenarios → the `Legacy · Aave v3 market result` `<summary>`; History, Activity, API → the opener button itself (the Drawer is rendered as the button's next sibling); Verification → the `Raw JSON` button. From there the user is tabbing the page behind an `aria-modal` dialog with the body scroll-locked.

**Responsible:** `web/components/Drawer.tsx` (the kit re-exports it — `components/kit/index.ts:16`; there is no `components/kit/Drawer.tsx`).
- `:61` `panelRef.current?.focus()` rests focus on the PANEL (`tabIndex={-1}`, `:117`), not on a stop inside it;
- `:94` `if (event.shiftKey && document.activeElement === first)` — the wrap only fires when the active element is the first focusable. With the panel itself active the condition is false, nothing is prevented, and the browser's default Shift+Tab moves to the previous tabbable in the document, which is outside the dialog. (Forward Tab from the panel is fine: the next tabbable is the close button, inside.)
- Likely fix (not applied — pinning task): treat `document.activeElement === panel` as "before the first" in the Shift+Tab branch (`last.focus()`), or focus the first stop on open. When fixed, the seven tests will report "expected to fail, but passed" — delete the `test.fail()` line and its comment.

## Deviations from the brief / notes for the integrator
1. **The URL's `?scenario=` is NOT asserted on Enter** — selecting a row never writes the URL, for the pointer as for the keyboard: `app/lab/LabSurface.tsx:216` `onSelect={setSelectedId}`; `replaceUrl` is called only by the mode toggle and the address field, and the Scenarios contract (R7) names `?scenario=` as an inbound deep link only. Not a keyboard defect, so no `test.fail()` was invented for it; the selection is pinned by `data-selected`/`aria-pressed` and the surface's subject instead. Product observation for a ruling: after selecting another scenario the address bar still says `?scenario=eth_minus_30`, so a reload or a shared link shows a different scenario from the one on screen.
2. The Inspector's drawer button reads "Inputs · Calculation · Provenance", not "Methodology & evidence" (pinned as it is).
3. Verification has no row links in any table; the pin generalises to the surface's controls and adds the folds-open-by-Enter walk.
4. Buttons inside a closed `<details>` still report client rects in Chromium (content-visibility), so rendered-ness is decided by `checkVisibility()`.
5. Pre-existing, not mine: `.superpowers/sdd/.gitignore` was already modified at the start of the task; left untouched and uncommitted.
