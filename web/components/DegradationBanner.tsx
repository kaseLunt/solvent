"use client";

import { bannerDegraded, bannerReconnecting, bannerUnavailable, type BannerWords } from "@/lib/chrome";
import { usePosture } from "@/lib/posture";
import styles from "./ribbon.module.css";

/** One banner line: the state's word, then what still stands, the figures and names set strong. */
function Banner({ words, tone }: { words: BannerWords; tone: "neutral" | "warn" }) {
  return (
    <div className={tone === "warn" ? `${styles.banner} ${styles.warn}` : styles.banner} role="status" data-state={words.word.toLowerCase()}>
      <div className={styles.bannerInner}>
        <b className={styles.bannerTag}>{words.word}</b>
        <span className={styles.bannerBody}>
          {words.parts.map((part, index) =>
            part.strong === true ? <b key={index}>{part.text}</b> : <span key={index}>{part.text}</span>,
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * The global degradation banner (full-width, under the header).
 *
 * Renders ONLY while something is actually degraded, and only CURRENT
 * posture — never a replayed history (spec §5 law 6). Three cases:
 *
 *   1. The service reports no servable batch (`unavailable`), with its own
 *      staleness statement: a solid line on the panel — a service without a
 *      batch is an absence of record, not a verdict and not a refusal.
 *   2. The current batch's degradation posture names withheld engines or a
 *      supersession: the warn line.
 *   3. The stream itself is down after having been up (reconnecting), while
 *      the page may still be showing the last delivered batch: the warn line,
 *      the live pill's own reconnecting tone.
 */
export function DegradationBanner() {
  const posture = usePosture();

  if (posture.unavailable !== null) {
    const { reason, staleSinceSeconds, lastGoodBatchId } = posture.unavailable;
    return <Banner tone="neutral" words={bannerUnavailable({ reason, staleSinceSeconds, lastGoodBatchId })} />;
  }

  const degradation = posture.degradation;
  if (degradation !== null && (degradation.refused_engines.length > 0 || degradation.superseded)) {
    return (
      <Banner
        tone="warn"
        words={bannerDegraded({
          superseded: degradation.superseded,
          legs: degradation.supersession_legs,
          withheld: degradation.refused_engines.map((refusal) => ({ engine: refusal.engine, code: refusal.code })),
        })}
      />
    );
  }

  if (posture.streamState === "waiting" && posture.batch !== null) {
    return <Banner tone="warn" words={bannerReconnecting()} />;
  }

  return null;
}
