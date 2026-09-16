// web/lib/lab-geometry.ts
// Geometry for the Scenarios charts. These numbers become an opacity and an x
// coordinate; they are never printed, so floats are allowed here and nowhere else.

/** The cell's share of the largest cell, clamped to [0, 1]; 0 for an empty or unreadable pair. */
export function heatIntensity(count: number, max: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(max) || max <= 0 || count <= 0) return 0;
  return Math.min(1, count / max);
}

export interface DotPlotScale {
  /** The domain's half-width in signed tenths of a percent (at least 1.0 %, so a zero sits inside a domain). */
  readonly maxAbsTenths: bigint;
  readonly left: number;
  readonly right: number;
  readonly zeroX: number;
  readonly x: (tenths: bigint) => number;
}

/** A symmetric percent axis: zero in the middle, the largest |value| on either pad. */
export function dotPlotScale(values: readonly (bigint | null)[], width: number, pad = 12): DotPlotScale {
  let maxAbs = 0n;
  for (const v of values) {
    if (v === null) continue;
    const a = v < 0n ? -v : v;
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs === 0n) maxAbs = 10n;
  const left = pad;
  const right = Math.max(pad + 1, width - pad);
  const half = (right - left) / 2;
  const zeroX = left + half;
  const domain = Number(maxAbs);
  return { maxAbsTenths: maxAbs, left, right, zeroX, x: (t) => zeroX + (Number(t) / domain) * half };
}
