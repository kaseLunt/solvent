# Task 6 review — `api-view` and the API page

Package: `review-d7c6a4c..cb22370.diff` (commits `ac5eb15` lib + pins, `cb22370` page + contract + retirements). Read-only review against the brief, the plan header (Global Constraints, R1–R8, the page-test contract) and the report. Nothing was run; the e2e pins are judged by trace against the kit components and the generated contract module as they stand at `cb22370`. Line references are to the files at `cb22370` unless marked `old:` (the deleted `page.tsx` / `developers.spec.ts` in the diff's minus lines).

**Verdicts**

- Spec compliance: **PASS** — every brief and plan item traces; one accepted deviation (the base-URL note is wrapped, not bare).
- Assessment: **APPROVE**, pending the controller's e2e run. One Important (a width-contract risk at 390px on the Endpoints head's link), the rest Minor.

---

## Spec compliance

| # | Item | Verdict | Trace |
|---|---|---|---|
| 1 | Kicker `API · {title} v{version}` (R1) | ✅ | `lib/api-view.ts:38` `` `API · ${CONTRACT_META.title} v${CONTRACT_META.version}` ``; unit pin `tests/unit/api-view.spec.ts:22`; e2e `tests/e2e/api.spec.ts:43` |
| 2 | Headline `{N} read-only operations, every money value a decimal string.` — emphasis whole, `rest` "", tone `ok` (R2) | ✅ | `api-view.ts:36,41-45`; `api-view.spec.ts:23-28`; `api.spec.ts:44-45` (`api-verdict-headline` and the H1 — `VerdictHeader.tsx:32` renders the headline as the page's only `<h1>`; no other `<h1>` in `web/components` at `cb22370` except `SurfacePlaceholder`, not on this page) |
| 3 | Dek is R3's one clause | ✅ | `api-view.ts:24` `API_DEK`; `api-view.spec.ts:27`; `api.spec.ts:46`. The intro ends with the dek (`api-view.ts:27`, pinned `api-view.spec.ts:59`) |
| 4 | Chips Contract · Operations · Base URL · Source, in order | ✅ | `api-view.ts:46-51`; `api-view.spec.ts:34-40`; rendered with `data-chip={label}` by `IdentityChips.tsx:32`; asserted `api.spec.ts:47-50`. Base URL chip carries the note as `title` (`api-view.ts:49`, `IdentityChips.tsx:31`) |
| 5 | Tiles operations / errors / version from the generated module, never hand-typed | ✅ | `api-view.ts:53` `String(OPERATIONS.length)`, `String(ERROR_RESPONSES.length)`, `CONTRACT_META.version`; `ApiSurface.tsx:76-78` prints `view.tiles.*`; version's sub is `CONTRACT_META.sourcePath` (the module's). No literal count anywhere in `app/developers/**` |
| 6 | Every contract operation renders with the same text and samples as before | ✅ | `ApiSurface.tsx:107-109` maps `OPERATIONS` → `EndpointCard`; `EndpointCard.tsx` diff changes only classes, test ids and JSX line-wrapping (`{param.in} ·{" "}` → `{param.in} · …`, the SSE note reflowed — JSX whitespace collapse yields identical text); `curlFor` untouched (`EndpointCard.tsx:12-16`) |
| 7 | The old `developers.spec.ts:28` law "every contract operation renders — none dropped" has a home | ✅ | `api.spec.ts:64-72`: per-id `toBeVisible` for every `OPERATIONS` entry, `[data-testid^="api-endpoint-"]` count = `OPERATIONS.length`, plus the TOC's anchors (`a[href="#id"]`, text `{method} {path}`) counted too — stronger than the old pin |
| 8 | Error envelope table carries every `ERROR_RESPONSES` entry; body sample still copyable | ✅ | Rows: `api-view.ts:54-57` (mapped, contract order) → `ApiSurface.tsx:52-60` (`KitTable`, row test id `api-error-{name}`). Bodies: `ApiSurface.tsx:115-122` `details` per `ERROR_RESPONSES` entry with `CodeBlock(JSON.stringify(body, null, 2))` and `copyLabel` `copy {name} body` — identical code and label to `old:page.tsx:102-108`; the source cited in the summary as before. 6 entries at `proof-contract.gen.ts:4225-4300` (400 · 404 · 409 · 429 · 500 · 503) |
| 9 | Quickstart carries the base URL | ✅ | `ApiSurface.tsx:19-40`, the text moved verbatim from `old:page.tsx:19-40`, `baseUrl` interpolated twice; pinned `api.spec.ts:81` |
| 10 | Drawer holds the intro verbatim | ✅ | `api-view.ts:27` `API_INTRO` == `old:page.tsx:50-54` (JSX-collapsed); `api-view.spec.ts:55`; `api.spec.ts:156-158` |
| 11 | Drawer holds the base-URL note verbatim | ✅ (deviation, acceptable) | Old note `old:page.tsx:62-64` "the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL)" → `api-view.ts:34,59` `` `Base URL ${baseUrl}: ${BASE_URL_NOTE}.` `` — the note's words intact, prefixed with the URL and closed with a period so the paragraph stands alone (report deviation 4). The visible strip keeps label + value only (`ApiSurface.tsx:81-86`); the note survives as the chip's `title` and in the drawer, which is R3's rule for method notes |
| 12 | Drawer holds the provenance paragraph verbatim | ✅ | `api-view.ts:30-31` `API_PROVENANCE` == `old:page.tsx:113-118` (JSX-collapsed, `&apos;` → `'`); `api-view.spec.ts:57`; `api.spec.ts:160` |
| 13 | Page stays a server component; the drawer is a client island | ✅ | `page.tsx` and `ApiSurface.tsx` carry no directive; `ApiDrawer.tsx:1` `"use client"`. Note: `CodeBlock.tsx:1` was already `"use client"` (it hosts `CopyChip`), so "one client island" (report, `ApiSurface.tsx:17` comment) is inexact — the code blocks are islands too, as before. Not a regression |
| 14 | No copy composed in components; words come from `api-view.ts` | ✅ against the brief · ⚠ against the plan's letter | Header, chips, tiles' values, error rows and doctrine all come from the view. Composed in `ApiSurface.tsx`: tile labels (`:76-78`), "Base URL" (`:82`), the `SectionHead` titles/qualifiers (`:95,98-99`, incl. `` `${N} operations, ${sourcePath} verbatim` ``), the column headers (`:43-46`), the summary "{name} body" (`:118`), and the link label "this deployment's evidence manifest → Verification" (`:100`, adapted from `old:page.tsx:56`); `ApiDrawer.tsx:17` "Methodology & evidence". The brief's Step 3 dictates the section strings and the `ApiView` interface has no field for them, so this is the brief's own shape; the link label is the implementer's. See Minor 1 |
| 15 | Ids per the contract table (R8) | ✅ | `api-surface` `ApiSurface.tsx:65`; `api-verdict` `:67` (+ `-headline/-dek/-identity` from `VerdictHeader.tsx:29-38`); `api-kpi-{operations,errors,version}` `:76-78`; `api-base-url` `:81`; `api-toc` `:88`; `api-quickstart` `:96`; `api-endpoint-{id}` `EndpointCard.tsx:21`; `api-errors` `:113`; `api-error-{name}` `:54`; `api-drawer` `ApiDrawer.tsx:17` / `api-drawer-body` `:21`; chips `[data-chip=…]`. Additive sub-ids (`api-base-url-value`, `api-curl-`, `api-sample-`, `api-responses-`, `api-error-sample-`) all under the prefix — accepted by the controller |
| 16 | Retirement table accounts for all 8 old pins and the r1 API arm | ✅ | Old `developers.spec.ts` had exactly 8 tests (ops count · curl fidelity · copy · params/SSE · error envelope · quickstart · Proof Center link · W-3L); each has a row and a home in `api.spec.ts` (tests 3, 4, 5, 6, 7, 8, 9, 10). r1-fixes (10) retired in place (`r1-fixes.spec.ts:160-161`) and re-homed (`api.spec.ts:152-160`); r1-fixes (6) kept — still true (`p.eyebrow` count 0: the kicker is `kit.kick`, `VerdictHeader.tsx:31`; no line begins `[1-7] · `). shell.spec re-pointed (`shell.spec.ts:22`), state-matrix re-pointed (`state-matrix.spec.ts:727-728`). Verified by grep at `cb22370`: no other test mentions `/developers`, `endpoint-`, `error-`, `ts-quickstart`, `base-url` or `developers.module` (p1a/p1b clean) |
| 17 | CSS uses tokens; font floor | ✅ | Every `var()` in `api.module.css` resolves in `app/tokens.css` (`--type-body/label/small/floor/mono/mono-sm` :85-90, `--w-*` :91-92, colours :23-47, `--mono` :54); no literal colour, no literal font-size; the smallest is `--type-floor` 12px on the verb badge (`api.module.css:23`). `--ink-3` is used for captions/provenance only (`.sampleSource`, `.paramMeta`, `.sseNote` — as the old module did); "required" is `--warn-text` (`:34`) |
| 18 | `SectionHead` qualifier composition vs the plan's " · " | ✅ acceptable | The brief names `SectionHead` as the component; the kit renders `<h2>{title}<small>{qualifier}</small></h2>` (`SectionHead.tsx:14-17`, `kit.module.css:56` `margin-left: 10px`). The plan's " · " is its prose separator for title · qualifier, and the other converged pages carry the same split. No pin depends on the heading text. See Minor 5 for a kit-level a11y nit |
| 19 | Process: pathspec commits, no attribution, unit count | ✅ | `ac5eb15` touches only `lib/api-view.ts` + `tests/unit/api-view.spec.ts`; `cb22370` the page, contract and retirements; both bodies empty (no attribution lines). 5 unit pins added, none removed |

