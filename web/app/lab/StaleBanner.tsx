import kit from "@/components/kit/kit.module.css";
import { staleBannerLine, type LabHeadline } from "@/lib/lab-headline";
import { RUN_AGAIN, type Banner, type HeldCondition, type Retained } from "@/lib/lab-view";

/** The banner over a result that keeps its figures, or beside a retained body that is not shown: the sentence is the lib's (`staleBannerLine`); this file places it beside the re-run button, on the kit's warn strip. */
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
    <div className={`${kit.strip} ${kit.stripWarn}`} data-testid="lab-banner" data-kind={kind} data-held={heldCondition ?? undefined} role="status">
      <span>{text}</span>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRerun} disabled={rerunDisabled} data-testid="lab-banner-rerun">
        {RUN_AGAIN}
      </button>
    </div>
  );
}
