# Gate round · Phase 1 — report: Page B, Activity (`/feed`)

Status: **DONE_WITH_CONCERNS** — every item landed in one commit; nothing STOPPED. The concerns are (1) six lines in
four e2e specs I do not own still weld the old words and will fail on the shared build until the integrator re-points
them (exact lines and new words below), and (2) four places where I worded what is TRUE instead of the ruled sentence
(reconciliation 6), each named below.

Commit **69e5f53** on `main`, 11 paths, by pathspec, staged by name, `scope_gate.py` OK (11 paths), hooks ran (control-plane
doctor 0 errors), no attribution line, not pushed. Subject verbatim from the brief (no clause dropped).

Gates (all from `web/`, on the final tree): `npx tsc --noEmit` exit 0 · `npx eslint app lib components tests` exit 0 ·
`npm run lint:css` exit 0 · `npx playwright test --project=unit` **987 passed, 0 failed**. My two specs: `activity-view`
14 → **18**, `feed-view` 21 → **24** (+7; nothing deleted). No build, :3111 untouched, no snapshot update, no prettier.
`activity.spec.ts` is re-pointed and extended (15 → 16 tests) but NOT run — it needs the integrator's build.

Files: `web/lib/activity-view.ts`, `web/lib/feed-view.ts`, `web/app/feed/{ActivitySurface,ActivityControls,ActivityTable,ActivityDrawer,FeedLiveStrip}.tsx`,
`web/app/feed/activity.module.css`, `web/tests/unit/{activity-view,feed-view}.spec.ts`, `web/tests/e2e/activity.spec.ts`.
No kit file, fixture, snapshot, doc or integrator file touched or staged.

## Consumers checked before changing `feed-view.ts`

`feedTakeaway` is read only by `lib/activity-view.ts`, my two unit specs and `tests/e2e/activity.spec.ts` — no
consumer outside my files (the Inspector's activity card has its own sentence in `lib/activity-rows.ts`, which imports
only `feedAmount`; `demo-secondary-weld.spec.ts` imports only `feedAmount`). `feedAmount`, `feedTagTone`, `feedRowKey`,
`renderBps`, `liquidationEstablished` and `RAW_UNITS_TAG` are byte-identical. So the signature change is safe:
`feedTakeaway(rows, mode, hasMore, scope?) → { emphasis, rest }` (clarity S4: parts, one owner).

## Every arm's new headline / dek (fixture named)

