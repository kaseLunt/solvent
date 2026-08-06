// Dust arithmetic for the Book (solvent-design SUPPLEMENT §17 + the MAIN
// ruling's table part C, W-UX-C).
//
// One module for everything "dust" so the chart suffix, the table filter,
// and the disclosure copy can never disagree about what dust means:
//
//   - the chart law (W-UX-D): `sumProvablyDust` — Σ < $10 proves every
//     member of a summed set is dust; the ONLY thing dust may do to a chart
//     is append a suffix.
//   - the table law (W-UX-C): the contract 1.3.0 `min_value` exclusion —
//     a row hides iff status=computed AND both totals are non-null AND
//     max(collateral, debt) < step × 10^value_decimals. REFUSED rows and
//     NULL-valued rows are NEVER hidden: an unknowable is not a small
//     number. `hiddenByDustStep` mirrors that law client-side and the unit
//     specs pin it against the contract's own sentence.
//   - the disclosure copy (the OWED item, now landed): every footer/empty
//     string the table renders about dust is a constant here, pinned
//     verbatim by tests/unit/book-table.spec.ts.
//
// All arithmetic is parseDecimal-style bigint: no float ever holds a sum.

import { parseDecimal } from "@solvent/client";

/** The dust-filter steps (USD units at each engine's own decimals). */
export const DUST_STEPS = ["off", "1", "100", "1k"] as const;
export type DustStep = (typeof DUST_STEPS)[number];

/** A step that names a threshold — everything but "off". */
export type ActiveDustStep = Exclude<DustStep, "off">;

/** The table's default step (ruling part C, point 1): dust <$1 ON by default. */
export const DUST_DEFAULT_STEP: DustStep = "1";

/**
 * Chip labels: the filter hides rows BELOW the value, so the chip says so —
 * WITH the unit the step is denominated in (W-FIX-WEB, closing the W-VR
 * defect-7 register across the whole surface). Each active chip is composed
 * from `dustStepUsdLabel`, the ONE formatter that owns the unit, so the chip
 * row and the risk map's source-filter sentence can never disagree about
 * what a step is a step of.
 */
export const DUST_CHIP_LABELS: Record<DustStep, string> = {
  off: "off",
  "1": `<${dustStepUsdLabel("1")}`,
  "100": `<${dustStepUsdLabel("100")}`,
  "1k": `<${dustStepUsdLabel("1k")}`,
};

/**
 * The step's USD display ("$1", "$100", "$1k") — the amount WITH the unit it
 * is denominated in (W-VR defect 7). The risk map's source-filter sentence
 * said "below 1", and a threshold with no unit reads as a count or a ratio;
 * the step is dollars, so its prose says dollars. Formatted HERE so no caller
 * ever retypes the unit.
 */
export function dustStepUsdLabel(step: ActiveDustStep): string {
  return `$${step}`;
}

/**
 * A step's integer threshold at `decimals` — exact bigint, `step × 10^decimals`.
 * "off" is null: the ABSENCE of a threshold, which is a different statement
 * from a threshold of zero.
 */
export function dustThresholdInteger(step: DustStep, decimals: number): bigint | null {
  if (step === "off") return null;
  const units = step === "1" ? 1n : step === "100" ? 100n : 1000n;
  return units * 10n ** BigInt(decimals);
}

/**
 * The contract's EXCLUSION LAW, mirrored (openapi.yaml `min_value`): a row is
 * excluded iff `status = computed` AND both totals are non-null AND
 * max(total_collateral, total_debt) < threshold. Strict `<` — a row exactly
 * AT the step stays visible. Refused rows and null-valued rows are never
 * hidden. The filter itself runs SERVER-side (`min_value`); this mirror
 * exists so the law is pinned in this repo's own tests and available to any
 * client-side cross-check.
 */
