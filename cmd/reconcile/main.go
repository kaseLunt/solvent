// cmd/reconcile — W1's acceptance-evidence harness (Task 9 wave 10).
//
// One-shot, STRICTLY READ-ONLY CLI: never calls AcquireWriterLock, never
// Migrates, runs while the backfill daemon is live. Phase order is mandatory
// (brief §0) — an archive miss must abort in seconds, not after minutes of
// held snapshot:
//
//	Phase 0 — preflight, no snapshot held: env/config, DSN-split tripwire,
//	          schema gate (max goose version == embedded expected, exact),
//	          quick autocommit cursor read, RPC preflight probes cheapest
//	          first (golden-pin archive capability, fresh-pin serveability).
//	Phase 1 — ONE connection, REPEATABLE READ READ ONLY: every DB read
//	          (pins, population, as-of sums, aggregates, counts, freshness,
//	          invariant scans, internal check, rewind baseline), then COMMIT
//	          AND CLOSE — with ZERO network inside the snapshot (round-10
//	          F5): the pin header reads and the seed-derived sample ordering
//	          run in Go AFTER the connection is closed, against the
//	          committed population (vacuum-friendliness: no RPC latency or
//	          retry storm can ever hold xmin on the live database).
//	Phase 2 — RPC comparisons, sequential OP then ETH, one shared token
//	          bucket (the daemon is consuming the same provider budget).
//	Phase 3 — end-of-run rewind re-check on a FRESH connection (a snapshot
//	          cannot observe its own invalidation) + fork welds re-run.
//	Phase 4 — artifact emit + verdict.
//
// Exit codes (brief §5): 0 pass; 1 verdict-reached drift/violation (artifacts
// fully written); 2 precondition; 3 retryable environment; 4 usage.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net/url"
	"os"
	"runtime/debug"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5"

	"github.com/kaselunt/solvent/cmd/reconcile/snapshotdb"
	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

const (
	exitPass         = 0
	exitVerdictFail  = 1
	exitPrecondition = 2
	exitRetryable    = 3
	exitUsage        = 4
)

// tripwireMsg is the brief §1.2 message, verbatim.
const tripwireMsg = "test and live DSNs identical; physical split required (see runbook §DB-split)"

// forcedDMAnchors are the brief §2 forced includes: the three recon
// validation borrowers (Phase-1 bit-exact at PIN 154,021,227 with
// net-normalized 963,813 / 3,985,789,485 / 7,153,773 — provenance
// constants, recorded in the artifact, not asserted at today's pin) and the
// liquidation Safe.
var forcedDMAnchors = []string{
	"0303a641b9255a4240e879c76efc704dc1c6383d",
	"0b7043c82c5ad152137ad7d503daa02f5e777f85",
	"05e3a665efc843d77e3867ee6db41bc38d1ed33f",
	"ac5f3ce95f602e31b672cc38cddf7a3ea9ae5fcc",
}

// expectedMigrationGenesisRows is the §2 population precondition: the
// SEED-ROW count (positions across 80 batches), deliberately not a
// distinct-account count (L0-3/L2-8).
const expectedMigrationGenesisRows = 7337

type options struct {
	configPath       string
	engine           string
	sample           int
	allowSmall       bool
	seed             string
	include          string
	accountsFile     string
	pinOP            uint64
	pinETH           uint64
	goldenPinETH     uint64
	fixturePinETH    uint64
	snapshotMaxAge   string
	toleranceDMWei   int64
	rps              float64
	rpcAttempts      int
	collateralReplay int
	out              string
	timeout          time.Duration
	maxHeadLag       time.Duration
	preflightOnly    bool
	// P3 Task 6 (the proof surface).
	p3Gates      bool
	dmFullCensus bool
}

// Canonical acceptance defaults (round-11 F1): the ONE set of values an
// acceptance run may use without tainting. reconFlagSet seeds the flag
// defaults from these same constants, so the taint generator below and the
// defaults can never drift apart silently.
const (
	canonicalConfigPath       = "config/contracts.json"
	canonicalSampleFloor      = 25
	canonicalGoldenPinETH     = 25584990
	canonicalFixturePinETH    = 25593800
	canonicalSnapshotMaxAge   = "auto"
	canonicalCollateralReplay = 3
	canonicalMaxHeadLag       = 30 * time.Minute
	// canonicalP3Gates: the P3 Task-6 gate set is ON in an acceptance run. It is
	// a flag at all only so an operator can bisect a failure without paying the
	// deep-archive budget; turning it OFF bypasses required checks and taints,
	// exactly like -collateral-replay 0.
	canonicalP3Gates = true
	// canonicalDMFullCensus: the DM chain-side liquidatable census is MANDATORY
	// (Codex round 1, finding 4). It was opt-in on cost grounds; that acceptance
	// was withdrawn because a self-derived census cannot detect the account it
	// omitted. It remains a flag only so an operator can bisect, and turning it
	// off taints.
	canonicalDMFullCensus = true
	// canonicalFeedsPath is the committed registry the registry-consistency gate
	// judges against the chain. A CONSTANT, not a flag: acceptance evidence is
	// defined over the canonical registry, and an operator-chosen one would
	// change the claim's subject exactly as -config does.
	canonicalFeedsPath = "recon/feeds.json"
)

// reconFlagSet registers the COMPLETE reconcile flag surface on a fresh
// FlagSet bound to o. TestFlagSurfaceClosed enumerates this set and refuses
// any flag that lacks a taint-or-justified classification — adding a flag
// here without closing acceptanceTaints over it fails the suite (round-11
// F1: the taint GENERATOR must be closed over the flag surface, not just
// the taints consumed).
func reconFlagSet(o *options, stderr io.Writer) *flag.FlagSet {
	fs := flag.NewFlagSet("reconcile", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&o.configPath, "config", canonicalConfigPath, "contracts config path")
	fs.StringVar(&o.engine, "engine", "all", "all|debt_manager|aave_v3_etherfi")
	fs.IntVar(&o.sample, "sample", canonicalSampleFloor, "sample size floor (>=25 enforced; -allow-small for debugging taints acceptance)")
	fs.BoolVar(&o.allowSmall, "allow-small", false, "permit -sample below 25 (taints artifact acceptance:false)")
	fs.StringVar(&o.seed, "seed", "", "sampling seed (default: hex of the OP pin's block hash; resolved value always echoed; overriding taints acceptance:false)")
	fs.StringVar(&o.include, "include", "", "comma-separated extra forced-include accounts (hex)")
	fs.StringVar(&o.accountsFile, "accounts", "", "file of accounts — bypasses sampling (exact replay, recorded; taints acceptance:false)")
	fs.Uint64Var(&o.pinOP, "pin-op", 0, "OP pin override (default: derive cursor; refused above it)")
	fs.Uint64Var(&o.pinETH, "pin-eth", 0, "ETH pin override (default: derive cursor; refused above it)")
	fs.Uint64Var(&o.goldenPinETH, "golden-pin-eth", canonicalGoldenPinETH, "W1 golden pin (fixed; overriding taints acceptance:false)")
	fs.Uint64Var(&o.fixturePinETH, "fixture-pin-eth", canonicalFixturePinETH, "fixture pin (fixed; overriding taints acceptance:false)")
	fs.StringVar(&o.snapshotMaxAge, "snapshot-max-age", canonicalSnapshotMaxAge, "collateral freshness bound (auto = policy bound from §7; any explicit value taints acceptance:false)")
	fs.Int64Var(&o.toleranceDMWei, "tolerance-dm-wei", 0, "DIAGNOSIS ONLY: nonzero forces result=fail-with-tolerance")
	fs.Float64Var(&o.rps, "rps", 1.5, "client token bucket across ALL endpoints")
	fs.IntVar(&o.rpcAttempts, "rpc-attempts", 5, "bounded walk retries (backoff applies to 429 only)")
	fs.IntVar(&o.collateralReplay, "collateral-replay", canonicalCollateralReplay, "deep collateral replay account count (0 disables; below the default taints acceptance:false)")
	fs.StringVar(&o.out, "out", "roadmap/evidence/artifacts/w1-reconcile", "artifact output directory")
	fs.DurationVar(&o.timeout, "timeout", 20*time.Minute, "whole-run timeout")
	fs.DurationVar(&o.maxHeadLag, "max-head-lag", canonicalMaxHeadLag, "staleness QUALITY gate on the pin's header time (daemon stalled ⇒ evidence stale; exit 3) — never a serveability inference; loosening or disabling taints acceptance:false")
	fs.BoolVar(&o.preflightOnly, "preflight-only", false, "run Phase 0 only and exit (the smoke mode; never touches Phase 1)")
	fs.BoolVar(&o.p3Gates, "p3-gates", canonicalP3Gates, "run the P3 Task-6 gate set (HF gate, DM boolean weld, param welds, registry-consistency gate, tokenConfig sweep, realized-liquidation backtest, B3 heartbeat scan); DISABLING it bypasses required checks and taints acceptance:false")
	fs.BoolVar(&o.dmFullCensus, "dm-full-census", canonicalDMFullCensus, "MANDATORY for acceptance (default true): weld liquidatable(user) against the chain for EVERY evaluable DM borrower, so the census side is not self-derived. Disabling it leaves the false-negative direction undetectable outside the sample and TAINTS acceptance:false")
	return fs
}

