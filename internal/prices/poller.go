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
// # ONE INVARIANT GOVERNS EVERY HEALTH SIGNAL HERE
//
// HEALTH MAY BE REFRESHED ONLY BY A DURABLE, NEWLY-OBSERVED FACT. Not by process
// memory, not by "the apply returned nil", not by a value this process computed
// from its own clock. The invariant is STRUCTURAL, not a rule to remember:
//
//   - freshness moves forward in exactly one function, recordDurableInserts,
//     whose only input is the store.ApplyResult naming rows the database actually
//     created, timestamped by the database. An apply that inserted nothing yields
//     an empty result, so no code path exists by which it refreshes anything;
//   - a quarantined (non-positive) insert is a real new observation — it proves
//     the oracle was reached, which is why the cursor may advance on it — but it
//     is recorded as an INVALID answer and never touches usable-price freshness;
//   - "the chain we can see is moving" is answered by whether a NEW poll-anchor
//     ROW came into existence, which a replay cannot fabricate and a restart
//     cannot reset (it hydrates from the newest anchor's own database
//     timestamp);
//   - every one of those caches is hydrated from durable storage before any
//     verdict, and re-hydrated after every rewind and every apply whose outcome
//     is in doubt. A failed re-hydration reports the verdict as UNTRUSTED, never
//     as healthy.
//
// The version before this one refreshed freshness for every observation the round
// SUBMITTED, stamped with p.now(). An endpoint frozen exactly at the cursor
// returns the same block forever: the store accepts the replay as idempotent
// success, inserts nothing, touches no observed_at — and the poller called itself
// healthy every interval, forever. That is the defect the invariant above closes.
//
// # DESTRUCTIVE REPAIR FAILS CLOSED
//
// Polled history cannot be re-derived (this path only ever reads `latest`), so a
// rewind that cannot prove what is orphaned must not delete anything. See repair:
// verification is retried and PAGED across Steps, and when it cannot conclude,
// the poller refuses to ack the epoch or delete a row and reports
// ConditionPollRewindBlocked. A stalled poller is recoverable; erased canonical
// history is not.
//
// # FAILURE POSTURE, in the order the failures happen
//
//   - A durable reorg epoch is answered FIRST, before the cadence gate: an epoch
//     must be acknowledged whether or not a poll is due, or the next apply is
//     refused anyway — but only once repair can prove which rows survive.
//   - A transport failure or a malformed multicall response is a round-level
//     error: nothing is recorded, the durable cursor is untouched, the round
//     retries.
//   - An INDIVIDUAL oracle revert (success=false under requireSuccess=false) is
//     a per-asset skip with a WARN, never a round failure — one broken oracle
//     must not cost every other asset its price. A round where EVERY oracle
//     reverted is logged DEGRADED and still advances the cursor: the cursor is a
//     reorg-ack anchor, not a completeness claim, and letting it stall would
//     wedge the epoch gate on an oracle outage. It refreshes no health.
//   - A CURSOR REGRESSION (the store refusing a through-block behind the
//     recorded cursor) is CAUSE-UNKNOWN until it is investigated. It can mean a
//     frozen RPC endpoint — the one semantic failure that never surfaces as an
//     RPC error, since the eth_call succeeds and simply reports an older
//     execution block — or it can mean a reorg the walker has not recorded yet,
//     which is the poller's own cursor describing blocks the chain has replaced.
//     Those have opposite remedies, so classifyRegression checks durable reorg
//     state and then the live ancestry of the poller's own newest anchor before
//     drawing any endpoint-specific conclusion.
//   - DIAGNOSIS AND RECOVERY ARE SEPARATE. An undiagnosable regression records no
//     attribution — no endpoint is blamed, no all-endpoints-behind conclusion is
//     drawn — but it still routes the NEXT round to a different endpoint as
//     bounded EXPLORATION. Without that, a shared endpoint frozen below the
//     cursor stalled forever: every eth_call succeeded, so error-driven failover
//     never fired, every apply regressed, and no round could ever land the anchor
//     that would make classification decidable.
//   - Once an endpoint IS implicated, the poller pins a CALLER-SCOPED endpoint
//     preference, exactly the mechanism the collateral snapshotter established
//     (see internal/snapshot's package doc): start the next multicall one past
//     the endpoint that served the stale batch via CallFrom, leave the SHARED
//     routing hint alone (another caller's success on the frozen endpoint would
//     legitimately re-pin it and bounce us straight back), and release the
//     preference only on genuine progress. Retaining it across an AMBIGUOUS apply
//     error is bounded by an ambiguity lease: after maxConsecutiveAmbiguous
//     consecutive ambiguous errors against the same pinned preference, rotate it
//     one further so a recovered endpoint is eventually reprobed instead of
//     excluded forever.

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
// UNHEALTHY: an asset whose newest durable USABLE price is older than this many
// intervals is not being served, whatever the reason. Unlike a derive runner's
// terminal capability error this state is RECOVERABLE — a landed valid price for
// that asset clears it.
const pollHealthGrace = 3

// maxConsecutiveAmbiguous bounds the ambiguity LEASE on the caller-scoped
// endpoint preference: how many CONSECUTIVE non-stale ("ambiguous") ApplyPrices
// errors a pinned preference survives before it rotates one endpoint further.
// One ambiguity is likely OURS (an indeterminate commit says nothing about the
// endpoint); persistent recurrence is bounded evidence that retention has
// stopped paying off. Same constant and same reasoning as internal/snapshot's.
const maxConsecutiveAmbiguous = 3

// anchorProbePage is how many stored poll anchors ONE Step re-verifies against
// the live chain. Each probe is one eth_getBlockByNumber, so a page bounds a
// Step's RPC cost; verification is not abandoned when the page is spent, it
// RESUMES from the next page on the following Step (see verifyFloor). The earlier
// design gave up after a single page of eight and degraded to the destructive
// walker target, which is how a transient probe outage became permanent data
// loss.
const anchorProbePage = 8

