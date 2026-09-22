"use client";

import { useState } from "react";
import { BandBars, ChartCard, KpiTile, SectionHead, VerdictHeader, type Band } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useCashBook } from "@/lib/cash-book";
import { BAD_DEBT_NOT_REPORTED } from "@/lib/cash-refusal";
import { NEAR_CAP_BAND_IDS } from "@/lib/cash-rows";
import { attentionFinding, bandsFinding, bandsSoFar, liquidatableTile, liquidatableTileLabel, nearCapTile } from "@/lib/cash-summary";
import { deriveCashView, deriveLegacyView, malformedSub, moneyText } from "@/lib/cash-view";
import { useMetaConstants } from "@/lib/meta";
import { BookLegacy } from "./BookLegacy";
import { BookMethodology } from "./BookMethodology";
import { NeedsAttention } from "./NeedsAttention";
import { StressPreview } from "./StressPreview";
import styles from "./book.module.css";

const bandTone = (id: string): Band["tone"] => (id === "breached" ? "crit" : NEAR_CAP_BAND_IDS.has(id) ? "warn" : "neutral");
const bandLabel = (id: string, label: string): string =>
  id === "breached" ? "over cap · liquidatable" : id === "0-2" ? "< 2% room" : id === "50-plus" ? "≥ 50% room" : label;
