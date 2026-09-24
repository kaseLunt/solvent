"use client";

import { useState } from "react";
import { BandBars, ChartCard, KpiTile, SectionHead, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { BOOK_CARDS, LEGACY_LINK_LABEL, METHODOLOGY_LABEL } from "@/lib/book-copy";
import { useCashBook } from "@/lib/cash-book";
import { attentionFinding, bandsFinding, bookBars } from "@/lib/cash-summary";
import { cashBookKicker, deriveCashView, deriveLegacyView } from "@/lib/cash-view";
import { useMetaConstants } from "@/lib/meta";
import { BookLegacy } from "./BookLegacy";
import { BookMethodology } from "./BookMethodology";
import { NeedsAttention } from "./NeedsAttention";
import { StressPreview } from "./StressPreview";
import styles from "./book.module.css";

/** The Book (spec 2026-09-15 §5.2): Cash first, money first, one methodology drawer. */
export function BookSurface() {
  const reading = useCashBook();
  const meta = useMetaConstants();
  const [methodOpen, setMethodOpen] = useState(false);
  const view = deriveCashView(reading, meta.constants);
  const { summary, decimals, walking } = view;
  const cash = reading.cash;
  // The legacy block renders only from a view; the section head's anchor to it exists exactly when it does.
  const legacy = deriveLegacyView(reading.legacy);
  // Why the figures are absent is the view's decision: a card prints its line, never one of its own.
  const absentLine = view.absence?.line ?? "";
  const distance = summary === null ? null : bandsFinding(summary);
  const walkFailure =
    cash.walkFailure === null
      ? null
      : { message: cash.walkFailure.message, retryable: cash.walkFailure.register === "transport" };

  return (
    <div className={styles.page} aria-busy={walking ? "true" : undefined}>
      <VerdictHeader
        testId="book-verdict"
        kicker={cashBookKicker(view)}
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={
          <button
            type="button"
            className={`${kit.btn} ${kit.btnGhost}`}
            onClick={() => setMethodOpen(true)}
            data-testid="book-methodology"
          >
            {METHODOLOGY_LABEL}
          </button>
        }
      />
      <SectionHead
        title="Cash"
        testId="book-section-cash"
        qualifier={view.sectionQualifier}
        link={legacy === null ? undefined : { href: "#legacy", label: LEGACY_LINK_LABEL }}
      />
      <div className={kit.kpis}>
        {view.tiles.map((tile) => (
          <KpiTile
            key={tile.id}
            testId={`book-kpi-${tile.id}`}
            label={tile.label}
            value={tile.value}
            sub={tile.sub === "" ? undefined : tile.sub}
            tone={tile.tone}
            pending={tile.pending}
            state={tile.state}
            stateWord={tile.stateWord}
          />
        ))}
      </div>

      <div className={styles.bookGrid}>
        <div className={styles.areaChart}>
          <ChartCard
            title={BOOK_CARDS.bands.title}
            finding={
              distance === null ? (
                absentLine
              ) : (
                <>
                  {distance.lead}
                  <b>{distance.figure}</b>
                  {distance.rest}
                </>
              )
            }
            link={{ onClick: () => setMethodOpen(true), label: BOOK_CARDS.bands.method }}
            testId="book-bands-card"
          >
            {summary !== null && (
              <>
                <BandBars bands={bookBars(summary)} decimals={decimals} weightedBy="value" testId="book-bands" />
                {distance !== null && distance.barsNote !== null && (
                  <p className={styles.note} data-testid="book-bands-note">
                    {distance.barsNote}
                  </p>
                )}
              </>
            )}
          </ChartCard>
        </div>
        <div className={styles.areaAttn}>
          <ChartCard title={BOOK_CARDS.attention.title} finding={summary === null ? absentLine : attentionFinding(summary)}>
            {summary !== null && (
              <NeedsAttention summary={summary} rows={cash.rows} walkFailure={walkFailure} onRetry={reading.reload} />
            )}
          </ChartCard>
        </div>
        {reading.book !== null && (
          <>
            <div className={styles.areaStress}>
              <StressPreview preview={view.preview} />
            </div>
            <div className={styles.areaBad}>
              <ChartCard title={BOOK_CARDS.badDebt.title} testId="book-baddebt" finding={view.badDebtFinding}>
                <p className={styles.note}>{BOOK_CARDS.badDebt.note}</p>
              </ChartCard>
            </div>
          </>
        )}
      </div>

      <BookLegacy view={legacy} />
      <BookMethodology open={methodOpen} onClose={() => setMethodOpen(false)} book={reading.book} withheld={view.withheld} />
    </div>
  );
}
