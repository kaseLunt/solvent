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
	// anchor height this verification pass successfully probed, the hash the chain
	// reported there at that moment, and the endpoint that said so. Because a block
	// hash commits to its whole ancestry, that one height re-read unchanged entails
	// that every proof at or below it still holds — and re-read CHANGED it entails
	// that at least one of them may not. It is revalidated immediately before every
	// destructive or blessing act (see repair).
	probeCheckpointSet   bool
	probeCheckpointBlock uint64
	probeCheckpointHash  []byte
	probeCheckpointBy    int
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
//
// THE STATE SPACE IS ENUMERATED HERE ON PURPOSE. A1 survived three fix attempts
// because each one handled the cases its author had in mind and returned a
// permissive answer for the rest. These five values partition every possible
// state, and exactly three of them may touch a row:
//
//	                                         may delete?  may ack?
//	floorNothingAtRisk  nothing above target      n/a        yes
//	floorVerified       proof for everything      yes        yes
//	floorProvenOrphaned proof for everything      yes        yes
//	floorUnverifiable   proof impossible          NO         yes (neutralize)
//	floorUnprobed       proof not yet in hand     NO         NO  (retry)
//
// The invariant every one of them serves: NEVER DELETE OR BLESS A ROW WITHOUT
// POSITIVE PROOF OF NON-CANONICALITY FOR EVERYTHING ABOVE THE FLOOR. "Proof" is
// only ever an anchor whose recorded hash no longer matches the live chain, or a
// verified anchor at or above the row (which entails its whole ancestry).
//
// AND THE ENUMERATION IS NOT SUFFICIENT BY ITSELF, which is what the FOURTH A1
// round established. Partitioning the states answers "which state may delete"; it
// says nothing about a state's truth CHANGING between the Step that established it
// and the Step that acts on it. Verification is paged across Steps, so a proof is
// cached, and a proof about a chain is only true of the chain it was computed
// against: a later reorg can make a mismatched anchor canonical again, at which
// point acting on the cached mismatch deletes canonical history. Every outcome
// above is therefore ALSO bound to a reorg generation and a live-chain checkpoint,
// revalidated immediately before the act — see verifyFloor's "A PROOF HAS A TIME"
// section and Poller.checkpointStillHolds. Enumerate transitions, not just states.
type floorOutcome int

