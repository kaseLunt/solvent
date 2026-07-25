package prices

// The CHAINLINK FEED deriver: a READER over committed raw_logs, not a walker.
// The four raw ether.fi-market aggregators are already ingested as
// `chainlink_feed` streams (config/contracts.json), so this worker's whole job
// is to read each window of AnswerUpdated logs back out in
// (block_number, log_index) order, map each emitting aggregator to its priced
// asset through the registry, and land the values as prices rows under
// "chainlink:<aggregator>".
//
// It deliberately MIRRORS internal/derive.Runner's Step shape rather than
// inventing a second one — same reorg-first ordering, same
// resume-from-the-cursor discipline, same commit-indeterminacy posture — but it
// is NOT a derive.Engine: it holds no per-account balance state, so it needs
// none of the BeginBatch/CommitBatch/Reset lifecycle, and derive.Engine's
// promoted/working layers would be dead weight. cmd/indexer already documented
// that split ("price derivation is Task 8's poller, not a derive.Engine").
//
// COMMIT INDETERMINACY, AND THE RESET CONTRACT IT FORCES. ApplyPrices returns its
// transaction Commit's error, so an error does NOT prove the batch failed to
// persist. The binding rule is therefore: NOTHING derived from a window may be
// retained in memory unless that window's commit was confirmed. Publication
// freshness is accordingly STAGED while decoding and merged only after a
// successful apply; after ANY apply-class error the staged state is discarded and
// freshness is RE-HYDRATED from durable truth (raw_logs), so neither the rollback
// world (memory describing a window absent from `prices`) nor the
// committed-with-lost-ack world (memory missing rows that did land) can leave a
// health verdict resting on a fiction.
//
// FRESHNESS IS DURABLE, NOT PROCESS MEMORY. Publication freshness is hydrated
// from the newest stored AnswerUpdated per aggregator BEFORE any staleness
// verdict is issued, and re-hydrated after every rewind. An earlier version kept
// it only in memory, so a restart met a caught-up cursor, replayed no older
// logs, treated every feed as "unobserved", measured it from a fresh liveSince —
// and reported a feed that had died BEFORE the restart as healthy for another
// full threshold. Rewind cleared the same state for the same effect.
//
// AND NO PROCESS CLOCK MAY TOUCH A TIMESTAMP VERDICT AT ALL. An implausible oracle
// timestamp was first CLAMPED to f.now() (so the same log re-clamped to a new
// process time on every hydration), then REFUSED against f.now() — which was
// durable only while wall-clock stayed behind the claimed time: the same persisted
// log was rejected before a restart and accepted after a later one, with no new
// durable fact anywhere. Both are gone. An oracle timestamp is now judged against
// the log's OWN raw_logs.ingested_at, so the verdict is a function of two persisted
// facts, and an accepted answer's freshness is capped at that ingestion time. See
// classifyUpdatedAt for the full argument and its one stated limit.
//
// PUBLISHING IS NOT THE SAME AS PUBLISHING SOMETHING USABLE. A stream emitting a
// non-positive answer every heartbeat is emitting; store.insertPrice quarantines
// the row so no consumer can select it, which protects consumers and says nothing
// about health. Freshness is therefore measured from the newest USABLE answer, and
// an unusable newest answer is reported as its own condition — so an aggregator
// answering zero forever fails readiness instead of looking perfectly fresh.
//
// STALENESS IS PER FEED. Each stream carries its own contractual heartbeat and
// its own declared operator grace in recon/feeds.json, and is judged against
// heartbeat+grace. One global bound (the retired SOLVENT_FEED_STALENESS, 26h) was
// PERMISSIVE, not conservative: the ETH/USD stream behind the weETH adapter is
// consumed with a 3600-second heartbeat by deployed code, so a stopped stream
// could evade a 26h signal for roughly 25h beyond its contractual bound.
//
// THE LIVENESS GATE IS ADVERSARIAL ABOUT ITS OWN DEPENDENCIES. A wall-clock
// staleness test is only meaningful once the deriver has confirmed it is at a
// live head, and the naive confirmation shares its dependency class with
// ingestion: if RPC and ingest freeze at the same height, the frontier gap stays
// small, the gate says "live", and wall-clock aging then marks EVERY feed stale —
// blaming four oracles for one RPC failure. Three defences: the head probe reads
// the header's own TIMESTAMP (a frozen node cannot make an old block claim to be
// recent), it is routed through an endpoint other than the one ingestion is
// pinned to, and a live verdict EXPIRES after liveVerdictTTL so repeated probe
// failures can no longer preserve it indefinitely. RPC/ingest lag is reported as
// its OWN condition, never as feed staleness.
//
// PHASE CHANGES: a Chainlink PROXY re-points aggregator() on a phase change, so
// the configured raw aggregator simply stops emitting. The deriver answers that
// with a WARN, a FAILED health condition, and a re-resolution of the proxy's
// aggregator() whose result is logged — and NOTHING ELSE. Config repair is manual
// by design.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

// decodeEngineChainlinkFeed is the DECODE REGISTRY key for the raw aggregators'
// topic set (internal/decode). It is deliberately distinct from the deriver's
// pseudo-engine CURSOR key (FeedCursorEngine): one names a topic table, the
// other names a row in derive_cursors, and conflating them is how a price
// cursor would collide with a derive engine's.
const decodeEngineChainlinkFeed = "chainlink_feed"

// liveSlackBlocks is how close the ingest frontier must be to the chain head
// before a staleness verdict is allowed. Below it we are in BACKFILL (or the
// walker is lagging), where every feed's newest observation is legitimately
// hours or years old and a wall-clock staleness test would fire on all of them
// at once — a false alarm on every feed is worse than no alarm.
//
// 64 blocks is ~13 minutes on Ethereum mainnet at 12s blocks, comfortably above
// the few blocks of drift a caught-up walker shows between daemon ticks (its
// cursor tracks head minus `confirmations`).
//
// It is NOT sufficient on its own: a frozen RPC and a frozen ingest pipeline can
// sit at the same old height with a small gap. headFreshnessBound is the check
// that catches that.
const liveSlackBlocks = 64

// headFreshnessBound is how old the HEAD BLOCK'S OWN TIMESTAMP may be before the
// deriver treats the RPC/ingest path — not the feeds — as the failing component.
// A node frozen on old state still answers with a plausible height, but the
// header it returns keeps claiming the time it was mined, which makes the
// freeze detectable.
//
// 10 minutes is ~50 mainnet blocks: far beyond ordinary head jitter, propagation
// delay or a brief reorg, and far below any feed's heartbeat, so this can never
// pre-empt a genuine publication verdict.
const headFreshnessBound = 10 * time.Minute

// headProbeInterval rate-limits the chain-head probe that decides "live head vs
// backfill". A caught-up deriver Steps every daemon tick, so probing on each one
// would add an RPC per tick for a telemetry signal measured in hours.
const headProbeInterval = time.Minute

// liveVerdictTTL bounds how long a cached "we are at live head" verdict survives
// WITHOUT a fresh confirming probe. Without it, one successful probe followed by
// unbounded probe failures preserved the live verdict forever — so the deriver
// kept aging feeds against wall clock while having no current evidence that it
// could see the chain at all, and reported the resulting staleness as a feed
// failure.
//
// Five probe intervals: long enough that a couple of transient RPC failures do
// not flip the verdict, short enough that a sustained outage is reclassified as
// OUR failure well inside the tightest configured heartbeat (3600s).
const liveVerdictTTL = 5 * headProbeInterval

