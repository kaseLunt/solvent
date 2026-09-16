# Task 7 report: `useCashBook`

**Status:** DONE
**Commit:** `a46f7d0` — `feat(web): useCashBook - /v1/book plus the full Cash positions walk, least room first, 409 restart`
**File:** `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\cash-book.tsx` (new, 213 lines; the only path in the commit)

## What was implemented

`web/lib/cash-book.tsx`, a `"use client"` module exporting exactly the brief's surface:

- `type BookResponse`, `BookEngine`, `BadDebtEngine`, `HistogramEngine` (indexed off `components["schemas"]["BookResponse"]`)
- `type CashBookPhase`, `interface CashBookReading`
- `function useCashBook(): CashBookReading`

Behavior, per the brief:

- `loadBook` is the BookSurface abort/supersession pattern copied verbatim (not imported): a fresh `AbortController` per request, the prior one aborted; both promise arms drop out on `controller.signal.aborted`; `UnavailableError` maps to `no-batch` with the server's message and `retryAfterSeconds`; anything else maps to `error`; `keepOnFailure` keeps a rendered `ok` book on a failed background re-fetch; resolves `true` only when a book was applied (this is what `useAnchoredAgeSeconds` uses to drive its bounded retry).
- The walk effect is keyed on `book.batch.id`; it walks `/v1/positions` for `debt_manager` with `sort: "headroom", dir: "asc", limit: 1000`, following `next_cursor` until null, mapping rows through `readCashRow`. A 409 `BatchSupersededError` reloads the book at most once per `currentBatchId` (`restartedForRef`); a repeat for the same id, and every other failure, is recorded through `classifyPositionsFailure` without discarding rows already landed.
- Derived reads gate on `walk.forBatch === batchId`, so rows/completion/failure from an older batch's walk are never presented against the current book.
- `age` comes from `useAnchoredAgeSeconds` keyed on `receiptIdentity(served_at, batch.id)`, with `loadBook({ keepOnFailure: true })` as the resume repair.

## Deviations from the brief's code (each with evidence)

### 1. `cause.currentBatchId` instead of `cause.body.current_batch_id ?? null`

Supplied fact, confirmed by `find_symbol BatchSupersededError` in `packages/client-ts/src/errors.ts:185-201`: the class exposes `readonly cursorBatchId: number` and `readonly currentBatchId: number | null` and has no `body`. The restart key is `cause.currentBatchId`. Semantics are unchanged from the brief: a `null` superseding id (the documented race where no batch is servable) compares equal to the ref's initial `null`, so it does not trigger a restart and falls through to the walk-failure path, exactly as the brief's `?? null` would have.

### 2. Dropped `as unknown as CashWireRow[]` and the `CashWireRow` import

The brief said to drop the cast if the types line up. They do, exactly:

- `packages/client-ts/src/refine.ts:169-171`: `interface RefinedPositionSummary extends Omit<PositionSummary, "liquidatable"> { liquidation_verdict: LiquidationVerdict }`, with `LiquidationVerdict = "liquidatable" | "not-liquidatable" | "unknowable"` (line 64).
- `web/lib/cash-rows.ts:9-11`: `type CashWireRow = Omit<Schemas["PositionSummary"], "liquidatable"> & { liquidation_verdict: Verdict }`, with the same three-member `Verdict` (line 6).
- `web/lib/positions.ts:27`: `PositionsResponse = RefinedPositionsResponse`, whose `positions: RefinedPositionSummary[]`.

So `page.positions.map(readCashRow)` typechecks directly (`tsc --noEmit` exit 0 with the cast removed). Keeping the import would have failed `@typescript-eslint/no-unused-vars`; grep confirms `CashWireRow` occurs 0 times in the committed file.

### 3. No synchronous `setWalk(...)` reset at the top of the walk effect (lint-forced)

The Next 16 preset (`eslint-config-next/dist/index.js:168`) spreads `eslint-plugin-react-hooks@7.1.1`'s `configs.recommended.rules`, which includes `react-hooks/set-state-in-effect`. The brief's line `setWalk({ forBatch: batchId, rows: [], complete: false, failure: null });` directly in the effect body is rejected. Evidence, from linting a throwaway copy of the committed file with that one line re-inserted (file deleted afterwards, never staged):

```
lib/_probe-brief-sync-reset.tsx
  122:5  error  Error: Calling setState synchronously within an effect can trigger cascading renders
  ...
> 122 |     setWalk({ forBatch: batchId, rows: [], complete: false, failure: null });
      |     ^^^^^^^ Avoid calling setState() directly within an effect
  react-hooks/set-state-in-effect
✖ 1 problem (1 error, 0 warnings)
```

