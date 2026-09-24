"use client";

import { KitTable, SectionHead, StateCard, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import {
  ACTIVITY_CARD_QUALIFIER,
  SERVICE_SAID,
  activityEmptyText,
  activityFailureCard,
  activityRows,
  activityTakeaway,
  type ActivityScale,
} from "@/lib/activity-rows";
import { ACTIVITY_AMOUNT_HEADER, ACTIVITY_WHEN_HEADER } from "@/lib/activity-view";
import { useAddressActivity } from "@/lib/address-lookup";
import styles from "../inspector.module.css";

/** The card's name, which its table's scroll region carries. */
const TITLE = "Activity";

// The Amount head carries the Activity page's caveat where the number is read: engine units, never dollars. The When
// head names the zone once, so no cell repeats it; each cell's title is the wire's own instant.
const COLUMNS = [
  { key: "when", header: ACTIVITY_WHEN_HEADER },
  { key: "action", header: "Type" },
  { key: "asset", header: "Asset" },
  { key: "amount", header: ACTIVITY_AMOUNT_HEADER, align: "right" as const },
  { key: "tx", header: "Tx" },
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
      when: <span title={r.whenTitle}>{r.when}</span>,
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
          <span className={kit.addr} title={r.tx.hash}>
            {r.tx.short}
          </span>
        ) : (
          <a className={kit.addr} href={r.tx.url} rel="noreferrer" target="_blank" title={r.tx.hash}>
            {r.tx.short} ↗
          </a>
        ),
    },
  }));
  return (
    <section>
      <SectionHead title={TITLE} qualifier={ACTIVITY_CARD_QUALIFIER} />
      <div className={kit.card}>
        <KitTable testId="inspector-activity" columns={COLUMNS} rows={kitRows} emptyText={activityEmptyText(activity.loading, activity.error)} label={TITLE} />
      </div>
      {/* A failed read stands in its own card below the table, the service's words disclosed in it: with no rows, the
          table's own row says the state; beside loaded rows, the rows stand and the card says nothing beyond them was read. */}
      {activity.error !== null && (rows.length > 0 || !activity.loading) && (
        <div role="status" data-testid={rows.length > 0 ? "inspector-activity-error" : "inspector-activity-unavailable"}>
          <StateCard
            state="unavailable"
            title={activityFailureCard(rows.length).title}
            cause={activityFailureCard(rows.length).cause}
            serviceSaid={{ label: SERVICE_SAID, text: activity.error.message }}
          />
        </div>
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
