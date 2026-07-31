"use client";

// The selected bucket's FULL record — provenance on detail, not buried in a
// tooltip. Every field is the wire's own statement: the bucket's as-of, the
// engine's balances watermark at capture time, the refusal posture, the exact
// totals (null renders as an em dash, NEVER 0), and the rate-index snapshot
// where every index carries its OWN as-of block.
//
// An ABSENT bucket gets the same panel, stating the absence by name — the
// rollup captured nothing in that hour, and this panel says so instead of
// pretending the bucket never existed.

import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { EM_DASH, formatBlock, renderNullableDecimal, truncateAddress } from "@/lib/format";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import type { BucketEntry } from "@/lib/observatory-series";
import styles from "./observatory.module.css";

export function ObservatoryPointDetail({
  entry,
  response,
}: {
  entry: BucketEntry;
  response: ObservatorySeriesResponse;
}) {
  return (
    <section
      className={styles.panel}
      data-testid="observatory-point-detail"
      data-bucket={entry.bucketStart}
      data-kind={entry.kind}
    >
      <div className={styles.panelHead}>
        <span>bucket record</span>
        <span className={styles.asOf}>{entry.bucketStart}</span>
        <EngineChip engine={response.engine} />
      </div>
      <div className={styles.panelBody}>
        {entry.point === null ? (
          <>
            <p className="mono">
              <b>ABSENT — NO COMPLETE BATCH IN THIS BUCKET</b> — the rollup captured nothing for
              this hour. (An absence, not a refusal: no complete risk batch existed to observe.)
            </p>
            <p className={styles.detailNote}>
              an absent bucket is a hole in the record, stated by name. nothing is interpolated
              across it, and it never renders as zero.
            </p>
          </>
        ) : (
          <DetailBody entry={entry} response={response} />
        )}
      </div>
    </section>
  );
}

function DetailBody({
  entry,
  response,
}: {
  entry: BucketEntry;
  response: ObservatorySeriesResponse;
}) {
  const point = entry.point;
  if (point === null) return null;
  const usd = (value: string | null) =>
    renderNullableDecimal(value, { decimals: response.usd_decimals, prefix: "$" });
  const count = (value: number | null) => (value === null ? EM_DASH : String(value));

  return (
    <>
      <dl className={styles.kvGrid}>
        <dt>bucket (its own as-of)</dt>
        <dd>{point.bucket_start}</dd>

        <dt>state</dt>
        <dd>
          {point.refused ? (
            <>
              <RefusedTag reason={point.refusal_code ?? "unnamed"} /> — the engine&apos;s whole
              book was withheld at capture time
            </>
          ) : (
            "captured"
          )}
        </dd>

        <dt>watermark</dt>
        <dd>
          block {formatBlock(point.last_block)}{" "}
          <span className="dim">
            (the engine&apos;s balances watermark at capture — never a chain head observed later)
          </span>
        </dd>

        <dt>debt (usd)</dt>
        <dd>
          {usd(point.debt_usd)}
          {point.debt_usd === null && (
            <span className="dim"> — null because the book was withheld; not zero</span>
          )}
        </dd>

        <dt>collateral (usd)</dt>
        <dd>
          {usd(point.collateral_usd)}
          {point.collateral_usd === null && (
            <span className="dim"> — null because the book was withheld; not zero</span>
          )}
        </dd>

        <dt>accounts</dt>
        <dd>{count(point.accounts)}</dd>

        <dt>refused position rows</dt>
        <dd>{String(point.refused_positions)}</dd>

        <dt>liquidatable positions</dt>
        <dd>{count(point.liquidatable_positions)}</dd>
      </dl>

      {point.rates.length > 0 ? (
        <table className={styles.ratesTable} data-testid="observatory-rates">
          <thead>
            <tr>
              <th>rate index</th>
              <th>asset</th>
              <th>value (raw decimal)</th>
              <th>its OWN as-of block</th>
              <th>note</th>
            </tr>
          </thead>
          <tbody>
            {point.rates.map((rate) => (
              <tr key={`${rate.kind}-${rate.asset}`}>
                <td>{rate.kind}</td>
                <td title={rate.asset}>
                  {rate.symbol ?? truncateAddress(rate.asset)}{" "}
                  <span className="dim">{truncateAddress(rate.asset)}</span>
                </td>
                <td>{rate.value}</td>
                <td>{formatBlock(rate.as_of_block)}</td>
                <td className="dim">{rate.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.detailNote} data-testid="observatory-rates-empty">
          no rate snapshot was captured with this bucket
          {point.refused ? " (the whole book was withheld)" : ""}.
        </p>
      )}

      <p className={styles.detailNote}>
        provenance: this point was captured from the newest COMPLETE risk batch in its bucket
        (the observatory_points rollup law) and survives batch retention. rate values are the
        wire&apos;s exact decimal strings, rendered verbatim.
      </p>
    </>
  );
}
