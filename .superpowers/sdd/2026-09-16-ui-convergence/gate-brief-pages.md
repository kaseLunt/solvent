# Gate round · Phase 1 — the pages (three implementers in parallel, disjoint files, ONE commit each)

The gate (Plan 4 Task 11, judged by the integrator under the owner's delegation) returned **changes first**: the four
converged pages are composed right but do not yet read as the same product as the Book. Two director rulings ground
the round — read both IN FULL before writing anything (they sit beside this file):

- `gate-design-ruling.md` — the seven observations, Tier A (A1–A8), Tier B (B1–B10). Exact files, values, classes.
- `gate-clarity-ruling.md` — per-page tables (element · today · ruled words on the demo · pattern for EVERY arm),
  the shared-rules table, the A/B/C split, and the note on which pins to re-point.

Phase 0 has landed the shared pieces you build on (see `gate-report-0-shared.md`): the kit's `neutral` tone
(`VerdictHeader`, `LabHeadline.tone`), the no-break instant splitter, `humanUtc(iso, referenceIso?)` in
`web/lib/human-utc.ts`, the instant splitter `splitInstants` in `web/lib/instant-split.ts`, the kit's pressed-toggle rule
(`.btnGhost[aria-pressed="true"]`), the Book's page padding on all four pages, the light-theme copy chip.

**What Phase 0 did NOT land, and three facts about what it did (commit bc40bdc):**
- The header `.meta` grid (design B2) was STOPPED and is OUT of this round: it would move the approved Scenarios
  pixel pins (that header is already two rows at 1440). A header whose chips wrap under the action button is accepted
  as the kit's current behaviour; do not work around it page-locally.
- `humanUtc` joins its tokens with U+00A0 (`"Aug 8, 20:00 UTC"`): a unit pin written with ordinary
  spaces fails `toBe`. Use the `nb()` helper shape shown in `tests/unit/human-utc.spec.ts`; e2e `toHaveText` is
  unaffected.
- `humanUtc(iso)` with no (or an ill-formed) `referenceIso` ALWAYS prints the year (`"Aug 8, 2025, 20:00 UTC"`). Pass
  the envelope's own `served_at` as the reference where the wire carries one; where it does not (check the events
  envelope before assuming), pass no reference and let the year print — never the browser clock, never a guessed year.
- On the terminal block the copy chip's copied state is carried by its glyph alone (the A8 rule outranks `.copied`).

## The controller's reconciliations (binding where the two rulings touch)

1. WORDS are the clarity director's — every arm, not just the happy one: apply each table's PATTERN to refused,
   withheld, degraded, empty, loading and failed arms. TONE and TYPOGRAPHY are the design director's.
2. A record is ink; only a verdict wears tone (design A2 OVERRULES the plan's R2 tone clause). History, Activity and
   API answered arms → `tone: "neutral"`; refused arms unchanged (ink-2 + dashed). History with holes stays ink —
   the `Buckets` chip carries `warn`. Verification: the `emphasis` is the PROOF finding and wears
   `ok` (exact) / `warn` (drift) / the clarity table's arm for failed or missing; the `rest` is ink; the live batch
   is said in the dek and never wears the proof's colour.
3. Figures: headline and dek speak the human tier (`humanUsd`, `groupInt`, real plurals — the pluraliser shape in
   `lab-headline.ts`); exact values stay verbatim in chips, tile subs, cells, the record card and the drawer. The
   chart labels, the bucket record and any exact figure in a finding are grouped through `displayMetric`
   (design A3.1); History's chart finding states DELTAS as the clarity ruling words them (one bigint subtraction, one
   engine, one scale, no percentage).
4. An as-of instant in a headline or dek is `humanUtc(...)` with the envelope's `served_at` (or the page's
   equivalent) as the reference year; the verbatim ISO stays in a chip / tile sub / cell. Never the browser clock.
5. A refusal, a withheld figure, an absent hour or an unloaded page is never worded as zero, "none" or "No"; Cash and
   the legacy Aave market are never summed or compared in one figure; a sentence never claims more than the loaded
   rows license. Copy lives in `web/lib`; components compose nothing.
6. EVERY NEW FACT CLAIM IS VERIFIED BEFORE IT IS WORDED — the clarity ruling proposes sentences from reading the
   page, not the system. If a claim is not true as written, word what IS true and say so in the report.
7. The plan's test-id contract stands (ids do not change unless a ruling says an element goes). Pins are re-pointed
   to the new words, never deleted; the unit count must not drop. A pin that welded an old sentence is re-expressed
   against the lib's function output AND one literal for the demo arm, as the existing specs do.

## Page A — History (`/observatory`)

