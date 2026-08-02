// The liquidation-distance vocabulary (Wave R1, adjudicated clarity ruling
// item 1 + item 2), in ONE place so the Book table, the risk map and the
// Inspector card can never fork it.
//
// THE DEFECT THIS FIXES: the column rendered the word `never` for the wire's
// `liq_distance.kind === "never"`. "Never" reads as "never liquidatable" —
// an unconditional safety claim. The wire says something far narrower: no
// move along THIS SOLVE'S PRICE AXIS reaches the boundary. Interest accrual
// and parameter changes are not on that axis and are not ruled out. The same
// wire can carry `liquidatable: true` AND `never_liquidatable: true` at once
// (the flag is axis-scoped, the verdict is not), so the label had to stop
// making a claim the number does not support.
//
// The replacement label is `no price path`, and every rendering of it carries
// the wire's OWN reason in its hover — the reason string verbatim, inside a
// sentence that names what the reason does and does not exclude.
//
// Relative imports (not the @/ alias): this module is exercised by the unit
// specs under Playwright's transpiler as well as by Next.

/** The cell/badge label that replaced `never`. Axis-scoped, never absolute. */
export const NO_PRICE_PATH_LABEL = "no price path";

/**
 * The wire reasons `internal/risk/liqprice.go` publishes for a `never`
 * solve, verbatim. Matching is EXACT: an unrecognized reason is never
 * coerced into one of these sentences — it falls to the generic statement
 * with its own words appended.
 */
export const LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL =
  "position holds no counted collateral in the factor";
export const LIQ_NEVER_REASON_NO_DEBT = "position carries no debt";
export const LIQ_NEVER_REASON_OUTSIDE_COVERS =
  "collateral outside the factor already covers the debt at threshold";

/** (d) — the wire published no reason at all. */
export const NO_PRICE_PATH_TITLE_NO_REASON =
  "No downward price move can liquidate this account under this solve. Other paths " +
  "(interest, parameters) are not ruled out.";

/**
 * The hover sentence for one `never` solve, branched on the wire's reason.
 *
 * The four adjudicated arms:
 *   (a) no counted collateral in the factor
 *   (b) collateral outside the factor already covers the debt at threshold
 *   (c) no debt
 *   (d) no reason published
 *
 * A reason OUTSIDE the published set is a fifth case the ruling does not
 * name. It renders arm (d)'s statement with the wire's own words appended
 * rather than dropped — a strict superset, never a silent swallow.
 */
export function noPricePathTitle(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === "") {
    return NO_PRICE_PATH_TITLE_NO_REASON;
  }
  if (reason === LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL) {
    return (
      "No price move alone can liquidate this account: its counted collateral is not on any " +
      "committed price axis (stable collateral holds its value in this solve). Debt growth — " +
      "interest — or a parameter change can still cross the boundary. " +
      `Wire: '${LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL}'.`
    );
  }
  if (reason === LIQ_NEVER_REASON_OUTSIDE_COVERS) {
    return (
      "Collateral outside the shocked asset already covers the debt at the liquidation " +
      "threshold — no fall of the shocked asset alone reaches the boundary; interest or " +
      `parameter changes still can. Wire: '${reason}'.`
    );
  }
  if (reason === LIQ_NEVER_REASON_NO_DEBT) {
    return (
      "No debt to liquidate: with zero borrowings there is no boundary to cross. If the " +
      `account borrows, a distance will appear. Wire: '${reason}'.`
    );
  }
  return `${NO_PRICE_PATH_TITLE_NO_REASON} Wire: '${reason}'.`;
}

/**
 * The RENDERED table-level legend (not hover-only): one line in the positions
 * section head, so the label is explained without a mouse.
 *
 * WAVE R3 (Codex round-10 MEDIUM). The previous sentence read "no committed
 * price axis moves this account's collateral". That is a claim about MOVEMENT,
 * and it is FALSE for arm (b): when collateral outside the factor already
 * covers the debt, the shocked collateral moves perfectly well — the fall is
 * simply absorbed before it reaches the boundary. The hover for that arm has
 * always said so ("no fall of the shocked asset ALONE reaches the boundary"),
 * so the legend was contradicting the tooltip it sits above.
 *
 * The replacement is a claim about REACHABILITY — what a downward move along
 * the axis can REACH — which is exactly what the solver computed and is true
 * of all four arms at once: no counted collateral on the axis (a), the fall is
 * covered (b), there is no boundary to reach (c), and the unnamed case (d).
 *
 * WAVE R4 (Codex round-11 MEDIUM). The reachability clause was right; the
 * clause after the dash was not. "interest or a parameter change can still
 * cross" ASSERTS a live non-price path, and for arm (c) — `position carries no
 * debt` — that is FALSE: with zero borrowings there is no liquidation boundary
 * at all, so interest crosses nothing and a parameter change crosses nothing.
 * The row's own hover said exactly that ("with zero borrowings there is no
 * boundary to cross") one line below a legend promising the opposite.
 *
 * ONE legend sits over rows of every arm at once, so it may not assert any
 * single arm's reason. It now states only the SCOPE of what was evaluated —
 * price paths were, non-price paths were not — and hands the reason to the
 * cell that actually has one. That is true over all four arms without
 * claiming anything about any of them, and it points the reader at the hover
 * rather than pre-empting it. The HF column stays the verdict.
 */
export const NO_PRICE_PATH_LEGEND =
  "no price path = no downward move along the committed price axis reaches liquidation for " +
  "this account — non-price paths are not evaluated here; each cell's hover names its " +
  "reason. The HF column stays the verdict.";

/** The Liq. distance column header's own title attribute. */
export const LIQ_DISTANCE_HEADER_TITLE =
  "how far the named asset's price must fall to cross this engine's boundary — price axis only.";
