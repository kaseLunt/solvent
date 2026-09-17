import type { components } from "@solvent/client";
import { pipelineSteps, type PipelineStep } from "@/lib/verification-view";
import styles from "./overview.module.css";

type Schemas = components["schemas"];

export interface PipelineProps {
  meta: Schemas["MetaResponse"] | null;
  evidence: Schemas["EvidenceResponse"] | null;
  book: Schemas["BookResponse"] | null;
  cashAccounts: number | null;
}

/** The front door's own words for each step; the number and its qualifier are the shared law's (lib/verification-view). */
const STEP_COPY: Record<PipelineStep["key"], { num: string; name: string; description: string }> = {
  index: {
    num: "01 · INDEX",
    name: "Reorg-safe indexer",
    description:
      "Raw logs from OP Mainnet and Ethereum into Postgres. Verified-ancestor rewind handles forks of any depth; every derived table rebuilds from raw logs.",
  },
  compute: {
    num: "02 · COMPUTE",
    name: "Risk engine",
    description:
      "Each batch recomputes every account with its engine's own rule — Cash's borrow cap, Aave's health factor — using RedStone prices with a freshness budget.",
  },
  verify: {
    num: "03 · VERIFY",
    name: "Reconciled to chain",
    description:
      "Positions are re-derived against live contract reads; drift is pinned as a proof. What can't be verified is refused and shown as refused.",
  },
  serve: {
    num: "04 · SERVE",
    name: "Public API + this UI",
    description:
      "Read-only JSON, every money value a decimal string, a typed TypeScript client, and a live stream. This site is a client of the same API.",
  },
};

/** Whether the number leads its noun ("87/87 gated rows exact", "17 endpoints") or follows it ("OP block 154,796,552", "batch 1"). */
const VALUE_LEADS: Record<PipelineStep["key"], boolean> = { index: false, compute: false, verify: true, serve: true };

/** The step's line: its number in bold beside its noun, then the second figure — `sub` is "unit · context" by the law's contract. */
function StepValue({ step }: { step: PipelineStep }) {
  const [unit = "", ...rest] = step.sub.split(" · ");
  const context = rest.join(" · ");
  const value = <b>{step.value}</b>;
  return (
    <div className={styles.stepV}>
      {VALUE_LEADS[step.key] ? (
        <>
          {value} {unit}
        </>
      ) : (
        <>
          {unit} {value}
        </>
      )}
      {context === "" ? null : <> · {context}</>}
    </div>
  );
}

/** How it works — four steps, each carrying a live number or an honest "unavailable". */
export function Pipeline({ meta, evidence, book, cashAccounts }: PipelineProps) {
  return (
    <div className={styles.pipe}>
      {pipelineSteps(meta, evidence, book, cashAccounts).map((step) => (
        <div key={step.key} className={styles.step} data-testid={`pipeline-${step.key}`} data-value={step.value}>
          <div className={styles.stepNum}>{STEP_COPY[step.key].num}</div>
          <div className={styles.stepN}>{STEP_COPY[step.key].name}</div>
          <div className={styles.stepD}>{STEP_COPY[step.key].description}</div>
          <StepValue step={step} />
        </div>
      ))}
    </div>
  );
}