const (
	// floorNothingAtRisk: this engine owns nothing above the effective rewind
	// target, so the rewind deletes nothing whatever floor it uses. Proceeding is
	// vacuous, not lossy.
	floorNothingAtRisk floorOutcome = iota
	// floorVerified: an anchor at or below the requested target re-verified
	// against the live chain (so it and every ancestor are unchanged), AND every
	// anchor above it was successfully probed and mismatched, AND no row above the
	// deletion boundary sits at an unanchored height, AND the checkpoint those
	// mismatches were established against still holds at the moment of deletion.
	// All four are required. A match alone was A1's third life (a FAILED probe of a
	// newer anchor followed by a lower match used to delete the newer history); a
	// mismatch that has since been overturned by a second reorg was its fifth.
	floorVerified
	// floorProvenOrphaned: verification paged through every retained anchor, all
	// of them mismatched, and every row above the effective target sits at one of
	// those anchored heights. Each such row is therefore proven to describe a
	// replaced block, so deleting above the target is justified with no floor —
	// provided the checkpoint those mismatches were established against still holds
	// when the deletion runs. This outcome ALWAYS rests on cached, cross-Step
	// proofs (a single page cannot reach the bottom and conclude), so it is the
	// outcome the temporal binding matters most for.
	floorProvenOrphaned
	// floorUnverifiable: rows above the deletion boundary sit at heights NO
	// surviving anchor covers — legacy history, or history whose anchors retention
	// removed. No future fact can settle them (the hash of the block their round
	// ran at was never recorded), so neither deletion nor retention-as-usable is
	// defensible: they are NEUTRALIZED. See Poller.neutralize.
	floorUnverifiable
	// floorUnprobed: verification did not conclude this Step — a probe FAILED, or
	// the page budget was spent with anchors still to check. The answer may still
	// arrive, so nothing is deleted and nothing is acked; it RESUMES next Step.
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
// WHEN THE EVIDENCE IS MERELY UNAVAILABLE IT DOES NOTHING. No ack, no deletion, no
// cursor move: floorUnprobed — a probe errored, or a page is still to be walked —
// sets ConditionPollRewindBlocked and retries on the next Step. The cost is a
// stalled poller whose /readyz is red and whose WARN says exactly what is unproven;
// the alternative, which this replaces, was deleting unrecoverable canonical
// history on a transient probe outage.
//
// WHEN THE EVIDENCE CANNOT EXIST IT NEUTRALIZES. floorUnverifiable — rows above the
// deletion boundary at heights no anchor covers — has no future in which retrying
// helps, so waiting there is a permanent stall rather than caution. See neutralize.
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
	// LAST GATE BEFORE ACTING. The three outcomes below either delete rows or bless
	// rows at or below a floor as still valid, and each rests on proofs this pass may
	// have accumulated across earlier Steps. The checkpoint re-read happens HERE,
	// with nothing between it and the store call, so "the proof was true when we
	// acted on it" is a property of the code path rather than of how long
	// verification happened to take.
	//
	// The two outcomes NOT gated are not oversights. floorNothingAtRisk consumes no
	// proof — this engine owns nothing above the boundary, so the rewind deletes
	// nothing whatever it believes — and floorUnprobed acts on nothing at all, so
	// spending a probe to authorise inaction would only shrink the page budget that
	// is trying to reach a conclusion.
	switch outcome {
	case floorVerified, floorProvenOrphaned, floorUnverifiable:
		holds, why := p.checkpointStillHolds(ctx)
		if !holds {
			p.blockRepairOnCheckpoint(cursor, probes, why)
			return false, nil
		}
	}
	switch outcome {
	case floorNothingAtRisk:
		if err := p.rewindTo(ctx, cursor, 0, probes,
			"this engine owns nothing above the effective rewind target, so the rewind deletes nothing"); err != nil {
			return false, err
		}
		return true, nil
	case floorVerified:
		if err := p.rewindTo(ctx, cursor, floor, probes,
			fmt.Sprintf("retained everything at or below HASH-VERIFIED poll anchor %d, every anchor above it was probed and mismatched, and the verification checkpoint still held immediately before the deletion", floor)); err != nil {
			return false, err
		}
		return true, nil
	case floorProvenOrphaned:
		if err := p.rewindTo(ctx, cursor, 0, probes,
			"every retained poll anchor was probed and MISMATCHED, every row above the target sits at one of those anchored heights, and the verification checkpoint still held immediately before the deletion, so each row is proven to describe a replaced block"); err != nil {
			return false, err
		}
		return true, nil
	case floorUnverifiable:
		if err := p.neutralize(ctx, cursor, floor, probes); err != nil {
			return false, err
		}
		return true, nil
	}

	p.blockRepair(cursor, outcome, probes)
	return false, nil
}