func parseFlags(args []string, stderr io.Writer) (*options, error) {
	o := &options{}
	fs := reconFlagSet(o, stderr)
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	switch o.engine {
	case "all", "debt_manager", "aave_v3_etherfi":
	default:
		return nil, fmt.Errorf("-engine must be all|debt_manager|aave_v3_etherfi, got %q", o.engine)
	}
	if o.sample < canonicalSampleFloor && !o.allowSmall {
		return nil, fmt.Errorf("-sample %d is below the %d floor (use -allow-small for debugging; it taints acceptance)", o.sample, canonicalSampleFloor)
	}
	if o.sample < 1 {
		return nil, fmt.Errorf("-sample must be >= 1")
	}
	return o, nil
}

// acceptanceTaints lists why this run cannot back an acceptance receipt.
// Round-10 F2 made every taint flow INTO computeResult (a tainted run is
// structurally non-pass, result "tainted", exit 1); round-11 F1 CLOSED the
// generator over the whole flag surface: every registered flag either
// taints here whenever its value can weaken a required acceptance bound,
// or is verdict-free by construction and justified in
// TestFlagSurfaceClosed's classification table (raising -sample only
// strengthens; -include only ADDS gated rows on top of quota; -rps,
// -rpc-attempts, -timeout and -out change pacing or destinations and their
// every failure mode is a loud abort, never a pass; -preflight-only exits
// before any verdict or artifact exists). Canonical defaults are
// taint-free. The vacuous-via-loose-bounds class — round 11's
// `-snapshot-max-age 2562047h -max-head-lag 2562047h` — is the same class
// as vacuous-via-skip and taints identically: a bound weakened is a check
// bypassed. Round-13 F1 extended the generator's domain to the ENV surface
// (env.go): the env sweep is appended HERE, inside the one function every
// caller uses, so the flag and env taints cannot be wired apart.
func acceptanceTaints(o *options) []string {
	taints := envAcceptanceTaints()
	if o.configPath != canonicalConfigPath {
		taints = append(taints, fmt.Sprintf("-config %s (acceptance evidence is defined over the canonical contract set at %s; any other config changes the claim's subject)", o.configPath, canonicalConfigPath))
	}
	if o.allowSmall && o.sample < canonicalSampleFloor {
		taints = append(taints, fmt.Sprintf("-sample %d below the %d floor (-allow-small)", o.sample, canonicalSampleFloor))
	}
	if o.seed != "" {
		taints = append(taints, fmt.Sprintf("-seed %q overridden (acceptance's seed is the OP pin's block hash — a chain fact; an operator-chosen seed can steer the sample away from failing accounts)", o.seed))
	}
	if o.accountsFile != "" {
		taints = append(taints, fmt.Sprintf("-accounts %s replaces the seed-derived sample with operator-chosen membership (validateReplaySelection checks census SHAPE — size, strata, anchors — not selection, so hand-picked membership could avoid known-drift accounts)", o.accountsFile))
	}
	if o.goldenPinETH != canonicalGoldenPinETH {
		taints = append(taints, fmt.Sprintf("-golden-pin-eth overridden to %d (W1 clause pins %d)", o.goldenPinETH, canonicalGoldenPinETH))
	}
	if o.fixturePinETH != canonicalFixturePinETH {
		taints = append(taints, fmt.Sprintf("-fixture-pin-eth overridden to %d (fixtures captured at %d)", o.fixturePinETH, canonicalFixturePinETH))
	}
	if o.pinOP != 0 {
		taints = append(taints, fmt.Sprintf("-pin-op overridden to %d (acceptance pins are the derive cursors, never operator-chosen)", o.pinOP))
	}
	if o.pinETH != 0 {
		taints = append(taints, fmt.Sprintf("-pin-eth overridden to %d (acceptance pins are the derive cursors, never operator-chosen)", o.pinETH))
	}
	if o.engine != "all" {
		taints = append(taints, fmt.Sprintf("-engine %s (acceptance evidence requires both engines)", o.engine))
	}
	if o.toleranceDMWei != 0 {
		taints = append(taints, fmt.Sprintf("-tolerance-dm-wei %d (diagnosis only; forces fail-with-tolerance)", o.toleranceDMWei))
	}
	if o.snapshotMaxAge != canonicalSnapshotMaxAge && o.snapshotMaxAge != "" {
		taints = append(taints, fmt.Sprintf("-snapshot-max-age %s replaces the §7 policy bound (auto = derived from the daemon's own cadence) with an operator constant — a loose value makes the freshness gate vacuous for any realistic stale state", o.snapshotMaxAge))
	}
	if o.collateralReplay <= 0 {
		taints = append(taints, fmt.Sprintf("-collateral-replay %d disables the deep collateral replay (a required check)", o.collateralReplay))
	} else if o.collateralReplay < canonicalCollateralReplay {
		taints = append(taints, fmt.Sprintf("-collateral-replay %d below the canonical %d shrinks deep-replay coverage (a required check, weakened rather than disabled — the same class)", o.collateralReplay, canonicalCollateralReplay))
	}
	if o.maxHeadLag <= 0 {
		taints = append(taints, fmt.Sprintf("-max-head-lag %s disables the staleness quality gate (a required check)", o.maxHeadLag))
	} else if o.maxHeadLag > canonicalMaxHeadLag {
		taints = append(taints, fmt.Sprintf("-max-head-lag %s looser than the canonical %s weakens the staleness quality gate — positive-but-loose is the same class as disabled (round 11)", o.maxHeadLag, canonicalMaxHeadLag))
	}
	if !o.dmFullCensus {
		taints = append(taints, "-dm-full-census=false makes the DM liquidatable census SELF-DERIVED: the mandatory population falls back to our own liquidatable set, so a chain-liquidatable account we misclassify as healthy never enters the sample and the FALSE-NEGATIVE direction — the alert product's worst failure — becomes undetectable (Codex round 1, finding 4)")
	}
	if !o.p3Gates {
		taints = append(taints, "-p3-gates=false disables the WHOLE P3 Task-6 gate set (Aave HF gate, DM boolean weld, param welds, registry-consistency gate, tokenConfig sweep, realized-liquidation backtest, B3 heartbeat scan) — a required-check bypass, the same class as -collateral-replay 0")
	}
	return taints
}

// stampSeed echoes the RESOLVED seed into the run section (mutation target
// 12: a run whose artifact does not carry the seed is unreproducible).
func stampSeed(run map[string]any, seed string) {
	run["seed_resolved"] = seed
}

// stampAcceptance records the CURRENT taint set in the run section. The
// artifact stamp is documentation; the enforcement is computeResult taking
// the same taint set (round-10 F2) — the two can never tell different
// stories because both read one slice.
func stampAcceptance(rep *driftReport, taints []string) {
	if len(taints) > 0 {
		rep.Run["acceptance"] = false
		rep.Run["acceptance_taints"] = taints
	} else {
		rep.Run["acceptance"] = true
	}
}

// runAbort is a typed early exit; artifacts are still written when Phase 1
// data exists.
type runAbort struct {
	code   int
	status string
	msg    string
}

func (a *runAbort) Error() string { return a.msg }

func abort(code int, status, format string, args ...any) *runAbort {
	return &runAbort{code: code, status: status, msg: fmt.Sprintf(format, args...)}
}

