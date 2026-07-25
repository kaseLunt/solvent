package prices

// The oracle POLLER: one per chain that carries registry `poll` obligations.
//
// A round is ONE multicall3 tryBlockAndAggregate of every obligation on the
// chain, so all of a round's rows are as-of the SAME execution block — the
// property that makes them comparable to each other, and the reason the
// execution block (not a separately-fetched head) is what stamps them. The same
// call returns that block's HASH, which the round persists as a durable ANCHOR;
// everything this file does about reorgs rests on it.
//
// Rounds are CADENCE-driven (SOLVENT_PRICE_INTERVAL, default 60s). The cadence
// anchor advances when a due round is ATTEMPTED, not when it succeeds, so a
// failing poller cannot hammer RPC once per daemon tick; the daemon layers its
// jittered retry backoff on top of that for error storms.
//
// HEALTH IS PER-ASSET AND DURABLE, NEVER "A ROUND COMMITTED". An earlier version
// refreshed one process-memory timestamp on every apply that returned nil, so a
// round in which EVERY oracle reverted — a legitimate empty batch that still
// advances the cursor — kept the poller green forever with no price recorded,
// and a single asset failing while the others succeeded was invisible. Freshness
// is now tracked per (asset, source), HYDRATED from the newest durable rows so a
// restart cannot reset a dead oracle's clock, and re-hydrated after every rewind
// and every apply error. See Conditions.
//
// FAILURE POSTURE, in the order the failures happen:
//
//   - A durable reorg epoch is answered FIRST, before the cadence gate: an epoch
//     must be acknowledged whether or not a poll is due, or the next apply is
//     refused anyway. store.RewindPrices deletes this poller's rows above the
//     effective target atomically with the ack — and only down to the deepest
//     poll anchor whose hash this poller re-verified against the live chain (see
//     rewind).
//   - A transport failure or a malformed multicall response is a round-level
//     error: nothing is recorded, the durable cursor is untouched, the round
//     retries.
//   - An INDIVIDUAL oracle revert (success=false under requireSuccess=false) is
//     a per-asset skip with a WARN, never a round failure — one broken oracle
//     must not cost every other asset its price. A round where EVERY oracle
//     reverted is logged DEGRADED and still advances the cursor: the cursor is a
//     reorg-ack anchor, not a completeness claim, and letting it stall would
//     wedge the epoch gate on an oracle outage. It does NOT count as a landed
//     round for health.
//   - A CURSOR REGRESSION (the store refusing a through-block behind the
//     recorded cursor) is CAUSE-UNKNOWN until it is investigated. It can mean a
//     frozen RPC endpoint — the one semantic failure that never surfaces as an
//     RPC error, since the eth_call succeeds and simply reports an older
//     execution block — or it can mean a reorg the walker has not recorded yet,
//     which is the poller's own cursor describing blocks the chain has replaced.
//     Those have opposite remedies, so classifyRegression checks durable reorg
//     state and then the live ancestry of the poller's own newest anchor before
//     drawing any endpoint-specific conclusion.
//   - Only once an endpoint is actually implicated does the poller route around
//     it with a CALLER-SCOPED endpoint preference, exactly the mechanism the
//     collateral snapshotter established (see internal/snapshot's package doc):
//     start the next multicall one past the endpoint that served the stale batch
//     via CallFrom, leave the SHARED routing hint alone (another caller's success
//     on the frozen endpoint would legitimately re-pin it and bounce us straight
//     back), and release the preference only on genuine progress. Retaining it
//     across an AMBIGUOUS apply error is bounded by an ambiguity lease: after
//     maxConsecutiveAmbiguous consecutive ambiguous errors against the same
//     pinned preference, rotate it one further so a recovered endpoint is
//     eventually reprobed instead of excluded forever.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
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

// pollHealthGrace is how many missed cadence intervals make a poller's freshness
// UNHEALTHY: an asset whose newest durable price is older than this many
// intervals is not being served, whatever the reason. Unlike a derive runner's
// terminal capability error this state is RECOVERABLE — a landed price for that
// asset clears it.
const pollHealthGrace = 3

