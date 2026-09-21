# Gate round · Phase 1 — report: Verification (`/proof`) and API (`/developers`)

Status: **DONE_WITH_CONCERNS** — every item landed, nothing STOPPED. Commit **92f0c1a** on `main`, 13 paths, by
pathspec, staged by name, scope gate OK (13 paths), hooks ran (control-plane doctor 0 errors), no attribution line.
Not pushed. Parent is the Activity commit 69e5f53; History is ebfef41.

Gates (all from `web/`, re-run on the committed tree): `npx tsc --noEmit` exit 0 · `npx eslint app lib components
tests` exit 0 · `npm run lint:css` exit 0 · `npx playwright test --project=unit` **987 passed, 0 failed**. My specs:
`verification-view` 25 → 28, `proof-evidence` takeaway block 4 → 10, `api-view` 5 → 9 (+13; none deleted). No build,
:3111 untouched, no snapshot update, no prettier. **The e2e pins below are written but NOT run** (by instruction).

Index note: when I staged, the shared index also held the Activity implementer's 11 paths. I neither unstaged nor
committed them; the pathspec commit took only my 13, and they landed separately as 69e5f53.

## Per item

**Verification headline, every arm (clarity table + A2.4).** `evidence.ts` now exports `ProofTakeawayArms { proof,
scope }` and `proofTakeawayArms(manifest)`; `proofTakeaway` is composed FROM the arms (`${proof} ${scope}`), so the
sentence cannot drift from its parts. `emphasis = arms.proof` wears the tone, `rest = arms.scope` is ink. A serving
batch is never named in either arm. Tone = `receipt === "exact" ? "ok" : "warn"` — the receipt alone. Pin:
`proof-evidence.spec.ts` "W-3L — proofTakeaway" (10 tests, incl. the arms-compose law over 12 manifests) and
`verification-view.spec.ts` per arm.

| Arm (fixture) | emphasis (toned) | rest (ink) |
|---|---|---|
| accepted + serving (`EVIDENCE_MANIFEST`) | All 87 checked rows matched the chain exactly, | in this deployment's pinned reconcile run. |
| accepted + no batch (`EVIDENCE_NO_BATCH`) | same | in the pinned reconcile run — but no batch can be served right now. |
| accepted + live contradiction | same | in the pinned reconcile run — but the manifest contradicts itself about the live batch, so none is claimed. |
| rejected, drift (`EVIDENCE_PROOF_FAILED`) | The last reconcile run did not match the chain exactly, | 84 of 87 checked rows matched; 3 rows drifted. |
| rejected, row short, drift 0 | same | 86 of 87 checked rows matched. *(a zero drift is never printed)* |
| rejected, weld short | same | Cash matched 26 of 29 compared rows. / Aave v3 market (legacy) matched 13 of 14 compared rows. |
| rejected, clean tallies, verdict not a clean pass | The last reconcile run did not pass: | its receipt records a verdict that is not a clean pass (exit code 2). |
| rejected by contradiction (wire refuses a clean receipt) | The proof cannot be accepted: | the manifest contradicts its own receipt. |
| no receipt (`EVIDENCE_NO_RECEIPT`) | Nothing is proven for this deployment: | no reconcile receipt is committed. |
| any failing arm + no batch | (as above) | …(as above) No batch can be served right now either. |
| loading | Loading this deployment's verification record… | — (refused) |
| manifest error | The verification record could not be fetched. | — (refused) |

