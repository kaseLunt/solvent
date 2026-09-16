### Task 11: The Inspector page — landing, surface, sections, drawer

**Integrator builds this personally** (visual; spec §9.2). The mockup is `docs/specs/2026-09-15-ui-mockups/pages-console.html:210-276`; the CSS is the kit's. Every element below names its data source in the view model (Task 9) and its `data-testid` from the contract table.

**Files:**
- Modify: `web/app/inspector/page.tsx` (renders `InspectorLanding`), `web/app/inspector/[addr]/page.tsx` (`key={addr}`)
- Create: `web/app/inspector/InspectorLanding.tsx`
- Rewrite: `web/app/inspector/[addr]/InspectorSurface.tsx`
- Create: `web/app/inspector/[addr]/{InspectorTiles,BackingTable,TrustCard,HistoryCard,ActivityTable,LegacyCard,StressTable,InspectorDrawer}.tsx`
- Rewrite: `web/app/inspector/inspector.module.css`
- The old `AddressEntry.tsx`, `InspectorPositionCard.tsx`, `InspectorHistory.tsx`, `InspectorActivity.tsx` stop being imported here; Task 12 deletes them together with their pins.

**Interfaces:**
- Consumes `useAddressLookup`, `useAddressActivity` (Task 8), `deriveInspectorView`, `InspectorView` (Task 9), `stressReading` (Task 7), `activityRows`, `activityTakeaway` (Task 7), `rememberLookup`, `useRecentLookups` (Task 1), the kit (`AddressField`, `TrustChecklist`, `Sparkline`, `VerdictHeader`, `KpiTile`, `ChartCard`, `KitTable`, `StatusPill`, `SectionHead`), `Drawer`, `useMetaConstants`, `humanUsdFull` (every account-level dollar figure on this page — never the Book's compact `humanUsd`), `humanPrice`, `humanAmount`, `formatUnits` (client), `groupDecimalString`, `renderBlockTime`, `displayHf`, `buildHistorySeries`.
- Produces the DOM contract in the test-id table; Task 12 pins it.

- [ ] **Step 1: The routes**

```tsx
// web/app/inspector/[addr]/page.tsx — unchanged except the key: a new address is a new surface, so no state can survive a navigation.
export default async function InspectorAddressPage({ params }: RouteParams) {
  const { addr } = await params;
  return <InspectorSurface key={addr} addr={addr} />;
}
```

```tsx
// web/app/inspector/page.tsx
import type { Metadata } from "next";
import { InspectorLanding } from "./InspectorLanding";

export const metadata: Metadata = { title: "Inspector" };

export default function InspectorPage() {
  return <InspectorLanding />;
}
```

- [ ] **Step 2: The landing**

```tsx
// web/app/inspector/InspectorLanding.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddressField } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { rememberLookup, useRecentLookups } from "@/lib/recent-lookups";
import { truncateAddress } from "@/lib/format";
import styles from "./inspector.module.css";

/** /inspector — the question, the field, and the reader's own recent lookups (browser-local). */
export function InspectorLanding() {
  const router = useRouter();
  const recents = useRecentLookups();
  return (
    <div className={styles.landing} data-testid="inspector-landing">
      <p className={kit.kick}>Inspector</p>
      <h1 className={kit.h1}>Is this address at risk?</h1>
      <p className={kit.dek}>
        Paste any 0x address. You get one sentence — how close it is to its borrow cap and why — with every number
        traceable to the inputs behind it. Anything the service cannot defend renders as a named refusal, never a guess.
      </p>
      <div className={styles.toolbar}>
        <AddressField
          testId="inspector-address"
          hint="any 0x address"
          onInspect={(address) => {
            rememberLookup(address);
            router.push(`/inspector/${address}`);
          }}
        />
      </div>
      {recents.length > 0 && (
        <>
          <p className={styles.note}>Recent lookups · stored in this browser only</p>
          <ul className={styles.recent} data-testid="inspector-recent">
            {recents.map((address) => (
              <li key={address}>
                <Link href={`/inspector/${address}`} className={kit.addr} title={address}>
                  {truncateAddress(address)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: The surface**

```tsx
// web/app/inspector/[addr]/InspectorSurface.tsx
"use client";

// One address, every number defended (spec 2026-09-15 §5.3). The view model
// decides everything printed; this file only places it. All ten states render
// into the same frame — the toolbar, the verdict header, the tiles, the grid.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddressField, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useAddressLookup } from "@/lib/address-lookup";
import { deriveInspectorView } from "@/lib/inspector-view";
import { useMetaConstants } from "@/lib/meta";
import { rememberLookup } from "@/lib/recent-lookups";
import styles from "../inspector.module.css";
import { ActivityTable } from "./ActivityTable";
import { BackingTable } from "./BackingTable";
import { HistoryCard } from "./HistoryCard";
import { InspectorDrawer } from "./InspectorDrawer";
import { InspectorTiles } from "./InspectorTiles";
import { LegacyCard } from "./LegacyCard";
import { StressTable } from "./StressTable";
import { TrustCard } from "./TrustCard";

export function InspectorSurface({ addr }: { addr: string }) {
  const router = useRouter();
  const reading = useAddressLookup(addr);
  const meta = useMetaConstants();
  const view = deriveInspectorView(reading, meta.constants);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const found = reading.lookup.phase === "ready" && reading.lookup.value.outcome === "found";
  return (
    <div className={styles.page} data-testid="inspector-surface" data-state={view.state} aria-busy={view.state === "loading" ? "true" : undefined}>
      <div className={styles.toolbar}>
        <AddressField
          testId="inspector-address"
          initial={reading.valid ? addr : ""}
          hint="any 0x address"
          secondary={view.cash === null ? undefined : { href: "#stress", label: "Stress this address →" }}
          onInspect={(address) => {
            rememberLookup(address);
            router.push(`/inspector/${address}`);
          }}
        />
      </div>
      <VerdictHeader
        testId="inspector-verdict"
        kicker={view.kicker}
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={
          found ? (
            <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setDrawerOpen(true)} data-testid="inspector-drawer">
              Inputs · Calculation · Provenance
            </button>
          ) : undefined
        }
      />
      {view.state !== "invalid" && (
        <>
          <InspectorTiles view={view} />
          <div className={`${kit.grid} ${kit.gridRail}`}>
            <BackingTable view={view} onPrices={() => setDrawerOpen(true)} />
            <TrustCard view={view} />
          </div>
          <HistoryCard view={view} reading={reading} />
          <ActivityTable key={addr} addr={addr} valid={reading.valid} />
          {view.legacy !== null && <LegacyCard position={view.legacy} reading={reading} view={view} />}
          {view.cash !== null && <StressTable reading={reading} view={view} />}
          <InspectorDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} view={view} reading={reading} />
        </>
      )}
    </div>
  );
}
```

`VerdictHeader` already stamps `data-variant={tone}` on its `<header>` (`components/kit/VerdictHeader.tsx:30`); the page's own state rides `data-state` on the surface root, which is what the contract pins. No kit change is needed here.

- [ ] **Step 4: The five tiles**

```tsx
// web/app/inspector/[addr]/InspectorTiles.tsx
import { formatUnits } from "@solvent/client";
import { KpiTile, type Tone } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { groupDecimalString } from "@/lib/book-format";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";

