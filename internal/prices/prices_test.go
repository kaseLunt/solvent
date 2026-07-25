package prices

// Shared fakes and the package's foundational pins: function selectors (against
// keccak of the signature strings, plus the literals recon recorded
// independently), source naming, cursor-key namespacing, batch de-duplication,
// and the registry → poll-obligation resolution against the REAL
// recon/feeds.json.
//
// Multicall and view responses are built through the SAME ABI objects the
// production code decodes with, so a shape mismatch cannot hide behind a
// hand-rolled fixture. AnswerUpdated logs are decoded by the REAL
// decode.Registry (not a fake), so the topic0, the indexed int256 and the
// updatedAt word are all exercised for real.

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/chain"
	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// ---------------------------------------------------------------------------
// Registry fixtures.
// ---------------------------------------------------------------------------

var testChains = map[string]config.Chain{
	"op":  {ChainID: 10, RPCURLs: []string{"https://a.example"}},
	"eth": {ChainID: 1, RPCURLs: []string{"https://b.example"}},
}

// realFeeds loads the production registry — the artifact the daemon runs on.
func realFeeds(t *testing.T) *config.Feeds {
	t.Helper()
	feeds, err := config.LoadFeeds(filepath.Join("..", "..", "recon", "feeds.json"), testChains)
	require.NoError(t, err)
	return feeds
}

// Registry addresses used across the tests.
var (
	priceProviderV2 = common.HexToAddress("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB")
	weethETH        = common.HexToAddress("0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee")
	usdcETH         = common.HexToAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
	aggWeETH        = common.HexToAddress("0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5")
	aggUSDC         = common.HexToAddress("0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7")
	aggPYUSD        = common.HexToAddress("0x39E31761911b9aaBAEF5fb81B18Fd1C24a60E884")
	aggFRAX         = common.HexToAddress("0x8F73090a7c58B8BDcC9A93cBB6816e5cC4f01E8c")
	proxyWeETH      = common.HexToAddress("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419")
	proxyUSDC       = common.HexToAddress("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6")
)

// answerUpdatedTopic0 is the AnswerUpdated signature hash recon recorded
// independently (recon/derivation-notes.md "Oracle wiring").
var answerUpdatedTopic0 = common.HexToHash("0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f")

// ---------------------------------------------------------------------------
// Fake store.
// ---------------------------------------------------------------------------

type appliedBatch struct {
	engine  string
	chainID uint64
	obs     []store.PriceObservation
	through uint64
	anchor  *store.PollAnchor
}

type rewindRec struct {
	engine        string
	chainID       uint64
	toBlock       uint64
	verifiedFloor uint64
}

// fakeRow is one durably-recorded price row: what the store would carry, which
// is what the workers' health now reads back. The fake models this rather than
// just recording calls, because "health derives from durable truth, not process
// memory" cannot be tested against a fake that has no durable truth — and in
// particular because the whole frozen-endpoint finding is about a replay that
// COMMITS AND INSERTS NOTHING, which only a fake with real row identity can
// reproduce.
type fakeRow struct {
	owner         string
	asset         []byte
	source        string
	block         uint64
	observedAt    time.Time
	valid         bool
	invalidReason string
}

// key is the row's primary-key identity, the same one the real
// (chain_id, asset, source, block_number) unique index enforces.
func (r fakeRow) key() string { return fmt.Sprintf("%x/%s/%d", r.asset, r.source, r.block) }

// fakePriceStore models the durable surface both workers drive: a single
// pseudo-engine cursor, the unacked-epoch flag, owner-scoped price rows with
// their observation times, poll anchors, and the apply/rewind history.
type fakePriceStore struct {
	cursor      uint64
	cursorFound bool
	unacked     bool
	// maxEpoch is the chain's highest recorded reorg epoch — the GENERATION a
	// repair's cached anchor proofs are bound to. Tests bump it through
	// recordReorgEpoch to model a SECOND reorg landing while the first is still
	// unacknowledged, which is the only way a previously-mismatched anchor can become
	// canonical again.
	maxEpoch int64

	// now stamps observed_at, standing in for the database clock. Tests point it
	// at their testClock.
	now clock

	applied []appliedBatch
	rewinds []rewindRec

	// rows is the durable prices table, owner-scoped.
	rows []fakeRow
	// anchors is price_poll_anchors, keyed by engine, each carrying the database
	// timestamp of its insertion.
	anchors map[string][]store.StoredPollAnchor
	// adopted records every AdoptPollAnchor call that inserted, so a test can
	// prove the legacy policy ran (and on which blocks).
	adopted []uint64
	// adoptErr, when set, fails AdoptPollAnchor.
	adoptErr error
	// countErr / anchorReadErr fail the two reads reorg repair must have before it
	// may delete anything — the paths that must REFUSE rather than degrade.
	countErr      error
	anchorReadErr error
	// neutralizeErr fails NeutralizeUnverifiablePrices.
	neutralizeErr error
	// neutralizedStatsErr fails the backlog count. It is a read that must NOT be
	// able to take hydration (and with it the freshness verdict) down with it.
	neutralizedStatsErr error
	// neutralized records every NeutralizeUnverifiablePrices call, so a test can
	// tell "acked without deleting" from "deleted" — the distinction the
	// pending-epoch legacy state turns on.
	neutralized []rewindRec

	// applyErrs is a FIFO of one-shot ApplyPrices failures. A non-nil entry is
	// returned instead of applying; applyAdvancesDespiteErr models the
	// commit-landed-with-lost-ack world (cursor AND rows land, the ack is lost).
	applyErrs               []error
	applyAdvancesDespiteErr bool
	// unackedAfterApply models a walker rewind recording an epoch BETWEEN the
	// worker's proactive check and its apply: the flag flips only once the apply
	// has failed.
	unackedAfterApply bool
	// enforceCursorMonotonic models the real store's monotonic cursor guard rather
	// than scripting the refusal: a batch whose through-block is BELOW the recorded
	// cursor is refused with ErrDeriveCursorRegression, and an equal-height batch
	// commits idempotently. Tests about a frozen endpoint need the guard itself,
	// because scripting the error would presuppose the very classification the
	// poller is supposed to derive.
	enforceCursorMonotonic bool

	// freshnessErr, when set, fails LatestPriceFreshness after freshnessErrAfter
	// successful calls — the "cannot hydrate" path that must degrade to an
	// untrusted verdict rather than to green.
	freshnessErr      error
	freshnessErrAfter int
	// latestLogsErr, when set, fails LatestLogsByTopic after latestLogsErrAfter
	// successful calls.
	latestLogsErr      error
	latestLogsErrAfter int
	// freshnessCalls counts hydration reads.
	freshnessCalls int
	// latestLogCalls records the through-block of each publication-freshness
	// hydration.
	latestLogCalls []uint64

	// rewindDeepTo, when set, lowers the effective target to
	// min(requested, rewindDeepTo) — RewindPrices' deepest-unacked-epoch
	// lowering — BEFORE the verified floor raises it back.
	rewindDeepTo *uint64
	// repairLeavesNoCursor models the store-contract violation the workers assert
	// against: a reorg-answering call that commits without leaving a cursor. It
	// applies to BOTH primitives, because both workers read the cursor back and
	// both must refuse to guess when it is missing.
	repairLeavesNoCursor bool

	ingest map[string]*store.CursorPos
	logs   []store.RawLog
	// logsWithoutIngestionTime suppresses the ingested_at stamp storedLogs applies,
	// so a test can exercise the refusal path for a log carrying no durable
	// observation time. The real column is NOT NULL, so this is a deliberately
	// impossible row used to prove the guard exists.
	logsWithoutIngestionTime bool

	rawLogsCalls [][2]uint64
}

