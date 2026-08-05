import type { Shortfall } from "@solvent/client";
import { StatCard } from "@/components/StatCard";
import { ELIGIBLE_REALIZED_GLOSS } from "@/lib/book-copy";
import { renderUsdAmount } from "@/lib/book-format";
import {
  REALIZATION_FORENSICS_SUMMARY,
  realizationAnswer,
  realizationMethod,
} from "./labPanelLines";
import styles from "./lab.module.css";

/**
 * The `hfs_unchanged` assertion, rendered only when the WIRE asserts it —
 * the banner is the scenario's own claim, never a UI inference.
 */
export function HfsUnchangedBanner({ realization }: { realization: Shortfall }) {
  if (!realization.hfs_unchanged) return null;
  return (
    <p className={styles.banner} data-testid="hfs-unchanged-banner">
      hfs_unchanged · asserted by the scenario: no oracle mark moved, every health factor is
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
/**
 * WAVE W-3L — ON THE SECTION TEMPLATE.
 *
 *   STATE     the wire's own `hfs_unchanged` assertion, rendered by the caller
 *             immediately above this panel and always open. It is NOT pulled
 *             inside: on the flagship contrast it qualifies the protocol-sees
 *             state pair in the sibling panel, and one claim rendered twice on
 *             one screen is its own defect.
 *   ANSWER    both cards as one computed sentence, delta-only stated in it.
 *   VISUAL /  the two cards. Their values are the exact served strings.
 *   LEDGER
 *   METHOD    the seizure model, the unit, and the eligible-vs-realized gloss
 *             PROMOTED out of a `title` — hover-only is not a disclosure.
 *   FORENSICS the wire's own note, verbatim.
 */
export function LabRealization({ realization }: { realization: Shortfall }) {
  // CX-4: ONE grouped-USD renderer across the Lab. This used to print
  // `$1877357.544497` beside a frontier panel printing `$1,877,357.544497`.
  const money = (value: string) => renderUsdAmount(value, realization.usd_decimals);
  return (
    <div data-testid="market-realization">
      {/* ---- SLOT 3: ANSWER — computed from the same two values below ---- */}
      <p className={styles.answerLine} data-testid="realization-answer">
        {realizationAnswer(realization)}
      </p>

      {/* ---- SLOT 4 + 5: VISUAL + LEDGER ---- */}
      <div className={styles.statRow}>
        <StatCard
          label="Execution shortfall"
          value={money(realization.execution_shortfall_usd)}
          sub="delta-only"
          tone={realization.execution_shortfall_usd === "0" ? "default" : "crit"}
          testId="realization-shortfall"
        />
        <StatCard
          label="Bad debt at liquidation"
          value={money(realization.bad_debt_at_liquidation_usd)}
          sub={<span data-testid="realized-leq-eligible">delta-only · realized ≤ eligible</span>}
          tone={realization.bad_debt_at_liquidation_usd === "0" ? "default" : "crit"}
          testId="realization-bad-debt"
        />
      </div>

      {/* ---- SLOT 6: METHOD ---- */}
      <p className={styles.methodLine} data-testid="seizure-model">
        {realizationMethod(realization, ELIGIBLE_REALIZED_GLOSS)}
      </p>

      {/* ---- SLOT 7: FORENSICS ---- */}
      <details className={styles.disclosure} data-testid="realization-forensics">
        <summary>{REALIZATION_FORENSICS_SUMMARY}</summary>
        <p className={styles.noteText} data-testid="realization-wire-note">
          {realization.note}
        </p>
      </details>
    </div>
  );
}
