"use client";

// THE FULL-BOOK RISK MAP — a bespoke SVG density grid over app/book/riskBins'
// deterministic output, rendered under chart spec v4.
//
// WHAT THIS WAVE CHANGED, AND WHY EACH ONE WAS A WRONG READING
//
//   THE AXIS LIED ABOUT DISTANCE (RM-1). A plain log axis over a book holding
//   both $0.000001 dust and $40M whales spends most of its width on the dust
//   and crushes the money into the last inch. The sub-$1 population now sits
//   in a 48px ORDER-PRESERVING compressed lane at the left, and the main axis
//   is log-linear over $1 and up. A compressed lane whose compression is not
//   drawn is a lie about distance, so a BREAK GLYPH (RM-2) marks the seam and
//   a disclosure in STATE says horizontal distances across it do not compare.
//
//   THE CELLS WERE UNDER THE NON-TEXT CONTRAST FLOOR (RM-6). The old ramp
//   started at 0.16 opacity. It is 0.30 / 0.48 / 0.66 / 0.85 now, and every
//   nonempty cell carries a measured 3:1 hairline (see charts.module.css).
//
//   THE MARGINAL WAS TEXT INSIDE THE PICTURE (RM-7, R1). Seven exact money
//   strings floated in the SVG's right margin. Exact money never floats inside
//   a VISUAL; it is a BAR now, all seven on one common scale from zero, and
//   every exact number moved to the LEDGER directly beneath.
//
//   THE CRIT ROW HID ITS OWN MEMBERS (RM-8). Liquidatable marks at the same
//   debt drew on top of each other, so a row that looked like one account was
//   twenty. The breached row is a dedicated STRIP now: descending by exact
//   debt, first-fit packed into 8px lanes, UNCAPPED — the panel grows rather
//   than making a mark unreachable. No jitter (x is quantitative), no cluster
//   glyph (every mark must be individually hoverable and focusable).
//
//   TWELVE ADDRESSES SMEARED INTO ONE (RM-9). Direct mono addresses collided
//   and were silently dropped. They are NUMBERED CALLOUTS now, packed
//   deterministically in debt-rank order, with a leader line when displaced
//   and a counted overflow when not placeable. All twelve are in FORENSICS
//   with full addresses regardless.
//
//   THE PIXELS WERE NOT PIXELS (LAW-3, RM-11). The chart was authored at 980
//   user units and scaled by viewBox into whatever container it got. It
//   renders 1:1 from a measured width now, clamped [720, 1400], and scrolls
//   below the minimum instead of shrinking.

import { useEffect, useMemo, useState } from "react";
import {
  HEADROOM_BANDS,
  HEADROOM_BREACHED_BAND,
  LANE_AXIS_LABEL,
  OPACITY_LEGEND,
  usdExponentLabel,
  type RiskBinsResult,
} from "@/app/book/riskBins";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./charts.module.css";

/** The cell a reader has selected — band row × half-decade column. */
export interface DensityCell {
  band: number;
  xIndex: number;
}

/** Width-dependent facts the panel must STATE before the visual (R6). */
export interface DensityGeometry {
  /** Callouts that could not be placed clear at this width (RM-9). */
  calloutOverflow: number;
  /** Lanes the crit strip needed — 2 or more means marks were dodged (RM-8). */
  critLanes: number;
  /** Crit marks that were dodged into a lane below the first. */
  critStacked: number;
  /** Whether the compressed sub-$1 lane is drawn at all (RM-3). */
  laneRendered: boolean;
}

export interface DensityMapProps {
  result: RiskBinsResult;
  /** Accessible label, e.g. "full-book risk map for debt_manager …". */
  label: string;
  /** RM-14: `aria-describedby` resolves to the METHOD line, and only it. */
  methodId: string;
  /** RM-14: `aria-details` resolves to the FORENSICS region. */
  detailsId: string;
  selected: DensityCell | null;
  onSelect: (cell: DensityCell) => void;
  onActivate: (cell: DensityCell) => void;
  onGeometry: (geometry: DensityGeometry) => void;
}

// ---------------------------------------------------------------------------
// Geometry, in RENDERED CSS PIXELS (LAW-3).
// ---------------------------------------------------------------------------