| Arm (fixture) | Emphasis | Rest | Tone | Dek |
|---|---|---|---|---|
| ok, all engines (`DEMO_FEED_PAGE_1`, served_at 2026-08-08T20:22:50Z) | `3 liquidations among the 50 chain actions loaded,` | `the newest at Aug 8, 20:21 UTC; more exist beyond these.` | neutral | `1 of them records bad debt being realised (deficit_created). 21 are on Cash and 29 on the legacy Aave v3 market. 2 have no block time yet and are listed last, by chain and then block number.` |
| ok, after load more (demo + `FEED_CROSS_PAGE_2`) | `3 liquidations among the 52 chain actions loaded,` | `the newest at Aug 8, 20:21 UTC; that is every action matching this filter.` | neutral | `… 4 have no block time yet and are listed last.` (the stitched tail does not show the service's order, so it is left unsaid — see "checked claim") |
| ok, one engine (`FEED_ENGINE_AAVE_PAGE_1`) | `1 liquidation among the 2 chain actions loaded,` | `the newest at block 25,635,601; that is every action matching this filter.` | neutral | `Listed newest first, by block number on the legacy Aave v3 market's chain.` |
| ok, ledger (the demo's 3 liquidations) | `3 liquidations loaded,` | `the newest at Aug 8, 20:06 UTC; that is every action matching this filter.` | neutral | `2 are on Cash and 1 on the legacy Aave v3 market.` |
| ok, filter excludes liquidations | `2 chain actions loaded,` | `filtered to borrow and repay; the newest at …; more exist beyond these.` | neutral | computed |
| ok, no liquidation, filter admits them | `No liquidation among the 2 chain actions loaded,` | `the newest at …` | neutral | computed |
| ok, one row | `1 chain action loaded,` | `a repay, at Jul 29, 09:57 UTC; more exist beyond this one.` / `…; that is the only action matching this filter.` | neutral | `It is on Cash.` (+ `It records bad debt being realised (deficit_created).`) |
| ok, no row has a block time | as counted | `none has a block time yet, so no newest is claimed; …` | neutral | computed |
| ok, ordering broken (`FEED_CROSS_PAGE_1` + smuggled timed row) | `2 liquidations among the 3 chain actions loaded,` | `no newest is claimed: the service broke its own ordering (see the alert below); that is every action matching this filter.` | neutral | `… 1 has no block time yet.` ("listed last" is NOT claimed) |
| **loading** (no rows, cursor open) | `Loading recorded chain actions…` | `""` | refused (dashed) | `Borrows, repays, supplies, withdrawals and liquidations, as recorded from the chain.` |
| exhausted (`FEED_EMPTY`) | `No recorded chain action matches this filter.` | `""` | neutral | `That is the service's real answer for this filter, not a loading state.` |
| refused, rows loaded (`FEED_ERROR_BAD_CURSOR`) | `The next page was refused, after 50 chain actions loaded.` | `""` | refused | `{the service's own words}. Restart the list below.` |
| refused, nothing loaded | `The service refused this page.` | `""` | refused | same pattern |
| failed, nothing loaded (`FEED_ERROR_RATE_LIMITED`) | `Recorded chain actions could not be fetched.` | `""` | refused | `429 rate_limited: rate limit exceeded (…).` |
| failed, rows loaded | `The next page could not be fetched, after 50 chain actions loaded.` | `""` | refused | `{sentence(error)}` |

## Per item — what changed, and its pin

**The DEFECT — nothing loaded is never zero.** `feedTakeaway([])` no longer returns a count: an open cursor is
`FEED_LOADING` ("Loading recorded chain actions…"), a spent one `FEED_EXHAUSTED`. The loading arm is the dashed tone
with the "what will be here" dek; both tiles are a dash with the load word (the liquidations tile used to print the
mode word). Pins: `feed-view.spec` "nothing loaded is never a count…" (both modes × both cursors: no digit anywhere,
`feedNewest` null); `activity-view.spec` "loading: … NOTHING is counted" (H1 + dek + both tiles match `/\d/` nowhere,
three engines, no `Newest` chip); e2e NEW test "before the first page answers NOTHING is counted" (holds the
`/v1/events` answer, asserts `data-state=loading`, the H1, `data-variant=refused`, the dek, dashed tiles that never
contain "0", then releases and sees the 50 rows).

**Headline, every arm (clarity table + S1/S2/S4; design A3).** `feedTakeaway` returns `{ emphasis, rest }`; grouped
counts and real plurals through one `plural(n, noun)` (`groupInt` + the Book's shape); "loaded" never leaves the
emphasis; "cursor" and "custodied" leave the sentence; the newest claim is one judge, `feedNewest(rows, mode)`
(`time` / `block` / `untimed` / `order-violated` / null), read by BOTH the headline and the `Newest` chip so neither
can state a newest the other withholds. Pins: `feed-view.spec` 8 tests in `describe("feedTakeaway")` (5 re-pointed,
3 new: the type filter + ledger arms, the one-row arm, "no sentence names the wire's internals or a dollar"); the
equals-law in `activity-view.spec` "header: …" (`headline` deep-equals `{ ...feedTakeaway(...), tone, dek }` AND one
literal for the demo arm), e2e cold load (H1 text === `emphasis + " " + rest`, the `<b>` is exactly the emphasis).

**A2 — a record is ink.** ok and exhausted → `tone: "neutral"`; loading / refused / failed unchanged (dashed). Pins:
unit "header: …" (`["neutral","refused"]` are the only tones this page can wear), e2e `data-variant="neutral"` on
cold load and on the empty filter.

**The fact dek (clarity dek row).** `factDek` in `activity-view.ts`; every number is `rows.filter(...).length`
through `groupInt`, each sentence conditional on its own count: (a) `deficit_created` rows, (b) all-engines only: the
engine split — a split of a ROW COUNT, side by side, no amount added, an engine outside the two counted as "an engine
this page does not name", never folded in — (c) the untimed tail. Nothing applies → "Listed newest first, by …".
Pin: unit "the dek counts what is loaded…" recomputes 1 / 21 / 29 / 2 from the fixture and welds the sentence to those
variables, then walks singular/plural, one-engine, foreign-engine, one-row, two-deficit and one-engine-chosen arms,
and asserts no dek matches `/\$|cursor|custod|in total|combined/`.

**`served_at` threaded (clarity B list).** It IS on the wire: `api/openapi.yaml:4233-4235` (`EventsResponse.required`
includes `served_at`, `format: date-time`), so the generated `EventsResponse` type carries it and the demo fixture has
`2026-08-08T20:22:50Z`. `ActivityEnvelope.served_at` is set in `ActivitySurface` from `page.served_at` under the same
`isCurrent()` gate as the filter echo, and handed to `humanUtc` as the reference year. No envelope at hand → no
reference → the year prints. `Date` is never constructed; the browser clock is never read. Pins: unit "header: …"
(`Aug 8, 20:21 UTC` with the envelope, `Aug 8, 2026, 20:21 UTC` without), `feed-view.spec` "cross-engine: …" (absent,
null and other-year references all print the year). Every instant in an expectation goes through
`nb = (t) => t.replaceAll(" ", " ")`.

**The `Newest` chip.** `Newest 2026-08-08T20:21:05Z` — the wire's string verbatim (`toBe(ROWS[0]?.block_time)`);
one engine → `Newest block 155,323,392`; absent when nothing is loaded, when no row has a block time, and when the
ordering is broken. It stays through a refused continuation (the loaded rows still license it). Pins: unit "chips: …",
e2e cold load / since-block / broken ordering.

**B5 — the `Rows` chip is gone** (the tile owns the measure). Chips: Scope · View · Order · Newest · Filter echo. Pin:
unit "chips: …" (`Rows` undefined), e2e `chip("Rows")` count 0; the two e2e `Rows` assertions moved to the tile.

**A5 — the strip is ONE plain line.** All strip copy moved out of the component into `deriveLiveStrip(posture)` in
the lib (components compose nothing): it returns the label, the law, the chip, the arm and the line as runs typed
`text | figure | warn`. CSS: `.live` drops `font-family: var(--mono)` and takes `--type-body`; `.liveLabel` /
`.liveChip` at `--type-small`; `.live b` gains mono at `--type-mono-sm` — figures are the only mono; `.liveLaw` and
its span are deleted. Words (clarity): label `Live stream · this connection only` (clarity's noun, design's form) with
the short law line as its `title`; no batch → `No batch has arrived on this connection yet, so nothing live is shown.`;
batch → `Batch 1 · 4 positions, 2 not computed · Aave v3 market (legacy) at block 25,635,618 · Cash at block 154,796,552`
(no `#`, `groupInt` behind the population guard or the word `unreadable`, "refused" → "not computed", engine ids →
`engineName`, `superseded, still served` in the warn tone and lower case, `received on an earlier connection`);
unavailable → `No batch can be served right now · the data held is 1,205s old · last good batch 18,250`; degraded →
`Withheld now: Cash ({plainCause} · CODE)`. The law's long form is the drawer's new paragraph `ACTIVITY_LIVE_NOTE`.
Test ids unchanged (`activity-live`, `-state`, `-none`, `-batch`, `-unavailable`, `-degraded`). Pins: two unit tests
("the live strip: one plain line…", "the live strip's other arms…"), e2e live-strip test (exact texts, the `<b>` list,
the strip under 56px tall at 1440, prose family === the dek's, figure family !== the prose's).

**No "P4", no "outbox".** `grep -rn "P4\|outbox" web/lib/activity-view.ts web/lib/feed-view.ts web/app/feed/` → 0
hits (comments included). Pin: unit "no public string on this page names the roadmap" sweeps every arm's kicker, H1,
dek, empty words, qualifier, notices, chips, tile subs, all eight doctrine paragraphs and three strip arms; e2e asserts
`main` and the drawer body contain neither.

**A6 — the Amount column aligns.** `amount` renders only `<span data-testid="activity-amount">`; a new
`{ key: "unit", header: "Unit" }` column carries the unchanged `activity-unit` span with its `title`. `.unit` loses
`text-transform`, `letter-spacing` and `margin-left`. `record-only` is `kit.sub` (new `ActivityRow.recordOnly` flag —
the component does not compare strings). The raw integer is verbatim (`expect(raw[0]?.amount).toBe(ROWS[0]?.amount)`).
Column head `Amount · engine units, not USD` (`ACTIVITY_AMOUNT_HEADER`). Pins: unit "rows: amounts follow…", e2e cold
load (the seven `th` texts, `td:nth(4)` is exactly the wire integer and `text-align: right`, no unit inside it, the
unit in `td:nth(5)` with `text-transform: none`), e2e units test (`record-only` has class `/sub/` and not `/addr/`).

**A7 — section title.** `ACTIVITY_LIST_TITLE = "Recorded chain actions"`. Pin: unit asserts the literal and that it
starts with no other page's nav label.

**B4 — two control rows, then the table.** The order `<p>` is gone; the order's short form is the SectionHead
`qualifier` (`newest first, by block time · loads 50 at a time`; one engine: `… by block number on Cash's chain`; the
page size is the envelope's `limit` through `readWirePopulation`, omitted before an envelope exists; broken ordering:
`in the order the service sent`). `activity-order` is the SectionHead's `testId` (the kit puts it on the wrapping
`div.sec`; the kit has no id for the `<small>` alone, and I did not touch the kit). The since-block item with no
single engine is the short form `Since block · choose one engine` on `activity-since`, the full clarity sentence in
its `title` and in the drawer (`ACTIVITY_SINCE_NOTE`, which keeps "a property of chains, not an error"). Full order
sentences (`ORDER_CROSS` / `orderScoped`, first letter capitalised, otherwise verbatim) are drawer paragraph 6.
Pins: unit "the list's head…", e2e since-block test, e2e "answer before evidence" (re-ordered: live < list head <
engine row < since row < tail notice < table).

**Both notices.** Since-block removed: `The since-block filter (25,635,600) was removed: a block number only means
something on one chain, and no single engine is selected.` / `…, and Cash is on a different one.` Bad draft: kept.
`SINCE_BLOCK_IMPOSSIBILITY` is untouched in `lib/feed-data.ts` (not my file; it is still the thrown error's text).
Tail notice (`activity-tail`, new id, only when an all-engines tail is loaded and the ordering is intact). Drift
alert: only the lead reworded — `Ordering fault · the service sent a timed row inside the untimed tail, …`.

**B3 (page half).** The page-local `.controls .chipBtn[aria-pressed="true"]` rule is deleted. One thing the brief did
not anticipate: `.controls .chipBtn { color: var(--ink-2) }` has the SAME specificity (0,2,0) as the kit's
`.btnGhost[aria-pressed="true"]`, so with the local pressed rule gone the resting ink could outrank the kit's accent
by source order. Fixed without touching the kit: the sizing stays on `.controls .chipBtn`, the resting ink moved to
`.controls .chipBtn:not([aria-pressed="true"])`, so nothing page-local addresses a pressed button. Pin: e2e ledger
test compares the pressed and resting buttons' computed `color`, `border-top-color` and `background-color` (all three
must differ).

**Tier 2 (clarity: "all Tier 2 items are also A").** Kicker `Activity · all engines`; `Order` chip `by block time` /
`by block number`; the liquidations tile is labelled `Liquidations` with sub `among the loaded rows`. For consistency
with the kicker I also made the Scope chip and the engine switch's first button say `all engines` (one word, from
`ALL_ENGINES`) — not in the ruling; `data-mode="cross-engine"` and every test id are unchanged. The since input's
placeholder no longer prints a wire id (`height on debt_manager` → `block number`).

## Fact claims verified before wording (reconciliation 6)

1. **The events envelope carries `served_at`** — `api/openapi.yaml:4233` (required) and `:4235`; demo fixture value
   `2026-08-08T20:22:50Z`. TRUE → threaded.
2. **"records bad debt being realised (deficit_created)"** — `api/openapi.yaml:4057-4058`: "`deficit_created` ⇐
   aave_deficit_created, the pool's own bad-debt realization event." TRUE as ruled.
3. **"listed last, by block number" — NOT true as ruled; corrected.** `internal/store/p5_events.go:397`:
   `tieOrder := e.chain_id DESC, e.block_number DESC, e.tx_hash DESC, e.log_index DESC, e.seq DESC`, used at `:400`
   after `bh.block_time DESC NULLS LAST`. The tail is ordered by CHAIN first, then block number, and the demo tail
   itself spans two chains (Cash @ chain 10, legacy @ chain 1). Worded: "listed last, **by chain and then block
   number**" in the dek and the tail notice. And it is a CHECKED claim: `tailKeepsItsOrder(rows)` verifies the loaded
   untimed rows are in (chain_id, block_number) descending order and the order is said only when they are; otherwise
   the dek says "listed last." and the notice drops the clause (`ACTIVITY_TAIL_NOTICE_UNORDERED`). This bites in the
   e2e load-more test, whose tail is two fixture pages stitched together and is not in that order.
4. **"Cash and the legacy market run on different chains"** — demo fixture: every `debt_manager` row is `chain_id` 10,
   every `aave_v3_etherfi` row `chain_id` 1; `p5_events.go:18` names them ETH (~25.6M) and OP (~150M+). TRUE.
5. **"refused" → "not computed"** — `refused_count` is "Refused POSITION ROWS" (`packages/client-ts/src/generated/schema.ts:743-747`)
   and the Book's tile for the same quantity is labelled "Not computed" (`app/book/BookLegacy.tsx:58`). TRUE.
6. **"Past stream states are not stored, so they cannot be replayed here"** — `lib/posture.tsx:15-16` ("Nothing here
   persists or replays posture history"), and `grep -ril outbox internal/` returns nothing: no store exists. TRUE.
7. **"that is every action matching this filter"** — `next_cursor` null is "the feed is exhausted under the filter"
   (`api/openapi.yaml:4253`). TRUE, and it is never said while a refusal or failure explains the missing cursor (those
   arms have their own headline).

## Where I departed from a ruled sentence, and why

- **Refused / failed with rows loaded is emphasis-only.** The clarity table splits it (`The next page was refused,` +
  rest `after 50 chain actions loaded.`); S2 and my dispatch both say a refusal arm is emphasis-only in the
  `refused(...)` shape. The words are identical and the H1 text is the same; the whole sentence is the emphasis, so
  the count is not brighter than the refusal it follows.
- **The refusal dek names the code once.** The ruled pattern `{sentence(message)} ({code}). Restart…` doubles the
  code here, because `InspectorFetchError.message` (not my file) is already `"400 bad_request: … (url)"`. The dek is
  the service's words, then `({code}).` ONLY when those words do not already contain it (`code ?? "bad_request"`, the
  page's existing fallback for a 400), then "Restart the list below." Pinned both ways.
- **"by chain and then block number"** — item 3 above.
- **The strip's no-batch sentence does not repeat the chip's word.** The ruled demo line opens "Reconnecting —"; the
  state chip directly before it already reads RECONNECTING (pinned by `p1a-fixes` with exact text and colour), and the
  sentence would be false under "awaiting base". A closed connection drops "yet" ("No batch arrived on this
  connection, …") — it will deliver nothing more.
- **The strip's engine names are `engineName(...)`** (the ruled PATTERN), so the legacy watermark reads
  `Aave v3 market (legacy) at block …`, not the demo row's "legacy Aave v3 at block". The dek uses the ruled prose
  form "the legacy Aave v3 market".
- **`plural` is local to `feed-view.ts`** (exported, used by `activity-view.ts`). S1 asks for the Book's `plural` to be
  lifted into `prose.ts`; that file is not mine. This is now the fourth copy (`book-headline`, `stress-preview`,
  `trust`) — a pruning-wave item.

## Pins re-pointed (old words → new)

`feed-view.spec`:
- "2 chain action(s) loaded, 1 liquidation(s) · newest at block 25,635,601[ · more exist behind the cursor]." →
  `{ "1 liquidation among the 2 chain actions loaded,", "the newest at block 25,635,601; that is every action matching this filter." | "…; more exist beyond these." }`
- "… · newest custodied 2026-07-29T09:57:11Z." → `"No liquidation among the 2 chain actions loaded,"` + `"the newest at Jul 29, 09:57 UTC; …"`
- "… none carry custodied header time, so no newest is claimed." → `"none has a block time yet, so no newest is claimed; …"`
- "the wire violated its own ordering law" → `"no newest is claimed: the service broke its own ordering (see the alert below); …"`
- "0 chain actions loaded in this window — the list below states the reason." → `FEED_LOADING` / `FEED_EXHAUSTED` by cursor.

`activity-view.spec`:
- `ACTIVITY_DEK` "The live strip and the paged record never blend." → the computed dek (the slogan is still pinned as
  `ACTIVITY_INTRO`'s closing clause); kicker "Activity · cross-engine" → "Activity · all engines"; tone "ok" → "neutral".
- chips `[Scope, View, Order, Rows, Filter echo]` → `[Scope, View, Order, Newest, Filter echo]`; Scope/Order
  "cross-engine"/"engine-scoped" → "all engines" / "by block time" / "by block number".
- tiles: liquidations sub "cross-engine"/"engine-scoped" → "among the loaded rows"; nothing-loaded liquidations sub
  → the state's word.
- "Page refused · bad_request: {message}" → "The next page was refused, after 50 chain actions loaded." / "The
  service refused this page."; "Page fetch failed: {error}" → "Recorded chain actions could not be fetched." (+ the
  rows-loaded arm); deks → the service's words.
- exhausted: "no custodied chain actions match this filter. …" → "no recorded chain action matches this filter. …";
  H1 "0 chain actions loaded…" → "No recorded chain action matches this filter."
- loading: "loading the feed…" → "loading recorded chain actions…"; H1 as above.
- `orderNote` (both sentences) → `listQualifier` + doctrine[5]; "History: recorded chain actions" → "Recorded chain
  actions"; doctrine 5 → 8 paragraphs.
- `since_block 25635600 dropped: …` (both) → the two reader-word notices; "ORDERING DRIFT" → "Ordering fault".

`activity.spec.ts` (e2e, unrun): the same re-points on the page, plus `activity-since` "incomparable across chains" →
`ACTIVITY_SINCE_SHORT` + its `title`; `activity-order` "custodied header time" / "block height" → the qualifier;
"nothing is pretended", "current connection only", "Live posture is never history", "batch #1",
"aave_v3_etherfi @25,635,618", "debt_manager @154,796,552" → the strip's new words.

## FOR THE INTEGRATOR — pins in specs I do not own that weld the old words

I did not edit these (three implementers share them; the brief gives me `activity.spec.ts` only). Each will fail on
the shared build until re-pointed:

| File:line | Today | New |
|---|---|---|
| `tests/e2e/shell.spec.ts:21` | `h1: /^Page fetch failed: /` | `/^Recorded chain actions could not be fetched\.$/` |
| `tests/e2e/state-matrix.spec.ts:563` | `"no custodied chain actions match this filter"` | `"no recorded chain action matches this filter"` (`:564` "a real answer" still holds) |
| `tests/e2e/state-matrix.spec.ts:628` | `activity-live-none` ∋ `"nothing is pretended"` | `"nothing live is shown"` |
| `tests/e2e/state-matrix.spec.ts:642-643` | `"batch #1"`, `"@25,635,618"` | `"Batch 1"`, `"at block 25,635,618"` |
| `tests/e2e/state-matrix.spec.ts:645` | `activity-live` ∋ `"current connection only"` | `"this connection only"` |
| `tests/e2e/p1a-fixes.spec.ts:698` | `activity-live-none` ∋ `"nothing is pretended"` | `"nothing live is shown"` |

Still green as written: `p1a-fixes` F3's chip texts (`streaming` / `awaiting base`) and computed colours
(`--accent-text` / `--ink-2`) — the chip element, its classes and its words are unchanged; `p1b-fixes` fix 2 (the
`Filter echo` chip); `r1-fixes` (4) (`activity-amount`, and `activity-unit` ∋ "raw units"); `screenshots.spec.ts`'s
ready predicate (`data-state=ok`, 50 rows). The Activity pixel baselines move (as planned — they are retaken).

## Other notes

- **H1 line budget.** The demo H1 is 107 characters (2 lines at the 860px measure). The broken-ordering arm is ~170
  characters (3 lines) — a hazard state whose rest is the ruled pattern verbatim; I did not shorten it.
- **The tail notice costs one line above the table** on the demo (it is clarity's ruled notice; design B4's "two
  control rows then the table" holds whenever no tail is loaded). Net vertical change on the demo is still strongly
  negative: the 3-line since note and the 2-line order note are gone.
- **A header whose chips wrap:** five chips + the drawer button; the `Newest` ISO chip makes a wrap likelier at 1280.
  Accepted per the brief (the `.meta` grid is out of this round); not worked around.
- **Mid-run, other implementers' files failed `tsc`** (History, Verification) while they were mid-edit; on my final
  run the whole tree is clean (tsc 0, eslint 0, unit 987/987), so nothing persists to name.
- After my commit the shared index holds the Verification/API implementer's staged paths — theirs, left alone; my
  commit's `--stat` is exactly my 11 files.
