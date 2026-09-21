# Task 6 report — `api-view` and the API page

Status: DONE (unit gates green; the e2e contract is written and NOT run — the controller runs it on the shared build per the pre-flight ruling).

Commits (pathspec-limited, scope gate OK on both): `ac5eb15` (lib + pins), `cb22370` (page + contract + retirements).

## What was done

- `web/lib/api-view.ts` — `deriveApiView(baseUrl): ApiView` with the brief's interface verbatim: kicker `API · {title} v{version}`; headline emphasis `{N} read-only operations, every money value a decimal string.`, rest "", tone `ok`, dek `If a handler disagrees with this page, that is a failure, not documentation lag.`; chips Contract (`{title} · v{version}`) · Operations · Base URL (as given; the note as its title) · Source (`sourcePath`); tiles `{operations, errors, version}` as strings; the error rows `ERROR_RESPONSES` mapped (key = name; status as a string); doctrine = the intro, `Base URL {baseUrl}: the origin this deployment is built against (NEXT_PUBLIC_SOLVENT_API_URL).`, the provenance paragraph — all verbatim. Exports `API_DEK`, `API_INTRO`, `API_PROVENANCE`.
- `web/tests/unit/api-view.spec.ts` — 5 pins (tiles; header; chips incl. a second origin; error rows = the extract mapped; doctrine verbatim and the dek is the intro's closing clause). Written first, red (module missing), then green.
- `web/app/developers/page.tsx` — title "API"; renders `ApiSurface`; stays a server component.
- `web/app/developers/ApiSurface.tsx` (server) — root `api-surface`; `VerdictHeader` (`api-verdict`, the view's header, `actions` = the drawer island); three `KpiTile`s `api-kpi-{operations,errors,version}` (version's sub = `sourcePath`); the base-URL strip `api-base-url` with the value at `api-base-url-value`; the TOC `api-toc` as kit ghost anchors (`kit.btn kit.btnGhost`, mono override); `SectionHead` TypeScript / `@solvent/client` + `CodeBlock` `api-quickstart` (the quickstart text unchanged, moved from page.tsx); `SectionHead` Endpoints / `{N} operations, {sourcePath} verbatim` with the link `this deployment's evidence manifest → Verification` (`/proof`) + the `EndpointCard`s; `SectionHead` Error envelope + `KitTable` `api-errors` (Status · Response · Description; rows `api-error-{name}`; status and name in `kit.addr`, the description wrapping inside the nowrap cell) with each body in a `details` beneath (`api-error-sample-{name}`, `CodeBlock` + copy, the source cited).
- `web/app/developers/ApiDrawer.tsx` ("use client") — the header button `api-drawer` ("Methodology & evidence", `kit.btn kit.btnGhost`) and the `Drawer` (from `@/components/Drawer`) whose body `api-drawer-body` prints the doctrine paragraph by paragraph.
- `web/app/developers/EndpointCard.tsx` — content and `curlFor` unchanged; `kit.card` + page-local rows; ids `api-endpoint-{id}`, `api-curl-{id}`, `api-responses-{id}`, `api-sample-{id}`; the response codes still above the sample fold (W-3L 488).
- `web/app/developers/CodeBlock.tsx` — unchanged but for the stylesheet (`api.module.css`); the copy affordance (CopyChip) kept.
- `web/app/developers/api.module.css` — page-local rules only, `--type-*` tokens throughout: the tiles grid (3 → 1 column under 640px), the base-URL strip, the TOC's mono ghost anchors, the endpoint rows (verb, path, params, responses, sample fold, SSE note), the terminal code treatment, the error-table wrap and folded samples, the drawer body.
- `web/tests/e2e/api.spec.ts` — 12 pins, no routes mocked (the stream aborted only): header + chips + H1; tiles; every operation in the TOC and as a card (count = `OPERATIONS.length`); curl/quickstart/sample fidelity against the stated base URL; the copy affordance; params + SSE; the error table (rows = `ERROR_RESPONSES.length`, 409, the BatchSuperseded body parsed); the quickstart is real; the Verification link; the response chips above the fold; the doctrine in the drawer verbatim + Escape closes + focus restored; answer-before-evidence y-order.
- Deleted: `web/app/developers/developers.module.css`, `web/tests/e2e/developers.spec.ts`.

## Retirement ledger — `developers.spec.ts` (8 pins) and the API pins elsewhere

| Old pin | Disposition |
|---|---|
| every contract operation renders (`endpoint-{id}`, count = N) | RE-EXPRESSED — api.spec "every contract operation renders — in the TOC and as a card": `api-endpoint-{id}` count = `OPERATIONS.length`, and the TOC's anchors (`#id`, `{method} {path}`) too |
| curl-sample fidelity (`base-url` span nth(1), `curl-getEvidence`, `sample-getEvidence` = `EVIDENCE_MANIFEST`) | RE-EXPRESSED — `api-base-url-value`, `api-curl-getEvidence`, `api-sample-getEvidence`; plus the quickstart carries `baseUrl: "{baseUrl}"` |
| the copy affordance copies the verbatim curl | RE-EXPRESSED — same law, `api-curl-getEvidence` |
| params render required flags; the SSE route invents no sample | RE-EXPRESSED — `api-endpoint-getPositions`, `api-endpoint-getStream`, `api-sample-getStream` count 0 |
| error-envelope samples byte-faithful (`error-{name}` cards; 409; the body) | RE-EXPRESSED — the envelope is one table: `api-errors` rows `api-error-{name}` = `ERROR_RESPONSES.length`, each with its status and name; the BatchSuperseded row says 409; its body opened from `api-error-sample-BatchSuperseded` and parsed equal to the extract |
| the TypeScript quickstart is present and real (`ts-quickstart`) | RE-EXPRESSED — `api-quickstart` |
| the page cross-links to the Proof Center (click "Proof Center" → `/proof`, `proof-subject` visible) | RE-EXPRESSED as "the page links to Verification" — the link is `this deployment's evidence manifest → Verification` scoped to `api-surface`; the URL is asserted. `proof-subject` is Verification's contract (Task 5 renames it) and is not asserted from here |
| W-3L (488) the response chips sit above the sample fold | RE-EXPRESSED — same geometry, `api-responses-getBook` |
| r1-fixes (6) `/developers` in the no-eyebrow sweep | KEPT unchanged (still true) |
| r1-fixes (10) the Developers intro in `main` | RETIRED in place with a one-line note; RE-HOMED to api.spec's drawer pin: the intro verbatim in `api-drawer-body`, and `main` does not carry its opening before the drawer opens (the dek keeps the closing clause, R3) |
| p1a-fixes / p1b-fixes | no API pins (grep `developers` empty) |
| shell.spec.ts `/developers` h1 "Developers" | RE-POINTED to the headline (`/read-only operations, every money value a decimal string\.$/`) — the page is static so the H1 holds with no API |
| state-matrix.spec.ts developers cell (`endpoint-getEvidence`, `error-BatchSuperseded`) | RE-POINTED to `api-endpoint-getEvidence`, `api-error-BatchSuperseded` |

## Gates

- `npx playwright test --project=unit tests/unit/api-view.spec.ts`: 5 passed. Whole unit project: 823 passed.
- `npx tsc --noEmit`: clean. `npx eslint app/developers lib tests`: clean. `npm run lint:css`: clean.
- `tests/e2e/api.spec.ts` (12 pins): NOT run — no build during the parallel phase (the pre-flight ruling); the controller runs it and returns failures.

## Deviations

1. Two files outside the brief's list were edited, one line each, because they pin this page's H1 and ids and would fail otherwise: `tests/e2e/shell.spec.ts` (the `/developers` h1) and `tests/e2e/state-matrix.spec.ts` (the two ids). Revert if unwanted.
2. Sub-ids beyond the contract table, all under the `api-` prefix (R8): `api-base-url-value`, `api-curl-{id}`, `api-sample-{id}`, `api-responses-{id}`, `api-error-sample-{name}`; plus `VerdictHeader`'s own `api-verdict-headline` / `-dek` / `-identity`.
3. `SectionHead`'s title/qualifier split renders "TypeScript @solvent/client" and "Endpoints 17 operations, api/openapi.yaml verbatim" (the kit's `small` qualifier) rather than a literal " · ".
4. The base-URL note's doctrine string is `Base URL {baseUrl}: {note}.` — the note verbatim, prefixed with the URL so the drawer stands alone; the same note is the Base URL chip's `title`.
5. `quickstart()` stays in `ApiSurface.tsx` (a sample, not copy); the brief's `ApiView` has no field for it.
6. Tiles carry no subs except version's `sourcePath` — no copy composed in the component.
7. `kit.module.css` has no `.mono`; `kit.addr` is used for mono identifiers in the table. The verb badge, the response-code chips and the terminal code treatment stay page-local classes (the kit carries none of them).
8. `Drawer` is imported from `@/components/Drawer` (Task 1's kit export had not landed).
9. `git rm` met another implementer's `index.lock`; the two deletions were made in the working tree and staged by name — the same result.

## Concerns

1. The e2e contract is unrun. Watch: (a) the `Drawer` renders inside `IdentityChips`' trailing slot — a fixed-position panel as a sibling in the `.meta` flex row; viewport-relative unless an ancestor gains a `transform`; (b) the Escape → `api-drawer` `toBeFocused()` pin is the first to assert the Drawer's focus restore; (c) `main` is assumed to wrap the page (the old r1 pin used it).
2. r1-fixes (10)'s title still names Developers; three other implementers edit the same test — the controller reconciles the title once all four arms land (left alone to avoid clobbering).
3. `CodeBlock` imports `CopyChip` from `../proof/CopyChip`; the plan keeps `CopyChip.tsx` (Task 5) — if it moves, that import is the one line to follow.
4. `.page [data-chip="Base URL"] b` reaches into the kit's chip markup by attribute — a small coupling to `IdentityChips`' `data-chip` / `<b>` structure.
5. Register: the TOC is 17 ghost buttons (about three rows at 1440); the Endpoints head's link label is long for `.sec a` (nowrap) at 390px — both for the Task 11/12 gate to judge.

## Fix round 1 (after task-6-review.md)

- Important 1: the Endpoints `SectionHead`'s link label is `Verification →` — short enough that the kit's nowrap `.sec a` and the h2's min-content fit the 390px shell with no horizontal scroll. The kit rule is untouched. `ApiSurface.tsx` only.
- Minor: `ApiDrawer.tsx` imports `Drawer` from `@/components/kit` (exported since d7c6a4c) instead of `@/components/Drawer`.
- Gates: `tsc --noEmit` clean; `eslint app/developers` clean; unit project 858/858. No build/e2e (the controller runs api.spec.ts on the shared build). The api.spec.ts Verification-link pin matches on `/Verification/`, so the shorter label needs no spec change.
- Commit 9b029bf (pathspec-limited, scope gate OK): two lines changed across the two files.
