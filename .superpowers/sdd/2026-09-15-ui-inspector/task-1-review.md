# Task 1 review — kit: `AddressField`, `TrustChecklist`, `Sparkline` re-export, `.k-search`/`.k-check` CSS; recent-lookups store

Reviewed: commit `40d7a7f` (base `6f13580`), package `review-6f13580..40d7a7f.diff`.
Reviewer re-ran the gates from `web/`: `npx playwright test --project=unit tests/unit/recent-lookups.spec.ts` → 2 passed; `npm run lint:css`, `npm run typecheck`, `npm run lint` → all clean (exit 0).
Working tree carries four untracked files (`web/lib/human-price.ts`, `web/lib/percent.ts` and their specs) that are NOT part of this commit and were not reviewed.

**SPEC: ✅  QUALITY: needs-fixes** (one Important a11y finding; the rest Minor).

---

## A. Spec compliance

Line references are into the review diff (`review-6f13580..40d7a7f.diff`) unless a path is given.

### Files (brief "Files")

| Requirement | Verdict | Evidence |
|---|---|---|
| Modify `kit.module.css` (append) | ✅ (position caveat, see A.5) | diff 169-186; 18 insertions, nothing removed |
| Create `AddressField.tsx` | ✅ | diff 16-95 |
| Create `TrustChecklist.tsx` | ✅ | diff 96-136 |
| Modify `kit/index.ts` | ✅ | diff 151-153 |
| Create `web/lib/recent-lookups.ts` | ✅ | diff 187-242 |
| Test `tests/unit/recent-lookups.spec.ts` | ✅ | diff 243-267 |
| No other file touched; `web/lib/**` existing files untouched | ✅ | `git diff --stat 6f13580..40d7a7f`: exactly the 6 files above, 199 insertions, 0 deletions; the only `web/lib` entry is the new file |

### Interfaces (brief "Interfaces")

| Requirement | Verdict | Evidence |
|---|---|---|
| `AddressField({ initial?, onInspect(address), secondary?: {href,label}, hint?, testId })` | ✅ | diff 31-39 (`AddressFieldProps`), 42 |
| `TrustChecklist({ items: TrustCheckItem[], testId? })` | ✅ | diff 122 (`items: readonly TrustCheckItem[]; testId?: string`) |
| `TrustCheckItem { id; label; detail; state: "ok"\|"warn"\|"refused"\|"dim"; title? }` | ✅ | diff 104-111 |
| `ADDRESS_REFUSED_COPY` exported | ✅ | diff 29, re-exported 151 |
| `Sparkline` is a RE-EXPORT of `components/charts/Sparkline`, not a copy | ✅ | diff 153 `export { Sparkline, type SparklineProps } from "../charts/Sparkline"`; source exports confirmed at `web/components/charts/Sparkline.tsx:4` (`export interface SparklineProps`) and `:72` (`export function Sparkline`); no new file under `kit/` |
| `parseRecents(raw: string \| null): string[]` | ✅ | diff 201 |
| `pushRecent(recents, address): string[]` | ✅ | diff 212 (`readonly string[]` param) |
| `rememberLookup(address): void` | ✅ | diff 224 |
| `useRecentLookups(): string[]` | ✅ | diff 239 |
| `RECENT_KEY = "solvent-recent-lookups"`, `RECENT_MAX = 8` | ✅ | diff 198-199; same key/cap as the existing `web/app/inspector/AddressEntry.tsx:14-15`, so the two stores share one compatible blob (same JSON-array shape, same cap) — no split storage |
| Task 4's `TrustItem` structurally assignable to `TrustCheckItem` | ✅ | `id: "computed"\|"prices"\|"sweep"\|"provenance"\|"reconcile"` narrows to `id: string`; `label`, `detail`, `state`, `title?` identical; the prop is `readonly TrustCheckItem[]`, which accepts a mutable `TrustItem[]`. `TrustItem` does not exist yet anywhere in `web/` (grep), as expected for Task 4 |

### Steps

