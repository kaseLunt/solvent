package main

// THE EXHAUSTIVE LIQUIDATABLE-DISCLOSURE LAW over api/openapi.yaml (wave H4b,
// the Codex round-3 HIGH on the acceptance-law license).
//
// # The license this test enforces
//
// The adjudicated MOTION license (progress-phase3.md, "CHAIN-TRUTH RULING:
// BOOLEAN LEG" / "RISK-QUANT RULING CONVERGES") requires that EVERY surface
// serving a DM liquidatable boolean structurally attaches its sweep watermark
// — "evidence, not assertion; any surface serving the bare boolean collapses
// the license." Codex found the contract itself violating it: 1.2.0's
// AddressHistoryPoint REQUIRED `liquidatable` while OMITTING `sweep_block`, so
// an honest history client received a mixed-clock verdict with no S and could
// read it as pin truth. The 1.2.1 fix adds the per-point watermark; THIS test
// is the structural guarantee the class stays closed: it sweeps the WHOLE
// contract mechanically — every response of every operation, plus the SSE
// payload — and fails the day any schema serves a liquidatable-family field
// without sweep evidence in scope. There is NO hand-maintained list of schema
// names anywhere in the sweep: a future endpoint adding a bare boolean is
// found by the walk, not by an inventory someone remembered to extend.
//
// # The mechanical law
//
// Walk every root (each operation's each response's application/json schema,
// plus the StreamPayload component the SSE frames are validated against),
// descending through $refs, allOf/anyOf/oneOf, array items and inline
// objects, carrying one bit of state — "licensed":
//
//   - a node ATTACHES SWEEP EVIDENCE when some chain of REQUIRED properties
//     from it reaches a required property named `sweep_block` or `sweep`
//     (Position.as_of -> AsOf.sweep_block; PositionSummary.sweep_block;
//     Batch.watermarks -> Stamp.sweep — the envelope form). Attaching sets
//     licensed=true for the subtree.
//   - a node RE-CLOCKS when it requires its own batch/bucket identity
//     (`batch_id`, `computed_at` or `bucket_start`): its rows speak for a
//     batch OTHER than the response envelope's, so outer vouching is void —
//     re-clocking without attaching resets licensed=false. This is exactly
//     what made AddressHistoryPoint a violation under 1.2.0 despite the
//     response-level `batch`: the envelope's newest-batch stamps cannot vouch
//     for a point pinned to its own historical batch.
//   - a liquidatable-family property (name containing "liquidatable")
//     encountered while UNLICENSED is a violation.
//
// # The law's honest boundary
//
// "Attaches" is name-and-structure, not semantics: it proves a sweep-clock
// field is structurally required in scope, not that a handler fills it
// honestly (the strip-proof DB test in p5_sweepproof_db_test.go owns the
// served-values half). And envelope vouching accepts any required chain to
// sweep evidence at the same clock — a deliberate acceptance for the
// envelope-clocked aggregate/stress surfaces, whose verdicts are computed AT
// the envelope batch the watermark vector stamps.
//
// # The standing count gaps, pinned — never silently absorbed
//
// The sweep finds three STANDING violations in today's contract, all on the
// derived COUNT (`liquidatable_positions`, integer), none on the boolean
// verdict class. They are pinned below as an EXACT set: a fourth gap fails
// this test immediately, and fixing one fails it too until the pin shrinks —
// the list can only be edited deliberately, in the open. The boolean class
// has NO pin and admits ZERO violations, ever.

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/require"
)

// liquidatableFamily reports whether a property name serves `liquidatable` or
// a liquidatable-derived count/verdict: `liquidatable`, `becomes_liquidatable`,
// `never_liquidatable`, `liquidatable_positions`, and any future spelling that
// carries the word. (`liquidation` does NOT match: a liquidation EVENT is a
// chain fact, not a verdict about the present.)
func liquidatableFamily(name string) bool {
	return strings.Contains(strings.ToLower(name), "liquidatable")
}

