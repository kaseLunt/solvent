# Plan 5 (settle for deploy) — whole-branch review, 3f9836d..80ffb17

Read-only. Nothing was built, run, started or killed. I read every commit's diff (PNGs skipped, except three README
captures I opened to check their captions), and checked the final tree at 80ffb17 against the spec, the plan, the
ledger, `api/openapi.yaml`, the Go source, the committed receipt and the review ledgers. The Minors the ledger already
carries are not re-reported.

## Verdict

**Ready to close after one fix wave.** There are no Critical findings. Three Important findings need fixing first:
two are seams between areas (a ruling was applied on one surface but not on its twin on the same page), and one is
the README's D-006 clause-5 disclosure, which is applied unevenly. Each fix is small and local.

## Critical

None.

## Important

### I-1 · The Inspector's trust card still says "never swept". The ruling's "collateral never read" did not reach it.
- **Where:** `web/lib/trust.ts:158-160` (`detail: "never swept · collateral clock absent"`) and
  `web/app/inspector/[addr]/InspectorDrawer.tsx:66` (`"none (never swept)"`, which is also composed in the component).
- **How to reach it:** `/inspector/0x4444444444444444444444444444444444444404`, the demo's refused specimen:
  SWEEP_NEVER with `sweep_block: 0`. The headline's dek reads "Collateral never read. No verdict is served for it."
  The Trust card beside it reads "Collateral sweep · never swept · collateral clock absent".
- **Why it matters:** Task 9 replaced the phrasebook word because "sweep never ran" is false in the engine's second
  SWEEP_NEVER arm. That arm is a sweep that was attempted and never succeeded (`internal/riskfeed/assemble.go:1003-1006`),
  and it also serves `sweep_block` 0. "Never swept" has the same defect, so this page gives two different words for one
  state, and one of them is false on a reachable production state: an account whose first sweep failed.
