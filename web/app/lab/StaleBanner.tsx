import kit from "@/components/kit/kit.module.css";
import type { LabHeadline } from "@/lib/lab-headline";
import type { Banner, HeldCondition, Retained } from "@/lib/lab-view";
import { groupInt, joinAnd } from "@/lib/prose";
import styles from "./lab.module.css";

const supersededWords = (batch: string) => `Batch ${batch} has been superseded: a newer complete batch exists.`;
const staleWords = (skew: readonly string[]) => `Results for a previous input: the listing's ${joinAnd(skew)} changed since this run.`;
const failureWords = (failure: LabHeadline | null) =>
  failure === null ? "the service gave no reason." : `${failure.emphasis}${failure.rest === "" ? "" : ` ${failure.rest}`} ${failure.dek}`;

/**
 * A result for a previous input, a superseded batch, or a re-run that failed keeps its figures; the banner says
 * which — and, when a failure left a held result standing, the held result's own condition beside it. A retained
 * body the page does not show (its definition changed) is disclosed here, never mistaken for the answer.
 * (Plan R13; a result is never silently replaced.)
 */
export function StaleBanner({
  kind,
  skew,
  batchId,
  failure,
  heldCondition,
  retained,
  onRerun,
  rerunDisabled,
}: {
  kind: Exclude<Banner, null>;
  skew: readonly string[];
  batchId: number | null;
  failure: LabHeadline | null;
  heldCondition: HeldCondition;
  retained: Retained | null;
  onRerun: () => void;
  rerunDisabled: boolean;
}) {
  const batch = batchId === null ? "?" : groupInt(batchId);
  const text =
    kind === "superseded"
      ? `${supersededWords(batch)} This result stands for the batch it names.`
      : kind === "stale-input"
        ? `${staleWords(skew)} This result stands for the definition it was computed under.`
        : kind === "rerun-failed"
          ? `Run again failed — ${failureWords(failure)} The result below stands for batch ${batch}.${heldCondition === "superseded" ? ` ${supersededWords(batch)}` : heldCondition === "stale-input" ? ` ${staleWords(skew)}` : ""}`
          : retained === null
            ? "A result is retained but not shown: its definition changed since it was computed. The failure above is this request's own."
            : `A result for batch ${groupInt(retained.batchId)} is retained but not shown: the definition's ${joinAnd(retained.skew)} changed since it was computed. The failure above is this request's own.`;
  return (
    <div className={styles.banner} data-testid="lab-banner" data-kind={kind} data-held={heldCondition ?? undefined} role="status">
      <span>{text}</span>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRerun} disabled={rerunDisabled} data-testid="lab-banner-rerun">
        Run again
      </button>
    </div>
  );
}
