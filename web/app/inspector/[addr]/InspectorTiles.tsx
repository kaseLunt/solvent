import { KpiTile } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { ExactValue } from "@/components/ExactValue";
import { debtExactWords, inspectorTiles, type InspectorView } from "@/lib/inspector-view";

/** Debt · Borrow cap · Room · Collateral · Status — the same five in every state; the lib decides every reading. */
export function InspectorTiles({ view }: { view: InspectorView }) {
  return (
    <div className={`${kit.kpis} ${kit.kpis5}`}>
      {inspectorTiles(view).map((tile) => (
        <KpiTile
          key={tile.key}
          testId={`inspector-kpi-${tile.key}`}
          label={tile.label}
          value={tile.value}
          sub={
            tile.exact === undefined ? (
              tile.sub
            ) : (
              <>
                {tile.sub} · <ExactValue human={debtExactWords(tile.exact)} exact={tile.exact} />
              </>
            )
          }
          tone={tile.tone}
          state={tile.state}
          stateWord={tile.state === undefined ? undefined : tile.value}
          pending={tile.pending}
        />
      ))}
    </div>
  );
}
