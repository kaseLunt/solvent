package main

// Unit tests for the per-round BLOCK-TIME CUSTODY pass (blocktimes.go),
// against fakes — the composition (frontier read, watermark bookkeeping, pin
// discipline, the failure law) is what needs pinning, and it cannot be pinned
// against a live chain.
//
// MUTATION SPECS (written BEFORE the implementation loop; transcript at
// internal/store/testdata/mutation-transcripts/p5-b2.md):
//
//   m2 (fetch failure blocks ingest): the pass's fetch-failure arm aborts the
//      whole pass (`return` instead of `continue`), so one dead header fetch
//      starves every later block and unit in the round. KILLED by
//      TestHeaderCustodyFetchFailureNeverBlocksTheRound, which injects a
//      failing fetch and requires the round to complete with the failed row
//      ABSENT and the NEXT block still custodied.
//   m1's cmd-side half (the pass forwarding the header's own time, not a
//      clock) is pinned by TestHeaderCustodyWritesChainAssertedHeaderTime;
//      the store-side m1 cut lives in internal/store.

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

type fakeCustodyStore struct {
	cursors    []store.CursorProgress
	cursorsErr error
	maxByChain map[uint64]uint64

	// needs is the full universe of blocks owing custody, per engine; the
	// fake applies the query's range and limit like the real anti-join, and
	// drops blocks that have since been upserted.
	needs map[string][]store.HeaderNeed

	queries []store.HeaderNeedQuery
	upserts []store.BlockHeaderWrite

	upsertResult func(w store.BlockHeaderWrite) store.BlockHeaderUpsert
}

func (f *fakeCustodyStore) DeriveCursorProgress(ctx context.Context) ([]store.CursorProgress, error) {
	return f.cursors, f.cursorsErr
}

func (f *fakeCustodyStore) MaxBlockHeaderBlock(ctx context.Context, chainID uint64) (uint64, bool, error) {
	if f.maxByChain == nil {
		return 0, false, nil
	}
	m, ok := f.maxByChain[chainID]
	return m, ok, nil
}

func (f *fakeCustodyStore) EventBlocksNeedingHeaders(ctx context.Context, q store.HeaderNeedQuery) ([]store.HeaderNeed, error) {
	f.queries = append(f.queries, q)
	var out []store.HeaderNeed
	for _, n := range f.needs[q.Engine] {
		if n.Block <= q.FromExclusive || n.Block > q.ToInclusive {
			continue
		}
		upserted := false
		for _, w := range f.upserts {
			if w.ChainID == q.ChainID && w.Block == n.Block {
				upserted = true
			}
		}
		if upserted {
			continue
		}
		out = append(out, n)
		if len(out) == q.Limit {
			break
		}
	}
	return out, nil
}

func (f *fakeCustodyStore) UpsertBlockHeader(ctx context.Context, w store.BlockHeaderWrite) (store.BlockHeaderUpsert, error) {
	f.upserts = append(f.upserts, w)
	if f.upsertResult != nil {
		return f.upsertResult(w), nil
	}
	return store.BlockHeaderUpsert{Stored: true}, nil
}

func pin32(b byte) []byte {
	h := make([]byte, 32)
	h[0] = 0xcc
	h[31] = b
	return h
}

func fetchFromTable(t *testing.T, table map[uint64]pinnedHeader, fails map[uint64]error) headerFetch {
	t.Helper()
	return func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		if err, ok := fails[block]; ok {
			return pinnedHeader{}, err
		}
		ph, ok := table[block]
		require.True(t, ok, "fetch for unexpected block %d", block)
		return ph, nil
	}
}

func ph(pin []byte, time uint64) pinnedHeader {
	var p pinnedHeader
	copy(p.hash[:], pin)
	p.time = time
	return p
}

// TestHeaderCustodyWritesChainAssertedHeaderTime pins the cmd-side half of
// the m1 law: the pass forwards the HEADER's own timestamp into the write,
// bit-exact — no clock of the daemon's is anywhere in the path.
func TestHeaderCustodyWritesChainAssertedHeaderTime(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 200}},
		maxByChain: map[uint64]uint64{10: 100}, // custody has run before; resume below the cursor
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {{Block: 150, PinHashes: [][]byte{pin32(0x01)}}},
		},
	}
	const headerTime = uint64(1_618_300_800) // 2021-04-13: nowhere near any test-run clock
	c := newHeaderCustodian(fs, fetchFromTable(t, map[uint64]pinnedHeader{
		150: ph(pin32(0x01), headerTime),
	}, nil), []custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})

	c.pass(context.Background())

	require.Len(t, fs.upserts, 1)
	require.Equal(t, uint64(10), fs.upserts[0].ChainID)
	require.Equal(t, uint64(150), fs.upserts[0].Block)
	require.Equal(t, pin32(0x01), fs.upserts[0].Hash)
	require.Equal(t, int64(headerTime), fs.upserts[0].Time,
		"the write must carry the header's OWN timestamp; anything else is a fabricated time")
}

