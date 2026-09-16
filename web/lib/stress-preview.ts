// web/lib/stress-preview.ts
import type { components } from "@solvent/client";
import { humanUsd } from "./human-usd";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal } from "./wireGuard";

type Schemas = components["schemas"];
type Waterfall = Schemas["Waterfall"];

export interface StressLine {
  readonly shock: string;
  readonly deltaDebt: bigint;
  readonly deltaAccounts: number;
  readonly badDebt: bigint;
  readonly decimals: number;
  readonly text: string;
}

export type StressPreview =
  | { kind: "absent" }
  | { kind: "refused"; reason: string }
  | { kind: "view"; scenarioId: string; lines: StressLine[] };

const AXIS_WORD: Record<string, string> = { eth_usd: "ETH", weeth_usd: "weETH", ethfi_usd: "ETHFI" };

function axisWord(axis: string): string {
  return AXIS_WORD[axis] ?? axis.split("_")[0]?.toUpperCase() ?? axis;
}

/** Signed whole percent of the shock, truncated: factor 0.9e18 over 1e18 → "−10%". */
function shockPercent(factor: bigint, scale: bigint): string {
  const pct = ((factor - scale) * 100n) / scale;
  return pct < 0n ? `−${(-pct).toString()}%` : `+${pct.toString()}%`;
}

export function stressPreview(waterfall: Waterfall, engine: string): StressPreview {
  // An engine withheld at the aggregate level is on no grid point: a refusal with its cause, never an absence.
  const withheld = waterfall.excluded_engines.find((e) => e.engine === engine);
  if (withheld !== undefined) return { kind: "refused", reason: plainCause(withheld.code, withheld.detail) };
  const points = waterfall.points
    .map((p) => ({ factor: p.factor, at: p.engines.find((e) => e.engine === engine) }))
    .filter((p): p is { factor: string; at: NonNullable<typeof p.at> } => p.at !== undefined);
  const base = points[0];
  if (base === undefined) return { kind: "absent" };
  if (!isWireDecimal(waterfall.grid_scale)) return { kind: "refused", reason: "grid_scale is not a wire decimal" };
  const scale = BigInt(waterfall.grid_scale);
  if (scale <= 0n) return { kind: "refused", reason: "grid_scale must be positive" };
  const fields = ["cumulative_debt_eligible_usd", "cumulative_bad_debt_usd"] as const;
  for (const p of points) {
    if (!isWireDecimal(p.factor)) return { kind: "refused", reason: "a grid factor is not a wire decimal" };
    for (const f of fields) {
      if (!isWireDecimal(p.at[f])) return { kind: "refused", reason: `${f} is not a wire decimal` };
    }
  }
  if (BigInt(base.factor) !== scale) return { kind: "refused", reason: "the grid's first point is not the unshocked mark" };
  // The wire's own monotonicity report for this engine wins; a dip the wire did not flag is still caught below.
  const nonMonotone = "eligible debt falls between grid points";
  const report = waterfall.monotonicity;
  if (!report.ok && (report.engine === undefined || report.engine === engine)) {
    const detail = (report.detail ?? "").trim();
    return { kind: "refused", reason: detail.length > 0 ? detail : nonMonotone };
  }
  const decimals = base.at.usd_decimals;
  const baseDebt = BigInt(base.at.cumulative_debt_eligible_usd);
  const baseAccounts = base.at.cumulative_eligible_accounts;
  let previousDebt = baseDebt;
  for (const p of points.slice(1)) {
    const debt = BigInt(p.at.cumulative_debt_eligible_usd);
    if (debt < previousDebt) return { kind: "refused", reason: nonMonotone };
    previousDebt = debt;
  }
  const word = axisWord(waterfall.axis);
  const lines: StressLine[] = points.slice(1).map((p) => {
    const deltaDebt = BigInt(p.at.cumulative_debt_eligible_usd) - baseDebt;
    const deltaAccounts = p.at.cumulative_eligible_accounts - baseAccounts;
    const badDebt = BigInt(p.at.cumulative_bad_debt_usd);
    const shock = `${word} ${shockPercent(BigInt(p.factor), scale)}`;
    const head =
      deltaDebt > 0n
        ? `+${humanUsd(deltaDebt, decimals)} liquidatable · ${String(deltaAccounts)} account${deltaAccounts === 1 ? "" : "s"}`
        : "no new liquidatable debt";
    return { shock, deltaDebt, deltaAccounts, badDebt, decimals, text: `${shock} → ${head} · bad debt ${humanUsd(badDebt, decimals)}` };
  });
  return { kind: "view", scenarioId: waterfall.scenario_id, lines };
}
