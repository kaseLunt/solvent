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
  proofTakeaway,
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

  // W-3L (inventory 446): a pub() refusal is ITSELF a refusal and may not
  // hide behind the fold — every artifact-derived string destined for the
  // forensic layer is checked here, and a refused one hoists out.
  const reconcile = status.kind === "unavailable" ? null : status.reconcile;
  const artifactPub = reconcile === null ? null : publishable(reconcile.artifact_path);
  const receiptNotePub = reconcile === null ? null : publishable(reconcile.note);
  const feedsPathPub = publishable(feeds.path);
  const foldCount =
    (reconcile === null
      ? 0
      : 4 + (artifactPub?.ok === true ? 1 : 0) + (receiptNotePub?.ok === true ? 1 : 0)) +
    6 +
    2 +
    (feedsPathPub.ok ? 1 : 0);

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
        the pinned, exactly-reproducible acceptance evidence: the committed reconcile receipt and
        the build it speaks for. Never the live batch.
      </p>

      <div className={styles.subjectBody}>
        {status.kind === "accepted" && (
          <Row label="status" tone="ok" testId="proof-status">
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

        {/* W-3L (inventory 446): the ANSWER layer stays visible — gated
            rows with their drift, every per-engine weld, and the
            fingerprint weld; pure provenance folds below, counted. */}
        {reconcile !== null && (
          <>
            <Row label="gated rows" tone={reconcile.gated_drift === 0 ? "ok" : "crit"}>
              {String(reconcile.gated_exact)}/{String(reconcile.gated_rows)} exact ·
              drift {String(reconcile.gated_drift)}
            </Row>
            {reconcile.welds.map((weld) => (
              <Row
                key={weld.engine}
                label={`weld · ${weld.engine}`}
                tone={weld.rows_exact === weld.rows_compared ? "ok" : "crit"}
                testId={`weld-${weld.engine}`}
              >
                {String(weld.rows_exact)}/{String(weld.rows_compared)} exact
              </Row>
            ))}
          </>
        )}
        <Row label="fingerprint weld" tone={fingerprintWelded ? "ok" : "crit"}>
          {fingerprintWelded
            ? "identical to service fingerprint, by construction"
            : "MISMATCH against service fingerprint, which the contract says are identical by construction"}
        </Row>

        {/* Hoisted pub() refusals — a withheld value is a refusal and
            renders OUTSIDE the fold, exactly when it strikes. */}
        {artifactPub !== null && !artifactPub.ok && (
          <Row label="artifact" tone="warn" testId="proof-artifact-refused">
            {artifactPub.refusal}
          </Row>
        )}
        {receiptNotePub !== null && !receiptNotePub.ok && (
          <Row label="receipt note" tone="warn" testId="proof-note-refused">
            {receiptNotePub.refusal}
          </Row>
        )}
        {!feedsPathPub.ok && (
          <Row label="feeds registry path" tone="warn" testId="feeds-path-refused">
            {feedsPathPub.refusal}
          </Row>
        )}

        <details className={styles.cardForensics} data-testid="proof-subject-forensics">
          <summary>{String(foldCount)} provenance row(s)</summary>
          {reconcile !== null && (
            <>
              <div className={styles.cardSection}>RECEIPT · COMMITTED ARTIFACT</div>
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
            </>
          )}

          <div className={styles.cardSection}>BUILD · CONFIG IDENTITY</div>
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

          <div className={styles.cardSection}>FEEDS REGISTRY</div>
          {feedsPathPub.ok && <Row label="path">{feedsPathPub.text}</Row>}
          <Row label="registry fingerprint">
            <Ident value={feeds.registry_fingerprint} copyLabel="copy registry fingerprint" />
          </Row>
          <Row label="file sha256">
            <Ident value={feeds.file_sha256} copyLabel="copy feeds file sha256" />
          </Row>
        </details>
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
  // W-3L (inventory 453): the digest's predates-custody gap and a refused
  // identity note are hazards and render OUTSIDE the fold.
  const notePub = status.kind === "serving" ? publishable(status.substrate.note) : null;
  const digestGap = status.kind === "serving" && status.substrate.substrate_digest === "";
  const liveFoldCount = (digestGap ? 0 : 1) + (notePub?.ok === true ? 1 : 0);

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
        the currently-serving batch&apos;s identity: watermarked, operational, and NOT
        reconcile-welded. Exactness lives on the proof subject, at its pin.
      </p>

      <div className={styles.subjectBody}>
        {status.kind === "serving" ? (
          <>
            {/* W-3L (inventory 453): takeaway = the serving batch id +
                status; the key with its copy affordance stays visible;
                pure provenance folds, counted. */}
            <p className={styles.cardTakeaway} data-testid="live-takeaway">
              serving batch #{String(status.substrate.batch_id)} · watermarked, operational —
              never the proof
            </p>
            <Row label="materialization key" testId="materialization-key">
              <Ident
                value={status.substrate.materialization_key}
                copyLabel="copy materialization key"
              />
            </Row>
            {digestGap && (
              <Row label="substrate digest" tone="dim" testId="live-digest-gap">
                {`${EM_DASH} (predates substrate-digest custody, so this is an honest gap rather than a digest)`}
              </Row>
            )}
            {notePub !== null && !notePub.ok && (
              <Row label="identity note" tone="warn" testId="live-note-refused">
                {notePub.refusal}
              </Row>
            )}
            {liveFoldCount > 0 && (
              <details className={styles.cardForensics} data-testid="live-subject-forensics">
                <summary>{String(liveFoldCount)} provenance row(s)</summary>
                {!digestGap && (
                  <Row label="substrate digest">
                    <Ident
                      value={status.substrate.substrate_digest}
                      copyLabel="copy substrate digest"
                    />
                  </Row>
                )}
                {notePub?.ok === true && (
                  <Row label="identity note" tone="dim">
                    {notePub.text}
                  </Row>
                )}
              </details>
            )}
          </>
        ) : (
          <>
            <Row label="reason" tone="crit">
              {pub(status.reason)}
            </Row>
            <Row label="materialization key" tone="dim" testId="materialization-key">
              {EM_DASH} · no batch, no key; never fabricated
            </Row>
          </>
        )}
      </div>
    </section>
  );
}

