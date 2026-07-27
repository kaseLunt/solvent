package main

// Round-19 L4: the regression protects the WIRING, not just the judge.
// Wave 19 proved claimVsConnectedTaint verdict-bearing by calling it (and
// computeResult) directly — but the predecessor draft's bug was precisely a
// judge DEFINED and never CALLED, and deleting the execute call would have
// recreated that exact unwired state while every wave-19 test stayed green
// (round 19's [low]). This test pins the call structurally: parsed source,
// not grep (comments and strings cannot satisfy an identifier count),
// asserting the judge is called exactly once, inside execute, on the
// DSN-effective claim and the Phase-1 server-reported identity, with its
// result appended to the SAME taint slice computeResult judges and stamped
// into the acceptance record.
//
// Why a structural call-site assertion instead of an execute-level
// behavioral drive: execute's Phase 0 requires a live config, database and
// verified chain endpoints before the Phase-1 identity even exists — an
// injection harness for all of that would prove less about THIS wiring
// than the direct syntactic pin does, and the harness seam would itself be
// a new injection surface into the verdict path (the round-14 F3 class).
// The judge's BEHAVIOR (both directions, exactness, computeResult
// integration) stays proven by TestClaimVsConnectedMismatchTaints — W19M2's
// inert-judge mutant keeps killing there; this test kills the
// deleted-wiring mutant (W20M6).
//
// Name-based resolution is sound here: claimVsConnectedTaint is an
// unexported, package-unique identifier, and the test asserts exactly one
// declaration and exactly one use across the non-test sources.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestClaimVsConnectedTaintWiredIntoExecute(t *testing.T) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	require.NoError(t, err)
	pkg, ok := pkgs["main"]
	require.True(t, ok, "package main must parse")

	var executeDecl, judgeDecl *ast.FuncDecl
	var idents []*ast.Ident
	for _, f := range pkg.Files {
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			switch fd.Name.Name {
			case "execute":
				require.Nil(t, executeDecl, "exactly one execute declaration expected")
				executeDecl = fd
			case "claimVsConnectedTaint":
				require.Nil(t, judgeDecl, "exactly one claimVsConnectedTaint declaration expected")
				judgeDecl = fd
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok && id.Name == "claimVsConnectedTaint" {
				idents = append(idents, id)
			}
			return true
		})
	}
	require.NotNil(t, executeDecl, "execute must exist")
	require.NotNil(t, judgeDecl, "claimVsConnectedTaint must exist (round-16 M1)")

	// Exactly TWO identifiers package-wide: the declaration and ONE call
	// site. Zero call sites is the predecessor's unwired state — the judge
	// as dead code — which round 19 showed no wave-19 test would catch.
	require.Len(t, idents, 2,
		"claimVsConnectedTaint must appear exactly twice in non-test sources (declaration + the one execute call site); found %d", len(idents))
	callIdent := idents[0]
	if callIdent == judgeDecl.Name {
		callIdent = idents[1]
	}
	require.NotSame(t, judgeDecl.Name, callIdent, "one of the two identifiers must be a use, not the declaration")
	require.True(t, executeDecl.Body.Pos() <= callIdent.Pos() && callIdent.End() <= executeDecl.Body.End(),
		"the one claimVsConnectedTaint call must be inside execute at %s", fset.Position(callIdent.Pos()))

	// The CLAIM side of the comparison must be the identifier execute bound
	// from dbNameClaimed — the DSN-effective claim under pgx's own
	// precedence (round-16 M1), not some other string.
	claimedVar := ""
	ast.Inspect(executeDecl.Body, func(n ast.Node) bool {
		asg, ok := n.(*ast.AssignStmt)
		if !ok || asg.Tok != token.DEFINE || len(asg.Lhs) != 1 || len(asg.Rhs) != 1 {
			return true
		}
		call, ok := asg.Rhs[0].(*ast.CallExpr)
		if !ok {
			return true
		}
		if fun, ok := call.Fun.(*ast.Ident); ok && fun.Name == "dbNameClaimed" {
			if id, ok := asg.Lhs[0].(*ast.Ident); ok {
				claimedVar = id.Name
			}
		}
		return true
	})
	require.NotEmpty(t, claimedVar, "execute must bind the DSN-effective claim from dbNameClaimed")

	// The call's SHAPE is the wiring: `if msg := claimVsConnectedTaint(<claim>,
	// <...>.Identity); msg != "" { <taints> = append(<taints>, msg);
	// stampAcceptance(_, <taints>) }` — judge output into the taint set,
	// taint set into the stamped acceptance record.
	taintsVar := ""
	ast.Inspect(executeDecl.Body, func(n ast.Node) bool {
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
		msgIdent, ok := asg.Lhs[0].(*ast.Ident)
		require.True(t, ok, "the judge's result must be bound to an identifier")
		require.Len(t, call.Args, 2, "the judge takes (claimed, connected)")
		arg0, ok := call.Args[0].(*ast.Ident)
		require.True(t, ok && arg0.Name == claimedVar,
			"the judge's CLAIMED side must be the dbNameClaimed-bound identifier %q (the DSN-effective claim, round-16 M1)", claimedVar)
		arg1, ok := call.Args[1].(*ast.SelectorExpr)
		require.True(t, ok && arg1.Sel.Name == "Identity",
			"the judge's CONNECTED side must be the Phase-1 server-reported .Identity — never a re-parse of the DSN")
		cond, ok := ifs.Cond.(*ast.BinaryExpr)
		require.True(t, ok && cond.Op == token.NEQ, "the judge's result must be checked against the empty string")
		x, ok := cond.X.(*ast.Ident)
		require.True(t, ok && x.Name == msgIdent.Name)
		y, ok := cond.Y.(*ast.BasicLit)
		require.True(t, ok && y.Value == `""`)

		for _, stmt := range ifs.Body.List {
			app, ok := stmt.(*ast.AssignStmt)
			if !ok || app.Tok != token.ASSIGN || len(app.Lhs) != 1 || len(app.Rhs) != 1 {
				continue
			}
			lhs, ok := app.Lhs[0].(*ast.Ident)
			if !ok {
				continue
			}
			ac, ok := app.Rhs[0].(*ast.CallExpr)
			if !ok {
				continue
			}
			af, ok := ac.Fun.(*ast.Ident)
			if !ok || af.Name != "append" || len(ac.Args) != 2 {
				continue
			}
			a0, ok0 := ac.Args[0].(*ast.Ident)
			a1, ok1 := ac.Args[1].(*ast.Ident)
			if ok0 && ok1 && a0.Name == lhs.Name && a1.Name == msgIdent.Name {
				taintsVar = lhs.Name
			}
		}
		require.NotEmpty(t, taintsVar,
			"the judge's output must be APPENDED to the run's taint slice inside the guard — a mismatch that is recorded but not tainting is the wave-16 posture round 16 killed")

		stamped := false
		for _, stmt := range ifs.Body.List {
			es, ok := stmt.(*ast.ExprStmt)
			if !ok {
				continue
			}
			sc, ok := es.X.(*ast.CallExpr)
			if !ok {
				continue
			}
			sf, ok := sc.Fun.(*ast.Ident)
			if !ok || sf.Name != "stampAcceptance" || len(sc.Args) != 2 {
				continue
			}
			if a1, ok := sc.Args[1].(*ast.Ident); ok && a1.Name == taintsVar {
				stamped = true
			}
		}
		require.True(t, stamped, "the grown taint set must be re-stamped into the acceptance record (stampAcceptance)")
		return true
	})
	require.NotEmpty(t, taintsVar,
		"the claimVsConnectedTaint call must be the init of an `if msg := ...; msg != \"\" { ... }` guard whose body feeds the taint set (round-19 L4: the wiring, not just the judge)")

	// VERDICT linkage: the same taint slice the guard grew must be the one
	// computeResult judges — append-into-a-slice-nobody-reads would satisfy
	// everything above.
	verdictWired := false
	ast.Inspect(executeDecl.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		fun, ok := call.Fun.(*ast.Ident)
		if !ok || fun.Name != "computeResult" || len(call.Args) != 3 {
			return true
		}
		if arg, ok := call.Args[2].(*ast.Ident); ok && arg.Name == taintsVar {
			verdictWired = true
		}
		return true
	})
	require.True(t, verdictWired,
		"execute must pass the SAME taint slice to computeResult — the judge's output must be able to reach the exit code (round-10 F2 through round-19 L4)")
}
