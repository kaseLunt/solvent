package main

// `shock_reach` — what a scenario's declared shock ACTUALLY did to this batch's
// own marks, and, when it did nothing, WHICH of the causes held it.
//
// # Why a zero needs a cause, and why the cause has to be on the wire
//
// Three committed scenarios produce all-zero deltas for three DIFFERENT
// reasons, and a summary that carried only the deltas would render all three
// as the same three zero-length bars:
//
//	stable_depeg_0995_in_band  the oracle SWALLOWED the move: 995/1000 lands
//	                           strictly inside PriceProviderV2's open snap band
//	                           (990000, 1010000), so every shocked stable comes
//	                           back at exactly 1e6. The finding is about the
//	                           ORACLE, not about the book's sensitivity.
//	dm_composition_census      the DEFINITION asked for no move: all eight of
//	                           its shocks are the explicit identity factor 1/1,
//	                           the disclosed decision to hold each mark. Nothing
//	                           swallowed anything.
//	dm_rate_horizon_plus_200bps  no ApplyScenario pass ran at all — the after
//	                           side IS the before side, and the information is
//	                           in `projection`.
//
// Publishing the oracle as the cause of the second is a wrong number in the
// same sense as a movement count under the wrong label, and it is worse than
// silence: a false cause carries authority a bare zero does not.
//
// # The two censuses, and only one of them attributes a cause
//
// `marks_moved` plus the three `marks_held_by_*` counts PARTITION
// `applied_shocks` exactly. `marks_snapped`, `marks_base_snapped` and
// `marks_cap_bound` are a FLAG CENSUS: they may overlap each other, they are
// nonzero on rows that moved (a snap pins a shocked value into the band, and a
// mark persisted off par therefore MOVES while carrying `snapped: true`), and
// they are nonzero on rows held at the identity factor. They never attribute a
// cause and they are never summed.

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/kaselunt/solvent/internal/risk"
)

// The seven arms. Arms 1 to 3 are DEFINITION-level (true of the scenario at
// every batch) and arms 4 to 7 are BOOK-level; the definition-level arms are
// derived first because their facts do not depend on the book, so a reader told
// "this scenario asks for no move" needs to know nothing about the batch to know
// why the bars are zero.
const (
	reachProjectionNoSpotPass        = "projection_no_spot_pass"
	reachNoShocksDeclared            = "no_shocks_declared"
	reachAllShocksDeclaredAtIdentity = "all_shocks_declared_at_identity"
	reachNoShockReachedTheBook       = "no_shock_reached_the_book"
	reachNoMarkMoved                 = "no_mark_moved"
	reachSomeMarksHeld               = "some_marks_held"
	reachEveryMarkMoved              = "every_mark_moved"
)

// setRunReachArms is the closed vocabulary, in DERIVATION order. It is a
// variable rather than prose so a test can assert the served arm is one of
// exactly these and that each carries its own sentence.
var setRunReachArms = []string{
	reachProjectionNoSpotPass,
	reachNoShocksDeclared,
	reachAllShocksDeclaredAtIdentity,
	reachNoShockReachedTheBook,
	reachNoMarkMoved,
	reachSomeMarksHeld,
	reachEveryMarkMoved,
}

// setRunReachFacts is everything the derivation is allowed to look at. It is a
// struct so the switch below is a pure function of stated facts and can be
// exhaustively table-tested with no database, no book and no handler.
type setRunReachFacts struct {
	// HasProjection is `definition.projection != nil`. It is arm 1's whole
	// condition because p5_runbook.go gates the entire ApplyScenario pass on it.
	HasProjection bool
	// DeclaredShocks is len(definition.shocks): what was ASKED FOR.
	DeclaredShocks int
	// DeclaredShocksAtIdentity is how many of those carry factor_num ==
	// factor_den — the definition's own disclosed decision to hold.
	DeclaredShocksAtIdentity int
	// AppliedRows is len(applied_shocks) over THIS scenario's own book.
	AppliedRows int
	// MarksMoved is the applied rows whose `before` and `after` decimal strings
	// DIFFER. It is the load-bearing count: it answers "did a price change" from
	// the body alone.
	MarksMoved int
}

