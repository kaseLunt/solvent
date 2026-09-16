import { KitTable, SectionHead, StatusPill, type KitRow } from "@/components/kit";
import type { AddressReading } from "@/lib/address-lookup";
import { stressReading, type StressRow, type StressSide } from "@/lib/address-stress";
import { humanUsdFull } from "@/lib/human-price";
import type { InspectorView } from "@/lib/inspector-view";
import { isWireScale } from "@/lib/wireGuard";
import styles from "../inspector.module.css";
import { moneyFor } from "./money";

const COLUMNS = [
  { key: "scenario", header: "Scenario" },
  { key: "before", header: "Room today", align: "right" as const },
  { key: "after", header: "Room after", align: "right" as const },
  { key: "flips", header: "Becomes liquidatable?", align: "right" as const },
];
/** A horizon in days, or hours under a day — never "0d". */
const days = (seconds: number): string => (seconds < 86_400 ? `${String(Math.max(1, Math.round(seconds / 3_600)))}h` : `${String(Math.round(seconds / 86_400))}d`);

function realization(r: StressRow): string | null {
  const m = r.marketRealization;
  if (m === null || !isWireScale(m.decimals)) return null;
  const part = (label: string, v: bigint | null): string | null => (v === null ? null : `${label} ${humanUsdFull(v, m.decimals)}`);
  const parts = [part("shortfall", m.shortfall), part("bad debt", m.badDebt)].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The committed scenarios applied to this account — the wire's own before/after sides; a rate step is a delta-only projection. */
export function StressTable({ reading, view }: { reading: AddressReading; view: InspectorView }) {
  const { decimals } = view;
  const money = moneyFor(decimals);
  const room = (side: StressSide | null): string => money(side?.room);
  const stress = reading.stress;
  const result = stress.phase === "ready" ? stressReading(stress.value, reading.address) : null;
  const rows: KitRow[] =
    result === null || result.kind !== "rows"
      ? []
      : result.rows.map((r) => {
          const projected = r.projection !== null;
          const flipsAt = r.projection?.find((h) => h.verdict === "liquidatable");
          const extra = realization(r);
          return {
            key: r.id,
            dim: !r.applicable,
            cells: {
              scenario: projected ? (
                <span title={r.projectionNote ?? undefined}>
                  {r.label} <StatusPill tone="projection">PROJECTION</StatusPill>
                </span>
              ) : (
                r.label
              ),
              before: room(r.before),
              after:
                r.projection !== null ? (
                  r.projection.map((h) => `${days(h.seconds)}: ${h.extraInterest === null ? "—" : `+${money(h.extraInterest)}`} interest`).join(" · ")
                ) : extra === null ? (
                  room(r.after)
                ) : (
                  <>
                    {room(r.after)}
                    <span className={styles.detail}>{extra}</span>
                  </>
                ),
              flips: !r.applicable ? (
                (r.reason ?? "not applicable")
              ) : r.flips === null ? (
                <StatusPill tone="refused">Cannot say</StatusPill>
              ) : r.flips ? (
                <StatusPill tone="crit">Yes</StatusPill>
              ) : projected ? (
                flipsAt === undefined ? "No" : <StatusPill tone="warn">Within {days(flipsAt.seconds)}</StatusPill>
              ) : (
                "No"
              ),
            },
          };
        });
  const emptyText =
    stress.phase === "loading"
      ? "Running the committed scenarios…"
      : stress.phase === "error"
        ? `Stress unavailable: ${stress.message}`
        : result?.kind === "withheld"
          ? `Stress withheld: ${result.cause}.`
          : result?.kind === "no-position"
            ? "No position to stress."
            : "No scenarios.";
  return (
    <section id="stress" data-testid="inspector-stress">
      <SectionHead
        title="Stress this address"
        qualifier="the committed scenarios, applied to this account · shocked figures are projections, not readings"
        link={{ href: "/lab", label: "Open Scenarios →" }}
      />
      <KitTable testId="inspector-stress-table" columns={COLUMNS} rows={rows} emptyText={emptyText} />
      <p className={styles.dim}>Before and after are the engine’s own cap and debt under each shock; a rate step is a delta-only projection with prices held flat.</p>
    </section>
  );
}
