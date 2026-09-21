# Gate clarity ruling — Plan 4 (UI convergence), the four secondary pages

Consult: solvent-clarity, 2026-09-20. Advisory only; no repo file was edited. Scope: the WORDS of the
VerdictHeader (kicker, headline = emphasis + rest, dek), History's holes and chart finding, Activity's live
strip / section title / notices, Verification's headline-vs-chip vocabulary, the API header. Form (tone colour,
type, chip layout, mono) is solvent-design's; where a ruling touches tone it is flagged **[design]** and deferred.

Sources read: `web/lib/observatory-series.ts` (`observatoryTakeaway`, `gridReadingLine`), `web/lib/history-view.ts`,
`web/lib/activity-view.ts`, `web/lib/feed-view.ts` (`feedTakeaway`), `web/lib/feed-data.ts`
(`SINCE_BLOCK_IMPOSSIBILITY`), `web/app/feed/FeedLiveStrip.tsx`, `web/app/feed/ActivityControls.tsx`,
`web/lib/verification-view.ts`, `web/lib/evidence.ts` (`proofTakeaway`, `proofPin`), `web/lib/api-view.ts`,
`web/lib/human-usd.ts`, `web/lib/prose.ts`, `web/lib/book-headline.ts` (the reference grammar), the demo
fixtures (`tests/fixtures/demo/events-demo-feed-page-1.json`, `tests/fixtures/evidence-manifest.json`) and the
gate5 captures (history / activity / verification / api / book, dark, fold + full).

## Verdict

R2 as first written cannot stand, and G3's revision is right: the four sentences are true but they are written
to the wire, not to the reader. Each one is a status line (semicolons, middots, ISO instants, `(s)` plurals,
unformatted money, capitals for state words) promoted to an H1. The facts are all keepable. What changes is
altitude: the headline carries ONE finding (emphasis) and its scope (rest); the dek carries the second fact,
which on three of the four pages is the honesty caveat restated as a fact instead of as a slogan; the slogans
go to the drawer, where R3 already put their long forms. Nothing honest is deleted.

## Shared rules (apply to all four pages)