// --- DSN helpers ------------------------------------------------------------

// readOnlyDSN forces default_transaction_read_only=on at the SESSION level:
// even autocommit statements on this connection cannot write.
//
// It ALSO refuses DSNs whose EFFECTIVE host or database is not pinned by the
// connection string (round-14 F1, corrected by round-16 M1): pgx v5.5.1
// merges ambient PG* variables UNDER the connection string
// (pgconn/config.go:245 `mergeSettings(defaultSettings, envSettings,
// connStringSettings)`), so a DSN that does not pin the host or the database
// delegates the claim's SUBJECT to whatever PGHOST/PGDATABASE happens to be
// exported. And "pinned" is judged by PGX'S OWN precedence, not by the URL
// path: the `dbname` (and `host`) query parameters overwrite the path/host —
// even with an EMPTY value (pgconn/config.go:482-497; empty database is then
// omitted from the startup message, pgconn/pgconn.go:326-328, so the SERVER
// picks its default). The reviewer's `postgres://solvent@db/claimed?dbname=`
// passed the wave-16 path-only guard while pgx connected elsewhere; here it
// is refused before any connection exists (exit 2, precondition — same class
// as an unparseable config). See pgxdsn.go for the cited replication.
func readOnlyDSN(dsn string) (string, error) {
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme == "" {
		return "", fmt.Errorf("database url %q is not a URL-form DSN", dsn)
	}
	host, database, err := effectiveDSNClaim(dsn)
	if err != nil {
		return "", fmt.Errorf("database url %q is not parseable under pgx's connection-string semantics: %w", dsn, err)
	}
	if host == "" || database == "" {
		return "", fmt.Errorf("database url %q does not pin an effective host and/or database under pgx's OWN precedence (path, then dbname/host query-parameter override INCLUDING empty values — pgconn/config.go:482-497): the claim's SUBJECT would be chosen by ambient PG* variables or by the server's default database, not by the receipt; spell both out, and never with an empty override (round-14 F1 / round-16 M1)", dsn)
	}
	q := u.Query()
	q.Set("options", "-c default_transaction_read_only=on")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// --- chain plumbing ---------------------------------------------------------

// chainReader is the failover surface reconcile consumes; *chain.Failover
// satisfies it. Test fakes implement it WITH failure modes (state-pruned
// rejections, 429 storms, wrong-height multicall responses) per the house
// fixture-realism law.
type chainReader interface {
	HeaderHashFrom(ctx context.Context, startIndex int, n uint64) (common.Hash, chain.EndpointToken, error)
	HeaderTimeFrom(ctx context.Context, startIndex int, n uint64) (uint64, chain.EndpointToken, error)
	CallAtHashFrom(ctx context.Context, startIndex int, to common.Address, data []byte, blockHash common.Hash) ([]byte, chain.EndpointToken, error)
	EndpointCount() int
}

var _ chainReader = (*chain.Failover)(nil)

// pinnedReader wraps a chainReader with the shared runner (token bucket +
// bounded retries + per-attempt classification into the artifact).
type pinnedReader struct {
	name string
	c    chainReader
	run  *rpcRunner
}

func (r *pinnedReader) headerHash(ctx context.Context, n uint64) (common.Hash, chain.EndpointToken, error) {
	// Round-11 F3: the F5 runtime seam (the sentinel lives in snapshotdb
	// since round-13 F2 — the package that opens it owns it). The gate
	// check is FIRST — before the runner, before the limiter, before any
	// dial — in every entry point, so a network attempt while the snapshot
	// transaction is open fails closed however it was reached.
	if err := snapshotdb.Gate().Violation(fmt.Sprintf("headerHash(%d)", n)); err != nil {
		return common.Hash{}, chain.EndpointToken{}, err
	}
	var out common.Hash
	tok, err := r.run.run(ctx, r.name, fmt.Sprintf("headerHash(%d)", n), func(ctx context.Context) (chain.EndpointToken, error) {
		h, t, err := r.c.HeaderHashFrom(ctx, 0, n)
		if err == nil {
			out = h
		}
		return t, err
	})
	return out, tok, err
}

func (r *pinnedReader) headerTime(ctx context.Context, n uint64) (uint64, chain.EndpointToken, error) {
	if err := snapshotdb.Gate().Violation(fmt.Sprintf("headerTime(%d)", n)); err != nil {
		return 0, chain.EndpointToken{}, err
	}
	var out uint64
	tok, err := r.run.run(ctx, r.name, fmt.Sprintf("headerTime(%d)", n), func(ctx context.Context) (chain.EndpointToken, error) {
		v, t, err := r.c.HeaderTimeFrom(ctx, 0, n)
		if err == nil {
			out = v
		}
		return t, err
	})
	return out, tok, err
}

func (r *pinnedReader) callAtHash(ctx context.Context, op string, to common.Address, data []byte, hash common.Hash) ([]byte, chain.EndpointToken, error) {
	if err := snapshotdb.Gate().Violation("callAtHash:" + op); err != nil {
		return nil, chain.EndpointToken{}, err
	}
	var out []byte
	tok, err := r.run.run(ctx, r.name, op, func(ctx context.Context) (chain.EndpointToken, error) {
		ret, t, err := r.c.CallAtHashFrom(ctx, 0, to, data, hash)
		if err == nil {
			out = ret
		}
		return t, err
	})
	return out, tok, err
}

// errChunkDivergence marks a multicall chunk reporting a block ≠ P — never
// silently accepted (brief §5 multicall discipline; exit 3).
var errChunkDivergence = errors.New("multicall chunk reported a different block than the pin")

// multicallChunkSize bounds one chunk to ≤15 calls (L1-7: the one-arg
// borrowingOf iterates all configured borrow tokens server-side; 25-50/chunk
// approaches free-tier caps).
const multicallChunkSize = 15

// multicall executes calls in ≤15-call chunks at pinHash, asserting each
// chunk's in-band block number == pin (belt-and-braces on the hash pin) and
// recording each chunk's serving endpoint. Chunks MAY legitimately be served
// by different endpoints after mid-walk rotation — no single-endpoint
// assertion.
func (r *pinnedReader) multicall(ctx context.Context, op string, pin uint64, pinHash common.Hash, calls []multicallCall) ([]multicallResult, []int, error) {
	var results []multicallResult
	var endpoints []int
	for start := 0; start < len(calls); start += multicallChunkSize {
		end := start + multicallChunkSize
		if end > len(calls) {
			end = len(calls)
		}
		data, err := packTryBlockAndAggregate(calls[start:end])
		if err != nil {
			return nil, nil, err
		}
		ret, tok, err := r.callAtHash(ctx, fmt.Sprintf("%s[chunk %d..%d]", op, start, end-1), multicall3Address, data, pinHash)
		if err != nil {
			return nil, nil, err
		}
		blockNum, _, chunkResults, err := unpackTryBlockAndAggregate(ret)
		if err != nil {
			return nil, nil, err
		}
		if !blockNum.IsUint64() || blockNum.Uint64() != pin {
			return nil, nil, fmt.Errorf("%w: %s chunk served block %s, pin %d (endpoint %d)",
				errChunkDivergence, op, blockNum, pin, tok.Index)
		}
		if len(chunkResults) != end-start {
			return nil, nil, fmt.Errorf("%s: chunk returned %d results for %d calls", op, len(chunkResults), end-start)
		}
		results = append(results, chunkResults...)
		endpoints = append(endpoints, tok.Index)
	}
	return results, endpoints, nil
}

// secondOpinion re-reads one call from a DIFFERENT endpoint index (§3.5):
// both answers recorded (drift vs lying endpoint); a 429'd/pruned/absent
// alternative is "no second opinion available" — never counted as
// corroboration or contradiction (L1-9).
func (r *pinnedReader) secondOpinion(ctx context.Context, op string, to common.Address, data []byte, hash common.Hash, servedBy int) (string, *big.Int) {
	// secondOpinion bypasses the runner (single deliberate attempt), so it
	// carries its own gate check; its signature has no error path, so the
	// violation is returned as the recorded note — still never corroboration.
	if err := snapshotdb.Gate().Violation("secondOpinion:" + op); err != nil {
		return err.Error(), nil
	}
	if r.c.EndpointCount() <= 1 {
		return "no second opinion available (single endpoint)", nil
	}
	start := servedBy + 1
	var out []byte
	var tok chain.EndpointToken
	err := func() error {
		if err := r.run.limiter.wait(ctx); err != nil {
			return err
		}
		r.run.calls++
		ret, t, err := r.c.CallAtHashFrom(ctx, start, to, data, hash)
		if err != nil {
			return err
		}
		out, tok = ret, t
		return nil
	}()
	if err != nil {
		return fmt.Sprintf("no second opinion available (%s)", summarizeSecondOpinionErr(err)), nil
	}
	if tok.Index == servedBy {
		return "no second opinion available (walk fell back to the first-opinion endpoint)", nil
	}
	v, err := unpackUint256(dmBorrowingOfOneABI, "borrowingOf", out)
	if err != nil {
		return fmt.Sprintf("no second opinion available (undecodable: %v)", err), nil
	}
	_ = op
	return fmt.Sprintf("endpoint %d answered %s", tok.Index, v.String()), v
}

func summarizeSecondOpinionErr(err error) string {
	records := classifyFailure(err)
	classes := map[string]bool{}
	for _, r := range records {
		classes[r.Class] = true
	}
	keys := make([]string, 0, len(classes))
	for k := range classes {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}

// --- rewind detection (§8) --------------------------------------------------
// The baseline type lives in snapshotdb since round-13 F2 (it is read inside
// the snapshot transaction); the DETECTOR stays here — it runs on a fresh
// post-run connection.

// rewindMoved is the end-of-run re-check: per engine, acked_epoch UNCHANGED
// and last_block ≥ P — and, for the engines this run PINNED, acked_epoch ≥
// the chain's CURRENT MAX(reorg_epochs.epoch) (exit finding H1). The
// movement leg reads acked_epoch, NEVER only MAX(reorg_epochs.epoch):
// PruneAckedReorgEpochs deletes acked epochs, so a rewind+ack+prune cycle
// completing mid-run leaves MAX unchanged, while RewindDerived always bumps
// acked_epoch and acks are monotone (derive.go) — the prune-immune signal
// (mutation target 10). The MAX leg is the complementary check: a walker
// rewind committed mid-run whose ack has NOT landed yet moves neither
// acked_epoch nor last_block, but its epoch row sits above the engine's ack
// — the same unacked window the snapshot-time gate refuses at the start.
// Together the two legs leave no path: acked-and-pruned trips the movement
// leg, recorded-but-unacked trips the MAX leg.
// readRecheckState reads the Phase-3 recheck pair — derive cursors and
// chain-max reorg epochs — inside ONE repeatable-read read-only transaction,
// so both views come from a single database snapshot. Read the comment at
// the call site for why two autocommit statements are not equivalent.
func readRecheckState(ctx context.Context, conn *pgx.Conn) ([]store.DeriveCursorState, map[int64]int64, error) {
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, nil, fmt.Errorf("begin recheck tx: %w", err)
	}
	defer tx.Rollback(ctx)
	cursors, err := store.DeriveCursorStates(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	maxEpochs, err := store.MaxReorgEpochs(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit recheck tx: %w", err)
	}
	return cursors, maxEpochs, nil
}

func rewindMoved(baseline snapshotdb.RewindBaseline, current []store.DeriveCursorState, pins map[string]uint64, maxEpochs map[int64]int64) []string {
	var reasons []string
	byEngine := map[string]store.DeriveCursorState{}
	for _, c := range current {
		byEngine[c.Engine] = c
	}
	engines := make([]string, 0, len(baseline.AckedEpoch))
	for e := range baseline.AckedEpoch {
		engines = append(engines, e)
	}
	sort.Strings(engines)
	for _, e := range engines {
		cur, ok := byEngine[e]
		if !ok {
			reasons = append(reasons, fmt.Sprintf("engine %s: derive cursor disappeared during the run", e))
			continue
		}
		if cur.AckedEpoch != baseline.AckedEpoch[e] {
			reasons = append(reasons, fmt.Sprintf("engine %s: acked_epoch moved %d → %d (rewind during run)", e, baseline.AckedEpoch[e], cur.AckedEpoch))
		}
		if pin, ok := pins[e]; ok && cur.LastBlock < pin {
			reasons = append(reasons, fmt.Sprintf("engine %s: last_block %d fell below pin %d (rewind during run)", e, cur.LastBlock, pin))
		}
		if _, pinned := pins[e]; pinned {
			if maxE := maxEpochs[cur.ChainID]; cur.AckedEpoch < maxE {
				reasons = append(reasons, fmt.Sprintf("engine %s: chain %d carries unacknowledged reorg epoch %d (acked %d) at end of run — a raw rewind landed whose derived ack has not", e, cur.ChainID, maxE, cur.AckedEpoch))
			}
		}
	}
	return reasons
}

// --- summary / verdict ------------------------------------------------------

// verdictTotals is the summary section's per-class accounting.
type verdictTotals struct {
	GatedRows    int `json:"gated_rows"`
	GatedExact   int `json:"gated_exact"`
	GatedDrift   int `json:"gated_drift"`
	AdvisoryRows int `json:"advisory_rows"`
}

// computeResult decides the run result. Structure (brief §3.5 + round-10
// F2): any nonzero -tolerance-dm-wei forces fail-with-tolerance — it CANNOT
// launder into a pass receipt even when every row is exact (the
// tolerance-laundering guard, mutation-killed by
// TestNonzeroToleranceCannotProducePass) — and the verdict function CONSUMES
// THE TAINT SET: a run with any acceptance taint (bypassed required check,
// pin override, invalid -accounts replay, small sample) is structurally
// non-pass — result "tainted", exit 1 — even when every gated row is exact
// (mutation-killed by TestTaintedRunCannotPass). Taints are a VERDICT input
// here, not run metadata: metadata can be ignored by a receipt reader, an
// exit code cannot.
func computeResult(gatedFailures int, toleranceDMWei int64, taints []string) (result string, code int) {
	if toleranceDMWei != 0 {
		return "fail-with-tolerance", exitVerdictFail
	}
	if gatedFailures > 0 {
		return "fail", exitVerdictFail
	}
	if len(taints) > 0 {
		return "tainted", exitVerdictFail
	}
	return "pass", exitPass
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	o, err := parseFlags(args, stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return exitPass
		}
		fmt.Fprintln(stderr, "usage error:", err)
		return exitUsage
	}
	ctx, cancel := context.WithTimeout(context.Background(), o.timeout)
	defer cancel()

	code, err := execute(ctx, o, stdout, stderr)
	if err != nil {
		fmt.Fprintln(stderr, err)
	}
	return code
}

// execute drives the phases; it returns the process exit code.
func execute(ctx context.Context, o *options, stdout, stderr io.Writer) (int, error) {
	rpcLog := &rpcCallLog{}
	runner := newRPCRunner(o.rps, o.rpcAttempts, rpcLog)

	rep := &driftReport{
		Schema: driftReportSchema,
		Status: "completed",
		Run: map[string]any{
			"cmdline":    strings.Join(os.Args, " "),
			"started_at": time.Now().UTC().Format(time.RFC3339),
		},
		Summary: map[string]any{},
		RPC:     rpcLog,
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" {
				rep.Run["git_commit"] = s.Value
			}
			if s.Key == "vcs.modified" {
				rep.Run["git_dirty"] = s.Value
			}
		}
	}
	taints := acceptanceTaints(o)
	stampAcceptance(rep, taints)

	phase1Done := false
	finish := func(a *runAbort) (int, error) {
		if a.code != exitPass {
			rep.Status = a.status
			rep.Summary["result"] = statusResult(a)
		}
		if phase1Done || a.code == exitVerdictFail {
			rep.Run["finished_at"] = time.Now().UTC().Format(time.RFC3339)
			jsonPath, txtPath, werr := writeArtifacts(o.out, rep)
			if werr != nil {
				fmt.Fprintln(stderr, "artifact write failed:", werr)
			} else {
				fmt.Fprintf(stdout, "artifacts: %s %s\ncomparison sha256: %s\n", jsonPath, txtPath, rep.ComparisonSHA256)
			}
		}
		if a.code == exitPass {
			return exitPass, nil
		}
		return a.code, fmt.Errorf("%s", a.msg)
	}

	// ---------------- Phase 0: preflight (no snapshot held) ----------------
	cfg, err := config.Load(o.configPath)
	if err != nil {
		return exitPrecondition, fmt.Errorf("config/env load failed: %w\n(hint: run via `make reconcile` or export .env — reconcile needs SOLVENT_DATABASE_URL and the SOLVENT_RPC_* variables even when SOLVENT_RECON_RPC_* overrides are set)", err)
	}
	reconDSN := cfg.DatabaseURL
	roDSN, err := readOnlyDSN(reconDSN)
	if err != nil {
		return exitPrecondition, err
	}
	// Round-16 M2, platform-true per round-19 H2: on Windows pgx builds the
	// platform defaults can SELECT the connection's TLS trust material
	// whenever the DSN does not pin it (pgconn defaults_windows.go:32-44
	// fill sslcert/sslkey/sslrootcert — from %APPDATA%\postgresql, or from
	// the CWD-relative postgresql\ when APPDATA is empty; config.go:685-699
	// loads that root into TLS verification), while non-Windows pgx never
	// reads APPDATA at all (defaults.go, //go:build !windows). Platform- and
	// DSN-aware, so it is judged here — where the DSN exists — and joins the
	// SAME taint set as every value-only env row (round-10 F2).
	if msg := appdataTrustTaint(reconDSN); msg != "" {
		taints = append(taints, msg)
		stampAcceptance(rep, taints)
	}

	// Recon-specific RPC configuration (controller gate amendment): the ETH
	// recon endpoint must be archive-state capable; SOLVENT_RECON_RPC_* take
	// precedence, falling back to SOLVENT_RPC_*. Keys live in env only —
	// never in code, never in artifacts (URLs are NOT recorded; only their
	// env-var provenance is).
	rpcSource := map[string]string{}
	urlsFor := func(chainName, reconEnv string) []string {
		if v := strings.TrimSpace(os.Getenv(reconEnv)); v != "" {
			var out []string
			for _, u := range strings.Split(v, ",") {
				if u = strings.TrimSpace(u); u != "" {
					out = append(out, u)
				}
			}
			if len(out) > 0 {
				rpcSource[chainName] = reconEnv
				return out
			}
		}
		rpcSource[chainName] = "SOLVENT_RPC_" + strings.ToUpper(chainName) + " (fallback)"
		return cfg.Chains[chainName].RPCURLs
	}
	opURLs := urlsFor("op", "SOLVENT_RECON_RPC_OP")
	ethURLs := urlsFor("eth", "SOLVENT_RECON_RPC_ETH")
	rep.Run["rpc_source"] = rpcSource
	// The DSN's EFFECTIVE claim — computed the way pgx itself computes it
	// (round-16 M1; path, then dbname query override, pgxdsn.go) — is
	// recorded as a CLAIM only (round-14 F1); the artifact's db identity —
	// run.db_name and run.db_identity — is written after Phase 1 from what
	// the SERVER said over the snapshot's own connection, never from this
	// string. The two are then COMPARED, and a mismatch taints (below).
	claimedDB := dbNameClaimed(reconDSN)
	rep.Run["db_name_claimed"] = claimedDB

	// DSN-split tripwire (§1.2, resolving L2-1 — THE hazard).
	if testDSN := os.Getenv("TEST_DATABASE_URL"); testDSN != "" {
		if err := checkDSNSplit(ctx, roDSN, testDSN); err != nil {
			return exitPrecondition, err
		}
	}

	// Schema gate: exact equality, read-only, never Migrate.
	expected, err := store.ExpectedSchemaVersion()
	if err != nil {
		return exitPrecondition, err
	}
	pre, err := pgx.Connect(ctx, roDSN)
	if err != nil {
		return exitPrecondition, fmt.Errorf("connect (preflight): %w", err)
	}
	schemaV, err := store.SchemaVersion(ctx, pre)
	if err != nil {
		pre.Close(ctx)
		return exitPrecondition, err
	}
	if !schemaGateOK(schemaV, expected) {
		pre.Close(ctx)
		return exitPrecondition, fmt.Errorf("schema gate: database at goose version %d, this binary expects exactly %d — reconcile never migrates", schemaV, expected)
	}
	rep.Run["schema_version"] = schemaV

	// Quick autocommit read: derive cursors (preflight pins + derive-lag
	// diagnostic).
	preCursors, err := store.DeriveCursorStates(ctx, pre)
	if err != nil {
		pre.Close(ctx)
		return exitPrecondition, err
	}
	pre.Close(ctx)
	preByEngine := map[string]store.DeriveCursorState{}
	for _, c := range preCursors {
		preByEngine[c.Engine] = c
	}

	wantDM := o.engine == "all" || o.engine == dmEngine
	wantAave := o.engine == "all" || o.engine == aaveEngine

	// Dial + verify chains.
	var opReader, ethReader *pinnedReader
	if wantDM {
		opChain, err := chain.Dial(ctx, opURLs)
		if err != nil {
			return exitRetryable, fmt.Errorf("dial op: %w", err)
		}
		if err := opChain.VerifyChainID(ctx, uint64(cfg.Chains["op"].ChainID)); err != nil {
			return exitPrecondition, fmt.Errorf("op chain-id verify: %w", err)
		}
		opReader = &pinnedReader{name: "op", c: opChain, run: runner}
	}
	if wantAave {
		ethChain, err := chain.Dial(ctx, ethURLs)
		if err != nil {
			return exitRetryable, fmt.Errorf("dial eth: %w", err)
		}
		if err := ethChain.VerifyChainID(ctx, uint64(cfg.Chains["eth"].ChainID)); err != nil {
			return exitPrecondition, fmt.Errorf("eth chain-id verify: %w", err)
		}
		ethReader = &pinnedReader{name: "eth", c: ethChain, run: runner}
	}

	vec, err := loadGoldenVectors()
	if err != nil {
		return exitPrecondition, err
	}
	if o.goldenPinETH != 0 {
		vec.W1PinETH = o.goldenPinETH
	}
	if o.fixturePinETH != 0 {
		vec.FixturePinETH = o.fixturePinETH
	}
	dmProxy, aavePool, atokens, err := resolveContracts(cfg, vec)
	if err != nil {
		return exitPrecondition, err
	}

	// P3 Task 6, Phase 0: the FROZEN backtest frame's digest, and the committed
	// registry (the CLAIM). Both are checked before any snapshot or RPC exists,
	// because a frame that does not hash to the probe record's value makes every
	// backtest verdict a claim about a DIFFERENT sample, and a self-contradictory
	// registry cannot be judged against anything. Precondition class, exit 2.
	var reg *registryView
	if o.p3Gates {
		got, ok := backtestFrameDigestOK()
		if !ok {
			return exitPrecondition, fmt.Errorf("backtest frame digest %s != the committed %s (recon/p3-probes.md, the Task-6 frozen backtest frame): the frame is FROZEN, so a digest mismatch means this binary would record verdicts against a different sample than the record describes", got, backtestFrameDigest)
		}
		if len(backtestFrame) != backtestFrameSize {
			return exitPrecondition, fmt.Errorf("backtest frame carries %d cases, not the frozen %d", len(backtestFrame), backtestFrameSize)
		}
		rep.Run["backtest_frame_digest"] = got
		feeds, ferr := config.LoadFeeds(canonicalFeedsPath, cfg.Chains)
		if ferr != nil {
			return exitPrecondition, fmt.Errorf("load feed registry (the CLAIM the registry-consistency gate judges against the chain): %w", ferr)
		}
		streams := map[string]config.Stream{}
		for _, s := range cfg.Streams {
			streams[s.Name] = s
		}
		if reg, err = buildRegistryView(feeds, streams); err != nil {
			return exitPrecondition, err
		}
		rep.Run["feeds_registry_path"] = canonicalFeedsPath
	}

	// RPC preflight probes, cheapest first (§0): golden-pin archive
	// capability on ETH (both deep pins), one pinned call at the OP derive
	// cursor. A state-pruned classification HERE is exit 2 (golden pins:
	// named endpoint + depth) / exit 3 (fresh pin: wait for catch-up,
	// re-pin, or use an archive endpoint).
	if wantAave {
		borrower1 := common.HexToAddress(vec.Borrowers[0].Address)
		weethAToken := atokens[strings.ToLower(strings.TrimPrefix(vec.Borrowers[0].CollateralReserve, "0x"))]
		for _, pin := range []uint64{vec.W1PinETH, vec.FixturePinETH} {
			h, _, err := ethReader.headerHash(ctx, pin)
			if err != nil {
				return preflightExit(err, "eth", pin, true)
			}
			data, err := aaveScaledBalanceOfABI.Pack("scaledBalanceOf", borrower1)
			if err != nil {
				return exitPrecondition, err
			}
			if _, _, err := ethReader.callAtHash(ctx, fmt.Sprintf("preflight:eth@%d", pin), weethAToken, data, h); err != nil {
				return preflightExit(err, "eth", pin, true)
			}
		}
	}
	if wantDM {
		dmCursor, ok := preByEngine[dmEngine]
		if !ok {
			return exitPrecondition, fmt.Errorf("no derive cursor for %s — nothing to reconcile (backfill not started?)", dmEngine)
		}
		h, _, err := opReader.headerHash(ctx, dmCursor.LastBlock)
		if err != nil {
			return preflightExit(err, "op", dmCursor.LastBlock, false)
		}
		anchor := common.HexToAddress(forcedDMAnchors[0])
		data, err := dmBorrowingOfOneABI.Pack("borrowingOf", anchor, anchor) // shape probe only: any pinned eth_call proves serveability
		if err != nil {
			return exitPrecondition, err
		}
		if _, _, err := opReader.callAtHash(ctx, fmt.Sprintf("preflight:op@%d", dmCursor.LastBlock), dmProxy, data, h); err != nil {
			return preflightExit(err, "op", dmCursor.LastBlock, false)
		}
	}

	// Head-lag QUALITY gate (§3.1: the false serveability inference is
	// GONE; this is purely "the daemon is stalled, evidence would be
	// stale").
	if o.maxHeadLag > 0 {
		for engine, reader := range map[string]*pinnedReader{dmEngine: opReader, aaveEngine: ethReader} {
			if reader == nil {
				continue
			}
			c, ok := preByEngine[engine]
			if !ok {
				continue
			}
			t, _, err := reader.headerTime(ctx, c.LastBlock)
			if err != nil {
				return exitRetryable, fmt.Errorf("head-lag probe (%s): %w", engine, err)
			}
			if lag := time.Since(time.Unix(int64(t), 0)); lag > o.maxHeadLag {
				return exitRetryable, fmt.Errorf("derive cursor for %s is %s behind wall clock (bound %s) — daemon stalled or backfill incomplete; evidence would be stale (exit 3, retryable)", engine, lag.Round(time.Second), o.maxHeadLag)
			}
		}
	}

	if o.preflightOnly {
		fmt.Fprintln(stdout, "preflight OK (Phase 0 complete; snapshot never opened)")
		return exitPass, nil
	}

	// ---------------- Phase 1: RR snapshot — ALL DB reads ----------------
	p1, err := runPhase1(ctx, o, cfg, roDSN, vec, wantDM, wantAave, opReader, ethReader, reg)
	if err != nil {
		var a *runAbort
		if errors.As(err, &a) {
			return finish(a)
		}
		return exitPrecondition, err
	}
	phase1Done = true
	// CONNECTED identity (round-14 F1): the artifact's db identity is the
	// tuple the SERVER reported over the snapshot's own connection —
	// current_database / inet_server_addr / inet_server_port / server
	// version plus the physical cluster identity — never the DSN's parsed
	// intent (recorded above as db_name_claimed only).
	rep.Run["db_name"] = p1.Identity.Database
	rep.Run["db_identity"] = p1.Identity
	// Round-16 M1: the claimed-vs-connected comparison is VERDICT-BEARING.
	// Wave 16 recorded both sides honestly but let a disagreement ride as
	// information; a mismatch the verdict ignores is a mismatch an attacker
	// can afford. Either direction taints, through the same computeResult
	// path as every other taint.
	if msg := claimVsConnectedTaint(claimedDB, p1.Identity); msg != "" {
		taints = append(taints, msg)
		stampAcceptance(rep, taints)
	}
	// Cadence taints (round-14 F4) are DB-AWARE, so they join the set here,
	// after Phase 1 read the persisted daemon cadence: an env claim that
	// contradicts the daemon-written interval — or a looser-than-default
	// claim with no persisted interval to check it against — taints, through
	// the SAME computeResult path as every other taint.
	if len(p1.cadenceTaints) > 0 {
		taints = append(taints, p1.cadenceTaints...)
		stampAcceptance(rep, taints)
	}
	// -accounts replay validation (round-10 F2): a replay file that fails
	// required-sample-size / strata-coverage / forced-anchor validation
	// TAINTS the run, and the taint set feeds computeResult — the bypass
	// cannot be acceptance and cannot even be exit 0.
	if wantDM && o.accountsFile != "" {
		taints = append(taints, validateReplaySelection(p1.sel, p1.Population, o.sample, forcedDMAnchors)...)
		stampAcceptance(rep, taints)
	}
	stampSeed(rep.Run, p1.seed)
	rep.Run["config_sha256"] = p1.ConfigSHA
	rep.Run["derive_lag_at_start"] = p1.deriveLag
	rep.Cursors = p1.cursorInfo()
	rep.Counts = p1.Counts
	rep.Sample = p1.sampleSection()
	rep.Invariants = p1.Invariants
	rep.InternalInconsistencies = p1.internalSection()
	rep.Pins = p1.pinSection()

	// Population preconditions (§2) — exit 2, never a silent pass; the
	// artifact for a precondition abort is still written (phase1Done).
	if wantDM {
		if p1.Counts.MigrationGenesisRows != expectedMigrationGenesisRows {
			return finish(abort(exitPrecondition, "aborted: precondition",
				"migration_genesis SEED-ROW count %d != %d (the recon-fetched batch census); distinct accounts %d recorded separately — a row-vs-distinct gap is an adjudication finding, never normalized",
				p1.Counts.MigrationGenesisRows, expectedMigrationGenesisRows, p1.Counts.MigrationGenesisDistinct))
		}
		for _, s := range stratumOrder {
			if p1.StrataCounts[s] == 0 {
				return finish(abort(exitPrecondition, "aborted: precondition",
					"stratum %q is EMPTY — taxonomy drift tripwire (§2)", s))
			}
		}
		if len(p1.Population) == 0 {
			return finish(abort(exitPrecondition, "aborted: precondition", "borrower population is empty"))
		}
	}
	if wantAave {
		aaveCursor := preByEngine[aaveEngine]
		if aaveCursor.LastBlock < vec.FixturePinETH {
			return finish(abort(exitPrecondition, "aborted: precondition",
				"aave derive cursor %d is below the fixture vector block %d — golden rows cannot run (exit 2)",
				aaveCursor.LastBlock, vec.FixturePinETH))
		}
	}

	// ---------------- Phase 2: RPC comparisons (OP, then ETH) -------------
	gatedFailures := 0

	// Fork welds "before" (§3.1 + L0-10) — run for both chains right after
	// the snapshot closes, before any expensive comparison.
	for i := range rep.Pins {
		reader := opReader
		if rep.Pins[i].Chain == "eth" {
			reader = ethReader
		}
		if reader == nil || rep.Pins[i].Chain == "golden" {
			continue
		}
		verdict, err := p1.runWeld(ctx, reader, rep.Pins[i].Chain)
		if err != nil {
			var a *runAbort
			if errors.As(err, &a) {
				return finish(a)
			}
			return finish(abort(exitRetryable, "aborted: weld", "fork weld (%s): %v", rep.Pins[i].Chain, err))
		}
		rep.Pins[i].WeldBefore = verdict
		if verdict != "ok" {
			return finish(abort(exitRetryable, "aborted: weld",
				"fork weld FAILED before comparisons on %s: %s — the pin's chain state is not canonical; re-pin and re-run (exit 3)", rep.Pins[i].Chain, verdict))
		}
	}

	if wantDM {
		if err := runDMPhase(ctx, o, p1, opReader, dmProxy, rep, &gatedFailures); err != nil {
			var a *runAbort
			if errors.As(err, &a) {
				return finish(a)
			}
			return finish(abort(exitRetryable, "aborted: rpc", "dm phase: %v", err))
		}
	}
	if wantAave {
		if err := runAavePhase(ctx, o, p1, ethReader, aavePool, atokens, vec, rep, &gatedFailures); err != nil {
			var a *runAbort
			if errors.As(err, &a) {
				return finish(a)
			}
			return finish(abort(exitRetryable, "aborted: rpc", "aave phase: %v", err))
		}
	}

	// ---- P3 Task 6: the proof surface -----------------------------------
	// INSIDE the before/after weld bracket, deliberately (chain-truth R1.2):
	// requireCanonical=false means an orphaned pin keeps serving silently, and
	// the end-of-run re-weld is the only thing that catches it — so a gate set
	// appended after Phase 3 would sit outside that protection. Its findings join
	// the SAME gatedFailures counter every pre-existing gate feeds, so a Task-6
	// failure reaches the exit code through exactly the path a DM row drift
	// reaches it by (chain-truth R5.4: never a side-channel exit).
	if o.p3Gates && reg != nil {
		// The L2 continuity sweeps need a raw eth_getLogs surface (basket-
		// continuity ruling L6: new plumbing — the pinned reader's chain
		// interface has no blockHash-form getLogs). Dialed from the SAME URL
		// list as the OP pinned reader, walked under the SAME shared runner.
		// A dial failure does NOT abort the phase: the sweeps then refuse per
		// case (continuity unproven, disclosed) rather than killing every
		// other gate.
		var opLogs rawLogsBackend
		var opCode rawCodeBackend
		var opTrace rawTraceBackend
		if wantDM {
			if lr, lerr := dialPinnedLogs(ctx, "op", opURLs, runner); lerr == nil {
				opLogs = lr
			} else {
				fmt.Fprintf(os.Stderr, "reconcile: continuity getLogs surface unavailable (%v) — L2 proofs will refuse per case\n", lerr)
			}
			// The R12 evidence surface (eth_getCode / eth_getStorageAt /
			// debug_traceBlockByHash) — same URL list, same shared runner. A
			// dial failure does not abort the phase, but unlike the L2
			// sweeps these pins are MANDATORY: every backtest case then
			// refuses (decode-authority-unread / admin-continuity-unread),
			// loudly, never a quieter verdict.
			if er, eerr := dialPinnedEvidence(ctx, "op", opURLs, runner); eerr == nil {
				opCode, opTrace = er, er
			} else {
				fmt.Fprintf(os.Stderr, "reconcile: R12 evidence surface unavailable (%v) — every backtest case will refuse decode-authority-unread\n", eerr)
			}
		}
		p3, perr := runP3Phase(ctx, o, p1, reg, opReader, ethReader, opLogs, opCode, opTrace, dmProxy, aavePool, wantDM, wantAave)
		if p3 != nil {
			rep.P3 = p3
			gatedFailures += tallyP3(p3.Rows)
		}
		if perr != nil {
			var a *runAbort
			if errors.As(perr, &a) {
				return finish(a)
			}
			return finish(abort(exitRetryable, "aborted: rpc", "p3 gate set: %v", perr))
		}
	}

	// Freshness gate + internal-inconsistency gate accounting (DB-derived,
	// but gated with everything else).
	if rep.Freshness != nil {
		gatedFailures += rep.Freshness.GateFailures
	}
	gatedFailures += p1.internalFailures()
	gatedFailures += p1.invariantGatedRows()

	// ---------------- Phase 3: rewind re-check (fresh connection) ---------
	fresh, err := pgx.Connect(ctx, roDSN)
	if err != nil {
		return finish(abort(exitRetryable, "aborted: recheck", "fresh connection for rewind re-check: %v", err))
	}
	// H1 recheck inputs: cursors AND chain-max epochs must come from ONE
	// database snapshot. Two autocommit statements on the same connection do
	// NOT share one: an ack+prune landing between them presents the OLD
	// cursor (still at the pin) alongside a PRUNED epoch view, and both
	// rewindMoved legs stay silent over invalidated state (exit-review
	// re-verification finding, session 019fa68e). A repeatable-read
	// read-only transaction pins both reads to a single snapshot: whichever
	// side of the ack it lands on, the pair is coherent and one leg fires.
	currentCursors, currentMaxEpochs, err := readRecheckState(ctx, fresh)
	fresh.Close(ctx)
	if err != nil {
		return finish(abort(exitRetryable, "aborted: recheck", "re-read derive cursors / reorg epochs: %v", err))
	}
	if reasons := rewindMoved(p1.Baseline, currentCursors, p1.Pins, currentMaxEpochs); len(reasons) > 0 {
		return finish(abort(exitRetryable, "aborted: rewind during run", "%s", strings.Join(reasons, "; ")))
	}
	for i := range rep.Pins {
		reader := opReader
		if rep.Pins[i].Chain == "eth" {
			reader = ethReader
		}
		if reader == nil || rep.Pins[i].Chain == "golden" {
			continue
		}
		verdict, err := p1.runWeld(ctx, reader, rep.Pins[i].Chain)
		if err != nil {
			return finish(abort(exitRetryable, "aborted: recheck", "fork weld re-run (%s): %v", rep.Pins[i].Chain, err))
		}
		rep.Pins[i].WeldAfter = verdict
		if verdict != "ok" {
			return finish(abort(exitRetryable, "aborted: rewind during run",
				"fork weld re-run FAILED on %s: %s (requireCanonical=false means an orphaned pin keeps serving silently — this end-of-run check is load-bearing, L1-8)", rep.Pins[i].Chain, verdict))
		}
	}
	rep.Cursors.AckedEpochs = ackedEpochSection(p1.Baseline, currentCursors)

	// ---------------- Phase 4: artifact + verdict --------------------------
	result, code := computeResult(gatedFailures, o.toleranceDMWei, taints)
	rep.Summary["result"] = result
	rep.Summary["gated_failures"] = gatedFailures
	rep.Summary["totals"] = rep.tallyTotals()
	rep.Summary["estimated_eth_calls"] = runner.calls
	rep.Summary["injectivity"] = "floor(n·I/1e18) is injective in n for I ≥ 1e18 (always true — the index starts at 1e18 and accrues), so USD-level equality ⟺ normalized equality; using the contract's own index at P is not circular"
	rep.Run["finished_at"] = time.Now().UTC().Format(time.RFC3339)

	jsonPath, txtPath, err := writeArtifacts(o.out, rep)
	if err != nil {
		return exitRetryable, err
	}
	fmt.Fprintf(stdout, "artifacts: %s %s\ncomparison sha256: %s\nresult: %s (gated failures: %d)\n",
		jsonPath, txtPath, rep.ComparisonSHA256, result, gatedFailures)
	if code != exitPass {
		return code, fmt.Errorf("reconcile verdict: %s", result)
	}
	return exitPass, nil
}

