# Task 8 review: `lookup-error` and the `useAddressLookup` hook

Reviewed: commit `b0f4f6a` (review package `review-01d28f5..b0f4f6a.diff`), against `task-8-brief.md` and `task-8-report.md`.
Reviewer ran (read-only, from `web/`): `npx playwright test --project=unit tests/unit/lookup-error.spec.ts` (1 passed), `npx eslint lib/address-lookup.ts lib/lookup-error.ts tests/unit/lookup-error.spec.ts` (clean, exit 0), Serena diagnostics on `lib/address-lookup.ts` (none).

Line numbers below are 1-based against the committed files. `address-lookup.ts` = `web/lib/address-lookup.ts`; `live-age.ts` = `web/lib/live-age.ts`; `pagination.ts` = `web/lib/pagination.ts`; `InspectorSurface.tsx` = `web/app/inspector/[addr]/InspectorSurface.tsx`.

---

## A. SPEC COMPLIANCE — ✅

| # | Brief requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Create exactly `web/lib/lookup-error.ts`, `web/lib/address-lookup.ts`, `web/tests/unit/lookup-error.spec.ts`; `web/lib/**` existing files untouched | ✅ | `git show --stat b0f4f6a`: 3 files, 203 insertions, 0 deletions, all new. `git diff b0f4f6a -- <3 files>` is empty: working tree == commit. |
| 2 | `describeLookupError(cause: unknown): string` moved **verbatim** from the old surface | ✅ | Mechanical check: `diff <(sed -n 60,75p InspectorSurface.tsx) <(sed -n 6,21p lookup-error.ts \| sed 's/^export function/function/')` → IDENTICAL. Report's "60–75 not 55–70" line-drift note is correct. Old copy left in place (still a private `function`, not exported) as the parent instructed. All four error classes are exported from `packages/client-ts/src/index.ts`. |
| 3 | `Phase<T>` — three arms, all `readonly` | ✅ | `address-lookup.ts:21-24`. |
| 4 | `AddressReading` — nine members, brief's types | ✅ | `address-lookup.ts:26-36`; `params: Phase<readonly ParamChange[]>`, `evidence: EvidenceManifest \| null`, `age: LiveAgeReading`, `reload: () => void`. |
| 5 | Address keying: every result stored `{ for: addr, state }`, read only when `for === addr` | ✅ | Writes: `:53`, `:56` (`useKeyedFetch`), `:89`, `:94` (`loadLookup`). Reads: `forAddress` `:41-43`, applied at `:63` and `:113`. `Keyed<T>` `:38`. |
| 6 | Resume law: age is THIS lookup's own, keyed by `receiptIdentity(served_at, batch.id)`, repaired via re-fetch of the same lookup; a failed background repair never replaces a rendered position; foreground failure stated in full | ✅ | `:142-147` (`useAnchoredAgeSeconds(..., repair)`), `:145` receipt id, `:141` `repair = loadLookup({ keepOnFailure: true })`, `:96-98` keep-on-failure only when `previous.for === addr && previous.state.phase === "ready"`, else `failure` written. Body is the old surface's `loadAddress` (InspectorSurface.tsx:126-163) with `status`→`phase` renamed. |
| 7 | Abort discipline: aborted request writes nothing; every effect returns a cleanup that aborts | ✅ | Abort gates: `:53`, `:56`, `:88`, `:93`, `:130`. Cleanups: `:59-61`, `:108-110`, `:136-138`. `loadLookup` also aborts its predecessor before dispatch `:80`. |
| 8 | Three-valued found: hook does not interpret `outcome` except to gate params on a found Cash position | ✅ | Only `outcome` read is `:115` (`ready.outcome === "found" && positions.some(p => p.engine === CASH)`), feeding `:121`. Age anchors on every outcome (`:143-145`) — every `Lookup` arm carries `response` (`packages/client-ts/src/lookup.ts:82-117`), matching the old surface. |
| 9 | `useAddressActivity(addr, valid): CursorPages<ChainEvent>` | ✅ | `:156-173`; two-arg `fetchPage` assignable to `useCursorPages`' three-arg signature (`pagination.ts:33-47`). |
| 10 | Consumes the listed modules; `SolventClient.evidence` signal fallback | ✅ | Imports `:9-19` match the brief's list. `evidence(signal?: AbortSignal)` exists (`packages/client-ts/src/client.ts:588`) so no fallback needed; `fetchParams`/`fetchEvents` forward `signal` (`web/lib/inspector-data.ts:121-136`, `:90-113`); `fetchAddressHistory` via `options.signal` (`:68-77`). |
| 11 | Step 1 spec verbatim; red then green | ✅ | `tests/unit/lookup-error.spec.ts:5-9` matches the brief. Report shows the module-not-found red; reviewer re-ran: `1 passed`. |
| 12 | Lint: `exhaustive-deps` and `set-state-in-effect` on, no disables | ✅ verified by reading and running | `eslint-plugin-react-hooks` 7.1.1; `eslint --print-config lib/address-lookup.ts` resolves `react-hooks/set-state-in-effect: [2]`, `exhaustive-deps: [1]`, `refs: [2]`, `purity: [2]`, etc. No `eslint-disable` string anywhere in the two new files. Reviewer's targeted eslint run: clean. Report's reasoning about `epoch` (a component-scope state value is a permitted extra `useEffect` dep) is correct. |
| 13 | Commit message, scope gate, pathspec-limited add | ✅ | Message matches Step 6 verbatim; `git status` shows the many unrelated dirty files were not swept in. |

