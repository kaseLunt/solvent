// Package pipelinereplay holds P3 Task 3's OPT-IN pipeline-replay harness:
// the WHOLE Solvent ingest→decode→derive pipeline driven end-to-end against a
// local anvil fork of ETH mainnet, with every layer's output welded to chain
// truth read back through the same fork.
//
// This file is the harness plumbing (anvil lifecycle, derived scratch DB,
// ABI/call helpers, the thin risk-gate consumer); pipeline_replay_test.go
// holds the three legs and their assertions.
//
// # Opt-in contract (plan §Task 3; chain-truth brief R5, NORMATIVE)
//
//   - SKIPS cleanly, with a named reason, unless BOTH ANVIL_BIN (path to
//     Foundry's anvil — NOT on PATH on this box) and ANVIL_FORK_RPC_ETH (an
//     ARCHIVE-capable ETH mainnet RPC anvil forks from) are set.
//   - Once opted in, every subsequent problem FAILS — never skips: a missing
//     TEST_DATABASE_URL, anvil startup timeout, a fork serving a block whose
//     hash differs from the frozen pin, an RPC error, a DB error, a walker
//     window DISCARD. This mirrors internal/forkreplay's Task-10 posture
//     exactly, which is the pattern this harness was told to follow.
//
// # Why ANVIL_FORK_RPC_ETH and not Task 10's ANVIL_FORK_RPC
//
// ANVIL_FORK_RPC is the OP endpoint (Task 10 forks OP for the Debt Manager).
// Task 3 forks ETH mainnet, so it needs its own variable. Per brief R5 + A3
// the ETH fork upstream is the ARCHIVE-COMPLETE Alchemy key with a hard
// 10-block eth_getLogs cap — this harness is exactly the "targeted fallback"
// carve-out that key is sanctioned for (opt-in, on-demand, ~100 upstream
// getLogs per full run), never bulk backfill traffic. That cap is why every
// leg configures the walker with Window 10 instead of the production 2000:
// anvil PROXIES pre-fork eth_getLogs to the upstream verbatim, so the
// upstream's cap is the harness's cap.
//
// # Credential hygiene
//
// anvil's startup banner prints its fork Endpoint, and anvil relays upstream
// provider errors verbatim — both can carry the fork URL's API key. Every
// sink in this package (t.Log, t.Fatal, relayed RPC error text) goes through
// sanitizeForkOutput first, the same round-22 F3 discipline as
// internal/forkreplay. Over-redaction of diagnostics is acceptable; a leaked
// key is not.
//
// # Build posture
//
// Runtime env checks, never build tags — the harness compiles and vets in
// every `go build ./... && go vet ./...` whether or not anyone has opted in.
package pipelinereplay

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

const (
	envAnvilBin = "ANVIL_BIN"
	envForkRPC  = "ANVIL_FORK_RPC_ETH"

	// ethChainID is the chain every leg binds to. anvil forking mainnet
	// reports 1; VerifyChainID asserts it before any walk.
	ethChainID = uint64(1)

	// forkWindow is the walker window every leg uses: the upstream's hard
	// 10-block eth_getLogs cap, which anvil proxies pre-fork requests into
	// verbatim (brief R5). NOT the production 2000.
	forkWindow = uint64(10)

	// forkConfirmations is deliberately small (production is 5): the fork's
	// head does not advance on its own, so confirmations are pure headroom
	// between the pin and the highest walkable block, and every block of
	// headroom is a block of subject range given up.
	forkConfirmations = uint64(2)

	// anvilStartupTimeout bounds startup-to-serving. Once opted in, blowing
	// it is a FAILURE, never a skip.
	anvilStartupTimeout = 120 * time.Second

	// rpcTimeout bounds every single JSON-RPC call at the fork. Generous
	// because a cold pre-fork read is an upstream round trip.
	rpcTimeout = 180 * time.Second

	// maxDrainSteps bounds each walker/runner drain loop. A pipeline that
	// has not caught up within this many bounded Steps is wedged, and a
	// wedge must FAIL loudly rather than spin.
	maxDrainSteps = 400
)

// ---------------------------------------------------------------------------
// Opt-in gate
// ---------------------------------------------------------------------------

// optIn is THE gate. It is the only place in the package permitted to skip.
func optIn(t *testing.T) (anvilBin, forkRPC string) {
	t.Helper()
	anvilBin = os.Getenv(envAnvilBin)
	forkRPC = os.Getenv(envForkRPC)
	var missing []string
	if anvilBin == "" {
		missing = append(missing, envAnvilBin)
	}
	if forkRPC == "" {
		missing = append(missing, envForkRPC)
	}
	if len(missing) > 0 {
		t.Skipf("opt-in pipeline replay (P3 Task 3): %s unset — set both to run; see .env.example", strings.Join(missing, " and "))
	}
	return anvilBin, forkRPC
}

// ---------------------------------------------------------------------------
// Credential sanitization (mirrors internal/forkreplay round-22 F3)
// ---------------------------------------------------------------------------

