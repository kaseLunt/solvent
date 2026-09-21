import Link from "next/link";
import type { ReactNode } from "react";
import { KitTable, KpiTile, SectionHead, StatusPill, VerdictHeader, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { horizonLabel, sideRoomWords } from "@/lib/address-stress";
import { rowVerdictWord, type AddressTile, type AddressWorkspace as Space } from "@/lib/lab-address";
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
  const crossBatch = space.batchId !== null && space.stressBatchId !== null && space.stressBatchId !== space.batchId;
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
  // The room cells and the verdict cell speak from the lib's own words — the tiles' room register and the one row
  // verdict the headline and the library word share — so the table can never say what the header refuses.
  const rows: KitRow[] = space.rows.map((r) => {
    const verdict = rowVerdictWord(r);
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
        before: sideRoomWords(r.before, space.decimals),
        after:
          r.projection === null
            ? sideRoomWords(r.after, space.decimals)
            : r.projection.map((h) => `${horizonLabel(h.seconds)}: ${h.extraInterest === null ? "—" : `+${money(h.extraInterest)}`} interest`).join(" · "),
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
          qualifier={crossBatch && space.stressBatchId !== null ? `applied to this account at batch ${groupInt(space.stressBatchId)} · the position above is batch ${groupInt(space.batchId ?? 0)} · shocked figures are projections, not readings` : "applied to this account · shocked figures are projections, not readings"}
        />
        <KitTable columns={COLUMNS} rows={rows} testId="lab-address-table" emptyText={space.state === "rows" ? "No scenario applies to this address." : space.headline.emphasis} />
      </section>
    </>
  );
}
