// Package forkreplay holds Task 10's OPT-IN anvil-fork replay test: derived
// Debt Manager borrower state from the LIVE database, asserted bit-exactly
// against direct view calls through a local anvil fork of OP pinned at the
// W1 acceptance pin.
//
// Opt-in contract (plan §Task 10, task-10-wave1 brief):
//
//   - SKIPS cleanly, with a named reason, unless BOTH ANVIL_FORK_RPC (an
//     archive-capable OP RPC URL anvil forks from) and ANVIL_BIN (path to
//     Foundry's anvil binary — NOT on PATH on this box) are set.
//   - Once opted in, every subsequent problem FAILS — never skips: missing
//     SOLVENT_DATABASE_URL, anvil startup timeout, the fork serving a block
//     whose hash differs from the pin hash, RPC errors, DB errors.
//
// Chain truth: the fork's pinned block hash is read from the PROVIDER-
// REPORTED eth_getBlockByNumber `hash` field (the same posture internal/
// chain pins in chain_reported_hash_test.go — never a local header
// recompute) and must equal the hardcoded pin hash. A fork of the wrong
// chain, or an upstream serving a different history, fails here before any
// balance is compared.
//
// DB posture: strictly READ-ONLY against the live database (the daemon may
// be running) — the session forces default_transaction_read_only=on,
// mirroring cmd/reconcile and internal/store's invariants_live_test.go. No
// Migrate, no Store construction, no writes.
//
// Borrower selection rule (deterministic, documented): from
// store.SampleDMBorrowers at the pin — every borrower's net normalized debt
// summed as-of the pin — keep rows with Live (net != 0), sort by AccountHex
// ascending, take the first 3: the three lexicographically-smallest borrower
// addresses (lowercase hex) holding nonzero derived debt as-of the pin.
//
// Rounding law: the Debt Manager's live-debt projection is
// floor(net_normalized × getCurrentIndex / 1e18) — Rounding.Floor per
// DebtManagerStorageContract.sol:520-522, the identity validated bit-exactly
// in recon/derivation-notes.md §Debt identity validation. The CEILING law
// (derivation-notes §Aave, corrected 2026-07-27) governs the AAVE debt
// token's scaled→live projection on ETH mainnet — a different engine with a
// different deployed rounding. This test forks OP and exercises only the
// Debt Manager, so floor is the engine-exact choice here; do not port the
// Aave ceiling into this bridge (or this floor into an Aave one).
package forkreplay

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

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

const (
	// defaultPinBlock / defaultPinHash: the W1 acceptance run's hash-bound
	// OP pin (controller-verified 2026-07-27). Overridable via
	// ANVIL_FORK_PIN_BLOCK + ANVIL_FORK_PIN_HASH — TOGETHER only, so an
	// overridden block never runs without its own hash bound.
	defaultPinBlock = uint64(154796552)
	defaultPinHash  = "0x509cc3ede77bee8f49dad741beab18065e4363b856b8411c8f68070d6d478498"

	// dmProxyHex is the Debt Manager UUPS proxy on OP, code-verified
	// on-chain (recon/derivation-notes.md contract table; deployed at block
	// 149,521,228 exactly).
	dmProxyHex = "0x0078C5a459132e279056B2371fE8A8eC973A9553"

	// engineDM matches internal/store's sampleDMBorrowersSQL literal.
	engineDM = "debt_manager"

	// borrowerSample: the brief's "at least 3 borrowers".
	borrowerSample = 3

	// Pinned selectors, cross-checked against the parsed recon/abis ABI so
	// a drifted or wrong-file ABI cannot silently change what is called.
	// Values match cmd/reconcile/lens_abis.go, themselves keccak-pinned by
	// lens_abis_test.go.
	selBorrowingOfAll  = "186c66cc" // borrowingOf(address)
	selGetCurrentIndex = "64752eec" // getCurrentIndex(address)

	// anvilStartupTimeout bounds the fork's startup-to-serving wait. The
	// controller's smoke test came up well under 60s; twice that is the
	// hard FAILURE bound (never a skip once opted in).
	anvilStartupTimeout = 120 * time.Second

	// callTimeout is generous because the fork's upstream is throttled
	// (see the --compute-units-per-second spawn flag): a cold borrowingOf
	// walks many storage slots, each an upstream fetch.
	callTimeout = 180 * time.Second

	// callAttempts bounds the per-view retry. Retrying is NOT skipping:
	// anvil caches every fork slot it fetched before an upstream error, so
	// each attempt makes monotonic progress through free-tier upstream
	// timeouts (dRPC free plan returns HTTP 408 under fetch bursts —
	// observed live 2026-07-27), while a persistent problem still exhausts
	// the bound and FAILS.
	callAttempts = 5
	callBackoff  = 2 * time.Second
)

