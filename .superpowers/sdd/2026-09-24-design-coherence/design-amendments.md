# Design coherence — the integrator's amendments (SUPERSEDE `design-plan.md` where they conflict)

Inputs: `design-plan.md` (the director's plan), `design-critique.md` (the completeness/doctrine critic), `design-audits.md`
(four lenses). Owner direction 2026-09-24 ~22:47 USMST: "do a style and design review, make sure everything is presented
in a coherent way. a lesser model designed this". Standing: "use your judgement".

## 1. Rulings (R1–R12 ADOPTED, with these amendments)

- **R1** Snapshot chip: fresh → neutral (ink); aging warn; stale/critical crit. Label stays "Snapshot" (the pin mask).
- **R2** Live dot → accent. ALSO the header pill's fresh AGE is ink, never green (`lib/live-pill.ts` tone "live" covers the
  whole pill; critic miss 2).
- **R3** Activity liquidation / bad-debt rows: ink records, semibold type word, no crit pill.
- **R4** Book "Room to cap": signed percent (U+2212) in every row, over-cap in crit ink, dollar room in the cell title.
- **R5** Time law ADOPTED. `exactUtc` DROPS NO FIELD: seconds and any fractional seconds the wire carries are printed
  (critic: the plan contradicted itself). Only the T/Z glyphs are typeset; a malformed instant prints verbatim.
- **R6** History chart labels in the book register, exact in `<title>`. If two direct labels would print the same text
  while their values differ (e.g. peak vs newest), add one significant digit to both until they differ (max two).
- **R7** Scenarios tile = the heatmap's own population ("Accounts changing band 425"), 941 in the title.
- **R8** Overview cards on the kit radius/surface.
- **R9** "No verdict" is the state word for the engine-refused population (Book tile, row pill, History record key).
  Scenarios keeps "not measured" unless proven the same population.
- **R10** On CASH reader copy the noun is "account", everywhere — the Book, the Overview, History's Cash view
  ("Liquidatable accounts" when the engine is Cash; "Liquidatable positions" on the legacy market), the Book's stress
  preview, the Overview pipeline step, Scenarios library text (critic miss 8). Verify the 1 Cash position = 1 account
  identity in code before relying on it (the Book's "1,412 borrowing accounts" = the census of positions).
- **R11** "counted, not hidden" and the served-debt clause move to the Methodology drawer.
- **R12** Verification card rules ADOPTED, with the critic's doctrine fixes (see §3, P2). ALSO RULED (Plan 4 owner's list
  asked it): a FAILED receipt is crit everywhere — Verification's headline, step, chip, card rule AND the Inspector's
  trust item (today warn) — one tone for one receipt state. DRIFT stays warn (not silently raised).

## 2. Dropped from the plan (critic §5)

- **K13 radius role tokens** (no visible change; goes with the deferred spacing tokenization). K13 keeps ONLY the
  documented breakpoint set and the phone type step.
- **S6 per-class normalisation.** Keep `heatIntensity = sqrt(min(1, count / globalMax))` over the GLOBAL max; drop the
  per-class `maxOf` (same opacity must mean the same count across classes).

## 3. Doctrine fixes to plan items (the critic §2 — binding)

- **P2** `RECEIPT_TONE` gets its own key for a FETCH FAILURE: `unavailable` → a solid (never dashed) ink-3 rule and the word
  "Unavailable" — a fetch failure is never the refused register. `drift` stays **warn**. The proof card's status rows read
  the same map (no leftover empty→warn / UNAVAILABLE→crit). `failed` → crit (R12).
- **P1 verificationUnavailable**: the dek must not claim "no batch to show" — step 02 shows the batch from `/v1/book`.
  Say only what failed: "The service did not answer the proof request (HTTP 503), so there is no proof to show." The live
  batch chip shows the batch when `/v1/book` answered.
- **P3 chips**: never leave the identity empty (`headerIdentity` would render "Identity missing"). Keep, in order:
  `Newest …` (when known), `Order by block time` / `by block number` (ALWAYS — the order key must stay on the page),
  `Loaded 50 · more available`, and `Filter …` only while a non-default filter is active. The error and refused states
  keep the Order chip. The section qualifier still names the order.
