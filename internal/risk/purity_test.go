package risk

// Package-purity enforcement (design spec §11; plan Task 4: "no I/O imports
// permitted (enforced by a package-import test)" and "NO float64 anywhere in
// computation paths").
//
// These two tests are structural, not behavioural: they read this package's
// own source and fail on anything that could put a rounding error or a
// hidden read into a number a risk decision-maker sees.

import (
	"go/ast"
	"go/parser"
	"go/scanner"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// allowedImports is the EXHAUSTIVE set this package's non-test sources may
// import. The test fails on anything outside it, which is stronger than a
// deny-list: a new I/O package cannot be admitted by forgetting to ban it.
//
//	embed          compile-time inclusion of the scenario definitions; the
//	               embedded FS is an in-memory byte slice, not a filesystem
//	encoding/json  scenario schema
//	errors, fmt    error construction
//	math/big       ALL arithmetic
//	sort, strings  determinism and key handling
//	time           as-of stamps carried through, never READ (no time.Now)
//	common         go-ethereum's address type
//
// Transitive caveat, stated rather than hidden: go-ethereum/common pulls in
// `database/sql/driver` because Hash/Address implement Scanner and Valuer.
// Those are type tags on a 20-byte array; nothing in that path opens a
// connection, and this package calls none of it. A direct-import allowlist is
// the enforceable law; the transitive claim is "no I/O is PERFORMED", which
// the absence of any os/net/database call in these sources establishes.
var allowedImports = map[string]bool{
	"embed":                                  true,
	"encoding/json":                          true,
	"errors":                                 true,
	"fmt":                                    true,
	"math/big":                               true,
	"sort":                                   true,
	"strings":                                true,
	"time":                                   true,
	"github.com/ethereum/go-ethereum/common": true,
}

// bannedImportPrefixes produce a clearer failure than "not in the allowlist"
// for the specific classes the design names.
var bannedImportPrefixes = []string{
	"database/sql",
	"net",
	"os",
	"io/ioutil",
	"os/exec",
	"path/filepath",
	"bufio",
	"log",
	"syscall",
	"github.com/jackc/pgx",
	"github.com/kaselunt/solvent/internal/store",
	"github.com/kaselunt/solvent/internal/chain",
	"github.com/kaselunt/solvent/internal/prices",
	"github.com/kaselunt/solvent/internal/ingest",
}

// nonTestSources lists this package's .go files excluding _test.go.
func nonTestSources(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(".")
	require.NoError(t, err)
	var out []string
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".go") || strings.HasSuffix(n, "_test.go") {
			continue
		}
		out = append(out, n)
	}
	sort.Strings(out)
	require.NotEmpty(t, out, "the package must have sources to check")
	return out
}

// TestPackageIsIOFree parses every non-test source and enforces the import
// allowlist.
func TestPackageIsIOFree(t *testing.T) {
	files := nonTestSources(t)
	t.Logf("checking %d non-test sources: %s", len(files), strings.Join(files, " "))

	seen := map[string][]string{}
	fset := token.NewFileSet()
	for _, f := range files {
		af, err := parser.ParseFile(fset, f, nil, parser.ImportsOnly)
		require.NoError(t, err, f)
		for _, imp := range af.Imports {
			path, err := strconv.Unquote(imp.Path.Value)
			require.NoError(t, err)
			seen[path] = append(seen[path], f)
		}
	}

	for path, in := range seen {
		for _, banned := range bannedImportPrefixes {
			require.False(t, path == banned || strings.HasPrefix(path, banned+"/"),
				"%s imports the banned package %q — internal/risk performs zero I/O", strings.Join(in, ","), path)
		}
		require.True(t, allowedImports[path],
			"%s imports %q, which is not on internal/risk's import allowlist; if it is genuinely pure, add it to allowedImports WITH a justification",
			strings.Join(in, ","), path)
	}

	// The allowlist must not rot into a list of packages nobody imports.
	for path := range allowedImports {
		require.Contains(t, seen, path, "allowlist entry %q is unused — drop it", path)
	}
}

