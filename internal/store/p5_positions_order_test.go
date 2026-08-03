package store

// Wave W-HR-B — STRUCTURAL laws over `positionsOrder`, proven by sweeping the
// map itself rather than by an inventory someone remembered to extend. These
// need no database: they are statements about the ORDER BY fragments, and the
// live-db suite proves the orderings those fragments actually produce.

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// THE PER-ENGINE VOCABULARY (contract 1.5.0).
//
// `headroom`, `liq_distance`, `debt` and `status` are defined on BOTH engines;
// `hf` on Aave alone, because the Debt Manager publishes a strict boolean and
// this service does not invent an ordering for it. The UI mirrors this map in
// its own per-engine vocabulary — a disagreement means the UI composes a
// request the API refuses.
func TestPositionsOrderPerEngineVocabulary(t *testing.T) {
	both := []PositionSort{
		PositionSortHeadroom, PositionSortLiqDistance, PositionSortDebt, PositionSortStatus,
	}
	for _, sort := range both {
		require.Contains(t, positionsOrder[EngineAave], sort, "aave must define %q", sort)
		require.Contains(t, positionsOrder[EngineDebtManager], sort,
			"the Debt Manager must define %q", sort)
	}
	require.Contains(t, positionsOrder[EngineAave], PositionSortHF)
	require.NotContains(t, positionsOrder[EngineDebtManager], PositionSortHF,
		"there is no Debt Manager health factor, and an invented ordering would blend the comparators")

	// EVERY defined (engine, sort) carries BOTH directions and a canonical
	// direction — otherwise a legal request resolves to an empty ORDER BY and
	// the page is served in whatever order the planner chose.
	for engine, sorts := range positionsOrder {
		for sort, dirs := range sorts {
			require.Contains(t, positionsCanonicalDir, sort,
				"%s/%s: every sort must name its canonical direction", engine, sort)
			require.Contains(t, dirs, PositionDirAsc, "%s/%s: missing asc", engine, sort)
			require.Contains(t, dirs, PositionDirDesc, "%s/%s: missing desc", engine, sort)
			for dir, fragment := range dirs {
				require.NotEmpty(t, fragment, "%s/%s/%s", engine, sort, dir)
				// THE TOTAL TIEBREAK: every fragment ends in `p.account ASC`,
				// in BOTH directions, so equal sort keys order identically
				// either way and the rank cursor stays deterministic.
				require.True(t, strings.HasSuffix(fragment, "p.account ASC"),
					"%s/%s/%s must end in the total account tiebreak: %s", engine, sort, dir, fragment)
				// The refused axis leads every fragment: a value sort cannot
				// rank an unknown value, so refusal placement is decided first
				// and refused rows stay visible rather than being dropped.
				require.True(t, strings.HasPrefix(fragment, "(p.status = 'refused') "),
					"%s/%s/%s must decide the refused axis first: %s", engine, sort, dir, fragment)
			}
		}
	}
}

// THE ALIAS IS AN ALIAS IN NAME ONLY.
//
// On the DEBT MANAGER the two keys are DIFFERENT SQL, deliberately: `headroom`
// divides, `liq_distance` subtracts. An edit that "tidied" them into one
// fragment would silently re-rank every pre-1.5.0 link and cursor — the exact
// dishonesty the deprecation was designed to avoid — so the difference is
// asserted rather than left to a comment.
//
// On AAVE they are the SAME fragment, because there headroom really is a
// monotone function of the health factor: one ordering under three names.
func TestPositionsOrderHeadroomIsTheRatioAndTheAliasIsUntouched(t *testing.T) {
	dm := positionsOrder[EngineDebtManager]
	require.NotEqual(t, dm[PositionSortLiqDistance][PositionDirAsc], dm[PositionSortHeadroom][PositionDirAsc],
		"the DM's ratio key and its absolute-room alias must not share an ORDER BY")

	// The ratio key DIVIDES by the capacity, guarded against zero — a
	// zero-capacity row must produce NULL, never a huge negative numerator
	// that would rank it as the most distressed account on the book.
	for _, dir := range []PositionDir{PositionDirAsc, PositionDirDesc} {
		require.Contains(t, dm[PositionSortHeadroom][dir], "NULLIF(p.max_borrow_lt, 0)",
			"the DM headroom ratio must guard the divisor: 0 capacity is NO ratio, not an extreme one")
		require.Contains(t, dm[PositionSortHeadroom][dir], "(p.max_borrow_lt - p.borrowings)::numeric /")
	}

	// The deprecated key still SUBTRACTS and never divides.
	for _, dir := range []PositionDir{PositionDirAsc, PositionDirDesc} {
		require.Contains(t, dm[PositionSortLiqDistance][dir], "(p.max_borrow_lt - p.borrowings)")
		require.NotContains(t, dm[PositionSortLiqDistance][dir], "NULLIF",
			"liq_distance keeps the ordering it shipped with — deprecated is not re-pointed")
	}

	// NULLS placement flips with the direction on the new key, exactly as the
	// direction law requires of every other key.
	require.Contains(t, dm[PositionSortHeadroom][PositionDirAsc], "ASC NULLS LAST")
	require.Contains(t, dm[PositionSortHeadroom][PositionDirDesc], "DESC NULLS FIRST")

	// AAVE: one ordering, three names — asserted as fragment identity so a
	// future edit cannot fork them by touching only one entry.
	aave := positionsOrder[EngineAave]
	for _, dir := range []PositionDir{PositionDirAsc, PositionDirDesc} {
		require.Equal(t, aave[PositionSortHF][dir], aave[PositionSortHeadroom][dir],
			"aave headroom IS the hf ranking — headroom = 1 − 1/HF is strictly increasing in HF")
		require.Equal(t, aave[PositionSortHF][dir], aave[PositionSortLiqDistance][dir])
	}
}

// The cursor's field count is the binding: (batch, engine, sort, dir,
// min_value, rank). 1.5.0 added a sort NAME, not a cursor field — the token a
// pre-1.5.0 client holds still decodes, which is what lets `liq_distance`
// cursors keep round-tripping.
func TestPositionsCursorShapeIsUnchangedBy150(t *testing.T) {
	require.Equal(t, 6, positionsCursorFields)
	require.Equal(t, "p5pos1", positionsCursorTag)
}
