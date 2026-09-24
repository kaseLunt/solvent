"use client";

// The two subjects (the split is the product: a manifest carries two, never one identity), as two kit cards that
// must read as different instruments — the proof card's rule wears the receipt's one tone (ok for an exact proof, warn
// for a drifted receipt, crit for a failed one, the dashed refused rule for a finding withheld or a receipt absent),
// the live card's the live accent, always: the batch it serves is posture, never health. Every word on both cards is
// the view model's (`subjectCards`, lib/verification-view.ts): the status pill, the answer rows with their hazards
// hoisted, the counted provenance fold. This component prints.

import { StatusPill } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { liveSubjectEvidence, proofSubjectEvidence, type EvidenceDescriptor, type EvidenceManifest } from "@/lib/evidence";
import { subjectCards, VERIFICATION_COPY, type CardRow, type CardTone, type SubjectCard } from "@/lib/verification-view";
import { CopyChip } from "./CopyChip";
import styles from "./verification.module.css";

const TONE_CLASS: Record<CardTone, string | undefined> = {
  default: undefined,
  ok: styles.vOk,
  warn: styles.vWarn,
  crit: styles.vCrit,
  refused: styles.vRefused,
  dim: styles.vDim,
};

type Kind = "proof" | "live";

function Row({ row }: { row: CardRow }) {
  return (
    <div className={styles.row} data-testid={row.id === undefined ? undefined : `verification-${row.id}`}>
      <span className={styles.k}>{row.label}</span>
      <span className={[styles.v, TONE_CLASS[row.tone]].filter(Boolean).join(" ")} data-tone={row.tone} title={row.title}>
        {row.copy === undefined ? (
          row.value
        ) : (
          // A full identifier with its copy affordance. Wrapping is presentation; the copy is whole.
          <span className={styles.ident}>
            <span className={styles.mono}>{row.value}</span>
            <CopyChip text={row.value} label={row.copy} />
          </span>
        )}
      </span>
    </div>
  );
}

function Rows({ rows }: { rows: readonly CardRow[] }) {
  return (
    <div className={styles.rows}>
      {rows.map((row) => (
        <Row key={`${row.label}·${row.value}`} row={row} />
      ))}
    </div>
  );
}

function SubjectCardView({ kind, card, onExplain }: { kind: Kind; card: SubjectCard; onExplain: () => void }) {
  return (
    <section className={`${kit.card} ${styles.subject}`} data-rule={card.rule} data-testid={`verification-subject-${kind}`}>
      <div className={kit.cardT}>
        <div className={styles.cardHead}>
          <h3>{card.title}</h3>
          <span data-testid={`verification-${kind}-status`}>
            <StatusPill tone={card.status.tone}>{card.status.text}</StatusPill>
          </span>
        </div>
        <button type="button" aria-label={card.explain} onClick={onExplain} data-testid={`verification-${kind}-explain`}>
          {VERIFICATION_COPY.explain}
        </button>
      </div>
      {card.takeaway !== null && (
        <p className={styles.takeaway} data-testid={`verification-${kind}-takeaway`}>
          {card.takeaway}
        </p>
      )}
      <Rows rows={card.rows} />
      {card.fold !== null && (
        <details className={styles.fold} data-testid={`verification-${kind}-forensics`}>
          <summary>{card.fold.summary}</summary>
          {card.fold.sections.map((section, index) => (
            <div key={section.title ?? String(index)}>
              {section.title !== null && <div className={styles.foldSection}>{section.title}</div>}
              <Rows rows={section.rows} />
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

export interface VerificationSubjectsProps {
  manifest: EvidenceManifest;
  onExplain: (descriptor: EvidenceDescriptor) => void;
}

/** The two subject cards, side by side; each Explain opens the drawer on that subject's evidence chain. */
export function VerificationSubjects({ manifest, onExplain }: VerificationSubjectsProps) {
  const cards = subjectCards(manifest);
  return (
    <div className={styles.subjects}>
      <SubjectCardView kind="proof" card={cards.proof} onExplain={() => onExplain(proofSubjectEvidence(manifest))} />
      <SubjectCardView kind="live" card={cards.live} onExplain={() => onExplain(liveSubjectEvidence(manifest))} />
    </div>
  );
}
