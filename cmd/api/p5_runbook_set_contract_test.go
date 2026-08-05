package main

// The set-run's CONTRACT laws — the ones that read `api/openapi.yaml` itself
// rather than a served body.
//
// They are mechanical walks rather than hand-maintained field lists, for the
// reason the liquidatable-disclosure sweep already established: an inventory
// greens the day someone adds a field nobody remembered to inventory.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/risk"
)

const (
	setRunResponseSchema = "RunBookSetResponse"
	setRunEngineSchema   = "SetRunEngineSummary"
)

// moneyTyped reports whether a property is one of the contract's two exact
// money types. Both are STRINGS carrying an exact integer; neither is ever a
// JSON number.
func moneyTyped(ref *openapi3.SchemaRef) bool {
	_, name := deref(ref, "")
	return name == "Decimal" || name == "NullableDecimal"
}

// setRunProp is one property the walk met, named by the component that declares
// it so a failure says WHERE rather than only WHAT.
type setRunProp struct {
	Owner string
	Name  string
}

func (p setRunProp) String() string { return p.Owner + "." + p.Name }

// walkSetRun descends a schema tree, calling visit for every property.
//
// `licensed` carries "some ancestor (or this object) REQUIRES usd_decimals",
// which is the unit-scope license: a money figure beneath such a node is stated
// in that node's own engine unit. `inEngines` carries "this node is inside a
// `results[].engines[]` item", which is what part (b) of the money law needs to
// subtract.
func walkSetRun(
	ref *openapi3.SchemaRef, name string, licensed, inEngines bool, depth int,
	seen map[*openapi3.Schema]bool,
	visit func(owner string, prop string, ref *openapi3.SchemaRef, licensed, inEngines bool),
) {
	s, name := deref(ref, name)
	if s == nil || depth > 40 || seen[s] {
		return
	}
	seen[s] = true
	defer delete(seen, s)

	if name == setRunEngineSchema {
		inEngines = true
	}
	for _, r := range s.Required {
		if r == "usd_decimals" {
			licensed = true
		}
	}
	for propName, prop := range s.Properties {
		visit(name, propName, prop, licensed, inEngines)
		walkSetRun(prop, name+"."+propName, licensed, inEngines, depth+1, seen, visit)
	}
	if s.Items != nil {
		walkSetRun(s.Items, name, licensed, inEngines, depth+1, seen, visit)
	}
	for _, group := range [][]*openapi3.SchemaRef{s.AllOf, s.AnyOf, s.OneOf} {
		for _, member := range group {
			walkSetRun(member, name, licensed, inEngines, depth+1, seen, visit)
		}
	}
}

func setRunSchemaRef(t *testing.T, doc *openapi3.T, name string) *openapi3.SchemaRef {
	t.Helper()
	ref, ok := doc.Components.Schemas[name]
	require.True(t, ok, "the contract declares no %s", name)
	return openapi3.NewSchemaRef("#/components/schemas/"+name, ref.Value)
}

