# Task 4 review — `activity-view` and the Activity page

Package: `67affb5..e02d39f` (two commits: `f300b04` lib + 13 unit pins; `e02d39f` page + contract + retirements + shared-spec re-points). Read-only review of the packaged diff against the brief, the plan header (Global Constraints, R1–R8, the contract table) and the report. The e2e contract was NOT run (the controller runs it on the shared build); its pins are judged for plausibility against the emitted ids and the fixtures.

Outside the package, noted only: `4afe8f1 fix(web): activity - the account and tx links are distinguishable to the contract` (ids `activity-account` / `activity-tx` on the row's links; the cold-load pin re-targeted). It is the fix for I2 below. Not reviewed.

Line references: `old` = `web/app/feed/FeedSurface.tsx` as deleted (the diff's `-` hunk is the whole file, so line n of the hunk is line n of the file); `new` = the added file's own line numbers. Diff-package line numbers are given as `diff:NNNN` where useful.

---

## Verdicts

- **Spec Compliance: ✅ (compliant with the brief; two plan-level flags, I1 and I3, and one contract pin that cannot pass as packaged, I2 — fixed by 4afe8f1 outside the package).**
- **Assessment: APPROVE WITH CHANGES.** The state machine moved byte-for-byte in law, every row fact lives in the lib, the headline is `feedTakeaway`, the tiles dash honestly, the retirement ledger is complete. Land I1 (the controller's ruling on the liquidation extract) and I3 (the two notice sentences and the strip words into the lib) before the branch closes; I2 is already addressed on HEAD.

---

## Spec Compliance — trace

### 1. The state machine moved unchanged in law ✅

Mechanical check: the `-` lines of `FeedSurface` from `export function FeedSurface()` to `const empty =` and the `+` lines of `ActivitySurface` from `export function ActivitySurface()` to `const activity = deriveActivityView(` were extracted, comment-only lines dropped, trailing whitespace trimmed, and diffed: **126 lines each, identical except the function name** (`FeedSurface` → `ActivitySurface`). The report's deviation 13 (comments rewritten to state the law without round names; code byte-for-byte) is confirmed.

| Element | Old (`FeedSurface.tsx`) | New (`ActivitySurface.tsx`) | Parity |
|---|---|---|---|
| The eight `useState`s (engine, view, types, sinceBlock, sinceDraft, envelope, refusal, notice) | 65–72 | 64–71 | identical |
| `usePosture()` → `valueDecimals` memo over `posture.engines` | 79–86 | 78–85 | identical |
| `scope` / `mode = feedOrderMode(scope)`, ledger pins `types: ["liquidation"]` | 88–93 | 87–92 | identical |
| `resetRef` | 95 | 94 | identical |
| `fetchPage` (`useCallback`, deps `[engine, view, types, sinceBlock]`) | 104–133 | 103–132 | identical |
| `isCurrent()` gate on `setEnvelope` + `setRefusal(null)` | 118–121 | 117–120 | identical |
| 400 → `setRefusal` gated on `isCurrent()`; rethrow | 124–128 | 123–127 | identical |
| `useCursorPages<FeedChainEvent,string>(fetchPage)`; `resetRef.current = reset` effect | 136–142 | 135–141 | identical |
| Auto-load of the first page (`rows.length === 0 && hasMore && !loading && error === null`) | 145–147 | 144–146 | identical |
| `restartWalk` (envelope, refusal, notice cleared; `reset()`) | 149–154 | 148–153 | identical |
| `switchEngine`: same-engine no-op; since-block drop; `setSinceDraft("")`; `restartWalk()` then notice | 156–173 | 155–172 | identical |
| Notice text A: `since_block N dropped: ${SINCE_BLOCK_IMPOSSIBILITY}` | 167 | 166 | identical |
| Notice text B: `since_block N dropped: block heights are chain-scoped, and ${candidate} lives on a different chain` | 168 | 167 | identical |
| `switchView`, `toggleType` | 175–188 | 174–187 | identical |
| `applySinceBlock`: empty clears; `/^[0-9]+$/`; `"…" is not a block number, so nothing was requested` (slice 32); `Number(trimmed)` | 190–205 | 189–204 | identical |
| `empty` / `emptyExhausted` words | 207–218 | moved to lib `emptyWords()` (`activity-view.ts:245–258`) | same words, same precedence — see §3 |

The consumers changed shape, not law: the strips keep `role="status"` (notice) and `role="alert"` (refusal, error) with the same words (new 279–312); the refusal strip's `restart from page one` calls `restartWalk` (new 297); the error strip's `retry` calls `loadMore` (new 306) and renders only when `refusal === null` (new 302), as before (old 407). The foot's `Load more` is `disabled={loading}` (new 328), as before (old 447). `aria-busy` on the root (new 194) is new and harmless.

Precedence parity for the empty words — old (207–218): `refusal` → `error` → (`loading || rows.length===0` → loading word) → "no rows on this page", then `!hasMore && rows.length===0 && error===null` → the exhausted sentence. A refusal always arrives with an error (the 400 is rethrown into the hook, `pagination.ts:77–81`), so old and new agree on every reachable input: `activityState()` (`activity-view.ts:238–243`) refused > error > (no rows: hasMore ? loading : exhausted) > ok.

### 2. Every row fact from `FeedList` lives in `deriveActivityView`; no component re-derives ✅

| FeedList fact (deleted `FeedList.tsx`) | In the lib (`activity-view.ts`) | Component prints only |
|---|---|---|
| `feedRowKey(event)` as the row key (FeedList 261, 280, 305) | `key: feedRowKey(event)` :221 | `testId: \`activity-row-${row.key}\`` (`ActivityTable.tsx:26`) |
| The untimed tail = cross-engine rows without header time, after the timed rows, block number where the time would be (FeedList 265–268, 284–290) | `dim: mode === "cross-engine" && event.block_time === null` :222; `when: renderBlockTime(...)` :223 | `dim: row.dim` → `KitTable` `tr.dim` (`KitTable.tsx:44`) |
| Engine-scoped: a null time is a per-row fallback, not a tail (FeedList 258–260) | the `dim` predicate above; unit pin "engine-scoped: a null time…" | — |
| `feedTagTone(event.type)` (FeedList 225) | `tone: feedTagTone(event.type)` :226 | `StatusPill tone="crit"` vs plain span (`ActivityTable.tsx:31–39`) |
| `feedAmount(event, { engineValueDecimals })` and its arms: `record-only`; `display`; `unitChip`; `RAW_UNITS_TAG` when `rawUnits`; `symbol`; `unitTitle` (FeedList 100–131) | :205, :213–219 (`unit` = chip · `RAW_UNITS_TAG` · symbol joined with " · "), :228–230 | `activity-amount` / `activity-unit` cells (`ActivityTable.tsx:48–54`) |
| `renderBps` for both bonus figures; `EM_DASH` for every unestablished field; `groupDecimalString(renderNullableDecimal(...))` for repaid and seized legs; `detail.note` (FeedList 133–182) | `liquidationDetail()` :179–198; `detail:` :234 | as `title` on the pill (`ActivityTable.tsx:33`) — see I1 |
| `TxLink`: short hash, `txExplorerUrl`, full-hash title, the no-explorer clause with `readWirePopulation(chain_id)` (FeedList 63–88) | :206, :211–212, :231–233 | `<a>`/`<span>` with `title={row.txTitle}` (`ActivityTable.tsx:58–68`) |
| Provenance `block N · log N · seq N`, block only beside a time, seq only when nonzero, guarded by `readWirePopulation(log_index)` / `(seq)` (FeedList 234–240) | :208–210 folded into `txTitle` | hover only — see M6 |
| `readWirePopulation` on the echoed `since_block` and `limit` (FeedSurface 458–462) | `filterEcho()` :169–176 | the `Filter echo` chip |
| The drift alert (FeedList 296–302) | `drift: mode === "cross-engine" && splitUntimedTail(rows).orderViolated ? ACTIVITY_DRIFT : null` :309 | `activity-drift` strip (`ActivitySurface.tsx:314–318`) |

Component-side computations found: `truncateAddress(row.account)` (`ActivityTable.tsx:43`, formatting of a lib fact, not a fact); `refusal.code ?? "bad_request"` in the refusal strip (`ActivitySurface.tsx:288`, the lib's default duplicated — moved verbatim from old 393); `pending = activity.state === "loading"` (new 185). Nothing re-derives a row fact.

### 3. The headline equals `feedTakeaway(...)` ✅ (pinned)

`headlineFor()` `activity-view.ts:260–272`: `emphasis: feedTakeaway(input.rows, input.mode, input.hasMore)`, `rest: ""`, `dek: ACTIVITY_DEK`. Pinned in the unit spec ("header: … the headline IS feedTakeaway's sentence", `toEqual` on the whole `LabHeadline`) and in e2e: cold load (`activity.spec.ts:96–99`, also `getByRole("heading", { level: 1 })` = the sentence), ledger (:178), since_block (:209), load more (:283), drift (:391), empty (:328). Refused → `refused("Page refused · {code ?? bad_request}: {message}", ACTIVITY_DEK)` :262; error → `refused("Page fetch failed: {message}", ACTIVITY_DEK)` :264 — the brief's words. `refused` is `lab-headline.ts:39` (`tone: "refused"`, `rest: ""`).

### 4. Header words ✅

- Kicker (R1): `"Activity · cross-engine"` / `` `Activity · ${engineName(engine)}` `` :301 → "Activity · Cash", "Activity · Aave v3 market (legacy)" (unit pin; e2e :100, :205). The legacy market is labelled legacy where the page names it.
- Dek (R3): `ACTIVITY_DEK = "The live strip and the paged record never blend."` :122 (e2e :102).
- Chips: `Scope · View · Order · Rows · Filter echo` :292–298, the echo only with an envelope; order pinned in the unit spec and `[data-chip=…]` emitted by `IdentityChips.tsx` (`data-chip={chip.label}`). The `VerdictHeader` never renders without chips (it falls back to the refusal chip; here four chips are always present).

### 5. The two tiles per R4 with the refused dash ✅

`tilesFor()` :274–287: nothing loaded outside `exhausted` → `value: EM_DASH`, sub = the state's word (`loading the feed…` / `page refused` / `page fetch failed`), `tone: "refused"` for refused/error, `neutral` while loading; otherwise `groupInt(rows.length)` with `more available` / `end of the filtered feed` and `groupInt(liquidations)` with `mode`. `KpiTile` emits `data-tone` and renders `…` when `pending` (`KpiTile.tsx:29–31`). Pinned: unit ("tiles", "a refused page", "a failed fetch", "exhausted", "loading"); e2e degraded (:299–304, incl. `not.toContainText("0")`), empty (:330–332, the true zero). Sub words follow the brief (`more available` / `end of the filtered feed`) rather than R4's sketch — the report's deviation 2; the brief is the later ruling.

### 6. States map to `data-state` honestly ✅

| Input | `activityState()` :238–243 | Honest? |
|---|---|---|
| `refusal !== null` (a 400 held) | `refused` | yes — the walk stopped on the service's own word; rows served before survive and are counted (e2e :251–253) |
| `error !== null`, no refusal | `error` | yes — the last fetch failed; with rows loaded the state names the continuation's failure (see M4) |
| no rows, cursor ahead | `loading` | yes — also the transient between `reset()` and the auto-load effect |
| no rows, no cursor, no error | `exhausted` | yes — "a real answer" with true zeros |
| rows loaded (even with a load-more in flight) | `ok` (+ `aria-busy`) | yes |

Root: `data-testid="activity-surface" data-state={activity.state} data-mode={mode}` (`ActivitySurface.tsx:190–195`) — the contract table's five states and `data-mode`.

### 7. The live strip's SSE reading untouched ✅

`FeedLiveStrip.tsx` diff: the stylesheet import (`feed.module.css` → `activity.module.css`), the root class `liveStrip` → `live`, and six ids (`feed-live-*` → `activity-live`, `activity-live-{state,none,batch,unavailable,degraded}`). `streamChip`, `wireCount`, the `live` predicate, the `unavailable`/`batch`/`none` arms, the degradation list and the law line are unchanged. Every class it references (`live`, `liveLabel`, `liveChip`, `liveAccent`, `liveUnknown`, `liveWarn`, `liveDown`, `liveLaw`) exists in `activity.module.css:10–32` on the same tokens (`--accent-text`, `--ink-2`, `--warn-text`, `--crit-text`), so the p1a F3 computed-color pins keep their targets.

### 8. Retirements accounted for ✅

`feed.spec.ts` had 14 tests; the report's ledger names all 14 (cross-engine walk; header-time order; engine-scoped/since_block; amount units; liquidations ledger; unestablished-open; established-closed; ordering drift; W-3L 432 foot; refused cursor; degraded; empty; live no-base; live snapshot) with a disposition each. The shared arms: p1a F3 ×2 (diff:3506–3555, `activity-live-state` / `activity-live-none`), p1b fix 2 (diff:3555–3588, the echo → the `Filter echo` chip, `activity-types`; the held-walk law asserted unchanged at p1b-fixes.spec.ts:100–110), r1 (4) ×2 (diff:3588–3662, `activity-amount`, the raw tag inside `activity-unit`), r1 (6) kept (`/feed` at r1-fixes.spec.ts:114), r1 (10) retired in place with the note (diff:3641–3644), shell H1 (diff:3662–3690), state-matrix ×7 cells (diff:3690–3834). A sweep of `app/ components/ lib/ tests/` finds no remaining `feed-*`/`since-block-*`/`order-note`/`untimed-divider`/`liquidation-detail`/`detail-toggle`/`type-chips`/`view-ledger` id and no import of `FeedSurface`, `FeedList` or `feed.module.css`. `git ls-tree e02d39f web/app/feed/` holds exactly the seven files the brief names.

Two retirements are RETIRED rather than re-expressed: "an UNESTABLISHED extract renders OPEN" and "a FULLY-ESTABLISHED extract starts closed" — the first carries a law (an em dash never behind interaction) that the controller's ruling re-instates; see I1 for the pin to add.

### 9. The 14 e2e pins against the emitted ids — plausibility

Ids resolved against: `VerdictHeader.tsx` (`data-testid`, `data-variant={tone}`, `-headline`, `-dek`, `-identity`), `IdentityChips.tsx` (`data-chip`), `KpiTile.tsx` (`data-tone`), `KitTable.tsx` (`<table data-testid>`, `<tr data-testid class=dim>`, the `emptyText` `<td colSpan>`), `StatusPill.tsx` (`data-tone`, `title`), `SectionHead.tsx` (`<h2>`), `Drawer.tsx` (null when closed; focus into the panel; Escape → `onClose`; focus restored in the effect cleanup), `app/layout.tsx:36` (`<main class="shell">`). Fixtures: `DEMO_FEED_PAGE_1` (50 rows, row 0 = chain 10 · log 38 · seq 0 · `2026-08-08T20:21:05Z`; untimed rows at 48 (`155318218`, debt_manager) and 49 (`25713780`, aave); liquidations at 5/19/37, the first `0xBBbB…`, seized `656250000000000000 weETH`, realized null / configured `500`; `filter.types: []`, `limit 50`, `next_cursor` set); `FEED_CROSS_PAGE_2` (2 rows, both untimed, `next_cursor null`); `FEED_UNITS` (aave_scaled dec null · dm_normalized_debt dec null · none/null · opaque); `FEED_CROSS_PAGE_1` (timed liquidation with realized null; untimed borrow); `FEED_ENGINE_AAVE_PAGE_1` (`25635601` timed, `25635580` untimed); `FEED_ERROR_BAD_CURSOR` (`bad_request`, "…not interchangeable").

| # | Pin (`activity.spec.ts`) | Ids / facts relied on | Fragile spot | Verdict |
|---|---|---|---|---|
| 1 | cold load (:86) | `activity-surface` state/mode; `-headline`; `getByRole heading level 1`; `data-variant`; five `[data-chip]`; two tiles; `activity-row-10·{tx}·38·0`; `td` first = block_time; the account link; no `$` | **`head.getByRole("link", { name: /^0x/ })` (:121) matches TWO links — the account (`0x3354…e6bb`) and the tx (`0x33540373… ↗`, chain 10 has an explorer) → Playwright strict-mode violation** | **FAILS as packaged** (I2; fixed by 4afe8f1 outside the package). Row ids with `·` and the full hash: `getByTestId` builds an exact attribute selector — fine |
| 2 | the untimed tail (:128) | `toHaveClass(/dim/)` on rows 48/49; `[class*="dim"]` count 2; no `activity-drift`; `activity-order` | production CSS-module class must keep the local name `dim` | Plausible — `book.spec.ts:59,98` relies on the same `tr.dim` / `/dim/` against the same build (and `verification.spec.ts`, `state-matrix.spec.ts`) |
| 3 | the ledger view (:144) | `activity-view-ledger` `aria-pressed`; `types=liquidation` request; 3 rows; `activity-types` gone, `activity-types-note`; `[data-tone="crit"]` ×3 with `title` regexes | the extract is read from `title` (:174–176) | Plausible as written; rewrite the three `title` regexes onto the visible detail once I1 lands |
| 4 | since_block (:185) | `activity-since` `data-possible`; `activity-since-input` `inputmode`; `fill` + `press("Enter")` (:223–224); `activity-since-applied` "≥ 25635600"; the echo chip; `activity-notice`; request-law loops | Enter path: `onKeyDown` → `onApplySince` → `applySinceBlock` reads `sinceDraft` set by `fill`'s change event (`ActivityControls.tsx:147–153`) | Plausible |
| 5 | a refused cursor (:240) | `activity-load-more`; `activity-refusal` words; state `refused`; `data-variant refused`; headline contains "Page refused · bad_request:" and "not interchangeable"; 50 rows survive; `activity-restart` → state `ok` | `reset()` clears `error` (`pagination.ts:87–97`) so the restart re-arms the auto-load | Plausible |
| 6 | load more (:267) | 52 rows; tile/chip "52"; `activity-end`; 4 dim; headline without the cursor clause | `FEED_CROSS_PAGE_2` = 2 untimed rows, `next_cursor null` → 48 timed + 4 untimed | Plausible |
| 7 | degraded envelopes (:285) | `activity-error`; state `error`; `data-variant refused`; `activity-kpi-rows` `data-tone="refused"`, "—", "page fetch failed", `not "0"`; `activity-retry` ×2 | the tile text is "Rows loaded — page fetch failed" — no `0` | Plausible |
| 8 | empty filtered feed (:319) | state `exhausted`; `activity-table` contains the sentence (the `emptyText` `<td>` is inside the table); headline; `data-variant ok`; tiles "0"; `activity-end` | — | Plausible |
| 9 | amount units (:337) | `activity-unit` filters (aave-scaled / normalized debt / opaque units / `raw units` ×3); `activity-amount` record-only and `123456789`; no `123.456789`; no `$` | `raw units` ×3 requires the DM row unscaled with the stream muted — `FEED_UNITS` DM row has `amount_decimals null` and no snapshot → `rawUnits` (`feed-view.ts` `dm_normalized_debt` arm) | Plausible |
| 10 | cross-engine order is header time (:360) | `rows.locator("td:first-child")` = three ISO times; 0 dim | — | Plausible |
| 11 | ordering drift (:371) | `activity-drift` visible, `role="alert"`, words; headline sentence; row 1 dim, row 2 not | the smuggled timed row is in the tail slice but keeps its time → `dim` false (the lib dims on `block_time === null`, not on position) — matches the unit pin `[false, true, false]` | Plausible |
| 12 | live posture (:399) | `activity-live` `role="status"`; `activity-live-none`; `activity-live-batch` after `page.unroute("**/v1/stream**")` + re-route + re-`goto` (:412–421) | `unroute` by the identical pattern string removes the abort handler; the re-`goto` reconnects the EventSource (the old spec fed the same SSE body) | Plausible |
| 13 | the doctrine in the drawer (:429) | `page.locator("main")` not containing the intro; `activity-drawer-body` count 0 → 5 `<p>` in order → Escape → count 0 → `activity-drawer` focused; `heading level 2` = `ACTIVITY_LIST_TITLE` | the Drawer renders inline inside `<main>` and returns `null` when closed; its title is an `<h4>` so it does not collide with the `h2` query; focus restore runs in the `[open]` effect cleanup | Plausible |
| 14 | answer before evidence (:454) | `boundingBox().y` ordering across seven ids | single-column grid, DOM order = visual order | Plausible |

Shell H1 (`shell.spec.ts:38–42`, every `**/v1/**` aborted): `fetchEvents` rethrows a non-HTTP error verbatim (`inspector-data.ts:54–59`), `useCursorPages` wraps it as-is (`pagination.ts:79`), so the H1 reads `Page fetch failed: Failed to fetch` — the regex `/^Page fetch failed: /` holds. Plausible.

### 10. The liquidation `detail` must render visibly — the controller's ruling

As packaged the extract is the crit pill's `title` (`ActivityTable.tsx:33`) and the non-crit span's `title` (:36, always null there). **Place:** the one component that prints rows, `web/app/feed/ActivityTable.tsx`, and the kit's table if a full-width line is wanted. Two honest options, both leaving the lib as the sole composer (the string is already `ActivityRow.detail`, `activity-view.ts:179–198, 234`):

- (a) A detail row beneath the liquidation's row: `KitRow` gains `detail?: ReactNode`, rendered by `KitTable` as a following `<tr data-testid={`${row.testId}-detail`} class={dim}>` with one `<td colSpan={columns.length}>`. This is the shape the old `LiquidationDetail` had (its own block under the row), reads at table width, and keeps the `Type` column narrow. A small kit change (Task 1's file), so it belongs with the controller's blessing.
- (b) Without touching the kit: in the `type` cell, stack a visible `<span className={styles.detail} data-testid="activity-detail">{row.detail}</span>` under the pill. No kit change, but the one-line extract (a full 0x address, the legs, both bonus figures, the note) wraps badly in the Type column.

Either way, consider having the lib return the extract as parts (`{ liquidator, repaid, seized, bonus, note }`) rather than one string, so the liquidator can be the Inspector link it was in `FeedList` (an `AddressMono` with `href`), and keep `detail` for the hover if wanted.

**Pins to add** (re-expressing the two RETIRED pins): in "the ledger view" (:174–176) replace the three `title` regexes with `toBeVisible()` + `toContainText("bonus realized — / configured 500 bps")` on the detail element; add an all-actions pin on `FEED_CROSS_PAGE_1` (its liquidation carries `realized_bonus_bps: null`): the detail is visible on cold load with `realized —`, with no click and no hover — "an em dash never behind a fold or a hover" (W-3L 430 in the new register); the state-matrix `ok:untimed-tail-disclosed` cell can pick up the same visibility in one line. The unit pin on `detail` already exists and needs no change.

### 11. Copy composed only in the lib — flagged component sentences

The lib carries every doctrine paragraph, the order notes, the empty words, the echo and the headline/tiles (`activity-view.ts:122–163`). Component-composed text found:

- Sentences: `` `since_block ${…} dropped: ${SINCE_BLOCK_IMPOSSIBILITY}` `` and `` `since_block ${…} dropped: block heights are chain-scoped, and ${candidate} lives on a different chain` `` (`ActivitySurface.tsx:166–167`); `` `"${trimmed.slice(0, 32)}" is not a block number, so nothing was requested` `` (:199). Moved verbatim under the brief's "move, do not rewrite"; the plan's Global Constraint ("copy … never composed in components") still applies and the report does not list them as a deviation — I3.
- Words/labels: `NOTICE`, `PAGE REFUSED · {code}`, `PAGE FETCH FAILED`, `restart from page one`, `retry`, `Loading…`, `Load more`, `end of the filtered feed` (also the lib's tile sub — the same sentence composed twice) (`ActivitySurface.tsx:280–334`); tile labels `Rows loaded`, `Liquidations in the loaded window` (:201–216); `cross-engine`, `all actions`, `liquidations ledger`, `engine`/`view`/`type`/`since block`, `apply`, `≥ N`, `since_block · {SINCE_BLOCK_IMPOSSIBILITY}`, the placeholder (`ActivityControls.tsx`); `Methodology & evidence` (`ActivityDrawer.tsx:18–20`); the column headers and ` ↗` (`ActivityTable.tsx`). Labels, not sentences — M2.

### 12. Tokens only in CSS ✅

`activity.module.css`: no hex/rgb literal, no px font-size; every custom property used (`--type-mono-sm`, `--type-small`, `--type-body`, `--type-floor` (= 12px, the absolute floor, `tokens.css:88`), `--w-semibold`, `--accent`, `--accent-text`, `--warn`, `--warn-bg`, `--warn-text`, `--crit`, `--crit-text`, `--refused-bg`, `--panel`, `--line`, `--ink`, `--ink-2`, `--ink-3`, `--mono`) is defined in `app/tokens.css`. The old `feed.module.css` used 26 `--fs-*` aliases; none remain. One new tint: `color-mix(in srgb, var(--accent) 8%, transparent)` behind a pressed ghost button (:40) — R12 asks for contrast recomputed on any new tint (Task 12).

### 13. Gates and process (from the report; not re-run)

Unit: 13 pins added, none removed (`git diff --stat -- web/tests/unit`: one file, +265), so the `web/lib` unit count does not decrease. Commit `f300b04` is exactly `web/lib/activity-view.ts` + `web/tests/unit/activity-view.spec.ts`; `e02d39f` is the 17 page/contract/retirement paths — the package diff (19 files, +1773/−1870) matches `git diff 67affb5..e02d39f`. The report's deviation 10 (staged-index commit to avoid sweeping Task 3's live hunks in the shared specs) is consistent with the stat. No attribution lines in either message.

---

## Strengths

- The state machine is provably moved, not rewritten: the comment-stripped bodies are identical line for line, and the epoch gate, the since-block drop with both notice strings, the validation words and the auto-load are all where they were.
- The lib is a real view model: `activityRow()` reproduces every arm of `FeedList` (the four `feedAmount` outcomes, the raw-units tag, the no-explorer clause, the coordinates, the extract with `renderBps` and the em dash) and runs the population guards at the read, so a malformed integer still refuses before render.
- Nothing loaded is a dash with the state's word, never a zero, and the exhausted filter's zero is a true one — pinned in both layers, including `not.toContainText("0")` on the failed tile.
- The drift alert stands outside any fold with `role="alert"`, and `dim` marks a missing header time rather than a position, so the smuggled timed row is not mislabelled.
- The retirement ledger is complete and honest: each of the 14 old pins, the seven state-matrix cells and the p1a/p1b/r1/shell arms has a disposition, with the two fold pins named as retired rather than quietly dropped.
- The unit spec pins verbatim text (dek, intro, list title, method, forensics) and the chip order, so any drift in the words fails in the node project before the build.

---

## Issues

### Critical

None.

### Important

- **I1 — The liquidation extract is hover-only; the controller ruled it must render visibly.** `ActivityTable.tsx:33` puts `row.detail` on the pill's `title`. An unestablished bonus (`realized —`) now sits behind a hover, which the W-3L 430 law (an em dash never behind a closed fold) forbids in spirit, and two old pins that carried that law were RETIRED rather than re-expressed. Place and pins: §10 above. Prefer the detail row (option a) with the lib returning parts so the liquidator regains its Inspector link.
- **I2 — The cold-load pin cannot pass as packaged.** `activity.spec.ts:121` `head.getByRole("link", { name: /^0x/ })` resolves to two elements in the head row (the account link and the tx explorer link, both named `0x…`), a Playwright strict-mode violation. The first pin of the contract fails before it asserts. Addressed on HEAD by `4afe8f1` (ids `activity-account` / `activity-tx`; not reviewed here).
- **I3 — Three sentences composed in the component.** The two since-block notices (`ActivitySurface.tsx:166–167`) and the not-a-block-number notice (:199) are full sentences composed in the surface; `end of the filtered feed` is composed in the foot (:333) and again in the lib's tile sub (`activity-view.ts:284`). The brief's "move verbatim" explains the carry; the plan's Global Constraint is the higher rule and the report lists no deviation for it. Fix without touching the law: export `sinceBlockDroppedNotice(candidate: FeedEngine | null, sinceBlock: number): string`, `notABlockNumberNotice(draft: string): string` and `ACTIVITY_END_WORDS` from `activity-view.ts` with the words unchanged, and pin them in the unit spec; the surface's control flow stays byte-identical.

### Minor

- **M1 — The headline is tone `refused` while loading** (`activity-view.ts:269`; report deviation 12). Every walk restart (each filter press) briefly renders the H1 in `--ink-2` (`kit.module.css:36`) with `data-variant="refused"` although nothing was refused. The lab precedent cited is a labelled run ("Running …"), not a page load. The tiles already carry the in-flight signal via `pending`; consider `ok` while loading, or a kit `pending` for `VerdictHeader` later. Contract impact: none of the 14 pins asserts the loading variant.
- **M2 — Labels and strip words live in the components** (§11 second bullet). Acceptable as labels; if the plan wants one home, an `ACTIVITY_WORDS` record in the lib would take them without changing anything the tests read.
- **M3 — The refusal headline prints the code twice**: `Page refused · bad_request: 400 bad_request: events page: … (url)`, because `InspectorFetchError.message` already prefixes status and code (`inspector-data.ts:45`) and the lib prefixes again (`activity-view.ts:262`). The old strip did the same; the e2e pins only `toContainText`. Use the envelope's own message (`error.body.error.message`) once it is reachable from the error, or drop the lib's prefix.
- **M4 — `data-state` names the last fetch, not the window.** With 50 rows loaded and the continuation refused/failed, the state is `refused`/`error` and the headline replaces `feedTakeaway` with the failure sentence; the rows and tiles keep counting (pinned). Honest, but the contract table does not state the precedence — one comment line on `activityState()` stating "the last fetch's outcome outranks the window" would fix the reading.
- **M5 — The legacy market is named by wire id in two page sentences**: the engine-scoped order note (`comparable within aave_v3_etherfi's own chain`, `activity-view.ts:156–157`) and notice B (`aave_v3_etherfi lives on a different chain`). The report's deviation 8 covers the echo (the wire's own words), but the order note is the page's sentence; `engineName(engine)` there would satisfy "labelled legacy wherever named". Notice B is inside the moved law — change it only together with I3.
- **M6 — The row's provenance moved from visible text to the tx hover.** `block N · log N · seq N` was a visible `mono dim` span (FeedList 234–240); it is now `txTitle` (`activity-view.ts:208–212`). The guards still run at the read, and the row id carries chain · tx · log · seq, so no law is lost; note it as a register change for the cold-visitor read-through (Task 12).
- **M7 — `ACTIVITY_LIST_TITLE` doubles as a doctrine paragraph** (`activity-view.ts:308`, report deviation 4): the drawer prints a heading-shaped line as its second paragraph. Harmless; the controller accepted five paragraphs. If it reads oddly in the QA pass, drop it from `doctrine` and keep the `SectionHead`.
- **M8 — `liquidationEstablished` is now consumed only by its unit spec** (report concern 4). Once the detail renders visibly with no fold, the helper has no page consumer; leave it (the unit count must not decrease) and let Task 7/9 decide.
- **M9 — Additions beyond "move verbatim" in the controls**: `aria-label="since block"` (`ActivityControls.tsx:144`) and `aria-busy` on the root. Both improvements; recorded so the parity claim stays exact.
- **M10 — Register items for Task 11/12** (report concern 5, agreed): "Aave v3 market (legacy)" per row in the Engine column; eight type buttons + the since control at 1280; 390px untested; the new `color-mix` tint's contrast.

---

## Assessment

The package does what the brief asked, in the plan's grammar: one pure view model decides every word and every row fact once, the page is a thin composition of kit parts around a state machine that provably did not change, the live strip stays its own instrument, and the doctrine is in the drawer with the one clause the law needs kept in the dek. The retirement ledger is complete. What remains is the controller's own ruling (I1: the extract visible, with the two retired pins re-expressed), one carry the plan's copy rule does not allow (I3: three sentences into the lib, no word changed), and the contract's first pin, which as packaged trips Playwright's strict mode and is already fixed on HEAD by `4afe8f1` (I2). None of these touch the moved law.

**Spec Compliance: ✅ — Assessment: APPROVE WITH CHANGES (I1, I3 before close; I2 landed outside the package).**

### Not verified

- The e2e contract and the re-pointed shared specs were not run (per instructions); the plausibility table is a static reading against the emitted ids and the fixtures.
- The production CSS-module class naming that `/dim/` relies on is inferred from `book.spec.ts` (and `verification.spec.ts`, `state-matrix.spec.ts`) relying on the same regex against the same build, not observed.
- The gate claims in the report (unit 884 green, `tsc`, `eslint`, `lint:css`, `scope_gate.py`) were not re-run.
- Visual register at 390/1280/1440/1920/2560 and both themes; the contrast of `--accent-text` on the new `color-mix` tint (Task 11/12).
- `4afe8f1` itself, and any interaction with Task 3's unstaged hunks in `p1b-fixes`, `r1-fixes`, `shell`, `state-matrix` (report deviation 10, concern 3).

---

## Re-review 1 (091beb7)

Package: `review-6522c8e..091beb7.diff` — one commit, six files (+159/−45), matching `git diff 6522c8e..091beb7`. Between the first package and this base only `4afe8f1` touched the Activity paths (`git log e02d39f..6522c8e -- web/app/feed web/lib/activity-view.ts web/tests/e2e/activity.spec.ts web/tests/unit/activity-view.spec.ts`), so nothing unreviewed sits under this round except I2's fix, which the coordinator asked me to note and not review. Scoped to I1 and I3. The e2e contract (now 15 pins) was not run.

**RE-REVIEW: closed — I1 and I3 are resolved. Two non-blocking Minors opened (M11, M12).**

### I1 — the liquidation extract renders visibly ✅ closed

| Scope question | Finding | Trace |
|---|---|---|
| Visible in BOTH views? | Yes. `ActivityTable` takes no `view` prop; `LiquidationLine` renders whenever `row.detail !== null`, beneath the pill, in a `display: block; white-space: normal` span. The ledger and all-actions views differ only in which rows the walk returns. | `ActivityTable.tsx` type cell (`{row.detail !== null && <LiquidationLine … />}`); `activity.module.css` `.detail` |
| Never behind a hover? | Every figure and every dash is page text: liquidator (link), `debt repaid`, the asset, `seized`, `bonus realized` / `configured`. The pill's `title` is gone (`<StatusPill tone="crit">` with no title). One field is still hover-only: the wire's `note`, now the line's `title` — M11. | `LiquidationLine` (`title={detail.note}`) |
| Every figure guarded before it prints? | The ROW's amount still goes through `feedAmount`'s arms (unchanged, `activityRow`). The EXTRACT's amounts are not event amounts and never went through `feedAmount`: they go through `renderNullableDecimal(value, { decimals })` → the client's exact `formatUnits`, which runs `parseDecimal(value)` and `assertScale(decimals)` and throws before render on a malformed value or scale (`packages/client-ts/src/decimal.ts:171–178`); null → `EM_DASH`. With `debt_decimals` null the integer prints verbatim — M12. Both bonus figures go through `renderBps` (null → `EM_DASH`, otherwise the wire's string + ` bps`, no arithmetic). This is FeedList's own pipeline, call for call (`FeedList.tsx` 146–176 as deleted). | `activity-view.ts` `liquidationDetail()` |
| Is the Aave/DM asymmetry honest? | For the bps fields, yes. Demo rows 19 and 37 (debt_manager) carry `realized_bonus_bps: null`, `configured_bonus_bps: null`, `debt_asset: null` → `bonusRealized: "—"`, `bonusConfigured: "—"`, `repaidAsset: null` (the asset clause is omitted, not blanked). Row 5 (aave) carries `null` / `"500"` → `—` / `500 bps`. A null is never `0`: pinned in the unit spec (`toMatchObject` + `bonusConfigured` `not.toContain("0")`) and in e2e (`configured —`, `not.toContainText("configured 0")`). The residue is M11: the DM wire does carry a per-seizure `bonus` (`5000000000000000000`, the contract's 100e18 denomination) that neither FeedList nor this page prints, and the sentence that says so is the note — now behind the hover. | fixtures `events-demo-feed-page-1.json` rows 5/19/37 |
| The liquidator's link back? | Yes — `liquidatorHref: /inspector/{liquidator}` from the lib, printed as a `Link` with its own id `activity-liquidator`; the row now has two Inspector links with distinct ids (`activity-account`, `activity-liquidator`), so 4afe8f1's cold-load pin is unaffected (row 0 is a borrow). | `activity-view.ts` `ActivityLiquidation`; `ActivityTable.tsx` |
| Copy still composed in the lib? | The figures are. The joining words (`liquidator`, `· debt repaid`, `· seized`, `· bonus realized`, `/ configured`) are composed in `LiquidationLine` — labels around lib values, the same class as the first review's M2, a consequence of choosing parts so the liquidator can be a link. Acceptable; if one home is wanted, the lib can export the five labels. | — |
| CSS on tokens? | `.detail`: `font-size: var(--type-floor)` (12px, the absolute floor), `color: var(--ink-2)`; `.detail b`: `var(--mono)`, `var(--w-medium)`, `var(--ink)`. All defined in `app/tokens.css`; no colour or type literal (`44ch`, `4px`, `1.5` are layout numbers, as elsewhere in the sheet). The asset uses `kit.dim` (`--ink-3`); it is a span, not a row, so the `[data-testid^="activity-row-"][class*="dim"]` counts are not disturbed. | `activity.module.css` +2 rules |

Pins, and whether they fail on 6522c8e (static argument; nothing was run):

| Pin | Asserts | On 6522c8e |
|---|---|---|
| unit "rows: three liquidations…" | `liquidations[0].detail` `toEqual` the eight parts (note by `stringContaining("never estimated")`); DM row 19 nulls as dashes with no `0`; row 37's `liquidatorHref` | **fails** — `detail` was `string \| null` there (`activity-view.ts:99` at 6522c8e), so `toEqual({…})` on a string fails |
| unit "the surface's notices and the foot's word…" (new, 14th) | both drop sentences, the 32-character quote, `END_OF_FEED`, the tile's sub | **fails** — the three exports are absent at 6522c8e (`git grep` finds none); Playwright transpiles without typechecking, so the imports are `undefined` and the first call throws |
| e2e "the ledger view…" | `activity-liquidation` ×3, the first `toBeVisible` with `seized 0.65625 weETH` and `bonus realized — / configured 500 bps`, the liquidator's href, DM rows `configured —` and never `configured 0` | **fails** — the id does not exist at 6522c8e (count 0 ≠ 3) |
| e2e "all-actions view: an UNESTABLISHED extract is visible on cold load…" (new, 15th) | on `FEED_CROSS_PAGE_1` (realized `null`, configured `"500"`): one extract, visible with no click and no hover, `realized —`, `configured 500 bps`, the href, inside the first row beneath the crit pill | **fails** — count 0 ≠ 1 |

The two RETIRED W-3L 430 pins are re-expressed: "unestablished renders open" is the new all-actions pin; "established starts closed" has no successor because nothing folds any more — correct, there is no closed state left to pin. The text assertions resolve against the JSX: `… · seized <b>0.65625 weETH</b> · bonus realized{" "}<b>—</b> / configured <b>500 bps</b>` reads `bonus realized — / configured 500 bps` after Playwright's whitespace normalisation. `[data-tone="crit"]` still counts 3 in the ledger (the line carries no `data-tone`); the table's "no `$`" assertion is unaffected.

### I3 — every notice from the lib ✅ closed

Byte-for-byte, from the diff's own `-` and `+` lines:

| Sentence | Old (component) | New (lib) | Same? |
|---|---|---|---|
| Drop, cross-engine | `` `since_block ${String(sinceBlock)} dropped: ${SINCE_BLOCK_IMPOSSIBILITY}` `` | `sinceBlockDroppedNotice`, `candidate === null` arm — identical template | ✅ |
| Drop, another engine | `` `since_block ${String(sinceBlock)} dropped: block heights are chain-scoped, and ${candidate} lives on a different chain` `` | the other arm — identical template | ✅ |
| Not a block number | `` `"${trimmed.slice(0, 32)}" is not a block number, so nothing was requested` `` | `notABlockNumberNotice(draft)` with `draft = trimmed` — identical template, the 32-character slice kept | ✅ |
| End of the feed | `"end of the filtered feed"` twice (the foot; the tile's sub) | `END_OF_FEED`, read by both | ✅ one home |

The state machine did not move: re-running the first review's mechanical check against `091beb7` (the old `FeedSurface` body vs `ActivitySurface`, comments stripped) yields exactly three differences — the function name and the two `setNotice(…)` expressions. `restartWalk()` still runs before `setNotice` in `switchEngine`, so the notice survives the restart's `setNotice(null)`; `sinceBlock` is narrowed non-null at the call. `SINCE_BLOCK_IMPOSSIBILITY` left the surface's imports and entered the lib's. The since-block e2e pin (`since_block 25635600 dropped`) keeps its target.

### Nothing else moved ✅

The six files carry only: the surface's import list, the two `setNotice` calls and the foot literal; the table's `LiquidationLine`, the restructured Type cell and its doc comment; two CSS rules and a comment; the lib's `ActivityLiquidation`, the three exports, `liquidationDetail`'s return shape and `END_OF_FEED` in `tilesFor`; the ledger pin's extract assertions and one new e2e pin; the unit extract assertions and one new unit pin. `web/lib` unit count 13 → 14.

### New Minors (non-blocking)

- **M11 — The wire's `note` is the extract's one remaining hover-only field.** `FeedList` printed it as visible text (`detailNote`); it is now `title={detail.note}` on the line — unreachable by keyboard and on touch. It matters most on the DM rows: the page reads `bonus realized — / configured —` while the wire carries each seizure's own realized bonus in the contract's 100e18 denomination, and the note is the only sentence that says so. The ruling's purpose (no figure and no dash behind a hover) is met and pinned, so this does not hold I1 open; the cost of printing it is height (the Aave note is ~330 characters, about eight lines at 44ch). Options for the controller: print it as the line's last clause at a wider measure; or print the per-seizure `bonus` verbatim with its denomination named, which removes the DM rows' need for the sentence. Either way add `toContainText("never estimated")` to the all-actions pin.
- **M12 — An extract amount with no decimals prints as a bare integer.** `debt_decimals ?? undefined` makes `renderNullableDecimal` return the wire string verbatim, unparsed and untagged, whereas the row's Amount cell tags the same condition `raw units`. Carried over from `FeedList` unchanged and exercised by no fixture (every extract carries 6 or 18), so not a regression — but it is the one place on the page where an unscaled integer can print without saying so. One clause in `liquidationDetail()` (append `RAW_UNITS_TAG` when decimals are null) and a unit pin would close it.
- Nit: `.detail` and `.detail b` set their own colours, so an extract inside an untimed-tail liquidation row would not dim with its row (`.tbl tr.dim td` colours the cell, the span overrides). No fixture has a liquidation in the tail.

Standing from the first review, unchanged by this round: M1 (the loading headline's `refused` tone), M3 (the refusal code printed twice), M4 (`data-state` precedence comment), M5 (the legacy market by wire id in the engine-scoped order note and in the moved drop notice — the report leaves it as recorded), M6 (provenance in the tx hover), M7–M10. The report's new register concern (a liquidation row is taller and the Type column widens at 44ch) belongs to Task 11/12's width and read-through gates.

### Not verified

- The e2e contract (15 pins) and the shared specs were not run; "fails on 6522c8e" is a static argument from the absence of the ids and exports at that commit, not an observed red.
- The report's gate claims for this round (unit 892, `tsc`, `eslint`, `lint:css`, scope gate) were not re-run.
- The rendered height/width of the stacked extract at 1280/1440 and 390, and both themes (Task 11/12).
