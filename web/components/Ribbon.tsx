import type { RibbonStreamPosture } from "@/lib/stream-posture";
import styles from "./ribbon.module.css";

// The integrity Ribbon — spec §3.6. Two modes, rendered distinctly:
//
//   mode="stream"        the stream posture over a watermark VECTOR of named
//                        as-ofs (per-engine stamps, sweep age, …). There is
//                        deliberately NO single-block prop: a global "live at
//                        block N" does not exist in this system and cannot be
//                        rendered by this component.
//
//   PROOF · EXACT @ PIN  reconcile-welded numbers at an exact pin.
//
// WAVE R7 (Codex round-15 finding 4) — `LIVE · WATERMARKED` IS A CLAIM, AND
// THIS COMPONENT NO LONGER MAKES IT ON ITS OWN. The mode used to be called
// "live", and having a batch to render was the whole qualification for painting
// the green chip; the ribbon therefore went on saying LIVE over a connection
// that had been torn down and never came back. The mode is now "stream" and it
// takes a `posture` the caller must have DERIVED from the current connection
// (lib/stream-posture.ts). A ribbon with data and a dead socket renders the
// data under the socket's own word.

export interface RibbonAsOf {
  /** The input's name, e.g. "aave_v3", "debt_manager", "sweep". */
  label: string;
  /** Its OWN as-of, e.g. "@25,641,730", "age 41s". */
  value: string;
  tone?: "default" | "ok" | "warn" | "crit" | "dim";
}

export type RibbonProps =
  | {
      mode: "stream";
      /**
       * Wave R7 — WHAT THE CURRENT CONNECTION IS DOING, derived by the caller
       * from `streamState` + `hasBase`. `{ live: true }` is the only value that
       * paints `LIVE · WATERMARKED`; every other value paints the stream's own
       * word over the SAME retained data, because a reader losing their
       * connection must not also lose their book.
       */
      posture: RibbonStreamPosture;
      /** The watermark vector. Every entry names its own as-of. */
      asOfs: readonly RibbonAsOf[];
      /** Current batch is superseded — render the warning inline. */
      superseded?: boolean;
      /**
       * Wave R1 item 3 — the batch-age suffix, e.g. `· batch 24h old`.
       *
       * TWO SUBJECTS, TWO STATEMENTS: `LIVE · WATERMARKED` describes the
       * STREAM (it really is connected and delivering). The suffix describes
       * the BATCH the stream is carrying (it really is a day old). Conflating
       * them is how a live connection over a stale batch reads as fresh data.
       * Null renders nothing — an absent suffix is not a freshness claim
       * beyond what LIVE already says.
       */
      batchAgeSuffix?: string | null;
      /**
       * Wave R6 — the same slot, carrying a REFUSAL instead of a computed age:
       * `· batch age UNKNOWN since resume · refreshing`.
       *
       * It exists because SILENCE in this slot reads as freshness. When a blind
       * resume leaves the age unmeasurable, rendering nothing would be the
       * round-13 defect exactly; rendering the understated `Xh old` would be a
       * false claim; and rendering a stale verdict would be a different false
       * claim, since the page does not know that either. So the slot says what
       * is true: the age is not known right now.
       *
       * Mutually exclusive with `batchAgeSuffix` — the caller passes one or the
       * other, never both, and this component renders the unknown first if it
       * is somehow handed both.
       */
      batchAgeUnknown?: string | null;
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

  // The badge's tone is the posture's, not the payload's: the ok/green chip is
  // reachable ONLY through `live: true`, and the pulsing dot — which is the
  // thing an eye reads as "data is arriving" — goes with it.
  const { posture } = props;
  const toneClass = posture.live
    ? styles.live
    : posture.tone === "down"
      ? styles.down
      : styles.waiting;
  return (
    <span className={styles.ribbon}>
      <span className={`${styles.badge} ${toneClass}`}>
        {posture.live && <i className={`${styles.dot} ${styles.pulse}`} aria-hidden />}
        {posture.live ? "LIVE · WATERMARKED" : posture.label}
        {props.batchAgeUnknown !== undefined && props.batchAgeUnknown !== null ? (
          <span className={styles.batchAgeUnknown} data-testid="ribbon-batch-age-unknown">
            {props.batchAgeUnknown}
          </span>
        ) : (
          props.batchAgeSuffix !== undefined &&
          props.batchAgeSuffix !== null && (
            <span className={styles.batchAge} data-testid="ribbon-batch-age">
              {props.batchAgeSuffix}
            </span>
          )
        )}
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
