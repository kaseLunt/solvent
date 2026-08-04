// HF histogram, one panel PER ENGINE, each on its OWN comparator (spec §3.1).
// Custom SVG on the scaffold's chart aesthetic — horizontal count bars per
// bucket, mono labels, hairline baseline.
//
// Comparator honesty:
//   - `hf_wad` (Aave): the buckets are the pool's own comparator, and the
//     engine liquidates STRICTLY BELOW 1.00 — sub-1.00 buckets tint crit
//     because the ENGINE says that set is eligible (per the wire's own note).
//   - `hf_num/hf_den` (Debt Manager): the buckets are a DISCLOSURE
//     (maxBorrowLT/borrowings); eligibility comes from the strict boolean, so
//     no bucket is crit-tinted here and the wire note stays visible.
//   The tint ASYMMETRY is the design (SUPPLEMENT §17) — do not "fix" it.
//
// Each panel opens with a COMPUTED reading line (SUPPLEMENT §17): counts and
// Σ eligible debt derived from the SAME /v1/book response — never asserted,
// never hardcoded. The wire `note` stays VISIBLE in the dim panelNote
// register below (no collapse, no tooltip-only doctrine).
//
// `refused_count` / `infinite_count` render BESIDE the buckets — rows the
// histogram could not place are counted, never dropped.

import {
  parseDecimal,
  type Aggregate,
  type BadDebt,
  type EngineHistogram,
  type Histogram,
} from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import {
  RISK_BAND_HEADING,
  RISK_BAND_METHOD,
  riskBandDenominatorLine,
  riskBandNoDebtRow,
  riskBandPanelAria,
  riskBandRefusedRow,
} from "@/lib/book-copy";
import { sharePercent, shareBarWidth } from "@/lib/book-format";
import { histogramReadingLine } from "./readingLines";
import styles from "./book.module.css";

const BAR_MAX = 240;
const ROW_H = 18;
const LABEL_W = 84;
const COUNT_W = 64;
/** CX-6: the common percent axis and the gutter its labels need. */
const PERCENT_TICKS = [0, 50, 100] as const;
const AXIS_H = 20;
/**
 * Below one rendered pixel a bar states no share, so a nonempty bucket takes a
 * presence dot instead of a floored bar. The floor is on the MARKER, never on
 * the quantity (LAW-3 is about rendered pixels; so is this).
 */
const PRESENCE_MIN = 1;
const PRESENCE_R = 1.5;

