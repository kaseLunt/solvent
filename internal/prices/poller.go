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
// # DESTRUCTIVE REPAIR FAILS CLOSED — AND STILL TERMINATES
//
// Polled history cannot be re-derived (this path only ever reads `latest`), so a
// rewind that cannot prove what is orphaned must not delete anything. The
// governing invariant is NEVER DELETE OR BLESS A ROW WITHOUT POSITIVE PROOF OF
// NON-CANONICALITY FOR EVERYTHING ABOVE THE FLOOR, and floorOutcome enumerates
// every state that invariant has to answer for. Three rules that a "fail closed"
// slogan does not by itself imply, and whose absence each cost a review round:
//
//   - A MATCH IS NOT PROOF ABOUT WHAT IS ABOVE IT. Anchors are probed
//     newest-first; a lower anchor that matches may only become a floor once every
//     anchor above it has been successfully probed AND mismatched, and once no row
//     above the deletion boundary sits at an unanchored height. A failed probe
//     followed by a lower match refuses and retries.
//   - A PROOF EXPIRES WHEN THE CHAIN IT DESCRIBES IS REPLACED. Verification is
//     paged across Steps, so its mismatch proofs are CACHED, and "this anchor is
//     orphaned" is a statement about one chain state rather than a permanent fact:
//     a second reorg can make exactly those skipped anchors canonical again. Paging
//     state is therefore stamped with the chain's reorg GENERATION and with a
//     LIVE-CHAIN CHECKPOINT (the highest anchor the pass probed, and the hash the
//     chain gave there); either one changing discards the pass and restarts from the
//     newest anchor, and the checkpoint is re-read IMMEDIATELY BEFORE any deletion.
//     Enumerating states was not enough — the missing dimension was time.
//   - FAIL-CLOSED MUST NOT MEAN FAIL-FOREVER. A refusal no code path can clear is
//     an outage. Where the evidence is merely UNAVAILABLE (a probe errored, a page
//     is still to come, a checkpoint could not be re-read) repair waits and reports
//     ConditionPollRewindBlocked. Where it is UNOBTAINABLE — rows at heights whose
//     block hash was never recorded — waiting is permanent: repair needs an anchor,
//     adoption is refused while an epoch is pending, and the ack only advances
//     through repair. Those rows are NEUTRALIZED instead: retained, marked unusable,
//     the epoch acked, ingestion resumed. Nothing is destroyed and nothing
//     unprovable is trusted.
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

	"github.com/ethereum/go-ethereum/common"

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
// design gave up after a single page of eight and degraded to the walker target,
// which is how a transient probe outage became permanent data loss.
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

	// neutralizedStats / neutralizedKnown are the retained-but-unusable backlog
	// (D-010 clause 4): how many rows this engine has marked rather than deleted,
	// and how old they are. Read from durable storage, never accumulated in memory,
	// and never used to decide anything — see refreshNeutralizedBacklog for why it
	// is not a health condition.
	neutralizedStats store.NeutralizedPriceStats
	neutralizedKnown bool

	// probeResumeFrom / probeResumeSet page reorg verification down across Steps:
	// the next page is read at or below probeResumeFrom. probeResumeSet also
	// distinguishes "we have not started probing" from "we paged to the bottom
	// and nothing matched".
	//
	// THEY CARRY A CACHED PROOF, WHICH MEANS THEY CARRY AN EXPIRY. Lowering the
	// resume point asserts "every anchor above this height was probed and
	// MISMATCHED" — a statement about the chain as it stood when those probes ran,
	// not a timeless fact. The four fields below bind that assertion to the chain
	// state it was computed against; see verifyFloor's TIME section.
	probeResumeFrom uint64
	probeResumeSet  bool
	// probeGeneration is the chain's reorg generation
	// (store.PriceRepairExposure.ReorgGeneration) the accumulated proofs were
	// computed under. A different generation means the walker recorded ANOTHER
	// reorg since, so those proofs describe a chain that has been replaced again.
	probeGeneration int64
	// probeCheckpoint* is the LIVE-CHAIN half of the same binding: the highest
	// anchor height this verification pass successfully probed and the hash the
	// pinned endpoint reported there at that moment. Because a block hash commits to
	// its whole ancestry, that one height re-read unchanged entails that every proof
	// at or below it still holds — and re-read CHANGED it entails that at least one
	// of them may not. It is revalidated immediately before every marking or
	// blessing act (see repair).
	probeCheckpointSet   bool
	probeCheckpointBlock uint64
	probeCheckpointHash  []byte
	// probeEndpoint / probeEndpointSet are the VIEW half of the binding, and the
	// third dimension A1 turned out to have. A hash proof is a statement about ONE
	// node's chain; assembling a pass from several nodes' answers and then
	// revalidating a checkpoint that commits to one of them proves nothing about the
	// rest. The whole pass — every page, across every Step, plus the checkpoint
	// re-read — is answered by this one endpoint, and probeAnchor rejects any answer
	// the failover client served from another. See pinProbeEndpoint.
	probeEndpoint    int
	probeEndpointSet bool
	// rewindBlocked is the reason repair last REFUSED to ack or mark, empty when
	// no refusal stands. Reported as ConditionPollRewindBlocked. (The name predates
	// D-010's removal of the rewind arm; the condition string it feeds is part of
	// the operator-facing surface and is left alone deliberately.)
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
	// repair has deliberately refused to answer it on incomplete evidence. There is
	// no grace window in which that is acceptable.
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
// not been, answer any durable reorg epoch (never destructively, and not at all
// on incomplete evidence),
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
	// The retained-but-unusable backlog is read here so a restart reports the
	// accumulated pile rather than starting from zero, and it is read LAST and
	// non-fatally: it informs an operator and decides nothing, so a failure must
	// not take the freshness verdict down with it.
	p.refreshNeutralizedBacklog(ctx, "hydration")
	return nil
}