func statusResult(a *runAbort) string {
	if a.code == exitVerdictFail {
		return "fail"
	}
	return "aborted"
}

// preflightExit maps a preflight probe failure to the right exit code:
// state-pruned at a GOLDEN pin (deep, mandatory for Row A) is exit 2 naming
// endpoint + depth; at the FRESH pin it is exit 3 (retryable: wait for
// daemon catch-up, re-pin, or use an archive endpoint).
func preflightExit(err error, chainName string, pin uint64, goldenPin bool) (int, error) {
	var pf *pinnedFailure
	if errors.As(err, &pf) {
		switch pf.Class {
		case classStatePruned:
			endpoints := endpointList(pf.Attempts)
			if goldenPin {
				return exitPrecondition, fmt.Errorf("preflight: %s endpoint(s) %v cannot serve state at pin %d (state-pruned after bounded retries) — the W1 golden row needs an archive-capable endpoint (SOLVENT_RECON_RPC_ETH); never skipped, never fixture-substituted", chainName, endpoints, pin)
			}
			return exitRetryable, fmt.Errorf("preflight: %s endpoint(s) %v cannot serve state at fresh pin %d (state-pruned) — wait for daemon catch-up, re-pin, or use an archive endpoint (exit 3)", chainName, endpoints, pin)
		case classCapability:
			return exitPrecondition, fmt.Errorf("preflight: every %s endpoint refused on capability (403) at pin %d", chainName, pin)
		case classThrottle:
			return exitRetryable, fmt.Errorf("preflight: %s throttled through the whole retry budget at pin %d (exit 3)", chainName, pin)
		}
	}
	return exitRetryable, fmt.Errorf("preflight probe (%s @ %d): %w", chainName, pin, err)
}

