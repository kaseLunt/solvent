### Task 4: `activity-view` and the Activity page

**Files:**
- Create: `web/lib/activity-view.ts`, `web/tests/unit/activity-view.spec.ts`, `web/app/feed/ActivitySurface.tsx`, `ActivityControls.tsx`, `ActivityTable.tsx`, `ActivityDrawer.tsx`, `activity.module.css`, `web/tests/e2e/activity.spec.ts`
- Modify: `web/app/feed/page.tsx` (title "Activity"), `web/app/feed/FeedLiveStrip.tsx` (kit classes; test id `activity-live`)
- Delete: `web/app/feed/FeedSurface.tsx`, `FeedList.tsx`, `feed.module.css`, `web/tests/e2e/feed.spec.ts` (after re-expression)

**Interfaces:**
- Consumes: `fetchFeedPage`, `FeedScope`, `feedOrderMode`, `FeedChainEvent`, `EVENT_DISPLAY_TYPES`, `EventDisplayType`, `FEED_ENGINES`, `FeedEngine`, `SINCE_BLOCK_IMPOSSIBILITY` (`lib/feed-data.ts`); `feedAmount`, `feedTagTone`, `feedRowKey`, `renderBps`, `feedTakeaway`, `liquidationEstablished`, `RAW_UNITS_TAG` (`lib/feed-view.ts`); `useCursorPages`, `CursorPage` (`lib/pagination.ts`); `usePosture` (`lib/posture.ts`); `readWirePopulation`; kit `VerdictHeader`, `KpiTile`, `KitTable`, `StatusPill`, `SectionHead`, `Drawer`.
- Produces:

```ts
// web/lib/activity-view.ts
export type ActivityState = "loading" | "ok" | "refused" | "error" | "exhausted";
export interface ActivityInput {
  readonly rows: readonly FeedChainEvent[]; readonly mode: ReturnType<typeof feedOrderMode>; readonly hasMore: boolean; readonly loading: boolean;
  readonly engine: FeedEngine | null; readonly view: "all" | "ledger"; readonly types: readonly EventDisplayType[]; readonly sinceBlock: number | null;
  readonly envelope: { readonly filter: { readonly engine: string | null; readonly types: readonly string[] | null; readonly since_block: number | null }; readonly limit: number } | null;
  readonly refusal: { readonly status: number; readonly code: string | null; readonly message: string } | null; readonly error: string | null;
  readonly valueDecimals: Readonly<Record<string, number>>;
}
export interface ActivityRow { readonly key: string; readonly dim: boolean; readonly when: string; readonly engine: string; readonly type: EventDisplayType; readonly tone: "crit" | "info"; readonly account: string; readonly amount: string; readonly unit: string; readonly tx: string | null }
export interface ActivityView {
  readonly state: ActivityState; readonly kicker: string; readonly headline: LabHeadline; readonly chips: LabChip[];
  readonly tiles: { readonly rows: { value: string; sub: string }; readonly liquidations: { value: string; sub: string } };
  readonly rows: readonly ActivityRow[]; readonly emptyText: string; readonly orderNote: string; readonly doctrine: readonly string[];
}
export function deriveActivityView(input: ActivityInput): ActivityView;
```

  Rules: kicker "Activity · cross-engine" or "Activity · {engineName(engine)}"; headline emphasis `feedTakeaway(rows, mode, hasMore)`, tone `ok` (refused: `refused` with the refusal's own words "Page refused · {code}: {message}"; error: `refused` "Page fetch failed: {message}"); dek "The live strip and the paged record never blend."; chips Scope · View ("all actions" / "liquidations ledger") · Order (`mode`) · Rows (`groupInt(rows.length)`) · Filter echo (today's echo string, `readWirePopulation` on the integers, only when the envelope is present); tiles: rows loaded (sub "end of the filtered feed" when `!hasMore`, else "more available") and liquidations = rows with `type === "liquidation"` (sub `mode`); rows from `FeedList`'s logic: `when` = the block time as today or the block number when null (dim row = the untimed tail); `amount`/`unit` from `feedAmount(event, { decimals: valueDecimals[event.engine] })` (read `FeedAmount`'s union and print each arm as `FeedList` does today; `RAW_UNITS_TAG` when unscaled); `orderNote` = today's two order sentences chosen by `mode`; `emptyText` = today's `empty`/`emptyExhausted` words by state; doctrine = today's intro paragraph, the "History: recorded chain actions" note, the method line and the forensics note, verbatim.

- [ ] **Step 1: Unit pins** with `DEMO_FEED_PAGE_1`: 50 rows, the last two `dim` with `when` = the block number; 3 rows tone crit of type liquidation; the liquidations tile "3"; the rows tile "50" with sub "more available"; headline equals `feedTakeaway(...)`; a refusal input → tone refused and the refusal words; `exhausted` when `!hasMore && rows.length === 0` with the "real answer" sentence. Run → fails.
- [ ] **Step 2: Implement `activity-view.ts`.**
- [ ] **Step 3: The page.** `ActivitySurface` keeps `FeedSurface`'s state machine and hooks verbatim (the `isCurrent` epoch law, `restartWalk`, `switchEngine`'s since-block drop with its notice, `applySinceBlock`) — move them, do not rewrite; then `deriveActivityView(...)` → `VerdictHeader` (`activity-verdict`, drawer button `activity-drawer`), two `KpiTile`s, `FeedLiveStrip` (id `activity-live`), `ActivityControls` (kit ghost buttons with `aria-pressed`, ids per the contract; the since-block input keeps its `inputMode="numeric"` and Enter handling), the notice/refusal/error strips restyled with kit classes (ids `activity-notice`, `activity-refusal` + `activity-restart`, `activity-error`), `ActivityTable` = `KitTable` (columns When · Engine · Type · Account · Amount · Tx; `StatusPill` crit for liquidation, `mono` for account/tx; `dim` rows; `emptyText` from the view), the foot (rows loaded, filter echo chips are in the header now → the foot keeps only `activity-load-more` / "end of the filtered feed"), `ActivityDrawer`. Root `activity-surface` with `data-state`/`data-mode`.
- [ ] **Step 4: Contract e2e** (`activity.spec.ts`; route `**/v1/events*` → `DEMO_FEED_PAGE_1` for the first page and `FEED_CROSS_PAGE_2` for the cursor; `**/v1/stream**` abort or the existing SSE mock the old spec used — read `feed.spec.ts` for how the live strip was fed): cold load ok with 50 rows; the two untimed rows dim and last; the ledger view pins the type to liquidation (3 rows) and the chips say so; a since-block on cross-engine is impossible (the note); switching engines drops the since-block with the notice; a 400 page refusal renders `activity-refusal` and restart works; load more appends and the rows tile counts; the drawer. Re-express `feed.spec.ts`'s 14 pins and the Activity pins in p1a/p1b/r1 (grep `feed`), table in the report; delete `feed.spec.ts`.
- [ ] **Step 5: Gates** as Task 3. **Step 6: Commit** (lib+pins; page+contract) with messages in the same shape as Task 3's.

