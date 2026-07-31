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
//
// `refused_count` / `infinite_count` render BESIDE the buckets — rows the
// histogram could not place are counted, never dropped.

import { parseDecimal, type EngineHistogram, type Histogram } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import styles from "./book.module.css";

const BAR_MAX = 240;
const ROW_H = 18;
const LABEL_W = 84;
const COUNT_W = 40;

function EnginePanel({ histogram, wadScale }: { histogram: EngineHistogram; wadScale: bigint }) {
  if (histogram.refused) {
    return (
      <div className={styles.panel} data-testid={`book-histogram-${histogram.engine}`}>
        <div className={styles.panelHead}>
          <EngineChip engine={histogram.engine} />
          <span className={styles.comparator}>comparator: {histogram.comparator}</span>
        </div>
        <div className={styles.emptyReason}>
          {histogram.refusal !== null && <RefusedTag reason={histogram.refusal.code} />}{" "}
          buckets are empty because the ENGINE is withheld — not because no position sits here.
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...histogram.buckets.map((bucket) => bucket.count), 1);
  const width = LABEL_W + BAR_MAX + COUNT_W + 12;
  const height = histogram.buckets.length * ROW_H + 6;
  const eligibleTint = histogram.comparator === "hf_wad";

  return (
    <div className={styles.panel} data-testid={`book-histogram-${histogram.engine}`}>
      <div className={styles.panelHead}>
        <EngineChip engine={histogram.engine} />
        <span className={styles.comparator}>comparator: {histogram.comparator}</span>
      </div>
      <div className={styles.panelBody}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          role="img"
          aria-label={`health-factor histogram for ${histogram.engine} on comparator ${histogram.comparator}`}
          style={{ display: "block", maxWidth: "100%", height: "auto" }}
        >
          <line
            className={styles.histBaseline}
            x1={LABEL_W + 4}
            x2={LABEL_W + 4}
            y1={2}
            y2={height - 2}
          />
          {histogram.buckets.map((bucket, index) => {
            const y = index * ROW_H + 4;
            const barWidth =
              bucket.count === 0 ? 0 : Math.max((bucket.count / maxCount) * BAR_MAX, 1.5);
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
                      eligible territory — the engine liquidates strictly below 1.00 on the wad
                    </title>
                  </rect>
                )}
                <text className={styles.histLabel} x={LABEL_W} y={y + 10} textAnchor="end">
                  {bucket.label}
                </text>
                {barWidth > 0 && (
                  <rect
                    className={belowOne ? styles.histBarEligible : styles.histBar}
                    x={LABEL_W + 6}
                    y={y + 2}
                    width={barWidth}
                    height={ROW_H - 8}
                  />
                )}
                <text className={styles.histCount} x={LABEL_W + 12 + barWidth} y={y + 10}>
                  {String(bucket.count)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className={styles.histAside}>
          <span className={styles.badge}>refused {String(histogram.refused_count)} — rows withheld, counted here</span>
          <span>∞ no-debt {String(histogram.infinite_count)}</span>
        </div>
        <p className={styles.panelNote}>{histogram.note}</p>
      </div>
    </div>
  );
}

export function BookHistogram({ histogram }: { histogram: Histogram }) {
  const wadScale = parseDecimal(histogram.wad_scale);
  return (
    <section className={styles.section} aria-label="health-factor histogram per engine">
      <div className={styles.sectionHead}>
        <h2>HF histogram — each engine on its own comparator</h2>
        <span className={styles.sectionNote}>engines are never merged into one distribution</span>
      </div>
      <div className={styles.panelGrid}>
        {histogram.engines.map((engine) => (
          <EnginePanel key={engine.engine} histogram={engine} wadScale={wadScale} />
        ))}
      </div>
    </section>
  );
}
