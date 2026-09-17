import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import { horizonLabel, stressVerdict, stressVerdictWords, type StressRow, type StressSide } from "@/lib/address-stress";
import { humanUsdFull } from "@/lib/human-price";
import { stressBatchNote, stressEmptyText, type InspectorView } from "@/lib/inspector-view";
import { isWireScale } from "@/lib/wireGuard";
import styles from "../inspector.module.css";
import { moneyFor } from "./money";

const COLUMNS = [
  { key: "scenario", header: "Scenario" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];

function realization(r: StressRow): string | null {
  const m = r.marketRealization;
  if (m === null || !isWireScale(m.decimals)) return null;
  const part = (label: string, v: bigint | null): string | null => (v === null ? null : `${label} ${humanUsdFull(v, m.decimals)}`);
  const parts = [part("shortfall", m.shortfall), part("bad debt", m.badDebt)].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * The committed scenarios applied to this account — the wire's own before/after sides; a rate step is a delta-only
 * projection. The view reads the stress lookup and decides the verdict words, the batch note and the empty words;
 * this file only places the rows. Before and after are the STRESS body's own sides, read for the batch it names.
 */
export function StressTable({ view }: { view: InspectorView }) {
  const money = moneyFor(view.decimals);
  const room = (side: StressSide | null): string => money(side?.room);
  const result = view.stress;
  const note = stressBatchNote(view);
  const rows: KitRow[] =
    result === null || result.kind !== "rows"
      ? []
      : result.rows.map((r) => {
          const projected = r.projection !== null;
          const extra = realization(r);
          const verdict = stressVerdictWords(stressVerdict(r));
          return {
            key: r.id,
            dim: !r.applicable,
            cells: {
              scenario: (
                <>
                  {projected ? (
                    <span title={r.projectionNote ?? undefined}>
                      {r.label} <StatusPill tone="projection">PROJECTION</StatusPill>
                    </span>
                  ) : (
                    r.label
                  )}
                  {note !== null && <span className={styles.detail}>{note.rowLabel}</span>}
                </>
              ),
              before: room(r.before),
              after:
                r.projection !== null ? (
                  r.projection.map((h) => `${horizonLabel(h.seconds)}: ${h.extraInterest === null ? "—" : `+${money(h.extraInterest)}`} interest`).join(" · ")
                ) : extra === null ? (
                  room(r.after)
                ) : (
                  <>
                    {room(r.after)}
                    <span className={styles.detail}>{extra}</span>
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
        title="Stress this address"
        qualifier="the committed scenarios, applied to this account · shocked figures are projections, not readings"
        link={{ href: view.cash === null ? "/lab" : `/lab?address=${view.cash.account}`, label: "Open Scenarios →" }}
      />
      {note !== null && (
        <p className={styles.note} role="note" data-testid="inspector-stress-batch">
          {note.disclosure}
        </p>
      )}
      <KitTable testId="inspector-stress-table" columns={COLUMNS} rows={rows} emptyText={stressEmptyText(view)} />
      <p className={styles.dim}>Before and after are the engine’s own cap and debt under each shock; a rate step is a delta-only projection with prices held flat.</p>
    </section>
  );
}
