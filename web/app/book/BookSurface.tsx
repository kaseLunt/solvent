"use client";

import { useState } from "react";
import { BandBars, ChartCard, KpiTile, SectionHead, VerdictHeader, type Band, type IdentityChip } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { Headline } from "@/lib/book-headline";
import { useCashBook } from "@/lib/cash-book";
import { summarizeCash, unavailableHeadline } from "@/lib/cash-summary";
import { humanAge } from "@/lib/freshness";
import { freshnessTier } from "@/lib/freshnessTiers";
import { humanUsd } from "@/lib/human-usd";
import { useMetaConstants } from "@/lib/meta";
import { plainCause } from "@/lib/refusal-phrasebook";
import { stressPreview } from "@/lib/stress-preview";
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

const LOADING: Headline = {
  variant: "refused",
  tone: "refused",
  emphasis: "Loading the Cash book…",
  rest: "",
  dek: "Fetching the newest batch.",
};

/** The Book (spec 2026-09-15 §5.2): Cash first, money first, one methodology drawer. */
export function BookSurface() {
  const reading = useCashBook();
  const meta = useMetaConstants();
  const [methodOpen, setMethodOpen] = useState(false);

  const cash = reading.cash;
  const decimals = cash.engine?.value_decimals ?? 6;
  const loaded = reading.phase === "ok";
  // Wire populations are classified before render (p1b law): a -0 or a fraction refuses the route.
  const pop = (value: number | undefined, field: string): number =>
    value === undefined ? 0 : readWirePopulation(value, `engines[debt_manager].${field}`);
  const positions = pop(cash.engine?.positions, "positions");
  const computedPositions = pop(cash.engine?.computed_positions, "computed_positions");
  const refusedPositions = pop(cash.engine?.refused_positions, "refused_positions");
  const summary = loaded
    ? summarizeCash({
        rows: cash.rows,
        decimals,
        refusedPositions,
        walkComplete: cash.walkComplete,
        refusedWhole: cash.refusedWhole,
      })
    : null;
  const headline =
    summary?.headline ??
    (reading.phase === "loading" ? LOADING : unavailableHeadline(reading.failure?.message ?? "the service did not answer"));
  const refusedTiles = !loaded || cash.refusedWhole !== null;
  const walking = loaded && cash.refusedWhole === null && !cash.walkComplete && cash.walkFailure === null;

  const ageSeconds = reading.age.unresolved ? null : reading.age.seconds;
  const tier = ageSeconds === null ? null : freshnessTier(ageSeconds, meta.constants);
  const chips: IdentityChip[] =
    !loaded || reading.book === null
      ? []
      : [
          { label: "Batch", value: reading.book.batch.id.toLocaleString("en-US") },
          {
            label: "Snapshot",
            value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(),
            tone: tier === null ? "refused" : tier === "fresh" ? "ok" : tier === "aging" ? "warn" : "crit",
          },
          {
            label: "Coverage",
            value: `${computedPositions.toLocaleString("en-US")} / ${positions.toLocaleString("en-US")} computed`,
          },
          { label: "Current", value: "not projected" },
        ];

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
  const badDebt = cash.badDebt;
  const badDebtValue = badDebt?.current_bad_debt_usd == null ? null : BigInt(badDebt.current_bad_debt_usd);
  const insolvent =
    badDebt === null || badDebt.insolvent_positions === null
      ? null
      : readWirePopulation(badDebt.insolvent_positions, "bad_debt[debt_manager].insolvent_positions");
  const preview =
    reading.book === null || reading.book.waterfall === null ? null : stressPreview(reading.book.waterfall, "debt_manager");
  const walkFailure =
    cash.walkFailure === null
      ? null
      : { message: cash.walkFailure.message, retryable: cash.walkFailure.register === "transport" };
  const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className={styles.page}>
      <VerdictHeader
        testId="book-verdict"
        kicker="Cash book · right now"
        emphasis={headline.emphasis}
        rest={headline.rest}
        tone={headline.tone}
        dek={headline.dek}
        chips={chips}
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
        qualifier={`Debt Manager engine · OP Mainnet · ${positions.toLocaleString("en-US")} borrowing accounts`}
        link={{ href: "#legacy", label: "Legacy Aave v3 market ↓" }}
      />
      <div className={kit.kpis}>
        <KpiTile
          testId="book-kpi-debt"
          label="Debt outstanding"
          value={money(cash.engine?.total_debt)}
          sub={`against ${money(cash.engine?.total_collateral)} collateral`}
          tone={refusedTiles ? "refused" : "neutral"}
        />
        <KpiTile
          testId="book-kpi-liquidatable"
          label="Liquidatable · material"
          value={summary === null ? "—" : humanUsd(summary.material.sum, decimals)}
          sub={
            summary === null
              ? ""
              : `${plural(summary.material.count, "account")} · ${String(summary.belowLine.count)} more under $100`
          }
          tone={refusedTiles ? "refused" : summary !== null && summary.material.count > 0 ? "crit" : "neutral"}
          pending={walking && (summary?.liquidatable.material.length ?? 0) === 0}
        />
        <KpiTile
          testId="book-kpi-near"
          label="Near cap · <10% room"
          value={summary === null ? "—" : humanUsd(summary.nearCap.sum, decimals)}
          sub={summary === null ? "" : `${String(summary.nearCap.count)} accounts`}
          tone={refusedTiles ? "refused" : summary !== null && summary.nearCap.count > 0 ? "warn" : "neutral"}
          pending={walking}
        />
        <KpiTile
          testId="book-kpi-median"
          label="Median room"
          value={summary?.percentiles.median ?? "—"}
          sub={summary?.percentiles.p10 == null ? "of borrow cap" : `of borrow cap · 10th pct ${summary.percentiles.p10}`}
          tone={refusedTiles ? "refused" : "neutral"}
          pending={walking}
        />
        <KpiTile
          testId="book-kpi-baddebt"
          label="Standing bad debt"
          value={badDebt === null || badDebtValue === null ? "—" : humanUsd(badDebtValue, badDebt.usd_decimals)}
          sub={badDebt === null ? "" : insolvent === null ? "accounts unknown" : plural(insolvent, "account")}
          tone={refusedTiles ? "refused" : badDebtValue !== null && badDebtValue > 0n ? "warn" : "neutral"}
        />
        <KpiTile
          testId="book-kpi-notcomputed"
          label="Not computed"
          value={cash.engine === null ? "—" : String(refusedPositions)}
          sub={refusalKey === undefined ? "nothing refused" : plainCause(refusalKey)}
          tone="refused"
        />
      </div>

      <div className={kit.grid}>
        <ChartCard
          title="Distance to liquidation, by debt"
          finding={
            <>
              Cash debt grouped by room under the borrow cap · bars are dollars, counts printed ·{" "}
              <b>{humanUsd(nearTenPct, decimals)}</b> sits within 10% of the cap
            </>
          }
          link={{ onClick: () => setMethodOpen(true), label: "How the bands are cut →" }}
          testId="book-bands-card"
        >
          {summary === null ? (
            <p className={styles.note}>{refusedTiles ? "Not computed." : "Loading…"}</p>
          ) : (
            <BandBars bands={bands} decimals={decimals} weightedBy="value" testId="book-bands" />
          )}
        </ChartCard>
        <ChartCard title="Needs attention" finding="Material first, then by room">
          {summary === null ? (
            <p className={styles.note}>{refusedTiles ? "Not computed." : "Loading…"}</p>
          ) : (
            <NeedsAttention summary={summary} rows={cash.rows} walkFailure={walkFailure} onRetry={reading.reload} />
          )}
        </ChartCard>
      </div>

      {reading.book !== null && (
        <div className={kit.grid}>
          <StressPreview preview={preview} />
          <ChartCard
            title="Bad debt on the book"
            testId="book-baddebt"
            finding={
              badDebt === null || badDebtValue === null
                ? "Not reported."
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
