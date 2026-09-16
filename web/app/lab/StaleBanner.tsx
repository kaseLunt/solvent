import kit from "@/components/kit/kit.module.css";
import { groupInt, joinAnd } from "@/lib/prose";
import styles from "./lab.module.css";

/** A result for a previous input or a superseded batch keeps its figures; the banner says so and offers the re-run (plan R13). */
export function StaleBanner({ kind, skew, batchId, onRerun, rerunDisabled }: { kind: "stale-input" | "superseded"; skew: readonly string[]; batchId: number | null; onRerun: () => void; rerunDisabled: boolean }) {
  const text =
    kind === "superseded"
      ? `Batch ${batchId === null ? "?" : groupInt(batchId)} has been superseded: a newer complete batch exists. This result stands for the batch it names.`
      : `Results for a previous input: the listing's ${joinAnd(skew)} changed since this run. This result stands for the definition it was computed under.`;
  return (
    <div className={styles.banner} data-testid="lab-banner" data-kind={kind} role="status">
      <span>{text}</span>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRerun} disabled={rerunDisabled} data-testid="lab-banner-rerun">
        Run again
      </button>
    </div>
  );
}
