package prices

// The oracle POLLER: one per chain that carries registry `poll` obligations.
//
// A round is ONE multicall3 tryBlockAndAggregate of every obligation on the
// chain, so all of a round's rows are as-of the SAME execution block — the
// property that makes them comparable to each other, and the reason the
// execution block (not a separately-fetched head) is what stamps them.
//
// Rounds are CADENCE-driven (SOLVENT_PRICE_INTERVAL, default 60s). The cadence
// anchor advances when a due round is ATTEMPTED, not when it succeeds, so a
// failing poller cannot hammer RPC once per daemon tick; the daemon layers its
// jittered retry backoff on top of that for error storms.
//
// FAILURE POSTURE, in the order the failures happen:
//
//   - A durable reorg epoch is answered FIRST, before the cadence gate: an epoch
//     must be acknowledged whether or not a poll is due, or the next apply is
//     refused anyway. store.RewindPrices deletes this poller's rows above the
//     effective target atomically with the ack.
//   - A transport failure or a malformed multicall response is a round-level
//     error: nothing is recorded, the durable cursor is untouched, the round
//     retries.
//   - An INDIVIDUAL oracle revert (success=false under requireSuccess=false) is
//     a per-asset skip with a WARN, never a round failure — one broken oracle
//     must not cost every other asset its price. A round where EVERY oracle
//     reverted is logged DEGRADED and still advances the cursor: the cursor is a
//     reorg-ack anchor, not a completeness claim, and letting it stall would
//     wedge the epoch gate on an oracle outage.
//   - A STALE (frozen) RPC endpoint is the one semantic failure that never
//     surfaces as an RPC error: the eth_call succeeds and simply reports an
//     older execution block. The store catches it — ApplyPrices' monotonic
//     cursor guard refuses a through-block behind the recorded cursor with
//     ErrDeriveCursorRegression, and the whole transaction rolls back — and the
//     poller routes around it with a CALLER-SCOPED endpoint preference, exactly
//     the mechanism the collateral snapshotter established (see
//     internal/snapshot's package doc): start the next multicall one past the
//     endpoint that served the stale batch via CallFrom, leave the SHARED
//     routing hint alone (another caller's success on the frozen endpoint would
//     legitimately re-pin it and bounce us straight back), and release the
//     preference only on genuine progress. Retaining it across an AMBIGUOUS
//     apply error is bounded by an ambiguity lease: after
//     maxConsecutiveAmbiguous consecutive ambiguous errors against the same
//     pinned preference, rotate it one further so a recovered endpoint is
//     eventually reprobed instead of excluded forever.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// maxPollTargets bounds a round's fan-out into ONE multicall. The registry
// carries 21 obligations today (20 OP PriceProviderV2 assets + the ETH weETH
// getRate() ratio); 100 keeps a round comfortably inside node eth_call gas caps
// — some OP assets are accountant-lens reads, which are not cheap — while
// leaving room for the registry to grow.
//
// Exceeding it is a CONSTRUCTION-TIME refusal rather than silent chunking: rows
// already carry their own block (store.PriceObservation.BlockNumber), so
// splitting a round across several multicalls is implementable, but it gives up
// the single-as-of-block property above and needs the stale-endpoint reasoning
// re-derived per chunk. That is a deliberate decision for whoever grows the
// registry, not something to happen by accident.
const maxPollTargets = 100

// pollHealthGrace is how many missed cadence intervals make a poller UNHEALTHY:
// a poller that has not landed a round in this many intervals is not serving
// prices, whatever the reason. Unlike a derive runner's terminal capability
// error this state is RECOVERABLE — the next landed round clears it.
const pollHealthGrace = 3

// maxConsecutiveAmbiguous bounds the ambiguity LEASE on the caller-scoped
// endpoint preference: how many CONSECUTIVE non-stale ("ambiguous") ApplyPrices
// errors a pinned preference survives before it rotates one endpoint further.
// One ambiguity is likely OURS (an indeterminate commit says nothing about the
// endpoint); persistent recurrence is bounded evidence that retention has
// stopped paying off. Same constant and same reasoning as internal/snapshot's.
const maxConsecutiveAmbiguous = 3

