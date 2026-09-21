// Typed evidence descriptors — the data contract behind the
// explain-this-number drawer (spec §3.6, honest-UI law 7: every number
// resolves to "computed from these on-chain values at block N").
//
// The descriptor is deliberately DUMB and serializable: sections of labeled
// rows plus the engine's comparator statement and the operational-vs-proven
// marker. The Inspector builds descriptors from a position + its batch;
// Verification builds them from /v1/evidence and feeds the SAME drawer.
//
// Everything here quotes fields the API actually serves. The one field the
// canon shows that this surface does NOT serve — the materialization key —
// is rendered as exactly that statement (it is published by /v1/evidence),
// never invented.

import type { Batch, PriceInput, RefinedLeg, RefinedPosition, Stamp } from "@solvent/client";
import type { components } from "@solvent/client";
import { EM_DASH, formatBlock, renderNullableDecimal } from "./format";
import { readWirePopulation, readWireScale } from "./wireGuard";
import { classifyFactorPrice } from "./factorPriceGuard";
import { liqBonusEvidenceValue, paramPercent, paramScaleNote } from "./params-format";
import { noPricePathTitle } from "./liq-distance";
import { engineName } from "./inspector-headline";
import { groupInt } from "./prose";

export type EvidenceTone = "default" | "ok" | "warn" | "crit" | "dim";

export interface EvidenceRow {
  label: string;
  value: string;
  tone?: EvidenceTone;
}

export interface EvidenceSection {
  title: string;
  rows: EvidenceRow[];
}

export interface EvidenceDescriptor {
  /** Drawer heading, e.g. "EXPLAIN · HEALTH FACTOR". */
  title: string;
  /** The number as rendered on the surface that opened the drawer. */
  subject: string;
  /** The engine's comparator statement, verbatim — never a shared formula. */
  comparator: string;
  /** Operational (LIVE · WATERMARKED) vs proven (PROOF · EXACT @ PIN). */
  marker: "operational" | "proven";
  markerNote: string;
  sections: EvidenceSection[];
}

/** The engine-exact comparator statement. An unknown engine gets a refusal, not a guess. */
export function comparatorFor(engine: string): string {
  switch (engine) {
    case "aave_v3_etherfi":
      return (
        "aave_v3_etherfi: liquidatable ⇔ hf_wad < 1e18, STRICTLY, so equality is healthy. " +
        "Compared ON THE WAD the pool computed; never re-derived from a float."
      );
    case "debt_manager":
      return (
        "debt_manager: liquidatable ⇔ debt > maxBorrowLT, the engine's STRICT boolean; " +
        "equality is healthy. No continuous health factor exists on this engine."
      );
    default:
      return `comparator not known for engine "${engine}", and this surface is refusing to guess`;
  }
}

const PRICE_VERDICT_TONE: Record<string, EvidenceTone> = {
  fresh: "ok",
  stale: "warn",
  "over-ceiling": "warn",
  "no-as-of": "warn",
  missing: "crit",
  "reorg-unacked": "crit",
};

export function priceVerdictTone(verdict: string): EvidenceTone {
  return PRICE_VERDICT_TONE[verdict] ?? "crit";
}

function reorgPostureRow(stamp: Stamp | undefined): EvidenceRow {
  if (stamp === undefined) {
    return { label: "reorg posture", value: "no watermark for this engine on the batch", tone: "crit" };
  }
  // Both epoch stamps pass the population guard BEFORE the subtraction
  // whose result renders as the reorg disclosure.
  const maxEpoch = readWirePopulation(stamp.max_epoch_at_compute, "max_epoch_at_compute");
  const acked = readWirePopulation(stamp.acked_epoch, "acked_epoch");
  const unacked = maxEpoch - acked;
  return unacked <= 0
    ? { label: "reorg posture", value: "none unacked", tone: "ok" }
    : {
        label: "reorg posture",
        value: `${String(unacked)} unacked epoch(s) at compute · acked ${String(acked)} of ${String(maxEpoch)}`,
        tone: "crit",
      };
}