## E2E pin plausibility (`tests/e2e/api.spec.ts`, 12 pins, not run — Desktop Chrome, `playwright.config.ts:33`)

| # | Pin (line) | Selectors resolve? | Passes on a correct build? | Fails on a dishonest build? |
|---|---|---|---|---|
| 1 | Verdict header (`:38-51`) | `api-verdict[data-variant]` `VerdictHeader.tsx:30`; `api-verdict-headline/-dek` `:32,36`; `[data-chip]` `IdentityChips.tsx:32`; one `<h1>` on the page | Yes — literals asserted and also equal to `deriveApiView(statedBaseUrl)` | Yes — wrong count/kicker/dek/chips fail; literals are pinned, not just the view's echo |
| 2 | Three tiles (`:53-58`) | `KpiTile.tsx:28` emits `data-testid` | Yes | Yes |
| 3 | Every operation, TOC + card (`:60-68`) | `EndpointCard.tsx:21`; TOC anchors `ApiSurface.tsx:89-92` (`href="#id"`, text `{method} {path}`) | Yes (17 ops, `proof-contract.gen.ts:61-3919`) | Yes — a dropped op fails per-id, the card count and the TOC count |
| 4 | Curl / quickstart / sample fidelity (`:70-82`) | `api-base-url-value` is `{baseUrl}` alone (JSX trims the newline-only whitespace, `ApiSurface.tsx:83-85`); `api-curl-getEvidence` sits on the `<pre>` only (`CodeBlock.tsx:22`), so no copy-button text leaks into `toBe`; `getEvidence` `samplePath` `/v1/evidence`, GET, not SSE (`gen:3692-3714`) → `curl -s "…"` (`EndpointCard.tsx:13-15`) | Yes | Yes |
| 5 | Copy affordance (`:84-90`) | `CopyChip` label → button name; unchanged law | Yes (clipboard permissions set `:22`) | Yes |
| 6 | Params + SSE (`:92-102`) | `getPositions` has `engine` `required: true` and "never blended" (`gen:569-572`); `getStream` `sse: true` (`gen:3912`) → no `details`, no `api-sample-getStream` | Yes | Yes |
| 7 | Error table (`:104-121`) | `KitTable.tsx:37-45` renders `tbody tr` with `data-testid={row.testId}`, no empty-row since rows > 0; `api-error-BatchSuperseded` "409" (`gen:4251-4252`); `api-error-sample-BatchSuperseded` → `summary` → `pre` (`ApiSurface.tsx:117-122`, `CodeBlock.tsx:22`) | Yes | Yes — a missing row fails per-id and the `tbody tr` count |
| 8 | Quickstart real (`:123-128`) | `api-quickstart` on the `<pre>` | Yes | Yes |
| 9 | Links to Verification (`:130-136`) | Exactly one `<a>` in `api-surface` whose name matches `/Verification/`: the `SectionHead` `Link` (`SectionHead.tsx:18`, label `ApiSurface.tsx:100`); TOC anchors are `GET /v1/…` | Yes; `/proof` loads with `/v1/**` aborted, URL asserted only | Yes |
| 10 | Response chips above the fold (`:138-151`) | `api-responses-getBook` `EndpointCard.tsx:57`; `getBook` has a 503 (`gen:83`); DOM order responses → `details` (`EndpointCard.tsx:55-79`) in a 12px-gap grid | Yes | Yes |
| 11 | Doctrine in the drawer; Escape; focus restored (`:153-171`) | `main` exists (`app/layout.tsx:36`); `api-drawer-body` absent when closed (`Drawer.tsx:107` returns null); three `<p>` in doctrine order (`ApiDrawer.tsx:22-24`). Escape: focus is on the panel after open (`Drawer.tsx:63`), the panel's `onKeyDown` closes on Escape (`:83-87`), the effect cleanup restores `restoreRef` (`:64-66`), captured as `document.activeElement` at open — the clicked button, since Chromium focuses a clicked `<button>`. Fixed-position panel: no `transform`/`filter`/`contain` on any ancestor (`globals.css:49-53` `.shell`, `kit.module.css:39` `.meta`, `api.module.css:5` `.page`) → viewport-relative; report concern 1(a) cleared by trace | Yes | Yes — doctrine drift fails `toHaveText([...])`; the intro leaking into the page fails `:157` |
| 12 | Answer-before-evidence y-order (`:173-182`) | All seven ids exist; JSX order in `ApiSurface.tsx:67-123` matches | Yes | Yes |

