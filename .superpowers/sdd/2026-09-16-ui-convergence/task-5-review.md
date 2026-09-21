# Task 5 review — `verification-view`, the Verification page, "Architecture & verification"

Reviewer: read-only; nothing run, nothing edited. Package: `review-9b029bf..67affb5.diff` covers **one** commit (`67affb5`, the page); the lib commit `2abc3ef` (`lib/verification-view.ts`, `Pipeline.tsx`, `copy.ts`, the unit spec) predates `9b029bf` and is not in the package — it was read from `git show 2abc3ef`. Both are judged here.

**Verdicts**

- **Spec Compliance: ✅** — the brief's interface, the plan's R1–R5/R8 words and ids, the 17-pin retirement ledger and the Overview's pins all trace; deviations are recorded in the report except the two named under Important.
- **Assessment: APPROVE WITH FIXES** before the shared e2e run — no Critical; three Important (one likely-red e2e pin, one honesty register in the step sentences, one Global-Constraint exemption the report did not record).

---

## 1. Spec Compliance (trace)

| Requirement | Verdict | Trace |
|---|---|---|
| `pipelineSteps(meta, evidence, book, cashAccounts)` — the Overview's four numbers, unchanged in law | ✅ | `lib/verification-view.ts:131–187`: index `n(dm.last_block)`, compute `n(book.batch.id)`, verify `${n(gated_exact)}/${n(gated_rows)}`, serve `String(PUBLIC_ENDPOINTS.length)`; same `find(engine === CASH/LEGACY)`, same `UNAVAILABLE` word as the deleted `Pipeline.tsx:14–20` |
| `Pipeline.tsx` renders from `pipelineSteps`; `pipeline-*` ids and `data-value` kept | ✅ | `app/overview/Pipeline.tsx` (2abc3ef): `data-testid={\`pipeline-${step.key}\`} data-value={step.value}`; `StepValue` re-places the number before/after its noun by `VALUE_LEADS` — see the Overview-pins table below |
| `ReceiptState` law exact · drift · failed · none | ✅ | `verification-view.ts:93–102`: none ⇐ `proofSubjectStatus.kind === "unavailable"` (reconcile null, `evidence.ts:559–562`); exact ⇐ accepted (wire and the derived conjunction agree, `evidence.ts:620–643`); failed ⇐ verdict not pass / exit ≠ 0 / wire rejects a clean receipt; drift ⇐ pass + exit 0 but tallies disagree. Unit-pinned on all four fixtures + two doctored contradictions (`tests/unit/verification-view.spec.ts:95–113`) |
| `none` honest when the manifest has no receipt | ✅ | `EVIDENCE_NO_RECEIPT`: `reconcile: null`, `reconcile_unavailable_reason` set → receipt `none`; the receipt line quotes the served reason (`receiptLine` case none; e2e pin 5 asserts the exact string); the Pinned-batch and Receipt chips refuse with the reason in `title` |
| Headline `warn` for drift/failed/none; `ok` only for exact | ✅ | `verification-view.ts:398` `tone: receipt === "exact" ? "ok" : "warn"`; unit pins 7–9 |
| R1 kicker "Verification · this deployment" | ✅ | `VERIFICATION_KICKER` (`:52`); type-literal on `VerificationView.kicker` |
| R2 headline = `proofTakeaway(manifest)`, emphasis whole, `rest: ""` | ✅ | `:398`; unit pin 6 asserts equality with `proofTakeaway(EVIDENCE_MANIFEST)` |
| R3 dek "Two subjects, never one: the pinned proof and the live batch." | ✅ ok/loading; ⚠ unavailable | `VERIFICATION_DEK` (`:54`); in the unavailable state the dek becomes the retry law + `NO_SUBSTITUTE` (report deviation 4, the lab's grammar). The clause survives in the drawer doctrine (`VERIFICATION_SPLIT`) |
| Chips Pinned batch · Live batch · Receipt · Key | ✅ (Key not `mono`) | `chips()` `:240–275`; every state emits all four (`unknownChips` for loading/unavailable) — Global Constraint "never without its chips" holds. The brief's `mono` on Key has no kit affordance (`IdentityChip` carries no such flag) — Minor M4 |
| Step sentences (Index / Compute / Verify / Serve) | ✅ words; ⚠ refused registers | `:141–143, 166–186`. Compute's `{cadence}` is `book.batch.computed_at` (report deviation 3); Serve counts 17. Absent arms never print a zero — but see **I2** for what they do print |
| "Architecture & verification" section, `#architecture`, Overview href | ✅ | `VerificationArchitecture.tsx:29` `id="architecture" data-testid="verification-architecture"`; `OverviewSurface.tsx:188` `/proof#architecture`; `verification.module.css:8` `scroll-margin-top: 72px` |
| R4 four `KpiTile`s + one sentence each + receipt beneath Verify | ✅ | `verification-kpi-{key}` with `tone`/`pending`, `verification-step-{key}`, `verification-receipt` `data-tone` (`VerificationArchitecture.tsx:33–61`) |
| Two subject cards, content preserved | ✅ | `VerificationSubjects.tsx` vs deleted `ProofSurface.tsx:95–290`: status rows, gated rows, per-engine welds, fingerprint weld, hoisted `pub()` refusals, identical `foldCount` formula, the three fold sections, the live takeaway verbatim, digest-gap and note hazards, the no-batch "— · no batch, no key; never fabricated" row. Ids renamed under the `verification-` prefix. Captions → drawer doctrine with "Proof subject —"/"Live subject —" leads (deviation 7) |
| "explain" opens the drawer on the descriptor; the old `EvidenceDrawer` rendering preserved | ✅ | `VerificationDrawer.tsx:31–62`: "this number" row, sections/rows with tone classes, "Comparator · verbatim" `<pre>`, "Operational vs proven" with `OPERATIONAL · `/`PROVEN · ` + `markerNote` — the deleted `EvidenceDrawer.tsx:38–70` line for line; titles now sentence-case with CSS uppercase |
| R5 probes as `KitTable`, the card's columns and words | ✅ | `PROBE_COLUMNS` path/note (`:196–199`), `PROBES_EMPTY` verbatim (`:203`), `probesSummary` = the old takeaway string (`:206–209`); refused rows kept, dimmed, counted; notes as rows labelled "manifest note" (deviation 9) |
| Raw JSON toggle | ✅ | `verification-raw` (aria-pressed) / `verification-raw-json` (`VerificationSurface.tsx:146–163`) |
| Root `verification-surface` `data-state`/`data-receipt` | ✅ | `VerificationSurface.tsx:103–107`, plus `aria-busy` while loading |
| Title "Verification" | ✅ | `page.tsx` metadata |
| Deleted files had no other consumers | ✅ | grep over `web/` for `EvidenceDrawer`, `ExplainButton` (same module path), `evidence.module.css`, `ProofSurface`, `proof.module.css`, `ProbeRecordsCard`, `ProofSubjectCard`, `LiveSubjectCard`: zero hits. `PUBLIC_ENDPOINTS`: only the lib, its spec and the pointer comment in `copy.ts` |
| `PUBLIC_ENDPOINTS` move (controller-accepted) | ✅ | `copy.ts` leaves a pointer comment; the lib documents why it is names-only |
| Copy lives in `web/lib/**`, never composed in components | ❌ (brief-licensed, unrecorded) | see **I3** |
| Tokens only in CSS | ✅ | `verification.module.css`: every color/type/weight is a `var(--…)`; px only for spacing/radius as the kit's own module does; no hex; floor size `--type-floor` |
| Unit count does not decrease | ✅ | +16 in `tests/unit/verification-view.spec.ts` (count verified by reading the file) |
| Process: comments state the law, not the round | ✅ | no round/review references in the new files; W-3L/r81 tags dropped from the moved comments |

### 1a. Overview pins — `tests/e2e/overview.spec.ts` vs the refactored `Pipeline.tsx`

| Pin (`overview.spec.ts`) | Asserts | New emission | Match |
|---|---|---|---|
| `:38` `pipeline-index` | `data-value` = `dm.last_block.toLocaleString("en-US")` ("154,796,552") | `step.value = n(dm.last_block)` → `data-value={step.value}` | ✅ |
| `:39` `pipeline-compute` | contains `"batch 1"` | `VALUE_LEADS.compute=false` → `{unit} {value}` with `unit="batch"` (sub `"batch · 2 Cash accounts"` split at first ` · `) → text "batch 1 · 2 Cash accounts" | ✅ |
| `:42–45` `pipeline-verify` | `data-value` = `"87/87"` | `step.value = "${n(gated_exact)}/${n(gated_rows)}"` | ✅ |
| `:46` `pipeline-serve` | contains `"17 endpoints"` | `VALUE_LEADS.serve=true` → `{value} {unit}` → "17 endpoints · typed TypeScript client" | ✅ |
| `:58–60` unreachable: `pipeline-index`, `pipeline-verify` | `data-value="unavailable"` | `dm===null → UNAVAILABLE`; `recon===null → UNAVAILABLE` | ✅ |
| (visual, unpinned) index line | old: `OP block <b>X</b> · Ethereum block <b>Y</b>` | new: `OP block <b>X</b> · Ethereum block Y` (bold lost on the second figure — report deviation 2) | ✅ pins; visual noted |
| (visual, unpinned) compute with `book===null` | old: `<b>unavailable</b>` | new: `batch <b>unavailable</b>` — wording change not in the report | ✅ pins; Minor M3 |
| (visual, unpinned) verify with `recon===null` | old: `<b>unavailable</b> gated rows exact` | new: identical | ✅ |

The Overview's pins do not move.

### 1b. e2e pin plausibility — `tests/e2e/verification.spec.ts` (16 tests, unrun)

Ids resolved against what the components emit: `VerdictHeader` → `{testId}`, `{testId}-headline`, `{testId}-dek`, `{testId}-identity` with `data-variant`; `IdentityChips` → `[data-chip=label]`; `KpiTile` → `data-tone`; `KitTable` → `styles.dim` on refused rows; `StatusPill` inside the `verification-{proof,live}-status` spans.

| # | Test | Ids resolve | Strings trace | Plausibility |
|---|---|---|---|---|
| 1 | committed example: ok, exact, headline, dek, 4 chips, 4 tiles, 4 sentences, receipt line, order | ✅ all | headline = `proofTakeaway` string (unit pin 6); tile values `154,796,552 / 1 / 87/87 / 17`; "batch · 2 Cash accounts" — `deriveCashView(BOOK).positions` = `engines[debt_manager].positions` = 2 (`book.json`) ✓; receipt line exact ✓ | ✅ (tiles are `pending` until meta/book land — retrying assertions absorb it) |
| 2 | two subjects; PROOF · EXACT only on proof | ✅ | pill text `PROOF · EXACT @ 5f0b3e2a`; live card carries "proof" lowercase only — `not.toContainText("PROOF")` is case-sensitive ✓ | ✅ |
| 3 | key copy affordance copies the COMPLETE key | ✅ `verification-key`, aria-label exact | clipboard permission granted at file top | ✅ (old pin verbatim) |
| 4 | failed receipt | ✅ | chip `failed · 84/87` (unit pin 7); `/chipCrit/` class regex; weld `26/29 exact` (`evidence-proof-failed.json`); receipt line exact (unit pin 7) | ✅ (class regex: precedent `inspector.spec.ts:184`, `book.spec.ts:59` on the same build) |
| 5 | missing receipt | ✅ | `No reconcile receipt: no committed receipt artifact is present in this deployment` — fixture `reconcile_unavailable_reason` is exactly that clause ✓; `/chipRefused/` | ✅ |
| 6 | missing batch | ✅ | headline `receipt ACCEPTED at pin 5f0b3e2a; NO SERVABLE BATCH.` = `${proofArm}; ${liveArm}.` ✓; REAL_KEY nowhere (drawer closed, chip "—", card no-batch arm) | ✅ |
| 7 | evidence unavailable | ✅ | `/^Evidence unavailable: /` on the `<b>` emphasis; dek carries `NO_SUBSTITUTE`; Receipt chip "unknown"; index/compute still answer from mocked meta/book | ✅ |
| 8 | whole API unreachable | ✅ | meta rejects → `settled:true,value:null` → refused; `useCashBook` phase `error` → book null → refused; step-compute `/…nothing is computed\.$/` | ✅ as written — but the pinned sentence is the over-claim in **I2** |
| 9 | Overview link lands on `#architecture`, top ≤ 120px | ✅ ids | Next scrolls to the hash on the commit of the new tree — the **loading** tree. Header + architecture ≈ 575px tall < the 720px Desktop-Chrome viewport (playwright.config: `devices["Desktop Chrome"]`, no viewport override) → the document cannot scroll → section top ≈ 260px; the manifest then lands and the page grows, but nothing re-scrolls. The `expect(top)` is a one-shot, non-retrying assertion | ❌ likely red — **I1** |
| 10 | drawer: doctrine, evidence-first on explain, Escape restores focus | ✅ | intro/split/identity line verbatim (unit pin 15); `PROVEN`, `comparison_sha256`, `gated_exact == gated_rows` (PROOF_COMPARATOR, `evidence.ts:720`), `does NOT inherit` (`evidence.ts:735`). Focus: `Drawer.tsx:62–68` captures `document.activeElement` on open and `.focus()`es it in the cleanup when `open` flips; the button was focused by the click; precedent `api.spec.ts:172` | ✅ plausible |
| 11 | raw JSON toggle + hide | ✅ | — | ✅ |
| 12 | proof card answer layer; fold 15, closed | ✅ | 4+1+1 + 6 + 2+1 = 15 with the fixture's publishable `artifact_path`, `note`, `feeds.path`; `pro-rata-over-counted-collateral` = `service.seizure_model` inside the fold | ✅ (old pin verbatim) |
| 13 | live card takeaway; fold 2 | ✅ | digest + note | ✅ |
| 14 | hazards outside the fold (gap 1 / DSN 14 / MISMATCH) | ✅ | same counts as the deleted pins; `page.reload()` after re-mock — last-registered route wins | ✅ |
| 15 | probes table: qualifier, headers, 2 rows, dimmed refusal, empty statement | ✅ | `tbody tr` = 1 record + 1 note; `/dim/` on `styles.dim`; emptyText = `PROBES_EMPTY` | ✅ |
| 16 | wire contradiction demoted everywhere | ✅ | `liveSubjectStatus` demotes (`evidence.ts:665–686`); unit pin 11 | ✅ |

Re-pointed rows elsewhere: `shell.spec.ts` `/proof` H1 `/^Evidence unavailable: /` — consistent with the file's no-API assumption (Book/Lab rows assume the same). `state-matrix.spec.ts` five cells — ids exist; meta/book/positions unmocked → refused tiles or live values, and the cells assert only subjects ✓. `r1-fixes (6)` eyebrow sweep over `/proof`: the new "01 · INDEX" step numbers begin with "0", so `/^\s*[1-7] · /m` cannot match them (the Overview already renders the same numbers under the same pin) ✓.

### 1c. Retirement ledger — 17 old pins + the Proof arms

All 17 `proof.spec.ts` tests are accounted for in the report's table: 15 re-expressed (ids traced above), r81 folded into the contradiction test, the stampline-split pin RETIRED with its reason (R7). `r1-fixes (6)` Proof H1 retired with a ledger comment; `r1-fixes (10)` Proof arm re-homed to the drawer with a comment; `shell.spec.ts` and `state-matrix.spec.ts` re-pointed; `p1a-fixes`/`p1b-fixes` verified — the only `proof` hit is a comment at `p1a-fixes.spec.ts:208`. ✅

---

## 2. Strengths

- **One derivation, two pages.** `pipelineSteps` is genuinely the Overview's law extracted, not a copy: the same `find(engine)`, the same `n()`, the same `UNAVAILABLE`; the Overview's four pins trace without movement, and the unit spec pins the exact strings the browser pins assert (`154,796,552`, `batch · 2 Cash accounts`, `87/87`, `17`).
- **The receipt law is stricter than the brief asked and honest about it.** A wire that rejects a clean receipt is `failed`, not `drift`; a wire claiming acceptance over a drifted receipt is judged by the receipt's own numbers. Both contradictions are unit-pinned. `none` never fabricates: the served reason travels to the chip title, the receipt line and the card.
- **The subjects' content moved intact.** The fold-count formula, the hoisted-hazard placement law and the counted summaries are line-for-line the old card's, so the W-3L pins re-express without re-deriving anything.
- **Identity never drops.** Loading and unavailable states emit all four chips refused (`unknownChips`), and the header is the state — the old `proof-unavailable` alert is retired without losing the words.
- **The `pending` prop is the right call**: the Overview's "unavailable" during load would have been a false refusal on a page whose job is verification.
- **Ledger discipline**: every retired pin carries its reason in a comment at the retirement site; the report's table is complete and the deviations are numbered and reasoned.

---

## 3. Issues

### Critical

None.

### Important

**I1 · The Overview deep-link pin (e2e #9) is likely red as written** `[§7 test policy]`
`verification.spec.ts:214–226` asserts `getBoundingClientRect().top ≤ 120` once, immediately after `toBeVisible()`. Next's App Router scrolls to the hash when the new segment commits — the loading tree (header + architecture only, ≈575px at 1280×720) is shorter than the viewport, so no scroll can happen; after the manifest lands the page grows, but nothing re-scrolls. Even on a tall document the one-shot read is exposed to the header's reflow when the takeaway replaces "Loading the evidence manifest…". Fix in the spec (wait for `data-state="ok"`, then `await expect(section).toBeInViewport()` and/or `expect.poll` on the top) or in the page (re-run the hash scroll once when the manifest lands). The implementer named this risk; it should not go to the shared run as is.

**I2 · The Compute and Verify step sentences word a fetch failure as a known absence** `[GC · refusals render honestly]`
`verification-view.ts:141–143`: `COMPUTE_ABSENT = "No batch is servable; nothing is computed."` and `VERIFY_ABSENT = "No reconcile receipt is committed; nothing is verified against the chain."` are printed whenever `book === null` / `evidence === null` — which is also the case when `/v1/book` failed on the network (`useCashBook` phase `error`) or `/v1/evidence` could not be fetched (state `error`). "No batch is servable" and "No reconcile receipt is committed" are statements about the deployment that the page does not know in those arms; the tile beside them says "unavailable" (honest), the receipt line says "could not be fetched" (honest), the sentence says "is not committed" (invented). Never a zero — but an unknown rendered as an absence. e2e #8 currently pins the over-claim (`/No batch is servable; nothing is computed\.$/`). Fix: give `pipelineSteps` (or the sentence) the reader's phase — e.g. "The batch could not be read; nothing is claimed as computed." / "The manifest could not be fetched; nothing is claimed as verified." — and keep the absence words for the genuine `no-batch` / `reconcile: null` arms. Lesser cousin: the Index sentence stays "Chain heights indexed per engine, ahead of every batch." under a refused tile (brief-specified; noted as M8).

**I3 · Sentences composed in components, not the lib — brief-licensed, but unrecorded** `[GC · copy in web/lib/**]`
`VerificationSubjects.tsx` composes "ACCEPTED · every gated row welded exact", "REJECTED · {detail}", "identical to service fingerprint, by construction" / "MISMATCH against …", "serving batch #N · watermarked, operational — never the proof", "— · no batch, no key; never fabricated", "(predates substrate-digest custody …)", "(no build stamp, and never guessed)", the fold section names; `VerificationSurface.tsx` composes "Committed probe records", "the contract and its samples → API", "Methodology & evidence", "Raw JSON"/"Hide raw JSON"; `VerificationArchitecture.tsx` composes the section title/qualifier and "0N · LABEL". The brief did say "content moved into two kit-styled cards", so the location is in-brief; the plan's Global Constraint is not, and the report's twelve deviations do not name the exemption. Acceptable outcome: a ledger note now and a lift into `verification-view.ts` (a `subjectCard(manifest)` view) in the Task 9/10 debt set — the unit spec would then pin the cards' words the way it pins the header's.

### Minor

- **M1 · Weld-short drift arm reads "0 drift — drift named"** — `receiptLine` case `drift` (`:289`) names only the gated tallies; when the only fault is a per-engine weld short (`deriveProofSubjectStatus` `:600–612`) the line says "87 of 87 gated rows exact, 0 drift — drift named, the proof badge refused". The fault is in the chip title and the card's status row, not on the line. Append `proof.detail` when `gated_drift === 0`.
- **M2 · No-batch manifest: header tone `ok` under "…; NO SERVABLE BATCH."** — R2's letter (warn only for the receipt) is met and the Live-batch/Key chips refuse, but a green sentence that ends in a capitalised refusal is a tone/content mismatch. Consider `warn` when `liveSubjectStatus(manifest).kind === "no-batch"`; e2e #6 does not pin the variant, so the change is free.
- **M3 · Overview strip: compute with `book === null` now reads "batch unavailable"** (was "unavailable" alone) — pins unaffected; not in the report's deviation 2.
- **M4 · Key chip is not `mono`** as the brief's interface asked; the kit chip has no mono affordance — record it, or add one to `IdentityChip` in Task 7.
- **M5 · A raw ISO timestamp in prose** — "Batch 1 computed at 2026-07-29T10:00:00Z; …" (the report's deviation 3 is honest that no cadence exists). The page prints `finished_at` raw too, so the register is consistent; a formatted time would read better in a sentence.
- **M6 · `r1-fixes (10)` title still lists "Proof, Developers"** though both arms are now retired comments.
- **M7 · `useCashBook` walks `/v1/positions` for a page that reads only `book.batch` and `engines[].positions`** — the report names it; debt for Task 9/10 (a lean `book()` reader).
- **M8 · Index sentence is fixed under a refused tile** — brief-specified; the same register question as I2 but it invents no absence.
- **M9 · Plan-internal tension**: Global Constraint "Every page's H1 is its nav label" vs R2 (the headline is the H1 in `VerdictHeader`). The Task 6 precedent (API's H1 is the operation-count sentence, pinned in `shell.spec.ts`) was accepted; the report's r1 (6) retirement reasons the same way. Noted for the plan, not against the task.
- **M10 · "manifest note" rows under the "Record" header** — labelled, dimmed when refused, counted; a slight semantic stretch of the column that the qualifier ("… · 1 manifest note(s)") compensates for.

---

## 4. Interpretations judged

| Interpretation | Judgement |
|---|---|
| Compute's `{cadence}` = `book.batch.computed_at` | Honest: the rendered words are "computed at {time}"; the word "cadence" never reaches the user and the wire carries no batch cadence. Register wobble only (M5). |
| `pending` prop on `VerificationArchitecture` | Sound; keeps a settling reader from printing a false refusal, and the e2e's retrying assertions absorb it. `pending.compute` keys on `reading.phase === "loading"`, `pending.index` on the meta ask's own `settled` flag — both correct. |
| Manifest notes as table rows | Acceptable under R5 (a table lists; it does not fold); M10. |
| PROOF · EXACT @ pin as `StatusPill tone="ok"` | Correct — the Ribbon is R7-retired; the words are unchanged and pinned. |
| Copy composed only in the lib | Header, tiles, receipt line, probe rows, doctrine: yes. Subject cards and section chrome: no — I3. |
| Tokens only in CSS | Yes for every color, type size and weight; px spacing follows the kit's own module. |
| Unavailable-state headline/dek (deviation 4) | The lab's refusal grammar; the R3 clause leaves the header only in that state and stays in the drawer. Acceptable. |
| `retryWords` duplicated (deviation 12) | Acceptable; `lab-headline.ts` is Task 9's file. Fold into one export there. |

---

## 5. What could not be verified (read-only ruling)

- Any e2e execution: the 16 `verification.spec.ts` pins, `overview.spec.ts`, and the re-pointed `shell`/`state-matrix`/`r1-fixes` rows. Pin #9's likely failure is reasoned from Next's hash-scroll timing and the loading tree's height, not observed.
- Next 16 (`next build`, Turbopack default) CSS-module class naming for the `/chipCrit|chipRefused|dim/` regexes — plausible only by the precedents on the same build.
- The width contract (390 → 2560), both themes, contrast of the new tints (`.receipt[data-tone=warn]`, `.stepNum` accent on `--type-floor`), and the 4→2 column `.steps` collapse at ≤900px.
- The Overview pixel pins: whether the pipeline strip (with its lost bold) falls inside the 1440×900 capture — `screenshots.spec.ts` shows no `fullPage` option in the grep, so the capture is likely the viewport, but this was not confirmed.
- The report's gate claims (`tsc --noEmit`, eslint, `lint:css`, 858 unit passes) — not re-run.
- `KitTable`'s `td { white-space: nowrap }` on the path column at narrow widths (the note cell wraps via `.wrap`; the path cell does not).

---

## Re-review 1 (a93bf7a)

Scope: fix round 1 (`a93bf7a`, parent `20b41db`, nine files) against I1–I3 and M1–M3. Read-only; the controller ran `verification.spec` (17/17) and `overview.spec` green on the production build at `a93bf7a`, so ids and strings resolve — the law is judged here. Package read: `review-20b41db..a93bf7a.diff` (components, specs) and `git show a93bf7a:web/lib/verification-view.ts` in full.

**RE-REVIEW: OPEN — one item** (the deep-link pin does not discriminate; the fix it guards is correct). I2 and I3 close; M1–M3 close.

### I2 — the unread / wire-stated-absence distinction (closes)

`pipelineSteps(meta, evidence, reading: BookReading, cashAccounts)` — `verification-view.ts:192–289`. Per step:

| Step | Source unread (loading / fetch failed) | Absence the wire stated | Number |
|---|---|---|---|
| Index | `meta === null` → value `—`, sub `unavailable`, tone refused, line figure `unavailable` (`:201–212`) | meta answered without the `debt_manager` watermark → sub `no OP Mainnet watermark` (`:208`) | `n(dm.last_block)`; sub and line carry the Ethereum block or `unavailable` |
| Compute | `reading.phase ∈ {loading, error}` → `—` / `unavailable` / "The batch could not be read." (`:226–236`) | `reading.phase === "no-batch"` (the wire's 503) → `—` / `no servable batch` / "No batch is servable; nothing is computed." | `n(book.batch.id)`; the Cash-accounts figure says `unavailable` when the walk has not answered — the weaker, always-true word |
| Verify | `evidence === null` → `—` / `unavailable` / "The receipt could not be read." (`:250–260`) | manifest with `reconcile: null` → `—` / `no committed receipt` / "No reconcile receipt is committed; nothing is verified against the chain." | the gated tally; tone `ok` only when readable and `receiptState === "exact"` |
| Serve | needs no source | — | `17` |

Honesty: no unread arm prints an absence sentence, and the Overview's `line.figure` stays `unavailable` for every missing figure, including the wire-stated ones (`:235`, `:259`) — the strip never upgrades to a claim the reader did not make. The `no-batch` phase is `useCashBook`'s own 503 arm (`cash-book.tsx:79`, `:144`), the one absence that reader states; `error` (`:145`) is unread. A `reconcile: null` manifest carries `reconcile_unavailable_reason`, and `proofSubjectStatus` names a wire contradiction over it in the reason — the tile's "no committed receipt" is literally true in that arm too. Unit pins: the unread pair (`UNREAD`, `FAILED`) asserts `not.toContain("No batch is servable" | "No reconcile receipt is committed")`; the absence trio (503 book, no-receipt manifest, meta without the OP watermark) asserts the absence words. e2e #8 re-pinned to the unread words plus the two `not.toContainText` guards; the new e2e "an absence the wire stated…" pins both absence tiles with the Index number standing beside them. Complete for all four steps. ✅

Carried, unchanged by design: the Index sentence stays "Chain heights indexed per engine, ahead of every batch." under a refused tile (M8, brief-specified) — a positive claim, not an invented absence.

### Overview line — byte-identical text and `data-value` for the served demo (confirmed by trace)

`Pipeline.tsx` (a93bf7a) renders `{line.before}<b>{line.figure}</b>{line.after}` with `data-value={line.figure}` and `{step.ordinal}`. Against the pre-Task-5 `Pipeline.tsx` (deleted in `2abc3ef`):

| Step | Original textContent | `line` composition (`verification-view.ts`) | Text | `data-value` |
|---|---|---|---|---|
| index | `OP block 154,796,552 · Ethereum block 25,635,618` | `"OP block " + "154,796,552" + " · Ethereum block 25,635,618"` (`:221`) | identical | identical |
| index, meta unread | `OP block unavailable · Ethereum block unavailable` | `:211` | identical | `unavailable` ✓ |
| compute | `batch 1 · 2 Cash accounts` | `"batch " + "1" + " · 2 Cash accounts"` (`:245`) | identical | identical |
| compute, book null | `unavailable` | `"" + "unavailable" + ""` (`:235`) | identical — M3 closed (67affb5 printed `batch unavailable`) | `unavailable` ✓ |
| verify | `87/87 gated rows exact · drift 0` | `"" + "87/87" + " gated rows exact · drift 0"` (`:269–273`) | identical | identical |
| verify, recon null | `unavailable gated rows exact` | `:259` | identical | `unavailable` ✓ |
| serve | `17 endpoints · typed TypeScript client` | `:285` | identical | `17` |

The only residual difference from the original is DOM-level: the second figure (Ethereum block, Cash accounts, drift) is no longer inside its own `<b>` — deviation 2 of the first report, acknowledged; text and pins unmoved. Unit pins now assert every `line` object (`{ before, figure, after }`) for the served demo and the unread arms. ✅

### I3 — every sentence from the lib (closes)

`subjectCards(manifest)` (`:332–471`) carries every word the two cards print: titles, pills, explain names, status/gated/weld/fingerprint rows, the hoisted refusals with their ids, the three fold sections with labels and copy names, the live takeaway, the digest-gap and note hazards, the no-batch key row. `VERIFICATION_COPY` (`:83–96`) carries the page chrome; `markerLine` (`:99–101`) the drawer's marker line. `VerificationSubjects.tsx` is a printer (`Row`/`Rows`/`SubjectCardView`); `VerificationArchitecture`, `VerificationDrawer`, `VerificationSurface` read `VERIFICATION_COPY`/`ordinal`. Grep of the five components at `a93bf7a` for multi-word literals and JSX text: none remain except the two declared exceptions — the Overview's own step names/descriptions in `Pipeline.tsx` (Plan 1 copy, pre-existing) and the single visible word `explain` (its accessible name `card.explain` is the lib's). Fold counts are now the sum of section rows and are unit-pinned at 15 / 14 / 9 (proof) and 2 / 1 / none (live) — the old formula's numbers. ✅

### I1 — the deep link (the fix closes; its pin is the open item)

Effect (`VerificationSurface.tsx`, after the fetch effect): keyed on `state.phase`; returns while `loading`; returns when `location.hash` is empty; otherwise `document.getElementById(hash)?.scrollIntoView({ block: "start" })`. Honest: fires once per phase transition and the evidence phase transitions once (loading → ok | error; no refetch path); no hash → no scroll; scrolls to whatever the URL names, not a hard-coded id; `scrollIntoView` honours `scroll-margin-top: 72px` and moves no focus, so the drawer's capture/restore (`Drawer.tsx:62–68`) is untouched. Edge, harmless: a drawer opened during the loading window sees the page scroll behind it once. ✅

**OPEN — e2e #9 does not bite on 67affb5.** The re-pinned test asserts `toHaveURL(/#architecture$/)` → `data-state="ok"` → `toBeInViewport()` on `verification-architecture`. At the e2e viewport (Desktop Chrome, 1280×720) the section on the un-scrolled ok page sits at roughly y≈270–600 — inside the viewport — so `toBeInViewport()` (any intersection) passes with or without the scroll effect, and `{ ratio: 1 }` would pass too. The pin proves the link resolves and the section renders; it does not prove the landing the report claims ("the named section is scrolled to"). Discriminating form: after `data-state="ok"`, `await expect.poll(() => section.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThanOrEqual(120)` (auto-retrying, so it waits out the effect) — red on 67affb5 (~270), green on a93bf7a (72). A two-line spec change; the page itself needs nothing.

### M1–M3

- M1 ✅ — `receiptLine` drift arm (`:586–590`): when `gated_drift === 0` the fault is `proof.detail` ("debt_manager weld 26/29 exact"), else "drift named"; unit-pinned with a weld-short manifest.
- M2 ✅ — header tone `ok` only when `receipt === "exact" && serving` (`:675`, `:681`); unit-pinned (no-batch, contradiction) and e2e #6 asserts `data-variant="warn"`.
- M3 ✅ — closed by `line` (table above).

### Nothing else moved

The nine files change only what I1–I3 and M1–M3 require: `OverviewSurface` passes `reading`; `Pipeline` consumes `line`/`ordinal`; the three Verification printers read the lib; the lib gains `BookReading`, `PipelineLine`, `ordinal`, `subjectCards`, `VERIFICATION_COPY`, `markerLine`, the M1 fault and the M2 `serving` guard; the specs re-pin. `BookReading` is structural over `CashBookReading` (`phase`, `book`, `failure` — `cash-book.tsx:54–56`, `:318–325`), so a renamed phase breaks the lib's compile, which is the intended coupling. Unit count 16 → 23 (+7; `web/lib` count does not decrease).

### Notes, not blocking

- A `pending` tile (`…`) still shows the lib's sub `unavailable` beneath it while the reader is `loading`; true at that instant, but the lib knows `phase === "loading"` and could withhold the word or say so. Register, not honesty.
- Two wires can disagree for an instant by design (a 503 book beside a manifest that says "serving batch #1"): the Compute tile reads "no servable batch" while the headline says the batch serves. Each is honest to its source; inherent to steps-from-the-book / subjects-from-the-manifest, not introduced here.
- M4–M10 remain as the report records them (not taken, with reasons).