// anchorAdoptionPerStep bounds the one-time legacy-anchor adoption pass: how many
// unanchored blocks one Step may adopt an anchor for. Each costs one
// eth_getBlockByNumber. See adoptLegacyAnchors.
const anchorAdoptionPerStep = 8

// blockAdvanceTTL bounds how long this poller may go without observing a NEW
// execution block before that is itself an unhealthy condition. "New" means a
// poll anchor ROW that did not exist before; a frozen endpoint replaying the same
// (block, hash) cannot produce one.
//
// It is an ABSOLUTE floor rather than a multiple of the cadence because two
// rounds may legitimately land on the same execution block when the cadence is
// shorter than the chain's block time — five minutes is far above any block time
// this indexer targets (2s on OP, 12s on Ethereum), so a healthy poller can never
// trip it. Where the configured cadence is slower than that, the effective bound
// widens to pollHealthGrace intervals instead (see Conditions).
const blockAdvanceTTL = 5 * time.Minute

// PollerConfig binds a Poller to one chain's registry poll obligations.
type PollerConfig struct {
	ChainID  uint64        // the chain the obligations live on
	Interval time.Duration // SOLVENT_PRICE_INTERVAL
}

// Poller reads the registry's poll oracles into prices rows under a
// pseudo-engine cursor. Its DURABLE state is the cursor, the rows and the poll
// anchors; every in-memory map below is a CACHE of durable rows, hydrated from
// them and re-hydrated whenever an apply's outcome is in doubt, so none of them
// can ever be the sole basis of a health verdict.
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
	//
	// RESIDUAL BOUND, stated because it is the one place process time still sets a
	// reference: a poller that comes up with NO usable durable observation and NO
	// anchor is measured from here, so it has one grace window (and one
	// blockAdvanceTTL) before those conditions fire. That is unavoidable — there is
	// no durable fact to measure from — and it is not a restart reset of a KNOWN
	// bad state: any durable row or anchor, however old, takes precedence and fails
	// immediately. The daemon's startup condition covers the same window from the
	// other side, since /readyz stays closed until a full round has completed.
	startedAt time.Time

	// hydrated records whether the durable caches below have been read back from
	// storage. Until they have, Conditions refuses to issue a freshness verdict
	// and (past the grace window) says so, rather than reporting green on
	// unknown state.
	hydrated bool
	// lastUsable is per-(asset, source) USABLE freshness: the database time at
	// which a VALID price for that key was last durably recorded, keyed by
	// pollTarget.key(). A quarantined answer never appears here.
	lastUsable map[string]time.Time
	// invalidNewest holds the quarantine reason for keys whose NEWEST durable row
	// is invalid. Reported as its own condition: the oracle is reachable and
	// answering, and what it answers cannot be used.
	invalidNewest map[string]string
	// lastRound is the database time of the newest durable VALID price under any
	// key. An empty batch, or a batch of only quarantined answers, never moves it.
	lastRound time.Time

	// anchorKnown/lastAnchorBlock/lastAnchorAt describe the newest poll anchor
	// ROW: its height and the database timestamp of its insertion. They advance
	// only when an apply reports AnchorInserted, and hydrate from
	// NewestPollAnchor, so neither a replay nor a restart can refresh them.
	anchorKnown     bool
	lastAnchorBlock uint64
	lastAnchorAt    time.Time

	// legacyAnchorsAdopted latches once the store reports no unanchored owned
	// blocks left, so the adoption query stops running for the process's life.
	legacyAnchorsAdopted bool

	// probeResumeFrom / probeResumeSet page reorg verification down across Steps:
	// the next page is read at or below probeResumeFrom. probeResumeSet also
	// distinguishes "we have not started probing" from "we paged to the bottom
	// and nothing matched".
	probeResumeFrom uint64
	probeResumeSet  bool
	// rewindBlocked is the reason repair last REFUSED to ack or delete, empty
	// when no refusal stands. Reported as ConditionPollRewindBlocked.
	rewindBlocked string

	// preferredStart is the CALLER-SCOPED routing preference set by ATTRIBUTION
	// (-1 = none); see the package comment's endpoint bullet.
	preferredStart int
	// exploreStart is the routing hint set by an UNDIAGNOSABLE regression (-1 =
	// none). It is not an accusation and is recorded as none; it exists so a
	// frozen shared endpoint cannot stall the poller forever. It takes precedence
	// over preferredStart in routing, because when the cause is unknown the pin's
	// evidence no longer explains what we are seeing; both are released together
	// on progress.
	exploreStart int
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
		startedAt: now(), lastUsable: map[string]time.Time{}, invalidNewest: map[string]string{},
		preferredStart: -1, exploreStart: -1,
	}, nil
}

// Name returns the poller's pseudo-engine cursor key — self-describing for log
// attribution, for the daemon's health surface, and as the durable owner
// recorded on every row it writes.
func (p *Poller) Name() string { return p.engine }

// Sources returns the prices.source values this poller writes, for logs and for
// operator introspection. It is NOT the rewind scope: RewindPrices scopes by
// owner engine, precisely so a registry edit cannot orphan rows.
func (p *Poller) Sources() []string { return p.sources }