// The sweep-evidence vocabulary: exact required-property names that carry a
// sweep clock. `sweep_block` is the account's own last successful sweep
// (AsOf/PositionSummary/AddressHistoryPoint); `sweep` is the per-engine
// SweepStamp on the batch envelope's watermark vector (nullable there is the
// DISCLOSED "this engine has no sweeper" — an attached absence, not a bare
// verdict). Plural `sweeps` (the meta census) is deliberately NOT in the
// vocabulary: exact names only.
var sweepEvidenceNames = map[string]bool{"sweep_block": true, "sweep": true}

// The re-clock vocabulary: a schema requiring one of these carries its OWN
// batch/bucket identity, so its rows are pinned to a clock the response
// envelope cannot vouch for.
var reclockNames = map[string]bool{"batch_id": true, "computed_at": true, "bucket_start": true}

// lawViolation is one liquidatable-family property served without sweep
// evidence in scope, deduplicated by (root, schema, property).
type lawViolation struct {
	Root     string // which response surface reaches it
	Schema   string // the component (or inline path) carrying the property
	Property string
	Boolean  bool // true = the verdict class (zero tolerance); false = a derived count
}

func (v lawViolation) key() string {
	return v.Root + " | " + v.Schema + " | " + v.Property
}

// deref resolves a SchemaRef to its schema value, looking through the
// single-member nullable-allOf wrapper the contract uses (`nullable: true,
// allOf: [$ref]`). Returns the resolved schema and the component name if the
// chain passed through a named $ref.
func deref(ref *openapi3.SchemaRef, name string) (*openapi3.Schema, string) {
	if ref == nil || ref.Value == nil {
		return nil, name
	}
	if n, ok := componentName(ref); ok {
		name = n
	}
	s := ref.Value
	// The nullable wrapper: no own type/properties, exactly one allOf member.
	for s != nil && len(s.AllOf) == 1 && len(s.Properties) == 0 && s.Items == nil && (s.Type == nil || len(*s.Type) == 0) {
		inner := s.AllOf[0]
		if inner == nil || inner.Value == nil {
			break
		}
		if n, ok := componentName(inner); ok {
			name = n
		}
		s = inner.Value
	}
	return s, name
}

func componentName(ref *openapi3.SchemaRef) (string, bool) {
	const prefix = "#/components/schemas/"
	if ref != nil && strings.HasPrefix(ref.Ref, prefix) {
		return strings.TrimPrefix(ref.Ref, prefix), true
	}
	return "", false
}

// isBooleanTyped reports whether a property schema is boolean-shaped (looking
// through the nullable wrapper) — the verdict class proper.
func isBooleanTyped(ref *openapi3.SchemaRef) bool {
	s, _ := deref(ref, "")
	return s != nil && s.Type != nil && s.Type.Is(openapi3.TypeBoolean)
}

// attachesSweepEvidence reports whether some chain of REQUIRED properties from
// s (through refs, the nullable wrapper and array items) reaches a required
// property named in sweepEvidenceNames. Only REQUIRED properties count: an
// optional watermark is an assertion a server may omit, not structure.
func attachesSweepEvidence(s *openapi3.Schema, depth int, seen map[*openapi3.Schema]bool) bool {
	if s == nil || depth > 8 || seen[s] {
		return false
	}
	seen[s] = true
	defer delete(seen, s)

	required := map[string]bool{}
	for _, r := range s.Required {
		required[r] = true
	}
	for _, name := range s.Required {
		if sweepEvidenceNames[name] {
			return true
		}
	}
	for name, prop := range s.Properties {
		if !required[name] {
			continue
		}
		child, _ := deref(prop, "")
		if child == nil {
			continue
		}
		// An array chain (Batch.watermarks -> Stamp[]): the items are what the
		// wire serves, so the chain continues through them.
		if child.Items != nil {
			items, _ := deref(child.Items, "")
			if attachesSweepEvidence(items, depth+1, seen) {
				return true
			}
			continue
		}
		if attachesSweepEvidence(child, depth+1, seen) {
			return true
		}
	}
	return false
}

