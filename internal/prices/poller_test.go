package prices

// Poller tests: request shape against the REAL registry, the per-asset failure
// posture, the cadence gate, the reorg-first ordering, the HASH-ANCHORED rewind
// (retain what is provably canonical, discard only the unverified suffix), the
// PER-ASSET durable health surface, and the cause-classified endpoint routing
// (reorg vs frozen endpoint vs undetermined).

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/config"
	"github.com/kaselunt/solvent/internal/store"
)

// newTestPoller builds a Poller on the REAL registry with an injected clock
// shared by the poller AND the fake store (whose observed_at stands in for the
// database clock, which durable freshness is measured against).
func newTestPoller(t *testing.T, st *fakePriceStore, ch *fakePollChain, chainID uint64) (*Poller, *testClock) {
	t.Helper()
	p, err := NewPoller(st, ch, realFeeds(t), PollerConfig{
		ChainID: chainID, Interval: time.Minute,
	})
	require.NoError(t, err)
	clk := newTestClock()
	p.now = clk.now
	p.startedAt = clk.now()
	st.now = clk.now
	return p, clk
}

// okRound answers every call in a round successfully with price.
func okRound(t *testing.T, block uint64, targets int, price int64) func(int, common.Address, []byte) ([]byte, error) {
	return func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, targets)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(price))}
		}
		return encodeMulticall(t, block, rets), nil
	}
}

// canonicalAt makes EVERY endpoint of the fake chain agree that block carries
// its standard hash — the "our frontier is still canonical" world, in which a
// cursor regression IS attributable to the endpoint that served it. Tests about
// endpoint DISAGREEMENT use canonicalOn/setHashOn instead.
func canonicalAt(ch *fakePollChain, blocks ...uint64) {
	for _, b := range blocks {
		ch.setHash(b, blockHashAt(b))
	}
}

// probeEndpoints is the endpoint that ANSWERED each hash probe, in order — the
// record of which chain view every proof in a pass came from.
func probeEndpoints(ch *fakePollChain) []int { return ch.hashServed }

// pollConditions indexes a poller's conditions by name.
func pollConditions(p *Poller) map[string]string {
	out := map[string]string{}
	for _, c := range p.Conditions() {
		out[c.Name] = c.Reason
	}
	return out
}

// A round is exactly ONE multicall3 tryBlockAndAggregate, requireSuccess=false,
// every call targeting the registry's PriceProviderV2 with price(asset)
// calldata, in registry order.
func TestPollerRoundRequestShape(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, ch.calls, 1, "one multicall per round: every row is as-of one block")
	require.Equal(t, Multicall3Address, ch.calls[0].to)

	requireSuccess, calls := decodeMulticallCalls(t, ch.calls[0].data)
	require.False(t, requireSuccess, "one broken oracle must not fail the round")
	require.Len(t, calls, 20)

	wantAssets := realFeeds(t).PollAssets(10)
	require.Len(t, wantAssets, 20)
	for i, c := range calls {
		require.Equal(t, priceProviderV2, c.Target, "call %d targets PriceProviderV2", i)
		want, err := priceProviderABI.Pack("price", wantAssets[i].Address)
		require.NoError(t, err)
		require.Equal(t, want, c.CallData, "call %d prices %s in registry order", i, wantAssets[i].Symbol)
	}
}

// Observations carry the multicall's EXECUTION block, the mechanism source and
// the registry scale; the batch's through-block is that same block.
func TestPollerRecordsObservations(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	batch := st.lastBatch(t)
	require.Equal(t, PollCursorEngine(10), batch.engine)
	require.Equal(t, uint64(10), batch.chainID)
	require.Equal(t, uint64(5000), batch.through)
	require.Len(t, batch.obs, 20)
	for _, o := range batch.obs {
		require.Equal(t, SourcePriceProviderV2, o.Source)
		require.Equal(t, int32(6), o.Decimals)
		require.Equal(t, uint64(5000), o.BlockNumber)
		require.Equal(t, "1000000", o.Price.String())
		require.Len(t, o.Asset, 20)
	}
	require.Equal(t, uint64(5000), st.cursor)
}

// A1: every landed round persists its verified (N, HeaderHash(N)) as a durable
// poll anchor, in the same call as its rows — the anchor is what makes a later
// rewind able to prove which history is still canonical. The hash is the
// HEADER path's: the fake's multicall returns the real-EVM ZERO hash, so an
// anchor carrying blockHashAt(5000) can only have come from the endpoint's
// header, never from the multicall output.
func TestPollerRoundPersistsHashAnchor(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	batch := st.lastBatch(t)
	require.NotNil(t, batch.anchor, "a poll round must anchor itself")
	require.Equal(t, uint64(5000), batch.anchor.BlockNumber, "the anchor is the round's pinned, verified block")
	require.Equal(t, blockHashAt(5000).Bytes(), batch.anchor.BlockHash,
		"the anchor carries the header hash pinned on both sides of the multicall — the multicall's own hash field is zero on a real chain and is ignored")
	require.Len(t, st.anchors[PollCursorEngine(10)], 1)
	require.Equal(t, store.PollAnchor{BlockNumber: 5000, BlockHash: blockHashAt(5000).Bytes()},
		st.anchors[PollCursorEngine(10)][0].PollAnchor)
}

// ---------------------------------------------------------------------------
// Task 9 wave 1: the endpoint-coherent, block-pinned round.
// ---------------------------------------------------------------------------

// THE HEADLINE PROPERTY OF THE P0 FIX: the poller anchors WITHOUT consuming
// the multicall's blockHash field. The fake's default multicall already
// returns the real-EVM zero there (encodeMulticall); this test goes one step
// further and feeds a NONZERO, WRONG hash through that field — the only value
// a consumer could possibly be poisoned by — and the anchor still carries the
// header path's hash. Between them: zero must not refuse the round (the live
// failure), and nonzero must not be believed (the misanchor the recomposition
// makes impossible).
func TestPollerAnchorsWithoutConsumingMulticallHashField(t *testing.T) {
	st := newFakePriceStore()
	poisoned := common.HexToHash("0xdeadbeef")
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		return encodeMulticallWithHash(t, 5000, poisoned, rets), nil
	}}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	batch := st.lastBatch(t)
	require.Equal(t, blockHashAt(5000).Bytes(), batch.anchor.BlockHash,
		"the anchor is the endpoint's header hash at the pin — the multicall's hash field, zero or poisoned, has no consumer")
	require.NotEqual(t, poisoned.Bytes(), batch.anchor.BlockHash)
}

// ENDPOINT COHERENCE, the positive arm: one endpoint serves every read of a
// round — the head resolution, the pinned multicall and the closing header
// re-read all carry the same token — and the multicall is PINNED TO the HASH
// of the head that endpoint reported (EIP-1898), never issued at "latest" and
// never pinned to a bare height.
func TestPollerRoundIsEndpointCoherentAndPinnedAtHead(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 3, active: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	require.Equal(t, []int{1}, ch.headServed, "the shared hint's endpoint resolved the round")
	require.Equal(t, []int{1}, ch.served, "the multicall was served by the round's own endpoint")
	require.Equal(t, []int{1}, ch.hashServed, "and so was the closing header re-read: one token per round")
	require.Equal(t, []common.Hash{blockHashAt(5000)}, ch.atHashes,
		"the multicall executed pinned to the resolved head's HASH — the block's identity, not a bare height and not latest")
	require.Empty(t, ch.atBlocks, "no number-pinned call was issued in its place")
	require.Equal(t, []uint64{5000}, ch.hashCalls, "the re-read asked about the pin")
}

// PIN DIVERGENCE DISCARDS: a multicall whose returned blockNumber differs from
// the pinned block's height means the endpoint did not honour the requested
// state (a load balancer mixing nodes behind one URL is the honest example).
// The round is DISCARDED — the walker's tip-changed posture: a WARN with the
// evidence, no error, nothing recorded — and the spent cadence slot means no
// retry storm. AND the discard MOVES the next round's start (round-1 [high]):
// the caller-scoped exploration hint advances past the round's endpoint, so
// the same inconsistent endpoint cannot re-resolve itself every cadence.
func TestPollerDiscardsRoundWhenExecutionBlockDivergesFromPin(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0, respond: okRound(t, 4999, 20, 1_000_000)} // executed BELOW the pin
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a discarded round is not an error to back off on")
	require.False(t, advanced)
	require.Empty(t, st.applied, "nothing reached the store")
	require.True(t, containsSubstring(*msgs, "execution block diverged from the pin"))
	require.Equal(t, 1, p.exploreStart,
		"the discard advanced the next round's start past the inconsistent endpoint")
	require.Equal(t, -1, p.preferredStart, "exploration, not attribution: nothing was pinned as a diagnosis")

	// The cadence slot was consumed by the attempt: no immediate retry.
	calls := len(ch.calls)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Len(t, ch.calls, calls, "no RPC while the cadence slot is unspent")
}

// BRACKETING-HASH-MISMATCH DISCARDS — AND, reversing wave 2's exclusion
// (Codex round 2 finding 1, accepted), MOVES THE START. The header hash at
// the pin changing between the two reads that bracket the multicall was wave
// 2's "mid-round reorg: chain evidence, not endpoint evidence" — but a
// stable backend split behind the same URL produces the IDENTICAL
// observation, the two are indistinguishable from one token, and refusing to
// move on the ambiguity starved the poller under the split while a healthy
// peer sat idle. The discard stays (the observations may describe a block
// that no longer exists on that endpoint's chain); the START moves, because
// the advance is caller-scoped exploration that accuses nobody — a genuine
// reorg pays zero correctness cost for beginning its next round elsewhere.
func TestPollerBracketingHashMismatchDiscardsAndMovesTheStart(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		// The hash at the pin changes WHILE the multicall is in flight —
		// chain movement or a second backend behind the URL, unknowable: the
		// closing re-read will see a different block at 5000 either way.
		ch.setHashOn(0, 5000, common.HexToHash("0xfeed"))
		return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
	}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "the ambiguous mismatch is a discard, not an error")
	require.False(t, advanced)
	require.Empty(t, st.applied, "an anchor the close could not confirm was never written")
	require.True(t, containsSubstring(*msgs, "changed between the round's bracketing reads"))
	require.Equal(t, 1, p.exploreStart,
		"LANDING IS THE ONLY OUTCOME THAT KEEPS THE STARTING POINT: the ambiguous mismatch moved the next round's start (round-2 finding 1)")
	require.Equal(t, -1, p.preferredStart,
		"exploration, not attribution: ambiguous evidence accuses nobody")
}

// COHERENCE BREACH ON THE MULTICALL DISCARDS: the failover client rotates on
// transport errors, so the pinned multicall can come back answered by a
// DIFFERENT endpoint than the one whose head the round pinned. That answer
// belongs to another chain view; the round is discarded rather than anchored
// to a hash nobody attested for it.
func TestPollerDiscardsRoundWhenMulticallServedByAnotherEndpoint(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if idx == 0 {
			return nil, errors.New("endpoint 0 dropped the call") // rotation serves it from 1
		}
		return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
	}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.applied)
	require.Equal(t, []int{0}, ch.headServed, "endpoint 0 resolved the round")
	require.Equal(t, []int{0, 1}, ch.served, "the multicall rotated onto endpoint 1")
	require.True(t, containsSubstring(*msgs, "served the pinned multicall from another endpoint"))
	require.Equal(t, 1, p.exploreStart,
		"the discard advanced the next round's start past the endpoint that could not carry its own round (round-1 [high])")
	require.Equal(t, -1, p.preferredStart, "exploration, not attribution")
}

// COHERENCE BREACH ON THE CLOSING RE-READ DISCARDS: even with the multicall
// served coherently, a re-read answered by another endpoint cannot confirm
// the round's own chain view — two nodes agreeing on a hash is a different
// (weaker, for this purpose) fact than one node bracketing its own answer.
func TestPollerDiscardsRoundWhenClosingRecheckServedByAnotherEndpoint(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		// Endpoint 0 serves the multicall and then stops answering header
		// reads at the pin: the closing re-read rotates onto endpoint 1.
		ch.failProbeOn(0, 5000, errors.New("endpoint 0 lost header 5000"))
		return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
	}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.applied)
	require.Equal(t, []int{0}, ch.served, "the multicall itself was coherent")
	require.Equal(t, []int{1}, ch.hashServed, "the re-read was answered elsewhere — and that is exactly the discard")
	require.True(t, containsSubstring(*msgs, "served the closing header re-read from another endpoint"))
	require.Equal(t, 1, p.exploreStart,
		"the discard advanced the next round's start past the endpoint that could not close its own round (round-1 [high])")
	require.Equal(t, -1, p.preferredStart, "exploration, not attribution")
}

// THE ROUND-1 [high] REGRESSION, END TO END: endpoint 0 serves heads but
// PERMANENTLY fails eth_call, and a healthy endpoint 1 sits idle. Wave 1
// discarded each such round correctly and then re-resolved endpoint 0 every
// cadence — starving the poller forever. The property under test is not the
// first discard but RECOVERY: the discard must MOVE the round's starting
// point, and the NEXT cadence must land a FULL round (anchor + observations
// + cursor) through the healthy peer.
func TestPollerCoherenceDiscardMovesTheNextRoundToAHealthyPeer(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if idx == 0 {
			return nil, errors.New("endpoint 0 permanently fails eth_call") // heads fine, calls never
		}
		return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
	}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	// Round 1: resolved by endpoint 0 (the shared hint), whose pinned call
	// rotates onto endpoint 1 — a coherence breach, discarded.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "the discard is not an error")
	require.False(t, advanced)
	require.Empty(t, st.applied, "the first round discarded: nothing recorded")
	require.Equal(t, 1, p.exploreStart, "…and the discard moved the next round's start")
	require.True(t, containsSubstring(*msgs, "served the pinned multicall from another endpoint"))

	// Round 2, next cadence: the round resolves FROM endpoint 1 and lands in
	// full. This is the recovery the round-1 finding demanded — eventual
	// progress, not merely a correct discard repeated forever.
	clk.advance(time.Minute)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the next cadence landed a full round through the healthy peer")
	require.Equal(t, []int{0, 1}, ch.headStarts, "round 2 STARTED at the advanced exploration hint")
	require.Equal(t, []int{0, 1}, ch.headServed, "endpoint 1 resolved round 2")
	batch := st.lastBatch(t)
	require.Equal(t, uint64(5000), batch.through)
	require.Len(t, batch.obs, 20, "the full round's observations were written")
	require.NotNil(t, batch.anchor, "…anchored")
	require.Equal(t, uint64(5000), batch.anchor.BlockNumber)
	require.Equal(t, blockHashAt(5000).Bytes(), batch.anchor.BlockHash)
	require.Equal(t, uint64(5000), st.cursor, "…and the cursor advanced")
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
	require.Equal(t, -1, p.preferredStart, "no endpoint was ever ACCUSED: exploration is not attribution")
}

// THE SAME-HEIGHT SPLIT-FORK REGRESSION (round-1 [medium], the wave-2
// headline): ONE endpoint token, TWO backends behind it — the header path on
// fork A, the eth_call path on fork B, both at height N. Every wave-1 guard
// passes in that world: one token serves every read, the multicall reports
// blockNumber == N, and the bracketing header reads agree on fork A's hash.
// Only the EIP-1898 hash pin tells the two apart: fork B does not HAVE the
// block whose hash the round verified, so the pinned call is REJECTED
// ("block not found" — the class the live matrix observed on all four
// production endpoints, fabricated-hash negative controls included) and the
// round DISCARDS. Under a number pin this round would LAND — fork B's
// observations stored under fork A's hash, fabrication through the side
// door — which is exactly what the empty-store assertions below refuse.
func TestPollerHashPinRefusesASplitForkBackendAtTheSameHeight(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1}
	// The multicall response is fork B's state at the SAME height 5000:
	// blockNumber matches the pin, so the height guard alone cannot help.
	ch.respond = okRound(t, 5000, 20, 2_222_222)
	ch.setHead(5000) // the header path: fork A at 5000, hash blockHashAt(5000)
	// The call path executes on fork B: same HEIGHT, different BLOCK. Fork B
	// knows its own block at 5000 and has never heard of fork A's.
	forkB := ch.splitCallBackendOn(0)
	forkB.hashes[5000] = common.HexToHash("0xb10cb10c")
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a pin rejection is a DISCARD, not an error to burn the daemon's backoff on")
	require.False(t, advanced)
	require.Empty(t, st.applied,
		"fork B's observations must NEVER be stored under fork A's hash — the split backend passes every other guard, so this refusal is the hash pin's whole justification")
	require.Empty(t, st.rows)
	require.Empty(t, ch.served, "no backend lacking the pinned block ever executed the multicall")
	require.Equal(t, []common.Hash{blockHashAt(5000)}, ch.atHashes,
		"the call was pinned to the header path's hash — the identity fork B cannot satisfy")
	require.True(t, containsSubstring(*msgs, "pinned block unknown, discarding round"))
}

// A PIN REJECTION IS EXPLORATION-WORTHY INFORMATION (the F1 invariant on the
// F2 rejection arm): the serving endpoint's head named a block NO reachable
// backend could execute at — that node may be alone on a private fork — so
// beyond discarding, the NEXT round must start somewhere else. Here endpoint
// 0's header path sits on a private fork; the next cadence resolves endpoint
// 1 and lands a full round on the chain everyone else can see.
func TestPollerPinRejectionExploresAndTheNextRoundLandsElsewhere(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0, respond: okRound(t, 5000, 20, 1_000_000)}
	// Endpoint 0's HEADER path: a private fork at 5000 (scripted before
	// setHeadOn, which respects an existing hash). Its CALL path has never
	// heard of that block — and neither has endpoint 1.
	ch.setHashOn(0, 5000, common.HexToHash("0xa10e"))
	ch.setHeadOn(0, 5000)
	ch.splitCallBackendOn(0) // fork B: knows NO blocks at all
	ch.setHeadOn(1, 5000)    // endpoint 1: the canonical chain at the same height
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "the rejection is a discard, not an error")
	require.False(t, advanced)
	require.Empty(t, st.applied, "the rejected round recorded nothing")
	require.Equal(t, 1, p.exploreStart, "the rejection moved the next round's start")
	require.True(t, containsSubstring(*msgs, "pinned block unknown, discarding round"))

	clk.advance(time.Minute)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the next cadence landed through the other endpoint")
	require.Equal(t, []int{0, 1}, ch.headStarts)
	require.Equal(t, blockHashAt(5000).Bytes(), st.lastBatch(t).anchor.BlockHash,
		"the landed anchor is endpoint 1's verified header hash, not the private fork's")
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
}

// ---------------------------------------------------------------------------
// Task 9 wave 3: ONE routing invariant — landing is the only outcome that
// keeps the starting point (Codex round 2, both findings; controller ruling).
// ---------------------------------------------------------------------------

// ROUND-2 FINDING 1, END TO END: a STABLE same-token backend split — fork A
// answers the head read and executes the call, fork B answers the closing
// header, every cadence, behind ONE endpoint token — while a healthy peer
// sits idle. Wave 2 classified the before/after mismatch as chain movement
// and kept the starting point, so every cadence re-resolved the split URL
// and the poller starved indefinitely. The property under test is RECOVERY:
// the ambiguous discard moves the start, and the NEXT cadence lands a FULL
// round (anchor + observations + cursor) through the healthy peer.
func TestPollerStableSameTokenBackendSplitRecoversThroughTheHealthyPeer(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	forkB := common.HexToHash("0xb10cb10c")
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if idx == 0 {
			// The OTHER backend behind the same URL answers the closing
			// header — EVERY cadence, not once: whatever the head read saw,
			// the close sees the other fork. The split is stable, so without
			// the routing advance no round through this URL can ever land.
			if ch.view(0).hashes[5000] == forkB {
				ch.setHashOn(0, 5000, blockHashAt(5000))
			} else {
				ch.setHashOn(0, 5000, forkB)
			}
		}
		return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
	}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	// Round 1: resolved by endpoint 0 (the shared hint); the close reads fork
	// B's block — an ambiguous mismatch, discarded, AND the start moves.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "the ambiguous discard is not an error")
	require.False(t, advanced)
	require.Empty(t, st.applied, "nothing recorded through the split URL")
	require.True(t, containsSubstring(*msgs, "changed between the round's bracketing reads"))
	require.Equal(t, 1, p.exploreStart, "…and the mismatch moved the next round's start")
	require.Equal(t, -1, p.preferredStart, "no attribution: the mismatch is ambiguous evidence")

	// Round 2, next cadence: resolves the healthy peer and lands in full —
	// eventual progress, not a correct discard repeated forever.
	clk.advance(time.Minute)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the next cadence landed a full round through the healthy peer")
	require.Equal(t, []int{0, 1}, ch.headStarts, "round 2 STARTED at the advanced exploration hint")
	require.Equal(t, []int{0, 1}, ch.headServed, "endpoint 1 resolved round 2")
	batch := st.lastBatch(t)
	require.Equal(t, uint64(5000), batch.through)
	require.Len(t, batch.obs, 20, "the full round's observations were written")
	require.NotNil(t, batch.anchor)
	require.Equal(t, blockHashAt(5000).Bytes(), batch.anchor.BlockHash,
		"the landed anchor is the healthy peer's verified hash, not either of the split URL's forks")
	require.Equal(t, uint64(5000), st.cursor)
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
	require.Equal(t, -1, p.preferredStart, "no endpoint was ever accused")
}