// applyFreshness replaces the in-memory caches with the durable rows, and
// re-derives the round-level anchor as the newest USABLE observation among them.
// Replacement (not merge) is deliberate: after a repair the marked rows must
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
// Reorg repair: retain everything, mark what cannot be placed.
// ---------------------------------------------------------------------------

// floorOutcome is what verification concluded about this poller's own history.
//
// THE STATE SPACE IS ENUMERATED HERE ON PURPOSE. A1 survived three fix attempts
// because each one handled the cases its author had in mind and returned a
// permissive answer for the rest. These five values partition every possible
// state, and since D-010 none of them may delete:
//
//	                                            may mark?  may ack?
//	floorNothingAtRisk  nothing above target       n/a        yes
//	floorVerified       placed on one endpoint     yes*       yes
//	floorProvenOrphaned placed on one endpoint     yes        yes
//	floorUnverifiable   unplaceable, permanently   yes        yes
//	floorUnprobed       not concluded yet          NO         NO  (retry)
//
//	* only the suffix ABOVE the verified floor; everything at or below it keeps
//	  its validity, which is the whole value of finding a floor.
//
// The invariant they serve is now a marking rule: NEVER MARK OR BLESS A ROW
// WITHOUT A COMPLETE, COHERENT ANSWER FROM ONE ENDPOINT FOR EVERYTHING ABOVE THE
// FLOOR. "Answer" is only ever an anchor whose recorded hash no longer matches
// that endpoint's chain, or a verified anchor at or above the row (which entails
// its whole ancestry on that chain).
//
// TWO THINGS THE ENUMERATION DOES NOT SETTLE BY ITSELF, one per review round:
//
//   - TIME. Partitioning the states says nothing about a state's truth CHANGING
//     between the Step that established it and the Step that acts on it.
//     Verification is paged, so its answers are cached, and a later reorg can make
//     a mismatched anchor canonical again. Every outcome above is therefore bound
//     to a reorg generation and a live-chain checkpoint, revalidated immediately
//     before the act (Poller.checkpointStillHolds).
//   - VIEW. Nor does it say WHOSE chain the answers describe. Every answer in a
//     pass comes from one pinned endpoint, and one that arrives from another is
//     rejected (Poller.pinProbeEndpoint, Poller.probeAnchor).
type floorOutcome int

const (
	// floorNothingAtRisk: this engine owns nothing above the effective repair
	// target, so the call marks nothing whatever floor it uses. Answering the epoch
	// here is vacuous, not lossy.
	floorNothingAtRisk floorOutcome = iota
	// floorVerified: an anchor at or below the requested target re-verified against
	// the pinned endpoint's chain (so it and every ancestor are unchanged there),
	// AND every anchor above it was probed on that same endpoint and mismatched,
	// AND no row above the boundary sits at an unanchored height, AND the
	// checkpoint those mismatches were established against still holds at the
	// moment of acting. All four are required. A match alone was A1's third life;
	// a mismatch overturned by a second reorg was its fourth; a mismatch borrowed
	// from another endpoint's fork was its fifth.
	floorVerified
	// floorProvenOrphaned: verification paged through every retained anchor on one
	// endpoint, all of them mismatched, and every row above the effective target
	// sits at one of those anchored heights. Each such row describes a block that
	// endpoint's chain does not carry, so the whole suffix is marked with no floor
	// — provided the checkpoint still holds when it runs. This outcome ALWAYS rests
	// on cached, cross-Step answers (a single page cannot reach the bottom and
	// conclude), so it is the outcome the temporal binding matters most for.
	floorProvenOrphaned
	// floorUnverifiable: rows above the boundary sit at heights NO surviving anchor
	// covers — legacy history, or history whose anchors retention removed. No
	// future fact can settle them (the hash of the block their round ran at was
	// never recorded), so retaining them as USABLE is not defensible either: they
	// are marked. See Poller.neutralize.
	floorUnverifiable
	// floorUnprobed: verification did not conclude this Step — a probe FAILED and
	// ended the pass, or the page budget was spent with anchors still to check. The
	// answer may still arrive, so nothing is marked and nothing is acked; a new
	// pass runs next Step.
	floorUnprobed
)