var (
	urlUserinfoRe  = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://)[^/\s@]+@`)
	urlCredQueryRe = regexp.MustCompile(`(?i)\b((?:api[-_]?key|apikey|dkey|key|token|secret|auth|password)=)[^&\s"']+`)
	urlKeyPathRe   = regexp.MustCompile(`(://[^\s"']+/)[A-Za-z0-9_-]{20,}`)
)

// sanitizeForkOutput removes the fork credential from any string bound for a
// log/failure sink. Exact-URL replacement first (covers anvil's banner), then
// URL userinfo, then credential-shaped query parameters, then long opaque
// path segments (Alchemy-style /v2/<key>).
func sanitizeForkOutput(s, forkURL string) string {
	if forkURL != "" {
		s = strings.ReplaceAll(s, forkURL, "<fork-url redacted>")
	}
	s = urlUserinfoRe.ReplaceAllString(s, "${1}<redacted>@")
	s = urlCredQueryRe.ReplaceAllString(s, "${1}<redacted>")
	s = urlKeyPathRe.ReplaceAllString(s, "${1}<redacted>")
	return s
}

// TestSanitizeForkOutputRedactsSecrets is the sanitizer's own regression: a
// synthetic credential-bearing fork URL embedded in synthetic anvil output —
// banner echo, userinfo form, opaque-path form, query-parameter form — must
// never survive sanitization. PURE UNIT: no env gate, no anvil, no DB; it
// runs in every `go test ./...`, which is the point — the sanitizer is the
// one part of this package that must be proven even when nobody opts in.
func TestSanitizeForkOutputRedactsSecrets(t *testing.T) {
	// Deliberately NOT shaped like any real provider's key prefix: GitHub
	// push protection pattern-matches those shapes and would block the push
	// even for a synthetic fixture. The sanitizer keys on parameter names,
	// userinfo and opaque-segment length — never on prefixes.
	const secret = "FAKESECRETTOKEN1234567890abcdefFAKE"
	forkURL := "https://eth-mainnet.example.org/v2/" + secret
	out := strings.Join([]string{
		"Fork", "Endpoint:       " + forkURL, // anvil banner shape
		"error: request to https://user:" + secret + "@rpc.example.com/ failed",
		"upstream https://eth-mainnet.g.example.com/v2/" + secret + " returned 429",
		"retrying " + forkURL + "?x=1 after backoff",
		`{"error":"apikey=` + secret + ` rejected"}`,
	}, "\n")

	got := sanitizeForkOutput(out, forkURL)
	require.NotContains(t, got, secret, "the credential must never survive sanitization")
	require.Contains(t, got, "<fork-url redacted>", "the exact fork URL is replaced wholesale")
	require.Contains(t, got, "https://<redacted>@rpc.example.com/", "userinfo credentials are redacted, host preserved for diagnostics")

	// Defensive arm: sanitize must not REQUIRE the URL to be known.
	got = sanitizeForkOutput(out, "")
	require.NotContains(t, got, secret, "regex redaction alone must also remove the credential")
}

// ---------------------------------------------------------------------------
// anvil fork lifecycle
// ---------------------------------------------------------------------------

// syncBuffer is a mutex-guarded buffer for anvil's combined output: exec
// writes from its own goroutines while the startup loop may read on failure.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// anvilFork is one running fork plus the RPC handle every helper here calls
// through. All output that could carry the fork credential is sanitized.
type anvilFork struct {
	t        *testing.T
	endpoint string
	forkURL  string
	pinBlock uint64
	out      *syncBuffer
	rc       *rpc.Client
}

