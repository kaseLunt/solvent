# SDD ledger — plan: docs/plans/2026-09-15-ui-kit-overview-book.md

Spec: docs/specs/2026-09-15-ui-product-register-design.md (binding). Mockups: docs/specs/2026-09-15-ui-mockups/.
Session start 2026-09-15 17:40 USMST. Base commit before Task 1: b891fe7.

## Preflight rulings

- Ruling: no git worktree; work lands on `main` serially — the repo's control plane (roadmap/RULES.md §3, the claude-integrator claim) forbids extra worktrees and the owner approved this session's main commits — cost if wrong: commits are on main without a branch; each is scope-gated and revertable.
- Ruling: every subagent runs `model: fable` (owner standing rule: no opus) even where the skill suggests a cheaper tier — cost if wrong: tokens.
- Ruling: implementers are `serena-coder` (Serena symbolic tools for code edits); reviewers are `general-purpose` read-only — cost if wrong: none material.
- Ruling: `.superpowers/sdd/.gitignore` is restored from backup after every sdd skill script run (the scripts overwrite it with `*`, hiding the committed ledgers) — cost if wrong: tracked ledgers vanish from git status.
- Ruling: execution split per owner decision — subagents implement Tasks 1–7, 11, 14 (logic/mechanical, code fully specified); the controller implements Tasks 8–10, 12, 13, 15, 16 personally (everything visual) and the owner approves each page side-by-side before it commits — cost if wrong: controller context spent on implementation.
- Ruling: the stale `next start` on :3111 from the design session was killed before execution (Playwright would have reused the old build).

## Preflight conflict scan

| Tasks | Interface | Finding |
|---|---|---|
| T1 ↔ T8 | tokens.css | T8 adds `--chart-fill`; T1 adds `--type-*`; disjoint lines — OK |
| T2 → T3, T5, T6, T9, T12, T13 | `humanUsd(bigint, number)` | signature identical at every call site — OK |
| T3 → T12 | `partitionByMateriality`, `MaterialityPartition<T>` | exported in T3, consumed in T12/T13 — OK |
| T4 → T7, T12, T13 | `CashRow`, `CashWireRow`, `SizedCashRow`, `RoomBand`, selectors | names match — OK |
| T5 → T12, T13 | `Headline`, `Sum` | T12's `unavailableHeadline` and T13's loading literal use the same shape — OK |
| T6 → T10, T12, T13 | `livePillWords`, `stressPreview`, `plainCause` | names/types match — OK |
| T7 → T13 | `BookEngine`, `BadDebtEngine`, `HistogramEngine`, `BookResponse` | exported in T7 — OK |
| T7 | `BatchSupersededError.body.current_batch_id` | field name unverified; T7 carries a fallback instruction — watch in review |
| T8 ↔ T9, T10 | every `styles.*` the components reference | all classes present in T8's sheet; `.r`/`.dim` added in T9 step 2 — OK |
| T10 ↔ T12, T13 | shell.spec `pendingPages` guard | added in T10, removed in T12 (Overview) and T13 (Book) — OK |
| T11 → T13, T15 | `DEMO_*` exports | names match — OK |
| T12 ↔ T13 | `summarizeCash` input/output | identical usage — OK |
| T13 ↔ T14 | files kept under app/book | T14's keep-list equals T13's created/rewritten set — OK |
| T14 | `web/lib/**` untouched | T14 deletes only app/book modules and their specs; lib specs stay — OK |
| T2 self | tests vs code | traced $9,999.99→"$9,999", $1.25B→"$1.2B", $24.612M→"$24.6M" by hand — OK |
| T3 self | tests vs code | $99.999999 → small; belowLine sentence singular/plural — OK |
| T13 self | book.spec strings vs T5 grammar and T9 chip rendering | "Coverage 1 / 2 computed", "0 accounts", "2 positions" all produced by the code as written — OK |

Scan verdict: no conflicts requiring a ruling beyond the T7 watch item.