func endpointList(attempts []attemptRecord) []int {
	seen := map[int]bool{}
	var out []int
	for _, a := range attempts {
		if a.Class == classStatePruned && !seen[a.Endpoint] {
			seen[a.Endpoint] = true
			out = append(out, a.Endpoint)
		}
	}
	sort.Ints(out)
	return out
}

// checkDSNSplit is the §1.2 tripwire: connect BOTH DSNs read-only and
// compare live database identity — parsing strings would miss host aliases.
// An unverifiable test DSN fails CLOSED: the whole point is that the
// destructive suite must provably point elsewhere.
func checkDSNSplit(ctx context.Context, reconRODSN, testDSN string) error {
	reconConn, err := pgx.Connect(ctx, reconRODSN)
	if err != nil {
		return fmt.Errorf("connect (tripwire, recon side): %w", err)
	}
	defer reconConn.Close(ctx)
	reconID, err := store.DatabaseIdentity(ctx, reconConn)
	if err != nil {
		return err
	}
	testRO, err := readOnlyDSN(testDSN)
	if err != nil {
		return fmt.Errorf("TEST_DATABASE_URL: %w", err)
	}
	testConn, err := pgx.Connect(ctx, testRO)
	if err != nil {
		return fmt.Errorf("TEST_DATABASE_URL is set but unverifiable (%v) — failing closed: %s", err, tripwireMsg)
	}
	defer testConn.Close(ctx)
	testID, err := store.DatabaseIdentity(ctx, testConn)
	if err != nil {
		return err
	}
	if dsnCollision(reconID, testID) {
		return fmt.Errorf("%s (both resolve to %s)", tripwireMsg, reconID)
	}
	return nil
}

