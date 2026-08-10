"use client";

import { usePosture, usePostureRefresh } from "@/lib/posture";
import { ribbonCoverage } from "@/lib/coverage";
import { formatBlock } from "@/lib/format";
import { snapshotChipParts, snapshotChipUnknown, staleSinceReading } from "@/lib/freshness";
import { freshnessTier } from "@/lib/freshnessTiers";
import { useMetaConstants, type MetaConstantsSource } from "@/lib/meta";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { ribbonEmptyPosture, ribbonStreamPosture } from "@/lib/stream-posture";
import { Ribbon, type RibbonAsOf, type RibbonSnapshotChip } from "./Ribbon";
import styles from "./ribbon.module.css";

/**
 * The header's appbar slot, fed by the global stream posture (canon §10,
 * p1a-4).
 *
 * Each truth renders as its OWN chip: the stream's posture (CONNECTED only
 * when the CURRENT connection is open with its base delivered — Wave R7's
 * law, unchanged), the snapshot's age with its SLA tier, the batch identity,
 * and the engine coverage — with the raw watermark vector in the "Data
 * status →" popover. `LIVE · WATERMARKED` is retired: a connected stream and
 * a stale snapshot are both true, and both show, separately.
 */

/**
 * The disclosure the snapshot chip carries when the tier thresholds are the
 * BUILT-IN fallback rather than `/v1/meta`'s constants (p1a-3's provider,
 * source `"fallback"`) — a threshold the page invented must never impersonate
 * one the pipeline stated. The arm is reachable on any unreachable or
 * refused meta read, including before the one meta round-trip resolves.
 */
export const TIER_FALLBACK_DISCLOSURE =
  "thresholds from built-in fallback — /v1/meta unavailable";

/** The chip's base title — the age's subject, and the two-subjects law. */
function snapshotTitle(batchId: number, source: MetaConstantsSource | null): string {
  const base =
    `snapshot freshness — how old served batch #${String(batchId)} is; ` +
    "the chip beside this is the stream connection, a separate statement";
  return source === "fallback" ? `${base} · ${TIER_FALLBACK_DISCLOSURE}` : base;
}

// The coverage chip's HONEST derivation is `ribbonCoverage` (lib/coverage.ts,
// pure and unit-pinned since p1a-4b): total = stamp vector, answered =
// total − deduped refused_engines, and an UNBINDABLE refusal (a refused name
// with no stamp) returns null — the chip is withheld entirely rather than
// invented (Track B envelope gap, ledgered §p1a-4).

export function PostureRibbon() {
  const posture = usePosture();
  // Wave R3 (round-10 MEDIUM): the wire age ANCHORED at receipt and advanced
  // on a minute tick, so the freshness statement ENGAGES while the tab is
  // open instead of testing a number frozen at receipt. Called
  // unconditionally, above every early return — hooks are not conditional.
  //
  // Wave R5 (round-12 MEDIUM): the anchor is keyed to the STREAM RECEIPT that
  // delivered this batch, not to its integer age. Batch #7 arriving two minutes
  // old where #6 also arrived two minutes old is a NEW receipt and re-anchors;
  // under the old value test it inherited #6's anchor and rendered #7 as old as
  // the batch it replaced.
  //
  // Wave R6 (round-13 MEDIUM 1): AND IT HAS A REPAIR PATH NOW. The appbar owns
  // no fetch — its batch arrives on the stream — so when a blind resume left
  // the age unmeasurable it could do nothing but wait for the publishing loop
  // to speak. `refresh` is a stream TEARDOWN AND REOPEN (lib/posture.tsx),
  // which obliges the server to re-deliver the base snapshot the contract
  // promises on every connection — and that snapshot's `served_at` is a new
  // receipt, which is the only thing that discharges an unknown age.
  const refreshPosture = usePostureRefresh();

  // The tier constants — runtime-derived from /v1/meta, or the DISCLOSED
  // fallback (lib/meta.tsx). Provider mounted in app/layout.tsx (p1a-4).
  const meta = useMetaConstants();

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
    // THE SAME REPAIR AS THE LIVE BRANCH. The appbar owns no fetch here
    // either: the only way to get a new statement about the service's
    // staleness is to reconnect and let the contract's snapshot-on-connect
    // answer.
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
    // THE SNAPSHOT CHIP, TIERED (p1a-4). Wave R6's arbitration is preserved
    // one-to-one: while the age is UNRESOLVED the computed chip is not built
    // at all — `snapshotChipParts` is a function of a number the page has
    // just admitted it does not have, and `freshnessTier` deliberately has no
    // null arm. The unknown register renders instead (dashed, no tier word,
    // no tier color), and only a new receipt discharges it. When the age IS
    // known, the tier is computed from the SAME anchored seconds the chip
    // prints, under the /v1/meta constants (or the disclosed fallback), so
    // severity and text can never disagree.
    const batchId = posture.batch.id;
    let snapshot: RibbonSnapshotChip;
    if (age.unresolved) {
      snapshot = {
        parts: snapshotChipUnknown(batchId, age.refreshFailed),
        tier: null,
        // No tier is computed over an unknown age, so no threshold source is
        // disclosed either — the refusal is the whole statement.
        title: snapshotTitle(batchId, null),
      };
    } else {
      const seconds = age.seconds ?? posture.batch.age_seconds;
      const tier = freshnessTier(seconds, meta.constants);
      snapshot = {
        parts: snapshotChipParts(batchId, seconds, tier),
        tier,
        title: snapshotTitle(batchId, meta.source),
      };
    }
    // WAVE R7 (round-15 finding 4), UNCHANGED IN LAW: the stream chip is
    // derived from the CURRENT connection — having a batch was never evidence
    // that the stream is up. p1a-4 only changed the reward: a proven-open
    // stream is the CONNECTED chip (accent, never green), not a liveness
    // badge over the data. The data, the watermark vector (now in the
    // popover) and the age disclosure all stay: losing the connection must
    // not also cost the reader their book.
    return (
      <Ribbon
        mode="stream"
        posture={ribbonStreamPosture(streamState, hasBase)}
        asOfs={asOfs}
        superseded={posture.batch.supersession.superseded}
        snapshot={snapshot}
        batchId={batchId}
        coverage={ribbonCoverage(posture.batch)}
      />
    );
  }

  if (unavailable !== null) {
    // The server's OWN statement, kept verbatim — and aged honestly. The
    // seconds are the ANCHORED ones (they tick, they are clamped, they never
    // run backwards); `staleSinceReading` refuses to state them at all while a
    // blind resume stands over this frame, which is the round-15 finding.
    // p1a-4 re-skins the badge as the crit-register chip the canon's
    // unavailable branch calls for; the reading beside it is untouched.
    const stale = staleSinceReading(
      staleAge.seconds === null ? null : Math.floor(staleAge.seconds),
      staleAge.unresolved,
      staleAge.refreshFailed,
    );
    return (
      <div className={styles.appbar}>
        <span className={`${styles.chip} ${styles.cCrit}`}>NO SERVABLE BATCH</span>
        {stale !== null && (
          <span
            className={styles.asOf}
            data-testid={stale.unknown ? "ribbon-stale-unknown" : "ribbon-stale-since"}
          >
            {stale.label} <b className={styles.warn}>{stale.value}</b>
          </span>
        )}
      </div>
    );
  }

  // No renderable batch and no statement about why: say what the stream is
  // doing. A CONNECTED chip holding nothing renders STREAM NO BATCH — there
  // are no watermarks to be connected over.
  return <Ribbon mode="stream" posture={ribbonEmptyPosture(streamState, hasBase)} asOfs={[]} />;
}