// PollerConfig binds a Poller to one chain's registry poll obligations.
type PollerConfig struct {
	ChainID  uint64        // the chain the obligations live on
	Interval time.Duration // SOLVENT_PRICE_INTERVAL
}

// Poller reads the registry's poll oracles into prices rows under a
// pseudo-engine cursor. It holds no durable state in memory: the cursor and the
// rows are the truth, so a restarted process simply polls the next round.
type Poller struct {
	store   PriceStore
	chain   PollChain
	cfg     PollerConfig
	targets []pollTarget
	sources []string // ownership scope handed to RewindPrices
	engine  string   // pseudo-engine cursor key
	now     clock

	// lastAttempt anchors the cadence: a due round consumes its slot when it is
	// ATTEMPTED, so failures cannot hot-loop RPC.
	lastAttempt time.Time
	// lastLanded is the health anchor — the last time a round's rows actually
	// committed. Seeded at construction so a fresh poller is healthy for its
	// grace window rather than unhealthy before its first round.
	lastLanded time.Time

	// preferredStart is the CALLER-SCOPED routing preference (-1 = none); see
	// the package comment's STALE endpoint bullet.
	preferredStart int
	// staleRotations counts consecutive stale rounds with no intervening
	// progress, feeding the "every endpoint is behind" DEGRADED log.
	staleRotations int
	// consecutiveAmbiguous is the bounded lease on preferredStart.
	consecutiveAmbiguous int
}

// NewPoller builds a Poller for the registry's poll obligations on
// cfg.ChainID. A chain with no obligations is a refusal, not an empty poller:
// the daemon decides which chains to build pollers for from the registry, so an
// empty one here means the two disagree.
func NewPoller(st PriceStore, ch PollChain, feeds *config.Feeds, cfg PollerConfig) (*Poller, error) {
	if st == nil || ch == nil || feeds == nil {
		return nil, fmt.Errorf("price poller: store, chain and feed registry are all required")
	}
	if cfg.ChainID == 0 {
		return nil, fmt.Errorf("price poller: chain id is required")
	}
	if cfg.Interval <= 0 {
		return nil, fmt.Errorf("price poller (chain %d): interval must be positive, got %s", cfg.ChainID, cfg.Interval)
	}
	targets, err := buildPollTargets(feeds, cfg.ChainID)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("price poller: the feed registry declares no poll obligations on chain %d", cfg.ChainID)
	}
	if len(targets) > maxPollTargets {
		return nil, fmt.Errorf("price poller (chain %d): %d poll obligations exceed the %d-per-round bound — splitting a round across multicalls gives up its single as-of block and needs the stale-endpoint reasoning re-derived per chunk",
			cfg.ChainID, len(targets), maxPollTargets)
	}
	now := time.Now
	return &Poller{
		store: st, chain: ch, cfg: cfg, targets: targets, sources: sourcesOf(targets),
		engine: PollCursorEngine(cfg.ChainID), now: now,
		lastLanded: now(), preferredStart: -1,
	}, nil
}

// Name returns the poller's pseudo-engine cursor key — self-describing for log
// attribution and for the daemon's health map.
func (p *Poller) Name() string { return p.engine }

// Sources returns the prices.source values this poller owns, for tests and for
// operator introspection.
func (p *Poller) Sources() []string { return p.sources }

// Health reports whether the poller is serving prices. UNHEALTHY means no round
// has landed for pollHealthGrace cadence intervals; it is RECOVERABLE (the next
// landed round clears it), unlike a derive runner's terminal capability error.
func (p *Poller) Health() (healthy bool, reason string) {
	grace := time.Duration(pollHealthGrace) * p.cfg.Interval
	if since := p.now().Sub(p.lastLanded); since > grace {
		return false, fmt.Sprintf("no price round has landed for %s (cadence %s, grace %s) on chain %d",
			since.Truncate(time.Second), p.cfg.Interval, grace, p.cfg.ChainID)
	}
	return true, ""
}