// ROUND-2 FINDING 2, END TO END: a TRAILING TRANSPORT FAILURE MASKS the
// recognized rejection class. Endpoint 0's head names a private-fork block A;
// its own call path rejects the pin with the recognized "block not found"
// wording — but the failover walk keeps only the LAST endpoint's error, and
// endpoint 1's call path fails with a transport error. Wave 2 advanced the
// start only when isBlockNotFoundErr recognized the FINAL error, so this
// round took the error posture with routing untouched and every later
// cadence resolved endpoint 0 again — even though endpoint 1 would land from
// its own canonical head B. The seam advances on the un-recognized failure
// too: posture and routing are separate concerns.
func TestPollerMixedRejectionTransportFailureRecoversThroughThePeersOwnHead(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0, respond: okRound(t, 5000, 20, 1_000_000)}
	// Endpoint 0's HEADER path: a private fork at 5000 (scripted before
	// setHeadOn, which respects an existing hash). Its CALL path has never
	// heard of that block — the recognized rejection…
	ch.setHashOn(0, 5000, common.HexToHash("0xa10e"))
	ch.setHeadOn(0, 5000)
	ch.splitCallBackendOn(0)
	ch.setHeadOn(1, 5000) // endpoint 1: the canonical chain, its own head B
	// …and endpoint 1's call path is briefly unreachable, so the walk's FINAL
	// error — the only one the failover layer surfaces — is transport.
	peerCalls := ch.splitCallBackendOn(1)
	peerCalls.down = errors.New("connection reset by peer")
	p, clk := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.ErrorContains(t, err, "connection reset by peer",
		"the surfaced error is the transport failure: the recognized rejection wording is masked")
	require.Empty(t, st.applied)
	require.Equal(t, 1, p.exploreStart,
		"routing must not depend on RECOGNIZING the failure: the un-landed round advanced the start anyway (round-2 finding 2)")
	require.Equal(t, -1, p.preferredStart)

	// The transport blip passes: endpoint 1's call path serves its own
	// canonical chain again.
	peerCalls.down = nil
	peerCalls.hashes[5000] = blockHashAt(5000)

	clk.advance(time.Minute)
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the next cadence landed through endpoint 1's OWN head B")
	require.Equal(t, []int{0, 1}, ch.headStarts, "round 2 started at the advanced hint")
	require.Equal(t, blockHashAt(5000).Bytes(), st.lastBatch(t).anchor.BlockHash,
		"the landed anchor is the peer's canonical head, not the private fork's")
	require.Equal(t, uint64(5000), st.cursor)
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
}

// A MALFORMED MULTICALL ENVELOPE has the same unchanged-routing shape as the
// masked rejection (round-2 finding 2's list): the round takes the ERROR
// posture — a broken provider is an operator-visible fault — and the seam
// still moves the start, so the next cadence lands through the peer instead
// of re-resolving the endpoint that served garbage.
func TestPollerMalformedEnvelopeAdvancesAndTheNextRoundLandsElsewhere(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if idx == 0 {
			// Served without transport error, so no rotation: the round's own
			// endpoint answers with an undecodable envelope.
			return []byte{0xde, 0xad, 0xbe, 0xef}, nil
		}
		return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
	}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.ErrorContains(t, err, "unpack multicall result", "a malformed envelope keeps the error posture")
	require.False(t, advanced)
	require.Empty(t, st.applied)
	require.Equal(t, 1, p.exploreStart, "…and the error still moved the next round's start")
	require.Equal(t, -1, p.preferredStart)

	clk.advance(time.Minute)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the next cadence landed through the peer")
	require.Equal(t, []int{0, 1}, ch.headStarts)
	require.Equal(t, blockHashAt(5000).Bytes(), st.lastBatch(t).anchor.BlockHash)
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
}

// A TOTAL CLOSING-HEADER FAILURE — the re-read of the pin cannot be answered
// by ANY endpoint — is the last of round-2 finding 2's named shapes: an error
// (the round cannot prove its pin stayed canonical), and the seam still
// moves the start. The next cadence lands through the peer's OWN head, which
// its header path serves fine.
func TestPollerClosingHeaderFailureAdvancesAndTheNextRoundLandsElsewhere(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if idx == 0 {
			// The header path at the pin dies mid-round on EVERY endpoint:
			// the closing re-read has nowhere to go. (Head reads at 5001 are
			// untouched, so the peer still resolves next cadence.)
			ch.failProbe(5000, errors.New("header 5000 lost mid-round"))
			return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
		}
		return okRound(t, 5001, 20, 1_000_000)(idx, to, data)
	}
	ch.setHeadOn(0, 5000)
	ch.setHeadOn(1, 5001) // the peer is one block ahead: its own head, its own hash
	p, clk := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.ErrorContains(t, err, "re-read header 5000", "a total closing failure keeps the error posture")
	require.False(t, advanced)
	require.Empty(t, st.applied)
	require.Equal(t, 1, p.exploreStart, "…and the error still moved the next round's start")
	require.Equal(t, -1, p.preferredStart)

	clk.advance(time.Minute)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the next cadence landed through the peer's own head")
	require.Equal(t, []int{0, 1}, ch.headStarts)
	batch := st.lastBatch(t)
	require.Equal(t, uint64(5001), batch.through)
	require.Equal(t, blockHashAt(5001).Bytes(), batch.anchor.BlockHash)
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
}

// THE PRINCIPLE TEST — the class-closer. Every currently reachable
// post-resolution non-landing exit of readRound, table-driven, with ONE
// uniform assertion block: the round records nothing, and the caller-scoped
// exploration start ADVANCES past the round's endpoint. What varies per row
// is only the injected failure shape and the error POSTURE the classifier
// picks; the routing assertion never varies, because the invariant does not:
// LANDING IS THE ONLY OUTCOME THAT KEEPS THE STARTING POINT.
//
// The advance is applied by readRound's single deferred seam, so a NEW
// failure arm forgetting routing is structurally impossible — it would have
// to mark itself landed to dodge the defer, and rows driven through the seam
// fail the moment any exit keeps the start. Two controls bracket the table:
// a landed round KEEPS the start, and a pre-resolution failure (no serving
// endpoint exists yet) moves nothing, because the invariant begins at
// resolution and there is nothing to advance past on a total outage.
func TestPollerEveryNonLandingOutcomeAdvancesTheRoundsStartingPoint(t *testing.T) {
	privateHash := common.HexToHash("0xa10e")
	cases := []struct {
		name    string
		arrange func(ch *fakePollChain)
		wantErr string // "" = the discard posture; otherwise the error posture's wording
	}{
		{
			name: "hash-pin rejection: no reachable backend has the serving head's block",
			arrange: func(ch *fakePollChain) {
				ch.setHashOn(0, 5000, privateHash) // endpoint 0's head names a private-fork block…
				ch.splitCallBackendOn(0)           // …its own call path has never heard of
			},
		},
		{
			name: "ambiguous bracketing-hash mismatch: the close reads another fork",
			arrange: func(ch *fakePollChain) {
				prev := ch.respond
				ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
					ch.setHashOn(0, 5000, common.HexToHash("0xfeed"))
					return prev(idx, to, data)
				}
			},
		},
		{
			name: "multicall answered by another endpoint",
			arrange: func(ch *fakePollChain) {
				prev := ch.respond
				ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
					if idx == 0 {
						return nil, errors.New("endpoint 0 dropped the call")
					}
					return prev(idx, to, data)
				}
			},
		},
		{
			name: "execution block diverged from the pin",
			arrange: func(ch *fakePollChain) {
				ch.respond = okRound(t, 4999, 20, 1_000_000)
			},
		},
		{
			name: "closing re-read answered by another endpoint",
			arrange: func(ch *fakePollChain) {
				prev := ch.respond
				ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
					ch.failProbeOn(0, 5000, errors.New("endpoint 0 lost header 5000"))
					return prev(idx, to, data)
				}
			},
		},
		{
			name: "zero header hash at the head read (provider protocol violation)",
			arrange: func(ch *fakePollChain) {
				ch.setHashOn(0, 5000, common.Hash{})
			},
			wantErr: "header hash at 5000 is zero",
		},
		{
			name: "trailing transport failure masks a recognized rejection",
			arrange: func(ch *fakePollChain) {
				ch.setHashOn(0, 5000, privateHash)
				// Endpoint 0 rejects with the recognized class; endpoint 1's
				// transport failure is the LAST error and masks it.
				ch.splitCallBackendOn(0)
				ch.splitCallBackendOn(1).down = errors.New("connection reset by peer")
			},
			wantErr: "connection reset by peer",
		},
		{
			name: "out-of-class rejection wording (fail-closed error posture)",
			arrange: func(ch *fakePollChain) {
				ch.splitCallBackendOn(0).down = errors.New("state pruned at requested height")
				ch.splitCallBackendOn(1).down = errors.New("state pruned at requested height")
			},
			wantErr: "state pruned",
		},
		{
			name: "total transport failure on the pinned call",
			arrange: func(ch *fakePollChain) {
				ch.respond = func(int, common.Address, []byte) ([]byte, error) {
					return nil, errors.New("eth_call transport failure")
				}
			},
			wantErr: "eth_call transport failure",
		},
		{
			name: "malformed multicall envelope",
			arrange: func(ch *fakePollChain) {
				ch.respond = func(int, common.Address, []byte) ([]byte, error) {
					return []byte{0xde, 0xad, 0xbe, 0xef}, nil
				}
			},
			wantErr: "unpack multicall result",
		},
		{
			name: "closing header re-read fails on every endpoint",
			arrange: func(ch *fakePollChain) {
				prev := ch.respond
				ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
					ch.failProbe(5000, errors.New("header path lost mid-round"))
					return prev(idx, to, data)
				}
			},
			wantErr: "re-read header 5000",
		},
		{
			name: "zero header hash on the close",
			arrange: func(ch *fakePollChain) {
				prev := ch.respond
				ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
					ch.setHashOn(0, 5000, common.Hash{})
					return prev(idx, to, data)
				}
			},
			wantErr: "header hash at 5000 is zero",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := newFakePriceStore()
			ch := &fakePollChain{endpoints: 2, active: 0, respond: okRound(t, 5000, 20, 1_000_000)}
			ch.setHead(5000)
			tc.arrange(ch)
			p, _ := newTestPoller(t, st, ch, 10)
			captureWarnings(t)

			advanced, err := p.Step(context.Background())
			if tc.wantErr == "" {
				require.NoError(t, err, "this exit's classified posture is a discard")
			} else {
				require.ErrorContains(t, err, tc.wantErr, "this exit's classified posture is an error")
			}
			require.False(t, advanced)
			require.Empty(t, st.applied, "a round that did not land records nothing")
			require.Equal(t, []int{0}, ch.headServed, "endpoint 0 resolved the round")
			require.Equal(t, 1, p.exploreStart,
				"LANDING IS THE ONLY OUTCOME THAT KEEPS THE STARTING POINT: this exit did not land, so the start must have moved past the round's endpoint")
			require.Equal(t, -1, p.preferredStart,
				"the advance is exploration, never attribution: no failure shape may accuse an endpoint")
			require.Equal(t, 0, ch.active,
				"the shared routing hint is never written by a caller-scoped round (d1e7d54)")
		})
	}

	t.Run("control: a landed round keeps the starting point", func(t *testing.T) {
		st := newFakePriceStore()
		ch := &fakePollChain{endpoints: 2, active: 0, respond: okRound(t, 5000, 20, 1_000_000)}
		ch.setHead(5000)
		p, _ := newTestPoller(t, st, ch, 10)

		advanced, err := p.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced)
		require.Equal(t, -1, p.exploreStart, "the landed round kept the starting point")
		require.Equal(t, -1, p.preferredStart)
	})
	t.Run("control: a pre-resolution failure moves nothing", func(t *testing.T) {
		st := newFakePriceStore()
		ch := &fakePollChain{endpoints: 2, active: 0, respond: okRound(t, 5000, 20, 1_000_000)}
		ch.setHead(5000)
		ch.failAll(errors.New("every endpoint unreachable"))
		p, _ := newTestPoller(t, st, ch, 10)

		advanced, err := p.Step(context.Background())
		require.ErrorContains(t, err, "resolve serving endpoint head")
		require.False(t, advanced)
		require.Equal(t, -1, p.exploreStart,
			"the invariant begins AT resolution: no serving endpoint exists, so there is nothing to advance past, and guessing would churn the start on every total outage")
	})
}

// LIVENESS WITH BOTH ENDPOINTS HALF-BROKEN (round-2 question (a), held over
// to this wave): every endpoint serves heads and fails every pinned call, so
// every round takes a non-landing exit and the advance PING-PONGS across the
// fleet. The property is that the ping-pong keeps REVISITING each endpoint —
// no oscillation lock may park the start and exclude a broken endpoint
// forever — because that revisiting is exactly what makes recovery
// observable: when one endpoint comes back, a round lands through it within
// one rotation of the fleet, bounded by the endpoint count and not by luck.
func TestPollerBothEndpointsHalfBrokenPingPongsAndObservesRecovery(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	recovered := false
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if recovered && idx == 1 {
			return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
		}
		return nil, fmt.Errorf("eth_call unavailable on endpoint %d", idx)
	}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	// Phase 1: four cadences with every call path down. Each round errors,
	// and the start alternates — endpoint 0, endpoint 1, endpoint 0 again:
	// both broken endpoints keep being retried.
	for i := 0; i < 4; i++ {
		_, err := p.Step(context.Background())
		require.Error(t, err, "round %d: every call path is down", i+1)
		require.Equal(t, (i+1)%2, p.exploreStart,
			"round %d: the non-landing round advanced the start past its serving endpoint", i+1)
		require.Equal(t, -1, p.preferredStart, "round %d: an outage accuses nobody", i+1)
		clk.advance(time.Minute)
	}
	require.Equal(t, []int{0, 1, 0, 1}, ch.headStarts,
		"the advance ping-pongs: each half-broken endpoint is revisited, never excluded forever")
	require.Equal(t, []int{0, 1, 0, 1}, ch.headServed)
	require.Empty(t, st.applied, "nothing landed while both call paths were down")

	// Phase 2: endpoint 1 recovers while the start is parked on endpoint 0 —
	// the worst case for an oscillation lock. The round through endpoint 0
	// still cannot land (its call rotates onto the recovered peer: a
	// coherence discard), but it advances, and the NEXT round resolves the
	// recovered endpoint and lands in full.
	recovered = true
	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "the coherence breach is a discard, not an error")
	require.False(t, advanced)
	clk.advance(time.Minute)

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "recovery was observed within one rotation of the fleet")
	require.Equal(t, []int{0, 1, 0, 1, 0, 1}, ch.headStarts)
	require.Equal(t, uint64(5000), st.cursor, "the recovered endpoint's round landed in full")
	require.Equal(t, blockHashAt(5000).Bytes(), st.lastBatch(t).anchor.BlockHash)
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
	require.Equal(t, -1, p.preferredStart, "nothing was ever accused across the whole outage")
}

// ---------------------------------------------------------------------------
// Task 9 wave 4: ONE CLASSIFICATION AUTHORITY PER ROUND OUTCOME (Codex round
// 3 [medium], accepted). The round's posture is computed from the AGGREGATE
// of per-attempt pinned-call outcomes: the discard posture ONLY when every
// failed attempt is a recognized pin rejection; ANY transport or unknown
// involvement retains the error posture, so the daemon's backoff streak
// grows and step_error stays visible. The deferred routing advance applies
// to BOTH postures — the wave-3 seam is closed law and is untouched here.
// ---------------------------------------------------------------------------

// Mirrored from cmd/indexer/main.go — the daemon worker wrapper's scheduling
// constants (retryBackoffBase / retryBackoffCap / retryBackoffJitter and
// stepsPerRound). Mirrored rather than imported because the wrapper lives in
// package main, which no test outside it can import.
const (
	harnessBackoffBase   = 30 * time.Second
	harnessBackoffCap    = 10 * time.Minute
	harnessBackoffJitter = 0.20
	harnessStepsPerRound = 5
)

// harnessBackoff mirrors cmd/indexer's retryBackoff VERBATIM: ready() is
// state-free, failure() schedules base·2^(failures-1) capped and jittered,
// success() resets. Tests pin rand to 0.5, which zeroes the ±20% jitter term
// exactly (the health harness's own convention), so every delay below is
// deterministic.
type harnessBackoff struct {
	now      func() time.Time
	rand     func() float64
	failures int
	next     time.Time
}

func (b *harnessBackoff) ready() bool { return !b.now().Before(b.next) }

func (b *harnessBackoff) failure() time.Duration {
	b.failures++
	d := harnessBackoffCap
	if shift := b.failures - 1; shift < 10 {
		if scaled := harnessBackoffBase << shift; scaled < harnessBackoffCap {
			d = scaled
		}
	}
	d = time.Duration(float64(d) * (1 + harnessBackoffJitter*(2*b.rand()-1)))
	b.next = b.now().Add(d)
	return d
}

func (b *harnessBackoff) success() {
	b.failures = 0
	b.next = time.Time{}
}

// daemonWorkerHarness drives the REAL Poller through the daemon's price-
// worker wrapper composition — cmd/indexer's priceWorkerState + retryBackoff
// + stepPriceWorkers, mirrored verbatim for one worker (the wave-13/15
// health-harness precedent: drive the real component, and assert on the
// contract its REAL consumer derives from it). It is replicated here rather
// than imported because the wrapper lives in package main; the composition
// below is stepPriceWorkers' exactly: when the backoff deadline has passed,
// Step up to stepsPerRound times stopping at the first error or the first
// non-advancing Step; a non-nil, non-canceled error consumes one backoff
// unit and is RETAINED; a clean round (landed OR discarded — the daemon
// cannot tell them apart, which is the whole point of the posture rules)
// resets the streak and clears the retention; and the step_error condition
// is recomputed from the retained error every daemon round, INCLUDING rounds
// spent waiting out the backoff window, carrying the consecutive count.
type daemonWorkerHarness struct {
	p       *Poller
	clk     *testClock
	bo      harnessBackoff
	lastErr error
	retryIn time.Duration
	// stepError is the step_error condition as the daemon would publish it
	// after the most recent round ("" = condition absent).
	stepError string
}

func newDaemonWorkerHarness(p *Poller, clk *testClock) *daemonWorkerHarness {
	return &daemonWorkerHarness{
		p:   p,
		clk: clk,
		bo:  harnessBackoff{now: clk.now, rand: func() float64 { return 0.5 }},
	}
}

// round is ONE daemon pass over the worker — stepPriceWorkers' loop body for
// a single priceWorkerState.
func (h *daemonWorkerHarness) round(ctx context.Context) {
	if h.bo.ready() {
		roundErred := false
		var lastErr error
		for i := 0; i < harnessStepsPerRound; i++ {
			advanced, err := h.p.Step(ctx)
			if err != nil {
				if !errors.Is(err, context.Canceled) { // canceled = shutdown: no backoff, no entry
					roundErred, lastErr = true, err
				}
				break
			}
			if !advanced {
				break
			}
		}
		if roundErred {
			delay := h.bo.failure()
			h.lastErr, h.retryIn = lastErr, delay
		} else {
			h.bo.success()
			h.lastErr, h.retryIn = nil, 0
		}
	}
	h.stepError = ""
	if h.lastErr != nil {
		h.stepError = fmt.Sprintf("Step failed %d consecutive round(s), retrying in %s: %v",
			h.bo.failures, h.retryIn.Truncate(time.Second), h.lastErr)
	}
}

// tick advances the shared clock far enough that BOTH gates reopen — the
// poller's own cadence and the wrapper's backoff deadline — so the next
// round() makes a real attempt. The daemon reaches the same state by ticking
// every interval and republishing the retained step_error in between; those
// waiting rounds are exercised by the mid-window assertions below.
func (h *daemonWorkerHarness) tick() {
	d := time.Minute // the poller's cadence (newTestPoller's Interval)
	if h.retryIn > d {
		d = h.retryIn
	}
	h.clk.advance(d)
}

// CODEX ROUND 3'S HEADLINE, ORDER A (transport, then rejection): endpoint 0
// serves heads but transport-fails every pinned call; endpoint 1 serves
// heads but REJECTS every pin with the recognized wording. The walk from
// endpoint 0 surfaces the rejection LAST, so last-error-wins misread this
// persistent mixed outage as a clean discard on its very first round: the
// daemon reset retryBackoff and cleared step_error, and because the deferred
// routing advance rotates the walk's start every round, the misread recurred
// every other cadence — retries never approached the 10-minute cap and
// failure visibility flickered. The aggregate classification reads the SAME
// walk as transport-involved and keeps the error posture in BOTH orders:
// driven through the daemon worker wrapper, the backoff streak grows
// monotonically with the exponential pacing intact, step_error stays visible
// on every round (mid-backoff-window rounds included), and the seam still
// advances routing every non-landing round.
func TestPollerMixedOutageTransportThenRejectionNeverResetsTheDaemonBackoff(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		return nil, fmt.Errorf("connection reset by peer (endpoint %d)", idx)
	}
	ch.setHead(5000)         // both endpoints agree on the canonical chain
	ch.splitCallBackendOn(1) // endpoint 1's call path knows NO blocks: every pin rejected
	p, clk := newTestPoller(t, st, ch, 10)
	h := newDaemonWorkerHarness(p, clk)

	for i := 1; i <= 4; i++ {
		h.round(context.Background())
		require.Equal(t, i, h.bo.failures,
			"round %d: transport involvement retains the ERROR posture, so the streak grows and never resets", i)
		require.Equal(t, harnessBackoffBase<<(i-1), h.retryIn,
			"round %d: the exponential outage pacing is preserved toward the cap", i)
		require.Contains(t, h.stepError, fmt.Sprintf("Step failed %d consecutive round(s)", i),
			"round %d: step_error is visible and carries the honest streak", i)
		require.Equal(t, i%2, p.exploreStart,
			"round %d: the seam still advances routing on EVERY non-landing round (both postures)", i)
		require.Equal(t, -1, p.preferredStart, "round %d: exploration, never attribution", i)
		switch i {
		case 1:
			// The walk started at endpoint 0: the recognized rejection was the
			// LAST error — exactly the shape last-error-wins misread as a
			// unanimous rejection and discarded. The posture stayed ERROR.
			require.Contains(t, h.stepError, "not found on endpoint 1",
				"round 1 surfaced the rejection last and STILL kept the error posture")
		case 2:
			// The advanced start reversed the walk: transport last. Same
			// posture — order-independence is the property under test.
			require.Contains(t, h.stepError, "connection reset by peer (endpoint 0)",
				"round 2 surfaced the transport failure last: same outage, same posture")
			// A daemon round INSIDE the backoff window: no Step is attempted,
			// and the retained step_error stays published — visibility does
			// not flicker between attempts.
			steps := len(ch.headStarts)
			clk.advance(time.Second)
			h.round(context.Background())
			require.Len(t, ch.headStarts, steps, "no Step attempt inside the backoff window")
			require.Contains(t, h.stepError, "Step failed 2 consecutive round(s)",
				"step_error stays visible for the whole backoff window")
		}
		h.tick()
	}
	require.Equal(t, []int{0, 1, 0, 1}, ch.headStarts,
		"the alternation Codex described: the deferred advance rotates the start every round — and the posture no longer alternates with it")
	require.Empty(t, st.applied, "nothing landed across the whole outage")

	// The outage ends: endpoint 0's call path serves again. The wrapper's
	// next round lands through it, the streak resets, step_error clears.
	ch.respond = okRound(t, 5000, 20, 1_000_000)
	h.round(context.Background())
	require.Zero(t, h.bo.failures, "recovery resets the streak")
	require.Empty(t, h.stepError, "…and clears step_error")
	require.Equal(t, uint64(5000), st.cursor, "the recovered round landed in full")
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
}

