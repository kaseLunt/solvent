import type { Shortfall } from "@solvent/client";
import { StatCard } from "@/components/StatCard";
import { ELIGIBLE_REALIZED_GLOSS } from "@/lib/book-copy";
import { renderNullableDecimal } from "@/lib/format";
import styles from "./lab.module.css";

/**
 * The `hfs_unchanged` assertion, rendered only when the WIRE asserts it —
 * the banner is the scenario's own claim, never a UI inference.
 */
export function HfsUnchangedBanner({ realization }: { realization: Shortfall }) {
  if (!realization.hfs_unchanged) return null;
  return (
    <p className={styles.banner} data-testid="hfs-unchanged-banner">
      hfs_unchanged — asserted by the scenario: no oracle mark moved, every health factor is
      bit-identical
    </p>
  );
}

/**
 * "What the market realizes": the market-realization axis of a scenario.
 * Market value is NOT an oracle mark — the shortfall is the gap the protocol
 * is not seeing. USD values format with the realization's OWN `usd_decimals`;
 * the seizure-model assumption is captioned verbatim.
 */
export function LabRealization({ realization }: { realization: Shortfall }) {
  const money = (value: string) =>
    renderNullableDecimal(value, { decimals: realization.usd_decimals, prefix: "$" });
  return (
    <div data-testid="market-realization">
      <div className={styles.statRow}>
        <StatCard
          label="Execution shortfall"
          value={money(realization.execution_shortfall_usd)}
          sub={`delta-only · usd_decimals ${String(realization.usd_decimals)}`}
          tone={realization.execution_shortfall_usd === "0" ? "default" : "crit"}
        />
        <StatCard
          label="Bad debt at liquidation"
          value={money(realization.bad_debt_at_liquidation_usd)}
          /* SUPPLEMENT caption (b): the eligible-vs-realized gloss rides the
             "realized ≤ eligible" sub as its title. */
          sub={
            <span title={ELIGIBLE_REALIZED_GLOSS} data-testid="realized-leq-eligible">
              delta-only · realized ≤ eligible
            </span>
          }
          tone={realization.bad_debt_at_liquidation_usd === "0" ? "default" : "crit"}
        />
      </div>
      <p className={styles.caption} data-testid="seizure-model">
        seizure model: {realization.seizure_model} — the disclosed assumption behind the
        shortfall arithmetic
      </p>
      <p className={styles.noteText}>{realization.note}</p>
    </div>
  );
}
