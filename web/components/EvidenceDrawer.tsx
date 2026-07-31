"use client";

// The reusable explain-this-number drawer: a Drawer fed by a TYPED
// EvidenceDescriptor (lib/evidence.ts). The Inspector builds descriptors from
// positions; the Proof Center (W6) builds them from /v1/evidence — nothing
// here knows about positions or manifests.
//
// Lifted from app/inspector/[addr]/ in W6 (the sanctioned move): the
// component and its styles now live in components/, shared by both surfaces.

import type { ReactNode } from "react";
import { Drawer } from "./Drawer";
import type { EvidenceDescriptor, EvidenceTone } from "@/lib/evidence";
import styles from "./evidence.module.css";

const TONE_CLASS: Record<EvidenceTone, string | undefined> = {
  default: undefined,
  ok: styles.vOk,
  warn: styles.vWarn,
  crit: styles.vCrit,
  dim: styles.vDim,
};

function valueClass(tone: EvidenceTone | undefined): string {
  const base = styles.v ?? "";
  const extra = TONE_CLASS[tone ?? "default"];
  return extra === undefined ? base : `${base} ${extra}`;
}

export interface EvidenceDrawerProps {
  /** The open state: a descriptor renders the drawer; null closes it. */
  descriptor: EvidenceDescriptor | null;
  onClose: () => void;
}

export function EvidenceDrawer({ descriptor, onClose }: EvidenceDrawerProps) {
  return (
    <Drawer open={descriptor !== null} onClose={onClose} title={descriptor?.title ?? "EXPLAIN"}>
      {descriptor !== null && (
        <div data-testid="evidence-drawer">
          <div className={styles.kvRow}>
            <span className={styles.k}>this number</span>
            <span className={styles.v}>
              <b>{descriptor.subject}</b>
            </span>
          </div>

          {descriptor.sections.map((section) => (
            <section key={section.title}>
              <div className={styles.sectionHead}>{section.title}</div>
              <div className={styles.kv}>
                {section.rows.map((row, index) => (
                  <div key={`${section.title}·${row.label}·${String(index)}`} className={styles.kvRow}>
                    <span className={styles.k}>{row.label}</span>
                    <span className={valueClass(row.tone)}>{row.value}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <div className={styles.sectionHead}>COMPARATOR — VERBATIM</div>
          <pre className={`${styles.formula} ${styles.comparatorFormula}`}>
            {descriptor.comparator}
          </pre>

          <div className={styles.sectionHead}>OPERATIONAL VS PROVEN</div>
          <p className={styles.disclosure}>
            {descriptor.marker === "operational" ? "OPERATIONAL — " : "PROVEN — "}
            {descriptor.markerNote}
          </p>
        </div>
      )}
    </Drawer>
  );
}

export interface ExplainButtonProps {
  /** Accessible name, e.g. "explain health factor". */
  label: string;
  onExplain: () => void;
  children: ReactNode;
}

/** A number that opens its evidentiary chain: dotted underline, mono, no chrome. */
export function ExplainButton({ label, onExplain, children }: ExplainButtonProps) {
  return (
    <button type="button" className={styles.explain} onClick={onExplain} aria-label={label}>
      {children}
    </button>
  );
}
