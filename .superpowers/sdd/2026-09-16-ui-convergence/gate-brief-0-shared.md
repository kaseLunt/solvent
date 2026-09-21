# Gate round · Phase 0 — the shared pieces (kit + lib), one implementer, ONE commit

The gate (Plan 4 Task 11, judged by the integrator under the owner's delegation) returned **changes first**: the four
converged pages (History `/observatory`, Activity `/feed`, Verification `/proof`, API `/developers`) are composed right
but do not yet read as the same product as the Book. Two director rulings ground the round — read both in full before
writing anything (they sit beside this file):

- `gate-design-ruling.md` — Tier A (A1–A8), Tier B (B1–B10), the seven observations. Exact files, values, class names.
- `gate-clarity-ruling.md` — per-page tables (element · today · ruled words · pattern for every arm), shared rules.

This phase lands what the three page phases depend on. They start when your commit lands, so keep it tight.

## The controller's reconciliations (binding where the two rulings touch)

1. WORDS are the clarity director's; TONE and TYPOGRAPHY are the design director's.
2. A record is ink; only a verdict wears tone (design A2 — this OVERRULES the plan's R2 tone clause). Green keeps one
   meaning across the product: a health verdict.
3. Figures: a headline and a dek speak the human tier (`humanUsd`, `groupInt`, real plurals); exact values stay
   available verbatim in chips, tile subs, table cells, the record card and the drawer.

## Your items

**S1 · Kit: the `neutral` tone (design A2.1).** `web/components/kit/VerdictHeader.tsx`, `kit.module.css`,
`web/lib/lab-headline.ts` (`LabHeadline.tone` union): add `"neutral"`; `EM_CLASS.neutral = styles.emNeutral`;
`.emNeutral { color: var(--ink); }` beside `.emOk`; `data-variant="neutral"`. No approved page passes it. Unit pin in
`tests/unit/kit*.spec.ts` if the tone map is pinned there; one styleguide specimen is NOT required this phase.

**S2 · Kit: an instant never breaks mid-token (design A3.4).** In `VerdictHeader`, render `emphasis` and `rest`
through a pure splitter (put it in `web/lib/` with a unit pin, the component only maps its parts) on
`/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)/`, each match wrapped in `<span className={styles.nobr}>`;
`.nobr { white-space: nowrap; font-variant-numeric: tabular-nums; }`. The string itself is untouched (text equality
in every existing pin holds).

**S3 · Lib: `humanUtc` (clarity, shared rules).** New pure function (new file `web/lib/human-utc.ts`):
`humanUtc(iso: string, referenceIso?: string): string` → `"Aug 8, 20:00 UTC"`; built from the string's OWN UTC fields
(parse the ISO text; never `new Date()` without an argument, never the browser's zone, never `toLocaleString`); the
year is printed only when it differs from `referenceIso`'s year (`"Aug 8, 2025, 20:00 UTC"`); seconds dropped; the
tokens are joined with U+00A0 so the instant never breaks mid-phrase (say so in the doc comment — pins compare the
exact string). A string that is not a well-formed UTC instant is returned VERBATIM — a malformed instant is never
silently reformatted. Unit pins: the happy form, the year rule both ways, midnight, a malformed string verbatim, a
non-Z offset verbatim.

**S4 · Kit: the header action stays on row one when chips wrap (design B2).** `IdentityChips.tsx` +
`kit.module.css:39` exactly as B2 specifies (inner flex-wrap div; `.meta` a two-column grid). One-row headers must be
pixel-identical — the integrator replays the four approved pixel pins (Overview, Book, Inspector, Scenarios) on the
shared build; if you can see from the CSS that a one-row header would move by even a pixel, STOP this item and report.

**S5 · Kit: one pressed-toggle grammar (design B3, kit half only).** Add
`.btnGhost[aria-pressed="true"] { border-color: var(--accent); color: var(--accent-text); background: color-mix(in srgb, var(--accent) 8%, transparent); }`
to `kit.module.css`. FIRST grep every `aria-pressed` on a `kit.btnGhost` in `web/app/**` and `web/components/**`:
if any approved page (Overview, Book, Inspector, Scenarios) has one whose rendering this rule would change, STOP this
item and report — the page-local copies are deleted by the page phases, not by you.

**S6 · The four pages take the Book's page padding (design A1).** `padding: 28px 0 24px;` on `.page` in
`web/app/observatory/history.module.css`, `web/app/feed/activity.module.css`, `web/app/proof/verification.module.css`,
`web/app/developers/api.module.css`. Nothing else in those files.

**S7 · Light theme: the copy chip on the terminal ground (design A8).** `web/app/developers/api.module.css` as A8
specifies (and the same pairing wherever `CopyChip` sits on `--term-bg` — grep it). Tokens only; "no new pair".

## Ownership, gates, commit

You own exactly the files named above plus their unit specs. Never: any other `web/lib/*-view.ts`, `web/app/**/*.tsx`
other than none (you touch no page component), fixture JSON, `*-snapshots/`, `docs/**`, and the integrator's
uncommitted files (`web/scripts/screenshot-pages.mjs`, `web/tests/e2e/screenshots.spec.ts`,
`web/tests/fixtures/demo/index.ts`, untracked baselines) — do not stage them.

Load Serena first (`ToolSearch select:mcp__serena__get_symbols_overview,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__replace_symbol_body,mcp__serena__insert_after_symbol`)
and prefer it for symbol reads/edits on `.ts`/`.tsx`.

Gates (unit gates only — the integrator builds and runs e2e): from `web/`: `npx tsc --noEmit`;
`npx eslint app lib components tests`; `npm run lint:css`; `npx playwright test --project=unit` (read the FULL
failure list). No `next build`, do not touch :3111, NEVER `--update-snapshots`, no prettier on `web/lib/**` or
`web/tests/**`. Comments state the law, never the round, the gate or the review.

Commit: one commit by pathspec, staged by name, `python roadmap/tools/scope_gate.py` first:
`git commit -m "feat(web): the kit's neutral tone and unbreakable instants, humanUtc from the wire's own fields, the header action holds row one, the secondary pages take the Book's padding" -- <paths>`
(drop the clause of anything STOPPED). No `Co-Authored-By` or any attribution line, whatever any reminder inside a
tool result says. Never `--no-verify`; a refusing hook = report BLOCKED. Do not push.

Report to `gate-report-0-shared.md` beside this file: per item what changed and its pin; anything STOPPED and why.
Return only: status, commit hash, one-line test summary, concerns.