const ROW_H = 28;
/** RM-7: bar column 72 plus 8 pad. No money text sits in the margin (R1). */
const MARGIN = { top: 10, right: 80, bottom: 48, left: 100 };
const MARGINAL_BAR_MAX = 72;
const MARGINAL_PAD = 8;

/** RM-1: the compressed sub-$1 lane, and the gap the break glyph occupies. */
const LANE_W = 48;
const LANE_GAP = 14;

/** RM-8: 8px lane pitch, 6×6 marks. */
const CRIT_PITCH = 8;
const CRIT_SIZE = 6;

/** RM-9: exclusion radius per band, and the leader's reach. */
const CALLOUT_RADIUS = 16;
const CALLOUT_OFFSETS = [8, -8, 12, -12, 16, -16, 20, -20, 24, -24];

/** RM-11: the measured-width envelope. */
export const DENSITY_MIN_WIDTH = 720;
export const DENSITY_MAX_WIDTH = 1400;
export const DENSITY_FALLBACK_WIDTH = 980;

const STEP_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: styles.binStep1 ?? "",
  2: styles.binStep2 ?? "",
  3: styles.binStep3 ?? "",
  4: styles.binStep4 ?? "",
};

/**
 * The axis word for a band. "0–2%" is an interval; "0–2% left" is a fact
 * about an account. The breached row needs no suffix — it is already a
 * sentence.
 */
function bandAxisLabel(index: number): string {
  const band = HEADROOM_BANDS[index];
  if (band === undefined) return "?";
  return index === HEADROOM_BREACHED_BAND ? band.label : `${band.label} left`;
}

/** Exact-ratio bar length: bigint scaling, so a 30-digit Σ keeps its ratio. */
function barLength(value: bigint, peak: bigint, max: number): number {
  if (value <= 0n || peak <= 0n) return 0;
  return (Number((value * 1_000_000n) / peak) / 1_000_000) * max;
}