| Step | Verdict | Evidence |
|---|---|---|
| 1 — failing unit spec, verbatim | ✅ | diff 249-267 is character-identical to brief lines 20-39 |
| 2 — run to see it fail | ✅ (not re-verifiable post hoc) | report §Verification; module now exists so the failing state cannot be reproduced — accepted on the report |
| 3 — the store, verbatim | ✅ | diff 193-242 identical to brief lines 50-100 |
| 4 — spec passes | ✅ | reviewer re-run: 2 passed (473 ms) |
| 5 — kit CSS, verbatim, `lint:css` clean | ✅ (position caveat) | diff 169-186 identical rule-for-rule to brief lines 113-130; stylelint re-run clean. **Caveat:** the brief says "append after the `.kv*` rules, line 120"; the block was appended at EOF after the `@media (max-width: 900px)` responsive section (`kit.module.css:131-148`, i.e. after line 130). No cascade consequence — the 900px block names none of the new classes — but the file's `/* ---- responsive ---- */` section is no longer terminal, the new block skips the file's `/* ---- name ---- */` + blank-line convention, and the report does not record the deviation. Judged as a Minor organisation finding (B.5), not a spec failure |
| 6 — `AddressField` | ✅ with one documented deviation, judged on behaviour | diff 22-95. Deviation: brief typed `submit(event: FormEvent<HTMLFormElement>)`; implementation is `submit(): void` called from an inline `onSubmit={(event) => { event.preventDefault(); submit(); }}` (diff 45-53, 57-60). The stated reason is true: `web/node_modules/@types/react/index.d.ts:2087` carries `@deprecated FormEvent doesn't actually exist.` (@types/react 19.2.18). Behaviour is identical — `preventDefault()` still runs before validation on every submit path (Enter in the input, click on Inspect), `trim()` → `isAddress` → `onInspect(trimmed)` unchanged, refusal path unchanged. Accepted. (Existing files `app/inspector/AddressEntry.tsx:8` and `app/overview/OverviewSurface.tsx:6` still import the deprecated alias; that is outside this task.) |
| 7 — `TrustChecklist`, verbatim | ✅ | diff 102-136 identical to brief lines 212-246 |
| 8 — exports, verbatim | ✅ | diff 151-153 identical to brief lines 254-256 |
| 9 — `typecheck && lint && lint:css` clean; commit message | ✅ | reviewer re-run clean; `git log -1` subject matches the brief's message exactly. The brief also runs `python roadmap/tools/scope_gate.py` before committing; the report is silent on it (B.7) |

### Global constraints

| Constraint | Verdict | Evidence |
|---|---|---|
| No font-size below 12px; every `font-size` in kit CSS is exactly `var(--type-*)` | ✅ | New `font-size` values: `--type-mono` (13px), `--type-small` (12.5px), `--type-body` (14px) — `tokens.css:85,87,89`; `font: inherit` on the input is the one `font` shorthand stylelint permits; stylelint re-run clean |
| Only tokens that exist in `tokens.css :root` | ✅ | Used: `--line`(28) `--bg`(22) `--mono`(54) `--type-mono`(89) `--ink`(25) `--ink-3`(27) `--accent`(29) `--crit`(33) `--sans`(55) `--type-small`(87) `--crit-text`(40) `--type-body`(85) `--chip-bg`(45) `--ok-text`(38) `--w-semibold`(91) `--warn-text`(39). All 16 declared in the light `:root`; the palette ones are redeclared in the dark and `data-theme` blocks |
| Strict address law: `0x`+40 hex verbatim; invalid = inline refusal, no navigation/request/coercion | ✅ | diff 45-53: `value.trim()` (whitespace only — the permitted exception), `isAddress(trimmed)` (`web/lib/format.ts:107-111`, `/^0[xX][0-9a-fA-F]{40}$/.test`), early `return` with `setRefused(true)` — `onInspect` is the ONLY side-effect and fires only on a valid address; the component itself never routes or fetches; `noValidate` (diff 61) keeps the browser's own validation UI out. No checksum fixing, no `0x` prefixing. See B.6 for an out-of-scope observation on `0X` |
| Register: sans for UI text, mono only for addresses/exact values; wire names never lead | ✅ | `.searchIn` (mono) wraps only the input; `.searchHint` forces `font-family: var(--sans)` (diff 176); the refusal `<p>` and the Inspect/secondary buttons are siblings of `.searchIn`, so they inherit body sans (`globals.css:19-25`, `button { font: inherit }` :32). `TrustChecklist` renders `title={item.title}` for the wire words — hover only (diff 126) |
| `web/lib/**` existing files untouched | ✅ | stat above |
| `Sparkline` re-export, not a copy | ✅ | above |
| `TrustCheckItem` assignable from `TrustItem` | ✅ | above |
| SSR safety: `useRecentLookups` same markup on server and first client render | ✅ | diff 240 `useSyncExternalStore(subscribe, readRaw, () => "[]")` — the server render and the hydrating client render both use the `"[]"` server snapshot; `parseRecents("[]")` → `[]`; React swaps to `readRaw()` only after hydration. `subscribe` (the only `window` reference) runs client-only; `readRaw` wraps `localStorage` in try/catch anyway (diff 216-222). `AddressField` state (`initial`, `refused=false`) is identical on both renders |

