// The COVERAGE chip's honest derivation (p1a-4, lifted pure in p1a-4b so its
// honesty arms are unit-pinnable — the review finding: every stream fixture
// ships refused_engines: [], so the partial and unbindable arms were
// reachable but unpinned inside the component).
//
// Canon §05 dimension 3 — "who answered": counts reconcile visibly, on book →
// computed → refused/unknown, no silent shrinkage. From the batch envelope:
//
//   total    = the stamp vector's length. `watermarks` carries one stamp per
//              engine the batch binds; a SERVED batch requires ≥ 1 stamp
//              (store completeness predicate), so an empty vector is refused
//              here rather than rendered as 0/0.
//   withheld = the DEDUPED `refused_engines`. The schema puts the names on
//              the batch SUMMARY precisely because `refused_count` counts
//              position ROWS and is zero for an engine withheld with no
//              accounts behind it — the summary reader must still be unable
//              to mistake a withheld engine for a healthy one.
//   answered = total − withheld.
//
// RENDERED ONLY WHEN UNAMBIGUOUS: if the wire ever names a refused engine
// that carries no stamp, the subtraction has no honest denominator — so the
// derivation returns null and the CHIP IS WITHHELD ENTIRELY rather than
// invented. (Track B envelope gap, ledgered §p1a-4: `refused_engines` is
// `string[]` with no structural binding to the stamp vector.)
//
// Pinned by tests/unit/coverage.spec.ts and the p1a-fixes appbar describe.

/** The narrow slice of the batch envelope the derivation reads. `Batch` satisfies it. */
export interface CoverageEnvelope {
  readonly watermarks: readonly { readonly engine: string }[];
  readonly refused_engines: readonly string[];
}

/** What the coverage chip renders (warn variant when answered < total). */
export interface RibbonCoverage {
  readonly answered: number;
  readonly total: number;
  /** Wire names of engines whose whole book is withheld on this batch. */
  readonly withheld: readonly string[];
}

/** The derivation — or null when no honest chip exists (see module comment). */
export function ribbonCoverage(batch: CoverageEnvelope): RibbonCoverage | null {
  const stamped = batch.watermarks.map((stamp) => stamp.engine);
  if (stamped.length === 0) return null;
  const withheld = [...new Set(batch.refused_engines)];
  if (withheld.some((engine) => !stamped.includes(engine))) return null;
  return { answered: stamped.length - withheld.length, total: stamped.length, withheld };
}