// TestSetRunNeverSumsAcrossEngines is the no-cross-engine-money law, in TWO
// parts, because either part alone is red or vacuous.
//
// Part (a) rooted at the response would be RED ON ARRIVAL:
// `SweepStamp.success_sum` is a required `Decimal` with no `usd_decimals`
// anywhere above it, on EVERY response that carries the batch envelope. A law
// that fails on its first run gets weakened rather than fixed, and the property
// it was protecting ends up with no test at all.
//
// So (a) is rooted at the money-bearing subtree, and (b) pins the OUTSIDE set
// exactly — the set may only shrink, and any NEW envelope Decimal fails this
// test until somebody justifies it in writing.
func TestSetRunNeverSumsAcrossEngines(t *testing.T) {
	doc := loadContract(t)

	// (a) EVERY money property under an engine summary sits beneath a node
	// requiring `usd_decimals`. No hand-maintained field list inside the subtree.
	var unlicensed []string
	inside := 0
	walkSetRun(setRunSchemaRef(t, doc, setRunEngineSchema), setRunEngineSchema, false, false, 0,
		map[*openapi3.Schema]bool{},
		func(owner, prop string, ref *openapi3.SchemaRef, licensed, _ bool) {
			if !moneyTyped(ref) {
				return
			}
			inside++
			if !licensed {
				unlicensed = append(unlicensed, setRunProp{Owner: owner, Name: prop}.String())
			}
		})
	sort.Strings(unlicensed)
	require.Empty(t, unlicensed,
		"money propert(ies) under results[].engines[] with no `usd_decimals` in scope: a figure whose unit is not stated "+
			"is a figure a reader will compare against another engine's")
	require.Positive(t, inside,
		"the walk found NO money property under the engine summary — a vacuous pass. The walker has stopped descending.")

	// (b) THE OUTSIDE SET IS PINNED EXACTLY. Each member is a named exception
	// with its justification stated here rather than in a comment nobody reads:
	//
	//	SweepStamp.success_sum   a sweep ROW COUNTER on the batch envelope — not
	//	                         money in any engine's USD unit at all.
	//	AppliedShock.factor_num  an EXACT RATIONAL, the shock the definition
	//	AppliedShock.factor_den  declared. A ratio has no unit.
	//	AppliedShock.before      ORACLE MARKS in the PRICE FEED's own units
	//	AppliedShock.after       (6 or 8 decimals per feed), never a book total in
	//	                         an engine's USD unit. That is why `AppliedShock`
	//	                         carries no `usd_decimals` today and must not be
	//	                         given one: a price is not a book total, and
	//	                         pretending it is would be the cross-engine defect
	//	                         in a new place.
	want := []string{
		"AppliedShock.after",
		"AppliedShock.before",
		"AppliedShock.factor_den",
		"AppliedShock.factor_num",
		"SweepStamp.success_sum",
	}
	outside := map[string]bool{}
	walkSetRun(setRunSchemaRef(t, doc, setRunResponseSchema), setRunResponseSchema, false, false, 0,
		map[*openapi3.Schema]bool{},
		func(owner, prop string, ref *openapi3.SchemaRef, _, inEngines bool) {
			if !moneyTyped(ref) || inEngines {
				return
			}
			outside[setRunProp{Owner: owner, Name: prop}.String()] = true
		})
	got := make([]string, 0, len(outside))
	for k := range outside {
		got = append(got, k)
	}
	sort.Strings(got)
	require.Equal(t, want, got,
		"the money properties reachable from RunBookSetResponse OUTSIDE results[].engines[] are not the exact pinned set. "+
			"This set may only SHRINK. A new one is either a cross-engine money field (fix the contract) or a genuine "+
			"exception (add it here WITH its justification, in writing).")
}

// TestSetRunHasNoFloats: every quantity on this surface is an exact integer,
// decimal string or enum. `type: number` does exist in the contract — at
// `Constants.rate_limit_requests_per_second` — which is exactly why this walk is
// rooted at the set-run rather than run globally, and why a walk that found
// nothing would be the bug.
func TestSetRunHasNoFloats(t *testing.T) {
	doc := loadContract(t)
	var floats []string
	props := 0
	for _, root := range []string{setRunResponseSchema, "SetRunRequest", "SetRunBusyBody"} {
		walkSetRun(setRunSchemaRef(t, doc, root), root, false, false, 0, map[*openapi3.Schema]bool{},
			func(owner, prop string, ref *openapi3.SchemaRef, _, _ bool) {
				props++
				s, _ := deref(ref, "")
				if s != nil && s.Type != nil && s.Type.Is(openapi3.TypeNumber) {
					floats = append(floats, setRunProp{Owner: owner, Name: prop}.String())
				}
			})
	}
	sort.Strings(floats)
	require.Empty(t, floats,
		"`type: number` under a set-run schema: every money quantity and every price mark on this surface is an EXACT "+
			"decimal integer string, and a float is how an exact rational becomes 0.8")
	require.Positive(t, props, "the walk visited no property at all — vacuous")

	// The anti-vacuity control: the contract DOES carry a float, and this walker
	// finds it when pointed at it. Without this, a walker that had stopped
	// descending would pass the law above forever.
	found := false
	walkSetRun(setRunSchemaRef(t, doc, "Constants"), "Constants", false, false, 0, map[*openapi3.Schema]bool{},
		func(_, prop string, ref *openapi3.SchemaRef, _, _ bool) {
			s, _ := deref(ref, "")
			if s != nil && s.Type != nil && s.Type.Is(openapi3.TypeNumber) {
				found = found || prop == "rate_limit_requests_per_second"
			}
		})
	require.True(t, found,
		"the float walker did not find `Constants.rate_limit_requests_per_second`, which the contract does declare as "+
			"`type: number` — so the emptiness above proves nothing")
}

