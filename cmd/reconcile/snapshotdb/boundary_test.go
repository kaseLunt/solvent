// Round-13 F2, strengthened by round-14 F3: the structural F5 proof, at the
// CAPABILITY level rather than the namespace level. The wave-13 AST
// reachability walk resolved only DIRECT NAMED calls, so a package-level
// function value, an aliased import, or interface dispatch evaded it — an
// inspection that cannot fail against indirection is a fake (round-5 fixture
// lesson, at the static-analysis layer). Round 14 then showed the wave-15
// version was still only a NAMESPACE boundary: allowlisting `os` for one
// file read granted os.StartProcess, and the AST test matched interface
// SPELLINGS, so a named interface type slipped through where a literal one
// died. The properties now enforced:
//
//  1. IMPORT ALLOWLIST (TestSnapshotDBImportsAreDBOnly): Go code can only
//     reach capabilities its package imports. The allowlist below is EXACT
//     and asserted on import PATHS — `import web "net/http"` is still the
//     path "net/http"; a function value that dials still needs `net`; there
//     is no alias, value or dispatch shape that acquires a dialer without an
//     import line this test reads. Since round-14 F3 the list is also
//     capability-honest: `os` is GONE (the config hash is caller-computed),
//     so every entry's FULL capability set is acceptable, not just the one
//     function the package happened to call.
//  2. INJECTION-FREE API (TestSnapshotDBAPISurfaceRejectsInjection): the one
//     remaining channel is an OUTSIDE caller loading a capability in — a
//     func-typed hook, an interface-typed parameter or field dispatched
//     inside the transaction, or a callable excavated from an `any` field by
//     type assertion or type switch. The API surface is asserted to have
//     none of these, so in-package dispatch can only ever land on code from
//     the allowlisted imports. The gate is NON-ASSIGNABLE since round-14 F3:
//     the only package-level var is the unexported `gate`, reached through
//     the Gate() accessor — `snapshotdb.Gate = decoy` no longer compiles
//     anywhere.
//  3. SEMANTIC RESOLUTION + CALL-SITE DISCIPLINE
//     (TestSnapshotDBCapabilityBoundary, go/types): every type in every
//     declared type and signature is resolved to its UNDERLYING type, so a
//     NAMED interface — local or imported, round-14 F3's evasion shape — is
//     refused wherever a literal one would be, with an exact justified
//     allowlist (error, context.Context, any, store.Querier in unexported
//     positions). And the capabilities the remaining allowlist INHERENTLY
//     grants are pinned at their call sites: pgx can dial arbitrary hosts —
//     that is what a DB driver is — so the package must contain EXACTLY ONE
//     dial call site (pgx.Connect on the caller's roDSN); internal/config
//     reads files and env, so the package may use its TYPES but call NONE of
//     its functions.
//
// Together with the DB-backed lifecycle test in cmd/reconcile
// (TestProductionGateActiveThroughSnapshotLifecycle — the runtime gate,
// exercised by Collect's own wiring, observed DURING the ordered cleanup),
// these are the round-13 F2 + round-14 F2/F3 mechanisms. The negative
// mutants W15M2-M5 (aliased import, in-package function value with a dial,
// injected interface dispatch, exported function hook) and W16M2-M4 (`os`
// reintroduced, second pgx.Connect under the open gate, named-interface
// indirection) are each killed here — see .superpowers/sdd/t9w15-mutations/
// and .superpowers/sdd/t9w16-mutations/.
package snapshotdb

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// importAllowlist is the EXACT import surface of the snapshot package. Every
// entry is either plain data/encoding stdlib, the database driver (pgx — DB
// connections are the POINT of Stage A), or a first-party package proven
// chain-free below. Adding ANY import — aliased or not — fails this test
// until it is argued onto this list. `os` was REMOVED by round-14 F3 (the
// config hash is computed by the caller now): an entry earns its place by
// its whole capability set being acceptable, and os granted StartProcess for
// the price of one ReadFile.
var importAllowlist = map[string]bool{
	"context":      true,
	"encoding/hex": true,
	"fmt":          true,
	"math/big":     true,
	"sync/atomic":  true,
	"time":         true, // durations, the cleanup timeout, the barrier sleep — clocks, no I/O

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
	// funcs (Gate is a FUNC since round-14 F3 — an accessor cannot be
	// reassigned the way `var Gate` could)
	"Collect": true, "GoldenAsOfMap": true, "Gate": true,
	// types (plain data + the sentinel)
	"Sentinel": true, "CleanupStage": true, "Params": true, "GoldenSpec": true,
	"GoldenDBSide": true, "WeldData": true, "IdxObs": true, "RewindBaseline": true,
	"ScanResult": true, "InvariantsSection": true, "Data": true,
	"ConnectedIdentity": true,
	// consts
	"DMEngine": true, "AaveEngine": true,
	"StageBeforeRollback": true, "StageBeforeClose": true, "StageAfterClose": true,
	// Sentinel methods. HoldAt/Arrived/ResetArrivals are the round-14 F2
	// lifecycle barriers: delay-only bools — they cannot skip, reorder or
	// inject anything into the ordered cleanup, only stretch it, and a
	// stretched cleanup keeps the gate CLOSED longer (fail-closed).
	"Enter": true, "Exit": true, "Violation": true,
	"HoldAt": true, "Arrived": true, "ResetArrivals": true,
}

