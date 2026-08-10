# UI Overhaul Phase 1 Track A — Foundation Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ratified foundation canon (`docs/specs/2026-08-09-p1-foundation-canon.html` + decisions) into production code: the closed type token set, the two-grade palette, the width contract, the tiered freshness machinery, the canon appbar (retiring `LIVE · WATERMARKED`), the shared component kit (verdict banner, exact-layer affordance, chips, states), the rebuilt `/styleguide`, and the un-audited-surface convergence pass.

**Architecture:** Token-first: `tokens.css` gains the `--t-*` type set and amended palette while legacy `--fs-*` names survive as re-pointed aliases (floor-lifted to ≥12px), so every existing module re-renders lawfully without a mass rename — the full `--t-*` migration is Phase 3 per-page debt, enforced going forward by stylelint. The header rebuild is ONE migration wave covering both the badge retirement (45 header pin lines) and the tiered chip (~31 pin sites). New components are additive; existing pages keep their DOM until Phase 3.

**Tech Stack:** Next.js app router, CSS custom properties + CSS modules, stylelint (new), Playwright (wave-config pattern), `/v1/meta` constants via `@solvent/client` (`client.meta()` exists, zero web call sites today).

## Global Constraints

- **Authority chain:** the canon HTML + `2026-08-09-p1-foundation-canon-decisions.md` (owner-ratified) govern every value; the extracted build contract at `.superpowers/sdd/2026-08-10-ui-overhaul-phase1-tracka/build-contract.md` is the working index (canon line numbers cited there); `pin-map.md`, `component-map.md`, `shell-map.md` in the same dir carry the scout facts. Where this plan and the canon conflict, the canon wins.
- **All spawned agents `model: 'fable'`;** Serena symbolic tools for code edits; plain Edit for CSS/config.
- **Test-first; mutation kills at their own assertions in isolation;** typecheck + lint (+ stylelint once Task 2 lands) completely clean in every task's verification.
- **Wave config:** `web/tests/playwright.p1a.config.ts`, port **3820** (Task 0), mirror of the p0 config. Full-suite runs at Task 4 (the migration wave) and Task 8.
- **Pin-triage law (program design):** pins broken purely by token/typography value changes are updated/retired with ledger notes; semantic pins must survive. The scouted truth: ZERO pins hard-code token values; the threshold-class pins (chart-spec-v4 AC-54 12px/4.5:1 floors, AC-13 3:1 boundaries) must PASS BETTER after the amendments — if any fails, the new value is wrong, not the pin.
- **Page-surface `LIVE · WATERMARKED` prose is OUT of scope** (inspector proof-takeaway, evidence.ts OPERATIONAL_NOTE, proof serving card): those describe serving semantics, not the header badge; their 11 pins survive untouched. Only the HEADER badge vocabulary retires. Ledger the prose-vocabulary question for Phase 3 solvent-clarity review.
- **Ledger:** `.superpowers/sdd/progress-ui-overhaul.md`, "Phase 1 Track A" section (Task 0 opens it). Commits `feat(web)|fix(web)|test(web): p1a-N …`, staged by name, no Co-Authored-By. Claim lease renewed when doctor asks (isolated commit).
- Track B may interleave landings on main between Track A tasks (same controller, serial commits): every task rebases its red-run baseline on current HEAD, and full-suite counts are recorded as observed, never predicted.

---

### Task 0: Wave config + ledger section

- [ ] Create `web/tests/playwright.p1a.config.ts` (mirror p0 config; port 3820; comment "Phase 1 Track A verification config."). Verify `--list` runs; record the baseline inventory in a new "Phase 1 Track A" ledger section. Commit `test(web): p1a-0 track A wave config on port 3820`.

---

### Task 1: tokens.css migration + width contract

**Files:** `web/app/tokens.css`, `web/app/globals.css`, `web/tests/unit/tokens-contract.spec.ts` (create), `web/tests/e2e/p1a-fixes.spec.ts` (create).

