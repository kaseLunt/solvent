# Foundation canon — synthesis decisions (2026-08-09)

Final canon: `.superpowers/sdd/phase1-canon/final-canon.html` (self-contained, theme toggle, full Track A coverage).
Awaiting owner ratification (styleguide approval + the five open questions below).

## Winner

**draft-editorial**, on aggregate judge scoring (design-taste 8, information-clarity 8.5, cold-visitor 8.5;
instrument 7/8/8; restraint 8.5/7.5/n.r.). Its skeleton — the finding-first house frame (kicker → 17px
finding-headline → STATE → plot → exact ledger → method, chart-spec v4's slots), conclusion headlines,
annotation-at-the-proof, the middot status sentence — is the structure that *enforces* the house laws rather
than exhibiting them. The design-taste judge's restraint pick is honored as the welded-dataset discipline:
every specimen number in the final derives from one shared fictional dataset and reconciles everywhere.

## Grafts taken

From **instrument**: two-grade color architecture (text grade ≥4.5:1 on worst ground incl. chip-bg;
fill/glyph grade ≥3:1 keeping light chart chroma); amendment ledger format (Token/Was/Amended/Worst-ground/
Ruling); refused table cells printing the word *refused*; anti-state ("never render") panel; comp-read
captions under every status composition; freshness provenance kv with file:line citations; mono wire-name
engine tags (`aave_v3` / `debt_manager`) as the only engine identity; mono-marks-exactness doctrine;
gate-conformance self-audit; freshness chips carrying tier word AND age.

From **restraint**: zero-is-an-answer Case/Rendered/Meaning table; app header strip retiring
LIVE·WATERMARKED; rendered result-identity line + RESULTS FOR PREVIOUS INPUT; single Tier/Bound/Render/Why
SLA table; the honest glyph vocabulary (computed-zero flat tick, open dust marker with printed value, words
for NOT COVERED, broken lines for gaps, hatched refused strips, muted printed zeros in the heatmap); the
fully-welded shared demo dataset discipline; flat data surfaces (elevation only on overlays).

From **editorial** (beyond the skeleton): the in-plot REFUSED scenario row; evidence-drawer summaries that
state a finding plus a count; the codified minimum residual glyph — now a stated number, **1.5px**, drawn in
specimens.

## Judge-flagged defects fixed

- Editorial's false 9.4 weld → transition matrix rebuilt from the shared dataset; row/column sums reproduce
  the distribution exactly (Σ 8,412 · moved 390 · unchanged 8,022 · 2 crossers, Σ debt $159,102.114093).
- Editorial's 11px badge / 11.5px chips → closed type token set with no sub-12px member; stylelint rule
  (font-size must be a `var(--t-*)` reference) makes violation structural, not disciplinary.
- Editorial's solid-amber PROJECTION fill → dashed amber outline naming scenario + config version; fills
  rationed to the critical escalation register (critical HF, critical age) only.
- Editorial's term-dim 4.19:1 → `#70838a` (4.54 on the worst term ground `#10181b`; 4.86 on `#0a0f12`).
- Uppercase-mono chip shout (editorial) → sans chips; mono survives inside chips only for verbatim values.
- Card box-shadows on data surfaces (editorial) → flat; `--shadow` lawful on overlays only.
- Instrument's false C2 headline (93% vs bars summing 91%) and 8,740-vs-8,742 heatmap → every headline in the
  final is recomputed from the drawn data and welded in the printed ledger.
- Instrument's signed "Boundary distance −34.9%" on a HEALTHY row → distance in words, one definition per
  engine ("53.9% above boundary" / "headroom $0.31 · 0.8% of cap").
- Instrument's thin result-identity treatment → restraint's full contract rendered.
- Restraint's 11.5px in-chart text → all SVG text ≥12px (CSS default on `svg text`, no overrides below).
- Restraint's breakout formula (~1318px at a 1366 viewport) → max-width stepping (1280 → 1340@1440 →
  1520@1920 → 1680@2560).
- Restraint's 14px `.answer` caption + topic-label-first order → 17px finding-headline leads every fig.
- Restraint's ground-mixed appendix ratios → every printed ratio computed and names its ground.
- Restraint's sans AAVE/DM chips → mono wire names.
- All three: wire refusal codes led the chips → plain cause leads ("REFUSED · sweep failed twice"), wire code
  quoted mono, secondary, repeated in evidence.