// futureTimestampTolerance is how far AHEAD of the log's OWN DURABLE INGESTION
// TIME (raw_logs.ingested_at) an oracle-supplied updatedAt may sit and still be
// taken at face value. Ordinary causes — a node's clock a few seconds off, a block
// timestamp rounded forward — live well inside it; a value beyond it is not a
// clock artefact.
//
// It costs no freshness slack. An accepted answer's usable time is
// min(reported, ingested_at), so a within-tolerance future timestamp is capped at
// the durable observation rather than establishing a reference ahead of it. The
// earlier version compared against the process clock and accepted the reported
// time verbatim, which both suppressed staleness by up to this much AND changed
// its verdict across restarts as the clock approached the claimed time.
const futureTimestampTolerance = 2 * time.Minute

// reResolveInterval rate-limits the proxy aggregator() re-resolution while a
// stream STAYS stale. The first re-resolution happens on the transition into
// staleness; after that it repeats at most this often, so an operator who has
// not yet fixed the config gets a periodic reminder rather than one warning per
// daemon tick.
const reResolveInterval = time.Hour

// FeedStore is the feed deriver's store surface (*store.Store satisfies it):
// PriceStore plus the reads that bound a derivation window, supply it, and
// hydrate publication freshness from durable truth.
type FeedStore interface {
	PriceStore
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	RawLogsInRange(ctx context.Context, chainID uint64, addresses [][]byte, fromBlock, toBlock uint64) ([]store.RawLog, error)
	LatestLogsByTopic(ctx context.Context, chainID uint64, addresses [][]byte, topic0 []byte, throughBlock uint64) ([]store.RawLog, error)
}

var _ FeedStore = (*store.Store)(nil)

// Decoder is the decode surface (satisfied by *decode.Registry).
type Decoder interface {
	Decode(engine string, l store.RawLog) (decode.Event, bool, error)
}

var _ Decoder = (*decode.Registry)(nil)

// FeedConfig binds a FeedDeriver to one chain's chainlink_stream registry
// entries. Streams/Addresses/StartBlock/Window come from the config's
// `chainlink_feed` streams (derive.BuildRunnerSpecs already groups them), so the
// walker and the deriver read exactly the same address set.
//
// There is deliberately NO staleness field: each stream's threshold comes from
// its own registry entry (config.FeedOracle.StalenessThreshold), because a single
// value cannot be simultaneously correct for a 1h feed and a 24h one.
type FeedConfig struct {
	ChainID    uint64
	Streams    []string // ingest stream names whose cursors bound the derive frontier
	Addresses  [][]byte // the configured raw aggregators (raw 20-byte)
	StartBlock uint64   // min startBlock across the streams
	Window     uint64   // blocks per derivation window
}

// feedBinding is one aggregator's registry binding: which asset its answers
// price, at what scale, under which source, which proxy to re-resolve when it
// goes quiet, and — per feed — how long it may go quiet before that happens.
type feedBinding struct {
	Symbol     string
	Asset      common.Address
	Aggregator common.Address
	Proxy      common.Address
	Source     string
	Decimals   int32
	StartBlock uint64
	// Staleness is this feed's OWN threshold: its contractual heartbeat plus its
	// declared operator grace, both from recon/feeds.json.
	Staleness time.Duration
	Heartbeat time.Duration
	Grace     time.Duration
}

// FeedDeriver reads AnswerUpdated logs into prices rows under a pseudo-engine
// cursor.
type FeedDeriver struct {
	store  FeedStore
	dec    Decoder
	chain  FeedChain
	cfg    FeedConfig
	engine string // pseudo-engine cursor key AND the durable row owner

	byAggregator map[common.Address]feedBinding
	order        []common.Address // registry order, for deterministic logs
	sources      []string         // mechanism names this deriver writes
	now          clock

	// hydrated records whether lastSeen has been read back from durable
	// raw_logs. NO staleness verdict is issued until it has: an unhydrated
	// deriver cannot distinguish "never published" from "we have not looked".
	hydrated bool
	// hydratedThrough is the derive cursor the hydration was taken at, so a
	// moved cursor can be re-hydrated rather than trusted.
	hydratedThrough uint64
	// lastUsable holds each aggregator's newest CONFIRMED **usable**
	// AnswerUpdated.updatedAt — an answer that is both positive and carries a
	// plausible timestamp. Hydrated from durable logs, and thereafter advanced
	// only by windows whose apply COMMITTED (see Step's staging). An unusable
	// answer never lands here, so it can never refresh freshness.
	lastUsable map[common.Address]time.Time
	// invalidNewest / timestampFlawed name the aggregators whose NEWEST confirmed
	// answer cannot be used, and why: a non-positive value, or an updatedAt that
	// cannot establish a time. Each is reported as its own condition.
	invalidNewest   map[common.Address]string
	timestampFlawed map[common.Address]string
	// stale is the current per-aggregator verdict, and lastResolve records when
	// each verdict was last announced (rate-limiting the re-resolution).
	stale       map[common.Address]bool
	lastResolve map[common.Address]time.Time
	// liveSince is when the deriver last CONFIRMED it is at live head; zero
	// while it is in backfill. A feed that has published nothing since we went
	// live is measured against this, so a permanently dead feed is still caught
	// (its lastSeen would otherwise stay zero forever and read as "unknown").
	liveSince time.Time
	// lastProbe is when the head probe last RAN; lastLiveAt is when it last
	// CONFIRMED a live head (the TTL reference). lastLive caches the verdict.
	lastProbe  time.Time
	lastLiveAt time.Time
	lastLive   bool
	// lagReason is the current RPC/ingest-lag explanation, empty when the
	// deriver has current evidence that it can see a live head. It is reported
	// as its own condition, never folded into feed staleness.
	lagReason string
}

