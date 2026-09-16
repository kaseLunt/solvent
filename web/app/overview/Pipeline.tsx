import type { components } from "@solvent/client";
import { PUBLIC_ENDPOINTS } from "./copy";
import styles from "./overview.module.css";

type Schemas = components["schemas"];

export interface PipelineProps {
  meta: Schemas["MetaResponse"] | null;
  evidence: Schemas["EvidenceResponse"] | null;
  book: Schemas["BookResponse"] | null;
  cashAccounts: number | null;
}

const UNAVAILABLE = "unavailable";
const n = (value: number | null | undefined): string =>
  typeof value === "number" ? value.toLocaleString("en-US") : UNAVAILABLE;

/** How it works — four steps, each carrying a live number or an honest "unavailable". */
export function Pipeline({ meta, evidence, book, cashAccounts }: PipelineProps) {
  const dm = meta?.watermark_vector.find((w) => w.engine === "debt_manager") ?? null;
  const eth = meta?.watermark_vector.find((w) => w.engine === "aave_v3_etherfi") ?? null;
  const recon = evidence?.reconcile ?? null;
  const indexValue = dm === null ? UNAVAILABLE : n(dm.last_block);
  const verifyValue = recon === null ? UNAVAILABLE : `${n(recon.gated_exact)}/${n(recon.gated_rows)}`;
  return (
    <div className={styles.pipe}>
      <div className={styles.step} data-testid="pipeline-index" data-value={indexValue}>
        <div className={styles.stepNum}>01 · INDEX</div>
        <div className={styles.stepN}>Reorg-safe indexer</div>
        <div className={styles.stepD}>
          Raw logs from OP Mainnet and Ethereum into Postgres. Verified-ancestor rewind handles forks of any depth;
          every derived table rebuilds from raw logs.
        </div>
        <div className={styles.stepV}>
          OP block <b>{indexValue}</b> · Ethereum block <b>{eth === null ? UNAVAILABLE : n(eth.last_block)}</b>
        </div>
      </div>
      <div className={styles.step} data-testid="pipeline-compute" data-value={book === null ? UNAVAILABLE : n(book.batch.id)}>
        <div className={styles.stepNum}>02 · COMPUTE</div>
        <div className={styles.stepN}>Risk engine</div>
        <div className={styles.stepD}>
          Each batch recomputes every account with its engine&apos;s own rule — Cash&apos;s borrow cap, Aave&apos;s
          health factor — using RedStone prices with a freshness budget.
        </div>
        <div className={styles.stepV}>
          {book === null ? (
            <b>{UNAVAILABLE}</b>
          ) : (
            <>
              batch <b>{n(book.batch.id)}</b> · <b>{n(cashAccounts)}</b> Cash accounts
            </>
          )}
        </div>
      </div>
      <div className={styles.step} data-testid="pipeline-verify" data-value={verifyValue}>
        <div className={styles.stepNum}>03 · VERIFY</div>
        <div className={styles.stepN}>Reconciled to chain</div>
        <div className={styles.stepD}>
          Positions are re-derived against live contract reads; drift is pinned as a proof. What can&apos;t be
          verified is refused and shown as refused.
        </div>
        <div className={styles.stepV}>
          <b>{verifyValue}</b> gated rows exact
          {recon === null ? "" : <> · drift <b>{n(recon.gated_drift)}</b></>}
        </div>
      </div>
      <div className={styles.step} data-testid="pipeline-serve" data-value={String(PUBLIC_ENDPOINTS.length)}>
        <div className={styles.stepNum}>04 · SERVE</div>
        <div className={styles.stepN}>Public API + this UI</div>
        <div className={styles.stepD}>
          Read-only JSON, every money value a decimal string, a typed TypeScript client, and a live stream. This
          site is a client of the same API.
        </div>
        <div className={styles.stepV}>
          <b>{String(PUBLIC_ENDPOINTS.length)}</b> endpoints · typed TypeScript client
        </div>
      </div>
    </div>
  );
}