**The change (exact values in build-contract.md §1–§3; canon lines cited there):**
1. Add the closed `--t-*` type set (14 tokens: display 32 / chapter 24 / section 18 / fighead 17 / body 16 / ui 14 / meta 13 / floor 12 / mono-lg 14 / mono 13 / mono-sm 12.5 / mono-floor 12 / stat-lg 28 / stat 21) — theme-invariant block beside the existing `--fs-*` set.
2. Re-point every legacy `--fs-*` token to the nearest `--t-*` var, floor-lifting the four sub-12px tokens (`--fs-mono-sm 11.5→var(--t-mono-floor)`, `--fs-caption 11→var(--t-floor)`, `--fs-label 10.5→var(--t-floor)`, `--fs-badge 10→var(--t-floor)`; `--fs-mono 12→var(--t-mono-floor)` stays 12; `--fs-h1 30→var(--t-display)` 32; `--fs-h2 20→var(--t-section)` 18? NO — `--fs-h2` maps UP to `--t-chapter` 24 per the canon's H2 role; map each by ROLE per build-contract §1's role column, and record every mapping in a comment block + the ledger). Mark the whole `--fs-*` block `/* LEGACY ALIASES — Phase 3 retires these; new code uses --t-* (stylelint-enforced) */`.
3. Palette amendments per the §04 ledger (build-contract §2): `--ink-3` dark `#71868e` / light `#637075`; NEW `--accent-text/--ok-text/--warn-text/--crit-text` (light `#2a7380/#27784d/#8b6219/#ba4136`; dark = the fill values); NEW `--warn-bg` (dark `rgba(208,160,74,.10)`, light `rgba(176,124,31,.08)`); `--term-dim #70838a`. Apply in ALL FOUR theme blocks (light `:root`, dark media, both `data-theme` overrides) — production keeps its light-first + media + data-theme law (canon line 1856).
4. Width contract (build-contract §3): `--shell-max 1180px → 1280px`; `.shell` padding `0 24px 120px`; add stepped `@media` rules (1440→`.breakout` 1340; 1920→shell+breakout 1520; 2560→1680); add `.breakout`, `.prose { max-width: 720px }`, and `.grid12 { display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px }` utilities to globals.css.

