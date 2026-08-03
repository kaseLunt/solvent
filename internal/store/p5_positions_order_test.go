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
// On AAVE the ASCENDING fragment is shared, because there headroom really is a
// monotone function of the health factor: one ordering under three names. The
// DESCENDING fragment is NOT shared — see the unknown-last law below.
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

	// NULLS placement does NOT flip with the direction on this key (Wave
	// W-HR-C): the ratio axis reverses, the no-ratio rows stay LAST either way.
	// A row with no published capacity has no headroom, and "greatest headroom
	// first" must not be answered with rows that have none.
	require.Contains(t, dm[PositionSortHeadroom][PositionDirAsc], "ASC NULLS LAST")
	require.Contains(t, dm[PositionSortHeadroom][PositionDirDesc], "DESC NULLS LAST")

	// AAVE, ASCENDING: one ordering, three names — asserted as fragment
	// identity so a future edit cannot fork them by touching only one entry,
	// AND pinned to its exact bytes so the identity cannot go vacuous by all
	// three drifting together.
	aave := positionsOrder[EngineAave]
	require.Equal(t,
		`(p.status = 'refused') ASC, p.hf_infinite ASC, p.hf_wad ASC NULLS LAST, p.account ASC`,
		aave[PositionSortHF][PositionDirAsc])
	require.Equal(t, aave[PositionSortHF][PositionDirAsc], aave[PositionSortHeadroom][PositionDirAsc],
		"aave headroom ASC IS the hf ranking — headroom = 1 − 1/HF is strictly increasing in HF")
	require.Equal(t, aave[PositionSortHF][PositionDirAsc], aave[PositionSortLiqDistance][PositionDirAsc])

	// AAVE, DESCENDING: DELIBERATELY NOT SHARED (Wave W-HR-C, Codex round-15
	// finding 2). Reversing hf leads with refused rows, which is a defensible
	// answer to "highest health factor" — an unranked row has to go somewhere —
	// but a LIE in answer to "greatest headroom first", where it states that
	// accounts this service could not value have the most room left on the book.
	// Both sides are pinned to exact bytes so the NON-identity cannot go
	// vacuous: `hf`/`liq_distance` keep the ranking every pre-1.5.0 link and
	// in-flight cursor was minted against, and `headroom` reverses the SAME
	// known-value axis while pinning the unknown axes last.
	require.Equal(t,
		`(p.status = 'refused') DESC, p.hf_infinite DESC, p.hf_wad DESC NULLS FIRST, p.account ASC`,
		aave[PositionSortHF][PositionDirDesc],
		"hf desc is a pre-1.5.0 ranking and keeps its exact bytes — the alias law binds it")
	require.Equal(t, aave[PositionSortHF][PositionDirDesc], aave[PositionSortLiqDistance][PositionDirDesc])
	require.Equal(t,
		`(p.status = 'refused') ASC, p.hf_infinite DESC, p.hf_wad DESC NULLS LAST, p.account ASC`,
		aave[PositionSortHeadroom][PositionDirDesc],
		"headroom desc: the hf axis reversed, the refused and NULL axes pinned LAST")
	require.NotEqual(t, aave[PositionSortHF][PositionDirDesc], aave[PositionSortHeadroom][PositionDirDesc],
		"aave headroom desc must NOT be the hf reversal — unknown is not maximal headroom")

	// hf_infinite is NOT an unknown and must keep reversing with the direction:
	// zero debt is headroom = 100%, the MAXIMUM, so those rows correctly LEAD
	// the reversed page. Pinning them last with the refusals would be the same
	// class of error in the opposite direction.
	require.Contains(t, aave[PositionSortHeadroom][PositionDirAsc], "p.hf_infinite ASC")
	require.Contains(t, aave[PositionSortHeadroom][PositionDirDesc], "p.hf_infinite DESC")
}

// THE HEADROOM UNKNOWN-LAST LAW (Wave W-HR-C), swept over the map itself so it
// holds for every engine that defines the key, present and future.
//
// Codex round-15 finding 2 was this fragment reversed WHOLESALE:
// `(p.status = 'refused') DESC, <ratio> DESC NULLS FIRST, p.account ASC` — so a
// page asking for the greatest headroom on the book was answered with the
// refusals and the zero-capacity rows, ahead of every account with a KNOWN
// ratio. UNKNOWN IS NOT MAXIMAL. Refused-FIRST triage is the `status` sort's
// job, under its own name, where the operator asked for it.
func TestPositionsOrderHeadroomPinsUnknownsLastInBothDirections(t *testing.T) {
	for engine, sorts := range positionsOrder {
		fragments, ok := sorts[PositionSortHeadroom]
		require.True(t, ok, "%s must define headroom", engine)
		for _, dir := range []PositionDir{PositionDirAsc, PositionDirDesc} {
			fragment := fragments[dir]
			require.True(t, strings.HasPrefix(fragment, "(p.status = 'refused') ASC,"),
				"%s/headroom/%s must rank refusals LAST in BOTH directions: %s", engine, dir, fragment)
			require.NotContains(t, fragment, "NULLS FIRST",
				"%s/headroom/%s must never float a no-value row above a ranked one: %s", engine, dir, fragment)
			require.Contains(t, fragment, "NULLS LAST",
				"%s/headroom/%s must state its NULLS placement explicitly: %s", engine, dir, fragment)
		}
	}

	// AND THE CONVERSE, so the new law cannot quietly spread to the keys the
	// ALIAS LAW binds: every OTHER key still obeys the plain reversal, its
	// refused axis flipping with the direction, exactly as the links and
	// in-flight cursors minted against it assume.
	for engine, sorts := range positionsOrder {
		for sort, dirs := range sorts {
			if sort == PositionSortHeadroom {
				continue
			}
			asc, desc := dirs[PositionDirAsc], dirs[PositionDirDesc]
			require.NotEqual(t,
				strings.HasPrefix(asc, "(p.status = 'refused') ASC,"),
				strings.HasPrefix(desc, "(p.status = 'refused') ASC,"),
				"%s/%s: the refused axis must still flip with the direction — %q keeps the ordering it shipped with:\n  asc:  %s\n  desc: %s",
				engine, sort, sort, asc, desc)
		}
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