- **Smallest fix:** `detail: plainCause("SWEEP_NEVER") + " · collateral clock absent"` (reads "collateral never read ·
  …"). In the drawer, `"none (collateral never read)"`, taken from the lib. Re-point `trust.spec.ts:127,165-167,221`.

### I-2 · The Inspector's receipt item counts "29/29 Cash rows". Verification calls the same figure "account comparisons" and says it is not a breakdown of the checked rows.
- **Where:** `web/lib/trust.ts:248-300` (`countedRows`, `answeredItem`).
- **How to reach it:** `/inspector/<near>` shows "Pinned reconcile run matched the chain · 29/29 Cash rows · Jul 29,
  02:14 UTC". On `/proof` the same number is "Cash · account comparisons | 29/29 exact", followed by "count every
  compared row, checked or advisory; they are not a breakdown of the checked rows".
- **Why it matters:** When the receipt carries no Cash weld, `countedRows` falls back to the checked-row tally and uses
  the same bare noun "rows". The one item therefore means two different populations depending on the receipt. Its
  short arm says "N Cash rows drifted" about account comparisons that are merely not exact. Area C made "account
  comparisons" and "checked rows" the page vocabulary, and area E's twin never took it up.
- **Smallest fix:** compose the item from `evidence.ts`'s exports: `weldLabel(CASH)` →
  "29/29 Cash account comparisons exact", and the fallback `${CHECKED_ROWS_LABEL}` → "87/87 checked rows exact". The
  short arm becomes "N of M Cash account comparisons not exact". Re-point `trust.spec.ts:58-79`,
  `inspector.spec.ts:102,605-613` and `inspector-view.spec.ts:120`.

### I-3 · README: the later-change disclosure covers `internal/risk` and the client's decimal module only, yet the page says "only approved components are cited here".
- **Where:** `README.md:91-95` (rows citing the `cmd/api` Task 7, client Task 8 and `cmd/riskd` Task 5 approvals),
  `:97-112` (the later changes to `internal/risk`) and `:256-257`.
- **What shows:** The README says `e4d9b03` has "no closing approval … recorded". That commit also changed `cmd/api`
  (CORS middleware) and the client (`sse`), but the `cmd/api` and client rows do not mention it. Since its cited
  approval, `cmd/api` has 33 later commits and `cmd/riskd` has 10, and neither row mentions them. `internal/ingest` has
  none, so row 1 is clean. The approvals cited are real: all ten session ids resolve in the ledgers. The problem is
  that a reader takes "cmd/api (Task 7)" as vouching for today's `cmd/api`, while the README itself records an
  unclosed change to it. That breaks D-006 clause 5's "cited in README claims" test as the README words it.
- **Smallest fix:** extend "Later changes" to `cmd/api`, `cmd/riskd` + `internal/riskfeed` and `packages/client-ts`.
  List each change's closing round, or "none recorded"; the rounds 39, 65-67 and 68-72 arcs cover much of `cmd/api`.
  Alternatively, reword the rows as "approved at `<commit>`; later changes and their reviews are in the ledger" and
  replace "only approved components are cited here" with "each claim names its approval of record".

## Minor

- **M-1 · A liquidation's repaid figure is decided in two places, and the two surfaces print different figures.**
  `web/lib/activity-view.ts:357-376` (Activity: exact decimals, "0.35812 USD"; an unscaled figure is "358120 raw
  units") against `web/lib/activity-rows.ts:62-81` (Inspector: `humanAmount` truncates to 4 dp, so "0.3581 USD"; an
  unscaled figure is "358120 (raw units) USD", which puts a unit on raw digits). The demo Inspector has no liquidation,
  so this is latent. The raw-amount cell order also differs: Activity's unit cell is "normalized debt · raw units ·
  USDC", while the Inspector shows the pill first and then "· normalized debt · USDC". Fix: export one
  `liquidationRepaid(event)` from `feed-view` and have both surfaces read it.
- **M-2 · The "nothing computed" predicate lives in three places.** They are `cash-summary.ts:168` `noneComputed` (from
  the walk), `cash-view.ts:280` `censusNoneComputed` (from the aggregate) and `cash-view.ts:441` `nothingComputed`
  (from the legacy aggregate). The Debt tile reads the aggregate and the walk tiles read the walk, so they can disagree
  on an inconsistent answer. Fix: one exported `computedNone(computed, refused)`.
- **M-3 · The Liquidatable tile drops "· 0 in all" beside refused accounts but still prints the zero.** Its value is
  "$0" (neutral) over "0 accounts · 0 more under $100" (`cash-summary.ts:185-196, 227-238`;
  `cash-summary.spec.ts:441-443`). "49 in all" also reads as a whole-book total beside "Not computed 6". Owner's list:
  scope the figure to computed accounts, or give it its register.
- **M-4 · History's legend still says "click any bucket for its full record"** (`history-view.ts:113`), and that record
  is now titled "Hour record". Fix: "click any hour for its record".
- **M-5 · Two spellings on one Activity row set.** "bad debt realised" (`feed-view.ts:206`, `activity-view.ts:523-524`)
  sits beside "bonus realized" (`app/feed/ActivityTable.tsx:22`, which is also copy composed in the component). Pick
  one spelling.
- **M-6 · Copy is still composed in components on pages this plan touched, and the ledger never dispositioned the
  skeptic's D-area corrections.** Examples: `app/lab/AssumptionsDrawer.tsx:22-75` (h3s such as "Path assumption",
  "Applied shocks" and "Held flat", plus "No mark moved…"); `app/lab/MoversTable.tsx:8-13` (column heads);
  `app/lab/TransitionCard.tsx:22-37` (the finding sentences); `app/book/BookSurface.tsx` and `BookLegacy.tsx` (tile
  labels and subs); `InspectorDrawer.tsx:66`. Owner's list / Plan B.
- **M-7 · "weld" survives in public doctrine.** `verification-view.ts:149` (LIVE_CAPTION "NOT reconcile-welded") and
  `evidence.ts:185,835` ("reconcile-welded"). Fix: "not covered by the reconcile".
- **M-8 · README wording.**
  - `:49` "cmd/indexer the single writer", but riskd writes risk batches (`:55-56`). Make it "the single indexer
    writer".
  - `:25` "a continuous health factor in the pool's 8-decimal base currency": the health factor is a WAD ratio; the
    values are in base currency.
  - Hardcoded counts that will go stale: "(v1.8.0, 17 paths)" at `:79` and `:235`, "the 19 migrations" at `:241`, and
    "four aTokens, four Chainlink feeds" at `:44-45`. Drop them or stamp them.
- **M-9 · The Makefile's run-api comment contradicts the README.** `Makefile:64-67` says "no SOLVENT_RPC_* variable is
  consulted and none is required". That is false (`internal/config/config.go:168-170`, via `config.Load` in
  `cmd/api/main.go:281`), and `README.md:175-177` correctly says the opposite. The file is outside the range, but the
  README sends readers to `make run-api`. Fix the comment.
- **M-10 · "Accounts changing lane 941" sits beside "425 accounts change band"** (`lab-view.ts:50`;
  `TransitionCard.tsx:27`). The Cash page never glosses "lane": its merged axes speak of room bands. This is visible
  in the README's Scenarios screenshot. Owner's list: a title on the tile that glosses "lane".
- **M-11 · Comments name a plan or ruling in files this plan edited.** `activity-rows.ts:1-2` ("plan 2 ruling R12") is
  inside the comment block area E rewrote. `kit.module.css:128,142` ("plan 2") predates this plan. Strip them.

