"use client";

// THE MEASURED CHART WIDTH (LAW-3, RM-11, LF-9).
//
// Chart geometry constants in this product's specs are RENDERED CSS PIXELS.
// SVG user units are NOT pixels once a viewBox scales, so a chart authored at
// 980 user units and rendered into a 620px container has every one of its
// "12px" labels arriving at 7.6px and every one of its "48px" lanes arriving
// at 30px. A spec that says 12px and a chart that renders 7.6px are not the
// same chart.
//
// So every chart under those rules renders 1:1: `width` equals the MEASURED
// container width in px, the viewBox is identical, and no scale factor exists
// anywhere. The measurement follows the `DataTable.tsx` precedent — a ref, an
// effect, a ResizeObserver, disconnected on unmount.
//
// Below the minimum the chart does NOT shrink; the frame scrolls. Shrinking
// would reintroduce the exact viewBox scaling this hook exists to remove.

import { useEffect, useRef, useState } from "react";

export interface MeasuredWidthOptions {
  /** Never render narrower than this. Below it, the frame scrolls. */
  min: number;
  /** Never render wider than this — a 4,000px chart is not a chart. */
  max: number;
  /** The width used before the first measurement lands (SSR + first paint). */
  fallback: number;
}

export interface MeasuredWidth<E extends HTMLElement> {
  /** Attach to the element whose CONTENT BOX is the chart's budget. */
  ref: React.RefObject<E | null>;
  /** The clamped, rendered width in CSS px. */
  width: number;
  /** True once a real measurement has replaced the fallback. */
  measured: boolean;
}

export function useMeasuredWidth<E extends HTMLElement>({
  min,
  max,
  fallback,
}: MeasuredWidthOptions): MeasuredWidth<E> {
  const ref = useRef<E | null>(null);
  const [width, setWidth] = useState(fallback);
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const measure = () => {
      // THE CONTENT BOX, ACTUALLY (W-VR defect 5). `clientWidth` excludes
      // borders and scrollbars but INCLUDES padding, so a frame with 12px
      // side padding handed the chart a width 24px larger than the space it
      // had — and the overflow landed exactly on the right margin, clipping
      // the marginal Σ-debt bars and growing a scrollbar. Padding is
      // subtracted here so the rendered SVG fits the frame it was measured
      // against, margins included.
      const style = getComputedStyle(node);
      const raw =
        node.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0);
      if (raw <= 0) return;
      setWidth(Math.round(Math.min(Math.max(raw, min), max)));
      setMeasured(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [min, max]);

  return { ref, width, measured };
}

/**
 * The MONO GLYPH PROBE (LF-8).
 *
 * Column width may never be estimated: a guessed character width is how a
 * ledger silently truncates the one number the reader came for. A hidden probe
 * of ten `0` glyphs is measured once, and `chPx` is its width divided by ten.
 *
 * The fallback is only ever in force before the first layout pass, and it is
 * deliberately GENEROUS (7.4px, wider than every mono in the stack at 12px) so
 * a pre-measurement render errs toward a column too wide rather than one that
 * clips.
 */
export const MONO_CH_FALLBACK = 7.4;

export function useMonoCharWidth<E extends HTMLElement>(): {
  ref: React.RefObject<E | null>;
  chPx: number;
} {
  const ref = useRef<E | null>(null);
  const [chPx, setChPx] = useState(MONO_CH_FALLBACK);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const measure = () => {
      const probe = node.getBoundingClientRect().width;
      if (probe > 0) setChPx(probe / 10);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref, chPx };
}
