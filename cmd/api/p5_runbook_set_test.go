package main

// The set-run's PURE laws: the two derivations that decide which sentence gets
// published, and the source-level checks that keep them total.
//
// Both derivations are pure functions of stated facts precisely so they can be
// exhaustively table-tested with no database, no book and no ResponseWriter —
// and so the "no default arm" claim is checkable against the SOURCE rather than
// against a comment.

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
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
	// TWO APPLIED ROWS, BOTH HELD BY A TRANSFORM. Arm 5's sentence is COMPOSED
	// from the cause counts (TestSetRunNoMarkMovedNamesTheCauseItsCountsShow pins
	// every composition), so the facts here have to name one — and the
	// transform-only composition is the one the declared-hold arm must not
	// borrow, which is what the substring assertions below are about.
	reach := wireSetRunShockReach{
		DeclaredShocks:       8,
		AppliedShocks:        []wireAppliedShock{{}, {}},
		MarksHeldByTransform: 2,
	}
	notes := map[string]string{}
	for _, arm := range setRunReachArms {
		n := setRunShockReachNote(arm, sc, reach)
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

// srHeldTotalRe matches arm 5's LEADING TOTAL — the "all N held mark(s)" a
// composed sentence states before naming its causes. It is a regexp rather than
// a substring because the law is about the NUMBER, and a substring check for one
// spelling of it cannot fail on a different wrong number.
var srHeldTotalRe = regexp.MustCompile(`all (\d+) held mark\(s\)`)

// srRequireCauseClauseNamesExactly is the composition law BOTH halves of the
// arm-5 cause check answer to — the pure table below and the served-body sweep
// in p5_runbook_set_reach_db_test.go.
//
// It states two things over one sentence:
//
//	(1) NAMES EXACTLY. Every cause whose count is nonzero is named, and no cause
//	    whose count is zero is named. A sentence that named a cause holding
//	    nothing is a true zero under a false cause, which is the defect this
//	    whole component exists to refuse.
//	(2) THE TOTAL IS THE SUM. Any "all N held mark(s)" the sentence leads with
//	    must be transform + arithmetic + declared. Round 53's composer read only
//	    two of the three counts, so a book holding one mark by a transform and one
//	    at a declared identity factor served "all 1 held mark(s)" and then printed
//	    the true 1/1 split one sentence later, in the same response.
//
// The markers are UPPERCASE on purpose: every sentence in this component
// mentions a pricing transform or the arithmetic in passing, in lower case
// ("No pricing transform pinned any of them"), and only the sentence that
// ATTRIBUTES a cause shouts it.
func srRequireCauseClauseNamesExactly(t *testing.T, where, note string, transform, arithmetic, declared int) {
	t.Helper()
	nonzero := 0
	for _, n := range []int{transform, arithmetic, declared} {
		if n > 0 {
			nonzero++
		}
	}
	require.Positive(t, nonzero,
		"%s: `no_mark_moved` over applied rows attributes at least one held mark to a cause", where)

	for _, c := range []struct {
		marker string
		phrase string
		n      int
		what   string
	}{
		{"PRICING TRANSFORM",
			strconv.Itoa(transform) + " mark(s) were pinned by a PRICING TRANSFORM", transform,
			"a pricing transform"},
		{"EXACT-INTEGER ARITHMETIC",
			strconv.Itoa(arithmetic) + " came back unchanged from EXACT-INTEGER ARITHMETIC", arithmetic,
			"exact-integer arithmetic"},
		{"DEFINITION",
			strconv.Itoa(declared) + " mark(s) were held at the identity factor this scenario DECLARED", declared,
			"an identity factor this scenario declared"},
	} {
		if c.n == 0 {
			require.NotContains(t, note, c.marker,
				"%s holds NO mark by %s and its sentence names that cause anyway — a true zero under a false cause",
				where, c.what)
			continue
		}
		require.Contains(t, note, c.marker,
			"%s holds %d mark(s) by %s and its sentence does not name that cause at all", where, c.n, c.what)
		if nonzero > 1 {
			require.Contains(t, note, c.phrase,
				"%s holds marks by %d causes, so each named cause must carry ITS OWN count (%d by %s) rather than one "+
					"number standing for the whole held set", where, nonzero, c.n, c.what)
		}
	}

	// THE SUM LAW.
	sum := transform + arithmetic + declared
	if nonzero > 1 {
		require.Regexp(t, srHeldTotalRe, note,
			"%s composes %d causes and states no total, so nothing in the sentence can be checked against the sum of "+
				"the counts served beside it", where, nonzero)
	}
	for _, m := range srHeldTotalRe.FindAllStringSubmatch(note, -1) {
		require.Equal(t, strconv.Itoa(sum), m[1],
			"%s says \"all %s held mark(s)\" while its own counts hold %d (%d by a transform, %d by arithmetic, %d at a "+
				"declared identity factor) — the sentence contradicts the numbers served in the same object",
			where, m[1], sum, transform, arithmetic, declared)
	}
}

// TestSetRunNoMarkMovedNamesTheCauseItsCountsShow pins arm 5's sentence to the
// COUNTS THE SAME RESPONSE SERVES, in EVERY composition those counts admit —
// three pure causes, three pairs and the triple, seven in all.
//
// The arm's condition is "rows were applied and none of them moved", which says
// nothing about why. Its sentence first asserted one fixed cause — the pricing
// transforms — while `setRunHeldCause` was busy classifying a third cause,
// `arithmetic`, for a mark that came back unchanged from `MulDivFloor` with no
// snap and no cap. The repair for THAT read two counts and still ignored
// `marks_held_by_declared_factor`, so a scenario declaring one identity shock
// and one sized-but-snapped shock served "all 1 held mark(s)" over a book that
// held two, with the accurate 1/1 split printed one sentence later. Both
// versions are the same defect: a true zero under a false cause, one arm below
// the arm this component was built for.
func TestSetRunNoMarkMovedNamesTheCauseItsCountsShow(t *testing.T) {
	sc := risk.Scenario{ID: "x", Version: "v1", PathAssumption: "no move is asserted"}
	note := func(r wireSetRunShockReach) string {
		return setRunShockReachNote(reachNoMarkMoved, sc, r)
	}
	rows := func(n int) []wireAppliedShock { return make([]wireAppliedShock, n) }

	// ALL SEVEN COMPOSITIONS. Every one is a real partition of its own applied
	// set: moved 0, and the three cause counts summing to len(applied_shocks)
	// exactly as `setRunShockReach` refuses to serve anything else. The counts
	// differ between cases on purpose, so a substring row below cannot be
	// satisfied by another case's number.
	cases := []struct {
		name                            string
		why                             string
		r                               wireSetRunShockReach
		transform, arithmetic, declared int
	}{
		{
			name: "transform only",
			why:  "stable_depeg_0995_in_band over the committed four-row control",
			r: wireSetRunShockReach{
				DeclaredShocks: 3, AppliedShocks: rows(4), MarksHeldByTransform: 4,
			},
			transform: 4,
		},
		{
			name: "arithmetic only",
			why:  "one sized shock whose floor lands on the integer the mark started from",
			r: wireSetRunShockReach{
				DeclaredShocks: 1, AppliedShocks: rows(2), MarksHeldByArithmetic: 2,
			},
			arithmetic: 2,
		},
		{
			// REACHABLE rather than defensive: a scenario declaring one sized shock
			// and one identity shock, over a book pricing only the marks the
			// identity shock describes, is not arm 3 (not every declared shock is at
			// identity) and lands here with every hold at its declared factor.
			name: "declared factor only",
			why:  "a sized shock the book's marks do not answer to, beside an identity shock that reaches them",
			r: wireSetRunShockReach{
				DeclaredShocks: 2, AppliedShocks: rows(3), MarksHeldByDeclaredFactor: 3,
			},
			declared: 3,
		},
		{
			name: "transform and arithmetic",
			why:  "a snapped stable beside a dust mark the floor returns unchanged",
			r: wireSetRunShockReach{
				DeclaredShocks: 2, AppliedShocks: rows(5), MarksHeldByTransform: 3, MarksHeldByArithmetic: 2,
			},
			transform: 3, arithmetic: 2,
		},
		{
			// THE ROUND-53 FINDING, stated as facts. One identity shock and one
			// sized-but-snapped shock: two held marks, two DIFFERENT causes, and a
			// composer reading only two of the three counts publishes "all 1".
			name: "transform and declared factor",
			why:  "one identity shock (a declared hold) beside one sized shock the snap band pinned",
			r: wireSetRunShockReach{
				DeclaredShocks: 2, AppliedShocks: rows(3), MarksHeldByTransform: 2, MarksHeldByDeclaredFactor: 1,
			},
			transform: 2, declared: 1,
		},
		{
			name: "arithmetic and declared factor",
			why:  "one identity shock beside one sized shock the floor returns unchanged",
			r: wireSetRunShockReach{
				DeclaredShocks: 2, AppliedShocks: rows(4), MarksHeldByArithmetic: 3, MarksHeldByDeclaredFactor: 1,
			},
			arithmetic: 3, declared: 1,
		},
		{
			name: "all three causes",
			why:  "a snapped stable, a dust mark the floor returns unchanged, and an identity shock",
			r: wireSetRunShockReach{
				DeclaredShocks: 3, AppliedShocks: rows(6),
				MarksHeldByTransform: 3, MarksHeldByArithmetic: 2, MarksHeldByDeclaredFactor: 1,
			},
			transform: 3, arithmetic: 2, declared: 1,
		},
	}

	// THE PARTITION IS A PRECONDITION OF THE TABLE, not a hope: a case whose
	// counts did not close would be testing a body `setRunShockReach` refuses to
	// serve, and the law would then be about nothing.
	for _, tc := range cases {
		require.Equal(t, tc.r.AppliedRows(), tc.transform+tc.arithmetic+tc.declared,
			"%s: %s — the three cause counts must account for every applied row under this arm", tc.name, tc.why)
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srRequireCauseClauseNamesExactly(t, tc.name, note(tc.r), tc.transform, tc.arithmetic, tc.declared)
		})
	}

	// THE SENTENCES THAT ARE NOT COMPOSED FROM A SHARED TEMPLATE, pinned by the
	// phrases their readers rely on.
	t.Run("the three pure causes keep their own phrasing", func(t *testing.T) {
		pure := note(cases[0].r)
		require.Contains(t, pure, "PRICING TRANSFORMS' doing")
		require.Contains(t, pure, "stable snap")
		require.Contains(t, pure, "snapped stable BASE",
			"naming the stable snap ALONE is the sentence that is false on the fourth row of the committed control")
		require.Contains(t, pure, "not the book's")
		require.Contains(t, pure, "all 4 held mark(s)")

		pure = note(cases[1].r)
		require.Contains(t, pure, "EXACT-INTEGER ARITHMETIC's doing")
		require.Contains(t, pure, "No pricing transform pinned any of them")
		require.Contains(t, pure, "all 2 held mark(s)")

		pure = note(cases[2].r)
		require.Contains(t, pure, "DEFINITION's doing")
		require.Contains(t, pure, "the scenario also declares a sized shock the book's marks did not answer to")
	})

	t.Run("a composed sentence counts its causes and states the sum", func(t *testing.T) {
		require.Contains(t, note(cases[3].r), "TWO causes")
		require.Contains(t, note(cases[3].r), "all 5 held mark(s)")
		require.Contains(t, note(cases[4].r), "TWO causes")
		require.Contains(t, note(cases[5].r), "TWO causes")
		require.Contains(t, note(cases[6].r), "THREE causes")
		require.Contains(t, note(cases[6].r), "all 6 held mark(s)")

		// THE REGRESSION, SPELLED OUT. A composer reading only the transform and
		// arithmetic counts serves the transform-only sentence here, whose total is
		// 2 over a book that held 3.
		mixedDeclared := note(cases[4].r)
		require.NotContains(t, mixedDeclared, "all 2 held mark(s)",
			"the transform count is 2 and the held total is 3; a sentence leading with the transform count alone "+
				"contradicts the `marks_held_by_declared_factor` served beside it")
		require.Contains(t, mixedDeclared, "Of the held marks: 2 pinned by a pricing transform",
			"and the split clause one sentence later is what makes the contradiction visible in the same response")
		require.Contains(t, mixedDeclared, "1 held at the identity factor this scenario declared for them.")
	})

	// AND THE SEVEN ARE GENUINELY DIFFERENT SENTENCES. A composition that
	// collapsed to one string would satisfy the substring rows above the moment
	// the fixed sentence happened to contain every phrase.
	seen := map[string]string{}
	for _, tc := range cases {
		n := note(tc.r)
		for other, prev := range seen {
			require.NotEqual(t, prev, n, "compositions %q and %q serve the SAME sentence", other, tc.name)
		}
		seen[tc.name] = n
	}
	require.Len(t, seen, 7, "the three cause counts admit seven compositions and each gets its own sentence")
}

