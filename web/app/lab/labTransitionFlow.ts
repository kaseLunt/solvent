// The lane-transition FLOW's pure geometry (Wave W-SK, contract 1.7.0).
//
// `labTransition.ts` decides WHETHER the matrix may render; this module decides
// WHERE its ink goes. It is pure so the laws are testable without a browser:
//
//   - ONE LINEAR SCALE. Ribbon thickness is `rows` on one scale across the
//     WHOLE matrix, anchored at the widest cell. Per-lane normalization would
//     draw two different rulers inside one picture and lie about which flow is
//     bigger. A 1-row cell keeps a visible hairline floor; the floor is on the
//     INK, never on the number, and an absent cell draws nothing at all.
//     A FLOORED RIBBON IS DISCLOSED (W-SK-B): the floor breaks the scale for
//     exactly the cells it lifts, so `ribbonFloored` flags each one, the
//     layout counts them, and the panel prints that count whenever it is
//     nonzero. The picture never claims a linearity the floor took away.
//   - NONEMPTY-ONLY NODES. A lane whose side count is zero draws NO node block
//     on that side, the same law the book risk map follows. Its axis label
//     still renders, dimmed, so the 10-lane vocabulary stays complete and an
//     absent node reads as a knowable zero rather than a missing lane.
//   - THICKNESS IS LAYOUT; NUMBERS ARE WIRE. Every count a label prints is the
//     wire's own margin integer (`from_rows[i]` / `to_rows[i]`), never a sum
//     recomputed here. Floats compute pixel positions only (LAW-4).
//   - THE CRIT TINT IS THE COMPARATOR'S, NOT THE LANE'S. On the engine whose
//     comparator IS its liquidation test (`comparator === "hf_wad"`, the same
//     `eligibleTint` asymmetry `LabRunBookDetail.tsx` applies), `crit` rides
//     EVERY ribbon arriving in a below-1.00 bucket lane, held diagonals
//     included (W-SK-B ruling): a row that stayed below 1.00 is still in the
//     liquidation set, and a reader using the tint to find that set must see
//     it. Held keeps its mute and changed keeps its emphasis, so the two stay
//     distinguishable. On the Debt Manager that region is a DISCLOSURE, so its
//     arrivals keep the neutral classes and no verdict is derived from a lane
//     (spec §1.2).
//   - THE UNMEASURED DIAGONAL IS ITS OWN CLASS. Cell (N+1, N+1) has
//     `from === to`, but it is NOT a held lane: nothing was measured, so
//     nothing can be said to have held. It never shares a class with
//     held-measured rows.
//
// Geometry constants are RENDERED CSS PIXELS (LAW-3): the caller hands this
// module a MEASURED width and renders the SVG 1:1 at these numbers.

import type { RunBookTransitions } from "../../lib/runbook";
import { belowOneLanes, transitionRibbons, type TransitionRibbon } from "./labTransition";

/** The measured-width envelope (LAW-3): min scrolls, max stops stretching. */
export const FLOW_MIN_WIDTH = 560;
export const FLOW_MAX_WIDTH = 1280;
export const FLOW_FALLBACK_WIDTH = 900;

/** One side's label column: the longest lane label plus its margin count. */
export const FLOW_LABEL_W = 200;
/** The node block's width on each side. */
export const FLOW_NODE_W = 8;
/** Vertical gap between lane slots. */
export const FLOW_LANE_GAP = 8;
/** An empty lane still holds its dimmed label line at this minimum height. */
export const FLOW_ROW_MIN = 16;
/** The matrix's WIDEST cell renders this thick; everything else is linear. */
export const FLOW_RIBBON_MAX = 22;
/** The visibility floor for a 1-row cell in a large matrix: a hairline. */
export const FLOW_RIBBON_MIN = 1.5;
/** Vertical padding above the first slot and below the last. */
export const FLOW_PAD_V = 6;

export type FlowRibbonKind = "held" | "changed" | "unmeasured";

/**
 * The movement class the ribbon renders in. The unmeasured diagonal wins over
 * `held` deliberately: `from === to` there is a bookkeeping identity, not a
 * measured "did not move".
 */
