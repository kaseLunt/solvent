// Typed evidence descriptors — the data contract behind the
// explain-this-number drawer (spec §3.6, honest-UI law 7: every number
// resolves to "computed from these on-chain values at block N").
//
// The descriptor is deliberately DUMB and serializable: sections of labeled
// rows plus the engine's comparator statement and the operational-vs-proven
// marker. The Inspector builds descriptors from a position + its batch; W6's
// Proof Center can build them from /v1/evidence and feed the SAME drawer.
//
// Everything here quotes fields the API actually serves. The one field the
// canon shows that this surface does NOT serve — the materialization key —
// is rendered as exactly that statement (it is published by /v1/evidence),
// never invented.

import type { Batch, PriceInput, RefinedLeg, RefinedPosition, Stamp } from "@solvent/client";
import type { components } from "@solvent/client";
import { EM_DASH, formatBlock, renderNullableDecimal } from "./format";

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
        "aave_v3_etherfi: liquidatable ⇔ hf_wad < 1e18, STRICTLY — equality is healthy. " +
        "Compared ON THE WAD the pool computed; never re-derived from a float."
      );
    case "debt_manager":
      return (
        "debt_manager: liquidatable ⇔ debt > maxBorrowLT — the engine's STRICT boolean; " +
        "equality is healthy. No continuous health factor exists on this engine."
      );
    default:
      return `comparator not known for engine "${engine}" — refusing to guess`;
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
  const unacked = stamp.max_epoch_at_compute - stamp.acked_epoch;
  return unacked <= 0
    ? { label: "reorg posture", value: "none unacked", tone: "ok" }
    : {
        label: "reorg posture",
        value: `${String(unacked)} unacked epoch(s) at compute — acked ${String(stamp.acked_epoch)} of ${String(stamp.max_epoch_at_compute)}`,
        tone: "crit",
      };
}

