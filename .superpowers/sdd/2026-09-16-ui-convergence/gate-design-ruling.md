# Gate design ruling — Plan 4 (UI convergence): History · Activity · Verification · API

Design director, 2026-09-20. Advisory only; no repo source file edited. Judged from the production-build captures in
`scratchpad/gate5/` (1440x900, both themes, fold + full) against the owner-approved Book / Inspector / Scenarios
folds for REGISTER, and from source (`web/app/{observatory,feed,proof,developers}`, `web/lib/*-view.ts`,
`web/components/kit`, `web/components/charts/ObservatorySeriesChart.tsx`, `web/app/tokens.css`).

## Verdict

**NOT at the bar — eight register defects, all small, none structural.** The composition is right: the four pages
wear the kit's header, chips, tiles, cards and tables, and nothing about their IA needs reopening. What separates them
from the Book is a short list of things a visitor sees in the first second of a tab switch: the header sits 28px
higher than the Book's; a two- and three-line headline painted solid green, in a product where green means "nothing is
liquidatable"; seven-digit money with no separators and an ISO instant snapped in half at display size; a chart whose
three direct labels are struck through by its own line and rule (in finance typography a struck figure is a retracted
figure); a mono-prose strip carrying roadmap jargon ("P4's outbox"); an amount column whose digits do not align; and,
in the light theme, a white copy chip glowing on the black terminal block. Land Tier A and the pages are the same
product as the Book: **SHIP the pins after Tier A**. Tier B is worth the same round. The y-domain is NOT a defect
(ruling 4) and goes to the owner's list fully specified.

Not judged: hover, degraded, refused and empty states — no captures were supplied (see B10). A chart is not done until
resting, hover, both themes and degraded are all at the bar; this ruling covers resting + both themes only.

---

## The seven observations — confirm / correct / overrule

1. **Top padding — CONFIRMED, with a correction.** `book.module.css:3` has `.page { padding: 28px 0 24px; }` — that is
   the mockup's `.body` vertical padding (`kit.module.css:27`), i.e. the canon. The four pages have none, so the kicker
   centre sits at y=65 vs the Book's y=93. Correction: the approved Scenarios page ALSO has none (kicker y=69, the
   library's top border touches the appbar rule) — it is the same defect, already pinned. Do not converge on the lab's
   zero; converge on the Book's 28 (A1), and put the shell-level fix on the owner's list (C5).