// TestSnapshotDBAPISurfaceRejectsInjection closes the injection channel: the
// evasion shapes round 13 named (package-level function value, interface
// dispatch) cannot be built OUTSIDE the package and loaded in, because the
// package exposes nowhere to load them:
//
//   - the only package-level var (any visibility) is the UNEXPORTED gate —
//     no hook to assign a closure to (kills the W15M5 shape), and no
//     exported var at all, so no importer can reassign the sentinel
//     (round-14 F3: `var Gate` was itself an injection surface);
//   - no function type and no interface type appears in any declared type or
//     any function signature (params, results, struct fields) — an
//     interface-typed Params field is exactly mutant W15M4 and dies here;
//     NAMED interface types, which this literal-shape check cannot see, die
//     in TestSnapshotDBCapabilityBoundary's go/types resolution;
//   - no type assertion and no type switch anywhere in the package — a
//     capability parked in an `any` field (ScanResult.Detail is the one
//     `any`, artifact-bound) can never be excavated into something callable
//     (the type-switch half closed by round-14 F3: `switch v := x.(type)`
//     was an assertion the old check did not spell).
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
								require.Equal(t, "gate", n.Name,
									"%s declares package-level var %q — the unexported gate is the ONLY package-level var; a var is a mutable hook, a function value parked in one is round 13's first evasion shape, and an EXPORTED var is reassignable from any importer (round-14 F3)", fname, n.Name)
								require.False(t, n.IsExported(),
									"%s: the sentinel var must be unexported — outside packages reach it only through the Gate() accessor", fname)
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
		// No type assertions or type switches anywhere: nothing callable can
		// be excavated from an `any`, and ctx.Value can never become a
		// function.
		ast.Inspect(f, func(n ast.Node) bool {
			if ta, ok := n.(*ast.TypeAssertExpr); ok && ta.Type != nil {
				t.Fatalf("%s contains a type assertion — the snapshot package may not excavate capabilities from opaque values (round-13 F2)", fname)
			}
			if _, ok := n.(*ast.TypeSwitchStmt); ok {
				t.Fatalf("%s contains a type switch — a type switch is a type assertion in different clothes (round-14 F3)", fname)
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

// --- round-14 F3: the go/types capability boundary --------------------------

// typecheckPackage typechecks the non-test sources of this package with full
// dependency resolution (export data located via `go list -export`, the same
// toolchain that builds the tests). Semantic types, not spellings: this is
// what lets the boundary see that a NAMED type is an interface underneath.
func typecheckPackage(t *testing.T) (*types.Package, *token.FileSet, []*ast.File, *types.Info) {
	t.Helper()
	out, err := exec.Command("go", "list", "-export", "-deps", "-json=ImportPath,Export", ".").Output()
	if err != nil {
		var ee *exec.ExitError
		msg := ""
		if errors.As(err, &ee) {
			msg = string(ee.Stderr)
		}
		t.Fatalf("go list -export failed: %v\n%s", err, msg)
	}
	exports := map[string]string{}
	dec := json.NewDecoder(bytes.NewReader(out))
	for {
		var e struct{ ImportPath, Export string }
		if err := dec.Decode(&e); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("decode go list output: %v", err)
		}
		if e.Export != "" {
			exports[e.ImportPath] = e.Export
		}
	}
	lookup := func(path string) (io.ReadCloser, error) {
		f, ok := exports[path]
		if !ok {
			return nil, fmt.Errorf("no export data for %q", path)
		}
		return os.Open(f)
	}

	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	require.NoError(t, err)
	var files []*ast.File
	for _, pkg := range pkgs {
		names := make([]string, 0, len(pkg.Files))
		for name := range pkg.Files {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			files = append(files, pkg.Files[name])
		}
	}
	require.NotEmpty(t, files)

	info := &types.Info{
		Defs:       map[*ast.Ident]types.Object{},
		Uses:       map[*ast.Ident]types.Object{},
		Types:      map[ast.Expr]types.TypeAndValue{},
		Selections: map[*ast.SelectorExpr]*types.Selection{},
	}
	conf := types.Config{Importer: importer.ForCompiler(fset, "gc", lookup)}
	pkg, err := conf.Check("github.com/kaselunt/solvent/cmd/reconcile/snapshotdb", fset, files, info)
	require.NoError(t, err, "typecheck snapshotdb")
	return pkg, fset, files, info
}

// allowedInterface is the EXACT justified set of interface types (resolved
// semantically — named or not) permitted in this package's declared types
// and signatures:
//
//   - error: one method, returns a string — nothing dispatchable beyond
//     Error(), no capability.
//   - context.Context: required by every DB call; its only escape hatch is
//     Value() any, and the package-wide ban on type assertions and type
//     switches means an `any` can never be excavated into something
//     callable.
//   - any (the empty interface): zero methods — nothing can be CALLED on it,
//     and the same excavation ban applies. Appears as ScanResult.Detail
//     (artifact-bound) and in capDetail's generic signature.
//   - store.Querier (UNEXPORTED positions only): the DB-query seam shared
//     with internal/store; values of it can only be constructed in-package
//     from pgx objects, and unexported functions cannot be called from
//     outside, so no outside caller can load an implementation in. In an
//     EXPORTED position it would be exactly the W15M4 injection channel, so
//     it is refused there.
func allowedInterface(typeName string, exportedPos bool) bool {
	switch typeName {
	case "error", "context.Context", "any", "interface{}":
		return true
	case "github.com/kaselunt/solvent/internal/store.Querier":
		return !exportedPos
	}
	return false
}

// walkTypeForCapabilities recursively resolves root (round-14 F3: UNDERLYING
// types, never spellings) and fails on any interface outside the justified
// allowlist, any function type nested where data should be, and any channel.
func walkTypeForCapabilities(t *testing.T, pkg *types.Package, root types.Type, where string, exportedPos bool) {
	t.Helper()
	seen := map[types.Type]bool{}
	var walk func(ty types.Type, topLevel bool)
	walk = func(ty types.Type, topLevel bool) {
		ty = types.Unalias(ty)
		if seen[ty] {
			return
		}
		seen[ty] = true
		switch u := ty.(type) {
		case *types.Named:
			if _, isIface := u.Underlying().(*types.Interface); isIface {
				name := types.TypeString(u, nil)
				require.True(t, allowedInterface(name, exportedPos),
					"%s uses interface type %s (resolved through its NAME — round-14 F3): interface dispatch into the open snapshot transaction is an injection channel unless the type is on the justified allowlist", where, name)
				return // an allowed interface's method set is its contract; do not descend
			}
			// Named non-interface from another package: its innards belong
			// to an allowlisted import (and the DATA half is separately
			// walked by TestSnapshotDataCarriesNoConnections). Descend only
			// into THIS package's declarations.
			if u.Obj().Pkg() != nil && u.Obj().Pkg().Path() == pkg.Path() {
				walk(u.Underlying(), false)
			}
		case *types.Pointer:
			walk(u.Elem(), false)
		case *types.Slice:
			walk(u.Elem(), false)
		case *types.Array:
			walk(u.Elem(), false)
		case *types.Map:
			walk(u.Key(), false)
			walk(u.Elem(), false)
		case *types.Struct:
			for i := 0; i < u.NumFields(); i++ {
				walk(u.Field(i).Type(), false)
			}
		case *types.Signature:
			if !topLevel {
				t.Fatalf("%s embeds a function type (%s) — a function value crossing the boundary is round 13's evasion shape", where, types.TypeString(u, nil))
			}
			if r := u.Recv(); r != nil {
				walk(r.Type(), false)
			}
			for i := 0; i < u.Params().Len(); i++ {
				walk(u.Params().At(i).Type(), false)
			}
			for i := 0; i < u.Results().Len(); i++ {
				walk(u.Results().At(i).Type(), false)
			}
		case *types.Interface:
			// An anonymous interface literal: only the EMPTY one (any) is
			// tolerable — anything with methods is dispatchable.
			require.True(t, u.NumMethods() == 0 && u.NumEmbeddeds() == 0 && allowedInterface("any", exportedPos),
				"%s embeds a non-empty anonymous interface — dispatchable surface (round-13 F2 / round-14 F3)", where)
		case *types.Chan:
			t.Fatalf("%s embeds a channel type — plain data only", where)
		case *types.Basic, *types.TypeParam:
			// plain
		default:
			t.Fatalf("%s uses unexpected type kind %T (%s) — extend the boundary deliberately or remove it", where, ty, types.TypeString(ty, nil))
		}
	}
	walk(root, true)
}

// TestSnapshotDBCapabilityBoundary is the round-14 F3 semantic layer:
//
//  1. NAMED-INTERFACE RESOLUTION: every declared type and every signature
//     (exported or not) is walked with go/types and each component resolved
//     to its underlying type. A named interface — `type probe interface{…}`
//     locally, or one imported from anywhere — is caught exactly like a
//     literal `interface{…}`, closing the spelling gap round 14 named.
//  2. GATE NON-ASSIGNABILITY: Gate is a FUNCTION in the package scope and
//     the only package-level var is the unexported gate — checked here at
//     the types level so a future `var Gate` cannot come back under an
//     alias or build tag the AST test's file walk might miss.
//  3. CALL-SITE DISCIPLINE over inherent capabilities: the import allowlist
//     cannot say "pgx but only to OUR database" — pgx.Connect dials whatever
//     DSN it is handed. So the package must contain EXACTLY ONE pgx dial
//     call site (pgx.Connect), its argument must be Collect's roDSN
//     parameter (the caller's audited DSN, never a literal), and no other
//     pgx package-level connect entry point may appear. Likewise
//     internal/config is imported for its TYPES (plain data crossing the
//     boundary); calling INTO it (config.Load reads files and the
//     environment) would re-acquire through a first-party door the
//     capabilities round-14 F3 just evicted with `os`.
func TestSnapshotDBCapabilityBoundary(t *testing.T) {
	pkg, fset, files, info := typecheckPackage(t)

	// (1) semantic type discipline over every declaration.
	for _, f := range files {
		for _, d := range f.Decls {
			switch decl := d.(type) {
			case *ast.FuncDecl:
				obj := info.Defs[decl.Name]
				require.NotNil(t, obj, "no type object for func %s", decl.Name.Name)
				exportedPos := decl.Name.IsExported()
				where := fmt.Sprintf("%s (func %s)", fset.Position(decl.Pos()).Filename, decl.Name.Name)
				walkTypeForCapabilities(t, pkg, obj.Type(), where, exportedPos)
			case *ast.GenDecl:
				for _, s := range decl.Specs {
					if spec, ok := s.(*ast.TypeSpec); ok {
						obj := info.Defs[spec.Name]
						require.NotNil(t, obj, "no type object for type %s", spec.Name.Name)
						named, ok := types.Unalias(obj.Type()).(*types.Named)
						require.True(t, ok, "type %s is not a named type", spec.Name.Name)
						under := named.Underlying()
						where := fmt.Sprintf("%s (type %s)", fset.Position(spec.Pos()).Filename, spec.Name.Name)
						switch under.(type) {
						case *types.Interface:
							t.Fatalf("%s declares an interface type — a locally-named interface is the round-14 F3 evasion shape (the AST test saw only literal spellings)", where)
						case *types.Signature:
							t.Fatalf("%s declares a function type — a nameable function type is a hook factory", where)
						case *types.Chan:
							t.Fatalf("%s declares a channel type — plain data only", where)
						}
						walkTypeForCapabilities(t, pkg, under, where, spec.Name.IsExported())
					}
				}
			}
		}
	}

	// (2) the gate: accessor func exported, var unexported — at types level.
	gateObj := pkg.Scope().Lookup("Gate")
	require.NotNil(t, gateObj, "Gate accessor must exist")
	_, isFunc := gateObj.(*types.Func)
	require.True(t, isFunc, "Gate must be a FUNCTION (non-assignable), never a var (round-14 F3)")
	var pkgVars []string
	for _, name := range pkg.Scope().Names() {
		if v, ok := pkg.Scope().Lookup(name).(*types.Var); ok {
			pkgVars = append(pkgVars, v.Name())
		}
	}
	require.Equal(t, []string{"gate"}, pkgVars,
		"the unexported gate must be the ONLY package-level var (typed check — build tags and aliases cannot hide one from the type checker)")

	// (3) call-site discipline.
	var connectCalls []string
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			obj := info.Uses[sel.Sel]
			fn, ok := obj.(*types.Func)
			if !ok || fn.Pkg() == nil {
				return true
			}
			// Only package-level entry points matter here (methods on pgx
			// objects operate over the one audited connection).
			if fn.Type().(*types.Signature).Recv() != nil {
				return true
			}
			pos := fset.Position(call.Pos())
			switch fn.Pkg().Path() {
			case "github.com/jackc/pgx/v5", "github.com/jackc/pgx/v5/pgconn", "github.com/jackc/pgx/v5/pgxpool":
				if strings.HasPrefix(fn.Name(), "Connect") || strings.HasPrefix(fn.Name(), "ParseConfig") || strings.HasPrefix(fn.Name(), "New") {
					connectCalls = append(connectCalls, fmt.Sprintf("%s.%s at %s", fn.Pkg().Path(), fn.Name(), pos))
					// The one sanctioned dial must target the caller's
					// audited DSN parameter, never a literal or a rebuilt
					// string.
					require.Len(t, call.Args, 2, "pgx dial at %s must be Connect(ctx, roDSN)", pos)
					arg, ok := call.Args[1].(*ast.Ident)
					require.True(t, ok && arg.Name == "roDSN",
						"pgx dial at %s must take Collect's roDSN parameter — a second DSN is a second, unaudited destination (round-14 F3)", pos)
				}
			case "github.com/kaselunt/solvent/internal/config":
				t.Fatalf("call to %s.%s at %s — internal/config is imported for TYPES only; calling into it re-acquires file/env capabilities through a first-party door (round-14 F3)", fn.Pkg().Path(), fn.Name(), pos)
			}
			return true
		})
	}
	require.Len(t, connectCalls, 1,
		"the package must contain EXACTLY ONE pgx dial call site (found %v) — pgx can dial arbitrary hosts, so every additional connect is an unaudited network capability under the open snapshot (round-14 F3)", connectCalls)
	require.Contains(t, connectCalls[0], "github.com/jackc/pgx/v5.Connect", "the one dial must be pgx.Connect")
}
