package store

// THE TOTALITY WELD (P5 Task B1). The display vocabulary in p5_events.go
// must be a TOTAL function over the two closed per-engine event_type sets —
// and "total" is enforced against the DERIVERS' OWN SOURCE, not against a
// hand-copied list that would go stale silently.
//
// store cannot import internal/derive (derive imports store), so the weld
// PARSES the derive sources with go/ast:
//
//   * aave.go — every `aaveEvent(l, seq, <type>, …)` call site's third
//     argument (string literal, or the store.AaveCollateral*Event selector
//     resolved against this package's own constants), plus the
//     AaveEngineName constant;
//   * debtmanager.go — every `dmEv*` constant's value, plus dmEngineName.
//
// The assertions are EXACT SET EQUALITY in both directions: a raw type the
// deriver emits but the vocabulary does not classify FAILS (an unmapped
// event would vanish from the feed unexplained), and a vocabulary entry the
// deriver no longer emits FAILS too (a phantom filter is a lie about the
// data). The engine-name constants are welded the same way.
//
// Residual risk, stated: a future deriver that emits a position event
// WITHOUT going through aaveEvent / a dmEv* constant would escape this
// extraction. The extractors therefore refuse loudly on any aaveEvent
// argument shape they cannot resolve, and assert non-empty results, so the
// known emission paths cannot silently produce zero coverage.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// storeEventConstants resolves `store.<Name>` selectors used as aaveEvent
// type arguments to this package's own constant values. Extend it when the
// deriver starts referencing another store-owned event-type constant.
var storeEventConstants = map[string]string{
	"AaveCollateralEnabledEvent":  AaveCollateralEnabledEvent,
	"AaveCollateralDisabledEvent": AaveCollateralDisabledEvent,
}

func parseDeriveFile(t *testing.T, name string) *ast.File {
	t.Helper()
	path := filepath.Join("..", "derive", name)
	f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	require.NoError(t, err, "parse %s (the weld needs the deriver source)", path)
	return f
}

// constValue finds a top-level `const <name> = "<value>"` in the file.
func constValue(t *testing.T, f *ast.File, name string) string {
	t.Helper()
	var out string
	found := false
	for _, decl := range f.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.CONST {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, ident := range vs.Names {
				if ident.Name != name || i >= len(vs.Values) {
					continue
				}
				lit, ok := vs.Values[i].(*ast.BasicLit)
				require.True(t, ok && lit.Kind == token.STRING, "const %s is not a string literal", name)
				v, err := strconv.Unquote(lit.Value)
				require.NoError(t, err)
				out, found = v, true
			}
		}
	}
	require.True(t, found, "const %s not found in deriver source", name)
	return out
}

// extractAaveEventTypes collects the closed Aave set from every aaveEvent
// call site.
func extractAaveEventTypes(t *testing.T, f *ast.File) map[string]bool {
	t.Helper()
	types := map[string]bool{}
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		fn, ok := call.Fun.(*ast.Ident)
		if !ok || fn.Name != "aaveEvent" {
			return true
		}
		require.GreaterOrEqual(t, len(call.Args), 3, "aaveEvent call with fewer than 3 args — the extractor no longer matches the deriver")
		switch arg := call.Args[2].(type) {
		case *ast.BasicLit:
			require.Equal(t, token.STRING, arg.Kind, "aaveEvent type argument is not a string literal")
			v, err := strconv.Unquote(arg.Value)
			require.NoError(t, err)
			types[v] = true
		case *ast.SelectorExpr:
			x, ok := arg.X.(*ast.Ident)
			require.True(t, ok && x.Name == "store", "aaveEvent type argument selector %v is not store.<Const> — extend the weld", arg)
			v, ok := storeEventConstants[arg.Sel.Name]
			require.True(t, ok, "aaveEvent references store.%s, which storeEventConstants does not resolve — extend the weld", arg.Sel.Name)
			types[v] = true
		default:
			t.Fatalf("aaveEvent type argument has shape %T the weld cannot resolve — extend the extractor, never skip", arg)
		}
		return true
	})
	return types
}

