// The selected hour's FULL record: a card, not a list. Every sentence is the
// lib's (`pointRecord`): this component prints the rows — each a name on the
// left and its value on the right, one hairline between them, the record
// pattern Verification's subject cards share — keeps each hazard row outside
// the counted fold exactly when the record puts it in the answer, sets a
// clause in the ink the record names for it (a caption is dim; a state never
// is), offers the exact string's copy action where the record names one, and
// draws the rate snapshot as the kit's table inside its own scroll container.
// Nothing here decides a word.

import { KitTable, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { HISTORY_RATE_COLUMNS, pointRecord, type PointRecord, type RecordRow } from "@/lib/history-view";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import type { BucketEntry } from "@/lib/observatory-series";
import { CopyChip } from "../proof/CopyChip";
import styles from "./history.module.css";

const RATE_COLUMNS: KitColumn[] = HISTORY_RATE_COLUMNS.map((column) => ({
  key: column.key,
  header: column.header,
  ...(column.align === undefined ? {} : { align: column.align }),
}));

/** One record renders at a time, so one id names its heading. */
const TITLE_ID = "history-point-title";

export function HistoryPoint({ entry, response, latest }: { entry: BucketEntry; response: ObservatorySeriesResponse; latest: boolean }) {
  const record = pointRecord(entry, response, latest);
  return (
    // The card is named BY its heading: the accessible name is the visible title and the hour it belongs to, one
    // node — so the two cannot differ in case or in words, and a reader of either knows which hour's record this is.
    <section
      className={kit.card}
      data-testid="history-point"
      data-bucket={record.bucket}
      data-kind={record.kind}
      aria-labelledby={TITLE_ID}
    >
      <div className={kit.cardT}>
        <h3 id={TITLE_ID} title={record.bucket}>
          {record.title}
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
    <dl className={styles.rows}>
      {rows.map((row) => (
        <div key={row.key} className={styles.row}>
          <dt className={styles.k}>{row.label}</dt>
          <dd className={styles.v} data-testid={row.testId ?? undefined}>
            {row.tone === "refused" ? (
              <StatusPill tone="refused" title={code ?? undefined}>
                {row.value}
              </StatusPill>
            ) : (
              <span
                className={[row.mono ? styles.mono : "", row.tone === "crit" ? styles.crit : ""].filter(Boolean).join(" ") || undefined}
                title={row.title ?? undefined}
              >
                {row.value}
              </span>
            )}
            {row.copy !== null && (
              <>
                {" "}
                <CopyChip text={row.copy.text} label={row.copy.label} />
              </>
            )}
            {row.note !== null && (
              <span className={row.noteTone === "state" ? styles.stateNote : styles.dim} data-note={row.noteTone}>
                {row.note}
              </span>
            )}
          </dd>
        </div>
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
      block: rate.block,
      note: <span className={styles.dim}>{rate.note}</span>,
    },
  }));
  return (
    <div className={styles.rates}>
      <KitTable testId="history-point-rates" columns={RATE_COLUMNS} rows={rows} label={record.title} />
    </div>
  );
}