// TestHeaderCustodyFetchFailureNeverBlocksTheRound is the m2 killer: a header
// fetch failure leaves that row ABSENT and the pass carries on — the next
// block is still custodied in the SAME round, the pass returns normally, and
// the watermark advances so no retry loop can wedge the daemon.
func TestHeaderCustodyFetchFailureNeverBlocksTheRound(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 200}},
		maxByChain: map[uint64]uint64{10: 90},
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {
				{Block: 100, PinHashes: [][]byte{pin32(0x01)}},
				{Block: 110, PinHashes: [][]byte{pin32(0x02)}},
			},
		},
	}
	c := newHeaderCustodian(fs, fetchFromTable(t,
		map[uint64]pinnedHeader{110: ph(pin32(0x02), 1_700_000_110)},
		map[uint64]error{100: errors.New("every endpoint refused")},
	), []custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})

	c.pass(context.Background())

	require.Len(t, fs.upserts, 1, "the failed block's row stays ABSENT — absence is the honest state")
	require.Equal(t, uint64(110), fs.upserts[0].Block,
		"the block AFTER the failure must still be custodied in the same round: a fetch failure never blocks the pass")
	require.Equal(t, uint64(200), c.watermark["debt_manager"],
		"the watermark advances past the failure; the hole is cmd/backfill-blocktimes' cohort, not a daemon retry loop")
}

// TestHeaderCustodyRefusalDiscipline: an ambiguous pin and a divergent stored
// row are REFUSED without a fetch; a fetched hash that misses the pin is
// refused without a write. Refusals never stop the pass.
func TestHeaderCustodyRefusalDiscipline(t *testing.T) {
	fetched := map[uint64]int{}
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 300}},
		maxByChain: map[uint64]uint64{10: 200},
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {
				{Block: 210, PinHashes: [][]byte{pin32(0x01), pin32(0x02)}},               // ambiguous
				{Block: 220, PinHashes: [][]byte{pin32(0x03)}, ExistingHash: pin32(0x0F)}, // divergent stored row
				{Block: 230, PinHashes: [][]byte{pin32(0x04)}},                            // fetch returns the WRONG fork
				{Block: 240, PinHashes: [][]byte{pin32(0x05)}},                            // clean
			},
		},
	}
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		fetched[block]++
		switch block {
		case 230:
			return ph(pin32(0x66), 1_700_000_230), nil // hash off-pin
		case 240:
			return ph(pin32(0x05), 1_700_000_240), nil
		default:
			t.Fatalf("fetch for block %d, which the refusal discipline must not reach", block)
			return pinnedHeader{}, nil
		}
	}
	c := newHeaderCustodian(fs, fetch, []custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})

	c.pass(context.Background())

	require.Zero(t, fetched[210], "an ambiguous pin cannot be validated against; no fetch may happen")
	require.Zero(t, fetched[220], "a divergent stored row is refused loudly, never re-fetched into an overwrite")
	require.Equal(t, 1, fetched[230])
	require.Len(t, fs.upserts, 1, "only the clean block reaches the writer")
	require.Equal(t, uint64(240), fs.upserts[0].Block)
	require.Equal(t, uint64(300), c.watermark["debt_manager"])
}

// TestHeaderCustodyCapAndCarryOver: the per-round fetch budget bounds the
// pass; what it could not reach stays owed and the NEXT round picks it up
// from the watermark.
func TestHeaderCustodyCapAndCarryOver(t *testing.T) {
	table := map[uint64]pinnedHeader{
		100: ph(pin32(0x01), 1_700_000_100),
		110: ph(pin32(0x02), 1_700_000_110),
		120: ph(pin32(0x03), 1_700_000_120),
	}
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 200}},
		maxByChain: map[uint64]uint64{10: 90},
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {
				{Block: 100, PinHashes: [][]byte{pin32(0x01)}},
				{Block: 110, PinHashes: [][]byte{pin32(0x02)}},
				{Block: 120, PinHashes: [][]byte{pin32(0x03)}},
			},
		},
	}
	c := newHeaderCustodian(fs, fetchFromTable(t, table, nil),
		[]custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})
	c.capPerRound = 2

	c.pass(context.Background())
	require.Len(t, fs.upserts, 2, "the cap bounds the round")
	require.Equal(t, uint64(110), c.watermark["debt_manager"],
		"under carry-over the watermark stops at the last examined block, so nothing is skipped")

	c.pass(context.Background())
	require.Len(t, fs.upserts, 3, "the carry-over drains on the next round")
	require.Equal(t, uint64(120), fs.upserts[2].Block)
	require.Equal(t, uint64(200), c.watermark["debt_manager"])
}