export function ribbonKind(ribbon: TransitionRibbon): FlowRibbonKind {
  if (ribbon.unmeasured) return "unmeasured";
  return ribbon.held ? "held" : "changed";
}

/**
 * ONE linear scale for the whole matrix: the widest cell takes
 * `FLOW_RIBBON_MAX`, everything else is proportional, and a cell with at least
 * one row never falls below the `FLOW_RIBBON_MIN` hairline. The floor is a
 * visibility floor on the ink only — the exact `rows` integer rides the label,
 * the hover and the ledger table, never the thickness — and every cell the
 * floor lifts is flagged by `ribbonFloored`, because two floored cells of very
 * different sizes render identical ink and the panel must say so.
 */
export function ribbonThickness(rows: number, widestRows: number): number {
  if (rows <= 0 || widestRows <= 0) return 0;
  return Math.max(FLOW_RIBBON_MIN, (rows / widestRows) * FLOW_RIBBON_MAX);
}

/**
 * TRUE when the one linear scale would draw this cell THINNER than the
 * `FLOW_RIBBON_MIN` hairline, so its ink renders at the floor instead of on
 * the scale. A floored ribbon is the one place the picture and the advertised
 * scale disagree — with a 10,000-row widest cell, a 1-row cell and a 681-row
 * cell both render the same 1.5px — so the fact is exposed here rather than
 * hidden: the layout counts these, each one carries `data-floored`, and the
 * panel prints the count. A cell with no rows draws nothing and is not
 * floored; the widest cell never is.
 */
export function ribbonFloored(rows: number, widestRows: number): boolean {
  if (rows <= 0 || widestRows <= 0) return false;
  return (rows / widestRows) * FLOW_RIBBON_MAX < FLOW_RIBBON_MIN;
}

export interface FlowNode {
  side: "before" | "after";
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The wire's own margin integer for this side and lane. */
  rows: number;
}

export interface FlowLaneLabel {
  side: "before" | "after";
  lane: number;
  /** `${lane label} · ${margin}` — the ONLY vocabulary a flow text node holds. */
  text: string;
  /** True when this side holds no row in this lane: label dims, node absent. */
  empty: boolean;
  x: number;
  y: number;
  anchor: "start" | "end";
}

