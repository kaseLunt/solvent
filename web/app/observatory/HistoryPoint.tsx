// The selected bucket's FULL record (plan R5: a card, not a list) — provenance
// on detail, not buried in a tooltip. Every field is the wire's own statement:
// the bucket's as-of, the engine's balances watermark at capture time, the
// refusal posture, the exact totals (null renders as an em dash, NEVER 0), and
// the rate-index snapshot where every index carries its OWN as-of block.
//
// An ABSENT bucket gets the same card, stating the absence by name — the
// rollup captured nothing in that hour, and this card says so instead of
// pretending the bucket never existed.

import { KitTable, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { EM_DASH, formatBlock, renderNullableDecimal, truncateAddress } from "@/lib/format";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import { pointDetailTakeaway, type BucketEntry } from "@/lib/observatory-series";
import { readWirePopulation } from "@/lib/wireGuard";
import styles from "./history.module.css";

const RATE_COLUMNS: KitColumn[] = [
  { key: "kind", header: "rate index" },
  { key: "asset", header: "asset" },
  { key: "value", header: "value (raw decimal)", align: "right" },
  { key: "scale", header: "scale" },
  { key: "block", header: "its OWN as-of block", align: "right" },
  { key: "note", header: "note" },
];

export function HistoryPoint({ entry, response }: { entry: BucketEntry; response: ObservatorySeriesResponse }) {
  return (
    <section
      className={kit.card}
      data-testid="history-point"
      data-bucket={entry.bucketStart}
      data-kind={entry.kind}
      aria-label="bucket record"
    >
      <div className={kit.cardT}>
        <h3>
          Bucket record <span className={styles.mono}>{entry.bucketStart}</span>
        </h3>
      </div>
      {/* The record's one-line state — computed, one source. The ABSENT and WITHHELD arms are hazards and never soften. */}
      <p className={styles.takeaway} data-testid="history-point-takeaway">
        {pointDetailTakeaway(entry)}
      </p>
      {entry.point === null ? (
        <p className={styles.note}>
          The rollup captured nothing for this hour, because no complete risk batch existed to observe. Nobody
          refused it. An absent bucket is a hole in the record, stated by name: nothing is interpolated across it,
          and it never renders as zero.
        </p>
      ) : (
        <RecordBody entry={entry} response={response} />
      )}
    </section>
  );
}

function RecordBody({ entry, response }: { entry: BucketEntry; response: ObservatorySeriesResponse }) {
  const point = entry.point;
  if (point === null) return null;
  const usd = (value: string | null) =>
    renderNullableDecimal(value, { decimals: response.usd_decimals, prefix: "$" });
  // Non-null counts pass the population guard before the record.
  const count = (value: number | null) => (value === null ? EM_DASH : String(readWirePopulation(value, "count")));

  // Hazard fences — these three are disclosures, not provenance, and a record carrying one keeps it OUTSIDE the
  // forensic expandable:
  //   - unacked reorg epochs at compute;
  //   - an UNRECORDED sweep stamp (explicitly not "the engine has no sweeper");
  //   - a rate row whose scale is unstated (kind outside the vocabulary).
  // Both epoch stamps pass the population guard BEFORE the subtraction that decides (and later renders) the unacked
  // disclosure.
  const maxEpochAtCompute = readWirePopulation(point.max_epoch_at_compute, "max_epoch_at_compute");
  const ackedEpoch = readWirePopulation(point.acked_epoch, "acked_epoch");
  const unacked = maxEpochAtCompute - ackedEpoch > 0;
  const sweepUnrecorded = !point.sweep_recorded;
  const hasUnstatedScale = point.rates.some((rate) => rate.scale === "unstated");

  const reorgRow = (
    <>
      <dt>reorg posture at compute</dt>
      <dd data-testid="history-point-epochs">
        {!unacked ? (
          <>none unacked</>
        ) : (
          <span className={styles.crit}>
            {String(maxEpochAtCompute - ackedEpoch)} unacked epoch(s) · acked {String(ackedEpoch)} of{" "}
            {String(maxEpochAtCompute)}
          </span>
        )}{" "}
        <span className={styles.dim}>(the stamp pair copied from the observed batch&apos;s watermark vector)</span>
      </dd>
    </>
  );

  const sweepRow = (
    <>
      <dt>sweep stamp (the count&apos;s collateral clock)</dt>
      <dd data-testid="history-point-sweep">
        {!point.sweep_recorded ? (
          <>
            {EM_DASH}{" "}
            <span className={styles.dim}>
              unrecorded: this point predates migration 00018 and its batch was pruned before the stamp could be
              recovered. the record is missing here, and it is not a claim that the engine has no sweeper.
            </span>
          </>
        ) : point.sweep === null ? (
          <>
            none{" "}
            <span className={styles.dim}>
              (recorded: this engine has no collateral sweep, so its balances are event-derived)
            </span>
          </>
        ) : (
          <>
            <span className={styles.mono}>
              {/* Sweep tallies are wire populations, guarded reads. */}
              {String(readWirePopulation(point.sweep.rows, "sweep.rows"))} swept ·{" "}
              {String(readWirePopulation(point.sweep.failed, "sweep.failed"))} failed · gen{" "}
              {String(readWirePopulation(point.sweep.generation, "sweep.generation"))}
              {point.sweep.generation_open ? " (pass in flight)" : " (pass complete)"}
            </span>{" "}
            <span className={styles.dim}>
              · the observed batch&apos;s own sweep stamp; the liquidatable count above aggregates THIS sweep-cut,
              not the bucket&apos;s block clock. last successful write{" "}
              {point.sweep.max_updated_at === null
                ? `${EM_DASH} (no successful write recorded)`
                : point.sweep.max_updated_at}
            </span>
          </>
        )}
      </dd>
    </>
  );

  const rateRows: KitRow[] = point.rates.map((rate) => ({
    key: `${rate.kind}-${rate.asset}`,
    cells: {
      kind: <span className={styles.mono}>{rate.kind}</span>,
      asset: (
        <span title={rate.asset}>
          {rate.symbol ?? truncateAddress(rate.asset)} <span className={styles.dim}>{truncateAddress(rate.asset)}</span>
        </span>
      ),
      value: <span className={styles.mono}>{rate.value}</span>,
      scale: (
        <span data-testid="history-point-rate-scale">
          {rate.scale === "unstated" ? (
            <span className={styles.dim}>unstated · kind outside the known vocabulary</span>
          ) : (
            rate.scale
          )}
        </span>
      ),
      block: <span className={styles.mono}>{formatBlock(rate.as_of_block)}</span>,
      note: <span className={styles.dim}>{rate.note}</span>,
    },
  }));

  const ratesTable =
    point.rates.length > 0 ? (
      <div className={styles.rates}>
        <KitTable testId="history-point-rates" columns={RATE_COLUMNS} rows={rateRows} />
      </div>
    ) : (
      <p className={styles.note} data-testid="history-point-rates-empty">
        no rate snapshot was captured with this bucket{point.refused ? " (the whole book was withheld)" : ""}.
      </p>
    );

  // What the forensic expandable holds, COUNTED in its own summary: pure provenance (watermark, observed batch,
  // materialization key), plus the reorg/sweep rows and the rates table exactly when they carry no hazard.
  const forensicRowCount = 4 + (unacked ? 0 : 1) + (sweepUnrecorded ? 0 : 1);

  return (
    <>
      <dl className={styles.kv}>
        <dt>state</dt>
        <dd>
          {point.refused ? (
            <>
              <StatusPill tone="refused" title={point.refusal_code ?? "unnamed"}>
                withheld
              </StatusPill>{" "}
              · {point.refusal_code ?? "unnamed"} · the engine&apos;s whole book was withheld at capture time
            </>
          ) : (
            "captured"
          )}
        </dd>

        <dt>debt (usd)</dt>
        <dd>
          <span className={styles.mono}>{usd(point.debt_usd)}</span>
          {point.debt_usd === null && (
            <span className={styles.dim}>, null because the book was withheld and never zero</span>
          )}
        </dd>

        <dt>collateral (usd)</dt>
        <dd>
          <span className={styles.mono}>{usd(point.collateral_usd)}</span>
          {point.collateral_usd === null && (
            <span className={styles.dim}>, null because the book was withheld and never zero</span>
          )}
        </dd>

        <dt>accounts</dt>
        <dd>{count(point.accounts)}</dd>

        <dt>refused position rows</dt>
        <dd>{String(readWirePopulation(point.refused_positions, "refused_positions"))}</dd>

        <dt>liquidatable positions</dt>
        <dd>{count(point.liquidatable_positions)}</dd>

        {/* Hazard rows surface OUTSIDE the expandable, exactly when they bite. */}
        {unacked && reorgRow}
        {sweepUnrecorded && sweepRow}
      </dl>

      {hasUnstatedScale && ratesTable}

      <details className={styles.forensics} data-testid="history-point-forensics">
        <summary>
          {String(forensicRowCount)} provenance row(s)
          {hasUnstatedScale ? "" : point.rates.length > 0 ? " + the rate snapshot" : " + the rate-snapshot note"}
        </summary>
        <dl className={styles.kv}>
          <dt>bucket (its own as-of)</dt>
          <dd className={styles.mono}>{point.bucket_start}</dd>

          <dt>watermark</dt>
          <dd>
            block {formatBlock(point.last_block)}{" "}
            <span className={styles.dim}>
              (the engine&apos;s balances watermark at capture, never a chain head observed later)
            </span>
          </dd>

          <dt>observed batch</dt>
          <dd data-testid="history-point-batch">
            #{String(readWirePopulation(point.batch_id, "batch_id"))}{" "}
            <span className={styles.dim}>
              (the COMPLETE batch this bucket observed; the batch itself may since have been pruned by retention)
            </span>
          </dd>

          <dt>materialization key</dt>
          <dd data-testid="history-point-mkey" className={styles.mono}>
            {point.materialization_key}{" "}
            <span className={styles.dim}>(copied at write time, so the attribution survives retention)</span>
          </dd>

          {!unacked && reorgRow}
          {!sweepUnrecorded && sweepRow}
        </dl>

        {!hasUnstatedScale && ratesTable}

        <p className={styles.note}>
          provenance: this point was captured from the newest COMPLETE risk batch in its bucket (the
          observatory_points rollup law) and survives batch retention. rate values are the wire&apos;s exact decimal
          strings, rendered verbatim.
        </p>
      </details>
    </>
  );
}
