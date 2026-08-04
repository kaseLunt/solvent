"use client";

import { usePosture } from "@/lib/posture";
import styles from "./ribbon.module.css";

/**
 * The global degradation banner (full-width, under the header).
 *
 * Renders ONLY while something is actually degraded, and only CURRENT
 * posture — never a replayed history (spec §5 law 6). Three cases:
 *
 *   1. The service reports no servable batch (`unavailable`), with its own
 *      staleness statement rendered verbatim.
 *   2. The current batch's degradation posture names withheld engines or a
 *      supersession.
 *   3. The stream itself is down after having been up (reconnecting), while
 *      the page may still be showing the last delivered batch.
 */
export function DegradationBanner() {
  const posture = usePosture();

  if (posture.unavailable !== null) {
    const { reason, staleSinceSeconds, lastGoodBatchId } = posture.unavailable;
    return (
      <div className={styles.banner} role="status">
        <div className={styles.bannerInner}>
          <span className={styles.bannerTag}>UNAVAILABLE</span>
          <span className={styles.bannerBody}>
            no servable batch{reason !== null && reason.length > 0 ? <> · {reason}</> : null}
            {staleSinceSeconds !== null && (
              <>
                {" "}
                · held data is <b>{String(staleSinceSeconds)}s</b> stale
              </>
            )}
            {lastGoodBatchId !== null && (
              <>
                {" "}
                · last good batch <b>{String(lastGoodBatchId)}</b>
              </>
            )}
          </span>
        </div>
      </div>
    );
  }

  const degradation = posture.degradation;
  if (degradation !== null && (degradation.refused_engines.length > 0 || degradation.superseded)) {
    return (
      <div className={`${styles.banner} ${styles.warn}`} role="status">
        <div className={styles.bannerInner}>
          <span className={`${styles.bannerTag} ${styles.warnTag}`}>DEGRADED</span>
          <span className={styles.bannerBody}>
            {degradation.superseded && (
              <>
                batch <b>superseded</b>
                {degradation.supersession_legs.length > 0 && (
                  <> ({degradation.supersession_legs.join(", ")})</>
                )}
                {" · "}
              </>
            )}
            {degradation.refused_engines.length > 0 && (
              <>
                withheld:{" "}
                {degradation.refused_engines.map((refusal, index) => (
                  <span key={refusal.engine}>
                    {index > 0 && ", "}
                    <b>{refusal.engine}</b> ({refusal.code})
                  </span>
                ))}
              </>
            )}
          </span>
        </div>
      </div>
    );
  }

  if (posture.streamState === "waiting" && posture.batch !== null) {
    return (
      <div className={`${styles.banner} ${styles.warn}`} role="status">
        <div className={styles.bannerInner}>
          <span className={`${styles.bannerTag} ${styles.warnTag}`}>RECONNECTING</span>
          <span className={styles.bannerBody}>
            stream lost. Showing the last delivered batch until the reconnect snapshot lands.
          </span>
        </div>
      </div>
    );
  }

  return null;
}