func newFakePriceStore() *fakePriceStore {
	return &fakePriceStore{
		ingest:  map[string]*store.CursorPos{},
		anchors: map[string][]store.StoredPollAnchor{},
		now:     time.Now,
	}
}

func (f *fakePriceStore) DeriveCursor(context.Context, string) (uint64, bool, error) {
	return f.cursor, f.cursorFound, nil
}

func (f *fakePriceStore) HasUnackedReorg(context.Context, string, uint64) (bool, error) {
	return f.unacked, nil
}

// reorgGeneration is the chain's max reorg epoch as the real store would report it.
//
// An unacknowledged epoch cannot exist without an epoch ROW, and the real
// HasUnackedReorg returns false outright when MAX(epoch) is 0 — so `unacked = true`
// with generation 0 is a state the store cannot be in, and a fake reporting it would
// let a test pass against an impossible world. Hence the floor of 1.
func (f *fakePriceStore) reorgGeneration() int64 {
	if f.unacked && f.maxEpoch < 1 {
		return 1
	}
	return f.maxEpoch
}

// recordReorgEpoch models the walker recording ANOTHER reorg on this chain: one more
// row in reorg_epochs, so the chain's generation advances and the epoch is (still)
// unacknowledged. Every anchor proof a repair computed under the previous generation
// describes a chain that has since been replaced again.
func (f *fakePriceStore) recordReorgEpoch() {
	f.maxEpoch = f.reorgGeneration() + 1
	f.unacked = true
}

func (f *fakePriceStore) ApplyPrices(_ context.Context, engine string, chainID uint64, obs []store.PriceObservation, through uint64) (store.ApplyResult, error) {
	return f.apply(engine, chainID, obs, through, nil)
}

func (f *fakePriceStore) ApplyPolledPrices(_ context.Context, engine string, chainID uint64, obs []store.PriceObservation, through uint64, anchor store.PollAnchor) (store.ApplyResult, error) {
	return f.apply(engine, chainID, obs, through, &anchor)
}

func (f *fakePriceStore) apply(engine string, chainID uint64, obs []store.PriceObservation, through uint64, anchor *store.PollAnchor) (store.ApplyResult, error) {
	f.applied = append(f.applied, appliedBatch{
		engine: engine, chainID: chainID, obs: obs, through: through, anchor: anchor,
	})
	if len(f.applyErrs) > 0 {
		err := f.applyErrs[0]
		f.applyErrs = f.applyErrs[1:]
		if err != nil {
			if f.applyAdvancesDespiteErr {
				f.commit(engine, obs, through, anchor)
			}
			if f.unackedAfterApply {
				f.unacked = true
			}
			// The real store discards the result when Commit errors: a caller must
			// not treat rows it cannot confirm as durable facts.
			return store.ApplyResult{}, err
		}
	}
	if f.enforceCursorMonotonic && f.cursorFound && through < f.cursor {
		return store.ApplyResult{}, fmt.Errorf("%w: engine %q refused move to %d (cursor at %d)",
			store.ErrDeriveCursorRegression, engine, through, f.cursor)
	}
	return f.commit(engine, obs, through, anchor), nil
}

// commit lands a batch durably — rows, anchor, cursor, the same atomic unit the
// real store commits — and reports what it ACTUALLY INSERTED.
//
// The idempotency is the load-bearing part of this fake. A row whose
// (asset, source, block) identity already exists is NOT inserted again and does
// NOT appear in the result, and neither does a replayed (engine, block) anchor.
// That is exactly what an rpc endpoint frozen at the cursor produces every
// interval, and a fake that appended blindly could not express it.
func (f *fakePriceStore) commit(engine string, obs []store.PriceObservation, through uint64, anchor *store.PollAnchor) store.ApplyResult {
	at := f.now()
	existing := map[string]bool{}
	for _, r := range f.rows {
		if r.owner == engine {
			existing[r.key()] = true
		}
	}
	var res store.ApplyResult
	for _, o := range obs {
		valid := o.Price != nil && o.Price.Sign() > 0
		reason := ""
		if !valid {
			reason = "non-positive oracle answer"
		}
		row := fakeRow{
			owner: engine, asset: o.Asset, source: o.Source, block: o.BlockNumber,
			observedAt: at, valid: valid, invalidReason: reason,
		}
		if existing[row.key()] {
			// A NEUTRALIZED row is SUPERSEDED by a fresh observation at the same
			// identity rather than treated as an idempotent replay: the recorded
			// value was already declared unplaceable, so the new one is
			// authoritative. Modelled here because the real store does it, and a
			// fake that treated it as a replay would hide the divergence wedge that
			// arm exists to prevent.
			superseded := false
			for i := range f.rows {
				ex := &f.rows[i]
				if ex.owner != engine || ex.key() != row.key() {
					continue
				}
				if ex.invalidReason != store.InvalidReasonUnverifiableReorg {
					break
				}
				ex.valid, ex.invalidReason, ex.observedAt = valid, reason, at
				superseded = true
				break
			}
			if !superseded {
				continue // idempotent replay: nothing new exists
			}
			res.Inserted = append(res.Inserted, store.PriceInsert{
				Asset: o.Asset, Source: o.Source, BlockNumber: o.BlockNumber,
				ObservedAt: at, Valid: valid, InvalidReason: reason,
			})
			continue
		}
		existing[row.key()] = true
		f.rows = append(f.rows, row)
		res.Inserted = append(res.Inserted, store.PriceInsert{
			Asset: o.Asset, Source: o.Source, BlockNumber: o.BlockNumber,
			ObservedAt: at, Valid: valid, InvalidReason: reason,
		})
	}
	if anchor != nil {
		res.AnchorBlock = anchor.BlockNumber
		known := false
		for _, a := range f.anchors[engine] {
			if a.BlockNumber == anchor.BlockNumber {
				known = true
				break
			}
		}
		if !known {
			f.anchors[engine] = append(f.anchors[engine], store.StoredPollAnchor{
				PollAnchor: *anchor, ObservedAt: at,
			})
			res.AnchorInserted, res.AnchorObservedAt = true, at
		}
	}
	f.cursor, f.cursorFound = through, true
	return res
}

func (f *fakePriceStore) RewindPrices(_ context.Context, engine string, chainID, toBlock, verifiedFloor uint64) error {
	f.rewinds = append(f.rewinds, rewindRec{
		engine: engine, chainID: chainID, toBlock: toBlock, verifiedFloor: verifiedFloor,
	})
	effective := f.effectiveRewindTarget(toBlock)
	// The verified floor RAISES the target back up (never above toBlock, which
	// the real store refuses outright).
	if verifiedFloor > effective {
		effective = verifiedFloor
	}
	// Owner-scoped deletion, plus the anchors describing the deleted rounds. A row
	// already marked unverifiable-after-reorg is RETAINED, exactly as the real
	// DELETE's predicate does: it was kept once because nothing could place it on a
	// chain, and a later rewind has no more evidence than the first one did.
	var kept []fakeRow
	for _, r := range f.rows {
		if r.owner == engine && r.block > effective && r.invalidReason != store.InvalidReasonUnverifiableReorg {
			continue
		}
		kept = append(kept, r)
	}
	f.rows = kept
	var keptAnchors []store.StoredPollAnchor
	for _, a := range f.anchors[engine] {
		if a.BlockNumber > effective {
			continue
		}
		keptAnchors = append(keptAnchors, a)
	}
	f.anchors[engine] = keptAnchors

	f.unacked = false // RewindPrices acks every epoch on the chain
	if f.repairLeavesNoCursor {
		f.cursorFound = false
		return nil
	}
	f.cursor, f.cursorFound = effective, true
	return nil
}

