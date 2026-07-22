package ingest

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/store"
)

type fakeChain struct {
	head      uint64
	hashes    map[uint64]common.Hash   // height -> hash
	headerSeq map[uint64][]common.Hash // height -> per-call overrides, consumed in order
	logs      map[uint64][]types.Log   // height -> logs at that height
}

func (f *fakeChain) BlockNumber(ctx context.Context) (uint64, error) { return f.head, nil }

func (f *fakeChain) HeaderHash(ctx context.Context, n uint64) (common.Hash, error) {
	if seq := f.headerSeq[n]; len(seq) > 0 {
		h := seq[0]
		f.headerSeq[n] = seq[1:]
		return h, nil
	}
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

type rewindCall struct {
	toBlock uint64
	hash    []byte
}

type fakeStore struct {
	cursor      *store.CursorPos
	saved       [][]store.RawLog
	saveErr     error
	rewound     *rewindCall
	highestLogs map[uint64][]byte // stored raw_logs: block -> block hash
}

func (f *fakeStore) Cursor(ctx context.Context, stream string) (*store.CursorPos, error) {
	return f.cursor, nil
}

func (f *fakeStore) SaveBatch(ctx context.Context, stream string, chainID uint64, logs []store.RawLog, tipBlock uint64, tipHash []byte) error {
	if f.saveErr != nil {
		return f.saveErr
	}
	f.saved = append(f.saved, logs)
	f.cursor = &store.CursorPos{Block: tipBlock, Hash: tipHash}
	return nil
}

func (f *fakeStore) Rewind(ctx context.Context, stream string, chainID uint64, toBlock uint64, hashAtBlock []byte) error {
	f.rewound = &rewindCall{toBlock: toBlock, hash: hashAtBlock}
	f.cursor = &store.CursorPos{Block: toBlock, Hash: hashAtBlock}
	return nil
}

func (f *fakeStore) HighestLogAtOrBelow(ctx context.Context, chainID, height uint64) (uint64, []byte, bool, error) {
	var (
		best     uint64
		bestHash []byte
		found    bool
	)
	for b, h := range f.highestLogs {
		if b <= height && (!found || b > best) {
			best, bestHash, found = b, h, true
		}
	}
	return best, bestHash, found, nil
}

var testAddr = common.HexToAddress("0xaa00000000000000000000000000000000000000")

func walker(ch Chain, st Store) *Walker {
	return NewWalker(ch, st, WalkerConfig{
		Stream: "op:test", ChainID: 10,
		Addresses:  []common.Address{testAddr},
		StartBlock: 100, Window: 50, Confirmations: 5,
	})
}

func testLog(block uint64) types.Log {
	return types.Log{
		Address:     testAddr,
		Topics:      []common.Hash{common.HexToHash("0x0b")},
		Data:        []byte{0x0d},
		BlockNumber: block,
		TxHash:      common.HexToHash("0x0c"),
		Index:       3,
		BlockHash:   common.HexToHash("0x0e"),
	}
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
	require.Nil(t, st.rewound)
}

// Invariant: the reorg check runs even when caught up — a mismatched cursor
// must rewind rather than be skipped by the caught-up early return.
func TestCaughtUpWithMismatchStillRewinds(t *testing.T) {
	ch := &fakeChain{head: 130, hashes: map[uint64]common.Hash{
		125: common.HexToHash("0x11"), // live disagrees with stored cursor hash
		99:  common.HexToHash("0x99"),
	}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 125, Hash: common.HexToHash("0x22").Bytes()}}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.NotNil(t, st.rewound)
	require.Equal(t, uint64(99), st.rewound.toBlock) // no stored logs -> StartBlock-1
	require.Equal(t, common.HexToHash("0x99").Bytes(), st.rewound.hash)
}

