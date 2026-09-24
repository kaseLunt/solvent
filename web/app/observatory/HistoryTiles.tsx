import { KpiTile } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { historyTiles, type HistoryTile } from "@/lib/history-view";

/**
 * Debt · Collateral · Accounts · the liquidatable count — the four metrics at the newest recorded hour, each with its
 * change since the window's first recorded hour. The same four render pending while the series loads; a record the
 * page cannot show (not served, unavailable, unreadable) renders none, because a tile with no reading behind it would
 * look like an answer — its card stands in the chart's place instead.
 */
export function HistoryTiles({ engine, tiles, pending }: { engine: string; tiles: readonly HistoryTile[]; pending: boolean }) {
  if (tiles.length === 0 && !pending) return null;
  const shown: readonly HistoryTile[] =
    tiles.length > 0
      ? tiles
      : historyTiles(engine).map((spec) => ({ key: spec.key, label: spec.label, value: "", sub: "", tone: "neutral", state: null, stateWord: null }));
  return (
    <div className={`${kit.kpis} ${kit.kpis4}`} data-testid="history-tiles">
      {shown.map((tile) => (
        <KpiTile
          key={tile.key}
          testId={`history-kpi-${tile.key}`}
          label={tile.label}
          value={tile.value}
          sub={tile.sub === "" ? undefined : tile.sub}
          tone={tile.tone}
          pending={pending}
          state={tile.state ?? undefined}
          stateWord={tile.stateWord ?? undefined}
        />
      ))}
    </div>
  );
}