// reclocks reports whether s requires its own batch/bucket identity.
func reclocks(s *openapi3.Schema) bool {
	for _, name := range s.Required {
		if reclockNames[name] {
			return true
		}
	}
	return false
}

// sweepWalk descends one root's schema tree, carrying the licensed bit, and
// records every liquidatable-family property met while unlicensed. reached
// collects every named component schema the walk visits (for the
// orphan-carrier check).
type sweepState struct {
	root       string
	violations map[string]lawViolation
	reached    map[string]bool
}

type visitKey struct {
	s        *openapi3.Schema
	licensed bool
}

func (st *sweepState) walk(ref *openapi3.SchemaRef, name string, licensed bool, depth int, seen map[visitKey]bool) {
	s, name := deref(ref, name)
	if s == nil || depth > 40 {
		return
	}
	k := visitKey{s: s, licensed: licensed}
	if seen[k] {
		return
	}
	seen[k] = true
	if name != "" {
		st.reached[name] = true
	}

	// The licensing transition, in order: attaching wins (a re-clocked schema
	// carrying its OWN watermark is exactly the 1.2.1 AddressHistoryPoint);
	// re-clocking WITHOUT attaching voids any outer vouching.
	if attachesSweepEvidence(s, 0, map[*openapi3.Schema]bool{}) {
		licensed = true
	} else if reclocks(s) {
		licensed = false
	}

	for propName, prop := range s.Properties {
		if liquidatableFamily(propName) && !licensed {
			v := lawViolation{Root: st.root, Schema: name, Property: propName, Boolean: isBooleanTyped(prop)}
			st.violations[v.key()] = v
		}
		childName := name + "." + propName
		st.walk(prop, childName, licensed, depth+1, seen)
	}
	if s.Items != nil {
		st.walk(s.Items, name+"[]", licensed, depth+1, seen)
	}
	for _, group := range [][]*openapi3.SchemaRef{s.AllOf, s.AnyOf, s.OneOf} {
		for _, member := range group {
			st.walk(member, name, licensed, depth+1, seen)
		}
	}
	if s.AdditionalProperties.Schema != nil {
		st.walk(s.AdditionalProperties.Schema, name+".*", licensed, depth+1, seen)
	}
}

// contractRoots enumerates every surface the contract serves: each
// operation's each declared response body (any media type carrying a schema),
// plus the StreamPayload component — the SSE `data:` frames are validated
// against it directly (validateComponent), not through a path response.
func contractRoots(doc *openapi3.T) map[string]*openapi3.SchemaRef {
	roots := map[string]*openapi3.SchemaRef{}
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			if op.Responses == nil {
				continue
			}
			for status, resp := range op.Responses.Map() {
				if resp == nil || resp.Value == nil {
					continue
				}
				for mediaType, mt := range resp.Value.Content {
					if mt.Schema == nil {
						continue
					}
					roots[fmt.Sprintf("%s %s %s %s", method, path, status, mediaType)] = mt.Schema
				}
			}
		}
	}
	if sp, ok := doc.Components.Schemas["StreamPayload"]; ok {
		roots["SSE component:StreamPayload"] = sp
	}
	return roots
}

// sweepContract runs the law over a document and returns the deduplicated
// violation set plus the set of component names reached from any root.
func sweepContract(doc *openapi3.T) ([]lawViolation, map[string]bool) {
	violations := map[string]lawViolation{}
	reached := map[string]bool{}
	for rootName, ref := range contractRoots(doc) {
		st := &sweepState{root: rootName, violations: map[string]lawViolation{}, reached: reached}
		st.walk(ref, "", false, 0, map[visitKey]bool{})
		for k, v := range st.violations {
			violations[k] = v
		}
	}
	return flattenViolations(violations), reached
}

