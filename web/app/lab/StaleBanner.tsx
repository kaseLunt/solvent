import kit from "@/components/kit/kit.module.css";
import { staleBannerLine, type LabHeadline } from "@/lib/lab-headline";
import type { Banner, HeldCondition, Retained } from "@/lib/lab-view";
import styles from "./lab.module.css";

/** The banner over a result that keeps its figures, or beside a retained body that is not shown: the sentence is the lib's (`staleBannerLine`); this file places it beside the re-run button. */
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
  const text = staleBannerLine({ kind, skew, batchId, failure, heldCondition, retained });
  return (
    <div className={styles.banner} data-testid="lab-banner" data-kind={kind} data-held={heldCondition ?? undefined} role="status">
      <span>{text}</span>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRerun} disabled={rerunDisabled} data-testid="lab-banner-rerun">
        Run again
      </button>
    </div>
  );
}
