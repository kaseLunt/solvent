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
//   - THE FLOW (Wave W-SK) is the VISUAL slot: a two-column diagram, BEFORE
//     lanes left and AFTER lanes right, one ribbon per occupied cell, laid out
//     by `labTransitionFlow.ts` at the measured frame width. A zero-count side
//     draws no node block; held ribbons are muted; the unmeasured diagonal is
//     dashed and never shares a class with held-measured rows; and the crit
//     tint rides only a changed arrival below 1.00 on the wad engine.
//   - The wire's own `note` renders VERBATIM.
//   - NO CRIT TINT ON THE DEBT MANAGER. Its lanes are the exact rational
//     maxBorrowLT/borrowings, a disclosure and not a liquidation verdict — the
//     same `comparator === "hf_wad"` asymmetry the histogram pair already
//     applies.

import type { LabRunBookEngine, RunBookTransitions } from "@/lib/runbook";
import chart from "@/components/charts/charts.module.css";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import { labUsd } from "./frontierView";
import {
  LANE_KIND_BUCKET,
  belowOneLanes,
  crossingCounts,
  movementCountText,
  readTransitions,
  transitionRibbons,
} from "./labTransition";
import {
  FLOW_FALLBACK_WIDTH,
  FLOW_MAX_WIDTH,
  FLOW_MIN_WIDTH,
  transitionFlowLayout,
  type FlowRibbon,
} from "./labTransitionFlow";
import styles from "./lab.module.css";

const RIBBON_MAX = 168;

/**
 * The hover line a ribbon carries. It ADDS convenience only (LAW-5): the exact
 * rows and both debt strings are printed in the ledger table below, so nothing
 * exists solely inside this title.
 */
function ribbonTitle(flow: FlowRibbon, usdDecimals: number): string {
  const { ribbon } = flow;
  const debt = (value: string | null) =>
    value === null ? "not measured" : labUsd(value, usdDecimals);
  return (
    `${ribbon.fromLabel} → ${ribbon.toLabel} · ${String(ribbon.rows)} ` +
    `${ribbon.rows === 1 ? "row" : "rows"} · debt before ${debt(ribbon.debtBefore)} / ` +
    `after ${debt(ribbon.debtAfter)}`
  );
}

/**
 * THE VISUAL: the two-column flow. BEFORE lanes on the left, AFTER lanes on
 * the right, in the wire's own dense lane order, laid out at the MEASURED
 * frame width and rendered 1:1 (LAW-3). It is rendered only from a matrix
 * `readTransitions` accepted and only when at least one cell is occupied; a
 * refused matrix never reaches this component at all.
 */
function TransitionFlow({
  transitions,
  engineName,
  usdDecimals,
}: {
  transitions: RunBookTransitions;
  engineName: string;
  usdDecimals: number;
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>({
    min: FLOW_MIN_WIDTH,
    max: FLOW_MAX_WIDTH,
    fallback: FLOW_FALLBACK_WIDTH,
  });
  const layout = transitionFlowLayout(transitions, width);
  // Held is muted (nothing moved), changed carries the story, the unmeasured
  // diagonal is its own not-a-movement register, and the crit tint rides only
  // a changed arrival below 1.00 on the engine whose comparator IS its
  // liquidation test.
  const ribbonClass = (flow: FlowRibbon) => {
    if (flow.kind === "unmeasured") return styles.flowRibbonUnmeasured;
    if (flow.kind === "held") return styles.flowRibbonHeld;
    return flow.crit ? styles.flowRibbonCrit : styles.flowRibbonChanged;
  };
  return (
    <div className={chart.measuredFrame} ref={ref} data-testid="runbook-transition-flow-frame">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
        role="img"
        aria-label={`${engineName} lane flow, before lanes on the left, after lanes on the right`}
        data-testid="runbook-transition-flow"
      >
        {layout.ribbons.map((flow) => {
          const mid = (flow.x1 + flow.x2) / 2;
          return (
            <path
              key={`${String(flow.ribbon.from)}->${String(flow.ribbon.to)}`}
              className={ribbonClass(flow)}
              d={
                `M ${String(flow.x1)} ${String(flow.y1)} ` +
                `C ${String(mid)} ${String(flow.y1)}, ${String(mid)} ${String(flow.y2)}, ` +
                `${String(flow.x2)} ${String(flow.y2)}`
              }
              strokeWidth={flow.thickness}
              data-testid="runbook-transition-ribbon"
              data-from={String(flow.ribbon.from)}
              data-to={String(flow.ribbon.to)}
              data-kind={flow.kind}
              data-crit={flow.crit ? "true" : "false"}
            >
              <title>{ribbonTitle(flow, usdDecimals)}</title>
            </path>
          );
        })}
        {/* NONEMPTY-ONLY node blocks: a zero-count side draws none. */}
        {layout.nodes.map((node) => (
          <rect
            key={`${node.side}-${String(node.lane)}`}
            className={styles.flowNode}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            data-testid="runbook-transition-flow-node"
            data-side={node.side}
            data-lane={String(node.lane)}
          />
        ))}
        {/* The COMPLETE lane vocabulary on both sides, dimmed where empty, each
            label carrying the wire's own margin count so the picture reads
            without the table. */}
        {layout.labels.map((label) => (
          <text
            key={`${label.side}-${String(label.lane)}`}
            className={label.empty ? styles.flowLaneLabelEmpty : styles.flowLaneLabel}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            data-testid="runbook-transition-flow-label"
            data-side={label.side}
            data-lane={String(label.lane)}
            data-empty={label.empty ? "true" : "false"}
          >
            {label.text}
          </text>
        ))}
      </svg>
    </div>
  );
}

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

      {/* ---- VISUAL — the flow. One ribbon per OCCUPIED cell; an empty
              matrix draws no SVG at all, so nothing can look like a flow that
              is not one. ---- */}
      {ribbons.length > 0 && (
        <TransitionFlow
          transitions={t}
          engineName={engine.engine}
          usdDecimals={engine.usd_decimals}
        />
      )}

      {/* ---- LEDGER — one row per OCCUPIED cell, exact strings -------------- */}
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
        {ribbons.length > 0 &&
          "Each ribbon in the flow is one occupied cell, drawn from its BEFORE lane on the left " +
            "to its AFTER lane on the right. Its thickness follows that cell's position rows on " +
            "one linear scale across the whole matrix, and the exact rows and debt figures are " +
            "printed in the table below. "}
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
