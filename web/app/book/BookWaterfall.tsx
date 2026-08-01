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
//     not describe, listed verbatim behind the counted-disclosure pattern
//     (SUPPLEMENT caption a) — an always-visible summary, the named list one
//     click away, values in the source's RAW units (the wire declares no
//     decimals; scaling them would be fabrication).
//   - residual bad debt uses the primitive's `residual` kind — it can never
//     hide, however small; dust may only APPEND "· all dust", never suppress.
//   - `at_risk_note` is NOT rendered here (SUPPLEMENT caption c): the series
//     it governs is not drawn on this panel. It survives verbatim in the
//     raw-JSON / Developers register.

import type { Waterfall } from "@solvent/client";
import { WaterfallSteps } from "@/components/charts/WaterfallSteps";
import { EngineChip } from "@/components/EngineChip";
import { ProjectionBadge } from "@/components/ProjectionBadge";
import { RefusedTag } from "@/components/RefusedTag";
import { AddressMono } from "@/components/AddressMono";
import { groupDecimalString } from "@/lib/book-format";
import {
  BAD_DEBT_LEGEND,
  ELIGIBLE_REALIZED_GLOSS,
  HELD_FLAT_VALUE_HEADER,
  heldFlatDetailsSummary,
  heldFlatSummary,
  WATERFALL_SECTION_NOTE,
} from "@/lib/book-copy";
import { buildWaterfallSteps, factorTimesLabel } from "./waterfallView";
import styles from "./book.module.css";

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
        <span className={styles.sectionNote} data-testid="waterfall-section-note">
          {WATERFALL_SECTION_NOTE}
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
              ? ` (factor ${factorTimesLabel(waterfall.monotonicity.factor, waterfall.grid_scale)})`
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

      {/* The eligible-vs-realized gloss (SUPPLEMENT caption b): the primary
          register at the head of the panel area; the wire's own
          eligibility_note stays rendered, dim, verbatim, below. */}
      <p className={styles.gloss} data-testid="eligible-gloss">
        {ELIGIBLE_REALIZED_GLOSS}
      </p>

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
                steps={buildWaterfallSteps(waterfall, engine)}
                width={520}
                rowHeight={28}
              />
            </div>
          </div>
        ))}
      </div>

      <p className={styles.legendLine} data-testid="waterfall-bad-debt-legend">
        {BAD_DEBT_LEGEND}
      </p>

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
            <>
              <p className={styles.heldFlatSummary} data-testid="held-flat-summary">
                {heldFlatSummary(waterfall.held_flat.length)}
              </p>
              <details className={styles.disclosure}>
                <summary>{heldFlatDetailsSummary(waterfall.held_flat.length)}</summary>
                <div className={styles.tableWrap}>
                  <table className={styles.heldFlatTable}>
                    <thead>
                      <tr>
                        <th>held flat (matrix did not move this price)</th>
                        <th>source</th>
                        <th className={styles.num}>{HELD_FLAT_VALUE_HEADER}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waterfall.held_flat.map((held) => (
                        <tr key={`${String(held.chain_id)}-${held.asset}-${held.source}`}>
                          <td>
                            <AddressMono address={held.asset} copy={false} />{" "}
                            <span className="mono dim">chain {String(held.chain_id)}</span>
                          </td>
                          <td className="mono dim">{held.source}</td>
                          <td className={styles.num}>{groupDecimalString(held.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
          <p className={styles.panelNote}>{waterfall.eligibility_note}</p>
        </div>
      </div>
    </section>
  );
}
