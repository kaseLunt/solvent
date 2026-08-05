// Per-engine stat rows (spec §3.1): collateral counted / debt / liquidatable /
// refused, each with its coverage denominator — an aggregate without its
// denominator is not a disclosure. Engines are NEVER combined: one block per
// engine, no blended totals anywhere on this surface.
//
// WAVE W-3L — ON THE SECTION TEMPLATE (chart spec v4 §1).
//
//   HEAD      engine chip, and on the refused arm its RefusedTag + detail.
//   STATE     the position split, held OPEN whenever refused_positions > 0.
//   ANSWER    one computed sentence: count of denominator, plus the Σ.
//   VISUAL    the four cards. They are also the LEDGER: each value is the
//             exact served number, so there is no second copy to align to.
//   METHOD    comparator + engines-never-combined + the wire's unit_note.
//   FORENSICS the position split, and ONLY when refused_positions === 0. With
//             refusals present the split is the counted-aside-with-refusals
//             case and the inventory forbids the expandable outright.
//
// The withheld-engine block stays single-layer end to end: em-dashed values,
// RefusedTag, the reason, and no <details> anywhere in it.

import type { Aggregate, BadDebt } from "@solvent/client";
import { StatCard } from "@/components/StatCard";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { renderEngineAmount, groupDecimalString } from "@/lib/book-format";
import { EM_DASH } from "@/lib/format";
import {
  ENGINE_STATS_FORENSICS_SUMMARY,
  LIQUIDATABLE_CARD_METHOD,
  engineStatsAnswer,
  engineStatsMethod,
  engineStatsSplitLine,
  engineStatsWithheldAnswer,
  liquidatableCardSub,
} from "./readingLines";
import styles from "./book.module.css";

function refusalBreakdown(aggregate: Aggregate): string {
  if (aggregate.refusals.length === 0) return "none";
  return aggregate.refusals.map((count) => `${count.key} ×${String(count.count)}`).join(" · ");
}