// startAnvilFork spawns anvil forked at pinBlock on a dynamically-chosen
// localhost port, waits (bounded) until it serves that block, asserts the
// PROVIDER-REPORTED hash equals the frozen pin hash, and registers cleanup.
//
// --no-mining is unconditional (brief R5): the fork's height must move only
// when a leg says so. Legs 1 and 2 never mine at all, so their head is
// exactly the pin for the whole run; leg 3 drives height with anvil_mine.
//
// CHAIN TRUTH: the pin hash comes from the fork's own
// eth_getBlockByNumber().hash — the PROVIDER-REPORTED field, never a local
// header recompute (internal/chain's standing posture). A fork of the wrong
// chain, or an upstream serving a different history, fails here before a
// single log is walked.
func startAnvilFork(t *testing.T, bin, forkURL string, pinBlock uint64, pinHash common.Hash) *anvilFork {
	t.Helper()
	port := freePort(t)
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)

	out := &syncBuffer{}
	// The fork-request tuning matches internal/forkreplay's: the designated
	// upstream is a free-tier key SHARED with the live indexer (probe A3), so
	// anvil's fetch bursts are throttled and its upstream retries are patient
	// rather than aggressive.
	cmd := exec.Command(bin,
		"--fork-url", forkURL,
		"--fork-block-number", strconv.FormatUint(pinBlock, 10),
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(port),
		"--no-mining",
		"--compute-units-per-second", "300",
		"--timeout", "45000",
		"--retries", "10",
		"--fork-retry-backoff", "1000",
	)
	cmd.Stdout = out
	cmd.Stderr = out
	require.NoErrorf(t, cmd.Start(), "spawn anvil at %s", bin)

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		select {
		case <-exited:
		case <-time.After(10 * time.Second):
			t.Log("anvil did not exit within 10s of Kill")
		}
	})

	f := &anvilFork{t: t, endpoint: endpoint, forkURL: forkURL, pinBlock: pinBlock, out: out}
	deadline := time.Now().Add(anvilStartupTimeout)
	for {
		select {
		case err := <-exited:
			t.Fatalf("anvil exited before serving the fork at %d (%s) — opted-in runs FAIL, never skip; anvil output:\n%s",
				pinBlock, f.scrub(fmt.Sprintf("%v", err)), f.scrub(out.String()))
		default:
		}
		if h, ok := reportedHash(endpoint, pinBlock); ok {
			require.Equalf(t, pinHash, h,
				"fork chain-truth check FAILED: eth_getBlockByNumber(%d) through the fork reports hash %s, the frozen pin demands %s — the fork upstream is serving the wrong chain or a different history",
				pinBlock, h.Hex(), pinHash.Hex())
			rc, err := rpc.DialContext(context.Background(), endpoint)
			require.NoError(t, err, "dial the anvil endpoint")
			t.Cleanup(rc.Close)
			f.rc = rc
			t.Logf("anvil fork up at pin %d (%s), --no-mining, endpoint %s", pinBlock, pinHash.Hex(), endpoint)
			return f
		}
		if time.Now().After(deadline) {
			t.Fatalf("anvil did not serve pinned block %d within %s (startup timeout) — opted-in runs FAIL, never skip; anvil output:\n%s",
				pinBlock, anvilStartupTimeout, f.scrub(out.String()))
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// scrub sanitizes any string bound for a log/failure sink on this fork.
func (a *anvilFork) scrub(s string) string { return sanitizeForkOutput(s, a.forkURL) }

// freePort asks the kernel for an unused localhost TCP port.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err, "reserve a dynamic port for anvil")
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	return port
}

// reportedHash reads a block's PROVIDER-REPORTED hash. ok=false while anvil
// is not yet serving (the startup poll's only tolerated failure).
func reportedHash(endpoint string, block uint64) (common.Hash, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rc, err := rpc.DialContext(ctx, endpoint)
	if err != nil {
		return common.Hash{}, false
	}
	defer rc.Close()
	var blk *struct {
		Hash common.Hash `json:"hash"`
	}
	if err := rc.CallContext(ctx, &blk, "eth_getBlockByNumber", hexutilUint(block), false); err != nil || blk == nil {
		return common.Hash{}, false
	}
	return blk.Hash, true
}

func hexutilUint(n uint64) string { return "0x" + strconv.FormatUint(n, 16) }

// call is the one JSON-RPC door. Any error FAILS (opted in), with the error
// text sanitized: anvil relays upstream provider errors verbatim.
func (a *anvilFork) call(out any, method string, args ...any) {
	a.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), rpcTimeout)
	defer cancel()
	if err := a.rc.CallContext(ctx, out, method, args...); err != nil {
		a.t.Fatalf("%s through the fork FAILED — opted-in RPC errors FAIL, never skip: %s",
			method, a.scrub(err.Error()))
	}
}

func (a *anvilFork) head() uint64 {
	a.t.Helper()
	var s string
	a.call(&s, "eth_blockNumber")
	n, err := strconv.ParseUint(strings.TrimPrefix(s, "0x"), 16, 64)
	require.NoErrorf(a.t, err, "parse eth_blockNumber %q", s)
	return n
}

func (a *anvilFork) hashAt(block uint64) common.Hash {
	a.t.Helper()
	var blk *struct {
		Hash common.Hash `json:"hash"`
	}
	a.call(&blk, "eth_getBlockByNumber", hexutilUint(block), false)
	require.NotNilf(a.t, blk, "eth_getBlockByNumber(%d) returned null on the fork", block)
	return blk.Hash
}

// mine advances the fork by n blocks. The fork runs --no-mining, so this is
// the ONLY way its height moves.
func (a *anvilFork) mine(n uint64) {
	a.t.Helper()
	var ignored json.RawMessage
	a.call(&ignored, "anvil_mine", hexutilUint(n))
}

// reorg replays anvil_reorg with the POSITIONAL parameter form probed working
// on anvil v1.7.1 (brief R5): [depth, txBlockPairs]. The map form is rejected
// by that build, and evm_snapshot/evm_revert is NOT an acceptable substitute —
// an identical re-mine can reproduce identical hashes, whereas anvil_reorg
// diverged even with an empty tx list, which is precisely the walker's
// same-height/different-hash trigger.
func (a *anvilFork) reorg(depth uint64) {
	a.t.Helper()
	var ignored json.RawMessage
	a.call(&ignored, "anvil_reorg", depth, []any{})
}