// W-3L (inventory 460): the record COUNT is the takeaway; lawful paths and
// notes fold, counted. The empty arm stays visible — an empty probe list is
// a statement about the deployment, not an absence to hide — and any pub()
// refusal hoists out of the fold, because a publishability refusal is
// itself a refusal.
function ProbeRecordsCard({ manifest }: { manifest: EvidenceManifest }) {
  const records = manifest.probe_records.map((record) => ({
    record,
    pathPub: publishable(record.path),
    notePub: publishable(record.note),
  }));
  const refusedRecords = records.filter((entry) => !entry.pathPub.ok || !entry.notePub.ok);
  const lawfulRecords = records.filter((entry) => entry.pathPub.ok && entry.notePub.ok);
  const notes = manifest.notes.map((note) => ({ note, notePub: publishable(note) }));
  const refusedNotes = notes.filter((entry) => !entry.notePub.ok);
  const lawfulNotes = notes.filter((entry) => entry.notePub.ok);

  return (
    <section className={styles.subjectCard}>
      <h2 className={styles.subjectTitle}>
        <b>COMMITTED PROBE RECORDS</b>
      </h2>
      <p className={styles.cardTakeaway} data-testid="probe-records-takeaway">
        {String(manifest.probe_records.length)} committed probe record(s)
        {manifest.notes.length > 0 && ` · ${String(manifest.notes.length)} manifest note(s)`}
      </p>

      {manifest.probe_records.length === 0 && (
        <p className={styles.recordNote} data-testid="probe-records-empty">
          none named by this deployment&apos;s manifest — a statement about the deployment, not
          an absence to hide.
        </p>
      )}

      {(refusedRecords.length > 0 || refusedNotes.length > 0) && (
        <ul className={styles.recordList} data-testid="probe-records-refused">
          {refusedRecords.map((entry) => (
            <li key={entry.record.path} className={styles.recordItem}>
              <span className={styles.recordPath}>
                {entry.pathPub.ok ? entry.pathPub.text : entry.pathPub.refusal}
              </span>
              <span className={styles.recordNote}>
                {entry.notePub.ok ? entry.notePub.text : entry.notePub.refusal}
              </span>
            </li>
          ))}
          {refusedNotes.map((entry) => (
            <li key={entry.note} className={styles.recordItem}>
              <span className={styles.recordNote}>{entry.notePub.ok ? "" : entry.notePub.refusal}</span>
            </li>
          ))}
        </ul>
      )}

      {(lawfulRecords.length > 0 || lawfulNotes.length > 0) && (
        <details className={styles.cardForensics} data-testid="probe-records-forensics">
          <summary>
            {String(lawfulRecords.length)} record path(s) + {String(lawfulNotes.length)} note(s)
          </summary>
          {lawfulRecords.length > 0 && (
            <ul className={styles.recordList} data-testid="probe-records">
              {lawfulRecords.map((entry) => (
                <li key={entry.record.path} className={styles.recordItem}>
                  <span className={styles.recordPath}>
                    {entry.pathPub.ok ? entry.pathPub.text : ""}
                  </span>
                  <span className={styles.recordNote}>
                    {entry.notePub.ok ? entry.notePub.text : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lawfulNotes.length > 0 && (
            <ul className={styles.notesList}>
              {lawfulNotes.map((entry) => (
                <li key={entry.note}>{entry.notePub.ok ? entry.notePub.text : ""}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}

// r81: the stampline derives from the SAME live-status derivation the head
// and card use — never raw substrate. Under a contradiction-demoted
// manifest (wire no_batch beside a non-null substrate) a raw-substrate
// branch kept a batch pin inline while the head said NO SERVABLE BATCH —
// two mutually exclusive answers on one page.
//
// W-3L (inventory 474): the shared keepOpen split — the batch pin is
// identity and stays inline; the em-dash batch/key pins under a no-batch
// status are hazards and never fold; a crit-toned receipt pin stays
// inline by tone.
function ProofStampline({ manifest }: { manifest: EvidenceManifest }) {
  const live = liveSubjectStatus(manifest);
  return (
    <Stampline collapse>
      <StampItem
        label="batch"
        value={live.kind === "serving" ? `#${String(live.substrate.batch_id)}` : EM_DASH}
        tone={live.kind === "serving" ? "default" : "dim"}
        keepOpen
      />
      <StampItem
        label="key"
        keepOpen={live.kind !== "serving"}
        value={
          live.kind === "serving" ? (
            <Ident
              value={live.substrate.materialization_key}
              copyLabel="copy materialization key from stampline"
            />
          ) : (
            EM_DASH
          )
        }
        tone={live.kind === "serving" ? "default" : "dim"}
        note={
          live.kind === "serving" ? undefined : "(no servable batch, and nothing fabricated)"
        }
      />
      <StampItem
        label="commit"
        value={manifest.commit ?? EM_DASH}
        tone={manifest.commit === null ? "dim" : "default"}
      />
      <StampItem
        label="receipt"
        value={
          manifest.reconcile === null
            ? "absent"
            : `${manifest.reconcile.result} · ${String(manifest.reconcile.gated_exact)}/${String(manifest.reconcile.gated_rows)}`
        }
        tone={
          manifest.reconcile !== null && proofSubjectStatus(manifest).kind === "accepted"
            ? "ok"
            : "crit"
        }
      />
    </Stampline>
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
        {/* W-3L (inventory 439): both subjects' statuses in one computed
            sentence — BY LAW both failing arms surface here. The adjudicated
            intro below is the method line. */}
        {state.phase === "ok" && (
          <p className={styles.takeaway} data-testid="proof-head-takeaway">
            {proofTakeaway(state.manifest)}
          </p>
        )}
        <p>
          What this deployment is, exactly: the pinned proof of its last reconcile and the
          identity of the batch it serves now. Nothing here is measured on request: every field
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
            · the manifest could not be fetched. Nothing is substituted for it: no cached proof,
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

          <ProbeRecordsCard manifest={state.manifest} />

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

          <ProofStampline manifest={state.manifest} />
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
