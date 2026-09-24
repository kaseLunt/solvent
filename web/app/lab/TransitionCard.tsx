import { ChartCard, Heatmap, type HeatCellView } from "@/components/kit";
import { heatIntensity } from "@/lib/lab-geometry";
import type { HeatmapView } from "@/lib/lab-transitions";
import { HEAT_COLS, HEAT_ROWS, heatCellTitle, MOVERS_LINK, NO_GRID, NO_RESULT_YET, transitionWords, type EngineReading } from "@/lib/lab-view";
import styles from "./lab.module.css";

export function cellsOf(view: HeatmapView): HeatCellView[] {
  return view.cells.map((c) => ({
    from: c.from,
    to: c.to,
    count: c.rows,
    title: heatCellTitle(view, c),
    movement: c.movement,
    // One maximum for the whole grid, so one opacity means one count in every movement class.
    intensity: heatIntensity(c.rows, view.maxRows),
  }));
}

/** Where accounts move (spec §5.4): the transition heatmap, or the state's own word. */
export function TransitionCard({
  reading,
  engine,
  testId = "lab-transitions",
  gridTestId = "lab-heatmap",
}: {
  reading: EngineReading | null;
  /** The engine this card reads — its refusal words name it. */
  engine: string;
  testId?: string;
  gridTestId?: string;
}) {
  const r = reading?.kind === "result" ? reading.result : null;
  const heat = r?.heat ?? null;
  return (
    <ChartCard
      title="Where accounts move"
      testId={testId}
      link={r === null ? undefined : { href: "#movers", label: MOVERS_LINK }}
      finding={<span data-testid={`${testId}-finding`}>{transitionWords(reading, engine)}</span>}
    >
      {heat !== null ? (
        <Heatmap
          bands={heat.bands}
          cells={cellsOf(heat)}
          rowsLabel={HEAT_ROWS}
          colsLabel={HEAT_COLS}
          merged={heat.merged}
          testId={gridTestId}
          cellTestIdPrefix={`${gridTestId}-cell`}
        />
      ) : (
        <p className={styles.dim}>{reading === null ? NO_RESULT_YET : NO_GRID}</p>
      )}
    </ChartCard>
  );
}
