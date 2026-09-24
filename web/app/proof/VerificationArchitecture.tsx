import { SectionHead, StepStrip, type Step } from "@/components/kit";
import { VERIFICATION_COPY, type PipelineStep } from "@/lib/verification-view";
import styles from "./verification.module.css";

export interface VerificationArchitectureProps {
  steps: readonly PipelineStep[];
}

/**
 * Architecture & verification: the pipeline's four steps as the kit's step strip — the same strip, names and
 * ordinals the Overview draws (lib/prose PIPELINE_STEPS) — each step's sentence at this page's altitude beneath its
 * name, and its figure, or with none the state it is in (pending in flight, unavailable after a failed read, refused
 * where the wire stated the absence) — never a dash. The receipt's verdict is the Verify step's figure here; no strip
 * beneath repeats it. The section is `#architecture` — where the Overview's "Architecture & verification →" link
 * lands. Every word is the step's; this component prints.
 */
export function VerificationArchitecture({ steps }: VerificationArchitectureProps) {
  const strip: Step[] = steps.map((step) => {
    const base = { key: step.key, ordinal: step.ordinal, name: step.label, description: step.sentence };
    if (step.state !== undefined) return { ...base, tone: "neutral", state: step.state, stateWord: step.stateWord };
    return {
      ...base,
      tone: step.tone,
      figure: (
        <>
          {step.line.before}
          <b>{step.line.figure}</b>
          {step.line.after}
        </>
      ),
    };
  });
  return (
    <section id="architecture" className={styles.architecture} data-testid="verification-architecture">
      <SectionHead title={VERIFICATION_COPY.architectureTitle} />
      <StepStrip steps={strip} label={VERIFICATION_COPY.architectureLabel} testId="verification-step" />
    </section>
  );
}