func flattenViolations(m map[string]lawViolation) []lawViolation {
	out := make([]lawViolation, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].key() < out[j].key() })
	return out
}

func TestLiquidatableDisclosureLawSweepsTheWholeContract(t *testing.T) {
	doc := loadContract(t)
	violations, reached := sweepContract(doc)

	// THE HARD LAW — the verdict class. A boolean liquidatable-family field
	// without structural sweep evidence collapses the MOTION license; there is
	// no pin for this class and never will be.
	var booleans []string
	for _, v := range violations {
		if v.Boolean {
			booleans = append(booleans, v.key())
		}
	}
	require.Empty(t, booleans,
		"BARE BOOLEAN VERDICT(S) in the contract: a DM liquidatable boolean is served without its sweep watermark structurally attached — 'any surface serving the bare boolean collapses the license'")

	// THE PINNED STANDING GAPS — the derived-count class, EXACT set equality.
	// All three are `liquidatable_positions` (integer) on self-clocked or
	// unstamped surfaces: the observatory point (its own batch_id clock, no
	// sweep stamp), the observatory series bucket (bucket clock, balances
	// watermark only) and the batch permalink's aggregate (the batch's own
	// clock, no watermark vector). REPORTED as contract disclosure gaps —
	// pinned so they can neither grow nor silently vanish.
	got := map[string]bool{}
	for _, v := range violations {
		got[v.key()] = true
	}
	want := map[string]bool{}
	for _, k := range []string{
		"GET /v1/observatory 200 application/json | Aggregate | liquidatable_positions",
		"GET /v1/observatory/series 200 application/json | ObservatorySeriesPoint | liquidatable_positions",
		"GET /v1/batches/{id} 200 application/json | BatchAggregate | liquidatable_positions",
	} {
		want[k] = true
	}
	require.Equal(t, want, got,
		"the standing-gap pin no longer matches the sweep: a NEW liquidatable-family field is being served without sweep evidence (fix the contract, never the pin), or a pinned gap was fixed (shrink the pin deliberately)")

	// ORPHAN-CARRIER CHECK: every component schema carrying a
	// liquidatable-family property must be reachable from some served root —
	// an unreachable carrier is a schema waiting to be wired bare.
	for schemaName, ref := range doc.Components.Schemas {
		s, _ := deref(ref, schemaName)
		if s == nil {
			continue
		}
		for propName := range s.Properties {
			if liquidatableFamily(propName) {
				require.True(t, reached[schemaName],
					"component %s carries liquidatable-family field %q but is reachable from NO served response — wire it under the law or remove it", schemaName, propName)
			}
		}
	}
}

