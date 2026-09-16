"use client";

import { useState } from "react";
import { BandBars, ChartCard, KpiTile, SectionHead, VerdictHeader, type Band } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { useCashBook } from "@/lib/cash-book";
import { deriveCashView } from "@/lib/cash-view";
import { humanUsd } from "@/lib/human-usd";
import { useMetaConstants } from "@/lib/meta";
import { plainCause } from "@/lib/refusal-phrasebook";
import { readWirePopulation } from "@/lib/wireGuard";
import { BookLegacy } from "./BookLegacy";
import { BookMethodology } from "./BookMethodology";
import { NeedsAttention } from "./NeedsAttention";
import { StressPreview } from "./StressPreview";
import styles from "./book.module.css";

const NEAR_BANDS: ReadonlySet<string> = new Set(["0-2", "2-5", "5-10"]);
const bandTone = (id: string): Band["tone"] => (id === "breached" ? "crit" : NEAR_BANDS.has(id) ? "warn" : "neutral");
const bandLabel = (id: string, label: string): string =>
  id === "breached" ? "over cap · liquidatable" : id === "0-2" ? "< 2% room" : id === "50-plus" ? "≥ 50% room" : label;
const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** The Book (spec 2026-09-15 §5.2): Cash first, money first, one methodology drawer. */
export function BookSurface() {
  const reading = useCashBook();
  const meta = useMetaConstants();
  const [methodOpen, setMethodOpen] = useState(false);
  const view = deriveCashView(reading, meta.constants);
  const { summary, decimals, refusedTiles, walking } = view;
  const cash = reading.cash;

  const money = (v: string | null | undefined): string => (v == null ? "—" : humanUsd(BigInt(v), decimals));
  const bands: Band[] = (summary?.bands ?? []).map((b) => ({
    id: b.id,
    label: bandLabel(b.id, b.label),
    count: b.count,
    value: b.debt,
    tone: bandTone(b.id),
  }));
  const nearTenPct = (summary?.bands ?? []).filter((b) => NEAR_BANDS.has(b.id)).reduce((s, b) => s + b.debt, 0n);
  const refusalKey = cash.engine?.refusals[0]?.key;
  const badDebt = refusedTiles ? null : cash.badDebt;
  const badDebtValue = badDebt?.current_bad_debt_usd == null ? null : BigInt(badDebt.current_bad_debt_usd);
  const insolvent =
    badDebt === null || badDebt.insolvent_positions === null
      ? null
      : readWirePopulation(badDebt.insolvent_positions, "bad_debt[debt_manager].insolvent_positions");
  const walkFailure =
    cash.walkFailure === null
      ? null
      : { message: cash.walkFailure.message, retryable: cash.walkFailure.register === "transport" };
  const notComputedLine = refusedTiles ? "Not computed." : "Loading…";
  const walkNote = walking ? " · walking the book, figures are a lower bound" : "";
  const withheldCause = view.withheld === null ? null : plainCause(view.withheld.code, view.withheld.detail);

  return (
    <div className={styles.page} aria-busy={walking ? "true" : undefined}>
      <VerdictHeader
        testId="book-verdict"
        kicker={`Cash book · right now${walking ? " · walking" : ""}`}
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
        qualifier={`Debt Manager engine · OP Mainnet · ${view.positions === null ? "accounts unavailable" : `${view.positions.toLocaleString("en-US")} borrowing accounts`}`}
        link={{ href: "#legacy", label: "Legacy Aave v3 market ↓" }}
      />
      <div className={kit.kpis}>
        <KpiTile
          testId="book-kpi-debt"
          label="Debt outstanding"
          value={refusedTiles ? "—" : money(cash.engine?.total_debt)}
          sub={refusedTiles ? "not computed" : `against ${money(cash.engine?.total_collateral)} collateral`}
          tone={refusedTiles ? "refused" : "neutral"}
        />
        <KpiTile
          testId="book-kpi-liquidatable"
          label="Liquidatable · material"
          value={summary === null ? "—" : humanUsd(summary.material.sum, decimals)}
          sub={
            summary === null
              ? refusedTiles
                ? "not computed"
                : ""
              : `${plural(summary.material.count, "account")} · ${String(summary.belowLine.count)} more under $100`
          }
          tone={refusedTiles ? "refused" : summary !== null && summary.material.count > 0 ? "crit" : "neutral"}
          pending={walking && (summary?.liquidatable.material.length ?? 0) === 0}
        />
        <KpiTile
          testId="book-kpi-near"
          label="Near cap · <10% room"
          value={summary === null ? "—" : humanUsd(summary.nearCap.sum, decimals)}
          sub={summary === null ? (refusedTiles ? "not computed" : "") : `${String(summary.nearCap.count)} accounts`}
          tone={refusedTiles ? "refused" : summary !== null && summary.nearCap.count > 0 ? "warn" : "neutral"}
          pending={walking}
        />
        <KpiTile
          testId="book-kpi-median"
          label="Median room"
          value={summary?.percentiles.median ?? "—"}
          sub={
            summary?.percentiles.p10 == null
              ? refusedTiles
                ? "not computed"
                : "of borrow cap"
              : `of borrow cap · 10th pct ${summary.percentiles.p10}`
          }
          tone={refusedTiles ? "refused" : "neutral"}
          pending={walking}
        />
        <KpiTile
          testId="book-kpi-baddebt"
          label="Standing bad debt"
          value={badDebt === null || badDebtValue === null ? "—" : humanUsd(badDebtValue, badDebt.usd_decimals)}
          sub={
            badDebt === null
              ? refusedTiles
                ? "not computed"
                : "not reported"
              : insolvent === null
                ? "accounts unknown"
                : plural(insolvent, "account")
          }
          tone={badDebt === null || badDebtValue === null ? "refused" : badDebtValue > 0n ? "warn" : "neutral"}
        />
        <KpiTile
          testId="book-kpi-notcomputed"
          label="Not computed"
          value={view.refusedPositions === null ? "—" : String(view.refusedPositions)}
          sub={withheldCause ?? (refusalKey === undefined ? "nothing refused" : plainCause(refusalKey))}
          tone="refused"
        />
      </div>

      <div className={kit.grid}>
        <ChartCard
          title="Distance to liquidation, by debt"
          finding={
            summary === null ? (
              notComputedLine
            ) : (
              <>
                Cash debt grouped by room under the borrow cap · bars are dollars, counts printed ·{" "}
                <b>{humanUsd(nearTenPct, decimals)}</b> sits within 10% of the cap
                {walkNote}
              </>
            )
          }
          link={{ onClick: () => setMethodOpen(true), label: "How the bands are cut →" }}
          testId="book-bands-card"
        >
          {summary === null ? (
            <p className={styles.note}>{notComputedLine}</p>
          ) : (
            <BandBars bands={bands} decimals={decimals} weightedBy="value" testId="book-bands" />
          )}
        </ChartCard>
        <ChartCard title="Needs attention" finding={summary === null ? notComputedLine : `Material first, then by room${walkNote}`}>
          {summary === null ? (
            <p className={styles.note}>{notComputedLine}</p>
          ) : (
            <NeedsAttention summary={summary} rows={cash.rows} walkFailure={walkFailure} onRetry={reading.reload} />
          )}
        </ChartCard>
      </div>

      {reading.book !== null && (
        <div className={kit.grid}>
          <StressPreview preview={withheldCause === null ? view.preview : { kind: "refused", reason: withheldCause }} />
          <ChartCard
            title="Bad debt on the book"
            testId="book-baddebt"
            finding={
              badDebt === null || badDebtValue === null
                ? notComputedLine
                : `${humanUsd(badDebtValue, badDebt.usd_decimals)} of debt is no longer covered by collateral, across ${insolvent === null ? "an unknown number of accounts" : plural(insolvent, "account")}.`
            }
          >
            <p className={styles.note}>
              Standing bad debt is measured, not projected: collateral value today is below the debt it secures.
            </p>
          </ChartCard>
        </div>
      )}

      <BookLegacy engine={reading.legacy.engine} badDebt={reading.legacy.badDebt} histogram={reading.legacy.histogram} />
      <BookMethodology open={methodOpen} onClose={() => setMethodOpen(false)} book={reading.book} />
    </div>
  );
}
