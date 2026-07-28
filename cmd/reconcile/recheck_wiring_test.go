// Closing-round wiring guard (session 019fa6ab): the choreography test
// proves readRecheckState yields one coherent snapshot, but a call-site
// regression — Phase 3 reverting to direct autocommit DeriveCursorStates /
// MaxReorgEpochs reads and bypassing the helper — would leave it green.
// This AST assertion pins the wiring itself (the round-19 L4 structural
// pattern): within main.go, the two store readers may be invoked ONLY
// inside readRecheckState's body, and the helper must be invoked at least
// once outside its own definition.
package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPhase3RecheckReadsOnlyThroughHelper(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "main.go", nil, 0)
	require.NoError(t, err)

	var helperDecl *ast.FuncDecl
	for _, d := range f.Decls {
		if fd, ok := d.(*ast.FuncDecl); ok && fd.Name.Name == "readRecheckState" {
			helperDecl = fd
		}
	}
	require.NotNil(t, helperDecl, "readRecheckState must exist in main.go")

	inHelper := func(pos token.Pos) bool {
		return pos >= helperDecl.Pos() && pos <= helperDecl.End()
	}

	// The invariants, matched to the honest regression class (the closing
	// round's named mutant is "separate autocommit DeriveCursorStates and
	// MaxReorgEpochs calls at the call site"):
	//   1. store.MaxReorgEpochs is invoked ONLY inside the helper — it has
	//      exactly one main.go consumer (the recheck pair), so ANY call-site
	//      autocommit pair must reintroduce it and trips this.
	//   2. Exactly ONE store.DeriveCursorStates call outside the helper: the
	//      documented Phase-0 preflight diagnostic (pre-snapshot, feeds pin
	//      estimation/derive-lag only — authoritative reads happen inside
	//      Collect's own RR transaction). A second one is the mutant.
	//   3. The helper is invoked at least once — deleting the call site
	//      unwires the guarantee.
	helperCalls := 0
	cursorReadsOutside := 0
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch fn := call.Fun.(type) {
		case *ast.SelectorExpr:
			pkg, ok := fn.X.(*ast.Ident)
			if !ok || pkg.Name != "store" {
				return true
			}
			switch fn.Sel.Name {
			case "MaxReorgEpochs":
				require.True(t, inHelper(call.Pos()),
					"main.go:%d calls store.MaxReorgEpochs outside readRecheckState — the recheck pair must come from ONE snapshot",
					fset.Position(call.Pos()).Line)
			case "DeriveCursorStates":
				if !inHelper(call.Pos()) {
					cursorReadsOutside++
				}
			}
		case *ast.Ident:
			if fn.Name == "readRecheckState" && !inHelper(call.Pos()) {
				helperCalls++
			}
		}
		return true
	})
	require.Equal(t, 1, cursorReadsOutside,
		"exactly one DeriveCursorStates outside the helper (the Phase-0 preflight diagnostic) — a second is a recheck bypass")
	require.GreaterOrEqual(t, helperCalls, 1,
		"the Phase-3 recheck must invoke readRecheckState — deleting the call site unwires the one-snapshot guarantee")
}
