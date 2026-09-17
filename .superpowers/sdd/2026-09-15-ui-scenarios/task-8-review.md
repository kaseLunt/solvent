# Task 8 review: `lab-reading` — 409d4c8..1323510

### Spec Compliance

- ✅ Exactly the two files the brief names; no existing `web/lib/**` file touched (diff header: `web/lib/lab-reading.ts` +124, `web/tests/unit/lab-reading.spec.ts` +33, nothing else).
- ✅ `LabReading` interface as specified — `listing: Phase<ScenariosResponse>`, `runs: ReadonlyMap<string, RunRecord>`, `set: SetRecord | null`, `run(id)`, `runSet(ids)`, `reloadListing()` (`web/lib/lab-reading.ts:15-22`).
- ✅ `canDispatch` (`:24`) and `canDispatchSet` (`:25`) verbatim from the brief; an absent id dispatches (`undefined?.phase !== "running"` is `true`).
- ✅ `withRunning` (`:27-31`) and `withSettled` (`:33-37`) copy the map and never mutate the input — the pin `expect(empty.size).toBe(0)` (spec `:11`) would catch a mutation.
- ✅ Record shapes match `lab-library.ts` `RunRecord`/`SetRecord` (`{phase:"running", startedAt}` / `{phase:"settled", outcome, at}`; set adds `ids`) — checked against `web/lib/lab-library.ts:23-29`.
- ✅ Pins verbatim (spec `:7-33`) — the only textual difference from the brief's listing is the dropped line-1 path comment, which the binding rules forbid; the sibling `lab-library.spec.ts` follows the same convention. Every pin can fail (mutation of the input map, loss of the untouched record, the never-running settlement, the set's three states).
- ✅ Listing effect keyed by `epoch` with an `AbortController`, both arms guarded by `!controller.signal.aborted`, cleanup aborts (`:54-69`) — line-for-line the house `useKeyedFetch` shape (`web/lib/address-lookup.ts:45-62`).
- ✅ `run` guarded by `canDispatch(runsRef.current, id)` (`:80`), records running (`:83`), settles into its own record (`:88`), rejection → `{kind:"unreachable", message: describeLookupError(cause)}` (`:93`); `runSet` mirrors it with `canDispatchSet(setRef.current)` (`:99-113`). `runBookScenario` is `async` so its id-shape `throw` (`web/lib/runbook.ts:117-122`) is a rejection the second arm catches; `runBookSet` never rejects (`runbookSet.ts:223-247`, `refused-locally` arm). `scenarios(signal?: AbortSignal)` matches the call (`packages/client-ts/src/client.ts:549`).
- ✅ No `setState` after abort: every arm of every request checks its own controller before setting (`:60, :63, :86, :91, :106, :111`). An abort makes `runBookScenario` RESOLVE `unreachable` (it catches the fetch rejection, `runbook.ts:131-137`); the success arm's `aborted` check at `:86` drops that resolution, so an aborted run never writes a bogus "unreachable" record. Same for the set (`:106`).
- ✅ Unmount aborts every live controller and clears the map (`:71-77`); `live` is captured at mount so the cleanup does not read a ref that "may have changed" — the exhaustive-deps idiom.
- ✅ Deviation 1 (render-time ref mirrors → no-deps `useEffect`, `:44-51`) was forced: linting the brief's own hook text via stdin against the project's config reproduces `react-hooks/refs` at both assignments (eslint-plugin-react-hooks 7.1.1, rules `refs` and `set-state-in-effect` present in the installed plugin). The dispatchers read the refs only in event callbacks (`:80, :99`), which the rule permits.
- ✅ Deviation 2 (`setListing({phase:"loading"})` moved from the effect into `reloadListing`, `:119-122`) was forced by `react-hooks/set-state-in-effect` (same probe). Traced phases — on mount: initial `loading` → `ready`/`error`; on reload: `loading` + epoch bump in one batch → cleanup aborts the superseded fetch → new fetch → `ready`/`error`. Identical observable sequence to the brief's version; the moved version is tighter (no extra render on mount, no one-frame state of a bumped epoch beside a stale `ready`).
- ✅ Deviation 3 (no line-1 path comment): consistent with `lab-library.spec.ts` and the binding rules.
- ✅ `npx eslint lib/lab-reading.ts tests/unit/lab-reading.spec.ts` — exit 0 (ran it; the report's lint-clean claim holds).
- ✅ Comments state the law: header (`:1-4`), ref mirrors (`:44-45`), reload (`:118`).
- ⚠️ Cannot verify from diff: the hook's runtime behaviour under a real page (by the brief's design — Task 12's C6/one-POST pins are its proof). Judged by reading only.
- ⚠️ Cannot verify from diff: the 3-passed pin run and `npm run typecheck` (not re-run per instructions; the lint gate I did re-run is clean).

### Strengths

- The abort/settle discipline is exactly right and subtle in one place worth naming: because `runBookScenario` converts an `AbortError` into a resolved `unreachable` outcome rather than a rejection, a naive hook would record an aborted run as "unreachable". The `aborted` check on the SUCCESS arm (`:86`, `:106`) is what prevents that. The implementer either saw it or copied the house pattern faithfully enough to inherit it; either way the law holds.
- `withRunning`/`withSettled` are pure, copy-on-write, and typed to return `Map` while the interface exposes `ReadonlyMap` — the reducers are testable without React and the surface can never mutate the records.
- Functional `setRuns((prev) => ...)` updaters (`:83, :88, :93`) mean two settlements landing in the same batch (different ids) compose instead of clobbering — the identity law survives concurrent runs of different ids.
- Deviations were verified against the lint rules, kept to the minimum shape change, and each carries a comment stating why. The report's account of them is accurate.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **Concern 4 — pre-commit double-dispatch window. Ruling: deferred minor, not a defect of this task; recommend a two-line hardening at the next touch.** `canDispatch(runsRef.current, id)` (`:80`) reads a mirror that is updated in a passive effect (`:48-51`), so two `run(id)` calls that both land before the first's `setRuns` commits both pass. Reachability against the plan's dispatch surfaces: (a) two clicks — unreachable in React 19.2: a discrete event's updates flush synchronously and their passive effects flush before the next discrete event, so the mirror is current by the second click (this is Task 12's "second click while in flight is ignored" pin, `task-12-brief.md:198`); (b) a deep link that dispatches once from an effect — one call, no window; (c) deep link + a human click on the same row inside the ~1-2 scheduler tasks between the effect's `setRuns` (DefaultLane) and the mirror effect — reachable only by a click landing within milliseconds of the row painting, not from a single user action; (d) StrictMode dev double-invoke of a deep-link effect would double-POST (first aborted, no state written) — but the e2e contract runs against `next start` (`playwright.config.ts:6, :37`), so it never meets the pins, and `controllers.current.has(id)` would not close it anyway (the strict cleanup clears the map at `:75`). Consequence when the window IS hit: the first controller is overwritten at `:82` and never aborted on unmount, so its settle passes `:86` and calls `setRuns` after unmount (a no-op in React 18+) and the first result is replaced by the second. The header's law "a second ask is a no-op" (`:4`) is therefore true across commits, not within one. Recommended guard, cheap and conservative in both directions: `if (controllers.current.has(id) || !canDispatch(runsRef.current, id)) return;` at `:80`, and the set equivalent at `:99`. Fold into Task 12's landing if its harness ever drives a deep link and a click on the same id; otherwise leave.

2. **Concern 5 — `"__set__"` shares the controller map with scenario ids. Ruling: deferred minor.** The wire pattern `^[a-z0-9_]{1,64}$` (`runbook.ts:74`) admits `__set__`, so a served scenario by that name would share a slot at `:82`/`:101`: the later dispatch overwrites the earlier's controller, the earlier's settle deletes the later's entry (`:87`/`:107`), and on unmount the orphaned controller is not aborted — its settle then sets state on an unmounted hook. No double dispatch (the guards read separate refs), no replaced result (separate state slots). Reachable only if the committed set publishes a scenario literally named `__set__`. Fix: `const setController = useRef<AbortController | null>(null)`, aborted in the unmount cleanup beside the map. Also the sentinel is uncommented — a reader of `:101` has to infer why a string key lives among ids.

3. `(outcome: SetRunOutcome)` at `:105` is a redundant annotation (inferred from `runBookSet`'s return) whose only effect is to keep the `SetRunOutcome` import live; harmless, per the brief verbatim.

4. The unmount effect (`:71-77`) and the `controllers` ref (`:52`) carry no comment; every other block states its law.

### Assessment

**Task quality:** Approved

**Reasoning:** Every export, the pins, the abort discipline, and the two forced lint moves match the brief and the house pattern, with no observable behaviour change and no `setState` after abort. Both handed-down concerns are real but unreachable from a single user action or a deep link on the plan's surfaces (production build, discrete-event flushing), so they are deferred minors with named two-line fixes rather than defects of this task.
