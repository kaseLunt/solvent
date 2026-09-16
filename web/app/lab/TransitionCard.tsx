import { ChartCard, Heatmap, type HeatCellView } from "@/components/kit";
import { heatIntensity } from "@/lib/lab-geometry";
import type { HeatmapView } from "@/lib/lab-transitions";
import type { EngineReading } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import styles from "./lab.module.css";
import { bookMoney } from "./money";

export function cellsOf(view: HeatmapView): HeatCellView[] {
  const money = bookMoney(view.decimals);
  return view.cells.map((c) => ({
    from: c.from,
    to: c.to,
    count: c.rows,
    title: `${groupInt(c.rows)} account${c.rows === 1 ? "" : "s"} · ${view.bands[c.from]?.label ?? ""} → ${view.bands[c.to]?.label ?? ""} · debt ${money(c.debtBefore)}`,
    movement: c.movement,
    intensity: heatIntensity(c.rows, view.maxRows),
  }));
}

export function finding(view: HeatmapView): string {
  const axes = view.merged
    ? "Rows: room under cap today · columns: after the shock · cells are accounts."
    : "Rows: health-factor lane today · columns: after the shock, as the wire serves them · cells are accounts.";
  const moves = `${groupInt(view.bandChanged)} accounts change band; ${groupInt(view.crossedCap)} cross the cap; ${view.improved === 0 ? "none improve" : `${groupInt(view.improved)} improve`}.`;
  const unmeasured =
    view.unmeasuredRows === 0
      ? ""
      : ` ${groupInt(view.unmeasuredRows)} not measured.`;
  return `${axes} ${moves}${unmeasured}`;
}

function words(reading: EngineReading | null): string {
  if (reading === null) return "Run a scenario to see where accounts move.";
  switch (reading.kind) {
    case "result":
      return finding(reading.result.heat);
    case "withheld":
      return "Withheld: the Cash book was not computed under this scenario.";
    case "not-covered":
      return "This scenario does not model the Cash book.";
    case "contradictory":
    case "unreadable":
      return "Not drawn: the result contradicts itself.";
  }
}

/** Where accounts move (spec §5.4): the transition heatmap, or the state's own word. */
export function TransitionCard({
  reading,
  testId = "lab-transitions",
  gridTestId = "lab-heatmap",
}: {
  reading: EngineReading | null;
  testId?: string;
  gridTestId?: string;
}) {
  const r = reading?.kind === "result" ? reading.result : null;
  const heat = r?.heat ?? null;
  return (
    <ChartCard
      title="Where accounts move"
      testId={testId}
      link={
        r === null
          ? undefined
          : { href: "#movers", label: "Most affected accounts →" }
      }
      finding={<span data-testid={`${testId}-finding`}>{words(reading)}</span>}
    >
      {heat !== null ? (
        <Heatmap
          bands={heat.bands}
          cells={cellsOf(heat)}
          rowsLabel="today"
          colsLabel="after"
          merged={heat.merged}
          testId={gridTestId}
          cellTestIdPrefix={`${gridTestId}-cell`}
        />
      ) : (
        <p className={styles.dim}>
          {reading === null
            ? "No result yet."
            : "No grid: nothing here is a count."}
        </p>
      )}
    </ChartCard>
  );
}
