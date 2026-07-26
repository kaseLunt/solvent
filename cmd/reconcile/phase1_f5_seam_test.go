// Round-11 F3: the REAL F5 seam — mechanisms that FAIL on a network call
// while the repeatable-read snapshot transaction is open. Wave 11 argued
// the regression was unrepresentable (reader-free signature + connection-
// free snapshotData); round 11 disproved that: those checks inspect data,
// not behavior — collectSnapshot could always have dialed through a
// package-level helper or the environment without adding a field or a
// parameter. The claim is retracted (wave-13 report). In its place stand
// two enforcing mechanisms, each tested here:
//
//  1. RUNTIME: snapshotGate (phase1.go) — collectSnapshot opens it for the
//     transaction's lifetime and every pinnedReader entry point refuses,
//     check-first, while it is open (TestSnapshotGateBlocksReadersWhileOpen,
//     TestSnapshotGateReopensAfterExit);
//  2. STRUCTURAL: TestCollectSnapshotReachesNoChainSurface — an AST
//     reachability walk from collectSnapshot over the package's non-test
//     sources, refusing any reachable function that names a chain-reading
//     type, calls a reader/dial method, or references a chain/network
//     package. The mandated wave-13 mutation (W13M3: reintroduce an actual
//     headerHash call under BeginTx, with the parameter it needs) dies
//     here, twice over — on the signature's reader type and on the call.
package main

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"
)

// seamForbiddenCalls are method names whose invocation anywhere reachable
// from collectSnapshot marks a chain surface: the pinnedReader entry
// points, the chainReader interface they wrap, and dialing of any kind.
var seamForbiddenCalls = map[string]bool{
	"headerHash": true, "headerTime": true, "callAtHash": true,
	"multicall": true, "secondOpinion": true,
	"HeaderHashFrom": true, "HeaderTimeFrom": true, "CallAtHashFrom": true,
	"EndpointCount": true,
	"Dial":          true, "DialContext": true,
}

// seamForbiddenTypes are local chain-surface types: merely NAMING one
// (parameter, variable, composite literal, conversion) inside the reachable
// set is a violation — a reader in scope is a dial waiting to happen.
var seamForbiddenTypes = map[string]bool{
	"pinnedReader": true, "chainReader": true, "rpcRunner": true,
}

// seamForbiddenQualifiers are package qualifiers whose mere mention marks
// chain or network machinery (internal/chain, go-ethereum clients, raw
// transports). The DB packages (pgx, store) are deliberately absent: DB
// reads inside the transaction are the POINT of Stage A.
var seamForbiddenQualifiers = map[string]bool{
	"chain": true, "ethclient": true, "rpc": true,
	"http": true, "net": true, "websocket": true,
}

// packageFuncDecls parses the package's NON-TEST sources and returns every
// function/method declaration keyed by bare name. Methods are keyed by
// method name (receiver ignored): reachability below is a conservative
// over-approximation — any call whose name matches a package declaration
// pulls that declaration's body into the walk.
func packageFuncDecls(t *testing.T) map[string][]*ast.FuncDecl {
	t.Helper()
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	require.NoError(t, err)
	pkg, ok := pkgs["main"]
	require.True(t, ok, "cmd/reconcile package sources not found")
	decls := map[string][]*ast.FuncDecl{}
	for _, f := range pkg.Files {
		for _, d := range f.Decls {
			if fd, ok := d.(*ast.FuncDecl); ok {
				decls[fd.Name.Name] = append(decls[fd.Name.Name], fd)
			}
		}
	}
	return decls
}