// dsnCollision is the tripwire's decision (mutation target: disabling it
// must be killed by TestDSNTripwireDetectsSameDatabase). Identity is the F4
// physical tuple (pg_control system_identifier + database OID + name), so
// IPv4/IPv6/socket/proxy respellings of one database still collide — the
// round-10 F4 fail-open is structurally gone.
func dsnCollision(reconID, testID store.DBIdentity) bool {
	return store.SameDatabase(reconID, testID)
}

// schemaGateOK is the Phase-0 schema gate's decision: EXACT equality, both
// directions (mutation target "schema gate"). A lower database misses
// tables the compiled queries read; a HIGHER one may have reshaped them —
// a >=-style gate would silently accept a future schema this binary was
// never written against.
func schemaGateOK(got, expected int64) bool {
	return got == expected
}

// dbNameClaimed is the CLAIMED database recorded in run.db_name_claimed:
// the EFFECTIVE database under pgx's own connection-string precedence
// (round-16 M1) — path, then dbname query-parameter override, empty values
// overriding too (pgconn/config.go:482-497; see pgxdsn.go). Wave 16's
// path-only reading reported "claimed" for
// `postgres://solvent@db/claimed?dbname=other` while pgx connected to
// "other"; the claim is what the library computes. execute only calls this
// after readOnlyDSN accepted the DSN, so the claim is always non-empty; the
// error arm is a belt for any future caller.
func dbNameClaimed(dsn string) string {
	_, database, err := effectiveDSNClaim(dsn)
	if err != nil {
		return "(unparseable)"
	}
	return database
}

