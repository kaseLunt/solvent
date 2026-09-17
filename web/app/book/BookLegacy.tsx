import { BandBars, KpiTile, type Band } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { moneyText, type LegacyView } from "@/lib/cash-view";
import styles from "./book.module.css";

export interface BookLegacyProps {
  view: LegacyView | null;
}

/**
 * The ether.fi Aave v3 market — shown for completeness, labeled legacy, never
 * added to Cash. A withheld engine names its cause and prints no population,
 * no debt and no histogram: a refusal is never a row of zeros.
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
  const population = (value: number | null): string => (value === null ? "—" : value.toLocaleString("en-US"));
  return (
    <details className={styles.legacy} data-testid="book-legacy" id="legacy" data-withheld={view.withheld === null ? undefined : "true"}>
      <summary>{view.summaryLine}</summary>
      <p className={styles.note}>
        The ether.fi Aave v3 market is being wound down. Its figures are shown for completeness and are never
        added to the Cash book.
      </p>
      {view.withheld !== null && (
        <p className={styles.note} data-testid="book-legacy-withheld">
          The engine withheld its whole book this batch: {view.withheld}. Its populations, debt and histogram are not
          computed.
        </p>
      )}
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        <KpiTile
          label="Positions"
          value={population(view.positions)}
          sub={view.withheld !== null ? "not computed" : `${population(view.computed)} computed`}
          tone={view.withheld !== null ? "refused" : "neutral"}
        />
        <KpiTile label="Debt" value={moneyText(view.debt)} tone={view.debt.kind === "value" ? "neutral" : "refused"} />
        <KpiTile
          label="Liquidatable"
          value={population(view.liquidatable)}
          sub={
            view.withheld !== null
              ? "not computed"
              : view.eligibleDebt.kind === "value"
                ? `${view.eligibleDebt.text} eligible debt`
                : "Σ withheld"
          }
          tone={view.withheld !== null ? "refused" : view.liquidatable !== null && view.liquidatable > 0 ? "crit" : "neutral"}
        />
        <KpiTile label="Not computed" value={population(view.refused)} tone="refused" />
      </div>
      {view.histogramWithheld !== null && (
        <p className={styles.note} data-testid="book-legacy-histogram-withheld">
          Histogram withheld: {view.histogramWithheld}.
        </p>
      )}
      {bands.length > 0 && (
        <>
          <p className={styles.note}>Positions by health factor · liquidation at 1.00 · counts, not dollars</p>
          <BandBars bands={bands} decimals={view.decimals} weightedBy="count" testId="book-legacy-bands" />
        </>
      )}
    </details>
  );
}