Replacement, preserving every observable output of the brief's version:

- Page one (`cursor === null`) **replaces** the walk state with `{ forBatch: batchId, rows, complete, failure: null }`; later pages append. This also covers the rare re-walk of the *same* batch id after an aborted walk (e.g. ok -> no-batch -> ok on the same id), where an append-only design would have duplicated rows.
- The failure arm **rebases** onto the current batch: `previous.forBatch === batchId ? { ...previous, complete: false, failure } : { forBatch: batchId, rows: [], complete: false, failure }`, so a page-one failure for a new batch is attributed to that batch (visible), while a later-page failure keeps the rows already landed.
- Between the new book landing and page one arriving, the existing `walk.forBatch === batchId` derivation already masks the older walk as `rows: [] / walkComplete: false / walkFailure: null`, which is what the brief's synchronous reset produced.

Everything else in the hook is the brief's code verbatim, including comments.

## Verification

From `web/`:

```
> solvent-web@0.1.0 pretypecheck
> node scripts/ensure-client.mjs
ensure-client: building @solvent/client…
> @solvent/client@0.1.0 build
> tsc -p tsconfig.build.json
> solvent-web@0.1.0 typecheck
> tsc --noEmit
typecheck exit: 0

> solvent-web@0.1.0 lint
> eslint .
lint exit: 0
```

Serena `get_diagnostics_for_file` on `web/lib/cash-book.tsx` (errors + warnings): `{}`.

Commit path: `git add web/lib/cash-book.tsx` (by name) -> `python roadmap/tools/scope_gate.py` -> `scope-gate: OK -- integrator claude-integrator; 1 path(s)` (claim not expired; no renewal needed) -> `git -c core.safecrlf=false commit -m "<brief's message>"`. The pre-commit control-plane doctor reported `OK -- 0 error(s), 0 warning(s), 5 info` and the gate passed again. `git status --short web` is empty afterwards.

## Self-review of the diff

- **Abort paths:** all four promise arms check `controller.signal.aborted` first (lines 91, 96, 131, 142) and return without touching state; the book effect's cleanup aborts `bookControllerRef` (110); the walk effect aborts the previous walk controller on entry (119) and its own in cleanup (168). An abort therefore never reaches `classifyPositionsFailure` or `setState`.
- **Once-per-batch restart guard:** `restartedForRef` (80) is compared and then assigned before `loadBook()` (147-148); the ref is never reset, so the same superseding id cannot restart twice, while a newer id can.
- **Batch mixing:** derived `rows`/`walkComplete`/`walkFailure` all gate on `walk.forBatch === batchId` (184); the failure arm rebases on the same test (159).
- **Non-null assertions:** grep `[A-Za-z0-9_\])]![^=]` over the file: no matches. `waterfall` (nullable) is passed through untouched inside `book`.
- **Imports:** every imported name has a non-import use (counts 2-4); nothing unused.
- **Hook rules:** deps are `[loadBook]` and `[batchId, loadBook]`; refs and setters are stable; no setState during render; `exhaustive-deps` clean.

## Concerns / notes for the caller

1. **Dead `??` fallbacks kept verbatim.** `EngineRefusal.code` and `.detail` are required `string` on the generated schema, so `refused.code ?? "withheld"` and `refused.detail ?? null` can never take the right-hand side. Neither `tsc` nor the (non-type-aware) eslint preset flags this, and BookSurface's `gatePosture` uses the same idiom, so I left the brief's text as instructed. A follow-up could simplify to `{ code: refused.code, detail: refused.detail }`.
2. **Null superseding id never restarts.** With `currentBatchId === null` the guard's `null !== null` is false, so the walk records a failure (transport register, since `BatchSupersededError` is not a `SolventHttpError`) rather than reloading a book that would 503. This matches the brief's `?? null` semantics; flagging it only so the e2e 409 spec (Task 11/12) targets the non-null case.
3. **Same-id reload does not re-walk.** The walk effect is keyed on `batch.id`; `reload()` that returns the same batch keeps the existing walk (and any recorded walk failure). Same as the brief's design.
4. **`.tsx` with no JSX**, as the brief named it; kept for the commit path.

---

# Fix round 1

**Commit:** `b2f2fc3` — `fix(web): useCashBook re-walks on reload and restart via a walk epoch; honest refusal shape` (only `web/lib/cash-book.tsx`; 28 insertions, 9 deletions; staged by name; scope gate OK; committed on the first attempt, no `index.lock` contention)

## What changed

### Finding 1 (Important): recovery path for a failed/stalled walk on a stable batch id

