// Pure bin module for the FULL-BOOK risk map.
//
// WAVE W-HR-A — the y axis is now HEADROOM, not liquidation distance.
//
// The old y axis binned "how far must the committed price axis fall before
// this account liquidates". For stable-collateral accounts that distance does
// not exist, so the map pushed the majority of the book into a `never` aside
// and drew a picture of the minority. Worse, the picture it drew was of the
// SAFE part of the book: the accounts nearest the boundary — the ones a risk
// lead opens the page for — were exactly the ones the axis could not place.
//
// The axes now are:
//
//   x — log10-USD HALF-DECADES: bin k spans [k/2, (k+1)/2) in log10 dollars,
//       so exact powers land on the LOWER edge of their half-decade.
//   y — the SEVEN headroom bands (lib/headroom): breached / 0–2 / 2–5 / 5–10 /
//       10–25 / 25–50 / ≥50 %, assigned in exact bigint by lib/headroom's
//       cross-multiplication — a float never decides a band edge. EVERY band
//       is LEFT-CLOSED: a headroom exactly at an edge belongs to the band
//       above, the top band included (W-HR-B).
//
// Honesty laws carried here (pinned by tests/unit/risk-bins.spec.ts):
//   - CRIT NEVER BINNED: verdict === "liquidatable" rows pass through as
//     individual points with exact-debt titles — a liquidatable whale must
//     never dissolve into a density cell. The breached band is likewise never
//     averaged away: it is its own row, and a bin holding ONE account is
//     drawn at the same size as a bin holding a thousand.
//   - EXHAUSTIVE OR ASIDE: every row lands in exactly one bin, the crit
//     pass-through, or the counted aside (no-debt / unknown / refused /
//     no-positive-debt). Nothing is dropped; Σ bins + crit + aside = rows.
//   - DETERMINISTIC: output is a pure, order-independent function of the
//     rows (bins sorted band-then-x, crit sorted by account, outliers sorted
//     by exact debt then account).
//   - counts quantize onto a 4-STEP opacity ramp (1/10/100/1000) — stepped,
//     never a gradient; the exact count stays in the bin's <title>.
//   - Σ DEBT IS EXACT: per bin and per band, summed as bigint in the engine's
//     own integer unit and rendered by the table's own renderer. The map is
//     single-engine by construction (its parent keys it by engine), so one
//     decimals scale governs the whole result.
//   - the top-12 debt outliers are NAMED (truncated address), ranked by the
//     exact bigint debt, never a float.
//
// Floats appear ONLY as chart geometry (log10 positions); every displayed
// number is exact string/bigint work.

import { formatUnits, parseDecimal } from "@solvent/client";
// Relative imports: this module is exercised by the unit specs under
// Playwright's transpiler as well as by Next (the positionRow convention).
import { renderEngineAmount } from "../../lib/book-format";
import { truncateAddress } from "../../lib/format";
import {
  HEADROOM_BANDS,
  HEADROOM_BREACHED_BAND,
  headroomBandLabel,
  headroomBandMeaning,
} from "../../lib/headroom";
import type { PositionRow } from "./positionRow";

/**
 * The map's y-axis vocabulary — the SEVEN headroom bands, top-down, index 0
 * the breached row. Re-exported from lib/headroom so the table cell and the
 * map can never fork the band set.
 */
export { HEADROOM_BANDS, HEADROOM_BREACHED_BAND };

/** The quantized count-opacity legend, verbatim: stepped, never a gradient. */
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
 * (bin EDGES are geometry; exact debts live in the Σ, crit and outlier titles).
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
  /** Index into HEADROOM_BANDS. */
  band: number;
  count: number;
  /** Exact Σ debt for the bin, engine-native integer unit. */
  debt: bigint;
  /** Quantized opacity step (1/10/100/1000 thresholds). */
  step: 1 | 2 | 3 | 4;
  /** Hover title: count · debt range · band · Σ debt · the band's meaning. */
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

/**
 * One band's marginal — the right-margin Σ that turns a density grid into a
 * reading. A band with 3 accounts and $40M of debt and a band with 3,000
 * accounts and $4k of debt look alike in a count grid; they are not alike.
 */
export interface RiskBandMarginal {
  band: number;
  label: string;
  count: number;
  /** Exact Σ debt over the band's binned AND crit rows. */
  debt: bigint;
  /** The exact Σ, rendered in the engine's own unit. */
  debtDisplay: string;
  /** Hover readout: count + Σ debt + what the band MEANS, in reader words. */
  title: string;
}

/** Rows the map could not plot — COUNTED aside, never dropped. */
export interface RiskAside {
  /** No debt at all (HF infinite): there is no boundary to have headroom from. */
  noDebt: number;
  /** No usable threshold/debt pair — headroom is unknown, not zero. */
  unknown: number;
  /** refused rows: withheld, named upstream — unknowable, not zero. */
  refused: number;
  /** rows with a band but no positive debt — unplottable on a log axis. */
  unplottable: number;
  total: number;
}

export interface RiskBinsResult {
  bins: RiskBin[];
  crit: RiskCritPoint[];
  outliers: RiskOutlier[];
  /** One entry per band, in band order — always HEADROOM_BANDS.length long. */
  bandTotals: RiskBandMarginal[];
  aside: RiskAside;
  /** The data's true decade domain, in log10-USD units (bin edges inclusive/exclusive). */
  xMinExp: number;
  xMaxExp: number;
  /** rows.length — the denominator every partition claim checks against. */
  total: number;
  /** The engine's value_decimals, carried so the caller renders the same unit. */
  decimals: number;
}

