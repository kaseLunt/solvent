import { ChartCard, KitTable, StatusPill, type KitRow } from "@/components/kit";
import {
  BACKING_TITLE,
  backingEmptyText,
  backingFinding,
  boundaryText,
  capDisagreement,
  PRICE_INPUTS,
  priceVerdictWord,
  type InspectorView,
} from "@/lib/inspector-view";
import styles from "../inspector.module.css";
import { accountMoneyColumn } from "./money";

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
  // One precision per money column, picked from every figure the column prints — the total row's included. A price
  // column keeps each asset's own places.
  const valueMoney = accountMoneyColumn([...(table?.legs.map((l) => l.value) ?? []), cash?.collateral], decimals);
  const capMoney = accountMoneyColumn([...(table?.legs.map((l) => l.contribution) ?? []), cash?.cap], decimals);
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
                      {leg.price}{" "}
                      <StatusPill tone={leg.priceVerdict === "stale" ? "warn" : "crit"} title={leg.priceVerdict}>
                        {priceVerdictWord(leg.priceVerdict)}
                      </StatusPill>
                    </>
                  ) : (
                    leg.price
                  ),
                value: valueMoney(leg.value),
                ltv: <span title="counts toward cap ÷ value — the LTV the engine applied to this asset">{leg.ltv ?? "—"}</span>,
                contribution: capMoney(leg.contribution),
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
              value: valueMoney(cash?.collateral),
              ltv: "",
              contribution: <b>{capMoney(cash?.cap)}</b>,
            },
          },
        ];
  return (
    <ChartCard
      title={BACKING_TITLE}
      testId="inspector-backing-card"
      link={table === null ? undefined : { onClick: onPrices, label: PRICE_INPUTS }}
      finding={backingFinding(view)}
    >
      {table === null ? (
        <p className={styles.note}>{backingEmptyText(view)}</p>
      ) : (
        <>
          <KitTable testId="inspector-backing" columns={COLUMNS} rows={rows} label={BACKING_TITLE} />
          {table.usdRefusal !== null && (
            <p className={styles.dim} data-testid="inspector-backing-refusal">
              {table.usdRefusal}
            </p>
          )}
          {table.capAgrees === false && <p className={styles.dim}>{capDisagreement(capMoney(table.sumContribution), capMoney(cash?.cap))}</p>}
          {boundary !== null && (
            <p className={styles.boundary} data-testid="inspector-boundary" data-kind={boundary.kind} title={"title" in boundary ? boundary.title : undefined}>
              {boundaryText(boundary)}
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