// NewFeedDeriver builds a FeedDeriver. The configured address set and the
// registry's chainlink_stream contracts must match EXACTLY, in both directions:
// a configured aggregator with no registry entry has no asset to price into
// (its logs would be ingested and silently dropped), and a registry aggregator
// with no configured stream is never ingested at all (its asset would silently
// have no stream prices). Either way the two artifacts disagree, and the only
// safe answer is to refuse at construction.
//
// A registry entry with no positive staleness threshold is refused for the same
// reason: config.LoadFeeds already requires heartbeat and grace per stream, so
// reaching here without one means the two layers disagree about what a stream is.
func NewFeedDeriver(st FeedStore, dec Decoder, ch FeedChain, feeds *config.Feeds, cfg FeedConfig) (*FeedDeriver, error) {
	if st == nil || dec == nil || ch == nil || feeds == nil {
		return nil, fmt.Errorf("feed deriver: store, decoder, chain and feed registry are all required")
	}
	if cfg.ChainID == 0 {
		return nil, fmt.Errorf("feed deriver: chain id is required")
	}
	if cfg.Window == 0 || len(cfg.Addresses) == 0 || len(cfg.Streams) == 0 || cfg.StartBlock == 0 {
		return nil, fmt.Errorf("feed deriver (chain %d): window, addresses, streams and start block are all required", cfg.ChainID)
	}

	configured := map[common.Address]bool{}
	for _, a := range cfg.Addresses {
		if len(a) != common.AddressLength {
			return nil, fmt.Errorf("feed deriver (chain %d): configured address %x is not a 20-byte address", cfg.ChainID, a)
		}
		configured[common.BytesToAddress(a)] = true
	}

	f := &FeedDeriver{
		store: st, dec: dec, chain: ch, cfg: cfg,
		engine:          FeedCursorEngine(cfg.ChainID),
		byAggregator:    map[common.Address]feedBinding{},
		now:             time.Now,
		lastUsable:      map[common.Address]time.Time{},
		invalidNewest:   map[common.Address]string{},
		timestampFlawed: map[common.Address]string{},
		stale:           map[common.Address]bool{},
		lastResolve:     map[common.Address]time.Time{},
	}
	for _, a := range feeds.StreamAssets(cfg.ChainID) {
		agg := a.Oracle.Contract
		if !configured[agg] {
			return nil, fmt.Errorf("feed deriver (chain %d): registry asset %s names aggregator %s, which no configured chainlink_feed stream ingests",
				cfg.ChainID, a.Symbol, agg)
		}
		threshold := a.Oracle.StalenessThreshold()
		if threshold <= 0 {
			return nil, fmt.Errorf("feed deriver (chain %d): registry asset %s declares no positive staleness threshold (heartbeat %s + grace %s) — a stream must state its own publication bound",
				cfg.ChainID, a.Symbol, a.Oracle.Heartbeat, a.Oracle.Grace)
		}
		// config.LoadFeeds already refused a duplicate aggregator per chain, so
		// this map is one-entry-per-aggregator by construction.
		f.byAggregator[agg] = feedBinding{
			Symbol: a.Symbol, Asset: a.Address, Aggregator: agg, Proxy: a.Oracle.Proxy,
			Source: ChainlinkSource(agg), Decimals: a.Oracle.PriceDecimals,
			StartBlock: a.Oracle.StartBlock, Staleness: threshold,
			Heartbeat: a.Oracle.Heartbeat, Grace: a.Oracle.Grace,
		}
		f.order = append(f.order, agg)
		f.sources = append(f.sources, ChainlinkSource(agg))
	}
	for agg := range configured {
		if _, ok := f.byAggregator[agg]; !ok {
			return nil, fmt.Errorf("feed deriver (chain %d): configured chainlink_feed stream on %s has no registry entry, so its logs would price nothing",
				cfg.ChainID, agg)
		}
	}
	if len(f.byAggregator) == 0 {
		return nil, fmt.Errorf("feed deriver: the feed registry declares no chainlink_stream assets on chain %d", cfg.ChainID)
	}
	return f, nil
}

// Name returns the deriver's pseudo-engine cursor key.
func (f *FeedDeriver) Name() string { return f.engine }

// Sources returns the prices.source values this deriver writes. It is NOT the
// rewind scope any more — RewindPrices scopes by owner engine, so a Chainlink
// phase update cannot orphan the rows of a retired aggregator.
func (f *FeedDeriver) Sources() []string { return f.sources }

// Thresholds returns each configured stream's own staleness threshold by symbol,
// for tests and operator introspection: the value that replaced one global bound.
func (f *FeedDeriver) Thresholds() map[string]time.Duration {
	out := make(map[string]time.Duration, len(f.order))
	for _, agg := range f.order {
		b := f.byAggregator[agg]
		out[b.Symbol] = b.Staleness
	}
	return out
}

// Conditions reports the deriver's named health conditions (empty = healthy).
// Publication staleness and RPC/ingest lag are SEPARATE conditions on purpose:
// they present with the same symptom (feeds appear to stop) and have opposite
// remedies (chase the oracle vs. fix our own dependency), so a blended verdict
// routes the operator to the wrong system.
func (f *FeedDeriver) Conditions() []Condition {
	var out []Condition
	if f.lagReason != "" {
		out = append(out, Condition{Name: ConditionRPCIngestLag, Reason: f.lagReason})
	}
	if !f.hydrated {
		out = append(out, Condition{
			Name: ConditionFeedFreshnessUnhydrated,
			Reason: fmt.Sprintf("per-aggregator publication freshness has not been hydrated from raw_logs (chain %d): no staleness verdict is being issued",
				f.cfg.ChainID),
		})
		return out
	}
	var stale, invalid, flawed []string
	for _, agg := range f.order {
		b := f.byAggregator[agg]
		if f.stale[agg] {
			stale = append(stale, fmt.Sprintf("%s(%s) threshold %s", b.Symbol, agg.Hex(), b.Staleness))
		}
		if reason, bad := f.invalidNewest[agg]; bad {
			invalid = append(invalid, fmt.Sprintf("%s(%s) %s", b.Symbol, agg.Hex(), reason))
		}
		if reason, bad := f.timestampFlawed[agg]; bad {
			flawed = append(flawed, fmt.Sprintf("%s(%s) %s", b.Symbol, agg.Hex(), reason))
		}
	}
	if len(stale) > 0 {
		sort.Strings(stale)
		out = append(out, Condition{
			Name:   ConditionFeedPublication,
			Reason: fmt.Sprintf("chainlink streams with no USABLE answer inside their own heartbeat+grace: %v", stale),
		})
	}
	// Validity and timestamp verdicts are facts about durable logs, not about
	// wall-clock aging, so unlike publication they are reported even in backfill
	// — where they describe the newest answer at or below the derive cursor.
	if len(invalid) > 0 {
		sort.Strings(invalid)
		out = append(out, Condition{
			Name:   ConditionFeedInvalidAnswer,
			Reason: fmt.Sprintf("chainlink streams whose NEWEST published answer is unusable (the stream is publishing; the number cannot be used): %v", invalid),
		})
	}
	if len(flawed) > 0 {
		sort.Strings(flawed)
		out = append(out, Condition{
			Name:   ConditionFeedTimestamp,
			Reason: fmt.Sprintf("chainlink streams whose NEWEST published answer carries an unusable updatedAt, so it establishes no freshness at all: %v", flawed),
		})
	}
	return out
}

// Health is the single-string view of Conditions, kept for the worker shape the
// daemon and the derivation runners share.
//
// UNHEALTHY names the stale aggregators (or the lagging dependency); it is
// RECOVERABLE — a resumed feed, or a confirmed live head, clears it.
func (f *FeedDeriver) Health() (healthy bool, reason string) {
	cs := f.Conditions()
	if len(cs) == 0 {
		return true, ""
	}
	return false, conditionsReason(cs)
}

