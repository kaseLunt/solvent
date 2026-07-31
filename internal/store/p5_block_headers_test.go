package store

// Live-database tests for P5 Task B2's block-time custody surface
// (migration 00015 + p5_block_headers.go).
//
// THE LAW UNDER TEST: block_time is CHAIN-ASSERTED ONLY — the header's own
// timestamp, exactly as fetched — and absence is the honest state for an
// unfetched block. Nothing here may fabricate a time from an insertion clock,
// and no write path may silently overwrite custody evidence.
//
// MUTATION SPECS (written BEFORE the implementation loop; transcript at
// testdata/mutation-transcripts/p5-b2.md):
//
//   m1 (fabricated time): the writer stamps the database clock instead of the
//      caller's header time — UpsertBlockHeader's $-bound block_time replaced
//      with extract(epoch from now())::bigint. KILLED by
//      TestUpsertBlockHeaderStoresChainAssertedTimeExactly, whose fixture time
//      (2021-04-13) is years away from any test-run clock.
//   m3 (rollup non-idempotent) lives in p5_observatory_test.go.

import (
	"context"
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

// testP5Store is testRiskStore (derive + risk tables emptied) plus the P5
// tables emptied — the observatory rollup observes risk batches, so both
// suites share this helper.
func testP5Store(t *testing.T) *Store {
	t.Helper()
	s := testRiskStore(t)
	_, err := s.pool.Exec(context.Background(),
		"TRUNCATE block_headers, observatory_points")
	require.NoError(t, err)
	return s
}

func bhHash32(b byte) []byte {
	h := make([]byte, 32)
	h[0] = 0xbb
	h[31] = b
	return h
}

// seedEventAt lands one raw log (the PIN) and one derived position event at
// the given block, through the REAL writers, so the join the reader performs
// is the join production data satisfies.
func seedEventAt(t *testing.T, s *Store, stream, engine string, chainID, block uint64, blockHash, txHash []byte) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, stream, chainID, []RawLog{{
		ChainID: chainID, BlockNumber: block, BlockHash: blockHash,
		TxHash: txHash, LogIndex: 0, Address: addr20(0xAA),
		Topics: [][]byte{{0x01}}, Data: []byte{0x02},
	}}, block, blockHash))
	require.NoError(t, s.ApplyDerived(ctx, engine, chainID, []PositionEvent{{
		ChainID: chainID, Engine: engine, BlockNumber: block,
		TxHash: txHash, LogIndex: 0, EventType: "borrow",
		Account: addr20(0x01), Asset: addr20(0x02), Side: "debt",
		Delta: big.NewInt(1),
	}}, block))
}