2. **Headline colour — CONFIRMED, and R2's tone rule is OVERRULED.** On the Book and Inspector `ok` green is a HEALTH
   VERDICT ("No position is liquidatable", `book-headline.ts:151`). R2 re-used it to mean "the data answered". One
   green, two meanings — the Bloomberg severity law (a colour means one thing, everywhere) is broken, and on History
   it is worse than inconsistent: the clause "2 of the 168 buckets have no complete batch, 1 withheld" is rendered in
   the colour of health. That is a softened honest state (canon law 1: honesty is the aesthetic). A statement of
   record is INK. Only Verification has a verdict, and only its proof clause may wear it — painting "serving batch #1"
   green lets the live subject inherit the proof's colour, which the page's own doctrine forbids ("does not inherit
   this exactness", `evidence.ts` PROVEN_NOTE). See A2.

3. **Headline grammar — what the TYPOGRAPHY needs (words are the clarity director's).** (a) every figure >= 1,000 is
   grouped — at 30px "$1900000" cannot be read for magnitude, and misreading magnitude is a material error on a risk
   desk (Stripe: money is grouped, always); register parity with the Book says the H1/dek use the human tier
   (`humanUsd`: "$1.9M") and the exact grouped string lives in the record card; (b) no "(s)" — three parenthetical
   plurals in one display line read as an unfinished template; `lab-headline.ts:38` already has the pluraliser shape;
   (c) the H1 opens with a capital; an all-caps enum ("ACCEPTED") inside a 30px semibold line shouts twice — tone
   already carries it; the verbatim enum stays in the Proof subject's `status` row; (d) an ISO instant never breaks
   mid-token — History's H1 currently breaks "2026-08-" / "08T20:00:00Z"; (e) budget: H1 <= 2 lines at 1440
   (860px measure, ~110 characters). See A3.

4. **History chart — split ruling.** DEFECT NOW: the three label collisions and the plot height (A4). NOT A DEFECT:
   the zero baseline. A zero-based axis is an honest, previously ruled law (`ObservatorySeriesChart.tsx:12-13`), and a
   flat line IS the true picture of a 1% week at that scale. Changing the domain amends an honesty law; it is
   owner's-list item C1, specified in the Appendix so it is one approval away. NEVER the cheap route:
   `includeZero={false}` alone auto-fits the noise to the full height (anti-canon: manufactured volatility) AND draws
   no floor label at all (a hidden floor).

5. **Activity — all four CONFIRMED.** Mono prose is the pre-kit stampline register; no approved page sets a sentence
   in mono (mono = identifiers and exact values only — Berkeley/Stripe). "P4's outbox" is roadmap jargon on a public
   surface and is doctrine under R3 (A5). An H2 that begins with another page's nav label is an IA collision (A7).
   The amount column breaks decimal alignment because a variable-length all-caps tag trails each number, and the
   loudest texture in the table is its least important datum (A6). The stacked notes put the table's first row at
   y=790 of 900 on a page whose job is the table (B4).

6. **API — all four CONFIRMED.** A count is a measure, not identity: `Operations 17` is said by the chip, the tile and
   the headline within 200px; Base URL by a chip and a strip (B5). Tiles without subs are dead panels (B5). Wrapped
   pills for the endpoint index are the wrong FORM: one tab to the left the same pill shape is a pressable filter
   (`aria-pressed`); here it is an anchor. Linear: one form, one function. An endpoint index is aligned mono rows (B6).

7. **Verification — hierarchy is AT the Book's register; density has one fault.** Header -> SectionHead -> tiles ->
   cards -> SectionHead -> table is the Book's skeleton. The fault is repetition: "87/87" appears five times in one
   viewport (chip, tile, step caption, receipt strip, proof row). Keep the chip, tile, receipt strip (it is the state
   carrier when the receipt drifts or fails) and the proof row; fold the step kickers into the tile labels (B8). Two
   finish faults: the 64-hex key breaks mid-token, right-aligned; the two cards have a ragged bottom edge (B8).

---

## TIER A — register defects; land before the pixel pins are committed

Ranked. Each: file(s) · exact change · what it looks like after.

### A1 · The four pages take the Book's page padding
- Files: `web/app/observatory/history.module.css:5`, `web/app/feed/activity.module.css:6`,
  `web/app/proof/verification.module.css:5`, `web/app/developers/api.module.css:5`.
- Change: add `padding: 28px 0 24px;` to each `.page` rule (the Book's exact values, `book.module.css:3`; the
  mockup's `.body`). Nothing else.
- After: kicker centre at y=93 on all four, identical to the Book; switching Book -> History -> Activity ->
  Verification -> API the kicker, H1 and chip row do not move vertically (except by headline line count).
- Cite: Linear (a small number of decisions applied with total consistency); spec 2026-09-15 mockup `.body`.

### A2 · A record is ink; only a verdict wears tone (overrules R2's tone clause)
- Files: `web/components/kit/VerdictHeader.tsx`, `web/components/kit/kit.module.css`, `web/lib/lab-headline.ts:17`
  (`LabHeadline.tone`), `web/lib/history-view.ts` (the ok arm of `deriveHistoryView`), `web/lib/activity-view.ts:~311`,
  `web/lib/api-view.ts` (headline), `web/lib/verification-view.ts:712`, `web/lib/evidence.ts:701-715`.
- Change:
  1. Kit: add `"neutral"` to the `tone` union in `VerdictHeaderProps` and `LabHeadline`; add `neutral: styles.emNeutral`
     to `EM_CLASS`; add `.emNeutral { color: var(--ink); }` beside `.emOk` (`kit.module.css:35`). `data-variant`
     becomes `neutral`. No approved page passes it, so no approved pin moves.
  2. History (answered), Activity (ok / exhausted), API: `tone: "neutral"`. `refused` arms unchanged (ink-2 + dashed
     chips/tiles: colour AND form).
  3. History when holes exist: the headline stays ink; severity is carried where it already lives — the `Buckets`
     chip (`tone: "warn"`, amber border + amber value). Do NOT tone the H1 warn: amber on "Debt $1.9M ..." would say
     the debt is the warning.
  4. Verification: split at the semicolon the sentence is already built from. `emphasis` = the proof arm + ";" with
     `tone: receipt === "exact" ? "ok" : "warn"`; `rest` = the live arm + "." in ink. Expose the two arms from
     `evidence.ts` (e.g. `proofTakeawayArms(manifest): { proof: string; live: string }`, with `proofTakeaway` composed
     from it so the sentence cannot drift).
- After: History / Activity / API headlines are `--ink` in both themes, exactly the weight and colour of the Book's
  "across 2 accounts." clause. Verification reads green "Receipt accepted at pin 5f0b3e2a;" + ink "serving batch #1
  under its watermark vector." — the Book's own emphasis/rest pattern, and the page's "two subjects, never one" law
  made visible in the H1.
- Light theme: this removes the `--ok-text` #27784d wall, which is heavier on `--bg` #f4f6f6 than the dark pairing.
- Cite: Bloomberg (severity colour means one thing); FT (colour used semantically and sparingly); canon law 1.

### A3 · Headline typography: grouped figures, no "(s)", capital initial, unbreakable instants
- Files: `web/lib/observatory-series.ts:164-176` (`displayMetric` — the declared single chokepoint for the headline,
  the finding line, the chart labels and the bucket record), `:418-452` (`observatoryTakeaway`), `:460+`
  (`gridReadingLine`), `web/lib/feed-view.ts:218-245` (`feedTakeaway`), `web/lib/evidence.ts:704-713`,
  `web/components/kit/VerdictHeader.tsx`, `web/components/kit/kit.module.css`.
- Change:
  1. `displayMetric`: money through `groupDecimalString(...)` (`lib/book-format.ts:16`, already used by
     `feed-view.scaled`); populations through `groupInt(...)` (`lib/prose.ts:14`). One edit fixes "$1900000",
     "$1919760", "$1911400 -> $1900000", "8643 -> 8552" and the bucket record at once. `observatoryTakeaway`'s own
     `String(readWirePopulation(...))` for accounts -> `groupInt(...)`.
  2. Real plurals in `observatoryTakeaway` and `feedTakeaway` (the `accounts(n)` shape in `lab-headline.ts:38`).
  3. `proofTakeaway`'s first arm opens with a capital. (Enum case and the human tier in the H1 are the clarity
     director's; my requirement is only (a)-(e) of ruling 3.)
  4. Kit: in `VerdictHeader`, render `emphasis` and `rest` through a splitter on
     `/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)/` that wraps each match in `<span className={styles.nobr}>`;
     `.nobr { white-space: nowrap; font-variant-numeric: tabular-nums; }`. The string is untouched (copy/paste and
     test text equality hold); only the break opportunity goes. No approved headline contains an instant.
- After: History H1 reads (words illustrative) "Debt $1,900,000 across 8,552 accounts as of bucket
  2026-08-08T20:00:00Z; 2 of the 168 buckets ..." in ink, the instant whole on one line. Activity: "50 chain actions
  loaded, 3 liquidations ...".
- Cite: Stripe (money typography); FT (the title states the finding, legibly).

### A4 · History chart: no label is struck through; the plot is sized to what it shows
- Files: `web/components/charts/ObservatorySeriesChart.tsx`, `web/app/observatory/HistoryChart.tsx:43`.
- Cause (geometry, not data): one `pad = 6` serves all four sides. With a zero floor and a flat series, `y(max) = 6`,
  so the y-max label's baseline `Math.max(12, y(max) + 4)` = 12 and the newest label's clamp `Math.max(12, ...)` = 12
  both put 12px glyphs (y 2..12) across a line at y 6..8; the zero label's `Math.min(height - 2, y(0) + 10)` = 198
  straddles the rule at y=194. All three `<text>` nodes are also painted BEFORE the line, so the line wins.
- Change:
  1. Vertical pads split: `const padX = 6, padTop = 22, padBottom = 6;` `x()` uses `padX`; `y(value) = height -
     padBottom - ((value - min) / span) * (height - padTop - padBottom)`; gap ticks run `y1={padTop}` to
     `y2={height - padBottom}`; the withheld square sits at `y={padTop}`.
  2. FT gridline idiom — every label sits ABOVE its reference, never on it: y-max label `y={y(max) - 6}`; newest
     value label `y={Math.max(12, y(newestValue) - 8)}` (with `padTop = 22` the baseline is never below 14, so the
     old lower clamp is unnecessary); zero label `y={y(0) - 4}`.
  3. Paint order: move the three `<text>` blocks after the points in the JSX, and give each the D3 halo inline (the
     file's convention is "everything new is inline", and the shared `.axisLabel` / `.valueLabel` atoms must not
     change under other charts' pins): `style={{ paintOrder: "stroke", stroke: "var(--panel)", strokeWidth: 3,
     strokeLinejoin: "round" }}`. A residual overlap can then never strike a glyph, in either theme.
  4. `PLOT_HEIGHT = 200` -> `120`. A zero-based flat series does not earn a 200px hall (Tufte: sparkline proportions
     for a sparkline's worth of shape); the freed 80px brings the Bucket record toward the fold.
  No pin reads a y coordinate (`history.spec.ts` asserts label TEXT only), so nothing re-expresses.
- After: "$1,919,760" sits clear above the line's left end, "$1,900,000" clear above the ringed newest point, "0"
  rests on top of the solid floor rule at the left; the line is unbroken by text; the card is ~80px shorter.
- Light theme: the halo uses `--panel`, so it is white on white there and #131c20 on dark — invisible at rest in both.
- Cite: Bostock (direct labels, deliberate margins); FT (labels on the gridline); Tufte (data-ink, proportion).

### A5 · Activity's live strip leaves the mono-prose register; the roadmap sentence goes to the drawer
- Files: `web/app/feed/activity.module.css:10-32`, `web/app/feed/FeedLiveStrip.tsx` (the `.liveLaw` span),
  `web/lib/activity-view.ts` (doctrine).
- Change: `.live` drops `font-family: var(--mono)`; `font-size: var(--type-body)`; keep `color: var(--ink-2)`,
  border, radius, `--panel`. `.liveLabel` and `.liveChip` keep their small-caps form at `var(--type-small)` (the
  same grammar as `.groupLabel` two rows below). `.live b` gains `font-family: var(--mono); font-size:
  var(--type-mono-sm);` — numbers and batch ids are the only mono on the strip. Delete the `.liveLaw` span from the
  component; its sentence moves (reworded by the clarity director) into the Activity doctrine in the lib. The law
  stays printed ON the instrument in a few words: label "Live posture · this connection only". The dek already
  states the rest ("The live strip and the paged record never blend.").
- After: one 40px line in sans: `LIVE POSTURE · THIS CONNECTION ONLY  (dot) RECONNECTING  no batch delivered on this
  connection`. Nothing on the public page names P4 or an outbox.
- Cite: R3 (doctrine -> drawer); Berkeley Graphics (mono for identifiers, not prose); anti-canon (internal
  vocabulary on a data surface).

### A6 · Activity's Amount column aligns; the unit gets its own quiet column
- Files: `web/app/feed/ActivityTable.tsx` (COLUMNS + the `amount` cell), `web/app/feed/activity.module.css:59`.
- Change: split the cell. `amount` (right-aligned) renders only `<span className={kit.addr}
  data-testid="activity-amount">`; add `{ key: "unit", header: "Unit" }` after it rendering the existing
  `<span className={styles.unit} data-testid="activity-unit" title=...>`. `.unit`: remove `text-transform:
  uppercase` and `letter-spacing`, remove `margin-left`, keep `font-size: var(--type-floor); color: var(--ink-3)`.
  `record-only` is not a value and must not be the heaviest ink in the column: render it
  `<span className={kit.sub}>record-only</span>` (kit `.sub`: `--ink-3`, `--type-floor`, sans).
  The raw integer stays verbatim (the wire law); alignment, not reformatting, is the fix. Test ids unchanged.
- After: a clean right edge of digits under "Amount" as on the Book's Debt column; "normalized debt · raw units ·
  USDC" in dim lower-case in its own left-aligned column; record-only rows recede.
- Note: the raw-units state in the capture is partly a pin artefact — the stream is aborted, so
  `engineValueDecimals` never arrives. Live, Cash rows scale. Leave the pin honest as captured.
- Cite: Stripe (decimal alignment; units never float away from values); Bloomberg (aligned mono columns).

### A7 · Activity's H2 does not start with another page's nav label
- File: `web/lib/activity-view.ts:149` (`ACTIVITY_LIST_TITLE = "History: recorded chain actions"`).
- Change: the title drops the "History:" prefix (wording to the clarity director; typographic requirement: an H2
  never begins with a nav label of a different page). Suggested shape: title "Recorded chain actions", with the
  order sentence's short form as the SectionHead `qualifier` (see B4). The doctrine array carries the same constant,
  so the drawer follows.
- Cite: Linear (one name, one thing).

### A8 · LIGHT THEME · the copy chip on the terminal ground
- Files: `web/app/developers/api.module.css:40` (and the same pairing wherever `CopyChip` sits on `--term-bg`).
- Cause: `CopyChip` is styled by `verification.module.css:43` with `background: var(--panel); border-color:
  var(--line); color: var(--ink-3)` — correct on a card, but on `--term-bg` (#10181b, constant in both themes) the
  light theme paints a white chip with a pale border: the brightest object in the API fold.
- Change: `.codeCopy button { background: transparent; border-color: var(--term-dim); color: var(--term-dim); }`
  `.codeCopy button:hover { color: var(--term-accent); border-color: var(--term-accent); }` (`--term-dim` is 4.54:1
  on the worst term ground — tokens.css:48; "no new pair").
- After: the chip is a quiet outlined glyph on the terminal block in BOTH themes, as it already appears in dark.
- Cite: canon (both themes first-class); Stripe docs (the copy affordance belongs to the code block's palette).

---

## TIER B — cheap, same round (<= ~20 lines each)

- **B1 · History opens on Cash.** `HistorySurface.tsx` `useState("debt_manager")`; `OBSERVATORY_ENGINES` order Cash
  first. The product is "ether.fi Cash risk"; the Book demotes the legacy market to a fold at the foot; History's
  first viewport currently reads "HISTORY · AAVE V3 MARKET (LEGACY)". The pin captures the default — decide before
  pinning. (Plan Task 3 says "default as today"; this is a behaviour change, integrator's call.)
- **B2 · The header action stays on row one when chips wrap.** `IdentityChips.tsx` + `kit.module.css:39`: wrap the
  chips in an inner flex-wrap div; `.meta` becomes `display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; gap: 10px`. One-row headers are pixel-identical (approved pins hold); History's fifth chip
  then wraps under the chips, not under the button.
- **B3 · One pressed-toggle grammar.** History's engine switch is a full-size `.btn` (37px) with `--chip-bg` fill;
  Activity's is chip-size (27px) with an 8% accent tint. Move one rule into the kit —
  `.btnGhost[aria-pressed="true"] { border-color: var(--accent); color: var(--accent-text); background:
  color-mix(in srgb, var(--accent) 8%, transparent); }` — delete the two page-local copies
  (`history.module.css:11-12`, `activity.module.css:40`), and size History's engine switch like Activity's
  (`padding: 4px 10px; font-size: var(--type-small)`). Optionally seat it at the right of a `kit.sec` row whose h2
  is the engine name — the Book's "Cash ... Legacy Aave v3 market" grammar.
- **B4 · Activity: two control rows, then the table.** The cross-engine `since_block` note (3 wrapped lines, shown by
  default) becomes one dim inline item at the end of the TYPE row ("since block · one engine only", full sentence in
  `title` and in the drawer); the order note becomes the SectionHead `qualifier` in short form, full sentence in the
  drawer. Keep `activity-since` / `activity-order` ids on the short forms. Buys ~90px: six more rows in the fold.
- **B5 · Say each fact once (Activity, API).** Drop the `Rows` chip (a measure; the tile owns it) and the
  `Operations` chip. API: delete the Base URL strip (the mono identity chip states it in full; the quickstart below
  carries it copyably) — or keep the strip and drop the chip, but not both. Give the two bare tiles subs from data
  already on the page: Operations -> verb census ("15 GET · 2 POST" from `OPERATIONS`), Error responses -> the status
  list ("400 · 404 · 409 · 429 · 500 · 503" from `ERROR_RESPONSES`). No tile without a sub.
- **B6 · API endpoint index as aligned mono rows.** `api.module.css:16-18` + the `<a>` in `ApiSurface.tsx`:
  `.toc { columns: 3; column-gap: 24px; }`; each anchor `display: grid; grid-template-columns: 5ch minmax(0, 1fr);
  gap: 8px; padding: 3px 0; border: 0; font-family: var(--mono); font-size: var(--type-small);` with the method in
  its own span coloured as the cards' `.verb` (GET `--accent-text`, POST `--warn-text`). Drop `kit.btn` from the
  anchors. Same height as today's three pill rows, scannable down a verb column (Stripe API reference; Bloomberg).
- **B7 · API prose reflows.** `.description` / `.paramDescription` use `white-space: pre-wrap`, so the YAML's hard
  wraps print as a ragged ~470px column in a 1190px card. Split on blank lines into `<p>`, join single newlines with
  a space, set `max-width: 720px` (the canon's prose measure, `globals.css .prose`). Words unchanged.
- **B8 · Verification finish.** (a) tile labels become "01 · Index" ... "04 · Serve" and the `.stepNum` kicker above
  each sentence is removed (one label per step, not two); (b) `.subjects { align-items: stretch; }` — cards in a row
  share a bottom edge, as on the Book; (c) identifier rows stack: `.row:has(.ident) { flex-direction: column; gap:
  4px; } .row:has(.ident) .v { text-align: left; }` — the 64-hex key (480px at 12.5px mono) then fits one line of
  the 568px card instead of breaking mid-token, right-aligned.
- **B9 · Chart resting state reads as a line.** 168 points at a 7.4px step with `r={2.4}` is a bead chain. `r` =
  `step < 10 ? 1.5 : 2.4` for the visible dot; hit targets unchanged. Resting calm, hover precise.
- **B10 · Capture the honest states for the owner's pack.** Add to `screenshot-pages.mjs`: History degraded (503
  fixture), Activity refused + exhausted, Verification receipt-failed + unavailable. They are the product's identity
  and are currently unjudged.

## TIER C — owner's list (one line each; C1 is specified in the Appendix)

- **C1** History y-axis: the level-anchored band with a disclosed non-zero floor (amends the zero-floor law).
- **C2** Chart ergonomics: a crosshair readout following the pointer (TradingView) in place of native `<title>`
  tooltips; roving tabindex with arrow keys in place of 168 tab stops.
- **C3** History as small multiples: four stacked sparkline-height panels on one x-axis instead of a metric toggle
  (Tufte: small multiples where comparison is the task).
- **C4** Activity's live posture as the third KPI tile — dashed/refused when the connection has no base frame.
- **C5** Hoist the 28px page top padding into `.shell`, delete per-page paddings, and re-baseline Scenarios (whose
  approved pin carries zero).
- **C6** API docs craft: inline code/bold rendering for the contract's backticks and asterisks (they print literally
  today); a sticky endpoint rail at >= 1440.
- **C7** Verification proof card: colour by exception (five green values in a column carry no signal); revisit the
  coloured card top rules against the kit's card grammar.
- **C8** History's bucket record as the chart's right rail (`kit.gridRail`, 8fr/4fr) so the selection readout sits
  beside the selection.
- **C9** Activity "When" column: compact instant with the full ISO in `title`; History tile subs stating the bucket
  once when all four agree.
- **C10** (Seen while comparing, not this gate) the Book's distance-chart card stretches to the table's height and
  holds ~450px of void below its bars.

---

## Appendix — C1 specified: what y-domain is honest AND legible for a series that moves 1% in a week

**Principle.** Auto-fit manufactures drama because the axis span tracks the NOISE: a quiet week is stretched to the
same height as a violent one. A zero floor wastes the plot because the span tracks a value the series never visits.
The honest middle anchors the span to the LEVEL: equal relative moves draw at equal heights, in every window and for
both engines, so volatility can be neither manufactured nor hidden.

**Rule (pure function beside `buildMetricSeries`, unit-pinned first):** with L = max, R = max - min of the finite
values:
1. `liquidatable_positions` is ALWAYS zero-based — its zero is a reachable, meaningful state (it is what the desk
   hopes to see), so the floor stays on the axis. Also zero-based: L < 20, min <= 0, or R >= 0.5 L.
2. Otherwise span S = max(0.10 L, 2 R); step s = the {1, 2, 2.5, 5} x 10^k that yields 2-4 intervals; lo =
   floor((mid - S/2) / s) s; hi = lo + ceil(S / s) s; widen by s until lo <= min and hi >= max; if lo <= 0 fall back
   to zero-based.
3. Demo, Aave debt: L = 1,919,760, R = 19,760 (1.03%) -> S = 191,976, s = 50,000 -> **[$1.80M, $2.00M]**; the series
   rides at 50-60% of the height and the week's 1% move draws as ~10% of it: visible shape, no theatre.

**Disclosure — all three, or the band does not ship (colour-AND-form, applied to an axis):**
1. TICKS: floor and ceiling wear their values in the tiles' own formatter ("$1.80M", "$2.00M"), sitting above their
   rules (A4's idiom).
2. FORM: the solid `.baseline` rule means ZERO and only zero. A non-zero floor is drawn as a broken hairline
   (`stroke-dasharray: 2 3`, `--ink-3`) with an axis-break mark at its left end. Solid = zero, broken = not zero —
   one meaning each, everywhere (FT: no heavy baseline unless it is zero).
3. WORDS BEFORE THE VISUAL: the card's existing state-line slot prints, from the lib, e.g. "Y-axis runs $1.80M to
   $2.00M, not from zero; this window's range is 1.0% of the level." — the percentage by bigint string work, never a
   float. Plus `data-y-floor="nonzero|zero"` on the svg for the pins.

Masters: Tufte (show the data, not the distance to zero — but never a lie factor); Bostock (scales for the data's
actual domain, ticks on honest round numbers); FT (baseline weight reserved for zero); canon law "scales never
fabricate drama or hide a floor".
