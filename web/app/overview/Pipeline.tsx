import type { components } from "@solvent/client";
import { pipelineSteps, type BookReading, type PipelineStep } from "@/lib/verification-view";
import styles from "./overview.module.css";

type Schemas = components["schemas"];

export interface PipelineProps {
  meta: Schemas["MetaResponse"] | null;
  evidence: Schemas["EvidenceResponse"] | null;
  /** The book reader's whole answer, so a 503 no-batch is told apart from a reader that has not answered. */
  reading: BookReading;
  cashAccounts: number | null;
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

/** How it works — four steps, each carrying a live number or an honest "unavailable". */
export function Pipeline({ meta, evidence, reading, cashAccounts }: PipelineProps) {
  return (
    <div className={styles.pipe}>
      {pipelineSteps(meta, evidence, reading, cashAccounts).map((step) => (
        <div key={step.key} className={styles.step} data-testid={`pipeline-${step.key}`} data-value={step.line.figure}>
          <div className={styles.stepNum}>{step.ordinal}</div>
          <div className={styles.stepN}>{STEP_COPY[step.key].name}</div>
          <div className={styles.stepD}>{STEP_COPY[step.key].description}</div>
          <div className={styles.stepV}>
            {step.line.before}
            <b>{step.line.figure}</b>
            {step.line.after}
          </div>
        </div>
      ))}
    </div>
  );
}