// repair answers a pending reorg epoch WITHOUT deleting a row, and refuses to
// answer it at all on incomplete evidence.
//
// THE MECHANISM. NeutralizeUnverifiablePrices is called with the poller's OWN
// cursor as the requested target (the store lowers it to the deepest
// unacknowledged rewound_to) and with a VERIFIED FLOOR — the highest stored poll
// anchor whose block hash still matches the chain the pass's endpoint reports —
// which raises the effective boundary back up. A hash match at height H entails
// that H and every ancestor are unchanged on that endpoint's chain, because blocks
// are chained by parent hash, so keeping rows at or below H READABLE rests on that
// entailment rather than on optimism. Rows above the boundary are retained and
// marked. The epoch ack is unaffected: it still reaches the chain's max epoch,
// atomically with the marking.
//
// TRUST BOUNDARY, stated plainly and narrowly. The re-check is only as good as the
// endpoint that answers it: a lying or forked endpoint could assert hashes that
// make canonical rounds look replaced. Wave 5 spread probes across endpoints to
// dilute that, and it cost coherence — a pass then mixed several nodes' forks while
// the checkpoint vouched for only one, which is finding A1's fifth round. A pass is
// now pinned to ONE endpoint, so what the code enforces is that a conclusion is
// self-consistent, NOT that the endpoint is honest or canonical. The reason that is
// an acceptable place to stop is the consequence: an unlucky pin marks rows
// unusable, an operator sees the invalid-answer condition, and a canonical
// observation at the same height supersedes the marker. It is not a cryptographic
// proof against a hostile provider and does not claim to be.
//
// WHY A FLOOR IS NEEDED AT ALL: the walker rewinds to ITS verified ancestor — the
// highest stored LOG whose hash still matches — which can sit far below the actual
// fork point when raw logs are sparse, and degenerately is the stream's
// StartBlock-1. Without a floor, answering the epoch would mark every polled row
// above that block unreadable, for heights that were almost certainly canonical.
//
// WHEN THE EVIDENCE IS MERELY UNAVAILABLE IT DOES NOTHING. No ack, no marking, no
// cursor move: floorUnprobed — a probe errored and ended the pass, or a page is
// still to be walked — sets ConditionPollRewindBlocked and retries on the next
// Step, against the next endpoint when the previous pass ended on a failure. The
// cost is a stalled poller whose /readyz is red and whose WARN says exactly what is
// unresolved.
//
// WHEN THE EVIDENCE CANNOT EXIST IT STILL ANSWERS. floorUnverifiable — rows above
// the boundary at heights no anchor covers — has no future in which retrying helps,
// so waiting there is a permanent stall rather than caution.
//
// Bootstrap (no cursor yet on a chain that already carries epochs) targets block 0
// with no floor: there is nothing of this poller's above it, and the call exists
// purely to create the cursor and ack, which is what ApplyPrices demands before it
// will admit a new writer on such a chain.
func (p *Poller) repair(ctx context.Context) (bool, error) {
	cursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return false, fmt.Errorf("price poller %q: read cursor before rewind: %w", p.engine, err)
	}
	if !found {
		// Bootstrap: no cursor, so this engine owns no scoped history yet. The call
		// creates the cursor and acks the chain's epochs; with nothing above block 0
		// to mark, it marks nothing. It goes through the same non-destructive
		// primitive as every other arm rather than a special-cased one, so a row
		// that somehow existed without a cursor would be retained rather than
		// silently removed by the bootstrap path.
		return true, p.neutralize(ctx, 0, 0, 0, "bootstrap: this engine has no cursor, so it owns no scoped history yet")
	}

	floor, outcome, probes, err := p.verifyFloor(ctx, cursor)
	if err != nil {
		return false, fmt.Errorf("price poller %q: verify poll anchors before repair: %w", p.engine, err)
	}
	// LAST GATE BEFORE ACTING. The three outcomes below mark rows unusable, or
	// bless rows at or below a floor as still valid, on proofs this pass may have
	// accumulated across earlier Steps. The checkpoint re-read happens HERE, with
	// nothing between it and the store call, so "the proof was true when we acted on
	// it" is a property of the code path rather than of how long verification
	// happened to take.
	//
	// The two outcomes NOT gated are not oversights. floorNothingAtRisk consumes no
	// proof — this engine owns nothing above the boundary, so the call marks nothing
	// whatever it believes — and floorUnprobed acts on nothing at all, so spending a
	// probe to authorise inaction would only shrink the page budget that is trying
	// to reach a conclusion.
	switch outcome {
	case floorVerified, floorProvenOrphaned, floorUnverifiable:
		holds, why := p.checkpointStillHolds(ctx)
		if !holds {
			p.blockRepairOnCheckpoint(cursor, probes, why)
			return false, nil
		}
	}
	// EVERY ARM THAT ACTS NEUTRALIZES. There is no deletion arm to choose between,
	// which is the whole of D-010 clause 1: the outcomes differ only in the FLOOR
	// they carry — how much provably-canonical history keeps its validity — and in
	// the justification they record. What used to be a decision about whether the
	// evidence was strong enough to destroy non-replayable rows is now a decision
	// about how much of the suffix has to be marked.
	switch outcome {
	case floorNothingAtRisk:
		return true, p.neutralize(ctx, cursor, 0, probes,
			"this engine owns nothing above the effective repair target, so nothing is marked")
	case floorVerified:
		return true, p.neutralize(ctx, cursor, floor, probes,
			fmt.Sprintf("everything at or below HASH-VERIFIED poll anchor %d keeps its validity; every anchor above it was probed on the same endpoint and MISMATCHED, and the verification checkpoint still held immediately before the act", floor))
	case floorProvenOrphaned:
		return true, p.neutralize(ctx, cursor, 0, probes,
			"every retained poll anchor was probed on one endpoint and MISMATCHED, and every row above the target sits at one of those anchored heights, so each describes a block that endpoint no longer carries")
	case floorUnverifiable:
		return true, p.neutralize(ctx, cursor, floor, probes,
			"rows above the boundary sit at heights no poll anchor covers, so they can be neither proven canonical nor proven orphaned")
	}

	p.blockRepair(cursor, outcome, probes)
	return false, nil
}