// wad is the Debt Manager's PRECISION denominator (1e18).
var wad = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)

// TestForkReplayDMBorrowers is the Task 10 wave-1 deliverable.
func TestForkReplayDMBorrowers(t *testing.T) {
	forkRPC := os.Getenv("ANVIL_FORK_RPC")
	anvilBin := os.Getenv("ANVIL_BIN")
	if forkRPC == "" || anvilBin == "" {
		var missing []string
		if forkRPC == "" {
			missing = append(missing, "ANVIL_FORK_RPC")
		}
		if anvilBin == "" {
			missing = append(missing, "ANVIL_BIN")
		}
		t.Skipf("opt-in anvil-fork replay (Task 10): %s unset — set both to run; see .env.example", strings.Join(missing, " and "))
	}
	// ---- From here on, EVERY problem is a FAILURE, never a skip. ----------

	ctx := context.Background()
	pinBlock, pinHash, expected, exactTokenAsserts := resolvePin(t)
	dmProxy := common.HexToAddress(dmProxyHex)

	// 1. Spawn anvil forked at the pin; bounded startup wait; cleanup kill.
	endpoint, reported := startAnvilFork(t, anvilBin, forkRPC, pinBlock)

	// 2. Chain truth: the fork's pinned block hash must equal the pin hash.
	require.Equalf(t, pinHash, reported,
		"fork chain-truth check FAILED: eth_getBlockByNumber(%d) through the fork reports hash %s, pin demands %s — the fork upstream is serving the wrong chain or the wrong history",
		pinBlock, reported.Hex(), pinHash.Hex())

	// 3. Live DB, read-only session (fail — not skip — when unset: opted in).
	conn := openLiveDB(t)

	// 4. Deterministic borrower selection (rule in the package comment).
	rows, err := store.SampleDMBorrowers(ctx, conn, pinBlock)
	require.NoError(t, err, "SampleDMBorrowers at pin %d", pinBlock)
	var live []store.DMBorrowerRow
	for _, r := range rows {
		if r.Live {
			live = append(live, r)
		}
	}
	sort.Slice(live, func(i, j int) bool { return live[i].AccountHex < live[j].AccountHex })
	require.GreaterOrEqualf(t, len(live), borrowerSample,
		"need >= %d live DM borrowers as-of pin %d, DB has %d — wrong or empty database", borrowerSample, pinBlock, len(live))
	picked := live[:borrowerSample]

	// Round-22 F2: the deterministic sample is asserted against the pin's
	// FIXTURE — the DB under test never selects its own subjects. A shifted
	// sample (e.g. a migration_genesis derivation regression evicting an
	// expected borrower) FAILS by name instead of silently re-picking
	// borrowers that still happen to pass.
	for i, p := range picked {
		require.Equalf(t, expected[i].acctHex, p.AccountHex,
			"selection drift at rank %d of pin %d: sampled borrower %s, fixture pins %s — the sample shifted under an immutable pin, which is a derivation regression, not a re-pick", i, pinBlock, p.AccountHex, expected[i].acctHex)
		require.Equalf(t, expected[i].stratum, p.Stratum,
			"stratum drift for borrower %s at pin %d: sampled %q, fixture pins %q", p.AccountHex, pinBlock, p.Stratum, expected[i].stratum)
	}

	accounts := make([][]byte, 0, len(picked))
	for _, p := range picked {
		b, err := hex.DecodeString(p.AccountHex)
		require.NoError(t, err, "account hex %q", p.AccountHex)
		accounts = append(accounts, b)
	}

	// 5. Derived per-token net normalized debt as-of the pin (the store's
	// existing as-of surface; same rows cmd/reconcile folds).
	sums, err := store.AsOfEventSums(ctx, conn, engineDM, accounts, pinBlock)
	require.NoError(t, err, "AsOfEventSums at pin %d", pinBlock)
	derived := map[string]map[common.Address]*big.Int{}
	for _, s := range sums {
		if s.Side != "debt" || len(s.Asset) == 0 {
			continue
		}
		acct := hex.EncodeToString(s.Account)
		if derived[acct] == nil {
			derived[acct] = map[common.Address]*big.Int{}
		}
		derived[acct][common.BytesToAddress(s.Asset)] = s.Total
	}

	// 6. The deployed contract's REAL ABI from the recon/abis allowlist.
	dmABI := loadDMCoreABI(t)
	borrowingOfAll := findMethod(t, dmABI, "borrowingOf", 1, selBorrowingOfAll)
	getCurrentIndex := findMethod(t, dmABI, "getCurrentIndex", 1, selGetCurrentIndex)

	ec, err := ethclient.DialContext(ctx, endpoint)
	require.NoError(t, err, "dial anvil endpoint %s", endpoint)
	defer ec.Close()

	idxCache := map[common.Address]*big.Int{}
	indexAt := func(tok common.Address) *big.Int {
		if v, ok := idxCache[tok]; ok {
			return v
		}
		ret := callView(t, ctx, ec, dmProxy, packCall(t, getCurrentIndex, tok), pinBlock,
			fmt.Sprintf("getCurrentIndex(%s)", tok.Hex()), forkRPC)
		v := unpackUint256(t, getCurrentIndex, ret)
		idxCache[tok] = v
		return v
	}

	// 7. Per-borrower assertion: derived floor(net×idx/1e18) == borrowingOf
	// through the fork, token set equality, and Σ tokens == reported total.
	var tokenAsserts, setAsserts, sumAsserts int
	for _, p := range picked {
		acct := p.AccountHex
		user := common.HexToAddress("0x" + acct)
		ret := callView(t, ctx, ec, dmProxy, packCall(t, borrowingOfAll, user), pinBlock,
			fmt.Sprintf("borrowingOf(%s)", user.Hex()), forkRPC)
		chainByToken, chainTotal := unpackBorrowingOf(t, borrowingOfAll, ret)

		dbByToken := derived[acct]
		// Round-22 F1: a Live sample row whose deltas were discarded by the
		// per-asset retention (side != debt, empty asset) must FAIL, never
		// vanish into an empty union — Σ retained per-asset sums must equal
		// the sampled row's own net.
		assetSum := new(big.Int)
		for _, n := range dbByToken {
			assetSum.Add(assetSum, n)
		}
		require.Zerof(t, assetSum.Cmp(p.Net),
			"borrower %s at pin %d: Σ retained per-asset as-of sums %s != sampled net %s — rows outside the retained shape (side=debt, nonempty asset) fed the sample", acct, pinBlock, assetSum, p.Net)

		union := map[common.Address]bool{}
		var dbSet, chainSet []string
		for tok, n := range dbByToken {
			if n.Sign() != 0 {
				union[tok] = true
				dbSet = append(dbSet, tok.Hex())
			}
		}
		for tok := range chainByToken {
			union[tok] = true
			chainSet = append(chainSet, tok.Hex())
		}
		// Round-22 F1: an EMPTY union executes zero token assertions and
		// compares two nil sets equal — both sides must be nonempty for
		// every selected borrower before any comparison counts.
		require.NotEmptyf(t, dbSet,
			"borrower %s: zero derived nonzero-debt tokens as-of pin %d — an empty union would make every comparison vacuous", acct, pinBlock)
		require.NotEmptyf(t, chainSet,
			"borrower %s: borrowingOf returned zero tokens at pin %d — an empty union would make every comparison vacuous", acct, pinBlock)

		tokens := make([]common.Address, 0, len(union))
		for tok := range union {
			tokens = append(tokens, tok)
		}
		sort.Slice(tokens, func(i, j int) bool { return tokens[i].Hex() < tokens[j].Hex() })

		sum := new(big.Int)
		for _, tok := range tokens {
			net := dbByToken[tok]
			if net == nil {
				net = new(big.Int)
			}
			// big.Int.Quo truncates toward zero == floor only for
			// non-negative operands; a negative derived net would be a
			// derivation bug in its own right, so it fails by name.
			require.GreaterOrEqualf(t, net.Sign(), 0,
				"borrower %s token %s: derived net normalized debt is negative (%s)", acct, tok.Hex(), net)
			chainAmt := chainByToken[tok]
			if chainAmt == nil {
				chainAmt = new(big.Int)
			} else {
				sum.Add(sum, chainAmt)
			}
			idx := indexAt(tok)
			// FLOOR: DebtManagerStorageContract.sol:520-522 (see package
			// comment for why this is NOT the Aave ceiling).
			bridged := new(big.Int).Mul(net, idx)
			bridged.Quo(bridged, wad)
			require.Zerof(t, bridged.Cmp(chainAmt),
				"borrower %s token %s at pin %d: derived floor(net×idx/1e18) = %s != chain borrowingOf %s (net=%s idx=%s)",
				acct, tok.Hex(), pinBlock, bridged, chainAmt, net, idx)
			tokenAsserts++
		}

		sort.Strings(dbSet)
		sort.Strings(chainSet)
		require.Equalf(t, chainSet, dbSet,
			"borrower %s at pin %d: nonzero-debt token sets differ (DB %v vs chain %v)", acct, pinBlock, dbSet, chainSet)
		setAsserts++

		require.Zerof(t, sum.Cmp(chainTotal),
			"borrower %s at pin %d: Σ per-token borrowingOf %s != reported total %s", acct, pinBlock, sum, chainTotal)
		sumAsserts++

		t.Logf("borrower %s (%s): %d token(s) exact, total %s USD-6dec", acct, p.Stratum, len(tokens), chainTotal)
	}

	// Round-22 F1: the token-assertion census GATES (not just logs) under
	// the default pin — the fixture demands exactly this many per-token
	// equalities, so a silently shrunken comparison surface fails by name.
	if exactTokenAsserts > 0 {
		require.Equalf(t, exactTokenAsserts, tokenAsserts,
			"token-equality census at pin %d: executed %d per-token assertions, the fixture demands exactly %d — the comparison surface changed shape", pinBlock, tokenAsserts, exactTokenAsserts)
	}

	t.Logf("fork replay PASS at pin %d (%s): %d borrowers, %d token equalities (census-gated: %d), %d set equalities, %d sum-vs-total equalities, %d fixture account+stratum equalities, %d net cross-checks, 1 pin-hash assertion",
		pinBlock, pinHash.Hex(), len(picked), tokenAsserts, exactTokenAsserts, setAsserts, sumAsserts, 2*len(picked), len(picked))
}