// TestUpsertBlockHeaderStoresChainAssertedTimeExactly is the m1 killer: the
// row's block_time is the HEADER's own timestamp, byte-exact, not any clock
// this process or the database could have consulted at write time.
func TestUpsertBlockHeaderStoresChainAssertedTimeExactly(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	const headerTime = int64(1_618_300_800) // 2021-04-13T08:00:00Z — years from any test-run clock
	res, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{
		ChainID: 10, Block: 149_521_300, Hash: bhHash32(0x01), Time: headerTime,
	})
	require.NoError(t, err)
	require.True(t, res.Stored)

	var gotTime int64
	var gotHash []byte
	var driftSeconds float64
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT block_time, block_hash, abs(extract(epoch FROM now()) - block_time)
		 FROM block_headers WHERE chain_id = 10 AND block_number = 149_521_300`).
		Scan(&gotTime, &gotHash, &driftSeconds))
	require.Equal(t, headerTime, gotTime,
		"block_time must be the header's OWN timestamp, exactly as given — a writer stamping any clock of its own is the fabricated-time mutant")
	require.Equal(t, bhHash32(0x01), gotHash)
	require.Greater(t, driftSeconds, float64(24*3600),
		"the fixture time is deliberately years from now(); a stored value near the database clock means the writer fabricated it")
}

func TestUpsertBlockHeaderIdempotentAndRefusesDivergence(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	w := BlockHeaderWrite{ChainID: 1, Block: 20_625_600, Hash: bhHash32(0x02), Time: 1_724_000_000}
	res, err := s.UpsertBlockHeader(ctx, w)
	require.NoError(t, err)
	require.True(t, res.Stored)

	// An identical re-write is an idempotent no-op, not an error and not a
	// duplicate.
	res, err = s.UpsertBlockHeader(ctx, w)
	require.NoError(t, err)
	require.True(t, res.Stored)
	var count int
	require.NoError(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM block_headers WHERE chain_id = 1`).Scan(&count))
	require.Equal(t, 1, count)

	// A DIVERGENT write — different hash, different time — is REFUSED, never a
	// silent overwrite, and the refusal names what stands.
	div := BlockHeaderWrite{ChainID: 1, Block: 20_625_600, Hash: bhHash32(0x03), Time: 1_724_000_012}
	res, err = s.UpsertBlockHeader(ctx, div)
	require.NoError(t, err)
	require.False(t, res.Stored)
	require.Equal(t, bhHash32(0x02), res.ExistingHash)
	require.Equal(t, int64(1_724_000_000), res.ExistingTime)

	// The original row stands untouched.
	var gotTime int64
	var gotHash []byte
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT block_time, block_hash FROM block_headers WHERE chain_id = 1 AND block_number = 20_625_600`).
		Scan(&gotTime, &gotHash))
	require.Equal(t, int64(1_724_000_000), gotTime)
	require.Equal(t, bhHash32(0x02), gotHash)

	// Same hash but a different claimed time is ALSO a divergence (one header
	// cannot carry two times) and is refused the same way.
	res, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: 1, Block: 20_625_600, Hash: bhHash32(0x02), Time: 1_724_000_999})
	require.NoError(t, err)
	require.False(t, res.Stored)
}

func TestUpsertBlockHeaderRefusesUnusableInput(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	_, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: 1, Block: 5, Hash: bhHash32(0x01), Time: 0})
	require.Error(t, err, "a zero block_time is an unset value smuggled in as data; the writer fails closed")

	_, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: 1, Block: 5, Hash: nil, Time: 1_724_000_000})
	require.Error(t, err, "a header write without its hash cannot be pin-validated by anyone downstream")
}

// TestEventBlocksNeedingHeadersSelection pins the whole selection predicate
// for the position_events source: missing headers selected with their pin,
// matching headers excluded, DIVERGENT stored headers re-surfaced (so a
// post-reorg stale row is loudly refusable), ambiguous pins flagged, and
// range/order/limit honoured.
func TestEventBlocksNeedingHeadersSelection(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	const engine, chainID = "debt_manager", uint64(10)
	seedEventAt(t, s, "op:a", engine, chainID, 100, bhHash32(0x10), []byte{0x71, 0x00})
	seedEventAt(t, s, "op:a", engine, chainID, 105, bhHash32(0x15), []byte{0x71, 0x05})
	seedEventAt(t, s, "op:a", engine, chainID, 110, bhHash32(0x1A), []byte{0x71, 0x0A})
	seedEventAt(t, s, "op:a", engine, chainID, 120, bhHash32(0x1E), []byte{0x71, 0x0E})
	// Another ENGINE's event on another chain must never leak into this
	// engine's custody scan.
	seedEventAt(t, s, "eth:b", "aave_v3_etherfi", 1, 102, bhHash32(0x66), []byte{0x72, 0x02})

	// Block 105 already has a MATCHING header; block 110 has a DIVERGENT one
	// (the stored pin moved under a deep-reorg re-walk).
	_, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: chainID, Block: 105, Hash: bhHash32(0x15), Time: 1_700_000_105})
	require.NoError(t, err)
	_, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: chainID, Block: 110, Hash: bhHash32(0x77), Time: 1_700_000_110})
	require.NoError(t, err)

	needs, err := s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksPositionEvents,
		FromExclusive: 0, ToInclusive: 1 << 40, Limit: 10,
	})
	require.NoError(t, err)
	require.Len(t, needs, 3, "105 is satisfied; 100 and 120 are missing; 110 diverges and must resurface")

	require.Equal(t, uint64(100), needs[0].Block)
	require.Equal(t, [][]byte{bhHash32(0x10)}, needs[0].PinHashes)
	require.Nil(t, needs[0].ExistingHash)

	require.Equal(t, uint64(110), needs[1].Block)
	require.Equal(t, [][]byte{bhHash32(0x1A)}, needs[1].PinHashes)
	require.Equal(t, bhHash32(0x77), needs[1].ExistingHash,
		"a stored header that no longer matches the pin must be SURFACED, not silently skipped and not silently overwritten")

	require.Equal(t, uint64(120), needs[2].Block)

	// Range: (100, 110] sees only 110.
	needs, err = s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksPositionEvents,
		FromExclusive: 100, ToInclusive: 110, Limit: 10,
	})
	require.NoError(t, err)
	require.Len(t, needs, 1)
	require.Equal(t, uint64(110), needs[0].Block)

	// Limit bounds the batch from the bottom (ascending).
	needs, err = s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksPositionEvents,
		FromExclusive: 0, ToInclusive: 1 << 40, Limit: 1,
	})
	require.NoError(t, err)
	require.Len(t, needs, 1)
	require.Equal(t, uint64(100), needs[0].Block)
}

// TestEventBlocksNeedingHeadersAmbiguousPin: two streams landed logs for the
// SAME block under DIFFERENT hashes (a fork split between endpoints). The
// block is surfaced with BOTH pins so the caller can refuse custody — there
// is no single pin to validate a fetched header against.
func TestEventBlocksNeedingHeadersAmbiguousPin(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	const engine, chainID = "debt_manager", uint64(10)
	seedEventAt(t, s, "op:a", engine, chainID, 200, bhHash32(0x20), []byte{0x73, 0x01})
	seedEventAt(t, s, "op:b", engine, chainID, 200, bhHash32(0x21), []byte{0x73, 0x02})

	needs, err := s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksPositionEvents,
		FromExclusive: 0, ToInclusive: 1 << 40, Limit: 10,
	})
	require.NoError(t, err)
	require.Len(t, needs, 1)
	require.Equal(t, uint64(200), needs[0].Block)
	require.Len(t, needs[0].PinHashes, 2, "both pins must surface; an arbitrary pick would validate against a coin flip")
}

// TestEventBlocksNeedingHeadersParamSource: the param ledger's blocks are the
// second cohort the events/params surfaces serve block_time for; its pin join
// goes through (chain_id, tx_hash, effective_log_index).
func TestEventBlocksNeedingHeadersParamSource(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	const engine, chainID = "aave_param", uint64(1)
	tx := []byte{0x74, 0x01}
	require.NoError(t, s.SaveBatch(ctx, "eth:aave-param", chainID, []RawLog{{
		ChainID: chainID, BlockNumber: 300, BlockHash: bhHash32(0x30),
		TxHash: tx, LogIndex: 3, Address: addr20(0xAB),
		Topics: [][]byte{{0x01}}, Data: []byte{0x02},
	}}, 300, bhHash32(0x30)))
	require.NoError(t, s.ApplyParamEvents(ctx, engine, chainID, []ParamRow{{
		Engine: engine, ChainID: chainID, Asset: addr20(0x02),
		LTV: big.NewInt(7800), LiqThreshold: big.NewInt(8100), LiqBonus: big.NewInt(10600),
		EffectiveBlock: 300, EffectiveLogIndex: 3,
		SourceEvent: "CollateralConfigurationChanged", TxHash: tx,
	}}, 300))

	needs, err := s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksParamHistory,
		FromExclusive: 0, ToInclusive: 1 << 40, Limit: 10,
	})
	require.NoError(t, err)
	require.Len(t, needs, 1)
	require.Equal(t, uint64(300), needs[0].Block)
	require.Equal(t, [][]byte{bhHash32(0x30)}, needs[0].PinHashes)

	// Satisfy it; the need disappears.
	_, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: chainID, Block: 300, Hash: bhHash32(0x30), Time: 1_700_000_300})
	require.NoError(t, err)
	needs, err = s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksParamHistory,
		FromExclusive: 0, ToInclusive: 1 << 40, Limit: 10,
	})
	require.NoError(t, err)
	require.Empty(t, needs)
}

// TestEventBlocksNeedingHeadersUnpinnedBlockIsInvisible: a derived event whose
// raw log is absent (the Debt Manager's calldata-sourced genesis seeds are the
// real instance) has NO pin to validate against, so custody must not select it
// — its header stays honestly absent, and the cohort count names it.
func TestEventBlocksNeedingHeadersUnpinnedBlockIsInvisible(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	const engine, chainID = "debt_manager", uint64(10)
	// A derived event with no matching raw_logs row (calldata-sourced).
	require.NoError(t, s.ApplyDerived(ctx, engine, chainID, []PositionEvent{{
		ChainID: chainID, Engine: engine, BlockNumber: 400,
		TxHash: []byte{0x75, 0x01}, LogIndex: 0, EventType: "genesis_seed",
		Account: addr20(0x01), Asset: addr20(0x02), Side: "debt",
		Delta: big.NewInt(1),
	}}, 400))

	needs, err := s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksPositionEvents,
		FromExclusive: 0, ToInclusive: 1 << 40, Limit: 10,
	})
	require.NoError(t, err)
	require.Empty(t, needs, "an unpinned block cannot be hash-validated, so it is never offered for custody")

	c, err := s.BlockHeaderCohorts(ctx, engine, chainID, EventBlocksPositionEvents)
	require.NoError(t, err)
	require.Equal(t, int64(1), c.EventBlocks)
	require.Equal(t, int64(1), c.Unpinned)
	require.Equal(t, int64(0), c.WithHeader)
}

func TestBlockHeaderCohorts(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	const engine, chainID = "debt_manager", uint64(10)
	seedEventAt(t, s, "op:a", engine, chainID, 500, bhHash32(0x50), []byte{0x76, 0x00})
	seedEventAt(t, s, "op:a", engine, chainID, 501, bhHash32(0x51), []byte{0x76, 0x01})
	seedEventAt(t, s, "op:a", engine, chainID, 502, bhHash32(0x52), []byte{0x76, 0x02})
	// 500 satisfied; 501 divergent; 502 missing.
	_, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: chainID, Block: 500, Hash: bhHash32(0x50), Time: 1_700_000_500})
	require.NoError(t, err)
	_, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: chainID, Block: 501, Hash: bhHash32(0x99), Time: 1_700_000_501})
	require.NoError(t, err)

	c, err := s.BlockHeaderCohorts(ctx, engine, chainID, EventBlocksPositionEvents)
	require.NoError(t, err)
	require.Equal(t, int64(3), c.EventBlocks)
	require.Equal(t, int64(1), c.WithHeader)
	require.Equal(t, int64(1), c.Mismatched)
	require.Equal(t, int64(1), c.Missing)
	require.Equal(t, int64(0), c.Unpinned)
	require.Equal(t, int64(0), c.Ambiguous)
}

// TestRewindDeletesOrphanedBlockHeaders is the reorg law (store.Rewind's
// block_headers delete, atomic with the raw-log delete): a reorg past a
// header-carrying block must leave NO orphaned (height, stale-hash,
// stale-time) row behind — the height may be reused by a different block —
// and the re-derived range must be re-offered for custody under its NEW pin,
// unobstructed by the old row. Headers at or below the rewind point, and on
// other chains, survive untouched.
func TestRewindDeletesOrphanedBlockHeaders(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	const engine, chainID = "debt_manager", uint64(10)
	seedEventAt(t, s, "op:a", engine, chainID, 600, bhHash32(0x60), []byte{0x78, 0x00})
	seedEventAt(t, s, "op:a", engine, chainID, 610, bhHash32(0x61), []byte{0x78, 0x01})
	for _, w := range []BlockHeaderWrite{
		{ChainID: chainID, Block: 600, Hash: bhHash32(0x60), Time: 1_700_000_600},
		{ChainID: chainID, Block: 610, Hash: bhHash32(0x61), Time: 1_700_000_610},
		{ChainID: 1, Block: 620, Hash: bhHash32(0x6F), Time: 1_700_000_620}, // other chain: must survive
	} {
		res, err := s.UpsertBlockHeader(ctx, w)
		require.NoError(t, err)
		require.True(t, res.Stored)
	}

	// The chain reorgs past block 610; the walker rewinds to 605.
	require.NoError(t, s.Rewind(ctx, "op:a", chainID, 605, bhHash32(0x62)))

	var above, below, otherChain int
	require.NoError(t, s.pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE chain_id = 10 AND block_number > 605),
		        count(*) FILTER (WHERE chain_id = 10 AND block_number <= 605),
		        count(*) FILTER (WHERE chain_id = 1)
		 FROM block_headers`).Scan(&above, &below, &otherChain))
	require.Zero(t, above, "the orphaned header above the rewind point must be deleted ATOMICALLY with the raw logs whose pin vouched for it")
	require.Equal(t, 1, below, "headers at or below the rewind point are still canonical and must survive")
	require.Equal(t, 1, otherChain, "a rewind is chain-scoped; the other chain's custody must survive")

	// The re-walk lands block 610 under a DIFFERENT hash (the reorg's whole
	// point), and derivation re-acks and re-derives it.
	require.NoError(t, s.RewindDerived(ctx, engine, chainID, 605))
	seedEventAt(t, s, "op:a", engine, chainID, 610, bhHash32(0x71), []byte{0x78, 0x02})

	needs, err := s.EventBlocksNeedingHeaders(ctx, HeaderNeedQuery{
		Engine: engine, ChainID: chainID, Source: EventBlocksPositionEvents,
		FromExclusive: 605, ToInclusive: 1 << 40, Limit: 10,
	})
	require.NoError(t, err)
	require.Len(t, needs, 1)
	require.Equal(t, uint64(610), needs[0].Block)
	require.Equal(t, [][]byte{bhHash32(0x71)}, needs[0].PinHashes, "the re-offer carries the NEW canonical pin")
	require.Nil(t, needs[0].ExistingHash, "no orphaned row obstructs the re-fetch: the rewind cleared the way")

	// Custody under the new pin succeeds — the divergence refusal never fires
	// on an honest reorg, because the rewind deleted the stale row first.
	res, err := s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: chainID, Block: 610, Hash: bhHash32(0x71), Time: 1_700_000_611})
	require.NoError(t, err)
	require.True(t, res.Stored)
}

func TestMaxBlockHeaderBlock(t *testing.T) {
	s := testP5Store(t)
	ctx := context.Background()

	_, found, err := s.MaxBlockHeaderBlock(ctx, 10)
	require.NoError(t, err)
	require.False(t, found)

	_, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: 10, Block: 700, Hash: bhHash32(0x70), Time: 1_700_000_700})
	require.NoError(t, err)
	_, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: 10, Block: 900, Hash: bhHash32(0x71), Time: 1_700_000_900})
	require.NoError(t, err)
	_, err = s.UpsertBlockHeader(ctx, BlockHeaderWrite{ChainID: 1, Block: 5_000, Hash: bhHash32(0x72), Time: 1_700_005_000})
	require.NoError(t, err)

	max10, found, err := s.MaxBlockHeaderBlock(ctx, 10)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(900), max10, "the max is per CHAIN; chain 1's higher block must not leak in")
}