// verifyFloor pages this engine's poll anchors downward from toBlock, checking
// each against ONE endpoint's live chain, and decides which of the five
// floorOutcomes holds.
//
// WHAT MAKES A MATCH ACCEPTABLE, and why a bare match is not. Anchors are probed
// newest-first. A match at height H entails that H and every ancestor are
// unchanged on the answering endpoint's chain, so rows at or below H keep their
// validity — but it says NOTHING about the heights ABOVE H, and those are exactly
// the rows a floor of H leaves to be marked. Three independent things have to hold
// before a match may be accepted as a floor:
//
//  1. EVERY ANCHOR ABOVE H WAS PROBED AND MISMATCHED. A probe that ERRORED
//     establishes nothing, so a match below it is not a licence to mark what the
//     failed probe was asking about. This is finding A1's third life: the code
//     once set a probeFailed flag and returned the next match anyway, so a
//     transient outage on a newer canonical anchor erased that canonical history.
//     A pass now ENDS at its first failed probe, so no lower anchor is even
//     reached; across pages the same property is carried by probeResumeFrom, which
//     is only ever lowered by a page that completed.
//  2. EVERY ONE OF THOSE ANSWERS CAME FROM THE SAME ENDPOINT. This is A1's fifth
//     life. Probes used to advance across endpoints, so "5000 is orphaned" could
//     come from one node's fork and "4900 is canonical" from another's, with no
//     relationship between the two chains — and the checkpoint below vouches for
//     only one of them. See pinProbeEndpoint and probeAnchor.
//  3. NO ROW ABOVE THE BOUNDARY SITS AT AN UNANCHORED HEIGHT. An anchor set can be
//     complete for the anchors it has and still leave rows uncovered — mixed
//     legacy-and-anchored history does exactly that — and an uncovered row has
//     nothing available to place it in either direction. Those states are
//     floorUnverifiable, never floorVerified.
//
// The boundary is max(floor, effective target), because the store lowers a
// caller's target to the deepest unacknowledged rewound_to and the floor then
// raises it back: a floor BELOW the effective target does not move the boundary at
// all.
//
// Each Step spends at most anchorProbePage probes. A page that finds no match
// lowers the resume point and returns floorUnprobed, so the NEXT Step continues
// deeper instead of abandoning verification — the behaviour the old
// eight-and-give-up bound lacked.
//
// # AN ANSWER HAS A TIME AND A VIEW, NOT JUST A HEIGHT
//
// Enumerating the state space (floorOutcome) settled WHICH states may act; it said
// nothing about the truth of a state changing under a paged verification, nor
// about whose chain that truth was read from. Three bindings close those, because
// the three ways an answer can stop describing reality are visible in three
// different places:
//
//  1. THE REORG GENERATION. Every reorg the walker records increments
//     store.PriceRepairExposure.ReorgGeneration. Paging state is stamped with the
//     generation it was computed under, and a change DISCARDS it: verification
//     restarts from the newest anchor rather than resuming into a range whose
//     verdicts may have flipped.
//  2. THE LIVE-CHAIN CHECKPOINT. The generation only moves when the WALKER has
//     already noticed, which it may not have yet. So the pass also remembers the
//     highest anchor height it successfully probed and the hash reported there.
//     Re-reading that one height answers the whole question for that chain: a
//     block hash commits to its entire ancestry, so an unchanged answer entails
//     every lower answer still holds on it, and a changed answer entails that at
//     least one may not. repair revalidates it IMMEDIATELY BEFORE the act — not
//     merely at the start of the Step — and a failed or changed revalidation marks
//     nothing.
//  3. THE ENDPOINT PIN. The checkpoint is re-read on the endpoint that ESTABLISHED
//     it, which is the only endpoint the pass ever talks to. Asking a different
//     node conflates "the chain moved" with "these two nodes disagree", and the
//     entailment in (2) only covers answers drawn from the same chain.
//
// Anchors above toBlock are excluded by the query: a floor above the requested
// target would bless rows outside the cursor's coverage, and the store refuses it
// outright.
func (p *Poller) verifyFloor(ctx context.Context, toBlock uint64) (uint64, floorOutcome, int, error) {
	exp, err := p.store.PriceRepairExposure(ctx, p.engine, p.cfg.ChainID, toBlock)
	if err != nil {
		return 0, floorUnprobed, 0, err
	}
	if exp.Owned == 0 {
		// Nothing this engine owns lies above the height the repair will act on.
		// This is the provable transition out of the pending-epoch state and it
		// covers the case where the walker's target is already above all our rows.
		return 0, floorNothingAtRisk, 0, nil
	}

	// TIME BINDING (1): the accumulated proofs were computed under one reorg
	// generation. A newer generation means the chain moved again, so they are
	// discarded and paging restarts from the newest anchor.
	if p.probeGeneration != exp.ReorgGeneration {
		p.resetVerification(fmt.Sprintf("the chain's reorg generation moved from %d to %d while verification was paging",
			p.probeGeneration, exp.ReorgGeneration))
	}
	// VIEW BINDING: one endpoint answers every probe of this pass, chosen once and
	// kept across pages and Steps.
	endpoint := p.pinProbeEndpoint()

	from := toBlock
	if p.probeResumeSet && p.probeResumeFrom < from {
		from = p.probeResumeFrom
	}
	anchors, err := p.store.PollAnchorsBelow(ctx, p.engine, p.cfg.ChainID, from, anchorProbePage)
	if err != nil {
		return 0, floorUnprobed, 0, err
	}
	if len(anchors) == 0 {
		// Either there was never an anchor at or below the cursor (legacy history),
		// or we have paged past the oldest retained one. Both are terminal for
		// PROBING; which outcome they are depends on whether the anchors we did
		// probe cover every row above the target.
		if p.probeResumeSet && exp.Unanchored == 0 {
			// Every anchor <= cursor was probed against ONE endpoint and mismatched,
			// and every row above the target sits at one of those anchored heights.
			return 0, floorProvenOrphaned, 0, nil
		}
		return 0, floorUnverifiable, 0, nil
	}

	probes := 0
	deepestChecked := uint64(0)
	for _, a := range anchors {
		live, err := p.probeAnchor(ctx, endpoint, a.BlockNumber)
		probes++
		if err != nil {
			// THE PASS ENDS HERE. The pinned endpoint did not answer, so this pass
			// can learn nothing further that belongs to its chain view: probing on
			// below would either mix ancestries (if the client failed over) or
			// accumulate proofs around a hole. The accumulated state is discarded
			// and the pin moves on, so the next Step starts a complete pass from the
			// newest anchor against a different endpoint.
			p.abandonPass(fmt.Sprintf("anchor %d could not be probed on endpoint %d (%v)",
				a.BlockNumber, endpoint, err))
			return 0, floorUnprobed, probes, nil
		}
		// TIME BINDING (2): the highest height this pass has an answer for becomes
		// the checkpoint every proof at or below it is revalidated against.
		p.noteCheckpoint(a.BlockNumber, live.Bytes(), exp.ReorgGeneration)
		if bytes.Equal(live.Bytes(), a.BlockHash) {
			boundary := max(a.BlockNumber, exp.EffectiveTarget)
			unanchored, err := p.store.CountUnanchoredPricesAbove(ctx, p.engine, p.cfg.ChainID, boundary)
			if err != nil {
				return 0, floorUnprobed, probes, err
			}
			if unanchored > 0 {
				// The anchors are complete and this one is canonical on the pinned
				// endpoint, but rows above the boundary sit at heights no anchor
				// covers, so they can never be judged either way. The verified floor
				// is still RETURNED: everything at or below it keeps its validity
				// when the suffix above is neutralized.
				slog.Warn("poll anchor at this height matches the pinned endpoint's chain, but rows above the boundary sit at heights NO anchor covers, so they can be neither proven canonical nor proven orphaned; neutralizing the suffix above it",
					"engine", p.engine, "matchedBlock", a.BlockNumber, "boundary", boundary,
					"unanchoredRowsAbove", unanchored, "endpoint", endpoint)
				return a.BlockNumber, floorUnverifiable, probes, nil
			}
			return a.BlockNumber, floorVerified, probes, nil
		}
		slog.Warn("poll anchor is ORPHANED on the endpoint this pass is pinned to: it reports a different hash at that height, so this round's rows describe a block that endpoint's chain does not carry",
			"engine", p.engine, "anchorBlock", a.BlockNumber, "recorded", fmt.Sprintf("%x", a.BlockHash),
			"live", live.Hex(), "endpoint", endpoint)
		deepestChecked = a.BlockNumber
	}
	// The whole page was answered by the pinned endpoint and every anchor
	// mismatched, so the pass may continue BELOW them next Step. A page that ended
	// early was abandoned above and never reaches here, which is why this needs no
	// "did any probe fail" test.
	if deepestChecked > 0 {
		p.probeResumeFrom, p.probeResumeSet = deepestChecked-1, true
	}
	return 0, floorUnprobed, probes, nil
}

