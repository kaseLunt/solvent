# Task 12 — cold-visitor read-through of the eight pages (USER persona)

Date: 2026-09-20. Advisory only; no repo file was edited.

What I looked at
- Captures (1440x900) in `C:\Users\kasel\AppData\Local\Temp\claude\C--Users-kasel-source-repos-etherfi-Solvent\07857daa-05b2-4c63-9012-61e6749cefcb\scratchpad\gate6\`:
  every dark `-fold` and `-full` for overview, book, inspector, lab, history, activity, verification, api; light folds for overview, book, history, lab;
  all five honest states (historyDegraded, activityRefused, activityExhausted, verificationFailed, verificationUnavailable).
  The API full page is 12,276 px tall, so I read it in slices (`...\scratchpad\userwalk\api-00.png` .. `api-08.png`).
- The served site at http://localhost:3111 with no API behind it (the "bad day"): I loaded `/`, `/book`, `/inspector`, `/inspector/<addr>`,
  `/inspector/hello`, `/lab`, `/lab?address=<addr>`, `/observatory`, `/feed`, `/proof`, `/nope` in a browser and read what a visitor gets after the page settles
  (screens and text in `...\scratchpad\userwalk\bad-*.png|txt`).
- Code only to confirm where a link goes (Book rows -> `/inspector/<addr>`; "Stress this address" -> `/lab?address=<addr>`; Inspector "Evidence" -> `/proof`).

Severity: BLOCKER = I would leave / I was misled. MAJOR = I got stuck or misread. MINOR = friction.
I never grade on how hard something is to build, and I do not accept "it is honest" as an answer to "it reads as broken".

---------------------------------------------------------------------------------------------------

## 1. The four walks

### 1.1 First-time visitor from a shared link (lands on `/`, then the nav left to right)

30 seconds on `/`: I get it. "70,000 people borrow against crypto to spend on a Visa card. This is how close each of them is to liquidation — right now."
is the best sentence on the site; the red line "$6,840 of Cash debt is liquidatable right now, across 2 accounts." tells me something is actually being measured;
three cards tell me where to click ("What is at risk now? / Is this address at risk? / What if ETH falls 30%?"). That part works.
Then it wobbles: the hero says 70,000 people and the strip directly below says "Accounts 1,412". The nav says "Reconnecting" in amber next to a page that says
"right now" and "Snapshot 42s · fresh". The brand reads "Solvent · ether.fi Cash risk" and the eyebrow "A live risk surface for ether.fi Cash", so I assume this is
ether.fi's own page until the very last line of the footer: "a portfolio project, not affiliated with ether.fi". Is it real? I honestly cannot tell from the first viewport.

Page by page — the ONE thing, whether the first viewport gave it to me, and what I did not understand:

| Page | The one thing it told me | From the first viewport? | Words / numbers I did not understand |
|---|---|---|---|
| Overview | $6,840 is liquidatable now; here are three doors | Yes | "70,000" vs "1,412"; "below the $100 line" next to "$109.45"; "Current not projected"; "Batch 18,251"; "Coverage 1,406 / 1,412 computed"; "borrow cap"; "named refusal"; "87/87 gated rows exact · drift 0"; "Verified-ancestor rewind" |
| Book | Same sentence, then six tiles, a bar chart, a short table | Yes | "Liquidatable · material"; "room"; "Median room 53.9% of borrow cap · 10th pct 19.2%"; "collateral sweep never ran"; "Debt Manager engine"; "Legacy Aave v3 market"; Room column that is dollars on two rows and percent on the rest |
| Inspector | "Within $190.50 of its borrow cap. Not liquidatable yet." | Yes — best page | "Lookup complete · both engines"; "PriceProvider v2"; "strict rule: debt > cap"; "Collateral sweep 1 of 3 rows failed · gen 4"; "committed receipt"; "LTV"; further down "custodied", "normalized debt", "raw units" |
| Scenarios | "$1.2M more Cash debt becomes liquidatable, across 118 accounts." | Yes | "Factor shock on ETH/USD … composed from ETH/USD by construction"; "closed-form HORIZON PROJECTION, never as a spot shock"; "bit-identical"; "4.76%", "9.09%"; "Accounts moved 941"; "Scenario eth_minus_30 · v1"; "Config v1"; "Out of model"; "the wire's own ranking"; "Not run yet" |
| History | That $27.8M is outstanding — which the Book already told me | No. What CHANGED (the reason I clicked History) is one grey sentence above a flat line | "Stride native hourly buckets · every captured bucket served verbatim"; "Range … → unbounded"; "Buckets 165 captured · 1 withheld · 2 absent"; "withheld" (by whom? why?); "Bucket record"; "watermark block"; "refused position rows"; "provenance row(s) + the rate snapshot"; "$27,942,906.330446" |
| Activity | That 50 rows are loaded | No. The headline is about the page's loading, not about the world | "chain actions loaded"; "(deficit_created)"; "Filter echo engine — · types all · since_block — · limit 50"; "LIVE STREAM · THIS CONNECTION ONLY"; "Amount · engine units, not USD"; "252733333"; "normalized debt · raw units · USDC"; "aave-scaled"; "record-only"; "bonus realized — / configured 500 bps" |
| Verification | A check passed 87/87 once, on Jul 29, and does not cover what I am looking at | Half. I got "87" six times and still do not know 87 of what | "pinned reconcile run"; "gated (must-match) rows"; "drift"; "weld · debt_manager"; "fingerprint weld"; "Proof pin"; "Batch key"; "materialization key"; "SERVING · WATERMARKED"; "Proof subject / Live subject"; "Committed probe records"; "recon/p3-probes.md"; "deploy-bound"; "the wire's own integers" |
| API | There are 17 endpoints and no key is needed | Yes for a developer | "Contract" (on a DeFi site I read that as smart contract); "committed client fixture"; "A CI test re-reads both and fails if this page's extract has drifted"; "Base URL http://localhost:8080" |

Where the first-timer gets stuck: History, Activity and Verification each open on a statement about the *record-keeping* (hours recorded, rows loaded, a pinned run)
instead of a statement about ether.fi Cash. After Scenarios, the site stops talking to me and starts talking to its own database.

### 1.2 The ether.fi risk lead: Book -> a row -> Inspector -> "Stress this address" -> Scenarios -> back

- Book fold: headline posture in 5 seconds — yes. Debt, liquidatable count and sum, freshness: all there. Good.
- Drill-down: the "Needs attention" table is the only table. It shows 2 liquidatable, 6 near-cap and 6 not-computed rows. The headline told me 27 accounts are within 10%
  carrying $830K; I can see 6 of them, worth about $205K. There is no way to open the other 21, no full book, no sort, no "see all". My morning triage ends here.
- The six "Not computed" rows carry about $178K of debt ($2,342 + $614.38 + $46K + $7,063 + $112K + $10K) — 26 times the headline liquidatable figure — and the only explanation is
  the tile caption "collateral sweep never ran". Nobody tells me whether that $178K could be under water. That is the number I would escalate, and the page treats it as a footnote.
- Row -> Inspector: lands exactly where promised (address in the box, one-sentence verdict). Good hop.
- Inspector -> "Stress this address →": lands on Scenarios in its one-address mode. The promise is kept, but the same table is already at the bottom of the Inspector
  ("Stress this address — the committed scenarios, applied to this account"), so the hop costs a page load and mostly repeats what I had.
- Scenarios -> back: there is a way back to the Inspector from the one-address view; from the whole-book "Most affected accounts" each row opens the Inspector. Fine.
- Second page that should be first: the legacy market ("Legacy · Aave v3 market — 8,552 positions · $1.9M debt · 46 liquidatable · 0 refused") is a collapsed line at the very bottom of the Book.
  46 liquidatable positions that never reach a headline is not a footnote for a risk lead.
- Stress preview on the Book is good and each line opens its scenario.

### 1.3 The DeFi power user checking their own address (Inspector, then Activity)

- Am I safe / how far? Yes, immediately and well: "Within $190.50 of its borrow cap. Not liquidatable yet." plus "Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat."
  That boundary sentence is the single most useful line on the site and it is in small grey type under a table.
- Doubt creeps in on the same screen: Trust shows an amber "! Collateral sweep — 1 of 3 rows failed · gen 4". The table lists 2 assets. Is a third asset missing? Is my $12,462 collateral complete?
  The headline does not mention it. I no longer know whether to believe "Not liquidatable yet".
- What happened recently? The Activity section on the Inspector says I supplied "600000000000000000 weETH [raw units]" and "1250000000000000000000 ETHFI [raw units]". Times are "2026-08-08T20:11:22Z".
  One row is greyed out ("block 155,315,000 · Repay · -150 USDC") as if disabled. The footnote: "6 custodied action(s) loaded for this account: 5 with custodied header time, newest first;
  1 untimed row(s) follow, in an order that is not chronology." I do not know what "custodied" means.
- Then I try the Activity page: there is no way to filter it to my address. Amounts are "252733333" under "Amount · engine units, not USD". Supplies and withdrawals say "record-only" with no amount at all.
  I cannot tell what happened to anyone's position, let alone mine.
- History of my position: the x-axis is "batch 18,152 … batch 18,251" with no time and no y-scale except "3.8%" at the end. "The last 100 batches" is about 43 minutes. I wanted days.

### 1.4 The liquidator / searcher

- Opportunity: Book fold — 2 accounts, $4,620 and $2,220, negative room shown in dollars; 47 dust behind a toggle. Fast. Good. The legacy market's 46 liquidatable are hidden in a collapsed line at the bottom.
- Near-liquidation pipeline: 6 of 27 shown, sorted by room only. I want it by size and I want all of it.
- Freshness: "Snapshot 42s · fresh" is right where I need it — and the nav says "Reconnecting". Which one do I believe?
- By API: the API page tells me the base URL is "http://localhost:8080". Every one of the 41 samples points at localhost. There is no public host anywhere on the page. I cannot get it by API.
  There is no recipe for "give me the liquidatable set"; the only `/v1/positions` sample uses `engine=aave_v3_etherfi` (the legacy market), not Cash.
- Trust: Verification says all 87 checked rows matched — in a fixed run that "finished Jul 29, 02:14 UTC" and "Batch 18,251, served now, is live data that was not re-checked and does not inherit it."
  So: 87 rows out of roughly ten thousand positions, once, ten days before the data I am looking at. Meanwhile the Inspector and the Overview show green "reconciles to chain" ticks.
  I trust the site's candour and I do not yet trust its numbers — and I resent the green ticks a little.

---------------------------------------------------------------------------------------------------

## 2. Findings, ranked by cost to a real visitor

### 2.1 BLOCKERS

**B1 — Activity amounts are unreadable machine integers; supplies/withdrawals have no amount at all**
- Page: Activity (`/feed`), table column "Amount · engine units, not USD"; also Inspector, "Activity" section.
- Saw: "252733333 · normalized debt · raw units · USDC", "−2380952380 · aave-scaled · raw units · USDC", "record-only" on every supply/withdraw/collateral row;
  on the Inspector "600000000000000000 weETH [raw units]", "1250000000000000000000 ETHFI [raw units]" (while the holdings table on the same page says weETH 2.1 and ETHFI 3,250).
- Expected: to read a row as "borrowed $252.73" / "supplied 0.6 weETH". A position holder asking "what happened to my position" and a liquidator asking "how big was that liquidation" both leave with nothing.
  A column header that says "not USD" is an apology, not an answer.
- Severity: BLOCKER (personas 3 and 4 cannot complete the task this page exists for).

**B2 — The hero says 70,000 people; the strip under it says 1,412 accounts**
- Page: Overview, hero headline vs "Cash book · right now" strip (also Book: "1,412 borrowing accounts", legacy "8,552 positions").
- Saw: "70,000 people borrow against crypto … This is how close each of them is to liquidation — right now." then "Accounts 1,412".
- Expected: the two numbers to be the same population, or one sentence saying how they relate. "Each of them" promises 70,000 positions; the product shows 1,412 (9,964 with legacy).
  On a site whose pitch is "every number opens its evidence", the first number on the first page is the one with no evidence.
- Severity: BLOCKER (I was misled in the first five seconds; it is the "is it real?" test and it fails).

**B3 — The API page's base URL is localhost**
- Page: API (`/developers`), chip "Base URL http://localhost:8080", the TypeScript sample, and all curl samples (41 occurrences). The same host leaks into error text elsewhere:
  activityRefused "(http://localhost:8080/v1/events?limit=50)", verificationUnavailable "(http://localhost:8080/v1/evidence)".
- Expected: a host I can call from my machine, or a plain statement that there is no public endpoint yet. As shown, the answer to "can I get it by API?" is no.
- Severity: BLOCKER for the searcher / integrator.

**B4 — Green "reconciles to chain" ticks claim more than Verification says is true**
- Pages: Inspector Trust card ("✓ Book reconciles to chain — 29/29 Cash rows exact · committed receipt", with "Evidence →"); Overview "03 · VERIFY — Reconciled to chain —
  Positions are re-derived against live contract reads … 87/87 gated rows exact · drift 0"; vs Verification dek: "That run is a fixed, reproducible check, finished Jul 29, 02:14 UTC;
  its result covers that run and nothing else. Batch 18,251, served now, is live data that was not re-checked and does not inherit it."
- Saw: on MY account's page, a green tick beside "Book reconciles to chain". I read that as "this account's numbers were checked against the chain". "Evidence →" took me to a deployment-wide page
  that never mentions my account and tells me the live data was not checked.
- Expected: the tick to say what Verification says — a one-off check of 87 rows on a date — or not to be a green tick on a per-account page.
- Severity: BLOCKER (misled; and the correction is two clicks away on a page most people will never open).

### 2.2 MAJOR

**M1 — Book: I can see 6 of the 27 near-cap accounts and there is no full table, no sort, no "see all"**
- Page: Book, "Needs attention". Saw: headline "27 accounts are within 10% of their borrow cap, carrying $830K"; table lists 6 (about $205K). Sorted "Material first, then by room" with no other order on offer.
- Expected: the whole near-cap set, sortable by debt and by room, and a way to reach the full book of 1,412. Risk lead and liquidator both stop here.

**M2 — "$109.45 — below the $100 line" reads as a contradiction**
- Pages: Overview strip and Book dek. Saw: "47 more positions are technically liquidatable but total $109.45 — below the $100 line and not headlined."
- Expected: to understand that each of the 47 is under $100. As written, $109.45 is said to be below $100. Also "the $100 line" and "technically liquidatable" are never explained; tile says "Liquidatable · material".

**M3 — The liquidatable count is 2 on one page and 49 on the next**
- Pages: Overview/Book headline "across 2 accounts"; History tile "Liquidatable positions 49"; Scenarios "was 49, now 167"; Book histogram "$6,949 · 49"; Book legacy line "46 liquidatable" (never headlined anywhere).
- Expected: one count, or the same "2 material + 47 small" wording wherever the number appears. A cold visitor going Book -> History concludes one of them is wrong.

**M4 — Scenarios: three different numbers are all called "moved"**
- Page: Scenarios. Saw: tile "Accounts moved 941 — of 1,406 measured · 0 improved"; dek "425 accounts move to a worse band"; card "425 accounts change band"; table footer "showing 20 of 118 accounts moved".
  The grid adds to 425 off the diagonal; nothing on the page adds to 941.
- Expected: one meaning of "moved" and a tile I can reconcile with the grid beneath it.

**M5 — Scenarios uses bands nobody can explain (4.76%, 9.09%) and they differ from the Book's**
- Pages: Scenarios grid "< 4.76% / 4.76% – 9.09% / 9.09% – 20% / ≥ 20%" and dek "the 27 accounts within 9.09% of their cap"; Book bands "< 2% / 2–5% / 5–10% / 10–25% / 25–50% / ≥ 50%" and "27 accounts within 10%".
- Expected: the same bands on both pages, in round numbers. Same 27 accounts, two different thresholds — I assumed one page had a bug.

**M6 — History: the chart's left label contradicts the sentence above it, and the line is flat**
- Page: History, "How the book moved". Saw: "debt rose $1.8M to $27.8M" and, on the chart, "$27,942,906.330446" at top-left and "$27,828,808.216758" at the right end of a flat line.
  I read the left label as the starting value — so debt FELL $114K. (It may be the axis maximum; nothing says so.) Six decimal places on dollars reads as a raw dump.
  "accounts fell 52 to 1,412, and liquidatable positions rose 1 to 49" — "rose 1 to 49" reads as "from 1 to 49".
- Expected: a chart on which I can see the $1.8M rise the sentence claims, labels I cannot misread, and "rose by 1, to 49".
- Also looks broken: a dead-flat line pinned to the top of an otherwise empty box.

**M7 — History's headline answers the Book's question, not History's**
- Page: History headline + dek. Saw: "$27.8M of Cash debt is outstanding, across 1,412 accounts in the hour starting Aug 8, 20:00 UTC." / "165 of the 168 hours in this window were recorded…"
- Expected: what changed — the sentence currently hidden in the chart card ("debt rose $1.8M …") is the page's actual answer. I also cannot tell whether "Aug 8, 20:00 UTC" is the current hour,
  there is no freshness statement like the Book's, the window is 7 days with no way to change it, and the four tiles each repeat "bucket 2026-08-08T20:00:00Z".
  The instruction "click any bucket for its full record" exists only inside the Methodology drawer; nothing on the chart says it is clickable.

**M8 — History speaks its own storage vocabulary**
- Page: History chips, section titles, record card, drawer. Saw (exact): "Stride native hourly buckets · every captured bucket served verbatim"; "Range 2026-08-01T21:00:00Z → unbounded";
  "Buckets 165 captured · 1 withheld · 2 absent"; "Served 2026-08-08T20:22:50Z"; "Bucket record 2026-08-08T20:00:00Z"; "captured at … · watermark block 155,323,444."; "state captured";
  "refused position rows 6"; "6 provenance row(s) + the rate snapshot"; drawer: "source · observatory_points rollup (points survive batch retention; batch + materialization identity retained by the rollup)".
- Guessed: stride = interval; bucket = hour; withheld = the site chose not to show it (why?); absent = the collector was down; watermark = the block the data was read at.
- Expected: "hour", "missing", "held back because …", human dates. "withheld" with no reason reads as something being hidden from me. A table name (`observatory_points`) is on a public page.

**M9 — Activity's headline and hero tiles are about pagination**
- Page: Activity header. Saw: "3 liquidations among the 50 chain actions loaded, the newest at Aug 8, 20:21 UTC; more exist beyond these."; tiles "Rows loaded 50 — more available", "Liquidations 3 — among the loaded rows";
  chips "Scope all engines · View all actions · Order by block time · Newest 2026-08-08T20:21:05Z · Filter echo engine — · types all · since_block — · limit 50"; dek "(deficit_created)";
  type chips "collateral_enabled", "collateral_disabled", "deficit_created"; "Since block · choose one engine".
- Guessed: "Filter echo" = the server repeating my filter back; "since_block" and "limit" are request parameters.
- Expected: a statement about the world ("3 liquidations in the last hour, $X repaid") — "50 loaded" is a fact about my browser. Wire field names (`since_block`, `limit`, `deficit_created`) are on a public page.

**M10 — Activity cannot be filtered to an address, and liquidations have no dollar size**
- Page: Activity controls and liquidation rows. Saw: filters for engine, view, type, block — none for account. Liquidation detail "debt repaid 2,500 · seized 0.65625 weETH · bonus realized — / configured 500 bps".
- Expected: paste my address here too (persona 3 lands here second); a liquidator wants repaid and seized in dollars, and "bonus realized —" looks like a missing value with no reason given.

**M11 — One liquidation row shows two sizes that do not agree on their face**
- Page: Activity, liquidation rows. Saw: "debt repaid 2,500" in the detail and "−2380952380" in the Amount column of the same row; "debt repaid 0.35812" beside "−341066".
- Expected: one size. If they are different units of the same thing, I cannot know that.

**M12 — Verification is written in the vocabulary of the people who built it**
- Page: Verification, everything below the dek. Saw (exact): "in this deployment's pinned reconcile run"; chips "Proof pin 5f0b3e2a", "Receipt exact · 87/87", "Batch key 9a4a7c1d...f5a2b9";
  "gated (must-match) rows exact · drift 0"; "87 gated rows reconciled exact against the chain; 0 drift named."; "every position's health from the wire's own integers";
  "Proof subject — PROOF · EXACT @ 5f0b3e2a"; "ACCEPTED · every gated row welded exact"; "weld · debt_manager 29/29 exact"; "weld · aave_v3_etherfi 14/14 exact";
  "fingerprint weld — identical to service fingerprint, by construction"; "Live subject — SERVING · WATERMARKED"; "operational, never the proof"; "materialization key";
  "Committed probe records — 1 committed probe record(s) · 1 manifest note(s)"; "recon/p3-probes.md — probe records name endpoints by environment variable only — publishable by construction.";
  "manifest note — this manifest is deploy-bound: every field is carried by the build, persisted by a batch, or read from a committed artifact."; link "the contract and its samples → API".
- Guessed: gated = rows that must match; drift = difference from chain; weld = a comparison; pin = a commit hash; "p3" = some internal phase name.
- Expected: which rows were checked, how they were picked, against what, how often it is repeated, when the next one is, and how I could repeat it myself. Wire names (`debt_manager`, `aave_v3_etherfi`),
  a repo file path with a roadmap name (`recon/p3-probes.md`) and build-process talk are on a public page. The last table tells a visitor nothing.

**M13 — 87 does not equal 29 + 14, and the Inspector says 29 while the Overview says 87**
- Pages: Verification "gated rows 87/87 exact" with breakdown "debt_manager 29/29" and "aave_v3_etherfi 14/14" (= 43); Inspector Trust "29/29 Cash rows exact"; Overview "87/87 gated rows exact".
- Expected: a breakdown that adds up to its total, and one number for the same check across pages.

**M14 — Verification says "87/87" six times in one viewport and never says 87 of what, or that the check is older than the data**
- Page: Verification fold. Saw: headline, chip, tile, tile caption, banner "Reconcile receipt: 87 gated rows exact, 0 drift", and the Proof subject row — all the same fact.
  The check "finished Jul 29"; the batch was "computed at 2026-08-08T20:22:08Z". Nothing flags the ten-day gap. The "Architecture & verification" tiles repeat Overview's "How it works" and lead with a block number.
- Expected: the fact once, then the things I actually asked (M12).

**M15 — verificationFailed names no rows**
- Capture: verificationFailed. Saw: "84 of 87 checked rows matched; 3 rows drifted.", "3 drift named.", "Reconcile receipt failed: receipt verdict "fail" (exit 1)", "REJECTED · receipt verdict "fail" (exit 1)".
- Expected: the three rows and by how much — "drift named" promises names and the only candidate is a collapsed "15 provenance row(s)". "(exit 1)" is a process exit code.
  I also expected the Book and Overview to carry this failure; I could not confirm they do, and the Overview pipeline line would be the first place I would look.
  The headline and tile are amber while the Proof subject is red — is this a warning or a failure?

**M16 — verificationUnavailable contradicts itself about the batch**
- Capture: verificationUnavailable. Saw: dek "Nothing is substituted for it: … no assumed batch"; chips "Live batch —", "Batch key —"; and directly below, tile "02 · Compute 18,251 — batch · 1,412 Cash accounts",
  "Batch 18,251 computed at 2026-08-08T20:22:08Z". The failure is stated twice (dek and bottom banner). "The service did not say when to retry" and there is no retry.
- Expected: either the batch is known or it is not; and one thing to do next.

**M17 — historyDegraded quotes a table name, a task name and a migration number**
- Capture: historyDegraded. Saw: "Observatory series: observatory_points does not exist on this database — the rollup (Task B2, migration 00016) has not been applied. That is a fact about this deployment,
  not an empty history; live figures are on the Book." Chip "Rollup unavailable". Then 600 px of nothing. Headline in dimmed grey.
- Understood: not my fault, nothing to do. Did not understand: every noun in the first sentence. "the Book" is not a link. It does NOT read as zero — good — but it reads as a stack trace.
- Expected: "Hourly history is not switched on for this site yet. The current figures are on the Book." and a link.

**M18 — activityRefused shows a developer error twice, blames me, and drops the rows I had**
- Capture: activityRefused. Saw: "The service refused this page." / "400 bad_request: events page: cursor was minted for a engine-scoped page but this request is cross-engine-mode — engine-scoped and cross-engine
  pages rank by different keys and their cursors are not interchangeable (http://localhost:8080/v1/events?limit=50). Restart the list below." — repeated verbatim in a red dashed box titled "PAGE REFUSED · bad_request";
  tiles "Rows loaded — page refused", "Liquidations — page refused"; table "page refused · bad_request: restart below"; BOTH "restart from page one" and "Load more" are offered.
- Understood: something went wrong when I asked for more rows. Whose fault: "bad_request" says mine — I only pressed a button. What next: two buttons, and the one the page tells me not to use is still there.
  The 50 rows I was reading are gone. Does not read as zero — good.
- Expected: "We could not load the next page because the filter changed. Start again from the top." once, with one button, keeping what I already had.

**M19 — activityExhausted: I cannot see which filter I applied, or clear it**
- Capture: activityExhausted. Saw: "No recorded chain action matches this filter." / "That is the service's real answer for this filter, not a loading state."; the only trace of my filter is the chip
  "Filter echo engine — · types deficit_created · since_block — · limit 50"; in the TYPE row no chip looks selected; tiles "Rows loaded 0", "Liquidations 0"; no "clear filter".
- Understood: genuinely empty, not my fault — this is the clearest of the five, and zero really is zero here. "not a loading state" is the page arguing with me about something I had not thought.
- Expected: the selected type to look selected, and one action to clear it.

**M20 — "Reconnecting" sits in the nav of every page, beside "right now" and "42s · fresh"**
- Pages: all (nav chip, amber); Activity strip "LIVE STREAM · THIS CONNECTION ONLY · RECONNECTING — No batch has arrived on this connection yet, so nothing live is shown."
  With no API at all the chip still says "Reconnecting" indefinitely (first paint says "Not connected").
- Expected: to know whether what I am reading is live. An amber "Reconnecting" next to a green "fresh" means one of them is wrong. If this is only the capture harness, it is still what a visitor on a flaky
  connection sees, and "this connection only" means nothing to me.

**M21 — "Not computed 6 — collateral sweep never ran" reads as a broken job, and hides $178K**
- Page: Book tile and the six dimmed rows. Saw: tile "Not computed 6 · collateral sweep never ran"; rows with "—" for room and debt of $2,342, $614.38, $46K, $7,063, $112K, $10K; the reason is only on hover.
- Expected: to be told, in words, what it means for me: about $178K of debt has no verdict — more than 25 times the headline liquidatable amount. "never ran" sounds like an outage nobody noticed.

**M22 — Book: the chart card is two-thirds empty**
- Page: Book, "Distance to liquidation, by debt" (about 450 px of blank card under the bars); "Bad debt on the book" card likewise mostly empty.
- Expected: nothing — but I assumed a second chart had failed to load.

**M23 — Book "Room" column is dollars on two rows and percent on the rest**
- Page: Book, Needs attention. Saw: "−$184.80", "−$42.18", then "0.3%", "0.4%".
- Expected: one unit per column. I first read "0.3%" as 0.3 dollars.

**M24 — Inspector: an amber warning that never says what it means for my numbers**
- Page: Inspector Trust card. Saw: "! Collateral sweep — 1 of 3 rows failed · gen 4". Backing table lists 2 assets; headline says "Not liquidatable yet." with no caveat.
- Expected: "one of your three collateral assets could not be read, so your cap may be understated/overstated" — or no warning. "gen 4" means nothing to me.

**M25 — Inspector Activity: "custodied", raw timestamps and a row that looks disabled**
- Page: Inspector, Activity section. Saw: subtitle "this account's chain actions · custodied times, newest first"; "2026-08-08T20:11:22Z"; a greyed row "block 155,315,000 · Repay · USDC · -150 USDC normalized debt";
  footnote "6 custodied action(s) loaded for this account: 5 with custodied header time, newest first; 1 untimed row(s) follow, in an order that is not chronology."
- Guessed: custodied = stored with a verified timestamp. Expected: "Aug 8, 20:11 UTC"; "1 action has no time yet"; no "(s)".

**M26 — Inspector History is measured in batches, not time, with no scale**
- Page: Inspector "History · room % over the last 100 batches" and "Room under the borrow cap". Saw: x-axis "batch 18,152" → "batch 18,251"; the only y value is "3.8%"; vertical dotted gaps with no explanation beside them;
  the same chart appears twice (Trust card and below).
- Expected: dates, a y-axis, and days rather than ~43 minutes. "How fast am I falling?" is the question and the chart cannot answer it.

**M27 — Scenarios list: is anything selected, and do I need to press Run?**
- Page: Scenarios left rail. Saw: four unchecked checkboxes while the first scenario is highlighted and its result is on screen ("Computed 42s ago"); "Not run yet" ×3; a primary button "Run ETH -30 percent".
  Descriptions: "Factor shock on ETH/USD. Every ETH-linked collateral moves jointly because each one's USD price is composed from ETH/USD by construction"; "This is EXPLICITLY NOT a health-factor event …
  every health factor is bit-identical"; "so this ships as a closed-form HORIZON PROJECTION, never as a spot shock."
- Expected: to know what the checkboxes are for, whether the result I see is current or needs running, and one plain sentence per scenario ("ETH falls 30%; everything priced off ETH falls with it").

**M28 — Scenarios "Most affected accounts": no magnitude, no rest of the list, internal phrase in the title**
- Page: Scenarios table. Saw: subtitle "room today → after the shock · the wire's own ranking"; every row "Room after: over cap" (the Inspector's version says "over cap by $1,069"); "showing 20 of 118 accounts moved" with no way to see the other 98; ordered by room today, not by size.
- Expected: by how much each goes over, all 118, sortable by debt. "the wire" is the builders' word for the API.

**M29 — API: endpoint text is the raw spec, with unrendered markup and house jargon**
- Page: API, endpoint cards. Saw: literal "**409 `batch_superseded`**" and "**no batch envelope**" with the asterisks and backticks showing; "(AMENDMENT 1/E)"; "THE EXCLUSION LAW"; "THAT REVERSAL LAW (1.5.0)";
  "THE TWO-MODE ORDERING LAW"; "this walk's denominator"; "Aave collateral configuration changes from `param_history`" (a table name); sample captions
  "packages/client-ts/test/fixtures/book.json (contract-validated 200 body, byte-identical)"; an artifact path "roadmap/evidence/artifacts/w1-reconcile/drift-report.json" inside a sample;
  dek "a committed client fixture validated against it, cited beside each. A CI test re-reads both and fails if this page's extract has drifted."; `engine` parameter on `/v1/params` with no description;
  hero tiles "Endpoints 17 / Error responses 6 / Contract version 1.8.0"; "read-only" next to "2 POST".
- Expected: the first screen to show me one call that returns the liquidatable Cash accounts, and prose written for a reader rather than for the spec's authors. "Contract" on a DeFi site means a smart contract —
  "API · CONTRACT V1.8.0" and Verification's "the contract and its samples → API" both misled me for a moment. The page is 12,000 px long; the index at the top does jump to each endpoint (good).

**M30 — The bad day: "not computed" for a network failure, developer error text, no retry, a live "Run" button that cannot run**
- Pages (no API): Overview/Book "The Cash book could not be loaded. — The request produced no HTTP response: Failed to fetch."; Book tiles "— not computed" ×6 (including a tile titled "Not computed" whose value is "— not computed")
  and panels "Not computed. Not computed."; chip "Identity unavailable" (Scenarios: "Identity missing"; loading: "Identity pending"; bad address: "Identity nothing looked up");
  Book link "Legacy Aave v3 market ↓" points at a section that is no longer on the page; Scenarios: bright primary "Run" and "Compare…" beside "Nothing can run until the listing answers." and
  "Run a scenario to see where accounts move."; only Activity offers "retry". During ordinary loading the Book already says "not computed" and Verification already says "The batch could not be read."
- Understood: the site is down, not my fault. It never looks like zero — good. Did not understand: "Identity"; why "not computed" (the word for a position the engine refused) is also the word for "we could not reach the server".
- Expected: "We can't reach Solvent right now. Try again." with a button, on every page; no dead anchor; no primary button that cannot work.

**M31 — The header chips use words nobody defined**
- Pages: Overview, Book, Inspector, Scenarios. Saw: "Current not projected"; "Batch 18,251"; "Coverage 1,406 / 1,412 computed"; "Lookup complete · both engines"; "Prices PriceProvider v2 · 35s";
  "Cash — Debt Manager engine · OP Mainnet"; "Engines Aave v3 market (legacy) and Cash"; "Result for batch 18,251"; "Config v1"; "Assumptions · Out of model".
- Guessed: batch = one recomputation of the whole book; engine = a lending market; "current not projected" = these are real numbers, not a what-if.
- Expected: one line somewhere that says what a batch and an engine are. "room" and "borrow cap" replace the term every DeFi user already knows (health factor) without saying so.

**M32 — The legacy market is a collapsed line at the bottom of the Book and unexplained**
- Page: Book footer "Legacy · Aave v3 market — 8,552 positions · $1.9M debt · 46 liquidatable · 0 refused"; Scenarios "Legacy · Aave v3 market result"; History/Activity switches "Aave v3 market (legacy)".
- Expected: to know what it is (is this still ether.fi Cash? are these real users?) and, as a liquidator, to see its 46 liquidatable positions without hunting. Six times the positions of the main book, in a disclosure triangle.

**M33 — It looks official until the last line of the footer**
- Page: Overview (and every nav). Saw: brand "Solvent · ether.fi Cash risk", eyebrow "A LIVE RISK SURFACE FOR ETHER.FI CASH"; footer, below the fold: "a portfolio project, not affiliated with ether.fi".
- Expected: to know who is telling me this before I believe a liquidation number about a named company's customers.

### 2.3 MINOR

- m1 Inspector: "$5,012" cap minus "$4,822" debt is $190, not the headline's "$190.50" (the 50 cents is hidden by rounding the cap). Dek says "A 3.8% fall in collateral value"; the boundary line says "a 4.5% fall" (weETH only) — two "falls" two inches apart.
- m2 Inspector stress table: "Debt Manager borrow APY +200bps (PROJECTION)" followed by a "PROJECTION" chip — said twice. Scenario names are "ETH -30 percent" here and on Scenarios but "ETH −30%" on Book/Overview.
- m3 Inspector tile captions: "USD · 4,822.000000 exact", "Σ collateral × per-asset LTV", "strict rule: debt > cap" — fine for me-the-power-user, noise for anyone else.
- m4 Scenarios: the page header sits hard against the nav; the "PROJECTION" chip touches the nav border. In light theme the 40 empty grid cells look like a loading skeleton.
- m5 URLs do not match the nav: Scenarios is `/lab`, History `/observatory`, Activity `/feed`, Verification `/proof`, API `/developers`. A shared link to "/feed" tells the recipient nothing.
- m6 `/nope` gives a bare black "404 | This page could not be found." that ignores the site's theme and offers no way on except the nav.
- m7 Overview address box has no visible submit; "vitalik.eth" is refused with "An address is 0x followed by 40 hex characters — nothing else is looked up." — clear, but ENS is what many holders have to hand.
- m8 Every full page ends in 150–250 px of empty background below the last element (Overview, Book, History, Verification) — reads as "did something fail to load?".
- m9 Timestamps are ISO strings ("2026-08-08T20:21:05Z") on History, Activity, Verification and Inspector while headlines use "Aug 8, 20:21 UTC". Pick the human one.
- m10 Book: "Bad debt on the book — $239.60 … across 1 account." Which account? It is the one thing on the page I wanted to click and could not.
- m11 Activity: "a engine-scoped" (grammar, in the refusal text); "action(s)", "row(s)", "record(s)", "note(s)" across Inspector/History/Verification.

---------------------------------------------------------------------------------------------------

## 3. The honest states — do I understand what happened, whose fault, what next, and does it look like zero?

| State | What happened? | My fault? | What next? | Looks like zero/nothing? | Verdict |
|---|---|---|---|---|---|
| historyDegraded | No — "observatory_points … Task B2, migration 00016" | Clearly not | Nothing offered; "the Book" is not a link | No (good) — but the page is a void | MAJOR (M17) |
| activityRefused | Vaguely; the error is developer text, printed twice | "bad_request" says yes; I only clicked "Load more" | Two buttons, one of which the text tells me not to use | No (good) — but my loaded rows vanished | MAJOR (M18) |
| activityExhausted | Yes | No | No "clear filter"; selected chip not visible | Zero here really is zero — fine | MAJOR-lite (M19) |
| verificationFailed | Yes — best of the five | No | Nothing; the three rows are not shown | No | MAJOR (M15) |
| verificationUnavailable | Yes, after the "503 … (http://localhost:8080/v1/evidence)" | No | "did not say when to retry" and no retry | No — but it shows batch 18,251 while saying no batch is assumed | MAJOR (M16) |
| No API at all (served site) | "The request produced no HTTP response: Failed to fetch." | No | Only Activity has "retry" | No — but "not computed" ×10 misnames it | MAJOR (M30) |

Common thread: none of them pretends to be zero — that is genuinely good and rare. All of them speak to the person who runs the server, not the person reading the page, and four of six give me nothing to do.

---------------------------------------------------------------------------------------------------

## 4. What is missing that I expected, and where

- Book: the full position table (all 1,412), sortable by debt / room, with the near-cap 27 in full.
- Book and Activity: sizes in dollars and a way to take the liquidatable set away (copy / download / the API call that produced this table).
- Activity: an address box. Inspector: activity amounts in tokens and dollars.
- Inspector: the boundary sentence ("Liquidatable if weETH falls below $3,818.57") in the header, not under the table; what liquidation would cost me (the bonus/penalty); history in days.
- History: a range control; a "this is the latest hour, N minutes ago" statement; a visible cue that points are clickable.
- Verification: which rows, chosen how, checked how often, next check when, and how I can repeat it; a plain statement of how old the last check is relative to the data on screen.
- API: a real host; a first example that returns the liquidatable Cash accounts; a word about rate limits in numbers ("rate-limited per client" — how much?).
- Everywhere: a one-line glossary for batch, engine, room, borrow cap, refusal; a retry on every failure; who runs this site, above the fold.

---------------------------------------------------------------------------------------------------

## 5. What is good (why I would come back)

- The Overview hero sentence and the Book/Inspector/Scenarios headlines: one red number, one plain sentence, freshness beside it. The 5-second posture test passes on all four.
- Inspector's "Within $190.50 of its borrow cap. Not liquidatable yet." and the weETH boundary price — the best answer to "am I safe?" I have seen on a risk page.
- Every hop the risk lead makes lands where the link said it would (row -> Inspector, Stress -> one-address Scenarios, stress line -> that scenario, mover -> Inspector).
- Numbers inside the Book reconcile: $6,840 + $109.45 = the $6,949 bar; the bars sum to $27.8M and 1,406 accounts; $282K + $115K + $432K = the $830K tile; 14 + 13 + 73 + 18 = 118 on Scenarios.
- No failure state ever shows a 0 or an empty chart where it means "unknown". Verification's dek volunteers the limit of its own proof. That candour is why I trust the intent even where I cannot yet trust the numbers.
- Overview's "Try 0x91a4…8260 — liquidatable now" gives a first-timer a real address to click. Both themes hold up equally.

---------------------------------------------------------------------------------------------------

## 6. Five-second verdict per page (cold visitor)

- Overview: "A live liquidation monitor for ether.fi's card. $6,840 at risk. Wait — 70,000 or 1,412? And why 'Reconnecting'?"
- Book: "Posture at a glance, clear. Half the chart card is blank. Where is the rest of the table?"
- Inspector: "This address is $190 from trouble, not there yet. Clear." (then an unexplained amber "1 of 3 rows failed")
- Scenarios: "ETH −30% makes $1.2M liquidatable. Clear. Do I have to press Run? What are 4.76% and 941?"
- History: "Same $27.8M as the Book, and a flat line. What changed?"
- Activity: "50 rows loaded… of what? These amounts are not numbers I can read."
- Verification: "Something passed 87/87. It was in July. It does not cover what I am looking at. I do not know what a weld is."
- API: "17 endpoints, no key — at localhost."