// TestSetRunNeverReClocksBelowTheEnvelope asserts DIRECTLY that no schema
// reachable from the set-run root, other than `Batch` itself, REQUIRES a member
// of the re-clock vocabulary.
//
// # The structural backstop is real, and it is narrower than it reads
//
// The existing liquidatable-disclosure sweep enforces this for the RESULTS
// SUBTREE ONLY, because `Projection.becomes_liquidatable` sits beneath
// `results[].engines[]`: a `batch_id` there would void the envelope's license
// and fail that sweep. It enforces NOTHING about a block with no liquidatable
// descendant, because `sweepWalk` records violations only AT liquidatable-family
// properties. `SetRunEvaluation` has no liquidatable descendant, so a re-clock
// there would be greened silently — which is why that block carries no
// `batch_id`, and why this test exists rather than a claim about the sweep.
func TestSetRunNeverReClocksBelowTheEnvelope(t *testing.T) {
	doc := loadContract(t)
	var reclocked []string
	visited := map[string]bool{}
	walkSetRun(setRunSchemaRef(t, doc, setRunResponseSchema), setRunResponseSchema, false, false, 0,
		map[*openapi3.Schema]bool{},
		func(owner, prop string, ref *openapi3.SchemaRef, _, _ bool) {
			visited[owner] = true
			s, name := deref(ref, owner+"."+prop)
			if s == nil || name == "Batch" {
				return
			}
			for _, r := range s.Required {
				if reclockNames[r] {
					reclocked = append(reclocked, name+" requires "+r)
				}
			}
		})
	// The root object itself, which the property walk never visits as a value.
	root, _ := deref(setRunSchemaRef(t, doc, setRunResponseSchema), setRunResponseSchema)
	for _, r := range root.Required {
		require.False(t, reclockNames[r], "%s itself requires the re-clock field %q", setRunResponseSchema, r)
	}
	sort.Strings(reclocked)
	require.Empty(t, reclocked,
		"a schema beneath the set-run root carries its OWN batch/bucket identity. There is ONE batch on this response and "+
			"the envelope is where it lives; a nested clock is a row pinned to something the envelope cannot vouch for.")

	require.True(t, visited["SetRunEvaluation"],
		"the walk never reached SetRunEvaluation, which is the block this law exists for — the sweep's structural backstop "+
			"does not cover it, so an unreached assertion here is no assertion at all")
}

// TestCommittedScenarioVersionMovesWithItsEngines makes the client's identity
// join sound, and makes the `COVERAGE SKEW` register unreachable in a correct
// deployment.
//
// A set-run result publishes `covered_engines` off the committed definition. A
// client holding `GET /v1/scenarios` joins on (id, version, config version) and
// compares. If a scenario's `engines` set could change WITHOUT its `version`
// moving, the two would disagree while the identity said they must not — a
// contract violation the client can only refuse, never reconcile.
func TestCommittedScenarioVersionMovesWithItsEngines(t *testing.T) {
	scenarios, err := risk.LoadScenarios()
	require.NoError(t, err)
	require.NotEmpty(t, scenarios)

	got := map[string][]string{}
	for _, sc := range scenarios {
		engines := append([]string(nil), sc.Engines...)
		sort.Strings(engines)
		got[sc.ID+"@"+sc.Version] = engines
	}

	path := filepath.Join("testdata", "scenario_engines_golden.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err, "the golden is checked in; regenerate it deliberately, never as a side effect")
	var want map[string][]string
	require.NoError(t, json.Unmarshal(raw, &want))

	require.Equal(t, want, got,
		"a committed scenario's (id, version) -> engines mapping changed.\n"+
			"If a scenario's `engines` set moved, its `version` MUST move with it: a client joins the identity triple "+
			"against GET /v1/scenarios and compares `covered_engines`, and a definition that changed under a stable version "+
			"makes that join say two things at once.\n"+
			"Update %s only after bumping the scenario's version.", path)

	// Anti-vacuity: the golden must actually pin engine sets, not an empty map.
	require.Len(t, want, len(scenarios))
	for k, v := range want {
		require.NotEmpty(t, v, "%s pins an empty engine set", k)
		require.True(t, strings.Contains(k, "@"), "golden key %q is not id@version", k)
	}
}