// ORDER B, THE MIRROR (rejection, then transport): endpoint 0 REJECTS every
// pin, endpoint 1 transport-fails every call. Round 1's walk (from endpoint
// 0) surfaces the transport failure last — the order last-error-wins already
// classified as an error — and round 2's walk (from the advanced start at
// endpoint 1) surfaces the RECOGNIZED REJECTION last, which is where the old
// classification flipped to a discard, reset the backoff streak mid-outage
// and blanked step_error. The aggregate holds the error posture across the
// whole alternation: the streak is monotone through round 2 and beyond, and
// step_error never disappears while the outage persists.
func TestPollerMixedOutageRejectionThenTransportKeepsStepErrorAcrossAlternation(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		return nil, fmt.Errorf("connection reset by peer (endpoint %d)", idx)
	}
	ch.setHead(5000)
	ch.splitCallBackendOn(0) // endpoint 0's call path knows NO blocks: every pin rejected
	p, clk := newTestPoller(t, st, ch, 10)
	h := newDaemonWorkerHarness(p, clk)

	for i := 1; i <= 4; i++ {
		h.round(context.Background())
		require.Equal(t, i, h.bo.failures,
			"round %d: the streak is monotone — in particular it must NOT reset at round 2, where the rejection runs last", i)
		require.NotEmpty(t, h.stepError,
			"round %d: step_error never disappears while the outage persists", i)
		require.Equal(t, i%2, p.exploreStart,
			"round %d: routing still advances every non-landing round", i)
		switch i {
		case 1:
			require.Contains(t, h.stepError, "connection reset by peer (endpoint 1)",
				"round 1 surfaced the transport failure last")
		case 2:
			require.Contains(t, h.stepError, "not found on endpoint 0",
				"round 2 surfaced the recognized rejection last — the old classification's discard trigger — and the posture STAYED the error")
			require.Contains(t, h.stepError, "Step failed 2 consecutive round(s)",
				"…so the streak the daemon reports did not restart")
		}
		h.tick()
	}
	require.Equal(t, []int{0, 1, 0, 1}, ch.headStarts, "both walk orders were exercised by the alternation")
	require.Equal(t, harnessBackoffBase<<3, h.retryIn, "four uninterrupted failures: the delay kept doubling")
	require.Empty(t, st.applied)
}

// THE ALL-REJECTIONS ROUND STILL DISCARDS CLEANLY: unanimity is the one
// shape whose honest posture is the WARN discard — the serving endpoint's
// head named a block NO attempted endpoint has, which may mean that node is
// alone on its fork and is not a fault to burn the daemon's backoff on.
// Driven through the wrapper right after a genuine mixed-outage streak: the
// unanimous-rejection round reads as a clean round (nil), the streak resets,
// step_error clears — and the seam still advances routing, every time.
func TestPollerAllRejectionsRoundStillDiscardsCleanlyThroughTheDaemonWrapper(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 2, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		return nil, fmt.Errorf("connection reset by peer (endpoint %d)", idx)
	}
	ch.setHead(5000)
	ch.splitCallBackendOn(1) // endpoint 1 rejects; endpoint 0 transport-fails
	p, clk := newTestPoller(t, st, ch, 10)
	h := newDaemonWorkerHarness(p, clk)
	msgs := captureWarnings(t)

	// Phase 1: two mixed rounds build a genuine streak (the tests above pin
	// this in detail; here it is the CONTRAST for the reset that follows).
	for i := 1; i <= 2; i++ {
		h.round(context.Background())
		require.Equal(t, i, h.bo.failures, "round %d: the mixed outage errs", i)
		h.tick()
	}

	// Phase 2: endpoint 0's call path stops carrying the pinned block too —
	// the walk is now a UNANIMOUS recognized rejection on every attempt.
	ch.splitCallBackendOn(0)
	h.round(context.Background())
	require.Zero(t, h.bo.failures,
		"a unanimous rejection is a clean discard: the wrapper reads nil and resets the streak")
	require.Empty(t, h.stepError, "…and step_error clears")
	require.True(t, containsSubstring(*msgs, "pinned block unknown, discarding round"),
		"the discard is a WARN with the evidence, not silence")
	require.Equal(t, 1, p.exploreStart,
		"the seam advanced on the discard too: routing moves on EVERY non-landing round")
	require.Equal(t, -1, p.preferredStart, "exploration, never attribution")

	// Multi-cadence: the unanimous rejection repeats cleanly, ping-ponging
	// the start, with no backoff and no step_error for as long as it stays
	// unanimous.
	h.tick()
	h.round(context.Background())
	require.Zero(t, h.bo.failures)
	require.Empty(t, h.stepError)
	require.Equal(t, 0, p.exploreStart, "the discard kept advancing the start")
	require.Empty(t, st.applied, "no rejected round ever recorded anything")
}

// THE ZERO-HASH REFUSAL LIVES ON THE HEADER PATH NOW (moved from the multicall
// decoder, where it refused every real-chain round): a header whose hash is
// zero is a provider protocol violation, and an anchor holding it would
// "verify" against nothing during reorg repair. Both bracketing reads are
// guarded; both are ERRORS, not discards — the provider is broken, and the
// operator should see it as a fault.
func TestPollerRefusesZeroHeaderHash(t *testing.T) {
	t.Run("before", func(t *testing.T) {
		st := newFakePriceStore()
		ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
		ch.setHashOn(0, 5000, common.Hash{}) // scripted BEFORE setHeadOn, which respects it
		ch.setHeadOn(0, 5000)
		p, _ := newTestPoller(t, st, ch, 10)

		advanced, err := p.Step(context.Background())
		require.ErrorContains(t, err, "header hash at 5000 is zero")
		require.False(t, advanced)
		require.Empty(t, st.applied)
		require.Empty(t, ch.calls, "the round was refused before any multicall was issued")
	})
	t.Run("after", func(t *testing.T) {
		st := newFakePriceStore()
		ch := &fakePollChain{endpoints: 1}
		ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
			// The endpoint degrades mid-round: the closing re-read gets zero.
			ch.setHashOn(0, 5000, common.Hash{})
			return okRound(t, 5000, 20, 1_000_000)(idx, to, data)
		}
		ch.setHead(5000)
		p, _ := newTestPoller(t, st, ch, 10)

		advanced, err := p.Step(context.Background())
		require.ErrorContains(t, err, "header hash at 5000 is zero")
		require.False(t, advanced)
		require.Empty(t, st.applied)
	})
}

// The ETH poller's only obligation is the weETH getRate() ratio — recorded as
// its OWN row at 18 decimals, never composed with the stream price.
func TestPollerETHRatioRow(t *testing.T) {
	st := newFakePriceStore()
	rate := new(big.Int)
	rate.SetString("1069000000000000000", 10)
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		return encodeMulticall(t, 900, []mcRet{{Success: true, ReturnData: encodeUint256(t, rate)}}), nil
	}}
	ch.setHead(900)
	p, _ := newTestPoller(t, st, ch, 1)

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	_, calls := decodeMulticallCalls(t, ch.calls[0].data)
	require.Len(t, calls, 1)
	require.Equal(t, weethETH, calls[0].Target, "getRate() is read on the weETH contract itself")
	wantData, err := rateProviderABI.Pack("getRate")
	require.NoError(t, err)
	require.Equal(t, wantData, calls[0].CallData)

	batch := st.lastBatch(t)
	require.Len(t, batch.obs, 1)
	require.Equal(t, weethETH.Bytes(), batch.obs[0].Asset)
	require.Equal(t, RatioSource("getRate()", weethETH), batch.obs[0].Source)
	require.Equal(t, int32(18), batch.obs[0].Decimals)
	require.Equal(t, rate.String(), batch.obs[0].Price.String())
}

// An individual revert is a per-asset skip, not a round failure: the other 19
// assets still get their prices.
func TestPollerRevertIsPerAsset(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		rets[3] = mcRet{Success: false} // one broken oracle
		return encodeMulticall(t, 5000, rets), nil
	}}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.lastBatch(t).obs, 19, "the reverting asset is skipped, the rest land")
	require.True(t, containsSubstring(*msgs, "oracle read reverted"))
}

// A well-formed envelope carrying an UNDECODABLE inner return is the same
// per-asset posture as a revert — the round must not lose 19 good prices to one
// malformed one.
func TestPollerUndecodableInnerReturnIsPerAsset(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		rets[7] = mcRet{Success: true, ReturnData: []byte{0x01, 0x02}} // short word
		return encodeMulticall(t, 5000, rets), nil
	}}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, st.lastBatch(t).obs, 19)
	require.True(t, containsSubstring(*msgs, "oracle return did not decode"))
}

// Every oracle failing is DEGRADED but still applies: the cursor is a reorg-ack
// anchor, and stalling it would wedge the epoch gate on an oracle outage.
func TestPollerAllFailedStillAdvancesCursor(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: false}
		}
		return encodeMulticall(t, 5000, rets), nil
	}}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Empty(t, st.lastBatch(t).obs)
	require.Equal(t, uint64(5000), st.lastBatch(t).through)
	require.True(t, containsSubstring(*msgs, "every oracle read failed"))
}

// B1 (ALL TARGETS, MULTIPLE INTERVALS): an empty batch advances the cursor but is
// NOT a landed round. Health must therefore FAIL once the grace window passes,
// where the old round-level anchor kept it green forever with no price recorded.
func TestPollerHealthFailsWhenEveryOracleKeepsFailing(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1}
	block := uint64(5000)
	ch.respond = func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: false}
		}
		return encodeMulticall(t, block, rets), nil
	}
	p, clk := newTestPoller(t, st, ch, 10)

	// Four consecutive intervals in which every oracle reverts.
	for i := 0; i < 4; i++ {
		ch.setHead(block)
		advanced, err := p.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced, "the cursor still advances for the epoch ack")
		block += 100
		clk.advance(time.Minute)
	}
	require.Equal(t, uint64(5300), st.cursor, "cursor moved every round")

	healthy, reason := p.Health()
	require.False(t, healthy, "no price was ever recorded: health must not be green")
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRound, "the round-level condition names the total outage")
	require.Contains(t, got, ConditionPollTargetFreshness, "and every asset is individually unpriced")
	require.Contains(t, reason, "never priced")
}

// B1 (SINGLE TARGET, MULTIPLE INTERVALS): one asset failing while the others
// succeed was invisible — rounds kept committing, so the round anchor stayed
// fresh. Per-asset freshness catches it and NAMES the asset.
func TestPollerHealthFailsForOneStaleAssetWhileOthersLand(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1}
	block := uint64(5000)
	ch.respond = func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		rets[2] = mcRet{Success: false} // weETH: the third registry asset on OP
		return encodeMulticall(t, block, rets), nil
	}
	p, clk := newTestPoller(t, st, ch, 10)

	for i := 0; i < 5; i++ {
		ch.setHead(block)
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		block += 100
		clk.advance(time.Minute)
	}

	healthy, reason := p.Health()
	require.False(t, healthy, "one asset has had no price for five intervals")
	got := pollConditions(p)
	require.NotContains(t, got, ConditionPollRound, "rounds ARE landing: this is a partial failure, not an outage")
	require.Contains(t, got, ConditionPollTargetFreshness)
	broken := realFeeds(t).PollAssets(10)[2]
	require.Contains(t, reason, broken.Symbol)
	require.Contains(t, reason, broken.Address.Hex())
	require.Contains(t, got[ConditionPollTargetFreshness], "1 of 20 registry assets")
}

// B1/B2 CLASS (RESTART): a poller that comes up with a STALE durable row must not
// measure that asset from its own start time. Freshness is hydrated from the
// rows, so an asset last priced long ago is unhealthy immediately — no fresh
// grace window per restart.
func TestPollerHydratesStaleFreshnessAcrossRestart(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	// A previous process priced every asset, but one of them last landed hours
	// ago while the rest are current.
	assets := realFeeds(t).PollAssets(10)
	for i, a := range assets {
		at := clk.now()
		if i == 4 {
			at = clk.now().Add(-6 * time.Hour)
		}
		st.seedRow(PollCursorEngine(10), a.Address.Bytes(), SourcePriceProviderV2, 4900, at)
	}
	st.cursor, st.cursorFound = 4900, true
	// Make the round NOT due so only hydration can act.
	p.lastAttempt = clk.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "no round was due")
	require.Equal(t, 1, st.freshnessCalls, "freshness was hydrated from durable rows")

	healthy, reason := p.Health()
	require.False(t, healthy, "a restart must not reset an asset that has been stale for hours")
	require.Contains(t, reason, assets[4].Symbol)
	require.Contains(t, pollConditions(p), ConditionPollTargetFreshness)
	require.NotContains(t, reason, assets[0].Symbol, "the current assets are not implicated")
}

// A hydration FAILURE must degrade to an explicitly untrusted verdict, never to
// green: an unhydrated poller knows nothing about per-asset freshness.
func TestPollerUnhydratedFreshnessFailsClosed(t *testing.T) {
	st := newFakePriceStore()
	st.freshnessErr = errors.New("database unreachable")
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.ErrorContains(t, err, "hydrate durable price state")

	healthy, _ := p.Health()
	require.True(t, healthy, "inside the grace window an unhydrated poller is just starting up")

	clk.advance(time.Duration(pollHealthGrace)*time.Minute + time.Second)
	healthy, reason := p.Health()
	require.False(t, healthy)
	require.Contains(t, pollConditions(p), ConditionPollFreshnessUnhydrated)
	require.Contains(t, reason, "no freshness verdict can be trusted")
}

// The cadence gate: a second Step inside the interval issues no RPC at all.
func TestPollerCadenceGate(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "not due")
	require.Len(t, ch.calls, 1, "no RPC while the cadence slot is unspent")

	clk.advance(time.Minute)
	ch.respond = okRound(t, 5100, 20, 1_000_001)
	ch.setHead(5100)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, ch.calls, 2)
	require.Equal(t, uint64(5100), st.lastBatch(t).through)
}

// A FAILED round consumes its cadence slot too, so a broken poller cannot hammer
// RPC once per daemon tick.
func TestPollerFailedRoundConsumesCadenceSlot(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		return nil, errors.New("transport boom")
	}}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.ErrorContains(t, err, "transport boom")
	require.Len(t, ch.calls, 1)

	_, err = p.Step(context.Background())
	require.NoError(t, err, "the slot is spent: the round is simply not due")
	require.Len(t, ch.calls, 1, "no second RPC inside the interval")

	clk.advance(time.Minute)
	_, err = p.Step(context.Background())
	require.Error(t, err)
	require.Len(t, ch.calls, 2)
}

// A malformed multicall ENVELOPE is a round-level error: nothing is applied.
func TestPollerMalformedEnvelopeIsRoundError(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: func(int, common.Address, []byte) ([]byte, error) {
		return []byte{0xde, 0xad, 0xbe, 0xef}, nil
	}}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.Error(t, err)
	require.False(t, advanced)
	require.Empty(t, st.applied, "nothing reached the store")
}

// Reorg coordination runs BEFORE the cadence gate: a durable epoch must be
// acknowledged whether or not a round is due, because ApplyPrices refuses every
// batch until it is.
func TestPollerReorgAnsweredBeforeCadenceGate(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = 4000, true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	// Make the round NOT due, so only the reorg leg can act.
	p.lastAttempt = p.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "answering the epoch is progress")
	require.Len(t, st.neutralized, 1)
	require.Empty(t, st.rewinds, "the poller has no deletion primitive")
	require.Empty(t, ch.calls, "no poll happened: the round was not due")

	r := st.neutralized[0]
	require.Equal(t, PollCursorEngine(10), r.engine)
	require.Equal(t, uint64(10), r.chainID)
	require.Equal(t, uint64(4000), r.toBlock, "repair targets the poller's OWN cursor")
}

// A1 CORE: with a hash-verified poll anchor, repair keeps everything at or below
// it USABLE and marks only the unverified suffix — even though the walker's target
// would have taken the cursor far deeper. A hash match at H proves, on the endpoint
// that answered, that H and every ancestor are unchanged.
//
// Since D-010 the suffix is MARKED rather than deleted, so this test also pins the
// difference: the row at the replaced height is still in the table, and it is
// unreadable.
func TestPollerRepairRetainsRowsBelowVerifiedAnchor(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	// Durable history: three landed rounds, each with its anchor and a row.
	for _, b := range []uint64{4800, 4900, 5000} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	st.cursor, st.cursorFound = 5000, true
	// The walker's rewind reached all the way down to a sparse-log ancestor: the
	// degenerate case that used to delete EVERY polled row.
	deep := uint64(100)
	st.rewindDeepTo = &deep
	// The live chain still carries 4900 and 4800; 5000 was replaced.
	canonicalAt(ch, 4800, 4900)
	ch.setHash(5000, common.HexToHash("0xdead"))
	st.unacked = true
	p.lastAttempt = clk.now() // not due: isolate the rewind
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	require.Empty(t, st.rewinds, "the poller has no deletion primitive")
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(5000), st.neutralized[0].toBlock, "the poller asked for its own cursor")
	require.Equal(t, uint64(4900), st.neutralized[0].verifiedFloor,
		"the highest anchor whose hash still matches is the floor")
	require.Equal(t, uint64(4900), st.cursor, "the cursor stops at the verified block, not at the walker's 100")

	byBlock := map[uint64]fakeRow{}
	var blocks []uint64
	for _, r := range st.rows {
		blocks = append(blocks, r.block)
		byBlock[r.block] = r
	}
	require.ElementsMatch(t, []uint64{4800, 4900, 5000}, blocks,
		"EVERY row survives, including the orphaned round: nothing here deletes")
	require.True(t, byBlock[4800].valid)
	require.True(t, byBlock[4900].valid,
		"provably-canonical polled history keeps its validity")
	require.False(t, byBlock[5000].valid,
		"the orphaned round is retained but unreadable, which is the recoverable half of the trade")
	require.Equal(t, store.InvalidReasonUnverifiableReorg, byBlock[5000].invalidReason)
	// RE-SPECIFIED IN WAVE 14 (Codex round 10's [medium] #1). This used to assert the
	// phrase "HASH-VERIFIED poll anchor", which came from a justification the CALLER
	// composed before the store had answered — and which asserted that everything at or
	// below that anchor kept its validity, a prediction the store's clamp can falsify.
	// The pass's string is now EVIDENCE about the chain, and what happened to the floor
	// is reported from the boundary that came back. Here the floor was admitted whole,
	// so the two agree; the clamped case is
	// TestPollerFloorDoesNotBlessANullBoundRowSharingAHeightWithALaterAnchor.
	require.True(t, containsSubstring(*msgs, "poll anchor 4900 was RE-VERIFIED BY HASH"),
		"the evidence names the anchor this pass actually re-verified")
	require.True(t, containsSubstring(*msgs, "floorDisposition=admitted"),
		"and the disposition of the offered floor is stated, not left to be inferred")
	require.True(t, containsSubstring(*msgs, "validAtOrBelow=4900"),
		"the validity boundary reported is the one the store returned")
	require.True(t, containsSubstring(*msgs, "poll anchor is ORPHANED"), "the replaced round is named")
	// Probes walk down from the newest anchor and stop at the first match; then the
	// CHECKPOINT (the highest height this pass got a live answer for, 5000) is read
	// TWICE immediately before the act, and the two reads answer different questions:
	//
	//   - on the pass's OWN endpoint — does the proof still hold on the chain it was
	//     computed against? (time)
	//   - on a DIFFERENT endpoint — does any other chain view agree? (D-012 clause 4 -- this
	//     was D-011 clause 7, and D-011 is SUPERSEDED; naming it as the live source is
	//     the citation drift R7 exists to stop)
	//
	// The endpoint column is what distinguishes them, and it is asserted rather than
	// inferred: two reads of the same height from the same node would be a repeat, not
	// a corroboration.
	require.Equal(t, []uint64{5000, 4900, 5000, 5000}, ch.hashCalls,
		"newest-first probes, then a checkpoint re-read and a cross-endpoint corroboration immediately before the act")
	require.Equal(t, []int{0, 0, 0, 1}, probeEndpoints(ch),
		"one endpoint answered the whole pass and its checkpoint re-read; the SECOND endpoint answered the corroboration")
}

