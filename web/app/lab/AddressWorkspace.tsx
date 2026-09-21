import Link from "next/link";
import type { ReactNode } from "react";
import { KitTable, KpiTile, SectionHead, StatusPill, VerdictHeader, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { projectionWords, sideRoomWords } from "@/lib/address-stress";
import type { AddressTile, AddressWorkspace as Space } from "@/lib/lab-address";
import { groupInt } from "@/lib/prose";
import styles from "./lab.module.css";

const COLUMNS = [
  { key: "scenario", header: "Scenario" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];

/** The one-address workspace: the Inspector's tiles for before and after the selected scenario, and every scenario's row — the subject is the selected row the address carries, else the first it does. */
export function AddressWorkspace({ space, kicker }: { space: Space; kicker: ReactNode }) {
  const chips =
    space.batchId === null
      ? []
      : [
          { label: "Result for batch", value: groupInt(space.batchId) },
          ...(space.stressBatchChip === null ? [] : [{ label: "Stress for batch", value: space.stressBatchChip, tone: "warn" as const }]),
          ...(space.selected === null ? [] : [{ label: "Scenario", value: space.selected.id }]),
        ];
  const t = space.tiles;
  const tile = (key: string, side: "before" | "after", label: string, v: AddressTile | undefined) => (
    <KpiTile testId={`lab-address-kpi-${key}-${side}`} label={label} value={v?.value ?? "—"} tone={v?.tone ?? "refused"} pending={space.state === "loading"} />
  );
  // The room cells and the verdict cell speak from the lib's own words — the tiles' room register, and the verdict
  // words the view model hands over, which are the Inspector's words for the same row under the same header — so the
  // table can never say what the header refuses, and the two pages can never word one row two ways.
  const rows: KitRow[] = space.table.map(({ row: r, verdict }) => {
    return {
      key: r.id,
      dim: !r.applicable,
      cells: {
        scenario:
          r.projection === null ? (
            r.label
          ) : (
            <span title={r.projectionNote ?? undefined}>
              {r.label} <StatusPill tone="projection">PROJECTION</StatusPill>
            </span>
          ),
        before: sideRoomWords(r.before, space.decimals, space.scaleAbsence),
        after:
          r.projection === null
            ? sideRoomWords(r.after, space.decimals, space.scaleAbsence)
            : projectionWords(r.projection, space.decimals, space.scaleAbsence),
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
    };
  });
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
              Open in the Inspector →
            </Link>
          ) : undefined
        }
      />
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
        <SectionHead
          title="Every committed scenario"
          qualifier={space.qualifier}
        />
        <KitTable columns={COLUMNS} rows={rows} testId="lab-address-table" emptyText={space.state === "rows" ? "No scenario applies to this address." : space.headline.emphasis} />
      </section>
    </>
  );
}
