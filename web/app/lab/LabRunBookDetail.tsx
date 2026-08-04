// The run-book detail's three 1.6.0 surfaces: the BEFORE/AFTER histogram pair,
// the MOVERS table, and the per-side collateral breakdown (Wave W-BS-A).
//
// # Why these are lab-local rather than imported from the Book
//
// `app/book/BookHistogram.tsx` renders an `EngineHistogram` — a shape carrying
// engine-withholding fields (`refused`, `refusal`, `engine`) that a run-book
// aggregate deliberately does not have, because a withheld engine contributes
// no run-book row at all. It also takes `Aggregate`/`BadDebt` for its reading
// line, neither of which exists on this surface. So these components are the
// Book's VISUAL LAW re-expressed over the run-book's own shape: same
// horizontal count bars, same mono labels, same hairline baseline, same crit
// tint asymmetry (wad comparator only — the Debt Manager's buckets are a
// disclosure and are never tinted as a verdict), same refused/infinite aside.
//
// # The laws these render under
//
//   - REFUSALS RENDER. `refused_count` and `infinite_count` sit beside every
//     distribution; an unpriced collateral holding renders in the refusal
//     register with its balance intact and NO value, never a zero.
//   - The two distributions share ONE count scale, so their bars are
//     comparable by length. Scaling each side to its own maximum would draw
//     two charts that look identical while describing a real shift.
//   - The wire's own notes render VERBATIM. `movers_note` in particular is the
//     server's statement of its ranking rule and its truncation, and
//     paraphrasing a caveat is how a caveat stops working.

import type { LabRunBookEngine, RunBookAggregate } from "@/lib/runbook";
import { EM_DASH, renderNullableDecimal } from "@/lib/format";
import { sharePercent, shareBarWidth } from "@/lib/book-format";
import {
  RISK_BAND_METHOD,
  riskBandDenominatorLine,
  riskBandNoDebtRow,
  riskBandPairAria,
  riskBandRefusedRow,
} from "@/lib/book-copy";
import { labUsd } from "./frontierView";
import {
  collateralDisclosure,
  collateralReadingLine,
  collateralRowKey,
  histogramShiftReadingLine,
  moversDisclosure,
} from "./labRunBookLines";
import styles from "./lab.module.css";

const BAR_MAX = 168;
const ROW_H = 18;
const LABEL_W = 84;
const COUNT_W = 64;
/** CX-6: the common percent axis and the gutter its labels need. */
const PERCENT_TICKS = [0, 50, 100] as const;
const AXIS_H = 20;
/** Same law as the Book's: the floor is on the MARKER, never on the quantity. */
const PRESENCE_MIN = 1;
const PRESENCE_R = 1.5;

// ---------------------------------------------------------------------------
// B1 — the BEFORE/AFTER histogram pair
// ---------------------------------------------------------------------------

