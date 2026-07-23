// Package snapshot implements the OP collateral snapshotter (recon caveat 4):
// Debt Manager collateral is NOT event-derivable — collateralOf() reads the
// live ERC20 balances of the borrower's Safe via CashLens
// (DebtManagerCore.sol:170-182), and no Debt Manager event tracks collateral
// movement — so the only honest source is a periodic on-chain view sweep.
//
// THE SWEEP MODEL IS DURABLE (sweep-durability wave): a sweep is a persisted
// GENERATION (store.OpenSweepGeneration bumps sweep_generations, one durable
// statement), and per-account progress is the generation stamp on the
// account's snapshot_sweeps row — written atomically with its balances by
// store.ApplySweepBatch. The work queue is therefore never process memory:
// each Step pulls one bounded batch of accounts still LAGGING the open
// generation (store.SweepWorkBatch: registry LEFT JOIN sweep status,
// oldest-first, then budget-bounded retries of this generation's failures)
// and issues at most ONE aggregated eth_call (multicall3 tryBlockAndAggregate
// of collateralOf reads against the Debt Manager proxy). An empty batch
// means the generation is COMPLETE (store.CompleteSweepGeneration stamps the
// cadence anchor). A restarted process resumes EXACTLY where the previous
// one stopped — the lagging set is the queue — and never re-reads accounts
// already stamped current.
//
// Sweeps open when due: on first run (no generation has ever been opened),
// every SOLVENT_SNAPSHOT_INTERVAL after the last COMPLETED generation, and
// IMMEDIATELY after a derived-state rewind. The post-rewind leg is durable by
// construction: store.RewindDerived bumps the generation INSIDE its own
// transaction (atomic with the epoch ack and the orphaned-snapshot
// invalidation), so a crash at any point after the rewind still leaves the
// re-sweep durably open. TriggerResweep (wired to the runner's onRewind
// hook) is only the LIVE fast path: it defeats the cadence gate so the next
// Step notices the new state without waiting out the interval.
//
// FAILURE POSTURE: a failed multicall (transport) or a malformed/undecodable
// response is a batch-level error — the durable queue is untouched and the
// same batch retries next round. A batch served at an execution block BEHIND
// its accounts' recorded successes (stale failover: a lagging RPC endpoint)
// is refused by the store's monotonic guard — per-account skips leave those
// accounts lagging for retry, and an ALL-stale batch surfaces as
// store.ErrStaleSweepBatch, logged here as a DEGRADED round rather than
// treated as applied. A RESPONSIVE endpoint frozen on old chain state passes
// the failover's error-driven rotation every time (the eth_call succeeds),
// so Step pins a CALLER-SCOPED PERSISTENT endpoint preference on this path:
// the next multicall starts one past the endpoint (named by the multicall's
// token) that served the stale batch — via chain.CallFrom, which leaves the
// failover's SHARED routing hint alone — and the preference persists,
// advancing past each further stale server, until real progress releases it
// back to the shared hint. The shared hint deliberately carries none of
// this: any other caller's success on the rejected endpoint (the walker's
// BlockNumber) legitimately re-pins the shared hint there, so a shared-hint
// rotation cannot hold a caller-specific semantic exclusion — the sweep
// would bounce straight back to the frozen endpoint forever. Step tracks
// consecutive stale rounds since the last progress transition — a landed
// batch, a completed generation, or any observed generation change
// (rewind/re-sweep bumps included) — and only once a FRESH streak has cycled
// through every configured endpoint without progress logs an explicit "all
// endpoints stale" DEGRADED warning — the existing DEGRADED posture still
// stands (nothing wedges), but the operator learns rotation alone cannot
// save this round. An ERRORED ApplySweepBatch may nonetheless have COMMITTED
// (it returns its transaction Commit's error — commit indeterminacy, a lost
// ack, or even a race where pgx surfaces a commit error while the server is
// still resolving it and a later real commit lands): the stale streak and
// its DEGRADED warning are TELEMETRY bounds, not a correctness mechanism —
// correctness lives in the durable generation model, not this counter — so
// Step conservatively treats ANY non-stale apply error as progress for the
// stale-round TELEMETRY only (resetStaleTelemetry), immediately, with no
// next-round probe and no remembered state — but retains the endpoint
// preference: an ambiguous error proves nothing about whether the preferred
// endpoint is still worth avoiding, and releasing it here would let the very
// next retry fall back to the shared hint, which may still point at an
// endpoint a previous round explicitly rejected as stale, bouncing the sweep
// straight back to it. Only GENUINE progress — a nil ApplySweepBatch return,
// a generation completion stamping, or an observed generation change — also
// releases the preference (recordProgress). Because recurrent non-stale
// apply errors reset the telemetry streak every time, a persistent
// alternating stale/apply-error pattern defers the all-endpoints-stale
// DEGRADED warning indefinitely; this is accepted rather than patched with
// suppression machinery, because that pattern already floods the log with
// apply errors — the primary operator signal — and the DEGRADED warning
// exists for the QUIET failure mode where every endpoint serves stale state
// without any apply attempt ever erroring. Retaining the preference through
// ONE ambiguous error is not unbounded, though: consecutiveAmbiguous is a
// BOUNDED AMBIGUITY LEASE on that retention — once maxConsecutiveAmbiguous
// (3) CONSECUTIVE ambiguous errors land against the SAME still-pinned
// preference, Step rotates it one endpoint further and resets the lease,
// logging "rotating preferred endpoint after repeated ambiguous apply
// failures" — so a recovered earlier endpoint is eventually reprobed rather
// than excluded forever. This is a distinct bound from staleRotations: that
// one gates only a DEGRADED WARNING (telemetry); this one gates ROUTING
// itself, and is reset by genuine progress or by a stale batch (each of
// which already owns its own bounded preference machinery). An individual
// collateralOf revert
// (success=false under requireSuccess=false) is ALWAYS a per-account failure
// — recorded status='failed' with a durable attempts counter, retried up to
// maxAccountRetries further times within the generation (SweepWorkBatch
// drains lagging accounts first, so retries never starve fresh work), then
// skipped until the next generation; a generation that completes with such
// accounts logs DEGRADED. There is deliberately NO "every call reverted"
// batch error anymore: an all-reverted batch is N per-account failures whose
// bounded budgets guarantee the sweep still converges — the old posture let
// one systemically-broken view wedge the queue forever, which is a worse
// failure than N recorded degradations.
//
// Not safe for concurrent use: Step and TriggerResweep are driven from the
// daemon's single loop under the single-writer contract (D-004) — snapshot
// rows share position_balances with the derivation writes.
package snapshot