// TestDecodeSetRunRequestRequiresTheBodyToEnd is the EOF law at the decoder,
// with the defect it replaces EXECUTED rather than described.
func TestDecodeSetRunRequestRequiresTheBodyToEnd(t *testing.T) {
	decode := func(t *testing.T, body string) (int, bool) {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, setRunPath, strings.NewReader(body))
		_, ok := decodeSetRunRequest(w, r)
		return w.Code, ok
	}
	const one = `{"scenario_ids":["eth_minus_10"]}`

	for _, tc := range []struct{ name, body string }{
		{"a trailing closing brace", one + "}"},
		{"two trailing closing braces", one + "}}"},
		{"a trailing closing bracket", one + "]"},
		{"two trailing closing brackets", one + "]]"},
		{"a second object", one + one},
		{"whitespace and then a token", one + "  \n\t }"},
		{"a trailing scalar", one + " 7"},
		{"a trailing comma", one + ","},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, ok := decode(t, tc.body)
			require.False(t, ok, "the body carries bytes after its one JSON object and was accepted")
			require.Equal(t, http.StatusBadRequest, code)
		})
	}

	for _, tail := range []string{"", "\n", " \t\r\n  "} {
		_, ok := decode(t, one+tail)
		require.True(t, ok, "trailing whitespace %q must be accepted: the decoder skips it on its way to EOF, and every "+
			"client whose HTTP library appends a newline sends it", tail)
	}

	// THE MUTATION, EXECUTED. The check this replaced was `dec.More()`, which
	// reports whether another ELEMENT follows inside the value being streamed —
	// so it answers FALSE at a next byte of `}` or `]` and let both tails
	// through. Running it here is what makes the cases above REGRESSION cases
	// rather than a list somebody hopes is exhaustive.
	for _, body := range []string{one + "}", one + "]", one + "}}", one + "]]"} {
		dec := json.NewDecoder(strings.NewReader(body))
		var req setRunRequest
		require.NoError(t, dec.Decode(&req), "the first value still decodes: %q", body)
		require.False(t, dec.More(),
			"`dec.More()` reports another value after %q, so the old check would have caught it and this is not the "+
				"defect being pinned", body)
	}
	// And the check that replaced it sees exactly those bodies.
	for _, body := range []string{one + "}", one + "]", one + "}}", one + "]]"} {
		dec := json.NewDecoder(strings.NewReader(body))
		var req setRunRequest
		require.NoError(t, dec.Decode(&req))
		var trailing json.RawMessage
		require.NotErrorIs(t, dec.Decode(&trailing), io.EOF,
			"the second decode must NOT reach EOF on %q — that is the whole difference between the two checks", body)
	}
}