// expectedBorrower pins one sampled subject — account (lowercase hex, no
// 0x) and stratum — so the DB under test cannot select its own subjects
// (round-22 F2): if a derivation regression (e.g. migration_genesis) shifts
// the deterministic sample, the run FAILS instead of silently re-picking
// borrowers that still happen to pass.
type expectedBorrower struct {
	acctHex string
	stratum string
}

// defaultExpectedBorrowers / defaultExpectedTokenAsserts are the DEFAULT
// pin's sample fixture, taken from the verified wave-1 live runs at pin
// 154,796,552: the three lexicographically-smallest live borrowers, their
// strata, and the exact number of per-token equality assertions the run
// executes (each borrower holds exactly one nonzero debt token — USDC).
var defaultExpectedBorrowers = []expectedBorrower{
	{acctHex: "0003d7bf094b6b4db60d41aa2b41d2b70be0c3b5", stratum: "migrated"},
	{acctHex: "00075e7f1fb542f84a0bddf1ee63b5a27b12faae", stratum: "post_migration"},
	{acctHex: "000a46d01968219b34e1e28c88c71cf82d58e153", stratum: "post_migration"},
}

const defaultExpectedTokenAsserts = 3

// resolvePin returns the hash-bound pin plus its pinned sample fixture: the
// hardcoded defaults, or the ANVIL_FORK_PIN_BLOCK + ANVIL_FORK_PIN_HASH +
// ANVIL_FORK_EXPECT override TRIPLE — all three together. An override
// without its own hash bound cannot be hash-verified (chain-truth
// discipline), and one without its own borrower fixture would let the DB
// under test select its own subjects (round-22 F2) — both are refused.
// exactTokenAsserts is 0 on the override path: only the default pin's
// fixture pins a token-assertion census.
func resolvePin(t *testing.T) (uint64, common.Hash, []expectedBorrower, int) {
	t.Helper()
	blockEnv := os.Getenv("ANVIL_FORK_PIN_BLOCK")
	hashEnv := os.Getenv("ANVIL_FORK_PIN_HASH")
	expectEnv := os.Getenv("ANVIL_FORK_EXPECT")
	if blockEnv == "" && hashEnv == "" && expectEnv == "" {
		return defaultPinBlock, common.HexToHash(defaultPinHash), defaultExpectedBorrowers, defaultExpectedTokenAsserts
	}
	if blockEnv == "" || hashEnv == "" || expectEnv == "" {
		t.Fatal("ANVIL_FORK_PIN_BLOCK, ANVIL_FORK_PIN_HASH and ANVIL_FORK_EXPECT must be overridden TOGETHER — a block pin without its own hash bound cannot be hash-verified, and a pin without its own acct:stratum fixture would let the DB under test select its own subjects (round-22 F2); an override without a fixture is refused, never silently sampled")
	}
	n, err := strconv.ParseUint(blockEnv, 10, 64)
	require.NoError(t, err, "ANVIL_FORK_PIN_BLOCK must be a decimal block number")
	h := common.HexToHash(hashEnv)
	// HexToHash silently pads/truncates; the round-trip check refuses a
	// malformed override instead of verifying against garbage.
	require.Equalf(t, h.Hex(), strings.ToLower(hashEnv), "ANVIL_FORK_PIN_HASH must be a 0x-prefixed 32-byte hash")
	return n, h, parseExpectedBorrowers(t, expectEnv), 0
}