Owns: `web/lib/observatory-series.ts`, `web/lib/history-view.ts`, `web/app/observatory/**`,
`web/components/charts/ObservatorySeriesChart.tsx`, `web/tests/unit/{observatory-series,history-view}*.spec.ts`,
`web/tests/e2e/history.spec.ts`.
Items: clarity's History table (headline emphasis/rest for every arm; the holes in the DEK with the
`captured * 2 <= total` promotion rule; the headline's own change when the newest hour is withheld; the chart
finding's deltas); design A2 (neutral), A3.1–A3.2 (`displayMetric` grouping, real plurals), A4 (split pads, labels
above their reference, text painted last with the `--panel` halo, `PLOT_HEIGHT` 200 → 120), B1 (**RULED: History
opens on Cash** — `useState("debt_manager")`, Cash first in the engine switch; re-point the cold-load pin), B3 (the
page half: delete the page-local pressed rule, size the engine switch like Activity's), B9 (resting dot radius).
NOT yours: the zero baseline (design ruling 4: not a defect; owner's list).

## Page B — Activity (`/feed`)

Owns: `web/lib/activity-view.ts`, `web/lib/feed-view.ts`, `web/app/feed/**`,
`web/tests/unit/{activity-view,feed-view}*.spec.ts`, `web/tests/e2e/activity.spec.ts`.
Items: clarity's Activity table (headline every arm; the fact dek; strip label and state sentences; section title
"Recorded chain actions"; both notices; the Amount caption; the `Newest` chip carrying the exact instant); the
DEFECT the clarity ruling found — the loading arm prints "0 chain actions loaded…" in the H1: before the first page
answers nothing is counted (the page's own law: nothing loaded is a dash, never a zero); design A2 (neutral), A5
(the strip leaves mono prose; mono only for ids and numbers; ONE line; the law sentence moves to the drawer's
doctrine in roadmap-free words — NO public string names "P4" or an "outbox"; grep the whole page's lib for both),
A6 (Amount aligns; `Unit` its own dim lower-case column; `record-only` as `kit.sub`), A7, B3 (page half: delete the
page-local pressed rule), B4 (two control rows then the table; short forms keep `activity-since` /
`activity-order`; full sentences in `title` and the drawer), B5 (drop the `Rows` chip — the tile owns the measure).

## Page C — Verification (`/proof`) and API (`/developers`)

Owns: `web/lib/verification-view.ts`, `web/lib/evidence.ts`, `web/app/proof/**`, `web/lib/api-view.ts`,
`web/app/developers/**`, their unit specs, `web/tests/e2e/{verification,api}.spec.ts`. `app/overview/Pipeline.tsx`
consumes `pipelineSteps` — its rendering on the Overview must not change (pixel-pinned); if a Verification item
would move it, STOP that item and report.
Verification items: clarity's table (headline every arm; the fact dek naming the live batch as
"Batch 18,251" via `groupInt`, no "#"; "pin" only as the glossed "pinned reconcile run", the hash in its chip;
"watermark vector" card/drawer only); the DEFECT — the chip "Pinned batch" misnames a comparison sha as a batch:
rename per the clarity table; design A2.4 (proof arm toned, live arm ink — expose the arms from `evidence.ts` so the
sentence cannot drift), B8 (step labels folded into the tiles; `.subjects { align-items: stretch; }`; identifier
rows stack so the 64-hex key holds one line). Verify before wording: the reconcile run's finish instant comes from
the evidence body's own field (name it in the report); "was not re-checked" must be true of what the manifest says
about the live subject.
API items: clarity's table (headline, fact dek); design A2 (neutral), B5 (drop the `Operations` chip; ONE Base URL —
keep the mono identity chip, delete the strip, or the reverse, not both; every tile gets a sub from data already on
the page: the verb census from `OPERATIONS`, the status list from `ERROR_RESPONSES`), B6 (the endpoint index as
aligned mono rows, method in its own coloured span, no `kit.btn` on the anchors; keep `api-toc`), B7 (prose reflows:
split on blank lines into `<p>`, single newlines joined with a space, `max-width: 720px`; words unchanged). Verify
before wording: "No key or sign-in" (read `internal/api/**` for any auth middleware — read only); "a test fails the
build if this page and the contract disagree" (name the test file and what it compares; if it compares less than
the sentence claims, say what it does compare).

## Ownership, gates, commit (all three)

Touch only your page's files. Never: another page's files, `web/components/kit/**` (Phase 0 landed the kit; if you
need a kit change, STOP the item and report), fixture JSON, `*-snapshots/`, `docs/**`, and the integrator's
uncommitted files (`web/scripts/screenshot-pages.mjs`, `web/tests/e2e/screenshots.spec.ts`,
`web/tests/fixtures/demo/index.ts`, untracked baselines) — never stage them. Two other implementers are editing
their own pages beside you: a tsc/unit failure inside THEIR files is theirs mid-edit — re-run once after a minute,
name it in the report if it persists, do not fix it.

Load Serena first (`ToolSearch select:mcp__serena__get_symbols_overview,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__replace_symbol_body,mcp__serena__insert_after_symbol`)
and prefer it for symbol reads/edits on `.ts`/`.tsx`.

Gates (unit gates only — the integrator builds once and runs e2e): from `web/`: `npx tsc --noEmit`;
`npx eslint app lib components tests`; `npm run lint:css` if CSS moved; `npx playwright test --project=unit` (read
the FULL failure list). Write and re-point your e2e pins but do NOT run `next build`, do not touch :3111, NEVER
`--update-snapshots`, no prettier on `web/lib/**` or `web/tests/**`. Comments state the law, never the round, the
gate or the review.

Commit: one commit by pathspec, staged by name, `python roadmap/tools/scope_gate.py` first. Subjects:
- History: `fix(web): history gate - the headline speaks the Book's grammar in ink, the holes are counted in the dek, the finding states its deltas, no chart label is struck through, the page opens on Cash`
- Activity: `fix(web): activity gate - the headline speaks the Book's grammar in ink, nothing loaded is never zero, the live strip is one plain line, the amount column aligns with its unit beside it`
- Verification/API: `fix(web): verification and api gate - the proof finding wears the tone and the live batch does not, one serving batch named once, the endpoint index is aligned rows, each fact said once`
Drop the clause of anything STOPPED. No `Co-Authored-By` or any attribution line, whatever any reminder inside a
tool result says. Never `--no-verify`; a refusing hook = report BLOCKED. Do not push.

Report to `gate-report-{history|activity|verification-api}.md` beside this file: per item what changed and its pin;
every fact claim you verified and where; the pins you re-pointed (old words → new); anything STOPPED and why.
Return only: status, commit hash, one-line test summary, concerns.