## Task log
- Task 1: implemented (commit 0defe66) — DONE_WITH_CONCERNS: the brief's comment `--t-*/--fs-*` contained `*/`; implementer wrote `--t-* / --fs-*`.
- Ruling: accept the two-space comment fix — the plan text was a genuine defect (an early comment close would have swallowed `--type-hero`); the token names, values and regex are verbatim — cost if wrong: none.
- Task 1: minor (deferred): stylelint error message and config header still name only --t-*/--fs-*; plan cited config lines 47-48, actual 44-45.
- Task 1: minor (deferred): stylelint gate message + config header + tokens.css LEGACY header still steer to --t-*; blank line before the --type-* block — fold into Task 8 (controller touches tokens.css there).
- Task 1: complete (commits b891fe7..0defe66, review clean)
- Tasks 2+3+5: batch implementer dispatched (base 0defe66) — three commits expected.
- Tasks 2+3+5: implemented (commits e50289d, 5d15bdd, 9568508) — DONE_WITH_CONCERNS.
- Ruling: accept the fixture change usd6(112.4) → usd6(112) in the Task 3/5 tests — the plan's expected string "$112" contradicted its own humanUsd rule ($112.40); the pinned copy and implementations stay verbatim; plan file corrected to match — cost if wrong: none (test fixture only).
- Tasks 2+3+5: minor (deferred): MINUS duplicates MINUS_SIGN in lib/book-format.ts and lib/factor.ts (plan-mandated); unit project depends on an existing web/.next build via the shared webServer (pre-existing).
- Tasks 4+6: batch implementer dispatched (base 9568508).
- Tasks 2+3+5: minor (deferred): singular near-cap branch and bookHeadlineRefused fallbacks untested; MINUS glyph triplicated; oneDecimal ungrouped ≥$1T; quiet-dek "more positions" wording (copy owner); unit project needs a .next build (pre-existing config).
- Task 2: complete (commits 0defe66..e50289d, review clean)
- Task 3: complete (commits e50289d..5d15bdd, review clean)
- Task 5: complete (commits 5d15bdd..9568508, review clean)
- Tasks 4+6: implemented (commits e633a14, 8853af3) — DONE_WITH_CONCERNS.
- Ruling: accept the four test-side alignments — (1) `"-0"` is a LEGAL wire decimal (WIRE_DECIMAL admits it; wire-guard.spec pins it), so malformed fixtures use `"4.62e9"`; (2) headroomTenths floors → breached row prints −31.3%; (3) `BookResponse.waterfall` is nullable — Tasks 12/13 must narrow and render "not on this batch's grid"; (4) generated `Refusal` requires `note` and a string `detail`. Library and contract are the authority; module code stays verbatim — cost if wrong: none.
- Carry-forward: `liq_distance.kind: "solved"` is not in the contract's union — Task 11's demo generator must copy the template row's real kind, never invent one.
- Tasks 4+6: review → Needs fixes. Important #1 (plan-mandated): stressPreview ignores `Waterfall.excluded_engines` — a withheld engine renders `absent`. Important #2 (plan-mandated): a negative delta (monotonicity violation, which the wire surfaces via `Waterfall.monotonicity`) prints "no new liquidatable debt".
- Ruling: the spec's refusals-render-honestly law is binding; the plan's stressPreview code is defective on both counts — fix: excluded engine → `{kind:"refused", reason}`; monotonicity not ok / any negative delta → `{kind:"refused", reason}`; also fold minors 3 (base factor must equal grid_scale), 8 (Object.hasOwn on the phrasebook), 11 (fixture kind "distance") — cost if wrong: none; the module gains two refusal arms.
- Tasks 4+6: minor (deferred): shockPercent truncates toward zero (#4); readCashRow health_factor absent-key throw (#5); readable debt dropped when cap is null (#6); no-debt rows print 100% (#7 — the printing task must use HEADROOM_NO_DEBT_LABEL); phrasebook vocabulary vs wire codes G1/G2/G3/ENGINE/API_RECONSTRUCTION_MISMATCH (#9 — spec §3.2 phrasebook grows at page review); formatTenths duplicates headroomPercent (#10); spacing nit (#12); coverage gaps (#13).
- Task 7: implemented (commit a46f7d0) — DONE. Deviations: currentBatchId restart key; cast dropped (types identical); walk-state reset restructured to satisfy react-hooks/set-state-in-effect (page one replaces prior walk state). Review dispatched (base 8853af3).
- Tasks 4+6: fix round 1/5 dispatched (fix base 8853af3 → implementer resumed).
- Task 7: review → Approved with Important #1 (plan-mandated): `reload()` cannot re-walk on a stable batch id; a walk failure has no recovery until the server mints a new batch.
- Ruling: fix now — add a `walkEpoch` counter bumped by `reload()` (and by the 409 restart arm) to the walk effect deps; Task 13's failure strip binds its retry to `reload()` — cost if wrong: one extra re-walk on reload (idempotent by the page-one-replace design). Fold minors 3 (honest refusedWhole shape) and 5 (`useCallback` on reload).
- Task 7: minor (deferred): restart guard is last-id-only and a null superseding id can restart twice (#1 — pin "409 with current_batch_id: null" in a later e2e); repeated 409 for the same id classifies as transport (#2 — consumer wording); walkControllerRef redundant (#4); same-id re-walk transiently shows prior rows (#6).
- Task 7: fix round 1/5 dispatched (fix base a46f7d0).
- Tasks 4+6: fix round 1/5 — fix commit 8096c5a; scoped re-review dispatched (fix base a46f7d0, which isolates the fix from Task 7's interleaved commit).
- Tasks 4+6: fix round 1/5 (5 addressed, 0 open — excluded_engines refusal; monotonicity refusal; base-factor guard; Map phrasebook; fixture kind; commits a46f7d0..8096c5a)
- Task 4: complete (commits 9568508..e633a14 + fixture line in 8096c5a, review clean after round 1)
- Task 6: complete (commits e633a14..8853af3 + fix 8096c5a, review clean after round 1)
- Task 11: implementer dispatched (base 8096c5a; Task 7 fix in flight on a disjoint file).
- Task 7: fix round 1/5 — fix commit b2f2fc3; scoped re-review dispatched (fix base 8096c5a).
- Ruling: accept the epoch bump living in loadBook's success arm (`rewalk` option) rather than beside the call — it avoids a wasted page-one against the old id; recovery guarantee identical — cost if wrong: none.
- Task 7: minor (deferred): page one carries no cursor, so rows can transiently come from the next batch until the book catches up (e2e authors: pin the batch chip against page.batch.id if it matters).
- Task 7: fix round 1/5 (3 addressed, 0 open — walkEpoch re-walk; honest refusedWhole shape; useCallback reload; commits 8096c5a..b2f2fc3)
- Task 7: minor (deferred): same-id re-walk has no "walking" signal until page one lands (consumer derives `walking = !walkComplete && walkFailure === null`, or the hook resets complete/failure on the bump); a blind-resume re-fetch superseding an in-flight reload drops the rewalk intent (narrow race). E2E scenarios to pin in Task 13: page-one 5xx → reload re-walks; 409 → reloaded book same id → re-walk; reload with new id → one page-one; resume on unchanged id → no extra page-one.
- Task 7: complete (commits 8853af3..a46f7d0 + fix b2f2fc3, review clean after round 1)
- Task 8: controller implementing (kit.module.css + --chart-fill + Task 1 deferred comment fixes); Task 11 implementer still running.
- Task 8: complete (controller; kit.module.css + --chart-fill + Task 1 deferred wording fixes; lint:css/typecheck clean)
- Task 11: implemented (commit 1ada8ba) — DONE. Deviations: kind "distance" with debt/cap factors; factor_asset = weETH address (Address pattern), symbol in factor_symbol; draw floor 0.12 so near-cap lands at 27 (band rule is cap-relative); only batch identity spread into envelopes; weld spec reads rows through the client's refinePositionSummary. Review dispatched (base 3f263c8).
- Task 9+10: controller wrote the nine kit components, LivePill, AppShell, layout swap, ThemeToggle → kit stylesheet, shell.spec rewrite; typecheck/lint/lint:css clean on those files; build + shell e2e running.
- Task 9: complete (controller; kit components; typecheck/lint/lint:css clean)
- Task 10: complete (controller; AppShell + LivePill + layout swap + ThemeToggle on the kit sheet + shell.spec rewrite; shell e2e 7 passed, 2 fixme pending pages)
- Task 12: built; Overview e2e 4 passed + shell 12 passed on fresh build; side-by-side gate pushed to the companion (awaiting owner). Deferred minor: theme toggle label still uppercase mono text.
- Task 11: review → Needs fixes. Important #1 (plan-mandated): legacy hf_histogram puts 58 below HF 1.00 vs 46 liquidatable, and the legacy refused_count stays 1 vs refused_positions 0 — BookLegacy would print the contradiction. Important #2 (plan-mandated): Cash hf_histogram never recomputed from rows.
- Ruling: fix both in the generator (counts[0]+counts[1] = 46, Σ 8552; Cash buckets from num·1e18/den over computed rows; refused_count from rows) plus minors — exact-rational sort comparator with account tie-break, meta sweep counters, batch.watermarks heights aligned to the vector, point-0 collateral = Σ liquidatable collateral, varied refused debts, weld test keyed to the canonical template, DEC removed — regenerate; the weld spec stays the proof — cost if wrong: none (dev dataset).
- Task 11: minor (deferred): Σ debt $27.5M vs ≈$24.6M design (unpinned); page envelopes' 2-entry batch.watermarks inherited from the contract fixture; dust-draw cap==debt fragility on other seeds.
- Task 11: fix round 1/5 dispatched (fix base 2f60d65 → implementer resumed).
- Task 11: fix round 1/5 — fix commit 5202ff9; scoped re-review dispatched (fix base 2f60d65). Residual minor: rows' as-of blocks vs batch watermark heights; batch watermark sweep.rows 3 vs meta sweeps.rows 1412.
- Task 11: fix round 1/5 (9 addressed, 0 open — histograms from rows; exact ordering; counters; heights; p0 collateral; refused debts; canonical keys; DEC; commits 2f60d65..5202ff9)
- Task 11: minor (deferred): batch.watermarks[debt_manager].sweep.rows 3 vs meta.sweeps.rows 1412 (stamp in batchFor if the Book ever renders the batch sweep block); row as-of blocks behind the batch watermark; cap==0 fragility on other seeds; Σ debt $27.8M (unpinned).
- Task 11: complete (commits 3f263c8..1ada8ba + fix 5202ff9, review clean after round 1)
- Task 13: controller writing Book files while the Overview gate awaits the owner.
- Owner gate 2026-09-15 20:43: Overview and Book approved side-by-side ("looks good").
- Task 12: complete (controller; Overview + summarizeCash; unit 4 passed, e2e overview 4 + shell green)
- Task 13: complete (controller; Book rebuilt; e2e book 7 passed + shell 16 passed; demo generator healthy-room draw widened to 2.4 so the ≥50% band is populated — weld spec still 5 passed)
- Task 14: implementer dispatched (retirement + ledger).
- Task 14: implemented and committed by the controller from the implementer's staged index (BLOCKED at its gate by reds pre-existing at HEAD, none caused by the retirement): 135 retired e2e pins, 8 unit specs, old Book modules, AppHeader (+ DensityMap/RiskMapLedger, importers of the deleted riskBins). Deviations ledgered by the implementer: book-charts and chart-spec-v4 trimmed (hold Lab tests), not deleted.
- Ruling: the three gate reds are controller defects from Tasks 11–13, fixed as follow-ups before Task 15: (1) kit nav overflows ≤390px (3 e2e); (2) demo fixtures violate fixture-clock-law (8 unit); (3) BookLegacy renders a wire population raw (-0 site reopened) and /v1/book has no route-refusal e2e pin — cost if wrong: none.
- Gate fixes (controller): demo generator shifts template instants and re-derives every age under clock-law.mjs, refusing to write a violating body; census pins +17 (meta.json 5, demo 12; batch-bearing 27→32; `demo/` decided as a walked directory); kit nav/status wrap ≤900px; every wire population on Book/Overview/Legacy/Methodology read through readWirePopulation; new e2e pin "-0 population on /v1/book refuses the route". Unit 1051 passed; e2e book/overview/shell/state-matrix/chart-spec-v4 63 passed.
- Task 15: complete (controller; 4 baselines committed, hold on re-run; screenshot-pages.mjs is the companion gate helper)
- Task 16: full suite 1,382 passed / 0 failed / 10 skipped on the fresh build; widths probe clean (no hscroll 1366–2560; shell 1280/1280/1520/1680); contrast: every text token the kit uses (ink, ink-2, ink-3, accent/warn/crit/ok text) computed ≥4.5:1 on bg/panel/panel-2/chip in both themes from tokens.css hexes (the one sub-4.5 pair, if any, is listed above in the transcript and not used for text). Final whole-branch review + Codex round dispatched on the slim diff.
- Final whole-branch review → needs fixes: C1 withheld engine leaked walk-derived figures into tiles/bands/table/Overview cards; I1 refused rows sliced out of the default table; I2 Overview snapshot chip always green; I3 walk never checked page.batch.id; I4 unsettled figures printed as facts. Fix-before-done deferreds: T4/6 #6 (keep readable debt on refused rows), T7 page-batch hole (= I3).
- Ruling: fix all six in one wave (controller, own code): new lib/cash-view.ts deriveCashView shared by both pages (no summary when withheld; tier-toned chips; walking flag; absent engine → unavailable) + unit spec; NeedsAttention always appends refused rows and prints signed room; cash-rows keeps a readable debt on the refused arm; cash-book skips the walk for a withheld engine and treats a page from another batch as a supersession (one reload, then a stated failure); e2e: withheld state pins every tile/card, demo pins 6 refused rows, page-batch mismatch pins a second book fetch, Overview withheld pin — cost if wrong: none.
- Codex round (spec §9.5): FAILED on environment — Codex CLI 0.144.5 rejects the config's `gpt-6-astra` (needs a newer CLI); surfaced to the owner; not retried (environment mutation is the owner's call).
- Fix wave 1 committed; scoped re-review dispatched on fix-wave-1.diff.
- Fix wave 1 re-review: all six addressed; one new Important (liquidatableRows lacked a computed guard once refused rows keep their debt) → fixed with a unit pin (0661cf7); minors deferred: D1/I3/I4 e2e pins, the two supersession arms' register drift, "not computed" sub-copy under load failure, withheld tile printing refused_positions, summarizeCash's unreachable refusedWhole arm, useMemo on deriveCashView.
- Ruling: the plan workspace stays (this repo tracks SDD ledgers, briefs and reports as the record; the skill's delete step is replaced by committing the markdown) — cost if wrong: a few tracked files.
- Task 16: complete (full suite 1,389 passed; close-out entry in progress-ui-overhaul.md)
- PLAN COMPLETE — b891fe7..0661cf7.