// parseExpectedBorrowers parses ANVIL_FORK_EXPECT: exactly borrowerSample
// comma-separated acct:stratum entries (account = 40 hex chars, 0x
// optional), returned sorted by account hex ascending — the same order the
// deterministic selection rule produces.
func parseExpectedBorrowers(t *testing.T, raw string) []expectedBorrower {
	t.Helper()
	parts := strings.Split(raw, ",")
	require.Lenf(t, parts, borrowerSample,
		"ANVIL_FORK_EXPECT must pin exactly %d comma-separated acct:stratum entries", borrowerSample)
	out := make([]expectedBorrower, 0, borrowerSample)
	for _, part := range parts {
		acct, stratum, ok := strings.Cut(strings.TrimSpace(part), ":")
		require.Truef(t, ok, "ANVIL_FORK_EXPECT entry %q is not acct:stratum", part)
		acct = strings.ToLower(strings.TrimPrefix(acct, "0x"))
		b, err := hex.DecodeString(acct)
		require.NoErrorf(t, err, "ANVIL_FORK_EXPECT account %q is not hex", acct)
		require.Lenf(t, b, 20, "ANVIL_FORK_EXPECT account %q is not a 20-byte address", acct)
		require.NotEmptyf(t, stratum, "ANVIL_FORK_EXPECT entry %q carries no stratum", part)
		out = append(out, expectedBorrower{acctHex: acct, stratum: stratum})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].acctHex < out[j].acctHex })
	return out
}

