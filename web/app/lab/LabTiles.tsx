import { KpiTile } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { newlyTone } from "@/lib/lab-headline";
import { LAB_TILE_LABELS, resultTileWords, type EngineReading, type TileAbsence } from "@/lib/lab-view";

/**
 * Newly liquidatable · Liquidatable debt · Bad debt at liquidation · Accounts changing band — the same four in every
 * state, so an absence keeps its place on the page and names itself in its own register, never a dash. The newly tile
 * wears the headline's own tone (`newlyTone`): a net at or below zero beside crossings or band changes is never ok.
 */
export function LabTiles({ reading, absence, testPrefix }: { reading: EngineReading | null; absence: TileAbsence | null; testPrefix: string }) {
  const r = reading?.kind === "result" ? reading.result : null;
  if (r === null) {
    const state = absence?.register ?? "not-run";
    const tile = (key: string, label: string) => <KpiTile testId={`${testPrefix}-${key}`} label={label} value="" state={state} stateWord={absence?.word} />;
    return (
      <div className={`${kit.kpis} ${kit.kpis4}`}>
        {tile("newly", LAB_TILE_LABELS.newly)}
        {tile("debt", LAB_TILE_LABELS.debt)}
        {tile("baddebt", LAB_TILE_LABELS.badDebt)}
        {tile("moved", LAB_TILE_LABELS.band)}
      </div>
    );
  }
  const words = resultTileWords(r);
  return (
    <div className={`${kit.kpis} ${kit.kpis4}`}>
      <KpiTile testId={`${testPrefix}-newly`} label={LAB_TILE_LABELS.newly} value={words.newly.value} sub={words.newly.sub} tone={newlyTone(r.newly, r.heat)} />
      <KpiTile testId={`${testPrefix}-debt`} label={LAB_TILE_LABELS.debt} value={words.debt.value} sub={words.debt.sub} tone={r.deltaEligibleDebt > 0n ? "crit" : "neutral"} />
      <KpiTile testId={`${testPrefix}-baddebt`} label={LAB_TILE_LABELS.badDebt} value={words.badDebt.value} sub={words.badDebt.sub} tone={r.deltaBadDebt > 0n ? "warn" : "neutral"} />
      <KpiTile testId={`${testPrefix}-moved`} label={LAB_TILE_LABELS.band} value={words.band.value} sub={words.band.sub} title={words.band.title} />
    </div>
  );
}
