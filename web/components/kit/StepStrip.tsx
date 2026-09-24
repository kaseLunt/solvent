import type { ReactNode } from "react";
import { STATE_REGISTERS, stateWordOf, type StateRegister } from "@/lib/kit";
import styles from "./kit.module.css";

/** A row of the one tone grammar (lib/kit.ts TONE_VOCABULARIES.stepStrip): the tone colours the step's bold figure only. */
export type StepTone = "neutral" | "ok" | "warn" | "crit" | "refused";

interface StepBase {
  key: string;
  /** "01" — the lib's ordinal (lib/prose.ts PIPELINE_STEPS), never typed here. */
  ordinal: string;
  /** "Index" — the lib's step name. */
  name: string;
  description: ReactNode;
  tone?: StepTone;
  title?: string;
}

/**
 * A step shows its figure (the lib's `{before}<b>{figure}</b>{after}`), or — when it has none — the word of the state
 * it is in (lib/kit STATE_REGISTERS, or the lib's own word): never a dash.
 */
export type Step = StepBase & ({ figure: ReactNode; state?: undefined; stateWord?: undefined } | { figure?: undefined; state: StateRegister; stateWord?: string });

export interface StepStripProps {
  steps: readonly Step[];
  /** The strip's name for assistive tech: the pipeline it lays out. */
  label?: string;
  testId?: string;
}

/** The pipeline's steps as one joined strip (the front door's four steps; Verification's architecture). */
export function StepStrip({ steps, label, testId }: StepStripProps) {
  return (
    <ol className={styles.steps} aria-label={label} data-testid={testId}>
      {steps.map((step) => (
        <li
          key={step.key}
          className={styles.step}
          data-tone={step.tone ?? "neutral"}
          data-state={step.state}
          aria-busy={step.state !== undefined && STATE_REGISTERS[step.state].busy ? "true" : undefined}
          title={step.title}
          data-testid={testId === undefined ? undefined : `${testId}-${step.key}`}
        >
          <div className={styles.stepNum}>{step.ordinal}</div>
          <div className={styles.stepN}>{step.name}</div>
          <div className={styles.stepD}>{step.description}</div>
          <div className={styles.stepV}>
            {step.state === undefined ? step.figure : <span className={styles.stepState}>{stateWordOf(step.state, step.stateWord)}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
