import { formatUnits } from "@solvent/client";
import { KpiTile, type Tone } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { groupDecimalString } from "@/lib/book-format";
import { humanUsdFull } from "@/lib/human-price";
import type { CashStatus } from "@/lib/inspector-position";
import type { InspectorView } from "@/lib/inspector-view";

const STATUS_WORD: Record<CashStatus, string> = {
  liquidatable: "Liquidatable",
  near: "Near cap",
  healthy: "Healthy",
  refused: "Not computed",
  unknowable: "Not computed",
};
const STATUS_TONE: Record<CashStatus, Tone> = { liquidatable: "crit", near: "warn", healthy: "ok", refused: "refused", unknowable: "refused" };

/** Debt · Borrow cap · Room · Collateral · Status — the same five in every state; only the readings change. */
export function InspectorTiles({ view }: { view: InspectorView }) {
  const { cash, refusedTiles, decimals } = view;
  const pending = view.state === "loading";
  const money = (v: bigint | null | undefined): string => (v == null ? "—" : humanUsdFull(v, decimals));
  // The refused register's sub-line says WHY there is no figure, in the state's own word.
  const notComputed = pending
    ? ""
    : view.state === "no-position"
      ? "no position"
      : view.state === "cannot-compute"
        ? "withheld"
        : view.state === "unavailable"
          ? "lookup unavailable"
          : "not computed";
  const exactDebt = cash?.debt == null ? null : groupDecimalString(formatUnits(cash.debt.toString(), decimals, { trim: false }));
  const roomTone: Tone = cash === null || refusedTiles ? "refused" : cash.status === "liquidatable" ? "crit" : cash.status === "near" ? "warn" : "neutral";
  const legs = view.table?.legs.length ?? 0;
  return (
    <div className={`${kit.kpis} ${kit.kpis5}`}>
      <KpiTile
        testId="inspector-kpi-debt"
        label="Debt"
        value={refusedTiles ? "—" : money(cash?.debt)}
        sub={refusedTiles ? (cash?.debt != null ? `last readable ${money(cash.debt)} · ${notComputed}` : notComputed) : `USD · ${exactDebt ?? "—"} exact`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-cap"
        label="Borrow cap"
        value={refusedTiles ? "—" : money(cash?.cap)}
        sub={refusedTiles ? notComputed : "Σ collateral × per-asset LTV"}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-room"
        label="Room"
        value={refusedTiles ? "—" : money(cash?.room)}
        sub={refusedTiles ? notComputed : `${cash?.roomPercent ?? "—"} of cap`}
        tone={roomTone}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-collateral"
        label="Collateral"
        value={refusedTiles ? "—" : money(cash?.collateral)}
        sub={refusedTiles ? notComputed : `${String(legs)} asset${legs === 1 ? "" : "s"} · by asset ↓`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-status"
        label="Status"
        value={cash === null ? "—" : STATUS_WORD[cash.status]}
        sub="strict rule: debt > cap"
        tone={cash === null ? "refused" : STATUS_TONE[cash.status]}
        pending={pending}
      />
    </div>
  );
}
