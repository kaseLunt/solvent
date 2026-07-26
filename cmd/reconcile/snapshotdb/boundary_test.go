// Round-13 F2: the structural F5 proof, reduced to what a compiler can
// enforce. The wave-13 AST reachability walk resolved only DIRECT NAMED
// calls, so a package-level function value, an aliased import, or interface
// dispatch evaded it — an inspection that cannot fail against indirection is
// a fake (round-5 fixture lesson, at the static-analysis layer). The package
// split replaces name-matching with two properties that indirection cannot
// route around:
//
//  1. IMPORT ALLOWLIST (TestSnapshotDBImportsAreDBOnly): Go code can only
//     reach capabilities its package imports. The allowlist below is EXACT
//     and asserted on import PATHS — `import web "net/http"` is still the
//     path "net/http"; a function value that dials still needs `net`; there
//     is no alias, value or dispatch shape that acquires a dialer without an
//     import line this test reads.
//  2. INJECTION-FREE API (TestSnapshotDBAPISurfaceRejectsInjection): the one
//     remaining channel is an OUTSIDE caller loading a capability in — a
//     func-typed hook, an interface-typed parameter or field dispatched
//     inside the transaction, or a callable excavated from an `any` field by
//     type assertion. The API surface is asserted to have none of these, so
//     in-package dispatch can only ever land on code from the allowlisted
//     imports.
//
// Together with the DB-backed lifecycle test in cmd/reconcile
// (TestProductionGateActiveThroughSnapshotLifecycle — the runtime gate,
// exercised by Collect's own wiring), these are the round-13 F2 mechanisms.
// The negative mutants W15M2-M5 (aliased import, in-package function value
// with a dial, injected interface dispatch, exported function hook) are each
// killed here — see .superpowers/sdd/t9w15-mutations/.
package snapshotdb

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// importAllowlist is the EXACT import surface of the snapshot package. Every
// entry is either plain data/encoding stdlib, the database driver (pgx — DB
// connections are the POINT of Stage A), or a first-party package proven
// chain-free below. Adding ANY import — aliased or not — fails this test
// until it is argued onto this list.
var importAllowlist = map[string]bool{
	"context":       true,
	"crypto/sha256": true,
	"encoding/hex":  true,
	"fmt":           true,
	"math/big":      true,
	"os":            true, // os.ReadFile for the config sha; no sockets live here
	"sync/atomic":   true,

	"github.com/ethereum/go-ethereum/common": true, // value types (Address/Hash) only
	"github.com/jackc/pgx/v5":                true,

	"github.com/kaselunt/solvent/internal/config": true,
	"github.com/kaselunt/solvent/internal/store":  true,
}

// forbiddenAnywhere are the chain-RPC surfaces that must not appear in this
// package NOR in the direct imports of its first-party dependencies (store,
// config): the dial machinery the F5 seam exists to keep away from the open
// snapshot transaction.
var forbiddenAnywhere = []string{
	"github.com/kaselunt/solvent/internal/chain",
	"github.com/ethereum/go-ethereum/ethclient",
	"github.com/ethereum/go-ethereum/rpc",
	"net/http",
	"net/rpc",
	"golang.org/x/net/websocket",
	"github.com/gorilla/websocket",
}

func parseDir(t *testing.T, dir string) map[string]*ast.File {
	t.Helper()
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	require.NoError(t, err)
	files := map[string]*ast.File{}
	for _, pkg := range pkgs {
		for name, f := range pkg.Files {
			files[name] = f
		}
	}
	require.NotEmpty(t, files, "no non-test sources found in %s", dir)
	return files
}

