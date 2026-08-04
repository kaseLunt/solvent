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
import styles from "./feed.module.css";

function streamChip(state: string): { label: string; tone: string } {
  switch (state) {
    case "open":
      return { label: "streaming", tone: styles.liveOk ?? "" };
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
  const chip = streamChip(posture.streamState);
  const live = posture.streamState === "open" && posture.hasBase;

  return (
    <div className={styles.liveStrip} data-testid="feed-live-strip" role="status">
      <span className={styles.liveLabel}>live posture</span>
      <span className={`${styles.liveChip} ${chip.tone}`} data-testid="feed-live-state">
        <i aria-hidden />
        {chip.label}
      </span>

      {posture.unavailable !== null ? (
        <span data-testid="feed-live-unavailable">
          no servable batch
          {posture.unavailable.staleSinceSeconds !== null && (
            <>
              {" "}
              · held data <b>{String(posture.unavailable.staleSinceSeconds)}s</b> stale
            </>
          )}
          {posture.unavailable.lastGoodBatchId !== null && (
            <>
              {" "}
              · last good batch <b>#{String(posture.unavailable.lastGoodBatchId)}</b>
            </>
          )}
        </span>
      ) : posture.batch !== null ? (
        <span data-testid="feed-live-batch">
          batch <b>#{String(posture.batch.id)}</b> · {String(posture.batch.position_count)}{" "}
          positions · {String(posture.batch.refused_count)} refused
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
        <span data-testid="feed-live-none">
          no batch delivered on this connection, and nothing is pretended
        </span>
      )}

      {posture.degradation !== null && posture.degradation.refused_engines.length > 0 && (
        <span className="warnt" data-testid="feed-live-degraded">
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
