import type { RibbonCoverage } from "@/lib/coverage";
import type { FreshnessTier } from "@/lib/freshnessTiers";
import { isWirePopulation } from "@/lib/wireGuard";
import type { SnapshotChipParts } from "@/lib/freshness";
import type { RibbonPostureTone, RibbonStreamPosture } from "@/lib/stream-posture";
import styles from "./ribbon.module.css";

// The integrity APPBAR — canon build-contract §10, landed by p1a-4. Two modes:
//
//   mode="stream"        the canon appbar: each truth its OWN chip —
//                        STREAM <state> · SNAPSHOT <age> · <TIER> ·
//                        BATCH #id · COVERAGE n/n (· SUPERSEDED) — with the
//                        raw watermark VECTOR of named as-ofs demoted into a
//                        native "Data status →" popover. There is still NO
//                        single-block prop: a global "live at block N" does
//                        not exist in this system and cannot be rendered.
//
//   PROOF · EXACT @ PIN  reconcile-welded numbers at an exact pin (unchanged).
//
// WAVE R7 made liveness a claim about the CURRENT connection; p1a-4 retires
// the PRIZE for that claim. The audited `LIVE · WATERMARKED` single badge is
// gone: "a connected stream and an 18-hour snapshot are both true — both
// always show, separately" (canon §05). The stream chip renders the posture
// the caller derived (lib/stream-posture.ts) in the posture's own register —
// accent when connected, never green — and the snapshot chip beside it wears
// the SLA tier of the age it states, so a healthy transport can never launder
// a stale analysis (house law 3).

export interface RibbonAsOf {
  /** The input's name, e.g. "aave_v3", "debt_manager", "sweep". */
  label: string;
  /** Its OWN as-of, e.g. "@25,641,730", "age 41s". */
  value: string;
  tone?: "default" | "ok" | "warn" | "crit" | "dim";
}

/** The snapshot chip: its composed parts, its tier, and its full title. */
export interface RibbonSnapshotChip {
  /** From `snapshotChipParts` / `snapshotChipUnknown` (lib/freshness.ts). */
  readonly parts: SnapshotChipParts;
  /**
   * The SLA tier of the stated age — styles the chip per canon §06 (fresh →
   * quiet, aging → warn, stale → crit outline, critical → crit fill). `null`
   * is the UNKNOWN register: dashed, never any tier's color, because an
   * unknown age has no tier, not a small one.
   */
  readonly tier: FreshnessTier | null;
  /** The chip's explanatory title (includes the fallback-thresholds disclosure). */
  readonly title: string;
}

// The coverage chip's reading is derived by the caller through the PURE
// `ribbonCoverage` (lib/coverage.ts — unit-pinned honesty arms: partial
// warns, unbindable → null → no chip). `answered < total` renders the warn
// variant with the withheld engines NAMED — counts reconcile visibly, no
// silent shrinkage (canon §05 dimension 3).
export type { RibbonCoverage } from "@/lib/coverage";

export type RibbonProps =
  | {
      mode: "stream";
      /**
       * WHAT THE CURRENT CONNECTION IS DOING, derived by the caller from
       * `streamState` + `hasBase` (lib/stream-posture.ts). Every posture is a
       * chip — CONNECTED included — because a reader losing their connection
       * must not also lose their book, and a healthy socket must not be
       * allowed to imply a fresh batch.
       */
      posture: RibbonStreamPosture;
      /**
       * The watermark vector. Every entry names its own as-of. Rendered
       * INSIDE the "Data status →" popover — raw block heights and poll
       * marks are not bar chrome (canon §10).
       */
      asOfs: readonly RibbonAsOf[];
      /** Current batch is superseded — a warn-register chip. */
      superseded?: boolean;
      /** The batch's freshness statement, always visible at every age. */
      snapshot?: RibbonSnapshotChip;
      /** The served batch's identity chip: `BATCH #id`. */
      batchId?: number;
      /** The engine-coverage chip; null/omitted when underivable (ledgered). */
      coverage?: RibbonCoverage | null;
    }
  | {
      mode: "proof";
      /** The exact pin, e.g. "bk_019fb0a2" or a block pin. */
      pin: string;
      /** e.g. "reconcile 12/12 exact". */
      detail?: string;
    };

