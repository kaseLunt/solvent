package store

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := destructiveTestDSN(t)
	require.NoError(t, Migrate(context.Background(), dsn))
	s, err := Open(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(s.Close)
	_, err = s.pool.Exec(context.Background(), "TRUNCATE raw_logs, ingest_cursors")
	require.NoError(t, err)
	return s
}

func sampleLogs(n int, fromBlock uint64) []RawLog {
	logs := make([]RawLog, n)
	for i := range logs {
		logs[i] = RawLog{
			ChainID:     10,
			BlockNumber: fromBlock + uint64(i),
			BlockHash:   []byte{0xbb, byte(i)},
			// TxHash encodes fromBlock so batches at different heights never
			// collide on (chain_id, tx_hash, log_index) identity; repeated
			// calls with the same fromBlock (replay tests) still produce
			// byte-identical hashes.
			TxHash:   []byte{0x77, byte(fromBlock >> 8), byte(fromBlock), byte(i)},
			LogIndex: 0,
			Address:  []byte{0xaa},
			Topics:   [][]byte{{0x01}},
			Data:     []byte{0x02},
		}
	}
	return logs
}

func TestCursorNilWhenUnset(t *testing.T) {
	s := testStore(t)
	cur, err := s.Cursor(context.Background(), "op:test")
	require.NoError(t, err)
	require.Nil(t, cur)
}

func TestSaveBatchAdvancesCursorAndIsIdempotent(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(3, 100)

	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0xff}))
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0xff})) // replay: no error, no dupes

	cur, err := s.Cursor(ctx, "op:test")
	require.NoError(t, err)
	require.Equal(t, uint64(102), cur.Block)
	require.Equal(t, []byte{0xff}, cur.Hash)

	var count int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs").Scan(&count))
	require.Equal(t, 3, count)
}

func TestRewindDeletesLogsAboveBlock(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, sampleLogs(5, 100), 104, []byte{0x04}))

	require.NoError(t, s.Rewind(ctx, "op:test", 10, 101, []byte{0x01}))

	cur, err := s.Cursor(ctx, "op:test")
	require.NoError(t, err)
	require.Equal(t, uint64(101), cur.Block)
	require.Equal(t, []byte{0x01}, cur.Hash)

	var count int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs WHERE block_number > 101").Scan(&count))
	require.Equal(t, 0, count)
}

func TestRewindResetsSiblingCursorsOnSameChain(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:a", 10, sampleLogs(3, 100), 102, []byte{0x02}))
	require.NoError(t, s.SaveBatch(ctx, "op:b", 10, nil, 102, []byte{0x02}))
	require.NoError(t, s.SaveBatch(ctx, "eth:c", 1, nil, 500, []byte{0x05}))

	require.NoError(t, s.Rewind(ctx, "op:a", 10, 101, []byte{0x01}))

	curB, err := s.Cursor(ctx, "op:b")
	require.NoError(t, err)
	require.Equal(t, uint64(101), curB.Block) // sibling on chain 10 rewound too
	require.Equal(t, []byte{0x01}, curB.Hash)

	curC, err := s.Cursor(ctx, "eth:c")
	require.NoError(t, err)
	require.Equal(t, uint64(500), curC.Block) // other chain untouched
}

func TestHighestLogAtOrBelow(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	// chain 10 holds logs at blocks 100..104; chain 1 holds one log at 500
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, sampleLogs(5, 100), 104, []byte{0x04}))
	chain1Log := []RawLog{{
		ChainID: 1, BlockNumber: 500, BlockHash: []byte{0xee},
		TxHash: []byte{0x99}, LogIndex: 0, Address: []byte{0xaa},
		Topics: [][]byte{{0x01}}, Data: []byte{0x02},
	}}
	require.NoError(t, s.SaveBatch(ctx, "eth:c", 1, chain1Log, 500, []byte{0x05}))

	// found at exact height
	b, h, found, err := s.HighestLogAtOrBelow(ctx, 10, 104)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(104), b)
	require.Equal(t, []byte{0xbb, 0x04}, h)

	// found below: highest stored log <= 200 is 104
	b, h, found, err = s.HighestLogAtOrBelow(ctx, 10, 200)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(104), b)
	require.Equal(t, []byte{0xbb, 0x04}, h)

	// found below at an interior height: highest stored log <= 102 is 102
	b, h, found, err = s.HighestLogAtOrBelow(ctx, 10, 102)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(102), b)
	require.Equal(t, []byte{0xbb, 0x02}, h)

	// not found: nothing stored at or below 99
	_, _, found, err = s.HighestLogAtOrBelow(ctx, 10, 99)
	require.NoError(t, err)
	require.False(t, found)

	// chain isolation: chain 1 only sees its own log, chain 10 never sees 500
	b, h, found, err = s.HighestLogAtOrBelow(ctx, 1, 1000)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(500), b)
	require.Equal(t, []byte{0xee}, h)

	b, _, found, err = s.HighestLogAtOrBelow(ctx, 10, 1000)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(104), b)
}

// Single-writer enforcement: while one Store holds the writer lock, a second
// Store (a separate pool — i.e. a separate would-be indexer process) must be
// rejected; after the holder closes, a fresh Store can acquire.
func TestAcquireWriterLockEnforcesSingleWriter(t *testing.T) {
	dsn := destructiveTestDSN(t)
	ctx := context.Background()

	s1, err := Open(ctx, dsn)
	require.NoError(t, err)
	require.NoError(t, s1.AcquireWriterLock(ctx))

	s2, err := Open(ctx, dsn)
	require.NoError(t, err)
	err = s2.AcquireWriterLock(ctx)
	require.ErrorContains(t, err, "another indexer process holds the writer lock")
	s2.Close()

	s1.Close() // terminates the locked session, releasing the advisory lock

	s3, err := Open(ctx, dsn)
	require.NoError(t, err)
	defer s3.Close()
	require.NoError(t, s3.AcquireWriterLock(ctx))
}

