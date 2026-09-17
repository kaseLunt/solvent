"use client";

import kit from "@/components/kit/kit.module.css";
import { LEDGER_TYPES_NOTE } from "@/lib/activity-view";
import {
  EVENT_DISPLAY_TYPES,
  FEED_ENGINES,
  SINCE_BLOCK_IMPOSSIBILITY,
  type EventDisplayType,
  type FeedEngine,
  type FeedOrderMode,
} from "@/lib/feed-data";
import { engineName } from "@/lib/inspector-headline";
import styles from "./activity.module.css";

export interface ActivityControlsProps {
  engine: FeedEngine | null;
  view: "all" | "ledger";
  types: readonly EventDisplayType[];
  mode: FeedOrderMode;
  sinceBlock: number | null;
  sinceDraft: string;
  onEngine: (engine: FeedEngine | null) => void;
  onView: (view: "all" | "ledger") => void;
  onType: (type: EventDisplayType) => void;
  onSinceDraft: (draft: string) => void;
  onApplySince: () => void;
}

const BTN = `${kit.btn} ${kit.btnGhost} ${styles.chipBtn}`;

/**
 * The walk's scope as pressed ghost buttons: engine (cross-engine or one of the two, named as the page names them),
 * view (every action or the liquidations ledger, which pins the type), the type vocabulary (the wire's own words,
 * never invented), and the since-block bound — a real control only engine-scoped; cross-engine it is a stated
 * impossibility, a property of chains, not a disabled control and not an error. The surface owns what each press
 * does to the walk; this component only names the choices.
 */
export function ActivityControls({
  engine,
  view,
  types,
  mode,
  sinceBlock,
  sinceDraft,
  onEngine,
  onView,
  onType,
  onSinceDraft,
  onApplySince,
}: ActivityControlsProps) {
  const scoped = mode === "engine-scoped";
  return (
    <>
      <div className={styles.controls}>
        <span className={styles.group}>
          <span className={styles.groupLabel}>engine</span>
          <button
            type="button"
            className={BTN}
            aria-pressed={engine === null}
            data-testid="activity-engine-all"
            onClick={() => {
              onEngine(null);
            }}
          >
            cross-engine
          </button>
          {FEED_ENGINES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={BTN}
              aria-pressed={candidate === engine}
              data-testid={`activity-engine-${candidate}`}
              onClick={() => {
                onEngine(candidate);
              }}
            >
              {engineName(candidate)}
            </button>
          ))}
        </span>

        <span className={styles.group}>
          <span className={styles.groupLabel}>view</span>
          <button
            type="button"
            className={BTN}
            aria-pressed={view === "all"}
            data-testid="activity-view-all"
            onClick={() => {
              onView("all");
            }}
          >
            all actions
          </button>
          <button
            type="button"
            className={BTN}
            aria-pressed={view === "ledger"}
            data-testid="activity-view-ledger"
            onClick={() => {
              onView("ledger");
            }}
          >
            liquidations ledger
          </button>
        </span>
      </div>

      <div className={styles.controls}>
        {view === "ledger" ? (
          <span className={styles.impossible} data-testid="activity-types-note">
            {LEDGER_TYPES_NOTE}
          </span>
        ) : (
          <span className={styles.group} data-testid="activity-types">
            <span className={styles.groupLabel}>type</span>
            {EVENT_DISPLAY_TYPES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={BTN}
                aria-pressed={types.includes(candidate)}
                data-testid={`activity-type-${candidate}`}
                onClick={() => {
                  onType(candidate);
                }}
              >
                {candidate}
              </button>
            ))}
          </span>
        )}

        <span className={scoped ? styles.group : styles.impossible} data-testid="activity-since" data-possible={scoped}>
          {scoped ? (
            <>
              <span className={styles.groupLabel}>since block</span>
              <input
                className={styles.sinceInput}
                inputMode="numeric"
                aria-label="since block"
                placeholder={`height on ${engine ?? ""}`}
                value={sinceDraft}
                data-testid="activity-since-input"
                onChange={(changeEvent) => {
                  onSinceDraft(changeEvent.target.value);
                }}
                onKeyDown={(keyEvent) => {
                  if (keyEvent.key === "Enter") onApplySince();
                }}
              />
              <button type="button" className={BTN} onClick={onApplySince} data-testid="activity-since-apply">
                apply
              </button>
              {sinceBlock !== null && (
                <span className={styles.applied} data-testid="activity-since-applied">
                  ≥ {String(sinceBlock)}
                </span>
              )}
            </>
          ) : (
            <>since_block · {SINCE_BLOCK_IMPOSSIBILITY}</>
          )}
        </span>
      </div>
    </>
  );
}
