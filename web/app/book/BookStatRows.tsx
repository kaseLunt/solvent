// Per-engine stat rows (spec §3.1): collateral counted / debt / liquidatable /
// refused, each with its coverage denominator — an aggregate without its
// denominator is not a disclosure. Engines are NEVER combined: one block per
// engine, no blended totals anywhere on this surface.

import type { Aggregate, BadDebt } from "@solvent/client";
import { StatCard } from "@/components/StatCard";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { renderEngineAmount } from "@/lib/book-format";
import { EM_DASH } from "@/lib/format";
import { liquidatableCardSub } from "./readingLines";
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
  const denominator = `${String(aggregate.computed_positions)}/${String(aggregate.positions)} positions counted`;

  if (aggregate.refused) {
    // The WHOLE engine is withheld: totals are null and render as em dashes —
    // a refusal is the absence of a number, and zero is a number.
    return (
      <div className={styles.engineBlock} data-testid={`book-stats-${aggregate.engine}`}>
        <div className={styles.engineHead}>
          <EngineChip engine={aggregate.engine} />
          {aggregate.refusal !== null && <RefusedTag reason={aggregate.refusal.code} />}
          <span>{aggregate.refusal?.detail ?? "engine withheld on this batch"}</span>
        </div>
        <div className={styles.statrow}>
          <StatCard label="Collateral (counted)" value={EM_DASH} sub="withheld, no number served" />
          <StatCard label="Debt" value={EM_DASH} sub="withheld, no number served" />
          <StatCard label="Liquidatable" value={EM_DASH} sub="no verdicts were computed" />
          <StatCard
            label="Refused"
            value="whole engine"
            tone="warn"
            sub={aggregate.refusal?.code ?? "engine refusal"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.engineBlock} data-testid={`book-stats-${aggregate.engine}`}>
      <div className={styles.engineHead}>
        <EngineChip engine={aggregate.engine} />
        <span>
          {String(aggregate.positions)} positions · {String(aggregate.computed_positions)} computed ·{" "}
          {String(aggregate.refused_positions)} refused · {String(aggregate.flagged_positions)} flagged
        </span>
      </div>
      <div className={styles.statrow}>
        <StatCard
          label="Collateral (counted)"
          value={renderEngineAmount(aggregate.total_collateral, aggregate.value_decimals)}
          sub={denominator}
        />
        <StatCard
          label="Debt"
          value={renderEngineAmount(aggregate.total_debt, aggregate.value_decimals)}
          sub={denominator}
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
          /* The Σ rides the count (SUPPLEMENT §17): never the adjective
             without the Σ, never the count suppressed. */
          sub={liquidatableCardSub(badDebt)}
        />
        <StatCard
          label="Refused"
          value={String(aggregate.refused_positions)}
          tone={aggregate.refused_positions > 0 ? "warn" : "default"}
          sub={refusalBreakdown(aggregate)}
        />
      </div>
      <p className={styles.unitNote}>{aggregate.unit_note}</p>
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