Three arms are mine, not the clarity table's — each because the table's words would have been untrue there: (1)
"clean tallies, not a clean pass" (the table's drift sentence would print "87 of 87 … 0 rows drifted" — forbidden);
(2) the live-contradiction scope ("no batch can be served" is not what a self-contradicting manifest licenses); (3)
the no-batch suffix on failing arms (the W-3L law: an absent batch surfaces in the head in EVERY proof arm).

**Verification dek, every arm.** New `verificationDek(manifest)`; `VERIFICATION_DEK` (the slogan) is deleted —
`VERIFICATION_SPLIT` keeps it verbatim in the drawer. Demo: *"That run is a fixed, reproducible check, finished
Jul 29, 02:14 UTC; its result covers that run and nothing else. Batch 18,251, served now, is live data that was not
re-checked and does not inherit it."* Failing proof + serving: *"No exactness is claimed for this deployment until a
run passes. Batch 1, served now, is live data; no check covers it."* No receipt: s1 = the served reason. No batch:
s2 = the served reason, plus *"The proof still stands for its own run; it says nothing about live data."* only when
the proof is accepted. Every manifest string passes `pub()`. Loading dek: `VERIFICATION_LOADING_DEK`. Error dek:
`{sentence(message)} {retry} Nothing is substituted for it: …`. Pins: unit literals through `nb()`; the year rule
both ways; a non-Z `finished_at` verbatim; an empty `served_at` prints the year.

**DEFECT — the "Pinned batch" chip.** Relabelled **`Proof pin`**, value `5f0b3e2a` (the `pin ` prefix went: the
label says it); title unchanged (`comparison sha256 {sha} · finished {ISO}` — the exact layer under the dek).
`Live batch` value `18,251` (no `#`, `groupInt`). T2: `Key` → `Batch key`. Pin: chips order + values, unit and e2e;
e2e asserts `[data-chip='Pinned batch']` count 0.

**"watermark vector" card/drawer only.** Out of headline and dek. Live card takeaway: `serving batch 18,251 ·
stamped with the chain blocks it was read at; operational, never the proof`. `LIVE_CAPTION` / `LIVE_NOTE` /
`VERIFICATION_SPLIT` keep the term verbatim in the drawer; the pill `SERVING · WATERMARKED` stays.

**B8(a) step numbers folded into tile labels — landed WITHOUT moving the Overview.** New `stepTileLabel(step)`
(→ "01 · Index") is read from the step's own `ordinal`; `VerificationArchitecture` passes it as the tile label and
the `.stepNum` kicker span + rule are gone. `pipelineSteps`' `key` / `ordinal` / `line` — the only fields
`app/overview/Pipeline.tsx:43-51` reads — are byte-identical, and a new unit test pins all four `ordinal`s and all
four composed `line`s as literals. The one field of `pipelineSteps` I changed is the Verify step's `sub` (clarity
T2: `gated (must-match) rows exact · drift 0`), which the Overview does not read; its `line.after` keeps
`gated rows exact`. **B8(b)** `.subjects { align-items: stretch }`. **B8(c)** `.row:has(.ident)` stacks, `.v`
left-set. Pins: e2e — shared bottom edge ±1px, the key's `getClientRects().length === 1`, value under its label.

**API headline / dek / kicker.** Kicker `API · contract v1.8.0`. emphasis `17 read-only endpoints,` rest `every
money value an exact decimal string.` tone **neutral**. Dek (`apiDek()`, computed): *"No key or sign-in; requests
are rate-limited per client. Every sample below is the contract's own example (api/openapi.yaml, v1.8.0) or a
committed client fixture validated against it, cited beside each. A CI test re-reads both and fails if this page's
extract has drifted."* `API_DEK` deleted; `API_INTRO` is byte-identical in the drawer (slogan included).

**B5.** `Operations` chip dropped (chips: Contract · Base URL · Source). ONE Base URL: the mono chip stays, the
strip and its test ids `api-base-url` / `api-base-url-value` are gone (the ruling says the element goes); the e2e
helper reads the chip. Tile subs COMPUTED: `verbCensus()` → "15 GET · 2 POST", `errorStatuses()` → "400 · 404 · 409 ·
429 · 500 · 503"; the unit pin checks the census sums to `OPERATIONS.length` per method, not just the literal. Tile
label `Operations` → `Endpoints`; test id `api-kpi-operations` kept. Section qualifier moved to the lib
(`api/openapi.yaml, verbatim` — the count was its fourth statement).

**B6.** `view.index` rows; anchors are `.tocRow` grids (`5ch` verb column), method in its own span (GET
`--accent-text`, POST `--warn-text`), no `kit.btn`; `columns: 3` (2 ≤ 900px, 1 ≤ 640px). `api-toc` kept. A literal
`{" "}` sits between the spans so the anchor's text is still `GET /v1/book`. Pin: e2e walks all 17 anchors by Tab
in the contract's order, asserts no `btn` class, equal x for verb and path columns, POST colour ≠ GET colour.

**B7.** `contractParagraphs(text)`; `.description` / `.paramDescription` lose `pre-wrap`, gain `max-width: 720px`.
One addition to the ruled algorithm: a line opening with `* ` or `- ` starts its own paragraph — three operation
descriptions carry bullet lists, and joining them with spaces would have run the items together. Marker kept;
words unchanged. Pin: unit — over EVERY description the page prints, `words(paragraphs.join(" "))` equals
`words(text)`; e2e — `<p>` texts equal the lib's, `white-space: normal`, width ≤ 720. New test id
`api-description-{operationId}`.

