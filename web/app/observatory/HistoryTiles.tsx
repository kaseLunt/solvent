import { KpiTile } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { HISTORY_TILES, type HistoryTile } from "@/lib/history-view";

/**
 * Debt · Collateral · Accounts · Liquidatable positions — the four metrics at the newest recorded hour. The same
 * four render pending while the series loads; a refused record (degraded, unavailable) renders none, because a tile
 * with no reading behind it would look like an answer.
 */
export function HistoryTiles({ tiles, pending }: { tiles: readonly HistoryTile[]; pending: boolean }) {
  if (tiles.length === 0 && !pending) return null;
  const shown: readonly HistoryTile[] =
    tiles.length > 0
      ? tiles
      : HISTORY_TILES.map((spec) => ({ key: spec.key, label: spec.label, value: "", sub: "", tone: "neutral" }));
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
        />
      ))}
    </div>
  );
}
