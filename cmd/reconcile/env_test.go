// Round-13 F1 tests: the env surface is CLOSED (every env read classified,
// the classification enforced), and the binding regression — an extreme
// positive SOLVENT_SNAPSHOT_INTERVAL flows env → freshness bound → verdict
// and the verdict is structurally non-pass.
package main

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

// scanEnvReads parses every non-test .go file under dir and returns (a) the
// literal names passed to os.Getenv/os.LookupEnv, and (b) every DYNAMIC
// (non-literal) read as "enclosingFunc/argExpr" so each indirection must be
// individually accounted for — an unexplained dynamic read is an
// unclassifiable env surface and fails the closure test. It also collects
// the literal env names passed to urlsFor (the recon-endpoint resolver whose
// parameter is the one sanctioned indirection in this package).
func scanEnvReads(t *testing.T, dir string) (literals map[string]bool, dynamic []string) {
	t.Helper()
	literals = map[string]bool{}
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	require.NoError(t, err, "parse %s", dir)
	exprName := func(e ast.Expr) string {
		switch v := e.(type) {
		case *ast.Ident:
			return v.Name
		case *ast.SelectorExpr:
			if x, ok := v.X.(*ast.Ident); ok {
				return x.Name + "." + v.Sel.Name
			}
		}
		return "«complex»"
	}
	for _, pkg := range pkgs {
		for _, f := range pkg.Files {
			for _, d := range f.Decls {
				fd, ok := d.(*ast.FuncDecl)
				if !ok {
					continue
				}
				ast.Inspect(fd, func(n ast.Node) bool {
					call, ok := n.(*ast.CallExpr)
					if !ok {
						return true
					}
					if fun, ok := call.Fun.(*ast.Ident); ok && fun.Name == "urlsFor" && len(call.Args) == 2 {
						lit, ok := call.Args[1].(*ast.BasicLit)
						require.True(t, ok && lit.Kind == token.STRING,
							"%s: urlsFor must be called with a LITERAL env name so the closure scan can see it", fd.Name.Name)
						literals[strings.Trim(lit.Value, `"`)] = true
						return true
					}
					sel, ok := call.Fun.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					x, ok := sel.X.(*ast.Ident)
					if !ok || x.Name != "os" || (sel.Sel.Name != "Getenv" && sel.Sel.Name != "LookupEnv") {
						return true
					}
					require.Len(t, call.Args, 1)
					if lit, ok := call.Args[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
						literals[strings.Trim(lit.Value, `"`)] = true
					} else {
						dynamic = append(dynamic, fd.Name.Name+"/"+exprName(call.Args[0]))
					}
					return true
				})
			}
		}
	}
	return literals, dynamic
}

