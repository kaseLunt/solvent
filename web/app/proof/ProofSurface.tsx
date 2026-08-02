"use client";

// The Proof Center (W6, spec §3.6) — where the Truth layer culminates.
// PROOF · EXACT @ PIN renders HERE, fed by /v1/evidence, and nowhere else:
// every other surface's drawer says the materialization key and the proof
// marker are "published by /v1/evidence" — this surface keeps that promise.
//
// THE SPLIT IS THE PRODUCT (plan AMENDMENT 1): the manifest carries two
// subjects and they render as two instruments —
//
//   PROOF SUBJECT  the committed reconcile receipt + the build/config
//                  identity it speaks for. Gets the PROOF · EXACT @ PIN
//                  badge ONLY on an unqualified pass; anything else renders
//                  its status loudly (a failed or missing receipt is a
//                  first-class state, not an error toast).
//   LIVE SUBJECT   the currently-serving batch's identity: batch id,
//                  materialization key (with the copy affordance W1's
//                  stampline em-dashes toward), substrate digest. Always
//                  OPERATIONAL — it never inherits the proof's exactness.
//
// Publishability: every artifact-derived string renders through
// `publishable()` — an endpoint-URL/DSN-shaped fragment is refused at render
// (the contract publishes env-var names only).

import { useEffect, useState } from "react";
import Link from "next/link";
import { solventBaseUrl } from "@/lib/api";
import {
  liveSubjectEvidence,
  liveSubjectStatus,
  proofPin,
  proofSubjectEvidence,
  proofSubjectStatus,
  type EvidenceDescriptor,
  type EvidenceManifest,
} from "@/lib/evidence";
import { fetchEvidence, publishable, ProofFetchError } from "@/lib/proof-data";
import { EM_DASH } from "@/lib/format";
import { EvidenceDrawer, ExplainButton } from "@/components/EvidenceDrawer";
import { Ribbon } from "@/components/Ribbon";
import { Stampline, StampItem } from "@/components/Stampline";
import { CopyChip } from "./CopyChip";
import kv from "@/components/evidence.module.css";
import styles from "./proof.module.css";

type ProofState =
  | { phase: "loading" }
  | { phase: "ok"; manifest: EvidenceManifest }
  | { phase: "error"; message: string; retryAfterSeconds: number | null };

/** Publishability-checked render of an artifact-derived string. */
function pub(text: string): string {
  const checked = publishable(text);
  return checked.ok ? checked.text : checked.refusal;
}

type Tone = "default" | "ok" | "warn" | "crit" | "dim";

const TONE_CLASS: Record<Tone, string | undefined> = {
  default: undefined,
  ok: kv.vOk,
  warn: kv.vWarn,
  crit: kv.vCrit,
  dim: kv.vDim,
};

function Row({
  label,
  tone = "default",
  testId,
  children,
}: {
  label: string;
  tone?: Tone;
  testId?: string;
  children: React.ReactNode;
}) {
  const extra = TONE_CLASS[tone];
  return (
    <div className={kv.kvRow} data-testid={testId}>
      <span className={kv.k}>{label}</span>
      <span className={extra === undefined ? kv.v : `${kv.v} ${extra}`}>{children}</span>
    </div>
  );
}

/** A full identifier with its copy affordance. Truncation is presentation; the copy is whole. */
function Ident({ value, copyLabel }: { value: string; copyLabel: string }) {
  return (
    <span className={styles.ident}>
      <span className={styles.identText}>{value}</span>
      <CopyChip text={value} label={copyLabel} />
    </span>
  );
}