// TestHeaderCustodyStartupResumesFromStoredMax: a restart resumes roughly
// where custody left off — from the chain's highest custodied block when that
// is below the cursor — instead of silently skipping the tail the previous
// process had not reached. History further down stays the backfill's cohort.
func TestHeaderCustodyStartupResumesFromStoredMax(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 500}},
		maxByChain: map[uint64]uint64{10: 480},
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {{Block: 490, PinHashes: [][]byte{pin32(0x01)}}},
		},
	}
	c := newHeaderCustodian(fs, fetchFromTable(t, map[uint64]pinnedHeader{
		490: ph(pin32(0x01), 1_700_000_490),
	}, nil), []custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})

	c.pass(context.Background())

	require.Len(t, fs.queries, 1)
	require.Equal(t, uint64(480), fs.queries[0].FromExclusive)
	require.Equal(t, uint64(500), fs.queries[0].ToInclusive)
	require.Len(t, fs.upserts, 1)
	require.Equal(t, uint64(490), fs.upserts[0].Block)
}

// TestHeaderCustodyFreshDeployStartsAtCursor: with NO custodied headers at
// all, live custody begins at the current cursor — the whole history is
// deliberately the one-shot backfill's job, not the hot loop's.
func TestHeaderCustodyFreshDeployStartsAtCursor(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors: []store.CursorProgress{{Name: "debt_manager", Block: 500}},
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {{Block: 490, PinHashes: [][]byte{pin32(0x01)}}},
		},
	}
	c := newHeaderCustodian(fs, fetchFromTable(t, nil, nil),
		[]custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})

	c.pass(context.Background())
	require.Empty(t, fs.queries, "watermark == cursor: nothing is owed yet, and history is not the hot loop's to chase")
	require.Empty(t, fs.upserts)

	// The cursor moves; only the NEW range is examined.
	fs.cursors = []store.CursorProgress{{Name: "debt_manager", Block: 510}}
	fs.needs["debt_manager"] = append(fs.needs["debt_manager"], store.HeaderNeed{Block: 505, PinHashes: [][]byte{pin32(0x02)}})
	c.fetch = fetchFromTable(t, map[uint64]pinnedHeader{505: ph(pin32(0x02), 1_700_000_505)}, nil)

	c.pass(context.Background())
	require.Len(t, fs.queries, 1)
	require.Equal(t, uint64(500), fs.queries[0].FromExclusive)
	require.Equal(t, uint64(510), fs.queries[0].ToInclusive)
	require.Len(t, fs.upserts, 1)
	require.Equal(t, uint64(505), fs.upserts[0].Block)
}

// TestHeaderCustodyRewindClamp: a rewound cursor pulls the watermark back, so
// the re-walked range is re-examined (already-matching headers are excluded
// by the store's anti-join; divergent ones resurface for a loud refusal).
func TestHeaderCustodyRewindClamp(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors: []store.CursorProgress{{Name: "debt_manager", Block: 500}},
		needs:   map[string][]store.HeaderNeed{"debt_manager": nil},
	}
	c := newHeaderCustodian(fs, fetchFromTable(t, nil, nil),
		[]custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})

	c.pass(context.Background()) // initializes watermark at 500
	require.Equal(t, uint64(500), c.watermark["debt_manager"])

	// Reorg: the cursor rewinds to 450, then derivation re-walks to 470.
	fs.cursors = []store.CursorProgress{{Name: "debt_manager", Block: 450}}
	c.pass(context.Background())
	require.Equal(t, uint64(450), c.watermark["debt_manager"], "the watermark must clamp to a rewound cursor")

	fs.cursors = []store.CursorProgress{{Name: "debt_manager", Block: 470}}
	fs.needs["debt_manager"] = []store.HeaderNeed{{Block: 460, PinHashes: [][]byte{pin32(0x02)}}}
	c.fetch = fetchFromTable(t, map[uint64]pinnedHeader{460: ph(pin32(0x02), 1_700_000_460)}, nil)
	c.pass(context.Background())
	last := fs.queries[len(fs.queries)-1]
	require.Equal(t, uint64(450), last.FromExclusive, "the re-walked range is re-examined from the clamp")
	require.Equal(t, uint64(470), last.ToInclusive)
	require.Len(t, fs.upserts, 1)
}

// TestHeaderCustodyProgressReadFailureSkipsRoundQuietly: with no frontier
// there is nothing to judge; the pass must do nothing — and must NOT touch
// watermarks — rather than guess.
func TestHeaderCustodyProgressReadFailureSkipsRoundQuietly(t *testing.T) {
	fs := &fakeCustodyStore{cursorsErr: errors.New("db down")}
	c := newHeaderCustodian(fs, fetchFromTable(t, nil, nil),
		[]custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})
	c.pass(context.Background())
	require.Empty(t, fs.queries)
	require.Empty(t, fs.upserts)
	require.Empty(t, c.watermark)
}