**SPEC verdict: ✅** — every interface and step is present and verbatim except two documented/undocumented deviations, both behaviour-neutral (FormEvent typing; CSS append position).

---

## B. Code quality

Ranked. File:line references are into the committed files at `40d7a7f` (which equal the diff contents).

### Important

**B.1 · `web/components/kit/TrustChecklist.tsx:26-31` · the trust STATE is invisible to assistive tech.**
The glyph span is `aria-hidden="true"`, the colour classes carry the meaning visually, and `data-state` is not a semantic attribute. A screen-reader user hears `label detail` and cannot tell an `ok` item from a `refused` one unless Task 4's `detail` copy happens to say so — but the kit must not depend on caller copy for the one datum the component exists to convey. Solvent's law is "refusals render honestly"; here a refused check and a passing check read identically. (WCAG 1.3.1 / 1.4.1.)
Scenario: `{ id: "prices", label: "Prices", detail: "2 anchors", state: "refused" }` — the visual is a red `×`; the accessible tree says "Prices 2 anchors".
Fix: keep the glyph `aria-hidden` and add a text alternative: a `.srOnly` utility in `kit.module.css` (none exists in the repo — grep finds no `srOnly|sr-only|visually-hidden`) plus `<span className={styles.srOnly}>{STATE_WORD[item.state]}</span>` with `STATE_WORD = { ok: "ok", warn: "warning", refused: "refused", dim: "not available" }`; or, smaller, drop `aria-hidden` and put `aria-label={STATE_WORD[item.state]}` on the glyph span (`role="img"`). Also consider `aria-label` on the `<ul>` ("trust checklist") when a `testId` is present. The markup is the brief's own, so this is a finding against the design, not the transcription — but it belongs in the kit, and may be batched with Task 4 if the parent prefers.

### Minor

**B.2 · `web/components/kit/AddressField.tsx:44-58, 72-77, 88-92` · refusal and hint are not programmatically associated with the input.**
`role="alert"` on the conditionally mounted `<p>` is fine: current browser/SR pairs announce an element that enters the DOM already carrying `role="alert"` (implicit `aria-live="assertive"`), and `aria-invalid="true"` is set on the input. What is missing is `aria-describedby`: a user who tabs back to the field later hears "address to inspect, invalid entry" with no reason, and the visible hint "any 0x address" is never exposed at all. On the label question (see lens below) the hint does NOT enter the accessible name because `aria-label` on the input wins the name computation over the wrapping `<label>`'s content — acceptable, but it means the hint is simply lost to AT.
Fix: `const hintId = useId(), refusedId = useId();` give the `<small>` `id={hintId}` and the `<p>` `id={refusedId}`, and set `aria-describedby={refused ? \`${refusedId} ${hintId}\` : hintId}` on the input (`useId` is already used elsewhere: `app/lab/LabFrontier.tsx:192`).

**B.3 · `web/lib/recent-lookups.ts:32-44` · same-tab writes never notify `useRecentLookups`.**
`subscribe` listens only to `window` `storage`, which the platform fires in OTHER documents, never in the one that called `setItem`. So `rememberLookup(a)` followed by a re-render of a still-mounted `useRecentLookups` consumer in the same tab shows the new list only if something else re-renders it (React re-reads `getSnapshot` on every render, so it is a stale-until-touched, not a never-updates, bug). Inherited verbatim from the brief and from the existing `AddressEntry.tsx:37-42`, where it is harmless because `router.push` unmounts the entry page. It becomes visible the moment Task 3 mounts the field/recents somewhere that survives the navigation (a layout, or an in-page inspect without a route change).
Fix (in the store, no API change): a module-level `const listeners = new Set<() => void>()`; `subscribe` adds to the set AND registers the `storage` listener, cleanup removes both; `rememberLookup` calls `for (const l of listeners) l()` after a successful `setItem`.

**B.4 · `web/components/kit/AddressField.tsx:43` · `initial` is captured once.**
`useState(initial)` never re-syncs when the prop changes, so a consumer that stays mounted across `/inspect/A` → `/inspect/B` (layout-level placement, or a parent that does not remount per param) would show `A` while the page shows `B`. Correct for a field that "starts with" the address; note for Task 3: mount it with `key={address}` or place it inside the per-address page tree.