// Conditions reports the poller's named health conditions (empty = healthy),
// every one of them derived from a DURABLE fact.
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

	// A blocked rewind is reported IMMEDIATELY and unconditionally: it means a
	// reorg epoch is pending, nothing can be applied until it is answered, and
	// repair has deliberately refused to answer it destructively. There is no
	// grace window in which that is acceptable.
	if p.rewindBlocked != "" {
		out = append(out, Condition{Name: ConditionPollRewindBlocked, Reason: p.rewindBlocked})
	}

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

	// BLOCK ADVANCE: has a NEW execution block been anchored recently? This is
	// the condition a same-height frozen RPC path trips, and it is measured from
	// the anchor row's own database timestamp.
	advanceTTL := blockAdvanceTTL
	if grace > advanceTTL {
		advanceTTL = grace
	}
	advanceRef, advanceKnown := p.lastAnchorAt, p.anchorKnown
	if !advanceKnown {
		advanceRef = p.startedAt
	}
	if since := now.Sub(advanceRef); since > advanceTTL {
		where := "this poller has never anchored a round"
		if advanceKnown {
			where = fmt.Sprintf("the newest anchored execution block is still %d", p.lastAnchorBlock)
		}
		out = append(out, Condition{
			Name: ConditionPollBlockAdvance,
			Reason: fmt.Sprintf("no NEW execution block has been anchored for %s (bound %s) on chain %d: %s — an rpc path frozen at the cursor answers every eth_call successfully, so this is the signal that catches it",
				since.Truncate(time.Second), advanceTTL, p.cfg.ChainID, where),
		})
	}

	ref := p.lastRound
	if ref.IsZero() {
		ref = p.startedAt
	}
	if since := now.Sub(ref); since > grace {
		out = append(out, Condition{
			Name: ConditionPollRound,
			Reason: fmt.Sprintf("no poll round has durably recorded a usable price for %s (cadence %s, grace %s) on chain %d",
				since.Truncate(time.Second), p.cfg.Interval, grace, p.cfg.ChainID),
		})
	}

	var stale, invalid []string
	for _, t := range p.targets {
		k := t.key()
		label := fmt.Sprintf("%s(%s)", t.Symbol, t.Asset.Hex())
		if reason, bad := p.invalidNewest[k]; bad {
			invalid = append(invalid, fmt.Sprintf("%s %s", label, reason))
		}
		r, observed := p.lastUsable[k]
		if !observed {
			r = p.startedAt
		}
		if since := now.Sub(r); since > grace {
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
			Reason: fmt.Sprintf("%d of %d registry assets have no USABLE price within the %s grace window on chain %d: %v",
				len(stale), len(p.targets), grace, p.cfg.ChainID, stale),
		})
	}
	if len(invalid) > 0 {
		sort.Strings(invalid)
		out = append(out, Condition{
			Name: ConditionPollInvalidAnswer,
			Reason: fmt.Sprintf("%d of %d registry assets have a QUARANTINED newest observation on chain %d (the oracle answered, and the answer is unusable): %v",
				len(invalid), len(p.targets), p.cfg.ChainID, invalid),
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

// Step performs one bounded unit of poll work: hydrate durable state if it has
// not been, answer any durable reorg epoch (refusing to do so destructively),
// then — when the cadence says a round is due — one multicall of every
// obligation, landed with its (block, hash) anchor through one
// ApplyPolledPrices transaction.
//
// Returns advanced=false when no round is due, when repair refused to proceed,
// or when a round was refused without recording anything. advanced=true with a
// nil error means the round's rows, anchor and cursor committed, or that an
// epoch was acknowledged.
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
		return p.repair(ctx)
	}
	// No epoch is pending, so any earlier refusal no longer describes reality and
	// verification paging starts fresh next time.
	p.clearRepairState()

	now := p.now()
	if !p.lastAttempt.IsZero() && now.Sub(p.lastAttempt) < p.cfg.Interval {
		return false, nil // not due
	}
	// The slot is consumed by the ATTEMPT: a failing round waits out the cadence
	// like a successful one instead of retrying every daemon tick.
	p.lastAttempt = now

	// The one safe window for legacy-anchor adoption is here: no reorg epoch is
	// pending, so the live chain's hash at a height we already own rows at is not
	// a replacement block's. See adoptLegacyAnchors.
	p.adoptLegacyAnchors(ctx)

	block, blockHash, obs, servedBy, err := p.readRound(ctx)
	if err != nil {
		return false, err
	}

	anchor := store.PollAnchor{BlockNumber: block, BlockHash: blockHash}
	res, err := p.store.ApplyPolledPrices(ctx, p.engine, p.cfg.ChainID, obs, block, anchor)
	if err != nil {
		// EVERY apply-error path discards this round's in-memory effects and
		// re-hydrates durable state. The poller only ever records freshness AFTER
		// a successful apply, so nothing was staged — but in the
		// commit-landed-with-lost-ack world the rows DID land, and re-reading is
		// the only way to know it. A failed re-hydration is logged and leaves
		// hydrated=false, which Conditions reports as an untrusted verdict rather
		// than as health.
		p.rehydrateAfterUncertainty(ctx, "apply error")

		if errors.Is(err, store.ErrUnackedReorgEpoch) {
			// Reactive backstop: a walker rewind recorded an epoch after this
			// Step's proactive check. Answer it now, before any further apply —
			// under the same fail-closed verification as the proactive path.
			slog.Warn("price apply refused on an unacknowledged reorg epoch; repairing prices",
				"engine", p.engine, "err", err)
			advanced, rerr := p.repair(ctx)
			if rerr != nil {
				return false, errors.Join(err, rerr)
			}
			return advanced, nil
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

	p.recordDurableInserts(res)
	p.logRoundOutcome(block, obs, res)
	p.recordProgress()
	return true, nil
}

// recordDurableInserts is THE ONLY function in this file that moves a health
// signal forward, and its only input is what the database says it created.
//
// Read the signature as the invariant: nothing here derives a timestamp, so
// there is no way to express "this round was fresh" without a row to point at.
// An empty res.Inserted leaves every cache exactly as it was, which is what
// makes an idempotent replay — the frozen-endpoint case — structurally unable to
// refresh health rather than merely discouraged from doing so.
func (p *Poller) recordDurableInserts(res store.ApplyResult) {
	for _, ins := range res.Inserted {
		k := freshnessKey(ins.Asset, ins.Source)
		if !ins.Valid {
			// A quarantined answer IS a new durable observation and is why the
			// cursor may advance, but it is not a usable price: it marks the key
			// as answering-with-garbage and touches neither lastUsable nor
			// lastRound, so usable-price freshness ages exactly as it would if
			// the oracle had returned nothing at all.
			p.invalidNewest[k] = ins.InvalidReason
			continue
		}
		// A valid insert is newer than anything recorded for this key (blocks
		// only increase within an engine's cursor), so it clears the quarantine
		// marker.
		delete(p.invalidNewest, k)
		if prev, ok := p.lastUsable[k]; !ok || ins.ObservedAt.After(prev) {
			p.lastUsable[k] = ins.ObservedAt
		}
		if ins.ObservedAt.After(p.lastRound) {
			p.lastRound = ins.ObservedAt
		}
	}
	if res.AnchorInserted {
		p.anchorKnown = true
		p.lastAnchorBlock, p.lastAnchorAt = res.AnchorBlock, res.AnchorObservedAt
	}
}

// logRoundOutcome reports what a committed round DURABLY changed, which is not
// the same as what it submitted. The same-height replay case is called out
// explicitly because it is otherwise invisible: the apply succeeded, the cursor
// is unmoved, and nothing new exists.
func (p *Poller) logRoundOutcome(block uint64, obs []store.PriceObservation, res store.ApplyResult) {
	if res.AnchorInserted || len(res.Inserted) > 0 {
		return
	}
	slog.Warn("price round committed but recorded NOTHING NEW: every row and the anchor were idempotent replays at an execution block this engine had already anchored, so no health signal is refreshed — this is what an rpc path frozen exactly at the cursor looks like",
		"engine", p.engine, "execBlock", block, "observationsSubmitted", len(obs),
		"anchoredBlock", p.lastAnchorBlock, "blockAdvanceBound", blockAdvanceTTL)
}

// hydrate reads durable state — per-asset validity/freshness and the newest poll
// anchor — back from storage, once. Health verdicts depend on it, so a restarted
// process must not measure a long-dead oracle, or a frozen chain view, from its
// own start time.
func (p *Poller) hydrate(ctx context.Context) error {
	if p.hydrated {
		return nil
	}
	if err := p.readDurableState(ctx); err != nil {
		return fmt.Errorf("price poller %q: hydrate durable price state: %w", p.engine, err)
	}
	return nil
}

// readDurableState performs the two durable reads every hydration needs and
// commits them together, so a partial read can never leave half-fresh state.
func (p *Poller) readDurableState(ctx context.Context) error {
	rows, err := p.store.LatestPriceFreshness(ctx, p.cfg.ChainID, p.engine)
	if err != nil {
		return fmt.Errorf("read per-asset freshness: %w", err)
	}
	anchor, found, err := p.store.NewestPollAnchor(ctx, p.engine, p.cfg.ChainID)
	if err != nil {
		return fmt.Errorf("read newest poll anchor: %w", err)
	}
	p.applyFreshness(rows)
	p.anchorKnown = found
	p.lastAnchorBlock, p.lastAnchorAt = 0, time.Time{}
	if found {
		p.lastAnchorBlock, p.lastAnchorAt = anchor.BlockNumber, anchor.ObservedAt
	}
	return nil
}

// applyFreshness replaces the in-memory caches with the durable rows, and
// re-derives the round-level anchor as the newest USABLE observation among them.
// Replacement (not merge) is deliberate: after a rewind the deleted rows must
// stop counting.
func (p *Poller) applyFreshness(rows []store.PriceFreshness) {
	usable := make(map[string]time.Time, len(rows))
	invalid := map[string]string{}
	var newest time.Time
	for _, r := range rows {
		k := freshnessKey(r.Asset, r.Source)
		if r.HasValid {
			if prev, ok := usable[k]; !ok || r.ValidObservedAt.After(prev) {
				usable[k] = r.ValidObservedAt
			}
			if r.ValidObservedAt.After(newest) {
				newest = r.ValidObservedAt
			}
		}
		if !r.Valid {
			invalid[k] = r.InvalidReason
		}
	}
	p.lastUsable = usable
	p.invalidNewest = invalid
	p.lastRound = newest
	p.hydrated = true
}

// rehydrateAfterUncertainty re-reads durable state after an outcome this process
// cannot be sure of. On failure it clears the hydrated flag so Conditions reports
// an untrusted verdict instead of a stale-but-green one — the whole point being
// that health never rests on in-memory state whose relationship to storage is
// unknown.
func (p *Poller) rehydrateAfterUncertainty(ctx context.Context, why string) {
	if err := p.readDurableState(ctx); err != nil {
		p.hydrated = false
		slog.Warn("could not re-hydrate durable price state after an uncertain outcome; health will report the verdict as untrusted until it succeeds",
			"engine", p.engine, "why", why, "err", err)
	}
}

// readRound issues one multicall of every obligation and turns the results into
// deduped observations stamped with the multicall's EXECUTION block, returning
// that block's hash alongside so the round can be anchored. Individual reverts
// and undecodable returns are per-asset skips with a WARN; only transport
// failures and a malformed multicall envelope fail the round.
//
// ROUTING PRECEDENCE: an active EXPLORATION hint wins over an attribution pin.
// When the last regression could not be explained, the pin's evidence no longer
// accounts for what we are seeing, and continuing to honour it is what let a
// frozen shared endpoint stall the poller indefinitely. Both are released
// together on genuine progress.
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
	switch {
	case p.exploreStart >= 0:
		out, servedBy, err = p.chain.CallFrom(ctx, p.exploreStart, Multicall3Address, input)
	case p.preferredStart >= 0:
		// A prior implicated endpoint pinned the caller-scoped preference: start
		// there, leaving the shared routing hint alone.
		out, servedBy, err = p.chain.CallFrom(ctx, p.preferredStart, Multicall3Address, input)
	default:
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
		// the cursor, keeping the epoch ack current) but it inserts no price, so
		// per-asset freshness ages and health goes unhealthy within the grace
		// window.
		slog.Warn("price round DEGRADED: every oracle read failed — no prices recorded this round; the cursor advances for the epoch ack only and health will FAIL within the grace window",
			"engine", p.engine, "oracles", len(p.targets), "reverted", reverted,
			"undecodable", undecodable, "block", block)
	}
	return block, blockHash, set.observations(), servedBy, nil
}

// ---------------------------------------------------------------------------
// Reorg repair: fail closed.
// ---------------------------------------------------------------------------

// floorOutcome is what verification concluded about this poller's own history.
type floorOutcome int

const (
	// floorNothingAtRisk: this engine owns no price rows at all, so a rewind
	// deletes nothing whatever target it uses. Proceeding is vacuous, not lossy.
	floorNothingAtRisk floorOutcome = iota
	// floorVerified: an anchor at or below the requested target re-verified
	// against the live chain, so it and every ancestor are unchanged.
	floorVerified
	// floorAllOrphaned: verification PAGED all the way through this engine's
	// retained anchors and every one of them mismatched. A reorg deeper than the
	// whole retained anchor set is not something this poller repairs on its own.
	floorAllOrphaned
	// floorNoAnchors: rows exist but no anchor covers them — legacy history, or
	// history whose anchors retention removed. Unverifiable either way.
	floorNoAnchors
	// floorUnprobed: verification did not conclude this Step — a probe failed, or
	// the page budget was spent with anchors still to check. It RESUMES next Step.
	floorUnprobed
)

// repair answers a pending reorg epoch, and refuses to do so destructively.
//
// The mechanism when it CAN proceed: RewindPrices is called with the poller's OWN
// cursor as the requested target (the store lowers it to the deepest
// unacknowledged rewound_to) and with a VERIFIED FLOOR — the highest stored poll
// anchor whose block hash still matches the live chain — which raises the
// effective target back up. A hash match at height H entails that H and every
// ancestor are unchanged, because blocks are chained by parent hash, so retaining
// rows at or below H rests on that entailment rather than on optimism. The epoch
// ack is unaffected: it still reaches the chain's max epoch, atomically with the
// deletion.
//
// TRUST BOUNDARY, stated: the re-check is only as good as the endpoint that
// answers it — a lying endpoint could assert a hash we would then treat as
// canonical. That is the same trust this indexer already places in RPC for every
// log it ingests, and probes are routed across endpoints rather than repeatedly
// asking one; it is not a cryptographic proof against a hostile provider.
//
// Why a floor is needed at all: the walker rewinds to ITS verified ancestor — the
// highest stored LOG whose hash still matches — which can sit far below the actual
// fork point when raw logs are sparse, and degenerately is the stream's
// StartBlock-1. The poller cannot re-poll history (it only ever reads `latest`),
// so lowering its cursor to that block deleted polled rows for heights that were
// almost certainly canonical, and in the full-rewalk case all of them.
//
// WHEN IT CANNOT PROCEED IT DOES NOTHING. No ack, no deletion, no cursor move. The
// four unverifiable outcomes — probes still in progress, probes failing, no anchor
// covering the rows, and every retained anchor orphaned — all refuse, set
// ConditionPollRewindBlocked, and retry on the next Step. The cost is a stalled
// poller whose /readyz is red and whose WARN says exactly what is unproven; the
// alternative, which this replaces, was deleting unrecoverable canonical history
// on a transient probe outage.
//
// Bootstrap (no cursor yet on a chain that already carries epochs) targets block 0
// with no floor: there is nothing of this poller's to delete, and the call exists
// purely to create the cursor and ack, which is what ApplyPrices demands before it
// will admit a new writer on such a chain.
func (p *Poller) repair(ctx context.Context) (bool, error) {
	cursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return false, fmt.Errorf("price poller %q: read cursor before rewind: %w", p.engine, err)
	}
	if !found {
		if err := p.rewindTo(ctx, 0, 0, 0, "bootstrap: no cursor, so this engine owns no scoped history yet"); err != nil {
			return false, err
		}
		return true, nil
	}

	floor, outcome, probes, err := p.verifyFloor(ctx, cursor)
	if err != nil {
		return false, fmt.Errorf("price poller %q: verify poll anchors before rewind: %w", p.engine, err)
	}
	switch outcome {
	case floorNothingAtRisk:
		if err := p.rewindTo(ctx, cursor, 0, probes,
			"this engine owns no price rows, so the rewind deletes nothing"); err != nil {
			return false, err
		}
		return true, nil
	case floorVerified:
		if err := p.rewindTo(ctx, cursor, floor, probes,
			fmt.Sprintf("retained everything at or below HASH-VERIFIED poll anchor %d", floor)); err != nil {
			return false, err
		}
		return true, nil
	}

	p.blockRepair(cursor, outcome, probes)
	return false, nil
}

// verifyFloor pages this engine's poll anchors downward from toBlock, verifying
// each against the live chain, and returns the first match as a rewind floor.
//
// Each Step spends at most anchorProbePage probes. A page that finds no match
// lowers the resume point and returns floorUnprobed, so the NEXT Step continues
// deeper instead of abandoning verification — the behaviour the old
// eight-and-give-up bound lacked. A page in which any probe ERRORED does not
// lower the resume point at all, so a transient outage re-probes the same anchors
// rather than skipping past them unverified.
//
// Each probe is routed through a DIFFERENT endpoint than the last (HeaderHashFrom
// with an advancing start index) so one frozen or forked endpoint cannot answer
// every question with the same wrong history. Anchors above toBlock are excluded
// by the query: a floor above the requested target would bless rows outside the
// cursor's coverage, and RewindPrices refuses it outright.
func (p *Poller) verifyFloor(ctx context.Context, toBlock uint64) (uint64, floorOutcome, int, error) {
	owned, err := p.store.CountOwnedPricesAbove(ctx, p.engine, p.cfg.ChainID, 0)
	if err != nil {
		return 0, floorUnprobed, 0, err
	}
	if owned == 0 {
		return 0, floorNothingAtRisk, 0, nil
	}

	from := toBlock
	if p.probeResumeSet && p.probeResumeFrom < from {
		from = p.probeResumeFrom
	}
	anchors, err := p.store.PollAnchorsBelow(ctx, p.engine, p.cfg.ChainID, from, anchorProbePage)
	if err != nil {
		return 0, floorUnprobed, 0, err
	}
	if len(anchors) == 0 {
		if p.probeResumeSet {
			// We paged from the cursor to below the oldest retained anchor and
			// nothing matched: every anchor this engine still holds is orphaned.
			return 0, floorAllOrphaned, 0, nil
		}
		return 0, floorNoAnchors, 0, nil
	}

	probes, probeFailed := 0, false
	deepestChecked := from
	for _, a := range anchors {
		live, servedBy, err := p.chain.HeaderHashFrom(ctx, p.probeStart(probes), a.BlockNumber)
		probes++
		if err != nil {
			probeFailed = true
			slog.Warn("poll anchor hash probe failed; this anchor cannot be verified and will be re-probed rather than skipped",
				"engine", p.engine, "anchorBlock", a.BlockNumber, "err", err)
			continue
		}
		if bytes.Equal(live.Bytes(), a.BlockHash) {
			return a.BlockNumber, floorVerified, probes, nil
		}
		slog.Warn("poll anchor is ORPHANED: the live chain reports a different hash at that height, so this round's rows describe a replaced block",
			"engine", p.engine, "anchorBlock", a.BlockNumber, "recorded", fmt.Sprintf("%x", a.BlockHash),
			"live", live.Hex(), "endpoint", servedBy.Index)
		deepestChecked = a.BlockNumber
	}
	if !probeFailed && deepestChecked > 0 {
		// Every anchor in this page was checked and orphaned: it is safe to
		// continue BELOW them next Step.
		p.probeResumeFrom, p.probeResumeSet = deepestChecked-1, true
	}
	return 0, floorUnprobed, probes, nil
}

// blockRepair records a refusal to repair destructively, with the evidence that
// is missing. It is deliberately not an error: erroring every Step would consume
// the daemon's retry backoff on a state that only an operator or a recovered
// endpoint can change, and the condition surface is where this belongs.
func (p *Poller) blockRepair(cursor uint64, outcome floorOutcome, probes int) {
	var why, detail string
	switch outcome {
	case floorAllOrphaned:
		why = "every retained poll anchor is orphaned"
		detail = "the reorg is deeper than this engine's entire retained anchor history, so no surviving row can be proven canonical; this needs an operator decision, not an automatic delete"
	case floorNoAnchors:
		why = "this engine owns price rows that no poll anchor covers"
		detail = "legacy or retention-aged history cannot be verified; the poller adopts anchors for such rows on its next round with no epoch pending, and refuses to delete them meanwhile"
	default:
		why = "poll-anchor verification has not concluded"
		detail = "probes are still paging down through the retained anchors, or a probe failed and will be retried; nothing is deleted until a hash match or a definite negative"
	}
	reason := fmt.Sprintf("a reorg epoch on chain %d is pending and repair REFUSED to ack or delete: %s (cursor %d, probes this round %d). %s. Polled prices cannot be re-derived, so no price is applied until this resolves",
		p.cfg.ChainID, why, cursor, probes, detail)
	if p.rewindBlocked != reason {
		slog.Warn("price reorg repair BLOCKED and nothing was deleted: polled history cannot be re-polled, so an unverifiable rewind is refused rather than performed",
			"engine", p.engine, "chain", p.cfg.ChainID, "cursor", cursor,
			"why", why, "probesThisRound", probes, "resumeFrom", p.probeResumeFrom)
	}
	p.rewindBlocked = reason
}

// rewindTo performs the destructive repair once verification has justified it,
// and re-hydrates every durable cache from the post-rewind state.
func (p *Poller) rewindTo(ctx context.Context, target, floor uint64, probes int, justification string) error {
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
	slog.Warn("polled prices rewound after reorg epoch; the deletion was justified before it ran",
		"engine", p.engine, "requestedTarget", target, "verifiedFloor", floor,
		"cursor", newCursor, "blocksDiscarded", discarded, "anchorProbes", probes,
		"justification", justification)

	p.clearRepairState()
	// The rows this poller owned above the new cursor are gone, so the caches
	// built from them are wrong: re-read them rather than carry timestamps that
	// describe deleted (or orphaned) observations.
	p.rehydrateAfterUncertainty(ctx, "rewind")

	// A rewind moves the queue forward even though no price landed: the cadence
	// slot is not consumed, so the next Step polls immediately and replaces the
	// deleted rows at the new head.
	return nil
}

// clearRepairState drops the verification paging cursor and any standing refusal.
// Called both when a repair completes and when no epoch is pending at all — in
// either case the previous refusal no longer describes reality.
func (p *Poller) clearRepairState() {
	p.probeResumeFrom, p.probeResumeSet = 0, false
	p.rewindBlocked = ""
}

// adoptLegacyAnchors gives unanchored owned rows the anchor their round never
// wrote, so reorg repair can verify them instead of refusing to touch them.
//
// It runs ONLY from the no-pending-epoch path in Step. That placement is the
// safety argument: adopting a hash while a reorg is unacknowledged could take the
// hash of a REPLACEMENT block at that height and then "verify" against it,
// retaining rows that describe the block the chain discarded — the exact failure
// anchors exist to prevent. store.AdoptPollAnchor re-checks the same gate, so the
// property does not depend on this call site staying where it is.
//
// It is bounded (anchorAdoptionPerStep blocks per Step) and latches off once the
// store reports nothing left to adopt. Failures are logged and dropped: adoption
// is an improvement to repair's future prospects, never a precondition for a
// round, and repair's own refusal is what keeps the unadopted case safe.
//
// WHAT ADOPTION DOES NOT ESTABLISH: it does not prove the adopted block is the one
// the rows were read at — that fact was never recorded and cannot be recovered. It
// records the anchor the round should have written, from the chain as it stands
// with no reorg pending.
func (p *Poller) adoptLegacyAnchors(ctx context.Context) {
	if p.legacyAnchorsAdopted {
		return
	}
	blocks, err := p.store.UnanchoredPriceBlocks(ctx, p.engine, p.cfg.ChainID, anchorAdoptionPerStep)
	if err != nil {
		slog.Warn("could not read unanchored price blocks; legacy anchor adoption is deferred to a later round",
			"engine", p.engine, "err", err)
		return
	}
	if len(blocks) == 0 {
		p.legacyAnchorsAdopted = true
		return
	}
	for i, b := range blocks {
		live, servedBy, err := p.chain.HeaderHashFrom(ctx, p.probeStart(i), b)
		if err != nil {
			slog.Warn("could not read the live hash for an unanchored price block; it stays unanchored and reorg repair will keep REFUSING to delete it",
				"engine", p.engine, "block", b, "err", err)
			continue
		}
		if _, err := p.store.AdoptPollAnchor(ctx, p.engine, p.cfg.ChainID,
			store.PollAnchor{BlockNumber: b, BlockHash: live.Bytes()}); err != nil {
			slog.Warn("anchor adoption refused for an unanchored price block; it stays unanchored",
				"engine", p.engine, "block", b, "endpoint", servedBy.Index, "err", err)
		}
	}
}

// probeStart spreads verification probes across endpoints, starting one past the
// endpoint currently under suspicion (an exploration hint or an attribution pin,
// in that order) and advancing per probe.
func (p *Poller) probeStart(n int) int {
	base := 0
	switch {
	case p.exploreStart >= 0:
		base = p.exploreStart
	case p.preferredStart >= 0:
		base = p.preferredStart
	}
	if c := p.chain.EndpointCount(); c > 0 {
		return (base + n) % c
	}
	return base + n
}

// ---------------------------------------------------------------------------
// Cursor-regression classification.
// ---------------------------------------------------------------------------

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
// ATTRIBUTION REQUIRES ANCESTRY THAT REACHES THE CURSOR. Three things must hold
// before an endpoint is blamed: durable reorg state is clean, this poller's newest
// anchor is at or above its own cursor, and that anchor re-verifies as canonical.
// The middle condition is not decoration. When the frontier anchor sits BELOW the
// cursor — which is the normal state after a rewind left the cursor at the
// walker's target and deleted the anchors above it — a reorg strictly between the
// anchor and the cursor is invisible to the probe, so a match proves nothing about
// the heights the regression is actually about. An earlier version attributed
// those rounds to the endpoint anyway and documented the cost as "one misattributed
// pin released by the next round's progress". Progress is not guaranteed: with the
// canonical head below the cursor, every healthy endpoint regresses, the same lower
// anchor keeps verifying, and every round re-accuses another node — cycling all of
// them and emitting a false all-endpoints-behind diagnosis for as long as it lasts.
// That case is now CAUSE-UNKNOWN, which claims nothing and still makes progress
// through exploration.
//
// DISCLOSED COST of the cause-unknown branch: no endpoint is recorded as
// implicated, so an operator reading the health surface does not learn which node
// is behind from these rounds. Recovery does not depend on that knowledge —
// exploration routes the next round elsewhere regardless — but the diagnosis is
// genuinely absent rather than merely delayed, and that is the price of not
// asserting one we cannot support.
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

	cursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		p.onCauseUnknown(block, servedBy, fmt.Sprintf("the cursor read failed (%v)", err), cause)
		return
	}
	if !found {
		p.onCauseUnknown(block, servedBy, "this poller has no cursor, so there is no height for an anchor to have to reach", cause)
		return
	}

	frontier, found, err := p.store.NewestPollAnchor(ctx, p.engine, p.cfg.ChainID)
	if err != nil {
		p.onCauseUnknown(block, servedBy, fmt.Sprintf("the poll-anchor read failed (%v)", err), cause)
		return
	}
	if !found {
		p.onCauseUnknown(block, servedBy, "this poller has no poll anchor to verify its own frontier against", cause)
		return
	}
	if frontier.BlockNumber < cursor {
		p.onCauseUnknown(block, servedBy,
			fmt.Sprintf("our newest poll anchor is at %d but the cursor is at %d, so no verifiable ancestry covers the gap the regression is about", frontier.BlockNumber, cursor), cause)
		return
	}
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
	// Our anchor reaches the cursor AND is provably still canonical, so the
	// regression is not ours: the endpoint that served this round is behind.
	p.onStaleEndpoint(block, servedBy, frontier.BlockNumber, cause)
}

