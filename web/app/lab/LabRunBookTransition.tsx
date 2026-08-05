// The run-book's BEFORE-to-AFTER transition matrix (contract 1.7.0).
//
// NOT `LabMatrix.tsx`. That is the scenario-by-engine grid (Wave W-SD-A) and
// the collision would be a real one: both are "the matrix" to somebody.
//
// # What this surface is, and what the two histograms beside it could not do
//
// `LabRunBookHistogramPair` renders two MARGINALS. Two marginals do not
// determine a joint: a row that fell below 1.00 and another that rose above it
// cancel exactly in their difference, and no arithmetic on this side can
// separate them. `hf_transitions` is the joint the server computed, so the
// flows are read off its cells and drawn.
//
// # The laws this renders under
//
//   - NOTHING IS DRAWN BEFORE IT IS VALIDATED. `readTransitions` re-checks the
//     margins against the two served histograms and this component renders the
//     REFUSAL, with its reasons, rather than a picture whose ribbons do not sum
//     to the bars beside them. The `matrixCells.ts` precedent, applied to a body
//     that can arrive from an older or a broken deployment.
//   - A NULL IS NOT A ZERO, twice over. A null `held_rows` / `lane_changed_rows`
//     renders as "this run measured no row on this engine"; a null cell debt
//     renders in the refusal register with the balance withheld, never as $0.
//   - ONE COUNT SCALE within one engine's matrix, so two ribbons are comparable
//     by length. Nothing here is ever added across engines.
//   - The wire's own `note` renders VERBATIM.
//   - NO CRIT TINT ON THE DEBT MANAGER. Its lanes are the exact rational
//     maxBorrowLT/borrowings, a disclosure and not a liquidation verdict — the
//     same `comparator === "hf_wad"` asymmetry the histogram pair already
//     applies.

import type { LabRunBookEngine } from "@/lib/runbook";
import { labUsd } from "./frontierView";
import {
  LANE_KIND_BUCKET,
  belowOneLanes,
  crossingCounts,
  movementCountText,
  readTransitions,
  transitionRibbons,
} from "./labTransition";
import styles from "./lab.module.css";

const RIBBON_MAX = 168;

