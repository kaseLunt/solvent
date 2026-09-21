import { KpiTile, type Tone } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { newlyTone, signedCount } from "@/lib/lab-headline";
import type { EngineReading } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import { bookMoney, signedBookMoney } from "./money";

function refusedWord(reading: EngineReading | null): string {
  if (reading === null) return "not run";
  switch (reading.kind) {
    case "withheld":
      return "withheld";
    case "not-covered":
      return "not modelled";
    case "contradictory":
    case "unreadable":
      return "contradictory";
    case "result":
      return "";
  }
}

/**
 * Newly liquidatable · Liquidatable debt Δ · Bad debt at liquidation Δ · Accounts moved — the same four in every state, so a refusal keeps its place on the page and never reads as an absence.
 * The newly tile wears the headline's own tone (`newlyTone`): a net at or below zero beside crossings or band changes is never ok.
 */
export function LabTiles({
  reading,
  pending,
  testPrefix,
}: {
  reading: EngineReading | null;
  pending: boolean;
  testPrefix: string;
}) {
  const r = reading?.kind === "result" ? reading.result : null;
  const word = refusedWord(reading);
  const money = bookMoney(r?.decimals ?? null);
  const signed = signedBookMoney(r?.decimals ?? null);
  const heat = r?.heat ?? null;
  const tone = (t: Tone): Tone => (r === null ? "refused" : t);
  const sub = (text: string) => (r === null ? word : text);
  return (
    <div className={`${kit.kpis} ${kit.kpis4}`}>
      <KpiTile
        testId={`${testPrefix}-newly`}
        label="Newly liquidatable"
        value={r === null ? "—" : signedCount(r.newly)}
        sub={sub(
          `accounts · was ${groupInt(r?.beforeEligible ?? 0)}, now ${groupInt(r?.afterEligible ?? 0)}`,
        )}
        tone={r === null ? "refused" : newlyTone(r.newly, r.heat)}
        pending={pending}
      />
      <KpiTile
        testId={`${testPrefix}-debt`}
        label="Liquidatable debt"
        value={r === null ? "—" : signed(r.deltaEligibleDebt)}
        sub={sub(
          `${money(r?.eligibleDebtBefore)} → ${money(r?.eligibleDebtAfter)}`,
        )}
        tone={tone(r !== null && r.deltaEligibleDebt > 0n ? "crit" : "neutral")}
        pending={pending}
      />
      <KpiTile
        testId={`${testPrefix}-baddebt`}
        label="Bad debt at liquidation"
        value={r === null ? "—" : signed(r.deltaBadDebt)}
        sub={sub(`${money(r?.badDebtBefore)} → ${money(r?.badDebtAfter)}`)}
        tone={tone(r !== null && r.deltaBadDebt > 0n ? "warn" : "neutral")}
        pending={pending}
      />
      <KpiTile
        testId={`${testPrefix}-moved`}
        label="Accounts moved"
        value={
          r === null || r.laneChanged === null ? "—" : groupInt(r.laneChanged)
        }
        sub={sub(
          r !== null && r.laneChanged === null
            ? "not stated"
            : `of ${groupInt(r?.measured ?? 0)} measured · ${heat === null ? "movement not readable" : `${groupInt(heat.improved)} improved`}`,
        )}
        tone={tone("neutral")}
        pending={pending}
      />
    </div>
  );
}
