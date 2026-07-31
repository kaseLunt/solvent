package main

// Unit tests for the one-shot block-time backfill: the env gate, the unit
// scope (which ledgers owe headers), and the walk itself — resumability from
// the table, the refusal discipline, and the same failure law the daemon's
// custody pass obeys (a failed fetch leaves the row absent and the walk
// continues; re-running the tool retries it).

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/derive"
	"github.com/kaselunt/solvent/internal/store"
)

type fakeBackfillStore struct {
	// universe of blocks owing custody per engine; the fake applies range,
	// limit and drops upserted blocks like the real anti-join.
	needs   map[string][]store.HeaderNeed
	upserts []store.BlockHeaderWrite
	queries []store.HeaderNeedQuery
}

func (f *fakeBackfillStore) EventBlocksNeedingHeaders(ctx context.Context, q store.HeaderNeedQuery) ([]store.HeaderNeed, error) {
	f.queries = append(f.queries, q)
	var out []store.HeaderNeed
	for _, n := range f.needs[q.Engine] {
		if n.Block <= q.FromExclusive || n.Block > q.ToInclusive {
			continue
		}
		done := false
		for _, w := range f.upserts {
			if w.ChainID == q.ChainID && w.Block == n.Block {
				done = true
			}
		}
		if done {
			continue
		}
		out = append(out, n)
		if len(out) == q.Limit {
			break
		}
	}
	return out, nil
}

func (f *fakeBackfillStore) UpsertBlockHeader(ctx context.Context, w store.BlockHeaderWrite) (store.BlockHeaderUpsert, error) {
	f.upserts = append(f.upserts, w)
	return store.BlockHeaderUpsert{Stored: true}, nil
}

func (f *fakeBackfillStore) BlockHeaderCohorts(ctx context.Context, engine string, chainID uint64, source store.EventBlockSource) (store.BlockHeaderCohorts, error) {
	total := int64(len(f.needs[engine]))
	var with int64
	for _, w := range f.upserts {
		if w.ChainID == chainID {
			with++
		}
	}
	return store.BlockHeaderCohorts{EventBlocks: total, WithHeader: with}, nil
}

func bfPin(b byte) []byte {
	h := make([]byte, 32)
	h[0] = 0xdd
	h[31] = b
	return h
}

func bfHeader(pin []byte, t uint64) pinnedHeader {
	var p pinnedHeader
	copy(p.hash[:], pin)
	p.time = t
	return p
}

func noWait(context.Context) error { return nil }

func TestGateRefusesWithoutExplicitEnv(t *testing.T) {
	require.False(t, gateOpen(""))
	require.False(t, gateOpen("0"))
	require.False(t, gateOpen("true"), "the gate is EXACTLY \"1\": a one-shot chain walk must not start on a spelling guess")
	require.True(t, gateOpen("1"))
}

// TestUnitsFromSpecsScope pins WHICH ledgers owe headers — the scope
// justification lives in the package doc; this test keeps it honest: position
// engines and the param engine in, chainlink_feed (and anything unknown) out.
func TestUnitsFromSpecsScope(t *testing.T) {
	units := unitsFromSpecs([]derive.RunnerSpec{
		{Engine: "debt_manager", ChainID: 10},
		{Engine: "aave_v3_etherfi", ChainID: 1},
		{Engine: derive.ParamEngineName, ChainID: 1},
		{Engine: "chainlink_feed", ChainID: 1},
		{Engine: "someday_engine", ChainID: 1},
	})
	require.Equal(t, []backfillUnit{
		{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents},
		{engine: "aave_v3_etherfi", chainID: 1, source: store.EventBlocksPositionEvents},
		{engine: derive.ParamEngineName, chainID: 1, source: store.EventBlocksParamHistory},
	}, units)
}

func TestBackfillWalksAllBatchesAndReportsCohorts(t *testing.T) {
	fs := &fakeBackfillStore{needs: map[string][]store.HeaderNeed{
		"debt_manager": {
			{Block: 100, PinHashes: [][]byte{bfPin(0x01)}},
			{Block: 110, PinHashes: [][]byte{bfPin(0x02)}},
			{Block: 120, PinHashes: [][]byte{bfPin(0x03)}},
		},
	}}
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		return bfHeader(fs.needs["debt_manager"][0].PinHashes[0], 1_600_000_000+block), nil
	}
	// batch=2 forces keyset pagination across two query rounds (+ the empty
	// terminator), which is the resumability mechanism itself: progress is
	// derived from the table, never from a sidecar file.
	fetch = func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		for _, n := range fs.needs["debt_manager"] {
			if n.Block == block {
				return bfHeader(n.PinHashes[0], 1_600_000_000+block), nil
			}
		}
		return pinnedHeader{}, errors.New("unexpected block")
	}
	var out bytes.Buffer
	rep, err := backfillUnitRun(context.Background(), fs, fetch,
		backfillUnit{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents},
		backfillOpts{batch: 2, wait: noWait, out: &out})
	require.NoError(t, err)
	require.Equal(t, 3, rep.written)
	require.Len(t, fs.upserts, 3)
	require.Equal(t, int64(1_600_000_100), fs.upserts[0].Time, "the header's own time, never a clock")
	require.GreaterOrEqual(t, len(fs.queries), 2, "keyset pagination must issue successive range queries")
	require.Contains(t, out.String(), "debt_manager")
}

