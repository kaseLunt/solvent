"use client";

// The two subjects (plan AMENDMENT 1: the split is the product), as two kit
// cards that must read as different instruments —
//
//   PROOF SUBJECT  the committed reconcile receipt and the build/config identity
//                  it speaks for. Wears PROOF · EXACT @ PIN only on an
//                  unqualified pass; anything else is a loud first-class state.
//   LIVE SUBJECT   the currently-serving batch's identity: batch id, the
//                  materialization key with its copy affordance, the substrate
//                  digest. Always OPERATIONAL — it never inherits the proof's
//                  exactness.
//
// Three layers on each card: the answer stays visible; provenance folds behind a
// counted summary; a hazard (a digest gap, a fingerprint mismatch, a
// publishability refusal) never lives inside the fold. Every artifact-derived
// string renders through `publishable()` — an endpoint-URL/DSN-shaped fragment
// is refused at render, and that refusal is itself hoisted out of the fold.

import type { ReactNode } from "react";
import { StatusPill } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import {
  liveSubjectEvidence,
  liveSubjectStatus,
  proofPin,
  proofSubjectEvidence,
  proofSubjectStatus,
  type EvidenceDescriptor,
  type EvidenceManifest,
} from "@/lib/evidence";
import { EM_DASH } from "@/lib/format";
import { publishable } from "@/lib/proof-data";
import { CopyChip } from "./CopyChip";
import styles from "./verification.module.css";

type Tone = "default" | "ok" | "warn" | "crit" | "dim";

const TONE_CLASS: Record<Tone, string | undefined> = {
  default: undefined,
  ok: styles.vOk,
  warn: styles.vWarn,
  crit: styles.vCrit,
  dim: styles.vDim,
};

/** Publishability-checked render of an artifact-derived string. */
function pub(text: string): string {
  const checked = publishable(text);
  return checked.ok ? checked.text : checked.refusal;
}

function Row({
  label,
  tone = "default",
  testId,
  children,
}: {
  label: string;
  tone?: Tone;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.row} data-testid={testId}>
      <span className={styles.k}>{label}</span>
      <span className={[styles.v, TONE_CLASS[tone]].filter(Boolean).join(" ")}>{children}</span>
    </div>
  );
}

/** A full identifier with its copy affordance. Wrapping is presentation; the copy is whole. */
function Ident({ value, copyLabel }: { value: string; copyLabel: string }) {
  return (
    <span className={styles.ident}>
      <span className={styles.mono}>{value}</span>
      <CopyChip text={value} label={copyLabel} />
    </span>
  );
}

export interface SubjectCardProps {
  manifest: EvidenceManifest;
  onExplain: (descriptor: EvidenceDescriptor) => void;
}