// TestCollectSnapshotReachesNoChainSurface is the STRUCTURAL half of the
// round-11 F3 seam: starting from collectSnapshot, walk every package-local
// function transitively reachable by name and refuse any mention of a chain
// surface — reader types, reader/dial method calls, chain/network package
// qualifiers. The signature is covered by the same walk (parameter types
// are idents inside the FuncDecl), so reintroducing a reader parameter OR
// an RPC call under the snapshot fails this test without needing to
// execute a single query.
func TestCollectSnapshotReachesNoChainSurface(t *testing.T) {
	decls := packageFuncDecls(t)
	require.NotEmpty(t, decls["collectSnapshot"], "collectSnapshot must exist — the F5 seam is defined around it")

	visited := map[string]bool{}
	queue := []string{"collectSnapshot"}
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if visited[name] {
			continue
		}
		visited[name] = true
		for _, fd := range decls[name] {
			ast.Inspect(fd, func(n ast.Node) bool {
				switch v := n.(type) {
				case *ast.Ident:
					if seamForbiddenTypes[v.Name] {
						t.Fatalf("%s (reachable from collectSnapshot) names %s — no chain-reading surface may be in scope while the snapshot transaction is open (round-11 F3)", name, v.Name)
					}
				case *ast.SelectorExpr:
					if x, ok := v.X.(*ast.Ident); ok && seamForbiddenQualifiers[x.Name] {
						t.Fatalf("%s (reachable from collectSnapshot) references %s.%s — chain/network packages are outside Stage A's reach (round-11 F3)", name, x.Name, v.Sel.Name)
					}
				case *ast.CallExpr:
					switch fun := v.Fun.(type) {
					case *ast.Ident:
						if _, local := decls[fun.Name]; local {
							queue = append(queue, fun.Name)
						}
					case *ast.SelectorExpr:
						if seamForbiddenCalls[fun.Sel.Name] {
							t.Fatalf("%s (reachable from collectSnapshot) calls %s — an RPC/header read under the repeatable-read snapshot is the round-10 F5 regression (round-11 F3)", name, fun.Sel.Name)
						}
						if _, local := decls[fun.Sel.Name]; local {
							queue = append(queue, fun.Sel.Name)
						}
					}
				}
				return true
			})
		}
	}
	require.True(t, visited["collectSnapshot"])
}

// TestSnapshotGateBlocksReadersWhileOpen is the RUNTIME half: with the gate
// open, EVERY pinnedReader entry point refuses with the named seam
// violation. The reader is a zero value on purpose — nil inner client, nil
// runner, nil limiter — so the test also proves the check runs FIRST: any
// reordering of the gate check behind the dial machinery panics on nil
// here instead of returning the violation.
func TestSnapshotGateBlocksReadersWhileOpen(t *testing.T) {
	snapshotGate.enter()
	defer snapshotGate.exit()

	r := &pinnedReader{name: "op"}
	ctx := context.Background()

	_, _, err := r.headerHash(ctx, 1)
	require.ErrorContains(t, err, "F5 seam violation", "headerHash must refuse while the snapshot is open")

	_, _, err = r.headerTime(ctx, 1)
	require.ErrorContains(t, err, "F5 seam violation", "headerTime must refuse while the snapshot is open")

	_, _, err = r.callAtHash(ctx, "probe", common.Address{}, nil, common.Hash{})
	require.ErrorContains(t, err, "F5 seam violation", "callAtHash (and multicall through it) must refuse while the snapshot is open")

	_, _, err = r.multicall(ctx, "probe", 1, common.Hash{}, []multicallCall{{}})
	require.ErrorContains(t, err, "F5 seam violation", "multicall funnels through callAtHash and must refuse too")

	note, v := r.secondOpinion(ctx, "probe", common.Address{}, nil, common.Hash{}, 0)
	require.Nil(t, v, "a refused second opinion must never carry a value")
	require.Contains(t, note, "F5 seam violation", "secondOpinion has no error path; the violation is the recorded note")
}

// TestSnapshotGateReopensAfterExit pins the gate's lifecycle: exit()
// reopens the RPC surface (Stage B and the phase-2/3 welds run AFTER the
// snapshot committed and closed, and must not inherit a stuck-closed gate).
func TestSnapshotGateReopensAfterExit(t *testing.T) {
	snapshotGate.enter()
	snapshotGate.exit()
	require.NoError(t, snapshotGate.violation("headerHash"), "after exit the gate must be open again")
}
