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
import { EM_DASH, renderNullableDecimal, truncateAddress } from "@/lib/format";
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
  FLIP_METHOD,
  flipCellLabel,
  flipRanking,
  flipRefusedAsideLine,
  flipTakeaway,
  flipUnbarrableLine,
} from "./flipRanking";
import {
  DUMBBELL_METHOD,
  dumbbellCensusLine,
  dumbbellPosition,
  dumbbellUnplottableLine,
  dumbbellWindowLine,
  moverDumbbells,
  moverPopulationLine,
} from "./moverDumbbells";
import {
  collateralDisclosure,
  collateralReadingLine,
  collateralRowKey,
  histogramShiftReadingLine,
  moversDisclosure,
} from "./labRunBookLines";
import {
  COLLATERAL_DISCLOSURE_METHOD,
  MOVERS_FORENSICS_SUMMARY,
  MOVERS_METHOD,
  collateralGroupAnswer,
  runbookHistogramForensicsSummary,
  runbookHistogramMethod,
} from "./labPanelLines";
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

// VIEW 4 (mover dumbbells) — authored geometry, RENDERED CSS px (LAW-3): the
// frame scrolls below this width rather than scaling 12px text down.
const DUMB_LABEL_W = 110;
const DUMB_PLOT_W = 380;
const DUMB_ROW_H = 26;
const DUMB_AXIS_H = 26;
const DUMB_PAD = 8;
const DUMB_R = 4;

// VIEW 5 (flip ranking) — authored geometry, RENDERED CSS px (LAW-3).
const FLIP_STRIP_W = 380;
const FLIP_STRIP_H = 12;
const FLIP_LABEL_W = 110;
const FLIP_BAR_MAX = 240;
const FLIP_MONEY_W = 130;
const FLIP_ROW_H = 20;

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
      {/* ---- SLOT 2: this side's STATE. The accounting counts MOVED UP from
              under the chart (R6): a no-comparator population and an
              unknowable both change what these shares mean, so neither may be
              read after the shape. Both stay outside every disclosure. ---- */}
      <div className={styles.stateSlot} data-testid={`runbook-hist-state-${side}`}>
        <span data-testid={`runbook-hist-denominator-${side}`}>
          {riskBandDenominatorLine(denominator)}
        </span>
        <span data-testid={`runbook-hist-no-debt-${side}`}>
          {riskBandNoDebtRow(histogram.infinite_count)} · counted here, outside the denominator
        </span>
        <span data-testid={`runbook-hist-refused-${side}`}>
          {riskBandRefusedRow(histogram.refused_count)} · rows counted here, never dropped
        </span>
      </div>
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
      {/* ---- SLOT 3: ANSWER — the computed shift, with its own limits ---- */}
      <p className={styles.answerLine} data-testid="runbook-hist-reading">
        {histogramShiftReadingLine(engine)}
      </p>
      {/* ---- SLOT 4 + 5: VISUAL + LEDGER — exact counts beside each bar ---- */}
      <div className={styles.histPair}>
        <Distribution aggregate={engine.before} side="before" engine={engine.engine} />
        <Distribution aggregate={engine.after} side="after" engine={engine.engine} />
      </div>
      {/* ---- SLOT 6: METHOD — the shared scale and the tint asymmetry, both
              stated ON THE PAGE rather than in a source comment ---- */}
      <p className={styles.methodLine} data-testid="runbook-hist-method">
        {runbookHistogramMethod(engine.before.hf_histogram.comparator, RISK_BAND_METHOD)}
      </p>
      {/* ---- SLOT 7: FORENSICS — the wire note and the bucket boundaries.
              It holds no count that exists nowhere else (R3). ---- */}
      <details className={styles.disclosure} data-testid="runbook-hist-forensics">
        <summary>
          {runbookHistogramForensicsSummary(engine.after.hf_histogram.buckets.length)}
        </summary>
        <p className={styles.noteText} data-testid="runbook-hist-wire-note">
          {engine.after.hf_histogram.note}
        </p>
        <ul data-testid="runbook-hist-bounds">
          {engine.after.hf_histogram.buckets.map((bucket) => (
            <li key={bucket.label}>
              {bucket.label} · upper bound{" "}
              {bucket.upper_wad === null ? "unbounded" : bucket.upper_wad}
            </li>
          ))}
        </ul>
      </details>
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