// Step performs one bounded unit of poll work: answer any durable reorg epoch,
// then — when the cadence says a round is due — one multicall of every
// obligation, landed through one ApplyPrices transaction.
//
// Returns advanced=false when no round is due, or when a round was refused
// without recording anything (a stale endpoint). advanced=true with a nil error
// means the round's rows and cursor committed.
func (p *Poller) Step(ctx context.Context) (bool, error) {
	// Reorg coordination FIRST, before the cadence gate: a durable epoch must be
	// acknowledged whether or not a round is due — ApplyPrices refuses every
	// batch until it is.
	unacked, err := p.store.HasUnackedReorg(ctx, p.engine, p.cfg.ChainID)
	if err != nil {
		return false, fmt.Errorf("price poller %q: unacked-reorg check: %w", p.engine, err)
	}
	if unacked {
		if err := p.rewind(ctx); err != nil {
			return false, err
		}
		return true, nil // rewound; the next Step polls
	}

	now := p.now()
	if !p.lastAttempt.IsZero() && now.Sub(p.lastAttempt) < p.cfg.Interval {
		return false, nil // not due
	}
	// The slot is consumed by the ATTEMPT: a failing round waits out the cadence
	// like a successful one instead of retrying every daemon tick.
	p.lastAttempt = now

	block, obs, servedBy, err := p.readRound(ctx)
	if err != nil {
		return false, err
	}

	if err := p.store.ApplyPrices(ctx, p.engine, p.cfg.ChainID, obs, block); err != nil {
		if errors.Is(err, store.ErrUnackedReorgEpoch) {
			// Reactive backstop: a walker rewind recorded an epoch after this
			// Step's proactive check. Ack it now, before any further apply.
			slog.Warn("price apply refused on an unacknowledged reorg epoch; rewinding prices",
				"engine", p.engine, "err", err)
			if rerr := p.rewind(ctx); rerr != nil {
				return false, errors.Join(err, rerr)
			}
			return true, nil
		}
		if errors.Is(err, store.ErrDeriveCursorRegression) {
			// STALE ENDPOINT: the multicall succeeded but reported an execution
			// block behind the recorded cursor, so the node is frozen on older
			// chain state. The transaction rolled back — nothing was recorded —
			// and the round retries against a different endpoint.
			p.onStaleEndpoint(block, servedBy, err)
			return false, nil
		}
		// AMBIGUOUS: ApplyPrices returns its transaction Commit's error, so the
		// batch may have landed with the acknowledgment lost. Nothing about that
		// says the preferred endpoint is trustworthy again, so the preference is
		// RETAINED (releasing it would let the next round fall back to the
		// shared hint, which may still point at an endpoint an earlier round
		// rejected as stale) — bounded by the ambiguity lease. The stale-round
		// telemetry restarts, because an apply error is a louder operator signal
		// than the all-endpoints-behind diagnosis it would otherwise suppress.
		p.onAmbiguousApply()
		return false, fmt.Errorf("price poller %q: apply prices at %d: %w", p.engine, block, err)
	}
	p.lastLanded = p.now()
	p.recordProgress()
	return true, nil
}