// verifyFloor pages this engine's poll anchors downward from toBlock, verifying
// each against the live chain, and decides which of the five floorOutcomes holds.
//
// WHAT MAKES A MATCH ACCEPTABLE, and why a bare match is not. Anchors are probed
// newest-first. A match at height H entails that H and every ancestor are
// unchanged, so rows at or below H are safe to keep — but it says NOTHING about
// the heights ABOVE H, and those are exactly the rows a rewind to a floor of H
// deletes. Two independent things therefore have to hold before a match may be
// accepted as a floor:
//
//  1. EVERY ANCHOR ABOVE H WAS SUCCESSFULLY PROBED AND MISMATCHED. A probe that
//     ERRORED proves nothing, so a match below it is not a licence to delete what
//     the failed probe was asking about. This is finding A1's third life: the
//     previous code set probeFailed and then returned the next match anyway, so a
//     transient outage on a newer canonical anchor erased that canonical history.
//     Across pages the same property is carried by probeResumeFrom, which is only
//     ever lowered by a page in which every probe SUCCEEDED and mismatched.
//  2. NO ROW ABOVE THE DELETION BOUNDARY SITS AT AN UNANCHORED HEIGHT. An anchor
//     set can be complete for the anchors it has and still leave rows uncovered —
//     mixed legacy-and-anchored history does exactly that — and an uncovered row
//     has no proof available in either direction. Those states are
//     floorUnverifiable, never floorVerified.
//
// The deletion boundary is max(floor, effective target), because RewindPrices
// lowers a caller's target to the deepest unacknowledged rewound_to and the floor
// then raises it back: a floor BELOW the effective target does not move the
// boundary at all.
//
// Each Step spends at most anchorProbePage probes. A page that finds no match
// lowers the resume point and returns floorUnprobed, so the NEXT Step continues
// deeper instead of abandoning verification — the behaviour the old
// eight-and-give-up bound lacked.
//
// # A PROOF HAS A TIME, NOT JUST A HEIGHT
//
// This is finding A1's fifth life, and the dimension the earlier fixes were all
// missing. Enumerating the state space (floorOutcome) settled WHICH states may
// delete; it said nothing about the truth of a state changing UNDER a paged
// verification. probeResumeFrom used to carry only a height, and a mismatch
// established under one chain state stayed trusted afterwards. A SECOND reorg can
// make exactly those skipped, higher anchors canonical again — and then a lower
// match is accepted as a floor, or every anchor is declared orphaned, and rows
// that now describe the canonical chain are deleted. Non-replayable history, lost
// on a proof that had expired.
//
// Two bindings close it, because the two ways the truth can move are visible in
// two different places:
//
//  1. THE REORG GENERATION. Every reorg the walker records increments
//     store.PriceRepairExposure.ReorgGeneration. Paging state is stamped with the
//     generation it was computed under, and a change DISCARDS it: verification
//     restarts from the newest anchor rather than resuming into a range whose
//     verdicts may have flipped.
//  2. THE LIVE-CHAIN CHECKPOINT. The generation only moves when the WALKER has
//     already noticed, which it may not have yet. So the pass also remembers the
//     highest anchor height it successfully probed and the hash the chain reported
//     there. Re-reading that one height answers the whole question: a block hash
//     commits to its entire ancestry, so an unchanged answer entails every lower
//     proof still holds, and a changed answer entails that at least one may not.
//     repair revalidates it IMMEDIATELY BEFORE the destructive act — not merely at
//     the start of the Step — and a failed or changed revalidation deletes nothing.
//
// The checkpoint is re-read through the endpoint that ESTABLISHED it. Probes are
// otherwise spread across endpoints on purpose, but a revalidation asked of a
// different node conflates "the chain moved" with "these two nodes disagree", and
// the second would refuse repairs forever on any fleet with one lagging member.
//
// Each probe is routed through a DIFFERENT endpoint than the last (HeaderHashFrom
// with an advancing start index) so one frozen or forked endpoint cannot answer
// every question with the same wrong history. Anchors above toBlock are excluded
// by the query: a floor above the requested target would bless rows outside the
// cursor's coverage, and RewindPrices refuses it outright.
func (p *Poller) verifyFloor(ctx context.Context, toBlock uint64) (uint64, floorOutcome, int, error) {
	exp, err := p.store.PriceRepairExposure(ctx, p.engine, p.cfg.ChainID, toBlock)
	if err != nil {
		return 0, floorUnprobed, 0, err
	}
	if exp.Owned == 0 {
		// Nothing this engine owns lies above the height the rewind will act on.
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
			// Every anchor ≤ cursor was probed and mismatched, and every row above
			// the target sits at one of those anchored heights: each is proven to
			// describe a replaced block.
			return 0, floorProvenOrphaned, 0, nil
		}
		return 0, floorUnverifiable, 0, nil
	}

	probes, probeFailed := 0, false
	deepestChecked := from
	for _, a := range anchors {
		live, servedBy, err := p.chain.HeaderHashFrom(ctx, p.probeStart(probes), a.BlockNumber)
		probes++
		if err != nil {
			probeFailed = true
			slog.Warn("poll anchor hash probe failed; this anchor cannot be verified, so no lower match may be accepted as a floor this Step and it will be re-probed rather than skipped",
				"engine", p.engine, "anchorBlock", a.BlockNumber, "err", err)
			continue
		}
		// TIME BINDING (2): the highest height this pass has an answer for becomes
		// the checkpoint every proof at or below it is revalidated against.
		p.noteCheckpoint(a.BlockNumber, live.Bytes(), servedBy.Index, exp.ReorgGeneration)
		if bytes.Equal(live.Bytes(), a.BlockHash) {
			if probeFailed {
				// GATE 1. A newer anchor above this one could not be checked, so
				// deleting the history it covers would be deletion without proof.
				// Refuse the whole repair and retry; the resume point is
				// deliberately NOT lowered, so the next Step re-probes from the top
				// of this page.
				slog.Warn("poll anchor at this height MATCHES the live chain, but a NEWER anchor above it could not be probed, so it is NOT accepted as a rewind floor: deleting the unproven history above it is what finding A1 is about",
					"engine", p.engine, "matchedBlock", a.BlockNumber, "probesThisRound", probes)
				return 0, floorUnprobed, probes, nil
			}
			boundary := max(a.BlockNumber, exp.EffectiveTarget)
			unanchored, err := p.store.CountUnanchoredPricesAbove(ctx, p.engine, p.cfg.ChainID, boundary)
			if err != nil {
				return 0, floorUnprobed, probes, err
			}
			if unanchored > 0 {
				// GATE 2. The anchors are complete and this one is canonical, but
				// rows above the boundary sit at heights no anchor covers, so they
				// can never be proven either way. The verified floor is still
				// RETURNED: everything at or below it is provably canonical and must
				// keep its validity when the suffix above is neutralized.
				slog.Warn("poll anchor at this height matches the live chain, but rows above the deletion boundary sit at heights NO anchor covers, so a rewind to it would delete unprovable history; neutralizing the suffix above it instead",
					"engine", p.engine, "matchedBlock", a.BlockNumber, "boundary", boundary,
					"unanchoredRowsAbove", unanchored)
				return a.BlockNumber, floorUnverifiable, probes, nil
			}
			return a.BlockNumber, floorVerified, probes, nil
		}
		slog.Warn("poll anchor is ORPHANED: the live chain reports a different hash at that height, so this round's rows describe a replaced block",
			"engine", p.engine, "anchorBlock", a.BlockNumber, "recorded", fmt.Sprintf("%x", a.BlockHash),
			"live", live.Hex(), "endpoint", servedBy.Index)
		deepestChecked = a.BlockNumber
	}
	if !probeFailed && deepestChecked > 0 {
		// Every anchor in this page was checked and orphaned: it is safe to
		// continue BELOW them next Step. A page containing ANY failed probe leaves
		// the resume point alone, so the failed anchors are re-probed instead of
		// being skipped past unverified.
		p.probeResumeFrom, p.probeResumeSet = deepestChecked-1, true
	}
	return 0, floorUnprobed, probes, nil
}

