package main

// GET /v1/scenarios — the pure half: the CONTRACT weld and the SERIALIZER
// weld.
//
// The live-database half (cold start, and the wire-level weld against the
// stress array) is in scenarios_db_test.go. What lives here needs no database
// because neither the committed scenario set nor the contract does: both are
// bytes this binary was built with.

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/require"
)

// TestScenarioListingReusesTheStressSerializerByConstruction is the SERIALIZER
// half of the weld, and the half that holds even when nobody runs a database.
//
// The wire-level weld in scenarios_db_test.go proves the two surfaces agree
// TODAY. This one proves they cannot disagree TOMORROW without someone
// deliberately breaking the type: the stress element embeds the listing's
// element type, so a field added to the definition lands on both surfaces at
// once, and a field added to only one CANNOT be added to the definition at all.
//
// A hand-forked listing serializer — a second struct with copied fields — fails
// here on the type identity, before any value is even compared.
func TestScenarioListingReusesTheStressSerializerByConstruction(t *testing.T) {
	def := reflect.TypeOf(wireScenarioDef{})
	stress := reflect.TypeOf(wireScenario{})

	require.Equal(t, 2, stress.NumField(),
		"the stress element must be exactly the committed definition PLUS results — a third field is a field one surface has and the other does not")
	require.True(t, stress.Field(0).Anonymous,
		"the committed half must be EMBEDDED, not copied: a copy is a second serializer wearing the first one's field names")
	require.Equal(t, def, stress.Field(0).Type,
		"the stress element must embed the LISTING's own type — not a look-alike")
	require.Equal(t, "results", stress.Field(1).Tag.Get("json"))

	listed, ok := reflect.TypeOf(scenariosResponse{}).FieldByName("Scenarios")
	require.True(t, ok, "the listing response must carry a Scenarios field")
	require.Equal(t, reflect.SliceOf(def), listed.Type,
		"the listing must serve the SAME type the stress element embeds")

	// And at the JSON layer, where a `omitempty` or a renamed tag would still
	// slip past the type check: the stress object's keys are the listing
	// object's keys plus `results`, for a scenario that exercises the optional
	// per-shock `asset` field.
	s := fxServer(t)
	sc, ok := s.byID["ethfi_minus_50"]
	require.True(t, ok, "the committed set must contain an asset-axis scenario, or the omitempty path is untested here")
	d := scenarioDefinition(sc)
	require.NotEmpty(t, d.Shocks[0].Asset, "the chosen scenario must carry a per-shock asset")

	defKeys := jsonKeys(t, d)
	stressKeys := jsonKeys(t, wireScenario{wireScenarioDef: d, Results: []wireScenarioResult{}})
	require.Equal(t, append(append([]string{}, defKeys...), "results"), stressKeys,
		"on the wire the stress object must be the listing object plus exactly one key")
}

// TestScenariosContractExampleIsByteFaithful holds the contract's published
// example to the SERIALIZER's actual output.
//
// An example is documentation a consumer builds against before they ever call
// the service, and a hand-typed one drifts silently — the reader then codes
// against a shape the server does not serve and discovers it in production.
// Every scenario entry in the example must therefore be, field for field, what
// `scenarioDefinition` produces for that committed id, and the example's notes
// and version token must be the handler's own.
func TestScenariosContractExampleIsByteFaithful(t *testing.T) {
	doc := loadContract(t)
	item := doc.Paths.Find("/v1/scenarios")
	require.NotNil(t, item, "the contract must declare GET /v1/scenarios")
	require.NotNil(t, item.Get)
	resp := item.Get.Responses.Status(200)
	require.NotNil(t, resp)
	mt := resp.Value.Content.Get("application/json")
	require.NotNil(t, mt)
	require.NotNil(t, mt.Example, "the /v1/scenarios response must carry an example — this contract documents by example")

	example, ok := mt.Example.(map[string]any)
	require.True(t, ok, "the example must be an object, got %T", mt.Example)

	// It is a VALID response first — an example that does not satisfy its own
	// schema teaches a shape the server may not serve.
	require.NoError(t, mt.Schema.Value.VisitJSON(example, openapi3.MultiErrors()),
		"the published example violates its own schema")

	s := fxServer(t)
	require.Equal(t, s.scenarioConfigVersion(), example["scenario_config_version"],
		"the example's version token must be the one this build actually serves")
	require.Equal(t, anySlice(scenarioListingNotes()), example["notes"],
		"the example's notes must be the handler's own notes, verbatim")

	entries, ok := example["scenarios"].([]any)
	require.True(t, ok)
	require.NotEmpty(t, entries, "an example listing with no scenarios documents nothing")

	withAsset, withoutAsset := false, false
	for i, e := range entries {
		got, ok := e.(map[string]any)
		require.True(t, ok, "example entry %d is not an object", i)
		id, _ := got["id"].(string)
		sc, known := s.byID[id]
		require.True(t, known,
			"example entry %d names scenario %q, which is not in the committed set — the example must describe scenarios that exist", i, id)
		require.Equal(t, jsonRoundTrip(t, scenarioDefinition(sc)), got,
			"example entry %q is not what the serializer produces for it", id)

		for _, sh := range sc.Shocks {
			if sh.Asset == "" {
				withoutAsset = true
			} else {
				withAsset = true
			}
		}
	}
	// Both shock shapes: `asset` is omitempty, so an example carrying only one
	// of them would leave the other undocumented.
	require.True(t, withAsset && withoutAsset,
		"the example must show a shock WITH a per-asset target and one WITHOUT — `asset` is optional and both shapes are served")
}