function EngineStats({
  aggregate,
  badDebt,
}: {
  aggregate: Aggregate;
  badDebt: BadDebt | undefined;
}) {
  const denominator = `${groupDecimalString(String(aggregate.computed_positions))}/${groupDecimalString(
    String(aggregate.positions),
  )} positions counted`;

  if (aggregate.refused) {
    // The WHOLE engine is withheld: totals are null and render as em dashes —
    // a refusal is the absence of a number, and zero is a number. Nothing in
    // this arm collapses.
    return (
      <div className={styles.engineBlock} data-testid={`book-stats-${aggregate.engine}`}>
        {/* ---- SLOT 1: HEAD ---- */}
        <div className={styles.engineHead}>
          <EngineChip engine={aggregate.engine} />
          {aggregate.refusal !== null && <RefusedTag reason={aggregate.refusal.code} />}
          <span>{aggregate.refusal?.detail ?? "engine withheld on this batch"}</span>
        </div>

        {/* ---- SLOT 3: ANSWER — the withholding IS the answer ---- */}
        <p className={styles.answerLine} data-testid={`book-stats-answer-${aggregate.engine}`}>
          {engineStatsWithheldAnswer(aggregate)}
        </p>

        {/* ---- SLOT 4/5: VISUAL + LEDGER ---- */}
        <div className={styles.statrow}>
          <StatCard
            label="Collateral (counted)"
            value={EM_DASH}
            sub="withheld, no number served"
            testId={`book-stat-collateral-${aggregate.engine}`}
          />
          <StatCard
            label="Debt"
            value={EM_DASH}
            sub="withheld, no number served"
            testId={`book-stat-debt-${aggregate.engine}`}
          />
          <StatCard
            label="Liquidatable"
            value={EM_DASH}
            sub="no verdicts were computed"
            testId={`book-stat-liquidatable-${aggregate.engine}`}
          />
          <StatCard
            label="Refused"
            value="whole engine"
            tone="warn"
            sub={aggregate.refusal?.code ?? "engine refusal"}
            testId={`book-stat-refused-${aggregate.engine}`}
          />
        </div>

        {/* ---- SLOT 6: METHOD ---- */}
        <p className={styles.methodLine} data-testid={`book-stats-method-${aggregate.engine}`}>
          {engineStatsMethod(aggregate)}
        </p>
      </div>
    );
  }

  // R3 / inventory hazard: with refusals counted in the split, the split is
  // refusal-class content and may not sit behind a summary.
  const splitCollapsible = aggregate.refused_positions === 0;

  return (
    <div className={styles.engineBlock} data-testid={`book-stats-${aggregate.engine}`}>
      {/* ---- SLOT 1: HEAD ---- */}
      <div className={styles.engineHead}>
        <EngineChip engine={aggregate.engine} />
      </div>

      {/* ---- SLOT 2: STATE — open whenever the split counts refusals ---- */}
      {!splitCollapsible && (
        <div className={styles.stateSlot} data-testid={`book-stats-state-${aggregate.engine}`}>
          <span data-testid={`book-stats-split-${aggregate.engine}`}>
            {engineStatsSplitLine(aggregate)}
          </span>
          <span data-testid={`book-stats-refusals-${aggregate.engine}`}>
            refusal codes: {refusalBreakdown(aggregate)}. Refused positions are counted here and
            never computed away.
          </span>
        </div>
      )}

      {/* ---- SLOT 3: ANSWER — computed from this same aggregate (R4) ---- */}
      <p className={styles.answerLine} data-testid={`book-stats-answer-${aggregate.engine}`}>
        {engineStatsAnswer(aggregate, badDebt)}
      </p>

      {/* ---- SLOT 4/5: VISUAL + LEDGER — the cards ARE the exact numbers ---- */}
      <div className={styles.statrow}>
        <StatCard
          label="Collateral (counted)"
          value={renderEngineAmount(aggregate.total_collateral, aggregate.value_decimals)}
          sub={denominator}
          testId={`book-stat-collateral-${aggregate.engine}`}
        />
        <StatCard
          label="Debt"
          value={renderEngineAmount(aggregate.total_debt, aggregate.value_decimals)}
          sub={denominator}
          testId={`book-stat-debt-${aggregate.engine}`}
        />
        <StatCard
          label="Liquidatable"
          value={
            <>
              <span className={aggregate.liquidatable_positions > 0 ? "crit-t" : undefined}>
                {String(aggregate.liquidatable_positions)}
              </span>{" "}
              / {String(aggregate.computed_positions)}
            </>
          }
          /* The Σ rode this sub until W-3L. It now rides the ANSWER, which is
             where the adjective it qualifies is actually read. */
          sub={liquidatableCardSub(aggregate.computed_positions)}
          method={LIQUIDATABLE_CARD_METHOD}
          testId={`book-stat-liquidatable-${aggregate.engine}`}
        />
        <StatCard
          label="Refused"
          value={String(aggregate.refused_positions)}
          tone={aggregate.refused_positions > 0 ? "warn" : "default"}
          /* HAZARD: the breakdown rides the card, so it is visible on every
             render. It never moves into the expandable below. */
          sub={refusalBreakdown(aggregate)}
          testId={`book-stat-refused-${aggregate.engine}`}
        />
      </div>

      {/* ---- SLOT 6: METHOD ---- */}
      <p className={styles.methodLine} data-testid={`book-stats-method-${aggregate.engine}`}>
        {engineStatsMethod(aggregate)}
      </p>

      {/* ---- SLOT 7: FORENSICS — legal ONLY with zero refused positions ---- */}
      {splitCollapsible && (
        <details className={styles.disclosure} data-testid={`book-stats-forensics-${aggregate.engine}`}>
          <summary>{ENGINE_STATS_FORENSICS_SUMMARY}</summary>
          <p className={styles.forensicsLine} data-testid={`book-stats-split-${aggregate.engine}`}>
            {engineStatsSplitLine(aggregate)}
          </p>
          <p className={styles.forensicsLine} data-testid={`book-stats-refusals-${aggregate.engine}`}>
            refusal codes: {refusalBreakdown(aggregate)}
          </p>
        </details>
      )}
    </div>
  );
}

export function BookStatRows({
  engines,
  badDebt,
}: {
  engines: readonly Aggregate[];
  badDebt: readonly BadDebt[];
}) {
  return (
    <section className={styles.section} aria-label="per-engine aggregates">
      <div className={styles.sectionHead}>
        <h2>Aggregates: per engine, never combined</h2>
      </div>
      {engines.map((aggregate) => (
        <EngineStats
          key={aggregate.engine}
          aggregate={aggregate}
          badDebt={badDebt.find((candidate) => candidate.engine === aggregate.engine)}
        />
      ))}
    </section>
  );
}
