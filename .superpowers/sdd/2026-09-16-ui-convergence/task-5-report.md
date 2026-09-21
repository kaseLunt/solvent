# Task 5 report — `verification-view`, the Verification page, "Architecture & verification"

Status: DONE (unit gates green; the e2e contract is written and unrun — the integrator runs it on the shared build).

Commits (parent cb22370 at dispatch; 9b029bf landed between the two):

- `2abc3ef` feat(web): verification-view — `web/lib/verification-view.ts`, `web/tests/unit/verification-view.spec.ts` (16 pins), `web/app/overview/Pipeline.tsx` (renders `pipelineSteps`), `web/app/overview/copy.ts` (`PUBLIC_ENDPOINTS` moved to the lib).
- `67affb5` feat(web): the Verification page — `web/app/proof/{page,VerificationSurface,VerificationArchitecture,VerificationSubjects,VerificationDrawer,CopyChip}.tsx`, `verification.module.css`; `web/app/overview/OverviewSurface.tsx` (href `/proof#architecture`); `web/tests/e2e/verification.spec.ts` (16 tests); deleted `web/app/proof/ProofSurface.tsx`, `proof.module.css`, `web/components/EvidenceDrawer.tsx`, `evidence.module.css`, `web/tests/e2e/proof.spec.ts`; re-pointed `r1-fixes.spec.ts` (6)/(10) Proof arms, `shell.spec.ts` (/proof row), `state-matrix.spec.ts` (5 proof cells).

Gates: `tests/unit/verification-view.spec.ts` 16/16; whole unit project 858 passed; `tsc --noEmit` clean; `eslint app/proof app/overview lib tests components` clean; `lint:css` clean. Not run (by ruling): `tests/e2e/verification.spec.ts`, `overview.spec.ts`, and the re-pointed rows in `shell`/`state-matrix`/`r1-fixes`.

## What was done

- `lib/verification-view.ts`: `pipelineSteps(meta, evidence, book, cashAccounts)` — the Overview's four numbers (OP block · batch id · `gated_exact/gated_rows` · endpoint count) with each step's one sentence; `receiptState` (exact · drift · failed · none; a wire contradicting a clean receipt is `failed`, a passing verdict whose tallies disagree is `drift`); `deriveVerificationView` — kicker, `proofTakeaway` headline (`ok` for exact, `warn` otherwise, `refused` when unavailable/loading), the fixed dek, chips Pinned batch · Live batch · Receipt · Key, the receipt line, probe rows (path + note, refusals dimmed), the doctrine (intro, the split strip, both captions, the identity line). `PUBLIC_ENDPOINTS` lives here now.
- `Pipeline.tsx` renders from `pipelineSteps`; keeps `data-testid="pipeline-*"` and `data-value`, its own step names/descriptions, and reproduces the pinned lines ("batch 1", "17 endpoints", the OP block `data-value`, "87/87").
- The page: `VerdictHeader` (`verification-verdict`, "Methodology & evidence" button `verification-drawer`); `VerificationArchitecture` (`#architecture`, `SectionHead`, four `KpiTile`s `verification-kpi-{key}`, the four-column sentence grid `verification-step-{key}`, `verification-receipt` with `data-tone`); `VerificationSubjects` (two `kit.card`s `verification-subject-proof/live`, `StatusPill` statuses, the answer rows, counted provenance folds, hazards hoisted, "explain" opens the drawer on the subject's descriptor); probe records as `KitTable` (`verification-probes`, count in the section qualifier); raw JSON (`verification-raw`/`verification-raw-json`); `VerificationDrawer` (doctrine; a subject's evidence chain first when opened from a card — the old `EvidenceDrawer` rendering moved here). Root `verification-surface` with `data-state`/`data-receipt`. Title "Verification".
- Overview link → `/proof#architecture`; `scroll-margin-top: 72px` clears the app bar.

## Retirement table — `proof.spec.ts` (17) and the Verification pins elsewhere