// setRunShockReachArm derives the arm.
//
// THE ORDER IS THE SPECIFICATION AND THERE IS NO DEFAULT ARM. Every case is a
// condition somebody wrote down; nothing is absorbed by an `otherwise`. The
// ordering is load-bearing rather than decorative: dm_rate_horizon_plus_200bps
// declares ONE shock at the identity factor 1/1, so arm 3 would claim it if arm
// 1 did not come first, and dm_composition_census would fall into arm 5
// (`no_mark_moved`, "a pricing transform swallowed the move") if arm 3 did not
// come before the book-level arms.
//
// The trailing return is a REFUSAL, not an arm: arms 5, 6 and 7 exhaust
// `MarksMoved` against `AppliedRows` under the precondition
// `0 <= MarksMoved <= AppliedRows`, which the caller establishes by
// construction. Reaching it means the two counts contradict each other, and a
// response is not served over counts that do.
func setRunShockReachArm(f setRunReachFacts) (string, error) {
	switch {
	case f.HasProjection:
		return reachProjectionNoSpotPass, nil
	case f.DeclaredShocks == 0:
		return reachNoShocksDeclared, nil
	case f.DeclaredShocks > 0 && f.DeclaredShocksAtIdentity == f.DeclaredShocks:
		return reachAllShocksDeclaredAtIdentity, nil
	case f.AppliedRows == 0:
		return reachNoShockReachedTheBook, nil
	case f.AppliedRows > 0 && f.MarksMoved == 0:
		return reachNoMarkMoved, nil
	case f.MarksMoved > 0 && f.MarksMoved < f.AppliedRows:
		return reachSomeMarksHeld, nil
	case f.MarksMoved == f.AppliedRows:
		return reachEveryMarkMoved, nil
	}
	return "", fmt.Errorf("shock reach: %d marks moved against %d applied rows on a scenario declaring "+
		"%d shocks (%d at the identity factor); those counts contradict each other, and no arm of this "+
		"derivation describes a book where more marks moved than were applied",
		f.MarksMoved, f.AppliedRows, f.DeclaredShocks, f.DeclaredShocksAtIdentity)
}

// setRunHeldCause is the CAUSE attribution for one held applied row. The three
// causes partition the held rows exactly, and the ORDER IS SPECIFIED rather
// than left to the implementer.
//
// The identity factor wins over the transform flags, deliberately and against
// the obvious reading. `case r.StableSnap:` computes
// `ApplyDMStableSnap(MulDivFloor(before, 1, 1))` (internal/risk/scenario.go), so
// a par-marked stable under a 1/1 factor comes back `snapped: true` and unmoved.
// Attributing THAT hold to the snap would say the oracle swallowed a move nobody
// asked for.
const (
	heldByDeclaredFactor = "declared_factor"
	heldByTransform      = "transform"
	heldByArithmetic     = "arithmetic"
)

func setRunHeldCause(w wireAppliedShock) string {
	switch {
	case w.FactorNum == w.FactorDen:
		return heldByDeclaredFactor
	case w.Snapped || w.BaseSnapped || w.CapBound:
		return heldByTransform
	default:
		return heldByArithmetic
	}
}

