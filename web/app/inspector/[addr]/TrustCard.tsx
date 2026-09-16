import { ChartCard, TrustChecklist } from "@/components/kit";
import type { InspectorView } from "@/lib/inspector-view";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import styles from "../inspector.module.css";
import { MeasuredSparkline } from "./MeasuredSparkline";

/** Trust: the five-item checklist and the room-over-batches mini sparkline with the 10 % line (spec §5.3). */
export function TrustCard({ view }: { view: InspectorView }) {
  const { trust, room } = view;
  const nearLine = Number(NEAR_LINE_TENTHS) / 10;
  const plotted = room?.values.filter((v): v is number => v !== null) ?? [];
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
        <div className={styles.spark}>
          <MeasuredSparkline
            testId="inspector-room-spark"
            min={160}
            max={1600}
            fallback={320}
            values={room.values}
            pointTitles={room.titles}
            referenceValue={nearLine}
            height={54}
            label="room as a percent of the borrow cap, per batch; the dashed line is the 10% near-cap line; gaps are batches the engine refused, withheld or never wrote"
            domain={{ min: 0, max: Math.max(nearLine + 2, ...plotted) }}
          />
          <span className={styles.sparkLabel} aria-hidden="true">
            10% line
          </span>
        </div>
      )}
    </ChartCard>
  );
}