// TestBackfillFailureLaw: a failed fetch leaves the row ABSENT and the walk
// CONTINUES — same law as the daemon's custody pass. The failed block is not
// retried within the run (the keyset moves past it); a re-run picks it up
// because the anti-join still lists it.
func TestBackfillFailureLaw(t *testing.T) {
	fs := &fakeBackfillStore{needs: map[string][]store.HeaderNeed{
		"debt_manager": {
			{Block: 100, PinHashes: [][]byte{bfPin(0x01)}},
			{Block: 110, PinHashes: [][]byte{bfPin(0x02)}},
		},
	}}
	calls := map[uint64]int{}
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		calls[block]++
		if block == 100 && calls[block] == 1 {
			return pinnedHeader{}, errors.New("all endpoints down")
		}
		for _, n := range fs.needs["debt_manager"] {
			if n.Block == block {
				return bfHeader(n.PinHashes[0], 1_600_000_000+block), nil
			}
		}
		return pinnedHeader{}, errors.New("unexpected block")
	}
	var out bytes.Buffer
	unit := backfillUnit{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents}

	rep, err := backfillUnitRun(context.Background(), fs, fetch, unit,
		backfillOpts{batch: 10, wait: noWait, out: &out})
	require.NoError(t, err, "a fetch failure is a counted outcome, never a run failure")
	require.Equal(t, 1, rep.written)
	require.Equal(t, 1, rep.fetchFailed)
	require.Len(t, fs.upserts, 1)
	require.Equal(t, uint64(110), fs.upserts[0].Block)

	// RE-RUN: the hole is still listed by the anti-join and now succeeds —
	// resumability from the table itself.
	rep, err = backfillUnitRun(context.Background(), fs, fetch, unit,
		backfillOpts{batch: 10, wait: noWait, out: &out})
	require.NoError(t, err)
	require.Equal(t, 1, rep.written)
	require.Equal(t, 0, rep.fetchFailed)
	require.Len(t, fs.upserts, 2)
}

// TestBackfillRefusalDiscipline mirrors the daemon's: ambiguous pins and
// divergent stored rows refuse WITHOUT a fetch; an off-pin fetched header
// refuses without a write.
func TestBackfillRefusalDiscipline(t *testing.T) {
	fs := &fakeBackfillStore{needs: map[string][]store.HeaderNeed{
		"debt_manager": {
			{Block: 200, PinHashes: [][]byte{bfPin(0x01), bfPin(0x02)}},
			{Block: 210, PinHashes: [][]byte{bfPin(0x03)}, ExistingHash: bfPin(0x0F)},
			{Block: 220, PinHashes: [][]byte{bfPin(0x04)}},
			{Block: 230, PinHashes: [][]byte{bfPin(0x05)}},
		},
	}}
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		switch block {
		case 220:
			return bfHeader(bfPin(0x66), 1_600_000_220), nil // wrong fork
		case 230:
			return bfHeader(bfPin(0x05), 1_600_000_230), nil
		default:
			t.Fatalf("fetch for block %d, which refusal must not reach", block)
			return pinnedHeader{}, nil
		}
	}
	var out bytes.Buffer
	rep, err := backfillUnitRun(context.Background(), fs, fetch,
		backfillUnit{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents},
		backfillOpts{batch: 10, wait: noWait, out: &out})
	require.NoError(t, err)
	require.Equal(t, 1, rep.refusedAmbiguous)
	require.Equal(t, 1, rep.refusedDivergent)
	require.Equal(t, 1, rep.refusedPinMismatch)
	require.Equal(t, 1, rep.written)
	require.Len(t, fs.upserts, 1)
	require.Equal(t, uint64(230), fs.upserts[0].Block)
}

// TestBackfillMaxBoundsATrialRun: -max stops the walk early for a bounded
// trial; the report says the walk is incomplete rather than pretending done.
func TestBackfillMaxBoundsATrialRun(t *testing.T) {
	fs := &fakeBackfillStore{needs: map[string][]store.HeaderNeed{
		"debt_manager": {
			{Block: 100, PinHashes: [][]byte{bfPin(0x01)}},
			{Block: 110, PinHashes: [][]byte{bfPin(0x02)}},
			{Block: 120, PinHashes: [][]byte{bfPin(0x03)}},
		},
	}}
	fetch := func(ctx context.Context, chainID, block uint64) (pinnedHeader, error) {
		for _, n := range fs.needs["debt_manager"] {
			if n.Block == block {
				return bfHeader(n.PinHashes[0], 1_600_000_000+block), nil
			}
		}
		return pinnedHeader{}, errors.New("unexpected block")
	}
	var out bytes.Buffer
	rep, err := backfillUnitRun(context.Background(), fs, fetch,
		backfillUnit{engine: "debt_manager", chainID: 10, source: store.EventBlocksPositionEvents},
		backfillOpts{batch: 10, max: 2, wait: noWait, out: &out})
	require.NoError(t, err)
	require.Equal(t, 2, rep.written)
	require.True(t, rep.stoppedAtMax)
	require.Len(t, fs.upserts, 2)
}