func (a *anvilFork) impersonate(addr common.Address) {
	a.t.Helper()
	var ignored json.RawMessage
	a.call(&ignored, "anvil_impersonateAccount", addr)
}

func (a *anvilFork) setBalance(addr common.Address, wei *big.Int) {
	a.t.Helper()
	var ignored json.RawMessage
	a.call(&ignored, "anvil_setBalance", addr, "0x"+wei.Text(16))
}

// sendTx submits a transaction from an IMPERSONATED account. Under
// --no-mining it lands in the pool; the caller mines it.
func (a *anvilFork) sendTx(from, to common.Address, data []byte) common.Hash {
	a.t.Helper()
	var h common.Hash
	a.call(&h, "eth_sendTransaction", map[string]any{
		"from": from,
		"to":   to,
		"data": "0x" + hex.EncodeToString(data),
		"gas":  hexutilUint(3_000_000),
	})
	return h
}

// minedReceipt requires the transaction to be mined AND successful. A reverted
// admin call is a harness bug (wrong role, wrong argument bounds) and must
// fail by name rather than silently producing no event.
func (a *anvilFork) minedReceipt(tx common.Hash) (blockNumber uint64, logs []types.Log) {
	a.t.Helper()
	var r *struct {
		BlockNumber string      `json:"blockNumber"`
		Status      string      `json:"status"`
		Logs        []types.Log `json:"logs"`
	}
	a.call(&r, "eth_getTransactionReceipt", tx)
	require.NotNilf(a.t, r, "transaction %s has no receipt — it was never mined", tx.Hex())
	require.Equalf(a.t, "0x1", r.Status, "transaction %s REVERTED on the fork (status %s)", tx.Hex(), r.Status)
	n, err := strconv.ParseUint(strings.TrimPrefix(r.BlockNumber, "0x"), 16, 64)
	require.NoError(a.t, err, "parse receipt blockNumber")
	return n, r.Logs
}

// receiptLogs reads a transaction's logs through eth_getTransactionReceipt —
// a DIFFERENT door than eth_getLogs, used as an independent witness in leg 2.
func (a *anvilFork) receiptLogs(tx common.Hash) []types.Log {
	a.t.Helper()
	var r *struct {
		Logs []types.Log `json:"logs"`
	}
	a.call(&r, "eth_getTransactionReceipt", tx)
	require.NotNilf(a.t, r, "transaction %s has no receipt on the fork", tx.Hex())
	return r.Logs
}

// getLogs reads logs DIRECTLY through the fork, bypassing the walker
// entirely — the second witness every custody assertion compares against.
func (a *anvilFork) getLogs(from, to uint64, addrs []common.Address) []types.Log {
	a.t.Helper()
	var logs []types.Log
	a.call(&logs, "eth_getLogs", map[string]any{
		"fromBlock": hexutilUint(from),
		"toBlock":   hexutilUint(to),
		"address":   addrs,
	})
	return logs
}

// ethCall executes a view at an explicit block height on the fork.
func (a *anvilFork) ethCall(to common.Address, data []byte, block uint64) []byte {
	a.t.Helper()
	var out string
	a.call(&out, "eth_call", map[string]any{
		"to":   to,
		"data": "0x" + hex.EncodeToString(data),
	}, hexutilUint(block))
	raw, err := hex.DecodeString(strings.TrimPrefix(out, "0x"))
	require.NoErrorf(a.t, err, "decode eth_call return %q", out)
	return raw
}

// ---------------------------------------------------------------------------
// Derived scratch database
// ---------------------------------------------------------------------------

// replayBaseDSN applies the house destructive-suite guard (round-10 F1 /
// internal/store's destructiveTestDSN, cmd/reconcile's gateTestBaseDSN) with
// ONE deliberate difference: an unset TEST_DATABASE_URL is FATAL here in every
// mode, not just acceptance mode. The caller already opted in by exporting the
// ANVIL pair, and after opt-in every problem FAILS — never skips.
func replayBaseDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatalf("opted in (%s+%s set) but TEST_DATABASE_URL is unset — this harness MIGRATES and TRUNCATES a derived scratch database, and after opt-in every problem FAILS, never skips; run `make db-up` and export it",
			envAnvilBin, envForkRPC)
	}
	if u, err := url.Parse(dsn); err == nil && u.Path == "/solvent" {
		t.Fatalf("TEST_DATABASE_URL points at the LIVE database %q — this harness creates, migrates and TRUNCATES a derived database; point it at solvent_test (wave-10 DB split)", u.Path)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := store.VerifyDestructiveSplit(ctx, dsn, os.Getenv("SOLVENT_DATABASE_URL")); err != nil {
		t.Fatalf("destructive-test guard REFUSES to proceed: %v", err)
	}
	return dsn
}