// Invariant: rewind lands on a PROVEN canonical ancestor (stored hash == live
// hash), not a fixed distance — a fork deeper than any constant is still found.
func TestDeepForkWalksBackToVerifiedAncestor(t *testing.T) {
	stored180 := common.HexToHash("0xf180")
	stored150 := common.HexToHash("0xc150")
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{
		200: common.HexToHash("0x11"),   // mismatches cursor
		180: common.HexToHash("0xdead"), // live disagrees with stored log at 180
		150: stored150,                  // live agrees with stored log at 150
	}}
	st := &fakeStore{
		cursor: &store.CursorPos{Block: 200, Hash: common.HexToHash("0x22").Bytes()},
		highestLogs: map[uint64][]byte{
			180: stored180.Bytes(),
			150: stored150.Bytes(),
		},
	}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.NotNil(t, st.rewound)
	require.Equal(t, uint64(150), st.rewound.toBlock)
	require.Equal(t, stored150.Bytes(), st.rewound.hash)
}

// Invariant: when no stored log matches the live chain, everything is suspect
// and the walker re-walks the whole range from StartBlock.
func TestForkBeyondAllStoredLogsRewindsToStartBlock(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{
		200: common.HexToHash("0x11"),   // mismatches cursor
		180: common.HexToHash("0xdead"), // disagrees with stored log at 180
		150: common.HexToHash("0xbeef"), // disagrees with stored log at 150
		99:  common.HexToHash("0x99"),
	}}
	st := &fakeStore{
		cursor: &store.CursorPos{Block: 200, Hash: common.HexToHash("0x22").Bytes()},
		highestLogs: map[uint64][]byte{
			180: common.HexToHash("0xf180").Bytes(),
			150: common.HexToHash("0xc150").Bytes(),
		},
	}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.NotNil(t, st.rewound)
	require.Equal(t, uint64(99), st.rewound.toBlock) // StartBlock-1
	require.Equal(t, common.HexToHash("0x99").Bytes(), st.rewound.hash)
}

// Invariant: a window fetched while the chain tip moved is incoherent and
// must be discarded, not saved.
func TestTipChangedMidStepAborts(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		headerSeq: map[uint64][]common.Hash{
			149: {common.HexToHash("0xa1"), common.HexToHash("0xa2")}, // tip hash changes across the Logs call
		}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.saved)
	require.Nil(t, st.cursor)
}

// Invariant: a reorg landing under the cursor mid-Step must abort the save;
// the next Step's cursor check performs the rewind.
func TestCursorRecheckMismatchAborts(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		headerSeq: map[uint64][]common.Hash{
			200: {common.HexToHash("0x01"), common.HexToHash("0x02")}, // matches at step start, differs on pre-save recheck
		}}
	st := &fakeStore{cursor: &store.CursorPos{Block: 200, Hash: common.HexToHash("0x01").Bytes()}}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.saved)
	require.Nil(t, st.rewound)
	require.Equal(t, uint64(200), st.cursor.Block) // cursor untouched
}

