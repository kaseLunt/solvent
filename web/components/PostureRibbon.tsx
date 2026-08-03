"use client";

import { usePosture, usePostureRefresh } from "@/lib/posture";
import { formatBlock } from "@/lib/format";
import { ribbonBatchAgeSuffix, ribbonBatchAgeUnknown } from "@/lib/freshness";
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
  //
  // Wave R6 (round-13 MEDIUM 1): AND IT HAS A REPAIR PATH NOW. The ribbon owns
  // no fetch — its batch arrives on the stream — so when a blind resume left
  // the age unmeasurable it could do nothing but wait for the publishing loop
  // to speak. A stream that is healthy but QUIET never does, and the ribbon
  // went on rendering `LIVE · WATERMARKED` with no stale suffix over data hours
  // old, for as long as the understated age stayed inside the hour threshold.
  //
  // `refresh` is a stream TEARDOWN AND REOPEN (lib/posture.tsx), which obliges
  // the server to re-deliver the base snapshot the contract promises on every
  // connection — and that snapshot's `served_at` is a new receipt, which is the
  // only thing that discharges an unknown age.
  const refreshPosture = usePostureRefresh();
  const age = useAnchoredAgeSeconds(
    posture.batch !== null && posture.batchReceiptId !== null
      ? { ageSeconds: posture.batch.age_seconds, receiptId: posture.batchReceiptId }
      : null,
    refreshPosture,
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
    //
    // Wave R6: and while the age is UNRESOLVED the suffix is not computed at
    // all. `ribbonBatchAgeSuffix` is a function of a number the page has just
    // admitted it does not have — feeding it the understated one would put the
    // ribbon back in the state the finding describes (silent, because the
    // number is still inside the hour), and there is no honest stale claim to
    // substitute, because staleness is not what the page knows. It knows only
    // that it cannot say.
    return (
      <Ribbon
        mode="live"
        asOfs={asOfs}
        superseded={posture.batch.supersession.superseded}
        batchAgeSuffix={
          age.unresolved ? null : ribbonBatchAgeSuffix(age.seconds ?? posture.batch.age_seconds)
        }
        batchAgeUnknown={age.unresolved ? ribbonBatchAgeUnknown(age.refreshFailed) : null}
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