// Step performs one bounded unit of feed derivation: answer any durable reorg
// epoch, then at most one window of AnswerUpdated logs decoded and applied. When
// already caught up to the ingest frontier it evaluates staleness instead.
//
// Returns advanced=false when caught up (or when ingestion has not started).
func (f *FeedDeriver) Step(ctx context.Context) (bool, error) {
	// Reorg coordination FIRST: a durable epoch must be acknowledged (and stale
	// derived rows deleted) before any further apply.
	unacked, err := f.store.HasUnackedReorg(ctx, f.engine, f.cfg.ChainID)
	if err != nil {
		return false, fmt.Errorf("feed deriver %q: unacked-reorg check: %w", f.engine, err)
	}
	if unacked {
		if err := f.rewind(ctx); err != nil {
			return false, err
		}
		return true, nil // rewound; the next Step derives from the fresh cursor
	}

	frontier, ok, err := f.ingestFrontier(ctx)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil // some stream has never ingested: no complete window exists yet
	}

	cursor, found, err := f.store.DeriveCursor(ctx, f.engine)
	if err != nil {
		return false, fmt.Errorf("feed deriver %q: read derive cursor: %w", f.engine, err)
	}
	// Hydration is keyed to the DURABLE cursor: before issuing any verdict, and
	// again whenever the cursor has moved since the last hydration, publication
	// freshness is read back from raw_logs.
	if err := f.hydrateFreshness(ctx, cursor, found); err != nil {
		return false, err
	}

	var from uint64
	if found {
		// Caught-up check BEFORE cursor+1: also guards the MaxUint64 wrap.
		if cursor >= frontier {
			f.evaluateStaleness(ctx, frontier, cursor)
			return false, nil
		}
		from = cursor + 1
	} else {
		from = f.cfg.StartBlock
	}
	if from > frontier {
		return false, nil
	}
	// Overflow-safe window cap (frontier >= from holds here; Window >= 1).
	to := frontier
	if delta := frontier - from; delta > f.cfg.Window-1 {
		to = from + f.cfg.Window - 1
	}

	logs, err := f.store.RawLogsInRange(ctx, f.cfg.ChainID, f.cfg.Addresses, from, to)
	if err != nil {
		return false, fmt.Errorf("feed deriver %q: read raw logs [%d,%d]: %w", f.engine, from, to, err)
	}

	set := newPriceSet()
	// STAGED, not applied: this window's freshness effects are held aside until
	// the commit is confirmed. Mutating committed state here — as an earlier
	// version did, inside this loop and before ApplyPrices — left memory
	// describing a window that may have rolled back, and kept health optimistic
	// while persisted ingestion was stalled.
	staged := map[common.Address]stagedAnswer{}
	for _, l := range logs {
		ev, known, err := f.dec.Decode(decodeEngineChainlinkFeed, l)
		if err != nil {
			return false, fmt.Errorf("feed deriver %q: decode log %x/%d at block %d: %w",
				f.engine, l.TxHash, l.LogIndex, l.BlockNumber, err)
		}
		if !known {
			continue // unallowlisted topic (e.g. NewRound): routine skip, never an error
		}
		answer, ok := ev.(decode.ChainlinkAnswerUpdated)
		if !ok {
			continue // a decoded aggregator event that carries no price
		}
		if len(l.Address) != common.AddressLength {
			return false, fmt.Errorf("feed deriver %q: stored log %x/%d has a %d-byte address",
				f.engine, l.TxHash, l.LogIndex, len(l.Address))
		}
		agg := common.BytesToAddress(l.Address)
		b, bound := f.byAggregator[agg]
		if !bound {
			// RawLogsInRange filters to exactly f.cfg.Addresses and construction
			// proved that set equals the registry's, so this is a store integrity
			// violation, not a routine skip.
			return false, fmt.Errorf("feed deriver %q: log %x/%d was emitted by %s, which is outside the requested address set",
				f.engine, l.TxHash, l.LogIndex, agg)
		}
		// The answer is recorded VERBATIM — including a non-positive one, which
		// store.insertPrice records as a QUARANTINED (valid=false) row so no
		// usable-price read can return it. This layer stores what the aggregator
		// published; judging it is the risk engine's job, and the store makes
		// sure an unusable fact cannot masquerade as a usable one. It does NOT
		// make it fresh, which is what f.stageObservation is careful about.
		set.add(store.PriceObservation{
			Asset:       b.Asset.Bytes(),
			Source:      b.Source,
			Price:       answer.Current,
			Decimals:    b.Decimals,
			BlockNumber: l.BlockNumber,
		})
		f.stageObservation(staged, agg, answer, l.IngestedAt)
	}

	res, err := f.store.ApplyPrices(ctx, f.engine, f.cfg.ChainID, set.observations(), to)
	if err != nil {
		// THE RESET CONTRACT: the staged freshness is dropped unmerged, and the
		// confirmed state is re-read from durable truth. This covers both
		// indeterminate worlds — a rolled-back transaction (memory must not
		// describe the window) and a commit whose acknowledgment was lost (memory
		// must pick up what actually landed) — without this layer needing to know
		// which one happened.
		f.discardAndRehydrate(ctx, "apply error")

		if errors.Is(err, store.ErrUnackedReorgEpoch) {
			// Reactive backstop: a walker rewind recorded an epoch after this
			// Step's proactive check.
			slog.Warn("feed price apply refused on an unacknowledged reorg epoch; rewinding prices",
				"engine", f.engine, "err", err)
			if rerr := f.rewind(ctx); rerr != nil {
				return false, errors.Join(err, rerr)
			}
			return true, nil
		}
		return false, fmt.Errorf("feed deriver %q: apply prices [%d,%d]: %w", f.engine, from, to, err)
	}

	// Commit confirmed: the staged window is now durable truth, so merge it.
	for agg, s := range staged {
		f.mergeObservation(agg, s)
	}
	f.hydratedThrough = to
	if len(set.observations()) > 0 && len(res.Inserted) == 0 {
		// The window committed and created nothing: every row was an idempotent
		// replay. Freshness still comes from the durable logs (which is why this
		// is not an error), but an operator should see that no new price row
		// exists — the same signal the poller's frozen-endpoint path reports.
		slog.Warn("feed window committed but inserted NO new price rows: every observation was an idempotent replay of an already-recorded fact",
			"engine", f.engine, "from", from, "to", to, "observations", len(set.observations()))
	}
	return true, nil
}

// answerVerdict is what ONE raw answer can honestly support: whether the VALUE is
// usable, whether the TIMESTAMP is usable, and — only when both are — the
// timestamp itself.
type answerVerdict struct {
	at            time.Time
	usable        bool
	invalidReason string
	timestampFlaw string
}

// stagedAnswer accumulates one aggregator's window, held aside until the commit is
// confirmed. It keeps TWO things apart on purpose:
//
//   - the newest USABLE answer's timestamp, which is what freshness is measured
//     from. An older good answer in the same window is a real durable observation
//     and must not be discarded because a later answer in that window was garbage.
//   - the flaw markers of the window's NEWEST answer in log order, which is what
//     the invalid/timestamp conditions describe.
type stagedAnswer struct {
	usableAt      time.Time
	hasUsable     bool
	invalidReason string
	timestampFlaw string
}

