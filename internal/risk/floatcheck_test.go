package risk

// Float-freedom enforcement, type-aware.
//
// An earlier revision tokenized the sources and rejected float LITERALS and the
// identifiers float32/float64/complex*. That catches a written-down float and
// nothing else: every real risk in this package is an INFERRED float arriving
// through an allowed import —
//
//	big.NewFloat(...)            *big.Float, a named struct: no float token
//	big.ParseFloat(...)          same
//	json.Number(...).Float64()   float64 with no float token in sight
//	time.Duration.Seconds()      float64, and `time` is allowlisted precisely
//	                             because as-of stamps flow through this package
//
// The checker below typechecks the package with go/types and rejects anything
// whose resolved type is a float or complex, plus a small denylist for the
// big.Float family (whose underlying type is a struct, so the type check alone
// would miss it). TestFloatCheckerCatchesInferredFloats runs the checker
// against synthetic BAD packages so the gate itself is proven, not assumed.

import (
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// floatDenylist names APIs whose result is a float quantity but whose Go type
// is not a basic float. Keyed by "package path.Name" and
// "(receiver type).Method".
var floatDenylist = map[string]string{
	"math/big.NewFloat":   "big.Float is arbitrary-precision FLOATING point; use big.Int or big.Rat",
	"math/big.ParseFloat": "big.Float is arbitrary-precision FLOATING point; use big.Int or big.Rat",
	"math/big.Float":      "big.Float is arbitrary-precision FLOATING point; use big.Int or big.Rat",
}

// checkFloatFreedom typechecks the given files as one package and returns a
// human-readable violation for every float/complex-typed expression or
// declaration, plus every denylisted API reference.
func checkFloatFreedom(fset *token.FileSet, pkgPath string, files []*ast.File) ([]string, error) {
	info := &types.Info{
		Types: map[ast.Expr]types.TypeAndValue{},
		Defs:  map[*ast.Ident]types.Object{},
		Uses:  map[*ast.Ident]types.Object{},
	}
	conf := types.Config{Importer: importer.ForCompiler(fset, "source", nil)}
	if _, err := conf.Check(pkgPath, fset, files, info); err != nil {
		return nil, err
	}

	var out []string
	seen := map[string]bool{}
	add := func(pos token.Pos, what string) {
		msg := fmt.Sprintf("%s: %s", fset.Position(pos), what)
		if !seen[msg] {
			seen[msg] = true
			out = append(out, msg)
		}
	}

	for expr, tv := range info.Types {
		if tv.Type == nil {
			continue
		}
		if k, bad := floatKind(tv.Type); bad {
			add(expr.Pos(), "expression has floating-point type "+k)
		}
	}
	for id, obj := range info.Defs {
		if obj == nil || obj.Type() == nil {
			continue
		}
		if k, bad := floatKind(obj.Type()); bad {
			add(id.Pos(), "declaration "+id.Name+" has floating-point type "+k)
		}
	}
	for id, obj := range info.Uses {
		if obj == nil {
			continue
		}
		if why, bad := denylisted(obj); bad {
			add(id.Pos(), "reference to "+obj.Name()+": "+why)
		}
	}
	return out, nil
}

// denylisted reports whether obj is one of the named float-bearing APIs.
func denylisted(obj types.Object) (string, bool) {
	if obj.Pkg() == nil {
		return "", false
	}
	if why, ok := floatDenylist[obj.Pkg().Path()+"."+obj.Name()]; ok {
		return why, true
	}
	// Method values: Float64 on any receiver is a float producer, and the
	// basic-type check below already catches its result — this entry exists so
	// the failure NAMES the call rather than pointing at an anonymous tuple.
	if fn, ok := obj.(*types.Func); ok && obj.Name() == "Float64" {
		if sig, ok := fn.Type().(*types.Signature); ok && sig.Recv() != nil {
			return "Float64() converts an exact value into a float64", true
		}
	}
	return "", false
}

// floatKind reports whether t is, or directly contains, a float/complex basic
// type. It unwraps one level of the shapes a float actually arrives in —
// tuples (multi-return), signatures, pointers, slices, arrays, maps, channels
// — and stops there rather than recursing into foreign named types, which
// would flag any stdlib struct that happens to hold a float somewhere.
func floatKind(t types.Type) (string, bool) {
	switch u := t.(type) {
	case *types.Basic:
		if u.Info()&(types.IsFloat|types.IsComplex) != 0 {
			return u.String(), true
		}
		return "", false
	case *types.Tuple:
		for i := 0; i < u.Len(); i++ {
			if k, bad := floatKind(u.At(i).Type()); bad {
				return k, true
			}
		}
	case *types.Signature:
		if k, bad := floatKind(u.Params()); bad {
			return k, true
		}
		if k, bad := floatKind(u.Results()); bad {
			return k, true
		}
	case *types.Pointer:
		return floatKind(u.Elem())
	case *types.Slice:
		return floatKind(u.Elem())
	case *types.Array:
		return floatKind(u.Elem())
	case *types.Map:
		if k, bad := floatKind(u.Key()); bad {
			return k, true
		}
		return floatKind(u.Elem())
	case *types.Chan:
		return floatKind(u.Elem())
	case *types.Named:
		// Only unwrap OUR OWN named types; a foreign named type is treated as
		// opaque (its internals are not this package's arithmetic).
		if u.Obj() != nil && u.Obj().Pkg() != nil && strings.HasPrefix(u.Obj().Pkg().Path(), "github.com/kaselunt/solvent/") {
			if _, isBasic := u.Underlying().(*types.Basic); isBasic {
				return floatKind(u.Underlying())
			}
		}
	}
	return "", false
}

// parsePackage parses the package's non-test sources.
func parsePackage(t *testing.T) (*token.FileSet, []*ast.File) {
	t.Helper()
	fset := token.NewFileSet()
	var files []*ast.File
	for _, name := range nonTestSources(t) {
		af, err := parser.ParseFile(fset, name, nil, parser.ParseComments)
		require.NoError(t, err, name)
		files = append(files, af)
	}
	return fset, files
}

// TestNoFloatAnywhereInNonTestSources is the real gate.
func TestNoFloatAnywhereInNonTestSources(t *testing.T) {
	fset, files := parsePackage(t)
	violations, err := checkFloatFreedom(fset, "github.com/kaselunt/solvent/internal/risk", files)
	require.NoError(t, err, "the package must typecheck for this gate to mean anything")
	require.Empty(t, violations,
		"internal/risk computes in *big.Int only; every value a risk decision-maker sees is exact")
}

// TestFloatCheckerCatchesInferredFloats proves the gate above can fail.
//
// Each snippet is typechecked in memory as its own package. A checker that
// silently passed everything would be indistinguishable from a correct one on
// the real sources — these are the positive controls.
func TestFloatCheckerCatchesInferredFloats(t *testing.T) {
	bad := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "written float literal",
			src:  "package p\n\nvar X = 1.5\n",
			want: "floating-point type",
		},
		{
			name: "float result type",
			src:  "package p\n\nfunc F() float64 { return 0 }\n",
			want: "floating-point type",
		},
		{
			name: "float slice",
			src:  "package p\n\nvar Xs = []float64{}\n",
			want: "floating-point type",
		},
		{
			name: "float map value",
			src:  "package p\n\nvar M = map[string]float64{}\n",
			want: "floating-point type",
		},
		{
			name: "big.NewFloat via an ALLOWED import",
			src:  "package p\n\nimport \"math/big\"\n\nvar F = big.NewFloat(1)\n",
			want: "big.Float is arbitrary-precision FLOATING point",
		},
		{
			name: "big.ParseFloat via an ALLOWED import",
			src:  "package p\n\nimport \"math/big\"\n\nfunc F() { f, _, _ := big.ParseFloat(\"1\", 10, 53, big.ToNearestEven); _ = f }\n",
			want: "big.Float is arbitrary-precision FLOATING point",
		},
		{
			name: "json.Number.Float64 via an ALLOWED import",
			src:  "package p\n\nimport \"encoding/json\"\n\nfunc F(n json.Number) { v, _ := n.Float64(); _ = v }\n",
			want: "Float64",
		},
		{
			name: "time.Duration.Seconds via an ALLOWED import",
			src:  "package p\n\nimport \"time\"\n\nfunc F(d time.Duration) float64 { return d.Seconds() }\n",
			want: "floating-point type",
		},
		{
			name: "float arriving through an untyped conversion",
			src:  "package p\n\nfunc F(n int) { x := float64(n) / 2; _ = x }\n",
			want: "floating-point type",
		},
		{
			name: "complex",
			src:  "package p\n\nvar C = complex(1, 2)\n",
			want: "floating-point type",
		},
	}

	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			fset := token.NewFileSet()
			af, err := parser.ParseFile(fset, "snippet.go", tc.src, 0)
			require.NoError(t, err)
			violations, err := checkFloatFreedom(fset, "example.com/snippet", []*ast.File{af})
			require.NoError(t, err)
			require.NotEmpty(t, violations, "the checker MUST reject this snippet")
			require.Contains(t, strings.Join(violations, "\n"), tc.want)
		})
	}

	// Negative controls: exact arithmetic through the same imports must pass.
	good := []struct{ name, src string }{
		{"big.Int arithmetic", "package p\n\nimport \"math/big\"\n\nvar X = new(big.Int).Mul(big.NewInt(2), big.NewInt(3))\n"},
		{"big.Rat exact ratio", "package p\n\nimport \"math/big\"\n\nfunc F() *big.Rat { return new(big.Rat).SetFrac64(1, 3) }\n"},
		{"time carried, never measured as a float", "package p\n\nimport \"time\"\n\nfunc F(t time.Time) int64 { return t.Unix() }\n"},
		{"integer division", "package p\n\nfunc F(a, b int64) int64 { return a / b }\n"},
	}
	for _, tc := range good {
		t.Run("clean/"+tc.name, func(t *testing.T) {
			fset := token.NewFileSet()
			af, err := parser.ParseFile(fset, "snippet.go", tc.src, 0)
			require.NoError(t, err)
			violations, err := checkFloatFreedom(fset, "example.com/snippet", []*ast.File{af})
			require.NoError(t, err)
			require.Empty(t, violations, "exact arithmetic must not trip the gate")
		})
	}
}
