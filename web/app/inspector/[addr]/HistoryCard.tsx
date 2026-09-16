import { ChartCard, SectionHead } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { historyFinding, type InspectorView } from "@/lib/inspector-view";
import { groupInt } from "@/lib/prose";
import { NEAR_LINE_TENTHS } from "@/lib/room-history";
import styles from "../inspector.module.css";
import { MeasuredSparkline } from "./MeasuredSparkline";

/**
 * History below the fold: room % across batches (Cash), the legacy HF series when the address has one; gaps drawn as
 * gaps. The view decides both series and the finding sentence; this file only places them.
 */
export function HistoryCard({ view }: { view: InspectorView }) {
  const { room, legacySeries } = view;
  // A newest-value label belongs to a PLOTTED newest point (a zero cap has no geometry either); when the newest batch
  // is a gap, no label is printed at an older dot.
  const newestLabel = room !== null && room.newest !== null && room.newest.value !== null ? room.newest.display : undefined;
  // The axis is labelled with real batches or not at all: an empty series has no first batch, and none is manufactured.
  const first = room?.points[0];
  const xLabels =
    room !== null && first !== undefined && room.newest !== null
      ? { start: `batch ${groupInt(first.batchId)}`, end: `batch ${groupInt(room.newest.batchId)}` }
      : undefined;
  const finding = historyFinding(view);
  return (
    <section data-testid="inspector-history">
      <SectionHead title="History" qualifier="room % across batches · gaps drawn as gaps" />
      <div className={legacySeries === null ? undefined : kit.grid}>
        <ChartCard title="Room under the borrow cap" finding={finding}>
          {room !== null && (
            <MeasuredSparkline
              min={320}
              max={1600}
              fallback={560}
              values={room.values}
              pointTitles={room.titles}
              referenceValue={Number(NEAR_LINE_TENTHS) / 10}
              height={140}
              label="room as a percent of the borrow cap, per batch; the dashed line is the 10% near-cap line"
              xLabels={xLabels}
              newestLabel={newestLabel}
            />
          )}
        </ChartCard>
        {legacySeries !== null && (
          <ChartCard title="Legacy · Aave v3 health factor" finding="Judged by its own health factor; liquidatable strictly below 1.0 · dashed line: 1.0" testId="inspector-history-legacy">
            <MeasuredSparkline
              min={240}
              max={1600}
              fallback={420}
              values={legacySeries.values}
              pointTitles={legacySeries.titles}
              referenceValue={1}
              height={140}
              label="health factor per batch (legacy Aave v3 market); the dashed line is 1.0"
            />
          </ChartCard>
        )}
      </div>
      <p className={styles.dim}>
        Cash room per batch is the engine’s own cap ÷ borrowings for that batch. A refused, withheld or missing batch is a gap; the line never draws across it.
      </p>
    </section>
  );
}
