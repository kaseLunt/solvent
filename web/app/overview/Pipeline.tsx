import type { components } from "@solvent/client";
import { pipelineSteps, type BookReading, type PipelineInFlight, type PipelineStep } from "@/lib/verification-view";
import styles from "./overview.module.css";

type Schemas = components["schemas"];

export interface PipelineProps {
  meta: Schemas["MetaResponse"] | null;
  evidence: Schemas["EvidenceResponse"] | null;
  /** The book reader's whole answer, so a 503 no-batch is told apart from a reader that has not answered. */
  reading: BookReading;
  /** Which of the two reads have not answered yet: a read in flight is pending, never "unavailable". */
  inFlight: PipelineInFlight;
}

/** The front door's own words for each step; the ordinal, the number and its line are the shared law's (lib/verification-view). */
const STEP_COPY: Record<PipelineStep["key"], { name: string; description: string }> = {
  index: {
    name: "Reorg-safe indexer",
    description:
      "Raw logs from OP Mainnet and Ethereum into Postgres. Verified-ancestor rewind handles forks of any depth; every derived table rebuilds from raw logs.",
  },
  compute: {
    name: "Risk engine",
    description:
      "Each batch recomputes every account with its engine's own rule — Cash's borrow cap, Aave's health factor — using RedStone prices with a freshness budget.",
  },
  verify: {
    name: "Reconciled to chain",
    description:
      "Positions are re-derived against live contract reads; drift is pinned as a proof. What can't be verified is refused and shown as refused.",
  },
  serve: {
    name: "Public API + this UI",
    description:
      "Read-only JSON, every money value a decimal string, a typed TypeScript client, and a live stream. This site is a client of the same API.",
  },
};

/**
 * How it works — four steps, each carrying a live number or an honest "unavailable". A step's tone is the shared
 * law's, and the front door honours the two that withdraw a claim: a refused step reads in the refused register and
 * a cautioned one in the warn register, so a withheld census is not only worded as one. A step that stands (`ok`,
 * `neutral`) prints in ink — the front door's line is a record, and green is kept for a verdict on the page that
 * owns it.
 */
export function Pipeline({ meta, evidence, reading, inFlight }: PipelineProps) {
  return (
    <div className={styles.pipe}>
      {pipelineSteps(meta, evidence, reading, inFlight).map((step) => (
        <div
          key={step.key}
          className={styles.step}
          data-testid={`pipeline-${step.key}`}
          data-value={step.pending ? step.sub : step.line.figure}
          data-tone={step.tone}
          aria-busy={step.pending ? "true" : undefined}
        >
          <div className={styles.stepNum}>{step.ordinal}</div>
          <div className={styles.stepN}>{STEP_COPY[step.key].name}</div>
          <div className={styles.stepD}>{STEP_COPY[step.key].description}</div>
          {/* A read in flight has neither answered nor failed: the step prints the lib's pending word, never its line's "unavailable". */}
          <div className={styles.stepV}>
            {step.pending ? (
              <b>{step.sub}</b>
            ) : (
              <>
                {step.line.before}
                <b>{step.line.figure}</b>
                {step.line.after}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