// TestEnvSurfaceClosed is the env twin of TestFlagSurfaceClosed (round-11
// F1 → round-13 F1): the generator must be closed over the ENTIRE env
// surface of the binary's first-party source closure.
func TestEnvSurfaceClosed(t *testing.T) {
	classified := map[string]envSpec{}
	for _, spec := range reconEnvSurface {
		require.NotContains(t, classified, spec.Name, "env var %s classified twice", spec.Name)
		require.NotEmpty(t, spec.Why, "env var %s carries no justification", spec.Name)
		if spec.Class == envTaints {
			require.NotNil(t, spec.Taint, "env var %s is class taints but has no taint judge", spec.Name)
		} else {
			require.Nil(t, spec.Taint, "env var %s is class %s but carries a taint judge", spec.Name, spec.Class)
		}
		classified[spec.Name] = spec
	}

	// (1) FORWARD closure: every literal os.Getenv in the binary's
	// first-party source closure is classified. internal/chain and
	// internal/store are scanned too — they read no env today, and this
	// keeps that fact enforced rather than assumed. Every DYNAMIC read must
	// be individually accounted for below; an unlisted one fails.
	allowedDynamic := map[string]string{
		// The taint sweep iterates the closed table itself — its domain IS
		// the classification, closed by construction.
		"./envAcceptanceTaints/spec.Name": "the env-surface table's own sweep",
		// urlsFor's parameter: every call site passes a literal that the
		// scanner collects (enforced in scanEnvReads).
		"./execute/reconEnv": "recon endpoint resolution; call-site literals collected",
		// config.Load resolves each chain's rpcEnv key from the config file
		// — enumerated from the canonical config below.
		"../../internal/config/Load/fc.RPCEnv": "contracts.json rpcEnv keys",
	}
	found := map[string]bool{}
	var seenDynamic []string
	for _, dir := range []string{".", "snapshotdb", "../../internal/config", "../../internal/chain", "../../internal/store"} {
		lits, dyn := scanEnvReads(t, dir)
		for name := range lits {
			found[name] = true
			require.Contains(t, classified, name,
				"os.Getenv(%q) in %s is UNCLASSIFIED — close the env-surface table over it before shipping (round-13 F1)", name, dir)
		}
		for _, d := range dyn {
			key := dir + "/" + d
			require.Contains(t, allowedDynamic, key,
				"%s is a DYNAMIC os.Getenv the closure test cannot see through — classify its domain or make it literal (round-13 F1)", key)
			seenDynamic = append(seenDynamic, key)
		}
	}
	require.Len(t, seenDynamic, len(allowedDynamic),
		"the sanctioned dynamic reads changed — keep allowedDynamic exact so a removed indirection cannot mask a new one")

	// (2) The config.Load indirection: enumerate the CANONICAL config's
	// rpcEnv values and require each to be classified — the config path
	// itself is taint-guarded (-config), so this enumeration is the
	// acceptance-relevant one.
	raw, err := os.ReadFile("../../config/contracts.json")
	require.NoError(t, err)
	var contracts struct {
		Chains map[string]struct {
			RPCEnv string `json:"rpcEnv"`
		} `json:"chains"`
	}
	require.NoError(t, json.Unmarshal(raw, &contracts))
	require.NotEmpty(t, contracts.Chains)
	rpcEnvNames := map[string]bool{}
	for chainName, c := range contracts.Chains {
		require.Contains(t, classified, c.RPCEnv,
			"chain %q resolves env %s (dynamic rpcEnv) — UNCLASSIFIED (round-13 F1)", chainName, c.RPCEnv)
		rpcEnvNames[c.RPCEnv] = true
	}

	// (3) REVERSE closure: every table row corresponds to a real read —
	// a literal scan hit or a canonical rpcEnv key. A stale row is a claim
	// about a read that no longer exists.
	for name := range classified {
		require.True(t, found[name] || rpcEnvNames[name],
			"env-surface table classifies %s but no source reads it (stale table)", name)
	}

	// (4) The "UNCONSUMED by reconcile" justifications are structural, not
	// prose: the reconcile packages must not reference the delegated config
	// fields.
	for _, dir := range []string{".", "snapshotdb"} {
		fset := token.NewFileSet()
		pkgs, err := parser.ParseDir(fset, dir, func(fi fs.FileInfo) bool {
			return !strings.HasSuffix(fi.Name(), "_test.go")
		}, 0)
		require.NoError(t, err)
		for _, pkg := range pkgs {
			for fname, f := range pkg.Files {
				ast.Inspect(f, func(n ast.Node) bool {
					if sel, ok := n.(*ast.SelectorExpr); ok {
						switch sel.Sel.Name {
						case "PollInterval", "PriceInterval", "HealthAddr":
							t.Fatalf("%s references .%s — the env-surface table claims reconcile never consumes it; consume it and the table row (and possibly its class) must change", fname, sel.Sel.Name)
						}
					}
					return true
				})
			}
		}
	}

	// (5) Drive the taint rows through the REAL generator — the SAME
	// acceptanceTaints call execute() makes — and the verdict.
	var errBuf bytes.Buffer
	mustTaint := []string{"1000000h", "61m", "2h", "24h", "bogus", "-5m", "0s"}
	for _, v := range mustTaint {
		t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", v)
		o, err := parseFlags(nil, &errBuf)
		require.NoError(t, err)
		taints := acceptanceTaints(o)
		require.NotEmpty(t, taints, "SOLVENT_SNAPSHOT_INTERVAL=%s must taint", v)
		require.Contains(t, strings.Join(taints, "\n"), "SOLVENT_SNAPSHOT_INTERVAL",
			"the taint must name the env var (value %s)", v)
		result, code := computeResult(0, 0, taints)
		require.NotEqual(t, "pass", result, "SOLVENT_SNAPSHOT_INTERVAL=%s can never produce pass", v)
		require.NotEqual(t, exitPass, code)
	}
	// Canonical/tighter values do not taint: unset, the default restated,
	// and tighter-than-default (which can only strengthen the bound).
	for _, v := range []string{"", "1h", "60m", "30m", "1s"} {
		t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", v)
		o, err := parseFlags(nil, &errBuf)
		require.NoError(t, err)
		require.Empty(t, acceptanceTaints(o), "SOLVENT_SNAPSHOT_INTERVAL=%q weakens nothing and must not taint", v)
	}
}

