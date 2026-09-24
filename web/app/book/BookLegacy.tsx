import { BandBars, KpiTile, LegacyFold, type Band } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { LegacyTile, LegacyView } from "@/lib/cash-view";
import { LEGACY_FOLD_TITLE } from "@/lib/prose";
import styles from "./book.module.css";

export interface BookLegacyProps {
  view: LegacyView | null;
}

function Tile({ tile, testId }: { tile: LegacyTile; testId?: string }) {
  return (
    <KpiTile
      label={tile.label}
      value={tile.value}
      sub={tile.sub}
      tone={tile.tone}
      state={tile.state}
      stateWord={tile.stateWord}
      testId={testId}
    />
  );
}

/**
 * The ether.fi Aave v3 market — shown for completeness, labeled legacy, never
 * added to Cash, folded after all Cash content. A withheld engine names its
 * cause and prints no population, no debt and no histogram: a refusal is never
 * a row of zeros. Where the engine computed no position and refused some, the
 * view holds no debt, no liquidatable count and no bars: those tiles say so in
 * the view's words, and the view's note stands where the histogram would.
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
    <LegacyFold title={LEGACY_FOLD_TITLE} summary={view.summary} id="legacy" testId="book-legacy">
      <p className={styles.foldNote}>{view.note}</p>
      {view.withheldNote !== null && (
        <p className={styles.foldNote} data-testid="book-legacy-withheld">
          {view.withheldNote}
        </p>
      )}
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        <Tile tile={positions} />
        <Tile tile={debt} testId="book-legacy-kpi-debt" />
        <Tile tile={liquidatable} testId="book-legacy-kpi-liquidatable" />
        <Tile tile={notComputed} />
      </div>
      {view.histogramWithheldNote !== null && (
        <p className={styles.foldNote} data-testid="book-legacy-histogram-withheld">
          {view.histogramWithheldNote}
        </p>
      )}
      {view.bandsNote !== null && (
        <p className={styles.foldNote} data-testid="book-legacy-bands-note">
          {view.bandsNote}
        </p>
      )}
      {bands.length > 0 && (
        <>
          <p className={styles.foldNote}>{view.bandsCaption}</p>
          <BandBars bands={bands} decimals={view.decimals} weightedBy="count" testId="book-legacy-bands" />
        </>
      )}
    </LegacyFold>
  );
}
