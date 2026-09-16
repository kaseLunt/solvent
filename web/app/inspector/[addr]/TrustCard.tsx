import { ChartCard, TrustChecklist } from "@/components/kit";
import { historyHead, type InspectorView } from "@/lib/inspector-view";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import styles from "../inspector.module.css";
import { MeasuredSparkline } from "./MeasuredSparkline";

/** What the Trust card says when there is no Cash position to vouch for — in the state's own words. */
function emptyWords(state: InspectorView["state"]): string {
  switch (state) {
    case "loading":
      return "Loading…";
    case "no-position":
      return "No Cash position in this batch — nothing to vouch for.";
    case "legacy-only":
      return "No Cash position in this batch; the legacy position is judged below.";
    case "cannot-compute":
      return "The Cash book is withheld this batch — nothing can be vouched for.";
    case "unavailable":
      return "The lookup could not be completed.";
    default:
      return "Not computed.";
  }
}

/** Trust: the five-item checklist and the room-over-batches mini sparkline with the 10 % line (spec §5.3). */
export function TrustCard({ view }: { view: InspectorView }) {
  const { trust, room } = view;
  const nearLine = Number(NEAR_LINE_TENTHS) / 10;
  const plotted = room?.values.filter((v): v is number => v !== null) ?? [];
  return (
    <ChartCard title="Trust" testId="inspector-trust-card" link={{ href: "/proof", label: "Evidence →" }}>
      {trust === null ? <p className={styles.note}>{emptyWords(view.state)}</p> : <TrustChecklist items={trust} testId="inspector-trust" />}
      <p className={`${styles.note} ${styles.sparkHead}`}>
        {historyHead(view)}
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