// TestLiquidatableDisclosureLawCatchesABareBoolean is the sweep's
// anti-vacuity control AND the designed-mutant kill (wave-h4b m2): a
// synthetic re-clocked row schema carrying a bare `liquidatable` boolean is
// injected into a FRESH copy of the contract, under a response that DOES
// carry the batch envelope — proving the envelope cannot vouch past a
// re-clock, and that the sweep finds schemas no inventory ever named. A
// sweep narrowed to a hand-list of today's schema names cannot flag the
// fixture and fails here.
func TestLiquidatableDisclosureLawCatchesABareBoolean(t *testing.T) {
	doc := loadFreshContract(t)

	boolTrue := true
	fixture := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"batch_id", "liquidatable"},
		Properties: openapi3.Schemas{
			"batch_id":     openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}}),
			"liquidatable": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeBoolean}, Nullable: boolTrue}),
		},
	}
	doc.Components.Schemas["BareVerdictFixture"] = openapi3.NewSchemaRef("", fixture)

	batchRef, ok := doc.Components.Schemas["Batch"]
	require.True(t, ok, "the contract must declare the Batch envelope")
	envelope := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"batch", "rows"},
		Properties: openapi3.Schemas{
			"batch": openapi3.NewSchemaRef("#/components/schemas/Batch", batchRef.Value),
			"rows": openapi3.NewSchemaRef("", &openapi3.Schema{
				Type:  &openapi3.Types{openapi3.TypeArray},
				Items: openapi3.NewSchemaRef("#/components/schemas/BareVerdictFixture", fixture),
			}),
		},
	}

	violations := sweepExtraRoot(doc, "GET /v1/__bare_fixture 200 application/json", openapi3.NewSchemaRef("", envelope))
	var hit *lawViolation
	for i, v := range violations {
		if v.Schema == "BareVerdictFixture" && v.Property == "liquidatable" {
			hit = &violations[i]
		}
	}
	require.NotNil(t, hit,
		"the sweep did NOT flag a synthetic re-clocked schema carrying a bare boolean under a batch-bearing response — the mechanical walk has been narrowed to an inventory")
	require.True(t, hit.Boolean, "the fixture violation is the verdict class — the zero-tolerance arm")

	// And the positive control's mirror: the SAME fixture WITH the required
	// per-row watermark is licensed — the law demands evidence, not a ban.
	fixture.Required = append(fixture.Required, "sweep_block")
	fixture.Properties["sweep_block"] = openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}})
	violations = sweepExtraRoot(doc, "GET /v1/__bare_fixture 200 application/json", openapi3.NewSchemaRef("", envelope))
	for _, v := range violations {
		require.NotEqual(t, "BareVerdictFixture", v.Schema,
			"a re-clocked row that REQUIRES its own sweep_block satisfies the law and must not be flagged")
	}
}

// TestLiquidatableDisclosureLawDerivesTheCodexFinding regression-pins the law
// against the exact 1.2.0 defect: strip `sweep_block` from
// AddressHistoryPoint's required set on a fresh copy and the sweep must
// reproduce Codex's HIGH — the mixed-clock boolean on the history wire.
func TestLiquidatableDisclosureLawDerivesTheCodexFinding(t *testing.T) {
	doc := loadFreshContract(t)
	point, ok := doc.Components.Schemas["AddressHistoryPoint"]
	require.True(t, ok)
	var stripped []string
	for _, r := range point.Value.Required {
		if r != "sweep_block" {
			stripped = append(stripped, r)
		}
	}
	require.Len(t, stripped, len(point.Value.Required)-1, "1.2.1 must REQUIRE sweep_block on AddressHistoryPoint")
	point.Value.Required = stripped

	violations, _ := sweepContract(doc)
	found := false
	for _, v := range violations {
		if v.Schema == "AddressHistoryPoint" && v.Property == "liquidatable" && v.Boolean {
			found = true
		}
	}
	require.True(t, found,
		"with sweep_block un-required, the sweep must re-derive the 1.2.0 finding: AddressHistoryPoint serves a bare mixed-clock boolean despite the response-level batch envelope")
}

// loadFreshContract parses api/openapi.yaml into a NEW document the test may
// mutate — never the shared cached one.
func loadFreshContract(t *testing.T) *openapi3.T {
	t.Helper()
	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = false
	doc, err := loader.LoadFromFile(contractPathFromTests())
	require.NoError(t, err)
	return doc
}

func contractPathFromTests() string {
	return "../../api/openapi.yaml"
}

// sweepExtraRoot runs the walk over one additional root on top of the
// document's own roots and returns only the violations that root produced.
func sweepExtraRoot(doc *openapi3.T, rootName string, ref *openapi3.SchemaRef) []lawViolation {
	st := &sweepState{root: rootName, violations: map[string]lawViolation{}, reached: map[string]bool{}}
	st.walk(ref, "", false, 0, map[visitKey]bool{})
	return flattenViolations(st.violations)
}
