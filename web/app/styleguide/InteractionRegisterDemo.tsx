"use client";

// The §11 chart interaction register, demonstrated on one specimen chart —
// THE REFERENCE IMPLEMENTATION every chart copies, and the register is binding:
//
//   · Tab enters the chart — ONE tab stop; marks are never individual stops.
//   · ←/→ traverse marks in data order; Home/End jump to first/last.
//   · The focused mark wears a 2px accent ring and its readout PERSISTS —
//     focus or click populates it; hover is never the only path.
//   · Enter opens the mark's evidence (here: its ledger row takes focus).
//   · Esc leaves the chart.
//   · aria-details → the LEDGER (the tabular twin: one row per mark, exact
//     strings); aria-describedby → METHOD. A visible "EXACT DATA ↓" control
//     moves focus to the ledger. Screen readers get the twin, not 100
//     verbose point descriptions.
//
// The values are static SPECIMEN strings (the page's banner and the canon's
// own readout specimen at −30%); geometry is precomputed — this file is
// about the REGISTER, not a scale module.

import { useRef, useState, type KeyboardEvent } from "react";
import styles from "./interaction.module.css";

interface StressMark {
  /** ETH price step, signed with U+2212. */
  step: string;
  /** Layer-2 exact eligible-debt string. */
  eligible: string;
  /** Signed Δ vs current (bare zero at the baseline — §12.16). */
  delta: string;
  cx: number;
  cy: number;
}

const MARKS: readonly StressMark[] = [
  { step: "0%", eligible: "$8,468.238278", delta: "$0", cx: 46, cy: 135 },
  { step: "−10%", eligible: "$41,882.090121", delta: "+$33,413.851843", cx: 122, cy: 111 },
  { step: "−20%", eligible: "$273,551.004997", delta: "+$265,082.766719", cx: 198, cy: 82 },
  { step: "−30%", eligible: "$1,213,020.108619", delta: "+$1,204,551.870341", cx: 274, cy: 59 },
  { step: "−40%", eligible: "$4,905,118.771213", delta: "+$4,896,650.532935", cx: 350, cy: 38 },
  { step: "−50%", eligible: "$9,612,004.339008", delta: "+$9,603,536.100730", cx: 426, cy: 28 },
] as const;

const WIDTH = 460;
const HEIGHT = 180;
const BASELINE = 150;

export function InteractionRegisterDemo() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const ledgerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  // Persists past blur BY DESIGN: leaving the chart does not erase the
  // reading — Esc exits, the readout stays.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const mark = focusIndex === null ? null : (MARKS[focusIndex] ?? null);

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const current = focusIndex ?? 0;
    switch (event.key) {
      case "ArrowRight":
        setFocusIndex(Math.min(current + 1, MARKS.length - 1));
        break;
      case "ArrowLeft":
        setFocusIndex(Math.max(current - 1, 0));
        break;
      case "Home":
        setFocusIndex(0);
        break;
      case "End":
        setFocusIndex(MARKS.length - 1);
        break;
      case "Enter":
        // The mark's evidence: its ledger row (the aria-details target).
        rowRefs.current[current]?.focus();
        break;
      case "Escape":
        svgRef.current?.blur();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className={styles.frame}>
      <div className={styles.headRow}>
        <p className={styles.kicker}>specimen stress ladder · aave_v3 · eligible debt by ETH step</p>
        <button
          type="button"
          className={styles.exactData}
          data-testid="sg-ir-exact-data"
          onClick={() => ledgerRef.current?.focus()}
        >
          EXACT DATA ↓
        </button>
      </div>

      <svg
        ref={svgRef}
        className={styles.chart}
        data-testid="sg-ir-chart"
        data-focus-index={focusIndex ?? undefined}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        tabIndex={0}
        role="img"
        aria-label="Specimen stress ladder: eligible debt at six ETH price steps. Arrow keys traverse marks; Home and End jump to first and last; Enter opens the focused mark's ledger row; Escape leaves the chart."
        aria-describedby="sg-ir-method"
        aria-details="sg-ir-ledger"
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (focusIndex === null) setFocusIndex(0);
        }}
      >
        <line className={styles.axis} x1={8} x2={WIDTH - 8} y1={BASELINE} y2={BASELINE} />
        {MARKS.map((entry, index) => (
          <g key={entry.step}>
            <line className={styles.stem} x1={entry.cx} y1={BASELINE} x2={entry.cx} y2={entry.cy} />
            <circle
              className={styles.mark}
              cx={entry.cx}
              cy={entry.cy}
              r={4}
              onClick={() => {
                setFocusIndex(index);
                svgRef.current?.focus();
              }}
            >
              <title>{`${entry.step} · eligible ${entry.eligible}`}</title>
            </circle>
            <text className={styles.tick} x={entry.cx} y={BASELINE + 16} textAnchor="middle">
              {entry.step}
            </text>
          </g>
        ))}
        {mark !== null && (
          <circle
            className={styles.focusRing}
            data-testid="sg-ir-ring"
            cx={mark.cx}
            cy={mark.cy}
            r={8}
          />
        )}
      </svg>

      <div className={styles.readout} data-testid="sg-ir-readout">
        {mark === null
          ? "focus or click a mark — the readout populates and persists (hover is never the only path)"
          : `${mark.step} · eligible ${mark.eligible} · Δ ${mark.delta} · batch #18251`}
      </div>

      <div className={styles.ledger} id="sg-ir-ledger" ref={ledgerRef} tabIndex={-1}>
        <table className={styles.ledgerTable}>
          <caption className={styles.ledgerCaption}>
            LEDGER · the tabular twin — one row per mark, exact strings, same order
          </caption>
          <thead>
            <tr>
              <th>stress</th>
              <th>eligible (exact)</th>
              <th>Δ vs current (exact)</th>
            </tr>
          </thead>
          <tbody>
            {MARKS.map((entry, index) => (
              <tr
                key={entry.step}
                tabIndex={-1}
                data-testid={`sg-ir-ledger-row-${String(index)}`}
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
              >
                <td>{entry.step}</td>
                <td>{entry.eligible}</td>
                <td>{entry.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.method}>
        KEYBOARD · Tab enters (one stop) · ←/→ traverse marks in data order · Home/End jump ·
        Enter opens the mark&apos;s ledger row · Esc leaves. The focused mark wears a 2px accent
        ring; its readout persists.
      </p>
      <p className={styles.method} id="sg-ir-method">
        METHOD · SPECIMEN — six static stress steps for one aave_v3 book; x is the ETH price step
        in data order, stem height scales with log₁₀(eligible). Exact strings live in the ledger,
        not the geometry; Δ is signed (U+2212, bare zero at the baseline) and tone follows the
        outcome, not the sign.
      </p>
    </div>
  );
}