// onStaleEndpoint records a round whose regression has been ATTRIBUTED to the
// endpoint that served it — the poller's own frontier anchor reaches its cursor
// and re-verified as canonical, so a lower reported execution block means that
// node is behind.
//
// Behaviour: pin the next multicall one past the endpoint that served it, drop any
// exploration hint (we now have a diagnosis, so guessing stops), restart the
// ambiguity lease (a stale batch is its own bounded preference machinery, not a
// lease consumption), and count the streak toward the all-endpoints-behind
// DEGRADED log. That threshold is TELEMETRY, not a correctness gate — the durable
// cursor refuses any through-block behind it, so a node frozen BELOW the cursor
// cannot record anything — and its bound is honest rather than exact: an
// intervening ambiguous apply error restarts the streak, so an alternating
// stale/error pattern defers the warning. Accepted, because that pattern already
// floods the log with apply errors; this warning exists for the QUIET mode where
// every endpoint is behind and nothing errors.
func (p *Poller) onStaleEndpoint(block uint64, servedBy chain.EndpointToken, verifiedAt uint64, cause error) {
	slog.Warn("price round DEGRADED: stale rpc endpoint — the multicall reported an execution block behind the recorded cursor while our own poll anchor reaches the cursor and is still canonical, so the endpoint is behind; nothing recorded, retrying next round",
		"engine", p.engine, "execBlock", block, "endpoint", servedBy.Index,
		"frontierVerifiedAt", verifiedAt, "err", cause)
	if n := p.chain.EndpointCount(); n > 0 && servedBy.Index >= 0 {
		p.preferredStart = (servedBy.Index + 1) % n
		slog.Warn("preferring next rpc endpoint after stale price round",
			"engine", p.engine, "staleEndpoint", servedBy.Index, "preferredStart", p.preferredStart)
	}
	p.exploreStart = -1
	p.consecutiveAmbiguous = 0
	p.staleRotations++
	if n := p.chain.EndpointCount(); n > 0 && p.staleRotations >= n {
		slog.Warn("price ingestion DEGRADED: all endpoints behind — cycled through every rpc endpoint without landing a round",
			"engine", p.engine, "endpoints", n, "staleRotations", p.staleRotations)
	}
}

