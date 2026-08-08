"use client";

// VIEWS 1 + 2 — the cumulative headroom ledger and the Pareto tiers, both
// read from THE SAME hoisted walk the risk map reads (one owner, one vector,
// one batch — never a second walk over the same book).
//
// Honesty laws on this panel:
//   - THE WALK STATE IS THE FIRST FACT (F6 + view-1 notes): the takeaway
//     names the floor in force (with its unit) and the walk's completeness
//     (walked N rows, batch #id) BEFORE any number renders. A walking,
//     outpaced or failed walk is its own honest non-drawing arm — a partial
//     vector is never presented as the book.
//   - VIEW 1 renders the cumulative cells EXACTLY (bigint sums from
//     headroomCurve), with the four asides visible beside the cells.
//   - VIEW 2's share bars sit on the ABSOLUTE 0–100% axis (LAW-2), so no
//     per-panel normalization exists to disclose; every share sentence
//     carries both absolutes, and a dust denominator keeps its numbers and
//     loses its visual weight (no bars).

import { formatUnits } from "@solvent/client";
import { groupDecimalString } from "@/lib/book-format";
import { EngineChip } from "@/components/EngineChip";
import type { FullBookWalk } from "./useFullBookWalk";
import { buildRiskBins } from "./riskBins";
import { CURVE_METHOD, curveAsidesLine, headroomCurve } from "./headroomCurve";
import {
  PARETO_METHOD,
  paretoEmptyLine,
  paretoShareLabel,
  paretoView,
} from "./paretoView";
import { useMemo } from "react";
import styles from "./book.module.css";

const SHARE_BAR_MAX = 150;
const SHARE_ROW_H = 20;

function money(value: string, decimals: number): string {
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}


/** OWNER PASS (pre-deploy): the house panel shell — head + padded body —
 *  which this panel had skipped, leaving its content flush on the border. */