function ProofSubjectCard({
  manifest,
  onExplain,
}: {
  manifest: EvidenceManifest;
  onExplain: (descriptor: EvidenceDescriptor) => void;
}) {
  const status = proofSubjectStatus(manifest);
  const service = manifest.service;
  const feeds = manifest.feeds_registry;
  const fingerprintWelded = feeds.registry_fingerprint === service.registry_fingerprint;

  return (
    <section className={`${styles.subjectCard} ${styles.proofCard}`} data-testid="proof-subject">
      <h2 className={styles.subjectTitle}>
        <b>PROOF SUBJECT</b>
        {status.kind === "accepted" ? (
          <Ribbon mode="proof" pin={proofPin(status.reconcile)} />
        ) : status.kind === "rejected" ? (
          <span className={`${styles.statusChip} ${styles.statusCrit}`} data-testid="proof-status">
            RECEIPT REJECTED
          </span>
        ) : (
          <span className={`${styles.statusChip} ${styles.statusRefused}`} data-testid="proof-status">
            NO COMMITTED RECEIPT
          </span>
        )}
        <ExplainButton label="explain proof subject" onExplain={() => { onExplain(proofSubjectEvidence(manifest)); }}>
          explain
        </ExplainButton>
      </h2>
      <p className={styles.subjectCaption}>
        the pinned, exactly-reproducible acceptance evidence — the committed reconcile receipt and
        the build it speaks for. Never the live batch.
      </p>

      <div className={styles.subjectBody}>
        {status.kind === "accepted" && (
          <Row label="status" tone="ok" testId="proof-status">
            ACCEPTED — every gated row welded exact
          </Row>
        )}
        {status.kind === "rejected" && (
          <Row label="status" tone="crit">
            REJECTED — {status.detail}
          </Row>
        )}
        {status.kind === "unavailable" && (
          <Row label="status" tone="crit">
            UNAVAILABLE — {pub(status.reason)}
          </Row>
        )}

        {status.kind !== "unavailable" && (
          <>
            <div className={styles.cardSection}>RECEIPT — COMMITTED ARTIFACT</div>
            <Row label="result · exit">
              {status.reconcile.result} · {String(status.reconcile.exit_code)}
            </Row>
            <Row label="finished_at">{status.reconcile.finished_at}</Row>
            <Row label="gated rows" tone={status.reconcile.gated_drift === 0 ? "ok" : "crit"}>
              {String(status.reconcile.gated_exact)}/{String(status.reconcile.gated_rows)} exact ·
              drift {String(status.reconcile.gated_drift)}
            </Row>
            <Row label="advisory rows" tone="dim">
              {String(status.reconcile.advisory_rows)}
            </Row>
            {status.reconcile.welds.map((weld) => (
              <Row
                key={weld.engine}
                label={`weld · ${weld.engine}`}
                tone={weld.rows_exact === weld.rows_compared ? "ok" : "crit"}
                testId={`weld-${weld.engine}`}
              >
                {String(weld.rows_exact)}/{String(weld.rows_compared)} exact
              </Row>
            ))}
            <Row label="comparison sha256">
              <Ident value={status.reconcile.comparison_sha256} copyLabel="copy comparison sha256" />
            </Row>
            <Row label="artifact">{pub(status.reconcile.artifact_path)}</Row>
            <Row label="receipt note" tone="dim">
              {pub(status.reconcile.note)}
            </Row>
          </>
        )}

        <div className={styles.cardSection}>BUILD · CONFIG IDENTITY</div>
        <Row label="commit" tone={manifest.commit === null ? "dim" : "default"}>
          {manifest.commit === null ? (
            `${EM_DASH} (no build stamp — never guessed)`
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

        <div className={styles.cardSection}>FEEDS REGISTRY</div>
        <Row label="path">{pub(feeds.path)}</Row>
        <Row label="registry fingerprint">
          <Ident value={feeds.registry_fingerprint} copyLabel="copy registry fingerprint" />
        </Row>
        <Row label="file sha256">
          <Ident value={feeds.file_sha256} copyLabel="copy feeds file sha256" />
        </Row>
        <Row label="fingerprint weld" tone={fingerprintWelded ? "ok" : "crit"}>
          {fingerprintWelded
            ? "identical to service fingerprint — by construction"
            : "MISMATCH against service fingerprint — the contract says these are identical by construction"}
        </Row>
      </div>
    </section>
  );
}

function LiveSubjectCard({
  manifest,
  onExplain,
}: {
  manifest: EvidenceManifest;
  onExplain: (descriptor: EvidenceDescriptor) => void;
}) {
  const status = liveSubjectStatus(manifest);

  return (
    <section className={`${styles.subjectCard} ${styles.liveCard}`} data-testid="live-subject">
      <h2 className={styles.subjectTitle}>
        <b>LIVE SUBJECT</b>
        {status.kind === "serving" ? (
          <span className={`${styles.statusChip} ${styles.statusOk}`} data-testid="live-status">
            <i className={styles.liveDot} aria-hidden />
            SERVING · WATERMARKED
          </span>
        ) : (
          <span className={`${styles.statusChip} ${styles.statusCrit}`} data-testid="live-status">
            NO SERVABLE BATCH
          </span>
        )}
        <ExplainButton label="explain live subject" onExplain={() => { onExplain(liveSubjectEvidence(manifest)); }}>
          explain
        </ExplainButton>
      </h2>
      <p className={styles.subjectCaption}>
        the currently-serving batch&apos;s identity — watermarked, operational, and NOT
        reconcile-welded. Exactness lives on the proof subject, at its pin.
      </p>

      <div className={styles.subjectBody}>
        {status.kind === "serving" ? (
          <>
            <Row label="batch">#{String(status.substrate.batch_id)}</Row>
            <Row label="materialization key" testId="materialization-key">
              <Ident
                value={status.substrate.materialization_key}
                copyLabel="copy materialization key"
              />
            </Row>
            <Row
              label="substrate digest"
              tone={status.substrate.substrate_digest === "" ? "dim" : "default"}
            >
              {status.substrate.substrate_digest === "" ? (
                `${EM_DASH} (predates substrate-digest custody — an honest gap, not a digest)`
              ) : (
                <Ident
                  value={status.substrate.substrate_digest}
                  copyLabel="copy substrate digest"
                />
              )}
            </Row>
            <Row label="identity note" tone="dim">
              {pub(status.substrate.note)}
            </Row>
          </>
        ) : (
          <>
            <Row label="reason" tone="crit">
              {pub(status.reason)}
            </Row>
            <Row label="materialization key" tone="dim" testId="materialization-key">
              {EM_DASH} — no batch, no key; never fabricated
            </Row>
          </>
        )}
      </div>
    </section>
  );
}

export function ProofSurface() {
  const [state, setState] = useState<ProofState>({ phase: "loading" });
  const [descriptor, setDescriptor] = useState<EvidenceDescriptor | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchEvidence(solventBaseUrl(), controller.signal)
      .then((manifest) => {
        setState({ phase: "ok", manifest });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ProofFetchError) {
          setState({
            phase: "error",
            message: cause.message,
            retryAfterSeconds: cause.retryAfterSeconds,
          });
          return;
        }
        setState({
          phase: "error",
          message: cause instanceof Error ? cause.message : String(cause),
          retryAfterSeconds: null,
        });
      });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <>
      {/* Wave R1 items 6 + 10: no numbered eyebrow, the H1 is the surface's
          own name, and the intro is the adjudicated copy. */}
      <div className={styles.head}>
        <h1>Proof</h1>
        <p>
          What this deployment is, exactly: the pinned proof of its last reconcile and the
          identity of the batch it serves now. Nothing here is measured on request — every field
          is carried by the build or persisted by a batch.
        </p>
        <p className={styles.crossLink}>
          contract + samples → <Link href="/developers">Developers</Link>
        </p>
      </div>

      {state.phase === "loading" && (
        <div className={styles.panel}>
          <div className={styles.emptyReason} data-testid="proof-loading">
            loading /v1/evidence…
          </div>
        </div>
      )}

      {state.phase === "error" && (
        <div className={styles.warnStrip} role="alert" data-testid="proof-unavailable">
          <b>EVIDENCE UNAVAILABLE</b>
          <span>
            {state.message}
            {state.retryAfterSeconds !== null &&
              ` (retry after ${String(state.retryAfterSeconds)}s)`}{" "}
            — the manifest could not be fetched. Nothing is substituted for it: no cached proof,
            no assumed batch, no fabricated key.
          </span>
        </div>
      )}

      {state.phase === "ok" && (
        <>
          <div className={styles.subjects}>
            <ProofSubjectCard manifest={state.manifest} onExplain={setDescriptor} />
            <LiveSubjectCard manifest={state.manifest} onExplain={setDescriptor} />
            <p className={styles.splitStrip} data-testid="subject-split">
              <b>TWO SUBJECTS, NEVER ONE.</b> The proof speaks for its pinned run; the live batch
              serves under its watermark vector. A green receipt does not make the live batch
              exact, and a serving batch does not refresh the proof.
            </p>
          </div>

          <section className={styles.subjectCard}>
            <h2 className={styles.subjectTitle}>
              <b>COMMITTED PROBE RECORDS</b>
            </h2>
            <ul className={styles.recordList} data-testid="probe-records">
              {state.manifest.probe_records.length === 0 ? (
                <li className={styles.recordItem}>
                  <span className={styles.recordNote}>
                    none named by this deployment&apos;s manifest
                  </span>
                </li>
              ) : (
                state.manifest.probe_records.map((record) => (
                  <li key={record.path} className={styles.recordItem}>
                    <span className={styles.recordPath}>{pub(record.path)}</span>
                    <span className={styles.recordNote}>{pub(record.note)}</span>
                  </li>
                ))
              )}
            </ul>
            {state.manifest.notes.length > 0 && (
              <ul className={styles.notesList}>
                {state.manifest.notes.map((note) => (
                  <li key={note}>{pub(note)}</li>
                ))}
              </ul>
            )}
          </section>

          <button
            type="button"
            className={styles.rawToggle}
            onClick={() => {
              setShowRaw((current) => !current);
            }}
            aria-pressed={showRaw}
            data-testid="raw-json-toggle"
          >
            {showRaw ? "hide raw JSON" : "raw JSON"}
          </button>
          {showRaw && (
            <pre className={styles.rawJson} data-testid="raw-json">
              {JSON.stringify(state.manifest, null, 2)}
            </pre>
          )}

          <Stampline>
            <StampItem
              label="batch"
              value={
                state.manifest.substrate === null
                  ? EM_DASH
                  : `#${String(state.manifest.substrate.batch_id)}`
              }
              tone={state.manifest.substrate === null ? "dim" : "default"}
            />
            <StampItem
              label="key"
              value={
                state.manifest.substrate === null ? (
                  EM_DASH
                ) : (
                  <Ident
                    value={state.manifest.substrate.materialization_key}
                    copyLabel="copy materialization key from stampline"
                  />
                )
              }
              tone={state.manifest.substrate === null ? "dim" : "default"}
              note={state.manifest.substrate === null ? "(no servable batch — not fabricated)" : undefined}
            />
            <StampItem
              label="commit"
              value={state.manifest.commit ?? EM_DASH}
              tone={state.manifest.commit === null ? "dim" : "default"}
            />
            <StampItem
              label="receipt"
              value={
                state.manifest.reconcile === null
                  ? "absent"
                  : `${state.manifest.reconcile.result} · ${String(state.manifest.reconcile.gated_exact)}/${String(state.manifest.reconcile.gated_rows)}`
              }
              tone={
                state.manifest.reconcile !== null &&
                proofSubjectStatus(state.manifest).kind === "accepted"
                  ? "ok"
                  : "crit"
              }
            />
          </Stampline>
        </>
      )}

      <EvidenceDrawer
        descriptor={descriptor}
        onClose={() => {
          setDescriptor(null);
        }}
      />
    </>
  );
}
