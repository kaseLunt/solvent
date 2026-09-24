import { KitTable, SectionHead, StatusPill, type KitColumn, type KitRow } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { PROJECTION_ROOM_CELL, realizationWords, roomCell, rowVerdict, stressVerdictWords, type StressSide } from "@/lib/address-stress";
import {
  OPEN_IN_SCENARIOS,
  projectionRowSub,
  PROJECTION_TITLE,
  PROJECTION_WORD,
  STRESS_QUALIFIER,
  STRESS_TITLE,
  stressBatchNote,
  stressCaption,
  stressEmptyText,
  stressRoomToday,
  type InspectorView,
} from "@/lib/inspector-view";
import styles from "../inspector.module.css";

const BEFORE: KitColumn = { key: "before", header: "Room today", align: "right" };
const AFTER: KitColumn = { key: "after", header: "Room after", align: "right" };
const SCENARIO: KitColumn = { key: "scenario", header: "Scenario" };
const FLIPS: KitColumn = { key: "flips", header: "Becomes liquidatable?", align: "right" };

/**
 * The committed scenarios applied to this account — the wire's own before/after sides; a rate step is a delta-only
 * projection. The lib decides the row's verdict (`rowVerdict`, the one judge the Scenarios page shares), its room
 * cell, its projection's words, the batch note, the caption and the empty words; this file only places the rows.
 * Room today is one figure for the whole table, so the caption states it once while the rows agree; the section wears
 * the one PROJECTION badge its shocked figures sit under. Every Room after cell is a percent of the cap or a state
 * word: a projection's interest rides under its name, so the column keeps one unit.
 */
export function StressTable({ view }: { view: InspectorView }) {
  const room = (side: StressSide | null) => {
    const cell = roomCell(side, view.decimals, view.scaleAbsence);
    return (
      <span className={cell.over ? styles.over : undefined} title={cell.title ?? undefined}>
        {cell.text}
      </span>
    );
  };
  const result = view.stress;
  const note = stressBatchNote(view);
  const todayOnce = stressRoomToday(view) !== null;
  const columns = todayOnce ? [SCENARIO, AFTER, FLIPS] : [SCENARIO, BEFORE, AFTER, FLIPS];
  const rows: KitRow[] =
    result === null || result.kind !== "rows"
      ? []
      : result.rows.map((r) => {
          const extra = realizationWords(r.marketRealization);
          const verdict = stressVerdictWords(rowVerdict(r));
          return {
            key: r.id,
            dim: !r.applicable,
            cells: {
              scenario: (
                <>
                  <span className={styles.scenarioName} title={r.projection === null ? r.label : (r.projectionNote ?? r.label)}>
                    {r.name}
                  </span>
                  {r.projection !== null && (
                    <span className={styles.detail}>{projectionRowSub(r.projection, view.decimals, view.scaleAbsence)}</span>
                  )}
                  {note !== null && <span className={styles.detail}>{note.rowLabel}</span>}
                </>
              ),
              before: room(r.before),
              after:
                r.projection !== null ? (
                  <span className={styles.stateCell} title={PROJECTION_ROOM_CELL.title}>
                    {PROJECTION_ROOM_CELL.text}
                  </span>
                ) : (
                  <>
                    {room(r.after)}
                    {extra !== null && <span className={styles.detail}>{extra}</span>}
                  </>
                ),
              flips:
                verdict.tone !== null ? (
                  <StatusPill tone={verdict.tone} title={verdict.title ?? undefined}>
                    {verdict.text}
                  </StatusPill>
                ) : verdict.title !== null ? (
                  <span title={verdict.title}>{verdict.text}</span>
                ) : (
                  verdict.text
                ),
            },
          };
        });
  return (
    <section id="stress" data-testid="inspector-stress">
      <SectionHead
        title={STRESS_TITLE}
        qualifier={STRESS_QUALIFIER}
        badge={
          <span data-testid="inspector-stress-projection">
            <StatusPill tone="projection" title={PROJECTION_TITLE}>
              {PROJECTION_WORD}
            </StatusPill>
          </span>
        }
        link={{ href: view.cash === null ? "/lab" : `/lab?address=${view.cash.account}`, label: OPEN_IN_SCENARIOS }}
      />
      {note !== null && (
        <p className={styles.note} role="note" data-testid="inspector-stress-batch">
          {note.disclosure}
        </p>
      )}
      <div className={kit.card}>
        <KitTable testId="inspector-stress-table" columns={columns} rows={rows} emptyText={stressEmptyText(view)} label={STRESS_TITLE} />
      </div>
      <p className={styles.dim} data-testid="inspector-stress-caption">
        {stressCaption(view)}
      </p>
    </section>
  );
}