/** The shared evidentiary chain every position-number descriptor carries. */
function positionSections(position: RefinedPosition, batch: Batch): EvidenceSection[] {
  const stamp = batch.watermarks.find((w) => w.engine === position.engine);

  const batchSection: EvidenceSection = {
    title: "BATCH · MATERIALIZATION",
    rows: [
      { label: "batch", value: String(batch.id) },
      { label: "computed_at", value: batch.computed_at },
      { label: "producer · status", value: `${batch.producer} · ${batch.status}` },
      ...(batch.supersession.superseded
        ? [{ label: "supersession", value: "SUPERSEDED — the flag is the contract", tone: "warn" as const }]
        : []),
      {
        label: "engine watermark",
        value:
          stamp === undefined
            ? "absent"
            : `chain ${String(stamp.chain_id)} · last block ${formatBlock(stamp.last_block)}`,
        tone: stamp === undefined ? "crit" : "default",
      },
      reorgPostureRow(stamp),
      {
        label: "materialization key",
        value: "not served on this surface — published by /v1/evidence (Proof Center)",
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
        : { label: "sweep", value: "n/a — engine has no sweeper", tone: "dim" },
      {
        label: "oldest price input",
        value: asOf.oldest_price_input ?? "none",
        tone: asOf.oldest_price_input === null ? "dim" : "default",
      },
      asOf.stale_price_inputs
        ? { label: "stale price inputs", value: "YES — flagged, and the flag propagates", tone: "warn" }
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
      value: `${position.refusal.code} — ${position.refusal.detail}`,
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
  "LIVE · WATERMARKED — served from the newest servable batch under its per-input watermark " +
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
          { label: "infinite", value: hf.infinite ? "true — no debt" : "false" },
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
  const raw = which === "collateral" ? position.total_collateral_base : position.total_debt_base;
  return positionNumberEvidence(position, batch, {
    title: which === "collateral" ? "EXPLAIN · TOTAL COLLATERAL" : "EXPLAIN · TOTAL DEBT",
    subject,
    rows: [
      {
        label: `total_${which}_base (raw)`,
        value: raw ?? `${EM_DASH} (null — not established; never rendered as 0)`,
        tone: raw === null ? "dim" : "default",
      },
      { label: "value decimals", value: String(position.value_decimals) },
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
        value: raw ?? `${EM_DASH} (null — not established; never rendered as 0)`,
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
  const rows: EvidenceRow[] =
    lp === null
      ? [{ label: "liquidation price", value: "not published for this position", tone: "dim" }]
      : [
          ...lp.prices.map((price) => ({
            label: `lowest_healthy_price · ${price.asset.slice(0, 10)}…`,
            value:
              `${renderNullableDecimal(price.lowest_healthy_price, { decimals: price.price_decimals })} ` +
              `(current ${renderNullableDecimal(price.current_price, { decimals: price.price_decimals })})`,
          })),
          {
            label: "ceil disclosure",
            value:
              "ceil(P*): at exactly this price the position is still HEALTHY — liquidation begins strictly below it.",
            tone: "dim",
          },
          { label: "axis", value: lp.axis },
          {
            label: "solve",
            value: lp.diagnostic
              ? "DIAGNOSTIC — single-asset ceteris-paribus variant (other counted collateral held)"
              : "factor-level closed form — all assets on the axis move together",
            tone: lp.diagnostic ? "warn" : "default",
          },
          ...(lp.already_breached
            ? [{ label: "already breached", value: "true — the boundary is behind the current price", tone: "crit" as const }]
            : []),
          ...(lp.never_liquidatable
            ? [{ label: "never liquidatable", value: `true${lp.reason === undefined ? "" : ` — ${lp.reason}`}`, tone: "dim" as const }]
            : []),
        ];
  return positionNumberEvidence(position, batch, { title: "EXPLAIN · LIQUIDATION PRICE", subject, rows });
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
        value: input.source_as_of ?? "none — DB insert time is never substituted",
        tone: input.source_as_of === null ? "warn" : "default",
      },
      {
        label: "anchor block",
        value: input.block_number === null ? EM_DASH : formatBlock(input.block_number),
      },
      {
        label: "budget verdict",
        value: `${input.verdict} (budget ${String(input.budget_seconds)}s, age ${input.age_seconds === null ? EM_DASH : `${String(input.age_seconds)}s`})`,
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
      { label: "liq threshold", value: leg.liq_threshold === null ? EM_DASH : `${leg.liq_threshold} bps` },
      { label: "liq bonus", value: leg.liq_bonus === null ? EM_DASH : `${leg.liq_bonus} bps` },
    ],
  });
}

// ---------------------------------------------------------------------------
// /v1/evidence-derived builders (W6, ADDITIVE) — the Proof Center's chains.
//
// THE SPLIT IS THE PRODUCT (plan AMENDMENT 1): a manifest carries TWO
// subjects and they are never one identity —
//
//   proof_subject  the pinned, exactly-reproducible acceptance evidence: the
//                  committed reconcile receipt (result, exit code, gated
//                  rows, per-engine welds, comparison sha, artifact path)
//                  plus the build/config identity it speaks for.
//   live_subject   the currently-serving batch's identity: batch id,
//                  materialization key, substrate digest — WATERMARKED,
//                  never reconcile-welded.
//
// The proof marker ("proven") is granted by proofSubjectStatus ONLY when the
// receipt's own verdict is an unqualified pass; the live subject is
// OPERATIONAL unconditionally. Exactness never transfers between them.
// ---------------------------------------------------------------------------

export type EvidenceManifest = components["schemas"]["EvidenceResponse"];

type ManifestReconcile = components["schemas"]["ReconcileSummary"];
type ManifestSubstrate = components["schemas"]["SubstrateRef"];

const NO_REASON = "the manifest served no reason — stated as absent, never invented";

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
 */
export function proofSubjectStatus(manifest: EvidenceManifest): ProofSubjectStatus {
  const reconcile = manifest.reconcile;
  if (reconcile === null) {
    return { kind: "unavailable", reason: manifest.reconcile_unavailable_reason ?? NO_REASON };
  }
  if (reconcile.result !== "pass") {
    return {
      kind: "rejected",
      reconcile,
      detail: `receipt verdict "${reconcile.result}" (exit ${String(reconcile.exit_code)})`,
    };
  }
  if (reconcile.exit_code !== 0) {
    return {
      kind: "rejected",
      reconcile,
      detail: `verdict "pass" with exit code ${String(reconcile.exit_code)} — internally inconsistent receipt`,
    };
  }
  if (reconcile.gated_drift !== 0 || reconcile.gated_exact !== reconcile.gated_rows) {
    return {
      kind: "rejected",
      reconcile,
      detail: `gated ${String(reconcile.gated_exact)}/${String(reconcile.gated_rows)} exact, drift ${String(reconcile.gated_drift)}`,
    };
  }
  for (const weld of reconcile.welds) {
    if (weld.rows_exact !== weld.rows_compared) {
      return {
        kind: "rejected",
        reconcile,
        detail: `${weld.engine} weld ${String(weld.rows_exact)}/${String(weld.rows_compared)} exact`,
      };
    }
  }
  return { kind: "accepted", reconcile };
}

/** The live subject's status. `no-batch` is a first-class state, not an error. */
export type LiveSubjectStatus =
  | { kind: "serving"; substrate: ManifestSubstrate }
  | { kind: "no-batch"; reason: string };

export function liveSubjectStatus(manifest: EvidenceManifest): LiveSubjectStatus {
  const substrate = manifest.substrate;
  if (substrate === null) {
    return { kind: "no-batch", reason: manifest.substrate_unavailable_reason ?? NO_REASON };
  }
  return { kind: "serving", substrate };
}

/** The proof pin: the receipt's own comparison sha, shortened for display. */
export function proofPin(reconcile: ManifestReconcile): string {
  return reconcile.comparison_sha256.slice(0, 8);
}

const PROOF_COMPARATOR =
  "PROOF · EXACT @ PIN ⇔ the committed reconcile receipt's OWN verdict: result \"pass\", " +
  "exit code 0, gated_exact == gated_rows, gated_drift == 0, and every per-engine weld " +
  "rows_exact == rows_compared. This surface republishes the committed receipt — it " +
  "recomputes nothing — and the pin is the receipt's comparison sha.";

const LIVE_COMPARATOR =
  "No comparator applies: the live subject is the currently-serving batch's IDENTITY " +
  "(materialization key, substrate digest) under its watermark vector. It is never compared " +
  "against the proof — exactness claims live ONLY on the proof subject, at its pin.";

const PROVEN_NOTE =
  "PROOF · EXACT @ PIN — reconcile-welded numbers at the receipt's pinned run. The proof " +
  "speaks for its pin and ONLY its pin: the currently-serving batch is the LIVE subject " +
  "and does not inherit this exactness.";

const LIVE_NOTE =
  "LIVE · WATERMARKED — the currently-serving batch under its per-input watermark vector. " +
  "It does NOT inherit the proof subject's exactness: reconcile welds bind the receipt's " +
  "pinned run, not this batch.";

function buildIdentitySection(manifest: EvidenceManifest): EvidenceSection {
  const service = manifest.service;
  return {
    title: "BUILD · CONFIG IDENTITY",
    rows: [
      {
        label: "commit",
        value: manifest.commit ?? `${EM_DASH} (no build stamp — never guessed)`,
        tone: manifest.commit === null ? "dim" : "default",
      },
      { label: "service", value: `${service.name} · ${service.version}` },
      { label: "schema version", value: String(service.schema_version) },
      { label: "algorithm revision", value: String(service.algorithm_revision) },
      { label: "scenario config", value: service.scenario_config_version },
      { label: "seizure model", value: service.seizure_model, tone: "dim" },
    ],
  };
}

function feedsRegistrySection(manifest: EvidenceManifest): EvidenceSection {
  const feeds = manifest.feeds_registry;
  const welded = feeds.registry_fingerprint === manifest.service.registry_fingerprint;
  return {
    title: "FEEDS REGISTRY",
    rows: [
      { label: "path", value: feeds.path },
      { label: "registry fingerprint", value: feeds.registry_fingerprint },
      { label: "file sha256", value: feeds.file_sha256 },
      welded
        ? { label: "fingerprint weld", value: "identical to service.registry_fingerprint — by construction", tone: "ok" }
        : {
            label: "fingerprint weld",
            value: "MISMATCH against service.registry_fingerprint — the contract says these are identical by construction",
            tone: "crit",
          },
    ],
  };
}

/** The proof subject's full chain, drawer-ready. Marker "proven" ONLY on an unqualified pass. */
export function proofSubjectEvidence(manifest: EvidenceManifest): EvidenceDescriptor {
  const status = proofSubjectStatus(manifest);

  const statusRow: EvidenceRow =
    status.kind === "accepted"
      ? { label: "status", value: "ACCEPTED — every gated row welded exact", tone: "ok" }
      : status.kind === "rejected"
        ? { label: "status", value: `REJECTED — ${status.detail}`, tone: "crit" }
        : { label: "status", value: `UNAVAILABLE — ${status.reason}`, tone: "crit" };

  const sections: EvidenceSection[] = [{ title: "THIS SUBJECT", rows: [statusRow] }];

  if (status.kind !== "unavailable") {
    const reconcile = status.reconcile;
    sections.push({
      title: "RECEIPT — COMMITTED ARTIFACT",
      rows: [
        { label: "schema", value: reconcile.schema, tone: "dim" },
        { label: "result · exit", value: `${reconcile.result} · ${String(reconcile.exit_code)}` },
        { label: "finished_at", value: reconcile.finished_at },
        {
          label: "gated rows",
          value: `${String(reconcile.gated_exact)}/${String(reconcile.gated_rows)} exact · drift ${String(reconcile.gated_drift)}`,
          tone: reconcile.gated_drift === 0 ? "ok" : "crit",
        },
        { label: "advisory rows", value: String(reconcile.advisory_rows), tone: "dim" },
        ...reconcile.welds.map(
          (weld): EvidenceRow => ({
            label: `weld · ${weld.engine}`,
            value: `${String(weld.rows_exact)}/${String(weld.rows_compared)} exact`,
            tone: weld.rows_exact === weld.rows_compared ? "ok" : "crit",
          }),
        ),
        { label: "comparison sha256", value: reconcile.comparison_sha256 },
        { label: "artifact", value: reconcile.artifact_path },
        { label: "receipt note", value: reconcile.note, tone: "dim" },
      ],
    });
  }

  sections.push(buildIdentitySection(manifest), feedsRegistrySection(manifest));

  return {
    title: "EXPLAIN · PROOF SUBJECT",
    subject:
      status.kind === "accepted"
        ? `PROOF · EXACT @ ${proofPin(status.reconcile)}`
        : status.kind === "rejected"
          ? `RECEIPT REJECTED — ${status.detail}`
          : "NO COMMITTED RECEIPT",
    comparator: PROOF_COMPARATOR,
    marker: status.kind === "accepted" ? "proven" : "operational",
    markerNote:
      status.kind === "accepted"
        ? PROVEN_NOTE
        : "NOT PROVEN — no unqualified committed receipt backs this deployment; nothing here may " +
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
            rows: [{ label: "status", value: "SERVING — newest servable batch", tone: "ok" }],
          },
          {
            title: "SERVING BATCH · IDENTITY",
            rows: [
              { label: "batch", value: `#${String(status.substrate.batch_id)}` },
              { label: "materialization key", value: status.substrate.materialization_key },
              {
                label: "substrate digest",
                value:
                  status.substrate.substrate_digest === ""
                    ? `${EM_DASH} (predates substrate-digest custody — an honest gap, not a digest)`
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
                value: `${EM_DASH} — no batch, no key; never fabricated`,
                tone: "dim",
              },
            ],
          },
        ];

  return {
    title: "EXPLAIN · LIVE SUBJECT",
    subject:
      status.kind === "serving"
        ? `batch #${String(status.substrate.batch_id)} — LIVE · WATERMARKED`
        : "NO SERVABLE BATCH",
    comparator: LIVE_COMPARATOR,
    marker: "operational",
    markerNote: LIVE_NOTE,
    sections,
  };
}