// stageObservation folds one AnswerUpdated into the caller's staging map. It never
// touches committed state.
//
// THE NEWEST ANSWER IS THE LAST ONE IN LOG ORDER, not the one with the largest
// reported timestamp. RawLogsInRange returns ascending (block_number, log_index) —
// the chain's own total order — so the last log for an aggregator is its newest
// answer. Ranking by reported timestamp instead would let an older block's larger
// updatedAt outrank the actual latest answer, and would disagree with hydration,
// which takes the newest LOG per aggregator.
func (f *FeedDeriver) stageObservation(staged map[common.Address]stagedAnswer, agg common.Address, answer decode.ChainlinkAnswerUpdated, observedAt time.Time) {
	v := f.classifyAnswer(agg, answer, observedAt)
	cur := staged[agg]
	// The newest answer seen so far owns the flaw markers, whatever its usability.
	cur.invalidReason, cur.timestampFlaw = v.invalidReason, v.timestampFlaw
	if v.usable && (!cur.hasUsable || v.at.After(cur.usableAt)) {
		cur.hasUsable, cur.usableAt = true, v.at
	}
	staged[agg] = cur
}

// classifyAnswer reduces one raw answer to what it can honestly support.
//
// Both judgements are functions of DURABLE data only — the log's contents and the
// log's own raw_logs.ingested_at — so they are identical on every re-decode,
// restart and rehydration. Neither the clamp-to-now version nor the
// refuse-against-wall-clock version had that property.
func (f *FeedDeriver) classifyAnswer(agg common.Address, answer decode.ChainlinkAnswerUpdated, observedAt time.Time) answerVerdict {
	var v answerVerdict
	if !usableAnswer(answer.Current) {
		value := "nil"
		if answer.Current != nil {
			value = answer.Current.String()
		}
		v.invalidReason = fmt.Sprintf("newest answer is %s, which is not a usable price", value)
		slog.Warn("chainlink answer is NON-POSITIVE: the stream is publishing but the number cannot be used, so it does not refresh this feed's freshness and is reported as its own unhealthy condition",
			"engine", f.engine, "aggregator", agg.Hex(), "answer", value)
	}
	at, flaw := f.classifyUpdatedAt(agg, answer.UpdatedAt, observedAt)
	v.timestampFlaw = flaw
	v.at = at
	v.usable = v.invalidReason == "" && v.timestampFlaw == ""
	return v
}

// classifyUpdatedAt decides whether an oracle-supplied unix second can serve as
// an observation time at all, and returns a REASON rather than a substitute when
// it cannot.
//
// AnswerUpdated.updatedAt is untrusted input to a health signal, and two shapes
// cannot be taken at face value:
//
//   - a value past int64 range would wrap NEGATIVE and read as a pre-1970 answer;
//   - a value implausibly far in the FUTURE would make now.Sub(ref) negative for
//     as long as it is ahead, suppressing every real stall until wall-clock
//     catches up.
//
// THE COMPARISON IS AGAINST THE LOG'S OWN DURABLE OBSERVATION TIME, not a clock.
// observedAt is raw_logs.ingested_at — the database time at which this exact log
// became durable — so the verdict is a function of two persisted facts: the same
// stored row yields the same verdict on every re-decode, restart and rehydration,
// whatever the wall clock says.
//
// THE ONE THING THAT CHANGES IT, stated because "durable" is not "immutable": a
// REWIND deletes the log and the walker re-ingests it, which assigns a new
// ingested_at. A previously implausible answer can therefore become acceptable
// after a rewind — but that is a genuinely NEW durable observation, not a clock
// drifting, and the cap below means acceptance still cannot place freshness ahead
// of that new observation. Replaying an already-stored log does NOT change it:
// SaveBatch inserts ON CONFLICT DO NOTHING, so the original stamp survives.
//
// Two earlier versions each failed a different half of that:
//
//   - CLAMPING the value to f.now() produced a process timestamp, so the same log
//     re-clamped to a new time on every hydration and repeated restarts kept a
//     malformed feed healthy indefinitely (round 2).
//   - REFUSING it against f.now() was durable only for as long as wall-clock
//     stayed behind the claimed time. The same persisted log was rejected before a
//     restart and ACCEPTED after a later one, once the clock had approached the
//     claimed timestamp — and acceptance then moved freshness to a future time,
//     greening readiness for the tolerance plus a full threshold window with no new
//     publication (round 3). No new durable fact had appeared; only the clock had
//     moved. Wave 3's claim that the same log always yields the same refusal was
//     false as implemented, and this is what makes it true.
//
// WHAT ACCEPTANCE YIELDS. An accepted answer's usable time is
// min(reported, observedAt): a publication legitimately precedes its ingestion, so
// the reported time normally wins, and where clock skew puts it slightly ahead the
// DURABLE observation time caps it. Freshness therefore can never run ahead of the
// moment the log became durable, which removes the future-suppression window
// entirely rather than bounding it.
//
// LIMIT, STATED PLAINLY: observedAt is when WE first stored the log, not when the
// block was mined. A log ingested long after its block (a deep backfill) carries a
// late observation time, so an updatedAt that is genuinely implausible relative to
// its BLOCK can still be plausible relative to its ingestion. That direction is
// safe for freshness — min() means such an answer is measured from the earlier
// reported time — and the reverse (rejecting a good answer) cannot happen, because
// ingestion never precedes publication by more than the tolerance unless a clock is
// wrong. Binding to the block's own timestamp would need a new durable column and
// a walker change to populate it; this uses a column migration 00001 already has.
func (f *FeedDeriver) classifyUpdatedAt(agg common.Address, updatedAt uint64, observedAt time.Time) (time.Time, string) {
	if updatedAt > math.MaxInt64 {
		slog.Warn("chainlink answer reports an OUT-OF-RANGE updatedAt; it establishes no observation time and is reported as an unhealthy condition rather than substituted with this process's clock",
			"engine", f.engine, "aggregator", agg.Hex(), "reported", updatedAt)
		return time.Time{}, fmt.Sprintf("updatedAt %d is outside int64 range, so it names no time", updatedAt)
	}
	reported := time.Unix(int64(updatedAt), 0).UTC()
	if observedAt.IsZero() {
		// A log with no durable ingestion time cannot be judged against one. The
		// column is NOT NULL with a default, so this means the log did not come from
		// storage; refusing is the only honest answer, and substituting a clock is
		// the defect this whole path exists to remove.
		slog.Warn("chainlink answer carries no durable ingestion time, so its updatedAt cannot be judged against a persisted observation; it establishes no observation time",
			"engine", f.engine, "aggregator", agg.Hex(), "reported", reported.Format(time.RFC3339))
		return time.Time{}, fmt.Sprintf("updatedAt %s cannot be judged: this log carries no durable ingestion time",
			reported.Format(time.RFC3339))
	}
	if ahead := reported.Sub(observedAt); ahead > futureTimestampTolerance {
		slog.Warn("chainlink answer reports an updatedAt implausibly far AHEAD OF ITS OWN DURABLE INGESTION TIME; it establishes no observation time. The comparison is against raw_logs.ingested_at rather than a clock, so this verdict does not change across restarts",
			"engine", f.engine, "aggregator", agg.Hex(),
			"reported", reported.Format(time.RFC3339), "ingestedAt", observedAt.Format(time.RFC3339),
			"ahead", ahead.Truncate(time.Second), "tolerance", futureTimestampTolerance)
		return time.Time{}, fmt.Sprintf("updatedAt %s is %s ahead of this log's durable ingestion time %s (tolerance %s)",
			reported.Format(time.RFC3339), ahead.Truncate(time.Second),
			observedAt.Format(time.RFC3339), futureTimestampTolerance)
	}
	if reported.After(observedAt) {
		// Within tolerance but still ahead: cap freshness at the durable fact.
		return observedAt.UTC(), ""
	}
	return reported, ""
}

