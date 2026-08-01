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
// # Zero gaps, both classes (wave H5b)
//
// Wave H4b's sweep found three STANDING violations on the derived COUNT
// class (`liquidatable_positions` on the observatory point, the observatory
// series bucket and the batch permalink's aggregate) and pinned them as an
// exact set. Wave H5b closed all three in contract 1.2.2 (Codex round-4
// finding 2: ObservatoryPoint gained its batch's `watermarks` vector,
// ObservatorySeriesPoint and BatchAggregate gained `sweep`) and the pin
// shrank to EMPTY. The walk now admits ZERO violations of either class, and
// this file also holds the walker itself to structure (finding 3): a
// licensing chain refuses NULLABLE intermediate hops and refuses arrays the
// contract does not require non-empty (minItems >= 1) — `watermarks: null`
// and `watermarks: []` both satisfy `required: [watermarks]`, and neither is
// evidence.

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
//
// # Carrier hops are held to structure, not to names (wave H5b, Codex round-4
// finding 3)
//
// The TERMINAL of a chain may be nullable — `Stamp.sweep: null` is the
// DISCLOSED "this engine has no sweeper", an attached absence. But an
// INTERMEDIATE hop that can vanish is no evidence at all, and the walk
// refuses to license through one:
//
//   - a NULLABLE hop voids the chain: a server may serve `null` there and
//     every field "required" beneath it evaporates while the walk still
//     counted it (`watermarks: null` satisfies `required: [watermarks]`);
//   - an ARRAY hop licenses only when the contract REQUIRES it non-empty
//     (minItems >= 1): `watermarks: []` also satisfies `required:
//     [watermarks]`, and an empty vector is a licence with no evidence
//     behind it. The cardinality must live in the CONTRACT — a walker that
//     merely assumed non-emptiness would green a contract whose servers may
//     legally serve the empty array.
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
		// The nullable-hop check runs BEFORE deref: the contract's nullable
		// wrapper (`nullable: true, allOf: [$ref]`) carries its nullability on
		// the outer node, which deref looks through.
		if prop != nil && prop.Value != nil && prop.Value.Nullable {
			continue
		}
		child, _ := deref(prop, "")
		if child == nil || child.Nullable {
			continue
		}
		// An array chain (Batch.watermarks -> Stamp[]): the items are what the
		// wire serves, so the chain continues through them — but only when the
		// contract requires the array non-empty, and only through non-nullable
		// items.
		if child.Items != nil {
			if child.MinItems < 1 {
				continue
			}
			if child.Items.Value != nil && child.Items.Value.Nullable {
				continue
			}
			items, _ := deref(child.Items, "")
			if items == nil || items.Nullable {
				continue
			}
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

// allOfArm is one member of a flattened allOf composition: the schema plus
// the component name the walk attributes its properties to.
type allOfArm struct {
	s    *openapi3.Schema
	name string
}

// flattenAllOf returns s followed by every schema reachable through nested
// allOf membership (through refs and the nullable wrapper), each paired with
// its own component name. allOf is COMPOSITION — every arm's properties land
// on the SAME wire object — so the walk analyzes the arms as one merged
// object (wave H6b, Codex round-5 finding 4). The cycle guard is on schema
// identity; a single-member nullable wrapper among the members is collapsed
// by deref before the member is recorded, exactly as everywhere else.
func flattenAllOf(s *openapi3.Schema, name string, seen map[*openapi3.Schema]bool) []allOfArm {
	if s == nil || seen[s] {
		return nil
	}
	seen[s] = true
	arms := []allOfArm{{s: s, name: name}}
	for _, member := range s.AllOf {
		m, mName := deref(member, name)
		arms = append(arms, flattenAllOf(m, mName, seen)...)
	}
	return arms
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

	// allOf IS COMPOSITION, AND THE ANALYSIS IS OVER THE MERGED OBJECT (wave
	// H6b, Codex round-5 finding 4). A per-arm walk let a schema split
	// `batch_id` into one arm and a bare liquidatable count into a sibling
	// arm: no single arm both re-clocked and carried the count, so the
	// count-bearing arm kept the outer envelope's license and the law
	// greened vacuously — while the merged wire object is self-clocked and
	// serves the count bare. Required properties and re-clock fields
	// therefore apply across ALL arms before any descent. (oneOf/anyOf stay
	// per-arm below, deliberately: union arms are ALTERNATIVE values, and a
	// consumer holding one arm has only that arm's evidence in hand.)
	arms := flattenAllOf(s, name, map[*openapi3.Schema]bool{})
	merged := &openapi3.Schema{Properties: openapi3.Schemas{}}
	for _, a := range arms {
		if a.name != "" {
			st.reached[a.name] = true
		}
		merged.Required = append(merged.Required, a.s.Required...)
		for propName, prop := range a.s.Properties {
			if _, dup := merged.Properties[propName]; !dup {
				merged.Properties[propName] = prop
			}
		}
	}

	// The licensing transition, in order, over the MERGED object: attaching
	// wins (a re-clocked schema carrying its OWN watermark is exactly the
	// 1.2.1 AddressHistoryPoint); re-clocking WITHOUT attaching voids any
	// outer vouching.
	if attachesSweepEvidence(merged, 0, map[*openapi3.Schema]bool{}) {
		licensed = true
	} else if reclocks(merged) {
		licensed = false
	}

	// One wire object, one visit per property name: the first declaring arm
	// carries the attribution (the outer schema is arm zero).
	visited := map[string]bool{}
	for _, a := range arms {
		for propName, prop := range a.s.Properties {
			if visited[propName] {
				continue
			}
			visited[propName] = true
			if liquidatableFamily(propName) && !licensed {
				v := lawViolation{Root: st.root, Schema: a.name, Property: propName, Boolean: isBooleanTyped(prop)}
				st.violations[v.key()] = v
			}
			st.walk(prop, a.name+"."+propName, licensed, depth+1, seen)
		}
		if a.s.Items != nil {
			st.walk(a.s.Items, a.name+"[]", licensed, depth+1, seen)
		}
		for _, group := range [][]*openapi3.SchemaRef{a.s.AnyOf, a.s.OneOf} {
			for _, member := range group {
				st.walk(member, a.name, licensed, depth+1, seen)
			}
		}
		if a.s.AdditionalProperties.Schema != nil {
			st.walk(a.s.AdditionalProperties.Schema, a.name+".*", licensed, depth+1, seen)
		}
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

	// ZERO STANDING GAPS — the derived-count class too. Wave H4b pinned three
	// count-class violations (the observatory point's Aggregate, the
	// observatory series bucket, the batch permalink's aggregate — all
	// `liquidatable_positions` on self-clocked surfaces with no sweep stamp);
	// wave H5b closed all three in 1.2.2 (ObservatoryPoint.watermarks,
	// ObservatorySeriesPoint.sweep, BatchAggregate.sweep — Codex round-4
	// finding 2) and the pin shrank to EMPTY, deliberately. From here the law
	// admits no violation of either class: a count without its sweep clock is
	// the same mixed-clock lie as a bare boolean, only aggregated.
	var gaps []string
	for _, v := range violations {
		gaps = append(gaps, v.key())
	}
	require.Empty(t, gaps,
		"liquidatable-family field(s) served without sweep evidence in scope: the contract closed this class in 1.2.2 (wave H5b) and it stays closed — attach the sweep watermark to the new surface (fix the contract, never this test)")

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

// hitsSchema reports whether the violation set flags (schema, property).
func hitsSchema(violations []lawViolation, schema, property string) bool {
	for _, v := range violations {
		if v.Schema == schema && v.Property == property {
			return true
		}
	}
	return false
}

// TestLiquidatableDisclosureLawRefusesAnEmptyableWatermarkArray is finding
// 3's cardinality control (wave H5b): `watermarks: []` satisfies `required:
// [watermarks]`, so an envelope whose watermark array the contract does NOT
// require non-empty (no minItems) is a licence with no evidence behind it —
// the walker must refuse to license through it, and must license the SAME
// shape once minItems >= 1 makes the evidence structural. This is also the
// regression pin on Batch.watermarks' own minItems: the walker half of the
// law is only honest while the contract half carries the cardinality.
func TestLiquidatableDisclosureLawRefusesAnEmptyableWatermarkArray(t *testing.T) {
	doc := loadFreshContract(t)

	stampRef, ok := doc.Components.Schemas["Stamp"]
	require.True(t, ok, "the contract must declare the Stamp schema")

	row := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"liquidatable_positions"},
		Properties: openapi3.Schemas{
			"liquidatable_positions": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}}),
		},
	}
	doc.Components.Schemas["EmptyableCarrierRowFixture"] = openapi3.NewSchemaRef("", row)

	watermarks := &openapi3.Schema{
		Type:  &openapi3.Types{openapi3.TypeArray},
		Items: openapi3.NewSchemaRef("#/components/schemas/Stamp", stampRef.Value),
		// NO MinItems: the servable empty vector — the defect under test.
	}
	envelope := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"watermarks", "rows"},
		Properties: openapi3.Schemas{
			"watermarks": openapi3.NewSchemaRef("", watermarks),
			"rows": openapi3.NewSchemaRef("", &openapi3.Schema{
				Type:  &openapi3.Types{openapi3.TypeArray},
				Items: openapi3.NewSchemaRef("#/components/schemas/EmptyableCarrierRowFixture", row),
			}),
		},
	}

	violations := sweepExtraRoot(doc, "GET /v1/__emptyable_carrier 200 application/json", openapi3.NewSchemaRef("", envelope))
	require.True(t, hitsSchema(violations, "EmptyableCarrierRowFixture", "liquidatable_positions"),
		"a required watermark array WITHOUT minItems licensed the subtree: `watermarks: []` satisfies the requirement, so the walker granted a licence a server can legally serve no evidence for")

	// The positive mirror: the same envelope with the cardinality in the
	// contract IS evidence, and the law demands evidence, not a ban.
	watermarks.MinItems = 1
	violations = sweepExtraRoot(doc, "GET /v1/__emptyable_carrier 200 application/json", openapi3.NewSchemaRef("", envelope))
	require.False(t, hitsSchema(violations, "EmptyableCarrierRowFixture", "liquidatable_positions"),
		"with minItems >= 1 the watermark vector is structurally non-empty and must license the subtree")
}

