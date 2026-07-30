package main

// Structural enforcement of this binary's two defining laws: it makes ZERO RPC
// calls, and it NEVER writes.
//
// Both are normally defended by a comment and a reviewer's memory. Here the
// first is defended by the LINK GRAPH and the second by a scan of this package's
// own SQL — which is strictly stronger than auditing call sites, because it also
// forecloses the change that adds one later.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// forbiddenDeps are packages whose PRESENCE anywhere in cmd/api's transitive
// dependency set is a failure. The list is cmd/riskd's, for the same reasons:
//
//	internal/chain    the RPC client itself
//	internal/ingest   the walker, which reads chain
//	internal/prices   the poller/feed deriver; both dial providers
//	internal/derive   the derivers, which hold chain readers
//	internal/snapshot the collateral sweeper, which multicalls
//	ethclient / rpc   go-ethereum's transports
//
// internal/store and pgx are ABSENT on purpose: every input is a durable store
// fact, and a database is not a provider. The law is about chain testimony, not
// about I/O.
var forbiddenDeps = []string{
	"github.com/kaselunt/solvent/internal/chain",
	"github.com/kaselunt/solvent/internal/ingest",
	"github.com/kaselunt/solvent/internal/prices",
	"github.com/kaselunt/solvent/internal/derive",
	"github.com/kaselunt/solvent/internal/snapshot",
	"github.com/ethereum/go-ethereum/ethclient",
	"github.com/ethereum/go-ethereum/rpc",
}

// TestAPILinksNoChainClient is the zero-RPC law, proven rather than asserted.
func TestAPILinksNoChainClient(t *testing.T) {
	out, err := exec.Command("go", "list", "-deps", ".").Output()
	require.NoError(t, err, "go list -deps must succeed to prove the link graph")

	deps := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			deps[line] = true
		}
	}
	require.NotEmpty(t, deps)
	// Sanity: the graph really was read. Without these a truncated read would
	// pass every assertion below vacuously.
	require.True(t, deps["github.com/kaselunt/solvent/internal/store"],
		"cmd/api must depend on internal/store — if this is missing the dependency list was not read correctly and the assertions below prove nothing")
	require.True(t, deps["github.com/kaselunt/solvent/internal/risk"])
	require.True(t, deps["github.com/kaselunt/solvent/internal/riskfeed"])
	require.True(t, deps["golang.org/x/time/rate"],
		"the rate limiter must be x/time/rate — if this is missing the graph was not read")

	for _, forbidden := range forbiddenDeps {
		require.False(t, deps[forbidden],
			"cmd/api must not link %s: every served number is a durable store fact, and a chain client in this binary would let a lag or a freshness verdict be computed against provider testimony this layer has no custody machinery to judge (design spec §2, §10)",
			forbidden)
	}
}

// writingSQL matches a statement that could MUTATE state.
//
// The pattern deliberately includes LISTEN's siblings by omission: LISTEN is a
// read-side subscription and is allowed; NOTIFY, which publishes, is not — this
// service consumes the doorbell riskd rings and must never ring one itself.
var writingSQL = regexp.MustCompile(`(?i)\b(INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE|GRANT|NOTIFY|pg_notify|SELECT\s+FOR\s+UPDATE|pg_advisory_lock)\b`)

// TestAPIIssuesNoWritingSQL scans every STRING LITERAL in this package's
// non-test sources for a mutating statement.
//
// A read-only API is a claim about behaviour that a reviewer cannot verify by
// reading one function. This makes it a property of the package's text: no
// INSERT, no UPDATE, no DELETE, no DDL, no NOTIFY, no lock acquisition. The
// advisory-lock clause matters independently — riskd holds the materializer lock,
// and an api instance taking it would exclude the daemon that produces the data
// it serves.
//
// It scans LITERALS rather than raw bytes on purpose. SQL only ever reaches the
// database through a string, so literals are the complete surface; scanning raw
// file bytes instead flagged the word NOTIFY inside a comment EXPLAINING that
// this service only ever consumes the doorbell — a false positive that would have
// been silenced by weakening the pattern, which is the wrong direction.
func TestAPIIssuesNoWritingSQL(t *testing.T) {
	files, err := filepath.Glob("*.go")
	require.NoError(t, err)
	require.NotEmpty(t, files)

	scannedFiles, scannedLiterals := 0, 0
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, f, nil, 0) // 0: comments discarded
		require.NoError(t, err)
		scannedFiles++
		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			scannedLiterals++
			if m := writingSQL.FindString(lit.Value); m != "" {
				t.Errorf("%s:%d contains a MUTATING statement in a string literal (%q). "+
					"cmd/api is read-only: schema ownership belongs to the indexer's startup path, "+
					"the risk tables have exactly one writer (riskd), and the doorbell is consumed here, never published.",
					f, fset.Position(lit.Pos()).Line, m)
			}
			return true
		})
	}
	// Anti-vacuity: without these, an empty glob or a parser that yielded no
	// literals would pass while proving nothing.
	require.GreaterOrEqual(t, scannedFiles, 5,
		"expected at least the five topic files to be scanned")
	require.Greater(t, scannedLiterals, 50,
		"expected the package's string literals to be reached; a scan of almost none cannot establish the read-only property")

	// The scanner itself must be able to fail. Without this, a broken regex would
	// make every assertion above vacuous.
	require.NotEmpty(t, writingSQL.FindString(`"INSERT INTO risk_positions (batch_id) VALUES ($1)"`))
	require.NotEmpty(t, writingSQL.FindString(`"SELECT pg_advisory_lock($1)"`))
	require.Empty(t, writingSQL.FindString(`"SELECT now()"`))
	require.Empty(t, writingSQL.FindString(`"LISTEN risk_batch"`))
}

// TestAPINeverMigrates pins that the migration entrypoint is absent from this
// package's text. store.Migrate is one call away and a well-meaning change could
// add it to make a fresh database "just work" — which would make a public read
// surface a second schema authority.
func TestAPINeverMigrates(t *testing.T) {
	files, err := filepath.Glob("*.go")
	require.NoError(t, err)
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		b, err := os.ReadFile(f)
		require.NoError(t, err)
		require.NotContains(t, string(b), "store.Migrate",
			"%s calls store.Migrate: api GATES on the schema version and never migrates", f)
	}
}
