"use client";

import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { activityRows, activityTakeaway, type ActivityScale } from "@/lib/activity-rows";
import { useAddressActivity } from "@/lib/address-lookup";
import styles from "../inspector.module.css";

const COLUMNS = [
  { key: "when", header: "When" },
  { key: "action", header: "Action" },
  { key: "asset", header: "Asset" },
  { key: "amount", header: "Amount", align: "right" as const },
  { key: "tx", header: "Tx", align: "right" as const },
];

/** This account's chain actions. Mounted with key={addr} by the surface: a fresh mount can never hold another address's rows. */
export function ActivityTable({ addr, valid, scale }: { addr: string; valid: boolean; scale: ActivityScale }) {
  const activity = useAddressActivity(addr, valid);
  const rows = activityRows(activity.rows, scale);
  const timed = rows.filter((r) => r.timed).length;
  const kitRows: KitRow[] = rows.map((r) => ({
    key: r.key,
    dim: !r.timed,
    cells: {
      when: <span title={r.timed ? undefined : "no custodied header time yet — the block number stands in"}>{r.when}</span>,
      action: (
        <>
          <span title={r.actionTitle}>{r.action}</span>
          {r.detail !== null && <span className={styles.detail}>{r.detail}</span>}
        </>
      ),
      asset: r.asset,
      amount: (
        <>
          <span title={r.amountTitle ?? undefined}>{r.amount}</span>
          {r.rawUnits && (
            <>
              {" "}
              <StatusPill tone="refused" title={r.amountTitle ?? undefined}>
                raw units
              </StatusPill>
            </>
          )}
          {!r.rawUnits && r.unitChip !== null && <span className={kit.sub}> {r.unitChip}</span>}
        </>
      ),
      tx:
        r.tx.url === null ? (
          <span className={kit.addr}>{r.tx.short}</span>
        ) : (
          <a className={kit.addr} href={r.tx.url} rel="noreferrer" target="_blank">
            {r.tx.short}
          </a>
        ),
    },
  }));
  const emptyText = activity.loading
    ? "Loading activity…"
    : activity.error !== null
      ? `Activity unavailable: ${activity.error.message}`
      : "No custodied actions for this account.";
  return (
    <section>
      <SectionHead title="Activity" qualifier="this account's chain actions · custodied times, newest first" />
      <KitTable testId="inspector-activity" columns={COLUMNS} rows={kitRows} emptyText={emptyText} />
      {rows.length > 0 && (
        <p className={styles.note} data-testid="inspector-activity-takeaway">
          {activityTakeaway(timed, rows.length - timed, activity.hasMore)}
        </p>
      )}
      {activity.hasMore && (
        <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={activity.loadMore} disabled={activity.loading} data-testid="inspector-activity-more">
          Load more
        </button>
      )}
    </section>
  );
}