## Checked and clean

- **Seams:** Activity and the Inspector agree on the empty-receipt words ("the run checked no rows · nothing was
  compared"), on record-only ("—" plus "record-only", the title from `RECORD_ONLY_TITLE`), on the type words
  (`typeLabel` / `actionLabel` share one vocabulary; the case difference is deliberate) and on "block time" in place of
  the custody words. "Filter applied" says "all engines", as the Scope chip does. Verification uses "checked rows" on
  every public string; the drawer keeps "gated" once, glossed, and the rejected detail is the page's own. "70,000"
  appears nowhere. "Liquidatable · material" is gone.
- **Laws:**
  - Activity's `/v1/book` scale: `bookEnvelopeFault` judges the book whole before any engine is read. Every scale
    passes `isWireScale`, and the stream wins over the book. A failed read, a withheld or absent engine, or a book with
    no `value_decimals` leaves raw digits tagged, never a refusal (e2e `activity.spec.ts:210-229` covers both the
    no-scale book and a 503). The legacy engine's 8 is never applied to `aave_scaled`.
  - Cash "debt repaid … USD" is true: `cmd/api/p5_events.go:393-396` (USD-6). Legacy "2,500 USDC" takes the row's
    symbol.
  - The Book's none-computed arms refuse every zero, and the legacy line's denominator is computed positions. Cash and
    legacy are never summed. The kit's disabled contrast is 5.2:1 (light) and 7.09:1 (dark).
- **README:**
  - The receipt figures match `drift-report.json`: 30,838 / 30,838 / 0 drift / 699 advisory / pass, the two pins, the
    times and the sha.
  - The CI line is true: the last green `ci.yml` run was 2026-07-30 and every run since has failed.
  - The run block's env, order, make targets, default config paths, open CORS and the cash-v3 commit all check out.
    The styleguide-dependent e2e specs skip without the flag.
  - The screenshots' caption ("Reconnecting", demo data) is true on the three captures I opened.
  - Every cited test, file and decision exists. D-006's wording is paraphrased faithfully.
- **Tests:** No spec lost a test, and 36 of the 38 changed specs gained or kept tests. Every removed assertion I traced
  has a replacement, usually stronger: the record-only pins, the refused-row count, the "0 gated rows" negative (now
  covering both words) and the fold-placement pins. Unit count went 1,081 → 1,119. I found no new law-bearing pin that
  cannot fail.
- **Comments:** No added line names a task, round, review, wave or tool.

## Triage

| Finding | Disposition |
| --- | --- |
| I-1 "never swept" on the Inspector trust card and drawer | fix now |
| I-2 "Cash rows" against "account comparisons" / "checked rows" | fix now |
| I-3 README later-change disclosure (D-006 cl. 5) | fix now |
| M-1 repaid figure decided twice | fix now (small) |
| M-2 three "nothing computed" predicates | Plan B |
| M-3 "$0" / "in all" beside refused accounts | owner's list |
| M-4 History legend "bucket" | fix now |
| M-5 realised / realized | fix now |
| M-6 copy composed in components | owner's list / Plan B |
| M-7 "reconcile-welded" | fix now |
| M-8 README wording and stale counts | fix now |
| M-9 Makefile run-api comment | fix now (outside W3's range only by history; the path is in scope) |
| M-10 "lane" unglossed on Cash | owner's list |
| M-11 plan names in comments | fix now |

## Not verified

- No suite was run and nothing was built. The results for tsc, eslint, stylelint, the build, unit (1,119) and e2e
  (303 plus the re-baselined pins) are the integrator's reports.
- The README run block was not executed on a fresh clone. "`make test` includes one read-only smoke of the live
  database" was not confirmed: several tests read `SOLVENT_DATABASE_URL`.
- The README's approval claims were spot-checked, not exhausted. All ten session ids resolve. I checked the contexts
  for Task 5/6/7/8, pre-receipt round 9, round 39, round 67, round 42, `9ee3207`/round 7 and `e4d9b03`. I did not
  audit the approval status of each of `cmd/api`'s 33 or `cmd/riskd`'s 10 post-approval commits (I-3), nor the claim
  that "every rounding direction is pinned by on-chain integers".
- I opened only three of the seven README screenshots (Overview, Activity, Scenarios). The Book, Inspector, History and
  API captures were not viewed, and no pixel baseline was inspected.
- `lane_changed_rows` semantics beyond the lib's own contract note, and the claim that "49 in all" equals History's
  `liquidatable_positions` for the demo batch, were not re-derived.
- The parallel Codex round's findings (`codex-findings.md`) and the persona re-walk were not read. They were not
  present when I read the folder.
