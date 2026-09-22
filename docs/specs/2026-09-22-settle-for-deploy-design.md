# Settle for deploy — what an evaluator sees in three minutes (design)

- **Date:** 2026-09-22 · **Owner direction:** "the goal is the resume piece. keep moving toward that. use your
  judgement" (2026-09-21 15:01 USMST); "let's take care of A i guess if it is a quick win, then we can start on B"
  (2026-09-22 12:17). "just do a local build for now, i will deploy when everything looks settled."
- **Path:** architectural (touches five pages, the kit, the demo dataset and the repo's front door); every item is
  wording or presentation over data the pages already have — no backend, contract or calculation change.
- **Evidence base:** a read-only understand workflow (seven readers, each adversarially verified by an independent
  skeptic) — `.superpowers/sdd/2026-09-22-settle-for-deploy/understand.json` and `understand-verdicts.md`. Every public sentence
  below was checked against code, contract or Go source; the skeptics' corrections are folded in.

## 1. Problem

Four UI plans closed with the product honest and tested, but the first three minutes still lose an evaluator: the repo's
README is 21 lines and says "(coming) … web"; the Overview's H1 claims "70,000 people borrow" above a strip reading
"Accounts 1,412" (the 70,000 is an external count of active cards, not borrowers, and no source is in the system); the
Book never states the 49 liquidatable positions History prints (2 material + 47 below the line); the Book's dek says 47
positions "total $109.45 — below the $100 line" (the line is per position); the Book shows 6 of 27 near-cap accounts with
no way to the rest; Verification lists two "welds" (29 + 14) under an 87-row receipt although the welds are not a subset
of the 87 (10 of the 14 legacy rows are advisory); Scenarios says "showing 20 of 118 accounts moved" beside a tile
"Accounts moved 941" (two different wire populations under one verb); Activity prints Cash amounts as raw 9-digit
integers although the scale is served on `/v1/book`; builders' vocabulary ("gated", "weld · debt_manager", "Filter echo
… since_block", `collateral_enabled`) sits in pinned first viewports; the API page prints the contract's `**` and
backtick markers raw; a disabled button looks live.

## 2. Scope — in (Plan 5)

Grouped by the file area that owns it (the plan's parallel split).

### A · README (the repo's front door)
Rewrite the root `README.md` from verified facts only: the thesis (the project's own words, docs/specs
2026-07-20 §1–3); an honest status line ("built; CI green on ci.yml; pixel pins are a local gate; not yet publicly
deployed"); the real pipeline (indexer → Postgres → riskd → api → `@solvent/client` → web; the two engines with chain
IDs; alerts named as planned); what is proven — **only components with a recorded Codex approval** (D-006 clause 5; the
task produces a claim → approval-record table in its report and drops any claim without one); the committed reconcile
receipt's OWN figures (the artifact's gated / exact / drift totals, never the contract example's 87); an exact local-run
block that works on a fresh clone (the RPC env names to fill, the order: migrate before riskd/api); no hardcoded test
counts (or stamped with the commit); README screenshots produced by `web/scripts/screenshot-pages.mjs` into
`docs/readme/` (unmasked), captioned literally: demo dataset, stream not connected. `web/README.md`'s Vercel section is
reconciled with "deploy target not yet decided" rather than asserting a host.

### B · Book and Overview
1. **Hero (a ruling that reverses owner-approved copy):** `HERO_H1_LEAD` = "People borrow against crypto to spend on a
   Visa card."; `HERO_H1_TAIL` = " This is how close each account is to liquidation — right now." — no unsourced figure;
   "each account" is the strip's own unit. Stays within the current three-line budget.
2. The Liquidatable tile's sub moves into the lib and, over a WHOLE walk only, states the partition's total:
   "2 accounts · 47 more under $100 · 49 in all" (never while walking / stopped / unreadable). The tile label
   "Liquidatable · material" → "Liquidatable · ≥ $100" (from the lib's material line constant).
3. `belowLineSentence`: "47 more positions are technically liquidatable, each under the $100 line — $109.45 together —
   and not headlined." (+ the singular arm). The Overview prints the same dek.
4. Needs attention: a second fold under the table — "Show 21 more near-cap accounts ($622K)" (hidden count + hidden Σ;
   never "all N", which would claim a total the tile's mid-walk bound refuses); the collapsed table byte-identical to
   today; the dust toggle's label moves into the same lib helper.
5. The legacy fold's summary line states the market's own finding without summing or comparing it with Cash:
   "Legacy · Aave v3 market — 46 of 8,552 computed positions are liquidatable · $1.9M debt · 0 refused" (the denominator
   is computed positions; the clause is omitted when computed is 0).
6. The phrasebook's SWEEP_NEVER words → "never successfully swept" (true of both wire states the code covers; one tile
   line).
7. The demo generator's refused rows carry `total_debt: null`, as the engine serves them (a refusal is the absence of a
   number, `assemble.go`); the Debt cell prints "—". The committed test fixture and the Go DB fixture are untouched.

### C · Verification and API
1. One word for the receipt's rows on public strings: **"checked rows"** (the H1's word) replaces "gated"; the weld rows
   are labelled by engine name ("Cash · accounts compared 29/29 exact", "Aave v3 market (legacy) · accounts compared
   14/14 exact") and followed by one dim row stating the verified server fact: account comparisons include advisory rows
   and are not a breakdown of the checked rows (`cmd/api/p5_evidence.go` builds a weld from the engine's per-account
   rows by verdict, gate ignored). "fingerprint weld" → "feeds registry"; "(s)" plurals → real plurals; the Index and
   Compute sentences drop "Chain heights" / "the wire's own integers".
2. The accepted step sentence: "Every checked row of the pinned run matched the chain exactly; none drifted." ("drift
   named" retired everywhere a count is meant).
3. The Inspector explain drawer's stale "Proof Center" → the page's name (Verification).
4. API: a pure inline renderer in the lib for the contract's two Markdown markers (`**…**`, backticks) → strong / code
   parts; the contract's words (incl. uppercase headings) stay verbatim; unbalanced markers stay literal.

### D · Scenarios and the kit's disabled register
1. The three "moved" populations get distinct words from the contract's own definitions: the movers caption for Cash
   says "the 20 largest of the 118 accounts that become liquidatable (by debt) · the service returns at most 20" (the
   legacy engine's movers are ranked by health-factor drop — its own words); the tile "Accounts moved 941"
   (`lane_changed_rows`) → "Accounts changing lane"; the dek keeps "move to a worse band" for the web's band count.
   The section title, its qualifier ("ranked by the service") and "Most affected accounts →" move into the lib.
2. The assumptions button: "Assumptions · What the model leaves out" (not "Not modelled", which the tiles already use).
3. Kit: `.btn:disabled` / `.btnGhost:disabled` (ink-2 on panel-2, the line border, `cursor: not-allowed`; tokens only;
   contrast reported ≥ 3:1 in both themes); the page-local opacity look in `lab.module.css` retires; the two lab pins
   that assert opacity re-aim to the kit register.

### E · Activity, the Inspector's activity card, History and the Inspector's trust card
1. Activity reads `/v1/book` once for `engines[].value_decimals` as a second scale source beneath the stream's (the
   stream wins when present; the constants are the same engine constants) — Cash rows print "252.733333 · normalized
   debt · USDC" instead of the raw integer; legacy (`aave_scaled`) rows stay raw and tagged (a different unit that needs
   an index the wire does not carry). This reverses the page's "fetches no second endpoint" design note (rewritten).
   Specs route `/v1/book` explicitly wherever the raw state is asserted.
2. Liquidation extracts name the repaid unit: Cash "debt repaid 0.35812 USD" (the demo's figures are sub-dollar — never
   print a figure the fixture does not hold); legacy "2,500 USDC" (the row's symbol) instead of an address prefix.
3. Record-only: "—" in the amount cell, "record-only" in the unit cell (the two surfaces agree); the Inspector's Amount
   head reuses the lib's "Amount · engine units, not USD" and never appends a bare symbol to a normalized figure.
4. Activity's three raw enum words print plain ("collateral enabled", "collateral disabled", "bad debt realised"; the
   wire word in `title`); the chip "Filter echo … since_block — … limit 50" → "Filter applied · any engine · all types ·
   any block · 50 per page" ("any" for a null constraint — the dash means refused elsewhere).
5. The demo Inspector events fixture takes the wire's real shape (the impossible `supply`/`opaque` rows and the Cash
   `collateral_enabled` row become what the deriver emits).
6. History: "Bucket record" → "Hour record"; "watermark block" → "balances as of block N".
7. The Inspector's sweep trust item says its scope: the tally is engine-wide attempted accounts, and the title states
   whether THIS account's collateral is from its last successful sweep (proved by `collateral_sweep_stale` / the served
   stamp — never that collateral was excluded).

