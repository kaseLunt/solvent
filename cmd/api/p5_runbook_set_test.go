package main

// The set-run's PURE laws: the two derivations that decide which sentence gets
// published, and the source-level checks that keep them total.
//
// Both derivations are pure functions of stated facts precisely so they can be
// exhaustively table-tested with no database, no book and no ResponseWriter —
// and so the "no default arm" claim is checkable against the SOURCE rather than
// against a comment.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

// srFuncSource returns one named function's source text.
//
// It is a real parse rather than a substring hunt: a check that scanned the
// whole file for "default:" would be satisfied by any unrelated switch, and a
// check that scanned for a brace-balanced blob would drift the first time
// somebody reformatted.
func srFuncSource(t *testing.T, file, fn string) string {
	t.Helper()
	raw, err := os.ReadFile(file)
	require.NoError(t, err)
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, file, raw, 0)
	require.NoError(t, err)
	for _, decl := range f.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok || fd.Name.Name != fn {
			continue
		}
		return string(raw[fset.Position(fd.Pos()).Offset:fset.Position(fd.End()).Offset])
	}
	t.Fatalf("%s declares no function %s", file, fn)
	return ""
}

// requireSwitchHasNoDefaultArm is the source-level law both derivations answer
// to. An `otherwise` arm is how an unconsidered state inherits another state's
// SENTENCE with full confidence — which is exactly how "Batch M has since
// materialized" got specified for a batch older than the measurement, and how a
// scenario declaring every shock at 1/1 got specified to publish the oracle as
// the cause of its zeros.
func requireSwitchHasNoDefaultArm(t *testing.T, file, fn string) {
	t.Helper()
	src := srFuncSource(t, file, fn)
	require.Contains(t, src, "switch {",
		"%s is no longer a condition switch, so the totality argument this law checks has changed shape", fn)
	require.NotContains(t, src, "default:",
		"%s has grown a DEFAULT ARM. Every arm of this derivation must be a condition somebody wrote down; a default "+
			"silently absorbs the state nobody considered and then serves another arm's sentence about it.", fn)
	require.Contains(t, src, "fmt.Errorf(",
		"%s's trailing statement must be a NAMED REFUSAL rather than a fall-through value: reaching it means the facts "+
			"contradict each other, and a sentence is not published over facts that do", fn)
}