Anchoring check: pins 1, 4 and 11 compare the page to `deriveApiView(baseUrl)`, the page's own function — but the literal sentences are pinned in the unit spec (`api-view.spec.ts:24-30, :55-59`) and again literally in `api.spec.ts:44-46, :156-160`, so a wrong sentence in the view would fail both.

## Strengths

- The view model is genuinely pure and single-sourced: every figure is `OPERATIONS.length`, `ERROR_RESPONSES.length` or `CONTRACT_META.*`; nothing on the page repeats a number by hand.
- The three doctrine paragraphs are byte-faithful to the deleted page (checked against the minus lines), and the dek is provably the intro's closing clause (`api-view.spec.ts:59`).
- `EndpointCard`'s content and `curlFor` are untouched; the W-3L geometry law kept its pin. The error envelope became one table without losing the copyable bodies or their cited sources.
- The retirement ledger is complete and honest — the Proof Center pin's `proof-subject` assertion is correctly handed to Verification's contract rather than smuggled in.
- `api.spec.ts` is stronger than its predecessor (TOC count, `tbody tr` count, drawer focus restore, y-order) and reads the base URL from the page, never assuming it.

## Issues

### Critical

None.

### Important

1. **Width contract at 390px — the Endpoints head's link is nowrap.** `kit.module.css:57` `.sec a { white-space: nowrap }` and `.sec` (`:54`) is a non-wrapping flex row. The label "this deployment's evidence manifest → Verification" (`ApiSurface.tsx:100`, 46 chars at `--type-label` 13px ≈ 300px) plus the h2's min-content ("api/openapi.yaml" at `--type-h2`) plus the 12px gap exceeds 390 − 48px of shell padding. Unless something clips it, that is a horizontal scroll, which the Global Constraints forbid ("no horizontal scroll at 390+"). The implementer flagged it (report concern 5) for the Task 11/12 gate; I rate it Important because the constraint is plan-wide and the fix is one line — shorten the label ("Verification →" or "evidence manifest → Verification"), or add a page-local `.page :global(.sec) a { white-space: normal }`. Unverified by measurement (no build); the arithmetic is the evidence. Flag: **width contract (Global Constraints)**.

