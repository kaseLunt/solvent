import styles from "./ribbon.module.css";

// The integrity Ribbon — spec §3.6. Two modes, rendered distinctly:
//
//   LIVE · WATERMARKED   the live posture. Its payload is a watermark VECTOR
//                        of named as-ofs (per-engine stamps, sweep age, …).
//                        There is deliberately NO single-block prop: a global
//                        "live at block N" does not exist in this system and
//                        cannot be rendered by this component.
//
//   PROOF · EXACT @ PIN  reconcile-welded numbers at an exact pin.

export interface RibbonAsOf {
  /** The input's name, e.g. "aave_v3", "debt_manager", "sweep". */
  label: string;
  /** Its OWN as-of, e.g. "@25,641,730", "age 41s". */
  value: string;
  tone?: "default" | "ok" | "warn" | "crit" | "dim";
}

export type RibbonProps =
  | {
      mode: "live";
      /** The watermark vector. Every entry names its own as-of. */
      asOfs: readonly RibbonAsOf[];
      /** Current batch is superseded — render the warning inline. */
      superseded?: boolean;
    }
  | {
      mode: "proof";
      /** The exact pin, e.g. "bk_019fb0a2" or a block pin. */
      pin: string;
      /** e.g. "reconcile 12/12 exact". */
      detail?: string;
    };

export function Ribbon(props: RibbonProps) {
  if (props.mode === "proof") {
    return (
      <span className={styles.ribbon}>
        <span className={`${styles.badge} ${styles.proof}`}>PROOF · EXACT @ {props.pin}</span>
        {props.detail !== undefined && <span className={styles.asOf}>{props.detail}</span>}
      </span>
    );
  }

  return (
    <span className={styles.ribbon}>
      <span className={`${styles.badge} ${styles.live}`}>
        <i className={`${styles.dot} ${styles.pulse}`} aria-hidden />
        LIVE · WATERMARKED
      </span>
      {props.superseded === true && (
        <span className={`${styles.badge} ${styles.degraded}`}>SUPERSEDED</span>
      )}
      {props.asOfs.map((asOf) => (
        <span key={asOf.label} className={styles.asOf}>
          {asOf.label}{" "}
          <b className={asOf.tone !== undefined && asOf.tone !== "default" ? styles[asOf.tone] : undefined}>
            {asOf.value}
          </b>
        </span>
      ))}
    </span>
  );
}
