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
import { pointDetailTakeaway, type BucketEntry } from "@/lib/observatory-series";
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
        {/* W-3L: the record's one-line state — computed, one source. The
            ABSENT and WITHHELD arms are hazards and never soften. */}
        <p className={styles.takeaway} data-testid="observatory-point-takeaway">
          {pointDetailTakeaway(entry)}
        </p>
        {entry.point === null ? (
          <p className={styles.detailNote}>
            The rollup captured nothing for this hour, because no complete risk batch existed to
            observe. Nobody refused it. An absent bucket is a hole in the record, stated by name:
            nothing is interpolated across it, and it never renders as zero.
          </p>
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

  // W-3L hazard fences — these three are disclosures, not provenance, and a
  // record carrying one keeps it OUTSIDE the forensic expandable:
  //   - unacked reorg epochs at compute;
  //   - an UNRECORDED sweep stamp (explicitly not "the engine has no sweeper");
  //   - a rate row whose scale is unstated (kind outside the vocabulary).
  const unacked = point.max_epoch_at_compute - point.acked_epoch > 0;
  const sweepUnrecorded = !point.sweep_recorded;
  const hasUnstatedScale = point.rates.some((rate) => rate.scale === "unstated");

  const reorgRow = (
    <>
      <dt>reorg posture at compute</dt>
      <dd data-testid="observatory-point-epochs">
        {!unacked ? (
          <>none unacked</>
        ) : (
          <span className="crit-t">
            {String(point.max_epoch_at_compute - point.acked_epoch)} unacked epoch(s) · acked{" "}
            {String(point.acked_epoch)} of {String(point.max_epoch_at_compute)}
          </span>
        )}{" "}
        <span className="dim">(the stamp pair copied from the observed batch&apos;s watermark vector)</span>
      </dd>
    </>
  );

  const sweepRow = (
    <>
      <dt>sweep stamp (the count&apos;s collateral clock)</dt>
      <dd data-testid="observatory-point-sweep">
        {!point.sweep_recorded ? (
          <>
            {EM_DASH}{" "}
            <span className="dim">
              unrecorded: this point predates migration 00018 and its batch was pruned before
              the stamp could be recovered. the record is missing here, and it is not a claim
              that the engine has no sweeper.
            </span>
          </>
        ) : point.sweep === null ? (
          <>
            none{" "}
            <span className="dim">
              (recorded: this engine has no collateral sweep, so its balances are event-derived)
            </span>
          </>
        ) : (
          <>
            <span className="mono">
              {String(point.sweep.rows)} swept · {String(point.sweep.failed)} failed · gen{" "}
              {String(point.sweep.generation)}
              {point.sweep.generation_open ? " (pass in flight)" : " (pass complete)"}
            </span>{" "}
            <span className="dim">
              · the observed batch&apos;s own sweep stamp; the liquidatable count above
              aggregates THIS sweep-cut, not the bucket&apos;s block clock. last successful
              write{" "}
              {point.sweep.max_updated_at === null
                ? `${EM_DASH} (no successful write recorded)`
                : point.sweep.max_updated_at}
            </span>
          </>
        )}
      </dd>
    </>
  );

  const ratesTable =
    point.rates.length > 0 ? (
      <table className={styles.ratesTable} data-testid="observatory-rates">
        <thead>
          <tr>
            <th>rate index</th>
            <th>asset</th>
            <th>value (raw decimal)</th>
            <th>scale</th>
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
              <td data-testid="observatory-rate-scale">
                {rate.scale === "unstated" ? (
                  <span className="dim">unstated · kind outside the known vocabulary</span>
                ) : (
                  rate.scale
                )}
              </td>
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
    );

  // What the forensic expandable holds, COUNTED in its own summary: pure
  // provenance (watermark, observed batch, materialization key), plus the
  // reorg/sweep rows and the rates table exactly when they carry no hazard.
  const forensicRowCount = 4 + (unacked ? 0 : 1) + (sweepUnrecorded ? 0 : 1);

  return (
    <>
      <dl className={styles.kvGrid}>
        <dt>state</dt>
        <dd>
          {point.refused ? (
            <>
              <RefusedTag reason={point.refusal_code ?? "unnamed"} /> · the engine&apos;s whole
              book was withheld at capture time
            </>
          ) : (
            "captured"
          )}
        </dd>

        <dt>debt (usd)</dt>
        <dd>
          {usd(point.debt_usd)}
          {point.debt_usd === null && (
            <span className="dim">, null because the book was withheld and never zero</span>
          )}
        </dd>

        <dt>collateral (usd)</dt>
        <dd>
          {usd(point.collateral_usd)}
          {point.collateral_usd === null && (
            <span className="dim">, null because the book was withheld and never zero</span>
          )}
        </dd>

        <dt>accounts</dt>
        <dd>{count(point.accounts)}</dd>

        <dt>refused position rows</dt>
        <dd>{String(point.refused_positions)}</dd>

        <dt>liquidatable positions</dt>
        <dd>{count(point.liquidatable_positions)}</dd>

        {/* Hazard rows surface OUTSIDE the expandable, exactly when they bite. */}
        {unacked && reorgRow}
        {sweepUnrecorded && sweepRow}
      </dl>

      {hasUnstatedScale && ratesTable}

      <details className={styles.detailForensics} data-testid="observatory-point-forensics">
        <summary>
          {String(forensicRowCount)} provenance row(s)
          {hasUnstatedScale ? "" : point.rates.length > 0 ? " + the rate snapshot" : " + the rate-snapshot note"}
        </summary>
        <dl className={styles.kvGrid}>
          <dt>bucket (its own as-of)</dt>
          <dd>{point.bucket_start}</dd>

          <dt>watermark</dt>
          <dd>
            block {formatBlock(point.last_block)}{" "}
            <span className="dim">
              (the engine&apos;s balances watermark at capture, never a chain head observed later)
            </span>
          </dd>

          <dt>observed batch</dt>
          <dd data-testid="observatory-point-batch">
            #{String(point.batch_id)}{" "}
            <span className="dim">
              (the COMPLETE batch this bucket observed; the batch itself may since have been
              pruned by retention)
            </span>
          </dd>

          <dt>materialization key</dt>
          <dd data-testid="observatory-point-mkey" className="mono">
            {point.materialization_key}{" "}
            <span className="dim">(copied at write time, so the attribution survives retention)</span>
          </dd>

          {!unacked && reorgRow}
          {!sweepUnrecorded && sweepRow}
        </dl>

        {!hasUnstatedScale && ratesTable}

        <p className={styles.detailNote}>
          provenance: this point was captured from the newest COMPLETE risk batch in its bucket
          (the observatory_points rollup law) and survives batch retention. rate values are the
          wire&apos;s exact decimal strings, rendered verbatim.
        </p>
      </details>
    </>
  );
}