// readRound issues one multicall of every obligation and turns the results into
// deduped observations stamped with the multicall's EXECUTION block. Individual
// reverts and undecodable returns are per-asset skips with a WARN; only
// transport failures and a malformed multicall envelope fail the round.
func (p *Poller) readRound(ctx context.Context) (uint64, []store.PriceObservation, chain.EndpointToken, error) {
	noServer := chain.EndpointToken{Index: -1}
	calls := make([]multicall3Call, len(p.targets))
	for i, t := range p.targets {
		data, err := t.view.pack(t.Asset)
		if err != nil {
			return 0, nil, noServer, fmt.Errorf("price poller %q: pack %s for %s: %w", p.engine, t.Method, t.Symbol, err)
		}
		calls[i] = multicall3Call{Target: t.Contract, CallData: data}
	}
	// requireSuccess=false: one broken oracle must not fail the whole round.
	input, err := multicall3ABI.Pack("tryBlockAndAggregate", false, calls)
	if err != nil {
		return 0, nil, noServer, fmt.Errorf("price poller %q: pack multicall: %w", p.engine, err)
	}

	var out []byte
	var servedBy chain.EndpointToken
	if p.preferredStart >= 0 {
		// A prior stale round pinned the caller-scoped preference: start there,
		// leaving the shared routing hint alone.
		out, servedBy, err = p.chain.CallFrom(ctx, p.preferredStart, Multicall3Address, input)
	} else {
		out, servedBy, err = p.chain.CallWithToken(ctx, Multicall3Address, input)
	}
	if err != nil {
		return 0, nil, noServer, fmt.Errorf("price poller %q: multicall (%d oracles): %w", p.engine, len(p.targets), err)
	}
	block, results, err := unpackMulticallResult(out, len(p.targets))
	if err != nil {
		return 0, nil, servedBy, fmt.Errorf("price poller %q: %w", p.engine, err)
	}

	set := newPriceSet()
	reverted, undecodable := 0, 0
	for i, res := range results {
		t := p.targets[i]
		if !res.success {
			reverted++
			slog.Warn("oracle read reverted; skipping this asset for the round (its previous prices stand)",
				"engine", p.engine, "symbol", t.Symbol, "asset", t.Asset.Hex(),
				"oracle", t.Contract.Hex(), "method", t.Method, "block", block)
			continue
		}
		value, err := t.view.unpack(res.returnData)
		if err != nil {
			// A well-formed multicall envelope carrying an undecodable inner
			// return is this asset's problem, not the round's: the same
			// per-asset posture as a revert.
			undecodable++
			slog.Warn("oracle return did not decode; skipping this asset for the round",
				"engine", p.engine, "symbol", t.Symbol, "asset", t.Asset.Hex(),
				"oracle", t.Contract.Hex(), "method", t.Method, "block", block, "err", err)
			continue
		}
		set.add(store.PriceObservation{
			Asset:       t.Asset.Bytes(),
			Source:      t.Source,
			Price:       value,
			Decimals:    t.Decimals,
			BlockNumber: block,
		})
	}
	if skipped := reverted + undecodable; skipped == len(p.targets) {
		// Every oracle failed. The round still applies (an empty batch advances
		// the cursor, keeping the epoch ack current) but the operator has to
		// hear that no price was recorded at all.
		slog.Warn("price round DEGRADED: every oracle read failed — no prices recorded this round",
			"engine", p.engine, "oracles", len(p.targets), "reverted", reverted,
			"undecodable", undecodable, "block", block)
	}
	return block, set.observations(), servedBy, nil
}

// rewind acknowledges every reorg epoch on the poller's chain: RewindPrices to
// the poller's OWN cursor (the store lowers the target to the deepest
// unacknowledged rewound_to, so passing the cursor never leaves rows above it),
// then resume FROM THE CURSOR READ BACK — never from the requested target.
//
// Bootstrap (no cursor yet on a chain that already carries epochs) targets
// block 0: there is nothing of this poller's to delete, and the call exists
// purely to create the cursor and ack, which is what ApplyPrices demands before
// it will admit a new writer on such a chain.
//
// THIS IS LOSSY, and deliberately so. The walker rewinds to its VERIFIED
// ANCESTOR — the highest stored log whose hash still matches the live chain —
// which can sit well below the actual fork point when raw logs are sparse, and
// in the degenerate no-verifiable-ancestor case is the stream's StartBlock-1.
// The poller cannot re-poll history (it only ever reads `latest`), so every
// deleted row is gone for good: a deep rewind discards polled price history for
// blocks that were, in all likelihood, perfectly canonical, and the worst case
// (a full-rewalk rewind) discards ALL of it. The alternative — acking the epoch
// while keeping the rows — would leave the store asserting engine-exact prices
// at heights the chain may have replaced, which for a liquidation-facing table
// is the worse failure. The distance discarded is WARNed so the loss is visible
// rather than silent, and the next round re-establishes a price at the new head
// within one cadence interval.
func (p *Poller) rewind(ctx context.Context) error {
	cursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return fmt.Errorf("price poller %q: read cursor before rewind: %w", p.engine, err)
	}
	target := uint64(0)
	if found {
		target = cursor
	}
	if err := p.store.RewindPrices(ctx, p.engine, p.cfg.ChainID, target, p.sources); err != nil {
		return fmt.Errorf("price poller %q: rewind prices to %d: %w", p.engine, target, err)
	}
	newCursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return fmt.Errorf("price poller %q: read cursor after rewind: %w", p.engine, err)
	}
	if !found {
		return fmt.Errorf("price poller %q: cursor missing after RewindPrices — store contract violated", p.engine)
	}
	discarded := uint64(0)
	if found && target > newCursor {
		discarded = target - newCursor
	}
	slog.Warn("polled prices rewound after reorg epoch; discarded rows CANNOT be re-polled (this path only reads `latest`)",
		"engine", p.engine, "requestedTarget", target, "cursor", newCursor,
		"blocksDiscarded", discarded, "sources", len(p.sources))
	// A rewind moves the queue forward even though no price landed: the cadence
	// slot is not consumed, so the next Step polls immediately and replaces the
	// deleted rows at the new head.
	return nil
}