**One judged graft overridden by arithmetic** (recorded in §14): restraint's light text hexes
(#2c7785/#297c50/#906519/#c04338) certify only against panel-2 (4.51–4.56) and fail on chip-bg (4.29–4.33);
the text grade adopts instrument's hexes (#2a7380/#27784d/#8b6219/#ba4136 — 4.52–4.56 on chip-bg).

## Invented (all three drafts lacked them)

1. **Verdict banner** — the page-answer component behind the brief's first acceptance gate: computed finding
   + named denominator · qualification · identity strip (batch · age · coverage · current/projected ·
   evidence), with refused / superseded / empty / partial variants. Banner never renders without its identity
   strip; degraded data switches variant.
2. **Exact-layer affordance** — dotted underline + copy glyph on any human value whose exact string differs;
   hover/focus reveals, Enter copies; mandatory where human ≠ exact, forbidden where already exact.
3. **Chart interaction register** — pointer readout of exact strings; keyboard: Tab enters, ←/→ traverse
   marks, Home/End, Enter opens evidence, Esc exits; focused mark wears a 2px accent ring with persistent
   readout; each chart's LEDGER is its concise tabular twin (`aria-details`), METHOD is `aria-describedby`.
4. **Closed type token set** — 32/24/18/17/16/14/13/12 sans + 14/13/12.5/12 mono + 28/21 stat; no token
   below 12px exists; production stylelint enforces token-only font sizes.
5. **One-dataset weld discipline** — batch #18251, Aave book $22.8M / DM $412.7K; 9,964 on book = 9,958
   computed (8,412 qualifying + 1,546 no-comparator) + 6 refused; welds printed in the fig ledgers.

## Freshness SLA (encoded ratified-pending-owner)

Provenance constants (file:line cited in §06): `price_poll_seconds=60` (D-012), `price_budget_seconds=180`,
`price_ceiling_seconds=360` (past it: REFUSED, never served stale), `dm_sweep_worst_case=5580`; riskd cadence
event-driven (2s vector poll + forced budget/ceiling passes).

| Tier | Bound | Render |
|---|---|---|
| FRESH | age ≤ 120s (2×poll — two-sample rule) | measured ink, no signal, **no green** |
| AGING | 120s < age ≤ 360s (price ceiling) | amber text + border, tier word + age |
| STALE | 360s < age ≤ 5,580s (DM sweep worst case) | coral **text only**, no fill |
| CRITICAL | age > 5,580s (slowest lawful cadence) | coral + fill — the incident register, shared only with critical comparators |
| AGE UNKNOWN | not a tier | unknown register (dashed), never any tier's color |

Age always prints beside the tier word (survives grayscale/color-blindness). **Until the owner ratifies with
the styleguide approval, ages render without severity styling.**

## Palette amendments to production tokens.css (§04 amendment ledger)

- `--ink-3` dark `#5f7178→#71868e` (4.53), light `#8a979c→#637075` (4.51) — captions/ornament only; never a
  value/state/finding; never on chip or tinted grounds; refused-row text is always `--ink-2`.
- New light text grade: `--accent-text #2a7380`, `--ok-text #27784d`, `--warn-text #8b6219`,
  `--crit-text #ba4136` (all ≥4.52 on chip-bg). Light fills keep canon chroma
  (`#2e7d8c/#2e8c5a/#b07c1f/#c24438`, ≥3:1 non-text). Dark: text grade = fill grade (already passes; worst
  crit-on-chip 4.54).
- `--term-dim #6b7d84→#70838a` (4.54 worst ground).
- New `--warn-bg` state fill (dark rgba(208,160,74,.10); light rgba(176,124,31,.08)) for refused tags.
- Dark palette otherwise verbatim — the observatory identity survives.

## Open owner questions (max 5 — verbatim in final-canon.html §14)

1. **Freshness SLA ratification.** The tiers (FRESH ≤120s · AGING ≤360s · STALE ≤5,580s · CRITICAL beyond ·
   AGE UNKNOWN as a register) are encoded ratified-pending-owner; until ratified, ages render without severity
   styling. Ratify the bounds, or amend them?
2. **Light-theme two-grade palette.** Ratify the parallel *-text tokens (text ≥4.5:1) beside the
   chroma-keeping fill tokens — or collapse to single darkened tokens (simpler API, muddier light-theme
   charts)? The canon recommends the split.
3. **The chart interaction register (10.0) is invented in this canon** — no draft carried it and no mockup has
   exercised it. Approve it as binding for Phase 3 builds, or commission a dedicated interaction mockup round
   first?
4. **Refusal plain-cause phrasebook.** Chips now lead with a plain-language cause and quote the wire code
   secondary. Each wire code needs one owner-approved sentence (e.g. sweep_failed_no_success → "sweep failed
   twice"). Approve the phrasebook mechanism and its initial entries?
5. **Verdict-banner grammar as the binding page-answer contract.** §01's grammar (computed finding + named
   denominator · qualification · identity strip, with refused/stale/empty/partial/superseded variants) would
   become the acceptance-gate test for all three pages. Ratify it as the contract?

## Owner ratification (2026-08-09, in-session)

1. Freshness SLA tiers: RATIFIED as encoded (FRESH <=120s / AGING <=360s / STALE <=5580s /
   CRITICAL beyond / AGE UNKNOWN as register; runtime-derived from /v1/meta constants).
   Severity styling is now AUTHORIZED - the Phase 0 "ages render without severity" interim ends
   when the Track A build lands the tiered chip.
2. Light-theme palette: two-grade split RATIFIED (*-text tokens >=4.5:1 beside chroma fills >=3:1).
3. Chart interaction register: APPROVED AS BINDING for Phase 3 builds; Phase 2 page mockups
   must exercise it per chart.
4. Verdict-banner grammar: RATIFIED as the binding page-answer contract and acceptance-gate test.
5. Refusal plain-cause phrasebook: mechanism approved by default; initial entries reviewed and
   refined at each page-mockup review.

This document + 2026-08-09-p1-foundation-canon.html are the committed foundation canon.
Phase 1 Track A implementation and all Phase 2 page mockups compose from it.