// Round-22 F3: anvil's banner prints its fork Endpoint and provider errors
// can embed the fork URL — captured output and relayed RPC errors are
// SANITIZED before any logging, so the fork credential never lands in
// console/CI logs. Exact-URL replacement first (covers the banner), then
// URL userinfo, then credential-shaped query parameters, then long opaque
// path segments (Alchemy-style /v2/<key>). Over-redaction of diagnostics is
// acceptable; a leaked key is not.
var (
	urlUserinfoRe  = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://)[^/\s@]+@`)
	urlCredQueryRe = regexp.MustCompile(`(?i)\b((?:api[-_]?key|apikey|dkey|key|token|secret|auth|password)=)[^&\s"']+`)
	urlKeyPathRe   = regexp.MustCompile(`(://[^\s"']+/)[A-Za-z0-9_-]{20,}`)
)

func sanitizeForkOutput(s, forkURL string) string {
	if forkURL != "" {
		s = strings.ReplaceAll(s, forkURL, "<fork-url redacted>")
	}
	s = urlUserinfoRe.ReplaceAllString(s, "${1}<redacted>@")
	s = urlCredQueryRe.ReplaceAllString(s, "${1}<redacted>")
	s = urlKeyPathRe.ReplaceAllString(s, "${1}<redacted>")
	return s
}