// noteCheckpoint records the highest anchor height this verification pass has a
// LIVE answer for, together with the hash and the endpoint that answered — the
// reference every accumulated mismatch proof is revalidated against.
//
// It only ever moves UPWARD within a pass, because a hash at H entails the whole
// ancestry of H: a checkpoint higher than another one strictly covers it, and
// letting a later, deeper page overwrite it with a lower height would shrink the
// range the revalidation vouches for. Pages descend, so in practice this records
// the first successful probe of a pass and then re-records only when a re-probe
// reaches higher (which happens after a page whose top probe failed).
func (p *Poller) noteCheckpoint(block uint64, live []byte, endpoint int, generation int64) {
	if p.probeCheckpointSet && block <= p.probeCheckpointBlock {
		return
	}
	hash := make([]byte, len(live))
	copy(hash, live)
	if endpoint < 0 {
		endpoint = 0
	}
	p.probeCheckpointSet, p.probeCheckpointBlock = true, block
	p.probeCheckpointHash, p.probeCheckpointBy = hash, endpoint
	p.probeGeneration = generation
}

// checkpointStillHolds re-reads the verification checkpoint and reports whether
// the chain still gives the answer this pass's proofs were computed against. It is
// called IMMEDIATELY BEFORE the destructive (or validity-blessing) act, which is
// the only moment at which the question has an answer worth having: verification
// may have spanned many Steps and many minutes.
//
// Three outcomes, and only the first authorises anything:
//
//   - UNCHANGED — every proof at or below the checkpoint still holds, by hash
//     ancestry. Proceed.
//   - CHANGED — the chain moved again, so at least one proof may have flipped
//     (this is A1: a previously-mismatched anchor can be canonical again). The
//     accumulated state is DISCARDED and verification restarts from the newest
//     anchor; nothing is deleted this Step.
//   - UNREADABLE — the probe failed. That is not evidence either way, so it is
//     treated exactly like a failed anchor probe: refuse and retry, keeping the
//     paging state so the next Step continues rather than starting over.
//
// A pass with NO checkpoint (nothing was successfully probed, so no cached proof
// is being relied on) holds trivially.
func (p *Poller) checkpointStillHolds(ctx context.Context) (bool, string) {
	if !p.probeCheckpointSet {
		return true, ""
	}
	live, servedBy, err := p.chain.HeaderHashFrom(ctx, p.probeCheckpointBy, p.probeCheckpointBlock)
	if err != nil {
		return false, fmt.Sprintf("the verification checkpoint at block %d could not be re-read immediately before the repair (%v), so the anchor proofs at or below it cannot be shown to still hold",
			p.probeCheckpointBlock, err)
	}
	if !bytes.Equal(live.Bytes(), p.probeCheckpointHash) {
		why := fmt.Sprintf("the live chain now reports %s at the verification checkpoint (block %d) where it reported %x when this pass's anchor proofs were established, via endpoint %d: the chain moved AGAIN, so anchors this pass recorded as orphaned may be canonical once more",
			live.Hex(), p.probeCheckpointBlock, p.probeCheckpointHash, servedBy.Index)
		p.resetVerification(why)
		return false, why
	}
	return true, ""
}