// mergeObservation merges one CONFIRMED window into committed state.
//
// Only a USABLE answer moves lastUsable, and it moves it forward only. The flaw
// markers describe the window's NEWEST answer, so a newest answer that is fine
// clears them — which is what makes both conditions recoverable.
func (f *FeedDeriver) mergeObservation(agg common.Address, s stagedAnswer) {
	if s.hasUsable {
		if prev, ok := f.lastUsable[agg]; !ok || s.usableAt.After(prev) {
			f.lastUsable[agg] = s.usableAt
		}
	}
	markOrClear(f.invalidNewest, agg, s.invalidReason)
	markOrClear(f.timestampFlawed, agg, s.timestampFlaw)
}

// markOrClear records a non-empty reason for agg and removes the entry otherwise.
func markOrClear(m map[common.Address]string, agg common.Address, reason string) {
	if reason != "" {
		m[agg] = reason
		return
	}
	delete(m, agg)
}

// hydrateFreshness reads each aggregator's newest stored AnswerUpdated at or
// below the DURABLE derive cursor and rebuilds committed freshness from it. It
// runs before the first verdict and again whenever the cursor has moved since the
// last hydration without this process having observed the move (a restart, a
// rewind, or a commit whose acknowledgment was lost).
//
// Reading raw_logs rather than `prices` is deliberate: staleness asks "is this
// aggregator still PUBLISHING", which the presence of the log answers, and the
// oracle's own updatedAt lives in the log's data word — the prices table does not
// carry it. raw_logs is also the artifact the walker rewinds, so a hydrated
// verdict can never describe an orphaned block.
//
// DISCLOSED LIMIT of hydration, precisely. LatestLogsByTopic returns only the
// NEWEST log per aggregator, so when that newest answer is UNUSABLE, hydration
// cannot see an older usable one behind it — the aggregator comes back with a flaw
// marker and no usable reference, and its publication clock therefore restarts from
// liveSince. That sub-verdict IS resettable by restart. It is not a false-green,
// because the flaw marker itself is durable (the same log always decodes the same
// way) and unhealthy, so readiness stays red for as long as the newest answer is
// unusable — the publication verdict is redundant while that holds. Recovering the
// older usable timestamp would need a scan back through raw_logs per aggregator,
// which is deliberately not done here; the limit is stated instead of implied.
func (f *FeedDeriver) hydrateFreshness(ctx context.Context, cursor uint64, found bool) error {
	if f.hydrated && f.hydratedThrough == cursor {
		return nil
	}
	if !found {
		// No cursor: nothing has been derived, so there is nothing durable to
		// hydrate from and every feed is legitimately unobserved. This is a
		// COMPLETE hydration of an empty state, not an absence of one.
		f.resetObserved()
		f.hydrated, f.hydratedThrough = true, 0
		return nil
	}
	logs, err := f.store.LatestLogsByTopic(ctx, f.cfg.ChainID, f.cfg.Addresses,
		decode.ChainlinkAnswerUpdatedTopic0.Bytes(), cursor)
	if err != nil {
		f.hydrated = false
		return fmt.Errorf("feed deriver %q: hydrate publication freshness through %d: %w", f.engine, cursor, err)
	}
	// Hydration REBUILDS committed state from scratch, so an aggregator whose
	// newest surviving answer is usable loses its flaw markers and vice versa —
	// exactly the same rule mergeObservation applies, applied to the newest log
	// per aggregator that the store returned.
	usable := make(map[common.Address]time.Time, len(logs))
	invalid := map[common.Address]string{}
	flawed := map[common.Address]string{}
	for _, l := range logs {
		if len(l.Address) != common.AddressLength {
			return fmt.Errorf("feed deriver %q: stored log %x/%d has a %d-byte address",
				f.engine, l.TxHash, l.LogIndex, len(l.Address))
		}
		agg := common.BytesToAddress(l.Address)
		if _, bound := f.byAggregator[agg]; !bound {
			continue // filtered in SQL; belt and braces
		}
		ev, known, err := f.dec.Decode(decodeEngineChainlinkFeed, l)
		if err != nil {
			return fmt.Errorf("feed deriver %q: hydrate: decode log %x/%d at block %d: %w",
				f.engine, l.TxHash, l.LogIndex, l.BlockNumber, err)
		}
		if !known {
			continue
		}
		answer, ok := ev.(decode.ChainlinkAnswerUpdated)
		if !ok {
			continue
		}
		v := f.classifyAnswer(agg, answer, l.IngestedAt)
		if v.usable {
			usable[agg] = v.at
			continue
		}
		if v.invalidReason != "" {
			invalid[agg] = v.invalidReason
		}
		if v.timestampFlaw != "" {
			flawed[agg] = v.timestampFlaw
		}
	}
	f.lastUsable, f.invalidNewest, f.timestampFlawed = usable, invalid, flawed
	f.hydrated, f.hydratedThrough = true, cursor
	slog.Info("hydrated chainlink publication freshness from durable raw logs",
		"engine", f.engine, "throughBlock", cursor, "aggregatorsUsable", len(usable),
		"aggregatorsInvalidNewest", len(invalid), "aggregatorsTimestampFlawed", len(flawed),
		"aggregatorsConfigured", len(f.byAggregator))
	return nil
}

// resetObserved empties every committed observation cache. Used only where an
// EMPTY state is the complete, correct hydration (no derive cursor at all).
func (f *FeedDeriver) resetObserved() {
	f.lastUsable = map[common.Address]time.Time{}
	f.invalidNewest = map[common.Address]string{}
	f.timestampFlawed = map[common.Address]string{}
}

// discardAndRehydrate implements the apply-error reset contract: the caller's
// staged state is already dropped by not merging it, and committed freshness is
// re-read from durable truth. Clearing hydrated first means a FAILED re-read
// leaves the deriver issuing no staleness verdict at all (Conditions reports the
// unhydrated condition) rather than continuing from state whose relationship to
// storage is unknown.
func (f *FeedDeriver) discardAndRehydrate(ctx context.Context, why string) {
	f.hydrated = false
	cursor, found, err := f.store.DeriveCursor(ctx, f.engine)
	if err != nil {
		slog.Warn("could not re-read the derive cursor after an uncertain apply; no staleness verdict will be issued until hydration succeeds",
			"engine", f.engine, "why", why, "err", err)
		return
	}
	if err := f.hydrateFreshness(ctx, cursor, found); err != nil {
		slog.Warn("could not re-hydrate publication freshness after an uncertain apply; no staleness verdict will be issued until it succeeds",
			"engine", f.engine, "why", why, "err", err)
	}
}

// ingestFrontier returns the highest block through which EVERY one of the
// deriver's streams has ingested (min over their cursors): above it some
// stream's logs may be missing, and deriving a window with an incomplete address
// set would silently drop updates. ok=false when any stream has no cursor yet.
func (f *FeedDeriver) ingestFrontier(ctx context.Context) (uint64, bool, error) {
	var frontier uint64
	for i, stream := range f.cfg.Streams {
		cur, err := f.store.Cursor(ctx, stream)
		if err != nil {
			return 0, false, fmt.Errorf("feed deriver %q: read ingest cursor %q: %w", f.engine, stream, err)
		}
		if cur == nil {
			return 0, false, nil
		}
		if i == 0 || cur.Block < frontier {
			frontier = cur.Block
		}
	}
	return frontier, true, nil
}

