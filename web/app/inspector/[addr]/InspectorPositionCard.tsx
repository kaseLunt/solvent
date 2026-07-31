"use client";

// One position, every number defended (spec §3.2; canon: the Inspector's
// split grid — position card + proof card + the formula block).
//
// Laws enforced here:
//   - the formula block is ENGINE-CORRECT: Aave shows the rev-3 HF law with
//     THIS position's numbers substituted; the Debt Manager shows its strict
//     comparator (debt > maxBorrowLT) — never a shared formula;
//   - a stale/missing price verdict renders as ITS OWN state (a chip), never
//     hidden behind a formatted value;
//   - every number opens the evidence drawer (typed descriptors);
//   - warn renders WITH its disclosure ("presentation band — not an engine
//     threshold");
//   - refused positions stay visible, named, em-dashed — never dropped.

import { Fragment } from "react";
import {
  positionVerdict,
  type Batch,
  type PriceInput,
  type RefinedLeg,
  type RefinedPosition,
} from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { AddressMono } from "@/components/AddressMono";
import { RefusedTag } from "@/components/RefusedTag";
import { SeverityHF } from "@/components/SeverityHF";
import { MarksStamp, type Mark } from "@/components/MarksStamp";
import {
  dmComparandEvidence,
  hfEvidence,
  legEvidence,
  liquidationPriceEvidence,
  positionNumberEvidence,
  priceInputEvidence,
  priceVerdictTone,
  totalEvidence,
  type EvidenceDescriptor,
} from "@/lib/evidence";
import { displayHf, displayRatio } from "@/lib/history-series";
import { EM_DASH, formatBlock, renderNullableDecimal, truncateAddress } from "@/lib/format";
import { hfSeverity } from "@/lib/severity";
import type { ChainEvent, ParamChange } from "@/lib/inspector-data";
import { ExplainButton } from "./EvidenceDrawer";
import styles from "../inspector.module.css";

const WARN_DISCLOSURE = "warn band <1.1 — presentation band, not an engine threshold";

export interface InspectorPositionCardProps {
  position: RefinedPosition;
  batch: Batch;
  /** Param-timeline rows for this engine (provenance), or null when the timeline is unavailable. */
  paramChanges: ParamChange[] | null;
  /** Why the param timeline is unavailable, when it is. */
  paramsError: string | null;
  /** The loaded window of this account's own events (collateral-flag witness). */
  activity: readonly ChainEvent[];
  onExplain: (descriptor: EvidenceDescriptor) => void;
}

function verdictChipClass(verdict: string): string {
  if (verdict === "fresh") return `${styles.verdict} ${styles.verdictOk}`;
  if (verdict === "stale" || verdict === "over-ceiling" || verdict === "no-as-of") {
    return `${styles.verdict} ${styles.verdictWarn}`;
  }
  return `${styles.verdict} ${styles.verdictCrit}`;
}

function legLabel(leg: RefinedLeg): string {
  return leg.symbol ?? truncateAddress(leg.asset);
}

/** The newest param-timeline row speaking to this asset (rows arrive DESC). */
function provenanceFor(changes: ParamChange[], engine: string, asset: string | null): ParamChange | null {
  for (const change of changes) {
    if (change.engine !== engine) continue;
    if (asset === null ? change.asset === null : change.asset?.toLowerCase() === asset.toLowerCase()) {
      return change;
    }
  }
  return null;
}

/** The newest collateral-usage toggle witnessed for this asset in the loaded activity window. */
function collateralWitness(activity: readonly ChainEvent[], asset: string): ChainEvent | null {
  for (const event of activity) {
    if (
      (event.type === "collateral_enabled" || event.type === "collateral_disabled") &&
      event.asset?.toLowerCase() === asset.toLowerCase()
    ) {
      return event;
    }
  }
  return null;
}

function aaveFormula(position: RefinedPosition): string {
  const hf = position.health_factor;
  const num = hf?.num ?? position.weighted_lt_sum ?? EM_DASH;
  const den = hf?.den ?? position.total_debt_base ?? EM_DASH;
  const wad = hf === null ? null : hf.wad;
  const result =
    position.status === "refused"
      ? `REFUSED · ${position.refusal?.code ?? "unnamed"} — no number is served`
      : hf?.infinite === true
        ? "∞  // no debt — the ratio is unbounded"
        : wad === null
          ? `${EM_DASH}  // not published`
          : `${wad} wad  // wadDiv half-up composite — rev-3, deployed-source-proven`;
  return (
    `HF = floor( floor( (Σ(Cᵢ · LT_bpsᵢ) × 1e18 + ⌊D/2⌋) / D ) / 10⁴ )\n` +
    `   Σ(Cᵢ · LT_bpsᵢ) = ${num}\n` +
    `   D = ${den}   // debt never understated — ceil per leg\n` +
    `   = ${result}`
  );
}