// A1, THE CORE FAIL-CLOSED PROPERTY. When anchor verification is UNAVAILABLE —
// here a transient hash-probe outage — repair must not ack the epoch and must not
// delete a row.
//
// This test replaces one that asserted the opposite. Wave 1 committed a test
// confirming that a transient probe outage left polled history EMPTY, documenting
// irreversible data loss as expected behaviour. Polled prices cannot be re-polled
// (this path only reads `latest`), so a stalled poller is recoverable and erased
// canonical history is not: the refusal is the correct outcome, and the previous
// assertion was encoding the bug.
func TestPollerRewindRefusesWhenAnchorVerificationIsUnavailable(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 5000, blockHashAt(5000), clk.now())
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	ch.failAll(errors.New("probe endpoint unreachable")) // no endpoint can verify anything
	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error to back off on")
	require.False(t, advanced, "nothing was acked and nothing was deleted")

	require.Empty(t, st.neutralized, "no marking was authorised either: the evidence is simply absent")
	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(5000), st.cursor, "the cursor is untouched")
	require.Len(t, st.rows, 1, "the unrecoverable polled row survives")
	require.True(t, st.rows[0].valid, "and survives as USABLE history")
	require.True(t, st.unacked, "the epoch stays unacknowledged, so no price can be applied meanwhile")

	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRewindBlocked)
	require.Contains(t, got[ConditionPollRewindBlocked], "REFUSED to ack or mark")
	healthy, _ := p.Health()
	require.False(t, healthy, "/readyz must go red: the poller is stalled and an operator has to know")
	require.True(t, containsSubstring(*msgs, "price reorg repair BLOCKED"))

	// RETRY, which is the other half of Codex's recommendation: once the probe
	// endpoint recovers, the same verification succeeds and repair proceeds.
	ch.clearFailAll()
	canonicalAt(ch, 5000)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(5000), st.neutralized[0].verifiedFloor, "the recovered probe proved 5000 canonical")
	require.Len(t, st.rows, 1, "and the row was retained throughout")
	require.True(t, st.rows[0].valid, "the verified floor covers it, so it keeps its validity")
	require.Empty(t, pollConditions(p)[ConditionPollRewindBlocked])
}

// A1 (DEEP REORG, PAGINATION): verification is bounded PER STEP but not abandoned.
// The old code probed eight anchors and then degraded to the destructive walker
// target; it now pages deeper on each Step, and never deletes while the answer is
// still unknown.
func TestPollerRewindPagesAnchorProbesAcrossStepsWithoutDeleting(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	// Two pages' worth of anchored rounds. Everything above 4050 was replaced;
	// 4050 itself is still canonical, and it sits in the SECOND page.
	var blocks []uint64
	for i := 0; i < 2*anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		blocks = append(blocks, b)
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
		ch.setHash(b, common.HexToHash("0xbeef")) // replaced
	}
	ch.setHash(4050, blockHashAt(4050)) // the deepest surviving canonical anchor
	st.cursor, st.cursorFound = blocks[len(blocks)-1], true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.unacked = true
	p.lastAttempt = clk.now()

	// FIRST Step: one page of probes, no conclusion, NOTHING deleted.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Len(t, ch.hashCalls, anchorProbePage, "a Step spends exactly one page of probes")
	require.Empty(t, st.rewinds, "an inconclusive page must not delete anything")
	require.Len(t, st.rows, 2*anchorProbePage)
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)

	// SECOND Step: it RESUMES below the page it already checked rather than
	// re-probing the top, and finds the surviving anchor.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Greater(t, len(ch.hashCalls), anchorProbePage, "verification continued instead of giving up")
	require.Less(t, ch.hashCalls[anchorProbePage], blocks[len(blocks)-1],
		"the second page starts BELOW the anchors already checked")
	require.Len(t, st.neutralized, 1)
	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(4050), st.neutralized[0].verifiedFloor)
	require.Equal(t, uint64(4050), st.cursor, "not the walker's 100")

	require.Len(t, st.rows, 2*anchorProbePage, "every row is still in the table")
	var usable []uint64
	for _, r := range st.rows {
		if r.valid {
			usable = append(usable, r.block)
		}
	}
	require.ElementsMatch(t, []uint64{4000, 4010, 4020, 4030, 4040, 4050}, usable,
		"everything at or below the verified anchor stays USABLE; the orphaned suffix is retained and marked")
}

// A1 CASE: A PROBE FAILS ABOVE AN ANCHOR THAT WOULD HAVE MATCHED.
//
// THIS IS THE FINDING A1 SURVIVED THREE FIX WAVES IN. Anchors are probed
// newest-first. Wave 3 set a probeFailed flag on an errored probe and then returned
// the NEXT anchor that matched as a verified floor anyway — so a transient outage
// while probing a newer canonical anchor caused a rewind to the lower floor,
// deleting every poll-owned row above it and acking the epoch. The newer history
// was never shown to be non-canonical; it was deleted because a probe timed out.
// Wave 3's replacement test exercised only TOTAL probe failure, which is why it
// passed while this path still lost data.
//
// WAVE 6 ANSWERS IT EARLIER AND WITH LESS MACHINERY. Wave 4 kept probing past the
// failure and refused the lower match with a dedicated gate; the pass now ENDS at
// the failure, so the lower anchor is never probed at all and there is no match to
// gate. That is why the "a NEWER anchor above it could not be probed" warning this
// test used to assert is gone: the situation it described can no longer arise
// inside one pass.
func TestPollerRepairEndsThePassWhenAProbeFailsAboveACandidateFloor(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	// Three anchored rounds. 5000 is the newest and is STILL CANONICAL; 4900 is
	// canonical too. Only the probe of 5000 fails.
	for _, b := range []uint64{4800, 4900, 5000} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	canonicalAt(ch, 4800, 4900, 5000)
	ch.failProbe(5000, errors.New("probe endpoint timed out"))
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error")
	require.False(t, advanced)

	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(5000), st.cursor, "the cursor is untouched")
	require.True(t, st.unacked, "the epoch stays unacknowledged")
	require.Empty(t, st.neutralized,
		"a match at 4900 must NOT authorise marking 5000: the probe that would have judged 5000 FAILED")
	var blocks []uint64
	for _, r := range st.rows {
		blocks = append(blocks, r.block)
		require.True(t, r.valid, "every row keeps its validity, including the one no probe could vouch for")
	}
	require.ElementsMatch(t, []uint64{4800, 4900, 5000}, blocks)
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)
	require.True(t, containsSubstring(*msgs, "price reorg repair BLOCKED"))

	// STRONGER THAN THE GATE IT REPLACES: the lower anchor was never even asked
	// about, so no match exists that could have been mistaken for a floor.
	require.Equal(t, []uint64{5000}, ch.hashCalls,
		"the pass ended at the failed probe instead of continuing down past it")

	// The resume point must NOT have been lowered past the unprobed anchor: the next
	// pass re-probes from the top rather than skipping it.
	require.False(t, p.probeResumeSet,
		"a pass that ended on a failed probe may not lower the paging resume point")

	// RECOVERY: the probe succeeds, 5000 verifies, and nothing is marked at all.
	ch.clearFailProbe(5000)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(5000), st.neutralized[0].verifiedFloor,
		"the recovered probe proved the NEWEST anchor canonical, so the floor is 5000")
	require.Len(t, st.rows, 3, "and all three rows were retained throughout")
	for _, r := range st.rows {
		require.True(t, r.valid, "the floor covers every row, so none of them is marked")
	}
}

// A1 CASE: SOME PROBES FAIL AND NOTHING MATCHES. The partial-failure sibling of the
// case above: two of three probes error, the third mismatches, so the page has
// neither a match nor complete negative proof. Refusal must not be mistaken for the
// paged-to-the-bottom case, and the resume point must stay put so the unprobed
// anchors are re-probed rather than skipped.
func TestPollerRewindRefusesWhenSomeProbesFailWithoutAMatch(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	for _, b := range []uint64{4800, 4900, 5000} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	ch.setHash(4800, common.HexToHash("0xbeef")) // probed, MISMATCH
	ch.failProbe(5000, errors.New("probe endpoint timed out"))
	ch.failProbe(4900, errors.New("probe endpoint timed out"))
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(100)
	st.rewindDeepTo = &deep // the walker's target is below every row: history IS at risk
	st.unacked = true
	p.lastAttempt = clk.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.rewinds)
	require.Empty(t, st.neutralized)
	require.Len(t, st.rows, 3)
	require.False(t, p.probeResumeSet,
		"two anchors are still unproven, so paging must not advance past them")
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRewindBlocked)
	require.Contains(t, got[ConditionPollRewindBlocked], "a probe FAILED and will be retried")
}

// A1 CASE: EVERY RETAINED ANCHOR IS PROBED AND MISMATCHED, AND THE ANCHORS COVER
// EVERY ROW. Then every row above the target describes a block the pinned endpoint
// no longer carries, so the epoch may be acked. Wave 3 refused here and called it
// an operator decision; that was a second unclearable stall, and it was refusing in
// the face of evidence it already had.
//
// THE ACTION IS STILL NOT A DELETION. This is the arm that used to be the clearest
// case for destroying rows — the anchors are complete and every one of them
// mismatched — and D-010 removes it anyway, because "complete on one endpoint"
// survived five rounds of review and lost each time. The rows are retained and
// marked, and the epoch is answered exactly as before.
func TestPollerRepairNeutralizesWhenEveryAnchorIsProvenOrphaned(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	for i := 0; i < anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
		ch.setHash(b, common.HexToHash("0xbeef")) // every one replaced
	}
	st.cursor, st.cursorFound = 4000+10*uint64(anchorProbePage-1), true
	deep := uint64(3900)
	st.rewindDeepTo = &deep
	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	// First Step spends the page and concludes nothing yet; the second reaches the
	// bottom of the retained set and can then conclude.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.rewinds, "an inconclusive page must not delete anything")
	require.Len(t, st.rows, anchorProbePage)

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Empty(t, st.rewinds, "even a complete negative does not authorise deleting a polled row")
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(0), st.neutralized[0].verifiedFloor,
		"no anchor survived, so there is no floor to raise the walker's target with")
	require.Equal(t, uint64(3900), st.cursor)
	require.Len(t, st.rows, anchorProbePage, "every row is still in the table")
	for _, r := range st.rows {
		require.False(t, r.valid, "and every one of them is unreadable")
		require.Equal(t, store.InvalidReasonUnverifiableReorg, r.invalidReason)
	}
	require.True(t, containsSubstring(*msgs, "MISMATCHED"))
	// AND THE FLOOR'S DISPOSITION IS REPORTED HERE TOO (Codex round 10's [medium] #1).
	// This arm offers no floor at all, and "none offered" is a different operator story
	// from "offered and admitted" — the boundary is the walker's target, not a height
	// anything vouched for. Without this the disposition would be pinned only on the two
	// arms that carry a floor, and the value most repairs actually log would be untested.
	require.True(t, containsSubstring(*msgs, "floorDisposition=none-offered"),
		"an arm that offers no floor says so, rather than reporting a floor as admitted")
	require.True(t, containsSubstring(*msgs, "validAtOrBelow=3900"),
		"and the validity boundary is the walker's target the store fell back to")
	require.False(t, st.unacked)
}

// A1 CASE: THE ANCHORS ARE COMPLETE AND ONE VERIFIES, BUT A ROW ABOVE THE DELETION
// BOUNDARY SITS AT AN UNANCHORED HEIGHT. A match at 4900 says nothing about a row
// at 4950 that no anchor covers, so the rewind must not delete it — and no future
// probe can ever settle it either, so the answer is NEUTRALIZE rather than an
// indefinite refusal.
//
// This is the mixed legacy-and-anchored shape: exactly the state that a "the
// anchors all check out" test would miss.
func TestPollerRewindNeutralizesWhenAVerifiedFloorLeavesUnanchoredRowsAbove(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	// Anchored, canonical history at 4900; an UNANCHORED legacy row at 4950 above it.
	st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 4900, blockHashAt(4900), clk.now())
	st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 4950, clk.now())
	canonicalAt(ch, 4900)
	st.cursor, st.cursorFound = 4950, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the epoch is answered — by neutralization, not by deletion")
	require.Empty(t, st.rewinds, "RewindPrices was never called: nothing was deleted")
	require.Len(t, st.neutralized, 1)
	require.Len(t, st.rows, 2, "both rows are RETAINED")
	require.True(t, containsSubstring(*msgs, "rows above the boundary sit at heights NO anchor covers"))

	// The unprovable row is retained but marked, so no usable-price read can return
	// it; the provable one below the target is untouched.
	byBlock := map[uint64]fakeRow{}
	for _, r := range st.rows {
		byBlock[r.block] = r
	}
	require.False(t, byBlock[4950].valid, "the unprovable row is quarantined, not trusted")
	require.Equal(t, store.InvalidReasonUnverifiableReorg, byBlock[4950].invalidReason)
	require.True(t, byBlock[4900].valid,
		"the store admitted the hash-verified floor in full here (the boundary asserted below IS 4900), so this row is at or below the RETURNED boundary and keeps its validity")
	require.Equal(t, uint64(4900), st.neutralized[0].verifiedFloor,
		"the verified floor is passed through, which is what confines the marking to the unprovable suffix")
	require.Equal(t, uint64(4900), st.cursor, "and the cursor stands at the verified floor, not at the walker's 100")
	require.False(t, st.unacked, "the epoch is acknowledged, so poll ingestion is not wedged")
}

// A1 CASE + THE DEADLOCK: A PENDING EPOCH WITH LEGACY UNANCHORED ROWS.
//
// Wave 3 refused here forever. Repair needed an anchor; anchor ADOPTION is refused
// while an epoch is pending (it would otherwise record a replacement block's hash);
// and the poller's ack only ever advanced through repair. No code path could clear
// it, so poll-price ingestion stopped permanently after an upgrade-time reorg. Wave
// 3's test hid that by assigning st.unacked = false directly — a transition the real
// store cannot perform. NOTHING IN THIS TEST TOUCHES st.unacked: every transition is
// one the store itself makes.
//
// The state now terminates: the rows are neutralized (retained, marked unusable),
// the epoch is acked, the next round polls normally, and adoption then anchors what
// survived so a LATER reorg is repairable by proof.
func TestPollerPendingEpochWithLegacyUnanchoredRowsTerminates(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5100, 20, 1_000_000)}
	ch.setHead(5100)
	p, clk := newTestPoller(t, st, ch, 10)

	// Post-upgrade state: polled rows at 5000, NO anchor anywhere, and a reorg epoch
	// whose walker target sits below them. The asset is a REAL registry poll asset so
	// the health surface actually reports on it — a fixture asset the registry does
	// not name would leave every condition silent for reasons unrelated to the code.
	asset := realFeeds(t).PollAssets(10)[0].Address
	st.seedRow(engine, asset.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(4900)
	st.rewindDeepTo = &deep
	canonicalAt(ch, 4900, 5000, 5100)
	st.unacked = true
	p.lastAttempt = clk.now() // not due: isolate the repair leg

	// STEP 1: the epoch is answered without deleting anything.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Empty(t, st.rewinds, "unanchored history is never deleted on faith")
	require.Len(t, st.neutralized, 1)
	require.Len(t, st.rows, 1, "the legacy row is RETAINED")
	require.False(t, st.rows[0].valid)
	require.Equal(t, store.InvalidReasonUnverifiableReorg, st.rows[0].invalidReason)
	require.Equal(t, uint64(4900), st.cursor, "the cursor is reset to the effective epoch target")
	require.False(t, st.unacked, "the STORE cleared the epoch as part of that transaction")

	// AND IT IS NOT SILENT. The retained-but-unusable rows are the newest durable
	// observation for their key, so the poller reports a quarantined newest answer
	// and /readyz stays red — the honest cost of the state, stated where an operator
	// sees it rather than only in a log line.
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollInvalidAnswer)
	require.Contains(t, got[ConditionPollInvalidAnswer], "unverifiable after a reorg")
	require.Empty(t, got[ConditionPollRewindBlocked], "the refusal is over: it was answered, not deferred")
	healthy, _ := p.Health()
	require.False(t, healthy)

	// STEP 2: ingestion resumes on the very next due round — the property the
	// deadlock denied. Adoption also runs now that no epoch is pending.
	p.lastAttempt = time.Time{}
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "poll ingestion resumed rather than stalling forever")
	require.Equal(t, uint64(5100), st.cursor)
	require.NotEmpty(t, st.applied, "a round actually landed")
	require.NotContains(t, pollConditions(p), ConditionPollInvalidAnswer,
		"a valid observation ABOVE the neutralized height is the newest again, so the quarantine marker clears")

	// STEP 3: a LATER reorg is now repairable by proof, because the round that just
	// landed anchored itself.
	st.unacked = true
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 2, "the second epoch was answered the same way: by marking, not deleting")
	require.Equal(t, uint64(5100), st.neutralized[1].verifiedFloor,
		"the anchored round is a verified floor, so this repair marks nothing either")
	require.Empty(t, st.rewinds)
}

// P1, ON THE POLLER: AN UNMARKED NULL-BOUND ROW SHARING A HEIGHT WITH A LATER
// ROUND'S ANCHOR IS STILL UNPROVABLE, AND A FLOOR AT THAT HEIGHT MUST NOT BLESS IT.
//
// This is the arm Codex round 9 found uncovered, and the reason it was uncovered is
// that the fake modelled provenance by HEIGHT while the store had moved to the row's
// own anchor_block binding. The shape, which is the one migration 00007 exists for:
//
//	5000  a LEGACY row, anchor_block NULL — its round never recorded what it read
//	5000  an anchor, written LATER by a different (here: empty) round at that height
//	5100  an ordinary anchored round: a row BOUND to the anchor at 5100
//
// The live chain still carries 5000 and has replaced 5100. So verification probes
// 5100 (mismatch), then 5000 (match) and offers 5000 as a verified floor. Under the
// height rule the legacy row at 5000 sat at an "anchored" height at or below the
// floor and kept its validity — an orphan-fork price left usable on the strength of a
// hash recorded for somebody else's round. Under the binding rule the floor is clamped
// below it and it is MARKED.
func TestPollerFloorDoesNotBlessANullBoundRowSharingAHeightWithALaterAnchor(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5200, 20, 1_000_000)}
	ch.setHead(5200)
	p, clk := newTestPoller(t, st, ch, 10)

	// The legacy row and the later round's anchor, at the SAME height. Seeded as two
	// separate facts precisely because that is what they are: seedRow leaves the
	// binding NULL, and no anchor at the row's height can supply one.
	st.seedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	// An ordinary anchored round above it, whose row IS bound.
	st.seedRound(engine, realFeeds(t).PollAssets(10)[1].Address.Bytes(), SourcePriceProviderV2, 5100, blockHashAt(5100), clk.now())
	st.cursor, st.cursorFound = 5100, true

	// The chain kept 5000 and REPLACED 5100, so verification probes 5100 (mismatch),
	// then 5000 (match) and offers 5000 as the floor.
	canonicalAt(ch, 5000)
	ch.setHash(5100, common.HexToHash("0xdead"))
	st.unacked = true
	deep := uint64(4000)
	st.rewindDeepTo = &deep

	msgs := captureWarnings(t)
	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, st.neutralized, 1, "the epoch was answered by marking, not deleting")
	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(5000), st.neutralized[0].verifiedFloor,
		"the poller did offer 5000 as a verified floor — the clamp is the STORE's refusal to admit it, not a failure to find it")

	// THE PROPERTY. 5000 matched and was offered as the floor; the store admitted it
	// only up to 4999, because the row at 5000 cannot be placed on any chain.
	require.Equal(t, uint64(4999), st.cursor,
		"the verified floor was CLAMPED below the unprovable row rather than admitted at its height")
	for _, r := range st.rows {
		require.False(t, r.valid,
			"no row above the clamped boundary keeps its validity — including the NULL-bound one at the matched anchor's own height (migration 00007)")
		require.Equal(t, store.InvalidReasonUnverifiableReorg, r.invalidReason)
	}

	// AND THE OPERATOR IS TOLD THE TRUTH ABOUT IT (Codex round 10's [medium] #1).
	// This is the regression shape the finding names: floor 5000 clamped to 4999, the
	// row at 5000 marked PERMANENTLY, and the WARN previously reporting 5000 as the
	// height at or below which validity survives. The boundary the store RETURNED is
	// the only authoritative answer, so the text is composed from it, and the fact
	// that the floor did not survive is stated rather than left to be inferred from
	// two numbers.
	require.True(t, containsSubstring(*msgs, "floorDisposition=clamped"),
		"the WARN says explicitly that the offered floor was not admitted")
	require.True(t, containsSubstring(*msgs, "validAtOrBelow=4999"),
		"and names the returned boundary as the validity boundary")
	require.True(t, containsSubstring(*msgs, "Validity survives at or below 4999, not 5000"),
		"the justification is rebuilt AFTER the store returns: a pre-composed one can only describe what was asked for")
	require.False(t, containsSubstring(*msgs, "everything at or below the verified floor keeps its validity"),
		"the retired sentence: it described the REJECTED floor as the validity boundary")
	for _, m := range *msgs {
		if strings.Contains(m, "rowsNeutralized") {
			require.NotContains(t, m, "validAtOrBelow=5000",
				"nothing in the neutralization report may present the clamped-away floor as still valid")
		}
	}
}

