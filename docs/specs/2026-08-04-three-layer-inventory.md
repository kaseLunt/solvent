# Three-layer restructure inventory (70 surfaces)

Hazard entries are Solvent law: content listed there must never move inside a collapsible.

## Root route (/) — redirect only

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\page.tsx
- current: No layers at all: a bare `redirect("/book")`. There is no landing surface, so the app has no place to carry a product-level takeaway.
- restructure: No restructure. Consequence for the rollout: /book's head is the app's ONLY opening takeaway, so the Book head (below) must carry a complete verdict sentence — nothing upstream will.
- HAZARDS (never collapse): None.

## Global chrome — AppHeader + PostureRibbon + Ribbon primitive

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\AppHeader.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\PostureRibbon.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\Ribbon.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\ribbon.module.css
- current: Layers 1 and 2 are fused into one chip row and layer 3 rides inside the badge. The badge is the visual answer (LIVE · WATERMARKED, or the stream's own word); the watermark VECTOR (per-engine `@block`, per-engine sweep age) is an exact ledger rendered inline at chip size; the batch-age suffix and the age-UNKNOWN refusal are methodological disclosure crammed into the same badge. There is no takeaway sentence — the reader assembles posture from three registers of chip text.
- restructure: Takeaway line: the badge itself (stream posture word) plus the batch-age clause, kept as one reading. Visible: SUPERSEDED chip, NO SERVABLE BATCH badge, the stale-since reading, the age-unknown clause, and a COUNT of watermark entries ("2 engine marks"). Forensic expandable: the per-engine as-of rows and sweep ages, behind a hover/popover rather than a `<details>` (this is global chrome on every route). The header must never be the only place a surface's posture is stated.
- HAZARDS (never collapse): SUPERSEDED chip, NO SERVABLE BATCH badge, `ribbon-stale-since` / `ribbon-stale-unknown`, and `ribbon-batch-age-unknown` are all refusal/supersession/outpaced-class content — none may enter the popover. The `posture.live` gate (R7) means the green chip is itself a claim; collapsing the stream word into an icon would re-open that defect.

## Global chrome — DegradationBanner

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\DegradationBanner.tsx
- current: Single-layer by construction: a full-width strip that renders ONLY while something is degraded — UNAVAILABLE (with the server's reason + staleness + last good batch), DEGRADED (superseded legs + withheld engines with codes), or RECONNECTING. No ledger, no method line, no expandable.
- restructure: It already IS the takeaway layer for degraded posture. Add one visible method clause ("current posture only; posture is never replayed") and stop there. Nothing on this component becomes expandable, ever. Surfaces must not duplicate it (BookSurface and ObservatorySurface already document that they do not).
- HAZARDS (never collapse): The entire component is refusal/supersession content. It must never be collapsed, never be deduped against a surface-local refusal strip, and never be moved below the fold.

## Shared primitive — Stampline / StampItem (Book, Inspector, Proof, Observatory, Lab all build one)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\Stampline.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\primitives.module.css, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookSurface.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabBatchStamp.tsx
- current: Pure layer 2 + 3: a mono footer strip of label/value pins (batch, marks, gate posture, coverage, key, receipt). No takeaway. Critically, the strip MIXES neutral pins (batch id, marks vector, config version) with refusal-class pins (gate `withheld: …`, coverage `partial · N excluded, M withheld`, `SUPERSEDED`, receipt `REJECTED`), all at identical visual weight.
- restructure: Make the stampline the canonical forensic container at the foot of each surface, with a per-item `keepOpen` flag. Takeaway line: none needed (the surface head owns it). Visible: every item whose tone is warn/crit, rendered inline. Expandable: the neutral pins behind a one-line summary that COUNTS what it hides ("4 evidence pins"). This makes one primitive change serve five surfaces.
- HAZARDS (never collapse): gate `withheld: …`, coverage `partial · …`, `marks … sweep⚠`, posture SUPERSEDED, receipt REJECTED/absent must all be keepOpen. A stampline that hides a withheld-engine gate behind a summary is exactly the collapse the law forbids.

## Shared primitive — StatCard

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\StatCard.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\readingLines.ts
- current: Three-slot card (label / value / sub) where `sub` is a single string carrying denominator AND method AND sometimes a second number. `liquidatableCardSub` packs "of computed positions, engine's own comparator · Σ eligible debt $X" into one sub — denominator, comparator disclosure and an exact Σ in one dim line.
- restructure: Split the slot: `sub` becomes denominator-only ("N/M positions counted"), and a new optional `method` slot takes the comparator clause. The Σ moves up into the section takeaway sentence where it is actually read. The card's value stays the visual answer.
- HAZARDS (never collapse): A card whose value is EM_DASH with sub "withheld, no number served" is a refusal rendered as a card — that sub can never move into a `method` slot that a design might collapse. Keep withheld cards single-layer.

## Shared primitive — DataTable + LoadMoreFooter

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\DataTable.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\table.module.css
- current: Layer 2 only, by design. No takeaway slot exists. `empty` is a REQUIRED prop precisely because an empty table must state its reason — so the primitive already refuses silence. `footer` receives one compressed accounting sentence from each caller.
- restructure: Add an optional `takeaway` node rendered above the sticky header and an optional `method` line below it; keep `empty` and `footer` exactly as they are. This lets every table caller (Book positions, Book bad-debt, Lab tables, Feed) adopt the three-layer shape without each re-inventing the slot.
- HAZARDS (never collapse): `empty` strings carry engine-withheld / request-refused / batch-mismatch text; the footer status carries the batch id + SUPERSEDED clause and the refused-never-dust clause. Neither slot may ever be made collapsible by the new props.

## Shared primitive — EvidenceDrawer / ExplainButton / Drawer

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\EvidenceDrawer.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\Drawer.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\evidence.module.css
- current: This is already a clean layer-3 implementation and the only per-number forensic channel: typed descriptor → subject, sections of rows, the comparator VERBATIM in a `<pre>`, and an OPERATIONAL-vs-PROVEN marker. Opt-in per number via a dotted-underline ExplainButton.
- restructure: Adopt it as the canonical forensic layer for per-number detail: the rollout should route new detail here rather than growing new `<details>` next to numbers that already have an ExplainButton. No structural change to the component.
- HAZARDS (never collapse): The OPERATIONAL vs PROVEN marker currently exists ONLY inside the drawer for Inspector numbers. A method disclosure reachable only by opening a drawer is already a hidden disclosure — the surface must state the marker too (the Inspector proof card's "welds" row does this; other callers must match).

## Shared primitives — RefusedTag / EngineChip / ProjectionBadge / SeverityHF / MarksStamp / AddressMono

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\RefusedTag.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\EngineChip.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\ProjectionBadge.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\SeverityHF.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\MarksStamp.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\AddressMono.tsx
- current: Layer-1 vocabulary. SeverityHF fuses answer and form (crit only from the sealed verdict, warn only from the presentation band, em dash for unknowable, ∞ for no debt). MarksStamp is a compressed ledger fragment (`B·P @block · S ∅`) sitting inside table cells.
- restructure: No layering change — these are the words every takeaway sentence must reuse so the sentence and the cell agree. MarksStamp is the one primitive that may ride an expandable, and only for rows carrying no `∅` glyph.
- HAZARDS (never collapse): RefusedTag and the `∅` absent-mark glyph are refusal markers: a row rendering either may not have that cell collapsed. SeverityHF's em-dash (unknowable) arm must never be styled as ok — an unestablished verdict is not a green light.

## Shared — SurfacePlaceholder (DEAD CODE, no importers)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\components\SurfacePlaceholder.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\placeholder.module.css
- current: An honest not-yet-landed placeholder (eyebrow / name / description / fedBy / wave). Grep finds no importer — every surface has landed. It still carries the numbered-eyebrow pattern Wave R1 removed everywhere else.
- restructure: Out of scope for the layering rollout. Flag for deletion in a separate cleanup wave; do not spend layering effort on it, and do not let its eyebrow pattern be copied as precedent.
- HAZARDS (never collapse): None.

## Book — head: H1 + verdict dek + freshness line

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookSurface.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\bookDek.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\freshness.ts
- current: The closest thing in the app to the adopted shape already: a COMPUTED verdict dek (layer 1, derived from the same /v1/book response the cards render, with three adjudicated shapes plus an all-withheld shape) followed by a freshness line (layer 3 as-of). Weakness: dek and freshness are two undifferentiated paragraphs, and the dek packs per-engine counts + Σ eligible debt + standing bad debt into one very long sentence, so the answer competes with its own ledger.
- restructure: Takeaway line: the dek's leading clause only — per-engine liquidatable counts as of batch #N. Visible: a second line carrying Σ eligible debt and standing bad debt per engine (never summed). One-line method: the freshness line (batch id + age + supersession). Forensic expandable: none at head — the head IS the answer, and anything hidden here is hidden from the whole product.
- HAZARDS (never collapse): The all-engines-withheld dek shape, the "…so that side is unknown rather than zero" clause, and the age-UNKNOWN freshness variant (`batchFreshnessLineUnknown`) must stay in the takeaway position and must never be truncated to a first clause.

## Book — surface states: loading / no-batch / error / refused_engines strip

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookSurface.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\book.module.css
- current: Four mutually exclusive open blocks: a loading reason, a NO SERVABLE BATCH panel with the server's message + retry-after + "nothing on this surface is rendered as zero", a BOOK FETCH FAILED alert, and a per-engine refusal strip (`book-refused-engines`) naming each whole-book withholding. All single-layer, all correct.
- restructure: Keep entirely open. Give the no-batch and error blocks a leading takeaway sentence ("no number on this page is zero") followed by the server's own words. Nothing here becomes expandable.
- HAZARDS (never collapse): All of it: the refused-engines strip (whole book withheld per engine, with code and detail), NO SERVABLE BATCH, BOOK FETCH FAILED. These are the surface's own refusal register and are deliberately NOT duplicated by the global banner — so collapsing them would erase them outright.

## Book — BookStatRows (per-engine aggregates)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookStatRows.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\readingLines.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\book-format.ts
- current: All three layers flattened into one block per engine: a section head, a counts line (positions · computed · refused · flagged — raw ledger), four StatCards whose values are the answer but whose `sub` slots carry denominator + comparator + Σ together, and a dim `unit_note` paragraph (wire method). There is no per-engine takeaway sentence; the reader assembles the verdict from four cards. The withheld variant correctly swaps every value to an em dash with a per-card reason.
- restructure: Per engine — Takeaway line: "aave_v3_etherfi: N of M computed positions liquidatable, Σ eligible debt $X" (the derivation already exists in `readingLines.eligibleDebtFragment`; reuse the function, not the copy). Visible: the four StatCards with `sub` cut back to the denominator alone. One-line method: comparator clause + the wire `unit_note`, merged. Forensic expandable: the refusal breakdown (`code ×count`) and the positions/computed/refused/flagged split — ONLY when refused_positions === 0.
- HAZARDS (never collapse): The whole withheld-engine block (em-dashed values, RefusedTag, "engine withheld on this batch", "no verdicts were computed") stays open and un-layered. When `refused_positions > 0` the Refused card's value AND its breakdown must stay visible — that is the counted-aside-with-refusals case, so the expandable is illegal there.

## Book — positions section head + three legend lines

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookPositions.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\headroom.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\liq-distance.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\warnBand.ts
- current: Three stacked always-visible legend spans (warn-band disclosure, headroom legend, no-price-path legend) under an H2. Pure layer 3, three lines deep, before the reader has seen a single row. No takeaway.
- restructure: Takeaway line: the ranking in force and the engine — "aave_v3_etherfi, ranked by headroom, least room first". One-line method: the headroom definition (HEADROOM_LEGEND). Forensic expandable: the warn-band disclosure and the demoted price-path legend. Keep the rendered-not-hover-only property the legend already claims: the expandable must be keyboard-reachable text, not a title attribute.
- HAZARDS (never collapse): None of these three are refusals, so they may collapse — but the ordering registers in the controls row directly below (next entry) may not, and the two must not be merged into one collapsible block.

## Book — positions controls + ordering registers

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookPositions.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\positions.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\dust.ts
- current: Engine chips, dust chips and a standalone refused-first chip, interleaved with two disclosure spans: the sort-remap acknowledgment (`sort-remap-ack`, one-shot) and the honored-deprecated-ordering register (`legacy-sort-register`, persistent, carrying key AND direction). Controls and disclosures share one row at chip weight, so a load-bearing statement about what the rows are actually ordered by reads as another chip.
- restructure: Controls stay controls. Promote both register spans into a dedicated one-line "ordering in force" strip immediately under the controls, in the method register, never inside an expandable. Dust chips keep their group title but the threshold arithmetic moves to the footer expandable (next entries).
- HAZARDS (never collapse): `legacy-sort-register` is a supersession-class disclosure: it exists because no column header may claim an ordering the service actually applied (R7/R8). Both it and SORT_HF_REMAP_ACK stay outside any expandable.

## Book — positions notice + failure strips (supersession, refusal, transport)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookPositions.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\positions.ts
- current: Three always-open blocks in distinct registers: BATCH SUPERSEDED notice (409 restart, named), a refusal strip carrying the server's sentence verbatim with no retry, and a transport warn strip with a retry button. Already single-layer and correctly separated by failure taxonomy.
- restructure: No change. This is the reference implementation of the always-open register for the rest of the app — the rollout should copy its taxonomy (refusal vs transport get different registers and different affordances) rather than restyle it.
- HAZARDS (never collapse): All three, explicitly the `batch-superseded-notice`. The refusal strip's "retrying the identical request cannot succeed" clause must survive verbatim.

## Book — BookRiskMap (SKIP: owned by the in-flight chart wave)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookRiskMap.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\riskBins.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\useFullBookWalk.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\charts\DensityMap.tsx
- current: ALREADY three-layered by the in-flight wave: panel head with its own as-of (walk batch + supersession), a dek, a computed reading line (`riskMapReadingLine` — count inside the warn edge, Σ debt, aside clause), the binned map, a legend, the counted-aside breakdown, and dedicated outpaced/failed blocks with a walk-again affordance.
- restructure: SKIP — the rollout wave must not touch this panel. Two constraints it imposes on neighbours: (a) if /book gains a surface-level takeaway it must not restate RISK_MAP_DEK; (b) the map's on-book count travels with its own batch id and refuses to sit beside a foreign-batch count — no rollout edit may hand it a bare number.
- HAZARDS (never collapse): `risk-map-outpaced` (walk spanning materializations, with its supersession count), `risk-map-walk-note` (failed walk), `risk-map-superseded-notice`, and `risk-map-aside` (counted aside: no debt / headroom unknown / refused / no positive debt). All already open; the rollout must not relocate or collapse any of them.

## Book — positions table + footer accounting

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookPositions.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\dust.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\positionRow.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\DataTable.tsx
- current: Layer 2 with layer 3 crammed into the footer. The footer status span concatenates: loaded/qualifying/hidden/on-book accounting, the sort suffix, a dust Σ disclosure (bound while pages remain, exact at exhaustion), the liquidatable disclosure, batch id + SUPERSEDED, and the refused-never-dust clause. Six distinct statements in one dim strip. The Headroom cell additionally hides the entire price-path statement in a `title` attribute.
- restructure: Takeaway line: first footer clause = "N of M positions on this batch, ranked by X". Visible: hidden-count segment, liquidatable disclosure, batch id + supersession, refused-never-dust. Forensic expandable: the dust Σ bound-vs-exact arithmetic and the full cross-batch mismatch explanation — with a one-line "these counts come from two batches" left outside. Separately: the price-path statement should move out of the `title` into the row expandable, since hover-only is not a disclosure.
- HAZARDS (never collapse): `FOOTER_REFUSED_NEVER_DUST` (refused rows are never dust-filtered), `hiddenCountMismatch` (two-batch guard), `SUPERSEDED (still served)`, `liquidatable-disclosure`, and the `empty` string's engine-withheld / request-refused arms. Refused rows are rows and must remain in the walk regardless of any filter the rollout touches.

## Book — BookHistogram (per-engine HF distribution)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookHistogram.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\readingLines.ts
- current: Nearly three-layered already: panel head (chip + comparator), a COMPUTED reading line at the top of the body (layer 1, derived from the same response), the SVG, a two-item aside (refused count + ∞ no-debt count), and the wire `note` as a dim paragraph (layer 3). What is missing: the crit-tint ASYMMETRY between the wad and ratio comparators is explained only inside the wire note, and the eligible-territory mark is explained only in an SVG `<title>`.
- restructure: Takeaway line: the existing reading line, promoted typographically above the panel head. Visible: SVG + the aside counts. One-line method: name the comparator and state why sub-1.00 tints on the wad engine only. Forensic expandable: the wire `note` verbatim and the bucket boundary values. The `<title>`-only eligible-territory explanation moves into the method line.
- HAZARDS (never collapse): The refused-engine panel (empty buckets + named refusal + "says nothing about how many positions sit here"), the `refused_count` aside, and the `infinite_count` aside are all counted-aside-with-refusals content and stay outside the expandable.

## Book — BookBadDebt (standing census)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookBadDebt.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\DataTable.tsx
- current: Layer 2 with a one-line method above it. Section head + a note ("a withheld engine is an em dash with its reason, never 0") + a six-column DataTable. No takeaway: the standing loss — arguably the single most important number on the surface — must be read out of a table cell.
- restructure: Takeaway line: "standing bad debt: $X on aave_v3_etherfi, $Y on debt_manager" computed from the same rows, never summed. Visible: the table. One-line method: the null-never-zero clause (already present). Forensic expandable: the insolvent / eligible / eligible-debt / at-risk count columns if the table needs to narrow — the bad-debt column itself never collapses.
- HAZARDS (never collapse): Refused rows (em dash + RefusedTag + `rowTone: refused`), every null count cell (`countCell` → em dash), and the `empty` string ("no engine's bad debt is reported as zero"). A withheld engine must appear in the takeaway sentence as unknown, not be omitted from it.

## Book — BookWaterfall (the heaviest mixing on the app)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookWaterfall.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\waterfallView.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\book-copy.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\charts\WaterfallSteps.tsx
- current: Seven registers stacked with no hierarchy: section head (scenario id/version/axis + PROJECTION badge + section note), monotonicity warn strip, excluded-engines refusal strip, the eligible-vs-realized gloss, per-engine step charts, a bad-debt legend line, and a held-flat panel that already implements the counted-disclosure pattern (visible count summary + `<details>` named table) plus the wire `eligibility_note`. No computed takeaway anywhere — the Lab computes exactly this sentence one route over and the Book does not.
- restructure: Takeaway line: a computed sentence — "by −50%, aave_v3_etherfi's Σ eligible debt reaches $X and its bad debt $Y" — reusing the Lab's derivation (`labDek`/`frontierReadingLine` logic, not its copy). Visible: PROJECTION badge, monotonicity strip, excluded strip, the per-engine step charts, the held-flat COUNT summary. One-line method: the eligible-vs-realized gloss. Forensic expandable: the held-flat named table (already), the bad-debt legend, and the wire `eligibility_note`.
- HAZARDS (never collapse): MONOTONICITY VIOLATION strip (named point, never smoothed), `waterfall-excluded` refusal strip, the held_flat COUNT summary (the named list may collapse; the count may not — and the empty-case positive claim must also stay visible), and the null-waterfall panel ("a statement about the SERVICE, and it makes no claim about what is at risk"). Note `at_risk_note` is deliberately NOT rendered here — do not add it as an expandable; that would put a caveat on a series this panel does not draw.

## Book — stampline

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\book\BookSurface.tsx
- current: Five pins at equal weight: batch freshness (duplicating the head's line by design), marks summary with sweep flags, gate posture (`N/M engines allowed · withheld: …`), a key pin pointing at /proof, and coverage (`full` or `partial · N excluded, M withheld`).
- restructure: Apply the Stampline `keepOpen` split: gate and coverage stay inline whenever they are warn-toned; batch, marks and key collapse behind a one-line counted summary. The head already carries the freshness line, so its stampline twin is the safest thing to hide.
- HAZARDS (never collapse): gate `withheld: …`, coverage `partial · N excluded, M withheld`, and `marks … sweep⚠` are all keepOpen. Coverage-partial is a withheld-engine statement, not a metric.

## Lab — page head (H1 + intro + fed-by foot)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\page.tsx
- current: Static: H1, an intro paragraph describing what the surface is, and a demoted fed-by provenance line at the page bottom. The COMPUTED cliff sentence (the real takeaway) lives two components down inside LabBookPanel, below the mode bar.
- restructure: Hoist the computed dek so it sits directly under the H1, above the mode bar — the cliff sentence is the surface's answer and currently reads as a panel caption. The static intro becomes the one-line method. The fed-by foot stays as the bottom provenance line.
- HAZARDS (never collapse): `LAB_DEK_NO_WATERFALL`, `LAB_DEK_NO_GRID` and every caveat clause `labDek` appends (withheld engines, monotonicity break, missing unshocked reference) must travel with the hoisted sentence — the dek may not be truncated to its first clause to fit a header.

## Lab — mode bar (whole book / one address)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabClient.tsx
- current: Two buttons plus an always-visible caption stating the primary/secondary register. Pure method beside a control, correctly open.
- restructure: Keep. The caption becomes the formal one-line method under the mode bar. No expandable.
- HAZARDS (never collapse): None.

## Lab — book-mode dek + frontier gate

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabBookPanel.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\labDek.ts
- current: The dek paragraph (computed, with three absence shapes) then one of: a frontier loading line, LabFrontier, or a `frontier-refused` error box carrying the 503/unreadable-book statement. Layer 1 and layer 3 adjacent but visually identical.
- restructure: As above — dek hoists to the page head. The `frontier-refused` box gains a leading takeaway ("no frontier on this batch — that is a statement about the service") with the server's message visible beneath it.
- HAZARDS (never collapse): `frontier-refused` (503 and unreadable-book arms) never collapses; the dek's withheld-engine and monotonicity caveat clauses stay in the visible sentence.

## Lab — LabFrontier (SKIP: owned by the in-flight chart wave)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabFrontier.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\labReadingLines.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\frontierView.ts
- current: ALREADY three-layered: section reading line (layer 1), a legend, per-engine panels each with a chart + its own series reading line + a step table (layer 2), then the wire's eligibility and at-risk notes VERBATIM, monotonicity state, excluded engines, and held-flat (layer 3).
- restructure: SKIP. Constraint on neighbours: the hoisted page-level dek and this panel's reading line are two different claims (cliff vs. per-engine span) — the rollout must not merge or dedupe them, and must not add a third frontier headline above it.
- HAZARDS (never collapse): `frontier-absent`, `frontier-no-engines`, `frontier-monotonicity-violation`, the excluded-engines withheld list (with both `detail` and `note`), and the held-flat summary. All already open; the rollout may not relocate them.

## Lab — LabMatrix header + grid

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabMatrix.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\matrixCells.ts
- current: Section head (row × column counts) + a composed batch header line (`batchHeaderLine`, which already refuses to name a cohort with no members) + the grid. Every result cell repeats layer 3 inside itself: value, then `Δ eligible debt · DELTA-ONLY · N newly eligible`, then a `title` carrying the batch pin and the delta-basis explanation again.
- restructure: Takeaway line: the batch header line, promoted. Visible: the grid. One-line method: the DELTA-ONLY basis + "no total column: engine books are never summed" — stated ONCE here instead of once per cell, letting each result cell's sub shrink to the newly-eligible count. Forensic expandable: none at grid level (the grid IS the ledger); per-cell batch pins move to the row's settlement line.
- HAZARDS (never collapse): Every non-numeric cell state and its reason text — NOT COVERED, WITHHELD, SUPERSEDED, UNANSWERED, CONTRADICTORY BOOK, DEFINITION CHANGED — plus the header's floor/no-cohort clauses. The NOT COVERED vs WITHHELD distinction is the reason the cold listing exists; it may not be flattened into one tag.

## Lab — LabMatrix legend (the collapse trap)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabMatrix.tsx
- current: One long always-on paragraph defining six cell states, with DEFINITION CHANGED deliberately split into three separately-pinned arms. Wave R16 finding 2 exists precisely because this legend once carried ONE case's wording for three, and printed a contradiction on every page.
- restructure: This is where an expandable is most tempting and must be partly refused. Takeaway line: a one-line key naming the six state words only. Visible: the four refusal/hole/definition-changed arms in full (WITHHELD, UNANSWERED, CONTRADICTORY BOOK, and all three DEFINITION CHANGED sub-arms). Forensic expandable: the definitional prose for NOT COVERED and SUPERSEDED only.
- HAZARDS (never collapse): The three DEFINITION CHANGED arms are the documented precedent for the hard law — collapsing them recreates R16's page-level contradiction (telling a reader to re-run a request that is still in flight). WITHHELD, UNANSWERED and CONTRADICTORY BOOK are refusal states and stay open.

## Lab — LabMatrix row affordances (rerun-failed / attempt-changed / refresh-listing)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabMatrix.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\matrixCells.ts
- current: Up to four stacked spans in the run column at `cellSub` weight: the run button, a derived rerun-failed banner (carrying disposition + retained-response provenance), an attempt-changed note (in-flight vs settled), and a definition-changed refresh affordance gated on cohort membership. Correct content, but three disclosures at footnote size in a table cell.
- restructure: Keep all four open. Compose them into ONE settlement line per row using the existing `rerunFailedBanner` / `attemptChangedNote` derivations, so the row reads as a single sentence with its remedy attached, rather than three stacked footnotes the eye skips.
- HAZARDS (never collapse): Every one of them: the retained-response disclosure, the in-flight-vs-settled split (R15), and the refresh-vs-re-run remedy split (R14). A settlement whose remedy resolves nothing must not be offered — the current cohort-membership gate does this and must survive any restyle.

## Lab — CommittedDetail (scenario definition + run control)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabBookPanel.tsx
- current: Scenario head (label + id/version + engine chips), a description, a `dl` whose every `dd` carries an inline method clause (path assumption; "defined for … an engine absent here is outside this scenario's MODEL, which is not the same statement as a withheld engine"; the exact shock factors), the run button + endpoint hint, then the pending/banner/outcome stack.
- restructure: Takeaway line: the scenario label plus what it moves, in reader words ("stable_usd ×0.97"). Visible: run control + the whole settlement banner stack. One-line method: the defined-for clause (model-absence ≠ withheld). Forensic expandable: the full shock list with exact factors, the path assumption, and the endpoint hint.
- HAZARDS (never collapse): `runbook-attempt-changed`, `runbook-current-bodyless`, the rerun-failed banner, and the defined-for clause itself — that clause carries the NOT COVERED vs WITHHELD distinction and stays visible.

## Lab — BookResult (a served run-book)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabBookPanel.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\runbook.ts
- current: The longest single render in the app and the flattest: head, description, kv (path assumption + shocks), per-engine EngineResult blocks, the excluded/hole block, applied shocks, held flat, a coverage panel (`dl` of five raw counts + `stress_coverage_is_full` + note), out-of-model, wire notes behind a counted `<details>`, and a batch stamp. No takeaway — the answer sits under several screens of tables.
- restructure: Takeaway line: "this scenario makes N accounts newly eligible on aave_v3_etherfi and M on debt_manager; Δ eligible debt $X / $Y, never summed" computed from `response.engines`. Visible: the per-engine blocks and the excluded/hole block. One-line method: DELTA-ONLY basis + engines-never-summed. Forensic expandable: path assumption, shock list, the coverage panel, out-of-model, wire notes (already).
- HAZARDS (never collapse): `book-excluded` refusal list, `book-hole` (the holeDisclosure — a hole is neither refusal nor zero), the all-hole view, `stress_coverage_is_full: false · withheld: …`, and the completeness line's gating. The completeness sentence must never render from inside an expandable where a reader could miss the hole rendered beside it — that is exactly the R14 finding-2 defect.

## Lab — EngineResult (before/after aggregates + deltas)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabBookPanel.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\book-copy.ts
- current: Panel title carrying the unit disclosure inline, a seven-row before/after table (pure ledger), three StatCards (newly eligible + two DELTA-ONLY deltas), the 1.6.0 sub-panels, and the wire `note`. The collateral-at-risk reader caption is a `title` attribute only — a method disclosure reachable solely by hover.
- restructure: Takeaway line: "newly eligible N; Δ eligible debt $X; Δ bad debt $Y" — the three StatCards' content as one sentence. Visible: the three StatCards. One-line method: usd_decimals + never-summed, plus the collateral-at-risk caption PROMOTED out of the `title`. Forensic expandable: the seven-row before/after table and the wire `note`.
- HAZARDS (never collapse): The at-risk caption must move up, not further down — a dip in that series is honest arithmetic and a reader who never hovers reads it as missing data. Nothing else here is refusal-class, so the before/after table is safe to collapse.

## Lab — LabRunBookHistogramPair

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabRunBookDetail.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\labRunBookLines.ts
- current: Already close: title + comparator tag, a computed shift reading line (layer 1), two SVGs sharing ONE count scale, per-side refused/∞ asides, and the wire note (layer 3). The shared-scale decision — the whole reason the two charts sit side by side — is documented only in a source comment.
- restructure: Takeaway line: the existing shift reading line. Visible: the pair + both asides. One-line method: shared count scale + the comparator tint asymmetry, stated on the page rather than in a comment. Forensic expandable: the wire note and the bucket boundaries.
- HAZARDS (never collapse): Both sides' `refused_count` asides ("rows counted here, never dropped") and `infinite_count` — counted-aside content, stays outside.

## Lab — LabRunBookMovers

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabRunBookDetail.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\labRunBookLines.ts
- current: Title + `moversDisclosure` reading line (which already carries the truncation statement) + the engine-conditional table + the wire's `movers_note` VERBATIM (the server's own statement of its ranking rule and its cap).
- restructure: Takeaway line: "the N accounts this scenario moved most, of M total". Visible: the table. One-line method: the ranking rule. Forensic expandable: the verbatim `movers_note` — legal ONLY because the truncation count stays in the visible takeaway; if the count ever leaves the visible line, the note may not collapse.
- HAZARDS (never collapse): The truncation/cap statement (a silent cap is the defect the note exists to prevent) and `became_eligible === null` em-dash cells (NOT APPLICABLE is never collapsed into "no").

## Lab — LabRunBookCollateral (per-side breakdown)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabRunBookDetail.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\labRunBookLines.ts
- current: Title + two sides, each with its own computed reading line and a three-column table. Unpriced / NOT COUNTED rows render in a refusal register inside the value cell, with the wire's note in a `title` and the disclosure identity in a data attribute.
- restructure: Takeaway line: "collateral by asset, before → after; k holdings carry no price witness". Visible: both tables. One-line method: the three disclosure kinds named. Forensic expandable: the per-asset rows of the side the reader is not comparing — legal ONLY on a side with zero unpriced/NOT COUNTED rows.
- HAZARDS (never collapse): UNPRICED · no price witness and NOT COUNTED rows are refusals with intact balances and no value. A side carrying either may not collapse, and the count of them must appear in the takeaway.

## Lab — LabRealization + HfsUnchangedBanner

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabRealization.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\book-copy.ts
- current: An optional banner rendering the WIRE's own hfs_unchanged assertion, two StatCards (execution shortfall, bad debt at liquidation) whose subs carry the delta-only basis, a seizure-model caption, and the wire note. The eligible-vs-realized gloss rides a `title` on the second card's sub — hover-only.
- restructure: Takeaway line: "execution shortfall $X; bad debt at liquidation $Y — delta-only". Visible: both cards and the hfs_unchanged banner. One-line method: the seizure model, plus the eligible-vs-realized gloss PROMOTED out of the title. Forensic expandable: the wire note.
- HAZARDS (never collapse): The hfs_unchanged banner is the scenario's own claim (never a UI inference) and stays open. The delta-only basis must remain in the visible takeaway, not the expandable.

## Lab — LabProjectionView

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabProjectionView.tsx
- current: A panel title packing five facts (PROJECTION badge, basis, annual Δbps, APY-observed block, prices-held-flat), a five-column horizon table, a caption about native scale, and the wire note. Layer 3 is split across the title and two trailing paragraphs.
- restructure: Takeaway line: what happens at the longest horizon — becomes / does not become liquidatable. Visible: the horizon table + the PROJECTION badge. One-line method: basis + prices-held-flat. Forensic expandable: APY-observed block, the native-scale caption, the wire note.
- HAZARDS (never collapse): `unknowable` verdict cells (an unknowable horizon is not a "does not become liquidatable") and the prices-held-flat clause, which is a held-input disclosure and belongs in the visible method line.

## Lab — shared fragments: LabAppliedShocks / LabHeldFlat / LabOutOfModel

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabScenarioDetail.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\book-copy.ts
- current: Three different maturities in one file. LabHeldFlat and LabOutOfModel already implement the target shape exactly — an always-visible COUNTED summary plus a `<details>` holding the named list. LabAppliedShocks is a bare table with a `disclosures` column of snapped/base_snapped/cap_bound flags and no summary at all.
- restructure: Adopt LabHeldFlat/LabOutOfModel as the reference implementation for the whole rollout (counted summary outside, named list inside). Give LabAppliedShocks the same shape: takeaway = "N shocks applied, k snapped to a cap"; the flag columns move into the expandable.
- HAZARDS (never collapse): The held_flat and out_of_model COUNTS stay in the summary; only the named lists collapse. The empty-case held_flat renders a positive coverage CLAIM instead of a count — that claim must also stay visible. A `snapped` / `cap_bound` YES is a modelling disclosure and must survive as a count in the visible takeaway.

## Lab — address mode: form + three-valued outcome

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabClient.tsx
- current: Secondary-register note, the address form with an inline invalid-input hint, idle/loading/error blocks, then StressResult's three arms: not-found (definitive negative with its entitlement), unknowable (withheld engines named with codes and details), and found (with a FLOOR block when incomplete). The outcome sentence and its evidence are already adjacent but at equal weight.
- restructure: Takeaway line: the outcome sentence itself. Visible: the withheld-engine list and the FLOOR block. One-line method: what entitles the service to that outcome. Forensic expandable: the idle-state explainer prose (which currently occupies more space than any answer).
- HAZARDS (never collapse): `lab-unknowable` withheld list, `lab-floor-note` ("these results are a FLOOR, not a total"), and the address-format refusal hint. The unknowable arm must never be styled like the not-found arm.

## Lab — LabScenarioDetail + LabStatePair + flagship contrast

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabScenarioDetail.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\severity.ts
- current: Scenario head + description + kv(path assumption, shocks) + per-result ResultView, which branches into either the two-panel flagship contrast (protocol-sees vs market-realizes) or a plain pair. LabStatePair is a five-row before/after table with the warn-band + engine-comparator caption below it. `not applicable` renders with its served reason; a withheld pair renders a fallback caption.
- restructure: Takeaway line, per result: "before → after: still not liquidatable, HF 1.31 → 1.04". Visible: the state pair table and the flagship contrast panels. One-line method: the warn-band-is-presentation + eligibility-is-the-engine's-comparator caption. Forensic expandable: the raw collateral_usd / debt_usd / max_borrow_lt integer rows.
- HAZARDS (never collapse): `not-applicable` with its served reason, the "state pair withheld · see the result's reason" fallback, the NEWLY ELIGIBLE marker, and the bit-identical assertion (a no-op that must be visible as a finding, not absorbed).

## Lab — LabBoundaryGroup

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabBoundaryGroup.tsx
- current: Panel title with a member count, a derivation caption (layer 3 — how the group is derived from the wire, and that a missing boundary point is absent rather than invented), then a grid of members each carrying exact factors and a per-engine no-op/re-priced summary.
- restructure: Takeaway line: "N committed members on the stable_usd axis; k re-priced this address's served states". Visible: the member grid. One-line method: the derivation caption. Forensic expandable: the per-member snapped / base_snapped counts.
- HAZARDS (never collapse): The "only served members render, so a missing boundary point is absent rather than invented" clause is an absence disclosure and stays visible.

## Lab — LabScenarioChips

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabScenarioChips.tsx
- current: Pure control row in wire order. The only disclosure is the data-driven PROJECTION badge on projected axes.
- restructure: No layering change — this is navigation. If the chip row is ever condensed, the PROJECTION badge travels with the chip.
- HAZARDS (never collapse): The PROJECTION badge must not be dropped in any condensed form; a projection chip that looks like a spot-shock chip is a wrong-reading defect.

## Lab — LabBatchStamp

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\lab\LabBatchStamp.tsx
- current: Ledger-only stampline: batch id + computed_at, batch status, scenario_config version, supersession stated either way, per-engine watermark vector.
- restructure: Apply the Stampline keepOpen split: supersession and any non-complete status stay inline; batch/config/watermarks collapse behind a counted summary.
- HAZARDS (never collapse): SUPERSEDED and `status !== "complete"` are keepOpen. The supersession pin is deliberately stated in BOTH directions — do not turn it into a conditional badge that disappears when false.

## Inspector — landing (/inspector): intro + AddressEntry + recents

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\page.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\AddressEntry.tsx
- current: Already correctly single-layer and already adjudicated: H1, an intro stating what the reader can DO, the entry form, an inline REFUSED message on invalid input, a one-line entry-law statement, browser-local recents, and a demoted fed-by provenance foot.
- restructure: Minimal: the intro is the takeaway, the entry-law line is the one-line method, the fed-by foot is already the demoted provenance. Add nothing expandable — this page has no served numbers to layer.
- HAZARDS (never collapse): The inline REFUSED message (strict 0x-40hex, never coerced into a different account) stays open and adjacent to the input.

## Inspector — surface head, freshness, and invalid-segment refusal

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorSurface.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\freshness.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\live-age.ts
- current: Backlink + H1 (the address) + a freshness line from THIS lookup's own envelope + a loading/error/ready branch. The `lookup unavailable` block correctly states "an error is not an answer". The outcome sentence lives one component lower (FoundBlock), so the head shows an address with no verdict beside it.
- restructure: Takeaway line: hoist FoundBlock's outcome sentence next to the address in the head. One-line method: the freshness line (this lookup's own batch + age). Forensic expandable: none at head.
- HAZARDS (never collapse): `address-refusal` (invalid segment), `lookup unavailable`, and the age-UNKNOWN freshness variant. The per-lookup as-of must never be replaced by a borrowed or global freshness during any head restructure.

## Inspector — FoundBlock (three-valued outcome + floor)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorSurface.tsx
- current: Four distinct blocks, all open: `found-positive` one-liner, `found-floor` box, `found-negative` box carrying the completeness justification in prose, and `found-unknowable` with the withheld list. Already very close to takeaway-shaped; the negative arm's entitlement paragraph is layer 3 sitting at layer-1 weight.
- restructure: Takeaway line: the outcome sentence. Visible: the FLOOR box and the withheld list. One-line method: the completeness clause (what entitles the service to a definitive negative). Forensic expandable: the wire `note`.
- HAZARDS (never collapse): The FLOOR box, the unknowable box + withheld engine list, and the "this is NEVER the definitive negative" clause. The three arms must never share a visual register.

## Inspector — position card (the densest ledger in the app)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorPositionCard.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\evidence.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\params-format.ts
- current: ~15 kvRows of legs, price inputs, params + provenance, collateral flags and liquidation price, each carrying an inline method clause in a dim span, each number wrapped in an ExplainButton. No takeaway. The warn disclosure sits inline beside the HF; price verdict chips (fresh/stale/over-ceiling/no-as-of) render per price row.
- restructure: Takeaway line: "not liquidatable · HF 1.043 · $X collateral against $Y debt" (Aave) or "not liquidatable (strict) · debt $X vs maxBorrowLT $Y" (DM). Visible: verdict/HF, the two totals, the liquidation-price row. One-line method: the engine's own comparator + the engine's own unit. Forensic expandable: leg rows, price-input rows, param rows + provenance, collateral-flag rows — each number keeping its ExplainButton inside.
- HAZARDS (never collapse): The position's own RefusedTag; any price-input `verdict` chip that is not `fresh` (stale / over-ceiling / no-as-of / crit) must be surfaced OUTSIDE the expandable — a stale price behind a fold is exactly the D-013 wrong reading; `no chain-asserted as-of`; `∅ never swept`; `already breached`; the axis-scoped no-price-path badge (dim, never ok-green, suppressed entirely under a liquidatable verdict); and the `param timeline unavailable` fallback.

## Inspector — formula block

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorPositionCard.tsx
- current: A `<pre>` rendering the engine's OWN law with this position's numbers substituted (Aave rev-3 wadDiv composite; the DM's strict boolean). Pure layer 3, always visible, engine-correct, never shared between engines.
- restructure: Make this the archetype for the forensic layer: a one-line method above it naming the law, the `<pre>` inside the expandable. The REFUSED substitution arm renders OUTSIDE the expandable.
- HAZARDS (never collapse): The `REFUSED · code · no number is served` / `no verdict is served` substitution must render in the always-open register — a refusal that only appears when a reader opens the formula is a hidden refusal.

## Inspector — proof card

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorPositionCard.tsx
- current: Eight kvRows: marks vector, balances/params/sweep marks, price custody, reorg epochs, batch id, and a welds row disclaiming that this view is LIVE · WATERMARKED rather than PROOF · EXACT @ PIN. Pure ledger + method with no takeaway — and the most important sentence (the live-vs-proof disclaimer) is last and dim.
- restructure: Takeaway line: the welds disclaimer, hoisted — "this position is LIVE · WATERMARKED, not proof-exact; welds live at /proof". Visible: reorg epochs whenever unacked > 0, and the sweep-absent state. One-line method: the custody statement. Forensic expandable: the mark rows, the price-custody source list, the batch id.
- HAZARDS (never collapse): `no watermark for this engine`, `N unacked` epochs, `∅ never swept`, and the LIVE-vs-PROOF disclaimer itself — the whole Proof Center split depends on this sentence not being collapsible.

## Inspector — HF history (the best existing three-layer example)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorHistory.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\history-series.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\charts\Sparkline.tsx
- current: Already implements the adopted principle: a head that says what the chart IS, a per-engine meta line separating PLOTS from WITNESSED from the requested WINDOW, an all-gap frame text when nothing plots, the sparkline, then a one-line doctrine with the FULL doctrine behind `<details>` — and the DM disclosure-ratio warning deliberately kept VISIBLE outside that `<details>`. An engine never present renders no frame at all.
- restructure: Adopt as the app-wide pattern. The only gap: no per-engine takeaway sentence. Add one above each sparkline ("HF moved x → y across N of W witnessed batches"), and move `engineNeverPresentLine` into the same takeaway register so an absence and a movement read at the same weight.
- HAZARDS (never collapse): The DM disclosure-ratio line is the explicit precedent for the hard law — it is held out of the `<details>` because it is the conflation the surface exists to refuse. Also: the unknowable/withheld outcome boxes, the FLOOR line, the all-gap frame text, and each gap's named reason in its tick title.

## Inspector — address activity

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\inspector\[addr]\InspectorActivity.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\feed-view.ts
- current: Section head + rows + error/loading + load-more + a trailing method note on block_time custody. No takeaway. Liquidation extracts render inline as a dim sub-span with em dashes for unestablished fields.
- restructure: Takeaway line: "N custodied actions for this account, newest first". Visible: rows. One-line method: the block_time custody note. Forensic expandable: the liquidation extract's seized/repaid/bonus breakdown — only on rows where every field is established.
- HAZARDS (never collapse): `activity unavailable`, `record-only` amounts, em-dash bonus/seized fields, and the block-number fallback statement. A row whose extract contains an em dash must keep that extract visible.

## Observatory — head + engine switcher

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\observatory\ObservatorySurface.tsx
- current: H1 + a static intro that already states the hole doctrine + the switcher + a control note ("engines are never combined onto one axis"). No computed takeaway — the answer must be read out of the stat row and the four charts below.
- restructure: Takeaway line: computed over the newest bucket and the axis tally — "debt $X across N accounts as of <bucket>; k of the last W hours have no complete batch" (the counts already exist as `axis.capturedCount` / `withheldCount` / `absentCount`). Visible: the switcher. One-line method: the hole doctrine + never-combined note, merged.
- HAZARDS (never collapse): The withheld and absent bucket counts must appear in the computed takeaway rather than only in the stampline — an hour with no complete batch is an unknowable, and a takeaway that omits it invites reading the series as continuous.

## Observatory — degraded / error / empty states

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\observatory\ObservatorySurface.tsx
- current: Three distinct named blocks, all open, all carrying the server's own words: ROLLUP UNAVAILABLE (a migration-level fact, explicitly not an empty chart), SERIES FETCH FAILED, and an empty-range panel distinguishing a young record from an empty book.
- restructure: Keep open. Add a leading takeaway sentence to each; nothing becomes expandable.
- HAZARDS (never collapse): All three. The ROLLUP UNAVAILABLE panel in particular is a named refusal state standing in for a chart — collapsing it would produce exactly the empty chart it exists to prevent.

## Observatory — newest-bucket stat row

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\observatory\ObservatorySurface.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\observatory-series.ts
- current: A caption line (bucket + watermark block + refusal tag or "captured") plus four StatCards whose `sub` slots carry either the withheld reason or a bucket repeat. Layer 1 and 2 together; the method is the caption.
- restructure: Takeaway line: one sentence over the four values. Visible: the four cards. One-line method: "captured from the newest complete batch in that hour". Forensic expandable: none — four numbers ARE the answer here.
- HAZARDS (never collapse): A refused newest bucket: its RefusedTag and every "withheld, no number served" sub stay open, and the takeaway must state the withholding rather than printing the previous bucket's numbers.

## Observatory — chart grid + legend

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\observatory\ObservatoryCharts.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\components\charts\ObservatorySeriesChart.tsx
- current: Four charts, each repeating the SAME as-of line in its own head (four identical layer-3 statements), then a five-item legend paragraph below the grid (captured / absent / withheld / zero-floor / clickable). No reading line per chart.
- restructure: Takeaway line: one computed direction sentence over the grid (or one per metric). Visible: the four charts, with the as-of stated ONCE above the grid instead of four times. One-line method: the captured/absent/withheld triple. Forensic expandable: the zero-floor and click-affordance notes.
- HAZARDS (never collapse): The "withheld bucket · totals are null and never 0" and "the line never interpolates across a gap" legend entries are the product here — they stay in the visible method line, not the expandable.

## Observatory — ObservatoryPointDetail (bucket record)

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\observatory\ObservatoryPointDetail.tsx
- current: This IS the forensic layer, but it renders fully expanded for the default selection: a twelve-row `dl` including materialization key, reorg posture, sweep-stamp prose with three arms, then a six-column rates table, then a provenance paragraph. An absent bucket gets the same panel stating the absence by name.
- restructure: Make its role explicit. Takeaway line: the bucket's one-line state ("captured at <bucket>, watermark block N" / "ABSENT · no complete batch in this hour"). Visible: debt, collateral, accounts, liquidatable, and the refusal state. Forensic expandable: materialization key, observed batch, reorg posture, sweep stamp, the rates table, and the provenance paragraph.
- HAZARDS (never collapse): The ABSENT panel; the refused-state row; the "null because the book was withheld and never zero" clauses on debt and collateral; `sweep_recorded === false` (the unrecorded disclosure, which is explicitly NOT a claim that the engine has no sweeper); `scale: unstated` rate rows; and unacked epochs. All stay outside the expandable.

## Observatory — response notes + stampline

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\observatory\ObservatorySurface.tsx
- current: `response.notes` render as a bare `<ul>` with no count and no framing; the stampline carries engine, served_at, the captured/withheld/absent bucket tally, stride, range, and the rollup source note.
- restructure: Notes move behind a counted disclosure (the LabHeldFlat pattern). The bucket tally is PROMOTED into the head takeaway. Stampline follows the shared keepOpen split.
- HAZARDS (never collapse): The withheld and absent bucket counts must remain visible somewhere outside the collapsed notes — promoting them into the takeaway satisfies this; collapsing the notes without promoting the tally does not.

## Feed — head

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\feed\FeedSurface.tsx
- current: H1 + a static intro stating the two-instrument law (live strip vs durable list, "the two never blend"). No computed number.
- restructure: Takeaway line: a computed line over the loaded window ("N actions loaded, k liquidations, newest at block B"). One-line method: the two-instruments law.
- HAZARDS (never collapse): The "the two never blend" clause is the reason this surface has two instruments — it stays as visible method, never as an expandable footnote.

## Feed — FeedLiveStrip

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\feed\FeedLiveStrip.tsx
- current: One open row: label + stream chip + one of three branches (unavailable with staleness and last-good-batch / batch with counts, supersession and per-engine watermarks / nothing delivered) + a withheld-engine clause + the current-connection-only law.
- restructure: Keep open in full. Takeaway = the stream chip plus the batch clause; the law line becomes the formal one-line method. Nothing here becomes expandable.
- HAZARDS (never collapse): `feed-live-unavailable`, `feed-live-degraded` (withheld engines with codes), `SUPERSEDED (still served)`, the "from an earlier connection" clause, and `feed-live-none` ("nothing is pretended"). The current-connection-only law prevents this strip being read as history and stays visible.

## Feed — controls + ordering-regime note

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\feed\FeedSurface.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\feed-data.ts
- current: Engine / view / type chips, then either a since-block control or a STATED IMPOSSIBILITY where the control would be (cross-engine heights are not comparable), then a separate paragraph disclosing the ordering regime in force for the current mode.
- restructure: The ordering note becomes the one-line method directly under the controls. The since-block impossibility stays inline exactly where the control would sit — it is a property of chains, not a disabled input.
- HAZARDS (never collapse): `since-block-impossible` and the ledger-view pinned-type note. Neither may become a tooltip or a disabled-gray control — the current design explicitly refuses both.

## Feed — notice / refusal / error strips

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\feed\FeedSurface.tsx
- current: Three open strips: a NOTICE (e.g. a since_block dropped because heights are chain-scoped), a PAGE REFUSED strip with the server's words plus an honest restart-from-page-one affordance, and a transport failure strip with retry.
- restructure: No change. Same taxonomy as the Book's positions strips; the rollout should keep them identical so a reader who learns one register knows the other.
- HAZARDS (never collapse): All three. The chain-scoped since_block drop notice is supersession-shaped — the same number would mean something different on another chain, and silently re-meaning it is the defect the notice exists to prevent.

## Feed — FeedList rows, untimed tail, ordering drift

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\feed\FeedList.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\feed-view.ts
- current: Rows carry amount + unit chip + raw-units tag + address + engine + block/log + tx link, plus an optional liquidation-detail toggle that is open by default ONLY in ledger view. Between the sections sits a full-width UNTIMED TAIL divider carrying its count and rationale, and an ORDERING DRIFT alert when the wire violates its own ordering law.
- restructure: Takeaway line: per section, the divider reduced to one line carrying its count. Visible: rows, the raw-units tag, the drift alert. Forensic expandable: the liquidation extract (already a toggle) and the divider's full rationale.
- HAZARDS (never collapse): ORDERING DRIFT alert; the untimed-tail divider's COUNT and its "a timestamp is never invented" clause; `record-only` amounts; the `raw units` tag (a reader must be able to tell "no scale was licensed" from "the scale is 1"). CONCRETE DEFECT TO FIX IN THE ROLLOUT: in `all actions` view the liquidation extract is COLLAPSED by default, which hides em-dash bonus/seized fields — an unestablished field behind a fold. Either auto-open the extract on any row with an unestablished field, or put a visible marker on the row.

## Feed — foot (accounting + filter echo) + section note

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\feed\FeedSurface.tsx
- current: Rows-loaded + mode, the wire's own filter echo (engine / types / since_block / limit), a load-more or end-of-feed marker, then a trailing two-sentence method note on block_time custody and amount units.
- restructure: Takeaway line: the rows + mode clause. Visible: the filter echo. One-line method: block_time custody + amount units. Forensic expandable: the full note prose.
- HAZARDS (never collapse): The filter echo is the wire's own statement of what was actually asked — it stays visible so a reader can check the answer against the question. The amount-unit clause ("a scaled or normalized value is never dressed up as a token or USD figure") stays in the visible method line.

## Proof — head

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\proof\ProofSurface.tsx
- current: H1 + the adjudicated intro ("nothing here is measured on request") + a cross-link to Developers. No computed takeaway — the two statuses that matter are inside the two cards below.
- restructure: Takeaway line: computed from the manifest — "receipt ACCEPTED at pin X; serving batch #N" (or the failing arms). One-line method: the intro's not-measured-on-request clause.
- HAZARDS (never collapse): A REJECTED / absent receipt and a NO SERVABLE BATCH live subject must BOTH surface in the takeaway, not only in the cards — a head that says nothing while the receipt is rejected reads as a pass.

## Proof — ProofSubjectCard

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\proof\ProofSurface.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\evidence.ts, C:\Users\kasel\source\repos\etherfi\Solvent\web\lib\proof-data.ts
- current: Title + status badge (PROOF · EXACT @ PIN only on an unqualified pass) + caption (layer 3) + roughly eighteen `Row`s spanning receipt, build/config identity and feeds registry, all at identical weight. Every artifact string passes through `publishable()`, which can itself render a refusal in place of the value.
- restructure: Takeaway line: the status row — "ACCEPTED · every gated row welded exact", or the rejection detail. Visible: gated rows exact/total + drift, the per-engine welds, and the fingerprint weld. One-line method: the caption (pinned evidence, never the live batch). Forensic expandable: build/config identity, feeds registry path and hashes, comparison sha256, artifact path, receipt note.
- HAZARDS (never collapse): RECEIPT REJECTED and NO COMMITTED RECEIPT chips, the UNAVAILABLE row, `gated_drift > 0`, any weld where rows_exact ≠ rows_compared, the fingerprint MISMATCH arm, and every `pub()` refusal string (a publishability refusal is itself a refusal and may not be hidden).

## Proof — LiveSubjectCard + the two-subjects split strip

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\proof\ProofSurface.tsx
- current: Title + SERVING · WATERMARKED or NO SERVABLE BATCH chip + caption + four rows (batch, materialization key with copy affordance, substrate digest, identity note). Below both cards, an always-visible split strip stating that a green receipt does not make the live batch exact.
- restructure: Takeaway line: the serving batch id + status. Visible: the materialization key with its copy affordance. One-line method: the caption. Forensic expandable: substrate digest + identity note. The split strip stays fully visible — it is the law that prevents the receipt being read onto the live batch.
- HAZARDS (never collapse): NO SERVABLE BATCH chip; the em-dash materialization key with "no batch, no key; never fabricated"; the predates-substrate-digest honest-gap arm; and the split strip itself.

## Proof — probe records + manifest notes

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\proof\ProofSurface.tsx
- current: A bare list of publishability-checked record paths and notes, with an explicit "none named by this deployment's manifest" arm.
- restructure: Takeaway line: "N committed probe records". Forensic expandable: the paths and their notes. The "none named" arm stays visible rather than collapsing into a zero.
- HAZARDS (never collapse): `pub()` refusals inside record paths/notes, and the empty arm — an empty probe list is a statement about the deployment, not an absence to hide.

## Proof — raw JSON toggle

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\proof\ProofSurface.tsx
- current: A button toggling a `<pre>` of the whole manifest. Already the correct surface-scope forensic layer.
- restructure: Keep unchanged; treat as the reference for surface-scope layer 3 (as opposed to the EvidenceDrawer's per-number scope).
- HAZARDS (never collapse): None, PROVIDED no fact exists only here. The rollout must not move any refusal-bearing manifest field into raw-JSON-only reachability.

## Proof — stampline

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\proof\ProofSurface.tsx
- current: Four pins: batch, materialization key with copy, commit, and receipt result with its gated ratio, toned ok or crit off `proofSubjectStatus`.
- restructure: Apply the shared Stampline keepOpen split; the receipt pin stays inline whenever crit-toned.
- HAZARDS (never collapse): The crit-toned receipt pin, and the em-dash batch/key pins under a no-batch manifest (each carrying its own "nothing fabricated" note).

## Developers — head, base URL, TOC

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\developers\page.tsx
- current: H1 + the adjudicated intro + the contract version line + a cross-link + a base-URL block with its env-var-name note + a TOC of operations. Static, correctly single-layer.
- restructure: Takeaway line: "contract vX.Y.Z, N operations, read-only JSON, every money value a decimal string" (all three facts already exist in CONTRACT_META and OPERATIONS). Visible: base URL + TOC. One-line method: the env-var note.
- HAZARDS (never collapse): No served numbers here, but the "if a handler disagrees with this page, that is a failure, not documentation lag" clause is a method claim about the drift gate and stays visible.

## Developers — quickstart, EndpointCard, error envelope, provenance

- files: C:\Users\kasel\source\repos\etherfi\Solvent\web\app\developers\EndpointCard.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\developers\page.tsx, C:\Users\kasel\source\repos\etherfi\Solvent\web\app\developers\CodeBlock.tsx
- current: EndpointCard is the app's CLEANEST existing implementation of the adopted principle: head (method + path + summary) is the takeaway, description and params and the curl sample are visible, and the 200 response sample sits behind a `<details>` whose `<summary>` CITES ITS PROVENANCE (`· {exampleSource}`). SSE operations get a stated no-sample note rather than an invented body. Error cards mirror the shape. A provenance paragraph closes the page.
- restructure: Adopt the summary-cites-provenance convention app-wide — it is the single best pattern here for keeping an expandable honest. One concrete change: hoist the response-code chips ABOVE the sample `<details>`, so the non-2xx codes a caller must handle are visible before the happy-path body.
- HAZARDS (never collapse): The SSE "no JSON sample exists (or is invented) for a stream" note; every non-2xx response chip; the drift-gate provenance paragraph. Contract law constraint: every example must be a body the server can actually serve, so the rollout may restyle the disclosure but must keep rendering examples from `lib/proof-contract.gen.ts` only — never hand-authored substitutes.