- **P3 amounts**: the `.num` digit alignment applies ONLY when the view is scoped to one engine. In the All-engines view the
  Cash and legacy figures are NOT put on one digit axis (doctrine 2) — keep the raw tag adjacent to its digits.
- **P1/P3/P5 unseen states**: Activity's `error` state (fetch failed), History's unavailable / foreign-engine /
  unreadable-scale branches each get their OWN StateCard cause — never the degraded state's text. A fetch failure's tile
  word is "Unavailable", never "Refused".
- **P1/P4 empty table rows** carry a state word ("Refused" / "No rows"), never a bare "—".
- **K4 state registers** (the kit's one table; pages apply it):
  | State | Frame | Word |
  |---|---|---|
  | refused (engine or service refused) | dashed ink-3, refused-bg | "Refused" / "No verdict" / the lib's cause |
  | unavailable (fetch failed) | SOLID line, panel | "Unavailable" |
  | not run (served, never run) | solid line | "Not run" |
  | not served (404 on a scenario) | solid line | "Not served" |
  | pending (in flight) | solid line, aria-busy | "…" (never "failed", never "unavailable") |
  | unreadable (page could not read the wire) | dashed ink-3 | "Unreadable" |
- **S8** the header "Run …" button and "Run it to see…" dek ONLY in "served, not run yet" — never when not served,
  unavailable or running.
- **K2 at 390 with a CONNECTED pill**: the header row must fit brand + pill + two icons in 358px. At ≤640 the pill shows
  the dot and its word only ("Live"), the batch and age move into its title. Prove it with a styleguide specimen or unit
  test of the connected pill, and the wide-font spec must stay green.
- **F2 minus**: U+2212 is DISPLAY ONLY. `ExactValue`'s clipboard text and every `title`/exact string keep the wire's
  ASCII "-" (a spreadsheet must parse a copied value). `web/lib/params-format.ts` joins area 3's files.
- **S1** scenario names in a kicker use `.kickCase` for the name token (weETH, sETHFI keep their case).
- **S2** `compareHeadline` arms: a tie → "ETH −30% and ETHFI −50% move the most:"; every delta zero → "No scenario in
  this set makes more Cash debt liquidatable."; a refused / withheld member is excluded from the ranking and named in
  the dek; a projection-only scenario (the rate horizon) is not ranked on spot liquidatability and says so in the dek.
- **P4 exhausted**: the H1 carries the active scope (engine, types, since-block), never an unscoped negative.
- **P5** the History Cash view says "accounts" (R10); if two chart labels collide in text, R6's digit rule applies.

## 4. The critic's misses — ADDED (critic §1)

- **A1 Arrow grammar** (every area, in its own files; labels move to the lib): "→" ONLY for a link to another page;
  "↓" ONLY for a jump further down this page; NO arrow on a drawer trigger ("How the bands are cut", "Price inputs");
  arrow AFTER the words, never before ("API →", not "→ API"); a tile sub that is not a link carries no arrow.
- **A2** header pill fresh age ink (with R2, area 1).
- **A3 One no-answer headline register** (area 1 defines it on VerdictHeader, pages apply): a headline that states the
  ABSENCE of an answer (unavailable, refused, not run, not served) is ink-2 WHOLE LINE; a headline that states an answer —
  including an empty one ("No recorded chain action is a bad-debt realization.") — is ink. labBare / labCompare stop
  dimming only the first half.
- **A4 Over-cap wording** (areas 4, 5): table Room cells = signed percent (R4) with the dollar room in the title; tiles
  and prose = "over cap by $1,069"; band / heatmap / bar labels = "over cap" (the band's name). The Scenarios movers
  "Room after" cells follow the table rule.
- **A5 One money precision per column** (area 3 defines, 4/5 apply): `accountMoneyColumn(values, decimals)` picks the
  precision ONCE per column — whole dollars when any |value| ≥ $1,000, else cents — and every row prints at it
  (Inspector "Counts toward cap": $4,200 / $813 / $5,012). PRICE columns are exempt (each asset's quote keeps its own
  precision) — say so in the money module doc.
- **A6** the Inspector Debt tile sub "USD · 4,822.000000 exact" is EXEMPT from "no exact at reader altitude": it is the
  mockup's exact-value affordance — render it through `ExactValue` (dotted underline, copy), not as plain text.
- **A7 One price-source name** (area 3 verifies in Go / the contract what is true — the contract PriceProvider v2 and the
  RedStone feeds it reads — and exports ONE phrase from `lib/prose.ts`; areas 4 and 5 use it on the Overview and the
  Inspector chip).
- **A8** R10 across all Cash copy (see R10).
- **A9 Scenarios on a phone** (area 5): at ≤900 the answer (header, tiles, heatmap) comes BEFORE the library.
- **A10 One pipeline vocabulary** (area 3 exports `PIPELINE_STEPS` names + ordinals — "01 · Index", "02 · Compute",
  "03 · Verify", "04 · Serve" — from `lib/prose.ts`; the Overview and Verification both use them; each page's sentence
  may differ by altitude, the names never do).
- **A11 One kicker style**: the Overview live card's kicker is the kit kicker (accent), like the Book's.
- **A12 Sentence case everywhere** (P7's rule applies to EVERY area's lib files): every standalone line / cell / detail
  / toggle starts with a capital; uppercase only via the kicker CSS and the PROJECTION badge. Includes Trust details
  ("This account's latest sweep succeeded"), heatmap labels and corner, Book bar labels, toggles.
- **A13** drop the Scenarios movers "Becomes liquidatable?" column on Cash (every row is, by definition — keep it only
  where a row can be "No").

## 5. Under-specified items — decided (critic §3)

- **K3(c)**: document ONE tone grammar table in `lib/kit.ts` and map each existing vocabulary to it in its doc comment;
  do NOT merge the TypeScript types in this wave.
- **K8**: each control keeps its CURRENT selection semantics (verify: engine / view single-select; type — whatever it is
  today). The scrolling set gets the nav's edge mask as its overflow cue. "Since block · choose one engine" stays a hint
  beside the Engine group.
- **K9b**: a StepStrip step with no figure prints its state word (§3 table), never "—".
- **B2**: `.areaAttn { align-self: start; }` — no card stretches to a void; ragged bottoms are acceptable.
- **S1 vs stress-preview**: ONE name builder — `scenarioName` / `scenarioGist` live in a NEW `web/lib/scenario-name.ts`
  built in wave 1 (area 3); `lab-library.ts` re-exports; `stress-preview.ts` imports it.
- **P6**: turning "* " lines into a `<ul>` re-points `api.spec.ts:172-175` (area 6 owns it).

## 6. Waves and ownership (critic §4 — the file sets are made disjoint by SEQUENCE)

1. **Wave 1 — formats (area 3 alone)** + `lib/scenario-name.ts` + the `lib/prose.ts` constants (A7, A10, engine words,
   LEGACY_FOLD_TITLE) + `lib/params-format.ts`. Running alone, it re-points EVERY unit and e2e pin in the tree that pins a
   string it changes (F1 time, F2 minus, F3 money, F4 percent, F5 hex/age).
2. **Wave 2 — kit/chrome (area 1) ‖ charts (area 2).** Area 1 owns `shell.spec`, `keyboard.spec`, `p1a/p1b/r1-fixes.spec`,
   `wide-font.spec`, the styleguide and kit unit specs; area 2 owns the chart unit specs and REPORTS e2e re-points in page
   specs to the integrator.
3. **Wave 3 — Book/Overview (area 4) ‖ Inspector/Scenarios (area 5) ‖ secondary pages (area 6).** Each owns its page e2e
   specs (area 4: book, overview; area 5: inspector, lab; area 6: history, activity, verification, api). CROSS-CUTTING
   e2e specs — `state-matrix`, `p1a/p1b/r1-fixes`, `keyboard`, `shell`, `wide-font`, `screenshots` — are the
   INTEGRATOR's in wave 3: areas report the exact re-point they need, never edit them.
4. **Integrator**: apply reported re-points, build (flag set), whole suite, read and re-baseline every pin that moves.
5. **Design gate**: fresh captures → a director + clarity "is it at the bar?" pass → one fix round.
6. **Codex round** (D-006; the laws) on the whole range → adjudicate (clause 6) → fixes → Codex re-verification.
