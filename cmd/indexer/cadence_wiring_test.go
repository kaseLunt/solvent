package main

// Round-19 H1, wiring half — the round-19 L4 lesson applied preemptively: a
// regression that proves the JUDGE while the WIRING can silently vanish
// protects nothing. requireStartupSweepCadence's fatality is proven against
// fakes in sweep_interval_test.go; this test pins, structurally, that run()
// actually CALLS it and actually RETURNS its error — deleting the call, or
// keeping the call while discarding the error, fails HERE, not in some
// future review round.
//
// AST-based, not grep-based: an identifier count over parsed source cannot
// be satisfied by comments or strings, and the shape assertions walk the
// real syntax tree of run's body. Name-based resolution is sound here
// because requireStartupSweepCadence is an unexported, package-unique
// identifier (asserted below: exactly one declaration, exactly one use).
//
// Why structural instead of driving run() behaviorally: run's preamble
// needs a live config, database, chains and workers before it reaches the
// startup stamp — an injection harness for all of that would prove less
// about THIS call site than the direct syntactic pin does, and would itself
// be a new seam into the daemon's entry point.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStartupCadenceFatalWiredIntoRun(t *testing.T) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	require.NoError(t, err)
	pkg, ok := pkgs["main"]
	require.True(t, ok, "package main must parse")

	var runDecl, fnDecl *ast.FuncDecl
	var idents []*ast.Ident
	for _, f := range pkg.Files {
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			switch fd.Name.Name {
			case "run":
				require.Nil(t, runDecl, "exactly one run declaration expected")
				runDecl = fd
			case "requireStartupSweepCadence":
				require.Nil(t, fnDecl, "exactly one requireStartupSweepCadence declaration expected")
				fnDecl = fd
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok && id.Name == "requireStartupSweepCadence" {
				idents = append(idents, id)
			}
			return true
		})
	}
	require.NotNil(t, runDecl, "run must exist")
	require.NotNil(t, fnDecl, "requireStartupSweepCadence must exist (round-19 H1)")

	// Exactly TWO identifiers package-wide: the declaration and ONE call
	// site. Zero call sites is the deleted-wiring mutant; two call sites
	// would mean a second, unaudited fatality path.
	require.Len(t, idents, 2,
		"requireStartupSweepCadence must appear exactly twice in non-test sources (declaration + the one run() call site); found %d", len(idents))
	callIdent := idents[0]
	if callIdent == fnDecl.Name {
		callIdent = idents[1]
	}
	require.NotSame(t, fnDecl.Name, callIdent, "one of the two identifiers must be a use, not the declaration")
	require.True(t, runDecl.Body.Pos() <= callIdent.Pos() && callIdent.End() <= runDecl.Body.End(),
		"the one requireStartupSweepCadence call must be inside run — the daemon's entry point — at %s", fset.Position(callIdent.Pos()))

	// The call's SHAPE is the fatality: `if err := requireStartupSweepCadence(...);
	// err != nil { ... return err ... }`. The error must be checked and run
	// must RETURN it — surfacing without refusing is the tolerated posture
	// round 19 rejected.
	found := false
	ast.Inspect(runDecl.Body, func(n ast.Node) bool {
		ifs, ok := n.(*ast.IfStmt)
		if !ok || ifs.Init == nil {
			return true
		}
		asg, ok := ifs.Init.(*ast.AssignStmt)
		if !ok || asg.Tok != token.DEFINE || len(asg.Lhs) != 1 || len(asg.Rhs) != 1 {
			return true
		}
		call, ok := asg.Rhs[0].(*ast.CallExpr)
		if !ok {
			return true
		}
		fun, ok := call.Fun.(*ast.Ident)
		if !ok || fun != callIdent {
			return true
		}
		errIdent, ok := asg.Lhs[0].(*ast.Ident)
		require.True(t, ok, "the startup stamp's error must be bound to an identifier")
		cond, ok := ifs.Cond.(*ast.BinaryExpr)
		require.True(t, ok && cond.Op == token.NEQ,
			"the startup stamp's error must be CHECKED with err != nil")
		x, ok := cond.X.(*ast.Ident)
		require.True(t, ok && x.Name == errIdent.Name, "the checked identifier must be the bound error")
		y, ok := cond.Y.(*ast.Ident)
		require.True(t, ok && y.Name == "nil")
		returned := false
		for _, stmt := range ifs.Body.List {
			ret, ok := stmt.(*ast.ReturnStmt)
			if !ok || len(ret.Results) != 1 {
				continue
			}
			if r, ok := ret.Results[0].(*ast.Ident); ok && r.Name == errIdent.Name {
				returned = true
			}
		}
		require.True(t, returned,
			"run must RETURN the startup stamp error (the daemon refuses to run, round-19 H1) — logging or surfacing it while entering the loop is the exact posture the finding named")
		found = true
		return true
	})
	require.True(t, found,
		"the requireStartupSweepCadence call must be the init of an `if err := ...; err != nil { return err }` inside run (round-19 H1 instance binding)")
}
