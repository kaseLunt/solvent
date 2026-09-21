# Task 12 fix wave — Area B (the Book, the Overview, the Inspector)

**Status: DONE_WITH_CONCERNS.** One commit on `main`: **736e09e** (35 paths, by pathspec, subject only, no attribution;
`scope_gate.py` OK — 35 paths; hooks passed, no `--no-verify`; not pushed). Subject verbatim, no clause dropped.

Gates (from `web/`): `npx tsc --noEmit` clean in every Area B file (the only errors seen mid-wave were in other areas'
files and cleared or moved on their own: `lib/history-view.ts` / `observatory-series`, `app/lab/AddressWorkspace.tsx`
`crossBatch`, `ActivityInput.loading`, `feed-view` `plural`, and a transient `tests/ff-head/**` copy — none mine, none
touched); `npx eslint app lib components tests` 0 errors (one warning, in the transient `tests/ff-head/lib/evidence.ts`,
not mine); `npm run lint:css` clean (CSS moved: `overview.module.css`, a comment in `inspector.module.css`);
`npx playwright test --project=unit` **1024 passed, 0 failed** (the whole list read). My specs add 14 unit tests
(`cash-refusal` 5 new, `cash-view` +2, `cash-summary` +2, `book-headline` +1, `stress-preview` +1, `trust` +1,
`address-stress` +1, `inspector-view` +1); none deleted. E2E pins written and `--list`-parsed (55 tests in my three
specs), **not run** — no build, nothing started or killed on :3111, no prettier, no `--update-snapshots`.

## Exports for Area D (`web/lib/verification-view.ts`)

From **`web/lib/cash-refusal.ts`** (new, pure, imports only `@solvent/client`):
- `wholeRefusal(book: BookResponse | null, name: string): WholeRefusal | null` — the ONE whole-refusal predicate: the
  head's `refused_engines` entry wins, else the card's `refused === true` (the boolean, not truthiness). A card with
  no refusal object yields `{ code: "", detail: "" }` (D's `cashCensus` prints `code: null` for that arm — map `"" → null`
  at the call, or keep the head-entry read; the cause words are identical through `plainCause`).
- `CASH_ENGINE_MISSING = "the Cash engine is missing from this batch"` — the one copy (`cash-view.ts` and the Book's
  drawer now read it; `verification-view.ts:96` still holds the second copy until D imports this).
- `type WholeRefusal`, and `bookLoadFailure(cause): BookLoadFailure` (`{phase:"no-batch",message,retryAfterSeconds} |
  {phase:"error",message}`) — the hook's 503-vs-failed-read mapping, now with a unit seam. `bookFailed` in
  `verification-view.ts` is still a second copy of it (Task 10 M4): it can delegate in one line. Not done — D's file.
`cash-book.tsx` re-exports `type WholeRefusal` so no importer moved.

## Per item