// LatestPriceFreshness mirrors the real query's two answers per key: the newest
// row of ANY validity, and the newest VALID row. Modelling both is what lets a
// test show that an oracle answering zero every interval stops being "fresh".
func (f *fakePriceStore) LatestPriceFreshness(_ context.Context, _ uint64, ownerEngine string) ([]store.PriceFreshness, error) {
	f.freshnessCalls++
	if f.freshnessErr != nil && f.freshnessCalls > f.freshnessErrAfter {
		return nil, f.freshnessErr
	}
	newest := map[string]store.PriceFreshness{}
	for _, r := range f.rows {
		if r.owner != ownerEngine {
			continue
		}
		k := freshnessKey(r.asset, r.source)
		cur, seen := newest[k]
		if !seen {
			cur = store.PriceFreshness{Asset: r.asset, Source: r.source}
		}
		if !seen || r.block > cur.BlockNumber {
			cur.BlockNumber, cur.ObservedAt = r.block, r.observedAt
			cur.Valid, cur.InvalidReason = r.valid, r.invalidReason
		}
		if r.valid && (!cur.HasValid || r.block > cur.ValidBlockNumber) {
			cur.HasValid = true
			cur.ValidBlockNumber, cur.ValidObservedAt = r.block, r.observedAt
		}
		newest[k] = cur
	}
	out := make([]store.PriceFreshness, 0, len(newest))
	for _, v := range newest {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Source+string(out[i].Asset) < out[j].Source+string(out[j].Asset) })
	return out, nil
}

func (f *fakePriceStore) PollAnchorsBelow(_ context.Context, engine string, _ uint64, belowOrAt uint64, limit int) ([]store.StoredPollAnchor, error) {
	if f.anchorReadErr != nil {
		return nil, f.anchorReadErr
	}
	var out []store.StoredPollAnchor
	for _, a := range f.anchors[engine] {
		if a.BlockNumber <= belowOrAt {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].BlockNumber > out[j].BlockNumber })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakePriceStore) NewestPollAnchor(_ context.Context, engine string, _ uint64) (store.StoredPollAnchor, bool, error) {
	if f.anchorReadErr != nil {
		return store.StoredPollAnchor{}, false, f.anchorReadErr
	}
	var best store.StoredPollAnchor
	found := false
	for _, a := range f.anchors[engine] {
		if !found || a.BlockNumber > best.BlockNumber {
			best, found = a, true
		}
	}
	return best, found, nil
}

func (f *fakePriceStore) CountOwnedPricesAbove(_ context.Context, engine string, _ uint64, above uint64) (int64, error) {
	if f.countErr != nil {
		return 0, f.countErr
	}
	var n int64
	for _, r := range f.rows {
		if r.owner == engine && r.block > above && r.invalidReason != store.InvalidReasonUnverifiableReorg {
			n++
		}
	}
	return n, nil
}

// effectiveRewindTarget mirrors the store's own lowering of a caller's target to
// the deepest unacknowledged rewound_to (modelled by rewindDeepTo). Every fake path
// that acts "above the target" goes through this, so RewindPrices,
// NeutralizeUnverifiablePrices and PriceRepairExposure cannot disagree about where
// the boundary is — which is precisely the disagreement that made the pending-epoch
// legacy state undecidable in the real code.
func (f *fakePriceStore) effectiveRewindTarget(toBlock uint64) uint64 {
	if f.rewindDeepTo != nil && *f.rewindDeepTo < toBlock {
		return *f.rewindDeepTo
	}
	return toBlock
}

func (f *fakePriceStore) anchoredHeights(engine string) map[uint64]bool {
	out := map[uint64]bool{}
	for _, a := range f.anchors[engine] {
		out[a.BlockNumber] = true
	}
	return out
}

// CountUnanchoredPricesAbove mirrors the real read: owned rows above the boundary
// at heights no surviving anchor covers, excluding rows already neutralized.
func (f *fakePriceStore) CountUnanchoredPricesAbove(_ context.Context, engine string, _ uint64, above uint64) (int64, error) {
	if f.countErr != nil {
		return 0, f.countErr
	}
	anchored := f.anchoredHeights(engine)
	var n int64
	for _, r := range f.rows {
		if r.owner != engine || r.block <= above || anchored[r.block] {
			continue
		}
		if r.invalidReason == store.InvalidReasonUnverifiableReorg {
			continue
		}
		n++
	}
	return n, nil
}

// PriceRepairExposure reports the boundary a rewind would act above together with
// what lies above it — the four facts repair needs in one instant.
func (f *fakePriceStore) PriceRepairExposure(_ context.Context, engine string, _ uint64, toBlock uint64) (store.PriceRepairExposure, error) {
	if f.countErr != nil {
		return store.PriceRepairExposure{}, f.countErr
	}
	exp := store.PriceRepairExposure{
		EffectiveTarget: f.effectiveRewindTarget(toBlock),
		ReorgGeneration: f.reorgGeneration(),
	}
	anchored := f.anchoredHeights(engine)
	for _, r := range f.rows {
		if r.owner != engine || r.block <= exp.EffectiveTarget {
			continue
		}
		if r.invalidReason == store.InvalidReasonUnverifiableReorg {
			continue
		}
		exp.Owned++
		if !anchored[r.block] {
			exp.Unanchored++
		}
	}
	for _, a := range f.anchors[engine] {
		if a.BlockNumber > exp.EffectiveTarget {
			exp.AnchoredHeights++
		}
	}
	return exp, nil
}

// NeutralizeUnverifiablePrices models the real transaction: RETAIN every row above
// the effective target and mark it, drop the anchors above it, reset the cursor and
// ack. Nothing is deleted — a fake that deleted here could not distinguish this
// path from a rewind, which is the whole point of the distinction.
func (f *fakePriceStore) NeutralizeUnverifiablePrices(_ context.Context, engine string, chainID, toBlock, verifiedFloor uint64) (uint64, int64, error) {
	if f.neutralizeErr != nil {
		return 0, 0, f.neutralizeErr
	}
	target := f.effectiveRewindTarget(toBlock)
	// The verified floor RAISES the boundary, exactly as in RewindPrices: history
	// proven canonical keeps its validity and only the unprovable suffix is marked.
	if verifiedFloor > target {
		target = verifiedFloor
	}
	f.neutralized = append(f.neutralized, rewindRec{
		engine: engine, chainID: chainID, toBlock: toBlock, verifiedFloor: verifiedFloor,
	})
	var marked int64
	for i := range f.rows {
		r := &f.rows[i]
		// Mirrors the real predicate exactly: only rows that are still READABLE are
		// marked, so a row already quarantined for another reason keeps that reason
		// and is not counted as reorg fallout.
		if r.owner != engine || r.block <= target || !r.valid {
			continue
		}
		r.valid, r.invalidReason = false, store.InvalidReasonUnverifiableReorg
		marked++
	}
	var keptAnchors []store.StoredPollAnchor
	for _, a := range f.anchors[engine] {
		if a.BlockNumber > target {
			continue
		}
		keptAnchors = append(keptAnchors, a)
	}
	f.anchors[engine] = keptAnchors
	f.unacked = false // the ack is part of the same transaction
	if f.repairLeavesNoCursor {
		f.cursorFound = false
		return target, marked, nil
	}
	f.cursor, f.cursorFound = target, true
	return target, marked, nil
}