function dmFormula(position: RefinedPosition): string {
  const verdict =
    position.status === "refused"
      ? `REFUSED · ${position.refusal?.code ?? "unnamed"} — no verdict is served`
      : position.liquidation_verdict;
  return (
    `liquidatable ⇔ debt > maxBorrowLT   // STRICT boolean — equality is HEALTHY\n` +
    `   debt        = ${position.borrowings ?? EM_DASH}\n` +
    `   maxBorrowLT = ${position.max_borrow_lt ?? EM_DASH}\n` +
    `   ⇒ ${verdict}`
  );
}

export function InspectorPositionCard({
  position,
  batch,
  paramChanges,
  paramsError,
  activity,
  onExplain,
}: InspectorPositionCardProps) {
  const isDm = position.engine === "debt_manager";
  const hf = position.health_factor;
  const ratio = hf === null ? null : displayRatio(hf);
  const hfDisplay = hf === null ? null : displayHf(hf);
  // The engine's OWN comparator, via the client's sanctioned helper: the DM's
  // strict boolean, or Aave's wad < 1e18 ON THE WAD. Never a re-derived float.
  const verdict = positionVerdict(position);
  const severity = hfSeverity({ verdict, ratio, infinite: hf?.infinite ?? false });

  const stamp = batch.watermarks.find((w) => w.engine === position.engine);
  const unackedEpochs = stamp === undefined ? null : stamp.max_epoch_at_compute - stamp.acked_epoch;
  const provenances = [...new Set(position.price_inputs.map((input) => input.provenance))];
  const sources = [...new Set(position.price_inputs.map((input) => input.source.split(":")[0] ?? input.source))];

  const marks: Mark[] = [
    { letter: "B", block: position.as_of.balances_block },
    { letter: "P", block: position.as_of.params_block },
    ...(isDm ? [{ letter: "S", block: position.as_of.sweep_block > 0 ? position.as_of.sweep_block : null }] : []),
  ];

  const symbolForAsset = (asset: string): string => {
    const leg = position.legs.find((l) => l.asset.toLowerCase() === asset.toLowerCase());
    return leg?.symbol ?? truncateAddress(asset);
  };

  const renderPriceRow = (input: PriceInput, index: number) => {
    const value = renderNullableDecimal(input.value, input.decimals === null ? {} : { decimals: input.decimals });
    return (
      <div className={styles.kvRow} key={`price·${input.source}·${String(index)}`}>
        <span className={styles.k}>{symbolForAsset(input.asset)} price</span>
        <span className={styles.v}>
          <ExplainButton
            label={`explain price input ${symbolForAsset(input.asset)}`}
            onExplain={() => {
              onExplain(priceInputEvidence(position, batch, input, value));
            }}
          >
            {value}
          </ExplainButton>
          {" · "}
          {input.provenance}
          {" · "}
          {input.source_as_of === null ? (
            <span className={styles.vWarn}>no chain-asserted as-of</span>
          ) : (
            `as-of ${input.source_as_of}`
          )}
          <span className={verdictChipClass(input.verdict)} data-testid="price-verdict">
            {input.verdict}
          </span>
        </span>
      </div>
    );
  };

  const renderLegRows = (leg: RefinedLeg) => {
    const label = legLabel(leg);
    const rows = [];
    const hasCollateral = leg.live_collateral !== null || leg.collateral_base !== null || leg.amount !== null;
    const hasDebt = leg.live_debt !== null || leg.debt_base !== null;
    if (hasCollateral) {
      const amountRaw = leg.live_collateral ?? leg.amount;
      const amount = renderNullableDecimal(amountRaw, { decimals: leg.decimals });
      const base = renderNullableDecimal(leg.collateral_base ?? leg.value_usd, {
        decimals: position.value_decimals,
      });
      rows.push(
        <div className={styles.kvRow} key={`${leg.asset}·collateral`}>
          <span className={styles.k}>{label} collateral leg</span>
          <span className={styles.v}>
            <ExplainButton
              label={`explain ${label} collateral leg`}
              onExplain={() => {
                onExplain(legEvidence(position, batch, leg, `${amount} ${label}`));
              }}
            >
              {amount} {label} · {base}
            </ExplainButton>{" "}
            <span className={styles.vDim}>
              {leg.collateral_index_block === null
                ? "· no leg as-of"
                : `· as-of block ${formatBlock(leg.collateral_index_block)}`}
            </span>
          </span>
        </div>,
      );
    }
    if (hasDebt) {
      const amount = renderNullableDecimal(leg.live_debt, { decimals: leg.decimals });
      const base = renderNullableDecimal(leg.debt_base, { decimals: position.value_decimals });
      rows.push(
        <div className={styles.kvRow} key={`${leg.asset}·debt`}>
          <span className={styles.k}>{label} debt leg</span>
          <span className={styles.v}>
            <ExplainButton
              label={`explain ${label} debt leg`}
              onExplain={() => {
                onExplain(legEvidence(position, batch, leg, `${amount} ${label}`));
              }}
            >
              {amount} {label} · {base}
            </ExplainButton>{" "}
            <span className={styles.vDim}>
              {leg.debt_index_block === null
                ? "· no leg as-of"
                : `· index as-of block ${formatBlock(leg.debt_index_block)}`}
            </span>
          </span>
        </div>,
      );
    }
    if (!hasCollateral && !hasDebt) {
      rows.push(
        <div className={styles.kvRow} key={`${leg.asset}·empty`}>
          <span className={styles.k}>{label} leg</span>
          <span className={`${styles.v} ${styles.vDim}`}>{EM_DASH} · no quantities established</span>
        </div>,
      );
    }
    return rows;
  };

  const renderParamRows = (leg: RefinedLeg) => {
    if (leg.liq_threshold === null && leg.liq_bonus === null) return null;
    const label = legLabel(leg);
    const provenance =
      paramChanges === null ? null : provenanceFor(paramChanges, position.engine, isDm ? null : leg.asset);
    return (
      <Fragment key={`${leg.asset}·params`}>
        <div className={styles.kvRow}>
          <span className={styles.k}>{label} params</span>
          <span className={styles.v}>
            {leg.liq_threshold === null ? EM_DASH : `LT ${leg.liq_threshold}`}
            {" · "}
            {leg.liq_bonus === null ? EM_DASH : `bonus ${leg.liq_bonus}`} <span className={styles.vDim}>bps</span>
          </span>
        </div>
        <div className={styles.kvRow}>
          <span className={styles.k}>{label} param provenance</span>
          {provenance !== null ? (
            <span className={`${styles.v} ${styles.vOk}`}>
              {provenance.source_event} @ ({formatBlock(provenance.effective_block)} · log{" "}
              {String(provenance.effective_log_index)})
            </span>
          ) : (
            <span className={`${styles.v} ${styles.vDim}`}>
              {paramChanges === null
                ? `param timeline unavailable${paramsError === null ? "" : ` — ${paramsError}`}`
                : "no timeline row served for this asset in the fetched window"}
            </span>
          )}
        </div>
      </Fragment>
    );
  };

  const renderCollateralFlagRows = () => {
    const flagged = position.legs.filter((leg) => leg.collateral_use !== "unknowable");
    if (flagged.length === 0) {
      return (
        <div className={styles.kvRow}>
          <span className={styles.k}>Collateral flag</span>
          <span className={`${styles.v} ${styles.vDim}`}>
            no usage-as-collateral statement published by this engine
          </span>
        </div>
      );
    }
    return flagged.map((leg) => {
      const witness = collateralWitness(activity, leg.asset);
      return (
        <div className={styles.kvRow} key={`${leg.asset}·flag`}>
          <span className={styles.k}>{legLabel(leg)} collateral flag</span>
          <span className={`${styles.v} ${leg.collateral_use === "counted" ? styles.vOk : styles.vDim}`}>
            {leg.collateral_use}
            {witness !== null ? (
              <>
                {" · witnessed "}
                {witness.type === "collateral_enabled" ? "Enabled" : "Disabled"} @{" "}
                {formatBlock(witness.block_number)}
              </>
            ) : (
              <span className={styles.vDim}> · witness not in the loaded activity window</span>
            )}
          </span>
        </div>
      );
    });
  };

  const renderLiquidationPriceRow = () => {
    const lp = position.liquidation_price;
    if (lp === null) {
      return (
        <div className={styles.kvRow}>
          <span className={styles.k}>Liquidation price</span>
          <span className={`${styles.v} ${styles.vDim}`}>not published for this position</span>
        </div>
      );
    }
    const first = lp.prices[0];
    const value =
      first === undefined
        ? EM_DASH
        : renderNullableDecimal(first.lowest_healthy_price, { decimals: first.price_decimals });
    return (
      <div className={styles.kvRow}>
        <span className={styles.k}>Liquidation price</span>
        <span className={styles.v}>
          <ExplainButton
            label="explain liquidation price"
            onExplain={() => {
              onExplain(liquidationPriceEvidence(position, batch, value));
            }}
          >
            {value}
          </ExplainButton>{" "}
          <span className={styles.vDim}>
            · lowest healthy — ceil(P*): still healthy at exactly this price
          </span>
          {lp.diagnostic && <span className={`${styles.verdict} ${styles.verdictWarn}`}>diagnostic</span>}
          {lp.already_breached && <span className={`${styles.verdict} ${styles.verdictCrit}`}>already breached</span>}
          {lp.never_liquidatable && <span className={`${styles.verdict} ${styles.verdictOk}`}>never liquidatable</span>}
        </span>
      </div>
    );
  };

  return (
    <div className={styles.positionBlock} data-testid={`position-${position.engine}`}>
      <div className={styles.split}>
        {/* -------- position card -------- */}
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>
            Position · <EngineChip engine={position.engine} /> <AddressMono address={position.account} copy={false} />
            {position.status === "refused" && <RefusedTag reason={position.refusal?.code ?? "unnamed"} />}
          </h4>
          <div className={styles.kv}>
            {/* verdict / HF */}
            {isDm ? (
              <>
                <div className={styles.kvRow}>
                  <span className={styles.k}>Liquidatable (strict)</span>
                  <span className={styles.v}>
                    <SeverityHF verdict={verdict} display={verdict} />
                  </span>
                </div>
                <div className={styles.kvRow}>
                  <span className={styles.k}>Debt (borrowings)</span>
                  <span className={styles.v}>
                    <ExplainButton
                      label="explain debt borrowings"
                      onExplain={() => {
                        onExplain(
                          dmComparandEvidence(
                            position,
                            batch,
                            "borrowings",
                            renderNullableDecimal(position.borrowings, { decimals: position.value_decimals, prefix: "$" }),
                          ),
                        );
                      }}
                    >
                      {renderNullableDecimal(position.borrowings, { decimals: position.value_decimals, prefix: "$" })}
                    </ExplainButton>
                  </span>
                </div>
                <div className={styles.kvRow}>
                  <span className={styles.k}>maxBorrowLT</span>
                  <span className={styles.v}>
                    <ExplainButton
                      label="explain max borrow lt"
                      onExplain={() => {
                        onExplain(
                          dmComparandEvidence(
                            position,
                            batch,
                            "max_borrow_lt",
                            renderNullableDecimal(position.max_borrow_lt, { decimals: position.value_decimals, prefix: "$" }),
                          ),
                        );
                      }}
                    >
                      {renderNullableDecimal(position.max_borrow_lt, { decimals: position.value_decimals, prefix: "$" })}
                    </ExplainButton>
                  </span>
                </div>
              </>
            ) : (
              <div className={styles.kvRow}>
                <span className={styles.k}>Health factor</span>
                <span className={styles.v}>
                  <ExplainButton
                    label="explain health factor"
                    onExplain={() => {
                      onExplain(hfEvidence(position, batch, hfDisplay ?? EM_DASH));
                    }}
                  >
                    <SeverityHF
                      verdict={verdict}
                      display={hfDisplay}
                      ratio={ratio}
                      infinite={hf?.infinite ?? false}
                    />
                  </ExplainButton>
                  {severity === "warn" && (
                    <>
                      {" "}
                      <span className={styles.disclosure} data-testid="warn-band-disclosure">
                        {WARN_DISCLOSURE}
                      </span>
                    </>
                  )}
                </span>
              </div>
            )}

            {/* totals */}
            <div className={styles.kvRow}>
              <span className={styles.k}>Total collateral</span>
              <span className={styles.v}>
                <ExplainButton
                  label="explain total collateral"
                  onExplain={() => {
                    onExplain(
                      totalEvidence(
                        position,
                        batch,
                        "collateral",
                        renderNullableDecimal(position.total_collateral_base, { decimals: position.value_decimals }),
                      ),
                    );
                  }}
                >
                  {renderNullableDecimal(position.total_collateral_base, { decimals: position.value_decimals })}
                </ExplainButton>{" "}
                <span className={styles.vDim}>· {String(position.value_decimals)}-dec, engine&apos;s own unit</span>
              </span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Total debt</span>
              <span className={styles.v}>
                <ExplainButton
                  label="explain total debt"
                  onExplain={() => {
                    onExplain(
                      totalEvidence(
                        position,
                        batch,
                        "debt",
                        renderNullableDecimal(position.total_debt_base, { decimals: position.value_decimals }),
                      ),
                    );
                  }}
                >
                  {renderNullableDecimal(position.total_debt_base, { decimals: position.value_decimals })}
                </ExplainButton>
              </span>
            </div>

            {/* legs, prices, params, flags, liquidation price */}
            {position.legs.map((leg) => renderLegRows(leg))}
            {position.price_inputs.map((input, index) => renderPriceRow(input, index))}
            {position.legs.map((leg) => renderParamRows(leg))}
            {renderCollateralFlagRows()}
            {renderLiquidationPriceRow()}
          </div>

          {/* -------- the formula block: the engine's OWN law, this position's numbers -------- */}
          <pre className={styles.formula} data-testid="formula-block">
            {isDm ? dmFormula(position) : aaveFormula(position)}
          </pre>
        </div>

        {/* -------- proof card -------- */}
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>Proof of inputs</h4>
          <div className={styles.kv}>
            <div className={styles.kvRow}>
              <span className={styles.k}>Marks</span>
              <span className={styles.v}>
                <MarksStamp marks={marks} />
              </span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Balances mark</span>
              <span className={`${styles.v} ${styles.vOk}`}>✓ {formatBlock(position.as_of.balances_block)}</span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Params mark</span>
              <span className={`${styles.v} ${styles.vOk}`}>✓ {formatBlock(position.as_of.params_block)}</span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Sweep mark</span>
              {isDm ? (
                position.as_of.sweep_block > 0 ? (
                  <span className={`${styles.v} ${styles.vOk}`}>✓ {formatBlock(position.as_of.sweep_block)}</span>
                ) : (
                  <span className={`${styles.v} ${styles.vCrit}`}>∅ never swept</span>
                )
              ) : (
                <span className={`${styles.v} ${styles.vDim}`}>n/a — engine has no sweeper</span>
              )}
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Price custody</span>
              <span className={styles.v}>
                <ExplainButton
                  label="explain price custody"
                  onExplain={() => {
                    onExplain(
                      positionNumberEvidence(position, batch, {
                        title: "EXPLAIN · PRICE CUSTODY",
                        subject: provenances.join(" · ") || "none",
                        rows: position.price_inputs.map((input) => ({
                          label: input.source,
                          value: `${input.provenance} · ${input.verdict}`,
                          tone: priceVerdictTone(input.verdict),
                        })),
                      }),
                    );
                  }}
                >
                  {provenances.length === 0 ? EM_DASH : provenances.join(" · ")}
                </ExplainButton>{" "}
                {sources.length > 0 && <span className={styles.vDim}>· {sources.join(" · ")}</span>}
              </span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Reorg epochs</span>
              {unackedEpochs === null ? (
                <span className={`${styles.v} ${styles.vCrit}`}>no watermark for this engine</span>
              ) : unackedEpochs <= 0 ? (
                <span className={`${styles.v} ${styles.vOk}`}>none unacked</span>
              ) : (
                <span className={`${styles.v} ${styles.vCrit}`}>{String(unackedEpochs)} unacked</span>
              )}
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Batch</span>
              <span className={styles.v}>{String(batch.id)}</span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.k}>Welds</span>
              <span className={`${styles.v} ${styles.vDim}`}>
                reconcile welds are published by /v1/evidence (Proof Center) — this view is LIVE ·
                WATERMARKED, not PROOF · EXACT @ PIN
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
