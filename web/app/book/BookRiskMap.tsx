"use client";

// Risk map (spec §3.1): debt size vs liquidation distance — the whale-vs-dust
// picture the table can't show. Severity-colored per the crit-only-from-verdict
// law, one engine at a time (the engine toggle upstream governs both the table
// and this map; the two comparators never share an axis).
//
// BOUNDED BY CONSTRUCTION: the map plots exactly the pages the table has
// loaded, and says so — "N of M loaded / T total". It never downloads the
// book to draw a scatter.
// NOTE(C2): AMENDMENT 1/E-2 adds a BOUNDED server-side risk-map representation
// (deterministic bins + named top-N outliers). When that endpoint lands, this
// client-side projection over loaded pages is replaced by it.

import { parseDecimal, formatUnits } from "@solvent/client";
import { Scatter, type ScatterPoint } from "@/components/charts/Scatter";
import { hfSeverity } from "@/lib/severity";
import { truncateAddress } from "@/lib/format";
import type { PositionRow } from "./positionRow";
import { WARN_BAND_DISCLOSURE } from "./warnBand";
import styles from "./book.module.css";

/** Display-precision percent distance for GEOMETRY (exact strings stay in the table). */
function distanceForGeometry(row: PositionRow): number | null {
  switch (row.liqDistance.kind) {
    case "breached":
      return 0;
    case "distance": {
      // "−7.5%" → -7.5. The display string is exact-derived; this float is
      // geometry only.
      const numeric = Number(row.liqDistance.display.replace("−", "-").replace("%", ""));
      return Number.isFinite(numeric) ? numeric : null;
    }
    default:
      return null;
  }
}

/** log10 of the engine-native debt amount — geometry only. */
function debtForGeometry(row: PositionRow): number | null {
  if (row.totals.debt === null) return null;
  if (parseDecimal(row.totals.debt) <= 0n) return null;
  const numeric = Number(formatUnits(row.totals.debt, row.totals.decimals, { trim: true }));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.log10(numeric);
}

export interface BookRiskMapProps {
  engine: string;
  rows: readonly PositionRow[];
  /** `total_positions` from the page envelope (null on a withheld engine). */
  totalPositions: number | null;
}

export function BookRiskMap({ engine, rows, totalPositions }: BookRiskMapProps) {
  const points: ScatterPoint[] = [];
  let unplottable = 0;

  for (const row of rows) {
    const x = debtForGeometry(row);
    const y = distanceForGeometry(row);
    if (x === null || y === null) {
      unplottable += 1;
      continue;
    }
    points.push({
      id: row.account,
      x,
      y,
      severity: hfSeverity({ verdict: row.verdict, ratio: row.hf.ratio, infinite: row.hf.infinite }),
      title: `${truncateAddress(row.account)} · debt 1e${x.toFixed(1)} · ${
        row.liqDistance.kind === "breached" ? "liquidatable" : row.liqDistance.kind === "distance" ? row.liqDistance.display : "?"
      }`,
    });
  }

  const loadedLabel =
    totalPositions === null
      ? `${String(rows.length)} loaded / total withheld`
      : `${String(rows.length)} loaded / ${String(totalPositions)} total`;

  return (
    <div className={styles.panel} data-testid="book-risk-map">
      <div className={styles.panelHead}>
        <span>risk map · {engine}</span>
        <span className={styles.comparator}>{loadedLabel}</span>
      </div>
      <div className={styles.panelBody}>
        {points.length === 0 ? (
          <div className={styles.emptyReason}>
            nothing plottable yet — {String(rows.length)} row(s) loaded, {String(unplottable)}{" "}
            without both a positive debt and a solvable liq-distance. Load pages above to populate
            the map.
          </div>
        ) : (
          <Scatter
            label={`risk map for ${engine}: debt (log10, engine unit) vs liquidation distance`}
            points={points}
            xLabel="debt (engine unit, log10)"
            yLabel="liq. distance %"
            formatX={(value) => `1e${value.toFixed(1)}`}
            formatY={(value) => `${value.toFixed(0)}%`}
          />
        )}
        <div className={styles.legend}>
          <span>
            <i className={`${styles.legendSwatch} ${styles.ok}`} aria-hidden /> ok
          </span>
          <span title={WARN_BAND_DISCLOSURE}>
            <i className={`${styles.legendSwatch} ${styles.warn}`} aria-hidden /> warn
          </span>
          <span>
            <i className={`${styles.legendSwatch} ${styles.crit}`} aria-hidden /> crit — engine
            verdict only
          </span>
          <span>
            <i className={`${styles.legendSwatch} ${styles.dimmed}`} aria-hidden /> no verdict
          </span>
          <span className={styles.warnDisclosure} data-testid="risk-map-warn-disclosure">
            warn = {WARN_BAND_DISCLOSURE}
          </span>
          {unplottable > 0 && (
            <span>
              {String(unplottable)} loaded row(s) not plottable (refused, no debt, or no solvable
              distance) — counted, not dropped
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
