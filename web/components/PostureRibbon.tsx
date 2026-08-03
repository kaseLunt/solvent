"use client";

import { usePosture, usePostureRefresh } from "@/lib/posture";
import { formatBlock } from "@/lib/format";
import {
  ribbonBatchAgeSuffix,
  ribbonBatchAgeUnknown,
  staleSinceReading,
} from "@/lib/freshness";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { ribbonEmptyPosture, ribbonStreamPosture } from "@/lib/stream-posture";
import { Ribbon, type RibbonAsOf } from "./Ribbon";
import styles from "./ribbon.module.css";

/**
 * The header's Ribbon slot, fed by the global stream posture.
 *
 * `LIVE · WATERMARKED` is rendered ONLY when the CURRENT connection is open
 * with its base delivered, over the batch's REAL watermark vector (per-engine
 * `@last_block`, sweep presence). Otherwise it renders the stream's actual
 * state — CONNECTING / RECONNECTING / AWAITING BASE / CLOSED / NO BATCH — with
 * the retained batch and its age still on screen. Never a pretend liveness.
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

  // ---------------------------------------------------------------------
  // TWO AGES, ONE AT A TIME (Wave R7, round-15 finding 3).
  //
  // The unavailable frame's `stale_since_seconds` is an AGE and had none of
  // this machinery: the server emits it once and latches, the provider clears
  // `batch`, so nothing re-stated it and "stale 42s" could stand for hours —
  // and a blind resume over it never entered the unknown register, because
  // nothing here treated it as a duration at all.
  //
  // The two receipts are MUTUALLY EXCLUSIVE by construction: the batch receipt
  // is taken only while there is no unavailability statement, which is exactly
  // the condition under which the batch age is rendered. That matters beyond
  // tidiness — each live receipt owns a bounded repair schedule, and two live
  // at once would spend twice the reconnects the bound allows.
  // ---------------------------------------------------------------------
  const age = useAnchoredAgeSeconds(
    posture.batch !== null && posture.unavailable === null && posture.batchReceiptId !== null
      ? { ageSeconds: posture.batch.age_seconds, receiptId: posture.batchReceiptId }
      : null,
    refreshPosture,
  );
  const staleAge = useAnchoredAgeSeconds(
    posture.unavailable !== null &&
      posture.unavailable.staleSinceSeconds !== null &&
      posture.unavailableReceiptId !== null
      ? {
          ageSeconds: posture.unavailable.staleSinceSeconds,
          receiptId: posture.unavailableReceiptId,
        }
      : null,
    // THE SAME REPAIR AS THE LIVE BRANCH. The ribbon owns no fetch here either:
    // the only way to get a new statement about the service's staleness is to
    // reconnect and let the contract's snapshot-on-connect answer.
    refreshPosture,
  );

  const { streamState, hasBase, unavailable } = posture;

  if (posture.batch !== null && unavailable === null) {
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
    //
    // WAVE R7 (round-15 finding 4): AND THE BADGE ITSELF IS NOW DERIVED FROM
    // THE CONNECTION. Having a batch was never evidence that the stream is up —
    // the batch is RETAINED across a teardown on purpose — so after `refresh()`
    // a hung or failed reconnect used to leave LIVE painted indefinitely. The
    // posture below is the only thing that can paint it, and it asks the
    // current connection. The data, the watermark vector and the age
    // disclosure (including the unknown register) all stay exactly where they
    // were: losing the connection must not also cost the reader their book.
    return (
      <Ribbon
        mode="stream"
        posture={ribbonStreamPosture(streamState, hasBase)}
        asOfs={asOfs}
        superseded={posture.batch.supersession.superseded}
        batchAgeSuffix={
          age.unresolved ? null : ribbonBatchAgeSuffix(age.seconds ?? posture.batch.age_seconds)
        }
        batchAgeUnknown={age.unresolved ? ribbonBatchAgeUnknown(age.refreshFailed) : null}
      />
    );
  }

  if (unavailable !== null) {
    // The server's OWN statement, kept verbatim — and now aged honestly. The
    // seconds are the ANCHORED ones (they tick, they are clamped, they never
    // run backwards); `staleSinceReading` refuses to state them at all while a
    // blind resume stands over this frame, which is the round-15 finding.
    const stale = staleSinceReading(
      staleAge.seconds === null ? null : Math.floor(staleAge.seconds),
      staleAge.unresolved,
      staleAge.refreshFailed,
    );
    return (
      <span className={styles.ribbon}>
        <span className={`${styles.badge} ${styles.degraded}`}>NO SERVABLE BATCH</span>
        {stale !== null && (
          <span
            className={styles.asOf}
            data-testid={stale.unknown ? "ribbon-stale-unknown" : "ribbon-stale-since"}
          >
            {stale.label} <b className={styles.warn}>{stale.value}</b>
          </span>
        )}
      </span>
    );
  }

  // No renderable batch and no statement about why: say what the stream is
  // doing. A LIVE connection holding nothing is not `LIVE · WATERMARKED` —
  // there are no watermarks to be live over.
  const empty = ribbonEmptyPosture(streamState, hasBase);
  return (
    <span className={styles.ribbon}>
      <span
        className={`${styles.badge} ${empty.tone === "down" ? styles.down : styles.waiting}`}
      >
        {empty.label}
      </span>
    </span>
  );
}
