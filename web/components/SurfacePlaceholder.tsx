import type { ReactNode } from "react";
import styles from "./placeholder.module.css";

export interface SurfacePlaceholderProps {
  /** The mockup's eyebrow ordinal, e.g. "1 · Book". */
  eyebrow: string;
  /** The surface name — the h1 the smoke e2e asserts. */
  name: string;
  /** One-line statement of what the surface is. */
  description: ReactNode;
  /** The data sources, mockup "fed by" grammar. */
  fedBy: ReactNode;
  /** Which wave lands the real surface. */
  wave: string;
}

/**
 * An HONEST placeholder: it names the surface, states what will feed it, and
 * says plainly that the surface has not landed — no fake data, no fake
 * freshness, nothing that could be mistaken for a live view.
 */
export function SurfacePlaceholder({ eyebrow, name, description, fedBy, wave }: SurfacePlaceholderProps) {
  return (
    <section>
      <div className={styles.head}>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{name}</h1>
        <p>{description}</p>
        <p className={styles.fedBy}>fed by {fedBy}</p>
      </div>
      <div className={styles.pending}>
        surface not yet landed — arrives in <b>{wave}</b>. This page is the W0 shell: real
        chrome, real posture ribbon, no pretend data.
      </div>
    </section>
  );
}