// extractDMEventTypes collects the closed Debt Manager set from the dmEv*
// constant block.
func extractDMEventTypes(t *testing.T, f *ast.File) map[string]bool {
	t.Helper()
	types := map[string]bool{}
	for _, decl := range f.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.CONST {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, ident := range vs.Names {
				if !strings.HasPrefix(ident.Name, "dmEv") || i >= len(vs.Values) {
					continue
				}
				lit, ok := vs.Values[i].(*ast.BasicLit)
				require.True(t, ok && lit.Kind == token.STRING, "const %s is not a string literal", ident.Name)
				v, err := strconv.Unquote(lit.Value)
				require.NoError(t, err)
				types[v] = true
			}
		}
	}
	return types
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestEventDisplayVocabularyIsTotalOverTheDeriveClosedSets(t *testing.T) {
	aaveSrc := parseDeriveFile(t, "aave.go")
	dmSrc := parseDeriveFile(t, "debtmanager.go")

	// The engine-name constants restated in p5_common.go must be the
	// derivers' own values.
	require.Equal(t, EngineAave, constValue(t, aaveSrc, "AaveEngineName"),
		"store.EngineAave drifted from derive.AaveEngineName")
	require.Equal(t, EngineDebtManager, constValue(t, dmSrc, "dmEngineName"),
		"store.EngineDebtManager drifted from derive's dmEngineName")

	aaveTypes := extractAaveEventTypes(t, aaveSrc)
	dmTypes := extractDMEventTypes(t, dmSrc)
	require.NotEmpty(t, aaveTypes, "extracted zero Aave event types — the weld's extractor no longer matches the deriver source")
	require.NotEmpty(t, dmTypes, "extracted zero DM event types — the weld's extractor no longer matches the deriver source")

	// THE TOTALITY LAW, both directions: an event type the deriver emits but
	// the vocabulary does not classify is a TEST FAILURE (it would fall out
	// of the feed with no recorded decision), and a classified type the
	// deriver no longer emits fails equally (a phantom entry misdescribes
	// the data).
	require.Equal(t, sortedKeys(aaveTypes), sortedKeys(aaveEventDisplay),
		"aave display vocabulary is not total over (or has drifted from) the deriver's closed set")
	require.Equal(t, sortedKeys(dmTypes), sortedKeys(dmEventDisplay),
		"debt_manager display vocabulary is not total over (or has drifted from) the deriver's closed set")
}

// Every classification must be complete on its own terms: a display row
// carries a known class, a bookkeeping row carries its reason. Nothing may
// sit in between (a classification with neither is an unexplained hole the
// totality law would not catch, since the KEY exists).
func TestEventDisplayClassificationsAreWellFormed(t *testing.T) {
	for engine, m := range eventDisplayMaps {
		for raw, c := range m {
			if c.Bookkeeping {
				require.Empty(t, c.Display, "%s/%s: bookkeeping rows carry no display class", engine, raw)
				require.NotEmpty(t, c.Reason, "%s/%s: a bookkeeping filter must state its reason", engine, raw)
			} else {
				require.True(t, knownDisplayClasses[c.Display],
					"%s/%s: display class %q is not in the closed class set", engine, raw, c.Display)
			}
			// EVERY classification names its Delta unit from the closed unit
			// set — an empty unit is an unestablished semantic, which must be
			// declared AmountUnitOpaque, never left blank or guessed.
			require.True(t, knownAmountUnits[c.DeltaUnit],
				"%s/%s: delta unit %q is not in the closed unit set", engine, raw, c.DeltaUnit)
		}
	}
}

// The param timeline's DM leg must be exactly the config-classified DM
// types: a new DM config event class (which the totality weld forces into
// the vocabulary) cannot be classified config without also entering the
// timeline.
func TestDMParamConfigTypesWeldToTheConfigClass(t *testing.T) {
	var fromVocab []string
	for raw, c := range dmEventDisplay {
		if !c.Bookkeeping && c.Display == EventDisplayConfig {
			fromVocab = append(fromVocab, raw)
		}
	}
	sort.Strings(fromVocab)
	fromTimeline := append([]string(nil), dmParamConfigEventTypes...)
	sort.Strings(fromTimeline)
	require.Equal(t, fromVocab, fromTimeline,
		"dmParamConfigEventTypes and the config display class have drifted apart")
}