/** Posture tone → canon chip register (see stream-posture.ts's tone doc). */
const TONE_CLASS: Record<RibbonPostureTone, string | undefined> = {
  accent: styles.cAccent,
  warn: styles.cWarn,
  waiting: styles.cUnknown,
  down: styles.cCrit,
};

/** SLA tier → canon chip register (§06: outline-first, fill = escalation). */
const TIER_CLASS: Record<FreshnessTier, string | undefined> = {
  fresh: styles.cQuiet,
  aging: styles.cWarn,
  stale: styles.cCrit,
  critical: styles.cCritFill,
};

export function Ribbon(props: RibbonProps) {
  if (props.mode === "proof") {
    return (
      <span className={styles.ribbon}>
        <span className={`${styles.badge} ${styles.proof}`}>PROOF · EXACT @ {props.pin}</span>
        {props.detail !== undefined && <span className={styles.asOf}>{props.detail}</span>}
      </span>
    );
  }

  const { posture } = props;
  const snapshot = props.snapshot;
  const coverage = props.coverage ?? null;
  return (
    <div className={styles.appbar}>
      <span
        className={`${styles.chip} ${TONE_CLASS[posture.tone]}`}
        data-testid="ribbon-stream"
        title="the stream connection's own posture — a separate statement from the snapshot's age beside it"
      >
        {posture.tone === "accent" && <i className={`${styles.dot} ${styles.pulse}`} aria-hidden />}
        {posture.label}
      </span>
      {snapshot !== undefined && (
        <>
          <i className={styles.sep} aria-hidden />
          <span
            data-testid="ribbon-snapshot"
            className={`${styles.chip} ${
              snapshot.tier === null ? styles.cUnknown : TIER_CLASS[snapshot.tier]
            }`}
            title={snapshot.title}
          >
            {snapshot.parts.label} <span className={styles.val}>{snapshot.parts.age}</span>
            {snapshot.parts.tierWord !== null && <> · {snapshot.parts.tierWord}</>}
          </span>
        </>
      )}
      {props.batchId !== undefined && (
        <>
          <i className={styles.sep} aria-hidden />
          <span
            className={`${styles.chip} ${styles.cQuiet}`}
            data-testid="ribbon-batch"
            title="the served batch's identity — its freshness is the SNAPSHOT chip's statement"
          >
            {/* p1b-14: a batch id is a wire population. The ribbon sits ABOVE
                the p1b-0 route boundary, so its refusal is the word register
                (`unreadable`), never a throw that could unmount the shell. */}
            BATCH{" "}
            <span className={styles.val}>
              #{isWirePopulation(props.batchId) ? String(props.batchId) : "unreadable"}
            </span>
          </span>
        </>
      )}
      {coverage !== null && (
        <>
          <i className={styles.sep} aria-hidden />
          <span
            className={`${styles.chip} ${
              coverage.answered < coverage.total ? styles.cWarn : styles.cQuiet
            }`}
            data-testid="ribbon-coverage"
            title={
              coverage.withheld.length > 0
                ? `engines answering on this batch — withheld: ${coverage.withheld.join(", ")}`
                : "engines answering on this batch — every stamped engine answered"
            }
          >
            COVERAGE{" "}
            <span className={styles.val}>
              {String(coverage.answered)}/{String(coverage.total)}
            </span>{" "}
            ENGINES
            {coverage.withheld.length > 0 && (
              <>
                {" "}
                · <span className={styles.val}>{coverage.withheld.join(", ")}</span> WITHHELD
              </>
            )}
          </span>
        </>
      )}
      {props.superseded === true && (
        <span className={`${styles.chip} ${styles.cWarn}`}>SUPERSEDED</span>
      )}
      {props.asOfs.length > 0 && (
        <details className={styles.dataStatus}>
          <summary className={styles.dataStatusLink} data-testid="ribbon-data-status">
            Data status →
          </summary>
          <div className={styles.dataStatusPanel} data-testid="ribbon-data-status-panel">
            {props.asOfs.map((asOf) => (
              <span key={asOf.label} className={styles.asOf}>
                {asOf.label}{" "}
                <b
                  className={
                    asOf.tone !== undefined && asOf.tone !== "default"
                      ? styles[asOf.tone]
                      : undefined
                  }
                >
                  {asOf.value}
                </b>
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
