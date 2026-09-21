# Gate round · Phase 0 — report (the shared pieces)

Status: **DONE_WITH_CONCERNS** — six of seven items landed in one commit; **S4 is STOPPED** (its premise is false for
the approved Scenarios pin — see S4). Commit **bc40bdc** on `main`, 12 paths, by pathspec, scope gate OK, hooks ran,
no attribution line. Not pushed.

Gates (all from `web/`, on the committed tree): `npx tsc --noEmit` exit 0 · `npx eslint app lib components tests`
exit 0 · `npm run lint:css` exit 0 · `npx playwright test --project=unit` **951 passed, 0 failed** (was 937 + 14 new:
8 `human-utc`, 5 `instant-split`, 1 `kit`). No build, :3111 untouched, no snapshot update, no prettier.

## What the page implementers import

```ts
// web/lib/human-utc.ts
export function humanUtc(iso: string, referenceIso?: string): string;

// web/lib/instant-split.ts   (the kit already calls it — a page never needs to)
export interface InstantPart { readonly text: string; readonly instant: boolean }
export function splitInstants(text: string): InstantPart[];

// web/lib/lab-headline.ts
export interface LabHeadline { …; readonly tone: "crit" | "warn" | "ok" | "neutral" | "refused"; … }

// web/components/kit/VerdictHeader.tsx
export interface VerdictHeaderProps { …; tone: "crit" | "warn" | "ok" | "neutral" | "refused"; … }
```

`tone: "neutral"` renders `data-variant="neutral"` and the emphasis in `--ink` (`kit.emNeutral`). The `refused(...)`
helper is unchanged.

**`humanUtc` — exact output, and two things to know before pinning it:**

1. The tokens are joined with **U+00A0**, not a space: `humanUtc("2026-08-08T20:00:00Z", served_at)` is
   `"Aug 8, 20:00 UTC"`. A unit pin written with ordinary spaces FAILS `toBe`. Either pin against the
   function's own output plus one literal written with ` `, or use the spec's helper shape
   `const nb = (t: string) => t.replaceAll(" ", " ")` on the instant only (the rest of a sentence keeps its
   ordinary spaces). Playwright's `toHaveText` normalises whitespace on both sides, so e2e text pins are unaffected.
2. **With no `referenceIso` — or one that is not itself a well-formed UTC instant — the year ALWAYS prints**
   (`"Aug 8, 2026, 20:00 UTC"`). That is the clarity ruling's S3 ("with no `served_at` at hand, the year always
   prints"); the brief was silent on the absent case. To get the ruled `Aug 8, 20:00 UTC` you MUST pass the
   envelope's `served_at` (or the page's equivalent) as the second argument.

Year form is the brief's: `Aug 8, 2025, 20:00 UTC` (comma after the day). Accepted input: `YYYY-MM-DDTHH:MM[:SS[.fraction]]Z`,
upper-case `T`/`Z`, calendar-valid (month 1–12, day within the month incl. leap years, hour ≤ 23, minute/second ≤ 59).
Anything else — an offset (`+00:00` included), a date alone, Feb 30, hour 24, second 60, surrounding whitespace, a
sentence containing an instant — comes back VERBATIM. No `Date` is constructed anywhere in the module.

## Per item

**S1 · the `neutral` tone — LANDED.** `VerdictHeader.tsx`: `"neutral"` in `VerdictHeaderProps.tone`,
`EM_CLASS.neutral = styles.emNeutral`; `kit.module.css`: `.emNeutral { color: var(--ink); }` beside `.emOk`;
`lab-headline.ts`: `"neutral"` in `LabHeadline.tone` (edited last, in one motion, after `git diff --quiet` said
clean — the other implementer had already committed c79a773). No approved page passes it; Overview's own `EM_CLASS`
indexes a `BookHeadline`, a different type, and is untouched. Pin: `tests/unit/kit.spec.ts` "the header's tones" —
the kit's component tone map is NOT pinned in `kit.spec.ts` (that file pins `lib/kit.ts`; the unit project cannot load
a CSS module), so the pin is held by tsc through type-only imports: `SameUnion<VerdictHeaderProps["tone"],
LabHeadline["tone"]> = true` (the two unions can never drift) and an exhaustive `Record<VerdictHeaderProps["tone"],
boolean>` (a tone added or dropped is a type error). No styleguide specimen (not required).

**S2 · an instant never breaks mid-token — LANDED.** New `web/lib/instant-split.ts` (`splitInstants`, the ruled regex
verbatim); `VerdictHeader` maps its parts through a local `unbroken(text)`: each instant in
`<span className={styles.nobr}>`, prose as plain text; `.nobr { white-space: nowrap; font-variant-numeric:
tabular-nums; }`. A text with no instant short-circuits to the SAME string child as before, so every approved
headline renders the DOM it rendered yesterday. `textContent` is unchanged in all cases (the leading-space rule for
`rest` is applied before the split). Pin: `tests/unit/instant-split.spec.ts` (5 tests) — incl. the law that the parts
concatenate back to the input exactly, no empty parts, and only the wire's own form is marked.
Note for History: once the H1 speaks `humanUtc`, the no-break comes from the U+00A0 joins, not from this splitter;
the splitter still guards any arm that keeps a verbatim ISO instant in a headline.