// THE SAME SHAPE, WITH THE LEGACY ROW REMOVED, IS THE CONTROL: when every row in the
// repair range carries its own binding, the floor is admitted IN FULL and the rows at
// or below it keep their validity.
//
// Without this arm the test above would pass against a store that had simply stopped
// honouring verified floors, which is a fail-forever of the kind this project has
// shipped and removed three times.
func TestPollerFloorIsAdmittedInFullWhenEveryRowCarriesItsOwnBinding(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5200, 20, 1_000_000)}
	ch.setHead(5200)
	p, clk := newTestPoller(t, st, ch, 10)

	assets := realFeeds(t).PollAssets(10)
	st.seedRound(engine, assets[0].Address.Bytes(), SourcePriceProviderV2, 5000, blockHashAt(5000), clk.now())
	st.seedRound(engine, assets[1].Address.Bytes(), SourcePriceProviderV2, 5100, blockHashAt(5100), clk.now())
	st.cursor, st.cursorFound = 5100, true

	canonicalAt(ch, 5000)
	ch.setHash(5100, common.HexToHash("0xdead"))
	st.unacked = true
	deep := uint64(4000)
	st.rewindDeepTo = &deep

	msgs := captureWarnings(t)
	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(5000), st.neutralized[0].verifiedFloor)
	require.Equal(t, uint64(5000), st.cursor, "the floor is admitted at its own height")

	for _, r := range st.rows {
		if r.block <= 5000 {
			require.True(t, r.valid, "history the floor proves canonical keeps its validity")
			continue
		}
		require.False(t, r.valid, "and only the suffix above it is marked")
	}

	// AND THE DISPOSITION IS THE CONTROL FOR THE CLAMPED CASE. Without this arm, a
	// poller that reported "clamped" unconditionally would satisfy the test above —
	// the same fail-forever shape this control exists to catch on the data side.
	require.True(t, containsSubstring(*msgs, "floorDisposition=admitted"),
		"an admitted floor is reported as admitted, not as clamped")
	require.True(t, containsSubstring(*msgs, "validAtOrBelow=5000"))
	require.False(t, containsSubstring(*msgs, "floorDisposition=clamped"))
}

// THE FOURTH DISPOSITION, AND THE ONLY ONE NOTHING ASSERTED: A FLOOR THAT SITS AT OR
// BELOW THE EPOCH'S OWN REPAIR TARGET RETAINS NOTHING EXTRA, AND THE BOUNDARY COMES
// BACK ABOVE THE OFFER.
//
// Codex round 11's [medium] #3. `admitted`, `clamped` and `none-offered` each had a
// test; `below-target` had none, so the arm that reports the offer being LOWER than
// the returned boundary was the one arm a mutation could rewrite for free. It is also
// the arm whose mis-report fails in the opposite DIRECTION from the clamp, which is
// why pinning it is not bookkeeping: a clamp mis-report tells the operator a marked
// row is still valid (round 10's finding), and a below-target mis-report tells the
// operator that canonical, readable history is unusable. Both are the same mistake —
// composing the sentence out of the number that was ASKED FOR rather than the one that
// came back — and only one of them had a regression.
//
// THE SHAPE, and why it is an ordinary production state rather than a contrivance.
// Poll rounds anchor at cadence, so anchors are sparse relative to blocks: on chain 10
// a 60-second interval leaves ~30 blocks between them. A walker rewind therefore lands
// BETWEEN two anchors as a matter of course. Here it rewound to 5000 while the poller's
// anchors sit at 5100 (replaced) and 4900 (still canonical), so verification offers
// 4900 — a real, hash-verified floor — and the store returns 5000, because the epoch
// never reached below 5000 and a floor cannot lower a boundary.
//
// The row at 4950 is the reason the direction matters. It is at or below the RETURNED
// boundary, so the store leaves it valid and readable; it is ABOVE the offered floor,
// so a WARN naming 4900 as the validity boundary would have told the operator to treat
// a perfectly good price as lost.
func TestPollerFloorBelowTheEpochsRepairTargetIsReportedAsBelowTarget(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	assets := realFeeds(t).PollAssets(10)
	// Two anchored rounds, straddling the walker's target.
	st.seedRound(engine, assets[0].Address.Bytes(), SourcePriceProviderV2, 4900, blockHashAt(4900), clk.now())
	st.seedRound(engine, assets[0].Address.Bytes(), SourcePriceProviderV2, 5100, blockHashAt(5100), clk.now())
	// A row between the offered floor and the returned boundary. It is BELOW the
	// epoch's target, so no repair ever asks anything about it — which is exactly why
	// its binding is irrelevant here and it is seeded as the plain legacy row D-012
	// clause 5 describes (population zero in production; accepted in dev).
	st.seedRow(engine, assets[1].Address.Bytes(), SourcePriceProviderV2, 4950, clk.now())
	st.cursor, st.cursorFound = 5100, true

	// The chain replaced 5100 and still carries 4900: probe 5100 (mismatch), probe
	// 4900 (match), offer 4900.
	canonicalAt(ch, 4900)
	ch.setHash(5100, common.HexToHash("0xdead"))
	st.unacked = true
	deep := uint64(5000)
	st.rewindDeepTo = &deep   // the epoch only ever reached 5000
	p.lastAttempt = clk.now() // not due: isolate the repair
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Empty(t, st.rewinds, "the poller has no deletion primitive")
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(5100), st.neutralized[0].toBlock, "repair targets the poller's OWN cursor")

	// THE PASS SHAPE, so `below-target` cannot be reached by a poller that stopped
	// verifying: 5100 probed and mismatched, 4900 probed and MATCHED, then the
	// checkpoint — the highest height this pass got a live answer for — re-read on the
	// pass's own endpoint and corroborated on a different one, both immediately before
	// the act. A floor that was never verified is a different finding, not this one.
	require.Equal(t, []uint64{5100, 4900, 5100, 5100}, ch.hashCalls,
		"newest-first probes, then the checkpoint re-read and the cross-endpoint corroboration")
	require.Equal(t, []int{0, 0, 0, 1}, probeEndpoints(ch),
		"one endpoint answered the whole pass; the SECOND answered the corroboration")

	// THE TWO NUMBERS, AND THEY DIFFER IN THE UNDER-REPORTING DIRECTION.
	require.Equal(t, uint64(4900), st.neutralized[0].verifiedFloor,
		"the pass DID verify 4900 by hash and offered it: below-target is not a failure to find a floor")
	require.Equal(t, uint64(5000), st.cursor,
		"the store returned the epoch's own target, ABOVE the offer — a floor cannot lower a boundary")

	byBlock := map[uint64]fakeRow{}
	for _, r := range st.rows {
		byBlock[r.block] = r
	}
	require.Len(t, byBlock, 3, "every row survives: nothing here deletes")
	require.True(t, byBlock[4900].valid)
	require.True(t, byBlock[4950].valid,
		"at or below the RETURNED boundary, so it keeps its validity — the offered floor 4900 does not cover it and the store did not ask it to")
	require.False(t, byBlock[5100].valid, "only the suffix above the returned boundary is marked")
	require.Equal(t, store.InvalidReasonUnverifiableReorg, byBlock[5100].invalidReason)

	// THE PROPERTY (Codex round 11's [medium] #3): the disposition names this outcome,
	// and every operator-facing number is the one the store RETURNED.
	require.True(t, containsSubstring(*msgs, "floorDisposition=below-target"),
		"the arm is reported by name, not left to be inferred from two numbers")
	require.True(t, containsSubstring(*msgs, "validAtOrBelow=5000"),
		"the validity boundary reported is the returned boundary, not the offer")
	require.True(t, containsSubstring(*msgs, "floorOffered=4900"),
		"the offer is still disclosed — it is evidence about the chain, just not a validity claim")
	require.True(t, containsSubstring(*msgs, "sat at or below the epoch's own repair target, so it retained nothing extra"),
		"and the explanation is composed from the returned boundary AFTER the store answered")
	require.False(t, containsSubstring(*msgs, "floorDisposition=admitted"),
		"a floor the boundary rose above was NOT admitted at its own height")
	require.False(t, containsSubstring(*msgs, "floorDisposition=clamped"),
		"nor was it clamped: nothing refused it, the epoch simply never reached that deep")
	for _, m := range *msgs {
		if strings.Contains(m, "rowsNeutralized") {
			require.NotContains(t, m, "validAtOrBelow=4900",
				"presenting the offer as the validity boundary would report readable history as lost")
		}
	}
}

// D-012 CLAUSE 2 IS A FORWARD GUARANTEE, SO THE POLLER'S OWN WARNS MAY NOT PROMISE
// HASH-BASED RECONCILIATION FOR A POPULATION THAT HAS NO HASH.
//
// Codex round 11's [medium] #2. Wave 14 split the STORE's classification WARN three
// ways — rowsAnchored / rowsUnanchoredBindingPruned / rowsUnanchoredNeverBound — and
// scoped the retention claim to the first. The poller's two WARNs kept the blanket
// version ("their provenance is retained forever, so an offline reconciliation stays
// possible"), which contradicts that split precisely when rowsAnchored is 0.
//
// NeutralizeUnverifiablePrices returns a boundary and a total and nothing else, so the
// poller CANNOT condition its text on the split — which means its text has to be true
// for the worst population. This fixture IS that population: the only row this repair
// marks carries a binding whose anchor retention has already removed, so no hash for
// its round exists anywhere in the database and clause 2 — which forbids expiring such
// an anchor FROM NOW ON — cannot bring one back. Clause 5 ratifies marking it anyway.
//
// Both poller WARNs are asserted here because both carried the same sentence: the one
// neutralize emits, and the backlog one refreshNeutralizedBacklog emits on the
// transition the marking causes.
func TestPollerNeutralizationPromisesNoOfflineRecoveryForAPrunedBinding(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	assets := realFeeds(t).PollAssets(10)
	// The floor this pass will verify: an ordinary anchored round, still canonical.
	st.seedRound(engine, assets[0].Address.Bytes(), SourcePriceProviderV2, 4900, blockHashAt(4900), clk.now())
	// THE MARKED POPULATION: a row that DID anchor and whose anchor is gone. Its
	// binding still names block 5100 and no anchor row remains there, which is what
	// retention leaves behind — the shape
	// TestARetentionPrunedAnchorIsNeverRecreatedAfterARestart pins on the store side.
	// rowsAnchored is 0 for this call and every marked row is unanchored-binding-pruned.
	st.seedBoundRow(engine, assets[1].Address.Bytes(), SourcePriceProviderV2, 5100, 5100, clk.now())
	st.cursor, st.cursorFound = 5100, true

	canonicalAt(ch, 4900)
	st.unacked = true
	deep := uint64(4000)
	st.rewindDeepTo = &deep
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Empty(t, st.rewinds)

	byBlock := map[uint64]fakeRow{}
	for _, r := range st.rows {
		byBlock[r.block] = r
	}
	require.True(t, byBlock[4900].valid, "the verified floor's own round is untouched")
	require.False(t, byBlock[5100].valid, "the pruned-binding row is RETAINED and marked, never deleted")
	require.Equal(t, store.InvalidReasonUnverifiableReorg, byBlock[5100].invalidReason)

	// THE FIXTURE'S PREMISE, ASSERTED IN BOTH HALVES RATHER THAN DESCRIBED. The store
	// classifies by the row's own BINDING, so "binding pruned" needs the binding to be
	// present AND its anchor to be absent. Asserting only the absence would let the
	// fixture drift into the never-bound population, where the retention claim is false
	// for a different reason and the test would still pass — the shape of test-integrity
	// failure this project has shipped five times.
	require.NotNil(t, byBlock[5100].anchorBlock,
		"its round DID record an anchor, so this row is binding-pruned and not never-bound")
	require.Equal(t, uint64(5100), *byBlock[5100].anchorBlock)
	require.Nil(t, st.anchorAt(engine, 5100),
		"and the anchor that binding names is gone, so no hash for its round is on disk anywhere")

	// THE PROPERTY. The neutralization WARN scopes hash retention and offline
	// reconciliation to rows that still HAVE an anchor, and points at the store's WARN
	// as the only place the split is counted.
	neutralizeWarn := messageContaining(t, *msgs, "rowsNeutralized")
	require.Contains(t, neutralizeWarn, "rowsNeutralized=1",
		"exactly one row was marked and it is the pruned-binding one: the claim is being judged against a population of only that kind")
	require.Contains(t, neutralizeWarn, "THE ROWS AND THEIR VALUES ARE RETAINED FOREVER",
		"what clause 2 guarantees unconditionally is still stated unconditionally")
	require.Contains(t, neutralizeWarn, "the recorded BLOCK HASH survives only where the marked row's own round still has an anchor",
		"and the hash is scoped to the population that has one")
	require.Contains(t, neutralizeWarn, "FOR THOSE ROWS AND NO OTHERS",
		"the reconciliation promise is scoped in the same sentence, not left to be inferred")
	require.Contains(t, neutralizeWarn, "rowsUnanchoredBindingPruned",
		"and the operator is sent to the store WARN that actually knows the split")
	require.NotContains(t, neutralizeWarn, "Their provenance is retained forever (clause 2), so an offline reconciliation stays possible",
		"the retired blanket sentence: false for exactly this row")

	// THE SAME SENTENCE WAS IN THE BACKLOG WARN, which fires on the transition this
	// marking causes and is the message an operator sees for as long as the pile lasts.
	backlogWarn := messageContaining(t, *msgs, "RETAINED BUT PERMANENTLY UNUSABLE")
	require.Contains(t, backlogWarn, "the recorded block hash survives only where a row's own round still has an anchor",
		"the backlog report is scoped the same way")
	require.Contains(t, backlogWarn, "could settle THOSE rows and no others")
	require.NotContains(t, backlogWarn, "Their provenance is retained forever (clause 2), so an offline reconciliation could still settle the anchored ones",
		"the retired blanket sentence, in its second home")
}

// A1 CASE: A DEEPER EPOCH ARRIVES WHILE VERIFICATION IS STILL PAGING. The walker
// records a second, deeper rewind between two verification Steps, which lowers the
// effective target under the poller's feet.
//
// TWO THINGS THIS TEST GETS RIGHT THAT ITS PREVIOUS VERSION DID NOT. It lowers the
// effective target THROUGH A NEW EPOCH ROW (recordReorgEpoch), because a deeper
// MIN(rewound_to) can only come from one — the old version moved the target alone,
// which is a store state no walker can produce. And it therefore exercises the
// consequence: a new epoch is a new GENERATION, so the paging state accumulated
// under the old one is DISCARDED rather than carried forward, and verification
// re-probes from the newest anchor. The old comment claimed the accumulated
// mismatches "stay true"; they do not, which is the whole of finding A1's fifth
// round.
func TestPollerRewindHandlesADeeperEpochArrivingMidVerification(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	// Two pages of anchored rounds; 4050 survives and sits in the second page.
	var blocks []uint64
	for i := 0; i < 2*anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		blocks = append(blocks, b)
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
		ch.setHash(b, common.HexToHash("0xbeef"))
	}
	ch.setHash(4050, blockHashAt(4050))
	st.cursor, st.cursorFound = blocks[len(blocks)-1], true
	shallow := uint64(4100)
	st.rewindDeepTo = &shallow
	st.recordReorgEpoch()
	p.lastAttempt = clk.now()

	// Page 1: inconclusive, nothing deleted.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.rewinds)
	require.True(t, p.probeResumeSet, "a fully-probed, fully-mismatched page lowered the resume point")

	// THE WALKER RECORDS A DEEPER REWIND between Steps: a second epoch row whose
	// rewound_to is 4020, below the anchor that is about to verify.
	deeper := uint64(4020)
	st.rewindDeepTo = &deeper
	st.recordReorgEpoch()

	// The new generation invalidates the paging state, so this Step re-probes the
	// page it had already walked instead of continuing below it.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "verification restarted from the newest anchor rather than concluding on stale proofs")
	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(4150), ch.hashCalls[anchorProbePage],
		"the Step after the new epoch starts again at the NEWEST anchor")

	// Only once the second page has been re-walked under the CURRENT generation does
	// 4050 become a floor — and it then raises the deeper target rather than being
	// ignored by it.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(4050), st.neutralized[0].verifiedFloor)
	require.Equal(t, uint64(4050), st.cursor,
		"the verified floor stands against the DEEPER target the walker recorded mid-verification")
	var usable []uint64
	for _, r := range st.rows {
		if r.valid {
			usable = append(usable, r.block)
		}
	}
	require.Len(t, st.rows, 2*anchorProbePage, "nothing was deleted")
	require.ElementsMatch(t, []uint64{4000, 4010, 4020, 4030, 4040, 4050}, usable,
		"nothing at or below the verified anchor lost its validity to the deeper epoch")
}

// A1 CASE, ROUND 5 — THE PROOF THAT EXPIRED. This is the finding Codex reopened
// after wave 4: verification pages across Steps, so its mismatch proofs are CACHED,
// and a proof about a chain is only true of the chain it was computed against.
//
// WHAT MAKES THIS A REAL REORG AND NOT THE SHAPE OF ONE. The fake chain's answers
// CHANGE between Steps: every anchored height reports 0xbeef in Step 1 (chain B) and
// its own recorded hash from Step 2 onward (chain A restored). Wave 4's interleaving
// test moved only the effective rewind target and left the chain views untouched, so no
// anchor's canonicality ever actually changed and the path below was never entered.
// A fake that returns the same hashes throughout cannot test a reorg.
//
// WHAT THE BUG WOULD DO. Page 1 mismatches every anchor from 4150 down to 4080 and
// lowers the resume point to 4079. Chain A comes back. The next Step resumes at 4079,
// finds 4070 canonical, and — trusting the cached "everything above 4079 is
// orphaned" — accepts 4070 as a verified floor, deleting the eight rows at 4080-4150
// that are canonical again. Polled history cannot be re-polled, so that is permanent.
func TestPollerRewindDiscardsAnchorProofsWhenALaterEpochRestoresThem(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	// Two pages of anchored rounds, 4000..4150. Under the FIRST reorg the live chain
	// carries none of them.
	var blocks []uint64
	for i := 0; i < 2*anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		blocks = append(blocks, b)
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
		ch.setHash(b, common.HexToHash("0xbeef")) // chain B: every recorded round replaced
	}
	st.cursor, st.cursorFound = 4150, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.recordReorgEpoch() // the first reorg: generation 1
	p.lastAttempt = clk.now()

	// STEP 1: one page of probes, all mismatching, resume point lowered. This is the
	// proof that is about to expire.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Len(t, ch.hashCalls, anchorProbePage)
	require.True(t, p.probeResumeSet, "the page fully mismatched, so paging descends")
	require.Equal(t, uint64(4079), p.probeResumeFrom)
	require.Empty(t, st.rewinds)

	// THE SECOND REORG. The chain re-organises BACK: every one of those heights is
	// canonical again, carrying exactly the hashes the anchors recorded. The walker
	// notices and records a second epoch, so the generation advances.
	msgs := captureWarnings(t)
	for _, b := range blocks {
		ch.setHash(b, blockHashAt(b))
	}
	st.recordReorgEpoch()

	// STEP 2: the cached mismatches are discarded, verification restarts at the
	// NEWEST anchor, and 4150 verifies — so the floor is 4150 and NOTHING is deleted.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(4150), ch.hashCalls[anchorProbePage],
		"the restarted pass probes the newest anchor, not the height paging had reached")
	require.Len(t, st.neutralized, 1)
	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(4150), st.neutralized[0].verifiedFloor,
		"the newest anchor is canonical again, so the floor is the newest anchor")
	require.Equal(t, uint64(4150), st.cursor, "not the walker's 100, and not a lower match")

	var kept []uint64
	for _, r := range st.rows {
		kept = append(kept, r.block)
		require.True(t, r.valid,
			"every row stays USABLE: the anchors a stale proof called orphaned are canonical again")
	}
	require.ElementsMatch(t, blocks, kept)
	require.True(t, containsSubstring(*msgs, "verification RESTARTS from the newest anchor"))
	require.False(t, st.unacked, "and the epoch was answered, so ingestion is not wedged")
}

// A1 CASE, ROUND 5, THE HARDER HALF: THE SAME REORG WITH NO NEW EPOCH YET.
//
// The generation stamp only moves once the WALKER has recorded the reorg, and it may
// not have — its own rewind runs behind a capped backoff. So the reorg-generation
// check alone leaves the hole open for exactly as long as the walker takes to
// notice. The LIVE-CHAIN CHECKPOINT is what closes it: the highest anchor the pass
// successfully probed is re-read immediately before the deletion, and because a
// block hash commits to its whole ancestry, a changed answer there means at least
// one proof below it may have flipped.
//
// Again the substance, not the shape: the endpoint chain views change between Steps and the epoch
// state does NOT, so the only thing that can catch this is the checkpoint.
func TestPollerRewindRefusesWhenTheCheckpointMovedBeforeDeletion(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	var blocks []uint64
	for i := 0; i < 2*anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		blocks = append(blocks, b)
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
		ch.setHash(b, common.HexToHash("0xbeef"))
	}
	st.cursor, st.cursorFound = 4150, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.recordReorgEpoch()
	p.lastAttempt = clk.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, uint64(4079), p.probeResumeFrom)
	generation := st.maxEpoch

	// The chain re-organises back and the walker has NOT recorded it: same epoch,
	// different chain.
	msgs := captureWarnings(t)
	for _, b := range blocks {
		ch.setHash(b, blockHashAt(b))
	}
	require.Equal(t, generation, st.maxEpoch, "no new epoch: only the chain's answers changed")

	// STEP 2: paging resumes into the second page and 4070 matches, which under the
	// cached proofs would be accepted as a floor and delete 4080-4150. The checkpoint
	// re-read at 4150 catches it: nothing is deleted, nothing is acked.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.rewinds)
	require.Empty(t, st.neutralized, "a floor accepted on an expired proof must not mark the rows above it")
	require.Len(t, st.rows, 2*anchorProbePage)
	for _, r := range st.rows {
		require.True(t, r.valid)
	}
	require.True(t, st.unacked)
	require.True(t, containsSubstring(*msgs, "chain moved AGAIN"))
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRewindBlocked)
	require.Contains(t, got[ConditionPollRewindBlocked], "checkpoint")
	require.False(t, p.probeResumeSet, "the expired pass was discarded, not resumed")

	// STEP 3: the restarted pass verifies the newest anchor against the chain as it
	// now stands, so the repair completes with a floor that deletes nothing.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(4150), st.neutralized[0].verifiedFloor)
	require.Len(t, st.rows, 2*anchorProbePage, "and nothing was ever deleted")
	require.False(t, st.unacked)
}

