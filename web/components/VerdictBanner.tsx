import type { ReactNode } from "react";
import { verdictBannerModel, type VerdictVariant } from "@/lib/kit";
import styles from "./verdict.module.css";

export interface VerdictBannerProps {
  /**
   * The page-answer variant (canon §4, RATIFIED grammar). A banner whose
   * data is superseded, refused, or partial switches variant — it never
   * silently keeps the happy sentence.
   */
  variant: VerdictVariant;
  /**
   * The ANSWER SENTENCE — a computed finding with its denominator named.
   * Renders at --t-chapter. Banner values wear the exact affordance
   * (`<ExactValue>`) wherever human ≠ exact.
   */
  answer: ReactNode;
  /** What would change the reading: dust split, refusals, coverage. */
  qualification?: ReactNode;
  /**
   * The IDENTITY STRIP — batch · age · coverage · current/projected ·
   * evidence, composed from the chip family. REQUIRED BY LAW: "The banner
   * never renders without its identity strip." A missing or render-empty
   * strip does not throw — the banner renders a structural refusal naming
   * the omission (web/lib/kit.ts `verdictBannerModel`).
   */
  identity: ReactNode;
  testId?: string;
}

/**
 * The verdict banner (canon §4): answer sentence · qualification ·
 * identity strip, 4px left border carrying the variant tone. The
 * acceptance-gate component for all three page compositions.
 */
export function VerdictBanner({ variant, answer, qualification, identity, testId }: VerdictBannerProps) {
  const model = verdictBannerModel(variant, identity);

  if (model.kind === "refusal") {
    return (
      <section
        className={`${styles.verdict} ${styles[model.toneClass]}`}
        data-testid={testId}
        data-variant={variant}
        data-identity-refusal="missing-identity-strip"
      >
        <p className={styles.answer}>{model.answer}</p>
        <p className={styles.qual}>{model.qualification}</p>
      </section>
    );
  }

  return (
    <section
      className={`${styles.verdict} ${styles[model.toneClass]}`}
      data-testid={testId}
      data-variant={variant}
    >
      <p className={styles.answer}>{answer}</p>
      {qualification !== undefined && <p className={styles.qual}>{qualification}</p>}
      {/* data-slot: the strip's stable DOM hook — e2e pins assert it renders
          non-empty on every lawful banner (p1a-6; CSS-module class names are
          not a contract). */}
      <div className={styles.idStrip} data-slot="identity">
        {identity}
      </div>
    </section>
  );
}