- New state `const [walkEpoch, setWalkEpoch] = useState(0);` with a doc comment.
- The walk effect's dependency array is now `[batchId, walkEpoch, loadBook]`, so an epoch bump re-runs the walk from page one on an unchanged id. The page-one-replace design from round 1 makes that same-id re-walk safe (no duplicate rows).
- `loadBook` takes a new option `rewalk?: boolean`. In its success arm, after `setState({ phase: "ok", book })`, it does `if (rewalk) setWalkEpoch((epoch) => epoch + 1);`.
- `reload()` calls `loadBook({ rewalk: true })`; the 409 restart arm calls `loadBook({ rewalk: true })`. The once-per-superseding-id guard (`restartedForRef`) is unchanged.

**Placement note (deliberate refinement of the ruling's wording).** The review said to bump the epoch "in `reload()` and in the 409 restart arm (after `loadBook()`)". Those are exactly the two call sites that request the bump, but the bump itself is applied inside `loadBook`'s success arm rather than synchronously beside the call, for two reasons:

1. Bumped beside the call, the effect would re-run immediately against the *old* `batchId` and start a page-one walk that is aborted the moment the reloaded book lands with a new id — a wasted request, plus a one-round-trip window in which page-one rows (served for the newest batch, since page one carries no cursor) are tagged with the old id.
2. Bumped in the success arm, the epoch and the book's own `setState` occur in the same synchronous callback, so React batches them into one render and one effect run: a changed id or an unchanged id both cost exactly one walk, and a re-walk never starts before the book it belongs to exists.

The recovery guarantee the finding asked for is identical: a same-id `reload()` or a same-id restart re-runs the walk from page one. A reload that *fails* does not bump (the book is then in `error`/`no-batch`, `batchId` is null, and no walk is wanted); the resume re-fetch never passes `rewalk`, so a resume on an unchanged id keeps the walk it has.

### Finding 2 (Minor 3): honest refusal shape

`refusedWhole` is now `{ code: string; detail: string } | null` in `CashBookReading`, built as `{ code: refused.code, detail: refused.detail }` — both are required strings on the generated `EngineRefusal` schema, so the previous `?? "withheld"` / `?? null` fallbacks were unreachable and are gone.

### Finding 3 (Minor 5): stable `reload`

`reload` is `useCallback(() => { void loadBook({ rewalk: true }); }, [loadBook])`, returned as `reload,` in the reading, so consumers may list it in effect deps.

Header comment and the restart-arm comment updated to state the re-walk law.

## Commands run and output

From `web/`:

```
> solvent-web@0.1.0 pretypecheck
> node scripts/ensure-client.mjs
ensure-client: building @solvent/client…
> @solvent/client@0.1.0 build
> tsc -p tsconfig.build.json
> solvent-web@0.1.0 typecheck
> tsc --noEmit
typecheck exit: 0

> solvent-web@0.1.0 lint
> eslint .
lint exit: 0
```

`react-hooks/exhaustive-deps` accepted `walkEpoch` as an effect dependency that the body does not otherwise read (extra component-scope deps are permitted for effects). Serena `get_diagnostics_for_file` on `web/lib/cash-book.tsx` (errors + warnings): `{}`.

From the repo root:

```
git add web/lib/cash-book.tsx
git diff --cached --name-only        -> web/lib/cash-book.tsx
python roadmap/tools/scope_gate.py   -> scope-gate: OK -- integrator claude-integrator; 1 path(s)
git -c core.safecrlf=false commit -m "fix(web): useCashBook re-walks on reload and restart via a walk epoch; honest refusal shape"
  control-plane doctor: OK -- 0 error(s), 0 warning(s), 5 info
  scope-gate: OK -- integrator claude-integrator; 1 path(s)
  commit exit: 0
git log -1 --format='%h %s'          -> b2f2fc3 fix(web): useCashBook re-walks on reload and restart via a walk epoch; honest refusal shape
git show --stat --format= HEAD       -> web/lib/cash-book.tsx | 37 ++++++++++++++++++++++++++++---------  (1 file changed, 28 insertions(+), 9 deletions(-))
git status --short web               -> (empty)
```

## Observation (not acted on, outside this round's findings)

Page one of any walk carries no cursor, so the server answers it for the newest servable batch; the hook tags those rows with the book's `batchId` without comparing `page.batch.id` to it. If the server advances between the book response and page one, the rows shown under that book are from the next batch until the book catches up (the later cursor pages are bound to the newer batch, so no 409 fires to expose it). This is inherited from the brief's design and the review approved the supersession guarantees; flagging it for the e2e authors in case a `page.batch.id !== batchId` check is wanted later.
