# Design gate — verdicts and the merged must-fix list (verbatim, rendered)

Workflow wf_45a39953-b8f on 108 fresh captures of the build at `53f16bf`, compared with the before set.

## Visual director (solvent-design) — at the bar: False

The build is now one instrument. One frame (every kicker at y=93, x=104 at 1440 and x=224 at 1920, with the header brand on the same edge), one tone grammar (live is accent, fresh is ink, green only for a verdict or a passed check, a failed receipt crit everywhere), one time grammar, one money and percent register in the columns, one chart family, and failure states in reader words. Against the before captures it is a large, visible step up in both themes and at all three widths, and the phone header, Book bars, Activity table and Scenarios answer-first order went from broken to deliberate. It is not yet at the Linear/Stripe/FT bar. One chart still breaks the floor law: the Inspector's large room chart is auto-fitted to 3.8%, while its own Trust sparkline is 0-based. The new composition also brings its own clutter: two filled primary buttons on the Overview and on Scenarios before a run, band labels jammed against the Book chart card's edge, lines that mix money registers, half-empty tile rows, a panel-coloured slab down the phone Activity table, and stress tables whose one column holds two units. The 14 items below are what separates this from the bar. The drawer-open and chart-hover states were not captured, so they are uncertified.

**Fixed well**
- One page frame owned by the shell. Every page's first line sits at y=93, x=104 at 1440 (x=224 at 1920). The header brand aligns to the content column. The 1440 header is one 56px row with quiet icon controls (GitHub, theme). THEME · DARK and its uppercase register are gone.
- Phone header. It was four rows and about 165px (review/w390/*-fold). It is now brand + pill + icons plus one scrolling nav strip with an edge fade, about 92px (gate/w390/*-fold).
- Tone grammar (K3/R1/R2/R12). The live dot is accent, and the Snapshot and Lookup chips are ink. Green now appears only on health verdicts and passed checks (Trust ticks, the exact receipt). The Verification live card is accent-ruled. verificationFailed is crit on the headline, step 03, chip, strip, card rule and pill: one receipt, one tone.
- Time grammar (R5). Headlines, chips, tile subs and axis ends use 'Aug 8, 20:22 UTC'. Table columns use 'When (UTC)' with the typeset exact instant '2026-08-08 20:21:05' in plain tabular sans. No raw T/Z at reader altitude, and no token breaks mid-line.
- Book Needs attention. The Debt column uses whole dollars ('$12,621', '$45,061'). 'Room to cap' is one signed unit ('−4.2%' crit, '0.3%'). 'No verdict' is the state word across tile, dek and rows. The dek is three factual sentences. 'Current, not projected' is canon wording.
- Book composition (B2). The ~520px void under the bars is gone, and Stress preview and Bad debt stack under the chart beside the table.
- Charts are one family. Labels are sans in ink. History's peak and newest labels are in the book register ('Peak $27.9M', '$27.8M'), with the exact value moved to the record card's copyable value. The Inspector's 10% line wears warn and is direct-labelled '10% of cap' in both the chart and the Trust sparkline.
- Scenarios. One name per scenario ('ETH −30%', 'Cash borrow APY +200 bps', U+2212 everywhere), and library gists are one or two lines instead of 5–8-line paragraphs. The heatmap is readable: sqrt intensity, so 135/129 now read darker than 14/13, and empty cells are quiet outlines. The tile counts the heatmap's own population (425). Compare leads with one headline story, and the legacy fold is a sibling, never nested.
- One PROJECTION badge per projected container: Book Stress preview, Overview Scenarios entry, Inspector 'Stress this address', Scenarios address table. '(PROJECTION)' no longer appears inside names.
- Activity. Records are ink with sentence-case types, and liquidation rows are marked by weight, not crit pills. Controls are joined ToggleGroups with visible labels, clearly distinct from the identity chips. Engines are listed Cash first. Raw integers are grouped ('180,771,428 raw units'). The display minus is U+2212.
- Failure states speak reader words. History degraded, Activity refused and Verification unavailable each state a plain cause, and the service's verbatim words sit under 'What the service said'. Refused (dashed) and unavailable / not served (solid) have distinct frames. Tiles print 'Refused' / 'Not run' / 'Unavailable', never an em dash.
- API. Verbs, 'required' and 4xx/5xx chips are neutral contract vocabulary. The kicker keeps 'v1.8.0' in its own case. Code blocks are framed with a label bar and a non-overlapping copy button in both themes.
- Phone. Book bars go horizontal with no collisions. Tables scroll in named regions with a sticky first column and never lose a column. Scenarios puts the answer before the library. The Overview hero no longer runs to eight lines.
- Dark and light are equally finished on every page. The light entry cards no longer read as disabled (panel, radius 10).

**Regressions**
- Overview hero CTA row now has two filled primary buttons: 'Open the book' plus the AddressField's new filled 'Inspect' (design-gate/w1440/overview-*-fold, w1920/overview-*-fold). Before, and in the canon front-door.html:121, there is one primary plus a field. At 390 the two primaries stack, and the field reads only '0x…' because the hint is visually hidden (before: 'Inspect an address · 0x...').
- Scenarios before a run (labBare-*-fold) now shows two identical filled 'Run ETH −30%' buttons in one viewport: the new header action and the rail footer.
- Book 'Distance to liquidation' now that the card hugs its content (B2): the band-label row overflows the 160px .bars box, so 'Over cap' … '≥ 50% room' sit about 5px from the card's bottom border against 18px padding elsewhere (design-gate/w1440/book-*-full at y≈785–793; same at w1920). The stretched card hid this before.
- Book Stress preview and the Overview micro-stat: the new 'delta, to level' framing mixes registers inside one line ('bad debt +$964.39, to $1,204') and prints identical figures for different values ('+$118K, to $118K'). Before, each line had one register ('bad debt $1,204').
- Activity and API tile rows: two tiles in a 4-column grid now leave about 620px of empty row at 1440 (activity-*-fold, api-*-fold). Before, the two tiles spanned the row (a void of another kind).
- Legacy fold on Scenarios and Compare: the summary went from a plain title to slogans ('Its own result, in its own unit', 'Its own shares, on its own book'). This is doctrine-as-copy returning in a new place, while the Book's fold states a finding.
- Activity at 390: the new sticky first column paints var(--panel) over the page's --bg ground, leaving a white slab (light) or lighter strip (dark) down the When column (design-gate/w390/activity-*-full). The table itself is far more legible than before.

**Must fix (as judged)**
- Inspector room chart hides its floor: y-domain auto-fitted to the account's own minimum (major) — An account 3.8% from its cap is drawn as if it had hit bottom. That is an auto-scaled axis manufacturing drama (anti-canon; Tufte/Bostock floor law), and two charts of one series on one page use two floor rules. The most important reference, the cap, is missing. The FT desk would annotate it.
- One primary per viewport: Overview CTA row and Scenarios before a run (major) — Two competing primary actions split the eye. The canon hero has exactly one primary ('Open the book', front-door.html:121), and Linear's restraint is one decision per view. On a phone the address field has no visible purpose.
- Stress tables: one unit per column, and one table design on Inspector and Scenarios (major) — The FT/Stripe law 'one column, one unit' was applied to the Book (R4) but not here. The same record gets two table designs, and on a phone the verdicts are pushed out of sight.
- Activity (and Verification probes) table: in a card like every other table; sticky column follows its ground (major) — One record type gets two framings. The sticky cell's ground contradicts its surroundings and draws a slab that looks like a rendering bug on the phone.
- Book bar chart: labels overflow the plot box into the card padding (major) — The Book's flagship chart looks cropped in both themes. A Bostock chart treats its margins as deliberate composition, and FT bars stand on a visible baseline.
- Stress preview: a scannable table with one money tier per column (major) — One sentence mixes cents and whole dollars, breaking the F3 rule that comparable figures share one register. Identical strings for different values read as a bug. A shock grid is a table, and the Bloomberg eye scans columns, not prose.
- Compare mode: library rows contradict the result (major) — A reader sees 'not run' beside the run's own result. It is the most visible contradiction left on the Scenarios page, and the numbers are already on the page, in CompareCard's rows.
- The refused row pill must wear the refused form (dashed) (minor) — Severity must be encoded in colour AND form. The one state register table (amendments §3 K4) makes the refused register dashed ink-3, and the canon refused chip is `1px dashed var(--ink-3)` (p5-ui-concept.html:173). The row contradicts its own tile.
- Half-empty tile rows on Activity and API (minor) — A void beside two small boxes is the card-grid anti-canon in a new shape: tiles sized by a grid, not by content, holding no new finding.
- History: record at a readable measure, and annotations on the marks (minor) — Key-value pairs 1,200px apart cannot be scanned (Bloomberg, Stripe). A direct label must sit on its datum (FT), and a legend where direct labels fit is anti-canon.
- Activity empty state: one filter source; no doctrine in the dek (minor) — The headline, control and tile disagree about the scope of the answer. A zero is printed for a type the answer's own filter excludes, where doctrine 1 wants 'Filtered out'. The dek is doctrine-as-copy (audit #16).
- Scenarios chips: the scenario's name, not its wire id; one form for 'Computed' (minor) — S1 set one name per scenario with the wire id on hover. Here the id is still at reader altitude and 'v1' is stated twice. The same chip label carries two time forms depending on mode.
- Legacy fold summary states the legacy finding on every page (minor) — The one recurring engine-separation component speaks a finding on one page and a slogan on two. The Book's line still uses 'refused', a word R9 retired for this population.
- Verification: say the pass once per altitude; fetch failure never reads as unreadable (minor) — Tufte would strike three of the five repeats. 'Could not be read' conflates a fetch failure with the unreadable state, which doctrine 1 keeps apart. A12's sentence case is missed.

## Information design and voice (solvent-clarity) — at the bar: False

Compared with the before captures, Solvent now reads as one product. One time grammar, money registers by altitude, one state vocabulary, failure states in reader words, and finding-first History and Compare pages have brought History, the Book, the Overview, the Inspector and the not-run and one-address Scenarios states to the bar or within a copy edit of it, and no doctrine regressed. It is not yet at the bar because a few first-viewport sentences still speak system language or contradict their own page: Activity's headline reports pagination and its dek implies a liquidation realized the bad debt, the stress tables' caption defines a dollar room over percent cells, the compare rail says "Not run yet" under the two scenarios it just ranked, the Scenarios chips print the wire id, and the failed receipt shows "exit 1" and uses three outcome words; every must-fix below is copy or order in web/lib (class A) except the compare rail's per-row outcomes (class B), so one fix round reaches the bar without touching a calculation or an honest state.

**Fixed well**
- History leads with its change: 'Cash debt rose $1.8M since Aug 1, 21:00 UTC, to $27.8M.'. The dek carries the other two moves and the missing hours, tiles say '+$1.8M since Aug 1, 21:00 UTC', chart labels read 'Peak $27.9M' / '$27.8M' with the exact value on hover, no raw ISO is left in chips, axis or record, Cash says 'Liquidatable accounts', and the record key reads 'Accounts with no verdict' (history-dark-full vs before).
- Failure states use reader words, with the service's text one click away under 'What the service said'. historyDegraded no longer shows 'observatory_points … Task B2, migration 00016', activityRefused no longer shows '400 bad_request … localhost:8080', and verificationUnavailable now says 'The service did not answer the proof request (HTTP 503), so there is no proof to show.'. Each state has one way forward ('Open the Book →', 'Start from the newest', 'Try again').
- One time grammar: humanUtc at reader altitude on every page. 'When (UTC)' columns print a typeset '2026-08-08 20:21:05' with the wire ISO in the title (Activity and the Inspector's Activity table).
- One Cash vocabulary: 'No verdict' on the Book tile, the row pill and the History record; 'account' in every Cash sentence and toggle ('Show 47 accounts under $100 ($109.45)'). The Book dek is three facts, and 'counted, not hidden' has moved to the drawer.
- Book: 'Room to cap' is one unit (−4.2% in crit, then 0.3%, 0.4%). The Debt column has one precision ($4,620, $12,621, $45,061). There is no stretched void under the bars, and the chart caption reconciles the over-cap bar with the headline. The Stress preview carries PROJECTION and frames bad debt as '+$40K, to $41K', the same figure Scenarios and the Overview show.
- One name per scenario, built from its definition: 'ETH −30%', 'ETHFI −50%' and 'Cash borrow APY +200 bps' on the Book, Overview, Inspector, rail, kicker, headline and Run button. One-line gists replace the five-to-eight-line wire descriptions with 'EXPLICITLY NOT' and 'HORIZON PROJECTION'.
- Scenarios answers one question per state. The tile counts the heatmap's own 425 (941 is in the title). labBare says 'ETH −30% has not been run.' in the absent register, with 'Run ETH −30%' in the header. labCompare's headline is the compare finding, the runner-up is in the dek, and no empty single-run tiles sit under it. labAddress colours only the verdict phrase. The movers table drops the all-'Yes' column and prints signed room ('−22.7%').
- Verification: one tone per receipt state. verificationFailed is crit in headline, chip, step, strip and card rule, and the live card is accent, never green. The StepStrip shares the Overview's names and ordinals, step 02 says 'computed Aug 8, 20:22 UTC', status strings are sentence case, and the drift-report path is gone from the tile.
- Activity: rows are records in ink (semibold type word, no crit pill). Raw integers are grouped ('180,771,428 raw units'). Chips are cut to Newest · Order · Loaded, none restating a control. Controls are ToggleGroups with Cash first. The bonus note appears once as a † footnote in reader words instead of in every liquidation row.
- Inspector: chips are ink under the amber verdict. Affordances are named for where they go ('Open in Scenarios →', 'Verification →'). The Stress section has one PROJECTION badge and no name carries '(PROJECTION)'. The sparkline reference is labelled '10% of cap', the history caption is one sentence ('A refused, withheld or missing batch is a gap in the line.'), and 'Counts toward cap' has one precision ($4,200 / $812 / $5,012).
- Front door and chrome: the header sits on the content column with quiet icon controls. The false 'RedStone' is gone (the footer and step 02 say PriceProvider v2). The live card is one line instead of the Book's four-sentence dek, its Scenarios micro-stat now carries its PROJECTION badge, and the Inspector entry says 'over cap by $184.80'.
- Arrow grammar holds: drawer openers carry no arrow ('How the bands are cut', 'Price inputs'), in-page jumps use '↓', links put '→' after the words, and the stress lines use a colon.
- Phones: the first viewport of the Book, Inspector, History and Scenarios now shows the headline, dek and chips, and on the Book and Scenarios the first tiles too. The Book's bars are horizontal and Needs attention fits 390 with its Status column intact. The Scenarios answer comes before the library.

**Regressions**
- Stress tables (inspector-dark-full, labAddress-dark-full): the A4 switch to signed percent left the caption defining a dollar room ('Room today: $190.50. Room after is the engine's own cap less debt under each scenario…', web/lib/inspector-view.ts:550-553) over '−28.6%' / '−4.7%' cells. labAddress's Room today column now prints '3.8%' three times beside a '$190.50' tile and the dek 'Room today $190.50.'. The before table ('$190.50 | over cap by $1,069') was internally consistent.
- labCompare: the new compare header's chip 'Computed Aug 8, 20:22 UTC' (web/lib/lab-view.ts:331) is a second format for the single run's 'Computed 42s ago' (web/app/lab/LabSurface.tsx:262): one label, two formats on one page family.
- Overview 'How it works' (overview-dark-full vs before): the step titles went from claims ('Reorg-safe indexer', 'Reconciled to chain', 'Public API + this UI') to bare verbs ('Index', 'Verify', 'Serve'). A10's shared names are right, but the front door lost its differentiators at title altitude. Lead each step's sentence with the claim, e.g. 'Reorg-safe: raw logs from OP Mainnet and Ethereum into Postgres…'.
- w390 Overview (overview-dark-fold): the address field lost its 'Inspect an address' hint (before: 'Inspect an address · 0x...'), leaving a bare '0x…' between two stacked filled buttons ('Open the book', 'Inspect').
- Horizons in prose: '90d' became '90 d' ('Stays inside its cap through 90 d' in the labAddress rail, 'Not within 90 d', '30 d: +$7.92 interest'). The nbsp age grammar applied to sentences and pills reads as a unit abbreviation mid-sentence.
- historyDegraded: the absence is now stated four times (H1 'No hourly history exists for Cash on this deployment yet.', dek, StateCard title 'No hourly history on this deployment', cause 'The hourly rollup is not available…'), where the before stated it twice. Net far better (no wire dump), but the card repeats instead of saying what fills the page.
- API (api-dark-full): the page grew from 12,301 to 12,897 px at 1440 (code-block header bars and bullet lists), with endpoint disclosure still deferred.

**Must fix (as judged)**
- Activity's headline reports pagination, and its dek attributes the bad-debt realization to a liquidation (major) — Law 1 (answer first) and doctrine 4 (every sentence true): the finding (liquidations and a bad-debt realization) is tangled with page mechanics the chips already state, and the dek's antecedent makes a first-time reader believe a liquidation realized the bad debt.
- Inspector and one-address stress tables: the caption describes dollars over percent cells, one column mixes units, and phones hide the verdict (major) — FT rule: one column, one unit, and a caption that defines what the cells print. The reader cannot compare '$190.50 today' with '−28.6% after', and a dollar interest figure sits in a percent column.
- Compare mode: the library rail says 'Not run yet' under the two scenarios the headline just ranked (major) — Law 5 and the page's own coherence: the first viewport contradicts itself. 'Not run yet' is true only of a single run, and a reader reads it as 'these numbers were not computed'.
- Verification (failed): the process exit code is in the status row, and one event has three outcome words (major) — P1 moved 'receipt verdict "fail" (exit 1)' off reader altitude, but it survived in the status row. Three words for one outcome read as three different events. A hiring evaluator reads 'exit 1' as a debug console.
- Scenarios chips print the wire id and the version twice, and 'Computed' has two formats (major) — The kicker already names the scenario in reader words ('ETH −30% · Cash book'), so a snake_case id in a chip is builder vocabulary at reader altitude. S1 said the wire id and version go to the name's title, but the chips kept them.
- Scenarios dek uses an unexplained 9.09%, and the heatmap caption leads with method (major) — Law 6 (one term of art above the fold, glossed) and the inverted pyramid: a first-time reader meets 9.09% beside the Book's 10% before any gloss, and the card's finding sits behind its method.
- On phones, the rows the page is about are the ones cut: Activity's liquidations and the Inspector's stress verdicts (major) — Law 2 (order by reader priority): on the device an evaluator often opens first, the verdict columns are the ones pushed out of view.
- verificationUnavailable uses the unreadable register's words for a fetch failure (minor) — The K4 register table keeps 'unavailable' (the fetch failed) and 'unreadable' (the page could not read the wire) as different words. Here one screen uses both for one failure.
- Book: the legacy fold says '0 refused' while its tiles say 'No verdict', and the jump link names the fold differently (minor) — R9 made 'No verdict' the one word for the engine-refused population. 'Refused' belongs to a service refusing a request (Activity), so the fold uses two words for one population.
- Book: an editorial clause in the dek, and a chart titled with its topic (minor) — FT chart-doctor rule: the title states the finding. Builder words ('headlined') do not belong in the lede.
- Verification's first viewport carries four terms of art (minor) — Law 6 allows one term of art above the fold, glossed. The dek already glosses the run ('a fixed, reproducible check'), so 'pinned' in the H1 and 'Proof pin' in a chip add jargon without adding information.
- Scenarios' legacy folds show a doctrine line where the finding belongs (minor) — Law 3: doctrine is load-bearing but sits at the wrong altitude here. A collapsed fold's summary is its information scent; the reader should know the legacy result without opening it.
- State pages repeat themselves instead of saying what fills them (minor) — Law 5: every state says what it means, why, and what fills it, once. Law 3: the assurance is doctrine in the lede.
- Stress preview prints a change and its total at two precisions (minor) — Two figures in one clause, where one is part of the other, should share one precision. A cents delta next to a whole-dollar total reads as sloppy.
- Grammar leftovers: range arrows and duration forms (minor) — A1 arrow grammar and one age grammar, both nearly complete. These remaining forms make a range look like a link and put a cell abbreviation into a sentence.

## Merged — at the bar: False

Not at the bar yet, but this is one fix round away. I opened every capture the two gates cited, plus the before shots, and read the code behind each finding. Against the before captures the build is now one instrument. It has one frame, one tone grammar, one time grammar, one set of money and percent registers in the columns, one chart family and failure states written in reader words. Both themes and all three widths improved visibly. No doctrine regressed.

What still separates it from the Linear, Stripe and FT bar falls into three groups.

(1) Three defects an evaluator notices in seconds:
- The Inspector's large room chart is auto-fitted to the account's own minimum. It hides the floor, and the cap line is not drawn.
- The Book's band labels touch the card edge.
- The Stress preview prints "+$118K, to $118K" for two different values.

(2) Places where one page contradicts itself or mixes registers:
- The front door and Scenarios before a run each show two filled primary buttons.
- The stress tables put dollars and percent in one column, under a caption that describes dollars.
- In Compare, the rail says "Not run yet" under the two scenarios the headline has just ranked.
- The failed receipt uses three different words for one outcome, and "exit 1" appears in the status row.

(3) Copy and composition leftovers: the Activity headline repeats its chips, Scenarios shows the wire id as a chip, legacy folds carry slogans, some tile rows are half empty, the History record is hard to scan, and the empty and failed states repeat themselves.

The 15 items below are ordered by impact. Each one is presentation only: none changes a calculation or softens an honest state. The Dek, chart titles and jump link on the Book are canon verbatim and stay.

Still uncertified: the open drawers and the chart hover states were never captured. The next capture pass must include the drawers, hover on the Inspector room chart, hover on the History chart, and activityExhausted produced through the real filtered flow.

Captures cited below are under C:/Users/kasel/AppData/Local/Temp/claude/C--Users-kasel-source-repos-etherfi-Solvent/07857daa-05b2-4c63-9012-61e6749cefcb/scratchpad/design-gate/ (and crops/ beside it).

### D1 · Inspector room chart shows its floor and the cap: no auto-fit to the account's own minimum (major)

**Spec.** 1. lib/room-history.ts: add `export function roomDomain(values: readonly (number | null)[]): { min: number; max: number }`. Let plotted = the finite values. Return `{ min: Math.min(0, ...plotted), max: Math.max(Number(NEAR_LINE_TENTHS) / 10 + 2, ...plotted) }`. Doc comment: '0% room is the cap. The domain always reaches it and never clips a negative (over-cap) room.'
2. TrustCard.tsx:30: replace the inline `domain={{ min: 0, … }}` with `domain={roomDomain(room.values)}`. The inline min 0 would clip an over-cap account's negative room.
3. HistoryCard.tsx, on the room MeasuredSparkline (lines 41-53): add `domain={roomDomain(room.values)}`, `boundaryValue={0}` and `boundaryLabel={CAP_LINE_LABEL}`. Keep referenceValue 10, referenceTone 'warn' and referenceLabel '10% of cap'.
4. lib/inspector-view.ts: `export const CAP_LINE_LABEL = "Borrow cap · 0%";`. The label names the line itself, so it stays true whether lineLabelBaseline places it above or below the line.
5. Verify all four states:
- Resting: the newest label '3.8%' clears both lines. Sparkline already passes both line Ys to the placement.
- Hover: point titles are unchanged.
- Both themes.
- Degraded: a gap stays a gap. An all-gap series draws no newest label. An over-cap account's line runs below the crit cap line and never leaves the plot.

**Evidence.** w1440/inspector-dark-full.png, 'Room under the borrow cap': the newest point (3.8%) lands exactly on the plot's bottom edge, and the 10% line sits about 23px above it. That puts the drawn domain at about 3.8–37%. The same holds on w390/inspector-dark-full (crops/insp390a).

The code confirms it:
- HistoryCard.tsx:41-53 passes no `domain`, so Sparkline.tsx:133-137 takes min = min(data, reference).
- TrustCard.tsx:30, which draws the same series 300px higher on the page, passes min 0. One series on one page gets two floor rules.
- The 0% line, where the account becomes liquidatable, is neither in the domain nor drawn, although Sparkline already supports boundaryValue and boundaryLabel (Sparkline.tsx:43-50, 176-181).

**Doctrine.** Chart law: a scale never fabricates drama or hides a floor. Anti-canon: auto-scaled axes that manufacture volatility.
- Tufte/Bostock: the domain is the data's honest domain, and 0% is the cap.
- FT desk: the threshold that matters is annotated on the chart itself.
- C2 tones hold: warn for the 10% line, crit only for the boundary.
- Gaps stay gaps, and exact values stay in the point titles.

### D2 · Stress tables (Inspector and one-address Scenarios): one unit per column, a caption that defines the cells, verdicts visible on a phone (major)

**Spec.** 1. address-stress.ts: add `horizonWords(seconds)`, the prose form of horizonLabel. Examples: '30 days', '1 day', '12 hours', '45 minutes', '<1 minute'. Join number and unit with U+00A0, and return UNREADABLE_HORIZON for a duration the population guard does not admit. horizonLabel ('30 d') stays for dense table cells only, e.g. the verdict pill 'Not within 90 d'.
2. address-stress.ts: add `projectionSubLine(horizons, decimals, absence)`, returning '+$7.92 interest by 30 days, +$23.77 by 90 days'.
- A horizon with null interest prints 'interest not computed by 30 days'.
- No scale prints scaleAbsenceWords.
- No horizon prints NO_HORIZON_WORDS.
3. address-stress.ts: add `export const PROJECTION_ROOM_CELL = { text: "Interest only", title: "A rate horizon holds prices flat; its extra interest by each horizon is listed under its name." }`.
4. address-stress.ts: move the agreement rule out of inspector-view.ts as `agreedRoomToday(rows, decimals, absence): { percent: string; dollars: string } | null`, where percent = roomCell(r.before).text and dollars = sideRoomWords(r.before). Add `export const STRESS_ROOM_DEFINITION = "Room after is the share of each scenario's cap left unborrowed; below zero, the account is over its cap.";`.
5. inspector-view.ts:550-553 stressCaption becomes `Room today: ${percent} of the cap (${dollars}). ${STRESS_ROOM_DEFINITION}`, dropping the lead when the rows disagree. This yields: 'Room today: 3.8% of the cap ($190.50). Room after is the share of each scenario's cap left unborrowed; below zero, the account is over its cap.'
6. StressTable.tsx and AddressWorkspace.tsx render the projection (rate) row the same way:
- The Room after cell is `<span title={PROJECTION_ROOM_CELL.title}>Interest only</span>` in var(--ink-2).
- The scenario cell's sub-line is `${PROJECTION_ROW_SUB} · ${projectionSubLine(...)}`, giving 'Rate horizon · prices held flat · +$7.92 interest by 30 days, +$23.77 by 90 days'.
- Spot rows are unchanged: signed fixed-tenths %, U+2212, crit when over, dollar room in the title.
7. AddressWorkspace.tsx: use the Inspector's column rule. Columns are [Scenario, Room after, Becomes liquidatable?] when agreedRoomToday is non-null; otherwise the Room today column stays. Add a `<p>` caption under the card that prints STRESS_ROOM_DEFINITION alone, since the tile and dek already state today's room. Leave AddressWorkspace.tsx:27's chip to item D10.
8. lab-address.ts: prose uses horizonWords. Examples: 'Stays inside its cap through 90 days', 'Becomes liquidatable within 30 days', and the dek '+$7.92 interest by 30 days; +$23.77 by 90 days'. The address-mode library row words follow the same rule.
9. Acceptance: at 390px the Inspector's Stress table shows Scenario, Room after and Becomes liquidatable? for all three rows without horizontal scroll.

**Evidence.** inspector-dark-full: the 'Room after' column holds '−28.6%', '−4.7%' and '30 d: +$7.92 interest · 90 d: +$23.77 interest' (projectionWords, address-stress.ts:263). The caption above those percent cells defines room in dollars: 'Room today: $190.50. Room after is the engine's own cap less debt under each scenario…' (inspector-view.ts:550-553).

labAddress-dark-full: a 'Room today' column repeats '3.8%' on every row, beside a '$190.50' tile and the dek 'Room today $190.50.'.

crops/insp390b (w390/inspector-dark-full): only the Scenario column is visible. The long interest string pushes Room after and the verdicts off-screen.

**Doctrine.** FT/Stripe: one column, one unit, and the caption defines what the cells print. S3's table rule now covers both surfaces, so one record gets one table design.

Honesty:
- 'Interest only' is a state word, never a blank or a dash.
- The unchanged spot room is never printed as if it were a shocked room.
- rowVerdict is untouched.
- The PROJECTION badge stays on the section head.
- Figures still truncate toward zero.

### D3 · One primary action per viewport: the Overview hero and Scenarios before a run (major)

**Spec.** 1. AddressField gets three new props:
- `inspectTone?: "primary" | "ghost"` (default "primary"). The submit uses `styles.btnGhost` when set to "ghost".
- `placeholder?: string` (default ADDRESS_FIELD.placeholder).
- `hintVisible?: boolean` (default true). When false, the hint gets the same visually-hidden rule the ≤640 block applies to `.searchHint` (kit.module.css:357), at every width. The hint stays the input's aria-describedby.
2. OverviewSurface.tsx:91 becomes `<AddressField … inspectTone="ghost" placeholder={CTA.addressPlaceholder} hintVisible={false} />`. lib/overview-copy.ts gets `CTA.addressPlaceholder = "Inspect an address · 0x…"` (U+2026), which is canon front-door.html:121 verbatim. The hero row then reads: [Open the book] primary · the field 'Inspect an address · 0x…' · [Inspect] ghost · [Run a stress scenario] ghost. At 390px the field keeps its words.
3. ScenarioLibrary's `run` prop gains `tone?: "primary" | "ghost"` (line 149 picks btnGhost for "ghost"). LabSurface.tsx:365-371 passes `tone: book.state === "not-run" && definition !== null ? "ghost" : "primary"`. In the served-not-run state the header's 'Run ETH −30%' (LabSurface.tsx:438) is then the one primary. Every other state is unchanged.
4. The Inspector and the Scenarios address field keep their primary Inspect, which is already the only primary on those views.

**Evidence.** - w1440/overview-dark-full and w1920/overview-*-fold: a filled 'Open the book' and a filled 'Inspect' sit side by side, because AddressField.tsx always renders btnPrimary.
- w390/overview-dark-fold: three stacked buttons, two of them filled, and the field reads only '0x…'. The hint is clipped at ≤640. The before capture read 'Inspect an address · 0x...'.
- w1440/labBare-dark-fold: two identical filled 'Run ETH −30%' buttons, one in the header at x≈909 and one at the rail foot at y≈684.

**Doctrine.** - Canon front-door.html:121 has exactly one primary plus a placeholder field.
- Linear restraint: one decision per view.
- S8 still holds: the header Run appears only in served-not-run.
- The field's strict 0x+40-hex refusal is unchanged.

### D4 · Book bar chart: the band labels overflow the plot box into the card padding (major)

**Spec.** 1. kit.module.css:190: `.bars { … height: auto; min-height: 160px; }`.
2. kit.module.css:191: `.bar { … height: auto; }`.
3. The grid's `align-items: end` puts every column on one bottom, so the bars share a baseline. The tallest column (MAX_PX 128 + count row + label row ≈ 177px) now fits instead of spilling into the card padding.
4. Leave MAX_PX 128, MIN_PX 4 and the ≤640 horizontal-bars rule untouched.
5. Add a one-line comment in BandBars.tsx: the column height is content-driven.
6. Acceptance, at 1440 and 1920 in both themes: the band-label row ends at least 16px above the card's inner border (card padding is 18px).
7. At 1024 no band label wraps. If one does, add `.barLab { white-space: nowrap; }`.

**Evidence.** book-dark-full, book-light-full (crops/bookbars-l.png) and w1920/book-dark-full: 'Over cap' … '≥ 50% room' sit about 5px from the card's bottom border.

The cause: kit.module.css:190 fixes `.bars{height:160px}`, but a full column needs MAX_PX 128 (BandBars.tsx:26) + the count row (~24px) + the label row (~25px). B2's content-height card exposed it; the old stretched card hid it.

**Doctrine.** - Bostock: margins are deliberate composition.
- FT: bars stand on a common baseline, with their labels in clear space.
- Presentation only: no bar height or scale changes, and the 4px nonzero floor keeps a small band visible.

### D5 · Stress preview and the Overview entry: a change and its total at one precision, with a count that never parts from its noun (major)

**Spec.** 1. Move `bookMoneyAt(value, decimals, extra)` from observatory-series.ts:432 into lib/money.ts. observatory-series.ts re-exports it.
2. lib/money.ts: add `bookMoneyPair(change: bigint, level: bigint, decimals: number | null): { change: string; level: string }`.
- Pick the tier once, from |level|, using humanUsd's tiers: B and M with one decimal, K from $10K, whole dollars from $1,000, cents below that.
- Print both figures at that tier, truncating toward zero. The change is signed ('+' or U+2212).
- If the two unsigned strings match while the values differ, add one digit to both through bookMoneyAt. This is R6's rule, with at most two added digits.
- A nonzero change that would truncate to zero at the level's tier prints at its own tier, never '+$0K'.
- Null and unreadable scales go through guarded().
3. stress-preview.ts:150: the bad-debt clause becomes `bad debt ${pair.change}, to ${pair.level}`. In the head clause, join count and noun with U+00A0 (`${groupInt(n)} account${n === 1 ? "" : "s"}`), so the Overview entry line (cash-view.ts:403 previewLine) never breaks between '118' and 'accounts'.
4. Expected copy:
- 'ETH −10%: +$118K liquidatable · 9 accounts · bad debt +$964, to $1,204'
- ETH −40% prints two distinct figures, e.g. '+$117.9K, to $118.1K', as the values truncate.
- 'ETH −30%: … bad debt +$40K, to $41K' is unchanged.
5. The canon form stays: one line per shock, each line linking to Scenarios, under the one PROJECTION badge.

**Evidence.** book-dark-full and w1920/book-dark-full, Stress preview:
- 'bad debt +$964.39, to $1,204' puts cents beside whole dollars in one clause.
- 'bad debt +$118K, to $118K' prints two different values as the same string.

The cause: stress-preview.ts:150 formats each figure at its own tier through bookMoney/signedBookMoney.

overview-dark-full, Scenarios entry: '… · 118 / accounts · bad debt +$40K, to $41K' wraps between the count and its noun at 1440 and at 1920.

**Doctrine.** - F3 module law: comparable figures in one sentence share one register.
- R6: two figures never print alike when their values differ.
- Truncation toward zero is kept.
- The change is still measured against the grid's own unshocked point (B5), never against another endpoint.
- The canon form holds: pages-console.html secmap says 'one line each'.

### D6 · Compare mode: library rows stop saying 'Not run yet' under the scenarios the headline just ranked (major)

**Spec.** 1. lab-library.ts: add `export function compareOutcome(row: CompareRow): LibraryOutcome`.
- Answered row with delta > 0: `{ key: "compared", text: `${row.deltaText} liquidatable · ${row.shareText} of the book`, tone: "crit" }`. This gives '+$1.2M liquidatable · 4.5% of the book' and '+$9,800 liquidatable · <0.1% of the book'.
- Delta = 0: 'No new liquidatable debt', tone dim.
- Delta < 0: the same form, tone ok (the dot's own tone).
- A non-answer row: its CompareRow.reason in sentence case, tone refused. This is the compare card's own word.
2. Add "compared" to the LibraryOutcome key union (ScenarioLibrary.tsx:8).
3. LabSurface.tsx, where the book-mode `items` are built: when `compared !== null`, a library row whose id appears in `compared.cash.rows` takes `compareOutcome(thatRow)`. Every other row keeps outcomeLine. Leaving compare focus restores outcomeLine.
4. Fallback, only if this wiring is deferred again: a lib constant `COMPARED_OUTCOME = { key: "compared", text: "In the comparison above", tone: "dim" }` for members. A member must never read 'Not run yet'.

**Evidence.** labCompare-dark-full: the H1 reads 'ETH −30% moves the most: $1.2M more Cash debt becomes liquidatable, 4.5% of the book.' and the dek reads 'ETHFI −50%: +$9,800, under 0.1% of the book.' Meanwhile both ticked rail rows read 'Not run yet', because lab-library.ts:85 outcomeLine reads only single-run records.

CompareRow (lab-compare.ts:29-53) already carries deltaText, shareText, tone and reason for every member. This presents data the page already holds, not new data wiring.

**Doctrine.** - Doctrine 1: something computed is never labelled 'not run'.
- S2: the first viewport tells one story.
- Result identity: the words come from the set run the headline reads, never from the single run's record.
- Doctrine 2: Cash only; the legacy shares stay in their own fold.

### D7 · Activity (and Verification probes) table sits in a kit card like every other table; the sticky column follows its ground (major)

**Spec.** 1. ActivityTable.tsx:144: wrap the KitTable in `<div className={kit.card}>…</div>`, exactly as app/inspector/[addr]/ActivityTable.tsx:80 does. The ordering note above, the † footnote and Load more stay outside the card.
2. VerificationSurface.tsx:201: wrap the probe KitTable the same way.
3. kit.module.css:213: the sticky first-column background becomes `background: var(--tbl-ground, var(--panel));`. Any table deliberately left on --bg sets `--tbl-ground: var(--bg)` on its wrapper.
4. Acceptance at 390px, both themes: no light slab or lighter strip down the When column. Every column stays reachable in the named scroll region.

**Evidence.** - w1440/activity-dark-full: the 50-row chain-action table sits bare on --bg. The same record type in the Inspector (inspector-dark-full, 'Activity') and every Book and Scenarios table sit in a kit card.
- w390/activity-light-full (crops/act390l.png): the sticky When column paints --panel (white) over the grey page ground and reads as a rendering bug. The dark theme shows a lighter strip (crops/act390d.png).
- verification-dark-full: the probe table is also bare.

**Doctrine.** - One record type gets one frame.
- K10: the sticky column plus the scroll region keep every field on a phone, so no column is dropped.
- Doctrine 2: engines stay side by side and are never totalled.

### D8 · Activity headline: the finding, not pagination; the bad-debt realization gets an explicit antecedent (major)

**Spec.** 1. feed-view.ts feedTakeaway, multi-row non-ledger arm (lines 444-468): count the deficit_created rows.
- liquidations > 0 and deficits > 0: emphasis = `${plural(liq, "liquidation")} and ${plural(def, "bad-debt realization")} among the ${loaded} loaded.`
- liquidations > 0 only: emphasis = `${plural(liq, "liquidation")} among the ${loaded} loaded.`
2. In the rest clause:
- Drop 'the newest at …' when newest.kind is "time" or "block"; the Newest chip carries it.
- Drop both `more` clauses ('more exist beyond these.' and 'that is every action matching this filter.'); the Loaded chip always says 'more available' or 'end of the list'.
- Keep the untimed arm ('none has a block time yet, so no newest is claimed') and the broken-order arm verbatim.
- The single-row and ledger arms are unchanged.
3. activity-view.ts factDek (lines 603-609): delete the deficit sentence when the H1 carries it. When liquidations = 0 and deficits > 0, it reads `${n} of the ${loaded} loaded actions record${n === 1 ? "s" : ""} bad debt being realized.`, which names its antecedent.
4. Expected copy:
- H1: '3 liquidations and 1 bad-debt realization among the 50 chain actions loaded.'
- Dek: '21 are on Cash and 29 on the legacy Aave v3 market. 2 have no block time yet and are listed last, by chain and then block number.'

**Evidence.** w1440/activity-dark-fold, unchanged from the before capture: the H1 '3 liquidations among the 50 chain actions loaded, the newest at Aug 8, 20:21 UTC; more exist beyond these.' restates the chips 'Newest Aug 8, 20:21 UTC' and 'Loaded 50 · more available' just below it.

The dek '1 of them records bad debt being realized.' (activity-view.ts:605) reads as one of the 3 liquidations. The code actually counts a separate deficit_created row among the 50, and the tiles count it apart.

At w390 the H1 runs to four lines.

**Doctrine.** - Answer first: page mechanics live in the chips.
- 'loaded' stays in the H1, so the count reads as a floor, never a total.
- The honest arms (untimed, broken order) are kept.
- R3: records stay ink, and the tone stays neutral.

### D9 · Verification: one word per receipt state, stated once per altitude; a fetch failure never borrows the unreadable words (major)

**Spec.** 1. One word per receipt state, keyed like RECEIPT_TONE:
- Failed (result != pass): status 'Failed', pill 'Receipt failed', chip 'Receipt failed · 84/87'.
- Drift: pill 'Receipt drifted', tone warn.
- Internally inconsistent (evidence.ts:593, a pass with exit ≠ 0): keeps 'Rejected'.
- verification-view.ts:686 reads the pill word from this map instead of the fixed 'Receipt rejected'.
2. Status row (verification-view.ts:616, fed by evidence.ts:586), failed arm: 'Failed · 3 of 87 checked rows drifted'. The verbatim `receipt verdict "fail" (exit 1)` moves to that row's title and to the drawer, as trust.ts:335 already does.
3. H1 (evidence.ts:725): DID_NOT_MATCH becomes 'The last reconcile run did not match the chain exactly:' and the rest becomes ' 84 of 87 checked rows matched; 3 drifted.' The comma splice becomes a colon.
4. Say the verdict once per altitude: remove the receipt strip (receiptLine and its slot in VerificationArchitecture) in every state. The H1 (headline), Receipt chip (identity), step 03 (architecture) and proof-card rows (record) already carry it.
5. Fetch failure vs unreadable: split verification-view.ts:317-321.
- A failed request prints COMPUTE_UNFETCHED 'The batch could not be fetched.' and VERIFY_UNFETCHED 'The receipt could not be fetched.'
- 'could not be read.' is kept only for a body the page could not read.
- The StateCard cause (:1031) becomes 'Both subject cards are read from this record, so neither is shown until the service answers.'
6. Sentence case:
- evidence.ts:918 WELDS_NOTE.value becomes 'Counts every compared row, checked or advisory (an advisory row is recorded but never decides whether the run passes); not a breakdown of the checked rows.'
- evidence.ts:924 REGISTRY_MATCH becomes 'Identical to the service's registry fingerprint, by construction'.
- The probe-record notes are contract-verbatim (api/openapi.yaml:2071) and stay as served.

**Evidence.** verificationFailed-light-full:
- The Status row reads 'Rejected · receipt verdict "fail" (exit 1)'.
- One event carries five labels: 'did not match' (H1), 'Receipt failed · 84/87' (chip), 'Reconcile failed: …' (strip), 'Receipt rejected' (pill) and 'Rejected' (status).
- The H1 is a comma splice.

verification-dark-full: '87/87' or '87 of 87' appears five times above y=740 (H1, chip, step 03, strip, Checked rows).

verificationUnavailable-dark-full:
- The H1 says 'could not be fetched', but step 03 says 'The receipt could not be read.' (VERIFY_UNREAD).
- The card says 'nothing stands in for a manifest that was not read.'

Row values start lowercase: 'count every compared row…' and 'identical to the service's registry fingerprint…'.

**Doctrine.** - R12 extended: one tone and one word per receipt state.
- K4: 'unavailable' (the fetch failed) and 'unreadable' are distinct registers.
- P1: a process exit code is not reader altitude; the verbatim text stays one hover away and in the drawer.
- Tufte: repeats at one altitude are struck.
- Drift stays warn, and failed stays crit everywhere.

### D10 · Scenarios chips: no wire id at reader altitude, and one form for 'Computed' (minor)

**Spec.** 1. lab-view.ts resultBook chips (line 380): remove `{ label: "Scenario", value: `${run.scenario_id} · ${run.scenario_version}` }`. The Config chip gains `title: `Scenario ${run.scenario_id} · ${run.scenario_version}; config ${run.scenario_config_version}``.
Exception: when `skew` includes "version", keep the Scenario chip with tone warn, so a version mismatch still shows at reader altitude.
2. definitionChips (lines 334-339): keep only the Config chip, titled `${def.id} · ${def.version}`.
3. AddressWorkspace.tsx:27: drop the 'Scenario' chip; the H1 names the scenario.
4. The kicker's scenario-name token (the .kickCase span) carries title `${def.id} · ${def.version} — ${def.label}`.
5. LabSurface.tsx:265: insert the Computed chip after the first chip (`book.chips.slice(0, 1)`), since the Scenario chip is gone.
6. compareChips (lab-view.ts:331): Computed uses the single run's form, `${humanAge(seconds)} ago`, from the same age builder as LabSurface.tsx:257-262, fed with the set run's computedAt and servedAt. The title holds humanUtc plus the ISO. When the age is unresolved it prints 'age unknown' (warn).
7. Result chip row: 'Result for batch 18,251 · Computed 42s ago · Engines Cash · legacy market below · Config v1'. That is one row at 1440 and two at 390.

**Evidence.** - lab-dark-fold chips: 'Scenario eth_minus_30 · v1' … 'Config v1'. They take two rows at 1440 and three at 390 (w390/lab-dark-fold), while the kicker already reads 'ETH −30% · CASH BOOK'.
- labBare: 'Scenario eth_minus_30 · v1 · Config v1'.
- labAddress: 'Scenario eth_minus_30'.
- labCompare shows 'Computed Aug 8, 20:22 UTC' (lab-view.ts:331), while the single run shows 'Computed 42s ago' (LabSurface.tsx:262).

**Doctrine.** - S1: one name per scenario; the wire id and version live in the name's title.
- Result identity is kept: batch, config and computed all stay, and a version skew stays visible.
- One chip label has one form across modes.

### D11 · Scenarios: no unexplained 9.09% in the dek, and the heatmap caption leads with its finding (minor)

**Spec.** 1. lab-headline.ts nearSentence (lines 76-81) becomes 'Of the 27 accounts nearest their cap today, all 27 cross it.' The singular reads 'the 1 account nearest its cap today'. The edge value leaves the dek.
2. lab-view.ts transitionFinding, merged arm: finding first, axes second, and the buckets named once. Copy: '425 accounts change band; 118 cross the cap; none improve. 6 not measured. Rows are room under the cap today and columns room after the shock; each cell counts accounts. The 5 bands join the service's 8 risk buckets, so their edges fall at 4.76%, 9.09% and 20% of cap, not at the Book's 10% line.'
- bandEdgesSentence absorbs the old 'made from the service's N risk buckets' clause.
- When an edge is the 10% line, it prints only 'The 5 bands join the service's 8 risk buckets.'
3. Unmerged arm: the finding, then its own axes sentence.

**Evidence.** - lab-dark-full dek: 'Of the 27 accounts within 9.09% of their cap today, all 27 cross it.' (lab-headline.ts:79). The Book's tile says 27 accounts are within 10%: the same count under two thresholds in adjacent pages.
- The heatmap caption opens with axes ('Rows: room under cap today, in 5 bands made from the service's 8 risk buckets · columns: …') and says 'the service's … risk buckets' twice (lab-view.ts:96-106).

**Doctrine.** - One term of art above the fold, glossed where it lives.
- FT: the finding first.
- Counts are unchanged.
- Edges are built from CONTRACT_LANE_EDGES and never typed; the service's buckets are shown as served and never re-banded.

### D12 · Legacy fold summaries state the legacy finding on every page (no slogans, no retired 'refused') (minor)

**Spec.** 1. lab-view.ts: add `legacyResultSummary(reading: EngineReading): string`.
- Result with newly > 0: `${signedBookMoney(d)(delta)} liquidatable · ${groupInt(newly)} positions`. This is the Cash library row's form with the legacy noun.
- newly ≤ 0: 'No new liquidatable debt'.
- Withheld: 'Result withheld'.
- Not covered: 'Not modelled for this market'.
- Failed or unreadable: the tile's absence word.
LegacyResult.tsx passes this instead of LEGACY_RESULT_SUMMARY.
2. lab-compare.ts: add `legacyCompareSummary(view: CompareView)`. It picks the leader by compareHeadline's ranking and returns `${label} moves the most: ${shareText} of the legacy book`. When every delta is zero it returns 'No scenario moves the legacy book'. LegacyCompare.tsx passes it.
3. Delete LEGACY_RESULT_SUMMARY and LEGACY_COMPARE_SUMMARY (lab-view.ts:647-648). The footnotes (LEGACY_RESULT_FOOTNOTE, LEGACY_COMPARE_FOOTNOTE) stay inside the folds.
4. cash-view.ts:697 becomes `${finding} · ${debtWord} · ${n(refused)} with no verdict`, which reads '46 of 8,552 computed positions are liquidatable · $1.9M debt · 0 with no verdict'.

**Evidence.** - lab-dark-full fold: 'Legacy · Aave v3 market — Its own result, in its own unit'.
- labCompare fold: 'Its own shares, on its own book' (lab-view.ts:647-648).
- book-dark-full fold: '… · 0 refused', while its own tile (cash-view.ts:611) and the Cash tile say 'No verdict'.

**Doctrine.** - Doctrine 2: the summary states the legacy result in its own unit and noun, never a Cash figure, never summed. The fold stays after all Cash content.
- R9: 'No verdict' is the one word for the engine-refused population; 'refused' stays for a service refusing a request.
- Canon secmap: a collapsed fold names its figures.

### D13 · No half-empty tile rows on Activity and API (minor)

**Spec.** 1. Activity: render `<FeedLiveStrip />` as the third child of the kpis4 grid (ActivitySurface.tsx:303-308), with `.liveInRow { grid-column: 3 / -1; align-self: stretch; margin: 0; }`. At ≤900, where kpis4 drops to 2 columns, use `grid-column: 1 / -1` so the strip sits below the tiles. The tiles keep their state words in every state: Refused, Filtered out, and '0 · among the loaded'.
2. API: delete the two KpiTiles (ApiSurface.tsx:52-55). They restate the H1's 17 and the index directly below them. In their place, add one var(--ink-2) type-small line above the endpoint index, from lib/api-view.ts: '15 GET · 2 POST · error responses 400 · 404 · 409 · 429 · 500 · 503'. The codes are neutral contract vocabulary (P6).

**Evidence.** - activity-dark-fold, activityRefused and activityExhausted: 'Liquidations' and 'Bad debt realized' fill x=104–714, and x=714–1336 is empty.
- api-dark-fold: 'Endpoints 17' and 'Error responses 6' leave the same ~620px void directly above an index that lists all 17 endpoints.

**Doctrine.** - Tufte: an empty frame is the loudest ink on the page.
- The live strip stays its own instrument: labelled 'Live stream · this connection only', accent posture, never green.
- A refused tile still reads 'Refused', never absence or zero.
- On API nothing leaves the page; the counts move next to the endpoints.

### D14 · History: a record at a scannable measure, a peak label on its datum, range dashes not link arrows (minor)

**Spec.** 1. history.module.css: `@media (min-width: 901px) { .rows { column-count: 2; column-gap: 48px; } .row { break-inside: avoid; } }`. Each pair is then about 590px wide, the same measure as Verification's subject rows.
2. ObservatorySeriesChart peak label:
- Anchor it to the peak point's x, centred and clamped to the plot.
- On collision with the newest label, use C3's second line at that same x.
- Draw a 3px var(--ink-2) dot on the peak point, whose title is the exact value.
3. Range grammar: observatory-series.ts:375 (rangeWords) and :865 (humanUtcSpan) use a spaced en dash: 'Aug 1, 21:00 UTC – latest' and '(Aug 1, 21:00 – Aug 8, 20:00 UTC)'. '→' stays reserved for links (A1).
4. The chart caption stops repeating the H1: 'Each point is one recorded hour, Aug 1, 21:00 – Aug 8, 20:00 UTC; a gap is an hour with no figures to draw.' The caption is metric-agnostic; the change stays in the H1 and the tile subs.

**Evidence.** - history-dark-full 'Latest hour' record: keys at x=125 and values at x=1315, so each pair is about 1,190px apart.
- 'Peak $27.9M' floats at the plot's left edge, with no mark on its datum.
- The chip reads 'Range Aug 1, 21:00 UTC → latest'.
- The caption '(Aug 1, 21:00 → Aug 8, 20:00 UTC), debt rose by $1.8M, to $27.8M.' restates the H1 verbatim.

**Doctrine.** - Bloomberg/Stripe: a record is scanned in pairs.
- FT: a direct label sits on its datum.
- A1 arrow grammar.
- The y-domain stays 0-based, gaps stay gaps, and exact values stay in titles and in the record.

### D15 · Empty and failed states say each thing once; capture activityExhausted through the real flow (minor)

**Spec.** 1. historyDegraded (history-view.ts:384-389): the StateCard title becomes 'What fills this page', and the cause becomes 'When this deployment builds its hourly record, each recorded hour appears here as a point and a missing hour as a gap.' The H1, dek, chip, 'What the service said' and 'Open the Book →' are unchanged.
2. activityRefused (activity-view.ts:749): the tile sub 'This page was refused' becomes 'Nothing counted'. The value stays 'Refused' on the dashed tile.
3. ACTIVITY_EXHAUSTED_DEK (activity-view.ts:260) becomes 'Actions appear here as the indexer records them.' The doctrine sentence moves to the drawer.
4. narrowed() (activity-view.ts:647) and admits() (:738) read the same filter source as exhaustedSentence: the service's echo when present. The H1, dek and tiles then describe one scope, and a type the echoed filter excludes tiles 'Filtered out'. The controls' pressed state stays the reader's request.
5. screenshot-pages.mjs:31: capture activityExhausted through the real flow. Route only `types=deficit_created` to FEED_EMPTY, and press `activity-type-deficit_created` before capturing, as activity.spec.ts:741-745 does. The gate then sees the pressed control, 'Filtered out' and 'Clear filter'.

**Evidence.** - historyDegraded-dark-full: the absence is stated five times (H1, dek, chip 'Hourly record not served here', card title 'No hourly history on this deployment', and the cause).
- activityRefused-dark-full: 'refused' appears six times, including both tile subs.
- activityExhausted-light-full: the dek 'That is the service's real answer, not a loading state.' is doctrine-as-copy (audit #16). The H1 reads the echoed filter while the tiles and controls read the request. That split comes from the harness answering an unfiltered request with FEED_EMPTY, whose echoed filter is types=deficit_created.

**Doctrine.** - Each state says what it means, why, and what fills the page, once.
- 'Refused' and 'unavailable' keep their distinct words.
- A refused count never reads as 0.
- An exhausted list still reads differently from loading and from failure.
- The controls reflect the reader's request.

## Rejected by the merger
- **The refused row pill must wear a dashed border (director)** — The most recent approved mockup draws the refused pill solid: pages-console.html:105 `.k-pill.ref { background: rgba(95,113,120,0.18); color: #93a5ab; }`. The K4 table (amendments §3) governs frames such as tiles, strips, cards and heatmap cells, not status pills. The row already carries form beyond colour: the word 'No verdict', a dimmed row (`.tbl tr.dim`) and '—' cells. Changing it is taste, not coherence.
- **Stress preview recast as a five-column table (director's form)** — The canon specifies 'one line each' for the Stress preview (pages-console.html secmap, :203). The real defect is the money register inside each clause, and D5 fixes it with a pair printer while keeping the approved form.
- **Book dek without 'and not headlined', and a chart title that states the finding (clarity)** — Both are canon verbatim: the dek at pages-console.html:158 ('below the $100 line and not headlined') and the title at :173 ('Distance to liquidation, by debt'). The canon states the finding in the chart's caption line, which serves as the FT-style subtitle. The owner approved this copy.
- **Rename the Book jump link to 'Legacy · Aave v3 market ↓' (clarity)** — The link text 'Legacy Aave v3 market ↓' is canon verbatim (pages-console.html:162), and the fold title comes from LEGACY_FOLD_TITLE. D12 fixes the real inconsistency in that fold ('0 refused').
- **Verification terms of art: 'Proven at build 5f0b3e2a', drop 'pinned' from the H1 and Trust (clarity)** — Renaming the pin requires first proving what 5f0b3e2a identifies, or doctrine 4 is at risk. The plan also deferred the Verification IA as an owner call. 'Pinned' is glossed by the dek directly below it ('a fixed, reproducible check'). The e2e chip selectors would move for a taste gain.
- **Phone column reorder for Activity, with liquidation extracts as colSpan detail rows (clarity)** — This is the responsive redesign the plan deferred ('Activity phone two-line record layout'). In the All-engines view, pushing Engine behind the amounts separates each amount from the engine that names its unit, which weakens doctrine 2. The sticky When column in a named scroll region already keeps every field reachable, and D7 fixes its ground. For the Inspector's stress table, D2 removes the string that caused the overflow; its column order matches the Book's, with status last.
- **Overview 'How it works' step titles back to claims (clarity regression)** — A10 ruled one pipeline vocabulary, shared by name and ordinal with Verification ('01 · Index' …). Each step's sentence already carries its claim ('Verified-ancestor rewind handles forks of any depth'), so this is taste.
- **API page length / endpoint disclosure (clarity regression)** — The plan's Deferred list makes this an owner call (spec §5.5 forbids an IA change on secondary pages). It is not a coherence defect.
- **History gap legend replaced by direct labels on the gap markers (director)** — The legend is a two-entry marker key at the card head, an idiom the FT desk uses. Direct labels on 1px gap markers would collide at 390px and on dense weeks. D14 takes the higher-value FT fix: the peak label anchored on its datum.
- **A zero-baseline hairline under the Book bars (director's option)** — The canon bars (pages-console.html:174-181) have no baseline rule. Once D4 fixes the height, the columns share a bottom and the colored band floors read as the base. This is taste.
- **Trust detail '35s · within 180s' → '35s old · limit 3 min' (clarity)** — The 180s figure is the service's configured threshold, stated in its own unit, and not an age. The impact is negligible, and the item does not earn a slot in a 15-item round.
- **Activity Type group's pressed state follows the service's filter echo (director)** — The controls must reflect the reader's request. The mismatch in the capture exists only because the harness answered an unfiltered request with a filtered echo; in the real flow the request and the echo agree. D15 aligns narrowed() and admits() and recaptures through the real flow.
- **Reorder the stress-table columns to put 'Becomes liquidatable?' before 'Room after' (clarity)** — The Book's Needs-attention table, the canon's reference table, puts status last. With the long interest string moved to the sub-line (D2), all three columns fit at 390px, so no reorder is needed.