export function hiddenByDustStep(
  status: "computed" | "refused",
  collateral: string | null,
  debt: string | null,
  threshold: bigint | null,
): boolean {
  if (threshold === null) return false;
  if (status !== "computed") return false; // refused never dust
  if (collateral === null || debt === null) return false; // NULL never dust
  const collateralInt = parseDecimal(collateral);
  const debtInt = parseDecimal(debt);
  const max = collateralInt > debtInt ? collateralInt : debtInt;
  return max < threshold;
}

/**
 * The disclosure's Σ-debt BOUND: threshold × hidden, exact bigint — honest
 * because every hidden row's max(collateral, debt) is strictly below the
 * step, so its debt is too.
 */
export function dustBoundInteger(step: ActiveDustStep, decimals: number, hidden: number): bigint {
  const threshold = dustThresholdInteger(step, decimals);
  return (threshold ?? 0n) * BigInt(hidden);
}

/** The URL `dust` param normalizer (extends W-UX-B's deep-link normalizer). */
export function normalizeDustParam(raw: string | null): { dust: DustStep; rewritten: boolean } {
  if (raw === null) return { dust: DUST_DEFAULT_STEP, rewritten: false };
  if ((DUST_STEPS as readonly string[]).includes(raw)) {
    return { dust: raw as DustStep, rewritten: false };
  }
  return { dust: DUST_DEFAULT_STEP, rewritten: true };
}

// ---------------------------------------------------------------------------
// The ruling's disclosure copy — constants, pinned verbatim by the unit spec.
// ---------------------------------------------------------------------------

/** The dust chip group's title attribute (ruling part C, point 14). */
export const DUST_GROUP_TITLE =
  "hide rows where max(collateral, debt) is below the step, in the engine's own value " +
  "unit. Hidden rows stay counted here and in every aggregate above; refused and " +
  "null-valued rows are never hidden";

/** The standalone refused-first chip's title (ruling part C, point 8). */
export const REFUSED_FIRST_CHIP_TITLE =
  "sort=status: refused rows ranked first for triage, then risk order";

/** The footer constant line, amended (ruling part C, point 5). */
export const FOOTER_REFUSED_NEVER_DUST =
  "refused rows stay visible and counted; the dust step never hides them";

/**
 * Footer accounting, dust active: "{loaded} loaded of {total_positions}
 * qualifying (dust {step}) · {hidden} hidden below step · {aggregate.positions}
 * on book · sort {sort} {▲|▼}". The hidden slot arrives PRE-BUILT
 * (`hiddenBelowStepSegment` / `hiddenCountMismatch`) or EMPTY — a degraded
 * hidden count renders NOTHING, never a zero.
 */
export function footerAccountingDust(
  loaded: number,
  qualifying: string,
  step: ActiveDustStep,
  hiddenSegment: string,
  onBook: string,
  sortSuffix: string,
): string {
  const hidden = hiddenSegment === "" ? "" : `${hiddenSegment} · `;
  return (
    `${String(loaded)} loaded of ${qualifying} qualifying (dust ${DUST_CHIP_LABELS[step]}) · ` +
    `${hidden}${onBook} on book · sort ${sortSuffix}`
  );
}

/** Footer accounting, dust off: "{loaded} of {total} rows · {n} on book · sort {sort} {▲|▼}". */
export function footerAccountingOff(
  loaded: number,
  total: string,
  onBook: string,
  sortSuffix: string,
): string {
  return `${String(loaded)} of ${total} rows · ${onBook} on book · sort ${sortSuffix}`;
}

/** The healthy hidden slot: "{hidden} hidden below step". */
export function hiddenBelowStepSegment(hidden: number): string {
  return `${String(hidden)} hidden below step`;
}

/**
 * The batch-guard slot: the hidden count exists ONLY when /v1/book's batch id
 * === the page envelope's batch id — counts from two batches are never
 * blended into one subtraction.
 */
export function hiddenCountMismatch(aggregateBatchId: number, pagesBatchId: number): string {
  return (
    `hidden count — (aggregate from batch #${String(aggregateBatchId)}, pages from batch ` +
    `#${String(pagesBatchId)}: counts from two batches are never blended)`
  );
}

