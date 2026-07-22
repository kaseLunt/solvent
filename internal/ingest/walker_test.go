package ingest

import (
	"context"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

type fakeChain struct {
	head   uint64
	hashes map[uint64]common.Hash // height -> hash
	logs   map[uint64][]types.Log // height -> logs at that height
}

func (f *fakeChain) BlockNumber(ctx context.Context) (uint64, error) { return f.head, nil }

func (f *fakeChain) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	if h, ok := f.hashes[n]; ok {
		return h, nil
	}
	return common.HexToHash("0xdefa017"), nil // deterministic default
}

func (f *fakeChain) Logs(ctx context.Context, from, to uint64, addrs []common.Address) ([]types.Log, error) {
	var out []types.Log
	for b := from; b <= to; b++ {
		out = append(out, f.logs[b]...)
	}
	return out, nil
}

type fakeStore struct {
	cursor    *store.CursorPos
	saved     [][]store.RawLog
	rewoundTo *uint64
}

func (f *fakeStore) Cursor(ctx context.Context, stream string) (*store.CursorPos, error) {
	return f.cursor, nil
}

func (f *fakeStore) SaveBatch(ctx context.Context, stream string, chainID uint64, logs []store.RawLog, tipBlock uint64, tipHash []byte) error {
	f.saved = append(f.saved, logs)
	f.cursor = &store.CursorPos{Block: tipBlock, Hash: tipHash}
	return nil
}

func (f *fakeStore) Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error {
	f.rewoundTo = &toBlock
	f.cursor = &store.CursorPos{Block: toBlock, Hash: hashAtBlock}
	return nil
}

func walker(ch Chain, st Store) *Walker {
	return NewWalker(ch, st, WalkerConfig{
		Stream: "op:test", ChainID: 10,
		Addresses:  []common.Address{common.HexToAddress("0xaa00000000000000000000000000000000000000")},
		StartBlock: 100, Window: 50, Confirmations: 5,
	})
}

func TestFreshWalkStartsAtStartBlockAndCapsAtWindow(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	// window of 50 from start 100 => cursor lands at 149
	require.Equal(t, uint64(149), st.cursor.Block)
}

func TestWalkCapsAtSafeHead(t *testing.T) {
	ch := &fakeChain{head: 130, hashes: map[uint64]common.Hash{}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	// safe head = 130 - 5 = 125 < window cap 149
	require.Equal(t, uint64(125), st.cursor.Block)
}

func TestNoAdvanceWhenCaughtUp(t *testing.T) {
	ch := &fakeChain{head: 130, hashes: map[uint64]common.Hash{125: common.HexToHash("0x01")}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 125, Hash: common.HexToHash("0x01").Bytes()}}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Nil(t, st.rewoundTo)
}

func TestReorgDetectedRewindsTwiceConfirmations(t *testing.T) {
	// stored hash at 200 disagrees with chain
	ch := &fakeChain{head: 300, hashes: map[uint64]common.Hash{200: common.HexToHash("0x11")}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 200, Hash: common.HexToHash("0x22").Bytes()}}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced) // the rewind itself counts as work
	require.NotNil(t, st.rewoundTo)
	require.Equal(t, uint64(190), *st.rewoundTo) // 200 - 2*5
}

func TestRewindNeverGoesBelowStartBlock(t *testing.T) {
	ch := &fakeChain{head: 300, hashes: map[uint64]common.Hash{105: common.HexToHash("0x11")}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 105, Hash: common.HexToHash("0x22").Bytes()}}
	w := walker(ch, st)

	_, err := w.Step(context.Background())
	require.NoError(t, err)
	require.NotNil(t, st.rewoundTo)
	require.Equal(t, uint64(100), *st.rewoundTo) // clamped to StartBlock, not 95
}

func TestLogsAreConvertedAndSaved(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{}, logs: map[uint64][]types.Log{
		110: {{
			Address:     common.HexToAddress("0xaa00000000000000000000000000000000000000"),
			Topics:      []common.Hash{common.HexToHash("0x0b")},
			Data:        []byte{0x0d},
			BlockNumber: 110,
			TxHash:      common.HexToHash("0x0c"),
			Index:       3,
			BlockHash:   common.HexToHash("0x0e"),
		}},
	}}
	st := &fakeStore{}
	w := walker(ch, st)

	_, err := w.Step(context.Background())
	require.NoError(t, err)
	require.Len(t, st.saved, 1)
	require.Len(t, st.saved[0], 1)
	got := st.saved[0][0]
	require.Equal(t, uint64(110), got.BlockNumber)
	require.Equal(t, uint32(3), got.LogIndex)
	require.Equal(t, common.HexToHash("0x0c").Bytes(), got.TxHash)
}
