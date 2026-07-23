// Package snapshot implements the OP collateral snapshotter (recon caveat 4):
// Debt Manager collateral is NOT event-derivable — collateralOf() reads the
// live ERC20 balances of the borrower's Safe via CashLens
// (DebtManagerCore.sol:170-182), and no Debt Manager event tracks collateral
// movement — so the only honest source is a periodic on-chain view sweep.
//
// The sweep model: the Safe registry is the store's distinct debt-side
// account set (store.SnapshotAccounts, nonzero-debt Safes first), read fresh
// at the start of every sweep. A sweep is consumed in ROTATING multicall3
// batches — each Step issues at most one aggregated eth_call
// (tryBlockAndAggregate of collateralOf reads against the Debt Manager
// proxy) and upserts one batch of snapshot-sourced position_balances rows
// (store.UpsertSnapshotBalances, wholesale per account, at the block the
// multicall executed in). Sweeps start when due: UNCONDITIONALLY on first
// run, every SOLVENT_SNAPSHOT_INTERVAL after the last completed sweep, and
// IMMEDIATELY after a derived-state rewind (TriggerResweep, wired to the
// runner's onRewind hook) — a rewind may have shrunk the registry and
// re-prioritized accounts, so the in-flight queue is dropped and rebuilt.
//
// CRASH-SAFE POST-REWIND RE-SWEEP: TriggerResweep is process memory, so a
// crash between the runner's RewindDerived and the hook loses the request —
// deliberately without a durable marker, because the unconditional STARTUP
// sweep is the durable leg: a restarted process always sweeps the full
// registry on its first Step (lastSweep is zero), which supersedes any lost
// re-sweep request. Pinned by TestStartupSweepCoversRewindCrash.
//
// SWEEP STATUS (store.RecordSnapshotSweep, snapshot_sweeps table): every
// batch bulk-records one attempt outcome per Safe at the multicall block,
// so zero-collateral success (success row + empty balances) is
// distinguishable from never-swept (no row) and failed (status='failed').
//
// Failure posture: a failed multicall (transport) or a malformed response
// leaves the queue untouched — the same batch retries next round. An
// individual collateralOf revert (success=false under requireSuccess=false)
// is recorded status='failed' and the Safe joins an IMMEDIATE-RETRY queue,
// drained after the fresh queue with up to maxAccountRetries further
// attempts this sweep (a success flips its status); a Safe that exhausts
// the budget stays failed until the next sweep, and a sweep that ends with
// such Safes logs DEGRADED, not complete. A FRESH batch where EVERY call
// reverted is an error (the target itself is broken, not one Safe); an
// all-reverted RETRY batch is per-account failure, not a target error —
// those Safes already reverted amid succeeding siblings.
//
// Not safe for concurrent use: Step and TriggerResweep are driven from the
// daemon's single loop under the single-writer contract (D-004) — snapshot
// rows share position_balances with the derivation writes.
package snapshot

import (
	"context"
	"encoding/hex"
	"fmt"
	"log/slog"
	"math/big"
	"reflect"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/store"
)

// Multicall3Address is the canonical multicall3 deployment, same address on
// OP as on every major EVM chain.
var Multicall3Address = common.HexToAddress("0xcA11bde05977b3631167028862bE2a173976CA11")

// defaultBatchSize bounds one multicall's fan-out. collateralOf returns a
// dynamic token array per Safe; 100 Safes per call stays far below node
// eth_call gas caps while keeping a full ~7k-Safe sweep under ~70 calls.
const defaultBatchSize = 100

// maxAccountRetries bounds how many IMMEDIATE retry attempts an
// individually-reverting Safe gets per sweep beyond its first attempt;
// after that it stays status='failed' until the next sweep.
const maxAccountRetries = 3

const sideCollateral = "collateral"

// Store is the snapshotter's store surface (*store.Store satisfies it).
type Store interface {
	SnapshotAccounts(ctx context.Context, engine string) ([][]byte, error)
	UpsertSnapshotBalances(ctx context.Context, engine string, account []byte, balances map[string]map[string]*big.Int, block uint64) error
	RecordSnapshotSweep(ctx context.Context, engine string, block uint64, outcomes []store.SweepOutcome) error
}