func importPaths(files map[string]*ast.File) []string {
	seen := map[string]bool{}
	for _, f := range files {
		for _, imp := range f.Imports {
			seen[strings.Trim(imp.Path.Value, `"`)] = true
		}
	}
	out := make([]string, 0, len(seen))
	for p := range seen {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// TestSnapshotDBImportsAreDBOnly asserts the exact import allowlist on this
// package, and the absence of chain-RPC surfaces from the direct imports of
// its first-party dependencies. Import PATHS are asserted, never identifiers:
// aliasing cannot rename a path, and a smuggled function value cannot reach a
// network without one of these lines changing.
func TestSnapshotDBImportsAreDBOnly(t *testing.T) {
	own := importPaths(parseDir(t, "."))
	require.Contains(t, own, "github.com/jackc/pgx/v5", "sanity: the parse must have seen the real package")
	require.Contains(t, own, "github.com/kaselunt/solvent/internal/store", "sanity: the parse must have seen the real package")
	for _, p := range own {
		require.True(t, importAllowlist[p],
			"snapshotdb imports %q, which is OUTSIDE the DB-only allowlist — no chain or network surface may be linkable from the package that holds the open snapshot transaction (round-13 F2)", p)
	}

	// First-party dependencies: their DIRECT imports must not reintroduce
	// the chain-dial machinery behind our back. (pgx legitimately uses raw
	// `net` for the database socket — the F5 hazard is the CHAIN-RPC
	// surface, and internal/chain + the go-ethereum clients ARE that
	// surface; net/http and websockets are how any of them transport.)
	for _, dep := range []string{"../../../internal/store", "../../../internal/config"} {
		deps := importPaths(parseDir(t, dep))
		for _, p := range deps {
			for _, bad := range forbiddenAnywhere {
				require.NotEqual(t, bad, p, "%s imports %q — the snapshot package's dependency closure regained a chain/network surface", dep, p)
			}
		}
	}
	// And this package itself, against the same denylist (belt on the
	// allowlist's braces — a future edit weakening the allowlist still
	// cannot admit these).
	for _, p := range own {
		for _, bad := range forbiddenAnywhere {
			require.NotEqual(t, bad, p, "snapshotdb imports %q — the F5 chain surface", p)
		}
	}
}

// exportedAPIAllowlist is the complete permitted exported surface. Anything
// exported beyond this list is a new door into the package that must be
// argued here first.
var exportedAPIAllowlist = map[string]bool{
	// funcs
	"Collect": true, "GoldenAsOfMap": true,
	// types (plain data + the sentinel)
	"Sentinel": true, "Params": true, "GoldenSpec": true, "GoldenDBSide": true,
	"WeldData": true, "IdxObs": true, "RewindBaseline": true,
	"ScanResult": true, "InvariantsSection": true, "Data": true,
	// consts
	"DMEngine": true, "AaveEngine": true,
	// the ONE package-level var
	"Gate": true,
	// Sentinel methods
	"Enter": true, "Exit": true, "Violation": true,
}

// TestSnapshotDBAPISurfaceRejectsInjection closes the injection channel: the
// evasion shapes round 13 named (package-level function value, interface
// dispatch) cannot be built OUTSIDE the package and loaded in, because the
// package exposes nowhere to load them:
//
//   - the only package-level var (any visibility) is Gate — no hook to
//     assign a closure to (kills the W15M5 shape);
//   - no function type and no interface type appears in any declared type or
//     any function signature (params, results, struct fields) — context.Context
//     and error stay behind their names and cannot be locally re-declared to
//     smuggle methods; an interface-typed Params field is exactly mutant
//     W15M4 and dies here;
//   - no type assertion anywhere in the package — a capability parked in an
//     `any` field (ScanResult.Detail is the one `any`, artifact-bound) can
//     never be excavated into something callable.
func TestSnapshotDBAPISurfaceRejectsInjection(t *testing.T) {
	files := parseDir(t, ".")

	sawCollect := false
	for fname, f := range files {
		for _, d := range f.Decls {
			switch decl := d.(type) {
			case *ast.FuncDecl:
				if decl.Name.Name == "Collect" {
					sawCollect = true
				}
				if decl.Name.IsExported() {
					require.True(t, exportedAPIAllowlist[decl.Name.Name],
						"%s exports func/method %s beyond the declared API surface", fname, decl.Name.Name)
				}
				// ALL functions (exported or not): no func/interface types in
				// the signature — an unexported helper taking a callback is
				// the same smuggling channel one hop later.
				forbidCallableTypes(t, fname, decl.Name.Name+" signature", decl.Type)
			case *ast.GenDecl:
				for _, s := range decl.Specs {
					switch spec := s.(type) {
					case *ast.ValueSpec:
						if decl.Tok == token.VAR {
							for _, n := range spec.Names {
								require.Equal(t, "Gate", n.Name,
									"%s declares package-level var %q — Gate is the ONLY package-level var; a var is a mutable hook and a function value parked in one is round 13's first evasion shape", fname, n.Name)
							}
						}
						if decl.Tok == token.CONST {
							for _, n := range spec.Names {
								if n.IsExported() {
									require.True(t, exportedAPIAllowlist[n.Name], "%s exports const %s beyond the declared API surface", fname, n.Name)
								}
							}
						}
					case *ast.TypeSpec:
						if spec.Name.IsExported() {
							require.True(t, exportedAPIAllowlist[spec.Name.Name],
								"%s exports type %s beyond the declared API surface", fname, spec.Name.Name)
						}
						forbidCallableTypes(t, fname, "type "+spec.Name.Name, spec.Type)
					}
				}
			}
		}
		// No type assertions anywhere: nothing callable can be excavated
		// from an `any`, and ctx.Value can never become a function.
		ast.Inspect(f, func(n ast.Node) bool {
			if ta, ok := n.(*ast.TypeAssertExpr); ok && ta.Type != nil {
				t.Fatalf("%s contains a type assertion — the snapshot package may not excavate capabilities from opaque values (round-13 F2)", fname)
			}
			return true
		})
	}
	require.True(t, sawCollect, "Collect must exist — the F2 seam is defined around it")
}

// forbidCallableTypes walks a declared type or signature and refuses any
// embedded function or interface type.
func forbidCallableTypes(t *testing.T, fname, where string, root ast.Node) {
	t.Helper()
	ast.Inspect(root, func(n ast.Node) bool {
		switch n.(type) {
		case *ast.FuncType:
			// The signature node itself is a FuncType when root is one —
			// only REJECT nested occurrences (a param/result/field of func
			// type).
			if n == root {
				return true
			}
			t.Fatalf("%s: %s embeds a function type — a function value crossing the package boundary is round 13's evasion shape", fname, where)
		case *ast.InterfaceType:
			t.Fatalf("%s: %s embeds an interface type — interface dispatch into the open snapshot transaction is round 13's evasion shape", fname, where)
		case *ast.ChanType:
			t.Fatalf("%s: %s embeds a channel type — plain data only", fname, where)
		}
		return true
	})
}