// TestSanitizeForkOutputRedactsSecrets is the round-22 F3 regression: a
// synthetic credential-bearing fork URL embedded in synthetic anvil output
// — banner echo, userinfo form, opaque-path form, query-parameter form, and
// a prefix-extended variant — must never survive sanitization. PURE UNIT:
// no env gate, runs in every `go test ./...`.
func TestSanitizeForkOutputRedactsSecrets(t *testing.T) {
	// Deliberately NOT shaped like any real provider's key prefix (e.g. no
	// sk_live_) — GitHub push protection pattern-matches those shapes and
	// blocks the push even for synthetic fixtures. The sanitizer keys on
	// parameter names, userinfo, and opaque-segment length, never prefixes.
	const secret = "FAKESECRETTOKEN1234567890abcdefFAKE"
	forkURL := "https://lb.example.org/ogrpc?network=optimism&dkey=" + secret
	out := strings.Join([]string{
		"Fork", "Endpoint:       " + forkURL, // anvil banner shape
		"error: request to https://user:" + secret + "@rpc.example.com/ failed",
		"upstream https://opt-mainnet.g.example.com/v2/" + secret + " returned 429",
		"retrying " + forkURL + "&x=1 after backoff",
		`{"error":"apikey=` + secret + ` rejected"}`,
	}, "\n")

	got := sanitizeForkOutput(out, forkURL)
	require.NotContains(t, got, secret, "the credential must never survive sanitization")
	require.Contains(t, got, "<fork-url redacted>", "the exact fork URL is replaced wholesale")
	require.Contains(t, got, "https://<redacted>@rpc.example.com/", "userinfo credentials are redacted, host preserved for diagnostics")

	// The empty-forkURL arm (defensive: sanitize must not require the URL
	// to be known) still catches every regex-shaped credential.
	got = sanitizeForkOutput(out, "")
	require.NotContains(t, got, secret, "regex redaction alone must also remove the credential")
}

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

