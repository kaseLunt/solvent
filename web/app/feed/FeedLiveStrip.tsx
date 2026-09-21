"use client";

// The Activity page's live strip (spec §3.5): the newest batch and the CURRENT
// degradation/supersession state from the global SSE provider, as ONE plain
// line.
//
// THE LAW (spec §5 law 6): degradation transitions are per-connection and not
// persisted — this strip shows the stream's state on THIS connection only and
// never implies a replay of past states. It is its own labelled instrument
// ABOVE the recorded list, and the law is printed on it in a few words (the
// label); the long form is the drawer's.
//
// Honesty under disconnect: with no base frame on the CURRENT connection the
// strip says so — a batch from a previous connection renders with the stream
// state beside it, so a dead stream can never read as fresh.
//
// Every word, and the choice of what is a figure, is lib/activity-view's
// (deriveLiveStrip); this component only sets it: prose in the page's sans,
// mono for ids and numbers alone.

import { deriveLiveStrip, type LivePart, type LiveStripView } from "@/lib/activity-view";
import { usePosture } from "@/lib/posture";
import styles from "./activity.module.css";

/** NO SOCKET IS GREEN: a proven connection is accent; open with no base frame is the unknown register. */
const CHIP_TONE: Record<LiveStripView["chip"]["tone"], string | undefined> = {
  accent: styles.liveAccent,
  unknown: styles.liveUnknown,
  warn: styles.liveWarn,
  down: styles.liveDown,
};

const ARM_TEST_ID: Record<LiveStripView["arm"], string> = {
  unavailable: "activity-live-unavailable",
  batch: "activity-live-batch",
  none: "activity-live-none",
};

/** Each run keyed by where it starts in the line: the runs never reorder, so the offset is the identity. */
function keyed(line: readonly LivePart[]): { key: number; part: LivePart }[] {
  let offset = 0;
  return line.map((part) => {
    const key = offset;
    offset += part.text.length;
    return { key, part };
  });
}

function Part({ part }: { part: LivePart }) {
  if (part.kind === "figure") return <b>{part.text}</b>;
  if (part.kind === "warn") return <span className="warnt">{part.text}</span>;
  return <>{part.text}</>;
}

export function FeedLiveStrip() {
  const strip = deriveLiveStrip(usePosture());
  return (
    <div className={styles.live} data-testid="activity-live" role="status">
      <span className={styles.liveLabel} title={strip.law}>
        {strip.label}
      </span>
      <span className={`${styles.liveChip} ${CHIP_TONE[strip.chip.tone] ?? ""}`} data-testid="activity-live-state">
        <i aria-hidden />
        {strip.chip.label}
      </span>
      <span data-testid={ARM_TEST_ID[strip.arm]}>
        {keyed(strip.line).map(({ key, part }) => (
          <Part key={key} part={part} />
        ))}
      </span>
      {strip.degraded !== null && (
        <span className="warnt" data-testid="activity-live-degraded">
          {strip.degraded}
        </span>
      )}
    </div>
  );
}