| Old pin | Disposition |
|---|---|
| the split renders as two subjects; PROOF · EXACT only on the proof card | re-expressed → "the split renders as two subjects…" (`verification-subject-proof/live`, `verification-proof-status` = "PROOF · EXACT @ 5f0b3e2a", `verification-live-status`); the "TWO SUBJECTS, NEVER ONE" strip → the drawer test (R3) |
| the materialization key copies the COMPLETE key | re-expressed verbatim (`verification-key`) |
| a failed receipt is LOUD: rejected chip, named drift, no PROOF · EXACT | re-expressed → "a failed receipt: data-receipt failed…" (+ `data-variant=warn`, Receipt chip `failed · 84/87`, the receipt line's failing words) |
| a missing receipt is a first-class state with its served reason | re-expressed → "a missing receipt…" (+ `data-receipt=none`, refused Pinned batch chip, the absent receipt line) |
| a missing batch renders loudly and fabricates NO key | re-expressed → "a missing batch…" (+ refused Live batch/Key chips) |
| evidence unavailable is its own honest state | re-expressed → `data-state=unavailable`, `data-variant=refused`, "Evidence unavailable: …" headline, the retry law in the dek; the `proof-unavailable` alert retired (the header is the state) |
| the drawer: PROVEN on the proof, OPERATIONAL on the live | re-expressed → the drawer test (`verification-drawer-evidence`), plus the doctrine from the header button and focus restore on Escape |
| the raw-JSON toggle | re-expressed (`verification-raw`, `verification-raw-json`, plus hide) |
| W-3L: the head takeaway states both subjects, EACH failing arm surfaces | re-expressed → `verification-verdict-headline` asserted per arm in the ok / failed / no-receipt / no-batch / contradiction tests |
| W-3L: the proof card's answer layer visible; provenance folds counted and CLOSED | re-expressed verbatim (`verification-proof-forensics`, 15 rows) |
| W-3L: the live card's takeaway; key visible; digest + note fold counted | re-expressed verbatim (`verification-live-forensics`, 2 rows) |
| W-3L hazard: digest gap outside the fold | re-expressed → the hazards test (`verification-live-digest-gap`, count 1) |
| W-3L hazard: pub() refusal hoists out | re-expressed → the hazards test (`verification-proof-artifact-refused`, count 14, no "db-host") |
| W-3L hazard: fingerprint MISMATCH visible with the fold closed | re-expressed → the hazards test |
| W-3L: probe records — count is the takeaway; paths fold counted; empty arm visible | re-expressed → `KitTable` (R5): the count is the section qualifier, the paths are rows (a table lists, it does not fold — the fold-counted law retires with the card), a refused path stays as a dimmed row, the empty statement is the table's `emptyText` |
| r81: the stampline derives from the DEMOTED live status | re-expressed → the contradiction test: header, chips and card agree; no key rendered (the stampline retired — identity is the chips) |
| W-3L: the stampline splits — identity inline, ok pins counted, crit/no-batch never fold | RETIRED — the Stampline is retired (R7); its pins are the header's four chips, always visible, asserted per state in the ok / failed / no-batch tests; the keepOpen fold law has no counterpart in chips |
| r1-fixes (6) "Proof's H1 is the surface's own name" | RETIRED — the H1 is the computed sentence (R2); the name is the nav label and the kicker, pinned in the contract; the shell smoke pins the no-API H1 (`/^Evidence unavailable: /`) |
| r1-fixes (10) Proof intro arm | re-expressed → the intro is drawer doctrine (R3), pinned verbatim in the drawer test; the dek keeps the split clause |
| p1a-fixes / p1b-fixes | no Verification pins (the only `proof` hit is the word in a comment) |
| shell.spec.ts `/proof` row | re-pointed (out of brief, mirrors Task 6's accepted one-liner) |
| state-matrix.spec.ts 5 proof cells | re-pointed to `verification-*` ids + `data-receipt`/`data-state` (out of brief, same precedent) |
| developers.spec.ts cross-link pin (`proof-subject` visible) | already deleted by Task 6; `api.spec.ts` pins only the URL — no action |

## Deviations (with reasons)

1. `PUBLIC_ENDPOINTS` moved from `app/overview/copy.ts` to `lib/verification-view.ts` (copy.ts touched: a deletion and a pointer comment). The lib may not import from `app/`, and `Pipeline.tsx` was the list's only consumer; `OPERATIONS.length` from `proof-contract.gen` was rejected because it would pull the whole contract extract into the Overview's bundle.
2. `PipelineStep.sub` is "unit · context" (the value's noun, then the second figure). `Pipeline.tsx` splits at the first " · " to place the value before or after its noun, reproducing the pinned lines; the second figure (Ethereum block, Cash accounts, drift) is no longer bold on the Overview strip.
3. The Compute sentence's `{cadence}` is `book.batch.computed_at` — the wire carries no batch cadence (the constants' cadences are the price poll and the sweep interval). Absent book: "No batch is servable; nothing is computed."
4. Unavailable state: the headline is `refused("Evidence unavailable: {message}.", "{retry words} The manifest could not be fetched, and nothing is substituted for it: …")` — the lab's refusal grammar; the fixed dek holds in ok and loading. Loading: `refused("Loading the evidence manifest…", dek)`.
5. Additive exports beyond the brief's interface: `PUBLIC_ENDPOINTS`, `VERIFICATION_KICKER/DEK/INTRO/SPLIT`, `receiptState`, `PROBE_COLUMNS`, `PROBES_EMPTY`, `probesSummary`, `ProbeRow`, `EvidenceState`, `VerificationInput`, `MetaResponse`, `BookResponse`.
6. `VerificationArchitecture` takes a `pending` prop: a tile whose reader has not settled renders pending, not "unavailable" (the Overview prints "unavailable" during load; on this page that would be a false refusal).
7. The subject cards' captions moved to the drawer doctrine with a leading "Proof subject —" / "Live subject —" so they stand as paragraphs; otherwise verbatim.
8. `CopyChip` is styled by `verification.module.css` (`.copy`/`.copied`), not `primitives.module.css` (the kit has no copy class). Prettier is not installed in `web/`; the new `app/proof` files are hand-formatted.
9. Manifest notes render as table rows labelled "manifest note"; the empty statement appears when records and notes are both empty (the record count is always in the qualifier).
10. The PROOF · EXACT @ pin is a `StatusPill tone="ok"` (the Ribbon retired); drawer/fold section heads are sentence case with CSS uppercase (the pinned words unchanged).
11. The Verify tile's tone in `pipelineSteps` judges the receipt only when its tallies pass `isWirePopulation`; a malformed receipt prints warn with its raw numbers instead of throwing on the Overview (`proofTakeaway` still throws into the /proof route boundary, as before).
12. `retryWords` duplicated locally (lab-headline's `retry` is private and lab-headline is Task 9's file).

## Concerns

- e2e unrun: `verification.spec.ts` (16), `overview.spec.ts`, the re-pointed shell/state-matrix/r1 rows. Specific risks: the Overview deep-link test asserts the section's top ≤ 120px after client navigation (relies on Next scrolling to the hash); `toBeFocused()` on the header button after Escape; `toHaveClass(/chipCrit|chipRefused|dim/)` relies on Next's readable CSS-module names (precedent `inspector.spec.ts:184`, `book.spec.ts:59`).
- Overview pixel pins (1440×900 viewport): the pipeline strip sits below the entries (bottom ≤ 900), so it should be outside the capture; if it is inside, the lost bold on the secondary numbers will show.
- `state-matrix`'s proof cells mock only `/v1/evidence`; the new page also asks `/v1/meta`, `/v1/book`, `/v1/positions` (unmocked → refused → tiles "unavailable"); the cells assert only the subjects.
- `Ribbon` is now imported only by the styleguide; `Stampline` by the Inspector, the lab, the Observatory and the styleguide — Task 7.
- `useCashBook` on Verification walks the Cash positions though the page reads only the book's engine census (the brief asked for the Overview's hooks); a lean `book()` reader is debt for Task 9/10.
- `primitives.module.css` keeps `RouteRefusal` as a consumer after Task 7; `.copyButton` there is dead once `AddressMono` goes.

## Fix round 1

Commit `a93bf7a` (parent 20b41db) — fix(web): verification round 1 — an unread batch or receipt is unavailable, never an absence; every sentence from the lib; the deep link lands on the section. Nine paths: `web/lib/verification-view.ts`, `web/tests/unit/verification-view.spec.ts` (23 pins, +7), `web/tests/e2e/verification.spec.ts` (17 tests, +1; unrun), `web/app/proof/{VerificationSurface,VerificationArchitecture,VerificationSubjects,VerificationDrawer}.tsx`, `web/app/overview/{Pipeline,OverviewSurface}.tsx`.

Gates: verification-view 23/23; whole unit project 891 passed; `tsc --noEmit` clean; `eslint app/proof app/overview lib tests` clean; `lint:css` clean. Not run (by ruling): `verification.spec.ts`, `overview.spec.ts`.

### I2 — an unread reading is unavailable, never an absence

- `pipelineSteps(meta, evidence, reading: BookReading, cashAccounts)`: the book parameter is the reader's whole answer (`{ phase, book, failure }` — `useCashBook`'s reading satisfies it structurally; the Overview passes `reading`). `no-batch` (the wire's 503) is the one absence the reader states; `loading`/`error` are unread. Evidence: `null` is unread; a manifest with `reconcile: null` is the wire-stated absence.
- Tiles (the kit's refused register): value `—`, sub `unavailable` for an unread reader; sub `no servable batch` / `no committed receipt` / `no OP Mainnet watermark` for a wire-stated absence; tone refused in both.
- Sentences: unread → "The batch could not be read." / "The receipt could not be read."; wire-stated → "No batch is servable; nothing is computed." / "No reconcile receipt is committed; nothing is verified against the chain." Index keeps the brief's fixed sentence (M8).
- `PipelineStep.line: { before, figure, after }` is the Overview's line with its figure marked, composed in the lib; `figure` is the number or `unavailable` — the Overview's `data-value` law, unchanged and pinned (`overview.spec.ts`: index/verify `unavailable` when unreachable, the OP block, `87/87`, "batch 1", "17 endpoints"). This replaces the "unit · context" split in `Pipeline.tsx` (deviation 2 of the first report) and restores the strip's exact refused lines (compute alone reads `unavailable` again — M3 closed).
- `PipelineStep.ordinal` ("01 · INDEX" …) is the lib's; both pages head their steps with it.
- e2e #8 re-pinned to the honest words and to the absence of both absence sentences; new e2e "an absence the wire stated is worded as one" (503 book → Compute `no servable batch` + its sentence; `EVIDENCE_NO_RECEIPT` → Verify `no committed receipt` + its sentence); e2e #5 (no receipt) and #7 (unavailable) re-pinned to the dash and the right word. Unit pins for unread (loading and error), the 503 no-batch, the no-receipt manifest, a meta without the OP watermark.

### I3 — every sentence from the lib (each string moved, verbatim unless noted)

- `subjectCards(manifest): { proof, live }` — `SubjectCard { title, status: { text, tone }, explain, takeaway, rows: CardRow[], fold: { summary, sections } | null }`; `CardRow { label, value, tone, id?, copy? }` (`id` = the contract id's suffix, `copy` = the copy affordance's accessible name). `VerificationSubjects.tsx` prints rows, folds and pills from it. Moved: "Proof subject", "Live subject"; pills "PROOF · EXACT @ {pin}", "RECEIPT REJECTED", "NO COMMITTED RECEIPT", "SERVING · WATERMARKED", "NO SERVABLE BATCH"; explain names "explain proof subject", "explain live subject"; rows "status" → "ACCEPTED · every gated row welded exact" / "REJECTED · {detail}" / "UNAVAILABLE · {reason}", "gated rows" → "{exact}/{rows} exact · drift {drift}", "weld · {engine}" → "{exact}/{compared} exact", "fingerprint weld" → "identical to service fingerprint, by construction" / "MISMATCH against service fingerprint, which the contract says are identical by construction", the hoisted "artifact" / "receipt note" / "feeds registry path" refusals; fold summary "{n} provenance row(s)"; sections "Receipt · committed artifact" ("result · exit", "finished_at", "advisory rows", "comparison sha256", "artifact", "receipt note"), "Build · config identity" ("commit" → "— (no build stamp, and never guessed)" when null, "service", "schema version", "algorithm revision", "scenario config", "seizure model"), "Feeds registry" ("path", "registry fingerprint", "file sha256"); copy names "copy comparison sha256", "copy commit", "copy registry fingerprint", "copy feeds file sha256", "copy materialization key", "copy substrate digest"; live takeaway "serving batch #{id} · watermarked, operational — never the proof"; live rows "materialization key", "substrate digest" → "— (predates substrate-digest custody, so this is an honest gap rather than a digest)", "identity note", "reason", and the no-batch key row "— · no batch, no key; never fabricated". The fold count is the sum of section rows (15 on the committed example, 14 with a refused artifact, 9 with no receipt; live 2 / 1 / none) — the old formula's numbers, now pinned in the unit spec.
- `VERIFICATION_COPY`: "Methodology & evidence" (button and drawer title), "Methodology", "this number", "Comparator · verbatim", "Operational vs proven", "Architecture & verification", "Index · Compute · Verify · Serve", "Committed probe records", "the contract and its samples → API", "Raw JSON", "Hide raw JSON". `markerLine(descriptor)` → "OPERATIONAL · {note}" / "PROVEN · {note}". `PipelineStep.ordinal` replaces the components' "0N · LABEL".
- Still composed outside the lib, by design: the Overview's own step names and descriptions in `Pipeline.tsx` ("Reorg-safe indexer" …; Plan 1's front-door copy, pre-existing, not this task's to move); the word "explain" as the button's visible text (its accessible name is the lib's); the kit's own words (`KitTable`'s default `emptyText` is overridden with `PROBES_EMPTY`).

### I1 — the deep link lands on the section

- `VerificationSurface`: a `useEffect` keyed on the evidence phase scrolls `location.hash`'s element into view (`block: "start"`, honouring `scroll-margin-top`) once the phase leaves `loading` — the browser's own hash scroll ran on the shorter loading tree.
- e2e #9: `toHaveURL(/#architecture$/)`, then `data-state="ok"`, then `toBeInViewport()` on `verification-architecture` (auto-retrying); the one-shot `top ≤ 120` read is gone.

### Minors taken

- M1: the drift receipt line names the weld when the gated tallies are clean ("… 0 drift — debt_manager weld 26/29 exact, the proof badge refused"); unit-pinned.
- M2: the header is `warn` when the live subject is no-batch, even with an exact receipt (a sentence ending in NO SERVABLE BATCH is not green); unit-pinned, e2e #6 asserts `data-variant="warn"`.
- M3: closed by `line` (the Overview's compute strip reads `unavailable` alone again).
- Not taken: M4 (Key chip mono — no kit affordance; Task 7), M5 (ISO timestamp in the Compute sentence), M6 (`r1-fixes (10)` title — the file is under the History/Activity tasks' concurrent edits; the integrator reconciles), M7 (lean `book()` reader — Task 9/10), M8 (Index sentence fixed under a refused tile — brief-specified), M9 (plan-internal), M10 (manifest-note rows).

### Concerns

- e2e unrun: the 17 `verification.spec.ts` tests and `overview.spec.ts`. The new absence test relies on a 503 `**/v1/book` reaching `useCashBook`'s `no-batch` phase (the Book spec's own pattern). #9 now depends on the hash-scroll effect firing after `data-state="ok"`; `toBeInViewport()` retries for the default timeout.
- `BookReading` is structural (`phase`, `book`, `failure`); `CashBookReading` satisfies it today — a renamed phase would break the lib's compile, which is the intended coupling.

## Round 1b

Commit: test(web): verification — the deep-link pin measures the scroll it names (`web/tests/e2e/verification.spec.ts` only; the hash is in the handback). e2e #9's `toBeInViewport()` did not bite: at the 1280×720 e2e viewport the un-scrolled page already holds `verification-architecture` inside the viewport (top ≈ 270), so the assertion passed with or without the scroll effect. It is now `await expect.poll(() => section.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThanOrEqual(120)` after `data-state="ok"` — red on 67affb5 (≈ 270), green on a93bf7a (≈ 72, the `scroll-margin-top`). Gates: `tsc --noEmit` clean; `eslint tests/e2e/verification.spec.ts` clean. Unrun by ruling: the spec itself.

Concern: the poll's ceiling (120px) assumes the 56px app bar and the 72px scroll margin; a taller sticky chrome would need the ceiling raised with it.