function EnginePanel({
  histogram,
  wadScale,
  aggregate,
  badDebt,
}: {
  histogram: EngineHistogram;
  wadScale: bigint;
  aggregate: Aggregate | undefined;
  badDebt: BadDebt | undefined;
}) {
  if (histogram.refused) {
    return (
      <div className={styles.panel} data-testid={`book-histogram-${histogram.engine}`}>
        <div className={styles.panelHead}>
          <EngineChip engine={histogram.engine} />
          <span className={styles.comparator}>comparator: {histogram.comparator}</span>
        </div>
        <div className={styles.emptyReason}>
          {histogram.refusal !== null && <RefusedTag reason={histogram.refusal.code} />}{" "}
          buckets are empty because the ENGINE is withheld, and that says nothing about how many
          positions sit here.
        </div>
      </div>
    );
  }

  // CX-6 THE DENOMINATOR: debt-bearing accounts with a finite comparator —
  // exactly the population the buckets partition. `infinite_count` (no debt,
  // so no comparator) and `refused_count` (an unknowable) are NOT folded in:
  // they render as their own accounting rows beneath the bars.
  const denominator = histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const width = LABEL_W + BAR_MAX + COUNT_W + 24;
  const height = histogram.buckets.length * ROW_H + AXIS_H;
  const eligibleTint = histogram.comparator === "hf_wad";

  return (
    <div className={styles.panel} data-testid={`book-histogram-${histogram.engine}`}>
      <div className={styles.panelHead}>
        <EngineChip engine={histogram.engine} />
        <span className={styles.comparator}>comparator: {histogram.comparator}</span>
      </div>
      <div className={styles.panelBody}>
        {/* The computed reading line (SUPPLEMENT §17) — primary register,
            top of the panel body, derived from the same wire response. */}
        <p className={styles.readingLine} data-testid={`hist-reading-${histogram.engine}`}>
          {histogramReadingLine(histogram, aggregate, badDebt, wadScale)}
        </p>
        <p className={styles.denominatorLine} data-testid={`hist-denominator-${histogram.engine}`}>
          {riskBandDenominatorLine(denominator)}
        </p>
        {/* LAW-3 / CX-7: RENDERED pixels. `maxWidth: 100%` let a narrow panel
            scale the whole picture, and a viewBox scale of 0.6 turns a 12px
            label into a 7px one that `getComputedStyle` still reports as 12px.
            The chart keeps its authored width and the frame scrolls, which is
            the spec's own answer: minimum width, horizontal scroll below it. */}
        <div className={styles.chartScroll} data-testid={`hist-frame-${histogram.engine}`}>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-label={riskBandPanelAria(histogram.engine, histogram.comparator)}
            style={{ display: "block" }}
            data-testid={`hist-svg-${histogram.engine}`}
          >
          <line
            className={styles.histBaseline}
            x1={LABEL_W + 4}
            x2={LABEL_W + 4}
            y1={2}
            y2={height - AXIS_H + 2}
          />
          {/* CX-6: a COMMON 0 to 100 percent axis with ticks at 0, 50, 100.
              The old axis was `count / largestBucket`, so the tallest bucket
              was always full width and the axis meant nothing. */}
          {PERCENT_TICKS.map((tick) => (
            <g key={`tick-${String(tick)}`} data-testid="hist-percent-tick">
              <line
                className={styles.histBaseline}
                x1={LABEL_W + 6 + (tick / 100) * BAR_MAX}
                x2={LABEL_W + 6 + (tick / 100) * BAR_MAX}
                y1={2}
                y2={height - AXIS_H + 2}
                opacity={tick === 0 ? 1 : 0.35}
              />
              <text
                className={styles.histAxisLabel}
                x={LABEL_W + 6 + (tick / 100) * BAR_MAX}
                y={height - 6}
                textAnchor="middle"
              >
                {String(tick)}%
              </text>
            </g>
          ))}
          {histogram.buckets.map((bucket, index) => {
            const y = index * ROW_H + 4;
            // CX-6 geometry: the rendered width IS the share. No floor rides
            // it, because a floor makes a 0.0x% bucket look like a 0.6% one.
            // A count too small to reach a pixel keeps a PRESENCE MARK, which
            // is a dot rather than a bar so no length can be read off it.
            const barWidth = shareBarWidth(bucket.count, denominator, BAR_MAX);
            const subPixel = bucket.count > 0 && barWidth < PRESENCE_MIN;
            const percent = sharePercent(bucket.count, denominator);
            // Crit tint only where the comparator itself defines eligibility:
            // the whole bucket sits strictly below 1.00 on the wad.
            const belowOne =
              eligibleTint && bucket.upper_wad !== null && parseDecimal(bucket.upper_wad) <= wadScale;
            return (
              <g key={bucket.label}>
                {/* Eligible-territory FORM cue (design SHOULD-FIX 10): sub-1.00
                    buckets on the wad comparator lead with an 8px filled
                    crit square (the .sev.crit form) — severity is color AND
                    form, never hue alone. Bucket-level, so it marks the
                    eligible region of the axis even when the bucket is empty. */}
                {belowOne && (
                  <rect
                    className={styles.histEligibleMark}
                    data-testid="hist-eligible-mark"
                    x={0}
                    y={y + 2}
                    width={8}
                    height={8}
                    rx={1}
                  >
                    <title>
                      eligible territory: the engine liquidates strictly below 1.00 on the wad
                    </title>
                  </rect>
                )}
                <text className={styles.histLabel} x={LABEL_W} y={y + 10} textAnchor="end">
                  {bucket.label}
                </text>
                {barWidth > 0 && (
                  <rect
                    className={belowOne ? styles.histBarEligible : styles.histBar}
                    data-testid="hist-bar"
                    data-bucket={bucket.label}
                    x={LABEL_W + 6}
                    y={y + 2}
                    width={barWidth}
                    height={ROW_H - 8}
                  />
                )}
                {subPixel && (
                  <circle
                    className={belowOne ? styles.histPresenceEligible : styles.histPresence}
                    data-testid="hist-presence"
                    data-bucket={bucket.label}
                    cx={LABEL_W + 6 + PRESENCE_R}
                    cy={y + 2 + (ROW_H - 8) / 2}
                    r={PRESENCE_R}
                  >
                    <title>
                      {`${String(bucket.count)} accounts, a share too small to draw at one ` +
                        `pixel on this axis. This dot marks presence and carries no length.`}
                    </title>
                  </circle>
                )}
                {/* CX-6 / CX-8: `{count} · {pct}%`, the percent from exact
                    integer arithmetic. A zero denominator yields NO percentage
                    — a share of nothing is not a small share. */}
                <text
                  className={styles.histCount}
                  x={LABEL_W + 12 + BAR_MAX}
                  y={y + 10}
                  data-testid="hist-row-label"
                >
                  {String(bucket.count)}
                  {percent === null ? "" : ` · ${percent}%`}
                </text>
              </g>
            );
          })}
          </svg>
        </div>
        {/* CX-6 THE ACCOUNTING ROWS: never folded into the denominator. */}
        <div className={styles.histAside}>
          <span data-testid={`hist-no-debt-${histogram.engine}`}>
            {riskBandNoDebtRow(histogram.infinite_count)}
          </span>
          <span className={styles.badge} data-testid={`hist-refused-${histogram.engine}`}>
            {riskBandRefusedRow(histogram.refused_count)} · rows withheld and counted here
          </span>
        </div>
        <p className={styles.methodLine} data-testid={`hist-method-${histogram.engine}`}>
          {RISK_BAND_METHOD}
        </p>
        <p className={styles.panelNote}>{histogram.note}</p>
      </div>
    </div>
  );
}

export function BookHistogram({
  histogram,
  aggregates,
  badDebt,
}: {
  histogram: Histogram;
  aggregates: readonly Aggregate[];
  badDebt: readonly BadDebt[];
}) {
  const wadScale = parseDecimal(histogram.wad_scale);
  return (
    <section className={styles.section} aria-label="risk-band distribution per engine">
      <div className={styles.sectionHead}>
        <h2>{RISK_BAND_HEADING}</h2>
        <span className={styles.sectionNote}>engines are never merged into one distribution</span>
      </div>
      <div className={styles.panelGrid}>
        {histogram.engines.map((engine) => (
          <EnginePanel
            key={engine.engine}
            histogram={engine}
            wadScale={wadScale}
            aggregate={aggregates.find((candidate) => candidate.engine === engine.engine)}
            badDebt={badDebt.find((candidate) => candidate.engine === engine.engine)}
          />
        ))}
      </div>
    </section>
  );
}