// TestLiquidatableDisclosureLawRefusesANullableCarrierHop is finding 3's
// nullable-hop control (wave H5b): a REQUIRED but NULLABLE carrier satisfies
// its requirement with `null`, so every sweep field beneath it may legally
// vanish — licensing through it is void. The TERMINAL may still be nullable
// (`Stamp.sweep: null` is the disclosed "no sweeper" absence); only the hops
// must be solid.
func TestLiquidatableDisclosureLawRefusesANullableCarrierHop(t *testing.T) {
	doc := loadFreshContract(t)

	carrier := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"sweep_block"},
		Properties: openapi3.Schemas{
			"sweep_block": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}}),
		},
	}
	doc.Components.Schemas["NullableCarrierFixture"] = openapi3.NewSchemaRef("", carrier)

	point := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"as_of", "liquidatable"},
		Properties: openapi3.Schemas{
			// The contract's nullable-wrapper form: nullable on the OUTER node,
			// the evidence one $ref beneath it.
			"as_of": openapi3.NewSchemaRef("", &openapi3.Schema{
				Nullable: true,
				AllOf:    openapi3.SchemaRefs{openapi3.NewSchemaRef("#/components/schemas/NullableCarrierFixture", carrier)},
			}),
			"liquidatable": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeBoolean}}),
		},
	}
	doc.Components.Schemas["NullableCarrierPointFixture"] = openapi3.NewSchemaRef("", point)

	root := openapi3.NewSchemaRef("#/components/schemas/NullableCarrierPointFixture", point)
	violations := sweepExtraRoot(doc, "GET /v1/__nullable_carrier 200 application/json", root)
	require.True(t, hitsSchema(violations, "NullableCarrierPointFixture", "liquidatable"),
		"a NULLABLE required carrier licensed the subtree: `as_of: null` satisfies the requirement and takes the sweep evidence with it — the boolean beside it is bare")

	// The positive mirror: the identical chain with a solid hop licenses.
	point.Properties["as_of"] = openapi3.NewSchemaRef("#/components/schemas/NullableCarrierFixture", carrier)
	violations = sweepExtraRoot(doc, "GET /v1/__nullable_carrier 200 application/json", root)
	require.False(t, hitsSchema(violations, "NullableCarrierPointFixture", "liquidatable"),
		"a non-nullable required carrier reaching sweep_block is exactly the Position.as_of form and must license")
}