## 3. Scope — out (named, with where they go)

- **Plan B (the next plan):** every page's reader classifies its envelope (Codex #1/#5/#8/#9/#10, G4/G5); the kit's
  **pending** headline variant (it reverses a documented doctrine — a run in flight wears the dashed tone — and belongs
  with the state work); the Overview live card's own pending register.
- **Owner's list:** the hosted API and a live link; regenerating the evidence fixture from the committed reconcile
  artifact (a contract-example change: the page would print 30,838, not 87); the demo dataset's realism (sub-dollar Cash
  liquidations, "<$0.01" legacy eligible debt, a sweep stamp of 3 rows on a 1,412-account book, 1,412 vs the live
  ~9,700 census); strict borrower counts (the census includes collateral-only accounts); `roadmap/VISION.md`'s "~70k
  people borrow" line (protected; a proposed Decision); human units for `aave_scaled` rows (needs the event-time index);
  per-engine liquidation sizes on the tile; the drawers' low-tier vocabulary; the product-wide word "engine".

## 4. Laws (unchanged; every item is judged by them)

A refused / withheld / absent / unread value never renders as zero, "No" or absence; a fetch failure is never a refusal;
Cash and the legacy market are never summed, compared in one figure or put on one axis; wire values pass their guards
before arithmetic; copy lives in `web/lib`, components compose nothing; a page claims only what the system backs.

## 5. Gate and QA

Pixel pins move BY RULING on: Overview (hero, dek), Book (tile, dek), Verification (receipt vocabulary, step sentence),
Scenarios (tile label), Activity (scaled Cash rows, record-only, type words, chip), History (record title), Inspector
(trust detail) — each re-baselined after the integrator reads the new capture. Then: the whole suite on a production
build with the styleguide flag; a focused `solvent-user` re-walk of the fixed items; a whole-branch review; a Codex round
(D-006) on the source diff; the close entry in `.superpowers/sdd/progress-ui-overhaul.md`.

## 6. Rulings of record for the owner (reverse approved copy or a documented design note)

1. The hero drops "70,000 people" (unsourced in the system; an external active-cards figure) — "People borrow against
   crypto…"; "each account".
2. Activity fetches `/v1/book` for its scale (reverses the page's one-endpoint note).
3. "checked rows" replaces "gated" on every public Verification string (the drawer keeps the term with its gloss).
4. The demo's refused Cash rows carry no debt, as the engine serves them.
