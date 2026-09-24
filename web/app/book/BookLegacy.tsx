import { BandBars, KpiTile, type Band } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { LegacyView } from "@/lib/cash-view";
import styles from "./book.module.css";

export interface BookLegacyProps {
  view: LegacyView | null;
}

/**
 * The ether.fi Aave v3 market — shown for completeness, labeled legacy, never
 * added to Cash. A withheld engine names its cause and prints no population,
 * no debt and no histogram: a refusal is never a row of zeros. Where the
 * engine computed no position and refused some, the view holds no debt, no
 * liquidatable count and no bars: those tiles say not computed as the line
 * does, and the view's note stands where the histogram would.
 */
export function BookLegacy({ view }: BookLegacyProps) {
  if (view === null) return null;
  const bands: Band[] = (view.bands ?? []).map((b, i) => ({
    id: b.id,
    label: b.label,
    count: b.count,
    value: null,
    tone: i === 0 ? "crit" : i <= 2 ? "warn" : "neutral",
  }));
  const { positions, debt, liquidatable, notComputed } = view.tiles;
  return (
    <details className={styles.legacy} data-testid="book-legacy" id="legacy" data-withheld={view.withheld === null ? undefined : "true"}>
      <summary>{view.summaryLine}</summary>
      <p className={styles.note}>{view.note}</p>
      {view.withheldNote !== null && (
        <p className={styles.note} data-testid="book-legacy-withheld">
          {view.withheldNote}
        </p>
      )}
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        <KpiTile {...positions} />
        <KpiTile {...debt} testId="book-legacy-kpi-debt" />
        <KpiTile {...liquidatable} testId="book-legacy-kpi-liquidatable" />
        <KpiTile {...notComputed} />
      </div>
      {view.histogramWithheldNote !== null && (
        <p className={styles.note} data-testid="book-legacy-histogram-withheld">
          {view.histogramWithheldNote}
        </p>
      )}
      {view.bandsNote !== null && (
        <p className={styles.note} data-testid="book-legacy-bands-note">
          {view.bandsNote}
        </p>
      )}
      {bands.length > 0 && (
        <>
          <p className={styles.note}>{view.bandsCaption}</p>
          <BandBars bands={bands} decimals={view.decimals} weightedBy="count" testId="book-legacy-bands" />
        </>
      )}
    </details>
  );
}