// A1: A CHECKPOINT THAT CANNOT BE RE-READ IS NOT EVIDENCE EITHER WAY. A probe
// outage on the checkpoint height at the moment of acting must refuse and retry
// rather than proceed on the last answer it happened to get.
//
// WHAT WAVE 6 CHANGED, AND WHY THE OLD ASSERTION HERE IS WRONG NOW. This test used
// to require that the paging pass SURVIVED an unreadable checkpoint ("UNAVAILABLE
// evidence, so the pass is retried rather than discarded"). Under D-010 clause 2 a
// pass belongs to one endpoint, and the endpoint that cannot answer the checkpoint
// is the same endpoint that produced every proof in the pass — so keeping the pass
// means retrying the identical failing read every Step, with no path that ever
// moves off it. Keeping it was fail-forever dressed as thrift. The pass is
// discarded, the pin rotates, and the work is re-done; nothing is marked either
// way, which is the property that actually matters here.
func TestPollerRepairRefusesWhenTheCheckpointCannotBeReRead(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	// One page's worth: 4000..4070. Everything is replaced except 4000, so the pass
	// concludes inside a single page with a floor of 4000.
	for i := 0; i < anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
		ch.setHash(b, common.HexToHash("0xbeef"))
	}
	ch.setHash(4000, blockHashAt(4000))
	st.cursor, st.cursorFound = 4070, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.recordReorgEpoch()
	p.lastAttempt = clk.now()

	// The checkpoint is the top of the page (4070), which the page itself probed
	// successfully. Fail only its SECOND read — the revalidation — so this test is
	// about the revalidation and not about a page with a failed probe in it (which
	// TestPollerRewindRefusesWhenANewerProbeFailedAndALowerAnchorMatches covers).
	ch.failAfter(4070, 1)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error")
	require.False(t, advanced)
	require.Empty(t, st.rewinds, "the checkpoint could not be re-read, so nothing may be deleted")
	require.Empty(t, st.neutralized)
	require.Len(t, st.rows, anchorProbePage, "every row survives a probe outage")
	require.True(t, st.unacked)
	require.False(t, p.probeCheckpointSet,
		"the pass is discarded: its proofs all came from the endpoint that has just stopped answering")
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRewindBlocked)
	require.Contains(t, got[ConditionPollRewindBlocked], "could not be re-read")

	// Recovery: the re-read succeeds, the pass is re-walked from the newest anchor,
	// and the repair concludes with the same floor — without deleting anything.
	ch.clearFailAfter()
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Empty(t, st.rewinds)
	require.Equal(t, uint64(4000), st.neutralized[0].verifiedFloor)
	require.Len(t, st.rows, anchorProbePage, "every row is still there")
}

// A1 CASE, ROUND 6 — WHICH CHAIN VIEW THE PROOFS CAME FROM.
//
// Codex round 5's finding, reproduced as the scenario it describes: endpoint 0
// mismatches the highest anchor while RETAINING the middle anchor in its
// ancestry; endpoint 1 mismatches that middle anchor on another fork; endpoint 0
// matches a lower anchor. Wave 5 spread a pass's probes across endpoints on
// purpose, so the pass assembled "5000 orphaned" from endpoint 0, "4900 orphaned"
// from endpoint 1 and "4800 canonical" from endpoint 0 — three statements about
// possibly-different chains — and then re-read a checkpoint that commits to
// endpoint 0's chain alone. On that chain 4900 is CANONICAL, so the floor of 4800
// the mixed pass produced marks a canonical round unusable.
//
// THE HARNESS IS WHAT MAKES THIS EXPRESSIBLE. Before wave 6 the fake answered
// probes by height alone, so endpoint 0 and endpoint 1 agreed about 4900 by
// construction and no test could state this scenario at all.
func TestPollerRepairRunsOneCoherentEndpointAcrossDivergentAncestries(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	for _, b := range []uint64{4800, 4900, 5000} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(100)
	st.rewindDeepTo = &deep

	// ENDPOINT 0 — the chain the checkpoint will commit to. 5000 was replaced;
	// 4900 and 4800 are canonical on it.
	ch.setHashOn(0, 5000, common.HexToHash("0xdead"))
	ch.canonicalOn(0, 4900, 4800)
	// ENDPOINT 1 — ANOTHER FORK. It agrees 5000 is gone and agrees about 4800, and
	// it disagrees about 4900: on its fork that round was replaced too.
	ch.setHashOn(1, 5000, common.HexToHash("0xdead"))
	ch.setHashOn(1, 4900, common.HexToHash("0xbeef"))
	ch.canonicalOn(1, 4800)

	st.unacked = true
	p.lastAttempt = clk.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "the epoch is answered")

	require.Empty(t, st.rewinds, "the poller has no deletion path left (D-010 clause 1)")
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(4900), st.neutralized[0].verifiedFloor,
		"the floor is the highest anchor that is canonical on THE ONE endpoint the pass ran against")

	byBlock := map[uint64]fakeRow{}
	for _, r := range st.rows {
		byBlock[r.block] = r
	}
	require.Len(t, st.rows, 3, "nothing is ever deleted")
	require.True(t, byBlock[4900].valid,
		"4900 is canonical on the checkpoint chain, so it must keep its validity: marking it is the round-5 defect")
	require.True(t, byBlock[4800].valid)
	require.False(t, byBlock[5000].valid, "only the round the pinned endpoint showed replaced is marked")

	// The structural claim, checked rather than asserted in prose. Every probe in the
	// PASS — page probes and the checkpoint re-read alike — was answered by ONE
	// endpoint; that is coherence, and it is what makes "5000 orphaned" compose with
	// "4900 canonical". The LAST call is the D-012 clause-4 corroboration and comes
	// from a DIFFERENT endpoint by construction: a second opinion sourced from the
	// same node would be no second opinion at all.
	served := probeEndpoints(ch)
	require.Len(t, served, 4, "two page probes, the checkpoint re-read, and the corroboration")
	pass, corroboration := served[:len(served)-1], served[len(served)-1]
	for i, e := range pass {
		require.Equal(t, pass[0], e, "probe %d was answered by endpoint %d, breaking the pass's coherence", i, e)
	}
	require.NotEqual(t, pass[0], corroboration,
		"the corroborating read must come from another endpoint, or D-012 clause 4 corroborates one node with itself")
	require.Equal(t, uint64(5000), ch.hashCalls[len(ch.hashCalls)-1],
		"and it must ask about the pass's CHECKPOINT, whose hash entails every proof at or below it")
	// Here the two forks AGREE that 5000 was replaced (they diverge only at 4900,
	// which is below the checkpoint and therefore covered by it), so corroboration
	// confirms and the pass may act. That is the shape of a real reorg both nodes saw.
}

// A1 CASE, ROUND 6, THE OTHER HALF — SILENT FAILOVER.
//
// HeaderHashFrom is a FAILOVER call: asked for endpoint 0 it will quietly answer
// from endpoint 1 when 0 cannot reply, and only the returned token says so. A pass
// that ignores the token mixes ancestries without any endpoint being "chosen" at
// all — the same defect as the test above, arriving through the client rather than
// through the caller's rotation.
//
// Here endpoint 0 is healthy except that it cannot answer for height 5000, and
// endpoint 1 — on its own fork — says 5000 was replaced. Absorbing endpoint 1's
// answer would compose "5000 is orphaned (endpoint 1)" with "4900 is canonical
// (endpoint 0)" and mark 5000's row on the strength of it.
func TestPollerRepairRefusesAProbeSilentlyServedByAnotherEndpoint(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	for _, b := range []uint64{4900, 5000} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(100)
	st.rewindDeepTo = &deep

	// Endpoint 0: healthy, canonical at 4900, and UNABLE to answer about 5000.
	ch.canonicalOn(0, 4900)
	ch.failProbeOn(0, 5000, errors.New("endpoint 0 cannot serve header 5000"))
	// Endpoint 1: answers about both, and reports 5000 replaced.
	ch.canonicalOn(1, 4900)
	ch.setHashOn(1, 5000, common.HexToHash("0xdead"))

	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error")
	require.False(t, advanced, "the pinned endpoint did not answer, so nothing was concluded")

	require.Empty(t, st.rewinds)
	require.Empty(t, st.neutralized,
		"an answer from another endpoint may not join this pass's proofs, so nothing may be marked")
	require.Len(t, st.rows, 2)
	for _, r := range st.rows {
		require.True(t, r.valid, "every row keeps its validity: no proof was completed")
	}
	require.True(t, st.unacked)
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)

	// The failover DID happen at the client — the fake records endpoint 1 as having
	// answered — which is exactly what the poller had to notice and reject.
	require.Contains(t, probeEndpoints(ch), 1,
		"the fake must actually fail over, or this test is not about silent failover")

	// STEP 2 — COHERENT, AND STILL NOT ENOUGH. The next pass runs entirely against
	// endpoint 1, which can answer both heights, and reaches a conclusion that is
	// self-consistent on that one chain. Under D-010 that was the whole bar and the
	// pass would have marked 5000 here. Under D-012 clause 4 it is not: corroborating
	// the checkpoint means asking the OTHER endpoint about height 5000, and endpoint 0
	// is precisely the node that cannot answer about 5000. Missing agreement is not
	// contrary agreement, so nothing is marked and the epoch waits.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced, "a coherent pass that no second endpoint can corroborate does not act")
	require.Empty(t, st.neutralized)
	for _, r := range st.rows {
		require.True(t, r.valid, "retention is the safe default: disagreement and unavailability both keep the data")
	}
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)
	require.True(t, containsSubstring(*msgs, "no second endpoint would corroborate"),
		"and the refusal names the missing agreement rather than reporting a probe failure")

	// STEP 3 — RECOVERY. Endpoint 0 can serve header 5000 again and reports the same
	// replacement block endpoint 1 does. The two views now agree at the checkpoint,
	// so the conclusion may finally be acted on.
	ch.clearFailProbe(5000)
	ch.setHashOn(0, 5000, common.HexToHash("0xdead"))

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(4900), st.neutralized[0].verifiedFloor)
	require.Empty(t, st.rewinds, "and the conclusion is still reached without deleting anything")
}

// A1 CASE, ROUND 6 — MIXED FAILURE ACROSS PAGES. The guard tests in this file
// cover total probe failure (every endpoint down) and single-probe failure; this
// is the mixed shape between them, and it is the shape wave 3 shipped a bug in:
// SOME work succeeds, then the endpoint stops answering.
//
// The pinned endpoint walks a complete first page — eight anchors, all mismatched,
// resume point lowered — and then dies partway into the second. Everything it
// established belongs to its chain view alone, so the pass ends and the next one
// starts over on the next endpoint. The property under test is that a half-finished
// pass cannot leave a residue that a later, differently-sourced pass builds on.
func TestPollerRepairDiscardsAHalfWalkedPassWhenItsEndpointStopsAnswering(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	// Two pages of anchored rounds, 4000..4150. On endpoint 0 every one of them was
	// replaced except 4000; endpoint 1 reports the same chain, so this test is about
	// availability rather than divergence.
	var blocks []uint64
	for i := 0; i < 2*anchorProbePage; i++ {
		b := uint64(4000 + 10*i)
		blocks = append(blocks, b)
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
		ch.setHash(b, common.HexToHash("0xbeef"))
	}
	ch.setHash(4000, blockHashAt(4000))
	st.cursor, st.cursorFound = 4150, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	st.recordReorgEpoch()
	p.lastAttempt = clk.now()

	// STEP 1: a complete page on endpoint 0, nothing marked, paging descends.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.True(t, p.probeResumeSet, "a completed page lowers the resume point")
	require.Equal(t, uint64(4079), p.probeResumeFrom)
	require.Equal(t, 0, p.probeEndpoint, "the whole page came from one endpoint")
	require.Empty(t, st.neutralized)

	// Endpoint 0 now loses the height the second page starts at. Endpoint 1 could
	// answer, and must not be allowed to finish endpoint 0's pass.
	ch.failProbeOn(0, 4070, errors.New("endpoint 0 lost its state"))
	pageOne := len(ch.hashCalls)

	// STEP 2: the pass ends on that probe. Nothing is marked, the accumulated
	// mismatches are gone, and the pin has moved.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.neutralized, "a half-walked pass authorises nothing")
	require.Empty(t, st.rewinds)
	require.False(t, p.probeResumeSet,
		"the first page's mismatches came from an endpoint that stopped answering, so they are discarded")
	require.Equal(t, 1, p.probeEndpoint, "the next pass runs somewhere else")
	require.Equal(t, []uint64{4070}, ch.hashCalls[pageOne:],
		"the pass ended at the failed probe rather than continuing down the page")
	for _, r := range st.rows {
		require.True(t, r.valid)
	}

	// STEP 3-4: endpoint 1 re-walks BOTH pages from the newest anchor and reaches
	// the same floor, without any of endpoint 0's leftovers.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, uint64(4150), ch.hashCalls[pageOne+1],
		"the replacement pass starts again at the NEWEST anchor")

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(4000), st.neutralized[0].verifiedFloor)
	require.Len(t, st.rows, 2*anchorProbePage, "nothing was deleted at any point")

	// Every probe of the concluding pass came from endpoint 1 — except the LAST, which
	// is the D-012 clause-4 corroboration and must come from somewhere else by construction.
	// Both endpoints report the same chain here, so it confirms and the pass may act;
	// this test is about availability, not divergence.
	served := probeEndpoints(ch)[pageOne+1:]
	require.NotEmpty(t, served)
	for i, e := range served[:len(served)-1] {
		require.Equal(t, 1, e, "probe %d of the replacement pass was answered by endpoint %d, breaking its coherence", i, e)
	}
	require.Equal(t, 0, served[len(served)-1],
		"and the corroborating read came from the OTHER endpoint")
}

// D-012 CLAUSE 6 (carrying D-010 clause 4): "gap visibility stands... a cleared acute
// signal must not hide the historical classification." The pile is COUNTABLE and its
// size and age reach an operator, because the policy that creates it has an accepted
// cost and an operator who cannot see the pile cannot tell a handful from a runaway.
//
// It is deliberately NOT a health condition, and this test pins that too: under
// clause 3 the classification is permanent, so a condition keyed on its existence
// would latch /readyz red forever — an outage rather than a signal. The acute case —
// an asset whose NEWEST observation is unusable — is already
// ConditionPollInvalidAnswer, and that one clears when a valid observation lands.
func TestPollerExposesTheNeutralizedBacklog(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	// Two rows a PREVIOUS repair already neutralized, plus the passage of time, so
	// the age the surface reports is a real interval rather than zero.
	st.seedInvalidRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 4000, clk.now())
	st.rows[0].invalidReason = store.InvalidReasonUnverifiableReorg
	clk.advance(2 * time.Hour)
	st.seedInvalidRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 4100, clk.now())
	st.rows[1].invalidReason = store.InvalidReasonUnverifiableReorg
	oldest := st.rows[0].observedAt
	clk.advance(time.Hour)
	st.cursor, st.cursorFound = 4100, true
	msgs := captureWarnings(t)

	require.NoError(t, p.hydrate(context.Background()))

	backlog, known := p.NeutralizedBacklog()
	require.True(t, known, "the backlog was read from durable rows during hydration")
	require.Equal(t, int64(2), backlog.Rows)
	require.Equal(t, oldest, backlog.Oldest)
	require.Equal(t, uint64(4100), backlog.HighestBlock)
	require.True(t, containsSubstring(*msgs, "RETAINED BUT PERMANENTLY UNUSABLE"),
		"the accumulation is reported where an operator reads, not only through an accessor")
	require.True(t, containsSubstring(*msgs, "D-012 clause 3"),
		"and the text says the classification is permanent rather than implying a pending repair (clause 7)")

	// It does NOT gate readiness. A permanent classification must not be able to hold
	// /readyz red on its own.
	require.NotContains(t, pollConditions(p), ConditionPollRewindBlocked)
	for name := range pollConditions(p) {
		require.NotContains(t, name, "neutralized",
			"the backlog must not become a condition: nothing clears it, so it would never recover")
	}
}

// The backlog read decides nothing, so it must not be able to take the freshness
// verdict down with it: a failing count leaves the poller hydrated and the backlog
// merely UNKNOWN.
func TestPollerBacklogReadFailureDoesNotBreakHydration(t *testing.T) {
	st := newFakePriceStore()
	st.neutralizedStatsErr = errors.New("count query timed out")
	st.cursor, st.cursorFound = 4000, true
	ch := &fakePollChain{endpoints: 1}
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	require.NoError(t, p.hydrate(context.Background()), "an informational read must not fail hydration")
	require.True(t, p.hydrated)
	_, known := p.NeutralizedBacklog()
	require.False(t, known, "and it reports the number as unknown rather than as zero")
	require.True(t, containsSubstring(*msgs, "could not read the neutralized-price backlog"))
	require.NotContains(t, pollConditions(p), ConditionPollFreshnessUnhydrated)
}

// =====================================================================
// D-012 clause 4 — marking requires agreement whenever >1 endpoint is CONFIGURED.
// =====================================================================

// D-012 CLAUSE 4, AND THE DIRECT KILL OF CODEX ROUND 6's FINDING: a self-consistent
// pass drawn from a MINORITY fork must not mark canonical history unusable.
//
// (The clause number moved with the decision. This requirement was D-011 clause 7;
// D-011 is SUPERSEDED, and naming it as the live source is exactly the citation drift
// round 8's F7 exists to stop — which is how this heading survived a round longer than
// it should have.)
//
// This is the scenario the finding describes, and until this wave the poller acted on
// it. Endpoint 0 sits alone on a fork where block 5000 was replaced; endpoint 1 — the
// majority — still carries it. The pinned pass on endpoint 0 is perfectly coherent
// (its probes all come from one chain), its checkpoint still holds on that chain, and
// the conclusion it reaches is that 5000's round is orphaned. Coherence was the whole
// bar under D-010 and the row would have been marked here.
//
// The stall the refusal creates is deliberate and is asserted, not glossed: while the
// two views disagree, the epoch stays unanswered and /readyz is red. Clause 7 says
// that is the right trade — retention costs availability, never correctness — and the
// last leg shows it is a stall rather than a wedge: when the fork resolves the epoch
// is answered, and it is answered with the canonical row still VALID.
func TestPollerRefusesToMarkWhenASecondEndpointContradictsThePass(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	for _, b := range []uint64{4900, 5000} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	st.cursor, st.cursorFound = 5000, true
	deep := uint64(100)
	st.rewindDeepTo = &deep

	// ENDPOINT 0 — THE MINORITY FORK. Coherent, and wrong: on its chain 5000 was
	// replaced, 4900 stands.
	ch.setHashOn(0, 5000, common.HexToHash("0xdead"))
	ch.canonicalOn(0, 4900)
	// ENDPOINT 1 — THE MAJORITY. 5000 is exactly the block our round anchored.
	ch.canonicalOn(1, 4900, 5000)

	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error")
	require.False(t, advanced, "one endpoint's coherent story is not evidence that its chain is canonical")

	require.Empty(t, st.neutralized, "NOTHING is marked: this is the round-6 finding, refused")
	require.Empty(t, st.rewinds)
	for _, r := range st.rows {
		require.True(t, r.valid, "canonical polled history keeps its validity")
	}
	require.True(t, st.unacked, "and the epoch is deliberately left unanswered")
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)
	require.Contains(t, pollConditions(p)[ConditionPollRewindBlocked], "no second endpoint would corroborate")
	require.True(t, containsSubstring(*msgs, "different chains there"),
		"the operator log names the disagreement rather than reporting a generic probe failure")
	require.Equal(t, 1, p.probeEndpoint,
		"the pin rotates OFF the endpoint whose view could not be corroborated")

	// While the fork stands the refusal is symmetric: the pass now runs on endpoint 1
	// and endpoint 0 contradicts IT. Neither view can act, and neither is guessed at.
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.neutralized)

	// THE STALL IS NOT A WEDGE. The fork resolves — endpoint 0 rejoins the majority —
	// and the epoch is answered on the next pass, with 5000 STILL VALID: the floor
	// lands at the block the minority view wanted to condemn.
	ch.canonicalOn(0, 5000)

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(5000), st.neutralized[0].verifiedFloor,
		"the corroborated floor is the height the minority fork claimed was orphaned")
	require.False(t, st.unacked)
	for _, r := range st.rows {
		require.True(t, r.valid, "and no canonical row was ever marked along the way")
	}
}

