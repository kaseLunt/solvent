"use client";

import { usePosture } from "@/lib/posture";
import { formatBlock } from "@/lib/format";
import { ribbonBatchAgeSuffix } from "@/lib/freshness";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
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
  // Wave R3 (round-10 MEDIUM): the wire age ANCHORED at receipt and advanced
  // on a minute tick, so the stale-batch suffix ENGAGES while the tab is open
  // instead of testing a number frozen just short of the threshold. Called
  // unconditionally, above every early return — hooks are not conditional.
  //
  // Wave R5 (round-12 MEDIUM): the anchor is keyed to the STREAM RECEIPT that
  // delivered this batch, not to its integer age. Batch #7 arriving two minutes
  // old where #6 also arrived two minutes old is a NEW receipt and re-anchors;
  // under the old value test it inherited #6's anchor and rendered #7 as old as
  // the batch it replaced.
  const liveAgeSeconds = useAnchoredAgeSeconds(
    posture.batch !== null && posture.batchReceiptId !== null
      ? { ageSeconds: posture.batch.age_seconds, receiptId: posture.batchReceiptId }
      : null,
  );

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
    // Wave R1 item 3: LIVE describes the STREAM; the suffix describes the
    // BATCH. A batch older than an hour says so, in the dim register, right
    // where the reader is being told the connection is live.
    return (
      <Ribbon
        mode="live"
        asOfs={asOfs}
        superseded={posture.batch.supersession.superseded}
        batchAgeSuffix={ribbonBatchAgeSuffix(liveAgeSeconds ?? posture.batch.age_seconds)}
      />
    );
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
