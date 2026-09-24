"use client";

import { KitTable, SectionHead, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import {
  ACTIVITY_CARD_QUALIFIER,
  UNTIMED_WHEN_TITLE,
  activityEmptyText,
  activityFailureText,
  activityRows,
  activityTakeaway,
  type ActivityScale,
} from "@/lib/activity-rows";
import { ACTIVITY_AMOUNT_HEADER } from "@/lib/activity-view";
import { useAddressActivity } from "@/lib/address-lookup";
import styles from "../inspector.module.css";

// The Amount head carries the Activity page's caveat where the number is read: engine units, never dollars.
const COLUMNS = [
  { key: "when", header: "When" },
  { key: "action", header: "Action" },
  { key: "asset", header: "Asset" },
  { key: "amount", header: ACTIVITY_AMOUNT_HEADER, align: "right" as const },
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
      when: <span title={r.timed ? undefined : UNTIMED_WHEN_TITLE}>{r.when}</span>,
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
          {r.amountTag !== null && (
            <span className={kit.sub} title={r.amountTitle ?? undefined} data-testid="inspector-activity-amount-tag">
              {" "}
              {r.amountTag}
            </span>
          )}
          {r.unit !== "" && (
            <span className={kit.sub} title={r.amountTitle ?? undefined} data-testid="inspector-activity-unit">
              {" "}
              {r.unit}
            </span>
          )}
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
  return (
    <section>
      <SectionHead title="Activity" qualifier={ACTIVITY_CARD_QUALIFIER} />
      <KitTable testId="inspector-activity" columns={COLUMNS} rows={kitRows} emptyText={activityEmptyText(activity.loading, activity.error)} />
      {/* The table's empty words print only with no rows; a page failure beside loaded rows has its own line, so it is never lost. */}
      {activity.error !== null && rows.length > 0 && (
        <p className={styles.note} role="status" data-testid="inspector-activity-error">
          {activityFailureText(activity.error)}
        </p>
      )}
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
