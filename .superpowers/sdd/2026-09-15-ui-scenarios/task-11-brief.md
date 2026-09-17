### Task 11: The Scenarios page — library, workspace, sections, one-address mode, drawer

**Integrator builds this personally** (spec §9.2). Consumes every interface above; produces the test-id contract. Looked at in both themes on a production build with the demo routes mocked before it is committed; the e2e contract lands in Task 12, pins and the owner gate in Task 14.

**Files:**
- Rewrite: `web/app/lab/page.tsx`, `web/app/lab/lab.module.css`
- Create: `web/app/lab/LabSurface.tsx`, `web/app/lab/money.ts`, `web/app/lab/LabTiles.tsx`, `web/app/lab/TransitionCard.tsx`, `web/app/lab/MoversTable.tsx`, `web/app/lab/LegacyResult.tsx`, `web/app/lab/AssumptionsDrawer.tsx`, `web/app/lab/AddressWorkspace.tsx`, `web/app/lab/StaleBanner.tsx`
- Modify: `web/app/inspector/[addr]/InspectorSurface.tsx` (secondary → `/lab?address={addr}`), `web/app/inspector/[addr]/StressTable.tsx` (section link → `/lab?address={addr}`), `web/scripts/screenshot-pages.mjs` (the `lab` page + routes; Task 14's change pulled forward to look at the page)

The old Lab components stay in the tree until Task 12 deletes them; `LabClient` is no longer imported after this task, so `page.tsx` is the only file that changes its imports.

- [ ] **Step 1: `money.ts` — the three registers, every scale guarded**

```ts
// web/app/lab/money.ts
// The page's three money registers (plan R11): book-level in the Book's tiers,
// account-level in full dollars, exact wire values in the drawer. A scale that
// fails the guard prints "unreadable scale"; a null value prints a dash.
import { humanUsdFull } from "@/lib/human-price";
import { humanUsd } from "@/lib/human-usd";
import { signedUsd } from "@/lib/lab-headline";
import { groupInt } from "@/lib/prose";
import { isWireScale } from "@/lib/wireGuard";

export const UNREADABLE_SCALE = "unreadable scale";
type Money = (value: bigint | null | undefined) => string;

const guarded = (decimals: number | null, print: (v: bigint, d: number) => string): Money => {
  if (decimals === null || !isWireScale(decimals)) return (value) => (value == null ? "—" : UNREADABLE_SCALE);
  return (value) => (value == null ? "—" : print(value, decimals));
};
export const bookMoney = (decimals: number | null): Money => guarded(decimals, humanUsd);
export const signedBookMoney = (decimals: number | null): Money => guarded(decimals, signedUsd);
export const accountMoney = (decimals: number | null): Money => guarded(decimals, humanUsdFull);

/** The exact wire integer at its scale: `1,280,000.000000`. */
export function wireExact(value: bigint, decimals: number): string {
  if (!isWireScale(decimals)) return UNREADABLE_SCALE;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const div = 10n ** BigInt(decimals);
  const whole = groupInt(abs / div);
  const frac = decimals === 0 ? "" : `.${(abs % div).toString().padStart(decimals, "0")}`;
  return `${negative ? "−" : ""}${whole}${frac}`;
}
```

- [ ] **Step 2: `page.tsx`**

```tsx
// web/app/lab/page.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { LabSurface } from "./LabSurface";

export const metadata: Metadata = { title: "Scenarios" };

/** Scenarios (spec §5.4): what changes under a named shock? `useSearchParams` needs a Suspense boundary to keep the route static. */
export default function LabPage() {
  return (
    <Suspense fallback={null}>
      <LabSurface />
    </Suspense>
  );
}
```

- [ ] **Step 3: `LabSurface.tsx` — the composition**

```tsx
// web/app/lab/LabSurface.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AddressField, ScenarioLibrary, StatusPill, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useAddressLookup } from "@/lib/address-lookup";
import { humanAge } from "@/lib/freshness";
import { isAddress } from "@/lib/format";
import { deriveInspectorView } from "@/lib/inspector-view";
import { addressWorkspace } from "@/lib/lab-address";
import { deepLinkDecision } from "@/lib/lab-deep-link";
import { useLabReading } from "@/lib/lab-reading";
import { deriveLabView } from "@/lib/lab-view";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { useMetaConstants } from "@/lib/meta";
import { resultReceipt } from "@/lib/resultIdentity";
import { AddressWorkspace } from "./AddressWorkspace";
import { AssumptionsDrawer } from "./AssumptionsDrawer";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { LegacyResult } from "./LegacyResult";
import { MoversTable } from "./MoversTable";
import { StaleBanner } from "./StaleBanner";
import { TransitionCard } from "./TransitionCard";

type Mode = "book" | "address";

const PROJECTION = (
  <span data-testid="lab-projection">
    <StatusPill tone="projection">PROJECTION</StatusPill>
  </span>
);

export function LabSurface() {
  const params = useSearchParams();
  const router = useRouter();
  const reading = useLabReading();
  const meta = useMetaConstants();
  const linkedAddress = params.get("address");
  const [mode, setMode] = useState<Mode>(linkedAddress !== null ? "address" : "book");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("scenario"));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [address, setAddress] = useState(linkedAddress ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const view = deriveLabView(reading, { selectedId, checked });
  const book = view.book;
  const definition = book.definition;

  // One-address mode is the Inspector's reading. "" is not an address, so the hook fetches nothing until one is entered.
  const lookupFor = mode === "address" && isAddress(address) ? address : "";
  const addressReading = useAddressLookup(lookupFor);
  const inspectorView = mode === "address" && address !== "" ? deriveInspectorView(addressReading, meta.constants) : null;
  const space = addressWorkspace({ address, view: inspectorView, selectedId: view.selectedId });

  // The result's own age, anchored to its receipt; the chip ticks from the moment the run settled.
  const identity = book.identity;
  const age = useAnchoredAgeSeconds(identity === null ? null : resultReceipt(identity, 0));

  // Deep links decide once, when the listing has answered (the ids must be listed to dispatch).
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || reading.listing.phase !== "ready") return;
    decided.current = true;
    const listed = reading.listing.value.scenarios.map((s) => s.id);
    const single = params.get("scenario");
    const decision = deepLinkDecision(single, params.get("scenarios"), listed);
    if (decision.kind === "single" && single !== null && listed.includes(single)) reading.run(single);
    if (decision.kind === "set") {
      setNotice(decision.notice);
      if (!decision.overCap && decision.runIds.length > 0) {
        setChecked(new Set(decision.runIds));
        reading.runSet(decision.runIds);
      }
    }
    if (decision.kind === "conflict") setNotice(decision.notice);
  }, [reading, params]);

  const chips = identity === null ? book.chips : [book.chips[0]!, book.chips[1]!, { label: "Computed", value: `${humanAge(age.seconds ?? 0)} ago` }, ...book.chips.slice(2)];
  const running = book.state === "running";
  const runLabel = definition === null ? "Run" : `Run ${definition.label}`;
  const kicker: ReactNode = (
    <>
      {mode === "book" ? book.kicker : `Account ${space.address === "" ? "—" : space.address.slice(0, 6) + "…" + space.address.slice(-4)} · Cash`} {PROJECTION}
    </>
  );
  const busy = mode === "book" ? running || book.state === "listing-loading" : space.state === "loading";
  const cashResult = book.cash?.kind === "result" ? book.cash.result : null;

  return (
    <div className={styles.page} data-testid="lab-surface" data-mode={mode} data-state={mode === "book" ? book.state : space.state} data-banner={book.banner ?? undefined} aria-busy={busy ? "true" : undefined}>
      <ScenarioLibrary
        testId="lab-library"
        mode={mode}
        onMode={(m) => {
          setMode(m);
          const next = new URLSearchParams(params.toString());
          if (m === "book") next.delete("address");
          else if (address !== "") next.set("address", address);
          router.replace(`/lab${next.size === 0 ? "" : `?${next.toString()}`}`);
        }}
        items={mode === "address" ? view.library.map((r) => ({ ...r, outcome: { key: "not-run", text: space.rows.some((x) => x.id === r.id) ? "Applies to this address" : "Not on this address", tone: "dim" }, checked: false })) : view.library}
        onSelect={setSelectedId}
        onCheck={(id, on) =>
          setChecked((prev) => {
            const next = new Set(prev);
            if (on) next.add(id);
            else next.delete(id);
            return next;
          })
        }
        addressSlot={
          mode === "address" ? (
            <AddressField
              testId="lab-address"
              initial={address}
              hint="any 0x address"
              onInspect={(addr) => {
                setAddress(addr);
                const next = new URLSearchParams(params.toString());
                next.set("address", addr);
                router.replace(`/lab?${next.toString()}`);
              }}
            />
          ) : undefined
        }
        run={{ label: mode === "book" ? runLabel : "Run against this address", disabled: mode === "book" ? definition === null || running : !isAddress(address), onRun: () => (mode === "book" && definition !== null ? reading.run(definition.id) : undefined) }}
        compare={null}
        emptyText={book.state === "listing-loading" ? "Loading the committed scenarios…" : "No committed scenarios are listed."}
        footnote={`Committed, versioned scenarios${view.configVersion === null ? "" : ` (config ${view.configVersion})`}. No sliders — every result is reproducible.`}
      />
      <div className={styles.workspace}>
        {notice !== null && (
          <p className={styles.notice} data-testid="lab-deeplink-notice">
            {notice}
          </p>
        )}
        {mode === "address" ? (
          <AddressWorkspace space={space} kicker={kicker} />
        ) : (
          <>
            <VerdictHeader
              testId="lab-verdict"
              kicker={kicker}
              emphasis={book.headline.emphasis}
              rest={book.headline.rest}
              tone={book.headline.tone}
              dek={book.headline.dek}
              chips={chips}
              actions={
                book.run !== null ? (
                  <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setDrawerOpen(true)} data-testid="lab-drawer">
                    Assumptions · Out of model
                  </button>
                ) : undefined
              }
            />
            {book.banner !== null && definition !== null && <StaleBanner kind={book.banner} skew={book.skew} batchId={book.run?.batch.id ?? null} onRerun={() => reading.run(definition.id)} rerunDisabled={running} />}
            <LabTiles reading={book.cash} pending={running} testPrefix="lab-kpi" />
            <TransitionCard reading={book.cash} />
            {cashResult !== null && <MoversTable table={cashResult.movers} />}
            {book.legacy !== null && <LegacyResult reading={book.legacy} />}
            <AssumptionsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} run={book.run} cash={cashResult} />
          </>
        )}
      </div>
    </div>
  );
}
```

`AddressField`'s `onInspect` is Plan 2's callback (it navigated to `/inspector/{addr}` there; here it sets the address in place). The address-mode library rows print whether the address's stress response carries each scenario (R15) and no checkbox.

- [ ] **Step 4: `LabTiles.tsx`**

```tsx
// web/app/lab/LabTiles.tsx
import { KpiTile, type Tone } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { EngineReading } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import { bookMoney, signedBookMoney } from "./money";

function refusedWord(reading: EngineReading | null): string {
  if (reading === null) return "not run";
  switch (reading.kind) {
    case "withheld":
      return "withheld";
    case "not-covered":
      return "not modelled";
    case "contradictory":
    case "unreadable":
      return "contradictory";
    case "result":
      return "";
  }
}

/** Newly liquidatable · Liquidatable debt Δ · Bad debt at liquidation Δ · Accounts moved — the same four in every state (plan R2). */
export function LabTiles({ reading, pending, testPrefix }: { reading: EngineReading | null; pending: boolean; testPrefix: string }) {
  const r = reading?.kind === "result" ? reading.result : null;
  const word = refusedWord(reading);
  const money = bookMoney(r?.decimals ?? null);
  const signed = signedBookMoney(r?.decimals ?? null);
  const heat = r?.heat.kind === "ok" ? r.heat.view : null;
  const tone = (t: Tone): Tone => (r === null ? "refused" : t);
  const sub = (text: string) => (r === null ? word : text);
  return (
    <div className={`${kit.kpis} ${kit.kpis4}`}>
      <KpiTile testId={`${testPrefix}-newly`} label="Newly liquidatable" value={r === null ? "—" : groupInt(r.newly)} sub={sub(`accounts · was ${groupInt(r?.beforeEligible ?? 0)}, now ${groupInt(r?.afterEligible ?? 0)}`)} tone={tone(r !== null && r.newly > 0 ? "crit" : "ok")} pending={pending} />
      <KpiTile testId={`${testPrefix}-debt`} label="Liquidatable debt" value={r === null ? "—" : signed(r.deltaEligibleDebt)} sub={sub(`${money(r?.eligibleDebtBefore)} → ${money(r?.eligibleDebtAfter)}`)} tone={tone(r !== null && r.deltaEligibleDebt > 0n ? "crit" : "neutral")} pending={pending} />
      <KpiTile testId={`${testPrefix}-baddebt`} label="Bad debt at liquidation" value={r === null ? "—" : signed(r.deltaBadDebt)} sub={sub(`${money(r?.badDebtBefore)} → ${money(r?.badDebtAfter)}`)} tone={tone(r !== null && r.deltaBadDebt > 0n ? "warn" : "neutral")} pending={pending} />
      <KpiTile
        testId={`${testPrefix}-moved`}
        label="Accounts moved"
        value={r === null || r.laneChanged === null ? "—" : groupInt(r.laneChanged)}
        sub={sub(r !== null && r.laneChanged === null ? "not stated" : `of ${groupInt(r?.measured ?? 0)} measured · ${heat === null ? "movement not readable" : `${groupInt(heat.improved)} improved`}`)}
        tone={tone("neutral")}
        pending={pending}
      />
    </div>
  );
}
```

- [ ] **Step 5: `TransitionCard.tsx`**

```tsx
// web/app/lab/TransitionCard.tsx
import { ChartCard, Heatmap, type HeatCellView } from "@/components/kit";
import { heatIntensity } from "@/lib/lab-geometry";
import type { HeatmapView } from "@/lib/lab-transitions";
import type { EngineReading } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import styles from "./lab.module.css";
import { bookMoney } from "./money";

export function cellsOf(view: HeatmapView): HeatCellView[] {
  const money = bookMoney(view.decimals);
  return view.cells.map((c) => ({
    from: c.from,
    to: c.to,
    count: c.rows,
    title: `${groupInt(c.rows)} account${c.rows === 1 ? "" : "s"} · ${view.bands[c.from]?.label ?? ""} → ${view.bands[c.to]?.label ?? ""} · debt ${money(c.debtBefore)}`,
    movement: c.movement,
    intensity: heatIntensity(c.rows, view.maxRows),
  }));
}

export function finding(view: HeatmapView): string {
  const axes = view.merged ? "Rows: room under cap today · columns: after the shock · cells are accounts." : "Rows: health-factor lane today · columns: after the shock, as the wire serves them · cells are accounts.";
  const moves = `${groupInt(view.bandChanged)} accounts change band; ${groupInt(view.crossedCap)} cross the cap; ${view.improved === 0 ? "none improve" : `${groupInt(view.improved)} improve`}.`;
  const unmeasured = view.unmeasuredRows === 0 ? "" : ` ${groupInt(view.unmeasuredRows)} not measured.`;
  return `${axes} ${moves}${unmeasured}`;
}

/** Where accounts move (spec §5.4): the transition heatmap, or the state's own word. */
export function TransitionCard({ reading, testId = "lab-transitions", gridTestId = "lab-heatmap" }: { reading: EngineReading | null; testId?: string; gridTestId?: string }) {
  const r = reading?.kind === "result" ? reading.result : null;
  const heat = r?.heat ?? null;
  return (
    <ChartCard title="Where accounts move" testId={testId} link={r === null ? undefined : { href: "#movers", label: "Most affected accounts →" }} finding={<span data-testid={`${testId}-finding`}>{heat?.kind === "ok" ? finding(heat.view) : heat?.kind === "contradictory" ? `Not drawn: ${heat.reasons.join("; ")}.` : reading === null ? "Run a scenario to see where accounts move." : reading.kind === "withheld" ? "Withheld: the Cash book was not computed under this scenario." : reading.kind === "not-covered" ? "This scenario does not model the Cash book." : "Not drawn: the result contradicts itself."}</span>}>
      {heat?.kind === "ok" ? (
        <Heatmap bands={heat.view.bands} cells={cellsOf(heat.view)} rowsLabel="today" colsLabel="after" merged={heat.view.merged} testId={gridTestId} cellTestIdPrefix={`${gridTestId}-cell`} />
      ) : (
        <p className={styles.dim}>{reading === null ? "No result yet." : "No grid: nothing here is a count."}</p>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 6: `MoversTable.tsx`**

```tsx
// web/app/lab/MoversTable.tsx
import Link from "next/link";
import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import { truncateAddress } from "@/lib/format";
import { moversCaption, type MoversTable as Table } from "@/lib/lab-movers";
import styles from "./lab.module.css";

const COLUMNS = [
  { key: "account", header: "Account" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "debt", header: "Debt", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];

/** The wire's movers, one row each; rows open the Inspector; sub-$100 rows dim (plan R4, R5). */
export function MoversTable({ table }: { table: Table }) {
  const rows: KitRow[] = table.rows.map((m) => ({
    key: m.account,
    testId: `lab-movers-row-${m.account}`,
    dim: m.tier === "small" || m.tier === "dust",
    cells: {
      account: (
        <Link href={`/inspector/${m.account}`} className={styles.mono} title={m.account}>
          {truncateAddress(m.account)}
        </Link>
      ),
      before: m.roomBefore,
      after: m.roomAfter,
      debt: m.debtText,
      flips: m.becomesLiquidatable === null ? <StatusPill tone="refused">Cannot say</StatusPill> : m.becomesLiquidatable ? <StatusPill tone="crit">Yes</StatusPill> : "No",
    },
  }));
  return (
    <section id="movers" data-testid="lab-movers">
      <SectionHead title="Most affected accounts" qualifier="room today → after the shock · the wire's own ranking" />
      <KitTable columns={COLUMNS} rows={rows} testId="lab-movers-table" emptyText="No account moved under this scenario." />
      <p className={styles.dim} data-testid="lab-movers-caption" title={table.note}>
        {moversCaption(table)}
        {table.unreadable.length > 0 ? ` · unreadable: ${table.unreadable.join(", ")}` : ""}
      </p>
    </section>
  );
}
```

- [ ] **Step 7: `LegacyResult.tsx`, `StaleBanner.tsx`**

```tsx
// web/app/lab/LegacyResult.tsx
import type { EngineReading } from "@/lib/lab-view";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { TransitionCard } from "./TransitionCard";

/** The legacy market's result: the same four tiles and its own lanes, in its own decimals, never beside a Cash sum (plan R10). */
export function LegacyResult({ reading }: { reading: EngineReading }) {
  return (
    <details className={styles.legacy} data-testid="lab-legacy">
      <summary>Legacy · Aave v3 market result</summary>
      <div className={styles.legacyBody}>
        <LabTiles reading={reading} pending={false} testPrefix="lab-legacy-kpi" />
        <TransitionCard reading={reading} testId="lab-legacy-transitions" gridTestId="lab-legacy-heatmap" />
        <p className={styles.dim}>Judged by its own health factor, in its own unit. The two books are never added together.</p>
      </div>
    </details>
  );
}
```

```tsx
// web/app/lab/StaleBanner.tsx
import kit from "@/components/kit/kit.module.css";
import { groupInt, joinAnd } from "@/lib/prose";
import styles from "./lab.module.css";

/** A result for a previous input or a superseded batch keeps its figures; the banner says so and offers the re-run (plan R13). */
export function StaleBanner({ kind, skew, batchId, onRerun, rerunDisabled }: { kind: "stale-input" | "superseded"; skew: readonly string[]; batchId: number | null; onRerun: () => void; rerunDisabled: boolean }) {
  const text =
    kind === "superseded"
      ? `Batch ${batchId === null ? "?" : groupInt(batchId)} has been superseded: a newer complete batch exists. This result stands for the batch it names.`
      : `Results for a previous input: the listing's ${joinAnd(skew)} changed since this run. This result stands for the definition it was computed under.`;
  return (
    <div className={styles.banner} data-testid="lab-banner" data-kind={kind} role="status">
      <span>{text}</span>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRerun} disabled={rerunDisabled} data-testid="lab-banner-rerun">
        Run again
      </button>
    </div>
  );
}
```

- [ ] **Step 8: `AssumptionsDrawer.tsx`**

```tsx
// web/app/lab/AssumptionsDrawer.tsx
"use client";

import { Drawer } from "@/components/Drawer";
import type { EngineResult } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import type { RunBookResponse } from "@/lib/runbook";
import { isWireDecimal } from "@/lib/wireGuard";
import styles from "./lab.module.css";
import { wireExact } from "./money";

const flags = (s: RunBookResponse["applied_shocks"][number]): string => [s.snapped ? "snapped" : null, s.base_snapped ? "base snapped" : null, s.cap_bound ? "cap bound" : null].filter((f): f is string => f !== null).join(" · ");
const exact = (v: string): string => (isWireDecimal(v) ? v : `unreadable (${JSON.stringify(v)})`);

/** Path assumption, applied shocks, held-flat inputs, out of model, config, wire notes verbatim, the exact wire values (plan R10). */
export function AssumptionsDrawer({ open, onClose, run, cash }: { open: boolean; onClose: () => void; run: RunBookResponse | null; cash: EngineResult | null }) {
  return (
    <Drawer open={open} onClose={onClose} title="Assumptions & out of model">
      <div className={styles.method} data-testid="lab-drawer-body">
        {run === null ? (
          <p>No result is open.</p>
        ) : (
          <>
            <h3>Path assumption</h3>
            <p>{run.path_assumption}</p>
            <h3>Applied shocks</h3>
            {run.applied_shocks.length === 0 ? (
              <p>No mark moved: this scenario carries no price shock.</p>
            ) : (
              <ul>
                {run.applied_shocks.map((s) => (
                  <li key={`${s.asset}-${String(s.chain_id)}`}>
                    <code>{s.asset}</code> (chain {String(s.chain_id)}, {s.source}): <code>{exact(s.before)}</code> → <code>{exact(s.after)}</code> × {exact(s.factor_num)}/{exact(s.factor_den)}
                    {flags(s) === "" ? "" : ` · ${flags(s)}`}
                  </li>
                ))}
              </ul>
            )}
            <h3>Held flat</h3>
            {run.held_flat.length === 0 ? (
              <p>Nothing held flat.</p>
            ) : (
              <ul>
                {run.held_flat.map((h) => (
                  <li key={`${h.asset}-${String(h.chain_id)}`}>
                    <code>{h.asset}</code> (chain {String(h.chain_id)}, {h.source}) at <code>{exact(h.value)}</code>
                  </li>
                ))}
              </ul>
            )}
            <h3>Out of model</h3>
            <ul>
              {run.out_of_model.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <h3>Identity</h3>
            <p>
              Scenario <code>{run.scenario_id}</code> · {run.scenario_version} · config {run.scenario_config_version} · batch {groupInt(run.batch.id)} · served {run.served_at}
            </p>
            {cash !== null && (
              <>
                <h3>Exact wire values · Cash</h3>
                <p>
                  newly eligible <code>{String(cash.newly)}</code> · eligible debt <code>{wireExact(cash.eligibleDebtBefore, cash.decimals)}</code> → <code>{wireExact(cash.eligibleDebtAfter, cash.decimals)}</code> (Δ <code>{wireExact(cash.deltaEligibleDebt, cash.decimals)}</code>) · bad debt <code>{wireExact(cash.badDebtBefore, cash.decimals)}</code> → <code>{wireExact(cash.badDebtAfter, cash.decimals)}</code> (Δ{" "}
                  <code>{wireExact(cash.deltaBadDebt, cash.decimals)}</code>) · lane changed <code>{cash.laneChanged === null ? "null" : String(cash.laneChanged)}</code> of <code>{String(cash.measured)}</code> measured
                </p>
                <h3>The wire on its lanes</h3>
                <p data-testid="lab-drawer-transitions-note">{cash.transitionsNote}</p>
                <p>{cash.note}</p>
              </>
            )}
            <h3>Wire notes</h3>
            <ul>
              {run.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 9: `AddressWorkspace.tsx`**

```tsx
// web/app/lab/AddressWorkspace.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { KitTable, KpiTile, SectionHead, StatusPill, VerdictHeader, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { horizonLabel } from "@/lib/address-stress";
import type { AddressWorkspace as Space } from "@/lib/lab-address";
import { groupInt } from "@/lib/prose";
import styles from "./lab.module.css";
import { accountMoney } from "./money";

const COLUMNS = [
  { key: "scenario", header: "Scenario" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];

/** The one-address workspace: the Inspector's tiles for before and after the selected scenario, and every scenario's row (plan R8, R15). */
export function AddressWorkspace({ space, kicker }: { space: Space; kicker: ReactNode }) {
  const money = accountMoney(space.decimals);
  const chips = space.batchId === null ? [] : [{ label: "Result for batch", value: groupInt(space.batchId) }, ...(space.selected === null ? [] : [{ label: "Scenario", value: space.selected.id }])];
  const t = space.tiles;
  const tile = (key: string, side: "before" | "after", label: string, v: { value: string; tone: "crit" | "warn" | "ok" | "neutral" | "refused" } | undefined) => (
    <KpiTile testId={`lab-address-kpi-${key}-${side}`} label={label} value={v?.value ?? "—"} tone={v?.tone ?? "refused"} pending={space.state === "loading"} />
  );
  const rows: KitRow[] = space.rows.map((r) => ({
    key: r.id,
    dim: !r.applicable,
    cells: {
      scenario: r.projection === null ? r.label : <span title={r.projectionNote ?? undefined}>{r.label} <StatusPill tone="projection">PROJECTION</StatusPill></span>,
      before: money(r.before?.room),
      after: r.projection === null ? money(r.after?.room) : r.projection.map((h) => `${horizonLabel(h.seconds)}: ${h.extraInterest === null ? "—" : `+${money(h.extraInterest)}`} interest`).join(" · "),
      flips: !r.applicable ? (r.reason ?? "not applicable") : r.flips === null ? <StatusPill tone="refused">Cannot say</StatusPill> : r.flips ? <StatusPill tone="crit">Yes</StatusPill> : "No",
    },
  }));
  return (
    <>
      <VerdictHeader testId="lab-verdict" kicker={kicker} emphasis={space.headline.emphasis} rest={space.headline.rest} tone={space.headline.tone} dek={space.headline.dek} chips={chips} actions={space.address !== "" && space.state === "rows" ? <Link href={`/inspector/${space.address}`} className={`${kit.btn} ${kit.btnGhost}`}>Open in the Inspector →</Link> : undefined} />
      <div className={styles.tilesPair} data-testid="lab-address-tiles">
        <div className={`${kit.kpis} ${kit.kpis4}`}>
          {tile("debt", "before", "Debt today", t?.debtBefore)}
          {tile("cap", "before", "Borrow cap today", t?.capBefore)}
          {tile("room", "before", "Room today", t?.roomBefore)}
          {tile("status", "before", "Status today", t?.statusBefore)}
        </div>
        <div className={`${kit.kpis} ${kit.kpis4}`}>
          {tile("debt", "after", "Debt after", t?.debtAfter)}
          {tile("cap", "after", "Borrow cap after", t?.capAfter)}
          {tile("room", "after", "Room after", t?.roomAfter)}
          {tile("status", "after", "Status after", t?.statusAfter)}
        </div>
      </div>
      <section data-testid="lab-address-section">
        <SectionHead title="Every committed scenario" qualifier="applied to this account · shocked figures are projections, not readings" />
        <KitTable columns={COLUMNS} rows={rows} testId="lab-address-table" emptyText={space.state === "rows" ? "No scenario applies to this address." : space.headline.emphasis} />
      </section>
    </>
  );
}
```

- [ ] **Step 10: `lab.module.css` (rewrite)**

```css
/* Scenarios (spec §5.4): the 300px library beside one workspace; stacks under 900px. Page-local rules only. */
.page { display: grid; grid-template-columns: 300px 1fr; gap: 20px; align-items: start; }
.workspace { min-width: 0; display: grid; gap: 12px; align-content: start; }
.notice { margin: 0; color: var(--warn-text); font-size: var(--type-small); }
.banner { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 14px; border: 1px dashed var(--warn); border-radius: 8px; color: var(--ink); font-size: var(--type-body); }
.dim { color: var(--ink-3); font-size: var(--type-small); margin: 6px 0 0; }
.mono { font-family: var(--mono); font-size: var(--type-mono); color: var(--ink); text-decoration: none; }
.legacy { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--panel); }
.legacy > summary { cursor: pointer; font-size: var(--type-body); font-weight: var(--w-medium); color: var(--ink); }
.legacyBody { display: grid; gap: 12px; margin-top: 12px; }
.tilesPair { display: grid; gap: 12px; }
.method { display: grid; gap: 8px; font-size: var(--type-body); color: var(--ink); }
.method h3 { margin: 8px 0 0; font-size: var(--type-card); }
.method code { font-family: var(--mono); font-size: var(--type-mono-sm); }
.method ul { margin: 0; padding-left: 18px; }
@media (max-width: 900px) { .page { grid-template-columns: 1fr; } }
```

- [ ] **Step 11: The Inspector's link (R7) and the gate script**

In `web/app/inspector/[addr]/InspectorSurface.tsx` the toolbar's secondary becomes `{ href: `/lab?address=${addr}`, label: "Stress this address →" }` (keep it gated on `view.cash !== null`); in `web/app/inspector/[addr]/StressTable.tsx` the section link becomes `{ href: `/lab?address=${view.cashWire === null ? "" : view.cashWire.account}`, label: "Open Scenarios →" }` — if `cashWire` carries no `account` field, thread `addr` into `StressTable` as a prop from the surface instead. Update the Inspector contract pin that asserts `#stress` (Task 12 re-pins it to the new href).

In `web/scripts/screenshot-pages.mjs`: `PAGES` gains `lab: "/lab?scenario=eth_minus_30"`; the route block gains, before the `/v1/address/*` routes:

```js
    await page.route("**/v1/scenarios/run-book-set", (r) => json(r, demo.DEMO_RUN_BOOK_SET));
    await page.route("**/v1/scenarios/*/run-book", (r) => json(r, demo.DEMO_RUN_BOOK_ETH));
    await page.route("**/v1/scenarios", (r) => json(r, demo.DEMO_SCENARIOS));
```

and the usage comment reads `[overview|book|inspector|lab ...]`.

- [ ] **Step 12: Gates, then look at it**

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css && npm run build`
Expected: clean. Then, with nothing on :3111, `npm run start` (background, from `web/`), poll `curl --retry 30 --retry-delay 1 --retry-all-errors http://localhost:3111/lab` for a 200, then `node scripts/screenshot-pages.mjs <scratch>/lab-look lab` and open the four PNGs. Check against the mockup block: library left with the four rows and "Run ETH -30 percent"; kicker with the PROJECTION pill; headline `$1.2M more Cash debt becomes liquidatable, across 118 accounts.`; four tiles `118 · +$1.2M · +$40K · 941`; the 7×7 heatmap with `49` top-left, `118` in the over-cap column, `932` bottom-right; the movers table with 20 rows; the legacy `<details>` collapsed. Also load `/lab` bare (not-run state: the definition, dashed tone, tiles `—`), `/lab?address=<DEMO_NEAR_ADDR>` (one-address: before/after tiles, three rows). Fix what is off in these files, re-run the gates.

- [ ] **Step 13: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/lab/page.tsx web/app/lab/lab.module.css web/app/lab/LabSurface.tsx web/app/lab/money.ts web/app/lab/LabTiles.tsx web/app/lab/TransitionCard.tsx web/app/lab/MoversTable.tsx web/app/lab/LegacyResult.tsx web/app/lab/AssumptionsDrawer.tsx web/app/lab/AddressWorkspace.tsx web/app/lab/StaleBanner.tsx "web/app/inspector/[addr]/InspectorSurface.tsx" "web/app/inspector/[addr]/StressTable.tsx" web/scripts/screenshot-pages.mjs
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Scenarios page - the library beside one workspace, the transition heatmap on the wire's merged lanes, the most-affected accounts, the legacy result folded, the assumptions drawer, one-address mode on the Inspector's reading" -- web/app/lab/page.tsx web/app/lab/lab.module.css web/app/lab/LabSurface.tsx web/app/lab/money.ts web/app/lab/LabTiles.tsx web/app/lab/TransitionCard.tsx web/app/lab/MoversTable.tsx web/app/lab/LegacyResult.tsx web/app/lab/AssumptionsDrawer.tsx web/app/lab/AddressWorkspace.tsx web/app/lab/StaleBanner.tsx "web/app/inspector/[addr]/InspectorSurface.tsx" "web/app/inspector/[addr]/StressTable.tsx" web/scripts/screenshot-pages.mjs
```

---
