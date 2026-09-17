"use client";

// The Feed's live-posture strip (spec §3.5): batch ticks + CURRENT
// degradation/supersession posture from the global SSE provider.
//
// THE FEED LAW (spec §5 law 6, the adopted Codex caveat): degradation
// transitions are per-connection and not persisted — this strip shows LIVE
// posture ONLY and must never imply historical posture replay. It is
// rendered as its own labeled instrument ABOVE the durable history list,
// and the law is printed on it, not just remembered. Posture history
// arrives with P4's durable outbox.
//
// Honesty under disconnect: with no base frame on the CURRENT connection
// the strip says so ("no batch delivered on this connection") — a batch
// from a previous connection renders with the stream state beside it, so a
// dead stream can never read as fresh.

import { usePosture } from "@/lib/posture";
import { formatBlock } from "@/lib/format";
import { isWirePopulation } from "@/lib/wireGuard";
import styles from "./activity.module.css";

/**
 * p1b-14: every envelope integer this live instrument prints passes the
 * population law at the read. The strip is a LIVE surface fed by SSE frames —
 * refusing the whole /feed route over one malformed frame would take the
 * durable chain-fact list below with it — so the refusal is the word register
 * (`unreadable`, the p1b-13 LabTornado vocabulary), scoped to the number.
 */
function wireCount(value: number): string {
  return isWirePopulation(value) ? String(value) : "unreadable";
}

/**
 * p1a-9 (F3): the chip is a function of the CONNECTION'S WHOLE claim —
 * `streamState` AND `hasBase` — the same law the appbar's stream chip has
 * carried since Wave R7. An HTTP 200 the server has not spoken on is not
 * "streaming": open without a base renders the unknown register ("awaiting
 * base"), because this connection has proven nothing yet.
 *
 * AND NO SOCKET IS GREEN. The old `open → liveOk` arm painted the ok token
 * over a transport fact, contradicting the appbar one viewport-height above
 * (STREAM CONNECTED, accent — "connection is posture, not health"). A proven
 * connection is ACCENT here too; green stays rationed to computed health.
 */
function streamChip(state: string, hasBase: boolean): { label: string; tone: string } {
  switch (state) {
    case "open":
      return hasBase
        ? { label: "streaming", tone: styles.liveAccent ?? "" }
        : { label: "awaiting base", tone: styles.liveUnknown ?? "" };
    case "idle":
    case "connecting":
      return { label: "connecting", tone: styles.liveWarn ?? "" };
    case "waiting":
      return { label: "reconnecting", tone: styles.liveWarn ?? "" };
    case "closed":
      return { label: "closed", tone: styles.liveDown ?? "" };
    default:
      return { label: state, tone: styles.liveWarn ?? "" };
  }
}

export function FeedLiveStrip() {
  const posture = usePosture();
  const chip = streamChip(posture.streamState, posture.hasBase);
  const live = posture.streamState === "open" && posture.hasBase;

  return (
    <div className={styles.live} data-testid="activity-live" role="status">
      <span className={styles.liveLabel}>live posture</span>
      <span className={`${styles.liveChip} ${chip.tone}`} data-testid="activity-live-state">
        <i aria-hidden />
        {chip.label}
      </span>

      {posture.unavailable !== null ? (
        <span data-testid="activity-live-unavailable">
          no servable batch
          {posture.unavailable.staleSinceSeconds !== null && (
            <>
              {" "}
              · held data <b>{wireCount(posture.unavailable.staleSinceSeconds)}s</b> stale
            </>
          )}
          {posture.unavailable.lastGoodBatchId !== null && (
            <>
              {" "}
              · last good batch <b>#{wireCount(posture.unavailable.lastGoodBatchId)}</b>
            </>
          )}
        </span>
      ) : posture.batch !== null ? (
        <span data-testid="activity-live-batch">
          batch <b>#{wireCount(posture.batch.id)}</b> · {wireCount(posture.batch.position_count)}{" "}
          positions · {wireCount(posture.batch.refused_count)} refused
          {posture.batch.supersession.superseded && (
            <>
              {" "}
              · <b className="warnt">SUPERSEDED (still served)</b>
            </>
          )}
          {!live && <> · from an earlier connection</>}
          {posture.batch.watermarks.map((stamp) => (
            <span key={stamp.engine}>
              {" "}
              · {stamp.engine} @{formatBlock(stamp.last_block)}
            </span>
          ))}
        </span>
      ) : (
        <span data-testid="activity-live-none">
          no batch delivered on this connection, and nothing is pretended
        </span>
      )}

      {posture.degradation !== null && posture.degradation.refused_engines.length > 0 && (
        <span className="warnt" data-testid="activity-live-degraded">
          withheld:{" "}
          {posture.degradation.refused_engines
            .map((refusal) => `${refusal.engine} (${refusal.code})`)
            .join(", ")}
        </span>
      )}

      <span className={styles.liveLaw}>
        current connection only. Live posture is never history; the durable feed below is
        custodied chain fact, and posture replay arrives with P4&apos;s outbox.
      </span>
    </div>
  );
}