function ProofCard({ manifest, onExplain }: SubjectCardProps) {
  const status = proofSubjectStatus(manifest);
  const service = manifest.service;
  const feeds = manifest.feeds_registry;
  const fingerprintWelded = feeds.registry_fingerprint === service.registry_fingerprint;

  // A pub() refusal is itself a refusal and may not hide behind the fold: every
  // artifact-derived string destined for the forensic layer is checked here,
  // and a refused one hoists out.
  const reconcile = status.kind === "unavailable" ? null : status.reconcile;
  const artifactPub = reconcile === null ? null : publishable(reconcile.artifact_path);
  const receiptNotePub = reconcile === null ? null : publishable(reconcile.note);
  const feedsPathPub = publishable(feeds.path);
  const foldCount =
    (reconcile === null ? 0 : 4 + (artifactPub?.ok === true ? 1 : 0) + (receiptNotePub?.ok === true ? 1 : 0)) +
    6 +
    2 +
    (feedsPathPub.ok ? 1 : 0);

  return (
    <section className={`${kit.card} ${styles.proofCard}`} data-testid="verification-subject-proof">
      <div className={kit.cardT}>
        <div className={styles.cardHead}>
          <h3>Proof subject</h3>
          <span data-testid="verification-proof-status">
            {status.kind === "accepted" ? (
              <StatusPill tone="ok">PROOF · EXACT @ {proofPin(status.reconcile)}</StatusPill>
            ) : status.kind === "rejected" ? (
              <StatusPill tone="crit">RECEIPT REJECTED</StatusPill>
            ) : (
              <StatusPill tone="refused">NO COMMITTED RECEIPT</StatusPill>
            )}
          </span>
        </div>
        <button
          type="button"
          className={styles.explain}
          aria-label="explain proof subject"
          onClick={() => {
            onExplain(proofSubjectEvidence(manifest));
          }}
        >
          explain
        </button>
      </div>

      {/* The ANSWER layer stays visible: the status, gated rows with their drift, every per-engine weld, the fingerprint weld. */}
      <div className={styles.rows}>
        {status.kind === "accepted" && (
          <Row label="status" tone="ok">
            ACCEPTED · every gated row welded exact
          </Row>
        )}
        {status.kind === "rejected" && (
          <Row label="status" tone="crit">
            REJECTED · {status.detail}
          </Row>
        )}
        {status.kind === "unavailable" && (
          <Row label="status" tone="crit">
            UNAVAILABLE · {pub(status.reason)}
          </Row>
        )}
        {reconcile !== null && (
          <>
            <Row label="gated rows" tone={reconcile.gated_drift === 0 ? "ok" : "crit"}>
              {`${String(reconcile.gated_exact)}/${String(reconcile.gated_rows)} exact · drift ${String(reconcile.gated_drift)}`}
            </Row>
            {reconcile.welds.map((weld) => (
              <Row
                key={weld.engine}
                label={`weld · ${weld.engine}`}
                tone={weld.rows_exact === weld.rows_compared ? "ok" : "crit"}
                testId={`verification-weld-${weld.engine}`}
              >
                {`${String(weld.rows_exact)}/${String(weld.rows_compared)} exact`}
              </Row>
            ))}
          </>
        )}
        <Row label="fingerprint weld" tone={fingerprintWelded ? "ok" : "crit"}>
          {fingerprintWelded
            ? "identical to service fingerprint, by construction"
            : "MISMATCH against service fingerprint, which the contract says are identical by construction"}
        </Row>

        {/* Hoisted pub() refusals — a withheld value is a refusal and renders OUTSIDE the fold, exactly when it strikes. */}
        {artifactPub !== null && !artifactPub.ok && (
          <Row label="artifact" tone="warn" testId="verification-proof-artifact-refused">
            {artifactPub.refusal}
          </Row>
        )}
        {receiptNotePub !== null && !receiptNotePub.ok && (
          <Row label="receipt note" tone="warn" testId="verification-proof-note-refused">
            {receiptNotePub.refusal}
          </Row>
        )}
        {!feedsPathPub.ok && (
          <Row label="feeds registry path" tone="warn" testId="verification-feeds-path-refused">
            {feedsPathPub.refusal}
          </Row>
        )}
      </div>

      <details className={styles.fold} data-testid="verification-proof-forensics">
        <summary>{String(foldCount)} provenance row(s)</summary>
        {reconcile !== null && (
          <>
            <div className={styles.foldSection}>Receipt · committed artifact</div>
            <div className={styles.rows}>
              <Row label="result · exit">
                {reconcile.result} · {String(reconcile.exit_code)}
              </Row>
              <Row label="finished_at">{reconcile.finished_at}</Row>
              <Row label="advisory rows" tone="dim">
                {String(reconcile.advisory_rows)}
              </Row>
              <Row label="comparison sha256">
                <Ident value={reconcile.comparison_sha256} copyLabel="copy comparison sha256" />
              </Row>
              {artifactPub?.ok === true && <Row label="artifact">{artifactPub.text}</Row>}
              {receiptNotePub?.ok === true && (
                <Row label="receipt note" tone="dim">
                  {receiptNotePub.text}
                </Row>
              )}
            </div>
          </>
        )}

        <div className={styles.foldSection}>Build · config identity</div>
        <div className={styles.rows}>
          <Row label="commit" tone={manifest.commit === null ? "dim" : "default"}>
            {manifest.commit === null ? (
              `${EM_DASH} (no build stamp, and never guessed)`
            ) : (
              <Ident value={manifest.commit} copyLabel="copy commit" />
            )}
          </Row>
          <Row label="service">
            {service.name} · {service.version}
          </Row>
          <Row label="schema version">{String(service.schema_version)}</Row>
          <Row label="algorithm revision">{String(service.algorithm_revision)}</Row>
          <Row label="scenario config">{service.scenario_config_version}</Row>
          <Row label="seizure model" tone="dim">
            {service.seizure_model}
          </Row>
        </div>

        <div className={styles.foldSection}>Feeds registry</div>
        <div className={styles.rows}>
          {feedsPathPub.ok && <Row label="path">{feedsPathPub.text}</Row>}
          <Row label="registry fingerprint">
            <Ident value={feeds.registry_fingerprint} copyLabel="copy registry fingerprint" />
          </Row>
          <Row label="file sha256">
            <Ident value={feeds.file_sha256} copyLabel="copy feeds file sha256" />
          </Row>
        </div>
      </details>
    </section>
  );
}