**1 · W-census — CLOSED.** `deriveCashView` reads none of the three counts when `withheld !== null` (`census` is null →
`positions` / `computedPositions` / `refusedPositions` null; a `-0` placeholder cannot throw the route). All five sites
follow: Book SectionHead → `view.sectionQualifier` "… · accounts withheld"; Coverage chip (both pages) → `Coverage
withheld`, refused tone; the Book "Not computed" tile VALUE → "—"; Overview strip "Accounts" → "—". A sixth site found
and closed in the same law: the Book drawer's "Refusals on this batch" printed **"None."** for a withheld card with an
empty list, and "No Cash engine on this batch." for an UNREAD book — now "The Cash engine withheld its whole book this
batch: {cause}. A withheld book itemises no refusals." / "No batch loaded." / the missing-engine sentence.
Pins: unit `cash-view.spec.ts` "a withheld Cash engine's census is never a count" (both placeholder shapes — the
contract's zeros AND served counts left standing — plus the `-0` no-throw and the served census) — **SEEN FAILING FIRST**
(`Received: 0`). Unit `cash-refusal.spec.ts` (the `=== true` law) — **seen failing under a truthiness mutation**
(restored). E2E: both fixtures RESHAPED to the contract's zeros (`book.spec.ts` withheld test, `overview.spec.ts` withheld
test) and now assert the sites (section head, Coverage chip + its refused class, the tile value with no digit, no
"0 borrowing accounts" / "0 / 0", the strip's Accounts with no digit, the drawer) — by reading they fail on 5840b57
("0 borrowing accounts", "Coverage 0 / 0 computed", "0", "Accounts 0"); unrun.
Judgement to confirm: `withheld` includes the hook's third source (the POSITIONS endpoint refusing the engine beside a
served card). Per the ruling's letter the counts are nulled there too, so the Book no longer prints "1 / 2 computed"
under "could not be computed"; the Overview's pipeline step (D's census reader, book-only) still prints the count in
that one state.
**Whole-branch M6 — LANDED, in part, with the served arm pixel-identical.** `Pipeline.tsx` now carries `data-tone={step.tone}`
and `overview.module.css` styles exactly the two tones that withdraw a claim: `refused` → the line in `--ink-2`, `warn` →
the figure in `--warn-text`. `ok` and `neutral` print in ink as before — deliberately: the demo's verify step is `ok`
(checked: demo tones are neutral / neutral / ok / neutral), so honouring `ok` as green WOULD move `overview-{dark,light}.png`.
Pin: `overview.spec.ts` withheld-pipeline test (`data-tone="refused"`, and its line's computed colour differs from a
standing step's). Note: D's `pipelineSteps` gains an optional 4th `inFlight` argument; the Overview passes none, so its
steps read "unavailable" + refused tone while meta / evidence are still in flight (the words are pre-existing; the grey
is new). Passing `inFlight` from `OverviewSurface` is a small follow-up once D's signature is in.

**2 · W-book-unavailable — CLOSED.** `CashView.absence: { kind: "loading" | "unavailable" | "not-computed", word, line } | null`
is decided in `deriveCashView` (in flight → failed → withheld → engine missing) and the component prints it: a fetch
failure / 503 / a book that does not list the engine say **"unavailable" / "Unavailable."**; a withheld engine still
says **"not computed" / "Not computed."**; a read in flight says **"loading…" / "Loading…"** (before: "not computed" ×10
in all three — the component's "Loading…" arm was unreachable). `refusedTiles` is now exactly `absence !== null`. Also:
the bad-debt card said "Loading…" for a SERVED book with no bad-debt row → "Not reported.". The "Legacy Aave v3 market ↓"
anchor renders only when the legacy block does. The Overview's strip was checked: it never said "not computed" (bare
dashes, `Identity unavailable`) — pinned so it stays that way.
Pins: unit `cash-view.spec.ts` "why the figures are absent is decided here" — **SEEN FAILING FIRST** (`Received:
undefined`). E2E: the 503 pin RE-POINTED (`book.spec.ts` — was `toContainText("not computed")`, now "unavailable" and
NOT "not computed"); new "a fetch failure is an unread book" (six tiles, the card, no table, no legacy block, no anchor);
new "a read in flight has not failed"; the served test pins the anchor's presence. Unrun.

**3 · W-trust-claim — CLOSED; the Inspector's pinned viewport MOVES (ruled).** The reconcile summary DOES carry an
instant: `ReconcileSummary.finished_at` (`api/openapi.yaml:5842`, required, date-time; fixture `2026-07-29T02:14:07Z`).
- OLD: label **"Book reconciles to chain"**, detail **"29/29 Cash rows exact · committed receipt"**.
- NEW (ok arm): label **"Pinned reconcile run matched the chain"**, detail **"29/29 Cash rows · Jul 29, 02:14 UTC"**
  (`humanUtc(finished_at, evidence.served_at)`, U+00A0-joined; the year prints when it is not the envelope's, or when no
  envelope is handed over). No weld → "87/87 rows · …". A receipt with no readable instant names NO date (null / number /
  blank → "29/29 Cash rows"); a malformed instant string prints verbatim (`humanUtc`'s law).
- Every other arm keeps its detail and state byte-for-byte and is labelled **"Pinned reconcile run"** — a drifted,
  failed, empty, contradictory or absent receipt never sits under the word "matched". Tone, tick, title, test id and
  item id unchanged. `TrustInput.evidenceServedAt?` is optional on purpose: absence prints MORE (the year), never less.
- Height: measured in a headless harness of the kit's own `.check` rules at the card's 363px with the system font: the
  item is **58.375px before and after** (two lines each side, in every ok form); nothing below it moves.
- **Pixel pins that move: `inspector-dark.png`, `inspector-light.png` — the words inside the Trust card's fifth item
  only.** For the integrator to replay and re-baseline.
Pins: unit `trust.spec.ts` (three tests) — **SEEN FAILING FIRST**; E2E `inspector.spec.ts` re-pointed (label, detail,
`data-state="ok"`, not "reconciles", not "Book"). Unrun.

**4 · W-M2 — CLOSED for the lib and the Inspector; the LAB half STOPPED (Area A's files).** `InspectorView.scaleAbsence:
"unreadable" | "no-position" | "withheld" | "no-lookup" | null`; `scaleAbsenceWords`, `sideRoomWords(side, decimals,
absence = null)` and new `projectionWords(horizons, decimals, absence = null)` in `address-stress.ts` (the projection
cell no longer prints "+— interest"; it is one cause, said once). Words: "unreadable scale" / "no Cash position in the
lookup" / "Cash book withheld in the lookup" / "lookup not completed". `StressTable.tsx` passes the view's cause.
Finding while doing it: the Inspector mounts its stress table only when `view.cash !== null`, so the false cause was
never reachable THERE — it is reachable in the LAB (`bare(...)` keeps the rows with `decimals: null` when the lookup has
no Cash position). Both lab call sites default to the old word, so nothing regressed. **To finish (A's files, ~3
lines):** `lab-address.ts` — carry `scaleAbsence: view.scaleAbsence` on the workspace (null in `empty()`);
`AddressWorkspace.tsx:51,54` — pass `space.scaleAbsence` as the third argument of `sideRoomWords`.
Pins: unit `address-stress.spec.ts` + `inspector-view.spec.ts` — **seen failing first** (load failure / `Received:
undefined`). No e2e: the state is unreachable on my page.

**5 · W-weak-pins — CLOSED.** (a) The held demo walk is reshaped so page one leaves ONE band unread: every "< 2% room"
row (10, by the lib's own band reader) moves to page two — the census still reconciles (990 + 422 = 1,412; checked with
a scratch run, then deleted). Mid-walk the pin now asserts that bar is a dash with no `data-count`, no `<small>`, 0px,
beside six bars that print "$X · N"; after release it carries `data-count="10"`. On the parent of the dash fix that
bar printed "$0 · 0" → the `not "$0"` line can now fail. (b) The foreign-engine pin says what it means: seven bars, zero
`[data-count]`, each a dash with no "$" and no `<small>` — not a sum an absent attribute satisfies. Unrun.

**6 · Over-delivery wording — CLOSED.** The hook now records HOW an incomplete walk ended (`WalkStopKind`: "before-end" |
"at-end" | "over", threaded `cash.walkStop` → `CashSummaryInput.walkStopKind` → `CashSummary.stopKind` →
`BookHeadlineInput.stopKind`; all REQUIRED). `stopFrame()` words what happened: "The walk stopped before the last page
(…)" only for a walk that never read its last page; "The walk reached its last page and its rows do not reconcile with
the census (…)" for a short or census-changed terminal page; "The walk ran past its census (…)" for over-delivery on any
page. Under "over" NO bound is claimed anywhere: the dek says "its rows may count an account twice, so no figure here is
a total or a lower bound"; the distance finding drops "at least" ("… among the rows the walk landed · the walk ran past
its census, figures are not a bound"); the bars' note, `walkQualifier`, the tiles' note (`tileBoundNote`, moved from the
component) and the attention finding follow.
Pins: unit `book-headline.spec.ts` (frames + both deks), `cash-summary.spec.ts` (no bound anywhere under "over"; the
floor stands for a short terminal page), `cash-view.spec.ts` (the kind threads) — **seen failing under a mutation that
restores the one old frame** (3 tests red, restored). E2E: the short-terminal-page pin RE-POINTED off "stopped before the
last page" (false there); the over-delivery pin extended (frame, tile note, bars note, no "at least" / "lower bound" in
`main`). Unrun.

**7 · Task 10's left Minors.** M1 taken — the empty-grid refusal is homed in `stressPreview` AFTER the
`excluded_engines` check (pins in `stress-preview.spec.ts` and `cash-view.spec.ts`, **seen failing first**: "absent" /
"no points published" masking the engine's cause). M3 taken in part — one definition (`NEAR_CAP_BAND_IDS` in
`cash-rows.ts`) for the three band-set copies; the two DERIVATIONS of "within 10%" (bands vs `nearCap`) remain. M4 —
the hook calls the lib (`bookLoadFailure`); D's `bookFailed` still to delegate. M7 taken — the zero arm ends "· the walk
is still running" / "· the walk stopped" and no longer qualifies a figure it declined to print (three pins re-pointed).
M8 taken — `attentionFinding()`. M9 = item 6. **Left:** M5 (the repair flag's hook half needs a reducer extracted — not a
one-liner); M6 (`app/proof/page.tsx` — Area D's file).

**Comments (whole-branch M4 / M5).** Reworded to the law they keep, in my files: `trust.ts`, `inspector-headline.ts`,
`inspector-position.ts` (×4), `address-lookup.ts`, `app/inspector/page.tsx`, `inspector.module.css`, `book-copy.ts`
(throughout: ruling, wave, Codex-round, caption-slot and §-names), `cash-book.tsx` (a stale "COPIED from BookSurface" note),
`inspector-position.spec.ts`, `comparator-label.spec.ts`. NOT mine and left: `book-fixture-fidelity.spec.ts` (web/scripts),
`book-sort-vocabulary.spec.ts` (`lib/positions`), `inspector-evidence.spec.ts` (`lib/evidence`) — each still names rounds
and waves.

## Contract table

- Test ids ADDED: `book-section-cash` (the Book's Cash SectionHead), `overview-live-accounts` (the strip's Accounts stat).
- Attribute ADDED: `data-tone` on `pipeline-{index,compute,verify,serve}` — the step's own tone.
- Values ADDED: the `Coverage` chip's value `withheld` (both pages); Trust item `reconcile` labels as above.
- No `data-chip`, test id or `data-state` renamed or retired. No line broken in a spec I do not own (checked
  `state-matrix`, `shell`, `screenshots`, `p1a-fixes`, `keyboard`, `lab`).

## Pixel pins

Moved: **Inspector only** (item 3). Overview and Book: by reading, byte-identical in the demo primary state — the
section qualifier is the same string ("… · 1,412 borrowing accounts"), the Coverage chip the same class and words, the
settled walk has no bound note and no stop kind, the pipeline's new rules match no demo tone, and every other change is
an attribute. Not rendered by me.

## Concerns

1. No e2e pin of this wave has been observed in a browser (mine: ~12 new or re-pointed).
2. W-M2's visible half is in the lab and needs Area A's two files (above).
3. `verification-view.ts` still holds the second copy of the missing-engine words, its own whole-refusal read and
   `bookFailed` until D imports from `cash-refusal.ts`.
4. M6 is honoured for `refused` and `warn` only; `ok` stays ink so the served arm does not move — say if green is wanted
   there with a re-baseline.
5. The cards still say their absence line twice (finding and body) — pre-existing shape, words now true; untouched.