/** The shared evidentiary chain every position-number descriptor carries. */
function positionSections(position: RefinedPosition, batch: Batch): EvidenceSection[] {
  const stamp = batch.watermarks.find((w) => w.engine === position.engine);

  const batchSection: EvidenceSection = {
    title: "BATCH · MATERIALIZATION",
    rows: [
      { label: "batch", value: String(readWirePopulation(batch.id, "batch.id")) },
      { label: "computed_at", value: batch.computed_at },
      { label: "producer · status", value: `${batch.producer} · ${batch.status}` },
      ...(batch.supersession.superseded
        ? [{ label: "supersession", value: "SUPERSEDED · the flag is the contract", tone: "warn" as const }]
        : []),
      {
        label: "engine watermark",
        value:
          stamp === undefined
            ? "absent"
            : `chain ${String(readWirePopulation(stamp.chain_id, "chain_id"))} · last block ${formatBlock(stamp.last_block)}`,
        tone: stamp === undefined ? "crit" : "default",
      },
      reorgPostureRow(stamp),
      {
        label: "materialization key",
        value: "not served on this surface · published by /v1/evidence (Proof Center)",
        tone: "dim",
      },
    ],
  };

  const asOf = position.as_of;
  const asOfSection: EvidenceSection = {
    title: "INPUT AS-OFS",
    rows: [
      { label: "balances", value: `block ${formatBlock(asOf.balances_block)}`, tone: "ok" },
      { label: "params", value: `block ${formatBlock(asOf.params_block)}`, tone: "ok" },
      position.engine === "debt_manager"
        ? { label: "sweep", value: `block ${formatBlock(asOf.sweep_block)}`, tone: "ok" }
        : { label: "sweep", value: "n/a · engine has no sweeper", tone: "dim" },
      {
        label: "oldest price input",
        value: asOf.oldest_price_input ?? "none",
        tone: asOf.oldest_price_input === null ? "dim" : "default",
      },
      asOf.stale_price_inputs
        ? { label: "stale price inputs", value: "YES · flagged, and the flag propagates", tone: "warn" }
        : { label: "stale price inputs", value: "none", tone: "ok" },
    ],
  };

  const priceSection: EvidenceSection = {
    title: "PRICE INPUTS · PROVENANCE + BUDGET VERDICTS",
    rows:
      position.price_inputs.length === 0
        ? [{ label: "price inputs", value: "none on this position", tone: "dim" }]
        : position.price_inputs.map((input) => ({
            label: input.source,
            value:
              `${renderNullableDecimal(input.value, input.decimals === null ? {} : { decimals: input.decimals })}` +
              ` · ${input.provenance} · ${input.verdict}` +
              (input.source_as_of === null ? " · no chain-asserted as-of" : ` · as-of ${input.source_as_of}`),
            tone: priceVerdictTone(input.verdict),
          })),
  };

  const flagRows: EvidenceRow[] = [];
  if (position.refusal !== null) {
    flagRows.push({
      label: "refusal",
      value: `${position.refusal.code}: ${position.refusal.detail}`,
      tone: "crit",
    });
  }
  for (const flag of position.flags) {
    flagRows.push({ label: "flag", value: flag, tone: "warn" });
  }
  if (flagRows.length === 0) {
    flagRows.push({ label: "flags / refusals", value: "none", tone: "ok" });
  }

  return [batchSection, asOfSection, priceSection, { title: "FLAGS · REFUSALS", rows: flagRows }];
}

const OPERATIONAL_NOTE =
  "LIVE · WATERMARKED, served from the newest servable batch under its per-input watermark " +
  "vector. PROOF · EXACT @ PIN (reconcile-welded) is published by /v1/evidence, not asserted here.";

/** Assemble a full descriptor: the number's own rows + the shared position chain. */
export function positionNumberEvidence(
  position: RefinedPosition,
  batch: Batch,
  focus: { title: string; subject: string; rows: EvidenceRow[] },
): EvidenceDescriptor {
  return {
    title: focus.title,
    subject: focus.subject,
    comparator: comparatorFor(position.engine),
    marker: "operational",
    markerNote: OPERATIONAL_NOTE,
    sections: [{ title: "THIS NUMBER", rows: focus.rows }, ...positionSections(position, batch)],
  };
}

// ---------------------------------------------------------------------------
// Named builders for the Inspector's numbers.
// ---------------------------------------------------------------------------

export function hfEvidence(position: RefinedPosition, batch: Batch, subject: string): EvidenceDescriptor {
  const hf = position.health_factor;
  const rows: EvidenceRow[] =
    hf === null
      ? [{ label: "health factor", value: "not published (refused, or the engine has none)", tone: "dim" }]
      : [
          { label: "hf_wad (18-dec)", value: hf.wad ?? EM_DASH },
          { label: "numerator Σ(Cᵢ·LTᵢ)", value: hf.num ?? EM_DASH },
          { label: "denominator D (debt)", value: hf.den ?? EM_DASH },
          { label: "infinite", value: hf.infinite ? "true · no debt" : "false" },
          { label: "contract note", value: hf.note, tone: "dim" },
        ];
  return positionNumberEvidence(position, batch, { title: "EXPLAIN · HEALTH FACTOR", subject, rows });
}

export function totalEvidence(
  position: RefinedPosition,
  batch: Batch,
  which: "collateral" | "debt",
  subject: string,
): EvidenceDescriptor {
  // ENGINE-CORRECT SOURCE: `total_*_base` are Aave's
  // base-currency totals and are null on the Debt Manager, whose own totals
  // ride `collateral_value_usd` / `borrowings`. The drawer names the field it
  // actually read, so the card and its evidence can never disagree.
  const isDm = position.engine === "debt_manager";
  const field = isDm
    ? which === "collateral"
      ? "collateral_value_usd"
      : "borrowings"
    : `total_${which}_base`;
  const raw = isDm
    ? which === "collateral"
      ? position.collateral_value_usd
      : position.borrowings
    : which === "collateral"
      ? position.total_collateral_base
      : position.total_debt_base;
  return positionNumberEvidence(position, batch, {
    title: which === "collateral" ? "EXPLAIN · TOTAL COLLATERAL" : "EXPLAIN · TOTAL DEBT",
    subject,
    rows: [
      {
        label: `${field} (raw)`,
        value: raw ?? `${EM_DASH} (null, not established, and never rendered as 0)`,
        tone: raw === null ? "dim" : "default",
      },
      // A scale printed as its own caption passes the scale guard.
      { label: "value decimals", value: String(readWireScale(position.value_decimals, "value_decimals")) },
      {
        label: "unit",
        value:
          position.engine === "debt_manager"
            ? "USD, 6-dec (the engine's own unit)"
            : "Aave base currency, 8-dec (the engine's own unit)",
        tone: "dim",
      },
    ],
  });
}

