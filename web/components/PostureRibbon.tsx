"use client";

import { usePosture } from "@/lib/posture";
import { formatBlock } from "@/lib/format";
import { Ribbon, type RibbonAsOf } from "./Ribbon";
import styles from "./ribbon.module.css";

/**
 * The header's Ribbon slot, fed by the global stream posture.
 *
 * With a live batch it renders `LIVE · WATERMARKED` over the batch's REAL
 * watermark vector (per-engine `@last_block`, sweep presence). Without one it
 * renders the stream's actual state — CONNECTING / RECONNECTING / NO BATCH /
 * STREAM DOWN — never a pretend liveness.
 */
export function PostureRibbon() {
  const posture = usePosture();

  if (posture.batch !== null && posture.unavailable === null) {
    const asOfs: RibbonAsOf[] = posture.batch.watermarks.map((stamp) => ({
      label: stamp.engine,
      value: `@${formatBlock(stamp.last_block)}`,
      tone: "default",
    }));
    for (const stamp of posture.batch.watermarks) {
      if (stamp.sweep !== null) {
        asOfs.push({
          label: `${stamp.engine} sweep`,
          value:
            stamp.sweep.age_seconds === null ? "age —" : `age ${String(stamp.sweep.age_seconds)}s`,
          tone: stamp.sweep.failed > 0 ? "warn" : "dim",
        });
      }
    }
    return <Ribbon mode="live" asOfs={asOfs} superseded={posture.batch.supersession.superseded} />;
  }

  // No renderable batch: state the truth about the stream itself.
  const { streamState, unavailable } = posture;
  if (unavailable !== null) {
    return (
      <span className={styles.ribbon}>
        <span className={`${styles.badge} ${styles.degraded}`}>NO SERVABLE BATCH</span>
        {unavailable.staleSinceSeconds !== null && (
          <span className={styles.asOf}>
            stale <b className={styles.warn}>{String(unavailable.staleSinceSeconds)}s</b>
          </span>
        )}
      </span>
    );
  }

  const label =
    streamState === "idle" || streamState === "connecting"
      ? "STREAM · CONNECTING"
      : streamState === "waiting"
        ? "STREAM · RECONNECTING"
        : streamState === "closed"
          ? "STREAM · CLOSED"
          : "STREAM · AWAITING BASE";
  const toneClass = streamState === "closed" ? styles.down : styles.waiting;
  return (
    <span className={styles.ribbon}>
      <span className={`${styles.badge} ${toneClass}`}>{label}</span>
    </span>
  );
}