Spec verdict: **✅**. The three files are the brief's listings, byte-for-byte where the brief gave code.

---

## B. CODE QUALITY — needs-fixes (one Important, brief-inherited; the rest Minor)

### Important

**1. Evidence keeps a stale manifest after a failed `reload()`** — `address-lookup.ts:132-134`

Failure scenario: mount → evidence manifest M1 lands (`:130`) → user calls `reload()` → `epoch` bumps → the evidence effect re-runs (`:139`), aborting nothing in flight and dispatching a new request → that request fails (500, network, 503) → the rejection handler is an empty block → `evidence` remains M1 and the Trust card renders M1 as the current receipt.

Every sibling on the same reload path behaves differently: `useKeyedFetch` replaces a ready value with the error (`:55-56`), and the lookup effect's `loadLookup()` is foreground (`:107`, no `keepOnFailure`) so its failure is stated in full (`:96-98`). Evidence is the only field in this hook where a failed foreground refresh is silently masked by the previous answer. The brief's own interface comment (`AddressReading.evidence`: "null until it arrives **or if it fails**") describes the intended contract; the brief's code satisfies it only on first load, where the state is never set. This is a brief-internal contradiction the implementer reproduced without surfacing (report: "Deviations from the brief: None in code").

Fix (one line, keeps `set-state-in-effect` quiet because the write is inside a promise continuation):
```ts
() => {
  // A failed refresh is not the previous receipt: the Trust item reads "receipt unavailable".
  if (!controller.signal.aborted) setEvidence(null);
},
```

### Minor

**2. A background repair can supersede a foreground `reload()`, and the reload's outcome is then never stated** — `address-lookup.ts:80` with `live-age.ts:309` and `web/lib/freshness.ts:584`

`loadLookup` unconditionally aborts whatever is in flight (`:80`), whether the caller is the foreground effect or the resume repair. Scenario: blind resume → repair R1 in flight → user clicks reload → F1 aborts R1 → R1 resolves `false` → `live-age.ts:309` arms a retry at +5 s (`RESUME_RETRY_DELAYS_MS = [5_000, 15_000]`) → network is slow (the very condition under which repairs fire), F1 still in flight at +5 s → R2 = `loadLookup({ keepOnFailure: true })` aborts F1 → F1 resolves `false` into `void` (`:107`) → R2 fails → `keepOnFailure` keeps the old position (`:97`). Net: the user asked for a reload and got neither new data nor an error. The kept position is still true as-of-its-batch and the age keeps climbing, so nothing false is on screen — this is an unacknowledged action, not wrong data. The `loadAddress` body is inherited from the old surface, but the old surface had no `reload()`, so the race is new to this seam.

Fix option: hold the in-flight foreground promise in a ref; a `keepOnFailure` call while a foreground request is in flight returns that promise (`true` if it lands, `false` if it fails) instead of aborting it. The age hook's contract ("`true` only when a lookup was applied", `live-age.ts:305-311`) is preserved. Or accept and record the race.