// startAnvilFork spawns anvil forked at the pin on a dynamically-chosen
// localhost port, registers a t.Cleanup kill, waits (bounded) until the fork
// serves the pinned block, and returns the endpoint plus the fork's
// PROVIDER-REPORTED hash for that block.
func startAnvilFork(t *testing.T, bin, forkURL string, pinBlock uint64) (string, common.Hash) {
	t.Helper()
	port := freePort(t)
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)

	out := &syncBuffer{}
	// The fork-request tuning exists because the designated upstream is a
	// free-tier endpoint: --compute-units-per-second throttles anvil's
	// fetch bursts under the provider's budget, --timeout/--retries/
	// --fork-retry-backoff absorb its queueing latency (dRPC free plan
	// 408s under burst load — observed live 2026-07-27).
	cmd := exec.Command(bin,
		"--fork-url", forkURL,
		"--fork-block-number", strconv.FormatUint(pinBlock, 10),
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(port),
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

	deadline := time.Now().Add(anvilStartupTimeout)
	for {
		select {
		case err := <-exited:
			// Both the exit error and the captured output are sanitized
			// (round-22 F3): the banner and provider errors can carry the
			// fork URL's credential.
			t.Fatalf("anvil exited before serving the fork (%s) — opted-in runs FAIL, never skip; anvil output:\n%s",
				sanitizeForkOutput(fmt.Sprintf("%v", err), forkURL), sanitizeForkOutput(out.String(), forkURL))
		default:
		}
		if h, ok := reportedPinHash(endpoint, pinBlock); ok {
			return endpoint, h
		}
		if time.Now().After(deadline) {
			t.Fatalf("anvil did not serve pinned block %d within %s (startup timeout) — opted-in runs FAIL, never skip; anvil output:\n%s",
				pinBlock, anvilStartupTimeout, sanitizeForkOutput(out.String(), forkURL))
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// freePort asks the kernel for an unused localhost TCP port.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err, "reserve a dynamic port for anvil")
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	return port
}

// reportedPinHash reads the fork's hash for the pinned block from the
// PROVIDER-REPORTED eth_getBlockByNumber field (internal/chain's posture:
// reported, never locally recomputed). ok=false while anvil is not serving.
func reportedPinHash(endpoint string, pinBlock uint64) (common.Hash, bool) {
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
	if err := rc.CallContext(ctx, &blk, "eth_getBlockByNumber", fmt.Sprintf("0x%x", pinBlock), false); err != nil || blk == nil {
		return common.Hash{}, false
	}
	return blk.Hash, true
}

// openLiveDB opens the READ-ONLY session against the live database. Missing
// SOLVENT_DATABASE_URL is a FAILURE here — the caller already opted in.
func openLiveDB(t *testing.T) *pgx.Conn {
	t.Helper()
	dsn := os.Getenv("SOLVENT_DATABASE_URL")
	if dsn == "" {
		t.Fatal("opted in (ANVIL_FORK_RPC+ANVIL_BIN set) but SOLVENT_DATABASE_URL is unset — after opt-in every problem FAILS, never skips")
	}
	u, err := url.Parse(dsn)
	require.NoError(t, err, "SOLVENT_DATABASE_URL must be a URL-form DSN")
	q := u.Query()
	q.Set("options", "-c default_transaction_read_only=on")
	u.RawQuery = q.Encode()
	conn, err := pgx.Connect(context.Background(), u.String())
	require.NoError(t, err, "connect (read-only) to the live database")
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

// loadDMCoreABI parses the allowlisted deployed ABI
// (recon/abis/DebtManagerCore.json, a Foundry artifact with an "abi" key).
func loadDMCoreABI(t *testing.T) abi.ABI {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "recon", "abis", "DebtManagerCore.json"))
	require.NoError(t, err, "read recon/abis/DebtManagerCore.json")
	var artifact struct {
		ABI json.RawMessage `json:"abi"`
	}
	require.NoError(t, json.Unmarshal(raw, &artifact), "DebtManagerCore.json artifact shape")
	require.NotEmpty(t, artifact.ABI, `DebtManagerCore.json carries no "abi" key`)
	parsed, err := abi.JSON(bytes.NewReader(artifact.ABI))
	require.NoError(t, err, "parse DebtManagerCore ABI")
	return parsed
}

// findMethod selects a method from the real ABI by raw name + input arity
// (borrowingOf is overloaded — go-ethereum mangles one overload's map key,
// so key lookup is unreliable) and pins its selector.
func findMethod(t *testing.T, a abi.ABI, rawName string, nInputs int, wantSelector string) abi.Method {
	t.Helper()
	for _, m := range a.Methods {
		if m.RawName == rawName && len(m.Inputs) == nInputs {
			require.Equalf(t, wantSelector, hex.EncodeToString(m.ID),
				"selector for %s/%d-arg drifted from the pinned value — wrong ABI file or transcription drift", rawName, nInputs)
			return m
		}
	}
	t.Fatalf("method %s with %d input(s) not found in recon/abis/DebtManagerCore.json", rawName, nInputs)
	return abi.Method{}
}

// packCall builds selector+args calldata for a method taken from the real ABI.
func packCall(t *testing.T, m abi.Method, args ...any) []byte {
	t.Helper()
	packed, err := m.Inputs.Pack(args...)
	require.NoErrorf(t, err, "pack %s args", m.RawName)
	return append(append([]byte{}, m.ID...), packed...)
}

// callView eth_calls the fork at the pinned block number, with a BOUNDED
// retry (callAttempts): anvil caches each fork slot it fetched before an
// upstream hiccup, so retries advance monotonically through free-tier
// upstream timeouts; exhausting the bound FAILS — opted-in runs never skip.
// Error text is sanitized before logging (round-22 F3): anvil relays
// upstream provider errors verbatim, and those can embed the fork URL.
func callView(t *testing.T, ctx context.Context, ec *ethclient.Client, to common.Address, data []byte, block uint64, what, forkURL string) []byte {
	t.Helper()
	var lastErr string
	for attempt := 1; attempt <= callAttempts; attempt++ {
		cctx, cancel := context.WithTimeout(ctx, callTimeout)
		ret, err := ec.CallContract(cctx, ethereum.CallMsg{To: &to, Data: data}, new(big.Int).SetUint64(block))
		cancel()
		if err == nil {
			return ret
		}
		lastErr = sanitizeForkOutput(err.Error(), forkURL)
		t.Logf("%s attempt %d/%d failed (%s) — retrying: the fork caches fetched slots, so progress is monotonic", what, attempt, callAttempts, lastErr)
		time.Sleep(callBackoff)
	}
	t.Fatalf("%s through the fork at block %d failed after %d attempts — opted-in RPC errors FAIL, never skip: %s", what, block, callAttempts, lastErr)
	return nil
}

// unpackBorrowingOf decodes borrowingOf(address)'s (TokenData[], uint256)
// return: the contract assembly-trims the array to NONZERO tokens only
// (DebtManagerStorageContract.sol:575-605), which is why the DB side of the
// set equality is zero-filtered too.
func unpackBorrowingOf(t *testing.T, m abi.Method, ret []byte) (map[common.Address]*big.Int, *big.Int) {
	t.Helper()
	vals, err := m.Outputs.Unpack(ret)
	require.NoError(t, err, "unpack borrowingOf return")
	require.Len(t, vals, 2, "borrowingOf returns (TokenData[], uint256)")
	out := map[common.Address]*big.Int{}
	slice := reflect.ValueOf(vals[0])
	require.Equalf(t, reflect.Slice, slice.Kind(), "borrowingOf token list is %T, not a slice", vals[0])
	for i := 0; i < slice.Len(); i++ {
		el := slice.Index(i)
		tok, ok := el.Field(0).Interface().(common.Address)
		require.Truef(t, ok, "borrowingOf element %d token is not an address", i)
		amt, ok := el.Field(1).Interface().(*big.Int)
		require.Truef(t, ok && amt != nil, "borrowingOf element %d carries no amount", i)
		out[tok] = new(big.Int).Set(amt)
	}
	total, ok := vals[1].(*big.Int)
	require.Truef(t, ok && total != nil, "borrowingOf total is %T, not *big.Int", vals[1])
	return out, new(big.Int).Set(total)
}

// unpackUint256 decodes a single-uint256 return.
func unpackUint256(t *testing.T, m abi.Method, ret []byte) *big.Int {
	t.Helper()
	vals, err := m.Outputs.Unpack(ret)
	require.NoErrorf(t, err, "unpack %s return", m.RawName)
	require.Lenf(t, vals, 1, "%s returns one value", m.RawName)
	v, ok := vals[0].(*big.Int)
	require.Truef(t, ok && v != nil, "%s value is %T, not *big.Int", m.RawName, vals[0])
	return new(big.Int).Set(v)
}