// setRunShockReachNote composes the arm's own sentence.
//
// Each arm gets a DIFFERENT one, and no arm's sentence is served under another
// arm — asserted, because the whole defect this component exists for is a true
// zero published under a false cause.
func setRunShockReachNote(arm string, sc risk.Scenario, r wireSetRunShockReach) string {
	held := heldSplitClause(r)
	switch arm {
	case reachProjectionNoSpotPass:
		return "PROJECTION, NO SPOT PASS: this scenario declares a projection, so no `ApplyScenario` pass ran at all and the " +
			"after side IS the before side. Its declared shocks were NOT applied to any mark and `applied_shocks` is empty by " +
			"construction. The information this scenario carries is in `projection`, never in the three deltas, which are zero " +
			"because nothing was shocked."
	case reachNoShocksDeclared:
		return "NO SHOCK WAS ASKED FOR: this scenario declares no price shock at all, so the three deltas are zero by construction " +
			"and say nothing about the book's sensitivity. Its information lives in `market_realization`. `applied_shocks` is not " +
			"structurally empty in this arm — a zero-shock scenario with a non-empty propagation matrix would serve rows at the " +
			"identity factor — so read the array rather than assuming it."
	case reachAllShocksDeclaredAtIdentity:
		return "DECLARED HOLD: all " + strconv.Itoa(r.DeclaredShocks) + " of this scenario's shocks are the explicit identity factor 1/1. " +
			"It asks for no price move, BY DECISION rather than by accident, and the three deltas are zero BY CONSTRUCTION. " +
			"The cause is the DEFINITION: nothing about the oracle, the pricing transforms or the book's sensitivity may be inferred " +
			"from these zeros. `applied_shocks` is normally NON-EMPTY here (" + strconv.Itoa(r.AppliedRows()) + " row(s) on this book), " +
			"because a matched price is recorded whatever the factor. The definition's own disclosure is its `path_assumption`, served " +
			"beside this: " + sanitize(sc.PathAssumption)
	case reachNoShockReachedTheBook:
		return "NO SHOCK REACHED THE BOOK: no price input in this scenario's book is described by this scenario's PROPAGATION MATRIX, " +
			"which is what the code tests — every price is looked up by (chain_id, asset) in the matrix and every miss is routed to " +
			"held-flat. This is NOT \"the book holds none of the assets the shock names\": a shock need not name an asset at all, and a " +
			"shocked asset is not required to have a matrix row of its own. " + strconv.Itoa(r.HeldFlatMarks) +
			" mark(s) were held flat instead; their (chain_id, asset) identities are in `held_flat_assets`, and the exact values and " +
			"sources are on POST /v1/scenarios/{id}/run-book."
	case reachNoMarkMoved:
		return "NO MARK MOVED: every mark this scenario's propagation matrix describes came back at the value it started at, and at " +
			"least one declared shock was NOT the identity factor. " + noMarkMovedCauseClause(r) + " " + held +
			" The `before_*` figures beside this are a true measurement of a real book and nothing was suppressed to hide the zero."
	case reachSomeMarksHeld:
		return "PARTLY REACHED: " + strconv.Itoa(r.MarksMoved) + " of " + strconv.Itoa(r.AppliedRows()) +
			" marks this scenario's matrix describes moved. A bar drawn from this result is a bar over a PARTLY APPLIED shock and it is " +
			"never unqualified. " + held
	case reachEveryMarkMoved:
		return "EVERY MARK MOVED: the shock reached every mark this scenario's propagation matrix describes (" +
			strconv.Itoa(r.AppliedRows()) + " of " + strconv.Itoa(r.AppliedRows()) + "). An all-zero delta under THIS arm is a real " +
			"finding about the book: the prices moved and the engines' arithmetic did not change these figures."
	}
	// Unreachable while `arm` comes from setRunShockReachArm, which returns only
	// the seven above. A note is never invented for an arm nobody named.
	return ""
}

// noMarkMovedCauseClause states arm 5's cause from THE COUNTS THAT ARM SERVES,
// and never from a fixed sentence.
//
// The arm's condition is `AppliedRows > 0 && MarksMoved == 0`, which says
// nothing about WHY. The cause partition underneath it admits three terms, and
// `setRunHeldCause` classifies a mark that came back unchanged from
// `MulDivFloor` with no snap and no cap as `arithmetic` — a hold the pricing
// transforms had no part in. A sentence that always blamed the transforms was
// therefore false on every book whose holds are arithmetic, which is the same
// defect this whole component exists for (a true zero under a false cause),
// only one arm further down.
//
// So the clause is composed: transform-only, arithmetic-only, both, or neither.
// The fourth is reachable and is not a contradiction — a scenario declaring one
// sized shock and one identity shock, over a book that prices only the marks the
// identity shock describes, lands here with every hold at its declared factor.
func noMarkMovedCauseClause(r wireSetRunShockReach) string {
	transform, arithmetic := r.MarksHeldByTransform, r.MarksHeldByArithmetic
	transformTerm := strconv.Itoa(transform) + " mark(s) were pinned by a PRICING TRANSFORM (the Debt Manager's stable " +
		"snap band, a snapped stable BASE, or a bound price cap, each of them a property of the oracle path rather than " +
		"of any position)"
	arithmeticTerm := strconv.Itoa(arithmetic) + " came back unchanged from EXACT-INTEGER ARITHMETIC (the floor of " +
		"before x factor_num / factor_den landed on the integer it started from, and no pricing transform touched them)"
	switch {
	case transform > 0 && arithmetic == 0:
		return "This zero is the PRICING TRANSFORMS' doing, not the book's: all " + strconv.Itoa(transform) +
			" held mark(s) were pinned by the Debt Manager's stable snap band, by a snapped stable BASE, or by a bound " +
			"price cap, each of them a property of the oracle path rather than of any position."
	case transform == 0 && arithmetic > 0:
		return "This zero is EXACT-INTEGER ARITHMETIC's doing, not the oracle's and not the book's: all " +
			strconv.Itoa(arithmetic) + " held mark(s) came back at the value they started at because the floor of " +
			"before x factor_num / factor_den landed on the integer it started from. No pricing transform pinned any of " +
			"them, so this sentence claims nothing about a snap or a cap."
	case transform > 0 && arithmetic > 0:
		return "This zero has TWO causes on this book and neither of them is the book's sensitivity: " + transformTerm +
			", and " + arithmeticTerm + "."
	}
	return "This zero is the DEFINITION's doing on the marks that were applied: no held mark was pinned by a pricing " +
		"transform and none came back unchanged from arithmetic, so each was held at an identity factor this scenario " +
		"declared for it while the scenario also declares a sized shock the book's marks did not answer to."
}