**3. `reload()` has no in-flight signal, and `Phase<T>` has no "idle / not applicable" arm** — `address-lookup.ts:21-24`, `:63`, `:121`

(a) During a reload every field keeps its previous value with no flag; a consumer can render neither "refreshing" nor distinguish a swallowed reload (finding 2) from one in progress. (b) `params` for an address without a Cash position is `LOADING` forever (`:63` returns `LOADING` when `!enabled`). "Not applicable" is spelled as "loading". A consumer that spins on `params.phase === "loading"` spins forever unless it re-derives the Cash gate from `lookup` itself. Brief-specified API, so not a defect of this commit — but a ledger item for the Task 9/10 reviewers: the position/trust cards must gate params rendering on the Cash engine's presence, never on `params.phase` alone. If the integrator wants the seam to carry it: expose `hasCash` on `AddressReading`, or make `params: Phase<readonly ParamChange[]> | null`.

**4. `useAddressActivity` cannot survive an `addr` change inside one mount; the invariant lives only in a doc comment** — `address-lookup.ts:166-171`

`startedRef` never resets and `useCursorPages.reset()` is never called. Out-of-contract scenario (consumer forgets `key={addr}`): A→B → `fetchPage`/`loadMore` identity changes (`:157-165`) → effect re-runs → `startedRef.current === true` → returns → `pages.rows` and the cursor are still A's → B's head sits over A's activity forever and B is never loaded. The old surface guarded exactly this with `activityForRef` + `resetActivity()` + `scopedRows` (InspectorSurface.tsx:296-321, p1b-6 fix 5 and p1b-9 Codex finding 3); this seam regresses that to a comment. Severity stays Minor because the plan double-locks it: `<InspectorSurface key={addr} …>` (`docs/plans/2026-09-15-ui-inspector.md:3557`) and `<ActivityTable key={addr} addr={addr} …>` (`:3700`). **Ledger note for the Task 11 reviewer: verify both `key={addr}` mounts land.**

Cheap self-protection if wanted:
```ts
const startedForRef = useRef<string | null>(null);
useEffect(() => {
  if (startedForRef.current === addr) return;
  startedForRef.current = addr;
  reset();
  if (valid) loadMore();
}, [addr, valid, loadMore, reset]);
```
(and `scopedRows` on the way out, as the old surface did).

StrictMode check (as asked): dev double-invocation runs the effect body twice with refs persisting; the second pass sees `startedRef.current === true` and skips. Even without `startedRef`, `useCursorPages.loadMore` returns early while a page is in flight (`pagination.ts:61`), so there is no double first page either way. Under the `key={addr}` contract `[valid, loadMore]` never change within a mount, so `startedRef` is load-bearing only in the out-of-contract case — where it does the wrong thing. Not a bug in-contract.

**5. The book-level evidence fetch runs on the refusal page** — `address-lookup.ts:124-139`

The effect has no `valid` gate, so an invalid-address render (and each `reload()` on it) makes a round-trip the refusal page never renders. Fix: `if (!valid) return;` at the top of the effect (no state write, so `set-state-in-effect` is unaffected). Or leave it: cheap and book-level.

**6. Stale same-address value shown across an `enabled` gap in `useKeyedFetch`** — `address-lookup.ts:63` (verified acceptable; recorded because it was asked)

Sequence (params): found+Cash → params ready P1 → `reload()` → lookup lands not-found → `hasCash` false → `params` reads `LOADING` while P1 is retained in state → `reload()` → found+Cash → `params` reads P1 again until the new fetch lands. No cross-address leak (`forAddress` blocks on `for`), `fetchCashParams` is book-level so P1 is not address-specific, and it is the same keep-until-replaced semantic `lookupResult` uses on reload. Keying `Keyed<T>` by `epoch` would put a spinner over the number on reload, which the R4 law forbids for the resume path — leave as is.

**7. Report: "Deviations from the brief: None in code" hides the brief-internal contradiction in finding 1** — process, not code. The implementer verified imports against frozen modules carefully (good) but did not read the listing against the interface comment two screens above it.

---

## Probes the parent asked for — verified OK

