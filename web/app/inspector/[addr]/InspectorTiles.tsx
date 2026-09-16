import { KpiTile, type Tone } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import type { CashStatus } from "@/lib/inspector-position";
import type { InspectorView } from "@/lib/inspector-view";
import { moneyFor, wireExact } from "./money";

const STATUS_WORD: Record<CashStatus, string> = {
  liquidatable: "Liquidatable",
  near: "Near cap",
  healthy: "Healthy",
  refused: "Not computed",
  unknowable: "Not computed",
};
const STATUS_TONE: Record<CashStatus, Tone> = { liquidatable: "crit", near: "warn", healthy: "ok", refused: "refused", unknowable: "refused" };

/** The refused register's sub-line says WHY there is no figure, in the state's own word. */
function refusedWord(state: InspectorView["state"]): string {
  switch (state) {
    case "no-position":
      return "no position";
    case "legacy-only":
      return "no Cash position";
    case "cannot-compute":
      return "withheld";
    case "unavailable":
      return "lookup unavailable";
    default:
      return "not computed";
  }
}

/** Debt · Borrow cap · Room · Collateral · Status — the same five in every state; only the readings change. */
export function InspectorTiles({ view }: { view: InspectorView }) {
  const { cash, cashWire, refusedTiles, decimals } = view;
  const pending = view.state === "loading";
  const money = moneyFor(decimals);
  const word = pending ? undefined : refusedWord(view.state);
  // The view withholds a negative "last readable" debt from the dek; the tile follows the same rule.
  const lastReadable = cash !== null && cash.debt !== null && cash.debt >= 0n ? money(cash.debt) : null;
  const exactDebt = cashWire === null || decimals === null ? null : wireExact(cashWire.borrowings, decimals);
  const roomTone: Tone = cash === null || refusedTiles ? "refused" : cash.status === "liquidatable" ? "crit" : cash.status === "near" ? "warn" : "neutral";
  const legs = view.table?.legs.length ?? 0;
  return (
    <div className={`${kit.kpis} ${kit.kpis5}`}>
      <KpiTile
        testId="inspector-kpi-debt"
        label="Debt"
        value={refusedTiles ? "—" : money(cash?.debt)}
        sub={refusedTiles ? (lastReadable !== null && word !== undefined ? `last readable ${lastReadable} · ${word}` : word) : `USD · ${exactDebt ?? "—"} exact`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-cap"
        label="Borrow cap"
        value={refusedTiles ? "—" : money(cash?.cap)}
        sub={refusedTiles ? word : "Σ collateral × per-asset LTV"}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-room"
        label="Room"
        value={refusedTiles ? "—" : money(cash?.room)}
        sub={refusedTiles ? word : `${cash?.roomPercent ?? "—"} of cap`}
        tone={roomTone}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-collateral"
        label="Collateral"
        value={refusedTiles ? "—" : money(cash?.collateral)}
        sub={refusedTiles ? word : `${String(legs)} asset${legs === 1 ? "" : "s"} · by asset ↓`}
        tone={refusedTiles ? "refused" : "neutral"}
        pending={pending}
      />
      <KpiTile
        testId="inspector-kpi-status"
        label="Status"
        value={cash === null ? "—" : STATUS_WORD[cash.status]}
        sub={pending ? undefined : "strict rule: debt > cap"}
        tone={cash === null ? "refused" : STATUS_TONE[cash.status]}
        pending={pending}
      />
    </div>
  );
}