| # | Rule |
|---|---|
| S1 | **Grammar = the Book's.** `humanUsd` for money in headline/dek/finding; `groupInt` for every count; real plurals through one `plural(n, noun)` helper (the Book's `plural` in `book-headline.ts` — lift it to `prose.ts`, do not write a second one); sentence case; no `(s)`, no middot-joined clauses, no semicolon-joined second finding, no capitalised state words (ACCEPTED, REJECTED, NO SERVABLE BATCH) inside a sentence. State words in capitals stay where they are labels: card status pills. |
| S2 | **Emphasis = the finding's core, 8 words or fewer, ends with the comma. Rest = scope and as-of, ends the sentence.** A refusal / loading / failure arm is emphasis only, rest `""`, dashed tone — the existing `refused(...)` shape. Follow `LabHeadline`'s convention (no leading space in `rest`). |
| S3 | **Instants in prose are humanised; instants in chips, tile subs, table cells and the drawer stay the wire's ISO string, verbatim.** New pure helper `humanUtc(iso)` (in `prose.ts` or `format.ts`): `2026-08-08T20:00:00Z` → `Aug 8, 20:00 UTC`. Built from the ISO string's own UTC fields: never `toLocaleString`, never the browser zone, never the browser clock. Seconds are dropped. The year prints (`Aug 8 2025, 20:00 UTC`) exactly when it differs from the year of the same envelope's `served_at` (the series and the events envelopes both carry one); with no `served_at` at hand, the year always prints. An unparseable string prints verbatim — never a repaired or invented time. |
| S4 | **One source still holds.** Each takeaway function keeps owning its sentence; it returns parts instead of one string: `{ emphasis, rest }` (History also `holes`). R2's equals-law is then pinned on the parts. No component composes a sentence. |
| S5 | **Deks are facts.** A dek is the second-most-important computed fact, 3 short sentences at most, each conditional on its own data. The doctrine slogans leave the dek; each already has its long form in the drawer (`HISTORY_INTRO`, `ACTIVITY_INTRO`, `VERIFICATION_SPLIT`, `API_INTRO`). |
| S6 | **Jargon budget.** Above the fold each page gets one term of art, glossed on first use. Ruled: History "absent / withheld" (the chip's pair, glossed in the dek); Activity "block time"; Verification "pinned reconcile run"; API none. Everything else is reader-model words; the wire term rides in parentheses, a chip, a title attribute or the drawer. Retired from the primary register: bucket, wire row, custodied, cursor, posture, watermark vector, pin (as a bare noun), gated, since_block, DESC, tiebreak, P4, outbox. |
| S7 | **Laws checked against every ruled sentence:** a refused / withheld / absent thing is named as such, never as 0 or "none"; no Cash figure and legacy figure share a number (Activity's per-engine counts are a split of a row count, and no amount is ever added); nothing on these four pages is a projection, so no projection label is owed; Activity never claims beyond "loaded"; every humanised value has its exact wire value one glance away (named per page below). |

---

## 1. History `/observatory`

Page question: "How much does this engine owe, and how has that moved?" First-paint answer today: present but
buried in a three-line all-green status string.

| Element | Today | Ruled words (demo: legacy view) | Pattern for all arms |
|---|---|---|---|
| Kicker | `History · Aave v3 market (legacy)` | keep | keep |
| Headline — emphasis | the whole sentence: "Debt $1900000 across 8552 account(s) as of bucket 2026-08-08T20:00:00Z; 2 of the 168 bucket(s) in this window have no complete batch, 1 bucket(s) withheld." | **"$1.9M of legacy Aave v3 debt is outstanding,"** | `{humanUsd(newest.debt_usd)} of {debtOf(engine)} is outstanding,` where `debtOf` = "Cash debt" / "legacy Aave v3 debt" (Cash view: "$27.8M of Cash debt is outstanding,"). Mirrors the Book's "$6,840 of Cash debt is liquidatable right now," and its tile "Debt outstanding". |
| Headline — rest | — | **"across 8,552 accounts in the hour starting Aug 8, 20:00 UTC."** | `across {plural(accounts, "account")} in the hour starting {humanUtc(newest.bucket_start)}.` "In the hour starting", not "as of": the figure comes from the newest complete batch inside that hour, so the hour is the honest claim (clock discipline). Accounts null: `in the hour starting {t}; the account count was not stated.` |
| As-of placement | in the sentence, ISO | **headline rest, humanised** | For History the instant IS the scope (which hour's level), so it stays in the headline. Exact value: the four tile subs already print `bucket 2026-08-08T20:00:00Z` verbatim, and the Range / Served chips stay ISO. No chip is added. |
| Arm: newest hour withheld | "Newest bucket {iso} withheld ({code}) — no numbers served for it; …" | — | emphasis `The latest hour's figures were withheld,` rest `so no current debt figure is shown ({humanUtc}).` Dashed tone. Dek sentence 1 = the cause: `The engine's whole book was refused in that hour ({plainCause(code)} · {CODE}).` then the holes sentence. An older figure never stands in (existing law, keep). |
| Arm: newest captured, debt null | "Debt — across …" | — | emphasis `The latest hour states no debt figure,` rest `in the hour starting {t}. Not stated is not zero.` Dashed tone. |
| Arm: no wire-backed hour in the window | "No bucket in this window is backed by a wire row." | — | emphasis `No hour in this window was recorded.` rest `""`. Dek: `No complete batch ran for {named(engine)} in this range, so there is nothing to chart. That is a missing record, not a zero.` |
| Arm: more hole than record (`captured * 2 <= total`) | — | — | Promote the holes from dek to headline: rest becomes `across {accounts} in the hour starting {t} — but only {captured} of the {total} {unit}s in this window were recorded.` **[design]** tone warn. Below that threshold the holes live in the dek (row "Holes"). |
| Arm: loading | "Loading the history of the Aave v3 market (legacy)…" + the slogan dek | keep emphasis | dek → `The hourly record of this engine's debt, collateral, accounts and liquidatable positions.` (says what will be here) |
| Arm: degraded (no rollup) | "The durable rollup for {engine} is unavailable." | — | emphasis `No hourly history exists for {named(engine)} on this deployment yet.` dek `{sentence(message)} That is a fact about this deployment, not an empty history; live figures are on the Book.` `HISTORY_DEGRADED_NOTE` stays in the drawer verbatim. |
| Arm: fetch error / unreadable scale | "The history of {engine} could not be fetched." / "…cannot be read." | keep both | keep; their deks already explain the state in reader words. |
| **Holes (item 3)** | second half of the headline, plus the Buckets chip | **Dek: "165 of the 168 hours in this window were recorded. 2 are absent — no complete batch ran — and 1 was withheld; each is a gap on the chart, never a zero."** | **Ruling: the dek — not the headline, not the chip alone.** Precedent is the Book, whose "6 positions could not be computed … counted, not hidden" lives in the dek. The chip alone fails the 10-second reader (chips are scanned, not read, and "absent" is unglossed there); the headline is the wrong altitude unless the record is mostly hole (arm above). Three carriers, so a missing hour cannot vanish: the dek sentence (always, first paint), the Buckets chip (warn tone, keep), the chart marks + key (keep). Pattern: `{captured} of the {total} {unit}s in this window were recorded.` then `{a} {is/are} absent — no complete batch ran —` + ` and ` + `{w} {was/were} withheld` + `; {each is / it is} a gap on the chart, never a zero.` Either clause drops when its count is 0. No holes: `All {total} {unit}s in this window were recorded.` `unit` = "hour" at the native stride, "sampled hour" when `step_seconds` is applied (add `(every {n}th hour)` once). This keeps the slogan's law ("never a zero") inside a fact, exactly as the Book keeps "counted, not hidden". |
| Dek (item 2) | "One engine per view; a missing hour is a hole, never a zero." | the holes sentence above | **Replace.** "One engine per view" is already said by the kicker, the Engine chip and the engine switch; "never a zero" survives inside the holes sentence; the full slogan is `HISTORY_INTRO`'s second sentence in the drawer. |
| **Chart finding (item 4)** | "between captured buckets 2026-08-01T21:00:00Z and 2026-08-08T20:00:00Z: debt $1911400 → $1900000, accounts 8643 → 8552, liquidatable 45 → 46." | **"Between the first and last recorded hours (Aug 1, 21:00 → Aug 8, 20:00 UTC), debt fell $11K to $1.9M, accounts fell 91 to 8,552, and liquidatable positions rose 1 to 46."** | `Between the first and last recorded hours ({humanUtc(first)} → {humanUtc(last)}), debt {verb} {humanUsd(abs delta)} to {humanUsd(last)}, accounts {verb} {groupInt(abs delta)} to {groupInt(last)}, and liquidatable positions {verb} {n} to {n}.` verb = rose / fell; exact equality → `debt unchanged at $1.9M`. A metric null at either end → `accounts not stated at one end, so no change is given`. **Why a delta and not "A → B":** `humanUsd` truncates $1,911,400 and $1,900,000 to the same "$1.9M"; a humanised arrow pair would read "$1.9M → $1.9M" and say nothing. The delta is one guarded bigint subtraction of two values of ONE engine at ONE `usd_decimals` — no cross-engine figure, no percentage (the module's "never a recomputed percentage" law holds). "First and last recorded" keeps the old sentence's honesty: it reads only captured hours. Arms: one recorded hour → `Only one hour in this window was recorded ({humanUtc}), so there is no movement to state.` None → `No hour in this window was recorded, so there is no movement to read.` Exact values: the chart's two end labels (T2-1 below) and any hour's record on click. |

Tier 2 (History, copy only, sequence at the integrator's choice):
- T2-1 The chart end labels and the bucket record print `$1900000`; group them (`$1,900,000`; `groupDecimalString` exists). They are the exact layer the finding now leans on.
- T2-2 Stride chip: value `hourly` (or `every {n}th hour`); today's clause "every captured bucket served verbatim" is method — move it to the chip's `title`; the drawer already has it.
- T2-3 Buckets chip: label `Hours`; value `165 recorded · 1 withheld · 2 absent`. Keep "absent" and "withheld": the dek glosses exactly those two words.
- T2-4 Tile subs: `bucket {iso}` → `hour of {iso}` (the ISO stays verbatim).

---

## 2. Activity `/feed`

Page question: "What has happened on chain lately, and was any of it a liquidation?"

| Element | Today | Ruled words (demo) | Pattern for all arms |
|---|---|---|---|
| Kicker | `Activity · cross-engine` | `Activity · all engines` (T2) | `Activity · {engineName}` when scoped — keep |
| Headline — emphasis | the whole sentence: "50 chain action(s) loaded, 3 liquidation(s) · newest custodied 2026-08-08T20:21:05Z · more exist behind the cursor." | **"3 liquidations among the 50 chain actions loaded,"** | `{plural(l, "liquidation")} among the {plural(n, "chain action")} loaded,`. `l == 0` and the type filter admits liquidations: `No liquidation among the {n} chain actions loaded,` (a true zero over loaded rows, scoped by "loaded" — lawful). Type filter excludes liquidations: `{n} chain actions loaded,` and the rest opens `filtered to {joinAnd(types)};`. Ledger view: `{plural(n, "liquidation")} loaded,`. `n == 1`: `1 chain action loaded,` rest `a {type}, at {t}; …`. "loaded" never leaves the emphasis. |
| Headline — rest | — | **"the newest at Aug 8, 20:21 UTC; more exist beyond these."** | cross-engine, timed: `the newest at {humanUtc(newestTimed.block_time)}` · engine-scoped: `the newest at block {formatBlock(n)}` · no timed row: `none has a block time yet, so no newest is claimed` · ordering violated: `no newest is claimed: the service broke its own ordering (see the alert below)`. Then `; more exist beyond these.` when `hasMore`, else `; that is every action matching this filter.` "Cursor" and "custodied" leave the headline. |
| As-of placement | in the sentence, ISO | **headline rest, humanised, plus a new chip `Newest 2026-08-08T20:21:05Z`** (engine-scoped: `Newest block 155,318,218`) | The page has no chip for it, and "how fresh is this list" is part of the finding's scope. The chip is the exact layer (the first table row also prints it verbatim). Omit the chip in the arms that claim no newest. |
| Arm: loading (no rows, cursor open) | **Defect:** the H1 prints "0 chain actions loaded in this window — the list below states the reason." The page's own law is "nothing loaded is a dash, never a zero"; the tiles obey it, the H1 does not. | — | emphasis `Loading recorded chain actions…` rest `""`, dashed tone. Dek `Borrows, repays, supplies, withdrawals and liquidations, as recorded from the chain.` |
| Arm: exhausted (no rows, no cursor) | the same "0 chain actions loaded…" string | — | emphasis `No recorded chain action matches this filter.` dek `That is the service's real answer for this filter, not a loading state.` (The zero here is true, and the old law already says so.) |
| Arm: page refused | "Page refused · bad_request: {message}" | — | no rows yet: emphasis `The service refused this page.` · rows already loaded: emphasis `The next page was refused,` rest `after {plural(n, "chain action")} loaded.` Dek `{sentence(message)} ({code}). Restart the list below.` |
| Arm: fetch failed | "Page fetch failed: {error}" | — | `Recorded chain actions could not be fetched.` / `The next page could not be fetched,` + `after {n} chain actions loaded.` Dek `{sentence(error)}` |
| Dek (item 2) | "The live strip and the paged record never blend." | **"1 of them records bad debt being realised (deficit_created). 21 are on Cash and 29 on the legacy Aave v3 market. 2 have no block time yet and are listed last, by block number."** | **Replace** — the slogan is `ACTIVITY_INTRO`'s last sentence in the drawer. Conditional sentences, in this order: (a) `{d} of them record(s) bad debt being realised (deficit_created).` when `d > 0` — the other crit-tagged type and the second thing a risk reader needs; (b) cross-engine only: `{c} are on Cash and {g} on the legacy Aave v3 market.` — a split of a row count, no amount summed; (c) when a tail is loaded: `{u} {has/have} no block time yet and {is/are} listed last, by block number.` Nothing applies: `Listed newest first, by {block time / block number on {engine}'s chain}.` |
| Amount column caption (new, point of need) | unit tags per row only | column header **`Amount · engine units, not USD`** | The reader WILL read `252733333` as dollars. The caveat belongs on the column, not in the dek or the drawer. The long form stays in `ACTIVITY_METHOD`. |
| **Live strip — label** | `live posture` | **`Live stream`** | "posture" retired from the primary register |
| Live strip — state, no batch (demo) | "● RECONNECTING no batch delivered on this connection, and nothing is pretended" | **"Reconnecting — no batch has arrived on this connection yet, so nothing live is shown."** | chip words keep the appbar's (streaming / awaiting base / connecting / reconnecting / closed) |
| Live strip — batch arm | "batch #18251 · 1412 positions · 6 refused · SUPERSEDED (still served) · from an earlier connection · debt_manager @155,323,444" | "Batch 18,251 · 1,412 positions, 6 not computed · superseded, still served · received on an earlier connection · Cash at block 155,323,444 · legacy Aave v3 at block 25,714,690" | `groupInt` when the count passes the guard, `unreadable` otherwise (keep); "refused" → "not computed" (the Book's tile word); engine ids → `engineName`; no `#`. |
| Live strip — unavailable arm | "no servable batch · held data {n}s stale · last good batch #{id}" | — | `No batch can be served right now · the data held is {n}s old · last good batch {groupInt(id)}` |
| Live strip — degraded arm | "withheld: debt_manager (CODE)" | — | `Withheld now: {engineName} ({plainCause(code)} · {CODE})` |
| Live strip — law line | "current connection only. Live posture is never history; the durable feed below is custodied chain fact, and posture replay arrives with P4's outbox." | **"This browser connection only — not a record. The list below is the record."** | **Drawer** (append to `doctrine`): "The live strip shows the stream's state on this connection only. Past stream states are not stored, so they cannot be replayed here; the recorded list is chain fact held by Solvent." "P4's outbox" is deleted from every public string; it may stay in code comments. |
| **Section title** | "History: recorded chain actions" | **"Recorded chain actions"** + qualifier "newest first, by block time · loads 50 at a time" | "History" is another page's nav label; a section that borrows it breaks information scent. The qualifier is mode-honest: `by block time` / `by block number on {engine}'s chain`; the page size from the envelope's `limit`. |
| **Notice: since-block** | "since_block · since_block needs exactly one engine: block heights are incomparable across chains, so a cross-engine height bound means nothing. This is a property of chains, not an error." | **"Since block: choose one engine to filter by block number. Cash and the legacy market run on different chains, so one block number cannot bound both."** | This is a disabled control's empty state: it must say what would be here and how to get it — it now does. "A property of chains, not an error" → drawer. Dropped-bound notice: `The since-block filter ({groupInt(n)}) was removed: a block number only means something on one chain` + `, and {engineName} is on a different one.` / `, and no single engine is selected.` Bad draft: keep ("… is not a block number, so nothing was requested"). `SINCE_BLOCK_IMPOSSIBILITY` may stay as the thrown error's text. |
| **Notice: order** | "ordered by custodied header time (block_time DESC) with a deterministic chain-aware tiebreak. Block heights are never compared across chains, and rows without header time follow in the disclosed untimed tail." | cross-engine with a tail loaded: **"Rows with no block time yet come last, listed by block number; that tail is not in time order."** No tail loaded: no notice (the section qualifier already says "newest first, by block time"). | **Drawer** gets `ORDER_CROSS` verbatim (tiebreak, never-compared-across-chains) beside `ACTIVITY_TAIL_NOTE`, which already says most of it. Engine-scoped: qualifier only; `orderScoped` verbatim to the drawer. The drift alert (`ACTIVITY_DRIFT`) stays in the primary register — it is a hazard, not doctrine; reword only its lead: "Ordering fault · the service sent a timed row inside the untimed tail…". |

Tier 2 (Activity): the two tiles repeat the headline's two numbers (the same disease as G7) — at least make
`Liquidations` sub "among loaded rows" instead of the mode word; chip `Order cross-engine` duplicates `Scope` —
value `by block time` / `by block number`; chip `Rows` → `Loaded`. `Filter echo` stays as the wire's verbatim register.

**[design]** A count of liquidations in green "ok" tone reads as a health verdict while the table tags the same
rows crit. The words are a fact, not a verdict — the tone is solvent-design's call.

---

## 3. Verification `/proof`

Page question: "Were these numbers checked against the chain — and does that cover what I am looking at now?"

| Element | Today | Ruled words (demo) | Pattern for all arms |
|---|---|---|---|
| Kicker | `Verification · this deployment` | keep | keep |
| Headline — emphasis | the whole sentence: "receipt ACCEPTED at pin 5f0b3e2a; serving batch #1 under its watermark vector." (lowercase first word; two subjects in one line) | **"All 87 checked rows matched the chain exactly,"** | accepted: `All {groupInt(gated_rows)} checked rows matched the chain exactly,` — the receipt's own tally, already on the wire. |
| Headline — rest | — | **"in this deployment's pinned reconcile run."** | accepted + serving: as ruled. accepted + no batch: `in the pinned reconcile run — but no batch can be served right now.` **[design]** warn (today's tone rule keeps). |
| Arm: receipt rejected, drift | "RECEIPT REJECTED — the proof badge is refused; …" | — | emphasis `The last reconcile run did not match the chain exactly,` rest `{exact} of {rows} checked rows matched; {plural(drift, "row")} drifted.` Weld short with zero drift: rest `{engineName(weld.engine)} matched {x} of {y} compared rows.` Dek s1: `No exactness is claimed for this deployment until a run passes.` |
| Arm: rejected by contradiction | the long CONTRADICTION detail | — | emphasis `The proof cannot be accepted:` rest `the manifest contradicts its own receipt.` Dek = `status.detail` verbatim (publishability-checked). |
| Arm: no committed receipt | "NO COMMITTED RECEIPT — nothing is proven; …" | — | emphasis `Nothing is proven for this deployment:` rest `no reconcile receipt is committed.` Dek s1 `{sentence(pub(reason))}`. (An absence named as an absence — lawful.) |
| Arm: loading | "Loading the evidence manifest…" | — | `Loading this deployment's verification record…` Dek `The result of its last check against the chain, and the identity of the batch it is serving.` |
| Arm: manifest error | "Evidence unavailable: {message}" | — | emphasis `The verification record could not be fetched.` Dek `{sentence(message)} {retry} Nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.` (keep `NO_SUBSTITUTE`) |
| Dek (item 2) | "Two subjects, never one: the pinned proof and the live batch." | **"That run is a fixed, reproducible check, finished Jul 29, 02:14 UTC; its result covers that run and nothing else. Batch 18,251, served now, is live data that was not re-checked and does not inherit it."** | **Replace** — this IS "two subjects, never one", said as two facts a non-expert can act on. s1: `That run is a fixed, reproducible check, finished {humanUtc(finished_at)}; its result covers that run and nothing else.` s2 serving: `Batch {groupInt(batch_id)}, served now, is live data that was not re-checked and does not inherit it.` s2 no batch: `{sentence(pub(reason))} The proof still stands for its own run; it says nothing about live data.` `VERIFICATION_SPLIT` stays in the drawer verbatim. |
| **"pin" (item 6)** | headline + chip `Pinned batch · pin 5f0b3e2a` | the headline says "pinned reconcile run" (the page's one term of art, glossed by the dek's first clause); **the hash lives in the chip only** | Chip relabel: **`Proof pin 5f0b3e2a`**. Today's label "Pinned batch" is wrong on its face — the pin is the receipt's comparison sha, not a batch — and it sits beside "Live batch", inviting exactly the two-subjects confusion the page exists to prevent. The title attribute keeps the full sha + the `finished_at` ISO (the exact layer for the dek's humanised time). |
| **"watermark vector"** | headline | **out of headline and dek; card + drawer only** | The reader-model fact is "live, not re-checked". The Live subject card keeps `SERVING · WATERMARKED`; give its takeaway one gloss: `serving batch {n} · stamped with the chain blocks it was read at; operational, never the proof`. `LIVE_CAPTION` / `LIVE_NOTE` keep the term verbatim in the drawer. |
| **"batch #1"** | headline + chip | dek + chip `Live batch 18,251` | No `#`; `groupInt`; the same word the Book's chip uses ("Batch 18,251"). The demo still prints 1 until G5 welds the evidence fixture to the demo batch — the ruled dek makes that mismatch louder, so G5 should land in the same round. |
| "gated rows" | tiles, receipt line, card | the headline says "checked rows" | Reader word above the fold; "gated" stays on the card and in the drawer. T2: Verify tile sub `gated (must-match) rows exact · drift 0` so the two words are visibly the same 87. Never "all rows": 21 advisory rows exist and are not in the tally. |

Tier 2 (Verification): chip `Key` → `Batch key`; the full-width "Reconcile receipt: 87 gated rows exact, 0 drift"
line now repeats the headline, the Verify tile and the card's first rows — in the accepted arm it can drop to
the card; in the drift / failed / none arms it stays (it names the fault).

---

## 4. API `/developers`

Page question: "What can I call, and what comes back?"

| Element | Today | Ruled words | Pattern |
|---|---|---|---|
| Kicker | `API · Solvent Risk API v1.8.0` ("API" twice) | `API · contract v1.8.0` (T2) | `API · contract v{version}` |
| Headline — emphasis | the whole sentence: "17 read-only operations, every money value a decimal string." | **"17 read-only endpoints,"** | `{OPERATIONS.length} read-only endpoints,` — "endpoints" is the reader's word and the word Verification's Serve step already uses for the same 17; "operations" is OpenAPI's. One word product-wide: the tile and chip labels follow (`Endpoints`). |
| Headline — rest | — | **"every money value an exact decimal string."** | static; one arm (a build with no contract is a build failure, as the code already notes) |
| Dek (item 2) | "If a handler disagrees with this page, that is a failure, not documentation lag." | **"No key or sign-in. Every sample below is the contract's own example (api/openapi.yaml, v1.8.0), and a test fails the build if this page and the contract disagree."** | **Replace with the same law as a fact** — "a test fails the build" is what makes the slogan true, and it tells a developer why to trust the samples. Pattern: `No key or sign-in. Every sample below is the contract's own example ({sourcePath}, v{version}), and a test fails the build if this page and the contract disagree.` "No key or sign-in" is carried from the adjudicated `API_INTRO` ("no auth"); `api/openapi.yaml` defines no security scheme, which licenses it — if the integrator wants it computed rather than carried, that is a B item. The original slogan stays in the drawer inside `API_INTRO`. |
| As-of | none needed | — | static content; the version is the as-of and rides the kicker and the chip |

---

## A / B / C split

**A — copy and order only (no new data):** every headline, rest and dek above; `humanUtc`; `plural` lifted to
`prose.ts`; History's holes to the dek and the promotion arm; the chart finding (one same-engine, same-scale
bigint subtraction of served values); Activity's loading-arm fix, the `Newest` chip, the section title +
qualifier, both notices, the live strip's words, the Amount column caption, the drawer additions;
Verification's chip relabel `Proof pin`; API's "endpoints". All Tier 2 items are also A.

**B — needs data or fixtures not currently in place:** G5 (the demo evidence fixture welded to batch 18,251) —
should ship with Verification's new dek; `security: none` extracted into `CONTRACT_META` if "No key or sign-in"
must be computed; `served_at` threaded into `ActivityEnvelope` for `humanUtc`'s year rule (it is on the wire,
not yet on the view's input).

**C — named proposals, not ruled:** C1 History's ChartCard title "How the book moved" is a topic; let the
finding's lead clause be the title ("Debt fell $11K over the window") and the rest the caption. C2 Activity's
tail note placed as a group divider directly above the first untimed row (point of need) rather than above the
table. C3 Activity amounts in reader units (carried M12) — until then the column caption is the mitigation.

## Migration note for pins

Every ruled string replaces a pinned one. Pins to re-point: `observatory-series.spec` (takeaway, grid reading
line), `history.spec` (H1, finding, dek), the `feed-view` / `activity` specs (takeaway, dek, list title, order
note, since-block notice, live strip law line), the `evidence` / `verification` specs (takeaway, dek, the
`Pinned batch` chip), the `api` specs (headline, dek), plus `shell.spec`'s h1 regexes and the state-matrix ids
noted in progress.md. The equals-law survives as: H1 text === `emphasis + " " + rest` from the one takeaway
function.