// onReorgSuspected records a regression whose cause is a reorg, not an endpoint.
// It draws NO endpoint conclusion: the preference is left exactly as it was, any
// exploration hint is dropped (reorg evidence has appeared, so there is nothing
// left to explore for), and the all-endpoints-behind streak is reset, because
// attributing a reorg to a healthy node is precisely the false diagnosis this
// classification exists to prevent. Repair is the epoch gate's job and needs no
// help here — the walker records the epoch (possibly only after its capped backoff
// delay) and the next Step's proactive check repairs.
func (p *Poller) onReorgSuspected(block uint64, evidence string, cause error) {
	p.staleRotations = 0
	p.exploreStart = -1
	slog.Warn("price round refused and the cause is a REORG, not an endpoint: no endpoint is implicated and no rotation is performed; awaiting the walker's reorg epoch",
		"engine", p.engine, "execBlock", block, "evidence", evidence,
		"preferredStart", p.preferredStart, "err", cause)
}

// onCauseUnknown records a regression that could not be attributed either way.
//
// DIAGNOSIS AND RECOVERY ARE SEPARATE HERE, and that separation is the fix for a
// real indefinite stall. It suppresses every CONCLUSION — no endpoint is
// implicated, no rotation is recorded as attribution, and the all-endpoints-behind
// streak is reset — because with a reorg still possible any of those would be an
// assertion the poller cannot support. But it still moves the NEXT round to a
// different endpoint as bounded EXPLORATION. Without that, a shared endpoint
// frozen below the cursor was terminal: every eth_call succeeded so error-driven
// failover never fired, every apply regressed, and no round could ever land the
// anchor that would make classification decidable. Exploration costs no extra RPC
// — it re-routes the round the poller was going to make anyway — and is released
// on progress or on reorg evidence.
//
// With a SINGLE configured endpoint there is nothing to explore, so this branch
// can only wait. Stated rather than implied.
func (p *Poller) onCauseUnknown(block uint64, servedBy chain.EndpointToken, why string, cause error) {
	p.staleRotations = 0
	p.advanceExploration(servedBy)
	slog.Warn("price round refused with an UNDETERMINED cause: a frozen endpoint and an unrecorded reorg produce the same symptom and this round could not tell them apart, so NO endpoint is implicated; the next round is routed elsewhere as bounded exploration so a frozen shared endpoint cannot stall this poller indefinitely",
		"engine", p.engine, "execBlock", block, "endpoint", servedBy.Index,
		"why", why, "preferredStart", p.preferredStart, "exploreStart", p.exploreStart,
		"endpoints", p.chain.EndpointCount(), "err", cause)
}