function ConcentrationShell({
  engine,
  children,
}: {
  engine: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.panel} data-testid={`concentration-${engine}`}>
      <div className={styles.panelHead}>
        <EngineChip engine={engine} />
        <span className={styles.comparator}>
          concentration &amp; cumulative headroom &middot; one walk, this engine&apos;s own USD
        </span>
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function BookConcentration({
  engine,
  walk,
  minValue,
  valueDecimals,
}: {
  engine: string;
  walk: FullBookWalk;
  /** The composed floor riding every walked request; undefined = unfiltered. */
  minValue: string | undefined;
  valueDecimals: number | null;
}) {
  const { state } = walk;
  const rows = state.phase === "full" ? state.rows : null;
  const bins = useMemo(() => (rows === null ? null : buildRiskBins(rows)), [rows]);

  // F6: the floor and its unit ride the visible takeaway — a dust-filtered
  // subset presented as the book is the bounded-subset hazard in costume.
  const floorClause =
    minValue === undefined || valueDecimals === null
      ? "no value floor is in force"
      : `every walked request carried the ${money(minValue, valueDecimals)} value floor — rows under it are not in this census`;

  if (state.phase === "walking" || state.phase === "idle") {
    return (
      <ConcentrationShell engine={engine}>
        <p className={styles.methodLine} data-testid={`concentration-walking-${engine}`}>
          Concentration and cumulative headroom wait for the full walk — a partial vector is
          not a book.
        </p>
      </ConcentrationShell>
    );
  }
  if (state.phase === "outpaced") {
    return (
      <ConcentrationShell engine={engine}>
        <p className={styles.incrementsContradiction} data-testid={`concentration-outpaced-${engine}`}>
          The book re-materialized {String(state.supersessions)} time
          {state.supersessions === 1 ? "" : "s"} while being walked — no single batch was ever
          fully in hand, so no concentration claim is made.
        </p>
      </ConcentrationShell>
    );
  }
  if (state.phase === "failed" || rows === null || bins === null) {
    return (
      <ConcentrationShell engine={engine}>
        <p className={styles.incrementsContradiction} data-testid={`concentration-failed-${engine}`}>
          The walk failed before the book was fully in hand, so no concentration claim is made.
        </p>
      </ConcentrationShell>
    );
  }

  // r100: a terminal page proves only that the cursor ended. "Walked all"
  // needs the server's own count to agree — a premature terminal page must
  // never draw a partial vector as the book.
  if (state.total !== null && rows.length !== state.total) {
    return (
      <ConcentrationShell engine={engine}>
        <p className={styles.incrementsContradiction} data-testid={`concentration-short-${engine}`}>
          {`WALK CONTRADICTION: the cursor ended after ${String(rows.length)} rows but the ` +
            `server counted ${String(state.total)} qualifying — the vector is not the book, ` +
            `so no concentration claim is made.`}
        </p>
      </ConcentrationShell>
    );
  }

  const curve = headroomCurve(bins);
  const pareto = paretoView(rows, bins.decimals);
  const batchId = state.batch.id;

  return (
    <ConcentrationShell engine={engine}>
      {/* ---- SLOT 3: the takeaway — completeness and the floor, FIRST. ---- */}
      <p className={styles.answerLine} data-testid={`concentration-takeaway-${engine}`}>
        {state.total === null
          ? `Walked ${String(rows.length)} rows of batch #${String(batchId)} on ${engine} — the ` +
            `server stated no qualifying total, so completeness rests on the cursor alone; ${floorClause}.`
          : `Walked all ${String(rows.length)} of the ${String(state.total)} qualifying rows of ` +
            `batch #${String(batchId)} on ${engine}; ${floorClause}.`}
      </p>

      {/* ---- VIEW 1: cumulative headroom ledger. ---- */}
      {curve.kind === "refused" ? (
        <p className={styles.incrementsContradiction} data-testid={`curve-refused-${engine}`}>
          {curve.reason}
        </p>
      ) : (
        <div data-testid={`headroom-curve-${engine}`}>
          <p className={styles.methodLine} data-testid={`curve-asides-${engine}`}>
            {curveAsidesLine(curve)}
          </p>
          <table className={styles.curveTable} data-testid={`curve-table-${engine}`}>
            <thead>
              <tr>
                <th>within</th>
                <th className={styles.curveNum}>accounts</th>
                <th className={styles.curveNum}>Σ debt</th>
              </tr>
            </thead>
            <tbody>
              {curve.cells.map((cell) => (
                <tr key={cell.label} data-testid="curve-cell">
                  <td>{cell.label}</td>
                  <td className={styles.curveNum}>{cell.cumulativeAccounts}</td>
                  <td className={styles.curveNum} data-testid="curve-debt">
                    {money(cell.cumulativeDebt, curve.decimals)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.methodLine} data-testid={`curve-method-${engine}`}>
            {CURVE_METHOD}
          </p>
        </div>
      )}

      {/* ---- VIEW 2: Pareto tiers. ---- */}
      {pareto.kind === "empty" ? (
        <p className={styles.methodLine} data-testid={`pareto-empty-${engine}`}>
          {paretoEmptyLine(pareto.excluded)}
        </p>
      ) : (
        <div data-testid={`pareto-${engine}`}>
          <p className={styles.answerLine} data-testid={`pareto-denominator-${engine}`}>
            {`The walked book sums to ${money(pareto.totalDebt, pareto.decimals)} across ${String(pareto.counted)} ${pareto.counted === 1 ? "borrower" : "borrowers"}` +
              `${pareto.excluded > 0 ? `; ${String(pareto.excluded)} ${pareto.excluded === 1 ? "row carries" : "rows carry"} no positive debt figure and ${pareto.excluded === 1 ? "sits" : "sit"} outside both sides of every share` : ""}.` +
              `${pareto.dust ? " A book this small is DUST under the named $1,000 floor: the numbers stand, the visual weight does not." : ""}`}
          </p>
          {!pareto.dust && (
            <div className={styles.chartScroll} data-testid={`pareto-frame-${engine}`}>
              <svg
                width={SHARE_BAR_MAX + 560}
                height={pareto.tiers.length * SHARE_ROW_H + 4}
                viewBox={`0 0 ${String(SHARE_BAR_MAX + 560)} ${String(pareto.tiers.length * SHARE_ROW_H + 4)}`}
                role="img"
                aria-label={`share of ${engine} walked debt held by the largest borrowers, on an absolute 0 to 100 percent axis`}
                style={{ display: "block" }}
                data-testid={`pareto-bars-${engine}`}
              >
                {pareto.tiers.map((tier, index) => {
                  const y = index * SHARE_ROW_H + 2;
                  const barWidth = Math.round(
                    (Number(BigInt(tier.shareTenths)) / 1000) * SHARE_BAR_MAX,
                  );
                  return (
                    <g key={tier.n} data-testid="pareto-tier" data-n={String(tier.n)}>
                      {barWidth > 0 && (
                        <rect
                          className={styles.incrementsBar}
                          x={0}
                          y={y + 3}
                          width={barWidth}
                          height={SHARE_ROW_H - 9}
                        />
                      )}
                      <text
                        className={styles.incrementsValue}
                        x={SHARE_BAR_MAX + 8}
                        y={y + 12}
                        data-testid="pareto-tier-line"
                      >
                        {`top ${String(tier.n)} hold${tier.n === 1 ? "s" : ""} ${paretoShareLabel(tier.shareTenths)} (${money(tier.topDebt, pareto.decimals)} of ${money(pareto.totalDebt, pareto.decimals)})`}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          {pareto.dust && (
            <ul data-testid={`pareto-dust-list-${engine}`}>
              {pareto.tiers.map((tier) => (
                <li key={tier.n} className={styles.methodLine} data-testid="pareto-tier-line">
                  {`top ${String(tier.n)} hold${tier.n === 1 ? "s" : ""} ${paretoShareLabel(tier.shareTenths)} (${money(tier.topDebt, pareto.decimals)} of ${money(pareto.totalDebt, pareto.decimals)})`}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.methodLine} data-testid={`pareto-method-${engine}`}>
            {PARETO_METHOD}
          </p>
        </div>
      )}
    </ConcentrationShell>
  );
}
