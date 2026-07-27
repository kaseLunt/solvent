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
	"os/exec"
	"path/filepath"
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

// pgxModuleEnvReads enumerates the env surface of the LINKED pgx module from
// its ACTUAL source in the module cache (round-14 F1): (a) the
// parseEnvSettings nameMap keys in pgconn/config.go — pgx's connect-time
// PG* lookup is a DYNAMIC os.Getenv(envname) over that map (line 429), so a
// literal scan alone cannot see it — and (b) every LITERAL os.Getenv /
// os.LookupEnv argument in the module's non-test, non-example sources
// (catches pgconn/defaults_windows.go's APPDATA read). A pgx upgrade that
// grows either set fails the closure test until the table is re-closed.
func pgxModuleEnvReads(t *testing.T) (nameMapKeys, literals map[string]bool) {
	t.Helper()
	out, err := exec.Command("go", "list", "-m", "-f", "{{.Dir}}", "github.com/jackc/pgx/v5").Output()
	require.NoError(t, err, "locate the pgx module in the module cache")
	modDir := strings.TrimSpace(string(out))
	require.NotEmpty(t, modDir)

	nameMapKeys = map[string]bool{}
	literals = map[string]bool{}
	fset := token.NewFileSet()
	walkErr := filepath.WalkDir(modDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			// examples/ are package main and never linked; testdata is not code.
			if d.Name() == "examples" || d.Name() == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			x, ok := sel.X.(*ast.Ident)
			if !ok || x.Name != "os" || (sel.Sel.Name != "Getenv" && sel.Sel.Name != "LookupEnv") || len(call.Args) != 1 {
				return true
			}
			if lit, ok := call.Args[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
				literals[strings.Trim(lit.Value, `"`)] = true
			}
			return true
		})
		// The nameMap: inside parseEnvSettings, a map literal whose keys are
		// the PG* env names (pgconn/config.go:408-425 in v5.5.1).
		ast.Inspect(f, func(n ast.Node) bool {
			fd, ok := n.(*ast.FuncDecl)
			if !ok || fd.Name.Name != "parseEnvSettings" {
				return true
			}
			ast.Inspect(fd, func(m ast.Node) bool {
				cl, ok := m.(*ast.CompositeLit)
				if !ok {
					return true
				}
				for _, elt := range cl.Elts {
					kv, ok := elt.(*ast.KeyValueExpr)
					if !ok {
						continue
					}
					if k, ok := kv.Key.(*ast.BasicLit); ok && k.Kind == token.STRING {
						if name := strings.Trim(k.Value, `"`); strings.HasPrefix(name, "PG") {
							nameMapKeys[name] = true
						}
					}
				}
				return true
			})
			return false
		})
		return nil
	})
	require.NoError(t, walkErr)
	require.True(t, nameMapKeys["PGHOST"] && nameMapKeys["PGDATABASE"],
		"sanity: the pgx enumeration must have found parseEnvSettings' nameMap")
	require.True(t, literals["APPDATA"],
		"sanity: the pgx enumeration must have seen pgconn/defaults_windows.go's APPDATA read")
	return nameMapKeys, literals
}

