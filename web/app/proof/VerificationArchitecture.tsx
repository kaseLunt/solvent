import { KpiTile, SectionHead } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { stepTileLabel, VERIFICATION_COPY, type PipelineStep, type ReceiptState } from "@/lib/verification-view";
import styles from "./verification.module.css";

const RECEIPT_TONE: Record<ReceiptState, "ok" | "warn" | "refused"> = {
  exact: "ok",
  empty: "refused",
  drift: "warn",
  failed: "warn",
  none: "refused",
};

export interface VerificationArchitectureProps {
  steps: readonly PipelineStep[];
  receipt: ReceiptState;
  /** Null when the record could not be fetched: the header has said so, and the strip is not drawn to say it again. */
  receiptLine: string | null;
}

/**
 * Architecture & verification: the Overview's four steps as tiles, each with
 * its one sentence, and the reconcile receipt beneath. A step is headed once:
 * its number rides its tile's label, and the sentence under the tile carries
 * no second heading. A step whose read is in flight is pending — the step
 * says so itself, tile, sub and sentence alike — and is never drawn refused
 * before its read has failed. The section is `#architecture` — where the
 * Overview's "Architecture & verification →" link lands. Every word is the
 * step's; this component prints.
 */
export function VerificationArchitecture({ steps, receipt, receiptLine }: VerificationArchitectureProps) {
  return (
    <section id="architecture" className={styles.architecture} data-testid="verification-architecture">
      <SectionHead title={VERIFICATION_COPY.architectureTitle} qualifier={VERIFICATION_COPY.architectureQualifier} />
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        {steps.map((step) => (
          <KpiTile
            key={step.key}
            testId={`verification-kpi-${step.key}`}
            label={stepTileLabel(step)}
            value={step.value}
            sub={step.sub}
            tone={step.tone}
            pending={step.pending}
          />
        ))}
      </div>
      <div className={styles.steps}>
        {steps.map((step) => (
          <p key={step.key} className={styles.step} data-testid={`verification-step-${step.key}`}>
            {step.sentence}
          </p>
        ))}
      </div>
      {receiptLine !== null && (
        <p className={styles.receipt} data-testid="verification-receipt" data-tone={RECEIPT_TONE[receipt]}>
          {receiptLine}
        </p>
      )}
    </section>
  );
}