### Minor

1. **Copy composed in the component vs. the plan's "copy lives in `web/lib/**`".** `ApiSurface.tsx:95,98-100` composes the section titles, the qualifier `` `${N} operations, ${sourcePath} verbatim` `` and the Verification link label; `:76-78` the tile labels. The brief's `ApiView` has no field for them and its Step 3 spells them out, so this follows the brief; but the plan's Global Constraint is stricter. Suggest a follow-up adding `sections`/`links` to `ApiView` (or at least reading `view.tiles.operations` instead of re-stringifying `OPERATIONS.length` at `:99`). Flag: **copy grammar §3.5**.
2. **`Drawer` import path.** `ApiDrawer.tsx:4` imports `@/components/Drawer`; `components/kit/index.ts:16` already exports `Drawer` at the base commit `d7c6a4c` (the report's deviation 8 says the export had not landed — it had). Controller accepted; a one-line swap keeps the page kit-only. 
3. **"One client island" is inexact.** `CodeBlock.tsx:1` is `"use client"` (pre-existing, for `CopyChip`), so every code block is an island. The `ApiSurface.tsx:17` comment and the report overstate; no behavioural consequence.
4. **Kit-markup coupling.** `api.module.css:8` `.page [data-chip="Base URL"] b` reaches into `IdentityChips`' `<b>` (report concern 4). Works; a `mono` flag on `IdentityChip` would be the kit-side fix (Task 7's territory).
5. **`SectionHead` text content has no separator (kit-level).** `<h2>TypeScript<small>@solvent/client</small></h2>` reads "TypeScript@solvent/client" to assistive tech — spacing is visual only (`kit.module.css:56`). Not this task's defect; worth a `{" "}` or a visually-hidden " · " in the kit under Task 7/12.
6. **H1 = nav label (Global Constraints / R1) is not literally met by any kit page.** `VerdictHeader.tsx:32` puts the headline in `<h1>`; the page's "API" lives in the kicker (`:31`) and the metadata title (`page.tsx:5`). `shell.spec.ts:22` was re-pointed to the headline and the controller accepted. Cross-task plan tension, recorded here for the ledger, not a Task 6 fix.
7. **Ledger-note length.** `r1-fixes.spec.ts:160-161` is a two-line note where the plan asks one. Trivial.

## Assessment

The package does what the brief asks and nothing it forbids: the API page is the same contract render in the kit's register, with its words moved into a unit-pinned view model and its doctrine into the drawer verbatim. The e2e contract is well-formed — every selector it uses is emitted by the components as they stand at `cb22370`, and the pins would fail for a dropped operation, a missing error row, a wrong count or drifted doctrine. The one thing I would fix before the Task 12 gate is the nowrap link label at 390px.

**Could not verify without a run:** the actual e2e outcome (12 pins), the 390px overflow (arithmetic only), the clipboard permission behaviour on the shared build, and the reported gate results (`tsc`, `eslint`, `lint:css`, 823 unit).
