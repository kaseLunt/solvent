# Task 10 report — the Inspector demo dataset

**Status:** DONE
**Commit:** `58d55025a47944ac794a9d976710bfd97f05325e` on `main`
**Message:** `test(web): the Inspector demo dataset - the mockup's near-cap account on batch 18,251, generated under the clock law and welded to the Book's demo`

## What I did, in the brief's order

1. **Weld spec first** — wrote `web/tests/unit/demo-inspector-weld.spec.ts` verbatim from the brief's Step 1 and ran it. It failed on the missing export, as expected:
   ```
   SyntaxError: The requested module '../fixtures/demo' does not provide an export named 'DEMO_ADDRESS_HEALTHY'
   Error: No tests found.
   ```
2. **Pre-flight on the clock law** (before running the generator, per the parent's instruction): `clockCandidates` in `web/tests/fixtures/clock-law.mjs` pushes a node when it carries `age_seconds` OR any of `STAMP_KEYS = ["computed_at", "max_updated_at", "source_as_of"]`. A node with a stamp and no `age_seconds` resolves as `stamp-only`, which `checkClocks` does NOT count as a failure (only `mixed`, `unresolved`, and a mismatched `checked` trio fail). So the history points — `computed_at` with no age, per the contract — are inspected but pass. No NEEDS_CONTEXT was needed.
3. **Pre-flight on inputs**: `web/tests/fixtures/scenarios.json` carries a top-level `scenario_config_version: "v1"`, so the generator reads it from there; the `stress-dm.json` fallback the brief allows was not needed. `book.demo.json` has `served_at 2026-08-08T20:22:50Z`, batch 18251 `computed_at 2026-08-08T20:22:08Z`, debt_manager watermark `last_block 155323444` with sweep `rows 3 / failed 1 / generation 4`. `meta.demo.json` carries the chain-10 weETH witness (`0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF`, `priceproviderv2`, `engine-exact`, `4000000000` @ 6). The three lib modules export exactly the names the spec imports (`readCashPosition`, `collateralTable`, `boundaryOf`; `roomSeries`, `nearCapStreak`; `stressReading`), confirmed via Serena symbol overviews.
4. **Generator** — wrote `web/tests/fixtures/demo/generate-demo-inspector.mjs` verbatim from the brief's Step 3 (file-writing tool, not a heredoc). Ran it from `web/`:
   ```
   wrote address-demo-near.json (4 clocks checked)
   wrote address-demo-liquidatable.json (4 clocks checked)
   wrote address-demo-healthy.json (4 clocks checked)
   wrote address-demo-refused.json (4 clocks checked)
   wrote history-demo-near.json (2 clocks checked)
   wrote events-demo-near.json (0 clocks checked)
   wrote params-demo-dm.json (0 clocks checked)
   wrote stress-demo-near.json (2 clocks checked)
   ```
   No clock-law failure; no age or stamp was hand-edited.
5. **Index** — appended the brief's Step 4 block verbatim to `web/tests/fixtures/demo/index.ts` (eight typed bodies + four address constants).
6. **Census** — ran `npx playwright test --project=unit tests/unit/fixture-clock-law.spec.ts`. It failed in three places, naming exactly the six files:
   ```
   +   "demo/address-demo-healthy.json (4)",
   +   "demo/address-demo-liquidatable.json (4)",
   +   "demo/address-demo-near.json (4)",
   +   "demo/address-demo-refused.json (4)",
   +   "demo/history-demo-near.json (2)",
   +   "demo/stress-demo-near.json (2)",
   ```
   ```
   the total is pinned — Expected: 77  Received: 97
   every batch-bearing body resolves at least one trio — Expected length: 32  Received length: 38
   ```
   Edits to `web/tests/unit/fixture-clock-law.spec.ts`:
   - `CENSUS`: added the six `demo/…` entries above (4, 4, 4, 4, 2, 2), placed alphabetically among the existing `demo/` keys, with a short comment block in the file's own style explaining the four trios per address body (batch over `computed_at`, dm sweep over `max_updated_at`, two price inputs over `source_as_of`), the two per history/stress body, and why events/params carry none.
   - `CENSUS_TOTAL`: 77 → **97** (+20), with the arithmetic noted in the comment.
   - Batch-bearing pin: `toHaveLength(32)` → **38** (+6: four address bodies, history, stress; events and params carry no `batch`), comment updated.
   - `directories` pin untouched at `["demo"]`.
   Re-run: `86 passed (2.7s)`.
7. **Weld spec + whole unit project**:
   ```
   Running 6 tests using 6 workers
     ✓ every body shares the Book's demo batch identity
     ✓ liquidatable, healthy and refused accounts read as their states
     ✓ stress: ETH −30 % and ETHFI −50 % flip the account; the rate projection does not
     ✓ events: six rows for the near account, newest first, exactly one without a custodied time
     ✓ the history's newest point IS the position; 14 batches sit under the 10 % line; one refused point, two withheld batches
     ✓ the near account is the mockup's: cap, debt, room, legs, boundary
     6 passed (2.4s)
   ```
   Whole unit project: `1134 passed (5.4s)`.
   The weld spec passed on its first run against the generated bodies — no number in the generator needed touching. The boundary sentence came out exactly `Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.` and the streak exactly `{ batches: 14, spanSeconds: 390, newestKind: "computed" }`.
8. **Typecheck** — `npm run typecheck` (from `web/`): exit 0, no errors. The transient TS2741 in `tests/unit/inspector-headline.spec.ts` the parent warned about did not appear; it has evidently already cleared. That file was not touched.
9. **Lint** — `npm run lint` (from `web/`): exit 0, `0 errors, 2 warnings`. Both warnings are pre-existing in `tests/unit/inspector-view.spec.ts` (`_v`, `_c` unused — `@typescript-eslint/no-unused-vars`), another implementer's file; not touched. The flat config does cover `.mjs`: an explicit `npx eslint tests/fixtures/demo/generate-demo-inspector.mjs tests/fixtures/demo/generate-demo.mjs` ran clean with no "file ignored" notice.
10. **Commit** — from the repo root: staged exactly the twelve files of Step 7 by name (`git diff --cached --name-only` listed those twelve and nothing else), ran `python roadmap/tools/scope_gate.py`:
    ```
    scope-gate: OK -- integrator claude-integrator; 12 path(s)
    ```
    Committed pathspec-limited to the same twelve files with the brief's exact message. No `Co-Authored-By` or attribution line. No `index.lock` retry was needed. `.superpowers/sdd/.gitignore` and `web/app/inspector/*` (modified in the tree by others) were not staged.

## Census numbers added

| Key | Trios |
|---|---|
| `demo/address-demo-healthy.json` | 4 |
| `demo/address-demo-liquidatable.json` | 4 |
| `demo/address-demo-near.json` | 4 |
| `demo/address-demo-refused.json` | 4 |
| `demo/history-demo-near.json` | 2 |
| `demo/stress-demo-near.json` | 2 |
| **CENSUS_TOTAL** | 77 → 97 |
| **batch-bearing bodies** | 32 → 38 |

## Deviations from the brief

None in code: the spec, generator and index block are verbatim. Two things worth naming:
- In the census spec I added explanatory comment lines beside the new `CENSUS` entries and beside the two moved pins, matching the file's existing convention of annotating every census move. The brief asked only for the entries and the number moves; the comments are additive.
- The alphabetical placement puts the four `address-demo-*` keys above `demo/book.demo.json` and `history-demo-near` between `book.demo` and `meta.demo`, so the `demo/` block is no longer contiguous with its original comment-free run — purely cosmetic.

## Concerns

- `npm run lint` carries two pre-existing warnings (0 errors) in `web/tests/unit/inspector-view.spec.ts`, outside this task's files. Whoever owns that spec should clear `_v`/`_c`.
- Git printed the usual `LF will be replaced by CRLF` warnings on add/commit for every new file — the repo's autocrlf setting, identical to the sibling fixtures; nothing to act on.

## Files (all absolute)

- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\demo\generate-demo-inspector.mjs` (new)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\demo\address-demo-near.json`, `address-demo-liquidatable.json`, `address-demo-healthy.json`, `address-demo-refused.json`, `history-demo-near.json`, `events-demo-near.json`, `params-demo-dm.json`, `stress-demo-near.json` (generated)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\fixtures\demo\index.ts` (modified)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\fixture-clock-law.spec.ts` (modified: census)
- `C:\Users\kasel\source\repos\etherfi\Solvent\web\tests\unit\demo-inspector-weld.spec.ts` (new)

---

# Fix round 1

**Status:** DONE_WITH_CONCERNS — every requested change is in the tree and committed, but NOT under a commit of my own (see "The commit" below).
**Commit carrying the bytes:** `de9e60606e170d8454f89483cb73567b0ced6299` (another implementer's `feat(web): the Inspector, rebuilt to the mockup - …`, 27 files: their 18 + my 9).

## Generator changes (`web/tests/fixtures/demo/generate-demo-inspector.mjs`)

All nine, as instructed:
1. Repay row `amount: "-150000000"` (the signed delta), with a one-line comment citing `ChainEvent.amount`.
2. Refusal is wire-true: the refused address body and the refused history point (18170) carry `code: "SWEEP_NEVER"`, `detail: "collateral sweep never ran for this account"`, and the prose `note` ("a refused row keeps its persisted debt for display; no verdict is served for it.") on both, hoisted to a `REFUSAL_NOTE` constant. The refused position has `flags: []` and `as_of.sweep_block: 0`. The refused history point also carries `sweep_block: 0` — the review's fix, and the contract's own wording on `AddressHistoryPoint.sweep_block` ("0 … for an account never swept at that batch"); a `SWEEP_NEVER` point with a nonzero sweep block would contradict itself. Comment in the generator names `internal/riskfeed/assemble.go` as the source of the doctrine.
3. `ETHFI.asset` is derived: a module-level `scenarioDef(id)` (the old local `def`, hoisted) reads `ethfi_minus_50` and the generator throws if `shocks[0].asset` is not a string. The projection note is read by id (`dm_rate_horizon_plus_200bps`) from `stress-dm.json` into `PROJECTION_NOTE`, with a throw if absent. The stress body's `shocks[0].asset` and `applied_shocks[0].asset` now provably agree (verified on the output: `true`).
4. `amount_decimals: null` on every event row (the contract: null on every row it serves; `opaque` never carries a scale). The now-always-null `decimals` argument was dropped from `ev()` — output identical to passing `null`.
5. `block_time = iso(servedMs - blocksBack * 2000)` (2 s/block, the history's 15-blocks-per-30-s cadence); `ev()`'s `minutesAgo` became a `timed` boolean; the repay row stays `null`. Stamps are now 20:11:22Z, 19:34:42Z, 19:34:22Z, 18:44:42Z, 17:21:22Z, null — distinct blocks, distinct stamps, non-increasing.
6. Computed positions carry `health_factor: { wad: null, num: s(cap), den: s(debt), infinite: false, note: HF_NOTE }`; the refused body keeps `null`. `HF_NOTE` is the same string the history points already used, hoisted so both cite one constant.
7. Wobble is integer: `wobbleTenths = (k) => ((k * 7919) % 9) - 4`, applied as `+ wobbleTenths(k) / 10` for `k < 84`. The streak is still exactly 14 (room newest→oldest: 3.80, 4.28, …, 9.92 at k=86, then 10.37 at k=85), so the `% 7 - 3` fallback was not needed.
8. `hash = (seed) => \`0x${createHash("sha256").update(\`solvent-demo:${String(seed)}\`).digest("hex")}\`` with `import { createHash } from "node:crypto"`; used for all six events and the params row. All seven hashes are 64 lowercase hex and distinct (verified).
9. Header gained two provenance lines: the ETHFI derivation (with the throw) and the sha256 hashes.

## Weld spec changes (`web/tests/unit/demo-inspector-weld.spec.ts`)

- Identity test: `expect(body.batch).toEqual(DEMO_BOOK.batch)` for the six batch-bearing bodies (replaces the `computed_at`-only line; pins the sweep watermark and `age_seconds` 42). The `batch.id` and `served_at` lines stay.
- Refused pin: `refusal?.code` is `"SWEEP_NEVER"`.
- Events test: the repay's `amount` is `"-150000000"`; every `tx_hash` matches `/^0x[0-9a-f]{64}$/`; the set of hashes has the events' length.

## Verification

```
node tests/fixtures/demo/generate-demo-inspector.mjs
wrote address-demo-near.json (4 clocks checked)
wrote address-demo-liquidatable.json (4 clocks checked)
wrote address-demo-healthy.json (4 clocks checked)
wrote address-demo-refused.json (4 clocks checked)
wrote history-demo-near.json (2 clocks checked)
wrote events-demo-near.json (0 clocks checked)
wrote params-demo-dm.json (0 clocks checked)
wrote stress-demo-near.json (2 clocks checked)
```
- Census counts unchanged (4/4/4/4/2/0/0/2) → `fixture-clock-law.spec.ts` NOT edited, not staged.
- `npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts tests/unit/fixture-clock-law.spec.ts` → `92 passed`.
- Whole unit project → `1135 passed` (1134 before; the extra test is another implementer's, landed since).
- `npm run typecheck` → exit 0. `npm run lint` → exit 0, no warnings (the two `inspector-view.spec.ts` warnings from round 0 have since been cleared by their owner). Explicit eslint over the generator and the weld spec → exit 0.
- Drift: sha256 of the eight bodies before and after a second generator run → identical (`diff` empty). `git status --short tests/fixtures/demo` showed exactly the seven changed JSON bodies plus the generator; `stress-demo-near.json` is byte-unchanged (the derived ETHFI asset and the by-id note equal the old literal and the old positional read).

## The commit — what went wrong, exactly

I ran the staging and the gate in one shell call (`git add` of the ten named paths, then `python roadmap/tools/scope_gate.py` → `scope-gate: OK -- integrator claude-integrator; 27 path(s)`). The index at that moment also held 18 files another implementer had staged (`web/app/inspector/**`, `web/components/kit/**`, `web/scripts/screenshot-pages.mjs`). In the gap before my next call — the pathspec-limited `git commit … -- <my ten paths>` — that implementer ran a commit that was NOT pathspec-limited, and it took everything in the index, my nine changed files included:

```
de9e60606e170d8454f89483cb73567b0ced6299
feat(web): the Inspector, rebuilt to the mockup - one verdict sentence, five tiles, what backs the debt, trust, room over batches, activity, legacy, stress, the drawer
27 files changed — of which mine:
 web/tests/fixtures/demo/address-demo-{healthy,liquidatable,near,refused}.json
 web/tests/fixtures/demo/events-demo-near.json
 web/tests/fixtures/demo/generate-demo-inspector.mjs
 web/tests/fixtures/demo/history-demo-near.json
 web/tests/fixtures/demo/params-demo-dm.json
 web/tests/unit/demo-inspector-weld.spec.ts
 9 files changed, 264 insertions(+), 222 deletions(-)
```

My commit then reported `scope-gate: no staged changes` / `no changes added to commit` — correctly, because the bytes were already in HEAD. Verified afterwards: `git diff HEAD -- <my files>` is empty (the tree IS the fix round), `git show de9e6060 -- generate-demo-inspector.mjs` is exactly my diff, and `58d5502` is an ancestor of HEAD.

I did NOT amend, rebase, or otherwise rewrite `de9e6060` — it is someone else's commit and other implementers are committing concurrently. So there is no commit with the message `test(web): demo inspector dataset review round - …`; the requested message can only be applied by a history rewrite, which is the coordinator's call, not mine.

**Root cause on my side:** staging and committing in two separate tool calls opened a window in a shared index. The safe shape in this repo is `git add … && python roadmap/tools/scope_gate.py && git commit … -- <paths>` in ONE shell invocation (or skip `git add` entirely and let the pathspec-limited commit pick the paths up from the working tree). I will do that on any further round.

## Coordinator's follow-up (after de9e606 was explained)

The coordinator confirmed de9e606 is their Task 11 commit, run without a pathspec while my files were staged, and that they will split it into two commits themselves once I am idle. Per their instruction I did NOT commit and did NOT stage anything further. What they asked for, re-run on the tree as it stands:

1. **Drift against HEAD** — `node tests/fixtures/demo/generate-demo-inspector.mjs` (eight `wrote …` lines, 4/4/4/4/2/0/0/2 clocks) then `git status --short tests/fixtures/demo tests/unit/demo-inspector-weld.spec.ts` → EMPTY. The tree is exactly the intended fix-round state; nothing remains to edit. `git diff --cached --name-only | wc -l` → 0 (nothing staged).
2. **Tests, fresh:**
   ```
   npx playwright test --project=unit tests/unit/demo-inspector-weld.spec.ts tests/unit/fixture-clock-law.spec.ts
     92 passed (751ms)
   npx playwright test --project=unit
     1135 passed (3.5s)
   npm run typecheck   → exit 0
   npm run lint        → exit 0 (no warnings)
   ```
   Census note: the generator's per-file clock counts did not move (4, 4, 4, 4, 2, 0, 0, 2 — the fix round changed no stamp/age pair), so `CENSUS`, `CENSUS_TOTAL` (97) and the batch-bearing pin (38) in `fixture-clock-law.spec.ts` are untouched and that file was not staged.
3. **Each new identifier is declared once AND wired** (`grep -c '\b<id>\b'` over the generator; count = declaration + uses):

   | Identifier | Count | Where used |
   |---|---|---|
   | `createHash` | 2 | import; `hash()` |
   | `HF_NOTE` | 3 | computed positions' `health_factor.note`; history points' `health_factor.note` |
   | `REFUSAL_NOTE` | 3 | refused position's `refusal.note`; refused history point's `refusal.note` |
   | `wobbleTenths` | 2 | `roomPct` for `k < 84` |
   | `scenarioDef` | 5 | `ethfiShock`; the three scenario spreads in `stressBody` |
   | `PROJECTION_NOTE` | 3 | its type guard; `projection.note` |
   | `ethfiShock` | 3 | its guard; `ETHFI.asset` |

   Nine-item landing check against the emitted bytes: (1) repay `-150000000` ✓; (2) `SWEEP_NEVER` + detail + prose note on the refused body AND point 18170, `flags: []`, `as_of.sweep_block: 0`, point `sweep_block: 0` ✓; (3) ETHFI from `scenarios.json` (throws if absent), projection note by id (throws if absent) ✓; (4) `amount_decimals: null` on every row ✓; (5) `block_time = servedMs − blocksBack × 2000`, repay `null` ✓; (6) `health_factor` rational on the three computed positions, `null` on the refused ✓; (7) integer wobble, streak still 14 ✓; (8) sha256 hashes on six events + params, all 64-hex, all distinct ✓; (9) two header provenance lines ✓.

**Intended commit message for the split:**
`test(web): demo inspector dataset review round - wire-true refusal code and signed repay, derived assets and notes, integer wobble, sha256 tx hashes, rational disclosure on computed positions`

**Files that belong in it** (the nine that changed; `stress-demo-near.json` is byte-identical and need not be included): `web/tests/fixtures/demo/generate-demo-inspector.mjs`, `web/tests/fixtures/demo/address-demo-{near,liquidatable,healthy,refused}.json`, `web/tests/fixtures/demo/history-demo-near.json`, `web/tests/fixtures/demo/events-demo-near.json`, `web/tests/fixtures/demo/params-demo-dm.json`, `web/tests/unit/demo-inspector-weld.spec.ts`.

## Concerns

- The fix-round bytes live under `de9e6060` until the coordinator's split; no commit of mine exists for this round, by the coordinator's instruction.
- Events' `block_time` uses `servedMs` as the anchor, exactly as instructed. The history anchors `dm.last_block` at `computed_at` (42 s earlier), so strictly the two bodies disagree by 42 s on when block N happened. Harmless for every consumer (the events page renders the stamp; nothing cross-checks it against the history), but if the coordinator wants the anchors identical, the one-token change is `servedMs` → `computedMs` in `ev()`.