// NeutralizedPriceStats mirrors the real aggregate over the marker column, so a
// test can show that the retained-but-unusable backlog (D-010 clause 4) is read
// from durable rows rather than counted in process memory.
func (f *fakePriceStore) NeutralizedPriceStats(_ context.Context, engine string, _ uint64) (store.NeutralizedPriceStats, error) {
	if f.neutralizedStatsErr != nil {
		return store.NeutralizedPriceStats{}, f.neutralizedStatsErr
	}
	var out store.NeutralizedPriceStats
	for _, r := range f.rows {
		if r.owner != engine || r.invalidReason != store.InvalidReasonUnverifiableReorg {
			continue
		}
		out.Rows++
		if out.Oldest.IsZero() || r.observedAt.Before(out.Oldest) {
			out.Oldest = r.observedAt
		}
		if r.observedAt.After(out.Newest) {
			out.Newest = r.observedAt
		}
		if r.block > out.HighestBlock {
			out.HighestBlock = r.block
		}
	}
	return out, nil
}

func (f *fakePriceStore) UnanchoredPriceBlocks(_ context.Context, engine string, _ uint64, limit int) ([]uint64, error) {
	if f.anchorReadErr != nil {
		return nil, f.anchorReadErr
	}
	anchored := map[uint64]bool{}
	for _, a := range f.anchors[engine] {
		anchored[a.BlockNumber] = true
	}
	seen := map[uint64]bool{}
	var out []uint64
	for _, r := range f.rows {
		if r.owner != engine || anchored[r.block] || seen[r.block] {
			continue
		}
		seen[r.block] = true
		out = append(out, r.block)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] > out[j] })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// AdoptPollAnchor models the real call's two refusals — no owned row at that
// block, and a pending reorg epoch — because both are the safety argument for
// adopting a hash the round never witnessed.
func (f *fakePriceStore) AdoptPollAnchor(_ context.Context, engine string, _ uint64, a store.PollAnchor) (bool, error) {
	if f.adoptErr != nil {
		return false, f.adoptErr
	}
	if f.unacked {
		return false, fmt.Errorf("engine %q has an unacknowledged reorg epoch: refusing to adopt an anchor", engine)
	}
	owned := false
	for _, r := range f.rows {
		if r.owner == engine && r.block == a.BlockNumber {
			owned = true
			break
		}
	}
	if !owned {
		return false, fmt.Errorf("adopt poll anchor for %q at %d: this engine owns no row there", engine, a.BlockNumber)
	}
	for _, ex := range f.anchors[engine] {
		if ex.BlockNumber == a.BlockNumber {
			return false, nil
		}
	}
	f.anchors[engine] = append(f.anchors[engine], store.StoredPollAnchor{PollAnchor: a, ObservedAt: f.now()})
	f.adopted = append(f.adopted, a.BlockNumber)
	return true, nil
}

// LatestLogsByTopic mirrors the real store's DISTINCT ON (address) newest-first
// semantics, bounded by throughBlock — the durable read the feed deriver hydrates
// publication freshness from.
func (f *fakePriceStore) LatestLogsByTopic(_ context.Context, _ uint64, addresses [][]byte, topic0 []byte, through uint64) ([]store.RawLog, error) {
	f.latestLogCalls = append(f.latestLogCalls, through)
	if f.latestLogsErr != nil && len(f.latestLogCalls) > f.latestLogsErrAfter {
		return nil, f.latestLogsErr
	}
	want := map[string]bool{}
	for _, a := range addresses {
		want[string(a)] = true
	}
	newest := map[string]store.RawLog{}
	for _, l := range f.storedLogs() {
		if !want[string(l.Address)] || l.BlockNumber > through {
			continue
		}
		if len(l.Topics) == 0 || string(l.Topics[0]) != string(topic0) {
			continue
		}
		prev, ok := newest[string(l.Address)]
		if ok && (l.BlockNumber < prev.BlockNumber ||
			(l.BlockNumber == prev.BlockNumber && l.LogIndex <= prev.LogIndex)) {
			continue
		}
		newest[string(l.Address)] = l
	}
	out := make([]store.RawLog, 0, len(newest))
	for _, l := range newest {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool { return string(out[i].Address) < string(out[j].Address) })
	return out, nil
}

func (f *fakePriceStore) Cursor(_ context.Context, stream string) (*store.CursorPos, error) {
	return f.ingest[stream], nil
}

// seedRow inserts a durable VALID row directly, for tests that need pre-existing
// history without replaying an apply (a RESTART, in other words).
func (f *fakePriceStore) seedRow(owner string, asset []byte, source string, block uint64, observedAt time.Time) {
	f.rows = append(f.rows, fakeRow{
		owner: owner, asset: asset, source: source, block: block, observedAt: observedAt, valid: true,
	})
}

// seedInvalidRow inserts a durable QUARANTINED row — the shape a non-positive
// oracle answer takes on disk.
func (f *fakePriceStore) seedInvalidRow(owner string, asset []byte, source string, block uint64, observedAt time.Time) {
	f.rows = append(f.rows, fakeRow{
		owner: owner, asset: asset, source: source, block: block, observedAt: observedAt,
		valid: false, invalidReason: "non-positive oracle answer",
	})
}

// seedAnchor inserts a durable poll anchor directly (again: a restart, or
// history this process did not write), stamped at the fake's current clock.
func (f *fakePriceStore) seedAnchor(engine string, block uint64, hash common.Hash) {
	f.seedAnchorAt(engine, block, hash, f.now())
}

// seedAnchorAt is seedAnchor with an explicit database timestamp, for tests about
// how long it has been since a NEW execution block was observed.
func (f *fakePriceStore) seedAnchorAt(engine string, block uint64, hash common.Hash, at time.Time) {
	f.anchors[engine] = append(f.anchors[engine], store.StoredPollAnchor{
		PollAnchor: store.PollAnchor{BlockNumber: block, BlockHash: hash.Bytes()},
		ObservedAt: at,
	})
}

// RawLogsInRange mirrors the real store's ORDERING contract — ascending
// (block_number, log_index), the total order the derivation layer requires — so
// a test cannot pass merely because the fake handed logs back in insertion
// order.
// storedLogs returns the durable log set with every row's ingestion time settled.
//
// raw_logs.ingested_at is NOT NULL DEFAULT now(), so a stored log ALWAYS has one; a
// fake returning the zero time would be modelling a row the database cannot hold.
// The stamp is written back into f.logs, so the value is assigned ONCE and every
// later read of the same log sees the same instant — which is the property the
// timestamp verdict now depends on. A test that wants a specific ingestion time
// sets it on the seeded log and this leaves it alone; a test that wants the
// "no durable ingestion time" refusal sets logsWithoutIngestionTime.
func (f *fakePriceStore) storedLogs() []store.RawLog {
	if f.logsWithoutIngestionTime {
		return f.logs
	}
	at := f.now()
	for i := range f.logs {
		if f.logs[i].IngestedAt.IsZero() {
			f.logs[i].IngestedAt = at
		}
	}
	return f.logs
}

