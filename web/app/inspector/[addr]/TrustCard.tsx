import { ChartCard, TrustChecklist } from "@/components/kit";
import { historyHead, NEAR_LINE_LABEL, ROOM_SPARK_ARIA, TRUST_LINK, TRUST_TITLE, trustEmptyText, type InspectorView } from "@/lib/inspector-view";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import styles from "../inspector.module.css";
import { MeasuredSparkline } from "./MeasuredSparkline";

/** Trust: the five-item checklist and the room-over-batches mini sparkline with the 10 % line (spec §5.3). */
export function TrustCard({ view }: { view: InspectorView }) {
  const { trust, room } = view;
  const nearLine = Number(NEAR_LINE_TENTHS) / 10;
  const plotted = room?.values.filter((v): v is number => v !== null) ?? [];
  return (
    <ChartCard title={TRUST_TITLE} testId="inspector-trust-card" link={{ href: "/proof", label: TRUST_LINK }}>
      {trust === null ? <p className={styles.note}>{trustEmptyText(view)}</p> : <TrustChecklist items={trust} testId="inspector-trust" />}
      <p className={`${styles.note} ${styles.sparkHead}`}>{historyHead(view)}</p>
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
            referenceTone="warn"
            referenceLabel={NEAR_LINE_LABEL}
            height={54}
            label={ROOM_SPARK_ARIA}
            domain={{ min: 0, max: Math.max(nearLine + 2, ...plotted) }}
          />
        </div>
      )}
    </ChartCard>
  );
}
