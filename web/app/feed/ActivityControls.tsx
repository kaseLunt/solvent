"use client";

import { ToggleGroup, type ToggleOption } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import {
  ACTIVITY_COPY,
  ACTIVITY_SINCE_FULL,
  ACTIVITY_SINCE_SHORT,
  ALL_ENGINES,
  LEDGER_TYPES_NOTE,
  typeLabel,
  typedBlock,
} from "@/lib/activity-view";
import {
  EVENT_DISPLAY_TYPES,
  FEED_ENGINES,
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

type EngineChoice = FeedEngine | "all";

const ENGINE_OPTIONS: readonly ToggleOption<EngineChoice>[] = [
  { value: "all", label: ALL_ENGINES },
  ...FEED_ENGINES.map((engine) => ({ value: engine, label: engineName(engine) })),
];

const VIEW_OPTIONS: readonly ToggleOption<"all" | "ledger">[] = [
  { value: "all", label: ACTIVITY_COPY.allActions },
  { value: "ledger", label: ACTIVITY_COPY.ledger },
];

/** The wire's own classes, never invented, in the page's words — the wire's word on hover. */
const TYPE_OPTIONS: readonly ToggleOption<EventDisplayType>[] = EVENT_DISPLAY_TYPES.map((type) => ({
  value: type,
  label: typeLabel(type),
  title: type,
}));

/**
 * The walk's scope as the kit's toggle groups, each under its visible name, in two rows: the engine (every engine as
 * a side-by-side list, or one of the two — Cash first; one pressed) with the since-block bound beside it — a real
 * control only with one engine chosen, and with none a stated impossibility in short form (its full sentence in the
 * title and the drawer): a property of chains, not a disabled control and not an error; then the view (every action or
 * the liquidations ledger, which pins the type; one pressed) and the type vocabulary (any number pressed). The surface
 * owns what each press does to the walk; this component only names the choices.
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
        <ToggleGroup
          label={ACTIVITY_COPY.engine}
          options={ENGINE_OPTIONS}
          isPressed={(value) => (value === "all" ? engine === null : value === engine)}
          onToggle={(value) => onEngine(value === "all" ? null : value)}
          testId="activity-engine"
          optionTestId={(value) => `activity-engine-${value}`}
        />

        <span
          className={scoped ? styles.since : styles.impossible}
          data-testid="activity-since"
          data-possible={scoped}
          title={scoped ? undefined : ACTIVITY_SINCE_FULL}
        >
          {scoped ? (
            <>
              <span className={styles.sinceLabel}>{ACTIVITY_COPY.sinceLabel}</span>
              <input
                className={styles.sinceInput}
                inputMode="numeric"
                aria-label={ACTIVITY_COPY.sinceLabel}
                placeholder={ACTIVITY_COPY.sincePlaceholder}
                value={sinceDraft}
                data-testid="activity-since-input"
                onChange={(changeEvent) => {
                  onSinceDraft(changeEvent.target.value);
                }}
                onKeyDown={(keyEvent) => {
                  if (keyEvent.key === "Enter") onApplySince();
                }}
              />
              <button type="button" className={`${kit.btn} ${kit.btnGhost} ${styles.apply}`} onClick={onApplySince} data-testid="activity-since-apply">
                {ACTIVITY_COPY.apply}
              </button>
              {sinceBlock !== null && (
                <span className={styles.applied} data-testid="activity-since-applied">
                  ≥ {typedBlock(sinceBlock)}
                </span>
              )}
            </>
          ) : (
            ACTIVITY_SINCE_SHORT
          )}
        </span>
      </div>

      <div className={styles.controls}>
        <ToggleGroup
          label={ACTIVITY_COPY.view}
          options={VIEW_OPTIONS}
          isPressed={(value) => value === view}
          onToggle={onView}
          testId="activity-view"
          optionTestId={(value) => `activity-view-${value}`}
        />
        {view === "ledger" ? (
          <span className={styles.impossible} data-testid="activity-types-note">
            {LEDGER_TYPES_NOTE}
          </span>
        ) : (
          <ToggleGroup
            label={ACTIVITY_COPY.type}
            options={TYPE_OPTIONS}
            isPressed={(value) => types.includes(value)}
            onToggle={onType}
            testId="activity-types"
            optionTestId={(value) => `activity-type-${value}`}
          />
        )}
      </div>
    </>
  );
}
