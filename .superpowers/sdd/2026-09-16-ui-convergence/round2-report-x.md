# Round 2 · Area X — the Book · report

Commit `1c7ab68` on `main` (parent `c192523`), 17 paths, all inside Area X's ownership, staged by name, committed by
pathspec, `scope_gate.py` OK, hooks passed, no attribution line, not pushed.

Gates (from `web/`): `npx eslint app lib components tests` clean; `npx playwright test --project=unit` **1077 passed**
(baseline at the start of my work 1031; +28 of those are mine: 20 in the five re-pointed specs, 8 in the new
`book-walk.spec.ts`; the rest are the other areas'); `npx tsc --noEmit` clean in every file of mine — the only errors left are Area Y's, mid-edit and
persisting after a re-run: `tests/unit/lab-address.spec.ts(557,44|58|69)` (`StressReading` no longer has `rows`). No CSS
moved. No `next build`, nothing touched on :3111, no `--update-snapshots`, no prettier. The six new e2e pins are
WRITTEN and NOT RUN (the integrator's build).

## Per item

### 1 · Codex #2 — a page that cannot be read ends the walk by name
- **What changed.** The fulfilment callback of the walk no longer reads the page at all. New pure `lib/book-walk.ts`
  `walkStep(page: unknown, expectation, tally)` judges the fetched body whole and cannot throw (the decode sits in its
  own catch; everything after it runs on validated rows). `readCashPage` now takes `unknown`, judges the body is an
  object, then `batch` is an object, then `batch.id` is a wire population, BEFORE anything else — and reports a page of
  another batch as `{ kind: "other-batch", batchId }` (the hook still owns the one reload). The refusal's
  `code`/`detail` are read through guards, and the cursor is carried in the reading (`next`) so the hook's old
  `page.next_cursor` dereference after the decode is gone too. Every dereference between the fetch resolving and the
  decode that I found: `page.batch.id` (three reads), `page.engine`, `page.refusal?.code`, `page.next_cursor` — all now
  inside the judged path. Sibling paths: see item 2 (`loadBook` serves the first load, the resume repair, the 409
  restart and `reload()`; it is one function).
- **Pins.** `cash-rows.spec` "the page's own batch is judged inside the reading…" (ten batch shapes, five non-object
  bodies, the moved batch); `book-walk.spec` "a page that cannot be read ends the walk BY NAME…" (incl. a getter that
  throws mid-decode); e2e "a positions page with no batch ends the walk BY NAME…" (failure named, no Retry, headline
  refused, nothing `aria-busy`, no `Cannot read properties of null` page error).
- **Failed first?** YES, seen: on the untouched code `readCashPage({ …, batch: null, positions: [] })` returned
  `kind: "rows"` where the pin expects `"malformed"` (run from a throwaway spec before any lib edit).

### 2 · Codex #1 (the repair half, and the first answer)
- **What changed.** `lib/cash-refusal.ts`: `bookEnvelopeFault(body)` names the first fault of the envelope — body an
  object, `batch` an object, `batch.id` a wire population, `served_at` a string, `hf_histogram` / `coverage` objects,
  `waterfall` null-or-object, and `engines`, `refused_engines`, `bad_debt`, `hf_histogram.engines`,
  `coverage.excluded` lists of objects (everything the hook and both pages dereference before a figure; the figures
  stay the views' guards). `bookAnswered(previous, body, keepStanding)` / `bookFailed(…)` are the hook's state
  transitions, pure: a readable answer replaces the book and clears the fault; an unreadable REPAIR
  (`keepOnFailure`) leaves the readable book standing with `repairFault` named; an unreadable FIRST answer (or explicit
  reload / 409 restart — same switch a fetch failure already used) is `{ phase: "error", unreadable: true }`. The
  repair resolves `false`, so the age hook's bounded retry schedule sees a failed repair, not a receipt.
- **Says so.** `CashBookReading.repairFault` → a fifth identity chip on BOTH pages (through `view.chips`, no Overview
  edit): `Re-read · unreadable · this batch stands`, tone `warn`, `title` = the fault.
- **"Unreadable" is its own state.** `CashAbsence.kind: "unreadable"` (`word: "unreadable"`, `line: "Unreadable."`,
  census "accounts unreadable"), headline `unreadableHeadline`: "The Cash book's answer could not be read." / "The
  service answered, and the body is not a book: <fault>.", Identity chip `unreadable`.
- **Pins.** `cash-refusal.spec` ×2 (envelope; the transitions), `cash-view.spec` ×2 (the unreadable absence; the
  standing book is otherwise byte-equal to the clean view), `cash-summary.spec` (the headline), e2e ×2 (three
  malformed first answers incl. `200 null`; the repair through a `pageshow` resume, the Inspector's pattern).
- **Failed first?** By MUTATION, seen: with `bookAnswered` reverted to "always hold the body", the transition pin fails
  (`Expected "error", Received "ok"`). The functions are new, so there was no earlier code to run them against.

### 3 · Codex #3 — a duplicate account is never counted twice
- **What changed.** `walkStep` keeps a tally across pages: census, rows delivered, pages landed, and every account
  (lower-cased) → the page that first delivered it. A row whose identity was already read is NOT landed and NOT
  counted; the page's distinct rows still land; the walk stops with the new `WalkStopKind` **`"duplicate"`** and the
  fault names the account (as the repeating page spelled it) and the pages: `account 0x… was delivered on page 1 and
  again on page 2` / `… twice on page 3` / `…, and N more repeated row(s) on that page`. The duplicate check runs
  before every census check, so no path lands a repeated row.
- **No bound.** `duplicate` joins `over` in the no-bound registers everywhere: dek ("pages that repeat an account do
  not partition the book, so no figure here is a total or a lower bound"), `walkQualifier`, `tileBoundNote`, the bars'
  note, the distance finding (never "at least").
- **A pinned rendering I moved on purpose (fault path only):** under `over` the page used to say "its rows may count an
  account twice". With identities tracked that is no longer something the system backs, so `over` now says "it landed
  more accounts than the census counts" (dek) / "…than the book counts" (bars). Re-pointed: `book-headline.spec`,
  `cash-summary.spec`, `cash-view.spec`, e2e "a walk past its census…".
- **Pins.** `book-walk.spec` ×3 (Codex's exact scenario end-to-end through `summarizeCash`: $4,200 once, 1 account,
  not settled, no bound; case-insensitive identity, lower and upper; a duplicate before completion, within one page,
  several, and outranking `over`), `book-headline.spec` (the words), `cash-summary.spec` (every register),
  `cash-view.spec`, e2e.
- **Failed first?** By MUTATION, seen: with the identity lookup disabled, all three `book-walk` duplicate pins fail
  (the walk lands A twice and completes).

### 4 · Codex #4 — an unreadable row blocks every all-clear
- **Decision (in the lib).** Its OWN named class, never the refused class: `CashRow.unreadable?: string` is set exactly
  when the wire row's `status` is `"computed"` and the page holds no verdict + figures it can read, and carries the
  members that failed in read order (`total_debt is not a wire decimal; health_factor.num …`, `health_factor is null`,
  `no liquidation verdict was served`). Optional because the styleguide builds a `CashRow` literal I may not edit.
  A verdict the engine withheld on a row it calls computed is the same class — it was the same hole (uncounted,
  `notComputed: 0`, quiet headline). Words: table pill **"Unreadable"** (`rowStandingLabel`), title "this page could not
  read the row the engine served: …" — never "refus…", never "could not be computed".
- **Counted.** `CashSummary.unreadable` (from the rows) and `CashSummary.whole` (= complete walk AND no unreadable row:
  the only state where a zero is a finding, a sum a total, a negative sayable). Dek sentence: "N position(s) the engine
  calls computed could not be read by this page and is/are counted, not cleared." (in every variant, incl. running and
  stopped walks). Sixth tile (now `view.notComputedTile`, copy moved to the lib): value = refused + unreadable, sub
  e.g. `nothing refused · 1 unreadable` (`… so far` mid-walk).
- **Every negative, walked against one unreadable computed row on a complete walk:**
  quiet emphasis "Nothing material is liquidatable…" → refused variant "The Cash book could not be fully read this
  batch." · "No position is liquidatable." / "No computed position…" → not said, "No verdict is claimed over it." ·
  "No account is within 10%…" (material AND quiet variants) → silent · "No Cash account could be computed" → not
  reachable (the engine computed it) · Liquidatable / Near tiles `$0` → `—`, tone refused, sub wears
  ` · lower bound, 1 row unreadable` · bars `$0 · 0` → dashes + "1 row could not be read: every bar…lower bound…" ·
  distance finding `$0 sits within…` → `— … a zero is claimed only over a book read whole · 1 row could not be read`
  (a positive is "at least") · table "No account needs attention." → "1 row could not be read; no account is cleared."
  · Overview entry "$0 within 10% of cap" → "1 row of the book could not be read". Beside a material finding the dek
  ends "Every figure is a lower bound over the N computed accounts this page could read."
  Left as they are with refused rows too, deliberately: the Median tile (a statistic over computed rows), the Coverage
  chip and the drawer's "None." (both are the ENGINE's own statements, and true).
- **Pins.** `cash-rows.spec` ×2, `book-headline.spec`, `cash-summary.spec` ×4, `cash-view.spec` (the tile), e2e.
- **Failed first?** YES, seen on the untouched code: `summarizeCash` over Codex's row returned "Nothing material is
  liquidatable on the Cash book right now. No position is liquidatable. No account is within 10% of its borrow cap."

### 5 · wave-review B-1, B-2, B-3
- **B-1, the drawer half — DONE.** `BookMethodology` takes `withheld` from the view (`view.withheld`) and no longer
  re-derives it from the book. Pin (e2e): positions endpoint alone refuses, the card itemises nothing → the drawer
  names the withheld book, never "None.". Fails on the old code by reading (`wholeRefusal(book)` is null there); not run.
- **B-1, the `cashCensus` half — STOPPED.** `cashCensus` is `lib/verification-view.ts` (Area W) and its caller is
  `app/overview/**`; both are outside my ownership, and `BookReading` carries no walk. Smallest fix for whoever owns
  them: let `cashCensus` take the view's `withheld` (or `reading.cash.refusedWhole`) ahead of `wholeRefusal(book, CASH)`.
- **B-2 — DONE, and its sibling.** `bookEntryLine` is `walkEntryLine(summary)`: the stop's own frame via the new
  `stopWords(kind)` ("The walk stopped before the last page" / "…reached its last page and its rows do not reconcile
  with the census" / "…ran past its census" / "…was served an account twice"). The table's empty line had the same
  retired frame ("before the book was read") — it uses `stopWords` too. Pins re-pointed + new, saw the new ones fail
  only by absence (new function).
- **B-3 — DONE.** `NO_BATCH_LOADED`, `withheldBookSentence`, `NO_REFUSALS`, `BAD_DEBT_NOT_REPORTED` live beside
  `CASH_ENGINE_MISSING`; the sixth tile's sub moved to the lib with item 4. Pinned in `cash-refusal.spec`.

## Pixel-pinned renderings
`/book` and `/` on the demo: NOT moved. Checked, not assumed — I extracted `HEAD`'s `web/lib` to a temporary folder and
compared, for the demo walk and the committed fixture, every member of `deriveCashView` / the summary / `bandsFinding`
/ `bandsSoFar` / `tileBoundNote` / `attentionFinding` / `attentionEmptyText` / `deriveLegacyView` old against new:
identical; the only differences are ADDED members (`notComputedTile`, `summary.unreadable`, `summary.whole`), and the
tile's value/sub equal what the component used to compose ("6" / "collateral sweep never ran"). Standing pins say the
same: the demo walk carries no unreadable row and is a complete, duplicate-free walk (`cash-rows.spec`,
`cash-summary.spec`, `book-walk.spec`), and the envelope admits `DEMO_BOOK`. The throwaway files are deleted.

## Contract values
**Added**
- identity chip `data-chip="Re-read"` (Book and Overview strips), value `unreadable · this batch stands`, tone `warn`,
  `title` = the fault — present only while a later `/v1/book` answer could not be read.
- identity chip `Identity` value `unreadable` (beside `pending`, `unavailable`).
- table pill text `Unreadable` (beside `Not computed`) on `book-row-<account>`.
- `book-kpi-notcomputed`: value may be refused + unreadable; sub may end ` · N unreadable` / ` · N unreadable so far`.
- tile notes ` · lower bound, N row(s) unreadable`, ` · not a bound, the walk was served an account twice`.
**Renamed / reworded (fault paths only)**
- Overview Book entry line: "Walk stopped before the book was read" → `stopWords(kind)`.
- table empty line under a stopped walk: "The walk stopped before the book was read; …" → "`stopWords(kind)`; no account is cleared."
- `over` reason: "its rows may count an account twice" → "it landed more accounts than the census/book counts".
**Retired:** none. No test id or `data-*` attribute was retired or renamed.
**Lib API:** new `lib/book-walk.ts` (`walkStep`, `WALK_START`, `WalkTally`, `WalkStep`); `readCashPage(page: unknown, …)`,
`CashPageExpectation.batchId` (required), reading kinds `other-batch` and `rows.next`; `CashRow.unreadable?`,
`unreadableRows`, `rowStandingLabel`; `WalkStopKind` + `"duplicate"`; `stopWords`, `duplicateFaultWords`,
`unreadableSentence`, `BookHeadlineInput.unreadable?`; `CashSummary.unreadable` / `.whole`, `walkEntryLine`,
`unreadableHeadline`, `bandsSoFar` now picks `whole` (was `settled`); `bookEnvelopeFault`, `bookAnswered`, `bookFailed`,
`BookState`, `BookUnreadable`; `CashBookReading.repairFault` and `failure.unreadable` (both required);
`CashView.notComputedTile`, `ViewChip.title?`, `CashAbsence.kind` + `"unreadable"`; `BookMethodologyProps.withheld`.

## Concerns
1. **Six e2e pins are unrun.** The likeliest to need a touch: the repair pin (relies on a `pageshow` resume reaching
   the Book's repair as it does the Inspector's) and the no-batch pin's `[aria-busy='true']` count of 0 (only the
   surface and its tiles set it on `/book`).
2. **The Overview's pipeline still words an unreadable book as its `error` phase** ("unavailable" / "The batch could
   not be read."): `BookReading.phase` is Area W's closed union, so I kept `phase: "error"` and carried
   `failure.unreadable` beside it. The strip above it says "unreadable"; the step does not.
3. **B-1's other half is open** (above).
4. Not mine, observed: nineteen `web/lib` files (`headroom.ts`, `wireGuard.ts`, `positions.ts`, …) show ` M` in
   `git status` with NO content difference (identical blob hash, mtime 23:37:59) — something touched them; I did not
   stage them.
