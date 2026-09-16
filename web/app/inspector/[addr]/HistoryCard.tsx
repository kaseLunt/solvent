import { ChartCard, SectionHead } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { AddressReading } from "@/lib/address-lookup";
import { buildHistorySeries, engineNeverPresent, knownBatchAxis } from "@/lib/history-series";
import { LEGACY } from "@/lib/inspector-position";
import type { InspectorView } from "@/lib/inspector-view";
import { NEAR_LINE_TENTHS, type RoomPointKind } from "@/lib/room-history";
import styles from "../inspector.module.css";
import { MeasuredSparkline } from "./MeasuredSparkline";

const n = (v: number): string => v.toLocaleString("en-US");
const KIND_WORD: Record<RoomPointKind, string> = {
  computed: "computed",
  refused: "not computed",
  withheld: "withheld",
  "no-row": "absent",
  unpublished: "unpublished",
  "zero-cap": "a zero cap",
};

/** History below the fold: room % across batches (Cash), the legacy HF series when the address has one; gaps drawn as gaps. */
export function HistoryCard({ view, reading }: { view: InspectorView; reading: AddressReading }) {
  const { room, streak } = view;
  const history = reading.history;
  const vantage =
    view.historyBatchId !== null && view.batchId !== null && view.historyBatchId !== view.batchId
      ? ` · history as of batch ${n(view.historyBatchId)}, position as of batch ${n(view.batchId)}`
      : "";
  // The API lists every engine in the window even with zero points: a legacy chart exists only when the
  // engine was ever present, and it shares the response's whole batch axis so its gaps are the Cash chart's gaps.
  const found = history.phase === "ready" && history.value.outcome === "found" ? history.value.response : null;
  const legacyEngine = found?.engines.find((e) => e.engine === LEGACY) ?? null;
  const legacySeries = found === null || legacyEngine === null || engineNeverPresent(legacyEngine) ? null : buildHistorySeries(legacyEngine, knownBatchAxis(found));
  // A newest-value label belongs to a PLOTTED newest point (a zero cap has no geometry either); when the newest batch
  // is a gap, no label is printed at an older dot.
  const newestLabel = room !== null && room.newest !== null && room.newest.value !== null ? room.newest.display : undefined;
  const newestKind = streak?.newestKind ?? null;
  const finding =
    history.phase === "loading"
      ? "Loading history…"
      : history.phase === "error"
        ? `History unavailable: ${history.message}`
        : view.historyOutcome === "unknowable"
          ? "The history is withheld this batch — it cannot be established, and that is never “no history”."
          : view.historyOutcome === "not-found"
            ? "No history for this account in the covered window."
            : room === null
              ? "No Cash history for this account in the covered window."
          : newestKind !== null && newestKind !== "computed" && newestKind !== "zero-cap"
            ? `The newest batch is ${KIND_WORD[newestKind]}; the streak cannot be read${vantage} · dashed line: 10% of cap`
            : streak !== null && streak.batches >= 2
              ? `Within 10% of its cap for the last ${String(streak.batches)} batches${vantage} · dashed line: 10% of cap`
              : `Room has stayed above the 10% line in the newest batch${vantage} · dashed line: 10% of cap`;
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
              xLabels={{ start: `batch ${n(room.points[0]?.batchId ?? 0)}`, end: `batch ${n(room.newest?.batchId ?? 0)}` }}
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
