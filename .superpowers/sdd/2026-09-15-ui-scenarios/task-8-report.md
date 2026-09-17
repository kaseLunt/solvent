# Task 8 report: `lab-reading` — the listing, the run records, the set record, the dispatchers

**Status:** DONE_WITH_CONCERNS (all gates green; two lint-driven code corrections, both explained below)
**Commit:** `1323510ac898494316feeb3fed90fd3b4c0f8998`
`feat(web): lab-reading - the listing, one run record per scenario, one set record; nothing dispatches on its own and nothing dispatches twice`
Files in the commit (exactly the two the brief names): `web/lib/lab-reading.ts` (124 lines), `web/tests/unit/lab-reading.spec.ts` (33 lines).

## What was done

1. Wrote the reducer pins `web/tests/unit/lab-reading.spec.ts` verbatim from the brief (three tests: `withRunning`/`canDispatch`, `withSettled`, `canDispatchSet`). Ran them before the module existed: `Error: Cannot find module '...web/lib/lab-reading'` — the expected failure.
2. Wrote `web/lib/lab-reading.ts` from the brief: `LabReading`, the pure `canDispatch` / `canDispatchSet` / `withRunning` / `withSettled`, and `useLabReading` (the committed listing behind an epoch, one `RunRecord` per id, one `SetRecord`, an `AbortController` per request keyed in one map, every controller aborted on unmount, no setState after abort, `describeLookupError` on the rejection arms).
3. Pins passed and typecheck was clean on the first transcription; eslint (eslint-plugin-react-hooks 7.1.1 via Next's presets) reported three errors in the hook. Corrected the code (never the pins) — see deviations.
4. Re-ran the pins, `npm run typecheck`, `npm run lint` — all clean. Staged by name, `python roadmap/tools/scope_gate.py` printed `scope-gate: OK -- integrator claude-integrator; 2 path(s)`, committed by pathspec.

## Test command and output

```
cd web && npx playwright test --project=unit tests/unit/lab-reading.spec.ts
  3 passed (2.5s)
```

Gates: `npm run typecheck` exit 0; `npm run lint` (full `eslint .`) exit 0.

## Deviations from the brief, with reasons

1. **`react-hooks/refs` — both render-time ref assignments moved into a `useEffect` with no deps.** Lint flagged `runsRef.current = runs` and `setRef.current = set` with `Cannot update ref during render` (react-hooks 7.1.1 compiler rules are in Next's recommended preset). Per the brief's own note, both assignments now live in one dependency-less `useEffect`, so the refs follow every commit. The dispatchers (`run`, `runSet`) still read `runsRef.current` / `setRef.current` — those reads are in event callbacks, which the rule permits. A comment states the law (refs follow every commit so a stale closure can never let a second ask through).
2. **`react-hooks/set-state-in-effect` — `setListing({ phase: "loading" })` moved out of the listing effect into `reloadListing`.** Lint flagged the synchronous setState in the effect body. The initial state is already `loading`, so the effect only needed the reset on a reload; `reloadListing` now does `setListing({ phase: "loading" })` and `setEpoch(e => e + 1)` in one batch. Observable behavior is identical: the listing reads `loading` from the reload ask until the fetch settles, and the epoch effect's cleanup still aborts the superseded request. A comment states the law (a reload reads as loading from the ask itself; the epoch bump is what refetches).
3. **No line-1 path comment on either file.** The brief's listings open with `// web/lib/lab-reading.ts` / `// web/tests/unit/lab-reading.spec.ts`; the binding rules forbid a line-1 path comment, and the sibling spec `lab-library.spec.ts` opens with its law comment. Both files open with the brief's law comment instead.

Nothing else was changed; every type, import, name, key (`"__set__"`), and the rejection-arm mapping to `{ kind: "unreachable", message: describeLookupError(cause) }` are as the brief wrote them.

## Concerns

- **Synchronous double-dispatch window (pre-existing in the brief's shape, not introduced here).** `run(id)` called twice within the same synchronous tick, before React commits, reads the same `runsRef.current` and would dispatch twice. The brief's render-time assignment had the identical window (no render has happened either). Two separate clicks are safe: React flushes a discrete event's updates and their passive effects before the next discrete event, so the ref is current by the second click. If Task 12's surface ever drives `run` from an effect and a click in one tick, `controllers.current.has(id)` is the synchronous guard that would close it; not acted on, outside this brief.
- **`"__set__"` shares the controllers map with scenario ids.** The wire's id pattern `^[a-z0-9_]{1,64}$` admits `__set__` as a scenario id; a committed scenario by that name would share a controller slot with the set run. Not realistic for the committed set; noted for the record.
- **The hook has no unit pin, by the brief's design.** Its one-POST-per-click law is proven by the e2e contract in Task 12; here its gates were typecheck and lint only.
- Git printed the repo's usual `LF will be replaced by CRLF` warning for the new spec; cosmetic.