/**
 * The dust disclosure span (hidden > 0), bound form. The trailing separator
 * is part of the string — the "show" chipButton is appended by the caller.
 *
 * W-FIX-WEB: the threshold renders through `dustStepUsdLabel` ("below $1",
 * never a bare "below 1" that reads as a count) — the function takes the STEP
 * and composes the unit itself, so no caller can retype it.
 */
export function dustDisclosureBound(
  hidden: number,
  step: ActiveDustStep,
  boundDisplay: string,
): string {
  return (
    `hidden: ${String(hidden)} rows below ${dustStepUsdLabel(step)} · Σ debt ≤ ${boundDisplay} ` +
    `(bound: every hidden row is below the step) · `
  );
}

/**
 * The SHOULD upgrade at walk exhaustion: the bound is replaced by the exact
 * Σ — bookΣ − loadedΣ, same batch, bigint. Same threshold register as the
 * bound form: the step renders WITH its unit, from the one formatter.
 */
export function dustDisclosureExact(
  hidden: number,
  step: ActiveDustStep,
  exactDisplay: string,
): string {
  return `hidden: ${String(hidden)} rows below ${dustStepUsdLabel(step)} · Σ debt ${exactDisplay} exact · `;
}

/**
 * The liquidatable line's tail. The caller renders "{aggLiq}" in crit tone
 * IMMEDIATELY before this string.
 */
export function liquidatableDisclosureTail(loadedLiquidatable: number): string {
  return (
    ` liquidatable on this book · ${String(loadedLiquidatable)} among loaded rows; the ` +
    `rest are below the dust step or on unloaded pages`
  );
}

/** The empty FILTERED walk: hidden rows are hidden, not absent. */
export function emptyFilteredWalk(
  step: ActiveDustStep,
  hidden: number,
  boundDisplay: string,
): string {
  return (
    `no rows at or above the dust step (${dustStepUsdLabel(step)}) · ${String(hidden)} rows ` +
    `below it are hidden by the filter and still counted · Σ debt ≤ ${boundDisplay} · ` +
    `set dust off to see them`
  );
}

/**
 * THE SOURCE-FILTER SEMANTICS, STATED (chart spec v4, STATE slot).
 *
 * The old line said "dust below 1 is excluded at the source, so this map shows
 * the filtered walk only". True, and it left the reader to guess WHICH rows
 * that removes — and the natural guess is wrong. The contract's exclusion is a
 * conjunction: a row hides only when BOTH its collateral and its debt sit
 * below the step. So a position with sub-dollar debt and $40,000 of collateral
 * is still on this map, which is exactly the population the compressed sub-$1
 * lane is drawing. A reader who thinks the lane is a leftover of an incomplete
 * filter will discount the one part of the axis this wave built.
 */
export function dustMapLegend(step: ActiveDustStep): string {
  // W-VR defect 7: the threshold renders WITH its unit ("$1", never a bare
  // "1"), from this module's own formatter — never retyped at a call site.
  const amount = dustStepUsdLabel(step);
  return (
    `Source filter: a position is excluded only when both its collateral and its debt are ` +
    `below ${amount}. A position with sub-dollar debt stays on this map when its collateral ` +
    `is at or above ${amount}.`
  );
}

/**
 * Σ < $10 proves every member of the summed set is dust: if the SUM of the
 * members is under ten dollars, no single member can reach ten dollars.
 * The comparison is strict (`<`) and exact: parsed sum < 10 × 10^decimals.
 *
 * NOTE the arithmetic stays literal — a zero sum is (vacuously) provably
 * dust. The zero-MEMBER gate is the CALL SITES' duty (W-UX-C micro-ruling 1):
 * "· all dust" renders only when the annotated member count > 0, and that
 * guard lives beside each Σ, never in here.
 */
export function sumProvablyDust(sum: string, decimals: number): boolean {
  return parseDecimal(sum) < 10n * 10n ** BigInt(decimals);
}

/** The suffix a provably-dust Σ appends — the ONLY thing dust may do to a chart. */
export const ALL_DUST_SUFFIX = " · all dust";