// TestSetRunShockReachArmIsTotalAndHasNoDefaultArm is the pure half of the arm
// law: every combination of the derivation's own facts resolves to exactly one
// of the seven arms, and the ORDER is exercised on the cases where two arms
// would otherwise both claim the input.
func TestSetRunShockReachArmIsTotalAndHasNoDefaultArm(t *testing.T) {
	requireSwitchHasNoDefaultArm(t, "p5_runbook_set_reach.go", "setRunShockReachArm")

	// THE ORDERING CASES, each one a real committed shape.
	for _, tc := range []struct {
		name string
		f    setRunReachFacts
		want string
	}{
		{
			// dm_rate_horizon_plus_200bps: ONE shock, on borrow_apy, at 1/1. Arm 3
			// would claim it. Arm 1 is derived first, so it does not.
			name: "a projection declaring its one shock at the identity factor is arm 1, not arm 3",
			f:    setRunReachFacts{HasProjection: true, DeclaredShocks: 1, DeclaredShocksAtIdentity: 1},
			want: reachProjectionNoSpotPass,
		},
		{
			name: "weeth_market_depeg_oracles_held: no shock asked for",
			f:    setRunReachFacts{DeclaredShocks: 0},
			want: reachNoShocksDeclared,
		},
		{
			// dm_composition_census over a book its matrix describes. Arm 5 would
			// claim it (applied rows, nothing moved) and publish the oracle as the
			// cause. Arm 3 is derived first.
			name: "eight shocks all at 1/1 with a non-empty applied set is arm 3, not arm 5",
			f:    setRunReachFacts{DeclaredShocks: 8, DeclaredShocksAtIdentity: 8, AppliedRows: 9, MarksMoved: 0},
			want: reachAllShocksDeclaredAtIdentity,
		},
		{
			name: "a partly-identity declaration is NOT arm 3",
			f:    setRunReachFacts{DeclaredShocks: 3, DeclaredShocksAtIdentity: 2, AppliedRows: 4, MarksMoved: 0},
			want: reachNoMarkMoved,
		},
		{
			name: "a sized shock whose matrix describes nothing in this book",
			f:    setRunReachFacts{DeclaredShocks: 3, DeclaredShocksAtIdentity: 0, AppliedRows: 0},
			want: reachNoShockReachedTheBook,
		},
		{
			name: "stable_depeg_0995_in_band: the snap control",
			f:    setRunReachFacts{DeclaredShocks: 3, DeclaredShocksAtIdentity: 0, AppliedRows: 4, MarksMoved: 0},
			want: reachNoMarkMoved,
		},
		{
			name: "partly reached",
			f:    setRunReachFacts{DeclaredShocks: 3, DeclaredShocksAtIdentity: 0, AppliedRows: 2, MarksMoved: 1},
			want: reachSomeMarksHeld,
		},
		{
			name: "every mark moved",
			f:    setRunReachFacts{DeclaredShocks: 1, DeclaredShocksAtIdentity: 0, AppliedRows: 2, MarksMoved: 2},
			want: reachEveryMarkMoved,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := setRunShockReachArm(tc.f)
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}

	// TOTALITY, by exhaustion over the fact space rather than by argument.
	for _, proj := range []bool{false, true} {
		for declared := 0; declared <= 3; declared++ {
			for identity := 0; identity <= declared; identity++ {
				for applied := 0; applied <= 3; applied++ {
					for moved := 0; moved <= applied; moved++ {
						f := setRunReachFacts{
							HasProjection: proj, DeclaredShocks: declared,
							DeclaredShocksAtIdentity: identity, AppliedRows: applied, MarksMoved: moved,
						}
						arm, err := setRunShockReachArm(f)
						require.NoError(t, err, "no arm for %+v — the derivation is not total", f)
						require.Contains(t, setRunReachArms, arm, "%+v produced an arm outside the vocabulary", f)
					}
				}
			}
		}
	}

	// The refusal fires on facts that CONTRADICT each other, which is the only
	// way past the seven arms. Without this the trailing statement could be dead
	// code that returned "" and nobody would know.
	_, err := setRunShockReachArm(setRunReachFacts{DeclaredShocks: 1, AppliedRows: 1, MarksMoved: 2})
	require.Error(t, err, "more marks moved than were applied is a contradiction and must refuse rather than pick an arm")
}

// TestSetRunShockReachNoteIsTheArmsOwn: no arm's sentence is ever served under
// another arm. A false cause carries authority a bare zero does not, so two arms
// sharing a sentence is the defect this component exists to prevent, wearing a
// different hat.
func TestSetRunShockReachNoteIsTheArmsOwn(t *testing.T) {
	sc := risk.Scenario{ID: "x", Version: "v1", PathAssumption: "no move is asserted"}
	notes := map[string]string{}
	for _, arm := range setRunReachArms {
		n := setRunShockReachNote(arm, sc, wireSetRunShockReach{DeclaredShocks: 8, AppliedShocks: []wireAppliedShock{{}, {}}})
		require.NotEmpty(t, n, "arm %q serves no sentence at all", arm)
		for other, seen := range notes {
			require.NotEqual(t, seen, n, "arms %q and %q serve the SAME sentence", other, arm)
		}
		notes[arm] = n
	}
	require.Len(t, notes, 7, "the arm vocabulary is seven and each gets exactly one sentence")

	// The declared-hold arm carries the DEFINITION's own disclosure and makes no
	// claim about the oracle. This is the substring law Test Law 17(B) leans on.
	hold := notes[reachAllShocksDeclaredAtIdentity]
	require.Contains(t, hold, "no move is asserted",
		"the declared-hold sentence must carry the scenario's OWN `path_assumption`, which is where the definition "+
			"discloses the hold")
	require.NotContains(t, hold, "PRICING TRANSFORMS")
	require.NotContains(t, hold, "swallow")
	require.Contains(t, notes[reachNoMarkMoved], "PRICING TRANSFORMS",
		"the no-mark-moved sentence is the one that names the transform, and it is the one the declared hold must not borrow")
}

// TestSetRunHeldCauseOrdersTheIdentityFactorFirst pins the ORDER of the cause
// partition, which is specified rather than left to the implementer.
//
// A par-marked stable under a 1/1 factor comes back `snapped: true` and unmoved
// (`ApplyDMStableSnap(MulDivFloor(before, 1, 1))`). Attributing that hold to the
// snap would say the oracle swallowed a move NOBODY ASKED FOR — the identity
// census's defect in miniature, on a single row.
func TestSetRunHeldCauseOrdersTheIdentityFactorFirst(t *testing.T) {
	identityAndSnapped := wireAppliedShock{FactorNum: "1", FactorDen: "1", Before: "1000000", After: "1000000", Snapped: true}
	require.Equal(t, heldByDeclaredFactor, setRunHeldCause(identityAndSnapped),
		"a held row at the identity factor is attributed to the DEFINITION even when it also carries `snapped: true`")

	require.Equal(t, heldByTransform, setRunHeldCause(
		wireAppliedShock{FactorNum: "995", FactorDen: "1000", Before: "1000000", After: "1000000", Snapped: true}))
	require.Equal(t, heldByTransform, setRunHeldCause(
		wireAppliedShock{FactorNum: "995", FactorDen: "1000", Before: "1000000", After: "1000000", BaseSnapped: true}),
		"a snapped BASE is a transform too — a law written over `snapped` alone is red on the committed control")
	require.Equal(t, heldByTransform, setRunHeldCause(
		wireAppliedShock{FactorNum: "70", FactorDen: "100", Before: "1", After: "1", CapBound: true}))
	require.Equal(t, heldByArithmetic, setRunHeldCause(
		wireAppliedShock{FactorNum: "70", FactorDen: "100", Before: "1", After: "1"}),
		"exact-integer arithmetic returning the value it started from is its own cause, not a transform's doing")
}

// TestSetRunFreshnessIsTotalAndHasNoDefaultArm: FOUR arms, because an id
// compared against another ordered id has four outcomes and not three.
//
// A three-arm reading ("null, equal, otherwise superseded") routes a LESSER id
// into `superseded` and then mandates the sentence "Batch M has since
// materialized" about a batch OLDER than the one measured — a specified
// derivation producing a body its own law rejects.
func TestSetRunFreshnessIsTotalAndHasNoDefaultArm(t *testing.T) {
	requireSwitchHasNoDefaultArm(t, "p5_runbook_set.go", "setRunFreshness")

	id := func(v int64) *int64 { return &v }
	for _, tc := range []struct {
		newest *int64
		want   string
	}{
		{nil, freshnessNoneServable},
		{id(7), freshnessStillNewest},
		{id(8), freshnessSuperseded},
		{id(6), freshnessNewestIsOlder},
	} {
		got, err := setRunFreshness(tc.newest, 7)
		require.NoError(t, err)
		require.Equal(t, tc.want, got)
	}

	// Each arm's sentence is its own, and the OLDER arm never claims a
	// materialization.
	notes := map[string]string{}
	for _, tc := range []struct {
		arm    string
		newest *int64
	}{
		{freshnessStillNewest, id(7)},
		{freshnessSuperseded, id(8)},
		{freshnessNewestIsOlder, id(6)},
		{freshnessNoneServable, nil},
	} {
		n := setRunFreshnessNote(tc.arm, 7, tc.newest)
		require.NotEmpty(t, n, "arm %q serves no sentence", tc.arm)
		for other, seen := range notes {
			require.NotEqual(t, seen, n, "arms %q and %q serve the SAME sentence", other, tc.arm)
		}
		notes[tc.arm] = n
	}
	require.NotContains(t, notes[freshnessNewestIsOlder], "has SINCE MATERIALIZED",
		"the newest_is_older sentence must never claim a materialization: the batch it names PREDATES the measurement")
	require.Contains(t, notes[freshnessNewestIsOlder], "OLDER")
	require.Contains(t, notes[freshnessSuperseded], "has SINCE MATERIALIZED")
}

// TestSetRunFreshnessProbeIsOneStatement is the source-level half of the probe
// law: the id and the clock come from ONE statement, so they cannot be read at
// two instants that disagree.
//
// A shape built from `BatchStillNewestServable` (a bool) plus a separate id
// query plus a separate `SELECT now()` can serve `still_newest` beside a NEWER
// id (a batch landing between probes) or `superseded` beside the id it measured
// (the newer batch pruned between probes), inside the one block whose whole job
// is to read on its own.
func TestSetRunFreshnessProbeIsOneStatement(t *testing.T) {
	src := srFuncSource(t, "../../internal/store/p5_setrun_probe.go", "NewestServableBatchAt")
	require.Equal(t, 1, strings.Count(src, "QueryRow("),
		"the freshness probe must issue exactly ONE statement: the id and `now()` come from the same query or they come "+
			"from two instants that are free to disagree.\n%s", src)
	require.Equal(t, 0, strings.Count(src, ".Query(")+strings.Count(src, ".Exec("),
		"the probe issues a second statement")
	require.Contains(t, src, "riskBatchCompleteConjuncts",
		"the probe must reuse THE SERVING completeness predicate verbatim, or the probe and the resolution can drift")
	require.Contains(t, src, "now()", "the probe must read the DATABASE clock, never this process's")
}

// TestIsRunBookSetPathIsAnExactMatch: the read-only gate opens for exactly one
// path, never for a family. `/v1/scenarios/run-book-set/anything` is a 405.
func TestIsRunBookSetPathIsAnExactMatch(t *testing.T) {
	require.True(t, isRunBookSetPath("/v1/scenarios/run-book-set"))
	for _, p := range []string{
		"/v1/scenarios/run-book-set/",
		"/v1/scenarios/run-book-set/anything",
		"/v1/scenarios/run-book-set-2",
		"/v1/scenarios/x/run-book-set",
		"/v1/scenarios",
	} {
		require.False(t, isRunBookSetPath(p), "%q must not open the read-only gate", p)
	}
	// And the two predicates are disjoint, so neither can be widened into the
	// other by accident.
	require.False(t, isRunBookPath("/v1/scenarios/run-book-set"))
	require.False(t, isRunBookSetPath("/v1/scenarios/eth_minus_10/run-book"))
}

// TestSetRunGateIsNonBlockingAndReleases is the semaphore's own law. A blocking
// acquire would hold a connection waiting and make worst-case latency unbounded
// under load, which is the whole reason the overflow is refused immediately.
func TestSetRunGateIsNonBlockingAndReleases(t *testing.T) {
	g := newSetRunGate(2)
	ok, in, max := g.acquire()
	require.True(t, ok)
	require.Equal(t, 1, in)
	require.Equal(t, 2, max)

	ok, in, _ = g.acquire()
	require.True(t, ok)
	require.Equal(t, 2, in)

	ok, in, max = g.acquire()
	require.False(t, ok, "the third acquire against a bound of 2 must be refused, not queued")
	require.Equal(t, 2, in, "the refusal publishes the gauge AS IT STOOD")
	require.Equal(t, 2, max)

	g.release()
	require.Equal(t, 1, g.gauge())
	ok, _, _ = g.acquire()
	require.True(t, ok, "a released slot is reusable — a leak here takes the deployment to zero capacity permanently")
	g.release()
	g.release()
	require.Equal(t, 0, g.gauge())
	// Over-release cannot drive the gauge negative and manufacture capacity.
	g.release()
	require.Equal(t, 0, g.gauge())
}
