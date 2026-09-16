# Task 8 report: `lookup-error` and the `useAddressLookup` hook

Status: DONE
Commit: `b0f4f6a192429abd17467276a84d74034e0b96ac` on `main`
Message: `feat(web): useAddressLookup - one address-keyed, resume-repaired seam for the lookup, history, stress, params and the evidence receipt`

## What was done

Followed the brief's TDD order for the pure module, then the hook.

1. **Step 1 – failing spec.** Wrote `web/tests/unit/lookup-error.spec.ts` with the brief's single test case verbatim (Error -> its message; string and number -> stringified).
2. **Step 2 – red.** `npx playwright test --project=unit tests/unit/lookup-error.spec.ts` failed as expected:
   `Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\lookup-error' imported from ...\web\tests\unit\lookup-error.spec.ts` / `No tests found.` (exit 1).
3. **Step 3 – `web/lib/lookup-error.ts`.** Moved `describeLookupError` out of `web/app/inspector/[addr]/InspectorSurface.tsx` byte-for-byte (I diffed the body against the old surface before writing; identical). The old surface's copy was deliberately left in place, per the parent's instruction — that file is rewritten by a later task, so the function is duplicated for now.
4. **Step 4 – `web/lib/address-lookup.ts`.** Written exactly as the brief specifies (`"use client"`, `Phase<T>`, `AddressReading`, `Keyed<T>` / `forAddress`, `useKeyedFetch`, `fetchCashParams`, `useAddressLookup`, `useAddressActivity`). Before writing I verified every import against the frozen modules and the generated wire schema:
   - `isAddress` (`./format`), `CASH = "debt_manager"` (`./inspector-position`), `receiptIdentity(servedAt, batchId)` (`./freshness`), `EvidenceManifest = components["schemas"]["EvidenceResponse"]` (`./evidence`), `getSolventClient` / `solventBaseUrl` (`./api`).
   - `fetchAddressHistory(baseUrl, addr, { limit, signal }) -> Promise<HistoryLookup>`, `fetchEvents(baseUrl, query, signal) -> Promise<EventsResponse>` (`events: ChainEvent[]`, `next_cursor: string | null`), `fetchParams(baseUrl, query, signal) -> Promise<ParamsResponse>` (`params: ParamChange[]`).
   - `useAnchoredAgeSeconds(receipt: AgeReceipt | null, onResume?: ResumeRepair)` where `AgeReceipt = { ageSeconds: number; receiptId: string }` and `ResumeRepair = () => Promise<boolean>`.
   - `SolventClient.address(addr, signal?)`, `.addressStress(addr, signal?)`, `.evidence(signal?) -> Promise<EvidenceResponse>` — `evidence` does take a signal, so the brief's fallback ("call it without one") was not needed.
   - `Lookup<T>` discriminates on `outcome` (`"found" | "not-found" | "unknowable"`) and carries `.response` with `served_at: string`, `batch.id: number`, `batch.age_seconds: number`, `positions[].engine: string`.
   - `useCursorPages<Row, C>(fetchPage)` — its `fetchPage` has a third `isCurrent` parameter; the brief's two-argument callback ignores it, which TypeScript accepts (fewer parameters are assignable).
5. **Step 5 – verify.** All three checks green (see below).
6. **Step 6 – commit.** Staged the three files by name, ran `python roadmap/tools/scope_gate.py`, committed pathspec-limited to those three files. No attribution / `Co-Authored-By` lines.

## Exact verification output

Unit spec (`web/`):

```
Running 1 test using 1 worker

  ✓  1 [unit] › tests\unit\lookup-error.spec.ts:5:1 › an Error is its message; a non-Error is stringified — an error is never turned into an answer (5ms)

  1 passed (2.3s)
```

Typecheck (`npm run typecheck`, which first rebuilds `@solvent/client` via `scripts/ensure-client.mjs`): `tsc --noEmit` exit 0, no output.

Lint (`npm run lint` -> `eslint .`): exit 0, no errors, no warnings.

Scope gate: `scope-gate: OK -- integrator claude-integrator; 3 path(s)`. Pre-commit control-plane doctor: `OK -- 0 error(s), 0 warning(s), 5 info` (the 5 infos are pre-existing REVIEW-DUE notices on unrelated roadmap objects).

## Lint rules considered and how they were satisfied

