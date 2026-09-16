"use client";

import { freshnessTier } from "@/lib/freshnessTiers";
import { useAnchoredAgeSeconds } from "@/lib/live-age";
import { livePillWords } from "@/lib/live-pill";
import { useMetaConstants } from "@/lib/meta";
import { usePosture } from "@/lib/posture";
import styles from "./kit.module.css";

const AGE_CLASS = {
  ok: styles.pillAgeOk,
  warn: styles.pillAgeWarn,
  crit: styles.pillAgeCrit,
  dim: styles.pillAgeDim,
} as const;

/**
 * The header's one live statement: stream state · batch · snapshot age, the
 * age colored by the ratified freshness tier. Three truths kept separate
 * (spec §2): connection, batch identity, snapshot age.
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
  const ageSeconds = age.unresolved ? null : age.seconds;
  const words = livePillWords({
    streamState: posture.streamState,
    hasBase: posture.hasBase,
    batchId: batch?.id ?? null,
    ageSeconds,
    tier: ageSeconds === null ? null : freshnessTier(ageSeconds, meta.constants),
  });
  const dotClass = words.tone === "ok" ? styles.dotOk : words.tone === "warn" ? styles.dotWarn : "";
  return (
    <span
      className={styles.pill}
      data-testid="live-pill"
      data-word={words.word}
      title={`stream ${posture.streamState}${batch === null ? "" : ` · batch ${String(batch.id)}`}`}
    >
      <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
      {words.word}
      {words.batch !== null && <> · {words.batch}</>}
      {words.age !== null && <span className={AGE_CLASS[words.ageTone]}> · {words.age}</span>}
    </span>
  );
}
