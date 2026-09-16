# Task 1 report — kit: AddressField, TrustChecklist, Sparkline re-export, `.k-search`/`.k-check` CSS; recent-lookups store

Status: DONE. Commit 40d7a7f (base 6f13580). Built by the integrator (visual task, spec §9.2).

## What was done
- `web/components/kit/kit.module.css`: appended the `.search*` and `.check*` rules — the mockup's `.k-search` (pages-console.html:122-124) and `.k-check` (:115-119) with tokens substituted (`--bg`, `--line`, `--mono`, `--sans`, `--type-mono`, `--type-small`, `--type-body`, `--ok-text`, `--warn-text`, `--crit-text`, `--crit`, `--accent`, `--chip-bg`, `--ink*`), plus a ≤720px wrap rule.
- `web/components/kit/AddressField.tsx`: strict entry (`isAddress`), Inspect primary button, optional ghost secondary link, inline refusal (`role="alert"`, `${testId}-refused`), sub-testids `-input`, `-inspect`, `-secondary`. Exports `ADDRESS_REFUSED_COPY`.
- `web/components/kit/TrustChecklist.tsx`: `.k-check` list; `TrustCheckItem { id, label, detail, state, title? }`; items carry `data-testid="${testId}-${id}"` and `data-state`.
- `web/components/kit/index.ts`: exports `AddressField`, `ADDRESS_REFUSED_COPY`, `TrustChecklist`, `TrustCheckItem`, and re-exports `Sparkline`/`SparklineProps` from `../charts/Sparkline`.
- `web/lib/recent-lookups.ts`: `parseRecents`, `pushRecent`, `rememberLookup`, `useRecentLookups` (`useSyncExternalStore`, SSR snapshot `"[]"`), `RECENT_KEY`, `RECENT_MAX`.
- `web/tests/unit/recent-lookups.spec.ts`: 2 pins (parse filtering; push dedupe/front/cap).

## Verification
- `npx playwright test --project=unit tests/unit/recent-lookups.spec.ts` → 2 passed (2.7s).
- `npm run typecheck`, `npm run lint`, `npm run lint:css` → clean.
- `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 6 path(s)` before the commit.

## Fix round 1 (after task-1-review.md)
- TrustChecklist: a visually-hidden state word (`passed` / `caution` / `failed` / `not available`) precedes the label; the glyph stays `aria-hidden`. New kit class `.srOnly`.
- AddressField: `useId` ids on the hint and the refusal; the input carries `aria-describedby` (hint, plus the refusal while shown).
- recent-lookups: `rememberLookup` notifies a module-level listener set as well as relying on the cross-tab `storage` event, so a still-mounted list updates in the writing tab.
- kit.module.css: the appended block now opens with the file's `/* ---- … ---- */` section header; position at EOF kept (no cascade effect).
- Not changed (rulings in the ledger): `initial` never re-syncs — the surface is mounted `key={addr}`; `0X` prefix accepted by the frozen `ADDRESS_PATTERN` — Plan 4 carry-forward.

## Deviation from the brief
- The brief typed the submit handler `(event: FormEvent<HTMLFormElement>)`. The installed React types mark the bare `FormEvent` alias deprecated (TS 6385), so the handler is inline on `<form onSubmit={(event) => { event.preventDefault(); submit(); }}>` and `submit()` takes no argument. Behavior is identical; no `FormEvent` import.

## Concerns
- None. `autoFocus` was deliberately not added (a11y lint).
