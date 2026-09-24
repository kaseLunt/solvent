# Plan 5 QA — persona re-walk (solvent-user)

Date: 2026-09-23. Read-only: this file is the only one written.

What I looked at
- The 52 fresh captures in `...\scratchpad\gate-p5\` (every page dark + light, fold + full, and the five honest states). I read the
  12,301 px API page and the Activity full page in slices (`...\scratchpad\rw-api-00..05.png`, `rw-act-*.png`).
- To compare before and after: the Task 12 captures in `...\scratchpad\gate6\` (Book "Needs attention", Activity's liquidation rows).
- The root `README.md` and the seven `docs/readme/*.png` screenshots, read as a hiring evaluator would. I also checked what GitHub
  shows today: `origin/main` is 235 commits behind local `main`, and the public README there is the old 21-line one.
- Code only to confirm what a control does. "Compare…" is disabled until two scenarios are ticked (`app/lab/LabSurface.tsx:341`).
  The near-cap fold's label counts the rows the table hides (`lib/cash-summary.ts:417`).

Severity: BLOCKER = I would leave, or I was misled. MAJOR = I got stuck or misread. MINOR = friction. I never grade on how hard a fix is.

---------------------------------------------------------------------------------------------------

## 1. The twelve targeted items: CLOSED / PARTLY / NOT CLOSED

| # | Target | Verdict | What I see now (quoted) | What is still wrong for a user |
|---|---|---|---|---|
| 1 | README front door | **PARTLY** | Local README: "A read-only risk surface for ether.fi Cash, where people borrow against crypto to spend on a Visa card … A portfolio project, not affiliated with ether.fi." Then a pipeline diagram, a "What is verified" table and a reconcile receipt | GitHub does not show this README yet. The public page still says "Real-time solvency companion … Work in progress … (coming) risk engine, public API, alerts, web." Details in §3. |
| 2 | Hero "70,000 people" vs "Accounts 1,412" | **CLOSED** | "People borrow against crypto to spend on a Visa card. This is how close each account is to liquidation — right now." Below it: "Accounts 1,412" | No contradiction left. (The page still gives no sense of how big Cash is, but it no longer claims a number.) |
| 3 | Book's liquidatable 2 vs History's 49 | **PARTLY** | Book tile: "Liquidatable · ≥ $100 — $6,840 — 2 accounts · 47 more under $100 · 49 in all". History tile: "Liquidatable positions 49". Scenarios: "was 49, now 167" | The big type still says "across 2 accounts" on Overview and Book, and "49" on History and Scenarios. The only bridge is a grey sub-line on one Book tile. History never says "2 of them are ≥ $100". A cold visitor going Overview → History still sees 2, then 49. |
| 4 | "$109.45 — below the $100 line" | **CLOSED** | "47 more positions are technically liquidatable, each under the $100 line — $109.45 together — and not headlined." | Leftovers: "technically liquidatable", "the $100 line" (why $100?) and "not headlined" (the page talking about itself). All MINOR. |
| 5 | 6 of 27 near-cap accounts with no way to the rest | **CLOSED** (the item as stated) | Under the table: "Show 21 more near-cap accounts ($622K)". 6 shown (≈$205K) + 21 hidden ($622K) = the tile's 27 / $830K | Still no sort (the order is fixed: "Material first, then by room") and no way to the full book of 1,412. Carried from M1 as MAJOR. |
| 6 | The buried legacy market | **PARTLY** | Page foot, still collapsed: "▸ Legacy · Aave v3 market — 46 of 8,552 computed positions are liquidatable · $1.9M debt · 0 refused". Link near the top: "Legacy Aave v3 market ↓" | The 46 liquidatable positions are now in words, but in a closed disclosure line about 1,600 px down the Book. They are not in any tile or headline, and the Overview never mentions the legacy market. "computed positions" beside "0 refused" makes me ask which ones were not computed. |
| 7 | Verification's 87 vs 29 + 14 | **PARTLY** | "checked rows 87/87 exact · 0 drifted"; "Cash · account comparisons 29/29 exact"; "Aave v3 market (legacy) · account comparisons 14/14 exact"; "account comparisons — count every compared row, checked or advisory; they are not a breakdown of the checked rows" | The page now admits the numbers do not add up, but it still never says what the 87 are. "advisory" is never explained. The Inspector still says "Pinned reconcile run matched the chain — 29/29 Cash rows", which is exactly the reading Verification now tells me is wrong (NEW-4). "87/87" appears 6 times in the first viewport (headline, chip, tile, tile caption, banner, Proof subject). |
| 8 | Three meanings of "moved" on Scenarios | **PARTLY** | Tile: "Accounts changing lane 941 — of 1,406 measured · 0 improved". Dek: "425 accounts move to a worse band". Grid: "425 accounts change band; 118 cross the cap". Movers footer: "the 20 largest of the 118 accounts that become liquidatable, by debt · the service returns at most 20" | "moved" is gone, but "lane" and "band" read as the same thing, and "lane" appears nowhere else on the site. The 941 tile still matches nothing in the grid beneath it: the grid adds to 425 off the diagonal. I still assume one of the two numbers is a bug. |
| 9 | Raw 9-digit Activity amounts | **PARTLY** | Cash rows: "252.733333 · normalized debt · USDC", "−132.314285". Inspector: "622 · normalized debt · USDC", "4,200", "−150". Legacy rows unchanged: "180771428 · aave-scaled · raw units · USDC", "−2380952380" | The Cash rows are readable now, though the header still says "Amount · engine units, not USD" and nothing carries a $ sign. Legacy rows are still raw, and they now sit in the same column as scaled Cash figures (NEW-2). Supplies and withdrawals still show "— record-only". |
| 10 | Builders' vocabulary ("gated", "weld", "Filter echo … since_block", raw enum words) | **PARTLY** | Gone: "gated" (→ "checked rows"), "weld" (→ "account comparisons"), "Filter echo" (→ "Filter applied all engines · all types · any block · 50 per page"), `collateral_enabled` / `deficit_created` (→ "collateral enabled", "bad debt realised"), "custodied" (Inspector), "watermark block" (→ "balances as of block 155,323,444"), "Bucket record" (→ "Hour record") | The four named words are gone. New ones came in with the fixes (NEW-1, NEW-6): `configured_bonus_bps`, `realized_bonus_bps`, "the contract's 100e18 denomination", "service.registry_fingerprint", "advisory". Still on public pages: "Proof pin", "Batch key", "materialization key", "SERVING · WATERMARKED", "PROOF · EXACT @ 5f0b3e2a", "recon/p3-probes.md", "publishable by construction", "deploy-bound", "Current not projected", "Coverage 1,406 / 1,412 computed", "Lookup complete · both engines", "Stride hourly", "Range … → unbounded", "withheld", "provenance rows", "aave-scaled · raw units", "record-only", "Since block · choose one engine", "Config v1", "HORIZON PROJECTION", "bit-identical", "by construction". |
| 11 | API page's raw `**` and backticks | **CLOSED** | "409 batch_superseded", "no batch envelope" and the field names now render as bold / code | Leftovers: literal "* " list markers ("* headroom (ADDED 1.5.0) —", "* an ENGINE-SCOPED page") and shouting spec headings ("THE EXCLUSION LAW", "THAT REVERSAL LAW (1.5.0)", "UNKNOWN IS NOT MAXIMAL", "(AMENDMENT 1/E)"). Changelog prose also sits in the reference ("The same release CORRECTS RunBookHistogram.refused_count's description…"). MINOR. |
| 12 | A disabled button that looks live | **PARTLY** | "Compare…" (disabled with fewer than 2 ticked) now has dim text in dark theme. In light theme it is still a white bordered button with grey text beside the teal "Run ETH -30 percent" | In light theme it still reads as clickable. Nothing tells me why it is off or what turns it on ("tick two scenarios"). The four checkboxes are still unexplained, and the bright "Run ETH -30 percent" sits beside a result that already says "Computed 42s ago", so I still don't know whether I must press Run. |

Summary: 4 CLOSED (2, 4, 5, 11), 8 PARTLY, 0 NOT CLOSED.

---------------------------------------------------------------------------------------------------

## 2. NEW — what the changes introduced

**NEW-1 · MAJOR — Activity: every liquidation row now carries a paragraph of spec prose with raw backticked field names**
- Page: Activity (`/feed`), liquidation rows, just below the fold. It is also on the Inspector wherever a liquidation is shown.
- Legacy row, verbatim: "extracted from the event's own structured payload; amounts are in each asset's own token units.
  \`configured_bonus_bps\` is the ledger's bonus AT THIS EVENT's effective params; \`realized_bonus_bps\` would need event-time prices
  this service does not re-read, so it is null — never estimated."
- Cash row, verbatim: "a bonus the payload cannot establish in bps is null, never estimated — each seizure's own realized bonus serves
  verbatim in the contract's 100e18 denomination."
- This is the raw-backtick problem the plan just removed from the API page, now on a user page. It sits on the three rows a liquidator
  opens Activity for. Each liquidation is now a 6-line block, and I read "null" and "never estimated" as "something is missing".
- Expected: "Liquidator 0xBBbB…0002 repaid 2,500 USDC and took 0.65625 weETH. The bonus they earned isn't known."

**NEW-2 · MAJOR — Activity: one Amount column now holds two scales**
- Page: Activity table. Two neighbouring rows: "252.733333 · normalized debt · USDC" (Cash borrow), then "180771428 · aave-scaled · raw units · USDC"
  (legacy borrow).
- Before, the whole column was raw and I knew not to trust it. Now half of it looks human, so I compare magnitudes and conclude
  the legacy borrow was 180 million. The only cue is small grey text in the next column. Wrong-looking data.
- Expected: one scale per column, or the raw legacy figures kept out of a column whose other rows read as money.

**NEW-3 · MAJOR — Book: the six "Not computed" rows are now dashes from end to end; the blind spot has no size**
- Page: Book, "Needs attention". Before (gate6): "0x0645…28cc — $2,342 Not computed" and five more rows, about $178K together.
  Now: "0x0645…28cc — — Not computed" ×6. Tile: "Not computed 6 · collateral never read".
- As the risk lead, $178K with no verdict was the number I would escalate. Now nothing anywhere sizes it, and six rows of dashes
  look like a table that did not finish loading. The dek adds "could not be computed **this batch**" next to the tile's "**never** read":
  is this passing or permanent?
- Expected: to be told how much debt sits on accounts with no verdict, or in words that the service does not know even that, and why.

**NEW-4 · MAJOR — The Inspector's trust line contradicts Verification's new disclaimer**
- Inspector Trust card: "✓ Pinned reconcile run matched the chain — 29/29 Cash rows · Jul 29, 02:14 UTC".
- Verification: "checked rows 87/87"; "Cash · account comparisons 29/29 exact"; "account comparisons … are not a breakdown of the checked rows".
- The Inspector calls them "Cash rows" and ticks them green. Verification says they are not rows of the check. Reading both, I
  concluded 29 of the 87 checked rows were Cash, which is the reading Verification tells me is false. The Overview says a third
  thing: "87/87 checked rows exact · 0 drifted".
- Expected: one name for the same thing on every page.

**NEW-5 · MAJOR — Inspector: "Collateral sweep — 1 of 3 attempted accounts failed" now looks broken on a 1,412-account book**
- Page: Inspector Trust card (amber "!"). Before: "1 of 3 rows failed · gen 4". Now: "1 of 3 attempted accounts failed".
- The new words say it plainly: the sweep tried 3 accounts. The Book says there are 1,412. So I read "the collateral job only
  looked at 3 accounts", which looks like an outage. It still doesn't answer my question: is MY $12,462 current, and does
  "Not liquidatable yet" still hold?
- Expected: first whether this account's collateral is fresh, then (if at all) the engine-wide tally, with a total that looks like the book's.

**NEW-6 · MINOR — Verification: "feeds registry — identical to service.registry_fingerprint, by construction"**
- A dotted wire field name has replaced "fingerprint weld" on the Proof subject card.

**NEW-7 · MINOR — verificationFailed now cites a repo path**
- "This manifest carries the tallies, not the rows: they are recorded in the committed drift report,
  roadmap/evidence/artifacts/w1-reconcile/drift-report.json." Also still "receipt verdict "fail" (exit 1)".
- Better than "3 drift named", but a visitor cannot open a repo path from here. I wanted the three rows.

**NEW-8 · MINOR — Scenarios: "the 20 largest … by debt" under a table ordered by room**
- Footer: "the 20 largest of the 118 accounts that become liquidatable, by debt". Rows run by "Room today" 0.3% → 7.5%, with debt
  jumping about ($12,621 first, $58,813 fourth from the bottom). I read the caption as the sort order and thought the table was mis-sorted.

**NEW-9 · MINOR — Book tile "Liquidatable · ≥ $100" whose sub-line counts the under-$100 ones**
- "2 accounts · 47 more under $100 · 49 in all": a tile labelled "≥ $100" ends in a total that includes positions under $100, and it
  switches from "accounts" to positions mid-line.

**NEW-10 · MINOR — Five names for the same six accounts**
- Book: "Not computed" / "could not be computed this batch" / "collateral never read". Overview: "Coverage 1,406 / 1,412 computed".
  Scenarios: "not measured 6". History record: "refused position rows 6".

**NEW-11 · MINOR — API page: literal "* " bullets** (see item 11).

---------------------------------------------------------------------------------------------------

## 3. The README, as a hiring evaluator landing on the GitHub repo

**What I actually see on GitHub today.** `github.com/kaseLunt/solvent` (public) shows the OLD README: "Real-time solvency companion
for ether.fi Cash borrowers. Work in progress. … (coming) risk engine, public API, alerts, web." It has 21 lines, no screenshots,
and a red "ci failing" badge. Local `main` is 235 commits ahead of `origin/main`, and `docs/readme/` does not exist on the remote.
Until that ships, nothing below reaches an evaluator.

**Reading the new README as if it were pushed: 60 seconds.**
- What I conclude: "A serious, mostly back-end solo project. It indexes ether.fi Cash from chain, computes liquidation distance
  in exact integers, serves it through a contract-first API and has a Next.js UI. It is not deployed, CI is red, and the author is
  careful to the point of obsession."
- What makes me trust it:
  - The first paragraph is crisp: what it reads, what it computes, what it does not do (no funds, no wallet, no accounts), and "not affiliated".
  - The ASCII pipeline shows the single writer, zero-RPC riskd/API and the read-only reconcile harness.
  - Claims name real tests (`TestNoFloatAnywhereInNonTestSources`, `TestAPIIssuesNoWritingSQL`, `TestDeepForkWalksBackToVerifiedAncestor`).
  - The reconcile receipt has pinned blocks, hash checks and a sha256.
  - "Refusals are rows, not errors."
  - The Status line says what isn't done.
- What makes me doubt it:
  1. The first pixel after the title is a red CI badge, and line 14 confirms it: "Remote CI (.github/workflows/ci.yml) has not passed since 2026-07-30."
  2. The Status paragraph is five negatives in a row, directly above the fold: not deployed, deploy target undecided, client not
     published, alerts not built, CI failing.
  3. I cannot see it run. There is no live link, and "The served app has no demo mode". Seeing a single page takes two RPC endpoints,
     Docker Postgres, an indexer backfill and three terminals, even though a demo dataset exists (it lives only in test fixtures).
  4. The numbers disagree with the screenshots. The README's receipt says "Run 2026-08-02 … 30,838: 30,838 exact, 0 drift". The
     Overview screenshot says "87/87 checked rows exact · 0 drifted", and the Inspector screenshot says "29/29 Cash rows · Jul 29, 02:14 UTC".
     The caption "Demo dataset" does not tell me the verification figures in the pictures are sample figures, not the receipt above.
  5. The "Approval record" column is a wall of session UUIDs and round numbers, and it says "no closing approval is recorded" four
     times (including for the whole web tree). It reads as an internal ledger, and "reviewed by OpenAI's Codex" may read to some
     evaluators as AI reviewing AI.
  6. It says "eight-page web app" but shows seven screenshots. Verification, the page the trust story rests on, is the one missing.
  7. Every screenshot carries an amber "Reconnecting" pill (the caption explains it, but it is the first thing the eye finds top-right).
- What is missing above the fold:
  - Any image: the screenshots start at line ~215 of 264, after the run instructions and the test notes.
  - A live link, or a one-command way to see the UI on the demo data.
  - One or two lines for a reviewer: "what is hard here and where to look first" (the reorg protocol, the exact-integer engine, the reconcile harness).
  - Who built it and why.

**README findings**

| Sev | Title | Experience |
|---|---|---|
| BLOCKER | The public repo still shows the old "Work in progress" README | I land on GitHub and read "(coming) risk engine, public API, alerts, web", with no screenshots and a failing badge. The new front door is local only (235 commits unpushed). |
| MAJOR | A red CI badge is the first thing I see, and the README confirms CI hasn't passed in two months | Honest, and it reads as a broken project before I have read a sentence. |
| MAJOR | Nothing visual above the fold; screenshots sit at the bottom | I decide in 60 seconds, and the pictures come after "Run it locally" and "Tests". |
| MAJOR | No way to see it without RPC endpoints and an indexer backfill | There is no live link and no demo mode, although a demo dataset exists. |
| MAJOR | The README's receipt (30,838 rows, Aug 2) disagrees with the screenshots (87/87, 29/29, Jul 29) | On a project whose pitch is that numbers are exact, the first two verification numbers I compare disagree. |
| MINOR | The approval column is session UUIDs and round numbers; "no closing approval is recorded" appears 4 times | It reads as process bookkeeping rather than evidence. |
| MINOR | "eight-page web app", seven screenshots, and Verification is the one left out | |
| MINOR | The API page's sample does `import { SolventClient } from "@solvent/client"`, while the README says the client "is not published to npm" | An integrator copies a line that cannot work. |

---------------------------------------------------------------------------------------------------

## 4. Still open from Task 12, untargeted and unchanged (for the owner's list; severities as I experience them now)

- BLOCKER (searcher/integrator): the API's base URL is "http://localhost:8080" in the chip, the TypeScript sample and every curl. It
  leaks into activityRefused ("(http://localhost:8080/v1/events?limit=50)") and verificationUnavailable.
- MAJOR: "Reconnecting" in amber in every nav, beside "Snapshot 42s · fresh", and in every README screenshot.
- MAJOR: Overview "03 · VERIFY — Reconciled to chain — Positions are re-derived against live contract reads". Verification says the live
  batch is covered by no check. The present-tense claim survives on the front door.
- MAJOR: one liquidation row still shows two sizes that disagree: "debt repaid 0.35812 USD" beside "−0.341066"; "debt repaid 2,500 USDC" beside "−2380952380".
- MAJOR: Activity cannot be filtered to an address, although the API page shows `/v1/events` takes `account` ("Restrict to one account's own actions").
- MAJOR: History's headline answers the Book's question ("$27.8M of Cash debt is outstanding …"). "What changed" is one grey line in the
  chart card, the chart is a flat line with "peak $27,942,906.330446" and "$27,828,808.216758" (six-decimal dollars), and the timestamps are ISO.
- MAJOR: Activity's headline and tiles describe paging ("3 liquidations among the 50 chain actions loaded … more exist beyond these"; "Rows loaded 50").
- MAJOR: Scenarios' bands (4.76% / 9.09%) differ from the Book's (2 / 5 / 10%): "the 27 accounts within 9.09% of their cap" vs the Book's "within 10%".
- MAJOR: the scenario descriptions are still engineering prose: "EXPLICITLY NOT a health-factor event … bit-identical", "closed-form HORIZON
  PROJECTION, never as a spot shock", "composed from ETH/USD by construction".
- MAJOR: historyDegraded still quotes "observatory_points does not exist on this database — the rollup (Task B2, migration 00016)", and "the Book" is not a link.
- MAJOR: activityRefused is still developer text: "400 bad_request: events page: cursor was minted for a engine-scoped page but this request is cross-engine-mode…".
- MAJOR: the Book's chart card is two-thirds empty (the card is about 800 px tall and the bars fill the top 300). The "Room" column is dollars on two rows and percent on the rest.
- MAJOR: it looks official until the footer's last line ("a portfolio project, not affiliated with ether.fi").
- MAJOR: verificationUnavailable says "no assumed batch" and then shows "18,251 — batch · 1,412 Cash accounts". (It now has Retry and says the failure once.)
- MINOR: Inspector history is in batches ("the last 14 batches (≈6m)"). "Bad debt on the book — $239.60 … across 1 account" still doesn't name the account.

---------------------------------------------------------------------------------------------------

## 5. Five-second test per page (cold visitor, after Plan 5)

- Overview: "A liquidation monitor for ether.fi's card: $6,840 at risk across 2 accounts. Clear. Is it official? Why 'Reconnecting'?"
- Book: "Posture at a glance, clear, and I can now open all 27 near-cap accounts. Six rows of dashes at the bottom. Did something fail?"
- Inspector: "This account is $190.50 from trouble, not there yet. Clear. Then an amber '1 of 3 attempted accounts failed'. Whose accounts?"
- Scenarios: "ETH −30% makes $1.2M liquidatable across 118 accounts. Clear. What is 941 'changing lane' next to 425 'change band'?"
- History: "Same $27.8M as the Book, and a flat line. What changed?"
- Activity: "Half the amounts are readable now, but one says 180771428 and the liquidations come with paragraphs about \`bps\`."
- Verification: "87 checked rows passed in July. The 29 and 14 are 'not a breakdown'. So what were the 87?"
- API: "17 endpoints, rendered properly now, at localhost."

---------------------------------------------------------------------------------------------------

## 6. Ranked findings (this re-walk)

| Sev | Surface | Title |
|---|---|---|
| BLOCKER | GitHub / README | The public repo still shows the old "Work in progress" README; the new front door is unpushed |
| BLOCKER (carried) | API | Base URL is localhost everywhere; no public host |
| MAJOR | Activity | NEW-1 Liquidation rows carry spec prose with raw backticked field names |
| MAJOR | Activity | NEW-2 One Amount column holds two scales (252.733333 above 180771428) |
| MAJOR | Book | NEW-3 The six Not-computed rows are all dashes; the unverdicted debt has no size anywhere |
| MAJOR | Inspector ↔ Verification | NEW-4 "29/29 Cash rows" on the Inspector vs "account comparisons … not a breakdown of the checked rows" on Verification |
| MAJOR | Inspector | NEW-5 "1 of 3 attempted accounts failed" looks like a broken sweep on a 1,412-account book, and still doesn't say whether my collateral is current |
| MAJOR | README | Red CI badge first; the README confirms CI hasn't passed since 2026-07-30 |
| MAJOR | README | Nothing visual above the fold; screenshots at the bottom |
| MAJOR | README | No way to see the product without RPC endpoints and an indexer backfill |
| MAJOR | README | Receipt figures (30,838 rows, Aug 2) disagree with the screenshots (87/87, 29/29, Jul 29) |
| MAJOR | Overview → History | Item 3 PARTLY: headlines still say 2, then 49; only a grey tile sub-line bridges them |
| MAJOR | Book | Item 6 PARTLY: the legacy market's 46 liquidatable positions are still in a collapsed line at the page foot |
| MAJOR | Verification | Item 7 PARTLY: the page admits 87 ≠ 29 + 14 but never says what the 87 are; "advisory" is unexplained; "87/87" appears 6 times |
| MAJOR | Scenarios | Item 8 PARTLY: "changing lane" (941) vs "change band" (425) is a distinction no visitor can make; 941 matches nothing on the page |
| MAJOR | Scenarios | Item 12 PARTLY: disabled "Compare…" still looks clickable in light theme, with no reason given; "Run" sits beside an already-computed result |
| MAJOR | All pages | Item 10 PARTLY: the named words are gone, and new ones plus about 20 old ones remain (listed in §1) |
| MAJOR (carried) | See §4 | Reconnecting pill; Overview's present-tense "Reconciled to chain"; two liquidation sizes; no address filter on Activity; History's headline; Activity's paging headline; 4.76/9.09 bands; scenario prose; historyDegraded and activityRefused developer text; empty chart card and mixed Room units; official-looking brand; verificationUnavailable batch contradiction |
| MINOR | Various | NEW-6 to NEW-11; README approval-UUID column, 7 of 8 screenshots, unpublished-client import; items 4 and 11 leftovers |