import (
	"context"
	"encoding/hex"
	"errors"
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

// maxAccountRetries bounds how many retry attempts an individually-reverting
// Safe gets per generation beyond its first attempt; after that it stays
// status='failed' until the next generation. The budget is DURABLE — the
// snapshot_sweeps attempts counter — so a crash mid-generation cannot reset
// a Safe's spent retries.
const maxAccountRetries = 3

// maxSweepAttempts is the total per-generation attempt budget SweepWorkBatch
// enforces: the first attempt plus the retry budget.
const maxSweepAttempts = 1 + maxAccountRetries

// maxConsecutiveAmbiguous bounds the ambiguity LEASE on the caller-scoped
// endpoint preference (preferredStart): the number of CONSECUTIVE non-stale
// ("ambiguous") ApplySweepBatch errors a pinned preference survives before
// Step rotates it forward instead of retaining it forever. This bounds
// ROUTING, not telemetry — contrast with staleRotations/the all-endpoints-
// stale DEGRADED warning, which this constant does not gate at all. See
// consecutiveAmbiguous's doc and the ambiguous-apply branch in Step for why
// one (or two) ambiguous errors alone must NOT rotate the preference.
const maxConsecutiveAmbiguous = 3

const sideCollateral = "collateral"

// Store is the snapshotter's store surface (*store.Store satisfies it): the
// durable sweep-generation queue. The snapshotter writes results ONLY through
// ApplySweepBatch — balances, collateral history and status land in one
// transaction (fix: the old separate upsert-then-record pair could persist
// balances and lose status, or vice versa, across a crash).
type Store interface {
	SweepGeneration(ctx context.Context, engine string) (generation uint64, open bool, completedAt time.Time, err error)
	OpenSweepGeneration(ctx context.Context, engine string) (uint64, error)
	SweepWorkBatch(ctx context.Context, engine string, generation uint64, maxAttempts, limit int) ([][]byte, error)
	ApplySweepBatch(ctx context.Context, engine string, generation, execBlock uint64, results []store.SweepResult) error
	CompleteSweepGeneration(ctx context.Context, engine string, generation uint64) (failed int64, stamped bool, err error)
}

var _ Store = (*store.Store)(nil)

// Chain is the snapshotter's chain surface (*chain.Failover satisfies it).
// CallFrom and EndpointCount back the semantic-staleness failover: a batch
// response that is well-formed at the RPC layer but stale per the store's
// monotonic guard is invisible to the failover client's own error-driven
// rotation (the eth_call succeeded), so the snapshotter routes around it
// with a caller-scoped persistent preference — starting subsequent
// multicalls past the endpoint (named by token) that served the stale batch
// — without touching the shared routing hint that other callers'
// error-driven routing owns.
type Chain interface {
	// CallWithToken executes a read-only eth_call under failover rotation
	// from the SHARED sticky active hint and returns, alongside the result,
	// a token naming the endpoint that served it.
	CallWithToken(ctx context.Context, to common.Address, data []byte) ([]byte, chain.EndpointToken, error)
	// CallFrom is CallWithToken with a CALLER-SCOPED starting endpoint: the
	// attempt walk starts at startIndex (mod the endpoint count) and a
	// success neither reads nor writes the shared active hint — a semantic
	// caller's routing preference must not fight error-driven routing.
	CallFrom(ctx context.Context, startIndex int, to common.Address, data []byte) ([]byte, chain.EndpointToken, error)
	// EndpointCount reports how many RPC endpoints the failover client
	// rotates across, bounding both the preferred-start arithmetic and the
	// "cycled through every endpoint without progress" check after repeated
	// stale rounds.
	EndpointCount() int
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
// collateralOf reads into snapshot-sourced position_balances rows. It holds
// NO sweep progress in memory — the durable generation state is the queue —
// so any Snapshotter (including one in a freshly restarted process) resumes
// exactly where the durable state says work stopped.
type Snapshotter struct {
	store Store
	chain Chain
	cfg   Config
	now   func() time.Time // injectable clock (tests)

	// resweep is the LIVE post-rewind fast path (single-loop owned): it
	// defeats the cadence gate on the next Step. The durable leg needs no
	// flag — RewindDerived already opened the new generation in its own
	// transaction, and Step reads that state every round.
	resweep bool

	// staleRotations counts consecutive ErrStaleSweepBatch rounds with NO
	// intervening progress — the "how many endpoints have we cycled through
	// without landing anything" measure feeding the all-endpoints-stale
	// DEGRADED log. It resets on EVERY progress transition: a batch actually
	// applying, a generation completing (stamped or superseded), any
	// observed generation change (rewind/re-sweep bumps, cadence opens —
	// tracked via lastSeenGeneration), via recordProgress; and ALSO on any
	// non-stale ApplySweepBatch error, via resetStaleTelemetry alone (see
	// Step: an ambiguous/indeterminate commit is conservatively treated as
	// progress for this counter, immediately, with no reconciliation probe —
	// but that call does NOT touch preferredStart below). The DEGRADED
	// warning therefore requires a FRESH full endpoint cycle of consecutive
	// stale rounds with no intervening apply error either; recurrent
	// non-stale apply errors reset this counter each time, so a persistent
	// alternating stale/apply-error pattern defers the warning indefinitely.
	// Accepted: see the DEGRADED log site in Step for why.
	staleRotations int

	// lastSeenGeneration is the generation the previous working Step ran
	// against; an observed change is queue-level progress and restarts the
	// stale streak above.
	lastSeenGeneration uint64

	// preferredStart is the CALLER-SCOPED persistent routing preference
	// (-1 = none): while set, every multicall starts its endpoint walk at
	// this index via chain.CallFrom instead of the failover's shared active
	// hint. Set one past the endpoint that served the last stale batch,
	// advanced one past each further stale server, and released (-1) only on
	// GENUINE progress — a nil ApplySweepBatch return, a generation
	// completion stamping, or an observed generation change — via
	// recordProgress. An ambiguous (non-stale) ApplySweepBatch error resets
	// ONLY the stale-round telemetry (resetStaleTelemetry), never this
	// field: an ambiguous error proves nothing about whether the preferred
	// endpoint is still worth avoiding, and releasing the preference there
	// would let the very next retry fall back to the shared hint — which may
	// still point at an endpoint a previous round explicitly rejected as
	// stale, bouncing the sweep straight back to it. It is deliberately NOT
	// the shared hint itself: a shared exclusion cannot stick — another
	// caller's success on the rejected endpoint (the walker's BlockNumber
	// against an endpoint whose eth_call state is frozen) legitimately
	// re-pins the shared hint there, and a shared-hint-routed sweep would
	// bounce back to the stale endpoint forever.
	preferredStart int

	// consecutiveAmbiguous is the BOUNDED AMBIGUITY LEASE on preferredStart:
	// it counts CONSECUTIVE non-stale ("ambiguous") ApplySweepBatch errors
	// seen while a preference is pinned. One ambiguity retains the
	// preference (the error is likely OURS, not the endpoint's — an
	// indeterminate commit proves nothing about the endpoint; see
	// resetStaleTelemetry), but persistent recurrence is different evidence:
	// once it reaches maxConsecutiveAmbiguous, Step rotates preferredStart
	// one endpoint further (mod EndpointCount) and resets this counter to
	// 0 — so a recovered earlier endpoint is eventually reprobed instead of
	// being excluded forever, which is the gap this field closes. Reset to
	// 0 on genuine progress and on a stale batch (recordProgress and the
	// stale branch each already own their own bounded preference machinery)
	// — so it only ever accumulates across ambiguous errors landing back to
	// back against the SAME still-pinned preference. Distinct from
	// staleRotations: that field bounds a TELEMETRY WARNING; this one
	// bounds ROUTING itself.
	consecutiveAmbiguous int
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
	return &Snapshotter{store: st, chain: ch, cfg: cfg, now: time.Now, preferredStart: -1}, nil
}

// resetStaleTelemetry resets ONLY the stale-round streak — the
// all-endpoints-stale DEGRADED telemetry — without releasing the
// caller-scoped endpoint preference. This is the correct call for a
// non-stale ("ambiguous") ApplySweepBatch error: the commit outcome is
// indeterminate (see Step), so treating it as progress for the TELEMETRY
// suppresses a false all-endpoints-stale diagnosis, but the preference is a
// ROUTING decision, not a telemetry counter — an ambiguous error on the
// preferred endpoint proves nothing about whether that endpoint is still
// worth avoiding, so releasing it here would let the very next retry fall
// back to the shared hint, which may still point at an endpoint a previous
// round explicitly rejected as stale, bouncing the sweep straight back to
// it. Recurrent non-stale apply errors reset this counter every time they
// occur; a persistent alternating stale/apply-error pattern therefore
// defers the all-endpoints-stale warning indefinitely — accepted, see the
// DEGRADED log site in Step for why.
func (s *Snapshotter) resetStaleTelemetry() {
	s.staleRotations = 0
}

// recordProgress resets the caller-scoped failover state on GENUINE
// progress — a nil ApplySweepBatch return, a generation completion
// stamping, or an observed generation change (rewind/re-sweep bumps,
// cadence opens): the stale-round streak restarts (via resetStaleTelemetry)
// AND the persistent endpoint preference releases back to the shared
// routing hint, along with its ambiguity lease (consecutiveAmbiguous) —
// releasing the preference without also clearing its lease would let a
// LATER re-pin inherit an unrelated earlier count. Do NOT call this for an
// ambiguous (non-stale) ApplySweepBatch error — call resetStaleTelemetry
// alone; see its doc and the Step call site for why the preference must
// survive that case (bounded by its own lease instead).
func (s *Snapshotter) recordProgress() {
	s.resetStaleTelemetry()
	s.preferredStart = -1
	s.consecutiveAmbiguous = 0
}

// TriggerResweep requests an immediate sweep: the next Step bypasses the
// cadence gate. Wired to the derivation runner's onRewind hook as the LIVE
// fast path — the durable post-rewind leg is RewindDerived's own
// in-transaction generation bump, which a crash between the rewind and this
// hook cannot lose (the restarted process finds the generation OPEN and
// resumes it on its first Step).
func (s *Snapshotter) TriggerResweep() {
	s.resweep = true
}

// Step performs one bounded unit of sweep work against the DURABLE queue:
// read the generation state (one PK row); open a new generation when none is
// open and the cadence (or a re-sweep request) says one is due; pull one
// bounded batch of lagging accounts; multicall them; land the results through
// ONE ApplySweepBatch transaction. An empty batch completes the generation
// (stamping the cadence anchor; DEGRADED when any account exhausted its
// retry budget). Returns advanced=false only when no sweep is open and none
// is due. Errors leave the durable queue untouched — the same batch re-pulls
// next round, and ApplySweepBatch's idempotence makes redo safe.
func (s *Snapshotter) Step(ctx context.Context) (bool, error) {
	gen, open, completedAt, err := s.store.SweepGeneration(ctx, s.cfg.Engine)
	if err != nil {
		return false, fmt.Errorf("snapshotter %q: read sweep generation: %w", s.cfg.Engine, err)
	}
	if !open {
		due := s.resweep || completedAt.IsZero() || s.now().Sub(completedAt) >= s.cfg.Interval
		if !due {
			return false, nil
		}
		gen, err = s.store.OpenSweepGeneration(ctx, s.cfg.Engine)
		if err != nil {
			return false, fmt.Errorf("snapshotter %q: open sweep generation: %w", s.cfg.Engine, err)
		}
	}
	// The request is served either way: an already-open generation (typically
	// RewindDerived's own durable bump) IS the immediate sweep.
	s.resweep = false

	// Any observed generation transition — a cadence open above, a rewind's
	// durable bump, a superseding re-sweep — is queue-level progress: the
	// stale streak measures consecutive stale rounds with NO intervening
	// progress, so it restarts here rather than carrying a count from an
	// older generation into this one.
	if gen != s.lastSeenGeneration {
		s.recordProgress()
		s.lastSeenGeneration = gen
	}

	batch, err := s.store.SweepWorkBatch(ctx, s.cfg.Engine, gen, maxSweepAttempts, s.cfg.BatchSize)
	if err != nil {
		return false, fmt.Errorf("snapshotter %q: read sweep work batch: %w", s.cfg.Engine, err)
	}
	if len(batch) == 0 {
		// No registry account lags and no retry budget remains: the
		// generation is complete. The stamp is guarded — a rewind's bump may
		// have superseded gen mid-round, in which case the next Step simply
		// resumes the newer generation.
		failed, stamped, err := s.store.CompleteSweepGeneration(ctx, s.cfg.Engine, gen)
		if err != nil {
			return false, fmt.Errorf("snapshotter %q: complete sweep generation %d: %w", s.cfg.Engine, gen, err)
		}
		// Completion is progress (a superseded stamp too — the generation
		// ended either way): restart the stale streak and release the
		// endpoint preference.
		s.recordProgress()
		switch {
		case !stamped:
			// Superseded (or an empty-registry generation already stamped by a
			// racing bump): nothing to log as completed.
		case failed > 0:
			slog.Warn("collateral snapshot sweep completed DEGRADED — some safes stayed failed through the retry budget",
				"engine", s.cfg.Engine, "generation", gen, "failedAccounts", failed)
		default:
			slog.Info("collateral snapshot sweep completed", "engine", s.cfg.Engine, "generation", gen)
		}
		return true, nil
	}

	block, results, servedBy, err := s.sweepBatch(ctx, batch)
	if err != nil {
		return false, err
	}
	if err := s.store.ApplySweepBatch(ctx, s.cfg.Engine, gen, block, results); err != nil {
		if errors.Is(err, store.ErrStaleSweepBatch) {
			// DEGRADED round, not a completion: the whole batch was served at
			// an execution block behind its accounts' recorded successes (a
			// failed-over endpoint lagging the chain). The store applied
			// nothing and the durable queue is untouched — the same accounts
			// re-pull next round, most likely against a caught-up endpoint.
			// (The typed refusal is returned BEFORE the store's commit, so no
			// commit indeterminacy exists on this branch — nothing to
			// remember for reconciliation.)
			slog.Warn("collateral snapshot sweep round DEGRADED: stale sweep block — endpoint behind; nothing applied, retrying next round",
				"engine", s.cfg.Engine, "generation", gen, "execBlock", block, "accounts", len(batch))

			// The eth_call SUCCEEDED (this is semantic staleness, not an RPC
			// error), so chain.Failover's own error-driven rotation never saw
			// a problem — and the SHARED routing hint cannot carry the
			// exclusion either: any other caller's success on the frozen
			// endpoint (the walker's BlockNumber) would legitimately re-pin
			// the hint there and drag the next multicall straight back. The
			// snapshotter therefore OWNS a persistent caller-scoped
			// preference: start the next multicall one past the endpoint
			// (by token) that served this stale batch, and keep starting
			// there until real progress releases it.
			if n := s.chain.EndpointCount(); n > 0 {
				s.preferredStart = (servedBy.Index + 1) % n
				slog.Warn("preferring next rpc endpoint after stale sweep batch",
					"engine", s.cfg.Engine, "generation", gen, "execBlock", block,
					"staleEndpoint", servedBy.Index, "preferredStart", s.preferredStart)
			}
			// A stale batch is its OWN bounded preference machinery (the pin
			// above) — it is not an ambiguity-lease consumption, so the lease
			// counter restarts here too: only ambiguous errors landing
			// CONSECUTIVELY against one still-pinned preference count toward
			// maxConsecutiveAmbiguous.
			s.consecutiveAmbiguous = 0
			s.staleRotations++

			// This threshold is telemetry, not a correctness gate — the
			// durable generation model already guarantees eventual
			// convergence (see the package doc). Its bound is honest, not
			// "at worst one cycle late": recurrent non-stale apply errors
			// reset this counter each time (resetStaleTelemetry, called on
			// the ambiguous-error branch below), so a persistent alternating
			// stale/apply-error pattern defers this warning indefinitely.
			// Accepted: that pattern already floods the log with apply
			// errors — the primary operator signal; this warning exists for
			// the QUIET failure mode where every endpoint serves stale state
			// without any apply attempt ever erroring.
			if n := s.chain.EndpointCount(); n > 0 && s.staleRotations >= n {
				slog.Warn("collateral snapshot sweep DEGRADED: all endpoints stale — cycled through every rpc endpoint without landing a batch",
					"engine", s.cfg.Engine, "generation", gen, "endpoints", n, "staleRotations", s.staleRotations)
			}
			return false, nil
		}
		// Durable queue untouched IF the transaction really failed — but
		// ApplySweepBatch returns its Commit's error, so this error may be an
		// AMBIGUOUS commit (a lost ack on a batch that durably landed, or
		// even a race where pgx surfaces a commit error while the server is
		// still resolving it and a later real commit lands). The stale
		// streak and its DEGRADED warning are TELEMETRY bounds, not a
		// correctness mechanism — durable sweep generations, not this
		// counter, gate the work — so an ambiguous commit is conservatively
		// treated as progress for THAT TELEMETRY, right now: resetStaleTelemetry
		// restarts the streak. Recurrent non-stale apply errors reset this
		// counter each time; a persistent alternating stale/apply-error
		// pattern therefore defers the all-endpoints-stale warning
		// indefinitely. Accepted: that pattern already floods the log with
		// apply errors — the primary operator signal; this warning exists
		// for the QUIET failure mode where every endpoint serves stale state
		// without any apply attempt ever erroring.
		//
		// The endpoint PREFERENCE is deliberately NOT released here (unlike
		// recordProgress on a genuine-progress path): an ambiguous error
		// proves nothing about whether the preferred endpoint — the one
		// that just served a batch whose landing we can't confirm — is
		// still worth avoiding. Releasing it would let the very next retry
		// fall back to the shared hint, which may still point at an
		// endpoint a previous round explicitly rejected as stale (Codex
		// regression 019f8fda-34f9-7b82-9db2-89c6b317bb4a: preference→B,
		// ambiguous error on B, preference released, next retry bounces
		// back to rejected A). Only GENUINE progress — a nil
		// ApplySweepBatch return, a generation completion stamping, or an
		// observed generation change — releases the preference, via
		// recordProgress. The re-pull/re-apply posture is unaffected either
		// way (ApplySweepBatch is idempotent under replay).
		s.resetStaleTelemetry()

		// BOUNDED AMBIGUITY LEASE (Codex finding 019f8ffd-4aca-7201-a374-
		// bfb5cdce6f06 [medium]): retaining the preference forever under
		// REPEATED ambiguous errors — as opposed to a single one — is a
		// different failure shape than the one the paragraph above defends
		// against. One ambiguous error is likely OURS (an indeterminate
		// commit outcome), not evidence against the endpoint; but a THIRD
		// CONSECUTIVE ambiguous error while the SAME preference stays
		// pinned is bounded evidence that retention itself has stopped
		// paying off, so Step rotates the preference one endpoint further
		// instead of pinning it forever — the routing analogue of
		// staleRotations' all-endpoints-stale WARNING, except this one
		// bounds ROUTING, not a diagnostic log. Only counts while a
		// preference is actually pinned (preferredStart >= 0): with none
		// pinned, multicalls already follow the shared hint and there is no
		// lease to bound.
		if s.preferredStart >= 0 {
			s.consecutiveAmbiguous++
			if s.consecutiveAmbiguous >= maxConsecutiveAmbiguous {
				if n := s.chain.EndpointCount(); n > 0 {
					s.preferredStart = (s.preferredStart + 1) % n
				}
				s.consecutiveAmbiguous = 0
				slog.Warn("rotating preferred endpoint after repeated ambiguous apply failures",
					"engine", s.cfg.Engine, "generation", gen, "preferredStart", s.preferredStart)
			}
		}
		return false, fmt.Errorf("snapshotter %q: apply sweep batch: %w", s.cfg.Engine, err)
	}
	// Progress: reset the stale streak, the endpoint preference and its
	// ambiguity lease so a later isolated stale round doesn't inherit an
	// earlier cycle's count.
	s.recordProgress()
	return true, nil
}

// sweepBatch reads one batch of Safes' collateral through a single
// tryBlockAndAggregate call and classifies every result: a successful
// collateralOf read becomes an OK SweepResult carrying the Safe's wholesale
// balances; an individual revert (success=false) is ALWAYS a per-account
// failure result — never a batch error, whatever fraction of the batch
// reverted (the durable attempts budget bounds its retries). Batch-level
// errors are ONLY transport failures and malformed/undecodable responses,
// which leave the durable queue untouched for a wholesale retry. The
// returned EndpointToken names the endpoint that served the multicall, so a
// store-level staleness rejection can be pinned on exactly that endpoint.
func (s *Snapshotter) sweepBatch(ctx context.Context, accounts [][]byte) (uint64, []store.SweepResult, chain.EndpointToken, error) {
	noServer := chain.EndpointToken{Index: -1}
	calls := make([]multicall3Call, len(accounts))
	for i, acct := range accounts {
		if len(acct) != common.AddressLength {
			return 0, nil, noServer, fmt.Errorf("snapshotter %q: registry account %x is not a 20-byte address", s.cfg.Engine, acct)
		}
		data, err := dmLensABI.Pack("collateralOf", common.BytesToAddress(acct))
		if err != nil {
			return 0, nil, noServer, fmt.Errorf("snapshotter %q: pack collateralOf(%x): %w", s.cfg.Engine, acct, err)
		}
		calls[i] = multicall3Call{Target: s.cfg.Target, CallData: data}
	}
	// requireSuccess=false: one broken Safe must not fail its whole batch.
	input, err := multicall3ABI.Pack("tryBlockAndAggregate", false, calls)
	if err != nil {
		return 0, nil, noServer, fmt.Errorf("snapshotter %q: pack multicall: %w", s.cfg.Engine, err)
	}
	var out []byte
	var servedBy chain.EndpointToken
	if s.preferredStart >= 0 {
		// A prior stale round pinned the caller-scoped preference: start
		// the walk there, leaving the shared routing hint alone.
		out, servedBy, err = s.chain.CallFrom(ctx, s.preferredStart, Multicall3Address, input)
	} else {
		out, servedBy, err = s.chain.CallWithToken(ctx, Multicall3Address, input)
	}
	if err != nil {
		return 0, nil, noServer, fmt.Errorf("snapshotter %q: multicall (%d safes): %w", s.cfg.Engine, len(accounts), err)
	}
	block, mcResults, err := unpackMulticallResult(out, len(accounts))
	if err != nil {
		return 0, nil, servedBy, fmt.Errorf("snapshotter %q: %w", s.cfg.Engine, err)
	}

	results := make([]store.SweepResult, 0, len(accounts))
	for i, res := range mcResults {
		if !res.success {
			// An individual view revert: previous snapshot rows stay in
			// place; the durable attempts counter bounds further retries.
			results = append(results, store.SweepResult{Account: accounts[i], OK: false})
			slog.Warn("collateralOf reverted for safe; keeping its previous snapshot",
				"engine", s.cfg.Engine, "account", hex.EncodeToString(accounts[i]))
			continue
		}
		balances, err := decodeCollateralOf(res.returnData)
		if err != nil {
			return 0, nil, servedBy, fmt.Errorf("snapshotter %q: decode collateralOf(%x): %w", s.cfg.Engine, accounts[i], err)
		}
		// A successful read always lands — including with an EMPTY balances
		// map: wholesale replacement is what clears the rows of a Safe whose
		// collateral went to zero, and the paired success status is what
		// distinguishes that from a never-swept Safe.
		results = append(results, store.SweepResult{Account: accounts[i], OK: true, Balances: balances})
	}
	return block, results, servedBy, nil
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

// decodeCollateralOf turns one collateralOf return into the SweepResult
// balances shape: lowercase asset-hex → "collateral" → amount. Zero-amount
// tokens are omitted — under wholesale per-account replacement, absence IS
// zero, and storing every configured-but-unheld token would bloat
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
