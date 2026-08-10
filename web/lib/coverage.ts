// The COVERAGE chip's honest derivation (p1a-4, lifted pure in p1a-4b; roster
// re-derived in p1a-9 — the Codex finding: the chip divided INCOMPATIBLE
// sets).
//
// THE p1a-9 DEFECT, EXACTLY: `watermarks` is the batch's FULL pipeline input
// vector — one stamp per engine whose clock participates in supersession. On
// the production deployment that is FIVE stamps (aave_v3_etherfi, aave_param,
// debt_manager, prices:poll:1, prices:poll:10). `refused_engines` names risk
// BOOKS only (`risk_batch_aggregates` rows with a refusal code — two books on
// this deployment). Dividing one by the other rendered "COVERAGE 5/5 ENGINES"
// over a two-engine book: a count that reconciles against nothing a reader
// can see, on the surface whose whole law is "counts reconcile visibly".
//
// Canon §05 dimension 3 — "who answered": the denominator must be the set the
// refusals subtract from. That set is the batch's RISK-ENGINE AGGREGATES
// (`StreamPayload.engines` — one `Aggregate` row per risk book, INCLUDING
// withheld books: the store materializes an aggregate row for a refused
// engine with null totals, which is precisely how `refused_engines` is
// derived). So:
//
//   total    = the DEDUPED aggregate roster's size. The roster names the
//              books this batch accounts for.
//   withheld = the DEDUPED `refused_engines`. The schema puts the names on
//              the batch SUMMARY precisely because `refused_count` counts
//              position ROWS and is zero for an engine withheld with no
//              accounts behind it.
//   answered = total − withheld.
//
// RENDERED ONLY WHEN UNAMBIGUOUS, twice over:
//   · ROSTER ABSENT → NULL. `engines` is OPTIONAL on the stream envelope
//     (`engines?: Aggregate[] | null`); a frame that did not carry the
//     aggregates gives this derivation no denominator, so the CHIP IS
//     WITHHELD ENTIRELY rather than approximated from the stamp vector —
//     the stamp vector is the wrong population, which is the whole finding.
//   · UNBINDABLE REFUSAL → NULL. A refused name with no aggregate row has
//     no honest denominator either (Track B envelope gap, ledgered §p1a-4).
//
// Pinned by tests/unit/coverage.spec.ts (including the production-shaped
// five-stamp fixture whose envelope still carries the 5-stamp watermark
// vector: a derivation reverted to `watermarks` dies at that pin) and the
// p1a-fixes appbar describes.

/** The narrow slice of the batch envelope the derivation reads. `Batch` satisfies it. */
export interface CoverageEnvelope {
  readonly refused_engines: readonly string[];
}

/** The one field of an aggregate row this derivation reads. `Aggregate` satisfies it. */
export interface CoverageAggregate {
  readonly engine: string;
}

/** What the coverage chip renders (warn variant when answered < total). */
export interface RibbonCoverage {
  readonly answered: number;
  readonly total: number;
  /** Wire names of engines whose whole book is withheld on this batch. */
  readonly withheld: readonly string[];
}

/** The derivation — or null when no honest chip exists (see module comment). */
export function ribbonCoverage(
  batch: CoverageEnvelope,
  aggregates: readonly CoverageAggregate[] | null,
): RibbonCoverage | null {
  if (aggregates === null) return null;
  const roster = [...new Set(aggregates.map((aggregate) => aggregate.engine))];
  if (roster.length === 0) return null;
  const withheld = [...new Set(batch.refused_engines)];
  if (withheld.some((engine) => !roster.includes(engine))) return null;
  return { answered: roster.length - withheld.length, total: roster.length, withheld };
}