func (f *fakePriceStore) RawLogsInRange(_ context.Context, _ uint64, _ [][]byte, from, to uint64) ([]store.RawLog, error) {
	f.rawLogsCalls = append(f.rawLogsCalls, [2]uint64{from, to})
	var out []store.RawLog
	for _, l := range f.storedLogs() {
		if l.BlockNumber >= from && l.BlockNumber <= to {
			out = append(out, l)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].BlockNumber != out[j].BlockNumber {
			return out[i].BlockNumber < out[j].BlockNumber
		}
		return out[i].LogIndex < out[j].LogIndex
	})
	return out, nil
}

// lastBatch returns the most recent ApplyPrices call.
func (f *fakePriceStore) lastBatch(t *testing.T) appliedBatch {
	t.Helper()
	require.NotEmpty(t, f.applied, "no ApplyPrices call was made")
	return f.applied[len(f.applied)-1]
}

// ---------------------------------------------------------------------------
// Fake chains.
// ---------------------------------------------------------------------------

type capturedCall struct {
	to   common.Address
	data []byte
}

// endpointView is ONE rpc endpoint's PRIVATE view of the chain.
//
// WHY THIS TYPE EXISTS, and what its absence cost. Until fix wave 6 the fake
// answered hash probes from a single `map[uint64]common.Hash` keyed by HEIGHT
// ALONE. Every endpoint therefore agreed about every block by construction, so
// the fake was structurally incapable of expressing the one thing Codex round 5
// found: two endpoints DISAGREEING about the same height because they sit on
// different forks. No amount of test-writing discipline reaches a failure mode
// the harness cannot represent, which is why D-010 makes the harness a
// prerequisite rather than a follow-up.
//
// An entry written for endpoint 0 says nothing whatever about endpoint 1.
type endpointView struct {
	// hashes is this endpoint's chain: block → hash. A block absent from it
	// answers "not found", the shape a probe above that endpoint's head takes.
	hashes map[uint64]common.Hash
	// down, when set, makes this endpoint fail EVERY probe — a node that is
	// unreachable rather than merely forked.
	down error
	// errAt fails this endpoint's probe for SPECIFIC heights, so a test can
	// express "this one anchor could not be checked HERE" distinctly from "this
	// height is absent from this endpoint's chain".
	errAt map[uint64]error
	// failAfter fails a height's probe on this endpoint only from the Nth read
	// onward, so a test can script the ANCHOR PROBE of a height apart from the
	// CHECKPOINT RE-READ of the same height later in the same repair.
	failAfter map[uint64]int
	// reads counts this endpoint's reads per height, for failAfter.
	reads map[uint64]int
}

// fakePollChain models chain.Failover's routing contract: CallWithToken serves
// from the SHARED sticky hint, CallFrom serves from the caller-given start
// WITHOUT touching that hint, and every call stamps its token with the endpoint
// that served it — so the tests prove the POLLER, not the fake, chooses the
// endpoint.
//
// HeaderHashFrom additionally models FAILOVER, which the previous fake did not:
// the real client walks endpoints from the requested start and returns the first
// answer it gets, stamping the token with whichever endpoint actually replied.
// A caller that ignores that token silently mixes chain views. Reproducing the
// walk is what lets a test show the difference between "endpoint 0 answered" and
// "endpoint 0 was down and endpoint 1 answered in its place".
type fakePollChain struct {
	endpoints int
	active    int
	// respond answers per endpoint index; a nil entry means "reuse index 0".
	respond func(idx int, to common.Address, data []byte) ([]byte, error)

	calls  []capturedCall
	served []int
	starts []int // CallFrom start indices, in order

	// views is the live chain PER ENDPOINT, grown lazily by view().
	views map[int]*endpointView

	hashStart []int    // HeaderHashFrom start indices, in order
	hashCalls []uint64 // the height each probe asked about, in order
	// hashServed is the endpoint that ANSWERED each probe (-1 when every
	// endpoint failed). Paired with hashCalls it is the record of which chain
	// view each proof came from, which is the whole subject of D-010 clause 2.
	hashServed []int
}

func (c *fakePollChain) CallWithToken(_ context.Context, to common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	return c.serve(c.active, to, data)
}

func (c *fakePollChain) CallFrom(_ context.Context, start int, to common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	c.starts = append(c.starts, start)
	idx := start
	if c.endpoints > 0 {
		idx = ((start % c.endpoints) + c.endpoints) % c.endpoints
	}
	return c.serve(idx, to, data)
}

func (c *fakePollChain) EndpointCount() int { return c.endpoints }

// view returns endpoint idx's chain view, creating an empty one on first use.
func (c *fakePollChain) view(idx int) *endpointView {
	if c.views == nil {
		c.views = map[int]*endpointView{}
	}
	v, ok := c.views[idx]
	if !ok {
		v = &endpointView{
			hashes:    map[uint64]common.Hash{},
			errAt:     map[uint64]error{},
			failAfter: map[uint64]int{},
			reads:     map[uint64]int{},
		}
		c.views[idx] = v
	}
	return v
}

// endpointIndexes lists every endpoint this fake routes across.
func (c *fakePollChain) endpointIndexes() []int {
	n := c.endpoints
	if n <= 0 {
		n = 1
	}
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	return out
}

// setHashOn writes a hash at block into ONE endpoint's view. This is the
// primitive that expresses endpoint DISAGREEMENT: nothing propagates.
func (c *fakePollChain) setHashOn(endpoint int, block uint64, h common.Hash) {
	c.view(endpoint).hashes[block] = h
}

// setHash writes the same hash into EVERY endpoint's view — the endpoints AGREE
// about this height. Most tests are not about divergence and want this.
func (c *fakePollChain) setHash(block uint64, h common.Hash) {
	for _, i := range c.endpointIndexes() {
		c.setHashOn(i, block, h)
	}
}

// canonicalOn makes ONE endpoint report the standard hash for these blocks.
func (c *fakePollChain) canonicalOn(endpoint int, blocks ...uint64) {
	for _, b := range blocks {
		c.setHashOn(endpoint, b, blockHashAt(b))
	}
}

// failAll makes EVERY endpoint fail every probe: a total probe outage, in which
// failover has nowhere to go.
func (c *fakePollChain) failAll(err error) {
	for _, i := range c.endpointIndexes() {
		c.view(i).down = err
	}
}

func (c *fakePollChain) clearFailAll() {
	for _, i := range c.endpointIndexes() {
		c.view(i).down = nil
	}
}

// failProbeOn fails ONE endpoint's probe of one height. The endpoint stays
// reachable for every other height, so failover routes around it — which is the
// silent-failover path D-010 clause 2 is about.
func (c *fakePollChain) failProbeOn(endpoint int, block uint64, err error) {
	c.view(endpoint).errAt[block] = err
}

// failProbe fails one height on EVERY endpoint, so no failover can answer it.
func (c *fakePollChain) failProbe(block uint64, err error) {
	for _, i := range c.endpointIndexes() {
		c.failProbeOn(i, block, err)
	}
}

