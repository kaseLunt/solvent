"use client";

import { Drawer } from "@/components/kit";
import type { EvidenceDescriptor, EvidenceTone } from "@/lib/evidence";
import { markerLine, VERIFICATION_COPY } from "@/lib/verification-view";
import styles from "./verification.module.css";

const TONE_CLASS: Record<EvidenceTone, string | undefined> = {
  default: undefined,
  ok: styles.vOk,
  warn: styles.vWarn,
  crit: styles.vCrit,
  dim: styles.vDim,
};

export interface VerificationDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The view model's doctrine, paragraph by paragraph, verbatim. */
  doctrine: readonly string[];
  /** A subject's evidence chain when its explain opened the drawer; null from the header's button. */
  descriptor: EvidenceDescriptor | null;
}

/**
 * Methodology & evidence (plan R3): the doctrine the page used to print inline,
 * and — when a subject's explain opened the drawer — that subject's typed
 * evidence chain first: its rows, its comparator verbatim, operational vs
 * proven. Nothing here knows about manifests; the descriptor is lib/evidence's
 * and every heading is the view model's.
 */
export function VerificationDrawer({ open, onClose, doctrine, descriptor }: VerificationDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} title={descriptor === null ? VERIFICATION_COPY.drawerTitle : descriptor.title}>
      <div className={styles.method} data-testid="verification-drawer-body">
        {descriptor !== null && (
          <section data-testid="verification-drawer-evidence">
            <div className={styles.row}>
              <span className={styles.k}>{VERIFICATION_COPY.thisNumber}</span>
              <span className={styles.v}>
                <b>{descriptor.subject}</b>
              </span>
            </div>
            {descriptor.sections.map((section) => (
              <div key={section.title}>
                <h4>{section.title}</h4>
                {section.rows.map((row, index) => (
                  <div key={`${section.title}·${row.label}·${String(index)}`} className={styles.row}>
                    <span className={styles.k}>{row.label}</span>
                    <span className={[styles.v, TONE_CLASS[row.tone ?? "default"]].filter(Boolean).join(" ")}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            <h4>{VERIFICATION_COPY.comparatorHeading}</h4>
            <pre className={styles.comparator}>{descriptor.comparator}</pre>
            <h4>{VERIFICATION_COPY.markerHeading}</h4>
            <p className={styles.disclosure}>{markerLine(descriptor)}</p>
          </section>
        )}
        <h3>{VERIFICATION_COPY.doctrineHeading}</h3>
        {doctrine.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </Drawer>
  );
}
