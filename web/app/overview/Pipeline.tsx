import type { components } from "@solvent/client";
import { StepStrip, type Step } from "@/components/kit";
import { overviewPipeline, PIPELINE_LABEL } from "@/lib/overview-copy";
import { pipelineSteps, type BookReading, type PipelineInFlight } from "@/lib/verification-view";

type Schemas = components["schemas"];

export interface PipelineProps {
  meta: Schemas["MetaResponse"] | null;
  evidence: Schemas["EvidenceResponse"] | null;
  /** The book reader's whole answer, so a 503 no-batch is told apart from a reader that has not answered. */
  reading: BookReading;
  /** Which of the two reads have not answered yet: a read in flight is pending, never "unavailable". */
  inFlight: PipelineInFlight;
}

/**
 * How it works — the kit's step strip: four steps, each carrying a live number or the state it is in. The numbers and
 * their registers are the shared pipeline law's (lib/verification-view); the names, ordinals and sentences are the
 * front door's (lib/overview-copy), so a read in flight is pending, a failed one unavailable, and a withheld census
 * keeps its refused register.
 */
export function Pipeline({ meta, evidence, reading, inFlight }: PipelineProps) {
  const steps: Step[] = overviewPipeline(pipelineSteps(meta, evidence, reading, inFlight)).map((step) => {
    const base = { key: step.key, ordinal: step.ordinal, name: step.name, description: step.description, tone: step.tone };
    if (step.line === null) return { ...base, state: step.state, stateWord: step.stateWord };
    return {
      ...base,
      figure: (
        <>
          {step.line.before}
          <b>{step.line.figure}</b>
          {step.line.after}
        </>
      ),
    };
  });
  return <StepStrip steps={steps} label={PIPELINE_LABEL} testId="pipeline" />;
}