// claimVsConnectedTaint makes a claimed-vs-connected database mismatch
// VERDICT-BEARING (round-16 M1): db_name_claimed is the DSN's effective
// claim, db_name is what the SERVER reported over the snapshot's own
// transaction, and if the two disagree — in EITHER direction — the receipt
// is describing a database the run did not audit or auditing one the receipt
// does not name. Wave 16 recorded both honestly but let the mismatch ride as
// information; a mismatch the verdict ignores is a mismatch an attacker can
// afford. The comparison is exact (Postgres database names are identifiers;
// the server reports the one true spelling of the database the session is
// in).
func claimVsConnectedTaint(claimed string, connected snapshotdb.ConnectedIdentity) string {
	if claimed == connected.Database {
		return ""
	}
	return fmt.Sprintf("claimed database %q (DSN-effective under pgx's own precedence, run.db_name_claimed) != connected database %q (server-reported over the snapshot's transaction, run.db_name): the receipt and the audited subject disagree — whichever one is 'right', a verdict issued under this mismatch would launder the other (round-16 M1)", claimed, connected.Database)
}

// resolveContracts pulls every contract address from config/fixtures at
// runtime (never hardcoded): the DM proxy from the op:debt-manager stream,
// the Aave Pool from eth:aave-etherfi, and the aToken per underlying
// reserve from the eth:atoken-* streams the golden vectors name.
func resolveContracts(cfg *config.Config, vec goldenVectors) (dmProxy, aavePool common.Address, atokens map[string]common.Address, err error) {
	streams := map[string]config.Stream{}
	for _, s := range cfg.Streams {
		streams[s.Name] = s
	}
	dm, ok := streams["op:debt-manager"]
	if !ok || len(dm.Addresses) == 0 {
		return dmProxy, aavePool, nil, fmt.Errorf("config stream op:debt-manager missing or empty")
	}
	dmProxy = dm.Addresses[0]
	pool, ok := streams["eth:aave-etherfi"]
	if !ok || len(pool.Addresses) == 0 {
		return dmProxy, aavePool, nil, fmt.Errorf("config stream eth:aave-etherfi missing or empty")
	}
	aavePool = pool.Addresses[0]
	atokens = map[string]common.Address{}
	for _, r := range vec.Reserves {
		s, ok := streams[r.AtokenStream]
		if !ok || len(s.Addresses) == 0 {
			return dmProxy, aavePool, nil, fmt.Errorf("config stream %s (aToken for %s) missing or empty", r.AtokenStream, r.Symbol)
		}
		atokens[strings.ToLower(strings.TrimPrefix(r.Underlying, "0x"))] = s.Addresses[0]
	}
	return dmProxy, aavePool, atokens, nil
}