function Distribution({
  aggregate,
  side,
  engine,
}: {
  aggregate: RunBookAggregate;
  side: "before" | "after";
  engine: string;
}) {
  const histogram = aggregate.hf_histogram;
  // Crit tint ONLY where the comparator itself defines eligibility. The Debt
  // Manager's buckets are the exact rational maxBorrowLT/borrowings — a
  // disclosure — so tinting them would dress a disclosure as a verdict. The
  // asymmetry is the design; it is not an oversight.
  const eligibleTint = histogram.comparator === "hf_wad";
  const scale = BigInt(histogram.wad_scale);
  // CX-6: the denominator is this side's debt-bearing accounts with a finite
  // comparator — exactly the population the buckets partition. The two sides
  // still share ONE scale, and that scale is now the COMMON 0 to 100 percent
  // axis: percentages are dimensionless (LAW-2), so shape stays comparable
  // between the sides while each names its own denominator.
  const denominator = histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const width = LABEL_W + BAR_MAX + COUNT_W + 24;
  const height = histogram.buckets.length * ROW_H + AXIS_H;

  return (
    <div className={styles.histSide} data-testid={`runbook-hist-${side}`} data-engine={engine}>
      <p className={styles.histSideTitle}>{side} the shock</p>
      <p className={styles.denominatorLine} data-testid={`runbook-hist-denominator-${side}`}>
        {riskBandDenominatorLine(denominator)}
      </p>
      {/* LAW-3 / CX-7, the Book's fix mirrored: `maxWidth: 100%` scaled the
          whole picture inside a narrow side, and viewBox scaling shrinks a
          12px label without changing what `getComputedStyle` reports. Authored
          width is kept and the frame scrolls. */}
      <div className={styles.chartScroll} data-testid={`runbook-hist-frame-${side}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={`risk-band distribution ${side} the shock for ${engine} on comparator ${histogram.comparator}`}
        style={{ display: "block" }}
        data-testid={`runbook-hist-svg-${side}`}
      >
        <line
          className={styles.histBaseline}
          x1={LABEL_W + 4}
          x2={LABEL_W + 4}
          y1={2}
          y2={height - AXIS_H + 2}
        />
        {PERCENT_TICKS.map((tick) => (
          <g key={`tick-${String(tick)}`} data-testid="runbook-percent-tick">
            <line
              className={styles.histBaseline}
              x1={LABEL_W + 6 + (tick / 100) * BAR_MAX}
              x2={LABEL_W + 6 + (tick / 100) * BAR_MAX}
              y1={2}
              y2={height - AXIS_H + 2}
              opacity={tick === 0 ? 1 : 0.35}
            />
            <text
              className={styles.histAxisLabel}
              x={LABEL_W + 6 + (tick / 100) * BAR_MAX}
              y={height - 6}
              textAnchor="middle"
            >
              {String(tick)}%
            </text>
          </g>
        ))}
        {histogram.buckets.map((bucket, index) => {
          const y = index * ROW_H + 4;
          // CX-6 geometry, the Book's law mirrored: the rendered width IS the
          // share, with no floor riding it. A bucket too small to reach a
          // pixel keeps a presence dot, a different form from a bar.
          const barWidth = shareBarWidth(bucket.count, denominator, BAR_MAX);
          const subPixel = bucket.count > 0 && barWidth < PRESENCE_MIN;
          const percent = sharePercent(bucket.count, denominator);
          const belowOne =
            eligibleTint && bucket.upper_wad !== null && BigInt(bucket.upper_wad) <= scale;
          return (
            <g key={bucket.label}>
              {belowOne && (
                <rect
                  className={styles.histEligibleMark}
                  data-testid="runbook-hist-eligible-mark"
                  x={0}
                  y={y + 2}
                  width={8}
                  height={8}
                  rx={1}
                >
                  <title>
                    eligible territory: the engine liquidates strictly below 1.00 on the wad
                  </title>
                </rect>
              )}
              <text className={styles.histLabel} x={LABEL_W} y={y + 10} textAnchor="end">
                {bucket.label}
              </text>
              {barWidth > 0 && (
                <rect
                  className={belowOne ? styles.histBarEligible : styles.histBar}
                  data-testid="runbook-hist-bar"
                  data-bucket={bucket.label}
                  x={LABEL_W + 6}
                  y={y + 2}
                  width={barWidth}
                  height={ROW_H - 8}
                />
              )}
              {subPixel && (
                <circle
                  className={belowOne ? styles.histPresenceEligible : styles.histPresence}
                  data-testid="runbook-hist-presence"
                  data-bucket={bucket.label}
                  cx={LABEL_W + 6 + PRESENCE_R}
                  cy={y + 2 + (ROW_H - 8) / 2}
                  r={PRESENCE_R}
                >
                  <title>
                    {`${String(bucket.count)} accounts, a share too small to draw at one pixel ` +
                      `on this axis. This dot marks presence and carries no length.`}
                  </title>
                </circle>
              )}
              <text
                className={styles.histCount}
                x={LABEL_W + 12 + BAR_MAX}
                y={y + 10}
                data-testid="runbook-hist-row-label"
              >
                {String(bucket.count)}
                {percent === null ? "" : ` · ${percent}%`}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      {/* CX-6 THE ACCOUNTING ROWS: never folded into the denominator. */}
      <div className={styles.histAside}>
        <span data-testid={`runbook-hist-no-debt-${side}`}>
          {riskBandNoDebtRow(histogram.infinite_count)}
        </span>
        <span className={styles.histBadge} data-testid={`runbook-hist-refused-${side}`}>
          {riskBandRefusedRow(histogram.refused_count)} · rows counted here, never dropped
        </span>
      </div>
    </div>
  );
}

export function LabRunBookHistogramPair({ engine }: { engine: LabRunBookEngine }) {
  return (
    <section
      className={styles.subPanel}
      data-testid="runbook-histogram-pair"
      data-engine={engine.engine}
      aria-label={riskBandPairAria(engine.engine)}
    >
      <p className={styles.panelTitle}>
        Risk-band distribution · before → after{" "}
        <span className={styles.comparatorTag}>
          comparator: {engine.before.hf_histogram.comparator}
        </span>
      </p>
      <p className={styles.readingLine} data-testid="runbook-hist-reading">
        {histogramShiftReadingLine(engine)}
      </p>
      <div className={styles.histPair}>
        <Distribution aggregate={engine.before} side="before" engine={engine.engine} />
        <Distribution aggregate={engine.after} side="after" engine={engine.engine} />
      </div>
      <p className={styles.methodLine} data-testid="runbook-hist-method">
        {RISK_BAND_METHOD}
      </p>
      <p className={styles.noteText}>{engine.after.hf_histogram.note}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// B2 — the movers table
// ---------------------------------------------------------------------------

/** The engine's own evidence columns. Each engine is asked only what it speaks. */
function MoverRow({ engine, mover }: { engine: LabRunBookEngine; mover: LabRunBookEngine["movers"][number] }) {
  const wad = (value: string | null) =>
    value === null ? EM_DASH : renderNullableDecimal(value, { decimals: 18 });
  const ratio = (num: string | null, den: string | null) =>
    num === null || den === null ? EM_DASH : `${num} / ${den}`;
  const isWadEngine = engine.before.hf_histogram.comparator === "hf_wad";

  return (
    <tr data-testid="runbook-mover">
      <td className={styles.mono}>
        {/* The Inspector reads an address; this is the same address the run
            measured, so the row opens its own evidentiary chain.

            THE ADDRESS IS THE PATH, not a query. `/inspector` is the entry
            FORM and reads no search params; the surface that renders a
            position lives at `/inspector/[addr]`. A link that claimed to open
            the account's evidence and landed on an empty form was a promise
            the href did not keep. */}
        <a href={`/inspector/${mover.account}`} data-testid="runbook-mover-account">
          {mover.account}
        </a>
      </td>
      {isWadEngine ? (
        <>
          <td className={styles.num}>{wad(mover.hf_before_wad)}</td>
          <td className={styles.num}>{wad(mover.hf_after_wad)}</td>
          <td className={styles.num} data-testid="runbook-mover-drop">
            {wad(mover.hf_drop_wad)}
          </td>
        </>
      ) : (
        <>
          <td className={styles.num}>{ratio(mover.hf_before_num, mover.hf_before_den)}</td>
          <td className={styles.num}>{ratio(mover.hf_after_num, mover.hf_after_den)}</td>
          <td className={styles.num} data-testid="runbook-mover-flip">
            {/* A null verdict is NOT APPLICABLE and renders as such; it is
                never collapsed into "no". */}
            {mover.became_eligible === null
              ? EM_DASH
              : mover.became_eligible
                ? "became eligible"
                : "no"}
          </td>
          <td className={styles.num} data-testid="runbook-mover-debt">
            {/* Money is EXACT and GROUPED, in the engine's own decimals —
                the same register `labUsd` gives the frontier and the reading
                lines above, so a panel never disagrees with its own caption. */}
            {mover.debt_usd === null ? EM_DASH : labUsd(mover.debt_usd, engine.usd_decimals)}
          </td>
        </>
      )}
    </tr>
  );
}

export function LabRunBookMovers({ engine }: { engine: LabRunBookEngine }) {
  const isWadEngine = engine.before.hf_histogram.comparator === "hf_wad";
  return (
    <section
      className={styles.subPanel}
      data-testid="runbook-movers"
      data-engine={engine.engine}
      data-movers-total={String(engine.movers_total)}
      aria-label={`accounts moved by this scenario on ${engine.engine}`}
    >
      <p className={styles.panelTitle}>Accounts this scenario moved</p>
      <p className={styles.readingLine} data-testid="runbook-movers-disclosure">
        {moversDisclosure(engine)}
      </p>
      {engine.movers.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>account</th>
                {isWadEngine ? (
                  <>
                    <th className={styles.num}>hf before</th>
                    <th className={styles.num}>hf after</th>
                    <th className={styles.num}>hf drop</th>
                  </>
                ) : (
                  <>
                    <th className={styles.num}>maxBorrowLT / borrowings before</th>
                    <th className={styles.num}>after</th>
                    <th className={styles.num}>eligibility</th>
                    <th className={styles.num}>debt</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {engine.movers.map((mover) => (
                <MoverRow key={mover.account} engine={engine} mover={mover} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* The server's own statement of its ranking rule AND its truncation,
          VERBATIM. This is the sentence that makes the cap not-silent. */}
      <p className={styles.noteText} data-testid="runbook-movers-note">
        {engine.movers_note}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// B3 — collateral by asset, per side
// ---------------------------------------------------------------------------

function CollateralSide({
  aggregate,
  side,
  usdDecimals,
}: {
  aggregate: RunBookAggregate;
  side: "before" | "after";
  usdDecimals: number;
}) {
  return (
    <div className={styles.collateralSide} data-testid={`runbook-collateral-${side}`}>
      <p className={styles.histSideTitle}>{side} the shock</p>
      <p className={styles.readingLine} data-testid={`runbook-collateral-reading-${side}`}>
        {collateralReadingLine(aggregate, usdDecimals, side)}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>asset</th>
              <th className={styles.num}>amount</th>
              <th className={styles.num}>value</th>
            </tr>
          </thead>
          <tbody>
            {aggregate.collateral_by_asset.map((entry) => (
              <tr
                // A KEY IS AN IDENTITY CLAIM. The server itemizes by asset AND
                // disclosure, so one asset legitimately appears more than once
                // on one side — the live book already serves weETH COUNTED and
                // NOT COUNTED together. `collateralRowKey` encodes that whole
                // pair; keying on `asset + unpriced` made those two rows the
                // same row to React, and a rerun then reconciled them by guess.
                key={collateralRowKey(entry)}
                data-testid="runbook-collateral-row"
                data-unpriced={String(entry.unpriced)}
                // The row states which of the three disclosures it carries, in
                // the wire's own vocabulary — the identity the key is built on,
                // readable rather than implied by two separate attributes.
                data-disclosure={collateralDisclosure(entry)}
              >
                <td className={styles.mono} title={entry.asset}>
                  {/* The symbol is decoration over an address that is already
                      exact. Absent means the registry holds none — the address
                      stands alone rather than a symbol being invented. */}
                  {entry.symbol ?? entry.asset}
                </td>
                <td className={styles.num}>
                  {renderNullableDecimal(entry.amount, { decimals: entry.decimals })}
                </td>
                <td className={styles.num}>
                  {entry.value_usd === null ? (
                    // THE REFUSAL REGISTER. A balance the engine counted no
                    // value for renders as a named absence, never as $0.
                    <span
                      className={styles.unpricedTag}
                      data-testid="runbook-collateral-unpriced"
                      title={entry.note}
                    >
                      {entry.unpriced ? "UNPRICED · no price witness" : "NOT COUNTED"}
                    </span>
                  ) : (
                    labUsd(entry.value_usd, usdDecimals)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LabRunBookCollateral({ engine }: { engine: LabRunBookEngine }) {
  return (
    <section
      className={styles.subPanel}
      data-testid="runbook-collateral"
      data-engine={engine.engine}
      aria-label={`collateral by asset before and after for ${engine.engine}`}
    >
      <p className={styles.panelTitle}>Collateral by asset · per side</p>
      <div className={styles.histPair}>
        <CollateralSide
          aggregate={engine.before}
          side="before"
          usdDecimals={engine.usd_decimals}
        />
        <CollateralSide aggregate={engine.after} side="after" usdDecimals={engine.usd_decimals} />
      </div>
    </section>
  );
}