// TestLiquidatableDisclosureLawChecksEachUnionArmIndependently is finding 3's
// per-union-arm control (wave H5b): one arm's sweep evidence must never leak
// a licence to a sibling arm — a consumer holding the OTHER arm's value has
// no watermark in hand.
func TestLiquidatableDisclosureLawChecksEachUnionArmIndependently(t *testing.T) {
	doc := loadFreshContract(t)

	licensed := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"sweep_block", "liquidatable"},
		Properties: openapi3.Schemas{
			"sweep_block":  openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}}),
			"liquidatable": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeBoolean}}),
		},
	}
	bare := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"liquidatable"},
		Properties: openapi3.Schemas{
			"liquidatable": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeBoolean}}),
		},
	}
	doc.Components.Schemas["LicensedArmFixture"] = openapi3.NewSchemaRef("", licensed)
	doc.Components.Schemas["BareArmFixture"] = openapi3.NewSchemaRef("", bare)

	union := &openapi3.Schema{
		OneOf: openapi3.SchemaRefs{
			openapi3.NewSchemaRef("#/components/schemas/LicensedArmFixture", licensed),
			openapi3.NewSchemaRef("#/components/schemas/BareArmFixture", bare),
		},
	}

	violations := sweepExtraRoot(doc, "GET /v1/__union_arms 200 application/json", openapi3.NewSchemaRef("", union))
	require.False(t, hitsSchema(violations, "LicensedArmFixture", "liquidatable"),
		"the arm that carries its own required sweep_block satisfies the law")
	require.True(t, hitsSchema(violations, "BareArmFixture", "liquidatable"),
		"the bare arm must be flagged: its sibling's evidence is not in the consumer's hands when THIS arm is the value on the wire")
}

