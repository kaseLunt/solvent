import { BandBars, KpiTile, type Band } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { BadDebtEngine, BookEngine, HistogramEngine } from "@/lib/cash-book";
import { humanUsd } from "@/lib/human-usd";
import styles from "./book.module.css";

export interface BookLegacyProps {
  engine: BookEngine | null;
  badDebt: BadDebtEngine | null;
  histogram: HistogramEngine | null;
}

/** The ether.fi Aave v3 market — shown for completeness, labeled legacy, never added to Cash. */
export function BookLegacy({ engine, badDebt, histogram }: BookLegacyProps) {
  if (engine === null) return null;
  const d = engine.value_decimals;
  const bands: Band[] = (histogram?.buckets ?? []).map((b, i) => ({
    id: b.label,
    label: b.label,
    count: b.count,
    value: null,
    tone: i === 0 ? "crit" : i <= 2 ? "warn" : "neutral",
  }));
  const debt = engine.total_debt === null ? "debt withheld" : `${humanUsd(BigInt(engine.total_debt), d)} debt`;
  return (
    <details className={styles.legacy} data-testid="book-legacy" id="legacy">
      <summary>
        Legacy · Aave v3 market — {engine.positions.toLocaleString("en-US")} positions · {debt} ·{" "}
        {String(engine.liquidatable_positions)} liquidatable · {String(engine.refused_positions)} refused
      </summary>
      <p className={styles.note}>
        The ether.fi Aave v3 market is being wound down. Its figures are shown for completeness and are never
        added to the Cash book.
      </p>
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        <KpiTile
          label="Positions"
          value={engine.positions.toLocaleString("en-US")}
          sub={`${engine.computed_positions.toLocaleString("en-US")} computed`}
        />
        <KpiTile
          label="Debt"
          value={engine.total_debt === null ? "—" : humanUsd(BigInt(engine.total_debt), d)}
          tone={engine.total_debt === null ? "refused" : "neutral"}
        />
        <KpiTile
          label="Liquidatable"
          value={String(engine.liquidatable_positions)}
          sub={
            badDebt?.eligible_debt_usd == null
              ? "Σ withheld"
              : `${humanUsd(BigInt(badDebt.eligible_debt_usd), badDebt.usd_decimals)} eligible debt`
          }
          tone={engine.liquidatable_positions > 0 ? "crit" : "neutral"}
        />
        <KpiTile label="Not computed" value={String(engine.refused_positions)} tone="refused" />
      </div>
      {bands.length > 0 && (
        <>
          <p className={styles.note}>Positions by health factor · liquidation at 1.00 · counts, not dollars</p>
          <BandBars bands={bands} decimals={d} weightedBy="count" testId="book-legacy-bands" />
        </>
      )}
    </details>
  );
}