## Fact claims verified, and where

1. **The reconcile run's finish instant** = `reconcile.finished_at`. `api/openapi.yaml:5842` (`ReconcileSummary`,
   required at `:5824`); served from the committed artifact's `run.finished_at` at `cmd/api/p5_evidence.go:345`;
   stamped at run end by `cmd/reconcile/main.go:1159`. Reference year = the manifest's own `served_at`
   (`openapi.yaml:5928`, required). Fixture: `web/tests/fixtures/evidence-manifest.json` (`02:14:07Z` / `10:00:05Z`).
2. **"was not re-checked" / "does not inherit"** — `openapi.yaml:5891-5892` ("the currently-serving batch is the LIVE
   subject and never inherits this exactness"); `:5910-5914` (LiveSubject "OPERATIONAL unconditionally … no
   comparator applies between the two subjects"); `:5828-5831` + the manifest's own receipt note ("the reconcile
   itself ran against a pinned block, not at request time"). Kept as ruled. Caveat in Concerns 2.
3. **"fixed, reproducible check"** — `openapi.yaml:2004` ("pinned, exactly-reproducible acceptance evidence").
   **"last reconcile run"** — `:5827` ("The last COMMITTED reconcile receipt's summary").
4. **"stamped with the chain blocks it was read at"** — `openapi.yaml:2326-2334` (`Stamp`: engine, chain_id,
   last_block), `:3290-3296` (the batch's per-engine watermark vector), `:2432-2437` ("stamped engine").
5. **"gated (must-match)"** — `openapi.yaml:5836-5837` (`result` is `pass` when every gated row welded exact).
6. **"No key or sign-in"** — `cmd/api/main.go:708-712` ("There is no auth because there is nothing to authorize");
   the middleware chain `:737-745` is notFoundJSON → rateLimit → readOnly → cors → recoverPanics, no auth layer;
   `api/openapi.yaml` declares no `security` / `securitySchemes` (grep empty). `internal/api/` does not exist.
   **Rate limiting DOES exist** — per-IP token bucket, 20 rps / burst 40 (`cmd/api/main.go:77-81`,
   `middleware.go:403-420`) — so the dek adds "requests are rate-limited per client", and only while
   `ERROR_RESPONSES` carries a 429.
7. **"a test fails the build if this page and the contract disagree" — NOT true as written; reworded.** The test is
   `web/tests/unit/proof-contract-fidelity.spec.ts`. It compares `lib/proof-contract.gen.ts` (the page's SOURCE
   MODULE, not the rendered page) with `api/openapi.yaml`: title/version (`:75`), the GET/POST operation list
   (`:81`), operationId/summary/description/params/response codes (`:91`), each 200 sample vs the yaml's inline
   example OR the cited client fixture's bytes (`:123`), the error envelopes (`:153`). CI runs it:
   `.github/workflows/ci.yml:104-105` → `npm run test:e2e` = `playwright test` (`package.json:20`), all projects.
   It fails the CI job, after `next build` — not the build. Hence "A CI test … fails if this page's extract has
   drifted."
8. **"Every sample below is the contract's own example" — NOT true as written; reworded.** 5 of 16 200-samples
   (book, address, stress, observatory, meta) and 5 of 6 error bodies cite `packages/client-ts/test/fixtures/*`
   (`proof-contract.gen.ts` `exampleSource` / `source`). Those fixtures ARE validated against the contract:
   `packages/client-ts/test/fixtures.test.ts:18-45,62-63`. The clause is computed — it prints only while some
   sample cites a fixture.
9. **"read-only"** with two POSTs — `cmd/api/main.go:706-711` (the POSTs "WRITE NOTHING") + the `readOnly` middleware.

## Pins re-pointed (old → new)

- headline: `receipt ACCEPTED at pin 5f0b3e2a; serving batch #1 under its watermark vector.` → `All 87 checked rows
  matched the chain exactly, in this deployment's pinned reconcile run.`
- `RECEIPT REJECTED — the proof badge is refused; …` → `The last reconcile run did not match the chain exactly, 84
  of 87 checked rows matched; 3 rows drifted.`
- `NO COMMITTED RECEIPT — nothing is proven; …` → `Nothing is proven for this deployment: no reconcile receipt is
  committed.`
- `receipt ACCEPTED at pin 5f0b3e2a; NO SERVABLE BATCH.` → `All 87 … exactly, in the pinned reconcile run — but no
  batch can be served right now.`
- dek `Two subjects, never one: the pinned proof and the live batch.` → the computed two-fact dek.
- `Loading the evidence manifest…` → `Loading this deployment's verification record…`
- `Evidence unavailable: {message}.` → `The verification record could not be fetched.`; dek `… and nothing is
  substituted for it: …` → `{Message}. {retry} Nothing is substituted for it: …`
- chips `Pinned batch · pin 5f0b3e2a` / `#1` / `Key` → `Proof pin · 5f0b3e2a` / `1` / `Batch key`.
- live takeaway `serving batch #1 · watermarked, operational — never the proof` → `serving batch 1 · stamped with
  the chain blocks it was read at; operational, never the proof`.
- Verify tile sub `gated rows exact · drift 0` → `gated (must-match) rows exact · drift 0`.
- e2e `verification-step-*`: `toContainText` → `toHaveText` (pins that the kicker is gone).
- **tone, accepted + no batch: `warn` → `ok`** (unit + e2e `data-variant`). See Concerns 1.
- API: kicker `API · Solvent Risk API v1.8.0` → `API · contract v1.8.0`; headline `17 read-only operations, every
  money value a decimal string.` → `17 read-only endpoints, every money value an exact decimal string.`;
  `data-variant` `ok` → `neutral`; dek slogan → the fact dek; four chips → three; tiles `{operations, errors,
  version}` strings → `{label, value, sub}`.

## Concerns

1. **Tone of the accepted + no-batch arm is now `ok`, reversing a pinned law** ("a sentence that ends in NO SERVABLE
   BATCH is not green"). The two rulings disagree: clarity says `warn` but flags it **[design]**; design's A2.4
   formula is `receipt === "exact" ? "ok" : "warn"`. Reconciliation 1 gives tone to design, so I followed the formula.
   The argument: on this page amber now MEANS "the receipt is not exact"; painting an exact finding amber because
   of the live subject gives one colour two meanings — the defect observation 2 overruled. The absence is carried in
   ink (rest), the dek and two refused chips. One line + two pins to flip if the controller rules otherwise.
2. **"was not re-checked"** kept as ruled, but it is the softest claim on the page: "re-" can imply the live batch
   was checked once. What the manifest strictly licenses is "no comparator applies" / "never inherits". If the
   controller wants it tighter: *"is live data that run did not check, and it does not inherit the result."*
3. **Integrator re-points outside my ownership** (will FAIL at e2e until moved): `web/tests/e2e/shell.spec.ts:23`
   `/^Evidence unavailable: /` → `"The verification record could not be fetched."`; `:25` `/read-only operations,
   every money value a decimal string\.$/` → `/read-only endpoints, every money value an exact decimal string\.$/`.
   Stale comments only: `r1-fixes.spec.ts:132,138-139` quote the old deks. Stale specimen words:
   `app/styleguide/page.tsx:209-212` (old dek, `Live batch #18251`) — not pinned, not mine.
4. **Ownership reading:** the brief's glob `evidence*.spec.ts` matches no file; `evidence.ts`'s unit spec is
   `tests/unit/proof-evidence.spec.ts`, which welded all four old takeaway sentences. I treated it as mine ("their
   unit specs") and re-pointed it.
5. **G5 is still uncommitted:** `DEMO_EVIDENCE` lives in the integrator's unstaged `tests/fixtures/demo/index.ts`,
   so my specs do not import it; the demo arm is pinned on a local clone welded to `DEMO_BOOK.batch.id` (18,251).
   Until G5 lands, the mocked page prints "Batch 1".
6. **CI does not run the client-ts vitest suite** (`ci.yml` has no such step), so "validated against it" is true of
   a test that exists and passes locally but is not itself CI-gated. The "CI test" sentence refers only to the web
   fidelity spec, which IS CI-gated.
7. **Nothing rendered:** no build, no e2e, no pixel replay. The CSS most worth an eye: the multicol endpoint index
   (`columns: 3` with grid anchors, `break-inside: avoid`), `.row:has(.ident)` stacking, and whether
   `Proof pin · Live batch · Receipt · Batch key` + the drawer button still hold one header row at 1440.
8. Left deliberately: the drawer's identity line and `liveSubjectEvidence`'s subject keep `Batch #1` (drawer
   register; the `#` rule was ruled for the dek and chip). The receipt strip stays in the accepted arm (design
   observation 7 outranks clarity T2 there; it is a test-id'd element).
