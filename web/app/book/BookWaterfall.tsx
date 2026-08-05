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
  heldFlatSummary,
  waterfallForensicsSummary,
  WATERFALL_SECTION_NOTE,
} from "@/lib/book-copy";
import {
  buildWaterfallSteps,
  factorTimesLabel,
  waterfallAllDustLine,
  waterfallAllDustRungs,
  waterfallEngineAnswer,
} from "./waterfallView";
import styles from "./book.module.css";

// WAVE W-3L — ON THE SECTION TEMPLATE (chart spec v4 §1).
//
//   HEAD      scenario id / version / axis, PROJECTION badge.
//   STATE     section note, monotonicity violation, excluded engines, and the
//             HELD-FLAT COUNT — all four qualify every bar below them, so R6
//             puts them before the bars. The held-flat summary MOVED UP from
//             under the grid for exactly that reason.
//   ANSWER    per engine panel, computed from the deepest sampled point.
//   VISUAL    the step charts. Their exact money strings are DIRECT LABELS
//             column-aligned to their bars, so the LEDGER slot is served in
//             place and no second copy is drawn (R2).
//   METHOD    the eligible-vs-realized gloss.
//   FORENSICS the held-flat NAMED LIST, the bad-debt legend, and the wire's
//             own eligibility_note verbatim.
//
// Hazards held open: MONOTONICITY VIOLATION, `waterfall-excluded`, the
// held_flat COUNT and its empty-case positive claim, and the null-waterfall
// panel. `at_risk_note` stays unrendered here by design — this panel does not
// draw the series it governs.

export function BookWaterfall({ waterfall }: { waterfall: Waterfall | null }) {
  if (waterfall === null) {
    return (
      <section className={styles.section} aria-label="liquidation waterfall">
        <div className={styles.sectionHead}>
          <h2>Liquidation waterfall</h2>
        </div>
        <div className={styles.panel}>
          <div className={styles.emptyReason}>
            no waterfall was served on this batch: the down-grid was not computed. That is a
            statement about the SERVICE, and it makes no claim about what is at risk.
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
          Liquidation waterfall · {waterfall.scenario_id} ({waterfall.scenario_version}) · axis{" "}
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
            {" · "}
            {waterfall.monotonicity.detail ?? "the debt-eligible series is not monotone"}. The points
            are served exactly as computed, with no smoothing.
          </span>
        </div>
      )}

      {waterfall.excluded_engines.length > 0 && (
        <div className={styles.refusalStrip} data-testid="waterfall-excluded">
          {waterfall.excluded_engines.map((refusal) => (
            <span key={refusal.engine ?? refusal.code}>
              <RefusedTag reason={refusal.code ?? "withheld"} />{" "}
              <b>{refusal.engine}</b> is absent from every point of this waterfall
              {refusal.detail !== undefined ? `: ${refusal.detail}` : ""}
            </span>
          ))}
        </div>
      )}

      {/* ---- SLOT 2 (cont.): the HELD-FLAT COUNT. A price the scenario never
              moved is a held INPUT to every bar below, so R6 puts the count
              here rather than under the grid. The count and the empty-case
              positive claim never collapse; only the named list does. ---- */}
      <div className={styles.stateSlot} data-testid="waterfall-held-flat">
        {waterfall.held_flat.length === 0 ? (
          <span data-testid="held-flat-empty">
            held flat: none. That is the claim that the matrix covered the whole book.
          </span>
        ) : (
          <span data-testid="held-flat-summary">{heldFlatSummary(waterfall.held_flat.length)}</span>
        )}
      </div>

      <div className={styles.panelGrid}>
        {engineIds.map((engine) => {
          // W-VR defect 8: the "all dust" fact left the tick labels and
          // renders as ONE disclosure line per panel, in the method register.
          // Same wire points, same zero-member gate — relocated, not deleted.
          const allDust = waterfallAllDustLine(waterfallAllDustRungs(waterfall, engine));
          return (
            <div className={styles.panel} key={engine} data-testid={`book-waterfall-${engine}`}>
              {/* ---- SLOT 1: panel HEAD ---- */}
              <div className={styles.panelHead}>
                <EngineChip engine={engine} />
                <span className={styles.comparator}>cumulative eligible debt · usd</span>
              </div>
              <div className={styles.panelBody}>
                {/* ---- SLOT 3: ANSWER — computed from this engine's own points ---- */}
                <p className={styles.answerLine} data-testid={`waterfall-answer-${engine}`}>
                  {waterfallEngineAnswer(waterfall, engine)}
                </p>
                {/* ---- SLOT 4 + 5: VISUAL, with its exact money as direct labels ---- */}
                <WaterfallSteps
                  label={`liquidation waterfall for ${engine}`}
                  steps={buildWaterfallSteps(waterfall, engine)}
                  width={520}
                  rowHeight={28}
                />
                {allDust !== null && (
                  <p className={styles.methodLine} data-testid={`waterfall-all-dust-${engine}`}>
                    {allDust}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- SLOT 6: METHOD — the eligible-vs-realized gloss ---- */}
      <p className={styles.methodLine} data-testid="eligible-gloss">
        {ELIGIBLE_REALIZED_GLOSS}
      </p>

      {/* ---- SLOT 7: FORENSICS — the named held-flat list, the definitional
              legend, and the wire's own note verbatim. It holds no refusal,
              no count and no unknowable: those are in STATE above (R3). ---- */}
      <details className={styles.disclosure} data-testid="waterfall-forensics">
        <summary>{waterfallForensicsSummary(waterfall.held_flat.length)}</summary>

        {waterfall.held_flat.length > 0 && (
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
        )}

        <p className={styles.forensicsLine} data-testid="waterfall-bad-debt-legend">
          {BAD_DEBT_LEGEND}
        </p>
        <p className={styles.forensicsLine} data-testid="waterfall-eligibility-note">
          {waterfall.eligibility_note}
        </p>
      </details>
    </section>
  );
}