const STATUS_WORD = { liquidatable: "Liquidatable", near: "Near cap", healthy: "Healthy", refused: "Not computed", unknowable: "Not computed" } as const;
const STATUS_TONE: Record<keyof typeof STATUS_WORD, Tone> = { liquidatable: "crit", near: "warn", healthy: "ok", refused: "refused", unknowable: "refused" };

/** Debt · Borrow cap · Room · Collateral · Status — the same five in every state; only the readings change. */
export function InspectorTiles({ view }: { view: InspectorView }) {
  const { cash, refusedTiles, decimals } = view;
  const pending = view.state === "loading";
  const money = (v: bigint | null): string => (v === null ? "—" : humanUsdFull(v, decimals));
  const notComputed = view.state === "loading" ? "" : "not computed";
  const exactDebt = cash?.debt == null ? null : groupDecimalString(formatUnits(cash.debt.toString(), decimals, { trim: false }));
  const roomTone: Tone = cash === null || refusedTiles ? "refused" : cash.status === "liquidatable" ? "crit" : cash.status === "near" ? "warn" : "neutral";
  return (
    <div className={`${kit.kpis} ${kit.kpis5}`}>
      <KpiTile
        testId="inspector-kpi-debt"
        label="Debt"
        value={refusedTiles ? "—" : money(cash?.debt ?? null)}
        sub={refusedTiles ? (cash?.debt != null ? `last readable ${money(cash.debt)} · ${notComputed}` : notComputed) : `USD · ${exactDebt ?? "—"} exact`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile testId="inspector-kpi-cap" label="Borrow cap" value={refusedTiles ? "—" : money(cash?.cap ?? null)} sub={refusedTiles ? notComputed : "Σ collateral × per-asset LTV"} tone={refusedTiles ? "refused" : "neutral"} pending={pending} />
      <KpiTile testId="inspector-kpi-room" label="Room" value={refusedTiles ? "—" : money(cash?.room ?? null)} sub={refusedTiles ? notComputed : `${cash?.roomPercent ?? "—"} of cap`} tone={roomTone} pending={pending} />
      <KpiTile
        testId="inspector-kpi-collateral"
        label="Collateral"
        value={refusedTiles ? "—" : money(cash?.collateral ?? null)}
        sub={refusedTiles ? notComputed : `${String(view.table?.legs.length ?? 0)} asset${(view.table?.legs.length ?? 0) === 1 ? "" : "s"} · by asset ↓`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-status"
        label="Status"
        value={cash === null ? "—" : STATUS_WORD[cash.status]}
        sub="strict rule: debt > cap"
        tone={cash === null ? "refused" : STATUS_TONE[cash.status]}
        pending={pending}
      />
    </div>
  );
}
```

- [ ] **Step 5: What backs this debt**

```tsx
// web/app/inspector/[addr]/BackingTable.tsx
import { ChartCard, KitTable, StatusPill, type KitRow } from "@/components/kit";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";
import styles from "../inspector.module.css";

const COLUMNS = [
  { key: "asset", header: "Asset" },
  { key: "amount", header: "Amount", align: "right" as const },
  { key: "price", header: "Price", align: "right" as const },
  { key: "value", header: "Value", align: "right" as const },
  { key: "ltv", header: "LTV", align: "right" as const },
  { key: "contribution", header: "Counts toward cap", align: "right" as const },
];

export function BackingTable({ view, onPrices }: { view: InspectorView; onPrices: () => void }) {
  const { table, cash, decimals, boundary } = view;
  const money = (v: bigint | null): string => (v === null ? "—" : humanUsdFull(v, decimals));
  const oldest = view.cashWire === null ? null : Math.max(...view.cashWire.price_inputs.map((i) => i.age_seconds ?? 0));
  const rows: KitRow[] =
    table === null
      ? []
      : [
          ...table.legs.map((leg): KitRow => ({
            key: leg.asset,
            testId: `inspector-backing-${leg.symbol}`,
            dim: leg.counted === "not-counted",
            cells: {
              asset: leg.symbol,
              amount: leg.amount ?? "—",
              price:
                leg.price === null ? (
                  "—"
                ) : leg.priceVerdict !== null && leg.priceVerdict !== "fresh" ? (
                  <>
                    {leg.price} <StatusPill tone={leg.priceVerdict === "stale" ? "warn" : "crit"}>{leg.priceVerdict}</StatusPill>
                  </>
                ) : (
                  leg.price
                ),
              value: money(leg.value),
              ltv: <span title="counts toward cap ÷ value — the LTV the engine applied to this asset">{leg.ltv ?? "—"}</span>,
              contribution: money(leg.contribution),
            },
          })),
          {
            key: "cap",
            testId: "inspector-backing-cap",
            cells: { asset: <span className={styles.capLabel}>Borrow cap</span>, amount: "", price: "", value: money(cash?.collateral ?? null), ltv: "", contribution: <b>{money(cash?.cap ?? null)}</b> },
          },
        ];
  return (
    <ChartCard
      title="What backs this debt"
      testId="inspector-backing-card"
      link={table === null ? undefined : { onClick: onPrices, label: "Price inputs →" }}
      finding={
        table === null
          ? view.refusedTiles && view.state !== "loading"
            ? "Not computed."
            : "Loading…"
          : `Cap = Σ (collateral value × that asset's LTV)${oldest === null ? "" : ` · prices as of ${String(oldest)}s ago`}`
      }
    >
      {table === null ? (
        <p className={styles.note}>{view.state === "no-position" ? "No Cash position in this batch — nothing to back." : view.state === "loading" ? "Loading…" : "Not computed."}</p>
      ) : (
        <>
          <KitTable testId="inspector-backing" columns={COLUMNS} rows={rows} />
          {table.capAgrees === false && (
            <p className={`${styles.note} ${styles.dim}`}>
              The legs sum to {money(table.sumContribution)}; the engine's cap is {money(cash?.cap ?? null)} — the engine's figure leads.
            </p>
          )}
          {boundary !== null && (
            <p className={styles.boundary} data-testid="inspector-boundary" data-kind={boundary.kind} title={"title" in boundary ? boundary.title : undefined}>
              {boundary.kind === "boundary" && <>Boundary: {boundary.sentence}</>}
              {boundary.kind === "breached" && "Already past the boundary: the current prices are below the level that keeps this account healthy."}
              {boundary.kind === "no-price-path" && boundary.sentence}
              {boundary.kind === "absent" && "No boundary price was published for this position."}
              {boundary.kind === "unreadable" && `Boundary published but unreadable (${boundary.fields.join(", ")}) — not read.`}
              {boundary.kind === "contradictory" && `Boundary withheld: ${boundary.detail}.`}
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 6: Trust**

```tsx
// web/app/inspector/[addr]/TrustCard.tsx
import { ChartCard, Sparkline, TrustChecklist } from "@/components/kit";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import type { InspectorView } from "@/lib/inspector-view";
import styles from "../inspector.module.css";

export function TrustCard({ view }: { view: InspectorView }) {
  const { trust, room } = view;
  const nearLine = Number(NEAR_LINE_TENTHS) / 10;
  return (
    <ChartCard title="Trust" testId="inspector-trust-card" link={{ href: "/proof", label: "Evidence →" }}>
      {trust === null ? (
        <p className={styles.note}>{view.state === "loading" ? "Loading…" : "Not computed."}</p>
      ) : (
        <TrustChecklist items={trust} testId="inspector-trust" />
      )}
      <p className={`${styles.note} ${styles.sparkHead}`}>
        {room === null ? "History · no Cash history for this account" : `History · room % over the last ${String(room.points.length)} batches`}
      </p>
      {room !== null && (
        <div className={styles.spark} data-testid="inspector-room-spark">
          <Sparkline
            values={room.values}
            pointTitles={room.titles}
            referenceValue={nearLine}
            referenceLabel="10% line"
            height={54}
            label="room as a percent of the borrow cap, per batch; gaps are batches the engine refused, withheld or never wrote"
            domain={{ min: 0, max: Math.max(nearLine + 2, ...room.values.filter((v): v is number => v !== null)) }}
          />
        </div>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 7: History, Activity, Legacy, Stress**

```tsx
// web/app/inspector/[addr]/HistoryCard.tsx
import { ChartCard, SectionHead, Sparkline } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { AddressReading } from "@/lib/address-lookup";
import { buildHistorySeries } from "@/lib/history-series";
import type { InspectorView } from "@/lib/inspector-view";
import { LEGACY } from "@/lib/inspector-position";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import styles from "../inspector.module.css";

const n = (v: number): string => v.toLocaleString("en-US");

export function HistoryCard({ view, reading }: { view: InspectorView; reading: AddressReading }) {
  const { room, streak } = view;
  const history = reading.history;
  const vantage = view.historyBatchId !== null && view.batchId !== null && view.historyBatchId !== view.batchId ? ` · history as of batch ${n(view.historyBatchId)}, position as of batch ${n(view.batchId)}` : "";
  const legacyEngine = history.phase === "ready" && history.value.outcome === "found" ? (history.value.response.engines.find((e) => e.engine === LEGACY) ?? null) : null;
  const legacySeries = legacyEngine === null ? null : buildHistorySeries(legacyEngine);
  const finding =
    history.phase === "loading"
      ? "Loading history…"
      : history.phase === "error"
        ? `History unavailable: ${history.message}`
        : room === null
          ? "No Cash history for this account in the covered window."
          : streak !== null && streak.batches >= 2
            ? `Within 10% of its cap for the last ${String(streak.batches)} batches${vantage}`
            : `Room has stayed above the 10% line in the newest batch${vantage}`;
  return (
    <section data-testid="inspector-history">
      <SectionHead title="History" qualifier="room % across batches · gaps drawn as gaps" />
      <div className={kit.grid}>
        <ChartCard title="Room under the borrow cap" finding={finding}>
          {room !== null && (
            <Sparkline
              values={room.values}
              pointTitles={room.titles}
              referenceValue={Number(NEAR_LINE_TENTHS) / 10}
              referenceLabel="10% line"
              height={140}
              label="room as a percent of the borrow cap, per batch"
              xLabels={{ start: `batch ${n(room.points[0]?.batchId ?? 0)}`, end: `batch ${n(room.newest?.batchId ?? 0)}` }}
              newestLabel={room.newest?.display}
            />
          )}
        </ChartCard>
        {legacySeries !== null && (
          <ChartCard title="Legacy · Aave v3 health factor" finding="Judged by its own health factor; liquidatable strictly below 1.0" testId="inspector-history-legacy">
            <Sparkline values={legacySeries.values} pointTitles={legacySeries.titles} referenceValue={1} referenceLabel="1.0" height={140} label="health factor per batch (legacy Aave v3 market)" />
          </ChartCard>
        )}
      </div>
      <p className={styles.dim}>Cash room per batch is the engine's own cap ÷ borrowings for that batch. A refused, withheld or missing batch is a gap; the line never draws across it.</p>
    </section>
  );
}
```

```tsx
// web/app/inspector/[addr]/ActivityTable.tsx
"use client";
import { KitTable, SectionHead, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { activityRows, activityTakeaway } from "@/lib/activity-rows";
import { useAddressActivity } from "@/lib/address-lookup";
import styles from "../inspector.module.css";

const COLUMNS = [
  { key: "when", header: "When" },
  { key: "action", header: "Action" },
  { key: "asset", header: "Asset" },
  { key: "amount", header: "Amount", align: "right" as const },
  { key: "tx", header: "Tx", align: "right" as const },
];

/** Mounted with key={addr} by the surface: a fresh mount can never hold another address's rows. */
export function ActivityTable({ addr, valid }: { addr: string; valid: boolean }) {
  const activity = useAddressActivity(addr, valid);
  const rows = activityRows(activity.rows);
  const timed = rows.filter((r) => r.timed).length;
  const kitRows: KitRow[] = rows.map((r) => ({
    key: r.key,
    dim: !r.timed,
    cells: {
      when: <span title={r.timed ? undefined : "no custodied header time yet — the block number stands in"}>{r.when}</span>,
      action: r.detail === null ? r.action : (<>{r.action}<span className={styles.detail}>{r.detail}</span></>),
      asset: r.asset,
      amount: <span title={r.amountTitle ?? undefined}>{r.amount}</span>,
      tx: r.tx.url === null ? <span className={kit.addr}>{r.tx.short}</span> : <a className={kit.addr} href={r.tx.url} rel="noreferrer" target="_blank">{r.tx.short}</a>,
    },
  }));
  return (
    <section>
      <SectionHead title="Activity" qualifier="this account's chain actions · custodied times, newest first" />
      <KitTable testId="inspector-activity" columns={COLUMNS} rows={kitRows} emptyText={activity.loading ? "Loading activity…" : activity.error !== null ? `Activity unavailable: ${activity.error.message}` : "No custodied actions for this account."} />
      {rows.length > 0 && <p className={styles.note} data-testid="inspector-activity-takeaway">{activityTakeaway(timed, rows.length - timed, activity.hasMore)}</p>}
      {activity.hasMore && (
        <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={activity.loadMore} disabled={activity.loading} data-testid="inspector-activity-more">
          Load more
        </button>
      )}
    </section>
  );
}
```

```tsx
// web/app/inspector/[addr]/LegacyCard.tsx
import type { RefinedPosition } from "@solvent/client";
import { KpiTile, StatusPill } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { AddressReading } from "@/lib/address-lookup";
import { displayHf } from "@/lib/history-series";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";
import { isWireDecimal } from "@/lib/wireGuard";
import styles from "../inspector.module.css";

const money = (v: string | null, decimals: number): string => (v !== null && isWireDecimal(v) ? humanUsdFull(BigInt(v), decimals) : "—");

/** Only when the address holds a legacy Aave v3 position. HF-based, labeled legacy, never beside a Cash sum. */
export function LegacyCard({ position }: { position: RefinedPosition; reading: AddressReading; view: InspectorView }) {
  const verdict = position.liquidation_verdict;
  const hf = position.health_factor === null ? null : displayHf(position.health_factor);
  return (
    <details className={styles.legacy} data-testid="inspector-legacy">
      <summary>Legacy · Aave v3 market position</summary>
      <div className={`${kit.kpis} ${kit.kpis4} ${styles.legacyBody}`}>
        <KpiTile label="Health factor" value={hf ?? "—"} sub="liquidatable strictly below 1.0" tone={verdict === "liquidatable" ? "crit" : verdict === "unknowable" ? "refused" : "neutral"} />
        <KpiTile label="Collateral" value={money(position.total_collateral_base, position.value_decimals)} sub="legacy market · own unit" />
        <KpiTile label="Debt" value={money(position.total_debt_base, position.value_decimals)} sub="never added to Cash" />
        <KpiTile label="Status" value={verdict === "liquidatable" ? "Liquidatable" : verdict === "unknowable" ? "Not computed" : "Healthy"} sub={position.flags.includes("stale_price") ? "stale price input" : "own health factor"} tone={verdict === "liquidatable" ? "crit" : verdict === "unknowable" ? "refused" : "ok"} />
      </div>
      {position.flags.includes("stale_price") && <p className={styles.note}><StatusPill tone="warn">stale price</StatusPill> a price input behind this position is older than its budget; the figure is computed and flagged.</p>}
      <p className={styles.dim}>The legacy market is judged by its own health factor. The two books are never added together.</p>
    </details>
  );
}
```

```tsx
// web/app/inspector/[addr]/StressTable.tsx
import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import type { AddressReading } from "@/lib/address-lookup";
import { stressReading, type StressSide } from "@/lib/address-stress";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";
import styles from "../inspector.module.css";

const COLUMNS = [
  { key: "scenario", header: "Scenario" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];
const days = (seconds: number): string => `${String(Math.round(seconds / 86_400))}d`;

export function StressTable({ reading, view }: { reading: AddressReading; view: InspectorView }) {
  const { decimals } = view;
  const room = (side: StressSide | null): string => (side === null || side.room === null ? "—" : humanUsdFull(side.room, decimals));
  const stress = reading.stress;
  const result = stress.phase === "ready" ? stressReading(stress.value, reading.address) : null;
  const rows: KitRow[] =
    result === null || result.kind !== "rows"
      ? []
      : result.rows.map((r) => ({
          key: r.id,
          dim: !r.applicable,
          cells: {
            scenario: r.projection === null ? r.label : (<>{r.label} <StatusPill tone="projection">PROJECTION</StatusPill></>),
            before: room(r.before),
            after:
              r.projection !== null
                ? r.projection.map((h) => `${days(h.seconds)}: ${h.extraInterest === null ? "—" : `+${humanUsdFull(h.extraInterest, decimals)}`} interest`).join(" · ")
                : room(r.after),
            flips: !r.applicable ? (r.reason ?? "not applicable") : r.flips === null ? (<StatusPill tone="refused">Cannot say</StatusPill>) : r.flips ? (<StatusPill tone="crit">Yes</StatusPill>) : r.projection !== null ? (r.projection.some((h) => h.verdict === "liquidatable") ? <StatusPill tone="warn">Within {days(r.projection.find((h) => h.verdict === "liquidatable")?.seconds ?? 0)}</StatusPill> : "No") : "No",
          },
        }));
  const empty =
    stress.phase === "loading" ? "Running the committed scenarios…" : stress.phase === "error" ? `Stress unavailable: ${stress.message}` : result?.kind === "withheld" ? `Stress withheld: ${result.cause}.` : result?.kind === "no-position" ? "No position to stress." : "No scenarios.";
  return (
    <section id="stress" data-testid="inspector-stress">
      <SectionHead title="Stress this address" qualifier="the committed scenarios, applied to this account · shocked figures are projections, not readings" link={{ href: "/lab", label: "Open Scenarios →" }} />
      <KitTable testId="inspector-stress-table" columns={COLUMNS} rows={rows} emptyText={empty} />
      <p className={styles.dim}>Before and after are the engine's own cap and debt under each shock; a rate step is a delta-only projection with prices held flat.</p>
    </section>
  );
}
```

- [ ] **Step 8: The drawer**

```tsx
// web/app/inspector/[addr]/InspectorDrawer.tsx
"use client";
import Link from "next/link";
import { formatUnits } from "@solvent/client";
import { Drawer } from "@/components/Drawer";
import type { AddressReading } from "@/lib/address-lookup";
import { groupDecimalString } from "@/lib/book-format";
import { formatBlock, renderBlockTime } from "@/lib/format";
import { humanPrice, humanUsdFull } from "@/lib/human-price";
import { sourceDisplay, symbolFor } from "@/lib/inspector-position";
import type { InspectorView } from "@/lib/inspector-view";
import { plainCause } from "@/lib/refusal-phrasebook";
import { isWireDecimal } from "@/lib/wireGuard";
import styles from "../inspector.module.css";

const exact = (v: string | null, decimals: number): string => (v !== null && isWireDecimal(v) ? groupDecimalString(formatUnits(v, decimals, { trim: false })) : "—");

/** Inputs · Calculation · Provenance — the formula with this account's numbers substituted, every input's source and age, the exact wire values. */
export function InspectorDrawer({ open, onClose, view, reading }: { open: boolean; onClose: () => void; view: InspectorView; reading: AddressReading }) {
  const p = view.cashWire;
  const cash = view.cash;
  const money = (v: bigint | null): string => (v === null ? "—" : humanUsdFull(v, view.decimals));
  const batch = reading.lookup.phase === "ready" ? reading.lookup.value.response.batch : null;
  const servedAt = reading.lookup.phase === "ready" ? reading.lookup.value.response.served_at : null;
  return (
    <Drawer open={open} onClose={onClose} title="Inputs · Calculation · Provenance">
      <div className={styles.method} data-testid="inspector-drawer-body">
        {p === null || cash === null ? (
          <p>No Cash position in this batch; nothing to calculate.</p>
        ) : (
          <>
            <h3>Calculation</h3>
            <p>
              Borrow cap = Σ (collateral value × LTV) ={" "}
              {view.table?.legs.map((l) => `${money(l.value)} × ${l.ltv ?? "—"}`).join(" + ")} = <b>{money(cash.cap)}</b>
            </p>
            <p>
              Room = cap − debt = {money(cash.cap)} − {money(cash.debt)} = <b>{money(cash.room)}</b> ({cash.roomPercent ?? "—"} of cap)
            </p>
            <p>
              Verdict: debt {cash.debt !== null && cash.cap !== null && cash.debt > cash.cap ? ">" : "≤"} cap → <b>{cash.verdict}</b> (the engine's strict boolean, <code>debt &gt; maxBorrowLT</code>; equality is healthy)
            </p>
            {cash.refusal !== null && <p>Refused: {plainCause(cash.refusal.code, cash.refusal.detail ?? undefined)} · <code>{cash.refusal.code}</code></p>}
            <h3>Inputs</h3>
            <ul>
              {p.price_inputs.map((i) => (
                <li key={i.asset}>
                  {symbolFor(p, i.asset)} · {sourceDisplay(i.source)} (<code>{i.source}</code>) · {i.provenance} ·{" "}
                  {i.value !== null && i.decimals !== null && isWireDecimal(i.value) ? humanPrice(BigInt(i.value), i.decimals) : "—"} · {i.age_seconds === null ? "age unknown" : `${String(i.age_seconds)}s`} · {i.verdict}
                  {i.block_number === null ? "" : ` · block ${formatBlock(i.block_number)}`}
                </li>
              ))}
            </ul>
            <p>
              As of: balances block {formatBlock(p.as_of.balances_block)} · params block {formatBlock(p.as_of.params_block)} · sweep block{" "}
              {p.as_of.sweep_block === 0 ? "none (never swept)" : formatBlock(p.as_of.sweep_block)}
            </p>
            <h3>Provenance</h3>
            {batch !== null && (
              <p>
                Batch <code>{String(batch.id)}</code> computed <code>{batch.computed_at}</code> by <code>{batch.producer}</code>; served <code>{servedAt ?? ""}</code>.
              </p>
            )}
            {reading.params.phase === "ready" ? (
              reading.params.value.length === 0 ? (
                <p>No Cash parameter changes on record.</p>
              ) : (
                <ul>
                  {reading.params.value.map((change) => (
                    <li key={`${change.tx_hash}:${String(change.effective_log_index)}`}>
                      {change.fields.map((f) => `${f.name} ${f.value ?? "—"}${f.prior === null ? "" : ` (was ${f.prior})`} ${f.unit}`).join("; ")} · effective {renderBlockTime(change.effective_block, change.block_time)} · <code>{change.source_event}</code>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p>{reading.params.phase === "error" ? `Parameter timeline unavailable: ${reading.params.message}` : "Loading the parameter timeline…"}</p>
            )}
            <h3>Exact wire values</h3>
            <p>
              <code>borrowings</code> {exact(p.borrowings, p.value_decimals)} · <code>max_borrow_lt</code> {exact(p.max_borrow_lt, p.value_decimals)} · <code>collateral_value_usd</code>{" "}
              {exact(p.collateral_value_usd, p.value_decimals)}
            </p>
            <ul>
              {p.legs.map((l) => (
                <li key={l.asset}>
                  <code>{l.symbol ?? l.asset}</code> amount {exact(l.amount, l.decimals)} · value_usd {exact(l.value_usd, p.value_decimals)} · max_borrow_contribution {exact(l.max_borrow_contribution, p.value_decimals)}
                </li>
              ))}
            </ul>
          </>
        )}
        <p>
          Exact evidence and the reconcile receipt: <Link href="/proof">Verification</Link>. Every endpoint this page reads: <Link href="/developers">API</Link>.
        </p>
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 9: The page CSS (rewrite `web/app/inspector/inspector.module.css`)**

```css
/* The Inspector's page-local layout. Everything visual is the kit's; this file only places it. */
.page { display: flex; flex-direction: column; gap: 14px; }
.toolbar { margin-bottom: 8px; }
.landing { max-width: 860px; }
.note { color: var(--ink-2); font-size: var(--type-body); margin: 12px 0 0; }
.dim { color: var(--ink-3); font-size: var(--type-small); margin: 10px 0 0; }
.boundary { color: var(--ink-2); font-size: var(--type-body); margin: 12px 0 0; }
.boundary b { color: var(--ink); font-weight: var(--w-medium); }
.capLabel { color: var(--ink-2); }
.sparkHead { margin-top: 14px; }
.spark { height: 54px; margin-top: 8px; border-bottom: 1px solid var(--line); position: relative; }
.legacy { margin-top: 6px; }
.legacy summary { cursor: pointer; font-size: var(--type-h2); font-weight: var(--w-semibold); color: var(--ink); }
.legacyBody { margin-top: 12px; }
.recent { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 8px 0 0; padding: 0; list-style: none; }
.detail { display: block; color: var(--ink-3); font-size: var(--type-floor); white-space: normal; }
.method h3 { font-size: var(--type-card); font-weight: var(--w-semibold); margin: 18px 0 6px; color: var(--ink); }
.method p, .method li { font-size: var(--type-body); color: var(--ink-2); margin: 6px 0; }
.method b { color: var(--ink); font-weight: var(--w-medium); }
.method code { font-family: var(--mono); font-size: var(--type-mono-sm); color: var(--ink); }
```

- [ ] **Step 10: Build, look, iterate**

Run: `npm run typecheck && npm run lint && npm run lint:css && npm run build`, then start `npm run start` (port 3111), open `/inspector/0x7a3f19e2c8b4d0a6f1e3b5c7d9a2f4e6b8c0c21e` with the demo routes mocked — the quickest way is `node scripts/screenshot-pages.mjs <out> inspector` once Task 13's script change is in; before that, run the Task 12 e2e spec's near-cap test with `--headed`. Compare against the mockup block. Iterate on spacing only through the kit/page CSS; never restyle from prose.

- [ ] **Step 11: Commit (the page alone; retirement and pins are Task 12)**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/inspector/page.tsx web/app/inspector/InspectorLanding.tsx web/app/inspector/inspector.module.css web/app/inspector/[addr]/page.tsx web/app/inspector/[addr]/InspectorSurface.tsx web/app/inspector/[addr]/InspectorTiles.tsx web/app/inspector/[addr]/BackingTable.tsx web/app/inspector/[addr]/TrustCard.tsx web/app/inspector/[addr]/HistoryCard.tsx web/app/inspector/[addr]/ActivityTable.tsx web/app/inspector/[addr]/LegacyCard.tsx web/app/inspector/[addr]/StressTable.tsx web/app/inspector/[addr]/InspectorDrawer.tsx
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Inspector, rebuilt to the mockup - one verdict sentence, five tiles, what backs the debt, trust, room over batches, activity, legacy, stress, the drawer"
```

(Some old e2e specs fail at this commit — the old DOM is gone. Task 12 lands next and closes them; run the suite there, not here.)

---