export function LabRunBookTransition({ engine }: { engine: LabRunBookEngine }) {
  const reading = readTransitions(engine);

  if (reading.kind === "contradictory") {
    return (
      <section
        className={styles.subPanel}
        data-testid="runbook-transition"
        data-engine={engine.engine}
        data-state="contradictory"
        aria-label={`${engine.engine} transition matrix, refused`}
      >
        <p className={styles.panelTitle}>Lane transitions · before → after</p>
        <p className={styles.answerLine} data-testid="runbook-transition-refusal">
          This matrix is NOT drawn. Its margins disagree with the two distributions served beside
          it, so any flow drawn from it would contradict the bars printed above — a wrong answer
          that looks computed.
        </p>
        <ul data-testid="runbook-transition-reasons">
          {reading.reasons.map((reason) => (
            <li key={reason} className={styles.noteText}>
              {reason}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const t = reading.transitions;
  const region = belowOneLanes(t);
  const { entries, exits, net } = crossingCounts(t, region);
  const ribbons = transitionRibbons(t);
  // ONE SCALE for this engine's matrix, taken from its own largest cell. Scaling
  // each ribbon to itself would draw every flow the same width and say nothing.
  const widest = ribbons.reduce((max, ribbon) => (ribbon.rows > max ? ribbon.rows : max), 0);
  // The crit tint is the pool's own liquidation test, and the Debt Manager has
  // none — its lanes are a disclosure. Same asymmetry as the histogram pair.
  const eligibleTint = t.comparator === "hf_wad";
  const inRegion = new Set(region);
  const measuredNothing = t.measured_rows === 0;

  return (
    <section
      className={styles.subPanel}
      data-testid="runbook-transition"
      data-engine={engine.engine}
      data-state="ok"
      aria-label={`${engine.engine} lane transitions, before to after`}
    >
      <p className={styles.panelTitle}>
        Lane transitions · before → after{" "}
        <span className={styles.comparatorTag}>comparator: {t.comparator}</span>
      </p>

      {/* ---- ANSWER — the gross crossings the two histograms could not give -- */}
      <p className={styles.answerLine} data-testid="runbook-transition-answer">
        {measuredNothing
          ? "This run measured no row on this engine, so no movement is stated: the two movement counts are withheld rather than reported as zero."
          : `${String(entries)} ${entries === 1 ? "row" : "rows"} moved INTO the below-1.00 region and ` +
            `${String(exits)} ${exits === 1 ? "row" : "rows"} moved OUT of it, for a net of ` +
            `${net > 0 ? "+" : ""}${String(net)}. Read the two gross counts, not their difference: ` +
            `they cancel in it.`}
      </p>

      {/* ---- LEDGER — the movement partition, with the null carried ---------- */}
      <dl className={styles.kv} data-testid="runbook-transition-movement">
        <dt>rows this run measured</dt>
        <dd className={styles.num}>{String(t.measured_rows)}</dd>
        <dt>lane held</dt>
        <dd className={styles.num} data-testid="runbook-transition-held">
          {movementCountText(t.held_rows)}
        </dd>
        <dt>lane changed</dt>
        <dd className={styles.num} data-testid="runbook-transition-changed">
          {movementCountText(t.lane_changed_rows)}
        </dd>
        <dt>rows this run measured on neither side</dt>
        <dd className={styles.num} data-testid="runbook-transition-unmeasured">
          {String(t.unmeasured_rows)}
        </dd>
        <dt>this engine&rsquo;s rows in this run</dt>
        <dd className={styles.num}>{String(t.total_rows)}</dd>
      </dl>

      {/* ---- VISUAL + LEDGER — one row per OCCUPIED cell -------------------- */}
      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid="runbook-transition-cells">
          <thead>
            <tr>
              <th scope="col">from</th>
              <th scope="col">to</th>
              <th scope="col">rows</th>
              <th scope="col">debt before</th>
              <th scope="col">debt after</th>
            </tr>
          </thead>
          <tbody>
            {ribbons.map((ribbon) => {
              const width =
                widest === 0 ? 0 : Math.max(1, Math.round((ribbon.rows / widest) * RIBBON_MAX));
              const arrivesEligible =
                eligibleTint &&
                inRegion.has(ribbon.to) &&
                t.lanes[ribbon.to]?.kind === LANE_KIND_BUCKET;
              return (
                <tr
                  key={`${String(ribbon.from)}->${String(ribbon.to)}`}
                  data-testid="runbook-transition-cell"
                  data-from={String(ribbon.from)}
                  data-to={String(ribbon.to)}
                  data-unmeasured={ribbon.unmeasured ? "true" : "false"}
                >
                  <td className={styles.mono}>{ribbon.fromLabel}</td>
                  <td className={styles.mono}>{ribbon.toLabel}</td>
                  <td className={styles.num}>
                    <span
                      className={arrivesEligible ? styles.histBarEligible : styles.histBar}
                      style={{ display: "inline-block", width: `${String(width)}px`, height: "6px" }}
                      aria-hidden="true"
                    />{" "}
                    {String(ribbon.rows)}
                  </td>
                  {/* A NULL DEBT IS AN UNKNOWABLE, and it renders as one. $0
                      would say this run priced the row at nothing. */}
                  {[ribbon.debtBefore, ribbon.debtAfter].map((debt, index) => (
                    <td key={index === 0 ? "before" : "after"} className={styles.num}>
                      {debt === null ? (
                        <span className={styles.unpricedTag} data-testid="runbook-transition-nodebt">
                          not measured
                        </span>
                      ) : (
                        labUsd(debt, engine.usd_decimals)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- METHOD — the unit, and the one thing this count is NOT --------- */}
      <p className={styles.methodLine} data-testid="runbook-transition-method">
        {"Rows are POSITION ROWS of this engine in this run, never distinct addresses, and never " +
          `added to another engine's. Debt is this engine's own USD at ${String(engine.usd_decimals)} decimals. ` +
          "The ribbon lengths share ONE scale within this matrix. "}
        &ldquo;Lane changed&rdquo; counts rows whose BAND changed and is not{" "}
        <code>movers_total</code>, not <code>newly_eligible_accounts</code>, and not a crossing
        count of the 1.00 edge — that crossing pair is the two figures above.
        {eligibleTint
          ? " Arrivals below 1.00 are tinted: on this engine that band IS the liquidation set."
          : " Nothing here is tinted: this engine's lanes are the exact rational maxBorrowLT/borrowings, a DISCLOSURE and not its liquidation trigger."}
      </p>

      {/* ---- FORENSICS — the wire's own note, VERBATIM ---------------------- */}
      <details className={styles.disclosure} data-testid="runbook-transition-forensics">
        <summary>
          The server&rsquo;s own statement of what this matrix is, and the cause split behind its
          last lane
        </summary>
        <p className={styles.noteText} data-testid="runbook-transition-wire-note">
          {t.note}
        </p>
        <ul data-testid="runbook-transition-causes">
          <li>
            {String(t.unmeasured_refused_in_batch_rows)} refused by riskd, counted in{" "}
            <code>coverage.refused_in_batch</code> and served per row by <code>/v1/positions</code>
          </li>
          <li>
            {String(t.unmeasured_excluded_by_this_layer_rows)} this service could not rebuild,
            listed per row in <code>coverage.excluded</code>
          </li>
        </ul>
      </details>
    </section>
  );
}