func (c *fakePollChain) clearFailProbe(block uint64) {
	for _, i := range c.endpointIndexes() {
		delete(c.view(i).errAt, block)
	}
}

// failAfter makes every endpoint answer a height n times and then fail it,
// which is how a test separates a page's anchor probe from the checkpoint
// re-read of the same height.
func (c *fakePollChain) failAfter(block uint64, n int) {
	for _, i := range c.endpointIndexes() {
		c.view(i).failAfter[block] = n
	}
}

func (c *fakePollChain) clearFailAfter() {
	for _, i := range c.endpointIndexes() {
		c.view(i).failAfter = map[uint64]int{}
	}
}

// probe is ONE endpoint's answer about one height, with no failover.
func (c *fakePollChain) probe(idx int, block uint64) (common.Hash, error) {
	v := c.view(idx)
	if v.down != nil {
		return common.Hash{}, v.down
	}
	if err, bad := v.errAt[block]; bad {
		return common.Hash{}, err
	}
	v.reads[block]++
	if after, scripted := v.failAfter[block]; scripted && v.reads[block] > after {
		return common.Hash{}, fmt.Errorf("endpoint %d timed out reading header %d", idx, block)
	}
	h, ok := v.hashes[block]
	if !ok {
		return common.Hash{}, fmt.Errorf("header %d not found on endpoint %d", block, idx)
	}
	return h, nil
}

// HeaderHashFrom walks endpoints from start exactly as chain.Failover.doFrom
// does, returns the FIRST answer, and stamps the token with the endpoint that
// actually produced it. A caller that requests endpoint 0 and reads a token
// naming endpoint 1 has been silently failed over onto another chain view.
func (c *fakePollChain) HeaderHashFrom(_ context.Context, start int, block uint64) (common.Hash, chain.EndpointToken, error) {
	c.hashStart = append(c.hashStart, start)
	c.hashCalls = append(c.hashCalls, block)
	n := c.endpoints
	if n <= 0 {
		n = 1
	}
	first := ((start % n) + n) % n
	var lastErr error
	for i := 0; i < n; i++ {
		idx := (first + i) % n
		h, err := c.probe(idx, block)
		if err != nil {
			lastErr = err
			continue
		}
		c.hashServed = append(c.hashServed, idx)
		return h, chain.EndpointToken{Index: idx}, nil
	}
	c.hashServed = append(c.hashServed, -1)
	return common.Hash{}, chain.EndpointToken{Index: -1}, lastErr
}

func (c *fakePollChain) serve(idx int, to common.Address, data []byte) ([]byte, chain.EndpointToken, error) {
	c.calls = append(c.calls, capturedCall{to: to, data: data})
	c.served = append(c.served, idx)
	out, err := c.respond(idx, to, data)
	if err != nil {
		return nil, chain.EndpointToken{Index: -1}, err
	}
	return out, chain.EndpointToken{Index: idx}, nil
}

// fakeFeedChain models the feed deriver's narrow surface: a head probe carrying
// the header's own timestamp and routable to a chosen endpoint, plus a plain
// eth_call (for the proxy aggregator() re-resolution).
type fakeFeedChain struct {
	head     uint64
	headErr  error
	headHits int
	// headStarts records the endpoint index each probe was routed from, so a test
	// can prove the probe avoided the shared hint rather than trusting a comment.
	headStarts []int
	// endpoints/active model the failover's routing surface. endpoints defaults
	// to 1 via EndpointCount, where independent routing is impossible.
	endpoints int
	active    int
	// now supplies the probe's reference clock and headAge ages the returned
	// header's TIMESTAMP relative to it: headAge=0 is a live head, a large
	// headAge is a node frozen on old state that still answers.
	now     clock
	headAge time.Duration

	callResp func(to common.Address, data []byte) ([]byte, error)
	calls    []capturedCall
}

func (c *fakeFeedChain) HeadFrom(_ context.Context, start int) (chain.Head, chain.EndpointToken, error) {
	c.headHits++
	c.headStarts = append(c.headStarts, start)
	if c.headErr != nil {
		return chain.Head{}, chain.EndpointToken{Index: -1}, c.headErr
	}
	ref := time.Now
	if c.now != nil {
		ref = c.now
	}
	idx := start
	if c.endpoints > 0 {
		idx = ((start % c.endpoints) + c.endpoints) % c.endpoints
	}
	return chain.Head{
		Number: c.head,
		Time:   uint64(ref().Add(-c.headAge).Unix()),
		Hash:   common.BytesToHash([]byte{byte(c.head)}),
	}, chain.EndpointToken{Index: idx}, nil
}

func (c *fakeFeedChain) ActiveEndpoint() int { return c.active }

func (c *fakeFeedChain) EndpointCount() int {
	if c.endpoints == 0 {
		return 1
	}
	return c.endpoints
}

func (c *fakeFeedChain) Call(_ context.Context, to common.Address, data []byte) ([]byte, error) {
	c.calls = append(c.calls, capturedCall{to: to, data: data})
	if c.callResp == nil {
		return nil, fmt.Errorf("fake feed chain: no responder")
	}
	return c.callResp(to, data)
}

// ---------------------------------------------------------------------------
// Response builders (through the production ABI objects).
// ---------------------------------------------------------------------------

// mcRet mirrors multicall3's (bool success, bytes returnData) output tuple.
type mcRet struct {
	Success    bool
	ReturnData []byte
}

// blockHashAt is the deterministic stand-in for a block's hash: a distinct,
// NON-ZERO hash per height, so a test can build a "live chain" the poller's
// anchor probes agree with. The zero hash is deliberately never produced —
// unpackMulticallResult refuses it.
func blockHashAt(block uint64) common.Hash {
	return common.BigToHash(new(big.Int).SetUint64(block + 1))
}

// encodeMulticall builds a tryBlockAndAggregate return carrying block, that
// block's hash and rets.
func encodeMulticall(t *testing.T, block uint64, rets []mcRet) []byte {
	t.Helper()
	return encodeMulticallWithHash(t, block, blockHashAt(block), rets)
}

// encodeMulticallWithHash is encodeMulticall with an explicit block hash, for the
// cases where the hash itself is what a test is about.
func encodeMulticallWithHash(t *testing.T, block uint64, hash common.Hash, rets []mcRet) []byte {
	t.Helper()
	var h [32]byte
	copy(h[:], hash.Bytes())
	out, err := multicall3ABI.Methods["tryBlockAndAggregate"].Outputs.Pack(
		new(big.Int).SetUint64(block), h, rets)
	require.NoError(t, err)
	return out
}

// encodeUint256 builds a single-uint256 view return.
func encodeUint256(t *testing.T, v *big.Int) []byte {
	t.Helper()
	out, err := priceProviderABI.Methods["price"].Outputs.Pack(v)
	require.NoError(t, err)
	return out
}

// encodeAddress builds a single-address view return (aggregator()).
func encodeAddress(t *testing.T, a common.Address) []byte {
	t.Helper()
	out, err := chainlinkProxyABI.Methods["aggregator"].Outputs.Pack(a)
	require.NoError(t, err)
	return out
}

