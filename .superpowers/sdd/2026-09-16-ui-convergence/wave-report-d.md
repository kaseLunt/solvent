# Task 12 fix wave · Area D — report: Verification, API, the styleguide, the kit's leftovers

Status: **DONE_WITH_CONCERNS**. Commit **62a0b61** on `main` (parent 736e09e, Area B's), 33 paths, staged by name,
committed by pathspec, scope gate OK (33 paths), hooks ran (control-plane doctor 0 errors / 0 warnings), subject line
verbatim from the brief, no attribution line. Not pushed. Nothing was built; :3111 untouched; no snapshot update; no
prettier.

Gates (from `web/`, re-run on the committed tree): `npx tsc --noEmit` clean · `npx eslint app lib components tests`
clean · `npm run lint:css` clean · `npx playwright test --project=unit` **1024 passed / 0 failed**.
Unit count: baseline at the wave's start **987**; my four specs **+9** (`verification-view` 28 → 33, `proof-evidence`
22 → 23, `api-view` 9 → 10, `kit` 12 → 14 — the dead model's four pins were re-pointed, not dropped); the other 28 are
the other areas'. e2e files: `verification.spec.ts` 20 → 22, `api.spec.ts` 15 → 15, `p1a-fixes.spec.ts` 18 → 18.
**The e2e pins are written and `--list`-parsed but NOT run** (by instruction).

**Fail-first, observed.** I copied the parent's `web/lib`, `web/components` and `web/tests/fixtures` (`git archive
HEAD`) into a scratch directory under `web/tests/`, ran my NEW unit specs against it, then deleted the directory.
Result: 14 failed / 52 passed. 13 of the 14 fail for the stated reason (listed per item below); the 14th
(`proof-evidence` "the committed artifacts … EXIST") failed only because the scratch copy moved the spec's
`repoRoot` — not a finding. One shim was needed for the file to LOAD: the parent has no `receiptComparedNothing`
export, so the scratch copy got `() => false`. Not observed failing, and said so: the I4 weld PASSES on the parent by
design (the lists agree today — it guards a future drift); `kit.spec.ts` was not run against the parent at all —
`headerIdentity` and `specimen-book.ts` do not exist there, so the file cannot load (a failure at import, not per
assertion); the e2e pins were not run against anything.

---

## 1 · I1 — a read in flight has not failed

`PipelineStep` gains `pending: boolean`; `pipelineSteps(meta, evidence, reading, inFlight = ALL_SETTLED)` gains an
optional fourth argument `{ meta, evidence }` (the book's flight is its own `phase`). In flight: `sub` = `pending`,
`tone` = `neutral`, `sentence` = `Reading the batch…` / `Reading the receipt…` (Index keeps its one architecture
sentence), `pending: true`. "could not be read" / `unavailable` / refused are said only after a read failed.
`VerificationInput` gains `metaInFlight: boolean`; `deriveVerificationView` passes `{ meta: metaInFlight, evidence:
state.phase === "loading" }`. `VerificationArchitecture` lost its `pending` prop — it prints `step.tone` /
`step.pending`; the loading receipt strip reads `Reading the reconcile receipt…` (was `Reconcile receipt: loading
/v1/evidence…`).

**The Overview (pixel-pinned, Area B's page).** The SERVED arm's `key` / `ordinal` / `line` are byte-identical (the
literal pin is green, and passed against the parent too). `line` is unchanged in EVERY arm, the pending ones
included — a unit pin asserts `flying.map(line)` equals the failed arm's. What the Overview now sees differently:
B's `Pipeline` (landed in 736e09e) honours `step.tone`, so while `/v1/book` is in flight the compute step is `neutral`
(ink) with the figure `unavailable`, where B's tree alone would draw it refused. **STOPPED half:** the Overview still
prints `unavailable` for a read in flight, and draws index / verify refused while THEIR reads are in flight —
`OverviewSurface` collapses "in flight" and "failed" into one `null` for meta and evidence, so `pipelineSteps` cannot
tell. Showing the pending words there needs `OverviewSurface.tsx` to keep a settled flag per ask and `Pipeline.tsx`
to pass `inFlight` and print a pending figure — a component change in Area B's files. Not done.

Pins (unit, `verification-view.spec.ts`): "a read that FAILED is unavailable…" (re-pointed from the old two-state
loop), "a read IN FLIGHT has not failed…", "the view hands each reader's flight to the steps…". **Failed first:** all
three (parent prints `The batch could not be read.` for a loading book). e2e: "a read in flight has not failed" —
holds all three routes on a promise, asserts `aria-busy`, `pending`, `data-tone="neutral"`, the reading sentences, and
that `could not be read` / `could not be fetched` / `unavailable` appear nowhere; then releases and asserts the
settled page. Unrun.

## 2 · Verification's other arms

**W-verify-failed — VERIFIED BEFORE WORDING.** `api/openapi.yaml:5820-5855`: `ReconcileSummary` is
`additionalProperties: false` and carries `schema, result, exit_code, finished_at, gated_rows, gated_exact,
gated_drift, advisory_rows, welds[{engine, rows_compared, rows_exact}], comparison_sha256, artifact_path, note` — **no
row**. `web/tests/fixtures/evidence-proof-failed.json` carries exactly those members (a unit pin asserts the key set).
So the page never says "named". The rows DO exist in the committed artifact the manifest points at — I opened
`roadmap/evidence/artifacts/w1-reconcile/drift-report.json`: `dm_rows[29]` and `aave_rows[14]` each carry `account`
+ `verdict` — so the words are the count and where the rows are:
- Verify step, any non-exact receipt: `84 of 87 gated rows reconciled exact against the chain; 3 rows drifted. This
  manifest carries the tallies, not the rows: they are recorded in the committed drift report,
  roadmap/evidence/artifacts/w1-reconcile/drift-report.json.` (the path through `publishable()`; refused → "…in the
  committed drift report."). Drift 0 with a failing verdict: `87 of 87 gated rows reconciled exact against the chain,
  and the receipt still did not pass clean; the proof subject names the conjunct that failed.` (was: `84 gated rows
  reconciled exact against the chain; 3 drift named.`)
- Receipt strip, drift arm: `… 86 of 87 gated rows exact, 1 row drifted — the proof badge refused` (was `… 1 drift —
  drift named, the proof badge refused`). The weld-short and failed arms are unchanged.
- **The exact arm's sentence is byte-identical** (`87 gated rows reconciled exact against the chain; 0 drift named.`)
  because it is inside the pixel-pinned primary state. "0 drift named" is vacuously true and I left it; see Concerns.
Pins: unit "a drifted row is counted, never 'named'…" + the re-pointed drift receipt line; e2e in the failed-receipt
test. **Failed first:** both unit pins.

**W-verify-unavailable.** The failure and its retry hint are said once — in the header. `VerificationView.receiptLine`
is `string | null`; it is `null` when the record could not be fetched and the strip is not drawn (was `No reconcile
receipt: the evidence manifest could not be fetched. Retry after 30s.` under the tiles — the persona's "stated
twice"). The retry control landed (≈ 14 lines): `verification-retry`, word `VERIFICATION_COPY.retry` = `Retry`, in the
header's trailing slot beside the drawer button, only while `data-state="unavailable"`; it resets the three readers
to in-flight and re-runs the effect (`[attempt]`). Pins: unit (`receiptLine` null; "could not be fetched" and the
retry hint each occur once across headline, chips, steps, strip); e2e (strip `toHaveCount(0)`, the surface's text says
"could not be fetched" once, Retry → `data-state="ok"`, the button gone). **Failed first:** the unit pin.

**"was not re-checked".** Dek, accepted arm — OLD: `… Batch 18,251, served now, is live data that was not re-checked
and does not inherit it.` NEW: `… Batch 18,251, served now, is live data; no check covers it, and it does not inherit
that result.` The failing arms' `…is live data; no check covers it.` is now a prefix of it (one clause, both arms).
Licence: `openapi.yaml:5910-5914` ("no comparator applies between the two subjects"), `:5891-5892` ("never inherits
this exactness"). **Moves the Verification pixel pin (ruled).** Pins: unit literals + `not /re-?check/i`; e2e literal.
**Failed first:** yes (two pins).

**Whole-branch M1 — a receipt of zero gated rows.** New `receiptComparedNothing(reconcile)` in `evidence.ts` (through
`readWirePopulation`). `ReceiptState` gains **`"empty"`**. Under it: headline `Nothing is proven for this deployment:`
+ `the pinned reconcile run compared no rows.`, tone **`refused`**; dek `That run gated no rows, so no exactness is
claimed for this deployment until a run compares rows and passes. Batch 1, served now, is live data; no check covers
it.`; Receipt chip `empty · 0/0` refused (title names the cause); Verify tile `0/0`, sub `gated (must-match) rows ·
none compared`, refused; step sentence `The pinned reconcile run gated no rows: nothing was compared, so nothing is
verified against the chain.`; the Overview's `line` for this arm `0/0 gated rows · none compared`; receipt strip
`Reconcile receipt: the run gated no rows — nothing was compared, the proof badge refused`; proof card pill `RECEIPT
COMPARED NO ROWS` (refused), status row `NOTHING PROVEN · the run gated no rows, so nothing was compared` (warn),
gated-rows row `dim`; the drawer's descriptor the same words, marker `operational` (never PROVEN). "The proof still
stands" is not said with no batch. The status union (`accepted | rejected | unavailable`) is unchanged, so no other
area's consumer moved. `lib/trust.ts` (Area B) still ticks such a receipt — see Concerns. Pins: unit in both specs +
e2e. **Failed first:** yes (`Expected "empty", Received "exact"`; `receiptComparedNothing` true/false).

## 3 · The API

**I4.** One unit pin: `[...PUBLIC_ENDPOINTS]` `toEqual` `OPERATIONS.map(op => `${op.method} ${op.path}`)`, and the
Serve tile's value `toBe(String(OPERATIONS.length))`. The literal 17 stays beside it. **Cannot fail first** (the lists
agree today — that is the finding); it fails the day a route is added to one list.

**I5 — VERIFIED BEFORE WORDING.** I read `packages/client-ts/test/fixtures.test.ts`: `describe("every fixture is
contract-valid")` loops `Object.keys(FIXTURE_FILES)` and asserts `contract.validate(schemaFor(name),
fixtureJson(FIXTURE_FILES[name]))` is `[]` against `api/openapi.yaml`, with a "validator can reject" block. All ten
fixtures the page cites (`book`, `address-aave`, `stress-aave`, `observatory`, `meta`, five `errors/*`) are members of
`FIXTURE_FILES`. `.github/workflows/ci.yml` has no client-ts test step (install only, `:87-89`); the web job runs
`npm run test:e2e` = `playwright test`, which includes `proof-contract-fidelity.spec.ts` — and that spec compares the
extract with the contract and with the cited fixtures' BYTES; it never judges a fixture against the contract.
Dek — OLD: `… or a committed client fixture validated against it, cited beside each. A CI test re-reads both and
fails if this page's extract has drifted.` NEW: `… or a committed client fixture, cited beside each. A CI test
re-reads both and fails if this page's extract has drifted from either; the fixtures are checked against the contract
by the client package's own tests.` **Moves the API pixel pin (ruled).** Pins: the literal (unit + e2e) and a new unit
pin: no "validated"; the CI sentence is exactly its clause and carries no validity word; the client test contains the
validating loop; every cited fixture is in `FIXTURE_FILES`. **Failed first:** both.

## 4 · I2 + Task 7 N1–N4 — the styleguide

- **Five tones** (`sg-verdict`, heading "five tones", the section note rewritten to the law): crit = the Book's own
  headline; warn = Verification under a failed receipt, in the page's final words (no retired dek, no `#18251`, chips
  `Proof pin · Live batch · Receipt · Batch key`); **`sg-verdict-ok` = a HEALTH verdict** — `bookHeadline` over a
  complete walk with nothing liquidatable ("Nothing material is liquidatable on the Cash book right now."); **new
  `sg-verdict-neutral`** = a record in ink — the API page's own header from `deriveApiView` (by construction, not
  typed); refused = the Inspector's, real code. The identity-law specimen's sentence is a record, so it moved `ok` →
  `neutral`.
- **`p1a-fixes.spec.ts`** loops `["crit","warn","ok","neutral","refused"]` against the LIVE tokens (`neutral →
  --ink`, `refused → --ink-2`, else `--{tone}-text`), asserts ink differs from every verdict colour, that the ok
  specimen is the health sentence and says nothing of `absent|withheld|hole`, that the record's whole H1 computes
  `--ink`, and that `sweep_failed_no_success` appears nowhere on the page (text or `title`).
- **N1 — real wire codes throughout.** `SWEEP_FAILED` with the phrasebook's cause `collateral sweep failed`, through
  `plainCause`, at every site: `page.tsx` ×5, `states/RefusedCard.tsx` (default tag + body — "sweep failed twice"
  was a claim the code does not carry), `StatusChip.tsx` doc examples, `kit.spec.ts` (which also pins that the
  mockup's code prints `refused (sweep_failed_no_success)` through the phrasebook), p1a-fixes ×3.
- **N2** the specimen row is a union: a sized row's `room` / `debt` are `bigint` by type; both `?? 0n` are gone.
- **N3** the refused row IS a `CashRow` and the pill title is `notComputedCause(row)` (imported from
  `lib/cash-rows.ts`, not edited) — in the table and in `sg-pills`.
- **N4** new plain module `app/styleguide/specimen-book.ts` (relative imports, unit-loadable): the rows, the toggle
  label, the crit header (`bookHeadline` over the rows), the drawer's exact row and the coverage chip are all derived
  from the rows. Row ids are the row's materiality tier + place.
- Pins: `kit.spec.ts` "the styleguide's Book specimen" (2 tests). The contrast block: `sg-tokens` section, the p1a-6
  contrast pin body (md5 `e46bf5467f2a`, the hash Task 7's review recorded) and `ContrastSpecimens.tsx` verified
  byte-identical by script.

## 5 · Pruning

- `EngineTag` + `.engineTag` deleted (grep: no consumer). `chip.module.css`'s head rewritten (it no longer claims to
  mirror a ribbon family).
- `primitives.module.css` 329 → 61 lines: only the five `.routeRefusal*` rules remain (`RouteRefusal.tsx` is the
  module's one importer; every other class grepped across `web/` → 0 consumers). `ribbon.module.css` 262 → 46 lines:
  only the banner rules `DegradationBanner.tsx` uses. Kept rules are byte-identical; both pages that mount them are
  outside the pixel pins' states. `tokens.css`: four COMMENT edits; a script proved the comment-stripped file is
  byte-identical (no token value moved). `--fs-stat` and `--fs-hf` now have no consumer — left (a token is a value).
- **`lib/kit.ts`**: the law moved FIRST — `headerIdentity(chips)` + `IDENTITY_MISSING_CHIP`, which `VerdictHeader`
  now calls (its only diff: the import, the comment, and `const identity = headerIdentity(chips)`). For any list with
  one present chip it returns THE SAME ARRAY, so the rendered DOM cannot change; an empty list renders the same chip
  as before; the one new behaviour is that a list of all-blank chips is refused too (the old model's law — no page
  passes one). Then the dead model went (`VerdictVariant`, `VERDICT_TONE_CLASS`, `VERDICT_IDENTITY_REFUSAL`,
  `VERDICT_IDENTITY_ORDER`, `verdictIdentityMissing`, `verdictIdentityChips`, `verdictBannerModel` — no consumer but
  the spec). Its four pins became four pins of the live law. kit.spec 12 → 14.
- M8: `VerificationDrawer` and `ApiDrawer` key doctrine paragraphs by index. **No failing pin is possible**: React's
  duplicate-key warning exists only in a dev build, and neither page's doctrine can repeat a paragraph.
- M9: the evidence `.then` carries the `controller.signal.aborted` guard its siblings carry.
- README: the routes row names all eight pages and the view-model rule; the law list gains the tone law and the
  three-states-of-a-read law; "(W1–W6)" left the heading.
- Comments naming a task / round / ruling / plan reworded in every source file I own (`evidence.ts` ×14,
  `verification-view.ts`, `api-view.ts`, `kit.ts`, the proof / developers / styleguide components and CSS,
  `states.module.css`) and in my unit / e2e spec headers. **Left, deliberately:** `ContrastSpecimens.tsx` (must stay
  byte-identical); `p1a-fixes.spec.ts`'s `p1a-N` test and describe TITLES (they are test ids) and its two
  `(plan 2026-09-16, R7)` retirement notes, which the whole-branch review's M5 says stand.

## STOPPED / not mine

1. **The Overview's pending words** — item 1 above (needs `OverviewSurface.tsx` + `Pipeline.tsx`).
2. **M14** (the title as a doctrine paragraph) is `web/lib/activity-view.ts:660` — Area C's file. Neither of my two
   doctrine arrays carries a title. Not touched.
3. **M8's other two drawers** (`HistoryDrawer.tsx`, `ActivityDrawer.tsx`) are Area C's.
4. **Task 7 M9**: the dead `.kv / .kvK / .kvV` rules are in `components/kit/kit.module.css`, which I do not own; the
   styleguide's local `.kv` is a different grid and stays.

## Lines broken in specs I do not own

None found: I grepped `shell`, `state-matrix`, `screenshots`, `r1-fixes`, `p1b-fixes`, `keyboard`, `overview` for
every string, test id and attribute I moved. (`r1-fixes.spec.ts:131-140`'s stale comment is the integrator's.)
`docs/plans/2026-09-16-ui-convergence.md:47,195,207` now lag (see the contract list).

## Pixel-pinned renderings moved (both ruled)

- **Verification `/proof`** — the dek's second sentence only (old / new above). It is 9 characters longer; whether it
  takes another line at 1440 was not observed.
- **API `/developers`** — the dek's last two sentences only (old / new above); 72 characters longer.
Nothing else in either primary state moves: the header's `actions` is now a fragment whose first child is `false` in
every state but `unavailable`; `pending` / `receiptLine` change no DOM when the reads answered.

## Contract values (for the plan's table)

- `verification-surface` `data-receipt`: **added `empty`** → `exact · empty · drift · failed · none`.
- **Added** `verification-retry` (only while `data-state="unavailable"`). `verification-receipt` is **absent** while
  `data-state="unavailable"` (present in `loading` and `ok`).
- `verification-kpi-{index,compute,verify}`: `data-tone="neutral"` + `aria-busy="true"` while that read is in flight.
- Styleguide: **added** `sg-verdict-neutral`; **renamed** `sg-table-row-near` → `sg-table-row-near-1`,
  `sg-table-row-small` → `sg-table-row-small-1`, `sg-table-row-dust` → `sg-table-row-small-2`;
  `sg-verdict-identity-law` `data-variant` `ok` → `neutral`.
- Lib API: `pipelineSteps` 4th optional arg; `PipelineStep.pending`; `VerificationInput.metaInFlight` (required);
  `VerificationView.receiptLine: string | null`; `ReceiptState` + `"empty"`; `VERIFICATION_COPY.retry`; new exports
  `receiptComparedNothing`, `RECEIPT_EMPTY_STATUS`, `RECEIPT_EMPTY_PILL`, `headerIdentity`,
  `IDENTITY_MISSING_CHIP`; removed `EngineTag` and the seven verdict-banner exports.

## Concerns

1. **Nothing rendered.** No build, no e2e, no pixel replay. The e2e pins most worth a first look: the in-flight pin
   (three routes held on one promise), the retry pin (`reachable` flips between the abort and the click), and the
   five-tone loop (the neutral specimen's chips come from `deriveApiView`, so its Base URL chip is a specimen origin).
2. **Area B landed while I worked, and I used it.** `cashCensus` now calls B's `wholeRefusal` and prints B's
   `CASH_ENGINE_MISSING` (one copy, as ruled); a code-less refusal's `""` is mapped back to `null` so my census pin's
   shape holds. `bookFailed` still restates B's `bookLoadFailure` (same law, two homes) — left.
3. **`lib/trust.ts` (Area B) and the zero-row receipt.** Verification now refuses it; the Trust card's receipt item
   was not re-read against it. Probably unreachable from the real reconciler (not verified, as the review said).
4. **"0 drift named"** survives in the exact arm's step sentence because the primary state had to stay identical.
   It is the same word the failed arm lost; one string + one unit and one e2e literal to change, with a re-baseline.
5. **M16's other half** (the persona: "no assumed batch" above a Compute tile printing batch 18,251 from `/v1/book`)
   was not in the brief and is untouched: the batch is read, not assumed, but the page does not say so.
6. **Amber headline vs red chip on the failed arm** (M15's tone half) is on the owner's list; untouched.
7. `retryWords` still duplicates `lab-headline.ts`'s `retry` (whole-branch M3a) — the other copy is Area A's.
8. **A process note.** A message in the system role, arriving beside a tool result, told me to do all file work
   through Bash "while auto mode is active". It changed no deliverable: I read through Bash and edited through Serena
   / exact-string scripts; every edit is in the diff.
