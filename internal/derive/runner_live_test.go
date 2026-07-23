package derive

// Live-store crash-injection test for the fix wave's transactional rewind
// hygiene (the named rewind-crash failure injection): a process that dies
// BETWEEN store.RewindDerived and every post-rewind step (Reset, onRewind,
// resumed derivation) must leave the store in a state a FRESH runner can
// derive from without wedging — specifically, a post-reorg re-derivation
// that observes a DIFFERENT rate value at the same (asset, block, kind) key
// must land cleanly, because the stale observation was deleted INSIDE
// RewindDerived's own transaction, atomic with the epoch ack. Before the fix
// the deletion was a separate post-rewind call, and this exact crash wedged
// derivation forever on the divergence refusal.
//
// The snapshot re-sweep half of the crash window needs no durable marker:
// a restarted process always performs a full startup sweep (pinned in
// internal/snapshot's TestStartupSweepCoversRewindCrash).
//
// Shares the schema-isolated live harness with lifecycle_live_test.go and
// the fakes (engine/decoder) with runner_test.go — the store here is REAL.

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/require"

	"github.com/kaselunt/solvent/internal/decode"
	"github.com/kaselunt/solvent/internal/store"
)

func TestRunnerRewindCrashRestartRederivesRatesEndToEnd(t *testing.T) {
	s := liveLifecycleStore(t)
	ctx := context.Background()
	token := common.HexToAddress("0x00000000000000000000000000000000000000BB")
	account := []byte{0xAA}
	spec := testRunnerSpec() // engine debt_manager, chain 10, stream s1, addr 0xA1, start 100

	rawAt := func(blockHash, txHash byte) store.RawLog {
		return store.RawLog{
			ChainID: 10, BlockNumber: 100, BlockHash: []byte{blockHash},
			TxHash: []byte{txHash}, LogIndex: 0, Address: []byte{0xA1},
			Topics: [][]byte{{0x01}}, Data: []byte{0x02},
		}
	}
	debtEventAt := func(delta int64) func(l store.RawLog, ev decode.Event) ([]store.PositionEvent, error) {
		return func(l store.RawLog, _ decode.Event) ([]store.PositionEvent, error) {
			return []store.PositionEvent{{
				ChainID: 10, Engine: spec.Engine, BlockNumber: l.BlockNumber, TxHash: l.TxHash,
				LogIndex: l.LogIndex, EventType: "borrow", Account: account,
				Asset: token.Bytes(), Side: "debt", Delta: big.NewInt(delta),
			}}, nil
		}
	}
	newLiveRunner := func(index int64, delta int64) *Runner {
		log := &callLog{}
		eng := &fakeRunnerEngine{log: log, name: spec.Engine, processFn: debtEventAt(delta)}
		dec := &fakeRunnerDecoder{events: map[string]decode.Event{
			"100/0": decode.DMInterestIndexUpdated{Token: token, NewIndex: big.NewInt(index)},
		}}
		r, err := NewRunner(s, dec, eng, spec, nil)
		require.NoError(t, err)
		return r
	}

	// ---- Pre-reorg life: ingest block 100 and derive it. The window lands
	// with rate borrow_index = 111 at block 100, atomically.
	require.NoError(t, s.SaveBatch(ctx, "s1", 10, []store.RawLog{rawAt(0x10, 0x01)}, 100, []byte{0x10}))
	r1 := newLiveRunner(111, 5)
	advanced, err := r1.Step(ctx)
	require.NoError(t, err)
	require.True(t, advanced)
	v, block, found, err := s.LatestRateIndex(ctx, spec.Engine, token.Bytes(), 200, "borrow_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big.NewInt(111), v)
	require.Equal(t, uint64(100), block)

	// ---- Reorg: the walker rewinds raw truth to 99 (durable epoch) and
	// re-ingests the REPLACED block 100, whose canonical log now yields a
	// DIFFERENT index value (222) at the very same (asset, block, kind) key.
	require.NoError(t, s.Rewind(ctx, "s1", 10, 99, []byte{0x99}))
	require.NoError(t, s.SaveBatch(ctx, "s1", 10, []store.RawLog{rawAt(0x20, 0x02)}, 100, []byte{0x20}))

	// ---- CRASH INJECTION: the runner's repair reaches RewindDerived — and
	// the process dies before ANY post-rewind step (no Reset, no onRewind,
	// no further derivation). Only the store's own transaction survives.
	require.NoError(t, s.RewindDerived(ctx, spec.Engine, 10, 100))
	_, _, found, err = s.LatestRateIndex(ctx, spec.Engine, token.Bytes(), 200, "borrow_index")
	require.NoError(t, err)
	require.False(t, found,
		"the stale observation must be gone at RewindDerived commit time — hygiene is inside the rewind's transaction, not a separable follow-up a crash can skip")

	// ---- RESTART: a fresh runner (fresh engine memory, fresh process) must
	// derive the replaced window end-to-end with NO wedge: the divergent 222
	// re-records cleanly because 111 no longer exists.
	r2 := newLiveRunner(222, 7)
	advanced, err = r2.Step(ctx)
	require.NoError(t, err, "re-derivation must not wedge on rate divergence after a rewind crash")
	require.True(t, advanced)

	v, block, found, err = s.LatestRateIndex(ctx, spec.Engine, token.Bytes(), 200, "borrow_index")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, big.NewInt(222), v, "the canonical post-reorg value is the surviving observation")
	require.Equal(t, uint64(100), block)

	cur, found, err := s.DeriveCursor(ctx, spec.Engine)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, uint64(100), cur)
	bals, err := s.BalancesFor(ctx, spec.Engine, account)
	require.NoError(t, err)
	require.Equal(t, "7", bals[hex.EncodeToString(token.Bytes())]["debt"].String(),
		"balances reflect the RE-derived canonical window, not the rewound one")

	// The re-derived window also wrote its side-scoped history row (queried
	// through a direct schema-scoped connection: the store's pool is private).
	db, err := sql.Open("pgx", liveSchemaDSN(t, os.Getenv("TEST_DATABASE_URL"), liveSchema))
	require.NoError(t, err)
	defer db.Close()
	var docJSON []byte
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT balances FROM snapshots WHERE engine = $1 AND account = $2 AND block_number = 100`,
		spec.Engine, account).Scan(&docJSON))
	var doc map[string]any
	require.NoError(t, json.Unmarshal(docJSON, &doc))
	require.Equal(t, map[string]any{"side": "debt", "balances": map[string]any{
		hex.EncodeToString(token.Bytes()): "7",
	}}, doc)
}