// maxConsecutiveAmbiguous bounds the ambiguity LEASE on the caller-scoped
// endpoint preference: how many CONSECUTIVE non-stale ("ambiguous") ApplyPrices
// errors a pinned preference survives before it rotates one endpoint further.
// One ambiguity is likely OURS (an indeterminate commit says nothing about the
// endpoint); persistent recurrence is bounded evidence that retention has
// stopped paying off. Same constant and same reasoning as internal/snapshot's.
const maxConsecutiveAmbiguous = 3

// maxAnchorProbes bounds how many stored poll anchors a rewind re-verifies
// against the live chain before giving up and falling back to the walker's
// target. Each probe is one eth_getBlockByNumber. Anchors are consumed newest
// first and the walk stops at the first hash match, so the probes needed equal
// the number of ORPHANED rounds plus one — i.e. the reorg's depth measured in
// poll rounds. Eight is far beyond any reorg this indexer expects; exhausting it
// degrades to the conservative (lossy) target rather than to a wrong one.
const maxAnchorProbes = 8

// PollerConfig binds a Poller to one chain's registry poll obligations.
type PollerConfig struct {
	ChainID  uint64        // the chain the obligations live on
	Interval time.Duration // SOLVENT_PRICE_INTERVAL
}

// Poller reads the registry's poll oracles into prices rows under a
// pseudo-engine cursor. Its DURABLE state is the cursor, the rows and the poll
// anchors; the in-memory freshness map is a cache of the rows, hydrated from
// them and re-hydrated whenever an apply's outcome is in doubt, so it can never
// be the sole basis of a health verdict.
type Poller struct {
	store   PollStore
	chain   PollChain
	cfg     PollerConfig
	targets []pollTarget
	sources []string // this writer's mechanism names, for logs and introspection
	engine  string   // pseudo-engine cursor key AND the durable row owner
	now     clock

	// lastAttempt anchors the cadence: a due round consumes its slot when it is
	// ATTEMPTED, so failures cannot hot-loop RPC.
	lastAttempt time.Time
	// startedAt is the reference for a target with NO durable observation at
	// all: at a cold start nothing has been polled yet, so the grace window runs
	// from construction. It is deliberately NOT used as a floor under a target
	// that DOES have a durable observation — that is exactly the restart-resets-
	// a-dead-oracle bug.
	startedAt time.Time

	// hydrated records whether lastPriced has been read back from durable
	// storage. Until it has, Conditions refuses to issue a freshness verdict and
	// (past the grace window) says so, rather than reporting green on unknown
	// state.
	hydrated bool
	// lastPriced is per-(asset, source) freshness: when a price for that key was
	// last durably recorded, keyed by pollTarget.key().
	lastPriced map[string]time.Time
	// lastRound is when a round carrying AT LEAST ONE price last landed. An
	// empty batch never moves it.
	lastRound time.Time

	// preferredStart is the CALLER-SCOPED routing preference (-1 = none); see
	// the package comment's endpoint bullet.
	preferredStart int
	// staleRotations counts consecutive rounds ATTRIBUTED TO AN ENDPOINT with no
	// intervening progress, feeding the "every endpoint is behind" DEGRADED log.
	// A regression whose cause could not be pinned on an endpoint does not count.
	staleRotations int
	// consecutiveAmbiguous is the bounded lease on preferredStart.
	consecutiveAmbiguous int
}

// NewPoller builds a Poller for the registry's poll obligations on
// cfg.ChainID. A chain with no obligations is a refusal, not an empty poller:
// the daemon decides which chains to build pollers for from the registry, so an
// empty one here means the two disagree.
func NewPoller(st PollStore, ch PollChain, feeds *config.Feeds, cfg PollerConfig) (*Poller, error) {
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
		startedAt: now(), lastPriced: map[string]time.Time{}, preferredStart: -1,
	}, nil
}

// Name returns the poller's pseudo-engine cursor key — self-describing for log
// attribution, for the daemon's health surface, and (since the fix wave) as the
// durable owner recorded on every row it writes.
func (p *Poller) Name() string { return p.engine }