// ---------------------------------------------------------------------------
// B2b — VIEW 4: the mover dumbbells (Aave arm only)
//
// The chart is a WINDOW onto the histogram census above it, and it says so in
// a visible STATE line before any dot is drawn (R6/R7). Geometry comes from
// `moverDumbbells`, where every below-1.00 verdict is a bigint compare against
// the wad scale; the ONLY float here is the log pixel position (LAW-4). The
// movers table below is this chart's LEDGER — same rows, same order, exact
// unrounded wads — so no number exists only in a hover title (LAW-5).

function LabMoverDumbbells({ engine }: { engine: LabRunBookEngine }) {
  const model = moverDumbbells(engine);
  if (model.kind === "not-wad") return null;
  // r88: a wire contradiction REFUSES the chart visibly — obeying a drifted
  // scale would relabel accounts against a false 1.00, and ignoring it would
  // draw a chart over a response that contradicts the chart's own law.
  if (model.kind === "refused") {
    return (
      <div className={styles.stateSlot} data-testid="dumbbell-state">
        <span className={styles.dumbbellContradiction} data-testid="dumbbell-scale-refused">
          {model.reason}
        </span>
      </div>
    );
  }
  // r88: a zero-mover run still surfaces its census contradiction — the
  // "nothing moved" sentence above rides the same response, and it may not
  // stand unqualified over served numbers that disagree with themselves.
  if (model.kind === "none") {
    if (model.censusContradiction === null) return null;
    return (
      <div className={styles.stateSlot} data-testid="dumbbell-state">
        <span className={styles.dumbbellContradiction} data-testid="dumbbell-census-contradiction">
          {model.censusContradiction}
        </span>
      </div>
    );
  }

  const plotLeft = DUMB_LABEL_W + 6;
  const width = plotLeft + DUMB_PLOT_W + 16;
  const plotBottom = model.rows.length * DUMB_ROW_H + 4;
  const height = plotBottom + DUMB_AXIS_H;
  const xOf = (wad: string) =>
    plotLeft +
    DUMB_PAD +
    Math.round(
      dumbbellPosition(wad, model.domainMinWad, model.domainMaxWad) * (DUMB_PLOT_W - 2 * DUMB_PAD),
    );
  const xBoundary = xOf(model.scaleWad);
  // Tint only territory the chart actually draws below 1.00 — when the whole
  // domain sits at or above the boundary there is no such territory, and an
  // 8px inset painted crit would claim one.
  const drawsBelowBoundary = BigInt(model.domainMinWad) < BigInt(model.scaleWad);
  const windowLine = dumbbellWindowLine(model);
  const hf = (wad: string) => renderNullableDecimal(wad, { decimals: 18 });

  return (
    <div data-testid="runbook-dumbbell-block">
      {/* ---- SLOT 2: STATE — what the window sits inside, BEFORE the picture
              (R6). The census line may not collapse (R7); a contradiction in
              the served census replaces it and is never smoothed over. ---- */}
      <div className={styles.stateSlot} data-testid="dumbbell-state">
        {model.censusContradiction !== null ? (
          <span className={styles.dumbbellContradiction} data-testid="dumbbell-census-contradiction">
            {model.censusContradiction}
          </span>
        ) : (
          <span data-testid="dumbbell-census">{dumbbellCensusLine(model.census)}</span>
        )}
        {model.unplottable.length > 0 && (
          <span data-testid="dumbbell-unplottable">
            {dumbbellUnplottableLine(model.unplottable.length)}
          </span>
        )}
        {windowLine !== null && <span data-testid="dumbbell-window-note">{windowLine}</span>}
      </div>
      {model.rows.length > 0 && (
        <div className={styles.chartScroll} data-testid="dumbbell-frame">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-label={`before-to-after health factor per shown mover on ${engine.engine}, log axis, liquidation boundary at 1.00`}
            style={{ display: "block" }}
            data-testid="runbook-dumbbells"
          >
            {drawsBelowBoundary && (
              <rect
                className={styles.dumbbellRegion}
                data-testid="dumbbell-eligible-region"
                x={plotLeft}
                y={2}
                width={Math.max(0, xBoundary - plotLeft)}
                height={plotBottom - 2}
              >
                <title>liquidatable territory: the pool liquidates strictly below 1.00 on the wad</title>
              </rect>
            )}
            {model.ticks.map((tick) => {
              const x = xOf(tick.wad);
              return (
                <g key={tick.wad} data-testid="dumbbell-tick" data-boundary={String(tick.boundary)}>
                  <line
                    className={tick.boundary ? styles.dumbbellBoundary : styles.histBaseline}
                    data-testid={tick.boundary ? "dumbbell-boundary" : undefined}
                    x1={x}
                    x2={x}
                    y1={2}
                    y2={plotBottom}
                    opacity={tick.boundary ? 1 : 0.35}
                  />
                  <text
                    className={tick.boundary ? styles.dumbbellBoundaryLabel : styles.histAxisLabel}
                    x={x}
                    y={plotBottom + 14}
                    textAnchor="middle"
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}
            {model.rows.map((row, index) => {
              const y = index * DUMB_ROW_H + DUMB_ROW_H / 2 + 4;
              const xBefore = xOf(row.beforeWad);
              const xAfter = xOf(row.afterWad);
              return (
                <g
                  key={row.account}
                  data-testid="dumbbell-row"
                  data-account={row.account}
                  data-crossed={String(row.crossed)}
                >
                  <text className={styles.histLabel} x={DUMB_LABEL_W} y={y + 4} textAnchor="end">
                    {truncateAddress(row.account)}
                  </text>
                  <line
                    className={styles.dumbbellLine}
                    x1={xBefore}
                    x2={xAfter}
                    y1={y}
                    y2={y}
                  />
                  <circle
                    className={row.beforeBelowOne ? styles.dumbbellBeforeEligible : styles.dumbbellBefore}
                    data-testid="dumbbell-before"
                    data-below-one={String(row.beforeBelowOne)}
                    cx={xBefore}
                    cy={y}
                    r={DUMB_R}
                  />
                  <circle
                    className={row.afterBelowOne ? styles.dumbbellAfterEligible : styles.dumbbellAfter}
                    data-testid="dumbbell-after"
                    data-below-one={String(row.afterBelowOne)}
                    cx={xAfter}
                    cy={y}
                    r={DUMB_R}
                  >
                    <title>
                      {`${row.account}: ${hf(row.beforeWad)} before, ${hf(row.afterWad)} after, ` +
                        `drop ${hf(row.dropWad)} — exact wads in the table below`}
                    </title>
                  </circle>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {/* ---- SLOT 6: METHOD for the chart — the scale, the only float, and
              the strictly-below law, stated on the page. ---- */}
      <p className={styles.methodLine} data-testid="dumbbell-method">
        {DUMBBELL_METHOD}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B2c — VIEW 5: the Debt Manager flip ranking (DM arm only)
//
// The four-cell strip is the run's OWN partition — algebra on served counts,
// closing on before.accounts exactly — with the refused rows as a NAMED ASIDE
// beside it (critic Finding 2: the wire sums two populations under
// refused_count, so a fifth cell would double-count). The bars are the served
// largest-debt window onto the flips; nothing sums them, and the takeaway
// says why. The movers table below stays this view's LEDGER.

function LabFlipRanking({ engine }: { engine: LabRunBookEngine }) {
  const model = flipRanking(engine);
  if (model.kind === "not-dm" || model.kind === "none") return null;
  if (model.kind === "refused") {
    return (
      <div className={styles.stateSlot} data-testid="dumbbell-state">
        <span className={styles.dumbbellContradiction} data-testid="flip-refused">
          {model.reason}
        </span>
      </div>
    );
  }

  const { cells } = model;
  const segments = [
    { key: "flipsToEligible", count: cells.flipsToEligible, cls: styles.flipCellEligible },
    { key: "flipsToHealthy", count: cells.flipsToHealthy, cls: styles.flipCellBack },
    { key: "stayedEligible", count: cells.stayedEligible, cls: styles.flipCellStayedElig },
    { key: "stayedNotEligible", count: cells.stayedNotEligible, cls: styles.flipCellStayedOut },
  ] as const;
  // Cumulative whole-px edges (LAW-3): the strip closes to exactly its
  // authored width, with no rounding residue invented or lost.
  let runningCount = 0;
  const placed = segments.map((segment) => {
    const x0 = Math.round((runningCount / cells.total) * FLIP_STRIP_W);
    runningCount += segment.count;
    const x1 = Math.round((runningCount / cells.total) * FLIP_STRIP_W);
    return { ...segment, x: x0, width: x1 - x0 };
  });
  const maxDebt = BigInt(model.maxDebtUsd);
  // Whole-px bar widths by integer division — the ONLY rounding is the floor,
  // and a nonzero flip too small for a pixel keeps a presence dot (CX-6).
  const barWidth = (debtUsd: string) =>
    maxDebt === 0n ? 0 : Number((BigInt(debtUsd) * BigInt(FLIP_BAR_MAX)) / maxDebt);
  const barsWidth = FLIP_LABEL_W + FLIP_BAR_MAX + FLIP_MONEY_W + 24;
  const barsHeight = model.bars.length * FLIP_ROW_H + 8;

  return (
    <div data-testid="runbook-flip-block">
      {/* ---- SLOT 3 (supplement): the flip story in one sentence, with the
              unserved total NAMED rather than implied. ---- */}
      <p className={styles.answerLine} data-testid="flip-takeaway">
        {flipTakeaway(model)}
      </p>
      {/* ---- SLOT 2: STATE — the partition, its legend, and every aside,
              BEFORE the bars (R6/R7). ---- */}
      <div className={styles.stateSlot} data-testid="flip-state">
        {/* LAW-3: the strip is authored geometry and scrolls in its own
            frame below its width — the PAGE never scrolls sideways for it. */}
        <div className={styles.chartScroll} data-testid="flip-strip-frame">
        <svg
          width={FLIP_STRIP_W}
          height={FLIP_STRIP_H}
          viewBox={`0 0 ${String(FLIP_STRIP_W)} ${String(FLIP_STRIP_H)}`}
          role="img"
          aria-label={`flip partition of ${String(cells.total)} accounts on ${engine.engine}`}
          style={{ display: "block" }}
          data-testid="flip-strip"
        >
          {/* r91 finding 3: rectangles first, presence dots AFTER — SVG
              paints later elements on top, so a full-height neighbor can no
              longer erase a dot; coincident dots step right until distinct. */}
          {placed.map(
            (segment) =>
              segment.width > 0 && (
                <rect
                  key={segment.key}
                  className={segment.cls}
                  data-testid="flip-cell"
                  data-cell={segment.key}
                  data-count={String(segment.count)}
                  x={segment.x}
                  y={0}
                  width={segment.width}
                  height={FLIP_STRIP_H}
                />
              ),
          )}
          {(() => {
            const usedX: number[] = [];
            return placed.map((segment) => {
              if (segment.width > 0 || segment.count === 0) return null;
              // r92: the search alternates right/left and never leaves the
              // strip — a dot painted outside the viewBox is a hidden cell.
              const base = Math.min(Math.max(segment.x, 2), FLIP_STRIP_W - 2);
              const inBounds = (x: number) => x >= 2 && x <= FLIP_STRIP_W - 2;
              const collides = (x: number) => usedX.some((used) => Math.abs(used - x) < 5);
              let cx = base;
              let offset = 0;
              while (!inBounds(cx) || collides(cx)) {
                offset = offset <= 0 ? -offset + 6 : -offset;
                cx = base + offset;
              }
              usedX.push(cx);
              return (
                // r90 F5 — PRESENCE, NOT SHARE: a positive cell whose share
                // rounds below one pixel keeps a dot, so the legend and the
                // picture never disagree about whether a population exists.
                <circle
                  key={segment.key}
                  className={`${segment.cls} ${styles.flipPresenceDot}`}
                  data-testid="flip-cell-presence"
                  data-cell={segment.key}
                  data-count={String(segment.count)}
                  cx={cx}
                  cy={FLIP_STRIP_H / 2}
                  r={PRESENCE_R}
                >
                  <title>
                    {`${String(segment.count)} accounts — a share too small to draw at one pixel ` +
                      `on this strip. This dot marks presence and carries no length.`}
                  </title>
                </circle>
              );
            });
          })()}
                  </svg>
        </div>
        <span data-testid="flip-legend">
          {segments
            .map((segment) => `${String(segment.count)} ${flipCellLabel(segment.key)}`)
            .join(" · ")}{" "}
          = {String(cells.total)} accounts
        </span>
        <span data-testid="flip-refused-aside">{flipRefusedAsideLine(model.refusedAside)}</span>
        {model.unbarrable.length > 0 && (
          <span data-testid="flip-unbarrable">{flipUnbarrableLine(model.unbarrable.length)}</span>
        )}
        {model.rankingContradiction !== null && (
          <span className={styles.dumbbellContradiction} data-testid="flip-ranking-contradiction">
            {model.rankingContradiction}
          </span>
        )}
      </div>
      {/* r90 F2: a window with an unlicensed verdict refuses the BARS,
              visibly — the ledger below still shows each row's own verdict. */}
      {model.barsRefused !== null && (
        <div className={styles.stateSlot}>
          <span className={styles.dumbbellContradiction} data-testid="flip-bars-refused">
            {model.barsRefused}
          </span>
        </div>
      )}
      {model.bars.length > 0 && (
        <div className={styles.chartScroll} data-testid="flip-frame">
          <svg
            width={barsWidth}
            height={barsHeight}
            viewBox={`0 0 ${String(barsWidth)} ${String(barsHeight)}`}
            role="img"
            aria-label={
              // r93: "largest first" is a claim about the SERVED order, and
              // it is made only while that order obeys its own rule.
              model.rankingContradiction === null
                ? `flipped debt per shown account on ${engine.engine}, largest first`
                : `flipped debt per shown account on ${engine.engine}, in served order — the ranking rule is contradicted, see the note above`
            }
            style={{ display: "block" }}
            data-testid="flip-bars"
          >
            {model.bars.map((bar, index) => {
              const y = index * FLIP_ROW_H + 4;
              const width = barWidth(bar.debtUsd);
              const subPixel = BigInt(bar.debtUsd) > 0n && width < PRESENCE_MIN;
              return (
                <g key={bar.account} data-testid="flip-bar-row" data-account={bar.account}>
                  <text
                    className={styles.histLabel}
                    x={FLIP_LABEL_W}
                    y={y + 10}
                    textAnchor="end"
                  >
                    {truncateAddress(bar.account)}
                  </text>
                  {width > 0 && (
                    <rect
                      className={styles.flipBar}
                      data-testid="flip-bar"
                      x={FLIP_LABEL_W + 6}
                      y={y + 2}
                      width={width}
                      height={FLIP_ROW_H - 8}
                    />
                  )}
                  {subPixel && (
                    <circle
                      className={styles.histPresence}
                      data-testid="flip-presence"
                      cx={FLIP_LABEL_W + 6 + PRESENCE_R}
                      cy={y + 2 + (FLIP_ROW_H - 8) / 2}
                      r={PRESENCE_R}
                    >
                      <title>
                        a flipped debt too small to draw at one pixel on this scale — the exact
                        figure is beside the bar and in the table below
                      </title>
                    </circle>
                  )}
                  <text
                    className={styles.histCount}
                    x={FLIP_LABEL_W + 12 + FLIP_BAR_MAX}
                    y={y + 10}
                    data-testid="flip-money"
                  >
                    {labUsd(bar.debtUsd, engine.usd_decimals)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {/* ---- SLOT 6: METHOD for the bars. ---- */}
      <p className={styles.methodLine} data-testid="flip-method">
        {FLIP_METHOD}
      </p>
    </div>
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
      {/* ---- SLOT 1: HEAD ---- */}
      <p className={styles.panelTitle}>Accounts this scenario moved</p>
      {/* ---- SLOT 3: ANSWER — carries the TRUNCATION COUNT. That count
              staying here is the precondition for the wire note collapsing
              below: a silent cap is the defect the note exists to prevent. ---- */}
      <p className={styles.answerLine} data-testid="runbook-movers-disclosure">
        {moversDisclosure(engine)}
      </p>
      {/* ---- Finding 8 (views spec): on Aave the count above is MOVEMENT,
              not danger, and the pool serves no crossed-1.00 count. That
              sentence rides the ANSWER, visible whether or not the chart
              below can draw. ---- */}
      {isWadEngine && engine.movers_total > 0 && (
        <p className={styles.answerLine} data-testid="dumbbell-population">
          {moverPopulationLine(engine.movers_total)}
        </p>
      )}
      {/* ---- SLOT 4: VISUAL — VIEW 4's dumbbells; the table below stays as
              this chart's LEDGER, exact and unrounded. ---- */}
      {isWadEngine && <LabMoverDumbbells engine={engine} />}
      {/* ---- SLOT 4: VISUAL — VIEW 5's partition strip + flip bars on the
              Debt Manager arm; the table below stays the LEDGER. ---- */}
      {!isWadEngine && <LabFlipRanking engine={engine} />}
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
      {/* ---- SLOT 6: METHOD ---- */}
      <p className={styles.methodLine} data-testid="runbook-movers-method">
        {MOVERS_METHOD}
      </p>
      {/* ---- SLOT 7: FORENSICS — the server's own statement of its ranking
              rule AND its truncation, VERBATIM. This is legal ONLY because
              the truncation count is in the ANSWER above; if that count ever
              leaves the visible line, this note comes back out with it. ---- */}
      <details className={styles.disclosure} data-testid="runbook-movers-forensics">
        <summary>{MOVERS_FORENSICS_SUMMARY}</summary>
        <p className={styles.noteText} data-testid="runbook-movers-note">
          {engine.movers_note}
        </p>
      </details>
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
      {/* This side's own computed reading, open. A side carrying an UNPRICED
          or NOT COUNTED row may not collapse, and neither side does. */}
      <p className={styles.answerLine} data-testid={`runbook-collateral-reading-${side}`}>
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
            {aggregate.collateral_by_asset.map((entry) => {
              const disclosure = collateralDisclosure(entry);
              return (
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
                data-disclosure={disclosure}
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
                  {disclosure === "counted" && entry.value_usd !== null ? (
                    labUsd(entry.value_usd, usdDecimals)
                  ) : (
                    // THE REFUSAL REGISTER. A balance the engine counted no
                    // value for renders as a named absence, never as $0 — and
                    // a CONTRADICTORY row (r89: a served value beside the
                    // no-price-witness flag) renders here too, because a
                    // number the row itself disputes is never read as money.
                    <span
                      className={styles.unpricedTag}
                      data-testid="runbook-collateral-unpriced"
                      title={entry.note}
                    >
                      {disclosure === "unpriced"
                        ? "UNPRICED · no price witness"
                        : disclosure === "not-counted"
                          ? "NOT COUNTED"
                          : "CONTRADICTORY · value + no-price flag; not counted"}
                    </span>
                  )}
                </td>
              </tr>
              );
            })}
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
      {/* ---- SLOT 1: HEAD ---- */}
      <p className={styles.panelTitle}>Collateral by asset · per side</p>
      {/* ---- SLOT 3: ANSWER — across both sides, carrying the COUNT of
              holdings with no price witness (hazard). ---- */}
      <p className={styles.answerLine} data-testid="runbook-collateral-answer">
        {collateralGroupAnswer(engine)}
      </p>
      {/* ---- SLOT 4 + 5: VISUAL + LEDGER ----
          W-3L RULING, AGAINST THE INVENTORY. The inventory offered the side a
          reader is not comparing as collapsible, gated on that side having
          zero UNPRICED / NOT COUNTED rows. Both sides stay open: the gate is
          data-dependent, so the panel's shape would change under the reader
          between two runs of the same scenario, and a refusal register that
          appears and disappears teaches nothing. Nothing here is collapsed. */}
      <div className={styles.histPair}>
        <CollateralSide
          aggregate={engine.before}
          side="before"
          usdDecimals={engine.usd_decimals}
        />
        <CollateralSide aggregate={engine.after} side="after" usdDecimals={engine.usd_decimals} />
      </div>
      {/* ---- SLOT 6: METHOD — the three disclosure kinds, named ---- */}
      <p className={styles.methodLine} data-testid="runbook-collateral-method">
        {COLLATERAL_DISCLOSURE_METHOD}
      </p>
    </section>
  );
}