// pinProbeEndpoint fixes the ONE endpoint this verification pass talks to, and
// returns the pin for subsequent Steps of the same pass.
//
// This is D-010 clause 2. Probes used to be spread across endpoints on purpose —
// one probe per endpoint, advancing — so that a single frozen or forked node could
// not answer every question with the same wrong history. What that bought in
// independence it gave back in COHERENCE: a pass assembled "this anchor is
// orphaned" from several nodes that may sit on different forks, and then
// revalidated a checkpoint that commits to exactly one of them. An anchor
// canonical on the checkpoint's chain could be marked on another endpoint's word.
//
// The initial choice still respects the routing hints (exploration first, then an
// attribution pin), so a pass does not start on an endpoint the poller has reason
// to distrust.
//
// WHAT THIS DOES NOT ESTABLISH, stated because the previous rounds' claims outran
// their code: it bounds a pass to one chain view. It does not show that view is
// the canonical chain. A pinned endpoint alone on a minority fork yields a
// self-consistent pass whose floor is too low, and the consequence is that
// canonical rows are marked unusable — recoverable through insertPrice's supersede
// arm when a canonical answer later lands at that height — rather than deleted.
// That asymmetry is the reason D-010 removes the deletion instead of strengthening
// the proof a sixth time.
func (p *Poller) pinProbeEndpoint() int {
	if p.probeEndpointSet {
		return p.probeEndpoint
	}
	p.probeEndpoint, p.probeEndpointSet = p.probeStart(0), true
	return p.probeEndpoint
}