var _ Store = (*store.Store)(nil)

// Chain is the snapshotter's chain surface (*chain.Failover satisfies it).
type Chain interface {
	Call(ctx context.Context, to common.Address, data []byte) ([]byte, error)
}

var _ Chain = (*chain.Failover)(nil)

// multicall3ABI carries tryBlockAndAggregate — chosen over aggregate3
// because it returns the EXECUTION block number atomically with the results,
// so snapshot rows are stamped with the block they were actually read at,
// not a separately-fetched head that may have moved. Selector 0x399542e9,
// pinned by TestRequestShape against `cast sig`.
var multicall3ABI = mustParseABI(`[{
	"type": "function",
	"name": "tryBlockAndAggregate",
	"stateMutability": "payable",
	"inputs": [
		{"name": "requireSuccess", "type": "bool"},
		{"name": "calls", "type": "tuple[]", "components": [
			{"name": "target", "type": "address"},
			{"name": "callData", "type": "bytes"}
		]}
	],
	"outputs": [
		{"name": "blockNumber", "type": "uint256"},
		{"name": "blockHash", "type": "bytes32"},
		{"name": "returnData", "type": "tuple[]", "components": [
			{"name": "success", "type": "bool"},
			{"name": "returnData", "type": "bytes"}
		]}
	]
}]`)

// dmLensABI carries collateralOf(user) → (TokenData[] tokens, uint256
// totalUsd), per the verified DebtManagerCore ABI (recon/abis/
// DebtManagerCore.json). Selector 0x1aefb107, pinned by TestRequestShape.
var dmLensABI = mustParseABI(`[{
	"type": "function",
	"name": "collateralOf",
	"stateMutability": "view",
	"inputs": [{"name": "user", "type": "address"}],
	"outputs": [
		{"name": "", "type": "tuple[]", "components": [
			{"name": "token", "type": "address"},
			{"name": "amount", "type": "uint256"}
		]},
		{"name": "", "type": "uint256"}
	]
}]`)

func mustParseABI(jsonArray string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(jsonArray))
	if err != nil {
		panic(fmt.Sprintf("snapshot: build abi: %v", err))
	}
	return parsed
}

// multicall3Call is the (target, callData) tuple tryBlockAndAggregate takes;
// field names map to the ABI component names via go-ethereum's
// capitalization rule.
type multicall3Call struct {
	Target   common.Address
	CallData []byte
}

// Config binds a Snapshotter to one engine's collateral view.
type Config struct {
	Engine    string         // engine whose snapshot rows this sweep owns ("debt_manager")
	Target    common.Address // Debt Manager proxy (collateralOf lives behind it)
	Interval  time.Duration  // full-sweep cadence (SOLVENT_SNAPSHOT_INTERVAL)
	BatchSize int            // Safes per multicall; 0 → defaultBatchSize
}

// Snapshotter sweeps one engine's Safe registry through multicall3
// collateralOf reads into snapshot-sourced position_balances rows.
type Snapshotter struct {
	store Store
	chain Chain
	cfg   Config
	now   func() time.Time // injectable clock (tests)

	// Sweep state (single-loop owned; see the package comment).
	queue     [][]byte       // fresh Safes remaining in the current sweep
	retry     [][]byte       // individually-reverted Safes awaiting immediate retry
	retries   map[string]int // per-Safe retry attempts this sweep (key: raw account bytes)
	exhausted int            // Safes that burned the whole retry budget this sweep
	sweeping  bool
	lastSweep time.Time // completion time of the last full sweep
	resweep   bool      // an immediate re-sweep was requested (post-rewind)
}