export interface FlowRibbon {
  ribbon: TransitionRibbon;
  kind: FlowRibbonKind;
  /**
   * True on EVERY ribbon arriving in a below-1.00 bucket lane on the wad
   * engine, held diagonals included: that band IS the liquidation set there.
   * Never true on the Debt Manager, whose same region is a disclosure.
   */
  crit: boolean;
  /** True when the visibility floor, not the scale, sets this thickness. */
  floored: boolean;
  thickness: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TransitionFlowLayout {
  width: number;
  height: number;
  nodes: FlowNode[];
  labels: FlowLaneLabel[];
  ribbons: FlowRibbon[];
  /** How many ribbons the visibility floor lifted off the one linear scale. */
  flooredCount: number;
}

/**
 * Lay the two-column flow out of a matrix `readTransitions` already accepted.
 * BEFORE lanes on the left, AFTER lanes on the right, top-down in the dense
 * lane order the wire states. The caller passes the MEASURED width.
 */
export function transitionFlowLayout(
  transitions: RunBookTransitions,
  width: number,
): TransitionFlowLayout {
  const ribbons = transitionRibbons(transitions);
  const laneCount = transitions.lanes.length;
  const widest = ribbons.reduce((max, ribbon) => (ribbon.rows > max ? ribbon.rows : max), 0);
  // The SAME asymmetry `LabRunBookDetail.tsx` applies: crit only where the
  // comparator itself defines eligibility. `belowOneLanes` already excludes
  // the two non-bucket lanes.
  const eligibleTint = transitions.comparator === "hf_wad";
  const region = new Set(belowOneLanes(transitions));

  // Each side's stacked ribbon thickness per lane. These are LAYOUT sums; the
  // printed count beside them is always the wire's margin integer.
  const leftStack = new Array<number>(laneCount).fill(0);
  const rightStack = new Array<number>(laneCount).fill(0);
  for (const ribbon of ribbons) {
    const thickness = ribbonThickness(ribbon.rows, widest);
    leftStack[ribbon.from] = (leftStack[ribbon.from] ?? 0) + thickness;
    rightStack[ribbon.to] = (rightStack[ribbon.to] ?? 0) + thickness;
  }

  // One slot per lane, both sides aligned, in lane order top-down.
  const slotTop = new Array<number>(laneCount).fill(0);
  const slotHeight = new Array<number>(laneCount).fill(0);
  let y = FLOW_PAD_V;
  for (let lane = 0; lane < laneCount; lane += 1) {
    slotTop[lane] = y;
    slotHeight[lane] = Math.max(FLOW_ROW_MIN, leftStack[lane] ?? 0, rightStack[lane] ?? 0);
    y += (slotHeight[lane] ?? 0) + FLOW_LANE_GAP;
  }
  const height = y - FLOW_LANE_GAP + FLOW_PAD_V;

  const leftNodeX = FLOW_LABEL_W;
  const rightNodeX = width - FLOW_LABEL_W - FLOW_NODE_W;

  const nodes: FlowNode[] = [];
  const labels: FlowLaneLabel[] = [];
  for (let lane = 0; lane < laneCount; lane += 1) {
    const laneLabel = transitions.lanes[lane]?.label ?? `lane ${String(lane)}`;
    const sides = [
      {
        side: "before" as const,
        margin: transitions.from_rows[lane] ?? 0,
        stack: leftStack[lane] ?? 0,
        nodeX: leftNodeX,
        labelX: FLOW_LABEL_W - 8,
        anchor: "end" as const,
      },
      {
        side: "after" as const,
        margin: transitions.to_rows[lane] ?? 0,
        stack: rightStack[lane] ?? 0,
        nodeX: rightNodeX,
        labelX: rightNodeX + FLOW_NODE_W + 8,
        anchor: "start" as const,
      },
    ];
    for (const { side, margin, stack, nodeX, labelX, anchor } of sides) {
      // NONEMPTY-ONLY: a zero-count side draws no node block at all.
      if (margin > 0) {
        nodes.push({
          side,
          lane,
          x: nodeX,
          y: slotTop[lane] ?? 0,
          width: FLOW_NODE_W,
          height: Math.max(stack, 2),
          rows: margin,
        });
      }
      labels.push({
        side,
        lane,
        text: `${laneLabel} · ${String(margin)}`,
        empty: margin === 0,
        x: labelX,
        y: (slotTop[lane] ?? 0) + 11,
        anchor,
      });
    }
  }

  // Ribbon anchors, one pass in wire order (`from` ascending, then `to`
  // ascending), so both ends stack deterministically: an outflow's ribbons
  // leave in `to` order and a lane's arrivals land in `from` order.
  const leftUsed = new Array<number>(laneCount).fill(0);
  const rightUsed = new Array<number>(laneCount).fill(0);
  const flowRibbons: FlowRibbon[] = ribbons.map((ribbon) => {
    const thickness = ribbonThickness(ribbon.rows, widest);
    const kind = ribbonKind(ribbon);
    const y1 = (slotTop[ribbon.from] ?? 0) + (leftUsed[ribbon.from] ?? 0) + thickness / 2;
    const y2 = (slotTop[ribbon.to] ?? 0) + (rightUsed[ribbon.to] ?? 0) + thickness / 2;
    leftUsed[ribbon.from] = (leftUsed[ribbon.from] ?? 0) + thickness;
    rightUsed[ribbon.to] = (rightUsed[ribbon.to] ?? 0) + thickness;
    return {
      ribbon,
      kind,
      // The W-SK-B ruling: on the wad engine EVERY arrival below 1.00 is crit,
      // held diagonals included — the reader using the tint to find the
      // liquidation set must see the rows that were already in it. `region`
      // holds bucket lanes only, so the unmeasured diagonal can never match.
      crit: eligibleTint && region.has(ribbon.to),
      floored: ribbonFloored(ribbon.rows, widest),
      thickness,
      x1: leftNodeX + FLOW_NODE_W,
      y1,
      x2: rightNodeX,
      y2,
    };
  });

  return {
    width,
    height,
    nodes,
    labels,
    ribbons: flowRibbons,
    flooredCount: flowRibbons.filter((flow) => flow.floored).length,
  };
}