// probeAnchor asks THE PINNED ENDPOINT for a height's live hash and refuses any
// answer that came from somewhere else.
//
// HeaderHashFrom is a FAILOVER call: given a start index it walks on when that
// endpoint errors and returns whatever the next one says, naming the answering
// endpoint only in the token. Reading the hash and ignoring the token is how a
// pass mixes ancestries without ever deciding to — no rotation required, just an
// unlucky timeout. Rejecting the substitution turns the client's silent failover
// into an ordinary probe failure, which the pass already knows how to handle.
func (p *Poller) probeAnchor(ctx context.Context, endpoint int, block uint64) (common.Hash, error) {
	live, servedBy, err := p.chain.HeaderHashFrom(ctx, endpoint, block)
	if err != nil {
		return common.Hash{}, err
	}
	if servedBy.Index != endpoint {
		return common.Hash{}, fmt.Errorf("endpoint %d did not answer: the failover client served this probe from endpoint %d instead, and an answer from another chain view may not join this pass's proofs",
			endpoint, servedBy.Index)
	}
	return live, nil
}

// abandonPass discards the verification pass and moves the NEXT one one endpoint
// further along.
//
// Both halves matter. Discarding is what keeps a pass coherent: its proofs were
// established against an endpoint that has now failed to answer, and continuing
// would either mix in another node's view or reason around a hole. Rotating is
// what stops a pinned endpoint from becoming a permanent stall — with no
// rotation, a dead pin fails the same probe every Step forever and the epoch is
// never answered, which is the fail-forever posture this package already refuses
// elsewhere.
//
// The cost is disclosed: a transient blip on a deep reorg throws away the pages
// already walked, so verification re-probes from the newest anchor and the epoch
// takes longer to answer. Nothing is marked or acked in the meantime, and
// ConditionPollRewindBlocked reports the wait.
func (p *Poller) abandonPass(why string) {
	next := 0
	if c := p.chain.EndpointCount(); c > 0 {
		next = ((p.probeEndpoint+1)%c + c) % c
	}
	p.resetVerification(why)
	p.probeEndpoint, p.probeEndpointSet = next, true
}

// noteCheckpoint records the highest anchor height this verification pass has a
// LIVE answer for, together with the hash — the reference every accumulated
// mismatch proof is revalidated against. It needs no endpoint of its own: the
// pass has exactly one, and probeAnchor refuses any answer from another.
//
// It only ever moves UPWARD within a pass, because a hash at H entails the whole
// ancestry of H: a checkpoint higher than another one strictly covers it, and
// letting a later, deeper page overwrite it with a lower height would shrink the
// range the revalidation vouches for. Pages descend, so in practice this records
// the first successful probe of a pass.
func (p *Poller) noteCheckpoint(block uint64, live []byte, generation int64) {
	if p.probeCheckpointSet && block <= p.probeCheckpointBlock {
		return
	}
	hash := make([]byte, len(live))
	copy(hash, live)
	p.probeCheckpointSet, p.probeCheckpointBlock = true, block
	p.probeCheckpointHash = hash
	p.probeGeneration = generation
}

// checkpointStillHolds re-reads the verification checkpoint ON THE PASS'S OWN
// ENDPOINT and reports whether that chain still gives the answer this pass's
// proofs were computed against. It is called IMMEDIATELY BEFORE the marking (or
// validity-blessing) act, which is the only moment at which the question has an
// answer worth having: verification may have spanned many Steps and many minutes.
//
// Three outcomes, and only the first authorises anything:
//
//   - UNCHANGED — every proof at or below the checkpoint still holds, by hash
//     ancestry, on the one chain view they all came from. Proceed.
//   - CHANGED — that chain moved again, so at least one proof may have flipped
//     (this is A1: a previously-mismatched anchor can be canonical again). The
//     accumulated state is DISCARDED and verification restarts from the newest
//     anchor; nothing is marked this Step.
//   - UNREADABLE — the pinned endpoint did not answer. That is not evidence
//     either way, and it is the same event as a failed anchor probe, so it gets
//     the same treatment: the pass is abandoned and the next one runs against a
//     different endpoint.
//
// The re-read deliberately does NOT accept a failover substitute: a revalidation
// answered by another node conflates "the chain moved" with "these two nodes
// disagree", and neither reading would justify acting on proofs the substitute
// node never produced.
//
// A pass with NO checkpoint (nothing was successfully probed, so no cached proof
// is being relied on) holds trivially.
func (p *Poller) checkpointStillHolds(ctx context.Context) (bool, string) {
	if !p.probeCheckpointSet {
		return true, ""
	}
	block := p.probeCheckpointBlock
	live, err := p.probeAnchor(ctx, p.probeEndpoint, block)
	if err != nil {
		why := fmt.Sprintf("the verification checkpoint at block %d could not be re-read on endpoint %d immediately before the repair (%v), so the anchor proofs at or below it cannot be shown to still hold",
			block, p.probeEndpoint, err)
		p.abandonPass(why)
		return false, why
	}
	if !bytes.Equal(live.Bytes(), p.probeCheckpointHash) {
		why := fmt.Sprintf("endpoint %d now reports %s at the verification checkpoint (block %d) where it reported %x when this pass's anchor proofs were established: its chain moved AGAIN, so anchors this pass recorded as orphaned may be canonical once more",
			p.probeEndpoint, live.Hex(), block, p.probeCheckpointHash)
		p.resetVerification(why)
		return false, why
	}
	return true, ""
}