**B.5 · `web/components/kit/kit.module.css:130-148` · appended after the responsive section, not after `.kv*` as briefed; house comment style not followed.**
No cascade effect (the 900px block touches none of `.search*`/`.check*`, and the new 720px block only overrides its own classes). But: (a) the brief's anchor was line 120; (b) the file's convention is a `/* ---- name ---- */` header with a blank line before each section, and the responsive block was the terminal section; (c) the deviation is not in the report.
Fix: move lines 131-147 above line 122 under `/* ---- search + trust checklist (Inspector, plan 2) ---- */`, and either keep the 720px query beside them or fold it into the responsive section with a comment naming the narrower breakpoint (the brief uses 720, the file otherwise uses 900).

**B.6 · `web/lib/format.ts:107` · (observation, out of scope for this task) `isAddress` accepts an uppercase `0X` prefix.**
`ADDRESS_PATTERN = /^0[xX][0-9a-fA-F]{40}$/`, so `0XAB…` passes `AddressField` and reaches `onInspect` verbatim; the law text says `0x`. The lib is frozen for this task and the brief mandates `isAddress`, so no change here — raise with the plan owner whether `0X` is intended to be lawful (and whether the API accepts it).

**B.7 · process · the report does not say whether `python roadmap/tools/scope_gate.py` (brief Step 9) ran before the commit.**
The gate is a staged-index check, so it cannot be re-run meaningfully now that the commit exists. Ask the implementer to confirm, or record it in the ledger.

### Checked and clean (no finding)

- **`parseRecents` can never throw.** `raw === null` guard; `JSON.parse` (including a `RangeError` on an absurd payload) is inside a bare `catch`; `Array.isArray` and `typeof entry === "string"` guard `isAddress`, which is a regex `.test` on a string and cannot throw. `readRaw` and `rememberLookup` are also wrapped, so a `SecurityError`/`QuotaExceededError` from storage degrades to "no recents". The unit spec pins the non-JSON, non-array, non-string-member and `null` cases.
- **CSS specificity vs `.btn`/`.addr`.** Inspect/secondary are `.btn` (0,1,0) which out-specifies the global `button { font: inherit; color: inherit }` (0,0,1); `.btn` sets size/weight/colour and leaves family to inherit → body sans (the button is a sibling of `.searchIn`, so mono never reaches it). `.searchIn input` (0,1,1) beats the UA `input` rule, and `font: inherit` pulls mono from `.searchIn`. `.searchIn:focus-within` and `.searchInvalid:focus-within` tie at (0,2,0); the invalid one is later in source and wins — the compound selector on line 137 is exactly why. `.checkWarn/.checkRefused/.checkDim` tie `.checkI` at (0,1,0) and win by order. `.addr` (line 102) is unused by these components; no interaction.
- **`flex-wrap` + `flex-basis: 100%` at desktop widths.** `.search` wraps; `.searchIn` is `flex: 1; min-width: 320px`, the two buttons are auto-basis, and the refusal `<p>` at `flex-basis: 100%` cannot share a line with anything, so it always drops to its own full-width row under the toolbar with the 10px `gap` as the row gap. At ≥ ~600px the toolbar stays one line and the refusal is line two; at ≤ 720px the field goes full-width (line one), buttons line two, refusal line three. No `order`/`width` hacks needed; `margin: 0` removes the UA `<p>` margins so the row gap is the only spacing. Layout shift on refusal is intended.
- **Class concatenation** (`${styles.a} ${cond ? styles.b : ""}`) matches the existing kit house pattern (`SmallToggle.tsx:16`, `BandBars.tsx:51`, `StatusPill.tsx:21`).
- **Duplicated store.** `app/inspector/AddressEntry.tsx:14-57` still carries its own copy of the store; Task 1 was scoped to add the lib version only. Same key, shape and cap, so the two coexist without data split until the old one is retired.

---

## Verdicts

- **A. SPEC: ✅** — all interfaces, steps and global constraints met; the `FormEvent` deviation is justified (`@types/react` 19.2.18 deprecates the alias) and behaviour-identical; the CSS append position is a Minor, undocumented organisational deviation.
- **B. QUALITY: needs-fixes** — B.1 (trust state invisible to AT) is Important and small to fix; B.2-B.5 are Minor improvements, B.6 an out-of-scope observation, B.7 a process note.

---

## Re-review (248d670)