// TestLiquidatableDisclosureLawMergesAllOfArmsBeforeLicensing is wave H6b's
// sibling-arm control (Codex round-5 finding 4): allOf is COMPOSITION, not
// choice — every arm's properties land on the SAME wire object, so the
// analysis must apply required properties and re-clock fields across the
// MERGED object before descending. A schema that places `batch_id` in one
// allOf arm and a bare `liquidatable_positions` in a sibling arm is, merged,
// a self-clocked row serving a count with no sweep evidence — the same
// mixed-clock defect as AddressHistoryPoint under 1.2.0, merely split across
// arms. A walker that detects the re-clock only from each node's OWN
// Required list and then visits each arm independently with the inherited
// license never sees the two facts in one place: the clock arm re-clocks
// (and carries no count), the count arm keeps the outer envelope's license,
// and the law greens vacuously. This is the designed-mutant kill for
// wave-h6b M3 (per-arm analysis restored).
//
// Note the asymmetry with oneOf/anyOf (the union-arm control above): union
// arms are ALTERNATIVE values and must be judged independently, because a
// consumer holds only one arm's value; allOf arms are ONE value and must be
// judged jointly, because a consumer holds all of them at once.
func TestLiquidatableDisclosureLawMergesAllOfArmsBeforeLicensing(t *testing.T) {
	doc := loadFreshContract(t)

	clockArm := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"batch_id"},
		Properties: openapi3.Schemas{
			"batch_id": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}}),
		},
	}
	countArm := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"liquidatable_positions"},
		Properties: openapi3.Schemas{
			"liquidatable_positions": openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}}),
		},
	}
	doc.Components.Schemas["SplitClockArmFixture"] = openapi3.NewSchemaRef("", clockArm)
	doc.Components.Schemas["SplitCountArmFixture"] = openapi3.NewSchemaRef("", countArm)

	row := &openapi3.Schema{
		AllOf: openapi3.SchemaRefs{
			openapi3.NewSchemaRef("#/components/schemas/SplitClockArmFixture", clockArm),
			openapi3.NewSchemaRef("#/components/schemas/SplitCountArmFixture", countArm),
		},
	}

	// Under a response that DOES carry the batch envelope, exactly like the
	// bare-boolean control: the licence the merged re-clock must void is
	// really in force when the walk reaches the rows.
	batchRef, ok := doc.Components.Schemas["Batch"]
	require.True(t, ok, "the contract must declare the Batch envelope")
	envelope := &openapi3.Schema{
		Type:     &openapi3.Types{openapi3.TypeObject},
		Required: []string{"batch", "rows"},
		Properties: openapi3.Schemas{
			"batch": openapi3.NewSchemaRef("#/components/schemas/Batch", batchRef.Value),
			"rows": openapi3.NewSchemaRef("", &openapi3.Schema{
				Type:  &openapi3.Types{openapi3.TypeArray},
				Items: openapi3.NewSchemaRef("", row),
			}),
		},
	}

	violations := sweepExtraRoot(doc, "GET /v1/__split_clock 200 application/json", openapi3.NewSchemaRef("", envelope))
	require.True(t, hitsSchema(violations, "SplitCountArmFixture", "liquidatable_positions"),
		"the count split into a sibling allOf arm was NOT flagged: the merged object requires batch_id, so it is self-clocked and the outer envelope cannot vouch for it — a per-arm walk has bypassed the exhaustive law")

	// The positive mirror: the SAME split composition whose clock arm also
	// REQUIRES its own sweep_block is the AddressHistoryPoint form merely
	// composed — the merged object attaches, and the law demands evidence,
	// not a ban on composition.
	clockArm.Required = append(clockArm.Required, "sweep_block")
	clockArm.Properties["sweep_block"] = openapi3.NewSchemaRef("", &openapi3.Schema{Type: &openapi3.Types{openapi3.TypeInteger}})
	violations = sweepExtraRoot(doc, "GET /v1/__split_clock 200 application/json", openapi3.NewSchemaRef("", envelope))
	require.False(t, hitsSchema(violations, "SplitCountArmFixture", "liquidatable_positions"),
		"a composed row whose merged required set reaches sweep_block satisfies the law and must not be flagged")
}