// resetVerification discards the paging state and the checkpoint, so the next
// Step re-probes from the newest anchor. It is the "restart whenever the chain
// state the proofs were computed against changes" half of the temporal binding;
// the proofs themselves are not repaired, they are thrown away.
//
// IT DELIBERATELY KEEPS THE ENDPOINT PIN. The reasons it fires — a new reorg
// generation, a checkpoint that moved — are statements about the CHAIN, not
// about the endpoint, so the next pass has no reason to look elsewhere and every
// reason to stay coherent with the view it was already reading. Only abandonPass
// moves the pin, because only it is reached when the endpoint itself failed to
// answer. Clearing the pin here instead was tried and is wrong twice over: the
// generation stamp is written by noteCheckpoint, so a pass whose FIRST probe fails
// never records one, the generation check fires again on the next Step, and the
// reset would put the pin straight back onto the endpoint that just failed —
// forever.
func (p *Poller) resetVerification(why string) {
	if p.probeResumeSet || p.probeCheckpointSet {
		slog.Warn("poll-anchor verification RESTARTS from the newest anchor: the chain state its accumulated mismatch proofs were computed against no longer holds, so those proofs are discarded rather than acted on",
			"engine", p.engine, "why", why, "resumeFrom", p.probeResumeFrom,
			"checkpointBlock", p.probeCheckpointBlock, "checkpointGeneration", p.probeGeneration,
			"endpoint", p.probeEndpoint)
	}
	p.probeResumeFrom, p.probeResumeSet = 0, false
	p.probeCheckpointSet, p.probeCheckpointBlock = false, 0
	p.probeCheckpointHash = nil
	p.probeGeneration = 0
}

// neutralize is THE ONLY WAY THIS POLLER ANSWERS A REORG EPOCH. It retains every
// row and marks the ones above the boundary unusable.
//
// It replaced a rewind arm, and the reason is an asymmetry rather than a
// preference (D-010). Both operations act on a judgement that can be wrong. A
// wrong DELETION of a polled row is permanent: the row is a point-in-time
// PriceProviderV2 read, this path only ever reads `latest`, and nothing in
// raw_logs can reproduce it. A wrong MARKING costs availability — the asset has no
// usable price at those heights and the poller's invalid-answer condition says so
// — and is undone by insertPrice's supersede arm the moment a canonical answer
// lands at that height. Five review rounds went into justifying the deletion; each
// found a dimension the previous one had not modelled. Removing the deletion
// removes the obligation rather than discharging it again.
//
// store.NeutralizeUnverifiablePrices retains every row, marks the ones above the
// boundary so no usable-price read can return them and no later repair can verify
// them, drops the anchors above that boundary, resets the cursor and acks — in one
// transaction. A verified floor confines the marking: history the pass proved
// canonical keeps its validity, and only the suffix above it is marked.
//
// WHAT THIS IS NOT: it is not a proof, and it is not free. The marked rows stay in
// the table as unusable artifacts and accumulate with poll cadence and reorg
// frequency; refreshNeutralizedBacklog is what makes that accumulation visible.
// Re-verifying or retiring them is a separate reconciliation that does not exist
// yet (D-010 clause 4).
func (p *Poller) neutralize(ctx context.Context, cursor, floor uint64, probes int, justification string) error {
	boundary, quarantined, err := p.store.NeutralizeUnverifiablePrices(ctx, p.engine, p.cfg.ChainID, cursor, floor)
	if err != nil {
		return fmt.Errorf("price poller %q: neutralize prices above %d (verified floor %d): %w", p.engine, cursor, floor, err)
	}
	newCursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return fmt.Errorf("price poller %q: read cursor after neutralization: %w", p.engine, err)
	}
	if !found {
		return fmt.Errorf("price poller %q: cursor missing after NeutralizeUnverifiablePrices — store contract violated", p.engine)
	}
	slog.Warn("polled prices NEUTRALIZED rather than deleted after a reorg epoch: nothing was deleted, the rows above the boundary are retained and marked unusable, everything at or below the verified floor keeps its validity, the epoch is acknowledged, and poll ingestion resumes at the new head",
		"engine", p.engine, "requestedTarget", cursor, "verifiedFloor", floor,
		"boundary", boundary, "cursor", newCursor, "rowsNeutralized", quarantined,
		"anchorProbes", probes, "justification", justification)

	p.clearRepairState()
	// The rows this poller owned above the boundary are no longer usable, so the
	// caches built from them are wrong: re-read them rather than carry timestamps
	// that describe observations a price read can no longer return.
	p.rehydrateAfterUncertainty(ctx, "neutralization")
	p.refreshNeutralizedBacklog(ctx, "after neutralization")

	// Answering the epoch moves the queue forward even though no price landed: the
	// cadence slot is not consumed, so the next Step polls immediately and records
	// fresh, usable rows at the new head.
	return nil
}

