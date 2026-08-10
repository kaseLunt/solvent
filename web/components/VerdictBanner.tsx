import type { ReactNode } from "react";
import { verdictBannerModel, type VerdictIdentityModel, type VerdictVariant } from "@/lib/kit";
import { ChipVal, StatusChip } from "./StatusChip";
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
   * The IDENTITY STRIP as a TYPED MODEL (p1a-9): the §4 fields — batch ·
   * age · coverage · current/projected · evidence — each an optional clause;
   * the banner renders the strip ITSELF from the chip family. REQUIRED BY
   * LAW: "The banner never renders without its identity strip." A missing
   * or all-blank model does not throw — the banner renders a structural
   * refusal naming the omission (web/lib/kit.ts `verdictBannerModel`). The
   * old ReactNode identity is RETIRED: an unrendered node tree could smuggle
   * a render-empty strip (an empty fragment) past the law; a typed model
   * cannot.
   */
  identity: VerdictIdentityModel | null;
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
          not a contract). The chips come verbatim from the pure model, in the
          canon's §4 order. */}
      <div className={styles.idStrip} data-slot="identity">
        {model.identity.map((chip) => (
          <StatusChip key={chip.slot} tone={chip.tone}>
            {chip.text}
            {chip.value !== null && (
              <>
                {chip.text !== null && " "}
                <ChipVal>{chip.value}</ChipVal>
              </>
            )}
            {chip.suffix !== null && <> {chip.suffix}</>}
          </StatusChip>
        ))}
      </div>
    </section>
  );
}
