# Task 5 report — `room-history`: room % per batch from `/history`, and the near-cap streak

**Status:** DONE
**Commit:** `58b5017535d5ca6bf433efe08b32820f10960b7b` on `main`
**Message:** `feat(web): room over batches from the address history - the engine's exact rational per point, gaps as gaps, the near-cap streak` (exactly the brief's Step 5 message; no attribution trailers)
**Files (the only two staged and committed):**
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\room-history.ts` (new, 118 lines)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\room-history.spec.ts` (new, 84 lines)

## What I did, in the brief's order

1. Read the brief, then surveyed every helper it names before writing a line: `headroom.ts` (`headroomTenths` floors via `floorDiv`, null when `num <= 0n || den < 0n`; `WARN_HEADROOM_PCT = 10`), `percent.ts` (`formatTenths`, U+2212 via `MINUS` from `human-usd.ts`), `wireGuard.ts` (`wireBigInt` is null for anything outside `^-?[0-9]+$`, so `"4.62e9"` is refused; `readWirePopulation` throws `WireIntegerError` for a non-population), `format.ts` (`formatBlock` → `toLocaleString("en-US")`), `refusal-phrasebook.ts` (`SWEEP_FAILED` → "collateral sweep failed"), and `inspector-data.ts` (re-exports the generated `AddressHistoryEngine` / `AddressHistoryPoint`). Confirmed the generated wire schema (`packages/client-ts/src/generated/schema.ts`) matches the spec's fixture literals: `computed_at: string`, `status: "computed" | "refused"`, `refusal: Refusal | null` (`code`, `detail`, optional `asset`, `note`), `health_factor: HealthFactor | null` (`wad`/`num`/`den` NullableDecimal, `infinite`, `note`), nullable `total_*_base`, `withheld_batch_ids: number[]`.
2. **Step 1 — the failing spec.** Wrote `web/tests/unit/room-history.spec.ts` verbatim from the brief. Verified the file is valid UTF-8 (the titles carry `·`, `−`, `—`).
3. **Step 2 — run to see it fail.** `npx playwright test --project=unit tests/unit/room-history.spec.ts` →
   `Error: Cannot find module 'C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\room-history' imported from ...\web\tests\unit\room-history.spec.ts` (then "No tests found", as Playwright could not load the file). Module-not-found, as the brief expects.
4. **Step 3 — the module.** Wrote `web/lib/room-history.ts` verbatim from the brief. Valid UTF-8.
5. **Step 4 — run the spec.** Exact output line:

   ```
     4 passed (2.4s)
   ```

   All four tests green on the first run: series ordering/display/values/titles; the five gap kinds as titled nulls; the no-debt point as `100%`; the near-cap streak with its span.
6. `npm run typecheck` → exit 0 (its `pretypecheck` hook rebuilt `@solvent/client`; no tracked file changed as a result). `npm run lint` → exit 0.
7. **Step 5 — commit.** From the repo root: checked nothing was already staged (index empty), `git add` the two files by name, `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 2 path(s)` (control-plane doctor: 0 errors, 0 warnings, 5 info REVIEW-DUE notices), then `git commit -m "<brief's message>" -- web/lib/room-history.ts web/tests/unit/room-history.spec.ts` (pathspec-limited so no other implementer's work could be swept in). No index.lock retry was needed.

## Hand verification of the expectations (all agree with the helpers' real code)

Room tenths = `floor(1000 × (cap − debt) / cap)`, debt = 4 822 000 000 unless stated.

| cap | 1000×(cap−debt)/cap | floored tenths | display | value |
|---|---|---|---|---|
| 6 000 000 000 | 196.33… | 196 | `19.6%` | 19.6 |
| 5 500 000 000 | 123.27… | 123 | `12.3%` | 12.3 |
| 5 300 000 000 | 90.18… | 90 | `9%` (under the 100n line) | 9.0 |
| 5 200 000 000 | 72.69… | 72 | `7.2%` | 7.2 |
| 5 012 500 000 | 38.005… | 38 | `3.8%` | 3.8 |

- Title index 2 in test 1: `balances_block = 155_323_000 + 12 = 155323012` → `formatBlock` → `155,323,012`. ✓
- Test 2: `"4.62e9"` fails `WIRE_DECIMAL` → `wireBigInt` null → `unpublished`; `health_factor: null` → `unpublished`; refused row → title `batch 4 · not computed · collateral sweep failed`; withheld `[2]` → title contains "withheld" and "never"; `knownBatchIds [0]` → `no-row`; sorted ascending 0..5; `computedCount` 1. ✓
- Test 3: `infinite: true` → `1000n` → `formatTenths` → `100%`; value 100. ✓
- Test 4: `NEAR_LINE_TENTHS = BigInt(10) * 10n = 100n`. Walking from newest: batch 4 (38) ✓, 3 (72) ✓, 2 (90) ✓, 1 (196 ≥ 100) breaks → 3 batches; span = `20:04:00Z − 20:02:00Z` = 120 s. Broken series: batch 4 counted, batch 3 is `unpublished` → break → 1 batch, span null (needs ≥ 2). Single 19.6% point → 0 / null. Empty → 0 / null. ✓

No expectation needed changing.

## Deviations from the brief

None in the code or the spec — both files are the brief's text verbatim. Process notes only:
- Serena's `find_symbol` returned nothing for the generated schema (it lives under `packages/client-ts`, outside the indexed web project), so I read those schema blocks with `sed` by line range instead.
- Git printed `LF will be replaced by CRLF` warnings on add/commit (the repo's autocrlf normalisation); the files were written with LF like any heredoc and git normalises them the same way as the rest of the tree.
- The pre-existing ` M .superpowers/sdd/.gitignore` modification in the working tree is not mine and was neither staged nor committed.

## Observations for the reviewer (non-blocking, inherent to the brief's design)

- `roomSeries` keys points by `batchId` in a `Map`, so if the wire ever carried two points with the same `batch_id` for one engine (out of contract — the schema promises one point per batch, newest first), the later one silently wins. A contract-violation check was not asked for and would be a plan-level decision.
- An out-of-contract `batch_id` or `withheld_batch_ids[]` entry throws `WireIntegerError` via `readWirePopulation` (the established "honest arm on a surface with no classifier" posture, caught by the route boundary). The caller-supplied `knownBatchIds` are not re-guarded, on the assumption they are already validated batch ids.

---

## Fix round 1 (coordinator's message after `task-5-review.md`)

**Status:** NEEDS_CONTEXT — every requested change is implemented and green on its own spec and on lint, but NOT committed: `npm run typecheck` fails in a file outside this task's two-file scope (details below). The changes sit in the working tree, **unstaged**, so nobody's pathspec-less commit sweeps them in.

### Changes made (working tree, uncommitted)

`web/lib/room-history.ts` (156 lines):
1. `RoomPointKind` gains `"zero-cap"`. In `pointFor`, after the `infinite` arm and after `wireBigInt` on `num`/`den` (either unreadable → `unpublished`, "the ratio behind this point is not readable"): `den < 0n` → `unpublished` "negative debt on the wire"; `num < 0n` → `unpublished` "negative cap on the wire"; `num === 0n` → kind `zero-cap`, `roomTenths: null`, `value: null`, `display: "0 cap"`, title `batch N · zero cap · <"debt with no counted collateral — past the cap" | "no cap and no debt"> @ block …`. Only then the computed arm (the old `tenths === null` fallback is now unreachable and kept for type honesty).
2. `balances_block` passes `readWirePopulation(…, "balances_block")` before `formatBlock` via a local `atBlock()` used by the computed, no-debt and zero-cap titles; each caller-supplied id passes `readWirePopulation(id, "knownBatchIds[]")`.
3. The no-debt title now ends ` @ block …` like the computed title; the `infinite` check stays before `num`/`den` are read.
4. A duplicate `batch_id` among `engine.points` throws `new WireIntegerError(\`history: batch ${id} appears twice in ${engine.engine} points\`)` (`WireIntegerError` imported from `./wireGuard`).
5. `Streak` gains `readonly newestKind: RoomPointKind | null` (`series.newest?.kind ?? null`). `nearCapStreak` counts a point when it is `computed` with `roomTenths < NEAR_LINE_TENTHS` or when it is `zero-cap` (via a small `underLine` helper); any other kind breaks the run. A negative span → `spanSeconds: null`.

`web/tests/unit/room-history.spec.ts` (120 lines): the four `nearCapStreak` expectations carry `newestKind` (`"computed"` ×3, `null` for the empty series); one new `test(...)` pins the zero-cap point (`kind`, `"0 cap"`, `value` null, title contains "past the cap", `computedCount` 0), that it counts in the streak (`[19.6%, zeroCap, 3.8%]` → `{ batches: 2, spanSeconds: 60, newestKind: "computed" }`), a negative `den` → `unpublished` with "negative debt", the wire's infinite shape (`num: null, den: null`) → `"100%"`, duplicate `batch_id` → throws, `knownBatchIds: [1.5 as never]` → throws, reversed stamps → `spanSeconds: null`, a trailing withheld batch → `{ batches: 0, spanSeconds: null, newestKind: "withheld" }`.

### Verification

- `npx playwright test --project=unit tests/unit/room-history.spec.ts` →

  ```
    5 passed (2.4s)
  ```

- `npm run lint` → exit 0.
- `npm run typecheck` → **exit 2**, exactly these three errors and nothing else:

  ```
  tests/unit/inspector-headline.spec.ts(26,40): error TS2741: Property 'newestKind' is missing in type '{ batches: number; spanSeconds: number; }' but required in type 'Streak'.
  tests/unit/inspector-headline.spec.ts(32,37): error TS2741: Property 'newestKind' is missing in type '{ batches: number; spanSeconds: null; }' but required in type 'Streak'.
  tests/unit/inspector-headline.spec.ts(33,37): error TS2741: Property 'newestKind' is missing in type '{ batches: number; spanSeconds: null; }' but required in type 'Streak'.
  ```

### Why, and the decision needed

The coordinator asked for `newestKind` as a REQUIRED field and for a clean typecheck, noting that `lib/inspector-headline.ts` consumes `Streak`. That module itself is fine — `cashHeadline` only reads `s.batches` / `s.spanSeconds`. But its spec, `tests/unit/inspector-headline.spec.ts` (Task 6's file), builds three `Streak` object literals without the new field, and `web/tsconfig.json` includes `**/*.ts` with no `tests` exclusion, so those literals are inside the `tsc` program. A required field therefore cannot land with a clean typecheck without a change to that third file, which is outside this task's scope. I did not make it optional on my own: that would deviate from the specified interface and weaken every consumer's typing.

Two resolutions, either of which I can finish in one turn:
- **(a)** someone with scope over `tests/unit/inspector-headline.spec.ts` adds `newestKind: "computed"` (or `null`) to the three literals at lines 26, 32 and 33 — three one-token edits; the three errors are the only ones tsc emits, and a literal carrying the field matches `Streak` exactly, so typecheck goes clean — then I commit my two files with the specified message; or
- **(b)** the coordinator sanctions `readonly newestKind?: RoomPointKind | null` (optional), and I commit as is.

### Process note

The Bash tool rejected a single ~9.6 KB heredoc for the module twice (`unexpected EOF while looking for matching \`'`` at its line 120, both times, even alone), while an 8 KB heredoc for the spec went through. The module was written as two halves in the scratchpad and concatenated; the assembled file is 156 lines of valid UTF-8 and is exactly the intended content (the spec run above exercises it).

### Fix round 1 — resolution and commit

**Status:** DONE. The coordinator ruled that the TS2741 failures in `web/tests/unit/inspector-headline.spec.ts` are EXPECTED (Task 6's implementer is adding `newestKind` to its streak literals) and that a typecheck failing ONLY there counts as clean for this task.

**Commit:** `846e4fd08cdd8a82f12d4929bed4bb09ad4fdf45` on `main` — `fix(web): room history review round - a zero cap is a point past the cap, not a missing cap; every batch and block is guarded; the streak knows the newest point's kind` (exactly the specified message, no attribution lines). Pathspec-limited to the two task files: `web/lib/room-history.ts` (+54/−12 net shown as 54 changed lines) and `web/tests/unit/room-history.spec.ts` (+44); 2 files, 86 insertions, 12 deletions. Nothing else was staged before or after. `scope-gate: OK -- integrator claude-integrator; 2 path(s)`. No index.lock retry was needed.

**Final verification before the commit:**
- `npx playwright test --project=unit tests/unit/room-history.spec.ts` → `5 passed (2.3s)`
- `npm run lint` → exit 0
- `npm run typecheck` → exit 1; 3 `error TS` lines total, **0 outside `tests/unit/inspector-headline.spec.ts`** (the three TS2741 `newestKind` errors, by then at that file's lines 32, 38 and 39 — its line numbers had moved since the earlier run, consistent with the Task 6 implementer editing it concurrently). Per the coordinator's ruling this counts as clean; the cross-file failure is expected to clear when Task 6's fix lands.

**Cross-file note for the record:** `lib/inspector-headline.ts` (`cashHeadline`) reads only `streak.batches` and `streak.spanSeconds` and needs no change for the new required `Streak.newestKind`; only its spec's three object literals do.

---

## Round 2 (re-review of `846e4fd`: all addressed, two Minor follow-ups)

**Status:** DONE
**Commit:** `f352d5f180e38a4b332e82920687c48f66f91603` on `main` — `fix(web): room history round 2 - a zero cap with no debt is an undefined ratio, not a point past the cap; the negative-cap and no-debt arms are pinned` (exactly the specified message, no attribution lines). Pathspec-limited to the two task files; 2 files changed, 14 insertions, 3 deletions. Nothing else was staged before or after. `scope-gate: OK -- integrator claude-integrator; 2 path(s)`. No index.lock retry was needed.

### Changes

`web/lib/room-history.ts` — in `pointFor`, the `num === 0n` branch now splits: `den === 0n` (0/0, only reachable with an out-of-contract `infinite: false`) is an `unpublished` gap titled `batch N · no cap and no debt · undefined ratio`, display `—`; `den > 0n` stays `zero-cap` with title `batch N · zero cap · debt with no counted collateral — past the cap @ block …`, display `0 cap`. So `zero-cap` now means exactly "a published zero cap with debt left", the only shape that counts as under the near-cap line (`underLine` is unchanged).

`web/tests/unit/room-history.spec.ts` — three pins added inside the existing review-round block: a negative `num` (`"-1"`) → `kind: "unpublished"`, title contains "negative cap on the wire"; the no-debt (`infinite`) title contains "@ block 155,323,001" (batch 1, `balances_block: 155_323_001`); `num: "0", den: "0", infinite: false` → `kind: "unpublished"`, title contains "no cap and no debt", and `nearCapStreak` over `[3.8%, 0/0]` → `{ batches: 0, spanSeconds: null, newestKind: "unpublished" }` (it does not count and it breaks the run).

Both edits were made with Serena's `replace_content` this round (no whole-file heredoc), and the diff was reviewed before the run.

### Verification

- `npx playwright test --project=unit tests/unit/room-history.spec.ts` →

  ```
    5 passed (2.3s)
  ```

- `npm run lint` → exit 0; 2 warnings, both in `tests/unit/inspector-view.spec.ts` (`_v` / `_c` unused — another task's file, not touched).
- `npm run typecheck` → exit 2 with 16 errors, **all in `tests/unit/demo-inspector-weld.spec.ts`** (TS2305 missing exports from `../fixtures/demo`, TS7006 implicit `any`, one TS2345). That spec is UNTRACKED in the working tree (`??`), alongside a modified `web/tests/fixtures/demo/index.ts` and nine untracked demo JSON/mjs fixtures — another implementer's work in flight, not in HEAD, and nothing in it mentions `Streak` or `room-history`. Zero typecheck errors anywhere else: the round-1 TS2741s in `tests/unit/inspector-headline.spec.ts` are gone (its streak literals now carry `newestKind`), so that cross-file issue is closed.
- Focused proof that my change type-checks: `npx tsc --noEmit` with the repo's compiler options over `tests/unit/room-history.spec.ts` + `lib/inspector-headline.ts` (i.e. the module, its spec, and its one consumer, with their import closure) — result on the next line.
  focused tsc exit: 0 (clean)

### Concern flagged for the coordinator

I committed while the whole-project typecheck was failing ONLY in an untracked foreign WIP spec (`tests/unit/demo-inspector-weld.spec.ts`). The round-1 ruling named `inspector-headline.spec.ts` specifically; this is a different file, so the commit rests on the ruling's spirit (failures outside my scope, unrelated to my change, not in HEAD) rather than its letter. The focused tsc above shows my two files and their consumer are clean; if the coordinator disagrees, the commit is a clean two-file revert.