// D-012 CLAUSE 4, THE RATIFIED HALF: "with exactly one endpoint configured,
// single-view marking is permitted and here ratified... configuration is not a
// fault." Refusing on a fleet of one would stall price ingestion permanently on the
// first reorg, and no amount of waiting produces a second view.
//
// Codex round 7 was right that wave 7's version of this was an implementation-only
// exception to an accepted decision, and D-012 clause 4 is the ratification it asked
// for.
//
// THE DISCLOSURE'S SOURCE IS NOT CLAUSE 4, AND SAYING SO WAS THE ROUND-8 [medium].
// Clause 4 ratifies the MARKING and says nothing whatever about a WARN or a height
// range. Attributing the range-naming to the clause dressed a local choice in borrowed
// authority — the same disease as citing no source, one step worse, because it looks
// checkable and is not.
//
// THE SOURCE NOW EXISTS: ADD-1 (.superpowers/sdd/task-8-normative-addenda.md), ratified
// at fdb9f8d. "When the D-012 clause-4 one-endpoint arm authorizes a marking on a single
// chain view, the marking emits a WARN naming the affected height range" — because the
// trade is acceptable only while it is auditable. Wave 10 could cite nothing better than
// the wave-8 brief's R4, which was honest at the time and is superseded now. The two are
// cited separately below, as they always should have been.
func TestPollerMarksOnAOneEndpointFleetAndDisclosesTheHeightRange(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1}
	p, clk := newTestPoller(t, st, ch, 10)

	const H = uint64(5000)
	for _, b := range []uint64{4900, H} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	st.cursor, st.cursorFound = H, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	canonicalAt(ch, 4900)
	ch.setHash(H, common.HexToHash("0xdead"))
	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced, "a fleet of exactly one endpoint must not be wedged by an unobtainable agreement")
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(4900), st.neutralized[0].verifiedFloor)

	require.True(t, containsSubstring(*msgs, "SINGLE-VIEW CLASSIFICATION"),
		"the concession is never silent (ADD-1; D-012 clause 4 ratifies the MARKING, not this disclosure)")
	require.True(t, containsSubstring(*msgs, "exactly one rpc endpoint configured"),
		"and it names the CONFIGURED count, which is the fact clause 4 makes the marking turn on")
	require.True(t, containsSubstring(*msgs, "heightRangeMarked"),
		"and it names the HEIGHT RANGE, which is ADD-1's own requirement: an unauditable concession is not the one clause 4 ratified")

	// AND IT IS PERMANENT (clause 3). The one endpoint rejoins the canonical chain and
	// the head moves past H; nothing brings the row back, because nothing in the
	// running system can. This is the assertion wave 7 could not make — it had built a
	// revalidation pass — and it is now the SPECIFIED behaviour rather than a defect.
	canonicalAt(ch, H, 5200)
	ch.respond = okRound(t, 5200, 20, 1_000_000)
	ch.setHead(5200)
	clk.advance(2 * time.Minute)

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, uint64(5200), st.cursor, "the head really did move past H")

	marked := map[uint64]bool{}
	for _, r := range st.rows {
		if r.invalidReason == store.InvalidReasonUnverifiableReorg {
			marked[r.block] = true
		}
	}
	require.True(t, marked[H],
		"the classification at H stands even though the chain now reports the very block that round recorded: D-012 clause 3 removes the online revalidation that would have retired it")

	// The provenance is still there, which is the whole of clause 2 — the option of an
	// offline reconciliation is kept open, and only that.
	anchors, err := st.PollAnchorsBelow(context.Background(), engine, 10, 9000, 10)
	require.NoError(t, err)
	var heights []uint64
	for _, a := range anchors {
		heights = append(heights, a.BlockNumber)
	}
	require.Contains(t, heights, H,
		"the anchor recording the block H's round executed against is retained forever (D-012 clause 2)")
}

// D-012 CLAUSE 4, THE FAIL-CLOSED HALF, AND THE DISTINCTION THE CLAUSE TURNS ON:
// "the distinction is CONFIGURED count, not reachable count — two configured with one
// reachable is a fault and fails closed."
//
// This is round 7's [high] #4 in its sharpest form. Two endpoints are configured, so
// the deployment is NOT the ratified one-endpoint case; but the peer is down, so no
// second view answers. Wave 7's gate could not tell those apart at the decision site
// — it read an enum whose provenance it did not re-check — and a single unlucky
// timeout would have been enough to permanently classify canonical history on one
// node's word.
//
// The pass here is otherwise perfect: coherent, checkpointed, and still holding on its
// own endpoint. Nothing is marked, and the epoch is deliberately left unanswered.
func TestPollerFailsClosedWhenTheOnlyOtherEndpointIsUnreachable(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 2}
	p, clk := newTestPoller(t, st, ch, 10)

	const H = uint64(5000)
	for _, b := range []uint64{4900, H} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	st.cursor, st.cursorFound = H, true
	deep := uint64(100)
	st.rewindDeepTo = &deep

	// Endpoint 0 has a complete, coherent story: 4900 stands, H was replaced.
	ch.canonicalOn(0, 4900)
	ch.setHashOn(0, H, common.HexToHash("0xdead"))
	// Endpoint 1 is DOWN — a fault, not a fork, and not a configuration.
	ch.view(1).down = errors.New("dial tcp: connection refused")

	st.unacked = true
	p.lastAttempt = clk.now()
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a refusal is a health condition, not a Step error")
	require.False(t, advanced)

	require.Empty(t, st.neutralized,
		"two endpoints are CONFIGURED, so an unreachable peer is a fault and marking fails closed (D-012 clause 4)")
	for _, r := range st.rows {
		require.True(t, r.valid, "canonical polled history keeps its validity")
	}
	require.True(t, st.unacked, "and the epoch stays unanswered rather than being answered on one view")
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)
	require.Contains(t, pollConditions(p)[ConditionPollRewindBlocked], "no second endpoint would corroborate")
	require.False(t, containsSubstring(*msgs, "SINGLE-VIEW CLASSIFICATION"),
		"the ratified single-view path must NOT be reachable by a fault: that is the whole distinction")

	// AND IT IS A STALL, NOT A WEDGE. The peer comes back, agrees, and the epoch is
	// answered on the next pass — so failing closed costs availability while the fault
	// lasts and nothing after it.
	ch.view(1).down = nil
	ch.canonicalOn(1, 4900)
	ch.setHashOn(1, H, common.HexToHash("0xdead"))

	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(4900), st.neutralized[0].verifiedFloor)
}

// D-012 CLAUSE 4, THE DEGENERATE CONFIGURATION: a fleet with NO endpoints is not a
// ratified fleet of one.
//
// The clause permits single-view marking "with exactly one endpoint configured". Zero
// is not one: there is no view to be single, and the honest reading of a poller that
// cannot reach any chain at all is a misconfiguration, not permission. Wave 7's gate
// tested `count <= 1`, which would have swept this in.
//
// It cannot arise from chain.Failover today (construction refuses an empty endpoint
// list), which is exactly why it is worth pinning: the guard's correctness must not
// depend on a precondition enforced two packages away.
func TestPollerFailsClosedOnAFleetWithNoEndpointsConfigured(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 0}
	p, clk := newTestPoller(t, st, ch, 10)

	const H = uint64(5000)
	for _, b := range []uint64{4900, H} {
		st.seedRound(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, b, blockHashAt(b), clk.now())
	}
	st.cursor, st.cursorFound = H, true
	deep := uint64(100)
	st.rewindDeepTo = &deep
	canonicalAt(ch, 4900)
	ch.setHash(H, common.HexToHash("0xdead"))
	st.unacked = true
	p.lastAttempt = clk.now()

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.neutralized, "zero configured endpoints is a misconfiguration, not a ratified fleet of one")
	require.Contains(t, pollConditions(p), ConditionPollRewindBlocked)
	for _, r := range st.rows {
		require.True(t, r.valid)
	}
}

// D-012 CLAUSE 6: A CLEARED ACUTE SIGNAL MUST NOT HIDE THE HISTORICAL CLASSIFICATION.
//
// The acute conditions are all about the HEAD. ConditionPollInvalidAnswer clears the
// moment a valid observation lands for an asset; the round and block-advance
// conditions clear when a round commits. None of them can see a stretch of unreadable
// history below the frontier, so a poller that classified rows and then resumed
// polling normally reads entirely healthy while the gap is still there.
//
// Three things are asserted. The count SURVIVES the acute recovery; it is CURRENT —
// the round supersedes one of the marked rows and the number follows, rather than
// staying at what hydration read; and the recount happened because the STORE reported
// a supersede, which is the same clause's cost bound (see the sibling test below for
// the negative half).
func TestPollerNeutralizedBacklogSurvivesAndIsRefreshedByANewerRound(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	// A marked row at a height the chain never anchored: nothing can ever place it, so
	// it is the irreducible residue D-012 clause 6 has to keep reporting (carrying
	// D-011 clause 8, which is superseded text and not the live source).
	gapAt := clk.now()
	st.seedNeutralizedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 4000, gapAt)
	// And a marked row at the height the NEXT round will execute at, for a registry
	// asset — the shape a shallow reorg leaves behind, and the one thing a normal
	// round can retire on its own (insertPrice's supersede arm).
	clk.advance(time.Hour)
	st.seedNeutralizedRow(engine, realFeeds(t).PollAssets(10)[0].Address.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	st.cursor, st.cursorFound = 4000, true
	clk.advance(time.Hour)
	canonicalAt(ch, 5000)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)

	// THE HEAD IS HEALTHY. Every registry asset has a fresh, valid price.
	got := pollConditions(p)
	require.NotContains(t, got, ConditionPollInvalidAnswer, "the acute per-asset signal has cleared")
	require.NotContains(t, got, ConditionPollTargetFreshness)
	require.NotContains(t, got, ConditionPollRound)

	// AND THE HISTORICAL GAP IS STILL REPORTED, with an age measured from the original
	// observation rather than from now.
	backlog, known := p.NeutralizedBacklog()
	require.True(t, known)
	require.Equal(t, int64(1), backlog.Rows,
		"the count is CURRENT: hydration read 2, the round superseded one, and the number followed")
	require.Equal(t, uint64(4000), backlog.HighestBlock, "and it names the height that is still unreadable")
	require.Equal(t, gapAt, backlog.Oldest)
	require.Equal(t, 2*time.Hour, clk.now().Sub(backlog.Oldest), "the age is a real interval")

	require.False(t, st.rows[0].valid, "the unanchored row really is still marked")
	require.Equal(t, store.InvalidReasonUnverifiableReorg, st.rows[0].invalidReason)

	// AND THE RECOUNT WAS EARNED. One read at hydration, one after the round that
	// actually superseded a row. Wave 7 would have produced the same NUMBER by
	// re-reading unconditionally; clause 6 requires the number without the standing
	// cost, so the call count is part of the contract.
	require.Equal(t, 2, st.neutralizedStatsCalls,
		"hydration, then exactly one recount for the supersede the store reported")
}

// D-012 CLAUSE 6, THE COST BOUND: an ordinary landed round must NOT recount the
// backlog, even while a backlog exists.
//
// This is Codex round 7's [medium] as a property rather than as a fix. The clause:
// "the stats surface must be cheap — its cost may not scale with total price
// history". Before migration 00007 NeutralizedPriceStats had no index carrying
// invalid_reason (it does now, and round 8 required the measured evidence), and polled
// rows are never deleted, so wave 7's rule ("re-read after every landed round while a
// backlog remains") bought a full-history scan every 60 seconds forever on the
// strength of ONE permanently classified row. The cost depended on total history, not
// on backlog size.
//
// With the online drain removed (clause 3) the number can only move on two events:
// a neutralization, and a round that superseded a marked row. So the rule is now "ask
// the database only when the database says it changed", and this test asserts the
// silent case — the one that used to cost the most, because it is the steady state.
//
// The negative assertion is paired with a positive one so it cannot pass by the
// recount being broken outright: the sibling test above shows the same poller DOES
// recount when a supersede lands.
func TestPollerDoesNotRecountTheBacklogOnAnOrdinaryRound(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	// A NON-EMPTY backlog at a height nothing will ever revisit — the steady state
	// that made wave 7's rule expensive.
	st.seedNeutralizedRow(engine, priceProviderV2.Bytes(), SourcePriceProviderV2, 4000, clk.now())
	st.cursor, st.cursorFound = 4000, true
	canonicalAt(ch, 5000, 5100, 5200)

	require.NoError(t, p.hydrate(context.Background()))
	require.Equal(t, 1, st.neutralizedStatsCalls, "hydration reads it once")
	backlog, known := p.NeutralizedBacklog()
	require.True(t, known)
	require.Equal(t, int64(1), backlog.Rows)

	// Three ordinary rounds at fresh heights. None of them touches a classified row,
	// so none of them can change the count.
	for i, block := range []uint64{5000, 5100, 5200} {
		ch.respond = okRound(t, block, 20, int64(1_000_000+i))
		ch.setHead(block)
		clk.advance(2 * time.Minute)
		advanced, err := p.Step(context.Background())
		require.NoError(t, err)
		require.True(t, advanced)
		require.Equal(t, block, st.lastBatch(t).through, "round %d landed at its own height", i)
	}
	require.Equal(t, uint64(5200), st.cursor, "the rounds really landed")

	require.Equal(t, 1, st.neutralizedStatsCalls,
		"three landed rounds, zero recounts: the aggregate is paid for on transitions, not on the cadence (D-012 clause 6)")

	// AND THE NUMBER IS STILL REPORTED. Frugality must not become silence: the
	// classification the operator needs to see is exactly as visible as before.
	backlog, known = p.NeutralizedBacklog()
	require.True(t, known)
	require.Equal(t, int64(1), backlog.Rows)
	require.Equal(t, uint64(4000), backlog.HighestBlock)
}

// D-010 clause 1, STRUCTURALLY: the poller's store surface carries no deletion
// primitive at all. RewindPrices moved to FeedStore, whose engine derives its rows
// from raw_logs and can therefore replay them. This is the difference between a
// destructive path that is guarded and one that has been removed: no future edit
// to internal/prices/poller.go can call a method PollStore does not declare.
func TestPollStoreHasNoDeletionPrimitive(t *testing.T) {
	pollStore := reflect.TypeOf((*PollStore)(nil)).Elem()
	for i := 0; i < pollStore.NumMethod(); i++ {
		require.NotEqual(t, "RewindPrices", pollStore.Method(i).Name,
			"PollStore must not expose a price deletion primitive (D-010 clause 1)")
	}
	// And it is still available where deletion remains correct.
	feedStore := reflect.TypeOf((*FeedStore)(nil)).Elem()
	_, ok := feedStore.MethodByName("RewindPrices")
	require.True(t, ok, "the event-derived feed path keeps its rewind: raw_logs makes it replayable")

	// D-012 CLAUSE 3, THE SAME WAY: the online revalidation subsystem is not on this
	// surface either. Clause 3 removes it outright — "neutralization is a permanent
	// classification in the running system" — and the two methods D-011 introduced are
	// named so that re-adding either one fails here rather than quietly restoring the
	// machinery that hosted both of Codex round 7's criticals.
	for _, gone := range []string{"RevalidateNeutralizedPrices", "NeutralizedPriceAnchors"} {
		_, present := pollStore.MethodByName(gone)
		require.False(t, present,
			"%s is the online revalidation D-012 clause 3 removes; restoring it needs a decision, not a method", gone)
	}
	// Clause 6 keeps the classification VISIBLE even though clause 3 removes the repair.
	_, ok = pollStore.MethodByName("NeutralizedPriceStats")
	require.True(t, ok, "the gap must stay countable (D-012 clause 6)")
}

// LEGACY ANCHOR ADOPTION IS GONE, AND ITS ABSENCE IS ASSERTED STRUCTURALLY (Codex
// round 9's [high] #2).
//
// The old tests here drove the adoption path and its pending-epoch refusal. Neither
// could have caught the finding, because the hazard was not in a store refusal: after
// a RESTART the poller's one-time latch is false again, so heights whose GENUINE
// anchor retention had pruned were re-adopted from the CURRENT chain — with no
// surviving anchor to diverge against — and the next successful poll pruned the
// adoption again. Fabricated provenance at cadence, from a path all of whose guards
// were working as designed.
//
// It is deleted rather than guarded because round 9's other high removed its purpose:
// a row is provable only through its OWN anchor_block binding, and adoption cannot
// write one without performing the backfill migration 00007 prohibits. So the
// assertion is that the METHODS ARE NOT THERE — a path the interface does not declare
// cannot be re-entered by a future edit, which is the same argument D-012 clause 3's
// removal test makes.
func TestPollStoreDeclaresNoLegacyAnchorAdoption(t *testing.T) {
	pollStore := reflect.TypeOf((*PollStore)(nil)).Elem()
	for _, gone := range []string{"AdoptPollAnchor", "UnanchoredPriceBlocks"} {
		_, present := pollStore.MethodByName(gone)
		require.False(t, present,
			"%s is legacy anchor adoption, deleted in wave 12: it can no longer make any row provable (its binding stays NULL) and it re-fabricated pruned anchors after every restart. Restoring it needs a decision, not a method", gone)
	}
	// The poller's own adoption step is gone too. That half is proven by the COMPILER
	// rather than asserted here: reflect does not expose unexported methods, so a
	// require.NotContains over reflect.TypeOf(&Poller{}) would pass whether or not
	// adoptLegacyAnchors existed — a test that cannot fail is worse than none. What
	// stands in its place is that no call site remains anywhere in the package, which
	// the build enforces continuously.
}

// The rewind resumes from the CURSOR READ BACK, never from the requested target:
// the store may have lowered it to a deeper unacknowledged epoch.
func TestPollerRewindResumesFromCursorReadBack(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = 4000, true
	deep := uint64(3500)
	st.rewindDeepTo = &deep
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, uint64(4000), st.neutralized[0].toBlock, "the poller asked for its cursor")
	require.Equal(t, uint64(3500), st.cursor, "the store lowered it, and that is what stands")
}

// Bootstrap (no cursor yet on an epoch-carrying chain) targets block 0 with NO
// floor: there is nothing of this writer's above it, and no anchor to verify. It
// goes through the SAME non-destructive primitive as every other arm.
func TestPollerBootstrapRepairTargetsZero(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursorFound = false
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Empty(t, st.rewinds, "not even bootstrap has a deletion path")
	require.Equal(t, uint64(0), st.neutralized[0].toBlock)
	require.Equal(t, uint64(0), st.neutralized[0].verifiedFloor)
	require.Empty(t, ch.hashCalls, "no cursor means no anchor to verify: no probe is issued")
}

// A store that leaves no cursor after answering the epoch has violated its
// contract; the poller says so instead of proceeding on an unknown resume point.
func TestPollerRepairMissingCursorIsAnError(t *testing.T) {
	st := newFakePriceStore()
	st.unacked = true
	st.cursor, st.cursorFound = 4000, true
	st.repairLeavesNoCursor = true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.ErrorContains(t, err, "store contract violated")
}

// The reactive backstop: an epoch recorded AFTER this Step's proactive check
// surfaces as ApplyPrices' ErrUnackedReorgEpoch and is answered by a rewind.
func TestPollerReactiveEpochRewind(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{store.ErrUnackedReorgEpoch}
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "recovered, not fatal")
	require.True(t, advanced)
	require.Len(t, st.neutralized, 1)
	require.Equal(t, uint64(4000), st.neutralized[0].toBlock)
}

// D3 (ENDPOINT BRANCH): a frozen endpoint answers eth_call successfully with an
// OLD execution block. The store's monotonic cursor guard catches it, the poller
// VERIFIES its own frontier anchor is still canonical — which rules a reorg out —
// and only then pins the NEXT endpoint via CallFrom, leaving the shared hint alone.
func TestPollerStaleEndpointPinsNextEndpointAfterVerifyingFrontier(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, active: 1, respond: okRound(t, 4000, 20, 1_000_000)}
	ch.setHead(4000)
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 5000) // our frontier is still canonical
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a stale round is DEGRADED, not an error to back off on")
	require.False(t, advanced, "nothing was recorded")
	require.Equal(t, []int{1}, ch.headServed, "the first round resolved its serving endpoint from the shared hint")
	require.Equal(t, []int{1}, ch.served, "and the pinned multicall was served by that same endpoint")
	require.Equal(t, []int{1, 2}, ch.hashStart,
		"the round's own closing re-read stayed pinned to its endpoint; the ancestry probe then avoided the endpoint under suspicion")
	require.Equal(t, []uint64{4000, 5000}, ch.hashCalls,
		"the re-read asked about the round's pin, the probe about the frontier anchor")
	require.Equal(t, 2, p.preferredStart, "one past the endpoint that served the stale round")
	require.True(t, containsSubstring(*msgs, "stale rpc endpoint"))
	require.Equal(t, 1, p.staleRotations)

	// The next round resolves its serving endpoint at the pinned start.
	clk.advance(time.Minute)
	ch.respond = okRound(t, 5100, 20, 1_000_001)
	ch.setHead(5100)
	advanced, err = p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Equal(t, []int{1, 2}, ch.headStarts, "the head resolution started at the pin")
	require.Equal(t, -1, p.preferredStart, "genuine progress released the preference")
}

// D3 (REORG BRANCH, WALKER IN BACKOFF): the walker has not recorded the epoch yet
// — it is backing off, for up to its ten-minute capped delay — so every
// cadence-due round sees a cursor regression. The poller must NOT blame an
// endpoint, must NOT rotate, and must NOT raise the all-endpoints-behind alarm
// across that whole window; the evidence is its own frontier anchor being orphaned.
func TestPollerRegressionDuringWalkerBackoffSuppressesEndpointBlame(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	// The chain replaced our frontier, and no epoch is recorded (walker backing off).
	ch := &fakePollChain{endpoints: 2, respond: okRound(t, 4900, 20, 1_000_000)}
	ch.setHead(4900)
	ch.setHash(5000, common.HexToHash("0xfeed"))
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression,
		store.ErrDeriveCursorRegression,
		store.ErrDeriveCursorRegression,
	}
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	for i := 0; i < 3; i++ {
		advanced, err := p.Step(context.Background())
		require.NoError(t, err)
		require.False(t, advanced)
		require.Equal(t, -1, p.preferredStart, "round %d: no endpoint may be implicated", i)
		require.Zero(t, p.staleRotations, "round %d: the all-behind streak must not accrue", i)
		clk.advance(time.Minute)
	}
	require.True(t, containsSubstring(*msgs, "the cause is a REORG, not an endpoint"))
	require.False(t, containsSubstring(*msgs, "all endpoints behind"),
		"a reorg must never produce the all-endpoints-behind diagnosis")
	require.False(t, containsSubstring(*msgs, "stale rpc endpoint"))
}

// D3 (UNKNOWN BRANCH): with no anchor to verify against, the cause cannot be
// determined — a reorg remains possible — so no endpoint-specific conclusion is
// drawn. The disclosed cost is that a genuinely frozen endpoint is not routed
// around for that round.
func TestPollerRegressionWithUndeterminedCauseSuppressesRotation(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true // cursor but NO anchor (post-bootstrap)
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	ch.setHead(4000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Equal(t, -1, p.preferredStart, "nothing may be pinned on undetermined evidence")
	require.Zero(t, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "UNDETERMINED cause"))
	require.Equal(t, []uint64{4000}, ch.hashCalls,
		"only the round's own coherent-window re-read: with no anchor there is no ancestry probe to issue")
}