// Invariant: a provider handing back a removed log is a protocol violation —
// error out, save nothing.
func TestRejectsRemovedLog(t *testing.T) {
	l := testLog(110)
	l.Removed = true
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{110: {l}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "removed log")
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: a log outside the requested window is a protocol violation —
// error out, save nothing.
func TestRejectsOutOfRangeLog(t *testing.T) {
	l := testLog(500) // claims block 500, window is [100,149]
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{110: {l}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "outside requested window")
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: a log from an address we never asked for is a protocol
// violation — error out, save nothing.
func TestRejectsForeignAddressLog(t *testing.T) {
	l := testLog(110)
	l.Address = common.HexToAddress("0xbb00000000000000000000000000000000000000")
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{110: {l}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "not in the configured address set")
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: head below Confirmations means no safe block exists yet — no
// work, no underflow.
func TestHeadBelowConfirmationsNoAdvance(t *testing.T) {
	ch := &fakeChain{head: 3, hashes: map[uint64]common.Hash{}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: a failed SaveBatch propagates and leaves the cursor unchanged.
func TestSaveBatchErrorPropagates(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{}}
	st := &fakeStore{saveErr: errors.New("boom")}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "boom")
	require.False(t, advanced)
	require.Nil(t, st.cursor)
}

func TestLogsAreConvertedAndSaved(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{}, logs: map[uint64][]types.Log{
		110: {testLog(110)},
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
	require.Equal(t, []byte{0x0d}, got.Data)
}

// Invariant: two logs at the same height with different block hashes describe
// two forks — the whole batch is fork-inconsistent and must be rejected.
func TestRejectsMixedHashesAtSameHeight(t *testing.T) {
	a := testLog(110)
	b := testLog(110)
	b.TxHash = common.HexToHash("0x0cc")
	b.BlockHash = common.HexToHash("0x0f") // differs from a's 0x0e at the same height
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{110: {a, b}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "mixed block hashes at height 110")
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: a log at the window tip must sit on the fork the cursor is being
// anchored to (tipBefore) — otherwise logs and cursor describe different forks.
func TestRejectsTipLogNotMatchingAnchor(t *testing.T) {
	l := testLog(149) // window tip; BlockHash 0x0e != the fake's HeaderHash(149)
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{149: {l}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "does not match anchored tip hash")
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: a byte-identical duplicate in one response is coalesced — one
// copy saved, no error.
func TestCoalescesIdenticalDuplicateLogs(t *testing.T) {
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{110: {testLog(110), testLog(110)}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.Len(t, st.saved, 1)
	require.Len(t, st.saved[0], 1) // exactly one copy survives
}

// Invariant: the same (TxHash, Index) identity with ANY differing field is a
// protocol violation — error out, save nothing.
func TestRejectsConflictingDuplicateLogs(t *testing.T) {
	a := testLog(110)
	b := testLog(110)
	b.Data = []byte{0xff} // same identity, different payload
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{110: {a, b}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "conflicting duplicate log")
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: the store's log_index column is INT — an index that cannot
// survive the int32 narrowing is rejected before conversion.
func TestRejectsOversizedLogIndex(t *testing.T) {
	l := testLog(110)
	l.Index = uint(math.MaxInt32) + 1
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{},
		logs: map[uint64][]types.Log{110: {l}}}
	st := &fakeStore{}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.ErrorContains(t, err, "exceeds int32 range")
	require.False(t, advanced)
	require.Empty(t, st.saved)
}

// Invariant: a cursor at MaxUint64 is caught up — next must not wrap to 0 and
// silently restart the walk from genesis.
func TestCursorAtMaxUint64DoesNotWrap(t *testing.T) {
	tip := common.HexToHash("0x01")
	ch := &fakeChain{head: math.MaxUint64,
		hashes: map[uint64]common.Hash{math.MaxUint64: tip}}
	st := &fakeStore{cursor: &store.CursorPos{Block: math.MaxUint64, Hash: tip.Bytes()}}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.False(t, advanced)
	require.Empty(t, st.saved)
	require.Nil(t, st.rewound)
}

// Invariant: a verified (stored == live) ancestor is accepted even below this
// stream's StartBlock — a hash match is chain-canonical proof, and clamping up
// would anchor sibling cursors to unverified hashes.
func TestVerifiedMatchBelowStartBlockAccepted(t *testing.T) {
	stored50 := common.HexToHash("0xc050")
	ch := &fakeChain{head: 1000, hashes: map[uint64]common.Hash{
		200: common.HexToHash("0x11"), // mismatches cursor
		50:  stored50,                 // live agrees with stored log below StartBlock (100)
	}}
	st := &fakeStore{
		cursor:      &store.CursorPos{Block: 200, Hash: common.HexToHash("0x22").Bytes()},
		highestLogs: map[uint64][]byte{50: stored50.Bytes()},
	}
	w := walker(ch, st)

	advanced, err := w.Step(context.Background())
	require.NoError(t, err)
	require.True(t, advanced)
	require.NotNil(t, st.rewound)
	require.Equal(t, uint64(50), st.rewound.toBlock)
	require.Equal(t, stored50.Bytes(), st.rewound.hash)
}
