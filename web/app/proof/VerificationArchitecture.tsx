import { KpiTile, SectionHead } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { VERIFICATION_COPY, type PipelineStep, type ReceiptState } from "@/lib/verification-view";
import styles from "./verification.module.css";

const RECEIPT_TONE: Record<ReceiptState, "ok" | "warn" | "refused"> = {
  exact: "ok",
  drift: "warn",
  failed: "warn",
  none: "refused",
};

export interface VerificationArchitectureProps {
  steps: readonly PipelineStep[];
  receipt: ReceiptState;
  receiptLine: string;
  /** A step whose reader has not answered yet renders pending, not refused. */
  pending?: Partial<Record<PipelineStep["key"], boolean>>;
}

/**
 * Architecture & verification (plan R4): the Overview's four steps as tiles,
 * each with its one sentence, and the reconcile receipt beneath. The section
 * is `#architecture` — where the Overview's "Architecture & verification →"
 * link lands. Every word is the step's; this component prints.
 */
export function VerificationArchitecture({ steps, receipt, receiptLine, pending }: VerificationArchitectureProps) {
  return (
    <section id="architecture" className={styles.architecture} data-testid="verification-architecture">
      <SectionHead title={VERIFICATION_COPY.architectureTitle} qualifier={VERIFICATION_COPY.architectureQualifier} />
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        {steps.map((step) => {
          const isPending = pending?.[step.key] === true;
          return (
            <KpiTile
              key={step.key}
              testId={`verification-kpi-${step.key}`}
              label={step.label}
              value={step.value}
              sub={step.sub}
              tone={isPending ? "neutral" : step.tone}
              pending={isPending}
            />
          );
        })}
      </div>
      <div className={styles.steps}>
        {steps.map((step) => (
          <p key={step.key} className={styles.step} data-testid={`verification-step-${step.key}`}>
            <span className={styles.stepNum}>{step.ordinal}</span>
            {step.sentence}
          </p>
        ))}
      </div>
      <p className={styles.receipt} data-testid="verification-receipt" data-tone={RECEIPT_TONE[receipt]}>
        {receiptLine}
      </p>
    </section>
  );
}
