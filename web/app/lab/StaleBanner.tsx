import kit from "@/components/kit/kit.module.css";
import type { LabHeadline } from "@/lib/lab-headline";
import type { Banner } from "@/lib/lab-view";
import { groupInt, joinAnd } from "@/lib/prose";
import styles from "./lab.module.css";

/**
 * A result for a previous input, a superseded batch, or a re-run that failed keeps its figures;
 * the banner says which and offers the re-run (plan R13; a result is never silently replaced).
 */
export function StaleBanner({
  kind,
  skew,
  batchId,
  failure,
  onRerun,
  rerunDisabled,
}: {
  kind: Exclude<Banner, null>;
  skew: readonly string[];
  batchId: number | null;
  failure: LabHeadline | null;
  onRerun: () => void;
  rerunDisabled: boolean;
}) {
  const batch = batchId === null ? "?" : groupInt(batchId);
  const text =
    kind === "superseded"
      ? `Batch ${batch} has been superseded: a newer complete batch exists. This result stands for the batch it names.`
      : kind === "rerun-failed"
        ? `Run again failed — ${failure === null ? "the service gave no reason" : `${failure.emphasis}${failure.rest === "" ? "" : ` ${failure.rest}`} ${failure.dek}`} The result below stands for batch ${batch}.`
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