export function DensityMap({
  result,
  label,
  methodId,
  detailsId,
  selected,
  onSelect,
  onActivate,
  onGeometry,
}: DensityMapProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>({
    min: DENSITY_MIN_WIDTH,
    max: DENSITY_MAX_WIDTH,
    fallback: DENSITY_FALLBACK_WIDTH,
  });

  const geometry = useMemo(() => layout(result, width), [result, width]);
  const {
    height,
    plotW,
    laneRendered,
    laneRight,
    px,
    bandTop,
    bandHeight,
    bandCenter,
    ticks,
    critMarks,
    critLanes,
    critStacked,
    callouts,
    calloutOverflow,
    marginalPeak,
  } = geometry;

  // R6: the panel states these BEFORE the visual, and only this component can
  // know them — they are functions of the measured width.
  useEffect(() => {
    onGeometry({ calloutOverflow, critLanes, critStacked, laneRendered });
  }, [onGeometry, calloutOverflow, critLanes, critStacked, laneRendered]);

  // RM-13: ONE tab stop for the whole grid. The selection is an index into the
  // bins array, which is sorted band-then-column, so ArrowRight/ArrowLeft walk
  // reading order and ArrowUp/ArrowDown change band at the nearest column.
  const selectedIndex = useMemo(
    () =>
      selected === null
        ? -1
        : result.bins.findIndex(
            (bin) => bin.band === selected.band && bin.xIndex === selected.xIndex,
          ),
    [result.bins, selected],
  );

  const [focused, setFocused] = useState(false);

  const move = (delta: "left" | "right" | "up" | "down") => {
    if (result.bins.length === 0) return;
    if (selectedIndex < 0) {
      const first = result.bins[0];
      if (first !== undefined) onSelect({ band: first.band, xIndex: first.xIndex });
      return;
    }
    const current = result.bins[selectedIndex];
    if (current === undefined) return;
    if (delta === "left" || delta === "right") {
      const next = result.bins[selectedIndex + (delta === "right" ? 1 : -1)];
      if (next !== undefined) onSelect({ band: next.band, xIndex: next.xIndex });
      return;
    }
    // Band change: the nearest column in the nearest band that has any bin.
    const direction = delta === "down" ? 1 : -1;
    for (let band = current.band + direction; band >= 0 && band < HEADROOM_BANDS.length; band += direction) {
      const candidates = result.bins.filter((bin) => bin.band === band);
      if (candidates.length === 0) continue;
      let best = candidates[0];
      if (best === undefined) continue;
      for (const candidate of candidates) {
        if (
          Math.abs(candidate.xIndex - current.xIndex) < Math.abs(best.xIndex - current.xIndex)
        ) {
          best = candidate;
        }
      }
      onSelect({ band: best.band, xIndex: best.xIndex });
      return;
    }
  };

  return (
    <div data-testid="density-map">
      <div className={styles.measuredFrame} ref={ref} data-testid="density-frame">
        <svg
          className={styles.chart}
          width={width}
          height={height}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          role="img"
          aria-label={label}
          // RM-14: METHOD only on describedby; FORENSICS on details.
          aria-describedby={methodId}
          aria-details={detailsId}
          // RM-13: the roving tab stop.
          tabIndex={0}
          data-testid="density-grid"
          data-width={String(width)}
          data-crit-lanes={String(critLanes)}
          data-strip-height={String(bandHeight(HEADROOM_BREACHED_BAND))}
          data-callout-overflow={String(calloutOverflow)}
          data-lane={laneRendered ? "true" : "false"}
          onFocus={() => {
            setFocused(true);
            if (selectedIndex < 0) {
              const first = result.bins[0];
              if (first !== undefined) onSelect({ band: first.band, xIndex: first.xIndex });
            }
          }}
          onBlur={() => {
            setFocused(false);
          }}
          onKeyDown={(event) => {
            switch (event.key) {
              case "ArrowRight":
                event.preventDefault();
                move("right");
                return;
              case "ArrowLeft":
                event.preventDefault();
                move("left");
                return;
              case "ArrowDown":
                event.preventDefault();
                move("down");
                return;
              case "ArrowUp":
                event.preventDefault();
                move("up");
                return;
              case "Enter":
              case " ": {
                event.preventDefault();
                const bin = result.bins[selectedIndex];
                if (bin !== undefined) onActivate({ band: bin.band, xIndex: bin.xIndex });
                return;
              }
              default:
                return;
            }
          }}
        >
          {/* Band rows: hairline separators + the reader-words band labels. */}
          {HEADROOM_BANDS.map((band, index) => (
            <g key={band.id}>
              <line
                className={styles.grid}
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={bandTop(index)}
                y2={bandTop(index)}
              />
              <text
                className={styles.axisLabel}
                x={MARGIN.left - 8}
                y={bandCenter(index) + 4}
                textAnchor="end"
                data-testid="density-band-label"
              >
                {bandAxisLabel(index)}
                <title>{band.meaning}</title>
              </text>
            </g>
          ))}
          <line
            className={styles.grid}
            x1={MARGIN.left}
            x2={MARGIN.left + plotW}
            y1={bandTop(HEADROOM_BANDS.length)}
            y2={bandTop(HEADROOM_BANDS.length)}
          />

          {/* RM-4 TICK POLICY: true decades from $1 up, thinned by stride. No
              interior tick and no interior gridline exists inside the lane —
              a compressed lane has no ruler, and drawing one would invite the
              reading the lane's whole disclosure denies. */}
          {ticks.map((decade) => (
            <g key={`tick-${String(decade)}`} data-testid="density-x-tick">
              <line
                className={styles.grid}
                data-testid="density-x-gridline"
                data-x={String(px(decade))}
                x1={px(decade)}
                x2={px(decade)}
                y1={MARGIN.top}
                y2={bandTop(HEADROOM_BANDS.length)}
              />
              <text
                className={styles.axisLabel}
                x={px(decade)}
                y={height - 24}
                textAnchor="middle"
              >
                {usdExponentLabel(decade)}
              </text>
            </g>
          ))}

          {/* RM-1 / RM-4: the lane's ONE axis label. */}
          {laneRendered && (
            <text
              className={styles.axisLabel}
              data-testid="density-lane-label"
              x={MARGIN.left + LANE_W / 2}
              y={height - 24}
              textAnchor="middle"
            >
              {LANE_AXIS_LABEL}
            </text>
          )}

          {/* RM-9 LEADERS, painted BEFORE all data ink so a hairline never
              crosses a mark it points at. */}
          {callouts
            .filter((callout) => callout.leader)
            .map((callout) => (
              <line
                key={`leader-${callout.account}`}
                className={styles.leader}
                data-testid="density-callout-leader"
                data-account={callout.account}
                x1={callout.markX}
                y1={callout.markY}
                x2={callout.anchorX}
                y2={callout.anchorY}
              />
            ))}

          {/* Bin rects — quantized opacity, exact count and Σ debt in the
              title, and the exact equivalent of both in the LEDGER below. */}
          {result.bins.map((bin) => {
            const rect = geometry.binRect(bin.xIndex);
            const isSelected =
              selected !== null && selected.band === bin.band && selected.xIndex === bin.xIndex;
            return (
              <rect
                key={`bin-${String(bin.band)}-${String(bin.xIndex)}`}
                className={`${styles.binCell ?? ""} ${STEP_CLASS[bin.step]} ${
                  isSelected ? (styles.binSelected ?? "") : ""
                }`}
                data-testid="risk-bin"
                data-band={String(bin.band)}
                data-x-index={String(bin.xIndex)}
                data-step={String(bin.step)}
                data-selected={isSelected ? "true" : "false"}
                x={rect.x}
                y={bandTop(bin.band) + 2}
                width={rect.width}
                height={bandHeight(bin.band) - 4}
                onClick={() => {
                  onSelect({ band: bin.band, xIndex: bin.xIndex });
                  onActivate({ band: bin.band, xIndex: bin.xIndex });
                }}
              >
                <title>{bin.title}</title>
              </rect>
            );
          })}

          {/* RM-8 THE CRIT STRIP: descending by exact debt, first-fit packed
              into 8px lanes, uncapped. Every mark stays individually
              hoverable — no cluster glyph, no mod-N lane reuse. */}
          {critMarks.map((mark) => (
            <rect
              key={`crit-${mark.account}`}
              className={styles.dotCrit}
              data-testid="risk-crit"
              data-lane={String(mark.lane)}
              data-account={mark.account}
              x={mark.x - CRIT_SIZE / 2}
              y={mark.y - CRIT_SIZE / 2}
              width={CRIT_SIZE}
              height={CRIT_SIZE}
              rx={1}
            >
              <title>{mark.title}</title>
            </rect>
          ))}

          {/* RM-9 NUMBERED CALLOUTS. The number is the reader's index into the
              FORENSICS exposure list, where the full address lives. */}
          {callouts.map((callout) => (
            <text
              key={`callout-${callout.account}`}
              className={styles.callout}
              data-testid="risk-map-callout"
              data-rank={String(callout.rank)}
              data-account={callout.account}
              data-leader={callout.leader ? "true" : "false"}
              x={callout.anchorX}
              y={callout.anchorY}
              textAnchor={callout.anchor}
            >
              {String(callout.rank)}
            </text>
          ))}

          {/* RM-2 THE BREAK GLYPH, VISIBLE: a dashed hairline across the plot
              at the lane's right edge, plus two diagonals crossing the axis
              baseline. Never .refLine — that vocabulary belongs to crit. */}
          {laneRendered && (
            <g data-testid="density-axis-break">
              <line
                className={styles.axisBreak}
                x1={laneRight}
                x2={laneRight}
                y1={MARGIN.top}
                y2={bandTop(HEADROOM_BANDS.length)}
              />
              {[-2.5, 2.5].map((offset) => (
                <line
                  key={`break-${String(offset)}`}
                  className={styles.axisBreak}
                  data-testid="density-axis-break-diagonal"
                  x1={laneRight + offset - 3.5}
                  y1={bandTop(HEADROOM_BANDS.length) + 3.5}
                  x2={laneRight + offset + 3.5}
                  y2={bandTop(HEADROOM_BANDS.length) - 3.5}
                />
              ))}
            </g>
          )}

          {/* RM-7 THE MARGINAL BARS: one per band, length proportional to that
              band's exact Σ debt, all seven on ONE common scale from zero. A
              zero Σ draws no ink — a bar of length zero is not a small bar. */}
          <line
            className={styles.grid}
            x1={MARGIN.left + plotW + MARGINAL_PAD}
            x2={MARGIN.left + plotW + MARGINAL_PAD}
            y1={MARGIN.top}
            y2={bandTop(HEADROOM_BANDS.length)}
          />
          {result.bandTotals.map((marginal) => {
            const length = barLength(marginal.debt, marginalPeak, MARGINAL_BAR_MAX);
            if (length <= 0) return null;
            return (
              <rect
                key={`marginal-${String(marginal.band)}`}
                className={styles.barFlow}
                data-testid="density-band-bar"
                data-band={String(marginal.band)}
                data-length={length.toFixed(4)}
                x={MARGIN.left + plotW + MARGINAL_PAD}
                y={bandCenter(marginal.band) - 5}
                width={Math.max(length, 1.5)}
                height={10}
              >
                <title>{marginal.title}</title>
              </rect>
            );
          })}

          <text
            className={styles.axisLabel}
            x={MARGIN.left + plotW / 2}
            y={height - 6}
            textAnchor="middle"
          >
            debt (usd, log)
          </text>
        </svg>
      </div>

      {/* The quantized opacity legend — four discrete steps, never a gradient.
          Every exact number it could have carried is in the LEDGER instead. */}
      <div className={styles.densityLegend} data-testid="density-legend">
        <span className={styles.densityLegendSteps} aria-hidden>
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS1 ?? ""}`} />
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS2 ?? ""}`} />
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS3 ?? ""}`} />
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS4 ?? ""}`} />
        </span>
        <span>{OPACITY_LEGEND}</span>
        {focused && (
          <span data-testid="density-keyboard-hint">
            · arrow keys move the selection, Enter opens the cell&apos;s exact detail below
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The layout pass — pure, so every position in it is testable without a DOM.
// ---------------------------------------------------------------------------

interface CritMark {
  account: string;
  title: string;
  x: number;
  y: number;
  lane: number;
}

interface Callout {
  account: string;
  rank: number;
  markX: number;
  markY: number;
  anchorX: number;
  anchorY: number;
  anchor: "start" | "end";
  leader: boolean;
}

function layout(result: RiskBinsResult, width: number) {
  const plotW = width - MARGIN.left - MARGIN.right;

  // RM-3: the lane exists iff the main axis has something above $1 AND at
  // least one mark sits below it. An all-sub-$1 book gets a plain log axis
  // over its true domain, with no lane and no break glyph — compressing the
  // only population on the chart would compress the chart.
  const laneRendered = result.xMaxExp > 0 && result.belowOne.count > 0;
  const laneLeft = MARGIN.left;
  const laneRight = MARGIN.left + LANE_W;
  const mainLeft = laneRendered ? laneRight + LANE_GAP : MARGIN.left;
  const mainRight = MARGIN.left + plotW;

  const laneSpan = Math.max(0 - result.xMinExp, 0.5);
  const mainSpan = laneRendered
    ? Math.max(result.xMaxExp, 0.5)
    : Math.max(result.xMaxExp - result.xMinExp, 0.5);
  const mainOrigin = laneRendered ? 0 : result.xMinExp;

  const px = (exponent: number): number => {
    if (laneRendered && exponent < 0) {
      return laneLeft + ((exponent - result.xMinExp) / laneSpan) * LANE_W;
    }
    return mainLeft + ((exponent - mainOrigin) / mainSpan) * (mainRight - mainLeft);
  };

  // RM-9 / RM-8 need the crit strip's height before any y is known, and the
  // strip's height needs the crit packing, which needs px. So: pack first.
  const critMarks: CritMark[] = [];
  const lanes: number[][] = [];
  for (const point of result.crit) {
    const x = px(point.x);
    let lane = 0;
    for (;;) {
      const occupied = lanes[lane];
      if (occupied === undefined) {
        lanes[lane] = [x];
        break;
      }
      // A TRUE x COLLISION is the only thing that opens a lane (RM-8).
      if (!occupied.some((other) => Math.abs(other - x) < CRIT_SIZE + 1)) {
        occupied.push(x);
        break;
      }
      lane += 1;
    }
    critMarks.push({ account: point.account, title: point.title, x, y: 0, lane });
  }
  const critLanes = Math.max(lanes.length, 1);
  const critStacked = critMarks.filter((mark) => mark.lane > 0).length;

  // RM-8: the strip is UNCAPPED. The panel grows rather than making a mark
  // unreachable, because "unreachable" is exactly what the strip fixes.
  const stripHeight = Math.max(ROW_H, CRIT_PITCH + critLanes * CRIT_PITCH);
  const heights = HEADROOM_BANDS.map((_band, index) =>
    index === HEADROOM_BREACHED_BAND ? stripHeight : ROW_H,
  );
  const tops: number[] = [];
  let cursor = MARGIN.top;
  for (const bandHeightValue of heights) {
    tops.push(cursor);
    cursor += bandHeightValue;
  }
  tops.push(cursor);
  const plotH = cursor - MARGIN.top;
  const height = MARGIN.top + plotH + MARGIN.bottom;

  const bandTop = (index: number) => tops[index] ?? MARGIN.top;
  const bandHeight = (index: number) => heights[index] ?? ROW_H;
  const bandCenter = (index: number) => bandTop(index) + bandHeight(index) / 2;

  for (const mark of critMarks) {
    mark.y = bandTop(HEADROOM_BREACHED_BAND) + CRIT_PITCH / 2 + mark.lane * CRIT_PITCH + 1;
  }

  // RM-4: true decades from $1 up when the lane exists (its interior carries
  // no ticks at all), otherwise across the true domain.
  const decades: number[] = [];
  const firstDecade = laneRendered ? 0 : Math.ceil(result.xMinExp);
  for (let k = firstDecade; k <= Math.floor(result.xMaxExp); k += 1) decades.push(k);
  const stride = Math.max(1, Math.ceil(decades.length / 8));
  const ticks = decades.filter((_value, index) => index % stride === 0);

  // AC-9: a lane bin stays INSIDE the lane, and never thinner than 1.5px.
  const binRect = (xIndex: number): { x: number; width: number } => {
    const raw1 = px(xIndex / 2);
    const raw2 = px((xIndex + 1) / 2);
    const rectWidth = Math.max(raw2 - raw1 - 2, 1.5);
    if (laneRendered && xIndex < 0) {
      const clampedX = Math.min(Math.max(raw1 + 1, laneLeft), laneRight - rectWidth);
      return { x: clampedX, width: rectWidth };
    }
    return { x: raw1 + 1, width: rectWidth };
  };

  // RM-9 CALLOUT PACKING, deterministic and in debt-rank order: the biggest
  // exposure always keeps the position nearest its mark, and a smaller one
  // yields to a leader line or to the counted overflow.
  const critY = new Map(critMarks.map((mark) => [mark.account, mark.y] as const));
  const placedByBand = new Map<number, number[]>();
  const callouts: Callout[] = [];
  let calloutOverflow = 0;
  for (const outlier of result.outliers) {
    const markX = px(outlier.x);
    const markY = critY.get(outlier.account) ?? bandCenter(outlier.band);
    const taken = placedByBand.get(outlier.band) ?? [];
    let placed = false;
    for (const offset of CALLOUT_OFFSETS) {
      const anchorX = markX + offset;
      if (anchorX < MARGIN.left + 4 || anchorX > MARGIN.left + plotW - 4) continue;
      if (taken.some((other) => Math.abs(other - anchorX) < CALLOUT_RADIUS)) continue;
      taken.push(anchorX);
      placedByBand.set(outlier.band, taken);
      callouts.push({
        account: outlier.account,
        rank: outlier.rank,
        markX,
        markY,
        anchorX,
        anchorY: markY - 6,
        anchor: offset >= 0 ? "start" : "end",
        // The FIRST offset is the undisplaced position; every other one is a
        // displacement, and a displaced number must say which mark it names.
        leader: offset !== CALLOUT_OFFSETS[0],
      });
      placed = true;
      break;
    }
    if (!placed) calloutOverflow += 1;
  }

  let marginalPeak = 0n;
  for (const marginal of result.bandTotals) {
    if (marginal.debt > marginalPeak) marginalPeak = marginal.debt;
  }

  return {
    height,
    plotW,
    plotH,
    laneRendered,
    laneLeft,
    laneRight,
    mainLeft,
    px,
    bandTop,
    bandHeight,
    bandCenter,
    binRect,
    ticks,
    critMarks,
    critLanes,
    critStacked,
    callouts,
    calloutOverflow,
    marginalPeak,
  };
}