export function dmComparandEvidence(
  position: RefinedPosition,
  batch: Batch,
  which: "borrowings" | "max_borrow_lt",
  subject: string,
): EvidenceDescriptor {
  const raw = which === "borrowings" ? position.borrowings : position.max_borrow_lt;
  return positionNumberEvidence(position, batch, {
    title: which === "borrowings" ? "EXPLAIN · DEBT (BORROWINGS)" : "EXPLAIN · MAX BORROW (LT)",
    subject,
    rows: [
      {
        label: which,
        value: raw ?? `${EM_DASH} (null, not established, and never rendered as 0)`,
        tone: raw === null ? "dim" : "default",
      },
      { label: "comparator side", value: which === "borrowings" ? "left (debt)" : "right (threshold)" },
      { label: "unit", value: "USD, 6-dec (the engine's own unit)", tone: "dim" },
    ],
  });
}

export function liquidationPriceEvidence(
  position: RefinedPosition,
  batch: Batch,
  subject: string,
): EvidenceDescriptor {
  const lp = position.liquidation_price;
  // P0-8 finding 1, consistency leg — the drawer obeys the same law as the
  // row: the ceil-health sentence is a positive health claim, and it renders
  // ONLY when a numeric boundary EXISTS on the wire (a served FactorPrice
  // whose `lowest_healthy_price` is non-null) AND the wire itself asserts
  // `boundary_is_healthy: true`. An absent boundary is stated as not
  // established (with the wire's reason); a declined one is named by its own
  // wire field.
  // P0-9 finding 3 — the API's solver-error path serializes `prices: null`
  // (a Go nil slice), violating the openapi required-array contract:
  // CONTRACT-VIOLATING but OBSERVED, and both the index below and the
  // `lp.prices.map` in the rows threw on it. The drawer folds a non-array
  // `prices` into the same absent-boundary arm the row uses — no rows to
  // list, boundary not established, the wire's `reason` still exposed.
  const servedPrices = lp !== null && Array.isArray(lp.prices) ? lp.prices : [];
  // CLASSIFY EVERY ENTRY BEFORE ANY READ, each independently. Unclassified,
  // `prices: [null]` throws a TypeError at the boundary check below, a
  // malformed decimal field throws parseDecimal inside renderNullableDecimal,
  // and an ABSENT price_decimals reaches the no-scale branch — the RAW scaled
  // integer rendered as a plausible drawer value (a silent wrong display, the
  // worst class).
  // PER-ENTRY INDEPENDENCE: a bad entry renders its OWN malformed row (by
  // index, nothing read off it) and never hides a good sibling; the BOUNDARY
  // claim reads prices[0], so a malformed first entry gets its own
  // unreadable arm — distinct from "not established", which states the solve
  // published nothing, where this states it published something nobody may
  // read.
  const classifiedPrices = servedPrices.map((entry) => classifyFactorPrice(entry));
  const first = classifiedPrices[0];
  const boundaryEstablished =
    first !== undefined && first.ok && first.entry.lowest_healthy_price !== null;
  const rows: EvidenceRow[] =
    lp === null
      ? [{ label: "health boundary price", value: "not published for this position", tone: "dim" }]
      : [
          ...classifiedPrices.map(
            (classified, index): EvidenceRow =>
              classified.ok
                ? {
                    label: `lowest_healthy_price · ${classified.entry.asset.slice(0, 10)}…`,
                    value:
                      `${renderNullableDecimal(classified.entry.lowest_healthy_price, { decimals: classified.entry.price_decimals })} ` +
                      `(current ${renderNullableDecimal(classified.entry.current_price, { decimals: classified.entry.price_decimals })})`,
                  }
                : {
                    label: `prices[${String(index)}]`,
                    value: `malformed — not read (fields: ${classified.fields.join(", ")})`,
                    tone: "warn" as const,
                  },
          ),
          ...(boundaryEstablished
            ? lp.boundary_is_healthy
              ? [
                  {
                    label: "ceil disclosure",
                    value:
                      "ceil(P*): at exactly this price the position is still HEALTHY, and liquidation begins strictly below it.",
                    tone: "dim" as const,
                  },
                ]
              : [
                  {
                    label: "ceil disclosure",
                    value:
                      "withheld — the wire does not certify health at exactly this boundary " +
                      "(boundary_is_healthy: false), so no exact-price health claim is made.",
                    tone: "warn" as const,
                  },
                ]
            : first !== undefined && !first.ok
              ? [
                  {
                    label: "boundary",
                    value:
                      `unreadable — the served entry is malformed (${first.fields.join(", ")}), ` +
                      "so its numbers are not read and no exact-price health claim is made" +
                      // The wire's own `reason` rides this row too — the card arm
                      // and the not-established row both expose it.
                      (lp.reason !== undefined && lp.reason !== "" ? ` · ${lp.reason}` : ""),
                    tone: "warn" as const,
                  },
                ]
              : [
                  {
                    label: "boundary",
                    value:
                      "not established — the solve published no boundary price on this axis" +
                      (lp.reason !== undefined && lp.reason !== "" ? ` · ${lp.reason}` : ""),
                    tone: "dim" as const,
                  },
                ]),
          { label: "axis", value: lp.axis },
          {
            label: "solve",
            value: lp.diagnostic
              ? "DIAGNOSTIC · single-asset ceteris-paribus variant (other counted collateral held)"
              : "factor-level closed form · all assets on the axis move together",
            tone: lp.diagnostic ? "warn" : "default",
          },
          ...(lp.already_breached
            ? [{ label: "already breached", value: "true · the boundary is behind the current price", tone: "crit" as const }]
            : []),
          // The WIRE FIELD name (this is the evidence register — the field
          // is what the reader came to check), with the axis-scoped statement
          // the badge carries, verbatim.
          ...(lp.never_liquidatable
            ? [
                {
                  label: "never_liquidatable (wire field)",
                  value: `true · ${noPricePathTitle(lp.reason)}`,
                  tone: "dim" as const,
                },
              ]
            : []),
        ];
  return positionNumberEvidence(position, batch, { title: "EXPLAIN · HEALTH BOUNDARY PRICE", subject, rows });
}

