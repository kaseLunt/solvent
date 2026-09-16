import { LEGACY } from "@/lib/inspector-position";
import type { EngineReading } from "@/lib/lab-view";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { TransitionCard } from "./TransitionCard";

/** The legacy market's result: the same four tiles and its own lanes, in its own decimals, never beside a Cash sum (plan R10). */
export function LegacyResult({ reading }: { reading: EngineReading }) {
  return (
    <details className={styles.legacy} data-testid="lab-legacy">
      <summary>Legacy · Aave v3 market result</summary>
      <div className={styles.legacyBody}>
        <LabTiles
          reading={reading}
          pending={false}
          testPrefix="lab-legacy-kpi"
        />
        <TransitionCard
          reading={reading}
          engine={LEGACY}
          testId="lab-legacy-transitions"
          gridTestId="lab-legacy-heatmap"
        />
        <p className={styles.dim}>
          Judged by its own health factor, in its own unit. The two books are
          never added together.
        </p>
      </div>
    </details>
  );
}