// Sources returns the prices.source values this poller writes, for logs and for
// operator introspection. It is NOT the rewind scope any more: RewindPrices
// scopes by owner engine, precisely so a registry edit cannot orphan rows.
func (p *Poller) Sources() []string { return p.sources }

// Conditions reports the poller's named health conditions (empty = healthy),
// derived from DURABLE per-asset freshness rather than from process memory or
// from "a round committed".
//
// CLOCK NOTE, stated plainly: durable freshness carries the DATABASE's
// observed_at, and the grace comparison uses the daemon's clock. The two are
// assumed to agree to well within the grace window (three cadence intervals, 3
// minutes by default). A larger skew would shift verdicts in one direction or
// the other; that is an accepted cost of anchoring health to durable truth
// instead of to a process-local timestamp that a restart resets.
func (p *Poller) Conditions() []Condition {
	grace := time.Duration(pollHealthGrace) * p.cfg.Interval
	now := p.now()
	var out []Condition

	if !p.hydrated {
		// Fail CLOSED once the grace window has passed: an unhydrated poller
		// knows nothing about per-asset freshness, and "unknown" must not read
		// as "healthy". Inside the window this is just startup.
		if now.Sub(p.startedAt) > grace {
			out = append(out, Condition{
				Name: ConditionPollFreshnessUnhydrated,
				Reason: fmt.Sprintf("per-asset price freshness has not been read back from durable storage in %s (chain %d): no freshness verdict can be trusted",
					now.Sub(p.startedAt).Truncate(time.Second), p.cfg.ChainID),
			})
		}
		return out
	}

	ref := p.lastRound
	if ref.IsZero() {
		ref = p.startedAt
	}
	if since := now.Sub(ref); since > grace {
		out = append(out, Condition{
			Name: ConditionPollRound,
			Reason: fmt.Sprintf("no poll round carrying a price has landed for %s (cadence %s, grace %s) on chain %d",
				since.Truncate(time.Second), p.cfg.Interval, grace, p.cfg.ChainID),
		})
	}

	var stale []string
	for _, t := range p.targets {
		r, observed := p.lastPriced[t.key()]
		if !observed {
			r = p.startedAt
		}
		if since := now.Sub(r); since > grace {
			label := fmt.Sprintf("%s(%s)", t.Symbol, t.Asset.Hex())
			if !observed {
				label += " never priced"
			} else {
				label += fmt.Sprintf(" %s stale", since.Truncate(time.Second))
			}
			stale = append(stale, label)
		}
	}
	if len(stale) > 0 {
		sort.Strings(stale)
		out = append(out, Condition{
			Name: ConditionPollTargetFreshness,
			Reason: fmt.Sprintf("%d of %d registry assets have no price within the %s grace window on chain %d: %v",
				len(stale), len(p.targets), grace, p.cfg.ChainID, stale),
		})
	}
	return out
}

// Health is the single-string view of Conditions, kept for the worker shape the
// daemon and the derivation runners share.
func (p *Poller) Health() (healthy bool, reason string) {
	cs := p.Conditions()
	if len(cs) == 0 {
		return true, ""
	}
	return false, conditionsReason(cs)
}