**S3 · `humanUtc` — LANDED.** New `web/lib/human-utc.ts`, as specified above. Pin: `tests/unit/human-utc.spec.ts`
(8 tests): the happy form; the U+00A0 join stated literally; the year rule both ways; no/ill-formed reference → the
year prints; midnight (`00:00` on its own day, leap day); 19 malformed strings verbatim; 4 non-Z offsets verbatim;
and a zone pin that flips `process.env.TZ` across Kiritimati / Pago Pago / New York (verified separately that a
runtime TZ change does move `Date`'s local fields here, so the pin bites on any `Date`-based rewrite).

**S4 · the header action stays on row one — STOPPED, nothing landed.** `IdentityChips.tsx` and `.meta` are
untouched. B2's premise ("one-row headers are pixel-identical, approved pins hold") is true for Book, Inspector and
Overview but the approved **Scenarios** header is NOT one row at 1440: in the tracked baseline
`screenshots.spec.ts-snapshots/lab-dark.png` the lab's main column is 912px (x 424→1336), the five chips run 817px
(to x=1241), and the 208px `Assumptions · Out of model` button has already wrapped to row two, left-aligned
(817 + 10 + 208 = 1035 > 912). Under the two-column grid the button would move to row one at the right edge and
column one would shrink to 912 − 10 − 208 = 694px, so `Config v1` (and likely `Engines …`) would wrap beneath — the
`lab-dark` / `lab-light` pixel pins move. Secondary finding, same change: with no `trailing` (Overview's live strip)
an explicit `auto` track still costs its 10px gap, so the chip column narrows by 10px — harmless on today's Overview
(one row, wide slack) but not a no-op. Options for the controller: (a) owner re-approves a re-baselined Scenarios
fold (the new layout is arguably the better one there too); (b) make it opt-in (a prop/class only the four new pages
pass), leaving the approved pages on the flex row; (c) declare the second column implicitly
(`grid-template-columns: minmax(0, 1fr); grid-auto-flow: column;`) to remove the 10px no-trailing cost — this fixes
the secondary finding only, not Scenarios. **Page A (History) should not rely on the `.meta` grid**: its fifth chip
still wraps under the button until this is decided.

**S5 · one pressed-toggle grammar (kit half) — LANDED.** The ruled rule, verbatim, after `.btnGhost` in
`kit.module.css`. Grep first, as ordered: every `aria-pressed` in `web/app/**` + `web/components/**` is in
`feed/ActivityControls.tsx` (5), `observatory/HistoryChart.tsx`, `observatory/HistorySurface.tsx`,
`proof/VerificationSurface.tsx` (the raw-JSON toggle) and `components/kit/ScenarioLibrary.tsx` (3). The only ones on
an approved page are ScenarioLibrary's, and none of those three carries `btnGhost` (`libModeOn` / no class /
`libBody`); the lab's one ghost button there (`lab-compare`) has no `aria-pressed`. Book, Inspector and Overview have
no `aria-pressed` at all. So no approved rendering changes. Until the page phases delete them, the page-local copies
still win by specificity (`.controls .chipBtn[aria-pressed]` 0,3,0 — same values; History's
`.controls button[aria-pressed]` 0,2,1 — `--chip-bg` fill), so Activity and History render as before. One visible
effect today: Verification's `verification-raw` toggle (plain `btn btnGhost`, no page-local rule) now wears the accent
while pressed — the intended grammar, on an unapproved page, only after a click. No unit pin (CSS only).

**S6 · the Book's page padding — LANDED.** `padding: 28px 0 24px;` appended to the `.page` rule in
`history.module.css`, `activity.module.css`, `verification.module.css`, `api.module.css`. One line each, nothing
else in those files (api also carries S7). No unit pin (CSS only); the e2e/pixel side is the integrator's.

**S7 · light theme, the copy chip on the terminal ground — LANDED.** `api.module.css`, A8's two rules verbatim
(`.codeCopy button { background: transparent; border-color: var(--term-dim); color: var(--term-dim); }` +
`:hover` → `--term-accent`), tokens only, no new pair. Grep: `CopyChip` is mounted in two places —
`developers/CodeBlock.tsx` (on `--term-bg`, fixed here) and `proof/VerificationSubjects.tsx` (inside `.ident` on a
card's `--panel`, correct as is). The only other `--term-bg` ground, Verification's `.raw`, holds no chip. So this one
file is the whole pairing. Specificity checked: `.codeCopy button` (0,1,1) beats `.copy` (0,1,0); `.codeCopy
button:hover` (0,2,1) beats `.copy:hover` (0,2,0). Side effect, named: it also beats `.copied` (0,1,0), so on the
terminal the 1.2s copied state keeps the dim/accent colour and is carried by the glyph (`⧉` → `✓`) alone — before,
`.copy:hover` already outranked `.copied` while the pointer was still on the chip, so the green only ever showed
after the pointer left. If a coloured confirmation is wanted there, it needs `--term-ok` and a hook `CopyChip` does
not expose today (its `.copied` class lives in another module) — a page-phase or owner's-list call, not taken here.

## Concerns

1. **S4 STOPPED** (above) — needs a controller decision; the pages brief's preamble lists "the header `.meta` grid"
   as landed, and it is not.
2. **`humanUtc`'s year form**: the brief says `Aug 8, 2025, 20:00 UTC`, the clarity ruling's S3 says
   `Aug 8 2025, 20:00 UTC` (no comma after the day). I followed the brief. It is one template literal in
   `human-utc.ts` and two literals in its spec if the clarity form is the one wanted.
3. **`humanUtc` with no reference prints the year** (clarity S3) — a page that forgets the second argument gets
   `Aug 8, 2026, 20:00 UTC`, not the ruled demo words. Activity needs `served_at` threaded into its view input
   (clarity's B list) before its headline can drop the year.
4. Not verified by me (by instruction): no build, no e2e, no pixel replay. The four approved pins should hold — the
   only kit changes that reach an approved page are a string child that is byte-identical when no instant is present,
   and three new CSS rules none of their elements match.