// refreshNeutralizedBacklog re-reads how many retained-but-unusable rows this
// engine has accumulated and how old they are, and reports a change.
//
// D-010 clause 4: neutralization trades data loss for rows that are kept and can
// never be read, so the size and age of that pile is the cost of the policy and
// has to be observable. It is deliberately NOT a health condition: the rows are
// never retired (a reconciliation that could is explicitly out of scope), so a
// condition keyed on their existence would latch /readyz red forever, which is an
// outage rather than a signal. Acute unusability is already reported, per asset,
// by ConditionPollInvalidAnswer, and that one clears when a valid observation
// lands.
//
// A failed read is logged and dropped. This is an operator-facing number, not a
// precondition for any decision, and failing hydration on it would let a counting
// query take the poller's freshness verdict down with it.
func (p *Poller) refreshNeutralizedBacklog(ctx context.Context, when string) {
	stats, err := p.store.NeutralizedPriceStats(ctx, p.engine, p.cfg.ChainID)
	if err != nil {
		slog.Warn("could not read the neutralized-price backlog; its size and age are unknown this round",
			"engine", p.engine, "when", when, "err", err)
		return
	}
	prev, had := p.neutralizedStats, p.neutralizedKnown
	p.neutralizedStats, p.neutralizedKnown = stats, true
	if stats.Rows == 0 || (had && prev.Rows == stats.Rows) {
		return
	}
	age := time.Duration(0)
	if !stats.Oldest.IsZero() {
		age = p.now().Sub(stats.Oldest)
	}
	slog.Warn("polled price rows are RETAINED BUT UNUSABLE after reorg repair: they were neutralized rather than deleted, and nothing retires them, so this count only grows until a reconciliation exists",
		"engine", p.engine, "chain", p.cfg.ChainID, "rows", stats.Rows,
		"oldestObservedAt", stats.Oldest, "oldestAge", age.Truncate(time.Second),
		"newestObservedAt", stats.Newest, "highestBlock", stats.HighestBlock, "when", when)
}

// NeutralizedBacklog reports the retained-but-unusable rows this engine has
// accumulated, and whether the count has been read successfully at all. It is the
// introspection half of D-010 clause 4; the log half is in
// refreshNeutralizedBacklog.
func (p *Poller) NeutralizedBacklog() (store.NeutralizedPriceStats, bool) {
	return p.neutralizedStats, p.neutralizedKnown
}

// blockRepair records a refusal to conclude, with the evidence that is missing. It
// is deliberately not an error: erroring every Step would consume the daemon's
// retry backoff on a state that only an operator or a recovered endpoint can
// change, and the condition surface is where this belongs.
//
// Refusal survives D-010. Nothing can be destroyed here any more, but marking
// canonical rows unusable is still wrong, so an inconclusive pass waits rather
// than marking on incomplete evidence. What it waits for is bounded: the states
// where no answer can ever arrive are NEUTRALIZED instead of refused.
func (p *Poller) blockRepair(cursor uint64, outcome floorOutcome, probes int) {
	// Only floorUnprobed reaches here: it is the one outcome where the answer may
	// still arrive, so it is the one outcome worth waiting for.
	why := "poll-anchor verification has not concluded"
	detail := "probes are still paging down through the retained anchors on one pinned endpoint, or a probe FAILED and will be retried against another endpoint from the newest anchor; nothing is marked or acked until one endpoint answers a complete pass"
	if outcome != floorUnprobed {
		// Defensive: a future outcome added without a repair arm must not read as
		// "still probing".
		why = fmt.Sprintf("repair reached an unhandled verification outcome (%d)", outcome)
		detail = "this is a code defect; nothing was marked or acked"
	}
	p.recordRepairRefusal(cursor, probes, why, detail)
}

// blockRepairOnCheckpoint records the refusal that closes A1's temporal hole: the
// verification checkpoint could not be re-read, or no longer holds, at the instant
// repair was about to act. Both are recoverable — a later pass re-probes from the
// newest anchor — which is why this is a condition and a retry rather than an
// error.
func (p *Poller) blockRepairOnCheckpoint(cursor uint64, probes int, why string) {
	p.recordRepairRefusal(cursor, probes,
		"the live-chain checkpoint the anchor proofs were computed against did not hold immediately before the act",
		why+". Nothing was marked or acked; verification re-runs against the chain as it now stands")
}

// recordRepairRefusal is the single place a standing repair refusal is composed and
// reported, so every refusal reaches ConditionPollRewindBlocked in the same shape
// and none of them can be an error that burns the daemon's retry backoff on a state
// only an operator or a recovered chain view can change.
func (p *Poller) recordRepairRefusal(cursor uint64, probes int, why, detail string) {
	reason := fmt.Sprintf("a reorg epoch on chain %d is pending and repair REFUSED to ack or mark: %s (cursor %d, probes this round %d). %s. Polled prices cannot be re-derived, so no price is applied until this resolves",
		p.cfg.ChainID, why, cursor, probes, detail)
	if p.rewindBlocked != reason {
		slog.Warn("price reorg repair BLOCKED: the evidence for marking rows unusable is incomplete, so the epoch stays unanswered this round",
			"engine", p.engine, "chain", p.cfg.ChainID, "cursor", cursor,
			"why", why, "probesThisRound", probes, "resumeFrom", p.probeResumeFrom,
			"checkpointBlock", p.probeCheckpointBlock, "endpoint", p.probeEndpoint)
	}
	p.rewindBlocked = reason
}

// clearRepairState drops the verification pass — paging cursor, checkpoint,
// endpoint pin and generation stamp — along with any standing refusal. Called both
// when a repair completes and when no epoch is pending at all; in either case the
// previous refusal no longer describes reality and the next epoch must be verified
// from scratch rather than against a checkpoint from the last one.
func (p *Poller) clearRepairState() {
	p.probeResumeFrom, p.probeResumeSet = 0, false
	p.probeCheckpointSet, p.probeCheckpointBlock = false, 0
	p.probeCheckpointHash = nil
	p.probeEndpoint, p.probeEndpointSet = 0, false
	p.probeGeneration = 0
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
			slog.Warn("could not read the live hash for an unanchored price block; it stays unanchored, so a later reorg can only NEUTRALIZE it rather than place it",
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
