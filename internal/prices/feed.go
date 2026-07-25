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
// COMMIT INDETERMINACY: ApplyPrices returns its transaction Commit's error, so
// an error does not prove the batch failed to persist. Nothing in-memory here is
// derived state that could silently desync — the next Step re-reads the cursor
// and resumes from wherever the store actually is — with ONE telemetry-only
// exception, documented at observe() below.
//
// STALENESS (the recon phase-change caveat, and the only reason this worker
// talks to an RPC endpoint at all): a Chainlink PROXY re-points aggregator() on
// a phase change, after which the configured raw aggregator simply stops
// emitting. The deriver answers that with a WARN, a FAILED health check, and a
// re-resolution of the proxy's aggregator() whose result is logged — and
// NOTHING ELSE. Config repair is manual by design.

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
const liveSlackBlocks = 64

// headProbeInterval rate-limits the chain-head probe that decides "live head vs
// backfill". A caught-up deriver Steps every daemon tick, so probing on each one
// would add an RPC per tick for a telemetry signal measured in hours.
const headProbeInterval = time.Minute

// reResolveInterval rate-limits the proxy aggregator() re-resolution while a
// stream STAYS stale. The first re-resolution happens on the transition into
// staleness; after that it repeats at most this often, so an operator who has
// not yet fixed the config gets a periodic reminder rather than one warning per
// daemon tick.
const reResolveInterval = time.Hour

