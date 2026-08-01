// Pure bin module for the FULL-BOOK risk map (solvent-design SUPPLEMENT §16).
//
// The full-book vector is too many marks to draw honestly as a scatter, so
// this module reduces it to a deterministic density grid:
//
//   x — log10-USD HALF-DECADES: bin k spans [k/2, (k+1)/2) in log10 dollars,
//       so exact powers land on the LOWER edge of their half-decade.
//   y — FIXED liquidation-distance bands: breached / 0…−5% / −5…−10% /
//       −10…−25% / −25…−50% / <−50%.
//
// Honesty laws carried here (pinned by tests/unit/risk-bins.spec.ts):
//   - CRIT NEVER BINNED: verdict === "liquidatable" rows pass through as
//     individual points with exact-debt titles — a liquidatable whale must
//     never dissolve into a density cell.
//   - EXHAUSTIVE OR ASIDE: every row lands in exactly one bin, the crit
//     pass-through, or the counted aside (never / none / refused /
//     no-positive-debt). Nothing is dropped; Σ bins + crit + aside = rows.
//   - DETERMINISTIC: output is a pure, order-independent function of the
//     rows (bins sorted band-then-x, crit sorted by account, outliers sorted
//     by exact debt then account).
//   - counts quantize onto a 4-STEP opacity ramp (1/10/100/1000) — stepped,
//     never a gradient; the exact count stays in the bin's <title>.
//   - the top-12 debt outliers are NAMED (truncated address), ranked by the
//     exact bigint debt, never a float.
//
// Floats appear ONLY as chart geometry (log10 positions, band assignment
// from the display-precision distance string); every displayed number is
// exact string/bigint work.

import { formatUnits, parseDecimal } from "@solvent/client";
// Relative imports: this module is exercised by the unit specs under
// Playwright's transpiler as well as by Next (the positionRow convention).
import { renderEngineAmount } from "../../lib/book-format";
import { truncateAddress } from "../../lib/format";
import type { PositionRow } from "./positionRow";

/** The fixed distance bands (y axis), top-down. Index 0 is the breached row. */
export const DISTANCE_BANDS = [
  { id: "breached", label: "breached" },
  { id: "0..-5", label: "0…−5%" },
  { id: "-5..-10", label: "−5…−10%" },
  { id: "-10..-25", label: "−10…−25%" },
  { id: "-25..-50", label: "−25…−50%" },
  { id: "<-50", label: "<−50%" },
] as const;

/** The quantized count-opacity legend, verbatim (§16): stepped, never a gradient. */
export const OPACITY_LEGEND = "1 · 10 · 100 · 1,000 accounts";

/** How many debt outliers get direct mono labels. */
export const TOP_OUTLIERS = 12;

/** count → opacity step: thresholds 1 / 10 / 100 / 1,000. */
export function opacityStep(count: number): 1 | 2 | 3 | 4 {
  if (count >= 1000) return 4;
  if (count >= 100) return 3;
  if (count >= 10) return 2;
  return 1;
}

/**
 * A USD axis label for a log10 exponent.
 *
 * Integer exponents ≥ 0 use the named-power vocabulary ($1 · $10 · $100 ·
 * $1k · $10k · $100k · $1M …); sub-dollar decades are MONO-SCIENTIFIC
 * ("$1e-3") — cent notation is never invented. Half-decade edges render the
 * rounded exact power ("$316", "$3,162"), display-precision by construction
 * (bin EDGES are geometry; exact debts live in crit/outlier titles).
 */
export function usdExponentLabel(exponent: number): string {
  if (Number.isInteger(exponent)) {
    if (exponent < 0) return `$1e${String(exponent)}`;
    if (exponent > 14) return `$1e${String(exponent)}`;
    const suffix = ["", "k", "M", "B", "T"][Math.floor(exponent / 3)] ?? "";
    return `$${String(10 ** (exponent % 3))}${suffix}`;
  }
  if (exponent < 0) return `$${(10 ** exponent).toExponential(1)}`;
  const rounded = Math.round(10 ** exponent);
  return `$${rounded.toLocaleString("en-US")}`;
}

export interface RiskBin {
  /** Half-decade index: the bin spans [xIndex/2, (xIndex+1)/2) in log10 USD. */
  xIndex: number;
  /** Index into DISTANCE_BANDS. */
  band: number;
  count: number;
  /** Quantized opacity step (1/10/100/1000 thresholds). */
  step: 1 | 2 | 3 | 4;
  /** Hover title, e.g. "142 accounts · debt $100–$316 · −5…−10%". */
  title: string;
}

export interface RiskCritPoint {
  account: string;
  /** log10 USD debt — geometry only. */
  x: number;
  /** Crit lives on the breached band (index 0), drawn ON TOP of the bins. */
  band: 0;
  /** Exact-debt hover title — the table's own renderer, never a float. */
  title: string;
}

export interface RiskOutlier {
  account: string;
  /** The direct mono label: the truncated address. */
  label: string;
  /** log10 USD debt — geometry only. */
  x: number;
  /** The band row the label anchors to. */
  band: number;
}

/** Rows the map could not plot — COUNTED aside, never dropped. */
export interface RiskAside {
  /** liq-distance "never": no price can liquidate the position. */
  never: number;
  /** liq-distance "none": no factor-level solve was published. */
  none: number;
  /** refused rows: withheld, named upstream — unknowable, not zero. */
  refused: number;
  /** rows with no positive debt (or no solvable geometry) — unplottable on a log axis. */
  unplottable: number;
  total: number;
}

