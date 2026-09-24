/**
 * The halo a chart's direct label wears: its own glyphs stroked in the panel's ground and painted under the fill, so
 * a residual overlap can never strike a figure, in either theme. Inline, because the shared label atoms serve other
 * charts. A label is not a target: the points beneath it keep their hover and their click.
 */
export const LABEL_HALO = {
  paintOrder: "stroke",
  stroke: "var(--panel)",
  strokeWidth: 3,
  strokeLinejoin: "round",
  pointerEvents: "none",
} as const;
