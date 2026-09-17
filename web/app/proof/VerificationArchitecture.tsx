import { KpiTile, SectionHead } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { PipelineStep, ReceiptState } from "@/lib/verification-view";
import styles from "./verification.module.css";

const RECEIPT_TONE: Record<ReceiptState, "ok" | "warn" | "refused"> = {
  exact: "ok",
  drift: "warn",
  failed: "warn",
  none: "refused",
};

const STEP_NUMBERS = ["01", "02", "03", "04"] as const;

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
 * link lands.
 */
export function VerificationArchitecture({ steps, receipt, receiptLine, pending }: VerificationArchitectureProps) {
  return (
    <section id="architecture" className={styles.architecture} data-testid="verification-architecture">
      <SectionHead title="Architecture & verification" qualifier="Index · Compute · Verify · Serve" />
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
        {steps.map((step, index) => (
          <p key={step.key} className={styles.step} data-testid={`verification-step-${step.key}`}>
            <span className={styles.stepNum}>
              {STEP_NUMBERS[index] ?? String(index + 1)} · {step.label.toUpperCase()}
            </span>
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