// resetVerification discards the paging state and the checkpoint, so the next Step
// re-probes from the newest anchor. It is the "restart whenever the chain state the
// proofs were computed against changes" half of the temporal binding; the proofs
// themselves are not repaired, they are thrown away.
func (p *Poller) resetVerification(why string) {
	if p.probeResumeSet || p.probeCheckpointSet {
		slog.Warn("poll-anchor verification RESTARTS from the newest anchor: the chain state its accumulated mismatch proofs were computed against no longer holds, so those proofs are discarded rather than acted on",
			"engine", p.engine, "why", why, "resumeFrom", p.probeResumeFrom,
			"checkpointBlock", p.probeCheckpointBlock, "checkpointGeneration", p.probeGeneration)
	}
	p.probeResumeFrom, p.probeResumeSet = 0, false
	p.probeCheckpointSet, p.probeCheckpointBlock = false, 0
	p.probeCheckpointHash, p.probeCheckpointBy = nil, 0
	p.probeGeneration = 0
}

// neutralize answers the epoch WITHOUT deleting anything, for the one state where
// no evidence can ever settle whether the rows above the target are canonical.
//
// It is reached only from floorUnverifiable — that is, only after verification has
// established that the answer is UNOBTAINABLE rather than merely unavailable. A
// failed probe is the latter and retries; a row at a height whose block hash was
// never recorded is the former, and retrying it forever is the deadlock this
// closes: repair needed an anchor, adoption is refused while an epoch is pending
// (it would otherwise record a replacement block's hash), and the ack only ever
// advanced through repair. Nothing in the process could break that cycle, so poll
// ingestion stopped permanently after an upgrade-time reorg.
//
// store.NeutralizeUnverifiablePrices retains every row, marks the ones above the
// boundary so no usable-price read can return them and no later repair can verify
// them, drops the anchors above that boundary, resets the cursor and acks — in one
// transaction. A verified floor is honoured exactly as in a rewind: history proven
// canonical keeps its validity, and only the unprovable suffix is marked.
//
// WHAT THIS IS NOT: it is not a proof, and it is not free. The rows stay in the
// table as unusable artifacts, the affected assets have no usable price at those
// heights, and the poller's own invalid-answer condition keeps /readyz red until a
// valid observation lands at or above the highest neutralized height. That is the
// honest cost of the state, and it is paid once per epoch rather than forever.
func (p *Poller) neutralize(ctx context.Context, cursor, floor uint64, probes int) error {
	boundary, quarantined, err := p.store.NeutralizeUnverifiablePrices(ctx, p.engine, p.cfg.ChainID, cursor, floor)
	if err != nil {
		return fmt.Errorf("price poller %q: neutralize unverifiable prices above %d (verified floor %d): %w", p.engine, cursor, floor, err)
	}
	newCursor, found, err := p.store.DeriveCursor(ctx, p.engine)
	if err != nil {
		return fmt.Errorf("price poller %q: read cursor after neutralization: %w", p.engine, err)
	}
	if !found {
		return fmt.Errorf("price poller %q: cursor missing after NeutralizeUnverifiablePrices — store contract violated", p.engine)
	}
	slog.Warn("polled prices NEUTRALIZED rather than deleted after a reorg epoch: rows above the boundary sit at heights no poll anchor covers, so they can be neither proven canonical nor proven orphaned. Nothing was deleted; those rows are retained and marked unusable, everything at or below a verified floor keeps its validity, the epoch is acknowledged, and poll ingestion resumes at the new head",
		"engine", p.engine, "requestedTarget", cursor, "verifiedFloor", floor,
		"boundary", boundary, "cursor", newCursor, "rowsNeutralized", quarantined,
		"anchorProbes", probes)

	p.clearRepairState()
	p.rehydrateAfterUncertainty(ctx, "neutralization")
	return nil
}