// Step performs one bounded unit of poll work: hydrate freshness if it has not
// been, answer any durable reorg epoch, then — when the cadence says a round is
// due — one multicall of every obligation, landed with its (block, hash) anchor
// through one ApplyPolledPrices transaction.
//
// Returns advanced=false when no round is due, or when a round was refused
// without recording anything. advanced=true with a nil error means the round's
// rows, anchor and cursor committed.
func (p *Poller) Step(ctx context.Context) (bool, error) {
	if err := p.hydrate(ctx); err != nil {
		return false, err
	}

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

	block, blockHash, obs, servedBy, err := p.readRound(ctx)
	if err != nil {
		return false, err
	}

	anchor := store.PollAnchor{BlockNumber: block, BlockHash: blockHash}
	if err := p.store.ApplyPolledPrices(ctx, p.engine, p.cfg.ChainID, obs, block, anchor); err != nil {
		// EVERY apply-error path discards this round's in-memory effects and
		// re-hydrates freshness from durable truth. The poller only ever records
		// freshness AFTER a successful apply, so nothing was staged — but in the
		// commit-landed-with-lost-ack world the rows DID land, and re-reading is
		// the only way to know it. A failed re-hydration is logged and leaves
		// hydrated=false, which Conditions reports as an untrusted verdict rather
		// than as health.
		p.rehydrateAfterUncertainty(ctx, "apply error")

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
		if errors.Is(err, store.ErrPollAnchorDivergence) {
			// POSITIVE proof of a reorg at one of our own anchored heights: the
			// block we recorded there now hashes differently. Nothing to conclude
			// about the endpoint; the epoch gate will run once the walker records
			// the reorg.
			p.onReorgSuspected(block, "a poll anchor's recorded block hash no longer matches this round's", err)
			return false, nil
		}
		if errors.Is(err, store.ErrDeriveCursorRegression) {
			// CAUSE UNKNOWN until investigated — a frozen endpoint and an
			// unrecorded reorg produce the identical symptom.
			p.classifyRegression(ctx, block, servedBy, err)
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

	landed := p.now()
	for _, o := range obs {
		p.lastPriced[freshnessKey(o.Asset, o.Source)] = landed
	}
	if len(obs) > 0 {
		// ONLY a round that actually recorded a price counts as landed. An empty
		// batch legitimately advances the cursor and must not be mistaken for
		// price service.
		p.lastRound = landed
	}
	p.recordProgress()
	return true, nil
}

// hydrate reads per-asset freshness back from the durable rows this engine owns,
// once. Health verdicts depend on it, so a restarted process must not measure a
// long-dead oracle from its own start time.
func (p *Poller) hydrate(ctx context.Context) error {
	if p.hydrated {
		return nil
	}
	rows, err := p.store.LatestPriceFreshness(ctx, p.cfg.ChainID, p.engine)
	if err != nil {
		return fmt.Errorf("price poller %q: hydrate per-asset freshness: %w", p.engine, err)
	}
	p.applyFreshness(rows)
	return nil
}

// applyFreshness replaces the in-memory freshness cache with the durable rows,
// and re-derives the round-level anchor as the newest of them. Replacement (not
// merge) is deliberate: after a rewind the deleted rows must stop counting.
func (p *Poller) applyFreshness(rows []store.PriceFreshness) {
	fresh := make(map[string]time.Time, len(rows))
	var newest time.Time
	for _, r := range rows {
		k := freshnessKey(r.Asset, r.Source)
		if prev, ok := fresh[k]; ok && !r.ObservedAt.After(prev) {
			continue
		}
		fresh[k] = r.ObservedAt
		if r.ObservedAt.After(newest) {
			newest = r.ObservedAt
		}
	}
	p.lastPriced = fresh
	p.lastRound = newest
	p.hydrated = true
}

// rehydrateAfterUncertainty re-reads durable freshness after an outcome this
// process cannot be sure of. On failure it clears the hydrated flag so
// Conditions reports an untrusted verdict instead of a stale-but-green one — the
// whole point being that health never rests on in-memory state whose relationship
// to storage is unknown.
func (p *Poller) rehydrateAfterUncertainty(ctx context.Context, why string) {
	rows, err := p.store.LatestPriceFreshness(ctx, p.cfg.ChainID, p.engine)
	if err != nil {
		p.hydrated = false
		slog.Warn("could not re-hydrate per-asset price freshness after an uncertain outcome; health will report the verdict as untrusted until it succeeds",
			"engine", p.engine, "why", why, "err", err)
		return
	}
	p.applyFreshness(rows)
}

// readRound issues one multicall of every obligation and turns the results into
// deduped observations stamped with the multicall's EXECUTION block, returning
// that block's hash alongside so the round can be anchored. Individual reverts
// and undecodable returns are per-asset skips with a WARN; only transport
// failures and a malformed multicall envelope fail the round.
func (p *Poller) readRound(ctx context.Context) (uint64, []byte, []store.PriceObservation, chain.EndpointToken, error) {
	noServer := chain.EndpointToken{Index: -1}
	calls := make([]multicall3Call, len(p.targets))
	for i, t := range p.targets {
		data, err := t.view.pack(t.Asset)
		if err != nil {
			return 0, nil, nil, noServer, fmt.Errorf("price poller %q: pack %s for %s: %w", p.engine, t.Method, t.Symbol, err)
		}
		calls[i] = multicall3Call{Target: t.Contract, CallData: data}
	}
	// requireSuccess=false: one broken oracle must not fail the whole round.
	input, err := multicall3ABI.Pack("tryBlockAndAggregate", false, calls)
	if err != nil {
		return 0, nil, nil, noServer, fmt.Errorf("price poller %q: pack multicall: %w", p.engine, err)
	}

	var out []byte
	var servedBy chain.EndpointToken
	if p.preferredStart >= 0 {
		// A prior implicated endpoint pinned the caller-scoped preference: start
		// there, leaving the shared routing hint alone.
		out, servedBy, err = p.chain.CallFrom(ctx, p.preferredStart, Multicall3Address, input)
	} else {
		out, servedBy, err = p.chain.CallWithToken(ctx, Multicall3Address, input)
	}
	if err != nil {
		return 0, nil, nil, noServer, fmt.Errorf("price poller %q: multicall (%d oracles): %w", p.engine, len(p.targets), err)
	}
	block, blockHash, results, err := unpackMulticallResult(out, len(p.targets))
	if err != nil {
		return 0, nil, nil, servedBy, fmt.Errorf("price poller %q: %w", p.engine, err)
	}

	set := newPriceSet()
	reverted, undecodable := 0, 0
	for i, res := range results {
		t := p.targets[i]
		if !res.success {
			reverted++
			slog.Warn("oracle read reverted; skipping this asset for the round (its previous prices stand, and its per-asset freshness now ages)",
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
		// the cursor, keeping the epoch ack current) but it does NOT count as a
		// landed round, so per-asset freshness ages and health goes unhealthy
		// within the grace window.
		slog.Warn("price round DEGRADED: every oracle read failed — no prices recorded this round; the cursor advances for the epoch ack only and health will FAIL within the grace window",
			"engine", p.engine, "oracles", len(p.targets), "reverted", reverted,
			"undecodable", undecodable, "block", block)
	}
	return block, blockHash, set.observations(), servedBy, nil
}

// rewind acknowledges every reorg epoch on the poller's chain and repairs its
// rows, deleting AS LITTLE as it can prove is orphaned.
//
// The mechanism: RewindPrices is called with the poller's OWN cursor as the
// requested target (the store lowers it to the deepest unacknowledged
// rewound_to) and with a VERIFIED FLOOR — the highest stored poll anchor whose
// block hash still matches the live chain — which raises the effective target
// back up. A hash match at height H entails that H and every ancestor are
// unchanged, because blocks are chained by parent hash, so retaining rows at or
// below H rests on that entailment rather than on optimism. The epoch ack is
// unaffected: it still reaches the chain's max epoch, atomically with the
// deletion.
//
// This is NOT the "ack the epoch but keep the rows" strategy, which loses no rows
// but can leave prices attached to blocks the chain replaced. Rows are kept only
// where a hash re-check says the block is still there; every unverified row is
// deleted. TRUST BOUNDARY, stated: the re-check is only as good as the endpoint
// that answers it — a lying endpoint could assert a hash we would then treat as
// canonical. That is the same trust this indexer already places in RPC for every
// log it ingests, and probes are routed across endpoints rather than repeatedly
// asking one; it is not a cryptographic proof against a hostile provider.
//
// Why a floor is needed at all: the walker rewinds to ITS verified ancestor —
// the highest stored LOG whose hash still matches — which can sit far below the
// actual fork point when raw logs are sparse, and degenerately is the stream's
// StartBlock-1. The poller cannot re-poll history (it only ever reads `latest`),
// so lowering its cursor to that block deleted polled rows for heights that were
// almost certainly canonical, and in the full-rewalk case all of them.
//
// WHAT IS STILL LOST: rows above the verified anchor. And when NO anchor
// verifies — every probe mismatched or errored, or the poller has no anchors yet
// (immediately after a bootstrap rewind, or after retention aged them out) —
// there is no floor, the walker's target stands, and the old unbounded loss
// applies for that one rewind. Both outcomes are WARNed with their numbers. The
// alternative — acking the epoch while keeping the rows — would leave the store
// asserting engine-exact prices at heights the chain may have replaced, which for
// a liquidation-facing table is the worse failure.
//
// Bootstrap (no cursor yet on a chain that already carries epochs) targets
// block 0 with no floor: there is nothing of this poller's to delete, and the
// call exists purely to create the cursor and ack, which is what ApplyPrices
// demands before it will admit a new writer on such a chain.
func (p *Poller) rewind(ctx context.Context) error {
	cursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return fmt.Errorf("price poller %q: read cursor before rewind: %w", p.engine, err)
	}
	target := uint64(0)
	if found {
		target = cursor
	}

	floor, probes := uint64(0), 0
	if found {
		floor, probes = p.verifiedFloor(ctx, target)
	}

	if err := p.store.RewindPrices(ctx, p.engine, p.cfg.ChainID, target, floor); err != nil {
		return fmt.Errorf("price poller %q: rewind prices to %d (verified floor %d): %w", p.engine, target, floor, err)
	}
	newCursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return fmt.Errorf("price poller %q: read cursor after rewind: %w", p.engine, err)
	}
	if !found {
		return fmt.Errorf("price poller %q: cursor missing after RewindPrices — store contract violated", p.engine)
	}
	discarded := uint64(0)
	if target > newCursor {
		discarded = target - newCursor
	}
	if floor > 0 {
		slog.Warn("polled prices rewound after reorg epoch; retained everything at or below a HASH-VERIFIED poll anchor and discarded only the unverified suffix",
			"engine", p.engine, "requestedTarget", target, "verifiedFloor", floor,
			"cursor", newCursor, "blocksDiscarded", discarded, "anchorProbes", probes)
	} else {
		slog.Warn("polled prices rewound after reorg epoch with NO hash-verified poll anchor available; the walker's target stands and the discarded rows CANNOT be re-polled (this path only reads `latest`)",
			"engine", p.engine, "requestedTarget", target, "cursor", newCursor,
			"blocksDiscarded", discarded, "anchorProbes", probes)
	}

	// The rows this poller owned above the new cursor are gone, so the freshness
	// cache built from them is wrong: re-read it rather than carry timestamps
	// that describe deleted (or orphaned) observations.
	p.rehydrateAfterUncertainty(ctx, "rewind")

	// A rewind moves the queue forward even though no price landed: the cadence
	// slot is not consumed, so the next Step polls immediately and replaces the
	// deleted rows at the new head.
	return nil
}

// verifiedFloor walks this engine's poll anchors from the newest downward and
// returns the block of the first one whose hash still matches the live chain,
// together with how many probes it took. (0, n) means none verified within
// maxAnchorProbes.
//
// Each probe is routed through a DIFFERENT endpoint than the last (HeaderHashFrom
// with an advancing start index) so one frozen or forked endpoint cannot answer
// every question with the same wrong history. Anchors above toBlock are skipped:
// a floor above the requested target would bless rows outside the cursor's
// coverage, and RewindPrices refuses it outright.
func (p *Poller) verifiedFloor(ctx context.Context, toBlock uint64) (uint64, int) {
	anchors, err := p.store.PollAnchorsAbove(ctx, p.engine, p.cfg.ChainID, 0, maxAnchorProbes)
	if err != nil {
		slog.Warn("could not read poll anchors for reorg repair; falling back to the walker's rewind target (lossy)",
			"engine", p.engine, "err", err)
		return 0, 0
	}
	probes := 0
	for _, a := range anchors {
		if a.BlockNumber > toBlock {
			continue
		}
		live, servedBy, err := p.chain.HeaderHashFrom(ctx, p.probeStart(probes), a.BlockNumber)
		probes++
		if err != nil {
			slog.Warn("poll anchor hash probe failed; this anchor cannot be verified, trying the next older one",
				"engine", p.engine, "anchorBlock", a.BlockNumber, "err", err)
			continue
		}
		if bytes.Equal(live.Bytes(), a.BlockHash) {
			return a.BlockNumber, probes
		}
		slog.Warn("poll anchor is ORPHANED: the live chain reports a different hash at that height, so this round's rows describe a replaced block",
			"engine", p.engine, "anchorBlock", a.BlockNumber, "recorded", fmt.Sprintf("%x", a.BlockHash),
			"live", live.Hex(), "endpoint", servedBy.Index)
	}
	return 0, probes
}

// probeStart spreads verification probes across endpoints, starting one past the
// currently pinned preference when there is one (that endpoint is already under
// suspicion) and advancing per probe.
func (p *Poller) probeStart(n int) int {
	base := 0
	if p.preferredStart >= 0 {
		base = p.preferredStart
	}
	if c := p.chain.EndpointCount(); c > 0 {
		return (base + n) % c
	}
	return base + n
}

// classifyRegression decides WHY the store refused this round's through-block,
// and only then draws a conclusion. The two possible causes are
// indistinguishable from the error alone:
//
//   - a FROZEN RPC ENDPOINT: the eth_call succeeded and simply reported an older
//     execution block, so the node is behind. The remedy is to route around that
//     endpoint.
//   - a REORG the walker has not recorded yet: the poller's own cursor describes
//     blocks the chain has replaced, so a correct, caught-up endpoint legitimately
//     reports a lower height. The remedy is to wait for the epoch and rewind —
//     and rotating endpoints here actively misleads, because it accuses a healthy
//     node and can raise the all-endpoints-behind alarm across every round of the
//     walker's backoff window (up to its ten-minute capped delay).
//
// The check therefore runs in two stages: durable reorg state first (cheap, no
// RPC), then the live ancestry of the poller's OWN newest anchor. If that anchor
// is still canonical, no reorg has touched the heights we have recorded, and the
// endpoint conclusion is warranted. If it is orphaned, a reorg is pending. If it
// cannot be checked at all — no anchor, or the probe failed — the cause stays
// UNKNOWN and no endpoint-specific conclusion is drawn.
//
// DISCLOSED COST of the cause-unknown branch: in the narrow window where the
// poller has a cursor but no anchor (immediately after a bootstrap rewind, or
// once retention has aged its anchors out), a genuinely frozen endpoint is not
// routed around for that round. The next round retries on the shared hint and,
// once any round lands an anchor, classification becomes decidable again.
//
// RESIDUAL IMPRECISION of the endpoint branch, also disclosed: the frontier anchor
// can sit BELOW the cursor (a rewind may leave the cursor at the walker's target,
// above which every anchor was deleted). A reorg strictly between that anchor and
// the cursor is therefore invisible to this check, and such a round would still be
// attributed to the endpoint. It cannot orphan a polled row — rows exist only at
// anchored blocks — so the cost is bounded at one misattributed pin against a
// healthy endpoint, released by the next round's progress. That is strictly better
// than the pre-check behaviour, which attributed EVERY regression to the endpoint,
// but it is not exact and is not claimed to be.
func (p *Poller) classifyRegression(ctx context.Context, block uint64, servedBy chain.EndpointToken, cause error) {
	unacked, err := p.store.HasUnackedReorg(ctx, p.engine, p.cfg.ChainID)
	if err != nil {
		p.onCauseUnknown(block, servedBy, fmt.Sprintf("the durable reorg-state check itself failed (%v)", err), cause)
		return
	}
	if unacked {
		p.onReorgSuspected(block, "a durable reorg epoch is already recorded and unacknowledged", cause)
		return
	}

	anchors, err := p.store.PollAnchorsAbove(ctx, p.engine, p.cfg.ChainID, 0, 1)
	if err != nil {
		p.onCauseUnknown(block, servedBy, fmt.Sprintf("the poll-anchor read failed (%v)", err), cause)
		return
	}
	if len(anchors) == 0 {
		p.onCauseUnknown(block, servedBy, "this poller has no poll anchor to verify its own frontier against", cause)
		return
	}
	frontier := anchors[0]
	// Probe one PAST the endpoint that served the suspicious round: asking the
	// suspect whether its own view of history is canonical is worthless.
	start := 0
	if c := p.chain.EndpointCount(); c > 0 && servedBy.Index >= 0 {
		start = (servedBy.Index + 1) % c
	}
	live, probedOn, err := p.chain.HeaderHashFrom(ctx, start, frontier.BlockNumber)
	if err != nil {
		p.onCauseUnknown(block, servedBy,
			fmt.Sprintf("the ancestry probe of our own frontier anchor at %d failed (%v)", frontier.BlockNumber, err), cause)
		return
	}
	if !bytes.Equal(live.Bytes(), frontier.BlockHash) {
		p.onReorgSuspected(block,
			fmt.Sprintf("our own frontier anchor at %d is orphaned (recorded %x, live %s via endpoint %d), so the chain moved under our cursor",
				frontier.BlockNumber, frontier.BlockHash, live.Hex(), probedOn.Index), cause)
		return
	}
	// Our frontier is provably still canonical, so the regression is not ours:
	// the endpoint that served this round is behind.
	p.onStaleEndpoint(block, servedBy, frontier.BlockNumber, cause)
}

// onStaleEndpoint records a round whose regression has been ATTRIBUTED to the
// endpoint that served it — the poller's own frontier anchor was re-verified as
// canonical, so a lower reported execution block means that node is behind.
//
// Behaviour: pin the next multicall one past the endpoint that served it, restart
// the ambiguity lease (a stale batch is its own bounded preference machinery, not
// a lease consumption), and count the streak toward the all-endpoints-behind
// DEGRADED log. That threshold is TELEMETRY, not a correctness gate — the durable
// cursor refuses any through-block behind it, so a node frozen BELOW the cursor
// cannot record anything — and its
// bound is honest rather than exact: an intervening ambiguous apply error
// restarts the streak, so an alternating stale/error pattern defers the warning.
// Accepted, because that pattern already floods the log with apply errors; this
// warning exists for the QUIET mode where every endpoint is behind and nothing
// errors.
func (p *Poller) onStaleEndpoint(block uint64, servedBy chain.EndpointToken, verifiedAt uint64, cause error) {
	slog.Warn("price round DEGRADED: stale rpc endpoint — the multicall reported an execution block behind the recorded cursor while our own poll anchor is still canonical, so the endpoint is behind; nothing recorded, retrying next round",
		"engine", p.engine, "execBlock", block, "endpoint", servedBy.Index,
		"frontierVerifiedAt", verifiedAt, "err", cause)
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

// onReorgSuspected records a regression whose cause is a reorg, not an endpoint.
// It draws NO endpoint conclusion: the preference is left exactly as it was and
// the all-endpoints-behind streak is reset, because attributing a reorg to a
// healthy node is precisely the false diagnosis this classification exists to
// prevent. Repair is the epoch gate's job and needs no help here — the walker
// records the epoch (possibly only after its capped backoff delay) and the next
// Step's proactive check rewinds.
func (p *Poller) onReorgSuspected(block uint64, evidence string, cause error) {
	p.staleRotations = 0
	slog.Warn("price round refused and the cause is a REORG, not an endpoint: no endpoint is implicated and no rotation is performed; awaiting the walker's reorg epoch",
		"engine", p.engine, "execBlock", block, "evidence", evidence,
		"preferredStart", p.preferredStart, "err", cause)
}

// onCauseUnknown records a regression that could not be attributed either way.
// It suppresses BOTH the endpoint-specific rotation and the all-endpoints-behind
// conclusion: with a reorg still possible, either would be an assertion the
// poller cannot support. The round simply retries.
func (p *Poller) onCauseUnknown(block uint64, servedBy chain.EndpointToken, why string, cause error) {
	p.staleRotations = 0
	slog.Warn("price round refused with an UNDETERMINED cause: a frozen endpoint and an unrecorded reorg produce the same symptom and this round could not tell them apart, so no endpoint is implicated and no rotation is performed",
		"engine", p.engine, "execBlock", block, "endpoint", servedBy.Index,
		"why", why, "preferredStart", p.preferredStart, "err", cause)
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