func ackedEpochSection(baseline snapshotdb.RewindBaseline, current []store.DeriveCursorState) map[string]map[string]int64 {
	out := map[string]map[string]int64{}
	for _, c := range current {
		out[c.Engine] = map[string]int64{
			"start": baseline.AckedEpoch[c.Engine],
			"end":   c.AckedEpoch,
		}
	}
	return out
}

// tallyTotals sums per-verdict counts across every row family.
func (r *driftReport) tallyTotals() verdictTotals {
	t := verdictTotals{}
	add := func(gated bool, verdict string) {
		if gated {
			t.GatedRows++
			// The pre-existing row families use "ok"/"fresh" as their success
			// spellings; the P3 families use the closed passingVerdicts set (which
			// includes the richer B3 and intra-block successes). Routing both
			// through ONE predicate keeps the artifact's exact/drift split and
			// computeResult's exit code telling the same story — the round-1
			// finding was exactly that they had drifted apart.
			if verdict == "ok" || verdict == "fresh" || !verdictIsFailure(verdict) {
				t.GatedExact++
			} else {
				t.GatedDrift++
			}
		} else {
			t.AdvisoryRows++
		}
	}
	for _, row := range r.DMRows {
		add(true, row.Verdict)
	}
	for _, w := range r.DMWeld {
		add(true, w.Verdict)
	}
	for _, c := range r.DMIndexCheck {
		add(c.Gated, c.Verdict)
	}
	for _, row := range r.AaveRows {
		add(row.Gated, row.Verdict)
	}
	for _, w := range r.AaveWeld {
		add(w.Gated, w.Verdict)
	}
	for _, g := range r.Golden {
		add(true, g.Verdict)
	}
	for _, c := range r.CollateralReplay {
		add(c.Gated, c.Verdict)
	}
	if r.Freshness != nil {
		for _, s := range r.Freshness.Sampled {
			add(true, s.Verdict)
		}
	}
	// P3 Task-6 rows join the SAME per-class accounting as every pre-existing row
	// family (chain-truth R5.4): one tally, one verdict function, one exit code.
	// A separate P3 total would be a second story a receipt reader could read
	// instead of this one.
	if r.P3 != nil {
		for _, row := range r.P3.Rows {
			add(row.Gated, row.Verdict)
		}
	}
	return t
}