// freshDerivedDB derives a leg-exclusive database ("<scratch><suffix>") from
// the scratch DSN, creates it if missing, migrates it, and TRUNCATEs every
// pipeline table so the leg starts from genuine emptiness.
//
// A DERIVED database, not TEST_DATABASE_URL itself, for the same reason
// cmd/reconcile's ensureDerivedDB gives: `go test ./...` runs packages in
// parallel processes and internal/store's destructive helpers own the shared
// scratch DB — two packages migrating and truncating one database
// concurrently is a collision, not a test. Each LEG takes its own suffix one
// level further down, because leg 1 and leg 2 fork different heights and
// their raw_logs would otherwise share a chain-wide cursor space.
//
// The TRUNCATE is total (every public base table except goose's bookkeeping),
// and it is discovered from information_schema rather than transcribed: a
// future migration adding a table must not silently leave stale rows behind
// in a harness whose whole claim is "this is what the pipeline derives from
// nothing".
func freshDerivedDB(t *testing.T, ctx context.Context, baseDSN, suffix string) string {
	t.Helper()
	u, err := url.Parse(baseDSN)
	require.NoError(t, err)
	baseName := strings.TrimPrefix(u.Path, "/")
	require.NotEmpty(t, baseName, "TEST_DATABASE_URL carries no database name")
	name := baseName + suffix
	require.NotEqual(t, "solvent", name, "the derived name must never be the live database")

	admin, err := pgx.Connect(ctx, baseDSN)
	require.NoError(t, err, "connect to the scratch database to derive %q", name)
	defer admin.Close(ctx)
	var exists bool
	require.NoError(t, admin.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists))
	if !exists {
		// CREATE DATABASE cannot be parameterized; the name is the
		// operator's own scratch DSN plus a fixed suffix.
		_, err = admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, name))
		require.NoErrorf(t, err, "create derived database %q", name)
	}
	du := *u
	du.Path = "/" + name
	dsn := du.String()
	require.NoErrorf(t, store.Migrate(ctx, dsn), "migrate the derived replay DB %q", name)

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "connect to the derived replay DB")
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx,
		`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'goose_db_version' ORDER BY tablename`)
	require.NoError(t, err, "enumerate public tables for truncation")
	var tables []string
	for rows.Next() {
		var tn string
		require.NoError(t, rows.Scan(&tn))
		tables = append(tables, pgx.Identifier{tn}.Sanitize())
	}
	rows.Close()
	require.NoError(t, rows.Err())
	require.NotEmpty(t, tables, "the derived replay DB has no tables after Migrate")
	_, err = conn.Exec(ctx, "TRUNCATE TABLE "+strings.Join(tables, ", ")+" RESTART IDENTITY CASCADE")
	require.NoError(t, err, "truncate the derived replay DB")
	t.Logf("derived replay DB %q ready: migrated, %d tables truncated", name, len(tables))
	return dsn
}

// openReplayStore opens the pipeline's real *store.Store on the derived DB.
// No writer lock is taken: the derived database has exactly one writer by
// construction (this test process), and AcquireWriterLock is the daemon's
// mutual-exclusion mechanism, not a correctness precondition of the store.
func openReplayStore(t *testing.T, ctx context.Context, dsn string) *store.Store {
	t.Helper()
	st, err := store.Open(ctx, dsn)
	require.NoError(t, err, "open the derived replay store")
	t.Cleanup(st.Close)
	return st
}

// ---------------------------------------------------------------------------
// Production stream registry
// ---------------------------------------------------------------------------

// streamCfg is one config/contracts.json stream.
type streamCfg struct {
	Name          string           `json:"name"`
	Chain         string           `json:"chain"`
	Engine        string           `json:"engine"`
	Addresses     []common.Address `json:"addresses"`
	StartBlock    uint64           `json:"startBlock"`
	Window        uint64           `json:"window"`
	Confirmations uint64           `json:"confirmations"`
}

// loadContractStreams reads THE PRODUCTION stream registry
// (config/contracts.json) rather than transcribing addresses into the test.
// That is the point: this harness replays what the daemon is configured to
// ingest, so an address edited in the registry is exercised here, and an
// address the harness expects but the registry no longer declares fails by
// name instead of passing against a stale copy.
func loadContractStreams(t *testing.T) map[string]streamCfg {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "config", "contracts.json"))
	require.NoError(t, err, "read config/contracts.json")
	var doc struct {
		Streams []streamCfg `json:"streams"`
	}
	require.NoError(t, json.Unmarshal(raw, &doc), "parse config/contracts.json")
	out := map[string]streamCfg{}
	for _, s := range doc.Streams {
		out[s.Name] = s
	}
	require.NotEmpty(t, out, "config/contracts.json declares no streams")
	return out
}

