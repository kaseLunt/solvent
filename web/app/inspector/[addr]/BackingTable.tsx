import { ChartCard, KitTable, StatusPill, type KitRow } from "@/components/kit";
import { humanAge } from "@/lib/freshness";
import { oldestPriceAge } from "@/lib/inspector-position";
import type { InspectorView } from "@/lib/inspector-view";
import styles from "../inspector.module.css";
import { moneyFor } from "./money";

const COLUMNS = [
  { key: "asset", header: "Asset" },
  { key: "amount", header: "Amount", align: "right" as const },
  { key: "price", header: "Price", align: "right" as const },
  { key: "value", header: "Value", align: "right" as const },
  { key: "ltv", header: "LTV", align: "right" as const },
  { key: "contribution", header: "Counts toward cap", align: "right" as const },
];

/** What backs this debt: one row per collateral asset, the cap total row, and the boundary sentence (spec §5.3). */
export function BackingTable({ view, onPrices }: { view: InspectorView; onPrices: () => void }) {
  const { table, cash, decimals, boundary } = view;
  const money = moneyFor(decimals);
  const oldest = view.cashWire === null ? null : oldestPriceAge(view.cashWire.price_inputs);
  const rows: KitRow[] =
    table === null
      ? []
      : [
          ...table.legs.map(
            (leg): KitRow => ({
              key: leg.asset,
              testId: `inspector-backing-${leg.symbol}`,
              dim: leg.counted === "not-counted",
              cells: {
                asset: leg.symbol,
                amount: leg.amount ?? "—",
                price:
                  leg.price === null ? (
                    "—"
                  ) : leg.priceVerdict !== null && leg.priceVerdict !== "fresh" ? (
                    <>
                      {leg.price} <StatusPill tone={leg.priceVerdict === "stale" ? "warn" : "crit"}>{leg.priceVerdict}</StatusPill>
                    </>
                  ) : (
                    leg.price
                  ),
                value: money(leg.value),
                ltv: <span title="counts toward cap ÷ value — the LTV the engine applied to this asset">{leg.ltv ?? "—"}</span>,
                contribution: money(leg.contribution),
              },
            }),
          ),
          {
            key: "cap",
            testId: "inspector-backing-cap",
            cells: {
              asset: <span className={styles.capLabel}>Borrow cap</span>,
              amount: "",
              price: "",
              value: money(cash?.collateral),
              ltv: "",
              contribution: <b>{money(cash?.cap)}</b>,
            },
          },
        ];
  const emptyNote =
    view.state === "no-position"
      ? "No Cash position in this batch — nothing to back."
      : view.state === "loading"
        ? "Loading…"
        : view.state === "cannot-compute"
          ? "The Cash book is withheld this batch — nothing can be read."
          : "Not computed.";
  return (
    <ChartCard
      title="What backs this debt"
      testId="inspector-backing-card"
      link={table === null ? undefined : { onClick: onPrices, label: "Price inputs →" }}
      finding={
        table === null
          ? view.state === "loading"
            ? "Loading…"
            : "Not computed."
          : `Cap = Σ (collateral value × that asset's LTV)${oldest === null ? "" : ` · prices as of ${humanAge(oldest)} ago`}`
      }
    >
      {table === null ? (
        <p className={styles.note}>{emptyNote}</p>
      ) : (
        <>
          <KitTable testId="inspector-backing" columns={COLUMNS} rows={rows} />
          {table.capAgrees === false && (
            <p className={styles.dim}>
              The legs sum to {money(table.sumContribution)}; the engine’s cap is {money(cash?.cap)} — the engine’s figure leads.
            </p>
          )}
          {boundary !== null && (
            <p className={styles.boundary} data-testid="inspector-boundary" data-kind={boundary.kind} title={"title" in boundary ? boundary.title : undefined}>
              {boundary.kind === "boundary" && <>Boundary: {boundary.sentence}</>}
              {boundary.kind === "breached" && "Already past the boundary: the current prices are below the level that keeps this account healthy."}
              {boundary.kind === "no-price-path" && boundary.sentence}
              {boundary.kind === "absent" && "No boundary price was published for this position."}
              {boundary.kind === "unreadable" && `Boundary published but unreadable (${boundary.fields.join(", ")}) — not read.`}
              {boundary.kind === "contradictory" && `Boundary withheld: ${boundary.detail}.`}
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