Scope: the fix round for findings #1, #2, #3, #5 only (`fix(web): kit review round …`, 4 files, +21/-3). Rulings on #4, #6, #7 are recorded in the ledger and are not re-opened here.
Verified against the working tree at HEAD `239336c`, which has zero `web/` drift from `248d670` (`git diff --stat 248d670 HEAD -- web/` empty; no uncommitted changes to the four files). Gates re-run by the reviewer from `web/`: `npx playwright test --project=unit` → 1065 passed (5.3 s, includes `recent-lookups.spec.ts`); `npm run lint:css`, `npm run typecheck`, `npm run lint` → clean, exit 0.

**RE-REVIEW: all-addressed.**

| # | Where | Verdict | Evidence and reasoning |
|---|---|---|---|
| 1 (Important) | `web/components/kit/TrustChecklist.tsx:13-14, 31`; `web/components/kit/kit.module.css:132` | ✅ addressed | `STATE_WORD` maps `ok/warn/refused/dim` → `passed / caution / failed / not available`; `<span className={styles.srOnly}>{STATE_WORD[item.state]}: </span>` precedes the label and the glyph stays `aria-hidden`, so the accessible reading order per item is "failed: Prices 2 anchors" — the state is now spoken as well as coloured. **`.srOnly` clip technique:** the canonical WAI/Bootstrap recipe (abspos 1×1, `padding: 0`, `margin: -1px`, `overflow: hidden`, `clip: rect(0 0 0 0)`, `white-space: nowrap`, `border: 0`). Inside the `display: flex` `<li>` an absolutely positioned child is out of flow and takes no `gap` slot, so the visual row is unchanged; no positioned ancestor is needed because the box is clipped to nothing and the −1px margin cannot widen the scroll area. `clip` is deprecated in favour of `clip-path: inset(50%)` but is supported by every engine the app targets; adding `clip-path: inset(50%)` alongside is optional hardening, not a defect. No `font-size` is declared, so stylelint has nothing to gate |
| 2 (Minor) | `web/components/kit/AddressField.tsx:4, 24-25, 55, 60-62, 73` | ✅ addressed | Two `useId()` values (hydration-stable in React 19.2, so SSR markup and first client render still agree). `<small id={hintId}>` is always rendered; `<p id={refusedId} role="alert">` is rendered while `refused`; the input's `aria-describedby` is `hintId` normally and the space-separated `` `${hintId} ${refusedId}` `` while refused — **id composition is correct**: every referenced id exists in the same render that references it, because the description string and the `<p>` both key off the same `refused` state. The hint is now exposed as a description while `aria-label` keeps supplying the name (unchanged). `role="alert"` plus description may be heard twice (announcement on mount, then on re-focus) — conventional and acceptable |
| 3 (Minor) | `web/lib/recent-lookups.ts:32-34, 36-43, 45-52` | ✅ addressed | Module-level `listeners = new Set<() => void>()`; `subscribe` adds the callback to the set AND to the `storage` event, and the cleanup removes both; `rememberLookup` now `return`s from the `catch` (no write → no notify) and otherwise calls every listener after a successful `setItem`. **SSR safety:** the `Set` is created at module evaluation on the server too, but touches no `window`/`localStorage`; `subscribe` is only ever invoked by React on the client; a server-side `rememberLookup` would land in the `catch` and return before notifying. No double notification in the writing tab (the platform fires `storage` only in other documents); `Set` iteration tolerates a listener deleting itself mid-loop; `useSyncExternalStore` re-reads `readRaw()` on the callback and compares the string snapshot, so an unchanged blob does not re-render |
| 5 (Minor) | `web/components/kit/kit.module.css:131` | ✅ addressed as ruled | The block now opens with the file's `/* ---- name ---- */` header (`inspector toolbar (.k-search) and trust checklist (.k-check) — plan 2`); the EOF position is kept by the coordinator's ruling — re-confirmed no cascade effect (the 900px block still names none of the new classes, and `.srOnly` is referenced only by `TrustChecklist`). Cosmetic nit, not open: the file's other section headers are preceded by a blank line, this one abuts the closing `}` of the 900px block (lines 130-131) |

Regressions: none observed. The four files changed only in the ways the coordinator described; `TrustChecklist` remains a server-compatible component (no hooks added); `AddressField`'s strict-address path (`trim` → `isAddress` → `onInspect`) and its testids are untouched; the `.k-search`/`.k-check` rules are byte-identical to the brief; every `font-size` in the file is still a bare `var(--type-*)` token.

Nothing open.
