package main

// WIRING assertions for the two round-1 findings whose defect lived at a CALL
// SITE rather than inside a decision.
//
// Both survived the first mutation sweep for the same reason: the fix was to pass
// a different argument, and a unit test that calls the callee directly cannot
// observe which argument the caller passed. Two tools close that:
//
//   - finding 10 became a NAMED function (adapterAnchorFloorRow), so the decision
//     is directly testable and a mutation inside it dies below;
//   - finding 6 is genuinely an argument choice, so it is asserted over the SOURCE
//     with go/ast — the same tool this package already uses for the flag-surface
//     closure and the snapshotdb import allowlist. A frame mix-up is a wiring bug,
//     and the wiring is what gets asserted.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestAdapterAnchorFloorNeverFollowsTheEvidence is the finding-10 kill, on the
// named decision.
func TestAdapterAnchorFloorNeverFollowsTheEvidence(t *testing.T) {
	// One row observed, only ONE anchor in the whole population: still a miss.
	row := adapterAnchorFloorRow("abc", 1, 1, 1)
	require.Equal(t, verdictCohortFloor, row.Verdict,
		"a reserve with a single anchor must NOT satisfy a three-anchor requirement, however thin its history")
	require.True(t, row.Gated)
	require.Contains(t, row.Expected, "3")
	require.Contains(t, row.Evidence["why_not_lowered"], "follow the evidence it exists to test")
	require.NotEmpty(t, row.Evidence["remediation"])

	// Three rows over three anchors: satisfied.
	require.Equal(t, verdictExact, adapterAnchorFloorRow("abc", 3, 5, 3).Verdict)
	// Two rows where three anchors exist: a real shortfall.
	require.Equal(t, verdictCohortFloor, adapterAnchorFloorRow("abc", 2, 5, 2).Verdict)
	// The requirement itself is pinned, so silently relaxing the constant fails.
	require.Equal(t, 3, adapterRowsPerReserve)
}

// TestResidueWeldIsWiredToTheExecutionFrame is the finding-6 kill.
//
// borrowingOf is read ONLY on the execution frame (readBacktestFrameState's
// full=false branch), so passing the parent frame leaves chainDebt nil on every
// case and gates all 31 weld-unread — the obligation existing in name only. The
// argument is asserted over the source because that is where the defect was.
func TestResidueWeldIsWiredToTheExecutionFrame(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "backtest.go", nil, 0)
	require.NoError(t, err)

	calls := map[string][]string{} // callee -> argument identifier names
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		ident, ok := call.Fun.(*ast.Ident)
		if !ok {
			return true
		}
		if ident.Name != "residueWeld" && ident.Name != "reconstructSeizures" {
			return true
		}
		var args []string
		for _, a := range call.Args {
			if id, ok := a.(*ast.Ident); ok {
				args = append(args, id.Name)
				continue
			}
			args = append(args, "(expr)")
		}
		calls[ident.Name] = args
		return true
	})

	residueArgs, ok := calls["residueWeld"]
	require.True(t, ok, "residueWeld must be called from backtest.go")
	require.Contains(t, residueArgs, "exec",
		"residueWeld MUST receive the EXECUTION frame: borrowingOf is read only there, so the parent frame leaves chainDebt nil and gates every case weld-unread (Codex round 1, finding 6)")
	require.NotContains(t, residueArgs, "parent",
		"residueWeld must NOT receive the parent frame")

	seizureArgs, ok := calls["reconstructSeizures"]
	require.True(t, ok, "reconstructSeizures must be called from backtest.go")
	require.Contains(t, seizureArgs, "parent",
		"the seizure reconstruction reads the PARENT frame: balances, configs and the engine price the deployed branch used are pre-liquidation values")
	require.NotContains(t, seizureArgs, "exec",
		"reconstructSeizures must not read the post-liquidation frame")
}

// TestFrameReadContractSeparatesResidueFromSeizureInputs documents the contract
// the wiring assertion above depends on, so a future change to
// readBacktestFrameState cannot silently move borrowingOf to the full frame and
// make the assertion meaningless.
func TestFrameReadContractSeparatesResidueFromSeizureInputs(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "backtest.go", nil, 0)
	require.NoError(t, err)

	var full, notFull []string
	ast.Inspect(file, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "readBacktestFrameState" {
			return true
		}
		ast.Inspect(fn.Body, func(m ast.Node) bool {
			ifs, ok := m.(*ast.IfStmt)
			if !ok {
				return true
			}
			cond, ok := ifs.Cond.(*ast.Ident)
			if !ok || cond.Name != "full" {
				return true
			}
			// Record which reads live on each side of `if full`.
			collect := func(b *ast.BlockStmt, into *[]string) {
				if b == nil {
					return
				}
				ast.Inspect(b, func(k ast.Node) bool {
					if lit, ok := k.(*ast.BasicLit); ok && lit.Kind == token.STRING {
						*into = append(*into, lit.Value)
					}
					return true
				})
			}
			collect(ifs.Body, &full)
			if eb, ok := ifs.Else.(*ast.BlockStmt); ok {
				collect(eb, &notFull)
			}
			return true
		})
		return false
	})

	joined := func(ss []string) string {
		out := ""
		for _, s := range ss {
			out += s + " "
		}
		return out
	}
	require.Contains(t, joined(full), "collateralOf",
		"the FULL (parent) frame reads collateralOf — obligation 2's collateral basket")
	require.Contains(t, joined(notFull), "borrowingOf",
		"the NOT-full (execution) frame reads borrowingOf — obligation 4's chain side. If this moves, TestResidueWeldIsWiredToTheExecutionFrame stops meaning anything")
}