// TestNoTimeNowOrRandInSources: the package carries as-of stamps, it never
// reads a clock, and it has no randomness. Both would make a served number
// non-reproducible from its stored inputs.
func TestNoTimeNowOrRandInSources(t *testing.T) {
	fset := token.NewFileSet()
	for _, f := range nonTestSources(t) {
		af, err := parser.ParseFile(fset, f, nil, 0)
		require.NoError(t, err, f)
		ast.Inspect(af, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			ident, ok := sel.X.(*ast.Ident)
			if !ok {
				return true
			}
			require.False(t, ident.Name == "time" && sel.Sel.Name == "Now",
				"%s: %s calls time.Now — a risk number must be reproducible from its stored inputs", f, fset.Position(n.Pos()))
			require.NotEqual(t, "rand", ident.Name,
				"%s: %s uses rand", f, fset.Position(n.Pos()))
			return true
		})
	}
}

// TestNoFloatInNonTestSources tokenizes each source with comments SKIPPED and
// fails on any float type, float literal, or imaginary literal.
//
// Tokenizing rather than grepping matters: a doc comment may legitimately say
// "float", and a grep over raw bytes would either flag it or force the comment
// to be reworded. What must not exist is a float in the CODE.
func TestNoFloatInNonTestSources(t *testing.T) {
	for _, f := range nonTestSources(t) {
		src, err := os.ReadFile(f)
		require.NoError(t, err)

		fset := token.NewFileSet()
		file := fset.AddFile(f, fset.Base(), len(src))
		var s scanner.Scanner
		s.Init(file, src, func(pos token.Position, msg string) {
			t.Fatalf("%s: scan error at %s: %s", f, pos, msg)
		}, 0) // mode 0 ⇒ comments are not emitted

		for {
			pos, tok, lit := s.Scan()
			if tok == token.EOF {
				break
			}
			switch tok {
			case token.FLOAT, token.IMAG:
				t.Fatalf("%s: %s: %s literal %q — internal/risk computes in *big.Int only",
					f, fset.Position(pos), tok, lit)
			case token.IDENT:
				require.NotContains(t, []string{"float32", "float64", "complex64", "complex128"}, lit,
					"%s: %s: %s appears in code", f, fset.Position(pos), lit)
			}
		}
	}
}

// jsonNumberWithFraction matches a JSON numeric value carrying a decimal point
// or an exponent.
var jsonNumberWithFraction = regexp.MustCompile(`:\s*-?\d+(\.\d+|[eE][-+]?\d+)`)

// TestScenarioDefinitionsCarryNoFloats: a shock of "0.8" in a committed file
// would be a float in the definition of a public number. Factors are exact
// rationals (factor_num / factor_den) and every large value is a decimal
// STRING, so no committed scenario may contain a fractional JSON number.
func TestScenarioDefinitionsCarryNoFloats(t *testing.T) {
	names, err := ScenarioFilenames()
	require.NoError(t, err)
	require.NotEmpty(t, names)
	for _, n := range names {
		b, err := os.ReadFile(filepath.Join(scenarioDir, n))
		require.NoError(t, err)
		require.NotRegexp(t, jsonNumberWithFraction, string(b),
			"%s contains a fractional JSON number; factors are exact rationals and big values are decimal strings", n)
	}
}

// TestEmbeddedScenariosMatchTheCommittedFiles proves the compiled-in bytes are
// the bytes on disk, so "recomputable from committed inputs" is a fact rather
// than a hope.
func TestEmbeddedScenariosMatchTheCommittedFiles(t *testing.T) {
	names, err := ScenarioFilenames()
	require.NoError(t, err)

	onDisk, err := os.ReadDir(scenarioDir)
	require.NoError(t, err)
	var diskNames []string
	for _, e := range onDisk {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			diskNames = append(diskNames, e.Name())
		}
	}
	sort.Strings(diskNames)
	require.Equal(t, diskNames, names, "every committed scenario file must be embedded, and vice versa")

	for _, n := range names {
		want, err := os.ReadFile(filepath.Join(scenarioDir, n))
		require.NoError(t, err)
		got, err := scenarioFS.ReadFile(scenarioDir + "/" + n)
		require.NoError(t, err)
		require.Equal(t, string(want), string(got), "%s: embedded bytes differ from the committed file", n)
	}
}
