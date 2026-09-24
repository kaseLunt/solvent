"use client";

import { livePillTitle } from "@/lib/chrome";
import { freshnessTier } from "@/lib/freshnessTiers";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { livePillWords, type LivePillWords } from "@/lib/live-pill";
import { useMetaConstants } from "@/lib/meta";
import { usePosture } from "@/lib/posture";
import styles from "./kit.module.css";

const DOT_CLASS: Record<LivePillWords["tone"], string | undefined> = {
  live: styles.dotLive,
  warn: styles.dotWarn,
  dim: "",
};

const AGE_CLASS: Record<LivePillWords["ageTone"], string | undefined> = {
  neutral: styles.pillAgeNeutral,
  warn: styles.pillAgeWarn,
  crit: styles.pillAgeCrit,
  dim: styles.pillAgeDim,
};

/**
 * The pill as drawn, from its words alone: the connection's dot and word, then the batch and the age. On a phone (or
 * `compact`, the phone's form at any width) the batch and a fresh age leave the line — they stay in the accessibility
 * tree and in the title — so the header's first row holds the brand, the pill and the two controls. An aging or stale
 * age stays on the line: a warning is never folded away.
 */
export function LivePillView({ words, compact = false, testId = "live-pill" }: { words: LivePillWords; compact?: boolean; testId?: string }) {
  return (
    <span className={compact ? `${styles.pill} ${styles.pillCompact}` : styles.pill} data-testid={testId} data-word={words.word} data-tone={words.tone} title={livePillTitle(words)}>
      <span className={`${styles.dot} ${DOT_CLASS[words.tone] ?? ""}`} aria-hidden="true" />
      {words.word}
      {(words.batch !== null || words.age !== null) && (
        <span
          className={styles.pillMore}
          data-testid={`${testId}-more`}
          data-urgent={words.ageTone === "warn" || words.ageTone === "crit" ? "" : undefined}
        >
          {words.batch !== null && <span className={styles.pillBatch}> · {words.batch}</span>}
          {words.age !== null && <span className={AGE_CLASS[words.ageTone]}> · {words.age}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * The header's one live statement: stream state · batch · snapshot age, the age coloured by the ratified freshness
 * tier. Three truths kept separate (spec §2): connection, batch identity, snapshot age. Connection is posture, never
 * health: the live dot is the accent, and a fresh age is ink.
 */
export function LivePill() {
  const posture = usePosture();
  const meta = useMetaConstants();
  const batch = posture.batch;
  const age = useAnchoredAgeSeconds(
    batch === null || posture.batchReceiptId === null
      ? null
      : { ageSeconds: batch.age_seconds, receiptId: posture.batchReceiptId },
  );
  // While the age is unresolved its number is a floor, not an age: the pill says "age unknown" rather than dropping the clause.
  const ageSeconds = age.unresolved ? null : age.seconds;
  const words = livePillWords({
    streamState: posture.streamState,
    hasBase: posture.hasBase,
    batchId: batch?.id ?? null,
    ageSeconds,
    ageUnresolved: age.unresolved,
    tier: ageSeconds === null ? null : freshnessTier(ageSeconds, meta.constants),
  });
  return <LivePillView words={words} />;
}