// New builds a Snapshotter. Engine, target and a positive interval are
// required; a zero batch size takes the default.
func New(st Store, ch Chain, cfg Config) (*Snapshotter, error) {
	if st == nil || ch == nil {
		return nil, fmt.Errorf("snapshotter: store and chain are both required")
	}
	if cfg.Engine == "" {
		return nil, fmt.Errorf("snapshotter: engine is required")
	}
	if cfg.Target == (common.Address{}) {
		return nil, fmt.Errorf("snapshotter: target contract address is required")
	}
	if cfg.Interval <= 0 {
		return nil, fmt.Errorf("snapshotter: sweep interval must be positive, got %s", cfg.Interval)
	}
	if cfg.BatchSize < 0 {
		return nil, fmt.Errorf("snapshotter: batch size must not be negative, got %d", cfg.BatchSize)
	}
	if cfg.BatchSize == 0 {
		cfg.BatchSize = defaultBatchSize
	}
	return &Snapshotter{store: st, chain: ch, cfg: cfg, now: time.Now}, nil
}

// TriggerResweep requests an immediate full sweep: the in-flight queue and
// retry state (if any) are dropped — a post-rewind registry may differ — and
// the next Step starts fresh. Wired to the derivation runner's onRewind
// hook; the crash-safe backstop is the unconditional startup sweep (see the
// package comment).
func (s *Snapshotter) TriggerResweep() {
	s.queue, s.retry, s.retries, s.exhausted, s.sweeping = nil, nil, nil, 0, false
	s.resweep = true
}

// sweepDue reports whether a new sweep should start: requested re-sweep,
// never swept, or cadence elapsed since the last completed sweep.
func (s *Snapshotter) sweepDue() bool {
	if s.resweep || s.lastSweep.IsZero() {
		return true
	}
	return s.now().Sub(s.lastSweep) >= s.cfg.Interval
}

// Step performs one bounded unit of sweep work: at most one multicall batch
// (fresh Safes first, then the immediate-retry queue). Returns
// advanced=false when no sweep is due and none is in flight. Errors leave
// the batch's queue untouched, so the same batch retries next round.
func (s *Snapshotter) Step(ctx context.Context) (bool, error) {
	if !s.sweeping {
		if !s.sweepDue() {
			return false, nil
		}
		accounts, err := s.store.SnapshotAccounts(ctx, s.cfg.Engine)
		if err != nil {
			return false, fmt.Errorf("snapshotter %q: read safe registry: %w", s.cfg.Engine, err)
		}
		s.resweep = false
		if len(accounts) == 0 {
			// Nothing to sweep yet (backfill has derived no debt accounts):
			// count it as a completed sweep so the registry is not re-queried
			// every round.
			s.lastSweep = s.now()
			return false, nil
		}
		s.queue = accounts
		s.retry, s.retries, s.exhausted = nil, map[string]int{}, 0
		s.sweeping = true
	}

	// Fresh queue drains first; the immediate-retry queue follows, in
	// homogeneous batches (the all-reverted posture differs between them).
	src, fromRetry := &s.queue, false
	if len(s.queue) == 0 {
		src, fromRetry = &s.retry, true
	}
	n := s.cfg.BatchSize
	if n > len(*src) {
		n = len(*src)
	}
	failed, err := s.sweepBatch(ctx, (*src)[:n], fromRetry)
	if err != nil {
		return false, err
	}
	*src = (*src)[n:]

	// Reverted Safes: bounded immediate retries, then failed-until-next-sweep.
	for _, acct := range failed {
		key := string(acct)
		s.retries[key]++
		if s.retries[key] <= maxAccountRetries {
			s.retry = append(s.retry, acct)
			continue
		}
		s.exhausted++
		slog.Warn("safe exhausted its retry budget; keeping status=failed until the next sweep",
			"engine", s.cfg.Engine, "account", hex.EncodeToString(acct), "attempts", s.retries[key])
	}

	if len(s.queue) == 0 && len(s.retry) == 0 {
		exhausted := s.exhausted
		s.queue, s.retry, s.retries, s.exhausted, s.sweeping = nil, nil, nil, 0, false
		s.lastSweep = s.now()
		if exhausted > 0 {
			slog.Warn("collateral snapshot sweep completed DEGRADED — some safes stayed failed through the retry budget",
				"engine", s.cfg.Engine, "failedAccounts", exhausted)
		} else {
			slog.Info("collateral snapshot sweep completed", "engine", s.cfg.Engine)
		}
	}
	return true, nil
}