// pickStreams selects the named production streams and re-points them at the
// fork's constraints: startBlock (the leg's subject range), window 10 (the
// upstream getLogs cap anvil proxies into) and small confirmations. Addresses,
// engine bindings and chain identity are taken VERBATIM from the registry.
func pickStreams(t *testing.T, reg map[string]streamCfg, names []string, startBlock uint64) []streamCfg {
	t.Helper()
	out := make([]streamCfg, 0, len(names))
	for _, n := range names {
		s, ok := reg[n]
		require.Truef(t, ok, "config/contracts.json no longer declares stream %q — the harness replays the production registry and refuses to invent one", n)
		require.Equalf(t, "eth", s.Chain, "stream %q is not an ETH stream", n)
		require.NotEmptyf(t, s.Addresses, "stream %q declares no addresses", n)
		s.StartBlock, s.Window, s.Confirmations = startBlock, forkWindow, forkConfirmations
		out = append(out, s)
	}
	return out
}

// addressesOf flattens a stream set's addresses (deduped, sorted) — the
// address argument for a direct fork getLogs and for a derive spec.
func addressesOf(streams []streamCfg) []common.Address {
	seen := map[common.Address]bool{}
	var out []common.Address
	for _, s := range streams {
		for _, a := range s.Addresses {
			if !seen[a] {
				seen[a] = true
				out = append(out, a)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return bytes.Compare(out[i][:], out[j][:]) < 0 })
	return out
}

func rawAddresses(addrs []common.Address) [][]byte {
	out := make([][]byte, 0, len(addrs))
	for _, a := range addrs {
		out = append(out, a.Bytes())
	}
	return out
}

// ---------------------------------------------------------------------------
// Pipeline drivers
// ---------------------------------------------------------------------------

// stepper is the shape both ingest.Walker and every derive worker expose.
type stepper interface {
	Step(ctx context.Context) (bool, error)
}

// drain steps a worker until it reports no further progress. Every error —
// including a walker window DISCARD, which carries its own *ingest.DiscardError
// — is a FAILURE: the fork is a local, deterministic, single-endpoint chain,
// so a discard there is a real defect, not weather. A worker that never
// settles within maxDrainSteps is wedged and fails by name.
func drain(t *testing.T, ctx context.Context, s stepper, label string) int {
	t.Helper()
	for i := 1; i <= maxDrainSteps; i++ {
		advanced, err := s.Step(ctx)
		require.NoErrorf(t, err, "%s: Step %d failed — opted-in runs FAIL, never skip", label, i)
		if !advanced {
			return i - 1
		}
	}
	t.Fatalf("%s: still advancing after %d Steps — the pipeline is wedged", label, maxDrainSteps)
	return 0
}

// ---------------------------------------------------------------------------
// ABI plumbing
// ---------------------------------------------------------------------------

// loadArtifactABI parses one of the repo's allowlisted deployed ABIs
// (internal/decode/abis/*.json — Foundry-shaped artifacts with an "abi" key).
func loadArtifactABI(t *testing.T, file string) abi.ABI {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "decode", "abis", file))
	require.NoErrorf(t, err, "read internal/decode/abis/%s", file)
	var artifact struct {
		ABI json.RawMessage `json:"abi"`
	}
	require.NoErrorf(t, json.Unmarshal(raw, &artifact), "%s artifact shape", file)
	require.NotEmptyf(t, artifact.ABI, `%s carries no "abi" key`, file)
	parsed, err := abi.JSON(bytes.NewReader(artifact.ABI))
	require.NoErrorf(t, err, "parse %s ABI", file)
	return parsed
}

// minimalABI parses a hand-authored fragment. Used for the two surfaces the
// repo carries no artifact for (PoolAddressesProvider, ACLManager) and for the
// PoolConfigurator's WRITE method — the committed PoolConfigurator.json is an
// events-only ABI with zero functions. Every method taken from a fragment has
// its 4-byte selector pinned by findMethod, so a mistyped signature cannot
// silently call something else.
func minimalABI(t *testing.T, fragment string) abi.ABI {
	t.Helper()
	parsed, err := abi.JSON(strings.NewReader(fragment))
	require.NoError(t, err, "parse hand-authored ABI fragment")
	return parsed
}

// findMethod selects a method by raw name + input arity and PINS its
// selector, recomputed from the parsed signature. A drifted artifact, a
// mistyped fragment, or a transcription error in the pinned constant all fail
// here rather than at some silently-wrong call.
func findMethod(t *testing.T, a abi.ABI, rawName string, nInputs int, wantSelector string) abi.Method {
	t.Helper()
	for _, m := range a.Methods {
		if m.RawName != rawName || len(m.Inputs) != nInputs {
			continue
		}
		require.Equalf(t, wantSelector, hex.EncodeToString(m.ID),
			"selector for %s/%d-arg is %x, the harness pins %s — wrong ABI or transcription drift",
			rawName, nInputs, m.ID, wantSelector)
		// Belt and braces: the ID go-ethereum computed must equal keccak of
		// the signature this ABI actually declares.
		require.Equalf(t, wantSelector, hex.EncodeToString(crypto.Keccak256([]byte(m.Sig))[:4]),
			"keccak(%q) does not equal the pinned selector %s", m.Sig, wantSelector)
		return m
	}
	t.Fatalf("method %s with %d input(s) not found in the ABI", rawName, nInputs)
	return abi.Method{}
}