- **`fetcher` identity per address.** `fetchHistory`/`fetchStress` are `useCallback(..., [addr])` (`:117-118`) → new identity per address → `useKeyedFetch` deps `:62` fire → cleanup aborts the old controller (`:59-61`) → old handlers are gated on their own closure's `controller.signal.aborted` (`:53`, `:56`) → no write after abort. Even a leaked write would be `{ for: oldAddr }` and filtered at `:42`. Double lock holds.
- **`reload()` re-runs all five fetches.** `epoch` is in every effect's deps: `:62` (history, stress, params), `:111` (lookup), `:139` (evidence).
- **`controllerRef` ordering on reload.** React runs the previous effect's cleanup (`:109` abort) before the next body (`:107` → `:80` no-op abort → `:81-82` new controller). Cleanup reads `controllerRef.current` at cleanup time, so a repair dispatched after the effect is also aborted on unmount/address change — correct.
- **Superseded repair resolves `false`.** `live-age.ts:309` schedules a retry on anything but `true`. On the common path the superseder lands a new `receiptId` (a fresh `served_at`), the age effect tears down on its `[wireAgeSeconds, receiptId]` deps, `cancelled = true`, and `current(run)` makes the retry inert. `false` is the right signal: the age hook's contract is "`true` only when a lookup was applied" and a superseded request applied nothing. Edge: an identical receipt after supersession costs one bounded retry (5 s, then 15 s). Fine.
- **Age on every outcome.** All three `Lookup` arms carry `response: RefinedBody<Omit<T,"found">>` (`lookup.ts:82-117`) so `batch.age_seconds`, `served_at`, `batch.id` exist for not-found/unknowable too; the old surface anchored the same way.
- **`hasCash` narrowing.** `ready !== null && ready.outcome === "found" && ready.response.positions.some(...)` narrows through the `&&` chain to the found arm; `tsc`, eslint and the LSP are clean.
- **`LOADING` shared identity.** `as const` → `{ readonly phase: "loading" }`, assignable to `Phase<T>` for every `T`; never mutated; a stable reference is a benefit for consumer memo deps. Not `Object.freeze`d at runtime — irrelevant under strict TS.
- **`"use client"` in `lib/`.** Precedent: `live-age.ts`, `pagination.ts`, `useMeasuredWidth.ts`.
- **Synchronous throws inside effects.** All fetchers are `async` (or return the client's async method) so `fetcher(signal).then(...)` at `:51` never throws synchronously.
- **`set-state-in-effect` and `useAddressActivity`.** `loadMore()` (`:170`) synchronously calls `setLoading(true)`/`setError(null)` inside `useCursorPages` (`pagination.ts:64-65`); the rule cannot see through the opaque callback, so it passes. It is one extra render on mount, inherited from the frozen pagination module. Not a finding.

---

## Verdicts

- **SPEC: ✅**
- **QUALITY: needs-fixes** — finding 1 is the only blocker and is a one-line change; it is inherited from the brief's listing, so the integrator may instead rule it "by design" and amend the `AddressReading.evidence` comment to say what the code does. Findings 2–7 are Minor: 2 and 5 are cheap to fix here; 3 and 4 are ledger notes for the Task 9/10/11 reviewers; 6 is verified acceptable; 7 is process.

---

## Re-review (89cf19c)

Scope: the two changes in commit `89cf19c` (`web/lib/address-lookup.ts`, +18/-3), against the coordinator's rulings. Working tree == commit (`git diff --stat 89cf19c -- web/lib/address-lookup.ts` empty). Line numbers are 1-based against the committed file.

Reviewer ran: `npx eslint --max-warnings 0 lib/address-lookup.ts` → exit 0 (zero errors, zero warnings, with `react-hooks/set-state-in-effect`, `refs`, `exhaustive-deps` active on plugin 7.1.1); `grep eslint-disable` → none; Serena/tsserver diagnostics on the file → none.

### Finding 1 + 5 — evidence effect (`:134-154`)

- `:139` `if (!valid) return;` — a plain early return before any work; no state write, so `set-state-in-effect` has nothing to object to. Verified by running, not by the report.
- `:148` `if (!controller.signal.aborted) setEvidence(null);` — inside the rejection continuation, abort-gated like the fulfilment arm (`:145`). A `reload()` whose evidence fetch fails now clears the manifest; an aborted fetch (unmount, address change, a second `reload()`) still writes nothing. On first load a failure sets `null` over `null` (React bails out; no extra render).
- `:154` deps `[epoch, valid]` — `valid` is referenced in the body, so this is the exhaustive set, not an extra.
- The comment `:135-137` now states what the code does; the brief-internal contradiction is gone.

**Closed.**

### Finding 2 — a repair rides an in-flight load (`:75-76`, `:82-84`, `:107-112`)

Probes the coordinator named:

1. **`inFlightRef` is cleared only by the promise it belongs to.** `:110` compares by identity (`inFlightRef.current === request`). Sequence checked: F1 dispatched (ref = F1) → foreground F2 aborts F1 and sets ref = F2 (`:85-87`, `:107`) → F1's rejection arm returns `false` (`:98`) → F1's `.finally` runs, sees ref === F2, leaves it → F2 settles → its own `.finally` clears. A superseded load cannot erase its successor. The `.finally` is registered after the ref assignment in the same synchronous body (`:107` then `:108`), so it cannot run before the ref holds it. `request` is the `.then(onOk, onErr)` promise whose two arms only return booleans, so it never rejects and the `void`-discarded `.finally` chain never produces an unhandled rejection.

2. **A repair riding a foreground load resolves with that load's result.** `:84` returns the very same promise object, so the repair receives `true` when that load lands and applies a receipt, `false` when it fails or is aborted. Downstream in `live-age.ts:305-311` those are the right signals: `true` → the new receipt tears the age effect down; `false` from a foreground failure → `ready` is `null`, the receipt is `null`, the age effect tears down, the scheduled retry is inert via `current(run)`; `false` from an abort (a second `reload()` superseded the ridden load) → one bounded retry in 5 s that rides or dispatches afresh — correct, nothing was applied.

3. **The exact race from finding 2 is closed.** R1 (repair) in flight → user `reload()` → F1 aborts R1 (foreground path still aborts, `:85`) → R1 resolves `false` → retry armed at +5 s → at +5 s, F1 still in flight → `loadLookup({ keepOnFailure: true })` now returns F1 (`:84`) instead of aborting it → F1's own outcome is stated in full (`:101-103`, `keepOnFailure` is F1's own `false`). The user's reload can no longer be swallowed by the repair chain.