/** log10 of the row's USD debt, or null when no positive debt is published. */
function debtLog10(row: PositionRow): number | null {
  if (row.totals.debt === null) return null;
  if (parseDecimal(row.totals.debt) <= 0n) return null;
  const numeric = Number(formatUnits(row.totals.debt, row.totals.decimals, { trim: true }));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.log10(numeric);
}

/** The row's exact debt as a bigint — null stays 0n for a Σ (never invented). */
function exactDebt(row: PositionRow): bigint {
  return row.totals.debt === null ? 0n : parseDecimal(row.totals.debt);
}

function accountsPhrase(count: number): string {
  return count === 1 ? "1 account" : `${count.toLocaleString("en-US")} accounts`;
}

function binTitle(count: number, xIndex: number, band: number, debt: string): string {
  const lower = usdExponentLabel(xIndex / 2);
  const upper = usdExponentLabel((xIndex + 1) / 2);
  return (
    `${accountsPhrase(count)} · debt ${lower}–${upper} · headroom ${headroomBandLabel(band)} · ` +
    `Σ debt ${debt} · ${headroomBandMeaning(band)}`
  );
}

function bandTitle(count: number, band: number, debt: string): string {
  return (
    `${accountsPhrase(count)} at headroom ${headroomBandLabel(band)} · Σ debt ${debt} · ` +
    headroomBandMeaning(band)
  );
}

/**
 * Reduce one engine's full row vector to the deterministic density grid.
 *
 * The map's parent keys it by engine, so every row here shares one
 * `value_decimals`; the first row's scale governs the Σ rendering and is
 * carried out on the result so no caller has to guess it.
 */
export function buildRiskBins(rows: readonly PositionRow[]): RiskBinsResult {
  const decimals = rows[0]?.totals.decimals ?? 0;
  const counts = new Map<string, { xIndex: number; band: number; count: number; debt: bigint }>();
  const crit: RiskCritPoint[] = [];
  const aside: RiskAside = { noDebt: 0, unknown: 0, refused: 0, unplottable: 0, total: 0 };
  /** Plotted rows (binned + crit) compete for the outlier labels. */
  const plotted: { account: string; debt: bigint; x: number; band: number }[] = [];
  const bandCount = new Array<number>(HEADROOM_BANDS.length).fill(0);
  const bandDebt = new Array<bigint>(HEADROOM_BANDS.length).fill(0n);

  for (const row of rows) {
    // Refused first: a withheld row is counted as withheld whatever else it
    // carries (its headroom is unknowable by construction).
    if (row.status === "refused") {
      aside.refused += 1;
      continue;
    }
    if (row.headroom.kind === "no-debt") {
      aside.noDebt += 1;
      continue;
    }
    if (row.headroom.kind === "unknown") {
      aside.unknown += 1;
      continue;
    }
    const x = debtLog10(row);
    if (x === null) {
      // A band without a positive debt cannot sit on a log axis — counted,
      // never dropped, and never drawn at $0.
      aside.unplottable += 1;
      continue;
    }
    const debt = exactDebt(row);

    if (row.verdict === "liquidatable") {
      // CRIT NEVER BINNED.
      crit.push({
        account: row.account,
        x,
        band: HEADROOM_BREACHED_BAND,
        title: `${truncateAddress(row.account)} · debt ${renderEngineAmount(
          row.totals.debt,
          row.totals.decimals,
        )} · headroom ${row.headroom.display ?? "—"} · liquidatable`,
      });
      plotted.push({ account: row.account, debt, x, band: HEADROOM_BREACHED_BAND });
      bandCount[HEADROOM_BREACHED_BAND] = (bandCount[HEADROOM_BREACHED_BAND] ?? 0) + 1;
      bandDebt[HEADROOM_BREACHED_BAND] = (bandDebt[HEADROOM_BREACHED_BAND] ?? 0n) + debt;
      continue;
    }

    const band = row.headroom.band;
    const xIndex = Math.floor(x * 2);
    const key = `${String(band)}:${String(xIndex)}`;
    const bin = counts.get(key);
    if (bin === undefined) counts.set(key, { xIndex, band, count: 1, debt });
    else {
      bin.count += 1;
      bin.debt += debt;
    }
    plotted.push({ account: row.account, debt, x, band });
    bandCount[band] = (bandCount[band] ?? 0) + 1;
    bandDebt[band] = (bandDebt[band] ?? 0n) + debt;
  }

  aside.total = aside.noDebt + aside.unknown + aside.refused + aside.unplottable;

  const bins: RiskBin[] = Array.from(counts.values())
    .sort((a, b) => a.band - b.band || a.xIndex - b.xIndex)
    .map((bin) => ({
      xIndex: bin.xIndex,
      band: bin.band,
      count: bin.count,
      debt: bin.debt,
      step: opacityStep(bin.count),
      title: binTitle(
        bin.count,
        bin.xIndex,
        bin.band,
        renderEngineAmount(bin.debt.toString(), decimals),
      ),
    }));

  crit.sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));

  const bandTotals: RiskBandMarginal[] = HEADROOM_BANDS.map((_band, index) => {
    const count = bandCount[index] ?? 0;
    const debt = bandDebt[index] ?? 0n;
    const debtDisplay = renderEngineAmount(debt.toString(), decimals);
    return {
      band: index,
      label: headroomBandLabel(index),
      count,
      debt,
      debtDisplay,
      title: bandTitle(count, index, debtDisplay),
    };
  });

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
    bandTotals,
    aside,
    xMinExp: kLo / 2,
    xMaxExp: (kHi + 1) / 2,
    total: rows.length,
    decimals,
  };
}