func TestSaveBatchRejectsMismatchedChainID(t *testing.T) {
	s := testStore(t)
	logs := sampleLogs(1, 100) // logs carry ChainID 10
	err := s.SaveBatch(context.Background(), "eth:c", 1, logs, 100, []byte{0x01})
	require.ErrorContains(t, err, "does not match batch chain id")

	cur, cerr := s.Cursor(context.Background(), "eth:c")
	require.NoError(t, cerr)
	require.Nil(t, cur) // nothing persisted
}

func TestSaveBatchRejectsDivergentReplayPayload(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(2, 100)
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 101, []byte{0x01}))

	mutated := sampleLogs(2, 100)
	mutated[1].Data = []byte{0xEE} // same identity, different payload
	err := s.SaveBatch(ctx, "op:test", 10, mutated, 101, []byte{0x01})
	require.ErrorContains(t, err, "divergent payload")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs WHERE data = '\\xEE'").Scan(&n))
	require.Equal(t, 0, n) // aborted tx persisted nothing
}

func TestSaveBatchAcceptsIdenticalReplay(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(3, 100)
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0x02}))
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0x02}))
	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs").Scan(&n))
	require.Equal(t, 3, n)
}

func TestSaveBatchRejectsCursorRegression(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, nil, 200, []byte{0x02}))
	err := s.SaveBatch(ctx, "op:test", 10, nil, 150, []byte{0x01})
	require.ErrorContains(t, err, "cursor regression")

	cur, cerr := s.Cursor(ctx, "op:test")
	require.NoError(t, cerr)
	require.Equal(t, uint64(200), cur.Block)
}

func TestRewindStillMovesCursorBackward(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, sampleLogs(3, 100), 200, []byte{0x02}))
	require.NoError(t, s.Rewind(ctx, "op:test", 10, 101, []byte{0x01})) // monotonicity guard must NOT apply here
	cur, err := s.Cursor(ctx, "op:test")
	require.NoError(t, err)
	require.Equal(t, uint64(101), cur.Block)
}

func TestSaveBatchRollsBackOnMidTxFailure(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(2, 100)
	logs[1].Topics = nil // NOT NULL violation on topics → mid-tx failure
	err := s.SaveBatch(ctx, "op:test", 10, logs, 101, []byte{0x01})
	require.Error(t, err)
	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs").Scan(&n))
	require.Equal(t, 0, n)
	cur, cerr := s.Cursor(ctx, "op:test")
	require.NoError(t, cerr)
	require.Nil(t, cur)
}

func TestSaveBatchRejectsSameHeightDifferentHashCursor(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, nil, 200, []byte{0xAA}))
	err := s.SaveBatch(ctx, "op:test", 10, nil, 200, []byte{0xBB}) // same height, different hash
	require.ErrorContains(t, err, "cursor regression")
	cur, cerr := s.Cursor(ctx, "op:test")
	require.NoError(t, cerr)
	require.Equal(t, []byte{0xAA}, cur.Hash) // original anchor survives
}

func TestSaveBatchRejectsDivergentDuplicateWithinBatch(t *testing.T) {
	s := testStore(t)
	logs := sampleLogs(2, 100)
	logs[1] = logs[0]
	logs[1].Data = []byte{0xEE} // same identity, different payload, fresh identity in db
	err := s.SaveBatch(context.Background(), "op:test", 10, logs, 101, []byte{0x01})
	require.ErrorContains(t, err, "divergent duplicate log in batch")
	var n int
	require.NoError(t, s.pool.QueryRow(context.Background(), "SELECT count(*) FROM raw_logs").Scan(&n))
	require.Equal(t, 0, n)
}

func TestSaveBatchCoalescesIdenticalDuplicateWithinBatch(t *testing.T) {
	s := testStore(t)
	logs := sampleLogs(2, 100)
	logs[1] = logs[0] // byte-identical duplicate
	require.NoError(t, s.SaveBatch(context.Background(), "op:test", 10, logs, 101, []byte{0x01}))
	var n int
	require.NoError(t, s.pool.QueryRow(context.Background(), "SELECT count(*) FROM raw_logs").Scan(&n))
	require.Equal(t, 1, n)
}

func TestSaveBatchTempTableReuseOnSingleConnection(t *testing.T) {
	dsn := destructiveTestDSN(t)
	require.NoError(t, Migrate(context.Background(), dsn))
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	s, err := Open(context.Background(), dsn+sep+"pool_max_conns=1")
	require.NoError(t, err)
	t.Cleanup(s.Close)
	_, err = s.pool.Exec(context.Background(), "TRUNCATE raw_logs, ingest_cursors")
	require.NoError(t, err)
	// two sequential batches MUST hit the same backend session; ON COMMIT DROP must clean up
	require.NoError(t, s.SaveBatch(context.Background(), "op:test", 10, sampleLogs(2, 100), 101, []byte{0x01}))
	require.NoError(t, s.SaveBatch(context.Background(), "op:test", 10, sampleLogs(2, 200), 201, []byte{0x02}))
}
