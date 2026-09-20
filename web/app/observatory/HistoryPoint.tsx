// The selected bucket's FULL record (plan R5: a card, not a list). Every
// sentence is the lib's (`pointRecord`): this component prints the rows, keeps
// each hazard row outside the counted fold exactly when the record puts it in
// the answer, and draws the rate snapshot as the kit's table. Nothing here
// decides a word.

import { Fragment } from "react";
import { KitTable, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { HISTORY_RATE_COLUMNS, pointRecord, type PointRecord, type RecordRow } from "@/lib/history-view";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import type { BucketEntry } from "@/lib/observatory-series";
import styles from "./history.module.css";

const RATE_COLUMNS: KitColumn[] = HISTORY_RATE_COLUMNS.map((column) => ({
  key: column.key,
  header: column.header,
  ...(column.align === undefined ? {} : { align: column.align }),
}));

export function HistoryPoint({ entry, response }: { entry: BucketEntry; response: ObservatorySeriesResponse }) {
  const record = pointRecord(entry, response);
  return (
    <section
      className={kit.card}
      data-testid="history-point"
      data-bucket={record.bucket}
      data-kind={record.kind}
      aria-label={record.title}
    >
      <div className={kit.cardT}>
        <h3>
          {record.title} <span className={styles.mono}>{record.bucket}</span>
        </h3>
      </div>
      <p className={styles.takeaway} data-testid="history-point-takeaway">
        {record.takeaway}
      </p>
      {record.absentNote !== null && <p className={styles.note}>{record.absentNote}</p>}
      {record.answer.length > 0 && <Rows rows={record.answer} code={record.refusalCode} />}
      {record.ratesOutside && <Rates record={record} />}
      {record.forensicSummary !== null && (
        <details className={styles.forensics} data-testid="history-point-forensics">
          <summary>{record.forensicSummary}</summary>
          <Rows rows={record.forensic} code={record.refusalCode} />
          {!record.ratesOutside && <Rates record={record} />}
          <p className={styles.note}>{record.provenance}</p>
        </details>
      )}
    </section>
  );
}

function Rows({ rows, code }: { rows: readonly RecordRow[]; code: string | null }) {
  return (
    <dl className={styles.kv}>
      {rows.map((row) => (
        <Fragment key={row.key}>
          <dt>{row.label}</dt>
          <dd data-testid={row.testId ?? undefined}>
            {row.tone === "refused" ? (
              <StatusPill tone="refused" title={code ?? undefined}>
                {row.value}
              </StatusPill>
            ) : (
              <span className={[row.mono ? styles.mono : "", row.tone === "crit" ? styles.crit : ""].filter(Boolean).join(" ") || undefined}>
                {row.value}
              </span>
            )}
            {row.note !== null && <span className={styles.dim}>{row.note}</span>}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Rates({ record }: { record: PointRecord }) {
  if (record.rates.length === 0) {
    return (
      <p className={styles.note} data-testid="history-point-rates-empty">
        {record.ratesEmpty ?? ""}
      </p>
    );
  }
  const rows: KitRow[] = record.rates.map((rate) => ({
    key: rate.key,
    cells: {
      kind: <span className={styles.mono}>{rate.kind}</span>,
      assetName: (
        <span title={rate.asset}>
          {rate.assetName} <span className={styles.dim}>{rate.assetShort}</span>
        </span>
      ),
      value: <span className={styles.mono}>{rate.value}</span>,
      scale: (
        <span data-testid="history-point-rate-scale">
          {rate.scaleStated ? rate.scale : <span className={styles.dim}>{rate.scale}</span>}
        </span>
      ),
      block: <span className={styles.mono}>{rate.block}</span>,
      note: <span className={styles.dim}>{rate.note}</span>,
    },
  }));
  return (
    <div className={styles.rates}>
      <KitTable testId="history-point-rates" columns={RATE_COLUMNS} rows={rows} />
    </div>
  );
}