func packCall(t *testing.T, m abi.Method, args ...any) []byte {
	t.Helper()
	packed, err := m.Inputs.Pack(args...)
	require.NoErrorf(t, err, "pack %s args", m.RawName)
	return append(append([]byte{}, m.ID...), packed...)
}

func unpackOne(t *testing.T, m abi.Method, ret []byte) any {
	t.Helper()
	vals, err := m.Outputs.Unpack(ret)
	require.NoErrorf(t, err, "unpack %s return", m.RawName)
	require.Lenf(t, vals, 1, "%s returns one value", m.RawName)
	return vals[0]
}

func unpackAddress(t *testing.T, m abi.Method, ret []byte) common.Address {
	t.Helper()
	v, ok := unpackOne(t, m, ret).(common.Address)
	require.Truef(t, ok, "%s did not return an address", m.RawName)
	return v
}

func unpackBool(t *testing.T, m abi.Method, ret []byte) bool {
	t.Helper()
	v, ok := unpackOne(t, m, ret).(bool)
	require.Truef(t, ok, "%s did not return a bool", m.RawName)
	return v
}

func unpackUint256(t *testing.T, m abi.Method, ret []byte) *big.Int {
	t.Helper()
	v, ok := unpackOne(t, m, ret).(*big.Int)
	require.Truef(t, ok && v != nil, "%s did not return a uint256", m.RawName)
	return new(big.Int).Set(v)
}

// unpackReserveConfigData pulls the `data` word out of getConfiguration's
// return. The ABI wraps that single uint256 in a struct
// (DataTypes.ReserveConfigurationMap), so a plain uint256 unpack does NOT fit
// it — a mistake worth naming, because the failure mode is a type assertion
// rather than a wrong number.
func unpackReserveConfigData(t *testing.T, m abi.Method, ret []byte) *big.Int {
	t.Helper()
	v, ok := unpackStructField(t, m, ret, 0).(*big.Int)
	require.Truef(t, ok && v != nil, "%s tuple field 0 is not a uint256", m.RawName)
	return new(big.Int).Set(v)
}

// unpackStructField pulls one field out of an ABI tuple return by INDEX. The
// generated anonymous struct's field names come from go-ethereum's own
// capitalization rules, so index + a named assertion in the caller is the
// stable reading (the same reflect posture internal/forkreplay uses for
// borrowingOf's TokenData[]).
func unpackStructField(t *testing.T, m abi.Method, ret []byte, index int) any {
	t.Helper()
	vals, err := m.Outputs.Unpack(ret)
	require.NoErrorf(t, err, "unpack %s return", m.RawName)
	require.Lenf(t, vals, 1, "%s returns one tuple", m.RawName)
	v := reflect.ValueOf(vals[0])
	require.Equalf(t, reflect.Struct, v.Kind(), "%s did not return a struct, got %T", m.RawName, vals[0])
	require.Greaterf(t, v.NumField(), index, "%s tuple has %d fields, index %d requested", m.RawName, v.NumField(), index)
	return v.Field(index).Interface()
}

// ---------------------------------------------------------------------------
// Aave reserve-configuration bit reading + WadRayMath
// ---------------------------------------------------------------------------

// reserveConfig is the decoded ReserveConfigurationMap bitmask. Layout per
// Aave v3 ReserveConfiguration.sol: bits 0-15 LTV, 16-31 liquidation
// threshold, 32-47 liquidation bonus, 48-55 decimals. Only the three
// parameters param_history carries are read here.
type reserveConfig struct {
	LTV, LiqThreshold, LiqBonus *big.Int
	Decimals                    uint64
}

func decodeReserveConfig(data *big.Int) reserveConfig {
	mask16 := big.NewInt(0xFFFF)
	get := func(shift uint, mask *big.Int) *big.Int {
		return new(big.Int).And(new(big.Int).Rsh(data, shift), mask)
	}
	return reserveConfig{
		LTV:          get(0, mask16),
		LiqThreshold: get(16, mask16),
		LiqBonus:     get(32, mask16),
		Decimals:     get(48, big.NewInt(0xFF)).Uint64(),
	}
}

// ray is Aave's 1e27 fixed-point denominator.
var ray = new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil)

// rayMulHalfUp is WadRayMath.rayMul: (a*b + RAY/2) / RAY — HALF-UP, not
// floor. This is the ONLY rounding law valid at these pins: they sit in the
// pre-23,088,584 "regime A" the Aave engine documents (internal/derive/
// aave.go), where the aToken's balanceOf projects a scaled balance through
// the reserve's normalized income with half-up rounding. Do NOT port the
// TokenMath floor/ceil laws of regime B, or internal/forkreplay's Debt
// Manager floor, into this projection.
func rayMulHalfUp(a, b *big.Int) *big.Int {
	p := new(big.Int).Mul(a, b)
	p.Add(p, new(big.Int).Rsh(ray, 1))
	return p.Quo(p, ray)
}

