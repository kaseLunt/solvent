// Closing-round wiring guard (sessions 019fa6ab, 019fa6b5): the choreography
// test proves readRecheckState yields one coherent snapshot, but a call-site
// regression — Phase 3 reverting to autocommit reads, or feeding rewindMoved
// the PREFLIGHT cursors instead of the helper's — would leave it green. This
// AST guard pins the wiring itself (the round-19 L4 structural pattern),
// including the DATAFLOW: the helper's two results must be the very
// identifiers rewindMoved consumes. Scope: every non-test file in the
// package, so a cross-file wrapper cannot smuggle a reader; value formation
// (f := store.MaxReorgEpochs) is caught by matching selector EXPRESSIONS,
// not just calls; and the store import must be unaliased in scanned files so
// the literal matcher is sound.
package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const storeImportPath = `"github.com/kaselunt/solvent/internal/store"`

func TestPhase3RecheckReadsOnlyThroughHelper(t *testing.T) {
	fset := token.NewFileSet()
	files := map[string]*ast.File{}
	entries, err := os.ReadDir(".")
	require.NoError(t, err)
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, 0)
		require.NoError(t, err)
		files[name] = f
		for _, imp := range f.Imports {
			if imp.Path.Value == storeImportPath {
				require.Nil(t, imp.Name,
					"%s aliases the store import — the wiring guard matches the literal 'store' qualifier; do not alias it", name)
			}
		}
	}
	mainFile, ok := files["main.go"]
	require.True(t, ok)

	var helperDecl *ast.FuncDecl
	for _, d := range mainFile.Decls {
		if fd, ok := d.(*ast.FuncDecl); ok && fd.Name.Name == "readRecheckState" {
			helperDecl = fd
		}
	}
	require.NotNil(t, helperDecl, "readRecheckState must exist in main.go")
	inHelper := func(pos token.Pos) bool {
		return pos >= helperDecl.Pos() && pos <= helperDecl.End()
	}

	// Invariant 1 — store.MaxReorgEpochs may be REFERENCED (call or value
	// formation) only inside the helper, package-wide. Invariant 2 — exactly
	// one store.DeriveCursorStates reference outside the helper: the
	// documented Phase-0 preflight diagnostic (pre-snapshot, pin-estimation/
	// derive-lag only).
	cursorRefsOutside := 0
	for name, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			pkg, ok := sel.X.(*ast.Ident)
			if !ok || pkg.Name != "store" {
				return true
			}
			switch sel.Sel.Name {
			case "MaxReorgEpochs":
				require.True(t, name == "main.go" && inHelper(sel.Pos()),
					"%s:%d references store.MaxReorgEpochs outside readRecheckState — the recheck pair must come from ONE snapshot (calls, value formation, and wrappers all count)",
					name, fset.Position(sel.Pos()).Line)
			case "DeriveCursorStates":
				if !(name == "main.go" && inHelper(sel.Pos())) {
					cursorRefsOutside++
				}
			}
			return true
		})
	}
	require.Equal(t, 1, cursorRefsOutside,
		"exactly one DeriveCursorStates reference outside the helper (the Phase-0 preflight diagnostic) — a second is a recheck bypass")

	// Invariant 3 — DATAFLOW (session 019fa6b5): the helper's first and
	// second results must be bound to non-blank identifiers, and exactly
	// those identifiers must be rewindMoved's current-cursor and max-epoch
	// arguments. This kills the preCursors-substitution mutant
	// (`_, max, err := readRecheckState(...); rewindMoved(.., preCursors, .., max)`)
	// in both spellings: a blank first result fails here, and a renamed one
	// fails the argument-identity match.
	var cursorsID, maxID string
	ast.Inspect(mainFile, func(n ast.Node) bool {
		as, ok := n.(*ast.AssignStmt)
		if !ok || len(as.Rhs) != 1 || inHelper(as.Pos()) {
			return true
		}
		call, ok := as.Rhs[0].(*ast.CallExpr)
		if !ok {
			return true
		}
		if fn, ok := call.Fun.(*ast.Ident); !ok || fn.Name != "readRecheckState" {
			return true
		}
		require.Empty(t, cursorsID, "exactly one readRecheckState call site expected")
		require.Len(t, as.Lhs, 3)
		c, ok := as.Lhs[0].(*ast.Ident)
		require.True(t, ok)
		m, ok := as.Lhs[1].(*ast.Ident)
		require.True(t, ok)
		require.NotEqual(t, "_", c.Name, "the helper's cursor result must be consumed — discarding it unwires the coherent pair")
		require.NotEqual(t, "_", m.Name, "the helper's max-epoch result must be consumed — discarding it unwires the coherent pair")
		cursorsID, maxID = c.Name, m.Name
		return true
	})
	require.NotEmpty(t, cursorsID, "the Phase-3 recheck must invoke readRecheckState — deleting the call site unwires the one-snapshot guarantee")

	rewindCalls := 0
	ast.Inspect(mainFile, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if fn, ok := call.Fun.(*ast.Ident); !ok || fn.Name != "rewindMoved" {
			return true
		}
		rewindCalls++
		require.Len(t, call.Args, 4)
		arg1, ok := call.Args[1].(*ast.Ident)
		require.True(t, ok, "rewindMoved's current-cursor argument must be the helper's cursor result identifier")
		require.Equal(t, cursorsID, arg1.Name,
			"rewindMoved must consume the CURSORS returned by readRecheckState — substituting the preflight cursors reopens the silent-pass window")
		arg3, ok := call.Args[3].(*ast.Ident)
		require.True(t, ok, "rewindMoved's max-epoch argument must be the helper's max result identifier")
		require.Equal(t, maxID, arg3.Name,
			"rewindMoved must consume the MAX EPOCHS returned by readRecheckState")
		return true
	})
	require.Equal(t, 1, rewindCalls, "exactly one rewindMoved call site expected in main.go")
}
