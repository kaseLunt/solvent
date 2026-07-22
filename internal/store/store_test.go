package store

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	}
	require.NoError(t, Migrate(dsn))
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
			TxHash:      []byte{0x77, byte(i)},
			LogIndex:    0,
			Address:     []byte{0xaa},
			Topics:      [][]byte{{0x01}},
			Data:        []byte{0x02},
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