// TestHeaderCustodyUnstartedEngineOwesNothing: an engine with no derive
// cursor has derived nothing, so no custody is owed and no query runs.
func TestHeaderCustodyUnstartedEngineOwesNothing(t *testing.T) {
	fs := &fakeCustodyStore{}
	c := newHeaderCustodian(fs, fetchFromTable(t, nil, nil),
		[]custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})
	c.pass(context.Background())
	require.Empty(t, fs.queries)
	require.Empty(t, fs.upserts)
}

// TestHeaderCustodyRetrySweepClosesTransientHoles: a block whose fetch failed
// transiently (the live pass advanced past it) is re-attempted by the
// periodic retry sweep and custodied once the endpoint recovers — block_time
// does not stay null forever waiting for a manual backfill run. The sweep is
// paced (every Nth round), bounded, and obeys the same failure law.
func TestHeaderCustodyRetrySweepClosesTransientHoles(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 200}},
		maxByChain: map[uint64]uint64{10: 90},
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {{Block: 100, PinHashes: [][]byte{pin32(0x01)}}},
		},
	}
	calls := 0
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		require.Equal(t, uint64(100), block)
		calls++
		if calls == 1 {
			return pinnedHeader{}, errors.New("transient endpoint outage")
		}
		return ph(pin32(0x01), 1_700_000_100), nil
	}
	c := newHeaderCustodian(fs, fetch, []custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})
	c.retryEvery = 2

	c.pass(context.Background()) // round 1: fetch fails; watermark advances past the hole
	require.Empty(t, fs.upserts)
	require.Equal(t, uint64(200), c.watermark["debt_manager"])

	c.pass(context.Background()) // round 2: the sweep fires, re-attempts, succeeds
	require.Len(t, fs.upserts, 1, "the retry sweep must close the transient hole")
	require.Equal(t, uint64(100), fs.upserts[0].Block)
	require.Equal(t, int64(1_700_000_100), fs.upserts[0].Time)
	require.Equal(t, 2, calls)
}

// TestHeaderCustodyRetrySweepRotatesAndStaysBounded: a permanently failing
// block cannot monopolize the sweep — the rotating keyset moves on to the
// next missing block, wraps at the watermark, and the per-sweep budget bounds
// the chain load whatever the outcome mix is.
func TestHeaderCustodyRetrySweepRotatesAndStaysBounded(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 200}},
		maxByChain: map[uint64]uint64{10: 200}, // nothing owed above: only the sweep works
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {
				{Block: 100, PinHashes: [][]byte{pin32(0x01)}},
				{Block: 110, PinHashes: [][]byte{pin32(0x02)}},
			},
		},
	}
	var attempts []uint64
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		attempts = append(attempts, block)
		return pinnedHeader{}, errors.New("still down")
	}
	c := newHeaderCustodian(fs, fetch, []custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})
	c.retryEvery = 1
	c.retryBudget = 1

	for i := 0; i < 4; i++ {
		c.pass(context.Background())
	}
	require.Equal(t, []uint64{100, 110, 100}, attempts,
		"the sweep must ROTATE through the missing set (wrapping after the top) rather than hammering the first failing block; pass 3 finds nothing above 110 and resets, pass 4 wraps to the bottom")
	require.Empty(t, fs.upserts)
}

// TestHeaderCustodyWriteRefusalDoesNotStopThePass: the store refusing a
// divergent write (Stored=false) is a loud log, not a round failure.
func TestHeaderCustodyWriteRefusalDoesNotStopThePass(t *testing.T) {
	fs := &fakeCustodyStore{
		cursors:    []store.CursorProgress{{Name: "debt_manager", Block: 300}},
		maxByChain: map[uint64]uint64{10: 240},
		needs: map[string][]store.HeaderNeed{
			"debt_manager": {
				{Block: 250, PinHashes: [][]byte{pin32(0x01)}},
				{Block: 260, PinHashes: [][]byte{pin32(0x02)}},
			},
		},
		upsertResult: func(w store.BlockHeaderWrite) store.BlockHeaderUpsert {
			if w.Block == 250 {
				return store.BlockHeaderUpsert{Stored: false, ExistingHash: pin32(0x77), ExistingTime: 1}
			}
			return store.BlockHeaderUpsert{Stored: true}
		},
	}
	c := newHeaderCustodian(fs, fetchFromTable(t, map[uint64]pinnedHeader{
		250: ph(pin32(0x01), 1_700_000_250),
		260: ph(pin32(0x02), 1_700_000_260),
	}, nil), []custodyUnit{{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}})

	c.pass(context.Background())
	require.Len(t, fs.upserts, 2, "the block after a refused write is still custodied")
	require.Equal(t, uint64(300), c.watermark["debt_manager"])
}