export interface RiskBinsResult {
  bins: RiskBin[];
  crit: RiskCritPoint[];
  outliers: RiskOutlier[];
  aside: RiskAside;
  /** The data's true decade domain, in log10-USD units (bin edges inclusive/exclusive). */
  xMinExp: number;
  xMaxExp: number;
  /** rows.length — the denominator every partition claim checks against. */
  total: number;
}

/** log10 of the row's USD debt, or null when no positive debt is published. */
function debtLog10(row: PositionRow): number | null {
  if (row.totals.debt === null) return null;
  if (parseDecimal(row.totals.debt) <= 0n) return null;
  const numeric = Number(formatUnits(row.totals.debt, row.totals.decimals, { trim: true }));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.log10(numeric);
}

/** Display-precision distance for BAND ASSIGNMENT only ("−7.5%" → −7.5). */
function distanceValue(display: string): number | null {
  const numeric = Number(display.replace("−", "-").replace("%", ""));
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Band index for a finite distance. Edges are inclusive UPWARD: −5 stays in
 * 0…−5%, −10 in −5…−10%, and so on. A non-negative distance (a solve the
 * wire served without a breach) sits in the 0…−5% band — the closest honest
 * placement on a fixed-band axis.
 */
function bandForDistance(distance: number): number {
  if (distance >= -5) return 1;
  if (distance >= -10) return 2;
  if (distance >= -25) return 3;
  if (distance >= -50) return 4;
  return 5;
}

function binTitle(count: number, xIndex: number, band: number): string {
  const accounts = count === 1 ? "1 account" : `${count.toLocaleString("en-US")} accounts`;
  const lower = usdExponentLabel(xIndex / 2);
  const upper = usdExponentLabel((xIndex + 1) / 2);
  const bandLabel = DISTANCE_BANDS[band]?.label ?? "?";
  return `${accounts} · debt ${lower}–${upper} · ${bandLabel}`;
}

/** Reduce one engine's full row vector to the deterministic density grid. */
export function buildRiskBins(rows: readonly PositionRow[]): RiskBinsResult {
  const counts = new Map<string, { xIndex: number; band: number; count: number }>();
  const crit: RiskCritPoint[] = [];
  const aside: RiskAside = { never: 0, none: 0, refused: 0, unplottable: 0, total: 0 };
  /** Plotted rows (binned + crit) compete for the outlier labels. */
  const plotted: { account: string; debt: bigint; x: number; band: number }[] = [];

  for (const row of rows) {
    // Refused first: a withheld row is counted as withheld whatever else it
    // carries (its verdict is unknowable by construction).
    if (row.status === "refused") {
      aside.refused += 1;
      continue;
    }
    if (row.verdict === "liquidatable") {
      // CRIT NEVER BINNED. A crit row without a positive debt cannot sit on
      // a log axis either — it is counted aside, still never binned.
      const x = debtLog10(row);
      if (x === null) {
        aside.unplottable += 1;
        continue;
      }
      crit.push({
        account: row.account,
        x,
        band: 0,
        title: `${truncateAddress(row.account)} · debt ${renderEngineAmount(
          row.totals.debt,
          row.totals.decimals,
        )} · liquidatable`,
      });
      plotted.push({ account: row.account, debt: parseDecimal(row.totals.debt ?? "0"), x, band: 0 });
      continue;
    }
    if (row.liqDistance.kind === "never") {
      aside.never += 1;
      continue;
    }
    if (row.liqDistance.kind === "none") {
      aside.none += 1;
      continue;
    }
    const x = debtLog10(row);
    if (x === null) {
      aside.unplottable += 1;
      continue;
    }
    let band: number;
    if (row.liqDistance.kind === "breached") {
      // Breached WITHOUT a crit verdict (the wire's own boundary statement):
      // binned on the breached band — visible, but only verdicts wear crit.
      band = 0;
    } else {
      const distance = distanceValue(row.liqDistance.display);
      if (distance === null) {
        aside.unplottable += 1;
        continue;
      }
      band = bandForDistance(distance);
    }
    const xIndex = Math.floor(x * 2);
    const key = `${String(band)}:${String(xIndex)}`;
    const bin = counts.get(key);
    if (bin === undefined) counts.set(key, { xIndex, band, count: 1 });
    else bin.count += 1;
    plotted.push({ account: row.account, debt: parseDecimal(row.totals.debt ?? "0"), x, band });
  }

  aside.total = aside.never + aside.none + aside.refused + aside.unplottable;

  const bins: RiskBin[] = Array.from(counts.values())
    .sort((a, b) => a.band - b.band || a.xIndex - b.xIndex)
    .map((bin) => ({
      xIndex: bin.xIndex,
      band: bin.band,
      count: bin.count,
      step: opacityStep(bin.count),
      title: binTitle(bin.count, bin.xIndex, bin.band),
    }));

  crit.sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));

  const outliers: RiskOutlier[] = plotted
    .slice()
    .sort((a, b) => {
      if (a.debt !== b.debt) return a.debt > b.debt ? -1 : 1;
      return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
    })
    .slice(0, TOP_OUTLIERS)
    .map((entry) => ({
      account: entry.account,
      label: truncateAddress(entry.account),
      x: entry.x,
      band: entry.band,
    }));

  // The domain spans the data's TRUE decades — bins and crit points both.
  const xIndexes = [
    ...bins.map((bin) => bin.xIndex),
    ...crit.map((point) => Math.floor(point.x * 2)),
  ];
  const kLo = xIndexes.length > 0 ? Math.min(...xIndexes) : 0;
  const kHi = xIndexes.length > 0 ? Math.max(...xIndexes) : 1;

  return {
    bins,
    crit,
    outliers,
    aside,
    xMinExp: kLo / 2,
    xMaxExp: (kHi + 1) / 2,
    total: rows.length,
  };
}