export function priceInputEvidence(
  position: RefinedPosition,
  batch: Batch,
  input: PriceInput,
  subject: string,
): EvidenceDescriptor {
  return positionNumberEvidence(position, batch, {
    title: "EXPLAIN · PRICE INPUT",
    subject,
    rows: [
      { label: "source", value: input.source },
      { label: "provenance class", value: input.provenance },
      {
        label: "value",
        value: renderNullableDecimal(input.value, input.decimals === null ? {} : { decimals: input.decimals }),
      },
      {
        label: "chain-asserted as-of",
        value: input.source_as_of ?? "none · DB insert time is never substituted",
        tone: input.source_as_of === null ? "warn" : "default",
      },
      {
        label: "anchor block",
        value: input.block_number === null ? EM_DASH : formatBlock(input.block_number),
      },
      {
        label: "budget verdict",
        value: `${input.verdict} (budget ${String(
          readWirePopulation(input.budget_seconds, "budget_seconds"),
        )}s, age ${
          input.age_seconds === null
            ? EM_DASH
            : `${String(readWirePopulation(input.age_seconds, "age_seconds"))}s`
        })`,
        tone: priceVerdictTone(input.verdict),
      },
      { label: "contract note", value: input.note, tone: "dim" },
    ],
  });
}

export function legEvidence(
  position: RefinedPosition,
  batch: Batch,
  leg: RefinedLeg,
  subject: string,
): EvidenceDescriptor {
  return positionNumberEvidence(position, batch, {
    title: `EXPLAIN · LEG ${leg.symbol ?? leg.asset}`,
    subject,
    rows: [
      { label: "asset", value: leg.asset },
      {
        label: "live collateral (raw)",
        value: leg.live_collateral ?? EM_DASH,
        tone: leg.live_collateral === null ? "dim" : "default",
      },
      { label: "live debt (raw)", value: leg.live_debt ?? EM_DASH, tone: leg.live_debt === null ? "dim" : "default" },
      {
        label: "collateral use",
        value: leg.collateral_use,
        tone: leg.collateral_use === "unknowable" ? "dim" : "default",
      },
      {
        label: "debt index as-of",
        value: leg.debt_index_block === null ? `${EM_DASH} (no debt leg)` : `block ${formatBlock(leg.debt_index_block)}`,
        tone: "dim",
      },
      {
        label: "collateral index as-of",
        value:
          leg.collateral_index_block === null
            ? `${EM_DASH} (no collateral leg)`
            : `block ${formatBlock(leg.collateral_index_block)}`,
        tone: "dim",
      },
      // The denomination is the ENGINE's (Aave bps · 1e4, Debt Manager
      // 100e18), so the label never says "bps" of a value that is not. The
      // raw wire value stays beside the percentage — this is the evidence
      // register, where the exact integer is the point.
      {
        label: `liq threshold (${paramScaleNote(position.engine)})`,
        value:
          leg.liq_threshold === null
            ? EM_DASH
            : `${paramPercent(leg.liq_threshold, position.engine)} · raw ${leg.liq_threshold}`,
      },
      // The bonus is a par-based MULTIPLIER on Aave
      // (10500 = 1.05x = a 5% premium) and the PREMIUM ITSELF on the Debt
      // Manager. The register states the premium, the raw integer, and which
      // of the two encodings that integer is — the reader never has to guess
      // which engine's convention produced the digits.
      {
        label: `liq bonus (${paramScaleNote(position.engine)})`,
        value: liqBonusEvidenceValue(leg.liq_bonus, position.engine),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// /v1/evidence-derived builders — Verification's chains.
//
// THE SPLIT IS THE PRODUCT: a manifest carries TWO subjects and they are
// never one identity —
//
//   proof_subject  the pinned, exactly-reproducible acceptance evidence: the
//                  committed reconcile receipt (result, exit code, gated
//                  rows, per-engine welds, comparison sha, artifact path)
//                  plus the build/config identity it speaks for.
//   live_subject   the currently-serving batch's identity: batch id,
//                  materialization key, substrate digest — WATERMARKED,
//                  never reconcile-welded.
//
// Since contract 1.2.0 the wire CARRIES the status (`proof_subject.status`,
// `live_subject.status`). This module reads the wire field AND keeps its own
// derivation as a CROSS-CHECK: the status semantics are the receipt's own
// strict conjunction, so the two must agree — and when they do not, the
// contradiction renders LOUDLY (never the badge; honest-UI law). The proof
// marker ("proven") is granted ONLY when both the wire and the derivation say
// accepted; the live subject is OPERATIONAL unconditionally. Exactness never
// transfers between them.
// ---------------------------------------------------------------------------

export type EvidenceManifest = components["schemas"]["EvidenceResponse"];

type ManifestReconcile = components["schemas"]["ReconcileSummary"];
type ManifestSubstrate = components["schemas"]["SubstrateRef"];

const NO_REASON = "the manifest served no reason, so the absence is stated rather than invented";

/** The proof subject's status. Anything but `accepted` must render LOUDLY. */
export type ProofSubjectStatus =
  | { kind: "accepted"; reconcile: ManifestReconcile }
  | { kind: "rejected"; reconcile: ManifestReconcile; detail: string }
  | { kind: "unavailable"; reason: string };

/**
 * Derive the proof subject's status from the receipt's OWN fields — a strict
 * conjunction. Any internal inconsistency (a "pass" with drift, a weld short
 * of its row count) demotes to `rejected` with the violation named: this
 * surface would rather call a contradictory receipt rejected than launder it
 * into a proof.
 *
 * Kept as the CROSS-CHECK against the wire's `proof_subject.status` —
 * `proofSubjectStatus` below is the consumer entry point.
 */
export function deriveProofSubjectStatus(manifest: EvidenceManifest): ProofSubjectStatus {
  const reconcile = manifest.reconcile;
  if (reconcile === null) {
    return { kind: "unavailable", reason: manifest.reconcile_unavailable_reason ?? NO_REASON };
  }
  // Every receipt integer passes the population guard BEFORE the acceptance
  // welds — `-0 !== 0` is false, so an unguarded -0 exit code or drift token
  // sails THROUGH the checks below and accepts a receipt whose numbers cannot
  // be read. A malformed receipt is not a rejected proof (that would claim
  // the reconcile failed); the throw lands in the route boundary, which
  // refuses to read it at all.
  const exitCode = readWirePopulation(reconcile.exit_code, "exit_code");
  const gatedDrift = readWirePopulation(reconcile.gated_drift, "gated_drift");
  const gatedExact = readWirePopulation(reconcile.gated_exact, "gated_exact");
  const gatedRows = readWirePopulation(reconcile.gated_rows, "gated_rows");
  if (reconcile.result !== "pass") {
    return {
      kind: "rejected",
      reconcile,
      detail: `receipt verdict "${reconcile.result}" (exit ${String(exitCode)})`,
    };
  }
  if (exitCode !== 0) {
    return {
      kind: "rejected",
      reconcile,
      detail: `verdict "pass" with exit code ${String(exitCode)}, an internally inconsistent receipt`,
    };
  }
  if (gatedDrift !== 0 || gatedExact !== gatedRows) {
    return {
      kind: "rejected",
      reconcile,
      detail: `gated ${String(gatedExact)}/${String(gatedRows)} exact, drift ${String(gatedDrift)}`,
    };
  }
  for (const weld of reconcile.welds) {
    if (
      readWirePopulation(weld.rows_exact, "rows_exact") !==
      readWirePopulation(weld.rows_compared, "rows_compared")
    ) {
      return {
        kind: "rejected",
        reconcile,
        detail: `${weld.engine} weld ${String(weld.rows_exact)}/${String(weld.rows_compared)} exact`,
      };
    }
  }
  return { kind: "accepted", reconcile };
}

/**
 * The proof subject's status — the WIRE's `proof_subject.status`, accepted
 * only when the conjunction derived here agrees with it.
 *
 * On agreement the derived result (with its rich payload) is returned. On
 * CONTRADICTION the answer is never the badge: the strictest honest arm wins,
 * and the contradiction is named in the detail so it renders loudly — a
 * manifest that cannot agree with its own receipt does not get to look
 * proven.
 */
export function proofSubjectStatus(manifest: EvidenceManifest): ProofSubjectStatus {
  const derived = deriveProofSubjectStatus(manifest);
  // A wire outside the 1.2.0 contract carries no proof_subject; the
  // derivation then stands alone (the generated type says the field is
  // required, but the wire's own bytes are the authority).
  const wire = manifest.proof_subject as EvidenceManifest["proof_subject"] | undefined;
  if (wire === undefined || wire.status === derived.kind) {
    return derived;
  }
  const contradiction =
    `CONTRADICTION · the wire's proof_subject.status "${wire.status}" contradicts the ` +
    `receipt's own conjunction "${derived.kind}"; refusing the proof badge and rendering ` +
    `the contradiction`;
  if (derived.kind === "unavailable") {
    return { kind: "unavailable", reason: `${contradiction} (derived reason: ${derived.reason})` };
  }
  return {
    kind: "rejected",
    reconcile: derived.reconcile,
    detail: derived.kind === "rejected" ? `${contradiction} (derived detail: ${derived.detail})` : contradiction,
  };
}

/** The live subject's status. `no-batch` is a first-class state, not an error. */
export type LiveSubjectStatus =
  | { kind: "serving"; substrate: ManifestSubstrate }
  | { kind: "no-batch"; reason: string };

/**
 * Derive the live subject's status from the substrate's own presence — the
 * cross-check against the wire's `live_subject.status`.
 */
export function deriveLiveSubjectStatus(manifest: EvidenceManifest): LiveSubjectStatus {
  const substrate = manifest.substrate;
  if (substrate === null) {
    return { kind: "no-batch", reason: manifest.substrate_unavailable_reason ?? NO_REASON };
  }
  return { kind: "serving", substrate };
}

/**
 * The live subject's status — wire field cross-checked against the
 * substrate's own presence. A contradictory manifest NEVER claims a serving
 * batch: the contradiction renders as `no-batch` with the reason named.
 */
export function liveSubjectStatus(manifest: EvidenceManifest): LiveSubjectStatus {
  const derived = deriveLiveSubjectStatus(manifest);
  const wire = manifest.live_subject as EvidenceManifest["live_subject"] | undefined;
  if (wire === undefined) return derived;
  const wireKind = wire.status === "serving" ? "serving" : "no-batch";
  if (wireKind === derived.kind) return derived;
  if (derived.kind === "serving") {
    return {
      kind: "no-batch",
      reason:
        `CONTRADICTION · the wire's live_subject.status "${wire.status}" contradicts a ` +
        `non-null substrate; refusing to claim a serving batch under a contradictory manifest`,
    };
  }
  return {
    kind: "no-batch",
    reason:
      `CONTRADICTION · the wire claims "serving" while substrate is null; ` +
      `refusing to claim a serving batch (derived reason: ${derived.reason})`,
  };
}

/**
 * A receipt whose run gated no rows at all. It passes its own conjunction
 * vacuously — no drift, none short, because nothing was compared — so it is
 * neither a failed run nor a proof. Every surface refuses the finding and
 * says why; "all 0 rows matched" is never worded.
 */
export function receiptComparedNothing(reconcile: ManifestReconcile): boolean {
  return readWirePopulation(reconcile.gated_rows, "gated_rows") === 0;
}

/** The proof pin: the receipt's own comparison sha, shortened for display. */
export function proofPin(reconcile: ManifestReconcile): string {
  return reconcile.comparison_sha256.slice(0, 8);
}

/**
 * The head takeaway's two arms. `proof` is the receipt's own finding — the
 * only clause a page may tone, and only by the receipt's state. `scope` ends
 * the sentence in ink: where the finding holds, and the live subject's
 * absence when no batch is claimed. A SERVING batch is never named here: it
 * is the live subject, and it may not stand inside the proof's finding as
 * though it shared it.
 */
export interface ProofTakeawayArms {
  readonly proof: string;
  readonly scope: string;
}

const DID_NOT_MATCH = "The last reconcile run did not match the chain exactly,";
/** The finding withheld: no receipt is committed, or the committed one compared nothing. */
const NOTHING_PROVEN = "Nothing is proven for this deployment:";

const rowsWord = (count: number): string => (count === 1 ? "row" : "rows");

/**
 * The live subject's absence as the head words it: after an accepted finding
 * (`but`), or as a sentence of its own after a failing one (`also`). A
 * manifest that contradicts itself about its batch is said to — "no batch can
 * be served" would be a claim the contradiction does not license.
 */
const LIVE_ABSENCE = {
  "no-batch": {
    but: "but no batch can be served right now.",
    also: "No batch can be served right now either.",
  },
  contradicted: {
    but: "but the manifest contradicts itself about the live batch, so none is claimed.",
    also: "The manifest also contradicts itself about the live batch, so none is claimed.",
  },
} as const;

function liveAbsence(manifest: EvidenceManifest): keyof typeof LIVE_ABSENCE | null {
  if (liveSubjectStatus(manifest).kind === "serving") return null;
  const derived = deriveLiveSubjectStatus(manifest).kind;
  const wire = manifest.live_subject as EvidenceManifest["live_subject"] | undefined;
  const claimed = wire === undefined ? derived : wire.status === "serving" ? "serving" : "no-batch";
  return claimed === derived ? "no-batch" : "contradicted";
}

/**
 * A rejected receipt's finding, by the receipt's OWN numbers and in the order
 * a reader needs them: the gated tally, then a short weld, then a verdict
 * that is not a clean pass. A drift of zero is never printed — a failing
 * receipt is not worded by the one tally it happens to keep clean. The wire
 * refusing a receipt that passes on its own numbers is a finding of its own.
 */
function rejectedArms(manifest: EvidenceManifest, reconcile: ManifestReconcile): ProofTakeawayArms {
  if (deriveProofSubjectStatus(manifest).kind !== "rejected") {
    return { proof: "The proof cannot be accepted:", scope: "the manifest contradicts its own receipt." };
  }
  const exact = readWirePopulation(reconcile.gated_exact, "gated_exact");
  const rows = readWirePopulation(reconcile.gated_rows, "gated_rows");
  const drift = readWirePopulation(reconcile.gated_drift, "gated_drift");
  if (drift !== 0 || exact !== rows) {
    const drifted = drift === 0 ? "" : `; ${groupInt(drift)} ${rowsWord(drift)} drifted`;
    return { proof: DID_NOT_MATCH, scope: `${groupInt(exact)} of ${groupInt(rows)} checked ${rowsWord(rows)} matched${drifted}.` };
  }
  const short = reconcile.welds.find(
    (weld) => readWirePopulation(weld.rows_exact, "rows_exact") !== readWirePopulation(weld.rows_compared, "rows_compared"),
  );
  if (short !== undefined) {
    return {
      proof: DID_NOT_MATCH,
      scope: `${engineName(short.engine)} matched ${groupInt(short.rows_exact)} of ${groupInt(short.rows_compared)} compared ${rowsWord(short.rows_compared)}.`,
    };
  }
  return {
    proof: "The last reconcile run did not pass:",
    scope: `its receipt records a verdict that is not a clean pass (exit code ${String(readWirePopulation(reconcile.exit_code, "exit_code"))}).`,
  };
}

/**
 * Both arms, from the same status derivations the two cards render (one
 * source), so the head and the cards cannot disagree — including under wire
 * contradictions, which those derivations already demote. A failed or absent
 * receipt is never worded as a match, nor is one that compared no rows, and
 * an absent batch is named in every proof arm.
 */
export function proofTakeawayArms(manifest: EvidenceManifest): ProofTakeawayArms {
  const proof = proofSubjectStatus(manifest);
  const absence = liveAbsence(manifest);
  if (proof.kind === "accepted" && !receiptComparedNothing(proof.reconcile)) {
    const rows = readWirePopulation(proof.reconcile.gated_rows, "gated_rows");
    return {
      proof: rows === 1 ? "The 1 checked row matched the chain exactly," : `All ${groupInt(rows)} checked rows matched the chain exactly,`,
      scope: absence === null ? "in this deployment's pinned reconcile run." : `in the pinned reconcile run — ${LIVE_ABSENCE[absence].but}`,
    };
  }
  const failing: ProofTakeawayArms =
    proof.kind === "rejected"
      ? rejectedArms(manifest, proof.reconcile)
      : proof.kind === "accepted"
        ? { proof: NOTHING_PROVEN, scope: "the pinned reconcile run compared no rows." }
        : { proof: NOTHING_PROVEN, scope: "no reconcile receipt is committed." };
  return absence === null ? failing : { proof: failing.proof, scope: `${failing.scope} ${LIVE_ABSENCE[absence].also}` };
}

/**
 * The head takeaway, whole: the two arms, joined by one space. BY LAW both
 * failing arms surface here — a head that says nothing while the receipt is
 * rejected, or while no batch serves, reads as a pass. The sentence is
 * composed FROM the arms, so a page that tones one arm and inks the other
 * prints this sentence and no other.
 */
export function proofTakeaway(manifest: EvidenceManifest): string {
  const arms = proofTakeawayArms(manifest);
  return `${arms.proof} ${arms.scope}`;
}

const PROOF_COMPARATOR =
  "PROOF · EXACT @ PIN ⇔ the committed reconcile receipt's OWN verdict: result \"pass\", " +
  "exit code 0, gated_exact == gated_rows, gated_drift == 0, and every per-engine weld " +
  "rows_exact == rows_compared. This surface republishes the committed receipt and recomputes " +
  "nothing, and the pin is the receipt's comparison sha.";

const LIVE_COMPARATOR =
  "No comparator applies: the live subject is the currently-serving batch's IDENTITY " +
  "(materialization key, substrate digest) under its watermark vector. It is never compared " +
  "against the proof; exactness claims live ONLY on the proof subject, at its pin.";

const PROVEN_NOTE =
  "PROOF · EXACT @ PIN: reconcile-welded numbers at the receipt's pinned run. The proof " +
  "speaks for its pin and ONLY its pin: the currently-serving batch is the LIVE subject " +
  "and does not inherit this exactness.";

const LIVE_NOTE =
  "LIVE · WATERMARKED: the currently-serving batch under its per-input watermark vector. " +
  "It does NOT inherit the proof subject's exactness: reconcile welds bind the receipt's " +
  "pinned run, not this batch.";

function buildIdentitySection(manifest: EvidenceManifest): EvidenceSection {
  const service = manifest.service;
  return {
    title: "BUILD · CONFIG IDENTITY",
    rows: [
      {
        label: "commit",
        value: manifest.commit ?? `${EM_DASH} (no build stamp, and never guessed)`,
        tone: manifest.commit === null ? "dim" : "default",
      },
      { label: "service", value: `${service.name} · ${service.version}` },
      { label: "schema version", value: String(readWirePopulation(service.schema_version, "schema_version")) },
      {
        label: "algorithm revision",
        value: String(readWirePopulation(service.algorithm_revision, "algorithm_revision")),
      },
      { label: "scenario config", value: service.scenario_config_version },
      { label: "seizure model", value: service.seizure_model, tone: "dim" },
    ],
  };
}

/**
 * The feeds registry's rows. The registry matching the service's fingerprint
 * is a record, true whatever the receipt proved: beside a receipt that
 * compared nothing it prints in ink, so that no row of that chain wears a
 * pass's colour. A mismatch is a hazard, and is loud under every receipt.
 */
function feedsRegistrySection(manifest: EvidenceManifest, vacuous: boolean): EvidenceSection {
  const feeds = manifest.feeds_registry;
  const welded = feeds.registry_fingerprint === manifest.service.registry_fingerprint;
  return {
    title: "FEEDS REGISTRY",
    rows: [
      { label: "path", value: feeds.path },
      { label: "registry fingerprint", value: feeds.registry_fingerprint },
      { label: "file sha256", value: feeds.file_sha256 },
      welded
        ? { label: "fingerprint weld", value: "identical to service.registry_fingerprint, by construction", tone: vacuous ? "default" : "ok" }
        : {
            label: "fingerprint weld",
            value: "MISMATCH against service.registry_fingerprint, which the contract says are identical by construction",
            tone: "crit",
          },
    ],
  };
}

/** The status row's words for a receipt that passed over no gated rows: the pass is vacuous, so the row refuses the finding and says why. */
export const RECEIPT_EMPTY_STATUS = "NOTHING PROVEN · the run gated no rows, so nothing was compared";
/** The pill's words for the same receipt. */
export const RECEIPT_EMPTY_PILL = "RECEIPT COMPARED NO ROWS";

/** The proof subject's full chain, drawer-ready. Marker "proven" ONLY on an unqualified pass over at least one gated row. */
export function proofSubjectEvidence(manifest: EvidenceManifest): EvidenceDescriptor {
  const status = proofSubjectStatus(manifest);
  const vacuous = status.kind === "accepted" && receiptComparedNothing(status.reconcile);
  const proven = status.kind === "accepted" && !vacuous;

  const statusRow: EvidenceRow =
    status.kind === "accepted"
      ? vacuous
        ? { label: "status", value: RECEIPT_EMPTY_STATUS, tone: "warn" }
        : { label: "status", value: "ACCEPTED · every gated row welded exact", tone: "ok" }
      : status.kind === "rejected"
        ? { label: "status", value: `REJECTED · ${status.detail}`, tone: "crit" }
        : { label: "status", value: `UNAVAILABLE · ${status.reason}`, tone: "crit" };

  const sections: EvidenceSection[] = [{ title: "THIS SUBJECT", rows: [statusRow] }];

  if (status.kind !== "unavailable") {
    const reconcile = status.reconcile;
    sections.push({
      title: "RECEIPT · COMMITTED ARTIFACT",
      rows: [
        { label: "schema", value: reconcile.schema, tone: "dim" },
        // Receipt tallies pass the population guard at the read.
        {
          label: "result · exit",
          value: `${reconcile.result} · ${String(readWirePopulation(reconcile.exit_code, "exit_code"))}`,
        },
        { label: "finished_at", value: reconcile.finished_at },
        {
          label: "gated rows",
          value: `${String(readWirePopulation(reconcile.gated_exact, "gated_exact"))}/${String(
            readWirePopulation(reconcile.gated_rows, "gated_rows"),
          )} exact · drift ${String(readWirePopulation(reconcile.gated_drift, "gated_drift"))}`,
          // A tally of no rows is not a clean tally: it wears no verdict's colour.
          tone: vacuous ? "dim" : readWirePopulation(reconcile.gated_drift, "gated_drift") === 0 ? "ok" : "crit",
        },
        {
          label: "advisory rows",
          value: String(readWirePopulation(reconcile.advisory_rows, "advisory_rows")),
          tone: "dim",
        },
        ...reconcile.welds.map(
          (weld): EvidenceRow => ({
            label: `weld · ${weld.engine}`,
            value: `${String(readWirePopulation(weld.rows_exact, "rows_exact"))}/${String(
              readWirePopulation(weld.rows_compared, "rows_compared"),
            )} exact`,
            // A weld under a run that gated no rows proves what the run proved — nothing: "0/0 exact" is a count, never a match.
            tone: vacuous
              ? "dim"
              : readWirePopulation(weld.rows_exact, "rows_exact") ===
                  readWirePopulation(weld.rows_compared, "rows_compared")
                ? "ok"
                : "crit",
          }),
        ),
        { label: "comparison sha256", value: reconcile.comparison_sha256 },
        { label: "artifact", value: reconcile.artifact_path },
        { label: "receipt note", value: reconcile.note, tone: "dim" },
      ],
    });
  }

  sections.push(buildIdentitySection(manifest), feedsRegistrySection(manifest, vacuous));

  return {
    title: "EXPLAIN · PROOF SUBJECT",
    subject:
      status.kind === "accepted"
        ? vacuous
          ? RECEIPT_EMPTY_PILL
          : `PROOF · EXACT @ ${proofPin(status.reconcile)}`
        : status.kind === "rejected"
          ? `RECEIPT REJECTED · ${status.detail}`
          : "NO COMMITTED RECEIPT",
    comparator: PROOF_COMPARATOR,
    marker: proven ? "proven" : "operational",
    markerNote:
      proven
        ? PROVEN_NOTE
        : "NOT PROVEN: no unqualified committed receipt backs this deployment; nothing here may " +
          "wear the PROOF · EXACT badge, and the deployment identity above stays operational.",
    sections,
  };
}

/** The live subject's chain. Marker "operational" UNCONDITIONALLY — the split law. */
export function liveSubjectEvidence(manifest: EvidenceManifest): EvidenceDescriptor {
  const status = liveSubjectStatus(manifest);

  const sections: EvidenceSection[] =
    status.kind === "serving"
      ? [
          {
            title: "THIS SUBJECT",
            rows: [{ label: "status", value: "SERVING · newest servable batch", tone: "ok" }],
          },
          {
            title: "SERVING BATCH · IDENTITY",
            rows: [
              {
                label: "batch",
                value: `#${String(readWirePopulation(status.substrate.batch_id, "batch_id"))}`,
              },
              { label: "materialization key", value: status.substrate.materialization_key },
              {
                label: "substrate digest",
                value:
                  status.substrate.substrate_digest === ""
                    ? `${EM_DASH} (predates substrate-digest custody, so this is an honest gap rather than a digest)`
                    : status.substrate.substrate_digest,
                tone: status.substrate.substrate_digest === "" ? "dim" : "default",
              },
              { label: "digest note", value: status.substrate.note, tone: "dim" },
            ],
          },
        ]
      : [
          {
            title: "THIS SUBJECT",
            rows: [
              { label: "status", value: "NO SERVABLE BATCH", tone: "crit" },
              { label: "reason", value: status.reason, tone: "crit" },
              {
                label: "materialization key",
                value: `${EM_DASH} · no batch, no key; never fabricated`,
                tone: "dim",
              },
            ],
          },
        ];

  return {
    title: "EXPLAIN · LIVE SUBJECT",
    subject:
      status.kind === "serving"
        ? `batch #${String(readWirePopulation(status.substrate.batch_id, "batch_id"))} · LIVE · WATERMARKED`
        : "NO SERVABLE BATCH",
    comparator: LIVE_COMPARATOR,
    marker: "operational",
    markerNote: LIVE_NOTE,
    sections,
  };
}

