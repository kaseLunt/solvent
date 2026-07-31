// Liquidation waterfall (spec §3.1): /v1/book's single-factor down-grid,
// rendered per engine on the scaffold's WaterfallSteps primitive.
//
// Honesty laws on this panel:
//   - grid point ×1.00 is the UNSHOCKED book (the standing census); every
//     later point is a projection and the panel wears PROJECTION.
//   - a monotonicity violation is SURFACED in a warning strip naming the
//     offending grid point — never smoothed away (the points still render).
//   - `excluded_engines` are NAMED: an engine absent from the arithmetic with
//     no name attached is exactly the silent hole this surface must not have.
//   - `held_flat` is RENDERED: every price input the propagation matrix did
//     not describe, listed verbatim.
//   - residual bad debt uses the primitive's `residual` kind — it can never
//     hide, however small.

import { formatUnits, type Waterfall, type WaterfallEngine } from "@solvent/client";
import { WaterfallSteps, type WaterfallStep } from "@/components/charts/WaterfallSteps";
import { EngineChip } from "@/components/EngineChip";
import { ProjectionBadge } from "@/components/ProjectionBadge";
import { RefusedTag } from "@/components/RefusedTag";
import { AddressMono } from "@/components/AddressMono";
import { groupDecimalString } from "@/lib/book-format";
import styles from "./book.module.css";

/** Display an exact USD amount: "$4,200" — string surgery, no float. */
function usd(value: string, decimals: number): string {
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/** Geometry-only number for bar widths. Display strings stay exact. */
function geometry(value: string, decimals: number): number {
  return Number(formatUnits(value, decimals, { trim: true }));
}

/** ×0.90 label from the wad-scaled grid factor. */
function factorLabel(factor: string, gridScale: string): string {
  const display = formatUnits(factor, gridScale.length - 1, { trim: true });
  return `×${display.includes(".") ? display : `${display}.00`}`;
}

function engineSteps(waterfall: Waterfall, engine: string): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  for (const point of waterfall.points) {
    const at: WaterfallEngine | undefined = point.engines.find(
      (candidate) => candidate.engine === engine,
    );
    if (at === undefined) continue;
    // Label grammar budgeted to the primitive's gutter (design ruling 2):
    // "×1.00 unshocked" — no parentheses, no "eligible" (the panel head
    // already says "cumulative eligible debt"); counts move to the dim sub
    // line so the money string stands alone after the bar and never clips.
    const label = factorLabel(point.factor, waterfall.grid_scale);
    const unshocked = point.index === 0 ? " unshocked" : "";
    steps.push({
      label: `${label}${unshocked}`,
      sub: `${String(at.cumulative_eligible_accounts)} acct`,
      value: geometry(at.cumulative_debt_eligible_usd, at.usd_decimals),
      display: usd(at.cumulative_debt_eligible_usd, at.usd_decimals),
      kind: "flow",
    });
    // Exact string surgery, not a literal compare: a wire form like
    // "0.000000" is still zero, and a floored zero would fabricate a crit
    // residual bar for bad debt that does not exist (design ruling 1).
    if (/[1-9]/.test(at.cumulative_bad_debt_usd)) {
      steps.push({
        label: `${label} bad debt`,
        sub: `${String(at.insolvent_if_liquidated_accounts)} insolvent`,
        value: geometry(at.cumulative_bad_debt_usd, at.usd_decimals),
        display: usd(at.cumulative_bad_debt_usd, at.usd_decimals),
        kind: "residual",
      });
    }
  }
  return steps;
}

export function BookWaterfall({ waterfall }: { waterfall: Waterfall | null }) {
  if (waterfall === null) {
    return (
      <section className={styles.section} aria-label="liquidation waterfall">
        <div className={styles.sectionHead}>
          <h2>Liquidation waterfall</h2>
        </div>
        <div className={styles.panel}>
          <div className={styles.emptyReason}>
            no waterfall was served on this batch — the down-grid was not computed, which is a
            statement about the SERVICE, not a claim that nothing is at risk.
          </div>
        </div>
      </section>
    );
  }

  const engineIds = Array.from(
    new Set(waterfall.points.flatMap((point) => point.engines.map((engine) => engine.engine))),
  );

  return (
    <section className={styles.section} aria-label="liquidation waterfall">
      <div className={styles.sectionHead}>
        <h2>
          Liquidation waterfall — {waterfall.scenario_id} ({waterfall.scenario_version}) · axis{" "}
          {waterfall.axis}
        </h2>
        <ProjectionBadge />
        <span className={styles.sectionNote}>
          ×1.00 is the standing census; every lower grid point is a projection
        </span>
      </div>

      {!waterfall.monotonicity.ok && (
        <div className={styles.warnStrip} data-testid="waterfall-monotonicity" role="alert">
          <b>MONOTONICITY VIOLATION</b>
          <span>
            {waterfall.monotonicity.engine ?? "unnamed engine"} at grid point{" "}
            {waterfall.monotonicity.index !== undefined
              ? `#${String(waterfall.monotonicity.index)}`
              : "?"}
            {waterfall.monotonicity.factor !== undefined
              ? ` (factor ${factorLabel(waterfall.monotonicity.factor, waterfall.grid_scale)})`
              : ""}
            {" — "}
            {waterfall.monotonicity.detail ?? "the debt-eligible series is not monotone"}. The points
            are served as computed, not smoothed.
          </span>
        </div>
      )}

      {waterfall.excluded_engines.length > 0 && (
        <div className={styles.refusalStrip} data-testid="waterfall-excluded">
          {waterfall.excluded_engines.map((refusal) => (
            <span key={refusal.engine ?? refusal.code}>
              <RefusedTag reason={refusal.code ?? "withheld"} />{" "}
              <b>{refusal.engine}</b> is absent from every point of this waterfall
              {refusal.detail !== undefined ? ` — ${refusal.detail}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className={styles.panelGrid}>
        {engineIds.map((engine) => (
          <div className={styles.panel} key={engine} data-testid={`book-waterfall-${engine}`}>
            <div className={styles.panelHead}>
              <EngineChip engine={engine} />
              <span className={styles.comparator}>cumulative eligible debt · usd</span>
            </div>
            <div className={styles.panelBody}>
              <WaterfallSteps
                label={`liquidation waterfall for ${engine}`}
                steps={engineSteps(waterfall, engine)}
                width={520}
                rowHeight={28}
              />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.panel} style={{ marginTop: "var(--sp-3)" }}>
        <div className={styles.panelHead}>
          <span>held flat — price inputs the propagation matrix did not describe</span>
        </div>
        <div className={styles.panelBody} data-testid="waterfall-held-flat">
          {waterfall.held_flat.length === 0 ? (
            <span className={styles.sectionNote}>
              empty — the claim that the matrix covered the whole book
            </span>
          ) : (
            <ul className={styles.heldFlat}>
              {waterfall.held_flat.map((held) => (
                <li key={`${String(held.chain_id)}-${held.asset}-${held.source}`}>
                  <AddressMono address={held.asset} copy={false} /> · chain {String(held.chain_id)} ·{" "}
                  {held.source} · value {groupDecimalString(held.value)} (held at its current mark)
                </li>
              ))}
            </ul>
          )}
          <p className={styles.panelNote}>{waterfall.eligibility_note}</p>
          <p className={styles.panelNote}>{waterfall.at_risk_note}</p>
        </div>
      </div>
    </section>
  );
}