function LiveCard({ manifest, onExplain }: SubjectCardProps) {
  const status = liveSubjectStatus(manifest);
  // The digest's predates-custody gap and a refused identity note are hazards and render OUTSIDE the fold.
  const notePub = status.kind === "serving" ? publishable(status.substrate.note) : null;
  const digestGap = status.kind === "serving" && status.substrate.substrate_digest === "";
  const foldCount = (digestGap ? 0 : 1) + (notePub?.ok === true ? 1 : 0);

  return (
    <section className={`${kit.card} ${styles.liveCard}`} data-testid="verification-subject-live">
      <div className={kit.cardT}>
        <div className={styles.cardHead}>
          <h3>Live subject</h3>
          <span data-testid="verification-live-status">
            {status.kind === "serving" ? (
              <StatusPill tone="ok">SERVING · WATERMARKED</StatusPill>
            ) : (
              <StatusPill tone="crit">NO SERVABLE BATCH</StatusPill>
            )}
          </span>
        </div>
        <button
          type="button"
          className={styles.explain}
          aria-label="explain live subject"
          onClick={() => {
            onExplain(liveSubjectEvidence(manifest));
          }}
        >
          explain
        </button>
      </div>

      {status.kind === "serving" ? (
        <>
          {/* The takeaway: the serving batch and its status; the key with its copy affordance stays visible; provenance folds, counted. */}
          <p className={styles.takeaway} data-testid="verification-live-takeaway">
            serving batch #{String(status.substrate.batch_id)} · watermarked, operational — never the proof
          </p>
          <div className={styles.rows}>
            <Row label="materialization key" testId="verification-key">
              <Ident value={status.substrate.materialization_key} copyLabel="copy materialization key" />
            </Row>
            {digestGap && (
              <Row label="substrate digest" tone="dim" testId="verification-live-digest-gap">
                {`${EM_DASH} (predates substrate-digest custody, so this is an honest gap rather than a digest)`}
              </Row>
            )}
            {notePub !== null && !notePub.ok && (
              <Row label="identity note" tone="warn" testId="verification-live-note-refused">
                {notePub.refusal}
              </Row>
            )}
          </div>
          {foldCount > 0 && (
            <details className={styles.fold} data-testid="verification-live-forensics">
              <summary>{String(foldCount)} provenance row(s)</summary>
              <div className={styles.rows}>
                {!digestGap && (
                  <Row label="substrate digest">
                    <Ident value={status.substrate.substrate_digest} copyLabel="copy substrate digest" />
                  </Row>
                )}
                {notePub?.ok === true && (
                  <Row label="identity note" tone="dim">
                    {notePub.text}
                  </Row>
                )}
              </div>
            </details>
          )}
        </>
      ) : (
        <div className={styles.rows}>
          <Row label="reason" tone="crit">
            {pub(status.reason)}
          </Row>
          <Row label="materialization key" tone="dim" testId="verification-key">
            {EM_DASH} · no batch, no key; never fabricated
          </Row>
        </div>
      )}
    </section>
  );
}

/** The two subject cards, side by side; each "explain" opens the drawer on that subject's evidence chain. */
export function VerificationSubjects({ manifest, onExplain }: SubjectCardProps) {
  return (
    <div className={styles.subjects}>
      <ProofCard manifest={manifest} onExplain={onExplain} />
      <LiveCard manifest={manifest} onExplain={onExplain} />
    </div>
  );
}
