import { ChartCard, SectionHead } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import {
  batchAxisLabel,
  CAP_LINE_LABEL,
  HISTORY_CAPTION,
  HISTORY_QUALIFIER,
  HISTORY_TITLE,
  historyFinding,
  LEGACY_CHART_ARIA,
  LEGACY_CHART_FINDING,
  LEGACY_CHART_TITLE,
  LIQUIDATION_LINE_LABEL,
  NEAR_LINE_LABEL,
  ROOM_CHART_ARIA,
  ROOM_CHART_TITLE,
  type InspectorView,
} from "@/lib/inspector-view";
import { NEAR_LINE_TENTHS, roomDomain } from "@/lib/room-history";
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
    room !== null && first !== undefined && room.newest !== null ? { start: batchAxisLabel(first.batchId), end: batchAxisLabel(room.newest.batchId) } : undefined;
  return (
    <section data-testid="inspector-history">
      <SectionHead title={HISTORY_TITLE} qualifier={HISTORY_QUALIFIER} />
      <div className={legacySeries === null ? undefined : kit.grid}>
        <ChartCard title={ROOM_CHART_TITLE} finding={historyFinding(view)}>
          {room !== null && (
            <MeasuredSparkline
              min={320}
              max={1600}
              fallback={560}
              values={room.values}
              pointTitles={room.titles}
              referenceValue={Number(NEAR_LINE_TENTHS) / 10}
              referenceTone="warn"
              referenceLabel={NEAR_LINE_LABEL}
              boundaryValue={0}
              boundaryLabel={CAP_LINE_LABEL}
              domain={roomDomain(room.values)}
              height={140}
              label={ROOM_CHART_ARIA}
              xLabels={xLabels}
              newestLabel={newestLabel}
            />
          )}
        </ChartCard>
        {legacySeries !== null && (
          <ChartCard title={LEGACY_CHART_TITLE} finding={LEGACY_CHART_FINDING} testId="inspector-history-legacy">
            {/* A health factor of 1.0 IS the liquidation boundary: its line wears crit, never the near-cap warn. */}
            <MeasuredSparkline
              min={240}
              max={1600}
              fallback={420}
              values={legacySeries.values}
              pointTitles={legacySeries.titles}
              referenceValue={1}
              referenceTone="crit"
              referenceLabel={LIQUIDATION_LINE_LABEL}
              height={140}
              label={LEGACY_CHART_ARIA}
            />
          </ChartCard>
        )}
      </div>
      <p className={styles.dim}>{HISTORY_CAPTION}</p>
    </section>
  );
}
