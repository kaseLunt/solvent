import type { LiquidationVerdict } from "@solvent/client";
import { hfSeverity } from "@/lib/severity";
import { EM_DASH } from "@/lib/format";
import styles from "./primitives.module.css";

export interface SeverityHFProps {
  /**
   * The engine's sealed verdict from @solvent/client's refine layer.
   * Crit renders ONLY when this says `liquidatable` — the UI never re-derives
   * liquidatability from the display ratio.
   */
  verdict: LiquidationVerdict;
  /** The exact display string for the HF (e.g. "1.043"). Null renders an em dash. */
  display: string | null;
  /**
   * Display-precision ratio for the warn band only (lib/severity's
   * WARN_HF_RATIO). Never used for crit.
   */
  ratio?: number | null;
  /** No debt: the ratio is unbounded. Renders ∞, dim, no swatch. */
  infinite?: boolean;
}

/**
 * The mockup's `.sev` swatch + `.hf` value: severity as color AND form.
 *
 *   crit  — the engine's own comparator said liquidatable
 *   warn  — healthy but inside the presentation warn band
 *   ok    — healthy
 *   none  — unknowable (em dash, no color: an unestablished verdict is not
 *           a green light) or infinite (∞, dim)
 */
export function SeverityHF({ verdict, display, ratio, infinite }: SeverityHFProps) {
  if (infinite === true) {
    return (
      <span className={`${styles.hf} ${styles.none}`} title="no debt — the ratio is unbounded">
        ∞
      </span>
    );
  }

  const severity = hfSeverity({ verdict, ratio: ratio ?? null, infinite: infinite ?? false });

  if (verdict === "unknowable") {
    return (
      <span className={`${styles.hf} ${styles.none}`} title="cannot be established">
        {EM_DASH}
      </span>
    );
  }

  const text = display ?? (verdict === "liquidatable" ? "liquidatable" : EM_DASH);
  return (
    <>
      {severity !== "none" && <span className={`${styles.sev} ${styles[severity]}`} aria-hidden />}
      <span className={`${styles.hf} ${severity === "none" ? styles.none : styles[severity]}`}>
        {text}
      </span>
    </>
  );
}