// onStaleEndpoint records a stale (frozen-endpoint) round.
//
// KNOWN IMPRECISION, bounded: a deep reorg can also move the chain head
// BACKWARD, and a poll served during the window between that reorg and the
// walker's detection of it would report a legitimately-lower execution block and
// be attributed to the endpoint. The cost is one round's pin against a healthy
// endpoint, released by the next round's progress; the reorg itself is answered
// by the epoch gate once the walker records it. Mis-attributing a rare reorg is
// preferable to not routing around a frozen node at all.
//
// Behaviour: pin the next
// multicall one past the endpoint that served it, restart the ambiguity lease
// (a stale batch is its own bounded preference machinery, not a lease
// consumption), and count the streak toward the all-endpoints-behind DEGRADED
// log. That threshold is TELEMETRY, not a correctness gate — the durable cursor
// already guarantees nothing is recorded from a frozen node — and its bound is
// honest rather than exact: an intervening ambiguous apply error restarts the
// streak, so an alternating stale/error pattern defers the warning. Accepted,
// because that pattern already floods the log with apply errors; this warning
// exists for the QUIET mode where every endpoint is behind and nothing errors.
func (p *Poller) onStaleEndpoint(block uint64, servedBy chain.EndpointToken, cause error) {
	slog.Warn("price round DEGRADED: stale rpc endpoint — multicall reported an execution block behind the recorded cursor; nothing recorded, retrying next round",
		"engine", p.engine, "execBlock", block, "endpoint", servedBy.Index, "err", cause)
	if n := p.chain.EndpointCount(); n > 0 && servedBy.Index >= 0 {
		p.preferredStart = (servedBy.Index + 1) % n
		slog.Warn("preferring next rpc endpoint after stale price round",
			"engine", p.engine, "staleEndpoint", servedBy.Index, "preferredStart", p.preferredStart)
	}
	p.consecutiveAmbiguous = 0
	p.staleRotations++
	if n := p.chain.EndpointCount(); n > 0 && p.staleRotations >= n {
		slog.Warn("price ingestion DEGRADED: all endpoints behind — cycled through every rpc endpoint without landing a round",
			"engine", p.engine, "endpoints", n, "staleRotations", p.staleRotations)
	}
}

// onAmbiguousApply consumes one unit of the ambiguity lease on the pinned
// endpoint preference and rotates it once the lease is spent, so a recovered
// earlier endpoint is eventually reprobed instead of excluded forever. It also
// restarts the stale-round telemetry (see onStaleEndpoint) but deliberately does
// NOT release the preference.
func (p *Poller) onAmbiguousApply() {
	p.staleRotations = 0
	if p.preferredStart < 0 {
		return // nothing pinned: multicalls already follow the shared hint
	}
	p.consecutiveAmbiguous++
	if p.consecutiveAmbiguous < maxConsecutiveAmbiguous {
		return
	}
	if n := p.chain.EndpointCount(); n > 0 {
		p.preferredStart = (p.preferredStart + 1) % n
	}
	p.consecutiveAmbiguous = 0
	slog.Warn("rotating preferred endpoint after repeated ambiguous price apply failures",
		"engine", p.engine, "preferredStart", p.preferredStart)
}

// recordProgress releases the caller-scoped failover state on GENUINE progress
// (a round that committed): the endpoint preference goes back to the shared
// routing hint, and both its lease and the stale-round streak restart so a later
// isolated stale round cannot inherit an earlier cycle's count.
func (p *Poller) recordProgress() {
	p.preferredStart = -1
	p.staleRotations = 0
	p.consecutiveAmbiguous = 0
}