// sweepBatch reads one batch of Safes' collateral through a single
// tryBlockAndAggregate call, upserts their snapshot balances at the
// multicall's execution block, bulk-records every Safe's attempt outcome
// (store.RecordSnapshotSweep), and returns the individually-reverted Safes
// for the caller's retry bookkeeping. fromRetry marks a batch drawn from the
// immediate-retry queue: its Safes already reverted amid succeeding
// siblings, so an all-reverted retry batch is per-account failure, never the
// fresh-batch "target is broken" error.
func (s *Snapshotter) sweepBatch(ctx context.Context, accounts [][]byte, fromRetry bool) ([][]byte, error) {
	calls := make([]multicall3Call, len(accounts))
	for i, acct := range accounts {
		if len(acct) != common.AddressLength {
			return nil, fmt.Errorf("snapshotter %q: registry account %x is not a 20-byte address", s.cfg.Engine, acct)
		}
		data, err := dmLensABI.Pack("collateralOf", common.BytesToAddress(acct))
		if err != nil {
			return nil, fmt.Errorf("snapshotter %q: pack collateralOf(%x): %w", s.cfg.Engine, acct, err)
		}
		calls[i] = multicall3Call{Target: s.cfg.Target, CallData: data}
	}
	// requireSuccess=false: one broken Safe must not fail its whole batch.
	input, err := multicall3ABI.Pack("tryBlockAndAggregate", false, calls)
	if err != nil {
		return nil, fmt.Errorf("snapshotter %q: pack multicall: %w", s.cfg.Engine, err)
	}
	out, err := s.chain.Call(ctx, Multicall3Address, input)
	if err != nil {
		return nil, fmt.Errorf("snapshotter %q: multicall (%d safes): %w", s.cfg.Engine, len(accounts), err)
	}
	block, results, err := unpackMulticallResult(out, len(accounts))
	if err != nil {
		return nil, fmt.Errorf("snapshotter %q: %w", s.cfg.Engine, err)
	}

	var failed [][]byte
	outcomes := make([]store.SweepOutcome, 0, len(accounts))
	for i, res := range results {
		if !res.success {
			// An individual view revert: previous snapshot rows stay in
			// place; the caller schedules bounded immediate retries.
			failed = append(failed, accounts[i])
			outcomes = append(outcomes, store.SweepOutcome{Account: accounts[i], Success: false})
			slog.Warn("collateralOf reverted for safe; keeping its previous snapshot",
				"engine", s.cfg.Engine, "account", hex.EncodeToString(accounts[i]))
			continue
		}
		balances, err := decodeCollateralOf(res.returnData)
		if err != nil {
			return nil, fmt.Errorf("snapshotter %q: decode collateralOf(%x): %w", s.cfg.Engine, accounts[i], err)
		}
		// The upsert always runs for a successful read — including with an
		// EMPTY balances map: wholesale replacement is what clears the rows
		// of a Safe whose collateral went to zero, and the paired success
		// outcome is what distinguishes that from a never-swept Safe.
		if err := s.store.UpsertSnapshotBalances(ctx, s.cfg.Engine, accounts[i], balances, block); err != nil {
			return nil, fmt.Errorf("snapshotter %q: upsert snapshot for %x: %w", s.cfg.Engine, accounts[i], err)
		}
		outcomes = append(outcomes, store.SweepOutcome{Account: accounts[i], Success: true})
	}
	if !fromRetry && len(failed) == len(accounts) && len(accounts) > 0 {
		// Nothing recorded: the batch retries wholesale next round.
		return nil, fmt.Errorf("snapshotter %q: every collateralOf call in a %d-safe batch reverted — target %s is not serving the view",
			s.cfg.Engine, len(accounts), s.cfg.Target.Hex())
	}
	if err := s.store.RecordSnapshotSweep(ctx, s.cfg.Engine, block, outcomes); err != nil {
		// Queue untouched upstream: the batch (idempotent upserts included)
		// reruns next round rather than losing status rows.
		return nil, fmt.Errorf("snapshotter %q: record sweep outcomes: %w", s.cfg.Engine, err)
	}
	return failed, nil
}

