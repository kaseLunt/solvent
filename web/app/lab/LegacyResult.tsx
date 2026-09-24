import { LegacyFold } from "@/components/kit";
import { LEGACY } from "@/lib/inspector-position";
import { LEGACY_RESULT_FOOTNOTE, LEGACY_RESULT_SUMMARY, tileAbsence, type BookWorkspace, type EngineReading } from "@/lib/lab-view";
import { LEGACY_FOLD_TITLE } from "@/lib/prose";
import styles from "./lab.module.css";
import { LabTiles } from "./LabTiles";
import { TransitionCard } from "./TransitionCard";

/** The legacy market's result: the same four tiles and its own lanes, in its own decimals, in its own fold after all Cash content — Cash and the legacy market are never summed or set on one axis. */
export function LegacyResult({ reading, book }: { reading: EngineReading; book: Pick<BookWorkspace, "state" | "headline"> }) {
  return (
    <LegacyFold title={LEGACY_FOLD_TITLE} summary={LEGACY_RESULT_SUMMARY} testId="lab-legacy">
      <LabTiles reading={reading} absence={tileAbsence(book, reading)} testPrefix="lab-legacy-kpi" />
      <TransitionCard reading={reading} engine={LEGACY} testId="lab-legacy-transitions" gridTestId="lab-legacy-heatmap" />
      <p className={styles.dim}>{LEGACY_RESULT_FOOTNOTE}</p>
    </LegacyFold>
  );
}
