// web/lib/stress-preview.ts
import type { components } from "@solvent/client";
import { humanUsd } from "./human-usd";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
type Waterfall = Schemas["Waterfall"];
type Coverage = Schemas["BookCoverage"];

export interface StressLine {
  readonly shock: string;
  readonly deltaDebt: bigint;
  readonly deltaAccounts: number;
  readonly badDebt: bigint;
  readonly decimals: number;
  readonly text: string;
}

/** Positions the stress arithmetic never measured: the preview's lines do not speak for them. */
export interface StressUnmeasured {
  /** Excluded positions on this engine. */
  readonly count: number;
  /** Excluded positions on the whole book, the wire's own count. */
  readonly bookWide: number;
  /** The plain causes, deduplicated, in wire order. */
  readonly causes: string[];
}

export type StressPreview =
  | { kind: "absent" }
  | { kind: "refused"; reason: string }
  | { kind: "view"; scenarioId: string; lines: StressLine[]; unmeasured: StressUnmeasured | null };

const AXIS_WORD: Record<string, string> = { eth_usd: "ETH", weeth_usd: "weETH", ethfi_usd: "ETHFI" };

function axisWord(axis: string): string {
  return AXIS_WORD[axis] ?? axis.split("_")[0]?.toUpperCase() ?? axis;
}

/** Signed whole percent of the shock, truncated: factor 0.9e18 over 1e18 → "−10%". */
function shockPercent(factor: bigint, scale: bigint): string {
  const pct = ((factor - scale) * 100n) / scale;
  return pct < 0n ? `−${(-pct).toString()}%` : `+${pct.toString()}%`;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** The sentence the card prints for unmeasured positions; null when nothing is unmeasured. */
export function unmeasuredSentence(u: StressUnmeasured | null): string | null {
  if (u === null) return null;
  if (u.count > 0) {
    const one = u.count === 1;
    return `${plural(u.count, "position")} on this engine ${one ? "is" : "are"} excluded from the stress arithmetic (${u.causes.join("; ")}); ${one ? "its" : "their"} movement is unmeasured and no line above speaks for ${one ? "it" : "them"}.`;
  }
  return `${plural(u.bookWide, "position")} on the book ${u.bookWide === 1 ? "is" : "are"} excluded from the stress arithmetic, none on this engine.`;
}

function unmeasuredOf(coverage: Coverage, engine: string): StressUnmeasured | { refused: string } | null {
  const bookWide = coverage.excluded_by_this_layer;
  if (!isWirePopulation(bookWide)) return { refused: "coverage.excluded_by_this_layer is not a wire population" };
  if (!Array.isArray(coverage.excluded)) return { refused: "coverage.excluded is not a list" };
  if (coverage.excluded.length > bookWide) return { refused: "coverage lists more excluded positions than it counts" };
  const own = coverage.excluded.filter((e) => e.engine === engine);
  if (bookWide === 0) return null;
  const causes: string[] = [];
  for (const e of own) {
    const cause = plainCause(e.code, e.reason);
    if (!causes.includes(cause)) causes.push(cause);
  }
  return { count: own.length, bookWide, causes };
}

export function stressPreview(waterfall: Waterfall, engine: string, coverage?: Coverage | null): StressPreview {
  // An engine withheld at the aggregate level is on no grid point: a refusal with its cause, never an absence.
  const withheld = waterfall.excluded_engines.find((e) => e.engine === engine);
  if (withheld !== undefined) return { kind: "refused", reason: plainCause(withheld.code, withheld.detail) };
  // A waterfall served with no points is a grid nobody published: a refusal by name, for every caller. It is never
  // read as "the engine is absent from the grid" — an engine is absent from points that exist — and it never
  // outranks the engine's own cause above: the more specific refusal speaks first.
  const served: unknown = waterfall.points;
  if (!Array.isArray(served)) return { kind: "refused", reason: "waterfall.points is not a list" };
  if (served.length === 0) return { kind: "refused", reason: "no points published" };
  const located = waterfall.points.map((p, index) => ({ index, factor: p.factor, at: p.engines.find((e) => e.engine === engine) }));
  if (located.every((p) => p.at === undefined)) return { kind: "absent" };
  // On some points but not all: the missing coverage is named, never filtered into a shorter list.
  const missing = located.find((p) => p.at === undefined);
  if (missing !== undefined) return { kind: "refused", reason: `the engine is missing from grid point ${String(missing.index)}` };
  const points = located.filter((p): p is { index: number; factor: string; at: NonNullable<typeof p.at> } => p.at !== undefined);
  const base = points[0];
  if (base === undefined || points.length < 2) return { kind: "refused", reason: "the grid has no shocked point" };
  if (!isWireDecimal(waterfall.grid_scale)) return { kind: "refused", reason: "grid_scale is not a wire decimal" };
  const scale = BigInt(waterfall.grid_scale);
  if (scale <= 0n) return { kind: "refused", reason: "grid_scale must be positive" };
  const fields = ["cumulative_debt_eligible_usd", "cumulative_bad_debt_usd"] as const;
  const decimals = base.at.usd_decimals;
  if (!isWireScale(decimals)) return { kind: "refused", reason: "usd_decimals is not a wire scale" };
  for (const p of points) {
    if (!isWireDecimal(p.factor)) return { kind: "refused", reason: "a grid factor is not a wire decimal" };
    for (const f of fields) {
      if (!isWireDecimal(p.at[f])) return { kind: "refused", reason: `${f} is not a wire decimal` };
    }
    // Units are compatible before any subtraction: every point at the base's scale.
    if (p.at.usd_decimals !== decimals) return { kind: "refused", reason: "grid points disagree on usd_decimals" };
    if (!isWirePopulation(p.at.cumulative_eligible_accounts)) {
      return { kind: "refused", reason: "cumulative_eligible_accounts is not a wire population" };
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
  const baseDebt = BigInt(base.at.cumulative_debt_eligible_usd);
  const baseAccounts = base.at.cumulative_eligible_accounts;
  let previousDebt = baseDebt;
  let previousAccounts = baseAccounts;
  for (const p of points.slice(1)) {
    const debt = BigInt(p.at.cumulative_debt_eligible_usd);
    if (debt < previousDebt) return { kind: "refused", reason: nonMonotone };
    previousDebt = debt;
    // A cumulative population never falls: a negative account delta is a contradiction, never "-1 accounts".
    if (p.at.cumulative_eligible_accounts < previousAccounts) {
      return { kind: "refused", reason: "eligible accounts fall between grid points" };
    }
    previousAccounts = p.at.cumulative_eligible_accounts;
  }
  const unmeasured = coverage === undefined || coverage === null ? null : unmeasuredOf(coverage, engine);
  if (unmeasured !== null && "refused" in unmeasured) return { kind: "refused", reason: unmeasured.refused };
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
  return { kind: "view", scenarioId: waterfall.scenario_id, lines, unmeasured };
}