// D3 (UNKNOWN BRANCH, PROBE FAILURE): an anchor exists but cannot be checked.
// Same posture — cause unknown, no rotation.
func TestPollerRegressionWithFailedAncestryProbeSuppressesRotation(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	ch.setHead(4000)
	// The frontier anchor's height is unreadable on EVERY endpoint, while the
	// round's own reads (head and re-read at 4000) stay healthy — the probe
	// outage is the ancestry check's alone.
	ch.failProbe(5000, errors.New("probe timed out"))
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, -1, p.preferredStart)
	require.Zero(t, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "UNDETERMINED cause"))
	require.True(t, containsSubstring(*msgs, "ancestry probe"))
}

// D3 (REORG BRANCH, EPOCH ALREADY RECORDED): the cheap check runs first and costs
// no RPC at all.
func TestPollerRegressionWithRecordedEpochNeedsNoProbe(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true
	st.applyErrs = []error{store.ErrDeriveCursorRegression}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	ch.setHead(4000)
	p, _ := newTestPoller(t, st, ch, 10)
	// HasUnackedReorg is false on the proactive check and true by the time the
	// apply is classified: a walker rewind landed in between.
	st.unackedAfterApply = true
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, -1, p.preferredStart)
	require.Equal(t, []uint64{4000}, ch.hashCalls,
		"only the round's own re-read: the durable reorg check settles the classification without an ancestry probe")
	require.True(t, containsSubstring(*msgs, "durable reorg epoch is already recorded"))
}

// A1/D3: a poll round that re-anchors a height with a DIFFERENT hash is positive
// proof of a reorg. The store aborts the batch and the poller treats it as a
// reorg, never as evidence about the endpoint.
func TestPollerAnchorDivergenceIsTreatedAsReorg(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 5000, true
	st.applyErrs = []error{store.ErrPollAnchorDivergence}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	advanced, err := p.Step(context.Background())
	require.NoError(t, err, "a detected reorg is not an error to back off on")
	require.False(t, advanced)
	require.Equal(t, -1, p.preferredStart, "no endpoint is implicated by a reorg")
	require.Zero(t, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "the cause is a REORG, not an endpoint"))
}

// Cycling every endpoint without landing a round logs the all-endpoints-behind
// DEGRADED warning — telemetry, not a correctness gate. It requires the ENDPOINT
// attribution, which requires a verified frontier.
func TestPollerAllEndpointsBehindWarns(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression,
		store.ErrDeriveCursorRegression,
	}
	ch := &fakePollChain{endpoints: 2, respond: okRound(t, 4000, 20, 1_000_000)}
	ch.setHead(4000)
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 5000)
	msgs := captureWarnings(t)

	for i := 0; i < 2; i++ {
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		clk.advance(time.Minute)
	}
	require.Equal(t, 2, p.staleRotations)
	require.True(t, containsSubstring(*msgs, "all endpoints behind"))
}

// An AMBIGUOUS apply error retains the pin (releasing it would let the next
// round fall back to a shared hint that may still point at a rejected endpoint)
// but the retention is LEASED: the third consecutive ambiguity rotates it.
func TestPollerAmbiguousApplyRetainsPinThenRotates(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.applyErrs = []error{
		store.ErrDeriveCursorRegression, // pins preferredStart = 1
		errors.New("commit ack lost 1"),
		errors.New("commit ack lost 2"),
		errors.New("commit ack lost 3"),
	}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4000, 20, 1_000_000)}
	ch.setHead(4000)
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 5000)
	msgs := captureWarnings(t)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, p.preferredStart)

	for i := 1; i <= 2; i++ {
		clk.advance(time.Minute)
		_, err := p.Step(context.Background())
		require.Error(t, err)
		require.Equal(t, 1, p.preferredStart, "ambiguity %d retains the pin", i)
		require.Equal(t, i, p.consecutiveAmbiguous)
		require.Zero(t, p.staleRotations, "an apply error restarts the stale telemetry")
	}

	clk.advance(time.Minute)
	_, err = p.Step(context.Background())
	require.Error(t, err)
	require.Equal(t, 2, p.preferredStart, "the lease is spent: rotate so a recovered endpoint is reprobed")
	require.Zero(t, p.consecutiveAmbiguous)
	require.True(t, containsSubstring(*msgs, "rotating preferred endpoint"))
}

// With NO pin, an ambiguous error consumes no lease: multicalls already follow
// the shared hint and there is nothing to bound.
func TestPollerAmbiguousApplyWithoutPinConsumesNoLease(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{errors.New("commit ack lost")}
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.Error(t, err)
	require.Equal(t, -1, p.preferredStart)
	require.Zero(t, p.consecutiveAmbiguous)
	require.Equal(t, -1, p.exploreStart,
		"the round LANDED — the only outcome that keeps the starting point; an ambiguous APPLY error is the lease's business, never the non-landing seam's")
}

// THE APPLY-ERROR RESET, poller side: in the commit-landed-with-lost-ack world
// the rows DID land, and re-hydrating from durable truth is the only way to know
// it. Freshness must reflect what actually persisted, not what the error implied.
func TestPollerRehydratesFreshnessAfterAmbiguousApply(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{errors.New("commit ack lost")}
	st.applyAdvancesDespiteErr = true // the transaction committed; the ack was lost
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.Error(t, err, "the caller still sees the indeterminate error")
	require.Equal(t, 2, st.freshnessCalls, "hydrate at Step, then re-hydrate after the uncertain apply")
	require.True(t, p.hydrated)
	require.Len(t, p.lastUsable, 20, "the rows that DID land are reflected in freshness")

	clk.advance(time.Duration(pollHealthGrace)*time.Minute - time.Second)
	healthy, reason := p.Health()
	require.True(t, healthy, "prices landed within the grace window, got %q", reason)
}

// A failed re-hydration after an uncertain apply must not leave a green verdict
// resting on state whose relationship to storage is unknown.
func TestPollerFailedRehydrationMarksVerdictUntrusted(t *testing.T) {
	st := newFakePriceStore()
	st.cursor, st.cursorFound = 4000, true
	st.applyErrs = []error{errors.New("commit ack lost")}
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	// Hydration succeeds at Step, then the database goes away.
	st.freshnessErrAfter = 1
	st.freshnessErr = errors.New("database unreachable")

	_, err := p.Step(context.Background())
	require.Error(t, err)
	require.False(t, p.hydrated)
	require.True(t, containsSubstring(*msgs, "could not re-hydrate durable price state"))

	clk.advance(time.Duration(pollHealthGrace)*time.Minute + time.Second)
	healthy, _ := p.Health()
	require.False(t, healthy)
	require.Contains(t, pollConditions(p), ConditionPollFreshnessUnhydrated)
}

// Health recovers: a landed round clears both conditions.
func TestPollerHealthIsRecoverable(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	healthy, _ := p.Health()
	require.True(t, healthy, "a fresh poller is healthy for its grace window")

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	healthy, _ = p.Health()
	require.True(t, healthy)

	clk.advance(time.Duration(pollHealthGrace)*time.Minute + time.Second)
	healthy, reason := p.Health()
	require.False(t, healthy)
	require.Contains(t, reason, "no poll round has durably recorded a usable price")

	ch.respond = okRound(t, 5100, 20, 1_000_001)
	ch.setHead(5100)
	_, err = p.Step(context.Background())
	require.NoError(t, err)
	healthy, reason = p.Health()
	require.True(t, healthy, "a landed round clears it — this state is recoverable, got %q", reason)
}

func TestNewPollerValidation(t *testing.T) {
	feeds := realFeeds(t)
	ch := &fakePollChain{endpoints: 1}

	_, err := NewPoller(nil, ch, feeds, PollerConfig{ChainID: 10, Interval: time.Minute})
	require.ErrorContains(t, err, "store, chain and feed registry are all required")

	_, err = NewPoller(newFakePriceStore(), ch, feeds, PollerConfig{ChainID: 0, Interval: time.Minute})
	require.ErrorContains(t, err, "chain id is required")

	_, err = NewPoller(newFakePriceStore(), ch, feeds, PollerConfig{ChainID: 10, Interval: 0})
	require.ErrorContains(t, err, "interval must be positive")

	// A chain with no obligations is a refusal, not an empty poller.
	_, err = NewPoller(newFakePriceStore(), ch, feeds, PollerConfig{ChainID: 42161, Interval: time.Minute})
	require.ErrorContains(t, err, "declares no poll obligations on chain 42161")
}

// Growing the registry past what one multicall may carry is a CONSTRUCTION
// refusal, not silent chunking: splitting a round gives up its single as-of
// block, and that must be a deliberate decision.
func TestNewPollerRefusesOversizedRegistry(t *testing.T) {
	var assets []config.Feed
	for i := 0; i <= maxPollTargets; i++ {
		var a common.Address
		a[19] = byte(i)
		a[18] = byte(i >> 8)
		assets = append(assets, config.Feed{
			Chain: "op", ChainID: 10, Engine: "debt_manager", Address: a,
			Symbol: "T", Decimals: 18, Roles: []string{"debt"},
			Oracle: config.FeedOracle{
				Kind: config.FeedKindPoll, Contract: priceProviderV2,
				Method: "price(address)", PriceDecimals: 6,
			},
		})
	}
	_, err := NewPoller(newFakePriceStore(), &fakePollChain{endpoints: 1},
		&config.Feeds{Assets: assets}, PollerConfig{ChainID: 10, Interval: time.Minute})
	require.ErrorContains(t, err, "exceed the 100-per-round bound")
}

// ---------------------------------------------------------------------------
// Principle 1: only a durable, newly-observed fact may refresh health.
// ---------------------------------------------------------------------------

// B-FROZEN: an rpc endpoint frozen EXACTLY at the cursor is the one semantic
// failure that never surfaces as an RPC error. Every eth_call succeeds, the store
// accepts the equal-height replay as idempotent success, no cursor regression
// fires, and nothing new is inserted. The previous version stamped every returned
// target with process time on that nil error, so health stayed green forever.
//
// The fix is structural: freshness can only move from the rows the apply reports
// having inserted, and a replay reports none.
func TestPollerFrozenEndpointAtCursorRefreshesNothing(t *testing.T) {
	st := newFakePriceStore()
	st.enforceCursorMonotonic = true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	// One healthy round establishes the cursor, the rows and the anchor.
	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.rows, 20)
	healthy, _ := p.Health()
	require.True(t, healthy)

	// The endpoint now freezes at that exact height and answers identically
	// forever.
	for i := 0; i < 6; i++ {
		clk.advance(time.Minute)
		advanced, err = p.Step(context.Background())
		require.NoError(t, err, "round %d: the RPC call and the apply both succeed", i)
		require.True(t, advanced, "round %d: the store accepts an equal-height replay", i)
	}
	require.Len(t, st.rows, 20, "six further rounds inserted NOTHING")
	require.Len(t, st.anchors[PollCursorEngine(10)], 1, "and anchored no new execution block")

	healthy, reason := p.Health()
	require.False(t, healthy, "a stalled oracle path must not read as healthy: %q", reason)
	got := pollConditions(p)
	require.Contains(t, got, ConditionPollRound, "no round durably recorded a usable price")
	require.Contains(t, got, ConditionPollTargetFreshness, "and every asset's usable price has aged out")
	require.Contains(t, got, ConditionPollBlockAdvance,
		"and the execution block has not advanced within its bounded TTL")
	require.Contains(t, got[ConditionPollBlockAdvance], "no NEW execution block")
	require.Contains(t, got[ConditionPollBlockAdvance], "5000")
	require.True(t, containsSubstring(*msgs, "recorded NOTHING NEW"),
		"the operator log names the replay explicitly")
}

// The block-advance clock is hydrated from the newest ANCHOR ROW's own database
// timestamp, so a restart cannot grant a frozen chain view a fresh window — the
// restart-reset defect, applied to the block-advance signal.
func TestPollerHydratesBlockAdvanceClockFromDurableAnchor(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	// Durable history a previous process left: every asset priced a moment ago, but
	// the newest anchor is HOURS old — the chain view froze long before this
	// process started.
	for _, a := range realFeeds(t).PollAssets(10) {
		st.seedRow(engine, a.Address.Bytes(), SourcePriceProviderV2, 5000, clk.now())
	}
	st.seedAnchorAt(engine, 5000, blockHashAt(5000), clk.now().Add(-3*time.Hour))
	st.cursor, st.cursorFound = 5000, true
	p.lastAttempt = clk.now() // not due: isolate hydration

	advanced, err := p.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)

	got := pollConditions(p)
	require.Contains(t, got, ConditionPollBlockAdvance)
	require.Contains(t, got[ConditionPollBlockAdvance], "5000")
	require.NotContains(t, got, ConditionPollTargetFreshness,
		"the recorded prices themselves are current: this condition is about the CHAIN not moving")
	require.NotContains(t, got, ConditionPollRound)
}

// B-INVALID (POLL SIDE): a quarantined non-positive answer is a real observation —
// it proves the oracle was reached, which is why the cursor may advance on it — but
// it is not a usable price. It must never refresh usable-price freshness, and it is
// reported as its own condition so "no data" and "poisoned data" stay
// distinguishable.
func TestPollerQuarantinedAnswerDoesNotRefreshUsableFreshness(t *testing.T) {
	st := newFakePriceStore()
	ch := &fakePollChain{endpoints: 1}
	block := uint64(5000)
	zeroed := false
	ch.respond = func(int, common.Address, []byte) ([]byte, error) {
		rets := make([]mcRet, 20)
		for i := range rets {
			rets[i] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(1_000_000))}
		}
		if zeroed {
			rets[2] = mcRet{Success: true, ReturnData: encodeUint256(t, big.NewInt(0))}
		}
		return encodeMulticall(t, block, rets), nil
	}
	p, clk := newTestPoller(t, st, ch, 10)

	// One good round, then four rounds in which one oracle answers ZERO while the
	// rest stay healthy. Rounds keep landing and the block keeps advancing.
	ch.setHead(block)
	_, err := p.Step(context.Background())
	require.NoError(t, err)
	zeroed = true
	for i := 0; i < 4; i++ {
		block += 100
		ch.setHead(block)
		clk.advance(time.Minute)
		_, err = p.Step(context.Background())
		require.NoError(t, err)
	}

	healthy, reason := p.Health()
	require.False(t, healthy, "an oracle answering zero every interval is not healthy")
	got := pollConditions(p)
	require.NotContains(t, got, ConditionPollRound, "other assets ARE landing usable prices")
	require.Contains(t, got, ConditionPollInvalidAnswer)
	require.Contains(t, got, ConditionPollTargetFreshness,
		"usable freshness for that asset aged out exactly as if the oracle had answered nothing")

	broken := realFeeds(t).PollAssets(10)[2]
	require.Contains(t, got[ConditionPollInvalidAnswer], broken.Symbol)
	require.Contains(t, got[ConditionPollInvalidAnswer], "non-positive oracle answer")
	require.Contains(t, got[ConditionPollTargetFreshness], "1 of 20 registry assets")
	require.Contains(t, reason, broken.Symbol)

	// A usable answer clears both: this class is recoverable.
	zeroed = false
	block += 100
	ch.setHead(block)
	clk.advance(time.Minute)
	_, err = p.Step(context.Background())
	require.NoError(t, err)
	got = pollConditions(p)
	require.NotContains(t, got, ConditionPollInvalidAnswer)
	require.NotContains(t, got, ConditionPollTargetFreshness)
}

// The quarantine marker is HYDRATED from durable rows, so a restart cannot hide an
// oracle whose newest recorded answer is unusable.
func TestPollerHydratesQuarantineMarkerAcrossRestart(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 5000, 20, 1_000_000)}
	ch.setHead(5000)
	p, clk := newTestPoller(t, st, ch, 10)

	assets := realFeeds(t).PollAssets(10)
	for i, a := range assets {
		st.seedRow(engine, a.Address.Bytes(), SourcePriceProviderV2, 4900, clk.now())
		if i == 4 {
			// A newer, QUARANTINED row on top of the good one.
			st.seedInvalidRow(engine, a.Address.Bytes(), SourcePriceProviderV2, 5000, clk.now())
		}
	}
	st.seedAnchor(engine, 5000, blockHashAt(5000))
	st.cursor, st.cursorFound = 5000, true
	p.lastAttempt = clk.now()

	_, err := p.Step(context.Background())
	require.NoError(t, err)

	got := pollConditions(p)
	require.Contains(t, got, ConditionPollInvalidAnswer)
	require.Contains(t, got[ConditionPollInvalidAnswer], assets[4].Symbol)
	require.NotContains(t, got, ConditionPollTargetFreshness,
		"the underlying good answer is still recent, so only the validity condition fires")
}

// ---------------------------------------------------------------------------
// D3: diagnosis and recovery are separate.
// ---------------------------------------------------------------------------

// D3-STALL: with the shared endpoint frozen BELOW the cursor and no anchor to
// classify against, wave 1's behaviour was an indefinite stall — every eth_call
// succeeded so error-driven failover never fired, every apply regressed, and no
// round could ever land the anchor that would make classification decidable.
//
// Attribution is still withheld (nothing is provable), but the next round is routed
// to a DIFFERENT endpoint as bounded exploration, which is what ends the stall.
func TestPollerRepeatedCauseUnknownExploresAlternateEndpointsUntilProgress(t *testing.T) {
	st := newFakePriceStore()
	st.enforceCursorMonotonic = true
	st.cursor, st.cursorFound = 5000, true // a cursor but NO anchor: undiagnosable
	ch := &fakePollChain{endpoints: 3, active: 0}
	ch.respond = func(idx int, to common.Address, data []byte) ([]byte, error) {
		if idx == 2 {
			return okRound(t, 5100, 20, 1_000_000)(idx, to, data) // the healthy node
		}
		return okRound(t, 4000, 20, 1_000_000)(idx, to, data) // frozen below the cursor
	}
	// Each endpoint's HEAD matches the state its multicall serves: the frozen
	// nodes report the old head, the healthy one a live head.
	ch.setHeadOn(0, 4000)
	ch.setHeadOn(1, 4000)
	ch.setHeadOn(2, 5100)
	p, clk := newTestPoller(t, st, ch, 10)
	msgs := captureWarnings(t)

	for i := 0; i < 3; i++ {
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		require.Equal(t, -1, p.preferredStart, "round %d: nothing may be ATTRIBUTED on undetermined evidence", i)
		require.Zero(t, p.staleRotations, "round %d: no all-behind streak may accrue", i)
		clk.advance(time.Minute)
	}

	require.Equal(t, []int{0, 1, 2}, ch.headStarts,
		"the first round followed the shared hint; exploration then moved one endpoint further each undiagnosable round, and stopped once a round landed")
	require.Equal(t, uint64(5100), st.cursor, "the healthy endpoint ended the stall")
	require.Len(t, st.rows, 20)
	require.Equal(t, -1, p.exploreStart, "progress released the exploration hint")
	require.True(t, containsSubstring(*msgs, "bounded exploration"))
	require.False(t, containsSubstring(*msgs, "stale rpc endpoint"),
		"no endpoint was ever accused")
	require.False(t, containsSubstring(*msgs, "all endpoints behind"))
}

// With a SINGLE endpoint there is nothing to explore towards, and the code says so
// rather than pretending otherwise.
func TestPollerCauseUnknownWithOneEndpointCannotExplore(t *testing.T) {
	st := newFakePriceStore()
	st.enforceCursorMonotonic = true
	st.cursor, st.cursorFound = 5000, true
	ch := &fakePollChain{endpoints: 1, respond: okRound(t, 4000, 20, 1_000_000)}
	ch.setHead(4000)
	p, _ := newTestPoller(t, st, ch, 10)

	_, err := p.Step(context.Background())
	require.NoError(t, err)
	require.Equal(t, -1, p.exploreStart, "one endpoint: exploration is unavailable, not faked")
	require.Equal(t, -1, p.preferredStart)
	require.Equal(t, []int{0}, ch.headStarts,
		"the round resolved from the shared hint: no exploration start was ever pinned")
}

// D3-BOUND: an anchor BELOW the cursor cannot cover the heights a regression is
// about, so verifying it proves nothing and attribution would be guesswork.
//
// Wave 1 attributed those rounds to the endpoint anyway and documented the cost as
// "one misattributed pin released by the next round's progress". Progress is not
// guaranteed: with the canonical head below the cursor every healthy endpoint
// regresses, the same lower anchor keeps verifying, and each round accuses another
// node — cycling all of them and emitting a false all-endpoints-behind diagnosis
// for the whole walker backoff window. This is now cause-unknown.
func TestPollerRegressionWithFrontierBelowCursorIsCauseUnknown(t *testing.T) {
	st := newFakePriceStore()
	engine := PollCursorEngine(10)
	st.enforceCursorMonotonic = true
	st.cursor, st.cursorFound = 5000, true
	st.seedAnchor(engine, 4000, blockHashAt(4000)) // the anchor does NOT reach the cursor
	ch := &fakePollChain{endpoints: 3, respond: okRound(t, 4500, 20, 1_000_000)}
	ch.setHead(4500)
	p, clk := newTestPoller(t, st, ch, 10)
	canonicalAt(ch, 4000) // it still verifies — and that is exactly the trap
	msgs := captureWarnings(t)

	for i := 0; i < 4; i++ {
		_, err := p.Step(context.Background())
		require.NoError(t, err)
		require.Equal(t, -1, p.preferredStart,
			"round %d: ancestry that stops below the cursor cannot implicate an endpoint", i)
		require.Zero(t, p.staleRotations, "round %d", i)
		clk.advance(time.Minute)
	}

	require.Equal(t, []uint64{4500, 4500, 4500, 4500}, ch.hashCalls,
		"only the rounds' own re-reads: the ancestry probe is not even issued, because an anchor below the cursor cannot answer the question")
	require.True(t, containsSubstring(*msgs, "UNDETERMINED cause"))
	require.True(t, containsSubstring(*msgs, "but the cursor is at"))
	require.False(t, containsSubstring(*msgs, "stale rpc endpoint"))
	require.False(t, containsSubstring(*msgs, "all endpoints behind"),
		"the false all-endpoints-behind diagnosis is exactly what this branch prevents")
}