// decodeMulticallCalls unpacks a tryBlockAndAggregate REQUEST so a test can
// assert the exact (target, callData) list the worker submitted.
func decodeMulticallCalls(t *testing.T, input []byte) (bool, []multicall3Call) {
	t.Helper()
	m := multicall3ABI.Methods["tryBlockAndAggregate"]
	require.Equal(t, m.ID, input[:4], "selector")
	vals, err := m.Inputs.Unpack(input[4:])
	require.NoError(t, err)
	require.Len(t, vals, 2)
	requireSuccess := vals[0].(bool)
	raw := vals[1].([]struct {
		Target   common.Address `json:"target"`
		CallData []byte         `json:"callData"`
	})
	out := make([]multicall3Call, len(raw))
	for i, c := range raw {
		out[i] = multicall3Call{Target: c.Target, CallData: c.CallData}
	}
	return requireSuccess, out
}

// answerUpdatedLog builds a raw AnswerUpdated log the REAL decode.Registry can
// decode: topic0 from recon, the indexed int256 answer in two's complement, the
// indexed roundId, and updatedAt in the data word.
func answerUpdatedLog(block uint64, logIndex uint32, agg common.Address, answer *big.Int, roundID, updatedAt uint64) store.RawLog {
	current := math.U256Bytes(new(big.Int).Set(answer))
	return store.RawLog{
		ChainID:     1,
		BlockNumber: block,
		BlockHash:   common.BytesToHash([]byte{byte(block)}).Bytes(),
		TxHash:      common.BytesToHash([]byte{byte(block), byte(logIndex)}).Bytes(),
		LogIndex:    logIndex,
		Address:     agg.Bytes(),
		Topics: [][]byte{
			answerUpdatedTopic0.Bytes(),
			current,
			common.BigToHash(new(big.Int).SetUint64(roundID)).Bytes(),
		},
		Data: common.BigToHash(new(big.Int).SetUint64(updatedAt)).Bytes(),
	}
}

// ---------------------------------------------------------------------------
// Selector and naming pins.
// ---------------------------------------------------------------------------

// TestSelectors pins every function selector this package packs against keccak
// of its signature string. Three of them are cross-checked against literals
// recorded INDEPENDENTLY in recon/derivation-notes.md and internal/snapshot, so
// the pin is not merely self-consistent with the ABI JSON in this file.
func TestSelectors(t *testing.T) {
	cases := []struct {
		signature string
		got       []byte
		literal   string // independently recorded value, "" when none
	}{
		{"price(address)", priceProviderABI.Methods["price"].ID, "0xaea91078"},
		// recon "Oracle wiring": accountant lenses, calldata 0x679aefce = getRate()
		{"getRate()", rateProviderABI.Methods["getRate"].ID, "0x679aefce"},
		{"aggregator()", chainlinkProxyABI.Methods["aggregator"].ID, "0x245a7bfc"},
		// internal/snapshot pins the same multicall3 selector against `cast sig`.
		{"tryBlockAndAggregate(bool,(address,bytes)[])",
			multicall3ABI.Methods["tryBlockAndAggregate"].ID, "0x399542e9"},
	}
	for _, tc := range cases {
		want := crypto.Keccak256([]byte(tc.signature))[:4]
		require.Equal(t, want, tc.got, "%s: ABI-derived selector must equal keccak(signature)[:4]", tc.signature)
		if tc.literal != "" {
			require.Equal(t, tc.literal, fmt.Sprintf("0x%x", tc.got), tc.signature)
		}
	}

	// The AnswerUpdated topic0 the walker ingests and the deriver reads back.
	require.Equal(t, answerUpdatedTopic0.Bytes(),
		crypto.Keccak256([]byte("AnswerUpdated(int256,uint256,uint256)")),
		"recon's recorded AnswerUpdated topic0")
}

// Source names are deterministic functions of the mechanism, lowercase so a
// checksum-cased variant can never split one aggregator's history in two.
func TestSourceNaming(t *testing.T) {
	require.Equal(t, "priceproviderv2", SourcePriceProviderV2)
	require.Equal(t, "chainlink:0x7d4e742018fb52e48b08be73d041c18b21de6fb5", ChainlinkSource(aggWeETH))
	require.Equal(t, "ratio:getrate:0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
		RatioSource("getRate()", weethETH))
	// Case-insensitive input, identical output.
	require.Equal(t, ChainlinkSource(aggWeETH),
		ChainlinkSource(common.HexToAddress("0x7D4E742018FB52E48B08BE73D041C18B21DE6FB5")))
}

// Cursor keys are colon-namespaced and chain-id-qualified, so they can never
// collide with a config engine name (review flag M4's accepted resolution).
func TestCursorKeysCannotCollideWithEngines(t *testing.T) {
	keys := []string{PollCursorEngine(10), PollCursorEngine(1), FeedCursorEngine(1)}
	require.Equal(t, []string{"prices:poll:10", "prices:poll:1", "prices:chainlink_feed:1"}, keys)
	for _, k := range keys {
		require.False(t, config.KnownEngines[k], "%s must not be a config engine name", k)
		require.Contains(t, k, ":", "%s must carry the namespace separator engine names lack", k)
	}
	for engine := range config.KnownEngines {
		require.NotContains(t, engine, ":",
			"engine %q gained a colon: the price cursor namespace is no longer collision-proof", engine)
	}
	require.NotEqual(t, PollCursorEngine(1), PollCursorEngine(10),
		"the poller spans two chains, so its cursor must be per-chain")
}

// Two observations on ONE (asset, source, block) key collapse LAST-WINS: the
// store aborts a batch on a divergent replay of a key, so a legitimate
// same-block re-publication must not wedge the write.
func TestPriceSetLastWinsAndCopies(t *testing.T) {
	set := newPriceSet()
	asset := weethETH.Bytes()
	price := big.NewInt(100)
	set.add(store.PriceObservation{Asset: asset, Source: "s", Price: price, Decimals: 8, BlockNumber: 5})
	set.add(store.PriceObservation{Asset: asset, Source: "s", Price: big.NewInt(200), Decimals: 8, BlockNumber: 5})
	set.add(store.PriceObservation{Asset: asset, Source: "s", Price: big.NewInt(300), Decimals: 8, BlockNumber: 6})

	obs := set.observations()
	require.Len(t, obs, 2, "one row per key")
	require.Equal(t, uint64(5), obs[0].BlockNumber, "insertion order preserved")
	require.Equal(t, "200", obs[0].Price.String(), "last write wins at block 5")
	require.Equal(t, "300", obs[1].Price.String())

	// Defensive copies: mutating the caller's inputs must not touch the batch.
	price.SetInt64(999)
	asset[0] = 0xFF
	require.Equal(t, "200", obs[0].Price.String())
	require.Equal(t, weethETH.Bytes()[0], obs[0].Asset[0])
}

// A nil price is passed through UNCHANGED (never copied — which would panic —
// and never coerced to zero, which would fabricate a price): the store's named
// refusal is the fail-loud path.
func TestPriceSetPassesNilPriceThrough(t *testing.T) {
	set := newPriceSet()
	set.add(store.PriceObservation{Asset: weethETH.Bytes(), Source: "s", Decimals: 8, BlockNumber: 5})
	obs := set.observations()
	require.Len(t, obs, 1)
	require.Nil(t, obs[0].Price)
}