// advanceExploration moves the exploration hint one endpoint past whatever served
// the undiagnosable round. It records no attribution: exploreStart is a routing
// guess, and Conditions never reports it as a diagnosis.
func (p *Poller) advanceExploration(servedBy chain.EndpointToken) {
	n := p.chain.EndpointCount()
	if n <= 1 {
		p.exploreStart = -1 // nothing to explore towards
		return
	}
	base := p.exploreStart
	if servedBy.Index >= 0 {
		base = servedBy.Index
	} else if base < 0 {
		base = 0
	}
	p.exploreStart = ((base+1)%n + n) % n
}

// onAmbiguousApply consumes one unit of the ambiguity lease on the pinned
// endpoint preference and rotates it once the lease is spent, so a recovered
// earlier endpoint is eventually reprobed instead of excluded forever. It also
// restarts the stale-round telemetry (see onStaleEndpoint) but deliberately does
// NOT release the preference, and leaves any exploration hint alone: an
// indeterminate commit is evidence about neither.
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
// (a round that committed): the attribution pin and the exploration hint both go
// back to the shared routing hint, and both the ambiguity lease and the
// stale-round streak restart so a later isolated stale round cannot inherit an
// earlier cycle's count.
func (p *Poller) recordProgress() {
	p.preferredStart = -1
	p.exploreStart = -1
	p.staleRotations = 0
	p.consecutiveAmbiguous = 0
}