type multicallResult struct {
	success    bool
	returnData []byte
}

// unpackMulticallResult decodes a tryBlockAndAggregate return: the execution
// block number and one (success, returnData) pair per submitted call. Any
// panic from malformed provider bytes is converted into an error.
func unpackMulticallResult(out []byte, wantCalls int) (block uint64, results []multicallResult, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			block, results, err = 0, nil, fmt.Errorf("unpack multicall result: recovered panic: %v", rec)
		}
	}()
	vals, err := multicall3ABI.Unpack("tryBlockAndAggregate", out)
	if err != nil {
		return 0, nil, fmt.Errorf("unpack multicall result: %w", err)
	}
	if len(vals) != 3 {
		return 0, nil, fmt.Errorf("unpack multicall result: expected 3 values, got %d", len(vals))
	}
	blockNum, ok := vals[0].(*big.Int)
	if !ok || !blockNum.IsUint64() {
		return 0, nil, fmt.Errorf("unpack multicall result: block number %v is not a uint64", vals[0])
	}
	raw := reflect.ValueOf(vals[2])
	if raw.Kind() != reflect.Slice {
		return 0, nil, fmt.Errorf("unpack multicall result: returnData is %T, not a slice", vals[2])
	}
	if raw.Len() != wantCalls {
		return 0, nil, fmt.Errorf("unpack multicall result: %d results for %d calls", raw.Len(), wantCalls)
	}
	results = make([]multicallResult, raw.Len())
	for i := 0; i < raw.Len(); i++ {
		el := raw.Index(i)
		results[i] = multicallResult{
			success:    el.Field(0).Interface().(bool),
			returnData: el.Field(1).Interface().([]byte),
		}
	}
	return blockNum.Uint64(), results, nil
}

// decodeCollateralOf turns one collateralOf return into the
// UpsertSnapshotBalances shape: lowercase asset-hex → "collateral" → amount.
// Zero-amount tokens are omitted — under wholesale per-account replacement,
// absence IS zero, and storing every configured-but-unheld token would bloat
// position_balances with dead rows. Duplicate token entries (never observed;
// defensive) accumulate additively. Any panic from malformed bytes is
// converted into an error.
func decodeCollateralOf(ret []byte) (balances map[string]map[string]*big.Int, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			balances, err = nil, fmt.Errorf("recovered panic: %v", rec)
		}
	}()
	vals, err := dmLensABI.Unpack("collateralOf", ret)
	if err != nil {
		return nil, err
	}
	if len(vals) != 2 {
		return nil, fmt.Errorf("expected 2 values, got %d", len(vals))
	}
	tokens := reflect.ValueOf(vals[0])
	if tokens.Kind() != reflect.Slice {
		return nil, fmt.Errorf("token list is %T, not a slice", vals[0])
	}
	balances = map[string]map[string]*big.Int{}
	for i := 0; i < tokens.Len(); i++ {
		el := tokens.Index(i)
		token := el.Field(0).Interface().(common.Address)
		amount := el.Field(1).Interface().(*big.Int)
		if amount == nil {
			return nil, fmt.Errorf("token %s carries a nil amount", token.Hex())
		}
		if amount.Sign() == 0 {
			continue
		}
		key := hex.EncodeToString(token.Bytes())
		if balances[key] == nil {
			balances[key] = map[string]*big.Int{}
		}
		if prev, ok := balances[key][sideCollateral]; ok {
			balances[key][sideCollateral] = new(big.Int).Add(prev, amount)
		} else {
			balances[key][sideCollateral] = new(big.Int).Set(amount)
		}
	}
	return balances, nil
}