// FeedStore is the feed deriver's store surface (*store.Store satisfies it):
// PriceStore plus the two reads that bound and supply a derivation window.
type FeedStore interface {
	PriceStore
	Cursor(ctx context.Context, stream string) (*store.CursorPos, error)
	RawLogsInRange(ctx context.Context, chainID uint64, addresses [][]byte, fromBlock, toBlock uint64) ([]store.RawLog, error)
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
type FeedConfig struct {
	ChainID    uint64
	Streams    []string // ingest stream names whose cursors bound the derive frontier
	Addresses  [][]byte // the configured raw aggregators (raw 20-byte)
	StartBlock uint64   // min startBlock across the streams
	Window     uint64   // blocks per derivation window
	Staleness  time.Duration
}

// feedBinding is one aggregator's registry binding: which asset its answers
// price, at what scale, under which source, and which proxy to re-resolve when
// it goes quiet.
type feedBinding struct {
	Symbol     string
	Asset      common.Address
	Aggregator common.Address
	Proxy      common.Address
	Source     string
	Decimals   int32
	StartBlock uint64
}

// FeedDeriver reads AnswerUpdated logs into prices rows under a pseudo-engine
// cursor.
type FeedDeriver struct {
	store  FeedStore
	dec    Decoder
	chain  FeedChain
	cfg    FeedConfig
	engine string // pseudo-engine cursor key

	byAggregator map[common.Address]feedBinding
	order        []common.Address // registry order, for deterministic logs
	sources      []string         // ownership scope handed to RewindPrices
	now          clock

	// lastSeen holds each aggregator's newest observed AnswerUpdated.updatedAt.
	// It is populated from DECODED LOGS (see observe) and cleared by a rewind,
	// whose orphaned blocks it would otherwise keep describing.
	lastSeen map[common.Address]time.Time
	// stale is the current per-aggregator verdict, and staleSince records when
	// each verdict was last announced (rate-limiting the re-resolution).
	stale       map[common.Address]bool
	lastResolve map[common.Address]time.Time
	// liveSince is when the deriver last CONFIRMED it is at live head; zero
	// while it is in backfill. A feed that has published nothing since we went
	// live is measured against this, so a permanently dead feed is still caught
	// (its lastSeen would otherwise stay zero forever and read as "unknown").
	liveSince time.Time
	// lastProbe rate-limits the head probe; lastHead/lastLive cache its verdict
	// between probes.
	lastProbe time.Time
	lastLive  bool
}

// NewFeedDeriver builds a FeedDeriver. The configured address set and the
// registry's chainlink_stream contracts must match EXACTLY, in both directions:
// a configured aggregator with no registry entry has no asset to price into
// (its logs would be ingested and silently dropped), and a registry aggregator
// with no configured stream is never ingested at all (its asset would silently
// have no stream prices). Either way the two artifacts disagree, and the only
// safe answer is to refuse at construction.
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
	if cfg.Staleness <= 0 {
		return nil, fmt.Errorf("feed deriver (chain %d): staleness threshold must be positive, got %s", cfg.ChainID, cfg.Staleness)
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
		// config.LoadFeeds already refused a duplicate aggregator per chain, so
		// this map is one-entry-per-aggregator by construction.
		f.byAggregator[agg] = feedBinding{
			Symbol: a.Symbol, Asset: a.Address, Aggregator: agg, Proxy: a.Oracle.Proxy,
			Source: ChainlinkSource(agg), Decimals: a.Oracle.PriceDecimals,
			StartBlock: a.Oracle.StartBlock,
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

// Sources returns the prices.source values this deriver owns.
func (f *FeedDeriver) Sources() []string { return f.sources }

// Health reports whether every configured stream is still publishing. UNHEALTHY
// names the stale aggregators; it is RECOVERABLE — a resumed feed clears it —
// and it is only ever set while the deriver has CONFIRMED it is at live head
// (see evaluateStaleness), so backfill never reports unhealthy.
func (f *FeedDeriver) Health() (healthy bool, reason string) {
	var stale []string
	for _, agg := range f.order {
		if f.stale[agg] {
			b := f.byAggregator[agg]
			stale = append(stale, fmt.Sprintf("%s(%s)", b.Symbol, agg.Hex()))
		}
	}
	if len(stale) == 0 {
		return true, ""
	}
	sort.Strings(stale)
	return false, fmt.Sprintf("chainlink streams stale for more than %s: %v", f.cfg.Staleness, stale)
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
		// store.insertPrice WARNs about. This layer stores what the aggregator
		// published; judging it is the risk engine's job.
		set.add(store.PriceObservation{
			Asset:       b.Asset.Bytes(),
			Source:      b.Source,
			Price:       answer.Current,
			Decimals:    b.Decimals,
			BlockNumber: l.BlockNumber,
		})
		f.observe(agg, answer.UpdatedAt)
	}

	if err := f.store.ApplyPrices(ctx, f.engine, f.cfg.ChainID, set.observations(), to); err != nil {
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
	return true, nil
}

// observe records an aggregator's newest AnswerUpdated timestamp.
//
// Tracking is fed from DECODED LOGS rather than from committed prices rows on
// purpose: staleness asks "is this aggregator still PUBLISHING?", and the
// presence of the log in raw_logs already answers that — whether our own apply
// transaction landed is a separate question. That also makes the signal immune
// to commit indeterminacy in the one direction that matters. The residual
// imprecision is telemetry-only and points the SAFE way: an apply error whose
// transaction actually failed leaves tracking optimistic for one window, so a
// genuine stall could be announced up to one window late, never suppressed
// permanently — the window is re-derived from the unmoved cursor on the next
// Step.
func (f *FeedDeriver) observe(agg common.Address, updatedAt uint64) {
	// AnswerUpdated.updatedAt is an ORACLE-SUPPLIED unix second, so it is
	// untrusted input to a health signal. Two implausible shapes are clamped to
	// the observation time instead of being taken at face value:
	//
	//   - a value past int64 range would wrap NEGATIVE and read as a pre-1970
	//     answer, pinning the feed permanently stale;
	//   - a FUTURE value would make now.Sub(ref) negative for as long as it is
	//     ahead, suppressing every real stall until wall-clock catches up — a
	//     single year-3000 timestamp would silence this feed for centuries.
	//
	// Clamping to now is the honest reading of both: we OBSERVED an answer now,
	// whatever the answer claims about itself.
	now := f.now()
	t := now
	if updatedAt <= math.MaxInt64 {
		if reported := time.Unix(int64(updatedAt), 0).UTC(); !reported.After(now) {
			t = reported
		} else {
			slog.Warn("chainlink answer reports a FUTURE updatedAt; treating it as observed now for staleness purposes",
				"engine", f.engine, "aggregator", agg.Hex(), "reported", reported.Format(time.RFC3339))
		}
	} else {
		slog.Warn("chainlink answer reports an out-of-range updatedAt; treating it as observed now for staleness purposes",
			"engine", f.engine, "aggregator", agg.Hex(), "reported", updatedAt)
	}
	if prev, ok := f.lastSeen[agg]; ok && !t.After(prev) {
		return
	}
	f.lastSeen[agg] = t
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
// Staleness tracking is CLEARED here: the timestamps it holds were read from
// logs at blocks the rewind may have orphaned, and re-derivation will re-observe
// whatever survived. The cleared liveSince also restarts the never-published
// grace window, which is the conservative direction (a dead feed is announced
// one threshold later, not never).
func (f *FeedDeriver) rewind(ctx context.Context) error {
	cursor, found, err := f.store.DeriveCursor(ctx, f.engine)
	if err != nil {
		return fmt.Errorf("feed deriver %q: read cursor before rewind: %w", f.engine, err)
	}
	target := f.cfg.StartBlock - 1
	if found {
		target = cursor
	}
	if err := f.store.RewindPrices(ctx, f.engine, f.cfg.ChainID, target, f.sources); err != nil {
		return fmt.Errorf("feed deriver %q: rewind prices to %d: %w", f.engine, target, err)
	}
	f.lastSeen = map[common.Address]time.Time{}
	f.stale = map[common.Address]bool{}
	f.lastResolve = map[common.Address]time.Time{}
	f.liveSince = time.Time{}
	f.lastProbe = time.Time{}
	f.lastLive = false

	newCursor, found, err := f.store.DeriveCursor(ctx, f.engine)
	if err != nil {
		return fmt.Errorf("feed deriver %q: read cursor after rewind: %w", f.engine, err)
	}
	if !found {
		return fmt.Errorf("feed deriver %q: cursor missing after RewindPrices — store contract violated", f.engine)
	}
	slog.Warn("feed prices rewound after reorg epoch",
		"engine", f.engine, "requestedTarget", target, "cursor", newCursor, "sources", len(f.sources))
	return nil
}

// evaluateStaleness judges each configured stream, but ONLY when the deriver has
// confirmed it is at live head: below liveSlackBlocks of the chain head we are in
// backfill, where every feed's newest answer is legitimately old and a wall-clock
// test would fire on all of them at once.
//
// The head probe is rate-limited (headProbeInterval) and its verdict cached; a
// probe FAILURE is WARNed and leaves the previous verdict standing rather than
// failing the Step — staleness is an operator signal, and letting an RPC hiccup
// either silence it or fake it would both be worse than holding the last known
// state.
func (f *FeedDeriver) evaluateStaleness(ctx context.Context, frontier, cursor uint64) {
	now := f.now()
	if f.lastProbe.IsZero() || now.Sub(f.lastProbe) >= headProbeInterval {
		head, err := f.chain.BlockNumber(ctx)
		f.lastProbe = now
		switch {
		case err != nil:
			slog.Warn("feed staleness: chain head probe failed; keeping the previous live/backfill verdict",
				"engine", f.engine, "err", err)
		case head < frontier || head-frontier > liveSlackBlocks:
			if f.lastLive {
				slog.Info("feed staleness: no longer at live head; suspending staleness verdicts",
					"engine", f.engine, "head", head, "frontier", frontier)
			}
			f.lastLive = false
			f.liveSince = time.Time{}
		default:
			if !f.lastLive {
				f.liveSince = now
			}
			f.lastLive = true
		}
	}
	if !f.lastLive || f.liveSince.IsZero() {
		return
	}

	for _, agg := range f.order {
		b := f.byAggregator[agg]
		if b.StartBlock > cursor {
			continue // this stream's first answer is above what we have derived
		}
		// An OBSERVED feed is measured from its own newest answer. A feed we
		// have never observed is measured from the moment we went live instead:
		// "unknown" must not mean "forever fresh", or a feed that died before
		// this process started would never be announced. liveSince is
		// deliberately NOT a floor under an observed timestamp — a stream whose
		// last answer predates the threshold is stale precisely because it is
		// old, and clamping it up to liveSince would suppress every genuine
		// stall a caught-up deriver can see.
		ref, observed := f.lastSeen[agg]
		if !observed {
			ref = f.liveSince
		}
		since := now.Sub(ref)
		if since <= f.cfg.Staleness {
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
		slog.Warn("chainlink stream STALE: no AnswerUpdated within the staleness threshold — health check FAILED",
			"engine", f.engine, "symbol", b.Symbol, "aggregator", agg.Hex(),
			"asset", b.Asset.Hex(), "since", since.Truncate(time.Second),
			"threshold", f.cfg.Staleness, "lastObserved", f.lastSeenLabel(agg))
		f.lastResolve[agg] = now
		f.reResolveAggregator(ctx, b)
	}
}

// lastSeenLabel renders an aggregator's last observed answer time for logs,
// distinguishing "never observed by this process" from a real timestamp.
func (f *FeedDeriver) lastSeenLabel(agg common.Address) string {
	if t, ok := f.lastSeen[agg]; ok {
		return t.Format(time.RFC3339)
	}
	return "never observed by this process"
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
// failed health check have already been raised.
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