// TestEnvSurfaceClosed is the env twin of TestFlagSurfaceClosed (round-11
// F1 → round-13 F1), extended by round-14 F1 to the LINKED-LIBRARY surface:
// the generator must be closed over the entire env surface of the binary's
// first-party source closure AND over everything pgx reads at connect time,
// enumerated from pgx's own source rather than asserted from memory.
func TestEnvSurfaceClosed(t *testing.T) {
	classified := map[string]envSpec{}
	var linkedRows []string
	for _, spec := range reconEnvSurface {
		require.NotContains(t, classified, spec.Name, "env var %s classified twice", spec.Name)
		require.NotEmpty(t, spec.Why, "env var %s carries no justification", spec.Name)
		switch spec.Class {
		case envTaints:
			require.NotNil(t, spec.Taint, "env var %s is class taints but has no taint judge", spec.Name)
		case envLinkedLibrary:
			linkedRows = append(linkedRows, spec.Name)
			if spec.Name == "APPDATA" {
				// The ONE justified verdict-free linked row (Windows default
				// passfile path — subject-inert, unconditionally set on
				// Windows; see the table row's Why).
				require.Nil(t, spec.Taint)
			} else {
				require.NotNil(t, spec.Taint, "linked-library env var %s must presence-taint (round-14 F1)", spec.Name)
			}
		default:
			require.Nil(t, spec.Taint, "env var %s is class %s but carries a taint judge", spec.Name, spec.Class)
		}
		classified[spec.Name] = spec
	}

	// (0) LINKED-LIBRARY closure, BOTH directions, against pgx's real source:
	// every env name pgx can read is classified, and every linked-library
	// row corresponds to a read that actually exists in the linked module.
	nameMapKeys, pgxLiterals := pgxModuleEnvReads(t)
	pgxReads := map[string]bool{}
	for n := range nameMapKeys {
		pgxReads[n] = true
	}
	for n := range pgxLiterals {
		pgxReads[n] = true
	}
	for name := range pgxReads {
		require.Contains(t, classified, name,
			"pgx reads env %q (module source scan) and the table does not classify it — the linked-library surface grew (round-14 F1); close the table over it", name)
		require.Equal(t, envLinkedLibrary, classified[name].Class,
			"env %q is read by pgx and must be classified linked-library", name)
	}
	for _, name := range linkedRows {
		require.True(t, pgxReads[name],
			"table classifies %s as linked-library but no pgx source reads it (stale row)", name)
	}
	// And the code's own name list (pgxEnvSurface, which builds the taint
	// rows) must equal the nameMap exactly — the generator and the
	// enumeration can never disagree.
	require.Len(t, pgxEnvSurface, len(nameMapKeys), "pgxEnvSurface must mirror pgx's nameMap exactly")
	for _, n := range pgxEnvSurface {
		require.True(t, nameMapKeys[n], "pgxEnvSurface lists %s, which is not in pgx's parseEnvSettings nameMap", n)
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
	// a literal scan hit, a canonical rpcEnv key, or (linked-library rows)
	// a read in pgx's own source, already verified both ways in step (0).
	// A stale row is a claim about a read that no longer exists.
	for name := range classified {
		if classified[name].Class == envLinkedLibrary {
			continue
		}
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
	clearPgxEnv(t)
	var errBuf bytes.Buffer
	// Pre-DB (syntax) taints: values no daemon state could ever legitimize.
	for _, v := range []string{"bogus", "-5m", "0s"} {
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
	// Round-14 F4: syntactically-valid over-default values are NOT judged
	// pre-DB any more — they are judged against the daemon-persisted cadence
	// inside Phase 1 (sweepCadenceEvaluation): with no persisted interval
	// the wave-15 cap still refuses them; with a MATCHING persisted interval
	// they are clean (the fail-forever posture died — see cadence_f4_test).
	for _, v := range []string{"1000000h", "61m", "2h", "24h"} {
		t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", v)
		o, err := parseFlags(nil, &errBuf)
		require.NoError(t, err)
		require.Empty(t, acceptanceTaints(o),
			"SOLVENT_SNAPSHOT_INTERVAL=%q is judged against the persisted daemon cadence in Phase 1, not pre-DB (round-14 F4)", v)
		_, _, taints := sweepCadenceEvaluation(store.SweepGenerationState{}) // no persisted row: wave-15 law
		require.NotEmpty(t, taints, "with NO persisted daemon cadence, SOLVENT_SNAPSHOT_INTERVAL=%s must still taint (fallback keeps the wave-15 1h cap)", v)
		result, _ := computeResult(0, 0, taints)
		require.NotEqual(t, "pass", result)
	}
	// Canonical/tighter values do not taint: unset, the default restated,
	// and tighter-than-default (which can only strengthen the bound).
	for _, v := range []string{"", "1h", "60m", "30m", "1s"} {
		t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", v)
		o, err := parseFlags(nil, &errBuf)
		require.NoError(t, err)
		require.Empty(t, acceptanceTaints(o), "SOLVENT_SNAPSHOT_INTERVAL=%q weakens nothing and must not taint", v)
	}

	// (6) Round-14 F1: every pgx-read PG* variable presence-taints through
	// the SAME generator, and the taint reaches the verdict. Empty-string
	// values do NOT taint — that mirrors pgx's own emptiness rule
	// (pgconn/config.go:429-431), so neutralizing == unsetting.
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "")
	for _, name := range pgxEnvSurface {
		t.Setenv(name, "surprise-value")
		o, err := parseFlags(nil, &errBuf)
		require.NoError(t, err)
		taints := acceptanceTaints(o)
		require.NotEmpty(t, taints, "%s present must taint acceptance (round-14 F1)", name)
		require.Contains(t, strings.Join(taints, "\n"), name, "the taint must name %s", name)
		result, code := computeResult(0, 0, taints)
		require.NotEqual(t, "pass", result, "%s present can never produce pass", name)
		require.NotEqual(t, exitPass, code)
		t.Setenv(name, "")
		o, err = parseFlags(nil, &errBuf)
		require.NoError(t, err)
		require.Empty(t, acceptanceTaints(o), "%s empty is absent under pgx's own rule and must not taint", name)
	}
	// APPDATA: classified, deliberately verdict-free (see the table row).
	t.Setenv("APPDATA", `C:\Users\example\AppData\Roaming`)
	o, err := parseFlags(nil, &errBuf)
	require.NoError(t, err)
	require.Empty(t, acceptanceTaints(o), "APPDATA is subject-inert and must not taint (Windows sets it unconditionally)")
}

// clearPgxEnv neutralizes every pgx-read variable for the duration of a
// test, using pgx's own emptiness rule (empty == absent) so assertions about
// OTHER taints are hermetic on machines that happen to export PG*.
func clearPgxEnv(t *testing.T) {
	t.Helper()
	for _, name := range pgxEnvSurface {
		t.Setenv(name, "")
	}
}

// TestExtremeSnapshotIntervalEnvIsNonPass is the round-13 F1 BINDING
// regression: env → freshness bound → verdict with an extreme positive
// interval. It first demonstrates the hole the finding names — under the
// inflated bound, a snapshot refreshed YEARS ago classifies "fresh" and
// contributes zero gate failures — and then proves the verdict chain refuses
// anyway. Since round-14 F4 the refusal runs through sweepCadenceEvaluation
// (the same evaluation runPhase1 wires into execute's taint set): with NO
// persisted daemon cadence the wave-15 1h cap holds unchanged, and no
// persisted cadence can ever equal 1000000h anyway (config.Load would have
// refused... nothing legitimizes it: a mismatch taints, a match cannot
// exist because the daemon itself validated its interval). Mutation W15M1
// (acceptance cap removed) must die here.
func TestExtremeSnapshotIntervalEnvIsNonPass(t *testing.T) {
	clearPgxEnv(t)
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

	// And the verdict chain refuses regardless: the SAME evaluation
	// runPhase1 performs (bound and taints from one judgment), fed to the
	// SAME computeResult execute() uses. No persisted daemon cadence exists
	// here — the wave-15 fallback law refuses the loose env claim.
	evalBound, evalInputs, taints := sweepCadenceEvaluation(store.SweepGenerationState{})
	require.Equal(t, bound, evalBound, "no silent clamp in the fallback — the recorded bound tells the whole story")
	require.Contains(t, evalInputs, "fallback")
	require.NotEmpty(t, taints)
	joined := strings.Join(taints, "\n")
	require.Contains(t, joined, "SOLVENT_SNAPSHOT_INTERVAL=1000000h", "the taint names the env var and value")
	require.Contains(t, joined, "last_pass_seconds", "the taint names the legitimate widening channel")
	result, code := computeResult(0, 0, taints)
	require.Equal(t, "tainted", result, "zero gated failures + the env taint is STILL not a pass — structurally (round-10 F2)")
	require.Equal(t, exitVerdictFail, code)

	// And a PERSISTED cadence cannot legitimize it either: any persisted
	// value ≠ 1000000h makes the env claim a MISMATCH taint, and the bound
	// comes from the persisted value — never widened by the env claim.
	persisted := int64(7200)
	pBound, _, pTaints := sweepCadenceEvaluation(store.SweepGenerationState{Found: true, ConfiguredIntervalSeconds: &persisted})
	require.Equal(t, 4*time.Hour, pBound, "bound = 2×(2h+0) from the PERSISTED row — the 1000000h env claim never touches it")
	require.NotEmpty(t, pTaints, "env-vs-persisted mismatch must taint")
	result, _ = computeResult(0, 0, pTaints)
	require.NotEqual(t, "pass", result)

	// The resolver and the taint judge see ONE value: tightening the env to
	// the canonical default clears both (fallback path, no persisted row).
	t.Setenv("SOLVENT_SNAPSHOT_INTERVAL", "1h")
	interval, _ = resolveSnapshotInterval()
	require.Equal(t, time.Hour, interval)
	require.Empty(t, envAcceptanceTaints())
	_, _, clean := sweepCadenceEvaluation(store.SweepGenerationState{})
	require.Empty(t, clean)
}