// TestExtremeSnapshotIntervalEnvIsNonPass is the round-13 F1 BINDING
// regression: env → freshness bound → verdict with an extreme positive
// interval. It first demonstrates the hole the finding names — under the
// inflated bound, a snapshot refreshed YEARS ago classifies "fresh" and
// contributes zero gate failures — and then proves the verdict chain refuses
// anyway: the same env value taints through the real generator, and
// computeResult makes the run structurally non-pass. Mutation W15M1
// (acceptance cap removed) must die here.
func TestExtremeSnapshotIntervalEnvIsNonPass(t *testing.T) {
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "1000000h")

	// The REAL resolver (the one runPhase1 feeds freshnessBound).
	interval, source := resolveSnapshotInterval()
	require.Equal(t, 1000000*time.Hour, interval, "no silent clamp — the artifact records the truth")
	require.Equal(t, "SOLVENT_SNAPSHOT_INTERVAL", source)

	bound, inputs := freshnessBound(interval, nil)
	require.Equal(t, 2000000*time.Hour, bound, "the 2×interval arm — ~228 years")
	require.Equal(t, "policy", inputs["label"])

	// The vacuity, demonstrated: a sweep last succeeded TWO YEARS ago and
	// still classifies fresh under this bound — the freshness gate alone
	// can no longer catch it (this is the laundering path round 13 named).
	now := time.Now()
	ancient := now.Add(-2 * 365 * 24 * time.Hour)
	res := evaluateFreshness([]store.AccountFreshness{
		{Account: []byte{0x01}, HasRow: true, Status: "success", LastSuccessBlock: 42, LastSuccessAt: &ancient},
	}, map[string]bool{"01": true}, bound, inputs, now)
	require.Equal(t, 0, res.GateFailures, "the inflated bound really is vacuous — that is the finding")
	require.Equal(t, "fresh", res.Sampled[0].Verdict)

	// And the verdict chain refuses regardless: same env, real pipeline —
	// parseFlags → acceptanceTaints (flag + env, one set) → computeResult.
	var errBuf bytes.Buffer
	o, err := parseFlags(nil, &errBuf)
	require.NoError(t, err)
	taints := acceptanceTaints(o)
	require.NotEmpty(t, taints)
	joined := strings.Join(taints, "\n")
	require.Contains(t, joined, "SOLVENT_SNAPSHOT_INTERVAL=1000000h", "the taint names the env var and value")
	require.Contains(t, joined, "last_pass_seconds", "the taint names the legitimate widening channel")
	result, code := computeResult(0, 0, taints)
	require.Equal(t, "tainted", result, "zero gated failures + the env taint is STILL not a pass — structurally (round-10 F2)")
	require.Equal(t, exitVerdictFail, code)

	// The resolver and the taint judge see ONE value: tightening the env to
	// the canonical default clears both.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "1h")
	interval, _ = resolveSnapshotInterval()
	require.Equal(t, time.Hour, interval)
	require.Empty(t, envAcceptanceTaints())
}
