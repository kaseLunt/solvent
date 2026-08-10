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
       * Phase 0 fix 5 — the snapshot chip, e.g. `snapshot #18251 · 18h 12m old`
       * or, under a blind resume, `snapshot #18251 · age UNKNOWN since resume ·
       * refreshing`.
       *
       * TWO SUBJECTS, TWO ELEMENTS: `LIVE · WATERMARKED` describes the STREAM
       * (it really is connected and delivering). This chip describes the BATCH
       * the stream is carrying — and it is ALWAYS visible, at every age, as its
       * own element BESIDE the badge rather than a >1h-only suffix inside it.
       * Conflating the two — or letting the age fall silent below a threshold —
       * is how a live connection over a stale batch reads as fresh data.
       * Severity styling arrives with the Phase 1 SLA.
       */
      snapshot?: string;
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
      </span>
      {props.snapshot ? (
        <span
          data-testid="ribbon-snapshot"
          className={styles.snapshot}
          title="snapshot freshness — how old the served batch is; the badge beside this is the stream connection, a separate statement"
        >
          {props.snapshot}
        </span>
      ) : null}
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
