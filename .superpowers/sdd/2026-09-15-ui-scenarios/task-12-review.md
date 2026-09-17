# Task 12 review — the page-test contract; the old Lab retired

Reviewed: commits `1f05a9a` + `9279806` (package `review-e695cc1..9279806.diff`), the brief, the report, the plan's Global Constraints, R1–R16 and the Test ID contract table (`docs/plans/2026-09-15-ui-scenarios.md:15-33, 39-54, 109-125`). Read-only; nothing was run. Deleted specs were read at `git show e695cc1:<path>`.

**Verdicts:** Spec compliance ✅ (the brief's six steps are done, every deviation reasoned) · Task quality **Needs work** — narrowly: one contract state has no pin although the retirement table names a home for its law, the drawer pin over-claims, and one pin codifies a page behaviour that needs a controller ruling. Details under Issues.

---

## Spec Compliance

### Step-by-step

| Item | Verdict | Trace |
|---|---|---|
| Step 1 — `lab.spec.ts` rewritten as the contract | ✅ | 21 pins at `web/tests/e2e/lab.spec.ts:125, 156, 190, 213, 227, 241, 258, 279, 292, 313, 353, 371, 404, 425, 438, 466, 477, 492, 508, 548, 572`. The brief's 16 are all present; five added (C7 `?scenarios=` :258, C10 the hole :313, C11 malformed field :353, C13 failed re-run :404, C14 listing unavailable :425). |
| Step 1 deviations follow the page's law, not the brief's guess | ✅ | `lab-run` absent in address mode (:534; controller ruling); library words are `rowOutcome`'s (:526-530 vs `lib/lab-address.ts:269-280`); 503 dek "Retry after 5s." from the envelope (:383-387; see Concern 3 below); "never $0" scoped to the Cash tiles + verdict (`expectNoCashZero` :80-83) because the legacy fold prints its own honest `$0 → $666.66`. |
| Step 2 — page defects fixed in Task 11 files and named | ✅ | (a) `web/app/lab/LabSurface.tsx:56-63, 209, 231`; (b) `web/app/lab/lab.module.css:4-5, 12-14`. Both named in the report. Soundness judged below. |
| Step 3 — retirement mapping, every old pin has a home or a ledger line | ⚠️ | Counts reconcile on every file (table below). Two homes are over-claimed and one named home is a non-existent file — Issues I1, I3, M1. |
| Step 4 — deletions | ✅ | 31 `app/lab` files gone; 11 remain (`ls web/app/lab` = the Task 11 set + `page.tsx`, `lab.module.css`). `FrontierLedger.tsx` deleted (no importer outside the old Lab). `WaterfallSteps.tsx` kept — `app/styleguide/page.tsx` imports it. No import of a deleted module survives (grep over `app components lib tests`: only prose mentions, M8). Screenshot baselines untouched (the stat lists no `.png`). |
| Step 5 — ledger | ✅ | `.superpowers/sdd/progress-ui-overhaul.md` "2026-09-16 · Plan 3 (Scenarios) — retirements", one line per file, the component groups, the DM-tint ruling (diff :172-199). |
| Step 6 — commit by pathspec through the gate | ✅ (two commits, not one) | Deviation 5 in the report; each tree typechecks per the report. Not verified here (no run). |
| Unit count arithmetic | ✅ | Deleted unit specs at `e695cc1` sum to 471 (11+11+28+18+12+23+30+131+29+37+30+10+20+7+11+63); `set-run-outcome` 37 → 14 (23 trimmed). Moved copies: `lab-classify-run-book` 28 = `engine-classification` 28; `lab-classify-set-run` 11 = `set-run-classification` 11; `lab-deep-link` 8 = the old `tornado-lines` "the deep-link decision" describe's 8 tests. |
| Test line (926 / 916 / 10 skipped; unit 750; e2e 176) | not verified | Read-only review; the report's numbers are self-consistent with the arithmetic above. |

### Contract-coverage reconciliation (plan Test ID contract table → pin)

| Contract row / value | Pin | Note |
|---|---|---|
| `lab-surface` `data-mode` book / address | C1 :129, C19 :511 | |
| `data-state` (book): `listing-loading` | — | transient; acceptable |
| `listing-unavailable` | C14 :429 | |
| `not-run` | C1 :128, C6 :247, C8 :283 | |
| `running` | C5 :233 | |
| `result` | C2 via `runIt` :74-77 | |
| **`not-covered` (book)** | **none** | R3 headline "{label} does not model the Cash book." (`lib/lab-headline.ts:112`) is unit-pinned (`tests/unit/lab-headline.spec.ts:102`) but has no page pin. The demo listing covers Cash on every scenario (`tests/fixtures/demo/scenarios-demo.json:11-13, 37-39, 58, 84`), so the state needs a shaped listing body — `mockLab({ scenarios })` already supports it. **Issue I1.** |
| `withheld` | C9 :299, C10 :318, :335, :359 | |
| `contradictory` | C11 :358, C16 :470 | |
| `definition-changed` | C15 :462 | |
| `not-served` / `no-batch` / `rate-limited` / `failed` | C12 :375, :386, :395, :402 | |
| `busy` | — | not producible on the single-run route (`lib/runbook.ts:65-70` has no busy kind); a set-run state → Task 13 |
| `unreachable` | — | reachable with `route.abort()` on the run route; unpinned (M3) |
| `data-state` (address): `idle` | C20 :553 | |
| `invalid` | — | reachable only via `?address=<not an address>` (`lib/lab-address.ts:205`); C20 pins the inline refusal keeps `idle` (:557). Unpinned (M3) |
| `loading` | — | transient |
| `unavailable` | state-matrix :409-413 | |
| `no-position` | C20 :566-568 | |
| `withheld` (address) | state-matrix :394-396 | "Cannot say", never "No Cash position" |
| `rows` | C19 :512, state-matrix :371 | |
| `data-banner` `stale-input` / `superseded` | C15 :453 / :442 | |
| `lab-library`, rows, `data-outcome` | C1 :131-135 (`not-run`), C2 :177 (`result`), C19 :527, :531 (`result`, `not-covered`) | `running`/`withheld`/`failed` asserted by their words (:234, :307, :377), not by attribute — fine |
| `lab-library-check-{id}` | C7 :262-264, C19 :532 (absent in address mode, R15) | |
| `lab-mode-book` / `-address` | C1 :136-137 (words), C19 :539, :543 | |
| `lab-run` | C1 :140, C5, C11 :369, C14 :432 (disabled), C19 :534 (absent) | |
| `lab-compare` | — | Task 13 (`LabSurface.tsx:247` passes `compare={null}`) |
| `lab-address-input` / `-inspect` / `-refused` | C19 :536, C20 :555-557 | ids derived by `AddressField` (`${testId}-…`) — confirmed |
| `lab-verdict`, `-headline`, `-dek`, chips `data-chip` | C2 :161-170 and throughout | `-identity` is not rendered by `VerdictHeader` (only `headline`/`dek`, `components/kit/VerdictHeader.tsx:30-36`) — contract drift from Task 1/11, not Task 12 (M5) |
| `lab-projection` | C1 :139 | asserted only in the not-run state; it sits in the kicker for every state (`LabSurface.tsx:161-176`) so one pin is structurally sufficient, but the law is "every shocked figure" — a result-state and an address-mode assertion would cost two lines (M4) |
| `lab-banner`, `data-kind`, `lab-banner-rerun` | C15 :443, :446 | `data-kind` on the banner (`StaleBanner.tsx:12`) is not asserted; the surface's `data-banner` is — equivalent |
| `lab-kpi-*` + `data-tone` | C1 :141-145, C2 :171-180 | |
| `lab-transitions`, `lab-heatmap`, cells, finding, `data-merged` | C3 :195-210, C1 :146-148 | |
| `lab-movers`, rows, caption | C4 :217-225 | |
| `lab-legacy`, `lab-legacy-kpi-*`, `lab-legacy-heatmap` | C17 :481-489 | `baddebt`/`moved` legacy tiles unasserted (fine) |
| `lab-drawer`, `lab-drawer-body` | C18 :496-505 | see I3 |
| `lab-address-tiles`, `lab-address-kpi-*`, `lab-address-table` | C19 :517-524 | `debt-after`/`cap-after` unasserted (fine) |
| `lab-deeplink-notice` | C6 :251, C7 :266, :274 | |

### The honest-UI laws

| Law | Pin |
|---|---|
| A refusal never a zero or "no position" | `expectNoCashZero` at C9 :310, C10 :325, C11 :365; C10 :326 (`tile debt` not `$0`), :331 (`main` not `+$1.2M` when Cash is in both arrays); state-matrix :396 (withheld is never "No Cash position"); C20 :568 (not-found is never "Cannot say") |
| Engines never summed | C17 :481-489 (legacy `+$6,000` in its own fold, Cash `+$1.2M` in the tiles, "never added together") |
| PROJECTION | C1 :139 only (M4) |
| Deep-link law incl. both-present + notice | C6 :243-256 (one run; ghost runs nothing; both present → notice, nothing runs, no set); C7 :258-276 (exact ids posted, pre-ticked, filtered id named) |
| Banners R13 | C15 :438-464 (result kept under `superseded` — tile 118, chip "18,251 · superseded", rerun enabled; `stale-input` names "path assumption"; a new version is `definition-changed` with dashed tiles) |
| Drawer's exact wire values | C18 :499 (`1,280,000.000000` — one tile's exact value), :503 (the wire's note verbatim). Applied shocks and held-flat not asserted (I3) |
| Nothing dispatched cold | C1 :151-153 |
| One click, one POST; in-flight click ignored | C2 :160, C5 :227-239 |

No pin asserts nothing; no pin asserts a value against itself. Where a fixture value is used as the expectation (C4 `first.account` → href :221-223; C18 the note :503; C19 row count :524) it is the wire's own value, which is the law being pinned.

### Fixture routing — one consistent address per cell

| Cell | Path | Lookup body | Stress body | Consistent? |
|---|---|---|---|---|
| C19 | `DEMO_NEAR_ADDR` | `DEMO_ADDRESS_NEAR` | `DEMO_STRESS_NEAR` | ✅ `tests/fixtures/demo/index.ts:29` derives the constant from the body; `address-demo-near.json:69` = `stress-demo-near.json:69` = `history-demo-near.json:69` |
| C20 not-found | `NOT_FOUND_ADDR` | `ADDRESS_NOT_FOUND` (`inspector.ts:273` carries `NOT_FOUND_ADDR`) | `DEMO_STRESS_NEAR` re-identified, `found:false`, `scenarios:[]` (:563) | ✅ |
| state-matrix refused | `UNKNOWABLE_ADDR` | `ADDRESS_UNKNOWABLE` (`inspector.ts:298`, `found:null`) | `stress-unknowable.json` (carries `0xAAaA…0001` at :71) re-identified to `UNKNOWABLE_ADDR` (state-matrix :384-388) | ✅ (controller ruling) |
| state-matrix 429 | `DEMO_NEAR_ADDR` | `DEMO_ADDRESS_NEAR` | 429 envelope | ✅ |

Route globs: `*` does not cross `/` in Playwright globs, and routes are matched last-registered-first, so `**/v1/scenarios` (registered last) cannot swallow `/v1/scenarios/*/run-book` or `/run-book-set`, and `**/v1/address/*` cannot swallow `/history` or `/stress`. The OPTIONS leg is answered and never counted (:98-107). Correct.

### Retirements — counts reconciled against the deleted specs at `e695cc1`

| File | Pins at e695cc1 | Table says | Reconciles? |
|---|---|---|---|
| e2e/lab.spec.ts | 30 | 15 + 15 | ✅ by title |
| e2e/runbook-bsplit | 26 | 9 + 17 | ⚠️ actual 8 + 18: the 18 retired titles are all named; the "mover deep link → C4" entry has no matching title (it is a sub-assertion of :385 "CLICKING a mover opens the Inspector") — M1 |
| e2e/runbook-transition | 17 | 6 + 11 | ✅ |
| e2e/tornado | 20 | grouped, no counts | ✅ every title falls in a named group |
| e2e/chart-spec-v4 | 13 | 2 + 11 | ✅ |
| e2e/w3l-slots | 9 | 0 + 9 | ✅ |
| e2e/book-charts | 3 | 1 + 2 | ✅ |
| e2e/r1-fixes | 4 Lab of 8 | 3 + 1 | ✅ (:115, :159, :166 → C20, C1, C1; the Lab arm of :212 retired) |
| e2e/r10 / r11 / r8 / r9 / r12 / r13 / r14 / r15 / r16 / r17 | 4/2/2/2/2/4/3/1/1/1 | as tabled | ✅ |
| e2e/p0-fixes | 8 | 2 + 2 + 1 + 3 | ✅ |
| e2e/p1b-fixes | 12 Lab of 14 | as tabled; 2 kept | ✅ (kept: fix 2 feed, fix 3 observatory) |
| unit ×16 + set-run-outcome trim | 471 + 23 | 471 + 23 | ✅ |

### Sampled retirements — is the stated reason true?

| Old pin (file:line at e695cc1) | Stated disposition | Judgement |
|---|---|---|
| p0-fixes :65, :108 — p0-1 the stale barrier (editing the input hides the result under "RESULTS FOR PREVIOUS INPUT"; retyping restores) | retired: the workspace is bound to the inspected address, not the input; C19 pins the identity | **True.** `LabSurface.tsx:80, 227-232`: `address` state changes only on Inspect; `AddressField` owns the input; the kicker prints `space.address` (:169). The defect class (a result rendered under an edited address) cannot arise. C19 :513-516 pins the kicker's account and the chips. |
| p0-fixes :213 — p0-2 "an all-zero engine says so instead of a bare $0" | → C2 + unit lab-library / lab-headline ("No band change") | **True** at unit level: `tests/unit/lab-library.spec.ts:33` pins `No band change`; R3's "No Cash account changes band" is in `lab-headline.spec.ts`. No page pin ships an all-zero run (the demo has none) — acceptable, the words are the lib's. |
| p1b-fixes :341, :368 — p1b-5 identity line + anchored age; the barrier | → C19 (account in kicker, batch and scenario chips); barrier retired as p0-1 | **True.** C19 :513-516. The anchored age is the `Computed` chip (`LabSurface.tsx:103-107, 149-154`), pinned as "ago" at C2 :164 — the wire's `age_seconds` through `resultReceipt`. |
| p1b-fixes :532 — item 8 the blind resume says "run again" | → unit `freshness-blind-resume` / `live-age` | **Home exists, name wrong.** There is no `tests/unit/live-age.spec.ts`; `useAnchoredAgeSeconds` is pinned in `freshness-blind-resume.spec.ts` and `freshness-resume-evidence.spec.ts`. The page consequence ("age unknown", warn, `LabSurface.tsx:153`) has no page pin. M1. |
| p1b-fixes :573, :658 — p1b-9 f1 / p1b-10 f1 the identity weld (a mislabeled body refused by path) | → unit `result-identity` | **True** (13 pins, present). The page-level consequence in one-address mode rides Plan 2's `useAddressLookup`, whose page pins are the Inspector's. |
| r11-fixes :65 — (A) a 200 naming nobody: cells UNANSWERED, "neither a result nor a refusal", never a zero, header claims no cohort | → C10 (a hole is withheld by name, never an empty healthy book) | **True in substance.** C10 :314-326: `withheld` state, dek "no row for this engine and no refusal", dashed tiles, no `$0`, no grid. Vocabulary note: the page's state word for a hole is `withheld` (the refusal word) while the dek says there is no refusal; the old law kept the two apart. Honest either way (M9). |
| r8-fixes :172 — (2) a failed re-run: the prior result RETURNS with its own batch pin and the failure is NAMED beside it | → C13 "the new page retains nothing: a failed re-run replaces the result it had" | **Reason is a description, not a law.** C13 :404-423 pins the opposite behaviour (the 118 result is gone, `not-served` stands alone). See I2 — this inverts r8/r16/r17 and sits against "A result is never silently replaced". |
| runbook-transition :337 — the DM matrix carries no verdict tint; :357 the method line | retired with the ruling (for Cash the over-cap band IS `debt > cap`, so the tint is the verdict); the drawer names the fields | **True**; the ruling is the brief's own text and is in the ledger. C3 :199 pins `data-movement="worse"` on the tinted cell. |
| r10-fixes :178 — (2) an older row re-running: its held batch disclosed, not swept under "every held result" | retired: no cohort; a result stays with its scenario (C8) | **True.** One workspace, one result per scenario (C8 :279-290); there is no cohort sentence to keep honest. |
| old lab.spec :617 exact rationals / held_flat / snap flags; :963 r85 the row declares its shock axes | → C18 (drawer) / C1 + C18 | **Over-claimed.** C18 :496-505 asserts the path assumption, one exact tile value, one out-of-model line and the transitions note — not the applied shocks (asset, before→after, snapped / base-snapped / cap-bound) nor the held-flat list. R10 mandates those in the drawer. I3. |
| old lab.spec :152 the committed list comes from /v1/scenarios (a 503 listing → listing-error, matrix absent) | → C1 (+ unit lab-library) | **True, and C14 :425-436 is the closer home** (503 listing → `listing-unavailable`, the words in library and workspace, nothing runs). |
| tornado :1201 — r58 item 6 the dispatch-time past-tense notice survives a listing refresh | → C6, C7 + unit lab-deep-link | Unit pins moved (8 = 8). On the page `dispatchNotice` has no consumer — `LabSurface.tsx:119-123` derives `notice` at render from the live listing; the page fetches the listing once, so the flip cannot happen today. The `lab-deep-link.ts:28-33` comment still describes a refresh the page does not perform (M10). |

### The two page fixes

**(a) `router.replace` → `window.history.replaceState`** — ✅ sound.
- Next `16.2.12` (`web/package.json`, `node_modules/next/package.json`). `node_modules/next/dist/client/components/app-router.js:268-279` patches `window.history.replaceState`; a non-internal call goes through `copyNextJsInternalHistoryState` (:84-96 — `null` becomes `{}` and the internal tree is copied in) and `applyUrlFromHistoryPushReplace` (:237-247), which dispatches `ACTION_RESTORE` with the new URL so `useSearchParams` observes it. `replaceUrl(url)` passes `null, "", url` — the `null` is handled.
- URL built safely: `labUrl(new URLSearchParams(params.toString()))` (`LabSurface.tsx:51-54, 206-209, 229-231`) — encoded by `URLSearchParams`, relative `/lab?…` resolves same-origin. Scroll and React state are preserved (no navigation, no remount). `useSearchParams` sits under `Suspense` (`app/lab/page.tsx:7-12`), so the route stays static.
- Pin real: C19 :541 (`/lab$` after leaving address mode), :545 (`address=` restored on re-entry), C20 :560 (an invalid address never reaches the URL).
- Not verified: the original claim that `router.replace` never wrote the URL in the production build. The fix is correct regardless; the report's note that Task 13 should know the pattern is right.
- One caveat for the record: `params` inside the handlers is the render's snapshot; because the patched `replaceState` dispatches a router update, the next render's `params` carries the written URL, so successive writes compose correctly. If Next ever drops the history patch, the second write would read stale params — the C19 re-entry pin would catch it.

**(b) `grid-template-columns: minmax(0, 1fr)`** — ✅ minimal and correct. A `display:grid` container with no template has one implicit `auto` track whose base size is its items' min-content; `min-width: 0` on the container does not shrink that track, so the tiles' min-content overran the 342px box. `minmax(0, 1fr)` is the canonical one-line fix, applied to the four stacked grids (`lab.module.css:4-5, 12-14`) with a comment that states the law. Pinned at C21 :585-588 (390 wide, no overflow). Caveat: C21 runs with the legacy fold closed, so `.legacyBody`, `.tilesPair` and `.method` are not exercised by the pin (M6).

### Lib comment carry-overs

- `lib/lab-deep-link.ts:10` (`DeepLinkDecision` docblock restored), :32-38 and :117-118 (the two "R58 item 6" comments now state the law: dispatch-time past tense, never the listing on screen). ✅ No round or review numbers in the new text.
- `lib/wireGuard.ts:4-6` — the dangling `app/lab/matrixCells.ts` reference is gone; the new sentence states the law. ✅ for the edited lines. The untouched header (:1 "(p1b-1)", :12 "p0-8") and the body (:38, :41, :57, :99, :102, :106, :115, :126, :133, :162, :190, :197, :224) still carry round numbers — pre-existing, outside the brief; the report's concern names only `lab-classify.ts` (M7). Note the Global Constraint "`web/lib/**` existing files are untouched": `wireGuard.ts` is pre-existing; a comment-only edit to remove a reference to a deleted file is the right call and the controller anticipated it.
- `lib/lab-classify.ts:9-13` — `tornadoCellState` replaced by `compareRows` in `lab-compare`; states the law. ✅ Pre-existing round refs remain at :32-33, :47, :52, :109, :113, :164, :209, :246 (the report lists them).

### Concern 3 — `Retry-After` is unreadable cross-origin

✅ Confirmed. `cmd/api/middleware.go:132-161` sets `Access-Control-Allow-Origin/Methods/Headers/Max-Age` and no `Access-Control-Expose-Headers`; `Retry-After` is not a CORS-safelisted response header, so a browser on :3111 reading :8080 gets `null` from `res.headers.get("retry-after")`. `lib/runbook.ts:92-94` prefers the header and falls back to `retry_after_seconds`; `lib/lab-headline.ts:131, 139` prints "Retry after {n}s."; `tests/fixtures/error-unavailable.json:5` carries 5. The pin (C12 :383-387) asserts "Retry after 5s." while the mock sends `retry-after: 30` as a deliberate discriminator, and its comment states the law. That follows the wire honestly; if the API ever exposes the header the pin fails loudly, which is the correct signal. The report's recommendation (`Access-Control-Expose-Headers: Retry-After`) is right and belongs to the API owner.

### `tests/unit/set-run-outcome.spec.ts` (trimmed)

✅ Imports only `lib/` (:23-30: `lab-headline`, `runbookSet`). The 14 kept pins still pin the laws the header names (code-first dispatch :53-73; busy gauges null never zero :75-121; no `Retry-After` for busy :123; 429 keeps its message :129; 404/refused :146-158; local shape rules :182-191; unreachable :206; request order :213). The two re-expressed sentences: busy with unknown gauges → `failureHeadline("busy", …)` :93-101 (emphasis "The evaluator is busy.", tone refused, dek "The service did not state its capacity.", not `0 of 0`, not `0 are running`) — the old "no count is claimed" / "not at most 0" negatives are carried in substance; refused-locally → :197-203 (emphasis "Nothing was sent.", dek names `ETH_down` and "nothing was sent") — faithful to the old "REFUSED LOCALLY, NOTHING SENT" / "No request left this page". One kept title still reads "p1b-13: …" (:75) — pre-existing, M7.

### Quality

- Timing/ordering: `waitForTimeout(300)` for the six "nothing dispatched" negatives (:151, :248, :253, :269, :433, :558) — the standard shape for a negative, inherently timing-based; `expect.poll` for the positives (:261, :275) ✅. C5 (:227-239) must land five assertions inside a 600ms artificial delay — fine locally, a mild flake risk on a slow runner (M2).
- Duplicated helpers: `mockLab` + `RUN_CORS` + `LabMocks` re-implemented in `state-matrix.spec.ts:145-201` (the brief mandated "a `mockLab` helper shaped like the contract's"); the `fixture()` JSON reader is per-file (pre-existing pattern). A shared `tests/e2e/helpers` module would remove ~40 lines; not required (M11).
- `any`: none. `!`: none — the brief's non-null assertions were replaced with throwing guards (`cashEngine` :86-90, `firstScenario` :95-99, `outOfModel` :500-502, the `box === null` throws :578, :583).
- Comments narrating the task: `p1b-fixes.spec.ts:2-11` and `r1-fixes.spec.ts:9-12, 20-22, 42-47` carry "Plan 3", a date and a ledger pointer, and the `(10)` test title now says "the Lab arm under Plan 3" — the same shape the Plan 2 retirement used; borderline against "comments state the law, never the round" but it is a ledger cross-reference, not a round number (M7). `lab.spec.ts:1` repeats the file path as a comment — harmless.
- Global constraint "no horizontal scroll at 390" and "first viewport holds the library header and its first rows": C21 pins the mode toggle and the first row only (:576); per the report rows 2–3 also fit at 1440×900 (the list runs to 984px), so the pin could hold the plural (M6).

---

## Strengths

- The retirement table is real bookkeeping: every deleted file's count matches its pin titles at `e695cc1`, the grouped dispositions each name a home or a reason, and the ledger carries the DM-tint ruling in the brief's words.
- The five added pins (C7, C10, C11, C13, C14) are exactly the laws the brief's 16 would have orphaned: the hole in three shapes, a malformed field as the contradictory state with the route standing, the listing-503 arm, the set deep link posting exactly its ids.
- The mock answers the CORS preflight and counts only the POST; the 503 pin sends a header nobody can read to prove the page reads the envelope — a discriminating fixture, not a convenient one.
- The one-address pins follow `rowOutcome`'s own verdicts and the batch-named negative ("No Cash position for 0xBBbB…0002 in batch N.") rather than the brief's placeholder words.
- Two genuine page defects found by the contract and fixed minimally, each with a comment that states the law and a pin that would fail without the fix.
- Throwing guards instead of `!`; no `any`; fixture-derived expectations are the wire's own values.

---

## Issues

### Critical
None.

### Important

**I1. The book-mode `not-covered` state has no page pin, and the retirement table claims one.** The plan's Test ID contract lists `not-covered` among the book states; R3 gives its headline ("{label} does not model the Cash book.", `lib/lab-headline.ts:112`, `lab-view.ts:152-153`); the Refusals constraint says a not-covered engine has its own state word and dashed tiles. The old matrix's law "NOT COVERED is not a refusal and not a failed run — never looks like withheld" (old lab.spec :232) is retired to "states pinned in C1/C9/C12/C16", none of which reaches `not-covered`. The demo listing covers Cash everywhere, so the pin needs a shaped listing (`mockLab({ scenarios: … })` with one scenario's `engines: ["aave_v3_etherfi"]`) and should assert `data-state="not-covered"`, the headline, dashed tiles, the library word "Not modelled for Cash" (R12), the legacy fold present, and no `$0`. *Plan text mandates the state* (contract table, R3, R12) — an implementer gap, roughly fifteen lines.

**I2. C13 codifies "a failed re-run replaces the result it had", which inverts the retired r8(2)/r16/r17 law and needs a ruling.** `lab.spec.ts:404-423` pins that after a 404 re-run the 118-account result is gone and `not-served` stands alone; the retirement reason ("the new page retains nothing") describes Task 11's page rather than stating a law. The old law (r8-fixes :172-222) was: a re-run that could not answer says nothing about the answer already held, the result returns with its own batch pin, and the failure is named beside it. The Global Constraint "A result is never silently replaced" reads the old way: the failure is disclosed, but the held result vanishes without a word that it was held. *Plan text does not mandate replacement* — R13 covers superseded and stale-input only — so this is a controller ruling to make: either accept the new law and record it as a ruling in the ledger (with the constraint's sentence qualified), or have Task 11 keep the result under a failure banner and re-pin C13. Not a Task 12 defect: the pin honestly records what the page does.

**I3. The drawer pin (C18) does not assert the applied shocks or the held-flat inputs, though its title, the brief and the retirement table all claim it.** `lab.spec.ts:492-506` pins the path assumption, one exact tile value, one out-of-model line and the transitions note. R10 mandates the drawer hold the applied shocks (asset, source, before → after, snapped / base-snapped / cap-bound flags) and the held-flat inputs; the old pins (lab.spec :617 exact rationals / held_flat / snap flags; :963 r85 the row declares its shock axes) are retired to C18. *The brief's own C13 had the same four assertions*, so the omission is inherited from the controller's spec; the over-claim in the retirement table is the implementer's. Fix: assert the demo run's `shocks`/`applied_shocks` asset and factor and one held-flat entry from `DEMO_RUN_BOOK_ETH`, and the three flags' words.

### Minor

- **M1. Ledger accuracy.** The table names `unit live-age` as a home (no such file; the hook is pinned in `freshness-blind-resume` and `freshness-resume-evidence`); runbook-bsplit is 8 re-expressed + 18 retired, not 9 + 17 (the "mover deep link" entry has no title). The ledger is the durable record — worth two line edits.
- **M2.** C5's five in-flight assertions inside a 600ms delay; raise the delay or assert fewer things before the settle.
- **M3.** Two reachable contract states unpinned: `unreachable` (book; `route.abort()` on the run route, R12 word "Unreachable") and `invalid` (address; `/lab?address=0xnope` → "Not an address.", `lab-address.ts:205`). One line each with the existing helpers.
- **M4.** `lab-projection` is asserted only on the cold load (C1 :139); the law is "every shocked figure". Add the assertion to C2 and C19.
- **M5.** Contract drift not of this task: `lab-verdict-identity` is not rendered (`VerdictHeader.tsx:30-36`); `busy` is not producible on the single-run route (`lib/runbook.ts:65-70`); `lab-compare` awaits Task 13. The plan's table should be corrected at Task 13/15.
- **M6.** C21 pins one library row where the constraint says "first rows" (the report measured rows 2–3 fitting); and its 390 check runs with the legacy fold closed, so the three nested-grid CSS rules are unexercised — open the fold before measuring overflow.
- **M7.** Round numbers persist in touched files outside the edited lines: `wireGuard.ts` header and body (fifteen sites), `lab-classify.ts` (eight), the kept title `set-run-outcome.spec.ts:75` "p1b-13:". Pre-existing; the report lists only `lab-classify.ts`.
- **M8.** Prose references to deleted modules remain elsewhere: `components/charts/charts.module.css:253, 326` (`LabFrontier`, `LabTornado`, `frontierScale`), `lib/book-format.ts:42` (`frontierView.labUsd`), `lib/factorPriceGuard.ts:21` (`engineClassification.ts`, `setRunClassification.ts`), `lib/format.ts:80`, `lib/resultIdentity.ts:66`, `app/feed/FeedLiveStrip.tsx:28`, `tests/unit/{honest-render,result-identity,wire-guard}.spec.ts`. Same class the brief asked to fix in `wireGuard.ts`; outside its file list.
- **M9.** The hole (C10) wears the `withheld` state word while its dek says "no row for this engine and no refusal"; the old r11 law kept "neither a result nor a refusal" apart from a refusal. Honest as rendered; a `hole` outcome key would be cleaner but is a Task 9/11 vocabulary choice.
- **M10.** `DeepLinkDecision.dispatchNotice` has no consumer on the page (`LabSurface.tsx:119-123` derives the present-tense notice at render); the page fetches the listing once, so nothing can flip. The `lab-deep-link.ts:28-33` comment still describes a refresh the page does not perform — either wire the dispatch record when a listing refresh exists (Task 13) or trim the comment.
- **M11.** `mockLab`/`RUN_CORS` duplicated in `state-matrix.spec.ts` (brief-mandated shape); a shared helper module would remove ~40 lines.
- **M12.** state-matrix `lab × error:429` (:409-413) drops the old "with the server's own retry" assertion; the dek pins "(429)" only. `lab-address.ts:211` prints the lookup's message — check whether it carries the retry and pin it if so.

---

## Assessment

**Spec compliance: ✅.** All six steps of the brief are done; each deviation is reasoned and follows the page's law rather than the brief's placeholder (address mode has no `lab-run`, the library words are `rowOutcome`'s, the 503 dek reads the envelope because the API exposes no header). The retirement table reconciles to the count on every file I checked against `e695cc1`, the deletions are complete with no dangling import, the ledger is written, screenshot baselines are untouched.

**Task quality: Needs work — narrowly.** The work is careful and the added pins are the right ones, but the task's core promise (R14: every old law has a home) is short in three places, two of them the implementer's: the book-mode `not-covered` state is in the contract and unpinned while the table says it is (I1); the drawer pin over-claims the shocks and held-flat laws (I3, inherited from the brief but recorded as re-expressed); and the ledger names a non-existent spec (M1). I2 is not an implementer defect — it is a page behaviour the pin honestly records — but it needs the controller's ruling before Task 15 treats C13 as law. A fix-up of roughly thirty lines (one shaped-listing pin, three drawer assertions, two ledger edits) closes I1, I3 and M1; M3/M4 are cheap to fold in.

**Could not verify** (read-only): the test line (926/916/10; unit 750; e2e 176) and that the contract passes on the production build; the original `router.replace` defect in Next 16.2.12 production (the replacement is sound regardless); that the C2/C3 figures and the dek sentence match `lib/lab-headline.ts` and the demo weld to the character (the report says they passed).

---

## Re-review 1 (18ff863)

Scope: I1 and I3 (the two bookkeeping slips M1 with them). I2 is excluded by the controller's ruling (the Global Constraint wins; C13 is re-pinned in the controller's own commit and reviewed separately) and is not judged here. Read-only; the suite was not run. Reviewed as packaged at `18ff863` (`web/tests/e2e/lab.spec.ts` only, +45 lines); the working tree has since moved on that file and on `LabSurface.tsx`, `StaleBanner.tsx`, `lab-library.ts`, `lab-reading.ts`, `lab-view.ts` and three unit specs — the controller's I2 work in progress, outside this package.

**RE-REVIEW: closed.**

### I1 — C22 "not covered" (`lab.spec.ts`, the last test)

| Check | Verdict | Trace |
|---|---|---|
| Shapes the listing, legacy-only engines for `eth_minus_30` | ✅ | `legacyOnly` maps the demo listing's `eth_minus_30` to `engines: ["aave_v3_etherfi"]`; served through `mockLab({ scenarios })`; run by `?scenario=eth_minus_30` (still listed, so `LabSurface.tsx:134-139` dispatches it). |
| The definition decides, not the served row | ✅ | `lib/lab-engine.ts:54` returns `not-covered` from `definition.engines` before the run's rows or refusals are read; `lab-view.ts:155-156` maps it to `state: "not-covered"` with `notCoveredHeadline(def.label, def.engines, legacy !== null)`. The run-book body still carries a Cash row, which is exactly the discriminating shape: a page that read the row would render a result. |
| `data-state="not-covered"` | ✅ | asserted. |
| No banner, and the claim "no definition skew" is true | ✅ | `definitionSkew` (`lib/lab-library.ts:124-134`) compares version, label, path assumption, shocks and config version — never `engines` — so shaping the engines raises no `stale-input`; the demo batch is not superseded. `not.toHaveAttribute("data-banner", /.+/)` is real (`LabSurface.tsx:197` omits the attribute when the banner is null). |
| Headline "ETH -30 percent does not model the Cash book." | ✅ | `lib/lab-headline.ts:112`. |
| Dek "It models the Aave v3 market (legacy). The legacy result is below." | ✅ | `lab-headline.ts:108, 111-112`: `modelled(LEGACY)` takes the article, `joinAnd` of one, `legacyBelow` true because the shaped definition names the legacy engine (`lab-view.ts:139`). |
| Library row `data-outcome="not-covered"`, "Not modelled for Cash", engines line "Aave v3 market (legacy)" | ✅ | `lab-library.ts:74-82` (`cashOutcome` → `readEngine` → `not-covered`), `:107` (`joinAnd(def.engines.map(engineName))`), rendered at `ScenarioLibrary.tsx:125`. |
| Four Cash tiles: "—", "not modelled", tone refused, no "0" | ✅ | `LabTiles.tsx:12-13` (the word), `:38-39` (`tone` → refused and `sub` → the word alone when there is no result), `:44, :54, :63, :72` (value "—"). Labels carry no digit, so `not.toContainText("0")` is a real negative against a zero costume. |
| Transitions card's engine word "This scenario does not model Cash." | ✅ | `TransitionCard.tsx:41` with `engineName(CASH)` = "Cash" (`lib/inspector-headline.ts:45`). |
| No grid, no movers | ✅ | `lab-heatmap` and `lab-movers` `toHaveCount(0)`; `LabSurface.tsx:304` renders movers only on a Cash result. |
| Legacy fold present, its own 14 | ✅ | `lab-view.ts:139` reads the legacy engine because the shaped definition names it; the not-covered arm keeps `legacy` (unlike `definition-changed`, which nulls it); `lab-legacy-kpi-newly` "14". |
| The retired law: nothing says withheld | ✅ | `main` `not.toContainText(/withheld/i)`. |
| Would it fail if the page rendered not-covered as withheld? | ✅ six ways | `data-state` ("withheld" ≠ "not-covered"), the headline ("Cannot say — …"), the row's word ("Withheld"), the tiles' word ("withheld"), the finding ("Withheld: Cash was not computed …"), and the `/withheld/i` negative. The old law is fully re-expressed. |

Bonus coverage: the test also pins the `not-covered` arm of R12's word list and R3's dek, neither of which had a page pin before.

### I3 — C18 extended (the drawer)

| Check | Verdict | Trace |
|---|---|---|
| Every applied shock, item by item, from the fixture's own array | ✅ | `DEMO_RUN_BOOK_ETH.applied_shocks.map(...)` → `toHaveText([...])` on `h3:has-text('Applied shocks') + ul > li`. The demo's top-level `applied_shocks` has three entries (chains 10, 10, 1; sources `priceproviderv2` ×2 and `aaveoracle:0x43b6…`; `70/100`; before → after `1000000000 → 700000000`, `4000000000 → 2800000000`, `400000000000 → 280000000000`), so the `+ ul` exists and the three-element equality is not vacuous. |
| The drawer's exact print format | ✅ | `AssumptionsDrawer.tsx:34-35`: `<asset> (chain <id>, <source>): <before> → <after> × <num>/<den>` then ` · <flags>` only when set — the pin's template is character-for-character the same; `toHaveText` normalises whitespace, and JSX drops the line break before the flags fragment, so no stray space. `exact()` prints the raw string for a legal wire decimal, which every demo value is; an illegal one would print "unreadable (…)" and the pin would fail in the right direction. |
| Flag suffix proven absent by exact-text equality | ✅ | All nine flags in the demo are `false`; `shockFlags` therefore yields `""` for each expected string, and `toHaveText` with an array is full-text equality per element, so any rendered " · snapped / base snapped / cap bound" would fail it. The spec's `shockFlags` re-states the format independently rather than importing the component's `flags` — correct: a test that borrowed the page's helper would assert the page against itself. |
| Every held-flat input, item by item | ✅ | `DEMO_RUN_BOOK_ETH.held_flat.map(...)` (three entries: `0x0b2C…Ff85` chain 10 at `1000000`, `0xA0b8…eB48` chain 1 `aaveoracle:…` at `100000000`, `0xe008…fD3f` chain 10 at `1250000`) against `AssumptionsDrawer.tsx:47`'s `<asset> (chain <id>, <source>) at <value>` — same format. The old lab.spec :617 held-flat pin (`0xA0b8…eB48`, `100000000`) is now literally re-expressed. |
| Counts pinned | ✅ | `toHaveCount(applied_shocks.length)` and `toHaveCount(held_flat.length)` — redundant with the array form of `toHaveText`, harmless, and explicit. |
| The `+ ul` locator | ✅ | The `<ul>` is the `<h3>`'s immediate sibling whenever the list is non-empty (`AssumptionsDrawer.tsx:27-38, 40-50`); `:has-text()` is a supported Playwright pseudo-class; only one `<h3>` carries each heading. |

### The table's claims, now

- "exact rationals / held_flat / snap → C18" and "r85 the row declares its shock axes → C1 + C18" — **true**: the ratio (`70/100`), the held-flat list and the flags' absence are pinned at C18; the description at C1. (The old :617 pin also printed the shock as a percent; the drawer prints the ratio only, and R10 mandates no percent — not a residual.)
- book-charts "wire notes as counted details → C18" — true as before (the transitions note verbatim).
- "the matrix's five cell states … its 'not-covered never looks like withheld' law → C22" — **true** (report row 25).
- M1 — the report's table now reads runbook-bsplit 8 + 18 with the sub-assertion folded into the mover-click pin, and names `freshness-blind-resume` / `freshness-resume-evidence` for the blind resume — both **true** against the counts and files I checked in the first review.
- The report's contract numbering adds "C22 not covered (fix round 1)"; C1–C21 keep their numbers because the test is appended last — the ledger's Cn references stay valid.

### Residual (not a Task 12 item; named for the integrator's commit)

The committed ledger at `18ff863` (`.superpowers/sdd/progress-ui-overhaul.md`) still carries the two M1 slips and does not mention C22 — the round's commit was scoped to the spec, and the report hands the ledger to the integrator. The working tree already corrects the two slips (uncommitted: "8 re-expressed … 18 retired"; "freshness-blind-resume / freshness-resume-evidence") but no ledger line names C22 yet. When the ledger is committed, its `tests/e2e/lab.spec.ts` line should route the old matrix pin's not-covered law to C22 and the contract-numbering sentence should list C22, mirroring the report.

**Not verified** (read-only): the reported 22/22 on the production build; that `tsc`/eslint are clean at `18ff863`.