// TestSetRunHeldFlatAssetsKeepOneAddressOnTwoChains is the pair-identity law at
// the function's own seam, with the address-only dedupe RUN against the same
// rows rather than argued about.
func TestSetRunHeldFlatAssetsKeepOneAddressOnTwoChains(t *testing.T) {
	usdc := common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	weeth := common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	rows := map[string]wireHeldFlat{}
	for _, h := range []wireHeldFlat{
		{ChainID: 10, Asset: weeth.Hex(), Source: "priceproviderv2", Value: "4000000"},
		{ChainID: 1, Asset: usdc.Hex(), Source: "aaveoracle", Value: "100000000"},
		{ChainID: 10, Asset: usdc.Hex(), Source: "priceproviderv2", Value: "1000000"},
		// The SAME PAIR twice, from two sources: the dedupe is over the pair, so
		// this row must collapse into the one above it.
		{ChainID: 10, Asset: usdc.Hex(), Source: "another", Value: "1000001"},
	} {
		rows[heldFlatKey(h)] = h
	}
	require.Len(t, rows, 4, "four held-flat ROWS go in")

	got := setRunHeldFlatAssets(rows)
	require.Equal(t, []wireSetRunHeldFlatAsset{
		{ChainID: 1, Asset: usdc.Hex()},
		{ChainID: 10, Asset: usdc.Hex()},
		{ChainID: 10, Asset: weeth.Hex()},
	}, got,
		"THREE identities come out: the repeated (10, USDC) pair collapses, and the one address held on chain 1 AND "+
			"chain 10 stays TWO entries, ascending on chain id first")

	// ADJACENCY, on the address that has two chains.
	require.Equal(t, got[0].Asset, got[1].Asset)
	require.Less(t, got[0].ChainID, got[1].ChainID)

	// THE MUTATION: dedupe the same rows by address alone.
	assetOnly := map[string]bool{}
	for _, h := range rows {
		assetOnly[strings.ToLower(h.Asset)] = true
	}
	require.Len(t, assetOnly, 2,
		"an address-only identity answers TWO entries where the pair identity answers three, and the missing one is a "+
			"real mark the model did not claim")
	require.NotEqual(t, len(assetOnly), len(got),
		"the two identities must DISAGREE on this input, or the pair key is untested by it")
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