// buildPollTargets resolves the REAL registry: 20 engine-exact OP obligations
// and the single ETH weETH getRate() ratio.
func TestBuildPollTargetsFromRealRegistry(t *testing.T) {
	feeds := realFeeds(t)

	op, err := buildPollTargets(feeds, 10)
	require.NoError(t, err)
	require.Len(t, op, 20)
	for _, tg := range op {
		require.Equal(t, priceProviderV2, tg.Contract, tg.Symbol)
		require.Equal(t, "price(address)", tg.Method, tg.Symbol)
		require.Equal(t, SourcePriceProviderV2, tg.Source, tg.Symbol)
		require.Equal(t, int32(6), tg.Decimals, tg.Symbol)
	}
	require.Equal(t, []string{SourcePriceProviderV2}, sourcesOf(op),
		"all 20 OP obligations share one mechanism name")

	eth, err := buildPollTargets(feeds, 1)
	require.NoError(t, err)
	require.Len(t, eth, 1, "only the weETH ratio is polled on ETH")
	require.Equal(t, "weETH", eth[0].Symbol)
	require.Equal(t, weethETH, eth[0].Asset)
	require.Equal(t, "getRate()", eth[0].Method)
	require.Equal(t, int32(18), eth[0].Decimals)
	require.Equal(t, RatioSource("getRate()", weethETH), eth[0].Source)
}

// An unsupported oracle method is a CONSTRUCTION refusal, not a runtime skip: a
// silently-skipped asset is a silently-missing price.
func TestBuildPollTargetsRefusesUnsupportedMethod(t *testing.T) {
	feeds := &config.Feeds{Assets: []config.Feed{{
		Chain: "op", ChainID: 10, Engine: "debt_manager", Address: usdcETH,
		Symbol: "USDC", Decimals: 6, Roles: []string{"debt"},
		Oracle: config.FeedOracle{
			Kind: config.FeedKindPoll, Contract: priceProviderV2,
			Method: "latestAnswer()", PriceDecimals: 8,
		},
	}}}
	_, err := buildPollTargets(feeds, 10)
	require.ErrorContains(t, err, `oracle method "latestAnswer()" is not supported`)
}

// The flat "priceproviderv2" source carries no address, so two PriceProvider
// deployments would write rows claiming a provenance they do not have.
func TestBuildPollTargetsRefusesTwoContractsUnderOneSource(t *testing.T) {
	other := common.HexToAddress("0x1111111111111111111111111111111111111111")
	mk := func(asset, oracle common.Address, symbol string) config.Feed {
		return config.Feed{
			Chain: "op", ChainID: 10, Engine: "debt_manager", Address: asset,
			Symbol: symbol, Decimals: 6, Roles: []string{"debt"},
			Oracle: config.FeedOracle{
				Kind: config.FeedKindPoll, Contract: oracle,
				Method: "price(address)", PriceDecimals: 6,
			},
		}
	}
	feeds := &config.Feeds{Assets: []config.Feed{
		mk(usdcETH, priceProviderV2, "USDC"),
		mk(weethETH, other, "weETH"),
	}}
	_, err := buildPollTargets(feeds, 10)
	require.ErrorContains(t, err, "already bound to contract")
}

// unpack* convert malformed provider bytes into errors rather than panicking.
func TestUnpackHardening(t *testing.T) {
	_, err := unpackUint256("price", priceProviderABI, []byte{0x01, 0x02})
	require.Error(t, err)
	_, err = unpackAddress("aggregator", chainlinkProxyABI, []byte{0x01})
	require.Error(t, err)
	_, _, _, err = unpackMulticallResult([]byte{0xde, 0xad}, 1)
	require.Error(t, err)

	// A well-formed envelope with the WRONG result count is refused: silently
	// zipping N results onto M targets would mis-attribute prices.
	out := encodeMulticall(t, 100, []mcRet{{Success: true, ReturnData: encodeUint256(t, big.NewInt(1))}})
	_, _, _, err = unpackMulticallResult(out, 2)
	require.ErrorContains(t, err, "1 results for 2 calls")
}

// The multicall's EXECUTION BLOCK HASH is decoded, not discarded: it is the whole
// basis of the durable poll anchor that lets reorg repair keep provably-canonical
// history instead of deleting all of it.
func TestUnpackMulticallKeepsBlockHash(t *testing.T) {
	want := blockHashAt(5000)
	out := encodeMulticall(t, 5000, []mcRet{{Success: true, ReturnData: encodeUint256(t, big.NewInt(1))}})
	block, hash, results, err := unpackMulticallResult(out, 1)
	require.NoError(t, err)
	require.Equal(t, uint64(5000), block)
	require.Equal(t, want.Bytes(), hash, "the execution block hash must survive decoding")
	require.Len(t, results, 1)
}

// A ZERO block hash is refused: multicall3 returns blockhash(block.number),
// which is never zero for the executing block, and an anchor holding a zero hash
// would "verify" against nothing during reorg repair.
func TestUnpackMulticallRefusesZeroBlockHash(t *testing.T) {
	out := encodeMulticallWithHash(t, 5000, common.Hash{},
		[]mcRet{{Success: true, ReturnData: encodeUint256(t, big.NewInt(1))}})
	_, _, _, err := unpackMulticallResult(out, 1)
	require.ErrorContains(t, err, "block hash at 5000 is zero")
}

// ---------------------------------------------------------------------------
// Shared test clock.
// ---------------------------------------------------------------------------

type testClock struct{ t time.Time }

func newTestClock() *testClock {
	return &testClock{t: time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)}
}

func (c *testClock) now() time.Time          { return c.t }
func (c *testClock) advance(d time.Duration) { c.t = c.t.Add(d) }
func (c *testClock) unix(offset time.Duration) uint64 {
	return uint64(c.t.Add(offset).Unix())
}

// ---------------------------------------------------------------------------
// Log capture.
// ---------------------------------------------------------------------------

// TestMain silences the workers' operational logging by default; individual
// tests that assert ON a log route it through captureWarnings instead.
func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	os.Exit(m.Run())
}

// captureWarnings routes slog through a collector for the duration of the test
// and returns the accumulating WARN/ERROR record slice.
//
// Each record is rendered as its MESSAGE followed by its ATTRIBUTES, because the
// operational detail these workers emit (which endpoint, which evidence, which
// anchor block, why a cause was undetermined) lives in structured attributes.
// Asserting only on the message would let the detail an operator actually reads
// drift unchecked.
func captureWarnings(t *testing.T) *[]string {
	t.Helper()
	msgs := []string{}
	prev := slog.Default()
	slog.SetDefault(slog.New(warnCollector{msgs: &msgs}))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &msgs
}

type warnCollector struct{ msgs *[]string }

func (w warnCollector) Enabled(context.Context, slog.Level) bool { return true }
func (w warnCollector) Handle(_ context.Context, r slog.Record) error {
	if r.Level < slog.LevelWarn {
		return nil
	}
	var b strings.Builder
	b.WriteString(r.Message)
	r.Attrs(func(a slog.Attr) bool {
		b.WriteString(" ")
		b.WriteString(a.Key)
		b.WriteString("=")
		b.WriteString(a.Value.String())
		return true
	})
	*w.msgs = append(*w.msgs, b.String())
	return nil
}
func (w warnCollector) WithAttrs([]slog.Attr) slog.Handler { return w }
func (w warnCollector) WithGroup(string) slog.Handler      { return w }

// containsSubstring reports whether any captured message contains want.
func containsSubstring(msgs []string, want string) bool {
	for _, m := range msgs {
		if strings.Contains(m, want) {
			return true
		}
	}
	return false
}