**Steps:** (1) failing unit spec `tokens-contract.spec.ts` — parse `web/app/tokens.css` as text (fs read, like `book-charts-copy.spec.ts`'s source-reading precedent) and pin: all 14 `--t-*` tokens exist at their exact px values; no `--t-*` below 12px exists; every `--fs-*` value is a `var(--t-` reference; the four amended palette hexes + the four light `*-text` hexes + `--warn-bg` present in both their blocks; `--shell-max: 1280px`; the three stepped media blocks present. (2) implement. (3) failing e2e in `p1a-fixes.spec.ts`: at a 1920×1080 viewport the rendered `main.shell` width is 1520±1 (getBoundingClientRect), at 1440 it is 1280±1; both themes render `--ink-3` at the amended computed rgb (resolve via getComputedStyle on a probe, compare to the exact rgb of `#71868e`/`#637075`). (4) run the threshold-class guards: `npx playwright test -c tests/playwright.p1a.config.ts tests/e2e/chart-spec-v4.spec.ts` — the AC-54/AC-13 floors must pass (they should pass BETTER; any failure = wrong value). (5) full touched set green + typecheck. (6) mutation kills: (i) revert `--ink-3` dark to `#5f7178` → the e2e rgb pin dies; (ii) drop the 1920 media step → the 1520 width pin dies. (7) ledger (every `--fs-*`→`--t-*` mapping recorded) + commit `feat(web): p1a-1 the closed type set, two-grade palette, and width contract land - 1180 is repealed, nothing below 12px exists`.

---

### Task 2: stylelint — the structural floor

**Files:** `web/package.json` (devDeps + script), `web/.stylelintrc.json` (create), `.github/workflows/ci.yml` (web job step), possibly small CSS fixes.

**The rule (canon lines 71–73, 614–616):** every `font-size` declaration in `web/**/*.css` must be a `var(--t-*)` or `var(--fs-*)` reference (the legacy aliases are lawful until Phase 3 retires them — record this relaxation in the config comment + ledger); literal px/rem/em font-sizes are errors. Plus: no declaration may reference an undefined token (guard against typos) if cheaply expressible; otherwise skip. Implementation: stylelint with `declaration-property-value-allowed-list` for `font-size` (pattern `/^var\(--(t|fs)-/`) — verify the exact rule name/behavior against stylelint docs (Context7 if needed). The canon specimen's own `svg text { font-size: 12px }` convention: production equivalent is a `--t-floor` reference — no literal exemption.

**Steps:** (1) install + config; run `npx stylelint "app/**/*.css" "components/**/*.css"` — expect failures on existing literal font-sizes (scout: modules use tokens consistently, but verify); fix each hit by pointing at the correct token (ledger the list). (2) add `"lint:css": "stylelint …"` script + CI step after `npm run lint`. (3) prove the gate: add a scratch rule with `font-size: 11px`, see stylelint fail, remove it (record as the structural-floor proof — this is the task's mutation kill). (4) typecheck/lint/stylelint clean; commit `test(web): p1a-2 stylelint makes the 12px floor structural - font-size must reference a type token`.

---

### Task 3: freshness tier machinery (pure) + meta constants provider

**Files:** `web/lib/freshnessTiers.ts` (create), `web/lib/meta.tsx` (create — provider), `web/lib/freshness.ts` (retire dead suffix fns), `web/tests/unit/freshness-tiers.spec.ts` (create), touched unit specs for the retirements.

**Interfaces:**
- `freshnessTier(ageSeconds: number, c: TierConstants): "fresh" | "aging" | "stale" | "critical"` with `TierConstants = { pricePollSeconds: number; priceCeilingSeconds: number; dmSweepWorstCaseSeconds: number }`; bounds per the RATIFIED SLA: fresh ≤ 2×poll; aging ≤ ceiling; stale ≤ sweep worst case; critical beyond. Unknown age is NOT an input — callers route the unknown register before calling.
- `TIER_FALLBACK: TierConstants = { pricePollSeconds: 60, priceCeilingSeconds: 360, dmSweepWorstCaseSeconds: 5580 }` — used ONLY when meta is unreachable, and the chip then carries a disclosed `title` ("thresholds from built-in fallback — /v1/meta unreachable").
- `MetaConstantsProvider` + `useMetaConstants(): { constants: TierConstants; source: "meta" | "fallback" }` — one `client.meta()` fetch on mount (abort-guarded, failure → fallback; NO retry loop — meta is static per deploy). Read the exact constants field names from the generated `MetaResponse.constants` schema (`max_set_run_scenarios` sibling fields — `price_poll_seconds`, `price_ceiling_seconds`, `dm_sweep_worst_case_seconds`).
- Retire for real (the p0-5 deferred cleanup — this is the owning task): `ribbonBatchAgeSuffix`, `ribbonBatchAgeUnknown`, `RIBBON_STALE_BATCH_SECONDS`, `ageHours` from `web/lib/freshness.ts` AND their unit assertions (`freshness.spec.ts:86-87,169,172`, `freshness-resume.spec.ts:189`, `freshness-blind-resume.spec.ts:344-349`) — retired with ledger notes, per the owning-task rule. `find_referencing_symbols` proves zero remaining consumers first.

**Steps:** red unit spec (tier boundaries EXACTLY at 120/121, 360/361, 5580/5581 with fallback constants; runtime constants override; fallback source flagging) → implement → green → retirements (specs updated in the same change) → mutation kills: (i) fresh bound `2×poll → 3×poll` dies at the 121s pin; (ii) provider failure path returns meta-source dies at the fallback-source pin → typecheck → ledger + commit `feat(web): p1a-3 freshness tiers are theorems about pipeline constants - runtime-derived, fallback disclosed, dead suffix fns retired`.

---

### Task 4: THE MIGRATION WAVE — canon appbar + tiered chip (badge retirement)

The single biggest pin migration of the program: the header's one-badge vocabulary becomes the canon appbar (build-contract §10): `STREAM CONNECTED` chip | `SNAPSHOT <age> · <TIER>` chip | `BATCH #<id>` chip | `COVERAGE <n>/<n>` chip | "Data status →" popover (raw watermark as-ofs move there). 45 header pin lines in 8 e2e files migrate; ~31 chip sites migrate to the tiered format; the header `SUPERSEDED` badge (zero pins) becomes a `SUPERSEDED` c-warn chip.

**Files:** `web/components/Ribbon.tsx`, `web/components/PostureRibbon.tsx`, `web/components/AppHeader.tsx`, `web/components/ribbon.module.css`, `web/lib/stream-posture.ts`, `web/lib/freshness.ts` (`snapshotChip*` → structured), `web/app/layout.tsx` (mount MetaConstantsProvider), pin files: `shell.spec.ts`, `state-matrix.spec.ts`, `r3/r4/r6/r7-fixes.spec.ts`, `p0-fixes.spec.ts`, `freshness-snapshot.spec.ts`, `stale-since.spec.ts` (verify unaffected), `stream-posture.spec.ts`, `p1a-fixes.spec.ts`.

**Design (canon-exact):**
- New stream vocabulary (`stream-posture.ts`): `STREAM CONNECTED` (accent) / `STREAM CONNECTING` / `STREAM RECONNECTING` (warn) / `STREAM CLOSED` (crit) / `STREAM AWAITING BASE` / `STREAM NO BATCH` — keep the exported-constant pattern so `stream-posture.spec.ts`'s identity pins survive by re-export; the three not-contain-LIVE guards pass free (no new label contains "LIVE"). `RibbonStreamPosture.live: true` arm retires — connection is a chip like any other, tone accent, "never green".
- Snapshot chip: structured — `snapshotChipParts(batchId, ageSeconds, tier): { label: "SNAPSHOT"; age: string; tierWord: string | null }` (FRESH → null tierWord); unknown arm keeps the EXACT existing unknown sentences (the negative pins constrain: tier words contain neither "old" nor "UNKNOWN" — AGING/STALE/CRITICAL comply). Rendered text: `SNAPSHOT 42s` / `SNAPSHOT 4m 12s · AGING` / `SNAPSHOT 18h · STALE`… — NOTE: `humanAge` renders `18h 12m`; canon specimens show compact `18h`. Keep `humanAge` output (precision is house law); ledger the cosmetic divergence. Tier classes per canon chip CSS (c-quiet/c-warn/c-crit outline/c-crit-fill).
- Batch chip `BATCH #18251` (c-quiet); Coverage chip from `posture.batch`: `COVERAGE {answered}/{total} ENGINES` where refused_engines names the withheld (warn variant when <total) — derive total from watermarks length; if derivation is ambiguous in posture data, render the chip only when unambiguous and ledger the gap for Track B's envelope.
- Data status popover: native `<details>`/popover carrying the watermark as-ofs (the current `asOfs` rendering moves inside; the `@25,635,618` payload pins at state-matrix:1096,1149 + r7:495,516,587 retarget INTO the popover — open it in those tests).
- Unavailable branch: `NO SERVABLE BATCH` chip (c-crit) + existing stale-for reading (its pins unchanged); recovered/degraded branches per current PostureRibbon logic, re-skinned.
- `web/app/error.tsx`/RouteRefusal, DegradationBanner: untouched.

**Steps:** (1) red-first: write the p1a-fixes appbar describe (new chips visible per posture state, tier styling classes asserted via class or computed color, popover carries as-ofs, LIVE·WATERMARKED count 0 header-wide) against the current build — red. (2) implement components + vocabulary. (3) migrate the 45 header pins file-by-file (shell.spec regex → new vocabulary regex; each r-fix pin retargeted to the equivalent new-vocabulary assertion — the TEST INTENT survives, only the string moves; every migration ledgered old→new). (4) migrate the ~31 chip sites (exact-text pins get the tier-aware expected strings computed through `snapshotChipParts` + `humanAge`; the r6/r7 local literal constants updated). (5) `stream-posture.spec.ts`: update constant re-exports/labels; identity pins survive. (6) FULL SUITE `npm run build && npx playwright test -c tests/playwright.p1a.config.ts` — record exact counts; typecheck/lint/stylelint clean. (7) mutation kills (3): (i) tier styling never applied (always c-quiet) → dies at the tier-class pin; (ii) LIVE·WATERMARKED string resurrected in the badge → dies at the count-0 pin; (iii) popover omits as-ofs → dies at the retargeted watermark pin. (8) ledger the complete migration table + commit `feat(web): p1a-4 the appbar states each truth separately - stream, snapshot tier, batch, coverage; LIVE·WATERMARKED is retired`.

---

### Task 5: shared component kit (verdict banner, exact affordance, chips, states)

**Files (all create unless noted):** `web/components/VerdictBanner.tsx`, `web/components/ExactValue.tsx`, `web/components/StatusChip.tsx` (the c-* variants + refused-tag + engine-tag as one primitive family), `web/components/states/{Skeleton,EmptyDefinitive,InvalidInput,RefusedCard,UnavailableCard,SupersededCard}.tsx`, one CSS module per family (tokens only), unit + e2e specs (`p1a-fixes.spec.ts` specimens via the styleguide route in Task 6 — THIS task pins pure composition; render pins land with Task 6).

**Contracts (canon-exact; build-contract §4–§8):**
- `VerdictBanner({ variant: "current"|"refused"|"superseded"|"empty"|"partial", answer, qualification, identity: ResultIdentityStrip })` — never renders without the identity strip (throw in dev? no — render a structural refusal naming the missing strip; "the banner never renders without its identity strip" is the RATIFIED law, enforce it); left-border tone per variant; answer at `--t-chapter`.
- `ExactValue({ human, exact, ariaLabel? })` — renders human with dotted underline + ⧉, title=exact, tabindex 0, Enter copies exact (clipboard API, fallback-safe); FORBIDDEN when human === exact (render plain — and dev-warn; the false-scent law).
- `StatusChip({ tone: "ok"|"accent"|"warn"|"crit"|"crit-fill"|"quiet"|"unknown", children, val? })` + `RefusedTag2` (plain cause leads, wire code mono secondary — supersedes the old RefusedTag progressively; existing RefusedTag consumers untouched this phase) + `EngineTag` (mono wire names only).
- State components per the six specimens (build-contract §8) incl. the anti-state law (no dash-as-zero, skeleton reserves geometry, loading holds old result with identity line).

**Steps:** red unit specs (composition: banner refuses without identity; ExactValue forbidden-arm; chip tone classes) → implement → green → 2 mutation kills (banner identity enforcement removed; ExactValue renders affordance when human===exact) → typecheck/stylelint → ledger + commit `feat(web): p1a-5 the component kit lands - verdict banner enforces its identity strip, exactness carries a visible cue, chips speak nine dimensions`.

---

### Task 6: styleguide rebuild

**Files:** `web/app/styleguide/page.tsx` (rebuild), `web/tests/e2e/shell.spec.ts` (styleguide test update), `web/tests/e2e/p1a-fixes.spec.ts` (specimen pins).

Rebuild the page canon-structured: tokens/swatches WITH computed contrast ratios rendered live (compute in the page from resolved styles — honest, not hardcoded), type scale, the nine status dimensions + three compositions (incl. `LIQUIDATABLE · DUST · COMPUTED · SNAPSHOT 18H`), freshness tier row (all five states), verdict banner five variants, ExactValue demo, six state components, table pattern + evidence drawer specimens, the committed chart-convention specimens (keep existing Sparkline/Scatter/WaterfallSteps demos; add the interaction-register demo on one specimen chart: tab-enter/arrow-traverse/readout/aria-details wiring — the reference implementation Phase 3 copies). Keep the `SPECIMEN` banner + gating. Update shell.spec's specimen-section walk to the new section list (ledger old→new). Pins: every section testid visible; the live contrast figures ≥ 4.5 for every text swatch (the styleguide becomes a self-verifying contrast gate); keyboard demo operable (Tab + ArrowRight moves focus ring). Mutation kills: (i) contrast computation stubbed to constant → dies at a deliberately-failing-probe pin (add one known-bad probe pair asserted <4.5 to prove the computation is live); (ii) interaction demo's keydown handler removed → dies at the ArrowRight pin. Commit `feat(web): p1a-6 the styleguide is the living canon - self-verifying contrast, nine dimensions, the interaction register demonstrated`.

---

### Task 7: Track C convergence pass (History, Activity, Proof, Developers)

Verify the four un-audited surfaces under the new tokens/shell at 1366/1440/1920/2560 both themes (Playwright screenshots to the workspace dir + their existing spec files green); fix only breakage (layout overflow, illegible combinations, broken token references) — NO IA changes. Known certainty: their pages inherit the wider shell and floor-lifted small text — check tables/chips that assumed 10.5–11.5px. Every fix ledgered. Existing suites (`observatory.spec.ts`, `feed.spec.ts`, `proof.spec.ts`, `developers.spec.ts`) must pass unmodified unless a pin asserts a pure geometry consequence of the shell width — those update with ledger notes. Commit `fix(web): p1a-7 convergence pass - the four un-audited surfaces hold under the new foundation`.

---

### Task 8: Track A close

Full suite (exact counts), typecheck + lint + stylelint clean, mutation transcript `.superpowers/sdd/p1a-mutations/` (t9w20 format, true counts), ledger seal (complete pin-migration inventory; the `--fs-*` alias debt; the humanAge-vs-canon cosmetic divergence; the coverage-chip derivation note; prose-vocabulary question for Phase 3), commit `test(web): p1a-8 track A close`, then the controller runs the Codex adversarial round (context: the canon as the contract, the appbar migration as the attack surface — vocabulary consistency, tier arithmetic, pin-migration fidelity, contrast claims).

---

## Self-review notes (applied)

- Canon obligations → tasks: type set + stylelint (1,2), palette (1), width (1), tiers runtime-derived (3), appbar/badge retirement (4), verdict banner + exact affordance + chips + states (5), styleguide + interaction register reference (6), convergence (7). Engine-separation/number-law/chart-form obligations bind Phase 2/3 surfaces, not Track A code — recorded in the ledger as forward law.
- Pin arithmetic: T4 carries 45+31 migrations with per-file steps; T1 carries zero (verified); T6 updates the styleguide walk; T7 conditionally touches geometry pins.
- Deliberate scope-outs: page-surface LIVE·WATERMARKED prose (kept), full `--fs-*`→`--t-*` module rename (Phase 3 debt), RefusedTag replacement across pages (Phase 3), chart primitive library (Phase 3 builds against the styleguide reference).