// rewind acknowledges every reorg epoch on the deriver's chain: RewindPrices to
// its OWN cursor (the store lowers the target to the deepest unacknowledged
// rewound_to), then resume FROM THE CURSOR READ BACK — never the requested
// target. Bootstrap (no cursor on an epoch-carrying chain) targets
// StartBlock-1; StartBlock >= 1 is enforced by NewFeedDeriver.
//
// No verified floor is passed: unlike the poller, this deriver CAN re-derive
// whatever the rewind deleted, because its input (raw_logs) is itself rewound and
// re-ingested by the walker. Retaining rows it is about to rewrite would buy
// nothing and would need the same hash proof to be sound.
//
// Staleness tracking is RE-HYDRATED here rather than cleared. Clearing it was the
// blind spot: the timestamps it held may describe orphaned blocks, but discarding
// them made every feed "unobserved" and restarted the never-published grace
// window, so a feed that died before the rewind was reported healthy for another
// full threshold. Re-reading the newest surviving AnswerUpdated per aggregator at
// or below the new cursor is both orphan-free AND honest about a dead feed.
func (f *FeedDeriver) rewind(ctx context.Context) error {
	cursor, found, err := f.store.DeriveCursor(ctx, f.engine)
	if err != nil {
		return fmt.Errorf("feed deriver %q: read cursor before rewind: %w", f.engine, err)
	}
	target := f.cfg.StartBlock - 1
	if found {
		target = cursor
	}
	if err := f.store.RewindPrices(ctx, f.engine, f.cfg.ChainID, target, 0); err != nil {
		return fmt.Errorf("feed deriver %q: rewind prices to %d: %w", f.engine, target, err)
	}
	// The verdicts and their announcement rate-limits describe a window that may
	// no longer exist; the live/backfill verdict must be re-earned from a fresh
	// probe rather than inherited across a rewind.
	f.stale = map[common.Address]bool{}
	f.lastResolve = map[common.Address]time.Time{}
	f.liveSince = time.Time{}
	f.lastProbe = time.Time{}
	f.lastLiveAt = time.Time{}
	f.lastLive = false
	f.lagReason = ""

	newCursor, found, err := f.store.DeriveCursor(ctx, f.engine)
	if err != nil {
		return fmt.Errorf("feed deriver %q: read cursor after rewind: %w", f.engine, err)
	}
	if !found {
		return fmt.Errorf("feed deriver %q: cursor missing after RewindPrices — store contract violated", f.engine)
	}
	// Re-hydrate publication freshness at the NEW cursor. A failure leaves
	// hydrated=false, which suppresses verdicts instead of faking them.
	f.hydrated = false
	if err := f.hydrateFreshness(ctx, newCursor, true); err != nil {
		slog.Warn("could not re-hydrate publication freshness after a rewind; no staleness verdict will be issued until it succeeds",
			"engine", f.engine, "err", err)
	}
	slog.Warn("feed prices rewound after reorg epoch",
		"engine", f.engine, "requestedTarget", target, "cursor", newCursor,
		"sources", len(f.sources), "freshnessRehydrated", f.hydrated)
	return nil
}

// evaluateStaleness judges each configured stream against ITS OWN
// heartbeat-plus-grace, but ONLY once the deriver has current, independently
// obtained evidence that it is at a live head. Below liveSlackBlocks of the chain
// head we are in backfill, where every feed's newest answer is legitimately old
// and a wall-clock test would fire on all of them at once.
//
// The head probe is rate-limited (headProbeInterval) and its verdict cached, but
// the cache EXPIRES (liveVerdictTTL): a probe failure no longer preserves a live
// verdict indefinitely, which is what previously let wall-clock aging convert an
// RPC outage into four stale-feed reports. A stale verdict — expired, failing, or
// a head whose own header timestamp is old — is reported as
// ConditionRPCIngestLag and suppresses publication verdicts entirely, because
// with no view of the chain there is no basis for one.
func (f *FeedDeriver) evaluateStaleness(ctx context.Context, frontier, cursor uint64) {
	now := f.now()
	if f.lastProbe.IsZero() || now.Sub(f.lastProbe) >= headProbeInterval {
		f.probeHead(ctx, frontier)
	}
	// TTL: an unconfirmed live verdict expires regardless of why confirmation
	// stopped arriving.
	if f.lastLive && (f.lastLiveAt.IsZero() || now.Sub(f.lastLiveAt) > liveVerdictTTL) {
		slog.Warn("feed staleness: the cached live-head verdict EXPIRED without a fresh confirming probe; suspending publication verdicts and reporting this as RPC/ingest lag",
			"engine", f.engine, "lastConfirmed", f.lastLiveAt.Format(time.RFC3339), "ttl", liveVerdictTTL)
		f.lastLive = false
		f.liveSince = time.Time{}
		f.lagReason = fmt.Sprintf("no confirmed live head for %s (TTL %s) on chain %d: the head probe is not succeeding, so feed publication cannot be judged",
			now.Sub(f.lastLiveAt).Truncate(time.Second), liveVerdictTTL, f.cfg.ChainID)
	}
	if !f.lastLive || f.liveSince.IsZero() {
		return
	}
	if !f.hydrated {
		// Codex's binding order: hydrate BEFORE issuing any live verdict. Without
		// durable freshness a verdict would be measured from this process's own
		// start, which is exactly the restart blind spot.
		return
	}

	for _, agg := range f.order {
		b := f.byAggregator[agg]
		if b.StartBlock > cursor {
			continue // this stream's first answer is above what we have derived
		}
		// An OBSERVED feed is measured from its own newest USABLE answer — read
		// back from durable logs, so a restart cannot reset it, and never from an
		// unusable one, so a stream answering zero or carrying a broken timestamp
		// ages here exactly like a stream answering nothing. A feed we have never
		// usably observed is measured from the moment we went live instead:
		// "unknown" must not mean "forever fresh", or a feed with no usable
		// history at all would never be announced. liveSince is deliberately NOT
		// a floor under an observed timestamp — a stream whose last answer
		// predates the threshold is stale precisely because it is old, and
		// clamping it up to liveSince would suppress every genuine stall a
		// caught-up deriver can see.
		ref, observed := f.lastUsable[agg]
		if !observed {
			ref = f.liveSince
		}
		since := now.Sub(ref)
		if since <= b.Staleness {
			if f.stale[agg] {
				slog.Info("chainlink stream resumed publishing",
					"engine", f.engine, "symbol", b.Symbol, "aggregator", agg.Hex())
				f.stale[agg] = false
				delete(f.lastResolve, agg)
			}
			continue
		}
		announce := !f.stale[agg]
		if last, ok := f.lastResolve[agg]; ok && now.Sub(last) >= reResolveInterval {
			announce = true
		}
		f.stale[agg] = true
		if !announce {
			continue
		}
		slog.Warn("chainlink stream STALE: no AnswerUpdated within THIS feed's own heartbeat+grace — health check FAILED",
			"engine", f.engine, "symbol", b.Symbol, "aggregator", agg.Hex(),
			"asset", b.Asset.Hex(), "since", since.Truncate(time.Second),
			"heartbeat", b.Heartbeat, "grace", b.Grace, "threshold", b.Staleness,
			"lastObserved", f.lastSeenLabel(agg))
		f.lastResolve[agg] = now
		f.reResolveAggregator(ctx, b)
	}
}