// heldSplitClause prints ONLY the nonzero cause terms, so a reader is never
// shown "0 held by a transform" beside a real one. It prints the three
// `marks_held_by_*` counts and NEVER the flag census: a cell that printed
// "K of K snapped" would print "3 of 4" on the four-row control (three
// `snapped`, one `base_snapped`) and "0 of 9" on the identity census, and both
// are false sentences under a true header.
func heldSplitClause(r wireSetRunShockReach) string {
	var parts []string
	if r.MarksHeldByTransform > 0 {
		parts = append(parts, strconv.Itoa(r.MarksHeldByTransform)+" pinned by a pricing transform (a stable snap, a snapped base or a bound cap)")
	}
	if r.MarksHeldByDeclaredFactor > 0 {
		parts = append(parts, strconv.Itoa(r.MarksHeldByDeclaredFactor)+" held at the identity factor this scenario declared for them")
	}
	if r.MarksHeldByArithmetic > 0 {
		parts = append(parts, strconv.Itoa(r.MarksHeldByArithmetic)+" returned unchanged by exact-integer arithmetic")
	}
	if len(parts) == 0 {
		return "No mark was held."
	}
	return "Of the held marks: " + strings.Join(parts, ", ") + "."
}

// setRunHeldFlatAssets reduces the held-flat rows to their DISTINCT
// (chain_id, asset) identities, sorted by that pair.
//
// # The pair, and not a bare address
//
// The propagation lookup that decided held-flat-versus-applied is keyed
// `responses[responseKey(p.ChainID, p.Asset)]`, and `responseKey` is literally
// "%d|%s" over the chain id and the lowercased address. An address-only list
// would COLLAPSE TWO GENUINELY DIFFERENT MARKS into one entry whenever the same
// address appears on two chains — not exotic on a book spanning Ethereum and
// OP — and the response would then serve `held_flat_marks: 2` beside a
// one-element list, a contradiction the body cannot resolve. Worse, it would be
// a named absence that names the wrong thing, on a surface whose whole job is to
// say which marks the model did not claim.
//
// Sorting is by chain id ASCENDING first and the LOWERCASED address second.
// Sorting by address alone would leave two chains' entries for one address in
// whatever order the map walk chose, which is exactly the byte-nondeterminism
// the determinism law forbids.
func setRunHeldFlatAssets(rows map[string]wireHeldFlat) []wireSetRunHeldFlatAsset {
	seen := map[string]bool{}
	out := []wireSetRunHeldFlatAsset{}
	for _, k := range sortedKeys(rows) {
		h := rows[k]
		id := strconv.FormatUint(h.ChainID, 10) + "|" + strings.ToLower(h.Asset)
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, wireSetRunHeldFlatAsset{ChainID: h.ChainID, Asset: h.Asset})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ChainID != out[j].ChainID {
			return out[i].ChainID < out[j].ChainID
		}
		return strings.ToLower(out[i].Asset) < strings.ToLower(out[j].Asset)
	})
	return out
}
