// THE RISK MAP'S LEDGER (RM-12) — the complete exact equivalent of the grid,
// in HTML, never collapsed.
//
// A density grid encodes a count as an opacity and a debt as a bar length.
// Both are readings, not values. R1 forbids exact money inside the VISUAL and
// LAW-5 forbids a number that exists only in a `<title>`, so everything the
// picture approximates is printed here, unrounded, beneath it:
//
//   (a) the seven band totals — exact count and exact Σ debt;
//   (b) EVERY NONEMPTY BIN — band, exact debt range from the bin's own
//       half-decade bounds, account count, exact Σ debt;
//   (c) the selected cell's detail, when a cell is active.
//
// R7: it is never inside a `<details>`. Material missingness and material
// exactness are both always visible; only the DECOMPOSITIONS collapse, and
// they live in FORENSICS.

import type { RiskBinsResult } from "@/app/book/riskBins";
import { headroomBandLabel } from "@/lib/headroom";
import styles from "./charts.module.css";

/** The active cell's exact detail, composed by the panel that holds the rows. */
export interface RiskCellDetail {
  band: number;
  xIndex: number;
  /** The composed sentence (see `cellDetailLine`). */
  line: string;
  /** The cell's top accounts by exact debt — truncated label + exact Σ. */
  accounts: { account: string; label: string; debtDisplay: string }[];
  /** How many of the cell's accounts are NOT listed — counted, never dropped. */
  remainder: number;
}

export interface RiskMapLedgerProps {
  result: RiskBinsResult;
  /** The id `aria-details` is NOT pointed at — this is the always-open ledger. */
  id: string;
  detail: RiskCellDetail | null;
}

export function RiskMapLedger({ result, id, detail }: RiskMapLedgerProps) {
  return (
    <div className={styles.mapLedger} id={id} data-testid="risk-map-ledger">
      <div className={styles.mapLedgerBlock}>
        <h4 className={styles.mapLedgerHead}>Band totals</h4>
        <table className={styles.mapLedgerTable}>
          <thead>
            <tr>
              <th scope="col">headroom band</th>
              <th scope="col" className={styles.mapLedgerNum}>
                accounts
              </th>
              <th scope="col" className={styles.mapLedgerNum}>
                Σ debt
              </th>
            </tr>
          </thead>
          <tbody>
            {result.bandTotals.map((marginal) => (
              <tr key={marginal.band} data-testid="risk-map-ledger-band">
                <td>{marginal.label}</td>
                <td className={styles.mapLedgerNum}>
                  {marginal.count.toLocaleString("en-US")}
                </td>
                <td className={styles.mapLedgerNum}>{marginal.debtDisplay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.mapLedgerBlock}>
        <h4 className={styles.mapLedgerHead}>Every nonempty bin</h4>
        <table className={styles.mapLedgerTable}>
          <thead>
            <tr>
              <th scope="col">headroom band</th>
              <th scope="col">debt range</th>
              <th scope="col" className={styles.mapLedgerNum}>
                accounts
              </th>
              <th scope="col" className={styles.mapLedgerNum}>
                Σ debt
              </th>
            </tr>
          </thead>
          <tbody>
            {result.bins.map((bin) => (
              <tr
                key={`${String(bin.band)}:${String(bin.xIndex)}`}
                data-testid="risk-map-ledger-bin"
                data-band={String(bin.band)}
                data-x-index={String(bin.xIndex)}
                data-selected={
                  detail !== null && detail.band === bin.band && detail.xIndex === bin.xIndex
                    ? "true"
                    : "false"
                }
              >
                <td>{headroomBandLabel(bin.band)}</td>
                <td>{bin.rangeLabel}</td>
                <td className={styles.mapLedgerNum}>{bin.count.toLocaleString("en-US")}</td>
                <td className={styles.mapLedgerNum}>{bin.debtDisplay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail !== null && (
        <div className={styles.mapLedgerBlock} data-testid="risk-map-cell-detail">
          <h4 className={styles.mapLedgerHead}>Selected cell</h4>
          <p className={styles.mapLedgerLine} data-testid="risk-map-cell-detail-line">
            {detail.line}
          </p>
          <table className={styles.mapLedgerTable}>
            <thead>
              <tr>
                <th scope="col">account</th>
                <th scope="col" className={styles.mapLedgerNum}>
                  debt
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.accounts.map((entry) => (
                <tr key={entry.account} data-testid="risk-map-cell-account">
                  {/* The FULL address rides `title`; the visual keeps the
                      truncation. The untruncated form with a copy affordance
                      lives in FORENSICS, where the exposure rows are. */}
                  <td className="mono" title={entry.account}>
                    {entry.label}
                  </td>
                  <td className={styles.mapLedgerNum}>{entry.debtDisplay}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.remainder > 0 && (
            <p className={styles.mapLedgerLine} data-testid="risk-map-cell-remainder">
              {detail.remainder.toLocaleString("en-US")} more accounts in this cell are counted in
              the totals above and are not listed here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