// probeHead performs one head probe and updates the live/backfill verdict.
//
// Three independent things have to hold before the head counts as live:
//
//  1. the probe SUCCEEDS. A failure leaves the previous verdict standing for now
//     — staleness is an operator signal and an RPC hiccup should not flip it —
//     but the TTL in evaluateStaleness bounds how long that can last, which is
//     the fix for "repeated errors preserve lastLive forever".
//  2. the frontier is within liveSlackBlocks of the reported head. Otherwise we
//     are in backfill.
//  3. the head's OWN HEADER TIMESTAMP is recent (headFreshnessBound). This is
//     what catches the case the block-gap test cannot: an RPC endpoint and our
//     ingest pipeline frozen at the SAME old height, where the gap stays small
//     and everything looks caught up while the chain has moved on without us.
//
// The probe is routed one endpoint PAST the shared hint ingestion uses, so it
// does not ask the possibly-frozen node whether the node is frozen. With a single
// configured endpoint that independence is unavailable, and the header-timestamp
// check plus the TTL are the only guards — stated here rather than implied.
func (f *FeedDeriver) probeHead(ctx context.Context, frontier uint64) {
	now := f.now()
	f.lastProbe = now

	start, independent := 0, false
	if n := f.chain.EndpointCount(); n > 1 {
		start = (f.chain.ActiveEndpoint() + 1) % n
		independent = true
	}
	head, servedBy, err := f.chain.HeadFrom(ctx, start)
	if err != nil {
		slog.Warn("feed staleness: chain head probe failed; keeping the previous live/backfill verdict until the TTL expires",
			"engine", f.engine, "probedFrom", start, "independentlyRouted", independent, "err", err)
		return
	}

	headAge := now.Sub(time.Unix(int64(head.Time), 0).UTC())
	switch {
	case headAge > headFreshnessBound:
		// The endpoint answered, and its own header says the chain it can see is
		// old. That is OUR dependency failing, not the feeds'.
		if f.lastLive {
			slog.Warn("feed staleness: the probed head's own TIMESTAMP is stale, so the RPC view (and likely ingestion with it) is frozen — suspending publication verdicts and reporting RPC/ingest lag instead of blaming the feeds",
				"engine", f.engine, "head", head.Number, "headAge", headAge.Truncate(time.Second),
				"bound", headFreshnessBound, "endpoint", servedBy.Index, "independentlyRouted", independent)
		}
		f.lastLive = false
		f.liveSince = time.Time{}
		f.lagReason = fmt.Sprintf("the chain head reported for chain %d is %s old by its own header timestamp (bound %s, endpoint %d, independently routed %t): the RPC/ingest path is behind, so feed publication cannot be judged",
			f.cfg.ChainID, headAge.Truncate(time.Second), headFreshnessBound, servedBy.Index, independent)
	case head.Number < frontier || head.Number-frontier > liveSlackBlocks:
		if f.lastLive {
			slog.Info("feed staleness: no longer at live head; suspending staleness verdicts",
				"engine", f.engine, "head", head.Number, "frontier", frontier)
		}
		f.lastLive = false
		f.liveSince = time.Time{}
		f.lagReason = fmt.Sprintf("the ingest frontier %d is %d blocks behind the live head %d on chain %d (slack %d): this is backfill or ingest lag, not feed staleness",
			frontier, int64(head.Number)-int64(frontier), head.Number, f.cfg.ChainID, liveSlackBlocks)
	default:
		if !f.lastLive {
			f.liveSince = now
		}
		f.lastLive = true
		f.lastLiveAt = now
		f.lagReason = ""
	}
}

// lastSeenLabel renders an aggregator's last USABLE answer time for logs,
// distinguishing "no usable durable answer at or below the derive cursor" from a
// real timestamp, and naming the flaw when the newest answer is the unusable one.
func (f *FeedDeriver) lastSeenLabel(agg common.Address) string {
	if t, ok := f.lastUsable[agg]; ok {
		return t.Format(time.RFC3339)
	}
	if reason, bad := f.invalidNewest[agg]; bad {
		return "no usable AnswerUpdated at or below the derive cursor: " + reason
	}
	if reason, bad := f.timestampFlawed[agg]; bad {
		return "no usable AnswerUpdated at or below the derive cursor: " + reason
	}
	return "no stored AnswerUpdated at or below the derive cursor"
}

// reResolveAggregator reads aggregator() on the stream's Chainlink PROXY and
// logs what it finds — the recon phase-change caveat made actionable:
//
//   - a DIFFERENT address means the proxy has moved to a new phase and the
//     configured stream is on a dead one; the fix is a manual config +
//     registry update, and the log says exactly which address to put there.
//   - the SAME address means this is not a phase change: the aggregator itself
//     has stopped publishing, which is a different investigation.
//
// Auto-repointing is deliberately NOT implemented: silently re-aiming a walker
// at an address the operator never reviewed would let a compromised or wrong
// proxy redirect a money-adjacent feed. A failed re-resolution is logged and
// nothing else — it never fails the Step, because the staleness WARN and the
// failed health condition have already been raised.
func (f *FeedDeriver) reResolveAggregator(ctx context.Context, b feedBinding) {
	data, err := chainlinkProxyABI.Pack("aggregator")
	if err != nil {
		slog.Warn("feed staleness: could not pack aggregator() for re-resolution",
			"engine", f.engine, "symbol", b.Symbol, "proxy", b.Proxy.Hex(), "err", err)
		return
	}
	out, err := f.chain.Call(ctx, b.Proxy, data)
	if err != nil {
		slog.Warn("feed staleness: proxy aggregator() re-resolution failed; the stream stays STALE",
			"engine", f.engine, "symbol", b.Symbol, "proxy", b.Proxy.Hex(), "err", err)
		return
	}
	resolved, err := unpackAddress("aggregator", chainlinkProxyABI, out)
	if err != nil {
		slog.Warn("feed staleness: proxy aggregator() return did not decode; the stream stays STALE",
			"engine", f.engine, "symbol", b.Symbol, "proxy", b.Proxy.Hex(), "err", err)
		return
	}
	if resolved == b.Aggregator {
		slog.Warn("feed staleness: the proxy still points at the CONFIGURED aggregator, so this is not a phase change — the aggregator itself has stopped publishing",
			"engine", f.engine, "symbol", b.Symbol, "proxy", b.Proxy.Hex(), "aggregator", resolved.Hex())
		return
	}
	slog.Warn("feed staleness: the chainlink proxy has RE-POINTED to a new aggregator — the configured stream is on a dead phase. Update config/contracts.json AND recon/feeds.json manually; automatic re-pointing is a deliberate deferral",
		"engine", f.engine, "symbol", b.Symbol, "asset", b.Asset.Hex(), "proxy", b.Proxy.Hex(),
		"configuredAggregator", b.Aggregator.Hex(), "resolvedAggregator", resolved.Hex())
}