const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** The Book (spec 2026-09-15 §5.2): Cash first, money first, one methodology drawer. */
export function BookSurface() {
  const reading = useCashBook();
  const meta = useMetaConstants();
  const [methodOpen, setMethodOpen] = useState(false);
  const view = deriveCashView(reading, meta.constants);
  const { summary, decimals, refusedTiles, walking, walkStopped } = view;
  const cash = reading.cash;
  // The legacy block renders only from a view; the section head's anchor to it exists exactly when it does.
  const legacy = deriveLegacyView(reading.legacy);
  // Why the figures are absent is the view's decision: a tile and a card print its word, never one of their own.
  const absentWord = view.absence?.word ?? "";
  const absentLine = view.absence?.line ?? "";

  const bands: Band[] = (summary === null ? [] : bandsSoFar(summary)).map((b) => ({
    id: b.id,
    label: bandLabel(b.id, b.label),
    count: b.count,
    value: b.debt,
    tone: bandTone(b.id),
  }));
  const distance = summary === null ? null : bandsFinding(summary);
  const badDebt = view.badDebt;
  const walkFailure =
    cash.walkFailure === null
      ? null
      : { message: cash.walkFailure.message, retryable: cash.walkFailure.register === "transport" };
  // The Debt, Liquidatable and Near-cap tiles are the lib's decision — figure, sub line, register — printed as given.
  const debtTile = view.debtTile;
  const liquidatable = liquidatableTile(summary, absentWord);
  const nearCap = nearCapTile(summary, absentWord);

  return (
    <div className={styles.page} aria-busy={walking ? "true" : undefined}>
      <VerdictHeader
        testId="book-verdict"
        kicker={`Cash book · right now${walking ? " · walking" : walkStopped !== null ? " · walk stopped" : ""}`}
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
            Methodology &amp; evidence
          </button>
        }
      />
      <SectionHead
        title="Cash"
        testId="book-section-cash"
        qualifier={view.sectionQualifier}
        link={legacy === null ? undefined : { href: "#legacy", label: "Legacy Aave v3 market ↓" }}
      />
      <div className={kit.kpis}>
        <KpiTile
          testId="book-kpi-debt"
          label="Debt outstanding"
          value={debtTile.value}
          sub={debtTile.sub}
          tone={debtTile.tone}
          pending={debtTile.pending}
        />
        <KpiTile
          testId="book-kpi-liquidatable"
          label={liquidatableTileLabel}
          value={liquidatable.value}
          sub={liquidatable.sub}
          tone={liquidatable.tone}
          pending={liquidatable.pending}
        />
        <KpiTile
          testId="book-kpi-near"
          label="Near cap · <10% room"
          value={nearCap.value}
          sub={nearCap.sub}
          tone={nearCap.tone}
          pending={nearCap.pending}
        />
        <KpiTile
          testId="book-kpi-median"
          label="Median room"
          value={summary === null || walkStopped !== null ? "—" : (summary.percentiles.median ?? "—")}
          sub={
            summary === null
              ? absentWord
              : walkStopped !== null
                ? "walk stopped"
                : summary.percentiles.p10 === null
                  ? "of borrow cap"
                  : `of borrow cap · 10th pct ${summary.percentiles.p10}`
          }
          tone={refusedTiles || walkStopped !== null ? "refused" : "neutral"}
          pending={walking}
        />
        <KpiTile
          testId="book-kpi-baddebt"
          label="Standing bad debt"
          value={badDebt === null ? "—" : moneyText(badDebt.reading)}
          sub={
            badDebt === null
              ? refusedTiles
                ? absentWord
                : "not reported"
              : badDebt.reading.kind === "malformed"
                ? malformedSub(badDebt.reading.field)
                : (badDebt.cause ?? (badDebt.insolvent === null ? "accounts unknown" : plural(badDebt.insolvent, "account")))
          }
          tone={
            badDebt === null || badDebt.reading.kind !== "value" ? "refused" : badDebt.reading.value > 0n ? "warn" : "neutral"
          }
        />
        <KpiTile
          testId="book-kpi-notcomputed"
          label="Not computed"
          value={view.notComputedTile.value}
          sub={view.notComputedTile.sub}
          tone="refused"
        />
      </div>

      <div className={kit.grid}>
        <ChartCard
          title="Distance to liquidation, by debt"
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
          link={{ onClick: () => setMethodOpen(true), label: "How the bands are cut →" }}
          testId="book-bands-card"
        >
          {summary === null ? (
            <p className={styles.note}>{absentLine}</p>
          ) : (
            <>
              <BandBars bands={bands} decimals={decimals} weightedBy="value" testId="book-bands" />
              {distance !== null && distance.barsNote !== null && (
                <p className={styles.note} data-testid="book-bands-note">
                  {distance.barsNote}
                </p>
              )}
            </>
          )}
        </ChartCard>
        <ChartCard title="Needs attention" finding={summary === null ? absentLine : attentionFinding(summary)}>
          {summary === null ? (
            <p className={styles.note}>{absentLine}</p>
          ) : (
            <NeedsAttention summary={summary} rows={cash.rows} walkFailure={walkFailure} onRetry={reading.reload} />
          )}
        </ChartCard>
      </div>

      {reading.book !== null && (
        <div className={kit.grid}>
          <StressPreview preview={view.preview} />
          <ChartCard
            title="Bad debt on the book"
            testId="book-baddebt"
            finding={
              badDebt === null
                ? refusedTiles
                  ? absentLine
                  : BAD_DEBT_NOT_REPORTED
                : badDebt.reading.kind === "malformed"
                  ? `Standing bad debt is unreadable: ${malformedSub(badDebt.reading.field)}.`
                  : badDebt.reading.kind === "absent"
                    ? (badDebt.cause === null ? BAD_DEBT_NOT_REPORTED : `Standing bad debt withheld: ${badDebt.cause}.`)
                    : `${badDebt.reading.text} of debt is no longer covered by collateral, across ${badDebt.insolvent === null ? "an unknown number of accounts" : plural(badDebt.insolvent, "account")}.`
            }
          >
            <p className={styles.note}>
              Standing bad debt is measured, not projected: collateral value today is below the debt it secures.
            </p>
          </ChartCard>
        </div>
      )}

      <BookLegacy view={legacy} />
      <BookMethodology open={methodOpen} onClose={() => setMethodOpen(false)} book={reading.book} withheld={view.withheld} />
    </div>
  );
}