- `react-hooks/exhaustive-deps`: did **not** fire. `epoch` is a `useState` value and therefore a legitimate dependency of both `useEffect`s; the rule only flags "unnecessary" deps on `useCallback`/`useMemo`, not on `useEffect`. The brief's contingency (`// eslint-disable-next-line ... -- epoch re-runs the fetch on reload()`) was therefore **not** added — no disable comments exist in either new file.
- `react-hooks/set-state-in-effect`: did **not** fire. No effect calls `setState` synchronously at its top; every `setResult` / `setLookupResult` / `setEvidence` happens inside a promise continuation, and the "loading" phase is derived render-synchronously from the `{ for: addr, state }` keying via `forAddress`. The keying shape from the brief was kept unchanged.
- `@typescript-eslint/no-floating-promises` (Next's typescript preset): the effect's `loadLookup()` call is `void`-prefixed as in the brief; the other promise chains end in `.then(onFulfilled, onRejected)` and are handled.
- `@typescript-eslint/restrict-template-expressions`: `describeLookupError` already wraps numbers in `String(...)`, carried over verbatim.

## Deviations from the brief

- **None in code.** Both source files and the spec match the brief's listings exactly (plus the spec's leading path comment, which the brief's listing also carries).
- Line reference drift only: at HEAD, `describeLookupError` sits at lines 60–75 of `InspectorSurface.tsx`, not 55–70 as the brief says (earlier tasks shifted the imports). The body is identical.
- `git add` printed `LF will be replaced by CRLF the next time Git touches it` for the three new files — the repo's autocrlf setting, informational only, not acted on.

## Files

- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\lookup-error.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\address-lookup.ts` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\lookup-error.spec.ts` (new)

No other file was touched. `.superpowers/sdd/.gitignore` was not modified by this task. The hook module compiles but is not yet imported anywhere, as the brief expects (Task 12 exercises it end-to-end).

---

# Fix round 1

Status: DONE
Commit: `89cf19cd2e762f6bd395cb75c04ffc5d36e5122d` on `main` (one file, +18/-3)
Message: `fix(web): address lookup review round - a failed receipt refresh is stated, a resume repair rides an in-flight load instead of aborting it, no book-level fetch on an invalid address`

Review: `task-8-review.md` (spec OK, quality needs-fixes). The coordinator's two items cover review findings 1, 2 and 5. Findings 3 (`params` stays `loading` for a non-Cash address), 4 (`useAddressActivity` relies on `key={addr}`) and 6 are accepted by ruling / ledgered for later tasks; nothing was changed for them.

## Changes (all in `web/lib/address-lookup.ts`; `Phase`, `AddressReading` and both hook signatures unchanged)

1. **Evidence effect** (review findings 1 and 5).
   - The rejection arm now writes `if (!controller.signal.aborted) setEvidence(null);` — a `reload()` whose receipt fetch fails no longer leaves the previous manifest standing as current; the Trust item reads "receipt unavailable".
   - `if (!valid) return;` at the top: no book-level fetch on the invalid-address page. `valid` added to the dependency array (`[epoch, valid]`).
   - The comment above the effect now states both behaviours.
2. **Resume repair rides an in-flight load** (review finding 2).
   - New `inFlightRef = useRef<Promise<boolean> | null>(null)`.
   - `loadLookup` stores the promise it returns on the ref, and clears it in a `.finally` only if the ref still holds that same promise (a superseded request must not erase its successor).
   - When called with `keepOnFailure: true` while `inFlightRef.current !== null`, it returns the in-flight promise instead of aborting and re-issuing — the in-flight load's own outcome (`true` when it lands, `false` on its own failure or abort) is the repair's answer.
   - A foreground call (`keepOnFailure` false/absent) keeps the prior behaviour: abort what is in flight and start fresh.
3. No other change.

## Verification (from `web/`)

- `npx playwright test --project=unit tests/unit/lookup-error.spec.ts` -> `1 passed (2.2s)`
- `npm run typecheck` -> `tsc --noEmit` exit 0
- `npm run lint` -> `eslint .` exit 0, no warnings
- `grep -n "eslint-disable" lib/address-lookup.ts` -> none. `react-hooks/set-state-in-effect` did not object: the new `setEvidence(null)` is inside a promise continuation, and the `if (!valid) return;` gate is a plain early return with no state write. `react-hooks/exhaustive-deps` did not object to `[epoch, valid]` (both are used / component state).
- Scope gate: `scope-gate: OK -- integrator claude-integrator; 1 path(s)`; pre-commit doctor `OK -- 0 error(s), 0 warning(s), 5 info` (same pre-existing REVIEW-DUE infos).

## Deviations

None from the coordinator's instructions. One implementation detail worth a reviewer's eye: the ride-the-in-flight path triggers on ANY in-flight request (foreground or an earlier repair), which is the coordinator's exact wording (`inFlightRef.current !== null`) and also collapses back-to-back repairs onto one request; the review's own phrasing said "foreground". The behaviour is a superset and does not abort anything a repair should not abort.
