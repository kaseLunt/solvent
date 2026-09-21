import { humanUsd } from "@/lib/human-usd";
import { readWirePopulation } from "@/lib/wireGuard";
import styles from "./kit.module.css";

export interface Band {
  id: string;
  label: string;
  /** Null when the band's count is not known: no count is printed and none weighs a bar — never a zero. */
  count: number | null;
  /** Money in base units at `decimals`; null when the band's value is not known (counts-only histograms). */
  value: bigint | null;
  tone?: "neutral" | "crit" | "warn" | "dim";
}

export interface BandBarsProps {
  bands: Band[];
  decimals: number;
  weightedBy: "value" | "count";
  testId?: string;
}

const BAR_CLASS = { neutral: "", crit: styles.barCrit, warn: styles.barWarn, dim: styles.barDim } as const;
const MAX_PX = 128;
/** A nonzero band is never invisible: the risk bands are the small ones. */
const MIN_PX = 4;

/**
 * A band's count is a wire population: classified before it reaches arithmetic or print, so -0 and 1.5 refuse by name
 * rather than weigh a bar. An unknown count is not a population and never reaches the guard.
 */
function countOf(band: Band): number | null {
  return band.count === null ? null : readWirePopulation(band.count, `bands[${band.id}].count`);
}

function weight(band: Band, weightedBy: "value" | "count"): bigint {
  return weightedBy === "count" ? BigInt(countOf(band) ?? 0) : (band.value ?? 0n);
}

export function BandBars({ bands, decimals, weightedBy, testId }: BandBarsProps) {
  const max = bands.reduce((m, b) => (weight(b, weightedBy) > m ? weight(b, weightedBy) : m), 0n);
  return (
    <div
      className={styles.bars}
      style={{ gridTemplateColumns: `repeat(${String(bands.length)}, 1fr)` }}
      data-testid={testId}
      role="img"
      aria-label="distribution by band"
    >
      {bands.map((band) => {
        const count = countOf(band);
        const w = weight(band, weightedBy);
        const px = max === 0n || w === 0n ? 0 : Math.max(MIN_PX, Number((w * BigInt(MAX_PX)) / max));
        const printed =
          weightedBy === "count"
            ? (count?.toLocaleString("en-US") ?? "—")
            : band.value === null
              ? "—"
              : humanUsd(band.value, decimals);
        return (
          <div
            key={band.id}
            className={`${styles.bar} ${BAR_CLASS[band.tone ?? "neutral"]}`}
            data-band={band.id}
            data-count={count ?? undefined}
          >
            <span className={styles.barCnt}>
              {printed}
              {weightedBy === "value" && count !== null && <small> · {count.toLocaleString("en-US")}</small>}
            </span>
            <i style={{ height: `${String(px)}px` }} aria-hidden="true" />
            <span className={styles.barLab}>{band.label}</span>
          </div>
        );
      })}
    </div>
  );
}
