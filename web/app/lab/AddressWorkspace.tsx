import Link from "next/link";
import type { ReactNode } from "react";
import { KitTable, KpiTile, SectionHead, StatusPill, VerdictHeader, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { agreedRoomToday, PROJECTION_ROOM_CELL, roomCell, STRESS_ROOM_DEFINITION, type StressSide } from "@/lib/address-stress";
import { PROJECTION_TITLE, PROJECTION_WORD, projectionRowSub } from "@/lib/inspector-view";
import type { AddressTile, AddressWorkspace as Space } from "@/lib/lab-address";
import { EVERY_SCENARIO_TITLE, NO_SCENARIO_APPLIES, OPEN_IN_INSPECTOR } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import styles from "./lab.module.css";

const SCENARIO: KitColumn = { key: "scenario", header: "Scenario" };
const BEFORE: KitColumn = { key: "before", header: "Room today", align: "right" };
const AFTER: KitColumn = { key: "after", header: "Room after", align: "right" };
const FLIPS: KitColumn = { key: "flips", header: "Becomes liquidatable?", align: "right" };

/** The one-address workspace: the Inspector's tiles for before and after the selected scenario, and every scenario's row — the subject is the selected row the address carries, else the first it does. */
export function AddressWorkspace({ space, kicker }: { space: Space; kicker: ReactNode }) {
  const chips =
    space.batchId === null
      ? []
      : [
          { label: "Result for batch", value: groupInt(space.batchId) },
          ...(space.stressBatchChip === null ? [] : [{ label: "Stress for batch", value: space.stressBatchChip, tone: "warn" as const }]),
        ];
  const t = space.tiles;
  const tile = (key: string, side: "before" | "after", label: string, v: AddressTile | undefined) => {
    // No tiles to print: every tile says the workspace's own absence, never a dash.
    const shown = v ?? space.tileAbsence ?? undefined;
    return (
      <KpiTile
        testId={`lab-address-kpi-${key}-${side}`}
        label={label}
        value={shown?.value ?? ""}
        sub={shown?.sub}
        tone={shown?.tone ?? "refused"}
        state={shown?.state}
        stateWord={shown?.state === undefined ? undefined : shown.value}
      />
    );
  };
  const room = (side: StressSide | null) => {
    const cell = roomCell(side, space.decimals, space.scaleAbsence);
    return (
      <span className={cell.over ? styles.over : undefined} title={cell.title ?? undefined}>
        {cell.text}
      </span>
    );
  };
  // The Inspector's column rule: while every row agrees on room today and the tiles print it, the column goes. Tiles
  // refused (another batch, no scale) state no room today, so there the column stays.
  const todayOnce = space.tiles !== null && agreedRoomToday(space.rows, space.decimals, space.scaleAbsence) !== null;
  const columns = todayOnce ? [SCENARIO, AFTER, FLIPS] : [SCENARIO, BEFORE, AFTER, FLIPS];
  // The room cells and the verdict cell speak from the lib's own words — the room cell every table shares, and the
  // verdict words the view model hands over, which are the Inspector's words for the same row under the same header — so
  // the table can never say what the header refuses, and the two pages can never word one row two ways.
  const rows: KitRow[] = space.table.map(({ row: r, verdict }) => ({
    key: r.id,
    dim: !r.applicable,
    cells: {
      scenario: (
        <>
          <span className={styles.scenarioName} title={r.projection === null ? r.label : (r.projectionNote ?? r.label)}>
            {r.name}
          </span>
          {r.projection !== null && (
            <span className={styles.detail}>{projectionRowSub(r.projection, space.decimals, space.scaleAbsence)}</span>
          )}
        </>
      ),
      before: room(r.before),
      after:
        r.projection === null ? (
          room(r.after)
        ) : (
          <span className={styles.stateCell} title={PROJECTION_ROOM_CELL.title}>
            {PROJECTION_ROOM_CELL.text}
          </span>
        ),
      flips:
        verdict.tone !== null ? (
          <StatusPill tone={verdict.tone} title={verdict.title ?? undefined}>
            {verdict.text}
          </StatusPill>
        ) : verdict.title !== null ? (
          <span title={verdict.title}>{verdict.text}</span>
        ) : (
          verdict.text
        ),
    },
  }));
  return (
    <>
      {space.fallback !== null && (
        <p className={styles.notice} data-testid="lab-address-fallback">
          {space.fallback}
        </p>
      )}
      <VerdictHeader
        testId="lab-verdict"
        kicker={kicker}
        emphasis={space.headline.emphasis}
        rest={space.headline.rest}
        tone={space.headline.tone}
        dek={space.headline.dek}
        chips={chips}
        actions={
          space.address !== "" && space.state === "rows" ? (
            <Link href={`/inspector/${space.address}`} className={`${kit.btn} ${kit.btnGhost}`}>
              {OPEN_IN_INSPECTOR}
            </Link>
          ) : undefined
        }
      />
      <div className={styles.tilesPair} data-testid="lab-address-tiles" aria-busy={space.state === "loading" ? "true" : undefined}>
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
        <SectionHead
          title={EVERY_SCENARIO_TITLE}
          qualifier={space.qualifier}
          badge={
            <StatusPill tone="projection" title={PROJECTION_TITLE}>
              {PROJECTION_WORD}
            </StatusPill>
          }
        />
        <div className={kit.card}>
          <KitTable
            columns={columns}
            rows={rows}
            testId="lab-address-table"
            emptyText={space.state === "rows" ? NO_SCENARIO_APPLIES : space.headline.emphasis}
            label={EVERY_SCENARIO_TITLE}
          />
        </div>
        <p className={styles.dim} data-testid="lab-address-caption">
          {STRESS_ROOM_DEFINITION}
        </p>
      </section>
    </>
  );
}