// blockRepair records a refusal to repair destructively, with the evidence that
// is missing. It is deliberately not an error: erroring every Step would consume
// the daemon's retry backoff on a state that only an operator or a recovered
// endpoint can change, and the condition surface is where this belongs.
func (p *Poller) blockRepair(cursor uint64, outcome floorOutcome, probes int) {
	// Only floorUnprobed reaches here: it is the one outcome where the answer may
	// still arrive, so it is the one outcome worth waiting for. The states where no
	// answer can ever arrive are NEUTRALIZED instead of refused — a refusal nothing
	// can clear would be an outage rather than safety.
	why := "poll-anchor verification has not concluded"
	detail := "probes are still paging down through the retained anchors, or a probe FAILED and will be retried — and while any probe above a candidate floor is unproven, no lower match may authorise a deletion; nothing is deleted or acked until a hash match with complete proof above it, or a definite negative"
	if outcome != floorUnprobed {
		// Defensive: a future outcome added without a repair arm must not read as
		// "still probing".
		why = fmt.Sprintf("repair reached an unhandled verification outcome (%d)", outcome)
		detail = "this is a code defect; nothing was deleted or acked"
	}
	p.recordRepairRefusal(cursor, probes, why, detail)
}

// blockRepairOnCheckpoint records the refusal that closes A1's temporal hole: the
// verification checkpoint could not be re-read, or no longer holds, at the instant
// repair was about to act. Both are recoverable — a re-read succeeds later, and a
// discarded pass simply re-probes from the newest anchor — which is why this is a
// condition and a retry rather than an error.
func (p *Poller) blockRepairOnCheckpoint(cursor uint64, probes int, why string) {
	p.recordRepairRefusal(cursor, probes,
		"the live-chain checkpoint the anchor proofs were computed against did not hold immediately before the deletion",
		why+". Nothing was deleted or acked; verification re-runs against the chain as it now stands")
}

// recordRepairRefusal is the single place a standing repair refusal is composed and
// reported, so every refusal reaches ConditionPollRewindBlocked in the same shape
// and none of them can be an error that burns the daemon's retry backoff on a state
// only an operator or a recovered chain view can change.
func (p *Poller) recordRepairRefusal(cursor uint64, probes int, why, detail string) {
	reason := fmt.Sprintf("a reorg epoch on chain %d is pending and repair REFUSED to ack or delete: %s (cursor %d, probes this round %d). %s. Polled prices cannot be re-derived, so no price is applied until this resolves",
		p.cfg.ChainID, why, cursor, probes, detail)
	if p.rewindBlocked != reason {
		slog.Warn("price reorg repair BLOCKED and nothing was deleted: polled history cannot be re-polled, so an unverifiable rewind is refused rather than performed",
			"engine", p.engine, "chain", p.cfg.ChainID, "cursor", cursor,
			"why", why, "probesThisRound", probes, "resumeFrom", p.probeResumeFrom,
			"checkpointBlock", p.probeCheckpointBlock)
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

// clearRepairState drops the verification pass — paging cursor, checkpoint and
// generation stamp — along with any standing refusal. Called both when a repair
// completes and when no epoch is pending at all; in either case the previous
// refusal no longer describes reality and the next epoch must be verified from
// scratch rather than against a checkpoint from the last one.
func (p *Poller) clearRepairState() {
	p.probeResumeFrom, p.probeResumeSet = 0, false
	p.probeCheckpointSet, p.probeCheckpointBlock = false, 0
	p.probeCheckpointHash, p.probeCheckpointBy = nil, 0
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
