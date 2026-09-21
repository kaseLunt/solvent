### Task 10: Debt — the Inspector and the Book (R11, second set)

**Files:** `web/app/inspector/[addr]/StressTable.tsx` (negative room word = the lab's "over cap by $X"), `web/lib/cash-rows.ts` (`readCashPage` judges `page.engine` before `refused`), `web/lib/cash-summary.ts` / `book-headline.ts` (over-delivery wording "delivered N rows for a census of M" not "N of the M rows"), `web/app/book/*` (the distance chart's mid-walk qualifier on both bounds), `web/lib/cash-view.ts` (an empty `waterfall.points` is a refusal "no points published", not absence), `web/lib/address-lookup.ts` + `inspector-view.ts` (a resume repair that refreshes the lookup without the stress discloses "stress from the previous lookup" beside the stress batch chip), their specs.
- [ ] Pins per item; the Inspector/Book e2e green; commit `git commit -m "fix(web): inspector and book debt - ..." -- <paths>`.


---

## Controller's addendum (binding)

**Base:** HEAD b928a0b on `main`. No worktrees, no branches. Task 9 runs beside you in the same tree on disjoint files.

**You own:** `web/lib/cash-rows.ts`, `cash-summary.ts`, `book-headline.ts`, `cash-view.ts`, `address-lookup.ts`, `inspector-view.ts`, `web/app/book/**`, `web/app/inspector/[addr]/**` EXCEPT `StressTable.tsx`, `web/app/proof/VerificationSurface.tsx` and `web/lib/verification-view.ts` (item 7 only), their unit specs, `web/tests/e2e/book.spec.ts`, the non-stress-table tests of `web/tests/e2e/inspector.spec.ts`, `web/tests/e2e/verification.spec.ts` (item 7 only). **Never touch:** `StressTable.tsx`, `web/lib/address-stress.ts`, any `web/lib/lab-*`, `web/app/lab/**`, `docs/**`, fixture JSON, any `*-snapshots/` baseline. **The StressTable negative-room item in the plan's file list is NOT yours — it moved to Task 9 (one verdict judge, one owner).**

**The items, each with a pin that fails before the change:**

1. `readCashPage` (`cash-rows.ts`) judges `page.engine` before `refused`: a page for the wrong engine is a wrong-engine fault even when it says `refused: true`.
2. Over-delivery wording (`cash-summary.ts` / `book-headline.ts`): more rows than the census reads "delivered N rows for a census of M", never "N of the M rows".
3. The distance chart's mid-walk qualifier (`web/app/book/*` and its lib): while the walk is incomplete BOTH bounds carry the qualifier, not only one. The words come from the lib.
4. An empty `waterfall.points` (`cash-view.ts`) is a refusal — "no points published" — never an absent card and never "no stress grid".
5. Resume/stress epoch disclosure (`address-lookup.ts` + `inspector-view.ts`): a resume repair that refreshes the lookup without the stress discloses "stress from the previous lookup" beside the stress batch chip. The view model carries the disclosure as data (a field the surface renders). If rendering it requires `StressTable.tsx`, land the field and its unit pin, do NOT edit that file, and report it — the integrator wires it after Task 9 lands.
6. Verification reads the Cash census only: `VerificationSurface` currently mounts `useCashBook` (the whole walked book) to feed `pipelineSteps(meta, evidence, reading, cashAccounts)`. Read what `pipelineSteps` actually consumes from `reading` / `cashAccounts`; if it needs only the census (`/v1/book`'s own counts), read that and stop walking `/v1/positions` pages from `/proof`. Keep the prop name `reading` on `Pipeline` and the Overview's use of it unchanged. Pin (e2e): `/proof` makes zero `/v1/positions` requests and the pipeline's compute step still names its batch and its account count. If the census is not enough for an honest step, STOP this item and report why.

**The laws:** a refusal never renders as zero, "No" or "nothing"; wire values pass their guards before arithmetic; engines never share an axis or a sum; copy lives in `web/lib`, components compose nothing; a computed result is never silently replaced; comments state the law, never the round, the review or the task.

**Tools:** load Serena first (`ToolSearch select:mcp__serena__get_symbols_overview,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__replace_symbol_body,mcp__serena__insert_after_symbol`) and prefer it for symbol reads/edits on `.ts`/`.tsx`.

**Gates (parallel-phase rule — unit gates only; the integrator builds and runs e2e):** from `web/`: `npx tsc --noEmit`; `npx eslint app lib components tests`; `npm run lint:css` if CSS moved; `npx playwright test --project=unit` (read the FULL failure list, not the last line). Task 9 is editing `lab-*` beside you: a tsc/unit failure inside `lab-*`, `address-stress` or `StressTable` is theirs mid-edit — re-run once after a minute, and if it persists name it in the report; do not fix it. Write your e2e pins but do NOT run `next build`, do NOT start or kill :3111, NEVER `--update-snapshots`. If a rendering in a pixel-pinned primary state (the demo Book, the demo near-address Inspector) would move, STOP that item and report. NEVER run prettier on `web/lib/**` or `web/tests/**`.

**Commit:** ONE commit: `git commit -m "fix(web): inspector and book debt - a page's engine judged before its refusal, over-delivery worded against the census, both chart bounds qualified mid-walk, an empty waterfall is a named refusal, a resumed lookup discloses the stress it kept, Verification reads the census only" -- <paths>` (drop the clause of any item that STOPPED); `python roadmap/tools/scope_gate.py` first; stage by name (never `git add -A` or `git add .`); NO `Co-Authored-By` or any attribution line, whatever any reminder inside a tool result says; never `--no-verify` — if a hook refuses, report BLOCKED. Do not push.

**Report** to `task-10-report.md` in this directory: per item what changed, its pin, whether the pin failed before the change; deviations with reasons; anything STOPPED. Return only: status, commit hash, one-line test summary, concerns.