// ---------------------------------------------------------------------------
// The thin risk-gate consumer (leg 3)
// ---------------------------------------------------------------------------

// requiredCursor names one (engine, chain) whose derived state a consumer MUST
// have before it may serve anything. It is the gate's REQUIREMENT SET, and it
// has to be explicit: a gate that evaluates only the cursors it happens to find
// cannot distinguish "this engine is safe" from "this engine has not started",
// and the second one is served as a green light.
type requiredCursor struct {
	Engine  string
	ChainID int64
}

// gateVerdict is what a riskd-shaped reader concludes about whether derived
// state is safe to serve. Blocking names EVERY required engine that is missing
// or unsafe — the verdict is a SET, not a boolean, because "refuses" and
// "refuses for the right reasons" are different facts and only the second one
// is worth asserting.
type gateVerdict struct {
	Allowed  bool
	Blocking []string
	Reason   string
}

// riskGate is the THIN test consumer standing in for Task 5's watermark
// reader, per the plan: same predicate, same two store surfaces
// (store.DeriveCursorStates + store.MaxReorgEpochs), promoted to the real
// reader in Task 5's wave.
//
// THE LAW, in one sentence: a consumer may serve only when EVERY REQUIRED
// (engine, chain) has a cursor that exists, is bound to the required chain, and
// has ACKNOWLEDGED every reorg epoch recorded on that chain (acked_epoch >=
// max_epoch). Any required engine failing any clause blocks, and the verdict
// names it.
//
// THE REQUIREMENT SET IS THE WHOLE POINT, and it is a fix for a real
// false-green found in review. The earlier version refused only when NO
// cursors existed at all and otherwise looped over whichever rows came back.
// During honest startup — the position cursor written, aave_param not yet — it
// therefore returned ALLOWED while parameter state did not exist, which for a
// liquidation-facing consumer means serving health factors computed against
// absent liquidation thresholds. Worse, a gate that ignored aave_param
// ENTIRELY would still have satisfied the closure harness, because leg 3 only
// checked a boolean at a moment when both cursors lagged. Missing is now a
// first-class refusal, the no-cursors case is its degenerate form (every
// required engine missing), and leg 3 asserts the refusal SET.
//
// Deliberately NOT a fixture of expected numbers: it reads the same durable
// rows the daemon does, so leg 3's refusals are the real predicate firing on
// real state rather than a re-assertion of what the test just did.
func riskGate(ctx context.Context, q store.Querier, required []requiredCursor) (gateVerdict, error) {
	if len(required) == 0 {
		// A gate with an empty requirement set can only ever say yes, which is
		// not a gate. Refusing to construct one is cheaper than debugging why
		// a consumer never blocked.
		return gateVerdict{}, fmt.Errorf("riskGate: no required cursors given — a gate with an empty requirement set can only ever allow")
	}
	cursors, err := store.DeriveCursorStates(ctx, q)
	if err != nil {
		return gateVerdict{}, fmt.Errorf("read derive cursors: %w", err)
	}
	maxEpochs, err := store.MaxReorgEpochs(ctx, q)
	if err != nil {
		return gateVerdict{}, fmt.Errorf("read reorg epochs: %w", err)
	}
	byEngine := make(map[string]store.DeriveCursorState, len(cursors))
	for _, c := range cursors {
		byEngine[c.Engine] = c
	}

	blocking := map[string]bool{}
	var reasons []string
	block := func(engine, reason string) {
		blocking[engine] = true
		reasons = append(reasons, reason)
	}
	for _, req := range required {
		c, ok := byEngine[req.Engine]
		if !ok {
			// MISSING, not merely lagging: the engine has never applied a
			// window, so there is no derived state to serve at any height.
			block(req.Engine, fmt.Sprintf("engine %q has NO derive cursor on chain %d — it has never applied a window, so its derived state does not exist at any height",
				req.Engine, req.ChainID))
			continue
		}
		if c.ChainID != req.ChainID {
			// "No custody here" and "custody of another chain" are different
			// facts, and conflating them is how a consumer reads one chain's
			// parameters onto another's positions.
			block(req.Engine, fmt.Sprintf("engine %q is bound to chain %d, not the required chain %d",
				req.Engine, c.ChainID, req.ChainID))
			continue
		}
		if maxEpoch, ok := maxEpochs[req.ChainID]; ok && c.AckedEpoch < maxEpoch {
			block(req.Engine, fmt.Sprintf("engine %q on chain %d: acked_epoch %d < max reorg epoch %d",
				req.Engine, req.ChainID, c.AckedEpoch, maxEpoch))
		}
	}
	if len(blocking) > 0 {
		names := make([]string, 0, len(blocking))
		for e := range blocking {
			names = append(names, e)
		}
		sort.Strings(names)
		sort.Strings(reasons)
		return gateVerdict{Allowed: false, Blocking: names, Reason: strings.Join(reasons, "; ")}, nil
	}
	return gateVerdict{Allowed: true}, nil
}