// jsonKeys marshals a value and returns its top-level keys, in wire order.
func jsonKeys(t *testing.T, v any) []string {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	dec := json.NewDecoder(strings.NewReader(string(b)))
	tok, err := dec.Token()
	require.NoError(t, err)
	require.Equal(t, json.Delim('{'), tok)
	var out []string
	for dec.More() {
		key, err := dec.Token()
		require.NoError(t, err)
		out = append(out, key.(string))
		var discard json.RawMessage
		require.NoError(t, dec.Decode(&discard))
	}
	return out
}

// jsonRoundTrip renders a value the way the wire renders it, then decodes it
// into the generic shape the contract's parsed example carries — so the two are
// compared as JSON documents rather than as Go types.
func jsonRoundTrip(t *testing.T, v any) map[string]any {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	var out map[string]any
	require.NoError(t, json.Unmarshal(b, &out))
	return out
}

func anySlice(in []string) []any {
	out := make([]any, 0, len(in))
	for _, v := range in {
		out = append(out, v)
	}
	return out
}

// TestContractScenarioDefinitionIsTheStressScenarioMinusResults is the
// CONTRACT half of the weld.
//
// The Go serializer cannot drift (one function, one type, embedded — see
// TestScenarioListingReusesTheStressSerializerByConstruction), but the
// CONTRACT can: `ScenarioDefinition` and `Scenario` are two hand-written
// schemas, and a field added to one and forgotten on the other publishes two
// different descriptions of one committed definition. The generated client is
// built from those schemas, so the drift would land in consumers' types.
//
// The law: `ScenarioDefinition` is `Scenario` MINUS `results` — same property
// names, same required set, and each shared property's schema byte-identical.
func TestContractScenarioDefinitionIsTheStressScenarioMinusResults(t *testing.T) {
	doc := loadContract(t)

	defRef, ok := doc.Components.Schemas["ScenarioDefinition"]
	require.True(t, ok, "contract 1.4.0 must declare ScenarioDefinition — the committed-set half of a scenario, which /v1/scenarios serves alone")
	scRef, ok := doc.Components.Schemas["Scenario"]
	require.True(t, ok, "the contract must declare Scenario — the stress array's element")

	def, sc := defRef.Value, scRef.Value
	require.NotNil(t, def)
	require.NotNil(t, sc)

	require.Equal(t, minus(propertyNames(sc), "results"), propertyNames(def),
		"ScenarioDefinition's properties must be Scenario's minus `results` — a field on one and not the other is two published descriptions of ONE committed definition")
	require.Equal(t, minus(sorted(sc.Required), "results"), sorted(def.Required),
		"the required sets must agree too: an optional-here/required-there field is the same drift wearing a weaker shape")

	// `results` is the ONLY difference, and it must genuinely be there — a
	// Scenario that had lost its results array would satisfy the two checks
	// above vacuously.
	require.Contains(t, sc.Properties, "results",
		"Scenario must carry the per-address results array, or the two schemas are the same schema and this weld proves nothing")

	for _, name := range propertyNames(def) {
		require.Equal(t, marshalRef(t, sc.Properties[name]), marshalRef(t, def.Properties[name]),
			"property %q is described differently on Scenario and ScenarioDefinition", name)
	}

	// Both objects stay closed, per the contract's own header law.
	require.NotNil(t, def.AdditionalProperties.Has)
	require.False(t, *def.AdditionalProperties.Has,
		"every object in this contract sets additionalProperties: false — a permissive schema cannot detect drift")
}

func propertyNames(s *openapi3.Schema) []string {
	out := make([]string, 0, len(s.Properties))
	for name := range s.Properties {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func sorted(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func minus(in []string, drop string) []string {
	out := make([]string, 0, len(in))
	for _, v := range in {
		if v != drop {
			out = append(out, v)
		}
	}
	return out
}

func marshalRef(t *testing.T, ref *openapi3.SchemaRef) string {
	t.Helper()
	require.NotNil(t, ref)
	b, err := json.Marshal(ref)
	require.NoError(t, err)
	return string(b)
}