4. **The accepted superset** (any in-flight request, including an earlier repair). Back-to-back repairs collapse onto one promise; `useAnchoredAgeSeconds` already guards multiple chains with `generation`/`current(run)`, so a shared result feeds only the live chain. No request that a repair should not abort is aborted.

5. **Microtask window.** Between `request` settling and its `.finally` clearing the ref, a repair could in principle ride an already-settled promise. Repairs are fired from lifecycle event handlers and `setTimeout` (macrotasks); the `.finally` reaction is a microtask queued at settlement, so the window is not observable from any caller. Not an issue.

6. **Address change / unmount.** The refs are component-level and outlive `loadLookup`'s identity. On A→B inside one mount the effect cleanup aborts F_A and the new effect body synchronously replaces the ref with F_B before F_A's settlement microtask runs; F_A's `.finally` then sees F_B and leaves it. A repair for B cannot fire before B has a receipt, which requires F_B to have landed. On unmount the aborted request settles `false`, writes nothing (`:93`, `:98`), and clears or leaves the ref harmlessly.

7. **Lint.** `inFlightRef.current` is read and written only inside the `useCallback` body and the `.finally` continuation, never during render, so `react-hooks/refs` is satisfied; `void request.finally(...)` satisfies `no-floating-promises`. Verified clean with `--max-warnings 0`.

**Closed.**

### Out of scope, for the record (pre-existing, not introduced here)

A successful repair that returns an identical `receiptIdentity` (same `served_at` and `batch.id`) resolves `true`, so the retry chain stops, but the `blind` marker in `live-age.ts` is discharged only by a receipt-id mismatch, so `unresolved` would persist. `served_at` is per-response, so in practice a fresh response re-anchors. The old surface's `loadAddress` had the same shape. Not opened.

### Verdict

**RE-REVIEW: all-addressed.** Findings 1, 2 and 5 are closed by `89cf19c`; findings 3, 4, 6 and 7 stand as ruled no-change and ledgered (consumers gate `params` on the Cash position; the `key={addr}` double lock is Task 11's reviewer's item).
