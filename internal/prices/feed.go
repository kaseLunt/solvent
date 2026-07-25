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
	// lastSeen holds each aggregator's newest CONFIRMED AnswerUpdated.updatedAt:
	// hydrated from durable logs, and thereafter advanced only by windows whose
	// apply COMMITTED (see Step's staging).
	lastSeen map[common.Address]time.Time
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
		engine:       FeedCursorEngine(cfg.ChainID),
		byAggregator: map[common.Address]feedBinding{},
		now:          time.Now,
		lastSeen:     map[common.Address]time.Time{},
		stale:        map[common.Address]bool{},
		lastResolve:  map[common.Address]time.Time{},
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
	var stale []string
	for _, agg := range f.order {
		if f.stale[agg] {
			b := f.byAggregator[agg]
			stale = append(stale, fmt.Sprintf("%s(%s) threshold %s", b.Symbol, agg.Hex(), b.Staleness))
		}
	}
	if len(stale) > 0 {
		sort.Strings(stale)
		out = append(out, Condition{
			Name:   ConditionFeedPublication,
			Reason: fmt.Sprintf("chainlink streams past their own heartbeat+grace: %v", stale),
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
	// the commit is confirmed. Mutating f.lastSeen here — as an earlier version
	// did, inside this loop and before ApplyPrices — left memory describing a
	// window that may have rolled back, and kept health optimistic while
	// persisted ingestion was stalled.
	staged := map[common.Address]time.Time{}
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
		// sure an unusable fact cannot masquerade as a usable one.
		set.add(store.PriceObservation{
			Asset:       b.Asset.Bytes(),
			Source:      b.Source,
			Price:       answer.Current,
			Decimals:    b.Decimals,
			BlockNumber: l.BlockNumber,
		})
		f.stageObservation(staged, agg, answer.UpdatedAt)
	}

	if err := f.store.ApplyPrices(ctx, f.engine, f.cfg.ChainID, set.observations(), to); err != nil {
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
	for agg, t := range staged {
		f.observe(agg, t)
	}
	f.hydratedThrough = to
	return true, nil
}

// stageObservation records an aggregator's newest AnswerUpdated timestamp for
// THIS window, into the caller's staging map. It never touches committed state.
//
// AnswerUpdated.updatedAt is an ORACLE-SUPPLIED unix second, so it is untrusted
// input to a health signal. Two implausible shapes are clamped to the
// observation time instead of being taken at face value:
//
//   - a value past int64 range would wrap NEGATIVE and read as a pre-1970
//     answer, pinning the feed permanently stale;
//   - a FUTURE value would make now.Sub(ref) negative for as long as it is
//     ahead, suppressing every real stall until wall-clock catches up — a
//     single year-3000 timestamp would silence this feed for centuries.
//
// Clamping to now is the honest reading of both: we OBSERVED an answer now,
// whatever the answer claims about itself.
func (f *FeedDeriver) stageObservation(staged map[common.Address]time.Time, agg common.Address, updatedAt uint64) {
	t := f.clampUpdatedAt(agg, updatedAt)
	if prev, ok := staged[agg]; ok && !t.After(prev) {
		return
	}
	staged[agg] = t
}

// clampUpdatedAt turns an untrusted oracle timestamp into a usable observation
// time (see stageObservation for the reasoning).
func (f *FeedDeriver) clampUpdatedAt(agg common.Address, updatedAt uint64) time.Time {
	now := f.now()
	if updatedAt > math.MaxInt64 {
		slog.Warn("chainlink answer reports an out-of-range updatedAt; treating it as observed now for staleness purposes",
			"engine", f.engine, "aggregator", agg.Hex(), "reported", updatedAt)
		return now
	}
	reported := time.Unix(int64(updatedAt), 0).UTC()
	if reported.After(now) {
		slog.Warn("chainlink answer reports a FUTURE updatedAt; treating it as observed now for staleness purposes",
			"engine", f.engine, "aggregator", agg.Hex(), "reported", reported.Format(time.RFC3339))
		return now
	}
	return reported
}

// observe merges one CONFIRMED observation into committed freshness state,
// keeping the newest per aggregator.
func (f *FeedDeriver) observe(agg common.Address, t time.Time) {
	if prev, ok := f.lastSeen[agg]; ok && !t.After(prev) {
		return
	}
	f.lastSeen[agg] = t
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
func (f *FeedDeriver) hydrateFreshness(ctx context.Context, cursor uint64, found bool) error {
	if f.hydrated && f.hydratedThrough == cursor {
		return nil
	}
	if !found {
		// No cursor: nothing has been derived, so there is nothing durable to
		// hydrate from and every feed is legitimately unobserved. This is a
		// COMPLETE hydration of an empty state, not an absence of one.
		f.lastSeen = map[common.Address]time.Time{}
		f.hydrated, f.hydratedThrough = true, 0
		return nil
	}
	logs, err := f.store.LatestLogsByTopic(ctx, f.cfg.ChainID, f.cfg.Addresses,
		decode.ChainlinkAnswerUpdatedTopic0.Bytes(), cursor)
	if err != nil {
		f.hydrated = false
		return fmt.Errorf("feed deriver %q: hydrate publication freshness through %d: %w", f.engine, cursor, err)
	}
	fresh := make(map[common.Address]time.Time, len(logs))
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
		t := f.clampUpdatedAt(agg, answer.UpdatedAt)
		if prev, seen := fresh[agg]; seen && !t.After(prev) {
			continue
		}
		fresh[agg] = t
	}
	f.lastSeen = fresh
	f.hydrated, f.hydratedThrough = true, cursor
	slog.Info("hydrated chainlink publication freshness from durable raw logs",
		"engine", f.engine, "throughBlock", cursor, "aggregatorsObserved", len(fresh),
		"aggregatorsConfigured", len(f.byAggregator))
	return nil
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
		// An OBSERVED feed is measured from its own newest answer — now read back
		// from durable logs, so a restart cannot reset it. A feed we have never
		// observed is measured from the moment we went live instead: "unknown"
		// must not mean "forever fresh", or a feed with no history at all would
		// never be announced. liveSince is deliberately NOT a floor under an
		// observed timestamp — a stream whose last answer predates the threshold
		// is stale precisely because it is old, and clamping it up to liveSince
		// would suppress every genuine stall a caught-up deriver can see.
		ref, observed := f.lastSeen[agg]
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

// lastSeenLabel renders an aggregator's last observed answer time for logs,
// distinguishing "no durable answer at or below the derive cursor" from a real
// timestamp.
func (f *FeedDeriver) lastSeenLabel(agg common.Address) string {
	if t, ok := f.lastSeen[agg]; ok {
		return t.Format(time.RFC3339)
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
